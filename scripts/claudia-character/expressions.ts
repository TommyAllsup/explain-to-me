import type { CharacterBeat } from "./motion.js";

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

const wordKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/gu, "");

/** Author intent around the new recording's aligned words, not Bella's old clock. */
export function buildFacialActingTrack(words: AlignedFacialWord[], beats: CharacterBeat[]): FacialActingTrack {
  if (beats.length !== 6 || !words.length) throw new Error("The Claudia facial performance requires six aligned sentences");
  let previousEnd = 0;
  for (const word of words) {
    if (!wordKey(word.text) || !Number.isFinite(word.start) || !Number.isFinite(word.end)
      || word.start < 0 || word.start < previousEnd - .001 || word.end <= word.start) throw new Error("Invalid facial word alignment");
    previousEnd = word.end;
  }
  if (previousEnd > beats.at(-1)!.endMs / 1000 + .001) throw new Error("Facial word alignment extends past the recording");
  let cursor = 0;
  const sentences = beats.map((beat) => {
    const tokens = beat.text.split(/\s+/u).map(wordKey).filter(Boolean);
    const aligned = words.slice(cursor, cursor + tokens.length);
    if (tokens.length !== aligned.length || tokens.some((token, i) => token !== wordKey(aligned[i]!.text))) {
      throw new Error("Facial word alignment must match the complete reviewed script");
    }
    cursor += tokens.length;
    return aligned;
  });
  if (cursor !== words.length) throw new Error("Facial word alignment has extra words");
  const find = (sentence: number, token: string) => {
    const word = sentences[sentence]!.find((candidate) => wordKey(candidate.text) === wordKey(token));
    if (!word) throw new Error(`Missing facial acting anchor: ${token}`);
    return word;
  };
  const window = (first: AlignedFacialWord, last: AlignedFacialWord, accent = false): FacialWindow => {
    const start = Math.max(0, first.start - (accent ? .1 : .16));
    const arrive = Math.max(start + .01, Math.min(first.start + (accent ? .09 : .28), last.end - .04));
    const leave = Math.max(arrive, last.end - (accent ? .015 : .08));
    return { start, arrive, leave, end: Math.max(leave + .01, last.end + (accent ? .23 : .35)) };
  };
  const intents = ["welcome", "reassure", "explain", "curious", "caution", "invite"] as const;
  const expressions: FacialExpressionCue[] = sentences.map((sentence, i) => ({
    ...window(sentence[0]!, sentence.at(-1)!), intent: intents[i]!, intensity: 1,
    anchor: sentence.map((word) => word.text).join(" "),
  }));
  const accent = (sentence: number, token: string, intent: ExpressionIntent, intensity: number) => {
    const word = find(sentence, token);
    expressions.push({ ...window(word, word, true), intent, intensity, anchor: word.text });
  };
  // Only meaningful contrasts receive an accent. Syllable-by-syllable eyebrow
  // pulses would make the face compete with the speech and the mouth shapes.
  accent(2, "remembers", "emphasis", .65);
  accent(3, "forget", "questionAccent", .9);
  accent(4, "yesterday's", "contrast", .65);
  accent(4, "today's", "emphasis", .9);
  accent(5, "keep", "questionAccent", .45);
  accent(5, "refresh", "questionAccent", .85);

  const cache = find(2, "cache"), remembers = find(2, "remembers");
  const interesting = find(3, "interesting"), question = find(3, "question");
  const diagramLeave = Math.max(cache.start + .12, Math.min(remembers.end, cache.end + .28));
  const reflectLeave = Math.max(interesting.start + .2, Math.min(question.end, interesting.end + .18));
  const gaze: FacialGazeCue[] = [
    { start: Math.max(0, cache.start - .18), arrive: Math.max(.01, cache.start - .06),
      leave: diagramLeave, end: diagramLeave + .13, x: 5.1, y: .6, anchor: cache.text },
    { start: interesting.start - .05, arrive: interesting.start + .07,
      leave: reflectLeave, end: reflectLeave + .13, x: -3.7, y: -1.8, anchor: interesting.text },
  ];
  // Put relaxed blinks at thought boundaries, finishing before the next phrase
  // is established. Sparse events keep the closing question fully engaged.
  const blinks: number[] = [];
  for (const sentence of sentences.slice(1)) {
    const start = Math.max(0, sentence[0]!.start - .255);
    if (start >= .3 && (!blinks.length || start - blinks.at(-1)! >= 1.6)) blinks.push(start);
  }
  return { version: 1, source: "word-alignment", expressions, gaze, blinks };
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

function alignedFacialAt(time: number, track: FacialActingTrack): FacialPose {
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

/** A small authored performance, tied to these six sentences rather than audio volume. */
export function facialAt(time: number, beats: CharacterBeat[], track?: FacialActingTrack): FacialPose {
  if (track) return alignedFacialAt(time, track);
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
