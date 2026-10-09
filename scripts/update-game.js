#!/usr/bin/env node
/* ============================================================
 * scripts/update-game.js — 「一键拉取远端更新」的执行体（零依赖）
 *
 * 只做三件事，全部走**固定动作**（不接受客户端传命令）：
 *   · git     —— 本机是 git 工作区：`git fetch` + `git pull --ff-only`
 *   · release —— 从 GitHub Releases 下载对应平台的便携包 zip，解压后**覆盖**游戏目录
 *   · check   —— 只报告：本机版本 / git 落后几个提交 / Releases 最新是哪个 tag
 *
 * 用法（给服务器 / 壳调用，参数都是服务端白名单校验过的）：
 *   node scripts/update-game.js --check --json
 *   node scripts/update-game.js --mode=git|release|auto [--dry] [--json] [--asset=名字] [--root=目录]
 *
 * 约定：**人类可读的日志走 stderr，stdout 最后一行是唯一一行 JSON** ——
 * 这样 serve.js / 轻壳只要把 stdout 原样回给前端就行。
 *
 * 安全性（谁在改文件谁负责）：
 *   · 永远不动 `save/`（存档有自己的通道），更新前还会先备份一份 progress.json；
 *   · 永远不动 `scripts/sync/sync.config.json`（每台机器的名字 / 对端 / 口令都不同）；
 *   · 只覆盖、不删除 —— 新版删掉的文件会以「多余文件」留在本机，不影响运行；
 *   · 解压用系统自带的 tar / unzip / python，不引入任何第三方依赖；
 *   · 网络先用 Node 的 https，失败（杀软/公司代理注入证书时 Node 会报
 *     unable to verify the first certificate）就退回系统 curl —— 它用系统信任库。
 * ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'Charlespkuer/UC_Squirrel_Fight_remake';
const RELEASES_PAGE = 'https://github.com/' + REPO + '/releases/latest';

/** 更新时**绝不覆盖**的东西：存档、机器相关配置、本地取证 / 构建产物。 */
const IGNORE = [
  'save/', '.git/', 'references/', 'out/', 'node_modules/', 'dist/', 'build/', '_site/',
  '.cache/', '.vscode/', 'src-tauri/target/', 'src-tauri/dist/', 'src-tauri/web/',
  'src-tauri/icons/', 'src-tauri/gen/', 'src-tauri/node_modules/',
  'scripts/sync/sync.config.json', 'scripts/sync/.cache.json',
];
const IGNORE_NAMES = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];
const IGNORE_EXT = ['.log', '.tmp', '.swp'];

// ---------------------------------------------------------------- 小工具

const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const norm = (p) => p.split(path.sep).join('/');
const relOf = (root, abs) => norm(path.relative(root, abs));

function ignored(rel) {
  const r = rel.endsWith('/') ? rel : rel + '';
  for (const ig of IGNORE) if (r === ig.slice(0, -1) || r.startsWith(ig)) return true;
  const base = path.basename(r);
  if (IGNORE_NAMES.includes(base)) return true;
  if (IGNORE_EXT.some((e) => base.endsWith(e))) return true;
  return false;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

/** 本机版本：优先 version.json（发布包 / CI 写的），退回 git 短哈希，再退回「未知」。 */
function readVersion(root) {
  const v = readJson(path.join(root, 'version.json'));
  if (v && v.version) return { version: String(v.version), commit: String(v.commit || ''), date: String(v.date || '') };
  const g = git(root, ['rev-parse', '--short', 'HEAD']);
  if (g.ok) return { version: 'dev-' + g.out.trim(), commit: g.out.trim(), date: '' };
  return { version: '未知', commit: '', date: '' };
}

function git(root, args) {
  try {
    const out = execFileSync('git', ['-C', root].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });
    return { ok: true, out: String(out) };
  } catch (e) {
    return { ok: false, out: String((e && e.stdout) || ''), err: String((e && e.stderr) || (e && e.message) || e) };
  }
}

/** git 工作区信息（不是仓库 / 没有 git 都算 ok:false，交给上层换别的来源）。 */
function gitInfo(root) {
  const inside = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.out.trim() !== 'true') return { isRepo: false };
  const head = git(root, ['rev-parse', '--short', 'HEAD']);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = git(root, ['status', '--porcelain']);
  const up = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return {
    isRepo: true,
    head: head.ok ? head.out.trim() : '',
    branch: branch.ok ? branch.out.trim() : '',
    dirty: dirty.ok ? dirty.out.trim().length > 0 : false,
    upstream: up.ok ? up.out.trim() : '',
  };
}

/** 和上游比：落后几个提交、远端最新那一条是什么（不写工作区，只 fetch）。 */
function gitCheck(root, info) {
  if (!info || !info.isRepo) return { ok: false, code: 'NOT_A_REPO', msg: '本机不是 git 工作区' };
  if (!info.upstream) return { ok: true, behind: 0, ahead: 0, msg: '本机 git 仓库没有配置上游分支', remoteSubject: '' };
  const f = git(root, ['fetch', '--quiet', '--no-tags', 'origin']);
  if (!f.ok) return { ok: false, code: 'FETCH_FAILED', msg: '连不上远端仓库：' + (f.err || '').trim().slice(0, 200) };
  const cnt = git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  let behind = 0, ahead = 0;
  if (cnt.ok) { const [a, b] = cnt.out.trim().split(/\s+/).map(Number); ahead = a || 0; behind = b || 0; }
  const subj = git(root, ['log', '-1', '--format=%h %s', '@{u}']);
  return { ok: true, behind, ahead, remoteSubject: subj.ok ? subj.out.trim() : '', localSubject: (git(root, ['log', '-1', '--format=%h %s']).out || '').trim() };
}

function gitPull(root, info) {
  if (!info || !info.isRepo) return { ok: false, code: 'NOT_A_REPO', msg: '本机不是 git 工作区' };
  if (info.dirty) log('提示：工作区有未提交改动，--ff-only 可能失败（更新不会覆盖你的改动）');
  const before = readVersion(root);
  const r = git(root, ['pull', '--ff-only']);
  const after = readVersion(root);
  if (!r.ok) return { ok: false, code: 'PULL_FAILED', msg: (r.err || r.out || 'git pull 失败').trim().slice(0, 400), before, after };
  const changed = (r.out || '').split('\n').filter((l) => /^\s*\S+\s+\|\s+\d+/.test(l)).length;
  return { ok: true, msg: (r.out || '').trim().split('\n').slice(-1)[0] || '已是最新', before, after, changed };
}

// ---------------------------------------------------------------- GitHub Releases

function httpsGet(url, headers, onData) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: Object.assign({ 'user-agent': 'ssdz-update', accept: 'application/vnd.github+json' }, headers || {}) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpsGet(new URL(res.headers.location, url).toString(), headers, onData));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + '：' + url)); }
      resolve(onData ? onData(res) : res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('连接超时')));
  });
}

function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

/** 系统 curl 兜底：某些机器上 Node 的 https 会被杀软/公司代理注入的证书挡下，
 *  curl 走系统信任库，通常能过。只用固定参数，URL 只来自代码里的白名单。 */
function curlJson(url) {
  try {
    const out = execFileSync('curl', ['-fsSL', '--max-time', '60', url],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, body: String(out) };
  } catch (e) { return { ok: false, msg: String((e && e.message) || e).slice(0, 200) }; }
}

async function getJson(url) {
  try { return { ok: true, body: await readBody(await httpsGet(url)) }; }
  catch (e) {
    log('Node 直连失败（' + e.message + '），改用系统 curl 再试…');
    const c = curlJson(url);
    if (c.ok) return c;
    return { ok: false, msg: '连不上 GitHub（Node：' + e.message + '；curl：' + c.msg + '）' };
  }
}

/** 同一个平台可能有多个 zip，取文件名最大的那个（tag 命名单调递增）。 */
function pickAsset(assets, platform) {
  const want = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : '';
  const pick = (list) => (list.length ? list.slice().sort((a, b) => String(b.name).localeCompare(String(a.name)))[0] : null);
  return (want && pick(assets.filter((a) => a.name.includes('squirrel-web-' + want)))) ||
    pick(assets.filter((a) => a.name.includes('squirrel-web'))) || pick(assets);
}

const INSTALLER_RE = /\.(exe|msi|dmg|pkg|apk)$/i;

/** 这个 Release 里给当前平台用哪个文件：便携 zip 优先（能就地覆盖），否则退回安装包。 */
function assetFor(assets, platform) {
  const list = assets || [];
  const zip = pickAsset(list.filter((a) => /\.zip$/i.test(a.name || '') && /squirrel-web/i.test(a.name || '')), platform);
  if (zip) return { kind: 'zip', asset: zip };
  if (platform === 'win32') {
    const a = list.find((x) => /setup\.exe$/i.test(x.name)) || list.find((x) => /\.(exe|msi)$/i.test(x.name));
    if (a) return { kind: 'installer', asset: a };
  }
  if (platform === 'darwin') { const a = list.find((x) => /\.(dmg|pkg)$/i.test(x.name)); if (a) return { kind: 'installer', asset: a }; }
  if (platform === 'android') { const a = list.find((x) => /\.apk$/i.test(x.name)); if (a) return { kind: 'apk', asset: a }; }
  /* 故意**不做**「随便什么安装包都算」的兜底：macOS 上给一个安卓 apk 毫无意义，
   * 返回 null 让界面去做「打开下载页」这件事更诚实。 */
  return null;
}

/** 从最新往回找**第一个真有可用文件**的 Release ——
 *  releases/latest 常常是桌面安装包那次（0.4.x），便携 zip 在别的 tag 上。 */
async function listReleases(repo, platform, limit) {
  const url = 'https://api.github.com/repos/' + (repo || REPO) + '/releases?per_page=' + Math.max(1, Math.min(30, limit || 10));
  const r = await getJson(url);
  if (!r.ok) return { ok: false, code: 'NETWORK', msg: '连不上 GitHub（网络 / 代理问题）：' + r.msg };
  let data = null;
  try { data = JSON.parse(r.body); } catch (e) { return { ok: false, code: 'BAD_JSON', msg: 'GitHub 返回的不是 JSON（可能被限流）：' + String(r.body).slice(0, 120) }; }
  if (!Array.isArray(data)) return { ok: false, code: 'NO_RELEASE', msg: (data && data.message) || '没有找到 Release' };
  if (!data.length) return { ok: false, code: 'NO_RELEASE', msg: '这个仓库还没有 Release' };
  for (const rel of data) {
    const choice = assetFor(rel.assets, platform);
    if (choice) {
      return {
        ok: true, tag: String(rel.tag_name), name: String(rel.name || ''), publishedAt: String(rel.published_at || ''),
        page: rel.html_url || RELEASES_PAGE, kind: choice.kind,
        asset: { name: choice.asset.name, size: Number(choice.asset.size) || 0, url: choice.asset.browser_download_url },
        skipped: data.filter((x) => x !== rel).slice(0, 3).map((x) => x.tag_name),
      };
    }
  }
  const top = data[0];
  return { ok: false, code: 'NO_ASSET', msg: '最近几个 Release 里都没有适合本机的文件（' + data.slice(0, 3).map((x) => x.tag_name).join('、') + '）', page: top.html_url || RELEASES_PAGE, tag: String(top.tag_name) };
}

async function fetchLatestRelease(repo, platform) {
  const r = await listReleases(repo, platform || process.platform, 10);
  if (!r.ok && r.tag) return r;
  return r;
}

function curlDownload(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    execFileSync('curl', ['-fsSL', '--max-time', '1800', '-o', dest, url],
      { timeout: 1800000, stdio: ['ignore', 'ignore', 'pipe'] });
    return { ok: true, bytes: fs.statSync(dest).size };
  } catch (e) { return { ok: false, msg: String((e && e.message) || e).slice(0, 200) }; }
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    httpsGet(url, { accept: 'application/octet-stream' }, (res) => {
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => { got += c.length; if (onProgress) onProgress(got, total); });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve({ bytes: got, total, ms: Date.now() - started })));
      out.on('error', reject);
      res.on('error', reject);
    }).catch(reject);
  });
}

/** 用系统默认方式打开一个**我们刚下载下来**的安装包（路径由本文件拼出，不接受外部传参）。 */
function openFile(file) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/C', 'start', '', file] : [file];
  try {
    const { spawn } = require('child_process');
    const c = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    c.unref();
    return true;
  } catch (e) { return false; }
}

/** 解压：系统自带工具逐个试（Windows 10+ 的 tar.exe / macOS 的 bsdtar / Linux 的 unzip / python）。 */
function extract(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const tries = [
    ['tar', ['-xf', zip, '-C', dest]],
    ['unzip', ['-q', '-o', zip, '-d', dest]],
    ['python3', ['-m', 'zipfile', '-e', zip, dest]],
    ['python', ['-m', 'zipfile', '-e', zip, dest]],
  ];
  if (process.platform === 'win32') {
    tries.push(['powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath ' + JSON.stringify(zip) + ' -DestinationPath ' + JSON.stringify(dest) + ' -Force']]);
  }
  const errs = [];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 300000 });
    if (r.error && r.error.code === 'ENOENT') { errs.push(cmd + '：没装'); continue; }
    if (r.status === 0) return { ok: true, by: cmd };
    errs.push(cmd + '：' + String(r.stderr || r.error || ('exit ' + r.status)).trim().slice(0, 160));
  }
  return { ok: false, code: 'EXTRACT_FAILED', msg: '解压失败（需要系统自带 tar / unzip / python 之一）：' + errs.join('；') };
}

/** 解压出来的东西通常多一层目录（squirrel-web-mac-1.2.3/），找到真正含 index.html 的那层。 */
function findPackageRoot(dir) {
  const probe = (d) => fs.existsSync(path.join(d, 'scripts', 'index.html')) || (fs.existsSync(path.join(d, 'js')) && fs.existsSync(path.join(d, 'css')));
  if (probe(dir)) return dir;
  for (const name of fs.readdirSync(dir)) {
    const sub = path.join(dir, name);
    try { if (fs.statSync(sub).isDirectory() && probe(sub)) return sub; } catch (e) {}
  }
  return null;
}

/** 计划：把「解压出来的包目录」里要覆盖的文件列出来（相对**包目录**算路径，跳过 IGNORE）。
 *  返回的 p 是包内相对路径，applyFiles 会拿它拼目标目录 —— 别拿目标目录来算 relative，
 *  那样会得到 ../.. 这种越界路径（这个坑被用例抓过一次）。 */
function planTree(srcDir) {
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = relOf(srcDir, abs);
      if (ignored(rel)) continue;
      let st;
      try { st = fs.lstatSync(abs); } catch (e) { continue; }
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) files.push({ p: rel, size: st.size });
    }
  };
  walk(srcDir);
  return files;
}

function applyFiles(root, srcDir, files, dry) {
  let n = 0, bytes = 0;
  for (const f of files) {
    if (!dry) {
      const dst = path.join(root, f.p);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(srcDir, f.p), dst);
    }
    n++; bytes += f.size;
  }
  return { files: n, bytes };
}

/** 更新前把存档备份一份（save/backup/ 与服务器的备份接口同一命名习惯）。 */
function backupSave(root) {
  const src = path.join(root, 'save', 'progress.json');
  if (!fs.existsSync(src)) return null;
  const d = new Date();
  const p2 = (x) => String(x).padStart(2, '0');
  const stamp = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const dst = path.join(root, 'save', 'backup', 'progress-' + stamp + '-before-update.json');
  try { fs.mkdirSync(path.dirname(dst), { recursive: true }); if (!fs.existsSync(dst)) fs.copyFileSync(src, dst); return relOf(root, dst); }
  catch (e) { return null; }
}

// ---------------------------------------------------------------- 三个入口

async function check(root, repo, platform) {
  const local = readVersion(root);
  const info = gitInfo(root);
  const gitRes = info.isRepo ? gitCheck(root, info) : { ok: false, code: 'NOT_A_REPO', msg: '本机不是 git 工作区' };
  const rel = await fetchLatestRelease(repo, (arguments[2] || process.platform));
  return {
    ok: true, root, local, git: Object.assign({}, info, gitRes),
    release: rel.ok
      ? { ok: true, tag: rel.tag, kind: rel.kind, page: rel.page, asset: rel.asset }
      : { ok: false, code: rel.code, msg: rel.msg, page: rel.page, tag: rel.tag, kind: rel.kind },
  };
}

async function updateRelease(root, opts) {
  const local = readVersion(root);
  const rel = await fetchLatestRelease(opts.repo, opts.platform || process.platform);
  if (!rel.ok) return rel;
  if (opts.asset && !(rel.assets || []).some((a) => a.name === opts.asset)) {
    return { ok: false, code: 'NO_ASSET', msg: '这个 Release 里没有 ' + opts.asset };
  }
  const asset = opts.asset ? Object.assign({}, rel.asset, { name: opts.asset }) : rel.asset;
  if (!asset) return { ok: false, code: 'NO_ASSET', msg: '这个 Release 里没有可用的文件', page: rel.page };
  const kind = rel.kind || 'zip';
  log('最新 Release：' + rel.tag + '　' + (kind === 'zip' ? '便携包' : '安装包') + '：' + asset.name +
    '（' + (asset.size > 1048576 ? (asset.size / 1048576).toFixed(1) + ' MB' : Math.round(asset.size / 1024) + ' KB') + '）');
  if (opts.dry) {
    return { ok: true, mode: 'release', dry: true, tag: rel.tag, kind, asset: { name: asset.name, size: asset.size },
      page: rel.page, local, files: null, bytes: asset.size };
  }

  /* 安装包（Windows setup.exe / macOS dmg / 安卓 apk）：**不就地覆盖**，下载到 save/updates/
   * 然后交给系统去开安装向导 —— 这是安装版客户端唯一正确的更新方式。 */
  if (kind !== 'zip') {
    const dest = path.join(root, 'save', 'updates', asset.name);
    let got2;
    try { got2 = await download(asset.url, dest, null); }
    catch (e) {
      log('Node 下载失败（' + e.message + '），改用系统 curl…');
      got2 = curlDownload(asset.url, dest);
      if (!got2.ok) return { ok: false, code: 'DOWNLOAD_FAILED', msg: '下载失败：' + got2.msg, page: rel.page };
    }
    const opened = openFile(dest);
    return {
      ok: true, mode: 'release', dry: false, tag: rel.tag, kind, page: rel.page,
      asset: { name: asset.name, size: asset.size }, downloaded: got2.bytes, path: relOf(root, dest),
      opened, requireInstall: true, msg: opened ? '已下载并打开安装包（约 ' + Math.round(got2.bytes / 1048576) + ' MB）' : '已下载安装包到 ' + relOf(root, dest),
    };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssdz-update-'));
  const zip = path.join(tmp, 'update.zip');
  log('下载到 ' + zip);
  let got;
  try { got = await download(asset.url, zip, (a, t) => { if (t && a === t) log('  已下载 ' + Math.round(a / 1024) + ' KB'); }); }
  catch (e) {
    log('Node 下载失败（' + e.message + '），改用系统 curl…');
    got = curlDownload(asset.url, zip);
    if (!got.ok) return { ok: false, code: 'DOWNLOAD_FAILED', msg: '下载失败：' + got.msg, page: rel.page };
  }
  const ex = extract(zip, path.join(tmp, 'new'));
  if (!ex.ok) return ex;
  const src = findPackageRoot(path.join(tmp, 'new'));
  if (!src) return { ok: false, code: 'BAD_PACKAGE', msg: '这个 zip 里没有找到游戏目录（缺 index.html / js / css）', page: rel.page };
  const files = planTree(src);
  if (!files.length) return { ok: false, code: 'EMPTY_PLAN', msg: '没有需要覆盖的文件（包结构可能变了）', page: rel.page };
  const backup = opts.dry ? null : backupSave(root);
  const r = applyFiles(root, src, files, !!opts.dry);
  const notice = path.join(root, 'save', 'last-update.json');
  if (!opts.dry) {
    try {
      fs.mkdirSync(path.dirname(notice), { recursive: true });
      fs.writeFileSync(notice, JSON.stringify({ at: Date.now(), mode: 'release', tag: rel.tag, files: r.files, bytes: r.bytes, backup: backup }, null, 2));
    } catch (e) {}
  }
  return { ok: true, mode: 'release', dry: !!opts.dry, tag: rel.tag, page: rel.page, files: r.files, bytes: r.bytes, downloaded: got.bytes, backup, local, requireReload: true };
}

async function run(opts) {
  const root = path.resolve(opts.root || ROOT);
  const info = gitInfo(root);
  const mode = opts.mode && opts.mode !== 'auto' ? opts.mode : (info.isRepo ? 'git' : 'release');
  if (mode === 'check') return check(root, opts.repo, opts.platform);
  if (mode === 'git') {
    if (opts.dry) {
      const c = gitCheck(root, info);
      if (!c.ok) return c;
      const local = readVersion(root);
      return { ok: true, mode: 'git', dry: true, behind: c.behind, ahead: c.ahead, remoteSubject: c.remoteSubject, local, files: c.behind };
    }
    const r = gitPull(root, info);
    return Object.assign({ mode: 'git' }, r);
  }
  if (mode === 'release') return updateRelease(root, opts);
  return { ok: false, code: 'BAD_MODE', msg: '不认识的更新方式：' + mode };
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const o = { mode: 'auto', dry: false, json: false, root: ROOT, repo: REPO, asset: '', platform: process.platform };
  for (const a of argv) {
    if (a === '--dry') o.dry = true;
    else if (a === '--json') o.json = true;
    else if (a === '--check') o.mode = 'check';
    else if (a.startsWith('--mode=')) o.mode = a.slice(7);
    else if (a.startsWith('--root=')) o.root = a.slice(7);
    else if (a.startsWith('--repo=')) o.repo = a.slice(7);
    else if (a.startsWith('--asset=')) o.asset = a.slice(8);
    else if (a.startsWith('--platform=')) o.platform = a.slice(11);
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let res;
  try { res = await run(opts); }
  catch (e) { res = { ok: false, code: 'ERROR', msg: String((e && e.message) || e) }; }
  if (!res.mode) res.mode = opts.mode;
  res.dry = !!opts.dry && res.dry !== false;
  log(res.ok ? '[√] ' + (res.msg || ('完成：' + res.mode + (res.tag ? ' ' + res.tag : ''))) : '[×] ' + (res.msg || res.code));
  process.stdout.write(JSON.stringify(res) + '\n');
  process.exit(res.ok ? 0 : 1);
}

module.exports = {
  ROOT, REPO, RELEASES_PAGE, IGNORE, ignored, readVersion, gitInfo, gitCheck, gitPull,
  fetchLatestRelease, listReleases, assetFor, pickAsset, planTree, applyFiles, backupSave, extract, findPackageRoot, openFile, curlDownload,
  run, check, updateRelease,
};

if (require.main === module) main();
