# Add Claudia as a local presenter

This experimental workflow adds a credited still beside selected scenes in a reviewed manifest. It works with other characters too. Image discovery and generation happen separately; preparation and building use supplied local files.

## Try the supplied example

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

## Voice casting experiment

Three local speaking-voice auditions are configured in [voice-audition.json](../fixtures/presenters/claudia/voice-audition.json): A (`af_bella`), B (`af_heart`), and C (`af_nicole`). Each uses the same text at speed 1.0, with natural duration and matched loudness. The user selected **A — Bella** on 2026-10-22; [selected-voice.json](../fixtures/presenters/claudia/selected-voice.json) records that choice and the reviewed audition hash.

The [animated character test](../scripts/claudia-character/README.md) pairs a timed Bella performance with a layered SVG Claudia. Its third iteration connects the chest, shoulders, arms, clothing, and head through a shared body pose: the torso prepares each gesture, the shoulder relaxes into the reach, and the fingers and head follow. It retains continuous sleeves, relaxed hands, and blended phoneme-guided mouth shapes. The standalone 14.75-second Remotion composition uses the existing local renderer and media checks. It is a separate experiment, not a new animation field in the production manifest. Mouth shapes are an authored approximation using model timing; visual acting quality still needs human review.

The creator describes a shared singer across the first three films; the agent-made CLODYSSEY/BLISS takes reused a Suno Voice derived from ESCAPE VELOCITY. That voice lives in its creator's account. Later films deliberately vary the voice. These local Kokoro auditions are casting alternatives, not that original Voice or measured matches to it. [Creator's voice notes](https://claudia.gallery/wiki/song/), checked 2026-10-22.

To regenerate with the setup-created Python and an existing FFmpeg executable, select a fresh output directory whose parent already exists:

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
