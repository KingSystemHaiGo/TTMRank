import unittest

from app import fetcher


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


if __name__ == "__main__":
    unittest.main()
