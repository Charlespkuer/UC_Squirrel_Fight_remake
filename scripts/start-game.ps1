# 松鼠大战怀旧复刻版 —— Windows 启动器（主体）
#
# 这个脚本是 启动游戏.cmd 的实际执行部分。分工原因：cmd.exe 读 .cmd 里的 UTF-8
# 中文（尤其是文件中间改代码页 chcp 65001 时）会把中文字节错位、把中文注释当成命令，
# 结果就是「服务器没起来，浏览器却打开了」——正是玩家反馈的「没有本地服务器接口」。
# 所以 .cmd 只留 ASCII 外壳，中文提示与判断逻辑都在这里（PowerShell 处理 UTF-8 没问题）。
#
# 用法：启动游戏.cmd [端口] [--no-save] [--browser] [--stop]（脚本就在游戏目录里）
#   --no-save  只读模式，不写 save\progress.json
#   --browser  不走原生窗口，改用浏览器的「应用窗口」打开（默认优先原生窗口）
#
# 打开顺序：①本机已经编译好的 Tauri 桌面版（src-tauri\target\release\ssdz-classic.exe）
#           → 真正的原生窗口，完全不经过浏览器；
#           ②没有原生版 → 起本地服务器，再用 Chrome/Edge 的 --app= 应用窗口打开。

$ErrorActionPreference = 'Continue'

# ---------- 参数 ----------
$port = 8080
$serverArgs = @()
$forceBrowser = $false
foreach ($a in $args) {
  if ($a -match '^\d+$') { $port = [int]$a }
  elseif ($a -eq '--browser' -or $a -eq '--app') { $forceBrowser = $true }
  elseif ($a -eq '--no-save') { $serverArgs += '--no-save' }
}
$serverArgs = @([string]$port) + $serverArgs
$appMode = -not $forceBrowser
$url = "http://127.0.0.1:$port/"

# ---------- 定位游戏根目录（脚本就在游戏目录里；万一被挪进子目录，就往上找一层）----------
$here = $PSScriptRoot
if (-not $here) { $here = (Get-Location).Path }
$root = $null
foreach ($c in @((Join-Path $here '..'), $here, (Join-Path $here 'game'))) {
  if ((Test-Path -LiteralPath (Join-Path $c 'scripts\index.html')) -or
      (Test-Path -LiteralPath (Join-Path $c 'index.html'))) { $root = (Resolve-Path -LiteralPath $c).Path; break }
}
if (-not $root) {
  Write-Host '找不到游戏文件（应该有 scripts\index.html）：请把整个文件夹一起解压后再双击启动器。'
  exit 2
}
Set-Location -LiteralPath $root

Write-Host '松鼠大战怀旧复刻版'
Write-Host "目录：$root"

# 入口页：新布局在 scripts\ 里、旧布局在根目录；file:// 兜底打开时要用完整路径
$entry = Join-Path $root 'index.html'
if (Test-Path -LiteralPath (Join-Path $root 'scripts\index.html')) { $entry = Join-Path $root 'scripts\index.html' }

# 游戏目录告诉存档代码（Tauri 桌面版会用它决定 save 放哪；没有它就只能猜）
$env:SSDZ_GAME_DIR = $root
$saveDir = Join-Path $root 'save'
$srvPidFile = Join-Path $saveDir '.server.pid'

# ---------- 存档体检：正式存档读不出来时，从 backup\ 里挑等级最高的补回来 ----------
function Get-SaveLevel([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return 0 }
  try { return [int](Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json).level } catch { return 0 }
}
function Repair-Save {
  $progress = Join-Path $saveDir 'progress.json'
  if ((Get-SaveLevel $progress) -gt 0) { return }
  $backupDir = Join-Path $saveDir 'backup'
  if (-not (Test-Path -LiteralPath $backupDir)) { return }
  $best = $null; $bestLevel = 0
  foreach ($f in Get-ChildItem -LiteralPath $backupDir -Filter '*.json' -File -ErrorAction SilentlyContinue) {
    $lv = Get-SaveLevel $f.FullName
    if ($lv -gt $bestLevel) { $bestLevel = $lv; $best = $f }
  }
  if ($best) {
    Copy-Item -LiteralPath $best.FullName -Destination $progress -Force
    Set-Content -LiteralPath (Join-Path $saveDir '.min-level') -Value $bestLevel -Encoding ASCII
    Write-Host "存档体检：progress.json 读不出来，已从备份恢复（$bestLevel 级 ← $($best.Name)）"
  } else {
    Write-Host '存档体检：progress.json 读不出来，backup\ 里也没有可用备份。'
  }
}
if (-not ($args -contains '--stop')) { Repair-Save }

# ---------- --stop：停掉上一次留在后台的本地服务器 ----------
if ($args -contains '--stop') {
  $stopped = $false
  if (Test-Path -LiteralPath $srvPidFile) {
    $srvId = (Get-Content -LiteralPath $srvPidFile -Raw).Trim()
    if ($srvId -match '^\d+$' -and (Get-Process -Id ([int]$srvId) -ErrorAction SilentlyContinue)) {
      Stop-Process -Id ([int]$srvId) -Force -ErrorAction SilentlyContinue
      $stopped = $true
    }
    Remove-Item -LiteralPath $srvPidFile -Force -ErrorAction SilentlyContinue
  }
  if ($stopped) { Write-Host '已经停掉后台的本地服务器。' } else { Write-Host '没有找到正在运行的后台服务器。' }
  exit 0
}

# ---------- 优先：已经编译好的原生窗口（Tauri 轻壳）----------
# 轻壳（src-tauri\dist\ssdz-classic.exe，几 MB）自己不存前端：它启动时找游戏目录里的
# index.html，用一个内置的迷你服务器供起来，存档也走游戏目录的 save/progress.json，
# 所以和网页版是同一份代码、同一个存档文件。旧的 target\release 路径也认（兼容）。
# 原生窗口偶尔会在启动几秒内自己退出（WebView2 初始化被打断，实测大约十次里有一两次），
# 所以启动后确认一下它还活着；连着三次都不行就自动退回浏览器路线，而不是丢给用户一个空白。
$desktop = @(
  (Join-Path $root 'src-tauri\dist\ssdz-classic.exe'),
  (Join-Path $root 'src-tauri\target\release\ssdz-classic.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ((-not $forceBrowser) -and $desktop) {
  # 已经开着一个就别再开第二个：两个实例写同一份存档会互相覆盖
  if (Get-Process -Name 'ssdz-classic' -ErrorAction SilentlyContinue) {
    Write-Host '桌面版已经在运行了（看任务栏），不再重复打开。'
    exit 0
  }
  Write-Host '打开方式：原生窗口（Tauri 桌面版）'
  $launched = $false
  for ($i = 1; $i -le 3; $i++) {
    $proc = Start-Process -FilePath $desktop -WorkingDirectory $root -PassThru
    Start-Sleep -Milliseconds 1200
    if (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) { $launched = $true; break }
    if ($i -lt 3) { Write-Host '  窗口没稳住，重试一次…' }
  }
  if ($launched) { exit 0 }
  Write-Host '[!] 原生窗口连续三次都没起来，改用浏览器路线。'
  $forceBrowser = $true
}

# ---------- 找 Chromium 系浏览器（「应用窗口」模式要用它）----------
$browser = $null
foreach ($p in @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'))) {
  if ($p -and (Test-Path -LiteralPath $p)) { $browser = $p; break }
}
$profileDir = Join-Path $env:LocalAppData 'SSDZClassic\browser-profile'

# --reset-profile：清掉独立窗口的浏览器缓存（localStorage 兜底档）。
# 正式存档是 save\progress.json，和这个目录无关；这里只改名不删除，误清了也能拿回来。
if (($args -contains '--reset-profile') -and (Test-Path -LiteralPath $profileDir)) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  try { Rename-Item -LiteralPath $profileDir -NewName ("browser-profile.bak-" + $stamp) -ErrorAction Stop; Write-Host "浏览器缓存目录已改名保留：browser-profile.bak-$stamp" }
  catch { Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue }
}

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}
function Test-SaveApi([string]$u) {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "${u}__save?meta=1").StatusCode -eq 200 } catch { return $false }
}
function Open-Game {
  if ($appMode -and $browser) {
    # 应用窗口用独立配置目录：不污染游戏目录，也不和你平常的浏览器混在一起
    Start-Process -FilePath $browser -ArgumentList "--app=$url", '--window-size=1216,760', "--user-data-dir=$profileDir"
  } else {
    Start-Process $url
  }
}

# ---------- 端口被占用时不要硬起服务器 ----------
if (Test-Port $port) {
  if (Test-SaveApi $url) {
    Write-Host "端口 $port 上已经有一个带存档接口的服务器在跑，直接用它（不再新起一个）。"
    Open-Game
    exit 0
  }
  Write-Host ''
  Write-Host "[x] 端口 $port 被别的程序占用了，而且它没有游戏存档接口"
  Write-Host '    （最常见的是还开着以前用 python -m http.server 起的旧服务器，'
  Write-Host '      或者另一个已经打开的游戏窗口）。这样打开只会显示'
  Write-Host '      「没有本地服务器接口」，所以这里不再替你打开浏览器。'
  Write-Host '    先关掉那个程序，或者换个端口重新双击，例如：启动游戏.cmd 8081'
  Write-Host ''
  exit 1
}

# ---------- 起服务器（Node 优先，其次 Python），等它真的监听后再开窗口 ----------
$node = Get-Command node -ErrorAction SilentlyContinue
$py = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python -ErrorAction SilentlyContinue }
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }

$serveJs = Join-Path $here 'serve.js'
if (-not (Test-Path -LiteralPath $serveJs)) { $serveJs = Join-Path $root 'serve.js' }
$servePy = Join-Path $here 'serve.py'
if (-not (Test-Path -LiteralPath $servePy)) { $servePy = Join-Path $root 'serve.py' }

$exe = $null; $pre = @(); $label = ''
if ($node -and (Test-Path -LiteralPath $serveJs)) {
  $exe = $node.Source; $pre = @($serveJs); $label = 'Node.js'
} elseif ($py -and (Test-Path -LiteralPath $servePy)) {
  $exe = $py.Source; $pre = @($servePy); $label = 'Python'
}

if ($exe) {
  Write-Host "服务器：$label（存档 → save\progress.json）"
  # 服务器放到后台（隐藏窗口）：双击后 cmd 窗口立刻关掉，不会一直挂在桌面上。
  # 想停掉它：启动游戏.cmd --stop（或者重启电脑）。
  New-Item -ItemType Directory -Force -Path $saveDir | Out-Null
  $srvOut = Join-Path $saveDir 'server.out.log'
  $srvErr = Join-Path $saveDir 'server.err.log'
  $srv = Start-Process -FilePath $exe -ArgumentList ($pre + $serverArgs) -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $srvOut -RedirectStandardError $srvErr
  $up = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 250
    if ($srv.HasExited) { break }
    if (Test-Port $port) { $up = $true; break }
  }
  if (-not $up) {
    Write-Host ''
    Write-Host "[x] 服务器没能在这个端口上起来（端口 $port）。"
    Write-Host "    服务器的输出在 save\server.out.log 与 save\server.err.log。"
    Write-Host '    常见原因是端口又被别的程序抢走了，换一个端口再试：启动游戏.cmd 8081'
    if (-not $srv.HasExited) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
    exit 1
  }
  Set-Content -LiteralPath $srvPidFile -Value $srv.Id -Encoding ASCII
  Open-Game
  # 开窗口之后再做一次存档接口自检：真的能读到 progress.json 才算启动成功，
  # 免得出现「窗口开了、但游戏读不到存档」这种最难排查的静默状态。
  try {
    $body = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "${url}__save").Content
    if ($body -match '"ok"\s*:\s*true') {
      Write-Host '存档接口自检：正常（游戏会读写 save\progress.json）'
      # 旧代码的服务器没有备份接口：不算致命，但导入存档时不能自动备份旧档
      try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "${url}__save/backup" }
      catch { Write-Host '[!] 现在这个服务器是旧版本（没有备份接口）。建议：先双击 停止游戏.cmd，再双击本文件重启一次。' }
    } else {
      Write-Host '[!] 存档接口自检没通过：游戏窗口可能退回浏览器兜底存档（save\server.err.log）'
    }
  } catch {
    Write-Host '[!] 存档接口自检没通过：游戏窗口可能退回浏览器兜底存档（save\server.err.log）'
  }
  exit 0
}

Write-Host '既没有 Node.js 也没有 Python：进度只能存在浏览器里（localStorage）。'
Write-Host '装一个 Node.js（https://nodejs.org）后重新双击本文件，就能把进度写进 save\progress.json。'
if ($appMode -and $browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$([System.Uri]::new($entry).AbsoluteUri)", '--window-size=1216,760', '--allow-file-access-from-files'
} else {
  Start-Process $entry
}
exit 3
