import type { Server } from "node:http";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { assertNoLinkedPath, ensurePrivateDirectory } from "../../packages/assets/src/file-safety.js";
import {
  assertPinnedRendererVersions,
  getBrowserIdentity,
  startBundleServer,
  startRestrictingProxy,
  writeBrowserWrapper,
} from "../../apps/renderer-remotion/src/render.js";

const ENTRY_POINT = join(dirname(fileURLToPath(import.meta.url)), "entry.tsx");

export type CharacterRenderResult = {
  outputPath: string;
  renderer: "Remotion";
  version: string;
  browser: { path: string; version: string; chromeMode: string };
  durationInFrames: number;
  fps: number;
  width: 1280;
  height: 720;
  wallTimeMs: number;
  network: { externalAttempts: string[] };
  browserErrors: string[];
};

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

/** Render the local-only character study; preparation owns audio and final muxing. */
export async function renderCharacterTest(options: {
  outputDirectory: string;
  inputProps: Record<string, unknown>;
  durationInFrames: number;
  fps?: number;
  entryPoint?: string;
  compositionId?: string;
}): Promise<CharacterRenderResult> {
  const { inputProps, durationInFrames } = options;
  const fps = options.fps ?? 24;
  if (!Number.isInteger(durationInFrames) || durationInFrames < 1) throw new Error("Character test needs a positive integer frame count.");
  if (!Number.isInteger(fps) || fps < 1) throw new Error("Character test needs a positive integer frame rate.");

  const outputDirectory = resolve(options.outputDirectory);
  await assertNoLinkedPath(outputDirectory);
  if (!(await lstat(outputDirectory)).isDirectory()) throw new Error("Character output directory must exist before rendering.");
  const outputPath = join(outputDirectory, "silent.mp4");
  try {
    await lstat(outputPath);
    throw new Error(`Refusing to overwrite existing character render: ${outputPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const version = assertPinnedRendererVersions();
  const browser = getBrowserIdentity();
  if (!browser) throw new Error("Character test requires an installed Chrome or preinstalled Remotion browser. Run setup or set CHROME_PATH; this experiment never downloads a browser.");
  if (browser.chromeMode !== "headless-shell" && browser.chromeMode !== "chrome-for-testing") throw new Error("Unsupported installed browser mode.");
  const chromeMode = browser.chromeMode;
  const started = performance.now();
  const temporaryParent = resolve(tmpdir());
  const temporaryRoot = await mkdtemp(join(temporaryParent, "explain-to-me-claudia-"));
  // Guard the only recursive cleanup target before any files are placed inside it.
  if (!resolve(temporaryRoot).startsWith(`${temporaryParent}${sep}`)) throw new Error("Unexpected temporary render directory.");
  let bundleServer: Server | undefined;
  let proxyServer: Server | undefined;
  let abortPendingRequests: (() => void) | undefined;
  let attempts = new Set<string>();

  try {
    await ensurePrivateDirectory(temporaryRoot);
    const bundleDirectory = join(temporaryRoot, "bundle");
    const generatedBundle = await bundle({
      entryPoint: options.entryPoint ?? ENTRY_POINT,
      outDir: bundleDirectory,
      publicDir: null,
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
    if (resolve(generatedBundle) !== resolve(bundleDirectory) || !existsSync(join(bundleDirectory, "index.html"))) {
      throw new Error("Character bundle was not created in its private temporary directory.");
    }
    const served = await startBundleServer(bundleDirectory);
    bundleServer = served.server;
    const proxy = await startRestrictingProxy(served.origin);
    proxyServer = proxy.server;
    abortPendingRequests = proxy.abortPendingRequests;
    attempts = proxy.attempts;
    const browserExecutable = await writeBrowserWrapper(temporaryRoot, browser.path, proxy.origin);
    const browserErrors = new Set<string>();
    const sharedOptions = {
      serveUrl: served.origin, browserExecutable, chromeMode, inputProps,
      onBrowserLog: (log: {type: string; text: string}) => {
        if (log.type === "error") browserErrors.add(log.text || "Browser reported an error without message text");
      },
    } as const;
    let renderError: unknown;
    try {
      const composition = await selectComposition({ ...sharedOptions, id: options.compositionId ?? "ClaudiaCharacterTest" });
      if (composition.width !== 1280 || composition.height !== 720 || composition.fps !== fps || composition.durationInFrames !== durationInFrames) {
        throw new Error("Character composition dimensions or timing do not match the prepared experiment.");
      }
      let lastDecile = -1;
      await renderMedia({
        ...sharedOptions,
        composition,
        codec: "h264",
        crf: 19,
        outputLocation: outputPath,
        overwrite: false,
        enforceAudioTrack: false,
        concurrency: 2,
        logLevel: "error",
        onProgress: ({ progress }) => {
          const decile = Math.floor(progress * 10);
          if (decile > lastDecile) {
            lastDecile = decile;
            console.log(`Claudia render ${decile * 10}%`);
          }
        },
      });
    } catch (error) {
      renderError = error;
    }
    const externalAttempts = [...attempts].sort();
    if (externalAttempts.length) {
      throw Object.assign(new Error(`Character render blocked external browser requests: ${externalAttempts.join(", ")}`, { cause: renderError }), {
        network: { externalAttempts },
      });
    }
    if (renderError) throw renderError;
    if (browserErrors.size) throw new Error(`Character browser errors: ${[...browserErrors].join("; ")}`);
    return {
      outputPath,
      renderer: "Remotion",
      version,
      browser,
      durationInFrames,
      fps,
      width: 1280,
      height: 720,
      wallTimeMs: Math.round(performance.now() - started),
      network: { externalAttempts },
      browserErrors: [...browserErrors],
    };
  } finally {
    abortPendingRequests?.();
    await Promise.allSettled([closeServer(proxyServer), closeServer(bundleServer)]);
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
