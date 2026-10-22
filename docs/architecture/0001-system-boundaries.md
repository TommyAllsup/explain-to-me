# Architecture Decision 0001: System Boundaries

- **Status:** Accepted for MVP
- **Date:** 2026-10-13
- **Related plan:** [Explain-to-Me Implementation Plan](../plans/2026-10-13-explain-to-me-implementation-plan.md)
- **Acceptance benchmark:** [MVP Acceptance Benchmark](../benchmarks/acceptance.md)

## Decision

Build a local-first TypeScript orchestration pipeline around a validated, renderer-neutral `ProductionManifest`. Model-backed components may propose narration, scenes, and assets, but only deterministic adapters may execute media production. Final timing is derived from measured narration audio rather than estimated reading speed.

## First implementation milestone

Before text-to-video direction, implement prepared-manifest execution with Apple speech, measured timing, the complete deterministic golden scene set, captions, muxing, validation, and end-to-end human review. The explicit command uses `build --manifest fixtures/golden-manifests/whisper-vs-tts.json --profile preview --duration 60s`. The manifest argument authorizes production intent, not arbitrary paths/code or source execution. Initial scenes require no external assets. Supporting image ingestion remains subject to the canonical boundaries below when added.

This first milestone is narrower than releasable MVP acceptance. Cache reuse guarantees, automatic ingestion/direction, Kokoro, static browser captures, and profile scheduling follow a watchable video. Renderer neutrality and zero build-time egress apply from the start.

## Supported MVP input

| Input | MVP status | Boundary |
|---|---|---|
| Markdown file | Supported | One local `.md` source per build. |
| Plain-text file | Supported | One local `.txt` source per build. |
| Local images | Supported | Referenced or supplied files must remain inside the canonical allowed roots defined below and retain provenance. |
| Remote images/URLs | Deferred | No network dependency is required for a successful MVP build. |
| HTML pages, PDFs, source-code projects, structured JSON | Deferred | Listed as future artifact types in the product plan, not part of the first releasable input contract. |
| Imported narration/audio/video | Deferred | Adapter concepts may exist later; the golden path starts from text and local images. |

The input normalizer may extract headings, paragraphs, lists, code fences, links, and local image references. It must not execute embedded HTML, scripts, shell commands, or code blocks.

### Authoritative local-file boundary

For each build, the only allowed roots for image reads are:

1. the **input root**: the canonical directory containing the canonical source file; and
2. the **project-assets root**: the canonical `<project-root>/assets` directory, where `<project-root>` is the working directory captured when the CLI accepts the build.

The source argument itself is the user's explicit file authorization. It must exist and resolve to a regular `.md` or `.txt` file. The project-assets root is optional, but if used it must already exist and resolve to a directory; the build must not broaden the boundary to the whole project root.

All roots and candidate files are resolved with the platform's canonical `realpath` behavior before a read. A Markdown image path is first resolved relative to the source file's canonical directory; an explicitly supplied project asset is resolved relative to the project-assets root. The validator rejects any reference containing a lexical `..` path segment before resolution. It must then require that the target exists, is an allowed regular image file, and that its canonical path is contained in an allowed root by path-component comparison, not string-prefix comparison. It rejects nonexistent or dangling targets and any symlink whose resolved target is outside all allowed roots. A symlink is permitted only when its final canonical target remains within an allowed root. Validation and the later asset read use the same canonical path to avoid check/use disagreement.

## System boundaries

```text
Markdown/plain text + local images
  -> ingest and normalize
  -> direction into validated ProductionManifest
  -> sentence/phrase narration synthesis
  -> measured audio timeline and captions
  -> deterministic/local asset acquisition
  -> renderer adapter
  -> audio mix and MP4 mux
  -> audiovisual validation and report
```

| Boundary | Owns | Must not own |
|---|---|---|
| CLI/orchestrator | Build options, progress, stage scheduling, cache coordination, output contract | Scene-specific rendering implementation |
| Ingest | Source normalization and source metadata | Executing source content or fetching required remote content |
| Director | Constrained narration/storyboard proposal | Arbitrary renderer code, shell commands, unbounded URLs, or file paths |
| Contracts | Zod/JSON Schema types and validation | Provider-specific model or renderer behavior |
| Audio | TTS adapters, chunks, sample-accurate duration, alignment, captions, audio QC | Estimating final scene duration without probing audio |
| Timeline | Scene/chunk/cue intervals derived from measured audio | Renderer-specific frame APIs |
| Assets | Provenance, licensing metadata, content-addressed cache, deterministic fallbacks | Authoritative factual text baked into generated images or reads outside canonical allowed roots |
| Renderer core | Renderer-neutral request/result interfaces | Remotion- or Revideo-only fields in the production manifest |
| Renderer adapter | Known scene implementations and frame production | Reinterpreting narration timing or accepting executable scene code |
| Validation | Media probing, caption/timing checks, sampled-frame checks, report generation | Declaring final approval without an end-to-end human watch |

## Manifest safety and reproducibility

The `ProductionManifest` is the stable contract between direction and execution. It must:

- use a versioned schema and reject unknown scene kinds and properties;
- reference only bounded, approved media inputs;
- contain no raw JavaScript, shell commands, or arbitrary executable code;
- remain independent of Remotion, Revideo, and model-provider APIs;
- preserve narration, scene intent, cue intent, bounded asset references, profile, and target duration; and
- be emitted as `manifest.json` as renderer-neutral production intent, without provider- or renderer-specific execution fields.

Exact reproduction requires the complete build record rather than the manifest alone: `manifest.json`, `report.json` provenance, resolved asset hashes, and pinned adapter/model versions, configuration, seeds, and environment. Provider/renderer execution metadata and resolved execution details belong in `report.json` or associated provenance records.

**Experimental amendment, 2026-10-22:** bounded, renderer-neutral asset-origin declarations may travel with `assets[].provenance`, including attribution and exact prompt/identity records. These describe imported material, not provider execution settings or verified claims. `visual.presenter.assetId` records composition intent for an approved local still. See the [Claudia experiment](../plans/2026-10-22-claudia-presenter.md).

Each cacheable stage is content-addressed. Cache keys include normalized inputs and relevant adapter versions/configuration. A warm rerender must perform no redundant TTS, capture, or generation work when its inputs are unchanged.

## Director policy

Prepared-manifest execution bypasses direction. The first automatic offline director is deterministic extraction/template mapping from normalized source content; it must disclose its limitations and must not claim model-based summarization. Model-backed direction remains an adapter, not an assumed installed dependency. A concrete local runtime/model requires an architecture record, pinned license/prerequisites, and real hardware/output benchmark before adoption. Configured cloud adapters require explicit `--allow-cloud true`; developer subscriptions are not implicit application APIs.

## Timeline rule

Narration is produced in sentence-sized or short-phrase chunks before scene durations are finalized. Exact sample counts and probed durations define chunk boundaries. Scenes and captions are then assigned against that master timeline. Estimated word count may guide a draft storyboard, but it is not authoritative for rendering.

### Duration correction, cue identity, and invalidation

Requested duration is intent; measured PCM sample counts are execution evidence. Permit at most two corrections after initial synthesis using pinned conservative speech-rate bounds. Later directors may rewrite narration explicitly into a newly validated manifest. Never silently truncate words or insert long silence to force acceptance. If duration/intelligibility requirements remain unmet, fail with measurements and guidance.

Give narration chunks, visual nodes, and cue targets stable IDs. Use chunk ID plus zero-based normalized token index, with versioned token normalization, rather than matching an ambiguous word. If word timing is unavailable, use only a predeclared sentence-level fallback and record its use in execution provenance.

Visual-only changes preserve unrelated audio/assets. Narration-duration changes invalidate affected downstream timeline, captions, composition, mux, and validation while preserving unrelated cached chunks/assets. Do not promise scene-local final video encoding. Mandatory-stage deadlines may be infeasible; optional-stage fallback is not an unconditional completion guarantee.

## CLI and artifact contract

The initial command interface is:

```bash
explain-to-me build <input.md|input.txt> \
  --profile <preview|fast|balanced|cinematic> \
  --duration <duration> \
  --audience <description> \
  --style <description>
```

Resource controls planned by the approved design include `--deadline`, generated-asset limits, VRAM limits, render concurrency, and `--allow-cloud`. `--allow-cloud` defaults to `false`. With that default, every stage—including the director, asset providers, TTS, rendering, and validation—must make no external network request, and source text/images must not be transmitted off-machine. Local adapters may communicate through in-process calls, Unix-domain sockets, or explicitly configured loopback-only services, but those channels may not proxy or forward externally. The deterministic `preview` and `fast` paths must complete when cloud and optional generators are unavailable.

Setting `--allow-cloud true` is explicit consent only for configured cloud-capable stages; it is not blanket network access. For every cloud call, `report.json` records the provider, stage, and payload class (for example normalized text, prompt, or derived still) without recording source content, prompts containing sensitive content, credentials, or response bodies. Secrets and sensitive payload content must not appear in logs.

When cloud access is disabled, that cloud-call ledger must be empty. Attempted external access is a build/validation failure, not a warning or automatic downgrade.

The MVP Playwright provider is restricted to approved local/static content. It must create a browser context with network requests disabled and render bundled files or content injected directly into the page; it may not navigate to remote URLs or fetch HTTP(S) resources, including through a nominally local page that loads remote subresources.

Every successful build emits `video.mp4`, `audio.wav`, `captions.vtt`, `captions.srt`, `manifest.json`, and `report.json`. Editable project files are optional and must not be required to play or validate the result. `report.json` records actual wall time and per-stage timings, cold/warm cache state, hardware/environment, profile downgrades, QC outcomes, and pinned renderer/model license information.

## MVP feature boundary

Included in the first releasable version:

- Markdown/plain-text input and local images;
- schema-constrained direction with a guaranteed offline extractive/template fallback and explicit model-adapter availability;
- Apple system speech plus Kokoro;
- sentence captions and optional word timing;
- deterministic title, statement/text with kinetic-label cues, bullets, diagram, comparison, code, image, and outro scenes;
- a Remotion renderer behind `RendererAdapter`;
- local-file and local/static, no-network Playwright asset providers;
- `preview`, `fast`, `balanced`, and `cinematic` policies;
- content-addressed caching;
- ffprobe, audio, caption, timing, and sampled-frame validation; and
- one 60-second golden explainer produced end to end.

Explicitly deferred:

- fully generated long-form video;
- automatic full-body presenters;
- collaborative cloud editing;
- a general-purpose nonlinear-editor timeline;
- arbitrary user-authored renderer code;
- automatic publishing;
- 4K as a default;
- a Studio UI before the CLI is stable;
- mandatory generated stills, avatars, or generated video on the fast path; and
- additional artifact formats and remote inputs.

## Consequences

- Providers and renderers can be replaced without changing the manifest contract.
- The golden fixture can exercise the whole system without cloud services or generative visual models.
- Scene variety is intentionally constrained until timing, caching, and validation are reliable.
- Output quality and build speed are measurable by profile rather than implied by marketing language.
