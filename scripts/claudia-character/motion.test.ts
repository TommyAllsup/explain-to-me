import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mouthEnvelope, prepareTimeline, verifyTiming, type PerformanceTiming } from "./motion.js";

function fixture(): { timing: PerformanceTiming; wav: Buffer; pcm: Buffer; text: string } {
  const samples = 6001;
  const pcm = Buffer.alloc(samples * 2);
  const wav = Buffer.concat([Buffer.from("synthetic WAV bytes for the hash binding"), pcm]);
  const sentences = ["Hello.", "Let's explain.", "Remember work.", "Think about age.", "Refresh it.", "Done."];
  const text = sentences.join(" ");
  return {
    wav,
    pcm,
    text,
    timing: {
      version: 1,
      voice: "af_bella",
      sampleRate: 24000,
      samples,
      audioSha256: createHash("sha256").update(wav).digest("hex"),
      method: "Synthetic timing fixture",
      text,
      cues: sentences.map((sentence, index) => ({
        text: sentence,
        startSample: index * 1000,
        endSample: index === sentences.length - 1 ? samples : (index + 1) * 1000,
      })),
      phonemes: [{ phoneme: "h", start: 0, end: 0.02 }],
    },
  };
}

test("timing is accepted only for the selected script and its matching audio bytes", () => {
  const { timing, wav, pcm, text } = fixture();
  assert.deepEqual(verifyTiming(timing, wav, pcm, text), timing);

  const changedAudio = Buffer.from(wav);
  changedAudio[changedAudio.length - 1] = 1;
  assert.throws(() => verifyTiming(timing, changedAudio, pcm, text), /hash and sample count/u);
  assert.throws(() => verifyTiming({ ...timing, samples: timing.samples + 1 }, wav, pcm, text), /hash and sample count/u);
  assert.throws(() => verifyTiming(timing, wav, pcm.subarray(2), text), /hash and sample count/u);
  assert.throws(() => verifyTiming(timing, wav, pcm, "A different approved script."), /reviewed audition script/u);

  const changedCaption = structuredClone(timing);
  changedCaption.cues[2]!.text = "An unrelated sentence.";
  assert.throws(() => verifyTiming(changedCaption, wav, pcm, text), /reviewed audition script/u);
  assert.throws(() => verifyTiming({ ...timing, voice: "af_heart" }, wav, pcm, text));
});

test("caption timing rejects gaps, overlaps, backwards intervals, and missing audio coverage", () => {
  const { timing, wav, pcm, text } = fixture();
  const mutations: Array<(copy: PerformanceTiming) => void> = [
    (copy) => { copy.cues[0]!.startSample = 1; },
    (copy) => { copy.cues[2]!.startSample += 1; },
    (copy) => { copy.cues[2]!.startSample -= 1; },
    (copy) => { copy.cues[2]!.endSample = copy.cues[2]!.startSample; },
    (copy) => { copy.cues[5]!.endSample = copy.samples + 1; },
    (copy) => { copy.cues[5]!.endSample = copy.samples - 1; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(timing);
    mutate(changed);
    assert.throws(() => verifyTiming(changed, wav, pcm, text), /Caption cues/u);
  }
});

test("phoneme timing cannot run backwards or beyond the associated audio", () => {
  const { timing, wav, pcm, text } = fixture();
  const beyondAudio = structuredClone(timing);
  beyondAudio.phonemes[0]!.end = timing.samples / timing.sampleRate + 0.01;
  assert.throws(() => verifyTiming(beyondAudio, wav, pcm, text), /Invalid model phoneme timing/u);
  const backwardsInterval = structuredClone(timing);
  backwardsInterval.phonemes[0] = { phoneme: "a", start: 0.02, end: 0.01 };
  assert.throws(() => verifyTiming(backwardsInterval, wav, pcm, text), /Invalid model phoneme timing/u);
  const unordered = structuredClone(timing);
  unordered.phonemes = [{ phoneme: "a", start: 0.02, end: 0.03 }, { phoneme: "b", start: 0.01, end: 0.02 }];
  assert.throws(() => verifyTiming(unordered, wav, pcm, text), /Invalid model phoneme timing/u);
});

test("silent and quiet audio close the mouth, including immediately after speech", () => {
  assert.deepEqual(mouthEnvelope(Buffer.alloc(6001 * 2)), Array(7).fill(0));
  const pcm = Buffer.alloc(3000 * 2);
  for (let sample = 0; sample < 1000; sample++) pcm.writeInt16LE(16000, sample * 2);
  for (let sample = 2000; sample < 3000; sample++) pcm.writeInt16LE(100, sample * 2);
  const levels = mouthEnvelope(pcm);
  assert.ok(levels[0]! > 0, "Audible speech should open the mouth.");
  assert.equal(levels[1], 0, "Silence should not inherit the preceding open-mouth pose.");
  assert.equal(levels[2], 0, "Background-level audio should not keep the mouth open.");
});

test("mouth movement stays bounded and deterministic and retains a final partial audio frame", () => {
  const pcm = Buffer.alloc(5001 * 2);
  for (let sample = 0; sample < 5001; sample++) {
    pcm.writeInt16LE(sample % 2 === 0 ? -32768 : 32767, sample * 2);
  }
  const levels = mouthEnvelope(pcm);
  assert.equal(levels.length, 6);
  assert.ok(levels.every((value) => Number.isFinite(value) && value > 0 && value <= 1));
  assert.deepEqual(mouthEnvelope(pcm), levels);
  assert.throws(() => mouthEnvelope(Buffer.alloc(0)), /PCM16/u);
  assert.throws(() => mouthEnvelope(Buffer.alloc(3)), /PCM16/u);
  assert.throws(() => mouthEnvelope(pcm, 0), /integer fps/u);
  assert.throws(() => mouthEnvelope(pcm, 23.5), /integer fps/u);
});

test("timeline rounds up the final video frame while captions end at the exact audio sample", () => {
  const { timing, wav, pcm, text } = fixture();
  const verified = verifyTiming(timing, wav, pcm, text);
  for (const fps of [24, 30]) {
    const { timeline, captions, beats } = prepareTimeline(verified, fps);
    const audioEndMs = 6001 / 24;
    const videoEndMs = timeline.durationInFrames * 1000 / fps;
    assert.equal(timeline.durationMs, audioEndMs);
    assert.equal(timeline.durationInFrames, fps === 24 ? 7 : 8);
    assert.ok(videoEndMs >= audioEndMs && videoEndMs - audioEndMs < 1000 / fps);
    assert.equal(captions.at(-1)!.endMs, audioEndMs);
    assert.equal(beats.at(-1)!.endMs, audioEndMs);
    assert.equal(timeline.scenes[0]!.from, 0);
    for (let index = 0; index < timeline.scenes.length - 1; index++) {
      const scene = timeline.scenes[index]!;
      assert.equal(scene.from + scene.durationInFrames, timeline.scenes[index + 1]!.from);
      assert.equal(captions[index]!.endMs, captions[index + 1]!.startMs);
    }
    const lastScene = timeline.scenes.at(-1)!;
    assert.equal(lastScene.from + lastScene.durationInFrames, timeline.durationInFrames);
    assert.equal(captions.map((caption) => caption.text).join(" "), text);
    assert.deepEqual(beats.map((beat) => beat.gesture), ["greet", "greet", "explain", "think", "explain", "settle"]);
  }
});
