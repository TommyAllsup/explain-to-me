#!/usr/bin/env node
// Representative native-media acceptance. Requires installed local narration/browser/media tools.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createExampleProject } from "./create-example-project.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const values = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!["--output", "--tts"].includes(args[i]) || !args[i + 1] || values.has(args[i])) throw new Error("Usage: node scripts/verify-project.mjs --tts apple|kokoro --output <new-directory>");
  values.set(args[i], args[i + 1]);
}
if (!values.has("--output") || !["apple", "kokoro"].includes(values.get("--tts"))) throw new Error("Specify --output and --tts apple|kokoro");
const output = resolve(values.get("--output"));
await createExampleProject(output);
const projectPath = join(output, "project.json");
const config = JSON.parse(await readFile(projectPath, "utf8"));
config.narration.backend = values.get("--tts");
config.narration.voice = config.narration.backend === "apple" ? "Samantha" : "af_heart";
config.narration.pacing.passages = {};
const save = async () => writeFile(projectPath, JSON.stringify(config, null, 2) + "\n");
await save();
const commands = [];
function cli(label, args, expected = 0) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [join(root, "scripts/explain.mjs"), ...args], { cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  const entry = { label, args, status: result.status, elapsedMs: Math.round(performance.now() - started), stdout: result.stdout, stderr: result.stderr };
  commands.push(entry);
  process.stdout.write(`${label}: ${result.status} (${(entry.elapsedMs / 1000).toFixed(2)}s)\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  assert.equal(result.error, undefined);
  assert.equal(result.status, expected);
  return result;
}
const plan = join(output, "plan");
cli("plan", ["plan", "--project", projectPath, "--output", plan]);
assert.deepEqual((await readdir(plan)).sort(), ["manifest.json", "plan.json"]);
// Explicit, reviewable script revision before synthesis, without asserting human approval.
const scriptPath = join(plan, "manifest.json");
const script = JSON.parse(await readFile(scriptPath, "utf8"));
script.scenes[0].narration[0].text = script.scenes[0].narration[0].text.replace("quiet park", "small park");
await writeFile(scriptPath, JSON.stringify(script, null, 2) + "\n");
const base = ["--project", projectPath, "--plan", plan];
cli("preview normal", ["preview", ...base, "--passage", "measure-passage", "--output", join(output, "preview-normal")]);
cli("normal", ["build", ...base, "--output", join(output, "normal")]);
const report = async (name) => JSON.parse(await readFile(join(output, name, "report.json"), "utf8"));
const hash = async (name, file) => createHash("sha256").update(await readFile(join(output, name, file))).digest("hex");
const originalVideoHash = await hash("normal", "video.mp4");
config.narration.pacing.passages["measure-passage"] = 0.7;
await save();
cli("preview slower", ["preview", ...base, "--passage", "measure-passage", "--output", join(output, "preview-slower")]);
cli("slower", ["build", ...base, "--output", join(output, "slower")]);
const normal = await report("normal");
const slower = await report("slower");
assert.ok(slower.narration.measuredDurationMs > normal.narration.measuredDurationMs, "deliberately slower speech increases measured time");
assert.equal(slower.cache.render.hit, false, "timing change invalidates rendered frames");
assert.notEqual(slower.cache.render.key, normal.cache.render.key);
assert.notEqual(await hash("normal", "captions.vtt"), await hash("slower", "captions.vtt"));
const normalPreview = JSON.parse(await readFile(join(output, "preview-normal", "preview.json"), "utf8"));
const slowPreview = JSON.parse(await readFile(join(output, "preview-slower", "preview.json"), "utf8"));
for (const [preview, full] of [[normalPreview, normal], [slowPreview, slower]]) {
  for (const chunk of preview.narration.chunks) {
    const match = full.narration.chunks.find((candidate) => candidate.id === chunk.id);
    assert.equal(match.sampleCount, chunk.samples, "preview/full cached speech has same measured samples");
    assert.equal(match.pace, chunk.pace);
  }
}
assert.equal(slower.soundtrack.trackEndedEarly, true);
config.music.gainDb = -26;
await save();
cli("music only", ["build", ...base, "--output", join(output, "music-only")]);
const music = await report("music-only");
assert.equal(music.narration.synthesisWorkCount, 0);
assert.equal(music.cache.narration.misses, 0);
assert.equal(music.cache.render.hit, true);
assert.equal(music.cache.render.workCount, 0);
assert.equal(music.cache.render.key, slower.cache.render.key);
for (const file of ["audio.wav", "captions.vtt", "captions.srt", "manifest.json"]) assert.equal(await hash("slower", file), await hash("music-only", file));
assert.notEqual(await hash("slower", "mixed.wav"), await hash("music-only", "mixed.wav"));
config.output.durationPolicy = "strict";
config.output.desiredDurationMs = 10000;
await save();
const strict = cli("strict infeasible", ["build", ...base, "--output", join(output, "strict-infeasible")], 1);
assert.match(strict.stderr, /Strict project duration.*measured/);
const failureDir = (await readdir(output)).find((name) => name.startsWith(".strict-infeasible.staging-"));
const failure = JSON.parse(await readFile(join(output, failureDir, "failure.json"), "utf8"));
assert.equal(failure.stageTimingsMs.videoRender, undefined);
config.output.durationPolicy = "paced";
config.output.desiredDurationMs = 30000;
await save();
assert.equal(await hash("normal", "video.mp4"), originalVideoHash, "earlier output preserved");
const metrics = (r) => ({ durationMs: r.narration.measuredDurationMs, speechWork: r.narration.synthesisWorkCount, speechCache: r.cache.narration, frameRenderWork: r.cache.render.workCount, renderHit: r.cache.render.hit, renderKey: r.cache.render.key, qc: r.validation.gates, soundtrackChecks: r.soundtrack.checks });
await writeFile(join(output, "verification.json"), JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  backend: config.narration.backend, commands, normal: metrics(normal), slower: metrics(slower), musicOnly: metrics(music),
  checks: { previewMatchesFull: true, slowerMeasured: true, captionsUpdated: true, renderInvalidated: true, musicOnlyZeroSpeechAndFrames: true, earlyTrackEnd: true, strictPreservedPacing: true, priorOutputPreserved: true },
  review: { script: "automated fixture edit and inspection; human approval pending", watchListen: "pending", wholeProcessEgress: "unverified" },
}, null, 2) + "\n");
console.log(`Verification passed: ${join(output, "verification.json")}`);
