import type { MouthPose } from "../claudia-character/lipsync.js";
import type { AlignedFacialWord } from "../claudia-character/expressions.js";

export type PerformanceIntent = "welcome" | "explain" | "setup" | "payoff" | "aside" | "reassure";
export type PerformanceGesture = "present" | "offer" | "small" | "none";
export type PerformanceDirection = { beats: {
  anchor: string;
  intent: PerformanceIntent;
  gesture?: PerformanceGesture;
  /** One-based occurrence for deliberately repeated phrases. */
  occurrence?: number;
}[] };

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
  performance?: PerformanceDirection;
};

export type ExplainerProps = {
  fps: number;
  durationInFrames: number;
  scenes: ExplainerScene[];
};
