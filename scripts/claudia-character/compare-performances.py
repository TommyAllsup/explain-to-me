"""Package the accepted Bella and Chatterbox movies without retiming either take.

Requires the locally installed FFmpeg/FFprobe and Pillow. No model inference or
network access. Outputs two solo-audio comparisons, a two-pass movie, and a player.
"""

from __future__ import annotations

import argparse
import hashlib
from html import escape
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.parse import quote

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
PAPER = "#f5f3ec"
INK = "#26352e"
OLIVE = "#63765c"
WIDTH, HEIGHT, FPS = 1120, 720, 24


def run(args: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed:\n{result.stderr[-6000:]}")
    return result.stdout


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def probe(executable: str, path: Path) -> dict:
    return json.loads(run([executable, "-v", "error", "-count_frames", "-show_streams",
                           "-show_format", "-of", "json", str(path)]))


def audio_packets(executable: str, path: Path) -> list[str]:
    data = json.loads(run([executable, "-v", "error", "-select_streams", "a:0",
                          "-show_packets", "-show_entries", "packet=data_hash",
                          "-show_data_hash", "sha256", "-of", "json", str(path)]))
    return [packet["data_hash"] for packet in data["packets"]]


def ass_time(seconds: float) -> str:
    centiseconds = round(seconds * 100)
    minutes, remainder = divmod(centiseconds, 6000)
    seconds, fraction = divmod(remainder, 100)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}:{minutes:02}:{seconds:02}.{fraction:02}"


def wrap_caption(text: str, font: ImageFont.FreeTypeFont) -> str:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if font.getlength(candidate) > 510 and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    lines.append(current)
    if len(lines) > 2:
        raise ValueError("A caption exceeds the two-line comparison area")
    return r"\N".join(lines)


def overlay(output: Path, active: str, font_path: str) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH, 89), fill=PAPER)
    draw.rectangle((0, 640, WIDTH, HEIGHT), fill=PAPER)
    title = ImageFont.truetype(font_path, 28)
    small = ImageFont.truetype(font_path, 17)
    footer = ImageFont.truetype(font_path, 12)
    for name, label, subtitle, left in [
        ("bella", "Bella", "Kokoro", 0),
        ("chatterbox", "Chatterbox", "Bella voice reference", 560),
    ]:
        draw.text((left + 28, 15), label, font=title, fill=INK)
        draw.text((left + 28, 53), subtitle, font=small, fill=OLIVE)
        if name == active:
            draw.rectangle((left + 413, 25, left + 532, 63), fill=OLIVE)
            draw.text((left + 472, 44), "Audio on", anchor="mm", font=small, fill=PAPER)
        else:
            draw.text((left + 472, 44), "Muted", anchor="mm", font=small, fill=OLIVE)
    draw.text((WIDTH / 2, 711),
              "Claudia by anabology · Stylized adaptation · Synthetic voices · Original pacing",
              anchor="mm", font=footer, fill=OLIVE)
    image.save(output / f"{active}-overlay.png")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bella", type=Path, default=ROOT / "out/claudia-character-v4")
    parser.add_argument("--chatterbox", type=Path, default=ROOT / "out/claudia-character-chatterbox")
    parser.add_argument("--output", type=Path, default=ROOT / "out/claudia-character-comparison")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    parser.add_argument("--ffprobe", default=shutil.which("ffprobe"))
    parser.add_argument("--font", default="C:/Windows/Fonts/arial.ttf")
    args = parser.parse_args()
    if not args.ffmpeg or not args.ffprobe:
        parser.error("Provide installed --ffmpeg and --ffprobe executables")

    output = args.output.resolve()
    if output.exists():
        parser.error("Use a fresh output directory; existing comparisons are preserved")
    sources: dict[str, dict] = {}
    for name, directory in [("bella", args.bella), ("chatterbox", args.chatterbox)]:
        directory = directory.resolve()
        movie = directory / "video.mp4"
        report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
        timing = json.loads((directory / "timings.json").read_text(encoding="utf-8"))
        movie_hash = digest(movie)
        if movie_hash != report["videoSha256"] or not all(report["qc"]["checks"].values()):
            raise ValueError(f"{name}: movie differs from its passing render report")
        metadata = probe(args.ffprobe, movie)
        video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
        audio = next(s for s in metadata["streams"] if s["codec_type"] == "audio")
        if (video["width"], video["height"], video["r_frame_rate"], audio["codec_name"]) != (1280, 720, "24/1", "aac"):
            raise ValueError(f"{name}: expected accepted 1280×720, 24fps movie with AAC audio")
        sources[name] = {"path": str(movie), "sha256": movie_hash, "timing": timing,
                         "frames": int(video["nb_read_frames"]),
                         "durationSeconds": float(video["duration"])}
    if sources["bella"]["timing"]["text"] != sources["chatterbox"]["timing"]["text"]:
        raise ValueError("The performances must use the same script")

    output.mkdir(parents=True)
    frames = max(source["frames"] for source in sources.values())
    duration = frames / FPS
    font = ImageFont.truetype(args.font, 22)
    ass = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {WIDTH}", f"PlayResY: {HEIGHT}",
           "WrapStyle: 2", "", "[V4+ Styles]",
           "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
           "Style: Default,Arial,22,&H002E3526,&H002E3526,&H00ECF3F5,&H00ECF3F5,0,0,0,0,100,100,0,0,1,0,0,8,20,20,0,1",
           "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    for index, source in enumerate(sources.values()):
        timing = source["timing"]
        for cue in timing["cues"]:
            caption = wrap_caption(cue["text"], font)
            ass.append(f"Dialogue: 0,{ass_time(cue['startSample'] / timing['sampleRate'])},"
                       f"{ass_time(cue['endSample'] / timing['sampleRate'])},Default,,0,0,0,,"
                       f"{{\\an8\\pos({280 + 560 * index},646)}}{caption}")
    (output / "captions.ass").write_text("\n".join(ass) + "\n", encoding="utf-8")

    checks: dict[str, bool] = {}
    output_info: dict[str, dict] = {}
    for active in sources:
        print(f"Rendering side-by-side picture with {active} audio…", flush=True)
        overlay(output, active, args.font)
        crops = []
        for index, source in enumerate(sources.values()):
            hold = (frames - source["frames"]) / FPS
            crops.append(f"[{index}:v]crop=560:550:0:64,tpad=stop_mode=clone:stop_duration={hold},"
                         f"setpts=PTS-STARTPTS[v{index}]")
        graph = ";".join(crops + [
            "[v0][v1]hstack=inputs=2,pad=1120:720:0:90:color=0xf5f3ec[picture]",
            "[picture][2:v]overlay=0:0:shortest=1,ass=captions.ass,format=yuv420p[v]",
        ])
        audio_index = list(sources).index(active)
        movie = output / f"{active}.mp4"
        run([args.ffmpeg, "-hide_banner", "-v", "warning", "-n",
             "-i", sources["bella"]["path"], "-i", sources["chatterbox"]["path"],
             "-loop", "1", "-framerate", str(FPS), "-i", f"{active}-overlay.png",
             "-filter_complex", graph, "-map", "[v]", "-map", f"{audio_index}:a:0",
             "-frames:v", str(frames), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-c:a", "copy", "-movflags", "+faststart", movie.name], cwd=output)
        checks[f"{active}AudioPacketsUnchanged"] = (
            audio_packets(args.ffprobe, Path(sources[active]["path"])) == audio_packets(args.ffprobe, movie))

    # The concat demuxer offsets the second take by the full video duration. Its
    # first audio packet retains the original priming; no waveform is resampled.
    (output / "passes.txt").write_text(
        f"file 'bella.mp4'\nduration {duration:.9f}\nfile 'chatterbox.mp4'\n", encoding="utf-8")
    run([args.ffmpeg, "-hide_banner", "-v", "warning", "-n", "-f", "concat", "-safe", "0",
         "-i", "passes.txt", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy",
         "-movflags", "+faststart", "comparison.mp4"], cwd=output)
    checks["comparisonAudioPacketsInOrder"] = audio_packets(args.ffprobe, output / "comparison.mp4") == (
        audio_packets(args.ffprobe, output / "bella.mp4") + audio_packets(args.ffprobe, output / "chatterbox.mp4"))
    for name, expected_frames in [("bella", frames), ("chatterbox", frames), ("comparison", frames * 2)]:
        movie = output / f"{name}.mp4"
        info = probe(args.ffprobe, movie)
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        run([args.ffmpeg, "-v", "error", "-xerror", "-i", str(movie), "-map", "0:v:0",
             "-map", "0:a:0", "-f", "null", "-"])
        checks[f"{name}FullDecode"] = True
        checks[f"{name}Frames"] = int(video["nb_read_frames"]) == expected_frames
        checks[f"{name}DimensionsAndRate"] = (video["width"], video["height"], video["r_frame_rate"]) == (WIDTH, HEIGHT, "24/1")
        checks[f"{name}Duration"] = abs(float(video["duration"]) - expected_frames / FPS) < 0.05
        output_info[name] = {"sha256": digest(movie), "frames": int(video["nb_read_frames"]),
                             "durationSeconds": float(video["duration"]),
                             "videoStartSeconds": float(video["start_time"]),
                             "containerDurationSeconds": float(info["format"]["duration"])}
    for active, source in sources.items():
        checks[f"{active}SourceUnchanged"] = digest(Path(source["path"])) == source["sha256"]
        del source["timing"]
    for active in sources:
        run([args.ffmpeg, "-v", "error", "-n", "-i", str(output / f"{active}.mp4"),
             "-frames:v", "1", "-update", "1", str(output / f"{active}-poster.png")])
    template = Path(__file__).with_name("comparison-player.html").read_text(encoding="utf-8")
    for name, original_link in [("bella", "../claudia-character-v4/video.mp4"),
                                ("chatterbox", "../claudia-character-chatterbox/video.mp4")]:
        try:
            relative_url = quote(Path(os.path.relpath(sources[name]["path"], output)).as_posix(), safe="/.")
        except ValueError:  # User-selected inputs can reside on a different Windows drive.
            relative_url = Path(sources[name]["path"]).as_uri()
        template = template.replace(original_link, escape(relative_url, quote=True))
    (output / "index.html").write_text(template, encoding="utf-8")
    report = {
        "status": "passed" if all(checks.values()) else "failed",
        "sources": sources, "outputs": output_info, "checks": checks,
        "picture": {"width": WIDTH, "height": HEIGHT, "fps": FPS, "crop": [560, 550, 0, 64]},
        "comparison": "Both start at t=0 at natural speed. Shorter picture holds its final frame. Each panel retains its own captions.",
        "audio": "One voice at a time. Original AAC packets copied without transcoding, gain, speed or pitch changes.",
        "sequentialPassOrder": ["bella", "chatterbox"],
        "secondPassVideoOffsetSeconds": duration,
        "secondPassStartsAtSeconds": duration + output_info["comparison"]["videoStartSeconds"],
        "timestampNote": "Concat preserves AAC priming and may shift the whole container slightly; pass offset is measured from its first video frame.",
        "ffmpeg": run([args.ffmpeg, "-version"]).splitlines()[0],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not all(checks.values()):
        raise ValueError(f"Comparison checks failed: {checks}")
    print(f"All {len(checks)} checks passed. Player: {output / 'index.html'}", flush=True)


if __name__ == "__main__":
    main()
