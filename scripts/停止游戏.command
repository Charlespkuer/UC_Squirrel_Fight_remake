#!/bin/bash
# 松鼠大战怀旧复刻版 —— macOS：停掉后台的本地服务器
#
# 双击本文件即可（等价于  bash scripts/启动游戏.command --stop ）。
# 平时不需要手动停：服务器是 nohup 到后台的，重启电脑也会自然结束。
HERE="$(cd "$(dirname "$0")" && pwd)" || exit 1
cd "$HERE" || exit 1              # 启动器（启动游戏.command）和本文件同在 scripts/ 里
if [ ! -f "./启动游戏.command" ]; then
  echo "找不到 scripts/启动游戏.command：请确认 scripts/ 文件夹完整。"
  printf '按回车键关闭…'; read -r _
  exit 1
fi
exec bash "./启动游戏.command" --stop
