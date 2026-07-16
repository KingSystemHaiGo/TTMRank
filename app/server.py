#!/usr/bin/env python3
"""TTMRank 本地服务器：静态站点、受限刷新与可选定时采集。"""

import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from dataclasses import dataclass
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
REFRESH_LOCK = threading.Lock()


def _csv_env(name, default=""):
    return frozenset(value.strip() for value in os.environ.get(name, default).split(",") if value.strip())


def run_fetcher(*, capture_output=True):
    """Run one collector process; return None when another collection is active."""

    if not REFRESH_LOCK.acquire(blocking=False):
        return None
    try:
        return subprocess.run(
            [sys.executable, 'fetcher.py'],
            cwd=ROOT,
            capture_output=capture_output,
            text=True,
            encoding='utf-8',
            timeout=180,
        )
    finally:
        REFRESH_LOCK.release()


@dataclass(frozen=True)
class SecurityConfig:
    bind_host: str
    public_mode: bool
    allow_refresh: bool
    allowed_origins: frozenset[str]
    max_request_bytes: int

    def cors_origin(self, origin: str | None) -> str | None:
        if not origin:
            return None
        return origin if origin in self.allowed_origins else None

    def same_origin(self, origin: str | None, host: str | None) -> bool:
        if not origin or not host:
            return False
        try:
            parsed = urlsplit(origin)
        except ValueError:
            return False
        return parsed.scheme in {"http", "https"} and parsed.netloc.lower() == host.lower() and not parsed.path

def load_security_config() -> SecurityConfig:
    public_mode = os.environ.get("TTMRANK_PUBLIC", "0") == "1"
    bind_host = os.environ.get("TTMRANK_BIND", "0.0.0.0" if public_mode else "127.0.0.1")
    return SecurityConfig(
        bind_host=bind_host,
        public_mode=public_mode,
        allow_refresh=not public_mode and os.environ.get("TTMRANK_ALLOW_REFRESH", "1") == "1",
        allowed_origins=_csv_env("TTMRANK_ALLOWED_ORIGINS", "http://127.0.0.1:8080,http://localhost:8080"),
        max_request_bytes=max(1024, min(int(os.environ.get("TTMRANK_MAX_REQUEST_BYTES", "262144")), 1_000_000)),
    )

# 是否启用浏览器心跳（本地模式）
ENABLE_WATCHDOG = os.environ.get("ENABLE_WATCHDOG", "1") == "1"
# 是否启用定时刷新（线上模式建议开启）
ENABLE_SCHEDULE = os.environ.get("ENABLE_SCHEDULE", "0") == "1"
SCHEDULE_INTERVAL = int(os.environ.get("SCHEDULE_INTERVAL", "3600"))  # 默认 1 小时

# 浏览器心跳检测
LAST_PING = time.time()
PING_TIMEOUT = 120

def _update_ping():
    global LAST_PING
    LAST_PING = time.time()

def _watchdog(httpd):
    """守护线程：检测浏览器是否已断开（仅本地模式）"""
    while True:
        time.sleep(5)
        if time.time() - LAST_PING > PING_TIMEOUT:
            print("[watchdog] 浏览器已断开超过 120 秒，关闭服务器...")
            httpd.shutdown()
            break

def _scheduled_refresh():
    """定时线程：每小时自动更新数据"""
    while True:
        time.sleep(SCHEDULE_INTERVAL)
        print(f"[schedule] 定时刷新启动（每{SCHEDULE_INTERVAL}秒）...")
        try:
            result = run_fetcher()
            if result is None:
                print("[schedule] 已有刷新正在运行，本轮跳过")
                continue
            if result.returncode == 0:
                print("[schedule] 数据更新完成")
            else:
                print(f"[schedule] 更新失败: {(result.stderr or result.stdout or '未知错误').strip()[:200]}")
        except Exception as e:
            print(f"[schedule] 更新异常: {e}")

def _check_cache():
    return os.path.exists(os.path.join(DATA_DIR, "rankings.json"))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path.startswith('/refresh'):
            self.send_response(405)
            self.send_header('Allow', 'POST')
            self.end_headers()
        elif self.path.startswith('/ping'):
            self._handle_ping()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/refresh':
            self._handle_refresh()
        else:
            self.send_error(404)

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        origin = load_security_config().cors_origin(self.headers.get('Origin'))
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def _handle_refresh(self):
        config = load_security_config()
        origin = self.headers.get('Origin')
        same_origin = config.same_origin(origin, self.headers.get('Host'))
        marked = self.headers.get('X-TTMRank-Request') == 'refresh'
        fetch_site = self.headers.get('Sec-Fetch-Site')
        if not config.allow_refresh:
            self._send_json(403, {"success": False, "error": "Refresh disabled"})
            return
        if not same_origin or not marked or fetch_site not in (None, 'same-origin'):
            self._send_json(403, {"success": False, "error": "Same-origin refresh request required"})
            return
        try:
            result = run_fetcher()
            if result is None:
                self._send_json(409, {"success": False, "error": "Refresh already running"})
                return
            if result.returncode == 0:
                resp = {"success": True, "message": "数据刷新成功"}
                status = 200
            else:
                err = (result.stderr or result.stdout or "未知错误").strip()[:300]
                resp = {"success": False, "error": err}
                status = 500
        except subprocess.TimeoutExpired:
            resp = {"success": False, "error": "刷新超时（超过180秒）"}
            status = 504
        except Exception as e:
            resp = {"success": False, "error": str(e)}
            status = 500
        self._send_json(status, resp)

    def _handle_ping(self):
        _update_ping()
        self.send_response(204)
        self.end_headers()

    def do_OPTIONS(self):
        config = load_security_config()
        requested_origin = self.headers.get('Origin')
        origin = config.cors_origin(requested_origin)
        if self.path == '/refresh' and not config.same_origin(requested_origin, self.headers.get('Host')):
            self.send_error(403)
            return
        if not origin and self.path != '/refresh':
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', origin or requested_origin)
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-TTMRank-Request')
        self.end_headers()

    def end_headers(self):
        if self.path.startswith('/refresh') or self.path.startswith('/ping'):
            pass
        elif self.path.endswith(('.css', '.js')):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        elif self.path.endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2')):
            self.send_header('Cache-Control', 'public, max-age=3600')
        elif self.path.endswith('.html'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def find_port(start=8080, max_try=10):
    for port in range(start, start + max_try):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("", port)) != 0:
                return port
    return None


def background_refresh():
    """后台运行 fetcher 更新数据"""
    time.sleep(2)
    print("[bg] 开始后台数据更新...")
    try:
        result = run_fetcher()
        if result is None:
            print("[bg] 已有刷新正在运行，本轮跳过")
            return
        if result.returncode == 0:
            print("[bg] 数据更新完成，刷新页面即可查看最新数据")
        else:
            print(f"[bg] 更新失败: {(result.stderr or result.stdout or '未知错误').strip()[:200]}")
    except Exception as e:
        print(f"[bg] 更新异常: {e}")


def main():
    security = load_security_config()
    # 云部署时从环境变量读取端口
    port_env = os.environ.get("PORT")
    if port_env:
        port = int(port_env)
        print(f"[deploy] 使用环境变量端口 {port}")
    else:
        port = find_port(8080)
        if port is None:
            print("找不到可用端口（8080-8089 都被占用）")
            sys.exit(1)

    has_cache = _check_cache()
    if has_cache:
        print("检测到已有缓存数据，服务器将立即启动...")
        threading.Thread(target=background_refresh, daemon=True).start()
    else:
        print("未检测到缓存数据，首次启动需要稍等爬取...")
        try:
            result = run_fetcher(capture_output=False)
            if result is None:
                print("首次爬取已由其他刷新执行")
        except Exception as e:
            print(f"首次爬取失败: {e}")

    # 定时刷新线程（线上模式）
    if ENABLE_SCHEDULE:
        print(f"[schedule] 启用定时刷新，间隔 {SCHEDULE_INTERVAL} 秒")
        threading.Thread(target=_scheduled_refresh, daemon=True).start()

    HTTPServer.allow_reuse_address = False
    with HTTPServer((security.bind_host, port), Handler) as httpd:
        if ENABLE_WATCHDOG:
            threading.Thread(target=_watchdog, args=(httpd,), daemon=True).start()
        url = f"http://127.0.0.1:{port}"
        print(f"TTMRank running at {url}")
        print("Press Ctrl+C to stop")
        if not port_env:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")
            sys.exit(0)


if __name__ == "__main__":
    main()
