"""Render three local casting auditions at natural duration and matched loudness.

Run with the setup-created Kokoro Python. Reuses the existing synthesis bridge;
does not fetch models, clone a voice, or select the eventual character voice.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "fixtures/presenters/claudia/voice-audition.json"
BRIDGE = ROOT / "services/local-models/kokoro_synthesize.py"
MODEL_ROOT = ROOT / ".explain-to-me/models/kokoro"


def run(args: list[str], stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, input=stdin, capture_output=True, text=True,
                          check=True, timeout=180,
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def loudness_stats(stderr: str) -> dict[str, str]:
    matches = re.findall(r'\{\s*"input_i"[\s\S]*?\}', stderr)
    if not matches:
        raise RuntimeError("FFmpeg omitted measured loudness")
    result = json.loads(matches[-1])
    if not all(math.isfinite(float(result[key])) for key in
               ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")):
        raise RuntimeError("Non-finite loudness measurement")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="New output directory")
    parser.add_argument("--ffmpeg", required=True, type=Path, help="Existing local FFmpeg executable")
    args = parser.parse_args()
    output = args.output.resolve()
    ffmpeg = str(args.ffmpeg.resolve(strict=True))
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    if (config.get("version") != "1" or len(config.get("candidates", [])) != 3
            or not isinstance(config.get("text"), str) or not config["text"].strip()
            or len(config["text"]) > 1600 or config.get("speed") != 1.0):
        raise ValueError("Expected the three-candidate audition fixture at speed 1.0")
    if [item.get("label") for item in config["candidates"]] != ["A", "B", "C"]:
        raise ValueError("Audition labels must be A, B, C in order")
    if any(not re.fullmatch(r"af_[a-z]+", item.get("voice", "")) for item in config["candidates"]):
        raise ValueError("Expected installed American English female voice identifiers")
    # Refuse overwrites, including existing empty directories or symlinks.
    output.mkdir(parents=False, exist_ok=False)
    raw = output / "raw"
    raw.mkdir()
    (output / "script.txt").write_text(config["text"] + "\n", encoding="utf-8")
    model_metadata = json.loads((MODEL_ROOT / "provenance.json").read_text(encoding="utf-8"))
    report = {"purpose": config["purpose"], "selection": "pending-user-choice",
              "text": config["text"], "speed": config["speed"],
              "durationPolicy": "natural; no duration correction or time stretching",
              "normalization": {"integratedLufs": -19, "truePeakDbtp": -1, "lra": 11},
              "configSha256": sha256(CONFIG), "bridgeSha256": sha256(BRIDGE),
              "generatorSha256": sha256(Path(__file__)), "model": model_metadata["model"],
              "runtimeVersions": model_metadata["runtimeVersions"],
              "modelSha256": sha256(MODEL_ROOT / "kokoro-v1.0.onnx"),
              "voicesSha256": sha256(MODEL_ROOT / "voices-v1.0.bin"), "candidates": []}
    for item in config["candidates"]:
        stem = f"{item['label']}-{item['voice']}"
        pcm = raw / f"{stem}.pcm"
        original = raw / f"{stem}.wav"
        target = output / f"{stem}.wav"
        request = {"modelPath": str(MODEL_ROOT / "kokoro-v1.0.onnx"),
                   "voicesPath": str(MODEL_ROOT / "voices-v1.0.bin"),
                   "voice": item["voice"], "speed": config["speed"],
                   "chunks": [{"id": "audition", "text": config["text"], "outputPath": str(pcm)}]}
        synthesis = json.loads(run([sys.executable, str(BRIDGE)], json.dumps(request)).stdout)
        samples = synthesis["chunks"][0]["samples"]
        if synthesis["chunks"][0]["sampleRate"] != 24000 or pcm.stat().st_size != samples * 2:
            raise RuntimeError("Synthesis returned inconsistent audio metadata")
        with wave.open(str(original), "wb") as wav:
            wav.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
            wav.writeframes(pcm.read_bytes())
        base_filter = "loudnorm=I=-19:TP=-1:LRA=11"
        measured = loudness_stats(run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(original),
                                      "-af", base_filter + ":print_format=json", "-f", "null", "-"]).stderr)
        filter_text = (base_filter + f":measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
                       f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
                       f":offset={measured['target_offset']}:linear=true")
        run([ffmpeg, "-hide_banner", "-nostdin", "-n", "-i", str(original), "-af", filter_text,
             "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(target)])
        verified = loudness_stats(run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(target),
                                      "-af", base_filter + ":print_format=json", "-f", "null", "-"]).stderr)
        if abs(float(verified["input_i"]) + 19) > 0.5 or float(verified["input_tp"]) > -0.8:
            raise RuntimeError(f"Audition {item['label']} failed loudness checks")
        with wave.open(str(target), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()) != (1, 2, 24000, samples):
                raise RuntimeError("Normalization changed the expected format or sample count")
        report["candidates"].append({**item, "file": target.name, "sha256": sha256(target),
                                     "samples": samples, "durationSeconds": samples / 24000,
                                     "measuredLufs": float(verified["input_i"]),
                                     "truePeakDbtp": float(verified["input_tp"]), "decoded": True})
        # Retain raw WAV for comparison; PCM was only an intermediate.
        pcm.unlink()
        (output / "auditions.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"{item['label']}: {item['voice']} ({samples / 24000:.2f}s) -> {target}", flush=True)
    shutil.copyfile(CONFIG, output / "audition-config.json")


if __name__ == "__main__":
    main()
