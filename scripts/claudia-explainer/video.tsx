import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Claudia } from "../claudia-character/Claudia.js";
import type { ActingPose } from "../claudia-character/acting.js";
import { facialAt, type FacialActingTrack, type FacialExpressionCue } from "../claudia-character/expressions.js";
import type { MouthPose } from "../claudia-character/lipsync.js";
import type { ExplainerProps, ExplainerScene } from "./types.js";

const C = { ink: "#10191c", panel: "#19272b", line: "#3e555a", dim: "#93b0b1", teal: "#77b8b6", acid: "#e9eb95", paper: "#f5f1e7", pink: "#df9aa7", black: "#080f12" };
const REST: MouthPose = { open: 0, width: .5, round: 0, closure: 0, teeth: 0, tongue: 0 };
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp(x); return t * t * t * (10 + t * (-15 + 6 * t)); };
const hold = (time: number, start: number, arrive: number, leave: number, end: number) => smooth((time - start) / Math.max(.01, arrive - start)) * (1 - smooth((time - leave) / Math.max(.01, end - leave)));
const wordKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/gu, "");

/** Semantically authored expressions on measured words, with the approved face rig. */
export function explainerFaceTrack(scene: ExplainerScene, index: number, fps: number): FacialActingTrack {
  const duration = scene.durationInFrames / fps;
  const expressions: FacialExpressionCue[] = [{start: 0, arrive: .5, leave: Math.max(.6, duration - .8), end: duration,
    intent: index === 0 ? "welcome" : index === 7 ? "invite" : "reassure", intensity: .72, anchor: scene.id}];
  const accents = new Set(["ben", "electronic", "style", "fashion", "everyone", "person", "kind", "different", "internet", "vibe", "music"]);
  const jokes = new Set(["tragically", "memory", "boss", "certification", "diagnosis", "headset", "password", "included", "update", "megacorporation", "unofficial"]);
  const questions = new Set(["what", "why", "girl", "egirl", "question"]);
  let previousAccent = -10;
  for (const word of scene.words) {
    const key = wordKey(word.text);
    const intent = jokes.has(key) ? "invite" : questions.has(key) ? "questionAccent" : accents.has(key) ? "emphasis" : undefined;
    if (!intent || word.start - previousAccent < 1.5) continue;
    previousAccent = word.start;
    expressions.push({start: Math.max(0, word.start - .15), arrive: word.start + .08, leave: Math.max(word.start + .09, word.end),
      end: Math.min(duration, Math.max(word.start + .2, word.end + .38)), intent, intensity: intent === "invite" ? .75 : .6, anchor: word.text});
  }
  const blinks: number[] = [];
  for (let i = 1; i < scene.words.length; i++) {
    const previous = scene.words[i - 1]!, next = scene.words[i]!;
    if ((/[.!?;:]$/u.test(previous.text) || next.start - previous.end > .18) && next.start > 1.1
      && (!blinks.length || next.start - blinks.at(-1)! > 3)) blinks.push(Math.max(.4, next.start - .23));
  }
  // Long uninterrupted phrases still receive an occasional natural blink.
  for (let t = 4.2 + (index % 3) * .3; t < duration - .8; t += 4.7) {
    if (blinks.every((blink) => Math.abs(blink - t) > 2)) blinks.push(t);
  }
  const keyWord = scene.words.find((word) => ["look", "style", "fashion", "eyeliner", "mix", "electronic", "anime", "means"].includes(wordKey(word.text)));
  const gaze = keyWord ? [{start: Math.max(.2, keyWord.start - .18), arrive: Math.max(.31, keyWord.start - .04),
    leave: keyWord.end + .28, end: keyWord.end + .44, x: 4.6, y: .5, anchor: keyWord.text}] : [];
  return {version: 1, source: "word-alignment", expressions, gaze, blinks: blinks.sort((a,b) => a-b)};
}

/** One connected gesture per idea, with preparation and recovery. Never a loop. */
function presenterPose(time: number, globalTime: number, scene: ExplainerScene, index: number, fps: number, face: FacialActingTrack): ActingPose {
  const duration = scene.durationInFrames / fps;
  const salient = scene.words.find((word) => ["means", "style", "look", "mix", "not", "person", "answer", "fashion", "electronic"].includes(wordKey(word.text)));
  const anchor = Math.max(1.2, Math.min(duration * .47, salient?.start ?? duration * .27));
  const intensity = [.68, .84, .95, .72, .48, .7, .5, .78][index % 8]!;
  const leave = Math.min(duration - 2.0, anchor + 2.6);
  const support = (t: number) => intensity * hold(t, anchor - .7, anchor + .4, leave + .15, leave + 1.85);
  const arm = (t: number) => intensity * hold(t, anchor - .3, anchor + .9, leave + .3, leave + 1.65);
  const opening = (t: number) => intensity * hold(t, anchor - .1, anchor + 1, leave + .2, leave + 1.5);
  const gesture = opening(time), chest = support(time), nod = hold(time, .35, .7, .8, 1.3);
  // Breathing is continuous across edits; its sub-pixel displacement does not drive the arms.
  const breath = Math.sin(globalTime * Math.PI * 2 / 5.4);
  return {
    reveal: gesture, invite: index === 7 ? gesture : 0,
    body: { chestX: chest * 3.7, chestY: chest * -1.25 + breath * .35, chestRoll: chest * 1.2,
      shoulder: intensity * hold(time, anchor - .6, anchor - .05, anchor + .15, anchor + 1),
      upperArm: arm(time), forearm: gesture, handOpen: opening(time - .1), passiveLag: support(time - .12) },
    headTilt: -.5 * support(time - .1) + (index % 2 ? -.35 : .35) * chest,
    nod: nod * (index === 0 ? 1.3 : .55), face: facialAt(time, [], face),
  };
}

function Label({children, color = C.acid}: {children: React.ReactNode; color?: string}) {
  return <div style={{fontSize: 14, fontFamily: "Consolas, monospace", fontWeight: 600, letterSpacing: 2.2, color}}>{children}</div>;
}

function Tag({children, color = C.acid, style = {}}: {children: React.ReactNode; color?: string; style?: React.CSSProperties}) {
  return <div style={{display: "inline-flex", border: `1px solid ${color}`, color, padding: "8px 12px", fontFamily: "Consolas, monospace", fontSize: 14, letterSpacing: 1, ...style}}>{children}</div>;
}

function Reveal({time, at = 0, children, style = {}}: {time: number; at?: number; children: React.ReactNode; style?: React.CSSProperties}) {
  const t = smooth((time - at) / .5);
  return <div style={{opacity: t, transform: `translateY(${(1 - t) * 12}px)`, ...style}}>{children}</div>;
}

function CityRain({time}: {time: number}) {
  return <svg viewBox="0 0 1280 720" style={{position: "absolute", inset: 0, width: "100%", height: "100%"}} aria-hidden="true">
    <defs><linearGradient id="night-window" x1="0" x2="1"><stop stopColor="#193136"/><stop offset="1" stopColor={C.ink}/></linearGradient></defs>
    <path d="M0 0H492V610H0Z" fill="url(#night-window)"/>
    <g fill="#17272c" stroke="#2a4146" strokeWidth="1">
      <path d="M0 578V297H48V219H89V351H137V167H189V285H227V116H274V318H327V237H367V332H414V191H460V602Z"/>
      <path d="M0 585V425H61V378H105V471H169V357H220V499H278V405H335V435H398V388H465V605Z" fill="#112328"/>
    </g>
    <g stroke={C.teal} opacity=".14" strokeWidth="1">
      {Array.from({length: 32}, (_, i) => { const x = (i * 91 + 31) % 483, y = ((i * 127 + time * (24 + i % 4 * 6)) % 720) - 60; return <path key={i} d={`M${x} ${y}l-11 46`}/>; })}
    </g>
    <g fill={C.teal} opacity=".24">{[38,76,157,178,244,258,348,435].map((x,i) => <rect key={x} x={x} y={280 + i % 4 * 46} width="4" height="17"/>)}</g>
    <path d="M492 85V598M529 85H1228M529 598H1228" fill="none" stroke={C.line} strokeWidth="1"/>
    <path d="M529 85h35M529 85v18M1228 598h-35M1228 598v-18" fill="none" stroke={C.teal} strokeWidth="2"/>
  </svg>;
}

function Spark({x,y,color = C.acid, scale = 1}: {x: number; y: number; color?: string; scale?: number}) {
  return <path d="M0-12 3-3 12 0 3 3 0 12-3 3-12 0-3-3Z" transform={`translate(${x} ${y}) scale(${scale})`} fill={color}/>;
}

/** An adult-proportioned fashion illustration, never a photo or a real person's likeness. */
function StylePortrait({time}: {time: number}) {
  const glow = .72 + Math.sin(time * .7) * .05;
  return <svg viewBox="0 0 300 330" width="276" height="302" aria-label="Illustrated alternative fashion: colored hair streaks, winged eyeliner, a heart accent and striped sleeves">
    <ellipse cx="149" cy="310" rx="109" ry="13" fill="#080f12"/>
    <path d="M65 303 75 225Q91 202 124 198H174Q211 202 228 225L242 303Z" fill="#282b34" stroke={C.dim} strokeWidth="2"/>
    <path d="M77 222 59 303H99L111 214M207 214 223 303H252L231 226" fill={C.paper}/>
    <path d="M68 250H102M62 273H101M218 248H238M223 272H245M59 296H98M228 295H250" stroke="#38343e" strokeWidth="13"/>
    <path d="M122 170 120 207Q149 229 177 206L175 169" fill="#d3a58f" stroke="#5b5252" strokeWidth="2"/>
    <path d="M83 151Q58 75 88 42 112 19 150 24 194 16 218 49 241 83 218 185L181 205H117L77 186Z" fill="#302a39" stroke={C.dim} strokeWidth="2"/>
    <path d="M95 86Q112 45 155 48 189 47 204 88L198 154Q179 185 151 190 122 188 102 155Z" fill="#e7bba3"/>
    <path d="M78 90Q90 28 155 35L118 105 100 94 90 178 75 189Z" fill={C.pink}/>
    <path d="M151 35Q195 23 216 77L224 182 204 201 197 100 174 87Z" fill="#62566e"/>
    <path d="M111 121q13-10 25 0M166 121q12-10 25 0M112 121l-10-7M190 121l10-7" fill="none" stroke="#302a39" strokeWidth="4" strokeLinecap="round"/>
    <path d="M149 126l-4 15 7 2M139 162q12 8 25-1" fill="none" stroke="#a5736a" strokeWidth="2" strokeLinecap="round"/>
    <path d="M112 140c-6-7-11 1 0 9 11-8 6-16 0-9Z" fill="#4c3447"/>
    <path d="M116 212q34 35 67-1" fill="none" stroke={C.paper} strokeWidth="3"/>
    <path d="M146 238v15m-6-8h12" stroke={C.paper} strokeWidth="2"/>
    <path d="M108 68l17-13M111 77l18-13" stroke={C.acid} strokeWidth="4"/>
    <g opacity={glow}><Spark x={41} y={97}/><Spark x={248} y={151} color={C.pink}/><Spark x={234} y={37} scale={.6}/></g>
  </svg>;
}

function Gamepad({x=0,y=0,scale=1}: {x?:number;y?:number;scale?:number}) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}><path d="M23 22Q0 24 1 66 3 87 25 70L40 58H80L97 73Q118 87 119 64 119 27 98 22Z" fill={C.panel} stroke={C.teal} strokeWidth="3"/><path d="M29 34v26M16 47h26" stroke={C.paper} strokeWidth="5" strokeLinecap="round"/><circle cx="92" cy="39" r="5" fill={C.pink}/><circle cx="101" cy="52" r="5" fill={C.acid}/></g>;
}

function QuestionVisual({time}: {time:number}) {
  return <>
    <Reveal time={time} at={.1}><Tag>INCOMING QUESTION / BEN</Tag></Reveal>
    <Reveal time={time} at={.35}><div style={{fontSize: 74, fontWeight: 750, lineHeight: 1.04, letterSpacing: -3, marginTop: 28}}>“What is<br/>an <span style={{color: C.pink}}>e-girl</span>?”</div></Reveal>
    <Reveal time={time} at={1.7}><div style={{marginTop: 31, display:"flex", alignItems:"center", gap:16}}><span style={{width:35,height:2,background:C.acid}}/><span style={{fontSize:20,color:C.dim}}>A tiny field guide to a very online look.</span></div></Reveal>
    <Reveal time={time} at={3.4}><Tag style={{marginTop:31,transform:"rotate(-3deg)"}}>CASE OPENED. EYELINER DETECTED.</Tag></Reveal>
  </>;
}

function DefinitionVisual({time, chargerAt}: {time:number;chargerAt:number}) {
  return <>
    <Label>THE SHORT ANSWER</Label>
    <Reveal time={time} at={.15}><div style={{fontSize:91,fontWeight:750,letterSpacing:-4,lineHeight:1.05,marginTop:19}}><span style={{color:C.pink}}>e</span>-girl</div></Reveal>
    <Reveal time={time} at={.8}><div style={{display:"flex",alignItems:"center",gap:16,marginTop:8}}><div style={{width:47,height:2,background:C.pink}}/><span style={{fontFamily:"Consolas, monospace",fontSize:21,color:C.pink}}>electronic girl</span></div></Reveal>
    <Reveal time={time} at={1.6}><div style={{fontSize:31,fontWeight:500,lineHeight:1.25,marginTop:34,maxWidth:580}}>An internet-rooted<br/><span style={{color:C.acid}}>alternative fashion aesthetic.</span></div></Reveal>
    <div style={{display:"flex",gap:10,marginTop:24}}><Reveal time={time} at={3.7}><Tag color={C.teal}>STYLE + ONLINE PERSONA</Tag></Reveal><Reveal time={time} at={chargerAt}><Tag color={C.pink}>NO CHARGER</Tag></Reveal></div>
  </>;
}

function StyleVisual({time, catAt}: {time:number;catAt:number}) {
  const labels=["Winged eyeliner","Blush + tiny hearts","Dyed hair","Layers + chains"];
  return <>
    <Label>THE VISUAL VOCABULARY</Label>
    <div style={{fontSize:49,fontWeight:700,letterSpacing:-1.8,lineHeight:1.05,marginTop:17}}>A look, <span style={{color:C.pink}}>remixed.</span></div>
    <div style={{display:"flex",marginTop:14,alignItems:"center",gap:5}}>
      <Reveal time={time} at={.2}><StylePortrait time={time}/></Reveal>
      <div style={{flex:1}}>{labels.map((label,i) => <Reveal key={label} time={time} at={.65+i*.7} style={{display:"flex",gap:11,alignItems:"center",marginBottom:23}}><span style={{color:C.pink,fontFamily:"Consolas, monospace",fontSize:14}}>0{i+1}</span><span style={{fontSize:21,lineHeight:1.2}}>{label}</span></Reveal>)}</div>
    </div>
    <div style={{fontSize:14,color:C.dim,fontFamily:"Consolas, monospace",marginTop:-5}}>EXAMPLES, NOT A UNIFORM.</div>
    <Reveal time={time} at={catAt} style={{position:"absolute",right:0,bottom:18,width:327,height:85,background:C.ink,borderTop:`1px solid ${C.line}`,display:"flex",alignItems:"center",gap:15,paddingTop:9}}>
      <svg viewBox="0 0 91 75" width="82" height="69" aria-label="Optional cat-ear headphones"><path d="M16 49V32Q18 7 46 7 74 7 76 32V49M20 20 14 0 35 11M58 10 77 0 72 20" fill="none" stroke={C.pink} strokeWidth="4" strokeLinejoin="round"/><rect x="10" y="37" width="16" height="26" rx="5" fill={C.pink}/><rect x="66" y="37" width="16" height="26" rx="5" fill={C.pink}/></svg>
      <div><div style={{fontSize:16,color:C.pink}}>Cat ears: optional.</div><div style={{fontSize:25,fontFamily:"Consolas, monospace",color:C.acid,marginTop:5}}>EXTRA RAM: 0 MB</div></div>
    </Reveal>
  </>;
}

function CultureVisual({time}: {time:number}) {
  return <>
    <Label>THE CULTURE REMIX</Label>
    <div style={{fontSize:50,fontWeight:700,letterSpacing:-1.5,lineHeight:1.05,marginTop:18}}>A remix.<br/><span style={{color:C.acid}}>Not a uniform.</span></div>
    <svg viewBox="0 0 630 230" width="630" height="230" style={{marginTop:26}} aria-label="Gaming, anime, and alternative music combine into an online style">
      <g opacity={smooth((time-.3)/.5)}><Gamepad x={11} y={15} scale={1.08}/><text x="73" y="135" textAnchor="middle" fill={C.paper} fontSize="18" fontFamily="Arial">GAMING</text></g>
      <g opacity={smooth((time-1)/.5)}><path d="M201 34 221 18 252 13 284 32 277 88 245 107 217 87Z" fill={C.panel} stroke={C.pink} strokeWidth="2"/><path d="M214 49 229 26 237 49 249 24 258 49 275 34M220 62l13-3m22 0 13 3M237 83q9 5 18-1" fill="none" stroke={C.paper} strokeWidth="2.5"/><Spark x={291} y={16} color={C.pink} scale={.6}/><text x="247" y="135" textAnchor="middle" fill={C.paper} fontSize="18" fontFamily="Arial">ANIME</text></g>
      <g opacity={smooth((time-1.7)/.5)}><path d="M397 20v66m0-54 57-10v54" fill="none" stroke={C.acid} strokeWidth="6"/><ellipse cx="385" cy="87" rx="16" ry="11" fill={C.acid} transform="rotate(-15 385 87)"/><ellipse cx="442" cy="77" rx="16" ry="11" fill={C.acid} transform="rotate(-15 442 77)"/><text x="421" y="135" textAnchor="middle" fill={C.paper} fontSize="18" fontFamily="Arial">EMO / GOTH</text></g>
      <g opacity={smooth((time-2.5)/.5)}><path d="M75 158v18h350v-18M247 176v28m-7-7 7 7 7-7" fill="none" stroke={C.line} strokeWidth="2"/><text x="340" y="219" textAnchor="middle" fill={C.teal} fontSize="19" fontFamily="Consolas">+ SOCIAL MEDIA = NEW REMIX</text></g>
    </svg>
    <Reveal time={time} at={5}><Tag color={C.pink} style={{marginTop:-3}}>TIKTOK SPOTLIGHT: AROUND 2019</Tag></Reveal>
  </>;
}

function PersonaVisual({time, bossAt}: {time:number;bossAt:number}) {
  return <>
    <Label>MORE THAN THE OUTFIT</Label>
    <div style={{fontSize:49,fontWeight:700,letterSpacing:-1.7,lineHeight:1.08,marginTop:20}}>An online persona.<br/><span style={{color:C.acid}}>No entrance exam.</span></div>
    <svg width="605" height="190" viewBox="0 0 605 190" style={{marginTop:23}} aria-label="Outfit videos, makeup, games and memes are possible interests, not requirements">
      <g opacity={smooth((time-.3)/.5)} transform="translate(8 9)"><rect x="9" y="10" width="93" height="119" rx="12" fill={C.panel} stroke={C.teal} strokeWidth="2"/><path d="m46 42 32 20-32 20Z" fill={C.pink}/><path d="M30 102h51" stroke={C.dim} strokeWidth="3"/><text x="56" y="162" textAnchor="middle" fill={C.paper} fontSize="17" fontFamily="Arial">OUTFITS</text></g>
      <g opacity={smooth((time-1)/.5)} transform="translate(169 9)"><path d="M18 116V62H61V116ZM26 62V30L52 13V62" fill={C.pink} stroke={C.pink} strokeWidth="2"/><path d="M18 82h43" stroke={C.ink} strokeWidth="3"/><text x="39" y="162" textAnchor="middle" fill={C.paper} fontSize="17" fontFamily="Arial">MAKEUP</text></g>
      <g opacity={smooth((time-1.7)/.5)} transform="translate(297 9)"><Gamepad x={0} y={24}/><text x="60" y="162" textAnchor="middle" fill={C.paper} fontSize="17" fontFamily="Arial">GAMES</text></g>
      <g opacity={smooth((time-2.4)/.5)} transform="translate(465 9)"><path d="M0 28h112v73H52L27 122v-21H0Z" fill={C.panel} stroke={C.acid} strokeWidth="2"/><path d="M24 55q8-8 16 0m32 0q8-8 16 0M37 73q19 17 38 0" fill="none" stroke={C.paper} strokeWidth="3"/><text x="55" y="162" textAnchor="middle" fill={C.paper} fontSize="17" fontFamily="Arial">MEMES</text></g>
    </svg>
    <Reveal time={time} at={bossAt}><Tag style={{marginTop:16}}>STREAMING OPTIONAL. FINAL BOSS OPTIONAL.</Tag></Reveal>
  </>;
}

function EtiquetteVisual({time}: {time:number}) {
  return <>
    <Label>LET PEOPLE NAME THEIR LOOK</Label>
    <Reveal time={time} at={.1}><div style={{fontSize:55,fontWeight:700,letterSpacing:-2,lineHeight:1.06,marginTop:24}}>Eyeliner isn’t<br/>a <span style={{color:C.pink}}>personality test.</span></div></Reveal>
    <div style={{marginTop:35,display:"flex",gap:18,alignItems:"center"}}>
      <Reveal time={time} at={.7}><svg width="145" height="154" viewBox="0 0 145 154" aria-label="An eye over a question mark: appearances do not tell the whole story"><path d="M5 47Q72-14 139 47 72 108 5 47Z" fill={C.panel} stroke={C.teal} strokeWidth="2"/><circle cx="72" cy="47" r="23" fill={C.teal}/><circle cx="72" cy="47" r="9" fill={C.ink}/><text x="72" y="143" textAnchor="middle" fill={C.pink} fontSize="53" fontFamily="Georgia">?</text></svg></Reveal>
      <Reveal time={time} at={1.4}><div style={{fontSize:25,lineHeight:1.45,color:C.paper,maxWidth:420}}>Not every woman who games.<br/>Not a personality diagnosis.<br/><span style={{color:C.acid}}>A label people can choose.</span></div></Reveal>
    </div>
    <Reveal time={time} at={3}><Tag color={C.teal} style={{marginTop:28}}>CHECK THE CONTEXT. SKIP THE ASSUMPTIONS.</Tag></Reveal>
  </>;
}

function TestVisual({time, customerAt}: {time:number;customerAt:number}) {
  return <>
    <Label>THE PRACTICAL TEST</Label>
    <div style={{fontSize:48,fontWeight:700,letterSpacing:-1.6,lineHeight:1.08,marginTop:22}}>A headset<br/><span style={{color:C.pink}}>doesn’t decide it.</span></div>
    <Reveal time={time} at={.5}><div style={{display:"flex",alignItems:"center",gap:24,marginTop:30,borderBottom:`1px solid ${C.line}`,paddingBottom:20}}>
      <svg viewBox="0 0 105 82" width="105" height="82" aria-label="A person on a video call"><rect x="1" y="1" width="101" height="77" rx="5" fill={C.panel} stroke={C.teal} strokeWidth="2"/><circle cx="51" cy="30" r="14" fill={C.dim}/><path d="M23 67q2-22 28-22t28 22" fill={C.dim}/></svg>
      <div><div style={{fontSize:23}}>Person on a video call?</div><div style={{fontSize:26,color:C.teal,marginTop:7}}>Just a person.</div></div>
    </div></Reveal>
    <Reveal time={time} at={2}><div style={{display:"flex",alignItems:"center",gap:24,marginTop:21}}>
      <svg viewBox="0 0 105 82" width="105" height="82" aria-label="A self-curated alternative look"><path d="M19 69V31Q18 5 51 5 84 5 83 31v38" fill={C.panel} stroke={C.pink} strokeWidth="2"/><path d="M35 27q16-12 32 0v19Q51 66 35 46Z" fill={C.pink}/><Spark x={84} y={16} scale={.55}/><path d="M30 78V64l21-10 23 10v14" fill={C.pink}/></svg>
      <div><div style={{fontSize:23}}>Curating that online alt look?</div><div style={{fontSize:26,color:C.pink,marginTop:7}}>Maybe. Let them say.</div></div>
    </div></Reveal>
    <Reveal time={time} at={customerAt}><Tag style={{marginTop:22}}>CUSTOMER SUPPORT CAN STAND DOWN.</Tag></Reveal>
  </>;
}

function VerdictVisual({time, megacorpAt}: {time:number;megacorpAt:number}) {
  return <>
    <Label>CASE CLOSED / BEN’S FIELD GUIDE</Label>
    <Reveal time={time} at={.15}><div style={{fontSize:67,fontWeight:750,letterSpacing:-2.5,lineHeight:1.05,marginTop:24}}>Very online.<br/>Very <span style={{color:C.pink}}>expressive.</span><br/>Still a person.</div></Reveal>
    <Reveal time={time} at={1.8}><div style={{height:1,background:C.line,marginTop:31,marginBottom:22}}/><div style={{fontSize:24,color:C.dim,lineHeight:1.3}}>Alternative fashion meets internet culture.</div></Reveal>
    <Reveal time={time} at={3.4}><Tag style={{marginTop:23,transform:"rotate(-2deg)"}}>BEN: INTERNET LORE +1</Tag></Reveal>
    <Reveal time={time} at={megacorpAt}><div style={{fontFamily:"Consolas, monospace",fontSize:14,color:C.teal,marginTop:21}}>QUESTION ANSWERED. MEGACORPORATION UNHARMED.</div></Reveal>
  </>;
}

function Visual({scene,time}: {scene:ExplainerScene;time:number}) {
  // Punchlines appear with Claudia's delivery, including after a regenerated take.
  // Missing reviewed anchors fail rendering instead of silently spoiling the joke.
  const at = (...anchors: string[]) => {
    const word = scene.words.find((candidate) => anchors.includes(wordKey(candidate.text)));
    if (!word) throw new Error(`Missing visual timing anchor in ${scene.id}: ${anchors.join(" / ")}`);
    return word.start;
  };
  switch (scene.visual) {
    case "question": return <QuestionVisual time={time}/>;
    case "definition": return <DefinitionVisual time={time} chargerAt={at("charging")}/>;
    case "ingredients": return <CultureVisual time={time}/>;
    case "accessories": return <StyleVisual time={time} catAt={scene.words.find((word) => wordKey(word.text)==="cat")?.start ?? 7}/>;
    case "persona": return <PersonaVisual time={time} bossAt={at("boss", "certification")}/>;
    case "labels": return <EtiquetteVisual time={time}/>;
    case "test": return <TestVisual time={time} customerAt={at("customer")}/>;
    case "outro": return <VerdictVisual time={time} megacorpAt={at("megacorporation")}/>;
    default: throw new Error(`Unrecognized explainer visual: ${scene.visual}`);
  }
}

function phraseCaptions(scene: ExplainerScene) {
  if (scene.captions) return scene.captions;
  const result: {text:string;start:number;end:number}[] = [];
  let first = 0;
  for (let i = 0; i < scene.words.length; i++) {
    const words = scene.words.slice(first,i+1), text = words.map((word) => word.text).join(" ");
    const next = scene.words[i+1];
    if (!next || text.length + next.text.length > 79 || /[.!?]$/u.test(scene.words[i]!.text) || scene.words[i]!.end - words[0]!.start > 4.2) {
      result.push({text,start:words[0]!.start,end:next ? next.start : scene.words[i]!.end + .35}); first=i+1;
    }
  }
  return result;
}

export function ClaudiaExplainer({fps,durationInFrames,scenes}: ExplainerProps) {
  const frame = useCurrentFrame(), globalTime = frame / fps;
  const index = Math.max(0, scenes.findIndex((scene) => frame >= scene.from && frame < scene.from + scene.durationInFrames));
  const scene = scenes[index]!;
  const localFrame = Math.max(0,frame-scene.from), time=localFrame/fps;
  const face = useMemo(() => explainerFaceTrack(scene,index,fps),[scene,index,fps]);
  const captions = useMemo(() => phraseCaptions(scene),[scene]);
  const caption = captions.find((cue) => time >= cue.start && time < cue.end)?.text ?? "";
  const progress = clamp(frame / Math.max(1,durationInFrames-1));
  const enter = smooth(time / .4), exit = smooth((scene.durationInFrames/fps-time)/.24);
  return <AbsoluteFill style={{background:C.ink,color:C.paper,fontFamily:"Arial, sans-serif",overflow:"hidden"}}>
    <CityRain time={globalTime}/>
    <div style={{position:"absolute",left:42,right:42,top:29,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{fontSize:16,fontWeight:700,letterSpacing:2.2}}>CLAUDIA <span style={{color:C.dim,fontWeight:400,letterSpacing:1.7,marginLeft:16}}>BEN’S INTERNET FIELD GUIDE</span></div>
      <Label color={C.dim}>{String(index+1).padStart(2,"0")} / {String(scenes.length).padStart(2,"0")}</Label>
    </div>
    <div style={{position:"absolute",left:0,top:51,width:514,height:558,overflow:"hidden"}}>
      <div style={{position:"absolute",left:-20,top:-6,width:554,height:702}}><Claudia mouth={scene.mouth[localFrame] ?? REST} acting={presenterPose(time,globalTime,scene,index,fps,face)}/></div>
    </div>
    <div style={{position:"absolute",left:42,top:562,fontFamily:"Consolas, monospace",fontSize:12,letterSpacing:1.4,color:C.teal,background:"#132328e6",padding:"7px 9px"}}>CLAUDIA / YOUR INTERNET TRANSLATOR</div>
    <div style={{position:"absolute",left:552,top:116,width:632,height:465,opacity:enter*exit,transform:`translateX(${(1-enter)*13}px)`}}><Visual scene={scene} time={time}/></div>
    <div style={{position:"absolute",left:0,right:0,bottom:0,height:110,background:C.black,borderTop:`1px solid ${C.line}`}}>
      <div style={{position:"absolute",left:52,right:52,top:16,height:62,fontSize:25,lineHeight:1.2,display:"flex",alignItems:"center",justifyContent:"center",textAlign:"center",fontWeight:500}}>{caption}</div>
      <div style={{position:"absolute",bottom:12,left:42,color:C.dim,fontFamily:"Consolas, monospace",fontSize:9.5,letterSpacing:.1}}>Claudia by anabology · AI-assisted stylized adaptation · Synthetic voice</div>
      <div style={{position:"absolute",bottom:12,right:42,color:C.dim,fontFamily:"Consolas, monospace",fontSize:9.5}}>MUSIC: SLOGANS IN THE RAIN</div>
      <div style={{position:"absolute",left:0,bottom:0,height:3,width:`${progress*100}%`,background:C.acid}}/>
    </div>
  </AbsoluteFill>;
}
