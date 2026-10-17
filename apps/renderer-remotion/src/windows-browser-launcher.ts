import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_PATH = join(PROJECT_ROOT, "apps/renderer-remotion/src/windows-browser-launcher.cs");

function launcherDirectory(): string {
  const sourceHash = createHash("sha256").update(readFileSync(SOURCE_PATH)).digest("hex");
  return join(PROJECT_ROOT, ".cache", "windows-browser-launcher", sourceHash);
}

function preparedLauncher(): string | undefined {
  const directory = launcherDirectory();
  const executable = join(directory, "renderer-chrome.exe");
  try {
    if (!statSync(executable).isFile()) return undefined;
    const expected = readFileSync(join(directory, "sha256"), "utf8").trim();
    const actual = createHash("sha256").update(readFileSync(executable)).digest("hex");
    return /^[a-f0-9]{64}$/.test(expected) && expected === actual ? executable : undefined;
  } catch {
    return undefined;
  }
}

export function getLauncherReadiness(): { ready: boolean; reason: string } {
  if (process.platform !== "win32") return { ready: true, reason: "The renderer uses the installed Node.js browser launcher." };
  return preparedLauncher()
    ? { ready: true, reason: "The Windows browser launcher is compiled and verified." }
    : { ready: false, reason: "The Windows browser launcher needs setup. Run node scripts/setup.mjs." };
}

/** Compile once with the C# compiler supplied by Windows' .NET Framework. */
export async function prepareWindowsBrowserLauncher(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const existing = preparedLauncher();
  if (existing) return existing;
  const windowsDirectory = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  const compiler = ["Framework64", "Framework"]
    .map((framework) => join(windowsDirectory, "Microsoft.NET", framework, "v4.0.30319", "csc.exe"))
    .find((candidate) => existsSync(candidate));
  if (!compiler) throw new Error("Windows renderer setup needs the C# compiler included with .NET Framework 4.x. Enable .NET Framework in Windows, then run setup again.");

  const directory = launcherDirectory();
  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp(join(directory, "compile-"));
  try {
    const executable = join(staging, "renderer-chrome.exe");
    execFileSync(compiler, ["/nologo", "/optimize+", "/target:exe", `/out:${executable}`, SOURCE_PATH], {
      encoding: "utf8", timeout: 60_000, windowsHide: true,
    });
    const digest = createHash("sha256").update(await readFile(executable)).digest("hex");
    await writeFile(join(staging, "sha256"), `${digest}\n`, { flag: "wx" });
    await rename(executable, join(directory, "renderer-chrome.exe"));
    await rename(join(staging, "sha256"), join(directory, "sha256"));
    return join(directory, "renderer-chrome.exe");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Each render has its own configuration; no process-wide environment changes. */
export async function writeWindowsBrowserLauncher(directory: string, browserPath: string, proxyOrigin: string): Promise<string> {
  const prepared = preparedLauncher();
  if (!prepared) throw new Error(getLauncherReadiness().reason);
  const executable = join(directory, "renderer-chrome.exe");
  await copyFile(prepared, executable);
  await writeFile(join(directory, "renderer-chrome.config"), `${browserPath}\n${proxyOrigin}\n`, { flag: "wx" });
  return executable;
}
