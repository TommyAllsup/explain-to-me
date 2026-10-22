import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Claudia } from "./Claudia.js";
import { actingAt } from "./acting.js";
import type { CharacterTestProps } from "./motion.js";
export type { CharacterTestProps } from "./motion.js";

const ink = "#26352e", olive = "#63765c", paper = "#f5f3ec";
const ease = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };

export function CharacterTest({fps, mouth, beats, voiceLabel}: CharacterTestProps) {
  const frame = useCurrentFrame();
  const time = frame / fps;
  const now = time * 1000;
  const matching = beats.findIndex((beat) => now >= beat.startMs && now < beat.endMs);
  const index = matching < 0 ? beats.length - 1 : matching;
  const active = beats[index] ?? beats.at(-1)!;
  const greeting = index < 2;
  const scene = greeting ? 0 : index < 4 ? 1 : index === 4 ? 2 : 3;
  const sceneStart = scene === 0 ? 0 : scene === 1 ? beats[2]!.startMs : active.startMs;
  const enter = ease((now - sceneStart) / 400);
  const cardStyle = { opacity: enter, transform: `translateY(${(1 - enter) * 12}px)` };

  return <AbsoluteFill style={{background: paper, color: ink, fontFamily: "Arial, sans-serif"}}>
    <div style={{position:"absolute", left:48, right:48, top:34, display:"flex", justifyContent:"space-between", fontSize:15, letterSpacing:2.1, fontWeight:700}}>
      <span>CLAUDIA <span style={{color:"#849080", paddingLeft:14, fontWeight:400}}>CHARACTER STUDY / 02</span></span>
      <span style={{color:olive, letterSpacing:1}}>{voiceLabel}</span>
    </div>
    <div style={{position:"absolute", left:42, top:100, width:476, height:490, borderRadius:"50% 50% 18px 18px", background:"#e5e8dc"}}/>
    <div style={{position:"absolute", left:14, top:44, width:535, height:570, overflow:"hidden"}}><div style={{height:620}}>
      <Claudia mouth={mouth[frame]!} acting={actingAt(time, beats)}/>
    </div></div>
    <div style={{position:"absolute", left:570, right:62, top:143, ...cardStyle}}>
      <div style={{fontSize:14, letterSpacing:2.5, fontWeight:700, color:olive, marginBottom:23}}>{["HELLO, I'M CLAUDIA", "ONE USEFUL IDEA", "THE CATCH", "A BETTER QUESTION"][scene]}</div>
      <div style={{fontFamily:"Georgia, serif", fontSize:58, lineHeight:1.1, letterSpacing:-1.8, maxWidth:640}}>
        {scene === 0 ? <>Let’s make<br/>this simpler.</> : scene === 1 ? <>Remember<br/>the work.</> : scene === 2 ? <>Yesterday’s answer.<br/><span style={{color:olive}}>Today’s truth?</span></> : <>Keep what helps.<br/>Refresh what changes.</>}
      </div>
      <div style={{marginTop:40, height:133}}>
        {scene === 0 ? <div style={{fontSize:23, color:olive, lineHeight:1.55}}>A familiar voice.<br/>A little more expression.</div> : <svg width="590" height="120" viewBox="0 0 590 120" aria-label="Remembered answer and refresh cycle">
          <rect x="1" y="8" width="218" height="92" rx="12" fill={scene === 2 ? "#eeebe3" : "#e1e6d9"} stroke="#aeb9a6"/>
          <text x="20" y="40" fill={olive} fontFamily="Arial" fontSize="14" letterSpacing="1.5">{scene === 3 ? "KEEP" : "CACHE"}</text>
          <text x="20" y="75" fill={ink} fontFamily="Arial" fontSize="23">{scene === 2 ? "Saved answer" : "Useful work"}</text>
          <path d="M238 54H304m-10-8 10 8-10 8" fill="none" stroke={olive} strokeWidth="2"/>
          <circle cx="363" cy="54" r="38" fill={scene === 3 ? olive : "none"} stroke={olive} strokeWidth="1.7"/>
          {scene === 1 ? <path d="m346 54 12 12 23-25" fill="none" stroke={olive} strokeWidth="3"/> : scene === 2 ? <text x="352" y="65" fill={ink} fontFamily="Georgia" fontSize="34">?</text> : <path d="M349 49a15 15 0 1 1 0 12m-2-25 2 13 13-3" fill="none" stroke={paper} strokeWidth="2.3"/>}
          <text x="421" y="50" fill={ink} fontFamily="Arial" fontSize="19">{scene === 1 ? "Less" : scene === 2 ? "Still" : "Refresh"}</text>
          <text x="421" y="75" fill={olive} fontFamily="Arial" fontSize="19">{scene === 1 ? "repetition" : scene === 2 ? "current?" : "when needed"}</text>
        </svg>}
      </div>
    </div>
    <div style={{position:"absolute", left:48, right:48, bottom:101, height:1, background:"#cbd1c4"}}/>
    <div style={{position:"absolute", left:74, right:74, bottom:35, minHeight:49, display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center", fontSize:25, fontWeight:500, lineHeight:1.26, whiteSpace:"normal"}}>{active.text}</div>
    <div style={{position:"absolute", left:48, bottom:12, fontSize:10, color:"#66715f", letterSpacing:.25}}>Claudia by anabology · AI-assisted stylized adaptation · Synthetic voice</div>
  </AbsoluteFill>;
}
