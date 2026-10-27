#!/usr/bin/env node
/* ============================================================
 * tools/test-blood-blade.cjs — 渴血之剑机制回归
 *
 * 用户口径（2026-10）：
 *   1. 第一次巡视胜利必定获得，替代该场传奇三选一；勇者 / 默认模式都成立。
 *   2. 限次装备：出战时每场扣 1 次；用尽进化为下一阶段；最终王者之剑永续。
 *   3. 每场战斗后必须献祭：史诗+限次或永久；永久有铭文时优先消耗铭文
 *      （水晶 > 虚空），可叠加只消耗 1 件；献祭使剑成长 1 层。
 *   4. 闲置 20 场强制苏醒且不能关闭，用过重新计数。
 *   5. 51 层起每 10 层活性事件：抑制 3 次 → 涸血之剑；增强消耗使用次数加速进化。
 *   6. 不可卖出 / 交换；最终形态对镜之魔王有额外削减。
 *
 * 用法：node tools/test-blood-blade.cjs
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
const LOAD = ['js/gamedict.js', 'js/engine.js', 'js/gamedata.js', 'js/battle-drops.js', 'js/tower-data.js',
  'js/state.js', 'js/sim.js', 'js/tower-hero.js', 'js/tower.js', 'js/tower-plot.js'];

function setup(ruleset) {
  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 9, 26, 12).getTime(); } }
  const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k) } };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const f of LOAD) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  c.State.newGame('血刃回归');
  const S = c.State.state();
  S.level = 70; S.props[23] = 30;
  for (let i = 1; i <= 36; i++) S.stages[i] = { npcIndex: 3, passed: true };
  c.__rand = (v) => vm.runInContext('(function(){var v=' + Number(v) +
    ';Math.random=function(){return v;};return true;})()', c);
  c.__rand(0.99);
  const options = ruleset === 'hero'
    ? { ruleset: 'hero', hero: { picks: [{ kind: 'weapon', id: 1 }, { kind: 'weapon', id: 2 }, { kind: 'skill', id: 7 }] } }
    : undefined;
  const started = c.Tower.startEndlessRun(options);
  assert.ok(started.ok, '应当能开局：' + (started.msg || ''));
  c.Tower.setStoryEnabled(false);
  c.Tower._debugSetNoFlowBuffs(true);
  c.Tower._debugSetEndlessLayer(41);
  return c;
}
function runOf(c) { return c.Tower._debugRun('endless'); }
function clearBattleState(run) {
  run.choices = null; run.choiceQueue = []; run.phase = null; run.shop = null;
  run.finished = null; run.env = []; run.noEnvRoll = true; delete run.attempt;
  delete run.bladeEventPending; delete run.bladeSacrificePending;
}
/** 打赢一场普通三侠战斗；返回 reportBattle 的回包。 */
function winOnce(c, entry) {
  const run = runOf(c);
  clearBattleState(run);
  run.plan = [entry || { kind: 'hero', anim: 'tl' }];
  run.idx = 0;
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
  return c.Tower.reportBattle('endless', nx.token, true, 1200, 1500, null);
}
function bladeRow(c) {
  return (runOf(c).limited || []).find((row) => row && c.TowerData.isBladeId(row.id)) || null;
}
function grantBlade(c) {
  const info = c.Tower.bladeInfoOf();
  if (info) return info;
  /* 没有公开的 grantBlade：用调试发牌走真实 addBuff 路径（第一次巡视也走同一行结构）。 */
  const g = c.Tower.debugGrantBuff('HB01');
  assert.equal(g.ok, true, g.msg || '应当能获得渴血之剑');
  return c.Tower.bladeInfoOf();
}
function clearPending(c) {
  const run = runOf(c);
  while (run.bladeSacrificePending) {
    const cand = c.Tower.bladeSacrificeCandidates().list[0];
    if (!cand) { c.Tower.sacrificeBlade(null); break; }
    assert.equal(c.Tower.sacrificeBlade(cand.ref).ok, true, '清理献祭窗');
  }
  delete run.bladeEventPending;
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ' | ' + (e && e.message)); }
}

test('第一次巡视胜利必定获得，替代该场传奇三选一（默认模式）', () => {
  const c = setup();
  const run = runOf(c);
  clearBattleState(run);
  run.layer = 41;
  run.plan = [{ kind: 'patrol', id: 'patrol', _layer: 41, _salt: run.salt, x00: false }];
  run.idx = 0;
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx.ok, nx.msg);
  const rw = c.Tower.reportBattle('endless', nx.token, true, 1200, 1500, null);
  assert.equal(rw.bladeGranted, true, '第一场巡视胜利要发剑');
  assert.equal(rw.patrolReward && rw.patrolReward.legendaries, 0, '这一场不再给传奇三选一');
  const row = bladeRow(c);
  assert.ok(row && row.id === 'HB01', '剑在限次区且为初始阶段');
  assert.equal(row.stacks, 1, '初始成长 ×1');
  assert.equal(row.uses, 8, '初始限次 8 场');
  assert.ok(!run.bladeSacrificePending, '获得剑的这一场不额外要求献祭');
});

test('勇者模式同样必定获得（不依赖旧的 forge 事件）', () => {
  const c = setup('hero');
  const run = runOf(c);
  clearBattleState(run);
  run.layer = 41;
  run.plan = [{ kind: 'patrol', id: 'patrol', _layer: 41, _salt: run.salt, x00: false }];
  run.idx = 0;
  for (let i = 0; i < 6; i++) {
    const ev = c.Tower.heroEventInfo();
    if (!ev) break;
    assert.equal(c.Tower.resolveHeroEvent(ev.choices[0].id).ok, true, '清掉层 41 的勇者际遇');
  }
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx.ok, nx.msg);
  const rw = c.Tower.reportBattle('endless', nx.token, true, 1200, 1500, null);
  assert.equal(rw.bladeGranted, true);
  assert.ok(bladeRow(c), '勇者模式也拿到剑');
  assert.equal(c.Tower.heroEventInfo(), null, '不再有选剑事件');
});

test('第二次巡视胜利恢复传奇三选一；战后扣次数并要求献祭', () => {
  const c = setup();
  grantBlade(c);
  c.Tower.debugGrantBuff('C57');                       // 史诗限次，用作第一次祭品
  const run = runOf(c);
  clearBattleState(run);
  run.layer = 48;
  run.plan = [{ kind: 'patrol', id: 'patrol', _layer: 48, _salt: run.salt, x00: false }];
  run.idx = 0;
  const nx = c.Tower.nextBattle('endless');
  const rw = c.Tower.reportBattle('endless', nx.token, true, 1200, 1500, null);
  assert.equal(rw.bladeGranted, undefined, '第二次不再发剑');
  assert.ok(rw.patrolReward && rw.patrolReward.legendaries > 0, '恢复传奇三选一');
  const info = c.Tower.bladeInfoOf();
  assert.equal(info.uses, 7, '赢一场扣 1 次');
  assert.equal(run.bladeSacrificePending, true, '战后要求献祭');
  const cands = c.Tower.bladeSacrificeCandidates().list;
  assert.ok(cands.some((x) => x.id === 'C57'), '史诗限次进候选');
  const beforeStacks = bladeRow(c).stacks;
  const r = c.Tower.sacrificeBlade(cands.find((x) => x.id === 'C57').ref);
  assert.equal(r.ok, true, r.msg);
  assert.equal(bladeRow(c).stacks, beforeStacks + 1, '献祭使剑成长 1 层');
  assert.equal(run.bladeSacrificePending, undefined, '献祭后清标记');
});

test('永久祭品优先消耗水晶铭文，其次虚空铭文；增益本身保留', () => {
  const c = setup();
  grantBlade(c);
  c.Tower.debugGrantBuff('C29');                       // 永久生命
  let row = runOf(c).permanent.find((x) => x.id === 'C29');
  row.enchants = ['C37', 'C60']; row.slotFree = true; row.enchMul = 1.5;
  const run = runOf(c);
  clearBattleState(run);
  winOnce(c);
  assert.equal(run.bladeSacrificePending, true);
  let cand = c.Tower.bladeSacrificeCandidates().list.find((x) => x.id === 'C29');
  assert.equal(cand.inscription, 'C60', '水晶铭文优先');
  assert.equal(c.Tower.sacrificeBlade(cand.ref).ok, true);
  row = runOf(c).permanent.find((x) => x.id === 'C29');
  assert.ok(row, '增益没有消失');
  assert.equal(row.slotFree, true, '虚空铭文仍在');
  assert.equal(Number(row.enchMul) || 1, 1, '水晶铭文被吃掉');
  assert.equal(row.enchants.indexOf('C60'), -1);
  /* 下一场再献祭：这次轮到虚空铭文。 */
  winOnce(c);
  cand = c.Tower.bladeSacrificeCandidates().list.find((x) => x.id === 'C29');
  assert.equal(cand.inscription, 'C37', '第二次轮到虚空铭文');
  assert.equal(c.Tower.sacrificeBlade(cand.ref).ok, true);
  row = runOf(c).permanent.find((x) => x.id === 'C29');
  assert.ok(row, '虚空铭文也优先于整件增益');
  assert.equal(!!row.slotFree, false);
  /* 第三次没有铭文了：可叠加的只消耗 1 层。 */
  row.stacks = 2;
  winOnce(c);
  cand = c.Tower.bladeSacrificeCandidates().list.find((x) => x.id === 'C29');
  assert.equal(cand.inscription, null);
  assert.equal(c.Tower.sacrificeBlade(cand.ref).ok, true);
  row = runOf(c).permanent.find((x) => x.id === 'C29');
  assert.ok(row && row.stacks === 1, '可叠加只掉 1 层');
});

test('限次用尽进化为下一阶段；最终王者之剑永续、不再献祭', () => {
  const c = setup();
  grantBlade(c);
  let run = runOf(c);
  const row = bladeRow(c);
  row.uses = 1;
  winOnce(c);
  let info = c.Tower.bladeInfoOf();
  assert.equal(info.id, 'HB02', '用尽后进化到第二阶段');
  assert.equal(info.uses, 8, '新阶段重置次数');
  assert.equal(run.bladeSacrificePending, true, '进化后的这一场仍要献祭');
  clearPending(c);
  /* 直接推到第三阶段再打一场 → 王者之剑。 */
  run = runOf(c);
  const row3 = bladeRow(c);
  row3.id = 'HB03'; row3.uses = 1; row3.on = true;
  winOnce(c);
  info = c.Tower.bladeInfoOf();
  assert.equal(info.id, 'HB04', '最终形态是王者之剑');
  assert.equal(info.final, true);
  assert.equal(info.unlimited, true);
  assert.equal(info.uses, -1);
  assert.equal(run.bladeSacrificePending, undefined, '最终形态不再需要献祭');
  /* 最终形态继续打：不扣次数、不弹献祭。 */
  winOnce(c);
  info = c.Tower.bladeInfoOf();
  assert.equal(info.uses, -1);
  assert.equal(run.bladeSacrificePending, undefined);
});

test('闲置 20 场强制苏醒且无法关闭；用过重新计数', () => {
  const c = setup();
  grantBlade(c);
  const run = runOf(c);
  const row = bladeRow(c);
  row.on = false;
  for (let i = 0; i < 20; i++) winOnce(c);
  let info = c.Tower.bladeInfoOf();
  assert.equal(info.on, true, '20 场后强制亮起');
  assert.equal(info.forced, true, '无法关闭');
  assert.equal(c.Tower.toggleLimited(String(bladeRow(c).uid), false).ok, false, '强制苏醒期间不能关');
  /* 下一场真正用一次。 */
  winOnce(c);
  info = c.Tower.bladeInfoOf();
  assert.equal(info.forced, false, '用过之后解除强制');
  assert.equal(run.bladeSacrificePending, true, '强制使用也要献祭');
  assert.equal(info.idleBattles, 0);
});

test('51 层起每 10 层活性事件；连续抑制 3 次 → 涸血之剑', () => {
  const c = setup();
  grantBlade(c);
  const run = runOf(c);
  for (const layer of [51, 61, 71]) {
    run.layer = layer; run.plan = [{ kind: 'hero', anim: 'tl' }]; run.idx = 0;
    clearBattleState(run);
    c.Tower._debugSetEndlessLayer(layer);
    assert.ok(run.bladeEventPending, '第 ' + layer + ' 层应当有活性事件');
    const r = c.Tower.resolveBladeEvent('suppress');
    assert.equal(r.ok, true, r.msg);
  }
  const info = c.Tower.bladeInfoOf();
  assert.equal(info.id, 'HB05', '连续抑制 3 次后彻底失活');
  assert.equal(info.dead, true);
  assert.equal(info.unlimited, true, '涸血之剑永续');
  assert.equal(c.Tower.resolveBladeEvent('suppress').ok, false, '失活后不再有活性事件');
});

test('增强活性消耗 3 次使用次数并加速进化；同时清空抑制连击', () => {
  const c = setup();
  grantBlade(c);
  const run = runOf(c);
  run.layer = 51; run.plan = [{ kind: 'hero', anim: 'tl' }]; run.idx = 0;
  clearBattleState(run);
  c.Tower._debugSetEndlessLayer(51);
  assert.equal(c.Tower.resolveBladeEvent('suppress').ok, true);
  run.layer = 61; run.plan = [{ kind: 'hero', anim: 'tl' }]; run.idx = 0;
  c.Tower._debugSetEndlessLayer(61);
  assert.equal(c.Tower.resolveBladeEvent('enhance').ok, true);
  assert.equal(c.Tower.bladeInfoOf().uses, 5, '8 − 3 = 5');
  assert.equal(c.Tower.bladeInfoOf().suppressStreak, 0, '增强清空抑制连击');
  /* 只剩 1 次时增强 → 直接进化。 */
  const row = bladeRow(c); row.uses = 1;
  run.layer = 71; run.plan = [{ kind: 'hero', anim: 'tl' }]; run.idx = 0;
  c.Tower._debugSetEndlessLayer(71);
  assert.equal(c.Tower.resolveBladeEvent('enhance').ok, true);
  assert.equal(c.Tower.bladeInfoOf().id, 'HB02');
});

test('剑不可卖出 / 不可交换 / 不进巡逻收缴，且不能当延续铭文目标', () => {
  const c = setup();
  grantBlade(c);
  const run = runOf(c);
  const row = bladeRow(c);
  assert.ok(!c.Tower.sellListOf('endless').some((x) => c.TowerData.isBladeId(x.id)), '出售列表不含剑');
  run.shop = { layer: run.layer, rest: true, slots: [] };
  assert.equal(c.Tower.sellBuff(String(row.uid)).ok, false, '直接卖也被拒');
  run.shop = { mint: true, layer: run.layer, slots: [], swapOpen: true, rerollFree: true, rerollCount: 0 };
  assert.equal(c.Tower.swapMintBuff(String(row.uid)).ok, false, '不能交换');
  run.shop = null;
  assert.ok(!c.Tower.patrolTollCandidates().list.some((x) => c.TowerData.isBladeId(x.id)),
    '巡逻收缴不能拿走剑');
  /* 延续铭文候选：构造一个待选并检查它不在列表里。 */
  c.Tower.debugGrantBuff('C62');
  run.pendingPick = { kind: 'limitedBuff', buffId: 'C62', addUses: 5 };
  const cands = c.Tower.pickCandidates('limitedBuff');
  assert.ok(!cands.some((x) => c.TowerData.isBladeId(x.id)), '延续铭文不能延长剑的次数');
});

test('存档往返保留剑的阶段 / 成长 / 次数 / 强制状态 / 待献祭标记', () => {
  const c = setup();
  grantBlade(c);
  const run = runOf(c);
  const row = bladeRow(c);
  row.id = 'HB03'; row.stacks = 4; row.uses = 2; row.on = true; row.forced = true;
  run.bladeSacrificePending = true;
  c.State.save();
  c.State.load();
  const info = c.Tower.bladeInfoOf();
  assert.equal(info.id, 'HB03');
  assert.equal(info.stacks, 4);
  assert.equal(info.uses, 2);
  assert.equal(info.forced, true);
  assert.equal(runOf(c).bladeSacrificePending, true, '待献祭标记跟存档走');
  assert.equal(c.Tower.nextBattle('endless').ok, false, '标记存在时不能开下一场');
});

(function main() {
  console.log(fail ? ('\n' + fail + ' 项失败') : ('\n全部通过（' + pass + ' 项）'));
  process.exit(fail ? 1 : 0);
})();
