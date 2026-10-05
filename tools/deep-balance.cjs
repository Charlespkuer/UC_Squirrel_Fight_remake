#!/usr/bin/env node
/* ============================================================
 * tools/deep-balance.cjs — 无尽塔「深层难度 / 玩家成长」实测探针
 *
 * 用途：回答「极端情况（限次增益掏空）之后，玩家还追得上敌人吗」这个问题。
 *   · 需求曲线：每一层，玩家的**全属性倍率**要到多少才算五五开（走真实 Sim.simulate）；
 *   · 供给曲线：极端情况下玩家每层能拿到的等效成长（无限成长件的出现率 + 试炼币收入）；
 *   · 结论表：供给 ÷ 需求 的比值，<1 且持续下降就说明结构上追不上。
 *
 * 用法：node tools/deep-balance.cjs [--battles 40] [--max-layer 80]
 *      node tools/deep-balance.cjs --quiet     只打印结论表
 *
 * 说明：只数「本层第一场」。它是本层最弱的敌人（第 4/5 场是 boss/精英），
 *      所以「第一场打不过」= 这一层已经走不动了，作为难度指标偏保守。
 * ============================================================ */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

const ARGS = process.argv.slice(2);
const num = (name, dflt) => {
  const i = ARGS.indexOf('--' + name);
  return i >= 0 && ARGS[i + 1] ? Number(ARGS[i + 1]) : dflt;
};
const BATTLES = Math.max(5, Math.floor(num('battles', 40)));
const MAX_LAYER = Math.max(35, Math.floor(num('max-layer', 80)));
const QUIET = ARGS.includes('--quiet');

/* ---- 载入真实模块（与其它 tools/*.cjs 一样的隔离上下文） ---- */
function boot() {
  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
  const c = {
    Date: CD, location: { search: '?qa=1' },
    console: QUIET ? { log() {}, warn() {}, error() {} } : console,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  }
  return c;
}
const c = boot();
const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;

function openRun() {
  S.newGame('deep' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  return T._debugRun('endless');
}
const PLAYER = { power: 200, agility: 120, speed: 120, maxHp: 5000 };
function playerAt(X) {
  return {
    name: 'p', level: 70,
    power: Math.round(PLAYER.power * X), agility: Math.round(PLAYER.agility * X), speed: Math.round(PLAYER.speed * X),
    maxHp: Math.round(PLAYER.maxHp * X), hp: Math.round(PLAYER.maxHp * X),
    baseStats: { power: PLAYER.power, agility: PLAYER.agility, speed: PLAYER.speed },
    weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0,
  };
}
/** 层 layer 的第一场，玩家全属性 ×X 时的胜率。 */
function winRate(layer, X, n) {
  openRun();
  T._debugSetEndlessLayer(layer);
  const nx = T.nextBattle('endless');
  if (!nx || nx.ok === false) return null;
  const foe = nx.foe;
  let win = 0;
  for (let i = 0; i < n; i++) {
    const r = Sim.simulate(playerAt(X), foe, { maxActions: 120 });
    if (r.winner === 0) win++;
  }
  return { wr: win / n, foe };
}
/** 需要的全属性倍率（胜率首次 ≥50%）。 */
function requiredX(layer) {
  let prev = 1, last = null;
  for (const X of [1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 20, 25, 30, 40, 50, 65, 80, 100, 130, 160, 200, 260, 330, 400, 600, 800, 1200, 1600, 2500, 4000, 10000]) {
    const r = winRate(layer, X, BATTLES);
    if (r && r.wr >= 0.5) return { X, foe: r.foe, wr: r.wr };
    prev = X; last = r;
  }
  return { X: null, foe: last && last.foe, wr: last ? last.wr : 0 };
}

/* ---- 供给：极端情况下每层能拿到的等效成长 ---- */
function supply() {
  const unlimited = TD.shopPool.filter((b) => b.unlimitedStacks === true);
  const byRarity = [0, 0, 0, 0];
  for (const b of TD.shopPool) byRarity[b.rarity]++;
  const commonUnlimited = unlimited.filter((b) => b.rarity === 0).length;
  const slots = TD.SHOP.slots;
  /* 档位占比要用**权重**（66.5/21.2/10.1/2.2），不是件数比；
   * 档内挑谁按 shopWeight（这批成长件都是 1）→ 近似均分。 */
  const w = TD.rawTierWeights(1, {});
  const commonShare = w[0] / w.reduce((a, b) => a + b, 0);
  const perPage = slots * commonShare * (commonUnlimited / byRarity[0]);
  const coinsPerLayer = TD.COINS.battle * 4 + TD.COINS.layer;
  const buysPerLayer = coinsPerLayer / TD.SHOP.price[0];
  /* C49：每 120 格一次保底、2/3 给 C49；每层 5 格商店 + 16 格战斗选项 */
  const rollsPerLayer = slots + 16;
  const c49PerLayer = (rollsPerLayer / (TD.LEGEND_PITY.slots)) * (2 / 3);
  const c49Step = (Number(TD.BUFF_BY_ID.C49.mods.fragileAddAlive) + Number(TD.BUFF_BY_ID.C49.mods.fragileAddBurned)) / 2;
  return { unlimited: unlimited.map((b) => b.id + ' ' + b.name), byRarity, commonUnlimited, perPage, coinsPerLayer, buysPerLayer, rollsPerLayer, c49PerLayer, c49Step };
}
/**
 * 给定「累计状态」下的每层等效全属性相对成长。
 *   · 加法通道：每层新增 Δp 件成长件，每件给某一条通道 +0.2；
 *     该通道的相对成长 = 0.2·Δp/channel ÷ (1 + 该通道累计)，
 *     四通道同时看 → 取平均：0.2·Δp ÷ (1 + Σ)（Σ = 四通道累计之和）。
 *   · 终乘通道（C49）：累计 n 件 → 终乘 = 1 + 0.38n（0.38 = 存活 0.25 与损毁 0.5 的平均），
 *     每层 +Δn 件 → 相对成长 = 0.38·Δn ÷ (1 + 0.38n)。
 * 两者都是 ∝1/n 衰减，而需求是恒定复利 —— 这就是结构性缺口的来源。
 */
function supplyRate(sumSigma, c49n, perLayer, c49PerLayer, c49Step) {
  const additive = (0.2 * perLayer) / (1 + sumSigma);
  const mult = (c49Step * c49PerLayer) / (1 + c49Step * c49n);
  return { additive, mult, total: additive + mult };
}

const layers = [];
for (let n = 30; n <= MAX_LAYER; n += (n < 50 ? 5 : 10)) layers.push(n);
const req = layers.map((n) => ({ layer: n, ...requiredX(n), km: TD.endlessDepthMul(n) }));
const sup = supply();

if (!QUIET) {
  console.log('=== 需求曲线（第一场，胜率 ≥50%，每格 ' + BATTLES + ' 次）===');
  console.log('层 | 深度乘 | 需要全属性倍率 | 相邻环比/层 | 敌人血/力/敏/速');
  let prev = null;
  for (const r of req) {
    const per = prev ? Math.pow(r.X / prev.X, 1 / (r.layer - prev.layer)) : null;
    console.log([r.layer, r.km.toFixed(2), r.X === null ? '>' + 10000 : '×' + r.X,
      per ? '×' + per.toFixed(4) : '—',
      r.foe ? (r.foe.hp + '/' + r.foe.power + '/' + r.foe.agility + '/' + r.foe.speed) : '—'].join(' | '));
    if (r.X) prev = r;
  }
  console.log('');
  console.log('=== 供给（极端情况：限次增益掏空，只剩无限成长件）===');
  console.log('  可无限获取的直接成长件：' + sup.unlimited.join('、'));
  console.log('  商店池稀有度件数 普通/稀有/史诗/传奇 = ' + sup.byRarity.join('/') + '，普通档里无限成长件 ' + sup.commonUnlimited + ' 件');
  console.log('  每页期望「无限成长件」≈ ' + sup.perPage.toFixed(2) + ' 件；每层试炼币 ' + sup.coinsPerLayer + ' → 最多买 ' + sup.buysPerLayer.toFixed(2) + ' 件普通');
  console.log('  C49 保底：每层 ' + sup.rollsPerLayer + ' 格 ÷ ' + TD.LEGEND_PITY.slots + ' × 2/3 ≈ ' + sup.c49PerLayer.toFixed(3) + ' 件/层（每件 +' + sup.c49Step.toFixed(2) + ' 终乘）');
  console.log('');
}
console.log('=== 结论 ===');
const head = req.filter((r) => r.X);
const steep = head.length > 1 ? Math.pow(head[head.length - 1].X / head[0].X, 1 / (head[head.length - 1].layer - head[0].layer)) : NaN;
console.log('  需求：第 ' + head[0].layer + ' 层 ×' + head[0].X + ' → 第 ' + head[head.length - 1].layer + ' 层 ×' + head[head.length - 1].X +
  '（平均 ×' + steep.toFixed(4) + '/层，即每层 +' + ((steep - 1) * 100).toFixed(2) + '%）');
console.log('  供给 vs 需求（需求恒定 ×' + steep.toFixed(4) + '/层 = +' + ((steep - 1) * 100).toFixed(2) + '%）：');
console.log('    已farm层数 | 累计成长件 Σ | C49 累计 | 加法通道 | 终乘通道 | 合计 | 供给÷需求');
for (const farmed of [0, 10, 20, 30, 40, 60]) {
  const pieces = sup.perPage * farmed, c49n = sup.c49PerLayer * farmed;
  /* Σ：C26-C29 各 0.2 / 0.2 / 0.2 / 0.1，按件平均 ≈ 0.175，四通道合计即 0.175×件数 */
  const s = supplyRate(0.175 * pieces, c49n, sup.perPage, sup.c49PerLayer, sup.c49Step);
  console.log('    ' + String(farmed).padStart(4) + ' 层    | ' + pieces.toFixed(1).padStart(6) + ' 件（Σ+' + (0.175 * pieces).toFixed(2) + '） | ' +
    String(c49n.toFixed(1)).padStart(4) + ' | +' + (s.additive * 100).toFixed(2).padStart(5) + '% | +' + (s.mult * 100).toFixed(2).padStart(5) + '% | +' +
    (s.total * 100).toFixed(2).padStart(5) + '% | ' + (s.total / (steep - 1)).toFixed(2));
}
console.log('    ↑ 供给两条通道都 ∝1/累计量 衰减，需求恒定复利 → 越打缺口越大（初期就已经 <1）');
console.log('');
console.log('  换算：第 ' + head[head.length - 1].layer + ' 层要 ×' + head[head.length - 1].X + ' 的全属性 ——');
console.log('    · 用 C26「+20% 加法」需要 ' + Math.round((head[head.length - 1].X - 1) / 0.2) + ' 件（按当前出现率 ≈ ' +
  (sup.perPage / 4).toFixed(2) + ' 件/层的 C26 计，需要 ≈ ' + Math.round((head[head.length - 1].X - 1) / 0.2 / (sup.perPage / 4)) + ' 层）');
console.log('    · 若改成「每次 ×1.15 乘法」只需要 ' + Math.ceil(Math.log(head[head.length - 1].X) / Math.log(1.15)) + ' 件');
