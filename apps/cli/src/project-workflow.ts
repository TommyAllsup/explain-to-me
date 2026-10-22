import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { CliOptions } from "./index.js";
import { productionManifestSchema, MAX_MANIFEST_BYTES, type ProductionManifest } from "../../../packages/contracts/src/production-manifest.js";
import { loadProject, resolveProjectFile, resolveProjectOutput } from "../../../packages/project/src/files.js";
import { loadDocument, resolveManifestAssets } from "../../../packages/ingest/src/markdown.js";
import { directDocument } from "../../../packages/director/src/director.js";
import { ensurePrivateDirectory, assertNoLinkedPath, openRegularFile } from "../../../packages/assets/src/file-safety.js";
import { prepareNarration } from "../../../packages/audio/src/prepare-narration.js";
import { validatePacing } from "../../../packages/audio/src/pacing.js";
import { synthesizeNarration, writeWavFromPcm, PCM_SAMPLE_RATE, type SynthesizedChunk } from "../../../packages/audio/src/synthesize.js";
import { buildTimeline, createSentenceCaptions, renderSrt, renderWebVtt } from "../../../packages/timeline/src/timeline.js";
import { inspectPcm } from "../../../packages/validation/src/qc.js";
import { resolveMusic, type ResolvedMusic, type MusicConfig } from "../../../packages/audio/src/soundtrack.js";

export type LoadedProject = Awaited<ReturnType<typeof loadProject>>;
export interface ProjectExecution {
  project: LoadedProject;
  planPath: string;
  planSha256: string;
  planRecordSha256: string;
  manifest: ProductionManifest;
  provenance: Record<string, unknown>;
  music?: ResolvedMusic;
}

const planRecordSchema = z.strictObject({
  version: z.literal("1"),
  bindingSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.string().max(1024),
  createdAt: z.string(),
  direction: z.record(z.string(), z.unknown()),
  humanReview: z.literal("pending"),
});
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const binding = (project: LoadedProject) => sha256(JSON.stringify({ title: project.config.title, input: project.config.input, direction: project.config.direction }));
const sourceName = (project: LoadedProject) => project.config.input.source ?? project.config.input.manifest!;

export async function readBoundedJson(path: string, limit: number): Promise<{ value: unknown; sha256: string }> {
  const file = await openRegularFile(path);
  try {
    const before = await file.stat();
    if (before.size > limit) throw new Error(`JSON input exceeds ${limit} bytes: ${path}`);
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > limit) throw new Error(`JSON input exceeds ${limit} bytes: ${path}`);
    const after = await file.stat();
    if (before.size !== length || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error(`JSON input changed while reading: ${path}`);
    const content = bytes.subarray(0, length);
    return { value: JSON.parse(content.toString("utf8")), sha256: sha256(content) };
  } finally { await file.close(); }
}

export async function createPlan(project: LoadedProject, output: string, cacheDir: string): Promise<void> {
  const source = await resolveProjectFile(project.root, sourceName(project), project.config.input.source ? 512 * 1024 : MAX_MANIFEST_BYTES);
  let manifest: ProductionManifest;
  let direction: Record<string, unknown> = { method: "prepared-manifest", warnings: [] };
  if (project.config.input.source) {
    const document = await loadDocument(source.path, { projectRoot: project.root });
    if (document.sha256 !== source.sha256) throw new Error("Project source changed during planning");
    const result = await directDocument(document, {
      mode: project.config.direction.mode, audience: project.config.direction.audience,
      style: project.config.direction.style, durationMs: project.config.output.desiredDurationMs, cacheDir,
    });
    manifest = result.manifest;
    const { manifest: _manifest, ...provenance } = result;
    direction = provenance;
  } else {
    manifest = productionManifestSchema.parse(JSON.parse(source.bytes.toString("utf8"))) as ProductionManifest;
  }
  manifest = productionManifestSchema.parse({ ...manifest, title: project.config.title, targetDurationMs: project.config.output.desiredDurationMs }) as ProductionManifest;
  // Resolve only source-approved assets, then copy them into the portable plan.
  const assets = await resolveManifestAssets(manifest, source.path, { projectRoot: project.root });
  await withNewOutput(output, async (staging) => {
    if (assets.length) {
      await mkdir(join(staging, "assets"), { mode: 0o700 });
      for (const asset of assets) {
        const ext = asset.mimeType === "image/png" ? "png" : asset.mimeType === "image/jpeg" ? "jpg" : "webp";
        const assetFile = await resolveProjectFile(dirname(asset.path), basename(asset.path), 8 * 1024 * 1024);
        if (assetFile.sha256 !== asset.sha256) throw new Error("Plan asset changed during planning");
        // Manifest IDs may be Windows device names; never use them as bare filenames.
        const filename = `asset-${asset.id}.${ext}`;
        await writeFile(join(staging, "assets", filename), assetFile.bytes, { mode: 0o600 });
        manifest.assets!.find((item) => item.id === asset.id)!.source = `assets/${filename}`;
      }
    }
    if ((await resolveProjectFile(project.root, sourceName(project), project.config.input.source ? 512 * 1024 : MAX_MANIFEST_BYTES)).sha256 !== source.sha256) throw new Error("Project source changed during planning");
    await writeJson(join(staging, "manifest.json"), manifest);
    await writeJson(join(staging, "plan.json"), {
      version: "1", bindingSha256: binding(project), sourceSha256: source.sha256,
      source: sourceName(project), createdAt: new Date().toISOString(), direction, humanReview: "pending",
    });
  });
  process.stdout.write(`Editable plan ready: ${output}\nReview and edit manifest.json before preview/build. No speech or frames were produced. Human review: pending.\n`);
}

export async function loadPlan(project: LoadedProject, planPath: string): Promise<ProjectExecution> {
  await assertNoLinkedPath(planPath);
  const savedRecord = await readBoundedJson(join(planPath, "plan.json"), 256 * 1024);
  const record = planRecordSchema.parse(savedRecord.value);
  if (record.bindingSha256 !== binding(project)) throw new Error("Project title, input or direction changed; save and review a new plan");
  const source = await resolveProjectFile(project.root, sourceName(project), project.config.input.source ? 512 * 1024 : MAX_MANIFEST_BYTES);
  if (source.sha256 !== record.sourceSha256) throw new Error("Project source changed; save and review a new plan");
  const saved = await readBoundedJson(join(planPath, "manifest.json"), MAX_MANIFEST_BYTES);
  const manifest = productionManifestSchema.parse(saved.value) as ProductionManifest;
  validatePacing(project.config.narration.pacing, manifest);
  // Validate plan assets even for preview; only the explicitly selected plan is read.
  await resolveManifestAssets(manifest, join(planPath, "manifest.json"), { projectRoot: planPath });
  return { project, planPath, manifest, planSha256: saved.sha256, planRecordSha256: savedRecord.sha256, provenance: record };
}

export async function assertProjectUnchanged(execution: ProjectExecution): Promise<void> {
  const latest = await loadProject(execution.project.path);
  if (latest.sha256 !== execution.project.sha256) throw new Error("Project changed during execution; results cannot be marked ready");
  const plan = await loadPlan(latest, execution.planPath);
  if (plan.planSha256 !== execution.planSha256 || plan.planRecordSha256 !== execution.planRecordSha256) throw new Error("Plan changed during execution; results cannot be marked ready");
}

export async function projectCommand(command: string, args: string[], build: (options: CliOptions) => Promise<void>): Promise<void> {
  const allowed = command === "plan" ? ["project", "output", "cache-dir"]
    : command === "preview" ? ["project", "plan", "output", "cache-dir", "passage", "scene"]
      : ["project", "plan", "output", "cache-dir"];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, "");
    const value = args[index + 1];
    if (!args[index]?.startsWith("--") || !key || !allowed.includes(key)) throw new Error(`Unknown ${command} project option ${args[index]}`);
    if (!value || value.startsWith("--") || values.has(key)) throw new Error(`Option --${key} requires one value and cannot be repeated`);
    values.set(key, value);
  }
  if (!values.has("project")) throw new Error(`${command} requires --project <project.json>`);
  const project = await loadProject(values.get("project")!);
  const cacheDir = values.has("cache-dir") ? resolve(values.get("cache-dir")!) : await resolveProjectOutput(project.root, ".explain-to-me/cache");
  const output = values.has("output") ? resolve(values.get("output")!)
    : await resolveProjectOutput(project.root, `${project.config.output.directory}/${command}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  if (command === "plan") { await createPlan(project, output, cacheDir); return; }
  if (!values.has("plan")) throw new Error(`${command} requires --plan <reviewed-plan-directory>; run plan first`);
  const execution = await loadPlan(project, resolve(values.get("plan")!));
  if (command === "preview") {
    if (values.has("scene") && values.has("passage")) throw new Error("Choose --scene or --passage, not both");
    await previewPlan(execution, output, cacheDir, values.get("passage"), values.get("scene"));
    return;
  }
  if (project.config.music) execution.music = await resolveMusic(project.root, project.config.music as MusicConfig);
  await build({
    manifestPath: join(execution.planPath, "manifest.json"), directorMode: project.config.direction.mode,
    audience: project.config.direction.audience, style: project.config.direction.style,
    profile: project.config.output.profile, targetDurationMs: project.config.output.desiredDurationMs,
    outputPath: output, voice: project.config.narration.voice, backend: project.config.narration.backend,
    cacheDir, project: execution,
  });
}

export function selectPreview(manifest: ProductionManifest, origins: Record<string, string>, passage?: string, sceneId?: string): ProductionManifest {
  let count = 0;
  let characters = 0;
  const scenes = manifest.scenes.flatMap((scene) => {
    const narration = scene.narration.filter((chunk) => {
      if ((sceneId && scene.id !== sceneId) || (passage && origins[chunk.id] !== passage)) return false;
      const length = Math.max(chunk.text.length, (chunk.spokenText ?? chunk.text).length);
      if (count === 0 && length > 600) throw new Error("Preview passage exceeds 600 spoken/display characters; split the reviewed passage into shorter chunks first");
      if (count >= 3 || characters + length > 600) return false;
      count += 1; characters += length; return true;
    });
    const ids = new Set(narration.map((chunk) => chunk.id));
    return narration.length ? [{ ...scene, narration, ...(scene.cues ? { cues: scene.cues.filter((cue) => ids.has(cue.chunkId)) } : {}) }] : [];
  });
  if (!count) throw new Error("Preview selector did not match a passage or scene in the saved plan");
  return { ...manifest, scenes };
}

/** Keep the original full scene context and grouping boundaries for connected previews. */
export function selectPreviewContext(full: ProductionManifest, excerpt: ProductionManifest): ProductionManifest {
  const scenes = new Set(excerpt.scenes.map((scene) => scene.id));
  return { ...full, scenes: full.scenes.filter((scene) => scenes.has(scene.id)) };
}

export function extractPreviewPcm(pcm: Buffer, chunks: SynthesizedChunk[], ids: string[]): { pcm: Buffer; chunks: SynthesizedChunk[] } {
  const selected = new Set(ids);
  if (!selected.size || selected.size !== ids.length) throw new Error("Preview IDs must be nonempty and unique");
  const parts: Buffer[] = [];
  const measured: SynthesizedChunk[] = [];
  let offset = 0;
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.samples) || chunk.samples <= 0) throw new Error("Invalid preview context sample count");
    const end = offset + chunk.samples * 2;
    if (end > pcm.length) throw new Error("Preview context exceeds PCM");
    if (selected.has(chunk.id)) {
      parts.push(pcm.subarray(offset, end)); measured.push(chunk);
    }
    offset = end;
  }
  if (offset !== pcm.length || measured.length !== ids.length || measured.some((chunk, index) => chunk.id !== ids[index])) {
    throw new Error("Preview context IDs or PCM coverage do not match the selected excerpt");
  }
  return { pcm: Buffer.concat(parts), chunks: measured };
}

async function previewPlan(execution: ProjectExecution, output: string, cacheDir: string, passage?: string, scene?: string): Promise<void> {
  const { project } = execution;
  const prepared = prepareNarration(execution.manifest, project.config.narration.pronunciations, { preserveReviewedSpeech: true });
  const manifest = selectPreview(prepared.manifest, prepared.originByChunkId, passage, scene);
  const delivery = project.config.narration.delivery;
  const contextManifest = delivery ? selectPreviewContext(prepared.manifest, manifest) : manifest;
  const temp = await mkdtemp(join(tmpdir(), "explain-to-me-preview-"));
  await ensurePrivateDirectory(temp);
  try {
    await withNewOutput(output, async (staging) => {
      const contextSynthesis = await synthesizeNarration({
        manifest: contextManifest, voice: project.config.narration.voice, backend: project.config.narration.backend,
        pacing: project.config.narration.pacing, passageOrigins: prepared.originByChunkId,
        ...(delivery ? { delivery } : {}),
        durationPolicy: "paced", targetDurationMs: project.config.output.desiredDurationMs, workDir: temp, cacheDir,
      });
      const selected = extractPreviewPcm(await readFile(contextSynthesis.pcmPath), contextSynthesis.chunks,
        manifest.scenes.flatMap((item) => item.narration.map((chunk) => chunk.id)));
      const previewPcmPath = join(temp, "preview.pcm");
      await writeFile(previewPcmPath, selected.pcm);
      const synthesis = { ...contextSynthesis, pcmPath: previewPcmPath, chunks: selected.chunks,
        totalSamples: selected.pcm.length / 2, durationMs: selected.pcm.length / 2 / PCM_SAMPLE_RATE * 1_000 };
      await writeWavFromPcm(synthesis.pcmPath, join(staging, "audio.wav"));
      const timeline = buildTimeline(manifest, synthesis.chunks, 24, PCM_SAMPLE_RATE);
      const captions = createSentenceCaptions(manifest, timeline, PCM_SAMPLE_RATE);
      const signal = inspectPcm(await readFile(synthesis.pcmPath));
      if (!signal.clippingPass || !signal.silencePass) throw new Error("Preview narration signal QC failed");
      await writeFile(join(staging, "captions.vtt"), renderWebVtt(captions));
      await writeFile(join(staging, "captions.srt"), renderSrt(captions));
      await writeJson(join(staging, "preview.json"), {
        projectSha256: project.sha256, planSha256: execution.planSha256,
        selection: { passage: passage ?? null, scene: scene ?? null, maximumPreparedChunks: 3, maximumDisplayCharacters: 600 },
        synthesisContext: { sceneIds: contextManifest.scenes.map((item) => item.id), chunks: contextSynthesis.chunks,
          measuredDurationMs: contextSynthesis.durationMs, mode: delivery ? "complete scenes, then measured passage extraction" : "selected passages" },
        narrationPreparation: prepared.stats, originByChunkId: prepared.originByChunkId,
        chunks: manifest.scenes.flatMap((item) => item.narration), pacing: project.config.narration.pacing,
        narration: { backend: synthesis.backend, voice: synthesis.voice, chunks: synthesis.chunks, synthesisWorkCount: synthesis.synthesisWorkCount, measuredDurationMs: synthesis.durationMs, provenance: synthesis.provenance },
        cache: synthesis.cacheStats, timeline, audioSignal: signal, humanReview: "pending",
        durationPolicy: "paced preview excerpt; full-project strict duration is checked only on build", music: "not included in narration preview",
      });
      await assertProjectUnchanged(execution);
    });
  } finally { await rm(temp, { recursive: true, force: true }); }
  process.stdout.write(`Narration preview ready: ${output}\nHuman listen approval: pending.\n`);
}

export async function withNewOutput(output: string, produce: (staging: string) => Promise<void>): Promise<void> {
  const exists = async () => { try { await lstat(output); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } };
  if (await exists()) throw new Error(`Output target already exists; choose a new directory: ${output}`);
  await mkdir(dirname(output), { recursive: true });
  await assertNoLinkedPath(dirname(output));
  const staging = await mkdtemp(join(dirname(output), `.${basename(output)}.staging-`));
  await ensurePrivateDirectory(staging);
  try {
    await produce(staging);
    if (await exists()) throw new Error(`Output target appeared; refusing to replace: ${output}`);
    await rename(staging, output);
  } catch (error) {
    await writeJson(join(staging, "failure.json"), { error: String(error) }).catch(() => undefined);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nFailure diagnostics retained at ${staging}`, { cause: error });
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
