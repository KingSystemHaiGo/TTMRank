import unittest

from ttmrank.metrics import calculate_game_metric, median, quantile, summarize_games
from ttmrank.models import Game


class MetricTests(unittest.TestCase):
    def test_36_hour_game_has_20000_daily_heat(self):
        observed = 1_000_000
        game = Game(id=1, title="A", heat=30_000, released_at=observed - 36 * 3600, observed_at=observed)
        metric = calculate_game_metric(game, [])
        self.assertAlmostEqual(metric.age_hours, 36)
        self.assertAlmostEqual(metric.heat_per_day_lifetime, 20_000)

    def test_short_sample_and_invalid_release(self):
        observed = 1_000_000
        short = Game(id=1, title="A", heat=1_000, released_at=observed - 12 * 3600, observed_at=observed)
        future = Game(id=2, title="B", heat=1_000, released_at=observed + 1, observed_at=observed)
        self.assertTrue(calculate_game_metric(short, []).short_sample)
        self.assertIsNone(calculate_game_metric(future, []).age_hours)

    def test_median_and_interpolated_quantiles(self):
        self.assertEqual(median([1, 3, 5]), 3)
        self.assertEqual(median([1, 3, 5, 7]), 4)
        self.assertEqual(quantile([0, 10, 20, 30, 40], 0.25), 10)
        self.assertIsNone(median([]))

    def test_summary_deduplicates_games(self):
        games = [Game(id=1, title="A", heat=10, score=8), Game(id=1, title="A2", heat=99, score=9), Game(id=2, title="B", heat=30, score=None)]
        summary = summarize_games(games, [])
        self.assertEqual(summary["count"], 2)
        self.assertEqual(summary["heat_mean"], 20)
        self.assertEqual(summary["score_samples"], 1)


if __name__ == "__main__":
    unittest.main()
