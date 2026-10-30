import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertNoLinkedPath, assertSupportedFilePath, openRegularFile } from "../../assets/src/file-safety.js";

export interface SourceBlock {
  id: string;
  kind: "heading" | "paragraph" | "list" | "code" | "image";
  text: string;
  startLine: number;
  endLine: number;
  heading?: string;
  lines?: string[];
  language?: string;
  assetId?: string;
}

export interface ResolvedAsset {
  id: string;
  source: string;
  path: string;
  sha256: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  alt: string;
}

export interface SourceDocument {
  sourcePath: string;
  root: string;
  sha256: string;
  title: string;
  blocks: SourceBlock[];
  assets: ResolvedAsset[];
  warnings: string[];
}

export interface LoadDocumentOptions {
  projectRoot?: string;
  /** Saved projects constrain every resolved image to their canonical root. */
  restrictToProjectRoot?: boolean;
}

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGES = 8;
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/gu;
const LIST_PATTERN = /^\s{0,3}(?:[-+*]|\d+[.)])\s+/u;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

interface Line {
  text: string;
  start: number;
  end: number;
  lineNumber: number;
}

interface ParsedImage {
  lineIndex: number;
  start: number;
  alt: string;
  source: string;
}

export async function loadDocument(inputPath: string, options: LoadDocumentOptions = {}): Promise<SourceDocument> {
  if (typeof inputPath !== "string" || inputPath.length === 0) throw new Error("Input path is required");
  assertSupportedFilePath(inputPath);
  const requestedPath = resolve(inputPath);
  if (process.platform === "win32") await assertNoLinkedPath(requestedPath);
  const sourcePath = await realpath(requestedPath);
  const extension = extname(sourcePath).toLowerCase();
  if (extension !== ".md" && extension !== ".txt") throw new Error("Input must be a regular .md or .txt file");
  const sourceBytes = await readBoundedRegularFile(sourcePath, MAX_SOURCE_BYTES, "Source file");
  const source = sourceBytes.toString("utf8");
  if (source.includes("\u0000")) throw new Error("Source file contains a NUL byte");

  const sourceDirectory = await realpath(join(sourcePath, ".."));
  const projectAssets = await optionalAssetsRoot(options.projectRoot ?? process.cwd());
  const roots = options.restrictToProjectRoot
    ? [await realpath(options.projectRoot ?? process.cwd())]
    : [sourceDirectory, ...(projectAssets ? [projectAssets] : [])];
  const lines = sourceLines(source);
  const warnings: string[] = [];
  const parsedImages = extension === ".md" ? collectImages(lines) : [];
  const assetsBySource = new Map<string, ResolvedAsset>();
  const assetsByLineAndStart = new Map<string, ResolvedAsset>();
  let totalImageBytes = 0;

  for (const image of parsedImages) {
    const existing = assetsBySource.get(image.source);
    let asset = existing;
    if (!asset) {
      if (assetsBySource.size >= MAX_IMAGES) throw new Error(`Markdown may reference at most ${MAX_IMAGES} distinct images`);
      const resolved = await resolveImage(image.source, sourceDirectory, roots);
      const bytes = await readBoundedRegularFile(resolved.path, MAX_IMAGE_BYTES, `Image ${image.source}`);
      totalImageBytes += bytes.length;
      if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error(`Referenced images exceed ${MAX_TOTAL_IMAGE_BYTES} total bytes`);
      const mimeType = imageMimeType(bytes);
      if (!mimeType) throw new Error(`Unsupported image content for ${image.source}; only PNG, JPEG, and WebP are allowed`);
      const id = `asset-${assetsBySource.size + 1}`;
      asset = {
        id,
        source: image.source,
        path: resolved.path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mimeType,
        sizeBytes: bytes.length,
        alt: cleanMarkdownText(image.alt),
      };
      assetsBySource.set(image.source, asset);
    }
    assetsByLineAndStart.set(`${image.lineIndex}:${image.start}`, asset);
  }

  const parsed = parseBlocks(lines, source, assetsByLineAndStart, warnings);
  const fallbackTitle = basename(sourcePath, extname(sourcePath));
  const title = parsed.blocks.find((block) => block.kind === "heading" && block.text.trim().length > 0)?.text
    ?? fallbackTitle;

  return {
    sourcePath,
    root: sourceDirectory,
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    title: boundedTitle(title),
    blocks: parsed.blocks,
    assets: [...assetsBySource.values()],
    warnings: [...new Set(warnings)],
  };
}

/** Resolve and verify asset references in an explicitly supplied prepared manifest. */
export async function resolveManifestAssets(
  manifest: { assets?: Array<{ id: string; source: string; sha256: string; mimeType: string }> },
  inputFile: string,
  options: LoadDocumentOptions = {},
): Promise<ResolvedAsset[]> {
  assertSupportedFilePath(inputFile);
  if (process.platform === "win32") await assertNoLinkedPath(resolve(inputFile));
  const inputPath = await realpath(resolve(inputFile));
  if (!(await stat(inputPath)).isFile()) throw new Error("Prepared manifest input must be a regular file");
  const sourceDirectory = await realpath(join(inputPath, ".."));
  const projectAssets = await optionalAssetsRoot(options.projectRoot ?? process.cwd());
  const roots = options.restrictToProjectRoot
    ? [await realpath(options.projectRoot ?? process.cwd())]
    : [sourceDirectory, ...(projectAssets ? [projectAssets] : [])];
  const entries = manifest.assets ?? [];
  if (entries.length > MAX_IMAGES) throw new Error(`Manifest may reference at most ${MAX_IMAGES} assets`);
  const seenIds = new Set<string>();
  const seenSources = new Set<string>();
  const assets: ResolvedAsset[] = [];
  let totalBytes = 0;

  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || typeof entry.source !== "string" || typeof entry.sha256 !== "string") {
      throw new Error("Manifest asset entries must contain id, source, and sha256 strings");
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(entry.id)) throw new Error("Manifest asset id is invalid");
    if (seenIds.has(entry.id)) throw new Error(`Duplicate manifest asset id: ${entry.id}`);
    seenIds.add(entry.id);
    if (seenSources.has(entry.source)) throw new Error(`Duplicate manifest asset source: ${entry.source}`);
    seenSources.add(entry.source);
    if (!/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error(`Manifest asset ${entry.id} has an invalid SHA-256 digest`);

    const resolved = await resolveManifestImage(entry.source, sourceDirectory, projectAssets, roots);
    const bytes = await readBoundedRegularFile(resolved.path, MAX_IMAGE_BYTES, `Image ${entry.source}`);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error(`Referenced images exceed ${MAX_TOTAL_IMAGE_BYTES} total bytes`);
    const mimeType = imageMimeType(bytes);
    if (!mimeType) throw new Error(`Unsupported image content for ${entry.source}; only PNG, JPEG, and WebP are allowed`);
    if (entry.mimeType !== mimeType) throw new Error(`Manifest asset ${entry.id} MIME type does not match its file content`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (entry.sha256 !== sha256) throw new Error(`Manifest asset ${entry.id} SHA-256 does not match its file content`);
    assets.push({ id: entry.id, source: entry.source, path: resolved.path, sha256, mimeType, sizeBytes: bytes.length, alt: "" });
  }
  return assets;
}

async function resolveImage(source: string, sourceDirectory: string, roots: string[]): Promise<{ path: string }> {
  if (source.length === 0 || source.length > 512 || source.includes("\u0000")) throw new Error("Image paths must be non-empty local paths of at most 512 characters");
  if (source.includes("\\")) throw new Error(`Image path contains a forbidden backslash: ${source}`);
  if (source.split("/").includes("..")) throw new Error(`Image path contains a forbidden .. segment: ${source}`);
  if (isAbsolute(source) || /^[a-z][a-z0-9+.-]*:/iu.test(source) || source.startsWith("//")) {
    throw new Error(`Image path must be relative and local: ${source}`);
  }

  const candidate = resolve(sourceDirectory, source);
  assertSupportedFilePath(candidate);
  if (process.platform === "win32") await assertNoLinkedPath(candidate);
  const canonical = await realpath(candidate);
  const fileStats = await stat(canonical);
  if (!fileStats.isFile()) throw new Error(`Image reference is not a regular file: ${source}`);
  if (!roots.some((root) => isWithin(root, canonical))) throw new Error(`Image resolves outside the approved local roots: ${source}`);
  return { path: canonical };
}

async function resolveManifestImage(
  source: string,
  sourceDirectory: string,
  projectAssets: string | undefined,
  roots: string[],
): Promise<{ path: string }> {
  try {
    return await resolveImage(source, sourceDirectory, roots);
  } catch (error) {
    const code = errorCode(error);
    if (!projectAssets || (code !== "ENOENT" && code !== "ENOTDIR")) throw error;
    return resolveImage(source, projectAssets, roots);
  }
}

async function optionalAssetsRoot(projectRoot: string): Promise<string | undefined> {
  assertSupportedFilePath(projectRoot);
  const candidate = resolve(projectRoot, "assets");
  try {
    if (process.platform === "win32") await assertNoLinkedPath(candidate);
    const canonical = await realpath(candidate);
    const fileStats = await stat(canonical);
    return fileStats.isDirectory() ? canonical : undefined;
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return undefined;
    throw error;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

async function readBoundedRegularFile(path: string, maxBytes: number, label: string): Promise<Buffer> {
  const handle = await openRegularFile(path);
  try {
    const fileStats = await handle.stat();
    if (!fileStats.isFile()) throw new Error(`${label} must be a regular file`);
    if (fileStats.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
    const chunks: Buffer[] = [];
    let total = 0;
    let position = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(32 * 1024, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
      chunks.push(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function sourceLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  let lineNumber = 1;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline + 1;
    const raw = source.slice(start, newline === -1 ? source.length : newline);
    lines.push({ text: raw.endsWith("\r") ? raw.slice(0, -1) : raw, start, end, lineNumber });
    start = end;
    lineNumber += 1;
  }
  if (source.length === 0 || source.endsWith("\n")) {
    lines.push({ text: "", start: source.length, end: source.length, lineNumber });
  }
  return lines;
}

function maskInlineCode(source: string): string {
  const output: string[] = [];
  let pending = "";
  let fence: { marker: string; length: number } | undefined;
  const flush = () => { output.push(maskInlineCodeBlock(pending)); pending = ""; };
  for (const line of sourceLines(source)) {
    const raw = source.slice(line.start, line.end);
    const fenceMatch = FENCE_PATTERN.exec(line.text);
    if (fenceMatch) {
      flush();
      const marker = fenceMatch[1]!;
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length && !fenceMatch[2]!.trim()) fence = undefined;
      output.push(raw);
      continue;
    }
    if (fence) { output.push(raw); continue; }
    if (!line.text.trim() || /^ {0,3}#{1,6}\s/u.test(line.text)) {
      flush(); output.push(maskInlineCodeBlock(raw)); continue;
    }
    if (LIST_PATTERN.test(line.text)) flush();
    pending += raw;
  }
  flush();
  return output.join("");
}

function maskInlineCodeBlock(source: string): string {
  const runs = [...source.matchAll(/`+/gu)];
  const nextRun = new Map<number, number>();
  const closingIndexes: Array<number | undefined> = [];
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const length = runs[index]![0].length;
    closingIndexes[index] = nextRun.get(length);
    nextRun.set(length, index);
  }
  const pieces: string[] = [];
  let cursor = 0;
  for (const [index, run] of runs.entries()) {
    const start = run.index;
    if (start < cursor) continue;
    let backslashes = 0;
    for (let previous = start - 1; previous >= 0 && source[previous] === "\\"; previous -= 1) backslashes += 1;
    if (backslashes % 2) continue;
    const closingIndex = closingIndexes[index];
    if (closingIndex === undefined) continue;
    const closing = runs[closingIndex]!;
    const end = closing.index + closing[0].length;
    pieces.push(source.slice(cursor, start), source.slice(start, end).replace(/[^\r\n]/g, " "));
    cursor = end;
  }
  return pieces.join("") + source.slice(cursor);
}

function collectImages(lines: Line[]): ParsedImage[] {
  const images: ParsedImage[] = [];
  const imageLines = sourceLines(maskInlineCode(lines.map((line) => line.text).join("\n")));
  let fence: { marker: string; length: number } | undefined;
  let inertHtmlTag: string | undefined;
  for (const [lineIndex, line] of lines.entries()) {
    const fenceMatch = FENCE_PATTERN.exec(line.text);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!fence) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length && fenceMatch[2]!.trim().length === 0) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (inertHtmlTag) {
      if (new RegExp("</" + inertHtmlTag + "\\s*>", "iu").test(line.text)) inertHtmlTag = undefined;
      continue;
    }
    const activeElement = /<(script|style|iframe|object|embed|svg|math)\b[^>]*>/iu.exec(line.text);
    if (activeElement) {
      const tagName = activeElement[1]!.toLowerCase();
      if (!new RegExp("</" + tagName + "\\s*>", "iu").test(line.text.slice(activeElement.index + activeElement[0].length))) {
        inertHtmlTag = tagName;
      }
      continue;
    }
    images.push(...imagesOnLine(lineIndex, line.text, imageLines[lineIndex]?.text ?? ""));
  }
  return images;
}

function parseBlocks(
  lines: Line[],
  source: string,
  assetsByLineAndStart: Map<string, ResolvedAsset>,
  warnings: string[],
): { blocks: SourceBlock[] } {
  const blocks: SourceBlock[] = [];
  const imageLines = sourceLines(maskInlineCode(source));
  let currentHeading: string | undefined;
  let fence: { marker: string; length: number; language: string; startIndex: number; contentStart: number } | undefined;
  let paragraph: { startIndex: number; raw: string[]; images: ParsedImage[] } | undefined;
  let list: { startIndex: number; raw: string[]; clean: string[] } | undefined;

  const flushParagraph = (endIndex: number) => {
    if (!paragraph) return;
    const text = cleanMarkdownText(paragraph.raw.join("\n")).trim();
    if (text) addBlock(blocks, { kind: "paragraph", text, startLine: lines[paragraph.startIndex]!.lineNumber, endLine: lines[endIndex]!.lineNumber, ...(currentHeading ? { heading: currentHeading } : {}) });
    for (const image of paragraph.images) {
      const asset = assetsByLineAndStart.get(`${image.lineIndex}:${image.start}`);
      if (!asset) continue;
      const line = lines[image.lineIndex]!;
      addBlock(blocks, {
        kind: "image",
        text: cleanMarkdownText(image.alt) || "Image",
        startLine: line.lineNumber,
        endLine: line.lineNumber,
        ...(currentHeading ? { heading: currentHeading } : {}),
        assetId: asset.id,
      });
    }
    paragraph = undefined;
  };
  const flushList = (endIndex: number) => {
    if (!list) return;
    const linesText = list.clean.map((part) => part.trim()).filter((part) => part.length > 0);
    if (linesText.length > 0) addBlock(blocks, {
      kind: "list",
      text: linesText.join("\n"),
      lines: linesText,
      startLine: lines[list.startIndex]!.lineNumber,
      endLine: lines[endIndex]!.lineNumber,
      ...(currentHeading ? { heading: currentHeading } : {}),
    });
    list = undefined;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenceMatch = FENCE_PATTERN.exec(line.text);
    if (fence) {
      const closes = fenceMatch
        && fenceMatch[1]![0] === fence.marker
        && fenceMatch[1]!.length >= fence.length
        && fenceMatch[2]!.trim().length === 0;
      if (closes) {
        const rawCode = source.slice(fence.contentStart, line.start);
        const language = fence.language || undefined;
        addBlock(blocks, {
          kind: "code",
          text: rawCode,
          lines: rawCode.split(/\r?\n/u),
          startLine: lines[fence.startIndex]!.lineNumber,
          endLine: line.lineNumber,
          ...(currentHeading ? { heading: currentHeading } : {}),
          ...(language ? { language } : {}),
        });
        fence = undefined;
      }
      continue;
    }
    if (fenceMatch) {
      flushParagraph(Math.max(0, index - 1));
      flushList(Math.max(0, index - 1));
      const marker = fenceMatch[1]!;
      fence = {
        marker: marker[0]!,
        length: marker.length,
        language: fenceMatch[2]!.trim().split(/\s+/u)[0] ?? "",
        startIndex: index,
        contentStart: line.end,
      };
      continue;
    }

    const headingMatch = /^( {0,3})(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line.text);
    if (headingMatch) {
      flushParagraph(Math.max(0, index - 1));
      flushList(Math.max(0, index - 1));
      const text = cleanMarkdownText(headingMatch[3]!);
      currentHeading = text;
      addBlock(blocks, { kind: "heading", text, startLine: line.lineNumber, endLine: line.lineNumber });
      continue;
    }

    if (line.text.trim().length === 0) {
      flushParagraph(Math.max(0, index - 1));
      flushList(Math.max(0, index - 1));
      continue;
    }

    const images = imagesOnLine(index, line.text, imageLines[index]?.text ?? "");
    if (LIST_PATTERN.test(line.text)) {
      flushParagraph(Math.max(0, index - 1));
      if (!list) list = { startIndex: index, raw: [], clean: [] };
      list.raw.push(line.text);
      list.clean.push(cleanMarkdownText(removeImageSyntax(line.text.replace(LIST_PATTERN, ""))));
      for (const image of images) {
        // Keep list image references visible to the resolver and as distinct visual blocks.
        const asset = assetsByLineAndStart.get(`${image.lineIndex}:${image.start}`);
        if (asset) addBlock(blocks, { kind: "image", text: cleanMarkdownText(image.alt) || "Image", startLine: line.lineNumber, endLine: line.lineNumber, ...(currentHeading ? { heading: currentHeading } : {}), assetId: asset.id });
      }
      continue;
    }
    flushList(Math.max(0, index - 1));
    if (!paragraph) paragraph = { startIndex: index, raw: [], images: [] };
    paragraph.raw.push(removeImageSyntax(line.text));
    paragraph.images.push(...images);
  }

  if (fence) {
    const rawCode = source.slice(fence.contentStart);
    warnings.push(`Unclosed code fence beginning on line ${lines[fence.startIndex]!.lineNumber} was retained as code`);
    addBlock(blocks, {
      kind: "code",
      text: rawCode,
      lines: rawCode.split(/\r?\n/u),
      startLine: lines[fence.startIndex]!.lineNumber,
      endLine: lines.at(-1)!.lineNumber,
      ...(currentHeading ? { heading: currentHeading } : {}),
      ...(fence.language ? { language: fence.language } : {}),
    });
  }
  flushParagraph(lines.length - 1);
  flushList(lines.length - 1);
  return { blocks };
}

function imagesOnLine(lineIndex: number, text: string, imageText: string): ParsedImage[] {
  const images: ParsedImage[] = [];
  IMAGE_PATTERN.lastIndex = 0;
  for (const match of imageText.matchAll(IMAGE_PATTERN)) {
    const start = match.index;
    const original = new RegExp(IMAGE_PATTERN.source, "u").exec(text.slice(start, start + match[0].length));
    if (original) images.push({ lineIndex, start, alt: original[1]!, source: original[2]! });
  }
  return images;
}

function removeImageSyntax(text: string): string {
  IMAGE_PATTERN.lastIndex = 0;
  return text.replace(IMAGE_PATTERN, " ");
}

function cleanMarkdownText(text: string): string {
  let result = text;
  // HTML is treated as inert text. Drop active element contents as well as tags.
  result = result.replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, " ");
  result = result.replace(/<!--([\s\S]*?)-->/gu, " ");
  result = result.replace(/<[^>]*>/gu, " ");
  result = result.replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1");
  result = result.replace(/`([^`]+)`/gu, "$1");
  result = result.replace(/(?:\*\*|__)(.*?)(?:\*\*|__)/gu, "$1");
  result = result.replace(/(?:\*|_)([^*_]+)(?:\*|_)/gu, "$1");
  result = result.replace(/\s+/gu, " ").trim();
  return result;
}

function addBlock(blocks: SourceBlock[], block: Omit<SourceBlock, "id">): void {
  blocks.push({ id: `block-${blocks.length + 1}`, ...block });
}

function imageMimeType(bytes: Buffer): ResolvedAsset["mimeType"] | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

function boundedTitle(title: string): string {
  const normalized = cleanMarkdownText(title).slice(0, 120).trim();
  return normalized || "Untitled document";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
