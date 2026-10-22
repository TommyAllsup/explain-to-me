import { createHash } from "node:crypto";
import { z } from "zod";
import type { CaptionSegment, Timeline } from "../../packages/timeline/src/timeline.js";

const sample = z.number().int().nonnegative().max(720_000);
export const performanceTimingSchema = z.object({
  version: z.literal(1), voice: z.literal("af_bella"), sampleRate: z.literal(24_000),
  samples: sample.positive(), audioSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  method: z.string().min(1).max(300), text: z.string().min(1).max(1600),
  cues: z.array(z.object({text: z.string().min(1).max(200), startSample: sample, endSample: sample})).length(6),
  phonemes: z.array(z.object({phoneme: z.string().min(1).max(8), start: z.number().finite().nonnegative(), end: z.number().finite().nonnegative()})).min(1).max(1600),
});
export type PerformanceTiming = z.infer<typeof performanceTimingSchema>;
export type CharacterBeat = { id: string; startMs: number; endMs: number; text: string; gesture: "greet" | "explain" | "think" | "settle" };
export type CharacterTestProps = { durationInFrames: number; fps: number; mouth: number[]; beats: CharacterBeat[]; voiceLabel: string };
export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export function verifyTiming(input: unknown, wav: Buffer, pcm: Buffer, expectedText: string): PerformanceTiming {
  const timing = performanceTimingSchema.parse(input);
  if (timing.audioSha256 !== sha256(wav) || timing.samples * 2 !== pcm.length) throw new Error("Performance audio does not match its recorded hash and sample count");
  if (timing.text !== expectedText || timing.cues.map((cue) => cue.text).join(" ") !== timing.text) throw new Error("Timing text must exactly cover the reviewed audition script");
  let end = 0;
  for (const cue of timing.cues) {
    if (cue.startSample !== end || cue.endSample <= cue.startSample || cue.endSample > timing.samples) throw new Error("Caption cues must continuously cover the audio in sample order");
    end = cue.endSample;
  }
  if (end !== timing.samples) throw new Error("Caption cues must end with the audio");
  let previousStart = 0;
  for (const phoneme of timing.phonemes) {
    if (phoneme.start < previousStart || phoneme.end < phoneme.start || phoneme.end > timing.samples / timing.sampleRate + 1 / timing.sampleRate) throw new Error("Invalid model phoneme timing");
    previousStart = phoneme.start;
  }
  return timing;
}

/** Frame-centred RMS with fast attack / release. Quiet frames close the mouth. */
export function mouthEnvelope(pcm: Buffer, fps = 24): number[] {
  if (!pcm.length || pcm.length % 2 || !Number.isInteger(fps) || fps < 1) throw new Error("Expected PCM16 audio and integer fps");
  const count = pcm.length / 2;
  const levels: number[] = [];
  for (let frame = 0; frame < Math.ceil(count * fps / 24_000); frame++) {
    const from = Math.floor(frame * 24_000 / fps);
    const end = Math.min(count, Math.floor((frame + 1) * 24_000 / fps));
    let sum = 0;
    for (let i = from; i < end; i++) sum += (pcm.readInt16LE(i * 2) / 32768) ** 2;
    levels.push(Math.sqrt(sum / Math.max(1, end - from)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const ceiling = Math.max(.02, sorted[Math.floor(sorted.length * .9)] ?? .02);
  let previous = 0;
  return levels.map((level) => {
    const desired = level < .004 ? 0 : Math.min(1, (level / ceiling) ** .65);
    previous = desired === 0 ? 0 : previous + (desired - previous) * (desired > previous ? .85 : .65);
    return Math.round(previous * 10000) / 10000;
  });
}

export function prepareTimeline(timing: PerformanceTiming, fps = 24): { timeline: Timeline; captions: CaptionSegment[]; beats: CharacterBeat[] } {
  const durationMs = timing.samples / 24;
  const durationInFrames = Math.ceil(timing.samples * fps / 24_000);
  const gestures = ["greet", "greet", "explain", "think", "explain", "settle"] as const;
  const chunks = timing.cues.map((cue, i) => ({id: `sentence-${i + 1}`, sceneId: `beat-${i + 1}`, text: cue.text, startMs: cue.startSample / 24, endMs: cue.endSample / 24}));
  const scenes = chunks.map((chunk, i) => {
    const from = Math.round(chunk.startMs * fps / 1000);
    const until = i === chunks.length - 1 ? durationInFrames : Math.round(chunk.endMs * fps / 1000);
    return { sceneId: chunk.sceneId, startMs: chunk.startMs, endMs: chunk.endMs, from, durationInFrames: until - from };
  });
  return {
    timeline: { fps, durationMs, durationInFrames, chunks, scenes },
    captions: chunks.map(({id, ...chunk}) => ({chunkId: id, ...chunk})),
    beats: chunks.map((chunk, i) => ({id: chunk.sceneId, startMs: chunk.startMs, endMs: chunk.endMs, text: chunk.text, gesture: gestures[i]!})),
  };
}
