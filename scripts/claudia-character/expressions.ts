import type { CharacterBeat } from "./motion.js";

export type FacialPose = {
  gazeX: number; gazeY: number; blink: number;
  openness: number; squint: number;
  browLeft: number; browRight: number; browTiltLeft: number; browTiltRight: number;
  cheek: number; smile: number;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const settle = (n: number) => { const t = clamp(n); return t * t * t * (10 + t * (-15 + 6 * t)); };
const hold = (t: number, start: number, arrive: number, leave: number, end: number) =>
  settle((t - start) / (arrive - start)) * (1 - settle((t - leave) / (end - leave)));

/** Full contact lasts at least one 24 fps frame; reopening is slower than closing. */
export function blinkAt(time: number, start: number): number {
  return ease((time - start) / .065) * (1 - ease((time - start - .115) / .14));
}

/** A small authored performance, tied to these six sentences rather than audio volume. */
export function facialAt(time: number, beats: CharacterBeat[]): FacialPose {
  const at = (i: number) => beats[i]!.startMs / 1000;
  const end = beats.at(-1)!.endMs / 1000;
  const welcome = hold(time, .08, .5, .95, 1.5);
  const reassure = hold(time, at(1) + .04, at(1) + .4, at(2) - .35, at(2) + .25);
  const explain = hold(time, at(2) - .18, at(2) + .35, at(3) - .35, at(3) + .25);
  const curious = hold(time, at(3) - .06, at(3) + .45, at(4) - .4, at(4) + .18);
  const caution = hold(time, at(4) + .02, at(4) + .55, at(5) - .55, at(5) + .05);
  const invite = hold(time, at(5) - .12, at(5) + .65, end + .1, end + .7);
  // The eyes find the diagram just before the hand opens. A second, shorter
  // look accompanies the question; she reconnects before explaining the catch.
  // Fast target changes with still holds avoid slow pupil drifting or jitter.
  const diagram = hold(time, at(2) - .32, at(2) - .2, at(2) + .52, at(2) + .66);
  const reflect = hold(time, at(3) + .13, at(3) + .25, at(3) + .73, at(3) + .87);
  const blinkStarts = [at(1) - .19, at(2) - .47, at(3) - .23, at(4) - .24, at(5) - .29];
  return {
    gazeX: .35 + diagram * 5.1 - reflect * 3.7 + invite * .2,
    gazeY: diagram * .6 - reflect * 1.8,
    blink: Math.max(...blinkStarts.map((start) => blinkAt(time, start))),
    openness: 1 + explain * .025 + curious * .045 - caution * .09,
    squint: welcome * .33 + reassure * .13 + caution * .18 + invite * .36,
    browLeft: welcome * .3 + reassure * .25 + explain * .65 + curious * 2.5 - caution * .25 + invite * 1.1,
    browRight: welcome * .2 + reassure * .15 + explain * .65 + curious * .35 - caution * .45 + invite * .65,
    browTiltLeft: curious * .6 - caution * .2 + invite * .2,
    browTiltRight: curious * -.15 + caution * .2 - invite * .1,
    cheek: welcome * .7 + reassure * .3 + invite * .85,
    smile: clamp(.15 + welcome * .42 + reassure * .2 + explain * .06 - caution * .12 + invite * .52),
  };
}
