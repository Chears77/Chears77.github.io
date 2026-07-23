# -*- coding: utf-8 -*-
"""
serve.py — 本地预览第二版法规库（必须经由 HTTP 访问）

为什么需要它：
  直接双击 index.html（file:// 协议）会被浏览器安全策略拦截 fetch()，
  导致 manifest.json / 法规 md 全部 Failed to fetch。必须经 HTTP 服务访问。

用法：
  python serve.py            # 启动后自动打开浏览器 http://localhost:8123/index.html
  python serve.py 9000      # 指定端口
按 Ctrl+C 停止服务。部署到 GitHub Pages 后无需本脚本。
"""
import http.server
import socketserver
import webbrowser
import os
import sys
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        # 避免缓存导致改完不刷新
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默日志


if __name__ == '__main__':
    os.chdir(ROOT)
    # 必须用多线程服务器：浏览器会并行开多个 keep-alive 连接请求
    # HTML/CSS/JS/manifest，单线程 TCPServer 会被空闲连接卡住导致 fetch 失败。
    httpd = http.server.ThreadingHTTPServer(("", PORT), Handler)
    try:
        url = f"http://localhost:{PORT}/index.html"
        print("=" * 50)
        print(" 工程建设法规库（第二版）本地预览已启动")
        print(f" 请在浏览器打开：{url}")
        print(" 导航门户：       " + f"http://localhost:{PORT}/nav.html")
        print(" 按 Ctrl+C 停止服务")
        print("=" * 50)
        try:
            # 在子线程里打开浏览器，避免阻塞 serve_forever 启动（沙箱环境可能短暂卡顿）
            threading.Thread(target=lambda: (webbrowser.open(url), None), daemon=True).start()
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务已停止。")
