# Explain-to-Me 1.1.1 on Windows

Version **1.1.1** supports Windows 11 x64 with Kokoro narration and prepared manifests or template-directed Markdown/plain text. Native Windows local AI direction and Windows ARM64 are deferred. The historical `v0.2.0` release remains macOS-first.

## Let your local agent install it

Give an existing Codex or Claude Code session the [Windows installer prompt](install-windows-agent.txt). The agent needs local terminal access to this Windows computer; a chat without that access cannot perform the installation. See [agent setup](quick-install.md#windows-111-with-codex-or-claude-code) for examples. This installs Explain-to-Me, using the agent harness you already have.

## Install once

Install [Node.js 24 LTS or newer with npm](https://nodejs.org/en/download) and [Git for Windows](https://git-scm.com/downloads/win). Open a new PowerShell terminal after installing Node, then:

```powershell
git clone --branch v1.1.1 --depth 1 https://github.com/TommyAllsup/explain-to-me.git explain-to-me-v1.1.1
cd explain-to-me-v1.1.1
git rev-parse HEAD
node scripts/setup.mjs
```

This single command installs the pinned JavaScript packages, prepares the render browser and Windows launcher, and sets up Python 3.11/Kokoro in an isolated environment. It manages a pinned local uv, which can download Python when necessary. FFmpeg and ffprobe are included in Remotion's Windows dependency. The small browser launcher compiles automatically using Windows' installed .NET Framework compiler.

You do not need global pnpm, Python, uv, FFmpeg, a separate compiler installation, or PATH edits. Normal setup runs as an ordinary user using existing Windows runtime components; repairing missing Visual C++/.NET components can require administrator access. Setup downloads dependencies and the browser plus approximately 350 MB of pinned Kokoro model/voice assets. It checks the model hashes and synthesizes a short sample before reporting readiness. Rerun `node scripts/setup.mjs` after an interrupted setup; verified downloads and installed components are reused.

Downloads happen during setup. Builds use installed assets and do not install missing tools or models. The [third-party notices](../THIRD_PARTY_NOTICES.md) describe component terms.

## Make your first movie

Run from the checkout:

```powershell
node scripts/explain.mjs build --manifest fixtures/golden-manifests/whisper-vs-tts.json --output out/first-movie
Start-Process out/first-movie/video.mp4
```

Kokoro is selected automatically on Windows, with voice `af_heart`. To be explicit, add `--tts kokoro --voice af_heart`. Use a fresh output directory for each build; existing targets are refused.

For your own document:

```powershell
node scripts/explain.mjs build "C:/My Documents/lesson.md" --director template --duration 60s --output out/my-lesson
```

Template direction selects material from the document deterministically. It is extractive and does not semantically summarize. Review the emitted `manifest.json`, narration, and finished video. An infeasible duration fails with measured attempts and script/target guidance; speech is not truncated or padded to force a match.

Each successful output includes `video.mp4`, `audio.wav`, `captions.vtt`, `captions.srt`, `manifest.json`, and `report.json`. A second build into a new output directory reuses unchanged cached narration and rendered video.

## Private workspace and agent launcher

Keep private inputs and jobs outside the software checkout. The isolated Python prepared by setup can also run the agent launcher:

```powershell
$workspace = Join-Path $env:USERPROFILE 'Movies/explain-to-me-demo'
if (Test-Path -LiteralPath $workspace) { throw 'Choose a new workspace name; this path already exists.' }
New-Item -ItemType Directory -Path $workspace -ErrorAction Stop
Copy-Item fixtures/golden-manifests/whisper-vs-tts.json (Join-Path $workspace 'story.json')
.venv-kokoro/Scripts/python.exe scripts/agent-explainer.py doctor --workspace $workspace
.venv-kokoro/Scripts/python.exe scripts/agent-explainer.py build --workspace $workspace --manifest "$workspace/story.json" --tts kokoro --label first-movie
```

Choose a new workspace name if it already exists. For a document, replace `--manifest` with `--input "$workspace/lesson.md" --director template`. The launcher retains job JSON, logs, caches, diagnostics, and outputs under the private workspace. Timeout/cancellation terminates the owned Windows process tree and waits for cleanup. Keep source/input files unchanged during a job.

Use ordinary local-drive directories. Paths containing spaces and non-ASCII characters are supported. Windows junction/reparse-point paths, UNC/device paths, alternate data streams, and reserved/ambiguous filenames are refused. Keep image references relative and use forward slashes inside Markdown. These checks and directory access controls are not a filesystem sandbox guarantee.

## Diagnose a problem

```powershell
node scripts/explain.mjs doctor
```

Doctor checks Node, bundled media tools, actual Kokoro synthesis, the installed browser, and the compiled launcher. Local AI direction appears as unavailable/optional on Windows and does not prevent template/prepared-manifest builds.

- **Node version error:** install Node 24+ with npm and open a new terminal. `node --version` shows the selected runtime.
- **Missing model, browser, launcher, or Python dependency:** rerun `node scripts/setup.mjs`; it is the recovery command as well as the installer.
- **Windows runtime library missing:** install the Microsoft Visual C++ runtime indicated by ONNX's error, then rerun setup. See [ONNX Runtime installation](https://onnxruntime.ai/docs/install/).
- **Windows .NET compiler unavailable:** enable/repair Windows' .NET Framework 4.x component and rerun setup.
- **A linked or network directory was refused:** use a normal directory on a local drive. Avoid a checkout or workspace redirected through a junction or cloud-storage reparse point.
- **Output already exists:** choose a new output path.
- **Duration cannot fit:** shorten/review the script or choose a different target; inspect the retained measured attempts.

Setup failures print the failed step and recovery command. Build failures retain diagnostics, which can contain source excerpts and local paths. Review logs before sharing. Automated QC is separate from human review and whole-process network isolation remains unverified.

## Running from an AI harness

Setup needs download access and write access to the checkout. Agent jobs also need access to their selected private workspace. A harness can restrict those operations even when the ordinary Windows account can perform them. Codex applies filesystem/network permissions to commands and their children; see the [official Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox).

The recorded Windows validation encountered sandbox denials for Chromium/media execution and directory access-control changes. If that happens, inspect the exact error and request approval for the specific setup or build command and required directories, according to the harness and organization policy. Running an approved command as the ordinary Windows user is separate from administrator elevation. If policy prevents the needed operation, report it and let the user run the documented command in PowerShell. Keep unrelated permissions and protections in place.

The [Windows validation record](benchmarks/windows-support.md) includes setup without global Python/pnpm/FFmpeg, managed Python synthesis, full cold/warm builds, proxy checks, and process cleanup tests. The [1.1.1 release notes](releases/1.1.1.md) describe the shipped scope and remaining limits.
