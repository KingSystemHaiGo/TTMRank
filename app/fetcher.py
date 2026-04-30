#!/usr/bin/env python3
"""TapTap 排行榜数据抓取脚本 - 双平台 + TapTap制造 + 并发优化 + 缓存 + 历史"""

import json
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

BASE_URL = "https://www.taptap.cn/webapiv2/app-top/v2/hits"
X_UA = "V=1&PN=WebApp&LANG=zh_CN&VN_CODE=105&VN=0.1.0&LOC=CN&PLT=PC&DS=Android&UID=&DT=PC"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    "Referer": "https://www.taptap.cn/top",
    "Accept": "application/json",
}

RANK_TYPES = {
    "hot":         {"name": "热门榜"},
    "sell":        {"name": "热卖榜"},
    "reserve":     {"name": "预约榜"},
    "new":         {"name": "新品榜"},
    "action":      {"name": "动作榜"},
    "strategy":    {"name": "策略榜"},
    "shooter":     {"name": "射击榜"},
    "roguelike":   {"name": "Roguelike"},
    "casual":      {"name": "休闲榜"},
    "independent": {"name": "独立榜"},
    "acgn":        {"name": "二次元榜"},
    "otome":       {"name": "乙女榜"},
    "music":       {"name": "音乐榜"},
    "idle":        {"name": "放置榜"},
}

PLATFORMS = ["android", "ios"]
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
HISTORY_DIR = os.path.join(DATA_DIR, "history")
MAX_WORKERS = 8


def load_cache() -> dict:
    """加载已有缓存作为 fallback"""
    cache_path = os.path.join(DATA_DIR, "rankings.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def fetch_with_retry(req: Request, timeout: int = 30, retries: int = 3) -> dict:
    """带重试的 HTTP GET，返回 JSON"""
    last_err = None
    for attempt in range(retries):
        try:
            with urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            if e.code in (429, 502, 503, 504):
                wait = 0.5 * (2 ** attempt)
                print(f"      HTTP {e.code}, retry in {wait:.1f}s...")
                time.sleep(wait)
                last_err = e
                continue
            raise
        except Exception as e:
            wait = 0.3 * (2 ** attempt)
            time.sleep(wait)
            last_err = e
    raise last_err


def fetch_ranking(platform: str, type_name: str, limit: int = 100) -> dict:
    """抓取单个排行榜数据"""
    items_all = []
    seen_ids = set()
    meta = {}
    offset = 0
    max_pages = (limit + 14) // 15 + 1

    for _ in range(max_pages):
        if len(items_all) >= limit:
            break
        page_limit = min(15, limit - len(items_all))
        url = f"{BASE_URL}?X-UA={quote(X_UA, safe='')}&platform={platform}&type_name={type_name}&from={offset}&limit={page_limit}"
        req = Request(url, headers=HEADERS)

        try:
            data = fetch_with_retry(req, timeout=30, retries=3)
        except HTTPError as e:
            print(f"    [{platform}/{type_name}] HTTP {e.code}: {e.reason}")
            break
        except Exception as e:
            print(f"    [{platform}/{type_name}] Error: {e}")
            break

        if not data.get("success"):
            msg = data.get("data", {}).get("msg", "unknown")
            print(f"    [{platform}/{type_name}] API error: {msg}")
            break

        page_list = data.get("data", {}).get("list", [])
        if not page_list:
            break

        meta = data.get("data", {})
        added = 0
        for entry in page_list:
            app_id = entry.get("app", {}).get("id")
            if app_id and app_id not in seen_ids:
                seen_ids.add(app_id)
                items_all.append(entry)
                added += 1

        offset += len(page_list)
        if len(page_list) < page_limit or added == 0:
            break
        time.sleep(0.08)

    return {
        "title": meta.get("title", RANK_TYPES[type_name]["name"]),
        "description": meta.get("description", ""),
        "items": [extract_app(entry, idx) for idx, entry in enumerate(items_all[:limit], start=1)],
    }


def extract_app(entry: dict, rank: int) -> dict:
    """提取游戏数据"""
    app = entry.get("app", {})
    stat = app.get("stat", {})
    rating = stat.get("rating", {})
    tags = [t.get("value", "") for t in app.get("tags", [])]
    count_val = stat.get("hits_total", 0)
    reserve_val = stat.get("reserve_count", 0)

    dev = ""
    if app.get("developer"):
        dev = app["developer"].get("name", "")
    if not dev and app.get("developers"):
        dev = app["developers"][0].get("name", "")
    if not dev and app.get("studio"):
        dev = app["studio"].get("name", "")
    if not dev and app.get("authors"):
        dev = app["authors"][0].get("name", "")
    if not dev and app.get("publisher"):
        dev = app["publisher"].get("name", "")
    if not dev and app.get("company"):
        dev = app["company"].get("name", "")

    return {
        "rank": rank,
        "id": app.get("id"),
        "title": app.get("title", "未知"),
        "icon": app.get("icon", {}).get("url", ""),
        "score": rating.get("score", "-"),
        "tags": tags[:2],
        "count": count_val,
        "reserve": reserve_val,
        "count_str": format_count(count_val),
        "count_label": "热度",
        "hints": app.get("hints", [])[:1],
        "url": f"https://www.taptap.cn/app/{app.get('id')}",
        "platforms": [p.get("key", "") for p in app.get("supported_platforms", [])],
        "released_time": app.get("released_time"),
        "developer": dev or "未知",
    }


def format_count(n: int) -> str:
    if n >= 100000000:
        return f"{n / 100000000:.1f}亿"
    if n >= 10000:
        return f"{n / 10000:.1f}万"
    return str(n)


def fetch_app_detail(app_id: int) -> dict:
    """从游戏详情页 API 获取准确开发者信息（带重试）"""
    url = f"https://www.taptap.cn/webapiv2/app/v6/detail?X-UA={quote(X_UA, safe='')}&id={app_id}"
    req = Request(url, headers={
        "User-Agent": HEADERS["User-Agent"],
        "Referer": f"https://www.taptap.cn/app/{app_id}",
        "Accept": "application/json",
    })
    for attempt in range(2):
        try:
            with urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data.get("success"):
                app = data.get("data", {}).get("app", {})
                devs = app.get("developers", [])
                if devs:
                    return {"developer": devs[0].get("name", "未知"), "ok": True}
            break
        except HTTPError as e:
            if e.code in (429, 502, 503, 504) and attempt == 0:
                time.sleep(0.5)
                continue
            if attempt == 0:
                print(f"    Detail HTTP {e.code}: {e.reason}")
        except Exception as e:
            if attempt == 0:
                print(f"    Detail error: {e}")
    return {"developer": "未知", "ok": False}


def patch_developers(rankings: dict, max_workers: int = 8):
    """为每个榜单前 20 名中 developer == '未知' 的游戏并发获取详情补充开发者"""
    id_to_items = {}
    for platform, charts in rankings.items():
        for chart_key, chart_data in charts.items():
            for item in chart_data.get("items", [])[:20]:
                if item.get("developer") == "未知" and item.get("id"):
                    gid = item["id"]
                    if gid not in id_to_items:
                        id_to_items[gid] = []
                    id_to_items[gid].append(item)
    if not id_to_items:
        return
    print(f"\n=== Patching {len(id_to_items)} unique developers (top 20 each chart) ===")
    patched = 0
    with ThreadPoolExecutor(max_workers=max_workers) as exe:
        futs = {exe.submit(fetch_app_detail, gid): gid for gid in id_to_items}
        for fut in as_completed(futs):
            gid = futs[fut]
            try:
                detail = fut.result()
                if detail.get("ok") and detail.get("developer") != "未知":
                    for item in id_to_items[gid]:
                        item["developer"] = detail["developer"]
                    patched += 1
            except Exception:
                pass
    print(f"  -> patched {patched} developers")


def find_best_rank(game_id: int, all_rankings: dict) -> dict:
    """在所有榜单中查找游戏的最高排名"""
    best = {"rank": 9999, "chart": "", "platform": ""}
    for platform, charts in all_rankings.items():
        for chart_key, chart_data in charts.items():
            for item in chart_data.get("items", []):
                if item.get("id") == game_id:
                    if item.get("rank", 9999) < best["rank"]:
                        best = {
                            "rank": item["rank"],
                            "chart": chart_data.get("title", RANK_TYPES.get(chart_key, {}).get("name", chart_key)),
                            "platform": "安卓" if platform == "android" else "iOS",
                        }
    return best if best["rank"] != 9999 else None


def save_history(result: dict):
    """保存历史快照"""
    os.makedirs(HISTORY_DIR, exist_ok=True)
    ts = result["updated_at"].replace(":", "-")
    hist_path = os.path.join(HISTORY_DIR, f"{ts}.json")
    with open(hist_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    # 只保留最近 30 份历史
    files = sorted(os.listdir(HISTORY_DIR))
    for old in files[:-30]:
        os.remove(os.path.join(HISTORY_DIR, old))


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    tz8 = timezone(timedelta(hours=8))
    start_time = time.time()

    # 尝试加载旧缓存作为兜底
    cache = load_cache()

    result = {
        "updated_at": datetime.now(tz8).strftime("%Y-%m-%d %H:%M:%S"),
        "platforms": {},
        "taptap_made": [],
    }

    # 1. 并发抓取所有平台的所有分类榜单
    print("=== Fetching all rankings (concurrent) ===")
    tasks = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as exe:
        for platform in PLATFORMS:
            result["platforms"][platform] = {}
            for type_name in RANK_TYPES:
                tasks.append((platform, type_name, exe.submit(fetch_ranking, platform, type_name, 100)))

        for platform, type_name, fut in tasks:
            try:
                ranking = fut.result()
                if ranking:
                    result["platforms"][platform][type_name] = ranking
                    print(f"  [{platform}] {RANK_TYPES[type_name]['name']}: {len(ranking['items'])} items")
            except Exception as e:
                print(f"  [{platform}] {RANK_TYPES[type_name]['name']}: failed - {e}")
                # 尝试从缓存恢复该榜单
                if cache.get("platforms", {}).get(platform, {}).get(type_name):
                    result["platforms"][platform][type_name] = cache["platforms"][platform][type_name]
                    print(f"    -> fallback to cache")

    # 2. 从所有榜单中筛选带有 "TapTap制造" 标签的游戏
    print("\n=== Finding TapTap-made games ===")
    taptap_candidates = {}
    for platform, charts in result["platforms"].items():
        for chart_key, chart_data in charts.items():
            for item in chart_data.get("items", []):
                tags = item.get("tags", [])
                if any("TapTap" in t for t in tags):
                    gid = item["id"]
                    if gid not in taptap_candidates:
                        taptap_candidates[gid] = item
    print(f"  -> {len(taptap_candidates)} candidates")

    # 3. 并发抓取每个候选游戏的详情页获取准确开发者
    print("\n=== Fetching details (concurrent) ===")
    detail_results = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as exe:
        futs = {exe.submit(fetch_app_detail, gid): gid for gid in taptap_candidates}
        for fut in as_completed(futs):
            gid = futs[fut]
            try:
                detail_results[gid] = fut.result()
            except Exception as e:
                print(f"  [{gid}] detail error: {e}")
                detail_results[gid] = {"developer": "未知", "ok": False}

    # 计算最高排名并组装 taptap_made
    print("\n=== Computing best ranks ===")
    for gid, game in taptap_candidates.items():
        detail = detail_results.get(gid, {"developer": "未知", "ok": False})
        best = find_best_rank(gid, result["platforms"])
        if best:
            result["taptap_made"].append({
                "id": game["id"],
                "title": game["title"],
                "icon": game["icon"],
                "score": game["score"],
                "tags": game["tags"],
                "developer": detail["developer"],
                "platforms": game["platforms"],
                "best_rank": best["rank"],
                "best_chart": best["chart"],
                "best_platform": best["platform"],
                "url": game["url"],
                "released_time": game["released_time"],
            })

    result["taptap_made"].sort(key=lambda x: x["best_rank"])
    print(f"  -> {len(result['taptap_made'])} games with rank data")

    # 4. 补充榜单前20名的开发者信息
    patch_developers(result["platforms"], max_workers=MAX_WORKERS)

    # 保存
    out_path = os.path.join(DATA_DIR, "rankings.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    save_history(result)

    elapsed = time.time() - start_time
    print(f"\nSaved to {out_path}")
    total = sum(len(v) for p in result["platforms"].values() for v in p.values())
    print(f"Total ranking entries: {total}")
    print(f"Elapsed: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
