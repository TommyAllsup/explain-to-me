import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { assertNoLinkedPath, assertSupportedFilePath, openRegularFile } from "../../assets/src/file-safety.js";
import { formatProjectIssues, isProjectRelativePath, MAX_PROJECT_BYTES, projectSchema, type ProjectConfig } from "../../contracts/src/project.js";

export interface ProjectFile {
  path: string;
  bytes: Buffer;
  sha256: string;
}

export interface LoadedProject {
  config: ProjectConfig;
  path: string;
  root: string;
  sha256: string;
}

export async function loadProject(path: string): Promise<LoadedProject> {
  assertSupportedFilePath(path);
  await assertNoLinkedPath(path);
  const canonical = await realpath(resolve(path));
  const file = await readProjectFile(canonical, MAX_PROJECT_BYTES);
  let input: unknown;
  try { input = JSON.parse(file.bytes.toString("utf8")); }
  catch { throw new Error("Project must contain valid JSON"); }
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid project:\n${formatProjectIssues(parsed.error).join("\n")}`);
  return { config: parsed.data, path: canonical, root: dirname(canonical), sha256: file.sha256 };
}

/** Resolve once, then read the bounded canonical regular file used for hashing. */
export async function resolveProjectFile(root: string, relativePath: string, maxBytes: number): Promise<ProjectFile> {
  assertProjectRelativePath(relativePath);
  const canonicalRoot = await canonicalProjectRoot(root);
  const candidate = resolve(canonicalRoot, relativePath);
  await assertNoLinkedPath(candidate);
  const canonical = await realpath(candidate);
  assertWithinProject(canonicalRoot, canonical);
  return readProjectFile(canonical, maxBytes);
}

/** Check the nearest existing ancestor without creating or replacing outputs. */
export async function resolveProjectOutput(root: string, relativePath: string): Promise<string> {
  assertProjectRelativePath(relativePath);
  const canonicalRoot = await canonicalProjectRoot(root);
  const candidate = resolve(canonicalRoot, relativePath);
  let existing = candidate;
  while (true) {
    try {
      const entry = await lstat(existing);
      if (!entry.isDirectory()) throw new Error("Project output ancestor must be a regular directory");
      await assertNoLinkedPath(existing);
      assertWithinProject(canonicalRoot, await realpath(existing));
      break;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      existing = dirname(existing);
    }
  }
  return candidate;
}

export function assertProjectRelativePath(value: string): void {
  if (!isProjectRelativePath(value)) throw new Error("Use a project-relative local path with forward slashes, without traversal or Windows device/alias names");
}

async function canonicalProjectRoot(root: string): Promise<string> {
  await assertNoLinkedPath(root);
  if (!(await lstat(root)).isDirectory()) throw new Error("Project root must be a directory");
  return realpath(root);
}

function assertWithinProject(root: string, candidate: string): void {
  const suffix = relative(root, candidate);
  if (suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new Error("Project file must remain within the saved project's directory");
  }
}

async function readProjectFile(path: string, maxBytes: number): Promise<ProjectFile> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Project file byte limit must be a positive safe integer");
  const handle = await openRegularFile(path);
  try {
    const before = await handle.stat();
    if (before.size > maxBytes) throw new Error(`Project file exceeds the ${maxBytes}-byte limit`);
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > maxBytes) throw new Error(`Project file exceeds the ${maxBytes}-byte limit`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (before.size !== size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error("Project file changed while reading");
    }
    const bytes = Buffer.concat(chunks, size);
    return { path, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally {
    await handle.close();
  }
}
