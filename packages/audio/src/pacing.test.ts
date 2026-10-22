import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { productionManifestSchema, type ProductionManifest } from "../../contracts/src/production-manifest.js";
import { appleRateForPace, assertPacedDuration, resolveChunkPacing, validatePacing } from "./pacing.js";
import { prepareNarration } from "./prepare-narration.js";
import { synthesizeNarration } from "./synthesize.js";

async function fixture(): Promise<ProductionManifest> {
  return productionManifestSchema.parse(JSON.parse(await readFile(new URL("../../../fixtures/golden-manifests/whisper-vs-tts.json", import.meta.url), "utf8"))) as ProductionManifest;
}

test("passage pacing survives sentence splitting and takes precedence over scene and project pacing", async () => {
  const manifest = await fixture();
  const scene = manifest.scenes[0]!;
  scene.narration = [{ id: "reviewed-passage", text: "JSON describes the saved plan. This sentence is deliberately slower." }];
  const pacing = { default: 1, scenes: { [scene.id]: 0.9 }, passages: { "reviewed-passage": 0.7 } };
  validatePacing(pacing, manifest);
  const prepared = prepareNarration(manifest, { JSON: "jay son" });
  const resolved = resolveChunkPacing(prepared.manifest, pacing, prepared.originByChunkId);
  const parts = prepared.manifest.scenes[0]!.narration;
  assert.equal(parts.length, 2);
  for (const part of parts) {
    assert.equal(prepared.originByChunkId[part.id], "reviewed-passage");
    assert.equal(resolved[part.id], 0.7);
  }
  assert.match(parts[0]!.spokenText!, /jay son/u);
  assert.equal(resolved[prepared.manifest.scenes[1]!.narration[0]!.id], 1);
  const sceneOnly = resolveChunkPacing(prepared.manifest, { default: 1, scenes: { [scene.id]: 0.9 } }, prepared.originByChunkId);
  assert.equal(sceneOnly[parts[0]!.id], 0.9);
  assert.deepEqual(prepareNarration(manifest).originByChunkId, prepared.originByChunkId);
  validatePacing(pacing, prepared.manifest, prepared.originByChunkId);
});

test("bounded pacing rejects nonfinite values and unknown reviewed IDs", async () => {
  const manifest = await fixture();
  for (const value of [0.64, 1.26, NaN, Infinity]) {
    assert.throws(() => validatePacing({ default: value }), /between 0.65 and 1.25/u);
    assert.throws(() => validatePacing({ default: 1, passages: { passage: value } }), /between 0.65 and 1.25/u);
  }
  assert.throws(() => validatePacing({ default: 1, scenes: { missing: 1 } }, manifest), /Unknown pacing scenes ID/u);
  assert.throws(() => validatePacing({ default: 1, passages: { missing: 1 } }, manifest), /Unknown pacing passages ID/u);
  assert.equal(appleRateForPace(1), 170);
  assert.equal(appleRateForPace(0.65), 111);
  assert.equal(appleRateForPace(1.25), 213);
  manifest.scenes[0]!.id = "constructor";
  manifest.scenes[0]!.narration[0]!.id = "constructor";
  assert.equal(resolveChunkPacing(manifest, { default: 1, scenes: {}, passages: {} }, {}).constructor, 1);
});

test("paced policy accepts measured runtime; strict checks tolerance without changing narration", () => {
  assert.doesNotThrow(() => assertPacedDuration("paced", 25_000, 60_000));
  assert.doesNotThrow(() => assertPacedDuration("strict", 59_000, 60_000));
  assert.throws(() => assertPacedDuration("strict", 58_999, 60_000), /No pacing correction, narration rewrite, speech truncation, or silence padding was performed/u);
});

test("Apple project synthesis obeys explicit rates, reuses chunks, and never retries strict targets", { skip: process.platform !== "darwin" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "paced narration café "));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workDir = join(root, "work");
  await mkdir(workDir);
  const requestedRates: number[] = [];
  const originalSpawn = childProcess.spawnSync;
  childProcess.spawnSync = ((_command: string, args: string[]) => {
    assert.equal(_command, "/usr/bin/say");
    const rate = Number(args[args.indexOf("-r") + 1]);
    requestedRates.push(rate);
    const pcm = Buffer.alloc(Math.round(24_000 * 170 / rate) * 2);
    const wave = Buffer.alloc(44 + pcm.length);
    wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
    wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(24_000, 24); wave.writeUInt32LE(48_000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
    wave.write("data", 36); wave.writeUInt32LE(pcm.length, 40);
    pcm.copy(wave, 44);
    writeFileSync(args[args.indexOf("-o") + 1]!, wave);
    return { status: 0, stdout: "", stderr: "", signal: null, pid: 1, output: [] };
  }) as unknown as typeof childProcess.spawnSync;
  syncBuiltinESMExports();
  context.after(() => { childProcess.spawnSync = originalSpawn; syncBuiltinESMExports(); });

  const manifest = await fixture();
  const scene = manifest.scenes[0]!;
  manifest.scenes = [{ ...scene, narration: [
    { id: "normal", text: "The normal passage." },
    { id: "slower", text: "The slower passage." },
  ] }];
  const options = { manifest, voice: "Samantha", backend: "apple" as const, targetDurationMs: 60_000, workDir, cacheDir: join(root, "cache"), pacing: { default: 1, passages: { slower: 0.8 } } };
  const first = await synthesizeNarration(options);
  assert.deepEqual(requestedRates, [170, 136]);
  assert.equal(first.attempts.length, 1);
  assert.equal(first.synthesisWorkCount, 2);
  assert.deepEqual(first.chunks.map((chunk) => [chunk.pace, chunk.rateWpm]), [[1, 170], [0.8, 136]]);
  assert.ok(first.chunks[1]!.samples > first.chunks[0]!.samples);

  const cached = await synthesizeNarration({ ...options, targetDurationMs: 90_000 });
  assert.equal(cached.synthesisWorkCount, 0);
  assert.equal(cached.cacheStats.hits, 2);
  assert.equal(cached.durationMs, first.durationMs);
  await assert.rejects(() => synthesizeNarration({ ...options, durationPolicy: "strict" }), /Strict project duration requested/u);
  assert.deepEqual(requestedRates, [170, 136]);

  const changed = await synthesizeNarration({ ...options, pacing: { default: 1, passages: { slower: 0.7 } } });
  assert.equal(changed.synthesisWorkCount, 1);
  assert.equal(changed.cacheStats.hits, 1);
  assert.equal(changed.chunks[0]!.samples, first.chunks[0]!.samples);
  assert.ok(changed.durationMs > first.durationMs);
  assert.deepEqual(requestedRates, [170, 136, 119]);

  const { pacing: _pacing, ...legacyOptions } = options;
  await assert.rejects(() => synthesizeNarration(legacyOptions), /after 3 synthesis attempt\(s\) \(rate bounds 130-200 WPM\)/u);
  assert.deepEqual(requestedRates, [170, 136, 119, 130, 130]);
});
