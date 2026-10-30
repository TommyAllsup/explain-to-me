import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AlignedNarrationChunk } from "../../contracts/src/narration-alignment.js";
import { productionManifestSchema, type ProductionManifest } from "../../contracts/src/production-manifest.js";
import { ContentAddressedCache } from "../../assets/src/cache.js";
import { chatterboxReadiness, decodeChatterboxCache, encodeChatterboxCache, validateChatterboxAlignment, validateChatterboxChunks } from "./chatterbox.js";
import { selectNarrationBackend, synthesizeNarration } from "./synthesize.js";
import { assertChatterboxPacing, resolveChunkPacing } from "./pacing.js";
import { prepareNarration } from "./prepare-narration.js";

const pcm = Buffer.alloc(48_000, 32);
const alignment: AlignedNarrationChunk = {
  id: "con", text: "It's ready!", sampleRate: 24000, samples: pcm.length / 2,
  pcmSha256: createHash("sha256").update(pcm).digest("hex"),
  words: [{ text: "It's", start: 0.05, end: 0.3 }, { text: "ready!", start: 0.4, end: 0.9 }],
  phonemes: [{ phoneme: "ɪ", start: 0.05, end: 0.3 }, { phoneme: "r", start: 0.4, end: 0.9 }],
};

test("Chatterbox is explicit and never replaces ordinary auto narration", () => {
  assert.deepEqual(selectNarrationBackend("chatterbox", { chatterbox: { ready: true, reason: "ready" } }), { backend: "chatterbox", warnings: [] });
  assert.throws(() => selectNarrationBackend("chatterbox", { chatterbox: { ready: false, reason: "register the runtime" } }), /register the runtime/u);
  assert.equal(selectNarrationBackend("auto", { platform: "win32", kokoro: { ready: true, reason: "ready" }, chatterbox: { ready: true, reason: "ready" } }).backend, "kokoro");
});

test("Chatterbox checks effective saved-project pacing before loading its optional runtime", async () => {
  const manifest = productionManifestSchema.parse(JSON.parse(await readFile(new URL("../../../fixtures/golden-manifests/whisper-vs-tts.json", import.meta.url), "utf8"))) as ProductionManifest;
  manifest.scenes = [{ ...manifest.scenes[0]!, narration: [{ id: "reviewed", text: "A natural delivery. The timing follows the voice." }] }];
  const prepared = prepareNarration(manifest);
  const options = {
    manifest: prepared.manifest, voice: "auto", backend: "chatterbox" as const,
    targetDurationMs: 10_000, workDir: tmpdir(), passageOrigins: prepared.originByChunkId,
  };
  const previousConfig = process.env.EXPLAIN_TO_ME_CLAUDIA_CONFIG;
  process.env.EXPLAIN_TO_ME_CLAUDIA_CONFIG = join(tmpdir(), "missing-claudia-pacing-check-a65fb43a.json");
  try {
    for (const pacing of [
      { default: 0.9 },
      { default: 1, scenes: { [manifest.scenes[0]!.id]: 0.9 } },
      { default: 1, passages: { reviewed: 0.9 } },
    ]) {
      await assert.rejects(() => synthesizeNarration({ ...options, pacing }), /Claudia Chatterbox.*only pace 1/u);
    }
    const overriddenPace = { default: 0.9, passages: { reviewed: 1 } };
    assert.doesNotThrow(() => assertChatterboxPacing(resolveChunkPacing(prepared.manifest, overriddenPace, prepared.originByChunkId)));
    await assert.rejects(() => synthesizeNarration({ ...options, pacing: overriddenPace }), /Claudia Chatterbox backend is unavailable/u);
    await assert.rejects(() => synthesizeNarration({ ...options, pacing: { default: 1 }, delivery: { mode: "connected", sentencePauseMs: 180, clausePauseMs: 80 } }), /Connected delivery requires Kokoro/u);
  } finally {
    if (previousConfig === undefined) delete process.env.EXPLAIN_TO_ME_CLAUDIA_CONFIG;
    else process.env.EXPLAIN_TO_ME_CLAUDIA_CONFIG = previousConfig;
  }
});

test("Chatterbox cache round-trip binds delivered PCM to exact spoken text and local intervals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "claudia cache "));
  try {
    const cache = new ContentAddressedCache(directory);
    const key = cache.key("test", { text: alignment.text });
    await cache.write(key, encodeChatterboxCache(pcm, alignment));
    const restored = decodeChatterboxCache((await cache.read(key))!, alignment);
    assert.deepEqual(restored, { pcm, alignment });
    assert.equal(cache.snapshotStats().hits, 1);
    assert.throws(() => decodeChatterboxCache((encodeChatterboxCache(pcm, alignment)), { ...alignment, text: "Different narration." }), /identity mismatch/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Chatterbox rejects stale PCM, word loss, overlapping or out-of-range timing", () => {
  const cases = [
    { ...alignment, pcmSha256: "0".repeat(64) },
    { ...alignment, samples: alignment.samples - 1 },
    { ...alignment, words: alignment.words.slice(0, 1) },
    { ...alignment, words: [{ text: "It's", start: 0.05, end: 0.6 }, alignment.words[1]] },
    { ...alignment, phonemes: [{ phoneme: "a", start: 0.3, end: 1.1 }] },
    { ...alignment, phonemes: [{ phoneme: "a", start: 0.3, end: 0.2 }] },
  ];
  for (const value of cases) assert.throws(() => validateChatterboxAlignment(value, pcm, alignment));
  const changed = Buffer.from(pcm);
  changed[10] = 0;
  assert.throws(() => validateChatterboxAlignment(alignment, changed, alignment), /identity mismatch/u);
});

test("Chatterbox validates spokenText, bounds and duplicate IDs before generation", () => {
  assert.doesNotThrow(() => validateChatterboxChunks([{ id: "aux", text: "GPU", spokenText: "G P U" }]));
  assert.throws(() => validateChatterboxChunks([{ id: "a", text: "display", spokenText: " " }]));
  assert.throws(() => validateChatterboxChunks([{ id: "a", text: "valid" }, { id: "a", text: "duplicate" }]));
  assert.throws(() => validateChatterboxChunks([{ id: "../escape", text: "valid" }]));
  assert.throws(() => validateChatterboxChunks([{ id: "a", text: "x".repeat(1601) }]));
});

test("Optional readiness gives setup guidance for a missing registration without loading models", () => {
  const prior = process.env.EXPLAIN_TO_ME_CLAUDIA_CONFIG;
  process.env.EXPLAIN_TO_ME_CLAUDIA_CONFIG = join(tmpdir(), "missing-claudia-registration-8c6e8d34.json");
  try {
    const result = chatterboxReadiness();
    assert.equal(result.ready, false);
    assert.match(result.reason, /scripts\/setup-claudia.py/u);
    assert.match(result.reason, /never download/u);
  } finally {
    if (prior === undefined) delete process.env.EXPLAIN_TO_ME_CLAUDIA_CONFIG;
    else process.env.EXPLAIN_TO_ME_CLAUDIA_CONFIG = prior;
  }
});
