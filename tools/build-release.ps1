<#
  build-release.ps1 —— 松鼠大战怀旧版 · 一键出包（Windows exe + 安装包 + 安卓 APK）

  一条命令做完六件事：
    1) 版本号对齐：version.json / src-tauri(Cargo.toml / Cargo.lock / package.json / tauri.conf.json)
    2) 删掉 src-tauri\dist 里**上一个版本**的 exe / apk（只删本次不产出的，精确到文件）
    3) 编 Windows 轻壳 exe + NSIS 安装包（真正干活的是 tools\build-tauri-app.cjs）
    4) 编安卓 APK（真正干活的是 tools\build-apk.ps1，中文路径/NDK 那些坑都注释在里面）
    5) 产物按名称模板改名，统一落到 src-tauri\dist
    6) 删掉为了打包而生成的缓存（target\ / Gradle build\ / web\ 等，通常 5~10 GB）

  为什么要有这个脚本：上面三件事各自都有专门的脚本，但「先对齐版本 → 清旧包 → 出包 →
  改名 → 清 10 GB 缓存」这一串每次发版都要手工敲一遍，漏一步就是「装了个旧版本」或者
  「C 盘少 10 GB」。这里把它们串起来，并且**每一步都先体检、失败就停**。

  常用（在仓库根目录跑）：
    pwsh -File tools\build-release.ps1                              # 自动 0.4.6 → 0.4.7，出全套
    pwsh -File tools\build-release.ps1 -Version 0.5.0               # 指定版本
    pwsh -File tools\build-release.ps1 -NoBump                      # 不动版本号，按当前版本出包
    pwsh -File tools\build-release.ps1 -DryRun                      # 只打印计划，不写任何文件
    pwsh -File tools\build-release.ps1 -SkipApk                     # 只出 Windows（省 10 分钟）
    pwsh -File tools\build-release.ps1 -SkipInstaller               # 不出 69 MB 的安装包
    pwsh -File tools\build-release.ps1 -Name 松鼠大战怀旧版          # 换安装包 / APK 的基名
    pwsh -File tools\build-release.ps1 -ApkName '{name}-{version}-{abi}.apk'
    pwsh -File tools\build-release.ps1 -CleanOnly                   # 只清缓存，不打包
    pwsh -File tools\build-release.ps1 -KeepCache                   # 打完保留缓存（下次编得快）

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
  [switch]$KeepCache,
  [switch]$NoBump,
  [switch]$CleanOnly,
  [switch]$DryRun,
  # 连 ~\.gradle\caches 一起清（那是全局 Gradle 缓存，清了下次要重新下载依赖）
  [switch]$DeepClean,

  # 本机现成的安卓工具链（换机器时用参数覆盖）
  [string]$Jdk = 'E:\Android\jdk-17.0.20.1+1',
  [string]$Sdk = 'E:\Android\sdk',
  [string]$NdkVersion = '27.0.12077973',
  # 安卓必须在**纯 ASCII 路径**下构建（中文路径会让 NDK 的 linker 收到乱码路径）
  [string]$BuildRoot = 'E:\ssdz-android-build'
)

$ErrorActionPreference = 'Continue'
# 说明：外部命令（cargo / gradle / tauri）会把进度写到 stderr，PowerShell 在 Stop 模式下
# 会把它当致命错误掐死脚本。所以下面每一步都自己检查 $LASTEXITCODE / Test-Path。

# -CleanOnly = 只回收磁盘：不打包、不动版本号、**也不删 dist 里现有的产物**
if ($CleanOnly) { $SkipExe = $true; $SkipInstaller = $true; $SkipApk = $true }

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

if (-not $CleanOnly) {
  if (-not $node) { Die '找不到 node（https://nodejs.org）' }
  if (-not (Test-Path $cli)) { Die "找不到 Tauri CLI：$cli（先在 src-tauri 下 npm install）" }
  if ($needExe -and -not $cargo) { Die '找不到 cargo（https://rustup.rs）' }
  if ($needApk) {
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
}

# ============================================================
# 【BR2】版本号对齐
# ============================================================
Say '版本号'

$verJsonPath = Join-Path $ROOT 'version.json'
$tauriConfPath = Join-Path $TAURI 'tauri.conf.json'
if (-not (Test-Path $verJsonPath)) { Die "找不到 version.json" }
if (-not (Test-Path $tauriConfPath)) { Die "找不到 tauri.conf.json" }

$verJsonText = Read-Text $verJsonPath
$tauriConfText = Read-Text $tauriConfPath
if ($verJsonText -notmatch '"version"\s*:\s*"([^"]+)"') { Die 'version.json 里没找到 version 字段' }
$current = $Matches[1]
if ($current -notmatch '^\d+\.\d+\.\d+$') { Die "当前版本号格式不对：'$current'" }

if (-not $Name) {
  if ($tauriConfText -match '"productName"\s*:\s*"([^"]+)"') { $Name = $Matches[1] }
}
if (-not $Name) { $Name = 'squirrel_fight' }

if ($CleanOnly) {
  $target = $current          # -CleanOnly 只回收磁盘，绝不碰版本号
} elseif ($Version) {
  $target = $Version -replace '^v', ''
} elseif ($NoBump) {
  $target = $current
} else {
  $p = $current.Split('.')
  $target = "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
}
if ($target -notmatch '^\d+\.\d+\.\d+$') { Die "目标版本号格式不对：'$target'（要 x.y.z）" }

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
  Note "[跳过版本写入] $(if ($CleanOnly) { '-CleanOnly' } else { '-DryRun' })：会改 Cargo.toml / Cargo.lock / src-tauri/package.json / tauri.conf.json / version.json / gen\android\app\tauri.properties 到 $target"
} else {
  foreach ($e in $versionEdits) {
    if (-not (Test-Path $e.Path)) { Warn "缺文件，跳过：$($e.What)"; continue }
    $n = Replace-First (Read-Text $e.Path) $e.Regex $target
    if ($null -eq $n) { Warn "$($e.What) 没找到版本字段"; continue }
    Write-Utf8NoBom $e.Path $n; Ok "$($e.What) → $target"
  }
  if (Test-Path $lockPath) {
    $n = Replace-First (Read-Text $lockPath) '(?m)(name = "ssdz-classic"\r?\nversion = ")[^"]+(")' $target
    if ($null -eq $n) { Warn 'Cargo.lock 没找到 ssdz-classic 块' }
    else { Write-Utf8NoBom $lockPath $n; Ok "Cargo.lock(ssdz-classic) → $target" }
  }
  # version.json：只替换 version / commit / date 三个值，note 与排版原样保留。
  # 不用 ConvertTo-Json —— Windows PowerShell 5.1 会把中文转义成 \uXXXX。
  $n = $verJsonText
  $n = Replace-First $n '("version"\s*:\s*")[^"]+(")' $target
  $n = Replace-First $n '("commit"\s*:\s*")[^"]*(")' $commit
  $n = Replace-First $n '("date"\s*:\s*")[^"]*(")' $today
  Write-Utf8NoBom $verJsonPath $n
  Ok "version.json → $target @ $commit $today"

  # 安卓的版本号还有一处：gen/android/app/tauri.properties（gitignore 掉了，但是
  # build-apk.ps1 同步到 ASCII 副本的**真源**）。versionCode 用 Tauri 的算法
  # major*1000000 + minor*1000 + patch（0.4.6 → 4006），别只改 versionName。
  $androProps = Join-Path $TAURI 'gen\android\app\tauri.properties'
  if (Test-Path $androProps) {
    $seg = $target.Split('.')
    $vcode = ([int]$seg[0] * 1000000) + ([int]$seg[1] * 1000) + [int]$seg[2]
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
if (-not $SkipExe) { $want['exe'] = Join-Path $DIST (Expand-Name $ExeName) }
if (-not $SkipInstaller) { $want['setup'] = Join-Path $DIST (Expand-Name $InstallerName) }
if (-not $SkipApk) { $want['apk'] = Join-Path $DIST (Expand-Name $ApkName) }
$wantList = @($want.Values)

if (-not (Test-Path $DIST)) { New-Item -ItemType Directory -Force -Path $DIST | Out-Null }
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
  (Join-Path $TAURI 'gen\android\app\.cxx'),
  (Join-Path $BuildRoot 'src-tauri\target'),
  (Join-Path $BuildRoot 'src-tauri\web'),
  (Join-Path $BuildRoot 'src-tauri\gen\android\app\build'),
  (Join-Path $BuildRoot 'src-tauri\gen\android\build'),
  (Join-Path $BuildRoot 'src-tauri\gen\android\.gradle'),
  (Join-Path $BuildRoot 'src-tauri\gen\android\app\.cxx')
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
  Note ("预计耗时：exe 3~10 分钟（冷编译更久），APK 5~15 分钟")
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

  # 轻壳 exe：build-tauri-app.cjs 固定写成 dist\squirrel_fight.exe，按模板改名
  if (-not $SkipExe) {
    $built = Join-Path $DIST 'squirrel_fight.exe'
    if (-not (Test-Path $built)) { Die "没找到轻壳 exe：$built" }
    $dest = $want['exe']
    if ($built -ne $dest) {
      if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Force }
      Move-Item -LiteralPath $built -Destination $dest -Force
    }
    Ok "exe → $(Split-Path -Leaf $dest)（$(Fmt-Size (Get-Item $dest).Length)）"
    Note '仓库根目录那份 squirrel_fight.exe 也已同步更新（Windows 双击入口）'
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
    '-Abi', $Abi, '-Jdk', $Jdk, '-Sdk', $Sdk, '-BuildRoot', $BuildRoot)
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
# 【BR7】清缓存
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
  Note ("打包后仍留着 $(Fmt-Size $afterSize)；想立刻回收再跑一次：powershell -File tools\build-release.ps1 -CleanOnly")
}

# ============================================================
# 【BR8】汇总
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
Write-Host '   （推 v* 标签会触发 .github/workflows/release.yml 出便携包 Release）' -ForegroundColor DarkGray

# 显式收尾：别让最后一条外部命令的退出码漏成脚本的退出码
exit 0
