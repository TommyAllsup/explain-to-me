import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { dirname, join, relative, resolve, win32 } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const privateDirectories = new Map<string, Promise<{ dev: number; ino: number }>>();

/** Reject ambiguous Win32 aliases, device paths, and alternate data streams. */
export function assertSupportedFilePath(path: string, platform: NodeJS.Platform = process.platform): void {
  if (path.includes("\0")) throw new Error("File paths cannot contain NUL bytes");
  if (platform !== "win32") return;
  if (/^[\\/]{2}/u.test(path)) throw new Error("UNC and device paths are not supported; use a local drive path");
  const drive = /^[a-z]:/iu.exec(path);
  const tail = drive ? path.slice(2) : path;
  if (drive && !/^[\\/]/u.test(tail)) throw new Error("Drive-relative file paths are not supported");
  for (const part of tail.split(/[\\/]/u)) {
    if (part === "." || part === ".." || part === "") continue;
    if (/[<>:"|?*]/u.test(part) || /[. ]$/u.test(part)
      || /^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)) {
      throw new Error("Unsupported Windows file path (device name, alias, or alternate data stream)");
    }
  }
  // Keep the Windows parser in the validation path even when tested on Unix.
  if (drive && !win32.isAbsolute(path)) throw new Error("An absolute local drive path is required");
}

async function windowsCheck(path: string, script: string): Promise<void> {
  const windowsRoot = process.env.SystemRoot;
  if (!windowsRoot) throw new Error("SystemRoot is required for Windows file protection");
  await runFile(join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; " + script], {
      windowsHide: true, timeout: 15_000, maxBuffer: 16 * 1024,
      env: { ...process.env, ETM_CHECKED_PATH: path },
    });
}

/** Best-effort path checks, not an atomic Windows no-follow open or a sandbox. */
export async function assertNoLinkedPath(path: string, checkWindowsAttributes = true): Promise<void> {
  assertSupportedFilePath(path);
  const absolute = resolve(path);
  let current = absolute;
  while (true) {
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error("Linked/reparse-point paths are not permitted");
    if (process.platform !== "win32") break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (process.platform === "win32" && relative(absolute, await realpath(absolute)) !== "") {
    throw new Error("Linked/reparse-point paths are not permitted");
  }
  if (process.platform === "win32" && checkWindowsAttributes) {
    await windowsCheck(absolute, "for($p=$env:ETM_CHECKED_PATH; $p; $p=[IO.Path]::GetDirectoryName($p)) { if(([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse-point paths are not permitted' } }");
  }
}

export async function openRegularFile(path: string, privateDirectory?: string): Promise<FileHandle> {
  if (privateDirectory !== undefined) {
    if (resolve(dirname(path)) !== resolve(privateDirectory)) throw new Error("Private file must be directly inside its protected directory");
    await assertNoLinkedPath(privateDirectory, false);
    const leaf = await lstat(path);
    if (leaf.isSymbolicLink() || !leaf.isFile()) {
      throw Object.assign(new Error("Cache entry must be an unlinked regular file"), { code: "EUNSAFEFILE" });
    }
    await ensurePrivateDirectory(privateDirectory);
  }
  // Protected cache roots are checked and ACLed once. Their flat entries still
  // receive lstat/canonical/handle checks without spawning a shell per chunk.
  await assertNoLinkedPath(path, privateDirectory === undefined);
  const before = await lstat(path);
  if (!before.isFile()) throw new Error("File must be a regular file");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = await handle.stat();
    await assertNoLinkedPath(path, privateDirectory === undefined);
    const after = await lstat(path);
    if (!actual.isFile() || actual.dev !== before.dev || actual.ino !== before.ino
      || actual.dev !== after.dev || actual.ino !== after.ino
      || before.size !== actual.size || before.mtimeMs !== actual.mtimeMs) {
      throw new Error("File changed while opening");
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** Establish privacy before writing sensitive bytes. Call only for owned data dirs. */
export async function ensurePrivateDirectory(path: string): Promise<void> {
  assertSupportedFilePath(path);
  const absolute = resolve(path);
  const pending = privateDirectories.get(absolute);
  if (pending) {
    const previous = await pending;
    try {
      await assertNoLinkedPath(absolute, false);
      const current = await lstat(absolute);
      if (previous.dev === current.dev && previous.ino === current.ino) return;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    privateDirectories.delete(absolute);
  }
  const create = (async () => {
    // Check every existing ancestor before recursive creation.
    let existing = absolute;
    while (true) {
      try { await assertNoLinkedPath(existing); break; }
      catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        const parent = dirname(existing);
        if (parent === existing) throw error;
        existing = parent;
      }
    }
    await mkdir(absolute, { recursive: true, mode: 0o700 });
    await assertNoLinkedPath(absolute);
    if (process.platform === "win32") {
      await windowsCheck(absolute, "foreach($entry in [IO.Directory]::EnumerateFileSystemEntries($env:ETM_CHECKED_PATH)) { if(([IO.File]::GetAttributes($entry) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not permitted in a private data directory' } }; $acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true,$false); $user=[Security.Principal.WindowsIdentity]::GetCurrent().User; foreach($sid in @($user, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) { $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'); $acl.AddAccessRule($rule) }; [IO.Directory]::SetAccessControl($env:ETM_CHECKED_PATH,$acl)");
    }
    const identity = await lstat(absolute);
    return { dev: identity.dev, ino: identity.ino };
  })();
  privateDirectories.set(absolute, create);
  try { await create; }
  catch (error) { privateDirectories.delete(absolute); throw error; }
}
