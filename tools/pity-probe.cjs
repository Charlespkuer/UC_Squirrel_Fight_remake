#!/usr/bin/env node
/* ============================================================
 * tools/pity-probe.cjs — 传奇保底（LEGEND_PITY）触发机制探针
 *
 * 用途（调平衡时用）：
 *   ① 打印当前保底配置与池组成（阈值、每条传奇的 pityWeight、谁会出池）；
 *   ② 打印「每层能掷多少格」的构成（商店 + 战斗奖励）；
 *   ③ 数学表：不同阈值 N × 不同自然出率 p 下的「平均多少格出一次传奇 / 等效出率」；
 *   ④ 实测表：用真实抽取路径跑 N 页，统计保底触发次数与分布（可复现）。
 *
 * 用法：node tools/pity-probe.cjs [--pages 2000] [--layers 5]
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
const ARGS = process.argv.slice(2);
const num = (n, d) => { const i = ARGS.indexOf('--' + n); return i >= 0 && ARGS[i + 1] ? Number(ARGS[i + 1]) : d; };
const PAGES = Math.max(200, Math.floor(num('pages', 2000)));

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
const TD = c.TowerData, T = c.Tower, S = c.State;
const pct = (v) => (v * 100).toFixed(2) + '%';
const pct3 = (v) => (v * 100).toFixed(3) + '%';

function openRun() {
  S.newGame('pity' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  return T._debugRun('endless');
}

/* ---------- ① 配置与池组成 ---------- */
const need = T.legendPityNeed();
console.log('=== ① 保底配置 ===');
console.log('  阈值 LEGEND_PITY.slots = ' + need + ' 格（TowerData.LEGEND_PITY = ' + JSON.stringify(TD.LEGEND_PITY) + '）');
console.log('  计数器字段 = run.legendPity（跨层保留；换局从 0 开始）');
console.log('  参与掷格的通道 = 试炼商店货架（' + TD.SHOP.slots + ' 格/页） + 战斗奖励选项（3~6/组）');
console.log('  不参与 = 铸币商店（' + (TD.MINT_SHOP ? '独立货架' : '—') + '）');
console.log('');
console.log('=== ② 保底池组成（pityWeight）===');
const legends = TD.BUFFS.filter((b) => b.rarity === 3);
const wof = (b) => { const v = (b.mods || {}).pityWeight; return v === undefined ? 1 : Number(v); };
console.log('  传奇共 ' + legends.length + ' 条：');
for (const b of legends) {
  const w = wof(b);
  const flags = [];
  if (TD.hasTag(b, 'oncePerRun')) flags.push('oncePerRun');
  if (TD.hasTag(b, 'noRestack')) flags.push('noRestack');
  if (b.maxStacks) flags.push('maxStacks ' + b.maxStacks);
  console.log('    ' + b.id.padEnd(4) + ' ' + b.name.padEnd(12) + ' pityWeight=' + String(w).padEnd(2) +
    (w === 0 ? '（不进保底池）' : '') + (flags.length ? '  [' + flags.join(', ') + ']' : ''));
}
{
  const sum = legends.reduce((a, b) => a + wof(b), 0) || 1;
  const pool = legends.filter((b) => wof(b) > 0);
  console.log('  → 全部传奇都可用时，保底各条的静态占比：' +
    pool.map((b) => b.id + ' ' + pct(wof(b) / sum)).join('、'));
}
/* 极端情况：全部传奇到手（含 noRestack 拿满）→ 保底池还剩谁 */
{
  const legIds = ['C51', 'C31', 'E15', 'C36', 'C37', 'C53', 'C55', 'C49'];
  const run = {
    permanent: legIds.filter((id) => id !== 'C49').map((id) => ({ id, stacks: 1 })).concat([{ id: 'C14', stacks: 2 }]),
    limited: [{ id: 'C49', stacks: 1, uses: 1000, on: true }], instantIds: [{ id: 'C51' }],
    permSlotIds: [], pickBuffIds: [], slotFreeIds: new Array(20).fill('x'), fragileGot: { C49: 1 }, rarityBoost: 0, acqSeq: 0,
  };
  const avail = TD.shopPool.filter((b) => b.rarity === 3 && T.ownableOf(run, b) && T.poolFilterOf(run, b));
  const sum = avail.reduce((a, b) => a + wof(b), 0) || 1;
  console.log('  → 极端情况（其余传奇全到手）保底池 = ' +
    avail.map((b) => b.id + ' ' + pct(wof(b) / sum)).join('、') + '（' + avail.length + ' 条）');
}

/* ---------- ③ 每层能掷多少格 ---------- */
console.log('');
console.log('=== ③ 每层掷格数 ===');
{
  const run = openRun();
  const choices = T.choiceSlotsOf ? T.choiceSlotsOf(run) : 3;
  const battles = (run.plan || []).length || 4;
  const shop = TD.SHOP.slots;
  const perLayer = shop + choices * battles;
  console.log('  试炼商店 ' + shop + ' 格 + 战斗奖励 ' + choices + ' 选项 × ' + battles + ' 场 = **' + perLayer + ' 格/层**');
  console.log('  → 阈值 ' + need + ' 格 ≈ ' + (need / perLayer).toFixed(1) + ' 层（若一直不出传奇）');
}

/* ---------- ④ 数学表：p × N → 平均间隔与等效出率 ---------- */
console.log('');
console.log('=== ④ 触发频率数学（E = 平均多少格出一件传奇；等效出率 = 1/E）===');
console.log('  模型：每格自然出传奇概率 p；连续 N 格没出则第 N+1 格**必出**（保底）。');
console.log('        E = (1 − (1−p)^N) / p   —— 自然命中会提前结束这一轮。');
const rowsP = [0.0025, 0.005, 0.010, 0.022];
const rowsN = [40, 80, 120, 200, 400];
console.log('  | 自然出率 p | ' + rowsN.map((n) => 'N=' + n).join(' | ') + ' |');
console.log('  | --- |' + rowsN.map(() => ' --- |').join(''));
for (const p of rowsP) {
  const cells = rowsN.map((n) => {
    const E = (1 - Math.pow(1 - p, n)) / p;
    return E.toFixed(1) + ' 格（' + pct3(1 / E) + '）';
  });
  console.log('  | ' + pct3(p) + ' | ' + cells.join(' | ') + ' |');
}
console.log('');
console.log('  （换算成「层」：除以每层格数）');
console.log('  | 自然出率 p | ' + rowsN.map((n) => 'N=' + n).join(' | ') + ' |');
console.log('  | --- |' + rowsN.map(() => ' --- |').join(''));
{
  const perLayer = TD.SHOP.slots + 3 * 4;
  for (const p of rowsP) {
    const cells = rowsN.map((n) => ((1 - Math.pow(1 - p, n)) / p / perLayer).toFixed(1) + ' 层');
    console.log('  | ' + pct3(p) + ' | ' + cells.join(' | ') + ' |');
  }
}
console.log('');
console.log('  保底**真正被触发**的概率 = (1−p)^N（连续 N 格都没自然出）：');
console.log('  | 自然出率 p | ' + rowsN.map((n) => 'N=' + n).join(' | ') + ' |');
console.log('  | --- |' + rowsN.map(() => ' --- |').join(''));
for (const p of rowsP) {
  const cells = rowsN.map((n) => pct(Math.pow(1 - p, n)));
  console.log('  | ' + pct3(p) + ' | ' + cells.join(' | ') + ' |');
}

/* ---------- ⑤ 实测：真实抽取路径 ---------- */
console.log('');
console.log('=== ⑤ 实测（真实 rollShopSlots 路径，' + PAGES + ' 页）===');
const states = [
  { name: '全新局（5 条传奇可用）', setup: () => openRun() },
  {
    name: '只剩 涅槃/C37/C49（极端情况）',
    setup: () => {
      const r = openRun();
      /* C14 涅槃（不死鸟）2026-10 起可以一直获得 → 极端池 = 涅槃 + C37 + C49（三条平权）。 */
      const legIds = ['C51', 'C31', 'E15', 'C36', 'C37', 'C53', 'C55'];
      r.permanent = legIds.map((id) => ({ id, stacks: 1 }));
      r.limited = [{ id: 'C49', stacks: 1, uses: 1000, on: true }];
      r.instantIds = [{ id: 'C51' }];
      r.fragileGot = { C49: 1 };
      r.legendPity = 0;
      return r;
    },
  },
];
for (const st of states) {
  const run = st.setup();
  let slots = 0, legendsSeen = 0, pitySlots = 0, dryMax = 0, dry = 0;
  const pages = PAGES;
  for (let i = 0; i < pages; i++) {
    /* 复刻 notePityRoll 的计数语义：先看这一格是否已经攒满阈值（保底），
     * 再看这一格抽到的是不是传奇（是就清零，否则 +1）。 */
    let cnt = T.legendPityOf(run);
    const page = T._debugRollShopSlots(run, 0) || [];
    for (const s of page) {
      slots++;
      if (cnt >= need) pitySlots++;
      const b = TD.BUFF_BY_ID[s.id] || {};
      if (b.rarity === 3) { legendsSeen++; cnt = 0; dry = 0; } else { cnt++; dry++; }
      dryMax = Math.max(dryMax, dry);
    }
  }
  console.log('  · ' + st.name);
  console.log('    掷格 ' + slots + ' → 传奇 ' + legendsSeen + ' 件（' + pct3(legendsSeen / slots) +
    '），平均 ' + (legendsSeen ? (slots / legendsSeen).toFixed(1) : '—') + ' 格出一件');
  console.log('    保底触发 ' + pitySlots + ' 次（占全部掷格 ' + pct3(pitySlots / slots) + '）；最长连续空格 ' + dryMax + ' 格');
}
