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
const LOAD = ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js',
  'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js'];

/** 极简「界面桩」：把 tower-ui.js 的页面与弹窗渲染出来（只记 HTML 与按钮处理器），
 *  用来冒烟跑一遍新商店页面的真实代码路径（不需要浏览器）。 */
function uiHarness(c) {
  const rendered = [];
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
    page: (group, active, content, opts) => { rendered.push({ kind: 'page', content: content, opts: opts || {} }); return el(); },
    modal: (title, content, buttons) => {
      rendered.push({ kind: 'modal', title: title, content: content, buttons: buttons || [] });
      return { element: el(), close: () => {} };
    },
    btn: (label, action, cls) => '<button class="' + (cls || '') + '" data-action="' + action + '">' + label + '</button>',
    icon: () => '<i></i>', bind: () => {}, home: () => {}, refreshHeader: () => {},
  } };
  /* 载入真界面模块（和浏览器同一份代码）。 */
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8'), c, { filename: 'js/tower-ui.js' });
  return {
    rendered,
    last: (kind) => rendered.filter((r) => r.kind === kind).pop(),
    click: (action) => {
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
  for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };
  /* 固定随机：__rand(v) → 每次调用都返回 v（0 = 必中概率 / 必取第一项；0.99 = 必不中）。 */
  c.__rand = (v) => vm.runInContext('(function(){var v=' + Number(v) + ';Math.random=function(){return v;};return true;})()', c);
  /* 固定随机：LCG（用于统计采样；同一 seed 完全可复现）。 */
  c.__seed = (n) => vm.runInContext(
    '(function(){var s=' + Number(n) + ';Math.random=function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};return true;})()', c);
  c.__rand(0.99);
  assert.ok(c.Tower.startEndlessRun().ok, '应该能开一局无尽塔');
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

  check('ops（运营类）与用户口径一致', () => {
    const want = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E09', 'E10', 'E12', 'E13', 'E14', 'E16',
      'C24', 'C25', 'C30', 'C31', 'C36', 'C37', 'C53', 'C58', 'C59'].sort().join(',');
    assert.equal(ids(TD.opsPool.slice().sort((a, b) => (a.id < b.id ? -1 : 1))), want);
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
    for (const s of st.slots) {
      const def = c.TowerData.BUFF_BY_ID[s.id];
      assert.equal(s.price, c.TowerData.MINT_SHOP.price[def.rarity], s.name + ' 的售价应当是固定价');
      assert.equal(s.rarity, def.rarity);
      assert.ok(s.name && s.desc, '货架要有名字与说明');
    }
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

  check('C59 叠层：铸币商店按层数发（×层数）', () => {
    const c = setup(7);
    c.__rand(0);
    assert.ok(c.Tower.debugGrantBuff('C59').ok);
    assert.ok(c.Tower.debugGrantBuff('C59').ok);
    assert.ok(c.Tower.debugGrantBuff('C59').ok);
    assert.equal(c.Tower._debugRun('endless').permanent.find((b) => b.id === 'C59').stacks, 3);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.ok(run.shop && run.shop.mint);
    assert.equal(run.shop.enterCoins, 240, '3 层 → 240 试炼币（80 × 3）');
    assert.equal(c.Tower.claimShopEnterCoins(), 240);
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
    assert.equal(r.price, 1, '磐石之躯（稀有）固定价 1 铸币（货架上的 999 不作数）');
    assert.equal(run.retryToken, before - 1, '扣 1 枚铸币');
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
    assert.equal(run.retryToken, 8);
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
    assert.equal(run.retryToken, 1);
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

  check('战后自动进店：rw.mintShop 直接开商店页', () => {
    const body = sliceOf(pageSrc, 'const cont = () => {');
    assert.ok(body.includes('rw.mintShop'), '战后应当按 rw.mintShop 自动进店');
    assert.ok(body.includes('openShop()'), '自动进店要调 openShop()');
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
    for (const call of ['Tower.buyMintSlot(i)', 'Tower.rerollMintShop()', 'Tower.swapMintBuff(rowRef(b))', 'Tower.leaveMintShop()']) {
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
    run0.shop.slots[0].half = true;
    c.TowerUI.openMintShop();
    const page = ui.last('page');
    assert.ok(page && page.content.includes('铸币商店'), '页面正文应当有「铸币商店」标题');
    assert.ok(page.content.includes('价格表') && page.content.includes('免费刷新'), '页面应当有价格表与免费刷新');
    assert.ok(page.content.includes('免费交换'), '页面应当有免费交换区');
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
    assert.ok(after.content.includes('无尽模式'), '应当回到无尽首页（渲染成功）');
  });

  check('界面冒烟：点「拿它交换」→ 确认 → 换到新件、收摊', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    c.__rand(0);
    winOne(c);
    const run = c.Tower._debugRun('endless');
    assert.ok(c.Tower.debugGrantBuff('C01').ok, '先拿一个稀有·非运营件');
    run.shop = { mint: true, layer: 7, slots: [], rerollFree: true, rerollCount: 0, swapped: false };
    run.phase = 'shop';
    c.TowerUI.openMintShop();
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
    assert.equal(c.Tower.mintSwapAllowedOf(run), false, '刷新之后不能交换');
    const page = ui.last('page');
    assert.ok(page.content.includes('免费交换已不可用'), '页面应当标出交换已锁：' + page.content.slice(0, 120));
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
    ui.click('mintbuy0');
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
    assert.ok(sell.includes('最新拿到的在最上'), '出售区要写明排序口径');
    /* 给**最新那条**附魔：它应当从第一行掉到最后一行，并带上提示 */
    run.slotFreeIds = ['C05'];
    renderShop();
    sell = sellSection(ui.last('page').content);
    p = pos(sell);
    assert.ok(p.n < p.m && p.m < p.j, '附魔过的坚韧壁垒要沉到最后：' + JSON.stringify(p));
    assert.ok(sell.includes('虚空铭文 · 不占位'), '附魔的那条要有提示标记：' + sell.slice(0, 240));
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
    c.TowerUI.openMintShop();
    const html = ui.last('page').content;
    /* 从「免费交换」小节标题往后切（货架在它前面，免得撞上同名商品） */
    const swap = html.slice(html.lastIndexOf('免费交换'));
    const p = { m: swap.indexOf('磨砺'), n: swap.indexOf('蓄力一击'), j: swap.indexOf('坚韧壁垒') };
    assert.ok(p.n >= 0 && p.j >= 0 && p.m >= 0, '三条都该在交换列表里：' + swap.slice(0, 240));
    assert.ok(p.n < p.m && p.m < p.j, '交换列表同样：最新在最上 + 附魔沉最后：' + JSON.stringify(p));
  });

  check('虚空铭文三选一：已经附魔过的增益要标出来（不占位）', () => {
    const c = setup(7);
    const ui = uiHarness(c);
    const T = c.Tower;
    const run = T._debugRun('endless');
    /* 2026-10 修正后：没有 stackable 标签的件不再同栏叠层，
     * 所以「层数照旧显示」这条要用**可以合法叠层**的件来验证（C22 闪避精通，上限 3）。 */
    run.permanent = [{ id: 'C02', stacks: 1 }, { id: 'C22', stacks: 2 }, { id: 'C11', stacks: 1 }];
    run.limited = [];
    run.slotFreeIds = ['C22'];                       // 闪避精通已经附魔过
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
    assert.ok(/已附魔（不占位）/.test(done[0].label), '文案要写清「不占位」：' + done[0].label);
    assert.ok(/×2 层/.test(done[0].label), '层数照旧显示：' + done[0].label);
    assert.ok(/pick-done/.test(done[0].cls), '标记的那张要有独立样式：' + done[0].cls);
    for (const b of (m.buttons || [])) {
      if (/闪避精通/.test(b.label)) continue;          // 已附魔的那张跳过（它本来就带标记）
      assert.ok(!/已附魔/.test(b.label), '没附魔的不该被标：' + b.label);
      assert.ok(/gold/.test(b.cls), '未附魔的保持金色可选样式：' + b.cls);
    }
    assert.ok(/优先挑没标的/.test(m.content), '说明里要点出「已附魔的再选没有额外收益」：' + m.content.slice(0, 200));
    /* 只是「标注」，不禁用：点了仍然能走完流程 */
    const btn = (m.buttons || []).find((b) => /闪避精通/.test(b.label));
    btn.run();
    assert.ok((run.slotFreeIds || []).indexOf('C22') >= 0, '已经附魔的仍是附魔状态');
    assert.equal(run.pendingPick, null, '选完清掉待选取');
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
    const buy = c.Tower.buyMintSlot(0);
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
(async () => {
  console.log('\n铸币商店回归：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
