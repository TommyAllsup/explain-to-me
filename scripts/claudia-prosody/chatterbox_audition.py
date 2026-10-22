"""Generate the original English Chatterbox audition locally from frozen Bella.

Use --prepare to fetch pinned weights without importing any speech models.
Run inference separately, with the other speech engines fully unloaded.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import shutil
import time

ROOT = Path(__file__).resolve().parents[2]
MODEL = "ResembleAI/chatterbox"
REVISION = "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"
REFERENCE_SHA256 = "3188194b9e9cacc7e35b48fbb2095b5d139adfe967abd4c2f5dd5cc5bade1733"
FILES = {
    "ve.safetensors": "f0921cab452fa278bc25cd23ffd59d36f816d7dc5181dd1bef9751a7fb61f63c",
    "t3_cfg.safetensors": "914cb1696f47527fe8852ca8f1fe1fa63cb34f76f9c715e84e067b744dd0da81",
    "s3gen.safetensors": "2b78103c654207393955e4900aac14a12de8ef25f4b09424f1ef91941f161d4e",
    "conds.pt": "6552d70568833628ba019c6b03459e77fe71ca197d5c560cef9411bee9d87f4e",
    "tokenizer.json": None,
    "README.md": None,
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def packages() -> list[str]:
    return sorted(f"{package.metadata['Name']}=={package.version}"
                  for package in importlib.metadata.distributions())


def prepare(args: argparse.Namespace) -> None:
    from huggingface_hub import hf_hub_download

    if shutil.disk_usage(args.model_dir).free < 5 * 1024**3:
        raise RuntimeError("Chatterbox preparation needs 5 GiB of disk headroom")
    weights = []
    for name, expected in FILES.items():
        print(f"Preparing {MODEL}/{name}", flush=True)
        path = Path(hf_hub_download(MODEL, name, revision=REVISION, local_dir=args.model_dir))
        actual = sha256(path)
        if expected and actual != expected:
            raise RuntimeError(f"Checksum mismatch: {name}")
        weights.append({"file": name, "localPath": str(path), "bytes": path.stat().st_size,
                        "sha256": actual, "verifiedAgainstHubLfs": expected is not None})
    write_json(args.setup, {
        "schema": "claudia-chatterbox-setup/v1", "model": MODEL,
        "modelRevision": REVISION, "variant": "Original English 500M (not Turbo or Nano)",
        "source": "https://github.com/resemble-ai/chatterbox", "license": "MIT",
        "python": platform.python_version(), "platform": platform.platform(),
        "packages": packages(), "weights": weights,
    })
    print(f"Setup provenance: {args.setup}", flush=True)


def run(args: argparse.Namespace) -> None:
    if args.output.exists() or args.output.with_suffix(".json").exists():
        raise FileExistsError(f"Refusing to overwrite an audition: {args.output}")
    reference = ROOT / "out/claudia-bella-performance/audio.wav"
    if sha256(reference) != REFERENCE_SHA256:
        raise RuntimeError("Bella differs from the accepted frozen reference")
    setup = json.loads(args.setup.read_text(encoding="utf-8"))
    if setup["modelRevision"] != REVISION:
        raise RuntimeError("Unexpected model revision in setup provenance")
    for record in setup["weights"]:
        if sha256(args.model_dir / record["file"]) != record["sha256"]:
            raise RuntimeError(f"Model changed since preparation: {record['file']}")
    if importlib.metadata.version("chatterbox-tts") != "0.1.7":
        raise RuntimeError("This audition pins chatterbox-tts==0.1.7")

    import numpy as np
    import soundfile as sf
    import torch
    # Perth's package initializer hides ImportError behind a None value. Import
    # its implementation directly so dependency failures surface before loading
    # the large speech models; keep the native watermarker enabled.
    from perth.perth_net.perth_net_implicit.perth_watermarker import PerthImplicitWatermarker
    from chatterbox.tts import ChatterboxTTS, punc_norm

    if not torch.cuda.is_available():
        raise RuntimeError("The local Chatterbox audition requires CUDA")
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    torch.set_num_threads(4)
    script_path = ROOT / "fixtures/presenters/claudia/voice-audition.json"
    text = json.loads(script_path.read_text(encoding="utf-8"))["text"]
    if punc_norm(text) != text:
        raise RuntimeError("Upstream normalization would change the audition script")
    settings = {"exaggeration": 0.65, "cfg_weight": 0.35, "temperature": 0.8,
                "repetition_penalty": 1.2, "min_p": 0.05, "top_p": 1.0}
    started = time.perf_counter()
    print("Loading original English Chatterbox", flush=True)
    model = ChatterboxTTS.from_local(args.model_dir, device="cuda")
    loaded = time.perf_counter()
    print("Generating the complete script with Bella as the audio prompt", flush=True)
    samples = model.generate(text, audio_prompt_path=str(reference), **settings)
    samples = samples.detach().cpu().numpy().reshape(-1)
    if not samples.size or not np.isfinite(samples).all() or np.max(np.abs(samples)) >= 1:
        raise RuntimeError("Generated waveform is empty, non-finite, or would clip as PCM16")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(args.output), samples, model.sr, subtype="PCM_16")
    finished = time.perf_counter()
    write_json(args.output.with_suffix(".json"), {
        "schema": "claudia-prosody-audition/v1", "engine": "Chatterbox",
        "variant": "Original English 500M", "model": MODEL, "modelRevision": REVISION,
        "package": "chatterbox-tts==0.1.7", "packages": packages(),
        "setupProvenance": str(args.setup), "setupProvenanceSha256": sha256(args.setup),
        "runnerSha256": sha256(Path(__file__)), "seed": args.seed, "settings": settings,
        "text": text, "scriptFileSha256": sha256(script_path),
        "reference": str(reference), "referenceSha256": REFERENCE_SHA256,
        "referenceUsage": "Upstream: first 6 s for T3 prompt, first 10 s for decoder; full reference for speaker embedding",
        "segmentation": "One complete script, no external sentence splits or inserted pauses",
        "gpu": torch.cuda.get_device_name(0), "peakAllocatedGpuBytes": torch.cuda.max_memory_allocated(),
        "loadSeconds": loaded - started, "generationSeconds": finished - loaded,
        "audio": {"sampleRate": model.sr, "channels": 1, "frames": int(samples.size),
                  "durationSeconds": samples.size / model.sr, "sampleWidthBytes": 2},
        "outputSha256": sha256(args.output),
        "postProcessing": "Native Perth watermark preserved; PCM16 encoding only",
        "note": "Fixed seed records sampling; cross-device byte-identical output is not guaranteed.",
    })
    print(json.dumps({"output": str(args.output), "durationSeconds": samples.size / model.sr,
                      "generationSeconds": finished - loaded}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--setup", type=Path, default=ROOT / ".explain-to-me/experiments/chatterbox/setup.json")
    parser.add_argument("--output", type=Path, default=ROOT / "out/claudia-prosody-raw/chatterbox.wav")
    parser.add_argument("--seed", type=int, default=20261022)
    args = parser.parse_args()
    for name in ("model_dir", "setup", "output"):
        setattr(args, name, getattr(args, name).resolve())
    args.model_dir.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(args.model_dir / ".hf")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["DO_NOT_TRACK"] = "1"
    if not args.prepare:
        os.environ["HF_HUB_OFFLINE"] = "1"
    (prepare if args.prepare else run)(args)


if __name__ == "__main__":
    main()
