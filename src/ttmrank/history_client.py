"""Optional Cloudflare history integration. Failures never block static publication."""

from __future__ import annotations

import json
from collections import defaultdict
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class HistoryClient:
    def __init__(self, endpoint: str, token: str = "", timeout: int = 20) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.timeout = timeout

    def ingest(self, games: list[dict], captured_at: int) -> bool:
        if not self.endpoint or not self.token:
            return False
        captured_hour = captured_at - captured_at % 3600
        snapshots = [{"game_id": game["id"], "captured_hour": captured_hour, "heat": game.get("heat"), "score": game.get("score")} for game in games]
        request = Request(f"{self.endpoint}/v1/snapshots", data=json.dumps({"snapshots": snapshots}).encode(), method="POST", headers={"Content-Type":"application/json","X-Ingest-Token":self.token})
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return response.status == 200
        except Exception:
            return False

    def baselines(self, game_ids: list[int], at: int) -> dict:
        if not self.endpoint or not game_ids:
            return {}
        query=urlencode({"game_ids":",".join(map(str,game_ids[:100])),"at":at})
        try:
            with urlopen(f"{self.endpoint}/v1/baselines?{query}",timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            return {}

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
