import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureMediaTools, findExecutable } from "../../runtime/src/tools.js";
import { extractPcmDataFromWav, PCM_SAMPLE_RATE } from "./synthesize.js";
import { MAX_MUSIC_SOURCE_BYTES, mixPcmSoundtrack, mixSoundtrack, resolveMusic, type MusicConfig } from "./soundtrack.js";

const config: MusicConfig = { source: "music.wav", gainDb: -20, duckingDb: -8, fadeInMs: 100, fadeOutMs: 100 };
configureMediaTools();
const hasFfmpeg = findExecutable("ffmpeg") !== null;

function pcm(samples: number, value: number | ((index: number) => number)): Buffer {
  const output = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) output.writeInt16LE(typeof value === "number" ? value : value(index), index * 2);
  return output;
}

function wav(data: Buffer, rate = PCM_SAMPLE_RATE, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(data.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test("soundtrack gain/fades preserve narration and sample length when the music ends early", () => {
  const narration = pcm(24_000, 1_000);
  const before = Buffer.from(narration);
  const source = pcm(12_000, 10_000);
  const result = mixPcmSoundtrack(narration, source, { ...config, duckingDb: 0 });
  assert.deepEqual(narration, before);
  assert.equal(result.musicPcm.length, narration.length);
  assert.equal(result.mixedPcm.length, narration.length);
  assert.equal(result.musicPcm.readInt16LE(0), 0);
  assert.equal(result.musicPcm.readInt16LE(6_000 * 2), 1_000);
  assert.equal(result.musicPcm.readInt16LE(11_999 * 2), 0);
  assert.equal(result.musicPcm.readInt16LE(12_000 * 2), 0);
  assert.deepEqual(result.mixedPcm.subarray(12_000 * 2), narration.subarray(12_000 * 2));
  assert.equal(result.mixedSignal.clippingPass, true);
});

test("ducking responds to narration and releases smoothly during a longer pause", () => {
  const narration = pcm(48_000, (index) => index < 12_000 ? 2_000 : 0);
  const result = mixPcmSoundtrack(narration, pcm(48_000, 10_000), {
    ...config, gainDb: 0, duckingDb: -20, fadeInMs: 0, fadeOutMs: 0,
  });
  assert.equal(result.musicPcm.readInt16LE(6_000 * 2), 1_000);
  assert.equal(result.musicPcm.readInt16LE(13_000 * 2), 1_000, "hold prevents pumping between words");
  assert.ok(result.musicPcm.readInt16LE(18_000 * 2) > 1_000);
  assert.ok(result.musicPcm.readInt16LE(47_999 * 2) > 9_900);
});

test("a track longer than narration fades at narration end without extending speech", () => {
  const result = mixPcmSoundtrack(pcm(6_000, 1_000), pcm(12_000, 10_000), { ...config, duckingDb: 0 });
  assert.equal(result.musicPcm.length, 12_000);
  assert.equal(result.musicPcm.readInt16LE(5_999 * 2), 0);
  assert.equal(result.mixedPcm.readInt16LE(5_999 * 2), 1_000);
});

test("soundtrack refuses clipping instead of normalizing, truncating, or saturating speech", () => {
  const narration = pcm(2_000, 30_000);
  const before = Buffer.from(narration);
  assert.throws(() => mixPcmSoundtrack(narration, pcm(2_000, 10_000), {
    ...config, gainDb: 0, duckingDb: 0, fadeInMs: 0, fadeOutMs: 0,
  }), /would clip.*lower music/u);
  assert.deepEqual(narration, before);
});

test("soundtrack validates PCM and bounded settings", () => {
  for (const invalid of [{ gainDb: 1 }, { gainDb: -61 }, { duckingDb: 1 }, { duckingDb: -31 }, { fadeInMs: -1 }, { fadeOutMs: 10_001 }, { gainDb: Number.NaN }]) {
    assert.throws(() => mixPcmSoundtrack(pcm(1, 0), pcm(1, 0), { ...config, ...invalid }), /must be between/u);
  }
  assert.throws(() => mixPcmSoundtrack(Buffer.alloc(1), pcm(1, 0), config), /complete signed/u);
});

test("music selection binds a local regular file with user-supplied provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "etm soundtrack narración "));
  try {
    const bytes = wav(pcm(100, 1_000));
    await writeFile(join(root, "music.wav"), bytes);
    const music = await resolveMusic(root, { ...config, rights: { holder: "Fixture author", license: "Synthetic fixture", note: "No clearance is implied" } });
    assert.equal(music.sourceSha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(music.sourceBytes, bytes.length);
    assert.equal(music.provenance.rightsStatus, "user-supplied; not verified");
    assert.equal(music.provenance.rights.holder, "Fixture author");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("music selection refuses traversal, remote paths, unsupported inputs and nonregular files", async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-soundtrack-bounds-"));
  try {
    for (const source of ["../music.wav", "/music.wav", "C:/music.wav", "https://example.com/music.wav", "file:music.wav", "dir\\music.wav", "music.m3u", "music.aiff", "dir//music.wav"]) {
      await assert.rejects(resolveMusic(root, { ...config, source }), /project-relative|must be WAV/u, source);
    }
    await mkdir(join(root, "music.wav"));
    await assert.rejects(resolveMusic(root, config), /regular file/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("music selection refuses symlinked or junction directory escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-soundtrack-links-"));
  const outside = await mkdtemp(join(tmpdir(), "etm-soundtrack-outside-"));
  try {
    await writeFile(join(outside, "music.wav"), wav(pcm(100, 100)));
    await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(resolveMusic(root, { ...config, source: "linked/music.wav" }), /[Ll]inked|[Rr]eparse/u);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("music selection bounds source file bytes before decoding", async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-soundtrack-size-"));
  try {
    const file = await open(join(root, "music.wav"), "wx");
    try { await file.truncate(MAX_MUSIC_SOURCE_BYTES + 1); } finally { await file.close(); }
    await assert.rejects(resolveMusic(root, config), /100 MiB/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("soundtrack media build decodes stereo, keeps narration exact, and preserves previous outputs", { skip: !hasFfmpeg }, async () => {
  const root = await mkdtemp(join(tmpdir(), "etm soundtrack média "));
  try {
    // Half a second of 48 kHz stereo, then half a second with narration alone.
    const source = wav(pcm(48_000, (index) => Math.round(8_000 * Math.sin(index / 2 * 2 * Math.PI * 220 / 48_000))), 48_000, 2);
    const narration = wav(pcm(24_000, (index) => Math.round(2_000 * Math.sin(index * 2 * Math.PI * 440 / 24_000))));
    const narrationPath = join(root, "audio.wav");
    await writeFile(join(root, "music.wav"), source);
    await writeFile(narrationPath, narration);
    const music = await resolveMusic(root, config);
    const outputDir = join(root, "revision one");
    const built = await mixSoundtrack({ music, narrationPath, outputDir, totalSamples: 24_000 });
    assert.deepEqual(await readFile(narrationPath), narration);
    const mixedWave = await readFile(built.mixedPath);
    assert.equal(extractPcmDataFromWav(mixedWave).length, 48_000);
    assert.equal(built.report.trackEndedEarly, true);
    assert.equal(built.report.playedMusicSamples, 12_000);
    assert.deepEqual(built.report.checks, { musicClipping: true, mixedClipping: true, sampleCount: true, narrationUnchanged: true });
    assert.deepEqual(extractPcmDataFromWav(mixedWave).subarray(24_000), extractPcmDataFromWav(narration).subarray(24_000));
    await assert.rejects(mixSoundtrack({ music, narrationPath, outputDir, totalSamples: 24_000 }), /EEXIST/u);
    assert.deepEqual(await readFile(built.mixedPath), mixedWave);
    assert.deepEqual((await readdir(outputDir)).sort(), ["mixed.wav", "music.wav"]);
    const quieter = await resolveMusic(root, { ...config, gainDb: -30 });
    const revised = await mixSoundtrack({ music: quieter, narrationPath, outputDir: join(root, "revision two"), totalSamples: 24_000 });
    assert.notEqual(revised.report.outputs.music.sha256, built.report.outputs.music.sha256);
    assert.equal(revised.report.outputs.narration.sha256, built.report.outputs.narration.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("music changes after binding and narration timeline mismatch fail before writing outputs", { skip: !hasFfmpeg }, async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-soundtrack-change-"));
  try {
    await writeFile(join(root, "music.wav"), wav(pcm(100, 100)));
    const music = await resolveMusic(root, config);
    const narrationPath = join(root, "audio.wav");
    await writeFile(narrationPath, wav(pcm(200, 1_000)));
    await assert.rejects(mixSoundtrack({ music, narrationPath, outputDir: join(root, "output"), totalSamples: 199 }), /does not match/u);
    await writeFile(join(root, "music.wav"), wav(pcm(100, 200)));
    await assert.rejects(mixSoundtrack({ music, narrationPath, outputDir: join(root, "output"), totalSamples: 200 }), /changed after/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("decoder bounds a long track to narration plus one detection sample", { skip: !hasFfmpeg }, async () => {
  const root = await mkdtemp(join(tmpdir(), "etm-soundtrack-decode-bound-"));
  try {
    await writeFile(join(root, "music.wav"), wav(pcm(24_000, 1_000)));
    const music = await resolveMusic(root, config);
    const narrationPath = join(root, "audio.wav");
    await writeFile(narrationPath, wav(pcm(2_400, 1_000)));
    const result = await mixSoundtrack({ music, narrationPath, outputDir: join(root, "output"), totalSamples: 2_400 });
    assert.equal(result.report.decodedMusicSamples, 2_401);
    assert.equal(result.report.playedMusicSamples, 2_400);
    assert.equal(result.report.trackEndedEarly, false);
    const mixed = extractPcmDataFromWav(await readFile(result.mixedPath));
    assert.equal(mixed.length, 4_800);
    assert.equal(mixed.readInt16LE(4_798), 1_000, "music fades exactly at narration end");
  } finally { await rm(root, { recursive: true, force: true }); }
});
