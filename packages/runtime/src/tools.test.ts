import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { bundledWindowsMediaDirectory, findExecutable } from "./tools.js";

test("Windows executable lookup handles drives, quoted spaces and executable extensions", () => {
  const seen: string[] = [];
  const found = findExecutable("ffmpeg", {
    platform: "win32", path: 'C:\\missing;"D:\\Movie tools"', pathExt: ".CMD;.EXE;.BAT",
    check: (candidate) => { seen.push(candidate); return candidate === "D:\\Movie tools\\ffmpeg.exe"; },
  });
  assert.equal(found, "D:\\Movie tools\\ffmpeg.exe");
  assert.deepEqual(seen, ["C:\\missing\\ffmpeg.exe", "D:\\Movie tools\\ffmpeg.exe"]);
});

test("executable lookup ignores directories and empty PATH entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-"));
  try {
    const first = join(root, "first");
    const second = join(root, "second");
    const filename = process.platform === "win32" ? "tool.exe" : "tool";
    await mkdir(join(first, filename), { recursive: true });
    await mkdir(second);
    await writeFile(join(second, filename), "fixture");
    await chmod(join(second, filename), 0o700);
    assert.equal(findExecutable("tool", { path: ["", first, second].join(delimiter) }), join(second, filename));
    assert.equal(findExecutable("tool", { path: "" }), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows media tools come from the installed pinned renderer", { skip: process.platform !== "win32" }, () => {
  assert.ok(bundledWindowsMediaDirectory()?.includes("compositor-win32-x64-msvc"));
});
