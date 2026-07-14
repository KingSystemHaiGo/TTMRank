import json
import tempfile
import unittest
from pathlib import Path

from ttmrank.exporters import AtomicPublisher


class ExporterTests(unittest.TestCase):
    def test_failed_validation_keeps_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "data.json"
            target.write_text('{"version": 1}', encoding="utf-8")
            publisher = AtomicPublisher(Path(tmp))
            with self.assertRaises(ValueError):
                publisher.publish_json("data.json", {"version": 2}, errors=["bad chart"])
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["version"], 1)

    def test_successful_publish_replaces_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "data.json"
            target.write_text('{"version": 1}', encoding="utf-8")
            AtomicPublisher(Path(tmp)).publish_json("data.json", {"version": 2})
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["version"], 2)


if __name__ == "__main__":
    unittest.main()
