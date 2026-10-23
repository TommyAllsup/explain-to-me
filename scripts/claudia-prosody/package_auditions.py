"""Package three local Claudia takes at matched loudness without changing delivery.

Requires existing WAVs and model sidecars; never downloads or generates audio.
The accepted Bella performance is copied byte-for-byte. The other takes receive
linear loudness normalization and sample-rate conversion, with no time editing.
"""
from __future__ import annotations

import argparse
import array
import hashlib
import io
import json
import math
import re
import shutil
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures/presenters/claudia/voice-audition.json"
REFERENCE_SHA256 = "3188194b9e9cacc7e35b48fbb2095b5d139adfe967abd4c2f5dd5cc5bade1733"
SAMPLE_RATE = 24000
TRUE_PEAK_TARGET_DBTP = -0.3
TRUE_PEAK_LIMIT_DBTP = -0.2  # Small allowance for measurement and PCM rounding.


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(command: list[str]) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(command, capture_output=True, timeout=180,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError(f"{Path(command[0]).name} failed ({result.returncode}):\n"
                           + result.stderr.decode("utf-8", errors="replace")[-6000:])
    return result


def loudness_stats(stderr: bytes) -> dict[str, str]:
    matches = re.findall(r'\{\s*"input_i"[\s\S]*?\}', stderr.decode("utf-8", errors="replace"))
    if not matches:
        raise ValueError("FFmpeg omitted loudness measurements")
    stats = json.loads(matches[-1])
    for key in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset"):
        if not math.isfinite(float(stats[key])):
            raise ValueError(f"Non-finite loudness measurement: {key}")
    return stats


def measure(ffmpeg: str, path: Path, target: float) -> dict[str, str]:
    return loudness_stats(run([
        ffmpeg, "-hide_banner", "-nostdin", "-i", str(path), "-map", "0:a:0",
        "-af", f"loudnorm=I={target}:TP={TRUE_PEAK_TARGET_DBTP}:LRA=11:print_format=json", "-f", "null", "-",
    ]).stderr)


def inspect_audio(ffmpeg: str, path: Path, ffprobe: str | None = None) -> dict:
    """Check every finite PCM16 sample and the header against a complete decode."""
    with wave.open(str(path), "rb") as audio:
        channels, width, rate, frames = (audio.getnchannels(), audio.getsampwidth(),
                                         audio.getframerate(), audio.getnframes())
        pcm = audio.readframes(frames)
    if channels != 1 or width != 2 or not 8000 <= rate <= 192000:
        raise ValueError(f"{path.name}: expected mono PCM16 WAV at its native sample rate")
    if not 0 < frames / rate <= 60 or len(pcm) != frames * channels * width:
        raise ValueError(f"{path.name}: empty, truncated, or longer than 60 seconds")
    decoded = run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
                   "-i", str(path), "-map", "0:a:0", "-c:a", "pcm_s16le", "-f", "wav", "-"]).stdout
    # WAV is supported by the repository's intentionally small FFmpeg build;
    # its raw f32le muxer is not. PCM16 contains only finite integer values.
    with wave.open(io.BytesIO(decoded), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (channels, width, rate):
            raise ValueError(f"{path.name}: decoded WAV format disagrees with input")
        decoded_pcm = audio.readframes(audio.getnframes())
    if len(decoded_pcm) != frames * channels * width:
        raise ValueError(f"{path.name}: decoded sample count disagrees with WAV header")
    integers = array.array("h", decoded_pcm)
    if sys.byteorder != "little":
        integers.byteswap()
    if ffprobe:
        probe = json.loads(run([
            ffprobe, "-v", "error", "-select_streams", "a", "-show_entries",
            "stream=codec_name,sample_rate,channels", "-of", "json", str(path),
        ]).stdout)
        streams = probe.get("streams", [])
        if len(streams) != 1 or (streams[0].get("codec_name"), int(streams[0]["sample_rate"]),
                                streams[0]["channels"]) != ("pcm_s16le", rate, channels):
            raise ValueError(f"{path.name}: FFprobe disagrees with PCM16 WAV header")
    return {"sampleRate": rate, "channels": channels, "sampleWidthBytes": width,
            "samples": frames, "durationSeconds": frames / rate,
            "clippedSamples": sum(value <= -32768 or value >= 32767 for value in integers),
            "peakPcm": max(abs(value) for value in integers), "decodedFinite": True}


def validate_metadata(path: Path, text: str, source_hash: str) -> dict:
    metadata = json.loads(path.read_text(encoding="utf-8"))
    # "script" accommodates the first IndexTTS runner; new runners use "text".
    if metadata.get("text", metadata.get("script")) != text:
        raise ValueError(f"{path.name}: script differs from the shared audition fixture")
    if metadata.get("referenceSha256") != REFERENCE_SHA256:
        raise ValueError(f"{path.name}: voice reference is not the accepted Bella recording")
    if not isinstance(metadata.get("engine"), str) or not metadata["engine"]:
        raise ValueError(f"{path.name}: missing engine identity")
    for key in ("outputSha256", "audioSha256"):
        if key in metadata and metadata[key] != source_hash:
            raise ValueError(f"{path.name}: {key} differs from the actual raw recording")
    return metadata


def validate_setup(metadata: dict, sidecar_dir: Path) -> tuple[Path, str]:
    source = metadata.get("setupProvenance")
    expected = metadata.get("setupProvenanceSha256")
    if not isinstance(source, str) or not source or not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("Model sidecar must identify its setup JSON and SHA-256")
    path = Path(source)
    if not path.is_absolute():
        path = sidecar_dir / path
    path = path.resolve(strict=True)
    if path.suffix.lower() != ".json" or not isinstance(json.loads(path.read_text(encoding="utf-8")), dict):
        raise ValueError("Setup provenance must be a JSON object")
    if sha256(path) != expected:
        raise ValueError(f"{path.name}: setup provenance changed since generation")
    return path, expected


def copy_provenance(source: Path, output: Path, filename: str, expected: str) -> dict:
    # Callers supply stable filenames, never paths from model metadata.
    target = output / "provenance" / filename
    shutil.copyfile(source, target)
    if sha256(target) != expected:
        raise ValueError(f"{filename}: provenance changed while copying")
    return {"file": f"provenance/{filename}", "sha256": expected}


def normalize(ffmpeg: str, source: Path, target: Path, target_lufs: float) -> dict[str, str]:
    measured = measure(ffmpeg, source, target_lufs)
    filter_text = (f"loudnorm=I={target_lufs}:TP={TRUE_PEAK_TARGET_DBTP}:LRA=11"
                   f":measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
                   f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
                   f":offset={measured['target_offset']}:linear=true:print_format=json")
    applied = loudness_stats(run([
        ffmpeg, "-hide_banner", "-nostdin", "-n", "-i", str(source), "-map", "0:a:0",
        "-af", filter_text, "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", str(target),
    ]).stderr)
    if applied.get("normalization_type") != "linear":
        raise ValueError(f"{source.name}: loudnorm required dynamic compression; "
                         "refusing to change the audition's dynamics")
    return applied


def verify_result(info: dict, source_info: dict, stats: dict[str, str], target_lufs: float) -> dict:
    expected_samples = round(source_info["samples"] * SAMPLE_RATE / source_info["sampleRate"])
    checks = {
        "decodedFinite": info["decodedFinite"],
        "monoPcm16At24kHz": (info["channels"], info["sampleWidthBytes"], info["sampleRate"]) == (1, 2, SAMPLE_RATE),
        "noClippedPcmSamples": info["clippedSamples"] == 0,
        "sampleCountWithinOneRoundingSample": abs(info["samples"] - expected_samples) <= 1,
        "naturalDurationWithinOneMillisecond": abs(info["durationSeconds"] - source_info["durationSeconds"]) <= 0.001,
        "loudnessWithinHalfLufs": abs(float(stats["input_i"]) - target_lufs) <= 0.5,
        "truePeakWithinCeilingAndRoundingAllowance": float(stats["input_tp"]) <= TRUE_PEAK_LIMIT_DBTP,
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise ValueError("Audition failed validation: " + ", ".join(failed))
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", required=True, type=Path)
    parser.add_argument("--baseline-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path, help="New output directory; refuses any overwrite")
    parser.add_argument("--ffmpeg", required=True, type=Path)
    parser.add_argument("--ffprobe", type=Path)
    args = parser.parse_args()
    ffmpeg = str(args.ffmpeg.resolve(strict=True))
    ffprobe = str(args.ffprobe.resolve(strict=True)) if args.ffprobe else None
    raw_dir, baseline_dir, output = args.raw_dir.resolve(), args.baseline_dir.resolve(), args.output.resolve()
    if args.output.exists() or args.output.is_symlink() or output.exists():
        raise FileExistsError(f"Refusing to overwrite output: {output}")
    text = json.loads(FIXTURE.read_text(encoding="utf-8"))["text"]
    baseline = baseline_dir / "audio.wav"
    if sha256(baseline) != REFERENCE_SHA256:
        raise ValueError("Baseline differs from the accepted current Bella performance")
    baseline_timing = json.loads((baseline_dir / "timings.json").read_text(encoding="utf-8"))
    baseline_metadata = json.loads((baseline_dir / "report.json").read_text(encoding="utf-8"))
    if baseline_timing.get("text") != text or baseline_timing.get("audioSha256") != REFERENCE_SHA256:
        raise ValueError("Baseline timing does not match the shared script and frozen Bella audio")
    if baseline_metadata.get("audioSha256") != REFERENCE_SHA256:
        raise ValueError("Baseline report does not identify the frozen Bella audio")
    sources = [("A", "Current Bella (Kokoro)", baseline, baseline_metadata),
               ("B", "IndexTTS-2.5", raw_dir / "index-tts-2.5.wav", None),
               ("C", "Chatterbox (original)", raw_dir / "chatterbox.wav", None)]
    prepared = []
    for label, name, source, metadata in sources:
        source_hash = sha256(source)
        setup = None
        if metadata is None:
            metadata = validate_metadata(source.with_suffix(".json"), text, source_hash)
            setup = validate_setup(metadata, source.parent)
        prepared.append((label, name, source, source_hash, metadata, inspect_audio(ffmpeg, source, ffprobe), setup))
    target_lufs = float(measure(ffmpeg, baseline, -19)["input_i"])
    output.mkdir(parents=False, exist_ok=False)
    preserved = output / "raw"
    preserved.mkdir()
    (output / "provenance").mkdir()
    report = {
        "schema": "claudia-prosody-auditions/v1", "text": text,
        "referenceSha256": REFERENCE_SHA256, "referenceFile": "A-current-bella.wav",
        "scriptFileSha256": sha256(FIXTURE), "packagerSha256": sha256(Path(__file__)),
        "durationPolicy": "Natural model duration; no speed, pitch, trimming, or time-stretch changes",
        "normalization": {"integratedLufs": target_lufs, "truePeakDbtp": TRUE_PEAK_TARGET_DBTP,
                          "validationTruePeakLimitDbtp": TRUE_PEAK_LIMIT_DBTP, "lra": 11,
                          "method": "Two-pass FFmpeg loudnorm, linear only; Bella copied unchanged"},
        "ffmpegVersion": run([ffmpeg, "-version"]).stdout.decode("utf-8", errors="replace").splitlines()[0],
        "scriptProvenance": copy_provenance(FIXTURE, output, "voice-audition.json", sha256(FIXTURE)),
        "candidates": [],
    }
    filenames = {"A": "A-current-bella.wav", "B": "B-index-tts-2.5.wav", "C": "C-chatterbox.wav"}
    for label, name, source, source_hash, metadata, source_info, setup in prepared:
        target = output / filenames[label]
        if label == "A":
            shutil.copyfile(source, target)
            provenance = [copy_provenance(baseline_dir / original, output, filename,
                                          sha256(baseline_dir / original)) for original, filename in (
                ("report.json", "A-current-bella-report.json"),
                ("timings.json", "A-current-bella-timings.json"),
            )]
            source_file = target.name
            normalization = "unchanged baseline"
        else:
            assert setup is not None
            provenance = [copy_provenance(setup[0], output, target.stem + "-setup.json", setup[1])]
            saved_raw = preserved / source.name
            shutil.copyfile(source, saved_raw)
            shutil.copyfile(source.with_suffix(".json"), saved_raw.with_suffix(".json"))
            normalization = normalize(ffmpeg, saved_raw, target, target_lufs)
            source_file = f"raw/{source.name}"
        if sha256(output / source_file) != source_hash:
            raise ValueError(f"{label}: source copy changed while packaging")
        info = inspect_audio(ffmpeg, target, ffprobe)
        stats = measure(ffmpeg, target, target_lufs)
        checks = verify_result(info, source_info, stats, target_lufs)
        report["candidates"].append({
            "label": label, "name": name, "file": target.name, "sha256": sha256(target),
            "sourceFile": source_file, "sourceSha256": source_hash, "sourceAudio": source_info,
            "referenceSha256": REFERENCE_SHA256, "modelMetadata": metadata,
            "provenance": provenance,
            "audio": info, "measuredLufs": float(stats["input_i"]),
            "truePeakDbtp": float(stats["input_tp"]), "loudnessRangeLu": float(stats["input_lra"]),
            "normalization": normalization, "checks": checks,
        })
        print(f"{label}: {name}, {info['durationSeconds']:.3f}s, "
              f"{float(stats['input_i']):.2f} LUFS, {float(stats['input_tp']):.2f} dBTP -> {target}", flush=True)
    (output / "auditions.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "script.txt").write_text(text + "\n", encoding="utf-8")
    (output / "README.txt").write_text(
        "Claudia: local inflection and voice-preservation auditions\n\n"
        "Listen in order: A-current-bella.wav, B-index-tts-2.5.wav, C-chatterbox.wav.\n"
        "A is the accepted Bella performance, copied without any changes.\n"
        "B and C use that same recording as their voice reference and speak the same script.\n"
        f"Loudness is matched to Bella ({target_lufs:.2f} LUFS); all files are mono PCM16 at 24 kHz.\n"
        f"Linear normalization uses a {TRUE_PEAK_TARGET_DBTP:.1f} dBTP ceiling; no dynamic compression.\n"
        "Natural duration and pauses are preserved. No speed, pitch, or trimming changes.\n\n"
        "Compare conversational emphasis, the pause before 'when to forget', the final\n"
        "question, pronunciation, and whether the voice still sounds like Bella.\n"
        "Technical checks do not establish voice similarity or performance quality.\n"
        "auditions.json records settings, provenance, hashes, duration, and validation.\n"
        "raw/ preserves unnormalized new takes and source metadata.\n"
        "provenance/ contains verified setup manifests, Bella's report and timings,\n"
        "and the shared script fixture. Model binaries are not included.\n",
        encoding="utf-8")
    print(f"All three auditions validated: {output / 'auditions.json'}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError, wave.Error, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"Audition packaging failed: {error}") from error
