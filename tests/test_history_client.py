import unittest
import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from ttmrank.history_client import GitHistoryClient, HistoryClient

NOW = 1_800_000_000


class HistoryClientTests(unittest.TestCase):
    def test_missing_configuration_degrades_without_error(self):
        client=HistoryClient('')
        self.assertFalse(client.ingest([{'id':1,'heat':2}],1000))
        self.assertEqual(client.ingest_status(), {"configured": False, "status": "not_configured"})
        self.assertEqual(client.baselines([1],1000),{})

    def test_metrics_use_actual_intervals_and_target_tolerances(self):
        points = [
            {"game_id": 1, "captured_hour": NOW - 3700, "heat": 900},
            {"game_id": 1, "captured_hour": NOW - 25 * 3600, "heat": 600},
            {"game_id": 1, "captured_hour": NOW - 7 * 86400 - 3600, "heat": 200},
        ]
        metrics = HistoryClient.metrics_from_points([{"id": 1, "heat": 1000}], NOW, points)
        self.assertEqual(metrics[1]["heat_delta_1h"], 100)
        self.assertEqual(metrics[1]["heat_delta_24h"], 400)
        self.assertEqual(metrics[1]["heat_delta_7d"], 800)
        self.assertAlmostEqual(metrics[1]["growth_per_hour_24h"], 16)

    def test_metrics_ignore_points_after_target_or_outside_tolerance(self):
        points = [
            {"game_id": 1, "captured_hour": NOW - 1800, "heat": 950},
            {"game_id": 1, "captured_hour": NOW - 4 * 3600, "heat": 700},
        ]
        metrics = HistoryClient.metrics_from_points([{"id": 1, "heat": 1000}], NOW, points)
        self.assertEqual(metrics, {})

    def test_git_history_uses_existing_ranking_commits_as_baselines(self):
        def payload(captured_at, heat):
            updated_at = datetime.fromtimestamp(captured_at, ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M:%S")
            return {"updated_at": updated_at, "platforms": {"android": {"hot": {"items": [{"id": 1, "rank": 1, "title": "A", "count": heat, "score": "8.0"}]}}}}

        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Test"], cwd=repo, check=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo, check=True)
            target = repo / "app" / "data" / "rankings.json"
            target.parent.mkdir(parents=True)
            for captured_at, heat in [(NOW - 7 * 86400 - 3600, 200), (NOW - 25 * 3600, 600), (NOW - 3700, 900)]:
                target.write_text(json.dumps(payload(captured_at, heat)), encoding="utf-8")
                subprocess.run(["git", "add", "app/data/rankings.json"], cwd=repo, check=True)
                commit_date = datetime.fromtimestamp(captured_at + 300, ZoneInfo("UTC")).isoformat()
                env = {**os.environ, "GIT_AUTHOR_DATE": commit_date, "GIT_COMMITTER_DATE": commit_date}
                subprocess.run(["git", "commit", "-m", "snapshot"], cwd=repo, env=env, check=True, capture_output=True)

            metrics = GitHistoryClient(repo).metrics([{"id": 1, "heat": 1000}], NOW)
            self.assertEqual(metrics[1]["heat_delta_1h"], 100)
            self.assertEqual(metrics[1]["heat_delta_24h"], 400)
            self.assertEqual(metrics[1]["heat_delta_7d"], 800)
            self.assertAlmostEqual(metrics[1]["growth_per_hour_24h"], 16)

    def test_git_history_missing_repository_degrades_without_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(GitHistoryClient(Path(tmp)).metrics([{"id": 1, "heat": 1}], NOW), {})

if __name__=='__main__': unittest.main()
