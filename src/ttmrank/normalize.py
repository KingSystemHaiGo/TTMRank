"""Normalize legacy nested ranking JSON into games and appearances."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from .models import Appearance, DataQualityIssue, Game


@dataclass(slots=True)
class NormalizedDataset:
    games: list[Game]
    appearances: list[Appearance]
    issues: list[DataQualityIssue]
    observed_at: int


def _parse_observed_at(value: str | int | None) -> int:
    if isinstance(value, int):
        return value
    if value:
        return int(datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=ZoneInfo("Asia/Shanghai")).timestamp())
    return 0


def _score(value: Any) -> float | None:
    if value in {None, "", "-"}:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _candidate(item: dict, observed_at: int) -> dict:
    tags = [str(tag) for tag in item.get("tags", []) if tag]
    return {
        "id": int(item["id"]),
        "title": str(item.get("title") or "未知"),
        "icon_source_url": str(item.get("icon") or ""),
        "url": str(item.get("url") or f"https://www.taptap.cn/app/{item['id']}"),
        "developer": str(item.get("developer") or "未知"),
        "tags": tags,
        "supported_platforms": [str(platform) for platform in item.get("platforms", []) if platform],
        "released_at": item.get("released_time"),
        "score": _score(item.get("score")),
        "heat": int(item.get("count") or 0),
        "reserve": int(item.get("reserve") or 0),
        "is_taptap_made": "TapTap制造" in tags,
        "observed_at": observed_at,
    }


def normalize_legacy_rankings(payload: dict) -> NormalizedDataset:
    observed_at = _parse_observed_at(payload.get("updated_at"))
    candidates: dict[int, list[dict]] = {}
    appearances: list[Appearance] = []
    issues: list[DataQualityIssue] = []
    seen_appearances: set[tuple[int, str, str]] = set()

    for platform, charts in payload.get("platforms", {}).items():
        for chart, chart_data in charts.items():
            for item in chart_data.get("items", []):
                if not item.get("id"):
                    continue
                game_id = int(item["id"])
                candidates.setdefault(game_id, []).append(_candidate(item, observed_at))
                appearance = Appearance(
                    game_id=game_id,
                    platform=platform,
                    chart=chart,
                    rank=int(item.get("rank") or 0),
                    observed_at=observed_at,
                    source=chart_data.get("source", "live"),
                )
                if appearance.identity not in seen_appearances:
                    appearances.append(appearance)
                    seen_appearances.add(appearance.identity)

    games: list[Game] = []
    compared_fields = ("title", "icon_source_url", "developer", "released_at", "score", "heat")
    for game_id, rows in candidates.items():
        selected = rows[-1].copy()
        for field in compared_fields:
            values = []
            for row in rows:
                value = row.get(field)
                if value not in {None, "", "未知"} and value not in values:
                    values.append(value)
            if len(values) > 1:
                issues.append(DataQualityIssue(code="field_conflict", message=f"conflicting {field}", game_id=game_id, field=field, values=values))
            valid = [row.get(field) for row in rows if row.get(field) not in {None, "", "未知"}]
            if valid:
                selected[field] = valid[-1]
        tags = sorted({tag for row in rows for tag in row.get("tags", [])})
        platforms = sorted({platform for row in rows for platform in row.get("supported_platforms", [])})
        selected["tags"] = tags
        selected["supported_platforms"] = platforms
        selected["is_taptap_made"] = "TapTap制造" in tags
        games.append(Game(**selected))

    games.sort(key=lambda game: game.id)
    appearances.sort(key=lambda row: (row.platform, row.chart, row.rank, row.game_id))
    return NormalizedDataset(games=games, appearances=appearances, issues=issues, observed_at=observed_at)

