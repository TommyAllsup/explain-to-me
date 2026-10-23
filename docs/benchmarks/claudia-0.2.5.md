# Claudia 0.2.5 integration validation

Validated locally on 2026-10-22 on `codex/claudia-0.2.5`. This records a development build, not a published release or human acceptance of every generated performance.

## Ordinary CLI acceptance

The neutral [three-scene manifest](../../fixtures/presenters/claudia/animated-story.json) was built with the normal launcher, using an empty dedicated cache and the registered local runtime:

```sh
node scripts/explain.mjs build --manifest fixtures/presenters/claudia/animated-story.json --output out/claudia-0.2.5-app --cache-dir .explain-to-me/cache/claudia-0.2.5-acceptance
node scripts/explain.mjs build --manifest out/claudia-0.2.5-app/manifest.json --output out/claudia-0.2.5-warm --cache-dir .explain-to-me/cache/claudia-0.2.5-acceptance
```

Node 24, Windows 11 x64, RTX 3070 Ti, CUDA 12.4, Chatterbox 0.1.7, PyTorch/torchaudio 2.6.0+cu124. CPU alignment used PyTorch 2.9.1, Transformers 4.40.1, and the pinned wav2vec2 snapshot. Phonemizer 3.4.0 and espeakng-loader 0.2.4 supplied contextual phones. Registration and builds reused already installed models; neither acceptance build downloaded assets.

| Result | Cold build | Saved-manifest rebuild |
|---|---:|---:|
| Requested duration | 25.000 s | 25.000 s |
| Measured narration | 23.240 s | 23.240 s |
| Frames at 24 fps | 558 | 558 |
| Speech cache | 11 misses / 11 writes | 11 hits / 0 writes |
| Render cache | Miss | Hit |
| All 11 media gates | Pass | Pass |
| Wall time through validation | 128.8 s | 26.2 s |

Wall times are observations from this machine, not performance guarantees. The warm path still verifies prerequisites, model bytes, muxing, and media QC. It reused the same render key, `0f7b335698cc24dd6334e7b3a7d1884cc296320b1ab2898b79104d5fb735eda0`.

Both outputs have identical hashes:

- MP4 SHA-256: `e0393f7b66562d614f3258bc2e44a4ebef54336efd12401068591860fdf9e905`
- WAV SHA-256: `bd422254758910b59291282869909caba39df627f05c73c84f6a4584a893655c`

The media gates cover duration against the **measured** natural-speech timeline, A/V synchronization, caption coverage/end, clipping/silence, frame count, scene samples, full decode, WAV format, and exact PCM sample totals. Reports continue to label whole-process egress unverified and human review pending.

## Visual and motion review

Inspected a six-frame contact sheet and full-size samples from all three scenes. Teaching text, captions, and attribution remained readable and separate. Hair, hands, and body stayed within the reserved presenter panel.

An independent sample of all 558 derived poses found finite values throughout. Maximum wrist movement was 1.983 rig pixels/frame, maximum wrist acceleration 0.955 rig pixels/frame squared, and the largest scene-cut wrist displacement was 0.014 rig pixels. The approved connected shoulder/torso anatomy and relaxed gesture recovery were retained.

Local Whisper screening covered the whole recording without supplying the script as a prompt. Both models retained the story, with numeric formatting differences; the small model misrecognized the name, and both flagged the short phrase beginning “Show.” These are recognition flags, not established substitutions or a listening review. Audio/performance approval remains a human review step.

## Regression evidence

- Full TypeScript suite: 105 tests, 100 passed, 5 existing platform/opt-in skips, no failures. Real builds separately exercised rendering and all media gates.
- TypeScript typecheck passed.
- Python agent/bridge/setup suites: 34 tests, 33 passed, one existing Windows privilege-dependent skip.
- CLI version reports `explain-to-me 0.2.5`.
- Tests cover still-presenter compatibility, automatic backend selection, incompatible options, stale/malformed alignment, pronunciation/display-text separation, rig-source cache identity, reduced motion, and bounded gesture recovery.
- Real eSpeak checks covered contractions, one-word questions, version numbers such as `0.2.5`, and standalone punctuation.
- A real short-utterance failure exposed the 400 ms loudness-block limit; the corrected path uses bounded RMS normalization for short clips without padding. Registration publication tests cover concurrent destinations and explicit replacement.

The earlier experiment outputs and frozen approved voice/reference fixtures remain unchanged. Music, general pacing controls, project configuration, and the separate 0.3 work were outside this validation slice.
