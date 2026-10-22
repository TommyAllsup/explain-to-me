import { z } from "zod";
import { MANIFEST_ID_PATTERN } from "./production-manifest.js";

export const MAX_PROJECT_BYTES = 64 * 1024;
export const MIN_PROJECT_PACE = 0.65;
export const MAX_PROJECT_PACE = 1.25;

/** Portable paths are relative to the saved project's directory, on every host. */
export function isProjectRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 512 || value.startsWith("/") || value.includes("\\")
    || /[\u0000-\u001f<>:"|?*]/u.test(value)) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== ".."
    && !/[. ]$/u.test(part)
    && !/^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part));
}

const localPath = z.string().min(1).max(512).refine(isProjectRelativePath,
  "Use a project-relative local path with forward slashes, without traversal or Windows device/alias names");
const boundedText = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0, "Text must not be blank");
const pace = z.number().min(MIN_PROJECT_PACE).max(MAX_PROJECT_PACE);
const id = z.string().regex(MANIFEST_ID_PATTERN);
const pacingStructure = z.strictObject({
  default: pace.default(1),
  scenes: z.record(id, pace).default({}),
  passages: z.record(id, pace).default({}),
});

const inputStructure = z.strictObject({
  source: localPath.refine((value) => /\.(?:md|txt)$/iu.test(value), "Source must be Markdown (.md) or plain text (.txt)").optional(),
  manifest: localPath.refine((value) => /\.json$/iu.test(value), "Manifest must be a JSON file").optional(),
});

const projectStructure = z.strictObject({
  version: z.literal("1"),
  title: boundedText(120),
  input: inputStructure,
  direction: z.strictObject({
    mode: z.enum(["auto", "template", "local"]).default("auto"),
    audience: boundedText(240).default("software engineers"),
    style: boundedText(240).default("friendly technical whiteboard"),
  }).prefault({}),
  narration: z.strictObject({
    backend: z.enum(["auto", "apple", "kokoro"]).default("auto"),
    voice: boundedText(120).default("auto"),
    pronunciations: z.record(boundedText(80), boundedText(160)).default({}),
    pacing: pacingStructure.prefault({}),
    delivery: z.strictObject({
      mode: z.literal("connected"),
      sentencePauseMs: z.number().int().min(0).max(1_000).default(250),
      clausePauseMs: z.number().int().min(0).max(500).default(100),
    }).optional(),
  }).prefault({}),
  music: z.strictObject({
    source: localPath,
    gainDb: z.number().min(-60).max(0).default(-24),
    duckingDb: z.number().min(-30).max(0).default(-8),
    fadeInMs: z.number().int().min(0).max(10_000).default(1_000),
    fadeOutMs: z.number().int().min(0).max(10_000).default(1_000),
    rights: z.strictObject({
      holder: boundedText(240).optional(),
      license: boundedText(512).optional(),
      note: boundedText(2_000).optional(),
    }).optional(),
  }).optional(),
  output: z.strictObject({
    profile: z.literal("preview").default("preview"),
    directory: localPath.default("outputs"),
    desiredDurationMs: z.number().int().min(10_000).max(600_000).default(60_000),
    durationPolicy: z.enum(["paced", "strict"]).default("paced"),
  }).prefault({}),
});

export const projectSchema = projectStructure.superRefine((project, ctx) => {
  if (project.narration.delivery && project.narration.backend === "apple") {
    ctx.addIssue({ code: "custom", path: ["narration", "delivery"], message: "Connected delivery requires Kokoro" });
  }
  if ((project.input.source === undefined) === (project.input.manifest === undefined)) {
    ctx.addIssue({ code: "custom", path: ["input"], message: "Specify exactly one source or manifest" });
  }
  if (Object.keys(project.narration.pacing.scenes).length > 16) {
    ctx.addIssue({ code: "custom", path: ["narration", "pacing", "scenes"], message: "At most 16 scene pacing overrides are supported" });
  }
  if (Object.keys(project.narration.pacing.passages).length > 128) {
    ctx.addIssue({ code: "custom", path: ["narration", "pacing", "passages"], message: "At most 128 passage pacing overrides are supported" });
  }
  const pronunciations = Object.entries(project.narration.pronunciations);
  if (pronunciations.length > 64 || pronunciations.reduce((size, [term, spoken]) => size + term.length + spoken.length, 0) > 4_096) {
    ctx.addIssue({ code: "custom", path: ["narration", "pronunciations"], message: "Pronunciations are limited to 64 entries and 4,096 combined characters" });
  }
  const normalizedTerms = pronunciations.map(([term]) => term.toLocaleLowerCase("en"));
  if (new Set(normalizedTerms).size !== normalizedTerms.length) {
    ctx.addIssue({ code: "custom", path: ["narration", "pronunciations"], message: "Pronunciation terms must be unique ignoring case" });
  }
  if (Buffer.byteLength(JSON.stringify(project), "utf8") > MAX_PROJECT_BYTES) {
    ctx.addIssue({ code: "custom", message: `Project exceeds ${MAX_PROJECT_BYTES} bytes` });
  }
});

export type ProjectConfig = z.infer<typeof projectSchema>;
export type ProjectPacing = ProjectConfig["narration"]["pacing"];
export type ProjectMusic = NonNullable<ProjectConfig["music"]>;

export const projectJsonSchema = {
  ...z.toJSONSchema(projectStructure, { io: "input" }),
  $comment: "Runtime validation additionally enforces exactly one input, portable bounded relative paths, nonblank text, pronunciation uniqueness/combined limits, pacing override counts, and total serialized bytes. Passage keys identify original reviewed-manifest narration chunks before preparation.",
};

export function formatProjectIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.length === 0 ? "project" : issue.path.join(".")}: ${issue.message}`);
}
