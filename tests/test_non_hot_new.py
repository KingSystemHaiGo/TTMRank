import unittest

from ttmrank.metrics import non_hot_new_candidates
from ttmrank.models import Appearance


class NonHotNewTests(unittest.TestCase):
    def test_platforms_are_evaluated_independently(self):
        rows = [
            Appearance(game_id=1, platform="android", chart="hot", rank=1, observed_at=1),
            Appearance(game_id=1, platform="ios", chart="casual", rank=8, observed_at=1),
            Appearance(game_id=2, platform="android", chart="new", rank=2, observed_at=1),
            Appearance(game_id=2, platform="android", chart="strategy", rank=9, observed_at=1),
            Appearance(game_id=3, platform="android", chart="strategy", rank=7, observed_at=1),
        ]
        self.assertEqual(non_hot_new_candidates(rows, "android"), {3})
        self.assertEqual(non_hot_new_candidates(rows, "ios"), {1})
        self.assertEqual(non_hot_new_candidates(rows, "all"), {1, 3})


if __name__ == "__main__":
    unittest.main()
