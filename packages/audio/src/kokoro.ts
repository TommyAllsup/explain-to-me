import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentAddressedCache, type CacheStats } from "../../assets/src/cache.js";
import type { NarrationChunk } from "../../contracts/src/production-manifest.js";
import { narrationDurationError } from "./duration-error.js";
import { assertPacedDuration, type DurationPolicy } from "./pacing.js";
import {
  CONNECTED_CACHE_NAMESPACE, CONNECTED_GROUPING_POLICY, connectedCacheInput, connectedGroupText, connectedSpokenText, connectedSynthesisBatches,
  decodeConnectedAudio, encodeConnectedAudio, validateConnectedDelivery, validateConnectedGroups, validatePassageTimings,
  type ConnectedAudio, type ConnectedDelivery, type ConnectedGroup, type ConnectedPassageTiming,
} from "./connected.js";

const SAMPLE_RATE = 24_000;
const MIN_SPEED = 0.8;
const MAX_SPEED = 1.25;
const DURATION_TOLERANCE_MS = 1_000;
const MAX_CORRECTIONS = 2;
const MAX_CHUNKS = 128;
const MAX_CHUNK_CHARS = 1_600;
const MAX_TOTAL_CHARS = 24_000;
const RUNTIME_VERSION = "0.6.1";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export function kokoroPythonPath(root = PROJECT_ROOT, platform: NodeJS.Platform = process.platform): string {
  return join(root, ".venv-kokoro", ...(platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));
}

const PYTHON = kokoroPythonPath();
const MODEL = join(PROJECT_ROOT, ".explain-to-me/models/kokoro/kokoro-v1.0.onnx");
const VOICES = join(PROJECT_ROOT, ".explain-to-me/models/kokoro/voices-v1.0.bin");
const PROVENANCE = join(PROJECT_ROOT, ".explain-to-me/models/kokoro/provenance.json");
const BRIDGE = join(PROJECT_ROOT, "services/local-models/kokoro_synthesize.py");

export interface KokoroAttempt {
  attempt: number;
  speed: number;
  sampleCount: number;
  durationMs: number;
  withinTolerance: boolean;
}

export interface KokoroOutput {
  pcmPath: string;
  chunks: { id: string; samples: number; speed?: number; pace?: number }[];
  totalSamples: number;
  durationMs: number;
  attempts: KokoroAttempt[];
  speed: number;
  engine: string;
  cacheStats: CacheStats;
  synthesisWorkCount: number;
  provenance: Record<string, unknown>;
}

interface RuntimeMetadata {
  python: string;
  implementation: string;
  packages: Record<string, string>;
}

let runtimeMetadata: RuntimeMetadata | undefined;

export function kokoroReadiness(): { ready: boolean; reason: string } {
  for (const [label, path] of [
    ["Python environment", PYTHON], ["Kokoro ONNX model", MODEL], ["Kokoro voice pack", VOICES],
    ["Kokoro provenance manifest", PROVENANCE], ["Kokoro synthesis bridge", BRIDGE],
  ] as const) {
    if (!existsSync(path)) return { ready: false, reason: `${label} is missing at ${path}` };
    try {
      const file = statSync(path);
      if (!file.isFile() || file.size === 0) return { ready: false, reason: `${label} is not a non-empty file at ${path}` };
    } catch (error) {
      return { ready: false, reason: `${label} could not be checked: ${message(error)}` };
    }
  }

  const result = spawnSync(PYTHON, [BRIDGE, "--check"], { encoding: "utf8", timeout: 30_000, maxBuffer: 128 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? (result.stderr || `exit status ${result.status}`).trim();
    return { ready: false, reason: `Kokoro Python environment is not ready: ${reason}` };
  }
  try {
    const parsed = JSON.parse(result.stdout) as RuntimeMetadata;
    if (parsed.packages?.["kokoro-onnx"] !== RUNTIME_VERSION) {
      return { ready: false, reason: `Kokoro requires kokoro-onnx ${RUNTIME_VERSION}; found ${parsed.packages?.["kokoro-onnx"] ?? "unknown"}` };
    }
    for (const name of ["onnxruntime", "numpy", "espeakng-loader", "phonemizer", "soundfile"]) {
      if (!parsed.packages[name]) return { ready: false, reason: `Kokoro Python dependency ${name} is missing` };
    }
    runtimeMetadata = parsed;
    return { ready: true, reason: "Kokoro assets, Python imports, and phonemization are ready" };
  } catch (error) {
    return { ready: false, reason: `Kokoro Python environment returned invalid metadata: ${message(error)}` };
  }
}

/** Doctor/setup check: load the model and synthesize a short, disposable PCM sample. */
export function kokoroSmokeCheck(): { ready: boolean; reason: string } {
  const readiness = kokoroReadiness();
  if (!readiness.ready) return readiness;
  const result = spawnSync(PYTHON, [BRIDGE, "--smoke"], {
    encoding: "utf8", timeout: 120_000, maxBuffer: 128 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return { ready: false, reason: `Kokoro synthesis smoke test failed: ${result.error?.message ?? (result.stderr || `exit status ${result.status}`).trim()}` };
  }
  try {
    const output: unknown = JSON.parse(result.stdout);
    if (!isRecord(output) || output.sampleRate !== SAMPLE_RATE || !Number.isSafeInteger(output.samples) || (output.samples as number) < 1 || (output.samples as number) > SAMPLE_RATE * 15) {
      throw new Error("invalid sample metadata");
    }
    return { ready: true, reason: `Kokoro synthesized ${output.samples} samples at ${SAMPLE_RATE} Hz` };
  } catch (error) {
    return { ready: false, reason: `Kokoro synthesis smoke test returned invalid output: ${message(error)}` };
  }
}

export async function synthesizeKokoro(
  chunks: NarrationChunk[], voice: string, targetDurationMs: number, workDir: string, cacheDir?: string,
  pacedRequest?: { policy: DurationPolicy; defaultPace: number; paceByChunkId: Record<string, number> },
  connected?: { delivery: ConnectedDelivery; groups: ConnectedGroup[] },
): Promise<KokoroOutput> {
  validateChunks(chunks);
  if (connected) {
    if (!pacedRequest) throw new Error("Connected delivery requires explicit project pacing; legacy duration correction is unchanged");
    validateConnectedDelivery(connected.delivery);
    validateConnectedGroups(connected.groups, chunks, pacedRequest.paceByChunkId, pacedRequest.defaultPace);
  }
  const runtime = runtimeMetadata ?? readRuntimeMetadata();
  const [modelSha256, voicesSha256, pythonSha256, adapterSha256, bridgeSha256] = await Promise.all([
    hashFile(MODEL), hashFile(VOICES), hashFile(PYTHON), hashFile(fileURLToPath(import.meta.url)), hashFile(BRIDGE),
  ]);
  const modelProvenance = parseProvenance(await readFile(PROVENANCE, "utf8"));
  const provenance = {
    ...modelProvenance,
    backend: "kokoro",
    engine: `kokoro-onnx ${runtime.packages["kokoro-onnx"]}`,
    modelSha256,
    voicesSha256,
    runtime,
  };
  const identity = {
    modelSha256, voicesSha256, runtime, adapterSha256, bridgeSha256,
    ...(connected ? { connectedSha256: await hashFile(fileURLToPath(new URL("./connected.ts", import.meta.url))) } : {}),
    environment: {
      platform: process.platform, architecture: process.arch, node: process.version,
      pythonExecutableSha256: pythonSha256, onnxProvider: process.env.ONNX_PROVIDER ?? null,
      lang: process.env.LANG ?? null, lcAll: process.env.LC_ALL ?? null,
      espeakDataPath: process.env.ESPEAK_DATA_PATH ?? null,
    },
  };
  const cache = new ContentAddressedCache(cacheDir ?? join(PROJECT_ROOT, ".explain-to-me/cache/audio"));
  if (pacedRequest) {
    const output = connected
      ? await synthesizeConnected(connected.groups, connected.delivery, voice, workDir, cache, identity)
      : await synthesizeAtSpeed(chunks, voice, pacedRequest.defaultPace, workDir, 1, cache, identity, pacedRequest.paceByChunkId);
    const durationMs = output.totalSamples / SAMPLE_RATE * 1_000;
    assertPacedDuration(pacedRequest.policy, durationMs, targetDurationMs);
    return {
      ...output, durationMs, speed: pacedRequest.defaultPace,
      attempts: [{ attempt: 1, speed: pacedRequest.defaultPace, sampleCount: output.totalSamples, durationMs, withinTolerance: Math.abs(durationMs - targetDurationMs) <= DURATION_TOLERANCE_MS }],
      engine: `kokoro-onnx ${runtime.packages["kokoro-onnx"]}`, cacheStats: cache.snapshotStats(),
      provenance: {
        ...provenance, durationPolicy: pacedRequest.policy, paceByChunkId: pacedRequest.paceByChunkId,
        ...(connected ? {
          delivery: connected.delivery, groupingPolicy: CONNECTED_GROUPING_POLICY,
          timingMethod: "kokoro-native-phoneme-start-boundaries", synthesisWorkUnit: "connected-group",
          groups: connected.groups.map((group) => ({
            id: group.id, passageIds: group.chunks.map((chunk) => chunk.id), speed: group.speed,
            samples: output.chunks.filter((chunk) => group.chunks.some((passage) => passage.id === chunk.id)).reduce((sum, chunk) => sum + chunk.samples, 0),
          })),
        } : {}),
      },
    };
  }
  const attempts: KokoroAttempt[] = [];
  let speed = 1;
  let last: Pick<KokoroOutput, "pcmPath" | "chunks" | "totalSamples" | "synthesisWorkCount"> | undefined;
  let durationMs = 0;
  let synthesisWorkCount = 0;

  for (let attempt = 1; attempt <= MAX_CORRECTIONS + 1; attempt += 1) {
    const audio = await synthesizeAtSpeed(chunks, voice, speed, workDir, attempt, cache, identity);
    synthesisWorkCount += audio.synthesisWorkCount;
    durationMs = audio.totalSamples / SAMPLE_RATE * 1_000;
    const withinTolerance = Math.abs(durationMs - targetDurationMs) <= DURATION_TOLERANCE_MS;
    attempts.push({ attempt, speed, sampleCount: audio.totalSamples, durationMs, withinTolerance });
    last = audio;
    if (withinTolerance || attempt === MAX_CORRECTIONS + 1) break;
    const nextSpeed = clampSpeed(speed * durationMs / targetDurationMs);
    if (nextSpeed === speed) break;
    speed = nextSpeed;
  }
  if (!last || !attempts.at(-1)?.withinTolerance) {
    const measured = attempts.map((item) => `speed ${item.speed.toFixed(3)} → ${(item.durationMs / 1_000).toFixed(3)}s`).join(", ");
    throw narrationDurationError(`Kokoro narration could not reach ${(targetDurationMs / 1_000).toFixed(3)}s within ±1.000s after ${attempts.length} attempt(s) (speed bounds ${MIN_SPEED}-${MAX_SPEED}). Measured: ${measured}`);
  }
  return {
    ...last,
    durationMs,
    attempts,
    speed: attempts.at(-1)!.speed,
    engine: `kokoro-onnx ${runtime.packages["kokoro-onnx"]}`,
    cacheStats: cache.snapshotStats(),
    synthesisWorkCount,
    provenance,
  };
}

async function synthesizeConnected(
  groups: ConnectedGroup[], delivery: ConnectedDelivery, voice: string, workDir: string,
  cache: ContentAddressedCache, identity: Record<string, unknown>,
): Promise<Pick<KokoroOutput, "pcmPath" | "chunks" | "totalSamples" | "synthesisWorkCount">> {
  const keyed = groups.map((group) => ({ group, key: cache.key(CONNECTED_CACHE_NAMESPACE, connectedCacheInput(group, delivery, voice, identity)) }));
  const loaded = await Promise.all(keyed.map(async (item) => ({ ...item, envelope: await cache.read(item.key) })));
  const missing = loaded.filter((item) => item.envelope === null);
  const audioByGroup = new Map<string, ConnectedAudio>();
  for (const item of loaded) {
    if (item.envelope !== null) audioByGroup.set(item.group.id, decodeConnectedAudio(item.envelope, item.group.chunks.map((chunk) => chunk.id)));
  }

  if (missing.length > 0) {
    await mkdir(workDir, { recursive: true });
    const runDir = join(workDir, `kokoro-${randomUUID()}`);
    await mkdir(runDir);
    try {
      let outputIndex = 0;
      const missingById = new Map(missing.map((item) => [item.group.id, item]));
      for (const batchGroups of connectedSynthesisBatches(missing.map((item) => item.group))) {
        const speed = batchGroups[0]!.speed;
        const batch = batchGroups.map((group) => missingById.get(group.id)!);
        const requests = batch.map(({ group }) => ({
          id: group.id, text: connectedGroupText(group),
          outputPath: join(runDir, `group-${String(++outputIndex).padStart(3, "0")}.pcm`),
          passages: group.chunks.map((chunk) => ({ id: chunk.id, text: connectedSpokenText(chunk) })),
        }));
        const stdout = runBridge(JSON.stringify({ modelPath: MODEL, voicesPath: VOICES, voice, speed, delivery, chunks: requests }));
        const reported = parseConnectedBridgeResult(stdout, batch.map((item) => item.group));
        for (const [index, request] of requests.entries()) {
          const pcm = validatePcm(await readFile(request.outputPath), request.id);
          const report = reported.get(request.id)!;
          if (report.samples !== pcm.byteLength / 2) throw new Error(`Kokoro returned inconsistent sample count for connected group ${request.id}`);
          const audio = { pcm, passages: report.passages };
          await cache.write(batch[index]!.key, encodeConnectedAudio(audio, request.passages.map((passage) => passage.id)));
          audioByGroup.set(request.id, audio);
        }
      }
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }

  const measured: KokoroOutput["chunks"] = [];
  const parts: Buffer[] = [];
  for (const group of groups) {
    const audio = audioByGroup.get(group.id);
    if (!audio) throw new Error(`Kokoro did not return audio for connected group ${group.id}`);
    // Preserve contiguous model audio byte-for-byte; measured boundaries only assign
    // its samples to original passage IDs for timelines and captions.
    parts.push(audio.pcm);
    measured.push(...audio.passages.map((passage) => ({ ...passage, speed: group.speed, pace: group.speed })));
  }
  const combined = Buffer.concat(parts);
  await mkdir(workDir, { recursive: true });
  const pcmPath = join(workDir, `narration-kokoro-${randomUUID()}-connected.pcm`);
  await writeFile(pcmPath, combined);
  return { pcmPath, chunks: measured, totalSamples: combined.byteLength / 2, synthesisWorkCount: missing.length };
}

export function parseConnectedBridgeResult(stdout: string, expectedGroups: ConnectedGroup[]): Map<string, { samples: number; passages: ConnectedPassageTiming[] }> {
  let payload: unknown;
  try { payload = JSON.parse(stdout); } catch (error) { throw new Error(`Kokoro bridge returned invalid JSON: ${message(error)}`); }
  if (!isRecord(payload) || !Array.isArray(payload.chunks) || payload.chunks.length !== expectedGroups.length) throw new Error("Kokoro bridge returned invalid connected group coverage");
  const result = new Map<string, { samples: number; passages: ConnectedPassageTiming[] }>();
  for (const [index, item] of payload.chunks.entries()) {
    const group = expectedGroups[index]!;
    if (!isRecord(item) || item.id !== group.id || result.has(group.id) || item.sampleRate !== SAMPLE_RATE
      || !Number.isSafeInteger(item.samples) || (item.samples as number) < 1) throw new Error("Kokoro bridge returned invalid connected group metadata or order");
    result.set(group.id, {
      samples: item.samples as number,
      passages: validatePassageTimings(item.passages, group.chunks.map((chunk) => chunk.id), item.samples as number),
    });
  }
  return result;
}

async function synthesizeAtSpeed(
  chunks: NarrationChunk[], voice: string, speed: number, workDir: string, attempt: number,
  cache: ContentAddressedCache, identity: Record<string, unknown>,
  paceByChunkId?: Record<string, number>,
): Promise<Pick<KokoroOutput, "pcmPath" | "chunks" | "totalSamples" | "synthesisWorkCount">> {
  const keyed = chunks.map((chunk) => ({
    chunk,
    speed: paceByChunkId?.[chunk.id] ?? speed,
    key: cache.key("kokoro-pcm-chunk-v1", { backend: "kokoro", ...identity, voice, text: spokenText(chunk), speed: paceByChunkId?.[chunk.id] ?? speed, sampleRate: SAMPLE_RATE }),
  }));
  const loaded = await Promise.all(keyed.map(async (item) => ({ ...item, pcm: await cache.read(item.key) })));
  const missing = loaded.filter((item) => item.pcm === null);
  const audioById = new Map<string, Buffer>();
  for (const item of loaded) if (item.pcm !== null) audioById.set(item.chunk.id, validatePcm(item.pcm, item.chunk.id));

  if (missing.length > 0) {
    await mkdir(workDir, { recursive: true });
    const runDir = join(workDir, `kokoro-${randomUUID()}`);
    await mkdir(runDir);
    try {
      // The existing bridge accepts one speed per batch. Group only uncached chunks,
      // then restore reviewed order when concatenating; no PCM time stretching.
      let outputIndex = 0;
      for (const batchSpeed of new Set(missing.map((item) => item.speed))) {
        const batch = missing.filter((item) => item.speed === batchSpeed);
        const requests = batch.map((item) => ({
          id: item.chunk.id, text: spokenText(item.chunk), outputPath: join(runDir, `chunk-${String(++outputIndex).padStart(3, "0")}.pcm`),
        }));
        const input = JSON.stringify({ modelPath: MODEL, voicesPath: VOICES, voice, speed: batchSpeed, chunks: requests });
        const stdout = runBridge(input);
        const reported = parseBridgeResult(stdout, batch.map((item) => item.chunk.id));
        for (const [index, request] of requests.entries()) {
          const pcm = validatePcm(await readFile(request.outputPath), request.id);
          if (reported.get(request.id) !== pcm.byteLength / 2) throw new Error(`Kokoro returned inconsistent sample count for chunk ${request.id}`);
          await cache.write(batch[index]!.key, pcm);
          audioById.set(request.id, pcm);
        }
      }
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }

  const measured: KokoroOutput["chunks"] = [];
  const parts: Buffer[] = [];
  for (const chunk of chunks) {
    const pcm = audioById.get(chunk.id);
    if (!pcm) throw new Error(`Kokoro did not return audio for chunk ${chunk.id}`);
    const pace = paceByChunkId?.[chunk.id];
    measured.push({ id: chunk.id, samples: pcm.byteLength / 2, speed: pace ?? speed, ...(pace === undefined ? {} : { pace }) });
    parts.push(pcm);
  }
  const combined = Buffer.concat(parts);
  await mkdir(workDir, { recursive: true });
  const pcmPath = join(workDir, `narration-kokoro-${randomUUID()}-attempt-${attempt}.pcm`);
  await writeFile(pcmPath, combined);
  return { pcmPath, chunks: measured, totalSamples: combined.byteLength / 2, synthesisWorkCount: missing.length };
}

function runBridge(input: string): string {
  const result = spawnSync(PYTHON, [BRIDGE], { encoding: "utf8", input, timeout: 600_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.error) throw new Error(`Kokoro bridge could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Kokoro bridge exited with status ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout ?? "";
}

function readRuntimeMetadata(): RuntimeMetadata {
  const readiness = kokoroReadiness();
  if (!readiness.ready || !runtimeMetadata) throw new Error(`Kokoro Python environment is not ready: ${readiness.reason}`);
  return runtimeMetadata;
}

function validateChunks(chunks: NarrationChunk[]): void {
  if (chunks.length < 1 || chunks.length > MAX_CHUNKS) throw new Error(`Kokoro supports 1 to ${MAX_CHUNKS} narration chunks`);
  let total = 0;
  for (const chunk of chunks) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(chunk.id)) throw new Error(`Invalid Kokoro narration chunk id: ${chunk.id}`);
    const text = spokenText(chunk);
    if (!text.trim() || text.length > MAX_CHUNK_CHARS) throw new Error(`Kokoro chunk ${chunk.id} must contain 1 to ${MAX_CHUNK_CHARS} spoken characters`);
    total += text.length;
  }
  if (total > MAX_TOTAL_CHARS) throw new Error(`Kokoro narration exceeds ${MAX_TOTAL_CHARS} total characters`);
}

function spokenText(chunk: NarrationChunk): string {
  return chunk.spokenText ?? chunk.text;
}

function parseBridgeResult(stdout: string, expectedIds: string[]): Map<string, number> {
  let payload: unknown;
  try { payload = JSON.parse(stdout); } catch (error) { throw new Error(`Kokoro bridge returned invalid JSON: ${message(error)}`); }
  if (!isRecord(payload) || !Array.isArray(payload.chunks) || payload.chunks.length !== expectedIds.length) {
    throw new Error("Kokoro bridge returned an invalid chunk result");
  }
  const result = new Map<string, number>();
  for (const item of payload.chunks) {
    if (!isRecord(item) || typeof item.id !== "string" || !expectedIds.includes(item.id) || result.has(item.id)) {
      throw new Error("Kokoro bridge returned an unexpected or duplicate chunk id");
    }
    if (!Number.isSafeInteger(item.samples) || (item.samples as number) < 1 || item.sampleRate !== SAMPLE_RATE) {
      throw new Error(`Kokoro bridge returned invalid PCM metadata for chunk ${item.id}`);
    }
    result.set(item.id, item.samples as number);
  }
  return result;
}

function parseProvenance(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("Kokoro provenance manifest must contain a JSON object");
  return value;
}

function validatePcm(pcm: Buffer, id: string): Buffer {
  if (pcm.length < 2 || pcm.length % 2 !== 0) throw new Error(`Invalid signed 16-bit PCM for narration chunk ${id}`);
  return pcm;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function clampSpeed(speed: number): number {
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, Number(speed.toFixed(3))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
