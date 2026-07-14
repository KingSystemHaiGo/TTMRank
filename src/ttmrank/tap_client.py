"""HTTP client for TapTap ranking and detail endpoints."""

from __future__ import annotations

import json
import random
import time
from typing import Callable
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .config import RANK_TYPES
from .models import CollectionResult

BASE_URL = "https://www.taptap.cn/webapiv2/app-top/v2/hits"
DETAIL_URL = "https://www.taptap.cn/webapiv2/app/v6/detail"
X_UA = "V=1&PN=WebApp&LANG=zh_CN&VN_CODE=105&VN=0.1.0&LOC=CN&PLT=PC&DS=Android&UID=&DT=PC"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135 Safari/537.36",
    "Referer": "https://www.taptap.cn/top",
    "Accept": "application/json",
}


class TapTapClient:
    def __init__(
        self,
        *,
        retries: int = 3,
        timeout: int = 30,
        page_size: int = 15,
        max_pages: int = 100,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.retries = retries
        self.timeout = timeout
        self.page_size = page_size
        self.max_pages = max_pages
        self.sleep = sleep

    def _get_json(self, request: Request) -> tuple[dict | None, str | None, int]:
        last_error = "unknown error"
        for attempt in range(1, self.retries + 1):
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read().decode("utf-8")), None, attempt
            except HTTPError as exc:
                last_error = f"HTTP {exc.code}: {exc.reason}"
                retryable = exc.code in {429, 502, 503, 504}
                if not retryable or attempt == self.retries:
                    break
            except Exception as exc:  # network implementations expose multiple error classes
                last_error = str(exc)
                if attempt == self.retries:
                    break
            delay = 0.35 * (2 ** (attempt - 1)) + random.uniform(0, 0.15)
            self.sleep(delay)
        return None, last_error, self.retries

    def fetch_ranking(self, platform: str, chart: str, limit: int | None = None) -> CollectionResult:
        items: list[dict] = []
        seen_ids: set[int] = set()
        metadata: dict = {}
        offset = 0
        attempts = 0

        for _page in range(self.max_pages):
            if limit is not None and len(items) >= limit:
                break
            page_limit = min(self.page_size, limit - len(items)) if limit is not None else self.page_size
            url = (
                f"{BASE_URL}?X-UA={quote(X_UA, safe='')}&platform={platform}"
                f"&type_name={chart}&from={offset}&limit={page_limit}"
            )
            payload, error, used_attempts = self._get_json(Request(url, headers=HEADERS))
            attempts += used_attempts
            if payload is None:
                return CollectionResult(ok=False, error=error or "request failed", attempts=attempts)
            if not payload.get("success"):
                message = payload.get("data", {}).get("msg", "TapTap API returned success=false")
                return CollectionResult(ok=False, error=message, attempts=attempts)

            page_items = payload.get("data", {}).get("list", [])
            metadata = payload.get("data", {})
            if not page_items:
                break
            added = 0
            for entry in page_items:
                app_id = entry.get("app", {}).get("id")
                if app_id and app_id not in seen_ids:
                    seen_ids.add(app_id)
                    items.append(entry)
                    added += 1
            offset += len(page_items)
            if len(page_items) < page_limit or added == 0:
                break
            self.sleep(0.08)

        return CollectionResult(
            ok=True,
            data={
                "title": metadata.get("title", RANK_TYPES.get(chart, chart)),
                "description": metadata.get("description", ""),
                "items": items[:limit],
            },
            attempts=max(attempts, 1),
        )

    def fetch_detail(self, game_id: int) -> dict:
        url = f"{DETAIL_URL}?X-UA={quote(X_UA, safe='')}&id={game_id}"
        payload, error, _attempts = self._get_json(Request(url, headers=HEADERS))
        if payload and payload.get("success"):
            app = payload.get("data", {}).get("app", {})
            developers = app.get("developers", [])
            return {
                "ok": True,
                "developer": developers[0].get("name", "未知") if developers else "未知",
                "tags": [tag.get("value", "") for tag in app.get("tags", []) if tag.get("value")],
            }
        return {"ok": False, "developer": "未知", "tags": [], "error": error or "detail failed"}

