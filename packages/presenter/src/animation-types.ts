import type { MouthPose } from "./claudia/lipsync.js";
import type { PresenterPerformance } from "./performance.js";
import type { AssetProvenance } from "../../contracts/src/production-manifest.js";

export const CLAUDIA_PROVENANCE: AssetProvenance = {
  character: "Claudia",
  origin: "manual",
  sourceUrl: "https://claudia.gallery/claudia/",
  credit: "Claudia by anabology · AI-assisted animated adaptation",
  aiGenerated: false,
};

export interface PresenterSceneAnimation {
  sceneId: string;
  from: number;
  durationInFrames: number;
  motion: "full" | "reduced";
  mouth: MouthPose[];
  performance: PresenterPerformance;
}

/** Derived, serializable render data bound to the exact narration and timeline. */
export interface PresenterAnimation {
  version: 1;
  character: "claudia";
  fps: number;
  durationInFrames: number;
  audioSha256: string;
  manifestSha256: string;
  timelineSha256: string;
  scenes: PresenterSceneAnimation[];
}
