import unittest

from ttmrank.metrics import non_hot_new_candidates
from ttmrank.models import Appearance


class NonHotNewTests(unittest.TestCase):
    def test_any_hot_or_new_appearance_excludes_the_game_on_every_platform(self):
        rows = [
            Appearance(game_id=1, platform="android", chart="hot", rank=1, observed_at=1),
            Appearance(game_id=1, platform="ios", chart="casual", rank=8, observed_at=1),
            Appearance(game_id=2, platform="android", chart="new", rank=2, observed_at=1),
            Appearance(game_id=2, platform="android", chart="strategy", rank=9, observed_at=1),
            Appearance(game_id=3, platform="android", chart="strategy", rank=7, observed_at=1),
            Appearance(game_id=4, platform="ios", chart="casual", rank=6, observed_at=1),
        ]
        self.assertEqual(non_hot_new_candidates(rows, "android"), {3})
        self.assertEqual(non_hot_new_candidates(rows, "ios"), {4})
        self.assertEqual(non_hot_new_candidates(rows, "all"), {3, 4})


if __name__ == "__main__":
    unittest.main()
