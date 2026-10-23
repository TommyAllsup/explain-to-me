export type FacialPose = {
  gazeX: number; gazeY: number; blink: number;
  openness: number; squint: number;
  browLeft: number; browRight: number; browTiltLeft: number; browTiltRight: number;
  cheek: number; smile: number;
};
export type AlignedFacialWord = { text: string; start: number; end: number };
type ExpressionIntent = "welcome" | "reassure" | "explain" | "curious" | "caution" | "invite"
  | "emphasis" | "questionAccent" | "contrast";
type FacialWindow = { start: number; arrive: number; leave: number; end: number };
export type FacialExpressionCue = FacialWindow & { intent: ExpressionIntent; intensity: number; anchor: string };
export type FacialGazeCue = FacialWindow & { x: number; y: number; anchor: string };
export type FacialActingTrack = {
  version: 1;
  source: "word-alignment";
  expressions: FacialExpressionCue[];
  gaze: FacialGazeCue[];
  blinks: number[];
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

const expressionWeights: Record<ExpressionIntent, Partial<Omit<FacialPose, "gazeX" | "gazeY" | "blink">>> = {
  welcome: { squint: .3, browLeft: .3, browRight: .2, cheek: .65, smile: .4 },
  reassure: { squint: .13, browLeft: .25, browRight: .15, cheek: .3, smile: .2 },
  explain: { openness: .02, browLeft: .45, browRight: .45, smile: .06 },
  curious: { openness: .035, browLeft: 1.65, browRight: .3, browTiltLeft: .5, browTiltRight: -.15 },
  caution: { openness: -.075, squint: .16, browLeft: -.2, browRight: -.4, browTiltLeft: -.18, browTiltRight: .18, smile: -.1 },
  invite: { squint: .28, browLeft: .8, browRight: .45, browTiltLeft: .15, browTiltRight: -.08, cheek: .72, smile: .46 },
  emphasis: { openness: .012, browLeft: .42, browRight: .42 },
  questionAccent: { openness: .018, browLeft: .7, browRight: .18, browTiltLeft: .12 },
  contrast: { openness: -.012, browLeft: -.2, browRight: -.12 },
};

export function facialAt(time: number, track: FacialActingTrack): FacialPose {
  const pose: FacialPose = { gazeX: .35, gazeY: 0, blink: 0, openness: 1, squint: 0,
    browLeft: 0, browRight: 0, browTiltLeft: 0, browTiltRight: 0, cheek: 0, smile: .15 };
  for (const cue of track.expressions) {
    const weight = hold(time, cue.start, cue.arrive, cue.leave, cue.end) * cue.intensity;
    for (const [key, amount] of Object.entries(expressionWeights[cue.intent])) {
      pose[key as keyof typeof expressionWeights[ExpressionIntent]] += amount * weight;
    }
  }
  for (const cue of track.gaze) {
    const weight = hold(time, cue.start, cue.arrive, cue.leave, cue.end);
    pose.gazeX += cue.x * weight;
    pose.gazeY += cue.y * weight;
  }
  pose.blink = Math.max(0, ...track.blinks.map((start) => blinkAt(time, start)));
  pose.smile = clamp(pose.smile); pose.cheek = clamp(pose.cheek); pose.squint = clamp(pose.squint);
  return pose;
}
