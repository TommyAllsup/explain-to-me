# Changelog

## 1.1.1 — 2026-10-17

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
