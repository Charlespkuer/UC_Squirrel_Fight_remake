<#
  build-release.ps1 —— 松鼠大战怀旧版 · 一键出包（Windows + 安卓 + Mac 远程 iOS）

  一条命令做完六件事：
    1) 版本号对齐：**优先**从 `src-tauri\dist` 里上一版产物的**文件名**读出上一个版本号
       （它比 scripts\version.json 更贴近现实），再 patch +1（+0.0.1）；读不到（目录空/不存在/
       名字里没有 x.y.z）才回退成 scripts\version.json patch +1。然后把版本号写进
       scripts\version.json / src-tauri(Cargo.toml / Cargo.lock / package.json / tauri.conf.json)
       / 安卓 tauri.properties
    2) 删掉 src-tauri\dist 里**上一个版本**的 exe / apk（只删本次不产出的，精确到文件）
    3) 编 Windows 轻壳 exe + NSIS 安装包（真正干活的是 tools\build-tauri-app.cjs）
    4) 编安卓 APK（真正干活的是 tools\build-apk.ps1：**原地构建**，中文路径/NDK 那些坑都注释在里面）
    5) 把本轮源码快照送到 Mac，顺序编现代 / legacy 未签名 IPA 并回传 src-tauri\dist
    6) 删掉为了打包而生成的缓存（target\ / Gradle build\ / web\ 等，通常 5~10 GB）

  为什么要有这个脚本：上面三件事各自都有专门的脚本，但「先对齐版本 → 清旧包 → 出包 →
  改名 → 清 10 GB 缓存」这一串每次发版都要手工敲一遍，漏一步就是「装了个旧版本」或者
  「C 盘少 10 GB」。这里把它们串起来，并且**每一步都先体检、失败就停**。

  最省事（仓库根目录**双击**，或在命令行里跑）：
    打包.cmd        # 一键全套：版本号 patch +1 → exe / 安装包 / APK / IPA → 清 Windows 缓存
    清缓存.cmd      # 一键回收磁盘（等价于下面的 -CleanOnly，不打包也不动 dist 里的产物）
  这两个 .cmd 只是薄壳：自动挑 pwsh / powershell（本机可能只装了后者），参数原样转给本脚本。
  用 PowerShell 直接跑也行（没有 pwsh 就换 powershell）：
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-release.ps1          # 自动下一版，出全套
                                                                                          # 例：0.4.8 → 0.4.9
    powershell ... -Version 0.5.0        # 指定版本
    powershell ... -NoBump               # 不动版本号，按当前版本出包
    powershell ... -DryRun               # 只打印计划，不写任何文件
    powershell ... -SkipApk -SkipIos      # 只出 Windows
    powershell ... -SkipIos              # Mac 不在线时，只打本机 Windows / 安卓
    powershell ... -IosVariant legacy    # 只打 iOS 15~25；默认 both 出两种 IPA
    powershell ... -SkipInstaller        # 不出 66 MB 的安装包
    powershell ... -Name 松鼠大战怀旧版   # 换安装包 / APK 的基名
    powershell ... -ApkName '{name}-{version}-{abi}.apk'
    powershell ... -CleanOnly            # 只清缓存，不打包
    powershell ... -KeepCache            # 打完保留缓存（下次编得快）

  名称模板占位符：{name} 基名 / {version} 版本号 / {abi} 安卓 ABI / {arch} Windows 架构 / {date} 今天
  默认：{name} = tauri.conf.json 的 productName（squirrel_fight）
        轻壳 exe = {name}.exe（**不能乱改**：启动器按这个名字找原生窗口）
        安装包   = {name}_{version}_{arch}-setup.exe
        APK      = {name}_{version}_{abi}.apk
#>
[CmdletBinding()]
param(
  # 目标版本号（如 0.4.7）。不给就按当前版本 patch +1；配 -NoBump 则保持当前版本。
  [string]$Version,
  # 产物基名。不给就读 src-tauri\tauri.conf.json 的 productName。
  [string]$Name,
  # 三个产物的名称模板，可各自覆盖。
  [string]$ExeName       = '{name}.exe',
  [string]$InstallerName = '{name}_{version}_{arch}-setup.exe',
  [string]$ApkName       = '{name}_{version}_{abi}.apk',

  [ValidateSet('arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86')]
  [string]$Abi = 'arm64-v8a',
  # 安卓侧默认编 release 的 .so（体积小一半多）；-DebugApk 编 debug。
  [switch]$DebugApk,

  [switch]$SkipExe,
  [switch]$SkipInstaller,
  [switch]$SkipApk,
  [switch]$SkipIos,
  # 复用双机同步的 peer / token，不需要 SSH；现代版和旧系统版在 Mac 上顺序构建。
  [string]$IosPeer = 'mac',
  [ValidateSet('both', 'modern', 'legacy')]
  [string]$IosVariant = 'both',
  [switch]$KeepCache,
  [switch]$NoBump,
  [switch]$CleanOnly,
  [switch]$DryRun,
  # 连 ~\.gradle\caches 一起清（那是全局 Gradle 缓存，清了下次要重新下载依赖）
  [switch]$DeepClean,

  # 本机现成的安卓工具链（换机器时用参数覆盖）
  [string]$Jdk = 'E:\Android\jdk-17.0.20.1+1',
  [string]$Sdk = 'E:\Android\sdk',
  [string]$NdkVersion = '27.0.12077973'
)

$ErrorActionPreference = 'Continue'
# 说明：外部命令（cargo / gradle / tauri）会把进度写到 stderr，PowerShell 在 Stop 模式下
# 会把它当致命错误掐死脚本。所以下面每一步都自己检查 $LASTEXITCODE / Test-Path。

# -CleanOnly = 只回收磁盘：不打包、不动版本号、**也不删 dist 里现有的产物**
if ($CleanOnly) { $SkipExe = $true; $SkipInstaller = $true; $SkipApk = $true; $SkipIos = $true }

# ============================================================
# 【BR0】小工具
# ============================================================
function Say($m) { Write-Host ''; Write-Host "== $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "   ✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   ! $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "   ✗ $m" -ForegroundColor Red; exit 1 }
function Note($m) { Write-Host "   $m" -ForegroundColor DarkGray }

function Write-Utf8NoBom($path, $text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $enc)
}
function Read-Text($path) { return [System.IO.File]::ReadAllText($path) }

# 只替换**第一个**匹配（分组 1 前缀 + 新值 + 分组 2 后缀），没匹配到返回 $null。
# 分组 2 可以不存在（整行替换的场景）。
# 注意别用 [regex]::Replace($t,$p,$sb,1) —— 那个 4 参静态重载第 4 个参数是 RegexOptions，
# 传 1 等于「忽略大小写 + 替换全部」，不是「只替换 1 处」。
function Replace-First($text, $pattern, $value) {
  $re = New-Object System.Text.RegularExpressions.Regex($pattern)
  if (-not $re.IsMatch($text)) { return $null }
  return $re.Replace($text, {
      param($m)
      $suffix = ''
      if ($m.Groups.Count -gt 2) { $suffix = $m.Groups[2].Value }
      return $m.Groups[1].Value + $value + $suffix
    }, 1)
}

# 本机可能只装了 Windows PowerShell 5.1（没有 pwsh）——APK 那步要重入一个 PowerShell，
# 用当前宿主自己的 exe 最稳，别写死 pwsh。
function Get-PsHost {
  foreach ($n in @('pwsh.exe', 'powershell.exe')) {
    $p = Join-Path $PSHOME $n
    if (Test-Path $p) { return $p }
  }
  $c = Get-Command powershell -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return 'powershell.exe'
}

function Get-DirSize($dir) {
  if (-not (Test-Path $dir)) { return 0 }
  $sum = (Get-ChildItem -LiteralPath $dir -Recurse -File -Force -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) { return 0 }
  return [int64]$sum
}
function Fmt-Size($bytes) {
  if ($bytes -ge 1GB) { return ('{0:N2} GB' -f ($bytes / 1GB)) }
  if ($bytes -ge 1MB) { return ('{0:N1} MB' -f ($bytes / 1MB)) }
  return ('{0:N0} KB' -f ($bytes / 1KB))
}

$ROOT = Split-Path -Parent $PSScriptRoot
$TAURI = Join-Path $ROOT 'src-tauri'
$DIST = Join-Path $TAURI 'dist'
$START = Get-Date

# ============================================================
# 【BR1】体检：工具链在不在
# ============================================================
Say '环境体检'

$cargo = $null
foreach ($c in @('cargo', (Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'))) {
  $exe = $c
  if ($c -eq 'cargo') { $exe = (Get-Command cargo -ErrorAction SilentlyContinue).Source }
  if ($exe -and (Test-Path $exe)) { $cargo = $exe; break }
  if ($c -ne 'cargo' -and (Test-Path $c)) { $cargo = $c; break }
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$cli = Join-Path $TAURI 'node_modules\@tauri-apps\cli\tauri.js'

$needExe = (-not $SkipExe) -or (-not $SkipInstaller)
$needApk = (-not $SkipApk) -and (-not $CleanOnly)
$needIos = (-not $SkipIos) -and (-not $CleanOnly)
$iosHelper = Join-Path $ROOT 'tools\build-ios-remote.cjs'

if (-not $CleanOnly) {
  if (-not $node) { Die '找不到 node（https://nodejs.org）' }
  if (($needExe -or $needApk) -and -not (Test-Path $cli)) { Die "找不到 Tauri CLI：$cli（先在 src-tauri 下 npm install）" }
  if ($needExe -and -not $cargo) { Die '找不到 cargo（https://rustup.rs）' }
  if ($needApk) {
    # 安卓原地构建要求仓库路径纯 ASCII（NDK 的 clang.cmd 按 GBK 传参，中文路径 linker 必挂；
    # 2026-10 之前的做法是复制到 E:\ssdz-android-build 构建，现已改为原地——见 build-apk.ps1 第 1 条）
    if ($ROOT -match '[^\x00-\x7F]') { Die "仓库路径含非 ASCII（$ROOT）：请把仓库移到纯 ASCII 路径后再出包" }
    if (-not (Test-Path (Join-Path $Jdk 'bin\java.exe'))) { Die "找不到 JDK：$Jdk" }
    if (-not (Test-Path $Sdk)) { Die "找不到 Android SDK：$Sdk" }
    $ndk = Join-Path $Sdk "ndk\$NdkVersion"
    if (-not (Test-Path $ndk)) { Die "找不到 Android NDK：$ndk" }
    $gradlew = Join-Path $TAURI 'gen\android\gradlew.bat'
    if (-not (Test-Path $gradlew)) { Die "找不到安卓工程：$gradlew（先跑一次 tauri android init）" }
  }
  Ok "node $(& node -v)"
  if ($cargo) { Ok "cargo $((& $cargo --version) -replace '^cargo ')" }
  if ($needApk) { Ok "JDK / SDK / NDK 就位（ABI=$Abi）" }
  if ($needIos) {
    if (-not (Test-Path $iosHelper)) { Die "找不到远程 iOS 构建器：$iosHelper" }
    if ($DryRun) {
      Note "[DryRun] 将检查 Mac（peer=$IosPeer）并构建 $IosVariant IPA；本次不连接 Mac"
    } else {
      # 升版、删除旧包和长时间本机构建之前先检查，Mac 不可用时保留现有版本与产物。
      & $node $iosHelper --check --peer $IosPeer
      if ($LASTEXITCODE -ne 0) { Die 'Mac iOS 环境未就绪；按上方提示处理，或加 -SkipIos 仅打本机包' }
    }
  }
}

# ============================================================
# 【BR2】版本号对齐
# ============================================================
Say '版本号'

# version.json 住在 scripts/ 里（与 update-game.js 的读取路径一致；发布包里也在这层）。
$verJsonPath = Join-Path $ROOT 'scripts\version.json'
$tauriConfPath = Join-Path $TAURI 'tauri.conf.json'
if (-not (Test-Path $verJsonPath)) { Die "找不到 scripts\version.json" }
if (-not (Test-Path $tauriConfPath)) { Die "找不到 tauri.conf.json" }

$verJsonText = Read-Text $verJsonPath
$tauriConfText = Read-Text $tauriConfPath
if ($verJsonText -notmatch '"version"\s*:\s*"([^"]+)"') { Die 'scripts/version.json 里没找到 version 字段' }
$current = $Matches[1]
if ($current -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { Die "当前版本号格式不对：'$current'（要 x.y.z 或 x.y.z.w）" }

if (-not $Name) {
  if ($tauriConfText -match '"productName"\s*:\s*"([^"]+)"') { $Name = $Matches[1] }
}
if (-not $Name) { $Name = 'squirrel_fight' }

# ============================================================
# 【BR1.5】版本号来源：优先读 dist 里「上一次的产物名」
# ============================================================
# 【2026-10 用户口径】上一次打出来的 exe / apk **名字里就带着那一版的实际版本号**，
# 比 `scripts\version.json` 更贴近现实（实测两者会脱节：dist 里已经是 0.5.0，version.json 还停在 0.4.9）。
# 所以「下一个版本号」优先从 dist 里**即将被删掉的**那些文件名里读出来，再 patch +1（+0.0.1）；
# 读不到（目录不存在 / 空 / 名字里没有 x.y.z）才回退到原来的 `version.json patch +1`。
#   认得：`squirrel_fight_0.5.0_x64-setup.exe`、`squirrel-fight-0.5.0-arm64-v8a.apk`
#         （分隔符 `_` / `-` / `.` 都吃，自定义 -Name / -ExeName / -ApkName 也照样认）
#   不认得：`ssdz-classic-arm64-v8a-release-20261012.apk`（build-apk.ps1 的原始名，里面只有日期）
function Get-DistVersionInfo($dir) {
  $info = [ordered]@{ Version = $null; BaseName = $null; Count = 0 }
  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { return $info }
  $vers = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue)) {
    $m = [regex]::Match($f.Name, '^([A-Za-z0-9_.\-]+?)[_.\-](\d+\.\d+\.\d+(?:\.\d+)?)[_.\-]')
    if ($m.Success) {
      $vers += $m.Groups[2].Value
      if (-not $info.BaseName) { $info.BaseName = $m.Groups[1].Value }
    } else {
      $m2 = [regex]::Match($f.Name, '(\d+\.\d+\.\d+(?:\.\d+)?)')
      if ($m2.Success) { $vers += $m2.Groups[1].Value }
    }
  }
  $info.Count = $vers.Count
  if ($vers.Count) {
    $info.Version = @($vers | Sort-Object { [version]$_ } -Descending)[0]
  }
  return $info
}

if ($CleanOnly) {
  $target = $current          # -CleanOnly 只回收磁盘，绝不碰版本号
} elseif ($Version) {
  $target = $Version -replace '^v', ''
} elseif ($NoBump) {
  $target = $current
} else {
  # 【版本号基准】dist 旧产物名里的版本 vs version.json，取**较高**的那个再 +0.0.1。
  # 取较高是为了「dist 还停在旧版」时不会把版本号往回退（退回旧号会覆盖掉已经发布的包）；
  # dist 领先时（正常情况）就是用户口径的「读 dist 名字 +0.0.1」。
  $distInfo = Get-DistVersionInfo $DIST
  $baseVer = $current
  $baseFrom = 'scripts\version.json'
  if ($distInfo.Version -and ([version]$distInfo.Version) -gt [version]$baseVer) {
    $baseVer = $distInfo.Version
    $baseFrom = 'dist 里的上一版产物名'
  }
  $p = $baseVer.Split('.')
  if ($p.Count -ge 4) {
    $target = "$($p[0]).$($p[1]).$($p[2]).$([int]$p[3] + 1)"
  } else {
    $target = "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
  }
  if ($distInfo.Version) {
    Ok "上一个版本号：$($distInfo.Version)（从 dist 里 $($distInfo.Count) 个带版本号的文件名中取最大）"
  } else {
    Note 'dist 里没读到带版本号的产物名（目录空 / 不存在 / 名字里没有 x.y.z）→ 版本号回退用 scripts\version.json'
  }
  Note "版本号基准：$baseVer（来源：$baseFrom）→ 末位 +1 = $target"
}
if ($target -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { Die "目标版本号格式不对：'$target'（要 x.y.z 或 x.y.z.w）" }

$segTarget = @($target.Split('.'))
# Tauri / Cargo / npm 都只接受三段 semver。四段版本（如 1.1.0.1）作为**显示版本**
# 写进 scripts/version.json、安装包/APK 文件名与安卓 versionName；底层 Cargo/Tauri
# 仍写前三段，否则 cargo / tauri CLI 会在解析版本时直接失败。
$semver = if ($segTarget.Count -ge 4) { ($segTarget[0..2] -join '.') } else { $target }
if ($segTarget.Count -ge 4) {
  $nextVer = "$($segTarget[0]).$($segTarget[1]).$($segTarget[2]).$([int]$segTarget[3] + 1)"
} else {
  $nextVer = "$($segTarget[0]).$($segTarget[1]).$([int]$segTarget[2] + 1)"
}
$verChanged = $target -ne $current
$commit = (& git -C $ROOT rev-parse --short HEAD 2>$null)
if (-not $commit) { $commit = 'nogit' }
$today = Get-Date -Format 'yyyy-MM-dd'

Ok "基名 $Name"
if ($CleanOnly) { Note '（-CleanOnly：只回收磁盘，不打包也不改版本号）' }
else { Ok "版本 $current → $target$(if (-not $verChanged) { '（未变）' })" }

# 要改的版本字段：文件 → 正则（只替换版本值本身，绝不整文件重写）
$versionEdits = @(
  @{ Path = (Join-Path $TAURI 'Cargo.toml'); Regex = '(?m)^(version\s*=\s*")[^"]+(")'; What = 'Cargo.toml' },
  @{ Path = (Join-Path $TAURI 'package.json'); Regex = '("version"\s*:\s*")[^"]+(")'; What = 'src-tauri/package.json' },
  @{ Path = $tauriConfPath; Regex = '("version"\s*:\s*")[^"]+(")'; What = 'tauri.conf.json' }
)
# Cargo.lock 里版本号出现很多次，只改 ssdz-classic 这一块
$lockPath = Join-Path $TAURI 'Cargo.lock'

if ($DryRun -or $CleanOnly) {
  Note "[跳过版本写入] $(if ($CleanOnly) { '-CleanOnly' } else { '-DryRun' })：Cargo / npm / tauri.conf 写到 $semver；scripts\version.json / 安卓 versionName / 产物名写到 $target"
} else {
  foreach ($e in $versionEdits) {
    if (-not (Test-Path $e.Path)) { Warn "缺文件，跳过：$($e.What)"; continue }
    $n = Replace-First (Read-Text $e.Path) $e.Regex $semver
    if ($null -eq $n) { Warn "$($e.What) 没找到版本字段"; continue }
    Write-Utf8NoBom $e.Path $n; Ok "$($e.What) → $semver"
  }
  # package-lock.json 的**根包**版本也要跟（npm ci 会校验；以前只改 package.json，
  # 锁文件在 0.1.3 停了好几个版本）。只替换前两处根版本字段，依赖自己的 version 不动。
  $pkgLockPath = Join-Path $TAURI 'package-lock.json'
  if (Test-Path $pkgLockPath) {
    $lockText = Read-Text $pkgLockPath
    $lockRe = New-Object System.Text.RegularExpressions.Regex('("version"\s*:\s*")[^"]+(")')
    if ($lockRe.IsMatch($lockText)) {
      $n = $lockRe.Replace($lockText, {
          param($m)
          return $m.Groups[1].Value + $semver + $m.Groups[2].Value
        }, 2)
      Write-Utf8NoBom $pkgLockPath $n
      Ok "package-lock.json(根版本) → $semver"
    } else { Warn 'package-lock.json 没找到 version 字段' }
  }
  if (Test-Path $lockPath) {
    $n = Replace-First (Read-Text $lockPath) '(?m)(name = "ssdz-classic"\r?\nversion = ")[^"]+(")' $semver
    if ($null -eq $n) { Warn 'Cargo.lock 没找到 ssdz-classic 块' }
    else { Write-Utf8NoBom $lockPath $n; Ok "Cargo.lock(ssdz-classic) → $semver" }
  }
  # version.json：只替换 version / commit / date 三个值，note 与排版原样保留。
  # 不用 ConvertTo-Json —— Windows PowerShell 5.1 会把中文转义成 \uXXXX。
  $n = $verJsonText
  $n = Replace-First $n '("version"\s*:\s*")[^"]+(")' $target
  $n = Replace-First $n '("commit"\s*:\s*")[^"]*(")' $commit
  $n = Replace-First $n '("date"\s*:\s*")[^"]*(")' $today
  Write-Utf8NoBom $verJsonPath $n
  Ok "scripts\version.json → $target @ $commit $today"

  # 安卓的版本号还有一处：gen/android/app/tauri.properties（gitignore 掉了，但它是
  # 安卓构建直接读的**真源**——2026-10 改为原地构建后就在这棵树上，build-apk.ps1 出包前
  # 还会对账）。versionName 写显示版本 $target；versionCode 用
  # major*1000000 + minor*1000 + patch（0.4.6 → 4006），四段版再把第四段拼到末尾
  # （1.1.0.1 → 1001000001），既保持递增，又不会和 1.1.0 撞号。
  $androProps = Join-Path $TAURI 'gen\android\app\tauri.properties'
  if (Test-Path $androProps) {
    if ($segTarget.Count -ge 4) {
      $vcode = ([int64]$segTarget[0] * 1000000000) + ([int64]$segTarget[1] * 1000000) +
        ([int64]$segTarget[2] * 1000) + [int64]$segTarget[3]
    } else {
      $vcode = ([int64]$segTarget[0] * 1000000) + ([int64]$segTarget[1] * 1000) + [int64]$segTarget[2]
    }
    $n = Replace-First (Read-Text $androProps) '(?m)^(tauri\.android\.versionName=).*$' $target
    if ($null -ne $n) { Write-Utf8NoBom $androProps $n }
    $n = Replace-First (Read-Text $androProps) '(?m)^(tauri\.android\.versionCode=).*$' "$vcode"
    if ($null -ne $n) { Write-Utf8NoBom $androProps $n; Ok "安卓 tauri.properties → $target / versionCode=$vcode" }
  } else {
    Note '（没有 gen\android\app\tauri.properties，跳过安卓版本号；首次跑 tauri android init 后才有）'
  }
}

# ============================================================
# 【BR3】规划产物名与要删的旧包
# ============================================================
Say '产物规划'

$arch = 'x64'   # NSIS 在 x64 Windows 上就是 x64
$map = @{ 'x86_64' = 'x86_64'; 'arm64-v8a' = 'arm64-v8a'; 'armeabi-v7a' = 'armeabi-v7a'; 'x86' = 'x86' }
function Expand-Name($tpl) {
  return $tpl.Replace('{name}', $Name).Replace('{version}', $target).
    Replace('{abi}', $map[$Abi]).Replace('{arch}', $arch).Replace('{date}', (Get-Date -Format 'yyyyMMdd'))
}

$want = [ordered]@{}
# 【2026-10 用户口径】轻壳 exe 只放**游戏根目录**（build-tauri-app.cjs 的产出，免安装时双击它开原生窗口）；
# 只有在显式改了 -ExeName（不再叫 squirrel_fight.exe）时才往 dist 另存一份，免得去动根目录那个入口。
if (-not $SkipExe -and (Expand-Name $ExeName) -ne 'squirrel_fight.exe') {
  $want['exe'] = Join-Path $DIST (Expand-Name $ExeName)
}
if (-not $SkipInstaller) { $want['setup'] = Join-Path $DIST (Expand-Name $InstallerName) }
if (-not $SkipApk) { $want['apk'] = Join-Path $DIST (Expand-Name $ApkName) }
if ($needIos) {
  if ($IosVariant -in 'both', 'modern') { $want['ios'] = Join-Path $DIST "squirrel_fight_${target}_ios_unsigned.ipa" }
  if ($IosVariant -in 'both', 'legacy') { $want['iosLegacy'] = Join-Path $DIST "squirrel_fight_${target}_ios_legacy_unsigned.ipa" }
}
$wantList = @($want.Values)

# 把这一版**将要用到的名字**打出来（-DryRun 时尤其有用：能先看清版本号与文件名对不对）
if (-not $CleanOnly) {
  Note '这一版的产物名：'
  if (-not $SkipExe) {
    $exeLabel = if ($want.Contains('exe')) { Split-Path -Leaf $want['exe'] } else { 'squirrel_fight.exe（游戏根目录，双击入口）' }
    Note ('  exe    ：' + $exeLabel)
  }
  if (-not $SkipInstaller) { Note ('  安装包 ：' + (Split-Path -Leaf $want['setup'])) }
  if (-not $SkipApk) { Note ('  安卓包 ：' + (Split-Path -Leaf $want['apk'])) }
  foreach ($k in @('ios', 'iosLegacy')) {
    if ($want.Contains($k)) { Note ('  iOS 包 ：' + (Split-Path -Leaf $want[$k])) }
  }
}

if (-not $DryRun -and -not (Test-Path $DIST)) { New-Item -ItemType Directory -Force -Path $DIST | Out-Null }
$stale = @(Get-ChildItem -LiteralPath $DIST -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in '.exe', '.apk' -and ($wantList -notcontains $_.FullName) })
if ($CleanOnly) { $stale = @() }   # -CleanOnly 一律不动 dist（否则会把现有产物当旧包删掉）

if ($CleanOnly) {
  Note '只清缓存（-CleanOnly）：不产出新包，也不动 dist 里的现有产物'
} else {
  foreach ($k in $want.Keys) { Note ("{0,-6} {1}" -f $k, (Split-Path -Leaf $want[$k])) }
}
if ($CleanOnly) { } elseif ($stale.Count) {
  Warn "将删除 dist 里上一版本的 $($stale.Count) 个文件："
  foreach ($f in $stale) { Note ("       {0}  {1}" -f $f.Name, (Fmt-Size $f.Length)) }
} else { Note 'dist 里没有需要清理的旧 exe/apk' }

# 缓存清单
# 注意：**不要**把 src-tauri\gen\schemas 放进来。它虽然写在 .gitignore 里，但那 4 个
# json 实际是入库的（git 跟踪），删掉会让仓库变脏（实测踩过：多了 4 个 D）。
$cacheTargets = @(
  (Join-Path $TAURI 'target'),
  (Join-Path $TAURI 'web'),
  (Join-Path $TAURI 'gen\android\app\build'),
  (Join-Path $TAURI 'gen\android\build'),
  (Join-Path $TAURI 'gen\android\.gradle'),
  (Join-Path $TAURI 'gen\android\app\.cxx')
)
if ($DeepClean) { $cacheTargets += (Join-Path $env:USERPROFILE '.gradle\caches') }

# 每次都重新扫一遍真实体积。**必须这样**：target\ 是这次编译才生成的，
# 打包前扫描只能看到上一次的残留，照着那份清单去删会漏掉全部大头（实测漏过 6.17 GB）。
function Get-CacheList {
  $list = @()
  foreach ($c in $cacheTargets) {
    if (-not (Test-Path $c)) { continue }
    $sz = Get-DirSize $c
    if ($sz -le 0) { continue }
    $list += @{ Path = $c; Size = $sz }
  }
  return @($list | Sort-Object { $_.Size } -Descending)
}

$cachePlan = Get-CacheList
$cacheBefore = 0
foreach ($i in $cachePlan) { $cacheBefore += $i.Size }

if (-not $CleanOnly) {
  Note ("打包缓存合计 {0}，打完会清掉（-KeepCache 可保留）" -f (Fmt-Size $cacheBefore))
} else {
  Note ("待清理缓存合计 {0}" -f (Fmt-Size $cacheBefore))
}

if ($DryRun) {
  Say '[DryRun] 结束'
  Note '没有写任何文件。确认无误就去掉 -DryRun 真跑。'
  Note ("预计耗时：exe 3~10 分钟（冷编译更久），APK 5~15 分钟；IPA 取决于 Mac 的 Xcode / Rust 缓存")
  exit 0
}

# ============================================================
# 【BR4】清旧包
# ============================================================
if ($stale.Count) {
  Say '清理上一版本的产物'
  foreach ($f in $stale) { Remove-Item -LiteralPath $f.FullName -Force; Ok "删除 $($f.Name)" }
}

# ============================================================
# 【BR5】Windows：轻壳 exe + NSIS 安装包
# ============================================================
function Invoke-Step($title, $file, $argv) {
  Say $title
  $t0 = Get-Date
  & $file @argv
  $code = $LASTEXITCODE
  $dt = [int]((Get-Date) - $t0).TotalSeconds
  if ($code -ne 0) { Die "$title 失败（退出码 $code，用时 ${dt}s）" }
  Ok "用时 ${dt}s"
}

if ((-not $SkipExe) -or (-not $SkipInstaller)) {
  $exeArgs = @((Join-Path $ROOT 'tools\build-tauri-app.cjs'))
  if (-not $SkipInstaller) { $exeArgs += '--installer' }
  Invoke-Step '编 Windows 轻壳 exe（+ NSIS 安装包）' $node $exeArgs

  # 轻壳 exe：build-tauri-app.cjs 只写**游戏根目录**那一份（免安装双击入口，便携包里也用它）。
  # dist 里不再放同名副本 —— 没有任何流程读它（便携包不收、tauri.yml 发布的是安装包）。
  if (-not $SkipExe) {
    $rootExe = Join-Path $ROOT 'squirrel_fight.exe'
    if (-not (Test-Path $rootExe)) { Die "没找到轻壳 exe：$rootExe" }
    if ($want.Contains('exe')) {
      $dest = $want['exe']
      if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Force }
      Copy-Item -LiteralPath $rootExe -Destination $dest -Force
      Ok "exe → $(Split-Path -Leaf $dest)（$(Fmt-Size (Get-Item $dest).Length)）"
    } else {
      Ok "exe → 游戏根目录 squirrel_fight.exe（$(Fmt-Size (Get-Item $rootExe).Length)，双击入口）"
    }
  }

  # 安装包：Tauri 的 NSIS 产物名不固定，取 dist 里最新的 *-setup.exe
  if (-not $SkipInstaller) {
    $setup = Get-ChildItem -LiteralPath $DIST -File -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $setup) { Die '没找到 NSIS 安装包（dist 下没有 *-setup.exe）' }
    $dest = $want['setup']
    if ($setup.FullName -ne $dest) {
      if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Force }
      Move-Item -LiteralPath $setup.FullName -Destination $dest -Force
    }
    Ok "安装包 → $(Split-Path -Leaf $dest)（$(Fmt-Size (Get-Item $dest).Length)）"
  }
}

# ============================================================
# 【BR6】安卓 APK
# ============================================================
if (-not $SkipApk) {
  $psHost = Get-PsHost
  $apkArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $ROOT 'tools\build-apk.ps1'),
    '-Abi', $Abi, '-Jdk', $Jdk, '-Sdk', $Sdk)
  if (-not $DebugApk) { $apkArgs += '-Release' }
  Invoke-Step "编安卓 APK（$Abi / $(if ($DebugApk) { 'debug' } else { 'release' })）" $psHost $apkArgs

  $apk = Get-ChildItem -LiteralPath $DIST -File -Filter '*.apk' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $apk) { Die '没找到 APK（dist 下没有 *.apk）' }
  $dest = $want['apk']
  if ($apk.FullName -ne $dest) {
    if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Force }
    Move-Item -LiteralPath $apk.FullName -Destination $dest -Force
  }
  Ok "APK → $(Split-Path -Leaf $dest)（$(Fmt-Size (Get-Item $dest).Length)）"
  Note '（build-apk.ps1 若检测到连着设备，会自动 adb install 并启动）'
}

# ============================================================
# 【BR7】Mac 远程 iOS：本轮源码、同一版本、两种 IPA 顺序构建并回传
# ============================================================
if ($needIos) {
  Invoke-Step "Mac iOS 打包并回传（$IosPeer / $IosVariant）" $node @($iosHelper,
    '--peer', $IosPeer, '--variant', $IosVariant, '--version', $target)
  foreach ($k in @('ios', 'iosLegacy')) {
    if ($want.Contains($k)) {
      if (-not (Test-Path -LiteralPath $want[$k])) { Die "缺少本轮 IPA：$($want[$k])" }
      Ok "IPA → $(Split-Path -Leaf $want[$k])（$(Fmt-Size (Get-Item -LiteralPath $want[$k]).Length)）"
    }
  }
}

# ============================================================
# 【BR8】清 Windows 缓存；Mac 隔离构建缓存保留，供下次复用
# ============================================================
$freed = 0
if (-not $KeepCache) {
  Say '清理打包缓存'
  # 打包**之后**重新扫：target\ 是刚才这次编译生成的，用打包前的清单会全漏掉
  $cacheList = Get-CacheList
  if (-not $cacheList.Count) { Note '没有可清的缓存' }
  foreach ($item in $cacheList) {
    if (-not (Test-Path $item.Path)) { continue }
    $show = $item.Path
    if ($show.StartsWith($ROOT)) { $show = '.' + $show.Substring($ROOT.Length) }
    Remove-Item -LiteralPath $item.Path -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $item.Path) { Warn "删不掉（可能被占用）：$show" }
    else { Ok ("{0,10}  {1}" -f (Fmt-Size $item.Size), $show); $freed += $item.Size }
  }
  if ($freed -gt 0) { Ok "共释放 $(Fmt-Size $freed)" }
} else {
  Say '按 -KeepCache 保留打包缓存'
  $afterSize = 0
  foreach ($i in (Get-CacheList)) { $afterSize += $i.Size }
  Note ("打包后仍留着 $(Fmt-Size $afterSize)；想立刻回收：双击 清缓存.cmd（或 powershell -File tools\build-release.ps1 -CleanOnly）")
}

# ============================================================
# 【BR9】汇总
# ============================================================
Say "完成（总用时 $([int]((Get-Date) - $START).TotalMinutes) 分 $([int](((Get-Date) - $START).TotalSeconds) % 60) 秒）"
Write-Host "   src-tauri\dist 现在有：" -ForegroundColor Cyan
foreach ($f in (Get-ChildItem -LiteralPath $DIST -File | Sort-Object Name)) {
  Write-Host ("     {0,-48} {1,10}" -f $f.Name, (Fmt-Size $f.Length))
}
Write-Host ''
Note "版本：$current → $target$(if ($verChanged) { '' } else { '（未变）' })"
if ($freed -gt 0) { Note "本轮释放磁盘：$(Fmt-Size $freed)" }
Write-Host ''
Write-Host '   接下来（想发布才做）：' -ForegroundColor DarkGray
Write-Host "     git add -A; git commit -m `"$target`"" -ForegroundColor DarkGray
Write-Host "     git tag v$target; git push origin main --tags" -ForegroundColor DarkGray
Write-Host ''
Write-Host "   下一次出包：直接双击 打包.cmd（版本会变成 $nextVer）；只回收磁盘双击 清缓存.cmd" -ForegroundColor DarkGray
Write-Host '   （推 v* 标签会触发 .github/workflows/release.yml 出便携包 Release）' -ForegroundColor DarkGray

# 显式收尾：别让最后一条外部命令的退出码漏成脚本的退出码
exit 0
