"""Synthesize a new Bella take and capture phoneme timing in the same model call."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import wave
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="New output directory")
    parser.add_argument("--ffmpeg", required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    ffmpeg = str(args.ffmpeg.resolve(strict=True))
    config = json.loads((ROOT / "fixtures/presenters/claudia/voice-audition.json").read_text(encoding="utf-8"))
    selected = json.loads((ROOT / "fixtures/presenters/claudia/selected-voice.json").read_text(encoding="utf-8"))
    if selected["voice"] != "af_bella" or selected["speed"] != 1:
        raise ValueError("This character test requires the selected Bella profile at natural speed")
    # Reuse the audition's checked local process runner and loudness parser.
    spec = importlib.util.spec_from_file_location("auditions", ROOT / "scripts/claudia-voice-auditions.py")
    assert spec and spec.loader
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    model_root = ROOT / ".explain-to-me/models/kokoro"
    model = model_root / "kokoro-v1.0.onnx"
    voices = model_root / "voices-v1.0.bin"
    model_metadata = json.loads((model_root / "provenance.json").read_text(encoding="utf-8"))

    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    from kokoro_onnx.session import resolve_providers

    output.mkdir(parents=False, exist_ok=False)
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(6, max(4, os.cpu_count() or 4))
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model), sess_options=options, providers=resolve_providers())
    kokoro = Kokoro.from_session(session, str(voices))
    samples, rate, spoken = kokoro.create_timed(config["text"], voice=selected["voice"], speed=1, lang="en-us")
    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    if rate != 24000 or not spoken or not np.isfinite(audio).all() or not 0 < len(audio) <= rate * 30:
        raise ValueError("Expected a finite short take with model phoneme timing")
    pcm = (np.clip(audio, -1, 1) * 32767).round().astype("<i2").tobytes()
    raw = output / "raw.wav"
    target = output / "audio.wav"
    with wave.open(str(raw), "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)
    base_filter = "loudnorm=I=-19:TP=-1:LRA=11"
    measured = helpers.loudness_stats(helpers.run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(raw),
                                                  "-af", base_filter + ":print_format=json", "-f", "null", "-"]).stderr)
    filter_text = (base_filter + f":measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
                   f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
                   f":offset={measured['target_offset']}:linear=true")
    helpers.run([ffmpeg, "-hide_banner", "-nostdin", "-n", "-i", str(raw), "-af", filter_text,
                 "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(target)])
    with wave.open(str(target), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()) != (1, 2, rate, len(audio)):
            raise ValueError("Loudness normalization altered sample count")
    verified = helpers.loudness_stats(helpers.run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(target),
                                                  "-af", base_filter + ":print_format=json", "-f", "null", "-"]).stderr)
    if abs(float(verified["input_i"]) + 19) > .5 or float(verified["input_tp"]) > -.8:
        raise ValueError("Bella performance failed loudness checks")
    sentences = re.findall(r"[^.!?]+[.!?]", config["text"])
    stops = [i for i, timing in enumerate(spoken) if timing.phoneme in ".!?"]
    if len(sentences) != len(stops):
        raise ValueError("Sentence punctuation does not match model timings")
    starts = [0]
    for index in stops[:-1]:
        next_spoken = next(t for t in spoken[index + 1:] if t.phoneme.strip())
        starts.append(round(next_spoken.start * rate))
    ends = starts[1:] + [len(audio)]
    cues = [{"text": text.strip(), "startSample": start, "endSample": end}
            for text, start, end in zip(sentences, starts, ends, strict=True)]
    timing = {"version": 1, "voice": selected["voice"], "sampleRate": rate, "samples": len(audio),
              "audioSha256": digest(target), "method": "phoneme durations captured in the same synthesis call; sentence cues extend to next onset",
              "text": config["text"], "cues": cues, "phonemes": [asdict(t) for t in spoken]}
    report = {"selectedVoice": selected, "performance": "new timed take, same voice and script as audition A",
              "model": model_metadata["model"], "runtimeVersions": model_metadata["runtimeVersions"],
              "modelSha256": digest(model), "voicesSha256": digest(voices), "generatorSha256": digest(Path(__file__)),
              "rawSha256": digest(raw), "audioSha256": digest(target), "speed": 1, "samples": len(audio),
              "durationSeconds": len(audio) / rate, "measuredLufs": float(verified["input_i"]),
              "truePeakDbtp": float(verified["input_tp"]), "durationCorrection": False}
    for name, value in [("timings.json", timing), ("report.json", report)]:
        (output / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Bella: {len(audio) / rate:.3f}s, {len(spoken)} phonemes, {len(cues)} sentence cues -> {output}")


if __name__ == "__main__":
    main()
