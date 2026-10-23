"""Offline, bounded Chatterbox generation and phoneme alignment for Claudia.

Stdout contains exactly one JSON document. Heavy imports and model diagnostics
go to stderr. Models are registered explicitly; this bridge never downloads.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import random
import re
import sys
import wave

ROOT = Path(__file__).resolve().parents[2]
MODEL_MANIFEST = Path(__file__).with_name("claudia-models.json")
PROFILE = ROOT / "fixtures/presenters/claudia/selected-voice.json"
MAX_INPUT_BYTES = 1_048_576
MAX_CHUNKS = 128
MAX_CHARS = 1_600
MAX_TOTAL_CHARS = 24_000
MAX_SECONDS = 120
MAX_TOTAL_SECONDS = 900
SAMPLE_RATE = 24_000
CONFIG_KEYS = {"version", "generationPython", "alignmentPython", "phonemizerPython", "modelDirectory", "alignmentDirectory", "device"}


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def bounded_path(value, label: str) -> Path:
    if not isinstance(value, str) or not value or len(value) > 4096 or "\0" in value:
        raise ValueError(label + " must be a nonempty path of at most 4096 characters")
    path = Path(value)
    if not path.is_absolute():
        raise ValueError(label + " must be absolute")
    return path


def read_config(path: Path) -> dict:
    if path.stat().st_size > 65536:
        raise ValueError("Claudia runtime configuration is too large")
    config = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict) or set(config) != CONFIG_KEYS or config["version"] != 1:
        raise ValueError("Invalid Claudia runtime configuration; run scripts/setup-claudia.py --register")
    if config["device"] != "cuda":
        raise ValueError("Claudia 0.2.5 currently supports CUDA generation only")
    for name in CONFIG_KEYS - {"version", "device"}:
        entry = bounded_path(config[name], name)
        if not entry.exists():
            raise ValueError(name + " is missing: " + str(entry))
        if name.endswith("Python") and not entry.is_file():
            raise ValueError(name + " must identify a Python executable")
        if name.endswith("Directory") and not entry.is_dir():
            raise ValueError(name + " must identify a model directory")
    return config


def verify_models(config: dict, section: str) -> dict:
    pinned = json.loads(MODEL_MANIFEST.read_text(encoding="utf-8"))[section]
    directory = Path(config["modelDirectory" if section == "chatterbox" else "alignmentDirectory"])
    for name, record in pinned["files"].items():
        target = directory / name
        if not target.is_file() or target.stat().st_size != record["bytes"] or digest(target) != record["sha256"]:
            raise ValueError("Pinned " + section + " model file is missing or changed: " + str(target))
    return pinned


def profile() -> dict:
    selected = json.loads(PROFILE.read_text(encoding="utf-8"))
    if selected["engine"] != "chatterbox" or selected["voice"] != "chatterbox-bella" or selected["speed"] != 1:
        raise ValueError("Claudia requires the selected Chatterbox Bella profile")
    pinned = json.loads(MODEL_MANIFEST.read_text(encoding="utf-8"))["chatterbox"]
    if selected["synthesis"]["modelRevision"] != pinned["revision"] or selected["synthesis"]["package"] != pinned["package"]:
        raise ValueError("Selected Claudia voice does not match the pinned runtime")
    if digest(ROOT / selected["referenceAudio"]) != selected["referenceSha256"]:
        raise ValueError("The approved Bella voice reference has changed")
    return selected


def validate_request(value) -> tuple[Path, list[dict]]:
    if not isinstance(value, dict) or set(value) != {"outputDirectory", "chunks"}:
        raise ValueError("Request must contain outputDirectory and chunks")
    output = bounded_path(value["outputDirectory"], "outputDirectory")
    chunks = value["chunks"]
    if not isinstance(chunks, list) or not 1 <= len(chunks) <= MAX_CHUNKS:
        raise ValueError("chunks must contain 1 to 128 entries")
    ids, characters = set(), 0
    for chunk in chunks:
        if not isinstance(chunk, dict) or set(chunk) != {"id", "text", "seed"}:
            raise ValueError("Each chunk requires id, text, and seed")
        identity, text, seed = chunk["id"], chunk["text"], chunk["seed"]
        if not isinstance(identity, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", identity) or identity in ids:
            raise ValueError("Chunk IDs must be unique, filesystem-safe identifiers")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_CHARS or "\0" in text:
            raise ValueError("Chunk text must contain 1 to 1600 characters")
        if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2 ** 32:
            raise ValueError("Chunk seed must be an unsigned 32-bit integer")
        ids.add(identity)
        characters += len(text)
    if characters > MAX_TOTAL_CHARS:
        raise ValueError("Narration exceeds 24000 characters")
    return output, chunks


def runtime_check(mode: str, config: dict) -> dict:
    if mode == "generation":
        import numpy  # noqa: F401
        import soundfile  # noqa: F401
        import pyloudnorm  # noqa: F401
        import torch
        # Explicit import prevents a missing optional dependency silently removing watermarking.
        from perth.perth_net.perth_net_implicit.perth_watermarker import PerthImplicitWatermarker  # noqa: F401
        from chatterbox.tts import ChatterboxTTS  # noqa: F401
        names = ["chatterbox-tts", "torch", "torchaudio", "transformers", "numpy", "soundfile", "pyloudnorm", "resemble-perth", "safetensors"]
        if importlib.metadata.version("chatterbox-tts") != "0.1.7":
            raise ValueError("Claudia requires chatterbox-tts==0.1.7")
        if not torch.cuda.is_available():
            raise ValueError("CUDA is unavailable in the registered generation Python")
        hardware = {"cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(0)}
    elif mode == "alignment":
        import torch  # noqa: F401
        import scipy  # noqa: F401
        from transformers import Wav2Vec2Config, Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC  # noqa: F401
        names, hardware = ["torch", "transformers", "numpy", "scipy"], {}
    else:
        from claudia_alignment import phonemize_words
        result = phonemize_words("Claudia is ready.", Path(config["phonemizerPython"]))
        if len(result["wordPhones"]) != 3:
            raise ValueError("eSpeak did not preserve the readiness sentence")
        import espeakng_loader
        names = ["phonemizer", "espeakng-loader"]
        hardware = {"espeakLibrarySha256": digest(Path(espeakng_loader.get_library_path()))}
    return {"python": platform.python_version(), "packages": {name: importlib.metadata.version(name) for name in names}, **hardware}


def normalization_gain(samples, sample_rate: int) -> tuple[float, str]:
    """Constant gain with peak headroom, including a sub-400ms interjection.

    BS.1770 integrated loudness needs a complete 400ms gating block. Shorter
    utterances use a documented -21dBFS RMS target; padding would change timing.
    """
    if not len(samples):
        raise ValueError("Chatterbox returned empty audio")
    peak = max(abs(float(sample)) for sample in samples)
    if not math.isfinite(peak) or peak < 1e-6:
        raise ValueError("Chatterbox returned silent or invalid audio")
    if len(samples) < math.ceil(sample_rate * .4):
        rms = math.sqrt(math.fsum(float(sample) ** 2 for sample in samples) / len(samples))
        gain = 10 ** (-21 / 20) / rms
        method = "Short utterance: -21 dBFS RMS; fewer than one 400 ms loudness block"
    else:
        import pyloudnorm as pyln
        loudness = pyln.Meter(sample_rate).integrated_loudness(samples)
        gain = 10 ** ((-18 - loudness) / 20)
        method = "-18 LUFS integrated loudness"
    gain = min(gain, 10 ** (-1 / 20) / peak)
    if not math.isfinite(gain) or gain <= 0:
        raise ValueError("Invalid narration gain")
    return gain, method


def synthesize(config: dict, request: dict) -> dict:
    import numpy as np
    import soundfile as sf
    import torch
    from chatterbox.tts import ChatterboxTTS

    output, chunks = validate_request(request)
    runtime_check("generation", config)
    verify_models(config, "chatterbox")
    selected = profile()
    output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    model = ChatterboxTTS.from_local(Path(config["modelDirectory"]), device="cuda")
    if model.sr != SAMPLE_RATE:
        raise ValueError("Unexpected Chatterbox sample rate")
    total, records = 0, []
    for chunk in chunks:
        random.seed(chunk["seed"])
        np.random.seed(chunk["seed"])
        torch.manual_seed(chunk["seed"])
        torch.cuda.manual_seed_all(chunk["seed"])
        print("Generating Claudia chunk " + chunk["id"], file=sys.stderr, flush=True)
        samples = model.generate(chunk["text"], audio_prompt_path=str(ROOT / selected["referenceAudio"]),
                                 **selected["synthesis"]["settings"]).detach().cpu().numpy().reshape(-1)
        if not 0 < len(samples) <= SAMPLE_RATE * MAX_SECONDS or not np.isfinite(samples).all():
            raise ValueError("Chatterbox returned invalid or excessive audio")
        total += len(samples)
        if total > SAMPLE_RATE * MAX_TOTAL_SECONDS:
            raise ValueError("Generated narration exceeds fifteen minutes")
        peak = float(np.max(np.abs(samples)))
        if peak < 1e-6:
            raise ValueError("Chatterbox returned silent audio")
        # Retain floats first: expressive peaks can exceed unity. Constant gain
        # preserves timing, inflection, and the native Perth watermark.
        sf.write(output / ("chunk-" + chunk["id"] + ".float.wav"), samples, SAMPLE_RATE, subtype="FLOAT")
        gain, normalization = normalization_gain(samples, SAMPLE_RATE)
        wav_path = output / ("chunk-" + chunk["id"] + ".wav")
        sf.write(wav_path, samples * gain, SAMPLE_RATE, subtype="PCM_16")
        with wave.open(str(wav_path), "rb") as wav:
            pcm = wav.readframes(wav.getnframes())
        (output / ("chunk-" + chunk["id"] + ".pcm")).write_bytes(pcm)
        records.append({"id": chunk["id"], "samples": len(samples), "gainDb": 20 * math.log10(gain),
                        "rawPeak": peak, "normalization": normalization, "pcmSha256": hashlib.sha256(pcm).hexdigest()})
    return {"sampleRate": SAMPLE_RATE, "chunks": records}


def align(config: dict, request: dict) -> dict:
    from claudia_alignment import align_audio, phonemize_words, verify_intervals
    output, chunks = validate_request(request)
    verify_models(config, "alignment")
    records, total = [], 0
    for chunk in chunks:
        audio = output / ("chunk-" + chunk["id"] + ".wav")
        if audio.stat().st_size > SAMPLE_RATE * MAX_SECONDS * 2 + 4096:
            raise ValueError("Excessive alignment audio")
        with wave.open(str(audio), "rb") as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (SAMPLE_RATE, 1, 2):
                raise ValueError("Alignment requires PCM16 / 24 kHz / mono")
            samples = wav.getnframes()
            pcm = wav.readframes(samples)
        if not 0 < samples <= SAMPLE_RATE * MAX_SECONDS or len(pcm) != samples * 2:
            raise ValueError("Invalid alignment sample count")
        total += samples
        if total > SAMPLE_RATE * MAX_TOTAL_SECONDS:
            raise ValueError("Alignment narration exceeds fifteen minutes")
        phones = phonemize_words(chunk["text"], Path(config["phonemizerPython"]))
        words, phonemes, report = align_audio(audio, chunk["text"], phones["wordPhones"], Path(config["alignmentDirectory"]), output, phones.get("wordTexts"))
        verify_intervals(words, samples / SAMPLE_RATE)
        verify_intervals(phonemes, samples / SAMPLE_RATE)
        alignment = {"id": chunk["id"], "text": chunk["text"], "sampleRate": SAMPLE_RATE, "samples": samples,
                     "pcmSha256": hashlib.sha256(pcm).hexdigest(), "words": words, "phonemes": phonemes}
        (output / ("chunk-" + chunk["id"] + ".alignment.json")).write_text(json.dumps(alignment, ensure_ascii=False), encoding="utf-8")
        (output / ("chunk-" + chunk["id"] + ".alignment-report.json")).write_text(json.dumps({"phonemization": phones, **report}, ensure_ascii=False), encoding="utf-8")
        records.append({"id": chunk["id"], "samples": samples, "pcmSha256": alignment["pcmSha256"]})
    return {"sampleRate": SAMPLE_RATE, "chunks": records}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--check", choices=["generation", "alignment", "phonemizer"])
    parser.add_argument("--mode", choices=["generate", "align"])
    args = parser.parse_args()
    if bool(args.check) == bool(args.mode):
        parser.error("Choose exactly one of --check or --mode")
    # Both HF entry points and transformers are forced offline, even if a future
    # dependency attempts an incidental model lookup.
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1"})
    with contextlib.redirect_stdout(sys.stderr):
        config = read_config(args.config)
        if args.check:
            result = runtime_check(args.check, config)
        else:
            raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
            if len(raw) > MAX_INPUT_BYTES:
                raise ValueError("Claudia request exceeds one MiB")
            request = json.loads(raw)
            result = synthesize(config, request) if args.mode == "generate" else align(config, request)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Claudia bridge: " + str(error), file=sys.stderr)
        raise SystemExit(1) from error
