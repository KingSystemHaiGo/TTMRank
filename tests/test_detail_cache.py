import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ttmrank.detail_cache import DetailCache


class DetailCacheTests(unittest.TestCase):
    def test_concurrent_fetches_persist_without_temp_file_collisions(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "details.json"
            cache = DetailCache(path, clock=lambda: 1_000)
            second_save_entered = threading.Event()
            active_saves = 0
            max_active_saves = 0
            observation_lock = threading.Lock()
            real_save = cache._save

            def observed_save():
                nonlocal active_saves, max_active_saves
                with observation_lock:
                    active_saves += 1
                    max_active_saves = max(max_active_saves, active_saves)
                    if active_saves > 1:
                        second_save_entered.set()
                if active_saves == 1:
                    second_save_entered.wait(timeout=0.2)
                try:
                    real_save()
                finally:
                    with observation_lock:
                        active_saves -= 1

            def fetcher(game_id):
                return {"id": game_id, "ok": True, "developer": "工作室", "tags": []}

            cache._save = observed_save
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda game_id: cache.get_or_fetch(game_id, fetcher), (1, 2)))

            self.assertEqual([result["id"] for result in results], [1, 2])
            self.assertEqual(max_active_saves, 1)
            reloaded = DetailCache(path, clock=lambda: 1_000)
            self.assertEqual(set(reloaded.entries), {"1", "2"})

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
