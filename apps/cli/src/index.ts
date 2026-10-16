import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  formatManifestIssues,
  MAX_MANIFEST_BYTES,
  productionManifestSchema,
  type ProductionManifest,
} from "../../../packages/contracts/src/production-manifest.js";
import {
  MAX_RATE_WPM,
  MIN_RATE_WPM,
  PCM_CHANNELS,
  PCM_SAMPLE_RATE,
  extractPcmDataFromWav,
  runProcess,
  synthesizeNarration,
  kokoroReadiness,
  writeWavFromPcm,
} from "../../../packages/audio/src/synthesize.js";
import {
  buildTimeline,
  createSentenceCaptions,
  renderSrt,
  renderWebVtt,
} from "../../../packages/timeline/src/timeline.js";
import {
  confirmAllArtifacts,
  extractSceneBoundarySamples,
  muxAudioIntoVideo,
  validateRenderedMedia,
} from "../../../packages/validation/src/qc.js";
import type { Timeline } from "../../../packages/timeline/src/timeline.js";
import type { RenderRequest, RenderResult as RendererResult } from "../../../packages/renderer-core/src/renderer.js";
import { loadDocument, resolveManifestAssets, type SourceDocument, type ResolvedAsset } from "../../../packages/ingest/src/markdown.js";
import { directDocument, localDirectorReadiness } from "../../../packages/director/src/director.js";
import { prepareNarration } from "../../../packages/audio/src/prepare-narration.js";
import { ContentAddressedCache } from "../../../packages/assets/src/cache.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_VOICE = "auto";
const APPLE_VOICE = "Samantha";
const DEFAULT_WIDTH = 1_280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_FPS = 24;
const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m)$/u;
const RENDER_ENTRY = resolve(PROJECT_ROOT, "apps/renderer-remotion/src/render.ts");

interface CliOptions {
  manifestPath?: string;
  inputPath?: string;
  directorMode: "auto" | "template" | "local";
  audience: string;
  style: string;
  pronunciationPath?: string;
  profile: "preview";
  targetDurationMs?: number;
  outputPath?: string;
  voice: string;
  backend: "apple" | "kokoro" | "auto";
  cacheDir: string;
}

type RenderVideo = (request: RenderRequest) => Promise<RendererResult>;

interface RendererModule {
  getBrowserIdentity: () => { path: string; version: string; chromeMode: string } | null;
  renderVideo: RenderVideo;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }
  if (command === "--version") {
    if (rest.length > 0) throw new Error("--version does not accept additional arguments");
    const packageInfo = JSON.parse(await readFile(join(PROJECT_ROOT, "package.json"), "utf8")) as { version: string };
    process.stdout.write(`explain-to-me ${packageInfo.version}\n`);
    return;
  }
  if (command === "doctor") {
    await doctor(rest);
    return;
  }
  if (command !== "build") {
    throw new Error(`Unknown command "${command}". Use "explain-to-me --help" for supported commands.`);
  }
  await build(parseBuildOptions(rest));
}

async function doctor(args: string[]): Promise<void> {
  if (args.length > 0) throw new Error("doctor does not accept additional arguments");
  const requiredTools = process.platform === "darwin" ? ["say", "ffmpeg", "ffprobe"] : ["ffmpeg", "ffprobe"];
  const statuses: { name: string; path: string | null; ready: boolean; detail?: string }[] = [];
  statuses.push({ name: "Node.js >=24", path: process.execPath, ready: Number(process.versions.node.split(".")[0]) >= 24, detail: process.versions.node });
  statuses.push({
    name: "Supported platform (macOS, Linux)",
    path: null,
    ready: process.platform === "darwin" || process.platform === "linux",
    detail: process.platform === "darwin"
      ? "macOS — Apple speech available"
      : process.platform === "linux"
        ? "linux — Apple speech unavailable; build with --tts kokoro"
        : process.platform,
  });
  for (const name of requiredTools) {
    const path = findExecutable(name);
    statuses.push({ name, path, ready: path !== null });
  }

  if (process.platform === "darwin") {
    let voices: string[] = [];
    try {
      voices = listSystemVoices();
    } catch {
      // The missing say binary is already reported as a required tool failure.
    }
    const voiceReady = voices.includes(APPLE_VOICE);
    statuses.push({ name: `Apple voice ${APPLE_VOICE}`, path: "/usr/bin/say", ready: voiceReady, detail: voiceReady ? "available" : "not listed by say -v ?" });
    let voiceSampleCount = 0;
    let voiceSampleError = "";
    if (voiceReady) {
      const sampleDir = await mkdtemp(join(tmpdir(), "explain-to-me-doctor-"));
      try {
        const wavePath = join(sampleDir, "voice-check.wav");
        runProcess("/usr/bin/say", [
          "-v", APPLE_VOICE, "-r", "160", "--file-format=WAVE",
          `--data-format=LEI16@${PCM_SAMPLE_RATE}`, `--channels=${PCM_CHANNELS}`,
          "-o", wavePath, "Local speech synthesis check.",
        ]);
        voiceSampleCount = extractPcmDataFromWav(await readFile(wavePath)).byteLength / 2;
      } catch (error) {
        voiceSampleError = error instanceof Error ? error.message : String(error);
      } finally {
        await rm(sampleDir, { recursive: true, force: true });
      }
    }
    statuses.push({
      name: "Apple say 24 kHz mono PCM output",
      path: "/usr/bin/say",
      ready: voiceSampleCount > 0,
      detail: voiceSampleCount > 0 ? `${voiceSampleCount} samples synthesized` : voiceSampleError || "synthesis produced no PCM samples",
    });
  } else {
    statuses.push({
      name: "Apple speech (optional)",
      path: null,
      ready: false,
      detail: "Apple speech is macOS-only; build with --tts kokoro --voice af_heart",
    });
  }

  const neural = kokoroReadiness();
  statuses.push({ name: "Kokoro neural narrator (optional)", path: null, ready: neural.ready, detail: neural.reason });
  const localDirector = localDirectorReadiness();
  statuses.push({ name: "Local model director (optional)", path: null, ready: localDirector.ready, detail: localDirector.reason });
  const rendererReady = await pathExists(RENDER_ENTRY);
  let chrome: string | null = null;
  let browserError = "";
  if (rendererReady) {
    try { chrome = (await loadRenderer()).getBrowserIdentity()?.path ?? null; }
    catch (error) { browserError = error instanceof Error ? error.message : String(error); }
  }
  statuses.push({
    name: "Remotion renderer entry",
    path: rendererReady ? RENDER_ENTRY : null,
    ready: rendererReady,
    detail: rendererReady ? "ready" : "renderer worker has not added the shared render.ts boundary yet",
  });
  statuses.push({
    name: "Chrome/Chromium",
    path: chrome,
    ready: chrome !== null,
    detail: chrome ? "installed locally" : browserError || "install the render browser during setup and set CHROME_PATH to its absolute path",
  });

  const checks = statuses.map((item) => `${item.ready ? "OK" : item.name.endsWith("(optional)") ? "OPTIONAL" : "MISSING"}  ${item.name}${item.path ? ` — ${item.path}` : ""}${item.detail ? ` (${item.detail})` : ""}`);
  process.stdout.write(`${checks.join("\n")}\n`);
  process.stdout.write([
    "",
    "Setup guidance (setup may download dependencies; doctor does not install anything):",
    "  Node.js: use version 24 or newer. Video builds support macOS and Linux (Kokoro narrator on Linux).",
    "  ffmpeg/ffprobe: install FFmpeg, e.g. brew install ffmpeg on macOS with Homebrew.",
    "  Apple speech: check say -v '?' and install the Samantha voice in macOS settings if missing (macOS only; on Linux build with --tts kokoro).",
    "  Browser: follow the README one-time Remotion Headless Shell setup; builds never download it.",
    "  Kokoro (optional): install uv, then run python3 scripts/setup-kokoro.py.",
    "  Local director (optional): install llama.cpp / llama-server, then run python3 scripts/setup-director.py.",
    "  Optional components may be absent; use the prepared-manifest Apple quickstart first on macOS (on Linux, set up Kokoro first).",
    "",
  ].join("\n"));
  const coreReady = statuses.filter((item) => !["Kokoro neural narrator (optional)", "Local model director (optional)", "Apple speech (optional)"].includes(item.name)).every((item) => item.ready);
  if (!coreReady) throw new Error("Required local audio/video tools are unavailable; install them before building.");
}

async function build(options: CliOptions): Promise<void> {
  const invocationStart = performance.now();
  await assertBuildPrerequisites(options.voice, options.backend);
  if (options.outputPath && await pathExists(resolve(options.outputPath))) throw new Error("Output target already exists; choose a new directory");
  const stageTimingsMs: Record<string, number> = {};
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try { return await fn(); }
    finally { stageTimingsMs[name] = roundMs(performance.now() - started); }
  };
  const inputFile = resolve(options.inputPath ?? options.manifestPath!);
  let rawManifest: unknown;
  let document: SourceDocument | undefined;
  let direction: {
    method: string; warnings: string[]; provenance: Record<string, unknown>;
    cacheStats: { hits: number; misses: number; writes: number; corruptions: number };
    sourceReferences: Record<string, string[]>;
  } = { method: "prepared-manifest", warnings: [], provenance: {}, cacheStats: { hits: 0, misses: 0, writes: 0, corruptions: 0 }, sourceReferences: {} };
  if (options.inputPath) {
    document = await timed("ingestion", () => loadDocument(inputFile, { projectRoot: process.cwd() }));
    direction = await timed("direction", async () => {
      const directed = await directDocument(document!, {
        durationMs: options.targetDurationMs ?? 60_000,
        audience: options.audience, style: options.style, mode: options.directorMode, cacheDir: options.cacheDir,
      });
      rawManifest = directed.manifest;
      return directed;
    });
  } else {
    await timed("manifestRead", async () => {
      const info = await stat(inputFile);
      if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) throw new Error(`Manifest must be a regular file within ${MAX_MANIFEST_BYTES} bytes`);
      const input = await readFile(inputFile, "utf8");
      if (Buffer.byteLength(input) > MAX_MANIFEST_BYTES) throw new Error("Manifest grew beyond the input limit while reading");
      try { rawManifest = JSON.parse(input); }
      catch { throw new Error("Manifest is not valid JSON"); }
    });
  }
  const parsed = productionManifestSchema.safeParse(rawManifest);
  if (!parsed.success) throw new Error(`Manifest validation failed:\n${formatManifestIssues(parsed.error).map((issue) => `  - ${issue}`).join("\n")}`);
  const initialManifest = (options.targetDurationMs === undefined ? parsed.data : { ...parsed.data, targetDurationMs: options.targetDurationMs }) as ProductionManifest;
  const pronunciationConfig = await loadPronunciations(options.pronunciationPath);
  const prepared = await timed("narrationPreparation", async () => prepareNarration(initialManifest, pronunciationConfig.map));
  let manifest: ProductionManifest = productionManifestSchema.parse(prepared.manifest) as ProductionManifest;
  const resolvedAssets = await timed("assetResolution", () => resolveManifestAssets(manifest, inputFile, { projectRoot: process.cwd() }));
  const buildId = randomUUID();
  const finalOutput = await chooseOutputPath(options.outputPath, manifest.title, buildId);
  if (await pathExists(finalOutput)) throw new Error(`Output target already exists; choose a new path: ${finalOutput}`);
  const stagingPath = join(dirname(finalOutput), `.${finalOutput.split(/[\\/]/u).at(-1)!}.staging-${buildId}`);
  const tempRoot = await mkdtemp(join(tmpdir(), "explain-to-me-build-"));
  await mkdir(stagingPath, { mode: 0o700 });
  let executionAssets: NonNullable<RenderRequest["assets"]> = {};
  try {
    executionAssets = await timed("assetCopy", () => materializeAssets(resolvedAssets, stagingPath));
    if (manifest.assets?.length) {
      manifest = { ...manifest, assets: manifest.assets.map((asset) => ({ ...asset, source: `assets/${asset.id}.${assetExtension(asset.mimeType)}` })) };
    }
    const synthesis = await timed("narrationSynthesis", () => synthesizeNarration({
      manifest,
      voice: options.voice,
      backend: options.backend,
      cacheDir: options.cacheDir,
      targetDurationMs: manifest.targetDurationMs,
      workDir: tempRoot,
    }));
    await timed("wavEncoding", () => writeWavFromPcm(synthesis.pcmPath, join(stagingPath, "audio.wav")));

    const timeline = await timed("timelineAndCaptions", async () => {
      const built = buildTimeline(manifest, synthesis.chunks, DEFAULT_FPS, PCM_SAMPLE_RATE);
      const captions = createSentenceCaptions(manifest, built, PCM_SAMPLE_RATE);
      await Promise.all([
        writeFile(join(stagingPath, "captions.vtt"), renderWebVtt(captions), "utf8"),
        writeFile(join(stagingPath, "captions.srt"), renderSrt(captions), "utf8"),
        writeFile(join(stagingPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      ]);
      return { timeline: built, captions };
    });

    const renderer = await loadRenderer();
    const browserIdentity = renderer.getBrowserIdentity();
    if (!browserIdentity) throw new Error("No installed renderer browser is available; run setup first");
    const renderCache = new ContentAddressedCache(options.cacheDir);
    const renderRequest = {
      manifest,
      timeline: timeline.timeline,
      outputPath: join(tempRoot, "rendered-video-only.mp4"),
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      fps: DEFAULT_FPS,
      assets: executionAssets,
    };
    const renderKey = renderCache.key("render-video-v1", {
      manifest, timeline: timeline.timeline,
      width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, fps: DEFAULT_FPS,
      rendererVersion: JSON.parse(await readFile(join(PROJECT_ROOT, "node_modules/remotion/package.json"), "utf8")).version,
      sourceHashes: await rendererSourceHashes(),
      environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: (await import("node:os")).release(), browser: browserIdentity },
    });
    let renderCacheHit = true;
    const rendered = await timed("videoRender", async () => {
      const packed = await renderCache.getOrCreate(renderKey, async () => {
        renderCacheHit = false;
        const fresh = await renderer.renderVideo(renderRequest);
        if (fresh.browserExecutable !== browserIdentity.path) throw new Error("Browser selection changed during rendering; refusing mismatched cache identity");
        const header = Buffer.from(JSON.stringify(fresh));
        const length = Buffer.alloc(4);
        length.writeUInt32LE(header.length);
        return Buffer.concat([length, header, await readFile(fresh.outputPath)]);
      });
      if (packed.length < 4) throw new Error("Invalid cached render record");
      const headerLength = packed.readUInt32LE(0);
      if (headerLength > 65_536 || headerLength + 4 >= packed.length) throw new Error("Invalid cached render header");
      const result = JSON.parse(packed.subarray(4, 4 + headerLength).toString("utf8")) as RendererResult;
      if (!Array.isArray(result.network?.externalAttempts) || result.network.externalAttempts.length > 0 || result.durationInFrames !== timeline.timeline.durationInFrames) {
        throw new Error("Cached render metadata does not match this validated build");
      }
      if (renderCacheHit) await writeFile(renderRequest.outputPath, packed.subarray(4 + headerLength));
      return { ...result, outputPath: renderRequest.outputPath, wallTimeMs: renderCacheHit ? 0 : result.wallTimeMs };
    });
    if (!Array.isArray(rendered.network?.externalAttempts)) {
      throw new Error("Renderer result omitted network.externalAttempts; refusing to report egress status without its declared evidence");
    }
    if (rendered.network.externalAttempts.length > 0) {
      throw new Error(`Renderer reported external network attempts: ${rendered.network.externalAttempts.join(", ")}`);
    }

    await timed("audioVideoMux", () => muxAudioIntoVideo(rendered.outputPath, join(stagingPath, "audio.wav"), join(stagingPath, "video.mp4")));
    const boundarySamples = await timed("boundaryFrameSamples", () => extractSceneBoundarySamples(
      join(stagingPath, "video.mp4"), timeline.timeline, join(stagingPath, "samples"),
    ));
    const media = await timed("automatedQc", () => validateRenderedMedia({
      outputDir: stagingPath,
      pcmPath: synthesis.pcmPath,
      timeline: timeline.timeline,
      captions: timeline.captions,
      targetDurationMs: manifest.targetDurationMs,
      rendererFrameCount: rendered.durationInFrames,
      boundarySamples,
    }));

    const wallThroughValidationMs = roundMs(performance.now() - invocationStart);
    const manifestHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    const fallbackCues = manifest.scenes.flatMap((scene) => (scene.cues ?? []).map((cue) => ({
      sceneId: scene.id,
      chunkId: cue.chunkId,
      tokenIndex: cue.tokenIndex,
      target: cue.target,
      action: cue.action,
      timingFallback: cue.timingFallback,
    })));
    const report = {
      reportVersion: 1,
      buildId,
      input: {
        kind: document ? document.sourcePath.endsWith(".txt") ? "plain-text" : "markdown" : "prepared-manifest",
        sourcePath: document?.sourcePath ?? inputFile,
        sourceSha256: document?.sha256 ?? createHash("sha256").update(await readFile(inputFile)).digest("hex"),
        blocks: document?.blocks.map((block) => ({ id: block.id, kind: block.kind, startLine: block.startLine, endLine: block.endLine })) ?? [],
        warnings: document?.warnings ?? [],
      },
      direction: { ...direction, audience: options.audience, style: options.style, cloudCalls: [] },
      narrationPreparation: { stats: prepared.stats, warnings: prepared.warnings, pronunciations: pronunciationConfig.provenance },
      assets: resolvedAssets.map((asset) => ({ id: asset.id, source: asset.source, canonicalPath: asset.path, sha256: asset.sha256, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes })),
      createdAt: new Date().toISOString(),
      status: "automated-checks-passed-egress-unverified",
      profile: manifest.profile,
      targetDurationMs: manifest.targetDurationMs,
      manifest: { title: manifest.title, sha256: manifestHash },
      artifacts: ["video.mp4", "audio.wav", "captions.vtt", "captions.srt", "manifest.json", "report.json"],
      timingsMs: {
        stages: stageTimingsMs,
        totalThroughAutomatedValidation: wallThroughValidationMs,
        clock: "performance.now() monotonic milliseconds",
      },
      narration: {
        engine: synthesis.engine,
        backend: synthesis.backend,
        voice: synthesis.voice,
        ...(synthesis.finalRateWpm === undefined ? {} : { rateWpm: synthesis.finalRateWpm, rateBoundsWpm: { min: MIN_RATE_WPM, max: MAX_RATE_WPM } }),
        ...(synthesis.speed === undefined ? {} : { speed: synthesis.speed }),
        warnings: synthesis.warnings,
        provenance: synthesis.provenance,
        sampleRateHz: synthesis.sampleRate,
        channels: synthesis.channels,
        totalSamples: synthesis.totalSamples,
        measuredDurationMs: synthesis.durationMs,
        chunks: synthesis.chunks.map((chunk) => ({ id: chunk.id, sampleCount: chunk.samples })),
        durationAttempts: synthesis.attempts,
      },
      cache: {
        directory: options.cacheDir,
        narration: synthesis.cacheStats,
        render: { hit: renderCacheHit, key: renderKey, ...renderCache.snapshotStats() },
      },
      timeline: {
        fps: timeline.timeline.fps,
        durationMs: timeline.timeline.durationMs,
        durationInFrames: timeline.timeline.durationInFrames,
        finalFrameRule: "ceil(total PCM samples / sample rate * fps)",
        boundaryRule: "rounded cumulative PCM sample time; no per-scene accumulation",
        scenes: timeline.timeline.scenes,
        chunks: timeline.timeline.chunks,
      },
      captions: {
        method: "one caption per measured sentence/phrase audio chunk",
        formats: ["WebVTT", "SRT"],
        segmentCount: media.captionCount,
        timingMethod: "measured sentence/phrase chunk boundaries; no proportional subdivisions or word-alignment claim",
        narrationChunksCovered: media.coveredChunkCount,
        sentenceStartCueFallbacks: fallbackCues,
      },
      validation: {
        automatedChecks: "passed",
        gates: media.checks,
        media: {
          containerDurationMs: media.containerDurationMs,
          audioEndMs: media.audioEndMs,
          videoEndMs: media.videoEndMs,
          avEndDifferenceMs: media.avEndDifferenceMs,
          captionEndDifferenceMs: media.captionEndDifferenceMs,
          decoded: media.ffmpegDecode,
          probe: media.probe,
        },
        audioSignal: media.audioSignal,
        thresholds: {
          audio: "packages/validation/src/qc.ts AUDIO_QC_THRESHOLDS",
          requestedDurationToleranceMs: 1_000,
          avAndCaptionEndToleranceMs: 250,
        },
        sceneBoundarySamples: media.boundarySamples,
      },
      provenance: {
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        osRelease: (await import("node:os")).release(),
        ffmpeg: toolVersion("ffmpeg"),
        ffprobe: toolVersion("ffprobe"),
        sayPath: synthesis.backend === "apple" ? synthesis.provenance.executable : null,
        browserExecutable: rendered.browserExecutable,
        cpu: (await import("node:os")).cpus()[0]?.model ?? "unknown",
        logicalCpuCount: (await import("node:os")).cpus().length,
        memoryBytes: (await import("node:os")).totalmem(),
        renderer: {
          name: rendered.renderer,
          version: rendered.version,
          wallTimeMs: rendered.wallTimeMs,
          warnings: rendered.warnings,
          license: "Remotion source-available license; distribution and automated-rendering terms require human review",
          termsReference: "https://www.remotion.dev/license",
          licenseReviewedInThisBuild: false,
        },
      },
      egress: {
        status: "unverified",
        rendererReportedExternalAttempts: rendered.network.externalAttempts,
        evidence: "No external attempts were reported by the renderer; this build did not run under an egress-deny harness, so zero egress is unverified.",
      },
      skippedChecks: [
        { name: "ASR transcript comparison", reason: "No offline ASR stage is installed for the prepared-manifest milestone; automated checks cover timing and signal quality." },
        { name: "egress deny-harness proof", reason: "No egress-deny harness was run for this build." },
      ],
      humanReview: {
        status: "pending",
        required: true,
        instruction: "Watch and listen to the full video; confirm narration intelligibility, scene coverage, captions, and visual quality.",
      },
    };
    const reportPath = join(stagingPath, "report.json");
    const firstReportWriteStarted = performance.now();
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    stageTimingsMs.reportWrite = roundMs(performance.now() - firstReportWriteStarted);
    report.timingsMs.stages.reportWrite = stageTimingsMs.reportWrite;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await confirmAllArtifacts(stagingPath);
    if (await pathExists(finalOutput)) throw new Error(`Output target appeared during the build; refusing to replace it: ${finalOutput}`);
    await rename(stagingPath, finalOutput);

    process.stdout.write(`Build artifacts ready: ${finalOutput}\n`);
    process.stdout.write(`Automated QC passed. Egress verification: unverified. Human review: pending.\n`);
  } catch (error) {
    await writeFile(join(stagingPath, "failure.json"), `${JSON.stringify({
      buildId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      stageTimingsMs,
    }, null, 2)}\n`).catch(() => undefined);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nFailure diagnostics retained at ${stagingPath}`, { cause: error });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseBuildOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (!["manifest", "profile", "duration", "output", "voice", "tts", "cache-dir", "director", "audience", "style", "pronunciations"].includes(key)) {
      throw new Error(`Unknown build option --${key}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Option --${key} requires a value`);
    if (values.has(key)) throw new Error(`Option --${key} was supplied more than once`);
    values.set(key, value);
    index += 1;
  }
  if (positionals.length > 1) throw new Error("build accepts one local Markdown/plain-text source");
  const inputPath = positionals[0];
  const manifestPath = values.get("manifest");
  if (Boolean(inputPath) === Boolean(manifestPath)) throw new Error("Choose one source file or --manifest, not both");
  if (manifestPath && ["director", "audience", "style"].some((key) => values.has(key))) throw new Error("Director/audience/style options apply to document inputs, not prepared manifests");
  const profile = values.get("profile") ?? "preview";
  if (profile !== "preview") throw new Error("Milestone 1 supports only --profile preview");
  const duration = values.get("duration");
  const targetDurationMs = duration === undefined ? undefined : parseDuration(duration);
  const outputPath = values.get("output");
  const backend = values.get("tts") ?? "auto";
  if (!["auto", "apple", "kokoro"].includes(backend)) throw new Error("--tts must be auto, apple, or kokoro");
  const directorMode = values.get("director") ?? "auto";
  if (!["auto", "template", "local"].includes(directorMode)) throw new Error("--director must be auto, template, or local");
  const audience = values.get("audience") ?? "software engineers";
  const style = values.get("style") ?? "friendly technical whiteboard";
  if (audience.length > 240 || style.length > 240) throw new Error("Audience/style hints are limited to 240 characters");
  return {
    ...(manifestPath === undefined ? {} : { manifestPath }),
    ...(inputPath === undefined ? {} : { inputPath }),
    directorMode: directorMode as "auto" | "template" | "local",
    audience, style,
    ...(values.get("pronunciations") === undefined ? {} : { pronunciationPath: values.get("pronunciations")! }),
    profile,
    ...(targetDurationMs === undefined ? {} : { targetDurationMs }),
    ...(outputPath === undefined ? {} : { outputPath }),
    voice: values.get("voice") ?? DEFAULT_VOICE,
    backend: backend as "apple" | "kokoro" | "auto",
    cacheDir: resolve(values.get("cache-dir") ?? join(PROJECT_ROOT, ".explain-to-me/cache")),
  };
}

function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid duration "${value}". Use a number followed by ms, s, or m (for example 60s).`);
  const amount = Number(match[1]);
  const factor = match[2] === "ms" ? 1 : match[2] === "s" ? 1_000 : 60_000;
  const milliseconds = Math.round(amount * factor);
  if (milliseconds < 10_000 || milliseconds > 600_000) throw new Error("Preview duration must be between 10 and 600 seconds");
  return milliseconds;
}

async function assertBuildPrerequisites(voice: string, backend: "auto" | "apple" | "kokoro"): Promise<void> {
  if (!(await pathExists(RENDER_ENTRY))) {
    throw new Error(`Renderer integration is not ready: ${RENDER_ENTRY} is missing. Build can run after the renderer worker supplies the documented renderVideo boundary.`);
  }
  const neural = kokoroReadiness();
  if (backend === "kokoro" && !neural.ready) throw new Error(`Kokoro is unavailable: ${neural.reason}. Run python3 scripts/setup-kokoro.py during setup.`);
  const actualBackend = backend === "auto" ? neural.ready ? "kokoro" : "apple" : backend;
  const executables = actualBackend === "apple" ? ["say", "ffmpeg", "ffprobe"] : ["ffmpeg", "ffprobe"];
  for (const executable of executables) {
    if (!findExecutable(executable)) throw new Error(`Required executable "${executable}" was not found on PATH`);
  }
  const selectedVoice = voice === "auto" || (backend === "auto" && /^(af|am|bf|bm)_/.test(voice)) ? APPLE_VOICE : voice;
  if (actualBackend === "apple" && !listSystemVoices().includes(selectedVoice)) throw new Error(`Apple voice "${selectedVoice}" is not available according to "say -v ?"`);
}

async function loadRenderer(): Promise<RendererModule> {
  try {
    const loaded = await import(pathToFileURL(RENDER_ENTRY).href) as Partial<RendererModule>;
    if (typeof loaded.renderVideo !== "function" || typeof loaded.getBrowserIdentity !== "function") throw new Error("module must export renderVideo(request) and getBrowserIdentity()");
    return loaded as RendererModule;
  } catch (error) {
    throw new Error(`Could not load apps/renderer-remotion/src/render.ts: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadPronunciations(path: string | undefined): Promise<{ map: Record<string, string>; provenance: Record<string, unknown> }> {
  if (!path) return { map: {}, provenance: { source: null, sha256: null } };
  const filename = resolve(path);
  const info = await stat(filename);
  if (!info.isFile() || info.size > 32_768) throw new Error("Pronunciation file must be a regular JSON file within 32 KiB");
  const bytes = await readFile(filename);
  if (bytes.length > 32_768) throw new Error("Pronunciation file exceeds the size limit");
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Pronunciation dictionary must be a JSON object of literal term-to-spoken-text strings");
  const entries = Object.entries(value);
  if (entries.length > 64 || entries.some(([key, spoken]) => !key.trim() || key.length > 80 || typeof spoken !== "string" || !spoken.trim() || spoken.length > 160)) {
    throw new Error("Pronunciation dictionary is limited to 64 non-empty terms (80 chars) and spoken values (160 chars)");
  }
  return { map: Object.fromEntries(entries) as Record<string, string>, provenance: { source: filename, sha256: createHash("sha256").update(bytes).digest("hex") } };
}

function assetExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  throw new Error("Unsupported raster asset type");
}

async function materializeAssets(assets: ResolvedAsset[], stagingPath: string): Promise<NonNullable<RenderRequest["assets"]>> {
  const result: NonNullable<RenderRequest["assets"]> = {};
  if (!assets.length) return result;
  const directory = join(stagingPath, "assets");
  await mkdir(directory, { mode: 0o700 });
  for (const asset of assets) {
    const bytes = await readFile(asset.path);
    if (bytes.length > 8 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new Error(`Asset changed after approved resolution: ${asset.id}`);
    }
    const path = join(directory, `${asset.id}.${assetExtension(asset.mimeType)}`);
    await writeFile(path, bytes, { mode: 0o600 });
    result[asset.id] = { path, sha256: asset.sha256, mimeType: asset.mimeType };
  }
  return result;
}

async function rendererSourceHashes(): Promise<Record<string, string>> {
  const paths = ["apps/renderer-remotion/src/entry.tsx", "apps/renderer-remotion/src/render.ts", "apps/renderer-remotion/src/video.tsx", "packages/renderer-core/src/renderer.ts", "package.json", "pnpm-lock.yaml", "tsconfig.json"];
  const hashes: Record<string, string> = {};
  for (const path of paths) hashes[path] = createHash("sha256").update(await readFile(join(PROJECT_ROOT, path))).digest("hex");
  return hashes;
}

async function chooseOutputPath(requested: string | undefined, title: string, buildId: string): Promise<string> {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "explanation";
  const path = requested ? resolve(requested) : resolve(PROJECT_ROOT, "out", `${slug}-${new Date().toISOString().replace(/[:.]/gu, "-")}-${buildId.slice(0, 8)}`);
  await mkdir(dirname(path), { recursive: true });
  return path;
}

function listSystemVoices(): string[] {
  const output = runProcess("/usr/bin/say", ["-v", "?"]);
  return output.split(/\r?\n/u).map((line) => line.trim().split(/\s{2,}/u)[0] ?? "").filter(Boolean);
}

function toolVersion(executable: string): string {
  try {
    const output = runProcess(executable, executable === "ffmpeg" ? ["-version"] : ["-version"]);
    return output.split(/\r?\n/u)[0] ?? "unknown";
  } catch (error) {
    return error instanceof Error ? `unavailable: ${error.message}` : "unavailable";
  }
}

function findExecutable(name: string): string | null {
  if (name === "say") {
    try { accessSync("/usr/bin/say", constants.X_OK); return "/usr/bin/say"; } catch { return null; }
  }
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(":").filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Check the next PATH entry.
    }
  }
  return null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function roundMs(milliseconds: number): number {
  return Math.round(milliseconds * 100) / 100;
}

function printHelp(): void {
  process.stdout.write([
    "explain-to-me — local document-to-video explainer",
    "",
    "Commands:",
    "  explain-to-me --version",
    "  explain-to-me doctor",
    "  explain-to-me build <input.md|input.txt> [--director auto|local|template] [--duration 60s] [--audience <text>] [--style <hint>]",
    "  explain-to-me build --manifest <file.json> [--duration 60s]",
    "  Options: --output <new-dir> --tts auto|apple|kokoro --voice <id> --cache-dir <dir> --pronunciations <map.json>",
    "",
    "Models are installed during setup only; runtime direction stays local. Template mode is extractive, not AI summarization.",
    "Build output is written only to a new directory. Current visual theme/profile is technical-whiteboard/preview.",
  ].join("\n") + "\n");
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
