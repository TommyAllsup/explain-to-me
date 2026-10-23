import { resolve } from "node:path";
import { z } from "zod";
import { sha256, type CharacterTestProps, type PerformanceTiming } from "./motion.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const selectedVoiceSchema = z.object({
  version: z.literal("2"),
  selectedOn: z.string(),
  selection: z.string(),
  engine: z.literal("chatterbox"),
  voice: z.literal("chatterbox-bella"),
  speed: z.literal(1),
  referenceVoice: z.literal("af_bella"),
  referenceSha256: hash,
  approvedPerformance: z.object({
    directory: z.string().min(1),
    audioSha256: hash,
    timingSha256: hash,
    reportSha256: hash,
    renderPropsSha256: hash,
    videoSha256: hash,
  }),
}).passthrough();
export type SelectedVoice = z.infer<typeof selectedVoiceSchema>;

export function resolvePerformance(root: string, selected: SelectedVoice, override?: string) {
  return {
    directory: override === undefined ? resolve(root, selected.approvedPerformance.directory) : resolve(override),
    usesApprovedDefault: override === undefined,
  };
}

/** A default build must reproduce the approved take, not silently resynthesize it. */
export function verifyApprovedPerformance(selected: SelectedVoice, input: {
  wav: Buffer; timingBytes: Buffer; reportBytes: Buffer;
  timing: PerformanceTiming; props: CharacterTestProps;
}): void {
  const accepted = selected.approvedPerformance;
  if (input.timing.version !== 2 || input.timing.voice !== selected.voice || input.timing.referenceSha256 !== selected.referenceSha256) {
    throw new Error("Default performance must use the approved Chatterbox voice and Bella reference");
  }
  if (sha256(input.wav) !== accepted.audioSha256 || sha256(input.timingBytes) !== accepted.timingSha256 || sha256(input.reportBytes) !== accepted.reportSha256) {
    throw new Error("Default performance differs from the approved Chatterbox audio, timing, or provenance");
  }
  if (sha256(JSON.stringify(input.props, null, 2) + "\n") !== accepted.renderPropsSha256) {
    throw new Error("Default lip sync or acting differs from the approved Chatterbox performance; review changes explicitly with --performance");
  }
}
