import type { ProductionManifest } from "../../contracts/src/production-manifest.js";

export const MIN_PACE = 0.65;
export const MAX_PACE = 1.25;
export const APPLE_BASE_RATE_WPM = 170;

/** Absolute multipliers: passage overrides scene, which overrides the project default. */
export interface NarrationPacing {
  default: number;
  scenes?: Record<string, number>;
  passages?: Record<string, number>;
}

export type DurationPolicy = "paced" | "strict";

export function validatePacing(
  pacing: NarrationPacing,
  manifest?: ProductionManifest,
  passageOrigins?: Record<string, string>,
): void {
  if (!isRecord(pacing)) throw new Error("Pacing must be an object");
  validatePace(pacing.default, "Pacing default");
  const sceneIds = manifest && new Set(manifest.scenes.map((scene) => scene.id));
  const passageIds = manifest && new Set(manifest.scenes.flatMap((scene) => scene.narration.map((chunk) => ownValue(passageOrigins, chunk.id) ?? chunk.id)));
  for (const [name, values, ids, maximum] of [
    ["scenes", pacing.scenes, sceneIds, 16],
    ["passages", pacing.passages, passageIds, 128],
  ] as const) {
    if (values === undefined) continue;
    if (!isRecord(values)) throw new Error(`Pacing ${name} must be an object of IDs and multipliers`);
    if (Object.keys(values).length > maximum) throw new Error(`Pacing ${name} supports at most ${maximum} overrides`);
    for (const [id, pace] of Object.entries(values)) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id)) throw new Error(`Invalid pacing ${name} ID: ${id}`);
      if (ids && !ids.has(id)) throw new Error(`Unknown pacing ${name} ID: ${id}`);
      validatePace(pace, `Pacing ${name}.${id}`);
    }
  }
}

/** Validate IDs against the full plan separately, before selecting a preview subset. */
export function resolveChunkPacing(
  manifest: ProductionManifest,
  pacing: NarrationPacing = { default: 1 },
  passageOrigins?: Record<string, string>,
): Record<string, number> {
  validatePacing(pacing);
  return Object.fromEntries(manifest.scenes.flatMap((scene) => scene.narration.map((chunk) => [
    chunk.id,
    ownValue(pacing.passages, ownValue(passageOrigins, chunk.id) ?? chunk.id) ?? ownValue(pacing.scenes, scene.id) ?? pacing.default,
  ])));
}

export function appleRateForPace(pace: number): number {
  validatePace(pace, "Pace");
  return Math.round(APPLE_BASE_RATE_WPM * pace);
}

/** Claudia's approved delivery and phoneme timing require the original speech rate. */
export function assertChatterboxPacing(paceByChunkId: Record<string, number>): void {
  if (Object.values(paceByChunkId).some((pace) => pace !== 1)) {
    throw new Error("Claudia Chatterbox preserves natural delivery and supports only pace 1. Remove non-1 pacing overrides or select a different narration backend. No speech or facial timing was changed.");
  }
}

export function assertPacedDuration(policy: DurationPolicy, measuredMs: number, targetMs: number): void {
  if (policy === "strict" && Math.abs(measuredMs - targetMs) > 1_000) {
    throw new Error(`Strict project duration requested ${(targetMs / 1_000).toFixed(3)}s, but the reviewed narration measured ${(measuredMs / 1_000).toFixed(3)}s at the chosen pacing (tolerance ±1.000s). Disable strict duration fitting, change the target, or explicitly revise pacing or reviewed narration. No pacing correction, narration rewrite, speech truncation, or silence padding was performed.`);
  }
}

function validatePace(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < MIN_PACE || value > MAX_PACE) {
    throw new Error(`${label} must be a multiplier between ${MIN_PACE} and ${MAX_PACE}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownValue<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}
