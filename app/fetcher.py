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


def extract_app(entry: dict, rank: int, detail_tags: list = None) -> dict:
    """提取游戏数据"""
    app = entry.get("app", {})
    stat = app.get("stat", {})
    rating = stat.get("rating", {})
    tags = detail_tags if detail_tags else [t.get("value", "") for t in app.get("tags", [])]
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
    """获取游戏详情：先尝试API，失败则回退到HTML解析"""
    # 1. 尝试 v6 API（结构化数据，快）
    api_result = _fetch_app_detail_api(app_id)
    # 只要 API 成功返回了标签（哪怕只有1个），就优先信任 API
    # HTML 解析容易抓到导航栏/推荐区的通用标签
    if api_result.get("ok") and api_result.get("tags"):
        return api_result
    
    # 2. API没拿到完整tags，回退到HTML解析
    html_result = _fetch_app_detail_html(app_id)
    if html_result.get("ok"):
        # 合并结果：API拿到的developer + HTML拿到的tags
        if api_result.get("ok") and api_result.get("developer") != "未知":
            html_result["developer"] = api_result["developer"]
        return html_result
    
    # 3. 都失败，返回API结果（至少有developer可能拿到了）
    return api_result


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
    return {"developer": "未知", "tags": [], "ok": False}


def _fetch_app_detail_html(app_id: int) -> dict:
    """从详情页HTML解析完整标签（API失败时的fallback）"""
    url = f"https://www.taptap.cn/app/{app_id}"
    req = Request(url, headers={
        "User-Agent": HEADERS["User-Agent"],
        "Referer": "https://www.taptap.cn/top",
        "Accept": "text/html",
    })
    try:
        with urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8")
        
        # 尝试从 window.__NUXT__ 提取结构化数据（最准）
        import re
        nuxt_match = re.search(
            r'window\.__NUXT__\s*=\s*(\{.*?\});?\s*</script>',
            html, re.DOTALL
        )
        if nuxt_match:
            try:
                nuxt = json.loads(nuxt_match.group(1))
                # 常见路径：__NUXT__.data[0].app.tags
                app_data = None
                if isinstance(nuxt, dict):
                    # 尝试多种可能的路径
                    data_arr = nuxt.get("data", [])
                    if data_arr and isinstance(data_arr, list):
                        app_data = data_arr[0].get("app") if isinstance(data_arr[0], dict) else None
                    # 或者 __NUXT__.state.app.detail
                    if not app_data:
                        state = nuxt.get("state", {})
                        app_data = state.get("app", {}).get("detail") if isinstance(state, dict) else None
                
                if app_data and isinstance(app_data, dict):
                    tags = [t.get("value", t) if isinstance(t, dict) else str(t) 
                            for t in app_data.get("tags", [])]
                    devs = app_data.get("developers", [])
                    dev = devs[0].get("name", "未知") if devs and isinstance(devs, list) else "未知"
                    if not dev or dev == "未知":
                        dev = app_data.get("developer", {}).get("name", "未知") if isinstance(app_data.get("developer"), dict) else "未知"
                    if tags:
                        return {"developer": dev, "tags": tags, "ok": True}
            except Exception:
                pass  # NUXT解析失败，继续走正则回退
        
        # 回退：从页面标签链接正则提取
        # 详情页的标签通常是 <a href="/tag/xxx">标签名</a>
        # 为避免取到相关推荐标签，限制只取主内容区附近的
        tags = []
        seen = set()
        # 取 href="/tag/xxx" 且链接文本非空的
        for m in re.finditer(
            r'<a[^>]+href="/tag/([^"]+)"[^>]*>([^<]+)</a>',
            html
        ):
            tag_val = m.group(2).strip()
            if tag_val and tag_val not in seen:
                seen.add(tag_val)
                tags.append(tag_val)
        
        # 如果标签太多（可能包含了相关推荐），取前N个
        # 详情页通常展示游戏的主标签在前，相关推荐在后
        # 末日危城有5个主标签，留一些余量取前15个
        if len(tags) > 15:
            tags = tags[:15]
        
        if tags:
            return {"developer": "未知", "tags": tags, "ok": True}
        
        return {"developer": "未知", "tags": [], "ok": False}
    except HTTPError as e:
        print(f"    Detail HTML HTTP {e.code}: {e.reason}")
        return {"developer": "未知", "tags": [], "ok": False}
    except Exception as e:
        print(f"    Detail HTML error: {e}")
        return {"developer": "未知", "tags": [], "ok": False}


def patch_developers(rankings: dict, detail_results: dict):
    """使用已获取的详情结果补充榜单前20名中的未知开发者"""
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
                detail_results[gid] = fut.result()
            except Exception as e:
                print(f"  [{gid}] detail error: {e}")
                detail_results[gid] = {"developer": "未知", "tags": [], "ok": False}

    # 4. 使用完整标签筛选 TapTap制造 游戏
    print("\n=== Finding TapTap-made games (with full tags) ===")
    taptap_candidates = {}
    for gid, game in all_games.items():
        detail = detail_results.get(gid, {"developer": "未知", "tags": [], "ok": False})
        # 优先使用详情API返回的完整标签，否则使用列表API的截断标签
        full_tags = detail.get("tags") if detail.get("tags") else game.get("tags", [])
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
                "tags": full_tags,
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

    # 4. 补充榜单前20名的开发者信息（复用已获取的详情结果）
    patch_developers(result["platforms"], detail_results)

    # 保存完整数据（供 taptapmaker.html 等需要全量数据的页面使用）
    out_path = os.path.join(DATA_DIR, "rankings.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 保存分榜单文件（供首页懒加载）
    meta = {"updated_at": result["updated_at"], "platforms": {}}
    for platform, charts in result["platforms"].items():
        meta["platforms"][platform] = {}
        for chart_key, chart_data in charts.items():
            chart_file = os.path.join(DATA_DIR, f"rankings-{platform}-{chart_key}.json")
            with open(chart_file, "w", encoding="utf-8") as f:
                json.dump(chart_data, f, ensure_ascii=False, indent=2)
            meta["platforms"][platform][chart_key] = {
                "title": chart_data.get("title", ""),
                "count": len(chart_data.get("items", [])),
            }
    meta["taptap_made_count"] = len(result.get("taptap_made", []))
    meta_path = os.path.join(DATA_DIR, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    save_history(result)

    elapsed = time.time() - start_time
    print(f"\nSaved to {out_path}")
    total = sum(len(v) for p in result["platforms"].values() for v in p.values())
    print(f"Total ranking entries: {total}")
    print(f"Elapsed: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
