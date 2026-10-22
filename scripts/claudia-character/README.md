# Claudia's speaking character test

This branch experiment pairs the selected **A — Bella (`af_bella`)** voice with an authored SVG character, expressive poses, and a small cache explanation. It generates a fresh Bella performance using the audition's script and natural speed, with matched loudness and no pitch or duration changes. Bella is our chosen local speaking voice, not the creator's Suno singing-voice preset.

The second iteration rebuilds the body as continuous sleeve contours, with an anchored elbow and fixed-length forearm following a restrained wrist arc. The same hand shape turns from a partly edge-on relaxed position into an open gesture; it never swaps drawings. There are two authored gestures, a small anticipatory weight shift, gaze changes, blinks, and a thoughtful head tilt. Movement is independent of speech loudness and does not reset at each sentence. The source is a separate Remotion composition, leaving the presenter's still-image manifest workflow unchanged.

The mouth uses Bella's saved IPA phoneme intervals to blend closure, width, rounding, teeth, and tongue controls. It explicitly seals m/b/p and distinguishes rounded vowels, broad vowels, and f/v. Audio energy only moderates opening. These are authored visemes, not measured facial performance; consonant timing and visible shape still need human review.

## Build the experiment

Complete the repository's normal renderer and local Kokoro setup. Run these commands from the repository root with Node 24 and the existing Kokoro environment, replacing the FFmpeg path with an existing local executable:

```powershell
.venv-kokoro/Scripts/python.exe scripts/claudia-character/prepare-performance.py --output out/claudia-bella-performance --ffmpeg /absolute/path/to/ffmpeg
node --import tsx scripts/claudia-character/main.ts --performance out/claudia-bella-performance --output out/claudia-character-test
```

On macOS or Linux, use `.venv-kokoro/bin/python` for the first command. Performance preparation obtains the audio and phoneme timestamps in the same local synthesis call. It then normalizes loudness to -19 LUFS without changing the sample count. The performance directory contains `audio.wav`, `timings.json`, `raw.wav`, and `report.json`.

Kokoro does not reproduce the audition's waveform exactly across calls, so the test uses the fresh take's own timing. The voice, script, and speed match the selected audition; the recording is new.

Use a fresh output directory for every build. No browser, model, font, or character asset is downloaded during the experiment. Set `CHROME_PATH` to an already installed compatible browser when normal renderer setup has not installed one. The runner reuses the application's version checks, local bundle server, restricting network proxy, and browser launcher. External browser requests fail the render and are recorded in its error details.

## Review the result

The output directory contains:

- `video.mp4`: the finished 1280 × 720, 24 fps character test with Bella's audio.
- `audio.wav`: the fresh timed Bella recording used for the test.
- `captions.vtt` and `captions.srt`: captions aligned to the accepted timing.
- `manifest.json` and `report.json`: prepared experiment inputs and build/QC evidence, including browser network attempts. This experiment manifest is not a CLI `ProductionManifest`.
- Sample PNGs for checking expressions, gestures, content, and captions.
- `silent.mp4`: the intermediate rendered picture before audio muxing.

Watch the MP4 with sound to judge Bella's delivery and Claudia's personality together. Inspect transitions as well as held poses: sleeve continuity, hand orientation, neck attachment, and closure/rounding during speech. Media integrity checks cannot establish that acting looks human. All pose and mouth decisions derive from saved inputs and the video frame, so repeated playback follows the same animation.

Character attribution: **Claudia by anabology**. This code-authored interpretation is part of the local feature experiment; see [the presenter documentation](../../docs/claudia.md) for reference and provenance context.

## Reference-led revision

The first rig exposed separate sleeve pieces, folded an elbow almost 180 degrees, switched hands abruptly, and raised/lowered the arm at each sentence boundary. The rewrite removes that construction rather than adding easing to it. The shoulders and neck also needed continuous silhouettes; resting palms now turn toward the thighs instead of presenting both hands to camera.

Official resources reviewed on 2026-10-22:

- [Character canon](https://claudia.gallery/claudia/): calm, curious expression and a small defined mouth informed the restrained resting face.
- [Expression reference](https://claudia.gallery/img/ev-01/lead-black-face-3.m.webp), [avatar front](https://claudia.gallery/i/am-15b.av2-front.4/), and [turnaround](https://claudia.gallery/i/am-15b.av2-sheet.2/): inspected for expression, silhouette, and coherent shoulders. These are reference images, not skeletal rigs; their proportions are stylized.
- [Performance guidance](https://claudia.gallery/wiki/seedance/): specific actions tied to narrative moments, clear speech/silence behavior, and pilot review informed the acting track.
- [Consistency record](https://claudia.gallery/wiki/consistency/): the films' stand-in model became motion-reference material for generated footage. No ready-to-load Claudia rig or blendshape library was found in the reviewed public resources.

The source remains an original SVG interpretation. The resources above were consulted as references; no generated film footage or remote assets are loaded by the renderer.

## Second-iteration validation — 2026-10-22

The revised output is `out/claudia-character-v2/video.mp4`. Bella's audio is byte-identical to the first character test. The video remains 354 frames, 1280 × 720 at 24 fps, with 27 ms between the audio/video endpoints. All 11 media gates pass; browser errors and external browser requests are empty.

TypeScript checking and all 16 character tests pass. Tests cover anticipatory m/b/p contact, vowel geometry, teeth/tongue controls, stress/length marks, phrase rests, bounded deterministic movement, and continuity across sentence boundaries. Run `node --import tsx --test scripts/claudia-character/acting.test.ts scripts/claudia-character/lipsync.test.ts scripts/claudia-character/motion.test.ts`.

The reviewed transition sequence samples 2.50–3.75 seconds at 0.25-second intervals. Additional face samples inspect frames 4 (m closure), 238 (open vowel), 273 (rounded vowel), 97 (teeth), 129 (dental), and 353 (rest). Review found and corrected the neck band, detached shoulder outlines, forward-facing resting palms, and insufficient vowel rounding. Contact sheets remain with the local output as `motion-review.png` and `mouth-review.png`.

Two final renders produced identical MP4 SHA-256 `b516ef2f53212994d316a5b275c7db269d23c2f13520f5138fb1fafdab7d91b3`. This remains limited 2D animation: planted shoulders and a small pose vocabulary constrain expressiveness; visual review does not establish human-level performance or perfect lip sync.

## First-iteration validation — superseded visually

The reviewed output is `out/claudia-character-bella/video.mp4`: 1280 × 720, 24 fps, 354 frames, 14.75 seconds. Bella's performance has 353,344 samples at 24 kHz (14.7227 seconds), -19.29 LUFS, and -0.99 dBTP. No clipped samples; audio/video endpoints differ by 27 ms. Six sentence captions end at the exact audio sample.

Both full builds passed all 11 media gates, including complete decode, audio signal checks, frame count, and 12 scene-boundary samples. Browser errors and external browser requests were both empty. Greeting, thinking, transition, explanation, and settling frames were visually inspected for anatomy and caption/content clearance.

A second render from the saved performance produced an identical MP4 SHA-256: `c5f952ec767e653ca5a6a98459bafe450e5bfaf8683d0bc3267dcc72c5cd60de`. This verifies repeatability with the saved audio, source, and installed renderer; synthesizing a new take can change the waveform and timing.

TypeScript checking passed. Focused renderer and motion tests passed 11 tests, with two opt-in Windows integration tests skipped. Six of the passing tests cover the new timing/hash checks, caption boundaries, deterministic mouth motion, and silence handling. Run them with `node --import tsx --test scripts/claudia-character/motion.test.ts`.

Those checks passed even though the first performance's arm movement was unacceptable to the user. The second iteration therefore adds transition-sequence and individual-viseme inspection rather than treating passing media checks as an animation-quality verdict.
