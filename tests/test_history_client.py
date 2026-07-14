import unittest
from ttmrank.history_client import HistoryClient

NOW = 1_800_000_000


class HistoryClientTests(unittest.TestCase):
    def test_missing_configuration_degrades_without_error(self):
        client=HistoryClient('')
        self.assertFalse(client.ingest([{'id':1,'heat':2}],1000))
        self.assertEqual(client.baselines([1],1000),{})

    def test_metrics_use_actual_intervals_and_target_tolerances(self):
        points = [
            {"game_id": 1, "captured_hour": NOW - 3700, "heat": 900},
            {"game_id": 1, "captured_hour": NOW - 25 * 3600, "heat": 600},
            {"game_id": 1, "captured_hour": NOW - 7 * 86400 - 3600, "heat": 200},
        ]
        metrics = HistoryClient.metrics_from_points([{"id": 1, "heat": 1000}], NOW, points)
        self.assertEqual(metrics[1]["heat_delta_1h"], 100)
        self.assertEqual(metrics[1]["heat_delta_24h"], 400)
        self.assertEqual(metrics[1]["heat_delta_7d"], 800)
        self.assertAlmostEqual(metrics[1]["growth_per_hour_24h"], 16)

    def test_metrics_ignore_points_after_target_or_outside_tolerance(self):
        points = [
            {"game_id": 1, "captured_hour": NOW - 1800, "heat": 950},
            {"game_id": 1, "captured_hour": NOW - 4 * 3600, "heat": 700},
        ]
        metrics = HistoryClient.metrics_from_points([{"id": 1, "heat": 1000}], NOW, points)
        self.assertEqual(metrics, {})

if __name__=='__main__': unittest.main()
