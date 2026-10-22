import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeTokens, productionManifestSchema, type ProductionManifest } from "../../contracts/src/production-manifest.js";
import { prepareNarration } from "./prepare-narration.js";

const fixturePath = fileURLToPath(new URL("../../../fixtures/golden-manifests/whisper-vs-tts.json", import.meta.url));

test("prepares sentence and phrase chunks, literal pronunciations, and cue-relative token indexes", async () => {
  const input: unknown = JSON.parse(await readFile(fixturePath, "utf8"));
  const draft = productionManifestSchema.parse(input) as ProductionManifest;
  const text = `JSON comes first, ${"steady phrasing ".repeat(17)}and API stays whole. The C# sample [[rate 400]] keeps JSONish unchanged.`;
  const tokenCount = normalizeTokens(text).length;
  const diagramScene = draft.scenes.find((scene) => scene.id === "scene-directions")!;
  diagramScene.narration = [{ id: "chunk-directions", text }];
  diagramScene.cues = [
    { chunkId: "chunk-directions", tokenIndex: 0, action: "highlight", target: "audio-input", timingFallback: "sentence-start" },
    { chunkId: "chunk-directions", tokenIndex: tokenCount - 1, action: "highlight", target: "text-input", timingFallback: "sentence-start" },
  ];
  const manifest = productionManifestSchema.parse(draft) as ProductionManifest;
  const pronunciations = { JSON: "jay son", API: "A P I", "C#": "C sharp" };

  const prepared = prepareNarration(manifest, pronunciations);
  const preparedScene = prepared.manifest.scenes.find((scene) => scene.id === "scene-directions")!;
  assert.ok(preparedScene.narration.length >= 3);
  assert.ok(preparedScene.narration.every((chunk) => chunk.text.length <= 240));
  assert.ok(preparedScene.narration.every((chunk) => chunk.id.length <= 64));
  assert.ok(preparedScene.narration.some((chunk) => chunk.spokenText?.includes("jay son")));
  assert.ok(preparedScene.narration.some((chunk) => chunk.spokenText?.includes("A P I")));
  const finalSpeech = preparedScene.narration.at(-1)!.spokenText!;
  assert.ok(finalSpeech.includes("C sharp"));
  assert.ok(finalSpeech.includes("JSONish"));
  assert.doesNotMatch(finalSpeech, /\[\[|\]\]/u);
  assert.equal(prepared.stats.originalChunks, manifest.scenes.reduce((count, scene) => count + scene.narration.length, 0));
  assert.ok((prepared.stats.normalizedChunks ?? 0) >= 3);
  assert.equal(prepared.stats.remappedCues, 2);
  assert.equal(prepared.warnings.length, 1);

  const firstCue = preparedScene.cues!.find((cue) => cue.target === "audio-input")!;
  const lastCue = preparedScene.cues!.find((cue) => cue.target === "text-input")!;
  assert.equal(firstCue.chunkId, preparedScene.narration[0]!.id);
  assert.equal(firstCue.tokenIndex, 0);
  assert.equal(lastCue.chunkId, preparedScene.narration.at(-1)!.id);
  assert.equal(lastCue.tokenIndex, normalizeTokens(preparedScene.narration.at(-1)!.text).length - 1);

  const preparedAgain = prepareNarration(prepared.manifest, pronunciations);
  assert.deepEqual(
    preparedAgain.manifest.scenes.find((scene) => scene.id === "scene-directions")!.narration.map((chunk) => chunk.id),
    preparedScene.narration.map((chunk) => chunk.id),
  );
});

test("project preparation preserves edited spoken text while applying chosen pronunciations", async () => {
  const manifest = productionManifestSchema.parse(JSON.parse(await readFile(fixturePath, "utf8"))) as ProductionManifest;
  const scene = manifest.scenes[0]!;
  scene.narration = [{
    id: "reviewed-speech",
    text: "The display has two sentences. Captions stay reviewed too.",
    spokenText: "The approved spoken explanation uses JSON and different sentence boundaries.",
  }];
  const prepared = prepareNarration(manifest, { JSON: "jay son" }, { preserveReviewedSpeech: true });
  const narration = prepared.manifest.scenes[0]!.narration;
  assert.equal(narration.length, 1);
  assert.equal(narration[0]!.id, "reviewed-speech");
  assert.equal(narration[0]!.text, scene.narration[0]!.text);
  assert.equal(narration[0]!.spokenText, "The approved spoken explanation uses jay son and different sentence boundaries.");
  assert.equal(prepared.originByChunkId["reviewed-speech"], "reviewed-speech");
  const legacy = prepareNarration(manifest, { JSON: "jay son" });
  assert.equal(legacy.manifest.scenes[0]!.narration.length, 2);
});
