# Explain-to-Me: Product roadmap

**Status:** v0.2.5 releases the bounded [Claudia integration](docs/plans/0.2.5-claudia-integration.md), following the v0.2.1 Windows patch release. The owner authorized its merge and release on 2026-10-22. The 0.3 narration/music work remains separate and in progress. Broader milestones remain proposed, not blanket implementation authorization.
**Baseline:** v0.1.0, tagged at `1d62754`.
**Goal:** Turn local source material into an accurate, engaging, human-reviewable explainer without custom production scripts.
**Architecture:** Keep the validated, renderer-neutral production manifest, local adapters, measured narration timeline, deterministic information layer and content-addressed caches. Productize the successful production workflows around those boundaries rather than build a general video editor.
**Tech stack:** Existing TypeScript/Node/pnpm pipeline, React/Remotion adapter, FFmpeg/ffprobe, local narration and direction adapters.

> This is a feature roadmap, not a task-by-task implementation plan. Scope each release before coding; write a small implementation plan only for the next approved slice. Historical implementation plans and benchmark records remain evidence, not an instruction to execute every deferred idea.

## Current release: v0.2.5 — Claudia joins the app

Animated Claudia is an optional presenter in ordinary builds, using the selected local Chatterbox voice and fresh audio alignment. Existing Apple/Kokoro and still-presenter paths remain supported. See the [release notes](docs/releases/0.2.5.md), [setup](docs/claudia-setup.md), and [validation record](docs/benchmarks/claudia-0.2.5.md).

## Previous release: v0.2.1 — Windows installation and local agent workflow

Windows 11 x64 now has one-command setup, Kokoro narration, prepared-manifest and template-directed builds, structured private-workspace agent jobs, measured captions/timelines, cache reuse, and existing media QC. The installer prepares local tooling without global Python/pnpm/FFmpeg installs. Existing Codex and Claude Code harnesses can follow the same tag-pinned installer prompt. See [release notes](docs/releases/0.2.1.md), [Windows setup](docs/windows.md), and [validation evidence](docs/benchmarks/windows-support.md).

Native Windows local AI direction, ARM64, whole-process egress proof, general music/cartoon controls, and the broader review/project workflow remain deferred. The v0.2.1 package number does not mean the historical product milestones below have all shipped. Their original numbers describe the earlier planning sequence; scope future release tags separately.

## What 1.0 means

A user on the documented supported platform can install the tool, provide local material, review and revise a story, choose narration and visuals, add optional music, and export a usable captioned video through documented commands. Revisions preserve approved work and rebuild only affected stages. The workflow does not require hand-editing private scripts or an agent repairing every build.

This broader milestone means a dependable, bounded product—not every possible input, voice, effect or deployment platform. The v0.2.1 source supports macOS and Windows 11 x64; Windows uses Kokoro and template direction, with local AI direction deferred. See [Windows validation](docs/benchmarks/windows-support.md). Other platforms require separate validation. Repository visibility and software licensing are explicit owner decisions, not automatic consequences of completing a milestone.

## Baseline: 0.1 — Released

- Local Markdown/plain text and prepared manifests.
- Local model-backed direction or explicitly extractive templates.
- Kokoro narration and Apple speech fallback; pronunciation maps.
- Measured sentence/phrase captions and narration-driven scene timing.
- Deterministic technical-whiteboard scenes, code, bullets and approved images.
- Direction/speech/render caches, media validation and provenance.
- Preview output at 720p/24 fps.

Custom cartoons, imported music, human-selected sentence pacing and listening evaluations demonstrated a stronger production workflow, but are not general CLI features in 0.1. The approved custom video does not constitute acceptance of every CLI path.

## Release sequence

### 0.2 — A repeatable first-run experience

**State:** Implemented and owner-reviewed; authorized for the first public release. See [release notes](docs/releases/0.2.0.md) for publication details.

**Outcome:** Install, diagnose prerequisites and build a first video without environment troubleshooting.

- Integrate the already prepared portability/version/documentation fixes selectively; do not restart their development from scratch.
- Clear setup versus offline execution, documented prerequisites and actionable doctor output.
- Resolve the long-TMPDIR socket failure while retaining private Unix transport and owned cleanup.
- Fix clean-checkout test assumptions; add lightweight static CI and package-backed CLI version reporting.
- Improve infeasible-duration diagnostics and document a verified quickstart.

**Done when:** A clean supported setup completes the documented example; missing prerequisites and infeasible targets produce useful errors; the existing golden paths remain working.

### 0.2.5 — Claudia in ordinary builds

**Scope:** Optional animated Claudia in the existing presenter panel, with the selected Bella-reference Chatterbox voice, fresh word/phoneme alignment, expressions, gaze, connected gestures, local setup diagnostics, and reproducible caches. Existing still presenters and narration backends remain supported.

**Acceptance:** A neutral reviewed manifest completes the ordinary CLI pipeline with fresh speech and standard media QC, and a warm rebuild reuses speech and frames. Requested duration is advisory for natural-speed Chatterbox. See the [integration plan](docs/plans/0.2.5-claudia-integration.md) and [release notes](docs/releases/0.2.5.md).

### 0.3 — Narration and music as product features

**Outcome:** Reproduce the human-preferred soundtrack through supported configuration rather than custom scripts.

- Project-level voice, pronunciation and pace settings.
- Per-scene/per-sentence pace overrides, including an explicit slower passage.
- Short matched narration previews before committing to a full render.
- Local music import, gain, narration ducking, looping/crossfades and start/end fades.
- Narration/music stems and soundtrack-only rebuilds that preserve approved visuals.
- Record music source and user-supplied rights information without implying automatic clearance.

**Done when:** A neutral example demonstrates normal pacing, a slower passage and background music without obscuring speech. A music-only edit does not regenerate narration or rendered frames. Previous outputs remain intact.

### 0.4 — Engaging explanatory visuals

**Outcome:** Make the explanation easier to follow, not merely more decorative.

- A bounded, original upbeat animated style alongside technical-whiteboard.
- Reusable motion vocabulary: progressive reveals, emphasis, movement along a process and purposeful transitions.
- Process/flow diagrams and comparison/timeline layouts selected from validated scene primitives.
- Code syntax/line emphasis and local image callouts, crop/pan/zoom.
- Simple-English and attention-friendly presets that shorten language and segment ideas without losing qualifications.
- Legibility rules, configurable motion intensity and a reduced-motion option.

**Done when:** The same reviewed story can render in both styles without changing claims, caption text or source references. Human review confirms readable information and helpful—not distracting—motion.

### 0.5 — Review, approve and revise

**Outcome:** Control the story before spending time on a complete video.

- Separate direction/planning from narration and rendering.
- Export a reviewable script/storyboard with source references, uncertainty and qualifications.
- Edit and approve narration, scene choices, pronunciations and pacing through a documented project format.
- Show what changed and which stages a revision invalidates.
- Preserve approved versions and produce a new output rather than overwrite prior work.
- Persist human review state separately from automated QC results.

**Done when:** A user can correct one sentence or scene, rebuild only affected work and compare versions. Source mappings aid review but are never presented as proof that generated claims are true.

**Dependency note:** Source mappings and preservation already exist in parts of the pipeline. Introduce the minimum review configuration needed by 0.3/0.4 early; reserve the complete multi-step workflow for this release.

### 0.6 — Reusable projects and bounded local inputs

**Outcome:** Reuse a production recipe and ingest common local material without opening arbitrary remote content.

- A versioned project configuration for source, audience, style, voice, music and output settings.
- Reusable recipes for a technical walkthrough, concept lesson and simple-English explanation.
- Local source-code files with explicit selection and exact preserved excerpts.
- Local text-based PDF extraction with page references and clear failure/quality diagnostics.
- Keep scanned-PDF OCR, arbitrary websites and browser automation outside this release.

**Done when:** A saved project can be rebuilt from documented local inputs. New adapters preserve traceable source locations and reject unsupported or unsafe material clearly. Generated summaries remain reviewable.

**Scope valve:** If either new input adapter materially delays the core workflow, move it after 1.0. Reliable Markdown/plain-text/projects are sufficient for the initial stable product.

### 0.7 — Faster iteration and useful output profiles

**Outcome:** Produce drafts quickly and upgrade the same approved project for delivery.

- Retain 720p/24 fps preview; add a documented 1080p/30 fps delivery/fast profile.
- Stage timings, explicit resource limits and deadline-aware optional-work policies.
- Cancellation, retained diagnostics and safe retry/reuse of completed stages.
- Strengthen cache identity when imported behavior/configuration changes.
- A short feedback loop for narration/scene previews; avoid unnecessary full-video rerenders.

**Done when:** Preview and delivery use the same approved story. Unchanged warm builds avoid expensive synthesis and rendering; changed inputs invalidate the correct stages. Performance is measured on named hardware, not advertised universally.

**Targets:** Use the existing golden-fixture cold/warm targets in `docs/benchmarks/acceptance.md` as provisional goals. Record misses and preconditions; do not quietly redefine targets after measurement.

### 0.8 — Trust, privacy and targeted quality checks

**Outcome:** Know what the tool did, what it checked and what still needs human judgment.

- Whole-process offline execution exercised under an external-egress deny/record harness, separate from permitted setup downloads.
- Complete the local-file boundary and failure matrix for supported inputs.
- Bounded file reads, controlled subprocess environments and user-owned cleanup.
- Optional local transcript QC focused on missing/repeated speech, numbers and important qualifiers; handle ASR homophones as uncertain findings.
- Reviewable narration-preview comparisons; automated naturalness scores are optional research, not an approval gate.
- Report dependency/model/renderer and imported-asset license status without conflating code and model-weight permissions.

**Done when:** Supported offline builds have recorded deny-harness evidence; critical boundaries/failure paths have focused tests; uncertain ASR findings and manual review remain visibly distinct from automated passes.

**Dependency note:** Safety is not deferred until 0.8. Each earlier feature must preserve existing boundaries and add focused checks for its new inputs. This release closes the cross-process evidence gaps.

### 0.9 — Release candidate

**Outcome:** Stabilize the chosen 1.0 scope rather than add another feature wave.

- Freeze the public CLI/project schema and document migration from earlier projects.
- Exercise clean installation and representative neutral projects across the supported environment matrix.
- Complete short, long, image/code, music, fallback and failed-stage workflows within the documented bounds.
- Record human approval of representative end-to-end outputs.
- Publish release notes, troubleshooting, supported-platform limits and remaining known issues.
- Decide distribution and software-license policy; keep commercial-use claims conditional on reviewed dependency terms.

**Done when:** No known critical safety defects, missing/repeated narration, broken supported quickstart or silent data loss remains. Documentation matches the shipped behavior; nonblocking limitations are explicit.

### 1.0 — Stable local explainer workflow

**Required release gates:**

- A supported clean install and working documented first build.
- A reviewed source-to-story-to-video workflow with revisions and preserved versions.
- Supported narration controls, optional local music and both bounded visual styles.
- Complete MP4/WAV/VTT/SRT/manifest/report outputs and documented preview/delivery profiles.
- Correct cache invalidation and measurable repeat-build behavior; no promise of bit-identical cold TTS.
- Offline and local-file-boundary evidence for the supported configuration.
- Automated media/timing/caption checks plus separate human review on representative projects.
- Stable CLI/project contracts, actionable errors, safe cancellation and migration guidance.
- Explicit supported-platform, license and distribution statements.

Tag 1.0 when these outcomes are demonstrated, not merely when the version sequence is exhausted.

## Explicitly after 1.0 unless reprioritized

- Local Studio/desktop editing UI.
- Arbitrary remote webpages, authenticated browser captures and broad document ingestion.
- Scanned-PDF OCR and recorded-narration import/alignment.
- Word-by-word highlighting requiring validated word timing.
- Generated images/B-roll, optional cloud adapters, and general avatar or consented voice-cloning workflows beyond the fixed Claudia profile authorized for 0.2.5.
- General-purpose video editing, collaborative cloud projects and automatic publishing.
- Default 4K and universal Windows/Linux support.
- Alternative renderer implementation; bring its evaluation forward only if licensing or technical constraints block the selected 1.0 scope.

## Delivery discipline

- No dates or effort promises until the next milestone is scoped.
- Implement one approved vertical slice at a time; do not start all milestone work in parallel.
- Routine slices: focused tests plus typecheck; a representative render when media behavior changes.
- Documentation/metadata-only changes do not justify new full-video builds.
- Broad fault/egress/acceptance runs belong at the relevant milestone gates, not every commit.
- Use existing review evidence when code is unchanged. Independent reviews are for substantive safety/architecture changes, not repeated ceremonial passes.
- Keep private production material, model weights and credentials out of source releases. Include only deliberately selected, documented demonstration media.
- Preserve the historical v0.2.0 release and the authorized v0.2.1 Windows scope; future release scope still requires an owner decision.

## Next recommended slice

Continue the separate 0.3 narration-pacing and imported-music work after the 0.2.5 Claudia release. Keep those boundaries explicit before expanding formats or building a UI.
