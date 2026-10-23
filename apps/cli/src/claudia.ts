import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProductionManifest } from "../../../packages/contracts/src/production-manifest.js";

export type NarrationBackend = "auto" | "apple" | "kokoro" | "chatterbox";
const supportedKinds = new Set(["title", "statement", "bullets", "outro"]);

export function hasAnimatedClaudia(manifest: ProductionManifest): boolean {
  return manifest.scenes.some((scene) => scene.visual.presenter && "character" in scene.visual.presenter);
}

/** An explicit CLI selection becomes portable reviewed visual intent. */
export function applyClaudiaPresenter(manifest: ProductionManifest): ProductionManifest {
  if (!manifest.scenes.some((scene) => supportedKinds.has(scene.kind))) {
    throw new Error("Claudia needs a title, statement, bullets, or outro scene.");
  }
  return { ...manifest, scenes: manifest.scenes.map((scene) => {
    if (!supportedKinds.has(scene.kind)) return scene;
    if (scene.visual.presenter && "assetId" in scene.visual.presenter) {
      throw new Error(`Scene ${scene.id} already has a still presenter; remove it before selecting animated Claudia.`);
    }
    return { ...scene, visual: { ...scene.visual, presenter: scene.visual.presenter ?? { character: "claudia" as const } } };
  }) };
}

export function selectBuildNarration(backend: NarrationBackend, voice: string, animated: boolean) {
  if (animated && backend !== "auto" && backend !== "chatterbox") {
    throw new Error("Animated Claudia requires --tts chatterbox (or auto) with her selected Bella reference.");
  }
  const selected = animated && backend === "auto" ? "chatterbox" : backend;
  if (selected === "chatterbox" && voice !== "auto" && voice !== "chatterbox-bella") {
    throw new Error("Chatterbox supports Claudia's selected voice only: --voice chatterbox-bella (or auto).");
  }
  return { backend: selected, voice: selected === "chatterbox" ? "chatterbox-bella" : voice };
}

/** Include the complete production rig/performance dependency tree in render identity. */
export async function rendererSourceHashes(root: string): Promise<Record<string, string>> {
  const paths = ["apps/renderer-remotion/src/entry.tsx", "apps/renderer-remotion/src/render.ts", "apps/renderer-remotion/src/video.tsx", "apps/renderer-remotion/src/windows-browser-launcher.ts", "apps/renderer-remotion/src/windows-browser-launcher.cs", "packages/renderer-core/src/renderer.ts", "package.json", "pnpm-lock.yaml", "tsconfig.json"];
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) paths.push(path);
    }
  }
  await visit("packages/presenter/src");
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
}
