#!/bin/bash
# 松鼠大战怀旧复刻版 —— macOS：停掉后台的本地服务器
#
# 双击本文件即可（等价于  bash 启动游戏.command --stop ）。
# 平时不需要手动停：服务器是 nohup 到后台的，重启电脑也会自然结束。
HERE="$(cd "$(dirname "$0")" && pwd)" || exit 1
cd "$HERE/.." || exit 1          # 启动器（启动游戏.command）在上一层
if [ ! -f "./启动游戏.command" ]; then
  echo "找不到 启动游戏.command：它应该和 index.html 在同一个文件夹里。"
  printf '按回车键关闭…'; read -r _
  exit 1
fi
# 告诉启动器「要关的是 停止游戏 这个窗口」，否则它只会去找 启动游戏.command 的窗口
export SSDZ_WINDOW_TITLE="$(basename "$0")"
exec bash "./启动游戏.command" --stop
