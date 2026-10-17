import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { prepareWindowsBrowserLauncher, writeWindowsBrowserLauncher } from "./windows-browser-launcher.js";

async function withLauncher(run: (directory: string, executable: string) => Promise<void>): Promise<void> {
  await prepareWindowsBrowserLauncher();
  const root = join(process.cwd(), ".cache", "tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "launcher spaces é-"));
  try {
    const executable = await writeWindowsBrowserLauncher(directory, process.execPath, "http://127.0.0.1:31234");
    await run(directory, executable);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("Windows browser launcher preserves arguments, standard I/O and exit status", { skip: process.platform !== "win32" }, async () => {
  await withLauncher(async (directory, executable) => {
    const script = join(directory, "echo arguments.cjs");
    await writeFile(script, "process.stdout.write(JSON.stringify(process.argv.slice(2))); process.stderr.write('launcher stderr'); process.exitCode = 7;\n");
    const inputArgs = ["", "hello world", 'embedded \" quote', "trailing \\", "雪", "https://example.invalid/?a=1&b=2"];
    const result = spawnSync(executable, [script, ...inputArgs, "--no-proxy-server", "--proxy-server='direct://'", "--proxy-bypass-list=*"], {
      encoding: "utf8", timeout: 15_000, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [...inputArgs, "--proxy-server=http://127.0.0.1:31234", "--proxy-bypass-list=<-loopback>"]);
    assert.equal(result.stderr, "launcher stderr");
  });
});

test("Windows browser launcher kills its child tree when forcibly terminated", { skip: process.platform !== "win32" }, async () => {
  await withLauncher(async (directory, executable) => {
    const pidPath = join(directory, "descendant.pid");
    const script = join(directory, "child tree.cjs");
    await writeFile(script, [
      "const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');",
      `const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); writeFileSync(${JSON.stringify(pidPath)},String(child.pid));`,
      "process.stdout.write('ready'); setInterval(()=>{},1000);",
    ].join("\n"));
    const launcher = spawn(executable, [script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => launcher.kill(), 10_000);
    let descendant: number | undefined;
    try {
      await once(launcher.stdout!, "data");
      descendant = Number(await readFile(pidPath, "utf8"));
      assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
      const closed = once(launcher, "close");
      launcher.kill();
      await closed;
      let alive = true;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try { process.kill(descendant, 0); }
        catch { alive = false; break; }
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      assert.equal(alive, false, "The browser descendant must exit with its owning launcher.");
    } finally {
      clearTimeout(timer);
      launcher.kill();
      if (descendant) { try { process.kill(descendant); } catch { /* Already closed by the job. */ } }
    }
  });
});
