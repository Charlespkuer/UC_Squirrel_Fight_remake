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
function makeGameCopy(save, minLevel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssdz-boot-'));
  for (const d of ['js', 'css']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'save'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'index.html'), path.join(dir, 'scripts', 'index.html'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'serve.js'), path.join(dir, 'scripts', 'serve.js'));
  fs.writeFileSync(path.join(dir, 'save', 'progress.json'), JSON.stringify(save || SAVE_32));
  fs.writeFileSync(path.join(dir, 'save', '.min-level'), String(minLevel == null ? 32 : minLevel));
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
  if (opts.localBase != null) store.set('ssdz_save_v1_base', String(opts.localBase));
  if (opts.uiMode) store.set('ssdz_ui_mode', String(opts.uiMode));
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
    Engine.loadSheets = function () { return ${opts.slowLoad ? 'new Promise(function (r) { setTimeout(r, 2000); })' : 'Promise.resolve()'}; };
    Engine.pinSheets = function () {};
    Engine.SHEETS = {}; Engine.makePlayer = function () { return { list: [] }; };
    Engine.updatePlayer = function () {}; Engine.drawPlayer = function () {};
    Engine.playAnim = function () {}; Engine.hasAnim = function () { return false; };
    Engine.text = function () {}; Engine.wearsFor = function () { return {}; };
    window.Battle = window.Battle || { run: function () { return Promise.resolve({}); } };
    window.Sim = window.Sim || {};
  `, ctx, { filename: 'stubs.js' });

  const loadErrors = [];
  for (const f of ['js/gamedict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/main.js']) {
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
  return {
    ctx, store, removed, dom, pages, bootError, loadErrors,
    /** 触发 window 上的事件（桩 DOM 不会自己派发；安卓桥接就绪事件测试用）。 */
    dispatchWindow(name, detail) {
      for (const fn of windowListeners[name] || []) fn({ type: name, detail });
    },
  };
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
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
});

/* 这批的启动优化：经典界面的战斗走 `SfFight`（SVG），现代 canvas 战斗那 80 多张图
 *（约 27 MB）不该再拖住首屏。以前 boot 里 `race(battleLoad, 2500ms)`，素材越多首屏越慢；
 * 现在只有现代界面会在首页挂好后空闲补拉，经典界面直接跳过。 */
record('经典界面启动不预热 canvas 战斗图集（现代战斗专用，约 27 MB）', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  await srv.ready;
  const g = loadGame(game, { port: () => PORT, uiMode: 'classic' });
  await sleep(1200);
  assert.equal(g.ctx.Main.battleAssetsReady(), false,
    '经典模式启动时不该拉 canvas 战斗图集（由 Main.preloadBattleAssets 显式触发）');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
});

record('启动中桥接就绪事件 → 不许把页面刷成 reload 循环（安卓每次启动都会发）', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  await srv.ready;
  /* 素材加载放慢：模拟安卓第一次进游戏要拉几秒图集。旧代码在这个窗口里收到
   * ssdz-save-transport-ready 就会 retryFileSave → 读档成功 → reload；新页面又在素材
   * 加载阶段收到同一个事件 → 每 0.8 秒刷一次，启动进度永远停在 25%（模拟器实测）。 */
  const g = loadGame(game, { port: () => PORT, slowLoad: true });
  g.dispatchWindow('ssdz-save-transport-ready');
  await sleep(1200);
  assert.equal(g.pages.filter((p) => p === 'reload').length, 0,
    '启动中的桥接就绪事件不该触发 reload');
  const st = g.ctx.State.state();
  assert.equal(st && st.level, 32, '素材加载完仍要载入磁盘 32 级档');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
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
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
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
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
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
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
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
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
});

record('服务器仍有水位线防线：1 级空档不许覆盖 32 级存档文件', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  const port = await srv.ready;
  const res = await fetch(`http://127.0.0.1:${port}/__save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(SAVE_LOCAL_1),
  });
  assert.equal(res.status, 409, '低于水位线的写入必须被拒绝');
  /* 只拦 1 级空档不够：初始档玩到 2 级同样不能盖掉 32 级正式档。 */
  const lv2 = Object.assign({}, SAVE_LOCAL_1, { level: 2, allWins: 1, name: '旧档' });
  const res2 = await fetch(`http://127.0.0.1:${port}/__save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lv2),
  });
  assert.equal(res2.status, 409, '2 级旧档也不许覆盖 32 级正式档');
  const disk = JSON.parse(fs.readFileSync(path.join(game, 'save', 'progress.json'), 'utf8'));
  assert.equal(disk.level, 32, '磁盘存档不能被 1 级/2 级旧档覆盖');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
});

record('换包后当前槽是 1 级空档：自动载入另一槽的进度，不能停在 1 级新档', async () => {
  /* 复现用户口径「存档在初始档与有进度的档之间横跳」：
   * 最后一次保存的顶层是「现代 1 级」（初始档被写回顶层），经典 40 级在 __dualOther；
   * 换包后 localStorage 偏好仍是 modern，旧逻辑就会停在现代 1 级；下一次启动
   * 偏好变化又按 classic 读回 40 级。现在当前槽是空档、另一槽有进度时直接救回 40 级。 */
  const dual = {
    name: '现代新号', level: 1, exp: 0, power: 5, agility: 4, speed: 5, maxHp: 40,
    energy: 90, maxEnergy: 90, goldPoint: 100, weapons: [], skills: [], props: { 1: 3 },
    settings: { volume: 1, muted: false, resolution: 'auto', fullscreen: false, uiMode: 'modern' },
    savedAt: Date.now(), __dualOther: {
      name: '经典老号', level: 40, exp: 0, power: 60, agility: 50, speed: 50, maxHp: 500,
      energy: 90, maxEnergy: 90, goldPoint: 500, weapons: [], skills: [], props: { 1: 3 },
      settings: { volume: 1, muted: false, resolution: 'auto', fullscreen: false, uiMode: 'classic' },
      savedAt: Date.now(),
    },
  };
  const game = makeGameCopy(dual, 40);
  const srv = startServer(game);
  const port = await srv.ready;
  const g = loadGame(game, { uiMode: 'modern', port: () => PORT });
  await sleep(1200);
  const st = g.ctx.State.state();
  assert.ok(st, '必须载入一份可玩的进度');
  assert.equal(st.level, 40, '当前槽是 1 级空档时要自动用另一槽的 40 级档');
  assert.equal(st.name, '经典老号');
  assert.equal(g.store.get('ssdz_ui_mode'), 'classic', '自动认领后要把界面偏好写回，下一次启动不再跳');
  assert.equal(g.pages.filter((p) => p === 'reload').length, 0, '不该靠 reload 掩盖');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
});

record('转生降回 1 级后还能继续存 2 级：水位线不能把合法降级误拦', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  await srv.ready;
  const g = loadGame(game, { port: () => PORT });
  await sleep(1200);
  const st = g.ctx.State.state();
  assert.equal(st.level, 32);
  st.level = 1; st.reborn = 1; st.allWins = 120;
  g.ctx.State.save();
  await sleep(500);
  let disk = JSON.parse(fs.readFileSync(path.join(game, 'save', 'progress.json'), 'utf8'));
  assert.equal(disk.level, 1, '转生档必须能写回 1 级');
  assert.equal(disk.reborn, 1);
  st.level = 2; st.exp = 1;
  g.ctx.State.save();
  await sleep(500);
  disk = JSON.parse(fs.readFileSync(path.join(game, 'save', 'progress.json'), 'utf8'));
  assert.equal(disk.level, 2, '转生后继续升级必须能存（不能被旧 32 级水位线挡住）');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
});

record('换包后旧单槽档与界面偏好不一致：仍要载入进度，不能变成标题/新开局', async () => {
  /* 旧版只有单槽存档时，settings.uiMode 可能写的是 modern，而 localStorage 已经是 classic。
   * 旧逻辑会把这份唯一的进度塞进 otherSlot、S=null → 标题页；下一次启动又读回 32 级。 */
  const legacy = Object.assign({}, SAVE_32, {
    settings: { volume: 1, muted: false, resolution: 'auto', fullscreen: false, uiMode: 'modern' },
  });
  const game = makeGameCopy(legacy, 32);
  const srv = startServer(game);
  const port = await srv.ready;
  const g = loadGame(game, { uiMode: 'modern', port: () => PORT });
  await sleep(1200);
  const st = g.ctx.State.state();
  assert.ok(st, '旧单槽档必须被载入');
  assert.equal(st.level, 32, '不能因为界面偏好不同就把 32 级旧档藏起来');
  assert.equal(st.name, 'Charles');
  assert.equal(g.pages.filter((p) => p === 'reload').length, 0);
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
});

record('换包后桥接迟到：浏览器里的初始档/2 级旧档不许写回覆盖磁盘 32 级档', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  const port = await srv.ready;
  const g = loadGame(game, { localSave: SAVE_LOCAL_1, port: () => PORT });
  await sleep(1200);
  assert.equal(g.ctx.State.state().level, 32, '先载入磁盘正式档');
  /* 模拟桥接迟到时页面已经按 1 级兜底档开了新局，打了半场升到 2 级，随后自动保存。
   * 只拦「1 级空档」是不够的：2 级旧档同样不能盖掉 32 级正式档。 */
  g.ctx.State.newGame('初始试探');
  g.ctx.State.state().level = 2;
  g.ctx.State.state().allWins = 1;
  const r = await g.ctx.State.fileWrite();
  assert.equal(r.ok, false, '文件里已有 32 级进度时，2 级旧档也必须被拒绝');
  assert.match(String(r.msg), /已有进度|没有覆盖|已有 32 级|2 级旧档/, '拒绝原因要能看懂：' + r.msg);
  await sleep(300);
  const disk = JSON.parse(fs.readFileSync(path.join(game, 'save', 'progress.json'), 'utf8'));
  assert.equal(disk.level, 32, '磁盘正式档不能被初始档覆盖');
  assert.equal(disk.name, 'Charles');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
});

record('调试面板彻底重置是唯一允许把 1 级档写回去的路径', async () => {
  const game = makeGameCopy();
  const srv = startServer(game);
  await srv.ready;
  const g = loadGame(game, { port: () => PORT });
  await sleep(1200);
  g.ctx.State.newGame('重置鼠', { force: true });
  await sleep(300);
  const disk = JSON.parse(fs.readFileSync(path.join(game, 'save', 'progress.json'), 'utf8'));
  assert.equal(disk.level, 1, '显式重置应该真的落盘');
  assert.equal(disk.name, '重置鼠');
  srv.kill();
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
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
  assert.equal(meta.maxLevel, 32, 'meta 要报出双槽最高等级（1 级空档保护用它）');

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

  // ⑥ 双界面存档：当前界面 1 级、另一槽 40 级，水位线必须看两槽最高等级，允许写入
  const dualLow = Object.assign({}, SAVE_LOCAL_1, {
    name: '现代新号', level: 1,
    __dualMode: 'modern', __dualOther: { name: '经典40', level: 40, weapons: [], skills: [], props: {} },
  });
  const dualRes = await fetch(`http://127.0.0.1:${port}/__save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dualLow),
  });
  assert.equal(dualRes.status, 200, '另一界面有 40 级进度时，当前 1 级档不能被水位线误拦');
  const dualDisk = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  assert.equal(dualDisk.level, 1, '顶层保存当前界面的 1 级');
  assert.equal(dualDisk.__dualOther.level, 40, '另一界面 40 级要一起落盘');

  srv.kill();
  fs.rmSync(game, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
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
  /* 本机运行时的那份存档（save/ 不进仓库，CI / 新机器上不存在）：有就一并验一遍。
   * 这里**不能硬读**，否则干净的检出直接 ENOENT —— 「本机绿、CI 红」的典型坑。 */
  const realSave = path.join(ROOT, 'save', 'progress.json');
  if (fs.existsSync(realSave)) {
    assert.equal(check(JSON.parse(fs.readFileSync(realSave, 'utf8'))), '',
      '用户磁盘上那份 32 级存档也必须放行');
  }
  assert.ok(check({}), '空对象要拦下');
  assert.ok(check([1, 2]), '数组要拦下');
  assert.ok(check({ name: 'x', level: 5, weapons: [], props: {} }), '缺 skills 要拦下');
  assert.ok(check({ name: '', level: 5, weapons: [], skills: [], props: {} }), '空名字要拦下');
  assert.ok(check({ name: 'x', level: 'abc', weapons: [], skills: [], props: {} }), '等级不是数字要拦下');
  assert.ok(check({ name: 'x', level: 5, weapons: [], skills: [], props: [] }), 'props 是数组要拦下');
});

record('导入存档：先载入内存、写后核对，失败能回滚', () => {
  /* 直接跑真实的 js/state.js：导入不再只是「把原文塞进存储」，
   * 而是先在内存里按双槽规则载入、生成规范化正文，写盘后再核对当前槽位。
   * 这一步锁住「提示成功、实际还是旧档」的假成功。 */
  const storage = new Map();
  const ctx = {
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    console, Date, Math, setTimeout, clearTimeout,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/gamedict.js', 'js/gamedata.js', 'js/state.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const S = ctx.State;
  S.newGame('旧档玩家');
  S.state().level = 12;
  S.save();
  const before = S.exportPayload();
  const imported = JSON.parse(before);
  imported.name = '导入测试';
  imported.level = 40;
  imported.exp = 1234;
  const prep = S.prepareImport(JSON.stringify(imported));
  assert.ok(prep.ok, '合法存档要能准备导入：' + (prep && prep.msg));
  assert.equal(S.state().name, '导入测试', '导入后内存里应是新档');
  assert.equal(S.state().level, 40, '导入后内存等级应是 40');
  assert.ok(S.verifyImport(prep), '写后核对：名字和等级必须与载入的一致');
  assert.equal(JSON.parse(prep.payload).level, 40, '写盘正文应是规范化后的 40 级档');
  const bad = S.prepareImport('{bad json');
  assert.equal(bad.ok, false, '坏 JSON 必须拒绝');
  assert.equal(S.state().level, 40, '坏 JSON 不能改内存');
  assert.ok(S.restorePayload(before), '回滚快照要能重新载入');
  assert.equal(S.state().level, 12, '回滚后应回到旧档');
});

record('安卓导入：文件选择器不能只认 application/json', () => {
  /* 微信/QQ/部分 OEM 文件管理器把导出的 .json 标成 text/plain 或 application/octet-stream；
   * `<input accept>` 只写 .json,application/json 时这些文件在选择器里不显示，表现就是
   * “导出成功但导入选不到文件”。这里锁住放宽后的白名单。 */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const m = src.match(/input\.accept\s*=\s*'([^']+)'/);
  assert.ok(m, 'classic-ui.js 的 pickJsonFile 要设置 input.accept');
  for (const mime of ['application/json', 'text/plain', 'application/octet-stream']) {
    assert.ok(m[1].includes(mime), '文件选择器要接受 ' + mime);
  }
});

record('桌面导出存档：安装版走 export_save 命令，便携轻壳走 /__export', async () => {
  const rust = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/fn export_save\(app: tauri::AppHandle, file_name: String, data: String\)/.test(rust),
    '安装版必须注册 export_save 命令（iOS 还要拿到 AppHandle 定位 Documents）');
  assert.ok(/path == "\/__export"/.test(rust) && /dirs::download_dir\(\)/.test(rust),
    '便携轻壳必须有 /__export 且写系统下载目录（dirs::download_dir）');
  assert.ok(/async function nativeSave\(/.test(cu) &&
    /invoke\('export_save', \{ fileName, data: text \}\)/.test(cu),
    '前端要优先调 export_save，失败再退回 Blob');
});

record('iOS 导出存档：Documents / 文件 App / 粘贴兜底', () => {
  /* iOS 不能像桌面那样写系统「下载」目录，也不能赌 WKWebView 的 `<a download>`。
   * 约定：Rust 把存档写进 App 的 Documents，Info.plist 打开文件共享；
   * 前端给出「文件」App 路径，并在失败时提供系统分享 / 复制全文；
   * 导入除文件选择器外，还必须有粘贴文本的保底入口。 */
  const rust = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const plist = fs.readFileSync(path.join(ROOT, 'src-tauri', 'Info.ios.plist'), 'utf8');
  assert.ok(/fn export_to_documents\(app: &tauri::AppHandle/.test(rust) &&
    /document_dir\(\)/.test(rust) && /\"display\": format!\(\"「文件」App/.test(rust),
    'iOS 导出要写 App 的 Documents，并返回「文件」App 的可读路径');
  assert.ok(/<key>UIFileSharingEnabled<\/key>\s*<true\/>/.test(plist) &&
    /<key>LSSupportsOpeningDocumentsInPlace<\/key>\s*<true\/>/.test(plist),
    'Info.ios.plist 要让 Documents 在「文件」App 可见');
  assert.ok(/function iosClient\(/.test(cu) && /function showIOSExportDone\(/.test(cu) &&
    /function shareSaveFile\(/.test(cu) && /function copySaveText\(/.test(cu) &&
    /function importSaveFromPaste\(/.test(cu),
    '前端要有 iOS 导出提示 / 分享 / 复制，以及粘贴导入兜底');
  /* iOS 16~24 的 WKWebView 没有系统文件选择面板（wry 只在 macOS 实现 runOpenPanel）。
   * 导入必须能原生列出 App 的 Documents 并读回，不能只靠 <input type=file>。 */
  assert.ok(/fn list_save_files\(/.test(rust) && /fn read_save_file\(/.test(rust) &&
    /fn safe_import_name\(/.test(rust) && /document_dir\(\)/.test(rust),
    'iOS 导入要有原生 list_save_files / read_save_file，并限制在 Documents 内的 .json');
  assert.ok(/function openIOSExportList\(/.test(cu) && /invoke\('list_save_files'\)/.test(cu) &&
    /invoke\('read_save_file', \{ name: it\.file \}\)/.test(cu),
    'iOS 导入页要能列出并读取 App 导出的存档');
  assert.ok(/State\.prepareImport/.test(cu) && /State\.verifyImport/.test(cu) &&
    /restoreImportedSave\(beforeRaw, info\)/.test(cu),
    '导入必须先载入内存、写后核对，并在失败时回滚旧档（不能假成功）');
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
