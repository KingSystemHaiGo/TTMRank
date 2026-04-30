#!/usr/bin/env python3
"""TTMRank 启动器 - 自动检测/下载嵌入式 Python，零依赖运行"""

import os
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
PY_DIR = os.path.join(ROOT, ".python")
PY_EXE = os.path.join(PY_DIR, "python.exe") if sys.platform == "win32" else os.path.join(PY_DIR, "bin", "python3")

EMBED_URL = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"


def has_system_python():
    try:
        result = subprocess.run([sys.executable, "--version"], capture_output=True, text=True)
        return result.returncode == 0
    except Exception:
        return False


def download_embedded_python():
    print("[setup] 未检测到 Python，正在下载嵌入式 Python (约 12MB)...")
    os.makedirs(PY_DIR, exist_ok=True)
    zip_path = os.path.join(ROOT, "python-embed.zip")

    def reporthook(block, blocksize, total):
        if total > 0:
            mb = block * blocksize // 1024 // 1024
            total_mb = total // 1024 // 1024
            print(f"\r[setup] 下载中... {mb}MB / {total_mb}MB", end="")
        else:
            print(f"\r[setup] 下载中... {block * blocksize // 1024}KB", end="")

    urllib.request.urlretrieve(EMBED_URL, zip_path, reporthook=reporthook)
    print()

    print("[setup] 解压中...")
    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall(PY_DIR)
    os.remove(zip_path)

    # 启用 site 导入
    for fn in os.listdir(PY_DIR):
        if fn.endswith('._pth'):
            pth = os.path.join(PY_DIR, fn)
            with open(pth, 'r', encoding='utf-8') as f:
                content = f.read()
            with open(pth, 'w', encoding='utf-8') as f:
                f.write(content.replace('#import site', 'import site'))
            break

    print("[setup] 嵌入式 Python 准备完成")


def get_python():
    if has_system_python():
        return sys.executable
    if os.path.exists(PY_EXE):
        return PY_EXE
    if sys.platform == "win32":
        download_embedded_python()
        if os.path.exists(PY_EXE):
            return PY_EXE
    return None


def main():
    py = get_python()
    if not py:
        print("错误: 无法获取 Python 解释器。请手动安装 Python 3.8+")
        input("按回车键退出...")
        sys.exit(1)

    print(f"[start] 使用 Python: {py}")

    # 数据更新
    print("[start] 检查/更新数据...")
    try:
        subprocess.run([py, "fetcher.py"], cwd=ROOT, check=False)
    except Exception as e:
        print(f"[start] 数据更新失败 (不影响启动): {e}")

    # 启动服务器
    print("[start] 启动服务器...")
    try:
        subprocess.run([py, "server.py"], cwd=ROOT)
    except KeyboardInterrupt:
        print("\n[start] 已停止")


if __name__ == "__main__":
    main()
