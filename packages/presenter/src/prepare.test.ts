import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runPresenter } from "../../../apps/cli/src/presenter.js";
import { productionManifestSchema, type LocalAssetIntent, type ProductionManifest } from "../../contracts/src/production-manifest.js";
import { resolveManifestAssets } from "../../ingest/src/markdown.js";
import { preparePresenter } from "./prepare.js";

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=", "base64");
const provenance = { character: "Example presenter", origin: "manual" as const, credit: "Test fixture", aiGenerated: false };

function asset(id: string, source: string, bytes = pixel): LocalAssetIntent {
  return { id, source, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png" };
}

async function fixture() {
  const scratch = join(process.cwd(), ".cache", "tests");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "presenter-"));
  const manifestPath = join(root, "source", "input.json");
  const packPath = join(root, "pack", "presenter.json");
  await mkdir(join(root, "source"));
  await mkdir(join(root, "pack"));
  await writeFile(join(root, "source", "diagram.png"), pixel);
  await writeFile(join(root, "pack", "portrait.png"), pixel);
  const manifest: ProductionManifest = {
    version: "1", title: "Presenter preparation", profile: "preview", targetDurationMs: 30_000, theme: "technical-whiteboard",
    assets: [{ ...asset("existing-image", "diagram.png"), provenance: { ...provenance, character: "Existing image" } }],
    scenes: [
      { id: "opening", kind: "title", title: "Opening", narration: [{ id: "opening-line", text: "Welcome to the lesson." }], visual: { subtitle: "A local presenter" } },
      { id: "point", kind: "statement", title: "Point", narration: [{ id: "point-line", text: "A clear key point." }], visual: {} },
      { id: "diagram", kind: "diagram", title: "Diagram", narration: [{ id: "diagram-line", text: "Two connected ideas." }], visual: { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] } },
      { id: "steps", kind: "bullets", title: "Steps", narration: [{ id: "steps-line", text: "Follow these steps." }], visual: { lines: ["First", "Second"] } },
      { id: "closing", kind: "outro", title: "Closing", narration: [{ id: "closing-line", text: "Thanks for watching." }], visual: {} },
    ],
  };
  const pack = { version: "1", asset: { ...asset("presenter-example", "portrait.png"), provenance } };
  const save = async () => {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(packPath, `${JSON.stringify(pack, null, 2)}\n`);
  };
  await save();
  const options = { manifestPath, packPath, outputDirectory: join(root, "prepared") };
  return { root, manifest, pack, save, options };
}

async function absent(path: string): Promise<void> {
  await assert.rejects(lstat(path), { code: "ENOENT" });
}

test("preparation selects title/outro by default and copies a portable manifest with original provenance", async () => {
  const f = await fixture();
  try {
    const original = await readFile(f.options.manifestPath);
    const originalPack = await readFile(f.options.packPath);
    const result = await preparePresenter(f.options);
    assert.equal(result.manifestPath, join(f.options.outputDirectory, "manifest.json"));
    assert.deepEqual(result.selectedScenes, ["opening", "closing"]);
    const prepared = productionManifestSchema.parse(JSON.parse(await readFile(result.manifestPath, "utf8"))) as ProductionManifest;
    assert.deepEqual(prepared.scenes.map((scene) => scene.visual.presenter), [
      { assetId: "presenter-example" }, undefined, undefined, undefined, { assetId: "presenter-example" },
    ]);
    assert.deepEqual(prepared.assets?.map((entry) => entry.source), ["assets/asset-existing-image.png", "assets/asset-presenter-example.png"]);
    assert.deepEqual(prepared.assets?.[0]?.provenance, f.manifest.assets?.[0]?.provenance);
    assert.deepEqual(prepared.assets?.[1]?.provenance, provenance);
    assert.deepEqual(await readFile(f.options.manifestPath), original);
    assert.deepEqual(await readFile(f.options.packPath), originalPack);
    for (const entry of prepared.assets ?? []) assert.deepEqual(await readFile(join(f.options.outputDirectory, entry.source)), pixel);

    // Move only the prepared directory and remove both inputs: every asset must
    // still resolve and verify without access to the original source locations.
    const moved = join(f.root, "relocated");
    await rename(f.options.outputDirectory, moved);
    await rm(join(f.root, "source"), { recursive: true });
    await rm(join(f.root, "pack"), { recursive: true });
    const resolved = await resolveManifestAssets(prepared, join(moved, "manifest.json"), { projectRoot: moved });
    assert.equal(resolved.length, 2);
    assert.ok(resolved.every((entry) => entry.sha256 === createHash("sha256").update(pixel).digest("hex")));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("explicit scenes support statements and bullets and reject unknown, unsupported, empty, or duplicate selections", async () => {
  const f = await fixture();
  try {
    // A valid asset ID may also be a Windows device name; published paths must
    // remain portable without changing the manifest's identifier.
    f.pack.asset.id = "con";
    await f.save();
    const result = await preparePresenter({ ...f.options, sceneIds: ["steps", "point"] });
    assert.deepEqual(result.selectedScenes, ["point", "steps"]);
    const prepared = JSON.parse(await readFile(result.manifestPath, "utf8")) as ProductionManifest;
    assert.equal(prepared.scenes[0]?.visual.presenter, undefined);
    assert.equal(prepared.assets?.at(-1)?.source, "assets/asset-con.png");
    for (const [sceneIds, pattern] of [
      [["missing"], /Unknown presenter scene id/u],
      [["diagram"], /unsupported on diagram/u],
      [[], /Select at least one/u],
      [["opening", ""], /Select at least one/u],
      [["opening", "opening"], /duplicate ids/u],
    ] as const) {
      const outputDirectory = join(f.root, `rejected-${Math.random()}`);
      await assert.rejects(preparePresenter({ ...f.options, outputDirectory, sceneIds: [...sceneIds] }), pattern);
      await absent(outputDirectory);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("preparation refuses existing output, asset collisions, full asset budgets, and presenter replacement", async () => {
  const f = await fixture();
  try {
    await mkdir(f.options.outputDirectory);
    const sentinel = join(f.options.outputDirectory, "keep.txt");
    await writeFile(sentinel, "preserved");
    await assert.rejects(preparePresenter(f.options), /Output already exists/u);
    assert.equal(await readFile(sentinel, "utf8"), "preserved");
    assert.deepEqual(await readdir(f.options.outputDirectory), ["keep.txt"]);
    const options = { ...f.options, outputDirectory: join(f.root, "new-output") };
    f.pack.asset.id = "existing-image";
    await f.save();
    await assert.rejects(preparePresenter(options), /collides with an existing asset/u);
    f.pack.asset.id = "presenter-example";
    f.manifest.scenes[0]!.visual.presenter = { assetId: "existing-image" };
    await f.save();
    await assert.rejects(preparePresenter(options), /already has a presenter/u);
    delete f.manifest.scenes[0]!.visual.presenter;
    f.manifest.assets = Array.from({ length: 8 }, (_, index) => asset(`image-${index}`, `image-${index}.png`));
    await f.save();
    await assert.rejects(preparePresenter(options), /at most 8 assets/u);
    await absent(options.outputDirectory);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("preparation validates pack provenance and rejects unexpected fields and malformed or oversized JSON", async () => {
  const f = await fixture();
  try {
    for (const invalid of [
      { version: "1", asset: asset("presenter-example", "portrait.png") },
      { ...f.pack, unexpected: true },
      { ...f.pack, asset: { ...f.pack.asset, provenance: { ...provenance, unexpected: true } } },
    ]) {
      await writeFile(f.options.packPath, JSON.stringify(invalid));
      await assert.rejects(preparePresenter(f.options), /Presenter pack validation failed/u);
    }
    await writeFile(f.options.packPath, "{broken");
    await assert.rejects(preparePresenter(f.options), /Presenter pack must contain valid JSON/u);
    await writeFile(f.options.packPath, " ".repeat(128 * 1024 + 1));
    await assert.rejects(preparePresenter(f.options), /Presenter pack exceeds/u);
    await absent(f.options.outputDirectory);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("preparation rejects corrupt, hash-mismatched, MIME-mismatched, and unsafe asset paths before writing", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "pack", "portrait.png"), "not an image");
    await assert.rejects(preparePresenter(f.options), /Unsupported image content/u);
    await writeFile(join(f.root, "pack", "portrait.png"), pixel);
    f.pack.asset.sha256 = "0".repeat(64);
    await f.save();
    await assert.rejects(preparePresenter(f.options), /SHA-256 does not match/u);
    f.pack.asset.sha256 = asset("unused", "unused").sha256;
    await writeFile(f.options.packPath, JSON.stringify({ ...f.pack, asset: { ...f.pack.asset, mimeType: "image/jpeg" } }));
    await assert.rejects(preparePresenter(f.options), /MIME type does not match/u);
    for (const source of ["../portrait.png", "https://example.invalid/portrait.png", "nested\\portrait.png"]) {
      await writeFile(f.options.packPath, JSON.stringify({ ...f.pack, asset: { ...f.pack.asset, source } }));
      await assert.rejects(preparePresenter(f.options), /relative local path/u);
    }
    await f.save();
    f.manifest.assets![0]!.sha256 = "0".repeat(64);
    await f.save();
    await assert.rejects(preparePresenter(f.options), /SHA-256 does not match/u);
    await absent(f.options.outputDirectory);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("pack images must be relative to their pack and cannot use linked directories", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "pack", "assets"));
    await rename(join(f.root, "pack", "portrait.png"), join(f.root, "pack", "assets", "portrait.png"));
    await assert.rejects(preparePresenter(f.options), { code: "ENOENT" });
    await symlink(join(f.root, "pack", "assets"), join(f.root, "pack", "linked"), process.platform === "win32" ? "junction" : "dir");
    f.pack.asset.source = "linked/portrait.png";
    await f.save();
    await assert.rejects(preparePresenter(f.options), /[Ll]inked|[Rr]eparse/u);
    await absent(f.options.outputDirectory);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("combined manifest and presenter images share the 32 MiB limit", async () => {
  const f = await fixture();
  try {
    const large = Buffer.concat([pixel, Buffer.alloc(4 * 1024 * 1024)]);
    f.manifest.assets = [];
    for (let index = 0; index < 7; index += 1) {
      const source = `large-${index}.png`;
      await writeFile(join(f.root, "source", source), large);
      f.manifest.assets.push(asset(`large-${index}`, source, large));
    }
    await writeFile(join(f.root, "pack", "portrait.png"), large);
    f.pack.asset.sha256 = asset("unused", "unused", large).sha256;
    await f.save();
    await assert.rejects(preparePresenter(f.options), /Prepared images exceed 33554432 total bytes/u);
    await absent(f.options.outputDirectory);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("presenter CLI rejects ambiguous flags and requires each input", async () => {
  await assert.rejects(runPresenter([]), /requires --manifest/u);
  await assert.rejects(runPresenter(["--manifest", "a", "--pack", "b"]), /requires --output/u);
  await assert.rejects(runPresenter(["--pack"]), /requires a value/u);
  await assert.rejects(runPresenter(["--output", "--pack"]), /requires a value/u);
  await assert.rejects(runPresenter(["--output", "a", "--output", "b"]), /Duplicate presenter option/u);
  await assert.rejects(runPresenter(["--fetch", "url"]), /Unknown presenter option/u);
});
