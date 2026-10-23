import type { ActingPose } from "./claudia/acting.js";
import { facialAt, type FacialActingTrack, type FacialExpressionCue } from "./claudia/expressions.js";
import type { BodyPose } from "./claudia/posture.js";
import type { AlignedNarrationWord } from "../../contracts/src/narration-alignment.js";
type PerformanceGesture = "none" | "offer" | "present" | "small";
type PerformanceIntent = "welcome" | "explain" | "setup" | "reassure";
type PerformanceScene = { id: string; duration: number; words: AlignedNarrationWord[] };

type Window = { start: number; arrive: number; leave: number; end: number };
export type AlignedPerformanceBeat = {
  anchor: string; intent: PerformanceIntent; gesture: PerformanceGesture;
  start: number; end: number; firstWord: number; lastWord: number;
};
type GestureCue = Window & { kind: Exclude<PerformanceGesture,"none">; anchor: string; intensity: number };
type HeadCue = Window & { tilt: number; nod: number; anchor: string };
type StanceCue = Window & { x: number; y: number; roll: number };
export type PresenterPerformance = {
  version: 1;
  duration: number;
  beats: AlignedPerformanceBeat[];
  face: FacialActingTrack;
  gestures: GestureCue[];
  heads: HeadCue[];
  stances: StanceCue[];
};

const clamp = (x: number) => Math.max(0,Math.min(1,x));
const settle = (x: number) => { const t=clamp(x); return t*t*t*(10+t*(-15+6*t)); };
const hold = (t: number,w: Window) => settle((t-w.start)/Math.max(.01,w.arrive-w.start)) * (1-settle((t-w.leave)/Math.max(.01,w.end-w.leave)));
/** Sentence and pause boundaries provide sparse phrase accents for any script. */
export function alignPerformanceBeats(scene: PerformanceScene, index: number): AlignedPerformanceBeat[] {
  const groups: Array<{first: number; last: number}> = [];
  let first = 0;
  for (let i = 0; i < scene.words.length; i++) {
    const word = scene.words[i]!, next = scene.words[i + 1];
    const length = i - first + 1;
    if (!next || (length >= 3 && (/[.!?]$/.test(word.text) || next.start - word.end >= .32 || length >= 9))) {
      groups.push({first, last:i}); first = i + 1;
    }
  }
  let lastGesture = -5;
  return groups.map(({first, last}, i) => {
    const start = scene.words[first]!.start, end = scene.words[last]!.end;
    const question = /[?]$/.test(scene.words[last]!.text);
    const intent: PerformanceIntent = index === 0 && i === 0 ? "welcome" : question ? "setup" : i === groups.length - 1 && groups.length > 1 ? "reassure" : "explain";
    const gesture: PerformanceGesture = !question && start - lastGesture >= 4 ? (intent === "welcome" ? "offer" : i % 2 ? "small" : "present") : "none";
    if (gesture !== "none") lastGesture = start;
    return {anchor:scene.words.slice(first,last+1).map(w => w.text).join(" "), intent, gesture, start, end, firstWord:first, lastWord:last};
  });
}

function window(start: number,arrive: number,leave: number,end: number,duration: number): Window {
  const stop=Math.max(.05,duration-.12);
  const s=Math.max(.04,Math.min(start,stop-.03)),e=Math.max(s+.03,Math.min(end,stop));
  const a=Math.max(s+.01,Math.min(arrive,e-.02));
  const l=Math.max(a,Math.min(leave,e-.01));
  return {start:s,arrive:a,leave:l,end:e};
}

/** Build intentional phrase acting once; the render remains frame-derived and deterministic. */
export function buildPerformance(scene: PerformanceScene,index: number): PresenterPerformance {
  const duration=scene.duration;
  if (!Number.isFinite(duration)||duration<=0||!scene.words.length) throw new Error(`Missing performance duration or word alignment: ${scene.id}`);
  let previous=0;
  for (const word of scene.words) {
    if (!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<previous-.001||word.end<=word.start||word.end>duration+.001) throw new Error(`Invalid performance word interval in ${scene.id}`);
    previous=word.end;
  }
  const beats=alignPerformanceBeats(scene,index);
  const face: FacialActingTrack={version:1,source:"word-alignment",expressions:[],gaze:[],blinks:[]};
  const gestures: GestureCue[]=[],heads: HeadCue[]=[],stances: StanceCue[]=[];
  if (duration < 1) return {version:1,duration,beats,face,gestures,heads,stances};
  for (let i=0;i<beats.length;i++) {
    const beat=beats[i]!, next=beats[i+1];
    const reaction=beat.start;
    const expressionEnd=Math.min(next ? next.start+.15 : duration-.12,Math.max(reaction+1.35,beat.end+.85));
    const expressionWindow=window(reaction-.14,reaction+.24,Math.max(reaction+.4,expressionEnd-.5),expressionEnd,duration);
    const intents: Record<PerformanceIntent,FacialExpressionCue["intent"]>={welcome:"welcome",explain:"explain",setup:"curious",reassure:"reassure"};
    const strengths: Record<PerformanceIntent,number>={welcome:1.05,explain:.7,setup:.57,reassure:1};
    face.expressions.push({...expressionWindow,intent:intents[beat.intent],intensity:strengths[beat.intent],anchor:beat.anchor});

    const headWindow=window(reaction-.12,reaction+.35,Math.max(reaction+.42,beat.end+.14),Math.max(reaction+.9,beat.end+.7),duration);
    const direction: Record<PerformanceIntent,{tilt:number;nod:number}>={welcome:{tilt:-.8,nod:1.3},explain:{tilt:-.3,nod:.65},
      setup:{tilt:-1.1,nod:0},reassure:{tilt:.6,nod:.5}};
    heads.push({...headWindow,...direction[beat.intent],anchor:beat.anchor});

    if (beat.intent==="setup"||beat.intent==="reassure") {
      const thoughtful=beat.intent!=="reassure";
      stances.push({...window(beat.start-.25,beat.start+.55,beat.end+.3,beat.end+1.2,duration),
        x:thoughtful ? -1.05 : .65,y:thoughtful ? .2 : -.2,roll:thoughtful ? -.32 : .2});
    }
    if (beat.intent==="explain" && (beat.gesture==="present"||beat.gesture==="offer")) {
      face.gaze.push({...window(beat.start-.18,beat.start-.05,beat.start+.3,beat.start+.48,duration),x:-4.1,y:.45,anchor:beat.anchor});
    }

    if (beat.gesture!=="none") {
      const small=beat.gesture==="small";
      const begin=beat.start-.56;
      const arrive=beat.start+.46;
      const leave=Math.min(beat.end+(small?.28:.65),arrive+(small?.5:1.4));
      // Recover before the next cue, but preserve enough time for a relaxed return.
      const naturalEnd=leave+(small?.85:1.2);
      const nextPreparation=next ? next.start-.48 : duration-.2;
      const end=Math.min(naturalEnd,Math.max(arrive+.38,nextPreparation),duration-.2);
      const start=Math.max(.04,begin),preparation=small?.54:.72,minimumHold=.38,recovery=.72;
      const available=end-start;
      // The hand follows the forearm by up to .28s. Reserve room for that
      // overlap AND a relaxed return; clamping a late arrival against an early
      // end used to turn a crowded phrase into a 60ms forearm snap.
      // If this cannot fit, keep its head/face accent and omit the extra arm.
      if (available>=preparation+minimumHold+recovery) {
        const safeArrive=Math.max(start+preparation,Math.min(arrive,end-recovery-minimumHold));
        const safeLeave=Math.max(safeArrive+minimumHold,Math.min(leave,end-recovery));
        const travel=window(start,safeArrive,safeLeave,end,duration);
        gestures.push({...travel,kind:beat.gesture,anchor:beat.anchor,intensity:Math.min(1,available/(small?1.9:2.35))});
      }
    }

  }
  // Blink at a pause near a natural interval, clear of scene edits.
  const gaps=scene.words.slice(1).map((word,i) => ({at:word.start-.23,gap:word.start-scene.words[i]!.end}));
  let last=.2;
  for (let ideal=3.8+(index%2)*.25;ideal<duration-.65;ideal+=4.1) {
    const candidates=gaps.filter((gap) => gap.at-last>2.3 && Math.abs(gap.at-ideal)<1.25 && gap.at>.3 && gap.at<duration-.6);
    const best=candidates.sort((a,b) => Math.abs(a.at-ideal)-Math.abs(b.at-ideal)-Math.min(a.gap,.4)+Math.min(b.gap,.4))[0];
    if (best) {face.blinks.push(best.at);last=best.at;}
  }
  return {version:1,duration,beats,face,gestures,heads,stances};
}

function bodyAt(time: number,track: PresenterPerformance): BodyPose {
  const body: BodyPose={chestX:0,chestY:0,chestRoll:0,shoulder:0,upperArm:0,forearm:0,handOpen:0,passiveLag:0};
  for (const cue of track.gestures) {
    const kind=cue.kind,amount=cue.intensity;
    const chest=hold(time,cue)*amount;
    const shifted=(start: number,arrive: number,leave: number,end: number,t=time) => hold(t,window(cue.start+start,cue.arrive+arrive,cue.leave+leave,cue.end+end,track.duration))*amount;
    const arm=shifted(.12,.08,-.08,-.1),forearm=shifted(.23,.18,-.16,-.18),hand=shifted(.32,.28,-.08,-.1);
    const amplitude=kind==="present"?.73:kind==="offer"?.52:.23;
    body.chestX+=chest*(kind==="present"?3.2:kind==="offer"?2:.6);
    body.chestY+=chest*(kind==="present"?-1.15:-.6);
    body.chestRoll+=chest*(kind==="present"?1.05:kind==="offer"?.6:.15);
    body.shoulder+=hold(time,{start:cue.start+.04,arrive:cue.start+.28,leave:cue.start+.36,end:cue.arrive+.32})*amount*(kind==="small"?.15:.35);
    body.upperArm+=arm*amplitude;
    body.forearm+=forearm*amplitude;
    body.handOpen+=hand*(kind==="present"?.85:kind==="offer"?.8:.35);
    body.passiveLag+=hold(time-.13,cue)*amount*.6;
  }
  for (const cue of track.stances) {const weight=hold(time,cue);body.chestX+=cue.x*weight;body.chestY+=cue.y*weight;body.chestRoll+=cue.roll*weight;}
  // Soft bounds only matter if tightly spaced authored cues overlap.
  body.chestX=5*Math.tanh(body.chestX/5);body.chestY=2*Math.tanh(body.chestY/2);body.chestRoll=1.6*Math.tanh(body.chestRoll/1.6);
  for (const key of ["shoulder","upperArm","forearm","handOpen","passiveLag"] as const) body[key]=Math.tanh(body[key]);
  return body;
}

/** The same body and face rig, with no loops or speech-volume-driven movements. */
export function presenterPoseAt(time: number,globalTime: number,track: PresenterPerformance,motion: "full" | "reduced" = "full"): ActingPose {
  const body=bodyAt(time,track),face=facialAt(time,track.face);
  // This sub-pixel breath uses a global clock, so the torso cannot snap at a cut.
  body.chestY+=Math.sin(globalTime*Math.PI*2/5.4)*.28;
  face.smile=clamp(face.smile+.15);face.cheek=clamp(face.cheek+.12);face.squint=clamp(face.squint+.035);
  let headTilt=-bodyAt(time-.09,track).chestRoll*.48,nod=0;
  for (const cue of track.heads) {const weight=hold(time,cue);headTilt+=cue.tilt*weight;nod+=cue.nod*weight;}
  if (motion === "reduced") {
    for (const key of Object.keys(body) as Array<keyof BodyPose>) body[key] = 0;
    headTilt = 0; nod = 0;
    face.gazeX *= .35; face.gazeY *= .35;
  }
  return {body,face,headTilt:2.3*Math.tanh(headTilt/2.3),nod:1.8*Math.tanh(nod/1.8),reveal:body.forearm,invite:face.smile*.25};
}
