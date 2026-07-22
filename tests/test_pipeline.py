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
            self.assertEqual(manifest["taptap_made_game_count"], 1)
            self.assertEqual(manifest["appearance_count"], 6)
            self.assertTrue((Path(tmp) / "analysis-current.json").exists())
            self.assertTrue((Path(tmp) / "quality.json").exists())
            self.assertEqual(manifest["changes_file"], "changes-current.json")
            self.assertTrue((Path(tmp) / "changes-current.json").exists())
            self.assertFalse(manifest["changes_comparison_available"])
            self.assertFalse((Path(tmp) / "vendors.json").exists())
            analysis = json.loads((Path(tmp) / "analysis-current.json").read_text(encoding="utf-8"))
            self.assertTrue(all("developer" in game for game in analysis["games"]))
            self.assertTrue(all("vendor_scale" not in game for game in analysis["games"]))
            self.assertNotIn("vendor_file", manifest)
            self.assertLess(manifest["analysis_gzip_bytes"], manifest["analysis_bytes"])
            self.assertEqual(manifest["history_ingest"], {"configured": False, "status": "not_configured"})

    def test_history_client_enriches_metrics_and_receives_snapshot(self):
        class FakeHistory:
            def metrics(self, games, at):
                return {1: {"heat_delta_24h": 400, "growth_per_hour_24h": 20}}

            def ingest(self, games, captured_at):
                self.ingested = (games, captured_at)
                return True

        fixture = json.loads((Path(__file__).parent / "fixtures" / "rankings-small.json").read_text(encoding="utf-8"))
        history = FakeHistory()
        with tempfile.TemporaryDirectory() as tmp:
            manifest = build_analysis_artifacts(fixture, Path(tmp), history_client=history)
            analysis = json.loads((Path(tmp) / "analysis-current.json").read_text(encoding="utf-8"))
        metric = next(row for row in analysis["metrics"] if row["game_id"] == 1)
        self.assertEqual(metric["heat_delta_24h"], 400)
        self.assertTrue(metric["history_available"])
        self.assertTrue(manifest["history_available"])
        self.assertEqual(manifest["history_ingest"], {"configured": True, "status": "success"})
        self.assertEqual(history.ingested[1], analysis["observed_at"])

    def test_manifest_reports_history_when_any_game_has_a_baseline(self):
        class PartialHistory:
            def metrics(self, games, at):
                return {1: {"heat_delta_1h": 5}}

            def ingest(self, games, captured_at):
                return False

        fixture = json.loads((Path(__file__).parent / "fixtures" / "rankings-small.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            manifest = build_analysis_artifacts(fixture, Path(tmp), history_client=PartialHistory())
        self.assertTrue(manifest["history_available"])
        self.assertEqual(manifest["history_ingest"], {"configured": True, "status": "failed"})

    def test_change_archive_failure_does_not_block_static_publication(self):
        class FailedArchive:
            def metrics(self, games, at):
                return {}

            def ingest(self, games, captured_at):
                return True

            def archive_events(self, events):
                raise OSError("D1 unavailable")

        fixture = json.loads((Path(__file__).parent / "fixtures" / "rankings-small.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            manifest = build_analysis_artifacts(fixture, Path(tmp), history_client=FailedArchive())

            self.assertTrue((Path(tmp) / "analysis-current.json").exists())
            self.assertTrue((Path(tmp) / "changes-current.json").exists())
            self.assertTrue((Path(tmp) / "manifest.json").exists())
        self.assertEqual(manifest["changes_archive"], {"configured": True, "status": "failed"})


if __name__ == "__main__":
    unittest.main()
