import type { ActingPose } from "../claudia-character/acting.js";
import { facialAt, type FacialActingTrack, type FacialExpressionCue } from "../claudia-character/expressions.js";
import type { BodyPose } from "../claudia-character/posture.js";
import type { ExplainerScene, PerformanceDirection, PerformanceGesture, PerformanceIntent } from "./types.js";

type Window = { start: number; arrive: number; leave: number; end: number };
export type AlignedPerformanceBeat = {
  anchor: string; intent: PerformanceIntent; gesture: PerformanceGesture;
  start: number; end: number; firstWord: number; lastWord: number;
};
type GestureCue = Window & { kind: Exclude<PerformanceGesture,"none">; anchor: string; intensity: number };
type HeadCue = Window & { tilt: number; nod: number; anchor: string };
type StanceCue = Window & { x: number; y: number; roll: number };
export type ExplainerPerformance = {
  version: 1;
  duration: number;
  beats: AlignedPerformanceBeat[];
  face: FacialActingTrack;
  gestures: GestureCue[];
  heads: HeadCue[];
  stances: StanceCue[];
  deadpans: Window[];
};

const clamp = (x: number) => Math.max(0,Math.min(1,x));
const settle = (x: number) => { const t=clamp(x); return t*t*t*(10+t*(-15+6*t)); };
const hold = (t: number,w: Window) => settle((t-w.start)/Math.max(.01,w.arrive-w.start)) * (1-settle((t-w.leave)/Math.max(.01,w.end-w.leave)));
const tokens = (text: string) => text.toLowerCase().replaceAll("’", "'").match(/[a-z0-9]+(?:'[a-z0-9]+)?/gu) ?? [];
const lerp = (a: number,b: number,t: number) => a+(b-a)*t;
const defaultGesture: Record<PerformanceIntent,PerformanceGesture> = {welcome:"offer",explain:"present",setup:"none",payoff:"small",aside:"none",reassure:"small"};

/** Prefer the requested payoff word; alternatives support older approved scripts. */
export function visualCueAt(scene: ExplainerScene,...anchors: string[]): number {
  for (const anchor of anchors) {
    const key=tokens(anchor).join("");
    const word=scene.words.find((candidate) => tokens(candidate.text).join("")===key);
    if (word) return word.start;
  }
  throw new Error(`Missing visual timing anchor in ${scene.id}: ${anchors.join(" / ")}`);
}

/** Match reviewed phrases to measured words. Ambiguous cues require an occurrence. */
export function alignPerformanceBeats(scene: ExplainerScene): AlignedPerformanceBeat[] {
  const mapped=scene.words.flatMap((word,index) => tokens(word.text).map((token) => ({token,index})));
  const fallback: PerformanceDirection = {beats: scene.words.length ? [{anchor:scene.words[0]!.text,intent:"explain",gesture:"present",occurrence:1}] : []};
  return (scene.performance ?? fallback).beats.map((beat) => {
    const phrase=tokens(beat.anchor);
    const matches=mapped.flatMap((word,i) => phrase.length && phrase.every((token,j) => mapped[i+j]?.token===token) ? [i] : []);
    if (!matches.length || (!beat.occurrence && matches.length>1)) throw new Error(`Missing or ambiguous performance anchor in ${scene.id}: ${beat.anchor}`);
    const match=matches[(beat.occurrence??1)-1];
    if (match===undefined) throw new Error(`Invalid performance occurrence in ${scene.id}: ${beat.anchor}`);
    const firstWord=mapped[match]!.index,lastWord=mapped[match+phrase.length-1]!.index;
    return {anchor:beat.anchor,intent:beat.intent,gesture:beat.gesture??defaultGesture[beat.intent],
      start:scene.words[firstWord]!.start,end:scene.words[lastWord]!.end,firstWord,lastWord};
  }).sort((a,b) => a.start-b.start);
}

function window(start: number,arrive: number,leave: number,end: number,duration: number): Window {
  const stop=Math.max(.05,duration-.12);
  const s=Math.max(.04,Math.min(start,stop-.03)),e=Math.max(s+.03,Math.min(end,stop));
  const a=Math.max(s+.01,Math.min(arrive,e-.02));
  const l=Math.max(a,Math.min(leave,e-.01));
  return {start:s,arrive:a,leave:l,end:e};
}

/** Build intentional phrase acting once; the render remains frame-derived and deterministic. */
export function buildExplainerPerformance(scene: ExplainerScene,index: number,fps: number): ExplainerPerformance {
  const duration=scene.durationInFrames/fps;
  if (!Number.isFinite(duration)||duration<=1||!scene.words.length) throw new Error(`Missing performance duration or word alignment: ${scene.id}`);
  let previous=0;
  for (const word of scene.words) {
    if (!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<previous-.001||word.end<=word.start||word.end>duration+.001) throw new Error(`Invalid performance word interval in ${scene.id}`);
    previous=word.end;
  }
  const beats=alignPerformanceBeats(scene);
  const face: FacialActingTrack={version:1,source:"word-alignment",expressions:[],gaze:[],blinks:[]};
  const gestures: GestureCue[]=[],heads: HeadCue[]=[],stances: StanceCue[]=[],deadpans: Window[]=[];
  for (let i=0;i<beats.length;i++) {
    const beat=beats[i]!, next=beats[i+1];
    // Payoffs are delivered still, then receive a small smile and physical release.
    const reaction=beat.intent==="payoff" ? beat.end+.12 : beat.start;
    const expressionEnd=Math.min(next ? next.start+.15 : duration-.12,Math.max(reaction+1.35,beat.end+.85));
    const expressionWindow=window(reaction-.14,reaction+.24,Math.max(reaction+.4,expressionEnd-.5),expressionEnd,duration);
    const intents: Record<PerformanceIntent,FacialExpressionCue["intent"]>={welcome:"welcome",explain:"explain",setup:"curious",payoff:"invite",aside:"curious",reassure:"reassure"};
    const strengths: Record<PerformanceIntent,number>={welcome:1.05,explain:.7,setup:.57,payoff:1.02,aside:.42,reassure:1};
    face.expressions.push({...expressionWindow,intent:intents[beat.intent],intensity:strengths[beat.intent],anchor:beat.anchor});

    const headWindow=window(reaction-.12,reaction+.35,Math.max(reaction+.42,beat.end+.14),Math.max(reaction+.9,beat.end+.7),duration);
    const direction: Record<PerformanceIntent,{tilt:number;nod:number}>={welcome:{tilt:-.8,nod:1.3},explain:{tilt:-.3,nod:.65},
      setup:{tilt:-1.1,nod:0},payoff:{tilt:.55,nod:.8},aside:{tilt:-1.6,nod:0},reassure:{tilt:.6,nod:.5}};
    heads.push({...headWindow,...direction[beat.intent],anchor:beat.anchor});

    if (beat.intent==="setup"||beat.intent==="aside"||beat.intent==="reassure") {
      const thoughtful=beat.intent!=="reassure";
      stances.push({...window(beat.start-.25,beat.start+.55,beat.end+.3,beat.end+1.2,duration),
        x:thoughtful ? -1.05 : .65,y:thoughtful ? .2 : -.2,roll:thoughtful ? -.32 : .2});
    }
    if (beat.intent==="explain" && (beat.gesture==="present"||beat.gesture==="offer")) {
      face.gaze.push({...window(beat.start-.18,beat.start-.05,beat.start+.3,beat.start+.48,duration),x:4.1,y:.45,anchor:beat.anchor});
    } else if (beat.intent==="aside") {
      face.gaze.push({...window(beat.start-.06,beat.start+.1,Math.min(beat.end+.16,beat.start+.8),Math.min(beat.end+.35,beat.start+1),duration),x:-2.7,y:-.6,anchor:beat.anchor});
    }

    if (beat.gesture!=="none") {
      const payoff=beat.intent==="payoff", small=beat.gesture==="small";
      const begin=payoff ? beat.end+.15 : beat.start-.56;
      const arrive=payoff ? beat.end+.85 : beat.start+.46;
      const leave=payoff ? beat.end+1.02 : Math.min(beat.end+(small?.28:.65),arrive+(small?.5:1.4));
      // Recover before the next cue, but preserve enough time for a relaxed return.
      const naturalEnd=leave+(small?.85:1.2);
      const nextPreparation=next ? (next.intent==="payoff" ? next.start-.25 : next.start-.48) : duration-.2;
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

    if (beat.intent==="payoff") {
      const setup=beats.slice(0,i).reverse().find((candidate) => candidate.intent==="setup");
      const gaps=scene.words.slice(1,beat.firstWord+1).flatMap((word,j) => {
        const prior=scene.words[j]!;
        return word.start-prior.end>=.17 && prior.end>=Math.max(setup?.end??0,beat.start-2.7) ? [{start:prior.end,end:word.start}] : [];
      });
      // Prefer the deliberate setup pause over a shorter comma immediately
      // before the punch word (for example, "Oh, Ben. [pause] Tragically, zero.").
      const pause=gaps.sort((a,b) => (b.end-b.start)-(a.end-a.start)||b.start-a.start)[0];
      const start=pause?.start??Math.max(setup?.start??0,beat.start-.35);
      const deadpan=window(start-.08,start+.12,beat.end+.03,beat.end+.34,duration);
      deadpans.push(deadpan);
      if (pause && pause.end-pause.start>=.28) {
        face.gaze.push({...window(pause.start-.1,pause.start+.02,Math.min(pause.end-.08,beat.start-.22),Math.min(pause.end+.08,beat.start-.07),duration),
          x:-2.6,y:-.55,anchor:`pause before ${beat.anchor}`});
      }
    }
  }
  // Blink at a pause near a natural interval, never across the actual joke or edit.
  const gaps=scene.words.slice(1).map((word,i) => ({at:word.start-.23,gap:word.start-scene.words[i]!.end}));
  let last=.2;
  for (let ideal=3.8+(index%2)*.25;ideal<duration-.65;ideal+=4.1) {
    const candidates=gaps.filter((gap) => gap.at-last>2.3 && Math.abs(gap.at-ideal)<1.25 && gap.at>.3 && gap.at<duration-.6
      && !beats.some((beat) => beat.intent==="payoff"&&gap.at>beat.start-.4&&gap.at<beat.end+1));
    const best=candidates.sort((a,b) => Math.abs(a.at-ideal)-Math.abs(b.at-ideal)-Math.min(a.gap,.4)+Math.min(b.gap,.4))[0];
    if (best) {face.blinks.push(best.at);last=best.at;}
  }
  return {version:1,duration,beats,face,gestures,heads,stances,deadpans};
}

function bodyAt(time: number,track: ExplainerPerformance): BodyPose {
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
export function explainerPoseAt(time: number,globalTime: number,track: ExplainerPerformance): ActingPose {
  const body=bodyAt(time,track),face=facialAt(time,[],track.face);
  // This sub-pixel breath uses a global clock, so the torso cannot snap at a cut.
  body.chestY+=Math.sin(globalTime*Math.PI*2/5.4)*.28;
  face.smile=clamp(face.smile+.15);face.cheek=clamp(face.cheek+.12);face.squint=clamp(face.squint+.035);
  for (const pause of track.deadpans) {
    const weight=hold(time,pause);
    face.smile=lerp(face.smile,.16,weight);face.cheek=lerp(face.cheek,.16,weight);
    face.squint=lerp(face.squint,.055,weight);face.browLeft=lerp(face.browLeft,.8,weight);face.browRight=lerp(face.browRight,.15,weight);
  }
  let headTilt=-bodyAt(time-.09,track).chestRoll*.48,nod=0;
  for (const cue of track.heads) {const weight=hold(time,cue);headTilt+=cue.tilt*weight;nod+=cue.nod*weight;}
  return {body,face,headTilt:2.3*Math.tanh(headTilt/2.3),nod:1.8*Math.tanh(nod/1.8),reveal:body.forearm,invite:face.smile*.25};
}
