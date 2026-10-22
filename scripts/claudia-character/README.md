# Claudia's first speaking character test

This branch experiment pairs the selected **A — Bella (`af_bella`)** voice with an authored SVG character, expressive poses, and a small cache explanation. It generates a fresh Bella performance using the audition's script and natural speed, with matched loudness and no pitch or duration changes. Bella is our chosen local speaking voice, not the creator's Suno singing-voice preset.

The character has a black bob, orange streak, headset, and an original layered vector rig. Frame-based animation provides breathing, blinks, mouth movement, and repeatable greeting, explanation, thinking, and settling poses. The source is a separate Remotion composition, leaving the presenter's still-image manifest workflow unchanged.

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

Watch the MP4 with sound to judge Bella's delivery and Claudia's personality together. The mouth currently follows measured audio energy; it is a stylized speaking cue, not a phoneme-to-viseme lip-sync rig. Phoneme timing supports the narration beats, captions, and authored gestures. All pose and motion decisions derive from saved inputs and the video frame, so repeated playback follows the same animation.

Character attribution: **Claudia by anabology**. This code-authored interpretation is part of the local feature experiment; see [the presenter documentation](../../docs/claudia.md) for reference and provenance context.

## Validation record — 2026-10-22

The reviewed output is `out/claudia-character-bella/video.mp4`: 1280 × 720, 24 fps, 354 frames, 14.75 seconds. Bella's performance has 353,344 samples at 24 kHz (14.7227 seconds), -19.29 LUFS, and -0.99 dBTP. No clipped samples; audio/video endpoints differ by 27 ms. Six sentence captions end at the exact audio sample.

Both full builds passed all 11 media gates, including complete decode, audio signal checks, frame count, and 12 scene-boundary samples. Browser errors and external browser requests were both empty. Greeting, thinking, transition, explanation, and settling frames were visually inspected for anatomy and caption/content clearance.

A second render from the saved performance produced an identical MP4 SHA-256: `c5f952ec767e653ca5a6a98459bafe450e5bfaf8683d0bc3267dcc72c5cd60de`. This verifies repeatability with the saved audio, source, and installed renderer; synthesizing a new take can change the waveform and timing.

TypeScript checking passed. Focused renderer and motion tests passed 11 tests, with two opt-in Windows integration tests skipped. Six of the passing tests cover the new timing/hash checks, caption boundaries, deterministic mouth motion, and silence handling. Run them with `node --import tsx --test scripts/claudia-character/motion.test.ts`.
