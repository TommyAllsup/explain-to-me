# Changelog

## 0.3.0 — 2026-10-30

- Versioned local projects bind source/manifest, direction, narration, pacing, music and output settings.
- Plan and edit scripts before speech or rendering; audition short narration previews through the same production preparation and caches.
- Passage > scene > project pacing survives sentence splitting. Chosen pace controls measured timing; opt-in strict duration checks fail with recovery guidance without retiming speech.
- Optional connected Kokoro delivery preserves scene context and measured passage boundaries.
- One local soundtrack with gain, narration ducking and fades; separate narration/music/mixed stems and rights provenance. Music-only revisions reuse narration and rendered frames.
- Canonical project/plan image boundaries reject external assets-directory symlink escapes.
- Existing legacy duration fitting and optional Claudia/Chatterbox production remain supported.

## 0.2.5 — 2026-10-22

- Optional animated Claudia presenter in ordinary manifest and document builds, using the selected Bella-reference Chatterbox voice.
- Fresh speech alignment drives lip sync, expressions, gaze, and connected phrase gestures; reduced motion is available in presenter intent.
- Explicit local runtime registration and readiness diagnostics, speech/alignment caching, and animation-aware render caching.
- Chatterbox keeps natural delivery: requested duration is advisory and reports distinguish it from the measured audio/video timeline.
- A neutral animated example and normal CLI/agent workflow replace the need for story-specific experiment scripts. Existing still presenters and Apple/Kokoro builds remain supported.

General pacing, music, and project configuration remain with the separate 0.3 work.

## 0.2.1 — 2026-10-17

Release number corrected to 0.2.1 on 2026-10-18. The Windows feature scope is unchanged.

- Native Windows x64 builds with Kokoro narration, prepared manifests, and template-directed Markdown/plain text.
- One-command Windows setup with local tooling, isolated Python, pinned model assets, render browser, and an automatically compiled Windows launcher. Reuses Remotion's bundled FFmpeg/ffprobe.
- Platform-aware doctor/backend/tool discovery, Windows owned-process cleanup, private directory controls and file-boundary checks.
- Windows/Linux CI and focused backend, launcher, path, and cleanup regressions. Native Windows local AI direction remains deferred.
- Version-pinned Windows installation prompts for Codex, Claude Code, and other local coding agents, plus updated README/homepage quickstarts.

## 0.2.0 — 2026-10-15

First open source release.

### Added

- Package-backed CLI `--version`, documented in help.
- Doctor runtime/platform checks, optional-backend labeling and setup recovery guidance.
- Duration-refusal recovery guidance shared by Apple and Kokoro narration.
- Lightweight Node 24 Linux CI for typechecking and unit tests.
- MIT project license, contributor/security guidance, third-party notices and issue/PR templates.
- A versioned product roadmap and a simplified macOS-first quickstart.
- A playful README, copy/paste agent setup prompt, and private-workspace installation guide.
- A getting-started release movie and website player. Its custom cartoon scenes and music are a separate production workflow, not new CLI flags.

### Fixed

- Prepared-manifest agent builds no longer receive document-only director flags. Explicit director, audience, or style options with a manifest are rejected before job creation.
- Shorter private director socket paths accommodate bounded temporary roots that failed in 0.1, without changing Unix transport or owned cleanup.
- Clean-checkout test fixtures initialize their own parent directories.
- Additional environment-file and virtual-environment patterns are ignored.

### Unchanged limitations

Only preview/technical-whiteboard output is implemented. Whole-process egress evidence, broader acceptance and complete third-party commercial suitability review remain open. Cartoons, imported music, per-sentence pacing, ASR and listening review are roadmap features, not general CLI options.

## 0.1.0

Initial private source release: local Markdown/plain-text and prepared-manifest builds, local/extractive direction, Apple/Kokoro speech, pronunciation overrides, measured captions, deterministic scenes, local images, caches and media/provenance reports.
