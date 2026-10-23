import { mouthEnvelope, prepareTimeline, type PerformanceTiming, type CharacterTestProps } from "./motion.js";
import { buildMouthTrack } from "./lipsync.js";
import { buildFacialActingTrack } from "./expressions.js";

/** Shared preparation keeps the approved default and explicit auditions identical. */
export function prepareCharacterPerformance(timing: PerformanceTiming, pcm: Buffer) {
  const {timeline, captions, beats} = prepareTimeline(timing);
  const mouth = buildMouthTrack(timing.phonemes, mouthEnvelope(pcm, timeline.fps), timeline.fps);
  const isChatterbox = timing.version === 2;
  const voiceLabel = isChatterbox ? "CHATTERBOX / BELLA" : "BELLA / A";
  const facialActing = isChatterbox ? buildFacialActingTrack(timing.words, beats) : undefined;
  const props: CharacterTestProps = {durationInFrames: timeline.durationInFrames, fps: timeline.fps, mouth, beats, voiceLabel,
    ...(facialActing ? {facialActing, retimeBody:true} : {})};
  return {timeline, captions, beats, voiceLabel, facialActing, props};
}
