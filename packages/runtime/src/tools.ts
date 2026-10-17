import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve, win32 } from "node:path";

interface ExecutableOptions {
  platform?: NodeJS.Platform;
  path?: string;
  pathExt?: string;
  check?: (candidate: string) => boolean;
}

export function findExecutable(name: string, options: ExecutableOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const paths = options.path ?? process.env.PATH ?? "";
  const pathApi = platform === "win32" ? win32 : { join };
  const extensions = platform === "win32" && !win32.extname(name)
    ? (options.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE").split(";").filter((ext) => /^\.(exe|com)$/iu.test(ext))
    : [""];
  const check = options.check ?? ((candidate: string): boolean => {
    try {
      if (!statSync(candidate).isFile()) return false;
      accessSync(candidate, constants.X_OK);
      return true;
    } catch { return false; }
  });
  if (name === "say") return platform === "darwin" && check("/usr/bin/say") ? "/usr/bin/say" : null;
  for (const entry of paths.split(platform === "win32" ? ";" : ":")) {
    const directory = entry.replace(/^"(.*)"$/u, "$1");
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, name + extension.toLowerCase());
      if (check(candidate)) return candidate;
    }
  }
  return null;
}

/** Reuse the already pinned renderer distribution; no second FFmpeg install. */
export function bundledWindowsMediaDirectory(): string | null {
  if (process.platform !== "win32" || process.arch !== "x64") return null;
  try {
    const require = createRequire(import.meta.url);
    const rendererRequire = createRequire(require.resolve("@remotion/renderer/package.json"));
    const directory = dirname(rendererRequire.resolve("@remotion/compositor-win32-x64-msvc/package.json"));
    for (const tool of ["ffmpeg.exe", "ffprobe.exe"]) if (!statSync(join(directory, tool)).isFile()) return null;
    return directory;
  } catch { return null; }
}

export function configureMediaTools(): void {
  const directory = bundledWindowsMediaDirectory();
  if (!directory) return;
  const current = process.env.PATH ?? "";
  // Windows can inherit both Path and PATH; avoid ambiguous child-process lookup.
  for (const key of Object.keys(process.env)) if (/^path$/iu.test(key)) delete process.env[key];
  process.env.PATH = [resolve(directory), ...current.split(delimiter).filter((entry) => entry && resolve(entry) !== resolve(directory))].join(delimiter);
}
