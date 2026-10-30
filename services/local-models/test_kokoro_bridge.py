"""Native-path bridge contract tests; no model downloads or imports required."""
import copy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import kokoro_synthesize as bridge


class KokoroRequestTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='kokoro test narración ')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.model = self.root / 'model.onnx'
        self.voices = self.root / 'voices.bin'
        self.model.write_bytes(b'model')
        self.voices.write_bytes(b'voices')
        self.model_patch = patch.object(bridge, 'MODEL_PATH', self.model)
        self.voices_patch = patch.object(bridge, 'VOICES_PATH', self.voices)
        self.model_patch.start()
        self.voices_patch.start()
        self.addCleanup(self.model_patch.stop)
        self.addCleanup(self.voices_patch.stop)
        self.request = {
            'modelPath': str(self.model), 'voicesPath': str(self.voices),
            'voice': 'af_heart', 'speed': 1,
            'chunks': [{'id': 'intro', 'text': 'A quoted "phrase" — café.', 'outputPath': str(self.root / 'speech.pcm')}],
        }

    def test_absolute_native_paths_preserve_spaces_unicode_and_text(self):
        voice, speed, chunks = bridge._validate_request(self.request)
        self.assertEqual((voice, speed), ('af_heart', 1.0))
        self.assertEqual(chunks, self.request['chunks'])

    def test_unconfigured_model_and_relative_output_are_rejected(self):
        for field in ('modelPath', 'voicesPath'):
            with self.subTest(field=field):
                request = copy.deepcopy(self.request)
                request[field] = str(self.root / 'other.bin')
                with self.assertRaisesRegex(ValueError, 'outside the configured'):
                    bridge._validate_request(request)
        self.request['chunks'][0]['outputPath'] = 'relative.pcm'
        with self.assertRaisesRegex(ValueError, 'must be absolute'):
            bridge._validate_request(self.request)

    def test_existing_output_and_duplicate_ids_are_rejected(self):
        output = Path(self.request['chunks'][0]['outputPath'])
        output.write_bytes(b'existing')
        with self.assertRaisesRegex(ValueError, 'not already exist'):
            bridge._validate_request(self.request)
        output.unlink()
        self.request['chunks'].append({**self.request['chunks'][0], 'outputPath': str(self.root / 'other.pcm')})
        with self.assertRaisesRegex(ValueError, 'duplicate id'):
            bridge._validate_request(self.request)

    def test_nonfinite_and_out_of_bounds_rates_are_rejected(self):
        for speed in (float('nan'), float('inf'), True, 0.64, 1.26):
            with self.subTest(speed=speed):
                self.request['speed'] = speed
                with self.assertRaisesRegex(ValueError, 'speed must be between'):
                    bridge._validate_request(self.request)

    def test_explicit_project_pacing_accepts_deliberately_slower_speech(self):
        for speed in (0.65, 0.7, 0.8, 1, 1.25):
            with self.subTest(speed=speed):
                self.request['speed'] = speed
                self.assertEqual(bridge._validate_request(self.request)[1], speed)

    def connected_request(self):
        self.request['delivery'] = {'mode': 'connected', 'sentencePauseMs': 500, 'clausePauseMs': 100}
        self.request['chunks'][0].update({
            'text': 'The good news? P H P fixes are available. No.',
            'passages': [
                {'id': 'fix-1', 'text': 'The good news? P H P fixes are available.'},
                {'id': 'fix-2', 'text': 'No.'},
            ],
        })
        return self.request

    def test_connected_preserves_original_ids_and_exact_text(self):
        request = self.connected_request()
        self.assertEqual(bridge._validate_request(request)[2], request['chunks'])
        request['chunks'][0]['text'] = request['chunks'][0]['text'].replace('No.', 'Yes.')
        with self.assertRaisesRegex(ValueError, 'texts joined by one space'):
            bridge._validate_request(request)

    def test_connected_pause_settings_are_explicit_and_bounded(self):
        for field, bad in [('sentencePauseMs', 1001), ('sentencePauseMs', -1), ('clausePauseMs', 501), ('clausePauseMs', True), ('sentencePauseMs', 0.5)]:
            with self.subTest(field=field, bad=bad):
                request = self.connected_request()
                request['delivery'][field] = bad
                with self.assertRaisesRegex(ValueError, 'must be an integer'):
                    bridge._validate_request(request)
        for delivery in (None, {}, {'mode': 'chunk', 'sentencePauseMs': 500, 'clausePauseMs': 100}):
            self.request['delivery'] = delivery
            with self.assertRaisesRegex(ValueError, 'delivery must contain'):
                bridge._validate_request(self.request)

    def test_connected_passage_ids_are_unique_across_groups(self):
        request = self.connected_request()
        request['chunks'].append({**request['chunks'][0], 'id': 'another', 'outputPath': str(self.root / 'another.pcm')})
        with self.assertRaisesRegex(ValueError, 'duplicate passage id'):
            bridge._validate_request(request)

    def test_connected_total_passage_limit_applies_across_groups(self):
        request = self.connected_request()
        request['chunks'] = []
        for group in range(2):
            passages = [{'id': f'p-{group}-{index}', 'text': 'No.'} for index in range(65)]
            request['chunks'].append({'id': f'g-{group}', 'text': ' '.join(p['text'] for p in passages), 'passages': passages, 'outputPath': str(self.root / f'{group}.pcm')})
        with self.assertRaisesRegex(ValueError, 'exceeds 128 total passages'):
            bridge._validate_request(request)

    def test_legacy_request_rejects_connected_fields_without_delivery(self):
        request = self.connected_request()
        del request['delivery']
        with self.assertRaisesRegex(ValueError, 'must contain id, text, and outputPath'):
            bridge._validate_request(request)


class ConnectedAlignmentTests(unittest.TestCase):
    def align(self, phonemes, *, timings=None, samples=None):
        passages = [{'id': f'original-{index}', 'text': 'Original text.'} for index in range(len(phonemes))]
        stream = ' '.join(phonemes)
        # Exact integer-sample times include leading/trailing audio and natural
        # gaps. A cut retains the gap in the preceding passage's PCM slice.
        if timings is None:
            timings = [SimpleNamespace(phoneme=p, start=(240 + index * 240) / 24000, end=(360 + index * 240) / 24000) for index, p in enumerate(stream)]
        if samples is None:
            samples = 600 + len(stream) * 240
        return bridge._align_passages(passages, phonemes, timings, samples, 24000)

    def test_multi_sentence_passages_keep_ids_and_every_sample(self):
        phonemes = ['ðə ɡʊd nuːz? fɪks naʊ.', 'ˈstɪki teɪp?', 'noʊ.']
        result = self.align(phonemes)
        self.assertEqual([p['id'] for p in result], ['original-0', 'original-1', 'original-2'])
        self.assertEqual(sum(p['samples'] for p in result), 600 + len(' '.join(phonemes)) * 240)
        self.assertEqual(result[0]['samples'], 240 + (len(phonemes[0]) + 1) * 240)
        self.assertTrue(all(p['samples'] > 0 for p in result))

    def test_abbreviation_and_punctuation_are_not_counted_as_boundaries(self):
        # E.g. "Dr. Smith said, 'Wait.' Then go." is a single original passage.
        phonemes = ['dɑktɚ smɪθ sɛd, “weɪt.” ðɛn ɡoʊ.', 'naʊ? noʊ.']
        result = self.align(phonemes)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['samples'], 240 + (len(phonemes[0]) + 1) * 240)

    def test_whitespace_normalization_and_zero_duration_final_punctuation(self):
        timings = [
            {'phoneme': 'a', 'start': 0.01, 'end': 0.02},
            {'phoneme': ' ', 'start': 0.02, 'end': 0.03},
            {'phoneme': ' ', 'start': 0.03, 'end': 0.04},
            {'phoneme': 'b', 'start': 0.05, 'end': 0.06},
            {'phoneme': '.', 'start': 0.06, 'end': 0.06},
        ]
        self.assertEqual(self.align(['a', 'b.'], timings=timings, samples=2400), [
            {'id': 'original-0', 'samples': 1200}, {'id': 'original-1', 'samples': 1200},
        ])

    def test_leading_punctuation_is_not_the_next_spoken_onset(self):
        result = self.align(['a.', '“b.”'])
        self.assertEqual(result[0]['samples'], 240 + 4 * 240)

    def test_contextual_phoneme_changes_fail_instead_of_guessing(self):
        for phoneme in ('b', '?'):
            with self.subTest(phoneme=phoneme), self.assertRaisesRegex(ValueError, 'do not match'):
                self.align(['a.'], timings=[{'phoneme': phoneme, 'start': 0.01, 'end': 0.02}])

    def test_missing_excessive_and_nonspoken_phonemes_fail(self):
        for timings in (None, [], [None] * (bridge.MAX_GROUP_PHONEMES + 1)):
            with self.subTest(kind=type(timings)), self.assertRaisesRegex(ValueError, 'requires bounded native phoneme timings'):
                bridge._align_passages([{'id': 'p', 'text': 'A.'}], ['a.'], timings, 2400, 24000)
        with self.assertRaisesRegex(ValueError, 'has no spoken phonemes'):
            self.align(['...?'])
        with self.assertRaisesRegex(ValueError, 'excessive passage phonemes'):
            bridge._align_passages([{'id': 'p', 'text': 'A.'}], ['a' * (bridge.MAX_GROUP_PHONEMES + 1)], [{'phoneme': 'a', 'start': 0, 'end': 0.1}], 2400, 24000)

    def test_invalid_native_times_fail(self):
        for start, end in [(float('nan'), 0.1), (0, float('inf')), (-0.01, 0.01), (0.05, 0.04), (0, 1), (0.01, 0.01), (True, 0.1), (None, 0.1)]:
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                self.align(['a'], timings=[{'phoneme': 'a', 'start': start, 'end': end}], samples=2400)

    def test_nonmonotonic_times_and_empty_passages_fail(self):
        with self.assertRaisesRegex(ValueError, 'nonmonotonic'):
            self.align(['a', 'b'], timings=[
                {'phoneme': 'a', 'start': 0.02, 'end': 0.04},
                {'phoneme': 'b', 'start': 0.01, 'end': 0.03},
            ])
        # A positive native span shorter than one sample cannot define a
        # positive PCM passage boundary after rounding.
        with self.assertRaisesRegex(ValueError, 'nonpositive.*passage timing'):
            self.align(['a', 'b'], timings=[
                {'phoneme': 'a', 'start': 0, 'end': 0.000001},
                {'phoneme': 'b', 'start': 0.000001, 'end': 0.01},
            ])

    def test_pcm_bounds_and_malformed_timings_fail(self):
        for samples in (0, -1, True, bridge.MAX_CHUNK_PCM_BYTES):
            with self.subTest(samples=samples), self.assertRaisesRegex(ValueError, 'sample bounds'):
                self.align(['a'], samples=samples)
        for timing in ({'phoneme': 'ab', 'start': 0, 'end': 0.1}, {'start': 0, 'end': 0.1}, object()):
            with self.subTest(timing=timing), self.assertRaisesRegex(ValueError, 'invalid native phoneme timing'):
                self.align(['a'], timings=[timing])


if __name__ == '__main__':
    unittest.main()
