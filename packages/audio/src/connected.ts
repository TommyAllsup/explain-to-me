import { createHash } from "node:crypto";
import type { NarrationChunk, ProductionManifest } from "../../contracts/src/production-manifest.js";
import { MAX_PACE, MIN_PACE } from "./pacing.js";

export interface ConnectedDelivery {
  mode: "connected";
  sentencePauseMs: number;
  clausePauseMs: number;
}

export interface ConnectedGroup {
  id: string;
  chunks: NarrationChunk[];
  speed: number;
}

export interface ConnectedPassageTiming {
  id: string;
  samples: number;
}

export interface ConnectedAudio {
  pcm: Buffer;
  passages: ConnectedPassageTiming[];
}

export const CONNECTED_GROUPING_POLICY = "contiguous-scene-and-pace-1600-characters-v1";
export const CONNECTED_CACHE_NAMESPACE = "kokoro-connected-pcm-v1";
const MAX_GROUP_CHARS = 1_600;
const SAMPLE_RATE = 24_000;
const ENVELOPE_MAGIC = Buffer.from("ETMCONN1", "ascii");
const MAX_METADATA_BYTES = 64 * 1024;

/** Preserve scene context without crossing explicit pace changes or bridge bounds. */
export function buildConnectedGroups(manifest: ProductionManifest, paceByChunkId: Record<string, number>): ConnectedGroup[] {
  const groups: ConnectedGroup[] = [];
  const ids = new Set<string>();
  for (const scene of manifest.scenes) {
    let pending: NarrationChunk[] = [];
    let characters = 0;
    let speed = 1;
    const flush = () => {
      if (pending.length === 0) return;
      const digest = createHash("sha256").update(JSON.stringify([scene.id, pending.map((chunk) => chunk.id)])).digest("hex");
      groups.push({ id: `connected-${digest.slice(0, 24)}`, chunks: pending, speed });
      pending = [];
      characters = 0;
    };
    for (const chunk of scene.narration) {
      if (ids.has(chunk.id)) throw new Error(`Duplicate connected narration passage: ${chunk.id}`);
      ids.add(chunk.id);
      const text = connectedSpokenText(chunk);
      if (!text.trim() || text.length > MAX_GROUP_CHARS) throw new Error(`Connected passage ${chunk.id} must contain 1 to ${MAX_GROUP_CHARS} spoken characters`);
      const pace = Object.hasOwn(paceByChunkId, chunk.id) ? paceByChunkId[chunk.id]! : 1;
      validateSpeed(pace);
      if (pending.length && (pace !== speed || characters + 1 + text.length > MAX_GROUP_CHARS)) flush();
      speed = pace;
      characters += (pending.length ? 1 : 0) + text.length;
      pending.push(chunk);
    }
    flush();
  }
  return groups;
}

export function validateConnectedDelivery(delivery: ConnectedDelivery): void {
  if (!isRecord(delivery) || delivery.mode !== "connected"
    || !Number.isInteger(delivery.sentencePauseMs) || delivery.sentencePauseMs < 0 || delivery.sentencePauseMs > 1_000
    || !Number.isInteger(delivery.clausePauseMs) || delivery.clausePauseMs < 0 || delivery.clausePauseMs > 500) {
    throw new Error("Connected delivery requires sentencePauseMs 0–1000 and clausePauseMs 0–500 as whole milliseconds");
  }
}

/** The same ordered passages must cover the request once, including pronunciation text. */
export function validateConnectedGroups(
  groups: ConnectedGroup[], chunks: NarrationChunk[], paceByChunkId: Record<string, number>, defaultPace: number,
): void {
  if (!groups.length || groups.length > 128) throw new Error("Connected narration requires 1 to 128 groups");
  const ids = new Set<string>();
  let position = 0;
  for (const group of groups) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(group.id) || ids.has(group.id)) throw new Error("Connected narration requires unique, bounded group IDs");
    ids.add(group.id);
    validateSpeed(group.speed);
    if (!group.chunks.length || group.chunks.length > 128 || connectedGroupText(group).length > MAX_GROUP_CHARS) throw new Error(`Invalid connected group size: ${group.id}`);
    for (const chunk of group.chunks) {
      const expected = chunks[position++];
      const pace = Object.hasOwn(paceByChunkId, chunk.id) ? paceByChunkId[chunk.id] : defaultPace;
      if (!expected || chunk.id !== expected.id || connectedSpokenText(chunk) !== connectedSpokenText(expected) || group.speed !== pace) {
        throw new Error("Connected groups must cover the narration in order at its explicit pacing");
      }
    }
  }
  if (position !== chunks.length) throw new Error("Connected groups must cover every narration passage exactly once");
}

/** Includes ordered context, boundary policy, pauses, and all caller-supplied audio identities. */
export function connectedCacheInput(group: ConnectedGroup, delivery: ConnectedDelivery, voice: string, identity: Record<string, unknown>): Record<string, unknown> {
  return {
    backend: "kokoro", ...identity, voice, sampleRate: SAMPLE_RATE, speed: group.speed,
    groupingPolicy: CONNECTED_GROUPING_POLICY,
    delivery: { mode: delivery.mode, sentencePauseMs: delivery.sentencePauseMs, clausePauseMs: delivery.clausePauseMs },
    passages: group.chunks.map((chunk) => ({ id: chunk.id, text: connectedSpokenText(chunk) })),
  };
}

export function connectedSpokenText(chunk: NarrationChunk): string {
  return chunk.spokenText ?? chunk.text;
}

export function connectedGroupText(group: ConnectedGroup): string {
  return group.chunks.map(connectedSpokenText).join(" ");
}

/** The bridge accepts one speed and at most 24,000 joined characters per call. */
export function connectedSynthesisBatches(groups: ConnectedGroup[]): ConnectedGroup[][] {
  const batches: ConnectedGroup[][] = [];
  for (const speed of new Set(groups.map((group) => group.speed))) {
    let batch: ConnectedGroup[] = [];
    let characters = 0;
    for (const group of groups.filter((item) => item.speed === speed)) {
      const length = connectedGroupText(group).length;
      if (batch.length && characters + length > 24_000) {
        batches.push(batch);
        batch = [];
        characters = 0;
      }
      batch.push(group);
      characters += length;
    }
    if (batch.length) batches.push(batch);
  }
  return batches;
}

/** One cache value owns both contiguous PCM and the exact measured passage boundaries. */
export function encodeConnectedAudio(audio: ConnectedAudio, expectedIds: string[]): Buffer {
  const passages = validatePassageTimings(audio.passages, expectedIds, audio.pcm.length / 2);
  if (audio.pcm.length < 2 || audio.pcm.length % 2) throw new Error("Connected audio must contain signed 16-bit PCM");
  const metadata = Buffer.from(JSON.stringify({ version: 1, sampleRate: SAMPLE_RATE, samples: audio.pcm.length / 2, passages }));
  if (metadata.length > MAX_METADATA_BYTES) throw new Error("Connected audio metadata exceeds its bound");
  const header = Buffer.alloc(ENVELOPE_MAGIC.length + 4);
  ENVELOPE_MAGIC.copy(header);
  header.writeUInt32LE(metadata.length, ENVELOPE_MAGIC.length);
  return Buffer.concat([header, metadata, audio.pcm]);
}

export function decodeConnectedAudio(envelope: Buffer, expectedIds: string[]): ConnectedAudio {
  const headerSize = ENVELOPE_MAGIC.length + 4;
  if (envelope.length < headerSize || !envelope.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) throw new Error("Invalid connected audio envelope");
  const metadataBytes = envelope.readUInt32LE(ENVELOPE_MAGIC.length);
  const pcmOffset = headerSize + metadataBytes;
  if (metadataBytes < 1 || metadataBytes > MAX_METADATA_BYTES || pcmOffset >= envelope.length) throw new Error("Invalid connected audio metadata length");
  let metadata: unknown;
  try { metadata = JSON.parse(envelope.toString("utf8", headerSize, pcmOffset)); }
  catch { throw new Error("Invalid connected audio metadata JSON"); }
  const pcm = envelope.subarray(pcmOffset);
  if (!isRecord(metadata) || !exactKeys(metadata, ["version", "sampleRate", "samples", "passages"])
    || metadata.version !== 1 || metadata.sampleRate !== SAMPLE_RATE || metadata.samples !== pcm.length / 2 || pcm.length % 2) {
    throw new Error("Invalid connected audio PCM metadata");
  }
  return { pcm, passages: validatePassageTimings(metadata.passages, expectedIds, metadata.samples as number) };
}

export function validatePassageTimings(value: unknown, expectedIds: string[], totalSamples: number): ConnectedPassageTiming[] {
  if (!Number.isSafeInteger(totalSamples) || totalSamples < 1 || !Array.isArray(value) || value.length !== expectedIds.length || value.length === 0
    || new Set(expectedIds).size !== expectedIds.length) throw new Error("Invalid connected passage timing coverage");
  let sum = 0;
  const passages = value.map((item: unknown, index) => {
    if (!isRecord(item) || !exactKeys(item, ["id", "samples"]) || item.id !== expectedIds[index]
      || !Number.isSafeInteger(item.samples) || (item.samples as number) < 1) throw new Error("Invalid connected passage timing or order");
    sum += item.samples as number;
    return { id: item.id as string, samples: item.samples as number };
  });
  if (!Number.isSafeInteger(sum) || sum !== totalSamples) throw new Error("Connected passage samples must exactly cover the group PCM");
  return passages;
}

function validateSpeed(speed: number): void {
  if (!Number.isFinite(speed) || speed < MIN_PACE || speed > MAX_PACE) throw new Error(`Connected pace must be between ${MIN_PACE} and ${MAX_PACE}`);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
