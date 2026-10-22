"""Create fresh scene narration with Claudia's selected local Chatterbox profile.

Run synthesis in the Chatterbox CUDA environment, then alignment/content checking
in the existing CPU environment. Models stay local; no model downloads or uploads.
The approved character audition and reference fixtures are read-only inputs.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import random
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODELS = Path("D:/CodexModels/ClaudiaAuditions20261022")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def save(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def load_script(path: Path) -> tuple[dict, list[dict]]:
    script = json.loads(path.read_text(encoding="utf-8-sig"))
    scenes = script["scenes"]
    ids = [scene["id"] for scene in scenes]
    if not scenes or len(set(ids)) != len(ids):
        raise ValueError("Scene IDs must be unique")
    for scene in scenes:
        if not re.fullmatch(r"[a-z0-9_-]+", scene["id"]):
            raise ValueError("Scene IDs must be filesystem-safe lowercase names")
        if not isinstance(scene["narration"], str) or not scene["narration"].strip():
            raise ValueError("Every scene needs narration")
    return script, scenes


def delivery_plan(script: dict, scene: dict, default_settings: dict, seed: int, normalize) -> list[dict]:
    """Resolve opt-in expressive chunks without changing the default voice.

    Pauses are extra silence after each complete generated chunk, in addition to
    the model's own sentence pauses. The joined scene is aligned only afterward.
    """
    global_delivery = script.get("delivery", {})
    scene_delivery = scene.get("delivery", {})
    settings = {**default_settings, **global_delivery.get("settings", {}),
                **scene_delivery.get("settings", {})}
    segments = scene_delivery.get("segments")
    if segments is None:
        segments = [{"id": "complete-scene", "text": scene["narration"], "pauseAfterSeconds": 0}]
    if not isinstance(segments, list) or not segments:
        raise ValueError("Delivery segments must be a nonempty list")
    plan = []
    for index, segment in enumerate(segments):
        segment_settings = {**settings, **segment.get("settings", {})}
        if set(segment_settings) != set(default_settings):
            raise ValueError("Unknown Chatterbox delivery setting")
        if any(not isinstance(v, (float, int)) or not math.isfinite(v) for v in segment_settings.values()):
            raise ValueError("Delivery settings must be finite numbers")
        bounds = {"exaggeration": (0, 2), "cfg_weight": (0, 1), "temperature": (.1, 1.5),
                  "repetition_penalty": (1, 3), "min_p": (0, 1), "top_p": (.01, 1)}
        for name, (minimum, maximum) in bounds.items():
            if not minimum <= segment_settings[name] <= maximum:
                raise ValueError("Delivery setting outside supported range: " + name)
        identity = segment.get("id", f"segment-{index + 1:02}")
        if not isinstance(identity, str) or not re.fullmatch(r"[a-z0-9_-]+", identity):
            raise ValueError("Segment IDs must be filesystem-safe lowercase names")
        source_text = segment.get("text")
        if not isinstance(source_text, str) or not source_text.strip():
            raise ValueError("Every delivery segment needs text")
        pause = segment.get("pauseAfterSeconds", 0)
        if not isinstance(pause, (float, int)) or not math.isfinite(pause) or not 0 <= pause <= 2:
            raise ValueError("Delivery pauses must be between zero and two seconds")
        plan.append({"id": identity, "text": normalize(source_text), "settings": segment_settings,
                     "pauseAfterSeconds": pause, "seed": seed + index * 100000})
    if len({segment["id"] for segment in plan}) != len(plan):
        raise ValueError("Delivery segment IDs must be unique within a scene")
    if " ".join(segment["text"] for segment in plan) != normalize(scene["narration"]):
        raise ValueError("Joined delivery text must match the complete normalized narration")
    return plan


def phonemize_words(text: str, helper) -> dict:
    """Recover word boundaries when eSpeak fuses phrases such as 'do not'.

    Contextual phone order is preserved exactly. Isolated-word pronunciations
    only guide the boundaries in a minimum-edit monotone partition; they never
    replace the actual contextual phone sequence supplied to the acoustic model.
    """
    python = ROOT / ".venv-kokoro/Scripts/python.exe"
    try:
        result = helper.phonemize(text, python)
        result["wordBoundaryMethod"] = "Original contextual eSpeak separators"
        return result
    except ValueError as error:
        if "word count" not in str(error):
            raise
    code = """
import json,os,sys,espeakng_loader
from phonemizer.backend import EspeakBackend
from phonemizer.separator import Separator
EspeakBackend.set_library(espeakng_loader.get_library_path())
os.environ['ESPEAK_DATA_PATH']=espeakng_loader.get_data_path()
text=json.loads(sys.stdin.read())
b=EspeakBackend('en-us',preserve_punctuation=False,with_stress=False)
sep=Separator(phone=' ',word='|',syllable='')
full=b.phonemize([text],separator=sep,strip=True)[0]
isolated=b.phonemize(text.split(),separator=sep,strip=True)
print(json.dumps({'groups':[g.split() for g in full.split('|')],
 'isolated':[w.replace('|',' ').split() for w in isolated]}))
"""
    result = subprocess.run([str(python), "-c", code], input=json.dumps(text),
                            capture_output=True, text=True, check=True, encoding="utf-8")
    data = json.loads(result.stdout)
    groups, isolated = data["groups"], data["isolated"]

    def distance(a, b):
        row = list(range(len(b) + 1))
        for i, av in enumerate(a):
            nxt = [i + 1]
            for j, bv in enumerate(b):
                nxt.append(min(nxt[-1] + 1, row[j + 1] + 1, row[j] + (av != bv)))
            row = nxt
        return row[-1]

    # Associate each contextual group with one to three consecutive written words.
    states = {0: (0, [])}
    for group in groups:
        nxt = {}
        for first, (cost, path) in states.items():
            for count in range(1, 4):
                end = first + count
                if end > len(isolated):
                    break
                candidate = sum(isolated[first:end], [])
                value = cost + distance(group, candidate)
                if end not in nxt or value < nxt[end][0]:
                    nxt[end] = (value, path + [(first, end)])
        states = nxt
    if len(isolated) not in states:
        raise ValueError("Cannot recover contextual word boundaries")
    recovered, fused = [], []
    for group, (first, end) in zip(groups, states[len(isolated)][1], strict=True):
        if end == first + 1:
            recovered.append(group)
            continue
        # Partition a fused group using edit distance to its word pronunciations.
        divisions = {0: (0, [])}
        for word in isolated[first:end]:
            nxt = {}
            for start, (cost, path) in divisions.items():
                for stop in range(start + 1, len(group) + 1):
                    value = cost + distance(group[start:stop], word)
                    if stop not in nxt or value < nxt[stop][0]:
                        nxt[stop] = (value, path + [group[start:stop]])
            divisions = nxt
        if len(group) not in divisions:
            raise ValueError("Fused phrase has fewer phones than words")
        recovered.extend(divisions[len(group)][1])
        fused.append({"words": text.split()[first:end], "contextualPhones": group,
                      "partition": divisions[len(group)][1]})
    if len(recovered) != len(text.split()) or sum(recovered, []) != sum(groups, []):
        raise ValueError("Word recovery changed the contextual phone sequence")
    return {"wordPhones": recovered, "wordBoundaryMethod": "Minimum-edit monotone partition of fused eSpeak groups; contextual phones unchanged",
            "fusedGroups": fused}


def synthesize(args: argparse.Namespace) -> None:
    import numpy as np
    import pyloudnorm as pyln
    import soundfile as sf
    import torch
    # Import directly so a dependency failure cannot silently disable watermarking.
    from perth.perth_net.perth_net_implicit.perth_watermarker import PerthImplicitWatermarker
    from chatterbox.tts import ChatterboxTTS, punc_norm

    script, scenes = load_script(args.script)
    profile_path = ROOT / "fixtures/presenters/claudia/selected-voice.json"
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    if profile["engine"] != "chatterbox" or profile["voice"] != "chatterbox-bella":
        raise ValueError("This runner requires the selected Chatterbox/Bella profile")
    reference = ROOT / profile["referenceAudio"]
    if digest(reference) != profile["referenceSha256"]:
        raise ValueError("The selected frozen Bella reference has changed")
    expected_package = profile["synthesis"]["package"].split("==")
    if importlib.metadata.version(expected_package[0]) != expected_package[1]:
        raise ValueError("Chatterbox package differs from the selected profile")
    setup_path = ROOT / ".explain-to-me/experiments/chatterbox/setup.json"
    setup = json.loads(setup_path.read_text(encoding="utf-8"))
    if setup["modelRevision"] != profile["synthesis"]["modelRevision"]:
        raise ValueError("Chatterbox model revision differs from the selected profile")
    model_dir = args.models / "chatterbox/models"
    for record in setup["weights"]:
        if digest(model_dir / record["file"]) != record["sha256"]:
            raise ValueError("Changed local model file: " + record["file"])
    if not torch.cuda.is_available():
        raise RuntimeError("Narration generation requires the installed CUDA environment")
    torch.set_num_threads(4)
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    print("Loading the selected Chatterbox model locally", flush=True)
    model = ChatterboxTTS.from_local(model_dir, device="cuda")
    records = []
    for index, scene in enumerate(scenes):
        output = args.output / scene["id"]
        output.mkdir(exist_ok=True)
        record_file = output / "synthesis.json"
        text = punc_norm(scene["narration"])
        seed = profile["synthesis"]["seed"] + index + (args.seed_offset if not args.only_scene or scene["id"] in args.only_scene else 0)
        if args.only_scene and scene["id"] not in args.only_scene and record_file.exists():
            # Targeted retakes can coexist with an earlier nonzero global seed
            # offset. Preserve each unselected take's recorded seed exactly.
            seed = json.loads(record_file.read_text(encoding="utf-8"))["identity"]["seed"]
        plan = delivery_plan(script, scene, profile["synthesis"]["settings"], seed, punc_norm)
        expressive = bool(script.get("delivery") or scene.get("delivery"))
        identity = {"text": text, "seed": seed, "settings": plan[0]["settings"],
                    "referenceSha256": profile["referenceSha256"], "targetLufs": args.lufs}
        if expressive:
            identity["deliverySegments"] = plan
        if record_file.exists():
            prior = json.loads(record_file.read_text(encoding="utf-8"))
            if prior["identity"] != identity or digest(output / "audio.wav") != prior["audioSha256"]:
                raise ValueError(f"Existing scene differs; use a fresh output directory: {scene['id']}")
            records.append(prior)
            print(f"Reusing verified {scene['id']}: {prior['durationSeconds']:.2f}s", flush=True)
            continue
        if args.only_scene and scene["id"] not in args.only_scene:
            raise ValueError("A scene outside --only-scene has no verified existing take: " + scene["id"])
        if (output / "raw.wav").exists() or (output / "audio.wav").exists():
            raise FileExistsError(f"Unrecorded output exists: {output}")
        print(f"Generating {scene['id']}: {len(text.split())} words", flush=True)
        scene_start = time.perf_counter()
        chunks, segment_records, cursor = [], [], 0
        for segment in plan:
            random.seed(segment["seed"])
            np.random.seed(segment["seed"])
            torch.manual_seed(segment["seed"])
            torch.cuda.manual_seed_all(segment["seed"])
            print(f"  Segment {segment['id']}: exaggeration={segment['settings']['exaggeration']}, cfg={segment['settings']['cfg_weight']}", flush=True)
            waveform = model.generate(segment["text"], audio_prompt_path=str(reference), **segment["settings"])
            chunk = waveform.detach().cpu().numpy().reshape(-1)
            if not chunk.size or not np.isfinite(chunk).all():
                raise ValueError("Invalid raw waveform")
            pause_samples = round(segment["pauseAfterSeconds"] * model.sr)
            chunk_record = {**segment, "startSample": cursor, "endSample": cursor + len(chunk),
                            "startSeconds": cursor / model.sr,
                            "endSeconds": (cursor + len(chunk)) / model.sr,
                            "samples": len(chunk), "insertedSilenceSamples": pause_samples}
            if expressive:
                segment_path = output / "segments" / (segment["id"] + ".wav")
                segment_path.parent.mkdir(exist_ok=True)
                sf.write(segment_path, chunk, model.sr, subtype="FLOAT")
                chunk_record.update({"rawAudio": str(segment_path.resolve()), "rawAudioSha256": digest(segment_path)})
            chunks.extend([chunk, np.zeros(pause_samples, dtype=np.float32)])
            cursor += len(chunk) + pause_samples
            segment_records.append(chunk_record)
        samples = np.concatenate(chunks)
        # The model can emit float peaks above unity on emphatic words. Retain
        # those values in the untouched float master, then normalize the delivery
        # WAV before PCM16 encoding so neither file clips on write.
        sf.write(output / "raw.wav", samples, model.sr, subtype="FLOAT")
        meter = pyln.Meter(model.sr)
        loudness = meter.integrated_loudness(samples)
        gain_db = args.lufs - loudness
        gain = 10 ** (gain_db / 20)
        peak_limit = 10 ** (-1 / 20)
        if np.max(np.abs(samples)) * gain > peak_limit:
            gain = peak_limit / float(np.max(np.abs(samples)))
            gain_db = 20 * math.log10(gain)
        normalized = samples * gain
        sf.write(output / "audio.wav", normalized, model.sr, subtype="PCM_16")
        record = {"id": scene["id"], "identity": identity, "text": text,
                  "originalNarration": scene["narration"], "voice": profile["voice"],
                  "model": profile["synthesis"]["model"],
                  "modelRevision": profile["synthesis"]["modelRevision"],
                  "package": profile["synthesis"]["package"], "reference": str(reference),
                  "referenceSha256": profile["referenceSha256"],
                  "audio": str((output / "audio.wav").resolve()),
                  "rawAudioSha256": digest(output / "raw.wav"),
                  "audioSha256": digest(output / "audio.wav"),
                  "durationSeconds": len(samples) / model.sr, "samples": len(samples),
                  "sampleRate": model.sr, "channels": 1, "sampleWidthBytes": 2,
                  "sourceLufs": loudness, "gainDb": gain_db,
                  "rawPeakDbfs": 20 * math.log10(float(np.max(np.abs(samples)))),
                  "outputLufs": meter.integrated_loudness(normalized),
                  "peakDbfs": 20 * math.log10(float(np.max(np.abs(normalized)))),
                  "generationSeconds": time.perf_counter() - scene_start,
                  "postProcessing": "Generated chunks joined with explicitly recorded silence when requested; constant gain and PCM16 encoding; no pitch/speed changes; native Perth watermark preserved"}
        if expressive:
            record["deliverySegments"] = segment_records
            record["insertedSilenceSeconds"] = sum(segment["insertedSilenceSamples"] for segment in segment_records) / model.sr
        save(record_file, record)
        records.append(record)
        print(f"Saved {scene['id']}: {record['durationSeconds']:.2f}s", flush=True)
    save(args.output / "synthesis.json", {
        "schema": "claudia-explainer-synthesis/v1", "scriptSha256": digest(args.script),
        "selectedProfileSha256": digest(profile_path), "runnerSha256": digest(Path(__file__)),
        "setupSha256": digest(setup_path), "gpu": torch.cuda.get_device_name(0),
        "elapsedSeconds": time.perf_counter() - started,
        "durationSeconds": sum(scene["durationSeconds"] for scene in records), "scenes": records,
    })


def align(args: argparse.Namespace) -> None:
    helper = module(ROOT / "scripts/claudia-character/prepare-chatterbox-performance.py", "claudia_alignment")
    _, scenes = load_script(args.script)
    model_dir = args.models / "alignment/wav2vec2-phoneme"
    provenance = json.loads((model_dir / "provenance.json").read_text(encoding="utf-8"))
    if provenance["revision"] != helper.MODEL_REVISION:
        raise ValueError("Unexpected acoustic model revision")
    for name, record in provenance["files"].items():
        if digest(model_dir / name) != record["sha256"]:
            raise ValueError("Changed acoustic model: " + name)
    records = []
    for scene in scenes:
        directory = args.output / scene["id"]
        synthesis = json.loads((directory / "synthesis.json").read_text(encoding="utf-8"))
        if synthesis["originalNarration"] != scene["narration"]:
            raise ValueError("Script changed after synthesis: " + scene["id"])
        audio = directory / "audio.wav"
        if digest(audio) != synthesis["audioSha256"]:
            raise ValueError("Changed narration audio: " + scene["id"])
        timing_path = directory / "timings.json"
        if timing_path.exists():
            timing = json.loads(timing_path.read_text(encoding="utf-8"))
            if timing["text"] != synthesis["text"] or timing["audioSha256"] != synthesis["audioSha256"]:
                raise ValueError("Existing timing differs from narration")
        else:
            print("Aligning " + scene["id"], flush=True)
            phones = phonemize_words(synthesis["text"], helper)
            words, ipa, report = helper.align_audio(audio, synthesis["text"], phones["wordPhones"], model_dir, directory)
            helper.verify_intervals(words, synthesis["durationSeconds"])
            helper.verify_intervals(ipa, synthesis["durationSeconds"])
            timing = {"id": scene["id"], "text": synthesis["text"], "voice": synthesis["voice"],
                      "audio": str(audio.resolve()), "audioSha256": synthesis["audioSha256"],
                      "referenceSha256": synthesis["referenceSha256"],
                      "durationSeconds": synthesis["durationSeconds"], "samples": synthesis["samples"],
                      "sampleRate": synthesis["sampleRate"], "words": words, "phonemes": ipa}
            if synthesis.get("deliverySegments"):
                timing["deliverySegments"] = synthesis["deliverySegments"]
            save(timing_path, timing)
            save(directory / "alignment.json", {"model": provenance, "phonemization": phones, **report})
        records.append(timing)
        print(f"Aligned {scene['id']}: {len(timing['words'])} words, {len(timing['phonemes'])} phones", flush=True)
    save(args.output / "narration.json", {
        "schema": "claudia-explainer-narration/v1", "voice": "chatterbox-bella",
        "scriptSha256": digest(args.script), "sampleRate": 24000,
        "durationSeconds": sum(scene["durationSeconds"] for scene in records),
        "timingBasis": "Per-scene local seconds, aligned to each exact normalized audio WAV",
        "alignment": "Pinned Meta phoneme CTC with contextual eSpeak phones and constrained Viterbi",
        "scenes": records,
    })


def check(args: argparse.Namespace) -> None:
    import numpy as np
    import soundfile as sf
    import torch
    import whisper
    from scipy.signal import resample_poly
    helper = module(ROOT / "scripts/claudia-prosody/check_content.py", "claudia_content")
    _, scenes = load_script(args.script)
    model_path = args.models / "asr/small.en.pt"
    if digest(model_path) != whisper._MODELS["small.en"].split("/")[-2]:
        raise ValueError("Cached Whisper checksum mismatch")
    torch.set_num_threads(6)
    model = None
    records = []
    for scene in scenes:
        directory = args.output / scene["id"]
        synthesis = json.loads((directory / "synthesis.json").read_text(encoding="utf-8"))
        if synthesis["originalNarration"] != scene["narration"]:
            raise ValueError("Script changed after synthesis: " + scene["id"])
        audio = directory / "audio.wav"
        if digest(audio) != synthesis["audioSha256"]:
            raise ValueError("Changed audio")
        prior_path = directory / "content-check.json"
        if prior_path.exists():
            prior = json.loads(prior_path.read_text(encoding="utf-8"))
            if prior["audioSha256"] == synthesis["audioSha256"] and prior["expected"] == synthesis["text"]:
                records.append(prior)
                print("Reusing verified content check: " + scene["id"], flush=True)
                continue
        if model is None:
            model = whisper.load_model(str(model_path), device="cpu")
        samples, rate = sf.read(audio, dtype="float32")
        divisor = math.gcd(rate, 16000)
        samples = resample_poly(samples, 16000 // divisor, rate // divisor).astype(np.float32)
        print("Checking spoken wording: " + scene["id"], flush=True)
        result = model.transcribe(samples, **helper.OPTIONS)
        observed = result["text"].strip()
        edits = helper.differences(helper.words(synthesis["text"]), helper.words(observed))
        record = {"id": scene["id"], "expected": synthesis["text"], "transcript": observed,
                  "audioSha256": synthesis["audioSha256"], "normalizedWordsMatch": not edits,
                  "differences": edits, "segments": result["segments"]}
        save(directory / "content-check.json", record)
        records.append(record)
        print(json.dumps({"id": scene["id"], "transcript": observed, "differences": edits}), flush=True)
    save(args.output / "content-check.json", {
        "method": "Independent local CPU Whisper small.en, without reference-text prompt",
        "modelSha256": digest(model_path), "options": helper.OPTIONS,
        "limitation": "ASR errors need review; matching words do not prove expressive delivery quality",
        "scenes": records,
    })


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["synthesize", "align", "check"])
    parser.add_argument("--script", type=Path, default=ROOT / "scripts/claudia-explainer/ben-egirls.json")
    parser.add_argument("--output", type=Path, default=ROOT / "out/ben-egirls-narration")
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument("--lufs", type=float, default=-19)
    parser.add_argument("--seed-offset", type=int, default=0)
    parser.add_argument("--only-scene", action="append", help="Generate only these scene IDs; reuse existing verified takes for others")
    args = parser.parse_args()
    args.script, args.output, args.models = args.script.resolve(), args.output.resolve(), args.models.resolve()
    os.environ.update({"HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1",
                       "HF_HOME": str(args.output / ".hf")})
    {"synthesize": synthesize, "align": align, "check": check}[args.mode](args)


if __name__ == "__main__":
    main()
