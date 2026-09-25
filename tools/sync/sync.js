#!/usr/bin/env node
/* ============================================================
 * tools/sync/sync.js —— 双机同步（存档 + 游戏文件），零依赖
 *
 * 用途：Mac 与 Windows 常年用 ZeroTier 连在同一个虚拟局域网里，
 *       这个脚本让两边「一键」互相送存档、以及把本机改过的文件推给对方。
 *
 * 两条通道：
 *   · 存档通道：save/progress.json（整体 JSON，推送/拉取前都会先备份）
 *   · 文件通道：游戏目录里改动过的文件（默认按 修改时间 + 大小 比对，--verify 用 sha1；
 *     跳过 save/、.git/、node_modules/、构建产物等，见 DEFAULT_IGNORE）
 *
 * 角色：
 *   serve   = 接收端（一台机器开着，另一台才能推/拉）；监听 0.0.0.0:<port>
 *   push    = 把本机的东西发给对端
 *   pull    = 把对端的东西取到本机
 *
 * 命令：
 *   node tools/sync/sync.js init                     生成配置 + 显示本机 ZeroTier 地址
 *   node tools/sync/sync.js serve [--port N]         前台跑接收服务
 *   node tools/sync/sync.js start | stop | restart   后台接收服务（PID 在 save/.sync.pid）
 *   node tools/sync/sync.js status [peer]            本机和对端的状态
 *   node tools/sync/sync.js discover                 扫描 ZeroTier 网段找对端
 *   node tools/sync/sync.js push [peer] [选项]       本机 → 对端
 *   node tools/sync/sync.js pull [peer] [选项]       对端 → 本机
 *   node tools/sync/sync.js watch [peer] [选项]      盯着本地改动，自动推给对端
 *   node tools/sync/sync.js token [值]               查看 / 设置同步口令
 *   node tools/sync/sync.js autostart install|remove|status   开机自启
 *
 * 选项：--save 只同步存档 / --files 只同步文件 / --all 两者（默认两者）
 *       --force 存档比对方旧也覆盖 / --dry 只列计划 / --verify 文件用 sha1 精确比对
 *       --peer <名字或IP> / --interval <秒>（watch）
 *
 * 安全：接收端只在 <游戏目录> 里读写，路径必须是一段段普通目录（挡掉 ../、盘符），
 *       忽略清单里的东西永远不传；/api/* 需要 x-ssdz-token 与配置里的口令一致；
 *       /local/* 只允许本机（127.0.0.1）调用，且带 Origin 时必须是 127.0.0.1/localhost。
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

// ---------------------------------------------------------------- 常量与路径

const TOOL_DIR = __dirname;
const ROOT = path.resolve(TOOL_DIR, '..', '..');          // 游戏目录（有 index.html 的那层）
const SAVE_DIR = path.join(ROOT, 'save');
const SAVE_FILE = path.join(SAVE_DIR, 'progress.json');
const BACKUP_DIR = path.join(SAVE_DIR, 'backup');
const CONFIG_FILE = path.join(TOOL_DIR, 'sync.config.json');
const PID_FILE = path.join(SAVE_DIR, '.sync.pid');
const OUT_LOG = path.join(SAVE_DIR, 'sync.out.log');
const ERR_LOG = path.join(SAVE_DIR, 'sync.err.log');

const APP_TAG = 'ssdz-sync';
const APP_VERSION = 1;
const SAVE_MAX = 4 * 1024 * 1024;                          // 与 serve.js 一致
const DEFAULT_PORT = 8788;
const BACKUP_KEEP = 10;
const FW_RULE_NAME = 'SSDZ Sync';        // Windows 入站放行规则的名字（自检/一键放行都用它）

/* 文件通道的忽略清单：
 *   · 以 / 结尾 = 相对游戏目录的前缀（目录）
 *   · 含 *      = 通配（匹配相对路径或文件名）
 *   · 其它      = 任意一层目录/文件名等于它
 *   · 以 ! 开头 = 例外（即使前面被忽略也同步），例如 !tools/sync/keep.me */
const DEFAULT_IGNORE = [
  'save/', 'node_modules/', 'src-tauri/target/', 'src-tauri/dist/', 'dist/', 'build/',
  '.git/', '.cache/', 'tools/sync/sync.config.json', 'tools/sync/.cache.json',
  '.DS_Store', 'Thumbs.db', 'desktop.ini', '._*',
  '*.log', '*.tmp', '*.swp', '*~',
];

// ---------------------------------------------------------------- 小工具

const log = (...a) => console.log(...a);
const warn = (...a) => console.log(...a);
function die(msg, code) { console.error(msg); process.exit(code == null ? 1 : code); }
function nowStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(Number(ms)), p = (n) => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
const tty = () => !!process.stdout.isTTY;
const cyan = (s) => (tty() ? '\x1b[36m' + s + '\x1b[0m' : s);
const green = (s) => (tty() ? '\x1b[32m' + s + '\x1b[0m' : s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 配置

let config = null;
let configMtime = -1;      // 配置文件上次读进来时的 mtime：改了文件不用重启服务也能生效

function defaultConfig() {
  return {
    name: os.hostname().replace(/\.local$/i, '') || 'this-pc',
    port: DEFAULT_PORT,
    token: crypto.randomBytes(16).toString('hex'),
    peers: {},          // { "win": "10.32.170.20" }
    ignore: [],         // 额外忽略项（在 DEFAULT_IGNORE 之后生效）
  };
}
/** 口令指纹：只暴露 6 位，用来判断两台机器的 token 是不是一样，又不至于把口令本身写进日志。 */
function tokenId(t) { return crypto.createHash('sha1').update(String(t == null ? '' : t)).digest('hex').slice(0, 6); }
/**
 * 读配置。**每次都会 stat 一下文件**：改了 tools/sync/sync.config.json（最常见的是改 token）
 * 之后不用重启同步服务，下一次请求就用新口令 —— 以前这里是无条件缓存，
 * 于是出现「两边 token 明明改成一样了，还是报口令不对」，其实是服务进程还拿着启动时的旧口令。
 */
function loadConfig() {
  let st = null;
  try { st = fs.statSync(CONFIG_FILE); } catch (e) { st = null; }
  const mtime = st ? st.mtimeMs : 0;
  if (config && mtime === configMtime) return config;
  if (!st && config) return config;                    // 文件暂时读不到，先用手里的
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { raw = null; }
  if (!raw || typeof raw !== 'object') {
    if (config) return config;                         // 文件写坏了也别把内存里的好配置冲掉
    raw = defaultConfig();
  }
  const cfg = Object.assign(defaultConfig(), raw);
  cfg.port = Number(cfg.port) || DEFAULT_PORT;
  cfg.token = String(cfg.token || '');
  cfg.peers = (cfg.peers && typeof cfg.peers === 'object') ? cfg.peers : {};
  cfg.ignore = Array.isArray(cfg.ignore) ? cfg.ignore : [];
  config = cfg;
  configMtime = mtime;
  return cfg;
}
function saveConfig() {
  fs.mkdirSync(TOOL_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
  try { configMtime = fs.statSync(CONFIG_FILE).mtimeMs; } catch (e) { configMtime = -1; }
}
/** 没有配置文件就生成一份（含随机口令）。 */
function ensureConfig() {
  const existed = fs.existsSync(CONFIG_FILE);
  loadConfig();
  if (!existed) saveConfig();
  return config;
}

// ---------------------------------------------------------------- 忽略规则

function ruleMatcher(rule) {
  if (rule.endsWith('/')) { const p = rule.slice(0, -1); return (rel) => rel === p || rel.startsWith(p + '/'); }
  if (rule.includes('*')) {
    const rx = new RegExp('^' + rule.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return (rel, base) => rx.test(rel) || rx.test(base);
  }
  // 带 / 的写死路径（例：tools/sync/sync.config.json）按相对路径匹配，也当目录前缀
  if (rule.includes('/')) return (rel) => rel === rule || rel.startsWith(rule + '/');
  return (rel, base, segs) => base === rule || segs.includes(rule);
}
let _matchers = null;
function ignored(rel) {
  if (!_matchers) {
    const rules = DEFAULT_IGNORE.concat(loadConfig().ignore || []);
    _matchers = rules.map((r) => ({ neg: r.startsWith('!'), m: ruleMatcher(r.startsWith('!') ? r.slice(1) : r) }));
  }
  const segs = rel.split('/');
  const base = segs[segs.length - 1];
  let hit = false;
  for (const r of _matchers) if (r.m(rel, base, segs)) hit = !r.neg;
  return hit;
}

// ---------------------------------------------------------------- 文件清单

/** 遍历游戏目录，返回 [{p, s, m}]（相对路径用 / 分隔；m 是修改时间毫秒）。
 *  判定「内容是否变了」时给 1 秒的宽容（不同文件系统的时间精度不一样），
 *  但判定「哪边更新」用原始毫秒，这样同一秒内改完就同步也能走对方向。 */
function walk(root, withHash, sub, out) {
  out = out || [];
  sub = sub || '';
  let entries;
  try { entries = fs.readdirSync(path.join(root, sub), { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const rel = sub ? sub + '/' + e.name : e.name;
    if (ignored(rel)) continue;
    if (e.isDirectory()) { walk(root, withHash, rel, out); continue; }
    let st;
    try { st = fs.statSync(path.join(root, rel)); } catch (err) { continue; }
    if (!st.isFile()) continue;
    const item = { p: rel, s: st.size, m: Math.round(st.mtimeMs) };
    if (withHash) { try { item.h = sha1File(path.join(root, rel)); } catch (err) {} }
    out.push(item);
  }
  return out;
}
function manifestMap(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.p, e);
  return m;
}
function sha1File(abs) {
  return crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
}
/** 内容是否不同：大小不同 = 不同；都用 sha1 时只看哈希；否则看修改时间（差 > 1 秒才算）。 */
function fileDiffers(a, b, verify) {
  if (!a || !b) return true;
  if (a.s !== b.s) return true;
  if (verify && a.h && b.h) return a.h !== b.h;
  return Math.abs(a.m - b.m) > 1000;
}
/** 哪边更新（内容不同时用它决定传哪边；时间一样时以本机为准）。 */
function isNewer(a, b) { return a.m >= b.m ? 'a' : 'b'; }

// ---------------------------------------------------------------- 存档备份

function backupSave() {
  try {
    if (!fs.existsSync(SAVE_FILE)) return null;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dest = path.join(BACKUP_DIR, 'progress-' + nowStamp() + '.json');
    fs.copyFileSync(SAVE_FILE, dest);
    const olds = fs.readdirSync(BACKUP_DIR).filter((f) => /^progress-.*\.json$/.test(f)).sort();
    while (olds.length > BACKUP_KEEP) { try { fs.unlinkSync(path.join(BACKUP_DIR, olds.shift())); } catch (e) {} }
    return dest;
  } catch (e) { return null; }
}
function readSaveInfo() {
  try {
    const st = fs.statSync(SAVE_FILE);
    const txt = fs.readFileSync(SAVE_FILE, 'utf8');
    let data = null;
    try { data = JSON.parse(txt); } catch (e) {}
    return {
      exists: true, size: st.size, savedAt: Math.floor(st.mtimeMs),
      name: data && typeof data.name === 'string' ? data.name : '',
      level: data && Number.isFinite(data.level) ? data.level : null,
      data,
    };
  } catch (e) { return { exists: false, size: 0, savedAt: 0, name: '', level: null, data: null }; }
}
function describeSave(info, label) {
  if (!info || !info.exists) return label + '：还没有存档';
  return label + '：' + (info.name || '小松鼠') + ' ' + (info.level == null ? '?' : info.level) + ' 级 · 存档时间 ' + fmtTime(info.savedAt);
}

// ---------------------------------------------------------------- 本机地址

/** 从 zerotier-cli 拿本机 ZeroTier 地址；没有就退回名字像 ZeroTier 的网卡。 */
function zeroTierIps() {
  const ips = new Set();
  const cli = findExecutable(['/usr/local/bin/zerotier-cli', '/opt/homebrew/bin/zerotier-cli', '/usr/sbin/zerotier-cli',
    'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat', 'C:\\Program Files\\ZeroTier\\One\\zerotier-cli.bat', 'zerotier-cli']);
  if (cli) {
    try {
      // Windows 上的 zerotier-cli 是 .bat，execFile 不能直接跑批处理，得经过 cmd /c
      const isBatch = /\.(bat|cmd)$/i.test(cli);
      const out = isBatch
        ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/c', cli, 'listnetworks'], { encoding: 'utf8', timeout: 6000 })
        : execFileSync(cli, ['listnetworks'], { encoding: 'utf8', timeout: 4000 });
      for (const line of out.split(/\r?\n/)) {
        for (const c of line.trim().split(/\s+/)) {
          if (/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(c)) ips.add(c.split('/')[0]);
        }
      }
    } catch (e) {}
  }
  if (!ips.size) {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      if (!/^(zt|feth)/i.test(name)) continue;
      for (const a of ifs[name] || []) if (a.family === 'IPv4' && !a.internal) ips.add(a.address);
    }
  }
  return [...ips];
}
function findExecutable(list) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.bat', '.cmd'] : [''];
  for (const p of list) {
    try {
      if (p.includes(path.sep) || p.includes('/')) { if (fs.existsSync(p)) return p; continue; }
      for (const d of (process.env.PATH || '').split(path.delimiter)) {
        for (const ext of exts) {
          const f = path.join(d, p + ext);
          if (fs.existsSync(f)) return f;
        }
      }
    } catch (e) {}
  }
  return null;
}
function localHostname() { return os.hostname().replace(/\.local$/i, ''); }

// ---------------------------------------------------------------- HTTP 客户端

/** 向对端发一个请求。返回 {status, headers, buffer, json}（json 只在能解析时给出）。 */
function request(host, port, method, urlPath, opts) {
  opts = opts || {};
  const limit = opts.timeout || 15000;
  return new Promise((resolve, reject) => {
    const req = http.request({
      host, port, method, path: urlPath,
      headers: Object.assign({ 'x-ssdz-token': loadConfig().token }, opts.headers || {}),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buffer.toString('utf8')); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, buffer, json });
      });
    });
    // 连接阶段的超时也要算数：ZeroTier 上不存在的地址，TCP 握手可能挂很久，
    // 光靠 socket.setTimeout 不保险，所以自己拿一个定时器兜底 destroy。
    const timer = setTimeout(() => { try { req.destroy(new Error('连接超时')); } catch (e) {} }, limit);
    const clear = () => clearTimeout(timer);
    req.on('close', clear);
    req.on('error', (e) => { clear(); reject(e); });
    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}
async function getJson(host, port, urlPath, timeout) {
  const r = await request(host, port, 'GET', urlPath, { timeout });
  if (r.status !== 200) throw new Error((r.json && r.json.msg) || ('HTTP ' + r.status));
  return r.json;
}
async function getBuffer(host, port, urlPath) {
  const r = await request(host, port, 'GET', urlPath);
  if (r.status !== 200) throw new Error((r.json && r.json.msg) || ('HTTP ' + r.status));
  return r;
}
async function pingPeer(host, port, timeout) {
  try {
    const r = await request(host, port, 'GET', '/api/ping', { timeout: timeout || 800 });
    if (r.status === 200 && r.json && r.json.app === APP_TAG) return r.json;
  } catch (e) {}
  return null;
}

// ---------------------------------------------------------------- 对端解析

/** 扫本机各个 ZeroTier 网段的 /24，找开着同步服务的对端。 */
function discoverPeers() {
  const cfg = loadConfig();
  const self = zeroTierIps();
  const targets = new Set();
  for (const ip of self) {
    const parts = ip.split('.');
    for (let i = 1; i <= 254; i++) {
      const cand = parts[0] + '.' + parts[1] + '.' + parts[2] + '.' + i;
      if (cand !== ip) targets.add(cand);
    }
  }
  const list = [...targets];
  const found = [];
  return new Promise((resolve) => {
    if (!list.length) return resolve(found);
    let idx = 0, active = 0, done = false;
    const fallback = setTimeout(() => finish(), 12000);   // 兜底：扫太久就直接返回现有的
    function finish() { if (done) return; done = true; clearTimeout(fallback); resolve(found); }
    const next = () => {
      if (done) return;
      if (idx >= list.length) { if (active === 0) finish(); return; }
      const host = list[idx++];
      active++;
      pingPeer(host, cfg.port, 500).then((info) => {
        if (info) found.push({ name: info.name || host, host, saveAt: info.saveAt || 0 });
      }).catch(() => {}).then(() => { active--; next(); });
    };
    for (let i = 0; i < 128; i++) next();
  });
}

async function resolvePeer(arg) {
  const cfg = loadConfig();
  const peers = cfg.peers || {};
  if (arg) {
    const key = String(arg).trim();
    if (peers[key]) return { name: key, host: peers[key], port: cfg.port };
    if (/^\d+\.\d+\.\d+\.\d+$/.test(key)) return { name: key, host: key, port: cfg.port };
    const found = await discoverPeers();
    const hit = found.find((p) => p.name === key);
    if (hit) return { name: hit.name, host: hit.host, port: cfg.port };
    throw new Error('不认识这台机器「' + key + '」。先跑一次  node tools/sync/sync.js discover，' +
      '或者在 ' + CONFIG_FILE + ' 的 peers 里写上它的 ZeroTier 地址（例："' + key + '": "10.32.170.20"）。');
  }
  const names = Object.keys(peers);
  if (names.length === 1) return { name: names[0], host: peers[names[0]], port: cfg.port };
  const found = await discoverPeers();
  if (found.length === 1) return { name: found[0].name, host: found[0].host, port: cfg.port };
  if (found.length > 1) throw new Error('发现多台机器（' + found.map((f) => f.name + '@' + f.host).join('、') + '），请指定一台：… push <名字>');
  if (names.length > 1) throw new Error('配置里有 ' + names.length + ' 台机器，请指定一台：… push <名字>');
  throw new Error('还没找到对端。跑  node tools/sync/sync.js discover 扫一下 ZeroTier 网段，或直接  … push <对端IP>');
}

// ---------------------------------------------------------------- 自检与防火墙

/** 本机防火墙状态（只看，不改）。返回 {label, ok, hint} 数组。 */
function firewallChecks() {
  const out = [];
  if (process.platform === 'darwin') {
    let state = '';
    try { state = execFileSync('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate'], { encoding: 'utf8', timeout: 4000 }); } catch (e) {}
    const enabled = /enabled/i.test(state) && !/disabled/i.test(state);
    if (!state.trim()) out.push({ label: 'macOS 应用防火墙：查不到状态', ok: true, hint: '查不到就当没拦：macOS 的防火墙默认关闭。' });
    else if (!enabled) out.push({ label: 'macOS 应用防火墙：已关闭（不会拦入站连接）', ok: true });
    else {
      let app = '';
      try { app = execFileSync('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getappblocked', process.execPath], { encoding: 'utf8', timeout: 4000 }); } catch (e) {}
      const blocked = /blocked/i.test(app) && !/not blocked|allowed/i.test(app);
      out.push({
        label: 'macOS 应用防火墙：开着' + (app.trim() ? '，node ' + (blocked ? '被拦' : '没被拦') : ''),
        ok: !blocked,
        hint: blocked ? '系统设置 → 网络 → 防火墙 → 选项，把 node 改成「允许传入连接」（或直接关掉防火墙）。' : '首次运行如果弹出「是否允许 node 接受传入连接」，要选允许。',
      });
    }
  } else if (process.platform === 'win32') {
    let has = false;
    try {
      const r = execFileSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=' + FW_RULE_NAME], { encoding: 'utf8', timeout: 8000 });
      has = r.includes(FW_RULE_NAME);
    } catch (e) { has = false; }
    out.push({
      label: 'Windows 防火墙入站规则「' + FW_RULE_NAME + '」：' + (has ? '已存在' : '没有'),
      ok: has,
      hint: has ? '' : '跑一次  node tools/sync/sync.js firewall （会弹 UAC），或者双击「一键同步」菜单里的「a) 自检 / 放行防火墙」。' +
        '没有这条规则时，另一台机器连不上你这台的 ' + loadConfig().port + ' 端口（现象是「连不上」，而且本机看起来一切正常）。',
    });
  }
  return out;
}
/** Windows：加一条入站放行规则（需要管理员；没有权限就自动弹 UAC 重来一次）。 */
function firewallAdd() {
  const port = loadConfig().port;
  if (process.platform !== 'win32') {
    log('这个命令只在 Windows 上需要：macOS 的防火墙默认不放行也会弹窗问一次，允许就行。');
    for (const c of firewallChecks()) log('  ' + (c.ok ? '[√]' : '[!]') + ' ' + c.label + (c.hint ? '\n      → ' + c.hint : ''));
    return;
  }
  const args = ['advfirewall', 'firewall', 'add', 'rule', 'name=' + FW_RULE_NAME, 'dir=in', 'action=allow',
    'protocol=TCP', 'localport=' + String(port), 'profile=any'];
  try {
    execFileSync('netsh', args, { stdio: 'inherit' });
    log(green('[√] 已放行入站 TCP ' + port + '（规则名「' + FW_RULE_NAME + '」）'));
    return;
  } catch (e) {
    warn('[!] 直接加规则失败（大概是没用管理员权限），正在弹 UAC …');
  }
  try {
    const inner = 'netsh ' + args.map((a) => (a.includes(' ') ? '"' + a + '"' : a)).join(' ');
    execFileSync('powershell', ['-NoProfile', '-Command',
      'Start-Process -Verb RunAs -Wait -FilePath cmd.exe -ArgumentList \'/c ' + inner + ' & pause\''],
      { stdio: 'inherit', timeout: 120000 });
    log(green('[√] 已请求管理员权限添加规则；如果刚才那个黑窗口里没报错，就是加好了。'));
  } catch (e) {
    warn('[x] 没加成。手动来一次也可以：右键开始菜单 →「终端(管理员)」→ 粘贴：');
    warn('    ' + inner);
  }
}

/** 一次性把所有常见故障点过一遍，告诉用户下一步该做什么。 */
async function doctor(opts) {
  const cfg = ensureConfig();
  const lines = [];
  const say = (s) => { log(s); lines.push(s); };

  say(cyan('松鼠大战 · 双机同步自检'));
  say('');
  say('1) Node 与配置');
  say('   node ' + process.version + '（' + process.execPath + '）');
  say('   本机名字：' + cfg.name + '，端口：' + cfg.port + '，口令：' + (cfg.token ? cfg.token.slice(0, 4) + '…（' + cfg.token.length + ' 位）' : '（空！）'));
  say('   游戏目录：' + ROOT);
  say('   已配置对端：' + (Object.keys(cfg.peers || {}).length ? Object.entries(cfg.peers).map(([k, v]) => k + '=' + v).join('、') : '（无）'));

  say('');
  say('2) ZeroTier');
  const cli = findExecutable(['/usr/local/bin/zerotier-cli', '/opt/homebrew/bin/zerotier-cli', '/usr/sbin/zerotier-cli',
    'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat', 'C:\\Program Files\\ZeroTier\\One\\zerotier-cli.bat', 'zerotier-cli']);
  const ips = zeroTierIps();
  if (!cli) say('   [!] 找不到 zerotier-cli（ZeroTier 没装或不在 PATH 里）');
  else {
    try {
      const isBatch = /\.(bat|cmd)$/i.test(cli);
      const info = isBatch
        ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/c', cli, 'info'], { encoding: 'utf8', timeout: 6000 })
        : execFileSync(cli, ['info'], { encoding: 'utf8', timeout: 4000 });
      say('   ' + info.trim());
    } catch (e) { say('   [!] zerotier-cli info 失败：' + (e.message || e)); }
  }
  say('   本机 ZeroTier 地址：' + (ips.join('、') || '（一个都没检测到 —— ZeroTier 没连上）'));

  say('');
  say('3) 本机同步服务');
  const svc = await pingLocal(cfg.port);
  if (svc) {
    say(green('   [√] 正在运行（' + svc.name + '），监听 0.0.0.0:' + cfg.port));
    // 服务进程可能是改口令之前启动的（老版本会把口令读进内存就不再变），这里直接对一下指纹
    if (svc.tokenId && svc.tokenId !== tokenId(cfg.token)) {
      say('   [x] 但本机服务用的还是**旧口令**（服务指纹 ' + svc.tokenId + '，配置文件指纹 ' + tokenId(cfg.token) + '）');
      say('       → 跑一次 node tools/sync/sync.js restart 让服务读到新口令');
    } else if (svc.tokenId) {
      say('       服务口令指纹：' + svc.tokenId + '（和配置文件一致）');
    }
  } else {
    say('   [x] 没在运行 —— 对端连不上本机');
    say('       → 双击「一键同步」选「启动后台同步服务」，或跑 node tools/sync/sync.js start');
  }

  say('');
  say('4) 防火墙');
  const fw = firewallChecks();
  if (!fw.length) say('   （这个平台没有可自动检查的项目）');
  for (const c of fw) {
    say('   ' + (c.ok ? green('[√]') : '[x]') + ' ' + c.label);
    if (!c.ok && c.hint) say('       → ' + c.hint);
  }

  say('');
  say('5) 对端');
  const peerArg = opts.peer || opts._[1];
  let peer = null;
  try { peer = await resolvePeer(peerArg); } catch (e) { say('   ' + (e.message || e)); }
  if (peer) {
    say('   目标：' + peer.name + ' @ ' + peer.host + ':' + peer.port);
    const tcp = await tcpProbe(peer.host, peer.port, 3000);
    say('   TCP 连接：' + (tcp.ok ? green('通（' + tcp.ms + 'ms）') : '不通（' + tcp.reason + '）'));
    const info = await pingPeer(peer.host, peer.port, 3000);
    if (info) {
      say(green('   [√] 同步服务在线：' + info.name + '（存档时间 ' + fmtTime(info.saveAt) + '）'));
      const st = await request(peer.host, peer.port, 'GET', '/api/status', { timeout: 5000 }).catch(() => null);
      const mine = tokenId(cfg.token);
      if (st && st.status === 403) {
        const rid = (st.json && st.json.tokenId) || info.tokenId || '（对端版本较老，没返回指纹）';
        say('   [x] 口令不一致：本机指纹 ' + mine + '，对端指纹 ' + rid);
        say('       → 把两边 tools/sync/sync.config.json 的 token 改成完全一样（菜单第 8 项看本机的）；');
        say('       → 改完在对端跑一次 node tools/sync/sync.js restart（老版本服务不重启不生效）。');
      } else if (st && st.status === 200) {
        say(green('   [√] 口令一致（指纹 ' + mine + '），可以直接 push / pull。'));
      }
    } else if (!tcp.ok && /超时/.test(tcp.reason || '')) {
      say('   [x] 连上了但端口没响应 —— 最常见的原因是【对端 Windows 防火墙没放行 ' + peer.port + '】');
      say('       或【对端根本没启动同步服务】。这两件事都要在对端那台机器上做：');
      say('       · 对端双击「一键同步」→「启动后台同步服务」；');
      say('       · 对端跑一次 node tools/sync/sync.js firewall（Windows 会弹 UAC 放行入站）。');
    } else if (!tcp.ok) {
      say('   [x] 连不上 ' + peer.host + ':' + peer.port + '（' + tcp.reason + '）');
      say('       · 先 ping 一下：' + (process.platform === 'win32' ? 'ping ' : 'ping -c 2 ') + peer.host);
      say('       · 两边 ZeroTier 都要在线，且在同一张网络里（上面第 2 项）。');
    } else {
      say('   [x] 端口通但不是同步服务（可能被别的程序占用）。');
    }
  }

  say('');
  say('6) 结论');
  const blockers = [];
  if (!ips.length) blockers.push('本机 ZeroTier 没连上');
  if (!svc) blockers.push('本机同步服务没启动（对端要连本机时必须开）');
  if (fw.some((c) => !c.ok)) blockers.push('本机防火墙没放行（对端连本机时会被挡）');
  if (peer) {
    const info = await pingPeer(peer.host, peer.port, 2500);
    if (!info) blockers.push('对端服务连不上（对端没启动服务，或对端防火墙没放行 ' + peer.port + '）');
    else {
      const st = await request(peer.host, peer.port, 'GET', '/api/status', { timeout: 5000 }).catch(() => null);
      if (st && st.status === 403) blockers.push('两边口令（token）不一致 —— 改完要在对端 restart 才生效');
    }
  }
  if (!blockers.length) say(green('   没发现问题：可以 push / pull 了。'));
  else for (const b of blockers) say('   · ' + b);
  return lines;
}
function tcpProbe(host, port, ms) {
  const net = require('net');
  return new Promise((resolve) => {
    const t0 = Date.now();
    const s = new net.Socket();
    let done = false;
    const fin = (ok, reason) => { if (done) return; done = true; s.destroy(); resolve({ ok, ms: Date.now() - t0, reason }); };
    s.setTimeout(ms, () => fin(false, '超时（被防火墙丢包，或对端不在线）'));
    s.on('error', (e) => fin(false, e.code === 'ECONNREFUSED' ? '端口没人监听（对端服务没启动）' : e.code));
    s.connect(port, host, () => fin(true));
  });
}

// ---------------------------------------------------------------- 存档同步

async function savePush(peer, opts) {
  const local = readSaveInfo();
  if (!local.exists) { warn('本机还没有存档（' + SAVE_FILE + '），先玩一局再同步。'); return { ok: false }; }
  const remote = await getJson(peer.host, peer.port, '/api/save/meta', 5000).catch(() => null);
  log(describeSave(local, '本机  '));
  if (remote) log(describeSave(remote, '对端  '));
  if (remote && remote.exists && remote.savedAt > local.savedAt + 1000 && !opts.force) {
    warn('');
    warn('[!] 对端存档更新（' + fmtTime(remote.savedAt) + '），没有推送，免得把对面的进度盖旧。');
    warn('    确实要用本机这份覆盖它，就加 --force（对面会自动备份旧档）。');
    return { ok: false, skipped: true };
  }
  if (opts.dry) { log('[dry] 会把本机存档 POST 到 ' + peer.host + ':' + peer.port); return { ok: true }; }
  const body = fs.readFileSync(SAVE_FILE);
  const r = await request(peer.host, peer.port, 'POST', '/api/save' + (opts.force ? '?force=1' : ''), {
    headers: { 'content-type': 'application/json' }, body,
  });
  if (r.status !== 200 || !r.json || !r.json.ok) throw new Error((r.json && r.json.msg) || ('对端拒绝：HTTP ' + r.status));
  log(green('[√] 已把存档送到「' + peer.name + '」') + (r.json.backup ? '（对面旧档已备份成 ' + r.json.backup + '）' : ''));
  return { ok: true };
}

async function savePull(peer, opts) {
  const local = readSaveInfo();
  const r = await request(peer.host, peer.port, 'GET', '/api/save', { timeout: 8000 });
  if (r.status !== 200 || !r.json || !r.json.ok) throw new Error((r.json && r.json.msg) || ('对端拒绝：HTTP ' + r.status));
  const remote = r.json;
  log(describeSave(local, '本机  '));
  log(describeSave(remote, '对端  '));
  if (!remote.exists) { warn('对端还没有存档，没什么可取的。'); return { ok: false }; }
  if (local.exists && local.savedAt > remote.savedAt + 1000 && !opts.force) {
    warn('');
    warn('[!] 本机存档更新（' + fmtTime(local.savedAt) + '），没有拉取，免得把本机进度盖旧。');
    warn('    确实要用对面那份覆盖本机，就加 --force（本机会自动备份旧档）。');
    return { ok: false, skipped: true };
  }
  if (opts.dry) { log('[dry] 会把对端存档写入 ' + SAVE_FILE); return { ok: true }; }
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  const backup = backupSave();
  fs.writeFileSync(SAVE_FILE, JSON.stringify(remote.data), 'utf8');
  log(green('[√] 已从「' + peer.name + '」取回存档'));
  if (backup) log('    本机旧档已备份到 ' + path.relative(ROOT, backup));
  log('    游戏里刷新页面（或重新进系统页）即可看到新进度。');
  return { ok: true };
}

// ---------------------------------------------------------------- 文件同步

async function collectFilePlan(peer, opts) {
  const local = manifestMap(walk(ROOT, opts.verify));
  const q = opts.verify ? '?hash=1' : '';
  const rem = await getJson(peer.host, peer.port, '/api/manifest' + q, 60000);
  const remote = manifestMap(rem.entries || []);
  const toSend = [], toFetch = [], onlyLocal = [], onlyRemote = [];
  for (const [p, e] of local) {
    const r = remote.get(p);
    if (!r) { onlyLocal.push({ p, e }); continue; }
    if (!fileDiffers(e, r, opts.verify)) continue;
    if (isNewer(e, r) === 'a') toSend.push({ p, e }); else toFetch.push({ p, r });
  }
  for (const [p, r] of remote) if (!local.has(p)) onlyRemote.push({ p, r });
  return { local, remote, toSend, toFetch, onlyLocal, onlyRemote };
}

async function filesSync(peer, opts, direction) {
  const plan = await collectFilePlan(peer, opts);
  log('本机 ' + plan.local.size + ' 个文件，对端 ' + plan.remote.size + ' 个文件');
  // push：本机较新的 + 本机新加的；pull：对端较新的 + 对端新加的。两边都没有的「新文件」不会互相删。
  const changes = direction === 'push'
    ? plan.toSend.concat(plan.onlyLocal)
    : plan.toFetch.concat(plan.onlyRemote);
  const fresh = direction === 'push' ? plan.onlyLocal.length : plan.onlyRemote.length;
  if (!changes.length) log(green('[√] 没有需要' + (direction === 'push' ? '推送' : '拉取') + '的改动'));
  else if (fresh) log('其中 ' + fresh + ' 个是' + (direction === 'push' ? '本机新加的' : '对端新加的') + '文件');
  if (opts.dry) {
    for (const c of changes) log('[dry] ' + (direction === 'push' ? '→ ' : '← ') + c.p);
    return { ok: true, sent: 0 };
  }
  let done = 0, bytes = 0, failed = 0, idx = 0;
  const CONC = 4;
  async function worker() {
    while (idx < changes.length) {
      const c = changes[idx++];
      try {
        if (direction === 'push') {
          const buf = fs.readFileSync(path.join(ROOT, c.p));
          const r = await request(peer.host, peer.port, 'POST', '/api/file?path=' + encodeURIComponent(c.p), {
            headers: { 'content-type': 'application/octet-stream', 'x-ssdz-mtime': String(c.e.m) }, body: buf,
          });
          if (r.status !== 200 || !r.json || !r.json.ok) throw new Error((r.json && r.json.msg) || ('HTTP ' + r.status));
          bytes += buf.length;
        } else {
          const r = await getBuffer(peer.host, peer.port, '/api/file?path=' + encodeURIComponent(c.p));
          const abs = path.join(ROOT, c.p);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, r.buffer);
          const mt = Number(r.headers['x-ssdz-mtime']);
          if (Number.isFinite(mt) && mt > 0) { try { fs.utimesSync(abs, mt / 1000, mt / 1000); } catch (e) {} }
          bytes += r.buffer.length;
        }
        done++;
        log((direction === 'push' ? '  → ' : '  ← ') + c.p);
      } catch (e) {
        failed++;
        warn('  [!] ' + c.p + ' 失败：' + (e.message || e));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(CONC, changes.length)) }, worker));
  log(green('[√] ' + (direction === 'push' ? '推送' : '拉取') + ' ' + done + '/' + changes.length + ' 个文件（' + (bytes / 1024).toFixed(0) + ' KB）') + (failed ? '，失败 ' + failed + ' 个' : ''));
  if (direction === 'push' && plan.onlyRemote.length) log('    对端还多出 ' + plan.onlyRemote.length + ' 个本机没有的文件（不会自动删）');
  if (direction === 'pull' && plan.onlyLocal.length) log('    本机还有 ' + plan.onlyLocal.length + ' 个对端没有的文件（不会自动删）');
  return { ok: true, sent: done, failed };
}

/** watch 用：只推指定的这几个文件。 */
async function pushFiles(peer, list, opts) {
  let done = 0;
  for (const c of list) {
    try {
      const buf = fs.readFileSync(path.join(ROOT, c.p));
      const r = await request(peer.host, peer.port, 'POST', '/api/file?path=' + encodeURIComponent(c.p), {
        headers: { 'content-type': 'application/octet-stream', 'x-ssdz-mtime': String(c.e.m) }, body: buf,
      });
      if (r.status !== 200 || !r.json || !r.json.ok) throw new Error((r.json && r.json.msg) || ('HTTP ' + r.status));
      done++;
      log('  → ' + c.p);
    } catch (e) { warn('  [!] ' + c.p + ' 失败：' + (e.message || e)); }
  }
  return done;
}

// ---------------------------------------------------------------- 接收服务

function safeRelPath(rel) {
  if (!rel || rel.includes('\0')) return null;
  const norm = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.includes(':')) return null;
  const segs = norm.split('/');
  if (segs.some((s) => s === '..' || s === '')) return null;
  if (ignored(norm)) return null;
  const abs = path.resolve(ROOT, norm);
  if (!abs.startsWith(ROOT + path.sep)) return null;
  return { rel: norm, abs };
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('太大')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function sendJson(res, code, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': body.length }, extraHeaders || {}));
  res.end(body);
}
function tokenOk(req) {
  const t = String(req.headers['x-ssdz-token'] || '');
  const want = loadConfig().token;
  if (!t || !want || t.length !== want.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want)); } catch (e) { return false; }
}
function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
/** 返回：null = 没有 Origin（curl 之类，放行）；undefined = Origin 不合法（拒绝）；字符串 = 回显的 CORS 头。 */
function allowedOrigin(req) {
  const o = req.headers.origin;
  if (!o) return null;
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(o) ? o : undefined;
}

function createServer() {
  return http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch (e) { return sendJson(res, 400, { ok: false, msg: 'bad url' }); }
    const p = url.pathname;
    const cfg = loadConfig();

    // ---- 对端接口（需要口令） ----
    if (p === '/api/ping') {
      const s = readSaveInfo();
      // tokenId 只是口令的 6 位指纹，用来让对面判断「我们俩的口令一样吗」，不需要认证也不会泄露口令
      return sendJson(res, 200, { ok: true, app: APP_TAG, version: APP_VERSION, name: cfg.name || localHostname(), saveAt: s.savedAt, tokenId: tokenId(cfg.token) });
    }
    if (p.startsWith('/api/')) {
      if (!tokenOk(req)) {
        return sendJson(res, 403, {
          ok: false,
          tokenId: tokenId(cfg.token),
          msg: '同步口令不对：本机（' + (cfg.name || localHostname()) + '）的口令指纹是 ' + tokenId(cfg.token) +
            '，和对面不一致。把两边 tools/sync/sync.config.json 的 token 改成一样；' +
            '改完不用重启（新版会自动读新配置），老版本要跑一次 node tools/sync/sync.js restart。',
        });
      }
      try {
        if (p === '/api/status') {
          const s = readSaveInfo();
          return sendJson(res, 200, { ok: true, app: APP_TAG, version: APP_VERSION, name: cfg.name || localHostname(), root: ROOT, saveAt: s.savedAt, saveSize: s.size, exists: s.exists, tokenId: tokenId(cfg.token) });
        }
        if (p === '/api/save/meta') { const s = readSaveInfo(); return sendJson(res, 200, { ok: true, exists: s.exists, savedAt: s.savedAt, size: s.size, name: s.name, level: s.level }); }
        if (p === '/api/save' && req.method === 'GET') {
          const s = readSaveInfo();
          return sendJson(res, 200, { ok: true, exists: s.exists, savedAt: s.savedAt, name: s.name, level: s.level, data: s.data });
        }
        if (p === '/api/save' && req.method === 'POST') {
          const body = await readBody(req, SAVE_MAX);
          let parsed;
          try { parsed = JSON.parse(body.toString('utf8')); } catch (e) { return sendJson(res, 400, { ok: false, msg: '存档不是合法 JSON' }); }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return sendJson(res, 400, { ok: false, msg: '存档必须是对象' });
          const force = url.searchParams.get('force') === '1';
          const cur = readSaveInfo();
          const incomingAt = Number(parsed.savedAt) || 0;
          if (cur.exists && cur.savedAt > incomingAt + 1000 && !force) {
            return sendJson(res, 200, { ok: false, msg: '本机存档更新（' + fmtTime(cur.savedAt) + '），没有覆盖；加 --force 可以强制' });
          }
          fs.mkdirSync(SAVE_DIR, { recursive: true });
          const backup = backupSave();
          fs.writeFileSync(SAVE_FILE, JSON.stringify(parsed), 'utf8');
          return sendJson(res, 200, { ok: true, savedAt: Math.floor(fs.statSync(SAVE_FILE).mtimeMs), backup: backup ? path.basename(backup) : null });
        }
        if (p === '/api/manifest') {
          return sendJson(res, 200, { ok: true, root: ROOT, entries: walk(ROOT, url.searchParams.get('hash') === '1') });
        }
        if (p === '/api/file' && (req.method === 'GET' || req.method === 'HEAD')) {
          const loc = safeRelPath(url.searchParams.get('path') || '');
          if (!loc) return sendJson(res, 400, { ok: false, msg: '路径不合法或已被忽略' });
          let data, st;
          try { data = fs.readFileSync(loc.abs); st = fs.statSync(loc.abs); } catch (e) { return sendJson(res, 404, { ok: false, msg: '文件不存在：' + loc.rel }); }
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length, 'x-ssdz-mtime': String(Math.round(st.mtimeMs)) });
          return res.end(req.method === 'HEAD' ? undefined : data);
        }
        if (p === '/api/file' && req.method === 'POST') {
          const loc = safeRelPath(url.searchParams.get('path') || '');
          if (!loc) return sendJson(res, 400, { ok: false, msg: '路径不合法或已被忽略' });
          const body = await readBody(req, 64 * 1024 * 1024);
          fs.mkdirSync(path.dirname(loc.abs), { recursive: true });
          fs.writeFileSync(loc.abs, body);
          const mt = Number(req.headers['x-ssdz-mtime']);
          if (Number.isFinite(mt) && mt > 0) { try { fs.utimesSync(loc.abs, mt / 1000, mt / 1000); } catch (e) {} }
          return sendJson(res, 200, { ok: true, path: loc.rel, size: body.length });
        }
        return sendJson(res, 404, { ok: false, msg: '没有这个接口：' + p });
      } catch (e) {
        return sendJson(res, 500, { ok: false, msg: String((e && e.message) || e) });
      }
    }

    // ---- 本机接口（只允许 127.0.0.1，游戏页面用它做「一键同步」） ----
    if (p.startsWith('/local/')) {
      const origin = allowedOrigin(req);
      if (origin === undefined) return sendJson(res, 403, { ok: false, msg: '只允许来自 127.0.0.1 页面的调用' });
      const cors = { 'access-control-allow-origin': origin || '*', 'access-control-allow-headers': 'content-type,x-ssdz-token', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (!isLoopback(req)) return sendJson(res, 403, { ok: false, msg: '只允许本机调用' }, cors);
      try {
        if (p === '/local/status') {
          return sendJson(res, 200, {
            ok: true, app: APP_TAG, name: cfg.name || localHostname(), port: cfg.port,
            root: ROOT, save: (({ data, ...rest }) => rest)(readSaveInfo()), selfIps: zeroTierIps(), peers: cfg.peers || {},
          }, cors);
        }
        if (p === '/local/discover') {
          return sendJson(res, 200, { ok: true, found: await discoverPeers() }, cors);
        }
        const m = p.match(/^\/local\/(save|files)\/(push|pull)$/);
        if (m && req.method === 'POST') {
          const kind = m[1], dir = m[2];
          const peer = await resolvePeer(url.searchParams.get('peer') || '');
          const opts = { force: url.searchParams.get('force') === '1' };
          const r = kind === 'save'
            ? (dir === 'push' ? await savePush(peer, opts) : await savePull(peer, opts))
            : await filesSync(peer, opts, dir);
          return sendJson(res, 200, Object.assign({ ok: true, peer: peer.name }, r), cors);
        }
        return sendJson(res, 404, { ok: false, msg: '没有这个接口：' + p }, cors);
      } catch (e) {
        return sendJson(res, 500, { ok: false, msg: String((e && e.message) || e) }, cors);
      }
    }

    sendJson(res, 404, { ok: false, msg: '没有这个接口：' + p });
  });
}

function startServer(port) {
  port = port || loadConfig().port;
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(port, '0.0.0.0', () => resolve({ srv, port }));
  });
}

// ---------------------------------------------------------------- 后台服务管理

function pingLocal(port) { return pingPeer('127.0.0.1', port, 800); }

async function daemonStart(quiet) {
  const cfg = ensureConfig();
  const existing = await pingLocal(cfg.port);
  if (existing) {
    // 已经在跑的服务如果用的还是旧口令（老版本启动时把口令读进内存了），这里自动重启一次，
    // 免得出现「两边 token 明明一样却同步不过去」——用户只要再跑一次 start 就自愈。
    if (existing.tokenId && existing.tokenId !== tokenId(cfg.token)) {
      if (!quiet) log('同步服务用的还是旧口令（服务指纹 ' + existing.tokenId + '，配置指纹 ' + tokenId(cfg.token) + '），自动重启一次…');
      daemonStop();
      await sleep(500);
    } else {
      if (!quiet) log('同步服务已经在运行（' + existing.name + '，端口 ' + cfg.port + '）。');
      return existing;
    }
  }
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  const out = fs.openSync(OUT_LOG, 'a'), err = fs.openSync(ERR_LOG, 'a');
  const child = spawn(process.execPath, [__filename, 'serve', '--port', String(cfg.port)], {
    detached: true, stdio: ['ignore', out, err], cwd: ROOT,
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const info = await pingLocal(cfg.port);
    if (info) { if (!quiet) log('同步服务已在后台启动（端口 ' + cfg.port + '）。'); return info; }
  }
  throw new Error('同步服务没起来：端口 ' + cfg.port + ' 可能被别的程序占了，看日志 ' + ERR_LOG);
}
function daemonStop() {
  let pid = 0;
  try { pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10); } catch (e) {}
  if (pid && pid > 0) {
    try { process.kill(pid, 'SIGTERM'); } catch (e) {}
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
    log('已停掉后台同步服务（PID ' + pid + '）。');
    return true;
  }
  log('没有找到正在运行的后台同步服务。');
  return false;
}
async function daemonStatus() {
  const cfg = loadConfig();
  let pid = 0;
  try { pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10); } catch (e) {}
  return { running: !!(await pingLocal(cfg.port)), pid };
}

// ---------------------------------------------------------------- 开机自启

function autostartPath() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.ssdz.sync.plist');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'SSDZ-sync.vbs');
  return path.join(os.homedir(), '.config', 'autostart', 'ssdz-sync.desktop');
}
function autostartInstall() {
  ensureConfig();
  const file = autostartPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (process.platform === 'darwin') {
    const plist = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      '<plist version="1.0"><dict>\n' +
      '  <key>Label</key><string>com.ssdz.sync</string>\n' +
      '  <key>ProgramArguments</key><array>\n' +
      '    <string>' + escapeXml(process.execPath) + '</string>\n' +
      '    <string>' + escapeXml(__filename) + '</string>\n' +
      '    <string>serve</string>\n' +
      '  </array>\n' +
      '  <key>WorkingDirectory</key><string>' + escapeXml(ROOT) + '</string>\n' +
      '  <key>RunAtLoad</key><true/>\n' +
      '  <key>ProcessType</key><string>Background</string>\n' +
      '  <key>StandardOutPath</key><string>' + escapeXml(OUT_LOG) + '</string>\n' +
      '  <key>StandardErrorPath</key><string>' + escapeXml(ERR_LOG) + '</string>\n' +
      '</dict></plist>\n';
    fs.writeFileSync(file, plist, 'utf8');
    try { execFileSync('launchctl', ['unload', file], { stdio: 'ignore' }); } catch (e) {}
    try { execFileSync('launchctl', ['load', '-w', file], { stdio: 'ignore' }); } catch (e) {}
    log('已装好开机自启（LaunchAgent）：' + file);
  } else if (process.platform === 'win32') {
    const vbs = 'Set s = CreateObject("WScript.Shell")\r\n' +
      's.CurrentDirectory = "' + ROOT.replace(/"/g, '""') + '"\r\n' +
      's.Run """' + process.execPath + '"" ""' + __filename + '"" serve", 0, False\r\n';
    fs.writeFileSync(file, vbs, 'utf8');
    log('已装好开机自启（启动文件夹）：' + file);
  } else {
    const desk = '[Desktop Entry]\nType=Application\nName=SSDZ Sync\nExec="' + process.execPath + '" "' + __filename + '" serve\nX-GNOME-Autostart-enabled=true\n';
    fs.writeFileSync(file, desk, 'utf8');
    log('已装好开机自启：' + file);
  }
}
function autostartRemove() {
  const file = autostartPath();
  if (process.platform === 'darwin') { try { execFileSync('launchctl', ['unload', file], { stdio: 'ignore' }); } catch (e) {} }
  try { fs.unlinkSync(file); log('已取消开机自启。'); } catch (e) { log('本来就没有装开机自启。'); }
}
function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------------------------------------------------------------- 命令行

function printBanner() {
  const cfg = ensureConfig();
  const ips = zeroTierIps();
  const peers = Object.keys(cfg.peers || {});
  log(cyan('松鼠大战 · 双机同步'));
  log('  本机名字：' + cfg.name);
  log('  游戏目录：' + ROOT);
  log('  监听端口：' + cfg.port);
  log('  ZeroTier：' + (ips.length ? ips.join('、') : '（没检测到 ZeroTier 地址，确认 ZeroTier 已连接）'));
  log('  同步口令：' + cfg.token);
  log('  已配置对端：' + (peers.length ? peers.map((k) => k + '=' + cfg.peers[k]).join('、') : '（还没有，用 discover 自动找）'));
}
function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--save') opts.save = true;
    else if (a === '--files') opts.files = true;
    else if (a === '--all') { opts.save = true; opts.files = true; }
    else if (a === '--force') opts.force = true;
    else if (a === '--dry') opts.dry = true;
    else if (a === '--verify') opts.verify = true;
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--peer') opts.peer = argv[++i];
    else if (a === '--interval') opts.interval = Number(argv[++i]);
    else opts._.push(a);
  }
  return opts;
}
/** 没给 --save/--files 时默认两个都做；只给了一个就只做那一个。 */
function syncKinds(opts) {
  if (opts.save && !opts.files) return { save: true, files: false };
  if (opts.files && !opts.save) return { save: false, files: true };
  return { save: true, files: true };
}
async function connectPeer(arg) {
  const peer = await resolvePeer(arg);
  // ZeroTier 刚上线 / 机器刚从睡眠唤醒时，头几次连接容易失败，多试几轮再报错
  const tries = Math.max(1, Number(process.env.SSDZ_SYNC_RETRY) || 4);
  let info = null;
  for (let i = 0; i < tries && !info; i++) {
    if (i) { log('第 ' + (i + 1) + ' 次尝试连接 ' + peer.host + ':' + peer.port + ' …'); await sleep(1200); }
    info = await pingPeer(peer.host, peer.port, 3000);
  }
  if (!info) {
    const tcp = await tcpProbe(peer.host, peer.port, 3000);
    throw new Error('连不上「' + peer.name + '」(' + peer.host + ':' + peer.port + ')：TCP ' + tcp.reason + '\n' +
      '    · 对端要先把同步服务开着（双击「一键同步」选「启动后台同步服务」，或跑 node tools/sync/sync.js start）；\n' +
      '    · 对端是 Windows 的话还要放行入站端口：node tools/sync/sync.js prepare（会弹 UAC）；\n' +
      '    · 两边的 ZeroTier 要在线，地址用 node tools/sync/sync.js discover 复查；\n' +
      '    · 两边的同步口令（token）要一样。\n' +
      '    想知道卡在哪一步：node tools/sync/sync.js doctor ' + peer.name);
  }
  // 服务在线了：先验口令，别等传到一半才报 403
  const mine = tokenId(loadConfig().token);
  const theirs = info.tokenId || null;
  const st = await request(peer.host, peer.port, 'GET', '/api/status', { timeout: 5000 }).catch(() => null);
  if (st && st.status === 403) {
    const remoteId = (st.json && st.json.tokenId) || theirs;
    throw new Error('口令不一致，连上了但被对端拒绝：\n' +
      '    本机「' + loadConfig().name + '」口令指纹 ' + mine + '；对端「' + (info.name || peer.name) + '」口令指纹 ' +
      (remoteId || '（对端版本较老，没返回指纹）') + '\n' +
      '    → 把两边 tools/sync/sync.config.json 的 token 改成完全一样（菜单第 8 项能看本机的）。\n' +
      '    → 改完**在对端跑一次** node tools/sync/sync.js restart（老版本的服务启动时就把口令读进内存了，' +
      '改文件不重启不会生效，这正是「两边 token 明明一样却同步不过去」最常见的原因）。\n' +
      '    → 对端如果换成新版 sync.js，就不用重启了：每次请求都会重新读配置。');
  }
  if (theirs && theirs !== mine) {
    throw new Error('口令不一致：本机指纹 ' + mine + '，对端指纹 ' + theirs + '。\n' +
      '    改 tools/sync/sync.config.json 里的 token，两边改成一样即可（新版不用重启，老版本要 restart）。');
  }
  return { peer, info };
}
async function doSync(direction, opts) {
  const { peer, info } = await connectPeer(opts.peer || opts._[1]);
  log('对端：' + info.name + ' @ ' + peer.host + ':' + peer.port);
  const kinds = syncKinds(opts);
  if (kinds.save) { log(''); log(cyan('—— 存档 ——')); await (direction === 'push' ? savePush(peer, opts) : savePull(peer, opts)); }
  if (kinds.files) { log(''); log(cyan('—— 游戏文件 ——')); await filesSync(peer, opts, direction); }
}
async function doWatch(opts) {
  const { peer } = await connectPeer(opts.peer || opts._[1]);
  const interval = Math.max(1, opts.interval || 3) * 1000;
  log('盯着本机改动 → ' + peer.name + '（每 ' + (interval / 1000) + ' 秒扫一次，Ctrl+C 结束）');
  let last = manifestMap(walk(ROOT));
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const now = manifestMap(walk(ROOT));
      const changed = [];
      for (const [p, e] of now) {
        const old = last.get(p);
        if (!old || old.s !== e.s || old.m !== e.m) changed.push({ p, e });
      }
      last = now;
      if (changed.length) {
        log('改动 ' + changed.length + ' 个文件，推给 ' + peer.name + ' …');
        await pushFiles(peer, changed, opts);
      }
    } catch (e) { warn('[!] ' + (e.message || e)); }
    busy = false;
  }, interval);
  const bye = () => { clearInterval(timer); log('已停止监视。'); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
  await new Promise(() => {});
}

const HELP = `松鼠大战 · 双机同步（node tools/sync/sync.js <命令> [选项]）

  init                        生成配置，显示本机名字 / ZeroTier 地址 / 同步口令
  serve [--port N]            前台跑接收服务（另一台机器要连的那一头）
  start | stop | restart      后台接收服务（日志 save/sync.out.log，PID save/.sync.pid）
  status [peer]               看本机与对端的存档时间、服务状态
  discover                    扫 ZeroTier 网段，自动找对端
  doctor [peer]               自检：ZeroTier / 本机服务 / 防火墙 / 对端，卡在哪一步一目了然
  firewall                    Windows：加一条入站放行规则（弹 UAC）；macOS：只报告状态
  prepare                     一键准备：启动服务 + 放行防火墙 + 自检（连不上先跑这个）
  push [peer] [选项]          本机 → 对端
  pull [peer] [选项]          对端 → 本机
  watch [peer] [--interval N] 盯着本地文件改动，自动推给对端
  token [值]                  查看 / 设置同步口令（两边要一样）
  autostart install|remove    开机自启同步服务

选项：--save 只同步存档 / --files 只同步文件 / --all 两者（默认两者）
      --force 存档比对方旧也覆盖 / --dry 只列计划 / --verify 文件用 sha1 比对
      --peer <名字或IP> / --interval <秒>

例子：
  node tools/sync/sync.js start                     # 本机开接收服务
  node tools/sync/sync.js discover                  # 找到对端
  node tools/sync/sync.js push win --save           # 把存档送到 win
  node tools/sync/sync.js pull win --files          # 从 win 拉取改动过的文件
`;

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'help';
  const opts = parseArgs(argv);

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') { printBanner(); log(''); log(HELP); return; }
  if (cmd === 'init') { ensureConfig(); printBanner(); log(''); log('把两边的同步口令改成一样（token），或者直接改 ' + CONFIG_FILE + '。'); return; }
  if (cmd === 'token') {
    ensureConfig();
    const v = argv[1];
    if (!v) { log(loadConfig().token); return; }
    config.token = String(v).trim(); saveConfig();
    log('同步口令已改成：' + config.token + '（指纹 ' + tokenId(config.token) + '）');
    log('记得把另一台机器的 tools/sync/sync.config.json 里的 token 也改成一样。');
    // 本机服务如果是老版本（启动时把口令读进内存），不重启就不会认新口令 —— 顺手重启掉
    if (await pingLocal(loadConfig().port)) {
      daemonStop();
      await sleep(400);
      await daemonStart(true);
      log('本机同步服务已用新口令重启。');
    }
    log('对端那台如果还是老版本 sync.js，也要在对端跑一次 node tools/sync/sync.js restart。');
    return;
  }
  if (cmd === 'serve') {
    ensureConfig();
    const { port } = await startServer(opts.port || loadConfig().port);
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    printBanner();
    log('');
    log(green('同步服务已启动：http://0.0.0.0:' + port + '/   （Ctrl+C 结束）'));
    const stop = () => { try { fs.unlinkSync(PID_FILE); } catch (e) {} process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return;
  }
  if (cmd === 'start') { ensureConfig(); await daemonStart(false); return; }
  if (cmd === 'stop') { daemonStop(); return; }
  if (cmd === 'restart') { daemonStop(); await sleep(400); await daemonStart(false); return; }
  if (cmd === 'status') {
    ensureConfig();
    const cfg = loadConfig();
    const st = await daemonStatus();
    const s = readSaveInfo();
    log('本机：' + cfg.name + '（端口 ' + cfg.port + '，服务' + (st.running ? '运行中' : '未运行') + '）');
    log('  ' + describeSave(s, '存档'));
    log('  ZeroTier：' + (zeroTierIps().join('、') || '未检测到'));
    let peer = null;
    try { peer = await resolvePeer(opts.peer || opts._[1]); } catch (e) { peer = null; }
    if (!peer) { log('对端：还没找到（用 discover 自动找）'); return; }
    const info = await pingPeer(peer.host, peer.port, 2500);
    if (!info) { log('对端：' + peer.name + ' @ ' + peer.host + ' —— 连不上（对端服务没开？）'); return; }
    log('对端：' + info.name + ' @ ' + peer.host + '（服务运行中）');
    const rm = await getJson(peer.host, peer.port, '/api/save/meta', 5000).catch(() => null);
    log('  ' + describeSave(rm, '存档'));
    const local = manifestMap(walk(ROOT));
    const rem = await getJson(peer.host, peer.port, '/api/manifest', 60000).catch(() => null);
    if (rem) {
      const remote = manifestMap(rem.entries || []);
      let newerLocal = 0, newerRemote = 0;
      for (const [p, e] of local) {
        const r = remote.get(p);
        if (!r) continue;
        if (e.m > r.m + 1000) newerLocal++; else if (r.m > e.m + 1000) newerRemote++;
      }
      log('  文件：本机 ' + local.size + ' 个 / 对端 ' + remote.size + ' 个，其中 ' + newerLocal + ' 个本机较新、' + newerRemote + ' 个对端较新');
    }
    return;
  }
  if (cmd === 'discover') {
    ensureConfig();
    log('本机 ZeroTier：' + (zeroTierIps().join('、') || '未检测到'));
    log('正在扫描 ...（每台机器试 0.5 秒）');
    const found = await discoverPeers();
    if (!found.length) { warn('没找到开着同步服务的对端。确认对面跑过 node tools/sync/sync.js start。'); return; }
    log(green('找到 ' + found.length + ' 台：'));
    const cfg = loadConfig();
    for (const f of found) {
      log('  ' + f.name + ' @ ' + f.host + (f.saveAt ? '（存档 ' + fmtTime(f.saveAt) + '）' : ''));
      if (!Object.values(cfg.peers).includes(f.host)) cfg.peers[f.name || f.host] = f.host;
    }
    saveConfig();
    log('已写进 ' + CONFIG_FILE + ' 的 peers。');
    return;
  }
  if (cmd === 'push') { await doSync('push', opts); return; }
  if (cmd === 'pull') { await doSync('pull', opts); return; }
  if (cmd === 'watch') { await doWatch(opts); return; }
  if (cmd === 'doctor') { await doctor(opts); return; }
  if (cmd === 'firewall') { ensureConfig(); firewallAdd(); return; }
  if (cmd === 'prepare') {
    // 一键准备：起服务 + 放行入站（Windows）+ 自检。连不上时先跑这个。
    ensureConfig();
    log(cyan('== 1/3 启动后台同步服务 =='));
    await daemonStart(false);
    log('');
    log(cyan('== 2/3 放行入站端口 =='));
    firewallAdd();
    log('');
    log(cyan('== 3/3 自检 =='));
    await doctor(opts);
    return;
  }
  if (cmd === 'autostart') {
    const action = argv[1] || 'status';
    if (action === 'install') autostartInstall();
    else if (action === 'remove') autostartRemove();
    else log('开机自启：' + (fs.existsSync(autostartPath()) ? autostartPath() : '未安装'));
    return;
  }
  die('不认识的命令「' + cmd + '」。\n\n' + HELP);
}

main().catch((e) => {
  console.error('');
  console.error('[x] ' + (e && e.message ? e.message : e));
  process.exit(1);
});
