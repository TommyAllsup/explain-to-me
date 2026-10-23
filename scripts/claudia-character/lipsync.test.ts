import assert from "node:assert/strict";
import test from "node:test";
import { buildMouthTrack, type MouthPose } from "./lipsync.js";

const keys = ["open", "width", "round", "closure", "teeth", "tongue"] as const;
const at = (track: MouthPose[], time: number, fps = 24) => track[Math.floor(time * fps)]!;
const phone = (phoneme: string, start: number, end: number) => ({ phoneme, start, end });

test("vowels change lip geometry independently of equally loud audio", () => {
  const track = buildMouthTrack([phone("a", .1, .4), phone("i", .6, .9), phone("u", 1.1, 1.4)], Array(40).fill(.7), 24);
  const open = at(track, .25);
  const broad = at(track, .75);
  const round = at(track, 1.25);
  assert.ok(open.open > broad.open * 2);
  assert.ok(broad.width > round.width * 2);
  assert.ok(round.round > .9 && broad.round === 0);
});

test("bilabials anticipate and fully seal lips despite loud audio, including subframe plosives", () => {
  for (const consonant of ["m", "b", "p"]) {
    const track = buildMouthTrack([phone("a", 0, .4), phone(consonant, .4, .425), phone("a", .425, 1)], Array(24).fill(1), 24);
    assert.ok(at(track, .35).closure > 0, "Contact should prepare before the consonant starts.");
    const contact = track.filter((_, index) => (index + .5) / 24 >= .35 && (index + .5) / 24 <= .45);
    assert.ok(contact.some((pose) => pose.closure === 1 && pose.open === 0), `Missing full ${consonant} contact.`);
    assert.ok(at(track, .65).open > .7, "The next vowel should regain its jaw movement.");
  }
});

test("labiodentals and dental consonants produce distinct teeth and tongue controls", () => {
  const track = buildMouthTrack([phone("v", .1, .4), phone("θ", .6, .9), phone("a", 1.1, 1.4)], Array(40).fill(.8), 24);
  assert.ok(at(track, .25).teeth > .9 && at(track, .25).tongue === 0);
  assert.ok(at(track, .75).tongue > .8 && at(track, .75).teeth < .2);
  assert.equal(at(track, 1.25).teeth, 0);
});

test("stress markers are transparent and true phrase gaps return to relaxed closed rest", () => {
  const speech = [phone("a", .1, .3), phone("ˈ", .3, .325), phone("i", .325, .5), phone(".", .5, .9), phone("u", 1, 1.3)];
  const track = buildMouthTrack(speech, Array(40).fill(.7), 24);
  assert.ok(at(track, .3).open > .2, "Stress markup should not insert a closed frame.");
  assert.deepEqual(at(track, .8), { open: 0, width: .5, round: 0, closure: 0, teeth: 0, tongue: 0 });
  assert.deepEqual(track, buildMouthTrack(speech, Array(40).fill(.7), 24));
  const expanded = [phone("a", .1, .3), phone("i", .3, .5), phone(".", .5, .9), phone("u", 1, 1.3)];
  assert.deepEqual(track, buildMouthTrack(expanded, Array(40).fill(.7), 24));
});

test("duration-bearing IPA length tokens continue the preceding vowel instead of creating a false gap", () => {
  const marked = [phone("u", .1, .2), phone("ː", .2, .4), phone("θ", .4, .6)];
  const expanded = [phone("u", .1, .4), phone("θ", .4, .6)];
  const track = buildMouthTrack(marked, Array(24).fill(.7), 24);
  assert.deepEqual(track, buildMouthTrack(expanded, Array(24).fill(.7), 24));
  assert.ok(at(track, .3).round > .9);
});

test("the saved Bella opening has a visible m contact between the opening diphthong and Claudia", () => {
  // Actual intervals from Bella's performance, kept inline so no ignored output
  // file or installed speech model is needed to run the regression.
  const speech = [phone("a", .066, .116), phone("ɪ", .116, .166), phone("m", .166, .216), phone(" ", .216, .266), phone("k", .266, .316), phone("l", .316, .341)];
  const track = buildMouthTrack(speech, Array(12).fill(.8), 24);
  assert.ok(at(track, .08).open > .1);
  assert.equal(at(track, .18).open, 0);
  assert.equal(at(track, .18).closure, 1);
  assert.ok(at(track, .3).open > 0);
});

test("coarticulation has no full-pose swaps at adjacent phoneme boundaries", () => {
  const speech = [phone("a", 0, .25), phone("u", .25, .5), phone("i", .5, .75), phone("m", .75, .8), phone("f", .8, 1.05), phone("æ", 1.05, 1.3)];
  const track = buildMouthTrack(speech, Array(36).fill(.8), 24);
  for (let frame = 1; frame < track.length; frame++) {
    for (const key of keys) {
      const delta = Math.abs(track[frame]![key] - track[frame - 1]![key]);
      assert.ok(delta <= (key === "closure" ? .78 : .6), `Abrupt ${key} change of ${delta} at frame ${frame}.`);
    }
  }
  assert.ok(at(track, .25).round > 0 && at(track, .25).round < .94, "The vowel boundary should blend both lip shapes.");
});

test("silent final frames close and all controls remain finite, bounded and deterministic", () => {
  const energy = [...Array(20).fill(.8), ...Array(4).fill(0)];
  const speech = [phone("ə", 0, 1)];
  const track = buildMouthTrack(speech, energy, 24);
  assert.equal(track.length, energy.length);
  assert.deepEqual(track.at(-1), { open: 0, width: .5, round: 0, closure: 0, teeth: 0, tongue: 0 });
  assert.ok(track.every((pose) => keys.every((key) => Number.isFinite(pose[key]) && pose[key] >= 0 && pose[key] <= 1)));
  assert.deepEqual(track, buildMouthTrack(speech, energy, 24));
  assert.deepEqual(buildMouthTrack([], [], 24), []);
  assert.ok(buildMouthTrack(speech, Array(24).fill(0), 24).every((pose) => pose.open === 0));
  assert.throws(() => buildMouthTrack(speech, [NaN], 24), /energy/u);
  assert.throws(() => buildMouthTrack(speech, [-1], 24), /energy/u);
  assert.throws(() => buildMouthTrack(speech, [.5], 0), /fps/u);
  assert.throws(() => buildMouthTrack([phone("a", .5, .1)], [.5], 24), /intervals/u);
});
