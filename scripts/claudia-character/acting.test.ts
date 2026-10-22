import assert from "node:assert/strict";
import test from "node:test";
import { actingAt } from "./acting.js";
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

test("whole-figure and limb motion is bounded and has no frame discontinuities", () => {
  const poses = Array.from({length:355}, (_, f) => actingAt(f / 24, beats));
  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i]!;
    assert.ok(Math.abs(pose.headTilt) <= 2.2);
    assert.ok(Math.abs(pose.lean) <= .6);
    assert.ok(pose.reveal >= 0 && pose.reveal <= 1 && pose.invite >= 0 && pose.invite <= 1);
    assert.deepEqual(actingAt(i / 24, beats), pose);
    if (i) {
      assert.ok(Math.abs(pose.reveal - poses[i-1]!.reveal) < .1);
      assert.ok(Math.abs(pose.invite - poses[i-1]!.invite) < .11);
      assert.ok(Math.abs(pose.headTilt - poses[i-1]!.headTilt) < .3);
    }
  }
});
