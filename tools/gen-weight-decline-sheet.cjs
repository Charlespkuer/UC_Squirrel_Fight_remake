#!/usr/bin/env node
/* ============================================================
 * tools/gen-weight-decline-sheet.cjs — 生成「权重下降增益」清单
 *
 * 输出 docs/权重下降增益清单.md：把塔池里**所有会随获得次数/状态而降权**的增益列出来，
 * 并给出每一条的**精确规律与数值**（用真实 buffWeightOf / buffDynamicPenaltyOf 复算，不手写公式）。
 *
 * 覆盖四类降权来源：
 *   ① 个体自惩罚：mods.repeatWeight（每份 ×r）、mods.weightDivBy（÷n 或 ÷(n+offset)）
 *   ② 静态权重：mods.shopWeight（不随份数变，但影响档内挑谁）
 *   ③ 档位级降权：传奇档 legendWeightFactor（0.88^已拥有传奇数 ×全可重复到手 0.35）
 *   ④ 保底池权重：mods.pityWeight（只影响「传奇保底」那一格的加权）
 *
 * 用法：node tools/gen-weight-decline-sheet.cjs > docs/权重下降增益清单.md
 * 说明：只统计**塔池**（towerPool / endlessPool / shopPool / mintPool）里的增益；
 *      主塔与无尽塔分开列，因为同一条增益在两座塔里的可用性不同。
 * ============================================================ */
'use strict';
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
const store = new Map();
class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
const c = {
  Date: CD, location: { search: '?qa=1' },
  console: { log() {}, warn() {}, error() {} },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
};
c.window = c; c.self = c;
vm.createContext(c);
for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
}
const TD = c.TowerData, T = c.Tower;

const out = [];
const W = (s) => out.push(s);
const pct = (v) => (v * 100).toFixed(4) + '%';
const num = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(4));

/* ---- 造一个「只属于这条增益」的 run 状态：n = 已获得份数 / 已附魔数 ---- */
function runFor(b, kind, n) {
  const base = { permanent: [], limited: [], permSlotIds: [], pickBuffIds: [], instantIds: [], slotFreeIds: [], fragileGot: {}, rarityBoost: 0, acqSeq: 0 };
  if (!n) return base;
  if (kind === 'enchanted') { base.slotFreeIds = new Array(n).fill('x'); return base; }
  if (kind === 'instant') { base.instantIds = [{ id: b.id, count: n }]; return base; }
  if (b.kind === 'limited') { base.limited = [{ id: b.id, stacks: n, uses: 1000, on: true }]; base.fragileGot = { [b.id]: n }; return base; }
  base.permanent = [{ id: b.id, stacks: n }];
  return base;
}
/** 按数据里的规则算出「第 n 份时」的权重系数（不依赖 buffWeightOf，便于展示每一步）。 */
function ruleOf(b) {
  const m = b.mods || {};
  const rw = Number(m.repeatWeight);
  if (rw > 0 && rw < 1) return { type: 'repeatWeight', rw: rw, div: 0, offset: 0 };
  const divBy = m.weightDivBy;
  if (divBy === 'owned' || divBy === 'enchanted') {
    return { type: 'weightDivBy', rw: 1, div: divBy, offset: Math.max(0, Number(m.weightDivOffset) || 0) };
  }
  return null;
}
/** 该条增益「第 n 份」时的权重（走真实实现）。 */
function weightAt(b, n) {
  const rule = ruleOf(b);
  const kind = rule && rule.div === 'enchanted' ? 'enchanted' : (b.kind === 'instant' ? 'instant' : 'row');
  return T.buffWeightOf(runFor(b, kind, n), b.id);
}
function penaltyAt(b, n) {
  const rule = ruleOf(b);
  const kind = rule && rule.div === 'enchanted' ? 'enchanted' : (b.kind === 'instant' ? 'instant' : 'row');
  return T.buffDynamicPenaltyOf ? T.buffDynamicPenaltyOf(runFor(b, kind, n), b) : weightAt(b, n);
}

const POOLS = [
  { key: 'endlessPool', name: '无尽' },
  { key: 'towerPool', name: '挑战' },
  { key: 'shopPool', name: '试炼商店' },
  { key: 'mintPool', name: '铸币商店' },
];
const rows = [];   // { b, pools:Set }
const seen = new Map();
for (const p of POOLS) {
  for (const b of TD[p.key] || []) {
    if (!seen.has(b.id)) { seen.set(b.id, { b, pools: new Set(), rarity: b.rarity }); rows.push(seen.get(b.id)); }
    seen.get(b.id).pools.add(p.name);
  }
}

W('# 权重下降增益清单（自动生成）');
W('');
W('> 由 `node tools/gen-weight-decline-sheet.cjs > docs/权重下降增益清单.md` 生成，数字全部用');
W('> `Tower.buffWeightOf` / `Tower.buffDynamicPenaltyOf` 对真实数据复算，改数据后请重新生成。');
W('> 相关：[传奇出率与保底.md](传奇出率与保底.md)（档位公式全链）、[战斗系统数值手册.md](战斗系统数值手册.md) §14。');
W('');
W('## 0. 一句话口径');
W('');
W('塔池里影响「会不会抽到某条增益」的一共四个旋钮（前两个是**个体级**，后两个是**档位级**）：');
W('');
W('| 旋钮 | 数据字段 | 规律 | 什么时候用 |');
W('| --- | --- | --- | --- |');
W('| 静态权重 | `mods.shopWeight` | 恒定倍率（不随份数变） | 想让某条整体更稀有时 |');
W('| 每份衰减 | `mods.repeatWeight` | 第 n 份 → `r^(n-1)`（n ≥ 2 才生效） | 「再出现概率 ×r」的旧口径 |');
W('| 除以份数 | `mods.weightDivBy` + `mods.weightDivOffset` | `1 / (n + offset)`，`n+offset ≤ 1` 时不降权 | 「越拿越难再出现」的现口径 |');
W('| 档位降权 | `legendWeightFactor` | 传奇档整体 ×`0.88^已拥有传奇条数` ×（全部可重复传奇到手 ? 0.35 : 1） | 传奇档整体缩水 |');
W('| 保底权重 | `mods.pityWeight` | 只影响传奇保底那一格的**档内**加权（0 = 不进保底池） | 保底给谁 |');
W('');
W('另外注意：`weightDivBy` 的降权**还会按比例缩小整个稀有度档的预算**（`dynamicTierWeights`），');
W('所以一条增益降权时，同档其它增益也会一起变稀有 —— 不是「把它的概率分给同档别人」。');
W('');

const staticOf = (b) => (TD.buffStaticWeightOf ? TD.buffStaticWeightOf(b) : Math.max(0, Number(b && b.shopWeight) || 1));
/* ---------- 1. 个体级降权总表 ---------- */
const individual = rows.filter((r) => r.b.mods && (Number(r.b.mods.repeatWeight) > 0 || r.b.mods.weightDivBy));
W('## 1. 个体级降权：完整清单');
W('');
W('共 **' + individual.length + '** 条。`n` = 本局**累计已获得份数**（含已损毁/已卖出的，见 `obtainedCountOf`）。');
W('');
W('| 增益 | 名称 | 稀有度 | 池子 | 规律 | 第1份 | 第2份 | 第3份 | 第4份 | 第5份 | 备注 |');
W('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const sorted = individual.slice().sort((a, b) => (a.rarity - b.rarity) || a.b.id.localeCompare(b.b.id));
for (const r of sorted) {
  const b = r.b, m = b.mods || {};
  const rule = ruleOf(b);
  const n = [1, 2, 3, 4, 5].map((k) => weightAt(b, k));
  const x = (v) => '×' + (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v.toFixed(4));
  const desc = rule.type === 'repeatWeight'
    ? '`×' + num(rule.rw) + '^(n-1)`'
    : '`1 / (n' + (rule.offset ? ' + ' + rule.offset : '') + ')`' + (rule.div === 'enchanted' ? '（n = 附魔数）' : '');
  const note = [];
  if (staticOf(b) !== 1) note.push('静态 ×' + num(staticOf(b)));
  if (m.pityWeight === 0) note.push('不进保底池');
  if (b.unlimitedStacks) note.push('可无限叠');
  if (b.maxStacks) note.push('上限 ' + b.maxStacks);
  if (b.kind === 'instant') note.push('即时类（另记 instantIds）');
  W('| `' + b.id + '` | ' + b.name + ' | ' + TD.RARITY_NAME[b.rarity] + ' | ' + [...r.pools].join(' / ') + ' | ' + desc +
    ' | ' + [n[0], n[1], n[2], n[3], n[4]].map(x).join(' | ') + ' | ' + note.join('；') + ' |');
}
W('');
/* 完整性自检：全表扫一遍，确保没有「挂了降权规则却不在任何池子里」的漏网之鱼。 */
{
  const all = TD.BUFFS.filter((b) => b.mods && (Number(b.mods.repeatWeight) > 0 || b.mods.weightDivBy));
  const shown = new Set(individual.map((r) => r.b.id));
  const missing = all.filter((b) => !shown.has(b.id));
  if (missing.length) {
    W('> ⚠️ 自检：以下增益挂了降权规则但不在塔池里（因此没列进上表）：' + missing.map((b) => b.id).join('、'));
    W('');
  }
}

/* ---------- 2. 静态权重 ---------- */
const staticRows = rows.filter((r) => staticOf(r.b) !== 1);
W('## 2. 静态权重（顶层字段 `shopWeight`，不随份数变）');
W('');
if (!staticRows.length) W('（当前没有偏离 1 的静态权重。）');
else {
  W('| 增益 | 名称 | 稀有度 | shopWeight | 含义 |');
  W('| --- | --- | --- | --- | --- |');
  for (const r of staticRows.slice().sort((a, b) => staticOf(a.b) - staticOf(b.b))) {
    W('| `' + r.b.id + '` | ' + r.b.name + ' | ' + TD.RARITY_NAME[r.b.rarity] + ' | ×' + num(staticOf(r.b)) +
      ' | 档内被挑中的概率是同级基准的 ' + (staticOf(r.b) * 100).toFixed(1) + '% |');
  }
}
W('');

/* ---------- 3. 档位级降权 ---------- */
W('## 3. 档位级降权：传奇档整体');
W('');
W('```');
W('legendWeightFactor(run) = 0.88 ^ (本局已拥有的传奇条数)  ×  (所有 repeatable 传奇都到手 ? 0.35 : 1)');
W('传奇档基准权重 = LEGEND_BASE_WEIGHT = ' + num(TD.LEGEND_BASE_WEIGHT) + '（表里的 RARITY_WEIGHTS[3] = ' + num(TD.RARITY_WEIGHTS[3]) + '）');
W('```');
W('');
W('| 已拥有传奇条数 | 0.88^n | 全部可重复传奇到手 | 最终系数 |');
W('| --- | --- | --- | --- |');
const legIdsAll = TD.BUFFS.filter((b) => b.rarity === 3).map((b) => b.id);
for (const n of [0, 1, 2, 3, 5, 9, 11]) {
  const ids = legIdsAll.slice(0, n);
  const run = { permanent: ids.map((id) => ({ id, stacks: 1 })), limited: [], permSlotIds: [], pickBuffIds: [], instantIds: [], slotFreeIds: [], fragileGot: {}, rarityBoost: 0, acqSeq: 0 };
  W('| ' + n + ' | ×' + Math.pow(0.88, n).toFixed(4) + ' | ' + (TD.allRepeatableLegendsOwned(run) ? '×0.35' : '—') + ' | **×' + TD.legendWeightFactor(run).toFixed(5) + '** |');
}
W('');
W('> 「可重复传奇」= 带 `repeatable` 标签的传奇：' + TD.BUFFS.filter((b) => b.rarity === 3 && TD.hasTag(b, 'repeatable')).map((b) => b.id).join('、'));
W('> 注意：**只统计去重后的条数**（同一件占多个背包栏位只算 1 条）。');
W('');

/* ---------- 4. 保底池权重 ---------- */
const pityRows = rows.filter((r) => r.b.rarity === 3);
W('## 4. 保底池权重（`mods.pityWeight`，只作用于传奇保底那一格）');
W('');
W('| 增益 | 名称 | pityWeight | 在保底池里的占比（仅当它可用时） |');
W('| --- | --- | --- | --- |');
const pityWeights = pityRows.map((r) => {
  const v = (r.b.mods || {}).pityWeight;
  return { r, w: v === undefined ? 1 : Number(v) };
});
const wsum = pityWeights.reduce((a, x) => a + x.w, 0) || 1;
for (const x of pityWeights.slice().sort((a, b) => b.w - a.w)) {
  W('| `' + x.r.b.id + '` | ' + x.r.b.name + ' | ' + (x.w === 0 ? '**0**（不进保底池）' : num(x.w)) + ' | ' +
    (x.w === 0 ? '—' : (x.w / wsum * 100).toFixed(2) + '%') + ' |');
}
W('');
W('> 占比一列只是「所有传奇都可用」时的静态参考；实际占比取决于**当层可用的传奇集合**，');
W('> 按 `pityWeight / Σ(可用传奇的 pityWeight)` 实时归一化。');
W('');

/* ---------- 5. 复算代码 ---------- */
W('## 5. 复算方式');
W('');
W('```js');
W('const run = Tower._debugRun(\'endless\');');
W('run.slotFreeIds = new Array(3).fill(\'x\');        // C37：3 个附魔');
W('Tower.buffWeightOf(run, \'C37\');                  // → 1/3');
W('run.limited = [{ id: \'C49\', stacks: 3, uses: 1000, on: true }];');
W('run.fragileGot = { C49: 3 };                      // 含碎掉的');
W('Tower.buffWeightOf(run, \'C49\');                  // → 1/3');
W('Tower.dynamicTierWeightsOf(run, TD.endlessPool);  // 档位预算（个体降权会按比例缩整档）');
W('```');

process.stdout.write(out.join('\n') + '\n');
