import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cliPath = resolve(projectRoot, "apps/cli/src/index.ts");
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as { version: string };

function runCli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
}

test("--version prints the package version", () => {
  const result = runCli("--version");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `explain-to-me ${packageJson.version}\n`);
  assert.equal(result.stderr, "");
});

test("--version refuses additional arguments", () => {
  const result = runCli("--version", "unexpected");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--version does not accept additional arguments/u);
});

test("--help lists version and existing commands", () => {
  const result = runCli("--help");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /explain-to-me — local document-to-video explainer/u);
  assert.match(result.stdout, /--version/u);
  assert.match(result.stdout, /doctor/u);
});

test("doctor gives platform-specific recovery guidance with an empty PATH", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", cliPath, "doctor"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PATH: "" },
  });
  assert.equal(result.error, undefined);
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  assert.match(result.stdout, /(?:OK|MISSING) {2}ffmpeg/u);
  assert.match(result.stdout, /Setup guidance/u);
  if (process.platform === "win32") {
    assert.match(result.stdout, /node scripts\/setup\.mjs/u);
    assert.doesNotMatch(result.stdout, /Kokoro \(optional\)/u);
  } else {
    assert.equal(result.status, 1);
    assert.match(result.stdout, /brew install ffmpeg/u);
    assert.match(result.stdout, /optional.*setup-kokoro\.py/iu);
  }
});

test("Windows rejects Apple speech before invoking platform tools", { skip: process.platform !== "win32" }, () => {
  const result = runCli("build", "--manifest", "fixtures/golden-manifests/whisper-vs-tts.json", "--tts", "apple");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Apple.*macOS/u);
});
