"""Deterministic metric and analysis-board calculations."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Iterable, Sequence

from .models import Appearance, Game, GameMetric


def _numbers(values: Iterable[float | int | None]) -> list[float]:
    return sorted(float(value) for value in values if value is not None and math.isfinite(float(value)))


def mean(values: Iterable[float | int | None]) -> float | None:
    numbers = _numbers(values)
    return sum(numbers) / len(numbers) if numbers else None


def quantile(values: Iterable[float | int | None], probability: float) -> float | None:
    numbers = _numbers(values)
    if not numbers:
        return None
    if not 0 <= probability <= 1:
        raise ValueError("probability must be between zero and one")
    position = (len(numbers) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return numbers[lower]
    weight = position - lower
    return numbers[lower] * (1 - weight) + numbers[upper] * weight


def median(values: Iterable[float | int | None]) -> float | None:
    return quantile(values, 0.5)


def percentile_rank(values: Iterable[float | int | None], value: float | None) -> float | None:
    numbers = _numbers(values)
    if not numbers or value is None:
        return None
    below = sum(number < value for number in numbers)
    equal = sum(number == value for number in numbers)
    return (below + 0.5 * equal) / len(numbers)


def calculate_game_metric(game: Game, appearances: Sequence[Appearance], history: dict | None = None) -> GameMetric:
    age_hours = None
    per_hour = None
    per_day = None
    if game.released_at and game.observed_at > game.released_at and game.heat is not None:
        age_hours = (game.observed_at - game.released_at) / 3600
        if age_hours > 0:
            per_hour = game.heat / age_hours
            per_day = per_hour * 24
    game_rows = [row for row in appearances if row.game_id == game.id]
    charts = {(row.platform, row.chart) for row in game_rows}
    platforms = {row.platform for row in game_rows}
    history = history or {}
    return GameMetric(
        game_id=game.id,
        age_hours=age_hours,
        heat_per_hour_lifetime=per_hour,
        heat_per_day_lifetime=per_day,
        heat_delta_1h=history.get("heat_delta_1h"),
        heat_delta_24h=history.get("heat_delta_24h"),
        heat_delta_7d=history.get("heat_delta_7d"),
        growth_per_hour_24h=history.get("growth_per_hour_24h"),
        chart_coverage=len(charts),
        platform_coverage=len(platforms),
        short_sample=age_hours is not None and age_hours < 24,
        history_available=bool(history),
    )


def summarize_games(games: Sequence[Game], metrics: Sequence[GameMetric], high_score: float = 8.5) -> dict:
    deduplicated = {game.id: game for game in reversed(games)}
    games_unique = list(reversed(list(deduplicated.values())))
    metric_map = {metric.game_id: metric for metric in metrics}
    heats = [game.heat for game in games_unique if game.heat is not None]
    scores = [game.score for game in games_unique if game.score is not None]
    daily = [metric_map[game.id].heat_per_day_lifetime for game in games_unique if game.id in metric_map and metric_map[game.id].heat_per_day_lifetime is not None]
    top_heats = sorted(heats, reverse=True)[:10]
    return {
        "count": len(games_unique),
        "heat_samples": len(heats),
        "score_samples": len(scores),
        "daily_heat_samples": len(daily),
        "heat_mean": mean(heats),
        "heat_median": median(heats),
        "heat_p25": quantile(heats, 0.25),
        "heat_p75": quantile(heats, 0.75),
        "heat_p90": quantile(heats, 0.90),
        "score_mean": mean(scores),
        "score_median": median(scores),
        "daily_heat_mean": mean(daily),
        "daily_heat_median": median(daily),
        "daily_heat_p25": quantile(daily, 0.25),
        "daily_heat_p75": quantile(daily, 0.75),
        "daily_heat_p90": quantile(daily, 0.90),
        "high_score_count": sum(score >= high_score for score in scores),
        "top10_heat_share": (sum(top_heats) / sum(heats)) if heats and sum(heats) else None,
    }


def non_hot_new_candidates(appearances: Sequence[Appearance], platform: str = "all") -> set[int]:
    excluded = {row.game_id for row in appearances if row.chart in {"hot", "new"}}
    other = {
        row.game_id
        for row in appearances
        if row.chart not in {"hot", "new"} and (platform == "all" or row.platform == platform)
    }
    return other - excluded


def analysis_boards(games: Sequence[Game], appearances: Sequence[Appearance], metrics: Sequence[GameMetric]) -> dict[str, list[int]]:
    by_id = {game.id: game for game in games}
    metric_map = {metric.game_id: metric for metric in metrics}
    summary = summarize_games(games, metrics)
    score_mid = summary["score_median"]
    heat_mid = summary["heat_median"]
    daily_mid = summary["daily_heat_median"]

    def eligible_potential(game: Game, realized: bool) -> bool:
        metric = metric_map.get(game.id)
        if not metric or None in {game.score, game.heat, metric.heat_per_day_lifetime, metric.age_hours, score_mid, heat_mid, daily_mid}:
            return False
        heat_check = game.heat > heat_mid if realized else game.heat < heat_mid
        max_days = 30 if realized else 15
        return bool(game.score > score_mid and heat_check and metric.heat_per_day_lifetime > daily_mid and 0 < metric.age_hours <= max_days * 24)

    hot_ids = {row.game_id for row in appearances if row.chart == "hot"}
    new_ids = {row.game_id for row in appearances if row.chart == "new"}
    daily_sorted = sorted((game for game in games if metric_map.get(game.id) and metric_map[game.id].heat_per_day_lifetime is not None), key=lambda game: metric_map[game.id].heat_per_day_lifetime, reverse=True)
    return {
        "potential": [game.id for game in games if eligible_potential(game, False)],
        "realized": [game.id for game in games if eligible_potential(game, True)],
        "daily_heat": [game.id for game in daily_sorted[:15]],
        "hot": [game.id for game in sorted((by_id[id_] for id_ in hot_ids if id_ in by_id), key=lambda game: game.heat or 0, reverse=True)[:15]],
        "new": [game.id for game in sorted((by_id[id_] for id_ in new_ids if id_ in by_id), key=lambda game: game.heat or 0, reverse=True)[:15]],
        "non_hot_new": [game.id for game in sorted((by_id[id_] for id_ in non_hot_new_candidates(appearances) if id_ in by_id), key=lambda game: game.heat or 0, reverse=True)[:15]],
        "rating": [game.id for game in sorted((game for game in games if game.score is not None), key=lambda game: (game.score, game.heat or 0), reverse=True)[:15]],
        "reputation_warning": [game.id for game in sorted((game for game in games if game.score is not None and heat_mid is not None and (game.heat or 0) >= heat_mid), key=lambda game: game.score)[:15]],
    }

