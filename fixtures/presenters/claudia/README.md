# Claudia presenter fixtures

`animated-story.json` is the neutral three-scene 0.2.5 app example. Build it through the ordinary CLI after [optional local setup](../../../docs/claudia-setup.md). It selects Claudia in the manifest and synthesizes fresh speech; it does not replay the approved audition recording.

The selected animated voice is recorded in `selected-voice.json`.
`approved-chatterbox/` retains the approved synthetic speech, the frozen Bella
voice reference, and the alignment timing and report. Its `.gitattributes`
preserves the exact bytes checked by the character runner. These are local
generated voice fixtures; they do not contain the creator's Suno Voice.

Claudia by anabology · AI-generated image from the DOWNFORCE gallery.

- Image: [rh-02-plates.id-full.4](https://claudia.gallery/i/rh-02-plates.id-full.4/)
- Downloaded: 2026-10-22, [720 px WebP](https://claudia.gallery/img/rh-02-plates/id-full-4.s.webp)
- [Use terms](https://claudia.gallery/use/), reviewed 2026-10-22: the creator permits commercial and noncommercial character work and use of gallery images as material; credit is appreciated. This asset is supplied under those terms, separately from this repository's MIT code license. This does not imply an Anthropic or anabology endorsement.
- [Canon data](https://claudia.gallery/api/canon.json), read 2026-10-22.

`pack.json` records the downloaded bytes' SHA-256, gallery prompt plus published parameters, the matching exact identity text and its SHA-256, source, and attribution. These are declared gallery records, not independent verification of the generation process. The gallery omits its creator's personal Midjourney profile; this is not a promise of pixel-identical regeneration. We preserve the published historical full-length prompt as used, rather than silently replacing it with today's recommended shorter identity text.

`story.json` is a synthetic 30-second script for exercising title, bullets, and outro still-presenter panels. That workflow uses the speech backend explicitly selected in the build command. See [the workflow](../../../docs/claudia.md).

For the separate [animated character test](../../../scripts/claudia-character/README.md), `selected-voice.json` records the user's choice of original English Chatterbox with Bella as the voice reference. It pins the model profile, generation settings, and approved performance hashes. `approved-chatterbox/` contains the exact accepted `audio.wav`, `timings.json`, and alignment `report.json`, allowing the default animation to render without speech synthesis or realignment. Its lip sync, expressions, gaze, blinks, and body timing preserve the approved Chatterbox test.

`bella-baseline.json` retains the earlier Kokoro Bella profile for explicit comparisons. `voice-audition.json` supplies the shared script and original three Kokoro casting candidates. These local speaking voices are separate from Claudia's music-video voice. The 0.2.5 CLI provides the selected Chatterbox/Bella profile as an optional local backend.
