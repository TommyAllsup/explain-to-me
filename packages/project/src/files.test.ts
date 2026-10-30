import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadProject, resolveProjectFile, resolveProjectOutput } from "./files.js";

async function scratch(): Promise<string> {
  const parent = join(process.cwd(), ".cache", "tests");
  await mkdir(parent, { recursive: true });
  return realpath(await mkdtemp(join(parent, "project-")));
}

test("loadProject binds portable paths to the saved file and hashes its exact bytes", async () => {
  const root = await scratch();
  try {
    const projectPath = join(root, "project.json");
    const text = JSON.stringify({ version: "1", title: "Rain gauge", input: { source: "Local notes/résumé.md" } }, null, 2);
    await writeFile(projectPath, text);
    await mkdir(join(root, "Local notes"));
    await writeFile(join(root, "Local notes", "résumé.md"), "Read the scale after rain.");
    const loaded = await loadProject(projectPath);
    assert.equal(loaded.root, root);
    assert.equal(loaded.path, projectPath);
    assert.equal(loaded.sha256, createHash("sha256").update(text).digest("hex"));
    assert.equal(loaded.config.output.durationPolicy, "paced");
    const source = await resolveProjectFile(loaded.root, loaded.config.input.source!, 256 * 1024);
    assert.equal(source.bytes.toString("utf8"), "Read the scale after rain.");
    assert.equal(source.sha256, createHash("sha256").update(source.bytes).digest("hex"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("project and input readers bound bytes, reject directories, and diagnose invalid JSON/schema", async () => {
  const root = await scratch();
  try {
    const path = join(root, "project.json");
    await writeFile(path, "not JSON");
    await assert.rejects(loadProject(path), /valid JSON/u);
    await writeFile(path, JSON.stringify({ version: "9", title: "Test", input: { source: "source.md" } }));
    await assert.rejects(loadProject(path), /Invalid project:[\s\S]*version/u);
    await writeFile(path, " ".repeat(64 * 1024 + 1));
    await assert.rejects(loadProject(path), /byte limit/u);
    await writeFile(join(root, "source.md"), "12345");
    await assert.rejects(resolveProjectFile(root, "source.md", 4), /byte limit/u);
    assert.equal((await resolveProjectFile(root, "source.md", 5)).bytes.length, 5);
    await assert.rejects(resolveProjectFile(root, "source.md", 0), /positive safe integer/u);
    await mkdir(join(root, "folder.md"));
    await assert.rejects(resolveProjectFile(root, "folder.md", 10), /regular file/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("project references refuse lexical traversal and canonical escapes through directory links", async () => {
  const root = await scratch();
  try {
    const projectRoot = join(root, "saved");
    const outside = join(root, "outside");
    await mkdir(projectRoot);
    await mkdir(outside);
    await writeFile(join(outside, "source.md"), "outside the project");
    await symlink(outside, join(projectRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(resolveProjectFile(projectRoot, "../outside/source.md", 100), /project-relative/u);
    await assert.rejects(resolveProjectFile(projectRoot, "linked/source.md", 100), /within|[Ll]inked|[Rr]eparse/u);
    await assert.rejects(resolveProjectOutput(projectRoot, "linked/new/output"), /within|[Ll]inked|[Rr]eparse|regular directory/u);
    assert.equal(await readFile(join(outside, "source.md"), "utf8"), "outside the project");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("project file references reject leaf symlinks", { skip: process.platform === "win32" }, async () => {
  const root = await scratch();
  try {
    await writeFile(join(root, "source.md"), "local source");
    await symlink(join(root, "source.md"), join(root, "alias.md"));
    await assert.rejects(resolveProjectFile(root, "alias.md", 100), /[Ll]inked/u);
    await assert.rejects(loadProject(join(root, "alias.md")), /[Ll]inked/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("output resolution validates existing ancestors without creating or replacing anything", async () => {
  const root = await scratch();
  try {
    assert.equal(await resolveProjectOutput(root, "new/revision-1"), join(root, "new", "revision-1"));
    await assert.rejects(readFile(join(root, "new")), { code: "ENOENT" });
    await writeFile(join(root, "occupied"), "preserve me");
    await assert.rejects(resolveProjectOutput(root, "occupied/new"), /ENOTDIR|directory/u);
    assert.equal(await readFile(join(root, "occupied"), "utf8"), "preserve me");
    await assert.rejects(resolveProjectOutput(root, "../escape"), /project-relative/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
