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
# 用法：  bash 启动游戏.command [端口] [--no-save] [--browser] [--stop] [--foreground] [--reset-profile]
#   --browser     不走原生窗口、用浏览器打开；--app 是默认行为
#   --no-save     服务器只读，不写 save/progress.json
#   --stop        停掉上一次留在后台的本地服务器，然后退出
#   --foreground  服务器留在前台（调试用；窗口不会自动关闭）
#   --reset-profile  清掉游戏独立窗口的浏览器缓存目录（正式存档 save/progress.json 不受影响；
#                    目录先改名为 browser-profile.bak-<时间>，确认没用再自己删）
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
# 游戏根 = 有「scripts/index.html」的那一层（旧布局的 index.html 也认）
ROOT=""
for c in "$HERE" "$HERE/.."; do
  if [ -f "$c/scripts/index.html" ] || [ -f "$c/index.html" ]; then ROOT="$(cd "$c" && pwd)"; break; fi
done
if [ -z "$ROOT" ]; then
  echo "找不到游戏文件（应该有 scripts/index.html）：请把整个文件夹一起解压后再运行启动器。"
  exit 2
fi
cd "$ROOT" || exit 1
# 入口页：新布局在 scripts/ 里、旧布局在根目录；file:// 兜底打开时要用它的完整路径
ENTRY="$ROOT/index.html"
[ -f "$ROOT/scripts/index.html" ] && ENTRY="$ROOT/scripts/index.html"

PORT=8080
APP_MODE=1
RESET_PROFILE=0
FOREGROUND=0
DO_STOP=0
SERVER_ARGS=()
for a in "$@"; do
  case "$a" in
    [0-9]*) PORT="$a" ;;
    --browser|--app) APP_MODE=0 ;;
    --reset-profile) RESET_PROFILE=1 ;;
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

# ---- 存档体检：正式存档不在/读不出来时，从 backup/ 里挑等级最高的那份补回来 ----
# 「双击启动器却载入了一个新存档」的另一半原因：save/progress.json 被写坏或写空之后，
# 游戏只能从零开始，而玩家其实在 save/backup/ 里还有好几份几十级的快照。
save_file_level() {  # 打印存档文件里的等级；读不出来就什么都不打印
  [ -f "$1" ] || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  python3 - "$1" <<'PY' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding='utf-8'))
    print(int(d['level']))
except Exception:
    pass
PY
}
recover_save_if_needed() {
  local progress="$SAVE_DIR/progress.json" level best best_level
  level="$(save_file_level "$progress" || true)"
  if [ -n "$level" ]; then return 0; fi
  [ -d "$SAVE_DIR/backup" ] || return 0
  best=""; best_level=0
  for f in "$SAVE_DIR/backup"/*.json; do
    [ -f "$f" ] || continue
    level="$(save_file_level "$f" || true)"
    [ -n "$level" ] || continue
    if [ "$level" -gt "$best_level" ]; then best_level="$level"; best="$f"; fi
  done
  if [ -n "$best" ]; then
    cp "$best" "$progress"
    printf '%s' "$best_level" > "$SAVE_DIR/.min-level"
    echo "存档体检：progress.json 读不出来，已从备份恢复（$best_level 级 ← $(basename "$best")）"
    osascript -e "display dialog \"磁盘上的正式存档读不出来，已从备份恢复 $best_level 级的存档。\n\n来源：$(basename "$best")\" buttons {\"知道了\"} default button 1 with title \"松鼠大战 · 存档体检\"" >/dev/null 2>&1 || true
  else
    echo "存档体检：progress.json 读不出来，backup/ 里也没有可用备份。"
  fi
}
if [ "$DO_STOP" != "1" ]; then recover_save_if_needed; fi

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

# --reset-profile：清掉游戏独立窗口的浏览器缓存目录（localStorage 里的兜底档）。
# 用独立 profile 时，浏览器兜底存档和人平时用的浏览器不是同一份。
# 注意：正式存档是 save/progress.json，和这个目录无关；这里只改名不删除，误清了也能拿回来。
if [ "$RESET_PROFILE" = "1" ] && [ -n "$PROFILE_DIR" ] && [ -d "$PROFILE_DIR" ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  echo "浏览器缓存目录改名保留：$PROFILE_DIR → $PROFILE_DIR.bak-$STAMP"
  mv "$PROFILE_DIR" "$PROFILE_DIR.bak-$STAMP" 2>/dev/null || rm -rf "$PROFILE_DIR"
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

# ---- 第 1 步：补齐 PATH（这是「双击打开是 1 级」的病根）----
# macOS 上 Finder 双击 .command 只给 /usr/bin:/bin:/usr/sbin:/sbin，
# Homebrew（/opt/homebrew/bin）装的 node 不在里面 → 以前被误判成「没有 Node.js」，
# 于是回退到 --app=file://… 打开：页面是 file: 协议，浏览器不许写文件，
# 游戏只能退回 localStorage 兜底档（于是显示 1 级、也导入不了 save/ 里的存档）。
for d in /opt/homebrew/bin /usr/local/bin /opt/local/bin "$HOME/.volta/bin" "$HOME/.bun/bin"; do
  if [ -d "$d" ]; then case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac; fi
done
for d in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.n/bin; do
  if [ -d "$d" ]; then case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH" ;; esac; fi
done
export PATH

# 再兜一层：即使 PATH 还是不对，也直接按绝对路径找 node
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi

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
# 服务器脚本住在 scripts/ 子文件夹里（也认旧版直接放在根目录的情况）
SERVE_JS="$ROOT/scripts/serve.js"; [ -f "$SERVE_JS" ] || SERVE_JS="$ROOT/serve.js"
SERVE_PY="$ROOT/scripts/serve.py"; [ -f "$SERVE_PY" ] || SERVE_PY="$ROOT/serve.py"
SERVER_EXE=""
SERVER_LABEL=""
SERVER_PRE=()
if [ -n "$NODE_BIN" ] && [ -f "$SERVE_JS" ]; then
  SERVER_EXE="$NODE_BIN"; SERVER_LABEL="Node.js"; SERVER_PRE=("$SERVE_JS")
else
  PY="$(command -v python3 || command -v python)"
  if [ -n "$PY" ] && [ -f "$SERVE_PY" ]; then
    SERVER_EXE="$PY"; SERVER_LABEL="Python"; SERVER_PRE=("$SERVE_PY")
  fi
fi

if [ -z "$SERVER_EXE" ]; then
  echo "既没有 Node.js 也没有 Python：进度只能存在浏览器里（localStorage）。"
  # 双击时终端窗口会立刻关闭，所以这里必须用系统对话框把话说清楚（以前是静默回退到 file://）
  osascript -e 'display dialog "没有找到 Node.js / Python。\n\n现在只能用浏览器兜底存档：游戏会显示浏览器里的旧档（可能是 1 级），save/progress.json（磁盘上的正式存档）不会被读写，也无法导入存档文件。\n\n建议先装 Node.js（https://nodejs.org）后重新双击启动。" buttons {"知道了"} default button 1 with title "松鼠大战 · 启动提示"' >/dev/null 2>&1 || true
  echo "装一个 Node.js（https://nodejs.org）后重新运行本脚本，就能写进 save/progress.json。"
  # 入口页在 scripts/ 里（新布局），这里用完整路径；以前写死了 $(pwd)/index.html，新布局下根本打不开
  if [ "$APP_MODE" = "1" ] && [ -n "$BROWSER" ]; then
    nohup "$BROWSER" --app="file://$ENTRY" --window-size=1216,760 --allow-file-access-from-files >/dev/null 2>&1 &
    disown 2>/dev/null || true
  elif command -v open >/dev/null 2>&1; then open "$ENTRY"
  else echo "请手动打开：$ENTRY"; fi
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
# 开窗口之后再做一次存档接口自检：接口真的能读到 progress.json 才算启动成功，
# 免得出现「窗口开了、但游戏读不到存档」这种最难排查的静默状态。
save_check_warn() {
  local body
  body="$(curl -fs -m 3 "${URL}__save" 2>/dev/null | head -c 200 || true)"
  if printf '%s' "$body" | grep -q '"ok":true'; then
    echo "存档接口自检：正常（游戏会读写 save/progress.json）"
    # 顺手看看是不是「旧代码的服务器」还在跑：新版有这个备份接口，旧版没有。
    # 旧服务器不算致命，但导入存档时不能自动备份旧档，所以提示一下重启。
    if command -v curl >/dev/null 2>&1 && ! curl -fs -m 2 -o /dev/null "${URL}__save/backup" 2>/dev/null; then
      echo "[!] 现在这个服务器是旧版本（没有备份接口）。建议：先 双击 停止游戏.command，再双击本文件重启一次。"
    fi
    return 0
  fi
  echo "[!] 存档接口自检没通过：游戏窗口可能退回浏览器兜底存档。"
  echo "    服务器日志：save/server.err.log"
  osascript -e "display dialog \"游戏窗口开了，但存档接口自检没通过 —— 窗口里可能会显示浏览器里的旧档（例如 1 级）。\n\n请把这个提示告诉维护者，并附上 save/server.err.log。\" buttons {\"知道了\"} default button 1 with title \"松鼠大战 · 存档自检\"" >/dev/null 2>&1 || true
  return 1
}
open_app
save_check_warn || true
close_self_window
exit 0
