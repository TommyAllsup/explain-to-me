import type { PerformanceTiming } from "./motion.js";

/** Continuous rig controls, all in [0, 1]. Width .5 is the relaxed mouth. */
export type MouthPose = {
  open: number;
  width: number;
  round: number;
  closure: number;
  teeth: number;
  tongue: number;
};

type Phoneme = PerformanceTiming["phonemes"][number];
type Articulation = Phoneme & { pose: MouthPose; seal: boolean };
const REST: MouthPose = { open: 0, width: .5, round: 0, closure: 0, teeth: 0, tongue: 0 };
const KEYS = ["open", "width", "round", "closure", "teeth", "tongue"] as const;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const target = (open: number, width: number, round = 0, teeth = 0, tongue = 0): MouthPose =>
  ({ open, width, round, closure: 0, teeth, tongue });

/** Broad articulatory families; these are authored visemes, not facial capture. */
function articulation(phoneme: Phoneme): Articulation | undefined {
  const symbol = phoneme.phoneme.replace(/[ˈˌːˑ]/gu, "");
  let pose: MouthPose;
  let seal = false;
  if (/^[bmp]$/u.test(symbol)) { pose = target(.03, .55); seal = true; }
  else if (/^[fv]$/u.test(symbol)) pose = target(.14, .61, 0, .95);
  else if (/^[uwʊ]$/u.test(symbol)) pose = target(.27, .23, .94);
  else if (/^[oɔɒ]$/u.test(symbol)) pose = target(.53, .32, .8);
  else if (/^[iɪᵻj]$/u.test(symbol)) pose = target(.30, .79, 0, .18);
  else if (/^[eɛ]$/u.test(symbol)) pose = target(.44, .74, 0, .14);
  else if (/^[aɑæ]$/u.test(symbol)) pose = target(.81, symbol === "æ" ? .72 : .62);
  else if (/^[ɐəɚɜʌ]$/u.test(symbol)) pose = target(.43, .54, .08);
  else if (/^[ɹr]$/u.test(symbol)) pose = target(.29, .43, .36);
  else if (/^[θð]$/u.test(symbol)) pose = target(.24, .6, 0, .13, .86);
  else if (symbol === "l") pose = target(.32, .6, 0, .08, .62);
  else if (/^[sztdnŋkɡgh]$/u.test(symbol)) pose = target(.20, .6, 0, .24);
  else if (/^(ʃ|ʒ|tʃ|dʒ)$/u.test(symbol)) pose = target(.24, .42, .5, .13);
  // Spaces, punctuation and timing-only stress markers do not have mouth poses.
  else return undefined;
  return { ...phoneme, pose, seal };
}

function speechIntervals(phonemes: Phoneme[]): Articulation[] {
  const speech: Articulation[] = [];
  let stressStart: number | undefined;
  for (const phone of phonemes) {
    if (/^[ˈˌ]+$/u.test(phone.phoneme)) {
      stressStart = Math.min(stressStart ?? phone.start, phone.start);
      continue;
    }
    if (/^[ːˑ]+$/u.test(phone.phoneme)) {
      const previous = speech.at(-1);
      if (previous && phone.start <= previous.end + .001) previous.end = Math.max(previous.end, phone.end);
      continue;
    }
    const parsed = phone.end > phone.start ? articulation(phone) : undefined;
    if (parsed) {
      // Kokoro emits duration-bearing stress/length tokens. They belong to the
      // adjacent sound visually, and must not insert an invented mouth rest.
      if (stressStart !== undefined) parsed.start = Math.min(parsed.start, stressStart);
      speech.push(parsed);
    }
    stressStart = undefined;
  }
  return speech;
}

function influence(time: number, start: number, end: number): number {
  // Overlapping support anticipates the next vowel and carries its predecessor
  // through the join. Small word gaps retain motion; longer pauses relax.
  const before = .085;
  const after = .085;
  if (time < start) return ease((time - (start - before)) / before);
  if (time > end) return 1 - ease((time - end) / after);
  return 1;
}

function lipSeal(time: number, phoneme: Articulation, fps: number): number {
  // A bilabial prepares before its sound. Give even a short /p/ a full contact
  // interval at the output frame rate; RMS must never open a sealed /m/.
  const center = (phoneme.start + phoneme.end) / 2 - .018;
  const halfHold = Math.max((phoneme.end - phoneme.start) / 2, .5 / fps);
  const start = center - halfHold;
  const end = center + halfHold;
  if (time < start) return ease((time - (start - .075)) / .075);
  if (time > end) return 1 - ease((time - end) / .085);
  return 1;
}

/**
 * Build continuous mouth controls from Kokoro's second-based IPA intervals and
 * normalized speech energy. Samples are frame-centred like mouthEnvelope().
 * Timed articulation controls shape; energy adjusts jaw strength only. This is
 * a deterministic viseme approximation, not measured human lip movement.
 */
export function buildMouthTrack(phonemes: Phoneme[], rms: number[], fps: number): MouthPose[] {
  if (!Number.isInteger(fps) || fps < 1 || fps > 240) throw new Error("Expected integer fps in 1..240");
  if (rms.some((level) => !Number.isFinite(level) || level < 0 || level > 1)) throw new Error("Expected normalized finite mouth energy in 0..1");
  if (phonemes.some((phone) => !Number.isFinite(phone.start) || !Number.isFinite(phone.end) || phone.start < 0 || phone.end < phone.start)) {
    throw new Error("Expected valid finite phoneme intervals");
  }
  const speech = speechIntervals(phonemes);
  let finalAudible = rms.length - 1;
  while (finalAudible >= 0 && rms[finalAudible]! <= .01) finalAudible--;
  const tailStarts = finalAudible < rms.length - 1 ? (finalAudible + 1) / fps : Infinity;
  return rms.map((_, frame) => {
    const time = (frame + .5) / fps;
    const blended: MouthPose = { open: 0, width: 0, round: 0, closure: 0, teeth: 0, tongue: 0 };
    let weight = 0;
    let seal = 0;
    for (const phone of speech) {
      const contribution = influence(time, phone.start, phone.end);
      weight += contribution;
      for (const key of KEYS) blended[key] += phone.pose[key] * contribution;
      if (phone.seal) seal = Math.max(seal, lipSeal(time, phone, fps));
    }
    // Include rest when the remaining support is below one. Normalizing a lone
    // fading phone to 100% would cause a snap at every phrase boundary.
    for (const key of KEYS) blended[key] = (blended[key] + REST[key] * Math.max(0, 1 - weight)) / Math.max(1, weight);
    // A compact symmetric energy filter avoids chatter and permits preparation.
    const energy = [-2, -1, 0, 1, 2].reduce((sum, offset, index) =>
      sum + (rms[frame + offset] ?? 0) * [.06, .24, .4, .24, .06][index]!, 0);
    const activity = clamp((energy - .005) / .18) * (Number.isFinite(tailStarts) ? ease((tailStarts - time) / .065) : 1);
    for (const key of KEYS) blended[key] = REST[key] + (blended[key] - REST[key]) * activity;
    blended.open *= (.60 + .40 * Math.sqrt(energy)) * (1 - seal);
    blended.width += (.55 - blended.width) * seal * .5;
    blended.round *= 1 - seal;
    // Teeth emerge through the small opening before the jaw has fully released.
    // A linear mask here compounds two crossfades into a visible one-frame pop.
    blended.teeth *= Math.sqrt(1 - seal);
    blended.tongue *= Math.sqrt(1 - seal);
    blended.closure = seal;
    for (const key of KEYS) blended[key] = Math.round(clamp(blended[key]) * 10000) / 10000;
    return blended;
  });
}
