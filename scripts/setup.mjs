#!/usr/bin/env node
// Windows bootstrap uses only Node and OS tools until project dependencies exist.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tools = join(root, ".explain-to-me", "runtime");
const pnpmVersion = "10.18.3";
const uvVersion = "0.12.20";

function environment(extra = {}) {
  const env = { ...process.env, ...extra };
  const path = env.PATH ?? env.Path ?? "";
  for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];
  env.PATH = [dirname(process.execPath), join(tools, "uv"), path].join(";");
  env.UV_CACHE_DIR = join(root, ".cache", "uv");
  env.UV_PYTHON_INSTALL_DIR = join(tools, "python");
  env.UV_PYTHON_PREFERENCE = "only-managed";
  env.UV_NO_MODIFY_PATH = "1";
  return env;
}

function run(command, args, extraEnv = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment(extraEnv), stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? accept() : reject(new Error(`${command} exited ${code ?? signal}`)));
  });
}

function onPath(name) {
  for (const entry of (process.env.PATH ?? "").split(";")) {
    const path = join(entry.replace(/^"(.*)"$/, "$1"), name);
    try { if (entry && statSync(path).isFile()) return path; } catch { /* Continue. */ }
  }
  return undefined;
}

async function ensurePnpm() {
  const prefix = join(root, ".cache", "setup");
  const launcher = join(prefix, "node_modules", "pnpm", "bin", "pnpm.cjs");
  let installedVersion;
  try { installedVersion = JSON.parse(await readFile(join(prefix, "node_modules", "pnpm", "package.json"), "utf8")).version; } catch { /* First install. */ }
  if (installedVersion !== pnpmVersion || !existsSync(launcher)) {
    const npmDir = onPath("npm.cmd");
    const candidates = [
      join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      npmDir && join(dirname(npmDir), "node_modules", "npm", "bin", "npm-cli.js"),
    ].filter(Boolean);
    const npm = candidates.find((path) => existsSync(path));
    if (!npm) throw new Error("npm is missing. Install Node.js 24 LTS with npm, then rerun node scripts/setup.mjs.");
    await run(process.execPath, [npm, "install", "--prefix", prefix, "--no-package-lock", "--ignore-scripts", "--no-audit", "--no-fund", `pnpm@${pnpmVersion}`]);
  }
  return launcher;
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureUv() {
  // Use our pinned local uv even when an older global installation exists.
  const directory = join(tools, "uv");
  const executable = join(directory, "uv.exe");
  const marker = join(directory, "version.txt");
  if (existsSync(executable) && existsSync(marker) && (await readFile(marker, "utf8")).trim() === uvVersion) return executable;
  await mkdir(directory, { recursive: true });
  const url = `https://github.com/astral-sh/uv/releases/download/${uvVersion}/uv-x86_64-pc-windows-msvc.zip`;
  const checksum = (await download(`${url}.sha256`)).toString("utf8").trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(checksum ?? "")) throw new Error("uv release returned an invalid checksum");
  const archive = await download(url);
  if (createHash("sha256").update(archive).digest("hex") !== checksum.toLowerCase()) throw new Error("uv download checksum mismatch");
  const zip = join(directory, "uv.zip");
  await writeFile(zip, archive);
  const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const staging = await mkdtemp(join(directory, "unpack-"));
  try {
    // Use .NET directly so a harness's PSModulePath cannot break extraction.
    await run(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; [void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem'); [IO.Compression.ZipFile]::ExtractToDirectory($env:ETM_ARCHIVE, $env:ETM_UV_STAGE)"], { ETM_ARCHIVE: zip, ETM_UV_STAGE: staging });
    await rename(join(staging, "uv.exe"), executable);
  } finally { await rm(staging, { recursive: true, force: true }); }
  if (!existsSync(executable)) throw new Error("uv archive did not contain uv.exe");
  await writeFile(`${marker}.tmp`, `${uvVersion}\n`);
  await rename(`${marker}.tmp`, marker);
  return executable;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: node scripts/setup.mjs\nPrepares Windows x64 dependencies, local Python/Kokoro, render browser, and browser launcher.\nSetup downloads assets into this checkout; no global pnpm/Python/FFmpeg install is needed.\nNormal setup runs as an ordinary user; missing Windows runtime components may require repair.");
    return;
  }
  if (process.argv.length > 2) throw new Error("Usage: node scripts/setup.mjs");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Install Node.js 24 LTS (including npm), then rerun node scripts/setup.mjs.");
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("This setup command supports Windows x64. See README.md for macOS setup.");
  console.log("[1/5] Installing the pinned JavaScript dependencies...");
  const pnpm = await ensurePnpm();
  await run(process.execPath, [pnpm, "install", "--frozen-lockfile", "--store-dir", join(root, ".cache", "pnpm-store")]);
  console.log("[2/5] Preparing the render browser...");
  // Run in a new process: dependency resolution is fresh after pnpm install.
  await run(process.execPath, ["--input-type=module", "-e", 'import {ensureBrowser} from "@remotion/renderer"; await ensureBrowser({chromeMode:"headless-shell"});']);
  console.log("[3/5] Preparing the Windows browser launcher...");
  await run(process.execPath, ["--import", "tsx", "scripts/setup-renderer.ts"]);
  console.log("[4/5] Preparing local Python and Kokoro (the first run downloads models)...");
  const uv = await ensureUv();
  await run(uv, ["run", "--no-project", "--python", "3.11", "scripts/setup-kokoro.py"], { EXPLAIN_TO_ME_UV: uv });
  console.log("[5/5] Checking the complete installation...");
  await run(process.execPath, ["scripts/explain.mjs", "doctor"]);
  console.log("Ready. Build your first movie:\nnode scripts/explain.mjs build --manifest fixtures/golden-manifests/whisper-vs-tts.json --output out/first-movie");
}

main().catch((error) => { console.error(`Setup failed: ${error.message}\nFix the reported prerequisite and rerun node scripts/setup.mjs; completed downloads are reused.`); process.exitCode = 1; });
