"""Pinned offline phoneme CTC alignment, promoted from the approved Claudia test.

Word timings follow exact narration text. CTC blank is not treated as silence;
short blank gaps are shared, and long pauses retain their measured gap.
"""
from __future__ import annotations
from functools import lru_cache
import importlib.metadata
import json
import math
from pathlib import Path
import re
import subprocess
import wave

DIPHTHONGS = {"aɪ": ["a", "ɪ"], "aʊ": ["a", "ʊ"], "eɪ": ["e", "ɪ"],
              "oʊ": ["o", "ʊ"], "ɔɪ": ["ɔ", "ɪ"]}


def phonemize_words(text: str, python: Path) -> dict:
    """Recover word boundaries when eSpeak fuses phrases such as 'do not'.

    Contextual phone order is preserved exactly. Isolated-word pronunciations
    only guide the boundaries in a minimum-edit monotone partition; they never
    replace the actual contextual phone sequence supplied to the acoustic model.
    """
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
                            capture_output=True, text=True, check=True, encoding="utf-8", timeout=60,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    data = json.loads(result.stdout)
    groups, raw_isolated = data["groups"], data["isolated"]
    raw_words = text.split()
    if len(raw_isolated) != len(raw_words):
        raise ValueError("eSpeak did not return every isolated written token")
    # Punctuation has no phonetic duration. Attach its exact text to a neighbor,
    # rather than stealing that neighbor's consonant to create a fake interval.
    words, isolated, leading = [], [], []
    for word, phones in zip(raw_words, raw_isolated, strict=True):
        if not phones:
            if any(character.isalnum() for character in word):
                raise ValueError("eSpeak cannot pronounce narration token: " + word)
            if words:
                words[-1] += " " + word
            else:
                leading.append(word)
        else:
            words.append(" ".join([*leading, word]))
            leading = []
            isolated.append(phones)
    if not words or leading:
        raise ValueError("Narration contains no pronounceable words")
    phones = [phone for group in groups for phone in group]
    if len(phones) < len(words):
        raise ValueError("Contextual narration has fewer phones than spoken words")
    if len(groups) == len(words) and all(groups):
        recovered = groups
        method = "Contextual eSpeak separators"
    else:
        # Monotone partition of the complete contextual phone sequence. Each
        # written token can span several groups (0.2.5), while a contextual group
        # can span several tokens (do not). Isolated phones only guide boundaries;
        # they never replace the actual contextual sequence.
        states = {0: (0.0, [])}
        for index, expected in enumerate(isolated):
            nxt = {}
            remaining = len(isolated) - index - 1
            for start, (cost, path) in states.items():
                maximum = min(len(phones) - remaining, start + len(expected) * 2 + 12)
                row = list(range(len(expected) + 1))
                for stop in range(start + 1, maximum + 1):
                    actual = phones[stop - 1]
                    next_row = [stop - start]
                    for j, target in enumerate(expected):
                        next_row.append(min(next_row[-1] + 1, row[j + 1] + 1, row[j] + (actual != target)))
                    row = next_row
                    # Tie-break toward plausible word lengths without overriding
                    # a real phone edit. Every phone must be consumed exactly once.
                    value = cost + row[-1] + abs((stop - start) - len(expected)) * 0.00001
                    if stop not in nxt or value < nxt[stop][0]:
                        nxt[stop] = (value, path + [(start, stop)])
            states = nxt
        if len(phones) not in states:
            raise ValueError("Cannot recover complete contextual word boundaries; spell out ambiguous narration using spokenText")
        recovered = [phones[start:stop] for start, stop in states[len(phones)][1]]
        method = "Minimum-edit monotone partition; expanded numbers and fused words retain contextual phones"
    if sum(recovered, []) != phones or " ".join(words) != " ".join(raw_words):
        raise ValueError("Word recovery changed narration text or contextual phones")
    return {"wordPhones": recovered, "wordTexts": words, "wordBoundaryMethod": method}


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


@lru_cache(maxsize=1)
def load_model(model_dir: Path):
    import torch
    from transformers import Wav2Vec2Config, Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC
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
    return processor, model, migrations


def align_audio(audio: Path, text: str, word_phones: list[list[str]], model_dir: Path, output: Path, word_texts: list[str] | None = None):
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
    processor, model, migrations = load_model(model_dir)
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
    for index, word in enumerate(word_texts if word_texts is not None else text.split()):
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
