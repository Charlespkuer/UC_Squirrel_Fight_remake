#!/usr/bin/env node
/* ============================================================
 * tools/test-tower-plan.cjs — 塔的「预告 = 实战」与 boss 强度回归
 *
 * 需求 2：无尽塔界面介绍的敌人、顺序，必须和真正打到的完全一样。
 *   曾经的病根：界面另算一遍 preview(layer, salt)，而只要有地方重建 run.plan 时
 *   漏传 salt（bossFor 依赖它）或漏传 squirrelsOnly，两边就会指向不同的 boss
 *   —— 典型表现就是「第 4 场介绍的 boss 和实际打的不是同一只」。
 *   现在界面统一读 run.plan（Tower.planInfo），这个测试就守这条不变式。
 *
 * 需求 1：全技能树的松鼠 boss（无械苦修·空明）力/敏/速与技能等级被下调，
 *   这里用真实 buildFoe + 实战模拟确认它不再是碾压级的对手。
 *
 * 用法：node tools/test-tower-plan.cjs
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

function setup() {
  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
  const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  }
  c.State.newGame('塔预告测试');
  const S = c.State.state();
  S.level = 70;
  S.props = Object.assign({}, S.props, { 23: 30 });      // 挑战书，够开挑战塔
  for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };
  c.__seed = (n) => vm.runInContext(
    'Math.random=(function(){let s=' + n + ';return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};})();', c);
  return c;
}

/** 把「当前这一层」打完，返回实战里每一场的敌人名字（按顺序）。
 *  注意：第 4 场结束后 phase 可能仍是 null 而 layer 已经 +1，所以必须用层号兜住，
 *  否则会把下一层的敌人也算进来（那正是本测试要抓的错位）。 */
function playLayer(c, mode) {
  const startLayer = c.Tower._debugRun(mode).layer;
  const names = [];
  for (let guard = 0; guard < 15; guard++) {
    const run = c.Tower._debugRun(mode);
    if (!run || run.layer !== startLayer) break;           // 已经进入下一层
    if (run.choices) {
      /* 永久位满了 pickChoice 会返回 needsReplace（不消耗 choices），
       * 这里补一个替换目标，否则会空转到 guard 上限。 */
      const pick = c.Tower.pickChoice(mode, 0, null);
      if (pick && !pick.ok && pick.needsReplace) {
        const owned = (run.permanent || [])[0];
        c.Tower.pickChoice(mode, 0, owned ? owned.id : null);
      }
      continue;
    }
    if (run.phase) break;                                  // 商店/结算点：本层战斗已结束
    const nx = c.Tower.nextBattle(mode);
    if (!nx || nx.ok === false) break;
    names.push(nx.foe.name);
    const after = c.Tower._debugRun(mode);
    if (after.attempt) c.Tower.reportBattle(mode, after.attempt, true, 1, null);
  }
  return names;
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('无尽塔：界面显示的敌人与顺序 = 实战打到的（逐层 15 层）', () => {
  const c = setup();
  c.__seed(12345);
  c.Tower._debugSetLayer(9);
  assert.ok(c.Tower.startEndlessRun().ok, '应该能开一局无尽塔');
  for (let layer = 1; layer <= 15; layer++) {
    c.Tower._debugSetEndlessLayer(layer);
    /* 注意：run 是活对象，打完这一层它会指向下一层 —— 所以开局就要把快照取下来 */
    const planLen = c.Tower._debugRun('endless').plan.length;
    const shown = c.Tower.planInfo('endless').map((p) => p.name);   // 界面读的就是这个
    const real = playLayer(c, 'endless');
    assert.equal(shown.length, planLen, '第 ' + layer + ' 层：界面条数要和 plan 一致（' + shown.length + ' vs ' + planLen + '）');
    // 数组来自 vm realm，用字符串比较避免跨 realm 原型差异
    assert.equal(real.join(' → '), shown.join(' → '),
      '第 ' + layer + ' 层：实战顺序应等于界面顺序');

  }
});

test('无尽塔：重建 plan 时参数齐全（salt + squirrelsOnly），boss 不再错位', () => {
  const c = setup();
  c.__seed(999);
  c.Tower._debugSetLayer(9);
  c.Tower.startEndlessRun();
  for (const layer of [1, 4, 5, 9, 10, 13]) {
    c.Tower._debugSetEndlessLayer(layer);
    const run = c.Tower._debugRun('endless');
    assert.ok(run.salt, 'run 必须有 salt');
    // 权威 plan 的第 4 条（boss）应当等于「同参数重算」的那一只
    const want = c.Tower.preview(layer, run.salt, true)[3];
    const got = c.Tower.planInfo('endless')[3];
    assert.equal(got.name, want.name, '第 ' + layer + ' 层 boss 与同参数预告不一致：' + got.name + ' ≠ ' + want.name);
    assert.equal(got.id || got.anim, want.id || want.anim, '第 ' + layer + ' 层 boss 的 id 也要一致');
    // 并且这条 boss 必须是「无尽池」里的（squirrelsOnly=true），不能是机制 NPC
    assert.notEqual(run.plan[3].kind, 'npc', '第 ' + layer + ' 层的 boss 不该是机制 NPC（说明重建时漏传了 squirrelsOnly）');
  }
});

test('挑战塔：入口页预告 = run.plan = 实战第一场', () => {
  const c = setup();
  c.__seed(2026);
  assert.ok(c.Tower.startTowerRun().ok, '应该能开挑战塔');
  const info = c.Tower.towerInfo();
  const plan = c.Tower.planInfo('tower').map((p) => p.name);
  assert.equal(info.preview.map((p) => p.name).join(' → '), plan.join(' → '), '入口页预告应当就是 run.plan');
  const nx = c.Tower.nextBattle('tower');
  assert.equal(nx.foe.name, info.preview[0].name, '实战第一场应当等于预告第一条');
});

test('全技能树 boss（无械苦修·空明）已被下调：三围更低、技能等级更低', () => {
  const c = setup();
  const d = c.TowerData;
  const monk = d.SQUIRREL_BY_ID.monk;
  assert.ok(monk, '应当有 monk 这只 boss');
  // 相对它自己原来的数值（0.90 / 1.35 / 1.25，技能 12 级）都要更低
  assert.ok(monk.bias.power < 0.90, '力量倍率应当下调：' + monk.bias.power);
  assert.ok(monk.bias.agility < 1.35, '敏捷倍率应当下调：' + monk.bias.agility);
  assert.ok(monk.bias.speed < 1.25, '速度倍率应当下调：' + monk.bias.speed);
  assert.ok(monk.bias.agility <= 1.10, '敏捷不该还高于 1.10：' + monk.bias.agility);
  for (const s of monk.skills) assert.ok(s.level <= 8, '技能 ' + s.id + ' 等级应当 ≤8：' + s.level);
  assert.equal(monk.weapons.length, 0, '它仍然不带武器（特征保留）');
  assert.equal(monk.skills.length, 4, '仍然是全技能树那 4 个技能（特征保留）');
});

test('削弱后的 monk 不再是碾压级 boss（实战胜率不再垫底）', () => {
  const c = setup();
  const tower = c.Tower;
  const TD = c.TowerData;
  const LAYER = 20;
  const player = () => ({ name: '玩家', level: 70, power: 140, agility: 120, speed: 120, maxHp: 2000, hp: 2000,
    baseStats: { power: 140, agility: 120, speed: 120 },
    weapons: [{ id: 1, level: 15 }, { id: 6, level: 15 }, { id: 15, level: 15 }],
    skills: [{ id: 2, level: 15 }, { id: 7, level: 15 }, { id: 16, level: 15 }, { id: 23, level: 15 }],
    wears: [], effects: {}, masterLevel: 0 });
  function foeOf(id, kind) {
    tower._debugSetEndlessLayer(LAYER);
    const run = tower._debugRun('endless');
    run.plan = [{ kind, id }, { kind: 'hero', anim: 'tl' }];
    run.idx = 0;
    const nx = tower.nextBattle('endless');
    if (!nx || nx.ok === false) return null;
    const after = tower._debugRun('endless');
    if (after.attempt) tower.reportBattle('endless', after.attempt, true, 1, null);
    return nx.foe;
  }
  function winRate(foe) {
    c.__seed(4242);
    let win = 0; const N = 120;
    for (let i = 0; i < N; i++) if (c.Sim.simulate(player(), foe).winner === 0) win++;
    return 100 * win / N;
  }
  const rows = [];
  for (const sq of TD.SQUIRRELS.concat(Object.values(TD.TRIAL_BY_ID || {}))) {
    const kind = TD.SQUIRREL_BY_ID[sq.id] ? 'squirrel' : 'trial';
    const foe = foeOf(sq.id, kind);
    if (foe) rows.push({ id: sq.id, name: sq.name, win: winRate(foe) });
  }
  assert.ok(rows.length >= 10, '应该能构造出足够多的 boss 做对比：' + rows.length);
  rows.sort((a, b) => a.win - b.win);                 // 玩家胜率低 = 敌人强
  const monk = rows.find((r) => r.id === 'monk');
  assert.ok(monk, '应当能构造出 monk');
  const hardest = rows[0];
  /* 削弱前 monk 是玩家胜率最低（最强）的那只；现在不该再单独垫底，
   * 至少要落在「和最难的那只差不多」的范围里。 */
  assert.ok(monk.win >= hardest.win - 6,
    'monk 仍然明显强于其它 boss：monk 胜率 ' + monk.win.toFixed(0) + '% vs 最难 ' + hardest.name + ' ' + hardest.win.toFixed(0) + '%');
  // 属性层面也直接校验一次（这是需求里点名的「降低力敏速」）
  const foe = foeOf('monk', 'squirrel');
  assert.ok(foe.power < 120, '力量仍然偏高：' + foe.power);
  assert.ok(foe.agility < 175, '敏捷仍然偏高：' + foe.agility);
  assert.ok(foe.speed < 165, '速度仍然偏高：' + foe.speed);
  for (const s of foe.skills) assert.ok(s.level <= 10, '实战里技能等级仍然偏高：' + JSON.stringify(foe.skills));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ' | ' + (e && e.message)); if (process.env.SSDZ_VERBOSE) console.log(e && e.stack); }
  }
  console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${cases.length} 项）`);
  process.exit(failed ? 1 : 0);
})();
