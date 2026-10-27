#!/usr/bin/env node
/* ============================================================
 * tools/test-tower-buff-rules.cjs — 无尽塔增益数值 / 商店售卖规则回归
 *
 * 覆盖本轮三条可感知规则：
 *   ① 增幅水晶（C15）同名多张**加算**（1 + 0.3×张数），且与水晶铭文（C60）加算；
 *   ② 门庭若市（C59）的描述是「进入商店」，不是「进入试炼商店」；
 *   ③ 战利品账本（C25）同店卖旧买新时，新账本按 50 起价，不继承旧账本累计，
 *      卖掉新账本也不会清掉另一本的累计。
 *
 * 用法：node tools/test-tower-buff-rules.cjs
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
const LOAD = ['js/gamedict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js', 'js/tower-plot.js'];

function setup() {
  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 9, 27, 12).getTime(); } }
  const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  c.window = c; c.self = c;
  vm.createContext(c);
  /* 固定随机流：开局抽层 / 抽敌人不影响本文件的断言，但固定后 CI 完全可复现。 */
  c.__seed = (n) => vm.runInContext(
    '(function(){var s=' + Number(n) + ';Math.random=function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};return true;})()', c);
  c.__seed(20261027);
  for (const f of LOAD) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'), c, { filename: f });
  c.State.newGame('塔增益规则回归');
  const S = c.State.state();
  S.level = 70;
  S.props[23] = 30;
  for (let i = 1; i <= 36; i++) S.stages[i] = { npcIndex: 3, passed: true };
  c.Tower.setStoryEnabled(false);
  c.Tower._debugSetNoFlowBuffs(true);
  c.Tower._debugSetNoMintShop(true);
  c.Tower._debugSetLayer(9);
  assert.ok(c.Tower.startEndlessRun().ok, '应该能开一局无尽塔');
  c.Tower._debugSetEndlessLayer(20);
  return c;
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '   ' + (e && e.message)); }
}
function hr(title) { console.log('\n──── ' + title + ' ────'); }
function effectMap(T) { return Object.fromEntries(T.debugBuffReport('endless').effects); }

hr('1. 增幅水晶：同名加算 + 与水晶铭文加算');
test('两张增幅水晶是 ×1.6，附魔水晶铭文后本条是 ×1.8（不是相乘）', () => {
  const c = setup();
  const T = c.Tower;
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.pickBuffIds = []; run.pickGot = {};
  assert.ok(T.addBuff(run, 'C26').ok, '先给一条基础 +20% 攻击');
  assert.ok(T.addBuff(run, 'C15').ok, '第一张增幅水晶');
  assert.equal(T.globalMulOf(run), 1.3, '一张增幅水晶：×1.3');
  assert.match(effectMap(T)['攻击'], /\+26%/, '20% × 1.3 = 26%');
  assert.ok(T.addBuff(run, 'C15').ok, '第二张增幅水晶');
  assert.equal(T.globalMulOf(run), 1.6, '两张同名加算：1 + 0.3×2 = 1.6');
  assert.match(effectMap(T)['攻击'], /\+32%/, '20% × 1.6 = 32%（不是 20% × 1.69）');
  /* 水晶铭文附在蛮力上：本条倍率 1.5；与 1.6 的全局倍率加算 → 2.1 */
  assert.ok(T.debugGrantBuff('C60').ok, '拿到水晶铭文');
  const target = run.permanent.find((b) => b.id === 'C26');
  const done = T.applyPickBuff('permBuff', target.uid);
  assert.ok(done.ok, '附魔应当成功：' + JSON.stringify(done));
  assert.equal(done.enchMul, 1.5, '本条水晶铭文 ×1.5');
  assert.match(effectMap(T)['攻击'], /\+42%/, '20% × (1 + 0.6 + 0.5) = 42%（不是 20% × 1.6 × 1.5 = 48%）');
});

hr('2. 门庭若市：描述覆盖铸币商店');
test('门庭若市的描述写「进入商店」，不再写「试炼商店」', () => {
  const c = setup();
  const TD = c.TowerData;
  const desc = TD.descOf(TD.BUFF_BY_ID.C59, 'endless');
  assert.match(desc, /每进入一次商店/, '描述应当是「进入商店」：' + desc);
  assert.ok(!/试炼商店/.test(desc), '不该再写「试炼商店」：' + desc);
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(ui, /每进入一次商店 \+/, '悬停合计行也应当写「商店」');
  assert.ok(!/每进入一次试炼商店 \+/.test(ui), '悬停合计行不该再写「试炼商店」');
});

hr('3. 战利品账本：同店卖旧买新');
test('新账本从 50 起价，卖掉它不会清掉另一本的累计', () => {
  const c = setup();
  const T = c.Tower;
  const live = () => T._debugRun('endless');
  const run = live();
  run.permanent = []; run.limited = []; run.slotFreeIds = []; run.sellBonus = 0;
  run.shop = { slots: [] };
  assert.ok(run.growByRow, '当前对局应当已迁到逐栏账本');
  T.addBuff(run, 'C25');
  T.addBuff(run, 'C25');
  let rows = live().permanent.filter((b) => b.id === 'C25');
  assert.equal(rows.length, 2, '两本账本各占一栏');
  const uidA = rows[0].uid, uidB = rows[1].uid;
  rows[0].grow = { sellBonus: 100 };
  rows[1].grow = { sellBonus: 100 };
  live().sellBonus = 200;
  const price = (uid) => {
    const owned = T.ownedBuffs('endless').find((b) => Number(b.uid) === Number(uid));
    return owned ? owned.sellPrice : null;
  };

  assert.equal(price(uidA), 150, '第一本卖价 50 + 100');
  const soldA = T.sellBuff(uidA);
  assert.ok(soldA.ok, '第一本应当能卖');
  assert.equal(soldA.gain, 150, '第一本卖出 150');
  assert.equal(live().sellBonus, 100, '只剩第二本的 +100');

  assert.ok(T.addBuff(live(), 'C25').ok, '同店再买一本');
  rows = live().permanent.filter((b) => b.id === 'C25');
  const fresh = rows.find((b) => b.uid !== uidB);
  assert.ok(fresh, '应当出现新的一本');
  assert.equal(price(fresh.uid), 50, '新账本从 50 起价，不继承旧账本的 +100');
  assert.equal(price(uidB), 150, '另一本仍然按自己的 +100 计价');

  const soldFresh = T.sellBuff(fresh.uid);
  assert.ok(soldFresh.ok, '新账本应当能卖');
  assert.equal(soldFresh.gain, 50, '新账本卖出 50');
  assert.equal(live().sellBonus, 100, '卖掉新账本不能清掉另一本的 +100');
  assert.equal(price(uidB), 150, '另一本卖价不受影响');

  assert.ok(T.addBuff(live(), 'C25').ok, '再买一本仍然从 50 起价');
  const nextFresh = live().permanent.find((b) => b.id === 'C25' && b.uid !== uidB);
  assert.equal(price(nextFresh.uid), 50, '下一本新账本还是 50');
});

console.log('\n塔增益规则回归：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exitCode = 1;
