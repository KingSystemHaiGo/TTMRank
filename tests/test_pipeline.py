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
            self.assertTrue((Path(tmp) / "vendors.json").exists())
            vendors = json.loads((Path(tmp) / "vendors.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["vendor_count"], len(vendors["vendors"]))
            self.assertTrue(all("account_role" in vendor for vendor in vendors["vendors"]))
            self.assertTrue(all("verification" in vendor for vendor in vendors["vendors"]))
            self.assertTrue(all("canonical_name" in vendor for vendor in vendors["vendors"]))
            self.assertTrue(all("raw_aliases" in vendor for vendor in vendors["vendors"]))
            self.assertTrue(all("game_count" in vendor for vendor in vendors["vendors"]))
            self.assertTrue(all("maker_game_count" in vendor for vendor in vendors["vendors"]))
            self.assertTrue(all("heat_total" in vendor for vendor in vendors["vendors"]))
            self.assertEqual(vendors["coverage"], {"game_count": 4, "maker_game_count": 1, "heat_total": 50_500})
            maker_vendor = next(vendor for vendor in vendors["vendors"] if vendor["name"] == "乙")
            self.assertEqual(maker_vendor["maker_game_count"], 1)
            self.assertEqual(maker_vendor["heat_total"], 12_000)
            analysis = json.loads((Path(tmp) / "analysis-current.json").read_text(encoding="utf-8"))
            self.assertTrue(all(game["developer"] == game["developer_canonical"] for game in analysis["games"]))
            self.assertTrue(all("developer_raw" in game for game in analysis["games"]))
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


if __name__ == "__main__":
    unittest.main()
