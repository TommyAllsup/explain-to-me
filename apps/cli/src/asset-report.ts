import type { ProductionManifest } from "../../../packages/contracts/src/production-manifest.js";
import type { ResolvedAsset } from "../../../packages/ingest/src/markdown.js";

/** Use this invocation's manifest metadata, including when rendered media is cached. */
export function describeBuildAssets(manifest: ProductionManifest, resolvedAssets: ResolvedAsset[]) {
  return resolvedAssets.map((asset) => {
    const intent = manifest.assets?.find((candidate) => candidate.id === asset.id);
    if (!intent || intent.sha256 !== asset.sha256 || intent.mimeType !== asset.mimeType) {
      throw new Error(`Resolved asset does not match manifest: ${asset.id}`);
    }
    return {
      id: asset.id,
      source: asset.source,
      outputSource: intent.source,
      canonicalPath: asset.path,
      sha256: asset.sha256,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      sceneIds: manifest.scenes.filter((scene) => scene.visual.assetId === asset.id
        || (scene.visual.presenter && "assetId" in scene.visual.presenter && scene.visual.presenter.assetId === asset.id)).map((scene) => scene.id),
      ...(intent.provenance ? { provenance: intent.provenance, provenanceVerification: "declared-not-independently-verified" as const } : {}),
    };
  });
}
