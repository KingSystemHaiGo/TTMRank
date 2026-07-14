"""Optional Cloudflare history integration. Failures never block static publication."""

from __future__ import annotations

import json
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
