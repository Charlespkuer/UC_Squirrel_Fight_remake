#!/usr/bin/env node
/* ============================================================
 * tools/sign-ios.cjs —— 给未签名 iOS IPA 套企业证书（生成 *_ios_*_signed.ipa）
 *
 * 用法：
 *   node tools/sign-ios.cjs                         # 签 dist 里当前版本、legacy 未签名包
 *   node tools/sign-ios.cjs --input <ipa> --output <ipa>
 *
 * 默认输入：src-tauri/dist/squirrel_fight_<version>_ios_legacy_unsigned.ipa
 * 默认输出：src-tauri/dist/squirrel_fight_<version>_ios_legacy_signed.ipa
 * 默认证书：src-tauri/10月20日企业证书/先导入.p12
 *          src-tauri/10月20日企业证书/后导入.mobileprovision
 * 密码：IOS_P12_PASSWORD，或从证书目录的「密码（点开查看）.txt」读取。
 *
 * 只做签名导出，不改 `com.ssdz.classic` 源码配置：
 *   - 描述文件的 App ID 是 jp.co.rakuten-sec.iSPEED...，签名副本临时改 Info.plist
 *     的 CFBundleIdentifier（企业包与 TrollStore/自签包是两个 App，存档不互通）；
 *   - 证书链在 Xcode 自带的 AppleWWDRCA-2030.cer（G3）；系统钥匙串里那条 WWDR
 *     是 2023 年过期的旧根，不能拿来签；
 *   - p12 装进临时钥匙串，签完删掉，不污染登录钥匙串。
 * ============================================================ */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TAURI = path.join(ROOT, 'src-tauri');
const DIST = path.join(TAURI, 'dist');
const ARGS = process.argv.slice(2);
const argValue = (name) => {
  const i = ARGS.indexOf(name);
  return i >= 0 ? ARGS[i + 1] : null;
};
const VERSION = JSON.parse(fs.readFileSync(path.join(TAURI, 'tauri.conf.json'), 'utf8')).version || '0.0.0';
const INPUT = path.resolve(ROOT, argValue('--input') || path.join(DIST, 'squirrel_fight_' + VERSION + '_ios_legacy_unsigned.ipa'));
const OUTPUT = path.resolve(ROOT, argValue('--output') || path.join(DIST, 'squirrel_fight_' + VERSION + '_ios_legacy_signed.ipa'));
const PROFILE = path.resolve(ROOT, argValue('--profile') || path.join(TAURI, '10月20日企业证书', '后导入.mobileprovision'));
const P12 = path.resolve(ROOT, argValue('--p12') || path.join(TAURI, '10月20日企业证书', '先导入.p12'));
const PASSWORD_FILE = path.join(TAURI, '10月20日企业证书', '密码（点开查看）.txt');
const IDENTITY = argValue('--identity') || 'iPhone Distribution: RAKUTEN SECURITIES,INC.';
const INTERMEDIATE = [
  '/Applications/Xcode.app/Contents/SharedFrameworks/AssetRuntime/DVTFoundation.framework/Versions/A/Resources/AppleWWDRCA-2030.cer',
  '/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/Library/PrivateFrameworks/DVTFoundation.framework/AppleWWDRCA-2030.cer',
].find((p) => fs.existsSync(p));

function fail(msg) { console.error('\n[x] ' + msg); process.exit(1); }
function info(msg) { console.log('— ' + msg); }
function ok(msg) { console.log('✓ ' + msg); }
function run(cmd, argv, opts) {
  const r = spawnSync(cmd, argv, Object.assign({ stdio: 'inherit', cwd: ROOT, env: process.env }, opts || {}));
  if (r.error) fail('执行失败：' + cmd + '（' + r.error.message + '）');
  if (r.status !== 0) fail(cmd + ' 退出码 ' + r.status);
}
function capture(cmd, argv, opts) {
  const r = spawnSync(cmd, argv, Object.assign({ encoding: 'utf8', cwd: ROOT, env: process.env }, opts || {}));
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}
function password() {
  if (process.env.IOS_P12_PASSWORD) return process.env.IOS_P12_PASSWORD;
  try {
    const text = fs.readFileSync(PASSWORD_FILE, 'utf8');
    const m = text.match(/密码\s*[:：]\s*(\S+)/);
    if (m) return m[1];
  } catch (e) {}
  fail('缺少 p12 密码：设置 IOS_P12_PASSWORD，或确认 ' + path.relative(ROOT, PASSWORD_FILE) + ' 里写着「密码：…」。');
}

function profileInfo() {
  const xml = capture('security', ['cms', '-D', '-i', PROFILE]);
  if (!xml.ok) fail('读不出描述文件：' + PROFILE + '\n' + xml.out.trim());
  const tmp = path.join(os.tmpdir(), 'ssdz-profile-' + process.pid + '.plist');
  fs.writeFileSync(tmp, xml.out);
  try {
    const entitlements = capture('plutil', ['-extract', 'Entitlements', 'xml1', '-o', '-', tmp]);
    if (!entitlements.ok) fail('描述文件里没有 Entitlements。');
    const parsed = capture('plutil', ['-extract', 'Entitlements', 'json', '-o', '-', tmp]);
    let ent = {};
    try { ent = JSON.parse(parsed.out); } catch (e) {}
    const appId = String((ent && ent['application-identifier']) || '');
    const team = String((ent && ent['com.apple.developer.team-identifier']) || '');
    let bundleId = appId;
    if (team && bundleId.startsWith(team + '.')) bundleId = bundleId.slice(team.length + 1);
    const expiration = capture('plutil', ['-extract', 'ExpirationDate', 'raw', '-o', '-', tmp]).out.trim();
    return { entitlementsXml: entitlements.out, appId: appId, team: team, bundleId: bundleId, expiration: expiration };
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch (e) {}
  }
}

if (process.platform !== 'darwin') fail('iOS 签名只能在 macOS 上跑。');
for (const [label, file] of [['未签名 IPA', INPUT], ['描述文件', PROFILE], ['p12 证书', P12]]) {
  if (!fs.existsSync(file)) fail('找不到' + label + '：' + file);
}
const P12_PASSWORD = password();
const profile = profileInfo();
if (!profile.bundleId) fail('描述文件里没有可用的 application-identifier。');
if (profile.expiration && Date.parse(profile.expiration) < Date.now()) {
  fail('描述文件已过期（' + profile.expiration + '）：' + PROFILE);
}
if (!['jp.co.rakuten-sec.iSPEED.Pushnotification.widgetapp.widgetkitextension'].includes(profile.bundleId)) {
  info('描述文件 App ID：' + profile.bundleId);
}
if (!INTERMEDIATE) fail('找不到 Apple WWDR G3 中间证书（AppleWWDRCA-2030.cer）；请安装 Xcode 或在脚本里补路径。');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssdz-sign-'));
const keychain = path.join(temp, 'sign.keychain-db');
const keychainPass = crypto.randomBytes(18).toString('hex');
let oldKeychains = null, keychainCreated = false;

function restoreKeychains() {
  if (oldKeychains == null) return;
  try { run('security', ['list-keychains', '-d', 'user', '-s', ...oldKeychains], { stdio: 'ignore' }); } catch (e) {}
  oldKeychains = null;
}

try {
  info('解包：' + path.relative(ROOT, INPUT));
  const payload = path.join(temp, 'Payload');
  fs.mkdirSync(payload, { recursive: true });
  run('unzip', ['-q', INPUT, '-d', temp], { stdio: 'ignore' });

  const apps = fs.readdirSync(payload).filter((n) => n.endsWith('.app'));
  if (apps.length !== 1) fail('Payload 里应当只有一个 .app，实得：' + apps.join('、'));
  const app = path.join(payload, apps[0]);
  const plist = path.join(app, 'Info.plist');
  if (!fs.existsSync(plist)) fail('找不到 Info.plist：' + plist);

  info('改包名：' + profile.bundleId + '（与描述文件一致）');
  run('plutil', ['-replace', 'CFBundleIdentifier', '-string', profile.bundleId, plist], { stdio: 'ignore' });
  const entFile = path.join(temp, 'entitlements.plist');
  fs.writeFileSync(entFile, profile.entitlementsXml);
  fs.copyFileSync(PROFILE, path.join(app, 'embedded.mobileprovision'));
  ok('Info.plist / embedded.mobileprovision 已写入');

  info('创建临时钥匙串（不碰登录钥匙串）');
  run('security', ['create-keychain', '-p', keychainPass, keychain], { stdio: 'ignore' });
  keychainCreated = true;
  run('security', ['set-keychain-settings', '-lut', '21600', keychain], { stdio: 'ignore' });
  run('security', ['unlock-keychain', '-p', keychainPass, keychain], { stdio: 'ignore' });
  run('security', ['import', P12, '-k', keychain, '-P', P12_PASSWORD,
    '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'], { stdio: 'ignore' });
  run('security', ['import', INTERMEDIATE, '-k', keychain,
    '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'], { stdio: 'ignore' });
  oldKeychains = capture('security', ['list-keychains', '-d', 'user']).out
    .split('\n').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...oldKeychains], { stdio: 'ignore' });
  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPass, keychain], { stdio: 'ignore' });
  const identities = capture('security', ['find-identity', '-v', '-p', 'codesigning', keychain]);
  if (!identities.out.includes(IDENTITY)) fail('临时钥匙串里找不到签名身份：' + IDENTITY + '\n' + identities.out.trim());
  ok('签名身份已就绪：' + IDENTITY);

  info('codesign（含 entitlements）');
  run('codesign', ['--force', '--deep', '--sign', IDENTITY, '--entitlements', entFile,
    '--generate-entitlement-der', '--timestamp=none', app]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const signed = capture('codesign', ['-dvvv', app]);
  if (!/TeamIdentifier=HWK767YYMF/.test(signed.out) || !/Authority=iPhone Distribution/.test(signed.out)) {
    fail('签名校验失败：\n' + signed.out.trim());
  }
  ok('签名通过：Team HWK767YYMF');

  if (fs.existsSync(OUTPUT)) fs.rmSync(OUTPUT, { force: true });
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  info('封 IPA：' + path.relative(ROOT, OUTPUT));
  run('zip', ['-qry', OUTPUT, 'Payload'], { cwd: temp, stdio: 'ignore' });
  const size = fs.statSync(OUTPUT).size;
  ok('签名 IPA：' + path.relative(ROOT, OUTPUT) + '（' + (size / 1048576).toFixed(1) + ' MB）');
  console.log('  Bundle：' + profile.bundleId + '　描述文件到期：' + (profile.expiration || '未知'));
} finally {
  try { restoreKeychains(); } catch (e) {}
  if (keychainCreated) { try { run('security', ['delete-keychain', keychain], { stdio: 'ignore' }); } catch (e) {} }
  try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
}
