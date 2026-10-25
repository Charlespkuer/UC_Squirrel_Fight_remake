<#
  build-apk.ps1 —— 松鼠大战怀旧版 · 安卓 APK 一键构建

  为什么需要这个脚本：Tauri 官方的 `tauri android build` 在**这台 Windows 机器**上跑不通，
  踩过的坑都在下面脚本里绕开了（每条都有注释说明原因）。想搞清楚细节看注释，
  只想出包就直接跑：

      pwsh -File tools\build-apk.ps1 -Abi x86_64                  # 模拟器用（debug）
      pwsh -File tools\build-apk.ps1 -Abi arm64-v8a -Release      # 真机用（推荐：体积小一半多）
      pwsh -File tools\build-apk.ps1 -Abi arm64-v8a -Release -SkipSyncStaging   # 前端没改时跳过暂存

  产出会复制到 src-tauri\dist\ssdz-classic-<abi>-<profile>-<日期>.apk，
  原始产物在 src-tauri\gen\android\app\build\outputs\apk\<flavor>\debug\ 下（都在本仓库内）。

  构建位置：**原地构建**（2026-10 用户口径：安卓打包文件都留在主文件夹里，不再建副本）——
  硬前提是仓库路径为**纯 ASCII**；含中文会让 NDK 的 linker 收到乱码路径，见下面第 1 条。

  依赖（本机现有布局，路径可用参数覆盖）：
    JDK 17     E:\Android\jdk-17.0.20.1+1
    Android SDK E:\Android\sdk（platform-tools / platforms;android-35+36 / build-tools;35.0.0 / ndk;27.0.12077973）
#>
[CmdletBinding()]
param(
  [ValidateSet('x86_64','arm64-v8a','armeabi-v7a','x86')]
  [string]$Abi = 'x86_64',
  [switch]$Release,
  [string]$Jdk = 'E:\Android\jdk-17.0.20.1+1',
  [string]$Sdk = 'E:\Android\sdk',
  [string]$SourceRepo = '',                       # 默认 = 本脚本上一层的仓库根（下面补）
  [switch]$SkipSyncStaging,
  [switch]$NoInstall                           # 只构建/校验，不覆盖连接设备上的应用
)

$ErrorActionPreference = 'Continue'
# 注意：$PSScriptRoot 在 param() 的默认值里还不可用（会是空串），必须到脚本体里再算。
if (-not $SourceRepo) {
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $SourceRepo = Split-Path -Parent $scriptDir
}
# 原地构建的硬前提：仓库路径必须纯 ASCII（原因见第 1 条）。以前这一步是"自动复制一份到
# E:\ssdz-android-build 再构建"；改成原地构建后保护手段从"绕开"变成"体检"——路径含中文
# 立刻停下并说清原因，别等 linker 报一串乱码错误（ld.lld: cannot open E:\xcb\xc9...）。
if ($SourceRepo -match '[^\x00-\x7F]') {
  throw "仓库路径含非 ASCII 字符（$SourceRepo）：NDK 的 *-clang.cmd 在 Windows 上按 GBK 传参，中文路径会让 linker 收到乱码路径必然失败。请把仓库移到纯 ASCII 路径（如 E:\Squirrel_Fight）后重跑。"
}
# 为什么是 Continue 而不是 Stop：外部命令（tauri CLI / gradle / robocopy）会把进度信息
# 写到 stderr，PowerShell 会把它当成错误记录——Stop 模式下脚本会被直接掐死。
# 所以每一步都自己检查 $LASTEXITCODE / Test-Path 来判断成败（下面都检查了）。
function Say($m) { Write-Host "== $m" -ForegroundColor Cyan }
function Ok($m)  { Write-Host "   ✓ $m" -ForegroundColor Green }

# flavor 名与 Rust target 的对应关系
$map = @{
  'x86_64'      = @{ flavor='x86_64';    target='x86_64-linux-android';    tauri='x86_64' }
  'arm64-v8a'   = @{ flavor='arm64';     target='aarch64-linux-android';   tauri='aarch64' }
  'armeabi-v7a' = @{ flavor='arm';       target='armv7-linux-androideabi'; tauri='armv7' }
  'x86'         = @{ flavor='x86';       target='i686-linux-android';      tauri='i686' }
}[$Abi]
$profile = if ($Release) { 'release' } else { 'debug' }

# ---------- 环境 ----------
$env:JAVA_HOME = $Jdk
$env:ANDROID_HOME = $Sdk
$env:ANDROID_SDK_ROOT = $Sdk
$env:NDK_HOME = Join-Path $Sdk 'ndk\27.0.12077973'
$env:PATH = @("$Jdk\bin", "$Sdk\platform-tools", "$Sdk\cmdline-tools\latest\bin",
              "$env:USERPROFILE\.cargo\bin", $env:PATH) -join ';'
$ndkToolchain = Join-Path $env:NDK_HOME 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$env:CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER  = Join-Path $ndkToolchain 'x86_64-linux-android24-clang.cmd'
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = Join-Path $ndkToolchain 'aarch64-linux-android24-clang.cmd'
$env:CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER = Join-Path $ndkToolchain 'armv7a-linux-androideabi24-clang.cmd'
$env:CARGO_TARGET_I686_LINUX_ANDROID_LINKER    = Join-Path $ndkToolchain 'i686-linux-android24-clang.cmd'

Say "目标 ABI=$Abi（flavor=$($map.flavor) target=$($map.target) profile=$profile）"

# ---------- 1) 原地构建（历史：曾经必须先复制到纯 ASCII 副本） ----------
# 背景（别删这段；换机器 / 改目录名后最容易再踩）：NDK 的 *-clang.cmd 包装器在 Windows 上
# 把路径按 GBK 传参——项目路径里有中文（当年的 E:\松鼠大战怀旧版）时，linker 收到的是乱码
# 路径 → 报 "ld.lld: error: cannot open E:\\\xcb\xc9\xca\xf3..." 链接必失败。用目录联接
# （junction）也没用：Cargo 会把路径规范化回真实的中文路径。所以 2026-10 之前只能真的把
# 仓库复制一份到 E:\ssdz-android-build（纯 ASCII）里构建，再把 APK 复制回仓库的 dist。
# 主文件夹改名成纯 ASCII（E:\Squirrel_Fight）后这个前提消失：2026-10 用户口径改为
# **原地构建**——不再维护第二份副本，省掉整份复制与增量同步，也消灭了"副本和仓库版本号
# 漂移"这类双树问题（更新记录第一百一十三批的 INSTALL_FAILED_VERSION_DOWNGRADE 就是它）。
# 纯 ASCII 由脚本开头的体检兜底；构建产物都落在已 gitignore 的
# src-tauri\target / web / gen\android 里，build-release.ps1 打完包会统一清理缓存。

# ---------- 2) 暂存前端（frontendDist=web） ----------
# Tauri 是在**编译 Rust 时**把前端资源嵌进二进制的，所以必须先暂存再编译；
# 顺序反了就会出现「APK 装上了、能开、但白屏」。
if (-not $SkipSyncStaging) {
  Say "暂存前端到 src-tauri\web"
  Push-Location $SourceRepo
  & node (Join-Path $SourceRepo 'tools\build-tauri-app.cjs') --web | Select-Object -Last 1 | ForEach-Object { Ok $_ }
  $stageCode = $LASTEXITCODE
  Pop-Location
  if ($stageCode -ne 0) { throw "前端暂存失败（退出码 $stageCode）；停止打包，不能沿用旧快照。" }
} else {
  & node (Join-Path $SourceRepo 'tools\build-tauri-app.cjs') --web --check
  if ($LASTEXITCODE -ne 0) { throw '前端快照已过期；去掉 -SkipSyncStaging 后重新打包。' }
}

# ---------- 2b) Android 导出桥（Kotlin）覆盖进生成工程 ----------
# `src-tauri/android/` 是**受版本管理**的模板；`gen/android` 是本机生成目录（gitignore）。
# MainActivity 要加 `SSDZAndroid` 的 JavascriptInterface，导出存档才能落到系统「下载」
# 目录，而不是 WebView 默认的应用私有目录。重新 `tauri android init` 后由这里补回。
$androidTpl = Join-Path $SourceRepo 'src-tauri\android'
$androidDst = Join-Path $SourceRepo 'src-tauri\gen\android\app\src\main\java\com\ssdz\classic'
if ((Test-Path $androidTpl) -and (Test-Path $androidDst)) {
  Get-ChildItem $androidTpl -Filter '*.kt' -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $androidDst $_.Name) -Force -ErrorAction Stop
  }
  Ok "Android 导出桥模板 → gen\android（MainActivity / AndroidExportBridge）"
}

# ---------- 2c) Android 9 及以下的存储权限（写公共下载目录用） ----------
# gen/android 的 AndroidManifest.xml 是本机真源（gitignore 忽略），重新 `tauri android init`
# 之后容易漏。这里幂等补一行：API ≤ 28 要把手动/自动导出的存档写进系统「下载」，必须先申请
# WRITE_EXTERNAL_STORAGE；Android 10+ 走 MediaStore 不需要权限，所以加 maxSdkVersion=28。
$manifestPath = Join-Path $SourceRepo 'src-tauri\gen\android\app\src\main\AndroidManifest.xml'
if (Test-Path $manifestPath) {
  $manifestText = [System.IO.File]::ReadAllText($manifestPath)
  if ($manifestText -notmatch 'WRITE_EXTERNAL_STORAGE') {
    $anchor = '<uses-permission android:name="android.permission.INTERNET" />'
    if ($manifestText.Contains($anchor)) {
      $perm = '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />'
      $manifestText = $manifestText.Replace($anchor, $anchor + [Environment]::NewLine + '    ' + $perm)
      [System.IO.File]::WriteAllText($manifestPath, $manifestText, (New-Object System.Text.UTF8Encoding($false)))
      Ok 'AndroidManifest 补上 WRITE_EXTERNAL_STORAGE（maxSdkVersion=28）'
    } else {
      Write-Host '   ⚠ AndroidManifest 里没找到 INTERNET 权限行，跳过存储权限补丁' -ForegroundColor Yellow
    }
  } else {
    Ok '存储权限体检：AndroidManifest 已有 WRITE_EXTERNAL_STORAGE'
  }
}

# ---------- 3) 编译 Rust（每个 ABI 都要单独的 .so） ----------
# 用 `tauri android build` 来做这一步，因为只有它会把 NDK 的 CC/AR/linker 等
# 交叉编译环境准备齐（裸 cargo build 会报 "linker cc not found"）。
# 它在最后「创建符号链接」那步必然失败（本机没开开发者模式、没有
# SeCreateSymbolicLinkPrivilege），所以下面第 4 步手工复制 .so。
Say "编译 Rust（$($map.target)）"
$so = Join-Path $SourceRepo "src-tauri\target\$($map.target)\$profile\libssdz_classic_lib.so"
Push-Location (Join-Path $SourceRepo 'src-tauri')
# 注意：`tauri android build` **默认就是 release**，只有 `--debug` 这个反向开关，
# 传 `--release` 会报 unexpected argument '--release'。
$cliArgs = if ($Release) { @('android','build','--apk','--target',$map.tauri,'--ci') }
           else          { @('android','build','--debug','--apk','--target',$map.tauri,'--ci') }
$buildStart = Get-Date
$cliOut = & node 'node_modules\@tauri-apps\cli\tauri.js' @cliArgs 2>&1
$cliCode = $LASTEXITCODE
Pop-Location
if ($cliCode -ne 0) {
  # 只允许已完成 Cargo 编译、随后因 Windows 链接权限失败的已知边路。
  # 其它失败即使磁盘上有旧 .so 也必须停止，否则会把旧游戏伪装成本次新包。
  $cliText = $cliOut | Out-String
  $symlinkDenied = $cliText -match '(?i)(os error 1314|privilege.+not held|symlink.+(?:privilege|denied|not allowed)|creation symbolic link is not allowed)'
  # Tauri 的彩色输出可能让 "Finished" 正则失配；改看 .so 是否是本轮构建新写出的。
  $soFresh = (Test-Path -LiteralPath $so) -and ((Get-Item -LiteralPath $so).LastWriteTime -ge $buildStart.AddSeconds(-2))
  if (-not ($symlinkDenied -and $soFresh)) {
    $cliOut | Select-Object -Last 25 | ForEach-Object { Write-Host "   $_" }
    throw "Rust/Tauri 构建失败（退出码 $cliCode）；拒绝复用旧 .so。"
  }
}
if (-not (Test-Path $so)) {
  $cliOut | Select-Object -Last 20 | ForEach-Object { Write-Host "   $_" }
  throw "Rust 产物不存在：$so"
}
Ok "$so（$([math]::Round((Get-Item $so).Length/1MB,1)) MB）"
& node (Join-Path $SourceRepo 'tools\check-android-package.cjs') --library $so $Abi
if ($LASTEXITCODE -ne 0) { throw '原生库 ABI / 内存页对齐检查失败，不能继续出包。' }

# ---------- 4) 放 .so + 前端到 Android 工程 ----------
& node (Join-Path $SourceRepo 'tools\build-tauri-app.cjs') --web --check
if ($LASTEXITCODE -ne 0) { throw 'Rust 编译期间前端源码发生变化，请重新打包，避免发布旧资源。' }
$jni = Join-Path $SourceRepo "src-tauri\gen\android\app\src\main\jniLibs\$Abi"
New-Item -ItemType Directory -Force -Path $jni | Out-Null
$jniFile = Join-Path $jni 'libssdz_classic_lib.so'
$jniInfo = Get-Item -LiteralPath $jniFile -Force -ErrorAction SilentlyContinue
$sameLink = $false
if ($jniInfo -and $jniInfo.LinkType -eq 'SymbolicLink' -and $jniInfo.Target) {
  $linkPath = [string]@($jniInfo.Target)[0]
  if (-not [System.IO.Path]::IsPathRooted($linkPath)) { $linkPath = Join-Path $jni $linkPath }
  $sameLink = [string]::Equals([System.IO.Path]::GetFullPath($linkPath), [System.IO.Path]::GetFullPath($so), [System.StringComparison]::OrdinalIgnoreCase)
}
if ($sameLink) {
  Ok "jniLibs\$Abi 已由 Tauri 链接到本次原生库，跳过同文件复制"
} else {
  # 当前机器若允许创建链接，Tauri 已经完成这一步；不要经旧链接覆写其它 target。
  if ($jniInfo -and $jniInfo.LinkType -eq 'SymbolicLink') { Remove-Item -LiteralPath $jniFile -Force -ErrorAction Stop }
  Copy-Item -LiteralPath $so -Destination $jniFile -Force -ErrorAction Stop
  Ok "libssdz_classic_lib.so → jniLibs\$Abi"
}

$assets = Join-Path $SourceRepo 'src-tauri\gen\android\app\src\main\assets'
robocopy (Join-Path $SourceRepo 'src-tauri\web') $assets /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "前端资源复制失败（robocopy 退出码 $LASTEXITCODE），停止打包。" }
Ok "前端资源 → assets（$((Get-ChildItem $assets -Recurse -Force -File | Measure-Object).Count) 个文件）"
# 防止「源码已改、APK 里还是旧快照」：至少核对调试开关这一颗最容易被用户直接看到的标记。
$debugSrc = Join-Path $SourceRepo 'js\debug.js'
$debugAsset = Join-Path $assets 'js\debug.js'
if ((Test-Path $debugSrc) -and (Test-Path $debugAsset)) {
  $pat = 'const DEBUG_IN_CLASSIC = (true|false);'
  $srcFlag = ([regex]::Match((Get-Content -LiteralPath $debugSrc -Raw), $pat)).Groups[1].Value
  $assetFlag = ([regex]::Match((Get-Content -LiteralPath $debugAsset -Raw), $pat)).Groups[1].Value
  if ($srcFlag -and $assetFlag -and ($srcFlag -ne $assetFlag)) {
    throw "前端快照与源码不一致：js/debug.js=$srcFlag，assets/js/debug.js=$assetFlag。请去掉 -SkipSyncStaging 重新暂存后再出包。"
  }
  Ok "前端快照校验：DEBUG_IN_CLASSIC=$assetFlag"
}

# ---------- 4b) 安卓工程体检（本机真源就在 src-tauri\gen\android，原地构建直接用） ----------
# 这些"本机真源"都在 gen/android（.gitignore 忽略、不进仓库）：图标 res/ 由
# `cd src-tauri && npx tauri icon app-icon.png` 生成；AndroidManifest.xml 有一处手工改动
# android:screenOrientation="sensorLandscape"（1216×760 横向比例，锁横屏才不是竖屏中间一条）；
# app\build.gradle.kts 把 debug 变体签名固定成 v1+v2+v3；app\tauri.properties 的
# versionName/versionCode 由 build-release.ps1 每次发版 bump。
# 以前构建在 E:\ssdz-android-build 副本里跑，这几样都要"仓库 → 副本"同步——漏了 tauri.properties
# 就出过「安卓包装不上」（副本停在旧 versionCode，INSTALL_FAILED_VERSION_DOWNGRADE，见更新记录
# 第一百一十三批）。原地构建后只有一棵树，同步这一步在结构上消失。
# 体检：app\build.gradle.kts 的签名开关（缺档先告警；打完还有 5b 的 apksigner 复检 + 补签兜底）。
$srcGradle = Join-Path $SourceRepo 'src-tauri\gen\android\app\build.gradle.kts'
if (Test-Path $srcGradle) {
  $gradleText = [System.IO.File]::ReadAllText($srcGradle)
  $wantFlags = @('enableV1Signing', 'enableV2Signing', 'enableV3Signing')
  $missing = @($wantFlags | Where-Object { $gradleText -notmatch ($_ + '\s*=\s*true') })
  if ($missing.Count) {
    Write-Host "   ⚠ app\build.gradle.kts 缺签名开关：$($missing -join ' / ')；打出来的包可能只有 v2（5b 会复检并补签）" -ForegroundColor Yellow
  } else {
    Ok "签名开关体检：app\build.gradle.kts 的 v1+v2+v3 三个开关都在"
  }
} else {
  Write-Host "   ⚠ 仓库里没有 src-tauri\gen\android\app\build.gradle.kts（gitignore 的本机真源），跳过体检；5b 会按 v1/v2/v3 复检" -ForegroundColor Yellow
}

# ---------- 4c) 安卓 versionName / versionCode 以 scripts\version.json 为准 ----------
# Cargo / Tauri 只认三段 semver；四段显示版本（如 1.1.0.1）必须写进 Gradle 真正读的
# gen\android\app\tauri.properties。build-release.ps1 会先写一次，这里在 Tauri 编译之后、
# Gradle 之前再对齐一次，防止 `tauri android build` 用 tauri.conf 的三段版本把它刷回去。
$verFile = Join-Path $SourceRepo 'scripts\version.json'
$propFile = Join-Path $SourceRepo 'src-tauri\gen\android\app\tauri.properties'
if ((Test-Path $verFile) -and (Test-Path $propFile)) {
  $verText = [System.IO.File]::ReadAllText($verFile)
  $verMatch = [regex]::Match($verText, '"version"\s*:\s*"([^"]+)"')
  if ($verMatch.Success) {
    $ver = $verMatch.Groups[1].Value
    if ($ver -match '^\d+\.\d+\.\d+(\.\d+)?$') {
      $seg = @($ver.Split('.'))
      if ($seg.Count -ge 4) {
        $vcode = ([int64]$seg[0] * 1000000000) + ([int64]$seg[1] * 1000000) +
          ([int64]$seg[2] * 1000) + [int64]$seg[3]
      } else {
        $vcode = ([int64]$seg[0] * 1000000) + ([int64]$seg[1] * 1000) + [int64]$seg[2]
      }
      $props = [System.IO.File]::ReadAllText($propFile)
      $props = [regex]::Replace($props, '(?m)^tauri\.android\.versionName=.*$', 'tauri.android.versionName=' + $ver)
      $props = [regex]::Replace($props, '(?m)^tauri\.android\.versionCode=.*$', 'tauri.android.versionCode=' + $vcode)
      [System.IO.File]::WriteAllText($propFile, $props, (New-Object System.Text.UTF8Encoding($false)))
      Ok "安卓版本号对齐 scripts\version.json → $ver / versionCode=$vcode"
    } else {
      Write-Host "   ⚠ scripts\version.json 的版本号格式不对：$ver，保留 tauri.properties 原值" -ForegroundColor Yellow
    }
  }
}

# ---------- 5) Gradle 打包 ----------
# 那个 rust 任务（rustBuild*）不能被调用：它执行 `tauri android android-studio-script`，
# 而那个入口是给 Android Studio 用的，纯 Gradle 环境下会因为缺 -server-addr 文件而 panic；
# 官方模板里 node 路径还硬编码成带空格的 "C:\Program Files\nodejs\node"（多一个分号）。
# 已经打补丁：BuildTask.kt 检测到 jniLibs 里已有 .so 就直接跳过。
#
# 变体选择：**始终用 Gradle 的 Debug 变体**。Rust 侧该 release 还是 release（见上一步，
# 决定了 .so 的体积），而 Gradle 的 assembleRelease 出来的是**未签名** APK，
# 手机上根本装不上（除非自己配 keystore）。Debug 变体自带 debug 签名，装得上、能直接玩。
# 签完还会做 5b 签名体检：v1/v2/v3 缺任何一档就用 apksigner 同一把密钥补签（v2-only 会被部分安装器判「无签名文件」）。
Say "Gradle 打包（$($map.flavor) / debug 变体，Rust 侧=$profile）"
Push-Location (Join-Path $SourceRepo 'src-tauri\gen\android')
$flavorCap = $map.flavor.Substring(0,1).ToUpper() + $map.flavor.Substring(1)
$gradleTask = "assemble${flavorCap}Debug"
& .\gradlew.bat $gradleTask --no-daemon 2>&1 | Select-String -Pattern 'BUILD SUCCESSFUL|BUILD FAILED|FAILURE:' | ForEach-Object { Write-Host "   $_" }
$gradleCode = $LASTEXITCODE
Pop-Location
if ($gradleCode -ne 0) { throw "Gradle 打包失败（退出码 $gradleCode）" }

# 变体名是 debug，但里面的 .so 可能是 release 编出来的 —— 用 $profile 区分产物用途：
# 把 APK 复制成带用途的名字，免得两种包混淆。
$apk = Join-Path $SourceRepo "src-tauri\gen\android\app\build\outputs\apk\$($map.flavor)\debug\app-$($map.flavor)-debug.apk"
if (-not (Test-Path $apk)) { throw "没找到 APK：$apk" }
& node (Join-Path $SourceRepo 'tools\check-android-package.cjs') $apk
if ($LASTEXITCODE -ne 0) { throw 'APK 原生库 / ZIP 对齐检查失败，不能发布。' }

# ---------- 5a) 版本号体检：APK 里的 versionName/versionCode 必须与 tauri.properties 一致 ----------
# 为什么：2026-10 审计时 dist 里躺着一个 `squirrel-fight-0.5.0-...apk`，包内实际是
# **0.4.9 / versionCode=4009**（文件名对、内容旧）。这种包给用户装会：
#   ① 以为拿到了新版；② 覆盖安装被安卓判 VERSION_DOWNGRADE；③ 游戏内显示的版本号也是旧的。
# 根因当年就是"构建副本的 tauri.properties 没同步"（见 4b）；原地构建后只有一棵树，
# 这里再在出包前证明一次 APK 内的版本号与 gen\android\app\tauri.properties 一致。
$btDirs = Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory -ErrorAction SilentlyContinue
$btLatest = $btDirs | Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending | Select-Object -First 1
$aapt2 = if ($btLatest) { Join-Path $btLatest.FullName 'aapt2.exe' } else { $null }
$propVer = $null; $propCode = $null
$propsPath = Join-Path $SourceRepo 'src-tauri\gen\android\app\tauri.properties'
if (Test-Path $propsPath) {
  $propsText = [System.IO.File]::ReadAllText($propsPath)
  $propVer = ([regex]'(?m)^tauri\.android\.versionName=(.+)$').Match($propsText).Groups[1].Value.Trim()
  $propCode = ([regex]'(?m)^tauri\.android\.versionCode=(.+)$').Match($propsText).Groups[1].Value.Trim()
}
if ($propVer -and $propCode -and $aapt2 -and (Test-Path $aapt2)) {
  $badging = & $aapt2 dump badging $apk 2>&1 | Out-String
  $bm = [regex]::Match($badging, "versionCode='(\d+)' versionName='([^']+)'")
  if ($bm.Success) {
    $apkCode = $bm.Groups[1].Value; $apkVer = $bm.Groups[2].Value
    if ($apkCode -ne $propCode -or $apkVer -ne $propVer) {
      throw "APK 版本号与 tauri.properties 不一致：包内 $apkVer / versionCode=$apkCode，期望 $propVer / $propCode。先跑 tools\build-release.ps1（它会 bump 版本号），或核对 src-tauri\gen\android\app\tauri.properties。"
    }
    Ok "版本号体检：$apkVer / versionCode=$apkCode 与 tauri.properties 一致"
  } else {
    Write-Host "   ⚠ aapt2 没解析出 APK 版本号，跳过版本号体检" -ForegroundColor Yellow
  }
} else {
  Write-Host "   ⚠ 缺 tauri.properties 或 aapt2，跳过版本号体检" -ForegroundColor Yellow
}

# ---------- 5b) 签名体检 / 补签：v1 + v2 + v3 必须有 ----------
# 为什么：AGP 在 minSdk>=24 时默认只签 v2；v2-only 的包在只看 META-INF v1 签名文件的安装器 /
# 老机型上会报「解析失败：安装包没有签名文件」（2026-10 玩家实报，dist 里 0.5.0 就是这种包）。
# 现在 gradle 已显式打开 v1+v2+v3，这一节负责**证明**三档都在，缺哪档就补哪档。
# 注意：apksigner verify 默认对 minSdk>=24 **跳过 v1 校验**——v2-only 的包也显示「Verifies」，
# 必须加 --min-sdk-version 23 强制按老机型口径验，才能暴露缺 v1。
# 不齐就用同一把 debug 密钥重签 v1+v2+v3（只改签名块，不动包内容，升级路径不变）→ 复检。
$btDir = Get-ChildItem (Join-Path $Sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
         Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending | Select-Object -First 1
$apksigner = if ($btDir) { Join-Path $btDir.FullName 'apksigner.bat' } else { $null }
# 从 apksigner 输出里读三档状态（true/false）；没这行就当作 false。
function Get-SigFlags($text) {
  return @{
    V1 = ($text -match 'Verified using v1 scheme \(JAR signing\): true')
    V2 = ($text -match 'Verified using v2 scheme \(APK Signature Scheme v2\): true')
    V3 = ($text -match 'Verified using v3 scheme \(APK Signature Scheme v3\): true')
  }
}
function Format-SigFlags($f) { return "v1=$($f.V1) v2=$($f.V2) v3=$($f.V3)" }
if (-not ($apksigner -and (Test-Path $apksigner))) {
  Write-Host "   ⚠ 没找到 apksigner（$Sdk\build-tools），**无法验证** v1/v2/v3；装好 build-tools 后重跑" -ForegroundColor Yellow
  throw "缺少 apksigner，拒绝产出未验证签名的 APK"
} else {
  $sigCheck = & $apksigner verify --min-sdk-version 23 --verbose $apk 2>&1
  $sigCode = $LASTEXITCODE
  $sigText = ($sigCheck | Out-String)
  $flags = Get-SigFlags $sigText
  if ($sigCode -eq 0 -and $flags.V1 -and $flags.V2 -and $flags.V3) {
    Ok "签名体检：v1 + v2 + v3 齐全（minSdk-23 强制口径）"
  } else {
    $origFlags = $flags
    Write-Host "   签名不齐（$(Format-SigFlags $origFlags)），用同一把 debug 密钥补签 v1+v2+v3" -ForegroundColor Yellow
    $ks = Join-Path $env:USERPROFILE '.android\debug.keystore'
    if (-not (Test-Path $ks)) { throw "签名不齐（$(Format-SigFlags $flags)），而且找不到调试密钥库：$ks" }
    $resigned = "$apk.resign-tmp"
    $signArgs = @('sign', '--ks', $ks, '--ks-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey',
                  '--key-pass', 'pass:android', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
                  '--v3-signing-enabled', 'true', '--out', $resigned, $apk)
    & $apksigner @signArgs 2>&1 | ForEach-Object { Write-Host "   $_" }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $resigned)) { throw "apksigner 补签失败（退出码 $LASTEXITCODE）" }
    Move-Item $resigned $apk -Force
    $sigCheck = & $apksigner verify --min-sdk-version 23 --verbose $apk 2>&1
    $sigText = ($sigCheck | Out-String)
    $flags = Get-SigFlags $sigText
    if ($LASTEXITCODE -ne 0 -or -not ($flags.V1 -and $flags.V2 -and $flags.V3)) {
      $sigCheck | Select-Object -First 12 | ForEach-Object { Write-Host "   $_" }
      throw "补签后仍不齐（$(Format-SigFlags $flags)），手动查：`"$apksigner`" verify --min-sdk-version 23 --verbose `"$apk`""
    }
    Ok "已补签 v1+v2+v3（原包 $(Format-SigFlags $origFlags)）"
  }
}
# Gradle / 签名期间源码也可能被修改，发布前再确认仍是本次前端快照。
& node (Join-Path $SourceRepo 'tools\build-tauri-app.cjs') --web --check
if ($LASTEXITCODE -ne 0) { throw '打包期间前端源码发生变化；停止发布，请重新打包。' }
# 补签可能重新写 ZIP；以最终要发布的文件再检查一次。
& node (Join-Path $SourceRepo 'tools\check-android-package.cjs') $apk
if ($LASTEXITCODE -ne 0) { throw '最终签名 APK 的原生库 / ZIP 对齐检查失败。' }
$distDir = Join-Path $SourceRepo 'src-tauri\dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$apkOut = Join-Path $distDir "ssdz-classic-$Abi-$profile-$stamp.apk"
Copy-Item -LiteralPath $apk -Destination $apkOut -Force -ErrorAction Stop
Say "完成"
Ok "APK：$apkOut（$([math]::Round((Get-Item $apkOut).Length/1MB,1)) MB）"
Ok "原始产物：$apk"

# ---------- 6) 顺手装到连着的设备（模拟器/真机都行） ----------
# ⚠️ 以前这里 `adb install` 的输出被 `Select-Object -Last 1` 吞掉、退出码也不看，
# 于是**装失败也打一个 ✓**（用户看到的就是「打包说好了，手机上说装不上」）。
# 现在：打印 adb 的真实输出、按退出码/关键字判断，失败就按常见两类给出处方。
$adb = Join-Path $Sdk 'platform-tools\adb.exe'
$devices = if ($NoInstall) { $null } else { & $adb devices 2>&1 | Select-String 'device$' }
if ($devices) {
  Say "检测到设备，直接安装并启动"
  $installOut = & $adb install -r $apk 2>&1
  $installCode = $LASTEXITCODE
  $installText = ($installOut | Out-String)
  $installOut | Select-Object -Last 4 | ForEach-Object { Write-Host "   $_" }
  if ($installCode -ne 0 -or $installText -match 'Failure|failed') {
    Write-Host "   ✗ 安装失败（adb 退出码 $installCode）" -ForegroundColor Red
    if ($installText -match 'VERSION_DOWNGRADE') {
      Write-Host "     原因：这个 APK 的 versionCode 比手机上装着的旧，安卓不允许降级安装。" -ForegroundColor Yellow
      Write-Host "     处方：确认用的是**最新**的包（本脚本出包前已对账过 gen\android 的版本号）；" -ForegroundColor Yellow
      Write-Host "           确实要降级就先卸载旧版：adb uninstall com.ssdz.classic（会清掉本机存档，先在游戏里导出）。" -ForegroundColor Yellow
    } elseif ($installText -match 'UPDATE_INCOMPATIBLE|signatures do not match|Signature') {
      Write-Host "     原因：手机上那个同名应用是**另一把签名**装的（换过调试密钥 / 换过机器）。" -ForegroundColor Yellow
      Write-Host "     处方：先卸载旧版再装：adb uninstall com.ssdz.classic（同样会清本机存档，先导出）。" -ForegroundColor Yellow
    } elseif ($installText -match 'INSUFFICIENT_STORAGE') {
      Write-Host "     原因：手机存储空间不足。" -ForegroundColor Yellow
    } elseif ($installText -match 'NO_MATCHING_ABIS|INSTALL_FAILED_NO_MATCHING_ABIS') {
      Write-Host "     原因：这个包不含手机 CPU 架构对应的 .so —— 真机请用 -Abi arm64-v8a 出包。" -ForegroundColor Yellow
    }
    throw "APK 安装失败（包本身没问题的话，按上面那条处方处理）"
  }
  & $adb shell monkey -p com.ssdz.classic -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
  Ok "已启动 com.ssdz.classic"
} else {
  $skipReason = if ($NoInstall) { '-NoInstall：保留设备现有应用与存档' } else { '没有连接的设备' }
  Write-Host "   （$skipReason，跳过安装。手动装：adb install -r `"$apk`"）" -ForegroundColor DarkGray
}
