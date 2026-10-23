# Optional local Claudia setup

Claudia in 0.2.5 uses original English Chatterbox 0.1.7 with the frozen Bella reference selected during the character tests. Speech generation requires an NVIDIA CUDA environment. Acoustic alignment runs on the CPU in a separate Python environment. The ordinary Apple/Kokoro setup remains available without these dependencies.

This is an explicit, advanced optional setup. The normal installer does not install Chatterbox. Builds never download models or install Python packages. The initial validated target is Windows 11 x64 with CUDA; CPU generation, macOS/MPS generation, and Linux end-to-end operation are not acceptance claims for this release.

## Prerequisites

Complete the normal [Windows](windows.md) or [app setup](quick-install.md) first. Prepare these local environments using the upstream package instructions:

| Environment | Requirements |
|---|---|
| Generation | Python 3.11, `chatterbox-tts==0.1.7`, working CUDA PyTorch/torchaudio, the native `resemble-perth` watermarker, NumPy, SoundFile, and pyloudnorm |
| Alignment | Python 3.11 with CPU PyTorch, Transformers, NumPy, and SciPy |
| Phonemizer | `phonemizer==3.4.0` and `espeakng-loader==0.2.4`; the existing Kokoro environment can supply these |

See the [Chatterbox runtime](https://github.com/resemble-ai/chatterbox) and [PyTorch installation guidance](https://pytorch.org/get-started/locally/). Use isolated environments: Chatterbox's dependency constraints can conflict with the alignment stack. `python scripts/setup-claudia.py --help` lists the generation versions exercised during development. Registration checks actual imports, CUDA availability, the watermark dependency, and an eSpeak sentence; a package installation alone is not a readiness check.

## Register local models and runtimes

Substitute your own paths in this PowerShell example. All three Python paths must point to existing executables. The two model directories must contain the pinned snapshots:

```powershell
python scripts/setup-claudia.py --register `
  --generation-python C:/models/claudia/generation/Scripts/python.exe `
  --alignment-python C:/models/claudia/alignment-runtime/Scripts/python.exe `
  --phonemizer-python .venv-kokoro/Scripts/python.exe `
  --model-directory C:/models/claudia/chatterbox `
  --alignment-directory C:/models/claudia/wav2vec2-phoneme
```

For a new model installation, add **`--download-models`** to that command. This explicitly downloads about 4.5 GB from fixed Hugging Face revisions and verifies each file against the shipped [model manifest](../services/local-models/claudia-models.json). Existing matching files are reused; mismatched files are refused. This option downloads weights only, not Python environments.

Registration verifies model hashes and the approved reference before atomically writing `.explain-to-me/models/claudia/runtime.json`. It stores absolute paths on this machine and is ignored by Git. Existing registration is preserved unless you explicitly pass `--replace`. To keep configuration elsewhere, use `--config /absolute/path/runtime.json` during registration and set `EXPLAIN_TO_ME_CLAUDIA_CONFIG` to the same path for builds.

## Verify and build

```powershell
node scripts/explain.mjs doctor
node scripts/explain.mjs build --manifest fixtures/presenters/claudia/animated-story.json --output out/claudia-app
```

Doctor treats Claudia as optional and reports import/model availability. Builds additionally verify the actual checkpoint and reference hashes before cache reuse. The report records runtime versions, model identity, settings, sample counts, duration policy, and cache results.

Chatterbox retains its watermark. Generation uses a float master, then applies one constant gain per chunk with a peak limit before PCM16 conversion. Normal chunks target -18 LUFS; utterances shorter than 400 ms use -21 dBFS RMS because they cannot fill the standard loudness measurement block. Both are limited to -1 dBFS peak. Speech is neither padded nor time-stretched. Word/phoneme alignment is computed from the delivered PCM, and cached together with that exact audio.

## Troubleshooting

- **Missing configuration:** register the runtimes and models, or correct `EXPLAIN_TO_ME_CLAUDIA_CONFIG`.
- **CUDA unavailable:** check the selected generation environment and its compatible PyTorch/CUDA installation. The adapter does not silently fall back to CPU or a different voice.
- **Import or watermark failure:** repair the named package in the indicated environment, then rerun registration.
- **Model/reference hash mismatch:** restore the exact pinned files. Do not edit the recorded hashes to accept an arbitrary checkpoint.
- **Incompatible voice:** use automatic selection or `--tts chatterbox --voice chatterbox-bella`. Claudia does not use the creator's music-video voice.
- **Movie differs from requested duration:** this backend speaks naturally. Shorten or lengthen the script and review the measured result.

For scene selection, reduced motion, outputs, and the still-image alternative, see [Claudia in ordinary builds](claudia.md).
