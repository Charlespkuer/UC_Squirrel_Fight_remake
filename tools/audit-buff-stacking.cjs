#!/usr/bin/env node
/* ============================================================
 * tools/audit-buff-stacking.cjs — 审计「多份到底有没有用」
 *
 * 两个问题（2026-10 用户报的）：
 *   ① **速率/步长类**增益（每 N 币 / 每 N 场触发一次）多份时没缩放 → 多拿等于白拿；
 *   ② **纯开关类**增益（效果是 boolean / 取最大值）多份时本来就没意义 →
 *      应该「身上有就不再出现」（unique），而不是并排占一堆格子。
 *
 * 做法：把每条增益的 mods 键拿出来，到 js/tower.js + js/sim.js 里找它的消费方式：
 *   · SCALED  —— `m.X * k` / `runModTotal` / 显式 `* stacks` → 多份有意义
 *   · FLAG    —— `agg.X = 1` / `if (m.X)` / `Math.max(...)` / 只在 `if (stacksOf())` 里当开关
 *   · STEP    —— 出现在 `while (counter >= step)` 这类「按计数器推进」的循环里（要看有没有 ×份数）
 * 只做静态近似：结论表要人工复核一遍（表里会带上证据行号）。
 *
 * 用法：node tools/audit-buff-stacking.cjs [--all]
 *   默认只打印「可疑」的（纯 FLAG / STEP 未缩放）；--all 打印全表。
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
const ALL = process.argv.includes('--all');

const store = new Map();
class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
const c = {
  Date: CD, location: { search: '?qa=1' },
  console: { log() {}, warn() {}, error() {} },
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
};
c.window = c; c.self = c;
vm.createContext(c);
const FILES = ['js/tower.js', 'js/sim.js'];
for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
}
const TD = c.TowerData;
const SRC = {};
for (const f of FILES) SRC[f] = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
/** 找某个 mod 键在源码里的所有出现（返回 { file, line, text }）。 */
function hits(key) {
  const out = [];
  for (const f of FILES) {
    SRC[f].forEach((text, i) => {
      if (new RegExp('\\b' + key + '\\b').test(text)) out.push({ file: f, line: i + 1, text: text.trim() });
    });
  }
  return out;
}
/** 判断一条出现属于哪种消费方式。 */
function classify(key, hs) {
  const kinds = new Set();
  for (const h of hs) {
    const t = h.text;
    if (/mods?\.[A-Za-z.]*$/.test(t) && /:\s*[^,]+,?\s*$/.test(t)) continue;          // 数据行（本文件里的定义）
    if (new RegExp('\\b' + key + '\\b\\s*\\*\\s*(k|stacks|g|c\\d+|[a-z]+Stacks?)').test(t)) kinds.add('SCALED');
    /* 同一行里出现 `* k` / `* stacks` / `× 层数`（表达式中间夹了 Math.max(...) 之类也算）→ 按份数缩放 */
    if (new RegExp('\\b' + key + '\\b').test(t) && /\*\s*(k|stacks|g)\b|[×x]\s*(层数|份数)/.test(t)) kinds.add('SCALED');
    if (/runModTotal\(run,\s*'/.test(t) && new RegExp("'" + key + "'").test(t)) kinds.add('SCALED');
    if (/Math\.max\(/.test(t) && new RegExp('\\b' + key + '\\b').test(t)) kinds.add('FLAG');
    if (/\b= 1;|\b= 1\b(?!\d)/.test(t) && new RegExp('^\\s*if\\s*\\(m\\.' + key).test(t)) kinds.add('FLAG');
    if (new RegExp('if\\s*\\(\\s*m\\.' + key + '\\s*\\)').test(t)) kinds.add('FLAG');
    if (/while\s*\(.*(step|Step)/.test(t) && /spend|Spend/.test(t)) kinds.add('STEP');
  }
  if (!kinds.size) kinds.add('UNKNOWN');
  return [...kinds];
}
/* 与「份数」有关的键：出现在按计数器推进的循环里 */
const STEP_LINE = SRC['js/tower.js'].findIndex((l) => /const step58 =/.test(l)) + 1;
const stepKeys = ['shopSpendLimited', 'shopSpendStep', 'shopSpendTiers', 'shopSpendTierSize'];

const pools = { 无尽: TD.endlessPool || [], 挑战塔: TD.towerPool || [], 商店: TD.shopPool || [], 铸币店: TD.mintPool || [] };
const seen = new Map();
for (const [pname, list] of Object.entries(pools)) {
  for (const b of list) {
    if (!seen.has(b.id)) seen.set(b.id, { b, pools: new Set() });
    seen.get(b.id).pools.add(pname);
  }
}
const flags = ['firstDodge', 'firstHitZero', 'firstHitZeroFreeTurn', 'mustHitAll', 'mustHitFirst', 'firstSkillFree',
  'reflectImmune', 'envIgnore', 'envReflect', 'envDenyGood', 'x10Boost', 'weaponFreeUses', 'weaponBoostUses',
  'weaponBoostMustHit', 'weaponBoostReflectImmune', 'postBattleShop', 'layerRestart', 'pickPermanentFree',
  'pickWeaponPct', 'pickSkillPct', 'permSlot'];

const bad1 = [], bad2 = [], table = [];
for (const { b, pools: pl } of seen.values()) {
  const mods = Object.keys(b.mods || {});
  if (!mods.length) continue;
  const rows = mods.map((key) => {
    const hs = hits(key);
    const kinds = classify(key, hs);
    /* 只有「纯开关」的键才算 FLAG；有 SCALED 就当多份有意义 */
    const isFlag = !kinds.includes('SCALED') && (kinds.includes('FLAG') || flags.includes(key));
    const isStep = stepKeys.includes(key) || kinds.includes('STEP');
    return { key, kinds, isFlag, isStep, first: hs[0] };
  });
  const allFlag = rows.every((r) => r.isFlag);
  const hasStep = rows.some((r) => r.isStep);
  table.push({ b, pools: [...pl], rows });
  if (allFlag && b.kind === 'permanent' && !TD.hasTag(b, 'unique') && !TD.hasTag(b, 'oncePerRun') && !TD.hasTag(b, 'noRestack')) {
    bad2.push({ b, rows, pools: [...pl] });
  }
  if (hasStep) bad1.push({ b, rows: rows.filter((r) => r.isStep) });
}

console.log('=== ① 速率/步长类（多份需要缩放）===');
if (!bad1.length) console.log('  （没有发现）');
for (const x of bad1) {
  console.log('  ' + x.b.id + ' ' + x.b.name + '  键=' + x.rows.map((r) => r.key).join(','));
  for (const r of x.rows) if (r.first) console.log('      ' + r.first.file + ':' + r.first.line + '  ' + r.first.text);
  console.log('      → 该循环里**是否乘了份数**需要人工确认（本工具只做静态定位）');
}
console.log('');
console.log('=== ② 纯开关类永久增益（多份无意义 → 应当「有了就不再出现」）===');
if (!bad2.length) console.log('  （没有发现）');
for (const x of bad2) {
  console.log('  ' + x.b.id.padEnd(4) + ' ' + x.b.name.padEnd(12) + ' rarity=' + x.b.rarity +
    '  池=' + x.pools.join('/') + '  unique=' + TD.hasTag(x.b, 'unique') + '  键=' + x.rows.map((r) => r.key + '[' + r.kinds.join('|') + ']').join(','));
}
console.log('');
if (ALL) {
  console.log('=== 全表（' + table.length + ' 条有 mods 的增益）===');
  for (const x of table.slice().sort((a, b2) => a.b.id.localeCompare(b2.b.id))) {
    console.log('  ' + x.b.id.padEnd(4) + ' ' + x.b.name.padEnd(14) + ' kind=' + x.b.kind.padEnd(10) +
      ' stackable=' + String(TD.hasTag(x.b, 'stackable')).padEnd(5) + ' cap=' + String(TD.stackCap(x.b)).padEnd(8) +
      ' ' + x.rows.map((r) => r.key + ':' + r.kinds.join('|')).join('  '));
  }
}
