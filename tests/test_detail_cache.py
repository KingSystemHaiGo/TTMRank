import tempfile
import unittest
from pathlib import Path

from ttmrank.detail_cache import DetailCache


class DetailCacheTests(unittest.TestCase):
    def test_fresh_entry_avoids_second_fetch(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = DetailCache(Path(tmp) / "details.json", ttl_seconds=100, clock=lambda: 1_000)
            calls = []

            def fetcher(game_id):
                calls.append(game_id)
                return {"developer": "工作室", "tags": ["模拟"], "ok": True}

            first = cache.get_or_fetch(1, fetcher)
            second = cache.get_or_fetch(1, fetcher)
            self.assertEqual(first, second)
            self.assertEqual(calls, [1])

    def test_failures_back_off(self):
        with tempfile.TemporaryDirectory() as tmp:
            now = [1_000]
            cache = DetailCache(Path(tmp) / "details.json", clock=lambda: now[0])
            calls = []

            def failing(game_id):
                calls.append(game_id)
                return {"ok": False, "developer": "未知", "tags": []}

            cache.get_or_fetch(2, failing)
            cache.get_or_fetch(2, failing)
            self.assertEqual(calls, [2])
            now[0] += 3_601
            cache.get_or_fetch(2, failing)
            self.assertEqual(calls, [2, 2])


if __name__ == "__main__":
    unittest.main()
