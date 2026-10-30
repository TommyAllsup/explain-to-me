"""Local Kokoro ONNX bridge. All audio stays on disk; stdout is one JSON result."""

from __future__ import annotations

import json
import math
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path
from typing import Any

MAX_INPUT_BYTES = 1_048_576
MAX_CHUNKS = 128
MAX_TEXT_CHARS = 1_600
MAX_TOTAL_TEXT_CHARS = 24_000
MAX_PATH_CHARS = 4_096
MAX_CHUNK_PCM_BYTES = 16 * 1024 * 1024
MAX_TOTAL_PCM_BYTES = 128 * 1024 * 1024
MAX_GROUP_PHONEMES = MAX_TEXT_CHARS * 32
MIN_SPEED = 0.65  # Explicit project pacing; legacy duration correction stays at 0.8 in TypeScript.
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


def _validate_request(request: Any) -> tuple[str, float, list[dict[str, Any]]]:
    required = {"modelPath", "voicesPath", "voice", "speed", "chunks"}
    if not isinstance(request, dict) or set(request) not in (required, required | {"delivery"}):
        raise ValueError("Request must contain modelPath, voicesPath, voice, speed, and chunks")
    connected = "delivery" in request
    if connected:
        delivery = request["delivery"]
        if not isinstance(delivery, dict) or set(delivery) != {"mode", "sentencePauseMs", "clausePauseMs"} or delivery["mode"] != "connected":
            raise ValueError("delivery must contain connected mode, sentencePauseMs, and clausePauseMs")
        for field, maximum in (("sentencePauseMs", 1000), ("clausePauseMs", 500)):
            value = delivery[field]
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
                raise ValueError(f"delivery {field} must be an integer between 0 and {maximum}")

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
    chunks: list[dict[str, Any]] = []
    ids: set[str] = set()
    passage_ids: set[str] = set()
    outputs: set[Path] = set()
    total_chars = 0
    for index, item in enumerate(raw_chunks):
        fields = {"id", "text", "outputPath"} | ({"passages"} if connected else set())
        if not isinstance(item, dict) or set(item) != fields:
            raise ValueError(f"chunk {index} must contain id, text, and outputPath" + (", and passages" if connected else ""))
        chunk_id, text, output = item["id"], item["text"], item["outputPath"]
        if not isinstance(chunk_id, str) or not ID_PATTERN.fullmatch(chunk_id) or chunk_id in ids:
            raise ValueError(f"chunk {index} has an invalid or duplicate id")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS:
            raise ValueError(f"chunk {chunk_id} text must contain 1 to {MAX_TEXT_CHARS} characters")
        total_chars += len(text)
        if total_chars > MAX_TOTAL_TEXT_CHARS:
            raise ValueError(f"chunk text exceeds {MAX_TOTAL_TEXT_CHARS} total characters")
        passages = []
        if connected:
            raw_passages = item["passages"]
            if not isinstance(raw_passages, list) or not 1 <= len(raw_passages) <= MAX_CHUNKS:
                raise ValueError(f"chunk {chunk_id} passages must contain 1 to {MAX_CHUNKS} entries")
            for passage in raw_passages:
                if not isinstance(passage, dict) or set(passage) != {"id", "text"}:
                    raise ValueError(f"chunk {chunk_id} passages must contain id and text")
                passage_id, passage_text = passage["id"], passage["text"]
                if not isinstance(passage_id, str) or not ID_PATTERN.fullmatch(passage_id) or passage_id in passage_ids:
                    raise ValueError(f"chunk {chunk_id} has an invalid or duplicate passage id")
                if not isinstance(passage_text, str) or not passage_text.strip() or len(passage_text) > MAX_TEXT_CHARS:
                    raise ValueError(f"passage {passage_id} text must contain 1 to {MAX_TEXT_CHARS} characters")
                passage_ids.add(passage_id)
                if len(passage_ids) > MAX_CHUNKS:
                    raise ValueError(f"connected request exceeds {MAX_CHUNKS} total passages")
                passages.append({"id": passage_id, "text": passage_text})
            if text != " ".join(passage["text"] for passage in passages):
                raise ValueError(f"chunk {chunk_id} text must equal its passage texts joined by one space")

        output_path = _bounded_path(output, f"chunk {chunk_id} outputPath")
        if ".." in output_path.parts or not output_path.parent.is_dir():
            raise ValueError(f"chunk {chunk_id} outputPath must be an existing directory path without '..'")
        if output_path in outputs or output_path.is_symlink() or output_path.exists():
            raise ValueError(f"chunk {chunk_id} outputPath must be unique and not already exist")
        outputs.add(output_path)
        ids.add(chunk_id)
        chunks.append({"id": chunk_id, "text": text, "outputPath": str(output_path), **({"passages": passages} if connected else {})})
    return voice, float(speed), chunks


def _spoken_phoneme(phoneme: str) -> bool:
    return not phoneme.isspace() and not unicodedata.category(phoneme).startswith("P")


def _align_passages(
    passages: list[dict[str, str]], phonemes_by_passage: list[str],
    native_timings: Any, sample_count: int, sample_rate: int,
) -> list[dict[str, Any]]:
    """Recover original passage boundaries without changing a single audio sample.

    Only whitespace is normalized: known phonemes, stress and punctuation must
    match in order. This deliberately fails if independent phonemization changes
    pronunciation in context; a guessed boundary would corrupt caption timing.
    """
    if not isinstance(native_timings, (list, tuple)) or not 0 < len(native_timings) <= MAX_GROUP_PHONEMES:
        raise ValueError("Connected delivery requires bounded native phoneme timings; the model must report durations")
    if isinstance(sample_count, bool) or not isinstance(sample_count, int) or not 0 < sample_count <= MAX_CHUNK_PCM_BYTES // 2 or sample_rate != 24_000:
        raise ValueError("Connected delivery has invalid PCM sample bounds")
    if len(passages) != len(phonemes_by_passage) or not 1 <= len(passages) <= MAX_CHUNKS:
        raise ValueError("Connected delivery has invalid passage phonemes")

    normalized: list[str] = []
    for passage, phonemes in zip(passages, phonemes_by_passage):
        if not isinstance(phonemes, str) or len(phonemes) > MAX_GROUP_PHONEMES:
            raise ValueError("Connected delivery has invalid or excessive passage phonemes")
        known = "".join(phoneme for phoneme in phonemes if not phoneme.isspace())
        if not known or not any(_spoken_phoneme(phoneme) for phoneme in known):
            raise ValueError(f"Connected passage {passage['id']} has no spoken phonemes")
        normalized.append(known)
    expected = "".join(normalized)
    if len(expected) > MAX_GROUP_PHONEMES:
        raise ValueError("Connected delivery exceeds the phoneme limit")

    actual: list[str] = []
    starts: list[int] = []
    previous_end = 0.0
    duration = sample_count / sample_rate
    for timing in native_timings:
        if isinstance(timing, dict):
            phoneme, start, end = (timing.get(field) for field in ("phoneme", "start", "end"))
        else:
            phoneme, start, end = (getattr(timing, field, None) for field in ("phoneme", "start", "end"))
        if not isinstance(phoneme, str) or len(phoneme) != 1:
            raise ValueError("Connected delivery has invalid native phoneme timing")
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in (start, end)):
            raise ValueError("Connected delivery has nonfinite or missing native timing")
        if start < 0 or end < start or end > duration or start < previous_end - 1e-9:
            raise ValueError("Connected delivery has nonmonotonic or out-of-bounds native timing")
        # trim=True can reduce final punctuation to zero length. Spoken tokens
        # must still have positive duration; punctuation carries no word onset.
        if end == start and _spoken_phoneme(phoneme):
            raise ValueError("Connected delivery has nonpositive spoken phoneme timing")
        previous_end = end
        if not phoneme.isspace():
            actual.append(phoneme)
            starts.append(round(start * sample_rate))
    if "".join(actual) != expected:
        raise ValueError("Connected passage phonemes do not match the synthesized stream; cannot safely align original passage IDs")

    cuts = [0]
    offset = 0
    for index, phonemes in enumerate(normalized):
        if index:
            onset = next(position for position, phoneme in enumerate(phonemes) if _spoken_phoneme(phoneme))
            cut = starts[offset + onset]
            if not cuts[-1] < cut < sample_count:
                raise ValueError("Connected delivery has nonpositive or out-of-bounds passage timing")
            cuts.append(cut)
        offset += len(phonemes)
    cuts.append(sample_count)
    return [{"id": passage["id"], "samples": cuts[index + 1] - cuts[index]} for index, passage in enumerate(passages)]


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
    delivery = request.get("delivery")
    if delivery and not kokoro.has_timings:
        raise ValueError("Connected delivery requires a Kokoro model that reports native phoneme durations")

    results: list[dict[str, Any]] = []
    total_pcm_bytes = 0
    for chunk in chunks:
        if delivery:
            phonemes_by_passage = [kokoro.tokenizer.known(kokoro.tokenizer.phonemize(passage["text"], lang="en-us")) for passage in chunk["passages"]]
            samples, sample_rate, native_timings = kokoro.create_timed(
                chunk["text"], voice=voice, speed=speed, lang="en-us",
                sentence_pause=delivery["sentencePauseMs"] / 1000,
                clause_pause=delivery["clausePauseMs"] / 1000,
                trim=True, continuous=False,
            )
        else:
            samples, sample_rate = kokoro.create(
                chunk["text"], voice=voice, speed=speed, lang="en-us"
            )
        audio = np.asarray(samples, dtype=np.float32).reshape(-1)
        if sample_rate != 24_000 or audio.size == 0 or not np.isfinite(audio).all():
            raise ValueError(f"Kokoro returned invalid audio for chunk {chunk['id']}")
        if audio.nbytes > MAX_CHUNK_PCM_BYTES:
            raise ValueError(f"Kokoro output for chunk {chunk['id']} exceeds the PCM size limit")
        passage_results = _align_passages(chunk["passages"], phonemes_by_passage, native_timings, int(audio.size), sample_rate) if delivery else None

        pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).round().astype("<i2", copy=False)
        pcm_bytes = pcm.tobytes(order="C")
        total_pcm_bytes += len(pcm_bytes)
        if total_pcm_bytes > MAX_TOTAL_PCM_BYTES:
            raise ValueError(f"Kokoro output exceeds the {MAX_TOTAL_PCM_BYTES}-byte PCM limit")
        output_path = Path(chunk["outputPath"])
        with output_path.open("xb") as audio_file:
            audio_file.write(pcm_bytes)
        results.append({"id": chunk["id"], "samples": int(pcm.size), "sampleRate": 24_000, **({"passages": passage_results} if delivery else {})})
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
