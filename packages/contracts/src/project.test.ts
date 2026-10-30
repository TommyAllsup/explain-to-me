import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isProjectRelativePath, projectJsonSchema, projectSchema } from "./project.js";

const minimal = { version: "1", title: "How a rain gauge works", input: { source: "notes/lesson.md" } };

test("minimal saved project expands stable defaults and keeps legacy duration fitting opt-in", () => {
  const parsed = projectSchema.parse(minimal);
  assert.deepEqual(parsed.narration, { backend: "auto", voice: "auto", pronunciations: {}, pacing: { default: 1, scenes: {}, passages: {} } });
  assert.deepEqual(parsed.output, { profile: "preview", directory: "outputs", desiredDurationMs: 60_000, durationPolicy: "paced" });
  assert.equal(parsed.direction.mode, "auto");
  assert.equal(parsed.music, undefined);
  assert.equal(projectSchema.parse({ ...minimal, input: { manifest: "script.json" }, output: { durationPolicy: "strict" } }).output.durationPolicy, "strict");
});

test("version and source binding are explicit, exclusive, and strict at every boundary", () => {
  for (const input of [
    { ...minimal, version: "2" },
    { ...minimal, input: {} },
    { ...minimal, input: { source: "lesson.md", manifest: "script.json" } },
    { ...minimal, input: { source: "lesson.pdf" } },
    { ...minimal, input: { manifest: "script.txt" } },
    { ...minimal, approved: true },
    { ...minimal, narration: { rate: 200 } },
    { ...minimal, music: { source: "music.wav", loop: true } },
    { ...minimal, music: { source: "music.wav", rights: { automaticallyCleared: true } } },
  ]) assert.equal(projectSchema.safeParse(input).success, false);
});

test("pacing accepts explicitly slower original passages and rejects out-of-bounds or malformed overrides", () => {
  const pacing = { default: 0.95, scenes: { explanation: 0.9 }, passages: { "slow-passage": 0.65 } };
  assert.deepEqual(projectSchema.parse({ ...minimal, narration: { pacing } }).narration.pacing, pacing);
  for (const invalid of [
    { default: 0.64 }, { default: 1.26 }, { default: Infinity },
    { scenes: { explanation: 0 } }, { passages: { "not an id": 0.8 } },
    { scenes: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`s-${index}`, 1])) },
    { passages: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`p-${index}`, 1])) },
  ]) assert.equal(projectSchema.safeParse({ ...minimal, narration: { pacing: invalid } }).success, false);
});

test("connected delivery is opt-in, bounded, and requires a capable narrator", () => {
  assert.equal(projectSchema.parse(minimal).narration.delivery, undefined);
  const narration = { backend: "kokoro", delivery: { mode: "connected", sentencePauseMs: 500 } };
  assert.deepEqual(projectSchema.parse({ ...minimal, narration }).narration.delivery,
    { mode: "connected", sentencePauseMs: 500, clausePauseMs: 100 });
  for (const delivery of [
    { mode: "unknown" }, { mode: "connected", sentencePauseMs: -1 },
    { mode: "connected", sentencePauseMs: 1_001 }, { mode: "connected", sentencePauseMs: .5 },
    { mode: "connected", clausePauseMs: 501 }, { mode: "connected", emphasis: "strong" },
  ]) assert.equal(projectSchema.safeParse({ ...minimal, narration: { ...narration, delivery } }).success, false);
  assert.equal(projectSchema.safeParse({ ...minimal, narration: { ...narration, backend: "apple" } }).success, false);
  assert.equal(projectSchema.safeParse({ ...minimal, narration: { ...narration, backend: "chatterbox" } }).success, false);
});

test("saved projects accept Claudia's selected Chatterbox voice without changing ordinary defaults", () => {
  for (const voice of ["auto", "chatterbox-bella"]) {
    const narration = { backend: "chatterbox", voice };
    assert.equal(projectSchema.parse({ ...minimal, narration }).narration.voice, voice);
  }
  assert.equal(projectSchema.parse({ ...minimal, narration: { backend: "chatterbox" } }).narration.voice, "auto");
  for (const voice of ["af_bella", "Samantha", "another-reference"]) {
    assert.equal(projectSchema.safeParse({ ...minimal, narration: { backend: "chatterbox", voice } }).success, false);
  }
  assert.equal(projectSchema.parse({ ...minimal, narration: { backend: "kokoro", voice: "af_bella" } }).narration.voice, "af_bella");
});

test("pronunciations share preparation's term, text, uniqueness, and aggregate limits", () => {
  assert.deepEqual(projectSchema.parse({ ...minimal, narration: { pronunciations: { API: "A P I" } } }).narration.pronunciations, { API: "A P I" });
  for (const pronunciations of [
    { API: "A P I", api: "ay pee eye" }, { API: " " }, { " ": "word" },
    { ["t".repeat(81)]: "word" }, { term: "s".repeat(161) },
    Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`term-${index}`, "word"])),
    Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`term-${index}`, "w".repeat(160)])),
  ]) assert.equal(projectSchema.safeParse({ ...minimal, narration: { pronunciations } }).success, false);
});

test("one soundtrack has bounded gain, attenuation, fades and user-supplied rights", () => {
  const music = projectSchema.parse({ ...minimal, music: { source: "assets/quiet.wav", rights: { holder: "Example musician", license: "Used with permission", note: "For this local demonstration" } } }).music!;
  assert.equal(music.gainDb, -24);
  assert.equal(music.duckingDb, -8);
  assert.equal(music.fadeInMs, 1_000);
  assert.equal(music.rights?.license, "Used with permission");
  for (const options of [{ gainDb: 1 }, { gainDb: -61 }, { duckingDb: -31 }, { duckingDb: 1 }, { fadeInMs: -1 }, { fadeOutMs: 10_001 }, { fadeOutMs: 0.1 }]) {
    assert.equal(projectSchema.safeParse({ ...minimal, music: { source: "music.wav", ...options } }).success, false);
  }
});

test("project-relative paths remain portable across macOS and Windows", () => {
  for (const path of ["notes/lesson.md", "Local notes/résumé.txt", "assets/音楽.wav"]) assert.equal(isProjectRelativePath(path), true, path);
  for (const path of ["", ".", "../lesson.md", "assets/../music.wav", "/tmp/lesson.md", "C:/lesson.md", "C:lesson.md", "assets\\music.wav", "https://example.org/music.wav", "//host/file", "assets//file", "assets/./file", "NUL.txt", "assets/COM¹.wav", "assets/music.wav:stream", "assets./music.wav", "assets /music.wav", "music.wav\0"] ) {
    assert.equal(isProjectRelativePath(path), false, path);
    assert.equal(projectSchema.safeParse({ ...minimal, music: { source: path } }).success, false, path);
    assert.equal(projectSchema.safeParse({ ...minimal, output: { directory: path } }).success, false, path);
  }
});

test("checked-in project JSON schema matches the executable contract", async () => {
  const path = fileURLToPath(new URL("../schema/project.schema.json", import.meta.url));
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), projectJsonSchema);
});
