# Claudia in ordinary builds — 0.2.5

Claudia is an optional animated presenter in the normal explainer pipeline. She uses the selected **Bella-reference Chatterbox** voice, with lip sync, expressions, gaze, and connected gestures derived from each new recording. The model runs locally after explicit setup. The bundled character rig is credited to **Claudia by anabology**.

This feature is available in [v0.2.5](releases/0.2.5.md). General voice pacing, music, and project configuration stay with the separate 0.3 work. The earlier videos remain experiments and review records.

## Build an animated explainer

Complete the normal [app setup](quick-install.md) and the optional [Claudia runtime setup](claudia-setup.md), then choose a fresh output directory:

```sh
node scripts/explain.mjs doctor
node scripts/explain.mjs build --manifest fixtures/presenters/claudia/animated-story.json --output out/claudia-app
```

The manifest already selects Claudia. To add her to your own reviewed manifest or template-directed document:

```sh
node scripts/explain.mjs build --manifest path/to/story.json --presenter claudia --output out/my-claudia-story
node scripts/explain.mjs build path/to/document.md --director template --presenter claudia --duration 60s --output out/my-claudia-document
```

The flag selects supported title, statement, bullets, and outro scenes. For selective placement, put `"presenter": {"character": "claudia"}` inside a scene's `visual` object. For quieter body movement, use `"presenter": {"character": "claudia", "motion": "reduced"}`. Diagrams, comparisons, code, and image scenes retain their teaching layouts.

Claudia selects `--tts chatterbox --voice chatterbox-bella` when the backend and voice are automatic. An incompatible explicit backend or voice is rejected. `--tts chatterbox` also works without a presenter; ordinary builds without Claudia keep their existing automatic backend selection.

**Duration is measured, not forced.** Chatterbox keeps natural speech speed. `--duration` guides document direction but does not squeeze a fixed script into that length. Reports record the requested and measured duration separately; media QC checks the complete measured audio/video/caption timeline. Shorten the script if a strict time limit matters.

Build outputs include the ordinary video, audio, captions, manifest, and report, plus `narration-alignment.json` and, for animated builds, `presenter-animation.json`. Word and phoneme timings are bound to the exact synthesized PCM. Pronunciation overrides change spoken alignment while preserving display captions. The original audition timing is not reused for new scripts.

Review `video.mp4` before sharing: automatic alignment estimates phonemes and words; the phrase gestures are deterministic heuristics, not a semantic performance director. Unchanged speech/alignment and rendered frames can be reused from the normal cache. Rebuild an emitted `manifest.json` into another fresh directory to retain scene selection.

## Still-image presenter packs

The earlier local pack workflow remains supported for Claudia and other characters. Image discovery and generation happen separately; preparation and building use supplied local files.

Complete normal [setup](quick-install.md) first. Run from this checkout and choose fresh output directories. The preparation command requires its output's parent directory to exist:

```sh
node -e "require('node:fs').mkdirSync('out', {recursive: true})"
node scripts/explain.mjs presenter --manifest fixtures/presenters/claudia/story.json --pack fixtures/presenters/claudia/pack.json --scenes welcome,receipts,finish --output out/claudia-story
node scripts/explain.mjs build --manifest out/claudia-story/manifest.json --tts kokoro --voice af_heart --output out/claudia-movie
```

On macOS, use `--tts apple --voice Samantha` instead of the Kokoro options when using installed Apple speech. Inspect `out/claudia-movie/video.mp4`, captions, and `report.json`.

Preparation copies the original manifest's assets as well as the presenter, then writes `manifest.json` with relative paths. The finished build also carries its assets. Rebuild into another fresh directory:

```sh
node scripts/explain.mjs build --manifest out/claudia-movie/manifest.json --tts kokoro --voice af_heart --output out/claudia-rebuild
```

Keep `manifest.json` and its adjacent `assets/` together when moving an output. Existing output directories are refused; source manifests and packs are not modified.

## Historical voice casting experiment

Claudia's default for the [animated character workflow](../scripts/claudia-character/README.md) is **original English Chatterbox with Bella as its voice reference**, selected by the user after comparing the complete animated performances on 2026-10-22. [selected-voice.json](../fixtures/presenters/claudia/selected-voice.json) records the model profile, generation settings, reference, and approved performance hashes. The bundled [approved Chatterbox inputs](../fixtures/presenters/claudia/approved-chatterbox/) preserve the exact recording, phoneme and word timing, and alignment report from the accepted test.

To render that default with the existing local renderer and Node 24, choose a fresh output directory:

```sh
node --import tsx scripts/claudia-character/main.ts --output out/claudia-character-default
```

The 14.875-second Remotion movie retains the approved lip sync, word-timed facial expressions, gaze, blinks, and smoothly retimed body gestures. Speech keeps control of lip closure and vowel rounding. This historical runner reuses the saved take without speech synthesis or realignment. Its facial cues were authored for that narration. The 0.2.5 build path above uses the promoted rig and derives new timing for arbitrary scripts; still-presenter commands continue to use their explicitly selected backend.

The initial [voice-audition.json](../fixtures/presenters/claudia/voice-audition.json) cast A (`af_bella`), B (`af_heart`), and C (`af_nicole`) with the same text at speed 1.0 and matched loudness. Bella was the first selection and supplied the accepted fourth-iteration animation and voice reference. [bella-baseline.json](../fixtures/presenters/claudia/bella-baseline.json) preserves that historical profile for explicit comparisons.

The later [local prosody comparison](../scripts/claudia-prosody/README.md) auditioned the accepted Bella recording against IndexTTS-2.5 and original English Chatterbox. Both new engines received the same script and Bella audio reference, with matched loudness and each model's natural timing. The [Chatterbox character trial](../scripts/claudia-character/README.md#chatterbox-performance-trial) then paired its audition C with acoustic phoneme alignment, word-timed facial cues, and connected gestures. That complete performance is now the default; the earlier Bella and comparison artifacts remain available.

The creator describes a shared singer across the first three films; the agent-made CLODYSSEY/BLISS takes reused a Suno Voice derived from ESCAPE VELOCITY. That voice lives in its creator's account. Later films deliberately vary the voice. These local Kokoro auditions are casting alternatives, not that original Voice or measured matches to it. [Creator's voice notes](https://claudia.gallery/wiki/song/), checked 2026-10-22.

To regenerate the initial three Kokoro casting auditions with the setup-created Python and an existing FFmpeg executable, select a fresh output directory whose parent already exists:

```powershell
.venv-kokoro/Scripts/python.exe scripts/claudia-voice-auditions.py --output out/claudia-voice-auditions --ffmpeg node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.535/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe
```

On macOS use `.venv-kokoro/bin/python` and the absolute path to installed FFmpeg. The helper reuses the project's local synthesis bridge. It produces playable WAVs, raw WAVs, script/config copies, and `auditions.json` with hashes, duration, and measured loudness. It performs no downloads, voice cloning, pitch changes, or duration correction. The first run produced A 14.73 s, B 14.48 s, C 22.28 s; all three decoded, retained their sample counts, and measured within 0.5 LU of the -19 LUFS target. Audio stays under ignored `out/`.

## Make your own pack

Start from [the example pack](../fixtures/presenters/claudia/pack.json). A pack contains `version: "1"` and one `asset`:

| Field | Value |
|---|---|
| `asset.id` | Unique manifest asset ID; must not collide with an existing asset |
| `asset.source` | Relative local image path from the pack, using forward slashes |
| `asset.sha256` | Lowercase SHA-256 of the exact image file bytes |
| `asset.mimeType` | `image/png`, `image/jpeg`, or `image/webp`, matching the bytes |
| `asset.provenance.character` | Character name, 1–80 characters |
| `asset.provenance.origin` | `gallery`, `generated`, or `manual` |
| `asset.provenance.credit` | Nonblank visible attribution, up to 180 characters |
| `asset.provenance.aiGenerated` | Boolean; controls the visible AI-generated image label |
| Optional provenance | `sourceUrl`, `prompt`, `identityText`, `identitySha256`, `canonUrl`, `canonRetrievedAt` |

Generated assets require their declared `prompt` (up to 6,000 characters). If recording identity wording, supply both `identityText` (up to 2,000 characters) and its SHA-256 over the exact UTF-8 text: punctuation, whitespace, and line endings matter. The digest must match. Source/canon URLs are HTTP(S) metadata, not fetch instructions; `canonRetrievedAt` is a `YYYY-MM-DD` date.

For example, compute an image hash with Node, substituting your local path:

```sh
node -e "const fs=require('node:fs'),c=require('node:crypto');console.log(c.createHash('sha256').update(fs.readFileSync('my-pack/portrait.webp')).digest('hex'))"
```

Metadata is declared by the pack author. Matching hashes prove consistency with supplied bytes/text; they do not verify authorship, generation history, or adherence to Claudia's canon. Reports mark these records `declared-not-independently-verified`.

## Select scenes and review the result

Use `--scenes` with comma-separated scene IDs. Only title, statement, bullets, and outro scenes support presenters; omitted selection uses title/outro scenes. Unknown IDs, repeated IDs, incompatible scenes, and overwriting an existing presenter are errors. The prepared scenes reference `visual.presenter.assetId`.

The image has its own panel with name, full credit, and conditional disclosure. It does not cover captions. Preview defaults to 1280×720; presenters require at least 960×540. If text cannot fit at readable sizes, shorten it, split the scene, or remove that presenter. Long credits can require a taller canvas.

Preparation limits are eight total assets, 8 MiB per image, 32 MiB total image bytes, and 128 KiB per JSON input/output. Missing files, changed hashes, invalid paths, unsupported image types, or existing destinations fail explicitly. No prompt inference or network retrieval is part of `presenter`.

## Reusable agent request

> Add a local Claudia presenter to my reviewed explainer manifest. If new source material is needed, optionally use the public Claudia MCP/API outside the build to retrieve the canon and image record. Preserve the exact identity form used and its UTF-8 hash; keep the actual prompt, source URL, retrieval date, credit, and AI declaration. Inspect the selected still. Create a local pack, then explicitly select the title/statement/bullets/outro scene IDs where she helps the explanation. Run `presenter` into a fresh directory, build that manifest with my installed local speech backend, and inspect the video and captions. Keep diagram, comparison, code, and image scenes in their existing layouts. Report supplied provenance as a declaration, not independently established fact.

The [agent interface](https://claudia.gallery/agents/), [character canon](https://claudia.gallery/claudia/), and [reuse statement](https://claudia.gallery/use/) were checked on 2026-10-22. The gallery permits reuse and appreciates “Claudia by anabology”; this workflow makes credit visible. Other parties' material in the films is outside that permission. See the [experiment plan](plans/2026-10-22-claudia-presenter.md) for scope and deferred work.
