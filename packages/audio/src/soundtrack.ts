import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { assertNoLinkedPath, assertSupportedFilePath, ensurePrivateDirectory, openRegularFile } from "../../assets/src/file-safety.js";
import { inspectPcm, type AudioSignalQc } from "../../validation/src/qc.js";
import { extractPcmDataFromWav, PCM_SAMPLE_RATE, runProcess } from "./synthesize.js";

export const MAX_MUSIC_SOURCE_BYTES = 100 * 1024 * 1024;
export const MAX_SOUNDTRACK_SAMPLES = 30 * 60 * PCM_SAMPLE_RATE;
const DEMUXERS: Record<string, string> = {
  ".wav": "wav", ".mp3": "mp3", ".m4a": "mov", ".aac": "aac",
  ".flac": "flac", ".ogg": "ogg",
};

export interface MusicConfig {
  source: string;
  gainDb: number;
  /** Additional attenuation during narration; zero disables ducking. */
  duckingDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  rights?: Record<string, string>;
}

export interface ResolvedMusic {
  config: MusicConfig;
  projectRoot: string;
  sourcePath: string;
  sourceSha256: string;
  sourceBytes: number;
  provenance: {
    source: string;
    sha256: string;
    bytes: number;
    rights: Record<string, string>;
    rightsStatus: "user-supplied; not verified";
  };
}

export interface SoundtrackReport {
  version: 1;
  source: ResolvedMusic["provenance"];
  settings: MusicConfig;
  algorithm: "pcm-mix-v1";
  sampleRate: number;
  channels: 1;
  sampleCount: number;
  durationMs: number;
  decodedMusicSamples: number;
  playedMusicSamples: number;
  trackEndedEarly: boolean;
  endPolicy: "No looping; fade at the earlier of track end or narration end; silence only in the music stem thereafter.";
  ducking: { thresholdDbfs: -45; windowMs: 20; holdMs: 120; attackMs: 20; releaseMs: 250 };
  outputs: {
    narration: { sha256: string; unchanged: true };
    music: { file: "music.wav"; sha256: string; signal: AudioSignalQc };
    mixed: { file: "mixed.wav"; sha256: string; signal: AudioSignalQc };
  };
  checks: { musicClipping: boolean; mixedClipping: boolean; sampleCount: boolean; narrationUnchanged: boolean };
}

/** Bind one local track to exact bytes before production. Rights are descriptive metadata only. */
export async function resolveMusic(projectRoot: string, config: MusicConfig): Promise<ResolvedMusic> {
  validateMusicConfig(config);
  assertSupportedFilePath(projectRoot);
  const root = await realpath(projectRoot);
  await assertNoLinkedPath(root);
  if (!(await lstat(root)).isDirectory()) throw new Error("Music project root must be a directory");
  const sourcePath = resolve(root, config.source);
  const inside = relative(root, sourcePath);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error("Music source must remain inside the project directory");
  }
  // Unix's openRegularFile protects the leaf. Check the selected directory chain too.
  for (let current = sourcePath; current !== root; current = dirname(current)) await assertNoLinkedPath(current);
  const canonical = await realpath(sourcePath);
  const canonicalInside = relative(root, canonical);
  if (canonicalInside === "" || canonicalInside === ".." || canonicalInside.startsWith(`..${sep}`) || isAbsolute(canonicalInside)) {
    throw new Error("Music source resolves outside the project directory");
  }
  const bytes = await readMusicFile(sourcePath);
  const sourceSha256 = sha256(bytes);
  const copiedConfig: MusicConfig = { ...config, ...(config.rights ? { rights: { ...config.rights } } : {}) };
  return {
    config: copiedConfig, projectRoot: root, sourcePath: canonical, sourceSha256, sourceBytes: bytes.length,
    provenance: {
      source: config.source, sha256: sourceSha256, bytes: bytes.length,
      rights: { ...config.rights }, rightsStatus: "user-supplied; not verified",
    },
  };
}

/** Mix a separate music stem without modifying, stretching, or padding narration. */
export async function mixSoundtrack(options: {
  music: ResolvedMusic;
  narrationPath: string;
  outputDir: string;
  totalSamples: number;
}): Promise<{ musicPath: string; mixedPath: string; report: SoundtrackReport }> {
  const { music, totalSamples } = options;
  validateMusicConfig(music.config);
  if (!Number.isSafeInteger(totalSamples) || totalSamples < 1 || totalSamples > MAX_SOUNDTRACK_SAMPLES) {
    throw new Error("Soundtrack narration must contain between one sample and 30 minutes of audio");
  }
  // Re-resolve paths and bytes immediately before copying to an owned, private decode input.
  const current = await resolveMusic(music.projectRoot, music.config);
  if (current.sourceSha256 !== music.sourceSha256 || current.sourceBytes !== music.sourceBytes) {
    throw new Error("Music source changed after it was selected; review and resolve the project again");
  }
  const sourceBytes = await readMusicFile(current.sourcePath);
  if (sha256(sourceBytes) !== music.sourceSha256) throw new Error("Music source changed while preparing the soundtrack");
  const narrationHandle = await openRegularFile(options.narrationPath);
  let narrationWave: Buffer;
  try {
    if ((await narrationHandle.stat()).size > MAX_SOUNDTRACK_SAMPLES * 2 + 1024 * 1024) throw new Error("Narration WAV exceeds the soundtrack size bound");
    narrationWave = await narrationHandle.readFile();
  } finally { await narrationHandle.close(); }
  const narrationPcm = extractPcmDataFromWav(narrationWave);
  if (narrationPcm.length / 2 !== totalSamples) throw new Error("Narration sample count does not match the measured timeline");
  await ensurePrivateDirectory(options.outputDir);
  const workDir = await mkdtemp(join(options.outputDir, ".soundtrack-"));
  try {
    await ensurePrivateDirectory(workDir);
    const decodeSource = join(workDir, `source${extname(music.config.source).toLowerCase()}`);
    const decodedPath = join(workDir, "decoded.wav");
    await writeFile(decodeSource, sourceBytes, { flag: "wx", mode: 0o600 });
    // Pin a simple audio demuxer to prevent playlist indirection, and disallow network protocols.
    // No sidechain/fade filters: Remotion's bundled Windows FFmpeg has a restricted filter set.
    runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-xerror",
      "-protocol_whitelist", "file", "-f", DEMUXERS[extname(music.config.source).toLowerCase()]!,
      "-i", decodeSource, "-map", "0:a:0", "-vn", "-sn", "-dn",
      "-t", ((totalSamples + 1) / PCM_SAMPLE_RATE).toFixed(9),
      // Bundled FFmpeg supports WAV output but omits the raw s16le muxer.
      "-ac", "1", "-ar", String(PCM_SAMPLE_RATE), "-c:a", "pcm_s16le", "-f", "wav", decodedPath,
    ], 120_000);
    const decodedHandle = await openRegularFile(decodedPath, workDir);
    let musicPcm: Buffer;
    try {
      const size = (await decodedHandle.stat()).size;
      if (size < 44 || size > (totalSamples + 1) * 2 + 1024 * 1024) throw new Error("Decoded music is empty, invalid, or exceeds the sample bound");
      musicPcm = extractPcmDataFromWav(await decodedHandle.readFile());
      if (musicPcm.length > (totalSamples + 1) * 2) throw new Error("Decoded music exceeds the sample bound");
    } finally { await decodedHandle.close(); }
    const mixed = mixPcmSoundtrack(narrationPcm, musicPcm, music.config);
    const musicWave = pcmWave(mixed.musicPcm);
    const mixedWave = pcmWave(mixed.mixedPcm);
    const musicPath = join(options.outputDir, "music.wav");
    const mixedPath = join(options.outputDir, "mixed.wav");
    // Exclusive creation protects prior outputs, including accidental input/output aliases.
    await writeFile(musicPath, musicWave, { flag: "wx", mode: 0o600 });
    await writeFile(mixedPath, mixedWave, { flag: "wx", mode: 0o600 });
    const narrationUnchanged = sha256(await readFile(options.narrationPath)) === sha256(narrationWave);
    if (!narrationUnchanged) throw new Error("Narration changed during soundtrack mixing");
    const playedMusicSamples = Math.min(totalSamples, musicPcm.length / 2);
    return {
      musicPath, mixedPath,
      report: {
        version: 1, source: music.provenance, settings: music.config, algorithm: "pcm-mix-v1",
        sampleRate: PCM_SAMPLE_RATE, channels: 1, sampleCount: totalSamples,
        durationMs: totalSamples * 1_000 / PCM_SAMPLE_RATE,
        decodedMusicSamples: musicPcm.length / 2, playedMusicSamples,
        trackEndedEarly: playedMusicSamples < totalSamples,
        endPolicy: "No looping; fade at the earlier of track end or narration end; silence only in the music stem thereafter.",
        ducking: { thresholdDbfs: -45, windowMs: 20, holdMs: 120, attackMs: 20, releaseMs: 250 },
        outputs: {
          narration: { sha256: sha256(narrationWave), unchanged: true },
          music: { file: "music.wav", sha256: sha256(musicWave), signal: mixed.musicSignal },
          mixed: { file: "mixed.wav", sha256: sha256(mixedWave), signal: mixed.mixedSignal },
        },
        checks: {
          musicClipping: mixed.musicSignal.clippingPass, mixedClipping: mixed.mixedSignal.clippingPass,
          sampleCount: mixed.mixedPcm.length / 2 === totalSamples && mixed.musicPcm.length / 2 === totalSamples,
          narrationUnchanged,
        },
      },
    };
  } finally { await rm(workDir, { recursive: true, force: true }); }
}

/** Deterministic 24 kHz mono s16 mixer; narration PCM is never mutated. */
export function mixPcmSoundtrack(narrationPcm: Buffer, sourcePcm: Buffer, config: MusicConfig): {
  musicPcm: Buffer; mixedPcm: Buffer; musicSignal: AudioSignalQc; mixedSignal: AudioSignalQc;
} {
  validateMusicConfig(config);
  if (narrationPcm.length < 2 || narrationPcm.length % 2 || sourcePcm.length < 2 || sourcePcm.length % 2) {
    throw new Error("Soundtrack PCM must contain complete signed 16-bit samples");
  }
  const totalSamples = narrationPcm.length / 2;
  if (totalSamples > MAX_SOUNDTRACK_SAMPLES || sourcePcm.length / 2 > MAX_SOUNDTRACK_SAMPLES + 1) throw new Error("Soundtrack PCM exceeds 30 minutes");
  const playedSamples = Math.min(sourcePcm.length / 2, totalSamples);
  const musicPcm = Buffer.alloc(narrationPcm.length);
  const mixedPcm = Buffer.alloc(narrationPcm.length);
  const gain = 10 ** (config.gainDb / 20);
  const duckGain = 10 ** (config.duckingDb / 20);
  const fadeInSamples = Math.round(config.fadeInMs * PCM_SAMPLE_RATE / 1_000);
  const fadeOutSamples = Math.round(config.fadeOutMs * PCM_SAMPLE_RATE / 1_000);
  const blockSize = PCM_SAMPLE_RATE * 0.02;
  const active = new Uint8Array(Math.ceil(totalSamples / blockSize));
  const thresholdSquared = (32_767 * 10 ** (-45 / 20)) ** 2;
  for (let block = 0; block < active.length; block += 1) {
    let sumSquared = 0;
    const start = block * blockSize;
    const end = Math.min(totalSamples, start + blockSize);
    for (let index = start; index < end; index += 1) sumSquared += narrationPcm.readInt16LE(index * 2) ** 2;
    active[block] = sumSquared / (end - start) >= thresholdSquared ? 1 : 0;
  }
  let holdUntil = -1;
  let envelope = active[0] ? duckGain : 1;
  const attack = 1 - Math.exp(-1 / (PCM_SAMPLE_RATE * 0.02));
  const release = 1 - Math.exp(-1 / (PCM_SAMPLE_RATE * 0.25));
  for (let index = 0; index < totalSamples; index += 1) {
    const narration = narrationPcm.readInt16LE(index * 2);
    if (active[Math.floor(index / blockSize)]) holdUntil = index + PCM_SAMPLE_RATE * 0.12;
    const target = index <= holdUntil ? duckGain : 1;
    envelope += (target - envelope) * (target < envelope ? attack : release);
    let sample = 0;
    if (index < playedSamples) {
      const startFade = fadeInSamples > 0 ? Math.min(1, index / fadeInSamples) : 1;
      const endFade = fadeOutSamples > 0 ? Math.min(1, (playedSamples - index - 1) / fadeOutSamples) : 1;
      sample = Math.round(sourcePcm.readInt16LE(index * 2) * gain * envelope * Math.min(startFade, endFade));
    }
    const sum = narration + sample;
    if (sum > 32_767 || sum < -32_768) throw new Error("Soundtrack mix would clip; lower music gainDb or use stronger narration duckingDb");
    musicPcm.writeInt16LE(sample, index * 2);
    mixedPcm.writeInt16LE(sum, index * 2);
  }
  const musicSignal = inspectPcm(musicPcm);
  const mixedSignal = inspectPcm(mixedPcm);
  if (!musicSignal.clippingPass || !mixedSignal.clippingPass) throw new Error("Soundtrack clipping QC failed; lower music gainDb or use stronger narration duckingDb");
  return { musicPcm, mixedPcm, musicSignal, mixedSignal };
}

function validateMusicConfig(config: MusicConfig): void {
  if (typeof config.source !== "string" || config.source.length < 1 || config.source.length > 4096
    || isAbsolute(config.source) || win32.isAbsolute(config.source) || config.source.includes("\\")
    || config.source.includes(":") || config.source.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Music source must be a local project-relative path without traversal, URLs, or backslashes");
  }
  assertSupportedFilePath(config.source);
  if (!DEMUXERS[extname(config.source).toLowerCase()]) throw new Error("Music source must be WAV, MP3, M4A, AAC, FLAC, or OGG");
  for (const [key, min, max] of [["gainDb", -60, 0], ["duckingDb", -30, 0], ["fadeInMs", 0, 10_000], ["fadeOutMs", 0, 10_000]] as const) {
    if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max) throw new Error(`Music ${key} must be between ${min} and ${max}`);
  }
  if (config.rights !== undefined && (typeof config.rights !== "object" || config.rights === null
    || Array.isArray(config.rights) || Object.entries(config.rights).length > 16
    || Object.entries(config.rights).some(([key, value]) => key.length > 100 || typeof value !== "string" || value.length > 4000))) {
    throw new Error("Music rights must contain bounded user-supplied text fields");
  }
}

async function readMusicFile(path: string): Promise<Buffer> {
  const handle = await openRegularFile(path);
  try {
    const before = await handle.stat();
    const size = before.size;
    if (size < 1 || size > MAX_MUSIC_SOURCE_BYTES) throw new Error("Music source must be nonempty and at most 100 MiB");
    // The extra byte detects growth without allowing a concurrently growing file
    // to turn readFile into an unbounded allocation.
    const bytes = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== size || after.size !== size || after.mtimeMs !== before.mtimeMs) throw new Error("Music source changed while reading");
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}

function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

function pcmWave(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24); header.writeUInt32LE(PCM_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
