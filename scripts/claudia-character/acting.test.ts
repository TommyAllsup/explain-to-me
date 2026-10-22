import assert from "node:assert/strict";
import test from "node:test";
import { actingAt } from "./acting.js";
import { bodyRig, warpTorsoPoint, NECK } from "./posture.js";
import type { CharacterBeat } from "./motion.js";

const bounds = [0, 1.191, 2.691, 5.391, 7.941, 12.091, 14.723];
const beats = bounds.slice(0, -1).map((start, i) => ({id:`beat-${i}`, startMs:start * 1000, endMs:bounds[i + 1]! * 1000, text:"test", gesture:"settle"})) as CharacterBeat[];

test("acting keeps arms still during greeting and moves through held gestures without cue resets", () => {
  for (const time of [0, .6, 1.18, 1.2, 2]) {
    const pose = actingAt(time, beats);
    assert.equal(pose.reveal, 0);
    assert.equal(pose.invite, 0);
  }
  assert.equal(actingAt(4.5, beats).reveal, 1);
  assert.equal(actingAt(5.4, beats).reveal, 1, "The sentence boundary must not pull the hand back to neutral");
  assert.equal(actingAt(8, beats).reveal, 0);
  assert.equal(actingAt(10, beats).invite, 0);
  assert.equal(actingAt(13.5, beats).invite, 1);
});

test("chest prepares the reach, shoulder relaxes into it, and fingers follow the forearm", () => {
  const preparation = actingAt(bounds[2]! - .2, beats).body;
  assert.ok(preparation.chestX > 0 && preparation.chestRoll > 0);
  assert.ok(preparation.upperArm > 0 && preparation.shoulder > 0);
  assert.equal(preparation.forearm, 0, "The torso and upper arm should move before the reach");
  const reaching = actingAt(bounds[2]! + .5, beats).body;
  assert.ok(reaching.handOpen < reaching.forearm, "Fingers follow the reaching arm");
  const held = actingAt(4.5, beats).body;
  assert.equal(held.forearm, 1);
  assert.equal(held.handOpen, 1);
  assert.equal(held.shoulder, 0, "Do not hold a shrug for the entire explanation");
  const recovery = actingAt(bounds[3]! + .6, beats).body;
  assert.ok(recovery.handOpen > recovery.forearm, "Hand opening settles after the arm starts to return");
  const closing = actingAt(bounds[5]! - .15, beats).body;
  assert.ok(closing.chestX > 0 && closing.shoulder > 0);
  assert.equal(closing.forearm, 0);
});

test("whole-body motion is bounded, deterministic and continuous between frames", () => {
  const poses = Array.from({length:355}, (_, f) => actingAt(f / 24, beats));
  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i]!;
    assert.ok(Math.abs(pose.headTilt) <= 2.6);
    assert.ok(Math.abs(pose.body.chestRoll) <= 1.65);
    assert.ok(Math.abs(pose.body.chestX) <= 4.5 && Math.abs(pose.body.chestY) <= 1.7);
    assert.ok(pose.reveal >= 0 && pose.reveal <= 1 && pose.invite >= 0 && pose.invite <= 1);
    assert.deepEqual(actingAt(i / 24, beats), pose);
    if (i) {
      assert.ok(Math.abs(pose.reveal - poses[i-1]!.reveal) < .1);
      assert.ok(Math.abs(pose.invite - poses[i-1]!.invite) < .11);
      assert.ok(Math.abs(pose.headTilt - poses[i-1]!.headTilt) < .3);
      const previous = poses[i-1]!.body;
      const wrist = bodyRig(pose.body).near.wrist, previousWrist = bodyRig(previous).near.wrist;
      const neck = warpTorsoPoint(NECK, pose.body), previousNeck = warpTorsoPoint(NECK, previous);
      assert.ok(Math.hypot(wrist.x - previousWrist.x, wrist.y - previousWrist.y) < 9, "No wrist teleport between frames");
      assert.ok(Math.hypot(neck.x - previousNeck.x, neck.y - previousNeck.y) < 1.8, "No chest snap between frames");
    }
  }
});

const authoredBounds = [0, 28584, 64584, 129384, 190584, 290184, 353344].map((sample) => sample / 24000);
const speechBounds = [0, 1.42, 3.1, 5.75, 8.32, 11.9, 14.84];
const withBounds = (boundaries: number[]): CharacterBeat[] => beats.map((beat, i) => ({
  ...beat, startMs: boundaries[i]! * 1000, endMs: boundaries[i + 1]! * 1000,
}));
const authoredBeats = withBounds(authoredBounds), speechBeats = withBounds(speechBounds);

test("retimed body reaches the accepted poses at the new speech boundaries while face keeps its speech clock", () => {
  for (let i = 0; i < speechBounds.length; i++) {
    const retimed = actingAt(speechBounds[i]!, speechBeats, {retimeBody:true});
    const authored = actingAt(authoredBounds[i]!, authoredBeats);
    assert.deepEqual(retimed.body, authored.body);
    assert.equal(retimed.headTilt, authored.headTilt);
    assert.equal(retimed.nod, authored.nod);
    assert.equal(retimed.reveal, authored.reveal);
    assert.equal(retimed.invite, authored.invite);
    assert.deepEqual(retimed.face, actingAt(speechBounds[i]!, speechBeats).face);
  }
  const laterReach = actingAt(4.4, speechBeats, {retimeBody:true});
  assert.equal(laterReach.reveal, 1, "The reaching hand still has a held explaining pose");
  assert.equal(laterReach.body.shoulder, 0, "Retiming must not turn the reach into a held shrug");
});

test("retiming preserves overlapping body motion through uneven sentence speeds without snaps or velocity resets", () => {
  const wristAt = (time: number) => bodyRig(actingAt(time, speechBeats, {retimeBody:true}).body).near.wrist;
  const step = .0001;
  for (const time of speechBounds.slice(1, -1)) {
    const before = wristAt(time - step), at = wristAt(time), after = wristAt(time + step);
    const leftVelocity = {x:(at.x - before.x) / step, y:(at.y - before.y) / step};
    const rightVelocity = {x:(after.x - at.x) / step, y:(after.y - at.y) / step};
    assert.ok(Math.hypot(leftVelocity.x - rightVelocity.x, leftVelocity.y - rightVelocity.y) < .05,
      "A sentence boundary must not reset wrist velocity");
  }
  const closingBoundary = speechBounds[5]!;
  const beforeClose = wristAt(closingBoundary - step), atClose = wristAt(closingBoundary);
  assert.ok(Math.hypot(atClose.x - beforeClose.x, atClose.y - beforeClose.y) / step > .1,
    "The closing gesture's preparation must continue through the sentence boundary");
  let previous = actingAt(0, speechBeats, {retimeBody:true});
  for (let frame = 1; frame < Math.ceil((speechBounds.at(-1)! + 1) * 24); frame++) {
    const pose = actingAt(frame / 24, speechBeats, {retimeBody:true});
    const wrist = bodyRig(pose.body).near.wrist, previousWrist = bodyRig(previous.body).near.wrist;
    const neck = warpTorsoPoint(NECK, pose.body), previousNeck = warpTorsoPoint(NECK, previous.body);
    assert.ok(Math.hypot(wrist.x - previousWrist.x, wrist.y - previousWrist.y) < 9);
    assert.ok(Math.hypot(neck.x - previousNeck.x, neck.y - previousNeck.y) < 1.8);
    assert.ok(pose.reveal >= 0 && pose.reveal <= 1 && pose.invite >= 0 && pose.invite <= 1);
    previous = pose;
  }
});

test("optional retiming rejects malformed speech cues and the default path stays unchanged", () => {
  for (const invalid of [speechBeats.slice(0, 5), speechBeats.map((beat, i) => i === 2 ? {...beat, startMs:beat.startMs + 20} : beat),
    speechBeats.map((beat, i) => i === 2 ? {...beat, endMs:NaN} : beat)]) {
    assert.throws(() => actingAt(4, invalid, {retimeBody:true}), /six continuous, increasing speech beats/u);
  }
  for (const time of [0, 2.4, 4, 5.7, 8.5, 12.4, 14.7]) {
    assert.deepEqual(actingAt(time, beats, {retimeBody:false}), actingAt(time, beats));
  }
});
