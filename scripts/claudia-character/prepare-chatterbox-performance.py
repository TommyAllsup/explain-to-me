"""Locally force-align the accepted Chatterbox WAV with a phoneme acoustic model.

The original WAV is copied byte-for-byte. A pinned Meta wav2vec2 model measures
phoneme CTC emissions; constrained Viterbi alignment follows the exact script's
eSpeak phone sequence. No Bella timing is reused and no audio is regenerated.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import re
import shutil
import subprocess
import time
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIO_SHA256 = "20cd6bb34b566fadee4a2e37d1897a86e472d8cc060409bc2f2477fbfe2b6767"
REFERENCE_SHA256 = "3188194b9e9cacc7e35b48fbb2095b5d139adfe967abd4c2f5dd5cc5bade1733"
MODEL_ID = "facebook/wav2vec2-lv-60-espeak-cv-ft"
MODEL_REVISION = "ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4"
MODEL_FILES = {
    "README.md": None, "config.json": None, "preprocessor_config.json": None,
    "pytorch_model.bin": "3173bde9e9ce490fa0f989e413c42f25bc1820c020adc1e6b9b87025b3cfcc5e",
    "special_tokens_map.json": None, "tokenizer_config.json": None, "vocab.json": None,
}
DIPHTHONGS = {"aɪ": ["a", "ɪ"], "aʊ": ["a", "ʊ"], "eɪ": ["e", "ɪ"],
              "oʊ": ["o", "ʊ"], "ɔɪ": ["ɔ", "ɪ"]}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def prepare_model(directory: Path) -> dict:
    files = {}
    for relative, expected in MODEL_FILES.items():
        target = directory / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/{MODEL_ID}/resolve/{MODEL_REVISION}/{relative}"
        if not target.exists():
            temporary = target.with_suffix(target.suffix + ".download")
            with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
            temporary.replace(target)
        actual = digest(target)
        if expected and actual != expected:
            raise ValueError(f"Model SHA256 mismatch: {relative}")
        files[relative] = {"sha256": actual, "bytes": target.stat().st_size, "url": url}
    provenance = {"model": MODEL_ID, "revision": MODEL_REVISION, "license": "Apache-2.0",
                  "author": "Meta / Facebook AI", "files": files}
    write_json(directory / "provenance.json", provenance)
    return provenance


def phonemize(text: str, python: Path) -> dict:
    # Use the already working Kokoro environment solely for its eSpeak DLL.
    # Generating all words in one call retains contextual weak-form vowels.
    code = """
import json,os,sys,importlib.metadata,espeakng_loader
from phonemizer.backend import EspeakBackend
from phonemizer.separator import Separator
EspeakBackend.set_library(espeakng_loader.get_library_path())
os.environ['ESPEAK_DATA_PATH']=espeakng_loader.get_data_path()
backend=EspeakBackend('en-us',preserve_punctuation=False,with_stress=False)
text=json.loads(sys.stdin.read())
phones=backend.phonemize([text],separator=Separator(phone=' ',word='|',syllable=''),strip=True)[0]
print(json.dumps({'wordPhones':[part.split() for part in phones.split('|')],
 'espeakVersion':str(backend.version()),
 'versions':{name:importlib.metadata.version(name) for name in ['phonemizer','espeakng-loader']}}))
"""
    result = subprocess.run([str(python), "-c", code], input=json.dumps(text), text=True,
                            capture_output=True, check=True, encoding="utf-8")
    value = json.loads(result.stdout)
    if len(value["wordPhones"]) != len(text.split()) or any(not phones for phones in value["wordPhones"]):
        raise ValueError("eSpeak did not preserve the exact script's word count")
    return value


def viterbi(log_probs, target_ids: list[int], blank: int = 0):
    """Expanded CTC trellis: stay, advance one, or skip a separating blank.

    Every target phone must be visited in order. Adjacent duplicate phones must
    pass through a blank state, as required by CTC; none can be silently dropped.
    """
    import numpy as np
    states = np.full(2 * len(target_ids) + 1, blank, dtype=np.int64)
    states[1::2] = target_ids
    count = len(states)
    score = np.full(count, -np.inf, dtype=np.float64)
    score[0] = log_probs[0, blank]
    score[1] = log_probs[0, states[1]]
    back = np.zeros((len(log_probs), count), dtype=np.uint8)
    skip_allowed = np.zeros(count, dtype=bool)
    skip_allowed[2:] = (states[2:] != blank) & (states[2:] != states[:-2])
    for frame in range(1, len(log_probs)):
        previous = np.concatenate(([-np.inf], score[:-1]))
        skip = np.concatenate(([-np.inf, -np.inf], score[:-2]))
        skip[~skip_allowed] = -np.inf
        options = np.stack((score, previous, skip))
        choices = options.argmax(axis=0)
        score = options[choices, np.arange(count)] + log_probs[frame, states]
        back[frame] = choices
    state = count - 1 if score[-1] >= score[-2] else count - 2
    if not math.isfinite(float(score[state])):
        raise ValueError("No complete CTC path exists for the exact phoneme sequence")
    path = np.zeros(len(log_probs), dtype=np.int32)
    for frame in range(len(log_probs) - 1, -1, -1):
        path[frame] = state
        state -= int(back[frame, state])
    return path, float(max(score[-1], score[-2]))


def verify_intervals(items: list[dict], duration: float) -> None:
    previous = 0.0
    for item in items:
        start, end = item["start"], item["end"]
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= duration + 1e-6):
            raise ValueError(f"Invalid timing interval: {item}")
        if start < previous - 1e-6:
            raise ValueError(f"Overlapping timing intervals: {item}")
        previous = end


def align_audio(audio: Path, text: str, word_phones: list[list[str]], model_dir: Path, output: Path):
    import numpy as np
    import torch
    from scipy.signal import resample_poly
    from transformers import Wav2Vec2Config, Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

    torch.set_num_threads(4)
    vocab = json.loads((model_dir / "vocab.json").read_text(encoding="utf-8"))
    phones = [phone for group in word_phones for phone in group]
    missing = sorted(set(phones) - set(vocab))
    if missing:
        raise ValueError(f"eSpeak phones absent from acoustic model vocabulary: {missing}")
    with wave.open(str(audio), "rb") as wav:
        native_rate = wav.getframerate()
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768
    waveform = resample_poly(samples, 2, 3).astype(np.float32)
    processor = Wav2Vec2FeatureExtractor.from_pretrained(str(model_dir), local_files_only=True)
    model = Wav2Vec2ForCTC(Wav2Vec2Config.from_pretrained(str(model_dir), local_files_only=True)).eval()
    state = torch.load(model_dir / "pytorch_model.bin", map_location="cpu", weights_only=True)
    # Older checkpoints name weight-norm tensors weight_g/weight_v; current
    # Torch exposes the identical tensors through parametrizations. Explicit
    # migration plus strict loading prevents silent random initialization.
    migrations = {}
    for old, new in [("weight_g", "parametrizations.weight.original0"),
                     ("weight_v", "parametrizations.weight.original1")]:
        source_key = "wav2vec2.encoder.pos_conv_embed.conv." + old
        target_key = "wav2vec2.encoder.pos_conv_embed.conv." + new
        if source_key in state and target_key in model.state_dict():
            state[target_key] = state.pop(source_key)
            migrations[source_key] = target_key
    model.load_state_dict(state, strict=True)
    del state
    values = processor(waveform, sampling_rate=16000, return_tensors="pt")
    with torch.inference_mode():
        log_probs = model(**values).logits[0].log_softmax(-1).numpy()
    stride = int(np.prod(model.config.conv_stride))
    receptive_field, dilation = 1, 1
    for kernel, step in zip(model.config.conv_kernel, model.config.conv_stride, strict=True):
        receptive_field += (kernel - 1) * dilation
        dilation *= step
    frame_seconds = stride / 16000
    # Each convolution window is 25 ms, centered 12.5 ms from its start.
    # CTC spans below cover the centers' Voronoi bins at the native 20 ms step.
    frame_offset = (receptive_field - stride) / 2 / 16000
    path, score = viterbi(log_probs, [vocab[phone] for phone in phones], vocab["<pad>"])
    source = []
    word_indices = [i for i, group in enumerate(word_phones) for _ in group]
    for index, phone in enumerate(phones):
        frames = np.flatnonzero(path == index * 2 + 1)
        if len(frames) == 0:
            raise ValueError(f"Missing aligned phone {index}: {phone}")
        start = float(frames[0] * frame_seconds + frame_offset)
        end = float((frames[-1] + 1) * frame_seconds + frame_offset)
        confidence = float(np.exp(log_probs[frames, vocab[phone]]).mean())
        source.append({"phoneme": phone, "start": start, "end": end,
                       "score": confidence, "wordIndex": word_indices[index],
                       "firstFrame": int(frames[0]), "lastFrame": int(frames[-1])})
    # CTC blank is not a silence label. Fill its short gaps halfway between
    # neighboring phone evidence; preserve longer pauses, with at most 40 ms
    # support beyond either side's posterior. This is an explicit timing
    # interpretation, not a claim of frame-level human phonetic annotation.
    intervals = [dict(phone) for phone in source]
    for left, right in zip(intervals, intervals[1:]):
        gap = right["start"] - left["end"]
        if gap <= .12:
            boundary = (left["end"] + right["start"]) / 2
            left["end"], right["start"] = boundary, boundary
        else:
            left["end"] += .04
            right["start"] -= .04
    words = []
    for index, word in enumerate(text.split()):
        group = [phone for phone in intervals if phone["wordIndex"] == index]
        words.append({"text": word, "start": round(group[0]["start"], 6),
                      "end": round(group[-1]["end"], 6)})
    ipa = []
    for phone in intervals:
        symbol = re.sub(r"[ˈˌːˑ]", "", phone["phoneme"])
        parts = DIPHTHONGS.get(symbol, [symbol])
        for index, part in enumerate(parts):
            start = phone["start"] + (phone["end"] - phone["start"]) * index / len(parts)
            end = phone["start"] + (phone["end"] - phone["start"]) * (index + 1) / len(parts)
            ipa.append({"phoneme": part, "start": round(start, 6), "end": round(end, 6)})
    # Retain emissions so the result can be inspected without reloading a model.
    np.savez_compressed(output / "alignment-emissions.npz", logProbabilities=log_probs, ctcPath=path)
    reverse = {value: key for key, value in vocab.items()}
    greedy, previous = [], None
    for token in log_probs.argmax(axis=-1):
        if token != previous and token != vocab["<pad>"]:
            greedy.append(reverse[int(token)])
        previous = token
    report = {"sourcePhones": source, "interpretedPhones": intervals, "ctcLogScore": score,
              "greedyPhoneRecognition": greedy, "frameSeconds": frame_seconds,
              "frameOffsetSeconds": frame_offset, "receptiveFieldSamples": receptive_field,
              "minimumPhonePosterior": min(phone["score"] for phone in source),
              "medianPhonePosterior": float(np.median([phone["score"] for phone in source])),
              "lowConfidencePhones": [phone for phone in source if phone["score"] < .1],
              "blankPolicy": "Gaps <=120 ms split at midpoint; longer blank gaps keep a pause after 40 ms extension per side",
              "diphthongPolicy": "Equal visual subdivisions inside each aligned diphthong interval",
              "normalization": "Internal 24-to-16 kHz polyphase resampling; model-configured zero-mean/unit-variance input; output WAV unchanged",
              "strictCheckpointLoad": True, "checkpointKeyMigrations": migrations,
              "packages": {name: importlib.metadata.version(name) for name in ["torch", "transformers", "numpy", "scipy"]}}
    return words, ipa, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, default=ROOT / "out/claudia-prosody-auditions/C-chatterbox.wav")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--phonemizer-python", type=Path, default=ROOT / ".venv-kokoro/Scripts/python.exe")
    parser.add_argument("--model-directory", type=Path, required=True)
    parser.add_argument("--prepare", action="store_true", help="Download pinned alignment model only")
    args = parser.parse_args()
    model_dir = args.model_directory.resolve()
    if args.prepare:
        prepare_model(model_dir)
        print(f"Prepared {MODEL_ID}@{MODEL_REVISION}: {model_dir}")
        return
    if not args.output:
        parser.error("Alignment requires --output")
    audio = args.audio.resolve(strict=True)
    if digest(audio) != AUDIO_SHA256:
        raise ValueError("Expected the exact reviewed, normalized Chatterbox audition")
    with wave.open(str(audio), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 24000):
            raise ValueError("Expected mono PCM16 at 24 kHz")
        samples, rate = wav.getnframes(), wav.getframerate()
    duration = samples / rate
    config_path = ROOT / "fixtures/presenters/claudia/voice-audition.json"
    text = json.loads(config_path.read_text(encoding="utf-8"))["text"]
    provenance = json.loads((model_dir / "provenance.json").read_text(encoding="utf-8"))
    if provenance["revision"] != MODEL_REVISION:
        raise ValueError("Unexpected alignment model revision")
    for relative, info in provenance["files"].items():
        if digest(model_dir / relative) != info["sha256"]:
            raise ValueError(f"Changed alignment model file: {relative}")
    output = args.output.resolve()
    output.mkdir(parents=False, exist_ok=False)
    target = output / "audio.wav"
    shutil.copyfile(audio, target)
    (output / "script.txt").write_text(text + "\n", encoding="utf-8")
    started = time.perf_counter()
    phonemization = phonemize(text, args.phonemizer_python.resolve(strict=True))
    words, phonemes, alignment = align_audio(target, text, phonemization["wordPhones"], model_dir, output)
    verify_intervals(words, duration)
    verify_intervals(phonemes, duration)
    sentences = re.findall(r"[^.!?]+[.!?]", text)
    starts, cursor = [0], 0
    for sentence in sentences[:-1]:
        cursor += len(sentence.split())
        starts.append(round(words[cursor]["start"] * rate))
    cues = [{"text": sentence.strip(), "startSample": start, "endSample": end}
            for sentence, start, end in zip(sentences, starts, starts[1:] + [samples], strict=True)]
    if len(cues) != 6 or digest(target) != AUDIO_SHA256 or " ".join(word["text"] for word in words) != text:
        raise ValueError("Audio or complete script coverage changed")
    method = "Local Meta wav2vec2 phoneme-CTC forced alignment of exact Chatterbox WAV and contextual eSpeak script phones; blank gaps bounded and diphthongs subdivided for visemes"
    timing = {"version": 2, "voice": "chatterbox-bella", "sampleRate": rate, "samples": samples,
              "audioSha256": AUDIO_SHA256, "referenceSha256": REFERENCE_SHA256, "method": method,
              "text": text, "cues": cues, "words": words, "phonemes": phonemes}
    report = {"performance": "Exact accepted Chatterbox audition; no resynthesis or audio processing",
              "engine": "Chatterbox", "voice": "chatterbox-bella", "audioSha256": AUDIO_SHA256,
              "referenceSha256": REFERENCE_SHA256, "sourceAudio": str(audio), "samples": samples,
              "sampleRate": rate, "durationSeconds": duration, "durationCorrection": False,
              "generatorSha256": digest(Path(__file__)), "scriptFileSha256": digest(config_path),
              "alignment": {"method": method, "model": provenance, "phonemization": phonemization,
                            "elapsedSeconds": time.perf_counter() - started, **alignment,
                            "sentenceCues": "Start at next sentence's aligned first word; first cue includes leading silence; final cue includes tail",
                            "limitations": "Automatic phoneme acoustic estimates on 20 ms frames; CTC blanks are not silence labels; no manual phonetic annotation",
                            "fallbackReason": "MFA Windows installation failed in an unrelated GDK post-install dependency"},
              "checks": {"audioCopiedByteForByte": digest(target) == digest(audio), "exactWordOrder": True,
                         "phonemesAndWordsMonotonicAndInBounds": True, "sentenceCount": len(cues),
                         "wordCount": len(words), "ipaIntervalCount": len(phonemes)}}
    write_json(output / "timings.json", timing)
    write_json(output / "report.json", report)
    print(f"Chatterbox: {duration:.3f}s, {len(words)} aligned words, {len(phonemes)} IPA intervals -> {output}")


if __name__ == "__main__":
    main()
