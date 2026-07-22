"""Optional Cloudflare history integration. Failures never block static publication."""

from __future__ import annotations

import json
import math
import subprocess
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from .exporters import AtomicPublisher


def _payload_points(payload: dict) -> list[dict]:
    value = payload.get("updated_at")
    if not value:
        return []
    try:
        captured_at = int(datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=ZoneInfo("Asia/Shanghai")).timestamp())
    except (TypeError, ValueError):
        return []
    games: dict[int, dict] = {}
    for charts in payload.get("platforms", {}).values():
        for chart in charts.values():
            for item in chart.get("items", []):
                game_id = item.get("id")
                heat = item.get("count")
                if isinstance(game_id, int) and isinstance(heat, (int, float)):
                    games[game_id] = {"game_id": game_id, "captured_hour": captured_at, "heat": heat, "score": item.get("score")}
    return list(games.values())


class HistoryClient:
    def __init__(self, endpoint: str, token: str = "", timeout: int = 20) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.last_ingest_status = "not_configured"
        self.last_archive_status = "not_configured"

    def ingest_status(self) -> dict[str, bool | str]:
        return {
            "configured": bool(self.endpoint and self.token),
            "status": self.last_ingest_status,
        }

    def archive_status(self) -> dict[str, bool | str]:
        return {
            "configured": bool(self.endpoint and self.token),
            "status": self.last_archive_status,
        }

    def ingest(self, games: list[dict], captured_at: int) -> bool:
        if not self.endpoint or not self.token:
            self.last_ingest_status = "not_configured"
            return False
        captured_hour = captured_at - captured_at % 3600
        snapshots = [{"game_id": game["id"], "captured_hour": captured_hour, "heat": game.get("heat"), "score": game.get("score")} for game in games]
        request = Request(f"{self.endpoint}/v1/snapshots", data=json.dumps({"snapshots": snapshots}).encode(), method="POST", headers={"Content-Type":"application/json","X-Ingest-Token":self.token})
        try:
            with urlopen(request, timeout=self.timeout) as response:
                success = response.status == 200
        except Exception:
            success = False
        self.last_ingest_status = "success" if success else "failed"
        return success

    def baselines(self, game_ids: list[int], at: int) -> dict:
        if not self.endpoint or not game_ids:
            return {}
        query=urlencode({"game_ids":",".join(map(str,game_ids[:100])),"at":at})
        try:
            with urlopen(f"{self.endpoint}/v1/baselines?{query}",timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            return {}

    def archive_events(self, events: list[dict]) -> bool:
        """Append change events to the optional idempotent D1 ledger."""

        if not self.endpoint or not self.token:
            self.last_archive_status = "not_configured"
            return False
        if not events:
            self.last_archive_status = "success"
            return True
        try:
            for offset in range(0, len(events), 500):
                request = Request(
                    f"{self.endpoint}/v1/events",
                    data=json.dumps(
                        {"events": events[offset:offset + 500]},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode("utf-8"),
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "X-Ingest-Token": self.token,
                    },
                )
                with urlopen(request, timeout=self.timeout) as response:
                    if response.status != 200:
                        self.last_archive_status = "failed"
                        return False
        except Exception:
            self.last_archive_status = "failed"
            return False
        self.last_archive_status = "success"
        return True

    def events(self, since: int, scope: str = "made", limit: int = 500) -> list[dict]:
        """Read a bounded slice of the optional event archive."""

        if not self.endpoint:
            return []
        bounded_limit = min(max(int(limit), 1), 500)
        query = urlencode({"since": int(since), "scope": scope, "limit": bounded_limit})
        try:
            with urlopen(f"{self.endpoint}/v1/events?{query}", timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            return []
        rows = payload.get("events", []) if isinstance(payload, dict) else []
        return rows if isinstance(rows, list) and all(isinstance(row, dict) for row in rows) else []

    @staticmethod
    def metrics_from_points(games: list[dict], at: int, points: list[dict]) -> dict[int, dict]:
        by_game: dict[int, list[dict]] = defaultdict(list)
        for point in points:
            if isinstance(point.get("game_id"), int) and isinstance(point.get("captured_hour"), int) and isinstance(point.get("heat"), (int, float)):
                by_game[point["game_id"]].append(point)

        targets = {
            "heat_delta_1h": (3600, 40 * 60),
            "heat_delta_24h": (24 * 3600, 3 * 3600),
            "heat_delta_7d": (7 * 86400, 12 * 3600),
        }
        result: dict[int, dict] = {}
        for game in games:
            game_id = game.get("id")
            current_heat = game.get("heat")
            if not isinstance(game_id, int) or not isinstance(current_heat, (int, float)):
                continue
            values = {}
            for field, (age, tolerance) in targets.items():
                target = at - age
                candidates = [point for point in by_game.get(game_id, []) if target - tolerance <= point["captured_hour"] <= target]
                if not candidates:
                    continue
                baseline = max(candidates, key=lambda point: point["captured_hour"])
                values[field] = current_heat - baseline["heat"]
                if field == "heat_delta_24h":
                    interval_hours = (at - baseline["captured_hour"]) / 3600
                    if interval_hours > 0:
                        values["growth_per_hour_24h"] = values[field] / interval_hours
            if values:
                result[game_id] = values
        return result

    def metrics(self, games: list[dict], at: int) -> dict[int, dict]:
        points: list[dict] = []
        game_ids = [game["id"] for game in games if isinstance(game.get("id"), int)]
        for offset in range(0, len(game_ids), 100):
            response = self.baselines(game_ids[offset:offset + 100], at)
            rows = response.get("points", []) if isinstance(response, dict) else []
            if isinstance(rows, list):
                points.extend(rows)
        return self.metrics_from_points(games, at, points)


class RollingHistoryClient:
    """Bounded hourly heat history stored outside the published site."""

    SCHEMA_VERSION = "1.0"
    BUCKET_SECONDS = 20 * 60
    RETENTION_SECONDS = 8 * 86_400

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.last_ingest_status = "not_started"

    def ingest_status(self) -> dict[str, bool | str]:
        return {
            "configured": True,
            "status": self.last_ingest_status,
            "backend": "actions_cache",
        }

    @classmethod
    def _valid_bucket(cls, value) -> bool:
        if not isinstance(value, dict):
            return False
        captured_hour = value.get("captured_hour")
        games = value.get("games")
        if not isinstance(captured_hour, int) or captured_hour % cls.BUCKET_SECONDS != 0:
            return False
        if not isinstance(games, list):
            return False
        return all(
            isinstance(row, list)
            and len(row) in {2, 3}
            and isinstance(row[0], int)
            and row[0] > 0
            and isinstance(row[1], (int, float))
            and not isinstance(row[1], bool)
            and math.isfinite(row[1])
            and row[1] >= 0
            and (len(row) == 2 or row[2] is None or (
                isinstance(row[2], (int, float))
                and not isinstance(row[2], bool)
                and math.isfinite(row[2])
            ))
            for row in games
        )

    def _load_buckets(self) -> list[dict]:
        try:
            state = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return []
        if not isinstance(state, dict):
            return []
        buckets = state.get("buckets")
        if state.get("schema_version") != self.SCHEMA_VERSION or not isinstance(buckets, list):
            return []
        if not all(self._valid_bucket(bucket) for bucket in buckets):
            return []
        unique = {bucket["captured_hour"]: bucket for bucket in buckets}
        return [unique[key] for key in sorted(unique)]

    @staticmethod
    def _compact_games(games: list[dict]) -> list[list]:
        rows: dict[int, list] = {}
        for game in games:
            game_id = game.get("id")
            heat = game.get("heat")
            score = game.get("score")
            if not isinstance(game_id, int) or game_id <= 0:
                continue
            if (not isinstance(heat, (int, float)) or isinstance(heat, bool)
                    or not math.isfinite(heat) or heat < 0):
                continue
            normalized_score = score if (
                isinstance(score, (int, float))
                and not isinstance(score, bool)
                and math.isfinite(score)
            ) else None
            rows[game_id] = [game_id, heat, normalized_score]
        return [rows[game_id] for game_id in sorted(rows)]

    def metrics(self, games: list[dict], at: int) -> dict[int, dict]:
        game_ids = {game.get("id") for game in games if isinstance(game.get("id"), int)}
        points = []
        for bucket in self._load_buckets():
            for game_id, heat, *score in bucket["games"]:
                if game_id not in game_ids:
                    continue
                points.append({
                    "game_id": game_id,
                    "captured_hour": bucket["captured_hour"],
                    "heat": heat,
                    "score": score[0] if score else None,
                })
        return HistoryClient.metrics_from_points(games, at, points)

    def ingest(self, games: list[dict], captured_at: int) -> bool:
        if not isinstance(captured_at, int) or captured_at <= 0:
            self.last_ingest_status = "failed"
            return False
        captured_hour = captured_at - captured_at % self.BUCKET_SECONDS
        cutoff = captured_hour - self.RETENTION_SECONDS
        buckets = {
            bucket["captured_hour"]: bucket
            for bucket in self._load_buckets()
            if cutoff <= bucket["captured_hour"] <= captured_hour
        }
        buckets[captured_hour] = {
            "captured_hour": captured_hour,
            "games": self._compact_games(games),
        }
        state = {
            "schema_version": self.SCHEMA_VERSION,
            "buckets": [buckets[key] for key in sorted(buckets)],
        }
        try:
            AtomicPublisher(self.path.parent).publish_json(self.path.name, state)
        except OSError:
            self.last_ingest_status = "failed"
            return False
        self.last_ingest_status = "success"
        return True


class LayeredHistoryClient:
    """Prefer durable remote history while continuously advancing local fallback."""

    def __init__(self, primary, fallback: RollingHistoryClient) -> None:
        self.primary = primary
        self.fallback = fallback

    def metrics(self, games: list[dict], at: int) -> dict[int, dict]:
        fallback_metrics = self.fallback.metrics(games, at)
        primary_metrics = self.primary.metrics(games, at)
        merged = {game_id: dict(values) for game_id, values in fallback_metrics.items()}
        for game_id, values in primary_metrics.items():
            merged.setdefault(game_id, {}).update(values)
        return merged

    def ingest(self, games: list[dict], captured_at: int) -> bool:
        fallback_ok = self.fallback.ingest(games, captured_at)
        primary_ok = self.primary.ingest(games, captured_at)
        return primary_ok and fallback_ok

    def ingest_status(self) -> dict[str, bool | str]:
        status = dict(self.primary.ingest_status())
        status["fallback"] = self.fallback.ingest_status().get("status", "unknown")
        return status

    def archive_events(self, events: list[dict]) -> bool:
        archive = getattr(self.primary, "archive_events", None)
        return bool(archive(events)) if callable(archive) else False

    def archive_status(self) -> dict[str, bool | str]:
        status = getattr(self.primary, "archive_status", None)
        return status() if callable(status) else {"configured": False, "status": "not_configured"}


class GitHistoryClient:
    """Compatibility fallback for local runs without configured D1 history."""

    TARGETS = ((3600, 40 * 60), (24 * 3600, 3 * 3600), (7 * 86400, 12 * 3600))

    def __init__(self, repository: Path, data_path: str = "app/data/rankings.json") -> None:
        self.repository = repository
        self.data_path = data_path
        self.last_ingest_status = "not_configured"

    def ingest_status(self) -> dict[str, bool | str]:
        return {"configured": False, "status": self.last_ingest_status}

    def _run(self, *args: str) -> str:
        result = subprocess.run(["git", *args], cwd=self.repository, check=True, capture_output=True, text=True, encoding="utf-8")
        return result.stdout

    def _baseline_payload(self, target: int, tolerance: int) -> dict | None:
        before = datetime.fromtimestamp(target + tolerance, ZoneInfo("UTC")).isoformat()
        try:
            commits = self._run("log", "--format=%H", f"--before={before}", "--", self.data_path).splitlines()
        except (OSError, subprocess.CalledProcessError):
            return None
        best: tuple[int, dict] | None = None
        for commit in commits[:30]:
            try:
                payload = json.loads(self._run("show", f"{commit}:{self.data_path}"))
                points = _payload_points(payload)
            except (subprocess.CalledProcessError, json.JSONDecodeError):
                continue
            if not points:
                continue
            captured_at = points[0]["captured_hour"]
            if target - tolerance <= captured_at <= target:
                if best is None or captured_at > best[0]:
                    best = captured_at, payload
            if captured_at < target - tolerance:
                break
        return best[1] if best else None

    def metrics(self, games: list[dict], at: int) -> dict[int, dict]:
        if not (self.repository / ".git").exists():
            return {}
        points: list[dict] = []
        for age, tolerance in self.TARGETS:
            payload = self._baseline_payload(at - age, tolerance)
            if payload:
                points.extend(_payload_points(payload))
        return HistoryClient.metrics_from_points(games, at, points)

    def ingest(self, games: list[dict], captured_at: int) -> bool:
        return False
