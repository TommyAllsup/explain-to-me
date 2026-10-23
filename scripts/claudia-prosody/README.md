# Claudia local prosody auditions

Compare the accepted Kokoro Bella performance with IndexTTS-2.5 and original
English Chatterbox, using the same script and that Bella recording as the audio
reference. After the listening and animated comparisons, the user selected
**Chatterbox as Claudia's default** and retained the approved lip sync and facial
expressions. See the [character workflow](../claudia-character/README.md) to
render that saved performance without loading speech models.

These audition tools on `codex/claudia-presenter` remain available for explicit
comparisons. Running them does not change the selected profile. Chatterbox is
the default for the standalone Claudia character experiment; it is not yet a
speech backend in the general explainer CLI.

The frozen input is `out/claudia-bella-performance/audio.wav`, SHA-256
`3188194b9e9cacc7e35b48fbb2095b5d139adfe967abd4c2f5dd5cc5bade1733`.
It is the accepted performance, not the earlier casting audition file. All
runners read the exact text in `fixtures/presenters/claudia/voice-audition.json`.
Keep a copy of this input with the audition bundle: regeneration with a similar
voice is not an interchangeable reference.

The selected Chatterbox runner now reads the byte-identical tracked copy at
`fixtures/presenters/claudia/approved-chatterbox/reference-bella.wav`. This keeps
the accepted reference available independently of the historical `out/` bundle.

## Listening comparison

The finished bundle is `out/claudia-prosody-auditions/`:

- `A-current-bella.wav`: the accepted Bella file, copied unchanged.
- `B-index-tts-2.5.wav`: IndexTTS-2.5 conditioned on Bella.
- `C-chatterbox.wav`: original English Chatterbox conditioned on Bella.
- `raw/`: original model outputs and settings, before loudness matching.
- `provenance/`: model setup records, reference report/timings, and script fixture.
- `auditions.json`: hashes, durations, loudness, processing, and validation.
- `content-check.json`: independent local speech-recognition check with Whisper small.en.

Listen for question intonation in the last sentence, emphasis on “when to
forget,” pauses around “Keep it too long,” and whether the vowels, accent, and
vocal texture still sound like Bella. The candidates approximate her identity
from audio; they do not load Kokoro's `af_bella` voice embedding.

All listening files are mono PCM16 at 24 kHz and matched to Bella's measured
integrated loudness. There is no pitch shift or duration correction. Index's
native 22.05 kHz output is resampled; Chatterbox is natively 24 kHz. The baseline
remains byte-identical. Speech recognition screens for lost/repeated words; it
does not establish naturalness or voice similarity.

## Local environments and storage

The trial machine has an RTX 3070 Ti with 8 GiB VRAM and about 32 GiB RAM.
Run the engines **serially in separate processes**, and wait for each process
to exit before loading another engine or the speech recognizer. Concurrent
CUDA imports exhausted Windows commit memory during the first Index load.
The serialized retry succeeded without changing system settings.

Python environments and model downloads are independent of `.venv-kokoro`.
This trial stores new model weights on
`D:/CodexModels/ClaudiaAuditions20261022/`, since C: has limited room. Use another
disk with sufficient free space on another machine. Model weights, environments,
and generated audio are not committed. Preparation downloads public model files;
the reference recording is only read locally during generation.

### IndexTTS-2.5

Source revision: `d9e41aac89fd00b3d71497fddb287b7f24613712` from
[index-tts/index-tts](https://github.com/index-tts/index-tts).
Model revision: `c39ce5ba981572cb187443877ff559dfb246ce63` from
[IndexTeam/IndexTTS-2.5](https://huggingface.co/IndexTeam/IndexTTS-2.5).
The model's license is included among its downloaded files.

The isolated environment uses Python 3.11.2 and the source's frozen `uv.lock`
without optional extras (PyTorch 2.8.0 with CUDA 12.8). Its actual location here
is `.explain-to-me/experiments/indextts/env/`; source is adjacent at `repo/`.
The setup record includes the lockfile hash and installed package versions.
Auxiliary W2V-BERT, BigVGAN, and CAMPPlus weights are also revision-pinned.
Optional Qwen emotion-model and training weights are omitted.

For a fresh checkout, with Python 3.11 and `uv` installed, create the isolated
source checkout and environment once (run from this repository's root):

```powershell
$indexSource = Join-Path (Get-Location) '.explain-to-me/experiments/indextts/repo'
$env:UV_PROJECT_ENVIRONMENT = Join-Path (Get-Location) '.explain-to-me/experiments/indextts/env'
$env:UV_CACHE_DIR = 'D:/CodexModels/ClaudiaAuditions20261022/uv-cache'
git clone https://github.com/index-tts/index-tts.git $indexSource
git -C $indexSource checkout d9e41aac89fd00b3d71497fddb287b7f24613712
uv sync --project $indexSource --frozen --no-dev --python 3.11
```

Then prepare weights and generate, from this repository's root:

```powershell
$env:PYTHONIOENCODING = 'utf-8'
$indexPython = '.explain-to-me/experiments/indextts/env/Scripts/python.exe'
$indexModels = 'D:/CodexModels/ClaudiaAuditions20261022/indextts'
& $indexPython scripts/claudia-prosody/index_tts.py --prepare --model-dir $indexModels
& $indexPython -u scripts/claudia-prosody/index_tts.py --model-dir $indexModels
```

The runner uses BF16 for the language model, a restrained warmth/calm emotion
vector, seed 20261022, and the model's natural duration. The complete script fits
one 120-token segment, with no externally inserted pauses. After computing both
Bella reference embeddings on the GPU, it moves the now-unused W2V-BERT encoder
to CPU to leave VRAM for the continuous speech sequence. Vendor source and
embedding computation are unchanged. All settings are in the sidecar.

An earlier take generated six sentences separately; independent recognition and
excerpt checks flagged extra utterances after the very short opening sentences.
That take and its exact runner remain in the raw experiment directory as
`index-tts-2.5-first-take.*`, but are excluded from the listening comparison.

### Chatterbox

Use **original English 500M Chatterbox**, not Turbo or Nano. The original model
exposes the exaggeration and classifier-free guidance controls used here.
[Source](https://github.com/resemble-ai/chatterbox) and
[model](https://huggingface.co/ResembleAI/chatterbox) use the MIT license.
Model revision: `5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18`.

This trial's environment is
`D:/CodexModels/ClaudiaAuditions20261022/chatterbox/venv/`, with Python 3.11.2,
`chatterbox-tts==0.1.7`, `torch==2.6.0+cu124`, and
`torchaudio==2.6.0+cu124`. Install those PyTorch wheels from the official CUDA
12.4 wheel index before the Chatterbox package. The setup JSON records all
resolved dependencies, including Transformers 5.2.0.
Install `setuptools==80.9.0` in this environment too: Perth 1.0.1 imports its
`pkg_resources` API, which a fresh unseeded `uv` environment does not provide.
The runner surfaces a missing watermark dependency before loading speech models.

```powershell
$chatterboxEnv = 'D:/CodexModels/ClaudiaAuditions20261022/chatterbox/venv'
$env:UV_CACHE_DIR = 'D:/CodexModels/ClaudiaAuditions20261022/uv-cache'
uv venv --python 3.11 $chatterboxEnv
$chatterboxPython = "$chatterboxEnv/Scripts/python.exe"
uv pip install --python $chatterboxPython --index-url https://download.pytorch.org/whl/cu124 torch==2.6.0+cu124 torchaudio==2.6.0+cu124
uv pip install --python $chatterboxPython chatterbox-tts==0.1.7 setuptools==80.9.0
```

Then prepare weights and generate:

```powershell
$env:PYTHONIOENCODING = 'utf-8'
$chatterboxPython = 'D:/CodexModels/ClaudiaAuditions20261022/chatterbox/venv/Scripts/python.exe'
$chatterboxModels = 'D:/CodexModels/ClaudiaAuditions20261022/chatterbox/models'
& $chatterboxPython scripts/claudia-prosody/chatterbox_audition.py --prepare --model-dir $chatterboxModels
& $chatterboxPython -u scripts/claudia-prosody/chatterbox_audition.py --model-dir $chatterboxModels
```

The runner uses one complete script, seed 20261022, exaggeration 0.65,
CFG weight 0.35, and temperature 0.8. Upstream reads the first 6 seconds of Bella
for speech prompting, the first 10 seconds for decoder conditioning, and the
full reference for its speaker embedding. The native Perth watermark remains.

## Observed local generation

Final takes, 2026-10-22, on the trial machine:

| Take | Audio duration | Model load | Generation | Peak allocated GPU tensors |
|---|---:|---:|---:|---:|
| Current Bella | 14.723 s | Existing accepted recording | Reused unchanged | — |
| IndexTTS-2.5 | 13.735 s | 15.84 s | 17.25 s | 5.76 GiB |
| Chatterbox | 14.840 s | 6.00 s | 22.34 s | 3.66 GiB |

Load/generation times omit Python imports and download/setup time. GPU tensor
allocation omits context and allocator overhead; total Index GPU usage reached
about 7.8 GiB during the earlier segmented trial. These are single-run
observations, not latency guarantees. Both final new takes use continuous
generation and their own pacing.

The final local `small.en` check recognized all intended wording in all three
takes, with only the same “A cache” / “Akash” homophone and word-boundary
ambiguity. It resolved the smaller recognizer's uncertainty about Chatterbox's
“I'm Claudia” opening and found none of the rejected Index take's extra phrases.
The final raw recordings have no clipped PCM samples. Listening files use a
−0.3 dBTP ceiling so matching Bella's loudness does not require compression.

## Check and package

Once both generation processes exit, run the optional CPU wording check in an
environment with `openai-whisper==20240930`, CPU PyTorch, SciPy, and SoundFile.
This machine already has those in `C:/Python311/python.exe`; no global packages
were changed. `--prepare` fetches the selected official model the first time.
The checker verifies their SHA and reuses checks only for identical inputs.

```powershell
& C:/Python311/python.exe scripts/claudia-prosody/check_content.py --model small.en --prepare --output out/claudia-prosody-raw/content-check-small.json
$mediaTools = 'node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.535/node_modules/@remotion/compositor-win32-x64-msvc'
& C:/Python311/python.exe scripts/claudia-prosody/package_auditions.py --raw-dir out/claudia-prosody-raw --baseline-dir out/claudia-bella-performance --output out/claudia-prosody-auditions --ffmpeg "$mediaTools/ffmpeg.exe" --ffprobe "$mediaTools/ffprobe.exe"
Copy-Item out/claudia-prosody-raw/content-check-small.json out/claudia-prosody-auditions/content-check.json
```

The package helper needs only Python's standard library and FFmpeg/FFprobe.
It checks the reference, script, output and setup hashes, complete decode,
sample counts, duration, loudness, and clipping. Normalization must stay linear;
it refuses dynamic compression or unexpected timing changes. Existing output
files/directories are refused. Use `--output` with fresh paths for further takes.
Model seeds record sampling settings; byte-identical synthesis across different
devices or library versions is not guaranteed.
