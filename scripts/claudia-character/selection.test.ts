import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { extractPcmDataFromWav } from "../../packages/audio/src/synthesize.js";
import { verifyTiming } from "./motion.js";
import { prepareCharacterPerformance } from "./performance.js";
import { resolvePerformance, selectedVoiceSchema, verifyApprovedPerformance } from "./selection.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const selected = selectedVoiceSchema.parse(JSON.parse(await readFile(join(root, "fixtures/presenters/claudia/selected-voice.json"), "utf8")));
const source = resolvePerformance(root, selected);
const [wav, timingBytes, reportBytes, config] = await Promise.all([
  readFile(join(source.directory, "audio.wav")), readFile(join(source.directory, "timings.json")),
  readFile(join(source.directory, "report.json")), readFile(join(root, "fixtures/presenters/claudia/voice-audition.json"), "utf8"),
]);
const pcm = extractPcmDataFromWav(wav);
const timing = verifyTiming(JSON.parse(timingBytes.toString("utf8")), wav, pcm, JSON.parse(config).text);
const {props} = prepareCharacterPerformance(timing, pcm);
const approved = {wav, timingBytes, reportBytes, timing, props};

test("the default uses the tracked Chatterbox take, with explicit comparison inputs still available", () => {
  assert.equal(source.directory, join(root, "fixtures/presenters/claudia/approved-chatterbox"));
  assert.equal(source.usesApprovedDefault, true);
  const comparison = resolvePerformance(root, selected, "out/claudia-bella-performance");
  assert.equal(comparison.directory, resolve("out/claudia-bella-performance"));
  assert.equal(comparison.usesApprovedDefault, false);
});

test("the bundled take reproduces the approved mouth, facial, gaze, blink and body-timing controls", () => {
  assert.doesNotThrow(() => verifyApprovedPerformance(selected, approved));
  assert.equal(props.durationInFrames, 357);
  assert.equal(props.retimeBody, true);
  assert.equal(props.facialActing?.source, "word-alignment");
});

test("default builds reject substituted audio, changed timing and changed facial or lip controls", () => {
  const changedAudio = Buffer.from(wav);
  changedAudio[changedAudio.length - 1] = changedAudio.at(-1)! ^ 1;
  assert.throws(() => verifyApprovedPerformance(selected, {...approved, wav:changedAudio}), /approved Chatterbox audio/u);
  assert.throws(() => verifyApprovedPerformance(selected, {...approved, timingBytes:Buffer.concat([timingBytes, Buffer.from(" ")])}), /approved Chatterbox audio/u);
  const changedFace = structuredClone(props);
  changedFace.facialActing!.expressions[0]!.intensity = 0;
  assert.throws(() => verifyApprovedPerformance(selected, {...approved, props:changedFace}), /Default lip sync or acting/u);
  const changedMouth = structuredClone(props);
  changedMouth.mouth[0]!.open = 0.9;
  assert.throws(() => verifyApprovedPerformance(selected, {...approved, props:changedMouth}), /Default lip sync or acting/u);
});

test("a Bella comparison keeps its original preparation instead of receiving Chatterbox facial timing", () => {
  const {version: _version, voice: _voice, ...shared} = timing;
  const bella = {...shared, version:1 as const, voice:"af_bella" as const};
  const comparison = prepareCharacterPerformance(bella, pcm);
  assert.equal(comparison.props.voiceLabel, "BELLA / A");
  assert.equal(comparison.props.facialActing, undefined);
  assert.equal(comparison.props.retimeBody, undefined);
  assert.throws(() => verifyApprovedPerformance(selected, {...approved, timing:bella, props:comparison.props}), /approved Chatterbox voice/u);
});
