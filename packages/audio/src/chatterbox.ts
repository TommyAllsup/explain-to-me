import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ContentAddressedCache, type CacheStats } from "../../assets/src/cache.js";
import type { NarrationChunk } from "../../contracts/src/production-manifest.js";
import type { AlignedNarrationChunk, NarrationAlignment } from "../../contracts/src/narration-alignment.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BRIDGE = join(ROOT, "services/local-models/claudia_bridge.py");
const ALIGNER = join(ROOT, "services/local-models/claudia_alignment.py");
const MODELS = join(ROOT, "services/local-models/claudia-models.json");
const PROFILE = join(ROOT, "fixtures/presenters/claudia/selected-voice.json");
const RATE = 24_000;
const MAX_PCM = RATE * 120 * 2;
const MAX_TOTAL_SAMPLES = RATE * 900;
const MAX_CACHE_ENTRY = 10 * 1024 * 1024;
const SETUP_HINT = "Run python scripts/setup-claudia.py --help, install the optional local prerequisites, then register them with --register. Builds never download Claudia models.";
const pathSchema = z.string().min(1).max(4096).refine((value) => isAbsolute(value) && !value.includes("\0"), "must be an absolute path");
const runtimeSchema = z.object({
  version: z.literal(1), generationPython: pathSchema, alignmentPython: pathSchema, phonemizerPython: pathSchema,
  modelDirectory: pathSchema, alignmentDirectory: pathSchema, device: z.literal("cuda"),
}).strict();
type Runtime = z.infer<typeof runtimeSchema>;
type RuntimeMetadata = Record<string, unknown>;
type ModelSection = { model: string; revision: string; license: string; package?: string; files: Record<string, { sha256: string; bytes: number }> };
type PinnedModels = { version: 1; chatterbox: ModelSection; alignment: ModelSection };
type VoiceProfile = { voice: string; engine: string; speed: number; referenceAudio: string; referenceSha256: string; synthesis: { package: string; modelRevision: string; seed: number; settings: Record<string, number> } };
type ReadyState = { fingerprint: string; runtime: Runtime; metadata: Record<string, RuntimeMetadata> };
let readyState: ReadyState | undefined;

export function chatterboxConfigPath(): string {
  return resolve(process.env.EXPLAIN_TO_ME_CLAUDIA_CONFIG ?? join(ROOT, ".explain-to-me/models/claudia/runtime.json"));
}

function boundedJsonSync(path: string): unknown {
  if (!statSync(path).isFile() || statSync(path).size > 65_536) throw new Error(`Invalid or excessive metadata file: ${path}`);
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/u, ""));
}

function loadConfiguration(): { runtime: Runtime; models: PinnedModels; profile: VoiceProfile; fingerprint: string } {
  const runtime = runtimeSchema.parse(boundedJsonSync(chatterboxConfigPath()));
  const models = boundedJsonSync(MODELS) as PinnedModels;
  const profile = boundedJsonSync(PROFILE) as VoiceProfile;
  if (profile.voice !== "chatterbox-bella" || profile.engine !== "chatterbox" || profile.speed !== 1
    || profile.synthesis.package !== models.chatterbox.package || profile.synthesis.modelRevision !== models.chatterbox.revision) {
    throw new Error("The selected Claudia profile does not match the pinned Chatterbox runtime");
  }
  const identities = [BRIDGE, ALIGNER, MODELS, PROFILE, resolve(ROOT, profile.referenceAudio), runtime.generationPython, runtime.alignmentPython, runtime.phonemizerPython];
  for (const [section, directory] of [[models.chatterbox, runtime.modelDirectory], [models.alignment, runtime.alignmentDirectory]] as const) {
    for (const [name, record] of Object.entries(section.files)) {
      const path = join(directory, name);
      if (statSync(path).size !== record.bytes) throw new Error(`Pinned Claudia model is missing or has changed: ${path}`);
      identities.push(path);
    }
  }
  const files = identities.map((path) => {
    const info = statSync(path);
    if (!info.isFile() || info.size === 0) throw new Error(`Claudia requires a nonempty file: ${path}`);
    return { path, size: info.size, modified: info.mtimeMs };
  });
  return { runtime, models, profile, fingerprint: sha(Buffer.from(JSON.stringify({ runtime, files }))) };
}

/** Optional readiness: no model downloads and no full model load. */
export function chatterboxReadiness(): { ready: boolean; reason: string } {
  try {
    const state = loadConfiguration();
    if (readyState?.fingerprint !== state.fingerprint) {
      const metadata: Record<string, RuntimeMetadata> = {};
      for (const [mode, python] of [["generation", state.runtime.generationPython], ["alignment", state.runtime.alignmentPython], ["phonemizer", state.runtime.phonemizerPython]] as const) {
        metadata[mode] = JSON.parse(runBridge(python, ["--check", mode], undefined, 60_000));
      }
      readyState = { fingerprint: state.fingerprint, runtime: state.runtime, metadata };
    }
    return { ready: true, reason: "Claudia Chatterbox, CUDA, local acoustic model, and eSpeak imports are ready; model hashes are verified before synthesis." };
  } catch (error) {
    readyState = undefined;
    return { ready: false, reason: `${message(error)}. ${SETUP_HINT}` };
  }
}

export interface ChatterboxOutput {
  pcmPath: string;
  chunks: { id: string; samples: number }[];
  totalSamples: number;
  durationMs: number;
  durationMode: "natural";
  alignment: NarrationAlignment;
  attempts: { attempt: number; speed: number; sampleCount: number; durationMs: number; withinTolerance: boolean }[];
  speed: number;
  engine: string;
  cacheStats: CacheStats;
  synthesisWorkCount: number;
  provenance: Record<string, unknown>;
}

export function validateChatterboxChunks(chunks: NarrationChunk[]): void {
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > 128) throw new Error("Chatterbox requires 1 to 128 narration chunks");
  const ids = new Set<string>();
  let length = 0;
  for (const chunk of chunks) {
    const text = chunk.spokenText ?? chunk.text;
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(chunk.id) || ids.has(chunk.id)) throw new Error("Chatterbox chunk IDs must be unique filesystem-safe identifiers");
    if (typeof text !== "string" || !text.trim() || text.length > 1600 || text.includes("\0")) throw new Error("Chatterbox narration chunks must contain 1 to 1600 characters");
    ids.add(chunk.id);
    length += text.length;
  }
  if (length > 24_000) throw new Error("Chatterbox narration exceeds 24000 characters");
}

const interval = { start: z.number().finite().nonnegative(), end: z.number().finite().positive() };
const alignmentSchema = z.object({
  id: z.string(), text: z.string(), sampleRate: z.literal(24000), samples: z.number().int().positive().max(MAX_PCM / 2),
  pcmSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  words: z.array(z.object({ text: z.string().min(1), ...interval }).strict()).min(1).max(2000),
  phonemes: z.array(z.object({ phoneme: z.string().min(1), ...interval }).strict()).min(1).max(16000),
}).strict();

/** Validate timing and PCM together, including every spoken word. */
export function validateChatterboxAlignment(value: unknown, pcm: Buffer, chunk: { id: string; text: string }): AlignedNarrationChunk {
  const alignment = alignmentSchema.parse(value);
  if (pcm.length < 2 || pcm.length > MAX_PCM || pcm.length % 2 !== 0 || pcm.length !== alignment.samples * 2
    || alignment.id !== chunk.id || alignment.text !== chunk.text || alignment.pcmSha256 !== sha(pcm)) {
    throw new Error(`Chatterbox PCM/alignment identity mismatch for ${chunk.id}`);
  }
  if (alignment.words.map((word) => word.text).join(" ") !== chunk.text.trim().split(/\s+/u).join(" ")) {
    throw new Error(`Chatterbox alignment does not cover the exact spoken words for ${chunk.id}`);
  }
  for (const intervals of [alignment.words, alignment.phonemes]) {
    let previous = 0;
    for (const item of intervals) {
      if (item.start < previous - 0.000001 || item.end <= item.start || item.end > alignment.samples / RATE + 0.000001) {
        throw new Error(`Chatterbox alignment contains invalid or overlapping intervals for ${chunk.id}`);
      }
      previous = item.end;
    }
  }
  return alignment;
}

export function encodeChatterboxCache(pcm: Buffer, alignment: AlignedNarrationChunk): Buffer {
  validateChatterboxAlignment(alignment, pcm, alignment);
  return Buffer.from(JSON.stringify({ version: 1, pcm: pcm.toString("base64"), alignment }));
}

export function decodeChatterboxCache(bytes: Buffer, chunk: { id: string; text: string }): { pcm: Buffer; alignment: AlignedNarrationChunk } {
  if (bytes.length > MAX_CACHE_ENTRY) throw new Error("Excessive Chatterbox cache entry");
  const value = z.object({ version: z.literal(1), pcm: z.string().max(Math.ceil(MAX_PCM / 3) * 4), alignment: z.unknown() }).strict().parse(JSON.parse(bytes.toString("utf8")));
  const pcm = Buffer.from(value.pcm, "base64");
  if (pcm.toString("base64") !== value.pcm) throw new Error("Invalid cached PCM encoding");
  return { pcm, alignment: validateChatterboxAlignment(value.alignment, pcm, chunk) };
}

export async function synthesizeChatterbox(chunks: NarrationChunk[], voice: string, targetDurationMs: number, workDir: string, cacheDir?: string): Promise<ChatterboxOutput> {
  validateChatterboxChunks(chunks);
  if (voice !== "chatterbox-bella") throw new Error("Chatterbox currently supports only Claudia's selected voice: chatterbox-bella");
  const readiness = chatterboxReadiness();
  if (!readiness.ready) throw new Error(`Claudia Chatterbox backend is unavailable: ${readiness.reason}`);
  const { runtime, models, profile } = loadConfiguration();
  // Hash actual files before reading cache, so a changed checkpoint can never
  // reuse audio merely because its provenance file still claims the old hash.
  for (const [section, directory] of [[models.chatterbox, runtime.modelDirectory], [models.alignment, runtime.alignmentDirectory]] as const) {
    for (const [name, record] of Object.entries(section.files)) {
      if (await hashFile(join(directory, name)) !== record.sha256) throw new Error(`Pinned Claudia model hash mismatch: ${name}`);
    }
  }
  const referenceSha256 = await hashFile(resolve(ROOT, profile.referenceAudio));
  if (referenceSha256 !== profile.referenceSha256) throw new Error("The approved Bella reference audio has changed");
  const sourcePaths = [fileURLToPath(import.meta.url), BRIDGE, ALIGNER, MODELS, PROFILE, runtime.generationPython, runtime.alignmentPython, runtime.phonemizerPython];
  const sourceHashes = await Promise.all(sourcePaths.map(hashFile));
  const identity = { models, referenceSha256, sources: sourceHashes, runtime: readyState!.metadata, platform: process.platform, arch: process.arch, settings: profile.synthesis.settings, speed: 1, targetLufs: -18, shortUtteranceRmsDbfs: -21, peakDbfs: -1 };
  const cache = new ContentAddressedCache(cacheDir ?? join(ROOT, ".explain-to-me/cache/audio"));
  let invalidPayloads = 0;
  const items = await Promise.all(chunks.map(async (chunk) => {
    const text = chunk.spokenText ?? chunk.text;
    const seed = (parseInt(sha(Buffer.from(text)).slice(0, 8), 16) + profile.synthesis.seed) >>> 0;
    const request = { id: chunk.id, text, seed };
    const key = cache.key("claudia-pcm-alignment-v1", { identity, ...request });
    const cached = await cache.read(key);
    let audio: ReturnType<typeof decodeChatterboxCache> | undefined;
    if (cached) {
      try { audio = decodeChatterboxCache(cached, request); } catch { invalidPayloads += 1; }
    }
    return { request, key, audio };
  }));
  const missing = items.filter((item) => !item.audio);
  if (missing.length) {
    const directory = resolve(workDir, `claudia-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const request = JSON.stringify({ outputDirectory: directory, chunks: missing.map((item) => item.request) });
    if (Buffer.byteLength(request) > 1_048_576) throw new Error("Excessive Claudia bridge request");
    runBridge(runtime.generationPython, ["--mode", "generate"], request, 30 * 60_000);
    runBridge(runtime.alignmentPython, ["--mode", "align"], request, 30 * 60_000);
    for (const item of missing) {
      const pcm = await boundedRead(join(directory, `chunk-${item.request.id}.pcm`), MAX_PCM);
      const raw = JSON.parse((await boundedRead(join(directory, `chunk-${item.request.id}.alignment.json`), 2 * 1024 * 1024)).toString("utf8"));
      item.audio = { pcm, alignment: validateChatterboxAlignment(raw, pcm, item.request) };
      await cache.write(item.key, encodeChatterboxCache(pcm, item.audio.alignment));
    }
  }
  const totalSamples = items.reduce((sum, item) => sum + item.audio!.alignment.samples, 0);
  if (totalSamples > MAX_TOTAL_SAMPLES) throw new Error("Claudia narration exceeds fifteen minutes");
  const pcmPath = join(workDir, "narration-chatterbox.pcm");
  await mkdir(workDir, { recursive: true });
  await writeFile(pcmPath, Buffer.concat(items.map((item) => item.audio!.pcm)));
  const durationMs = totalSamples / RATE * 1000;
  const stats = cache.snapshotStats();
  return {
    pcmPath, chunks: items.map((item) => ({ id: item.request.id, samples: item.audio!.alignment.samples })), totalSamples, durationMs,
    durationMode: "natural", alignment: { version: 1, chunks: items.map((item) => item.audio!.alignment) },
    attempts: [{ attempt: 1, speed: 1, sampleCount: totalSamples, durationMs, withinTolerance: Math.abs(durationMs - targetDurationMs) <= 1000 }],
    speed: 1, engine: "Chatterbox Original English 500M / chatterbox-tts 0.1.7",
    synthesisWorkCount: missing.length,
    cacheStats: { hits: stats.hits - invalidPayloads, misses: stats.misses + invalidPayloads, writes: stats.writes, corruptions: stats.corruptions + invalidPayloads },
    provenance: { backend: "chatterbox", voice, ...identity, requestedDurationMs: targetDurationMs, measuredDurationMs: durationMs, durationMode: "natural", timing: "Exact delivered PCM; local per-chunk phoneme CTC with contextual eSpeak words", postProcessing: "Float master retained on generation; constant gain to -18 LUFS (under 400ms: -21dBFS RMS), limited to -1 dBFS peak; native Perth watermark retained; no time stretching" },
  };
}

function runBridge(python: string, args: string[], input?: string, timeout = 60_000): string {
  const result = spawnSync(python, [BRIDGE, "--config", chatterboxConfigPath(), ...args], {
    encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, input,
    env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", PYTHONIOENCODING: "utf-8" },
  });
  if (result.error || result.status !== 0) throw new Error(`Claudia ${args.join(" ")} failed: ${result.error?.message ?? result.stderr?.slice(-6000) ?? `exit ${result.status}`}`);
  if (Buffer.byteLength(result.stdout) > 1_048_576) throw new Error("Excessive Claudia bridge output");
  return result.stdout;
}

async function boundedRead(path: string, maximum: number): Promise<Buffer> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > maximum) throw new Error(`Invalid or excessive Claudia output: ${path}`);
  return readFile(path);
}
function sha(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const block of createReadStream(path)) digest.update(block);
  return digest.digest("hex");
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
