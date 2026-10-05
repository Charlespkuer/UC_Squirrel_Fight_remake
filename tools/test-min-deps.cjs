#!/usr/bin/env node
/* ============================================================
 * tools/test-min-deps.cjs — 「最小依赖」回归：运行时不依赖 references/
 *
 * 目标（实测过好几次被破坏）：游戏跑起来只认 js/ 下的东西；
 * references/ 是参考素材目录，游戏过程中**一个字节都不该从那里读**。
 *
 * 这个测试检查四件事：
 *   1) 入口页 scripts/index.html 不加载 references/ 里的任何文件；
 *   2) js/*.js 里没有「运行时会读 references/」的代码（注释里提到不算）；
 *   3) js/gamedict.js 存在，且能提供游戏需要的全部原版数据全局；
 *   4) js/gamedict.js 与 references/orig/ 抽取出来的结果一致（generator --check）。
 *
 * 用法：node tools/test-min-deps.cjs
 * ============================================================ */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

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
const results = [];
function record(name, fn) { results.push([name, fn]); }

/** 去掉注释后的代码（注释里提 references/ 是允许的，那只是文档） */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

record('入口页不加载 references/ 里的任何文件', () => {
  const html = fs.readFileSync(path.join(ROOT, 'scripts', 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const bad = refs.filter((r) => /(^|\/)references\//.test(r));
  assert.equal(bad.length, 0, '入口页不该引用 references/：' + bad.join(', '));
  assert.ok(refs.some((r) => r === 'js/gamedict.js'), '入口页应该加载 js/gamedict.js');
  assert.ok(!refs.some((r) => /js\/orig\//.test(r)), '入口页不该再加载 js/orig/');
});

record('js/*.js 的代码里没有指向 references/ 的运行时读取', () => {
  const offenders = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
    if (!f.endsWith('.js')) continue;
    const code = stripComments(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
    // 只揪「当成路径用」的写法：字符串里出现 references/ 且不在注释里
    for (const m of code.matchAll(/['"`][^'"`]*references\/[^'"`]*['"`]/g)) {
      offenders.push(f + ': ' + m[0].slice(0, 80));
    }
  }
  assert.equal(offenders.length, 0, '运行时不该读 references/：\n  ' + offenders.join('\n  '));
});

record('js/gamedict.js 能提供游戏需要的全部原版数据', () => {
  const file = path.join(ROOT, 'js', 'gamedict.js');
  assert.ok(fs.existsSync(file), 'js/gamedict.js 不存在（请运行 node tools/gen-vendor-data.cjs）');
  const ctx = { window: null, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'js/gamedict.js' });
  const dicts = ['weaponsMap', 'skillsMap', 'propMap', 'gearMap', 'gearSetMap', 'upgradeMap', 'npcsMap', 'attachmentMap', 'rankgoodsMap', 'giftMap'];
  for (const name of dicts) {
    const d = ctx[name];
    assert.ok(d && typeof d.getValue === 'function', name + ' 缺失或不是字典');
    assert.ok(d.keys.length > 0, name + ' 是空的');
    // 每条都要能读成对象（字段齐全、带 source）
    for (const k of d.keys.slice(0, 5)) {
      const v = d.getValue(k);
      assert.ok(v && typeof v === 'object' && Array.isArray(v.source), name + '[' + k + '] 读出来不对');
    }
  }
  // imgMap：图集帧表（引擎查每帧坐标用；漏了它主界面小人就画不出来 —— 实际漏过一次）
  const imgMap = ctx.imgMap;
  assert.ok(imgMap && typeof imgMap.getValue === 'function', 'imgMap 图集帧表缺失（小人/画面会画不出来）');
  assert.ok(imgMap.keys.length > 300, 'imgMap 条目太少：' + imgMap.keys.length);
  for (const id of ['SQ_01', 'SQ_02', 'main_e1']) {
    const frames = imgMap.getValue(id);
    assert.ok(Array.isArray(frames) && frames.length > 0, 'imgMap 里缺少 ' + id + ' 的帧表');
    assert.ok(frames.every((f) => Array.isArray(f) && f.length >= 7), id + ' 的帧记录格式不对（应为 [标签,x,y,w,h,regX,regY]）');
  }
  assert.ok(Array.isArray(ctx.asstes) && ctx.asstes.length > 50, 'asstes 素材清单缺失');
  /* asset_* 路径表：engine.js 的 buildSrcMap() 是**动态**遍历 window 上 `asset` 前缀的数组来收路径的
   * （三侠 tl/xh/xm、木人、新手礼包、logo 全在这里）。这类数据 grep 变量名是扫不到的，
   * 漏掉的表现就是「整只怪/整个模型画不出来」。 */
  const assetGroups = Object.keys(ctx).filter((k) => /^asset/.test(k) && Array.isArray(ctx[k]));
  assert.ok(assetGroups.length >= 10, 'asset_* 路径表数量太少：' + assetGroups.length);
  const assetIds = new Set();
  for (const name of assetGroups) for (const a of ctx[name]) if (a && a.id) assetIds.add(a.id);
  assert.ok(assetIds.size > 50, 'asset_* 路径表里的条目太少：' + assetIds.size);
  for (const id of ['tl', 'xh1', 'xh2', 'xm1', 'xm2', 'woodman1', 'woodman2', 'fightBg']) {
    assert.ok(assetIds.has(id), 'asset_* 路径表缺少 ' + id + '（该模型会加载不出来）');
  }
  assert.ok(ctx.asstes.every((a) => a && a.id && typeof a.src === 'string'), 'asstes 条目要带 id/src');
  assert.ok(ctx.AnimationStr && Object.keys(ctx.AnimationStr).length > 100, 'AnimationStr 动画帧表缺失');
  assert.equal(typeof ctx.Map, 'undefined', 'gamedict.js 不该定义全局 Map（原版 Map.min.js 会覆盖原生 Map，是坑）');
  assert.equal(typeof Map, 'function', '原生 Map 必须还在');
  assert.equal(typeof Set, 'function', '原生 Set 必须还在');
});

record('存档列表弹窗：一列紧凑可滚动，不再横排按钮溢出屏幕', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8');
  // 取 saveListRow 的实现来跑（不复制一份，避免测试和代码走偏）
  const start = ui.indexOf('function saveListRow');
  assert.ok(start > 0, 'classic-ui.js 里应该还有 saveListRow');
  const end = ui.indexOf('\n  }', start);
  const rowSrc = ui.slice(start, end + 4);
  const ctx = vm.createContext({
    esc: (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    ssdzSizeText: () => '156 KB',
    ssdzWhenText: () => '今天 15:20',
    Date,
    Math,
  });
  const row = vm.runInContext(rowSrc + '\nsaveListRow;', ctx, { filename: 'saveListRow.js' });
  const html = row({ rel: 'save/progress.json', level: 32, name: 'Charles', size: 159820, at: Date.now(), kind: 'current' }, 0);
  // 关键点：等级、名字、时间/大小、载入按钮各占一个格子，名字超长也不会把行撑破
  assert.match(html, /^<div class="save-row current">/, '当前存档那行要有 current 标记');
  assert.match(html, /class="save-level">32<i>级<\/i>/, '等级要单独成徽章');
  assert.match(html, /<span class="save-name">Charles<em>当前<\/em><\/span>/, '名字单独一格，当前档要标注');
  assert.match(html, /<span class="save-sub">今天 15:20 · 156 KB<\/span>/, '时间与大小放次要行');
  assert.match(html, /data-save-row="0"[^>]*>载入<\/button>/, '每行一个「载入」按钮');
  assert.ok(!/【32级/.test(html), '不该再出现「【32级 …】」这种长按钮文案');

  // CSS：必须是竖向列表 + 定宽列 + 溢出省略
  const css = fs.readFileSync(path.join(ROOT, 'css', 'classic-refine.css'), 'utf8');
  assert.match(css, /\.save-list\{[^}]*flex-direction:column/, '列表必须竖排（flex-direction:column）');
  assert.match(css, /\.save-row\{[^}]*grid-template-columns:74px minmax\(0,1fr\)/, '行要用定宽列 + 可压缩的名字列');
  assert.match(css, /\.save-name\{[^}]*text-overflow:ellipsis/, '名字过长要省略，不能撑破行');
  assert.match(css, /save-list-dialog[^{]*\{[^}]*width:820px/, '弹窗有专用宽度');
});

record('动画播放链路：图集帧表 + 动画的每个图元都能解析到帧', () => {
  // 按真实入口顺序加载（含 engine.js），用假 canvas 跑一遍「主界面奔跑小人」的动画
  const warns = [];
  const ctx = {
    window: null, console: { warn: (m) => warns.push(String(m)), log() {}, error() {} }, Set, Map, Promise,
    Image: function () {
      this.width = 256; this.height = 256; this.naturalWidth = 256;
      Object.defineProperty(this, 'src', {
        set(v) { this._src = v; const self = this; setTimeout(() => { if (self.onload) self.onload(); }, 0); },
        get() { return this._src; },
        configurable: true,
      });
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { protocol: 'http:', search: '', hostname: '127.0.0.1', port: '8080' },
    navigator: { userAgent: 'node' },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  ctx.window = ctx; ctx.self = ctx; ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  for (const f of ['js/gamedict.js', 'js/engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const E = ctx.Engine;
  assert.ok(E && typeof E.loadSheets === 'function', 'engine.js 没加载成功');

  // 主界面小人用的三个走路动作（main.js 里按优先级挑一个）
  const walkName = ['mainWalk1', 'mainWalk2', 'mainWalk3'].find((n) => E.hasAnim(n));
  assert.ok(walkName, 'engine 认不出任何 mainWalk 动作（动画帧表没接上）');

  return E.loadSheets(['SQ_01', 'SQ_02', 'main_e1', 'main_e2', 'main_e3']).then(() => {
    const player = E.makePlayer();
    assert.ok(E.playAnim(player, walkName, { loop: true, fps: 22, layer: 2, sheets: ['SQ_01', 'SQ_02'] }), '走路动画没能注册到播放器上');

    // 逐个动画逐个图元验证：能不能解析到图集帧（解析不到 = 画面上就是缺块/整只不见）
    // 只查「用已加载图集就能画出来」的动画：openLogo 需要 logo 图集，不在这里加载
    const names = ['mainWalk1', 'mainWalk1_e', 'mainWalk2', 'mainWalk3', 'standby']
      .filter((n) => E.hasAnim(n));
    assert.ok(names.length >= 4, '可用的动画名字太少，帧表可能没加载全：' + names.join(','));
    const missing = [];
    let checked = 0;
    for (const name of names) {
      const raw = String(ctx.AnimationStr[name]);
      for (const label of new Set(raw.split(':')[0].split('|').map((e) => e.split(',')[0].trim()))) {
        if (label === '75' || Number(label) > 1000) continue;   // 占位点/武器替身槽不算
        checked++;
        if (!E.spriteFor(label)) missing.push(name + ':' + label);
      }
    }
    assert.ok(checked > 5, '没检查到几个图元，测试本身可能失效');
    assert.equal(missing.length, 0, '这些图元解析不到图集帧（画面会缺块）：' + missing.slice(0, 10).join(', '));

    const imgFails = warns.filter((w) => /img-fail|no-anim/.test(w));
    assert.equal(imgFails.length, 0, '引擎报了素材/动画缺失：' + imgFails.slice(0, 5).join('; '));
  });
});

record('战斗图集与动画：三侠/木人/场景/我方，路径与每一帧都能解析', () => {
  const warns = [];
  const ctx = {
    window: null, console: { warn: (m) => warns.push(String(m)), log() {}, error() {} }, Set, Map, Promise,
    Image: function () {
      this.width = 512; this.height = 512; this.naturalWidth = 512;
      Object.defineProperty(this, 'src', {
        set(v) { this._src = v; const self = this; setTimeout(() => { if (self.onload) self.onload(); }, 0); },
        get() { return this._src; }, configurable: true,
      });
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { protocol: 'http:', search: '', hostname: '127.0.0.1', port: '8080' },
    navigator: { userAgent: 'node' },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  ctx.window = ctx; ctx.self = ctx; ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  for (const f of ['js/gamedict.js', 'js/engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const E = ctx.Engine;
  const battleSrc = fs.readFileSync(path.join(ROOT, 'js', 'battle.js'), 'utf8');

  // 直接从 battle.js 读真实配置，避免测试和代码走偏
  const SRC = /const NPC_SHEETS = \{([^}]*)\}/.exec(battleSrc);
  const EFF = /const NPC_EFFECTS = \{([^}]*)\}/.exec(battleSrc);
  assert.ok(SRC && EFF, 'battle.js 里应该有 NPC_SHEETS / NPC_EFFECTS');
  const parseMap = (text) => Object.fromEntries([...text.matchAll(/(\w+):\s*\[([^\]]*)\]/g)]
    .map((m) => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])]));
  const npcSheets = parseMap(SRC[1]);
  const npcEffects = parseMap(EFF[1]);
  assert.ok(Object.keys(npcSheets).length >= 4, '三侠 + 木人的图集配置不该这么少');

  // 场景图元：battle.js 的 REGIONS（水上人家/fightBg 等）
  const regionIds = [...new Set([...battleSrc.matchAll(/\{ id: '([A-Za-z0-9_]+)'/g)].map((m) => m[1]))];
  const needed = [...new Set([].concat(...Object.values(npcSheets), ...Object.values(npcEffects), regionIds))];

  /* ① 每个图集都要能定位到图片文件。
   * 两条合法路径：清单里有（SRC_MAP），或者 battle.js 的兜底 images/<id>.png
   * （场景图元 fightBg_seaWorld_front 就是原版清单里没有、靠兜底加载的）。 */
  const pathOf = (id) => E.SRC_MAP[id] || (fs.existsSync(path.join(ROOT, 'images', id + '.png')) ? 'images/' + id + '.png' : '');
  const noPath = needed.filter((id) => !pathOf(id) && !/^(Head|Hand|Body|Arm|Foot)_/.test(id));
  assert.equal(noPath.length, 0, '这些图集既不在清单里、也没有 images/<id>.png（模型会画不出来）：' + noPath.join(', '));
  // ② 路径指向的文件必须真的存在（避免 manifest 里写了死路径）
  const badFile = needed.filter((id) => {
    const src = pathOf(id);
    return src && /^images\//.test(src) && !fs.existsSync(path.join(ROOT, src));
  });
  assert.equal(badFile.length, 0, '这些图集的图片文件不存在：' + badFile.map((id) => id + '→' + pathOf(id)).join(', '));

  // 清单里没有的（场景兜底图）按 battle.js 的做法用 URL 加载注册
  const viaUrl = needed.filter((id) => !E.SRC_MAP[id] && pathOf(id));
  return E.loadSheets(needed.map((id) => (E.SRC_MAP[id] ? id : null)).filter(Boolean))
    .then(() => Promise.all(viaUrl.map((id) => E.loadSheetFromUrl(id, pathOf(id)))))
    .then(() => {
    /* ③ 角色/特效图集必须有帧表；场景图元（fightBg 之类）是**整图缩放绘制**的
     * （battle.js 的 drawScene 直接 ctx.drawImage(sheet.img, ...)），本来就不需要帧表。 */
    const modelSheets = [...new Set([].concat(...Object.values(npcSheets), ...Object.values(npcEffects)))];
    const noFrames = modelSheets.filter((id) => {
      const sh = E.SHEETS[id];
      return !sh || !sh.img || Object.keys(sh.frames).length === 0;
    });
    assert.equal(noFrames.length, 0, '这些角色/特效图集注册后没有任何帧（模型会缺块）：' + noFrames.join(', '));
    // 场景图元：只要图片加载出来即可
    const sceneBad = regionIds.filter((id) => {
      const sh = E.SHEETS[id];
      return !sh || !sh.img || !sh.img.naturalWidth;
    });
    assert.equal(sceneBad.length, 0, '这些场景图集没有加载出来：' + sceneBad.join(', '));

    // ④ 逐个模型逐个动作：动画里每个图元都要能解析到帧
    const actions = ['idle', 'common', 'skill', 'hit', 'dodge', 'back', 'die', 'win'];
    const missing = [];
    let checked = 0;
    for (const type of Object.keys(npcSheets)) {
      const sheets = npcSheets[type];
      for (const action of actions) {
        // 和 battle.js 的 npcAnim() 同一套命名
        const name = type === 'wood' ? (action === 'hit' ? 'wood_hitMe' : 'wood_rest') : type + '_' + ({
          idle: 'rest', common: 'common_attack', skill: 'skill_attack', hit: 'hitMe',
          dodge: 'runAround', back: 'runBack', die: 'die', win: 'win',
        })[action];
        if (!E.hasAnim(name)) continue;                     // 该动作本来就没做
        const frames = String(ctx.AnimationStr[name]).split(':');
        for (const f of frames) {
          for (const el of f.split('|')) {
            const label = el.split(',')[0].trim();
            if (label === '75' || Number(label) > 1000) continue;
            checked++;
            if (!E.spriteIn(sheets, label)) missing.push(name + ':' + label);
          }
        }
      }
    }
    assert.ok(checked > 100, '没检查到几个图元，测试本身可能失效：' + checked);
    assert.equal(missing.length, 0, '三侠/木人动画里解析不到帧的图元：' + [...new Set(missing)].slice(0, 12).join(', '));

    const imgFails = warns.filter((w) => /img-fail|no-anim/.test(w));
    assert.equal(imgFails.length, 0, '引擎报了素材/动画缺失：' + imgFails.slice(0, 6).join('; '));
  });
});

record('js/gamedict.js 与 references/orig/ 的抽取结果一致（可重生成）', () => {
  const orig = path.join(ROOT, 'references', 'orig', 'GameDict.js');
  if (!fs.existsSync(orig)) { console.log('    （跳过：这是精简包，没有 references/orig/）'); return; }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'gen-vendor-data.cjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'gamedict.js 不是最新的：\n' + (r.stderr || r.stdout));
});

/* 每个「浏览器侧模块」都必须能在最小环境下**加载成功**并挂上自己的全局。
 * 这条是补一个真实的坑：js/battle.js 曾经在模块作用域引用了一个只存在于
 * Battle.run 内部的函数 → 文件一加载就 ReferenceError → window.Battle 根本没挂上，
 * 于是「战斗完全播不了」。当时 20 个工具全绿却没抓到，因为它们都不加载 battle.js。 */
record('浏览器侧模块都能加载并挂上全局（battle / tower / tower-ui / classic-ui …）', () => {
  /* 注意：debug.js / main.js 在加载期就会去建面板、绑 DOM 事件，需要真浏览器环境，
   * 这里只覆盖「纯逻辑 + 界面模块」——它们正是之前 battle.js 那种加载期引用错误的受害者。 */
  const files = ['js/sim.js', 'js/tower-data.js', 'js/state.js', 'js/tower.js', 'js/battle.js',
    'js/battle-drops.js', 'js/ui.js', 'js/classic-ui.js', 'js/classic-extras.js', 'js/classic-fusion.js',
    'js/tower-ui.js'];
  const store = new Map();
  const c = {
    console,
    Date,
    JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Set, Map,
    setTimeout: () => 0, clearTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => 0,
    navigator: { userAgent: 'node', language: 'zh-CN', platform: 'node' },
    performance: { now: () => 0 },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    Image: function Image() { return { style: {}, addEventListener() {}, set src(v) { this._src = v; }, get src() { return this._src; } }; },
    Audio: function Audio() { return { play: () => Promise.resolve(), pause() {}, addEventListener() {}, removeEventListener() {}, volume: 1, currentTime: 0 }; },
    Event: function Event(t) { this.type = t; }, CustomEvent: function CustomEvent(t) { this.type = t; },
    alert() {}, confirm: () => false, prompt: () => null,
    location: { search: '?qa=1', href: 'http://local/' },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    document: null,
  };
  /* 极简 DOM 桩：够模块在加载期建面板/绑事件即可（不求渲染正确） */
  const fakeEl = () => {
    const el = {
      style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      children: [], childNodes: [], value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
      appendChild(child) { this.children.push(child); return child; },
      removeChild() {}, insertBefore(ch) { return ch; }, remove() {}, setAttribute() {}, getAttribute: () => null,
      removeAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() {},
      querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      getContext: () => ({ save() {}, restore() {}, drawImage() {}, clearRect() {}, fillRect() {}, beginPath() {}, closePath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, translate() {}, scale() {}, rotate() {}, setTransform() {}, fillText() {}, measureText: () => ({ width: 0 }), createPattern: () => null, getImageData: () => ({ data: [] }), putImageData() {}, createLinearGradient: () => ({ addColorStop() {} }), globalAlpha: 1, globalCompositeOperation: '', imageSmoothingEnabled: false }),
      width: 1170, height: 690, offsetWidth: 1170, offsetHeight: 690,
    };
    return el;
  };
  c.document = {
    addEventListener() {}, removeEventListener() {}, createElement: fakeEl, createElementNS: fakeEl,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    body: fakeEl(), documentElement: fakeEl(), head: fakeEl(),
    readyState: 'complete', hidden: false, visibilityState: 'visible', title: '',
  };
  c.window = c; c.self = c; c.globalThis = c;
  c.addEventListener = () => {}; c.removeEventListener = () => {}; c.dispatchEvent = () => true;
  vm.createContext(c);
  for (const f of ['js/gamedict.js', ...files]) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    try {
      vm.runInContext(fs.readFileSync(full, 'utf8'), c, { filename: f });
    } catch (e) {
      assert.fail(f + ' 加载失败：' + (e && e.message));
    }
  }
  for (const [key, need] of [['Battle', 'run'], ['Tower', 'endlessInfo'], ['TowerData', 'BUFFS'], ['TowerUI', 'openEndless'], ['Sim', 'simulate']]) {
    assert.ok(c[key], '加载完之后 window.' + key + ' 应当存在');
    assert.ok(c[key][need], 'window.' + key + '.' + need + ' 应当存在');
  }
});

(async () => {
  let failed = 0;
  for (const [name, fn] of results) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ' | ' + (e && e.message)); }
  }
  console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${results.length} 项）`);
  process.exit(failed ? 1 : 0);
})();
