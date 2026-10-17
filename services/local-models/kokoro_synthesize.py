"""Local Kokoro ONNX bridge. All audio stays on disk; stdout is one JSON result."""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

MAX_INPUT_BYTES = 1_048_576
MAX_CHUNKS = 128
MAX_TEXT_CHARS = 1_600
MAX_TOTAL_TEXT_CHARS = 24_000
MAX_PATH_CHARS = 4_096
MAX_CHUNK_PCM_BYTES = 16 * 1024 * 1024
MAX_TOTAL_PCM_BYTES = 128 * 1024 * 1024
MIN_SPEED = 0.8
MAX_SPEED = 1.25
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
VOICE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = PROJECT_ROOT / ".explain-to-me/models/kokoro/kokoro-v1.0.onnx"
VOICES_PATH = PROJECT_ROOT / ".explain-to-me/models/kokoro/voices-v1.0.bin"


def _runtime_check() -> dict[str, Any]:
    """Check native imports and eSpeak data without loading the ONNX model."""
    import importlib.metadata
    import platform

    import numpy  # noqa: F401 - deliberately exercise native library loading
    import onnxruntime  # noqa: F401
    import soundfile  # noqa: F401
    from kokoro_onnx.tokenizer import Tokenizer

    phonemes = Tokenizer().phonemize("Kokoro is ready.", lang="en-us")
    if not phonemes.strip():
        raise RuntimeError("eSpeak returned no phonemes")
    names = ("kokoro-onnx", "onnxruntime", "numpy", "espeakng-loader", "phonemizer", "soundfile")
    return {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "packages": {name: importlib.metadata.version(name) for name in names},
    }


def _smoke_test() -> dict[str, int]:
    with tempfile.TemporaryDirectory(prefix="kokoro-check-") as temporary:
        result = _synthesize({
            "modelPath": str(MODEL_PATH), "voicesPath": str(VOICES_PATH),
            "voice": "af_heart", "speed": 1,
            "chunks": [{"id": "smoke", "text": "Kokoro is ready.", "outputPath": str(Path(temporary) / "smoke.pcm")}],
        })
        chunk = result["chunks"][0]
        if not 0 < chunk["samples"] <= 24_000 * 15:
            raise RuntimeError("Kokoro smoke sample exceeded the 15 second limit")
        return {"samples": chunk["samples"], "sampleRate": chunk["sampleRate"]}


def _bounded_path(value: Any, label: str) -> Path:
    if not isinstance(value, str) or not value or len(value) > MAX_PATH_CHARS or "\0" in value:
        raise ValueError(f"{label} must be a non-empty path of at most {MAX_PATH_CHARS} characters")
    path = Path(value)
    if not path.is_absolute():
        raise ValueError(f"{label} must be absolute")
    return path


def _validate_request(request: Any) -> tuple[str, float, list[dict[str, str]]]:
    if not isinstance(request, dict) or set(request) != {
        "modelPath", "voicesPath", "voice", "speed", "chunks"
    }:
        raise ValueError("Request must contain modelPath, voicesPath, voice, speed, and chunks")

    model_path = _bounded_path(request["modelPath"], "modelPath")
    voices_path = _bounded_path(request["voicesPath"], "voicesPath")
    if model_path != MODEL_PATH or voices_path != VOICES_PATH or model_path.is_symlink() or voices_path.is_symlink():
        raise ValueError("Requested model paths are outside the configured local Kokoro model directory")
    if not model_path.is_file() or not voices_path.is_file():
        raise ValueError("Kokoro model or voice pack is missing")

    voice = request["voice"]
    if not isinstance(voice, str) or not VOICE_PATTERN.fullmatch(voice):
        raise ValueError("voice must be a valid voice identifier")
    speed = request["speed"]
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not MIN_SPEED <= speed <= MAX_SPEED:
        raise ValueError(f"speed must be between {MIN_SPEED} and {MAX_SPEED}")

    raw_chunks = request["chunks"]
    if not isinstance(raw_chunks, list) or not 1 <= len(raw_chunks) <= MAX_CHUNKS:
        raise ValueError(f"chunks must contain 1 to {MAX_CHUNKS} entries")
    chunks: list[dict[str, str]] = []
    ids: set[str] = set()
    outputs: set[Path] = set()
    total_chars = 0
    for index, item in enumerate(raw_chunks):
        if not isinstance(item, dict) or set(item) != {"id", "text", "outputPath"}:
            raise ValueError(f"chunk {index} must contain id, text, and outputPath")
        chunk_id, text, output = item["id"], item["text"], item["outputPath"]
        if not isinstance(chunk_id, str) or not ID_PATTERN.fullmatch(chunk_id) or chunk_id in ids:
            raise ValueError(f"chunk {index} has an invalid or duplicate id")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS:
            raise ValueError(f"chunk {chunk_id} text must contain 1 to {MAX_TEXT_CHARS} characters")
        total_chars += len(text)
        if total_chars > MAX_TOTAL_TEXT_CHARS:
            raise ValueError(f"chunk text exceeds {MAX_TOTAL_TEXT_CHARS} total characters")

        output_path = _bounded_path(output, f"chunk {chunk_id} outputPath")
        if ".." in output_path.parts or not output_path.parent.is_dir():
            raise ValueError(f"chunk {chunk_id} outputPath must be an existing directory path without '..'")
        if output_path in outputs or output_path.is_symlink() or output_path.exists():
            raise ValueError(f"chunk {chunk_id} outputPath must be unique and not already exist")
        outputs.add(output_path)
        ids.add(chunk_id)
        chunks.append({"id": chunk_id, "text": text, "outputPath": str(output_path)})
    return voice, float(speed), chunks


def _synthesize(request: Any) -> dict[str, Any]:
    voice, speed, chunks = _validate_request(request)

    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    from kokoro_onnx.session import resolve_providers

    # kokoro-onnx 0.6.1 exposes session options via the pinned ONNX Runtime API.
    options = ort.SessionOptions()
    cpu_count = os.cpu_count() or 4
    options.intra_op_num_threads = min(6, max(4, cpu_count))
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(MODEL_PATH),
        sess_options=options,
        providers=resolve_providers(),
    )
    kokoro = Kokoro.from_session(session, str(VOICES_PATH))
    available_voices = kokoro.get_voices()
    if voice not in available_voices:
        raise ValueError(f"Voice {voice!r} is not in the installed voice pack")

    results: list[dict[str, Any]] = []
    total_pcm_bytes = 0
    for chunk in chunks:
        samples, sample_rate = kokoro.create(
            chunk["text"], voice=voice, speed=speed, lang="en-us"
        )
        audio = np.asarray(samples, dtype=np.float32).reshape(-1)
        if sample_rate != 24_000 or audio.size == 0 or not np.isfinite(audio).all():
            raise ValueError(f"Kokoro returned invalid audio for chunk {chunk['id']}")
        if audio.nbytes > MAX_CHUNK_PCM_BYTES:
            raise ValueError(f"Kokoro output for chunk {chunk['id']} exceeds the PCM size limit")

        pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).round().astype("<i2", copy=False)
        pcm_bytes = pcm.tobytes(order="C")
        total_pcm_bytes += len(pcm_bytes)
        if total_pcm_bytes > MAX_TOTAL_PCM_BYTES:
            raise ValueError(f"Kokoro output exceeds the {MAX_TOTAL_PCM_BYTES}-byte PCM limit")
        output_path = Path(chunk["outputPath"])
        with output_path.open("xb") as audio_file:
            audio_file.write(pcm_bytes)
        results.append({"id": chunk["id"], "samples": int(pcm.size), "sampleRate": 24_000})
    return {"chunks": results}


def main() -> int:
    try:
        if sys.argv[1:] == ["--check"]:
            result = _runtime_check()
        elif sys.argv[1:] == ["--smoke"]:
            result = _smoke_test()
        elif sys.argv[1:]:
            raise ValueError("Use no arguments, --check, or --smoke")
        else:
            payload = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
            if len(payload) > MAX_INPUT_BYTES:
                raise ValueError(f"Request exceeds {MAX_INPUT_BYTES} bytes")
            result = _synthesize(json.loads(payload))
    except Exception as error:  # keep stdout machine-readable and diagnostics on stderr
        hint = " On Windows, ensure the Microsoft Visual C++ 2019 or newer runtime is installed." if sys.platform == "win32" and isinstance(error, (ImportError, OSError)) else ""
        print(f"kokoro_synthesize: {error}{hint}", file=sys.stderr)
        return 2
    sys.stdout.write(json.dumps(result, separators=(",", ":")))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
