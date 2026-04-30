#!/usr/bin/env python3
"""TTMRank 服务器 - 支持 /refresh /llm 端点，自动寻找可用端口，缓存优先+后台更新+定时刷新"""

import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")

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
            result = subprocess.run(
                [sys.executable, 'fetcher.py'],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding='utf-8',
                timeout=180,
            )
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
            self._handle_refresh()
        elif self.path.startswith('/ping'):
            self._handle_ping()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/llm':
            self._handle_llm()
        else:
            self.send_error(404)

    def _handle_llm(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON"})
            return

        url = payload.pop('url', '')
        key = payload.pop('key', '')
        if not url or not key:
            self._send_json(400, {"error": "Missing url or key"})
            return

        req = Request(url, data=json.dumps(payload).encode('utf-8'), headers={
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key,
        }, method='POST')

        try:
            with urlopen(req, timeout=120) as resp:
                resp_body = resp.read()
            try:
                text = resp_body.decode('utf-8')
            except UnicodeDecodeError:
                text = resp_body.decode('utf-8', errors='replace')
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = {"raw_response": text}
            self._send_json(200, parsed)
        except HTTPError as e:
            try:
                err_body = e.read().decode('utf-8', errors='replace')
            except Exception:
                err_body = str(e)
            self._send_json(e.code, {"error": err_body})
        except Exception as e:
            self._send_json(502, {"error": str(e)})

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def _handle_refresh(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            result = subprocess.run(
                [sys.executable, 'fetcher.py'],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding='utf-8',
                timeout=180,
            )
            if result.returncode == 0:
                resp = {"success": True, "message": "数据刷新成功"}
            else:
                err = (result.stderr or result.stdout or "未知错误").strip()[:300]
                resp = {"success": False, "error": err}
        except subprocess.TimeoutExpired:
            resp = {"success": False, "error": "刷新超时（超过180秒）"}
        except Exception as e:
            resp = {"success": False, "error": str(e)}
        self.wfile.write(json.dumps(resp, ensure_ascii=False).encode('utf-8'))

    def _handle_ping(self):
        _update_ping()
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def end_headers(self):
        if self.path.startswith('/refresh') or self.path.startswith('/llm') or self.path.startswith('/ping'):
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
        result = subprocess.run(
            [sys.executable, 'fetcher.py'],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding='utf-8',
            timeout=180,
        )
        if result.returncode == 0:
            print("[bg] 数据更新完成，刷新页面即可查看最新数据")
        else:
            print(f"[bg] 更新失败: {(result.stderr or result.stdout or '未知错误').strip()[:200]}")
    except Exception as e:
        print(f"[bg] 更新异常: {e}")


def main():
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
            subprocess.run([sys.executable, 'fetcher.py'], cwd=ROOT, timeout=180)
        except Exception as e:
            print(f"首次爬取失败: {e}")

    # 定时刷新线程（线上模式）
    if ENABLE_SCHEDULE:
        print(f"[schedule] 启用定时刷新，间隔 {SCHEDULE_INTERVAL} 秒")
        threading.Thread(target=_scheduled_refresh, daemon=True).start()

    HTTPServer.allow_reuse_address = False
    with HTTPServer(("", port), Handler) as httpd:
        if ENABLE_WATCHDOG:
            threading.Thread(target=_watchdog, args=(httpd,), daemon=True).start()
        url = f"http://localhost:{port}"
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
