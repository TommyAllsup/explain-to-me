import type { CharacterBeat } from "./motion.js";
import type { BodyPose } from "./posture.js";
import { facialAt, type FacialPose } from "./expressions.js";

export type ActingPose = {
  reveal: number; invite: number; body: BodyPose; headTilt: number; nod: number;
  face: FacialPose;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
// Minimum-jerk travel: zero speed and acceleration at a held pose.
export const settle = (n: number) => { const t = clamp(n); return t * t * t * (10 + t * (-15 + 6 * t)); };

function phrase(time: number, start: number, arrive: number, leave: number, end: number): number {
  return settle((time - start) / (arrive - start)) * (1 - settle((time - leave) / (end - leave)));
}

/** Acting beats have intent and holds. They are not a loop or a response to loudness. */
export function actingAt(time: number, beats: CharacterBeat[]): ActingPose {
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
    face: facialAt(time, beats),
  };
}
