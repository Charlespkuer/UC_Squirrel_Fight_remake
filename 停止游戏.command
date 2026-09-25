#!/bin/bash
# 松鼠大战怀旧复刻版 —— macOS：停掉后台的本地服务器
#
# 双击本文件即可（等价于  bash 启动游戏.command --stop ）。
# 平时不需要手动停：服务器是 nohup 到后台的，重启电脑也会自然结束。
cd "$(dirname "$0")" || exit 1
# 告诉启动器「要关的是 停止游戏 这个窗口」，否则它只会去找 启动游戏.command 的窗口
export SSDZ_WINDOW_TITLE="$(basename "$0")"
exec bash "./启动游戏.command" --stop
