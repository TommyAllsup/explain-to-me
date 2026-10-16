# Explain-to-Me 🎬

**Your document has a point. Give it a voice, a whiteboard, and a tiny movie premiere.**

Explain-to-Me turns local Markdown, plain text, or a reviewed script into narrated, captioned explainer videos. A local model can plan the story; deterministic scenes do the drawing; measured speech keeps the whole crew on time.

**v0.2.0 · First open source release · macOS-first · TypeScript CLI · MIT project code**

[![Watch the goofy Explain-to-Me getting-started video](docs/images/how-it-works.jpg)](https://tommyallsup.github.io/explain-to-me/)

**[▶ Watch the getting-started movie](https://tommyallsup.github.io/explain-to-me/)** · [Download the MP4](https://github.com/TommyAllsup/explain-to-me/releases/download/v0.2.0/explain-to-me-v0.2.mp4) · [Give your agent the installer prompt](#let-your-agent-handle-setup)

*The release movie gets a bespoke cartoon-and-music treatment; [its production source is here](scripts/release-video/README.md). The 0.2 CLI produces the technical-whiteboard style shown below; custom cartoons and soundtrack mixing are separate production work.*

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

*Real output, not a mockup. Version 0.2 renders 1280 × 720 at 24 fps with the technical-whiteboard theme.*

## Quickstart: roll your first tiny movie

The first build uses a prepared manifest and Apple's installed voice. **No LLM or Kokoro download required.** You'll need macOS, Node.js 24+ with npm, Git, FFmpeg/ffprobe, and the Samantha voice (`say -v '?'` lists installed voices). Linux is supported for full builds with the optional Kokoro narrator (`--tts kokoro --voice af_heart`) — Apple speech is macOS-only. With Homebrew, install FFmpeg using `brew install ffmpeg`.

### 1. Bring in the crew

```bash
git clone --branch v0.2.0 https://github.com/TommyAllsup/explain-to-me.git
cd explain-to-me

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

### “Use this document. Keep setup simple.”

Template mode selects source material deterministically; it is extractive, rather than semantic summarization. Replace the fixture with your `.md` or `.txt` file:

```bash
npm exec --cache .cache/npm --offline --yes --package=pnpm@10.18.3 -- pnpm explain-to-me build \
  fixtures/inputs/cached-builds/document.md \
  --director template --tts apple --voice Samantha \
  --duration 60s --output out/document-template
```

Markdown supports headings, paragraphs, lists, fenced code, and bounded local PNG/JPEG/WebP references. Code and HTML stay inert. Web pages and PDFs aren't inputs in 0.2.

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

`--director local` requires that backend. `--director auto` tries it and reports an extractive fallback when necessary. `--tts auto` prefers installed Kokoro and reports an Apple fallback. No cloud/subscription model adapter is built in.

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

Copy this into your coding agent. Tiny director's chair optional.

```text
Install Explain-to-Me v0.2.0 from https://github.com/TommyAllsup/explain-to-me
for this Mac. Read README.md and docs/quick-install.md at that tag first and
follow their pinned setup commands. Use a new checkout, leave existing projects
alone, and check Node.js 24+, Git, FFmpeg/ffprobe, and the Samantha voice.
Install project dependencies and the Remotion Headless Shell browser, then run
doctor. Start with Apple speech and the bundled whisper-vs-tts manifest;
do not download optional LLM/Kokoro models for this first run.
Keep my private inputs and generated jobs in a separate workspace outside the
software checkout. Use scripts/agent-explainer.py for the smoke build, following
docs/agent-integration.md. Report the exact checkout/tag, doctor result, job JSON,
video and caption paths, and any remaining prerequisites. Open the video if
possible. Automated QC is not my approval of the script or finished movie.
```

[The full agent setup guide](docs/quick-install.md) includes exact commands and the private-workspace workflow. The launcher returns structured JSON and retains failed-job diagnostics; it doesn't install models, update Git, or upload your work.

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
- **Socket path too long:** use a shorter user-owned `TMPDIR` or private workspace path. Private Unix transport remains required.
- **Build failed:** inspect the retained staging/job diagnostics. Redact source text and personal paths before sharing logs.

## Small release, clear boundaries

Local model inference uses a private Unix socket, and renderer requests are restricted and audited. Whole-process no-egress verification remains open. Local-first isn't a security certification; see [SECURITY.md](SECURITY.md).

Model output is constrained manifest data. Approved image paths are bounded, copied, and hash-checked. These controls aren't a sandbox guarantee. Automated checks and source mappings help inspection; they don't establish factual correctness, pleasant narration, or human approval. Watch and listen before sharing.

Custom cartoons, imported music, per-sentence pacing, word-aligned captions, ASR/listening review, PDF input, 1080p output, and a Studio UI aren't built-in 0.2 features. The [roadmap](ROADMAP.md) tracks what's next.

## Help make the explanations better

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, small fixes, and synthetic examples are welcome. Linux CI covers typechecking and unit tests; macOS speech and full media builds need their own checks.

- [Changelog](CHANGELOG.md) · [0.2.0 release notes](docs/releases/0.2.0.md)
- [0.2 verification evidence](docs/benchmarks/0.2-readiness.md) · [Acceptance targets](docs/benchmarks/acceptance.md)
- [Agent integration](docs/agent-integration.md) · [System boundaries](docs/architecture/0001-system-boundaries.md) · [Renderer decision](docs/architecture/0002-renderer-selection.md)

Historical benchmark reports retain their original scope; they're not universal performance claims.

## License

Created by **Tommy Allsup**. Project code is [MIT-licensed](LICENSE).

Remotion, models, voices, browsers, dependencies, and supplied assets retain their own terms. Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing or deploying commercially. Package metadata stays `private: true` to prevent accidental npm publication; GitHub source availability is separate.
