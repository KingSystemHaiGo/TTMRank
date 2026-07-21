import json
import unittest

from ttmrank.changes import (
    COVERAGE_DECREASE,
    COVERAGE_INCREASE,
    ENTERED,
    EXITED,
    RANK_FALL,
    RANK_RISE,
    REENTERED,
    SCORE_FALL,
    SCORE_RISE,
    build_observation_state,
    detect_events,
    event_importance,
    merge_events,
    rank_change_is_significant,
)
from ttmrank.models import Appearance, DataQualityIssue, Game
from ttmrank.normalize import NormalizedDataset


def game(game_id=1, *, score=8.0, made=False, title="Game"):
    return Game(
        id=game_id,
        title=title,
        icon_source_url=f"https://example.com/{game_id}.png",
        url=f"https://www.taptap.cn/app/{game_id}",
        score=score,
        is_taptap_made=made,
        observed_at=100,
    )


def appearance(game_id=1, *, platform="android", chart="hot", rank=10, at=100, source="live"):
    return Appearance(
        game_id=game_id,
        platform=platform,
        chart=chart,
        rank=rank,
        observed_at=at,
        source=source,
    )


def state(*, games, appearances=(), at, charts=None, issues=()):
    rows = list(appearances)
    dataset = NormalizedDataset(games=list(games), appearances=rows, issues=[], observed_at=at)
    if charts is None:
        charts = {(row.platform, row.chart): row.source for row in rows}
    platforms = {}
    for (platform, chart), source in charts.items():
        platforms.setdefault(platform, {})[chart] = {"items": [], "source": source}
    payload = {"updated_at": at, "platforms": platforms}
    return build_observation_state(dataset, payload, list(issues))


def event_of(events, kind):
    return next(event for event in events if event["kind"] == kind)


class RankThresholdTests(unittest.TestCase):
    def test_top_ten_requires_two_places(self):
        self.assertFalse(rank_change_is_significant(8, 7))
        self.assertTrue(rank_change_is_significant(8, 6))

    def test_middle_rank_requires_five_places(self):
        self.assertFalse(rank_change_is_significant(30, 26))
        self.assertTrue(rank_change_is_significant(30, 25))

    def test_tail_rank_requires_ten_places(self):
        self.assertTrue(rank_change_is_significant(80, 70))
        self.assertFalse(rank_change_is_significant(80, 72))


class ObservationStateTests(unittest.TestCase):
    def test_builds_json_ready_game_chart_and_appearance_state(self):
        issue = DataQualityIssue(
            code="chart_size_regression",
            message="chart restored from cache",
            severity="error",
            platform="ios",
            chart="new",
        )
        result = state(
            games=[game(made=True)],
            appearances=[appearance(rank=8)],
            at=100,
            charts={("android", "hot"): "live", ("ios", "new"): "cache"},
            issues=[issue],
        )

        self.assertEqual(result["observed_at"], 100)
        self.assertEqual(result["games"]["1"]["scope"], "made")
        self.assertEqual(len(result["appearances"]), 1)
        self.assertTrue(result["charts"]["android|hot"]["complete"])
        self.assertFalse(result["charts"]["ios|new"]["complete"])
        self.assertEqual(result["seen_appearance_keys"], ["1|android|hot"])
        json.dumps(result)

    def test_chart_quality_regression_is_incomplete_even_when_reported_as_warning(self):
        issue = DataQualityIssue(
            code="chart_size_regression",
            message="chart fell below its quality threshold",
            platform="android",
            chart="hot",
        )

        result = state(
            games=[game()],
            appearances=[appearance(rank=8)],
            at=100,
            issues=[issue],
        )

        self.assertFalse(result["charts"]["android|hot"]["complete"])

    def test_malformed_chart_payload_is_never_treated_as_complete(self):
        dataset = NormalizedDataset(
            games=[game()],
            appearances=[],
            issues=[],
            observed_at=200,
        )

        result = build_observation_state(
            dataset,
            {"updated_at": 200, "platforms": {"android": {"hot": None}}},
            [],
        )

        self.assertFalse(result["charts"]["android|hot"]["complete"])


class EventDetectionTests(unittest.TestCase):
    def test_rank_rise_payload_is_structured(self):
        previous = state(games=[game(title="Alpha")], appearances=[appearance(rank=8)], at=100)
        current = state(games=[game(title="Alpha")], appearances=[appearance(rank=6, at=200)], at=200)

        events, suppressed = detect_events(previous, current)
        event = event_of(events, RANK_RISE)

        self.assertEqual(suppressed, 0)
        self.assertEqual(event["game_id"], 1)
        self.assertEqual(event["game_title"], "Alpha")
        self.assertEqual(event["before"], 8)
        self.assertEqual(event["after"], 6)
        self.assertEqual(event["platform"], "android")
        self.assertEqual(event["chart"], "hot")
        self.assertEqual(event["observed_at"], 200)
        self.assertEqual(event["rule"], "rank_threshold_top_10")
        self.assertEqual(event["scope"], "all")
        self.assertEqual(event["importance"], event_importance(event))

    def test_rank_fall_payload_is_structured(self):
        previous = state(games=[game()], appearances=[appearance(rank=30)], at=100)
        current = state(games=[game()], appearances=[appearance(rank=36, at=200)], at=200)

        events, _ = detect_events(previous, current)
        event = event_of(events, RANK_FALL)

        self.assertEqual((event["before"], event["after"]), (30, 36))
        self.assertEqual(event["rule"], "rank_threshold_11_50")

    def test_new_appearance_is_first_entry(self):
        previous = state(games=[game()], at=100, charts={("android", "hot"): "live"})
        current = state(games=[game()], appearances=[appearance(rank=12, at=200)], at=200)

        events, _ = detect_events(previous, current)
        event = event_of(events, ENTERED)

        self.assertEqual((event["before"], event["after"]), (None, 12))
        self.assertEqual(event["rule"], "first_appearance")

    def test_seen_appearance_is_reentry(self):
        historical = state(games=[game()], appearances=[appearance(rank=15, at=50)], at=50)
        previous = state(games=[game()], at=100, charts={("android", "hot"): "live"})
        previous["seen_appearance_keys"] = historical["seen_appearance_keys"]
        current = state(games=[game()], appearances=[appearance(rank=9, at=200)], at=200)

        events, _ = detect_events(previous, current)
        event = event_of(events, REENTERED)

        self.assertEqual((event["before"], event["after"]), (None, 9))
        self.assertEqual(event["rule"], "seen_appearance")

    def test_exit_requires_complete_chart_on_both_observations(self):
        previous = state(games=[game()], appearances=[appearance(rank=7)], at=100)
        current = state(games=[game()], at=200, charts={("android", "hot"): "live"})

        events, suppressed = detect_events(previous, current)
        event = event_of(events, EXITED)

        self.assertEqual((event["before"], event["after"]), (7, None))
        self.assertEqual(event["rule"], "complete_chart_absence")
        self.assertEqual(suppressed, 0)

    def test_incomplete_chart_suppresses_exit_and_coverage_decrease(self):
        previous = state(games=[game()], appearances=[appearance(rank=7)], at=100)
        current = state(games=[game()], at=200, charts={("android", "hot"): "cache"})

        events, suppressed = detect_events(previous, current)

        self.assertNotIn(EXITED, {event["kind"] for event in events})
        self.assertNotIn(COVERAGE_DECREASE, {event["kind"] for event in events})
        self.assertEqual(suppressed, 2)

    def test_previous_incomplete_chart_also_suppresses_negative_events(self):
        previous = state(
            games=[game()],
            appearances=[appearance(rank=7, source="cache")],
            at=100,
        )
        current = state(games=[game()], at=200, charts={("android", "hot"): "live"})

        events, suppressed = detect_events(previous, current)

        self.assertNotIn(EXITED, {event["kind"] for event in events})
        self.assertNotIn(COVERAGE_DECREASE, {event["kind"] for event in events})
        self.assertEqual(suppressed, 2)

    def test_one_incomplete_removed_chart_suppresses_aggregate_coverage_decrease(self):
        previous = state(
            games=[game()],
            appearances=[
                appearance(rank=10),
                appearance(platform="ios", chart="new", rank=3, source="cache"),
            ],
            at=100,
        )
        current = state(
            games=[game()],
            appearances=[appearance(rank=10, at=200)],
            at=200,
            charts={("android", "hot"): "live", ("ios", "new"): "live"},
        )

        events, suppressed = detect_events(previous, current)

        self.assertNotIn(COVERAGE_DECREASE, {event["kind"] for event in events})
        self.assertEqual(suppressed, 2)

    def test_score_rise_at_exact_normalized_tenth(self):
        previous = state(games=[game(score=8.04)], at=100)
        current = state(games=[game(score=8.14)], at=200)

        events, _ = detect_events(previous, current)
        event = event_of(events, SCORE_RISE)

        self.assertEqual((event["before"], event["after"]), (8.0, 8.1))
        self.assertEqual(event["rule"], "score_delta_0.1")

    def test_score_fall_at_exact_normalized_tenth(self):
        previous = state(games=[game(score=8.16)], at=100)
        current = state(games=[game(score=8.06)], at=200)

        events, _ = detect_events(previous, current)
        event = event_of(events, SCORE_FALL)

        self.assertEqual((event["before"], event["after"]), (8.2, 8.1))

    def test_score_change_below_normalized_tenth_is_ignored(self):
        previous = state(games=[game(score=8.01)], at=100)
        current = state(games=[game(score=8.04)], at=200)

        events, _ = detect_events(previous, current)

        self.assertNotIn(SCORE_RISE, {event["kind"] for event in events})
        self.assertNotIn(SCORE_FALL, {event["kind"] for event in events})

    def test_non_finite_scores_are_ignored(self):
        for invalid_score in (float("nan"), float("inf"), float("-inf"), "NaN"):
            with self.subTest(invalid_score=invalid_score):
                previous = state(games=[game(score=8.0)], at=100)
                current = state(games=[game(score=invalid_score)], at=200)

                events, _ = detect_events(previous, current)

                self.assertNotIn(SCORE_RISE, {event["kind"] for event in events})
                self.assertNotIn(SCORE_FALL, {event["kind"] for event in events})

    def test_coverage_increase_is_always_recorded(self):
        previous = state(games=[game()], appearances=[appearance(rank=10)], at=100)
        current = state(
            games=[game()],
            appearances=[appearance(rank=10, at=200), appearance(platform="ios", chart="new", rank=3, at=200)],
            at=200,
        )

        events, _ = detect_events(previous, current)
        event = event_of(events, COVERAGE_INCREASE)

        self.assertEqual((event["before"], event["after"]), (1, 2))
        self.assertEqual(event["rule"], "chart_coverage_change")

    def test_coverage_decrease_is_recorded_when_removed_charts_are_complete(self):
        previous = state(
            games=[game()],
            appearances=[appearance(rank=10), appearance(platform="ios", chart="new", rank=3)],
            at=100,
        )
        current = state(
            games=[game()],
            appearances=[appearance(rank=10, at=200)],
            at=200,
            charts={("android", "hot"): "live", ("ios", "new"): "live"},
        )

        events, _ = detect_events(previous, current)
        event = event_of(events, COVERAGE_DECREASE)

        self.assertEqual((event["before"], event["after"]), (2, 1))
        self.assertEqual(event["rule"], "complete_chart_coverage_change")

    def test_scope_is_made_when_either_observation_marks_the_game_made(self):
        cases = ((True, False), (False, True))
        for previous_made, current_made in cases:
            with self.subTest(previous_made=previous_made, current_made=current_made):
                previous = state(
                    games=[game(made=previous_made)],
                    appearances=[appearance(rank=8)],
                    at=100,
                )
                current = state(
                    games=[game(made=current_made)],
                    appearances=[appearance(rank=6, at=200)],
                    at=200,
                )

                events, _ = detect_events(previous, current)

                self.assertTrue(events)
                self.assertTrue(all(event["scope"] == "made" for event in events))

    def test_event_ids_are_stable_for_the_same_observations(self):
        previous = state(games=[game()], appearances=[appearance(rank=8)], at=100)
        current = state(games=[game()], appearances=[appearance(rank=6, at=200)], at=200)

        first, _ = detect_events(previous, current)
        second, _ = detect_events(previous, current)

        self.assertEqual([event["id"] for event in first], [event["id"] for event in second])
        self.assertTrue(all(event["id"].startswith("evt_") for event in first))
        json.dumps(first)

    def test_importance_is_deterministic_and_rewards_top_rank_context(self):
        top = {
            "kind": RANK_RISE,
            "scope": "made",
            "game_id": 1,
            "platform": "android",
            "chart": "hot",
            "before": 8,
            "after": 6,
        }
        tail = {
            "after": 70,
            "before": 80,
            "chart": "hot",
            "platform": "android",
            "game_id": 1,
            "scope": "made",
            "kind": RANK_RISE,
        }

        self.assertEqual(event_importance(top), event_importance(dict(reversed(list(top.items())))))
        self.assertGreater(event_importance(top), event_importance(tail))


class EventMergeTests(unittest.TestCase):
    @staticmethod
    def rank_event(kind, observed_at, before, after, event_id):
        return {
            "id": event_id,
            "kind": kind,
            "scope": "made",
            "game_id": 1,
            "game_title": "Alpha",
            "game_icon": "https://example.com/1.png",
            "game_url": "https://www.taptap.cn/app/1",
            "platform": "android",
            "chart": "hot",
            "before": before,
            "after": after,
            "observed_at": observed_at,
            "rule": "rank_threshold_11_50",
            "importance": 65,
        }

    def test_same_direction_rank_events_merge_inside_two_hours(self):
        first = self.rank_event(RANK_RISE, 1_000, 30, 24, "evt_first")
        second = self.rank_event(RANK_RISE, 1_000 + 3_600, 24, 18, "evt_second")

        result = merge_events([second, first])

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "evt_first")
        self.assertEqual((result[0]["before"], result[0]["after"]), (30, 18))
        self.assertEqual(result[0]["first_observed_at"], 1_000)
        self.assertEqual(result[0]["last_observed_at"], 4_600)
        self.assertEqual(result[0]["occurrences"], 2)

    def test_opposite_rank_directions_do_not_merge(self):
        rise = self.rank_event(RANK_RISE, 1_000, 30, 24, "evt_rise")
        fall = self.rank_event(RANK_FALL, 2_000, 24, 30, "evt_fall")

        result = merge_events([rise, fall])

        self.assertEqual({event["id"] for event in result}, {"evt_rise", "evt_fall"})

    def test_events_outside_two_hours_remain_separate(self):
        first = self.rank_event(RANK_RISE, 1_000, 30, 24, "evt_first")
        second = self.rank_event(RANK_RISE, 1_000 + 7_201, 24, 18, "evt_second")

        result = merge_events([first, second])

        self.assertEqual({event["id"] for event in result}, {"evt_first", "evt_second"})


if __name__ == "__main__":
    unittest.main()
