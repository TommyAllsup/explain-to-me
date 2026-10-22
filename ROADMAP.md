# Explain-to-Me: Product roadmap

**Status:** v0.2.1 is the current Windows patch release following the published v0.2.0 release. Version 0.3 is the next scoped product milestone; later milestone numbers and scope remain proposed.
**Baseline:** v0.2.1, with macOS and Windows 11 x64 support within the documented feature matrix.
**Goal:** Turn local source material into an accurate, engaging, human-reviewable explainer without custom production scripts.
**Architecture:** Keep the validated, renderer-neutral production manifest, local adapters, measured narration timeline, deterministic information layer and content-addressed caches. Productize the successful production workflows around those boundaries rather than build a general video editor.
**Tech stack:** Existing TypeScript/Node/pnpm pipeline, React/Remotion adapter, FFmpeg/ffprobe, local narration and direction adapters.

> This is a feature roadmap, not a task-by-task implementation plan. Scope each release before coding; write a small implementation plan for the next approved slice. Historical plans and benchmark records remain evidence with their original limits, not an instruction to execute every deferred idea.

## Current release: v0.2.1 — Windows installation and local agent workflow

Windows 11 x64 has one-command setup, Kokoro narration, prepared-manifest and template-directed builds, structured private-workspace agent jobs, measured captions/timelines, cache reuse, and existing media QC. The installer prepares local tooling without global Python/pnpm/FFmpeg installs. Existing Codex and Claude Code harnesses can follow the same tag-pinned installer prompt. See [release notes](docs/releases/0.2.1.md), [Windows setup](docs/windows.md), and [validation evidence](docs/benchmarks/windows-support.md).

macOS retains Apple speech, optional Kokoro, prepared manifests, template direction and the optional local AI director. Native Windows local AI direction, ARM64, whole-process egress proof, general music/cartoon controls, and the broader review/project workflow remain deferred. Supported platforms need not have identical optional backends; document and test the supported paths explicitly.

## What 1.0 means

A user on a supported platform can install the tool, provide local Markdown/plain text or a prepared manifest, review and revise a story, choose narration and visuals, add optional local music, and export a usable captioned video through documented commands. Revisions preserve approved work and rebuild only affected stages. The workflow does not require private production scripts or an agent repairing every build.

The supported matrix starts with macOS and Windows 11 x64. Windows uses Kokoro and template direction; native local AI direction remains deferred. The stable release includes the bounded project/review workflow, narration and one-track music controls, two visual styles, and preview/delivery output. New document formats, a Studio UI and platform/backend parity are separate work.

## Completed foundation

### 0.1 — Local production pipeline, released

- Local Markdown/plain text and prepared manifests.
- Local model-backed direction or explicitly extractive templates.
- Kokoro narration and Apple speech fallback; pronunciation maps.
- Measured sentence/phrase captions and narration-driven scene timing.
- Deterministic technical-whiteboard scenes, code, bullets and approved images.
- Direction/speech/render caches, media validation and provenance.
- Preview output at 720p/24 fps.

### 0.2 / 0.2.1 — Repeatable first run and Windows support, released

- Public MIT-licensed project code, documented source installation and verified quickstarts.
- Package-backed CLI version reporting, platform-aware doctor checks and actionable setup/duration diagnostics.
- Private director socket fixes, static CI, clean-checkout fixtures and agent job integration.
- Windows 11 x64 setup, Kokoro/template builds, owned-process cleanup and platform/file-boundary checks.

See the [0.2.0 release notes](docs/releases/0.2.0.md), [0.2.1 release notes](docs/releases/0.2.1.md), and [changelog](CHANGELOG.md). Project code licensing does not relicense dependencies, models, voices or supplied assets.

Custom cartoons, imported music and human-selected sentence pacing have demonstrated a stronger production workflow, but are not general v0.2.1 CLI features. A custom demonstration does not establish acceptance of every product path.

## Next: 0.3 — A saved project, a reviewed script, and a soundtrack

**Outcome:** Reproduce the preferred narration-and-music workflow through supported commands, with a script review before expensive production.

- Introduce a minimal versioned saved project for source/manifest bindings, direction hints, voice, pronunciations, pacing, one music track and output settings. Reuse the existing manifest and adapters; avoid a general editor or a second production engine.
- Separate planning from narration/rendering. Save a reviewable script/scene plan before TTS so the user can inspect and edit it without completing a video.
- Provide a short narration preview using the same preparation, pronunciation and pacing behavior as the full build.
- Support project-level voice/pronunciation/pace and bounded scene/passage overrides, including an explicitly slower passage. Keep override identities stable through narration preparation.
- In the new project workflow, approved pacing takes precedence over a desired running time. Strict duration fitting is opt-in; an infeasible combination must fail with measured recovery guidance rather than silently undo explicit pacing, truncate speech or add padding.
- Preserve existing CLI behavior, including legacy duration-fitting commands. Document precedence among project defaults, explicit overrides, pacing and duration policy; do not silently change older invocations.
- Import **one local music track** with gain, narration ducking and start/end fades. Keep narration/music stems and mixed output meanings explicit. Looping and crossfades are deferred.
- Keep soundtrack configuration and cache identity separate from visual production so a music-only edit reuses narration and rendered frames. Preserve previous outputs.
- Record music source, hashes and user-supplied rights information without implying automatic clearance. Apply bounded local-file and owned-process controls to new inputs and tools.

**Done when:** One neutral saved project can be planned and reviewed before TTS, previewed, and rendered with normal narration, an explicitly slower passage and unobtrusive music. A music-only revision produces a new output with no TTS or frame-render work; a pacing revision updates the measured timeline/captions and invalidates dependent work correctly. Legacy examples retain their behavior.

**Verification:** Use focused regressions and representative macOS and Windows 11 x64 builds for the supported backend combinations. Record commands, environment, cache behavior, media checks and human watch/listen results separately. If a platform or backend cannot be exercised, mark that verification unavailable with the reason; do not infer a pass from another platform. Native Windows local AI direction is outside this milestone.

## Proposed sequence after 0.3

The following numbers describe a proposed order, not authorization to implement every milestone or a promise that all scopes will ship unchanged.

### 0.4 — Review, approve and revise

**Outcome:** Make the complete revision loop understandable and dependable before adding another visual style.

- Expand the minimum 0.3 review step into script/storyboard inspection with source references, qualifications and uncertainty preserved.
- Edit narration, scene choices, pronunciations and pacing through the documented project format.
- Show what changed and which stages a revision invalidates; compare preserved versions and their outputs.
- Persist human script/output review state separately from automated QC, tied to the version that was reviewed.
- Treat simple-English or attention-friendly language presets as direction/review changes. They may rewrite narration and require fresh review; they are not renderer themes.

**Done when:** A user can correct one sentence or scene, inspect the affected work, rebuild and compare versions without losing prior outputs. Source mappings support inspection but never certify semantic correctness. A changed script cannot inherit approval by accident.

### 0.5 — Engaging explanatory visuals

**Outcome:** Make the same reviewed explanation easier and more enjoyable to follow.

- Add one bounded, original upbeat cartoon style alongside technical-whiteboard.
- Use a small reusable motion vocabulary: progressive reveals, emphasis, process movement and purposeful transitions.
- Extend validated scene primitives only where they improve explanations: diagrams/comparisons, code emphasis and local image callouts.
- Enforce legibility and motion limits, including a reduced-motion option.

**Done when:** The same reviewed story renders in both styles without rewriting claims, captions or source references. Human review confirms readable information and helpful motion. Language rewriting remains part of direction/review, separate from style selection.

### 0.6 — 1080p delivery and faster iteration

**Outcome:** Upgrade an approved project for delivery while keeping draft/revision work efficient.

- Retain 720p/24 fps preview and add a documented 1080p/30 fps delivery profile.
- Preserve the approved story, narration and captions across profile changes; recompute frame boundaries for the selected frame rate.
- Extend existing stage timings, resource bounds, cache identity, diagnostics, cancellation and retry behavior where the new profiles require it.
- Keep delivery resolution distinct from a future deadline-aware scheduling policy. No generated-asset scheduler is required for this release.
- Measure cold/warm and preview/delivery behavior on named supported hardware, with preconditions and misses recorded.

**Done when:** The same approved project produces valid preview and delivery outputs. Repeated builds reuse unchanged work; configuration changes invalidate only dependent stages. Performance results are observations, not universal latency promises.

### 0.7 — Offline, file-boundary and supported-matrix evidence

**Outcome:** Close the cross-process evidence gaps for the supported product configuration.

- Exercise whole-process offline execution under an external-egress deny/record harness, separately from permitted setup downloads.
- Complete the bounded local-file and failure matrix for Markdown/plain text, manifests, approved images, project files and imported music.
- Verify controlled subprocess environments, user-owned cleanup, cancellation and retained diagnostics across supported macOS/Windows paths.
- Document the platform/backend matrix, including explicitly unavailable optional capabilities and any unverified paths.
- Report dependency/model/renderer and imported-asset terms without conflating project code and model/asset permissions.

**Done when:** Supported offline builds have recorded deny-harness evidence, critical boundary/failure cases have focused checks, and unsupported or unavailable paths are clear. Existing renderer request auditing remains distinct from whole-process egress evidence.

**Dependency note:** Security and privacy work starts with each feature, not at 0.7. Earlier milestones must preserve existing controls and add focused checks for their new boundaries; this milestone closes the matrix and evidence gaps.

### 0.8 — Workflow hardening, examples and migration

**Outcome:** Make the chosen workflow reproducible without maintainer intervention.

- Exercise short/long, image/code, narration/music, fallback, failed-stage and retry workflows within documented bounds.
- Add a small set of neutral reusable example projects and clear troubleshooting/recovery guidance.
- Harden source/project migration, cache invalidation and preserved-version behavior; extend existing cancellation/resource controls where concrete failures require it.
- Document legacy-command compatibility and project/schema migration, including actionable errors for unsupported versions.
- Maintain source/artifact provenance and explicitly separate automated checks, human review and unverified claims.

**Done when:** Representative users or agents can install, revise and recover documented examples across the supported matrix, with no silent data loss or unexplained rebuilds. Migration and recovery paths have actual evidence.

### 0.9 — Release candidate

**Outcome:** Stabilize the selected 1.0 scope without adding another feature wave.

- Freeze the public CLI/project contracts and verify migration from earlier supported projects.
- Run clean installations and representative neutral projects across the supported environment matrix.
- Record human approval of representative end-to-end outputs alongside automated media/timing/caption checks.
- Publish release notes, known issues, platform/backend limits and troubleshooting.
- Confirm the existing MIT/source distribution policy and document separate dependency/model/asset terms and any remaining distribution limits. Do not imply blanket commercial-use clearance.

**Done when:** No known critical safety defects, missing/repeated narration, broken supported quickstart or silent data loss remains. Documentation matches the shipped behavior; nonblocking limitations and unavailable verification are explicit.

### 1.0 — Stable local explainer workflow

**Required release gates:**

- A supported clean install and working documented first build on the declared macOS/Windows matrix.
- A versioned saved project and reviewed source-to-story-to-video workflow with revisions and preserved versions.
- Supported narration controls, an explicit slower passage, optional one-track local music, and both bounded visual styles.
- Complete MP4/WAV/VTT/SRT/manifest/report outputs with clear narration/stem/mix meanings and documented preview/delivery profiles.
- Correct cache invalidation and measurable repeat-build behavior, including music-only reuse; no promise of bit-identical cold TTS.
- Whole-process offline and local-file-boundary evidence for the supported configuration.
- Automated media/timing/caption checks plus separate human review on representative projects.
- Stable CLI/project contracts, actionable errors, safe cancellation and migration guidance.
- Explicit supported-platform/backend, license and distribution statements.

Tag 1.0 when these outcomes are demonstrated, not when every proposed feature or version number has been exhausted. Reassess scope at each milestone rather than expanding the release gates by accumulation.

## Explicitly after 1.0 unless reprioritized

- New local PDF and source-code input adapters; scanned-PDF OCR and recorded-narration import/alignment.
- Local Studio/desktop editing UI.
- Native Windows local AI direction/backend parity, ARM64 and full Linux video-build support.
- Music looping, crossfades and richer multi-track production.
- Arbitrary remote webpages, authenticated browser captures and broad document ingestion.
- ASR/transcript QC, automated listening/naturalness research and word-aligned highlighting.
- Generated images/B-roll, optional cloud adapters, avatar or consented voice-cloning workflows.
- General-purpose video editing, collaborative cloud projects and automatic publishing.
- Default 4K, extensive animation primitives and deadline-aware optional-generation scheduling.
- Alternative renderer implementation; bring its evaluation forward only if licensing or technical constraints block the selected 1.0 scope.

## Evidence and delivery discipline

- No dates or effort promises until the next milestone is scoped. Implement one approved vertical slice at a time.
- Keep the validated manifest boundary, local adapters, measured audio timing and content-addressed caches. Avoid a second production engine for new workflows.
- Preserve bounded/canonicalized local assets, controlled subprocess environments, private transport where applicable, owned-process cleanup and new-output protection. Extend checks with each new input or behavior.
- Routine slices use focused tests plus typecheck and a representative render when media behavior changes. Documentation-only changes do not justify full-video builds.
- Broader fault/egress/acceptance runs belong at their milestone gates. Use existing evidence for unchanged behavior; add checks for substantive new risks or regressions.
- The [historical acceptance benchmark](docs/benchmarks/acceptance.md) retains its original scope and unimplemented assumptions. Carry forward useful media/timing invariants and provisional measurements; write current, scoped acceptance criteria for each new milestone instead of inheriting that entire contract.
- Record actual commands, environment, outputs, limitations and unavailable verification. A configured workflow, a sampled frame or an automated pass is not full human approval.
- Keep private production material, model weights and credentials out of source releases. Include only deliberately selected, documented demonstration media.
- Preserve the published v0.2.0/v0.2.1 history. This roadmap authorizes no product implementation, commit, push, tag or publication by itself.

## Next implementation slice

Scope 0.3 around the smallest saved-project and pre-TTS review foundation needed for narration previews, deliberate pacing and one-track music. Prove one neutral project on the supported macOS/Windows paths, preserve legacy commands, and leave full revision tooling, cartoons and new input adapters to their later milestones.
