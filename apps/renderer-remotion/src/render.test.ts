import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { openBrowser } from "@remotion/renderer";
import type { ProductionManifest } from "../../../packages/contracts/src/production-manifest.js";
import { buildTimeline } from "../../../packages/timeline/src/timeline.js";
import { copyAssetsIntoPublicDirectory, getBrowserIdentity, renderVideo, startRestrictingProxy, type RenderRequest } from "./render.js";
import { prepareWindowsBrowserLauncher, writeWindowsBrowserLauncher } from "./windows-browser-launcher.js";

const runSmoke = process.platform === "win32" && process.env.EXPLAIN_TO_ME_RENDER_SMOKE === "1";

test("presenter-only assets are hash-verified and staged once for the renderer", async () => {
  const scratch = join(process.cwd(), ".cache", "tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "presenter-staging-"));
  try {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1kAAAAASUVORK5CYII=", "base64");
    const sourcePath = join(directory, "portrait.png");
    await writeFile(sourcePath, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const manifest: ProductionManifest = {
      version: "1", title: "Presenter", profile: "preview", targetDurationMs: 30_000, theme: "technical-whiteboard",
      assets: [{ id: "presenter", source: "portrait.png", sha256, mimeType: "image/png", provenance: { character: "Example", origin: "manual", credit: "Example artist", aiGenerated: false } }],
      scenes: ["title", "outro"].map((kind, index) => ({
        id: `scene-${index}`, kind: kind as "title" | "outro", title: "Local presenter", narration: [{ id: `chunk-${index}`, text: "A local image." }], visual: { presenter: { assetId: "presenter" } },
      })),
    };
    const request: RenderRequest = {
      manifest,
      timeline: buildTimeline(manifest, manifest.scenes.flatMap((scene) => scene.narration.map((chunk) => ({ id: chunk.id, samples: 24_000 })))),
      width: 1280, height: 720, fps: 24, outputPath: join(directory, "video.mp4"),
      assets: { presenter: { path: await realpath(sourcePath), sha256, mimeType: "image/png" } },
    };
    const mapping = await copyAssetsIntoPublicDirectory(request, directory);
    assert.deepEqual(mapping, { presenter: "asset-01.png" });
    assert.deepEqual(await readdir(join(directory, "public-assets")), ["asset-01.png"]);
    assert.deepEqual(await readFile(join(directory, "public-assets", mapping.presenter!)), bytes);

    const missing = { ...request, assets: {} };
    await assert.rejects(renderVideo(missing), /was not resolved to an approved local file/);
    const uncredited = structuredClone(request);
    delete uncredited.manifest.assets![0]!.provenance;
    await assert.rejects(renderVideo(uncredited), /requires an approved asset with valid provenance/);
    const unsupported = structuredClone(request);
    unsupported.manifest.scenes[0]!.kind = "code";
    await assert.rejects(renderVideo(unsupported), /presenter is supported only/);

    // Changing the input after approval cannot silently alter a presenter frame.
    await writeFile(sourcePath, Buffer.concat([bytes, Buffer.from("changed")]));
    const changedStage = join(directory, "changed");
    await mkdir(changedStage);
    await assert.rejects(copyAssetsIntoPublicDirectory(request, changedStage), /bytes do not match the approved SHA-256/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows Chromium uses the restricting proxy for external and loopback requests", { skip: !runSmoke, timeout: 60_000 }, async () => {
  const browser = getBrowserIdentity();
  assert.ok(browser, "Install the rendering browser during setup before running the smoke check.");
  await prepareWindowsBrowserLauncher();
  const scratch = join(process.cwd(), ".cache", "tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "proxy spaces é-"));
  const allowed = createServer((_request, response) => response.end("<!doctype html><title>allowed</title>"));
  allowed.listen(0, "127.0.0.1");
  await once(allowed, "listening");
  const address = allowed.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const proxy = await startRestrictingProxy(origin);
  let instance: Awaited<ReturnType<typeof openBrowser>> | undefined;
  try {
    const executable = await writeWindowsBrowserLauncher(directory, browser.path, proxy.origin);
    instance = await openBrowser("chrome", { browserExecutable: executable, chromeMode: browser.chromeMode as "headless-shell" | "chrome-for-testing", logLevel: "error" });
    const page = await instance.newPage({ context: () => null, logLevel: "error", indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => undefined });
    await page.goto({ url: origin, timeout: 10_000 });
    assert.equal(await page.evaluate(() => document.title), "allowed");
    const statuses = await page.evaluate(async () => Promise.all([
      fetch("http://example.invalid/blocked", { mode: "no-cors" }).then(() => "response", () => "rejected"),
      fetch("https://example.invalid/blocked", { mode: "no-cors" }).then(() => "response", () => "rejected"),
      fetch("http://127.0.0.1:63123/blocked", { mode: "no-cors" }).then(() => "response", () => "rejected"),
    ]));
    assert.equal(statuses.length, 3);
    assert.ok([...proxy.attempts].some((url) => url === "http://example.invalid/blocked"));
    assert.ok([...proxy.attempts].some((url) => url === "https://example.invalid:443"), "HTTPS CONNECT requests must also be blocked.");
    assert.ok([...proxy.attempts].some((url) => url === "http://127.0.0.1:63123/blocked"), "Chromium must not bypass the proxy for loopback requests.");
  } finally {
    await instance?.close({ silent: true });
    proxy.abortPendingRequests();
    proxy.server.closeAllConnections();
    allowed.closeAllConnections();
    await Promise.all([new Promise<void>((done) => proxy.server.close(() => done())), new Promise<void>((done) => allowed.close(() => done()))]);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Windows renders a local manifest with the proxy launcher", { skip: !runSmoke, timeout: 120_000 }, async () => {
  await prepareWindowsBrowserLauncher();
  const scratch = join(process.cwd(), ".cache", "tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "render spaces é-"));
  const startingDirectory = process.cwd();
  const originalTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  const jobTemp = join(directory, "private job temp");
  await mkdir(jobTemp);
  const createdScratch: string[] = [];
  const watcher = watch(jobTemp, (_event, filename) => { if (filename) createdScratch.push(filename.toString()); });
  try {
    const original = JSON.parse(await readFile(join(process.cwd(), "fixtures/golden-manifests/whisper-vs-tts.json"), "utf8")) as ProductionManifest;
    const manifest: ProductionManifest = { ...original, scenes: original.scenes.slice(0, 1) };
    const timeline = buildTimeline(manifest, manifest.scenes.flatMap((scene) => scene.narration.map((chunk) => ({ id: chunk.id, samples: 24_000 }))));
    // The public launcher keeps the caller's private workspace as its cwd.
    process.chdir(directory);
    process.env.TEMP = process.env.TMP = process.env.TMPDIR = jobTemp;
    const result = await renderVideo({ manifest, timeline, width: 1280, height: 720, fps: 24, outputPath: join(directory, "video.mp4"), concurrency: 1 });
    assert.equal(result.durationInFrames, 24);
    assert.deepEqual(result.network.externalAttempts, []);
    assert.ok((await stat(result.outputPath)).size > 0);
    assert.ok(createdScratch.some((filename) => filename.startsWith("explain-to-me-render-")), "Renderer scratch must honor the private job temporary directory.");
  } finally {
    watcher.close();
    for (const [key, value] of Object.entries(originalTemp)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.chdir(startingDirectory);
    await rm(directory, { recursive: true, force: true });
  }
});
