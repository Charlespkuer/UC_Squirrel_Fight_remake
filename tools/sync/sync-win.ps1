# 松鼠大战怀旧复刻版 —— Windows：双机同步菜单（Mac ↔ Windows，走 ZeroTier）
#
# 这个脚本是 一键同步.cmd 的实际执行部分。分工原因和启动器一样：cmd.exe 读 UTF-8
# 中文会把中文字节错位、把中文注释当命令，所以 .cmd 只留 ASCII 外壳，中文与逻辑都在这里
# （PowerShell 处理 UTF-8 没问题，但本文件必须带 UTF-8 BOM，否则 Windows PowerShell 5.1
#   会按 ANSI 读，中文全是乱码）。
#
# 真正的同步逻辑在 tools\sync\sync.js（零依赖，Node 就行），Mac 那份是 一键同步.command。
#
# 命令行用法：
#   一键同步.cmd status | save-push | save-pull | files-push | files-pull | discover
#   一键同步.cmd <任意 sync.js 参数>      例：一键同步.cmd push win --save
param([Parameter(ValueFromRemainingArguments = $true)]$Rest)

$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
if (-not $here) { $here = (Get-Location).Path }
$root = $null
foreach ($c in @($here, (Join-Path $here '..'), (Join-Path $here '..\..'))) {
  if (Test-Path -LiteralPath (Join-Path $c 'index.html')) { $root = (Resolve-Path -LiteralPath $c).Path; break }
}
if (-not $root) {
  Write-Host '找不到 index.html：请把整个游戏文件夹一起解压后再运行。'
  Read-Host '按回车键关闭'
  exit 1
}
Set-Location -LiteralPath $root

$sync = Join-Path $root 'tools\sync\sync.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '同步需要 Node.js（https://nodejs.org，装 LTS 版就行）。'
  Write-Host '装好后重新双击 一键同步.cmd。'
  Read-Host '按回车键关闭'
  exit 1
}
if (-not (Test-Path -LiteralPath $sync)) {
  Write-Host "找不到 $sync —— 请把整个游戏文件夹一起解压后再运行。"
  Read-Host '按回车键关闭'
  exit 1
}

function Invoke-Sync([string[]]$SyncArgs) {
  & $node.Source $sync @SyncArgs
  return $LASTEXITCODE
}
function Pause-Menu() { Read-Host '按回车回到菜单' | Out-Null }

# 直接跟参数：非交互用法
if ($Rest.Count -gt 0) {
  $tail = @()
  if ($Rest.Count -gt 1) { $tail = @($Rest[1..($Rest.Count - 1)]) }
  switch ($Rest[0]) {
    'save-push'  { exit (Invoke-Sync (@('push') + $tail + @('--save'))) }
    'save-pull'  { exit (Invoke-Sync (@('pull') + $tail + @('--save'))) }
    'files-push' { exit (Invoke-Sync (@('push') + $tail + @('--files'))) }
    'files-pull' { exit (Invoke-Sync (@('pull') + $tail + @('--files'))) }
    'doctor'     { exit (Invoke-Sync (@('doctor') + $tail)) }
    'prepare'    { exit (Invoke-Sync (@('prepare') + $tail)) }
    'firewall'   { exit (Invoke-Sync (@('firewall') + $tail)) }
    default      { exit (Invoke-Sync @($Rest)) }
  }
}

# 进菜单先把本机接收服务拉起来：这样对面随时能来取/来送
Invoke-Sync @('start') | Out-Null

while ($true) {
  Clear-Host
  Write-Host '=============================================='
  Write-Host '  松鼠大战 · 双机同步（Windows ↔ Mac）'
  Write-Host '=============================================='
  Write-Host '  1) 看看两边现在什么状态'
  Write-Host '  2) 把本机存档送到对端    （本机 → 对端）'
  Write-Host '  3) 从对端取回存档        （对端 → 本机）'
  Write-Host '  4) 把本机改动的文件推过去（本机 → 对端）'
  Write-Host '  5) 把对端改动的文件取回来（对端 → 本机）'
  Write-Host '  6) 只列出会传什么，不动手（先看一眼）'
  Write-Host '  7) 扫描 ZeroTier 网段，找对端'
  Write-Host '  8) 显示同步口令 / 本机 ZeroTier 地址'
  Write-Host '  9) 后台同步服务：启动 / 停止'
  Write-Host '  a) 开机自启：安装 / 取消'
  Write-Host '  c) 自检（连不上先点这个：ZeroTier / 服务 / 防火墙 / 对端）'
  Write-Host '  0) 一键准备（启动服务 + 放行 Windows 防火墙 + 自检）'
  Write-Host '  q) 退出'
  Write-Host ''
  $choice = Read-Host '选一个（0-9/a/c/q）'
  switch ($choice) {
    '1' { Write-Host ''; Invoke-Sync @('status') | Out-Null; Pause-Menu }
    '2' { Write-Host ''; Invoke-Sync @('push', '--save') | Out-Null; Pause-Menu }
    '3' { Write-Host ''; Invoke-Sync @('pull', '--save') | Out-Null; Pause-Menu }
    '4' { Write-Host ''; Invoke-Sync @('push', '--files') | Out-Null; Pause-Menu }
    '5' { Write-Host ''; Invoke-Sync @('pull', '--files') | Out-Null; Pause-Menu }
    '6' {
      Write-Host ''
      Invoke-Sync @('push', '--all', '--dry') | Out-Null
      Write-Host ''
      Invoke-Sync @('pull', '--all', '--dry') | Out-Null
      Pause-Menu
    }
    '7' { Write-Host ''; Invoke-Sync @('discover') | Out-Null; Pause-Menu }
    '8' { Write-Host ''; Invoke-Sync @('init') | Out-Null; Pause-Menu }
    '9' {
      Write-Host ''
      Write-Host '  1) 启动后台同步服务   2) 停止   3) 看状态'
      $sub = Read-Host '选一个'
      switch ($sub) {
        '1' { Invoke-Sync @('start') | Out-Null }
        '2' { Invoke-Sync @('stop') | Out-Null }
        default { Invoke-Sync @('status') | Out-Null }
      }
      Pause-Menu
    }
    'a' {
      Write-Host ''
      Write-Host '  1) 安装开机自启   2) 取消开机自启   3) 看状态'
      $sub = Read-Host '选一个'
      switch ($sub) {
        '1' { Invoke-Sync @('autostart', 'install') | Out-Null }
        '2' { Invoke-Sync @('autostart', 'remove') | Out-Null }
        default { Invoke-Sync @('autostart', 'status') | Out-Null }
      }
      Pause-Menu
    }
    'c' { Write-Host ''; Invoke-Sync @('doctor') | Out-Null; Pause-Menu }
    '0' { Write-Host ''; Invoke-Sync @('prepare') | Out-Null; Pause-Menu }
    'q' { exit 0 }
    'Q' { exit 0 }
    default { Write-Host "看不懂「$choice」"; Start-Sleep -Seconds 1 }
  }
}
