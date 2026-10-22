import { createServer, request as httpRequest, type ClientRequest, type IncomingMessage, type Server } from "node:http";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { delimiter, dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { RenderAsset, RenderRequest, RenderResult } from "../../../packages/renderer-core/src/renderer.js";
import { writeWindowsBrowserLauncher } from "./windows-browser-launcher.js";
import { ensurePrivateDirectory } from "../../../packages/assets/src/file-safety.js";
import { assetProvenanceSchema } from "../../../packages/contracts/src/production-manifest.js";
export { getLauncherReadiness } from "./windows-browser-launcher.js";

const REMOTION_PIN = "4.0.535";
const COMPOSITION_ID = "ExplainToMe";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
type ChromeMode = "chrome-for-testing" | "headless-shell";
type BrowserInstall = { path: string; chromeMode: ChromeMode };

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

const MAX_RENDER_ASSET_BYTES = 8 * 1024 * 1024;

export { type RenderAsset, type RenderRequest, type RenderResult } from "../../../packages/renderer-core/src/renderer.js";

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function findOnPath(names: string[]): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      try {
        if (statSync(candidate).isFile()) return resolve(candidate);
      } catch {
        // Continue looking through PATH.
      }
    }
  }
  return undefined;
}

function findInstalledBrowser(): BrowserInstall | undefined {
  const configured = [process.env.CHROME_PATH, process.env.CHROME_EXECUTABLE_PATH].filter(Boolean) as string[];
  for (const candidate of configured) {
    try {
      if (statSync(candidate).isFile()) {
        const path = resolve(candidate);
        return { path, chromeMode: /headless[_-]shell/i.test(path) ? "headless-shell" : "chrome-for-testing" };
      }
    } catch {
      // Try the preinstalled browser locations next.
    }
  }

  const platform = process.platform === "darwin"
    ? `mac-${process.arch}`
    : process.platform === "linux"
      ? process.arch === "arm64" ? "linux-arm64" : "linux64"
      : process.platform === "win32"
        ? "win64"
        : undefined;
  if (platform) {
    const remotionCache = join(PROJECT_ROOT, "node_modules", ".remotion");
    const shellDirectory = join(remotionCache, "chrome-headless-shell", platform, `chrome-headless-shell-${platform}`);
    const chromeForTestingDirectory = join(remotionCache, "chrome-for-testing", platform, `chrome-${platform}`);
    const remotionCandidates: BrowserInstall[] = [
      {
        path: join(shellDirectory, process.platform === "win32" ? "chrome-headless-shell.exe" : "headless_shell"),
        chromeMode: "headless-shell",
      },
      {
        path: join(shellDirectory, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell"),
        chromeMode: "headless-shell",
      },
      {
        path: process.platform === "darwin"
          ? join(chromeForTestingDirectory, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
          : process.platform === "win32"
            ? join(chromeForTestingDirectory, "chrome.exe")
            : join(chromeForTestingDirectory, "chrome"),
        chromeMode: "chrome-for-testing",
      },
    ];
    for (const candidate of remotionCandidates) {
      try {
        if (statSync(candidate.path).isFile()) return candidate;
      } catch {
        // No preinstalled Remotion browser at this cache path.
      }
    }
  }

  const home = process.env.HOME ?? "";
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    home ? join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome") : "",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) {
        const path = resolve(candidate);
        return { path, chromeMode: /headless[_-]shell/i.test(path) ? "headless-shell" : "chrome-for-testing" };
      }
    } catch {
      // Try the next installed-browser location.
    }
  }
  const onPath = findOnPath(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]);
  if (onPath) return { path: onPath, chromeMode: "chrome-for-testing" };
  return undefined;
}

function readPackageVersion(packageName: string): string {
  const packagePath = join(PROJECT_ROOT, "node_modules", ...packageName.split("/"), "package.json");
  try {
    return JSON.parse(readFileSync(packagePath, "utf8")).version as string;
  } catch {
    throw new Error(`Could not read ${packageName}/package.json from the project node_modules.`);
  }
}

export function assertPinnedRendererVersions(): string {
  const actual = ["remotion", "@remotion/bundler", "@remotion/renderer"].map((name) => ({ name, version: readPackageVersion(name) }));
  const incompatible = actual.filter((pkg) => pkg.version !== REMOTION_PIN);
  if (incompatible.length > 0) {
    throw new Error(
      `Renderer requires remotion, @remotion/bundler, and @remotion/renderer ${REMOTION_PIN}; found ${incompatible.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}.`,
    );
  }
  const react = readPackageVersion("react");
  const reactDom = readPackageVersion("react-dom");
  if (react !== reactDom || !react.startsWith("19.")) {
    throw new Error(`Renderer requires matching React 19 and React DOM versions; found react@${react} and react-dom@${reactDom}.`);
  }
  return REMOTION_PIN;
}

function verifyInstalledBrowser(browserPath: string): string {
  try {
    const version = execFileSync(browserPath, ["--version"], { encoding: "utf8", timeout: 5_000 }).trim();
    if (!version) throw new Error("the browser did not report a version");
    return version;
  } catch (error) {
    throw new Error(`The installed browser at ${browserPath} could not be started. Set CHROME_PATH to a usable Chrome or Chromium executable.`, { cause: error });
  }
}

export function getBrowserIdentity(): { path: string; version: string; chromeMode: string } | null {
  const browser = findInstalledBrowser();
  if (!browser) return null;
  return { ...browser, version: verifyInstalledBrowser(browser.path) };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine the loopback server port.");
  return address.port;
}

async function close(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

function requestPath(request: IncomingMessage): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }
  const relative = normalize(decoded).replace(/^([/\\]|\.\.(?:[/\\]|$))+/, "");
  return relative || "index.html";
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

export async function startBundleServer(bundleDir: string): Promise<{ server: Server; origin: string }> {
  const root = resolve(bundleDir);
  const server = createServer(async (request, response) => {
    const relative = requestPath(request);
    const filePath = relative ? resolve(root, relative) : "";
    if (!relative || !filePath || !isWithin(root, filePath) || !["GET", "HEAD"].includes(request.method ?? "GET")) {
      response.writeHead(404).end();
      return;
    }
    try {
      const contents = await readFile(filePath);
      response.writeHead(200, {
        "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
        "content-length": contents.byteLength,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else response.end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  const port = await listen(server);
  return { server, origin: `http://127.0.0.1:${port}` };
}

function attemptedUrl(request: IncomingMessage): string {
  const raw = request.url ?? "";
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).href;
    const host = request.headers.host ?? "unknown-host";
    return new URL(raw, `http://${host}`).href;
  } catch {
    return raw || "<malformed browser request>";
  }
}

export async function startRestrictingProxy(allowedOrigin: string): Promise<{
  server: Server;
  origin: string;
  attempts: Set<string>;
  abortPendingRequests: () => void;
}> {
  const allowed = new URL(allowedOrigin);
  const attempts = new Set<string>();
  const pendingRequests = new Set<ClientRequest>();
  const server = createServer((incoming, outgoing) => {
    const rawUrl = incoming.url ?? "";
    let destination: URL | undefined;
    try {
      destination = /^https?:\/\//i.test(rawUrl) ? new URL(rawUrl) : undefined;
    } catch {
      destination = undefined;
    }

    if (!destination || destination.origin !== allowed.origin || destination.protocol !== "http:") {
      attempts.add(attemptedUrl(incoming));
      outgoing.writeHead(451, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      outgoing.end("Browser network access blocked by local renderer policy.");
      return;
    }

    const forwarded = httpRequest(
      {
        hostname: allowed.hostname,
        port: Number(allowed.port),
        method: incoming.method,
        path: `${destination.pathname}${destination.search}`,
        headers: { ...incoming.headers, host: allowed.host },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    pendingRequests.add(forwarded);
    forwarded.once("close", () => pendingRequests.delete(forwarded));
    forwarded.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(forwarded);
  });
  server.on("connect", (request, socket) => {
    attempts.add(`https://${request.url}`);
    socket.end("HTTP/1.1 451 Unavailable For Legal Reasons\r\nConnection: close\r\n\r\n");
  });
  const port = await listen(server);
  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    attempts,
    abortPendingRequests: () => {
      for (const pending of pendingRequests) pending.destroy();
      pendingRequests.clear();
    },
  };
}

export async function writeBrowserWrapper(directory: string, browserPath: string, proxyOrigin: string): Promise<string> {
  if (process.platform === "win32") return writeWindowsBrowserLauncher(directory, browserPath, proxyOrigin);
  const wrapperPath = join(directory, "renderer-chrome.mjs");
  const script = [
    "#!/usr/bin/env node",
    'import { spawn } from "node:child_process";',
    `const executable = ${JSON.stringify(browserPath)};`,
    `const proxyOrigin = ${JSON.stringify(proxyOrigin)};`,
    "const browserArgs = process.argv.slice(2).filter((arg) => arg !== \"--no-proxy-server\" && !arg.startsWith(\"--proxy-server=\") && !arg.startsWith(\"--proxy-bypass-list=\"));",
    "browserArgs.push(`--proxy-server=${proxyOrigin}`, \"--proxy-bypass-list=<-loopback>\");",
    'const browser = spawn(executable, browserArgs, { env: process.env, stdio: "inherit" });',
    'for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => browser.kill(signal));',
    'browser.once("error", (error) => { console.error(error); process.exitCode = 1; });',
    'browser.once("exit", (code) => { process.exitCode = code ?? 1; });',
    "",
  ].join("\n");
  await writeFile(wrapperPath, script, { mode: 0o700 });
  await chmod(wrapperPath, 0o700);
  return wrapperPath;
}

function validateRequest(request: RenderRequest): void {
  const { manifest, timeline } = request;
  if (!manifest || !Array.isArray(manifest.scenes) || manifest.scenes.length === 0) throw new Error("Render request needs a non-empty production manifest.");
  if (!timeline || !Array.isArray(timeline.scenes) || !Array.isArray(timeline.chunks)) throw new Error("Render request needs a measured timeline.");
  if (!Number.isInteger(request.width) || request.width < 320 || !Number.isInteger(request.height) || request.height < 180) {
    throw new Error("Render dimensions must be integer pixels of at least 320×180.");
  }
  if (!Number.isFinite(request.fps) || request.fps <= 0 || request.fps !== timeline.fps) {
    throw new Error(`Render fps (${request.fps}) must match the measured timeline fps (${timeline.fps}).`);
  }
  if (!Number.isInteger(timeline.durationInFrames) || timeline.durationInFrames < 1) throw new Error("Measured timeline must contain at least one frame.");
  if (request.concurrency !== undefined && (!Number.isInteger(request.concurrency) || request.concurrency < 1)) {
    throw new Error("Render concurrency must be a positive integer.");
  }
  if (!request.outputPath.trim()) throw new Error("Render outputPath must not be empty.");
  renderAssetIds(request);
}

function renderAssetIds(request: RenderRequest): string[] {
  const declared = new Map((request.manifest.assets ?? []).map((asset) => [asset.id, asset]));
  if (declared.size !== (request.manifest.assets ?? []).length) throw new Error("Render manifest contains duplicate asset ids.");

  const requiredAssetIds = new Set<string>();
  for (const scene of request.manifest.scenes) {
    if (scene.kind === "image") {
      const assetId = scene.visual.assetId;
      if (!assetId) throw new Error(`Image scene ${scene.id} is missing its approved asset id.`);
      requiredAssetIds.add(assetId);
    }
    if (scene.visual.presenter) {
      if (!["title", "statement", "bullets", "outro"].includes(scene.kind)) {
        throw new Error(`Scene ${scene.id}: a presenter is supported only on title, statement, bullets, and outro scenes.`);
      }
      const assetId = scene.visual.presenter.assetId;
      const asset = declared.get(assetId);
      if (!asset || !assetProvenanceSchema.safeParse(asset.provenance).success) {
        throw new Error(`Scene ${scene.id}: presenter ${assetId} requires an approved asset with valid provenance.`);
      }
      requiredAssetIds.add(assetId);
    }
  }

  const provided = request.assets ?? {};
  if (typeof provided !== "object" || provided === null || Array.isArray(provided)) {
    throw new Error("Render assets must be an object keyed by manifest asset id.");
  }
  for (const [assetId, asset] of Object.entries(provided)) {
    if (!declared.has(assetId)) throw new Error(`Render request contains undeclared asset id ${assetId}.`);
    const intent = declared.get(assetId);
    if (!intent) throw new Error(`Image scene references undeclared asset id ${assetId}.`);
    if (!asset || typeof asset !== "object") throw new Error(`Render asset ${assetId} is invalid.`);
    if (typeof asset.path !== "string" || !isAbsolute(asset.path) || resolve(asset.path) !== asset.path) {
      throw new Error(`Render asset ${assetId} path must be canonical and absolute.`);
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256) || asset.sha256 !== intent.sha256) {
      throw new Error(`Render asset ${assetId} hash does not match the manifest.`);
    }
    if (asset.mimeType !== intent.mimeType) throw new Error(`Render asset ${assetId} MIME type does not match the manifest.`);
  }
  for (const assetId of requiredAssetIds) {
    if (!Object.prototype.hasOwnProperty.call(provided, assetId)) {
      throw new Error(`Scene asset ${assetId} was not resolved to an approved local file.`);
    }
  }
  return [...requiredAssetIds].sort();
}

function matchesImageSignature(contents: Buffer, mimeType: RenderAsset["mimeType"]): boolean {
  if (mimeType === "image/png") {
    return contents.length >= 8 && contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") return contents.length >= 3 && contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff;
  return contents.length >= 12 && contents.toString("ascii", 0, 4) === "RIFF" && contents.toString("ascii", 8, 12) === "WEBP";
}

function extensionForImage(mimeType: RenderAsset["mimeType"]): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  return "webp";
}

/** Stage only referenced, hash-verified image and presenter assets for the local browser. */
export async function copyAssetsIntoPublicDirectory(request: RenderRequest, directory: string): Promise<Record<string, string>> {
  const publicDirectory = join(directory, "public-assets");
  await mkdir(publicDirectory, { mode: 0o700 });
  const assetFilesById: Record<string, string> = {};
  const assetIds = renderAssetIds(request);
  for (let index = 0; index < assetIds.length; index += 1) {
    const assetId = assetIds[index]!;
    const asset = request.assets![assetId]!;
    const fileInfo = await lstat(asset.path);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error(`Render asset ${assetId} must be a regular local file.`);
    if (fileInfo.size < 1 || fileInfo.size > MAX_RENDER_ASSET_BYTES) {
      throw new Error(`Render asset ${assetId} must be between 1 byte and ${MAX_RENDER_ASSET_BYTES} bytes.`);
    }
    if (await realpath(asset.path) !== asset.path) throw new Error(`Render asset ${assetId} path is not canonical.`);

    const contents = await readFile(asset.path);
    if (contents.byteLength < 1 || contents.byteLength > MAX_RENDER_ASSET_BYTES) {
      throw new Error(`Render asset ${assetId} changed size during validation.`);
    }
    const actualHash = createHash("sha256").update(contents).digest("hex");
    if (actualHash !== asset.sha256) throw new Error(`Render asset ${assetId} bytes do not match the approved SHA-256 hash.`);
    if (!matchesImageSignature(contents, asset.mimeType)) throw new Error(`Render asset ${assetId} bytes do not match ${asset.mimeType}.`);

    const fileName = `asset-${String(index + 1).padStart(2, "0")}.${extensionForImage(asset.mimeType)}`;
    await writeFile(join(publicDirectory, fileName), contents, { flag: "wx", mode: 0o600 });
    assetFilesById[assetId] = fileName;
  }
  return assetFilesById;
}

function formatNetworkError(attempts: Set<string>, cause: unknown): Error {
  const details = [...attempts].sort();
  const error = new Error(
    `Renderer blocked ${details.length} external browser request${details.length === 1 ? "" : "s"}: ${details.join(", ")}${cause ? `; render error: ${asError(cause).message}` : ""}`,
  );
  Object.assign(error, { network: { externalAttempts: details }, cause });
  return error;
}

export async function renderVideo(request: RenderRequest): Promise<RenderResult> {
  validateRequest(request);
  const version = assertPinnedRendererVersions();
  const browser = findInstalledBrowser();
  if (!browser) {
    throw new Error(
      "No installed Chrome or preinstalled Remotion browser was found. Install a Remotion-compatible Chrome for Testing or Headless Shell during setup, then set CHROME_PATH to its executable; builds do not download browsers.",
    );
  }
  verifyInstalledBrowser(browser.path);

  const outputPath = resolve(request.outputPath);
  try {
    await lstat(outputPath);
    throw new Error(`Refusing to overwrite existing render output: ${outputPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const start = performance.now();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "explain-to-me-render-"));
  const bundleDirectory = join(temporaryRoot, "bundle");
  let bundleServer: Server | undefined;
  let proxyServer: Server | undefined;
  let abortPendingProxyRequests: (() => void) | undefined;
  let proxyAttempts = new Set<string>();
  let renderError: unknown;
  try {
    await ensurePrivateDirectory(temporaryRoot);
    await mkdir(dirname(outputPath), { recursive: true });
    const assetFilesById = await copyAssetsIntoPublicDirectory(request, temporaryRoot);
    const generatedBundle = await bundle({
      entryPoint: join(PROJECT_ROOT, "apps/renderer-remotion/src/entry.tsx"),
      outDir: bundleDirectory,
      publicDir: join(temporaryRoot, "public-assets"),
      symlinkPublicDir: false,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          extensionAlias: {
            ...config.resolve?.extensionAlias,
            ".js": [".js", ".ts", ".tsx"],
            ".jsx": [".jsx", ".tsx"],
          },
        },
      }),
    });
    if (resolve(generatedBundle) !== resolve(bundleDirectory)) {
      throw new Error(`Remotion wrote its bundle outside the temporary render directory: ${generatedBundle}`);
    }
    if (!existsSync(join(bundleDirectory, "index.html"))) throw new Error("Remotion bundle did not produce index.html.");

    const served = await startBundleServer(bundleDirectory);
    bundleServer = served.server;
    const proxy = await startRestrictingProxy(served.origin);
    proxyServer = proxy.server;
    abortPendingProxyRequests = proxy.abortPendingRequests;
    proxyAttempts = proxy.attempts;
    const executable = await writeBrowserWrapper(temporaryRoot, browser.path, proxy.origin);
    const inputProps = {
      manifest: request.manifest,
      timeline: request.timeline,
      width: request.width,
      height: request.height,
      fps: request.fps,
      assetFilesById,
    };
    const sharedBrowserOptions = {
      serveUrl: served.origin,
      browserExecutable: executable,
      chromeMode: browser.chromeMode,
      inputProps,
    };

    try {
      const composition = await selectComposition({ ...sharedBrowserOptions, id: COMPOSITION_ID });
      await renderMedia({
        ...sharedBrowserOptions,
        composition,
        codec: "h264",
        outputLocation: outputPath,
        overwrite: false,
        enforceAudioTrack: false,
        concurrency: request.concurrency ?? 2,
        logLevel: "error",
      });
    } catch (error) {
      renderError = error;
    }
    if (proxyAttempts.size > 0) throw formatNetworkError(proxyAttempts, renderError);
    if (renderError) {
      if (/Failed to launch the browser process|No browser found for rendering frames/i.test(asError(renderError).message)) {
        throw new Error(
          `The browser at ${browser.path} reported its version but could not start for Remotion. Install a Remotion-compatible Chrome for Testing or Headless Shell during setup, or set CHROME_PATH to a working executable; build-time browser downloads are disabled.`,
          { cause: renderError },
        );
      }
      throw renderError;
    }

    const warnings = (request.manifest.scenes.flatMap((scene) => (scene.cues ?? []).map((cue) =>
      `Cue target "${cue.target}" in chunk "${cue.chunkId}" uses declared sentence-start timing fallback.`,
    )));
    const result: RenderResult = {
      outputPath,
      renderer: "Remotion",
      browserExecutable: browser.path,
      version,
      durationInFrames: request.timeline.durationInFrames,
      wallTimeMs: Math.round(performance.now() - start),
      warnings,
      network: { externalAttempts: [...proxyAttempts].sort() },
    };
    return result;
  } finally {
    abortPendingProxyRequests?.();
    proxyServer?.closeAllConnections?.();
    bundleServer?.closeAllConnections?.();
    await Promise.allSettled([close(proxyServer), close(bundleServer)]);
    // Remotion closes its browser asynchronously; Windows locks the launcher
    // executable briefly until that process has finished exiting.
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
