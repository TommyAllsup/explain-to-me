# Claudia's speaking character test

Claudia's selected default is **Chatterbox with Bella as the voice reference**. The user chose this performance after comparing the animated Bella and Chatterbox tests. The default retains the approved Chatterbox recording, phoneme alignment, word-timed facial expressions, gaze, blinks, and connected body gestures from study 05.

The selection applies to this standalone SVG character experiment. The general explainer CLI still uses its existing Kokoro and Apple speech backends. Claudia's local speaking voice is separate from the creator's Suno singing-voice preset.

## Build Claudia's default performance

With the repository's renderer setup complete, run from the repository root using Node 24 and a fresh output directory:

```powershell
node --import tsx scripts/claudia-character/main.ts --output out/claudia-character-default
```

When `--performance` is omitted, the runner reads [selected-voice.json](../../fixtures/presenters/claudia/selected-voice.json) and uses the approved inputs in [approved-chatterbox](../../fixtures/presenters/claudia/approved-chatterbox/). That bundle contains the exact `audio.wav`, `timings.json`, and alignment `report.json` used in the accepted trial. Rendering needs no speech synthesis, realignment, or model download. The selected profile records the original English 500M Chatterbox model, package version, generation settings, Bella reference, and accepted artifact hashes.

The bundle also retains `reference-bella.wav` for future Chatterbox synthesis.
Its hash identifies the accepted voice reference even if ignored audition
outputs are removed. Default builds verify the approved audio, timing, and
provenance hashes, then check the complete derived mouth and acting controls
against the reviewed performance. The bundle preserves exact JSON bytes across
Git checkouts so Windows line-ending conversion cannot invalidate those hashes.

Pass `--performance <directory>` explicitly to render another saved take, including the historical Bella baseline. This does not change the selected default. Recreating a voice recording can change its pacing and waveform; preserving the saved recording and timing is what keeps this approved performance intact.

Default promotion validation: TypeScript checking and all 46 character tests
pass. Building with only `--output out/claudia-character-default` passes all 11
media checks and produces byte-identical `render-props.json` and `video.mp4`
compared with the approved Chatterbox trial. The movie remains SHA-256
`33b1bdceeee3a8656f3abb05cbcd4e4d5ec20e02dfd5da29dea78486970f72f6`.

## Compare Bella and Chatterbox

Run `python scripts/claudia-character/compare-performances.py` from the repository
root to package the accepted Bella v4 and Chatterbox movies. It uses the installed
FFmpeg/FFprobe and Pillow; `--ffmpeg`, `--ffprobe`, and `--font` can supply local
paths. Use `--output` with a fresh directory for later comparisons.

The output `out/claudia-character-comparison/index.html` opens directly in a
browser. Both characters appear at the same scale, with their own captions.
**Hear Bella** and **Hear Chatterbox** switch the audible take while preserving
the playhead, play/pause state, and volume. Use the native fullscreen control for
closer facial review. `comparison.mp4` offers the same picture twice, with Bella
audio first and Chatterbox audio second; each pass labels the audible side.

Both recordings retain their natural speed. A shared start does not align every
word: the performances have different pauses and emphasis. Bella's last picture
holds for three extra frames to match Chatterbox's 357-frame duration; neither
performance is stretched. This compares the accepted complete performances,
including their separately authored facial timing. It does not change the
selected default voice.

The packager checks the accepted source hashes and their passing render reports,
copies the original AAC audio packets without transcoding, and verifies audio
packet equality, complete decode, dimensions, frame counts, and durations. Its
`report.json` records source/output hashes and all media checks. Generated media
stays under ignored `out/`; the script and player template live on this branch.

## Chatterbox performance trial

The fifth study, now the selected default, uses the exact **C — Chatterbox** recording from the
[local prosody auditions](../claudia-prosody/README.md). It keeps the recording's
14.84-second delivery and gives it its own phoneme alignment, captions, facial
cues, and body timing. The accepted Bella v4 movie remains available in
`out/claudia-character-v4/` for comparison.

`prepare-chatterbox-performance.py` copies the audition WAV byte-for-byte and
aligns its actual audio to the reviewed script with a pinned
[Meta phoneme acoustic model](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft).
Contextual eSpeak transcription supplies the expected phonemes; constrained CTC
alignment locates them in the recording. The report preserves model hashes,
raw acoustic token frames, confidence, and the interpretation of blank gaps.
The model has 20 ms frames. Short blank gaps are divided between neighboring
sounds, and diphthongs receive visual subdivisions inside their aligned interval.
These are automatic timing estimates, not human annotations or measured lip motion.

The aligned words anchor restrained expression accents on “remembers,” “forget,”
“yesterday's,” “today's,” “keep,” and “refresh.” Diagram and reflective glances
have held targets and return to direct eye contact for the closing question.
Blinks sit near phrase boundaries. Facial intentions are authored for this
script; the system does not infer emotion from voice pitch or volume.

The accepted shoulder, chest, arm, finger, and head movement is smoothly retimed
to the new sentence boundaries. Its overlapping movement stays connected across
boundaries. Lip closures and rounded vowels keep priority over smiles. Explicit
Bella renders retain their original facial and body behavior; the Chatterbox
default supplies its own facial acting track and body retiming.

The following historical preparation commands reproduce the alignment stage;
they are unnecessary for rendering the bundled default. The trial used the
existing `C:/Python311/python.exe` CPU environment with Torch,
Transformers, NumPy, and SciPy, plus the existing Kokoro environment solely for
its eSpeak phonemizer. Model weights live on D:. Run from the repository root,
using fresh performance and render output directories:

```powershell
$phoneModels = 'D:/CodexModels/ClaudiaAuditions20261022/alignment/wav2vec2-phoneme'
& C:/Python311/python.exe scripts/claudia-character/prepare-chatterbox-performance.py --prepare --model-directory $phoneModels
& C:/Python311/python.exe scripts/claudia-character/prepare-chatterbox-performance.py --model-directory $phoneModels --output out/claudia-chatterbox-performance
node --import tsx scripts/claudia-character/main.ts --performance out/claudia-chatterbox-performance --output out/claudia-character-chatterbox
```

Use Node 24 as required by the repository. Preparation refuses changed audition
audio and records the exact script, reference, aligner, and waveform hashes.
Rendering validates complete word coverage and ordered timing before accepting
the performance. It uses the installed local renderer and browser; no speech
model is loaded during rendering.

### Chatterbox validation — 2026-10-22

The finished movie is `out/claudia-character-chatterbox/video.mp4`:
1280 × 720, 24 fps, 357 frames (14.875 seconds). Its source is the exact
356,160-sample audition WAV, SHA-256
`20cd6bb34b566fadee4a2e37d1897a86e472d8cc060409bc2f2477fbfe2b6767`.
The audio/video endpoint difference is 35 ms. All 11 media checks pass, with no
browser errors or external browser requests. `character-closeup.mp4` retains the
audio with a 560 × 620 crop; its full decode also passes.

The aligner produced 41 words, 159 IPA intervals, and six caption cues. Strict
checkpoint loading confirmed every tensor was supplied; two legacy weight-norm
names are migrated to the current Torch names without changing tensor values.
Median phoneme posterior is .945; eight low-confidence phones remain identified
in the report. Eight independently recognized word onsets agree within 47 ms.
These measurements support inspection, rather than certify perfect lip sync.

TypeScript checking and all 42 character tests pass. Review sheets inspect eight
expressions, four full blinks, three bilabial contacts, two rounded vowels, and
the final resting mouth. The sampled m/b/p frames show complete contact with no
visible mouth interior; rounded vowels retain their shape during facial acting.
The blink samples show closed lids without iris leakage. A full composition
frame checks the connected gesture, teaching graphic, and caption clearance.
The sheets are `expressions-review.png`, `mouth-review.png`, and
`blink-review.png` alongside the movie. Human playback remains the test of
delivery and personality.

Final movie SHA-256:
`33b1bdceeee3a8656f3abb05cbcd4e4d5ec20e02dfd5da29dea78486970f72f6`.

## Bella's accepted facial and body performance

The fourth iteration adds facial acting: a brief glance toward the diagram before the explaining gesture, an upward reflective glance during the question, and direct eye contact during the caution and closing invitation. Gaze moves quickly between held targets. The eyelids close over fixed-size irises and pupils, with full contact and a slower reopening. Asymmetric brows, lower-lid tension, cheek lift, and mouth corners distinguish warmth, curiosity, and thoughtful caution. These cues are authored for the six sentences in this study; they do not infer emotion from arbitrary narration.

The accepted third-iteration body motion stays intact. The pelvis stays planted while the chest shifts and turns through a continuous spine deformation. The shoulder prepares each reach, then relaxes as the upper arm, forearm, and fingers arrive in sequence. Both arms keep their segment lengths and attach to the moving shoulders. The jacket, collar, lapels, and neck share the same deformation; the head follows the neck with a small delayed counter-tilt. A reflective weight shift and a smaller closing invitation give the performance contrast without continuous swaying.

Continuous sleeve contours and a single hand shape preserve the second iteration's improvements. The hand turns from a partly edge-on relaxed position into an open gesture without swapping drawings. Movement is independent of speech loudness and does not reset at each sentence. The source is a separate Remotion composition, leaving the presenter's still-image manifest workflow unchanged.

The mouth uses Bella's saved IPA phoneme intervals to blend closure, width, rounding, teeth, and tongue controls. It explicitly seals m/b/p and distinguishes rounded vowels, broad vowels, and f/v. Audio energy only moderates opening. The facial expression changes the corners without changing the speech opening; rounded vowels suppress the smile, and full lip contact hides the mouth interior. These are authored visemes, not measured facial performance; consonant timing and visible shape still need human review.

## Recreate the historical Bella baseline

For a new Bella comparison take, complete the repository's normal renderer and local Kokoro setup. The helper uses the fixed [bella-baseline.json](../../fixtures/presenters/claudia/bella-baseline.json) profile, independently of Claudia's selected default. Run these commands from the repository root with Node 24 and the existing Kokoro environment, replacing the FFmpeg path with an existing local executable:

```powershell
.venv-kokoro/Scripts/python.exe scripts/claudia-character/prepare-performance.py --output out/claudia-bella-new-performance --ffmpeg /absolute/path/to/ffmpeg
node --import tsx scripts/claudia-character/main.ts --performance out/claudia-bella-new-performance --output out/claudia-character-bella-new
```

On macOS or Linux, use `.venv-kokoro/bin/python` for the first command. Performance preparation obtains the audio and phoneme timestamps in the same local synthesis call. It then normalizes loudness to -19 LUFS without changing the sample count. The performance directory contains `audio.wav`, `timings.json`, `raw.wav`, and `report.json`.

Kokoro does not reproduce the audition's waveform exactly across calls, so the test uses the fresh take's own timing. The voice, script, and speed match the historical Bella profile; the recording is new.

For comparisons with the original Bella performance, pass the existing `out/claudia-bella-performance` directory to the renderer. This keeps that recording and its timings identical while comparing the movement.

Use a fresh output directory for every build. No browser, model, font, or character asset is downloaded during the experiment. Set `CHROME_PATH` to an already installed compatible browser when normal renderer setup has not installed one. The runner reuses the application's version checks, local bundle server, restricting network proxy, and browser launcher. External browser requests fail the render and are recorded in its error details.

## Review the result

The output directory contains:

- `video.mp4`: the finished 1280 × 720, 24 fps character test with the selected performance's audio.
- `audio.wav`: the unchanged recording used for that render; the default uses the approved Chatterbox take.
- `captions.vtt` and `captions.srt`: captions aligned to the accepted timing.
- `manifest.json` and `report.json`: prepared experiment inputs and build/QC evidence, including browser network attempts. This experiment manifest is not a CLI `ProductionManifest`.
- Sample PNGs for checking expressions, gestures, content, and captions.
- `silent.mp4`: the intermediate rendered picture before audio muxing.

Watch the MP4 with sound to judge the delivery and Claudia's personality together. Inspect transitions as well as held poses: gaze holds and reconnection, clean eyelid contact, expression changes during speech, sleeve continuity, hand orientation, and neck attachment. Media integrity checks cannot establish that acting looks human. All pose and mouth decisions derive from saved inputs and the video frame, so repeated playback follows the same animation.

Character attribution: **Claudia by anabology**. This code-authored interpretation is part of the local feature experiment; see [the presenter documentation](../../docs/claudia.md) for reference and provenance context.

## Reference-led revision

The first rig exposed separate sleeve pieces, folded an elbow almost 180 degrees, switched hands abruptly, and raised/lowered the arm at each sentence boundary. The rewrite removes that construction rather than adding easing to it. The shoulders and neck also needed continuous silhouettes; resting palms now turn toward the thighs instead of presenting both hands to camera.

Official resources reviewed on 2026-10-22:

- [Character canon](https://claudia.gallery/claudia/): calm, curious expression and a small defined mouth informed the restrained resting face.
- [Expression reference](https://claudia.gallery/img/ev-01/lead-black-face-3.m.webp), [avatar front](https://claudia.gallery/i/am-15b.av2-front.4/), and [turnaround](https://claudia.gallery/i/am-15b.av2-sheet.2/): inspected for expression, silhouette, and coherent shoulders. These are reference images, not skeletal rigs; their proportions are stylized.
- [Performance guidance](https://claudia.gallery/wiki/seedance/): specific actions tied to narrative moments, clear speech/silence behavior, and pilot review informed the acting track.
- [Consistency record](https://claudia.gallery/wiki/consistency/): the films' stand-in model became motion-reference material for generated footage. No ready-to-load Claudia rig or blendshape library was found in the reviewed public resources.

The source remains an original SVG interpretation. The resources above were consulted as references; no generated film footage or remote assets are loaded by the renderer.

## Fourth-iteration validation — 2026-10-22

The full output is `out/claudia-character-v4/video.mp4`; `face-closeup.mp4` is a narrated 560 × 620 crop for expression review. Bella's audio, phoneme controls, timing, and captions are byte-identical to v3. The full composition remains 354 frames, 1280 × 720 at 24 fps, with a 27 ms audio/video endpoint difference. All 11 media gates pass; browser errors and external browser requests are empty.

TypeScript checking and all 34 character tests pass. The 11 additional face tests cover full blink contact across frame alignments, slower reopening, stable gaze targets and reconnection, restrained expression differences, fixed iris/pupil geometry, clean eyelid closure, and smile controls that preserve lip contact and vowel rounding. Run `node --import tsx --test scripts/claudia-character/acting.test.ts scripts/claudia-character/posture.test.ts scripts/claudia-character/lipsync.test.ts scripts/claudia-character/motion.test.ts scripts/claudia-character/expressions.test.ts scripts/claudia-character/Eye.test.ts scripts/claudia-character/Mouth.test.ts`.

The pilot's `expressions-review.png` samples greeting, reassurance, diagram glance, reflection, caution, and invitation. `blink-review.png` covers frames 23–30; `gaze-review.png` covers the diagram glance and return. A full composition frame checks expression readability at normal scale. No iris leakage or collapsed pupils were visible in the sampled blink. The curious brow partly disappears beneath the fringe, so its gaze and head tilt carry some of that expression. This is a restrained authored performance, not captured facial acting or an animation-quality guarantee.

The pilot and final render produce identical MP4 SHA-256 `5a6792303212d932f0715f94ce1bd086c3e602812c54a4815ece84d9e6183234`. Review sheets remain under `out/claudia-character-v4-pilot/`.

## Third-iteration validation — superseded facial acting

The output is `out/claudia-character-v3/video.mp4`. It reuses the exact Bella recording and phoneme timing from v2: 354 frames, 1280 × 720 at 24 fps, with a 27 ms audio/video endpoint difference. All 11 media gates pass; browser errors and external browser requests are empty.

TypeScript checking and all 23 character tests pass. The new tests verify planted hips, constant arm lengths, shared shoulder attachments, head/neck alignment, clothing-path deformation, chest preparation, shoulder relaxation, finger follow-through, and bounded frame-to-frame motion. Run `node --import tsx --test scripts/claudia-character/acting.test.ts scripts/claudia-character/posture.test.ts scripts/claudia-character/lipsync.test.ts scripts/claudia-character/motion.test.ts`.

Review samples cover the reach (2.00–3.75 seconds), recovery (5.25–8.00 seconds), and closing invitation (11.75–13.50 seconds), plus a full composition frame at maximum reach. The sampled sequences retain connected neck and sleeve roots, coherent jacket details, a planted hem, and clear space around captions and teaching content. The pilot contact sheets are `out/claudia-character-v3-pilot/reach-review.png`, `recovery-review.png`, and `invite-review.png`.

The pilot and final render produce identical MP4 SHA-256 `ebb315eafc0c204a49bed42325dea975e1430432ee88bd74b34cb3f71f5a13c3`. This is still an authored 2D performance with a small gesture vocabulary. Geometry and media checks establish repeatability and continuity; the video remains the artifact for judging whether the acting feels natural.

## Second-iteration validation — superseded motion

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
