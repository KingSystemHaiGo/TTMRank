import unittest

from ttmrank.models import Appearance, Game
from ttmrank.validators import validate_chart_sizes, validate_dataset


class ValidatorTests(unittest.TestCase):
    def test_rejects_missing_game_reference(self):
        games = [Game(id=1, title="A")]
        appearances = [Appearance(game_id=2, platform="android", chart="hot", rank=1, observed_at=1)]
        issues = validate_dataset(games, appearances)
        self.assertTrue(any(issue.code == "missing_game" and issue.severity == "error" for issue in issues))

    def test_rejects_suspicious_empty_hot_chart(self):
        previous = {("android", "hot"): 150}
        current = {("android", "hot"): 0}
        issues = validate_chart_sizes(current, previous)
        self.assertTrue(any(issue.code == "chart_empty_regression" for issue in issues))


if __name__ == "__main__":
    unittest.main()
