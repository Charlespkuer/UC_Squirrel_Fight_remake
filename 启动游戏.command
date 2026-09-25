#!/bin/bash
# 松鼠大战怀旧复刻版 —— macOS / Linux 启动器
#
# 打开顺序：①已经编译好的原生版（Tauri，src-tauri/target/release/bundle/macos/*.app）
#            → 真正的独立窗口，完全不经过浏览器；
#           ②没有原生版 → 起本地服务器（Node 优先，其次 Python，存档写进 save/progress.json），
#            再用 Chrome/Edge 的「应用窗口」模式打开：没有标签栏与地址栏，也是一个独立窗口。
#
# 用法：  bash 启动游戏.command [端口] [--no-save] [--browser]
#   --browser 不走原生窗口、用浏览器打开；--app 是默认行为
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
# 脚本就在游戏目录里；万一被挪进子目录，就往上找一层
if [ -f "index.html" ]; then ROOT="$HERE"; else ROOT="$(cd "$HERE/.." && pwd)"; fi
if [ ! -f "$ROOT/index.html" ]; then
  echo "找不到 index.html：请把整个游戏文件夹一起解压后再运行启动器。"
  exit 2
fi
cd "$ROOT" || exit 1
PORT=8080
for a in "$@"; do case "$a" in [0-9]*) PORT="$a";; esac; done
URL="http://127.0.0.1:$PORT/"
APP_MODE=1
for a in "$@"; do [ "$a" = "--browser" ] && APP_MODE=0; done

echo "松鼠大战怀旧复刻版"
echo "目录：$(pwd)"

# ---- 优先：已经编译好的原生窗口（Tauri 轻壳）----
# 轻壳自己不存前端：启动时找游戏目录里的 index.html，自带迷你服务器供起来，
# 存档也写游戏目录的 save/progress.json，所以和网页版同一套代码、同一个存档。
if [ "$APP_MODE" = "1" ]; then
  for app in "$ROOT"/src-tauri/target/release/bundle/macos/*.app "$ROOT"/src-tauri/target/release/bundle/macos/*/*.app; do
    if [ -d "$app" ]; then
      echo "打开方式：原生窗口（Tauri 桌面版）"
      open "$app" && exit 0
    fi
  done
  for bin in "$ROOT/src-tauri/dist/ssdz-classic" "$ROOT/src-tauri/target/release/ssdz-classic"; do
    if [ -x "$bin" ]; then
      echo "打开方式：原生窗口（Tauri 轻壳）"
      "$bin" >/dev/null 2>&1 &
      exit 0
    fi
  done
fi

# ---- 找一个 Chromium 系浏览器（应用窗口模式要用它）----
BROWSER=""
for p in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "$(command -v google-chrome 2>/dev/null)" \
  "$(command -v google-chrome-stable 2>/dev/null)" \
  "$(command -v chromium 2>/dev/null)" \
  "$(command -v chromium-browser 2>/dev/null)"
do
  [ -n "$p" ] && [ -x "$p" ] && BROWSER="$p" && break
done

# 应用窗口的配置目录（按平台惯例放用户数据目录）
if [ "$(uname)" = "Darwin" ]; then
  PROFILE_DIR="$HOME/Library/Application Support/SSDZClassic/browser-profile"
else
  PROFILE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/SSDZClassic/browser-profile"
fi

open_app() {
  if [ "$APP_MODE" = "1" ] && [ -n "$BROWSER" ]; then
    # 应用窗口用独立配置目录（不污染游戏目录，也不和你平常的浏览器混在一起）
    "$BROWSER" --app="$URL" --window-size=1216,760 --user-data-dir="$PROFILE_DIR" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  else
    echo "请手动打开：$URL"
  fi
}

# ---- 端口占用检测 ----
port_busy() {
  if [ -n "${BASH_VERSION:-}" ]; then
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
  fi
  if command -v nc >/dev/null 2>&1; then nc -z 127.0.0.1 "$1" >/dev/null 2>&1 && return 0; fi
  if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 && return 0; fi
  return 1
}
# 已经在跑的那个服务器带不带我们的存档接口？
save_api_ok() {
  command -v curl >/dev/null 2>&1 || return 1
  curl -fs -m 2 -o /dev/null "${URL}__save?meta=1" >/dev/null 2>&1
}

# ---- 端口被占用时不要硬起服务器 ----
# 以前这里会直接起服务器，端口被占就 EADDRINUSE 退出，而浏览器已经打开，
# 于是玩家看到的页面来自那个旧服务器（可能没有 /__save）→「没有本地服务器接口」。
if port_busy "$PORT"; then
  if save_api_ok; then
    echo "端口 $PORT 上已经有一个带存档接口的服务器在跑，直接用它（不再新起一个）。"
    open_app
    exit 0
  fi
  echo
  echo "[x] 端口 $PORT 被别的程序占用了，而且它没有游戏存档接口"
  echo "    （最常见的是还开着以前用 python3 -m http.server 起的旧服务器，"
  echo "      或者另一个已经打开的游戏窗口）。这样打开只会显示"
  echo "      「没有本地服务器接口」，所以这里不再替你打开浏览器。"
  echo "    先关掉那个程序，或者换个端口重新运行，例如："
  echo "      bash 启动游戏.command 8081"
  echo
  exit 1
fi

# ---- 优先 Node.js ----
if command -v node >/dev/null 2>&1; then
  echo "服务器：Node.js（存档 → save/progress.json）"
  ( sleep 1; open_app ) &
  exec node serve.js "$@"
fi

# ---- 没有 Node 就用 Python（同样带存档接口）----
PY="$(command -v python3 || command -v python)"
if [ -n "$PY" ]; then
  echo "服务器：Python（存档 → save/progress.json）"
  ( sleep 1; open_app ) &
  exec "$PY" serve.py "$@"
fi

echo "既没有 Node.js 也没有 Python：进度只能存在浏览器里（localStorage）。"
echo "装一个 Node.js（https://nodejs.org）后重新运行本脚本，就能写进 save/progress.json。"
if [ "$APP_MODE" = "1" ] && [ -n "$BROWSER" ]; then
  "$BROWSER" --app="file://$(pwd)/index.html" --window-size=1216,760 --allow-file-access-from-files >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then open index.html
else echo "请手动打开 index.html"; fi
