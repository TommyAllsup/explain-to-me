"""Native-path bridge contract tests; no model downloads or imports required."""
import copy
import tempfile
import unittest
from pathlib import Path
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
        for speed in (float('nan'), float('inf'), True, 0.79, 1.26):
            with self.subTest(speed=speed):
                self.request['speed'] = speed
                with self.assertRaisesRegex(ValueError, 'speed must be between'):
                    bridge._validate_request(self.request)


if __name__ == '__main__':
    unittest.main()
