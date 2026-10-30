import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlan, extractPreviewPcm, loadPlan, projectCommand, selectPreview, selectPreviewContext, selectProjectNarration, withNewOutput } from "./project-workflow.js";
import { projectSchema } from "../../../packages/contracts/src/project.js";
import { loadProject } from "../../../packages/project/src/files.js";
import { prepareNarration } from "../../../packages/audio/src/prepare-narration.js";
import { resolveChunkPacing } from "../../../packages/audio/src/pacing.js";
import type { ProductionManifest } from "../../../packages/contracts/src/production-manifest.js";
import { assertSupportedFilePath } from "../../../packages/assets/src/file-safety.js";

const manifest: ProductionManifest = {
  version: "1", title: "A measured walk", profile: "preview", targetDurationMs: 60_000, theme: "technical-whiteboard",
  scenes: ["start", "measure", "finish"].map((id) => ({
    id, kind: "statement", title: id, visual: {},
    narration: [{ id: `${id}-passage`, text: "A PCM sample has a measured duration. The timeline follows the actual sound." }],
  })),
};

const claudiaManifest: ProductionManifest = { ...manifest, scenes: manifest.scenes.map((scene) => ({
  ...scene, visual: scene.id === "measure" ? { presenter: { character: "claudia" as const } } : scene.visual,
})) };

test("saved build and preview narration resolve Claudia from the complete reviewed plan", () => {
  const config = projectSchema.parse({ version: "1", title: "Review Claudia", input: { manifest: "story.json" } });
  assert.deepEqual(selectProjectNarration(config, manifest), { backend: "auto", voice: "auto" });
  assert.deepEqual(selectProjectNarration(config, claudiaManifest), { backend: "chatterbox", voice: "chatterbox-bella" });
  const excerpt = selectPreview(claudiaManifest, {}, undefined, "start");
  assert.equal(excerpt.scenes.some((scene) => scene.visual.presenter), false, "a preview can exclude Claudia's visible scene");
  assert.deepEqual(selectProjectNarration(config, claudiaManifest), { backend: "chatterbox", voice: "chatterbox-bella" }, "the full plan still chooses the build voice");
  const kokoro = { ...config, narration: { ...config.narration, backend: "kokoro" as const, voice: "af_bella" } };
  assert.deepEqual(selectProjectNarration(kokoro, manifest), { backend: "kokoro", voice: "af_bella" });
  assert.throws(() => selectProjectNarration(kokoro, claudiaManifest), /Animated Claudia requires/);
  assert.throws(() => selectProjectNarration({ ...config, narration: { ...config.narration, voice: "af_bella" } }, claudiaManifest), /selected voice only/);
  assert.throws(() => selectProjectNarration({ ...config, narration: { ...config.narration,
    delivery: { mode: "connected", sentencePauseMs: 250, clausePauseMs: 100 },
  } }, claudiaManifest), /Connected delivery requires Kokoro/);
});

test("Claudia validates effective pacing across the complete plan before preview selection", () => {
  const config = projectSchema.parse({ version: "1", title: "Review Claudia", input: { manifest: "story.json" } });
  const pacing = { default: 0.9, scenes: { start: 1, measure: 1, finish: 1 }, passages: {} };
  assert.doesNotThrow(() => selectProjectNarration({ ...config, narration: { ...config.narration, pacing } }, claudiaManifest));
  assert.throws(() => selectProjectNarration({ ...config, narration: { ...config.narration,
    pacing: { ...pacing, passages: { "measure-passage": 0.8 } },
  } }, claudiaManifest), /Chatterbox/);
});

test("saved Claudia plans forward the selected voice to build and reject incompatible preview options before synthesis", async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-project-claudia-"));
  try {
    await writeFile(join(root, "story.json"), JSON.stringify(claudiaManifest));
    const config = { version: "1", title: "Review Claudia", input: { manifest: "story.json" } };
    const projectPath = join(root, "project.json");
    await writeFile(projectPath, JSON.stringify(config));
    const project = await loadProject(projectPath);
    const planPath = join(root, "plan");
    await createPlan(project, planPath, join(root, "cache"));
    let builds = 0;
    await projectCommand("build", ["--project", projectPath, "--plan", planPath, "--output", join(root, "build")], async (options) => {
      builds += 1;
      assert.equal(options.backend, "chatterbox");
      assert.equal(options.voice, "chatterbox-bella");
      assert.deepEqual(options.project!.manifest.scenes[1]!.visual.presenter, { character: "claudia" });
    });
    assert.equal(builds, 1);
    const neverBuild = async () => { assert.fail("preview must not build video"); };
    for (const narration of [
      { voice: "af_bella" },
      { pacing: { passages: { "measure-passage": 0.8 } } },
      { delivery: { mode: "connected" } },
    ]) {
      await writeFile(projectPath, JSON.stringify({ ...config, narration }));
      await assert.rejects(() => projectCommand("preview", ["--project", projectPath, "--plan", planPath, "--scene", "start", "--output", join(root, "preview")], neverBuild), /Chatterbox|Connected delivery/);
    }
    assert.equal((await readdir(root)).some((name) => name.includes("preview")), false, "invalid settings fail before preview output or synthesis work");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("connected previews keep full scene context and extract only measured selected PCM", () => {
  const full: ProductionManifest = { ...manifest, scenes: [{ ...manifest.scenes[0]!, narration: [
    { id: "first", text: "The setup." }, { id: "middle", text: "The selected phrase." }, { id: "last", text: "The answer." },
  ] }, manifest.scenes[1]!] };
  const excerpt = selectPreview(full, { first: "first", middle: "middle", last: "last" }, "middle");
  // selectPreview uses the original-ID map when selecting a passage.
  assert.equal(excerpt.scenes[0]?.id, "start");
  const context = selectPreviewContext(full, excerpt);
  assert.deepEqual(context.scenes, [full.scenes[0]]);
  const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0]);
  const chunks = [{ id: "first", samples: 2 }, { id: "middle", samples: 1 }, { id: "last", samples: 3 }];
  assert.deepEqual(extractPreviewPcm(pcm, chunks, ["middle"]), { pcm: Buffer.from([3, 0]), chunks: [chunks[1]] });
  assert.deepEqual(extractPreviewPcm(pcm, chunks, ["first", "last"]).pcm, Buffer.from([1, 0, 2, 0, 4, 0, 5, 0, 6, 0]));
  assert.throws(() => extractPreviewPcm(pcm, chunks, ["missing"]), /do not match/);
  assert.throws(() => extractPreviewPcm(pcm.subarray(2), chunks, ["middle"]), /exceeds PCM/);
  assert.throws(() => extractPreviewPcm(pcm, chunks, ["middle", "middle"]), /unique/);
});

test("planning saves editable narration without production; current pacing/music may change but source/direction may not", async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-project-review-"));
  try {
    await writeFile(join(root, "story.json"), JSON.stringify(manifest));
    const config = { version: "1", title: "Review me", input: { manifest: "story.json" }, narration: { pronunciations: { PCM: "P C M" }, pacing: { default: 1, passages: { "measure-passage": 0.7 } } } };
    await writeFile(join(root, "project.json"), JSON.stringify(config));
    const project = await loadProject(join(root, "project.json"));
    const plan = join(root, "plan");
    await createPlan(project, plan, join(root, "cache"));
    assert.deepEqual((await readdir(plan)).sort(), ["manifest.json", "plan.json"]);
    assert.equal((await readdir(root)).includes("cache"), false, "prepared plan has no TTS/render cache work");
    const edited = JSON.parse(await readFile(join(plan, "manifest.json"), "utf8")) as ProductionManifest;
    edited.scenes[1]!.narration[0]!.text = "A PCM sample has a measured duration. Review this slower passage.";
    await writeFile(join(plan, "manifest.json"), JSON.stringify(edited));
    const loaded = await loadPlan(project, plan);
    assert.match(loaded.manifest.scenes[1]!.narration[0]!.text, /Review this slower passage/);
    const prepared = prepareNarration(loaded.manifest, project.config.narration.pronunciations);
    const excerpt = selectPreview(prepared.manifest, prepared.originByChunkId, "measure-passage");
    assert.equal(excerpt.scenes[0]!.narration.length, 2);
    assert.match(excerpt.scenes[0]!.narration[0]!.spokenText!, /P C M/);
    const fullPaces = resolveChunkPacing(prepared.manifest, project.config.narration.pacing, prepared.originByChunkId);
    const previewPaces = resolveChunkPacing(excerpt, project.config.narration.pacing, prepared.originByChunkId);
    for (const [id, value] of Object.entries(previewPaces)) { assert.equal(value, 0.7); assert.equal(value, fullPaces[id]); }
    assert.throws(() => selectPreview(prepared.manifest, prepared.originByChunkId, "missing"), /did not match/);
    config.narration.pacing.default = 0.9;
    await writeFile(join(root, "project.json"), JSON.stringify({ ...config, music: { source: "not-needed-for-plan.wav", gainDb: -24 } }));
    await loadPlan(await loadProject(join(root, "project.json")), plan);
    await writeFile(join(root, "project.json"), JSON.stringify({ ...config, direction: { mode: "template" } }));
    await assert.rejects(() => loadPlanFromFile(root, plan), /direction changed/);
    await writeFile(join(root, "story.json"), JSON.stringify({ ...manifest, title: "Changed source" }));
    await assert.rejects(() => loadPlan(project, plan), /source changed/);
    await assert.rejects(() => createPlan(project, plan, join(root, "cache")), /already exists/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function loadPlanFromFile(root: string, plan: string) { return loadPlan(await loadProject(join(root, "project.json")), plan); }

test("project commands reject legacy overrides, missing plans, duplicate flags and retain failed output", async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-project-options-"));
  try {
    const project = join(root, "project.json");
    await writeFile(project, JSON.stringify({ version: "1", title: "Test", input: { source: "source.md" } }));
    const neverBuild = async () => { assert.fail("production should not run"); };
    await assert.rejects(() => projectCommand("build", ["--project", project], neverBuild), /requires --plan/);
    await assert.rejects(() => projectCommand("build", ["--project", project, "--duration", "60s"], neverBuild), /Unknown/);
    await assert.rejects(() => projectCommand("plan", ["--project", project, "--project", project], neverBuild), /cannot be repeated/);
    await assert.rejects(() => withNewOutput(join(root, "failed"), async (staging) => { await writeFile(join(staging, "diagnostic.txt"), "retained"); throw new Error("expected failure"); }), /diagnostics retained/);
    const retained = (await readdir(root)).find((name) => name.startsWith(".failed.staging-"))!;
    assert.equal(await readFile(join(root, retained, "diagnostic.txt"), "utf8"), "retained");
    await withNewOutput(join(root, "saved"), async (staging) => { await writeFile(join(staging, "ok"), "original"); });
    await assert.rejects(() => withNewOutput(join(root, "saved"), async () => {}), /already exists/);
    assert.equal(await readFile(join(root, "saved", "ok"), "utf8"), "original");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("template project plans Markdown and carries approved images into the saved plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-project-source-"));
  try {
    await writeFile(join(root, "image.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=", "base64"));
    await writeFile(join(root, "source.md"), "# A measured walk\n\nWe walk to the library, then measure how much time the walk takes.\n\n![A marker](image.png)\n\n## Timing\n\nA clock records when we start and when we arrive. The difference is the duration.\n\n## Review\n\nWe compare the result with our estimate and retain the original measurement.\n");
    await writeFile(join(root, "project.json"), JSON.stringify({ version: "1", title: "Walk", input: { source: "source.md" }, direction: { mode: "template" } }));
    const project = await loadProject(join(root, "project.json"));
    await createPlan(project, join(root, "plan"), join(root, "cache"));
    const plan = await loadPlan(project, join(root, "plan"));
    assert.ok(plan.manifest.assets?.length);
    assert.ok((await readdir(join(root, "plan", "assets"))).length);
    assert.equal((plan.provenance.direction as { method: string }).method, "template-extractive");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("plan assets with valid Windows device IDs receive portable filenames", async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-project-device-id-"));
  try {
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=", "base64");
    await writeFile(join(root, "image.png"), image);
    await writeFile(join(root, "story.json"), JSON.stringify({ ...manifest, assets: [{
      id: "con", source: "image.png", sha256: createHash("sha256").update(image).digest("hex"), mimeType: "image/png",
    }] }));
    await writeFile(join(root, "project.json"), JSON.stringify({ version: "1", title: "Portable asset", input: { manifest: "story.json" } }));
    const project = await loadProject(join(root, "project.json"));
    const planPath = join(root, "plan");
    await createPlan(project, planPath, join(root, "cache"));
    const plan = await loadPlan(project, planPath);
    const asset = plan.manifest.assets![0]!;
    assert.equal(asset.id, "con");
    assert.equal(asset.source, "assets/asset-con.png");
    assert.doesNotThrow(() => assertSupportedFilePath(asset.source, "win32"));
    assert.deepEqual(await readFile(join(planPath, asset.source)), image);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("saved projects reject assets that resolve outside the project or selected plan", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-project-asset-boundary-"));
  const outside = await mkdtemp(join(tmpdir(), "etm-outside-assets-"));
  try {
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=", "base64");
    await writeFile(join(outside, "private.png"), image);
    const story = { ...manifest, assets: [{ id: "image", source: "assets/private.png",
      sha256: createHash("sha256").update(image).digest("hex"), mimeType: "image/png" }] };
    await writeFile(join(root, "story.json"), JSON.stringify(story));
    await writeFile(join(root, "project.json"), JSON.stringify({ version: "1", title: "Bounded images", input: { manifest: "story.json" } }));
    const project = await loadProject(join(root, "project.json"));
    await symlink(outside, join(root, "assets"), "dir");
    await assert.rejects(() => createPlan(project, join(root, "rejected-plan"), join(root, "cache")), /outside the approved local roots|Linked/);
    assert.equal((await readdir(root)).includes("rejected-plan"), false);

    // An initially safe plan must also reject an edited manifest pointing through
    // its own assets symlink, including the legacy bare-filename fallback.
    await writeFile(join(root, "story.json"), JSON.stringify(manifest));
    const plan = join(root, "plan");
    await createPlan(project, plan, join(root, "cache"));
    await symlink(outside, join(plan, "assets"), "dir");
    for (const source of ["assets/private.png", "private.png"]) {
      await writeFile(join(plan, "manifest.json"), JSON.stringify({ ...story, assets: [{ ...story.assets[0], source }] }));
      await assert.rejects(() => loadPlan(project, plan), /outside the approved local roots|Linked/);
    }

    await writeFile(join(root, "source.md"), "# Boundary\n\n![Private](assets/private.png)\n");
    await writeFile(join(root, "project.json"), JSON.stringify({ version: "1", title: "Bounded source", input: { source: "source.md" }, direction: { mode: "template" } }));
    await assert.rejects(() => createPlanFromFile(), /outside the approved local roots|Linked/);
    async function createPlanFromFile() {
      await createPlan(await loadProject(join(root, "project.json")), join(root, "rejected-source-plan"), join(root, "cache"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
