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
                     'src-tauri\icons','tools\build-tauri-web.cjs')) {
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
  & node (Join-Path $BuildRoot 'tools\build-tauri-web.cjs') | Select-Object -Last 1 | ForEach-Object { Ok $_ }
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

# ---------- 4b) 安卓图标与清单（仓库里的 gen/android 是"真源"） ----------
# 图标用 `cd src-tauri && npx tauri icon app-icon.png` 生成（它会直接写进 gen/android/app/src/main/res）；
# 清单里有一处手工改动：android:screenOrientation="sensorLandscape"（游戏是 1216×760 横向比例，
# 锁横屏才不是竖屏中间一条）。这两样都在 gen/android 里，而构建副本的 gen/android 是 init 时生成的，
# 所以每次构建都要从仓库同步过去——只同步 res 与清单，**绝不动 buildSrc**（那里有 node 路径的补丁）。
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

# ---------- 5) Gradle 打包 ----------
# 那个 rust 任务（rustBuild*）不能被调用：它执行 `tauri android android-studio-script`，
# 而那个入口是给 Android Studio 用的，纯 Gradle 环境下会因为缺 -server-addr 文件而 panic；
# 官方模板里 node 路径还硬编码成带空格的 "C:\Program Files\nodejs\node"（多一个分号）。
# 已经打补丁：BuildTask.kt 检测到 jniLibs 里已有 .so 就直接跳过。
#
# 变体选择：**始终用 Gradle 的 Debug 变体**。Rust 侧该 release 还是 release（见上一步，
# 决定了 .so 的体积），而 Gradle 的 assembleRelease 出来的是**未签名** APK，
# 手机上根本装不上（除非自己配 keystore）。Debug 变体自带 debug 签名，装得上、能直接玩。
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
$distDir = Join-Path $SourceRepo 'src-tauri\dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd'
$apkOut = Join-Path $distDir "ssdz-classic-$Abi-$profile-$stamp.apk"
Copy-Item $apk $apkOut -Force
Say "完成"
Ok "APK：$apkOut（$([math]::Round((Get-Item $apkOut).Length/1MB,1)) MB）"
Ok "原始产物：$apk"

# ---------- 6) 顺手装到连着的设备（模拟器/真机都行） ----------
$adb = Join-Path $Sdk 'platform-tools\adb.exe'
$devices = & $adb devices 2>&1 | Select-String 'device$'
if ($devices) {
  Say "检测到设备，直接安装并启动"
  & $adb install -r $apk 2>&1 | Select-Object -Last 1 | ForEach-Object { Ok $_ }
  & $adb shell monkey -p com.ssdz.classic -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
  Ok "已启动 com.ssdz.classic"
} else {
  Write-Host "   （没有连接的设备，跳过安装。手动装：adb install -r `"$apk`"）" -ForegroundColor DarkGray
}
