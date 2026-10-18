#!/bin/bash
# 松鼠大战 · 关窗收尾（macOS）
#
# 由「启动游戏.command」在打开游戏窗口后后台拉起，不要手动运行。
#
# 作用：游戏窗口关掉之后，把**游戏专用的那个** Chrome/Edge 实例退掉，
# 这样 Dock 里不会再留着一个亮着的 Google Chrome。
#
# 为什么需要它：Chrome 的 --app 窗口关掉以后，浏览器进程本身不会退出
#（macOS 上关掉最后一个窗口，Chrome 仍然留在 Dock / 菜单栏里），
# 所以必须有个东西盯着「窗口还在不在」。
#
# 判定方法（不碰系统权限、不需要辅助功能）：
#   启动器打开窗口时带了 --remote-debugging-port=0，Chrome 会把实际端口写进
#   <profile>/DevToolsActivePort；本脚本轮询 http://127.0.0.1:<端口>/json/list，
#   数其中 "type": "page" 的目标。游戏窗口开着 = 至少一个 page；
#   从「有过 page」变成「连续两次没有 page」= 最后一个游戏窗口关了。
#
# 为什么不会误关你平时用的浏览器：启动器给游戏单独一个配置目录
#（~/Library/Application Support/SSDZClassic/browser-profile），
# 这和平时用的 Chrome 是两个进程；本脚本只按 --user-data-dir=<这个目录>
# 找进程，也只杀那一个主进程。
#
# 用法（启动器内部用）：
#   game-exit-watch.sh --profile <独立配置目录> [--log <日志文件>]
#
# 退出码永远是 0（后台小脚本，失败只写日志，不影响游戏）。

set -u

PROFILE=""
LOG_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --log)     LOG_FILE="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

[ -n "$PROFILE" ] || exit 0
[ -n "$LOG_FILE" ] || LOG_FILE=/dev/null

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

# 游戏专用浏览器的主进程：命令行里带 --user-data-dir=<游戏 profile>，
# 且不是 --type= 的渲染 / GPU / 扩展子进程。
find_browser_pid() {
  ps -axo pid=,command= 2>/dev/null | awk -v pat="--user-data-dir=$PROFILE" '
    index($0, pat) > 0 && $0 !~ /--type=/ { print $1; exit }'
}

# Chrome 把实际调试端口写在配置目录的 DevToolsActivePort 第一行。
devtools_port() {
  [ -s "$PROFILE/DevToolsActivePort" ] || return 1
  local p
  p="$(head -n 1 "$PROFILE/DevToolsActivePort" 2>/dev/null | tr -cd '0-9')"
  [ -n "$p" ] || return 1
  printf '%s' "$p"
}

# 数当前有几个 page 目标（一个游戏窗口 = 一个 page）。
# 用 grep -o 而不是 -c：/json/list 是格式化 JSON，但万一被压成一行也要数对。
count_pages() {
  local port="$1" tmp n
  tmp="$(mktemp "${TMPDIR:-/tmp}/ssdz-devtools.XXXXXX" 2>/dev/null)" || return 1
  if ! curl -fsS -m 2 "http://127.0.0.1:$port/json/list" -o "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  n="$(grep -o '"type"[[:space:]]*:[[:space:]]*"page"' "$tmp" 2>/dev/null | wc -l | tr -d ' ')"
  rm -f "$tmp"
  [ -n "$n" ] || n=0
  printf '%s' "$n"
}

quit_browser() {
  local pid="$1" i
  kill -TERM "$pid" 2>/dev/null || true
  i=0
  while [ "$i" -lt 50 ]; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
    i=$((i + 1))
  done
  log "浏览器 5 秒内没有退出，强制结束（kill -9）"
  kill -KILL "$pid" 2>/dev/null || true
  sleep 0.3
  return 0
}

START_TS=$SECONDS
BROWSER_PID=""
PORT=""
PORT_SINCE=0
SEEN_PAGE=0
EMPTY_STREAK=0

while :; do
  ELAPSED=$((SECONDS - START_TS))

  pid="$(find_browser_pid)"
  if [ -z "$pid" ]; then
    # 刚启动时进程可能还没出现；给 15 秒
    if [ "$ELAPSED" -lt 15 ]; then sleep 0.5; continue; fi
    log "浏览器进程已经退出（或没找到），收尾结束"
    exit 0
  fi
  if [ -z "$BROWSER_PID" ]; then
    BROWSER_PID="$pid"
    log "开始监视游戏专用浏览器：PID $BROWSER_PID"
  elif ! kill -0 "$BROWSER_PID" 2>/dev/null; then
    # 原来的主进程没了、但同 profile 又起了一个（例如退出后马上重开）：改为盯新的
    BROWSER_PID="$pid"
    log "浏览器主进程已更换，改为监视 PID $BROWSER_PID"
  fi

  if [ -z "$PORT" ]; then
    PORT="$(devtools_port || true)"
    if [ -z "$PORT" ]; then
      # 端口文件一直不出现：多半是旧版启动器开的浏览器实例（当时没带调试端口）。
      # 这种情况下没法判断窗口何时关，60 秒后写一行日志退出，绝不误杀。
      if [ "$ELAPSED" -gt 60 ] && [ "$SEEN_PAGE" = "0" ]; then
        log "等不到 DevTools 端口（$PROFILE/DevToolsActivePort）：这个浏览器实例不是本启动器开的（例如旧版启动器留下的窗口），没法判断窗口何时关闭；监视结束。手动退出一次浏览器后再启动就能自动收尾。"
        exit 0
      fi
    fi
  fi

  if [ -n "$PORT" ]; then
    if n="$(count_pages "$PORT" 2>/dev/null)"; then
      [ "$PORT_SINCE" = "0" ] && PORT_SINCE=$SECONDS
      if [ "$n" -gt 0 ] 2>/dev/null; then
        SEEN_PAGE=1
        EMPTY_STREAK=0
      elif [ "$SEEN_PAGE" = "0" ] && [ $((SECONDS - PORT_SINCE)) -gt 20 ]; then
        # 端口已经通了、但 20 秒都没出现游戏窗口：多半是开窗后马上被关掉了，
        # 或者是 --app 窗口根本没建起来 —— 两种情况都把浏览器收掉，别留在 Dock 里。
        log "20 秒内没有出现游戏窗口（page 目标），退出游戏专用浏览器 PID $BROWSER_PID"
        quit_browser "$BROWSER_PID"
        exit 0
      elif [ "$SEEN_PAGE" = "1" ]; then
        EMPTY_STREAK=$((EMPTY_STREAK + 1))
        if [ "$EMPTY_STREAK" -ge 2 ]; then
          # 关窗之前再确认一次：可能刚好又开了一个游戏窗口（第二次双击启动）
          sleep 1
          if n2="$(count_pages "$PORT" 2>/dev/null)" && [ "${n2:-1}" = "0" ]; then
            log "游戏窗口已全部关闭（DevTools 里已经没有 page 目标），退出游戏专用浏览器 PID $BROWSER_PID"
            quit_browser "$BROWSER_PID"
            exit 0
          fi
          EMPTY_STREAK=0
        fi
      fi
    else
      # 端口暂时连不上：可能是浏览器正在退出；清空 PORT，下一轮重新读端口文件
      PORT=""
    fi
  fi

  # 一直没看到过 page（窗口根本没开出来）也不要永远挂着：5 分钟后收手
  if [ "$SEEN_PAGE" = "0" ] && [ "$ELAPSED" -gt 300 ]; then
    log "5 分钟内没看到游戏窗口（page 目标），监视结束"
    exit 0
  fi

  sleep 1
done
