import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ContentAddressedCache } from "../../../packages/assets/src/cache.js";
import { productionManifestSchema, type ProductionManifest } from "../../../packages/contracts/src/production-manifest.js";
import { applyClaudiaPresenter, hasAnimatedClaudia, rendererSourceHashes, selectBuildNarration } from "./claudia.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = async () => JSON.parse(await readFile(join(root, "fixtures/golden-manifests/whisper-vs-tts.json"), "utf8")) as ProductionManifest;

test("Claudia selection persists only supported scene intent without changing narration or source", async () => {
  const original = await fixture(), before = structuredClone(original);
  const prepared = applyClaudiaPresenter(original);
  productionManifestSchema.parse(prepared);
  assert.deepEqual(original, before);
  assert.equal(hasAnimatedClaudia(original), false);
  assert.equal(hasAnimatedClaudia(prepared), true);
  for (const scene of prepared.scenes) {
    assert.deepEqual(scene.narration, original.scenes.find((candidate) => candidate.id === scene.id)!.narration);
    assert.equal(Boolean(scene.visual.presenter), ["title", "statement", "bullets", "outro"].includes(scene.kind));
  }
  prepared.scenes[0]!.visual.presenter = { character: "claudia", motion: "reduced" };
  assert.deepEqual(applyClaudiaPresenter(prepared).scenes[0]!.visual.presenter, { character: "claudia", motion: "reduced" });
  prepared.scenes[0]!.visual.presenter = { assetId: "reviewed-still" };
  assert.throws(() => applyClaudiaPresenter(prepared), /already has a still presenter/u);
});

test("Claudia selects only her approved voice while ordinary auto selection stays unchanged", () => {
  assert.deepEqual(selectBuildNarration("auto", "auto", true), { backend: "chatterbox", voice: "chatterbox-bella" });
  assert.deepEqual(selectBuildNarration("auto", "auto", false), { backend: "auto", voice: "auto" });
  assert.deepEqual(selectBuildNarration("kokoro", "af_bella", false), { backend: "kokoro", voice: "af_bella" });
  assert.throws(() => selectBuildNarration("kokoro", "auto", true), /requires --tts chatterbox/u);
  assert.throws(() => selectBuildNarration("chatterbox", "af_bella", false), /selected voice only/u);
});

test("render cache identity covers nested promoted rig source and accepts ordinary builds", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "claudia-hashes-"));
  try {
    const sources = await rendererSourceHashes(root);
    for (const path of Object.keys(sources)) {
      await mkdir(dirname(join(temporary, path)), { recursive: true });
      await writeFile(join(temporary, path), await readFile(join(root, path)));
    }
    await mkdir(join(temporary, "packages/presenter/src/claudia"), { recursive: true });
    const rig = "packages/presenter/src/claudia/cache-fixture.ts";
    await writeFile(join(temporary, rig), "export const jaw = 1;\n");
    const before = await rendererSourceHashes(temporary);
    await writeFile(join(temporary, rig), "export const jaw = 2;\n");
    const after = await rendererSourceHashes(temporary);
    assert.notEqual(before[rig], after[rig]);
    const cache = new ContentAddressedCache(join(temporary, "cache"));
    const ordinary = { manifest: await fixture(), sourceHashes: before };
    assert.match(cache.key("render-video-v1", ordinary), /^[a-f0-9]{64}$/u);
    assert.notEqual(cache.key("render-video-v1", ordinary), cache.key("render-video-v1", { ...ordinary, sourceHashes: after }));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
