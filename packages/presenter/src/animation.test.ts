import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { ProductionManifest } from "../../contracts/src/production-manifest.js";
import type { NarrationAlignment } from "../../contracts/src/narration-alignment.js";
import { buildTimeline } from "../../timeline/src/timeline.js";
import { assertPresenterAnimation, buildPresenterAnimation } from "./animation.js";
import { buildPerformance, presenterPoseAt } from "./performance.js";
import { bodyRig, NEUTRAL_BODY } from "./claudia/posture.js";

function fixture() {
  const texts = ["Welcome to a lesson about how local animation works.", "An A P I connects these two separate programs.", "Keep the words clear and let the presenter explain."];
  const manifest: ProductionManifest = {
    version: "1", title: "A neutral lesson", profile: "preview", theme: "technical-whiteboard", targetDurationMs: 20_000,
    scenes: texts.map((text, i) => ({ id: `scene-${i}`, kind: i === 0 ? "title" : i === 2 ? "outro" : "statement", title: `Idea ${i + 1}`,
      narration: [{ id: `chunk-${i}`, text: i === 1 ? text.replace("A P I", "API") : text, ...(i === 1 ? { spokenText: text } : {}) }],
      visual: { presenter: { character: "claudia" } } })),
  };
  const buffers: Buffer[] = [];
  const alignment: NarrationAlignment = { version: 1, chunks: texts.map((text, i) => {
    const samples = 24_000 * 7 + i * 317, duration = samples / 24_000, pcm = Buffer.alloc(samples * 2);
    for (let sample = 6_000; sample < samples - 6_000; sample++) pcm.writeInt16LE(Math.round(Math.sin(sample / 17) * 8_000), sample * 2);
    buffers.push(pcm);
    const tokens = text.split(" "), spacing = (duration - .8) / tokens.length;
    const words = tokens.map((word, j) => ({ text: word, start: .3 + j * spacing, end: .3 + (j + .8) * spacing }));
    const phonemes = words.flatMap((word) => ["b", "ɑ", "m"].map((phoneme, j) => ({ phoneme,
      start: word.start + j * (word.end - word.start) / 3, end: word.start + (j + 1) * (word.end - word.start) / 3 })));
    return { id: `chunk-${i}`, text, sampleRate: 24000, samples, pcmSha256: createHash("sha256").update(pcm).digest("hex"), words, phonemes };
  }) };
  return { manifest, alignment, pcm: Buffer.concat(buffers), timeline: buildTimeline(manifest, alignment.chunks) };
}

test("arbitrary three-scene narration derives repeatable mouth, expression, and body tracks from its own recording", () => {
  const input = fixture(), animation = buildPresenterAnimation(input);
  assert.deepEqual(buildPresenterAnimation(input), animation);
  assert.equal(animation.scenes.length, 3);
  assert.equal(animation.scenes.reduce((n, scene) => n + scene.mouth.length, 0), input.timeline.durationInFrames);
  assert.ok(animation.scenes.every((scene) => scene.performance.face.expressions.length > 0));
  assert.ok(animation.scenes.every((scene) => scene.mouth.some((pose) => pose.closure === 1)));
  assert.ok(animation.scenes.every((scene) => scene.mouth.some((pose) => pose.open > .3)));
  assert.equal(input.timeline.chunks[1]!.text, "An API connects these two separate programs.", "Caption display text is retained");
  assert.match(animation.scenes[1]!.performance.beats[0]!.anchor, /A P I/, "Acting follows the expanded spoken text");
  assertPresenterAnimation(input.manifest, input.timeline, animation);
});

test("alignment rejects changed audio, transcript, order, omissions, extra samples and overlapping or out-of-range intervals", () => {
  const corruptions: Array<(input: ReturnType<typeof fixture>) => void> = [
    (input) => { input.pcm[100] = 17; },
    (input) => { input.alignment.chunks[0]!.text += " Surprise."; },
    (input) => { input.alignment.chunks.reverse(); },
    (input) => { input.alignment.chunks[0]!.words.pop(); },
    (input) => { input.alignment.chunks[0]!.words[1]!.start = .1; },
    (input) => { input.alignment.chunks[0]!.phonemes[1]!.end = 99; },
    (input) => { input.alignment.chunks[0]!.phonemes[0]!.start = Number.NaN; },
    (input) => { input.pcm = Buffer.concat([input.pcm, Buffer.alloc(2)]); },
    (input) => { input.timeline.scenes[1]!.from += 1; },
  ];
  for (const corrupt of corruptions) {
    const input = fixture(); corrupt(input);
    assert.throws(() => buildPresenterAnimation(input), /alignment|Aligned words|interval/);
  }
});

test("renderer validation rejects missing, stale, unbounded and truncated animation", () => {
  const input = fixture(), animation = buildPresenterAnimation(input);
  assert.throws(() => assertPresenterAnimation(input.manifest, input.timeline), /requires valid/);
  const changes: Array<(candidate: typeof animation) => void> = [
    (candidate) => { candidate.manifestSha256 = "0".repeat(64); },
    (candidate) => { candidate.scenes[0]!.mouth.pop(); },
    (candidate) => { candidate.scenes[0]!.mouth[0]!.open = 1.01; },
    (candidate) => { candidate.scenes[0]!.performance.heads[0]!.end = 99; },
    (candidate) => { candidate.scenes[0]!.performance.face.expressions[0]!.arrive = 0; },
    (candidate) => { candidate.scenes.reverse(); },
  ];
  for (const change of changes) {
    const candidate = structuredClone(animation); change(candidate);
    assert.throws(() => assertPresenterAnimation(input.manifest, input.timeline, candidate), /Presenter|presenter|Animated/);
  }
  const still = structuredClone(input.manifest);
  for (const scene of still.scenes) delete scene.visual.presenter;
  assertPresenterAnimation(still, input.timeline);
  assert.throws(() => assertPresenterAnimation(still, input.timeline, animation), /without an animated/);
});

test("reduced motion keeps speech and facial engagement with a planted body", () => {
  const input = fixture();
  input.manifest.scenes[0]!.visual.presenter = { character: "claudia", motion: "reduced" };
  const scene = buildPresenterAnimation(input).scenes[0]!;
  assert.equal(scene.motion, "reduced");
  assert.ok(scene.mouth.some((pose) => pose.open > .3));
  for (let frame = 0; frame < scene.durationInFrames; frame++) {
    const pose = presenterPoseAt(frame / 24, frame / 24, scene.performance, scene.motion);
    assert.deepEqual(pose.body, NEUTRAL_BODY);
    assert.equal(pose.headTilt, 0); assert.equal(pose.nod, 0);
    assert.ok(pose.face.smile > 0);
  }
});

test("crowded phrases retain expressions and omit arms that cannot recover naturally", () => {
  const words = Array.from({ length: 120 }, (_, index) => ({ text: index % 3 === 2 ? "thought." : "another", start: .25 + index * .12, end: .35 + index * .12 }));
  const performance = buildPerformance({ id: "dense", duration: 16, words }, 1);
  assert.ok(performance.face.expressions.length > 20);
  assert.ok(performance.gestures.length < 4);
  const wrists = Array.from({ length: 385 }, (_, frame) => bodyRig(presenterPoseAt(frame / 24, frame / 24, performance).body).near.wrist);
  let previousVelocity = { x: 0, y: 0 };
  for (let i = 1; i < wrists.length; i++) {
    const velocity = { x: wrists[i]!.x - wrists[i - 1]!.x, y: wrists[i]!.y - wrists[i - 1]!.y };
    assert.ok(Math.hypot(velocity.x, velocity.y) < 7, "No wrist jump between 24fps frames");
    assert.ok(Math.hypot(velocity.x - previousVelocity.x, velocity.y - previousVelocity.y) < 1.6, "No sharp arm recovery");
    previousVelocity = velocity;
  }
});

test("connected gestures begin in the chest, then arm, forearm, and fingers; scene cuts settle", () => {
  const scene = buildPresenterAnimation(fixture()).scenes[0]!, track = scene.performance, cue = track.gestures[0]!;
  assert.ok(cue, "An unhurried phrase receives a gesture");
  const early = presenterPoseAt(cue.start + .1, 0, track).body;
  assert.ok(early.chestX > 0); assert.equal(early.upperArm, 0); assert.equal(early.forearm, 0); assert.equal(early.handOpen, 0);
  const next = presenterPoseAt(cue.start + .27, 0, track).body;
  assert.ok(next.upperArm > 0); assert.ok(next.forearm > 0); assert.equal(next.handOpen, 0);
  assert.deepEqual(presenterPoseAt(track.duration, 30, track), presenterPoseAt(0, 30, track));
});
