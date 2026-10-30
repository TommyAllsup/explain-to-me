# Linux setup with Kokoro

Version 0.3.0 includes the 0.2.6 fix for `doctor` rejecting Linux even when the Kokoro build prerequisites are present. The Linux workflow uses Kokoro narration with a prepared manifest or template-directed Markdown/plain text. Apple speech is macOS-only. `node scripts/setup.mjs` is the Windows installer; use the explicit Linux steps below.

## Prerequisites

- Node.js 24+ with npm and Git.
- Python 3 and `uv` on `PATH`. Kokoro setup creates an isolated Python 3.11 environment and installs its pinned dependencies.
- `ffmpeg` and `ffprobe` on `PATH`, installed through your distribution's package manager.
- The shared libraries required to run Chromium on your distribution. Remotion's rendering browser is downloaded separately during setup.

Use a native Linux checkout and Linux executables throughout, including under WSL. These instructions do not install the optional local AI director or Claudia/Chatterbox runtime. The local director currently expects a macOS-specific llama-server path; template direction needs no LLM.

## Install the tagged source

Choose a new directory, then run:

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/TommyAllsup/explain-to-me.git explain-to-me-v0.3.0
cd explain-to-me-v0.3.0

# Install the pinned package manager and project dependencies.
npm exec --cache .cache/npm --yes --package=pnpm@10.18.3 -- pnpm install --frozen-lockfile

# Explicit setup downloads: Kokoro runtime/models and rendering browser.
python3 scripts/setup-kokoro.py
node --input-type=module -e 'import {ensureBrowser} from "@remotion/renderer"; await ensureBrowser({chromeMode:"headless-shell"});'

npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm explain-to-me --version
npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm explain-to-me doctor
```

The version command should print `explain-to-me 0.3.0`. Kokoro setup verifies pinned model hashes and synthesizes a short sample. Doctor requires Kokoro readiness and a successful synthesis check on Linux, alongside the media tools and browser. Apple speech and the local director do not block this workflow. Doctor and builds do not install missing dependencies.

The cached `--offline` npm launcher refuses to download a missing pnpm launcher; it does not establish whole-process network isolation. Setup intentionally downloads dependencies, model assets, and the browser. See [third-party notices](../THIRD_PARTY_NOTICES.md) for their separate terms.

## Build a movie

Start with the bundled reviewed manifest:

```bash
npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm explain-to-me build \
  --manifest fixtures/golden-manifests/whisper-vs-tts.json \
  --tts kokoro --voice af_heart --duration 60s --output out/first-linux-movie
```

For your own Markdown or plain-text document:

```bash
npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm explain-to-me build \
  path/to/document.md --director template --tts kokoro --voice af_heart \
  --duration 60s --output out/my-linux-document
```

Choose a new output directory for each build. Template direction selects source text without an AI model. Review `video.mp4`, `captions.vtt`, and `report.json` in the output directory; automated QC is separate from human watch/listen approval.

## Private workspaces and agent builds

For private inputs, create a separate workspace. If the directory already exists, stop and choose a different name throughout these commands. Run from the software checkout:

```bash
mkdir -m 700 "$HOME/explain-to-me-linux-demo"
cp -n fixtures/golden-manifests/whisper-vs-tts.json "$HOME/explain-to-me-linux-demo/story.json"
.venv-kokoro/bin/python scripts/agent-explainer.py doctor \
  --workspace "$HOME/explain-to-me-linux-demo"
.venv-kokoro/bin/python scripts/agent-explainer.py build \
  --workspace "$HOME/explain-to-me-linux-demo" \
  --manifest "$HOME/explain-to-me-linux-demo/story.json" \
  --tts kokoro --voice af_heart --duration 60s
```

The launcher returns job JSON with output and diagnostic paths. For documents, put the input inside the private workspace and use `--input /absolute/path/to/document.md --director template` instead of `--manifest`. Prepared manifests must not receive document-only director flags. Keep inputs, outputs, and caches private unless you choose to share them.

## Troubleshooting and evidence

- Missing Kokoro: check that `uv` is available, rerun `python3 scripts/setup-kokoro.py`, and inspect its runtime/synthesis error. `--tts auto` cannot fall back to Apple speech on Linux.
- Missing FFmpeg: install your distribution's FFmpeg package and confirm both `ffmpeg -version` and `ffprobe -version` work in the same shell.
- Browser failure: rerun the explicit Headless Shell setup and inspect missing shared-library errors. An existing browser file alone does not prove that the OS can launch it.
- Missing local director: use `--director template` or a prepared manifest. Local AI direction is outside this Linux setup path.

The original [issue #1](https://github.com/TommyAllsup/explain-to-me/issues/1) reports a successful Arch Linux x64 golden-manifest build. The 0.2.6 patch addresses preflight and guidance; it does not change audio encoding or certify all distributions, architectures, or playback devices. See [0.2.6 release notes](releases/0.2.6.md) for the verification record.
