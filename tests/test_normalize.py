import json
import unittest
from pathlib import Path

from ttmrank.normalize import normalize_legacy_rankings


class NormalizeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).parent / "fixtures" / "rankings-small.json"
        cls.payload = json.loads(path.read_text(encoding="utf-8"))

    def test_deduplicates_games_but_keeps_appearances(self):
        dataset = normalize_legacy_rankings(self.payload)
        self.assertEqual(len(dataset.games), 4)
        self.assertEqual(len(dataset.appearances), 6)

    def test_latest_valid_duplicate_fields_win_and_conflict_is_reported(self):
        dataset = normalize_legacy_rankings(self.payload)
        game = next(game for game in dataset.games if game.id == 1)
        self.assertEqual(game.heat, 30_500)
        self.assertEqual(game.score, 8.1)
        self.assertTrue(any(issue.code == "field_conflict" and issue.game_id == 1 for issue in dataset.issues))

    def test_taptap_made_is_exact_tag_match(self):
        dataset = normalize_legacy_rankings(self.payload)
        flags = {game.id: game.is_taptap_made for game in dataset.games}
        self.assertEqual(flags, {1: False, 2: True, 3: False, 4: False})


if __name__ == "__main__":
    unittest.main()
