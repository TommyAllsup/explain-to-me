"""Setup publication must preserve a target created by another installer."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/setup-claudia.py"
spec = importlib.util.spec_from_file_location("claudia_setup", SCRIPT)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ClaudiaSetupPublicationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="claudia setup publication ")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.staged = self.root / ".staged"
        self.staged.write_bytes(b"new verified content")
        self.target = self.root / "registered.json"

    def test_target_created_after_preflight_is_preserved(self):
        self.assertFalse(self.target.exists())
        # A second setup publishes while this setup is checking imports/hashes.
        self.target.write_bytes(b"another registration")
        with self.assertRaises(FileExistsError):
            setup.publish_file(self.staged, self.target)
        self.assertEqual(self.target.read_bytes(), b"another registration")
        self.assertEqual(self.staged.read_bytes(), b"new verified content")

    def test_default_publication_claims_a_new_name_atomically(self):
        setup.publish_file(self.staged, self.target)
        self.assertEqual(self.target.read_bytes(), b"new verified content")
        self.assertFalse(self.staged.exists())

    def test_only_explicit_replace_overwrites_an_existing_target(self):
        self.target.write_bytes(b"previous registration")
        setup.publish_file(self.staged, self.target, replace=True)
        self.assertEqual(self.target.read_bytes(), b"new verified content")
        self.assertFalse(self.staged.exists())


if __name__ == "__main__":
    unittest.main()
