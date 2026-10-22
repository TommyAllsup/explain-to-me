# Claudia presenter experiment

Date: 2026-10-22. Status: feature-branch experiment.

Implemented and exercised locally; see the [validation record](../benchmarks/claudia-presenter.md).

Give a reviewed explainer a visible presenter while preserving its teaching content, measured narration, captions, and local asset boundary. The first deliverable is a reusable local character pack plus an explicit composition step, demonstrated with Claudia.

## Assessment of the research proposal

The research gets the boundary right: discover or generate images outside the build, import bounded local stills, preserve the creative record, and defer lip sync and paid inference. Its proposed first implementation stops too early. Printing a prompt and inserting Markdown images largely repackages existing image ingestion; director selection can omit an image, and a standalone image scene replaces the teaching layout where the presenter should accompany it.

A useful experiment should answer whether Claudia improves the finished explainer. That requires a visible composition primitive, explicit scene selection, and a complete runnable example. Provenance belongs with the portable asset declaration and in the build report, so it survives preparation and rebuilding.

## Proposed implementation

1. Package a reviewed PNG, JPEG, or WebP with a versioned JSON descriptor. Record its byte hash, character name, source/prompt information, credit, and AI-generation declaration.
2. Add `presenter --manifest ... --pack ... --scenes ... --output ...`. Validate both inputs and image bytes, copy all referenced assets, and write a portable manifest in a fresh directory. Keep source inputs unchanged.
3. Add `visual.presenter: {assetId}` to title, statement, bullets, and outro scenes. Resolve it against an approved manifest asset with provenance. Default preparation selects title/outro scenes; explicit IDs control placement.
4. Render a separate image panel beside the teaching content, above captions. Show the full credit and an AI-generated label when declared; preserve the image with `contain`. Keep existing layouts for scenes without a presenter.
5. Preserve asset metadata and scene usage in `report.json`; rebuild from the emitted manifest and copied assets. Treat hash checks as byte-integrity evidence, not independent provenance verification.

The API is generic; Claudia is the supplied pack and documented workflow. There is no character-specific director style, mandatory connector, or cloud credential in the CLI. Bounded asset-origin declarations are a deliberate amendment to [ADR 0001](../architecture/0001-system-boundaries.md), distinct from provider execution settings.

## File touchpoints

| Area | Implementation |
|---|---|
| Manifest contract | `packages/contracts/src/production-manifest.ts` and generated JSON schema: bounded provenance, presenter references, cross-field checks |
| Preparation | `packages/presenter/src/prepare.ts`: strict pack parsing, asset verification, portable copies, fresh output |
| CLI | `apps/cli/src/presenter.ts` and `index.ts`: command routing, build/report integration |
| Reporting | `apps/cli/src/asset-report.ts`: provenance declarations, byte hashes, scene usage |
| Rendering | `apps/renderer-remotion/src/render.ts` and `video.tsx`: stage referenced stills, reserve panel space, visible attribution |
| Example and documentation | `fixtures/presenters/claudia/`, [how-to](../claudia.md), notices, architecture amendment |
| Verification | Contract, preparation, CLI/report, renderer tests; real render and visual inspection |

## Acceptance criteria

| Requirement | Evidence to collect |
|---|---|
| A presenter is visibly useful | Render the title/bullets/outro fixture; inspect stills and play the narrated video |
| Teaching remains legible | No panel overlap with content or captions; body text at least 22 px; dense content fails with guidance |
| Credits survive | Character name, complete credit, and declared AI label visible; report retains exact supplied metadata |
| Preparation is portable | Rebuild the emitted `manifest.json` with its adjacent `assets/` after moving or copying the output directory |
| Local files are bounded | Refuse missing/changed bytes, invalid references, links/traversal, oversized inputs, and existing output directories |
| Existing behavior remains usable | Golden manifests without presenters still validate and render; relevant tests and typecheck pass |

Preparation accepts at most eight assets, 8 MiB per image, 32 MiB of images total, and 128 KiB JSON inputs/output. Presenter layouts require at least 960×540; the normal preview is 1280×720. Browser request controls remain in place, but this experiment does not establish whole-process network isolation.

## Deferred work

The follow-on [character study](../../scripts/claudia-character/README.md), requested after voice casting, tests a manually authored SVG rig with selected Bella speech and model-timed captions. Its third iteration connects the torso, shoulders, fixed-length arms, clothing, and head through shared deformation and overlapping gesture timing. It retains continuous sleeves and phoneme-guided visemes from the second iteration. It stays in a standalone composition while the user evaluates the character. Production-manifest animation, captured facial performance, automatic gallery selection, built-in image generation, paid providers, and character-aware direction remain deferred.

## Research grounding

Verified on 2026-10-22: the [agent interface](https://claudia.gallery/agents/) exposes a public read-only MCP server and JSON endpoints for canon, prompts, and images. It supplies source material; the local presenter command does not call it. The [character page](https://claudia.gallery/claudia/) distinguishes identity wording by framing; preserve the exact form used rather than reconstructing it from memory. The [reuse statement](https://claudia.gallery/use/) permits reuse of Claudia and gallery images and appreciates credit, while excluding other parties' material. Do not describe all gallery or film assets as MIT-licensed.
