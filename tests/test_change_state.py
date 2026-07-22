import json
import tempfile
import unittest
from pathlib import Path

from ttmrank.changes import (
    FEED_RETENTION_SECONDS,
    RANK_RISE,
    STATE_SCHEMA_VERSION,
    build_feed,
    load_state,
    write_state_atomic,
)
from ttmrank.pipeline import build_analysis_artifacts


def observation(at):
    return {
        "observed_at": at,
        "updated_at": str(at),
        "games": {},
        "appearances": {},
        "charts": {},
        "seen_appearance_keys": [],
    }


def rank_event(event_id, at, *, game_id=1):
    return {
        "id": event_id,
        "kind": RANK_RISE,
        "scope": "made",
        "game_id": game_id,
        "game_title": "Alpha",
        "game_icon": "",
        "game_url": "https://www.taptap.cn/app/1",
        "platform": "android",
        "chart": "hot",
        "before": 30,
        "after": 24,
        "observed_at": at,
        "first_observed_at": at,
        "last_observed_at": at,
        "occurrences": 1,
        "rule": "rank_threshold_11_50",
        "importance": 65,
    }


def rolling_state(at, events=()):
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "observation": observation(at),
        "events": list(events),
    }


class ChangeStateTests(unittest.TestCase):
    def test_state_keeps_only_events_needed_for_seven_day_feed(self):
        now = 2_000_000
        expired = rank_event("evt_expired", now - FEED_RETENTION_SECONDS - 1)
        boundary = rank_event("evt_boundary", now - FEED_RETENTION_SECONDS, game_id=2)
        previous = rolling_state(now - 1, [expired, boundary])

        feed, next_state = build_feed(previous, observation(now))

        self.assertEqual([event["id"] for event in feed["events"]], ["evt_boundary"])
        self.assertEqual([event["id"] for event in next_state["events"]], ["evt_boundary"])

    def test_missing_state_publishes_baseline_status_without_events(self):
        feed, next_state = build_feed(None, observation(1_000))

        self.assertEqual(feed["status"], "baseline")
        self.assertFalse(feed["comparison_available"])
        self.assertFalse(feed["partial"])
        self.assertEqual(feed["events"], [])
        self.assertEqual(next_state["schema_version"], STATE_SCHEMA_VERSION)

    def test_missing_or_invalid_state_loads_as_no_comparison(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "change-state.json"
            self.assertIsNone(load_state(state_path))
            state_path.write_text("not json", encoding="utf-8")
            self.assertIsNone(load_state(state_path))
            state_path.write_text(json.dumps({"schema_version": "0.9"}), encoding="utf-8")
            self.assertIsNone(load_state(state_path))
            state_path.write_text(
                json.dumps(
                    {
                        "schema_version": STATE_SCHEMA_VERSION,
                        "observation": {"observed_at": 1_000},
                        "events": [],
                    }
                ),
                encoding="utf-8",
            )
            self.assertIsNone(load_state(state_path))

    def test_atomic_state_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / ".state" / "change-state.json"
            expected = rolling_state(1_000)

            write_state_atomic(state_path, expected)

            self.assertEqual(load_state(state_path), expected)

    def test_failed_publication_does_not_replace_comparison_state(self):
        fixture = json.loads(
            (Path(__file__).parent / "fixtures" / "rankings-small.json").read_text(encoding="utf-8")
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_path = root / "state" / "change-state.json"
            write_state_atomic(state_path, rolling_state(1_000))
            previous_bytes = state_path.read_bytes()
            output_dir = root / "published"
            output_dir.mkdir()
            (output_dir / "manifest.json").mkdir()

            with self.assertRaises(OSError):
                build_analysis_artifacts(fixture, output_dir, change_state_path=state_path)

            self.assertEqual(state_path.read_bytes(), previous_bytes)


if __name__ == "__main__":
    unittest.main()
