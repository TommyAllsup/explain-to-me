import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CaptionSegment, Timeline } from "../../timeline/src/timeline.js";
import { runProcess } from "../../audio/src/synthesize.js";

export const REQUIRED_ARTIFACTS = [
  "video.mp4",
  "audio.wav",
  "captions.vtt",
  "captions.srt",
  "manifest.json",
  "report.json",
] as const;

export const AUDIO_QC_THRESHOLDS = {
  silenceFloorDbfs: -50,
  maximumLeadingSilenceMs: 1_000,
  maximumTrailingSilenceMs: 1_000,
  maximumInteriorSilenceMs: 2_000,
  clippingPeak: 32_760,
  maximumClippedSampleFraction: 0.0001,
} as const;

const SILENCE_AMPLITUDE = Math.round(32_767 * 10 ** (AUDIO_QC_THRESHOLDS.silenceFloorDbfs / 20));

export interface AudioSignalQc {
  sampleCount: number;
  peakAmplitude: number;
  clippedSamples: number;
  clippedSampleFraction: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  longestInteriorSilenceMs: number;
  clippingPass: boolean;
  silencePass: boolean;
}

export interface MediaStreamInfo {
  codec_type?: string;
  duration?: string;
  duration_ts?: string;
  time_base?: string;
  nb_frames?: string;
  sample_rate?: string;
  channels?: number;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}

export interface MediaProbe {
  streams: MediaStreamInfo[];
  format: { duration?: string; format_name?: string };
}

export interface BoundarySample {
  sceneId: string;
  edge: "start" | "end";
  frame: number;
  timeMs: number;
  file: string;
  bytes: number;
}

export interface MediaValidation {
  audioSignal: AudioSignalQc;
  containerDurationMs: number;
  audioEndMs: number;
  videoEndMs: number;
  videoFrameCount: number | null;
  avEndDifferenceMs: number;
  captionEndDifferenceMs: number;
  wavDurationMs: number;
  captionCount: number;
  coveredChunkCount: number;
  chunkCount: number;
  checks: Record<string, boolean>;
  boundarySamples: BoundarySample[];
  ffmpegDecode: "passed";
  probe: MediaProbe;
}

export async function muxAudioIntoVideo(videoOnlyPath: string, audioWavPath: string, outputPath: string): Promise<void> {
  runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", videoOnlyPath, "-i", audioWavPath,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "24000",
    "-movflags", "+faststart", outputPath,
  ], 300_000);
}

export async function probeMedia(path: string): Promise<MediaProbe> {
  const json = runProcess("ffprobe", [
    "-v", "error", "-show_entries",
    "format=duration,format_name:stream=codec_type,duration,duration_ts,time_base,nb_frames,sample_rate,channels,width,height,r_frame_rate",
    "-of", "json", path,
  ]);
  return JSON.parse(json) as MediaProbe;
}

export function decodeMediaFully(path: string): void {
  // Remotion's Windows build omits null's default wrapped_avframe encoder.
  // Raw video and PCM still exercise both decoders without compression work.
  runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-xerror", "-i", path,
    "-map", "0:v:0", "-map", "0:a:0", "-c:v", "rawvideo", "-c:a", "pcm_s16le", "-f", "null", "-",
  ], 300_000);
}

export function inspectPcm(pcm: Buffer, sampleRate = 24_000): AudioSignalQc {
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) throw new Error("PCM must contain complete signed 16-bit samples");
  const sampleCount = pcm.byteLength / 2;
  let peakAmplitude = 0;
  let clippedSamples = 0;
  let leadingSamples = 0;
  let trailingSamples = 0;
  let longestInteriorSamples = 0;
  let currentSilenceSamples = 0;
  let seenNonSilence = false;
  let lastNonSilenceIndex = -1;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = pcm.readInt16LE(index * 2);
    const amplitude = Math.abs(sample);
    peakAmplitude = Math.max(peakAmplitude, amplitude);
    if (amplitude >= AUDIO_QC_THRESHOLDS.clippingPeak) clippedSamples += 1;
    if (amplitude <= SILENCE_AMPLITUDE) {
      currentSilenceSamples += 1;
      if (!seenNonSilence) leadingSamples += 1;
    } else {
      if (currentSilenceSamples > 0 && seenNonSilence) longestInteriorSamples = Math.max(longestInteriorSamples, currentSilenceSamples);
      currentSilenceSamples = 0;
      seenNonSilence = true;
      lastNonSilenceIndex = index;
    }
  }
  trailingSamples = sampleCount - lastNonSilenceIndex - 1;
  if (lastNonSilenceIndex < 0) trailingSamples = sampleCount;
  if (currentSilenceSamples > 0 && lastNonSilenceIndex >= 0) longestInteriorSamples = Math.max(longestInteriorSamples, currentSilenceSamples - trailingSamples);

  const clippedSampleFraction = clippedSamples / sampleCount;
  const leadingSilenceMs = (leadingSamples * 1_000) / sampleRate;
  const trailingSilenceMs = (trailingSamples * 1_000) / sampleRate;
  const longestInteriorSilenceMs = (longestInteriorSamples * 1_000) / sampleRate;
  return {
    sampleCount,
    peakAmplitude,
    clippedSamples,
    clippedSampleFraction,
    leadingSilenceMs,
    trailingSilenceMs,
    longestInteriorSilenceMs,
    clippingPass: clippedSampleFraction <= AUDIO_QC_THRESHOLDS.maximumClippedSampleFraction,
    silencePass: leadingSilenceMs <= AUDIO_QC_THRESHOLDS.maximumLeadingSilenceMs
      && trailingSilenceMs <= AUDIO_QC_THRESHOLDS.maximumTrailingSilenceMs
      && longestInteriorSilenceMs <= AUDIO_QC_THRESHOLDS.maximumInteriorSilenceMs,
  };
}

export async function extractSceneBoundarySamples(
  videoPath: string,
  timeline: Timeline,
  outputDir: string,
): Promise<BoundarySample[]> {
  await mkdir(outputDir, { recursive: true });
  const samples: BoundarySample[] = [];
  for (const [index, scene] of timeline.scenes.entries()) {
    const startFrame = scene.from;
    const endFrame = Math.max(scene.from, scene.from + scene.durationInFrames - 1);
    for (const [edge, frame] of [["start", startFrame], ["end", endFrame]] as const) {
      const timeMs = (frame * 1_000) / timeline.fps;
      const file = join(outputDir, `scene-${String(index + 1).padStart(2, "0")}-${safeFilePart(scene.sceneId)}-${edge}.png`);
      runProcess("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", videoPath,
        // The pinned Windows FFmpeg includes trim but omits select. Frame bounds
        // keep extraction exact without timestamp seeking or filter escaping.
        "-vf", `trim=start_frame=${frame}:end_frame=${frame + 1}`, "-frames:v", "1", file,
      ], 120_000);
      const size = (await stat(file)).size;
      if (size <= 0) throw new Error(`Could not extract ${edge} frame for scene ${scene.sceneId}`);
      samples.push({ sceneId: scene.sceneId, edge, frame, timeMs, file: `samples/${basename(file)}`, bytes: size });
    }
  }
  return samples;
}

export async function validateRenderedMedia(options: {
  outputDir: string;
  pcmPath: string;
  timeline: Timeline;
  captions: CaptionSegment[];
  targetDurationMs: number;
  rendererFrameCount: number;
  boundarySamples: BoundarySample[];
}): Promise<MediaValidation> {
  const videoPath = join(options.outputDir, "video.mp4");
  const wavPath = join(options.outputDir, "audio.wav");
  const required = REQUIRED_ARTIFACTS.filter((name) => name !== "report.json");
  for (const artifact of required) {
    const artifactPath = join(options.outputDir, artifact);
    const info = await stat(artifactPath).catch(() => undefined);
    if (!info || info.size === 0) throw new Error(`Required output ${artifact} is missing or empty`);
  }

  const [probe, wavProbe, pcm] = await Promise.all([probeMedia(videoPath), probeMedia(wavPath), readFile(options.pcmPath)]);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const wavAudio = wavProbe.streams.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("Muxed MP4 must contain both video and audio streams");
  if (!wavAudio) throw new Error("audio.wav must contain an audio stream");
  const containerDurationMs = durationMs(probe.format.duration);
  const wavDurationMs = durationMs(wavProbe.format.duration);
  const videoEndMs = streamDurationMs(video);
  const audioEndMs = streamDurationMs(audio);
  const avEndDifferenceMs = Math.abs(videoEndMs - audioEndMs);
  const signal = inspectPcm(pcm);
  const captionCoverage = validateCaptions(options.captions, options.timeline);
  const captionEndMs = options.captions.at(-1)?.endMs ?? 0;
  const captionEndDifferenceMs = Math.abs(captionEndMs - options.timeline.durationMs);
  const pcmMatchesTimeline = signal.sampleCount === Math.round((options.timeline.durationMs * 24_000) / 1_000);
  const parsedFrameCount = video.nb_frames ? Number(video.nb_frames) : Number.NaN;
  const videoFrameCount = Number.isSafeInteger(parsedFrameCount) ? parsedFrameCount : null;

  const durationPass = inClosedRange(containerDurationMs, options.targetDurationMs - 1_000, options.targetDurationMs + 1_000)
    && inClosedRange(videoEndMs, options.targetDurationMs - 1_000, options.targetDurationMs + 1_000)
    && inClosedRange(audioEndMs, options.targetDurationMs - 1_000, options.targetDurationMs + 1_000);
  const avSyncPass = avEndDifferenceMs <= 250;
  const captionEndPass = captionEndDifferenceMs <= 250;
  const wavDurationPass = Math.abs(wavDurationMs - options.timeline.durationMs) <= 1;
  const frameCountPass = options.rendererFrameCount === options.timeline.durationInFrames
    && (videoFrameCount === null || videoFrameCount === options.timeline.durationInFrames);
  const boundaryPass = options.boundarySamples.length === options.timeline.scenes.length * 2
    && options.boundarySamples.every((sample) => sample.bytes > 0);
  decodeMediaFully(videoPath);

  const checks = {
    duration: durationPass,
    avSync: avSyncPass,
    captions: captionCoverage.pass,
    captionEnd: captionEndPass,
    audioClipping: signal.clippingPass,
    audioSilence: signal.silencePass,
    frameCount: frameCountPass,
    sceneBoundarySamples: boundaryPass,
    decoded: true,
    wavFormat: wavAudio.sample_rate === "24000" && wavAudio.channels === 1 && wavDurationPass,
    pcmMatchesTimeline,
  };
  const failed = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
  if (failed.length > 0) throw new Error(`Automated output checks failed: ${failed.join(", ")}`);

  return {
    audioSignal: signal,
    containerDurationMs,
    audioEndMs,
    videoEndMs,
    videoFrameCount,
    avEndDifferenceMs,
    captionEndDifferenceMs,
    wavDurationMs,
    captionCount: options.captions.length,
    coveredChunkCount: captionCoverage.coveredChunkCount,
    chunkCount: options.timeline.chunks.length,
    checks,
    boundarySamples: options.boundarySamples,
    ffmpegDecode: "passed",
    probe,
  };
}

export async function confirmAllArtifacts(outputDir: string): Promise<void> {
  for (const artifact of REQUIRED_ARTIFACTS) {
    const artifactPath = join(outputDir, artifact);
    const info = await stat(artifactPath).catch(() => undefined);
    if (!info || info.size === 0) throw new Error(`Required output ${artifact} is missing or empty`);
  }
}

function validateCaptions(captions: CaptionSegment[], timeline: Timeline): { pass: boolean; coveredChunkCount: number } {
  if (captions.length === 0) return { pass: false, coveredChunkCount: 0 };
  let lastEnd = -1;
  for (const caption of captions) {
    if (caption.startMs < 0 || caption.endMs <= caption.startMs || caption.startMs < lastEnd) {
      return { pass: false, coveredChunkCount: 0 };
    }
    lastEnd = caption.endMs;
  }
  const coveredChunks = new Set(captions.map((caption) => caption.chunkId));
  const coveredChunkCount = timeline.chunks.filter((chunk) => coveredChunks.has(chunk.id)).length;
  return { pass: coveredChunkCount === timeline.chunks.length, coveredChunkCount };
}

function streamDurationMs(stream: MediaStreamInfo): number {
  if (stream.duration !== undefined && Number.isFinite(Number(stream.duration)) && Number(stream.duration) > 0) return durationMs(stream.duration);
  if (stream.duration_ts && stream.time_base) {
    const [numerator, denominator] = stream.time_base.split("/").map(Number);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return (Number(stream.duration_ts) * numerator! * 1_000) / denominator!;
    }
  }
  throw new Error(`ffprobe did not return a stream duration for ${stream.codec_type ?? "unknown"}`);
}

function durationMs(value: string | undefined): number {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("ffprobe returned a missing or invalid media duration");
  return duration * 1_000;
}

function inClosedRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]/giu, "-");
}
