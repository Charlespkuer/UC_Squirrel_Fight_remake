#!/bin/bash
# 松鼠大战怀旧复刻版 —— macOS：双机同步（Mac ↔ Windows，走 ZeroTier）
#
# 双击本文件就有一个菜单：送存档、取存档、推文件、拉文件、扫对端、开关后台服务。
# 真正的逻辑在 scripts/sync/sync.js（零依赖，Node 就行；Windows 那份是 scripts/一键同步.cmd）。
#
# 命令行也行：
#   bash 一键同步.command status
#   bash 一键同步.command save-push  /  save-pull
#   bash 一键同步.command files-push /  files-pull
#   bash 一键同步.command discover / start / stop / watch / token / autostart
HERE="$(cd "$(dirname "$0")" && pwd)" || exit 1
# 本文件在 scripts/ 里，游戏根（有 index.html 的那层）是上一层
ROOT=""
for c in "$HERE/.." "$HERE" "$HERE/../.."; do
  if [ -f "$c/scripts/index.html" ] || [ -f "$c/index.html" ]; then ROOT="$(cd "$c" && pwd)"; break; fi
done
if [ -z "$ROOT" ]; then
  echo "找不到游戏目录（应该有 index.html）：请把整个文件夹一起解压后再运行。"
  printf '按回车键关闭…'; read -r _
  exit 1
fi
cd "$ROOT" || exit 1
SYNC="$ROOT/scripts/sync/sync.js"
[ -f "$SYNC" ] || SYNC="$ROOT/tools/sync/sync.js"

if ! command -v node >/dev/null 2>&1; then
  echo "同步需要 Node.js（https://nodejs.org，装 LTS 版就行）。"
  echo "装好后重新双击本文件。"
  printf '按回车键关闭…'; read -r _
  exit 1
fi
if [ ! -f "$SYNC" ]; then
  echo "找不到 $SYNC —— 请把整个游戏文件夹一起解压后再运行。"
  printf '按回车键关闭…'; read -r _
  exit 1
fi

# 直接跟参数：非交互用法（脚本、快捷指令）
if [ "$#" -gt 0 ]; then
  case "$1" in
    save-push)  shift; exec node "$SYNC" push "$@" --save ;;
    save-pull)  shift; exec node "$SYNC" pull "$@" --save ;;
    files-push) shift; exec node "$SYNC" push "$@" --files ;;
    files-pull) shift; exec node "$SYNC" pull "$@" --files ;;
    doctor|prepare|firewall) exec node "$SYNC" "$@" ;;
    *) exec node "$SYNC" "$@" ;;
  esac
fi

pause() { printf '\n按回车回到菜单…'; read -r _; }
run() { echo; echo "———— $1 ————"; shift; "$@"; echo; pause; }

# 进菜单先把本机接收服务拉起来：这样对面随时能来取/来送
node "$SYNC" start >/dev/null 2>&1 || true

while true; do
  clear 2>/dev/null || true
  echo "=============================================="
  echo "  松鼠大战 · 双机同步（Mac ↔ Windows）"
  echo "=============================================="
  echo "  1) 看看两边现在什么状态"
  echo "  2) 把本机存档送到对端    （本机 → 对端）"
  echo "  3) 从对端取回存档        （对端 → 本机）"
  echo "  4) 把本机改动的文件推过去（本机 → 对端）"
  echo "  5) 把对端改动的文件取回来（对端 → 本机）"
  echo "  6) 只列出会传什么，不动手（先看一眼）"
  echo "  7) 扫描 ZeroTier 网段，找对端"
  echo "  8) 显示同步口令 / 本机 ZeroTier 地址"
  echo "  9) 后台同步服务：启动 / 停止"
  echo "  a) 开机自启：安装 / 取消"
  echo "  c) 自检（连不上先点这个：ZeroTier / 服务 / 防火墙 / 对端）"
  echo "  q) 退出"
  echo
  printf '选一个（1-9/a/c/q）：'
  read -r choice
  case "$choice" in
    1) run "状态" node "$SYNC" status ;;
    2) run "送存档到对端" node "$SYNC" push --save ;;
    3) run "从对端取存档" node "$SYNC" pull --save ;;
    4) run "推文件到对端（较新的本机文件）" node "$SYNC" push --files ;;
    5) run "从对端拉文件（较新的对端文件）" node "$SYNC" pull --files ;;
    6) echo; node "$SYNC" push --all --dry; echo; node "$SYNC" pull --all --dry; pause ;;
    7) run "扫描对端" node "$SYNC" discover ;;
    8) run "同步口令 / 地址" node "$SYNC" init ;;
    9)
      echo
      echo "  1) 启动后台同步服务   2) 停止   3) 看状态"
      printf '选一个：'
      read -r sub
      case "$sub" in
        1) node "$SYNC" start ;;
        2) node "$SYNC" stop ;;
        *) node "$SYNC" status ;;
      esac
      pause ;;
    a)
      echo
      echo "  1) 安装开机自启   2) 取消开机自启   3) 看状态"
      printf '选一个：'
      read -r sub
      case "$sub" in
        1) node "$SYNC" autostart install ;;
        2) node "$SYNC" autostart remove ;;
        *) node "$SYNC" autostart status ;;
      esac
      pause ;;
    c|C) run "自检" node "$SYNC" doctor ;;
    q|Q) exit 0 ;;
    *) echo "看不懂「$choice」"; sleep 1 ;;
  esac
done
