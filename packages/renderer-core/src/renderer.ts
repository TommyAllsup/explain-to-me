import type { LocalAssetIntent, ProductionManifest } from "../../contracts/src/production-manifest.js";
import type { Timeline } from "../../timeline/src/timeline.js";
import type { PresenterAnimation } from "../../presenter/src/animation-types.js";

export type RenderAsset = {
  /** Canonical, parent-approved local path to the image bytes. */
  path: string;
  sha256: string;
  mimeType: LocalAssetIntent["mimeType"];
};

export interface RenderRequest {
  manifest: ProductionManifest;
  timeline: Timeline;
  assets?: Record<string, RenderAsset>;
  presenterAnimation?: PresenterAnimation;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  concurrency?: number;
}

export interface RenderResult {
  outputPath: string;
  renderer: string;
  browserExecutable: string;
  version: string;
  durationInFrames: number;
  wallTimeMs: number;
  warnings: string[];
  network: { externalAttempts: string[] };
}
