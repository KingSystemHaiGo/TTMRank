import unittest
import json
import os
import subprocess
import tempfile
from unittest.mock import patch
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

from ttmrank.history_client import (
    GitHistoryClient,
    HistoryClient,
    LayeredHistoryClient,
    RollingHistoryClient,
)

NOW = 1_800_000_000


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class HistoryClientTests(unittest.TestCase):
    def test_layered_history_prefers_remote_fields_and_always_advances_rolling_fallback(self):
        class Remote:
            def metrics(self, games, at):
                return {1: {"heat_delta_24h": 450, "growth_per_hour_24h": 18}}

            def ingest(self, games, captured_at):
                self.ingested = (games, captured_at)
                return False

            def ingest_status(self):
                return {"configured": True, "status": "failed"}

            def archive_events(self, events):
                self.archived = events
                return True

            def archive_status(self):
                return {"configured": True, "status": "success"}

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "heat-history.json"
            rolling = RollingHistoryClient(path)
            rolling.ingest([{"id": 1, "heat": 900}], NOW - 3700)
            remote = Remote()
            client = LayeredHistoryClient(remote, rolling)

            metrics = client.metrics([{"id": 1, "heat": 1000}], NOW)
            self.assertEqual(metrics[1]["heat_delta_1h"], 100)
            self.assertEqual(metrics[1]["heat_delta_24h"], 450)
            self.assertFalse(client.ingest([{"id": 1, "heat": 1000}], NOW))
            self.assertTrue(path.exists())
            self.assertEqual(client.ingest_status(), {
                "configured": True,
                "status": "failed",
                "fallback": "success",
            })
            self.assertTrue(client.archive_events([{"id": "evt_test"}]))
            self.assertEqual(client.archive_status(), {"configured": True, "status": "success"})

    def test_rolling_history_persists_compact_points_and_restores_each_available_window(self):
        games = [{"id": 1, "heat": 1_000, "score": 8.0}, {"id": 2, "heat": None, "score": 7.0}]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "history-state.json"
            client = RollingHistoryClient(path)

            self.assertEqual(client.metrics(games, NOW), {})
            self.assertTrue(client.ingest([{"id": 1, "heat": 100, "score": 8.0}], NOW - 7 * 86400 - 3600))
            self.assertTrue(client.ingest([{"id": 1, "heat": 600, "score": 8.0}], NOW - 25 * 3600))
            self.assertTrue(client.ingest([{"id": 1, "heat": 900, "score": 8.0}], NOW - 3700))

            metrics = RollingHistoryClient(path).metrics(games, NOW)
            self.assertEqual(metrics[1]["heat_delta_1h"], 100)
            self.assertEqual(metrics[1]["heat_delta_24h"], 400)
            self.assertEqual(metrics[1]["heat_delta_7d"], 900)
            self.assertAlmostEqual(metrics[1]["growth_per_hour_24h"], 16)
            state = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(state["schema_version"], "1.0")
            self.assertEqual(len(state["buckets"]), 3)
            self.assertLess(path.stat().st_size, 2_000)

    def test_rolling_history_replaces_same_bucket_prunes_old_points_and_recovers_from_damage(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "history-state.json"
            client = RollingHistoryClient(path)
            client.ingest([{"id": 1, "heat": 100}], NOW - 9 * 86400)
            client.ingest([{"id": 1, "heat": 200}], NOW - 300)
            client.ingest([{"id": 1, "heat": 250}], NOW - 60)
            state = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(len(state["buckets"]), 1)
            self.assertEqual(state["buckets"][0]["games"][0][1], 250)

            path.write_text("not json", encoding="utf-8")
            recovered = RollingHistoryClient(path)
            self.assertEqual(recovered.metrics([{"id": 1, "heat": 300}], NOW), {})
            path.write_text("[]", encoding="utf-8")
            self.assertEqual(recovered.metrics([{"id": 1, "heat": 300}], NOW), {})
            self.assertTrue(recovered.ingest([{"id": 1, "heat": 300}], NOW))
            self.assertEqual(len(json.loads(path.read_text(encoding="utf-8"))["buckets"]), 1)

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

    def test_metrics_estimate_one_hour_growth_when_scheduler_gap_exceeds_exact_window(self):
        points = [
            {"game_id": 1, "captured_hour": NOW - 2 * 3600, "heat": 800},
        ]

        metrics = HistoryClient.metrics_from_points([{"id": 1, "heat": 1000}], NOW, points)

        self.assertEqual(metrics[1]["heat_delta_1h"], 100)
        self.assertTrue(metrics[1]["heat_delta_1h_estimated"])
        self.assertEqual(metrics[1]["heat_delta_1h_basis_hours"], 2)

    def test_metrics_ignore_points_after_target_or_outside_tolerance(self):
        points = [
            {"game_id": 1, "captured_hour": NOW - 1800, "heat": 950},
            {"game_id": 1, "captured_hour": NOW - 4 * 3600, "heat": 700},
        ]
        metrics = HistoryClient.metrics_from_points([{"id": 1, "heat": 1000}], NOW, points)
        self.assertEqual(metrics, {})

    def test_archives_change_events_with_ingest_token(self):
        event = {
            "id": "evt_test",
            "kind": "rank_rise",
            "scope": "made",
            "game_id": 1,
            "before": 18,
            "after": 9,
            "observed_at": NOW,
        }
        captured = []

        def fake_urlopen(request, timeout):
            captured.append((request, timeout))
            return FakeResponse({"ok": True, "written": 1})

        client = HistoryClient("https://history.example", "secret", timeout=7)
        with patch("ttmrank.history_client.urlopen", side_effect=fake_urlopen):
            self.assertTrue(client.archive_events([event]))

        request, timeout = captured[0]
        self.assertEqual(request.full_url, "https://history.example/v1/events")
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.get_header("X-ingest-token"), "secret")
        self.assertEqual(json.loads(request.data), {"events": [event]})
        self.assertEqual(timeout, 7)
        self.assertEqual(client.archive_status(), {"configured": True, "status": "success"})

    def test_reads_bounded_change_event_archive(self):
        expected = [{"id": "evt_test", "kind": "rank_rise"}]
        captured = []

        def fake_urlopen(request, timeout):
            captured.append((request, timeout))
            return FakeResponse({"events": expected})

        client = HistoryClient("https://history.example", "secret", timeout=9)
        with patch("ttmrank.history_client.urlopen", side_effect=fake_urlopen):
            self.assertEqual(client.events(NOW, scope="made"), expected)

        target, timeout = captured[0]
        url = target.full_url if hasattr(target, "full_url") else target
        parsed = urlparse(url)
        self.assertEqual(parsed.path, "/v1/events")
        self.assertEqual(parse_qs(parsed.query), {
            "since": [str(NOW)],
            "scope": ["made"],
            "limit": ["500"],
        })
        self.assertEqual(timeout, 9)

    def test_change_archive_failures_degrade_without_error(self):
        client = HistoryClient("https://history.example", "secret")
        with patch("ttmrank.history_client.urlopen", side_effect=OSError("offline")):
            self.assertFalse(client.archive_events([{"id": "evt_test"}]))
            self.assertEqual(client.events(NOW, scope="made"), [])
        self.assertEqual(client.archive_status(), {"configured": True, "status": "failed"})

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
