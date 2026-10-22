# Saved projects, reviewed scripts, and music (0.3 working tree)

This unreleased workflow adds project JSON, a script review before speech, narration previews, chosen pacing, and one local music track. It uses the existing 720p/24 fps technical-whiteboard renderer. The tag-pinned 0.2.1 quickstarts remain valid for that release; these commands require the updated working tree.

## Plan, review, preview, build

Run from the installed checkout. Create a fresh, neutral example project with an original generated music pad:

```sh
node scripts/create-example-project.mjs --output out/measured-walk
node scripts/explain.mjs plan --project out/measured-walk/project.json --output out/measured-walk/plan
```

Planning writes editable `manifest.json`, provenance in `plan.json`, and any approved image assets. It performs no speech synthesis or frame rendering. Read and edit `plan/manifest.json` before continuing: review each scene's title, narration text, visuals, and stable IDs. Optional `spokenText` provides an explicit spoken form; project preparation preserves it as a single chunk and applies configured pronunciations. `plan.json` is provenance, not an approval form. The tool does not assert that choosing a plan constitutes human approval.

```sh
node scripts/explain.mjs preview --project out/measured-walk/project.json --plan out/measured-walk/plan --output out/measured-walk/preview
node scripts/explain.mjs build --project out/measured-walk/project.json --plan out/measured-walk/plan --output out/measured-walk/movie
```

Listen to `preview/audio.wav`; watch and listen to `movie/video.mp4`. Preview uses the same text preparation, pronunciations, voice, pace, and speech cache as the full build. It selects up to three prepared chunks and 600 characters of visible or spoken text; add `--passage measure-passage` or `--scene measure` to choose the example's excerpt. An oversized explicit spoken passage must be split in the reviewed plan before preview. Preview contains narration only. It writes measured captions and `preview.json`, including the selected chunks, timing, cache work, signal checks, and pending human review.

The [neutral fixture](../fixtures/projects/measured-walk/project.json) binds the [bundled story](../fixtures/projects/measured-walk/story.json). The example generator copies both and creates `pad.wav`; the generated track does not require a download. To use a different installed narrator, edit `narration.backend` and `narration.voice` in the saved project before preview/build: `apple`/`Samantha` on macOS, or `kokoro`/`af_heart` on macOS or Windows. Backend `auto` uses the existing selection/fallback behavior; use an explicit backend for repeatable comparisons.

## Project format

The [JSON schema](../packages/contracts/schema/project.schema.json) and [runtime validator](../packages/contracts/src/project.ts) define version `"1"`. Unknown properties and unsupported versions fail. Only `version`, `title`, and `input` are required; the following example shows the core settings:

```json
{
  "version": "1",
  "title": "A measured walk",
  "input": { "manifest": "story.json" },
  "direction": {
    "mode": "template",
    "audience": "curious adults",
    "style": "friendly technical whiteboard"
  },
  "narration": {
    "backend": "auto",
    "voice": "auto",
    "pronunciations": { "API": "A P I" },
    "pacing": {
      "default": 1,
      "scenes": {},
      "passages": { "measure-passage": 0.7 }
    }
  },
  "music": {
    "source": "pad.wav",
    "gainDb": -24,
    "duckingDb": -8,
    "fadeInMs": 1000,
    "fadeOutMs": 1000,
    "rights": {
      "holder": "Your track's rights holder",
      "license": "Your permission or license description",
      "note": "Any relevant usage conditions"
    }
  },
  "output": {
    "profile": "preview",
    "directory": "outputs",
    "desiredDurationMs": 60000,
    "durationPolicy": "paced"
  }
}
```

`input` contains exactly one `source` (`.md` or `.txt`) or `manifest` (`.json`). Direction applies to sources; prepared manifests bypass direction. Omitted direction defaults to `auto`, audience `software engineers`, and style `friendly technical whiteboard`. Omitted narration defaults to backend/voice `auto`, an empty pronunciation map, pace `1`, and no overrides. The example deliberately slows `measure-passage` to `0.7`. The output values above are defaults. Omit `music` to build narration alone; music settings shown above are defaults apart from its required `source` and optional rights text.

Configuration bounds:

| Setting | Accepted values |
|---|---|
| Project | At most 64 KiB; title 1–120 nonblank characters. |
| Direction | `auto`, `template`, or `local`; audience/style at most 240 characters each. Windows uses template direction; local AI direction remains macOS-only. |
| Voice | Backend `auto`, `apple`, or `kokoro`; voice ID at most 120 characters and available in the selected adapter. |
| Pronunciations | At most 64 literal terms; each term ≤80 and spoken replacement ≤160 characters, ≤4,096 combined characters; case-insensitive duplicate terms fail. |
| Pace | `0.65`–`1.25`; at most 16 scene and 128 passage overrides using existing manifest IDs. |
| Music | One WAV, MP3, M4A, AAC, FLAC, or OGG file, at most 100 MiB. Gain −60 to 0 dB; additional ducking −30 to 0 dB; integer fades 0–10,000 ms. |
| Rights | Optional `holder` (≤240), `license` (≤512), and `note` (≤2,000 characters); descriptive user-supplied information, never automatic clearance. |
| Output | Only `preview`; desired duration 10,000–600,000 ms; policy `paced` or `strict`. |

Input, music, and configured output paths are relative to the saved project's directory, use forward slashes, and are limited to 512 characters. Spaces and non-ASCII names are supported. Absolute paths, URLs, backslashes, `..`/`.` segments, empty segments, Windows device names, alternate data streams, and ambiguous trailing dots/spaces are refused. Reads must remain inside the canonical project root; linked music paths are refused. Windows reparse-point/junction paths remain unsupported. These checks are not a filesystem sandbox.

CLI `--project`, `--plan`, `--output`, and `--cache-dir` paths are explicit local selections relative to the invoking working directory when not absolute. `--output` overrides the saved output directory. Without it, a uniquely named new directory is created under `output.directory`; caches default to `<project-root>/.explain-to-me/cache`. Existing output directories are refused. Project commands reject legacy `--voice`, `--tts`, `--duration`, and direction flags: edit those settings in the project JSON so their precedence is unambiguous.

## Pace and duration precedence

Pacing values are absolute multipliers: passage override > scene override > project default. A value of `0.8` means deliberately slower speech; `1` maps to Apple 170 words/minute or Kokoro speed 1. Apple rounds its requested rate to a whole word/minute. Adapters and voices can produce different measured durations at the same multiplier.

To slow one passage, take its narration `id` from the editable plan and set, for example, `"passages": {"your-passage-id": 0.8}`. Keep that original ID when editing its text. Preparation may split the passage into sentence/phrase chunks; every derived chunk retains the original passage's override. Reports record this mapping. Unknown IDs fail instead of silently ignoring an override. Split a passage into separate reviewed narration chunks if only part should have a different pace.

The default `paced` policy synthesizes once at the chosen settings. Measured audio determines the timeline, captions, and video length; `desiredDurationMs` guides initial source planning but is advisory during production. It cannot speed up a slower passage or rewrite the selected script.

`strict` is an opt-in duration check, not automatic rate fitting. The same chosen pacing is synthesized once and must land within ±1 second of the desired duration. Otherwise the build fails with measured recovery guidance. Change the target, explicitly revise pacing, or edit and review the narration; no automatic correction, narration rewrite, speech truncation, or narration silence padding occurs. A short preview always uses paced timing; strict duration applies to the full build.

Legacy commands without `--project` retain their existing measured duration fitting and bounded rate correction behavior, including `build --manifest ... --duration 60s` and source-based builds.

## Connected Kokoro delivery

For connected phrasing, add this optional object inside `narration`:

```json
"delivery": {
  "mode": "connected",
  "sentencePauseMs": 500,
  "clausePauseMs": 100
}
```

Connected delivery synthesizes contiguous passages together within a scene at the
same resolved pace, up to 1,600 spoken characters per group. Scene changes, pacing
overrides, and the character bound create group boundaries. Chosen slower passages
remain slower. Original passage IDs, captions and visual cues use measured native
phoneme boundaries; the PCM is partitioned without dropping or duplicating speech.
Unsupported or ambiguous phoneme alignment fails instead of guessing. Review the
passage boundaries/wording, or omit `delivery` to use independent passages.

Sentence pauses are minimums from 0–1,000 ms and clause pauses from 0–500 ms;
omitted values are 250/100 ms. These are explicit delivery settings, not silence
added to reach a runtime. Measured duration, including these pauses, drives the
timeline. Strict mode still checks the chosen result without changing it. Omit
`delivery` to keep existing passage synthesis and legacy behavior. Connected mode
requires Kokoro; an unavailable Kokoro cannot silently fall back to Apple.

Preview synthesizes or reuses the full selected scene context, then extracts only
the selected passages using measured sample boundaries. The audible excerpt still
has the three-chunk/600-character limit. Extra scene context may require more
synthesis work on a cold preview, but the same groups are reusable in the full
build. Changing words, pacing, or delivery settings invalidates affected context
groups and dependent timing/rendering; music remains separate.

Punctuation in reviewed `spokenText` can influence delivery while keeping display
text intact. For example, `The good news? PHP fixes are available now.` was preferred
in the PHP voice review. This is script direction, not an automatic transformation
of every introduction. Kokoro has no reference-audio, emotion, or reliable per-word
emphasis control. Keep listening approval tied to the specific sample or movie.

## Soundtrack outputs and revisions

| Artifact | Meaning |
|---|---|
| `audio.wav` | Narration only, with unchanged measured speech samples. |
| `music.wav` | Music after gain, narration ducking, and fades, aligned to the narration timeline. |
| `mixed.wav` | Narration plus that processed music stem. |
| `video.mp4` | Video muxed with `mixed.wav` when music is configured; narration otherwise. |
| `captions.vtt` / `captions.srt` | Separate caption files timed to narration, unaffected by music. |
| `manifest.json` / `report.json` | Prepared execution manifest; measured timing, cache work, signal QC, source/configuration hashes and rights provenance. |

`duckingDb` is additional attenuation while speech is active; zero disables it. The mixer uses measured narration energy with short attack/release smoothing. It does not change narration loudness or timing. Fades start with the music and end at the earlier of track end or narration end. A short track plays once, fades out, and leaves only narration afterward; silence extends only the music stem. A long track is cut/faded at narration end. Looping, crossfades, multiple tracks, and automatic gain correction are excluded. A clipping mixture fails with guidance to lower gain or increase ducking.

Change only `music.gainDb` and build into a new output directory with the same saved plan and cache. The new mix must reuse unchanged narration and video frames: check `report.narration.synthesisWorkCount === 0` and `report.cache.render.workCount === 0`. Soundtrack settings and source hashes are excluded from those cache identities. Pacing edits resynthesize affected speech and rebuild measured timelines/captions; changed timing invalidates rendered frames. Prior outputs remain available for comparison. A changed input, direction, or project title requires a new plan; editing the selected plan changes the recorded plan hash. There is no general revision/approval history manager in 0.3.

The MP4 contains captions drawn into its video frames and no embedded selectable
subtitle track. This avoids two caption layers when a player enables closed
captions. SRT/VTT sidecars remain available for separate use; manually loading one
in a player can still add a second layer.

## Verification and human approval

For the repeatable example acceptance run, use a fresh directory:

```sh
node scripts/verify-project.mjs --tts apple --output out/project-verification
# On a prepared Kokoro installation, including Windows:
node scripts/verify-project.mjs --tts kokoro --output out/project-verification-kokoro
```

These exercise script planning, preview, normal/slower narration, music-only cache reuse, and measured timing. Automated media/signal checks, cache evidence, and a scripted edit do not constitute human script approval or a human watch/listen pass. Reports leave human review pending; record actual approval separately after inspecting the exact artifacts.

The [0.3 verification record](benchmarks/0.3-project-results.md) records macOS Apple/Kokoro builds, cache counters, strict failures and regression results. Native Windows 11 x64 verification of this 0.3 workflow is pending/unavailable in the implementation environment. Existing [Windows 0.2.1 evidence](benchmarks/windows-support.md) does not establish a 0.3 media pass. Use Kokoro with prepared manifests or template direction on Windows; Apple speech and Windows AI direction are unavailable there. Whole-process no-egress proof, ASR, cartoons, 1080p, new input formats, and a Studio UI remain outside this change.
