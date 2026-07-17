"""Detect meaningful, quality-gated changes between ranking observations."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from typing import Any


RANK_RISE = "rank_rise"
RANK_FALL = "rank_fall"
ENTERED = "entered"
REENTERED = "reentered"
EXITED = "exited"
SCORE_RISE = "score_rise"
SCORE_FALL = "score_fall"
COVERAGE_INCREASE = "coverage_increase"
COVERAGE_DECREASE = "coverage_decrease"


def rank_change_is_significant(previous_rank: int, current_rank: int) -> bool:
    """Return whether a rank movement reaches the threshold for its prior rank."""

    if previous_rank <= 0 or current_rank <= 0:
        raise ValueError("ranks must be positive integers")
    movement = abs(previous_rank - current_rank)
    if previous_rank <= 10:
        return movement >= 2
    if previous_rank <= 50:
        return movement >= 5
    return movement >= 10 or Decimal(movement) / Decimal(previous_rank) >= Decimal("0.2")


def _value(record: Any, name: str, default: Any = None) -> Any:
    if isinstance(record, dict):
        return record.get(name, default)
    return getattr(record, name, default)


def _appearance_key(game_id: int, platform: str, chart: str) -> str:
    return f"{game_id}|{platform}|{chart}"


def _chart_key(platform: str, chart: str) -> str:
    return f"{platform}|{chart}"


def build_observation_state(dataset, payload: dict, issues: list) -> dict:
    """Build a compact, JSON-ready comparison state from normalized data."""

    games: dict[str, dict] = {}
    for game in _value(dataset, "games", []):
        game_id = int(_value(game, "id"))
        icon_proxy = _value(game, "icon_proxy_url")
        icon_source = _value(game, "icon_source_url", "")
        made = bool(_value(game, "is_taptap_made", False))
        games[str(game_id)] = {
            "id": game_id,
            "title": str(_value(game, "title", "")),
            "icon": str(icon_proxy or icon_source or ""),
            "url": str(_value(game, "url", "") or ""),
            "score": _value(game, "score"),
            "scope": "made" if made else "all",
        }

    charts: dict[str, dict] = {}
    for platform, platform_charts in payload.get("platforms", {}).items():
        if not isinstance(platform_charts, dict):
            continue
        for chart, chart_payload in platform_charts.items():
            source = chart_payload.get("source", "live") if isinstance(chart_payload, dict) else "live"
            key = _chart_key(str(platform), str(chart))
            charts[key] = {
                "platform": str(platform),
                "chart": str(chart),
                "complete": source == "live",
            }

    for issue in issues:
        code = str(_value(issue, "code", ""))
        rejected_chart = code in {"chart_empty_regression", "chart_size_regression"}
        if _value(issue, "severity", "warning") != "error" and not rejected_chart:
            continue
        platform = _value(issue, "platform")
        chart = _value(issue, "chart")
        if platform is None or chart is None:
            continue
        key = _chart_key(str(platform), str(chart))
        charts.setdefault(
            key,
            {"platform": str(platform), "chart": str(chart), "complete": False},
        )["complete"] = False

    appearances: dict[str, dict] = {}
    for appearance in _value(dataset, "appearances", []):
        game_id = int(_value(appearance, "game_id"))
        platform = str(_value(appearance, "platform"))
        chart = str(_value(appearance, "chart"))
        source = str(_value(appearance, "source", "live"))
        key = _appearance_key(game_id, platform, chart)
        appearances[key] = {
            "game_id": game_id,
            "platform": platform,
            "chart": chart,
            "rank": int(_value(appearance, "rank")),
        }
        chart_identity = _chart_key(platform, chart)
        if chart_identity not in charts:
            charts[chart_identity] = {
                "platform": platform,
                "chart": chart,
                "complete": False,
            }
        if source != "live":
            charts[chart_identity]["complete"] = False

    observed_at = int(_value(dataset, "observed_at", 0) or 0)
    return {
        "observed_at": observed_at,
        "updated_at": payload.get("updated_at", ""),
        "games": dict(sorted(games.items(), key=lambda row: int(row[0]))),
        "appearances": dict(sorted(appearances.items())),
        "charts": dict(sorted(charts.items())),
        "seen_appearance_keys": sorted(appearances),
    }


def _normalized_score(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value)).quantize(Decimal("0.1"))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _game(state: dict, game_id: int) -> dict | None:
    games = state.get("games", {})
    return games.get(str(game_id)) or games.get(game_id)


def _scope(previous: dict, current: dict, game_id: int) -> str:
    records = (_game(previous, game_id), _game(current, game_id))
    return "made" if any(record and record.get("scope") == "made" for record in records) else "all"


def _rank_rule(previous_rank: int) -> str:
    if previous_rank <= 10:
        return "rank_threshold_top_10"
    if previous_rank <= 50:
        return "rank_threshold_11_50"
    return "rank_threshold_51_plus"


def _chart_is_complete(state: dict, platform: str, chart: str) -> bool:
    record = state.get("charts", {}).get(_chart_key(platform, chart))
    if isinstance(record, bool):
        return record
    return bool(record and record.get("complete"))


def _absence_is_trustworthy(previous: dict, current: dict, appearance: dict) -> bool:
    platform = appearance["platform"]
    chart = appearance["chart"]
    return _chart_is_complete(previous, platform, chart) and _chart_is_complete(current, platform, chart)


def _canonical_number(value: Any) -> Any:
    if isinstance(value, float):
        return format(value, ".12g")
    return value


def _event_id(event: dict) -> str:
    identity = {
        "kind": event["kind"],
        "game_id": event["game_id"],
        "platform": event["platform"],
        "chart": event["chart"],
        "before": _canonical_number(event["before"]),
        "after": _canonical_number(event["after"]),
        "observed_at": event["observed_at"],
    }
    encoded = json.dumps(identity, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "evt_" + hashlib.sha256(encoded).hexdigest()[:32]


def _make_event(
    previous: dict,
    current: dict,
    *,
    kind: str,
    game_id: int,
    before: int | float | None,
    after: int | float | None,
    platform: str | None,
    chart: str | None,
    rule: str,
) -> dict:
    game = _game(current, game_id) or _game(previous, game_id) or {}
    event = {
        "kind": kind,
        "scope": _scope(previous, current, game_id),
        "game_id": game_id,
        "game_title": str(game.get("title", "")),
        "game_icon": str(game.get("icon", "")),
        "game_url": str(game.get("url", "")),
        "platform": platform,
        "chart": chart,
        "before": before,
        "after": after,
        "observed_at": int(current.get("observed_at", 0) or 0),
        "rule": rule,
    }
    event["importance"] = event_importance(event)
    event["id"] = _event_id(event)
    return event


def _coverage(appearances: dict[str, dict]) -> dict[int, set[str]]:
    result: dict[int, set[str]] = defaultdict(set)
    for key, appearance in appearances.items():
        result[int(appearance["game_id"])].add(key)
    return result


def detect_events(previous: dict, current: dict) -> tuple[list[dict], int]:
    """Compare two observation states and return events plus suppressed negatives."""

    events: list[dict] = []
    suppressed_negative_event_count = 0
    previous_appearances = previous.get("appearances", {})
    current_appearances = current.get("appearances", {})
    previous_keys = set(previous_appearances)
    current_keys = set(current_appearances)

    for key in sorted(previous_keys & current_keys):
        before_row = previous_appearances[key]
        after_row = current_appearances[key]
        before = int(before_row["rank"])
        after = int(after_row["rank"])
        if before == after or not rank_change_is_significant(before, after):
            continue
        events.append(
            _make_event(
                previous,
                current,
                kind=RANK_RISE if after < before else RANK_FALL,
                game_id=int(after_row["game_id"]),
                before=before,
                after=after,
                platform=after_row["platform"],
                chart=after_row["chart"],
                rule=_rank_rule(before),
            )
        )

    seen_keys = set(previous.get("seen_appearance_keys", []))
    for key in sorted(current_keys - previous_keys):
        appearance = current_appearances[key]
        reentered = key in seen_keys
        events.append(
            _make_event(
                previous,
                current,
                kind=REENTERED if reentered else ENTERED,
                game_id=int(appearance["game_id"]),
                before=None,
                after=int(appearance["rank"]),
                platform=appearance["platform"],
                chart=appearance["chart"],
                rule="seen_appearance" if reentered else "first_appearance",
            )
        )

    for key in sorted(previous_keys - current_keys):
        appearance = previous_appearances[key]
        if not _absence_is_trustworthy(previous, current, appearance):
            suppressed_negative_event_count += 1
            continue
        events.append(
            _make_event(
                previous,
                current,
                kind=EXITED,
                game_id=int(appearance["game_id"]),
                before=int(appearance["rank"]),
                after=None,
                platform=appearance["platform"],
                chart=appearance["chart"],
                rule="complete_chart_absence",
            )
        )

    previous_game_ids = {int(game_id) for game_id in previous.get("games", {})}
    current_game_ids = {int(game_id) for game_id in current.get("games", {})}
    for game_id in sorted(previous_game_ids & current_game_ids):
        before = _normalized_score((_game(previous, game_id) or {}).get("score"))
        after = _normalized_score((_game(current, game_id) or {}).get("score"))
        if before is None or after is None or abs(after - before) < Decimal("0.1"):
            continue
        events.append(
            _make_event(
                previous,
                current,
                kind=SCORE_RISE if after > before else SCORE_FALL,
                game_id=game_id,
                before=float(before),
                after=float(after),
                platform=None,
                chart=None,
                rule="score_delta_0.1",
            )
        )

    previous_coverage = _coverage(previous_appearances)
    current_coverage = _coverage(current_appearances)
    coverage_game_ids = previous_game_ids | current_game_ids | set(previous_coverage) | set(current_coverage)
    for game_id in sorted(coverage_game_ids):
        before_keys = previous_coverage.get(game_id, set())
        after_keys = current_coverage.get(game_id, set())
        before = len(before_keys)
        after = len(after_keys)
        if after > before:
            events.append(
                _make_event(
                    previous,
                    current,
                    kind=COVERAGE_INCREASE,
                    game_id=game_id,
                    before=before,
                    after=after,
                    platform=None,
                    chart=None,
                    rule="chart_coverage_change",
                )
            )
        elif after < before:
            removed = before_keys - after_keys
            trustworthy = all(
                _absence_is_trustworthy(previous, current, previous_appearances[key])
                for key in removed
            )
            if not trustworthy:
                suppressed_negative_event_count += 1
                continue
            events.append(
                _make_event(
                    previous,
                    current,
                    kind=COVERAGE_DECREASE,
                    game_id=game_id,
                    before=before,
                    after=after,
                    platform=None,
                    chart=None,
                    rule="complete_chart_coverage_change",
                )
            )

    return events, suppressed_negative_event_count


def event_importance(event: dict) -> int:
    """Return a bounded deterministic score used to order feed events."""

    base = {
        RANK_RISE: 50,
        RANK_FALL: 50,
        ENTERED: 68,
        REENTERED: 64,
        EXITED: 70,
        SCORE_RISE: 54,
        SCORE_FALL: 54,
        COVERAGE_INCREASE: 46,
        COVERAGE_DECREASE: 46,
    }.get(event.get("kind"), 20)
    score = base + (5 if event.get("scope") == "made" else 0)
    before = event.get("before")
    after = event.get("after")

    if event.get("kind") in {RANK_RISE, RANK_FALL, ENTERED, REENTERED, EXITED}:
        ranks = [value for value in (before, after) if isinstance(value, int) and not isinstance(value, bool)]
        if ranks:
            best_rank = min(ranks)
            score += 20 if best_rank <= 10 else 10 if best_rank <= 50 else 0
        if isinstance(before, int) and isinstance(after, int):
            score += min(abs(before - after), 15)
    elif event.get("kind") in {SCORE_RISE, SCORE_FALL}:
        if isinstance(before, (int, float)) and isinstance(after, (int, float)):
            score += min(int(round(abs(after - before) * 10)), 15)
    elif event.get("kind") in {COVERAGE_INCREASE, COVERAGE_DECREASE}:
        if isinstance(before, int) and isinstance(after, int):
            score += min(abs(after - before) * 3, 15)

    return min(score, 100)
