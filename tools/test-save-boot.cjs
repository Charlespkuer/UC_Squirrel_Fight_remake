#!/usr/bin/env node
/* ============================================================
 * tools/test-save-boot.cjs — 启动存档回归测试
 *
 * 病根（实测复现过）：双击启动器后，只要 /__save 探针失败（启动器还没把服务器拉起来、
 * 页面被 file:// 打开、端口上蹲着别的静态服务器），js/main.js 就会**静默**回落到
 * 浏览器 localStorage 里那份残留的旧档 —— 玩家看到 1 级，磁盘上的 save/progress.json
 * 明明还是 32 级。
 *
 * 这里真起一个脚本副本 + 真 serve.js，在 Node vm 里跑 js/state.js 与 js/main.js，
 * 断言：磁盘存档永远是第一优先；回落时必须留下可见告警；旧档不许覆盖水位线以上的存档。
 *
 * 用法：node tools/test-save-boot.cjs
 * ============================================================ */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

/** 项目根：往上找到含 index.html 的那一层。 */
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'index.html'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(start, '..');
}
const ROOT = findRoot(__dirname);
/* 端口：默认让 Node 自己挑一个空闲端口（port=0），server 启动日志里会打印真实端口。
 *  固定端口会让测试互相打架（上一个用例/上一次运行的监听还在），所以不再自己猜。 */
let PORT = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 先问内核要一个空闲端口：给「页面里的 fetch 必须先知道端口」的场景用。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = require('node:net').createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

const SAVE_32 = {
  name: 'Charles', level: 32, exp: 838, power: 26, agility: 22, speed: 22, maxHp: 380,
  energy: 180, maxEnergy: 202, goldPoint: 275, goldCup: 119, integral: 2103,
  weapons: ['15:11'], skills: ['11:6'], props: { 1: 87 }, stages: {},
  // 两个时间戳故意不一致：这正是用户磁盘上那份档的情况（文件是同步/手工恢复过来的，
  // 内部 savedAt 比文件 mtime 旧 13 小时）。旧代码会因此永远跳过自动保存。
  savedAt: Date.now() - 13 * 3600 * 1000,
};
const SAVE_LOCAL_1 = {
  name: '小松鼠', level: 1, exp: 0, power: 5, agility: 4, speed: 5, maxHp: 40,
  energy: 90, maxEnergy: 90, goldPoint: 100, weapons: [], skills: [], props: { 1: 3 }, savedAt: Date.now(),
};

/** 把 js/ 和 scripts/index.html + serve.js 拷进临时目录（素材用软链，省时间）。 */
function makeGameCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssdz-boot-'));
  for (const d of ['js', 'css']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'save'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'index.html'), path.join(dir, 'scripts', 'index.html'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'serve.js'), path.join(dir, 'scripts', 'serve.js'));
  fs.writeFileSync(path.join(dir, 'save', 'progress.json'), JSON.stringify(SAVE_32));
  fs.writeFileSync(path.join(dir, 'save', '.min-level'), '32');
  return dir;
}

/** 起一个真服务器：传给 serve.js 的端口用 port（默认 0 = 内核分配），
 *  返回一个 ready Promise，resolve 出真实端口 —— 等它真的监听上再让页面去 fetch。 */
function startServer(gameDir, delayMs, port, optsNoWait) {
  let p = null;
  let log = '';
  let resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });
  const start = () => {
    p = spawn(process.execPath, [path.join(gameDir, 'scripts', 'serve.js'), String(port == null ? 0 : port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => {
      log += d;
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(log);
      if (m) { PORT = Number(m[1]); resolveReady(PORT); }
    });
    p.stderr.on('data', (d) => { log += d; });
    p.on('exit', () => resolveReady(0));
  };
  if (delayMs) setTimeout(start, delayMs); else start();
  // noWait：调用方要「页面先开、服务器后起」，自己控制等待时机
  return {
    kill() { if (p) p.kill(); },
    log: () => log,
    ready: optsNoWait ? Promise.resolve(0) : ready,
    whenReady: () => ready,
    port: () => PORT,
  };
}

/** 一个够用的 DOM 桩：记录横幅、页面跳转、被移除的键。 */
function fakeDom() {
  const elements = [];
  const listeners = {};
  function makeCtx2d() {
    const noop = () => {};
    return {
      canvas: null, filter: 'none', fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, font: '',
      save: noop, restore: noop, setTransform: noop, translate: noop, scale: noop, rotate: noop,
      beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, rect: noop, arc: noop,
      fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
      drawImage: noop, fillText: noop, strokeText: noop, measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: () => null, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: noop,
      quadraticCurveTo: noop, bezierCurveTo: noop, setLineDash: noop, getLineDash: () => [],
      ellipse: noop, roundRect: noop,
    };
  }
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(), id: '', textContent: '', innerHTML: '', value: '', className: '', type: '',
      width: 1170, height: 690, children: [], attrs: {},
      style: { cssText: '', setProperty() {}, width: '', height: '', transform: '', fontSize: '' },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      dataset: {},
      getContext: () => makeCtx2d(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1170, height: 690 }),
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(child) { this.children.push(child); child.parent = this; elements.push(child); return child; },
      removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); return child; },
      remove() { this.removeChild && this.parent && this.parent.removeChild(this); const i = elements.indexOf(this); if (i >= 0) elements.splice(i, 1); },
      addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
      removeEventListener() {},
      click() {},
      focus() {}, blur() {}, select() {}, setSelectionRange() {},
      querySelector(sel) { return queryWalk(this, sel); },
      querySelectorAll() { return []; },
      insertBefore(child) { return this.appendChild(child); },
      contains: () => false,
      get firstChild() { return this.children[0] || null; },
      closest: () => null,
    };
    return el;
  }
  function queryWalk(root, sel) {
    const want = String(sel).replace(/^#/, '');
    const stack = [...(root.children || [])];
    while (stack.length) {
      const n = stack.shift();
      if (n.id === want || (n.attrs && n.attrs.id === want)) return n;
      stack.push(...(n.children || []));
    }
    return null;
  }
  const body = makeEl('body');
  const ui = makeEl('div'); ui.id = 'ui';
  const canvas = makeEl('canvas'); canvas.id = 'stage';
  body.appendChild(canvas); body.appendChild(ui);
  const document = {
    body, documentElement: makeEl('html'), visibilityState: 'visible',
    readyState: 'loading',
    getElementById: (id) => (id === 'ui' ? ui : id === 'stage' ? canvas : (queryWalk(body, id) || makeEl('div'))),
    createElement: (tag) => makeEl(tag),
    querySelector: (sel) => (sel === '#ui' ? ui : sel === '#stage' ? canvas : queryWalk(body, sel)),
    querySelectorAll: () => [],
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener() {},
  };
  return {
    document, elements, body,
    fire(name, ev) { for (const fn of listeners[name] || []) fn(ev || {}); },
  };
}

/** 在 vm 里跑 state.js + main.js，返回探针。 */
function loadGame(gameDir, opts) {
  opts = opts || {};
  // 端口：可传函数（服务器后起时用它，fetch 发生的那一刻才取真实端口）；也可传数字
  const getPort = typeof opts.port === 'function' ? opts.port : () => (Number(opts.port) || PORT);
  const store = new Map();
  if (opts.localSave) store.set('ssdz_save_v1', JSON.stringify(opts.localSave));
  const removed = [];
  const dom = fakeDom();
  const pages = [];
  let acc = 0;                       // 压缩计时器的累积小数
  const TIMER_SCALE = Number(process.env.SSDZ_TIMER_SCALE || 0.05);
  const ctx = {
    console, Date, Math, JSON, Number, String, Boolean, Object, Array, Set, Map, WeakMap, Promise, Error, TypeError,
    isFinite, isNaN, parseInt, parseFloat,
    setTimeout: (fn, ms) => {
      // 把游戏里的等待按比例压缩，测试才跑得快；累积小数部分，保证顺序不被打乱。
      acc += (Number(ms) || 0) * TIMER_SCALE;
      const wait = Math.floor(acc);
      acc -= wait;
      return setTimeout(fn, wait);
    },
    clearTimeout, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    fetch: (input, init) => {
      // noServer 之外的场景：端口用「当前正在跑的那个服务器」的端口（每个用例各自 nextPort()）
      if (opts.noServer) return Promise.reject(new TypeError('fetch failed'));
      const url = String(input).startsWith('http') ? String(input) : `http://127.0.0.1:${getPort()}/` + String(input).replace(/^\//, '');
      return fetch(url, init);
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => { store.delete(k); removed.push(k); },
    },
    location: {
      protocol: opts.fileProtocol ? 'file:' : 'http:', search: opts.search || '',
      hostname: '127.0.0.1', get port() { return String(getPort()); }, get href() { return `http://127.0.0.1:${getPort()}/`; },
      reload: () => pages.push('reload'),
    },
    document: dom.document,
    navigator: { userAgent: 'node' },
    performance: { now: () => Date.now() },
    Audio: function () { return { play: () => Promise.resolve(), pause() {}, loop: false, volume: 0 }; },
    Image: function () { return { addEventListener() {}, set src(v) { this._src = v; } }; },
    innerWidth: 1216, innerHeight: 760,
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  // window 上的事件（main.js 的 boot 挂在 window 的 DOMContentLoaded 上）也收集起来
  const windowListeners = {};
  ctx.window.addEventListener = (name, fn) => { (windowListeners[name] = windowListeners[name] || []).push(fn); };
  ctx.window.removeEventListener = () => {};
  ctx.window.confirm = () => true;
  ctx.window.alert = () => {};
  vm.createContext(ctx);

  // 游戏里那些跟存档无关的全局（素材/战斗/界面）给个最小桩，专注测启动存档流程。
  vm.runInContext(`
    window.UI = window.UI || {};
    UI.installFavicon = function () {}; UI.renderNumbers = function () {};
    UI.renderHome = function () {}; UI.drawHomeHud = function () { return []; };
    UI.hitRegion = function () { return null; }; UI.runAction = function () {};
    UI.toast = function (m) { (window.__toasts = window.__toasts || []).push(String(m)); };
    window.Engine = window.Engine || {};
    Engine.loadImage = function () { return Promise.resolve(null); };
    Engine.loadSheets = function () { return Promise.resolve(); };
    Engine.pinSheets = function () {};
    Engine.SHEETS = {}; Engine.makePlayer = function () { return { list: [] }; };
    Engine.updatePlayer = function () {}; Engine.drawPlayer = function () {};
    Engine.playAnim = function () {}; Engine.hasAnim = function () { return false; };
    Engine.text = function () {}; Engine.wearsFor = function () { return {}; };
    window.Battle = window.Battle || { run: function () { return Promise.resolve({}); } };
    window.Sim = window.Sim || {};
  `, ctx, { filename: 'stubs.js' });

  const loadErrors = [];
  for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/main.js']) {
    const file = path.join(ROOT, f);
    if (!fs.existsSync(file)) continue;
    try { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: f }); }
    catch (e) { loadErrors.push(f + ': ' + (e && e.message)); }
  }
  // main.js 的 boot 挂在 DOMContentLoaded 上，这里补触发一次（桩 DOM 不会自己发事件）。
  let bootError = null;
  // main.js 把 boot 挂在 window 的 DOMContentLoaded 上，桩 DOM 不会自己发事件，这里补触发。
  try {
    dom.document.readyState = 'complete';
    dom.fire('DOMContentLoaded');
    for (const fn of windowListeners['DOMContentLoaded'] || []) fn({});
  } catch (e) { bootError = e; }
  return { ctx, store, removed, dom, pages, bootError, loadErrors };
}

/** 递归取元素文本（桩 DOM 的 innerHTML 是原样字符串，这里统一用 textContent 递归）。 */
function textOf(el) {
  if (!el) return '';
  let out = String(el.innerHTML || '') + String(el.textContent || '');
  for (const c of el.children || []) out += textOf(c);
  return out;
}

/** 可选：直接用一份现成的游戏目录（例如「用户真实存档 + 当前代码」的快照）跑启动流程。
 *  设 SSDZ_GAME_ROOT=<目录> 时只跑这一项，用来对真实存档做端到端验证。 */
const EXTERNAL_GAME = process.env.SSDZ_GAME_ROOT || '';

const results = [];
function record(name, fn) { results.push([name, fn]); }

record('磁盘 32 级 + 残留 1 级 localStorage → 必须载入 32 级，并清掉残留档', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  const port = await srv.ready;
  const g = loadGame(game, { localSave: SAVE_LOCAL_1, port: () => PORT });
  await sleep(1200);
  const st = g.ctx.State.state();
  assert.ok(st, '状态应该已载入 | loadErrors=' + JSON.stringify(g.loadErrors) + ' bootErr=' + (g.bootError && g.bootError.message) + ' fileInfo=' + JSON.stringify(g.ctx.State.fileInfo()));
  assert.equal(st.level, 32, '必须载入磁盘上的 32 级存档');
  assert.equal(st.name, 'Charles');
  assert.equal(g.ctx.State.storageMode(), 'file');
  assert.ok(g.removed.includes('ssdz_save_v1'), '读文件成功后就该把残留的兜底档删掉');
  assert.equal(g.dom.document.body.querySelector('#save-warning'), null, '正常情况不该挂告警横幅');
  // 时间基准必须和 fileWrite() 比较的 fileAt 是同一个时钟，否则会出现「永远跳过写入」：
  // 玩家的表现就是「玩了半天，进度没保存」。
  const info = g.ctx.State.fileInfo();
  assert.ok(Math.abs((st.savedAt || 0) - info.fileAt) < 1000,
    'savedAt 必须对齐文件时间（savedAt=' + st.savedAt + ' fileAt=' + info.fileAt + '）');
  // 真的写一次：必须落到磁盘上（复现「存档文件更新，已跳过写入」那个坑）
  st.goldPoint += 7;
  const w = await g.ctx.State.fileWriteNow();
  assert.equal(w.ok, true, '自动保存必须成功：' + JSON.stringify(w));
  const disk = JSON.parse(fs.readFileSync(path.join(game, 'save', 'progress.json'), 'utf8'));
  assert.equal(disk.goldPoint, st.goldPoint, '改动必须写进磁盘存档');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true });
});

record('服务器比页面晚起来（启动器竞态）→ 自动重连后必须回到磁盘 32 级档', async () => {
  const game = makeGameCopy();
  // 页面先开、服务器晚一步才监听；和游戏里的等待一样按比例压缩，保持「竞态」的相对时间不变
  const srv = startServer(game, Math.round(1100 * Number(process.env.SSDZ_TIMER_SCALE || 0.05)), null, true);
  const g = loadGame(game, { localSave: SAVE_LOCAL_1, port: () => PORT });   // 页面先开（服务器还没监听）
  await srv.whenReady();
  await sleep(4000);                              // 等自动重试（300+600+1000+1500+2000+2500+3000ms）走完
  assert.ok(g.pages.includes('reload'), '连上服务器后必须自动重载，回到磁盘存档');
  const st = g.ctx.State.state();
  assert.equal(st && st.level, 32, '重试成功后内存里也该是磁盘的 32 级档');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true });
});

record('读不到磁盘存档（服务器不可用）→ 回落但必须留下可见告警', async () => {
  const game = makeGameCopy();
  const g = loadGame(game, { localSave: SAVE_LOCAL_1, noServer: true });
  await sleep(1500);
  const banner = g.dom.document.body.querySelector('#save-warning');
  assert.ok(banner, '回落时必须有可见告警（不能像以前那样静默）');
  const bannerText = textOf(banner);
  assert.match(bannerText, /save\/progress\.json/, '告警要说清楚磁盘存档没在用');
  assert.match(bannerText, /重试连线/, '告警要给出重试入口');
  const st = g.ctx.State.state();
  assert.equal(st && st.level, 1, '这种极端情况下才允许显示本地兜底档');
  fs.rmSync(game, { recursive: true, force: true });
});

record('页面是 file:// 打开 → 回落但告警指向「请用启动器」', async () => {
  const game = makeGameCopy();
  const g = loadGame(game, { localSave: SAVE_LOCAL_1, fileProtocol: true });
  await sleep(1200);
  const banner = g.dom.document.body.querySelector('#save-warning');
  assert.ok(banner, 'file:// 打开时必须告警');
  const bannerText = textOf(banner);
  assert.match(bannerText, /file:\/\//, '告警要点明 file:// 这个原因');
  assert.match(bannerText, /启动游戏\.command/, '告警要指引用启动器打开');
  fs.rmSync(game, { recursive: true, force: true });
});

record('本地兜底档更新且等级更高 → 必须保留，不许静默删掉', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  const port = await srv.ready;
  const stronger = Object.assign({}, SAVE_32, { level: 40, name: 'Charles', savedAt: Date.now() + 60000 });
  const g = loadGame(game, { localSave: stronger, port: () => PORT });
  await sleep(1200);
  const st = g.ctx.State.state();
  assert.equal(st && st.level, 32, '界面仍以磁盘存档为准（这是主存档）');
  assert.ok(g.store.has('ssdz_save_v1'), '更新且更强的兜底档必须留着，交给冲突保护处理');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true });
});

record('服务器仍有水位线防线：1 级空档不许覆盖 32 级存档文件', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  const port = await srv.ready;
  const res = await fetch(`http://127.0.0.1:${port}/__save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(SAVE_LOCAL_1),
  });
  assert.equal(res.status, 409, '低于水位线的写入必须被拒绝');
  const disk = JSON.parse(fs.readFileSync(path.join(game, 'save', 'progress.json'), 'utf8'));
  assert.equal(disk.level, 32, '磁盘存档不能被 1 级空档覆盖');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true });
});

if (EXTERNAL_GAME) {
  results.length = 0;
  record('真实存档快照：残留 1 级兜底档时，必须载入磁盘上的存档', async () => {
    const before = JSON.parse(fs.readFileSync(path.join(EXTERNAL_GAME, 'save', 'progress.json'), 'utf8'));
    const srv = startServer(EXTERNAL_GAME, 0, await freePort());
    const port = await srv.ready;
    const g = loadGame(EXTERNAL_GAME, { localSave: SAVE_LOCAL_1, port: () => PORT });
    await sleep(1200);
    const st = g.ctx.State.state();
    assert.ok(st, '状态应该已载入');
    assert.equal(st.level, before.level, '必须载入磁盘存档的等级（' + before.level + '）');
    assert.equal(st.name, before.name);
    assert.equal(g.ctx.State.storageMode(), 'file');
    assert.equal(g.dom.document.body.querySelector('#save-warning'), null, '不该挂告警横幅');
    const after = JSON.parse(fs.readFileSync(path.join(EXTERNAL_GAME, 'save', 'progress.json'), 'utf8'));
    assert.equal(after.level, before.level, '磁盘存档不能被改动');
    assert.equal(after.name, before.name);
    srv.kill();
  });
}

record('导入本地存档的服务器契约：先备份 → force 写回 → meta 等级跟着变', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  const port = await srv.ready;
  const savePath = path.join(game, 'save', 'progress.json');

  // ① 导入前先备份（/__save/backup，游戏内「导入存档」第一步就调它）
  const b = await (await fetch(`http://127.0.0.1:${port}/__save/backup`, { method: 'POST' })).json();
  assert.equal(b.ok, true, '备份接口应该成功');
  assert.ok(b.backup && /^save\/backup\/progress-\d{8}-\d{6}\.json$/.test(b.backup), '备份路径要落在 save/backup/：' + b.backup);
  assert.ok(fs.existsSync(path.join(game, b.backup)), '备份文件要真的存在');
  assert.equal(JSON.parse(fs.readFileSync(path.join(game, b.backup), 'utf8')).level, 32, '备份的应该是当前的 32 级档');

  // ② meta 要带上等级与水位线（导入前确认提示要用）
  const meta = await (await fetch(`http://127.0.0.1:${port}/__save?meta=1`)).json();
  assert.equal(meta.level, 32, 'meta 要报出当前档等级');
  assert.equal(meta.minLevel, 32, 'meta 要报出水位线');

  // ③ force 写回一份 40 级档（模拟玩家导入自己的存档）
  const imported = Object.assign({}, SAVE_32, { level: 40, name: 'Charles' });
  const w = await fetch(`http://127.0.0.1:${port}/__save?force=1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(imported),
  });
  const wj = await w.json();
  assert.equal(w.status, 200, 'force 导入应该被接受');
  assert.equal(wj.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(savePath, 'utf8')).level, 40, '磁盘上应该变成导入的 40 级');

  // ④ 不允许空档悄悄覆盖（没有 force 时仍然是 409）
  const bad = await fetch(`http://127.0.0.1:${port}/__save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(SAVE_LOCAL_1),
  });
  assert.equal(bad.status, 409, '无 force 的低等级写入必须被水位线拦下');
  assert.equal(JSON.parse(fs.readFileSync(savePath, 'utf8')).level, 40, '文件不能被空档覆盖');

  // ⑤ 脏数据（不是 JSON / 不是存档对象）不许写进正式存档
  const junk = await fetch(`http://127.0.0.1:${port}/__save?force=1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not-json-at-all',
  });
  assert.equal(junk.status, 400, '非 JSON 必须被拒');
  const notSave = await fetch(`http://127.0.0.1:${port}/__save?force=1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1,2,3]',
  });
  assert.equal(notSave.status, 400, '数组不是存档对象，必须被拒');
  assert.equal(JSON.parse(fs.readFileSync(savePath, 'utf8')).level, 40, '脏数据不能改动正式存档');

  srv.kill();
  fs.rmSync(game, { recursive: true, force: true });
});

record('导入建档时的校验：合法存档放行、脏数据拦下', async () => {
  // 直接从 js/classic-ui.js 里抠出真实的 saveDataError（不复制一份实现，避免测试和代码走偏）
  const src = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8');
  const start = src.indexOf('function saveDataError');
  assert.ok(start > 0, 'classic-ui.js 里应该有 saveDataError');
  const end = src.indexOf('\n  }', start);
  const fnSrc = src.slice(start, end + 4);
  const ctx = vm.createContext({ Number, Array, Object, String });
  const check = vm.runInContext(fnSrc + '\nsaveDataError;', ctx, { filename: 'saveDataError.js' });

  assert.equal(check(SAVE_32), '', '真实存档必须放行');
  assert.equal(check(JSON.parse(fs.readFileSync(path.join(ROOT, 'save', 'progress.json'), 'utf8'))), '',
    '用户磁盘上那份 32 级存档也必须放行');
  assert.ok(check({}), '空对象要拦下');
  assert.ok(check([1, 2]), '数组要拦下');
  assert.ok(check({ name: 'x', level: 5, weapons: [], props: {} }), '缺 skills 要拦下');
  assert.ok(check({ name: '', level: 5, weapons: [], skills: [], props: {} }), '空名字要拦下');
  assert.ok(check({ name: 'x', level: 'abc', weapons: [], skills: [], props: {} }), '等级不是数字要拦下');
  assert.ok(check({ name: 'x', level: 5, weapons: [], skills: [], props: [] }), 'props 是数组要拦下');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of results) {
    try {
      await fn();
      console.log('PASS ' + name);
    } catch (e) {
      failed++;
      console.log('FAIL ' + name + ' | ' + (e && e.message));
      if (process.env.SSDZ_VERBOSE) console.log(e && e.stack);
    }
  }
  console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${results.length} 项）`);
  process.exit(failed ? 1 : 0);
})();
