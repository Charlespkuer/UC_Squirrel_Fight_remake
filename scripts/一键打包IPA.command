#!/bin/bash
# 松鼠大战怀旧复刻版 —— macOS 一键打包并签名两个 IPA
#
# 双击：自动 patch 版本 → 构建 iOS 25–26（UIScene）+ iOS 16–24（legacy）
#       → 企业签名 → 删除 src-tauri/dist 里除这两个签名包外的全部 .ipa
#
# 命令行：
#   bash scripts/一键打包IPA.command
#   bash scripts/一键打包IPA.command --dry-run
#   bash scripts/一键打包IPA.command --version 1.0.6
#   bash scripts/一键打包IPA.command --no-bump
#   bash scripts/一键打包IPA.command --build 120
#
# 真正逻辑在 tools/build-ios-release.cjs；这里只负责找游戏根、检查 Node、保持窗口。

HERE="$(cd "$(dirname "$0")" && pwd)" || exit 1
ROOT="$(cd "$HERE/.." && pwd)" || exit 1
if [ ! -f "$ROOT/src-tauri/tauri.conf.json" ] || [ ! -f "$ROOT/tools/build-ios-release.cjs" ]; then
  echo "找不到游戏工程（需要 src-tauri/tauri.conf.json 和 tools/build-ios-release.cjs）。"
  echo "请把整个游戏文件夹一起解压后再运行。"
  printf '按回车键关闭…'; read -r _
  exit 1
fi
cd "$ROOT" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "打包需要 Node.js（https://nodejs.org，装 LTS 版就行）。"
  printf '按回车键关闭…'; read -r _
  exit 1
fi

node tools/build-ios-release.cjs "$@"
CODE=$?

# 双击运行时保持窗口，方便看版本号、产物和报错；带参数时按命令行习惯直接退出。
if [ "$#" -eq 0 ] && [ -t 0 ]; then
  echo
  printf '按回车键关闭…'
  read -r _
fi
exit "$CODE"
