import { createHash } from "node:crypto";
import type { Cue, NarrationChunk, ProductionManifest } from "../../contracts/src/production-manifest.js";
import { normalizeTokens } from "../../contracts/src/production-manifest.js";

const MAX_AUDIO_CHUNK_CHARS = 240;
const MAX_CHUNKS_PER_SCENE = 32;
const MAX_TOTAL_CHUNKS = 128;
const MAX_PRONUNCIATION_ENTRIES = 64;
const MAX_PRONUNCIATION_TERM_CHARS = 80;
const MAX_PRONUNCIATION_TEXT_CHARS = 160;
const MAX_PRONUNCIATION_CONFIG_CHARS = 4_096;
const MAX_TOTAL_SPOKEN_CHARS = 24_000;

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

interface PreparedPart {
  id: string;
  text: string;
  tokenStart: number;
  tokenEnd: number;
}

interface PronunciationRule {
  term: string;
  pronunciation: string;
}

interface PronunciationMatcher {
  rules: PronunciationRule[];
  pattern?: RegExp;
}

export interface PreparedNarration {
  manifest: ProductionManifest;
  /** Prepared chunk IDs retain their original reviewed passage identity after splitting. */
  originByChunkId: Record<string, string>;
  stats: Record<string, number>;
  warnings: string[];
}

export interface NarrationPreparationOptions {
  /** Keep reviewed speech in its original passage; display/speech boundaries may differ. */
  preserveReviewedSpeech?: boolean;
}

export function prepareNarration(
  manifest: ProductionManifest,
  pronunciationMap?: Record<string, string>,
  options: NarrationPreparationOptions = {},
): PreparedNarration {
  const matcher = createPronunciationMatcher(pronunciationMap);
  const originalIds = new Set(manifest.scenes.flatMap((scene) => scene.narration.map((chunk) => chunk.id)));
  const allocatedIds = new Set(originalIds);
  const warnings: string[] = [];
  const originByChunkId: Record<string, string> = {};
  const warningSet = new Set<string>();
  let originalChunks = 0;
  let normalizedChunks = 0;
  let splitChunks = 0;
  let pronunciationChanges = 0;
  let remappedCues = 0;
  let totalSpokenChars = 0;

  const scenes = manifest.scenes.map((scene) => {
    const locationsByOriginalId = new Map<string, PreparedPart[]>();
    const narration: NarrationChunk[] = [];

    for (const chunk of scene.narration) {
      originalChunks += 1;
      const retainReviewedSpeech = options.preserveReviewedSpeech && chunk.spokenText !== undefined;
      const displayParts = retainReviewedSpeech ? [chunk.text] : splitDisplayText(chunk.text);
      if (displayParts.length > 1) splitChunks += 1;

      let tokenStart = 0;
      const preparedParts: PreparedPart[] = [];
      for (const [index, text] of displayParts.entries()) {
        const id = displayParts.length === 1
          ? chunk.id
          : deriveChunkId(chunk.id, index + 1, allocatedIds);
        const tokenEnd = tokenStart + normalizeTokens(text).length;
        const speech = prepareSpeechText({
          sourceText: retainReviewedSpeech || (matcher.rules.length === 0 && displayParts.length === 1)
            ? chunk.spokenText ?? text
            : text,
          matcher,
        });
        pronunciationChanges += speech.replacements;
        totalSpokenChars += speech.text.length;
        if (speech.text.length > 1_600) {
          throw new Error(`Prepared narration chunk ${id} exceeds the 1,600 character speech limit`);
        }
        if (speech.neutralizedAppleMarkup) {
          const warning = `Neutralized Apple speech-control brackets in narration chunk ${id}`;
          if (!warningSet.has(warning)) {
            warningSet.add(warning);
            warnings.push(warning);
          }
        }

        const outputChunk: NarrationChunk = { ...chunk, id, text };
        if (speech.text !== text || (chunk.spokenText !== undefined && displayParts.length === 1 && (matcher.rules.length === 0 || retainReviewedSpeech))) {
          outputChunk.spokenText = speech.text;
        } else {
          delete outputChunk.spokenText;
        }
        narration.push(outputChunk);
        originByChunkId[id] = chunk.id;
        preparedParts.push({ id, text, tokenStart, tokenEnd });
        tokenStart = tokenEnd;
      }
      locationsByOriginalId.set(chunk.id, preparedParts);
    }

    if (narration.length > MAX_CHUNKS_PER_SCENE) {
      throw new Error(`Prepared scene ${scene.id} exceeds ${MAX_CHUNKS_PER_SCENE} narration chunks`);
    }
    normalizedChunks += narration.length;

    const cues = scene.cues?.map((cue) => {
      const parts = locationsByOriginalId.get(cue.chunkId);
      if (!parts) throw new Error(`Cue references missing original narration chunk ${cue.chunkId}`);
      const part = parts.find((candidate) => cue.tokenIndex >= candidate.tokenStart && cue.tokenIndex < candidate.tokenEnd);
      if (!part) throw new Error(`Cue token ${cue.tokenIndex} is outside original narration chunk ${cue.chunkId}`);
      const mappedCue: Cue = {
        ...cue,
        chunkId: part.id,
        tokenIndex: cue.tokenIndex - part.tokenStart,
      };
      if (mappedCue.chunkId !== cue.chunkId || mappedCue.tokenIndex !== cue.tokenIndex) remappedCues += 1;
      return mappedCue;
    });

    return { ...scene, narration, ...(cues === undefined ? {} : { cues }) };
  });

  if (normalizedChunks > MAX_TOTAL_CHUNKS) {
    throw new Error(`Prepared narration exceeds ${MAX_TOTAL_CHUNKS} audio chunks`);
  }
  if (totalSpokenChars > MAX_TOTAL_SPOKEN_CHARS) {
    throw new Error(`Prepared narration exceeds ${MAX_TOTAL_SPOKEN_CHARS} total spoken characters`);
  }

  return {
    manifest: { ...manifest, scenes },
    originByChunkId,
    stats: { originalChunks, normalizedChunks, splitChunks, pronunciationChanges, remappedCues },
    warnings,
  };
}

function createPronunciationMatcher(pronunciationMap?: Record<string, string>): PronunciationMatcher {
  if (pronunciationMap === undefined) return { rules: [] };
  if (typeof pronunciationMap !== "object" || pronunciationMap === null || Array.isArray(pronunciationMap)) {
    throw new Error("Pronunciation map must be a plain object of literal terms and speech text");
  }
  const entries = Object.entries(pronunciationMap);
  if (entries.length > MAX_PRONUNCIATION_ENTRIES) {
    throw new Error(`Pronunciation map is limited to ${MAX_PRONUNCIATION_ENTRIES} entries`);
  }
  let configChars = 0;
  const seenTerms = new Set<string>();
  const rules = entries.map(([term, pronunciation]) => {
    if (term.trim().length === 0 || term.length > MAX_PRONUNCIATION_TERM_CHARS) {
      throw new Error(`Pronunciation terms must contain 1 to ${MAX_PRONUNCIATION_TERM_CHARS} characters`);
    }
    if (typeof pronunciation !== "string" || pronunciation.trim().length === 0 || pronunciation.length > MAX_PRONUNCIATION_TEXT_CHARS) {
      throw new Error(`Pronunciation text for ${JSON.stringify(term)} must contain 1 to ${MAX_PRONUNCIATION_TEXT_CHARS} characters`);
    }
    const normalizedTerm = term.toLocaleLowerCase("en");
    if (seenTerms.has(normalizedTerm)) throw new Error(`Pronunciation map contains duplicate case-insensitive term ${JSON.stringify(term)}`);
    seenTerms.add(normalizedTerm);
    configChars += term.length + pronunciation.length;
    return { term, pronunciation };
  });
  if (configChars > MAX_PRONUNCIATION_CONFIG_CHARS) {
    throw new Error(`Pronunciation map is limited to ${MAX_PRONUNCIATION_CONFIG_CHARS} combined characters`);
  }
  rules.sort((left, right) => right.term.length - left.term.length);
  if (rules.length === 0) return { rules };

  const alternatives = rules.map(({ term }) => escapeRegExp(term)).join("|");
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{M}\\p{N}_])`, "giu");
  return { rules, pattern };
}

function splitDisplayText(text: string): string[] {
  const sentences = [...sentenceSegmenter.segment(text)]
    .map(({ segment }) => segment)
    .filter((segment) => segment.trim().length > 0);
  if (sentences.length === 1 && text.length <= MAX_AUDIO_CHUNK_CHARS) return [text];

  return sentences.flatMap((sentence) => splitLongSentence(sentence.trim()));
}

function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= MAX_AUDIO_CHUNK_CHARS) return [sentence];
  const parts: string[] = [];
  let start = 0;

  while (sentence.length - start > MAX_AUDIO_CHUNK_CHARS) {
    const limit = safeCodePointBoundary(sentence, start + MAX_AUDIO_CHUNK_CHARS);
    let cut = findLastClauseBoundary(sentence, start, limit);
    if (cut === undefined) cut = findLastWhitespaceBoundary(sentence, start, limit);
    if (cut === undefined || cut <= start) cut = limit;

    const part = sentence.slice(start, cut).trim();
    if (part.length > 0) parts.push(part);
    start = cut;
    while (start < sentence.length && /\s/u.test(sentence[start]!)) start += 1;
  }

  const last = sentence.slice(start).trim();
  if (last.length > 0) parts.push(last);
  return parts;
}

function findLastClauseBoundary(text: string, start: number, limit: number): number | undefined {
  let last: number | undefined;
  for (let index = start; index < limit; index += 1) {
    const character = text[index]!;
    if ((character === "," || character === ";" || character === ":" || character === "—" || character === "–")
      && (index + 1 === text.length || /\s/u.test(text[index + 1]!))) {
      last = index + 1;
    }
  }
  return last;
}

function findLastWhitespaceBoundary(text: string, start: number, limit: number): number | undefined {
  for (let index = limit - 1; index > start; index -= 1) {
    if (/\s/u.test(text[index]!)) return index;
  }
  return undefined;
}

function safeCodePointBoundary(text: string, boundary: number): number {
  let safe = Math.min(boundary, text.length);
  const previous = text.charCodeAt(safe - 1);
  const next = text.charCodeAt(safe);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) safe -= 1;
  return safe;
}

function deriveChunkId(originalId: string, part: number, allocatedIds: Set<string>): string {
  const hash = createHash("sha256").update(originalId).digest("hex").slice(0, 12);
  const baseSuffix = `-p${part}-${hash}`;
  let collision = 0;
  while (true) {
    const collisionSuffix = collision === 0 ? "" : `-${collision}`;
    const suffix = `${baseSuffix}${collisionSuffix}`;
    const baseLength = Math.max(1, 64 - suffix.length);
    const base = originalId.slice(0, baseLength).replace(/[-_]+$/u, "") || "c";
    const candidate = `${base}${suffix}`;
    if (!allocatedIds.has(candidate)) {
      allocatedIds.add(candidate);
      return candidate;
    }
    collision += 1;
  }
}

function prepareSpeechText(options: {
  sourceText: string;
  matcher: PronunciationMatcher;
}): { text: string; replacements: number; neutralizedAppleMarkup: boolean } {
  let replacements = 0;
  let text = options.sourceText;

  if (options.matcher.pattern) {
    text = text.replace(options.matcher.pattern, (matched) => {
      const rule = options.matcher.rules.find(({ term }) => term.toLocaleLowerCase("en") === matched.toLocaleLowerCase("en"));
      if (!rule) return matched;
      replacements += 1;
      return rule.pronunciation;
    });
  }

  const neutralizedText = text.replace(/\[\[/gu, "[ [").replace(/\]\]/gu, "] ]");
  return {
    text: neutralizedText,
    replacements,
    neutralizedAppleMarkup: neutralizedText !== text,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
