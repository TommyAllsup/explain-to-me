"""Offline Claudia bridge contracts. No GPU or downloaded model is required."""
import copy
import hashlib
import json
import math
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

import claudia_bridge as bridge
import claudia_alignment as alignment


class ClaudiaBridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="claudia test café ")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.request = {"outputDirectory": str(self.root), "chunks": [{"id": "con", "text": "See?", "seed": 20261022}]}

    def test_native_paths_and_reserved_device_ids_remain_valid(self):
        directory, chunks = bridge.validate_request(self.request)
        self.assertEqual(directory, self.root)
        self.assertEqual(chunks[0]["id"], "con")

    def test_invalid_bounds_paths_and_duplicates_fail_before_model_imports(self):
        invalid = [
            {**self.request, "outputDirectory": "relative"},
            {**self.request, "chunks": []},
            {**self.request, "chunks": self.request["chunks"] * 2},
            {**self.request, "unknown": True},
        ]
        for field, value in [("id", "../escape"), ("text", "x" * 1601), ("text", " "), ("seed", True), ("seed", -1)]:
            item = copy.deepcopy(self.request)
            item["chunks"][0][field] = value
            invalid.append(item)
        for value in invalid:
            with self.subTest(value=str(value)[:100]), self.assertRaises(ValueError):
                bridge.validate_request(value)

    def test_alignment_reads_prefixed_pcm_and_binds_exact_bytes_for_short_speech(self):
        pcm = b"\x10\x00" * 24000
        with wave.open(str(self.root / "chunk-con.wav"), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(pcm)
        config = {"phonemizerPython": "python", "alignmentDirectory": str(self.root)}
        measured = ([{"text": "See?", "start": .1, "end": .8}], [{"phoneme": "i", "start": .1, "end": .8}], {})
        with patch.object(bridge, "verify_models"), patch.object(alignment, "phonemize_words", return_value={"wordPhones": [["s", "i"]]}), patch.object(alignment, "align_audio", return_value=measured):
            result = bridge.align(config, self.request)
        saved = json.loads((self.root / "chunk-con.alignment.json").read_text())
        self.assertEqual(saved["pcmSha256"], hashlib.sha256(pcm).hexdigest())
        self.assertEqual(saved["text"], "See?")
        self.assertEqual(result["chunks"][0]["samples"], 24000)

    def test_contextual_fused_words_recover_without_replacing_phonemes(self):
        # eSpeak can fuse do + not into one group. Partition it monotonically,
        # retaining the contextual weak vowel instead of isolated pronunciations.
        data = {"groups": [["d", "ə", "n", "ɑ", "t"]], "isolated": [["d", "u"], ["n", "ɑ", "t"]]}
        with patch.object(alignment.subprocess, "run", return_value=SimpleNamespace(stdout=json.dumps(data))):
            result = alignment.phonemize_words("do not", Path("python"))
        self.assertEqual(result["wordPhones"], [["d", "ə"], ["n", "ɑ", "t"]])
        self.assertEqual(sum(result["wordPhones"], []), data["groups"][0])

    def test_version_number_can_span_multiple_contextual_groups(self):
        data = {"groups": [["v"], ["z"], ["p"], ["t"], ["r"]], "isolated": [["v"], ["z", "p", "t"], ["r"]]}
        with patch.object(alignment.subprocess, "run", return_value=SimpleNamespace(stdout=json.dumps(data))):
            result = alignment.phonemize_words("Version 0.2.5 ready.", Path("python"))
        self.assertEqual(result["wordPhones"], [["v"], ["z", "p", "t"], ["r"]])
        self.assertEqual(result["wordTexts"], ["Version", "0.2.5", "ready."])

    def test_silent_punctuation_attaches_to_words_without_stealing_a_phone(self):
        data = {"groups": [["h", "i"], ["t"]], "isolated": [[], ["h", "i"], [], ["t"], []]}
        with patch.object(alignment.subprocess, "run", return_value=SimpleNamespace(stdout=json.dumps(data))):
            result = alignment.phonemize_words("— Hi ... there .", Path("python"))
        self.assertEqual(result["wordPhones"], [["h", "i"], ["t"]])
        self.assertEqual(result["wordTexts"], ["— Hi ...", "there ."])

    def test_sub_400ms_interjection_normalizes_without_padding_or_clipping(self):
        raw = [math.sin(index * .1) * 1.6 for index in range(2400)]
        gain, method = bridge.normalization_gain(raw, 24000)
        delivered = [sample * gain for sample in raw]
        self.assertEqual(len(delivered), 2400)
        self.assertLessEqual(max(abs(sample) for sample in delivered), 10 ** (-1 / 20))
        self.assertIn("RMS", method)
        self.assertGreater(gain, 0)

    def test_overlapping_and_nonfinite_timings_are_rejected(self):
        for intervals in [[{"start": 0.2, "end": .8}, {"start": .7, "end": .9}], [{"start": float("nan"), "end": .5}], [{"start": .2, "end": 1.1}]]:
            with self.assertRaises(ValueError):
                alignment.verify_intervals(intervals, 1)


if __name__ == "__main__":
    unittest.main()
