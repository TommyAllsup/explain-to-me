import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { assertNoLinkedPath, assertSupportedFilePath, openRegularFile } from "../../assets/src/file-safety.js";
import {
  formatManifestIssues,
  localAssetSchema,
  MAX_MANIFEST_BYTES,
  productionManifestSchema,
  type LocalAssetIntent,
  type ProductionManifest,
} from "../../contracts/src/production-manifest.js";
import { resolveManifestAssets } from "../../ingest/src/markdown.js";

const MAX_ASSETS = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024;
const PRESENTER_SCENE_KINDS = new Set(["title", "statement", "bullets", "outro"]);
const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

export const presenterPackSchema = z.strictObject({
  version: z.literal("1"),
  asset: localAssetSchema.required({ provenance: true }),
});

export interface PreparePresenterOptions {
  manifestPath: string;
  packPath: string;
  outputDirectory: string;
  sceneIds?: string[];
}

export interface PreparedPresenter {
  manifestPath: string;
  selectedScenes: string[];
}

/** Prepare a portable, entirely local manifest; never change the source inputs. */
export async function preparePresenter(options: PreparePresenterOptions): Promise<PreparedPresenter> {
  for (const path of [options.manifestPath, options.packPath, options.outputDirectory]) {
    if (!path) throw new Error("Manifest, presenter pack, and output paths are required");
    assertSupportedFilePath(path);
  }
  const manifestPath = resolve(options.manifestPath);
  const packPath = resolve(options.packPath);
  const output = resolve(options.outputDirectory);
  await requireAbsent(output);
  await assertUnlinkedAncestors(dirname(output));
  if (!(await lstat(dirname(output))).isDirectory()) throw new Error("Output parent must be an existing directory");

  const input = productionManifestSchema.safeParse(await readJson(manifestPath, "Manifest"));
  if (!input.success) throw new Error(`Manifest validation failed:\n${formatManifestIssues(input.error).join("\n")}`);
  const pack = presenterPackSchema.safeParse(await readJson(packPath, "Presenter pack"));
  if (!pack.success) throw new Error(`Presenter pack validation failed:\n${formatManifestIssues(pack.error).join("\n")}`);
  // Inputs came from JSON, so optional keys cannot contain explicit undefined.
  const manifest = input.data as ProductionManifest;
  const presenterAsset = pack.data.asset as LocalAssetIntent;
  const selectedScenes = selectScenes(manifest, options.sceneIds);
  const originalAssets = manifest.assets ?? [];
  if (originalAssets.length + 1 > MAX_ASSETS) throw new Error(`Prepared manifest may contain at most ${MAX_ASSETS} assets, including the presenter`);
  if (originalAssets.some((asset) => asset.id === presenterAsset.id)) {
    throw new Error(`Presenter asset id collides with an existing asset: ${presenterAsset.id}; give the pack asset a unique id`);
  }

  // Hold verified bytes before creating output. Preflight exact relative paths
  // prevents the resolver's project-assets fallback and rejects linked parents.
  const existingBytes = await verifiedAssetBytes(originalAssets, manifestPath);
  const presenterBytes = await verifiedAssetBytes([presenterAsset], packPath);
  const assets = [...originalAssets, presenterAsset];
  const bytes = [...existingBytes, ...presenterBytes];
  if (bytes.reduce((total, asset) => total + asset.length, 0) > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error(`Prepared images exceed ${MAX_TOTAL_IMAGE_BYTES} total bytes`);
  }
  const selected = new Set(selectedScenes);
  const prepared: ProductionManifest = {
    ...manifest,
    // Prefix even valid manifest IDs: names such as "con" are Windows devices.
    assets: assets.map((asset) => ({ ...asset, source: `assets/asset-${asset.id}.${extensions[asset.mimeType]}` })),
    scenes: manifest.scenes.map((scene) => selected.has(scene.id)
      ? { ...scene, visual: { ...scene.visual, presenter: { assetId: presenterAsset.id } } }
      : scene),
  };
  const checked = productionManifestSchema.safeParse(prepared);
  if (!checked.success) throw new Error(`Prepared manifest validation failed:\n${formatManifestIssues(checked.error).join("\n")}`);
  const json = `${JSON.stringify(checked.data, null, 2)}\n`;
  if (Buffer.byteLength(json, "utf8") > MAX_MANIFEST_BYTES) throw new Error(`Prepared manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);

  await assertUnlinkedAncestors(dirname(output));
  const staging = await mkdtemp(join(dirname(output), `.${basename(output)}-presenter-`));
  let outputCreated = false;
  try {
    await mkdir(join(staging, "assets"));
    for (const [index, asset] of prepared.assets!.entries()) {
      await writeFile(join(staging, asset.source), bytes[index]!, { flag: "wx" });
    }
    await writeFile(join(staging, "manifest.json"), json, { flag: "wx" });
    // mkdir is exclusive on all supported platforms. Renaming the whole staging
    // directory could silently replace an existing empty directory on Unix.
    await mkdir(output);
    outputCreated = true;
    await rename(join(staging, "assets"), join(output, "assets"));
    await rename(join(staging, "manifest.json"), join(output, "manifest.json"));
  } catch (error) {
    if (outputCreated) await rm(output, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    // A cleanup failure must not mask the original validation or filesystem error.
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
  return { manifestPath: join(output, "manifest.json"), selectedScenes };
}

function selectScenes(manifest: ProductionManifest, requested: string[] | undefined): string[] {
  const ids = requested ?? manifest.scenes.filter((scene) => scene.kind === "title" || scene.kind === "outro").map((scene) => scene.id);
  if (ids.length === 0 || ids.some((id) => !id.trim())) throw new Error("Select at least one presenter scene; default selection requires a title or outro scene");
  if (new Set(ids).size !== ids.length) throw new Error("Presenter scene selection contains duplicate ids");
  for (const id of ids) {
    const scene = manifest.scenes.find((candidate) => candidate.id === id);
    if (!scene) throw new Error(`Unknown presenter scene id: ${id}`);
    if (!PRESENTER_SCENE_KINDS.has(scene.kind)) throw new Error(`Presenter is unsupported on ${scene.kind} scene: ${id}`);
    if (scene.visual.presenter) throw new Error(`Scene ${id} already has a presenter; refusing to overwrite it`);
  }
  // Stable manifest order makes the resulting selection independent of CLI order.
  return manifest.scenes.filter((scene) => ids.includes(scene.id)).map((scene) => scene.id);
}

async function verifiedAssetBytes(assets: LocalAssetIntent[], inputPath: string): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  let total = 0;
  for (const asset of assets) {
    const bytes = await readBoundedFile(resolve(dirname(inputPath), asset.source), MAX_IMAGE_BYTES, `Image ${asset.id}`);
    total += bytes.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error(`Referenced images exceed ${MAX_TOTAL_IMAGE_BYTES} total bytes`);
    buffers.push(bytes);
  }
  const resolved = await resolveManifestAssets({ assets }, inputPath, { projectRoot: dirname(inputPath) });
  for (const [index, asset] of resolved.entries()) {
    if (createHash("sha256").update(buffers[index]!).digest("hex") !== asset.sha256) {
      throw new Error(`Manifest asset ${asset.id} changed while preparing; SHA-256 does not match copied bytes`);
    }
  }
  return buffers;
}

async function readJson(path: string, label: string): Promise<unknown> {
  const bytes = await readBoundedFile(path, MAX_MANIFEST_BYTES, label);
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch (error) { throw new Error(`${label} must contain valid JSON`, { cause: error }); }
}

async function readBoundedFile(path: string, limit: number, label: string): Promise<Buffer> {
  await assertUnlinkedAncestors(path);
  const file = await openRegularFile(path);
  try {
    if ((await file.stat()).size > limit) throw new Error(`${label} exceeds the ${limit}-byte limit`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(32 * 1024, limit + 1 - total));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limit) throw new Error(`${label} exceeds the ${limit}-byte limit`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally { await file.close(); }
}

async function assertUnlinkedAncestors(path: string): Promise<void> {
  await assertNoLinkedPath(path);
  if (process.platform === "win32") return; // The shared helper already checks every Windows ancestor.
  let parent = dirname(resolve(path));
  while (true) {
    await assertNoLinkedPath(parent);
    const next = dirname(parent);
    if (next === parent) return;
    parent = next;
  }
}

async function requireAbsent(path: string): Promise<void> {
  try { await lstat(path); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Output already exists; choose a new directory: ${path}`);
}
