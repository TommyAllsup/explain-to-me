"""Pinned, local IndexTTS-2.5 audition. Run with its isolated Python environment.

First use --prepare to download the selected inference weights. Then run without
--prepare. The existing Bella recording is input only and is never uploaded.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import shutil
import subprocess
import sys
import time
import wave


ROOT = Path(__file__).resolve().parents[2]
SOURCE_REVISION = "d9e41aac89fd00b3d71497fddb287b7f24613712"
REFERENCE_SHA256 = "3188194b9e9cacc7e35b48fbb2095b5d139adfe967abd4c2f5dd5cc5bade1733"
MODELS = [
    ("IndexTeam/IndexTTS-2.5", "c39ce5ba981572cb187443877ff559dfb246ce63", "", [
        "LICENSE", "README.md", "codec.pth", "config.yaml", "feat1.pt", "feat2.pt",
        "gpt.pth", "multilingual_zh_ja_yue_char_del.tiktoken", "s2mel.pth", "wav2vec2bert_stats.pt",
    ]),
    ("facebook/w2v-bert-2.0", "da985ba0987f70aaeb84a80f2851cfac8c697a7b", "hf_cache/w2v-bert-2.0", [
        "config.json", "model.safetensors", "preprocessor_config.json", "README.md",
    ]),
    ("nvidia/bigvgan_v2_22khz_80band_256x", "633ff708ed5b74903e86ff1298cf4a98e921c513", "hf_cache/bigvgan", [
        "config.json", "bigvgan_generator.pt", "LICENSE", "README.md",
    ]),
    ("funasr/campplus", "e4b6ede7ce16997aff4ae69fbca1f0175e2afede", "hf_cache", [
        "campplus_cn_common.bin",
    ]),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def prepare(args: argparse.Namespace) -> None:
    from huggingface_hub import HfApi, hf_hub_download

    records = []
    for repo_id, revision, subdir, filenames in MODELS:
        info = HfApi().model_info(repo_id, revision=revision, files_metadata=True)
        remote = {item.rfilename: item for item in info.siblings}
        needed = sum(remote[name].size for name in filenames
                     if not (args.model_dir / subdir / name).exists())
        free = shutil.disk_usage(args.model_dir).free
        if free < needed + 2 * 1024**3:
            raise RuntimeError(f"Insufficient space for {repo_id}: need {needed} bytes plus 2 GiB headroom")
        print(f"Downloading {repo_id}@{revision}: {needed / 1024**3:.2f} GiB", flush=True)
        for name in filenames:
            path = Path(hf_hub_download(repo_id, name, revision=revision, local_dir=args.model_dir / subdir))
            digest = sha256(path)
            expected = remote[name].lfs.sha256 if remote[name].lfs else None
            if expected is not None and digest != expected:
                raise RuntimeError(f"Model checksum mismatch: {repo_id}/{name}")
            records.append({"repo": repo_id, "revision": revision, "file": name,
                            "localPath": str(path), "bytes": path.stat().st_size,
                            "sha256": digest, "verifiedAgainstHubLfs": expected is not None})
    provenance = {
        "schema": "claudia-indextts-setup/v1",
        "source": "https://github.com/index-tts/index-tts",
        "sourceRevision": SOURCE_REVISION,
        "model": "IndexTeam/IndexTTS-2.5",
        "modelRevision": MODELS[0][1],
        "python": platform.python_version(),
        "platform": platform.platform(),
        "setupCommand": "uv sync --frozen --no-dev --python 3.11 (no optional extras)",
        "uvLockSha256": sha256(args.source_dir / "uv.lock"),
        "packages": sorted(f"{package.metadata['Name']}=={package.version}"
                           for package in importlib.metadata.distributions()),
        "weights": records,
        "omittedOptionalWeights": ["QwenEmotion", "MaskGCT (2.5 uses codec.pth)",
                                   "w2v conformer_shaw duplicate", "BigVGAN training optimizers"],
    }
    write_json(args.setup, provenance)
    print(f"Setup provenance: {args.setup}", flush=True)


def run(args: argparse.Namespace) -> None:
    import numpy as np
    import torch

    if args.output.exists() or args.output.with_suffix(".json").exists():
        raise FileExistsError(f"Refusing to overwrite an existing audition: {args.output}")
    reference = ROOT / "out/claudia-bella-performance/audio.wav"
    if sha256(reference) != REFERENCE_SHA256:
        raise RuntimeError("Bella reference differs from the accepted frozen performance")
    source_revision = subprocess.check_output(
        ["git", "-C", str(args.source_dir), "rev-parse", "HEAD"], text=True).strip()
    if source_revision != SOURCE_REVISION:
        raise RuntimeError(f"Expected source revision {SOURCE_REVISION}, got {source_revision}")
    setup = json.loads(args.setup.read_text(encoding="utf-8"))
    if setup["modelRevision"] != MODELS[0][1]:
        raise RuntimeError("Model setup revision differs from the pinned audition")
    script_path = ROOT / "fixtures/presenters/claudia/voice-audition.json"
    text = json.loads(script_path.read_text(encoding="utf-8"))["text"]
    if not torch.cuda.is_available():
        raise RuntimeError("The requested local GPU audition requires CUDA")
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    torch.set_num_threads(4)
    sys.path.insert(0, str(args.source_dir))
    # Upstream uses this cwd for package-relative assets and some cache paths.
    os.chdir(args.source_dir)
    from indextts.infer_v2_5 import IndexTTS2

    started = time.perf_counter()
    model = IndexTTS2(cfg_path=str(args.model_dir / "config.yaml"),
                      model_dir=str(args.model_dir), device="cuda:0", use_bf16=True,
                      use_cuda_kernel=False, use_deepspeed=False, use_accel=False,
                      use_torch_compile=False, use_qwen_emo=False)
    loaded = time.perf_counter()
    # Gentle warmth and composure. The remaining emotion conditioning comes
    # from Bella herself; no random emotion exemplar or external speaker.
    settings = dict(lang="EN", emo_vector=[0.12, 0, 0, 0, 0, 0, 0.04, 0.18],
                    emo_alpha=1.0, use_random=False, use_emo_text=False,
                    duration_factor=1.0, interval_silence=0,
                    max_text_tokens_per_segment=120, do_sample=True,
                    top_p=0.8, top_k=30, temperature=0.8, num_beams=3,
                    length_penalty=0.0, repetition_penalty=10.0, max_mel_tokens=1500,
                    text_normalization=False)
    # Short independent prompts introduced extra utterances in the first take.
    # Preserve the complete discourse and let the model perform its own pauses.
    segments = model.split_text_by_tokens(text.lower(), 120, "<|en|> ")
    if segments != [text.lower()]:
        raise RuntimeError("The complete audition must fit one 120-token segment")
    detected_low_vram = model.low_vram
    model.low_vram = False
    # The unchanged reference is encoded twice (speaker and emotion), then
    # cached. Offload this unused encoder after those identical GPU operations
    # to leave enough VRAM for the longer, coherent speech decoder sequence.
    original_get_emb = model.get_emb
    embedding_calls = 0

    def cached_reference_embedding(input_features, attention_mask):
        nonlocal embedding_calls
        embedding = original_get_emb(input_features, attention_mask)
        embedding_calls += 1
        if embedding_calls == 2:
            model.semantic_model.to("cpu")
            gc.collect()
            torch.cuda.empty_cache()
            print("Reference embeddings cached; W2V-BERT offloaded to CPU", flush=True)
        return embedding

    model.get_emb = cached_reference_embedding
    args.output.parent.mkdir(parents=True, exist_ok=True)
    print("Synthesizing the complete script as one coherent segment", flush=True)
    model.infer(spk_audio_prompt=str(reference), text=text, output_path=str(args.output),
                verbose=False, **settings)
    finished = time.perf_counter()
    with wave.open(str(args.output), "rb") as audio:
        audio_info = {"sampleRate": audio.getframerate(), "channels": audio.getnchannels(),
                      "frames": audio.getnframes(), "durationSeconds": audio.getnframes() / audio.getframerate(),
                      "sampleWidthBytes": audio.getsampwidth()}
    write_json(args.output.with_suffix(".json"), {
        "schema": "claudia-prosody-audition/v1", "engine": "IndexTTS-2.5",
        "sourceRevision": SOURCE_REVISION, "modelRevision": MODELS[0][1],
        "setupProvenance": str(args.setup), "setupProvenanceSha256": sha256(args.setup),
        "runnerSha256": sha256(Path(__file__)), "seed": args.seed,
        "text": text, "scriptFileSha256": sha256(script_path),
        "reference": str(reference), "referenceSha256": REFERENCE_SHA256,
        "settings": settings, "precision": "bfloat16 GPT; upstream defaults for auxiliary models",
        "gpu": torch.cuda.get_device_name(0), "detectedLowVram": detected_low_vram,
        "segmentation": "One complete script; no external splits or inserted pauses",
        "segments": [text], "interSentenceSilenceMs": 0,
        "memoryPolicy": "W2V-BERT moved to CPU after both unchanged reference embeddings were computed on GPU",
        "referenceEmbeddingCalls": embedding_calls,
        "loadSeconds": loaded - started, "generationSeconds": finished - loaded,
        "peakAllocatedGpuBytes": torch.cuda.max_memory_allocated(),
        "audio": audio_info, "outputSha256": sha256(args.output),
        "postProcessing": "Native upstream PCM16 encoding, amplitude clamp, and 20 ms tail fade; no external processing",
        "replacesTake": {"file": "index-tts-2.5-first-take.wav",
                         "sha256": "a27e63497ccf5e886e06d29d475cd37560650bb011ad7c95ee8d218496c027d1",
                         "reason": "Independent ASR and energy checks found extra utterances after the very short first two sentence prompts"},
        "note": "Fixed seed records sampling; cross-device byte-identical generation is not guaranteed.",
    })
    print(json.dumps({"output": str(args.output), "audio": audio_info,
                      "generationSeconds": finished - loaded}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--source-dir", type=Path, default=ROOT / ".explain-to-me/experiments/indextts/repo")
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--setup", type=Path, default=ROOT / ".explain-to-me/experiments/indextts/setup.json")
    parser.add_argument("--output", type=Path, default=ROOT / "out/claudia-prosody-raw/index-tts-2.5.wav")
    parser.add_argument("--seed", type=int, default=20261022)
    args = parser.parse_args()
    for key in ("source_dir", "model_dir", "setup", "output"):
        setattr(args, key, getattr(args, key).resolve())
    args.model_dir.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(args.model_dir / ".hf")
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["NLTK_DATA"] = str(args.model_dir / ".nltk")
    os.environ["PYTHONIOENCODING"] = "utf-8"
    if not args.prepare:
        os.environ["HF_HUB_OFFLINE"] = "1"
    (prepare if args.prepare else run)(args)


if __name__ == "__main__":
    main()
