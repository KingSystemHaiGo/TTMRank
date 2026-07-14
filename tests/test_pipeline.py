import json
import tempfile
import unittest
from pathlib import Path

from ttmrank.pipeline import build_analysis_artifacts


class PipelineTests(unittest.TestCase):
    def test_builds_manifest_analysis_and_quality_files(self):
        fixture = json.loads((Path(__file__).parent / "fixtures" / "rankings-small.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            manifest = build_analysis_artifacts(fixture, Path(tmp))
            self.assertEqual(manifest["game_count"], 4)
            self.assertEqual(manifest["appearance_count"], 6)
            self.assertTrue((Path(tmp) / "analysis-current.json").exists())
            self.assertTrue((Path(tmp) / "quality.json").exists())
            self.assertLess(manifest["analysis_gzip_bytes"], manifest["analysis_bytes"])


if __name__ == "__main__":
    unittest.main()
