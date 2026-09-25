#!/bin/bash
# 松鼠大战怀旧复刻版 —— macOS / Linux 启动器
#
# 打开顺序：①已经编译好的原生版（Tauri，src-tauri/target/release/bundle/macos/*.app）
#            → 真正的独立窗口，完全不经过浏览器；
#           ②没有原生版 → 起本地服务器（Node 优先，其次 Python，存档写进 save/progress.json），
#            再用 Chrome/Edge 的「应用窗口」模式打开：没有标签栏与地址栏，也是一个独立窗口。
#
# 双击运行时的行为：**服务器放到后台**（nohup，日志写 save/server.out.log 与
# save/server.err.log，PID 写 save/.server.pid），本脚本立刻退出，Terminal 窗口自己关掉，
# 不再像以前那样把一个 bash 永远挂在前台。
#   想停掉后台服务器：再双击一次本文件、或者在「终端」里执行  bash 启动游戏.command --stop
#   想在窗口里看实时日志：加 --foreground（服务器回到前台，窗口不会关）
#   想保留窗口不自动关闭：设环境变量 SSDZ_KEEP_WINDOW=1
#
# 用法：  bash 启动游戏.command [端口] [--no-save] [--browser] [--stop] [--foreground]
#   --browser     不走原生窗口、用浏览器打开；--app 是默认行为
#   --no-save     服务器只读，不写 save/progress.json
#   --stop        停掉上一次留在后台的本地服务器，然后退出
#   --foreground  服务器留在前台（调试用；窗口不会自动关闭）
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
# 游戏本体在 <脚本目录>/game/ 里；平铺的便携包、或者脚本被挪进子目录也都认
ROOT=""
for c in "$HERE/game" "$HERE" "$HERE/.."; do
  if [ -f "$c/index.html" ]; then ROOT="$(cd "$c" && pwd)"; break; fi
done
if [ -z "$ROOT" ]; then
  echo "找不到 index.html：它应该在「$(basename "$HERE")/game/」里。"
  echo "请把整个文件夹一起解压后再运行启动器。"
  exit 2
fi
cd "$ROOT" || exit 1

PORT=8080
APP_MODE=1
FOREGROUND=0
DO_STOP=0
SERVER_ARGS=()
for a in "$@"; do
  case "$a" in
    [0-9]*) PORT="$a" ;;
    --browser|--app) APP_MODE=0 ;;
    --no-save) SERVER_ARGS+=(--no-save) ;;
    --stop) DO_STOP=1 ;;
    --foreground) FOREGROUND=1 ;;
  esac
done
URL="http://127.0.0.1:$PORT/"
SAVE_DIR="$ROOT/save"
PID_FILE="$SAVE_DIR/.server.pid"
OUT_LOG="$SAVE_DIR/server.out.log"
ERR_LOG="$SAVE_DIR/server.err.log"

echo "松鼠大战怀旧复刻版"
echo "目录：$(pwd)"

# ---- 退出时把这个 Terminal 窗口关掉（只关我们自己这一个）----
# 双击 .command 时 Terminal 的窗口标题就是脚本名；手工在终端里跑时标题不是它，
# 所以这里不会误关你正在用的窗口。osascript 不可用/没授权就什么都不做（静默失败）。
close_self_window() {
  [ "${SSDZ_KEEP_WINDOW:-}" = "1" ] && return 0
  [ "$(uname)" = "Darwin" ] || return 0
  [ "${TERM_PROGRAM:-}" = "Apple_Terminal" ] || return 0
  [ -t 0 ] || return 0
  command -v osascript >/dev/null 2>&1 || return 0
  local title
  title="${SSDZ_WINDOW_TITLE:-$(basename "$0")}"
  title="${title%.command}"; title="${title%.sh}"
  [ -n "$title" ] || return 0
  nohup osascript -e 'delay 0.5' \
    -e "tell application \"Terminal\" to close (every window whose name contains \"$title\")" \
    >/dev/null 2>&1 &
  disown 2>/dev/null || true
  return 0
}

# ---- --stop：停掉上一次留在后台的本地服务器 ----
if [ "$DO_STOP" = "1" ]; then
  stopped=0
  if [ -f "$PID_FILE" ]; then
    srv_pid="$(tr -dc '0-9' < "$PID_FILE" 2>/dev/null)"
    if [ -n "$srv_pid" ] && kill -0 "$srv_pid" 2>/dev/null; then
      kill "$srv_pid" 2>/dev/null && stopped=1
      sleep 0.3
      kill -9 "$srv_pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
  if [ "$stopped" = "1" ]; then echo "已经停掉后台的本地服务器。"; else echo "没有找到正在运行的后台服务器。"; fi
  close_self_window
  exit 0
fi

# ---- 优先：已经编译好的原生窗口（Tauri 轻壳）----
# 轻壳自己不存前端：启动时找游戏目录里的 index.html，自带迷你服务器供起来，
# 存档也写游戏目录的 save/progress.json，所以和网页版同一套代码、同一个存档。
if [ "$APP_MODE" = "1" ]; then
  for app in "$ROOT"/src-tauri/target/release/bundle/macos/*.app "$ROOT"/src-tauri/target/release/bundle/macos/*/*.app; do
    if [ -d "$app" ]; then
      echo "打开方式：原生窗口（Tauri 桌面版）"
      open "$app" && { close_self_window; exit 0; }
    fi
  done
  for bin in "$ROOT/src-tauri/dist/ssdz-classic" "$ROOT/src-tauri/target/release/ssdz-classic"; do
    if [ -x "$bin" ]; then
      echo "打开方式：原生窗口（Tauri 轻壳）"
      nohup "$bin" >/dev/null 2>&1 &
      disown 2>/dev/null || true
      close_self_window
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
    nohup "$BROWSER" --app="$URL" --window-size=1216,760 --user-data-dir="$PROFILE_DIR" >/dev/null 2>&1 &
    disown 2>/dev/null || true
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
    # 记下它的 PID：这样即使是旧版启动器留在前台的服务器，也能用 --stop / 停止游戏.command 收掉。
    # 能通过 save_api_ok 说明对面确实带 /__save 接口，不会是随便一个占端口的程序。
    if [ ! -f "$PID_FILE" ] && command -v lsof >/dev/null 2>&1; then
      old_pid="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)"
      [ -n "$old_pid" ] && printf '%s\n' "$old_pid" > "$PID_FILE"
    fi
    open_app
    close_self_window
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

# ---- 选一个服务器：Node 优先，其次 Python ----
SERVER_EXE=""
SERVER_LABEL=""
SERVER_PRE=()
if command -v node >/dev/null 2>&1 && [ -f "$ROOT/serve.js" ]; then
  SERVER_EXE="$(command -v node)"; SERVER_LABEL="Node.js"; SERVER_PRE=("$ROOT/serve.js")
else
  PY="$(command -v python3 || command -v python)"
  if [ -n "$PY" ] && [ -f "$ROOT/serve.py" ]; then
    SERVER_EXE="$PY"; SERVER_LABEL="Python"; SERVER_PRE=("$ROOT/serve.py")
  fi
fi

if [ -z "$SERVER_EXE" ]; then
  echo "既没有 Node.js 也没有 Python：进度只能存在浏览器里（localStorage）。"
  echo "装一个 Node.js（https://nodejs.org）后重新运行本脚本，就能写进 save/progress.json。"
  if [ "$APP_MODE" = "1" ] && [ -n "$BROWSER" ]; then
    nohup "$BROWSER" --app="file://$(pwd)/index.html" --window-size=1216,760 --allow-file-access-from-files >/dev/null 2>&1 &
    disown 2>/dev/null || true
  elif command -v open >/dev/null 2>&1; then open index.html
  else echo "请手动打开 index.html"; fi
  close_self_window
  exit 3
fi

echo "服务器：${SERVER_LABEL}（存档 → save/progress.json）"

# ---- 前台模式（--foreground）：保留老行为，方便看日志 ----
if [ "$FOREGROUND" = "1" ]; then
  echo "（前台运行，Ctrl+C 结束；本窗口不会自动关闭）"
  ( sleep 1; open_app ) &
  exec "$SERVER_EXE" "${SERVER_PRE[@]}" "$PORT" "${SERVER_ARGS[@]}"
fi

# ---- 后台模式（默认）：起服务器 → 等它真的监听 → 开窗口 → 本脚本退出，窗口自动关闭 ----
mkdir -p "$SAVE_DIR"
: > "$OUT_LOG"
: > "$ERR_LOG"
nohup "$SERVER_EXE" "${SERVER_PRE[@]}" "$PORT" "${SERVER_ARGS[@]}" </dev/null >>"$OUT_LOG" 2>>"$ERR_LOG" &
SRV_PID=$!
disown 2>/dev/null || true

UP=0
i=0
while [ "$i" -lt 60 ]; do
  sleep 0.25
  kill -0 "$SRV_PID" 2>/dev/null || break
  if port_busy "$PORT"; then UP=1; break; fi
  i=$((i + 1))
done

if [ "$UP" != "1" ]; then
  echo
  echo "[x] 服务器没能在这个端口上起来（端口 ${PORT}）。"
  echo "    服务器输出在 save/server.out.log 与 save/server.err.log。"
  echo "    常见原因是端口又被别的程序抢走了，换一个端口再试："
  echo "      bash 启动游戏.command 8081"
  kill "$SRV_PID" 2>/dev/null || true
  echo
  # 失败时留住窗口，让玩家能看清原因
  if [ -t 0 ]; then printf '按回车键关闭…'; read -r _; fi
  exit 1
fi

echo "$SRV_PID" > "$PID_FILE"
echo "服务器已在后台运行（PID ${SRV_PID}），日志：save/server.out.log"
echo "要停掉它：双击 停止游戏.command，或者  bash 启动游戏.command --stop"
open_app
close_self_window
exit 0
