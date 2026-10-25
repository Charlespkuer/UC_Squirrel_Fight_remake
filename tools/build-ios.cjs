#!/usr/bin/env node
/* ============================================================
 * tools/build-ios.cjs —— 打 iOS 未签名 IPA（iPhone + iPad，锁横屏）
 *
 *   node tools/build-ios.cjs              # iOS 26+（带 UIScene，走 scene 生命周期）
 *   node tools/build-ios.cjs --legacy     # iOS 15~25（传统 AppDelegate 生命周期，不声明 UIScene）
 *   node tools/build-ios.cjs --check      # 只检查 Xcode / Rust / xcodegen / pod 是否就绪
 *   node tools/build-ios.cjs --clean      # 先删掉上一次的 build/ 归档再打
 *
 * 产物：
 *   src-tauri/dist/squirrel_fight_<version>_ios_unsigned.ipa         # iOS 26/27
 *   src-tauri/dist/squirrel_fight_<version>_ios_legacy_unsigned.ipa  # iOS 15~25
 *
 * 为什么要两个包：
 *   iOS 26+ 强制 UIScene，没声明 UIApplicationSceneManifest 会启动即崩；
 *   反过来，tao 0.35 的 scene 启动路径在 iOS 15 上有兼容问题（后续 tao 0.37 才修），
 *   15.6.1 + TrollStore 的反馈就是启动闪退。两个包共用同一份前端与二进制，
 *   唯一差异是 Info.plist 里有没有 UIScene 声明——按系统版本发给对应玩家即可。
 *
 * 为什么不用 `tauri ios build` 默认的签名导出：
 *   本仓库只有未签名需求，`--no-sign --archive-only` 最稳；导出 IPA 那一步在
 *   没有证书时会失败，所以这里直接从 .xcarchive 里取 .app，手工封成
 *   Payload/<app>.app 的 zip。
 *
 * 工程补丁（gen/apple 整体是生成物，重新 init 后由本脚本自动补回）：
 *   1. project.yml：横屏两向、中文显示名、隐藏状态栏/Home 条、iPhone+iPad；
 *   2. project.pbxproj：objectVersion 77 → 55（CocoaPods 1.11 的 xcodeproj 不认识 77）；
 *   3. Podfile：删掉模板里不存在的 macOS target（否则 pod install 直接报错）。
 *
 * 依赖（macOS 上一次性准备）：
 *   · Xcode（App Store 安装，打开一次同意协议）；
 *   · Rust + iOS 目标 + llvm-tools：
 *       rustup target add aarch64-apple-ios
 *       rustup component add llvm-tools        # Xcode 27 下 swift-rs 需要 llvm-objcopy
 *   · xcodegen、CocoaPods（brew install xcodegen cocoapods）；
 *   · Node 依赖：cd src-tauri && npm install。
 *   Xcode 27 的 macOS 上如果 Homebrew 的 CocoaPods 跑不起来，本机已验证可用的
 *   替代方案见 tools/build-guide.md 的 iOS 章节（gem 安装 1.11.3 + 头文件路径补丁）。
 * ============================================================ */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TAURI = path.join(ROOT, 'src-tauri');
const GEN = path.join(TAURI, 'gen', 'apple');
const DIST = path.join(TAURI, 'dist');
const CLI = path.join(TAURI, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
/* 版本只有一个来源：`src-tauri/tauri.conf.json`。工程文件是生成物，里面的
 * `CFBundleShortVersionString` 可能是旧的（实测 1.0.4 时仍是 1.0.2），必须在
 * `xcodegen generate` 之前同步回来，否则打出来的包名是 1.0.4、包内版本却是旧值。 */
const VERSION = JSON.parse(fs.readFileSync(path.join(TAURI, 'tauri.conf.json'), 'utf8')).version || '0.0.0';
/* 显示版本（`scripts/version.json`）允许四段热修号（1.1.0.1）。Apple 的
 * `CFBundleShortVersionString` 只接受三段，所以**包内**仍然写 `VERSION`，只有
 * 文件名 / 控制台 / 构建号使用显示版本 —— 这样 IPA 文件名和游戏内「当前版本」
 * 一致，又不会被 iOS 的版本格式校验拦下。 */
const DISPLAY_VERSION = (() => {
  try {
    const v = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'version.json'), 'utf8')).version || '');
    return /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(v) ? v : VERSION;
  } catch (e) { return VERSION; }
})();
const ARGS = process.argv.slice(2);
/* `--build 105`：iOS 26+ 修复包要覆盖 iOS 27 上已装的同版本 104 时，必须有一个更高的
 * CFBundleVersion（manifest 的 bundle-version 也同步用它）。默认仍由版本号去点得到。 */
const BUILD_OVERRIDE = (() => {
  const i = ARGS.indexOf('--build');
  const v = i >= 0 ? String(ARGS[i + 1] || '') : '';
  return /^\d+(?:\.\d+){0,2}$/.test(v) ? v : '';
})();
const BUILD_NUMBER = BUILD_OVERRIDE || String(DISPLAY_VERSION.split('.').map((n) => String(Math.max(0, parseInt(n, 10) || 0))).join('')) || '1';
const CHECK_ONLY = ARGS.includes('--check');
const CLEAN = ARGS.includes('--clean');
const LEGACY = ARGS.includes('--legacy');

function fail(msg) {
  console.error('\n[x] ' + msg);
  process.exit(1);
}
function info(msg) { console.log('— ' + msg); }
function ok(msg) { console.log('✓ ' + msg); }
function run(cmd, argv, opts) {
  console.log('> ' + [cmd].concat(argv).join(' '));
  const r = spawnSync(cmd, argv, Object.assign({ stdio: 'inherit', cwd: ROOT, env: process.env }, opts || {}));
  if (r.error) fail('执行失败：' + cmd + '（' + r.error.message + '）');
  if (r.status !== 0) process.exit(r.status || 1);
}
function capture(cmd, argv, opts) {
  const r = spawnSync(cmd, argv, Object.assign({ encoding: 'utf8', cwd: ROOT, env: process.env }, opts || {}));
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

/* ---------- 0. 环境 ---------- */
if (process.platform !== 'darwin') fail('iOS 包只能在 macOS 上打。');
const XCODE = process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer';
if (!fs.existsSync(path.join(XCODE, 'usr', 'bin', 'xcodebuild'))) {
  fail('找不到完整 Xcode：' + XCODE + '\n    请从 App Store 安装 Xcode，打开一次同意协议；或用 DEVELOPER_DIR 指定。');
}
process.env.DEVELOPER_DIR = XCODE;

const GEM_BINS = (() => {
  const base = path.join(os.homedir(), '.gem', 'ruby');
  try { return fs.readdirSync(base).map((v) => path.join(base, v, 'bin')).filter((p) => fs.existsSync(p)); }
  catch (e) { return []; }
})();
/* 先把 cargo/bin 放进 PATH，才能用 rustc 问到 sysroot；llvm-objcopy 在 sysroot 下。 */
process.env.PATH = [
  ...GEM_BINS,
  '/opt/homebrew/bin', '/usr/local/bin',
  path.join(os.homedir(), '.cargo', 'bin'),
  process.env.PATH || '',
].filter(Boolean).join(path.delimiter);
const rustc = capture('rustc', ['--print', 'sysroot']);
const SYSROOT = rustc.ok ? rustc.out.trim() : '';
const LLVM_BIN = SYSROOT ? path.join(SYSROOT, 'lib', 'rustlib', 'aarch64-apple-darwin', 'bin') : '';
if (LLVM_BIN) process.env.PATH = LLVM_BIN + path.delimiter + process.env.PATH;

info('Xcode：' + capture('xcodebuild', ['-version']).out.split('\n')[0]);
if (!fs.existsSync(LLVM_BIN + path.sep + 'llvm-objcopy')) {
  fail('缺 llvm-objcopy：先跑 rustup component add llvm-tools（Xcode 27 下不加会链接失败）。');
}
for (const [name, argv] of [['rustc', ['--version']], ['cargo', ['--version']], ['xcodegen', ['--version']], ['pod', ['--version']]]) {
  const r = capture(name, argv);
  if (!r.ok) fail('找不到 ' + name + '（' + r.out.split('\n')[0] + '）。请按文件头的依赖说明安装。');
  info(name + '：' + r.out.split('\n').filter(Boolean)[0]);
}
if (!fs.existsSync(CLI)) fail('src-tauri/node_modules 不完整：先 cd src-tauri && npm install。');
const targets = capture('rustup', ['target', 'list', '--installed']);
if (!/aarch64-apple-ios\b/.test(targets.out)) fail('缺 Rust iOS 目标：rustup target add aarch64-apple-ios');
if (CHECK_ONLY) { ok('环境就绪（--check 到此为止）'); process.exit(0); }

/* ---------- 1. 前端快照 + 图标 ---------- */
info('生成前端快照 src-tauri/web');
run(process.execPath, [path.join(ROOT, 'tools', 'build-tauri-app.cjs'), '--web'], { cwd: ROOT });

info('生成 iOS 图标（奶油底，避免透明通道）');
run(process.execPath, [CLI, 'icon', 'app-icon.png', '--ios-color', '#FFF3DC'], { cwd: TAURI });

/* ---------- 2. iOS 工程（首次 init；之后只补丁） ---------- */
if (!fs.existsSync(path.join(GEN, 'project.yml'))) {
  info('首次生成 gen/apple');
  run(process.execPath, [CLI, 'ios', 'init', '--ci'], { cwd: TAURI });
}

function patchProjectYml() {
  const file = path.join(GEN, 'project.yml');
  let text = fs.readFileSync(file, 'utf8');
  const before = text;

  text = text.replace(
    /(        UISupportedInterfaceOrientations:\n)(?:          - UIInterfaceOrientation[^\n]*\n)+/,
    '$1          - UIInterfaceOrientationLandscapeLeft\n          - UIInterfaceOrientationLandscapeRight\n'
  );
  text = text.replace(
    /(        UISupportedInterfaceOrientations~ipad:\n)(?:          - UIInterfaceOrientation[^\n]*\n)+/,
    '$1          - UIInterfaceOrientationLandscapeLeft\n          - UIInterfaceOrientationLandscapeRight\n'
  );

  text = text.replace(/CFBundleShortVersionString: [^\n]*/g, 'CFBundleShortVersionString: ' + VERSION);
  text = text.replace(/CFBundleVersion: [^\n]*/g, 'CFBundleVersion: "' + BUILD_NUMBER + '"');

  if (!/CFBundleDisplayName:/.test(text)) {
    text = text.replace(/(        CFBundleVersion: [^\n]*\n)/, [
      '$1',
      '        CFBundleDisplayName: 松鼠大战\n',
      '        UIRequiresFullScreen: true\n',
      '        UIStatusBarHidden: true\n',
      '        UIViewControllerBasedStatusBarAppearance: false\n',
      '        UIStatusBarStyle: UIStatusBarStyleLightContent\n',
      '        UIHomeIndicatorAutoHidden: true\n',
      '        UIApplicationSupportsIndirectInputEvents: true\n',
      '        ITSAppUsesNonExemptEncryption: false\n',
    ].join(''));
  }

  /* iOS 26+ 强制 UIScene 生命周期。tao 用 UIApplicationSupportsMultipleScenes 判断是否走
   * scene 分支，必须为 true（游戏仍然只创建一个窗口）；没有这段，iOS 27 SDK 上启动即崩。 */
  if (!/UIApplicationSceneManifest:/.test(text)) {
    text = text.replace(/(        ITSAppUsesNonExemptEncryption: [^\n]*\n)/, [
      '$1',
      '        UIApplicationSceneManifest:\n',
      '          UIApplicationSupportsMultipleScenes: true\n',
      '          UISceneConfigurations:\n',
      '            UIWindowSceneSessionRoleApplication:\n',
      '              - UISceneConfigurationName: Default Configuration\n',
      '                UISceneDelegateClassName: TaoSceneDelegate\n',
    ].join(''));
  }

  if (!/TARGETED_DEVICE_FAMILY:/.test(text)) {
    text = text.replace(/(        VALID_ARCHS: arm64[^\n]*\n)/, '$1        TARGETED_DEVICE_FAMILY: "1,2"\n');
  }

  /* iOS 15 + TrollStore 排查：不要再声明「间接输入」开关，避免旧 WebKit 把直接触摸
   * 当成 pointer 设备事件处理。游戏只需要触摸/指针事件，不需要触控板专用开关。 */
  text = text.replace(/\n {8}UIApplicationSupportsIndirectInputEvents: true/g, '');

  /* --legacy：删掉 UIScene 块，让 iOS 15~25 走传统 AppDelegate 生命周期。
   * tao 0.35 的 scene 启动路径在 iOS 15 上有兼容问题（tao 0.37 才修），
   * 15.6.1 的闪退就是从这里来的。 */
  if (LEGACY) {
    const kept = [];
    let skipping = false;
    for (const line of text.split('\n')) {
      if (/^        UIApplicationSceneManifest:\s*$/.test(line)) { skipping = true; continue; }
      if (skipping) {
        if (/^ {0,8}\S/.test(line) || /^\s*$/.test(line)) skipping = false;
        else continue;
      }
      kept.push(line);
    }
    text = kept.join('\n');
  }

  if (text !== before) {
    fs.writeFileSync(file, text);
    ok('project.yml：横屏 / 中文名 / iPhone+iPad 已补丁');
  }

  /* 启动页默认是 systemBackgroundColor（白色）：冷启动/退出动画时四边会先闪一圈白，
   * iOS 用户看到的「白边」有一部分就是它。工程文件是生成物，每次 build 都补成黑底。 */
  const launch = path.join(GEN, 'LaunchScreen.storyboard');
  if (fs.existsSync(launch)) {
    let screen = fs.readFileSync(launch, 'utf8');
    const black = '<color key="backgroundColor" red="0" green="0" blue="0" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>';
    const next = screen
      .replace(/<color key="backgroundColor" systemColor="systemBackgroundColor"\s*\/>/, black)
      .replace(/<color key="backgroundColor"[^>]*\/>/, black);
    if (next !== screen) {
      fs.writeFileSync(launch, next);
      ok('LaunchScreen.storyboard：黑底');
    }
  }
  run('xcodegen', ['generate'], { cwd: GEN });
}

function patchXcodeProject() {
  const xcodeproj = fs.readdirSync(GEN).find((n) => n.endsWith('.xcodeproj'));
  if (!xcodeproj) fail('gen/apple 下没有 .xcodeproj');
  const file = path.join(GEN, xcodeproj, 'project.pbxproj');
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  /* CocoaPods 1.11 的 xcodeproj 只认到 objectVersion 55；XcodeGen/Xcode 27 默认写 77。 */
  text = text.replace(/objectVersion = \d+;/g, 'objectVersion = 55;')
    .replace(/\n\s*preferredProjectObjectVersion = \d+;/g, '')
    .replace(/\n\s*minimizedProjectReferenceProxies = 1;/g, '');
  if (text !== before) {
    fs.writeFileSync(file, text);
    ok('project.pbxproj：objectVersion → 55（兼容 CocoaPods）');
  }
  return xcodeproj;
}

function patchPodfile() {
  const file = path.join(GEN, 'Podfile');
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  /* Tauri 模板同时写了 iOS 和 macOS 两个 target，但 iOS 工程里只有前者。 */
  text = text.replace(/\ntarget '[^']+_macOS' do\n[\s\S]*?\nend\n/, '\n');
  if (text !== before) {
    fs.writeFileSync(file, text);
    ok('Podfile：删掉不存在的 macOS target');
  }
}

patchProjectYml();
patchXcodeProject();
patchPodfile();
info('pod install（工程无 Pod 依赖，只生成 workspace）');
run('pod', ['install', '--no-repo-update'], { cwd: GEN });

/* ---------- 3. 归档 ---------- */
if (CLEAN) {
  fs.rmSync(path.join(GEN, 'build'), { recursive: true, force: true });
  ok('已清掉 gen/apple/build');
}
info('开始归档（' + (LEGACY ? 'legacy / iOS 15~25，无 UIScene' : 'scene / iOS 26+，带 UIScene') +
  '；未签名；Rust + 134 MB 前端资源，首次约 5–10 分钟）');
/* ⚠ 不要用 `tauri ios build --build-number`：它把数字拼到主版本上（1.0.4 + 104 → 1.104），
 * 不是 CFBundleVersion。构建号统一在归档后写 Info.plist（见下面的 `plutil -replace`）。 */
run(process.execPath, [CLI, 'ios', 'build', '--no-sign', '--archive-only', '--ci'], { cwd: TAURI });

/* ---------- 4. 找 .app 并封 IPA ---------- */
const buildDir = path.join(GEN, 'build');
const archives = fs.existsSync(buildDir)
  ? fs.readdirSync(buildDir).filter((n) => n.endsWith('.xcarchive')).map((n) => path.join(buildDir, n))
  : [];
if (!archives.length) fail('没有找到 .xcarchive：' + buildDir);
archives.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const archive = archives[0];
const appsDir = path.join(archive, 'Products', 'Applications');
const apps = fs.existsSync(appsDir) ? fs.readdirSync(appsDir).filter((n) => n.endsWith('.app')) : [];
if (!apps.length) fail('归档里没有 .app：' + appsDir);
const app = path.join(appsDir, apps[0]);

const conf = JSON.parse(fs.readFileSync(path.join(TAURI, 'tauri.conf.json'), 'utf8'));
const version = VERSION || conf.version || '0.0.0';
const label = DISPLAY_VERSION || version;
const out = path.join(DIST, 'squirrel_fight_' + label +
  (LEGACY ? '_ios_legacy_unsigned.ipa' : '_ios_unsigned.ipa'));
fs.mkdirSync(DIST, { recursive: true });

/* 校验关键 plist 字段，防止补丁没生效 */
const plist = path.join(app, 'Info.plist');
/* Tauri 会按 `tauri.ios.conf.json` 的 bundleVersion 把 CFBundleVersion 写回 1；归档后
 * 统一改成「版本号去点」（1.0.4 → 104），保证签发/安装能看出比上一版新。 */
run('plutil', ['-replace', 'CFBundleShortVersionString', '-string', version, plist], { stdio: 'ignore' });
run('plutil', ['-replace', 'CFBundleVersion', '-string', BUILD_NUMBER, plist], { stdio: 'ignore' });
ok('Info.plist：CFBundleShortVersionString=' + version + '，CFBundleVersion=' + BUILD_NUMBER);
const plistGet = (key, fmt) => capture('plutil', ['-extract', key, fmt || 'raw', '-o', '-', plist]);
const bundleId = plistGet('CFBundleIdentifier').out.trim();
const minOs = plistGet('MinimumOSVersion').out.trim();
const families = plistGet('UIDeviceFamily', 'json').out.trim();
const orient = plistGet('UISupportedInterfaceOrientations', 'json').out.trim();
const sceneInfo = plistGet('UIApplicationSceneManifest', 'json');
const scene = sceneInfo.out.trim();
const display = plistGet('CFBundleDisplayName').out.trim();
const shortVersion = plistGet('CFBundleShortVersionString').out.trim();
const buildNumber = plistGet('CFBundleVersion').out.trim();
if (bundleId !== 'com.ssdz.classic') fail('CFBundleIdentifier 不对：' + bundleId);
if (shortVersion !== version) fail('包内版本号不是 ' + version + '：' + shortVersion + '（工程文件没同步？）');
if (buildNumber !== BUILD_NUMBER) fail('包内构建号不是 ' + BUILD_NUMBER + '：' + buildNumber);
/* 存档导出依赖 Documents 在「文件」App 可见：少任何一个键，玩家点导出就找不到文件。 */
const fileSharing = plistGet('UIFileSharingEnabled').out.trim();
const openInPlace = plistGet('LSSupportsOpeningDocumentsInPlace').out.trim();
if (fileSharing !== 'true' || openInPlace !== 'true') {
  fail('Info.plist 缺少文件 App 共享声明（UIFileSharingEnabled=' + fileSharing +
    '，LSSupportsOpeningDocumentsInPlace=' + openInPlace + '）');
}
if (families !== '[1,2]') fail('UIDeviceFamily 不是 iPhone+iPad：' + families);
if (orient.indexOf('Portrait') >= 0 || orient.indexOf('Landscape') < 0) fail('屏幕方向不是仅横屏：' + orient);
if (LEGACY) {
  if (sceneInfo.ok) fail('legacy 包不应包含 UIScene 声明：' + scene);
} else if (!sceneInfo.ok || scene.indexOf('"UIApplicationSupportsMultipleScenes":true') < 0) {
  fail('缺少 UIScene 生命周期（iOS 26+ 会启动即崩）：' + scene);
}
const lipo = capture('lipo', ['-info', path.join(app, conf.mainBinaryName || 'squirrel_fight')]);
if (!/arm64/.test(lipo.out)) fail('可执行文件不是 arm64：' + lipo.out);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssdz-ipa-'));
try {
  fs.mkdirSync(path.join(tmp, 'Payload'), { recursive: true });
  fs.cpSync(app, path.join(tmp, 'Payload', path.basename(app)), { recursive: true, preserveTimestamps: true });
  run('zip', ['-qry', out, 'Payload'], { cwd: tmp });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const signed = capture('codesign', ['-dv', app]).ok;
ok('IPA：' + out + '（' + mb(fs.statSync(out).size) + '）');
console.log('  App：' + path.relative(ROOT, app) + '（' + mb(fs.statSync(path.join(app, conf.mainBinaryName || 'squirrel_fight')).size) + ' 可执行文件）');
console.log('  Bundle：' + bundleId + '　显示版本：' + label + '　包内版本：' + version + '　构建号：' + BUILD_NUMBER + '　最低 iOS：' + minOs + '　设备族：iPhone+iPad');
console.log('  显示名：' + display + '　方向：横屏　签名：' + (signed ? '已签名（意外）' : '未签名'));
console.log('  模式：' + (LEGACY ? 'iOS 15~25 传统生命周期（无 UIScene）' : 'iOS 26+ UIScene 生命周期'));
console.log('');
console.log('安装：iOS 15~25 用 legacy 包；iOS 26/27 用默认包。用 Sideloadly / AltStore / 爱思助手 选对应 IPA，用自己的 Apple ID 自签。');
console.log('      免费 Apple ID 的签名 7 天有效，到期重签；不需要开发者账号。');
console.log('⚠ 更新必须沿用同一签名身份/bundle ID：企业签名的 App ID 与未签名/TrollStore 的 com.ssdz.classic');
console.log('  是两个不同的 iOS App，存档容器不互通；来回换身份会看起来像「存档在初始档/有进度档之间横跳」。');
