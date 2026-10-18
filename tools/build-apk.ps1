<#
  build-apk.ps1 —— 松鼠大战怀旧版 · 安卓 APK 一键构建

  为什么需要这个脚本：Tauri 官方的 `tauri android build` 在**这台 Windows 机器**上跑不通，
  踩过的坑都在下面脚本里绕开了（每条都有注释说明原因）。想搞清楚细节看注释，
  只想出包就直接跑：

      pwsh -File tools\build-apk.ps1 -Abi x86_64                  # 模拟器用（debug）
      pwsh -File tools\build-apk.ps1 -Abi arm64-v8a -Release      # 真机用（推荐：体积小一半多）
      pwsh -File tools\build-apk.ps1 -Abi arm64-v8a -Release -SkipSyncStaging   # 前端没改时跳过暂存

  产出会复制到 src-tauri\dist\ssdz-classic-<abi>-<profile>-<日期>.apk，
  原始产物在 src-tauri\gen\android\app\build\outputs\apk\<flavor>\debug\ 下。

  依赖（本机现有布局，路径可用参数覆盖）：
    JDK 17     E:\Android\jdk-17.0.20.1+1
    Android SDK E:\Android\sdk（platform-tools / platforms;android-35 / build-tools;35.0.0 / ndk;27.0.12077973）
    纯 ASCII 的构建副本：E:\ssdz-android-build（见下面第 1 条）
#>
[CmdletBinding()]
param(
  [ValidateSet('x86_64','arm64-v8a','armeabi-v7a','x86')]
  [string]$Abi = 'x86_64',
  [switch]$Release,
  [string]$Jdk = 'E:\Android\jdk-17.0.20.1+1',
  [string]$Sdk = 'E:\Android\sdk',
  [string]$BuildRoot = 'E:\ssdz-android-build',   # 必须是纯 ASCII 路径，见第 1 条
  [string]$SourceRepo = '',                       # 默认 = 本脚本上一层的仓库根（下面补）
  [switch]$SkipSyncStaging
)

$ErrorActionPreference = 'Continue'
# 注意：$PSScriptRoot 在 param() 的默认值里还不可用（会是空串），必须到脚本体里再算。
if (-not $SourceRepo) {
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $SourceRepo = Split-Path -Parent $scriptDir
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

# ---------- 1) 纯 ASCII 构建副本 ----------
# 为什么：NDK 的 *-clang.cmd 包装器在 Windows 上按 GBK 传参，项目路径里有中文
# （E:\松鼠大战怀旧版）时，linker 收到的是乱码路径 → 报
# "ld.lld: error: cannot open E:\\\xcb\xc9\xca\xf3..." 链接必失败。
# 用目录联接（junction）也没用：Cargo 会把路径规范化回真实的中文路径。
# 所以只能真的复制一份到 ASCII 路径下构建。
if (-not (Test-Path (Join-Path $BuildRoot 'src-tauri\Cargo.toml'))) {
  Say "创建 ASCII 构建副本 $BuildRoot（首次会比较慢：约 600 MB）"
  New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
  # 不复制 target/（编译产物，几 GB，重编更快也更干净）
  robocopy $SourceRepo $BuildRoot /E /XD target /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  Ok "副本就绪"
} else {
  Say "同步源码改动到构建副本"
  # 只同步会改的东西：前端、Rust 源码、配置（不整份重拷，省时间）
  foreach ($rel in @('js','css','audio','images','scripts','src-tauri\src','src-tauri\build.rs',
                     'src-tauri\Cargo.toml','src-tauri\tauri.conf.json','src-tauri\tauri.android.conf.json',
                     'src-tauri\icons','tools\build-tauri-app.cjs')) {
    $s = Join-Path $SourceRepo $rel; $d = Join-Path $BuildRoot $rel
    if (-not (Test-Path $s)) { continue }
    if (Test-Path $s -PathType Container) { robocopy $s $d /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null }
    else { New-Item -ItemType Directory -Force -Path (Split-Path $d -Parent) | Out-Null; Copy-Item $s $d -Force }
  }
  Ok "已同步"
}

# ---------- 2) 暂存前端（frontendDist=web） ----------
# Tauri 是在**编译 Rust 时**把前端资源嵌进二进制的，所以必须先暂存再编译；
# 顺序反了就会出现「APK 装上了、能开、但白屏」。
if (-not $SkipSyncStaging) {
  Say "暂存前端到 src-tauri\web"
  Push-Location $BuildRoot
  & node (Join-Path $BuildRoot 'tools\build-tauri-app.cjs') --web | Select-Object -Last 1 | ForEach-Object { Ok $_ }
  Pop-Location
}

# ---------- 3) 编译 Rust（每个 ABI 都要单独的 .so） ----------
# 用 `tauri android build` 来做这一步，因为只有它会把 NDK 的 CC/AR/linker 等
# 交叉编译环境准备齐（裸 cargo build 会报 "linker cc not found"）。
# 它在最后「创建符号链接」那步必然失败（本机没开开发者模式、没有
# SeCreateSymbolicLinkPrivilege），所以下面第 4 步手工复制 .so。
Say "编译 Rust（$($map.target)）"
$so = Join-Path $BuildRoot "src-tauri\target\$($map.target)\$profile\libssdz_classic_lib.so"
if ($Release) { $so = Join-Path $BuildRoot "src-tauri\target\$($map.target)\release\libssdz_classic_lib.so" }
Push-Location (Join-Path $BuildRoot 'src-tauri')
# 注意：`tauri android build` **默认就是 release**，只有 `--debug` 这个反向开关，
# 传 `--release` 会报 unexpected argument '--release'。
$cliArgs = if ($Release) { @('android','build','--apk','--target',$map.tauri,'--ci') }
           else          { @('android','build','--debug','--apk','--target',$map.tauri,'--ci') }
$cliOut = & node 'node_modules\@tauri-apps\cli\tauri.js' @cliArgs 2>&1
Pop-Location
if (-not (Test-Path $so)) {
  $cliOut | Select-Object -Last 20 | ForEach-Object { Write-Host "   $_" }
  throw "Rust 产物不存在：$so"
}
Ok "$so（$([math]::Round((Get-Item $so).Length/1MB,1)) MB）"

# ---------- 4) 放 .so + 前端到 Android 工程 ----------
$jni = Join-Path $BuildRoot "src-tauri\gen\android\app\src\main\jniLibs\$Abi"
New-Item -ItemType Directory -Force -Path $jni | Out-Null
Copy-Item $so (Join-Path $jni 'libssdz_classic_lib.so') -Force
Ok "libssdz_classic_lib.so → jniLibs\$Abi"

$assets = Join-Path $BuildRoot 'src-tauri\gen\android\app\src\main\assets'
robocopy (Join-Path $BuildRoot 'src-tauri\web') $assets /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
Ok "前端资源 → assets（$((Get-ChildItem $assets -Recurse -Force -File | Measure-Object).Count) 个文件）"

# ---------- 4b) 安卓图标 / 清单 / 版本号（仓库里的 gen/android 是"真源"） ----------
# 图标用 `cd src-tauri && npx tauri icon app-icon.png` 生成（它会直接写进 gen/android/app/src/main/res）；
# 清单里有一处手工改动：android:screenOrientation="sensorLandscape"（游戏是 1216×760 横向比例，
# 锁横屏才不是竖屏中间一条）。这些都在 gen/android 里，而构建副本的 gen/android 是 init 时生成的，
# 所以每次构建都要从仓库同步过去——同步 res / 清单 / tauri.properties / app\build.gradle.kts，
# **绝不动 buildSrc**（那里有 node 路径的补丁）。
$srcGen = Join-Path $SourceRepo 'src-tauri\gen\android\app\src\main'
$dstGen = Join-Path $BuildRoot 'src-tauri\gen\android\app\src\main'
if (Test-Path (Join-Path $srcGen 'res')) {
  robocopy (Join-Path $srcGen 'res') (Join-Path $dstGen 'res') /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  Ok "安卓图标 → res（含 mipmap 各密度）"
}
if (Test-Path (Join-Path $srcGen 'AndroidManifest.xml')) {
  Copy-Item (Join-Path $srcGen 'AndroidManifest.xml') (Join-Path $dstGen 'AndroidManifest.xml') -Force
  Ok "AndroidManifest.xml → 已同步（含锁横屏）"
}
# ⚠️ **安卓版本号必须一起同步**（2026-10 用户报「安卓包装不上」的根因）：
# `tauri.android.versionName / versionCode` 由 build-release.ps1 每次发版 bump，
# 但它住在 `app\tauri.properties`，既不在上面那份同步目录清单里、也不在 res/清单 里 ——
# 于是构建副本永远停在**建副本那天**的 versionCode（实测仓库已是 0.4.9/4009，副本还停在 0.4.8/4008）。
# 后果：打出来的 APK versionCode 比手机上已经装着的**旧** → 安卓直接拒绝安装
#（「应用未安装」/ INSTALL_FAILED_VERSION_DOWNGRADE），而且游戏里显示的版本号也跟着旧。
# 写法上不假设目标文件一定存在（首次构建时由 tauri init 生成），缺行就补一行。
$srcProps = Join-Path $SourceRepo 'src-tauri\gen\android\app\tauri.properties'
$dstProps = Join-Path $BuildRoot 'src-tauri\gen\android\app\tauri.properties'
if (Test-Path $srcProps) {
  $srcText = [System.IO.File]::ReadAllText($srcProps)
  $ver = ([regex]'(?m)^tauri\.android\.versionName=(.+)$').Match($srcText).Groups[1].Value.Trim()
  $code = ([regex]'(?m)^tauri\.android\.versionCode=(.+)$').Match($srcText).Groups[1].Value.Trim()
  if ($ver -and $code) {
    $dstText = if (Test-Path $dstProps) { [System.IO.File]::ReadAllText($dstProps) } else { '' }
    if ($dstText -match '(?m)^tauri\.android\.versionName=') {
      $dstText = $dstText -replace '(?m)^tauri\.android\.versionName=.*$', "tauri.android.versionName=$ver"
    } else { $dstText = $dstText.TrimEnd() + "`ntauri.android.versionName=$ver`n" }
    if ($dstText -match '(?m)^tauri\.android\.versionCode=') {
      $dstText = $dstText -replace '(?m)^tauri\.android\.versionCode=.*$', "tauri.android.versionCode=$code"
    } else { $dstText = $dstText.TrimEnd() + "`ntauri.android.versionCode=$code`n" }
    New-Item -ItemType Directory -Force -Path (Split-Path $dstProps -Parent) | Out-Null
    [System.IO.File]::WriteAllText($dstProps, $dstText, (New-Object System.Text.UTF8Encoding($false)))
    Ok "安卓版本号 → $ver / versionCode=$code"
  } else {
    Write-Host "   ⚠ 没从 tauri.properties 读出安卓版本号，跳过同步" -ForegroundColor Yellow
  }
}

# 【签名】app\build.gradle.kts 也要从仓库同步：里面把 debug 变体的签名方案固定成 v1+v2+v3。
# 为什么：AGP 在 minSdk>=24 时**默认省略 v1**，v2-only 的包会被只看 META-INF 签名文件的
# 安装器 / 老机型判成「解析失败：安装包没有签名文件」（2026-10 玩家实报）。
# 不同步的话，旧构建副本里那份 gradle 文件永远打不出 v1。
# ⚠ 这个文件住在 `src-tauri\gen\android\`，整个目录是 gitignore 的本机真源；换机器 / 重新 init 后
#   很容易丢掉这三行。所以这里**先验一遍**：缺任何一档就明确告警（打完还有 apksigner 复检兜底）。
$srcGradle = Join-Path $SourceRepo 'src-tauri\gen\android\app\build.gradle.kts'
$dstGradle = Join-Path $BuildRoot 'src-tauri\gen\android\app\build.gradle.kts'
if (Test-Path $srcGradle) {
  Copy-Item $srcGradle $dstGradle -Force
  $gradleText = [System.IO.File]::ReadAllText($srcGradle)
  $wantFlags = @('enableV1Signing', 'enableV2Signing', 'enableV3Signing')
  $missing = @($wantFlags | Where-Object { $gradleText -notmatch ($_ + '\s*=\s*true') })
  if ($missing.Count) {
    Write-Host "   ⚠ app\build.gradle.kts 缺签名开关：$($missing -join ' / ')；打出来的包可能只有 v2（5b 会复检并补签）" -ForegroundColor Yellow
  } else {
    Ok "app\build.gradle.kts → 已同步（debug 签名 v1+v2+v3 三个开关都在）"
  }
} else {
  Write-Host "   ⚠ 仓库里没有 src-tauri\gen\android\app\build.gradle.kts（gitignore 的本机真源），跳过同步；5b 会按 v1/v2/v3 复检" -ForegroundColor Yellow
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
Push-Location (Join-Path $BuildRoot 'src-tauri\gen\android')
$flavorCap = $map.flavor.Substring(0,1).ToUpper() + $map.flavor.Substring(1)
$gradleTask = "assemble${flavorCap}Debug"
& .\gradlew.bat $gradleTask --no-daemon 2>&1 | Select-String -Pattern 'BUILD SUCCESSFUL|BUILD FAILED|FAILURE:' | ForEach-Object { Write-Host "   $_" }
$gradleCode = $LASTEXITCODE
Pop-Location
if ($gradleCode -ne 0) { throw "Gradle 打包失败（退出码 $gradleCode）" }

# 变体名是 debug，但里面的 .so 可能是 release 编出来的 —— 用 $profile 区分产物用途：
# 把 APK 复制成带用途的名字，免得两种包混淆。
$apk = Join-Path $BuildRoot "src-tauri\gen\android\app\build\outputs\apk\$($map.flavor)\debug\app-$($map.flavor)-debug.apk"
if (-not (Test-Path $apk)) { throw "没找到 APK：$apk" }

# ---------- 5a) 版本号体检：APK 里的 versionName/versionCode 必须与 tauri.properties 一致 ----------
# 为什么：2026-10 审计时 dist 里躺着一个 `squirrel-fight-0.5.0-...apk`，包内实际是
# **0.4.9 / versionCode=4009**（文件名对、内容旧）。这种包给用户装会：
#   ① 以为拿到了新版；② 覆盖安装被安卓判 VERSION_DOWNGRADE；③ 游戏内显示的版本号也是旧的。
# 根因就是构建副本的 tauri.properties 没同步（见 4b），所以这里在出包前再证明一次。
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
      throw "APK 版本号与 tauri.properties 不一致：包内 $apkVer / versionCode=$apkCode，期望 $propVer / $propCode。先跑 tools\build-release.ps1（它会 bump 并同步版本号），或检查构建副本的 gen\android\app\tauri.properties。"
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
$distDir = Join-Path $SourceRepo 'src-tauri\dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$apkOut = Join-Path $distDir "ssdz-classic-$Abi-$profile-$stamp.apk"
Copy-Item $apk $apkOut -Force
Say "完成"
Ok "APK：$apkOut（$([math]::Round((Get-Item $apkOut).Length/1MB,1)) MB）"
Ok "原始产物：$apk"

# ---------- 6) 顺手装到连着的设备（模拟器/真机都行） ----------
# ⚠️ 以前这里 `adb install` 的输出被 `Select-Object -Last 1` 吞掉、退出码也不看，
# 于是**装失败也打一个 ✓**（用户看到的就是「打包说好了，手机上说装不上」）。
# 现在：打印 adb 的真实输出、按退出码/关键字判断，失败就按常见两类给出处方。
$adb = Join-Path $Sdk 'platform-tools\adb.exe'
$devices = & $adb devices 2>&1 | Select-String 'device$'
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
      Write-Host "     处方：确认用的是**最新**的包（本脚本已同步 gen\android 的版本号）；" -ForegroundColor Yellow
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
  Write-Host "   （没有连接的设备，跳过安装。手动装：adb install -r `"$apk`"）" -ForegroundColor DarkGray
}
