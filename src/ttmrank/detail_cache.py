"""Persistent TTL cache for comparatively stable game details."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Callable


class DetailCache:
    BACKOFF_SECONDS = (3_600, 21_600, 86_400)

    def __init__(
        self,
        path: Path,
        *,
        ttl_seconds: int = 7 * 86_400,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.path = path
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self.entries = self._load()

    def _load(self) -> dict[str, dict]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        temp.write_text(json.dumps(self.entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        os.replace(temp, self.path)

    def get_or_fetch(self, game_id: int, fetcher: Callable[[int], dict]) -> dict:
        key = str(game_id)
        now = int(self.clock())
        entry = self.entries.get(key)
        if entry:
            if entry.get("ok") and now - entry.get("fetched_at", 0) < self.ttl_seconds:
                return entry["data"]
            if not entry.get("ok") and now < entry.get("retry_after", 0):
                return entry.get("data", {"ok": False, "developer": "未知", "tags": []})

        result = fetcher(game_id)
        if result.get("ok"):
            self.entries[key] = {"ok": True, "fetched_at": now, "failures": 0, "data": result}
        else:
            failures = min((entry or {}).get("failures", 0) + 1, len(self.BACKOFF_SECONDS))
            backoff = self.BACKOFF_SECONDS[failures - 1]
            self.entries[key] = {
                "ok": False,
                "fetched_at": now,
                "failures": failures,
                "retry_after": now + backoff,
                "data": result,
            }
        self._save()
        return result

