import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ContentAddressedCache } from "./cache.js";
import { assertSupportedFilePath, ensurePrivateDirectory, openRegularFile } from "./file-safety.js";

test("Windows ambiguous aliases, device paths, and alternate data streams are rejected", () => {
  for (const path of ["C:relative.md", "C:\\notes.md:secret", "C:\\NUL.txt", "C:\\CONIN$.txt", "C:\\notes.\\file.md", "\\\\server\\share\\file.md", "\\\\?\\C:\\file.md"]) {
    assert.throws(() => assertSupportedFilePath(path, "win32"), /unsupported|not supported|Unsupported/u, path);
  }
  assert.doesNotThrow(() => assertSupportedFilePath("C:\\Local notes\\résumé.md", "win32"));
  assert.doesNotThrow(() => assertSupportedFilePath("notes/pixel.png", "win32"));
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
