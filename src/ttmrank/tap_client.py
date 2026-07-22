"""HTTP client for TapTap ranking and detail endpoints."""

from __future__ import annotations

import json
import random
import time
from typing import Callable
from urllib.error import HTTPError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

from .config import RANK_TYPES
from .models import CollectionResult

BASE_URL = "https://www.taptap.cn/webapiv2/app-top/v2/hits"
DETAIL_URL = "https://www.taptap.cn/webapiv2/app/v6/detail"
X_UA_TEMPLATE = "V=1&PN=WebApp&LANG=zh_CN&VN_CODE=105&VN=0.1.0&LOC=CN&PLT=PC&DS={device}&UID=&DT=PC"
X_UA = X_UA_TEMPLATE.format(device="Android")
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

    @staticmethod
    def _x_ua(platform: str) -> str:
        return X_UA_TEMPLATE.format(device="iOS" if platform == "ios" else "Android")

    @staticmethod
    def _next_offset(next_page: object, current_offset: int) -> int | None:
        if not isinstance(next_page, str) or not next_page:
            return None
        try:
            value = int(parse_qs(urlparse(next_page).query)["from"][0])
        except (KeyError, IndexError, TypeError, ValueError):
            return None
        return value if value > current_offset else None

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
        expected_total: int | None = None
        finished = False

        for _page in range(self.max_pages):
            if limit is not None and len(items) >= limit:
                break
            page_limit = min(self.page_size, limit - len(items)) if limit is not None else self.page_size
            url = (
                f"{BASE_URL}?X-UA={quote(self._x_ua(platform), safe='')}&platform={platform}"
                f"&type_name={chart}&from={offset}&limit={page_limit}"
            )
            payload, error, used_attempts = self._get_json(Request(url, headers=HEADERS))
            attempts += used_attempts
            if payload is None:
                return CollectionResult(ok=False, error=error or "request failed", attempts=attempts)
            if not payload.get("success"):
                message = payload.get("data", {}).get("msg", "TapTap API returned success=false")
                return CollectionResult(ok=False, error=message, attempts=attempts)

            data = payload.get("data", {})
            page_items = data.get("list", [])
            if not isinstance(page_items, list):
                return CollectionResult(ok=False, error="TapTap ranking list was not an array", attempts=attempts)
            metadata = {**metadata, **data}
            total_value = data.get("total")
            if type(total_value) is int and total_value >= 0:
                if expected_total is None:
                    expected_total = total_value
                elif expected_total != total_value:
                    return CollectionResult(
                        ok=False,
                        error=f"TapTap ranking total changed during pagination: {expected_total} to {total_value}",
                        attempts=attempts,
                    )
            added = 0
            for page_index, entry in enumerate(page_items):
                app_id = entry.get("app", {}).get("id")
                if app_id and app_id not in seen_ids:
                    seen_ids.add(app_id)
                    items.append({**entry, "_source_rank": offset + page_index + 1})
                    added += 1
            next_offset = self._next_offset(data.get("next_page"), offset)
            if next_offset is None:
                finished = True
                break
            offset = next_offset
            self.sleep(0.08)

        if limit is None:
            if expected_total is None:
                return CollectionResult(ok=False, error="TapTap ranking response omitted total", attempts=max(attempts, 1))
            if not finished:
                return CollectionResult(
                    ok=False,
                    error=f"TapTap ranking pagination exceeded {self.max_pages} pages",
                    attempts=max(attempts, 1),
                )
            if len(items) != expected_total:
                return CollectionResult(
                    ok=False,
                    error=f"TapTap ranking incomplete: expected {expected_total} unique games, collected {len(items)}",
                    attempts=max(attempts, 1),
                )

        return CollectionResult(
            ok=True,
            data={
                "title": metadata.get("title", RANK_TYPES.get(chart, chart)),
                "description": metadata.get("description", ""),
                "items": items[:limit],
                "total": expected_total if expected_total is not None else len(items),
                "complete": limit is None and finished and len(items) == expected_total,
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

