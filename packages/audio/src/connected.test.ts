import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ContentAddressedCache } from "../../assets/src/cache.js";
import type { NarrationChunk, ProductionManifest } from "../../contracts/src/production-manifest.js";
import {
  CONNECTED_CACHE_NAMESPACE, buildConnectedGroups, connectedCacheInput, connectedGroupText, connectedSynthesisBatches,
  decodeConnectedAudio, encodeConnectedAudio, validateConnectedDelivery, validateConnectedGroups,
  type ConnectedDelivery,
} from "./connected.js";
import { kokoroPythonPath, parseConnectedBridgeResult, synthesizeKokoro } from "./kokoro.js";

const delivery: ConnectedDelivery = { mode: "connected", sentencePauseMs: 500, clausePauseMs: 100 };
const chunk = (id: string, text = `${id}.`): NarrationChunk => ({ id, text });
function manifest(scenes: NarrationChunk[][]): ProductionManifest {
  return {
    version: "1", title: "Connected delivery", profile: "preview", targetDurationMs: 60_000, theme: "technical-whiteboard",
    scenes: scenes.map((narration, index) => ({ id: `scene-${index}`, kind: "statement", title: `Scene ${index}`, narration, visual: {} })),
  };
}

test("connected grouping preserves adjacent context, scene boundaries, and explicit pace changes", () => {
  const input = manifest([[chunk("a"), chunk("b"), chunk("c"), chunk("d"), chunk("e")], [chunk("f")]]);
  const groups = buildConnectedGroups(input, { a: 1, b: 1, c: 0.8, d: 1, e: 1, f: 1 });
  assert.deepEqual(groups.map((group) => [group.chunks.map((item) => item.id), group.speed]), [
    [["a", "b"], 1], [["c"], 0.8], [["d", "e"], 1], [["f"], 1],
  ]);
  assert.deepEqual(groups.flatMap((group) => group.chunks), input.scenes.flatMap((scene) => scene.narration));
  assert.equal(connectedGroupText(groups[0]!), "a. b.");
  assert.equal(buildConnectedGroups({ ...input, scenes: [input.scenes[1]!] }, {})[0]!.id, groups[3]!.id);
  assert.deepEqual(buildConnectedGroups(input, { a: 1, b: 1, c: 0.8, d: 1, e: 1, f: 1 }), groups);
});

test("connected groups count pronunciation text and separating spaces against the bridge bound", () => {
  const input = manifest([[
    { id: "a", text: "Displayed abbreviation", spokenText: "x".repeat(800) },
    chunk("b", "y".repeat(799)), chunk("c", "z"), chunk("d", "x".repeat(1_600)),
  ]]);
  const groups = buildConnectedGroups(input, {});
  assert.deepEqual(groups.map((group) => group.chunks.map((item) => item.id)), [["a", "b"], ["c"], ["d"]]);
  assert.equal(connectedGroupText(groups[0]!).length, 1_600);
  assert.throws(() => buildConnectedGroups(manifest([[chunk("a", "x".repeat(1_601))]]), {}), /1 to 1600/u);
  assert.throws(() => buildConnectedGroups(manifest([[chunk("a"), chunk("a")]]), {}), /Duplicate/u);
  for (const speed of [0.64, 1.26, NaN, Infinity]) assert.throws(() => buildConnectedGroups(manifest([[chunk("a")]]), { a: speed }), /pace/u);
});

test("connected bridge batches include joining spaces within the total character bound", () => {
  // Valid narration at the 24,000-character limit gains 32 spaces when grouped.
  const input = manifest(Array.from({ length: 16 }, (_, scene) => Array.from({ length: 3 }, (_, passage) => chunk(`p-${scene}-${passage}`, "x".repeat(500)))));
  const groups = buildConnectedGroups(input, {});
  const batches = connectedSynthesisBatches(groups);
  assert.deepEqual(batches.map((batch) => batch.length), [15, 1]);
  assert.deepEqual(batches.flat(), groups);
  for (const batch of batches) assert.ok(batch.reduce((sum, group) => sum + connectedGroupText(group).length, 0) <= 24_000);
  const differentPaces = connectedSynthesisBatches(groups.map((group, index) => ({ ...group, speed: index % 2 ? 0.8 : 1 })));
  assert.deepEqual(differentPaces.map((batch) => new Set(batch.map((group) => group.speed)).size), [1, 1]);
});

test("connected delivery bounds pauses and rejects duration-correcting legacy requests before runtime access", async () => {
  assert.doesNotThrow(() => validateConnectedDelivery(delivery));
  for (const invalid of [
    { ...delivery, sentencePauseMs: -1 }, { ...delivery, sentencePauseMs: 1_001 },
    { ...delivery, clausePauseMs: 501 }, { ...delivery, clausePauseMs: 1.5 },
    { ...delivery, sentencePauseMs: NaN }, { ...delivery, mode: "unknown" },
  ]) assert.throws(() => validateConnectedDelivery(invalid as ConnectedDelivery), /whole milliseconds/u);
  const input = manifest([[chunk("a"), chunk("b")]]);
  await assert.rejects(() => synthesizeKokoro(input.scenes[0]!.narration, "af_heart", 60_000, "unused", undefined, undefined,
    { delivery, groups: buildConnectedGroups(input, {}) }), /requires explicit project pacing/u);
});

test("connected group coverage rejects omitted, reordered, duplicate, altered, or differently paced passages", () => {
  const input = manifest([[chunk("a"), chunk("b")]]);
  const groups = buildConnectedGroups(input, {});
  const chunks = input.scenes[0]!.narration;
  assert.doesNotThrow(() => validateConnectedGroups(groups, chunks, {}, 1));
  assert.throws(() => validateConnectedGroups([{ ...groups[0]!, chunks: [chunks[0]!] }], chunks, {}, 1), /every narration passage/u);
  for (const changed of [
    { ...groups[0]!, chunks: [...chunks].reverse() },
    { ...groups[0]!, chunks: [chunks[0]!, chunks[0]!] },
    { ...groups[0]!, chunks: [chunk("a", "Changed speech"), chunks[1]!] },
    { ...groups[0]!, speed: 0.9 },
  ]) assert.throws(() => validateConnectedGroups([changed], chunks, {}, 1), /in order at its explicit pacing/u);
});

test("connected cache identity changes with context, pronunciation, pace, pauses, voice, and implementations", () => {
  const cache = new ContentAddressedCache(join(tmpdir(), "unused-connected-key-test"));
  const group = buildConnectedGroups(manifest([[chunk("a"), chunk("b")]]), {})[0]!;
  const identity = { modelSha256: "model", voicesSha256: "voices", bridgeSha256: "bridge", connectedSha256: "grouping", runtime: { python: "test" } };
  const keyFor = (value = group, pauses = delivery, voice = "af_heart", implementation = identity) =>
    cache.key(CONNECTED_CACHE_NAMESPACE, connectedCacheInput(value, pauses, voice, implementation));
  const original = keyFor();
  const changed = [
    keyFor({ ...group, chunks: [...group.chunks].reverse() }),
    keyFor({ ...group, chunks: [group.chunks[0]!] }),
    keyFor({ ...group, chunks: [{ ...group.chunks[0]!, spokenText: "Pronounced differently" }, group.chunks[1]!] }),
    keyFor({ ...group, speed: 0.9 }), keyFor(group, { ...delivery, sentencePauseMs: 400 }),
    keyFor(group, { ...delivery, clausePauseMs: 50 }), keyFor(group, delivery, "af_bella"),
    keyFor(group, delivery, "af_heart", { ...identity, connectedSha256: "changed" }),
    keyFor(group, delivery, "af_heart", { ...identity, bridgeSha256: "changed" }),
  ];
  for (const key of changed) assert.notEqual(key, original);
  // Display copy and soundtrack settings do not enter the spoken-context identity.
  assert.equal(keyFor({ ...group, chunks: group.chunks.map((item) => ({ ...item, text: "Different caption", spokenText: item.text })) }), original);
  assert.equal(keyFor({ ...group, id: "another-scene-group" }), original);
});

test("one connected cache envelope preserves PCM and native counts together and rejects corrupt metadata", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "connected cache café "));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cache = new ContentAddressedCache(root);
  const group = buildConnectedGroups(manifest([[chunk("a"), chunk("b")]]), {})[0]!;
  const audio = { pcm: Buffer.from([1, 0, 2, 0, 3, 0]), passages: [{ id: "a", samples: 1 }, { id: "b", samples: 2 }] };
  const envelope = encodeConnectedAudio(audio, ["a", "b"]);
  const key = cache.key(CONNECTED_CACHE_NAMESPACE, connectedCacheInput(group, delivery, "af_heart", {}));
  let work = 0;
  const create = async () => { work += 1; return envelope; };
  await cache.getOrCreate(key, create);
  const reused = decodeConnectedAudio(await cache.getOrCreate(key, create), ["a", "b"]);
  assert.equal(work, 1);
  assert.deepEqual(reused, audio);
  assert.equal(cache.snapshotStats().hits, 1);
  assert.throws(() => decodeConnectedAudio(envelope, ["b", "a"]), /timing or order/u);
  assert.throws(() => decodeConnectedAudio(envelope.subarray(0, envelope.length - 2), ["a", "b"]), /PCM metadata/u);
  const badHeader = Buffer.from(envelope);
  badHeader.writeUInt32LE(65_537, 8);
  assert.throws(() => decodeConnectedAudio(badHeader, ["a", "b"]), /metadata length/u);
  const badJson = Buffer.from(envelope);
  badJson[12] = 0;
  assert.throws(() => decodeConnectedAudio(badJson, ["a", "b"]), /metadata JSON/u);
  assert.throws(() => encodeConnectedAudio({ ...audio, passages: [{ id: "a", samples: 2 }, { id: "b", samples: 2 }] }, ["a", "b"]), /exactly cover/u);
  assert.throws(() => encodeConnectedAudio({ ...audio, passages: [{ id: "a", samples: 0 }, { id: "b", samples: 3 }] }, ["a", "b"]), /timing or order/u);
});

test("connected bridge metadata must preserve passage order and exactly partition complete group samples", () => {
  const groups = buildConnectedGroups(manifest([[chunk("a"), chunk("b")], [chunk("c")]]), {});
  const payload = { chunks: groups.map((group) => ({
    id: group.id, samples: group.chunks.length * 3, sampleRate: 24_000,
    passages: group.chunks.map((passage) => ({ id: passage.id, samples: 3 })),
  })) };
  const parsed = parseConnectedBridgeResult(JSON.stringify(payload), groups);
  assert.deepEqual(parsed.get(groups[0]!.id), { samples: 6, passages: [{ id: "a", samples: 3 }, { id: "b", samples: 3 }] });
  for (const mutate of [
    (copy: typeof payload) => { copy.chunks.reverse(); },
    (copy: typeof payload) => { copy.chunks[0]!.passages.reverse(); },
    (copy: typeof payload) => { copy.chunks[0]!.passages.pop(); },
    (copy: typeof payload) => { copy.chunks[0]!.passages[0]!.samples = 2; },
    (copy: typeof payload) => { copy.chunks[0]!.samples = 6.5; },
    (copy: typeof payload) => { copy.chunks[0]!.sampleRate = 48_000; },
  ]) {
    const copy = structuredClone(payload);
    mutate(copy);
    assert.throws(() => parseConnectedBridgeResult(JSON.stringify(copy), groups), /Kokoro bridge|connected passage|Connected passage/u);
  }
});

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const hasKokoroAssets = [kokoroPythonPath(repository), ...["kokoro-v1.0.onnx", "voices-v1.0.bin", "provenance.json"].map((name) => join(repository, ".explain-to-me/models/kokoro", name))].every(existsSync);

test("connected adapter caches whole groups with measured boundaries and invalidates only changed pacing", { skip: !hasKokoroAssets }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "connected adapter café "));
  context.after(() => rm(root, { recursive: true, force: true }));
  const originalSpawn = childProcess.spawnSync;
  const calls: { speed: number; text: string; ids: string[] }[] = [];
  childProcess.spawnSync = ((_command: string, args: string[], options: { input?: string }) => {
    assert.equal(_command, kokoroPythonPath(repository));
    let result: unknown;
    if (args.includes("--check")) {
      result = { python: "test", implementation: "test", packages: Object.fromEntries(["kokoro-onnx", "onnxruntime", "numpy", "espeakng-loader", "phonemizer", "soundfile"].map((name) => [name, name === "kokoro-onnx" ? "0.6.1" : "test"])) };
    } else {
      const request = JSON.parse(options.input!) as { speed: number; delivery: ConnectedDelivery; chunks: { id: string; text: string; outputPath: string; passages: { id: string; text: string }[] }[] };
      assert.deepEqual(request.delivery, delivery);
      result = { chunks: request.chunks.map((group) => {
        assert.equal(group.text, group.passages.map((item) => item.text).join(" "));
        calls.push({ speed: request.speed, text: group.text, ids: group.passages.map((item) => item.id) });
        const passages = group.passages.map((item, index) => ({ id: item.id, samples: Math.round((100 + index * 30) / request.speed) }));
        const samples = passages.reduce((total, passage) => total + passage.samples, 0);
        writeFileSync(group.outputPath, Buffer.alloc(samples * 2, calls.length));
        return { id: group.id, samples, sampleRate: 24_000, passages };
      }) };
    }
    return { status: 0, stdout: JSON.stringify(result), stderr: "", signal: null, pid: 1, output: [] };
  }) as unknown as typeof childProcess.spawnSync;
  syncBuiltinESMExports();
  context.after(() => { childProcess.spawnSync = originalSpawn; syncBuiltinESMExports(); });

  const input = manifest([[chunk("a"), chunk("b")], [chunk("c")]]);
  const chunks = input.scenes.flatMap((scene) => scene.narration);
  const workDir = join(root, "work");
  const cacheDir = join(root, "cache");
  const paceByChunkId = { a: 1, b: 1, c: 0.8 };
  const synthesize = (paces = paceByChunkId, policy: "paced" | "strict" = "paced", target = 60_000) => synthesizeKokoro(
    chunks, "af_heart", target, workDir, cacheDir, { policy, defaultPace: 1, paceByChunkId: paces },
    { delivery, groups: buildConnectedGroups(input, paces) },
  );
  const first = await synthesize();
  assert.equal(first.synthesisWorkCount, 2);
  assert.deepEqual(first.chunks.map((item) => [item.id, item.samples, item.pace]), [["a", 100, 1], ["b", 130, 1], ["c", 125, 0.8]]);
  assert.equal(first.provenance.synthesisWorkUnit, "connected-group");
  assert.deepEqual(first.provenance.delivery, delivery);
  const reused = await synthesize(paceByChunkId, "paced", 90_000);
  assert.equal(reused.synthesisWorkCount, 0);
  assert.equal(reused.cacheStats.hits, 2);
  assert.deepEqual(reused.chunks, first.chunks);
  assert.deepEqual(await readFile(reused.pcmPath), await readFile(first.pcmPath));
  const slower = await synthesize({ ...paceByChunkId, c: 0.7 });
  assert.equal(slower.synthesisWorkCount, 1);
  assert.equal(slower.cacheStats.hits, 1);
  assert.deepEqual(slower.chunks.slice(0, 2), first.chunks.slice(0, 2));
  assert.ok(slower.chunks[2]!.samples > first.chunks[2]!.samples);
  assert.ok(slower.durationMs > first.durationMs);
  await assert.rejects(() => synthesize(paceByChunkId, "strict"), /Strict project duration/u);
  assert.deepEqual(calls, [
    { speed: 1, text: "a. b.", ids: ["a", "b"] },
    { speed: 0.8, text: "c.", ids: ["c"] },
    { speed: 0.7, text: "c.", ids: ["c"] },
  ]);
  assert.ok((await readdir(workDir)).every((name) => !name.startsWith("kokoro-")), "owned bridge directories must be removed");
});
