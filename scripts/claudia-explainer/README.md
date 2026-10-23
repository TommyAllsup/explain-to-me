# Ben's guide to e-girls

A roughly two-minute Claudia explainer made for Ben's question, with a cheerful
Chatterbox performance over Tommy's **Slogans in the Rain** instrumental.
This is a standalone feature-branch experiment, not a ProductionManifest.

The eight-scene script and factual sources are in `ben-egirls.json`. Jokes target
internet vocabulary, accessories, and the dramatic soundtrack. The explanation
treats e-girl as a contextual style/persona label people can choose for themselves.

## Playful performance revision

`ben-egirls-playful.json` is the second cut: 268 words, shorter conversational
phrases, and 16 locally generated speech segments. Explanations use restrained
Chatterbox expression; greetings and comic setups are brighter. Complete takes
are joined with 4.77 seconds of authored pauses before alignment. No playback
speed or pitch change is used, and the selected Bella reference stays fixed.

The script also defines 29 acting anchors. Gesture preparation, held looks,
comic reactions, and recovery follow the newly aligned words. Cat-ear headphones
appear during the setup; the zero-RAM result waits for the spoken payoff.
The sincere labels scene lets the comic beats breathe.

Use these arguments for this cut instead of the v1 paths below:

```powershell
$taskNode = 'C:/Users/tommy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$voicePython = 'D:/CodexModels/ClaudiaAuditions20261022/chatterbox/venv/Scripts/python.exe'
& $voicePython scripts/claudia-explainer/prepare-narration.py synthesize --script scripts/claudia-explainer/ben-egirls-playful.json --output out/ben-egirls-playful-narration --seed-offset 2000
& C:/Python311/python.exe scripts/claudia-explainer/prepare-narration.py align --script scripts/claudia-explainer/ben-egirls-playful.json --output out/ben-egirls-playful-narration
& C:/Python311/python.exe scripts/claudia-explainer/prepare-narration.py check --script scripts/claudia-explainer/ben-egirls-playful.json --output out/ben-egirls-playful-narration
& $taskNode --import tsx scripts/claudia-explainer/main.ts --script scripts/claudia-explainer/ben-egirls-playful.json --narration out/ben-egirls-playful-narration --output out/ben-egirls-playful
& C:/Python311/python.exe scripts/claudia-explainer/mix-final.py --outputdir out/ben-egirls-playful
```

The first cut remains at `out/ben-egirls-final/video.mp4`. Synthesis preserves
each raw segment, its seed/settings, exact joins, and the inserted pause samples
in the new narration's provenance reports.

The accepted playful cut is **119.17 seconds**. Its label scene was retaken at
seed offset 3000 after splitting the rushed first attempt into two thoughts;
the other seven scenes retain offset 2000. The synthesis command above creates
fresh candidates. To verify/reuse the accepted mixed-seed takes already here,
replace its seed arguments with `--only-scene the-label --seed-offset 3000`, or
skip synthesis and use the reviewed existing WAVs. See the copied voice review
and `performance-audit.json` beside the final video for the accepted take hashes
and the full-frame motion checks.

## Rebuild locally

Use the installed Node 24 runtime, repository dependencies, full system FFmpeg,
and the cached Claudia audition models. These commands do not download models.
Run from the repository root; the final output directory must be new. Skip
synthesis when using the already generated, reviewed takes in this workspace.
The delivered cut is `out/ben-egirls-final/video.mp4` (121.5 seconds).

```powershell
$taskNode = 'C:/Users/tommy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$voicePython = 'D:/CodexModels/ClaudiaAuditions20261022/chatterbox/venv/Scripts/python.exe'
& $voicePython scripts/claudia-explainer/prepare-narration.py synthesize
& C:/Python311/python.exe scripts/claudia-explainer/prepare-narration.py align
& C:/Python311/python.exe scripts/claudia-explainer/prepare-narration.py check
& $taskNode --import tsx scripts/claudia-explainer/main.ts --output out/ben-egirls
& C:/Python311/python.exe scripts/claudia-explainer/mix-final.py --outputdir out/ben-egirls --music 'C:/Users/tommy/Downloads/Slogans in the Rain.mp3'
```

Review the independent ASR transcript and reported differences before accepting
a new take. ASR verifies intelligibility imperfectly; it does not judge delivery.
Synthesis resumes existing matching scene files. To audition another take, use
`--output` with a fresh narration directory and optionally `--seed-offset`.
Pass that directory to `main.ts --narration`.

The accepted definition scene uses seed 20262023 (base seed + scene index + 1000)
after one pronunciation retake. The other seven scenes use the base seed plus
their scene index. To verify/reuse this existing mixed-seed set, synthesis needs
`--only-scene the-definition --seed-offset 1000`; it rejects requests whose seed
identity differs from an existing take. `out/ben-egirls-narration/content-review.json`
records the replacement and the two accepted ASR transcription differences.

For staged rendering, use `main.ts --prepare-only`, inspect `render-props.json`,
then `main.ts --render-only` with the same output path. Rendering refuses to
overwrite a silent video; mixing refuses existing final deliverables.

## Performance and timing

- Original English Chatterbox, selected Bella reference, pinned cached model and
  synthesis settings from Claudia's accepted voice experiment.
- Natural speech speed. Per-scene audio is preserved; only constant gain and
  silence padding are applied. Float masters retain model peaks before delivery
  normalization. The Chatterbox watermark is retained.
- Local phoneme alignment drives the approved lip rig. Word times anchor facial
  expression accents, glances, captions, and the cat-ear visual reveal.
- Claudia keeps the connected shoulder/torso/arm rig. New gestures prepare,
  hold, and recover once per idea; the short audition is not looped.
- 1280 × 720 at 24 fps. The 24 kHz narration uses exactly 1,000 samples per frame.
  Intro: 42 frames. Scene gaps: 10 frames. Outro: 72 frames.
- The music is measured, normalized, and ducked beneath speech. Intro/outro
  swells and fades retain the requested contrast. The mixer checks against the
  actual song duration, decodes the whole result, and checks encoded true peak.

Final outputs include `video.mp4`, captions (`.srt`/`.vtt`), script/sources,
render and mix reports, music credit/hash, plus audio stems for inspection.
Generated media stays under ignored `out/`; the source experiment is versioned.

## Credits

Claudia by [anabology](https://claudia.gallery/claudia/), interpreted with the
existing manual SVG rig. Synthetic Chatterbox voice, with the approved Bella
reference. Music: the exact user-provided Downloads file **Slogans in the Rain.mp3**;
its file metadata credits **tommyallsup** and identifies it as instrumental.
The video uses an excerpt of that song, not the separate vocal trance edit.

Research links and the claims they support are recorded in `ben-egirls.json`
and copied to each build's `sources.txt`.
