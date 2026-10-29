#!/usr/bin/env node
/* ============================================================
 * tools/test-mint-shop.cjs — 无尽塔「铸币商店」回归
 *
 * 需求（用户口径）：
 *   1. 5 层之后的 x2/x3/x4 与 x7/x8/x9 层，**每场战斗结束后 5% 概率**刷出铸币商店；
 *   2. 同一组连续三层（x2~x4 / x7~x9）最多刷出一次；
 *   3. 店里可以**花铸币买一件**增益（固定价：普通 0 / 稀有 1 / 史诗 2 / 传奇 3）
 *      或**免费拿自己的一件增益换一件**；二者做成其一店立刻消失（也可以直接送客）；
 *   4. 货架 5 件，稀有度 ≈「试炼商店花 40 试炼币刷新」的排布、普通档再压一档，
 *      非传奇档「大概率」是运营类（ops 标签）；
 *   5. 免费交换：大概率 → 同稀有度运营类（普通件 50% 升成稀有件），小概率 → 同稀有度非运营；
 *   6. 可免费刷新一次货架，刷新之后不能再交换。
 *
 * 用法：node tools/test-mint-shop.cjs
 * ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

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
const LOAD = ['js/gamedict.js', 'js/gamedata.js', 'js/battle-drops.js',
  'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js', 'js/tower-plot.js'];

/** 极简「界面桩」：把 tower-ui.js 的页面与弹窗渲染出来（只记 HTML 与按钮处理器），
 *  用来冒烟跑一遍新商店页面的真实代码路径（不需要浏览器）。 */
function uiHarness(c) {
  const rendered = [];
  const nav = [];                    // 记下「回主界面 / 跳关卡页」这类顶层跳转，供用例断言
  const handlers = new Map();
  const el = () => ({
    innerHTML: '', dataset: {}, getContext: null,
    querySelector: (sel) => {
      if (!handlers.has(sel)) handlers.set(sel, { onclick: null });
      return handlers.get(sel);
    },
    querySelectorAll: () => [],
    appendChild: () => {}, remove: () => {}, replaceWith: () => {},
    classList: { add: () => {}, remove: () => {} },
  });
  vm.runInContext('setTimeout = function () { return 0; }; clearTimeout = function () {};', c);
  c.document = { createElement: () => el(), body: { appendChild: () => {} }, activeElement: null };
  c.UI = { classic: {
    /* `node` = 这一屏的容器节点本身：剧情屏会往它上面挂「点任意位置继续」的整屏点击处理器。
     * 剧本选择（无尽塔开局页）要能拿到两张卡：按 HTML 里的 data-script 造最小节点，
     * 只服务这一条用例；其它选择器仍走原来的 handlers。 */
    page: (group, active, content, opts) => {
      const node = el();
      node.innerHTML = content;
      const scriptOptions = [...String(content).matchAll(/data-script="([^"]+)"/g)].map((m) => ({
        getAttribute: () => m[1], onclick: null,
      }));
      node.querySelectorAll = (sel) => (sel === '[data-script]' ? scriptOptions : []);
      node.querySelector = (sel) => {
        if (sel === '[data-script-picker]') {
          const menu = { hidden: true };
          const trigger = { onclick: null, setAttribute: () => {} };
          return {
            querySelector: (s) => s === '[data-action="script-toggle"]' ? trigger
              : s === '.script-menu' ? menu : null,
            querySelectorAll: (s) => node.querySelectorAll(s),
          };
        }
        if (!handlers.has(sel)) handlers.set(sel, { onclick: null });
        return handlers.get(sel);
      };
      rendered.push({ kind: 'page', content: content, opts: opts || {}, node: node });
      return node;
    },
    modal: (title, content, buttons, opts) => {
      rendered.push({ kind: 'modal', title: title, content: content, buttons: buttons || [], opts: opts || {} });
      return { element: el(), close: () => {} };
    },
    btn: (label, action, cls) => '<button class="' + (cls || '') + '" data-action="' + action + '">' + label + '</button>',
    icon: () => '<i></i>', bind: () => {}, home: () => { nav.push('home'); }, refreshHeader: () => {},
  },
  /* 顶层动作分发器（真身挂在 window.UI 上）：`runAction('stages')` = 打开关卡页。 */
  runAction: (key) => { nav.push(key); } };
  /* 载入真界面模块（和浏览器同一份代码）。 */
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/tower-plot.js'), 'utf8'), c, { filename: 'js/tower-plot.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8'), c, { filename: 'js/tower-ui.js' });
  return {
    rendered, nav,
    last: (kind) => rendered.filter((r) => r.kind === kind).pop(),
    click: (action) => {
      /* 剧情屏 2026-10 用户口径：右下角的「继续」按钮已经去掉，改成**点屏幕任意位置**推进。
       * 测试沿用 `click('story-next')` 这个写法，这里把它转成「点一下整屏」——
       * 走的与真人完全同一条路（容器节点的 onclick），不再依赖那颗按钮存在。 */
      if (action === 'story-next') {
        const pg = rendered.filter((r) => r.kind === 'page').pop();
        assert.ok(pg && pg.node && typeof pg.node.onclick === 'function',
          '剧情屏应当接管「点任意位置继续」');
        pg.node.onclick({ target: null });
        return;
      }
      const h = handlers.get('[data-action="' + action + '"]');
      assert.ok(h && h.onclick, '界面上应当有可点的「' + action + '」');
      h.onclick();
    },
    modalButton: (label) => {
      const m = rendered.filter((r) => r.kind === 'modal').pop();
      assert.ok(m, '应当弹过窗');
      const b = (m.buttons || []).find((x) => x.label === label);
      assert.ok(b && b.run, '弹窗里应当有「' + label + '」按钮');
      return b;
    },
  };
}

/** 装一个「够 debug.js 建面板」的最小 DOM，并载入真调试模块（返回捕获到的节点，方便断言渲染结果）。 */
function debugHarness(c) {
  const made = [];
  const mkEl = () => {
    const cache = new Map();
    const e = {
      innerHTML: '', textContent: '', dataset: {}, style: {}, children: [], className: '', title: '', type: '',
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      querySelector: (sel) => { if (!cache.has(sel)) cache.set(sel, mkEl()); return cache.get(sel); },
      querySelectorAll: () => [], appendChild() {}, removeChild() {}, remove() {}, replaceWith() {},
      addEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      focus() {}, blur() {}, click() {}, getContext: () => null, insertBefore() {},
      contains: () => false, closest: () => null,
    };
    made.push(e);
    return e;
  };
  c.document = {
    readyState: 'complete', createElement: () => mkEl(), createTextNode: () => mkEl(),
    body: mkEl(), head: mkEl(), documentElement: mkEl(), activeElement: null,
    addEventListener() {}, removeEventListener() {}, querySelector: () => mkEl(), querySelectorAll: () => [],
  };
  c.addEventListener = () => {}; c.removeEventListener = () => {};
  vm.runInContext('setTimeout = function () { return 0; }; clearTimeout = function () {};', c);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'debug.js'), 'utf8'), c, { filename: 'js/debug.js' });
  return { made, find: (needle) => made.find((e) => String(e.innerHTML).includes(needle)) };
}

/** 起一局无尽塔，并把当前层挪到 layer。 */
function setup(layer) {
  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
  const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const f of LOAD) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  c.State.newGame('铸币商店回归');
  const S = c.State.state();
  S.level = 70;
  S.props[23] = 30;
  for (let i = 1; i <= 36; i++) S.stages[i] = { npcIndex: 3, passed: true };
  /* 固定随机：__rand(v) → 每次调用都返回 v（0 = 必中概率 / 必取第一项；0.99 = 必不中）。 */
  c.__rand = (v) => vm.runInContext('(function(){var v=' + Number(v) + ';Math.random=function(){return v;};return true;})()', c);
  /* 固定随机：LCG（用于统计采样；同一 seed 完全可复现）。 */
  c.__seed = (n) => vm.runInContext(
    '(function(){var s=' + Number(n) + ';Math.random=function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};return true;})()', c);
  c.__rand(0.99);
  assert.ok(c.Tower.startEndlessRun().ok, '应该能开一局无尽塔');
  /* 【U18】剧情会顶掉无尽首页（进店前先播一段）——本文件的用例只关心商店与状态机，
   * 所以**默认关掉剧情（= 挑战模式）**；专门测剧情的第 14 节自己 `setStoryEnabled(true)`。 */
  c.Tower.setStoryEnabled(false);
  /* 场间选择里排除 E01（战后开店）/ E15（重开本层）：本文件要数场次与商店节奏，
   * 抽到这两张牌会把计数打散（需要它们的用例都自己 debugGrantBuff 直接发牌）。 */
  c.Tower._debugSetNoFlowBuffs(true);
  c.Tower._debugSetEndlessLayer(layer || 7);
  return c;
}
/** 打赢当前这一场（跳过界面，直接走状态机）。 */
function winOne(c) {
  const run = c.Tower._debugRun('endless');
  clearShop(c);
  run.choices = null;
  run.phase = null;
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开下一场：' + ((nx && nx.msg) || ''));
  return c.Tower.reportBattle('endless', nx.token, true, 1500, 2000);
}
/** 把还开着的店处理掉（铸币商店走正常 API，试炼商店在测试里直接清）。 */
function clearShop(c) {
  const run = c.Tower._debugRun('endless');
  if (!run || !run.shop) return;
  if (run.shop.mint) { c.Tower.leaveMintShop(); return; }
  run.shop = null;
  run.phase = null;
}

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '   ' + (e && e.message)); }
}
function hr(title) { console.log('\n──── ' + title + ' ────'); }
const ids = (list) => list.map((b) => b.id).join(',');

/* ============================================================ */
hr('1. 数据层：刷出区间 / 组号 / 固定价 / 运营类标签');
{
  const c = setup(7);
  const TD = c.TowerData;

  check('层数区间：只有 5 层之后的 x2/x3/x4 与 x7/x8/x9', () => {
    for (let n = 1; n <= 30; n++) {
      const want = n > 5 && [2, 3, 4].indexOf(n % 5) >= 0;
      assert.equal(TD.mintLayerOk(n), want, '第 ' + n + ' 层的判定应当是 ' + want);
    }
    assert.equal(TD.mintLayerOk(7) && TD.mintLayerOk(8) && TD.mintLayerOk(9), true, '7/8/9 层应当在内');
    assert.equal(TD.mintLayerOk(12) && TD.mintLayerOk(13) && TD.mintLayerOk(14), true, '12/13/14 层应当在内');
    assert.equal(TD.mintLayerOk(6), false, '第 6 层（x1）不在内');
    assert.equal(TD.mintLayerOk(10), false, '第 10 层（x0）不在内');
    assert.equal(TD.mintLayerOk(11), false, '第 11 层（x1）不在内');
    assert.equal(TD.mintLayerOk(2), false, '第 2 层是「5 层之前」，不在内');
  });

  check('连续三层共用一个组号，跨组不同号', () => {
    assert.equal(TD.mintGroupOf(7), TD.mintGroupOf(8));
    assert.equal(TD.mintGroupOf(8), TD.mintGroupOf(9));
    assert.equal(TD.mintGroupOf(12), TD.mintGroupOf(14));
    assert.notEqual(TD.mintGroupOf(9), TD.mintGroupOf(12));
    assert.notEqual(TD.mintGroupOf(14), TD.mintGroupOf(17));
  });

  check('铸币售价固定：普通 0 / 稀有 1 / 史诗 2 / 传奇 3', () => {
    assert.equal(JSON.stringify(TD.MINT_SHOP.price), '[0,1,2,3]');
    for (const b of TD.BUFFS) assert.equal(TD.mintPrice(b), TD.MINT_SHOP.price[b.rarity], b.id);
  });

  check('战斗掉落传奇初始权重：基础权重 2.0，自然出率约 2% / 格（商店仍是 2.2）', () => {
    const run = c.Tower._debugRun('endless');
    assert.equal(TD.LEGEND_BATTLE_WEIGHT, 2.0, '战斗奖励的传奇基础权重为 2.0（约 2% 出率）');
    assert.equal(TD.LEGEND_BASE_WEIGHT, 2.2, '试炼/铸币商店的基础权重保持原样');
    const w = TD.battleTierWeights(1, run);
    const total = w.reduce((a, b) => a + b, 0);
    const share = w[3] / total;
    assert.ok(share > 0.018 && share < 0.022,
      '战斗奖励的传奇初始占比应当落在 1.8%~2.2%（实测 ' + (share * 100).toFixed(2) + '%）');
    const core = fs.readFileSync(path.join(ROOT, 'js/tower.js'), 'utf8').replace(/\r\n/g, '\n');
    assert.match(core, /const baseTier = TD\.battleTierWeights\(TD\.rerollTilt\(CHOICE_TILT_PAID\), run\);/,
      '战斗奖励抽取必须真的走 battleTierWeights，不能只改数据没接线');
  });

  check('ops（运营类）与用户口径一致', () => {
    /* 2026-10：新增「水晶铭文」C60、「碎裂铭文」C61、「延续铭文」C62、「烙印升华」E20
     *（都带 ops 标签，与虚空铭文 C37 同一套运营标签）。 */
    const want = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E09', 'E10', 'E12', 'E13', 'E14', 'E16', 'E20',
      'C24', 'C25', 'C30', 'C31', 'C36', 'C37', 'C53', 'C58', 'C59', 'C60', 'C61', 'C62'].sort().join(',');
    assert.equal(ids(TD.opsPool.filter(b => !TD.hasTag(b, 'hero')).sort((a, b) => (a.id < b.id ? -1 : 1))), want);
    for (const b of TD.opsPool) assert.ok(TD.hasTag(b, 'endless'), b.id + ' 运营类应当只属于无尽塔');
  });

  check('铸币商店池：全部无尽增益，但**不含铸币类**（防套利）', () => {
    for (const b of TD.mintPool) assert.ok(TD.hasTag(b, 'endless'), b.id + ' 不在无尽塔体系里');
    for (const id of ['E09', 'E10']) {
      assert.ok(!TD.mintPool.some((b) => b.id === id), id + '（给铸币）不该上铸币商店的货架');
    }
    /* 时间回廊（E15）在数据里明说「不会在商店出现」→ 货架与免费交换池都不能有它。 */
    assert.ok(!TD.mintPool.some((b) => b.id === 'E15'), 'E15 不该进铸币商店的货架 / 交换池');
    assert.ok(!TD.shopPool.some((b) => b.id === 'E15'), 'E15 也不该进试炼商店货架');
    for (let r = 0; r < 4; r++) assert.ok(TD.mintPool.some((b) => b.rarity === r), '第 ' + r + ' 档要有货');
  });

  check('货架稀有度：≈ 试炼商店 40 币刷新的排布，且普通档被下调', () => {
    const w = TD.mintWeights(null);
    const tilted = TD.tiltWeights(TD.rerollTilt(TD.MINT_SHOP.tiltPaid));
    assert.ok(w[0] < tilted[0], '普通档权重应当低于「40 币刷新」的排布：' + w[0] + ' vs ' + tilted[0]);
    assert.ok(w[0] > 0.08 && w[0] < 0.30, '普通档应当在合理区间（实测 ≈0.20）：' + w[0]);
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9, '权重应当归一化');
    assert.ok(w[3] > tilted[3] - 0.02, '普通档压下去之后，其它档应当抬起来');
  });
}

/* ============================================================ */
hr('2. 刷出时机：5% / 只在指定层 / 同组三层只出一次');
{
  check('指定层 + 5% 命中 → 这一场打完就开店（层中）', () => {
    const c = setup(7);
    c.__rand(0.99);
    assert.equal(winOne(c).mintShop, undefined, '5% 没中就不该开店');
    const run0 = c.Tower._debugRun('endless');
    assert.equal(run0.shop, null, '没中的时候不该有店');
    assert.equal(run0.mintGroup, -1, '没刷出就不该记组号');
    c.__rand(0);
    const rw = winOne(c);
    assert.equal(rw.mintShop, true, '5% 命中应当返回 mintShop');
    assert.equal(rw.phase, 'shop', '应当进入商店阶段');
    const run = c.Tower._debugRun('endless');
    assert.ok(run.shop && run.shop.mint === true, 'run.shop 应当是铸币商店');
    assert.equal(run.shop.layer, 7, '店要记住是在第 7 层刷出来的');
    assert.equal(run.mintGroup, c.TowerData.mintGroupOf(7), '刷出后记下这一组的组号');
    assert.equal(c.Tower.endlessInfo().run.mintShop, true, '首页快照要能看出这是铸币商店');
    assert.equal(c.Tower.shopState().mint, true, 'shopState 要标明 mint');
  });

  check('非指定层（x1 / x0）：概率拉满也不刷', () => {
    for (const layer of [6, 10, 11, 15, 16, 20, 21]) {
      const c = setup(layer);
      c.__rand(0);
      const rw = winOne(c);
      assert.equal(!!rw.mintShop, false, '第 ' + layer + ' 层不该刷铸币商店');
      assert.equal(c.Tower._debugRun('endless').mintGroup, -1, '第 ' + layer + ' 层不该记组号');
    }
  });

  check('同一组连续三层只出一次（x7 出过 → x8/x9 都不再出）', () => {
    const c = setup(7);
    c.__rand(0);
    assert.equal(winOne(c).mintShop, true, '第 7 层第 1 场应当刷出');
    clearShop(c);
    /* 第 7 层剩下的场次 + 第 8 / 9 层的每一场：概率拉满也不再刷 */
    for (let i = 0; i < 11; i++) {
      const rw = winOne(c);
      assert.equal(!!rw.mintShop, false, '本组第 ' + (i + 2) + ' 场不该再刷（layer=' + c.Tower._debugRun('endless').layer + '）');
    }
    const run = c.Tower._debugRun('endless');
    assert.equal(run.layer, 10, '应该已经打到第 10 层了（7/8/9 三层共 12 场）');
    assert.equal(run.shop, null, '整组只开过那一次店');
  });

  check('下一组（x12~x14）可以再刷一次', () => {
    const c = setup(7);
    c.__rand(0);
    assert.equal(winOne(c).mintShop, true, '第 7 层刷出');
    clearShop(c);
    c.Tower._debugSetEndlessLayer(12);
    c.__rand(0);
    const rw = winOne(c);
    assert.equal(rw.mintShop, true, '第 12 层（新的一组）应当能再刷出');
    assert.equal(c.Tower._debugRun('endless').mintGroup, c.TowerData.mintGroupOf(12));
  });

  check('整层最后一场也会参与判定（层已推进到下一层，店照样开）', () => {
    const c = setup(9);
    c.__rand(0.99);
    for (let i = 0; i < 3; i++) winOne(c);          // 前 3 场都不中
    assert.equal(c.Tower._debugRun('endless').idx, 3, '应当只剩最后一场');
    c.__rand(0);
    const rw = winOne(c);                            // 第 4 场 = 整层最后一场
    assert.equal(rw.layerComplete, true, '应当是整层通关');
    assert.equal(rw.mintShop, true, '最后一场命中也要开店');
    const run = c.Tower._debugRun('endless');
    assert.equal(run.layer, 10, '层已经推进到第 10 层');
    assert.equal(run.phase, 'shop', '仍然停在商店阶段');
    assert.equal(run.shop.layer, 9, '店记的是**打仗的那一层**（9 层）');
  });

  check('这一场已经由 E01「立即进货」开店时顺延（不记组号，后面还能刷）', () => {
    const c = setup(7);
    c.__rand(0);
    assert.ok(c.Tower.debugGrantBuff('E01').ok, '先拿一张立即进货');
    const rw = winOne(c);
    assert.equal(rw.postBattleShop, true, 'E01 的试炼商店应当照常开');
    assert.equal(!!rw.mintShop, false, '一次战斗不开两家店');
    const run = c.Tower._debugRun('endless');
    assert.equal(run.shop.mint, undefined, '开出来的是试炼商店');
    assert.equal(run.mintGroup, -1, '顺延不记组号 → 本组后面还能刷');
    clearShop(c);
    const rw2 = winOne(c);
    assert.equal(!!rw2.mintShop, true, '下一场照常可以刷出铸币商店');
  });

  check('概率随层数增长：5% 起步、每 5 层 +0.5%、10% 封顶', () => {
    const c = setup(7);
    const TD2 = c.TowerData;
    assert.equal(TD2.MINT_SHOP.chance, 0.05, '基准 5%');
    assert.equal(TD2.MINT_SHOP.chanceStep, 0.005, '每 5 层 +0.5 个百分点');
    assert.equal(TD2.MINT_SHOP.chanceMax, 0.10, '上限 10%');
    assert.equal(JSON.stringify([1, 5, 6, 10, 11, 20, 30, 50, 51, 80].map((n) => TD2.mintChance(n))),
      JSON.stringify([0.05, 0.05, 0.055, 0.055, 0.06, 0.065, 0.075, 0.095, 0.1, 0.1]),
      '曲线：第 1 段 5%、第 2 段 5.5% …… 第 11 段起 10%');
  });

  check('实测：第 7 层 ≈5.5% / 第 57 层 ≈10%（固定种子各采样 3000 次）', () => {
    const rate = (layer) => {
      const c2 = setup(7);
      c2.__seed(20261026);
      c2.Tower._debugSetEndlessLayer(layer);
      const run = c2.Tower._debugRun('endless');
      let hits = 0;
      for (let i = 0; i < 3000; i++) {
        run.mintGroup = -1;                          // 每次都当成「本组还没出过」
        if (c2.Tower.mintRollOf(run, layer)) hits++;
      }
      return hits / 3000;
    };
    const r7 = rate(7), r57 = rate(57);
    assert.ok(Math.abs(r7 - 0.055) < 0.015, '第 7 层实测 ≈5.5%：' + (r7 * 100).toFixed(2) + '%');
    assert.ok(Math.abs(r57 - 0.10) < 0.015, '第 57 层实测 ≈10%：' + (r57 * 100).toFixed(2) + '%');
    assert.ok(r57 > r7, '越深越容易刷出：' + (r7 * 100).toFixed(2) + '% → ' + (r57 * 100).toFixed(2) + '%');
  });
}

/* ============================================================ */
hr('3. 货架：5 件 / 固定价 / 运营类优先');
{
  check('货架 5 件，售价 = 该件稀有度的固定价（不吃折扣）', () => {
    const c = setup(7);
    c.__rand(0);                                     // 概率必中 → 走真实路径开一家店
    winOne(c);
    const st = c.Tower.shopState();
    assert.equal(st.slots.length, c.TowerData.MINT_SHOP.shelf, '货架件数');
    assert.equal(st.slots[0].swap, true, '初始进店第一格必须是 0 铸币的等价交换');
    assert.equal(st.slots[0].price, 0, '等价交换固定 0 铸币');
    for (const s of st.slots) {
      if (s.swap) { assert.ok(s.name && s.desc, '等价交换要有名字与说明'); continue; }
      const def = c.TowerData.BUFF_BY_ID[s.id];
      const expected = c.TowerData.mintPrice(def);
      assert.equal(s.price, expected, s.name + ' 的售价应当是固定价');
      assert.equal(s.rarity, def.rarity);
      assert.ok(s.name && s.desc, '货架要有名字与说明');
    }
  });

  check('每 10 层最后一场胜利固定掉 1 枚铸币，只记增量不弹窗', () => {
    const c = setup(7);
    const T = c.Tower;
    T._debugSetEndlessLayer(10);
    const run = T._debugRun('endless');
    run.retryToken = 0;
    run.lastMintGained = 0;
    let last = null;
    for (let i = 0; i < 5; i++) {
      last = winOne(c);
      if (i < 4) assert.equal(last.mintGained, undefined, '第 ' + (i + 1) + ' 场不该提前掉铸币');
    }
    assert.equal(last.layerComplete, true, '第 5 场应当通关第 10 层');
    assert.equal(last.mintGained, 1, '通关第 10 层应当掉 1 枚铸币');
    assert.equal(run.retryToken, 1, '铸币余额 +1');
    assert.equal(run.lastMintGained, 1, '主界面增量字段为 1（用于显示 +1）');
    assert.equal(T.endlessInfo().run.lastMintGained, 1, 'endlessInfo 要把增量交给界面');
    assert.equal(run.layer, 10, '第 10 层是 x5，先停在结算商店');
    assert.ok(run.shop, '通关后照常开结算商店');
  });

  check('暴击精通去掉可叠加；普通无限叠层暴伤只在商店', () => {
    const c = setup(7);
    const TD = c.TowerData, T = c.Tower;
    const c21 = TD.BUFF_BY_ID.C21;
    assert.equal(TD.hasTag(c21, 'stackable'), false, 'C21 不再带可叠层词条');
    assert.equal(TD.stackCap(c21), 1, 'C21 每次拾取只占一栏 1 层');
    assert.equal(TD.stackNote(c21), '', 'C21 不写叠层说明');
    assert.equal(TD.descOf(c21, 'endless'), '暴击率 +15%', 'C21 卡面不补叠层说明');
    const run = T._debugRun('endless');
    run.permanent = [];
    assert.ok(T.addBuff(run, 'C21').ok);
    assert.ok(T.addBuff(run, 'C21').ok);
    const rows = run.permanent.filter((b) => b.id === 'C21');
    assert.equal(rows.length, 2, '重复拾取应当占两个背包栏位');
    assert.equal(rows.every((b) => b.stacks === 1), true, '每栏各 1 层，不再同栏叠 3');

    const c64 = TD.BUFF_BY_ID.C64;
    assert.equal(c64.rarity, 0, '巨力重拳是普通稀有度');
    assert.equal(c64.kind, 'permanent', '巨力重拳是永久类');
    assert.equal(c64.mods.critDmgBonus, 10, '暴伤 +10%');
    assert.equal(c64.unlimitedStacks, true, '可无限叠加');
    assert.equal(TD.stackCap(c64), Infinity, '无限叠层');
    assert.ok(TD.hasTag(c64, 'endless') && TD.hasTag(c64, 'shop'), '只在无尽塔商店出现');
    assert.equal(TD.hasTag(c64, 'battle'), false, '不进战斗奖励池');
    assert.ok(TD.mintPool.some((b) => b.id === 'C64'), '铸币商店池包含它');
    assert.equal(TD.shopBuyPrice(c64), Math.round(TD.shopPrice(c64) * 1.1), '试炼商店永久类 +10%');
    assert.equal(TD.shopBuyPrice(TD.BUFF_BY_ID.N07), TD.shopPrice(TD.BUFF_BY_ID.N07), '限次类不涨价');
    assert.equal(TD.mintPrice(TD.BUFF_BY_ID.C01), 1, '铸币基础价不变');
  });

  check('买走该页传奇后，传奇保底计数立即清零', () => {
    const c = setup(7);
    const T = c.Tower;
    const run = T._debugRun('endless');
    run.coins = 10000; run.permSlots = 20; run.permanent = [];
    run.legendPity = T.legendPityNeed();
    run.shop = { layer: run.layer, retrySold: false, rerollFree: true, rerollCount: 0, discount: false, discountPct: 0,
      slots: [{ id: 'C14', sold: false, price: 1 }, { id: 'C02', sold: false, price: 1 }] };
    const res = T.buyShopSlot(0);
    assert.ok(res.ok, '应当能买下传奇：' + (res.msg || ''));
    assert.equal(run.legendPity, 0, '买走传奇后计数必须归零，不能带到下一页');
  });

  check('抉择扩充改为史诗品质，最多叠 2 层', () => {
    const c = setup(7);
    const TD = c.TowerData;
    const c50 = TD.BUFF_BY_ID.C50;
    assert.equal(c50.rarity, 2, '抉择扩充是史诗品质');
    assert.equal(c50.maxStacks, 2, '叠加上限 2');
    assert.equal(TD.stackCap(c50), 2, 'stackCap 同步为 2');
    assert.match(TD.stackNote(c50), /最多叠 2 层/, '卡面叠层说明同步');
    assert.equal(TD.descOf(c50, 'endless'), '战斗获得的选择项 +1（最多叠 2 层，拿满后本局不再出现）');
  });

  check('每件都不重复、都能拿（ownable + poolFilter 同一口径）', () => {
    const c = setup(7);
    const run = c.Tower._debugRun('endless');
    for (let t = 0; t < 40; t++) {
      c.__seed(1000 + t);
      const slots = c.Tower.mintSlotsOf(run);
      assert.equal(slots.length, 5, '货架应当有 5 件');
      const seen = new Set();
      for (const s of slots) {
        assert.ok(!seen.has(s.id), '同一次货架不该出现重复：' + s.id);
        seen.add(s.id);
        const def = c.TowerData.BUFF_BY_ID[s.id];
        assert.ok(def, '货架上的 id 必须有效：' + s.id);
        assert.ok(c.Tower.ownableOf(run, def), s.id + ' 应当是可获得的');
        assert.ok(c.Tower.poolFilterOf(run, def), s.id + ' 应当能进池');
      }
    }
  });

  check('濒死觉悟（C47）：身上有一条就不再进池，放弃之后重新出现', () => {
    /* 2026-10 用户口径：C47 拿到之后**不该再刷出来**（三选一 / 商店都不给），
     * 直到它真的被放弃（每 10 层交增益）。判据是 tower-data 的 `noRestack` 标签。 */
    const c = setup(7);
    const T = c.Tower, TD = c.TowerData;
    const run = T._debugRun('endless');
    const def = TD.BUFF_BY_ID.C47;
    assert.ok(TD.hasTag(def, 'noRestack'), 'C47 应当带 noRestack');
    assert.ok(T.poolFilterOf(run, def), '还没拿到时应当能进池');
    T.addBuff(run, 'C47');
    assert.ok((run.permanent || []).some((b) => b.id === 'C47'), 'C47 应当已经挂在身上');
    assert.ok(!T.poolFilterOf(run, def), '身上有一条时不该再进池');
    /* 放弃它（每 10 层那道流程）→ 回到池子 */
    run.phase = 'sacrifice';
    const row = (run.permanent || []).find((b) => b.id === 'C47');
    assert.ok(T.sacrificePerm(row.uid != null ? row.uid : 'C47').ok, '放弃 C47 应当成功');
    assert.ok(!(run.permanent || []).some((b) => b.id === 'C47'), '放弃后应当已经不在身上');
    assert.ok(T.poolFilterOf(run, def), '失去之后应当重新进池');
  });

  check('稀有度分布：普通 ≈20%、且“大概率运营类”（固定种子采样）', () => {
    const c = setup(7);
    const run = c.Tower._debugRun('endless');
    const byRarity = [0, 0, 0, 0];
    let opsNonLegend = 0, nonLegend = 0;
    const N = 300;
    for (let t = 0; t < N; t++) {
      c.__seed(777 + t);
      for (const s of c.Tower.mintSlotsOf(run)) {
        const def = c.TowerData.BUFF_BY_ID[s.id];
        byRarity[def.rarity]++;
        if (def.rarity !== 3) {
          nonLegend++;
          if (c.TowerData.hasTag(def, 'ops')) opsNonLegend++;
        }
      }
    }
    const total = byRarity.reduce((a, b) => a + b, 0);
    const commonShare = byRarity[0] / total;
    assert.ok(commonShare > 0.10 && commonShare < 0.30, '普通档占比 ' + (commonShare * 100).toFixed(1) + '%（期望 ≈20%）');
    assert.ok(byRarity[3] / total > 0.05, '传奇档不该绝迹：' + (byRarity[3] / total * 100).toFixed(1) + '%');
    const opsShare = opsNonLegend / Math.max(1, nonLegend);
    assert.ok(opsShare > 0.68 && opsShare < 0.92, '非传奇档的运营类占比 ' + (opsShare * 100).toFixed(1) + '%（期望 ≈80%）');
  });

  check('传奇档不受「优先运营」限制（会出现非运营的传奇）', () => {
    const c = setup(7);
    const run = c.Tower._debugRun('endless');
    let nonOpsLegend = 0;
    for (let t = 0; t < 400; t++) {
      c.__seed(4242 + t);
      for (const s of c.Tower.mintSlotsOf(run)) {
        const def = c.TowerData.BUFF_BY_ID[s.id];
        if (def.rarity === 3 && !c.TowerData.hasTag(def, 'ops')) nonOpsLegend++;
      }
    }
    assert.ok(nonOpsLegend > 0, '400 车货里应当出现过非运营的传奇件');
  });

  check('铸币商店同样触发 C59 门庭若市（发进门币），但不做「试炼商店消费」记账', () => {
    const c = setup(7);
    c.__rand(0);
    assert.ok(c.Tower.debugGrantBuff('C59').ok);
    assert.ok(c.Tower.debugGrantBuff('C36').ok);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.ok(run.shop && run.shop.mint, '应当开出铸币商店');
    assert.equal(run.shop.enterCoins, 80, 'C59 一层 80 试炼币应当记在这家店上（2026-10 由 100 削弱）');
    assert.equal(c.Tower.shopState().enterCoins, 80, 'shopState 要带出进门币（界面据此飘字）');
    assert.equal(c.Tower.claimShopEnterCoins(), 80, '领一次拿到 80');
    assert.equal(c.Tower.claimShopEnterCoins(), 0, '只飘一次字（领过就清零）');
    assert.equal(run.shopSpend || 0, 0, 'C36 消费进度不该被铸币商店触发（花的是铸币，不是试炼币）');
  });

  check('买铸币（50 试炼币）算「试炼商店消费」：触发挥金如土与豪掷千金，并把结果交回界面', () => {
    /* 2026-10 第八十一批用户反馈「买铸币好像不触发这两个增益」：机制其实一直在算，
     * 是界面从没说过。这条用例把两件事都钉住 —— ①账面确实动了；②结果回传给界面去提示。 */
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0.5);
    winOne(c);
    const T = c.Tower, TD = c.TowerData;
    assert.ok(T.debugGrantBuff('C36').ok, '挥金如土');
    assert.ok(T.debugGrantBuff('C58').ok, '豪掷千金');
    const row = (id) => (T._debugRun('endless').permanent || []).find((b) => b.id === id) || {};
    /* 手开一家**试炼商店**（不依赖这一场恰好开出哪家店），再走界面的按钮。 */
    const run = T._debugRun('endless');
    run.coins = 300;
    run.retryToken = 0;
    run.shop = { mint: false, layer: run.layer, slots: [], retrySold: false,
      rerollFree: true, rerollCount: 0, rerollPaid: 0, halfPerPage: 0 };
    run.phase = 'shop';
    c.TowerUI.openShop();
    const price = TD.SHOP.retryPrice;
    const procsBefore = Math.max(0, Math.floor(Number(row('C36').procs) || 0));
    const spend58Before = Math.max(0, Number(row('C58').limitedSpend) || 0);
    ui.click('retry');
    const r36 = row('C36'), r58 = row('C58');
    assert.ok(Math.max(0, Math.floor(Number(r36.procs) || 0)) > procsBefore,
      '挥金如土：买铸币的 ' + price + ' 币要计入分段（procs ' + procsBefore + ' → ' + r36.procs + '）');
    assert.equal(Math.max(0, Number(r58.limitedSpend) || 0), spend58Before + price,
      '豪掷千金：进度条要加上这一笔');
    assert.equal(T._debugRun('endless').retryToken, 1, '铸币到手');
    /* 三条消费路径都要把结果交回界面（买货架 / 买铸币 / 刷新），界面统一用 shopSpendToast 提示。 */
    const uiSrc = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal((uiSrc.match(/shopSpendToast\(/g) || []).length, 4, 'shopSpendToast 定义 1 处 + 三个消费入口各 1 处');
    const towerSrc = fs.readFileSync(path.join(ROOT, 'js/tower.js'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal((towerSrc.match(/shopSpend: spend/g) || []).length >= 2, true,
      '买铸币与刷新都要把 shopSpend 交回去');
  });

  check('刷新货架的费用不计入豪掷千金（C58），但挥金如土（C36）照常累计', () => {
    /* 用户 2026-10-25 口径：刷新费不能推进「每消费 100 币给一个随机限次」的进度，
     * 否则刷新越多、白拿的限次越多。买货 / 买铸币仍然计入 C58；C36 不受影响。 */
    const c = setup(7);
    const T = c.Tower;
    assert.ok(T.debugGrantBuff('C36').ok, '挥金如土');
    assert.ok(T.debugGrantBuff('C58').ok, '豪掷千金');
    const run = T._debugRun('endless');
    run.coins = 1000;
    run.shop = { mint: false, layer: run.layer, slots: [{ id: 'C01', sold: false, price: 1 }],
      retrySold: false, rerollFree: false, rerollCount: 1, rerollPaid: 0, halfPerPage: 0 };
    run.phase = 'shop';
    const row = (id) => (run.permanent || []).find((b) => b.id === id) || {};
    const c36Before = Math.max(0, Math.floor(Number(row('C36').procs) || 0));
    const c58Before = Math.max(0, Number(row('C58').limitedSpend) || 0);
    const r = T.rerollShop();
    assert.equal(r.ok, true, '刷新应当成功');
    assert.ok(r.paid > 0, '这一刷应当是付费刷新');
    assert.equal(Math.max(0, Number(row('C58').limitedSpend) || 0), c58Before,
      'C58 的进度不该被刷新费推进：' + c58Before + ' → ' + row('C58').limitedSpend);
    assert.ok(Math.max(0, Math.floor(Number(row('C36').procs) || 0)) > c36Before,
      'C36 仍然把刷新费计入分段（procs ' + c36Before + ' → ' + row('C36').procs + '）');
  });

  check('C59 叠层：铸币商店按层数发（×层数，最多 2 层）', () => {
    const c = setup(7);
    c.__rand(0);
    /* 2026-10 用户口径：门庭若市最多叠 2 层（原 3 层）。 */
    assert.ok(c.Tower.debugGrantBuff('C59').ok);
    assert.ok(c.Tower.debugGrantBuff('C59').ok);
    assert.equal(c.Tower.debugGrantBuff('C59').ok, false, '第 3 次应当被「已叠满（上限 2 层）」拒绝');
    assert.equal(c.Tower._debugRun('endless').permanent.find((b) => b.id === 'C59').stacks, 2);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.ok(run.shop && run.shop.mint);
    assert.equal(run.shop.enterCoins, 160, '2 层 → 160 试炼币（80 × 2）');
    assert.equal(c.Tower.claimShopEnterCoins(), 160);
  });

  /* 用户 2026-10-24 口径：豪掷千金被水晶铭文附魔后**不是** 100→150（那反而更差），
   * 而是 100→75。门槛的结算与悬停文案都必须走 `enchCostOf`。 */
  check('C58 豪掷千金被水晶铭文附魔：门槛 100 → 75（不是 150）', () => {
    const c = setup(7);
    const T = c.Tower;
    assert.ok(T.debugGrantBuff('C58').ok);
    const run = T._debugRun('endless');
    const row = run.permanent.find((b) => b.id === 'C58');
    assert.equal(T.enchCostOf(100, 1), 100, '没附魔仍是 100');
    assert.equal(T.enchCostOf(100, 1.5), 75, '一张水晶铭文 → 75');
    row.enchMul = 1.5;
    assert.equal(T.addShopSpendOf(run, 74), null, '74 币还没到附魔后的门槛');
    const r = T.addShopSpendOf(run, 1);
    assert.ok(r && r.limited && r.limited.length === 1, '满 75 币立刻给一个随机限次增益');
  });

  check('铸币商店进店飘字接了 C59（界面接线）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8');
    const from = src.indexOf('function openMintShop');
    const body = src.slice(from, from + 900);
    assert.ok(body.includes('claimShopEnterCoins'), 'openMintShop 要领取并飘字：' + body.slice(0, 200));
    assert.ok(/门庭若市/.test(body), '飘字文案要写明门庭若市');
  });
}

/* ============================================================ */
hr('4. 花铸币买一件（买完立刻收摊）');
{
  check('扣铸币、拿到增益、店立刻消失、phase 归位', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 5;
    run.shop.slots = [{ id: 'C01', sold: false, price: 999 }, { id: 'C02', sold: false, price: 0 }];
    const before = run.retryToken;
    const r = c.Tower.buyMintSlot(0);
    assert.ok(r.ok, '应当买得成：' + (r.msg || ''));
    assert.equal(r.price, c.TowerData.mintPrice(c.TowerData.BUFF_BY_ID.C01), '磐石之躯（稀有永久）固定价 1 铸币');
    assert.equal(run.retryToken, before - r.price, '扣掉对应铸币');
    assert.equal(run.shop, null, '买完店立刻消失');
    assert.equal(run.phase, null, 'phase 归位（回去继续打）');
    assert.ok((run.permanent || []).some((b) => b.id === 'C01'), '增益应当进构筑');
    assert.ok(r.shop === undefined, '不该带试炼商店的钩子字段');
  });

  check('普通件 0 铸币（赠品）也能买，且不扣铸币', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 0;
    run.shop.slots = [{ id: 'C02', sold: false, price: 0 }];
    const r = c.Tower.buyMintSlot(0);
    assert.ok(r.ok, '免费件应当买得成：' + (r.msg || ''));
    assert.equal(r.price, 0);
    assert.equal(run.retryToken, 0);
    assert.equal(run.shop, null);
  });

  check('铸币不够 → 买不了，店还在、货还在、钱不动', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 0;
    run.shop.slots = [{ id: 'C01', sold: false, price: 1 }];
    const r = c.Tower.buyMintSlot(0);
    assert.equal(r.ok, false, '铸币不足应当拒绝');
    assert.equal(run.shop.slots[0].sold, false, '货还在架上');
    assert.ok(run.shop, '店还开着');
    assert.equal(run.retryToken, 0, '不该扣钱');
  });

  check('永久增益满格 → 先要求替换，替换后才成交', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 9;
    /* 塞满 5 个占位永久增益（不含 C01） */
    run.permanent = [{ id: 'C02', stacks: 1 }, { id: 'C03', stacks: 1 }, { id: 'C21', stacks: 1 },
      { id: 'C22', stacks: 1 }, { id: 'C23', stacks: 1 }];
    run.shop.slots = [{ id: 'C01', sold: false, price: 1 }];
    const r1 = c.Tower.buyMintSlot(0);
    assert.equal(r1.ok, false);
    assert.equal(r1.needsReplace, true, '应当要求选一个替换掉');
    assert.equal(run.retryToken, 9, '没成交之前不该扣钱');
    assert.equal(run.shop.slots[0].sold, false);
    const r2 = c.Tower.buyMintSlot(0, 'C21');
    assert.ok(r2.ok, '替换之后应当买成：' + (r2.msg || ''));
    assert.equal(run.retryToken, 8, '稀有永久价 1 铸币');
    assert.ok((run.permanent || []).some((b) => b.id === 'C01'));
    assert.ok(!(run.permanent || []).some((b) => b.id === 'C21'), '被替换的应当出局');
    assert.equal(run.shop, null);
  });

  check('买已卖掉的格子 / 不在店里时调用 → 拒绝', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 3;
    run.shop.slots = [{ id: 'C01', sold: true, price: 1 }];
    assert.equal(c.Tower.buyMintSlot(0).ok, false, '卖掉的不能再买');
    run.shop = null;
    assert.equal(c.Tower.buyMintSlot(0).ok, false, '没开店时调用也要拒绝');
    assert.equal(c.Tower.swapMintBuff('C01').ok, false, '没开店时交换也要拒绝');
  });
}

/* ============================================================ */
hr('5. 免费交换（同稀有度 / 大概率运营类）');
{
  check('稀有件 → 同稀有度运营类（不花铸币，店立刻消失）', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 4;
    assert.ok(c.Tower.debugGrantBuff('C01').ok, '先拿一个稀有·非运营件（磐石之躯）');
    assert.ok((run.permanent || []).some((b) => b.id === 'C01'));
    const r = c.Tower.swapMintBuff('C01');
    assert.ok(r.ok, '应当换得成：' + (r.msg || ''));
    const def = c.TowerData.BUFF_BY_ID[r.buff.id];
    assert.equal(def.rarity, 1, '稀有件应当换回同稀有度：' + def.name);
    assert.ok(c.TowerData.hasTag(def, 'ops'), '这一支应当落在运营类：' + def.name);
    assert.ok(!(run.permanent || []).some((b) => b.id === 'C01'), '源增益应当被收走');
    /* 换回来的可能是**即时类**（E03 财源滚滚 / E04 steam大促 也是合法的稀有·运营件）：
     * 它们不进 permanent / limited，但 addBuff 会当场结算（r.ok 已经证明确实换成了）。 */
    const inLists = (run.permanent || []).some((b) => b.id === def.id) ||
      (run.limited || []).some((b) => b.id === def.id);
    assert.ok(inLists || def.kind === 'instant',
      '新增益应当入账（即时类则当场生效）：' + def.id + ' kind=' + def.kind);
    assert.equal(run.retryToken, 4, '交换不花铸币');
    assert.equal(run.shop, null, '换完店立刻消失');
    assert.equal(run.phase, null);
  });

  check('普通件：50% 升成稀有件（固定随机命中升级那一支）', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.ok(c.Tower.debugGrantBuff('C02').ok, '先拿一个普通·非运营件（磨砺）');
    const r = c.Tower.swapMintBuff('C02');
    assert.ok(r.ok, '应当换得成：' + (r.msg || ''));
    const def = c.TowerData.BUFF_BY_ID[r.buff.id];
    assert.equal(def.rarity, 1, '普通件抽中升级那一支应当给稀有件：' + def.name);
    assert.ok(c.TowerData.hasTag(def, 'ops'), '还应当是运营类');
  });

  check('普通件：另一支仍是普通（小概率非运营时同档非运营）', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.ok(c.Tower.debugGrantBuff('C02').ok);
    c.__rand(0.9);                                   // 0.9 ≥ 0.8 → 走「小概率非运营」
    const r = c.Tower.swapMintBuff('C02');
    assert.ok(r.ok, '应当换得成：' + (r.msg || ''));
    const def = c.TowerData.BUFF_BY_ID[r.buff.id];
    assert.equal(def.rarity, 0, '普通件应当留在普通档：' + def.name);
    assert.ok(!c.TowerData.hasTag(def, 'ops'), '这一支应当是非运营：' + def.name);
  });

  check('史诗 / 传奇件必定同档（不走「普通升稀有」那支）', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    for (const src of ['C14', 'C15']) {
      c.Tower.debugGrantBuff(src);
      const r = c.Tower.swapMintBuff(src);
      assert.ok(r.ok, src + ' 应当换得成：' + (r.msg || ''));
      const before = c.TowerData.BUFF_BY_ID[src];
      assert.equal(c.TowerData.BUFF_BY_ID[r.buff.id].rarity, before.rarity, src + ' 应当换回同稀有度');
      assert.equal(run.shop, null);
      /* 再开一家继续测下一个（同一组不允许再刷 → 直接用内部函数开） */
      run.shop = { mint: true, layer: 7, slots: [], rerollFree: true, rerollCount: 0, swapped: false };
      run.phase = 'shop';
    }
  });

  check('即时类 / 隐藏型不能拿去交换', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.equal(c.Tower.swapMintBuff('E02').ok, false, '即时类（试炼补贴）不能交换');
    assert.equal(c.Tower.swapMintBuff('C32').ok, false, '隐藏型（神兵淬炼）不能交换');
    assert.equal(c.Tower.swapMintBuff('NOPE').ok, false, '不存在的 id 也要拒绝');
    assert.equal(run.shop.swapped, false, '被拒绝的操作不该消耗交换机会');
    assert.equal(run.shop != null, true, '被拒绝之后店还开着');
  });

  check('扩容件（C30/C31）不在构筑列表里 → 不能拿去交换（与卖出同一口径）', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.ok(c.Tower.debugGrantBuff('C30').ok, '扩容背包（+1 槽）');
    assert.equal(run.permSlots, 1, '名额立刻生效');
    assert.equal((run.permanent || []).some((b) => b.id === 'C30'), false, '扩容件不落在永久栏里');
    assert.equal(c.Tower.swapMintBuff('C30').ok, false, '它不在本局增益列表里 → 换不了');
    assert.equal(run.permSlots, 1, '被拒绝的交换不该动名额');
    assert.equal(run.shop.swapped, false, '也不该消耗交换机会');
  });
}

/* ============================================================ */
hr('6. 免费刷新一次（刷新后不能交换）');
{
  check('第一次刷新免费、换货、并且锁掉交换', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    const before = JSON.stringify(run.shop.slots.map((s) => s.id));
    assert.equal(c.Tower.shopState().swapAllowed, true, '还没刷新 → 可以交换');
    c.__seed(20261027);                                // 刷新要**换一批**：喂一段新的随机
    const r = c.Tower.rerollMintShop();
    assert.ok(r.ok, '第一次刷新应当免费成功');
    assert.equal(run.shop.rerollFree, false);
    assert.equal(run.shop.rerollCount, 1);
    assert.equal(run.shop.slots.length, 5, '刷新之后货架仍是 5 件');
    assert.equal(JSON.stringify(run.shop.slots.map((s) => s.id)) === before, false, '货架应当换了一批');
    assert.equal(c.Tower.shopState().swapAllowed, false, '刷新之后不能交换');
    assert.equal(c.Tower.mintSwapAllowedOf(run), false);
    const bought = c.Tower.rerollMintShop();
    assert.equal(bought.ok, false, '只有一次免费刷新');
    assert.equal(run.shop.rerollCount, 1);
  });

  check('等价交换是 0 铸币的货架商品：可出现在任意格，买下才展开交换列表', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 5;
    assert.ok(c.Tower.debugGrantBuff('C01').ok, '先拿一件可交换的增益');
    let st = c.Tower.shopState();
    assert.equal(st.slots[0].swap, true, '初始进店固定第一格');
    assert.equal(st.slots[0].price, 0, '售价固定 0 铸币');
    assert.ok(st.swapCandidates >= 1, '有可交换的增益');
    /* 模拟刷新后的随机位置：它不是固定第一个，买下之前不会展开交换列表。 */
    run.shop.slots = [
      { id: 'C01', sold: false, price: 1 },
      { id: 'C02', sold: false, price: 1 },
      { swap: true, sold: false, price: 0, listPrice: 0 },
    ];
    run.shop.rerollCount = 1;
    run.shop.swapOpen = false;
    st = c.Tower.shopState();
    assert.equal(st.slots[2].swap, true, '刷新后可以洗到任意格');
    assert.equal(st.swapOpen, false, '没买之前不展开交换');
    const r = c.Tower.buyMintSlot(2);
    assert.equal(r.ok, true, r.msg);
    assert.equal(r.swap, true, '买下等价交换只是打开选择');
    assert.equal(run.retryToken, 5, '等价交换不花铸币');
    assert.equal(run.shop && run.shop.swapOpen, true, '买下之后才打开交换选择');
  });

  check('讨价还价：铸币商店**刷新出的新一页**也重新触发对折', () => {
    const c = setup(7);
    c.__rand(0.99);
    assert.ok(c.Tower.debugGrantBuff('E14').ok);
    c.Tower._debugRun('endless').env = [];
    c.__rand(0);
    const rw = winOne(c);
    assert.equal(rw.mintShop, true, '应当刷出铸币商店');
    assert.equal(c.Tower.shopState().halfCount, 1, '进店那一页 1 件对折');
    assert.equal(c.Tower.shopState().halfPerPage, 1, '店上记下「每页 1 件」');
    c.__seed(31337);
    assert.ok(c.Tower.rerollMintShop().ok, '免费刷新');
    const st = c.Tower.shopState();
    assert.equal(st.halfCount, 1, '刷新出的新一页也要触发');
    assert.equal(c.Tower.shopHalfPendingOf(), 0, '刷新不额外扣份数');
    const slot = st.slots.find((s) => s.half);
    assert.ok(slot, '新一页要有对折的格子');
    assert.equal(slot.price, Math.floor(slot.listPrice / 2), '对折价 = floor(原价 / 2)');
  });

  check('刷新之后交换被拒（源增益不受影响）', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.ok(c.Tower.debugGrantBuff('C01').ok);
    c.Tower.rerollMintShop();
    const r = c.Tower.swapMintBuff('C01');
    assert.equal(r.ok, false, '刷新之后不能再换');
    assert.ok((run.permanent || []).some((b) => b.id === 'C01'), '源增益应当还在');
    assert.ok(run.shop, '店还开着（还能买或送客）');
  });

  check('刷新之后仍然可以花铸币买', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 2;
    c.Tower.rerollMintShop();
    run.shop.slots = [{ id: 'C05', sold: false, price: 1 }];
    const r = c.Tower.buyMintSlot(0);
    assert.ok(r.ok, '刷新之后照样能买：' + (r.msg || ''));
    assert.equal(run.retryToken, 1, '稀有永久价 1 铸币');
    assert.equal(run.shop, null);
  });

  check('直接送客：店消失、什么都不给、钱不动', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 3;
    const permBefore = JSON.stringify(run.permanent || []);
    const r = c.Tower.leaveMintShop();
    assert.ok(r.ok, '送客应当成功');
    assert.equal(run.shop, null);
    assert.equal(run.phase, null);
    assert.equal(run.retryToken, 3, '不花钱');
    assert.equal(JSON.stringify(run.permanent || []), permBefore, '不换东西');
    assert.equal(c.Tower.leaveMintShop().ok, false, '店已经没了 → 再送客应当拒绝');
  });
}

/* ============================================================ */
hr('7. 与老流程的兼容（试炼商店 / 存档 / 关闭路径）');
{
  check('试炼商店不受影响：shopState 的 mint=false、price 仍是试炼币', () => {
    const c = setup(10);
    c.__rand(0.99);
    const run = c.Tower._debugRun('endless');
    run.coins = 500;
    /* 打到每 5 层的结算商店：第 10 层要打 5 场 */
    run.idx = 4;
    const nx = c.Tower.nextBattle('endless');
    c.Tower.reportBattle('endless', nx.token, true, 1500, 2000);
    const st = c.Tower.shopState();
    assert.ok(st, '每 5 层应当开试炼商店');
    assert.equal(st.mint, false, '结算商店是试炼商店');
    assert.equal(st.boundary, true);
    assert.equal(st.swapAllowed, false, '试炼商店没有「免费交换」这回事');
    for (const s of st.slots) {
      const def = c.TowerData.BUFF_BY_ID[s.id];
      assert.ok(s.price >= 1, '试炼商店的价是试炼币（含随机浮动），不会是铸币价：' + def.name + '=' + s.price);
    }
    assert.equal(c.Tower.closeShop().ok, true);
    assert.equal(c.Tower._debugRun('endless').phase, 'checkpoint', '结算商店关掉之后去结算点');
  });

  check('铸币商店走 closeShop() 也不会被当成结算商店', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.equal(run.phase, 'shop');
    assert.equal(c.Tower.closeShop().ok, true);
    assert.equal(run.phase, null, '铸币商店关掉就是继续打（不去结算点）');
    assert.equal(run.shop, null);
  });

  check('老存档 / 缺字段的档：mintGroup 归一化成 -1，mint 店字段补齐', () => {
    const c = setup(7);
    const run = c.Tower._debugRun('endless');
    delete run.mintGroup;
    run.shop = { mint: true, layer: 7, slots: [], rerollCount: 2 };
    const again = c.Tower._debugRun('endless');           // 再取一次会跑 normalizeRun
    assert.equal(again.mintGroup, -1, '没有 mintGroup 的档按「本组还没出过」处理');
    assert.equal(again.shop.rerollFree, false, 'rerollCount=2 → 免费刷新已经用掉');
    assert.equal(again.shop.swapped, false);
    assert.equal(again.shop.layer, 7);
    run.mintGroup = 'x';
    assert.equal(c.Tower._debugRun('endless').mintGroup, -1, '坏值也归一化成 -1');
  });

  check('存档往返：铸币商店与组号都能存下来（读档后仍是同一家店）', () => {
    const c = setup(7);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 2;
    const snapshot = JSON.stringify({ mintGroup: run.mintGroup, shop: run.shop, token: run.retryToken });
    /* 走一次保存 → 反序列化 → 归一化 */
    c.State.save();
    const key = c.State.saveKey || 'ssdz_test_save_v1';
    const raw = JSON.parse(c.localStorage.getItem(key) || 'null');
    assert.ok(raw, '应当写进了 localStorage');
    const again = c.Tower._debugRun('endless');
    assert.equal(JSON.stringify({ mintGroup: again.mintGroup, shop: again.shop, token: again.retryToken }), snapshot,
      '铸币商店应当原样存回来');
  });
}

/* ============================================================ */
hr('8. 界面接线（UI 分流 / 战后自动进店 / 两套 API 不串味）');
{
  const pageSrc = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8');
  const sliceOf = (src, startMarker, len) => {
    const at = src.indexOf(startMarker);
    assert.ok(at > 0, '找不到 ' + startMarker);
    return src.slice(at, at + (len || 900));
  };
  const c = setup(7);

  check('TowerUI 导出 openMintShop；openShop 见到 mint 店就分流', () => {
    assert.ok(/window\.TowerUI\s*=\s*\{[^}]*openMintShop/.test(pageSrc), 'TowerUI 应当导出 openMintShop');
    const body = sliceOf(pageSrc, 'function openShop(revisit)');
    assert.ok(body.includes('shop.mint') && body.includes('openMintShop()'),
      'openShop 应当在 shop.mint 时转给 openMintShop：' + body.slice(0, 200));
  });

  check('战后不再自动进店：先回主界面（剧情该播就播），进店交给首页按钮', () => {
    /* 2026-10 用户口径：打完一场不再自动弹进商店 —— 否则第 5 层那次「进店前的商人剧情」
     * 要退出商店才看得到。 */
    const body = sliceOf(pageSrc, 'const cont = () =>', 200);
    assert.ok(/const cont = \(\) => openEndless\(\);/.test(body), '战后必须先回主界面：' + body.slice(0, 160));
    assert.ok(!/openShop\(\)/.test(body), '战后不该再自动进店：' + body.slice(0, 160));
  });

  check('首页按钮文案区分「铸币商店 / 试炼商店」', () => {
    const body = sliceOf(pageSrc, 'const nextLabel = run.choices');
    assert.ok(body.includes("run.mintShop ? '进入铸币商店'"), '按钮文案应当区分两种店：' + body.slice(0, 160));
  });

  check('铸币商店页面的三个出口都走铸币商店 API', () => {
    /* 直接把 U14b 整段切出来（到下一节标题为止），避免以后页面变长把断言切掉。 */
    const from = pageSrc.indexOf('【U14b】');
    const to = pageSrc.indexOf('【U15】', from);
    assert.ok(from > 0 && to > from, '找不到 U14b 那一段');
    const body = pageSrc.slice(from, to);
    for (const call of ['Tower.buyMintSlot(i', 'Tower.rerollMintShop()', 'Tower.swapMintBuff(rowRef(b))', 'Tower.leaveMintShop()']) {
      assert.ok(body.includes(call), '铸币商店页应当调用 ' + call);
    }
  });

  check('界面冒烟：铸币商店页真的渲染得出来', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    winOne(c);
    /* 掺一格「讨价还价」对折过的商品：页面要能显示原价与对折价（不能因为 listPrice 缺失而炸）。 */
    const run0 = c.Tower._debugRun('endless');
    const halfSlot = run0.shop.slots.find((s) => !s.swap);
    assert.ok(halfSlot, '应当有普通商品格');
    halfSlot.half = true;
    assert.ok(c.Tower.debugGrantBuff('C02').ok, '先拿一件可交换的增益，等价交换才有购买键');
    c.TowerUI.openMintShop();
    const page = ui.last('page');
    assert.ok(page && page.content.includes('铸币商店'), '页面正文应当有「铸币商店」标题');
    assert.ok(page.content.includes('价格表') && page.content.includes('免费刷新'), '页面应当有价格表与免费刷新');
    assert.ok(page.content.includes('等价交换'), '页面应当有第一格的等价交换');
    assert.ok(page.content.includes('免费交换'), '页面应当有等价交换的购买键');
    assert.ok(page.content.includes('送客'), '页面应当有送客出口');
    assert.ok(page.content.includes('铸币 ' + c.Tower.shopState().retryToken), '标题上应当带铸币余额');
    assert.ok(page.content.includes('对折（原价'), '对折的格子要显示原价：' + page.content.slice(0, 80));
  });

  check('界面冒烟：点「购买」→ 扣铸币、收摊、回到无尽首页', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 3;
    run.shop.slots[0] = { id: 'C01', sold: false, price: 1 };
    c.TowerUI.openMintShop();
    ui.click('mintbuy0');
    assert.equal(run.retryToken, 2, '应当扣掉 1 枚铸币');
    assert.equal(run.shop, null, '买完店立刻收摊');
    assert.ok((run.permanent || []).some((b) => b.id === 'C01'), '增益应当进构筑');
    const after = ui.last('page');
    assert.ok(after.content.includes('无尽塔'), '应当回到无尽首页（渲染成功）');
  });

  check('界面冒烟：点「拿它交换」→ 确认 → 换到新件、收摊', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.ok(c.Tower.debugGrantBuff('C01').ok, '先拿一个稀有·非运营件');
    run.shop = { mint: true, layer: 7, slots: [{ swap: true, sold: false, price: 0, listPrice: 0 }],
      rerollFree: true, rerollCount: 0, swapped: false, swapOpen: false };
    run.phase = 'shop';
    c.TowerUI.openMintShop();
    /* 先买第一格 0 铸币的「等价交换」，页面才展开自己的增益列表。 */
    ui.click('mintbuy0');
    assert.equal(run.shop.swapOpen, true, '买下等价交换后应当打开交换选择');
    /* 【2026-10 同名逐条】交换按钮按 **uid**（精确到那一条栏位）绑定。 */
    ui.click('mintswap' + c.Tower.rowRefOf(run, 'C01').key);
    const confirm = ui.last('modal');
    assert.ok(confirm && confirm.content.includes('磐石之躯'), '应当先弹确认窗：' + (confirm && confirm.title));
    ui.modalButton('交换').run();
    assert.equal(run.shop, null, '换完店立刻收摊');
    assert.ok(!(run.permanent || []).some((b) => b.id === 'C01'), '源增益应当被收走');
    const got = ui.last('modal');
    assert.ok(got && got.title === '交换成功', '应当弹「交换成功」：' + (got && got.title));
    assert.ok(got.content.includes('运营类'), '换到的应当是运营类（固定随机命中那一支）');
  });

  check('界面冒烟：点「免费刷新」→ 货架换一批且锁掉交换；点「继续战斗」→ 收摊', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    c.__seed(20261028);
    c.TowerUI.openMintShop();
    ui.click('mintreroll');
    assert.equal(run.shop.rerollCount, 1, '应当已经刷新过一次');
    assert.equal(c.Tower.mintSwapAllowedOf(run), false, '刷新之后不能直接交换（要先买洗出来的等价交换）');
    const page = ui.last('page');
    assert.ok(page.content.includes('不再固定第一格'), '页面应当说明等价交换不再固定首位：' + page.content.slice(0, 160));
    assert.ok(String(page.opts.right || '').includes('继续战斗'),
      '页脚主按钮应当叫「继续战斗」：' + String(page.opts.right || '').slice(0, 160));
    ui.click('mintleave');
    assert.equal(run.shop, null, '「继续战斗」之后店消失');
    assert.equal(run.phase, null);
  });

  check('界面冒烟：页脚「返回」只回上一页，店还在（用户口径）', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    c.TowerUI.openMintShop();
    assert.ok(run.shop && run.shop.mint, '先在店里');
    ui.click('home');                                    // 页脚「返回菜单」
    assert.equal(run.phase, 'shop', '点返回不该收摊（phase 还是 shop）');
    assert.ok(run.shop && run.shop.mint, '店还开着');
    const home = ui.last('page');
    assert.ok(home.content.includes('进入铸币商店'), '首页按钮仍然提示可以再进店：' + home.content.slice(0, 200));
    /* 再进来点「继续战斗」才收摊 */
    c.TowerUI.openMintShop();
    ui.click('mintleave');
    assert.equal(run.shop, null, '这次才收摊');
    assert.equal(run.phase, null);
    /* 期间不会漏掉「商店还开着时不能开打」这条：nextBattle 应当被 phase 挡住 */
    assert.ok(run.shopHalfPending === undefined || typeof run.shopHalfPending === 'number');
  });

  check('界面冒烟：完成一次购买/交换都会让店收摊（返回不收摊、交易收摊）', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.retryToken = 9;
    c.TowerUI.openMintShop();
    ui.click('mintbuy1');
    assert.equal(run.shop, null, '买完就收摊');
    assert.equal(run.phase, null);
  });

  check('调试台：可以立即生成一个铸币商店（不占本组自然刷出的名额）', () => {
    const c = setup(7);
    const run = c.Tower._debugRun('endless');
    run.mintGroup = -1;
    c.Tower._debugSetNoMintShop(true);                   // 就算关掉了自动刷出，也能手开一家
    const r = c.Tower._debugSpawnMintShop();
    assert.ok(r.ok, '应当生成成功：' + (r.msg || ''));
    assert.equal(r.layer, 7);
    assert.equal(r.slots, c.TowerData.MINT_SHOP.shelf);
    assert.equal(run.phase, 'shop', '生成后直接进商店阶段');
    assert.ok(run.shop && run.shop.mint, '是铸币商店');
    assert.equal(run.mintGroup, -1, '不该吃掉「本组已刷过」的名额');
    const src = fs.readFileSync(path.join(ROOT, 'js', 'debug.js'), 'utf8');
    assert.ok(/data-mint-shop/.test(src) && /_debugSpawnMintShop/.test(src), '调试面板要接上这个接口');
  });

  check('调试面板真的渲染出「铸币商店」「普通商店」，点它就能开一家（载入真 debug.js）', () => {
    const c = setup(7);
    const T = c.Tower;
    T._debugSetEndlessLayer(7);
    const run = T._debugRun('endless');
    run.mintGroup = -1;
    const ui = debugHarness(c);
    assert.ok(c.window.Debug && c.window.Debug.open, '应当挂上 window.Debug：' + Object.keys(c.window.Debug || {}).length);
    const panel = ui.find('data-mint-shop');
    assert.ok(panel, '面板 HTML 里应当有 data-mint-shop 按钮');
    assert.ok(panel.innerHTML.includes('>铸币商店<'), '按钮文案缩减为「铸币商店」');
    assert.ok(panel.innerHTML.includes('>普通商店<'), '同一行还应当有「普通商店」按钮');
    assert.ok(/data-shop="1"/.test(panel.innerHTML), '普通商店按钮要挂 data-shop');
    assert.ok(/data-endless-layer="1"/.test(panel.innerHTML) && /data-endless-layer="-1"/.test(panel.innerHTML),
      '还应当有层数 ±1 的快速爬塔按钮');
    /* 点它：build() 与这里拿的是同一个元素（querySelector 按选择器缓存），所以 onclick 已经接好 */
    const btn = panel.querySelector('[data-mint-shop]');
    assert.equal(typeof btn.onclick, 'function', '按钮要绑上点击处理');
    btn.onclick();
    assert.equal(run.phase, 'shop', '点一下就该开出一家店');
    assert.ok(run.shop && run.shop.mint, '而且还必须是铸币商店');
    assert.equal(run.mintGroup, -1, '手开的店不占自然刷出的名额');
  });

  check('调试台无尽塔专属：试炼币 / 铸币的数量夹取、累加与「没有对局」的报错（需求142）', () => {
    const c = setup(7);
    const T = c.Tower;
    const run = T._debugRun('endless');
    const coins0 = run.coins, mint0 = Math.max(0, Number(run.retryToken) || 0);
    /* 试炼币：加法、累加、夹在 1~1000000（空输入 / 0 / 负数都按 1） */
    const r1 = T._debugGrantCoins(500);
    assert.deepEqual([r1.ok, r1.amount, r1.total], [true, 500, coins0 + 500], '试炼币 +500：' + JSON.stringify(r1));
    assert.equal(T._debugRun('endless').coins, coins0 + 500, '写进了 run.coins');
    assert.equal(T._debugGrantCoins(250).total, coins0 + 750, '可以连续加');
    assert.equal(T._debugGrantCoins('').amount, 1, '空输入按 1');
    assert.equal(T._debugGrantCoins(0).amount, 1, '0 也按 1（与「快速获取物品 / 武技」同口径）');
    assert.equal(T._debugGrantCoins(99).amount, 99, '字符串数字也认');
    assert.equal(T._debugGrantCoins(1e9).amount, 1000000, '上限 1000000');
    assert.equal(T._debugGrantCoins(-5).amount, 1, '负数按 1');
    /* 铸币（内部字段 run.retryToken，试炼商店 50 试炼币 1 枚那种） */
    const r2 = T._debugGrantMint(10);
    assert.deepEqual([r2.ok, r2.amount, r2.total], [true, 10, mint0 + 10], '铸币 +10：' + JSON.stringify(r2));
    assert.equal(T._debugRun('endless').retryToken, mint0 + 10, '写进了 run.retryToken');
    assert.equal(T._debugGrantMint(1000000).amount, 100000, '上限 100000');
    assert.equal(T._debugGrantMint('7').amount, 7, '字符串数字也认');
    /* 只进局内经济：不加分、不改层数、不推进层内进度 */
    assert.equal(T._debugRun('endless').score, 0, '不该加分');
    assert.equal(T._debugRun('endless').layer, run.layer, '不该改层数');
    assert.equal(T._debugRun('endless').idx, run.idx, '不该推进层内进度');
    /* 没有对局时给明确提示，而且**不会**顺手开一局（与「层数 ±1」刻意区分） */
    T.abandon('endless');
    const noRun = T._debugGrantCoins(100);
    assert.equal(noRun.ok, false, '没有对局时应当失败');
    assert.match(noRun.msg, /无尽塔对局/, '提示要说清原因：' + noRun.msg);
    assert.equal(T._debugRun('endless'), null, '不该凭空开一局');
    assert.equal(T._debugGrantMint(10).ok, false, '铸币也是同一口径');
  });

  check('调试面板：填数量 → 点「获得」即可拿到对应的试炼币 / 铸币（载入真 debug.js 真点击）', () => {
    const c = setup(7);
    const T = c.Tower;
    const run = T._debugRun('endless');
    const coins0 = run.coins, mint0 = Math.max(0, Number(run.retryToken) || 0);
    const ui = debugHarness(c);
    const panel = ui.find('data-endless-grant-coins');
    assert.ok(panel, '面板 HTML 里应当有 data-endless-grant-coins 按钮');
    assert.ok(/type="number" data-endless-coins/.test(panel.innerHTML), '试炼币那一行要有数量输入框');
    assert.ok(/type="number" data-endless-mint/.test(panel.innerHTML), '铸币那一行要有数量输入框');
    /* build() 与这里拿的是同一个元素（querySelector 按选择器缓存），所以输入框与 onclick 都已经接好 */
    panel.querySelector('[data-endless-coins]').value = '777';
    const coinBtn = panel.querySelector('[data-endless-grant-coins]');
    assert.equal(typeof coinBtn.onclick, 'function', '试炼币「获得」要绑上点击处理');
    coinBtn.onclick();
    assert.equal(T._debugRun('endless').coins, coins0 + 777, '点一下应当加 777 试炼币');
    panel.querySelector('[data-endless-mint]').value = '12';
    const mintBtn = panel.querySelector('[data-endless-grant-mint]');
    assert.equal(typeof mintBtn.onclick, 'function', '铸币「获得」要绑上点击处理');
    mintBtn.onclick();
    assert.equal(T._debugRun('endless').retryToken, mint0 + 12, '点一下应当加 12 铸币');
    /* 界面读的是 endlessInfo().run（无尽首页右上角的试炼币与铸币）—— 快照也要跟上 */
    assert.equal(T.endlessInfo().run.coins, coins0 + 777, '无尽主界面快照要拿到新的试炼币余额');
    assert.equal(T.endlessInfo().run.retryToken, mint0 + 12, '铸币余额同样要进快照');
    /* 反馈文案：面板底部的 .debug-msg 要写清加了多少、现在多少 */
    const out = panel.querySelector('.debug-msg');
    assert.match(String(out.textContent), /铸币 \+12（现有 \d+ 枚）/, '要点出加了 12 枚与现有多少：' + out.textContent);
  });

  check('出售增益列表：按获得先后倒序（最新在最上），虚空铭文附魔的沉到最后', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    const T = c.Tower;
    c.__rand(0.99);
    const run = T._debugRun('endless');
    run.permanent = []; run.limited = []; run.slotFreeIds = []; run.acqSeq = 0;
    assert.ok(T.debugGrantBuff('E01').ok, '拿一张立即进货：战后会开试炼商店');
    const rw = winOne(c);
    assert.equal(rw.postBattleShop, true, 'E01 应当开出一家战后商店');
    assert.equal(run.limited.length, 0, 'E01 用完即走（不占出售列表）');
    /* 按顺序拿三条：磨砺（永久）→ 蓄力一击（限次）→ 坚韧壁垒（永久，最新） */
    assert.ok(T.debugGrantBuff('C02').ok, '拿磨砺');
    assert.ok(T.debugGrantBuff('N01').ok, '拿蓄力一击');
    assert.ok(T.debugGrantBuff('C05').ok, '拿坚韧壁垒');
    /* 首页按钮 → 进店（与真人操作同一条路径） */
    const renderShop = () => {
      c.TowerUI.openEndless();
      assert.ok(ui.last('page').content.includes('进入试炼商店'), '首页应当提示进店');
      ui.click('fight');
    };
    renderShop();
    const sellSection = (h) => h.slice(h.indexOf('出售增益'));
    const pos = (s) => ({ m: s.indexOf('磨砺'), n: s.indexOf('蓄力一击'), j: s.indexOf('坚韧壁垒') });
    let sell = sellSection(ui.last('page').content);
    assert.ok(sell.length > 10, '应当切到出售区：' + sell.slice(0, 120));
    let p = pos(sell);
    assert.ok(p.m >= 0 && p.n >= 0 && p.j >= 0, '三条都该在出售列表里：' + sell.slice(0, 240));
    assert.ok(p.j < p.n && p.n < p.m,
      '渲染顺序应当是 坚韧壁垒 → 蓄力一击 → 磨砺（获得先后倒序，最新在最上）：' + JSON.stringify(p));
    assert.ok(!sell.includes('最新拿到的在最上'),
      '排序说明文字已按用户口径删掉（排序行为本身不变，见上一行的顺序断言）');
    /* 给**最新那条**附魔：它应当从第一行掉到最后一行，并带上提示 */
    run.slotFreeIds = ['C05'];
    renderShop();
    sell = sellSection(ui.last('page').content);
    p = pos(sell);
    assert.ok(p.n < p.m && p.m < p.j, '附魔过的坚韧壁垒要沉到最后：' + JSON.stringify(p));
    assert.ok(sell.includes('虚空铭文 · 不占位'), '附魔的那条要有提示标记：' + sell.slice(0, 240));
    /* 【第七十四批】水晶铭文（C60，效果 ×1.5）在这个列表里也要有自己的标记（原来只有红框）。 */
    const row05 = T.ownedBuffs('endless').find((b) => b.id === 'C05');
    assert.ok(row05, '坚韧壁垒应当还在手里');
    assert.ok(T.debugGrantBuff('C60').ok, '拿一张水晶铭文');
    assert.ok(T.applyPickBuff('permBuff', row05.uid).ok, '给坚韧壁垒附上水晶铭文');
    assert.equal(T.ownedBuffs('endless').find((b) => b.id === 'C05').enchMul, 1.5, '这一条现在 ×1.5');
    renderShop();
    sell = sellSection(ui.last('page').content);
    assert.ok(sell.includes('水晶铭文 · 效果 ×1.5'), '水晶附魔的那条要标出倍率：' + sell.slice(0, 300));
    assert.ok(sell.includes('虚空铭文 · 不占位'), '虚空那枚标记不该被挤掉');
    /* ⚠ 无尽塔**主面板**（「永久增益」那一块，玩家一直盯着的地方）也必须带框 ——
     * 用户实测「水晶铭文看不到效果」就是这里漏的：buffPanelsHtml 自己拼 .buff-tag，
     * 原来只认 slot-free，水晶的类名根本没上去。所有渲染器现在共用 enchCls()。
     * 这一条同时吃了虚空（slotFree）与水晶（×1.5）→ 正确的类名是 `ench-both`（半红半青）。 */
    c.TowerUI.openEndless();
    const home = ui.last('page').content;
    const tags = home.match(/class="buff-tag r\d[^"]*"/g) || [];
    assert.ok(tags.some((t) => /ench-both|ench-crystal/.test(t)),
      '主面板上水晶附魔的那条要带上附魔类名，实测：' + tags.join(' | '));
    assert.ok(tags.some((t) => /ench-both/.test(t)),
      '同时吃了虚空与水晶的那条应当是 ench-both：' + tags.join(' | '));
    assert.ok(/<i>[^<]*· ×1\.5<\/i>/.test(home),
      '主面板上还要写清倍率：' + home.slice(Math.max(0, home.indexOf('永久增益')), home.indexOf('永久增益') + 400));
    /* 卖出依旧可用（只是顺序变了） */
    const before = run.coins;
    assert.ok(T.sellBuff('C05').ok, '卖出照样能用');
    assert.ok(T._debugRun('endless').coins > before, '卖出应当加试炼币');
  });

  check('铸币商店的「免费交换」列表用同一套顺序', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    const T = c.Tower;
    c.__rand(0);
    winOne(c);
    const run = T._debugRun('endless');
    run.permanent = []; run.limited = []; run.slotFreeIds = []; run.acqSeq = 0;
    T.debugGrantBuff('C02');
    T.debugGrantBuff('N01');
    T.debugGrantBuff('C05');
    run.slotFreeIds = ['C05'];
    run.shop.swapOpen = true;                       // 等价交换已买下，页面才展开列表
    c.TowerUI.openMintShop();
    const html = ui.last('page').content;
    /* 从「选择一件拿出去的增益」小节往后切（货架在它前面，免得撞上同名商品） */
    const swap = html.slice(html.lastIndexOf('拿出去的增益'));
    const p = { m: swap.indexOf('磨砺'), n: swap.indexOf('蓄力一击'), j: swap.indexOf('坚韧壁垒') };
    assert.ok(p.n >= 0 && p.j >= 0 && p.m >= 0, '三条都该在交换列表里：' + swap.slice(0, 240));
    assert.ok(p.n < p.m && p.m < p.j, '交换列表同样：最新在最上 + 附魔沉最后：' + JSON.stringify(p));
  });

  check('铭文三选一：只标注**这张**铭文附魔过的增益（虚空 / 水晶各按各的）', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    const T = c.Tower;
    const run = T._debugRun('endless');
    /* 2026-10 修正后：没有 stackable 标签的件不再同栏叠层，
     * 所以「层数照旧显示」这条要用**可以合法叠层**的件来验证（C22 闪避精通，上限 3）。 */
    run.permanent = [{ id: 'C02', stacks: 1 }, { id: 'C22', stacks: 2 }, { id: 'C11', stacks: 1 }];
    run.limited = [];
    run.slotFreeIds = ['C22'];                       // 闪避精通已经附魔过（虚空铭文）
    run.pendingPick = { kind: 'permBuff', buffId: 'C37' };
    c.TowerUI.openPickBuff(run.pendingPick);
    const m = ui.last('modal');
    assert.ok(m, '应当弹出三选一');
    assert.equal(m.title, '附魔 · 选一个永久增益');
    const labels = (m.buttons || []).map((b) => b.label);
    assert.equal(labels.length, 3, '三个候选：' + JSON.stringify(labels));
    const done = (m.buttons || []).filter((b) => /已附魔/.test(b.label));
    assert.equal(done.length, 1, '只有一个候选被标「已附魔」：' + JSON.stringify(labels));
    assert.ok(/闪避精通/.test(done[0].label), '标的正是已经附魔的那条：' + done[0].label);
    assert.ok(/×2 层/.test(done[0].label), '层数照旧显示：' + done[0].label);
    /* 【第七十八批 用户口径】标记后面**不要再跟括号**（哪张铭文 / 什么效果 / 再选没有收益）——
     * 已附魔那条只写「名称 + ×N 层 · 已附魔」。 */
    assert.equal(done[0].label, '闪避精通\n×2 层 · 已附魔', '已附魔那行只留名称、层数与「已附魔」：' + done[0].label);
    assert.ok(!/（|\(/.test(done[0].label), '不该再有括号说明：' + done[0].label);
    assert.ok(/pick-done/.test(done[0].cls), '标记的那张要有独立样式：' + done[0].cls);
    for (const b of (m.buttons || [])) {
      if (/闪避精通/.test(b.label)) continue;          // 已附魔的那张跳过（它本来就带标记）
      assert.ok(!/已附魔/.test(b.label), '没附魔的不该被标：' + b.label);
      assert.ok(/gold/.test(b.cls), '未附魔的保持金色可选样式：' + b.cls);
    }
    /* 说明文字也大幅精简（第七十八批）：一句「选中的这条怎样」+ 一句「已附魔的再选没有收益」。 */
    assert.equal(m.content, '<p>选一个永久增益：被选中的这一条本局不再占用永久位。标着「已附魔」的再选没有收益。</p>',
      '说明文案要精简：' + m.content);
    /* 只是「标注」，不禁用：点了仍然能走完流程 */
    const btn = (m.buttons || []).find((b) => /闪避精通/.test(b.label));
    btn.run();
    assert.ok((run.slotFreeIds || []).indexOf('C22') >= 0, '已经附魔的仍是附魔状态');
    assert.equal(run.pendingPick, null, '选完清掉待选取');

    /* 【第七十六批 用户口径】换一张铭文（水晶铭文 C60，×1.5）触发三选一时，
     * **只标注被这一张附魔过的**：被**虚空**附魔过的那条不再被标成「已附魔」
     *（它还能吃水晶，选它是完全正常的收益）。
     * 【第七十八批】行内文案进一步精简：别的铭文那点说明（「另有 …」）也不再写，
     * 候选行只剩「名称 + 层数」。 */
    const run2 = T._debugRun('endless');
    run2.permanent = [
      { id: 'C02', stacks: 1, enchants: ['C60'], enchMul: 1.5 },   // 已经吃过水晶铭文（候选里会被过滤掉）
      { id: 'C22', stacks: 2, slotFree: true },                    // 被虚空铭文附魔过
      { id: 'C11', stacks: 1 },                                    // 干净的
    ];
    run2.slotFreeIds = ['C22'];
    run2.pendingPick = { kind: 'permBuff', buffId: 'C60', mul: 1.5 };
    c.TowerUI.openPickBuff(run2.pendingPick);
    const m2 = ui.last('modal');
    const labels2 = (m2.buttons || []).map((b) => b.label);
    assert.ok(labels2.length, '水晶弹窗也要有候选：' + JSON.stringify(labels2));
    assert.match(m2.title, /水晶铭文/, '标题要写清这次是哪张铭文：' + m2.title);
    assert.equal((m2.buttons || []).filter((b) => /已附魔/.test(b.label)).length, 0,
      '吃过水晶的那条已被候选过滤掉，所以不该有「已附魔」的标记：' + JSON.stringify(labels2));
    const freeRow = (m2.buttons || []).find((b) => /闪避精通/.test(b.label));
    assert.ok(freeRow, '被虚空附魔过的那条仍应是候选：' + JSON.stringify(labels2));
    assert.ok(!/已附魔/.test(freeRow.label),
      '它**不该**被标成这张铭文的「已附魔」（虚空 ≠ 水晶）：' + freeRow.label);
    assert.equal(freeRow.label, '闪避精通\n×2 层', '候选行只留名称 + 层数（第七十八批精简）：' + freeRow.label);
    assert.ok(!/铭文|（|\(/.test(freeRow.label), '行里不再提别的铭文、也不再带括号：' + freeRow.label);
    assert.ok(/gold/.test(freeRow.cls), '它仍是可选的金色样式：' + freeRow.cls);
  });

  check('商店货架：传奇档（r3）要有自己的样式，不再是普通档的样子', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    const T = c.Tower;
    c.__rand(0.99);
    winOne(c);
    const run = T._debugRun('endless');
    run.phase = 'shop';
    run.choices = null;
    /* 货架上摆一张传奇（C14 涅槃，rarity 3）+ 一张普通（N01 蓄力一击，rarity 0）对照。 */
    run.shop = Object.assign({}, run.shop || {}, {
      layer: run.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0,
      slots: [{ id: 'C14', sold: false, price: 100 }, { id: 'N01', sold: false, price: 30 }],
    });
    c.TowerUI.openShop();
    const html = ui.last('page').content;
    const slots = html.match(/class="shop-slot [^"]*"/g) || [];
    assert.ok(slots.some((s) => /\br3\b/.test(s)), '传奇那一格要带 r3 类名：' + slots.join(' | '));
    assert.ok(slots.some((s) => /\br0\b/.test(s)), '普通那一格还是 r0：' + slots.join(' | '));
    /* 样式：与背包栏里的传奇增益（.buff-tag.r3）**同色**（金描边 + 金色渐变填充）。 */
    const css = fs.readFileSync(path.join(ROOT, 'css/tower.css'), 'utf8').replace(/\r\n/g, '\n');
    const r3 = (/\.shop-slot\.r3\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
    assert.ok(/border-color:\s*#d9a12a/.test(r3), '传奇货架的描边要与 buff-tag.r3 同色：' + r3);
    assert.ok(/linear-gradient\(#fff6c8,\s*#ffe08a\)/.test(r3), '填充也要用 buff-tag.r3 那套金色渐变：' + r3);
  });

  check('试炼商店画幅上移，返回键缩到略大于继续挑战', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0.99);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.phase = 'shop'; run.choices = null;
    run.shop = Object.assign({}, run.shop || {}, {
      layer: run.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0,
      slots: [{ id: 'C14', sold: false, price: 100 }],
    });
    c.TowerUI.openShop();
    const page = ui.last('page');
    assert.match(String(page.opts.pageClass || ''), /tower-shop-page/, '商店页要带专用画幅类');
    const css = fs.readFileSync(path.join(ROOT, 'css/tower.css'), 'utf8').replace(/\r\n/g, '\n');
    assert.match(css, /\.classic-page\.classic-tower\.tower-shop-page > \.classic-board\s*\{\s*top:\s*58px/,
      '商店底板要上移');
    assert.match(css, /\.classic-page\.tower-shop-page > \.page-footer > \.uc-button\[data-action="home"\]\s*\{[^}]*width:\s*350px[^}]*height:\s*100px/,
      '返回键 350×100，略大于继续挑战的 320×96');
  });

  check('界面冒烟：讨价还价待兑现份数显示在无尽首页', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    winOne(c);
    assert.ok(c.Tower.debugGrantBuff('E14').ok, '拿一份讨价还价');
    assert.equal(c.Tower.shopHalfPendingOf(), 1);
    c.TowerUI.openEndless();
    const page = ui.last('page');
    assert.ok(page.content.includes('讨价还价 ×1'), '首页要显示待兑现份数：' + page.content.slice(0, 120));
    assert.ok(page.content.includes('下次进店 1 件对折'), '并写清兑现方式');
  });

  check('界面冒烟：C59 门庭若市在铸币商店页兑现（领一次 + 显示试炼币）', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    assert.ok(c.Tower.debugGrantBuff('C59').ok);
    winOne(c);
    assert.equal(c.Tower.shopState().enterCoins, 80, '进店就发 80 试炼币');
    c.TowerUI.openMintShop();
    const page = ui.last('page');
    assert.ok(page.content.includes('试炼币'), '标题上要能看见试炼币余额：' + page.content.slice(0, 140));
    assert.equal(c.Tower.shopState().enterCoins, 0, '界面已经把进门币领掉了（只飘一次字）');
  });

  check('战斗失败的「重新挑战」是必选窗：没有关闭叉，退出重进也绕不过', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    const T = c.Tower;
    const run = T._debugRun('endless');
    run.retryToken = 2;
    run.choices = null; run.choiceQueue = []; run.phase = null; run.env = []; run.noEnvRoll = true;
    delete run.attempt;
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
    const rw = T.reportBattle('endless', nx.token, false, 0);
    assert.equal(rw.retryable, true, '有铸币时失败要先给「重新挑战 / 放弃本局」');
    assert.ok(run.pendingRetry, '失败后要记下「这个窗还没选」');
    assert.equal(T.nextBattle('endless').ok, false, '窗没处理之前不能再开一场（不能白打）');

    /* 退出重进：这个必选窗要跟着存档走，重进后仍然拦住下一场。 */
    c.State.save(); c.State.load();
    assert.ok(T._debugRun('endless').pendingRetry, '存档往返后 pendingRetry 要保留');
    assert.equal(T.nextBattle('endless').ok, false, '重进后仍然不能白打');

    ui.rendered.length = 0;
    c.TowerUI.openEndless();
    const m = ui.last('modal');
    assert.ok(m && /本场失利/.test(m.title), '重进无尽塔要重新弹出必选窗');
    assert.equal(m.opts.locked, true, '必选窗不能有右上角关闭叉（modal locked）');
    assert.equal(m.buttons.map((b) => b.label).sort().join(','), '放弃本局,重新挑战',
      '只能二选一：重新挑战 / 放弃本局');

    c.Main = { startBattle: () => Promise.resolve(), showHome: () => {} };
    const before = T._debugRun('endless').retryToken;
    ui.modalButton('重新挑战').run();
    assert.equal(T._debugRun('endless').retryToken, before - 1, '重新挑战要扣 1 枚铸币');
    assert.ok(!T._debugRun('endless').pendingRetry, '选过之后标记要清掉');
    /* 【2026-10-28 用户口径】铸币复活回滚完停在开战前的准备页，不再自动开打。 */
    assert.ok(!T._debugRun('endless').attempt, '点「重新挑战」只回滚，不自动开打');
  });

  check('战斗掉落的待选增益：退出重进不丢，重打同一场也不能刷新选项', () => {
    const c = setup(7);
    const T = c.Tower;
    c.__rand(0.99);                              // 不让铸币商店 / 回响等概率事件掺进来
    const run = T._debugRun('endless');
    run.choices = null; run.choiceQueue = []; run.phase = null; run.env = []; run.noEnvRoll = true;
    delete run.attempt; delete run.pendingRetry;
    run.idx = 2;                                 // 第 3 场之后是 4 场层的普通战斗掉落
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
    const rw = T.reportBattle('endless', nx.token, true, 1000, 1000, null);
    assert.ok(rw.choices && rw.choices.length, '第 3 场之后应当给战斗掉落');
    const first = rw.choices.map((ch) => ch.id).join(',');

    /* 退出重进：待选增益要跟存档走，不能白丢一次掉落。 */
    c.State.save(); c.State.load();
    const loaded = T._debugRun('endless');
    assert.equal((loaded.choices || []).map((ch) => ch.id).join(','), first, '读档后待选增益要原样保留');
    assert.equal(T.nextBattle('endless').ok, false, '没选之前不能开下一场');

    /* 退出重进后重打同一场：即使换掉全局随机流，掉落也必须还是那一组（不能刷新）。 */
    c.__rand(0.99);                              // 换一条随机流，顺带压掉回响/商店的概率事件
    const live = T._debugRun('endless');
    const snap = live.retrySnap;
    assert.ok(snap, '战前快照要留着');
    for (const k of Object.keys(live)) delete live[k];
    Object.assign(live, JSON.parse(JSON.stringify(snap)));
    const nx2 = T.nextBattle('endless');
    assert.ok(nx2 && nx2.ok !== false, '重打同一场应当能开战：' + ((nx2 && nx2.msg) || ''));
    const rw2 = T.reportBattle('endless', nx2.token, true, 1000, 1000, null);
    assert.equal((rw2.choices || []).map((ch) => ch.id).join(','), first,
      '重打同一场不能换一组战斗掉落（旧版可被退出重刷）');
  });

  check('渴血之剑：献祭 / 活性事件都是没有关闭叉的必选窗', () => {
    /* 献祭窗 */
    {
      const c = setup(7);
      const ui = uiHarness(c);
      c.Tower.debugGrantBuff('HB01');
      c.Tower.debugGrantBuff('C57');
      const run = c.Tower._debugRun('endless');
      run.bladeSacrificePending = true;
      ui.rendered.length = 0;
      c.TowerUI.openEndless();
      const m = ui.last('modal');
      assert.ok(m && /渴血之剑/.test(m.title), '战后应当弹献祭窗');
      assert.equal(m.opts.locked, true, '献祭窗不能有右上角关闭叉');
      assert.ok(/C57|破军/.test(m.content) || /史诗/.test(m.content), '窗口里要列出祭品');
    }
    /* 活性事件窗 */
    {
      const c = setup(7);
      const ui = uiHarness(c);
      c.Tower.debugGrantBuff('HB01');
      const run = c.Tower._debugRun('endless');
      run.layer = 51; run.plan = [{ kind: 'hero', anim: 'tl' }]; run.idx = 0;
      c.Tower._debugSetEndlessLayer(51);
      assert.ok(c.Tower._debugRun('endless').bladeEventPending, '51 层应当有活性事件');
      ui.rendered.length = 0;
      c.TowerUI.openEndless();
      const m = ui.last('modal');
      assert.ok(m && /活性/.test(m.title), '应当弹活性事件窗');
      assert.equal(m.opts.locked, true, '活性事件窗不能有右上角关闭叉');
      assert.equal(m.buttons.map((b) => b.label).sort().join(','), '增强活性,抑制活性');
    }
  });

  check('同一份 run.shop 上，两套 API 互不越界', () => {
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    run.coins = 999;
    run.retryToken = 3;
    assert.ok(run.shop && run.shop.mint);
    assert.equal(c.Tower.buyShopSlot(0).ok, false, '试炼商店的买法不能在铸币商店里用');
    assert.equal(c.Tower.rerollShop().ok, false, '试炼商店的刷新不能在铸币商店里用');
    assert.equal(c.Tower.sellBuff('C01').ok, false, '铸币商店里不卖增益');
    assert.equal(c.Tower.buyRetryToken().ok, false, '铸币商店里不卖铸币');
    assert.equal(c.Tower.settleFromShop().ok, false, '铸币商店不给结算离场');
    assert.equal(run.coins, 999, '被拒绝的操作不该扣试炼币');
    assert.equal(run.retryToken, 3, '被拒绝的操作不该扣铸币');
    assert.ok(run.shop && run.shop.mint, '店还开着');
    /* 反过来：试炼商店不能被铸币商店的 API 买走 / 送客 */
    run.shop = { mint: false, layer: 10, boundary: true, slots: [{ id: 'C01', sold: false, price: 60 }], rerollFree: true, rerollCount: 0 };
    run.phase = 'shop';
    assert.equal(c.Tower.buyMintSlot(0).ok, false, '试炼商店不能用铸币买');
    assert.equal(c.Tower.rerollMintShop().ok, false, '试炼商店不能用铸币商店的免费刷新');
    assert.equal(c.Tower.leaveMintShop().ok, false, '试炼商店不能「送客」（要走 closeShop / 结算）');
    assert.ok(run.shop, '试炼商店应当还在');
  });
}

/* ============================================================ */
hr('9. 商店「离开」不被锁住（E01 立即进货 / 每 5 层结算商店）');
{
  /** 打赢当前这一场（不清店 —— E01 的店就是这一场之后开的）。 */
  const winHere = (c) => {
    const r = c.Tower._debugRun('endless');
    if (r.choices) r.choices = null;
    if (!r.phase) { /* 正常 */ }
    const nx = c.Tower.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能开下一场：' + ((nx && nx.msg) || ''));
    return c.Tower.reportBattle('endless', nx.token, true, 1500, 2000);
  };

  check('E01「立即进货」：从首页进店 → 点「继续挑战」真的出得来', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0.99);
    assert.ok(c.Tower.debugGrantBuff('E01').ok, '先拿一张立即进货');
    const rw = winHere(c);
    assert.equal(rw.postBattleShop, true, 'E01 应当开了战后商店');
    const run = c.Tower._debugRun('endless');
    assert.equal(run.phase, 'shop');
    assert.equal(run.shop.postBattle, true, '这家店是「战后立即进货」开的');
    /* 首页 → 进店 → 离开（用户报的就是这一段出不去） */
    c.TowerUI.openEndless();
    const main = ui.last('page');
    assert.ok(main.content.includes('进入试炼商店'), '首页按钮应当提示进店：' + main.content.slice(0, 80));
    ui.click('fight');                              // phase==='shop' → openShop()
    const shopPage = ui.last('page');
    assert.ok(shopPage.content.includes('试炼商店'), '应当是试炼商店页');
    ui.click('leave');                              // 「继续挑战」
    const after = c.Tower._debugRun('endless');
    assert.equal(after.phase, null, '离开之后 phase 必须归位（否则玩家被锁在店里）');
    assert.equal(after.shop, null, '店本身也应当收掉');
    const back = ui.last('page');
    assert.ok(back.content.includes('继续战斗'), '首页按钮应当回到「继续战斗」：' + back.content.slice(0, 140));
    /* 而且真的能继续打（原来 phase 还是 'shop'，nextBattle 会被挡下） */
    const nx2 = c.Tower.nextBattle('endless');
    assert.ok(nx2 && nx2.ok !== false, '应当能直接继续战斗：' + ((nx2 && nx2.msg) || ''));
    assert.equal(c.Tower.reportBattle('endless', nx2.token, true, 1500, 2000).ok, true, '这一场也应当能正常结算');
  });

  check('每 5 层结算商店：点「继续挑战」推进到下一段', () => {
    const c = setup(5);
    const ui = uiHarness(c);
    c.__rand(0.99);
    for (let i = 0; i < 4; i++) winOne(c);           // 第 5 层 4 场全胜 → 层通商店
    const run = c.Tower._debugRun('endless');
    assert.equal(run.phase, 'shop');
    assert.equal(run.shop.boundary, true, '这是每 5 层的结算商店');
    c.TowerUI.openEndless();
    ui.click('fight');
    assert.ok(ui.last('page').content.includes('试炼商店'));
    ui.click('leave');
    const after = c.Tower._debugRun('endless');
    assert.equal(after.layer, 6, '应当推进到下一段');
    assert.equal(after.phase, null);
    assert.equal(after.shop, null);
  });

  check('休整商店（rest）离开后也能继续打', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0.99);
    const run = c.Tower._debugRun('endless');
    run.choices = [{ type: 'buff', id: 'C02' }];
    run.restShopUsed = false;
    run.phase = null;
    assert.ok(c.Tower.openRestShop().ok, '应当能开休整商店');
    assert.equal(c.Tower.shopState().rest, true);
    /* 休整商店是从「休整点选牌」那一刻开的；测试里先清掉 choices，
     * 否则首页的按钮会先去催选牌（走不到进店分支）。 */
    c.Tower._debugRun('endless').choices = null;
    /* 休整商店页没有进店按钮，直接渲染商店页再点离开 */
    c.TowerUI.openEndless();
    ui.click('fight');                               // phase==='shop' → openShop()
    assert.ok(ui.last('page').content.includes('试炼商店'));
    ui.click('leave');
    const after = c.Tower._debugRun('endless');
    assert.equal(after.phase, null, '离开休整商店后应当回去继续打');
    assert.equal(after.shop, null);
  });
}

/* ============================================================ */
hr('9b. 试炼商店卡面紧凑化（2026-10 用户口径：不用翻页就能刷新）');
{
  check('卡面介绍 ≤6 行、不带「同名唯一 / 用尽后才可能再获得」，刷新格不写稀有度期望', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0.99);
    assert.ok(c.Tower._debugSpawnShop().ok, '应当能开店');
    const run = c.Tower._debugRun('endless');
    /* 固定成最长的几条：后发制人 / 挥金如土 / 立即进货 / 浴血重生 / 豪掷千金。 */
    run.shop.slots = [
      { id: 'C55', sold: false, price: 10 }, { id: 'C36', sold: false, price: 20 },
      { id: 'E01', sold: false, price: 30 }, { id: 'C46', sold: false, price: 40 },
      { id: 'C58', sold: false, price: 50 },
    ];
    c.TowerUI.openShop();
    const page = ui.last('page');
    assert.ok(page.content.includes('class="shop-desc"'), '卡面介绍要用 shop-desc（完整文案进 title）');
    assert.ok(!/同名唯一|用尽后才可能再获得|一局只可能拿到一次|拿满后本局不再出现/.test(page.content),
      '商店短介绍不该再追加生命周期提示');
    assert.ok(!page.content.includes('期望史诗') && !page.content.includes('越贵越好'),
      '刷新格不该再展示稀有度期望（越贵越好是隐性规则）');
    const css = fs.readFileSync(path.join(ROOT, 'css/tower.css'), 'utf8');
    assert.match(css, /\.shop-slot \.shop-desc\s*\{[^}]*-webkit-line-clamp:\s*6/s, 'CSS 要把卡面硬压到 6 行');
  });
}

/* ============================================================ */
hr('10. 铸币商队（E16）：下一场战斗后必开一家铸币商店，顶掉普通商店');
{
  const E16 = (c) => c.TowerData.BUFF_BY_ID.E16;

  check('数据：稀有 · 限次 1 · 下一场战斗生效 · 挂 postBattleMintShop（无尽专属 mod）', () => {
    const c = setup(7);
    const b = E16(c);
    assert.ok(b, '应当有铸币商队（E16）');
    assert.equal(b.rarity, 1, '用户口径：稀有');
    assert.equal(b.kind, 'limited', '限次类');
    assert.equal(b.uses, 1, '限次 1');
    for (const t of ['endless', 'battle', 'shop', 'limited', 'nextBattle', 'ops']) {
      assert.ok(c.TowerData.hasTag(b, t), 'E16 应当带标签 ' + t + '：' + JSON.stringify(b.tags));
    }
    assert.ok(!c.TowerData.hasTag(b, 'tower'), 'E16 是无尽塔专属');
    assert.equal(b.mods.postBattleMintShop, 1, '效果键');
    assert.ok(c.TowerData.ENDLESS_ONLY_MODS.indexOf('postBattleMintShop') >= 0, '要登记进 ENDLESS_ONLY_MODS');
    assert.ok(c.TowerData.endlessPool.some((x) => x.id === 'E16'), '要能作为战斗奖励 / 场间选择拿到');
    assert.ok(c.TowerData.shopPool.some((x) => x.id === 'E16'), '试炼商店也应当能卖');
    assert.ok(c.TowerData.mintPool.some((x) => x.id === 'E16'), '铸币商店的货架 / 交换池里也应当在');
  });

  check('层中开打：这一场打完直接开铸币商店，限次用完即走', () => {
    const c = setup(7);
    c.__rand(0.99);
    assert.ok(c.Tower.debugGrantBuff('E16').ok, '应当拿得到铸币商队');
    const rw = winOne(c);
    assert.equal(rw.mintShop, true, '这一场打完应当开铸币商店');
    assert.equal(rw.phase, 'shop');
    const run = c.Tower._debugRun('endless');
    assert.ok(run.shop && run.shop.mint === true, 'run.shop 应当是铸币商店');
    assert.equal(run.shop.byBuff, true, '要标记「这家店是限次增益触发的」');
    assert.equal((run.limited || []).some((b) => b.id === 'E16'), false, '限次 1 → 用掉就没了');
    assert.equal(run.mintGroup, -1, '额外送的一家店不该吃掉「本组自然刷出」的名额');
    assert.equal(c.Tower.shopState().byBuff, true, '界面快照也要能看出是它触发的');
    /* 铸币商店的离开：关店后回去继续打这一层 */
    assert.ok(c.Tower.leaveMintShop().ok, '应当能送客');
    assert.equal(c.Tower._debugRun('endless').phase, null, '送客后回到战斗流程');
    assert.equal(c.Tower._debugRun('endless').shop, null);
  });

  check('顶掉 E01：同场挂着「立即进货」时由铸币商店顶上（一次战斗只开一家店）', () => {
    const c = setup(7);
    c.__rand(0.99);
    assert.ok(c.Tower.debugGrantBuff('E01').ok, '拿一张立即进货');
    assert.ok(c.Tower.debugGrantBuff('E16').ok, '再拿一张铸币商队');
    const rw = winOne(c);
    assert.equal(rw.mintShop, true, '应当开铸币商店');
    assert.equal(rw.postBattleShop, undefined, '不该再开试炼商店');
    const run = c.Tower._debugRun('endless');
    assert.ok(run.shop && run.shop.mint === true, '只有铸币商店这一家');
    assert.equal((run.limited || []).length, 0, '两张限次都消耗在这一场');
  });

  check('x5 层（结算商店那一步）：铸币商店顶上，但关店后照旧推进到下一层', () => {
    const c = setup(5);
    c.__rand(0.99);
    for (let i = 0; i < 3; i++) winOne(c);              // 前三场正常打
    assert.ok(c.Tower.debugGrantBuff('E16').ok, '最后一场前拿一张铸币商队（它只服务「下一场」）');
    winOne(c);                                          // 第 5 层第 4 场 → 本该开结算商店
    const run = c.Tower._debugRun('endless');
    assert.equal(run.phase, 'shop');
    assert.ok(run.shop && run.shop.mint === true, '结算商店被顶成铸币商店');
    assert.equal(run.shop.boundary, true, '仍然带着「结算商店」的去向');
    assert.equal(c.Tower.leaveMintShop().ok, true, '应当能送客');
    const after = c.Tower._debugRun('endless');
    assert.equal(after.layer, 6, '送客后推进到下一段（不能卡在已清空的本层）');
    assert.equal(after.phase, null);
    assert.equal(after.shop, null);
  });

  check('x20 层：顶掉的结算商店仍要先「放弃一个永久增益」（不能把推进弄丢）', () => {
    const c = setup(20);
    c.__rand(0.99);
    assert.ok(c.Tower.debugGrantBuff('C02').ok, '先带一个永久增益');
    for (let i = 0; i < 4; i++) winOne(c);              // 20 是 x10 层：共 5 场，先打完前 4 场
    assert.ok(c.Tower.debugGrantBuff('E16').ok, '最后一场前拿一张铸币商队');
    winOne(c);                                          // 第 20 层第 5 场（塔顶首领）
    const run = c.Tower._debugRun('endless');
    assert.ok(run.shop && run.shop.mint === true && run.shop.boundary === true, '应当是顶掉的铸币商店');
    const left = c.Tower.leaveMintShop();
    assert.equal(left.phase, 'sacrifice', '20 层清完要先放弃一个永久增益：' + JSON.stringify(left));
    const after = c.Tower._debugRun('endless');
    assert.equal(after.phase, 'sacrifice');
    assert.equal(after.layer, 20, '还没推进到下一层');
    assert.ok(c.Tower.sacrificePerm('C02').ok, '放弃之后应当照常推进');
    assert.equal(c.Tower._debugRun('endless').layer, 21, '放弃完推进到第 21 层');
  });

  check('买 / 换之后收摊同样保留结算商店的去向（x5 层不会卡死）', () => {
    const c = setup(5);
    c.__rand(0.99);
    const run = c.Tower._debugRun('endless');
    for (let i = 0; i < 3; i++) winOne(c);
    run.retryToken = 9;
    assert.ok(c.Tower.debugGrantBuff('E16').ok, '最后一场前拿一张铸币商队');
    const rw = winOne(c);                              // 最后一场 → 顶掉结算商店
    assert.equal(rw.mintShop, true);
    const r2 = c.Tower._debugRun('endless');
    assert.ok(r2.shop && r2.shop.mint && r2.shop.boundary === true, '应当是顶掉的铸币商店');
    const at = r2.shop.slots.findIndex((s) => !s.swap && !s.sold);
    assert.ok(at >= 0, '应当有一件正常商品可买');
    const buy = c.Tower.buyMintSlot(at);
    assert.equal(buy.ok, true, '应当买得到：' + (buy.msg || ''));
    const after = c.Tower._debugRun('endless');
    assert.equal(after.shop, null, '买完收摊');
    assert.equal(after.layer, 6, '而且照旧推进到下一段');
    assert.equal(after.phase, null);
  });

  check('自然刷出照旧：没有 E16 时仍然是 5% 概率那一条路（不会被它改口径）', () => {
    const c = setup(7);
    c.__rand(0);
    const rw = winOne(c);
    assert.equal(rw.mintShop, true, '概率拉满时自然刷出');
    const run = c.Tower._debugRun('endless');
    assert.equal(run.mintGroup, c.TowerData.mintGroupOf(7), '自然刷出才记「本组已刷过」');
    assert.equal(!!run.shop.byBuff, false, '自然刷出的店不带「限次增益触发」标记');
    assert.equal(c.Tower.shopState().byBuff, false);
  });

  check('顶掉结算商店的那一家（boundary）补回「结算离场」；层中偶遇的铸币商店仍然没有', () => {
    /* ① 层中偶遇的铸币商店：照旧不给结算离场（它不在结算点上） */
    {
      const c = setup(7);
      const ui = uiHarness(c);
      c.__rand(0);
      winOne(c);
      const run = c.Tower._debugRun('endless');
      assert.ok(run.shop && run.shop.mint === true && !run.shop.boundary, '应当是自然刷出的铸币商店');
      c.TowerUI.openMintShop();
      assert.equal(String(ui.last('page').opts.left || ''), '', '页脚不该有结算离场');
      assert.equal(c.Tower.settleFromShop().ok, false, '层中偶遇的铸币商店不能结算离场');
    }
    /* ② 顶掉每 5 层结算商店的那一家：它站在结算点上 → 页面与 API 都要能结算离场 */
    {
      const c = setup(5);
      const ui = uiHarness(c);
      c.__rand(0.99);
      for (let i = 0; i < 3; i++) winOne(c);
      assert.ok(c.Tower.debugGrantBuff('E16').ok, '最后一场前拿一张铸币商队');
      winOne(c);
      const run = c.Tower._debugRun('endless');
      assert.ok(run.shop && run.shop.mint === true && run.shop.boundary === true, '应当是顶掉的铸币商店');
      c.TowerUI.openMintShop();
      assert.ok(/结算离场/.test(String(ui.last('page').opts.left || '')),
        '页脚要有结算离场：' + JSON.stringify(ui.last('page').opts));
      assert.equal(c.Tower.settleFromShop().ok, true, 'boundary 的铸币商店应当可以结算离场');
      assert.equal(c.Tower.endlessInfo().run, null, '结算后本局结束');
    }
  });

  check('界面：铸币商店页写清是「铸币商队」触发的（真界面模块冒烟）', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    assert.ok(c.Tower.debugGrantBuff('E16').ok, '拿一张铸币商队');
    winOne(c);
    c.TowerUI.openMintShop();
    const page = ui.last('page');
    assert.ok(page.content.includes('铸币商队'), '要写清来由：' + page.content.slice(0, 200));
  });
}

/* ============================================================ */
hr('11. 2026-10 平衡：限次回收 30% / 豪掷千金 100 / 名贵手表 150 / 新上级只在战斗掉落');
{
  check('回收乘数按类型分：限次 30%、永久 40%', () => {
    const c = setup(7);
    const TD = c.TowerData, T = c.Tower;
    const run = T._debugRun('endless');
    assert.equal(TD.SHOP.sellBackLimited, 0.3, '限次回收乘数');
    assert.equal(TD.SHOP.sellBack, 0.4, '永久回收乘数不变');
    /* 实际售价走 sellListOf（界面同源）：战利品（限次·稀有，价 60）×0.3=18；体质（永久·普通，价 30）×0.4=12。 */
    T.debugGrantBuff('E05');
    T.debugGrantBuff('C29');
    const list = T.sellListOf('endless') || [];
    const price = (id) => { const e = list.find((x) => x.id === id || (x.buff && x.buff.id === id)); return e ? Number(e.price != null ? e.price : e.sellPrice) : NaN; };
    assert.equal(price('E05'), Math.round(TD.shopPrice(TD.BUFF_BY_ID.E05) * 0.3), '限次件按 30% 回收');
    assert.equal(price('C29'), Math.round(TD.shopPrice(TD.BUFF_BY_ID.C29) * 0.4), '永久件仍按 40% 回收');
    assert.equal(price('E05'), 18);
    assert.equal(price('C29'), 12);
    assert.ok(run);
  });

  check('豪掷千金门槛回到 100、名贵手表售价 150', () => {
    const c = setup(7);
    const TD = c.TowerData;
    assert.equal(Number(TD.BUFF_BY_ID.C58.mods.shopSpendLimited), 100, '豪掷千金：每消费 100 试炼币给一个限次');
    assert.match(TD.BUFF_BY_ID.C58.desc, /100 试炼币/, '文案要跟着改：' + TD.BUFF_BY_ID.C58.desc);
    assert.equal(Number(TD.BUFF_BY_ID.C24.mods.sellValue), 150, '名贵手表回收价');
    assert.match(TD.BUFF_BY_ID.C24.desc, /150 试炼币/, '文案要跟着改：' + TD.BUFF_BY_ID.C24.desc);
  });

  check('试炼补贴 / 财源滚滚的上位：史诗 +180 / 传奇 +300，且只走无尽塔战斗掉落', () => {
    const c = setup(7);
    const TD = c.TowerData;
    const e18 = TD.BUFF_BY_ID.E18, e19 = TD.BUFF_BY_ID.E19;
    assert.equal(Number(e18.mods.instantCoins), 180, '史诗档 +180');
    assert.equal(Number(e19.mods.instantCoins), 300, '传奇档 +300');
    assert.equal(e18.rarity, 2);
    assert.equal(e19.rarity, 3);
    assert.equal(e18.kind, 'instant');
    /* 池子：E.choice（无尽塔战斗奖励）里有它，E.shop（试炼商店货架）里没有。 */
    for (const b of [e18, e19]) {
      const pools = TD.poolsOf(b);
      assert.ok(pools.indexOf('E.choice') >= 0, b.id + ' 应当进战斗奖励池：' + pools.join(','));
      assert.equal(pools.indexOf('E.shop'), -1, b.id + ' 不该上商店货架：' + pools.join(','));
      assert.equal(TD.hasTag(b, 'ops'), false, b.id + ' 不该算运营类（运营类会被商店优先捞走）');
    }
    /* 真的能立刻到手：发一张 +180。 */
    const T = c.Tower;
    const before = Number(T._debugRun('endless').coins) || 0;
    assert.ok(T.debugGrantBuff('E18').ok, '应当能拿到试炼补贴·精');
    assert.equal(Number(T._debugRun('endless').coins), before + 180, '立刻 +180 试炼币');
  });
}

/* ============================================================ */
hr('12. 100 层循环：商店件数与战斗奖励选项按层分档，每 100 层重来一轮');
{
  check('每页件数 1-20 层 5 / 21-40 层 4 / 41-100 层 3，101 层回到 5；选项 21-40 层 −1、41-100 层 −2', () => {
    const c = setup(7);
    const TD = c.TowerData, T = c.Tower;
    const slots = (n) => TD.endlessShopSlots(n);
    assert.deepEqual([1, 20, 21, 40, 41, 100, 101, 141, 201].map(slots), [5, 5, 4, 4, 3, 3, 5, 3, 5],
      '商店每页件数按层分档，且每 100 层重来一轮');
    assert.deepEqual([1, 20, 21, 40, 41, 100, 101, 141].map(TD.choiceCut), [0, 0, 1, 1, 2, 2, 0, 2],
      '战斗奖励选项的扣减同样每 100 层重来一轮');
    /* 真的落到货架上：rollShopSlotsOf 与开店同一条路径（原来这里写死 SHOP.slots）。 */
    const shelfAt = (n) => { T._debugSetEndlessLayer(n); return T.rollShopSlotsOf(T._debugRun('endless')).length; };
    assert.equal(shelfAt(20), 5);
    assert.equal(shelfAt(41), 3, '第 41 层的货架应当只有 3 件');
    assert.equal(shelfAt(101), 5, '第 101 层回到 5 件');
    /* 选项：choiceSlotsOf 与场间选择同一份实现（基础 3）。 */
    const optsAt = (n) => { T._debugSetEndlessLayer(n); return T.choiceSlotsOf(T._debugRun('endless')); };
    assert.equal(optsAt(20), 3);
    assert.equal(optsAt(41), 1, '第 41 层只剩 1 个选项（扣 2）');
    assert.equal(optsAt(101), 3, '第 101 层恢复 3 选 1');
    /* 挑战塔口径（2026-10 用户口径）：这些「100 层循环」的档位与「巡逻/巡视」都是**无尽塔专属** ——
     * 挑战塔不封顶，但它永远 3 选 1，也不会被巡逻魔王替换掉任何一场。 */
    assert.ok(T.startTowerRun().ok, '应当能开挑战塔');
    const towerRun = T._debugRun('tower');
    towerRun.layer = 41;
    assert.equal(T.choiceSlotsOf(towerRun), 3, '挑战塔第 41 层也还是 3 选 1');
    assert.equal(T.choiceSlotsOf(towerRun, 'tower'), 3, '显式传 mode 也拿到同一个值');
    /* 第 46 层是 salt 0 的巡逻落点：塔的整层预告里不该出现 patrol（无尽塔照旧有）。 */
    assert.equal(TD.isPatrolLayer(46, 0), true, '第 46 层本来是无尽塔的巡逻层');
    const towerPlan = T.preview(46, 0, false, 'tower');
    assert.equal(towerPlan.some((e) => e.kind === 'patrol'), false,
      '挑战塔不该出现巡视/巡逻：' + JSON.stringify(towerPlan.map((e) => e.kind)));
    const endlessPlan = T.preview(46, 0, true, 'endless');
    assert.equal(endlessPlan.some((e) => e.kind === 'patrol'), true,
      '同一层在无尽塔照旧巡逻：' + JSON.stringify(endlessPlan.map((e) => e.kind)));
  });

  check('整百层不开商店：所有开店入口都拦掉，x5 层照旧', () => {
    const c = setup(100);
    const TD = c.TowerData, T = c.Tower;
    assert.equal(TD.layerNoShop(100), true);
    assert.equal(TD.layerNoShop(200), true);
    assert.equal(TD.layerNoShop(105), false, 'x5 层照旧开');
    assert.equal(T._debugSpawnShop().slots, 0, '第 100 层手开也开不出来（且不抛异常）');
    assert.equal(T._debugSpawnMintShop().slots, 0, '铸币商店同样开不出来');
    assert.equal(T.shopState(), null, 'shopState 不该报出一家不存在的店');
    T._debugSetEndlessLayer(105);
    assert.ok(T._debugSpawnShop().slots > 0, '第 105 层照旧能开店');
  });

  check('无尽开局页只留增益集锦 + BOSS 一览（敌人成长刻度行与 100 层说明段已删）', () => {
    /* 2026-10 用户口径：进无尽那一屏**只展示 buff 图鉴与敌人图鉴** ——
     * 原来那两块文字（「敌人成长 ×N」刻度行、「每 100 层重来一轮…」说明段）已删。
     * 这里直接渲染**真界面**再断言，避免有人手滑加回去。 */
    const c = setup(1);
    c.Tower.abandon('endless');                 // 回到「还没开始」的那一屏
    assert.equal(c.Tower.endlessInfo().run, null, '应当已经没有进行中的对局');
    const ui = uiHarness(c);
    c.TowerUI.openEndless();
    const page = ui.last('page');
    assert.ok(page, '应当渲染出无尽开局页');
    const html = page.content;
    assert.ok(!/敌人成长/.test(html), '开局页不该再有「敌人成长」刻度行');
    assert.ok(!/每 100 层重来一轮/.test(html), '开局页不该再有 100 层说明段');
    assert.ok(/增益集锦/.test(html), '开局页要保留增益图鉴');
    assert.ok(/BOSS 一览/.test(html), '开局页要保留敌人图鉴');
    const expected = c.TowerData.ENDLESS_BOSS_POOL.filter((p) => p.kind !== 'warlord').length
      + c.TowerData.WARLORD_POOL.length + 1;
    assert.equal((html.match(/class="boss-rarity/g) || []).length, expected,
      'BOSS 一览只列无尽塔 ' + expected + ' 个候选，每张带装备稀有度');
    for (const w of c.TowerData.WARLORD_POOL) {
      assert.ok(html.includes(w.name), '图鉴应包含狂战松鼠变体：' + w.name);
    }
    const king = (c.TowerData.PATROL.kingPrefix || '') + c.TowerData.PATROL.name;
    assert.ok(html.includes(king), '图鉴应包含魔王：' + king);
    assert.ok(/？？？/.test(html), '魔王机制用 ？？？ 隐藏');
    /* 敌人图鉴的顺序（用户 2026-10 口径）：三侠 → 首领 → 四雄 → 魔王。
     * 三侠 / 四雄卡面不直接写攻击模式，机制统一放在 data-tip 悬停说明里。 */
    const atHero = html.indexOf('boss-group-title">三侠');
    const atPool = html.indexOf('boss-group-title">首领<');
    const atCampaign = html.indexOf('boss-group-title">四雄');
    const atDemon = html.indexOf('boss-group-title">魔王');
    assert.ok(atHero >= 0 && atHero < atPool && atPool < atCampaign && atCampaign < atDemon,
      'BOSS 一览顺序要是 三侠 → 首领 → 四雄 → 魔王');
    assert.ok(!/boss-intro/.test(html), '三侠 / 四雄卡片不直接写攻击模式，机制只放在悬停说明');
    const demonHtml = html.slice(atDemon);
    assert.ok(/data-tip="？？？"/.test(demonHtml), '魔王悬停内容全部 ？？？，不写介绍');
  });

  check('无尽塔 boss 稀有度按轮内层数倾斜：低层偏低、高层偏高、51 层起无最低档', () => {
    const c = setup(1);
    const TD = c.TowerData;
    const tierOf = (e) => {
      if (e.kind === 'warlord') return 4;
      const def = e.kind === 'trial' ? TD.TRIAL_BY_ID[e.id] : TD.SQUIRREL_BY_ID[e.id];
      return TD.GEAR_TIER[def.gear];
    };
    let low = 0, high = 0;
    for (let salt = 0; salt < 500; salt++) {
      const t = tierOf(TD.bossFor(10, 'r' + salt, true));
      if (t <= 1) low++;
      if (t >= 3) high++;
    }
    assert.ok(low > high, '第 10 层低稀有度应更多：低 ' + low + ' / 高 ' + high);
    low = 0; high = 0;
    for (let salt = 0; salt < 500; salt++) {
      const t = tierOf(TD.bossFor(90, 'r' + salt, true));
      if (t <= 1) low++;
      if (t >= 3) high++;
    }
    assert.ok(high > low, '第 90 层高稀有度应更多：低 ' + low + ' / 高 ' + high);
    for (let salt = 0; salt < 500; salt++) {
      assert.notEqual(tierOf(TD.bossFor(60, 'r' + salt, true)), 0, '轮内 51 层起不再抽最低装备档');
    }
    assert.equal(TD.endlessBossWeights(10)[0], 1, '前 10 层普通装正常权重');
    assert.equal(TD.endlessBossWeights(15)[0], 0.15, '11~20 层普通装只剩小权重');
    assert.equal(TD.endlessBossWeights(21)[0], 0, '21 层起普通装归零');
  });

  check('无尽塔新增普通装 / 传说装松鼠的层数门槛', () => {
    const c = setup(1);
    const TD = c.TowerData;
    const normalIds = TD.SQUIRRELS.filter((s) => TD.GEAR_TIER[s.gear] === 0 && !s.legendary).map((s) => s.id);
    const legendIds = TD.SQUIRRELS.filter((s) => s.legendary).map((s) => s.id);
    assert.equal(normalIds.length, 3, '普通装松鼠共 3 只');
    assert.equal(legendIds.length, 4, '新增传说装松鼠 4 只');
    const countAt = (layer, ids) => {
      let n = 0;
      for (let salt = 0; salt < 600; salt++) {
        if (ids.includes(TD.bossFor(layer, 'n' + salt, true).id)) n++;
      }
      return n;
    };
    assert.ok(countAt(5, normalIds) > 0, '前 10 层会出现普通装松鼠');
    assert.ok(countAt(15, normalIds) > 0, '11~20 层小概率出现普通装松鼠');
    assert.equal(countAt(21, normalIds), 0, '21 层起普通装松鼠不再出现');
    assert.equal(countAt(49, legendIds), 0, '传说装松鼠 50 层前不出现');
    assert.ok(countAt(60, legendIds) > 0, '50~99 层会概率出现传说装松鼠');
    assert.equal(countAt(100, legendIds), 0, '100 层起传说装松鼠不出现');
    assert.equal(TD.legendaryChance(49), 0, '49 层传说概率为 0');
    assert.ok(TD.legendaryChance(50) >= 0.10, '50 层传说概率 10% 起');
    assert.ok(TD.legendaryChance(99) > TD.legendaryChance(50), '越深传说概率越高');
    assert.equal(TD.legendaryChance(100), 0, '100 层传说概率归零');
  });
}

/* ============================================================ */
hr('13. 2026-10 用户口径：抽奖卷只在结算时算（放弃本局弹窗）+ 深度曲线 51 层起放缓');
{
  check('抽奖卷从第 5 层起才有：1~4 层一层退出等于没有奖励', () => {
    /* 2026-10 用户口径：抽奖卷是「爬到第 5 层」才给的奖励 —— 第 1~4 层本层应得 0 张，
     * 第 5 层给第一张，之后照旧按段位递增（6~10 层 2 张、11~15 层 4 张…）。 */
    const c = setup(1);
    const TD = c.TowerData, T = c.Tower;
    for (const n of [1, 2, 3, 4]) assert.equal(TD.endlessTickets(n), 0, '第 ' + n + ' 层不该有抽奖卷');
    assert.equal(TD.endlessTickets(5), 1, '第 5 层给第一张');
    assert.equal(TD.endlessTickets(6), 2, '第 6 层起照旧');
    assert.equal(TD.endlessTickets(10), 2);
    assert.equal(TD.endlessTickets(11), 4);
    /* 一层就放弃本局：预览与实际结算都是 0 张 */
    const pv = T.previewSettleTickets();
    assert.equal(pv.layer, 1);
    assert.equal(pv.layerTickets, 0, '第 1 层放弃本局不给卷');
    T._debugRun('endless').phase = 'checkpoint';   // 结算点（放弃本局走的就是这条路）
    const r = T.settleEndless();
    assert.ok(r.ok, '应当能结算');
    assert.equal(r.tickets, 0, '实发也必须是 0 张：' + JSON.stringify(r));
  });

  check('结算的账挪到「放弃本局」弹窗：本层应得 + 铸币 1:1 折现（上限 10），且与实发一致', () => {
    const c = setup(88);
    const TD = c.TowerData, T = c.Tower;
    const ui = uiHarness(c);
    const run = T._debugRun('endless');
    run.retryToken = 14;                    // 14 枚 > 兑换上限 10，考「超出作废」那一支
    run.coins = 60;                         // 试炼币：不折现
    /* ① 预览口径（只算不改）：与 endlessTickets / TICKET_FROM_MINT_CAP 一致 */
    const pv = T.previewSettleTickets();
    assert.equal(pv.layer, 88);
    assert.equal(pv.layerTickets, TD.endlessTickets(88), '本层应得 = endlessTickets(当前层)');
    assert.equal(pv.mint, 14);
    assert.equal(pv.mintConverted, 10, '折现上限 = TICKET_FROM_MINT_CAP');
    assert.equal(pv.mintForfeited, 4, '超出的 4 枚作废');
    assert.equal(pv.total, pv.layerTickets + 10, '总额 = 本层应得 + 折现（试炼币不参与）');
    /* ② 弹窗里真的把这个账写出来（点界面上的「放弃本局」走真代码路径） */
    run.score = 120;                        // 非「还没开始」→ 货币条与按钮才渲染
    c.TowerUI.openEndless();
    const page = ui.last('page').content;
    assert.ok(page.indexOf('抽奖卷') < 0 || page.indexOf('data-tip') < page.indexOf('抽奖卷'),
      '局内货币条不该再直接显示抽奖卷数量');
    ui.click('abandon');
    const m = ui.last('modal');
    assert.equal(m.title, '放弃本局');
    assert.ok(m.content.includes('共 ' + pv.total + ' 张抽奖卷'), '弹窗要写到手总额：' + m.content);
    assert.ok(/铸币折现/.test(m.content) && /超出 4 枚作废/.test(m.content), '要写清铸币折现与超出作废');
    /* ③ 真点「放弃」：实发张数 == 弹窗承诺的总额 */
    const before = Number(c.State.state().props[50] || 0);
    ui.modalButton('放弃').run();
    const after = Number(c.State.state().props[50] || 0);
    assert.equal(after - before, pv.total, '实发必须等于预览：' + pv.total + ' vs ' + (after - before));
  });

  check('结算战报保留整局收入与已失去增益，重载查看不重复发奖', () => {
    const c = setup(5), T = c.Tower;
    const ui = uiHarness(c);
    /* 两次各触发三次免死：档位30→45，实际成就收入只有30+15。 */
    for (let i = 0; i < 2; i++) {
      const nx = T.nextBattle('endless');
      T.reportBattle('endless', nx.token, true, 1500, 2000,
        { rounds: Array.from({ length: 3 }, () => ({ deathSave: true })) });
    }
    T.debugGrantBuff('C01');
    /* 超过调试流水的 100 条上限，结算仍须保留最早获得而后卖掉的增益。 */
    for (let i = 0; i < 105; i++) T.debugGrantBuff('E02');
    T._debugSpawnShop();
    const sale = T.sellBuff('C01');
    assert.ok(sale.ok && T.buyRetryToken().ok, '出售与消费走正式商店 API');
    const pv = T.previewEndlessSummary(), balance = T._debugRun('endless').coins;
    assert.equal(pv.achievements.reduce((sum, a) => sum + a.earnedPoints, 0), 45, '战报成就分相加使用实际增量');
    assert.equal(pv.trialCoinsEarned, balance + c.TowerData.SHOP.retryPrice, '累计收入不能被消费扣低');
    assert.equal(pv.mintEarned, 1, '购买的铸币属于本局收入');
    assert.equal(pv.buffs.find((b) => b.id === 'C01').count, 1, '已卖掉的最早增益仍在战报里');
    assert.equal(pv.buffs.find((b) => b.id === 'E02').count, 105, '即时增益次数不随调试流水截断');
    const before = c.State.state().props[50] || 0;
    c.TowerUI.openEndless(); ui.click('abandon'); ui.modalButton('放弃').run();
    const out = { summary: T.endlessInfo().lastSummary };
    assert.equal(ui.rendered[ui.rendered.length - 1].kind, 'page', '确认离场后用完整战报页承接');
    assert.match(ui.last('page').content, /endless-summary.*data-outcome="lose"/, '普通离场展示失败结局');
    assert.equal(out.summary.trialCoinsLeft, balance, '清空余额前捕获结算快照');
    assert.equal(c.State.state().props[50] - before, out.summary.tickets, '预览与实发走同一口径');
    assert.ok(c.State.load(), '结算后能正常读回存档');
    assert.equal(JSON.stringify(T.endlessInfo().lastSummary), JSON.stringify(out.summary), '最后战报随存档保留');
    const paid = c.State.state().props[50];
    c.TowerUI.openEndless(); ui.click('last-summary');
    assert.match(ui.last('page').content, /无尽塔本局战报/, '大厅能重新打开上局完整战报');
    T.endlessInfo(); T.previewEndlessSummary(); T.abandon('endless');
    assert.equal(c.State.state().props[50], paid, '重复查看或重复结算不会重发抽奖卷');
  });

  check('结算战报：正文单独滚动，底部操作固定在面板底部（iOS 不依赖 sticky）', () => {
    const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8').replace(/\r\n/g, '\n');
    const rule = (sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (css.match(new RegExp(esc + '\\s*\\{[^}]*\\}')) || [''])[0];
    };
    const main = rule('.endless-summary-page > .tower-main');
    assert.match(main, /overflow:\s*hidden/, '战报容器不再整列滚动：' + main);
    assert.match(main, /display:\s*flex/, '战报容器改成 flex 三段：' + main);
    assert.match(main, /flex-direction:\s*column/, '战报容器纵向排列：' + main);
    const body = rule('.endless-summary .summary-body');
    assert.match(body, /flex:\s*1 1 auto/, '正文占据剩余高度：' + body);
    assert.match(body, /overflow-y:\s*auto/, '只有正文可以滚动：' + body);
    const actions = rule('.endless-summary .summary-actions');
    assert.match(actions, /position:\s*relative/, '底部操作不再依赖 sticky：' + actions);
    assert.ok(!/position:\s*sticky/.test(actions), 'iOS 上 sticky 会失效，不能再用：' + actions);
  });

  check('深度曲线：首轮不变，百层后折扣继承末值并重走首轮相对增长', () => {
    const c = setup(7);
    const KM = c.TowerData.endlessDepthMul;
    /* 1~50 层与旧口径逐层一致（用户要求「1~30／1~50 层的增幅别动」） */
    for (let n = 1; n <= 50; n++) {
      const want = Math.pow(1.07, Math.min(Math.max(0, n - 30), 20));
      assert.ok(Math.abs(KM(n) - want) < 1e-12, '第 ' + n + ' 层不该变：' + KM(n) + ' vs ' + want);
    }
    /* 51 层起逐层增幅恒定（从曲线反解，不依赖未导出的常量） */
    const rate2 = KM(100) / KM(99) - 1;
    assert.ok(Math.abs(rate2 - 0.0555) < 1e-12, '第 51 层起应当每层 +5.55%，实测 ' + (rate2 * 100).toFixed(4) + '%');
    const five = KM(100) / KM(95);
    assert.ok(five > 1.30 && five < 1.32, '5 层环比应当在 ×1.31 附近：' + five.toFixed(4));
    /* 100 层 ≈ 旧口径（51 层起 9%）的 1/5 */
    const old100 = Math.pow(1.07, 20) * Math.pow(1.09, 50);
    const ratio = KM(100) / old100;
    assert.ok(ratio > 0.18 && ratio < 0.21, '100 层应当是旧值的 1/5 左右，实测 ' + (ratio * 100).toFixed(1) + '%');
    const parts = c.TowerData.endlessScaleParts;
    const discount = c.TowerData.ENDLESS_CYCLE_DISCOUNT;
    for (const key of ['statCurve', 'hpCurve']) {
      for (const end of [100, 200]) {
        assert.ok(Math.abs(parts(end + 1)[key] / parts(end)[key] - discount) < 1e-12, key + '换轮应折扣继承');
      }
      for (let local = 1; local <= 100; local++) {
        assert.ok(Math.abs(parts(100 + local)[key] / parts(101)[key] - parts(local)[key] / parts(1)[key]) < 1e-8,
          key + '第 ' + local + ' 层应重复首轮相对增长');
      }
    }
    /* 201 与 101 必须是**同一套等比例下降**：算上 boss 血量缓升后，
     * 201/200 与 101/100 都恰好等于折扣（用户反映 201 比 101 难得多，实为多继承了一轮，
     * 不是比例机制坏了；这条守住宿主公式）。 */
    const finalHp = (n) => parts(n).hpCurve * c.TowerData.endlessBossHpRatio(1, n);
    for (const end of [100, 200]) {
      assert.ok(Math.abs(finalHp(end + 1) / finalHp(end) - discount) < 1e-8,
        '第 ' + (end + 1) + ' 层相对 ' + end + ' 层应同样按折扣下降');
    }
    assert.equal(KM(101), KM(1), '深度分量随轮内层数重置，完整基础独立继承');
    assert.ok(Math.abs(c.TowerData.endlessScaleParts(120).depth - KM(120)) < 1e-12, '界面出口与曲线同源');
  });
}

/* ============================================================ */
hr('14. 剧情展示模式：开始攀登 → 主界面讲剧情（逐字 / 继续）→ 播完回正常界面');
{
  check('开局按钮叫「开始攀登」，点了先进主界面走剧情；「继续」逐行推进；进店剧情只播一次', () => {
    const c = setup(1);
    c.Tower.abandon('endless');
    c.Tower.setStoryEnabled(true);               // 本文件默认是挑战模式（跳过剧情），这一节要看剧情
    c.State.state().endless.storySeen = {};      // 剧情「已播」记号清空，下面逐段验
    /* uiHarness 自己会把 setTimeout 打成空壳 —— 所以**先建 harness，再换掉定时器**：
     * 剧情打字机就是 setTimeout 排队，换成可控队列后测试自己决定打几个字。
     * 同时给 document 补一个能记住内容的文字节点（真界面走 storyPaint 写它）。 */
    const ui = uiHarness(c);
    const queue = [];
    c.__q = queue;
    vm.runInContext('setTimeout = function (fn) { __q.push(fn); return __q.length; }; clearTimeout = function () {};', c);
    const typed = { html: '', textContent: '' };
    const cls = [];                              // 记下剧情文字被加过的类（淡出用）
    const textBox = {
      get innerHTML() { return typed.html; },
      set innerHTML(v) { typed.html = String(v); typed.textContent = String(v).replace(/<[^>]*>/g, ''); },
      classList: { add: (name) => cls.push(name), remove: () => {}, contains: (n) => cls.indexOf(n) >= 0 },
    };
    c.document.querySelector = (sel) => (sel === '[data-story-text]' ? textBox : null);
    const flush = (n) => { for (let i = 0; i < n; i++) { const fn = queue.shift(); if (fn) fn(); } };

    /* ① 开局页：按钮文案换成「开始攀登」 */
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /开始攀登/, '开局按钮应当叫「开始攀登」');
    assert.ok(!/开始冲塔/.test(ui.last('page').content), '旧文案「开始冲塔」不该还在');

    /* ② 点它：**进主界面走剧情**，不直接开打 */
    ui.click('fight');
    const run = c.Tower._debugRun('endless');
    assert.ok(run, '应当已经起了一局无尽');
    assert.equal(run.story, 'intro', '这一局应当挂着开场剧情');
    const storyPage = ui.last('page').content;
    assert.match(storyPage, /tower-story/, '剧情模式应当是整屏剧情');
    /* 2026-10 用户口径：右下角那颗「继续」按钮**已经去掉** —— 点屏幕任意位置推进。 */
    assert.ok(!/data-action="story-next"/.test(storyPage), '剧情屏不该再有「继续」按钮');
    /* 标题按用户口径**保留**（无尽塔 · 第 x 层），「第 m/n 行」进度不要（要沉浸感） */
    assert.match(storyPage, /无尽塔 · 第 1 层/, '剧情模式要留着标题');
    assert.ok(!/tower-story-step/.test(storyPage), '剧情模式不该有「第 m/n 行」提示');
    /* 「不要文本框」= CSS 里 .tower-story-text 不该再有边框 / 底色，且要居中 */
    const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8').replace(/\r\n/g, '\n');
    const storyCss = (css.match(/\.tower-story-text\s*\{[^}]*\}/) || [''])[0];
    assert.ok(storyCss && !/border|background/.test(storyCss), '剧情文字不该再套文本框：' + storyCss);
    assert.ok(/text-align:\s*center/.test(storyCss), '剧情文字要居中：' + storyCss);
    for (const bad of ['继续战斗', '分数', '试炼币', '永久增益', '限次增益', '当前环境', '血量', 'tower-plan']) {
      assert.ok(!storyPage.includes(bad), '剧情模式不该出现局内 UI：' + bad);
    }

    /* ③ 逐字：打字机一个字一个字打（文字节点由 storyPaint 更新） */
    assert.equal(typed.textContent, '', '刚进来还没打字');
    flush(4);
    assert.equal(typed.textContent.length, 4, '应当打出 4 个字：' + typed.textContent);
    assert.ok(typed.textContent.indexOf('你推开') === 0, '第一行开头是「你推开」：' + typed.textContent);
    flush(200);
    assert.ok(/你推开无尽之塔厚重的门扉，/.test(typed.textContent), '第一行要能整行打出来：' + typed.textContent);
    assert.ok(!/[{}*]/.test(typed.textContent), '行内标记要吃掉，不显示花括号/星号');

    /* ④ 「继续」：一行没打完 → 立刻补完；打完了 → 下一行（前面几行留着） */
    flush(1);
    const partial = typed.textContent.length;
    ui.click('story-next');
    assert.ok(/门扉，/.test(typed.textContent) && typed.textContent.length >= partial, '点一下把这一行补完');
    ui.click('story-next');                       // 到第二行
    flush(3);
    assert.ok(typed.textContent.length > 14, '第二行接着打（第一行留在上面）');

    /* ⑤ 第三行是加粗的铭文：标记要变成 <b> 真加粗 */
    ui.click('story-next');                       // 补完第二行
    flush(200);
    ui.click('story-next');                       // 到第三行
    flush(200);
    /* 第三行：`{红}**献出自身**{/红}` 要渲染成「红色 + 加粗」的**嵌套**（2026-10 用户口径），
     * 标记本身一个都不许漏进文字。 */
    assert.match(typed.html, /<span class="tower-story-red"><b>献出自身<\/b><\/span>/,
      '「献出自身」应当是红色 + 加粗的嵌套：' + typed.html.slice(0, 120));
    assert.ok(/凡欲觐见王者，须先献出自身。/.test(typed.textContent), '铭文要打出来：' + typed.textContent);

    /* ⑥ 一直点到底：五行走完 → 清掉待播剧情、回到正常主界面 */
    for (let i = 0; i < 20; i++) {
      if (!/tower-story/.test(ui.last('page').content)) break;
      ui.click('story-next');
      flush(400);          // 每行最多 30 多字，flush 足够把这一行打完
    }
    assert.equal(c.Tower.endlessInfo().run.story, null, '剧情播完应当清掉待播标记');
    assert.equal(c.Tower.storySeen('intro'), false, '开场剧情是「每次都播」，不记 seen');
    const normalPage = ui.last('page').content;
    assert.match(normalPage, /继续战斗/, '剧情结束要回到正常主界面（按钮回到「继续战斗」）');
    assert.ok(!/tower-story/.test(normalPage), '正常界面里不该还有「继续」');

    /* ⑥b 第一场**之前**就要能显示血量（用户报「离开剧情模式后血量不显示」）：
     * baseMaxHp 以前只在第一场的 adjustMe 里才写，于是开局血条是「—」。 */
    const info0 = c.Tower.endlessInfo().run;
    assert.ok(info0.curMaxHp > 0, '第一场之前血量上限就该有值：' + info0.curMaxHp);
    assert.equal(info0.curHp, info0.curMaxHp, '开局应当是满血');
    const bar = (normalPage.match(/<span>血量<\/span>[\s\S]{0,240}?<b>([^<]+)<\/b>/) || [])[1];
    assert.match(String(bar), /^\d+ \/ \d+$/, '血条要显示「当前 / 上限」，不能是「—」：' + bar);
    /* ⑥c 第 1 层没有环境：整块「当前环境」提示都不该出现 */
    assert.ok(!/当前环境/.test(normalPage), '没有环境词缀时不该出现「当前环境」提示');

    /* ⑦ 第一次进商店之前：自动播商人剧情，播完记 seen；第二次进店不再打断 */
    c.State.state().endless.storySeen = {};      // 本文件 setup() 默认标了已播，这里清掉再验
    run.phase = 'shop';
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /tower-story/, '第一次进店前应当先走剧情');
    flush(400);
    /* 第一段商人剧情的第一行是「转过一处阴暗的拐角，你发现一名披着破旧斗篷的商人正坐在路边。」
     * —— 打字机只打了 `flush(400)` 这么多字（约 9 个），所以断言要落在**已经打出来的**那截上，
     * 不能拿整段里的词（例如「商人」两个字在更后面）来判。 */
    assert.ok(/阴暗的拐角/.test(typed.textContent), '商人剧情要真的打出来：' + typed.textContent.slice(0, 24));
    assert.ok(!/[*{}]/.test(typed.textContent), '斜体/加粗标记不该漏进文字');
    for (let i = 0; i < 20; i++) {
      if (!/tower-story/.test(ui.last('page').content)) break;
      ui.click('story-next');
      flush(400);
    }
    assert.equal(c.Tower.storySeen('merchant'), true, '商人剧情要记「已播」');
    assert.match(ui.last('page').content, /进入试炼商店/, '剧情结束回到正常主界面（商店入口还在）');
    c.TowerUI.openEndless();
    assert.ok(!/tower-story/.test(ui.last('page').content), '第二次进店不该再播同一段剧情');

    /* ⑧ 第 10 层「第二次遇到商人」：第一次已播过、这段没播过才播，播完记 seen。
     *    ⚠ 换层必然是**新的一家店**（店要关掉才能开打），所以这里也换一个新的 shop 对象：
     *    `shop.storyShown` 是「这家店讲过没有」的记账，同一家店不该讲第二段。 */
    run.layer = 10;
    run.shop = { layer: 10, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /tower-story/, '第 10 层进店前应当播第二段商人剧情');
    flush(400);
    assert.ok(/孤灯|木箱/.test(typed.textContent), '第二段商人剧情要真的打出来：' + typed.textContent.slice(0, 24));
    for (let i = 0; i < 20; i++) {
      if (!/tower-story/.test(ui.last('page').content)) break;
      ui.click('story-next');
      flush(400);
    }
    assert.equal(c.Tower.storySeen('merchant2'), true, '第二段要记「已播」');
    c.TowerUI.openEndless();
    assert.ok(!/tower-story/.test(ui.last('page').content), '同一家店不再讲第二段');

    /* ⑨ 2026-10 用户口径：两段固定对话之外，**每一次**遇到商人 / 触发铸币商店
     *    都从 6 段随机商人文案里来一段（`merchantA`…`merchantF`），固定文案不受影响。 */
    const POOL = ['merchantA', 'merchantB', 'merchantC', 'merchantD', 'merchantE', 'merchantF'];
    const seenPool = new Set();
    for (let n = 0; n < 6; n++) {
      run.shop = { layer: 11 + n, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
      c.TowerUI.openEndless();
      assert.match(ui.last('page').content, /tower-story/, '每次遇到商人都应当有剧情（第 ' + (n + 1) + ' 次）');
      const id = c.TowerPlot.state() && c.TowerPlot.state().id;
      assert.ok(POOL.indexOf(id) >= 0, '应当是 6 段随机商人文案之一，实测 ' + id);
      seenPool.add(id);
      for (let i = 0; i < 24; i++) {              // 读完（含打字机）
        if (!/tower-story/.test(ui.last('page').content)) break;
        ui.click('story-next');
        flush(400);
      }
      /* 同一家店读完就干净了：再画一次不该又冒出一段（否则就是「一直触发剧情」那种死循环）。 */
      c.TowerUI.openEndless();
      assert.ok(!/tower-story/.test(ui.last('page').content), '同一家店只讲一段，读完不再接第二段');
    }
    /* 真的在随机：把随机流依次钉成 0 / 0.5 / ≈1，应当依次抽到池子的第 1 / 中 / 末段
     *（`c.__rand(v)` 是本文件 setup 里的随机流开关；每次都要开一家**新店**才允许再讲一段）。 */
    const picks = [];
    for (const r of [0, 0.5, 0.9999]) {
      c.__rand(r);
      run.shop = { layer: 30, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
      picks.push(c.TowerPlot.pending(c.Tower.endlessInfo().run));
    }
    assert.deepEqual(picks, ['merchantA', 'merchantD', 'merchantF'],
      '随机商人文案要按随机流等概率抽（实测 ' + JSON.stringify(picks) + '）');

    /* ⑨ 「立即进货」开的店（shop.byBuff）：每次开店都播铃声那段 */
    run.shop = { byBuff: true, slots: [] };
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /tower-story/, '立即进店的店应当先播剧情');
    /* ⑨ （第二处）「立即进货」开的店（shop.byBuff）：同样走随机商人文案那一套（2026-10 用户口径） */
    run.shop = { byBuff: true, slots: [] };
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /tower-story/, '立即进店的店应当先播剧情');
    flush(400);
    assert.ok(/商人|手推车|货摊/.test(typed.textContent), '随机商人文案要打出来：' + typed.textContent.slice(0, 24));
    const byBuffId = c.TowerPlot.state() && c.TowerPlot.state().id;
    assert.ok(POOL.indexOf(byBuffId) >= 0, '「立即进货」的店也走 6 段随机池，实测 ' + byBuffId);
    for (let i = 0; i < 20; i++) {
      if (!/tower-story/.test(ui.last('page').content)) break;
      ui.click('story-next');
      flush(400);
    }
    assert.equal(c.Tower.storySeen('restock'), false, '随机商人文案是「每次都播」，不记 seen');
    run.shop = null;

    /* ⑩ 淡出 / 淡入：剧情收尾时文字挂上 tower-story-leaving，接着那次主界面带 tower-fade-in */
    assert.ok(cls.indexOf('tower-story-leaving') >= 0, '剧情收尾时文字要挂上淡出类：' + JSON.stringify(cls));
    assert.match(normalPage, /tower-fade-in/, '剧情之后那次主界面要淡入，而不是硬切');
    /* 首页左下角那颗开关：文案 = 当前模式，悬停说明这个模式做什么，点一下切模式 */
    const pageHtml = ui.last('page').content;
    assert.match(pageHtml, /data-action="story-mode"/, '首页左下角要有模式开关');
    assert.match(pageHtml, /剧情模式/, '默认写「剧情模式」');
    assert.match(pageHtml, /data-tip="[^"]*(剧情|挑战)/, '按钮要带悬停说明');
    assert.equal(c.Tower.storyEnabled(), true, '默认开着剧情');
    ui.click('story-mode');                      // → 挑战模式（跳过所有文字剧情）
    assert.match(ui.last('page').content, /挑战模式/, '点一下按钮应当显示「挑战模式」');
    assert.equal(c.Tower.storyEnabled(), false, '挑战模式下 storyEnabled 为 false');
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /挑战模式/, '挑战模式要能持久（重画还在）');
    /* 挑战模式：起一局也不挂剧情，商店不打断 */
    c.Tower.abandon('endless');
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /开始攀登/, '应当回到开局页');
    ui.click('fight');
    assert.equal(c.Tower.endlessInfo().run.story, null, '挑战模式下起局不该挂剧情');
    assert.match(ui.last('page').content, /继续战斗/, '挑战模式下点了「开始攀登」直接就是主界面');
    assert.ok(!/tower-story/.test(ui.last('page').content), '挑战模式下没有剧情页');
    const runSrc = c.Tower._debugRun('endless');   // 真状态对象（endlessInfo 给的是拷贝）
    runSrc.phase = 'shop';
    runSrc.shop = { byBuff: true, slots: [] };     // 就算这家店是「立即进货」开的，挑战模式也照样跳过
    c.TowerUI.openEndless();
    assert.ok(!/tower-story/.test(ui.last('page').content), '挑战模式下进店也不播剧情');
    assert.match(ui.last('page').content, /进入试炼商店/, '挑战模式直接给商店入口');
    /* 切回剧情模式：这家店的剧情还没播过 → 立刻补播 */
    ui.click('story-mode');
    assert.equal(c.Tower.storyEnabled(), true, '再点一下回到剧情模式');
    assert.match(ui.last('page').content, /tower-story/, '切回剧情模式后该播的剧情要补上');
  });

  check('剧本选择：默认剧本直接开局；勇者剧本先到准备页，底部返回键保留、没有右上角关闭键', () => {
    /* 默认档：选默认剧本 → 开始攀登就是常规无尽塔。 */
    const a = setup(7);
    a.Tower.abandon('endless');                    // 回到没有进行中对局的开局页
    const ua = uiHarness(a);
    a.TowerUI.openEndless();
    const first = ua.last('page').content;
    assert.match(first, /无尽塔/, '开局页标题要叫「无尽塔」');
    assert.match(first, /默认剧本/, '剧本选择里要有默认剧本');
    assert.match(first, /勇者剧本/, '剧本选择里要有勇者剧本');
    assert.match(first, /class="script-demo">DEMO</, '勇者剧本要带 DEMO 标记');
    assert.ok(!/模式 Demo/.test(first), '旧的「模式 Demo」文案不该还在');
    assert.equal(ua.last('page').node.querySelectorAll('[data-script]').length, 2, '下拉里正好两张剧本卡');
    ua.click('fight');
    assert.ok(a.Tower._debugRun('endless'), '默认剧本点开始攀登应当直接起局');
    assert.match(ua.last('page').content, /无尽塔 · 第 1 层/, '默认剧本开局标题仍是无尽塔');

    /* 勇者档：选中勇者剧本 → 开始攀登先过勇者准备页。 */
    const b = setup(7);
    b.Tower.abandon('endless');
    const ub = uiHarness(b);
    /* 这份套件只装了无尽塔状态机；准备页需要 TowerHero 的配置，给个最小桩。 */
    b.TowerHero = { CONFIG: { initialCount: 3, startLevel: 5 }, catalog: () => [] };
    b.TowerUI.openEndless();
    const hero = ub.last('page').node.querySelectorAll('[data-script]')
      .find((option) => option.getAttribute('data-script') === 'hero');
    assert.ok(hero, '要有勇者剧本这一档');
    hero.onclick({ stopPropagation() {} });
    assert.match(ub.last('page').content, /勇者剧本[\s\S]*DEMO/, '选完勇者剧本后触发按钮要显示这一档和 DEMO');
    ub.click('fight');
    const prep = ub.last('page').content;
    assert.match(prep, /塑造本局勇者/, '勇者剧本点开始攀登先进勇者准备页');
    assert.ok(!ub.last('page').opts.noFooter, '准备页底部要恢复返回键');
    assert.equal(ub.last('page').opts.homeLabel, '返回', '底部返回键文案是「返回」');
    assert.ok(!/hero-setup-close/.test(prep), '准备页不再有右上角小关闭键');
  });

  check('剧情屏：点屏幕任意位置都能继续（不是只能点右下角「继续」）；点按钮上不重复推进', () => {
    /* 2026-10 用户口径：剧情模式里点别处也要能往下走（正在打字时＝补完这一行）。
     * 这里直接调容器节点上的整屏处理器，不需要可交互的 DOM。 */
    const c = setup(1);
    c.Tower.abandon('endless');
    c.Tower.setStoryEnabled(true);
    c.State.state().endless.storySeen = {};
    const ui = uiHarness(c);
    c.TowerUI.openEndless();
    ui.click('fight');                              // 起局 → 挂开场剧情 → 画剧情屏
    const page = ui.last('page');
    assert.match(page.content, /tower-story/, '先要有一屏剧情');
    assert.ok(!/data-action="story-next"/.test(page.content), '「继续」按钮已经去掉（点屏幕任意位置即可）');
    assert.equal(typeof page.node.onclick, 'function', '剧情屏要在容器上接管「点任意位置继续」');
    const before = c.TowerPlot.state();
    assert.ok(before && before.line === 0, '剧情从第 1 行开始');
    /* 点在按钮 / 悬停气泡上：交给那颗按钮自己处理，整屏不接管。 */
    page.node.onclick({ target: { closest: () => ({}) } });
    assert.equal(c.TowerPlot.state().line, 0, '点按钮上不该由整屏再推进一次');
    assert.equal(c.TowerPlot.state().chars, 0, '也不该顺手补完这一行');
    /* 点在空白处：等价于点「继续」——这一行没打完就先补完这一行。 */
    page.node.onclick({ target: null });
    const after = c.TowerPlot.state();
    assert.ok(after.chars > 0 || after.line > 0, '点空白处要推进/补完当前行：' + JSON.stringify(after));
    /* 非剧情屏（正常主界面）不接管点击，免得把别处的点击吃掉。 */
    c.Tower.clearRunStory('endless');
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /继续战斗/, '这时应当回到正常主界面');
    assert.equal(ui.last('page').node.onclick, undefined, '正常界面不挂整屏点击处理器');
  });
}

/* ============================================================ */
hr('15. 2026-10 主线剧情修复：入场剧情必须发生在「第 1 场战斗之前」');
{
  check('剧情必须在「第 1 场战斗之前」播完：点「继续战斗」先播剧情、**不开打**', () => {
    const c = setup(20);
    const T = c.Tower;
    /* 探针式 Main：只记「有没有真的开打」。 */
    const battles = [];
    c.Main = { startBattle: (foe) => { battles.push(foe && foe.name); return Promise.resolve(); }, showHome: () => {} };
    const ui = uiHarness(c);
    T.setStoryEnabled(true);               // setup() 默认关掉剧情（= 挑战模式），这一节要看剧情
    T._debugSetEndlessLayer(20);
    T._debugRun('endless').story = undefined;
    c.TowerUI.openEndless();
    /* 关键一按：这是「第 1 场战斗之前」，应当只把剧情放出来、**不开打**。 */
    ui.click('fight');
    assert.equal(battles.length, 0, '剧情还没播就开打 = 顺序错了（实测已开打 ' + battles.join(',') + '）');
    assert.equal(T._debugRun('endless').story, 'gate20', '应当把 gate20 挂成待播');
    assert.match(ui.last('page').content, /tower-story/, '这一屏应当是剧情屏（右下角有「继续」）');
    /* 把这一屏的「继续」点到剧情结束（打字机 + 逐行推进） */
    for (let i = 0; i < 40; i++) {
      if (!/tower-story/.test(ui.last('page').content)) break;
      ui.click('story-next');
    }
    assert.equal(c.Tower.storySeen('gate20'), true, '播完要记「已播」，否则会在后面每一层重播');
    assert.equal(T.endlessInfo().run.story, null, '播完要清掉待播标记');
    /* 现在才是开打：点「继续战斗」应当真的建出战斗。 */
    c.TowerUI.openEndless();
    ui.click('fight');
    assert.equal(battles.length, 1, '剧情播完之后点「继续战斗」应当开打（实测 ' + battles.length + ' 次）');
  });

  check('入场剧情：真实爬到第 20 层，那一屏**自己**就是剧情屏（不用点「继续战斗」）', () => {
    const c = setup(19);
    const T = c.Tower;
    const battles = [];
    c.Main = { startBattle: (foe) => { battles.push(foe && foe.name); return Promise.resolve(); }, showHome: () => {} };
    const ui = uiHarness(c);
    T.setStoryEnabled(true);
    T._debugResetStory();                 // 像第一次爬上来的玩家：所有「只播一次」都还没看过
    T._debugSetEndlessLayer(19);
    T.clearRunStory('endless');
    /* 真实推进：第 19 层剩下的每一场都走 nextBattle / reportBattle（与界面 onEnd 同一条状态机路径）。
     * 场间选牌直接跳过 —— 这一节只看「进层那一刻剧情有没有自己出来」。 */
    for (let guard = 0; guard < 12 && T._debugRun('endless').layer === 19; guard++) {
      T._debugRun('endless').choices = null;
      const nx = T.nextBattle('endless');
      assert.ok(nx.ok, '第 19 层应当能取到下一场：' + (nx.msg || ''));
      T.reportBattle('endless', nx.token, true, 5000, 5000);
    }
    assert.equal(T._debugRun('endless').layer, 20, '应当推进到第 20 层');
    assert.equal(T._debugRun('endless').story, 'gate20', '进层就该把入场剧情挂上，实测 ' + T._debugRun('endless').story);
    /* ① 进层这一屏**直接**是剧情屏 —— 这里一次「继续战斗」都没点（用户口径）。 */
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /tower-story/, '这一屏应当已经是剧情屏（右下角「继续」）');
    assert.ok(!/data-action="fight"/.test(ui.last('page').content), '剧情屏上不该有「继续战斗」');
    assert.equal(battles.length, 0, '剧情还没播就不该开打');
    /* ② 待播标记丢了（旧存档 / 中途退出过）也要**自己**补上，而不是等玩家先点一下按钮。 */
    T.clearRunStory('endless');
    c.TowerUI.openEndless();
    assert.equal(T._debugRun('endless').story, 'gate20',
      '重画这一屏时应当自己把该播的剧情接上，实测 ' + T._debugRun('endless').story);
    assert.match(ui.last('page').content, /tower-story/, '这一屏仍然应当直接是剧情屏');
  });

  check('巡视那一场：走到它就直接播剧情（一次偶遇一段），读完点「继续战斗」必定能开打', () => {
    const c = setup(41);
    const T = c.Tower;
    const battles = [];
    c.Main = { startBattle: (foe) => { battles.push(foe && foe.name); return Promise.resolve(); }, showHome: () => {} };
    const ui = uiHarness(c);
    T.setStoryEnabled(true);
    T._debugResetStory();                 // 连「一局之内的巡视段号」一起归零
    /** 找一层有「路上巡视」的，并把层内序号挪到那一场（= 玩家打到那一场时的状态）。 */
    const findPatrol = (from) => {
      for (let L = from; L <= 260; L++) {
        T._debugSetEndlessLayer(L);
        const k = (T._debugRun('endless').plan || []).findIndex((e) => e && e.kind === 'patrol' && !e.x00);
        if (k >= 0) return { layer: L, idx: k };
      }
      return null;
    };
    /** 走到那一场并重画这一屏 —— **不点任何按钮**。 */
    const visit = (hit) => {
      T._debugSetEndlessLayer(hit.layer);
      T._debugRun('endless').idx = hit.idx;
      c.TowerUI.openEndless();
      return T._debugRun('endless').story;
    };
    /* 把这一屏的「继续」一直点到剧情结束：**真读**，绝不手工 markStorySeen ——
     * 旧版本的坑正是「`once:false` 的巡视段永远记不上 seen」，手工记 seen 会把那个 bug 掩盖掉。 */
    const readToEnd = () => {
      let n = 0;
      while (n++ < 40 && /tower-story/.test(ui.last('page').content)) ui.click('story-next');
      return n;
    };
    const first = findPatrol(41);
    assert.ok(first, '应当能找到巡逻层');
    /* ① 到那一场就直接播（用户口径：不要先点一次「继续战斗」）—— 这里一次都没点。 */
    assert.equal(visit(first), 'patrolGate', '首次偶遇应当是 patrolGate，实测 ' + visit(first));
    assert.match(ui.last('page').content, /tower-story/, '这一屏应当已经是剧情屏');
    /* ② 剧情屏上点「继续战斗」不该开打。 */
    ui.click('fight');
    assert.equal(battles.length, 0, '巡视之前不该开打');
    /* ③ 真读完这一段 → 待播清掉（读的是真「继续」）。 */
    readToEnd();
    assert.equal(T._debugRun('endless').story, undefined, '读完这一段之后不该还挂着待播');
    /* ④ 同一局里再偶遇一次：换**下一段**，而且同样不用点。 */
    const second = findPatrol(first.layer + 1);
    assert.ok(second, '应当能找到第二层巡逻');
    const id2 = visit(second);
    assert.ok(id2 && id2 !== 'patrolGate', '第二次偶遇应当换一段，实测 ' + id2);
    assert.ok(/^patrolMeet\d*$/.test(String(id2)), '第二次偶遇应当是 patrolMeet 系列，实测 ' + id2);
    readToEnd();
    /* ⑤ 段号走完一轮（patrolMeet…patrolMeet8）之后要**从头再来**，不能静默 ——
     *   长局里「讲完就没了」在观感上就是「巡视剧情被吞掉」（机器人实测：第 163 层之后再没播过）。 */
    let from = second.layer + 1, cycled = false;
    for (let i = 0; i < 9 && !cycled; i++) {
      const hit = findPatrol(from);
      assert.ok(hit, '应当还能找到巡逻层（第 ' + (i + 1) + ' 次）');
      from = hit.layer + 1;
      visit(hit);
      readToEnd();
      if (T._debugRun('endless').patrolMeetNo === 1) cycled = true;
    }
    assert.ok(cycled, '一轮 8 段讲完之后应当从头再讲（patrolMeetNo 回到 1）');
    /* ⑤ 点「继续战斗」**必须真的开打** —— 这就是用户报的「一直触发剧情、无法进入战斗」
     *    的反向验证：判定若停在同一段上，这里会再次变成剧情屏、battles 永远是 0。 */
    c.TowerUI.openEndless();
    ui.click('fight');
    assert.equal(battles.length, 1, '巡视剧情读完之后点「继续战斗」应当开打（实测 ' + battles.length + ' 次）');
    console.log('      第 ' + first.layer + ' 层巡视（第 ' + (first.idx + 1) + ' 场）：patrolGate → 读完 → 可正常开打；' +
      ' 第 ' + second.layer + ' 层再遇 → ' + id2);
  });

  check('献祭文案：第 20 层是「石门」那段；第 30 层起走随机供词（即使 20 层那段没记 seen）', () => {
    const c = setup(20);
    const T = c.Tower;
    T.setStoryEnabled(true);               // setup() 默认关掉剧情，这一节要看剧情
    const finishLayer = (layer) => {
      T._debugSetEndlessLayer(layer);
      T.debugGrantBuff('C06');
      const run = T._debugRun('endless');
      run.idx = run.plan.length - 1; run.choices = null; run.phase = null;
      delete run.attempt; delete run.story;
      const nx = T.nextBattle('endless');
      T.reportBattle('endless', nx.token, true, 1500, 2000);
      T.continueFromShop();
      return T.endlessInfo().run;
    };
    const at20 = finishLayer(20);
    assert.equal(at20.phase, 'sacrifice', '第 20 层应当进献祭阶段');
    assert.equal(at20.story, 'gate20b', '第 20 层第一次献祭应当是「石门」那段，实测 ' + at20.story);
    /* 这一屏画出来时**必须是剧情屏**：界面靠 `TowerPlot.showing()` 判「先播剧情、读完才弹献祭窗」
     *（`openEndless` 里那句 `phase === 'sacrifice' && !TowerPlot.showing()`）——
     * 这个标记一旦失效，献祭窗会叠在剧情屏上，剧情被抢跑、seen 也记不上。 */
    uiHarness(c);
    c.TowerUI.openEndless();
    assert.equal(c.TowerPlot.showing(), true, '这一屏正在播剧情，献祭窗应当等它播完');
    /* 故意**不**记 seen：模拟「上一次剧情被打断」——旧版本就是在这里退化成
     * 「每次献祭都重播 20 层那段」，现在有轮内层号兜底。 */
    T.clearRunStory('endless');
    const at30 = finishLayer(30);
    assert.equal(at30.phase, 'sacrifice', '第 30 层应当进献祭阶段');
    assert.ok(/^offer[1-5]$/.test(String(at30.story)), '第 30 层应当走随机供词，实测 ' + at30.story);
  });

  check('调试台挪层只清本局待播剧情，不动「已播过」的记账', () => {
    const c = setup(7);
    const T = c.Tower;
    T.markStorySeen('gate20');
    T.markStorySeen('merchant');
    T._debugSetEndlessLayer(20);
    const run = T._debugRun('endless');
    run.story = 'gate20b';
    run.pendingStory = 'layer31';
    run.x00stage = 3;
    const before = Object.keys(c.State.state().endless.storySeen).sort().join(',');
    T._debugSetEndlessLayer(30);
    assert.equal(Object.keys(c.State.state().endless.storySeen).sort().join(','), before, '挪层不该改 storySeen');
    assert.equal(T._debugRun('endless').story, undefined, '待播剧情要跟着换层清掉（否则会跳层重播）');
    assert.equal(T._debugRun('endless').x00stage, 0, '整百层段号要归零');
    assert.equal(T.storySeen('gate20'), true, '已看过的仍然算看过');
    /* 清空剧情进度是另一个接口 */
    assert.ok(T._debugResetStory().cleared >= 2, '清空接口应当报出忘掉几段');
    assert.equal(T.storySeen('gate20'), false, '清空之后当没看过');
  });

  check('魔王名字：整百层「魔王·镜」，路上巡逻仍是「镜」（预告=实战）', () => {
    const c = setup(100);
    const T = c.Tower;
    const nameAt = (layer, idx) => {
      T._debugSetEndlessLayer(layer);
      const run = T._debugRun('endless');
      run.idx = idx;
      delete run.attempt; delete run.story;
      const nx = T.nextBattle('endless');
      return nx && nx.foe ? nx.foe.name : null;
    };
    let patrolLayer = 0, patrolIdx = -1;
    for (let L = 41; L <= 199 && patrolIdx < 0; L++) {
      T._debugSetEndlessLayer(L);
      const k = (T._debugRun('endless').plan || []).findIndex((e) => e && e.kind === 'patrol');
      if (k >= 0) { patrolLayer = L; patrolIdx = k; }
    }
    assert.equal(nameAt(patrolLayer, patrolIdx), '镜', '路上巡逻不该带前缀');
    assert.equal(nameAt(100, 2), '魔王·镜', '第 100 层的魔王要带前缀');
    assert.equal(nameAt(200, 2), '魔王·镜', '第 200 层同样');
    T._debugSetEndlessLayer(100);
    const king = (T.planInfo('endless') || []).find((x) => x.audience === 'king');
    assert.ok(king && king.name === '魔王·镜', '预告里也要同名，实测 ' + (king && king.name));
  });

  check('调试面板：删掉「清空无尽塔剧情进度 / 爬塔不耗挑战书 / 无尽试炼币拉满」，改出「试炼币不消耗」', () => {
    /* 2026-10 用户口径：最后那条工具与两条开关都不要了；「无尽试炼币拉满」改成「试炼币不消耗」。 */
    const c = setup(7);
    const { made } = debugHarness(c);
    const html = made.map((e) => String(e.innerHTML)).join('\n');
    assert.ok(!html.includes('清空无尽塔剧情进度'), '这条工具要从面板上删掉');
    assert.ok(!html.includes('爬塔不耗挑战书'), '重复的第二条挑战书开关要删掉');
    assert.ok(!html.includes('无尽试炼币拉满'), '「无尽试炼币拉满」改成「试炼币不消耗」');
    assert.ok(html.includes('关卡不耗挑战书'), '第一条挑战书开关保留');
    assert.ok(html.includes('试炼币不消耗'), '新开关要出现在面板上');
    /* 只删面板入口：底层接口保留（无尽塔剧情用例靠它复位）。 */
    assert.equal(typeof c.Tower._debugResetStory, 'function', '清空剧情进度的接口本身要留着');
  });
}

/* ============================================================ */
hr('16. 2026-10 镜中世界：整百层打赢魔王 → 拾取照影之境 → 继续挑战进 101 层');
{
  check('整百层：打赢魔王 → 拾取「照影之境」（永久增益最前面、介绍 ？？？、不占位）→「继续挑战」→ 第 101 层，之后每 100 层叠一层', () => {
    const c = setup(100);
    const T = c.Tower;
    const TD = c.TowerData;
    c.Main = { startBattle: () => Promise.resolve(), showHome: () => {} };
    const ui = uiHarness(c);
    T.setStoryEnabled(true);
    T._debugResetStory();
    T._debugSetEndlessLayer(100);
    T.clearRunStory('endless');
    /* 王庭那几段连播已经有专门的用例（`test-env-buff.cjs`）——这一节只看「终章之后 → 拾取屏」，
     * 所以先当作看过，免得把几十次点击都花在连播上。 */
    T.markStorySeen('layer100'); T.markStorySeen('x00a'); T.markStorySeen('x00b'); T.markStorySeen('x00c');
    /* 数据口径：传奇 + 剧情固定获得（不进任何随机池 / 商店 / 铸币商店）。 */
    const def = TD.BUFF_BY_ID[TD.MIRROR.id];
    assert.equal(TD.ENDLESS_X00_BONUS_TICKETS, 10, '整百层收手奖励的默认值');
    assert.equal(def.rarity, 3, '照影之境应当是传奇档');
    assert.equal(def.flavor, '映出一具完美的躯壳', '拾取卡上的那句话');
    assert.equal(def.desc, '？？？', '进背包之后的介绍');
    assert.equal(TD.descOf(def, 'endless'), '？？？', '介绍就是 ？？？（不该被追加叠层说明）');
    assert.ok(TD.hasTag(def, 'story'), '应当是「剧情固定获得」那一类');
    assert.equal((TD.endlessPool || []).indexOf(def), -1, '不该进无尽塔场间选择池');
    assert.equal((TD.shopPool || []).indexOf(def), -1, '不该上试炼商店货架');
    assert.equal((TD.mintPool || []).indexOf(def), -1, '不该上铸币商店货架');
    /* 打穿三连战：**这一场之后本层必须真的清空**（旧版本 run.idx 被归一化夹回去 →
     * layerClear 永不执行 → 卡在第 100 层反复打魔王）。 */
    let last = null;
    for (let i = 0; i < 3; i++) {
      T._debugRun('endless').choices = null;
      const nx = T.nextBattle('endless');
      assert.ok(nx.ok, '第 100 层应当能开打：' + (nx.msg || ''));
      last = T.reportBattle('endless', nx.token, true, 5000, 5000);
    }
    assert.equal(last.layerComplete, true, '打完第三场必须算「本层通关」（否则永远进不了下一层）');
    assert.equal(T._debugRun('endless').phase, 'mirror', '整百层通关后应当进「拾取照影之境」阶段');
    assert.equal(T.mirrorPending(), true, '拾取屏应当等着玩家');
    assert.equal(T._debugRun('endless').story, 'x00win', '终章剧情先播');
    /* 界面顺序：终章剧情 → 拾取屏（卡片居中，带那句 flavor）。 */
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /tower-story/, '先播终章剧情');
    for (let i = 0; i < 80 && /tower-story/.test(ui.last('page').content); i++) ui.click('story-next');
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /data-action="mirror-pick"/, '剧情之后应当是拾取屏');
    assert.match(ui.last('page').content, /映出一具完美的躯壳/, '卡片上要有那句话');
    assert.match(ui.last('page').content, /传奇/, '卡片要是传奇配色（传奇档文案）');
    /* 拾取：永久增益最前面 + 介绍 ？？？ + 不占永久位。 */
    const usedBefore = T.endlessInfo().run.permUsed;
    ui.click('mirror-pick');
    const row = T._debugRun('endless').permanent[0];
    assert.equal(row && row.id, 'C63', '拾取之后应当在永久表第一条，实测 ' + JSON.stringify(row));
    assert.equal(row.stacks, 1, '第一次是 1 层');
    assert.equal(T.mirrorStacks(), 1);
    assert.equal(T.endlessInfo().run.permUsed, usedBefore, '剧情件不占永久位');
    assert.equal(T.mirrorPending(), false, '拾取之后不该再判出拾取屏');
    /* 整百层胜利后「就此收手」的额外奖励：预览与实际发奖同口径。 */
    const pvWin = T.previewSettleTickets();
    assert.equal(pvWin.bonusTickets, 10, '100 层胜利后离场额外 10 张抽奖卷');
    assert.equal(pvWin.total, pvWin.layerTickets + pvWin.mintConverted + 10,
      '预览总额 = 层数奖励 + 铸币折券 + 百层胜利奖励');
    /* 剧情件是「发下来的」，不是构筑的一部分：不能卖、不能被巡逻收走、不进出售列表。 */
    assert.equal(T.sellListOf('endless').filter((b) => b.id === 'C63').length, 0, '不该出现在出售 / 免费交换列表里');
    assert.equal(T.patrolTollCandidates().list.filter((x) => x.id === 'C63').length, 0, '不该进巡逻收缴候选');
    assert.equal(T.sacrificeCandidatesOf().filter((x) => x.id === 'C63').length, 0, '不该进放弃永久增益的候选');
    /* 拾取后展示本次百层胜利战报；照影之境保留在已获得记录中。 */
    c.TowerUI.openEndless();
    assert.match(ui.last('page').content, /继续挑战/, '右下角应当是「继续挑战」');
    assert.ok(!/进入试炼商店|进入铸币商店/.test(ui.last('page').content), '整百层不该出现「进入商店」');
    const panel = ui.last('page').content;
    assert.match(panel, /endless-summary.*data-outcome="win"/, '本次百层真正胜利应当展示胜利战报');
    assert.ok(panel.indexOf('照影之境') > 0, '胜利战报里要保留刚获得的照影之境');
    assert.match(panel, /百层胜利额外 10 张/, '战报要写明整百层收手的 10 张额外抽奖卷');
    /* 「继续挑战」→ 确认弹窗 → 是 → 第 101 层（机制回到第 1 层的样子，数值接着长）。 */
    const scoreBefore = T._debugRun('endless').score;
    ui.click('summary-continue');
    const m = ui.modalButton('进入');
    const modalText = JSON.stringify(ui.last('modal').content || '');
    assert.match(modalText, /无尽之塔中的魔王已被击败，继续在镜中世界进行挑战吗？/, '弹窗要问这一句');
    m.run();
    const r101 = T._debugRun('endless');
    assert.equal(r101.layer, 101, '选「进入」之后应当进第 101 层');
    assert.equal(r101.idx, 0);
    assert.equal((r101.env || []).length, 0, '101 层与第 1 层同规矩：层内环境从头抽');
    assert.ok(r101.score >= scoreBefore, '分数继续累计（敌人数值也继续按公式长）');
    assert.equal(T.mirrorStacks(), 1, '照影之境跟着进下一层');
    assert.equal(T.previewSettleTickets().bonusTickets, 0, '进入 101 层后不再有百层收手奖励');
    /* 每过 100 层叠一层；关闭剧情的挑战模式同样能从胜利战报领取离场。 */
    T.setStoryEnabled(false);
    T._debugSetEndlessLayer(200);
    T.markStorySeen('x00b'); T.markStorySeen('x00c'); T.markStorySeen('x00win');
    for (let i = 0; i < 3; i++) {
      T._debugRun('endless').choices = null;
      const nx = T.nextBattle('endless');
      if (!nx.ok) break;
      T.reportBattle('endless', nx.token, true, 5000, 5000);
    }
    assert.equal(T.mirrorPending(), true, '第 200 层同样要出拾取屏');
    assert.equal(T.settleEndlessVictory().ok, false, '挑战模式也必须先拾取镜面奖励');
    const pick = T.takeMirrorReward();
    assert.equal(pick.ok, true, '第 200 层应当能再拾取一次');
    assert.equal(T.mirrorStacks(), 2, '照影之境应当叠到 2 层，实测 ' + T.mirrorStacks());
    assert.equal(T._debugRun('endless').permanent.length, 1, '叠层不是新增一行');
    assert.equal(T._debugRun('endless').story, 'x00win', '挑战模式下仍可能留有被跳过的终章标记');
    const ticketsBefore = c.State.state().props[50] || 0;
    c.TowerUI.openEndless(); ui.click('summary-settle');
    assert.equal(T.endlessInfo().run, null, '不手动清剧情也能从胜利战报领取并结束本局');
    assert.match(ui.last('page').content, /endless-summary.*data-outcome="win"/, '领取后保留已结算的胜利战报');
    const lastSummary = T.endlessInfo().lastSummary;
    assert.equal(lastSummary.bonusTickets, 10, '第 200 层收手也发百层奖励');
    assert.equal((c.State.state().props[50] || 0) - ticketsBefore, lastSummary.tickets, '10 张百层奖励已实际入包');
  });

  check('进入镜中世界封存首回合战斗属性，旧构筑重新入池且整局战报继续累计', () => {
    const c = setup(100), T = c.Tower, TD = c.TowerData;
    for (let i = 0; i < 3; i++) winOne(c);
    for (const id of ['C26', 'C54', 'C15', 'C55', 'E05', 'E04', 'C30', 'C31', 'C17', 'C17', 'C20', 'C18', 'C51']) {
      assert.ok(T.debugGrantBuff(id).ok, '可准备跨轮构筑：' + id);
    }
    let run = T._debugRun('endless');
    run.env = []; run.noEnvRoll = true; run.debuffs = [];
    const entryHp = Math.round(T.endlessInfo().run.curMaxHp * 0.3);
    run.hpAbs = entryHp; run.carry = 0.3;
    assert.ok(T.takeMirrorReward().ok);
    run.phase = 'mirror'; run.idx = run.plan.length; run.mirrorTaken = 100;
    const raw = c.State.totalStats({ useProps: false });
    const makeMe = () => ({ power: raw.power, agility: raw.agility, speed: raw.speed,
      hp: raw.hp, maxHp: raw.hp, baseStats: { power: c.State.state().power,
        agility: c.State.state().agility, speed: c.State.state().speed }, weapons: [], skills: [], effects: {} });
    /* 只封存静态数值：蛮力 +20% 本身；越战越勇 / 后发制人 / 战斗续航 / 狂怒 /
     * 增幅水晶（纯局内倍率）/ 天命所归都不进入快照。 */
    const staticPower = Math.max(1, Math.round(raw.power * 1.2));
    const staticLifesteal = 0.15;
    /* 48 层涌泉：0.1×48 = 4.800000000000001，照影快照不能把这个浮点尾巴封进去。 */
    run.fragileHealBase = 48;
    const history = JSON.stringify(run.runStats), wallet = run.coins;
    assert.ok(T.enterMirrorWorld().ok);
    run = T._debugRun('endless');
    const snap = run.mirrorSnapshot;
    assert.equal(snap.source.firstRound, true);
    assert.equal(snap.combat.healMul, 5.8, '封存的治疗倍率要收口成 5.8，不能是 5.800000000000001');
    assert.equal(snap.source.power, staticPower, '只封蛮力 +20%，不封增幅水晶 / 回合成长');
    assert.equal(snap.source.agility, raw.agility, '后发制人 / 狂怒不能折进敏捷');
    assert.equal(snap.source.maxHp, raw.hp, '战斗续航 / 空血上限不能折进生命上限');
    assert.ok(Math.abs(Number(snap.combat.lifestealPct) - staticLifesteal) < 1e-9, '静态吸血照常封存');
    assert.equal(run.rarityBoost, 0, '天命所归不保留');
    assert.equal(ids(run.permanent), 'C63'); assert.equal(run.limited.length, 0);
    assert.equal(T.obtainedCountOf(run, 'C55'), 0);
    assert.equal(T.ownableOf(run, TD.BUFF_BY_ID.C55), true, '同名唯一旧牌重新入池');
    assert.equal(T.ownableOf(run, TD.BUFF_BY_ID.E04), true, '本轮一次的运营牌重新入池');
    assert.equal(run.coins, wallet, '已赚余额保留'); assert.equal(run.shopDiscount, 0); assert.equal(run.permSlots, 0);
    assert.equal(T.retryBattle().ok, false, '旧战前快照不能跨镜回滚');
    assert.equal(JSON.stringify(run.runStats), history, '清构筑保留所有累计与收入');
    const frozen = JSON.stringify(snap);
    assert.equal(T.enterMirrorWorld().ok, false, '同一入口只吸收一次');
    c.State.save(); assert.ok(c.State.load());
    run = T._debugRun('endless');
    assert.equal(JSON.stringify(run.mirrorSnapshot), frozen, '快照往返存档不重复吸收');
    const next = T.nextBattle('endless'), carried = makeMe(); next.adjustMe(carried);
    assert.equal(carried.power, staticPower);
    assert.equal(carried.mods.roundStatPct || 0, 0, '旧回合成长不再运行');
    assert.equal(carried.mods.catchUpPct || 0, 0, '旧对手依赖成长不再运行');
    assert.equal(carried.mods.lowHpAgilityMul || 0, 0, '狂怒不能被误冻成永久敏捷');
    assert.ok(Math.abs(Number(carried.mods.lifestealPct) - staticLifesteal) < 1e-9, '永久战斗吸血保留当时已增幅的数值');
    T.interruptBattle('endless', next.token);
    const changed = makeMe(); changed.power += 50;
    const afterGear = T.nextBattle('endless'); afterGear.adjustMe(changed);
    assert.equal(changed.power, Math.max(1, Math.round((raw.power + 50) * snap.stats.power.mul + snap.stats.power.flat)),
      '外部基础改变后只应用已吸收倍率与固定增量');
    T.interruptBattle('endless', afterGear.token);
    assert.ok(T.debugGrantBuff('C15').ok);
    const newCrystal = T.nextBattle('endless'), afterCrystal = makeMe(); newCrystal.adjustMe(afterCrystal);
    assert.ok(Math.abs(Number(afterCrystal.mods.lifestealPct) - staticLifesteal) < 1e-9, '新水晶不会再次放大镜内旧吸血');
  });

  check('照影之境只吸收数值加成：C32/C33 与逢五强化不进入快照，101 层商店权重与第 1 层一致', () => {
    const c = setup(100), T = c.Tower;
    /* 先真的拿到神兵淬炼 / 秘技通神 / 逢五强化：前两者是选取型单次武装强化，
     * 后者只在 5 的倍数层生效。进入 101 层后它们都必须从快照里消失。 */
    c.State.setWS('weapon', 1, 1);
    c.State.setWS('skill', 8, 1);
    assert.ok(T.debugGrantBuff('C32').ok);
    assert.ok(T.applyPickBuff('weapon', 1).ok);
    assert.ok(T.debugGrantBuff('C33').ok);
    assert.ok(T.applyPickBuff('skill', 8).ok);
    assert.ok(T.debugGrantBuff('C09').ok);
    let run = T._debugRun('endless');
    assert.equal(run.weaponBoost[1], 1, 'C32 先记录武器强化');
    assert.ok(Number(run.skillBoost[8]) > 0, 'C33 先记录技能强化');
    run.noEnvRoll = true; run.env = []; run.debuffs = [];
    const raw = c.State.totalStats({ useProps: false });
    run.phase = 'mirror'; delete run.mirrorTaken;
    assert.ok(T.takeMirrorReward().ok);
    run.phase = 'mirror'; run.mirrorTaken = 100; run.idx = run.plan.length; run.choices = null; delete run.attempt;
    assert.ok(T.enterMirrorWorld().ok);
    run = T._debugRun('endless');
    const snap = run.mirrorSnapshot;
    assert.equal(snap.source.power, Math.max(1, Math.round(raw.power)), 'C32 的武器强化不能折进力量');
    assert.equal(snap.source.agility, Math.max(1, Math.round(raw.agility)), 'C33 不能改变四维');
    assert.equal(snap.source.speed, Math.max(1, Math.round(raw.speed)));
    assert.equal(snap.source.maxHp, Math.max(1, Math.round(raw.hp)), 'C09 的逢五强化不能折进生命上限');
    assert.equal(JSON.stringify(run.weaponBoost), '{}', '进入镜中世界后武器选取强化消失');
    assert.equal(JSON.stringify(run.skillBoost), '{}', '进入镜中世界后技能选取强化消失');
    assert.equal(JSON.stringify(run.pickBuffIds), '[]');
    /* 商店权重：第 101 层与第 1 层在同一随机种子下必须逐件抽出同一货架。 */
    const fresh = setup(1);
    const freshRun = fresh.Tower._debugRun('endless');
    for (let seed = 1; seed <= 20; seed++) {
      c.__seed(seed * 104729);
      fresh.__seed(seed * 104729);
      const a = JSON.parse(JSON.stringify(run));
      const b = JSON.parse(JSON.stringify(freshRun));
      assert.equal(JSON.stringify(c.Tower.rollShopSlotsOf(a, 0).map((s) => s.id)),
        JSON.stringify(fresh.Tower.rollShopSlotsOf(b, 0).map((s) => s.id)),
        '第 101 层与第 1 层第 ' + seed + ' 个随机序列');
    }
  });

  check('照影之境之后的加算/乘算增益依次结算，第二个照影之境以第一个结算后的值为白值', () => {
    const c = setup(100), T = c.Tower;
    const freezeAt = (layer) => {
      let run = T._debugRun('endless');
      run.noEnvRoll = true; run.env = []; run.debuffs = [];
      run.phase = 'mirror'; delete run.mirrorTaken;
      assert.ok(T.takeMirrorReward().ok);
      run = T._debugRun('endless');
      run.phase = 'mirror'; run.mirrorTaken = layer; run.idx = run.plan.length; run.choices = null; delete run.attempt;
      assert.ok(T.enterMirrorWorld().ok);
      return T._debugRun('endless');
    };
    const nextMe = () => {
      const raw = c.State.totalStats({ useProps: false });
      const nx = T.nextBattle('endless');
      const me = { power: raw.power, agility: raw.agility, speed: raw.speed, hp: raw.hp, maxHp: raw.hp,
        baseStats: { power: c.State.state().power, agility: c.State.state().agility, speed: c.State.state().speed },
        weapons: [], skills: [], effects: {} };
      nx.adjustMe(me);
      T.interruptBattle('endless', nx.token);
      return me;
    };
    const raw = c.State.totalStats({ useProps: false });
    assert.ok(T.debugGrantBuff('C26').ok);
    let run = freezeAt(100);
    const first = run.mirrorSnapshot;
    const firstPower = Math.max(1, Math.round(raw.power * 1.2));
    assert.equal(first.source.power, firstPower, '首轮蛮力 +20% 已封存');
    /* 101 层之后拿到第二张蛮力与增幅水晶：先镜面结算，再按 (1+0.2×1.3) 结算。 */
    assert.ok(T.debugGrantBuff('C26').ok);
    assert.ok(T.debugGrantBuff('C15').ok);
    const after101Power = Math.max(1, Math.round(firstPower * (1 + 0.2 * 1.3)));
    assert.equal(nextMe().power, after101Power, '新加算/乘算增益在照影之境之后结算');
    /* 第 200 层再吸收：第二层以第一层结算后的值为白值；增幅水晶是纯局内倍率，
     * 只影响 101 层当场战斗，不进入第二层快照。 */
    T._debugSetEndlessLayer(200);
    assert.ok(T.debugGrantBuff('C27').ok);
    run = freezeAt(200);
    const second = run.mirrorSnapshot;
    /* 第二层以第一层结算后的力量为白值；但增幅水晶是纯局内倍率，不进入第二层快照，
     * 所以这里只剩新蛮力的 +20%，而不是 101 层战斗中的 +28%。 */
    const secondPower = Math.max(1, Math.round(firstPower * 1.2));
    assert.equal(second.source.power, secondPower, '第二层照影以第一层结算后的力量为白值');
    assert.equal(second.source.agility, Math.max(1, Math.round(raw.agility * 1.2)),
      '第二层照影在第一个之后结算敏捷 +20%（不含增幅水晶）');
    const at201 = nextMe();
    assert.equal(at201.power, secondPower);
    assert.equal(at201.agility, second.source.agility);
    assert.equal(T.mirrorStacks(), 2);
    assert.equal(run.permanent.length, 1);
  });

  check('减伤按乘算叠加：两条 −60% 是 −84%，不是加算到 −120% / 100% 减伤', () => {
    const c = setup(7), T = c.Tower;
    const run = T._debugRun('endless');
    run.permanent = [];
    run.limited = [
      { id: 'N14', stacks: 1, uses: 10, on: true, uid: 1 },
      { id: 'N14', stacks: 1, uses: 10, on: true, uid: 2 },
    ];
    run.choices = null; run.phase = null; delete run.attempt;
    const nx = T.nextBattle('endless');
    const me = { power: 1000, agility: 1000, speed: 1000, hp: 5000, maxHp: 5000,
      baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [], skills: [], effects: {} };
    nx.adjustMe(me);
    const want = (1 - 0.6) * (1 - 0.6) - 1;      // −0.84
    assert.ok(Math.abs(Number(me.mods.lowHpTakenMul) - want) < 1e-9,
      '两条 60% 减伤应当乘算成 −84%，实测 ' + me.mods.lowHpTakenMul);
    T.interruptBattle('endless', nx.token);
  });
}

/* ============================================================ */
hr('17. 2026-10 同名叠加：栏位叠满后新栏位继续叠，效果按「总层数」累加（越战越勇 2+2 层）');
{
  check('越战越勇（每栏最多 2 层）拿 4 份 → 两栏各 2 层，合起来每回合 +6%（不是只算一栏的 +3%）', () => {
    const c = setup(30);
    const T = c.Tower, TD = c.TowerData;
    const run = T._debugRun('endless');
    run.permanent = []; run.limited = []; run.permSlots = 0;
    run.noEnvRoll = true; run.env = [];
    const rows = (id) => (run.permanent || []).filter((b) => b && b.id === id);
    /* ① 获得路径（需求103 / 需求105 的口径）：`maxStacks` 是**每栏**的上限，
     *    叠满之后新开一栏继续叠，而不是「到此为止」——同名条目会并排出现。 */
    assert.ok(T.debugGrantBuff('C54').ok, '第 1 份');
    assert.ok(T.debugGrantBuff('C54').ok, '第 2 份');
    assert.deepEqual(rows('C54').map((b) => b.stacks), [2], '两份额叠在同一栏：×2');
    assert.ok(T.debugGrantBuff('C54').ok && T.debugGrantBuff('C54').ok, '第 3、4 份应当另开一栏继续叠');
    assert.deepEqual(rows('C54').map((b) => b.stacks), [2, 2], '应当是两栏各 2 层（不是每栏停在 1 层）');
    assert.equal(T.obtainedCountOf(run, 'C54'), 4, '合计 4 层');
    assert.equal(T.ownableOf(run, TD.BUFF_BY_ID.C54), true, '满层之后仍可出现（需求105）');
    /* ② 效果路径：aggregate 把各栏**按层数**累加 → 4 层 = 每回合 +6%（1 层 +1.5%）。 */
    run.idx = 0; run.choices = null; run.phase = null; delete run.attempt;
    const nx = T.nextBattle('endless');
    const me = { power: 1000, agility: 1000, speed: 1000, hp: 5000, maxHp: 5000,
      baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    delete run.attempt;
    assert.ok(Math.abs((me.mods.roundStatPct || 0) - 0.06) < 1e-9,
      '4 层应当给 6%（1 层 1.5% × 4），实测 ' + JSON.stringify(me.mods.roundStatPct));
    /* ②b 同一类「针对特定敌人」的伤害加成：同名多栏**相加**（+25%/层 × 5 层 = ×2.25），
     *    而不是「每栏各自乘一遍」（3 层 × 2 层 = ×2.625）—— 后者会超出描述里的 +25%/层。 */
    for (const id of ['C03', 'C03', 'C03', 'C03', 'C03']) T.debugGrantBuff(id);
    assert.equal(T.obtainedCountOf(run, 'C03'), 5, '猎侠者 5 层（3 + 2 两栏）');
    run.idx = 0; run.choices = null; run.phase = null; delete run.attempt;
    const nx2 = T.nextBattle('endless');
    const me2 = { power: 1000, agility: 1000, speed: 1000, hp: 5000, maxHp: 5000,
      baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], effects: {}, masterLevel: 0 };
    nx2.adjustMe(me2);
    delete run.attempt;
    assert.ok(Math.abs((me2.mods.dmgMul || 1) - 2.25) < 1e-9,
      '猎侠者 5 层应当是 ×2.25（+125%），实测 ' + JSON.stringify(me2.mods.dmgMul));
    /* ③ 反例：`unique` / `noRestack` 的那一类才是「有了就不再出现、拿不到第二份」。 */
    assert.equal(T.debugGrantBuff('C55').ok, true, '后发制人第一份');
    assert.equal(T.debugGrantBuff('C55').ok, false, '后发制人（noRestack）拿不到第二份');
    assert.equal(T.ownableOf(run, TD.BUFF_BY_ID.C55), false, '它满层后要从池子里出去');
  });
}

/* ============================================================ */
hr('18. 2026-10 跳过键的代价（塔）：跳过的场次在层结算里各随机抹掉一项');
{
  check('挑战塔：按跳过键打过 1 场 → 层结算抹掉一项并写明；没跳过就一件不少', () => {
    /* 把一层打完（`skipFirst` = 第 1 场按了跳过键），返回层结算结果。 */
    const clearLayer = (skipFirst) => {
      const c = setup(30);
      const T = c.Tower;
      assert.ok(T.startTowerRun().ok, '应当能开挑战塔');
      let rw = null;
      for (let guard = 0; guard < 40; guard++) {
        const run = T._debugRun('tower');
        if (!run) break;
        if (run.phase === 'shop') { T.closeShop(); continue; }
        if (run.choices) { T.pickChoice('tower', 0); continue; }
        const nx = T.nextBattle('tower');
        if (!nx.ok) break;
        const battleNo = run.idx;
        rw = T.reportBattle('tower', nx.token, true, 4000, 5000,
          { rounds: [], hpAfter: [4000, 0], skipped: !!(skipFirst && battleNo === 0) });
        if (rw && rw.prizes) return rw;
      }
      return rw;
    };
    /* ① 全程不按跳过：悬浮奖品一件不少，也没有「少收」记录。 */
    const plain = clearLayer(false);
    assert.ok(plain && plain.prizes && plain.prizes.items && plain.prizes.items.length,
      '层结算应当给悬浮奖品：' + JSON.stringify(plain && plain.prizes));
    assert.equal(plain.prizes.lost, undefined, '没按跳过键就不该有「少收」');
    const full = plain.prizes.items.reduce((n, it) => n + it.count, 0);
    /* ② 第 1 场按了跳过键：结算里恰好抹掉一项（数量少那一项，并记下少收的是什么）。 */
    const skipped = clearLayer(true);
    assert.ok(skipped && skipped.prizes, '跳过时也要照常层结算');
    assert.ok(Array.isArray(skipped.prizes.lost) && skipped.prizes.lost.length === 1,
      '跳过 1 场就要记 1 项「少收」：' + JSON.stringify(skipped.prizes.lost));
    const fewer = skipped.prizes.items.reduce((n, it) => n + it.count, 0);
    assert.equal(fewer, full - skipped.prizes.lost[0].count, '正好少掉那一项的数量（其余照发）');
    /* ③ 记账是**本层**的、而且不许超过这一层的场数：归一化会把坏值（旧档 / 手改）夹回来。 */
    const c3 = setup(30);
    assert.ok(c3.Tower.startTowerRun().ok);
    const r3 = c3.Tower._debugRun('tower');
    r3.skippedBattles = 5;
    r3.plan = [r3.plan[0]];                                // 只留一场（用真实条目，别造假数据）
    r3.idx = 1;
    c3.Tower.towerInfo();                                  // 访问一次对局 → 走 normalizeRun
    assert.equal(c3.Tower._debugRun('tower').skippedBattles, 1,
      '归一化要把「跳过场次」夹在这一层的场数之内：' + c3.Tower._debugRun('tower').skippedBattles);
    /* ④ 常驻挑战（无尽塔）没有飘物：代价按同一套口径记在**这一场的试炼币**上（只收 2/3）。 */
    const fightOnce = (skipped) => {
      const c4 = setup(30);
      const T4 = c4.Tower;
      const run4 = T4._debugRun('endless');
      run4.choices = null; run4.phase = null;
      const before = Math.max(0, Number(run4.coins) || 0);
      const nb = T4.nextBattle('endless');
      const rw = T4.reportBattle('endless', nb.token, true, 4000, 5000,
        { rounds: [], hpAfter: [4000, 0], skipped: skipped });
      assert.ok(rw && rw.ok, '这一场应当正常结算');
      return Math.max(0, Number(T4._debugRun('endless').coins) || 0) - before;
    };
    const fullCoins = fightOnce(false), cutCoins = fightOnce(true);
    assert.ok(fullCoins > 0, '没跳过时应当有试炼币进账：' + fullCoins);
    assert.equal(cutCoins, Math.round(fullCoins * 2 / 3),
      '跳过时这一场的试炼币只收 2/3（实测 ' + cutCoins + ' vs ' + fullCoins + '）');
  });
}

/* ============================================================ */
check('剧情页文字太长时会自动往下翻：最后一行打出来必须能看见', () => {
  /* 用**真实实现**：从 js/tower-plot.js 里抠出 storyScrollToCursor，配一个会算几何的假文字框。
   * 2026-10 用户口径：一页文字太多时，最后一行打完停在屏幕外 —— 剧情页要能自动下翻。
   * 注意 storyPaint 是整块重写 innerHTML（浏览器会把滚动位置归零），所以必须**每次重画都带一次**。 */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower-plot.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = src.indexOf('function storyScrollToCursor');
  assert.ok(at > 0, 'js/tower-plot.js 里应当有 storyScrollToCursor');
  let i = src.indexOf('{', at), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth -= 1; if (!depth) { end = i + 1; break; } }
  }
  assert.ok(end > at, '应当能抠出 storyScrollToCursor 的函数体');
  const storyScrollToCursor = new Function(src.slice(at, end) + '; return storyScrollToCursor;')();

  /* ① 长页：可视高 300、内容高 900，当前行在 700~740（末尾在屏幕外）
   *    → 应当滚到 700+40+8-300 = 448 */
  const long = { scrollTop: 0, clientHeight: 300, scrollHeight: 900,
    querySelector: (s) => (s === '.tower-story-line.now' ? { offsetTop: 700, offsetHeight: 40 } : null) };
  storyScrollToCursor(long);
  assert.equal(long.scrollTop, 448, '当前行底部要带进可视区（实测 ' + long.scrollTop + '）');
  /* 再调一次不能越滚越远（幂等） */
  storyScrollToCursor(long);
  assert.equal(long.scrollTop, 448, '重复调用应当稳定：' + long.scrollTop);

  /* ② 短页（装得下）：不该乱滚 */
  const short = { scrollTop: 0, clientHeight: 300, scrollHeight: 300,
    querySelector: () => ({ offsetTop: 100, offsetHeight: 40 }) };
  storyScrollToCursor(short);
  assert.equal(short.scrollTop, 0, '文字装得下时不该滚动：' + short.scrollTop);

  /* ③ 到底了也不能越界 */
  const tall = { scrollTop: 0, clientHeight: 300, scrollHeight: 1200,
    querySelector: () => ({ offsetTop: 2000, offsetHeight: 40 }) };
  storyScrollToCursor(tall);
  assert.equal(tall.scrollTop, 900, '最多只能滚到 scrollHeight-clientHeight：' + tall.scrollTop);

  /* ④ 接线：打字机每次重画后要带一次；整页重画（tower-ui 的 page() 之后）也要补一次 */
  const paint = src.slice(src.indexOf('function storyPaint'), src.indexOf('function storyTick'));
  assert.match(paint, /storyScrollToCursor\(box\)/, 'storyPaint 每打一个字都要把当前行带回可视区');
  assert.match(src, /afterRender:\s*storyAfterRender/, '要把 storyAfterRender 导出成 afterRender（整页重画后补滚动用）');
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(uiSrc, /TowerPlot\.afterRender\(\)/, 'tower-ui 画完 page() 之后要调一次 afterRender');

  /* ⑤ 版式：文字区不能用 justify-content:center（溢出时开头几行滚不上去），
   *    改用「首尾 auto 外边距」那套居中写法。 */
  const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8').replace(/\r\n/g, '\n');
  const box = (css.match(/\.tower-story-text\s*\{[^}]*\}/) || [''])[0];
  assert.ok(!/justify-content:\s*center/.test(box),
    '剧情文字区不该用 justify-content:center（文字溢出时开头几行会滚不到）：' + box);
  assert.match(css, /\.tower-story-text\s*>\s*\.tower-story-line:first-child\s*\{[^}]*margin-top:\s*auto/,
    '文字装得下时要靠 margin-top:auto 保持垂直居中');
  assert.match(css, /\.tower-story-text\s*>\s*\.tower-story-line:last-child\s*\{[^}]*margin-bottom:\s*auto/,
    '文字装得下时要靠 margin-bottom:auto 保持垂直居中');
});

/* ============================================================ */
check('照影之境的拾取卡居中在整个屏幕（不是塔身右侧那半屏）', () => {
  /* 用户口径 2026-10：拿到「照影之境」时卡片要在**整个屏幕正中央**。
   * 之前 `.tower-mirror` 是 `.tower-main`（塔身右边那一列）里的 position:relative 块，
   * 于是「居中」居的是右半边 —— headless Chrome 在 1170×690 下量到卡片中心 x=744、舞台中心 573，
   * 偏右 171px。改成整屏定位层（fixed + inset:0，`#ui` 上有 transform，所以相对的是整个舞台）后偏差 0。 */
  const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8').replace(/\r\n/g, '\n');
  const rule = (css.match(/\.tower-mirror\s*\{[^}]*\}/) || [''])[0];
  assert.match(rule, /position:\s*fixed/, '.tower-mirror 要整屏定位（否则居中的是右半边）：' + rule);
  assert.match(rule, /inset:\s*0/, '.tower-mirror 要铺满整个舞台：' + rule);
  assert.ok(!/min-height:\s*62vh/.test(rule), '旧的「半屏 62vh」写法要去掉：' + rule);
  assert.match(rule, /pointer-events:\s*none/, '整屏层自己不吃点击（塔身 / 左下角模式开关照旧）：' + rule);
  /* fixed 层会建独立层叠上下文；整层自己不抬 z-index 时，白幕盖不住
   * 「返回征战」（.classic-tower-bar z-index:5）与左下的模式开关。 */
  const ruleNoComment = rule.replace(/\/\*[\s\S]*?\*\//g, '');
  const z = Number((ruleNoComment.match(/z-index:\s*(\d+)/) || [])[1] || 0);
  assert.ok(z > 60, '整屏层要压过塔页动作条（z-index:60），白幕才会连返回/模式开关一起变白：' + rule);
  assert.match(css, /\.tower-mirror\s+\.mirror-card-wrap\s*\{[^}]*pointer-events:\s*auto/,
    '卡片自己仍要能点（pointer-events:auto）');
});

/* ============================================================ */
check('两座塔页面的「返回」都回关卡界面（不是主界面）', () => {
  /* 用户口径 2026-10：挑战塔 / 无尽塔都是从**关卡页**进来的，返回就该回关卡页。
   * 真身走 `UI.runAction('stages')`（顶层分发器 → openStages），不是 `C().home()`。 */
  for (const [seed, open, label] of [[11, (c) => c.TowerUI.openEndless(), '无尽塔'], [13, (c) => c.TowerUI.openTower(), '挑战塔']]) {
    const c = setup(seed);
    const ui = uiHarness(c);
    open(c);
    ui.click('home');                       // 就是那颗「返回」
    assert.deepEqual(ui.nav, ['stages'],
      label + '的「返回」应当打开关卡页，而不是回主界面：' + JSON.stringify(ui.nav));
  }

  /* 反例保护：桩里没有顶层 runAction 时（老壳 / 别的宿主）也要能退回主界面，不能抛异常。 */
  const c2 = setup(12);
  const ui2 = uiHarness(c2);
  delete c2.UI.runAction;
  c2.TowerUI.openEndless();
  ui2.click('home');
  assert.deepEqual(ui2.nav, ['home'], '拿不到 runAction 时退回主界面，不能抛：' + JSON.stringify(ui2.nav));
});

/* ============================================================ */
check('挑战塔的「开始挑战」不再带「（挑战书×1）」', () => {
  /* 用户口径 2026-10：按钮就写「开始挑战」。消耗没丢 —— 按钮左边那颗「现有挑战书 N 张」还在。
   * 2026-10 再一条：上面那一串规则介绍（「每层 1 张挑战书 · 连战只继承血量…」）按用户口径整段去掉。 */
  const c = setup(21);
  const ui = uiHarness(c);
  c.TowerUI.openTower();
  const page = ui.last('page').content;
  assert.match(page, /data-action="fight"[^>]*>开始挑战</, '按钮文案应当就是「开始挑战」');
  assert.ok(!/开始挑战（挑战书/.test(page), '不该再带「（挑战书×1）」');
  assert.match(page, /tower-book-count[^>]*>现有挑战书 \d+ 张</, '张数仍然写在按钮左边');
  assert.ok(!/每层 1 张挑战书/.test(page), '那一串规则介绍已经去掉');
});

/* ============================================================ */
check('调试开关「关卡不耗挑战书」同时管挑战塔进层（原来那条重复的「爬塔不耗挑战书」已删）', () => {
  const c = setup(30);
  const T = c.Tower, S = c.State.state();
  S.props[23] = 0;
  const denied = T.startTowerRun();
  assert.equal(denied.ok, false, '没挑战书时开不了挑战塔');
  assert.equal(denied.needsBook, true, '缺的是挑战书：' + JSON.stringify(denied));
  debugHarness(c);                                   // 挂上真正的 window.Debug
  c.window.Debug.set('noStageCost', true);
  S.props[23] = 0;
  assert.equal(T.startTowerRun().ok, true, '开着「关卡不耗挑战书」时挑战塔也能开局');
  assert.equal(S.props[23] || 0, 0, '本来就没有挑战书，也没有被扣');
  assert.equal(T._debugRun('tower').layer, 1, '照常落在第 1 层');
});

/* ============================================================ */
check('调试开关「试炼币不消耗」：试炼商店买 / 刷新 / 买铸币与铸币商店购买都不扣代币（余额 0 也能买）', () => {
  const c = setup(7);
  debugHarness(c);                                   // 挂上真正的 window.Debug
  const T = c.Tower;
  const run = T._debugRun('endless');
  /* 对照组：开关没开时，余额 0 的三条路都走不通。 */
  run.coins = 0; run.retryToken = 0;
  T._debugSpawnShop();
  assert.equal(T.buyShopSlot(0).ok, false, '对照：试炼币 0 买不了增益');
  assert.equal(T.buyRetryToken().ok, false, '对照：试炼币 0 买不了铸币');
  T._debugSpawnMintShop();
  assert.equal(T.buyMintSlot(0).ok, false, '对照：铸币 0 买不了货架上的东西');
  assert.ok(run.shop && run.shop.slots.length, '铸币商店照旧开着');
  /* 开开关：三条路都照买，余额一分不动。 */
  c.window.Debug.set('noCoinCost', true);
  run.coins = 0; run.retryToken = 0;
  T._debugSpawnShop();
  const bought = T.buyShopSlot(0);
  assert.equal(bought.ok, true, '试炼币 0 也能买增益：' + JSON.stringify(bought));
  assert.equal(run.coins, 0, '买完试炼币还是 0');
  const token = T.buyRetryToken();
  assert.equal(token.ok, true, '买铸币也不扣：' + JSON.stringify(token));
  assert.equal(run.coins, 0, '试炼币仍然是 0');
  assert.equal(run.retryToken, 1, '铸币照常 +1');
  /* 首次刷新是免费的（shop.rerollFree / rerollPriceAt(0) = 0），先关掉免费并把计数推高才真的收费。 */
  run.shop.rerollFree = false;
  run.shop.rerollCount = 3;
  const rr = T.rerollShop();
  assert.equal(rr.ok, true, '刷新货架也不扣：' + JSON.stringify(rr));
  assert.ok(rr.paid > 0, '这一次刷新确实是收费的那一档：' + rr.paid);
  assert.equal(run.coins, 0, '刷新之后试炼币还是 0');
  run.retryToken = 0;
  T._debugSpawnMintShop();
  const mint = T.buyMintSlot(0);
  assert.equal(mint.ok, true, '铸币 0 也能买：' + JSON.stringify(mint));
  assert.equal(run.retryToken, 0, '铸币没被扣');
});

check('黑装：挑战塔 20/50 层黑卡与 100 层自选箱', () => {
  const c = setup(1);
  const T = c.Tower;
  assert.deepEqual([5, 9, 10, 20, 25, 50, 75, 100].map(T.towerBlackCards),
    [0, 0, 0, 1, 0, 1, 0, 0], '每 20 层 1 张、每 50 层再 +1；100 层只给自选箱、不发卡');
});

check('黑装：100 层自选箱（89）排在背包第一页最前，不会看起来像没进背包', () => {
  /* 自选箱按 id 升序会排到所有道具之后；背包一页 6 格，玩家在第一页根本看不到。
   * 现在 classic-ui 的 bagSort 把 89 固定在最前（开包与就地刷新共用同一个排序）。 */
  const cu = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(cu, /const bagSort = [\s\S]*?Number\(a && a\.id\) === 89[\s\S]*?items\.sort\(bagSort\)[\s\S]*?nextItems\.sort\(bagSort\)/,
    '背包排序要把 89 放第一页，开包与刷新两处共用');
});

check('黑装：无尽塔每累计 50 层 1 张黑卡', () => {
  const c = setup(1);
  const T = c.Tower;
  assert.deepEqual([10, 20, 40, 49, 50, 100, 150].map(T.endlessBlackCardLayer),
    [false, false, false, false, true, true, true], '50/100/150 层各 1 张，其他层不发');
});

check('黑装：挑战塔旧进度补发黑卡与 100 层自选箱（不重复发）', () => {
  const c = setup(1), S = c.State.state(), T = c.Tower;
  S.tower.maxLayer = 150;
  S.blackTowerLayer = 0;
  S.blackBox100 = false;
  S.props[80] = 0; S.props[89] = 0;
  const expected = Array.from({ length: 150 }, (_, i) => T.towerBlackCards(i + 1))
    .reduce((a, b) => a + b, 0);
  const r = T.settleBlackTowerRewards();
  assert.equal(r.cards, expected, '150 层共 ' + expected + ' 张');
  assert.equal(S.props[80], expected);
  assert.equal(S.props[89], 1, '100 层自选箱补发 1 个');
  assert.equal(S.blackTowerLayer, 150);
  const again = T.settleBlackTowerRewards();
  assert.equal(again.cards, 0, '第二次不重复发卡');
  assert.equal(again.box, 0, '第二次不重复发自选箱');
  assert.equal(S.props[80], expected);
});

check('立即进货 + steam大促：合并为 4 折，E01 描述不再写 3.5 折', () => {
  const c = setup(7);
  const T = c.Tower, TD = c.TowerData;
  assert.ok(T.debugGrantBuff('E04').ok, '先拿 steam大促');
  assert.ok(T.debugGrantBuff('E01').ok, '再拿立即进货');
  assert.ok(!/steam|3\.5/.test(TD.BUFF_BY_ID.E01.desc), '立即进货描述不该再写 combo：' + TD.BUFF_BY_ID.E01.desc);
  const rw = winOne(c);
  assert.equal(rw.postBattleShop, true, 'E01 应当开出战后商店');
  const run = T._debugRun('endless');
  assert.equal(run.shop.discountPct, 0.60, '合并折扣应为 −60%（4 折），实测 ' + run.shop.discountPct);
  assert.equal(run.shop.combinedCoupon, true, '这家店要标记为合并券店，收摊时清 E04');
  const st = T.shopState();
  const slot = st.slots.find((s) => !s.sold && s.listPrice > 0);
  assert.ok(slot, '应当有一件可买商品');
  assert.equal(slot.price, Math.max(1, Math.round(slot.listPrice * 0.40)),
    '实际售价应为原价的 40%：' + slot.price + ' / ' + slot.listPrice);
  /* 休整商店同样走合并口径（老 bug 是这里把 E04 先吃掉，E01 店只剩 7 折）。 */
  const c2 = setup(7);
  assert.ok(c2.Tower.debugGrantBuff('E04').ok);
  assert.ok(c2.Tower.debugGrantBuff('E01').ok);
  const r2 = c2.Tower._debugRun('endless');
  r2.choices = [{ type: 'buff', id: 'C02' }]; r2.restShopUsed = false; r2.phase = null;
  assert.ok(c2.Tower.openRestShop().ok, '应当能开休整商店');
  assert.equal(c2.Tower._debugRun('endless').shop.discountPct, 0.60,
    '休整商店也要按 4 折合并，不能把 E04 提前吃掉');
  assert.equal(c2.Tower._debugRun('endless').shop.combinedCoupon, true);
  /* 层末结算商店也走同一份 shopPct，不能因为是 boundary 就退回 7 折。 */
  const c3 = setup(5);
  assert.ok(c3.Tower.debugGrantBuff('E04').ok);
  assert.ok(c3.Tower.debugGrantBuff('E01').ok);
  const r3 = c3.Tower._debugRun('endless');
  r3.idx = r3.plan.length - 1; r3.choices = null; r3.phase = null;
  const nx3 = c3.Tower.nextBattle('endless');
  assert.ok(nx3.ok, nx3.msg);
  c3.Tower.reportBattle('endless', nx3.token, true, 1500, 2000);
  const endShop = c3.Tower._debugRun('endless').shop;
  assert.equal(endShop.discountPct, 0.60, '层末结算商店也要按 4 折合并');
  assert.equal(endShop.boundary, true, '层末商店仍要标 boundary');
});

/* ============================================================ */
(async () => {
  console.log('\n铸币商店回归：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
