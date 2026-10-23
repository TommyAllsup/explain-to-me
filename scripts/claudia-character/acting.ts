import type { CharacterBeat } from "./motion.js";
import type { BodyPose } from "./posture.js";
import { facialAt, type FacialPose, type FacialActingTrack } from "./expressions.js";

export type ActingPose = {
  reveal: number; invite: number; body: BodyPose; headTilt: number; nod: number;
  face: FacialPose;
};
export type ActingOptions = { retimeBody?: boolean; facialActing?: FacialActingTrack };

// The accepted Bella take is the authored gesture clock, in exact 24 kHz
// sample boundaries. Retiming changes when its poses happen, not the rig or
// the chest/shoulder/arm/finger overlap that made the gesture feel connected.
const referenceBoundaries = [0, 28584, 64584, 129384, 190584, 290184, 353344].map((sample) => sample / 24000);
const referenceBeats: CharacterBeat[] = referenceBoundaries.slice(0, -1).map((start, i) => ({
  id: `body-reference-${i}`, startMs: start * 1000, endMs: referenceBoundaries[i + 1]! * 1000,
  text: "Authored body gesture timing", gesture: "settle",
}));

/** Monotone cubic time warp: hit every speech boundary without a velocity jump. */
function bodyTimeAt(time: number, beats: CharacterBeat[]): number {
  if (!Number.isFinite(time) || beats.length !== referenceBeats.length || beats[0]!.startMs !== 0
    || beats.some((beat, i) => !Number.isFinite(beat.startMs) || !Number.isFinite(beat.endMs)
      || beat.endMs <= beat.startMs || (i > 0 && Math.abs(beat.startMs - beats[i - 1]!.endMs) > .001))) {
    throw new Error("Body retiming needs six continuous, increasing speech beats starting at zero");
  }
  const boundaries = [...beats.map((beat) => beat.startMs / 1000), beats.at(-1)!.endMs / 1000];
  const widths = boundaries.slice(1).map((end, i) => end - boundaries[i]!);
  const slopes = widths.map((width, i) => (referenceBoundaries[i + 1]! - referenceBoundaries[i]!) / width);
  // Weighted harmonic tangents preserve monotonicity through uneven sentences.
  // Unlike a separate ease on every sentence, shared tangents do not force
  // the whole body to stop and restart at each spoken boundary.
  const tangents = [slopes[0]!, ...slopes.slice(1).map((right, i) => {
    const left = slopes[i]!, before = widths[i]!, after = widths[i + 1]!;
    const a = 2 * after + before, b = after + 2 * before;
    return (a + b) / (a / left + b / right);
  }), slopes.at(-1)!];
  if (time <= boundaries[0]!) return referenceBoundaries[0]! + (time - boundaries[0]!) * tangents[0]!;
  const last = boundaries.length - 1;
  if (time >= boundaries[last]!) return referenceBoundaries[last]! + (time - boundaries[last]!) * tangents[last]!;
  const i = boundaries.findIndex((end) => end > time) - 1;
  const width = widths[i]!, t = (time - boundaries[i]!) / width;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * referenceBoundaries[i]!
    + (t3 - 2 * t2 + t) * width * tangents[i]!
    + (-2 * t3 + 3 * t2) * referenceBoundaries[i + 1]!
    + (t3 - t2) * width * tangents[i + 1]!;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
// Minimum-jerk travel: zero speed and acceleration at a held pose.
export const settle = (n: number) => { const t = clamp(n); return t * t * t * (10 + t * (-15 + 6 * t)); };

function phrase(time: number, start: number, arrive: number, leave: number, end: number): number {
  return settle((time - start) / (arrive - start)) * (1 - settle((time - leave) / (end - leave)));
}

/** Acting beats have intent and holds. They are not a loop or a response to loudness. */
export function actingAt(time: number, beats: CharacterBeat[], options: ActingOptions = {}): ActingPose {
  const facialTime = time, facialBeats = beats;
  if (options.retimeBody) {
    time = bodyTimeAt(time, beats);
    beats = referenceBeats;
  }
  const at = (i: number) => beats[i]!.startMs / 1000;
  const duration = beats.at(-1)!.endMs / 1000;
  const reveal = phrase(time, at(2) - .15, at(2) + 1.0, at(3) + .15, at(3) + 1.65);
  const invite = phrase(time, at(5) + .1, at(5) + .95, duration - .65, duration + .25);
  // A gesture starts in the chest. The shoulder prepares, then softens as the
  // upper arm, forearm and fingers arrive. Recovery overlaps in reverse order.
  const support = (t: number) => phrase(t, at(2) - .52, at(2) + .72, at(3) - .05, at(3) + 2);
  const closingSupport = (t: number) => phrase(t, at(5) - .35, at(5) + .65, duration - .65, duration + .45);
  const thinking = (t: number) => phrase(t, at(3) + .25, at(3) + .9, at(4) - .25, at(4) + .75);
  const warning = (t: number) => phrase(t, at(4) + .25, at(4) + .95, at(5) - .8, at(5) + .15);
  const releaseTension = (t: number) => phrase(t, at(2) + .65, at(2) + 1.3, at(3) - .1, at(3) + .85);
  const chestRoll = (t: number) => support(t) * 1.65 + closingSupport(t) * .95
    - thinking(t) * .55 + warning(t) * .3 - releaseTension(t) * .25;
  const shoulder = phrase(time, at(2) - .48, at(2) + .03, at(2) + .08, at(2) + .9)
    + .6 * phrase(time, at(5) - .31, at(5) + .18, at(5) + .23, at(5) + 1.05);
  const upperArm = phrase(time, at(2) - .31, at(2) + .8, at(3) + .14, at(3) + 1.72)
    + .62 * phrase(time, at(5) - .1, at(5) + .75, duration - .65, duration + .35);
  const handOpen = phrase(time - .1, at(2) - .15, at(2) + 1, at(3) + .15, at(3) + 1.65)
    + .62 * phrase(time - .1, at(5) + .1, at(5) + .95, duration - .65, duration + .25);
  const thought = thinking(time);
  const caution = warning(time);
  const welcome = phrase(time, .18, .5, .65, 1.2);
  const body: BodyPose = {
    chestX: support(time) * 4.5 + closingSupport(time) * 2.5 - thought * 2.4 + caution * 1.2 - releaseTension(time) * .8,
    chestY: support(time) * -1.7 + closingSupport(time) * -.9 + thought * .65 + releaseTension(time) * .5,
    chestRoll: chestRoll(time), shoulder, upperArm,
    forearm: reveal + invite * .62, handOpen,
    passiveLag: support(time - .12) + closingSupport(time - .12) * .5,
  };
  return {
    reveal, invite, body,
    // Counterbalance the chest with a delayed local rotation, while the head's
    // root inherits the spine transform immediately and stays attached.
    headTilt: thought * -2.2 + caution * .65 + invite * -.7 - chestRoll(time - .1) * .55,
    nod: welcome * 1.6 + caution * .7,
    face: facialAt(facialTime, facialBeats, options.facialActing),
  };
}
