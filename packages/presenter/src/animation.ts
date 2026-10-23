import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProductionManifest } from "../../contracts/src/production-manifest.js";
import type { NarrationAlignment } from "../../contracts/src/narration-alignment.js";
import { buildTimeline, type Timeline } from "../../timeline/src/timeline.js";
import { buildMouthTrack } from "./claudia/lipsync.js";
import { mouthEnvelope } from "./envelope.js";
import { buildPerformance } from "./performance.js";
import type { PresenterAnimation } from "./animation-types.js";
export type { PresenterAnimation, PresenterSceneAnimation } from "./animation-types.js";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const finite = z.number().finite();
const time = finite.min(0).max(3_600);
const interval = { start: time, end: time };
const window = { ...interval, arrive: time, leave: time };
const anchor = z.string().min(1).max(4_000);
const alignmentSchema = z.strictObject({
  version: z.literal(1),
  chunks: z.array(z.strictObject({
    id: z.string().min(1).max(64), text: z.string().min(1).max(8_000), sampleRate: z.literal(24000),
    samples: z.number().int().positive().max(24_000 * 600), pcmSha256: digest,
    words: z.array(z.strictObject({ text: z.string().min(1).max(240), ...interval })).min(1).max(3_000),
    phonemes: z.array(z.strictObject({ phoneme: z.string().min(1).max(24), ...interval })).min(1).max(24_000),
  })).min(1).max(256),
});
const mouth = z.strictObject(Object.fromEntries(["open", "width", "round", "closure", "teeth", "tongue"].map((key) => [key, finite.min(0).max(1)])) as Record<"open" | "width" | "round" | "closure" | "teeth" | "tongue", z.ZodNumber>);
const intent = z.enum(["welcome", "explain", "setup", "reassure"]);
const performanceSchema = z.strictObject({
  version: z.literal(1), duration: time.positive(),
  beats: z.array(z.strictObject({ anchor, intent, gesture: z.enum(["none", "present", "offer", "small"]), ...interval,
    firstWord: z.number().int().nonnegative(), lastWord: z.number().int().nonnegative() })).max(3_000),
  face: z.strictObject({ version: z.literal(1), source: z.literal("word-alignment"),
    expressions: z.array(z.strictObject({ ...window, intent: z.enum(["welcome", "reassure", "explain", "curious", "caution", "invite", "emphasis", "questionAccent", "contrast"]), intensity: finite.min(0).max(1.1), anchor })).max(3_000),
    gaze: z.array(z.strictObject({ ...window, x: finite.min(-6).max(6), y: finite.min(-3).max(3), anchor })).max(3_000),
    blinks: z.array(time).max(1_000),
  }),
  gestures: z.array(z.strictObject({ ...window, kind: z.enum(["present", "offer", "small"]), anchor, intensity: finite.min(0).max(1) })).max(1_000),
  heads: z.array(z.strictObject({ ...window, tilt: finite.min(-3).max(3), nod: finite.min(-2).max(2), anchor })).max(3_000),
  stances: z.array(z.strictObject({ ...window, x: finite.min(-2).max(2), y: finite.min(-1).max(1), roll: finite.min(-1).max(1) })).max(3_000),
});
const animationSchema = z.strictObject({
  version: z.literal(1), character: z.literal("claudia"), fps: z.number().int().min(1).max(240),
  durationInFrames: z.number().int().positive().max(864_000), audioSha256: digest, manifestSha256: digest, timelineSha256: digest,
  scenes: z.array(z.strictObject({ sceneId: z.string().min(1).max(64), from: z.number().int().nonnegative(),
    durationInFrames: z.number().int().positive(), motion: z.enum(["full", "reduced"]),
    mouth: z.array(mouth).min(1).max(864_000), performance: performanceSchema })).min(1).max(16),
});
const transcriptKey = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Fail closed on stale alignment; a recording must never inherit an old mouth clock. */
export function buildPresenterAnimation({ manifest, timeline, alignment: input, pcm }: {
  manifest: ProductionManifest; timeline: Timeline; alignment: NarrationAlignment; pcm: Buffer;
}): PresenterAnimation {
  const parsed = alignmentSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid narration alignment: ${parsed.error.message}`);
  const alignment = parsed.data;
  const narration = manifest.scenes.flatMap((scene) => scene.narration);
  if (alignment.chunks.length !== narration.length) throw new Error("Narration alignment must cover every prepared chunk exactly");
  let sampleOffset = 0;
  const globalWords: Array<{ text: string; start: number; end: number; chunkId: string }> = [];
  const globalPhones: Array<{ phoneme: string; start: number; end: number }> = [];
  for (let i = 0; i < narration.length; i++) {
    const chunk = narration[i]!, aligned = alignment.chunks[i]!;
    if (aligned.id !== chunk.id || aligned.text !== (chunk.spokenText ?? chunk.text)) throw new Error(`Narration alignment text/order mismatch for ${chunk.id}`);
    const bytes = pcm.subarray(sampleOffset * 2, (sampleOffset + aligned.samples) * 2);
    if (bytes.length !== aligned.samples * 2 || hash(bytes) !== aligned.pcmSha256) throw new Error(`Narration alignment PCM hash mismatch for ${chunk.id}`);
    const duration = aligned.samples / 24_000;
    for (const [label, entries] of [["words", aligned.words], ["phonemes", aligned.phonemes]] as const) {
      let previous = 0;
      for (const entry of entries) {
        if (entry.start < previous - 1e-6 || entry.end <= entry.start || entry.end > duration + 1e-6) throw new Error(`Invalid ${label} interval in ${chunk.id}`);
        previous = entry.end;
      }
    }
    if (transcriptKey(aligned.words.map((word) => word.text).join(" ")) !== transcriptKey(aligned.text)) throw new Error(`Aligned words do not cover the spoken text for ${chunk.id}`);
    const offset = sampleOffset / 24_000;
    globalWords.push(...aligned.words.map((word) => ({ ...word, start: word.start + offset, end: word.end + offset, chunkId: chunk.id })));
    globalPhones.push(...aligned.phonemes.map((phone) => ({ ...phone, start: phone.start + offset, end: phone.end + offset })));
    sampleOffset += aligned.samples;
  }
  if (pcm.length !== sampleOffset * 2) throw new Error("Narration alignment sample total does not match PCM audio");
  const measured = buildTimeline(manifest, alignment.chunks, timeline.fps, 24_000);
  if (JSON.stringify(measured) !== JSON.stringify(timeline)) throw new Error("Narration alignment does not match the measured timeline");
  const track = buildMouthTrack(globalPhones, mouthEnvelope(pcm, timeline.fps), timeline.fps);
  const scenes = manifest.scenes.flatMap((scene, index) => {
    const presenter = scene.visual.presenter;
    if (!presenter || !("character" in presenter)) return [];
    const timed = timeline.scenes[index]!;
    const ids = new Set(scene.narration.map((chunk) => chunk.id));
    // Scene boundaries round to frames; offset acting by that same render clock.
    const offset = timed.from / timeline.fps, duration = timed.durationInFrames / timeline.fps;
    const words = globalWords.filter((word) => ids.has(word.chunkId)).map(({ text, start, end }) => ({ text,
      start: Math.max(0, start - offset), end: Math.min(duration, end - offset) }));
    return [{ sceneId: scene.id, from: timed.from, durationInFrames: timed.durationInFrames,
      motion: presenter.motion ?? "full", mouth: track.slice(timed.from, timed.from + timed.durationInFrames),
      performance: buildPerformance({ id: scene.id, duration, words }, index) }];
  });
  const animation: PresenterAnimation = { version: 1, character: "claudia", fps: timeline.fps, durationInFrames: timeline.durationInFrames,
    audioSha256: hash(pcm), manifestSha256: hash(JSON.stringify(manifest)), timelineSha256: hash(JSON.stringify(timeline)), scenes };
  assertPresenterAnimation(manifest, timeline, animation);
  return animation;
}

/** Validate before browser launch, including direct renderer calls outside the CLI. */
export function assertPresenterAnimation(manifest: ProductionManifest, timeline: Timeline, input?: PresenterAnimation): void {
  const selected = manifest.scenes.filter((scene) => scene.visual.presenter && "character" in scene.visual.presenter);
  if (!selected.length) {
    if (input !== undefined) throw new Error("Presenter animation supplied without an animated presenter");
    return;
  }
  const parsed = animationSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Animated Claudia requires valid presenter animation: ${parsed.error.message}`);
  const animation = parsed.data;
  if (animation.fps !== timeline.fps || animation.durationInFrames !== timeline.durationInFrames
    || animation.manifestSha256 !== hash(JSON.stringify(manifest)) || animation.timelineSha256 !== hash(JSON.stringify(timeline))
    || animation.scenes.length !== selected.length) throw new Error("Presenter animation does not match the manifest and timeline");
  for (let i = 0; i < selected.length; i++) {
    const scene = selected[i]!, animated = animation.scenes[i]!, timed = timeline.scenes.find((entry) => entry.sceneId === scene.id);
    const presenter = scene.visual.presenter!;
    if (!("character" in presenter) || presenter.character !== "claudia" || !["title", "statement", "bullets", "outro"].includes(scene.kind)) throw new Error("Unsupported animated presenter or scene kind");
    if (!timed || animated.sceneId !== scene.id || animated.motion !== (presenter.motion ?? "full") || animated.from !== timed.from
      || animated.durationInFrames !== timed.durationInFrames || animated.mouth.length !== timed.durationInFrames
      || Math.abs(animated.performance.duration - timed.durationInFrames / timeline.fps) > 1e-6) throw new Error(`Presenter animation does not match scene ${scene.id}`);
    const performance = animated.performance;
    for (const cue of [...performance.face.expressions, ...performance.face.gaze, ...performance.gestures, ...performance.heads, ...performance.stances]) {
      if (cue.start >= cue.arrive || cue.arrive > cue.leave || cue.leave >= cue.end || cue.end > performance.duration) throw new Error(`Invalid presenter cue window in ${scene.id}`);
    }
    for (const cue of performance.gestures) {
      if (cue.arrive - cue.start < .539 || cue.leave - cue.arrive < .379 || cue.end - cue.leave < .719) throw new Error(`Presenter gesture lacks natural preparation/recovery in ${scene.id}`);
    }
    if (performance.face.blinks.some((at, index) => at + .255 > performance.duration || (index > 0 && at - performance.face.blinks[index - 1]! < 1.5))) throw new Error(`Invalid presenter blink interval in ${scene.id}`);
    if (performance.beats.some((beat) => beat.start >= beat.end || beat.end > performance.duration || beat.lastWord < beat.firstWord)) throw new Error(`Invalid presenter phrase interval in ${scene.id}`);
  }
}
