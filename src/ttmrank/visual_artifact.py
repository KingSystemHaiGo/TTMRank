"""Compact, game-first dataset for optional visual exploration surfaces."""

from __future__ import annotations

from collections import Counter
from typing import Sequence

from .models import Game, GameMetric

SCHEMA_VERSION = "1.0"
MAX_CLUSTERS = 8
MAX_GAMES = 180
EXCLUDED_TAGS = {"TapTap制造"}


def _clusters(games: Sequence[Game]) -> list[str]:
    counts = Counter(
        tag
        for game in games
        for tag in game.tags
        if tag and tag not in EXCLUDED_TAGS
    )
    return [tag for tag, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:MAX_CLUSTERS]]


def build_visual_artifact(
    games: Sequence[Game],
    metrics: Sequence[GameMetric],
    *,
    updated_at: str | None,
    observed_at: int,
) -> dict:
    """Build a bounded made-only payload without developer or ranking-row details."""

    made = [game for game in games if game.is_taptap_made]
    made.sort(key=lambda game: (-(game.heat or 0), game.id))
    made = made[:MAX_GAMES]
    clusters = _clusters(made)
    cluster_set = set(clusters)
    metric_map = {metric.game_id: metric for metric in metrics}
    rows = []
    for game in made:
        metric = metric_map.get(game.id)
        tags = [tag for tag in game.tags if tag and tag not in EXCLUDED_TAGS][:4]
        cluster = next((tag for tag in tags if tag in cluster_set), "其他")
        rows.append({
            "id": game.id,
            "title": game.title,
            "icon": game.icon_source_url,
            "url": game.url,
            "cluster": cluster,
            "tags": tags,
            "heat": game.heat,
            "score": game.score,
            "daily_heat": metric.heat_per_day_lifetime if metric else None,
            "growth_24h": metric.heat_delta_24h if metric else None,
            "chart_coverage": metric.chart_coverage if metric else 0,
            "platform_coverage": metric.platform_coverage if metric else 0,
        })
    return {
        "schema_version": SCHEMA_VERSION,
        "updated_at": updated_at,
        "observed_at": observed_at,
        "clusters": clusters + (["其他"] if any(row["cluster"] == "其他" for row in rows) else []),
        "games": rows,
    }
