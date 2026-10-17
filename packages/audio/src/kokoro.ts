import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContentAddressedCache, type CacheStats } from "../../assets/src/cache.js";
import type { NarrationChunk } from "../../contracts/src/production-manifest.js";
import { narrationDurationError } from "./duration-error.js";

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
  chunks: { id: string; samples: number }[];
  totalSamples: number;
  durationMs: number;
  attempts: KokoroAttempt[];
  speed: number;
  engine: string;
  cacheStats: CacheStats;
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
): Promise<KokoroOutput> {
  validateChunks(chunks);
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
    environment: {
      platform: process.platform, architecture: process.arch, node: process.version,
      pythonExecutableSha256: pythonSha256, onnxProvider: process.env.ONNX_PROVIDER ?? null,
      lang: process.env.LANG ?? null, lcAll: process.env.LC_ALL ?? null,
      espeakDataPath: process.env.ESPEAK_DATA_PATH ?? null,
    },
  };
  const cache = new ContentAddressedCache(cacheDir ?? join(PROJECT_ROOT, ".explain-to-me/cache/audio"));
  const attempts: KokoroAttempt[] = [];
  let speed = 1;
  let last: Pick<KokoroOutput, "pcmPath" | "chunks" | "totalSamples"> | undefined;
  let durationMs = 0;

  for (let attempt = 1; attempt <= MAX_CORRECTIONS + 1; attempt += 1) {
    const audio = await synthesizeAtSpeed(chunks, voice, speed, workDir, attempt, cache, identity);
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
    provenance,
  };
}

async function synthesizeAtSpeed(
  chunks: NarrationChunk[], voice: string, speed: number, workDir: string, attempt: number,
  cache: ContentAddressedCache, identity: Record<string, unknown>,
): Promise<Pick<KokoroOutput, "pcmPath" | "chunks" | "totalSamples">> {
  const keyed = chunks.map((chunk) => ({
    chunk,
    key: cache.key("kokoro-pcm-chunk-v1", { backend: "kokoro", ...identity, voice, text: spokenText(chunk), speed, sampleRate: SAMPLE_RATE }),
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
      const requests = missing.map((item, index) => ({
        id: item.chunk.id, text: spokenText(item.chunk), outputPath: join(runDir, `chunk-${String(index + 1).padStart(3, "0")}.pcm`),
      }));
      const input = JSON.stringify({ modelPath: MODEL, voicesPath: VOICES, voice, speed, chunks: requests });
      const stdout = runBridge(input);
      const reported = parseBridgeResult(stdout, missing.map((item) => item.chunk.id));
      for (const [index, request] of requests.entries()) {
        const pcm = validatePcm(await readFile(request.outputPath), request.id);
        if (reported.get(request.id) !== pcm.byteLength / 2) throw new Error(`Kokoro returned inconsistent sample count for chunk ${request.id}`);
        await cache.write(missing[index]!.key, pcm);
        audioById.set(request.id, pcm);
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
    measured.push({ id: chunk.id, samples: pcm.byteLength / 2 });
    parts.push(pcm);
  }
  const combined = Buffer.concat(parts);
  await mkdir(workDir, { recursive: true });
  const pcmPath = join(workDir, `narration-kokoro-${randomUUID()}-attempt-${attempt}.pcm`);
  await writeFile(pcmPath, combined);
  return { pcmPath, chunks: measured, totalSamples: combined.byteLength / 2 };
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
