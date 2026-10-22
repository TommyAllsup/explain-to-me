import assert from "node:assert/strict";
import test from "node:test";
import { blinkAt, facialAt } from "./expressions.js";
import type { CharacterBeat } from "./motion.js";

const bounds = [0, 1.191, 2.691, 5.391, 7.941, 12.091, 14.723];
const beats: CharacterBeat[] = bounds.slice(0, -1).map((start, i) => ({
  id: `beat-${i}`, startMs: start * 1000, endMs: bounds[i + 1]! * 1000,
  text: "test", gesture: "settle",
}));

test("a blink makes visible lid contact at 24 fps and opens more slowly than it closes", () => {
  // Shift the event across a whole frame so contact cannot depend on a lucky
  // alignment between the sentence timestamp and the renderer's frame clock.
  for (let phase = 0; phase < 24; phase++) {
    const start = 1 + phase / (24 * 24);
    const frames = Array.from({ length: 12 }, (_, frame) => blinkAt(1 + frame / 24, start));
    assert.ok(frames.includes(1), `The blink misses full contact at phase ${phase}`);
    assert.equal(frames.at(-1), 0);
  }
  const samples = Array.from({ length: 501 }, (_, ms) => blinkAt(ms / 1000, 0));
  const rising10 = samples.findIndex((value) => value >= .1);
  const rising90 = samples.findIndex((value) => value >= .9);
  const contact = samples.indexOf(1);
  const falling90 = samples.findIndex((value, i) => i > contact && value <= .9);
  const falling10 = samples.findIndex((value, i) => i > contact && value <= .1);
  assert.ok(contact > rising90);
  assert.ok(falling10 - falling90 > (rising90 - rising10) * 1.5,
    "A relaxed reopening should take noticeably longer than the protective closure");
});

test("eyes find and hold a target before the explanation, then reconnect with the viewer", () => {
  const viewer = facialAt(bounds[1]! + .5, beats);
  const look = [-.1, .1, .3].map((offset) => facialAt(bounds[2]! + offset, beats));
  assert.ok(look[0]!.gazeX - viewer.gazeX > 3, "The gaze should lead the explaining gesture");
  for (const pose of look.slice(1)) {
    assert.ok(Math.abs(pose.gazeX - look[0]!.gazeX) < .1, "Hold the target without pupil drift");
    assert.ok(Math.abs(pose.gazeY - look[0]!.gazeY) < .1);
  }
  const reconnected = facialAt((bounds[2]! + bounds[3]!) / 2, beats);
  assert.ok(Math.abs(reconnected.gazeX) < 1 && Math.abs(reconnected.gazeY) < .3);
});

test("the reflective glance is brief, while the final question keeps direct engagement", () => {
  const reflective = [.35, .6].map((offset) => facialAt(bounds[3]! + offset, beats));
  assert.ok(reflective[0]!.gazeX < -2 && reflective[0]!.gazeY < -1);
  assert.ok(Math.abs(reflective[1]!.gazeX - reflective[0]!.gazeX) < .1);
  const caution = facialAt((bounds[4]! + bounds[5]!) / 2, beats);
  const question = facialAt((bounds[5]! + bounds[6]!) / 2, beats);
  for (const pose of [caution, question, facialAt(bounds[6]!, beats)]) {
    assert.ok(Math.abs(pose.gazeX) < 1 && Math.abs(pose.gazeY) < .3,
      "Reconnect for the warning and hold eye contact through the closing question");
  }
});

test("warmth, curiosity and caution have distinct restrained facial performances", () => {
  const welcome = facialAt(.7, beats);
  const curious = facialAt((bounds[3]! + bounds[4]!) / 2, beats);
  const caution = facialAt((bounds[4]! + bounds[5]!) / 2, beats);
  const invite = facialAt((bounds[5]! + bounds[6]!) / 2, beats);
  assert.ok(welcome.smile > caution.smile + .3 && invite.smile > caution.smile + .3);
  assert.ok(welcome.cheek > caution.cheek + .4 && invite.cheek > caution.cheek + .4,
    "Warmth should reach the cheeks as well as the mouth");
  assert.ok(caution.openness < welcome.openness, "The warning narrows the eyes slightly");
  assert.ok(curious.browLeft - curious.browRight > 1,
    "Curiosity should have an asymmetric brow, rather than a surprised double raise");
  assert.ok(invite.smile < .8 && curious.openness < 1.1, "Keep Claudia's expressions understated");
});

test("all facial controls stay finite, bounded and reproducible for the complete take", () => {
  const ranges = {
    gazeX: [-6, 6], gazeY: [-3.2, 3.2], blink: [0, 1], openness: [.78, 1.16],
    squint: [0, 1], browLeft: [-3, 3], browRight: [-3, 3],
    browTiltLeft: [-4, 4], browTiltRight: [-4, 4], cheek: [0, 1], smile: [0, 1],
  } as const;
  for (let frame = 0; frame <= Math.ceil(bounds[6]! * 24); frame++) {
    const time = frame / 24;
    const pose = facialAt(time, beats);
    assert.deepEqual(facialAt(time, beats), pose);
    for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
      const [minimum, maximum] = ranges[key];
      assert.ok(Number.isFinite(pose[key]) && pose[key] >= minimum && pose[key] <= maximum,
        `${key} is invalid at frame ${frame}`);
    }
  }
});
