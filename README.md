# Explain-to-Me 🎬

**Your document has a point. Give it a voice, a whiteboard, and a tiny movie premiere.**

Explain-to-Me turns local Markdown, plain text, or a reviewed script into narrated, captioned explainer videos. A local model can plan the story; deterministic scenes do the drawing; measured speech keeps the whole crew on time.

**v0.2.1 · Windows x64 + macOS · TypeScript CLI · MIT project code**

[![Watch the goofy Explain-to-Me getting-started video](docs/images/how-it-works.jpg)](https://tommyallsup.github.io/explain-to-me/)

**[▶ Watch the getting-started movie](https://tommyallsup.github.io/explain-to-me/)** · [Download the MP4](https://github.com/TommyAllsup/explain-to-me/releases/download/v0.2.0/explain-to-me-v0.2.mp4) · [Give your agent the installer prompt](#let-your-agent-handle-setup)

*The v0.2.0 introduction gets a bespoke cartoon-and-music treatment; [its production source is here](scripts/release-video/README.md). Version 0.2.1 produces the technical-whiteboard style shown below; custom cartoons and soundtrack mixing are separate production work. The movie's original Mac setup predates the Windows instructions below.*

*Movie music: “Business As Usual” by tommyallsup.*

## Meet your extremely small film crew

```text
Your document → story manifest → local narration → measured timeline → video + captions
                  director           narrator          timekeeper        ta-da!
```

- **Explain a thing:** architecture, a proposal, a tricky concept, or why the cache gremlins are innocent.
- **Pick your script:** direct a document with a local model, select text with the template mode, or write a manifest yourself.
- **Show the idea:** diagrams, comparisons, bullets, code cards, local images, titles, and outros.
- **Keep the receipts:** editable manifests, caption files, source references, timings, validation reports, and cache provenance.
- **Reuse the expensive work:** unchanged narration and rendered frames can come from persistent caches.

![Actual technical-whiteboard output from the bundled caching example](docs/images/preview.png)

*Real output, not a mockup. Version 0.2.1 renders 1280 × 720 at 24 fps with the technical-whiteboard theme.*

## Windows: one setup command

Version **0.2.1 supports Windows 11 x64 with Kokoro narration and template direction**. Install **Node.js 24+ with npm** and **Git**, then run these commands in PowerShell:

```powershell
git clone --branch v0.2.1 --depth 1 https://github.com/TommyAllsup/explain-to-me.git explain-to-me-v0.2.1
cd explain-to-me-v0.2.1
node scripts/setup.mjs
node scripts/explain.mjs build --manifest fixtures/golden-manifests/whisper-vs-tts.json --output out/first-movie
Start-Process out/first-movie/video.mp4
```

Setup prepares pinned pnpm dependencies, a pinned local uv, the render browser and Windows launcher, and an isolated Kokoro Python environment; **no global pnpm, Python, uv, FFmpeg install or manual PATH changes are required**. FFmpeg/ffprobe come from the pinned Remotion distribution. Normal setup runs as an ordinary user; repairing missing Windows runtime components may require administrator access. Rerun the same setup command to recover an interrupted install.

For your own document:

```powershell
node scripts/explain.mjs build path/to/document.md --director template --duration 60s --output out/my-document
```

Template direction selects source text; it does not summarize with an AI model. Native Windows local AI direction is deferred. Kokoro is the Windows narrator; Apple speech is available on macOS. See the [Windows setup and troubleshooting guide](docs/windows.md) for private workspaces, diagnostics, and supported paths, or [give your AI harness the installer prompt](#let-your-agent-handle-setup).

<a id="quickstart-roll-your-first-tiny-movie"></a>

## macOS quickstart: roll your first tiny movie

The first build uses a prepared manifest and Apple's installed voice. **No LLM or Kokoro download required.** You'll need macOS, Node.js 24+ with npm, Git, FFmpeg/ffprobe, and the Samantha voice (`say -v '?'` lists installed voices). With Homebrew, install FFmpeg using `brew install ffmpeg`.

### 1. Bring in the crew

```bash
git clone --branch v0.2.1 --depth 1 https://github.com/TommyAllsup/explain-to-me.git explain-to-me-v0.2.1
cd explain-to-me-v0.2.1

# Install the pinned package manager and project dependencies.
npm exec --cache .cache/npm --yes --package=pnpm@10.18.3 -- pnpm install --frozen-lockfile

# One-time rendering-browser download.
node --input-type=module -e 'import {ensureBrowser} from "@remotion/renderer"; await ensureBrowser({chromeMode:"headless-shell"});'
```

This uses a cached pnpm launcher; a global pnpm or Corepack installation isn't required. Setup downloads dependencies and the browser. The `--offline` launcher commands below refuse to fetch a missing launcher; they do not certify that every child process has no network access.

### 2. Check the equipment. Say action.

```bash
npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm explain-to-me doctor

npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm explain-to-me build \
  --manifest fixtures/golden-manifests/whisper-vs-tts.json \
  --tts apple --voice Samantha --duration 60s --output out/my-first-explainer

open out/my-first-explainer/video.mp4
```

Choose a **new output directory** each time. Existing targets are refused. Doctor explains missing requirements; optional model backends may be absent for this build.

## Three ways to explain a thing

**Experimental on this branch:** add Claudia beside selected scenes with a local presenter pack. The [two-command demo](docs/claudia.md) needs no generation service and preserves credits and provenance. See the [feature plan](docs/plans/2026-10-22-claudia-presenter.md).

### “Use this document. Keep setup simple.”

Template mode selects source material deterministically; it is extractive, rather than semantic summarization. Replace the fixture with your `.md` or `.txt` file:

```bash
npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm explain-to-me build \
  fixtures/inputs/cached-builds/document.md \
  --director template --tts apple --voice Samantha \
  --duration 60s --output out/document-template
```

Markdown supports headings, paragraphs, lists, fenced code, and bounded local PNG/JPEG/WebP references. Code and HTML stay inert. Web pages and PDFs aren't inputs in 0.2.1.

### “Let a local model direct it.”

Install llama.cpp with `llama-server` at `/opt/homebrew/bin/llama-server`, the path expected by the current adapter. Kokoro setup also needs Python 3 and `uv`; it creates an isolated Python 3.11 environment. These optional setup commands download pinned model/runtime assets:

```bash
python3 scripts/setup-director.py
python3 scripts/setup-kokoro.py

npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm explain-to-me build \
  fixtures/inputs/cached-builds/document.md \
  --director local --tts kokoro --voice af_heart --duration 60s \
  --audience "curious software engineers" \
  --pronunciations fixtures/inputs/cached-builds/pronunciations.json \
  --output out/document-local
```

`--director local` requires that backend on macOS. `--director auto` reports an extractive fallback when local direction is unavailable, including on Windows. `--tts auto` prefers installed Kokoro and can fall back to Apple speech on macOS; Windows requires Kokoro. No cloud/subscription model adapter is built in.

### “I want to edit the script.”

Open a build's `manifest.json`, review its narration and scene intent, and rebuild it with `--manifest`. The [bundled manifest](fixtures/golden-manifests/whisper-vs-tts.json) is a complete example; the [JSON schema](packages/contracts/schema/production-manifest.schema.json) describes the structure. Changing a document's requested duration can change its selected script; rebuilding a manifest keeps the narration fixed.

Useful knobs:

| Option | What it does |
|---|---|
| `--duration 60s` | Requests 10–600 seconds; measured speech must fit within the accepted tolerance. |
| `--audience "new teammates"` / `--style "friendly and concise"` | Guides document direction; doesn't add renderer themes. |
| `--pronunciations map.json` | Changes spoken forms, e.g. `{"PCM":"P C M"}`, while preserving visible text. |
| `--cache-dir path` | Moves the cache from `.explain-to-me/cache`. |
| `--output path` | Writes to a new directory. |

Run `pnpm explain-to-me --help` or `--version` through the cached launcher above. This is a source checkout CLI; no global executable or npm package is published.

## Let your agent handle setup

Use your existing local coding agent to install v0.2.1 on Windows. Explain-to-Me is a local CLI, so any harness that can read files and run Windows commands can follow the same prompt; no Explain-to-Me plugin or cloud API key is required for the Kokoro/template pipeline.

| Harness | Example |
|---|---|
| **Codex app or CLI** | Open a local Windows folder in Codex, or start `codex` there. Paste: “Install Explain-to-Me v0.2.1 on this Windows PC using the Windows installer prompt below, then make the bundled demo.” |
| **Claude Code** | Open a local project in Claude Code, or start `claude` there. Paste: “Set up Explain-to-Me v0.2.1 on this Windows PC. Follow the Windows installer prompt below and return the demo video path.” |
| **Another local AI harness** | Give it the same prompt with local terminal/file access. A remote chat without access to this PC cannot install local tools. |

Copy the full prompt below, or open the [plain-text installer prompt](docs/install-windows-agent.txt). Your harness may request scoped permission for setup downloads, workspace creation, or native Windows media processes. Follow its normal approval flow. [Codex Windows guidance](https://learn.chatgpt.com/docs/windows/windows-sandbox) · [Claude Code setup](https://code.claude.com/docs/en/setup).

```text
Install Explain-to-Me v0.2.1 on this Windows x64 PC and make its first demo video.
Repository: https://github.com/TommyAllsup/explain-to-me

1. Use a new checkout of tag v0.2.1 named explain-to-me-v0.2.1. Leave existing
   projects unchanged. Read README.md, docs/windows.md, and
   docs/agent-integration.md at that tag before running setup.
2. Check Node.js 24+ with npm and Git. Resolve missing prerequisites through
   this machine's approved install process, or report the exact action needed.
3. From the checkout, run node scripts/setup.mjs. It prepares the pinned package
   manager, local Python/Kokoro, render browser, and Windows launcher, and uses
   bundled FFmpeg. Do not install global Python/pnpm/FFmpeg or download a local
   AI director. Verify node scripts/explain.mjs --version reports 0.2.1.
4. Create a new private workspace outside the checkout. Copy the bundled
   fixtures/golden-manifests/whisper-vs-tts.json there as story.json. Follow
   docs/windows.md to run scripts/agent-explainer.py with the setup-created
   .venv-kokoro/Scripts/python.exe: doctor, then a prepared-manifest build with
   --tts kokoro --voice af_heart --duration 60s. For later document builds, use
   --director template. Keep private inputs, jobs, and caches in that workspace.
5. Use the harness's normal scoped permission approvals for downloads and local
   Windows processes if needed. Do not disable its safeguards globally. Report
   the tag/commit, version, doctor result, job JSON, video/caption/report paths,
   and any remaining prerequisite. Do not upload private inputs or outputs.

Automated QC is separate from my approval of the script and finished movie.
```

[The full agent setup guide](docs/quick-install.md) includes Windows and macOS commands and the private-workspace workflow. The launcher returns structured JSON and retains failed-job diagnostics; it doesn't install models, update Git, or upload your work.

## What's in the goodie bag?

| File | Contents |
|---|---|
| `video.mp4` / `audio.wav` | The movie and narration audio. |
| `captions.vtt` / `captions.srt` | Captions timed to measured sentence/phrase audio chunks. |
| `manifest.json` | The validated script and scene plan. |
| `report.json` | Automated media checks, timings, cache state, assets, and provenance. |

Approved images are copied into `assets/`; scene-boundary samples support review. A manifest alone isn't the full reproducibility record: keep the build report and pinned environment too. Independent cold speech synthesis isn't promised to be bit-identical, and concurrent cold builds can duplicate work.

## When the film crew drops a clipboard

- **Browser missing:** run the one-time Headless Shell setup. Builds never download it automatically.
- **The duration doesn't fit:** review measured attempts; shorten a long script, add reviewed narration to a short one, or change the target. Speech isn't truncated or padded to force a match.
- **macOS local-director socket path too long:** use a shorter user-owned `TMPDIR` or private workspace path. The macOS director retains private Unix transport.
- **Build failed:** inspect the retained staging/job diagnostics. Redact source text and personal paths before sharing logs.

## Small release, clear boundaries

The macOS local model director uses a private Unix socket. Windows uses template direction. Renderer requests are restricted and audited on both platforms. Whole-process no-egress verification remains open. Local-first isn't a security certification; see [SECURITY.md](SECURITY.md).

Model output is constrained manifest data. Approved image paths are bounded, copied, and hash-checked. These controls aren't a sandbox guarantee. Automated checks and source mappings help inspection; they don't establish factual correctness, pleasant narration, or human approval. Watch and listen before sharing.

Custom cartoons, imported music, per-sentence pacing, word-aligned captions, ASR/listening review, PDF input, 1080p output, and a Studio UI aren't built-in 0.2.1 features. The [roadmap](ROADMAP.md) tracks what's next.

## Help make the explanations better

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, small fixes, and synthetic examples are welcome. Windows and Linux CI cover typechecking and unit tests; real narration/media builds need their own checks.

- [Changelog](CHANGELOG.md) · [0.2.1 release notes](docs/releases/0.2.1.md)
- [Windows verification evidence](docs/benchmarks/windows-support.md) · [Acceptance targets](docs/benchmarks/acceptance.md)
- [Agent integration](docs/agent-integration.md) · [System boundaries](docs/architecture/0001-system-boundaries.md) · [Renderer decision](docs/architecture/0002-renderer-selection.md)

Historical benchmark reports retain their original scope; they're not universal performance claims.

## License

Created by **Tommy Allsup**. Project code is [MIT-licensed](LICENSE).

Remotion, models, voices, browsers, dependencies, and supplied assets retain their own terms. Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing or deploying commercially. Package metadata stays `private: true` to prevent accidental npm publication; GitHub source availability is separate.
