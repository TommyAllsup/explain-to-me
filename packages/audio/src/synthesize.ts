import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { release } from "node:os";
import { fileURLToPath } from "node:url";
import { ContentAddressedCache, type CacheStats } from "../../assets/src/cache.js";
import type { ProductionManifest } from "../../contracts/src/production-manifest.js";
import { normalizeTokens } from "../../contracts/src/production-manifest.js";
import { kokoroReadiness, synthesizeKokoro } from "./kokoro.js";
import { chatterboxReadiness, synthesizeChatterbox } from "./chatterbox.js";
import type { NarrationAlignment } from "../../contracts/src/narration-alignment.js";
import { narrationDurationError } from "./duration-error.js";
export { kokoroReadiness, kokoroSmokeCheck } from "./kokoro.js";
export { chatterboxReadiness } from "./chatterbox.js";

export const PCM_SAMPLE_RATE = 24_000;
export const PCM_CHANNELS = 1;
export const MIN_RATE_WPM = 130;
export const MAX_RATE_WPM = 200;
export const MAX_DURATION_CORRECTIONS = 2;
export const DURATION_TOLERANCE_MS = 1_000;

export interface SpeechRateAttempt {
  attempt: number;
  rateWpm?: number;
  speed?: number;
  sampleCount: number;
  durationMs: number;
  withinTolerance: boolean;
}

export interface SynthesizedChunk {
  id: string;
  samples: number;
}

export interface NarrationSynthesis {
  pcmPath: string;
  chunks: SynthesizedChunk[];
  sampleRate: number;
  channels: number;
  totalSamples: number;
  durationMs: number;
  voice: string;
  backend: "apple" | "kokoro" | "chatterbox";
  alignment?: NarrationAlignment;
  durationMode?: "natural";
  engine: string;
  warnings: string[];
  cacheStats: CacheStats;
  provenance: Record<string, unknown>;
  finalRateWpm?: number;
  speed?: number;
  attempts: SpeechRateAttempt[];
}

export interface SynthesisOptions {
  manifest: ProductionManifest;
  voice: string;
  targetDurationMs: number;
  workDir: string;
  backend?: "apple" | "kokoro" | "chatterbox" | "auto";
  cacheDir?: string;
}

interface SynthesisOutput {
  cacheStats?: CacheStats;
  pcmPath: string;
  chunks: SynthesizedChunk[];
  totalSamples: number;
  durationMs: number;
  attempts: SpeechRateAttempt[];
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SAY_EXECUTABLE = "/usr/bin/say";

const narrationItems = (manifest: ProductionManifest) => manifest.scenes.flatMap((scene) => scene.narration);
const spokenText = (chunk: ReturnType<typeof narrationItems>[number]) => chunk.spokenText ?? chunk.text;

export function selectNarrationBackend(
  requested: "auto" | "apple" | "kokoro" | "chatterbox" = "auto",
  options: { platform?: NodeJS.Platform; kokoro?: { ready: boolean; reason: string }; chatterbox?: { ready: boolean; reason: string } } = {},
): { backend: "apple" | "kokoro" | "chatterbox"; warnings: string[] } {
  const platform = options.platform ?? process.platform;
  if (requested === "chatterbox") {
    const readiness = options.chatterbox ?? chatterboxReadiness();
    if (!readiness.ready) throw new Error(`Claudia Chatterbox backend is unavailable: ${readiness.reason}`);
    return { backend: "chatterbox", warnings: [] };
  }
  if (requested === "apple") {
    if (platform !== "darwin") throw new Error("Apple narration requires macOS. Use --tts kokoro or --tts auto on Windows.");
    return { backend: "apple", warnings: [] };
  }
  const readiness = options.kokoro ?? kokoroReadiness();
  if (readiness.ready) return { backend: "kokoro", warnings: [] };
  if (requested === "auto" && platform === "darwin") {
    return { backend: "apple", warnings: [`Kokoro is unavailable; using Apple say. ${readiness.reason}`] };
  }
  const setupCommand = platform === "win32" ? "node scripts/setup.mjs" : "python3 scripts/setup-kokoro.py";
  throw new Error(`Kokoro backend is unavailable: ${readiness.reason}. Run ${setupCommand} during setup, then retry.`);
}

export async function synthesizeNarration(options: SynthesisOptions): Promise<NarrationSynthesis> {
  const chunks = narrationItems(options.manifest);
  const wordCount = chunks.reduce((total, chunk) => total + normalizeTokens(spokenText(chunk)).length, 0);
  if (wordCount === 0) throw new Error("Cannot synthesize an empty narration script");
  if (!Number.isFinite(options.targetDurationMs) || options.targetDurationMs <= 0) {
    throw new Error("Target duration must be a positive number of milliseconds");
  }

  const { backend, warnings } = selectNarrationBackend(options.backend ?? (process.platform === "darwin" ? "apple" : "auto"));

  let requestedVoice = options.voice;
  if (backend === "apple" && requestedVoice !== "auto" && /^(af|am|bf|bm)_/u.test(requestedVoice) && options.backend === "auto") {
    warnings.push(`Voice ${requestedVoice} is a Kokoro voice; using Samantha for the Apple fallback.`);
    requestedVoice = "Samantha";
  }
  const voice = resolveVoice(requestedVoice, backend);
  if (backend === "chatterbox") {
    const output = await synthesizeChatterbox(chunks, voice, options.targetDurationMs, options.workDir, options.cacheDir);
    return {
      ...output, sampleRate: PCM_SAMPLE_RATE, channels: PCM_CHANNELS, voice, backend,
      warnings: [...warnings, `Chatterbox preserves natural delivery. Requested duration ${(options.targetDurationMs / 1000).toFixed(3)}s is advisory; measured speech is ${(output.durationMs / 1000).toFixed(3)}s.`],
    };
  }
  if (backend === "kokoro") {
    const output = await synthesizeKokoro(chunks, voice, options.targetDurationMs, options.workDir, options.cacheDir);
    return {
      ...output,
      sampleRate: PCM_SAMPLE_RATE,
      channels: PCM_CHANNELS,
      voice,
      backend,
      engine: output.engine,
      warnings,
    };
  }

  const appleOutput = await synthesizeApple(chunks, voice, options.targetDurationMs, options.workDir, options.cacheDir);
  return {
    ...appleOutput,
    sampleRate: PCM_SAMPLE_RATE,
    channels: PCM_CHANNELS,
    voice,
    backend,
    engine: "macOS say",
    warnings,
    cacheStats: appleOutput.cacheStats ?? { hits: 0, misses: 0, writes: 0, corruptions: 0 },
    provenance: { backend: "apple", engine: "macOS say", executable: SAY_EXECUTABLE, voice, sampleRate: PCM_SAMPLE_RATE },
    finalRateWpm: appleOutput.attempts.at(-1)!.rateWpm!,
  };
}

export async function writeWavFromPcm(pcmPath: string, wavPath: string): Promise<void> {
  runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "s16le", "-ar", String(PCM_SAMPLE_RATE), "-ac", String(PCM_CHANNELS),
    "-i", pcmPath, "-c:a", "pcm_s16le", "-f", "wav", wavPath,
  ]);
}

export function extractPcmDataFromWav(wave: Buffer): Buffer {
  if (wave.toString("ascii", 0, 4) !== "RIFF" || wave.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Apple say output is not a RIFF/WAVE file");
  }
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let bitsPerSample: number | undefined;
  let formatCode: number | undefined;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wave.byteLength;) {
    const name = wave.toString("ascii", offset, offset + 4);
    const size = wave.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + size;
    if (chunkEnd > wave.byteLength) throw new Error(`Apple say returned a truncated WAVE ${name} chunk`);
    if (name === "fmt " && size >= 16) {
      formatCode = wave.readUInt16LE(chunkStart);
      channels = wave.readUInt16LE(chunkStart + 2);
      sampleRate = wave.readUInt32LE(chunkStart + 4);
      bitsPerSample = wave.readUInt16LE(chunkStart + 14);
    } else if (name === "data") {
      data = wave.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (size % 2);
  }
  if (formatCode !== 1 || channels !== PCM_CHANNELS || sampleRate !== PCM_SAMPLE_RATE || bitsPerSample !== 16) {
    throw new Error(`Apple say must return signed 16-bit PCM at ${PCM_SAMPLE_RATE} Hz mono; received ${formatCode ?? "unknown"}/${bitsPerSample ?? "unknown"}-bit/${channels ?? "unknown"}ch/${sampleRate ?? "unknown"}Hz`);
  }
  if (!data || data.byteLength < 2 || data.byteLength % 2 !== 0) {
    throw new Error("Apple say returned an empty or invalid PCM data chunk");
  }
  return data;
}

export function runProcess(command: string, args: string[], timeoutMs = 120_000, input?: string): string {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, input, windowsHide: true });
  if (result.error) throw new Error(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const diagnostic = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${command} exited with status ${result.status}${diagnostic ? `: ${diagnostic}` : ""}`);
  }
  return result.stdout ?? "";
}

async function synthesizeApple(
  chunks: ReturnType<typeof narrationItems>,
  voice: string,
  targetDurationMs: number,
  workDir: string,
  cacheDir?: string,
): Promise<SynthesisOutput> {
  const cache = new ContentAddressedCache(cacheDir ?? join(PROJECT_ROOT, ".explain-to-me/cache"));
  const identity = {
    adapterSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
    saySha256: createHash("sha256").update(await readFile(SAY_EXECUTABLE)).digest("hex"),
    platform: process.platform, arch: process.arch, node: process.version, osRelease: release(),
  };
  const wordCount = chunks.reduce((total, chunk) => total + normalizeTokens(spokenText(chunk)).length, 0);
  let rateWpm = clampRate(Math.round((wordCount * 60_000) / targetDurationMs));
  const attempts: SpeechRateAttempt[] = [];
  let lastOutput: Omit<SynthesisOutput, "attempts" | "durationMs"> | undefined;
  let durationMs = 0;

  for (let attempt = 1; attempt <= MAX_DURATION_CORRECTIONS + 1; attempt += 1) {
    const attemptResult = await synthesizeAppleAtRate(chunks, voice, rateWpm, workDir, attempt, cache, identity);
    durationMs = (attemptResult.totalSamples / PCM_SAMPLE_RATE) * 1_000;
    const withinTolerance = Math.abs(durationMs - targetDurationMs) <= DURATION_TOLERANCE_MS;
    attempts.push({ attempt, rateWpm, sampleCount: attemptResult.totalSamples, durationMs, withinTolerance });
    lastOutput = attemptResult;
    if (withinTolerance || attempt === MAX_DURATION_CORRECTIONS + 1) break;

    const previous = attempts.at(-2);
    // Apple voices can quantize rate requests; escape byte-identical plateaus without another retry.
    const onPlateau = previous !== undefined && previous.sampleCount === attemptResult.totalSamples;
    const direction = durationMs > targetDurationMs ? 1 : -1;
    const desiredRate = onPlateau
      ? clampRate(rateWpm + direction * Math.max(10, Math.ceil(rateWpm * 0.1)))
      : clampRate(Math.round(rateWpm * (durationMs / targetDurationMs)));
    rateWpm = desiredRate === rateWpm ? clampRate(rateWpm + direction) : desiredRate;
  }

  if (!lastOutput || !attempts.at(-1)?.withinTolerance) {
    const summary = attempts.map((item) => `${item.rateWpm} WPM → ${(item.durationMs / 1_000).toFixed(3)}s`).join(", ");
    throw narrationDurationError(
      `Narration could not reach ${(targetDurationMs / 1_000).toFixed(3)}s within ±1.000s after ${attempts.length} synthesis attempt(s) (rate bounds ${MIN_RATE_WPM}-${MAX_RATE_WPM} WPM). Measured: ${summary}`,
    );
  }
  return { ...lastOutput, durationMs, attempts, cacheStats: cache.snapshotStats() };
}

async function synthesizeAppleAtRate(
  chunks: ReturnType<typeof narrationItems>,
  voice: string,
  rateWpm: number,
  workDir: string,
  attempt: number,
  cache: ContentAddressedCache,
  identity: Record<string, unknown>,
): Promise<Omit<SynthesisOutput, "attempts" | "durationMs">> {
  const pcmBuffers: Buffer[] = [];
  const measuredChunks: SynthesizedChunk[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const base = join(workDir, `attempt-${attempt}-chunk-${String(index + 1).padStart(2, "0")}`);
    const wavePath = `${base}.wav`;
    const text = spokenText(chunk);
    const key = cache.key("apple-pcm-chunk-v1", { ...identity, voice, text, rateWpm, sampleRate: PCM_SAMPLE_RATE, channels: PCM_CHANNELS });
    const pcm = await cache.getOrCreate(key, async () => {
      runProcess(SAY_EXECUTABLE, [
        "-v", voice, "-r", String(rateWpm), "--file-format=WAVE",
        `--data-format=LEI16@${PCM_SAMPLE_RATE}`, `--channels=${PCM_CHANNELS}`,
        "-o", wavePath, text,
      ]);
      try {
        return extractPcmDataFromWav(await readFile(wavePath));
      } catch (error) {
        throw new Error(`Apple say failed to produce PCM for narration chunk ${chunk.id}: ${errorMessage(error)}`);
      }
    });
    if (pcm.length < 2 || pcm.length % 2 !== 0) throw new Error(`Cached Apple PCM is invalid for ${chunk.id}`);
    measuredChunks.push({ id: chunk.id, samples: pcm.byteLength / 2 });
    pcmBuffers.push(pcm);
  }
  const combined = Buffer.concat(pcmBuffers);
  const outputPath = join(workDir, `narration-attempt-${attempt}.pcm`);
  await writeFile(outputPath, combined);
  return { pcmPath: outputPath, chunks: measuredChunks, totalSamples: combined.byteLength / 2 };
}

function resolveVoice(requestedVoice: string, backend: "apple" | "kokoro" | "chatterbox"): string {
  if (backend === "chatterbox") {
    if (requestedVoice !== "auto" && requestedVoice !== "chatterbox-bella") throw new Error("Chatterbox currently supports only --voice chatterbox-bella (or auto)");
    return "chatterbox-bella";
  }
  if (requestedVoice !== "auto") return requestedVoice;
  return backend === "kokoro" ? "af_heart" : "Samantha";
}

function clampRate(rateWpm: number): number {
  return Math.max(MIN_RATE_WPM, Math.min(MAX_RATE_WPM, rateWpm));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
