import assert from "node:assert/strict";
import test from "node:test";
import { alignPerformanceBeats, buildExplainerPerformance, explainerPoseAt, visualCueAt } from "./performance.js";
import type { ExplainerScene } from "./types.js";
import { bodyRig } from "../claudia-character/posture.js";

const scene: ExplainerScene={id:"joke",title:"Test",narration:"",visual:"accessories",displayText:[],from:0,durationInFrames:384,mouth:[],
  words:[
    {text:"Ben!",start:.4,end:.8},{text:"Look",start:2.3,end:2.6},{text:"at",start:2.6,end:2.75},{text:"this.",start:2.75,end:3.1},
    {text:"Cat",start:6,end:6.2},{text:"ear",start:6.2,end:6.4},{text:"headphones?",start:6.4,end:6.8},
    {text:"Extra",start:8.5,end:8.8},{text:"memory?",start:8.8,end:9.2},{text:"Oh,",start:9.5,end:9.7},{text:"Ben.",start:9.7,end:10},
    {text:"Tragically,",start:10.8,end:11.4},{text:"zero.",start:11.7,end:12.1},{text:"Just",start:12.6,end:12.8},{text:"cute.",start:12.8,end:13.3}],
  performance:{beats:[{anchor:"Ben",occurrence:1,intent:"welcome",gesture:"small"},{anchor:"Look at this",intent:"explain",gesture:"present"},
    {anchor:"extra memory",intent:"setup",gesture:"none"},{anchor:"zero",intent:"payoff",gesture:"small"}]}};

test("phrases match measured word boundaries and ambiguous anchors require an occurrence",()=>{
  const beats=alignPerformanceBeats(scene);
  assert.equal(beats[1]!.start,2.3);assert.equal(beats[1]!.end,3.1);
  assert.throws(()=>alignPerformanceBeats({...scene,performance:{beats:[{anchor:"Ben",intent:"welcome"}]}}),/ambiguous/);
  assert.equal(alignPerformanceBeats({...scene,performance:{beats:[{anchor:"Ben",occurrence:2,intent:"welcome"}]}})[0]!.start,9.7);
  assert.throws(()=>alignPerformanceBeats({...scene,performance:{beats:[{anchor:"missing word",intent:"welcome"}]}}),/Missing/);
});

test("a payoff word wins over an earlier setup word; older scripts retain their fallback",()=>{
  assert.equal(visualCueAt(scene,"zero","memory"),11.7);
  assert.equal(visualCueAt({...scene,words:scene.words.filter(word=>word.text!=="zero.")},"zero","memory"),8.8);
  assert.throws(()=>visualCueAt(scene,"customer"),/Missing visual timing/);
});

test("the chest prepares before the arm and fingers, without driving gestures from loudness",()=>{
  const track=buildExplainerPerformance(scene,0,24);
  const cue=track.gestures.find(gesture=>gesture.anchor==="Look at this")!;
  const early=explainerPoseAt(cue.start+.1,0,track).body;
  assert.ok(early.chestX>0);assert.equal(early.upperArm,0);assert.equal(early.forearm,0);assert.equal(early.handOpen,0);
  const following=explainerPoseAt(cue.start+.27,0,track).body;
  assert.ok(following.upperArm>0);assert.ok(following.forearm>0);assert.equal(following.handOpen,0);
  assert.ok(explainerPoseAt(cue.arrive+.4,0,track).body.handOpen>.4);
});

test("comic pause holds deadpan and eye contact for payoff, then smiles with a small release",()=>{
  const track=buildExplainerPerformance(scene,0,24),payoff=track.beats.at(-1)!;
  assert.ok(track.deadpans[0]!.start<10.1,"Use the long scripted pause, not the later comma");
  const deadpan=explainerPoseAt(11.8,11.8,track),reaction=explainerPoseAt(12.6,12.6,track);
  assert.ok(deadpan.face.smile<.25);assert.ok(Math.abs(deadpan.face.gazeX)<1);
  assert.equal(deadpan.body.forearm,0,"No hand flourish through the punch word");
  assert.ok(reaction.face.smile>deadpan.face.smile+.35);
  assert.ok(track.gestures.find(gesture=>gesture.anchor==="zero")!.start>payoff.end);
  assert.ok(!track.face.blinks.some(blink=>blink>payoff.start-.2&&blink<payoff.end+.6));
});

test("scene boundaries share a settled torso, face, and global breath",()=>{
  const track=buildExplainerPerformance(scene,0,24),next=buildExplainerPerformance(scene,1,24);
  const exit=explainerPoseAt(16,35,next),entry=explainerPoseAt(0,35,track);
  assert.deepEqual(exit,entry);
  const before=explainerPoseAt(16-1/24,35-1/24,track);
  assert.ok(Math.abs(before.body.chestY-entry.body.chestY)<.02);
  assert.equal(before.body.forearm,0);assert.equal(before.headTilt,0);
});

test("the complete performance stays finite, bounded, and deterministic",()=>{
  const track=buildExplainerPerformance(scene,0,24);
  for(let frame=0;frame<=384;frame++) {
    const pose=explainerPoseAt(frame/24,frame/24,track);
    assert.deepEqual(pose,explainerPoseAt(frame/24,frame/24,track));
    for(const value of [...Object.values(pose.body),...Object.values(pose.face),pose.headTilt,pose.nod]) assert.ok(Number.isFinite(value));
    for(const key of ["upperArm","forearm","handOpen","shoulder","passiveLag"] as const) assert.ok(pose.body[key]>=0&&pose.body[key]<=1);
    for(const key of ["smile","cheek","squint","blink"] as const) assert.ok(pose.face[key]>=0&&pose.face[key]<=1);
    assert.ok(Math.abs(pose.body.chestX)<5&&Math.abs(pose.body.chestRoll)<1.6);
    assert.ok(Math.abs(pose.headTilt)<2.3&&pose.nod<1.8);
  }
});

test("legacy unannotated scripts still build a valid performance",()=>{
  const {performance: _performance,...legacy}=scene;
  const track=buildExplainerPerformance(legacy,0,24);
  assert.equal(track.beats.length,1);assert.ok(track.gestures.length>0);
});

test("a crowded phrase keeps its face accent instead of snapping a fixed-length arm home",()=>{
  const crowded: ExplainerScene={...scene,durationInFrames:312,
    words:[{text:"upgraded!",start:7.7525,end:8.0025},{text:"despite",start:9.1125,end:9.45},{text:"the",start:9.45,end:9.6},{text:"music",start:9.6,end:10}],
    performance:{beats:[{anchor:"upgraded",intent:"welcome",gesture:"small"},{anchor:"despite the music",intent:"setup",gesture:"none"}]}};
  const track=buildExplainerPerformance(crowded,7,24);
  assert.ok(track.heads.some(cue=>cue.anchor==="upgraded"));
  assert.ok(!track.gestures.some(cue=>cue.anchor==="upgraded"),"This crowded arm cannot fit a natural recovery");
  const wrists=Array.from({length:313},(_,frame)=>bodyRig(explainerPoseAt(frame/24,frame/24,track).body).near.wrist);
  let previousVelocity={x:0,y:0};
  for(let frame=1;frame<wrists.length;frame++) {
    const velocity={x:wrists[frame]!.x-wrists[frame-1]!.x,y:wrists[frame]!.y-wrists[frame-1]!.y};
    assert.ok(Math.hypot(velocity.x,velocity.y)<1,"No fixed-arm wrist jump between 24fps frames");
    assert.ok(Math.hypot(velocity.x-previousVelocity.x,velocity.y-previousVelocity.y)<.4,"No acceleration spike in recovery");
    previousVelocity=velocity;
  }
});
