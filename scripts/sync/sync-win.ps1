# 松鼠大战怀旧复刻版 —— Windows：双机同步菜单（Mac ↔ Windows，走 ZeroTier）
#
# 这个脚本是 一键同步.cmd 的实际执行部分。分工原因和启动器一样：cmd.exe 读 UTF-8
# 中文会把中文字节错位、把中文注释当命令，所以 .cmd 只留 ASCII 外壳，中文与逻辑都在这里
# （PowerShell 处理 UTF-8 没问题，但本文件必须带 UTF-8 BOM，否则 Windows PowerShell 5.1
#   会按 ANSI 读，中文全是乱码）。
#
# 真正的同步逻辑是 sync.js（零依赖，Node 就行）：本仓库在 scripts\sync\sync.js，
# 发布包里在 tools\sync\sync.js。Mac 那份是 一键同步.command。
#
# 命令行用法：
#   一键同步.cmd status | save-push | save-pull | files-push | files-pull | discover
#   一键同步.cmd <任意 sync.js 参数>      例：一键同步.cmd push win --save
param([Parameter(ValueFromRemainingArguments = $true)]$Rest)

$ErrorActionPreference = 'Continue'

# node 的输出是 UTF-8；Windows PowerShell 5.1 默认按本地代码页（简体中文是 GBK）解码
# 外部程序输出，中文会变乱码。这里显式按 UTF-8 解码（失败就算了，不影响功能）。
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$here = $PSScriptRoot
if (-not $here) { $here = (Get-Location).Path }
# 先找同步逻辑 sync.js。两种布局都要认，所以从本脚本所在目录往上逐层找：
#   本仓库布局：<仓库>\scripts\sync\sync.js     ← 与本脚本同级
#   发布包布局：<游戏根>\tools\sync\sync.js
# 之前的写法只认 <根>\tools\sync\sync.js，于是本仓库里会被判成"文件缺失"。
$sync = $null
foreach ($c in @($here, (Join-Path $here '..'), (Join-Path $here '..\..'), (Join-Path $here '..\..\..'))) {
  if (-not (Test-Path -LiteralPath $c)) { continue }
  foreach ($rel in @('sync.js', 'sync\sync.js', 'tools\sync\sync.js')) {
    $cand = Join-Path $c $rel
    if (Test-Path -LiteralPath $cand) { $sync = (Resolve-Path -LiteralPath $cand).Path; break }
  }
  if ($sync) { break }
}

# 游戏根 = sync.js 往上两层（与 sync.js 自己的算法 ROOT = dirname(sync.js)\..\.. 一致，
# 免得启动器和同步逻辑对"根在哪"的判断不一致）。
$root = $null
if ($sync) {
  # 注意：Windows PowerShell 5.1 的 Split-Path **没有** -LiteralPath 参数
  # （那是 PowerShell 6+ 才有的），所以这里用 .NET 取目录名。
  $syncDir = [System.IO.Path]::GetDirectoryName($sync)
  $root = [System.IO.Path]::GetFullPath((Join-Path $syncDir '..\..'))
}

# 兜底：老办法找 index.html（兼容别的打包布局）。注意本仓库的入口 HTML 在 scripts\index.html，
# 不在仓库根，所以两个位置都要认。
if (-not $root) {
  foreach ($c in @($here, (Join-Path $here '..'), (Join-Path $here '..\..'))) {
    if ((Test-Path -LiteralPath (Join-Path $c 'index.html')) -or
        (Test-Path -LiteralPath (Join-Path $c 'scripts\index.html'))) {
      $root = (Resolve-Path -LiteralPath $c).Path; break
    }
  }
}
if (-not $root) {
  Write-Host '找不到游戏目录（应该有 scripts\index.html 或 index.html）：请把整个文件夹一起解压后再运行。'
  Read-Host '按回车键关闭'
  exit 1
}
Set-Location -LiteralPath $root

if (-not $sync) { $sync = Join-Path $root 'scripts\sync\sync.js' }
if (-not (Test-Path -LiteralPath $sync)) { $sync = Join-Path $root 'tools\sync\sync.js' }
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
  # 两个坑一起处理：
  #  1) node 的 stdout 默认会变成本函数的「成功流」输出，而调用点全都写成
  #     `Invoke-Sync ... | Out-Null`（本意是丢掉返回的退出码），结果把该显示的
  #     内容也一起丢了 —— 菜单里每一项一片空白就是这个原因。
  #  2) `2>&1` 之后 PowerShell 5.1 会把 node 的 stderr 包成 ErrorRecord，直接
  #     打出来是一大段红字 NativeCommandError（双击运行时看着像崩溃）。
  # 所以：先把两路输出都收成纯字符串，再统一用 Write-Host 打到控制台；
  # 退出码在管道之后立刻取（ForEach-Object 不会改它），单独返回。
  # 取值要绕一下：node 输出里的**空行**在 2>&1 之后会变成 Exception 为
  # RemoteException 的 ErrorRecord，直接 [string] 会得到
  # "System.Management.Automation.RemoteException"；取 TargetObject /
  # Exception.Message 才是那一行的原文（空行就是空字符串）。
  $lines = & $node.Source $sync @SyncArgs 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) {
      $t = [string]$_.TargetObject
      if (-not $t) { $t = [string]$_.Exception.Message }
      $t
    } else { [string]$_ }
  }
  $code = $LASTEXITCODE
  if ($lines) { $lines | ForEach-Object { Write-Host $_ } }
  return $code
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
