import assert from "node:assert/strict";
import test from "node:test";
import type { AssetProvenance, LocalAssetIntent, Scene } from "../../../packages/contracts/src/production-manifest.js";
import { getPresenterLayout, resolvePresenterAsset } from "./video.js";

const provenance: AssetProvenance = {
  character: "Claudia",
  origin: "gallery",
  credit: "Claudia character by the Claudia project contributors",
  aiGenerated: true,
};

const asset: LocalAssetIntent = {
  id: "claudia",
  source: "assets/claudia.png",
  sha256: "a".repeat(64),
  mimeType: "image/png",
  provenance,
};

function scene(kind: Scene["kind"] = "title"): Scene {
  return {
    id: "presenter-intro",
    kind,
    title: "Meet your local presenter",
    narration: [{ id: "intro", text: "A reviewed character image can introduce the lesson." }],
    visual: { subtitle: "A reviewed image, rendered locally", lines: ["Local image assets", "Visible credit and disclosure"], presenter: { assetId: "claudia" } },
  };
}

test("presenters resolve only a staged local asset with the matching approved provenance", () => {
  assert.deepEqual(resolvePresenterAsset(scene(), asset, { claudia: "asset-01.png" }), { fileName: "asset-01.png", provenance });
  assert.throws(() => resolvePresenterAsset(scene(), undefined, { claudia: "asset-01.png" }), /requires approved asset provenance/);
  assert.throws(() => resolvePresenterAsset(scene(), { ...asset, id: "other" }, { claudia: "asset-01.png" }), /requires approved asset provenance/);
  const { provenance: _provenance, ...uncreditedAsset } = asset;
  assert.throws(() => resolvePresenterAsset(scene(), uncreditedAsset, { claudia: "asset-01.png" }), /requires approved asset provenance/);
  for (const fileName of [undefined, "https://example.test/face.png", "../face.png", "asset-01.svg"]) {
    assert.throws(() => resolvePresenterAsset(scene(), asset, fileName ? { claudia: fileName } : {}), /missing its staged local image/);
  }
  assert.throws(() => resolvePresenterAsset(scene("diagram"), asset, { claudia: "asset-01.png" }), /supported only/);
});

test("existing scenes without a presenter do not require presenter assets or provenance", () => {
  const original = scene("diagram");
  delete original.visual.presenter;
  assert.equal(resolvePresenterAsset(original, undefined, {}), undefined);
});

test("all four presenter layouts reserve separate image, readable text, and caption regions", () => {
  for (const kind of ["title", "statement", "bullets", "outro"] as const) {
    for (const [width, height] of [[1280, 720], [1920, 1080]]) {
      const layout = getPresenterLayout(scene(kind), provenance, width!, height!);
      assert.ok(layout.left + layout.contentWidth + 48 <= layout.panelLeft);
      assert.ok(layout.panelLeft + layout.panelWidth <= width! - 92);
      assert.ok(layout.bottom < height! - 105, "presenter stays above progress rule and caption lane");
      assert.ok(layout.bodySize >= 22);
      assert.ok(layout.titleSize >= 32);
      assert.ok(layout.creditSize >= 16);
      assert.ok(layout.imageHeight >= 120);
    }
  }
});

test("presenter layout fails visibly instead of shrinking dense content or attribution away", () => {
  const dense = scene("bullets");
  dense.visual.lines = Array.from({ length: 12 }, () => "Dense supporting text ".repeat(11));
  assert.throws(() => getPresenterLayout(dense, provenance, 1280, 720), /supporting text does not fit.*Shorten/);
  assert.throws(() => getPresenterLayout(scene(), provenance, 640, 360), /at least 960/);
  const largeCredit = { ...provenance, credit: "Attribution ".repeat(15) };
  const layout = getPresenterLayout(scene(), largeCredit, 1280, 720);
  assert.ok(layout.creditHeight > 100, "long credits reserve multiple lines, rather than truncate");
  assert.ok(layout.imageHeight >= 120);
});

