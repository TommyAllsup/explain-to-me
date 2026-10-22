"""Mix Claudia's local narration with the requested song and verify the final MP4.

Only Python's standard library and full FFmpeg/FFprobe are required. Normalization
uses an analysis pass followed by a fixed gain, so it cannot alter speech pacing,
pitch, or intra-sentence dynamics. Music is the only sidechain-compressed stem.
All candidates live in a temporary directory until the media checks pass.
"""
from __future__ import annotations

import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
SAMPLE_RATE = 48_000
OUTPUT_NAMES = (
    "video.mp4", "mix.wav", "music-stem.wav", "narration-normalized.wav",
    "mix-report.json", "music-credit.json",
)


def run(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(arguments, capture_output=True, text=True,
                            encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {arguments[0]}\n"
                           + result.stderr[-12_000:])
    return result


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def save(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False,
                               allow_nan=False) + "\n", encoding="utf-8")


def probe(executable: str, path: Path, *, count: bool = False) -> dict:
    arguments = [executable, "-v", "error"]
    if count:
        arguments.append("-count_frames")
    result = run(arguments + ["-show_streams", "-show_format", "-of", "json", str(path)])
    return json.loads(result.stdout)


def audio_filter(samples: int) -> str:
    # Stereo before measurement prevents a 3 dB surprise when duplicating mono.
    return (f"aresample={SAMPLE_RATE},"
            "aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"apad,atrim=end_sample={samples},asetpts=N/SR/TB")


def loudness(ffmpeg: str, path: Path, prefix: str = "") -> dict:
    filters = (prefix + "," if prefix else "") + (
        "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json")
    result = run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(path),
                  "-vn", "-af", filters, "-f", "null", "-"])
    matches = re.findall(r'\{\s*"input_i".*?\}', result.stderr, re.DOTALL)
    if not matches:
        raise RuntimeError("FFmpeg did not return loudness measurements")
    measured = json.loads(matches[-1])
    result = {
        "integratedLufs": float(measured["input_i"]),
        "truePeakDbtp": float(measured["input_tp"]),
        "loudnessRangeLu": float(measured["input_lra"]),
        "thresholdLufs": float(measured["input_thresh"]),
    }
    if not all(math.isfinite(value) for value in result.values()):
        raise ValueError(f"Unusable/silent audio loudness: {path}")
    return result


def normalize(ffmpeg: str, source: Path, target: Path, samples: int,
              integrated: float, peak: float) -> dict:
    prefix = audio_filter(samples)
    before = loudness(ffmpeg, source, prefix)
    requested_gain = integrated - before["integratedLufs"]
    gain = min(requested_gain, peak - before["truePeakDbtp"])
    run([ffmpeg, "-hide_banner", "-nostdin", "-n", "-i", str(source),
         "-vn", "-af", f"{prefix},volume={gain:.9f}dB",
         "-ar", str(SAMPLE_RATE), "-ac", "2", "-c:a", "pcm_s24le", str(target)])
    after = loudness(ffmpeg, target)
    return {"method": "Measured loudness followed by fixed linear gain",
            "targetIntegratedLufs": integrated, "targetTruePeakDbtp": peak,
            "appliedGainDb": gain, "peakLimitedGain": gain < requested_gain - .001,
            "before": before, "after": after}


def read_pcm24(path: Path) -> tuple[array.array, int, int]:
    # Python 3.11's wave module cannot read FFmpeg's PCM24 WAVE_FORMAT_EXTENSIBLE.
    # Read the ordinary RIFF chunks directly; our generated stems are tiny relative
    # to RIFF's 4 GiB limit, and only integer PCM / extensible integer PCM is valid.
    with path.open("rb") as source:
        header = source.read(12)
        if header[:4] != b"RIFF" or header[8:] != b"WAVE":
            raise ValueError(f"Expected RIFF WAV: {path}")
        format_data = raw = None
        while chunk := source.read(8):
            if len(chunk) != 8:
                raise ValueError(f"Truncated RIFF chunk: {path}")
            name, size = struct.unpack("<4sI", chunk)
            data = source.read(size)
            if len(data) != size:
                raise ValueError(f"Truncated WAV payload: {path}")
            if name == b"fmt ":
                format_data = data
            elif name == b"data":
                raw = data
            if size % 2:
                source.read(1)
        if format_data is None or raw is None or len(format_data) < 16:
            raise ValueError(f"Missing WAV format/data: {path}")
        codec, channels, rate, _, block_align, bits = struct.unpack("<HHIIHH", format_data[:16])
        if codec == 0xFFFE:
            if len(format_data) < 40 or format_data[24:40] != bytes.fromhex("0100000000001000800000aa00389b71"):
                raise ValueError(f"Unsupported extensible WAV codec: {path}")
        elif codec != 1:
            raise ValueError(f"Expected integer PCM WAV: {path}")
        if bits != 24 or block_align != channels * 3 or len(raw) % block_align:
            raise ValueError(f"Expected complete PCM24 WAV: {path}")
    values = array.array("f")
    for offset in range(0, len(raw), 3):
        value = raw[offset] | (raw[offset + 1] << 8) | (raw[offset + 2] << 16)
        if value & 0x800000:
            value -= 0x1000000
        values.append(value / 8_388_608)
    return values, channels, rate


def check_mix_levels(voice: Path, music: Path, mix: Path) -> dict:
    voice_data, channels, rate = read_pcm24(voice)
    music_data, music_channels, music_rate = read_pcm24(music)
    mixed, mix_channels, mix_rate = read_pcm24(mix)
    if ((channels, rate) != (music_channels, music_rate)
            or (channels, rate) != (mix_channels, mix_rate)
            or len(voice_data) != len(music_data) or len(voice_data) != len(mixed)):
        raise ValueError("Stem sample layouts or durations do not match")
    block = int(.1 * rate) * channels
    voice_energy = music_energy = 0.0
    active = 0
    margins = []
    for offset in range(0, len(voice_data), block):
        speech = voice_data[offset:offset + block]
        bed = music_data[offset:offset + block]
        v = sum(value * value for value in speech) / len(speech)
        m = sum(value * value for value in bed) / len(bed)
        # -35 dBFS excludes silence and most breaths; actual spoken blocks only.
        if v >= 10 ** (-35 / 10):
            active += 1
            voice_energy += v
            music_energy += m
            margins.append(10 * math.log10(v / max(m, 1e-15)))
    if not active:
        raise ValueError("No active narration blocks were detected")
    margins.sort()
    peak = max(abs(value) for value in mixed)
    return {
        "activeSpeechSeconds": round(active * .1, 2),
        "speechOverMusicDb": 10 * math.log10(voice_energy / max(music_energy, 1e-15)),
        "medianSpeechOverMusicDb": margins[len(margins) // 2],
        "mixSamplePeakDbfs": 20 * math.log10(max(peak, 1e-15)),
        "mixHardClippedSamples": sum(abs(value) >= 1 - 1 / 8_388_608 for value in mixed),
        "measuringMethod": "Energy in 100 ms stereo blocks with voice RMS >= -35 dBFS",
    }


def write_mix(ffmpeg: str, voice: Path, music: Path, destination: Path,
              music_stem: Path, samples: int, duration: float, gain: float) -> str:
    intro = min(1.75, duration / 4)
    outro = min(3.0, duration / 4)
    fade_out = min(1.4, duration / 5)
    # Twice the bed gain at the opening/ending; the voice detector still ducks
    # this envelope if speech is present there. No narration editing is involved.
    envelope = (f"{gain:.9f}*(1+max(0,1-t/{intro:.9f})"
                f"+max(0,(t-{duration - outro:.9f})/{outro:.9f}))")
    graph = (
        "[0:a]asplit[voice][detector];"
        f"[1:a]volume='{envelope}':eval=frame,"
        f"afade=t=in:st=0:d=0.35,afade=t=out:st={duration - fade_out:.9f}:d={fade_out:.9f}[bed];"
        "[bed][detector]sidechaincompress=threshold=0.055:ratio=4:attack=15:"
        "release=300:makeup=1:knee=2.828:link=maximum:detection=rms[ducked];"
        "[ducked]asplit[musicout][musicmix];"
        "[voice][musicmix]amix=inputs=2:duration=longest:normalize=0,"
        # Oversampling provides headroom for intersample peaks. latency=1 removes
        # the limiter's own delay, keeping existing phoneme/caption timing intact.
        "aresample=192000,alimiter=limit=0.841395142:attack=5:release=50:"
        "level=false:latency=true,"
        f"aresample={SAMPLE_RATE},apad,atrim=end_sample={samples},asetpts=N/SR/TB[mixed]"
    )
    run([ffmpeg, "-hide_banner", "-nostdin", "-n", "-i", str(voice),
         "-i", str(music), "-filter_complex", graph,
         "-map", "[mixed]", "-c:a", "pcm_s24le", str(destination),
         "-map", "[musicout]", "-c:a", "pcm_s24le", str(music_stem)])
    return graph


def encode(ffmpeg: str, silent: Path, audio: Path, output: Path) -> None:
    run([ffmpeg, "-hide_banner", "-nostdin", "-n", "-i", str(silent),
         "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
         "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", str(SAMPLE_RATE),
         "-map_metadata", "-1", "-metadata", "title=Ben's guide to e-girls",
         "-metadata", "comment=Claudia narration; music: Slogans in the Rain by tommyallsup",
         "-movflags", "+faststart", str(output)])


def video_payload_hash(ffmpeg: str, path: Path) -> str:
    return run([ffmpeg, "-v", "error", "-nostdin", "-i", str(path),
                "-map", "0:v:0", "-c:v", "copy", "-f", "hash", "-hash", "sha256", "-"]).stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outputdir", type=Path, default=ROOT / "out/ben-egirls")
    parser.add_argument("--music", type=Path,
                        default=Path("C:/Users/tommy/Downloads/Slogans in the Rain.mp3"))
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    parser.add_argument("--ffprobe", default=shutil.which("ffprobe"))
    args = parser.parse_args()
    if not args.ffmpeg or not args.ffprobe:
        parser.error("Full FFmpeg and FFprobe must be on PATH or supplied explicitly")
    output, music = args.outputdir.resolve(), args.music.resolve()
    silent, narration = output / "silent.mp4", output / "narration.wav"
    props_path = output / "render-props.json"
    for path in (silent, narration, props_path, music):
        if not path.is_file():
            parser.error(f"Required input missing: {path}")
    for name in OUTPUT_NAMES:
        if (output / name).exists():
            parser.error(f"Refusing to replace an existing deliverable: {output / name}")
    props = json.loads(props_path.read_text(encoding="utf-8-sig"))
    fps, frames = props["fps"], props["durationInFrames"]
    if not isinstance(fps, (float, int)) or not math.isfinite(fps) or fps <= 0:
        raise ValueError("Invalid composition fps")
    if not isinstance(frames, int) or frames <= 0:
        raise ValueError("Invalid composition frame count")
    duration, samples = frames / fps, round(frames / fps * SAMPLE_RATE)
    song_probe = probe(args.ffprobe, music)
    song_duration = float(song_probe["format"]["duration"])
    if duration > song_duration + .000001:
        raise ValueError(f"Video ({duration:.3f}s) exceeds the song ({song_duration:.3f}s)")
    silent_probe = probe(args.ffprobe, silent)
    video_streams = [stream for stream in silent_probe["streams"] if stream["codec_type"] == "video"]
    if len(video_streams) != 1:
        raise ValueError("Expected one video stream in silent.mp4")
    input_video = video_streams[0]
    if abs(float(input_video["duration"]) - duration) > .001:
        raise ValueError("Silent video duration does not match composition timing")
    if int(input_video.get("nb_frames", -1)) != frames:
        raise ValueError("Silent video frame count does not match composition timing")
    narration_probe = probe(args.ffprobe, narration)
    narration_streams = [stream for stream in narration_probe["streams"] if stream["codec_type"] == "audio"]
    if (len(narration_streams) != 1 or narration_streams[0]["codec_name"] != "pcm_s16le"
            or int(narration_streams[0]["sample_rate"]) != 24_000
            or narration_streams[0]["channels"] != 1):
        raise ValueError("Expected the prepared PCM16/24k/mono narration WAV")
    speech_duration = float(narration_probe["format"]["duration"])
    if speech_duration > duration + 1 / SAMPLE_RATE:
        raise ValueError("Narration would be cut short by the video")
    if duration - speech_duration > 5:
        raise ValueError("Narration ends more than five seconds before the composition")
    build_path = output / "build.json"
    build_hash = None
    if build_path.is_file():
        build = json.loads(build_path.read_text(encoding="utf-8-sig"))
        if build["fps"] != fps or build["durationInFrames"] != frames:
            raise ValueError("build.json and render-props.json disagree about timing")
        pcm_hash = run([args.ffmpeg, "-v", "error", "-nostdin", "-i", str(narration),
                        "-map", "0:a:0", "-c:a", "copy", "-f", "hash", "-hash", "sha256", "-"]).stdout.strip()
        if pcm_hash != "SHA256=" + build["narrationPcmSha256"]:
            raise ValueError("Narration PCM changed after composition preparation")
        build_hash = digest(build_path)

    with tempfile.TemporaryDirectory(prefix=".mix-work-", dir=output) as directory:
        work = Path(directory)
        if not work.resolve().is_relative_to(output):
            raise ValueError("Temporary mix directory escaped the output directory")
        voice, normalized_music = work / "narration-normalized.wav", work / "music-normalized.wav"
        mix, bed = work / "mix.wav", work / "music-stem.wav"
        print("Measuring and normalizing narration/music with fixed gain...", flush=True)
        voice_norm = normalize(args.ffmpeg, narration, voice, samples, -16, -3)
        music_norm = normalize(args.ffmpeg, music, normalized_music, samples, -20, -3)
        gain, attempts = .7, []
        for attempt in range(3):
            candidate_mix, candidate_bed = work / f"mix-{attempt}.wav", work / f"music-{attempt}.wav"
            graph = write_mix(args.ffmpeg, voice, normalized_music, candidate_mix,
                              candidate_bed, samples, duration, gain)
            levels = check_mix_levels(voice, candidate_bed, candidate_mix)
            attempts.append({"musicBaseGain": gain, "levels": levels})
            if levels["speechOverMusicDb"] >= 10:
                candidate_mix.rename(mix)
                candidate_bed.rename(bed)
                break
            gain *= 10 ** ((levels["speechOverMusicDb"] - 10.5) / 20)
        else:
            raise ValueError("Could not establish a 10 dB speech/music energy margin")
        if levels["mixHardClippedSamples"]:
            raise ValueError("The mixed PCM audio contains hard-clipped samples")
        mix_loudness = loudness(args.ffmpeg, mix)
        final = work / "video.mp4"
        encode(args.ffmpeg, silent, mix, final)
        encoded_loudness = loudness(args.ffmpeg, final)
        peak_correction = 0.0
        if encoded_loudness["truePeakDbtp"] > -1:
            peak_correction = -1.35 - encoded_loudness["truePeakDbtp"]
            corrected = work / "mix-corrected.wav"
            run([args.ffmpeg, "-hide_banner", "-nostdin", "-n", "-i", str(mix),
                 "-af", f"volume={peak_correction:.9f}dB", "-c:a", "pcm_s24le", str(corrected)])
            # These are owned temporary candidates, never previous deliverables.
            mix.unlink()
            corrected.rename(mix)
            final.unlink()
            encode(args.ffmpeg, silent, mix, final)
            mix_loudness = loudness(args.ffmpeg, mix)
            encoded_loudness = loudness(args.ffmpeg, final)
        print("Checking frame identity, full AV decode, duration, and encoded audio...", flush=True)
        final_probe = probe(args.ffprobe, final, count=True)
        final_video = next(stream for stream in final_probe["streams"] if stream["codec_type"] == "video")
        final_audio = next(stream for stream in final_probe["streams"] if stream["codec_type"] == "audio")
        final_duration = float(final_probe["format"]["duration"])
        source_payload, final_payload = video_payload_hash(args.ffmpeg, silent), video_payload_hash(args.ffmpeg, final)
        run([args.ffmpeg, "-v", "error", "-xerror", "-nostdin", "-i", str(final),
             "-map", "0:v:0", "-map", "0:a:0", "-c:v", "rawvideo", "-c:a", "pcm_s16le", "-f", "null", "-"])
        checks = {
            "framesPreserved": int(final_video["nb_read_frames"]) == frames,
            "compressedVideoPayloadUnchanged": source_payload == final_payload,
            "videoDurationMatchesComposition": abs(float(final_video["duration"]) - duration) <= .001,
            "audioDurationMatchesComposition": abs(float(final_audio["duration"]) - duration) <= .025,
            "containerDurationMatchesComposition": abs(final_duration - duration) <= .025,
            "noLongerThanSong": final_duration <= song_duration,
            "stereo48kAac": (final_audio["codec_name"] == "aac"
                              and int(final_audio["sample_rate"]) == SAMPLE_RATE
                              and final_audio["channels"] == 2),
            "noHardClipping": levels["mixHardClippedSamples"] == 0,
            "encodedTruePeakAtMostMinusOneDbtp": encoded_loudness["truePeakDbtp"] <= -1,
            "speechAtLeastTenDbAboveMusic": levels["speechOverMusicDb"] >= 10,
            "fullAvDecode": True,
        }
        if not all(checks.values()):
            raise ValueError("Final media checks failed: " + json.dumps(checks))
        tags = {key.lower(): value for key, value in song_probe["format"].get("tags", {}).items()}
        credit = {"title": tags.get("title", music.stem), "artist": tags.get("artist"),
                  "sourceFile": str(music), "sourceSha256": digest(music),
                  "sourceDurationSeconds": song_duration, "usedDurationSeconds": duration,
                  "usage": "User-selected background music; original tempo and pitch; trimmed and faded"}
        report = {
            "version": 1, "durationSeconds": duration, "fps": fps, "frames": frames,
            "samplesPerChannel": samples,
            "sources": {"narration": {"path": str(narration), "sha256": digest(narration)},
                        "silentVideo": {"path": str(silent), "sha256": digest(silent)},
                        "renderPropsSha256": digest(props_path), "buildSha256": build_hash,
                        "music": credit},
            "ffmpeg": run([args.ffmpeg, "-version"]).stdout.splitlines()[0],
            "normalization": {"narration": voice_norm, "music": music_norm},
            "mixSettings": {"musicBaseGain": gain, "musicOpeningEndingGainMultiplier": 2,
                            "sidechainThreshold": .055, "sidechainRatio": 4,
                            "sidechainAttackMs": 15, "sidechainReleaseMs": 300,
                            "limiterCeilingDb": -1.5, "limiterLatencyCompensated": True,
                            "limiterOversamplingRate": 192000,
                            "postEncodePeakCorrectionDb": peak_correction,
                            "speechPitchOrSpeedChanged": False, "filterGraph": graph},
            "mixCalibration": attempts, "mixLoudness": mix_loudness,
            "encodedLoudness": encoded_loudness, "mediaChecks": checks,
            "outputs": {name: {"sha256": digest(work / name), "bytes": (work / name).stat().st_size}
                        for name in OUTPUT_NAMES[:4]},
        }
        save(work / "music-credit.json", credit)
        save(work / "mix-report.json", report)
        for name in OUTPUT_NAMES:
            (work / name).rename(output / name)
    print(json.dumps({"video": str(output / "video.mp4"), "durationSeconds": duration,
                      "speechOverMusicDb": levels["speechOverMusicDb"],
                      "encodedLoudness": encoded_loudness,
                      "checksPassed": len(checks)}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, KeyError, StopIteration) as error:
        print(f"Mix failed: {error}", file=sys.stderr)
        sys.exit(1)
