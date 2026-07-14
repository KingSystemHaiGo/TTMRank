import json
import unittest
from dataclasses import asdict

from ttmrank.models import Appearance, CollectionResult, DataQualityIssue, Game, GameMetric


class ModelTests(unittest.TestCase):
    def test_game_serializes_missing_score_and_future_release(self):
        game = Game(
            id=7,
            title="未来游戏",
            icon_source_url="https://example.com/7.png",
            released_at=2_000_000_000,
            score=None,
            heat=0,
            observed_at=1_900_000_000,
        )
        payload = game.to_dict()
        self.assertIsNone(payload["score"])
        self.assertEqual(payload["released_at"], 2_000_000_000)
        json.dumps(payload)

    def test_appearance_rejects_unknown_source(self):
        with self.assertRaises(ValueError):
            Appearance(game_id=1, platform="android", chart="hot", rank=1, observed_at=1, source="mystery")

    def test_appearance_identity_detects_duplicates(self):
        first = Appearance(game_id=1, platform="ios", chart="casual", rank=3, observed_at=10)
        second = Appearance(game_id=1, platform="ios", chart="casual", rank=9, observed_at=20)
        self.assertEqual(first.identity, second.identity)

    def test_collection_result_requires_error_on_failure(self):
        with self.assertRaises(ValueError):
            CollectionResult(ok=False)

    def test_quality_issue_and_metric_are_json_ready(self):
        issue = DataQualityIssue(code="field_conflict", message="score conflict", game_id=1, field="score")
        metric = GameMetric(game_id=1, age_hours=36, heat_per_day_lifetime=20_000, short_sample=False)
        json.dumps(asdict(issue))
        json.dumps(metric.to_dict())


if __name__ == "__main__":
    unittest.main()
