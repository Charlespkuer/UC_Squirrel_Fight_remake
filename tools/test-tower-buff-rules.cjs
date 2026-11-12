#!/usr/bin/env node
/* ============================================================
 * tools/test-tower-buff-rules.cjs — 无尽塔增益数值 / 商店售卖规则回归
 *
 * 覆盖本轮四条可感知规则：
 *   ① 增幅水晶（C15）同名多张**加算**（1 + 0.3×张数），且与水晶铭文（C60）加算；
 *   ② 门庭若市（C59）的描述是「进入商店」，不是「进入试炼商店」；
 *   ③ 战利品账本（C25）同店卖旧买新时，新账本按 50 起价，不继承旧账本累计，
 *      卖掉新账本也不会清掉另一本的累计；
 *   ④ 替换弹窗的「取消」不会被二次 bind 覆写；卡面类型标签覆盖所有 buff kind（铭文不能是 undefined）。
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

test('献祭限次增益只消耗单次获得的场次，剩余不足一份才整栏移除', () => {
  const c = setup(), T = c.Tower;
  const run = T._debugRun('endless');
  assert.ok(T.addBuff(run, 'HB01').ok, '先拿到渴血之剑');
  assert.ok(T.addBuff(run, 'N05').ok, '第一份先手制敌');
  assert.ok(T.addBuff(run, 'N05').ok, '第二份先手制敌（同名累加场次）');
  const row = () => (run.limited || []).find((b) => b && b.id === 'N05');
  assert.equal(row().uses, 6, '两份先手制敌 = 6 场');

  run.bladeSacrificePending = true;
  const cand = T.bladeSacrificeCandidates().list.find((x) => x.id === 'N05');
  const r = T.sacrificeBlade(cand && cand.ref);
  assert.equal(r.ok, true, r.msg || '第一刀献祭应当成功');
  assert.equal(row().uses, 3, '只扣单次获得的 3 场，不能把 6 场全吞');
  assert.equal(r.used.partial, true, '返回值要标明这次只消耗了一份场次');

  run.bladeSacrificePending = true;
  const cand2 = T.bladeSacrificeCandidates().list.find((x) => x.id === 'N05');
  const r2 = T.sacrificeBlade(cand2 && cand2.ref);
  assert.equal(r2.ok, true, r2.msg || '第二刀献祭应当成功');
  assert.equal(row(), undefined, '只剩最后一份时整栏移走');
});

test('献祭窗在换页重画时复位，但同一轮重画只开一层', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/function bladeOfferVisible\(\) \{[\s\S]{0,260}?return bladeOfferOpen;/.test(ui),
    'bladeOfferVisible 不能再用弹层 isConnected 反推关闭');
  assert.ok(/function openEndless\(opts\) \{[\s\S]{0,500}?if \(bladeOfferOpen\) \{ bladeOfferOpen = false; bladeOfferEl = null; \}/.test(ui),
    'openEndless 重画 #ui 前要复位献祭窗开关，否则丢窗后不再重开、直接卡死');
  assert.ok(!/bladeOfferEl\.isConnected === false\) bladeOfferOpen = false/.test(ui),
    'DOM 被 openEndless 重画摘掉时不能靠 isConnected 反推（会叠出第二层）');
  assert.ok(/bladeOfferOpen = true;\s*\n\s*const got = Tower\.bladeSacrificeCandidates/.test(ui),
    '建弹层前先置位，挡住同一轮重画造成的第二层');
});

test('限次列表把渴血之剑置顶，王者之剑使用传奇金色外观', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/tower.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/const isBladeBuff = \(b\) => !!\(b && TowerData\.isBladeId/.test(ui)
    && /sort\(\(a, b\) => Number\(isBladeBuff\(b\)\) - Number\(isBladeBuff\(a\)\)\)/.test(ui),
    '限次增益列表要按 isBladeId 把剑及其变体排在最前');
  assert.ok(/b\.id === TowerData\.BLADE\.finalId/.test(ui)
    && /limit-tag r' \+ b\.rarity \+\s*\n\s*\(king \? ' legendary' : ''\)/.test(ui),
    'HB04 王者之剑要加 legendary 卡面类');
  assert.ok(/\.limit-tag\.legendary\s*\{[^}]*linear-gradient/.test(css),
    'legendary 限次卡要有金色渐变外观');
});

hr('4. 界面接线：替换弹窗的取消键 / 铭文卡面标签');
test('替换弹窗二次 bind 之后「取消」仍可点，替换行也照常绑上', () => {
  const cu = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = cu.indexOf('  function bind(root, actions) {');
  const end = cu.indexOf('  function frameUrl(', start);
  assert.ok(start > 0 && end > start, 'classic-ui 里应当能切出 bind()');
  const ctx = { popTap: (el, fn) => fn(), console };
  vm.createContext(ctx);
  /* 复刻真实顺序：modal() 先给底部「取消」挂好 onclick，随后 tower-ui 再 bind 弹窗补列表行。 */
  vm.runInContext(cu.slice(start, end) +
    '\nvar fired = [];' +
    '\nvar cancel = { dataset: { action: "0" }, classList: { contains: function () { return false; } }, onclick: function () { fired.push("cancel"); } };' +
    '\nvar row = { dataset: { action: "rp0" }, classList: { contains: function () { return false; } }, onclick: null };' +
    '\n$$ = function () { return [cancel, row]; };' +
    '\nbind({}, { rp0: function () { fired.push("row"); } });' +
    '\ncancel.onclick(); row.onclick();' +
    '\nglobalThis.__out = fired.join(",");', ctx);
  assert.equal(ctx.__out, 'cancel,row', '取消键与替换行都要能点：' + ctx.__out);
});

test('增益卡面的类型标签覆盖每种 kind（铭文不再显示 undefined）', () => {
  const c = setup();
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const scopeLine = /const SCOPE = \{[^}]*\};/.exec(ui);
  assert.ok(scopeLine, 'tower-ui 里应当有 SCOPE 卡面类型表');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(scopeLine[0] + '\nglobalThis.__SCOPE = SCOPE;', ctx);
  for (const b of c.TowerData.BUFFS) {
    assert.ok(ctx.__SCOPE[b.kind], b.id + '（kind=' + b.kind + '）的卡面类型标签缺失，界面上会画出 undefined');
  }
});

hr('5. 涅槃：回合耗尽也会先复活，本层剩余次数要如实记账并显示');
test('60 手打满时先复活加时；失败也扣本层次数；悬停按真实剩余显示', () => {
  const c = setup();
  const T = c.Tower, Sim = c.Sim;
  /* —— ① Sim：玩家 10% 血、双方都打不死对方 → 60 手按血量比例判负；
   *       带涅槃时先复活（回 50%）并开下一个 60 手窗口，而不是直接结束。 —— */
  const mk = (mods) => ({ name: 'p', level: 70, power: 1, agility: 1, speed: 1, maxHp: 10000, hp: 1000,
    baseStats: { power: 1, agility: 1, speed: 1 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0, mods });
  const foe = () => ({ name: 'e', level: 70, power: 1, agility: 1, speed: 1, maxHp: 10000, hp: 10000,
    baseStats: { power: 1, agility: 1, speed: 1 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  const plain = Sim.simulate(mk(null), foe());
  assert.equal(plain.winner, 1, '没有涅槃：60 手后按血量比例判负');
  assert.equal(plain.rounds.length, 60, '没有涅槃就是正常的 60 手');
  const saved = Sim.simulate(mk({ deathSaves: [{ healPct: 0.5, statMul: 0.5, revive: 1 }] }), foe());
  const revives = (saved.rounds || []).filter((r) => r.timeoutRevive);
  assert.equal(revives.length, 1, '回合耗尽时涅槃应当先救一次，不是直接判负');
  assert.ok(revives[0].deathSave && revives[0].revive, '这一拍要带 deathSave/revive 标记，塔侧才会计数');
  assert.ok(revives[0].hpAfter[0] >= 5000, '复活后回到 50% 生命：' + revives[0].hpAfter[0]);
  assert.ok(saved.rounds.length > 60, '复活后要开新的 60 手窗口继续打：' + saved.rounds.length);

  /* —— ② 塔侧：失败（含巡逻失败）也要扣本层次数；剩 0 时悬停不能再写「1 次」。—— */
  T._debugSetEndlessLayer(7);
  const run = T._debugRun('endless');
  run.permanent = [{ id: 'C14', stacks: 1 }];
  run.choices = null; run.phase = null; run.env = []; run.noEnvRoll = true;
  const infoBefore = T.reviveInfoOf(run);
  assert.ok(infoBefore && infoBefore.perLayer === 1 && infoBefore.used === 0 && infoBefore.left === 1,
    '开战前本层还有 1 次：' + JSON.stringify(infoBefore));
  const nx = T.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
  const me = { name: 'p', level: 70, power: 100, agility: 100, speed: 100, maxHp: 1000, hp: 1000,
    baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 };
  nx.adjustMe(me);
  assert.equal((me.mods.deathSaves || []).filter((s) => s.revive).length, 1, '开战时发 1 次复活');
  T._debugRun('endless').retryToken = 1;            // 让失败结算留在局内，好检查计数
  T.reportBattle('endless', nx.token, false, 0, me.maxHp, { rounds: [{ deathSave: true, revive: 1, timeoutRevive: 1 }] });
  const after = T._debugRun('endless');
  assert.equal(after.reviveUsed, 1, '失败 / 回合耗尽判负用掉的涅槃也要记（以前只在胜利分支数）');
  const infoAfter = T.reviveInfoOf(after);
  assert.ok(infoAfter && infoAfter.perLayer === 1 && infoAfter.used === 1 && infoAfter.left === 0,
    '用掉之后本层剩 0 次：' + JSON.stringify(infoAfter));

  /* 悬停必须问 reviveInfoOf（写死 b.stacks 会一直显示「1 次」） */
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = ui.indexOf('本层复活机会');
  assert.ok(at > 0, '塔页悬停里应当有「本层复活机会」这一行');
  const tip = ui.slice(Math.max(0, at - 500), at + 300);
  assert.ok(/Tower\.reviveInfoOf/.test(tip), '悬停要按真实剩余次数算');
  assert.ok(!/本层复活机会：' \+ Math\.max\(1, Math\.floor\(Number\(b\.stacks\)/.test(tip), '不能再用叠层数当剩余次数');

  /* 经典回放：加时那一拍要把剩余回合重置回满格（否则「回合 0 了还在打」） */
  const fight = fs.readFileSync(path.join(ROOT, 'js', 'ssfight', 'ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/if \(rec\.rounds\[i\] && rec\.rounds\[i\]\.timeoutRevive\) \{\s*\n\s*rec\.roundsLeft = Math\.max\(1, Math\.floor\(Number\(o\.maxRounds\) \|\| 60\)\);/.test(fight),
    '加时要把经典 HUD 的剩余回合重置回满格');
});

console.log('\n塔增益规则回归：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exitCode = 1;
