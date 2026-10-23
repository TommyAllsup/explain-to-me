# Third-party components and usage terms

The [MIT license](LICENSE) covers Explain-to-Me project code. It does not relicense dependencies, model weights, voice packs, fonts, browsers or imported assets. No blanket commercial-use clearance or complete dependency-license audit is claimed.

## Claudia character and fixtures

`fixtures/presenters/claudia/claudia.webp` is an AI-generated gallery image credited to **Claudia by anabology**. It is supplied under the creator's [use terms](https://claudia.gallery/use/), separately from the MIT project code. Source, retrieval date, prompt metadata, and terms notes are in the [fixture README](fixtures/presenters/claudia/README.md) and `pack.json`.

The bundled animated presenter is a manual SVG adaptation of Claudia, developed with AI assistance. The renderer displays the character credit. Its frozen Bella reference and approved audition speech are synthetic voice fixtures; they are not the creator's music-video voice. The [selected profile](fixtures/presenters/claudia/selected-voice.json) preserves the choice and reference hash.

## Renderer

The pipeline currently uses Remotion through a renderer adapter. Remotion has its own licensing and usage terms; making this wrapper MIT-licensed does not make Remotion MIT-licensed or waive those terms. Review the terms for the actual pinned version and your intended use:

- [Remotion license and terms](https://www.remotion.dev/docs/license)
- Installed package license files and the versions pinned in `package.json` / `pnpm-lock.yaml`

## Optional local models

Models are downloaded during explicit setup, not shipped in source archives. Setup scripts pin assets, verify hashes and write provenance. A recorded license identifier is not a completed suitability review.

- [Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M)
- [Kokoro voice information](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)
- [kokoro-onnx runtime](https://github.com/thewh1teagle/kokoro-onnx)
- [Qwen model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)
- [Quantized director distribution](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF)
- [llama.cpp runtime](https://github.com/ggml-org/llama.cpp)
- [Chatterbox runtime](https://github.com/resemble-ai/chatterbox) and [model card](https://huggingface.co/ResembleAI/chatterbox), used by the optional Claudia backend with its watermark retained
- [Wav2Vec2 phoneme alignment model](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft), [phonemizer](https://github.com/bootphon/phonemizer), and the installed eSpeak NG runtime

Read code, model and voice terms separately. Follow the pinned release/provenance references rather than assuming a mutable landing page describes the downloaded bytes.

## Other runtime components

FFmpeg/ffprobe, Apple speech, the installed rendering browser, Python packages and JavaScript dependencies retain their respective terms. Refer to the installed distributions and provenance for exact versions/configurations.

## Your inputs and outputs

Supply only materials you have permission to process. Redistribution of images, fonts, music or generated output may require separate rights. User-provided declarations are provenance, not automatic rights clearance. Imported background music is not a built-in 0.2 feature.

## Release movie soundtrack

The v0.2.0 getting-started movie uses **“Business As Usual” by tommyallsup**, supplied by the project owner for this release. The original audio file is not bundled with the source. The project code's MIT license does not relicense this soundtrack or grant separate rights to reuse the music.

This file is a component/terms guide, not a complete legal assessment or third-party source distribution.
