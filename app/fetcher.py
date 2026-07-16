#!/usr/bin/env python3
"""TapTap 排行榜数据抓取脚本 - 双平台 + TapTap制造 + 并发优化 + 缓存 + 历史"""

import json
import re
import os
import shutil
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_ROOT = PROJECT_ROOT / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from ttmrank.detail_cache import DetailCache
from ttmrank.exporters import AtomicPublisher
from ttmrank.history_client import GitHistoryClient, HistoryClient
from ttmrank.normalize import merge_detail_tags
from ttmrank.tap_client import TapTapClient
from ttmrank.validators import validate_chart_sizes

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
CLIENT = TapTapClient()
DETAIL_CACHE = DetailCache(Path(DATA_DIR) / ".cache" / "game-details.json")


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


def split_snapshot_roles(observed: dict, cache: dict) -> tuple[bool, dict, dict]:
    """Keep static ranking writes stable without reusing an old observation time."""

    comparable_observed = {key: value for key, value in observed.items() if key != "updated_at"}
    comparable_cache = {key: value for key, value in cache.items() if key != "updated_at"}
    business_changed = not cache or comparable_observed != comparable_cache
    published = observed if business_changed else cache
    return business_changed, published, observed


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


def fetch_ranking(platform: str, type_name: str, limit: int = None) -> dict:
    """抓取单个排行榜数据"""
    collected = CLIENT.fetch_ranking(platform, type_name, limit)
    if not collected.ok:
        raise RuntimeError(collected.error)
    raw = collected.data or {}
    return {
        "title": raw.get("title", RANK_TYPES[type_name]["name"]),
        "description": raw.get("description", ""),
        "source": "live",
        "items": [extract_app(entry, idx) for idx, entry in enumerate(raw.get("items", []), start=1)],
    }


def extract_app(entry: dict, rank: int, detail_tags: list = None) -> dict:
    """提取游戏数据"""
    app = entry.get("app", {})
    stat = app.get("stat", {})
    rating = stat.get("rating", {})
    tags = merge_detail_tags([t.get("value", "") for t in app.get("tags", [])], detail_tags)
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
        "tags": tags,
        "count": count_val,
        "reserve": reserve_val,
        "review_count": None,  # 由 fetch_app_detail 补充
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
    """获取稳定详情字段；HTML 评论抓取已停用，详情使用 TTL 缓存。"""
    result = DETAIL_CACHE.get_or_fetch(app_id, CLIENT.fetch_detail)
    return {**result, "review_count": None}


def _fetch_review_count(app_id: int) -> int | None:
    """从游戏详情页 HTML 抓取评论数
    
    页面文本中有固定格式 "评价 {数字}"，用正则 /评价\s*(\d[\d,]*)/ 抓取。
    列表页或详情页导航栏都有这个数据，不需要进评价详情页。
    
    测试验证：
    - 星绘友晴天 (app 756412): 评价 2768 条
    - app 220156: 评价 9 条
    """
    url = f"https://www.taptap.cn/app/{app_id}"
    req = Request(url, headers={
        "User-Agent": HEADERS["User-Agent"],
        "Referer": "https://www.taptap.cn/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    for attempt in range(2):
        try:
            with urlopen(req, timeout=10) as resp:
                html = resp.read().decode("utf-8")
            # 正则匹配 "评价 2768" 格式（支持逗号分隔的数字）
            match = re.search(r'评价\s*(\d[\d,]*)', html)
            if match:
                count_str = match.group(1).replace(',', '')
                return int(count_str)
            # 如果没匹配到，返回 None（可能页面结构不同或被拦截）
            return None
        except HTTPError as e:
            if e.code in (429, 502, 503, 504) and attempt == 0:
                time.sleep(0.5)
                continue
            # WAF 405 或其他错误，静默返回 None
            return None
        except Exception:
            return None
    return None


def _fetch_app_detail_api(app_id: int) -> dict:
    """从 v6 detail API 获取开发者和标签"""
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
                tags = [t.get("value", "") for t in app.get("tags", [])]
                return {
                    "developer": devs[0].get("name", "未知") if devs else "未知",
                    "tags": tags,
                    "ok": True
                }
            break
        except HTTPError as e:
            if e.code in (429, 502, 503, 504) and attempt == 0:
                time.sleep(0.5)
                continue
            if attempt == 0:
                print(f"    Detail API HTTP {e.code}: {e.reason}")
        except Exception as e:
            if attempt == 0:
                print(f"    Detail API error: {e}")
    return {"developer": "未知", "tags": [], "review_count": None, "ok": False}


def patch_developers(rankings: dict, detail_results: dict, taptap_made: list = None):
    """使用已获取的详情结果补充榜单中所有未知开发者，以及 taptap_made 列表"""
    id_to_items = {}
    # 遍历所有榜单的所有条目（不限前20）
    for platform, charts in rankings.items():
        for chart_key, chart_data in charts.items():
            for item in chart_data.get("items", []):
                if item.get("developer") == "未知" and item.get("id"):
                    gid = item["id"]
                    if gid not in id_to_items:
                        id_to_items[gid] = []
                    id_to_items[gid].append(item)
    # 也补 taptap_made 列表
    if taptap_made:
        for tm in taptap_made:
            if tm.get("developer") == "未知" and tm.get("id"):
                gid = tm["id"]
                if gid not in id_to_items:
                    id_to_items[gid] = []
                id_to_items[gid].append(tm)
    if not id_to_items:
        return
    print(f"\n=== Patching {len(id_to_items)} unique developers (all charts + taptap_made) ===")
    patched = 0
    for gid, items in id_to_items.items():
        detail = detail_results.get(gid, {})
        if detail.get("ok") and detail.get("developer") != "未知":
            for item in items:
                item["developer"] = detail["developer"]
            patched += 1
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
    """兼容的本地调试历史；生产默认关闭，小时历史写入 D1。"""
    if os.environ.get("TTMRANK_LEGACY_HISTORY") != "1":
        return
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
                # 不限制数量，自动翻页获取全部数据
                tasks.append((platform, type_name, exe.submit(fetch_ranking, platform, type_name)))

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
                    result["platforms"][platform][type_name]["source"] = "cache"
                    print(f"    -> fallback to cache")

    current_sizes = {(platform, chart): len(data.get("items", [])) for platform, charts in result["platforms"].items() for chart, data in charts.items()}
    previous_sizes = {(platform, chart): len(data.get("items", [])) for platform, charts in cache.get("platforms", {}).items() for chart, data in charts.items()}
    for issue in validate_chart_sizes(current_sizes, previous_sizes):
        cached = cache.get("platforms", {}).get(issue.platform, {}).get(issue.chart)
        if cached:
            result["platforms"][issue.platform][issue.chart] = {**cached, "source": "cache"}
            print(f"  [{issue.platform}/{issue.chart}] quality fallback: {issue.message}")

    # 2. 收集所有唯一游戏（用于详情补全和标签筛选）
    print("\n=== Collecting all unique games ===")
    all_games = {}
    for platform, charts in result["platforms"].items():
        for chart_key, chart_data in charts.items():
            for item in chart_data.get("items", []):
                gid = item.get("id")
                if gid and gid not in all_games:
                    all_games[gid] = item
    print(f"  -> {len(all_games)} unique games")

    # 3. 并发抓取每个游戏的详情页获取完整标签和开发者
    print("\n=== Fetching details for all games (full tags) ===")
    detail_results = {}
    # 降低并发以避免触发速率限制
    DETAIL_WORKERS = min(MAX_WORKERS, 4)
    with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as exe:
        futs = {exe.submit(fetch_app_detail, gid): gid for gid in all_games}
        for fut in as_completed(futs):
            gid = futs[fut]
            try:
                detail = fut.result()
                detail_results[gid] = detail
            except Exception as e:
                print(f"  [{gid}] detail error: {e}")
                detail_results[gid] = {"developer": "未知", "tags": [], "ok": False}

    # 4. 使用完整标签筛选 TapTap制造 游戏
    print("\n=== Finding TapTap-made games (with full tags) ===")
    taptap_candidates = {}
    for gid, game in all_games.items():
        detail = detail_results.get(gid, {"developer": "未知", "tags": [], "ok": False})
        # 优先使用详情API返回的完整标签
        # 注意：空列表 [] 不是 None，但表示 API 没拿到标签，应回退到列表API标签
        full_tags = merge_detail_tags(game.get("tags", []), detail.get("tags"))
        if any("TapTap制造" in t for t in full_tags):
            # 更新游戏的标签为完整标签
            taptap_candidates[gid] = {**game, "tags": full_tags}
    print(f"  -> {len(taptap_candidates)} TapTap-made games found")

    # 计算最高排名并组装 taptap_made
    print("\n=== Computing best ranks ===")
    for gid, game in taptap_candidates.items():
        detail = detail_results.get(gid, {"developer": "未知", "tags": [], "ok": False})
        best = find_best_rank(gid, result["platforms"])
        if best:
            result["taptap_made"].append({
                "id": game["id"],
                "title": game["title"],
                "icon": game["icon"],
                "score": game["score"],
                "tags": game.get("tags", []),
                "developer": detail["developer"],
                "platforms": game["platforms"],
                "best_rank": best["rank"],
                "best_chart": best["chart"],
                "best_platform": best["platform"],
                "url": game["url"],
                "released_time": game["released_time"],
                "review_count": detail.get("review_count"),
            })

    result["taptap_made"].sort(key=lambda x: x["best_rank"])
    print(f"  -> {len(result['taptap_made'])} games with rank data")

    # 4. 补充所有榜单的开发者信息（不限前20），同时补 taptap_made
    patch_developers(result["platforms"], detail_results, result.get("taptap_made", []))

    # 5. 更新所有榜单游戏的标签和评论数（从 detail_results 获取）
    print("\n=== Patching full tags and review counts for all platform games ===")
    tag_update_count = 0
    review_update_count = 0
    for platform, charts in result["platforms"].items():
        for chart_key, chart_data in charts.items():
            for item in chart_data.get("items", []):
                gid = item.get("id")
                if gid and gid in detail_results:
                    detail = detail_results[gid]
                    # 更新标签
                    merged_tags = merge_detail_tags(item.get("tags", []), detail.get("tags"))
                    if merged_tags != item.get("tags", []):
                        item["tags"] = merged_tags
                        tag_update_count += 1
                    # 更新评论数
                    if detail.get("review_count") is not None:
                        item["review_count"] = detail["review_count"]
                        review_update_count += 1
    print(f"  -> Updated tags for {tag_update_count} games")
    print(f"  -> Updated review_count for {review_update_count} games")

    # Timestamps alone must not rewrite static ranking files, but the fresh
    # observation still needs to reach D1 for hourly baselines.
    business_changed, published_result, history_observation = split_snapshot_roles(result, cache)
    if not business_changed:
        print("No ranking changes; retaining static files while recording this observation")

    out_path = os.path.join(DATA_DIR, "rankings.json")
    if business_changed:
        publisher = AtomicPublisher(Path(DATA_DIR))
        publisher.publish_json("rankings.json", published_result, pretty=True)

    # 保存分榜单文件（供首页懒加载）
        meta = {"updated_at": published_result["updated_at"], "platforms": {}}
        for platform, charts in published_result["platforms"].items():
            meta["platforms"][platform] = {}
            for chart_key, chart_data in charts.items():
                chart_file = os.path.join(DATA_DIR, f"rankings-{platform}-{chart_key}.json")
                publisher.publish_json(os.path.basename(chart_file), chart_data, pretty=True)
                meta["platforms"][platform][chart_key] = {
                    "title": chart_data.get("title", ""),
                    "count": len(chart_data.get("items", [])),
                }
        meta["taptap_made_count"] = len(published_result.get("taptap_made", []))
        meta_path = os.path.join(DATA_DIR, "meta.json")
        publisher.publish_json(os.path.basename(meta_path), meta, pretty=True)
        save_history(published_result)

    # Generate the normalized v2 analysis dataset for the interactive dashboard.
    # Keep this compatibility hook local so the legacy ranking files remain usable
    # while the collector is migrated into the package.
    try:
        from ttmrank.pipeline import build_analysis_artifacts

        history_url = os.environ.get("TTMRANK_HISTORY_URL", "")
        history_client = HistoryClient(history_url, os.environ.get("TTMRANK_HISTORY_TOKEN", "")) if history_url else GitHistoryClient(PROJECT_ROOT)
        build_analysis_artifacts(history_observation, Path(DATA_DIR) / "v2", history_client=history_client)
        print("Generated v2 analysis artifacts")
    except Exception as exc:
        # The legacy files are already atomically independent from v2. Fail the
        # workflow so an invalid analysis dataset is never deployed unnoticed.
        raise RuntimeError(f"v2 analysis generation failed: {exc}") from exc

    elapsed = time.time() - start_time
    print(f"\nSaved to {out_path}")
    total = sum(len(chart.get("items", [])) for charts in result["platforms"].values() for chart in charts.values())
    print(f"Total ranking entries: {total}")
    print(f"Elapsed: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
