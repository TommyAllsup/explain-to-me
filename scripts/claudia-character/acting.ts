import type { CharacterBeat } from "./motion.js";

export type ActingPose = {
  reveal: number; invite: number; lean: number; headTilt: number; nod: number;
  gaze: number; brow: number; smile: number; blink: number;
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
  const prepare = phrase(time, at(2) - .36, at(2) + .72, at(3) + .32, at(3) + 1.85);
  const invite = phrase(time, at(5) + .1, at(5) + .95, duration - .65, duration + .25);
  const thought = phrase(time, at(3) + .25, at(3) + .9, at(4) - .25, at(4) + .75);
  const caution = phrase(time, at(4) + .25, at(4) + .95, at(5) - .8, at(5) + .15);
  const welcome = phrase(time, .18, .5, .65, 1.2);
  const gaze = phrase(time, at(2) - .22, at(2) + .05, at(2) + .55, at(2) + .85) * 2.2;
  const blinkTimes = [at(2) - .27, at(3) + .62, at(4) + .55, at(5) - .18];
  const blink = Math.max(...blinkTimes.map((b) => phrase(time, b - .055, b + .025, b + .055, b + .16)));
  return {
    reveal, invite, lean: prepare * -.55 + invite * -.22,
    headTilt: thought * -2.2 + caution * .65 + invite * -.7,
    nod: welcome * 1.6 + caution * .7,
    gaze, brow: thought * 1.8 + caution * .5 + invite * .5,
    smile: .22 + welcome * .23 + invite * .32, blink,
  };
}
