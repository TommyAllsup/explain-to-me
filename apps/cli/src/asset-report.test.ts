import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { productionManifestSchema, type ProductionManifest } from "../../../packages/contracts/src/production-manifest.js";
import { resolveManifestAssets } from "../../../packages/ingest/src/markdown.js";
import { describeBuildAssets } from "./asset-report.js";

test("asset reports preserve current provenance, portable paths, and actual scene usage", async () => {
  const packPath = "fixtures/presenters/claudia/pack.json";
  const pack = JSON.parse(await readFile(packPath, "utf8"));
  const raw = JSON.parse(await readFile("fixtures/golden-manifests/whisper-vs-tts.json", "utf8"));
  raw.assets = [pack.asset];
  raw.scenes[0].visual.presenter = { assetId: pack.asset.id };
  const manifest = productionManifestSchema.parse(raw) as ProductionManifest;
  const resolved = await resolveManifestAssets(manifest, packPath);
  manifest.assets![0]!.source = "assets/claudia.webp";
  const first = describeBuildAssets(manifest, resolved)[0]!;
  assert.equal(first.outputSource, "assets/claudia.webp");
  assert.equal(first.source, "claudia.webp");
  assert.deepEqual(first.sceneIds, [manifest.scenes[0]!.id]);
  assert.deepEqual(first.provenance, pack.asset.provenance);
  assert.equal(first.provenanceVerification, "declared-not-independently-verified");
  // A prior render/cache record must not supply stale metadata to a new report.
  const revised = structuredClone(manifest);
  revised.assets![0]!.provenance!.credit = "Revised attribution";
  assert.equal(describeBuildAssets(revised, resolved)[0]!.provenance!.credit, "Revised attribution");
  revised.assets![0]!.sha256 = "0".repeat(64);
  assert.throws(() => describeBuildAssets(revised, resolved), /does not match manifest/);
});
