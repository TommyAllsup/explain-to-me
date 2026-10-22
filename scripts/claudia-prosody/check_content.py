"""Check audition wording with local, CPU-only Whisper; never upload audio.

The transcript is an independent screening signal, not proof of exact delivery.
Missing audition files are recorded so the same command can be rerun as local
generation finishes. Existing checks are reused only for identical audio and
recognition settings.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import re
import time


ROOT = Path(__file__).resolve().parents[2]
OPTIONS = {
    "language": "en",
    "task": "transcribe",
    "temperature": 0.0,
    "beam_size": 5,
    "condition_on_previous_text": False,
    "fp16": False,
    "word_timestamps": True,
}
AUDITIONS = {
    "bella": ROOT / "out/claudia-bella-performance/audio.wav",
    "index-tts-2.5": ROOT / "out/claudia-prosody-raw/index-tts-2.5.wav",
    "chatterbox": ROOT / "out/claudia-prosody-raw/chatterbox.wav",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def words(text: str) -> list[str]:
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower().replace("\u2019", "'"))


def differences(expected: list[str], observed: list[str]) -> list[dict]:
    return [
        {"operation": operation,
         "expectedWordRange": [a, b], "observedWordRange": [c, d],
         "expected": " ".join(expected[a:b]),
         "observed": " ".join(observed[c:d])}
        for operation, a, b, c, d in difflib.SequenceMatcher(
            None, expected, observed, autojunk=False
        ).get_opcodes()
        if operation != "equal"
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("base.en", "small.en"), default="base.en")
    parser.add_argument("--model-dir", type=Path,
                        default=Path("D:/CodexModels/ClaudiaAuditions20261022/asr"))
    parser.add_argument("--output", type=Path,
                        default=ROOT / "out/claudia-prosody-raw/content-check.json")
    parser.add_argument("--prepare", action="store_true",
                        help="Download the selected official Whisper weights if absent.")
    args = parser.parse_args()

    import numpy as np
    from scipy.signal import resample_poly
    import soundfile as sf
    import torch
    import whisper

    torch.set_num_threads(6)
    model_path = args.model_dir / f"{args.model}.pt"
    if not model_path.exists() and not args.prepare:
        raise SystemExit("Whisper weights are missing. Run once with --prepare.")
    model = None
    if args.prepare:
        model = whisper.load_model(args.model, device="cpu",
                                   download_root=str(args.model_dir))
    expected_hash = whisper._MODELS[args.model].split("/")[-2]
    model_hash = sha256(model_path)
    if model_hash != expected_hash:
        raise RuntimeError("Whisper model checksum differs from its pinned package manifest")

    fixture = ROOT / "fixtures/presenters/claudia/voice-audition.json"
    expected = json.loads(fixture.read_text(encoding="utf-8"))["text"]
    prior = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
    identity = {
        "package": "openai-whisper",
        "packageVersion": importlib.metadata.version("openai-whisper"),
        "model": args.model,
        "modelSha256": model_hash,
        "modelUrl": whisper._MODELS[args.model],
        "alignmentHeads": "official-model-specific",
        "device": "cpu",
        "torchVersion": torch.__version__,
        "cpuThreads": 6,
        "options": OPTIONS,
        "initialPrompt": None,
    }
    records = {}
    for label, path in AUDITIONS.items():
        if not path.exists():
            records[label] = {"status": "missing", "path": str(path)}
            continue
        digest = sha256(path)
        previous = prior.get("auditions", {}).get(label, {})
        if (prior.get("recognizer") == identity and prior.get("expectedText") == expected
                and previous.get("audioSha256") == digest
                and previous.get("status") == "transcribed"):
            records[label] = previous
            print(f"{label}: reusing identical audio check", flush=True)
            continue
        if model is None:
            model = whisper.load_model(args.model, device="cpu",
                                       download_root=str(args.model_dir))
        samples, rate = sf.read(path, dtype="float32", always_2d=True)
        audio = samples.mean(axis=1)
        if rate != 16000:
            factor = math.gcd(rate, 16000)
            audio = resample_poly(audio, 16000 // factor, rate // factor).astype(np.float32)
        print(f"{label}: transcribing {len(samples) / rate:.2f}s on CPU", flush=True)
        started = time.perf_counter()
        result = model.transcribe(audio, **OPTIONS)
        observed = result["text"].strip()
        edits = differences(words(expected), words(observed))
        records[label] = {
            "status": "transcribed", "path": str(path), "audioSha256": digest,
            "sampleRate": rate, "channels": samples.shape[1], "samples": len(samples),
            "durationSeconds": len(samples) / rate,
            "recognitionSeconds": round(time.perf_counter() - started, 3),
            "transcript": observed,
            "expectedWordCount": len(words(expected)),
            "observedWordCount": len(words(observed)),
            "normalizedWordsMatch": not edits,
            "observedDifferences": edits,
            "segments": [{key: segment[key] for key in
                          ("start", "end", "text", "avg_logprob", "no_speech_prob", "words")}
                         for segment in result["segments"]],
        }
        print(f"{label}: {observed}", flush=True)
        print(f"{label}: observed differences: {json.dumps(edits)}", flush=True)
    report = {
        "schema": "claudia-audition-content-check/v1",
        "method": "Local CPU ASR; no audio upload or reference-text prompt",
        "limitation": ("Recognition differences can be ASR errors. Word matching does not "
                       "prove naturalness, identity preservation, or absence of audible artifacts. "
                       "Listen to the recordings before accepting delivery quality."),
        "fixture": str(fixture), "fixtureSha256": sha256(fixture),
        "expectedText": expected, "recognizer": identity,
        "auditions": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}", flush=True)


if __name__ == "__main__":
    main()
