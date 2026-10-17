import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ContentAddressedCache } from "./cache.js";
import { assertNoLinkedPath, assertSupportedFilePath, ensurePrivateDirectory, openRegularFile } from "./file-safety.js";

test("Windows ambiguous aliases, device paths, and alternate data streams are rejected", () => {
  for (const path of ["C:relative.md", "C:\\notes.md:secret", "C:\\NUL.txt", "C:\\CONIN$.txt", "C:\\notes.\\file.md", "\\\\server\\share\\file.md", "\\\\?\\C:\\file.md"]) {
    assert.throws(() => assertSupportedFilePath(path, "win32"), /unsupported|not supported|Unsupported/u, path);
  }
  assert.doesNotThrow(() => assertSupportedFilePath("C:\\Local notes\\résumé.md", "win32"));
  assert.doesNotThrow(() => assertSupportedFilePath("notes/pixel.png", "win32"));
});

test("Windows 8.3 directory spellings support private cache writes without allowing junctions", { skip: process.platform !== "win32" }, async (t) => {
  const scratch = join(process.cwd(), ".cache", "tests");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "ordinary long directory-"));
  try {
    const helperSource = join(root, "short-path.cs");
    const helper = join(root, "short-path.exe");
    await writeFile(helperSource, [
      "using System; using System.ComponentModel; using System.Runtime.InteropServices; using System.Text;",
      "class ShortPath { [DllImport(\"kernel32.dll\", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetShortPathName(string source, StringBuilder target, uint size);",
      "static void Main(string[] args) { var target=new StringBuilder(32768); if(GetShortPathName(args[0],target,(uint)target.Capacity)==0) throw new Win32Exception(); Console.OutputEncoding=new UTF8Encoding(false); Console.Write(target); } }",
    ].join("\n"));
    const compiler = join(process.env.SystemRoot!, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const run = promisify(execFile);
    await run(compiler, ["/nologo", "/target:exe", `/out:${helper}`, helperSource], { windowsHide: true, timeout: 60_000 });
    const { stdout } = await run(helper, [root], { windowsHide: true, timeout: 15_000, encoding: "utf8" });
    const shortRoot = stdout.trim();
    if (relative(shortRoot, await realpath(root)) === "") {
      t.skip("This volume has no 8.3 spelling for the fixture");
      return;
    }
    assert.match(shortRoot, /~\d/u);
    await assertNoLinkedPath(shortRoot, false);
    const cache = new ContentAddressedCache(join(shortRoot, "cache"));
    const key = cache.key("short-path", "ordinary directory");
    await cache.write(key, Buffer.from("verified value"));
    assert.deepEqual(await cache.read(key), Buffer.from("verified value"));
    const linked = join(shortRoot, "linked");
    await symlink(join(root, "cache"), linked, "junction");
    await assert.rejects(assertNoLinkedPath(linked, false), /[Ll]inked|[Rr]eparse/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe readers and cache roots reject junctions without symlink privilege", { skip: process.platform !== "win32" }, async () => {
  const scratch = join(process.cwd(), ".cache", "tests");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "junctions-"));
  try {
    const target = join(root, "target");
    await mkdir(target);
    await writeFile(join(target, "source.md"), "private text");
    const linked = join(root, "linked");
    await symlink(target, linked, "junction");
    await assert.rejects(openRegularFile(join(linked, "source.md")), /[Ll]inked|[Rr]eparse/u);
    const cache = new ContentAddressedCache(linked);
    await assert.rejects(cache.write(cache.key("test", 1), Buffer.from("value")), /[Ll]inked|[Rr]eparse/u);
    assert.deepEqual(await readFile(join(target, "source.md"), "utf8"), "private text");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owned Windows directories protect inheritance and retain ordinary-user access", { skip: process.platform !== "win32" }, async () => {
  const scratch = join(process.cwd(), ".cache", "tests");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "private-"));
  try {
    await ensurePrivateDirectory(root);
    await ensurePrivateDirectory(root);
    await writeFile(join(root, "owned.txt"), "owned data");
    const { stdout } = await promisify(execFile)(join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$acl=[IO.Directory]::GetAccessControl($env:ETM_CHECKED_PATH); $allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544'); if(!$acl.AreAccessRulesProtected) { throw 'ACL inheritance is not protected' }; foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { if($rule.IsInherited -or $rule.IdentityReference.Value -notin $allowed) { throw 'Unexpected ACL grant' } }; 'protected'"],
      { windowsHide: true, timeout: 15_000, env: { ...process.env, ETM_CHECKED_PATH: root } });
    assert.equal(stdout.trim(), "protected");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
