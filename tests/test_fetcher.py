import unittest
from unittest.mock import patch

from app import fetcher
from ttmrank.models import CollectionResult


class FetcherSnapshotRoleTests(unittest.TestCase):
    def test_unchanged_rankings_keep_current_observation_for_history_ingest(self):
        cached = {
            "updated_at": "2026-07-16 08:00:00",
            "platforms": {"android": {"hot": {"items": [{"id": 1}]}}},
            "taptap_made": [],
        }
        observed = {
            **cached,
            "updated_at": "2026-07-16 08:20:00",
        }

        business_changed, published, history_observation = fetcher.split_snapshot_roles(observed, cached)

        self.assertFalse(business_changed)
        self.assertEqual(published["updated_at"], cached["updated_at"])
        self.assertEqual(history_observation["updated_at"], observed["updated_at"])

    def test_fetch_ranking_keeps_source_rank_and_completeness_metadata(self):
        collected = CollectionResult(
            ok=True,
            data={
                "title": "热门榜",
                "description": "完整榜单",
                "total": 2,
                "complete": True,
                "items": [
                    {"_source_rank": 1, "app": {"id": 1, "title": "A", "stat": {}}},
                    {"_source_rank": 16, "app": {"id": 2, "title": "B", "stat": {}}},
                ],
            },
        )
        original = fetcher.CLIENT.fetch_ranking
        fetcher.CLIENT.fetch_ranking = lambda *_args, **_kwargs: collected
        try:
            ranking = fetcher.fetch_ranking("ios", "hot")
        finally:
            fetcher.CLIENT.fetch_ranking = original

        self.assertEqual([row["rank"] for row in ranking["items"]], [1, 16])
        self.assertEqual(ranking["expected_count"], 2)
        self.assertTrue(ranking["complete"])

    def test_fetch_ranking_rejects_an_incomplete_success_payload(self):
        collected = CollectionResult(
            ok=True,
            data={
                "title": "热门榜",
                "total": 150,
                "complete": False,
                "items": [{"_source_rank": 1, "app": {"id": 1, "title": "A", "stat": {}}}],
            },
        )
        with patch.object(fetcher.CLIENT, "fetch_ranking", return_value=collected):
            with self.assertRaisesRegex(RuntimeError, "completeness contract failed"):
                fetcher.fetch_ranking("ios", "hot")

    def test_main_aborts_instead_of_publishing_mixed_live_and_cached_rankings(self):
        cached = {
            "updated_at": "2026-07-16 08:00:00",
            "platforms": {
                platform: {chart: {"items": [{"id": 1}], "source": "live"} for chart in fetcher.RANK_TYPES}
                for platform in fetcher.PLATFORMS
            },
            "taptap_made": [],
        }

        def incomplete(platform, chart, limit=None):
            if platform == "ios" and chart == "hot":
                raise RuntimeError("expected 150 unique games, collected 89")
            return {"title": chart, "description": "", "source": "live", "expected_count": 0, "complete": True, "items": []}

        with patch.object(fetcher, "load_cache", return_value=cached), patch.object(fetcher, "fetch_ranking", side_effect=incomplete):
            with self.assertRaisesRegex(RuntimeError, "keeping the previous Pages deployment"):
                fetcher.main()


if __name__ == "__main__":
    unittest.main()
