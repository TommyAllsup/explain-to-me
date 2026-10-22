import type { MouthPose } from "../claudia-character/lipsync.js";
import type { AlignedFacialWord } from "../claudia-character/expressions.js";

/** All timing within a scene is local, in seconds; `from` is a global frame. */
export type ExplainerScene = {
  id: string;
  title: string;
  narration: string;
  visual: string;
  displayText: string | string[];
  from: number;
  durationInFrames: number;
  mouth: MouthPose[];
  words: AlignedFacialWord[];
  captions?: { text: string; start: number; end: number }[];
};

export type ExplainerProps = {
  fps: number;
  durationInFrames: number;
  scenes: ExplainerScene[];
};
