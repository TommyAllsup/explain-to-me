import { createHash } from "node:crypto";
import { z } from "zod";

export type SceneKind = "title" | "statement" | "diagram" | "comparison" | "code" | "outro" | "bullets" | "image";

export interface NarrationChunk {
  id: string;
  text: string;
  spokenText?: string;
}

export interface LocalAssetIntent {
  id: string;
  source: string;
  sha256: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  provenance?: AssetProvenance;
}

/** Declared reproducibility metadata; it does not certify an asset's authenticity. */
export interface AssetProvenance {
  character: string;
  origin: "gallery" | "generated" | "manual";
  sourceUrl?: string;
  prompt?: string;
  identityText?: string;
  identitySha256?: string;
  canonUrl?: string;
  canonRetrievedAt?: string;
  credit: string;
  aiGenerated: boolean;
}

export interface VisualNode {
  id: string;
  label: string;
}

export interface Cue {
  chunkId: string;
  tokenIndex: number;
  action: "highlight";
  target: string;
  timingFallback: "sentence-start";
}

export interface Scene {
  id: string;
  kind: SceneKind;
  title: string;
  narration: NarrationChunk[];
  visual: {
    subtitle?: string;
    lines?: string[];
    nodes?: VisualNode[];
    edges?: { from: string; to: string }[];
    left?: { title: string; lines: string[] };
    right?: { title: string; lines: string[] };
    code?: string;
    assetId?: string;
    presenter?: { assetId: string };
  };
  cues?: Cue[];
}

export interface ProductionManifest {
  version: "1";
  title: string;
  profile: "preview";
  targetDurationMs: number;
  theme: "technical-whiteboard";
  scenes: Scene[];
  assets?: LocalAssetIntent[];
}

export const MAX_MANIFEST_BYTES = 128 * 1024;
export const MAX_TOTAL_NARRATION_WORDS = 3_000;
export const MANIFEST_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const boundedId = z.string().min(1).max(64).regex(MANIFEST_ID_PATTERN);
const shortText = z.string().min(1).max(180);
const lineList = z.array(z.string().min(1).max(240)).min(1).max(12);
const sha256Digest = z.string().regex(/^[a-f0-9]{64}$/);
const provenanceUrl = z.string().max(2_048).url().regex(/^https?:\/\//iu, "Provenance URLs must use HTTP or HTTPS");
const provenanceText = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => value.trim().length > 0, "Provenance text must not be blank");

export const assetProvenanceSchema = z.strictObject({
  character: provenanceText(80),
  origin: z.enum(["gallery", "generated", "manual"]),
  sourceUrl: provenanceUrl.optional(),
  prompt: provenanceText(6_000).optional(),
  identityText: provenanceText(2_000).optional(),
  identitySha256: sha256Digest.optional(),
  canonUrl: provenanceUrl.optional(),
  canonRetrievedAt: z.iso.date().optional(),
  credit: provenanceText(180),
  aiGenerated: z.boolean(),
}).superRefine((provenance, ctx) => {
  if (provenance.origin === "generated" && provenance.prompt === undefined) {
    ctx.addIssue({ code: "custom", path: ["prompt"], message: "Generated assets require their declared prompt" });
  }
  if ((provenance.identityText === undefined) !== (provenance.identitySha256 === undefined)) {
    ctx.addIssue({ code: "custom", path: [provenance.identityText === undefined ? "identityText" : "identitySha256"], message: "Identity text and its SHA-256 digest must be supplied together" });
  } else if (provenance.identityText !== undefined && provenance.identitySha256 !== createHash("sha256").update(provenance.identityText, "utf8").digest("hex")) {
    ctx.addIssue({ code: "custom", path: ["identitySha256"], message: "Identity SHA-256 must match the exact identity text" });
  }
});

const narrationChunkSchema = z.strictObject({
  id: boundedId,
  text: z.string().min(1).max(1_600),
  spokenText: z.string().min(1).max(1_600).optional(),
});

const visualNodeSchema = z.strictObject({ id: boundedId, label: shortText });
const edgeSchema = z.strictObject({ from: boundedId, to: boundedId });

const visualSchema = z.strictObject({
  subtitle: z.string().min(1).max(180).optional(),
  lines: z.array(z.string().min(1).max(240)).max(12).optional(),
  nodes: z.array(visualNodeSchema).max(32).optional(),
  edges: z.array(edgeSchema).max(64).optional(),
  left: z.strictObject({ title: shortText, lines: lineList }).optional(),
  right: z.strictObject({ title: shortText, lines: lineList }).optional(),
  code: z.string().min(1).max(2_400).optional(),
  assetId: boundedId.optional(),
  presenter: z.strictObject({ assetId: boundedId }).optional(),
});

const cueSchema = z.strictObject({
  chunkId: boundedId,
  tokenIndex: z.number().int().min(0).max(1_000),
  action: z.literal("highlight"),
  target: boundedId,
  timingFallback: z.literal("sentence-start"),
});

const sceneSchema = z.strictObject({
  id: boundedId,
  kind: z.enum(["title", "statement", "diagram", "comparison", "code", "outro", "bullets", "image"]),
  title: shortText,
  narration: z.array(narrationChunkSchema).min(1).max(32),
  visual: visualSchema,
  cues: z.array(cueSchema).max(64).optional(),
});

export const localAssetSchema = z.strictObject({
  id: boundedId,
  source: z.string().min(1).max(512).refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.split("/").includes(".."), "Asset source must be a bounded relative local path without traversal"),
  sha256: sha256Digest,
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  provenance: assetProvenanceSchema.optional(),
});

const productionManifestStructureSchema = z.strictObject({
  version: z.literal("1"),
  title: z.string().min(1).max(120),
  profile: z.literal("preview"),
  targetDurationMs: z.number().int().min(10_000).max(600_000),
  theme: z.literal("technical-whiteboard"),
  scenes: z.array(sceneSchema).min(3).max(16),
  assets: z.array(localAssetSchema).max(8).optional(),
});

export const productionManifestSchema = productionManifestStructureSchema.superRefine((manifest, ctx) => {
  const sceneIds = new Set<string>();
  const chunkIds = new Set<string>();
  let narrationWords = 0;
  let narrationCharacters = 0;
  const assetIds = new Set<string>();
  const assetsById = new Map((manifest.assets ?? []).map((asset) => [asset.id, asset]));
  for (const [assetIndex, asset] of (manifest.assets ?? []).entries()) {
    if (assetIds.has(asset.id)) ctx.addIssue({ code: "custom", path: ["assets", assetIndex, "id"], message: "Duplicate asset id" });
    assetIds.add(asset.id);
  }

  for (const [sceneIndex, scene] of manifest.scenes.entries()) {
    if (sceneIds.has(scene.id)) {
      ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "id"], message: `Duplicate scene id: ${scene.id}` });
    }
    sceneIds.add(scene.id);

    if (scene.kind === "diagram" && (scene.visual.nodes?.length ?? 0) < 2) {
      ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "visual", "nodes"], message: "Diagram scenes require at least two visual nodes" });
    }
    if (scene.kind === "comparison" && (!scene.visual.left || !scene.visual.right)) {
      ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "visual"], message: "Comparison scenes require both left and right panels" });
    }
    if (scene.kind === "code" && !scene.visual.code) {
      ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "visual", "code"], message: "Code scenes require a code card" });
    }

    if (scene.kind === "bullets" && !(scene.visual.lines?.length)) {
      ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "visual"], message: "Bullet scenes require lines" });
    }
    if (scene.kind === "image" && (!scene.visual.assetId || !assetIds.has(scene.visual.assetId))) {
      ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "visual", "assetId"], message: "Image scenes require an approved asset id" });
    }
    if (scene.kind !== "image" && scene.visual.assetId !== undefined) {
      ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "visual", "assetId"], message: "Asset references are allowed only on image scenes" });
    }
    if (scene.visual.presenter) {
      const presenterPath = ["scenes", sceneIndex, "visual", "presenter"];
      if (!["title", "statement", "bullets", "outro"].includes(scene.kind)) {
        ctx.addIssue({ code: "custom", path: presenterPath, message: "Presenters are supported only on title, statement, bullets, and outro scenes" });
      }
      const presenterAsset = assetsById.get(scene.visual.presenter.assetId);
      if (!presenterAsset) {
        ctx.addIssue({ code: "custom", path: [...presenterPath, "assetId"], message: "Presenters require an approved asset id" });
      } else if (!presenterAsset.provenance) {
        ctx.addIssue({ code: "custom", path: [...presenterPath, "assetId"], message: "Presenter assets require provenance with a credit" });
      }
    }
    const localChunks = new Map<string, string>();
    for (const [chunkIndex, chunk] of scene.narration.entries()) {
      if (chunkIds.has(chunk.id)) {
        ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "narration", chunkIndex, "id"], message: `Duplicate narration chunk id: ${chunk.id}` });
      }
      chunkIds.add(chunk.id);
      localChunks.set(chunk.id, chunk.text);
      const tokens = normalizeTokens(chunk.text);
      if (tokens.length === 0) {
        ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "narration", chunkIndex, "text"], message: "Narration text must contain at least one non-whitespace token" });
      }
      narrationWords += tokens.length;
      narrationCharacters += chunk.text.length;
    }

    const nodeIds = new Set<string>();
    for (const [nodeIndex, node] of (scene.visual.nodes ?? []).entries()) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "visual", "nodes", nodeIndex, "id"], message: `Duplicate visual node id: ${node.id}` });
      }
      nodeIds.add(node.id);
    }

    const edgesSeen = new Set<string>();
    for (const [edgeIndex, edge] of (scene.visual.edges ?? []).entries()) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "visual", "edges", edgeIndex], message: `Edge references missing node ${!nodeIds.has(edge.from) ? edge.from : edge.to}` });
      }
      const key = `${edge.from}\u0000${edge.to}`;
      if (edgesSeen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "visual", "edges", edgeIndex], message: "Duplicate visual edge" });
      }
      edgesSeen.add(key);
    }

    for (const [cueIndex, cue] of (scene.cues ?? []).entries()) {
      const text = localChunks.get(cue.chunkId);
      if (!text) {
        ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "cues", cueIndex, "chunkId"], message: `Cue references missing chunk ${cue.chunkId}` });
      } else if (cue.tokenIndex >= normalizeTokens(text).length) {
        ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "cues", cueIndex, "tokenIndex"], message: `Cue token index ${cue.tokenIndex} is outside its narration chunk` });
      }
      if (!nodeIds.has(cue.target)) {
        ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "cues", cueIndex, "target"], message: `Cue references missing visual node ${cue.target}` });
      }
    }
  }

  if (chunkIds.size > 128) ctx.addIssue({ code: "custom", path: ["scenes"], message: "Narration is limited to 128 audio chunks" });
  if (narrationWords > MAX_TOTAL_NARRATION_WORDS) {
    ctx.addIssue({ code: "custom", path: ["scenes"], message: `Narration is limited to ${MAX_TOTAL_NARRATION_WORDS} normalized words` });
  }
  if (narrationCharacters > 24_000) {
    ctx.addIssue({ code: "custom", path: ["scenes"], message: "Narration is limited to 24,000 total characters" });
  }
  if (Buffer.byteLength(JSON.stringify(manifest), "utf8") > MAX_MANIFEST_BYTES) {
    ctx.addIssue({ code: "custom", message: `Manifest exceeds ${MAX_MANIFEST_BYTES} bytes` });
  }
});

export const productionManifestJsonSchema = {
  ...z.toJSONSchema(productionManifestStructureSchema),
  $comment: "Cross-field checks for duplicate identifiers, scene-kind requirements, approved image/presenter references, presenter provenance, generated-asset prompts, paired identity text and matching SHA-256 digest, cue chunk/token references, cue targets, and edge endpoints are enforced by productionManifestSchema at runtime. Asset provenance records declarations, not verified authenticity.",
};

export function normalizeTokens(text: string): string[] {
  const trimmed = text.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/u);
}

export function formatManifestIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "manifest" : issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
}
