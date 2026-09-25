#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""松鼠大战怀旧复刻版 —— 纯 Python 本地服务器（不需要 Node.js）

用法:
    python3 references/tools/serve.py [端口]        # 默认 8080
    python3 references/tools/serve.py 8080 --no-save

和 references/tools/serve.js 行为一致：静态文件 + `/__save` 存档接口
（存档写在 <游戏目录>/save/progress.json）。macOS 自带 python3，所以在
没有 Node.js 的机器上也能把进度存进文件，而不是退回浏览器 localStorage。
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAVE_DIR = os.path.join(ROOT, "save")
SAVE_FILE = os.path.join(SAVE_DIR, "progress.json")
SAVE_MAX = 4 * 1024 * 1024
ARGS = sys.argv[1:]
NO_SAVE = "--no-save" in ARGS
PORTS = [int(a) for a in ARGS if a.isdigit()]
PORT = PORTS[0] if PORTS else 8080


def save_meta():
    if not os.path.exists(SAVE_FILE):
        return {"exists": False, "savedAt": 0, "size": 0}
    st = os.stat(SAVE_FILE)
    return {"exists": True, "savedAt": int(st.st_mtime * 1000), "size": st.st_size}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):        # 静音：只在出错时自己打印
        pass

    def _json(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _save_api(self, query):
        if NO_SAVE:
            return self._json(503, {"ok": False, "msg": "服务器以 --no-save 启动，存档文件同步已关闭"})
        meta = save_meta()
        if self.command == "GET":
            if "meta" in query:
                return self._json(200, {"ok": True, "path": SAVE_FILE, **meta})
            if not meta["exists"]:
                return self._json(200, {"ok": True, "exists": False, "savedAt": 0, "data": None, "path": SAVE_FILE})
            with open(SAVE_FILE, "r", encoding="utf-8") as fh:
                text = fh.read()
            return self._json(200, {"ok": True, "exists": True, "savedAt": meta["savedAt"], "data": text, "path": SAVE_FILE})
        if self.command == "POST":
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > SAVE_MAX:
                return self._json(413, {"ok": False, "msg": "存档太大或读取中断"})
            raw = self.rfile.read(length).decode("utf-8")
            try:
                parsed = json.loads(raw)
            except ValueError:
                return self._json(400, {"ok": False, "msg": "不是合法 JSON"})
            if not isinstance(parsed, dict):
                return self._json(400, {"ok": False, "msg": "存档必须是对象"})
            os.makedirs(SAVE_DIR, exist_ok=True)
            with open(SAVE_FILE, "w", encoding="utf-8") as fh:
                json.dump(parsed, fh, ensure_ascii=False)
            return self._json(200, {"ok": True, "savedAt": save_meta()["savedAt"], "path": SAVE_FILE})
        return self._json(405, {"ok": False, "msg": "只支持 GET / POST"})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/__save":
            return self._save_api(parse_qs(parsed.query))
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/__save":
            return self._save_api(parse_qs(parsed.query))
        self.send_error(404, "not found")


if __name__ == "__main__":
    print("松鼠大战 · 怀旧复刻版（Python 服务器）")
    print("目录: " + ROOT)
    print("地址: http://127.0.0.1:%d/" % PORT)
    print("自检: http://127.0.0.1:%d/index.html?test=1" % PORT)
    print("存档文件: " + ("已关闭（--no-save）" if NO_SAVE else SAVE_FILE))
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
