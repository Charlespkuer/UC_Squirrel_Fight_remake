# 松鼠大战 —— Windows：一次性清理「旧布局」残留（让两台机器的目录长得一样）
#
# 这个脚本是 cleanup-old-layout.cmd 的实际执行部分（.cmd 只做 ASCII 外壳：
# cmd.exe 读 .cmd 里的 UTF-8 中文会把中文当命令，所以中文与判断都放在这里）。
#
# 背景：以前两台机器是「平铺布局」——serve.js / serve.py / start-game.ps1 和几个
# 辅助脚本都堆在游戏根目录。现在 Mac 那边已经改成：
#     一级目录：启动游戏.cmd / 启动游戏.command / index.html / css js images audio / save
#     scripts\ ：停止游戏.command、一键同步.*、重启同步服务.cmd、serve.js、serve.py、
#                start-game.ps1、index.html、sync\
#     tools\   ：开发与验证
# Windows 这边同步过去之后，根目录仍留着旧副本（同步工具只增不删，这是为了不丢东西）。
# 本脚本就把这些「已经搬到 scripts\ 里的旧副本」删掉。
#
# 会删的（只删这些，且都会先列出来让你确认）：
#     serve.js  serve.py  start-game.ps1
#     停止游戏.command  一键同步.cmd  一键同步.command  重启同步服务.cmd
#     tools\sync\            （里面的 sync.config.json 会先搬到 scripts\sync\，口令不会丢）
# 不会碰：启动游戏.cmd、启动游戏.command、README.md、.github\、.gitignore、
#         index.html、css\ js\ images\ audio\、save\、scripts\、tools\ 的其它内容
param()

$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
if (-not $here) { $here = (Get-Location).Path }
# scripts\ 的上一层就是游戏根
$root = (Resolve-Path -LiteralPath (Join-Path $here '..')).Path
if (-not (Test-Path -LiteralPath (Join-Path $root 'scripts\index.html'))) {
  Write-Host "找不到 scripts\index.html —— 这个脚本要在游戏目录的 scripts\ 里运行。"
  Read-Host '按回车键关闭'
  exit 1
}

$files = @('serve.js', 'serve.py', 'start-game.ps1',
           '停止游戏.command', '一键同步.cmd', '一键同步.command', '重启同步服务.cmd')
$dirs  = @('tools\sync')

Write-Host ''
Write-Host '松鼠大战 —— 清理旧布局残留'
Write-Host "游戏目录：$root"
Write-Host ''
Write-Host '将要删除（旧副本，正式文件已经在 scripts\ 里了）：'
$found = @()
foreach ($f in $files) {
  $p = Join-Path $root $f
  if (Test-Path -LiteralPath $p) { $found += $p; Write-Host "  [文件] $f" }
}
$foundDirs = @()
foreach ($d in $dirs) {
  $p = Join-Path $root $d
  if (Test-Path -LiteralPath $p) { $foundDirs += $p; Write-Host "  [目录] $d\" }
}
if ($found.Count -eq 0 -and $foundDirs.Count -eq 0) {
  Write-Host '  （没有找到需要清理的东西，目录已经和 Mac 一致了）'
  Read-Host '按回车键关闭'
  exit 0
}
Write-Host ''
Write-Host '不会动：启动游戏.cmd、README.md、.github\、.gitignore、index.html、'
Write-Host '        css\ js\ images\ audio\、save\、scripts\、tools\ 的其它内容'
Write-Host ''
$ans = Read-Host '确认删除这些旧副本吗？输入 y 回车继续，其它键取消'
if ($ans -ne 'y' -and $ans -ne 'Y') { Write-Host '已取消，什么都没做。'; Read-Host '按回车键关闭'; exit 0 }

# 先把旧位置的对端口令搬到新位置，免得下次启动同步服务时重新生成一个新口令、两边对不上
$oldCfg = Join-Path $root 'scripts\sync\sync.config.json'
$legacyCfg = Join-Path $root 'tools\sync\sync.config.json'
if ((Test-Path -LiteralPath $legacyCfg) -and -not (Test-Path -LiteralPath $oldCfg)) {
  Copy-Item -LiteralPath $legacyCfg -Destination $oldCfg -Force
  Write-Host "已把同步配置搬到 scripts\sync\sync.config.json（口令保持原样）"
}

foreach ($p in $found)     { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
foreach ($p in $foundDirs) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host ''
Write-Host '清理完成。现在的目录应该和 Mac 一致了。'
Write-Host ''

# 顺手用新代码重启一次同步服务（会重新注册「隐藏窗口」的计划任务）
$sync = Join-Path $root 'scripts\sync\sync.js'
if (Test-Path -LiteralPath $sync) {
  Write-Host '正在用新代码重启后台同步服务…'
  & node $sync restart
}
Write-Host ''
Read-Host '按回车键关闭'
