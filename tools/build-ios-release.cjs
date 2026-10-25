#!/usr/bin/env node
/* ============================================================
 * tools/build-ios-release.cjs —— macOS 一键签名 IPA（现代 + legacy）
 *
 * 由 scripts/一键打包IPA.command 调用；也可以直接：
 *   node tools/build-ios-release.cjs                 # 自动 patch 版本 → 构建 → 签名 → 清 dist
 *   node tools/build-ios-release.cjs --dry-run       # 只打印计划，不写文件、不构建
 *   node tools/build-ios-release.cjs --version 1.0.7 # 指定版本
 *   node tools/build-ios-release.cjs --no-bump       # 保持当前版本重打
 *   node tools/build-ios-release.cjs --build 120     # 指定 CFBundleVersion
 *
 * 口径（用户 2026-10 要求）：
 *   · 每次自动把 patch 版本 +1（也读 dist 里已有 IPA 文件名的最大版本，避免回退）；
 *   · 出两个签名 IPA：modern（UIScene，iOS 25–26）与 legacy（传统生命周期，iOS 16–24）；
 *   · 成功后删除 src-tauri/dist 里**除这两个签名包以外的全部 .ipa**（旧签名、旧的未签名、
 *     本轮中间产物都删）；此前先保留旧包，构建/签名失败会回滚版本并保留旧包。
 *
 * 构建号：iOS 覆盖安装要求 CFBundleVersion 递增。默认取 dist 里现有 IPA 的最大构建号 +1，
 * 最低 110（本机旧 dist 最高 109、上一轮远端手工包 108）；没有旧包时也不会做出 105/106 这种低于 110 的包。
 * ============================================================ */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TAURI = path.join(ROOT, 'src-tauri');
const DIST = path.join(TAURI, 'dist');
const VERSION_JSON = path.join(ROOT, 'scripts', 'version.json');
const MIN_BUILD = 110;

const ARGS = process.argv.slice(2);
const OPTS = { dryRun: false, version: null, noBump: false, build: null, help: false };

function info(msg) { console.log('— ' + msg); }
function ok(msg) { console.log('✓ ' + msg); }
function warn(msg) { console.log('! ' + msg); }
function fail(msg) { throw new Error(msg); }

function parseArgs() {
  for (let i = 0; i < ARGS.length; i++) {
    const arg = ARGS[i];
    if (arg === '--dry-run') OPTS.dryRun = true;
    else if (arg === '--no-bump') OPTS.noBump = true;
    else if (arg === '--help' || arg === '-h') OPTS.help = true;
    else if (arg === '--version') {
      const value = String(ARGS[++i] || '').replace(/^v/, '');
      if (!/^\d+\.\d+\.\d+$/.test(value)) fail('--version 需要 x.y.z');
      OPTS.version = value;
    } else if (arg === '--build') {
      const value = Number(ARGS[++i]);
      if (!Number.isSafeInteger(value) || value < 1) fail('--build 需要正整数');
      OPTS.build = value;
    } else fail('未知参数：' + arg);
  }
  if (OPTS.version && OPTS.noBump) fail('--version 与 --no-bump 不能同时使用');
}

function usage() {
  console.log([
    '用法：node tools/build-ios-release.cjs [选项]',
    '  --dry-run        只打印版本 / 构建号 / 产物计划，不写文件、不构建',
    '  --version x.y.z  指定目标版本（默认从当前版本/ dist 最大版本 patch +1）',
    '  --no-bump        保持当前版本重打（构建号仍会递增）',
    '  --build N        指定 CFBundleVersion（默认 dist 最大构建号 +1，最低 ' + MIN_BUILD + '）',
    '',
    '实际构建会先跑 tools/build-ios.cjs --check，然后顺序生成 modern + legacy，',
    '再用企业证书签名；成功后 dist 只保留两个签名 IPA。'
  ].join('\n'));
}

function capture(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ cwd: ROOT, encoding: 'utf8' }, opts || {}));
  if (r.error) fail('执行失败：' + cmd + '（' + r.error.message + '）');
  if (r.status !== 0) {
    const out = String((r.stdout || '') + (r.stderr || '')).trim();
    fail(cmd + ' 退出码 ' + r.status + (out ? '：\n' + out : ''));
  }
  return (r.stdout || '').toString();
}

function captureMaybe(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
    if (r.error || r.status !== 0) return '';
    return (r.stdout || '').toString();
  } catch (e) { return ''; }
}

function run(cmd, args, label) {
  console.log('\n> ' + [cmd].concat(args).join(' '));
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.error) fail((label ? label + '：' : '') + '执行失败：' + cmd + '（' + r.error.message + '）');
  if (r.status !== 0) fail((label ? label + '：' : '') + cmd + ' 退出码 ' + r.status);
}

function step(title) { console.log('\n=== ' + title + ' ==='); }

function parseVersion(value) {
  const m = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) fail('版本号格式不对：' + value + '（需要 x.y.z）');
  return m.slice(1).map(Number);
}
function formatVersion(v) { return v.join('.'); }
function cmpVersion(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
function patchVersion(value) {
  const v = parseVersion(value);
  v[2] += 1;
  return formatVersion(v);
}
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function shortHead() {
  const s = captureMaybe('git', ['rev-parse', '--short', 'HEAD']).trim();
  return /^[0-9a-f]{4,}$/i.test(s) ? s : '';
}
function readVersion() {
  const conf = JSON.parse(fs.readFileSync(path.join(TAURI, 'tauri.conf.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(conf.version || '')) fail('tauri.conf.json 里的 version 不是 x.y.z');
  return conf.version;
}
function distIpas() {
  try {
    return fs.readdirSync(DIST).filter((name) => /\.ipa$/i.test(name)).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}
function distVersions() {
  const out = [];
  for (const name of distIpas()) {
    const m = name.match(/^squirrel_fight_(\d+\.\d+\.\d+)_.*\.ipa$/i);
    if (m) out.push(m[1]);
  }
  return out;
}
function ipaBuild(file) {
  const names = captureMaybe('unzip', ['-Z1', file]).split(/\r?\n/).filter(Boolean);
  const entry = names.find((name) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(name));
  if (!entry) return 0;
  const bufR = spawnSync('unzip', ['-p', file, entry], { cwd: ROOT });
  if (bufR.error || bufR.status !== 0 || !bufR.stdout || !bufR.stdout.length) return 0;
  const tmp = path.join(os.tmpdir(), 'ssdz-ios-build-' + process.pid + '-' + Date.now() + '.plist');
  try {
    fs.writeFileSync(tmp, bufR.stdout);
    const json = captureMaybe('plutil', ['-convert', 'json', '-o', '-', tmp]);
    const plist = JSON.parse(json);
    const n = Number(plist.CFBundleVersion);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  } catch (e) {
    return 0;
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch (e) {}
  }
}
function existingBuild() {
  let max = 0, source = '';
  for (const name of distIpas()) {
    const n = ipaBuild(path.join(DIST, name));
    if (n > max) { max = n; source = name; }
  }
  return { max: max, source: source };
}

/** 只替换第一个匹配；匹配不到直接失败，避免版本只改了一半。 */
function replaceFirst(text, regex, value, label) {
  let hit = false;
  const out = text.replace(regex, (m, before, after) => {
    hit = true;
    return before + value + after;
  });
  if (!hit) fail('没找到版本字段：' + label);
  return out;
}
function replaceFirstN(text, regex, n, value, label) {
  let count = 0;
  const out = text.replace(regex, (m, before, after) => {
    count += 1;
    return count <= n ? before + value + after : m;
  });
  if (count < n) fail('没找到足够版本字段：' + label + '（需要 ' + n + ' 处）');
  return out;
}
function replaceMaybe(text, regex, value) {
  return regex.test(text) ? text.replace(regex, (m, before, after) => before + value + after) : text;
}

function versionEdits(target, commit) {
  const date = today();
  return [
    {
      label: 'src-tauri/tauri.conf.json',
      file: path.join(TAURI, 'tauri.conf.json'),
      edit: (s) => replaceFirst(s, /("version"\s*:\s*")[^"]+(")/, target, 'tauri.conf.json'),
    },
    {
      label: 'src-tauri/Cargo.toml',
      file: path.join(TAURI, 'Cargo.toml'),
      edit: (s) => replaceFirst(s, /^(version\s*=\s*")[^"]+(")/m, target, 'Cargo.toml'),
    },
    {
      label: 'src-tauri/Cargo.lock',
      file: path.join(TAURI, 'Cargo.lock'),
      edit: (s) => replaceFirst(s, /(name = "ssdz-classic"\r?\nversion = ")[^"]+(")/, target, 'Cargo.lock'),
    },
    {
      label: 'src-tauri/package.json',
      file: path.join(TAURI, 'package.json'),
      edit: (s) => replaceFirst(s, /("version"\s*:\s*")[^"]+(")/, target, 'package.json'),
    },
    {
      label: 'src-tauri/package-lock.json',
      file: path.join(TAURI, 'package-lock.json'),
      edit: (s) => replaceFirstN(s, /("version"\s*:\s*")[^"]+(")/g, 2, target, 'package-lock.json 根版本'),
    },
    {
      label: 'scripts/version.json',
      file: VERSION_JSON,
      edit: (s) => {
        let out = replaceFirst(s, /("version"\s*:\s*")[^"]+(")/, target, 'scripts/version.json');
        if (commit) out = replaceMaybe(out, /("commit"\s*:\s*")[^"]*(")/, commit);
        out = replaceMaybe(out, /("date"\s*:\s*")[^"]*(")/, date);
        return out;
      },
    },
  ];
}

function applyVersionEdits(target, commit) {
  const backups = new Map();
  try {
    for (const item of versionEdits(target, commit)) {
      if (!fs.existsSync(item.file)) fail('缺少版本文件：' + item.label);
      const before = fs.readFileSync(item.file, 'utf8');
      const after = item.edit(before);
      if (after !== before) {
        backups.set(item.file, before);
        fs.writeFileSync(item.file, after, 'utf8');
      }
      ok(item.label + ' → ' + target);
    }
    return backups;
  } catch (e) {
    restoreBackups(backups);
    throw e;
  }
}
function restoreBackups(backups) {
  for (const [file, text] of backups) {
    try { fs.writeFileSync(file, text, 'utf8'); } catch (e) {}
  }
}

function verifyIpa(file, mode, target, build) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssdz-ios-verify-'));
  try {
    run('unzip', ['-q', file, '-d', tmp], '解包 ' + path.basename(file));
    const payload = path.join(tmp, 'Payload');
    const apps = fs.readdirSync(payload).filter((name) => name.endsWith('.app'));
    if (apps.length !== 1) fail(path.basename(file) + ' 里应当只有一个 .app，实得：' + apps.join('、'));
    const app = path.join(payload, apps[0]);
    const plist = JSON.parse(capture('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Info.plist')]));
    if (!String(plist.CFBundleIdentifier || '').startsWith('jp.co.rakuten-sec.iSPEED.')) {
      fail(path.basename(file) + ' 没改成企业签名的 Bundle ID：' + plist.CFBundleIdentifier);
    }
    if (plist.CFBundleShortVersionString !== target) fail(path.basename(file) + ' 版本不是 ' + target + '：' + plist.CFBundleShortVersionString);
    if (String(plist.CFBundleVersion) !== String(build)) fail(path.basename(file) + ' 构建号不是 ' + build + '：' + plist.CFBundleVersion);
    const hasScene = !!(plist.UIApplicationSceneManifest && typeof plist.UIApplicationSceneManifest === 'object');
    if (mode === 'modern' && !hasScene) fail(path.basename(file) + ' 缺少 UIApplicationSceneManifest（iOS 25–26 modern 包）');
    if (mode === 'legacy' && hasScene) fail(path.basename(file) + ' 不应带 UIApplicationSceneManifest（iOS 16–24 legacy 包）');
    if (!fs.existsSync(path.join(app, 'embedded.mobileprovision'))) fail(path.basename(file) + ' 缺少 embedded.mobileprovision');
    run('codesign', ['--verify', '--deep', '--strict', app], '验签 ' + path.basename(file));
    const signed = capture('codesign', ['-dvv', app]);
    const team = (signed.match(/TeamIdentifier=(\S+)/) || [])[1] || '';
    if (!team || !/Authority=(iPhone Distribution|Apple Development|iPhone Developer)/.test(signed)) {
      fail(path.basename(file) + ' 签名身份不对：\n' + signed.trim());
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  }
}

function cleanupOtherIpas(keep) {
  const kept = new Set(keep.map((p) => path.resolve(p)));
  const removed = [];
  for (const name of distIpas()) {
    const file = path.resolve(DIST, name);
    if (kept.has(file)) continue;
    fs.rmSync(file, { force: true });
    removed.push(name);
  }
  return removed;
}

function plan() {
  const current = readVersion();
  const versions = distVersions();
  let base = current;
  for (const v of versions) if (cmpVersion(v, base) > 0) base = v;

  let target;
  if (OPTS.version) target = OPTS.version;
  else if (OPTS.noBump) target = base;
  else target = patchVersion(base);
  if (cmpVersion(target, base) < 0) fail('目标版本 ' + target + ' 低于当前/已有版本 ' + base);

  const prev = existingBuild();
  let build = Math.max(prev.max + 1, MIN_BUILD);
  if (OPTS.build) {
    if (OPTS.build < prev.max + 1) fail('--build ' + OPTS.build + ' 不大于现有最大构建号 ' + prev.max);
    if (OPTS.build < MIN_BUILD) fail('--build 不能低于 ' + MIN_BUILD + '（本机旧 dist 最高 109）');
    build = OPTS.build;
  }

  const modernUnsigned = path.join(DIST, 'squirrel_fight_' + target + '_ios_unsigned.ipa');
  const modernSigned = path.join(DIST, 'squirrel_fight_' + target + '_ios_signed.ipa');
  const legacyUnsigned = path.join(DIST, 'squirrel_fight_' + target + '_ios_legacy_unsigned.ipa');
  const legacySigned = path.join(DIST, 'squirrel_fight_' + target + '_ios_legacy_signed.ipa');
  return { current: current, base: base, target: target, build: build, prev: prev,
    modernUnsigned, modernSigned, legacyUnsigned, legacySigned };
}

function main() {
  parseArgs();
  if (OPTS.help) { usage(); return; }
  if (process.platform !== 'darwin') fail('iOS 打包与签名只能在 macOS 上跑。');

  const p = plan();
  console.log('松鼠大战 · iOS 一键打包');
  console.log('  当前版本：' + p.current + (p.base !== p.current ? '（dist 最高 ' + p.base + '）' : ''));
  console.log('  目标版本：' + p.target);
  console.log('  构建号：  ' + p.build + (p.prev.max ? '（dist 最大 ' + p.prev.max + '：' + p.prev.source + ' +1）' : '（最低 ' + MIN_BUILD + '）'));
  console.log('  产物：');
  console.log('    ' + p.modernSigned + '  → iOS 25–26（UIScene）');
  console.log('    ' + p.legacySigned + '  → iOS 16–24（legacy）');
  console.log('  成功后删除 dist 里除这两个文件外的所有 .ipa。');
  if (OPTS.dryRun) {
    console.log('\n[dry-run] 不写版本文件、不构建、不删除任何文件。');
    return;
  }
  if (distIpas().length) info('现有 IPA 会保留到新包构建/签名成功之后。');

  step('环境检查');
  run(process.execPath, [path.join(ROOT, 'tools', 'build-ios.cjs'), '--check'], 'iOS 工具链检查');

  const commit = shortHead();
  const backups = applyVersionEdits(p.target, commit);
  const preexisting = new Set(distIpas().map((name) => path.resolve(DIST, name)));
  const expected = [p.modernUnsigned, p.modernSigned, p.legacyUnsigned, p.legacySigned].map((x) => path.resolve(x));
  const removeNew = () => {
    for (const file of expected) {
      if (preexisting.has(file)) continue;
      try { fs.rmSync(file, { force: true }); } catch (e) {}
    }
  };

  let cleanupStarted = false;
  try {
    step('构建 iOS 25–26（modern / UIScene）');
    run(process.execPath, [path.join(ROOT, 'tools', 'build-ios.cjs'), '--clean', '--build', String(p.build)], 'modern iOS 构建');
    step('构建 iOS 16–24（legacy / 传统生命周期）');
    run(process.execPath, [path.join(ROOT, 'tools', 'build-ios.cjs'), '--legacy', '--clean', '--build', String(p.build)], 'legacy iOS 构建');

    for (const [file, label] of [[p.modernUnsigned, 'modern 未签名 IPA'], [p.legacyUnsigned, 'legacy 未签名 IPA']]) {
      if (!fs.existsSync(file)) fail('构建后找不到' + label + '：' + file);
      ok(label + '：' + path.basename(file));
    }

    step('企业签名');
    run(process.execPath, [path.join(ROOT, 'tools', 'sign-ios.cjs'), '--input', p.modernUnsigned, '--output', p.modernSigned], 'modern 签名');
    run(process.execPath, [path.join(ROOT, 'tools', 'sign-ios.cjs'), '--input', p.legacyUnsigned, '--output', p.legacySigned], 'legacy 签名');

    step('校验两个签名包');
    verifyIpa(p.modernSigned, 'modern', p.target, p.build);
    verifyIpa(p.legacySigned, 'legacy', p.target, p.build);
    ok('版本 ' + p.target + ' / 构建号 ' + p.build + ' / 企业签名身份 / UIScene 与 legacy 均已核对');

    step('清理 dist 里的其它 IPA');
    cleanupStarted = true;
    const removed = cleanupOtherIpas([p.modernSigned, p.legacySigned]);
    for (const name of removed) console.log('  删除 ' + name);
    ok('已删除 ' + removed.length + ' 个旧包 / 中间包');

    const finals = distIpas();
    if (finals.length !== 2) fail('dist 里应当只剩两个 IPA，实际：' + finals.join('、'));
    console.log('\n完成：');
    for (const file of [p.modernSigned, p.legacySigned]) {
      const size = (fs.statSync(file).size / 1048576).toFixed(1) + ' MB';
      console.log('  ' + path.basename(file) + '（' + size + '）');
    }
    console.log('  dist 只保留以上两个签名 IPA。');
  } catch (e) {
    if (!cleanupStarted) {
      restoreBackups(backups);
      removeNew();
    }
    throw e;
  }
}

try {
  main();
} catch (e) {
  console.error('\n[x] ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
}
