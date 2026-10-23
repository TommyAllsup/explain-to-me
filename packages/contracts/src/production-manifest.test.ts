import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { productionManifestJsonSchema, productionManifestSchema, type AssetProvenance, type ProductionManifest } from "./production-manifest.js";

const fixturePath = fileURLToPath(new URL("../../../fixtures/golden-manifests/whisper-vs-tts.json", import.meta.url));

test("golden manifest is bounded and accepts all required scene kinds", async () => {
  const input: unknown = JSON.parse(await readFile(fixturePath, "utf8"));
  const result = productionManifestSchema.safeParse(input);
  assert.equal(result.success, true);
  if (result.success) assert.deepEqual(new Set(result.data.scenes.map((scene) => scene.kind)), new Set(["title", "statement", "diagram", "comparison", "code", "outro"]));
});

test("manifest rejects unknown properties and dangling cue references", async () => {
  const base = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
  const unknownProperty = productionManifestSchema.safeParse({ ...base, externalAsset: "https://example.invalid/file.png" });
  assert.equal(unknownProperty.success, false);

  const scenes = base.scenes as Array<Record<string, unknown>>;
  const diagram = scenes[2]!;
  diagram.cues = [{ chunkId: "missing-chunk", tokenIndex: 0, action: "highlight", target: "audio-input", timingFallback: "sentence-start" }];
  const danglingCue = productionManifestSchema.safeParse(base);
  assert.equal(danglingCue.success, false);
});

function declaredProvenance(): AssetProvenance {
  const identityText = "Exact character identity, including punctuation and a café.";
  return {
    character: "Claudia",
    origin: "generated",
    prompt: `${identityText} Teaching a local-first workflow; no text, no letters, no logos`,
    identityText,
    identitySha256: createHash("sha256").update(identityText, "utf8").digest("hex"),
    sourceUrl: "https://example.invalid/plates/1",
    canonUrl: "https://example.invalid/canon.json",
    canonRetrievedAt: "2026-10-22",
    credit: "Claudia by anabology",
    aiGenerated: true,
  };
}

async function presenterManifest(): Promise<ProductionManifest> {
  const manifest = JSON.parse(await readFile(fixturePath, "utf8")) as ProductionManifest;
  manifest.assets = [{ id: "presenter-1", source: "assets/plate.png", sha256: "a".repeat(64), mimeType: "image/png", provenance: declaredProvenance() }];
  manifest.scenes[0]!.visual.presenter = { assetId: "presenter-1" };
  return manifest;
}

test("presenter references preserve exact declared provenance on supported scene kinds", async () => {
  for (const kind of ["title", "statement", "bullets", "outro"] as const) {
    const manifest = await presenterManifest();
    manifest.scenes[0]!.kind = kind;
    if (kind === "bullets") manifest.scenes[0]!.visual.lines = ["Explain locally"];
    const parsed = productionManifestSchema.parse(manifest);
    assert.deepEqual(parsed.assets?.[0]?.provenance, declaredProvenance());
    assert.deepEqual(parsed.scenes[0]?.visual.presenter, { assetId: "presenter-1" });
  }
});

test("presenters require approved assets with credit-bearing provenance", async () => {
  const unknownAsset = await presenterManifest();
  unknownAsset.scenes[0]!.visual.presenter = { assetId: "missing-plate" };
  const missingReference = productionManifestSchema.safeParse(unknownAsset);
  assert.equal(missingReference.success, false);
  if (!missingReference.success) assert.ok(missingReference.error.issues.some((issue) => issue.message.includes("approved asset id")));

  const missingProvenance = await presenterManifest();
  delete missingProvenance.assets![0]!.provenance;
  assert.equal(productionManifestSchema.safeParse(missingProvenance).success, false);

  const missingCredit = await presenterManifest();
  missingCredit.assets![0]!.provenance!.credit = "  ";
  assert.equal(productionManifestSchema.safeParse(missingCredit).success, false);
});

test("presenters are rejected on diagram, comparison, code, and image scenes", async () => {
  for (const kind of ["diagram", "comparison", "code", "image"] as const) {
    const manifest = await presenterManifest();
    delete manifest.scenes[0]!.visual.presenter;
    if (kind === "image") {
      manifest.scenes[0]!.kind = "image";
      manifest.scenes[0]!.visual.assetId = "presenter-1";
    }
    const scene = manifest.scenes.find((candidate) => candidate.kind === kind)!;
    scene.visual.presenter = { assetId: "presenter-1" };
    const result = productionManifestSchema.safeParse(manifest);
    assert.equal(result.success, false, kind);
    if (!result.success) assert.ok(result.error.issues.some((issue) => issue.message.includes("Presenters are supported only")), kind);
  }
});

test("provenance requires paired identity text and a matching digest without normalizing text", async () => {
  for (const missing of ["identityText", "identitySha256"] as const) {
    const manifest = await presenterManifest();
    delete manifest.assets![0]!.provenance![missing];
    assert.equal(productionManifestSchema.safeParse(manifest).success, false, missing);
  }
  const changedText = await presenterManifest();
  changedText.assets![0]!.provenance!.identityText += " ";
  assert.equal(productionManifestSchema.safeParse(changedText).success, false);

  const malformedDigest = await presenterManifest();
  malformedDigest.assets![0]!.provenance!.identitySha256 = "not-a-sha256";
  assert.equal(productionManifestSchema.safeParse(malformedDigest).success, false);

  const noIdentity = await presenterManifest();
  delete noIdentity.assets![0]!.provenance!.identityText;
  delete noIdentity.assets![0]!.provenance!.identitySha256;
  assert.equal(productionManifestSchema.safeParse(noIdentity).success, true);
});

test("generated provenance requires a prompt while gallery and manual declarations do not", async () => {
  const manifest = await presenterManifest();
  delete manifest.assets![0]!.provenance!.prompt;
  assert.equal(productionManifestSchema.safeParse(manifest).success, false);
  for (const origin of ["gallery", "manual"] as const) {
    manifest.assets![0]!.provenance!.origin = origin;
    assert.equal(productionManifestSchema.safeParse(manifest).success, true);
  }
});

test("provenance rejects unsupported URLs, invalid dates, oversized fields, and unknown properties", async () => {
  const invalidFields = [
    { sourceUrl: "file:///private/plate.png" },
    { canonUrl: "javascript:alert(1)" },
    { sourceUrl: "https://example.invalid/" + "a".repeat(2_048) },
    { canonRetrievedAt: "2026-02-30" },
    { character: "a".repeat(81) },
    { prompt: "a".repeat(6_001) },
    { identityText: "a".repeat(2_001) },
    { credit: "a".repeat(181) },
    { aiGenerated: "yes" },
    { verifiedAuthentic: true },
  ];
  for (const fields of invalidFields) {
    const manifest = await presenterManifest();
    const provenance = { ...declaredProvenance(), ...fields };
    const input = { ...manifest, assets: [{ ...manifest.assets![0]!, provenance }] };
    assert.equal(productionManifestSchema.safeParse(input).success, false, JSON.stringify(fields));
  }
});

test("ordinary image scenes remain valid without character provenance", async () => {
  const manifest = await presenterManifest();
  delete manifest.assets![0]!.provenance;
  manifest.scenes[0]!.kind = "image";
  manifest.scenes[0]!.visual = { assetId: "presenter-1" };
  assert.equal(productionManifestSchema.safeParse(manifest).success, true);
});

test("published JSON schema matches the runtime structure", async () => {
  const schemaPath = fileURLToPath(new URL("../schema/production-manifest.schema.json", import.meta.url));
  const actual = JSON.parse(await readFile(schemaPath, "utf8")) as unknown;
  assert.deepEqual(actual, productionManifestJsonSchema);
});

test("bundled animated Claudia needs no image asset and preserves motion intent", async () => {
  const manifest = JSON.parse(await readFile(fixturePath, "utf8")) as ProductionManifest;
  for (const kind of ["title", "statement", "bullets", "outro"] as const) {
    manifest.scenes[0]!.kind = kind;
    manifest.scenes[0]!.visual = { lines: ["Keep the reviewed explanation"], presenter: { character: "claudia", motion: "reduced" } };
    const parsed = productionManifestSchema.parse(manifest);
    assert.deepEqual(parsed.scenes[0]!.visual.presenter, { character: "claudia", motion: "reduced" });
  }
});

test("animated presenters reject mixed still intent, unknown rigs, invalid motion, and incompatible scenes", async () => {
  const manifest = JSON.parse(await readFile(fixturePath, "utf8")) as ProductionManifest;
  for (const presenter of [
    { character: "claudia", assetId: "unexpected" },
    { character: "someone-else" },
    { character: "claudia", motion: "extreme" },
    { character: "claudia", modelPath: "local.pt" },
  ]) {
    const input = structuredClone(manifest);
    Object.assign(input.scenes[0]!.visual, { presenter });
    assert.equal(productionManifestSchema.safeParse(input).success, false);
  }
  for (const kind of ["diagram", "comparison", "code"] as const) {
    const input = structuredClone(manifest);
    input.scenes.find((scene) => scene.kind === kind)!.visual.presenter = { character: "claudia" };
    assert.equal(productionManifestSchema.safeParse(input).success, false, kind);
  }
});
