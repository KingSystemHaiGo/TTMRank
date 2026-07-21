"""Detect meaningful, quality-gated changes between ranking observations."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from .exporters import AtomicPublisher


RANK_RISE = "rank_rise"
RANK_FALL = "rank_fall"
ENTERED = "entered"
REENTERED = "reentered"
EXITED = "exited"
SCORE_RISE = "score_rise"
SCORE_FALL = "score_fall"
COVERAGE_INCREASE = "coverage_increase"
COVERAGE_DECREASE = "coverage_decrease"

STATE_SCHEMA_VERSION = "1.0"
FEED_SCHEMA_VERSION = "1.0"
FEED_RETENTION_SECONDS = 7 * 86_400
MERGE_WINDOW_SECONDS = 2 * 3_600


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


def _event_first_observed_at(event: dict) -> int:
    return int(event.get("first_observed_at", event.get("observed_at", 0)) or 0)


def _event_last_observed_at(event: dict) -> int:
    return int(event.get("last_observed_at", event.get("observed_at", 0)) or 0)


def _normalized_event(event: dict) -> dict:
    normalized = deepcopy(event)
    first_observed_at = _event_first_observed_at(normalized)
    last_observed_at = _event_last_observed_at(normalized)
    if last_observed_at < first_observed_at:
        first_observed_at, last_observed_at = last_observed_at, first_observed_at
    normalized["first_observed_at"] = first_observed_at
    normalized["last_observed_at"] = last_observed_at
    normalized["observed_at"] = last_observed_at
    normalized["occurrences"] = max(1, int(normalized.get("occurrences", 1) or 1))
    return normalized


def _event_series_key(event: dict) -> tuple:
    kind = event.get("kind")
    if kind in {RANK_RISE, RANK_FALL}:
        series = "rank"
    elif kind in {SCORE_RISE, SCORE_FALL}:
        series = "score"
    elif kind in {COVERAGE_INCREASE, COVERAGE_DECREASE}:
        series = "coverage"
    else:
        series = "appearance"
    return event.get("game_id"), series, event.get("platform"), event.get("chart")


def _merge_event_pair(first: dict, second: dict) -> dict:
    merged = deepcopy(first)
    for key in ("game_title", "game_icon", "game_url", "rule"):
        if second.get(key) not in {None, ""}:
            merged[key] = second[key]
    merged["scope"] = "made" if "made" in {first.get("scope"), second.get("scope")} else "all"
    merged["after"] = second.get("after")
    merged["first_observed_at"] = min(
        _event_first_observed_at(first),
        _event_first_observed_at(second),
    )
    merged["last_observed_at"] = max(
        _event_last_observed_at(first),
        _event_last_observed_at(second),
    )
    merged["observed_at"] = merged["last_observed_at"]
    merged["occurrences"] = int(first.get("occurrences", 1) or 1) + int(
        second.get("occurrences", 1) or 1
    )
    merged["importance"] = event_importance(merged)
    return merged


def merge_events(events: list[dict]) -> list[dict]:
    """Merge consecutive same-direction events observed within two hours."""

    chronological = sorted(
        (_normalized_event(event) for event in events),
        key=lambda event: (
            _event_first_observed_at(event),
            _event_last_observed_at(event),
            str(event.get("id", "")),
        ),
    )
    merged_events: list[dict] = []
    latest_by_series: dict[tuple, int] = {}
    seen_ids: set[str] = set()
    for event in chronological:
        event_id = str(event.get("id", ""))
        if event_id and event_id in seen_ids:
            continue
        if event_id:
            seen_ids.add(event_id)

        series_key = _event_series_key(event)
        candidate_index = latest_by_series.get(series_key)
        candidate = merged_events[candidate_index] if candidate_index is not None else None
        inside_window = bool(
            candidate
            and 0
            <= _event_first_observed_at(event) - _event_last_observed_at(candidate)
            <= MERGE_WINDOW_SECONDS
        )
        if candidate and candidate.get("kind") == event.get("kind") and inside_window:
            merged_events[candidate_index] = _merge_event_pair(candidate, event)
        else:
            merged_events.append(event)
            latest_by_series[series_key] = len(merged_events) - 1

    return sorted(
        merged_events,
        key=lambda event: (
            -_event_last_observed_at(event),
            -int(event.get("importance", 0) or 0),
            str(event.get("id", "")),
        ),
    )


def _state_is_valid(state: Any) -> bool:
    if not isinstance(state, dict) or state.get("schema_version") != STATE_SCHEMA_VERSION:
        return False
    observation = state.get("observation")
    events = state.get("events")
    if not isinstance(observation, dict) or not isinstance(events, list):
        return False
    if not isinstance(observation.get("observed_at"), int):
        return False
    if not all(
        isinstance(observation.get(key), expected_type)
        for key, expected_type in (
            ("updated_at", (str, int)),
            ("games", dict),
            ("appearances", dict),
            ("charts", dict),
            ("seen_appearance_keys", list),
        )
    ):
        return False
    return all(
        isinstance(event, dict)
        and isinstance(event.get("id"), str)
        and isinstance(event.get("kind"), str)
        and isinstance(event.get("game_id"), int)
        and isinstance(event.get("observed_at", event.get("last_observed_at")), int)
        for event in events
    )


def load_state(path: Path | None) -> dict | None:
    """Load a compatible rolling state, treating missing or invalid data as baseline."""

    if path is None:
        return None
    try:
        state = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None
    return state if _state_is_valid(state) else None


def _state_has_incomplete_charts(state: dict) -> bool:
    charts = state.get("charts", {})
    return any(not _chart_is_complete(state, *key.split("|", 1)) for key in charts)


def build_feed(previous_state: dict | None, current_state: dict) -> tuple[dict, dict]:
    """Build the public seven-day feed and the next comparison state."""

    current = deepcopy(current_state)
    previous = previous_state if _state_is_valid(previous_state) else None
    previous_observation = previous["observation"] if previous else None

    seen_appearance_keys = set(current.get("seen_appearance_keys", []))
    seen_appearance_keys.update(current.get("appearances", {}))
    if previous_observation:
        seen_appearance_keys.update(previous_observation.get("seen_appearance_keys", []))
    current["seen_appearance_keys"] = sorted(seen_appearance_keys)

    suppressed_negative_event_count = 0
    if previous_observation:
        detected_events, suppressed_negative_event_count = detect_events(previous_observation, current)
        events = merge_events([*previous.get("events", []), *detected_events])
    else:
        events = []

    generated_at = int(current.get("observed_at", 0) or 0)
    cutoff = generated_at - FEED_RETENTION_SECONDS
    retained_events = [event for event in events if _event_last_observed_at(event) >= cutoff]
    partial = _state_has_incomplete_charts(current) or suppressed_negative_event_count > 0
    comparison_available = previous_observation is not None
    status = "baseline" if not comparison_available else "partial" if partial else "ready"
    feed = {
        "schema_version": FEED_SCHEMA_VERSION,
        "generated_at": generated_at,
        "updated_at": current.get("updated_at", ""),
        "status": status,
        "comparison_available": comparison_available,
        "partial": partial,
        "suppressed_negative_event_count": suppressed_negative_event_count,
        "events": retained_events,
    }
    next_state = {
        "schema_version": STATE_SCHEMA_VERSION,
        "observation": current,
        "events": retained_events,
    }
    return feed, next_state


def write_state_atomic(path: Path, state: dict) -> None:
    """Replace rolling state only after its complete JSON has reached disk."""

    target = Path(path)
    AtomicPublisher(target.parent).publish_json(target.name, state)
