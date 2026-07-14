"""Dataset validation and publication gates."""

from __future__ import annotations

from .config import PLATFORMS, RANK_TYPES
from .models import Appearance, DataQualityIssue, Game


def validate_dataset(games: list[Game], appearances: list[Appearance]) -> list[DataQualityIssue]:
    issues: list[DataQualityIssue] = []
    ids: set[int] = set()
    for game in games:
        if game.id in ids:
            issues.append(DataQualityIssue(code="duplicate_game", message="duplicate game id", severity="error", game_id=game.id))
        ids.add(game.id)
    seen_appearances: set[tuple[int, str, str]] = set()
    for appearance in appearances:
        if appearance.game_id not in ids:
            issues.append(DataQualityIssue(code="missing_game", message="appearance references missing game", severity="error", game_id=appearance.game_id))
        if appearance.platform not in PLATFORMS:
            issues.append(DataQualityIssue(code="invalid_platform", message="invalid platform", severity="error", game_id=appearance.game_id, platform=appearance.platform))
        if appearance.chart not in RANK_TYPES:
            issues.append(DataQualityIssue(code="invalid_chart", message="invalid chart", severity="error", game_id=appearance.game_id, chart=appearance.chart))
        if appearance.identity in seen_appearances:
            issues.append(DataQualityIssue(code="duplicate_appearance", message="duplicate appearance", severity="error", game_id=appearance.game_id, platform=appearance.platform, chart=appearance.chart))
        seen_appearances.add(appearance.identity)
    return issues


def validate_chart_sizes(
    current: dict[tuple[str, str], int],
    previous: dict[tuple[str, str], int],
    *,
    drop_ratio: float = 0.7,
) -> list[DataQualityIssue]:
    issues: list[DataQualityIssue] = []
    for identity, previous_count in previous.items():
        current_count = current.get(identity, 0)
        platform, chart = identity
        if previous_count > 0 and current_count == 0:
            issues.append(DataQualityIssue(code="chart_empty_regression", message=f"chart fell from {previous_count} to zero", severity="error", platform=platform, chart=chart))
        elif previous_count >= 10 and current_count < previous_count * (1 - drop_ratio):
            issues.append(DataQualityIssue(code="chart_size_regression", message=f"chart fell from {previous_count} to {current_count}", severity="error", platform=platform, chart=chart))
    return issues

