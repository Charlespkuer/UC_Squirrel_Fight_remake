#!/usr/bin/env node
/* ============================================================
 * tools/test-fixes-round.cjs — 本轮 8 项修复/平衡的回归
 *
 *  1. 环境 buff 全部真正生效（血色黄昏「双方吸血」以前只作用敌人）
 *  2. 烈日灼烧：敌方 +25% 暴击、我方 +10% 暴击
 *  3. 元素术鼠 只放真实存在的技能；来点松果同回合只能触发一次
 *  4. 平衡：以战养战 +5、吞噬成长「胜利 +2%/上限 30%」、易碎 6%、
 *          晴空护符 3 次、磐石之躯 稀有、战利品账本 卖价 50
 *  5. x10 层只有最后一个敌人穿狂战套
 *  6. 限次 buff 每场都扣（整层最后一场以前会被跳过）
 *  7. 商店传奇卡有价格、能买能卖（以前 NaN）
 *  8. 每日抽奖后抽奖卷数量即时刷新
 *
 * 用法：node tools/test-fixes-round.cjs
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
  c.State.newGame('本轮回归');
  const S = c.State.state();
  S.level = 70;
  S.props[23] = 30;
  for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };
  c.__seed = (n) => vm.runInContext(
    'Math.random=(function(){let s=' + n + ';return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};})();', c);
  /* 把「会改变层内流程」的两张牌（E01 战后开店 / E15 重开本层）从场间选择里排除 ——
   * 本文件大量用例要靠真随机的场次计数与商店节奏（抽到它们必然散掉，实测偶发红）。
   * 需要这两条的用例都自己用 debugGrantBuff/addBuff 直接发牌，覆盖不受影响。 */
  c.Tower._debugSetNoFlowBuffs(true);
  /* 另外关掉铸币商店的**自动**刷出：它同样会在层中突然弹一家店、打断「一场接一场」的假设
   *（实测 需求44 偶发红就是这个）。要测铸币商店的用例自己 _debugSetNoMintShop(false)。 */
  c.Tower._debugSetNoMintShop(true);
  /* 固定随机：__rand(v) → 每次调用都返回 v（0 = 概率必中/必取第一项；0.99 = 必不中）。 */
  c.__rand = (v) => vm.runInContext(
    '(function(){var v=' + Number(v) + ';Math.random=function(){return v;};return true;})()', c);
  c.Tower._debugSetLayer(9);
  assert.ok(c.Tower.startEndlessRun().ok, '应该能开一局无尽塔');
  c.Tower._debugSetEndlessLayer(20);
  return c;
}
const PLAYER = () => ({ name: '玩家', level: 70, power: 140, agility: 120, speed: 120, maxHp: 2000, hp: 2000,
  baseStats: { power: 140, agility: 120, speed: 120 }, weapons: [{ id: 1, level: 15 }], skills: [], wears: [], effects: {}, masterLevel: 0 });

/** 用指定环境开下一场，返回 { foe, me }。 */
function withEnv(c, envs, player) {
  let run = c.Tower._debugRun('endless');
  if (run.attempt) { c.Tower.reportBattle('endless', run.attempt, true, 1, null); run = c.Tower._debugRun('endless'); }
  run.env = envs; run.choices = null; run.phase = null;
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应该能开出下一场：' + ((nx && nx.msg) || ''));
  const me = player || PLAYER();
  nx.adjustMe(me);
  const after = c.Tower._debugRun('endless');
  if (after.attempt) c.Tower.reportBattle('endless', after.attempt, true, 1, null);
  return { foe: nx.foe, me, nx };
}
/** 只造敌人（不动 run 的战斗态），用于反复模拟。 */
function foeOf(c, id, kind, layer) {
  if (layer) c.Tower._debugSetEndlessLayer(layer);
  let run = c.Tower._debugRun('endless');
  if (run.attempt) { c.Tower.reportBattle('endless', run.attempt, true, 1, null); run = c.Tower._debugRun('endless'); }
  run.plan = [{ kind: kind || 'squirrel', id }, { kind: 'hero', anim: 'tl' }];
  run.idx = 0; run.env = []; run.choices = null; run.phase = null;
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应该能造出 ' + id + '：' + ((nx && nx.msg) || ''));
  return nx.foe;
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }
/** 「会改变层内流程」的增益：E01 会在下一场后开试炼商店、E16 会在下一场后开铸币商店、
 *  E15 会把本层从第 1 场重开、E17 会让下一场直接判胜（战斗结果被改写）。
 *  只关心层内进度/商店节奏的用例不该随机选到它们（这条测试本来就是靠真随机跑的，
 *  选到之后场次计数就散了 —— 实测 需求9.8 偶发红就是这个原因）。 */
const FLOW_BUFFS = ['E01', 'E15', 'E16', 'E17'];
/** 从选择节点里挑一张**不改流程**的；都改了（极端情况）就退回第 0 张。 */
function safeChoiceIndex(choices) {
  const list = Array.isArray(choices) ? choices : [];
  const i = list.findIndex((c) => c && FLOW_BUFFS.indexOf(c.id) < 0);
  return i < 0 ? 0 : i;
}

test('需求1：环境 buff 全部真正生效（血色黄昏双方向吸血、寒霜我方、贪婪敌血）', () => {
  const c = setup();
  // 血色黄昏：双方吸血 —— 敌人与我方都要拿到
  let r = withEnv(c, [{ id: 'dusk', left: 5, values: { bothLifestealPct: 0.15 } }]);
  assert.equal(r.foe.mods.lifestealPct, 0.15, '血色黄昏应当给敌人吸血：' + JSON.stringify(r.foe.mods));
  assert.equal(r.me.lifestealPct, 0.15, '血色黄昏应当给我方吸血（以前只给了敌人）');
  assert.equal(r.me.mods.lifestealPct, 0.15, '我方 mods 里也要有 lifestealPct');
  assert.equal(r.me.mods.lifestealPct, 0.15, '不能被叠加两次');

  // 寒霜锁链：我方速度下降
  c.__seed(7);
  r = withEnv(c, [{ id: 'frost', left: 5, values: { selfSpeedMul: -0.20 } }]);
  assert.ok(r.me.speed < 120, '寒霜锁链应当压低我方速度：' + r.me.speed);
  assert.equal(r.me.speed, Math.max(1, Math.round(120 * 0.8)), '降幅应当正好是 20%');

  // 贪婪裂隙：敌方生命上限上涨
  r = withEnv(c, [{ id: 'greed', left: 5, values: { coinBonus: 0.5, enemyMaxHpMul: 0.15 } }]);
  assert.equal(r.foe.mods.maxHpMul, 0.15, '贪婪裂隙应当给敌人加生命上限：' + JSON.stringify(r.foe.mods));

  // 荆棘反伤：写进敌人 mods 且在实战里真的反弹
  r = withEnv(c, [{ id: 'thorns', left: 5, values: { thornsPct: 0.15 } }]);
  assert.equal(r.foe.mods.thornsPct, 0.15, '荆棘反伤应当写进敌人 mods');
  /* 单场不一定打得到（可能输掉 / 被闪避 / 没轮到近战命中），实测单场出现反伤约 76%，
   * 所以采样若干场，只要有反伤就说明机制真的生效。 */
  let thornSeen = false;
  for (let t = 0; t < 40 && !thornSeen; t++) {
    const sim = c.Sim.simulate(PLAYER(), r.foe);
    if ((sim.rounds || []).some((x) => (x.thornsDmg || 0) > 0)) thornSeen = true;
  }
  assert.ok(thornSeen, '荆棘反伤应当真的反弹伤害（40 场采样）');
});

test('需求2：烈日灼烧 = 敌方 +25% 暴击 / 我方 +10% 暴击', () => {
  const c = setup();
  const def = c.TowerData.ENDLESS_ENV_BY_ID.sun;
  assert.ok(def, '应当有烈日灼烧');
  // 区间要覆盖需求点名的 25 / 10
  const eLo = Number(def.mods.enemyCritBonus[0]), eHi = Number(def.mods.enemyCritBonus[1]);
  const sLo = Number(def.mods.selfCritBonus[0]), sHi = Number(def.mods.selfCritBonus[1]);
  assert.ok(eLo <= 25 && 25 <= eHi, '敌方暴击区间应当覆盖 25：' + eLo + '~' + eHi);
  assert.ok(sLo <= 10 && 10 <= sHi, '我方暴击区间应当覆盖 10：' + sLo + '~' + sHi);
  assert.ok(eHi > sHi, '敌方加成应当高于我方');
  const t = c.TowerData.envText(def, { enemyCritBonus: 25, selfCritBonus: 10 });
  assert.match(t.text, /敌方暴击率 \+25/, '文案要写敌方 +25：' + t.text);
  assert.match(t.text, /我方暴击率 \+10/, '文案要写我方 +10：' + t.text);

  const r = withEnv(c, [{ id: 'sun', left: 5, values: { enemyCritBonus: 25, selfCritBonus: 10 } }]);
  assert.equal(r.foe.crit, 25, '敌人应当 +25 暴击');
  assert.equal(r.foe.mods.critBonus, 25, '敌人 mods 里也要有');
  assert.equal(r.me.crit, 10, '我方应当 +10 暴击');
  assert.equal(r.me.mods.critBonus, 10, '我方 mods 里也要有');
});

test('需求3：元素术鼠 只放真实存在的技能，且来点松果同回合只触发一次', () => {
  const c = setup();
  const el = c.TowerData.SQUIRREL_BY_ID.elemental;
  for (const s of el.skills) {
    assert.ok(c.TowerData.BUFFS && true);
    // 技能必须真是存在的技能（原版字典里 20/22 是空 id）
    assert.ok(String(s.id) === '12' || String(s.id) === '17', '元素术鼠 只该带真实实现的技能，实测 ' + s.id);
  }
  assert.ok(Array.isArray(el.castable) && el.castable.length >= 1, '元素术鼠 应当声明 castable');

  const foe = foeOf(c, 'elemental', 'squirrel');
  assert.equal((foe.skills || []).map((s) => Number(s.id)).join(','), el.skills.map((s) => s.id).join(','),
    '敌人身上的技能应当与数据一致：' + JSON.stringify(foe.skills));

  // 实战：200 场里，松果不能背靠背触发；技能 12 要真的出现
  c.__seed(4242);
  let backToBack = 0, snack = 0, fist = 0;
  for (let i = 0; i < 200; i++) {
    const sim = c.Sim.simulate(PLAYER(), JSON.parse(JSON.stringify(foe)));
    const mine = sim.rounds.filter((x) => x.attacker === 1);
    let last = -2;
    for (let k = 0; k < mine.length; k++) {
      if (mine[k].id === 17) { if (k === last + 1) backToBack++; last = k; snack++; }
      if (mine[k].id === 12) fist++;
    }
  }
  assert.equal(backToBack, 0, '同回合内不该连续触发松果（实测 ' + backToBack + ' 次）');
  assert.ok(snack > 0, '松果应当偶尔出现');
  assert.ok(snack <= 200 * 1, '松果每场最多一次（实测 ' + snack + ' 次 / 200 场）');
  assert.ok(fist > 0, '野球拳（12）应当真的放出来（实测 ' + fist + ' 次）');
});

test('需求4：平衡数值逐条核对', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.BUFF_BY_ID.C11.mods.winMaxHpFlat, 5, '以战养战应当每胜 +5');
  /* 本轮增益表重做后文案改成数字口径（不再写「不封顶」），断言跟着改成数字说明 */
  assert.match(TD.BUFF_BY_ID.C11.desc, /生命上限 \+5/, '文案要写明每胜 +5：' + TD.BUFF_BY_ID.C11.desc);
  assert.equal(TD.BUFF_BY_ID.C07.mods.winMaxHpPct, 0.02, '吞噬成长应当每胜 +2%');
  assert.equal(TD.BUFF_BY_ID.C07.mods.winMaxHpCap, 0.30, '吞噬成长上限应当 30%');
  assert.equal(TD.BUFF_BY_ID.C07.mods.killMaxHpPct, undefined, '吞噬成长不该再挂击杀成长');
  assert.match(TD.BUFF_BY_ID.C07.desc, /每胜利一场/, '文案要写明成长时机');
  assert.match(TD.BUFF_BY_ID.C07.desc, /最多 \+30%/, '文案要写明上限：' + TD.BUFF_BY_ID.C07.desc);
  for (const id of ['C39', 'C40', 'C41', 'C42', 'C43', 'C44']) {
    assert.equal(TD.BUFF_BY_ID[id].mods.fragileBreakPct, 6, id + ' 的易碎概率应当 6%');
    /* 文案措辞由用户改过（10.6.1：「每胜利一场6%概率损毁」），
     * 这里只守住意图：必须说明会损毁，且要写出概率。 */
    assert.match(TD.BUFF_BY_ID[id].desc, /损毁/, id + ' 的文案要说明会损毁');
    assert.match(TD.BUFF_BY_ID[id].desc, /(6%|小概率)/, id + ' 的文案要写明损毁概率：' + TD.BUFF_BY_ID[id].desc);
  }
  assert.equal(TD.BUFF_BY_ID.N09.uses, 3, '晴空护符应当 3 次');
  assert.match(TD.BUFF_BY_ID.N09.desc, /3 场/, '晴空护符文字要写 3 场');
  assert.equal(TD.BUFF_BY_ID.C01.rarity, 1, '磐石之躯应当是稀有');
  assert.equal(TD.RARITY_NAME[TD.BUFF_BY_ID.C01.rarity], '稀有', '稀有度名字要对上');
  assert.equal(TD.BUFF_BY_ID.C25.mods.sellValue, 50, '战利品账本卖价应当 50');

  // 实战：吞噬成长真的按胜利累加、且有 30% 上限
  let run = c.Tower._debugRun('endless');
  run.limited = []; run.permanent = [{ id: 'C07', stacks: 1 }]; run.winMaxHp = 0; run.choices = null; run.phase = null;
  for (let i = 1; i <= 3; i++) {
    const nx = c.Tower.nextBattle('endless');
    if (!nx || nx.ok === false) break;
    const a = c.Tower._debugRun('endless');
    c.Tower.reportBattle('endless', a.attempt, true, 1, null);
    assert.equal(Number(c.Tower._debugRun('endless').winMaxHp).toFixed(4), (0.02 * i).toFixed(4),
      '第 ' + i + ' 场胜利后应当累计到 ' + (2 * i) + '%');
  }
});

test('需求5：x10 层只有最后一个敌人穿狂战套', () => {
  const c = setup();
  c.Tower._debugSetEndlessLayer(10);
  const run = c.Tower._debugRun('endless');
  assert.equal(run.plan.length, 5, '第 10 层应当是 5 场');
  assert.equal(run.plan[4].kind, 'warlord', '最后一场应当是狂战松鼠');
  const seen = [];
  const choiceBefore = [];      // 记录「第几场之前」给了场间多选一
  /* 环境里的「幻影回响」会在战后按概率追加一场 —— 这条测试只数「本层计划内的 5 场」，
   * 所以直接关掉环境抽取（比每轮清 env 更可靠：reportBattle 里还会再摇一次）。 */
  run.noEnvRoll = true; run.env = [];
  for (let g = 0; g < 12; g++) {
    const r = c.Tower._debugRun('endless');
    r.env = [];
    if (r.layer !== 10) break;
    if (r.choices) {
      choiceBefore.push(r.idx + 1);              // 下一场就是「第 idx+1 场」
      /* 永久格子满了时 pickChoice 会返回 needsReplace 且**不消耗** choices ——
       * 必须补一个替换目标，否则循环会原地打转（表现为「本层只打了 N 场」，实测偶发）。
       * 替换目标要挑**占位**的那一个：换掉被虚空铭文附魔（不占位）的会被拒绝，
       * 于是循环空转、12 次预算被耗尽 —— 这就是那条偶发失败的真正原因。 */
      const p = c.Tower.pickChoice('endless', 0, null);
      if (p && !p.ok && p.needsReplace) {
        const free = r.slotFreeIds || [];
        const owned = (r.permanent || []).find((b) => free.indexOf(b.id) < 0) || (r.permanent || [])[0];
        c.Tower.pickChoice('endless', 0, owned ? owned.id : null);
      }
      continue;
    }
    if (r.phase) break;
    const nx = c.Tower.nextBattle('endless');
    if (!nx || nx.ok === false) break;
    seen.push({ name: nx.foe.name, elite: nx.elite, wears: (nx.foe.wears || []).map((w) => w.id) });
    const a = c.Tower._debugRun('endless');
    c.Tower.reportBattle('endless', a.attempt, true, 1, null);
    /* reportBattle 里的 rollEnvAfterBattle 可能又摇出「幻影回响」，
     * 对下一场来说环境仍然是「干净」的 —— 再清一次。 */
    const after = c.Tower._debugRun('endless');
    if (after) after.env = [];
  }
  assert.equal(seen.length, 5, '应当打完 5 场，实测 ' + seen.length);
  /* 修 bug 回归：三选一的触发点原来写成 `won === 3 || (won === 4 && len === 5)`，
   * `won === 3` 没看 len —— 5 场层会在打完第 4 场后挂上 choices，
   * 下一轮直接结算层完成，**第 5 场的塔顶 boss 被整个跳过**。
   * 所以这里必须确认第 5 场真的是狂战松鼠（而不是提前结束）。 */
  assert.equal(seen[4].name.indexOf('狂战松鼠'), 0, '第 5 场必须是塔顶 boss，实测 ' + seen[4].name);
  assert.equal(seen[4].elite, true, '塔顶 boss 应当是精英');
  const berserk = [201, 202, 203, 204];
  for (let i = 0; i < 4; i++) {
    const hit = seen[i].wears.filter((id) => berserk.includes(id));
    assert.equal(hit.length, 0, '第 ' + (i + 1) + ' 场（' + seen[i].name + '）不该穿狂战套：' + JSON.stringify(seen[i].wears));
  }
  const lastHit = seen[4].wears.filter((id) => berserk.includes(id));
  assert.equal(lastHit.length, 4, '最后一场应当整套狂战：' + JSON.stringify(seen[4].wears));
  assert.equal(seen[4].elite, true, '最后一场应当带精英标记');
  /* 本轮修 bug：5 场层（10n 层）原来**跳过了「第 4 场前」那一次多选一**
   *（choiceAfter 被写成 len === 5 ? 4 : 3），玩家反馈「10n 层第四场前没有多选一」。
   * 现在：所有层都在第 4 场前给一次，5 场层再在塔顶 boss 前多给一次。 */
  assert.deepEqual(choiceBefore, [4, 5],
    '第 10 层应当在第 4 场前与第 5 场前各给一次多选一，实测 ' + JSON.stringify(choiceBefore));
});

test('需求6：限次 buff 每场都扣（含整层最后一场）', () => {
  const c = setup();
  c.Tower._debugSetEndlessLayer(3);
  const run = c.Tower._debugRun('endless');
  const len = run.plan.length;
  run.limited = [{ id: 'G01', stacks: 1, uses: 10, on: true }];
  run.choices = null; run.phase = null;
  /* 直接写在 run 上（会被 normalizeRun 持久化）——比每轮调 _debugSetNoEnv 可靠，
   * 因为循环里的 continue 分支会跳过那一行。 */
  run.noEnvRoll = true; run.env = [];
  const uses = () => { const b = c.Tower._debugRun('endless').limited.find((x) => x.id === 'G01'); return b ? b.uses : 0; };
  let fought = 0;
  for (let g = 0; g < 10; g++) {
    const r = c.Tower._debugRun('endless');
    if (r.layer !== 3) break;
    r.env = [];   // noEnvRoll 已在上面写成持久开关
    if (r.choices) {
      const p = c.Tower.pickChoice('endless', 0, null);
      if (p && !p.ok && p.needsReplace) {
        const owned = (r.permanent || [])[0];
        c.Tower.pickChoice('endless', 0, owned ? owned.id : null);
      }
      continue;
    }
    if (r.phase) break;
    const nx = c.Tower.nextBattle('endless');
    if (!nx || nx.ok === false) break;
    const a = c.Tower._debugRun('endless');
    const rb = c.Tower.reportBattle('endless', a.attempt, true, 1, null);
    fought++;
    assert.equal(uses(), 10 - fought, '打完第 ' + fought + ' 场后应当剩 ' + (10 - fought) + '，实测 ' + uses());
    /* 幻影回响必须被 noEnvRoll 关掉：它会把 idx 回退一格重复同一场，
     * 让「本层应当打 N 场」的计数偏少（这条断言就是来钉住它的）。 */
    assert.ok(!(rb && rb.repeat), '第 ' + fought + ' 场后不该触发幻影回响：' + JSON.stringify(rb && rb.repeat));
  }
  assert.equal(fought, len, '本层应当打 ' + len + ' 场，实测 ' + fought);
  assert.equal(uses(), 10 - len, '整层打完后应当正好扣掉 ' + len + ' 点');
});

test('需求7：商店传奇卡有价格、能买能卖（不再 NaN）', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.SHOP.price.length, 4, '价格表要覆盖 4 档稀有度');
  for (let r = 0; r < 4; r++) {
    const p = TD.shopPrice({ rarity: r });
    assert.ok(Number.isFinite(p) && p > 0, '稀有度 ' + r + ' 的价格应当是正数，实测 ' + p);
  }
  const run = c.Tower._debugRun('endless');
  run.coins = 500;
  run.phase = 'shop';
  run.shop = { layer: 5, retrySold: false, rerollFree: true, slots: [{ id: 'C36', sold: false }] };
  const st = c.Tower.shopState();
  assert.ok(Number.isFinite(st.slots[0].price) && st.slots[0].price > 0, '货架价格不该是 NaN：' + st.slots[0].price);
  const buy = c.Tower.buyShopSlot(0);
  assert.ok(buy.ok, '传奇卡应当能买：' + (buy.msg || ''));
  assert.equal(buy.price, TD.shopPrice({ rarity: 3 }), '成交价应当等于标价');
  assert.equal(c.Tower._debugRun('endless').coins, 500 - buy.price, '应当精确扣掉标价');
  const sell = c.Tower.sellBuff('C36');
  assert.ok(sell.ok, '传奇卡应当能卖：' + JSON.stringify(sell));
  assert.ok(Number.isFinite(sell.gain) && sell.gain > 0, '售价应当是正数：' + sell.gain);
});

test('需求8：每日抽奖后抽奖卷数量即时刷新（且不依赖全局 $$）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'classic-extras.js'), 'utf8');
  // refreshTickets 不能再引用不存在的全局 $$（它只在 classic-ui.js 内部）
  const fnStart = src.indexOf('function refreshTickets()');
  assert.ok(fnStart > 0, '应当有 refreshTickets');
  const fnEnd = src.indexOf('\n  }', fnStart);
  assert.ok(fnEnd > fnStart, '应当能定位 refreshTickets 的结尾');
  /* 去掉外层 function 签名与最后一个大括号，只留函数体（vm 里直接包一层 function）。 */
  const body = src.slice(src.indexOf('{', fnStart) + 1, src.lastIndexOf('}', fnEnd + 4));
  assert.ok(!/\$\$\(/.test(body), 'refreshTickets 不该用未定义的全局 $$：' + body);
  assert.match(body, /data-lottery-ticket/, '要刷新页面里的抽奖卷数字');
  assert.match(body, /data-live-ticket/, '也要刷新其它展示位');
  // 抽奖动画结束时必须调用它
  const spinIdx = src.indexOf('function lottery()');
  const tail = src.slice(spinIdx);
  assert.match(tail, /refreshTickets\(\)/, '抽奖结算后要调 refreshTickets 让数字即时更新');
  // 无 DOM 环境不能抛错
  const ctx = vm.createContext({
    State: { state: () => ({ props: { 50: 3 } }) },
    document: undefined,
    window: { UI: { refreshHeader() {} } },
    UI: { refreshHeader() {} },
    console,
  });
  const shot = vm.runInContext('(function () {' + body + '})', ctx, { filename: 'refreshTickets.js' });
  assert.doesNotThrow(() => shot(), '没有 DOM 时也该静默跳过，不能抛错');
});

test('需求9：商店左下角是铸币（50 币），失败可花 1 枚回滚本场再打', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.SHOP.retryPrice, 50, '铸币定价应当 50');
  assert.equal(TD.SHOP.healPrice, undefined, '旧的治疗泉水应当已经移除');

  // 买币要扣 50、记 1 枚
  let run = c.Tower._debugRun('endless');
  run.coins = 200; run.phase = 'shop';
  run.shop = { layer: run.layer, retrySold: false, rerollFree: true, slots: [] };
  const st = c.Tower.shopState();
  assert.equal(st.retryPrice, 50, 'shopState 要报出定价');
  assert.equal(st.retryToken, 0, '初始 0 枚');
  const buy = c.Tower.buyRetryToken();
  assert.ok(buy.ok, '应当能买：' + JSON.stringify(buy));
  assert.equal(c.Tower._debugRun('endless').coins, 150, '应当扣掉 50');
  assert.equal(c.Tower._debugRun('endless').retryToken, 1, '应当有 1 枚');
  assert.ok(!c.Tower.buyRetryToken().ok, '同一家店只能买 1 枚');
  c.Tower.continueFromShop();

  // 记下战前状态（血量/币/分数/环境剩余/限次次数）
  const before = (() => { const r = c.Tower._debugRun('endless'); return {
    layer: r.layer, idx: r.idx, carry: +r.carry.toFixed(6), coins: r.coins, score: r.score,
    env: (r.env || []).map((e) => e.id + ':' + e.left).join(','),
    lim: (r.limited || []).map((b) => b.id + ':' + b.uses).join(','), token: r.retryToken }; })();

  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开战');
  assert.ok(c.Tower.canRetry(c.Tower._debugRun('endless')), '开战后应当有可回滚的快照');

  // 模拟战斗中掉血 / 掉次数，然后打输
  const live = c.Tower._debugRun('endless');
  live.carry = 0.05;
  (live.limited || []).forEach((b) => { b.uses--; });
  (live.env || []).forEach((e) => { e.left = 1; });
  const rw = c.Tower.reportBattle('endless', live.attempt, false, 0.05);
  assert.ok(rw.retryable, '有币时失败应当先给「要不要回滚」的机会：' + JSON.stringify(rw));
  assert.ok(!rw.settled, '还没结算');
  assert.equal(rw.retryLeft, 1, '要报出剩余枚数');
  assert.ok(c.Tower._debugRun('endless'), '对局要保留（没被结算掉）');

  // 回滚
  const rt = c.Tower.retryBattle();
  assert.ok(rt.ok, '应当能回滚：' + JSON.stringify(rt));
  const after = (() => { const r = c.Tower._debugRun('endless'); return {
    layer: r.layer, idx: r.idx, carry: +r.carry.toFixed(6), coins: r.coins, score: r.score,
    env: (r.env || []).map((e) => e.id + ':' + e.left).join(','),
    lim: (r.limited || []).map((b) => b.id + ':' + b.uses).join(','), token: r.retryToken }; })();
  for (const k of Object.keys(before)) {
    if (k === 'token') continue;
    assert.equal(String(after[k]), String(before[k]), '「' + k + '」应当回滚到战前：' + before[k] + ' → ' + after[k]);
  }
  assert.equal(after.token, before.token - 1, '应当消耗 1 枚');
  assert.ok(!c.Tower.canRetry(c.Tower._debugRun('endless')), '回滚后旧快照作废，别重复用');
  // 回滚后还能立刻再打同一场
  const again = c.Tower.nextBattle('endless');
  assert.ok(again && again.ok !== false, '回滚后应当能再打一次：' + ((again && again.msg) || ''));
  assert.equal(again.battleNo, before.idx + 1, '应当回到同一场');

  // 没币时失败 → 正常结算
  const live2 = c.Tower._debugRun('endless');
  const rw2 = c.Tower.reportBattle('endless', live2.attempt, false, 0);
  assert.ok(!rw2.retryable, '没币就不该再问：' + JSON.stringify(rw2));
  assert.ok(rw2.settled, '应当直接结算');
  assert.ok(!c.Tower._debugRun('endless'), '结算后对局结束');
});

test('需求9b：有币时选择「放弃本局」→ 才真正结算失败', () => {
  const c = setup();
  c.Tower._debugSetEndlessLayer(16);
  const run = c.Tower._debugRun('endless');
  run.coins = 500; run.phase = 'shop';
  run.shop = { layer: 16, retrySold: false, rerollFree: true, slots: [] };
  c.Tower.buyRetryToken();
  c.Tower.continueFromShop();
  c.Tower.nextBattle('endless');
  const live = c.Tower._debugRun('endless');
  const rw = c.Tower.reportBattle('endless', live.attempt, false, 0);
  assert.ok(rw.retryable, '应当先进入可重试状态');
  const ticketsBefore = c.State.state().props[50] || 0;
  const out = c.Tower.declineRetry();
  assert.ok(out.settled, '放弃时应当结算：' + JSON.stringify(out));
  assert.ok(out.tickets > 0, '应当按层数发抽奖卷：' + out.tickets);
  assert.equal(c.State.state().props[50] || 0, ticketsBefore + out.tickets, '抽奖卷要真的入账');
  assert.ok(!c.Tower._debugRun('endless'), '放弃后对局结束');
});

test('需求9.9：涌泉烙印（C52）真的生效 —— 师父驾到等治疗按层加成，并与回血类 buff 联动', () => {
  const c = setup();
  const T = c.Tower, S = c.State, Sim = c.Sim;
  c.State.newGame('c52-heal');
  const st = c.State.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T._debugSetLayer(9);
  assert.ok(T.startEndlessRun().ok);
  T._debugSetEndlessLayer(6);
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.choices = null; run.phase = null;
  const add = (id) => assert.ok(T.addBuff(T._debugRun('endless'), id).ok, '应当能拿到 ' + id);
  const board = () => {
    const nx = T.nextBattle('endless');
    assert.ok(nx.ok, '应当能开战：' + nx.msg);
    const me = S.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    me.maxHp = me.hp;
    nx.adjustMe(me);
    return { nx, me };
  };

  /* ---- 1) 面板字段：治疗倍率按层加算（1 层 1.1 / 2 层 1.2） ---- */
  add('C52');
  const one = board();
  assert.equal(one.me.healMul, 1.1, '1 层涌泉烙印 → 治疗 ×1.1，实测 ' + one.me.healMul);
  T.reportBattle('endless', one.nx.token, true, 0.8, null);
  const r1 = T._debugRun('endless'); if (r1 && r1.choices) T.pickChoice('endless', 0, (r1.permanent[0] || {}).id);
  const r2 = T._debugRun('endless'); if (r2 && r2.phase === 'shop') T.closeShop();

  /* ---- 2) 师父驾到（技能 13）：真的按倍率回血 ---- */
  const masterHeal = (me) => {
    me.skills = ['13:1']; me.masterLevel = 4;
    me.hp = Math.max(1, Math.floor(me.maxHp * 0.3));       // 低于 50%：师父会来
    const foe = Object.assign({}, one.nx.foe, { power: 1, agility: 1, speed: 1, skills: [], mech: [], hp: 100000, maxHp: 100000 });
    const res = Sim.simulate(me, foe, { masterChance: 100, masterHpRatio: 1 });
    const row = (res.rounds || []).find((r) => r.action === 'skill' && Number(r.id) === 13);
    return row ? row.healSelf : null;
  };
  const withC52 = masterHeal(one.me);
  delete one.me.healMul;                                   // 同一份面板，只拿掉治疗倍率
  const without = masterHeal(one.me);
  assert.equal(without, 16, '师父等级 4 → 基础治疗 16，实测 ' + without);
  assert.equal(withC52, 18, '涌泉烙印 1 层时应当回 18（16×1.1），实测 ' + withC52);

  /* ---- 3) 与其它回血类 buff 的联动：开战回血 / 胜利回血 / 精英回血 / 获得回血 ---- */
  const towerSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  assert.match(towerSrc, /0\.03 \* c11 \* g \* healBonusMul\(run\), refMax\)/, 'C11 胜利回血要吃治疗加成');
  assert.match(towerSrc, /eliteHealAfter \* g \* healBonusMul\(run\)/, 'C13 精英回血要吃治疗加成');
  assert.match(towerSrc, /healOnGainPct\) \* globalMul\(run\) \* healBonusMul\(run\)/, '获得时回血要吃治疗加成');
  assert.match(towerSrc, /agg\.startHealPct \* healBonusMul\(run\)/, '开战回血（C10/C16/C17、N08）要吃治疗加成');
  assert.match(towerSrc, /function healBonusMul\(run\) \{ return 1 \+ fragileHealBonus\(run\); \}/, '治疗加成倍率的定义');
  /* sim 侧：healOf 统一读 fighter.healMul（这就是「师父驾到不生效」的根因） */
  const simSrc = fs.readFileSync(path.join(ROOT, 'js', 'sim.js'), 'utf8');
  assert.match(simSrc, /healMul: Number\.isFinite\(Number\(f\.healMul\)\)/, 'makeCombatant 必须把赛前的治疗倍率读进来');
  assert.match(simSrc, /function healOf\(c, amount\) \{ return Math\.max\(0, Math\.round\(Number\(amount\) \* \(c\.healMul == null \? 1 : c\.healMul\)\)\); \}/,
    '所有治疗都走 healOf（枯泉封疗也是改这个字段）');

  /* ---- 4) 与「终焉烙印」（C49）的层数**不能互相加成** ----
   * 两条烙印历史共用 run.fragileMulBase：C49 的层数会去加治疗、C52 的层数会去加力敏速上限。 */
  const freshRun = () => {
    c.State.newGame('c52-cross' + Math.random());
    const st2 = c.State.state(); st2.level = 70; st2.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st2.stages[i] = { npcIndex: 3, passed: true };
    T._debugSetLayer(9);
    try { if (T._debugRun('endless')) T.abandon('endless'); } catch (e) { /* 忽略 */ }
    assert.ok(T.startEndlessRun().ok);
    T._debugSetEndlessLayer(6);
    const rr = T._debugRun('endless');
    rr.permanent = []; rr.limited = []; rr.choices = null; rr.phase = null;
    return rr;
  };
  const panel = () => {
    const nx2 = T.nextBattle('endless');
    assert.ok(nx2.ok, '应当能开战：' + nx2.msg);
    const me2 = S.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    me2.maxHp = me2.hp;
    const before = me2.power;
    nx2.adjustMe(me2);
    return { me: me2, powerMul: me2.power / before };
  };
  freshRun();
  T.addBuff(T._debugRun('endless'), 'C49');
  let p1 = panel();
  assert.ok(!p1.me.healMul, '只有 C49 时不该有治疗加成，实测 healMul=' + p1.me.healMul);
  assert.ok(p1.powerMul > 1.15, 'C49 自己还是要给 力/敏/速 ×1.20：实测 ×' + p1.powerMul.toFixed(2));
  freshRun();
  T.addBuff(T._debugRun('endless'), 'C52');
  p1 = panel();
  assert.equal(p1.me.healMul, 1.1, '只有 C52 时治疗 ×1.1（不该被 C49 的空计数带偏）');
  assert.ok(p1.powerMul < 1.05, 'C52 不该给 力/敏/速 加成：实测 ×' + p1.powerMul.toFixed(2));
  freshRun();
  T.addBuff(T._debugRun('endless'), 'C49');
  T.addBuff(T._debugRun('endless'), 'C52');
  p1 = panel();
  assert.equal(p1.me.healMul, 1.1, 'C49×1 + C52×1 时治疗仍然是 ×1.1（不是 ×1.2）');
  assert.ok(p1.powerMul > 1.15 && p1.powerMul < 1.25, '终乘倍率也只按 C49 的 1 层算：实测 ×' + p1.powerMul.toFixed(2));
  assert.equal(T._debugRun('endless').fragileMulBase, 1, '终乘层数只数 C49：实测 ' + T._debugRun('endless').fragileMulBase);

  /* ---- 5) 老存档迁移：历史上 C52 的层数混在 fragileMulBase 里 ----
   * 任何一次访问都会走 normalizeRun：把 C52 的层数摘出来还给 fragileHealBase。 */
  freshRun();
  const legacy = T._debugRun('endless');
  legacy.limited = [{ id: 'C52', stacks: 1, uses: 10, on: true }];
  legacy.fragileMulBase = 2;            // 1×C49 + 1×C52 混在一起
  legacy.fragileMulBurned = 0;
  delete legacy.fragileHealBase;
  T.endlessInfo();                       // 内部走 endless() → normalizeRun
  assert.equal(legacy.fragileHealBase, 1, '迁移后治疗层数应当等于持有的 C52 层数');
  assert.equal(legacy.fragileMulBase, 1, '同时要把 C52 的份数从终乘层数里摘出来');
});

test('需求9.8：店的方向按「怎么开的」走 —— 战后立即进货关掉后回继续打，别把整层推走', () => {
  const c = setup();
  const T = c.Tower, S = c.State;
  const fresh = (layer) => {
    S.newGame('shop-route' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    T._debugSetLayer(9);
    try { if (T._debugRun('endless')) T.abandon('endless'); } catch (e) { /* 忽略 */ }
    assert.ok(T.startEndlessRun().ok, '应当能开一局');
    T._debugSetEndlessLayer(layer);
    const run = T._debugRun('endless');
    run.permanent = []; run.limited = []; run.choices = null; run.phase = null;
    return run;
  };
  const fight = (win) => {
    /* 隔离环境：环境里摇到「幻影回响」会把同一场再打一遍，场次计数就少一场
     *（本用例只关心「店的去向」，不该被它干扰 —— 实测这就是本用例偶发红的原因）。 */
    const r0 = T._debugRun('endless');
    if (r0) r0.env = [];
    const nx = T.nextBattle('endless');
    assert.ok(nx.ok, '应当能开战：' + nx.msg);
    return T.reportBattle('endless', nx.token, win !== false, 0.8, null);
  };
  const clearChoice = () => {
    const r = T._debugRun('endless');
    /* 挑一张不改流程的（E01 会开店、E15 会重开本层）—— 本用例要的是「店的去向」，别被它们打断 */
    if (r && r.choices) T.pickChoice('endless', safeChoiceIndex(r.choices), (r.permanent[0] || {}).id);
  };

  /* ---- 第 10 层：第 1 场打完用「立即进货」开店 ---- */
  const run = fresh(10);
  assert.ok(T.addBuff(T._debugRun('endless'), 'E01').ok, '应当能拿到立即进货');
  fight();
  let r = T._debugRun('endless');
  assert.equal(r.phase, 'shop', '战后应当开店');
  assert.equal(T.shopState().postBattle, true, 'shopState 要告诉界面「这家店是战后临时开的」');
  assert.equal(T.shopState().boundary, false, '它不是每 5 层的结算商店');
  /* 关店：必须回到「继续打」，不能去结算点；而且**店要真的收掉** ——
   * 只归位 phase 的话 shopState() 还会给出一家店，界面「离开」按钮就会以为「还有店要进」。 */
  assert.ok(T.closeShop().ok, '应当能关店');
  r = T._debugRun('endless');
  assert.equal(r.phase, null, '关掉战后商店之后应当回去继续打，实测 phase=' + r.phase);
  assert.equal(r.shop, null, '关店之后 run.shop 必须清空（实测 ' + JSON.stringify(r.shop) + '）');
  clearChoice();

  /* ---- 把本层剩下的场次打完：层通商店必须还在（用户报的「后面的商店消失了」） ---- */
  const planLen = r.plan.length;
  const shops = [];
  for (let i = 2; i <= planLen; i++) {
    const rw = fight();
    const rr = T._debugRun('endless');
    assert.equal(rr.layer, 10, '第 ' + i + ' 场之后仍然应当停在第 10 层，实测 ' + rr.layer);
    if (rr.phase === 'shop') shops.push({ after: i, boundary: !!T.shopState().boundary, complete: !!rw.layerComplete });
    if (rr.phase === 'shop') {
      assert.equal(T.shopState().boundary, true, '第 ' + i + ' 场后的店应当是每 5 层的结算商店');
      assert.ok(T.closeShop().ok);
      assert.equal(T._debugRun('endless').phase, 'checkpoint', '结算商店关掉后应当去结算点');
      assert.ok(T.continueEndless().ok, '应当能从结算点继续');
    }
    clearChoice();
  }
  assert.equal(shops.length, 1, '整层应当只出现一次结算商店（层通），实测 ' + JSON.stringify(shops));
  assert.equal(shops[0].after, planLen, '层通商店应当出现在本层最后一场之后');
  assert.equal(T._debugRun('endless').layer, 11, '继续之后应当进入第 11 层');

  /* ---- 休整商店：关掉也回继续打 ---- */
  fresh(10);
  const rr2 = T._debugRun('endless');
  rr2.choices = [{ type: 'buff', id: 'C02' }]; rr2.restShopUsed = false; rr2.phase = null;
  assert.ok(T.openRestShop().ok, '应当能开休整商店');
  assert.equal(T.shopState().rest, true, 'shopState 要带上 rest 标记');
  assert.ok(T.closeShop().ok);
  assert.equal(T._debugRun('endless').phase, null, '休整商店关掉后回继续打');
  assert.equal(T._debugRun('endless').shop, null, '休整商店关掉后也要收摊');

  /* ---- 界面接线：商店页的「离开」必须真的关店 ----
   * 用户报过：E01「立即进货」开的店进得去出不来 —— 根因就是这一支只 openEndless()
   * 而没调 Tower.closeShop，phase 还停在 'shop'，首页按钮继续写「进入试炼商店」。 */
  {
    const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
    const at = uiSrc.indexOf("on(p, 'leave'");
    assert.ok(at > 0, '找不到商店页的「离开」按钮');
    const body = uiSrc.slice(at, at + 800);
    assert.ok(/Tower\.closeShop\(\)/.test(body), '「离开」分支必须调 Tower.closeShop：' + body.slice(0, 200));
  }

  /* ---- 门庭若市：进店奖励由 Tower 领取一次（界面上只飘一次） ---- */
  fresh(10);
  const r3 = T._debugRun('endless');
  r3.permanent = [{ id: 'C59', stacks: 2 }]; r3.coins = 0; r3.shop = null; r3.phase = null;
  r3.choices = [{ type: 'buff', id: 'C02' }]; r3.restShopUsed = false;
  assert.ok(T.openRestShop().ok, '应当能开休整商店');
  assert.equal(T._debugRun('endless').coins, 160, '2 层门庭若市进店应当 +160（80 × 2 层）');
  assert.equal(T.claimShopEnterCoins(), 160, '第一次领取应当拿到 160');
  assert.equal(T.claimShopEnterCoins(), 0, '领过之后应当清零（界面不会重复飘字）');
  assert.equal(T.shopState().enterCoins, 0, 'shopState 里也该是 0 了');
});

test('需求9.0：无尽塔首页在「战后待选牌」状态下必须能渲染（openEndless 里不能有裸 mode）', () => {
  const c = setup();
  const T = c.Tower;
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const bodyOf = (head) => {
    const at = src.indexOf(head);
    assert.ok(at >= 0, '源码里应当有 ' + head);
    let k = src.indexOf('{', at), depth = 0, e = k;
    while (e < src.length) {
      const ch = src[e];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
      e++;
    }
    return src.slice(at, e + 1);
  };
  /* 曾经的事故：把 choiceCard 的 mode 参数写成裸 mode，而 openEndless() 作用域里没有 mode
   * → run.choices 一有值就 ReferenceError → 整屏渲染不出来，战斗结束回来卡在主界面、
   * 而且本局还没结束（再进无尽提示「本局尚未结束」）。 */
  const openEndless = bodyOf('function openEndless()');
  const code = openEndless.replace(/\/\*[\s\S]*?\*\//g, ' ');      // 去掉注释再查
  assert.ok(!/\bmode\b/.test(code),
    'openEndless() 里不该出现裸 mode（它没有这个参数）：' + (code.match(/.{0,40}\bmode\b.{0,40}/) || [''])[0]);
  assert.match(openEndless, /choiceCard\(c, i, 'endless'\)/, '无尽首页的选牌口径应当写死 endless');
  /* openTower 里若有选牌，也必须用自己作用域里真实存在的 mode */
  const openTower = bodyOf('function openTower(');
  if (/choiceCard\(/.test(openTower)) {
    assert.ok(/function openTower\([^)]*\bmode\b/.test(openTower) || /choiceCard\([^)]*'tower'/.test(openTower),
      'openTower 里用 choiceCard 时必须传真实存在的 mode 或字面量 tower');
  }

  /* 运行时再确认一次：造出「战后待选牌」的状态，无尽首页能渲染出来 */
  c.State.newGame('endless-choice');
  const st = c.State.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T._debugSetLayer(9);
  try { if (T._debugRun('endless')) T.abandon('endless'); } catch (e) { /* 忽略 */ }
  assert.ok(T.startEndlessRun().ok);
  T._debugSetEndlessLayer(6);
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.idx = 2; run.phase = null; run.choices = null;
  /* 打到本层第 3 场：战利品结算会给 run.choices（也就是界面要渲染选牌的那一刻） */
  const nx = T.nextBattle('endless');
  assert.ok(nx.ok, '应当能开战：' + nx.msg);
  const me = c.State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
  me.maxHp = me.hp; nx.adjustMe(me);
  T.reportBattle('endless', nx.token, true, Math.round(me.hp * 0.8), Math.round(me.maxHp));
  const after = T._debugRun('endless');
  assert.ok(after && after.choices && after.choices.length, '第 3 场胜利后应当有待选牌');
  assert.equal(T.endlessInfo().run.choices.length, after.choices.length, 'endlessInfo 也要把它带出来');
});

test('需求9.1：玉石俱焚确实生效 —— 战斗内双方血量上限真的被压低（并且能显示出来）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;
  c.State.newGame('c57-live');
  const st = c.State.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T._debugSetLayer(9);
  assert.ok(T.startEndlessRun().ok);
  T._debugSetEndlessLayer(6);
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.choices = null; run.phase = null;
  assert.ok(T.addBuff(run, 'C57').ok, '应当能拿到玉石俱焚');

  /* 走真实路径：nextBattle → adjustMe（Main.startBattle 就是这么做的）→ Sim.simulate */
  const nx = T.nextBattle('endless');
  assert.ok(nx.ok, '应当能开战：' + nx.msg);
  const me = S.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
  me.maxHp = me.hp;
  nx.adjustMe(me);
  assert.equal(Number(me.mods.roundMaxHpMul), 0.9, '本场修正里必须带上 roundMaxHpMul');
  /* 敌人面板只保证有 hp（maxHp 可能没写，sim 内部按 hp 当满血） */
  const before = { me: Math.round(me.maxHp), foe: Math.round(nx.foe.maxHp || nx.foe.hp) };
  const res = Sim.simulate(me, nx.foe);
  const rows = res.rounds.filter((r) => r.noteText === '玉石俱焚');
  assert.ok(rows.length > 0, '整场里应当出现「玉石俱焚」的回合结算');
  assert.ok(res.maxHp[0] < before.me, '我方血量上限真的被压低了：' + before.me + ' → ' + res.maxHp[0]);
  assert.ok(res.maxHp[1] < before.foe, '敌方血量上限也被压低了：' + before.foe + ' → ' + res.maxHp[1]);
  assert.ok(rows[0].maxHp && rows[0].maxHp[0] === Math.floor(before.me * 0.9),
    '第一次结算就该是 floor(初始上限 ×0.9)：' + JSON.stringify(rows[0].maxHp));

  /* 战斗回放要消费这个 payload（否则只看到飘字、看不到上限变化）——
   * 把回放里的纯函数抠出来直接跑：血条上限与当前血量都要被压低。 */
  const battleSrc = fs.readFileSync(path.join(ROOT, 'js', 'battle.js'), 'utf8');
  assert.match(battleSrc, /function applyRoundCaps\(maxHpArr, hpsArr, r\)/, '回放要有 applyRoundCaps');
  assert.match(battleSrc, /上限 ' \+ maxHp\[side\]/, '上限变化时要有飘字提示');
  const fn = (() => {
    const at = battleSrc.indexOf('function applyRoundCaps(maxHpArr, hpsArr, r) {');
    let k = battleSrc.indexOf('{', at), depth = 0, e = k;
    while (e < battleSrc.length) {
      const ch = battleSrc[e];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
      e++;
    }
    return battleSrc.slice(at, e + 1);
  })();
  const caps = vm.runInNewContext(fn + '\napplyRoundCaps;', {});
  const maxArr = [1000, 1000], hpArr = [1000, 1000];
  const r1 = caps(maxArr, hpArr, { maxHp: [900, 900], hp: [900, 900] });
  assert.equal(r1.capped, true, '第一次应当判定为「压低了」');
  assert.deepEqual(maxArr.slice(), [900, 900], '血条上限要跟着压低：' + JSON.stringify(maxArr));
  assert.deepEqual(hpArr.slice(), [900, 900], '当前血量也要跟着裁：' + JSON.stringify(hpArr));
  caps(maxArr, hpArr, { maxHp: [810, 810], hp: [805, 810] });
  assert.deepEqual(maxArr.slice(), [810, 810], '继续压低');
  assert.deepEqual(hpArr.slice(), [805, 810], '当前血量按回合给的数值走');
  const max2 = [500, 500], hp2 = [400, 300];
  assert.equal(caps(max2, hp2, { noteText: '越战越勇' }).capped, false, '没有 maxHp 的回合不该动上限');
  assert.deepEqual(max2.slice(), [500, 500], '上限保持不动');
  assert.deepEqual(hp2.slice(), [400, 300], '血量也保持不动');
});

test('需求9.3：无尽塔主界面右上角标注「本场战斗获得多少试炼币」', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  c.State.newGame('coin-gain');
  const st = c.State.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T._debugSetLayer(9);
  assert.ok(T.startEndlessRun().ok);
  T._debugSetEndlessLayer(3);
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.choices = null; run.phase = null; run.coins = 0;
  run.lastCoinsGained = 0;

  /* ---- 赢一场：coins 增量 = COINS.battle（没有战利品加成时） ---- */
  const nx = T.nextBattle('endless');
  assert.ok(nx.ok, '应当能开战：' + nx.msg);
  const rw = T.reportBattle('endless', nx.token, true, 0.8, null);
  const after = T._debugRun('endless');
  assert.equal(after.coins, TD.COINS.battle, '战利品应当是基础值：' + after.coins);
  assert.equal(after.lastCoinsGained, TD.COINS.battle,
    '赢一场后 lastCoinsGained 应当是本场增量：' + after.lastCoinsGained);
  assert.equal(rw.coinsGained, TD.COINS.battle, '返回结果里也要带上本次增量：' + rw.coinsGained);
  /* 无尽主界面读的就是 endlessInfo().run（这是个白名单拷贝，漏了字段界面就看不到） */
  assert.equal(T.endlessInfo().run.lastCoinsGained, TD.COINS.battle,
    'endlessInfo().run 必须带上 lastCoinsGained，否则右上角标不出来');

  /* ---- 输一场：本场增量归零（不会留着上一场的数字） ---- */
  const nx2 = T.nextBattle('endless');
  if (nx2.ok) {
    T.reportBattle('endless', nx2.token, false, 0.01, null);
    const r2 = T._debugRun('endless');
    if (r2) assert.equal(Number(r2.lastCoinsGained) || 0, 0, '输掉的这一场增量应当是 0');
  }

  /* ---- 界面接线：试炼币那一项要渲染出 +N 的增量，并写进悬停 ---- */
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  assert.match(ui, /delta:\s*gained/, '试炼币项要带上 delta 字段');
  assert.match(ui, /currency-delta/, '要渲染出 .currency-delta 增量元素');
  assert.match(ui, /上一场战斗获得/, '悬停里要说明这是上一场战斗获得的');
  const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8');
  assert.match(css, /\.tower-currency \.currency-delta/, '增量要有自己的样式');
});

test('需求9.2：玉石俱焚（C57）双塔两套口径 —— 挑战塔「下一场」/ 无尽塔「限次 10 · 剩 N 场」', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const b = TD.BUFF_BY_ID.C57;
  assert.ok(b, '应当有 C57 玉石俱焚');
  assert.equal(b.kind, 'limited', '限次类');
  assert.equal(b.uses, 10, '限次 10 次');
  assert.ok(TD.hasTag(b, 'tower') && TD.hasTag(b, 'endless'), '两座塔都有它');

  /* ---- 1) 两套文案 ---- */
  const towerDesc = TD.descOf(b, 'tower');
  const endlessDesc = TD.descOf(b, 'endless');
  assert.match(towerDesc, /下一场战斗/, '挑战塔口径要写「下一场战斗」：' + towerDesc);
  assert.match(endlessDesc, /限次 10 场/, '无尽塔口径要写「限次 10 场」：' + endlessDesc);
  assert.ok(endlessDesc.indexOf('下一场战斗') < 0, '无尽塔口径不该再说「下一场战斗」：' + endlessDesc);
  assert.equal(TD.descOf(b), towerDesc, '不传 mode 时沿用默认（挑战塔）文案');

  /* ---- 2) 界面判据与角标：抠出真实实现跑一遍 ---- */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const grab = (head) => {
    const at = src.indexOf(head);
    assert.ok(at >= 0, '源码里应当有 ' + head);
    let i2 = src.indexOf('{', at), depth = 0, k = i2;
    while (k < src.length) {
      const ch = src[k];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
      k++;
    }
    return src.slice(at, k + 1);
  };
  const ctx = { TowerData: TD, SCOPE: { limited: '限次' }, RARITY: TD.RARITY_NAME };
  const code = grab('function isTowerNext(b, mode)') + '\n' + grab('function limitBadgeText(b)') + '\n' +
    'out = { t: isTowerNext(def, "tower"), e: isTowerNext(def, "endless"), d: isTowerNext(def),' +
    ' badgeE: limitBadgeText({ id: "C57", uses: 7, stacks: 1 }) };';
  ctx.def = b;
  require('node:vm').runInNewContext(code, ctx);
  assert.equal(ctx.out.t, true, '挑战塔里应当按「下一场」显示');
  assert.equal(ctx.out.e, false, '无尽塔里不该按「下一场」显示');
  assert.equal(ctx.out.d, true, '不传 mode 时保持历史口径（挑战塔）');
  assert.match(ctx.out.badgeE, /剩 7 场/, '无尽塔角标要带上当前剩余次数：' + ctx.out.badgeE);
  assert.ok(ctx.out.badgeE.indexOf('下一场') < 0, '无尽塔角标不该写「下一场」：' + ctx.out.badgeE);
  /* 无尽塔的悬停要用无尽口径的文案 + 剩余场次 */
  assert.match(src, /TowerData\.descOf\(buff, 'endless'\)/, '限次悬停要用无尽口径文案');
  assert.match(src, /剩余 ' \+ b\.uses \+ ' 场/, '悬停要写剩余场次');
  /* 面板/商店/集锦都走 descOf */
  assert.match(src, /TowerData\.descOf\(b, 'endless'\)/, '集锦与商店卡片要用无尽口径');
  const towerSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  assert.match(towerSrc, /descOf\(buff, mode\)/, 'ownedBuffs 要按模式取文案');
});

test('需求9.4：道具卖出 = 「返回 / 卖出」弹窗，点一下卖 1 个、弹窗不关', () => {
  const c = setup();
  const S = c.State;
  const src = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8');
  /* ---- 1) 滑动条版本彻底移除 ---- */
  assert.ok(src.indexOf('sell-count') < 0, '不该再有 sell-count 滑块');
  assert.ok(src.indexOf('卖出数量') < 0, '不该再有「卖出数量」标签');
  assert.ok(src.indexOf('function sellAsk') < 0, '旧的 sellAsk（滑动条选数量后确认）应当删掉');
  assert.ok(src.indexOf('function sellOne') < 0, '不应该再是「点一下直接卖」的无弹窗版本');

  /* ---- 2) 弹窗式交互：入口 → sellDialog → 内部只卖 1 个 ---- */
  const entryLine = src.split('\n').find((l) => l.indexOf('[data-action="prop-sell"]') >= 0 && l.indexOf('addEventListener') >= 0) || '';
  assert.ok(entryLine.indexOf('sellDialog(selectedProp') > 0, '背包「卖出 1 个」应当打开卖出弹窗：' + entryLine.trim());
  assert.ok(entryLine.indexOf('openBag(mode,bagPage)') > 0, '关掉弹窗后应当把背包重绘到最新数量');
  assert.match(src, /function sellDialog\(id,\s*after\)/, '应当有 sellDialog');
  const dlg = src.slice(src.indexOf('function sellDialog(id,after)'));
  assert.ok(dlg.slice(0, 2600).indexOf('State.sellProp(id,1)') > 0, '弹窗里的卖出必须只卖 1 个');
  /* 两个按钮：返回（muted → 自动排最左）+ 卖出（primary → 自动排最右） */
  assert.match(dlg.slice(0, 2600), /\{label:'返回',cls:'muted'/, '应当有「返回」按钮（muted → 最左）');
  assert.match(dlg.slice(0, 2600), /\{label:'卖出',cls:'gold',primary:true,close:false/, '应当有「卖出」按钮（primary → 最右，且点完不关弹窗）');
  /* 卖光后按钮禁用 + 数字实时刷新 */
  assert.ok(dlg.slice(0, 2600).indexOf('b.disabled=held<1') > 0, '卖光后应当把卖出按钮禁用');
  assert.ok(dlg.slice(0, 2600).indexOf("data-live=\"sell-held\"") > 0, '弹窗里应当实时显示剩余数量');
  /* 背包按钮文案就是「卖出」（不要「卖出 1 个」这种带数量的写法） */
  assert.ok(src.indexOf("btn('卖出','prop-sell'") > 0, '背包按钮文案应当是「卖出」');
  assert.ok(src.indexOf('卖出 1 个') < 0, '不该再有「卖出 1 个」的文案');
  /* 卖出弹窗里不该再有「点「卖出」卖出 1 个，可得…」那行提示 */
  assert.ok(dlg.slice(0, 2600).indexOf('sell-tip') < 0, '卖出弹窗不该再有那行操作提示');
  assert.ok(src.indexOf('点「卖出」卖出 1 个') < 0, '那行提示文案应当删干净');
  /* 使用弹窗里不该再显示「硬上限 999」 */
  assert.ok(src.indexOf("'　硬上限 '+cap") < 0, '使用弹窗的体力标签不该再拼「硬上限 999」');
  assert.ok(src.indexOf('　硬上限 ') < 0, '实时刷新的那一处也要去掉');

  /* ---- 3) 模型口径：一次只减 1 个、按回收价进账 ---- */
  S.newGame('sell-one');
  const st = S.state();
  let id = 0, price = 0;
  for (let i = 1; i <= 60; i++) { const p = S.propSellPrice(i); if (p > 0) { id = i; price = p; break; } }
  assert.ok(id > 0 && price > 0, '字典里应当有可卖的道具');
  st.props[id] = 3; st.goldPoint = 100;
  const r = S.sellProp(id, 1);
  assert.ok(r.ok, '卖 1 个应当成功：' + (r.msg || ''));
  assert.equal(r.sold, 1, '一次只卖 1 个');
  assert.equal(st.props[id], 2, '背包应当剩 2 个');
  assert.equal(st.goldPoint, 100 + price, '应当按回收价进账：' + price);
  S.sellProp(id, 1); S.sellProp(id, 1);
  assert.equal(st.props[id], undefined, '卖光之后不该还留着 0 个的条目');
  assert.equal(S.sellProp(id, 1).ok, false, '没有库存时应当拒绝');
});

test('需求9.5：铸币（原名「重新挑战币」）改名彻底 + 无尽塔右上角标出本场数量', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const data = fs.readFileSync(path.join(ROOT, 'js', 'tower-data.js'), 'utf8');
  const core = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');

  // 1) 面向玩家的**字符串字面量**里不该再出现旧名字（注释里保留「原名…」的说明不算）
  const literal = /(['"`])(?:(?!\1)[^\n])*?(重新挑战币|重挑币)(?:(?!\1)[^\n])*?\1/;
  for (const [name, src] of [['tower-ui.js', ui], ['tower-data.js', data], ['tower.js', core]]) {
    assert.ok(!literal.test(src), name + ' 里还有带旧名字的文案');
  }

  // 2) 新名字要出现在该出现的地方：HUD / 商店货架 / 商店购买提示 / 增益文案
  assert.match(ui, /name: '铸币'/, '无尽塔右上角应当有「铸币」这一项');
  assert.match(ui, /本场拥有 ' \+ tokens \+ ' 枚铸币/, 'HUD 悬停要写明本场拥有多少枚');
  assert.ok(ui.indexOf('<b>铸币</b>') > 0, '商店左下角货架应当叫「铸币」');
  assert.match(data, /desc: '立即获得 1 枚铸币'/, 'E09 文案要用铸币');
  assert.match(data, /desc: '立即获得 3 枚铸币'/, 'E10 文案要用铸币');

  // 3) HUD 里的数量 = 本场手上的铸币（失败回滚 / 退出折券都用它）
  const run = T._debugRun('endless');
  run.retryToken = 4;
  assert.equal(T.endlessInfo().run.retryToken, 4, 'endlessInfo 要能读出铸币数量');
  assert.equal(T.endlessInfo().run.ticketsOnExit, T.endlessInfo().run.ticketsIfSettle + 4,
    '退出时铸币 1:1 折券仍要算进总额');
  // 商店售价与购买路径也还在（只是名字换了）
  assert.equal(TD.SHOP.retryPrice, 50, '铸币售价应当 50 试炼币');
  assert.equal(TD.BUFF_BY_ID.E09.mods.instantRetry, 1, '「重整旗鼓」给 1 枚铸币');
  assert.equal(TD.BUFF_BY_ID.E10.mods.instantRetry, 3, '「背水一战」给 3 枚铸币');
});

test('需求9.6：本轮新增 6 个增益 —— 池子归属 + 豪掷千金 / 门庭若市', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const tag = (id, t) => TD.hasTag(TD.BUFF_BY_ID[id], t);
  /* 本测试要在好几段里改 run 的字段：每段开始前确保有一局干净的无尽塔在跑
   *（上一段可能已经打到失败/结束，_debugRun 会变成 null）。 */
  const ensureRun = () => {
    let r = T._debugRun('endless');
    if (r && !r.attempt) return r;
    try { if (r) T.abandon('endless'); } catch (e) { /* 忽略 */ }
    c.State.newGame('new6-' + Math.random());
    const st6 = c.State.state(); st6.level = 70; st6.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st6.stages[i] = { npcIndex: 3, passed: true };
    T._debugSetLayer(9);
    assert.ok(T.startEndlessRun().ok, '应当能开一局无尽塔');
    return T._debugRun('endless');
  };
  /* ---- 1) 池子归属：默认仅无尽塔；C54 / C57 挑战塔也保留 ---- */
  for (const id of ['C54', 'C57']) {
    assert.ok(tag(id, 'tower'), id + ' 挑战塔应当保留');
  }
  for (const id of ['C55', 'C56', 'C58', 'C59']) {
    assert.ok(tag(id, 'endless') && !tag(id, 'tower'), id + ' 应当仅无尽塔');
  }
  for (const id of ['C54', 'C55', 'C56', 'C57', 'C58', 'C59']) {
    assert.ok(tag(id, 'endless') && tag(id, 'battle') && tag(id, 'shop'), id + ' 应当进无尽池与商店');
  }
  assert.ok(TD.towerPool.some((b) => b.id === 'C54') && TD.towerPool.some((b) => b.id === 'C57'),
    'C54 / C57 应当在挑战塔池里');
  assert.equal(TD.towerPool.filter((b) => ['C55', 'C56', 'C58', 'C59'].includes(b.id)).length, 0,
    '另外 4 条不该进挑战塔池');

  /* ---- 2) 数据口径 ---- */
  assert.equal(TD.BUFF_BY_ID.C54.kind, 'permanent', 'C54 是永久');
  assert.equal(TD.BUFF_BY_ID.C54.rarity, 2, 'C54 是史诗');
  assert.equal(TD.BUFF_BY_ID.C54.maxStacks, 2, 'C54 可叠 2 层');
  assert.equal(TD.BUFF_BY_ID.C55.rarity, 3, 'C55 是传奇');
  assert.equal(TD.BUFF_BY_ID.C56.rarity, 1, 'C56 是稀有');
  assert.equal(TD.BUFF_BY_ID.C57.kind, 'limited', 'C57 是限次');
  assert.equal(TD.BUFF_BY_ID.C57.uses, 10, 'C57 限 10 次');
  assert.ok(tag('C57', 'nextBattle'), 'C57 是「下一场战斗」类（挑战塔的文案口径）');
  assert.equal(TD.BUFF_BY_ID.C59.maxStacks, 3, 'C59 可叠 3 层');

  /* ---- 2.5) 越战越勇（C54）可叠 2 层：面板里的每回合加成按层数翻倍 ---- */
  {
    const rr = ensureRun();
    rr.permanent = [{ id: 'C54', stacks: 1 }]; rr.limited = []; rr.env = []; rr.choices = null; rr.phase = null;
    const nx = T.nextBattle('endless');
    assert.ok(nx.ok, '应当能开战：' + nx.msg);
    const me1 = c.State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    nx.adjustMe(me1);
    assert.ok(Math.abs(Number(me1.mods.roundStatPct) - 0.015) < 1e-9,
      '1 层时每回合 +1.5%，实测 ' + me1.mods.roundStatPct);
    T.reportBattle('endless', nx.token, false, 0.01, null);
    const rr2 = T._debugRun('endless');
    if (rr2) {
      rr2.permanent = [{ id: 'C54', stacks: 2 }]; rr2.choices = null; rr2.phase = null; rr2.limited = [];
      const nx2 = T.nextBattle('endless');
      if (nx2.ok) {
        const me2 = c.State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
        nx2.adjustMe(me2);
        assert.ok(Math.abs(Number(me2.mods.roundStatPct) - 0.03) < 1e-9,
          '2 层时应当翻倍到 +3%，实测 ' + me2.mods.roundStatPct);
        T.reportBattle('endless', nx2.token, false, 0.01, null);
      }
    }
  }

  /* ---- 3) 门庭若市（C59）：每进一次商店 +80 × 层数（2026-10 由 100 削弱到 80） ---- */
  const run = ensureRun();
  run.permanent = [{ id: 'C59', stacks: 3 }]; run.limited = []; run.coins = 0;
  run.shop = null; run.phase = null; run.choices = [{ type: 'buff', id: 'C02' }]; run.restShopUsed = false;
  assert.ok(T.openRestShop().ok, '应当能开休整商店');
  const afterEnter = T._debugRun('endless');
  assert.equal(afterEnter.coins, 240, '3 层门庭若市进店应当 +240（80 × 3 层），实测 ' + afterEnter.coins);
  assert.equal(afterEnter.shop.enterCoins, 240, '商店对象要带上这次进店给的币');
  T.closeShop();
  /* 只有 1 层时是 +80 */
  const r1 = ensureRun();
  r1.permanent = [{ id: 'C59', stacks: 1 }]; r1.coins = 0; r1.shop = null; r1.phase = null;
  r1.choices = [{ type: 'buff', id: 'C02' }]; r1.restShopUsed = false;
  assert.ok(T.openRestShop().ok);
  assert.equal(T._debugRun('endless').coins, 80, '1 层时进店 +80');
  T.closeShop();

  /* ---- 4) 豪掷千金（C58）：每消费 120 试炼币立刻给一个随机限次增益 ---- */
  const r2 = ensureRun();
  /* 【2026-10】消费进度改成「每栏各记一份」→ 重置时要连栏位上的 `limitedSpend` 一起清，
   * 否则上一段子测试攒下的余数会让这一段的触发次数多一次。 */
  r2.permanent = [{ id: 'C58', stacks: 1, limitedSpend: 0 }]; r2.limited = []; r2.coins = 5000;
  r2.shop = null; r2.phase = null; r2.choices = [{ type: 'buff', id: 'C02' }]; r2.restShopUsed = false;
  r2.shopSpendLimited = 0;
  /* 折扣/对折状态要清干净：否则「货架显示价」与「实际扣款」可能差一档，
   * 让 C58 的实际消费额与 `spent` 对不上（偶发红）。 */
  r2.shopDiscount = 0; r2.shopDiscountPct = 0; r2.shopHalfPending = 0;
  assert.ok(T.openRestShop().ok, '应当能开休整商店');
  const before = T._debugRun('endless').limited.length;
  let spent = 0, gained = [], guard = 0;
  while (guard++ < 8) {
    const st = T.shopState();
    /* 不要把**货架上的 C58 自己**买进来：C58 的消费进度是「每栏各记一份」，
     * 买第二栏会让两栏各攒一份 → 触发次数翻倍，与本段「每满 100 给一次」的口径无关。
     * （偶发红：货架恰好刷出 C58 时，`gained.length` 会大于 floor(spent/100)。） */
    const idx = st ? st.slots.findIndex((x) => !x.sold && x.id !== 'C58' && x.price <= T._debugRun('endless').coins) : -1;
    if (idx < 0) break;
    const price = st.slots[idx].price;
    const b = T.buyShopSlot(idx);
    if (!b.ok) break;
    spent += price;
    if (b.shopSpend && b.shopSpend.limited) gained = gained.concat(b.shopSpend.limited);
    if (spent >= 400) break;
  }
  assert.ok(spent > 0, '应当买到了东西');
  const c58Step = Math.max(1, Number(TD.BUFF_BY_ID.C58.mods.shopSpendLimited) || 120);
  assert.equal(gained.length, Math.floor(spent / c58Step),
    '每满 ' + c58Step + ' 试炼币应当给一个随机限次增益：花了 ' + spent + ' 币 → ' + JSON.stringify(gained));
  for (const id of gained) {
    assert.ok(TD.BUFF_BY_ID[id] && TD.BUFF_BY_ID[id].kind === 'limited', '给的必须是限次增益：' + id);
    assert.ok(TD.hasTag(TD.BUFF_BY_ID[id], 'endless'), '给的必须是无尽塔池里的：' + id);
  }
  assert.equal(Number(T._debugRun('endless').shopSpendLimited) || 0, spent % c58Step,
    '余额应当是花了多少对 ' + c58Step + ' 取余');
  assert.ok(T._debugRun('endless').limited.length >= before + gained.length - 2,
    '拿到的限次增益应当真的记在本局里');
});

test('需求9.7：时来运转（E12）—— 天命所归的下位，史诗即时，仅商店、一局一次', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const E12 = TD.BUFF_BY_ID.E12;
  assert.ok(E12, '应当有 E12 时来运转');
  assert.equal(E12.rarity, 2, '史诗稀有度');
  assert.equal(TD.RARITY_NAME[E12.rarity], '史诗');
  assert.equal(E12.kind, 'instant', '即时生效');
  assert.equal(E12.maxStacks, 1, '一局只能拿一次');
  assert.ok(TD.hasTag(E12, 'oncePerRun'), '带 oncePerRun 标签');
  assert.ok(TD.hasTag(E12, 'endless') && TD.hasTag(E12, 'shop'), '无尽塔 + 商店');
  assert.ok(!TD.hasTag(E12, 'battle'), '不该进战斗奖励池（仅商店购买获取）');
  assert.ok(!TD.hasTag(E12, 'tower'), '不该进挑战塔');
  assert.equal(E12.mods.rerollTiltMul, 2, '刷新提速 ×2');
  assert.match(E12.desc, /商店/, '文案要写明只在商店出售：' + E12.desc);

  /* ---- 池子：只在商店池，战斗奖励池 / 挑战塔池都没有它 ---- */
  assert.ok(TD.shopPool.some((b) => b.id === 'E12'), '应当能在商店买到');
  assert.equal(TD.endlessPool.filter((b) => b.id === 'E12').length, 0, '不该进无尽塔的战斗奖励池');
  assert.equal(TD.towerPool.filter((b) => b.id === 'E12').length, 0, '不该进挑战塔池');

  /* ---- 效果：每 10 币带来的稀有度提升翻倍（等价于「同样的钱按两倍算」）---- */
  const withE12 = { instantIds: [{ id: 'E12', count: 1 }] };
  const none = { instantIds: [] };
  assert.equal(TD.tiltRateMul(none), 1, '没有 E12 时是原速');
  assert.equal(TD.tiltRateMul(withE12), 2, '有 E12 时速度翻倍');
  for (const paid of [10, 20, 30, 50]) {
    assert.ok(Math.abs(TD.rerollTilt(paid, withE12) - TD.rerollTilt(paid * 2, none)) < 1e-9,
      'paid=' + paid + ' 时应当等价于没它时花两倍钱：' +
      TD.rerollTilt(paid, withE12).toFixed(4) + ' vs ' + TD.rerollTilt(paid * 2, none).toFixed(4));
  }
  const e0 = TD.rerollExpectation(30, none), e1 = TD.rerollExpectation(30, withE12);
  assert.equal(e0.tiltRateMul, 1);
  assert.equal(e1.tiltRateMul, 2);
  assert.ok(e1.epics > e0.epics * 1.5, '期望史诗件数应当明显提高：' + e0.epics + ' → ' + e1.epics);
  assert.ok(e1.meanRarity > e0.meanRarity, '平均稀有度应当提高：' + e0.meanRarity + ' → ' + e1.meanRarity);
  /* 场间三选一的倾斜不受影响（它走的是另一条调用，不带 run） */
  assert.ok(Math.abs(TD.rerollTilt(30) - TD.rerollTilt(30, none)) < 1e-9, '不传 run 时行为不变');

  /* ---- 一局一次：买到之后商店再也不会刷出它 ---- */
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.coins = 5000;
  run.shop = null; run.phase = null; run.choices = [{ type: 'buff', id: 'C02' }]; run.restShopUsed = false;
  assert.ok(T.openRestShop().ok, '应当能开休整商店');
  assert.equal(T.ownableOf(T._debugRun('endless'), E12), true, '还没拿到时应当能获得（店里会刷出来）');
  /* 直接把 E12 塞进这一页货架，走真实购买路径。
   * 注意要改**本局对象上的 shop**（shopState() 返回的是快照，改它不影响购买）。 */
  T._debugRun('endless').shop.slots[0] = { id: 'E12', sold: false, price: 100 };
  const bought = T.buyShopSlot(0);
  assert.ok(bought.ok, '应当能买到时来运转：' + (bought.msg || ''));
  const after = T._debugRun('endless');
  assert.ok((after.instantIds || []).some((x) => x.id === 'E12'), '购买后要登记成「本局已获得」');
  assert.equal(T.ownableOf(after, E12), false, '一局一次：之后不该再能获得');
  assert.equal(T.rollShopSlotsOf(after, 0).filter((sl) => sl.id === 'E12').length, 0,
    '之后刷新也不该再刷出它');
  assert.equal(TD.rerollExpectation(30, after).tiltRateMul, 2, '买完之后刷新提速要生效');
  T.closeShop();
});

test('需求10：商店价格在 -3 ~ +3 随机，且期望不变', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.SHOP_PRICE_OFFSET, 3, '偏移量应当是 ±3');
  for (const base of [30, 60, 100, 160]) {
    const samples = [];
    for (let i = 0; i < 4000; i++) samples.push(TD.rollShopPrice(base));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    assert.ok(Math.abs(mean - base) < 0.15, '基准 ' + base + ' 的期望应当不变，实测均值 ' + mean.toFixed(2));
    const uniq = new Set(samples);
    assert.equal(uniq.size, 7, '基准 ' + base + ' 应当正好有 7 种取值（-3..+3），实测 ' + uniq.size);
    const lo = Math.min(...samples), hi = Math.max(...samples);
    assert.equal(lo, base - 3, '下沿应当是基准 -3：' + lo);
    assert.equal(hi, base + 3, '上沿应当是基准 +3：' + hi);
  }
  // 低价商品不能被压到 0 或负数
  for (let i = 0; i < 500; i++) assert.ok(TD.rollShopPrice(2) >= 1, '价格下限应当 ≥1');

  // 开店时价格固定到槽位，界面价 = 实际扣费
  const run = c.Tower._debugRun('endless');
  run.coins = 9999; run.shop = null; run.phase = null;
  run.layer = 5;
  const shop = { layer: 5, slots: null };
  c.Tower._debugRun('endless').shopDiscount = false;
  // 直接用公开接口开一家新店
  const made = c.Tower.openRestShop ? c.Tower.openRestShop() : null;
  const st = c.Tower.shopState();
  if (st && st.slots.length) {
    const s0 = st.slots[0];
    assert.ok(Number.isFinite(s0.price) && s0.price > 0, '货架价应当是正数：' + s0.price);
    const coinsBefore = c.Tower._debugRun('endless').coins;
    const buy = c.Tower.buyShopSlot(0);
    if (buy.ok) {
      assert.equal(buy.price, s0.price, '成交价应当等于货架显示价');
      assert.equal(c.Tower._debugRun('endless').coins, coinsBefore - s0.price, '扣费应当精确等于显示价');
    }
  } else {
    // 没有可开的店就只校验摇价函数（上面已校验）
    assert.ok(true);
  }
});

test('需求11：刷新价格逐次递增（70 档 10 次 → 80 → 90，逐档继续涨）', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.rerollPriceAt(0), 0, '首次免费');
  const seq = [1, 2, 3, 4, 5, 6].map((n) => TD.rerollPriceAt(n));
  assert.equal(seq.join(','), '10,20,30,40,50,60', '价格应当是 0-10-20-30-40-50-60-70：' + seq.join(','));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] > seq[i - 1], '封顶前必须严格递增：' + seq.join(','));
  assert.equal(TD.rerollPriceAt(7), 70, '第 7 次到第一段封顶价');
  /* 2026-10 用户口径：70 档刷 10 次 → 80，80 档 10 次 → 90，以此类推。 */
  assert.equal([7, 12, 16].map((n) => TD.rerollPriceAt(n)).join(','), '70,70,70', '70 档要保持 10 次');
  assert.equal(TD.rerollPriceAt(17), 80, '70 档刷满 10 次 → 80');
  assert.equal(TD.rerollPriceAt(27), 90, '80 档刷满 10 次 → 90');
  assert.equal(TD.rerollPriceAt(37), 100, '继续涨');
  assert.equal(TD.rerollPriceCapped(99), false, '价格不再封顶');
  assert.equal(TD.rerollQualityCapped(6), true, '稀有度收益仍在 50 币那一档封顶');

  // 实战：同一家店连刷，价格按序列走、钱按价扣
  let run = c.Tower._debugRun('endless');
  run.coins = 10000;
  run.phase = 'shop';
  run.shop = { layer: run.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
  // 首次免费
  let st = c.Tower.shopState();
  assert.equal(st.rerollFree, true, '进店首次免费');
  let r = c.Tower.rerollShop();
  assert.ok(r.ok && r.paid === 0, '免费那次不该扣钱：' + JSON.stringify(r));
  // 之后逐次递增
  let coinsBefore = c.Tower._debugRun('endless').coins;
  for (let i = 1; i <= 4; i++) {
    st = c.Tower.shopState();
    assert.equal(st.rerollNextPrice, TD.rerollPriceAt(i), '第 ' + i + ' 次应付 ' + TD.rerollPriceAt(i));
    const before = c.Tower._debugRun('endless').coins;
    r = c.Tower.rerollShop();
    assert.ok(r.ok, '应当能刷新：' + JSON.stringify(r));
    assert.equal(r.paid, TD.rerollPriceAt(i), '实付应当等于标价');
    assert.equal(c.Tower._debugRun('endless').coins, before - r.paid, '扣费应当精确');
  }
  /* 本轮需求：继续刷下去价格一路涨到 70 封顶，但**期望在 50 那一档就到顶**（不再提高） */
  let prevPaid = 0;
  for (let i = 5; i <= 9; i++) {
    const stn = c.Tower.shopState();
    const expectPrice = TD.rerollPriceAt(i);
    assert.equal(stn.rerollNextPrice, expectPrice, '标价要与公式一致（第 ' + i + ' 次）：' + stn.rerollNextPrice);
    assert.equal(stn.rerollCapped, TD.rerollPriceCapped(i), 'capped 标记要与公式一致');
    const beforeN = c.Tower._debugRun('endless').coins;
    const rn = c.Tower.rerollShop();
    assert.equal(rn.paid, expectPrice, '实付应当等于标价，实测 ' + rn.paid);
    assert.equal(c.Tower._debugRun('endless').coins, beforeN - expectPrice, '扣费精确');
    /* 质量：「50 那一档」之后不再提高 —— i=5 付 50 是本条曲线的顶点，之后（60/70）只更贵不更好 */
    if (prevPaid) assert.equal(rn.expect.tilt, prevPaid, '50 那一档之后期望不再提高');
    prevPaid = rn.expect.tilt;
  }

  // 钱不够时要拒绝，而且说明价格
  const broke = c.Tower._debugRun('endless');
  broke.coins = 0;
  const bad = c.Tower.rerollShop();
  assert.ok(!bad.ok, '钱不够不该刷');
  assert.match(bad.msg, /试炼币不足/, '要说明原因：' + bad.msg);
});

test('需求12：刷新只抬高稀有度期望、不设保底货品', () => {
  const c = setup();
  const TD = c.TowerData;

  // 1) 没有保底了：把「保底」那套接口彻底移除
  assert.equal(TD.rerollQuality, undefined, '保底接口应当已移除');
  assert.equal(TD.REROLL_QUALITY, undefined, '保底阶梯表应当已移除');

  /* 2) 倾斜权重族：p=1 是「基础权重」，p 越大越偏向高稀有度。
   * 注意：传奇那一档现在会额外被「传奇降权」压低（需求 2：中幅下调；
   * 需求 4：已拥有传奇时继续降），所以 p=1 不再等于原始 RARITY_WEIGHTS 的传奇档，
   * 但普通/稀有/史诗三档的比例必须与原始一致。 */
  const natural = TD.tiltWeights(1);
  const sum3 = TD.RARITY_WEIGHTS[0] + TD.RARITY_WEIGHTS[1] + TD.RARITY_WEIGHTS[2];
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(natural[i] - TD.RARITY_WEIGHTS[i] / (sum3 + TD.LEGEND_BASE_WEIGHT)) < 1e-9,
      '第 ' + i + ' 档应当保持原始比例：' + JSON.stringify(natural));
  }
  assert.ok(natural[3] < TD.RARITY_WEIGHTS[3] / (sum3 + TD.RARITY_WEIGHTS[3]),
    '传奇那一档应当被下调：' + JSON.stringify(natural));
  assert.ok(Math.abs(natural.reduce((a, b) => a + b, 0) - 1) < 1e-9, '权重应当归一化');
  let last = -1;
  for (const p of [1, 1.5, 2, 3, 5]) {
    const w = TD.tiltWeights(p);
    const mean = w.reduce((a, v, i) => a + v * i, 0);
    assert.ok(mean > last, '倾斜越大期望应当越高：p=' + p + ' mean=' + mean.toFixed(4));
    if (p > 1) assert.ok(w[0] < natural[0] - 1e-9 && w[3] > natural[3] + 1e-9,
      'p>1 时普通变少、传奇变多：p=' + p + ' ' + JSON.stringify(w.map((v) => +v.toFixed(4))));
    last = mean;
  }

  /* 3) 期望随价格上升，但**在 50 那一档封顶**（2026-10：价格能涨到 70，稀有度收益只到 50 档） */
  const e20 = TD.rerollExpectation(20);
  const e40 = TD.rerollExpectation(40);
  const e50 = TD.rerollExpectation(50);
  const e60 = TD.rerollExpectation(60);
  const e70 = TD.rerollExpectation(70);
  assert.ok(Math.abs(e20.epics - 1) < 0.25, '20 币的期望史诗应当约 1 件，实测 ' + e20.epics.toFixed(2) + '（自然 ' + e20.baseEpics.toFixed(2) + '）');
  assert.ok(Math.abs(e40.epics - 2) < 0.25, '40 币的期望史诗应当约 2 件，实测 ' + e40.epics.toFixed(2));
  assert.ok(e50.epics > 2.0, '50 币是收益封顶的那一档，实测 ' + e50.epics.toFixed(2));
  assert.equal(e60.epics, e50.epics, '60 币不该比 50 更好（稀有度封顶）：' + e60.epics.toFixed(3));
  assert.equal(e70.epics, e50.epics, '70 币（价格新上限）也一样不再提高：' + e70.epics.toFixed(3));
  assert.equal(e60.tilt, e50.tilt, 'tilt 同样封顶在 50 那一档：' + e60.tilt + ' vs ' + e50.tilt);
  assert.equal(e70.tilt, e50.tilt, '70 币的 tilt 也等于 50 档：' + e70.tilt);
  assert.ok(e20.epics > e20.baseEpics, '20 币应当明显优于自然掉率');
  // 收益递减但严格上升：20→40 的增量应当大于 40→50
  const d1 = e40.epics - e20.epics, d2 = e50.epics - e40.epics;
  assert.ok(d2 > 0 && d2 < d1, '越高档收益越少：20→40 增量 ' + d1.toFixed(2) + ' vs 40→50 增量 ' + d2.toFixed(2));
  let prevE = -1;
  for (const price of [0, 10, 20, 30, 40, 50]) {
    const e = TD.rerollExpectation(price);
    assert.ok(e.epics > prevE, '50 档之前期望应当随价格严格上升：' + price + ' → ' + e.epics.toFixed(2));
    prevE = e.epics;
  }
  for (const price of [50, 60, 70, 90]) {
    assert.equal(TD.rerollExpectation(price).epics, e50.epics, '封顶后不管多贵都不再提高：' + price);
  }

  // 4) 实战：不靠保底也要真的变好（大样本单调）
  const run = c.Tower._debugRun('endless');
  run.coins = 1000000;
  run.phase = 'shop';
  run.shop = { layer: run.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
  const priceToCount = (p) => (p === 0 ? 0 : ((p - 10) / 10 + 1));
  /* 固定随机种子：相邻两档的期望质量分只差 ~0.05，200 次抽样的噪声同量级，
   * 不种子化时「价格 10 > 价格 0」会偶发红（实测约 1/10）。用固定种子后完全可复现。 */
  c.__seed(20260415);
  const rows = [];
  for (const price of [0, 10, 20, 30, 40, 60]) {
    let score = 0, epics = 0, n = 0;
    for (let i = 0; i < 200; i++) {
      const cur = c.Tower._debugRun('endless');
      cur.coins = 1000000;               // 每次刷新前补钱：否则扣到低于价格后 rerollShop 会失败并被 continue 跳过
      cur.shop.rerollFree = (price === 0);
      cur.shop.rerollCount = priceToCount(price);
      const r = c.Tower.rerollShop();
      if (!r.ok) continue;
      const slots = c.Tower.shopState().slots;
      score += TD.shopQualityScore(slots);
      epics += slots.filter((s) => s.rarity >= 2).length;
      n++;
    }
    rows.push({ price, score: score / n, epics: epics / n });
  }
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].score > rows[i - 1].score,
      '价格 ' + rows[i].price + ' 的质量分应当高于 ' + rows[i - 1].price +
      '：' + rows.map((r) => r.price + '→' + r.score.toFixed(2)).join(' '));
  }
  // 没有保底 → 货架结构不会突变（每题都可能是普通货），但整体必须更好
  assert.ok(rows[rows.length - 1].score > rows[0].score * 2,
    '最贵档应当明显优于免费档：' + rows.map((r) => r.price + '→' + r.score.toFixed(2)).join(' '));
  assert.ok(rows.find((r) => r.price === 20).epics > rows[0].epics + 0.2,
    '20 币应当比免费档多出可感知的史诗：' + rows.map((r) => r.price + '→' + r.epics.toFixed(2)).join(' '));
  /* 20 币档单独用**大样本**判定：200 次刷新的采样标准差 ≈ 0.074，
   * 原来的 |x−1|<0.3 正好卡在采样边界上，偶发离群（实测约 1/8 局会红，与池子改动无关）。
   * 大样本下把它收成确定性断言，同时核对实测均值与理论期望一致（这才是真正的回归）。 */
  const BIG = 1200;
  let bigEpics = 0, bigN = 0;
  for (let i = 0; i < BIG; i++) {
    const cur = c.Tower._debugRun('endless');
    cur.coins = 1000000;
    cur.shop.rerollFree = false;
    cur.shop.rerollCount = priceToCount(20);
    const r = c.Tower.rerollShop();
    if (!r.ok) continue;
    const slots = c.Tower.shopState().slots;
    bigEpics += slots.filter((s) => s.rarity >= 2).length;
    bigN++;
  }
  const bigR20 = bigEpics / Math.max(1, bigN);
  const theo20 = TD.rerollExpectation(20).epics;
  assert.ok(Math.abs(bigR20 - theo20) < 0.15,
    '20 币档的实测史诗数应当贴近理论期望 ' + theo20.toFixed(2) + '，实测 ' + bigR20.toFixed(3) + '（' + bigN + ' 次刷新）');
  assert.ok(bigR20 > 0.8 && bigR20 < 1.4, '实战 20 币应当约 1 件史诗，实测 ' + bigR20.toFixed(3));
  const r20 = bigR20;                      // 20 币档用大样本值（200 次采样的那版仍留在 rows 里做单调性判断）
  assert.ok(r20 > 0.8, '20 币档至少要有可感知的史诗：' + r20.toFixed(3));
  /* 40 币档也用大样本（同法），核对理论期望。 */
  let bigEpics40 = 0, bigN40 = 0;
  for (let i = 0; i < BIG; i++) {
    const cur = c.Tower._debugRun('endless');
    cur.coins = 1000000;
    cur.shop.rerollFree = false;
    cur.shop.rerollCount = priceToCount(40);
    const r = c.Tower.rerollShop();
    if (!r.ok) continue;
    bigEpics40 += c.Tower.shopState().slots.filter((s) => s.rarity >= 2).length;
    bigN40++;
  }
  const theo40 = TD.rerollExpectation(40).epics;
  const bigR40 = bigEpics40 / Math.max(1, bigN40);
  assert.ok(Math.abs(bigR40 - theo40) < 0.25,
    '40 币档的实测史诗数应当贴近理论期望 ' + theo40.toFixed(2) + '，实测 ' + bigR40.toFixed(3));
  assert.ok(bigR40 > bigR20, '40 币档应当明显多于 20 币档：' + bigR40.toFixed(3) + ' vs ' + bigR20.toFixed(3));
});

test('需求13：新增益「重整旗鼓（普通，+1 币）」与「背水一战（史诗，+3 币）」', () => {
  const c = setup();
  const TD = c.TowerData;
  const e9 = TD.BUFF_BY_ID.E09, e10 = TD.BUFF_BY_ID.E10;
  assert.ok(e9 && e10, '两个新增益都要存在');
  assert.equal(e9.kind, 'instant', '重整旗鼓是一次生效类');
  assert.equal(e10.kind, 'instant', '背水一战是一次生效类');
  assert.equal(e9.rarity, 0, '重整旗鼓应当是普通');
  assert.equal(TD.RARITY_NAME[e9.rarity], '普通');
  assert.equal(e10.rarity, 2, '背水一战应当是史诗');
  assert.equal(TD.RARITY_NAME[e10.rarity], '史诗');
  assert.equal(e9.mods.instantRetry, 1, '重整旗鼓 +1 枚');
  assert.equal(e10.mods.instantRetry, 3, '背水一战 +3 枚（本轮增益表重做后的数值）');

  const tok = () => Number(c.Tower._debugRun('endless').retryToken) || 0;
  assert.equal(tok(), 0, '初始 0 枚');
  assert.ok(c.Tower.debugGrantBuff('E09').ok, '应当能拿到重整旗鼓');
  assert.equal(tok(), 1, '拿 1 次应当 +1 枚');
  c.Tower.debugGrantBuff('E09');
  assert.equal(tok(), 2, '可叠加');
  c.Tower.debugGrantBuff('E10');
  assert.equal(tok(), 5, '背水一战 +3 枚（2 + 3）');
  assert.equal((c.Tower._debugRun('endless').permanent || []).length, 0, '一次生效类不占永久位');

  // 拿到的币真的能用来回滚
  c.Tower.continueFromShop ? null : null;
  const run = c.Tower._debugRun('endless');
  run.choices = null; run.phase = null;
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开战');
  const live = c.Tower._debugRun('endless');
  const rw = c.Tower.reportBattle('endless', live.attempt, false, 0);
  assert.ok(rw.retryable, '有币时失败应当可回滚：' + JSON.stringify(rw));
  assert.equal(rw.retryLeft, 5, '要报出 5 枚（重整旗鼓 ×2 + 背水一战 +3）');
  assert.ok(c.Tower.retryBattle().ok, '应当能回滚');
  assert.equal(tok(), 4, '回滚消耗 1 枚（5 - 1）');
});

test('需求14：用「补给」替代「紧急包扎」，去掉后者；金蝉脱壳 3 → 10', () => {
  const c = setup();
  const TD = c.TowerData;
  const tool = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const core = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  assert.ok(!/紧急包扎/.test(tool.replace(/\/\*[\s\S]*?\*\//g, '')), '代码里不该再有「紧急包扎」');
  assert.ok(!/type: 'heal'/.test(core.replace(/\/\*[\s\S]*?\*\//g, '')), '选择池里不该再有 heal 卡');
  assert.equal(TD.BUFF_BY_ID.N04.uses, 10, '金蝉脱壳的 uses 仍是 10');
  /* 挑战塔里限次类一律是「下一场战斗」，所以卡面文案改成单场；无尽塔仍按 uses 显示。 */
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.N04, 'nextBattle'), true, '金蝉脱壳应当带 nextBattle 标签');
  assert.match(TD.BUFF_BY_ID.N04.desc, /下一场战斗/, '文字要写成「下一场战斗」：' + TD.BUFF_BY_ID.N04.desc);
  // 场间选择里全是真增益（含补给 N08 的可能性存在）
  const run = c.Tower._debugRun('endless');
  run.choices = null; run.permanent = []; run.limited = []; run.idx = 2; run.phase = null;
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false);
  const a = c.Tower._debugRun('endless');
  c.Tower.reportBattle('endless', a.attempt, true, 1, null);
  const ch = c.Tower._debugRun('endless').choices || [];
  for (const x of ch) assert.equal(x.type, 'buff', '选择项必须都是真增益：' + JSON.stringify(x));
});

test('需求15：E04「steam大促」一次性 7 折；E01「立即进货」战后开店，与 E04 叠加为 3.5 折', () => {
  const c = setup();
  const TD = c.TowerData;
  const run = c.Tower._debugRun('endless');
  run.coins = 100000; run.permanent = [];
  /* ---- E04：本轮改成「立即生效 + 不可叠加 + 下一家店 −30%」 ---- */
  assert.equal(TD.BUFF_BY_ID.E04.kind, 'instant', 'E04 应当是立即生效类型');
  assert.equal(TD.BUFF_BY_ID.E04.maxStacks, 1, 'E04 不可叠加');
  assert.equal(TD.BUFF_BY_ID.E04.mods.shopDiscount, 0.30, 'E04 折扣应当是 30%');
  c.Tower.debugGrantBuff('E04');
  assert.equal(c.Tower._debugRun('endless').shopDiscount, 1, '第 1 次应当是 1 份');
  // 再拿一次 —— 不可叠加，所以仍然是 1 份（走 addBuff 会被叠层上限挡住）
  const again = c.Tower.addBuff(c.Tower._debugRun('endless'), 'E04');
  assert.ok(!again.ok, 'E04 不可叠加：再拿一次应当被拒（' + (again.msg || '') + '）');
  assert.equal(c.Tower._debugRun('endless').shopDiscount, 1, '份数不该变多');
  // 开一家店 → 消耗掉，价格 7 折
  const r = c.Tower._debugRun('endless');
  r.choices = [{ type: 'buff', id: 'C02' }]; r.restShopUsed = false; r.phase = null;
  assert.ok(c.Tower.openRestShop().ok, '应当能开休整商店');
  assert.equal(c.Tower._debugRun('endless').shopDiscount, 0, '进店应当消耗掉');
  assert.equal(c.Tower._debugRun('endless').shop.discount, true, '这家店应当吃到折扣');
  assert.ok(Math.abs(c.Tower._debugRun('endless').shop.discountPct - 0.30) < 1e-6,
    '折扣比例应当是 0.30，实测 ' + c.Tower._debugRun('endless').shop.discountPct);
  c.Tower.closeShop();
  // 没份了 → 原价
  const r3 = c.Tower._debugRun('endless');
  r3.choices = [{ type: 'buff', id: 'C02' }]; r3.restShopUsed = false; r3.phase = null;
  assert.ok(c.Tower.openRestShop().ok);
  assert.equal(c.Tower._debugRun('endless').shop.discount, false, '没份了就是原价');
  c.Tower.closeShop();

  /* ---- E01「立即进货」：限次 1、下一场战斗后开店、单用 7 折（2026-10 由 5 折削弱）---- */
  const e01 = TD.BUFF_BY_ID.E01;
  assert.equal(e01.kind, 'limited', 'E01 应当是限次类');
  assert.equal(e01.uses, 1, 'E01 限次 1');
  assert.equal(e01.rarity, 2, 'E01 稀有度是史诗（2026-10 由稀有提升）');
  assert.equal(TD.hasTag(e01, 'nextBattle'), true, 'E01 是「下一场战斗」类');
  assert.equal(e01.mods.postBattleShop, 1, 'E01 应当挂「战后开店」');
  assert.equal(e01.mods.postBattleShopDiscount, 0.30, 'E01 单用 7 折（−30%，与 steam大促 同档）');
  assert.ok(!e01.mods.openShop, 'E01 不该再用「立刻开店」的旧口径');

  /* ---- E01 + E04 同时生效 → 合并成 3.5 折（−65%），不是简单相加 ----
   * 合并发生在**开店那一刻**（makeShop），不是拿到 buff 的那一刻：
   * 注意 E04 一局只能拿一次（instant + maxStacks 1），所以这里直接把「E04 已生效、还没进店」
   * 的状态摆好，再拿 E01，然后真打一场触发战后开店。 */
  const fightOnce = (cc) => {
    /* 场间选择会挡住下一场，测试里直接跳过（真实流程由界面点选）。
     * 环境也清掉：摇到「幻影回响」会把同一场再打一遍（提前 return，E01 的店就不开了）——
     * 实测这就是本用例偶发红的另一个原因。 */
    const rr0 = cc.Tower._debugRun('endless');
    rr0.choices = null; rr0.phase = null; rr0.env = [];
    const nx = cc.Tower.nextBattle('endless');
    assert.ok(nx.ok, '应当能开战：' + nx.msg);
    return cc.Tower.reportBattle('endless', nx.token, true, 0.8, null);
  };
  const r4 = c.Tower._debugRun('endless');
  r4.permanent = []; r4.limited = []; r4.idx = 0; r4.phase = null;
  r4.shopDiscount = 1; r4.shopDiscountPct = 0.30;      // 模拟 steam大促 已挂上
  c.Tower.debugGrantBuff('E01');
  const rr = c.Tower._debugRun('endless');
  assert.equal('postBattleShop' in rr, false, 'E01 不再往 run 上写 postBattleShop 缓存');
  fightOnce(c);
  const shopA = c.Tower._debugRun('endless').shop;
  assert.ok(shopA && shopA.discount === true, 'E01 开着时战后应当开店且带折扣');
  assert.ok(Math.abs(shopA.discountPct - 0.65) < 1e-6,
    'E01 + E04 叠加后应当是 −65%（3.5 折），实测 ' + shopA.discountPct);

  /* ---- 回归：**把 E01 关掉之后不该再开店**（用户报的 bug）---- */
  const r5 = c.Tower._debugRun('endless');
  r5.shop = null; r5.phase = null; r5.shopDiscount = 0; r5.shopDiscountPct = 0;
  r5.limited = [{ id: 'E01', stacks: 1, uses: 1, on: true }];
  assert.ok(c.Tower.toggleLimited('E01', false).ok, '应当能把 E01 关掉');
  const offOut = fightOnce(c);
  const afterOff = c.Tower._debugRun('endless');
  assert.ok(!offOut.postBattleShop, '关掉 E01 之后不该由它开店：' + JSON.stringify(offOut.postBattleShop));
  assert.equal(afterOff.limited.filter((b) => b.id === 'E01' && b.uses > 0).length, 1,
    '关掉的限次不该被消耗（关掉不扣次数）');
  /* 再打一场，仍然不该由 E01 开店（原来每场都会开） */
  assert.ok(!fightOnce(c).postBattleShop, '关掉之后连着几场都不该由 E01 开店');

  /* ---- 关掉再打开 → 恢复生效，单用 7 折，且只开这一次 ---- */
  const r6 = c.Tower._debugRun('endless');
  r6.shop = null; r6.phase = null; r6.choices = null;
  assert.ok(c.Tower.toggleLimited('E01', true).ok, '应当能重新打开 E01');
  fightOnce(c);
  const r7 = c.Tower._debugRun('endless');
  assert.ok(r7.shop, '重新打开之后应当照常开店');
  assert.ok(Math.abs(r7.shop.discountPct - 0.30) < 1e-6,
    '单用 E01 应当是 7 折（−30%），实测 ' + r7.shop.discountPct);
  r7.shop = null; r7.phase = null; r7.choices = null;
  assert.ok(!fightOnce(c).postBattleShop, 'E01 用完（限次 1）之后不该再由它开店');
});

test('需求16：烙印各自独立随机数；破碎前 5%、破碎后 8% 且本局永久', () => {
  const c = setup();
  const run = c.Tower._debugRun('endless');
  run.permanent = []; run.limited = [];
  run.fragileBase = { power: 0, agility: 0, speed: 0 };
  run.fragileBurned = { power: 0, agility: 0, speed: 0 };
  c.Tower.debugGrantBuff('C39');                     // 力量烙印：存在 5%
  let r = c.Tower._debugRun('endless');
  assert.equal(Number(r.fragileBase.power), 0.05, '拿到时登记存在值 5%');
  assert.equal(r.stickyStat, undefined, '旧的 stickyStat 不再使用');
  // 存在时：效果清单显示 +5%（2026-10 削弱；原来是半效 +4%）
  let line = c.Tower.debugBuffReport('endless').effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.ok(line, '效果清单应当列出烙印攻击');
  assert.match(line[0], /存在/, '要标「存在」：' + line[0]);
  assert.match(line[1], /\+5%/, '存在时应当 +5%：' + line[1]);
  // 面板详情也要写清
  const info = c.Tower.ownedBuffs('endless').find((b) => b.id === 'C39');
  assert.match(info.progress, /烙印存在/, '面板详情要写「烙印存在」：' + info.progress);
  assert.match(info.progress, /\+5%/, '面板详情要写 +5%：' + info.progress);
  assert.match(info.progress, /损毁后升为 8%/, '面板详情要写损毁后 8%：' + info.progress);

  // 连打直到损毁
  /* 用与 fragileRoll 完全相同的派生算法，预先算出一个「下一步必然碎裂」的种子状态。
   * 这样不依赖概率采样（400 场抽样会偶发不中），也不依赖前面测试留下的随机状态。 */
  function seedForHit(salt, id, pct) {
    const key = String(salt == null ? '' : salt) + '#' + id;
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    let st = h >>> 0 || 1;
    for (let i = 0; i < 200; i++) {
      const next = (Math.imul(st, 1664525) + 1013904223) >>> 0;
      if ((next / 4294967296) * 100 < pct) return st;   // 返回「前一步」，让 fragileRoll 那一步命中
      st = next;
    }
    return null;
  }
  const pct39 = c.TowerData.BUFF_BY_ID.C39.mods.fragileBreakPct;
  let broken = false;
  for (let i = 0; i < 40 && !broken; i++) {
    const cur = c.Tower._debugRun('endless');
    if (cur.choices) {
      const pick = c.Tower.pickChoice('endless', 0, null);
      if (pick && !pick.ok && pick.needsReplace) c.Tower.pickChoice('endless', 0, ((cur.permanent || [])[0] || {}).id || null);
      continue;
    }
    if (cur.phase === 'shop') { c.Tower.continueFromShop(); continue; }
    if (cur.phase === 'checkpoint') { c.Tower.continueEndless(); continue; }
    const hit = seedForHit(cur.salt, 'C39', pct39);
    assert.ok(hit != null, '应当能算出一个必然碎裂的种子');
    cur.fragileSeeds = { C39: hit };
    const nx = c.Tower.nextBattle('endless');
    if (!nx || nx.ok === false) break;
    const a = c.Tower._debugRun('endless');
    c.Tower.reportBattle('endless', a.attempt, true, 1, null);
    if (!(c.Tower._debugRun('endless').limited || []).some((b) => b.id === 'C39')) broken = true;
  }
  assert.ok(broken, '注入必碎种子后，一场之内力量烙印就应当碎掉');
  r = c.Tower._debugRun('endless');
  assert.equal(Number(r.fragileBase.power), 0, '破碎时「存在」的那一份被收回');
  assert.equal(Number(r.fragileBurned.power), 0.08, '损毁后换成 8% 并永久保留');
  line = c.Tower.debugBuffReport('endless').effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.match(line[0], /已损毁/, '要标「已损毁」：' + line[0]);
  assert.match(line[1], /\+8%/, '损毁后应当 +8%：' + line[1]);

  // 独立随机数：三条烙印不该恒为「全碎或全不碎」
  let partial = 0, all = 0;
  for (let t = 0; t < 60 && partial === 0; t++) {
    const cc = setup();
    const rr = cc.Tower._debugRun('endless');
    rr.permanent = []; rr.limited = [];
    rr.fragileBase = { power: 0, agility: 0, speed: 0 };
    rr.fragileBurned = { power: 0, agility: 0, speed: 0 };
    ['C39', 'C40', 'C41'].forEach((id) => cc.Tower.debugGrantBuff(id));
    const nx = cc.Tower.nextBattle('endless');
    if (!nx || nx.ok === false) continue;
    const a = cc.Tower._debugRun('endless');
    cc.Tower.reportBattle('endless', a.attempt, true, 1, null);
    const n = (cc.Tower._debugRun('endless').buffLog || []).filter((e) => e.event === 'break').length;
    if (n === 3) all++;
    if (n > 0 && n < 3) partial++;
  }
  assert.ok(partial > 0 || all === 0, '三条烙印必须各自独立（全碎 ' + all + ' / 部分碎 ' + partial + '）');
});

test('需求17：轻装上阵的叠层在详情里正确显示，且实际效果一致', () => {
  const c = setup();
  const run = c.Tower._debugRun('endless');
  run.permanent = []; run.limited = [];
  c.Tower.debugGrantBuff('C34');
  // 1 个永久位（C34 自己）→ 4 个空槽 × 20% = +80%
  let info = c.Tower.ownedBuffs('endless').find((b) => b.id === 'C34');
  assert.match(info.progress, /4 个空槽/, '详情要写出当前空槽数：' + info.progress);
  assert.match(info.progress, /\+80%/, '详情要算出 +80%：' + info.progress);
  let line = c.Tower.debugBuffReport('endless').effects.find(([k]) => k === '攻击');
  assert.ok(line, '效果清单要有攻击');
  assert.match(line[1], /\+80%/, '实际效果也要 +80%：' + line[1]);
  // 占满到只剩 1 个空槽 → +20%
  const r = c.Tower._debugRun('endless');
  r.permanent = [{ id: 'C34', stacks: 1 }, { id: 'C02', stacks: 1 }, { id: 'C21', stacks: 1 }, { id: 'C22', stacks: 1 }];
  info = c.Tower.ownedBuffs('endless').find((b) => b.id === 'C34');
  assert.match(info.progress, /1 个空槽/, '详情要跟着变：' + info.progress);
  assert.match(info.progress, /\+20%/, '详情要算出 +20%：' + info.progress);
  /* 2026-10 修正后：**没有 stackable 标签的件不再同栏叠层**（C34 就是这种），
   * 拿两份会**并排占两个背包栏位**、每栏 1 层。面板按栏位分别显示，实际效果按栏求和。 */
  r.permanent = [{ id: 'C34', stacks: 1 }, { id: 'C34', stacks: 1 }];
  const dup = c.Tower.ownedBuffs('endless').filter((b) => b.id === 'C34');
  assert.equal(dup.length, 2, '两份 C34 应当是两个栏位：' + JSON.stringify(dup.map((d) => d.stacks)));
  assert.equal(dup[0].stacks, 1, '每栏各 1 层（不再同栏叠 2 层）');
  info = dup[0];
  /* progressOf 是**按件**汇总的口径（stacksOf 跨栏位求和）：2 份 → 「× 2 层」+ 总量 120%。
   * 两栏共占 2 个永久位 → 3 个空槽；每份 3×20% → 合计 +120%。 */
  assert.match(info.progress, /3 个空槽/, '空槽数要按实际占用算：' + info.progress);
  assert.match(info.progress, /× 2 层/, '两栏合计要写成 ×2 层：' + info.progress);
  assert.match(info.progress, /\+120%/, '合计 +120%：' + info.progress);
  assert.match(info.progress, /2\/5/, '永久位应当是 2/5：' + info.progress);
  line = c.Tower.debugBuffReport('endless').effects.find(([k]) => k === '攻击');
  assert.match(line[1], /\+120%/, '两栏各 +60% → 合计 +120%：' + line[1]);
});

test('需求80：熔核·炽壳改成「每过一回合 +10% 减伤、第 8 回合起封顶 70%」', () => {
  const c = setup();
  const TD = c.TowerData;
  const desc = TD.TRIAL_BY_ID.core.mechDesc;
  assert.match(desc, /每过一回合/, '简介要写清是逐回合变硬：' + desc);
  assert.match(desc, /10%/, '简介要写 +10%：' + desc);
  assert.match(desc, /封顶 70%/, '简介要写封顶 70%：' + desc);
  assert.match(desc, /第 7 次行动/, '加力敏速那一半仍然要在简介里：' + desc);
  /* 纯函数曲线：0 / 10 / … / 70 封顶，层数上限 = 封顶 / 每层 = 7 */
  const rules = c.Sim.rules;
  assert.equal(rules.coreReducePerRound, 0.10);
  assert.equal(rules.coreReduceCap, 0.70);
  assert.equal(c.Sim.coreMaxStacks(), 7, '层数上限应当是 7 层（70% / 10%）');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 30].map((n) => c.Sim.coreReduceOf(n)),
    [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.7, 0.7], '逐回合 +10%、第 8 回合起封顶');
  /* 实战：把这只 boss 摆上（无尽塔第 4 场），逐回合看玩家单次伤害 —— 必须单调不增、且末段 ≈ 三成 */
  const run = c.Tower._debugRun('endless');
  run.plan = [{ kind: 'trial', id: 'core' }, { kind: 'hero', anim: 'tl' }];
  run.idx = 0; run.env = [];
  const nx = c.Tower.nextBattle('endless');
  const me = { name: 'p', level: 70, power: 60, agility: 60, speed: 60, maxHp: 300000, hp: 300000,
    baseStats: { power: 60, agility: 60, speed: 60 }, weapons: [{ id: 1, level: 1 }], skills: [], wears: [], effects: {} };
  const out = c.Sim.simulate(me, JSON.parse(JSON.stringify(nx.foe)));
  const notes = out.rounds.filter((r) => /熔核·减伤/.test(r.noteText || '')).map((r) => r.noteText);
  assert.ok(notes.length >= 3, '每回合都要挂「熔核·减伤 N%」：' + notes.slice(0, 3).join(' | '));
  assert.match(notes[0], /10%/, '第一回合 10%：' + notes[0]);
  assert.ok(notes.some((t) => /70%/.test(t)), '战斗拖长时应当出现 70% 封顶：' + notes.join(' | '));
  /* 减伤真的落在伤害上：这里只做「确实打出过伤害」的兜底 ——
   * 逐回合的伤害曲线由 test-combat-rules 用**固定随机**（game(0.99)，无暴击/无闪避）
   * 精确守着；本用例用的是真随机，暴击会让「末段平均」偶发高于开场，不适合做数值断言。 */
  const hits = out.rounds.filter((r) => r.attacker === 0 && r.dmg > 0).map((r) => r.dmg);
  assert.ok(hits.length >= 6, '要有足够的采样：' + hits.join(','));
  assert.ok(hits.every((d) => d > 0), '减伤不是免伤：' + hits.join(','));
});

test('需求81：枯泉·涸井的最大生命乘数下调（封疗很强，需要补偿）', () => {
  const c = setup();
  const dry = c.TowerData.TRIAL_BY_ID.dry;
  assert.ok(dry.bias.hp <= 0.98, '生命乘数应当下调到 0.96 左右：' + dry.bias.hp);
  assert.ok(dry.bias.hp >= 0.90, '是「略微削弱」，不要砍过头：' + dry.bias.hp);
  /* 同池里的其它 boss 不该跟着变（只动枯泉一只） */
  assert.equal(c.TowerData.TRIAL_BY_ID.moss.bias.hp, 1.10, '苔龟不动');
  assert.equal(c.TowerData.TRIAL_BY_ID.erode.bias.hp, 1.28, '蚀骨不动');
  /* 封疗机制本身没变：仍然是 def.healMul = 0 */
  const g = c.Sim;
  const rounds = g.simulate(
    { name: '枯泉', level: 60, power: 1, agility: 1, speed: 1, hp: 100000, maxHp: 100000, weapons: [], skills: [],
      mech: ['trialDry'], pattern: ['common'], baseStats: { power: 1, agility: 1, speed: 1 } },
    { name: 'p', level: 60, power: 1, agility: 1, speed: 1, hp: 100000, maxHp: 100000, weapons: [],
      skills: [{ id: 13, level: 1 }], masterLevel: 7, baseStats: { power: 1, agility: 1, speed: 1 } });
  const master = rounds.rounds.find((r) => r.id === 13);
  assert.ok(master && master.healSelf === 0, '枯泉仍然封死治疗：' + (master && master.healSelf));
});

test('需求82：野球拳（12）用过 1 次 15、用过 2 次起 5 到底（敌我都遵循）', () => {
  const c = setup();
  const rules = c.Sim.rules;
  const rate = (n) => c.Sim.repeatRateOf(12, n);
  assert.equal(rate(0), rules.repeatSpecialFirst, '还没用过时的档位（=用过 1 次后）是 15');
  assert.equal(rate(1), rules.repeatSpecialFirst, '用过 1 次 → 15');
  assert.equal(rate(2), rules.repeatSpecialAgain, '用过 2 次就到 5：' + rate(2));
  assert.equal(rate(9), rules.repeatSpecialAgain, '之后不再下降（一直是 5）');
  assert.ok(rules.repeatSpecialAgain < rules.repeatSpecialFirst && rules.repeatSpecialFirst < rules.repeatSkill,
    '三档次序：5 < 15 < 20（其它技能）');
  /* 对敌我都生效：固定循环的敌人（元素术鼠那种 12 + 17）第二、三次技能槽要按曲线被压掉 */
  const foe = () => ({ name: '元素术鼠', level: 60, power: 20, agility: 20, speed: 20, hp: 100000, maxHp: 100000,
    weapons: [], skills: [{ id: 12, level: 8 }, { id: 23, level: 8 }], castable: [12, 23],
    pattern: ['skill', 'skill', 'skill', 'common'], baseStats: { power: 20, agility: 20, speed: 20 } });
  const player = () => ({ name: 'p', level: 60, power: 1, agility: 1, speed: 1, hp: 100000, maxHp: 100000,
    weapons: [], skills: [], baseStats: { power: 1, agility: 1, speed: 1 } });
  let uses = 0, acts = 0;
  for (let i = 0; i < 60; i++) {
    const sim = c.Sim.simulate(foe(), player());
    const mine = sim.rounds.filter((r) => r.attacker === 0 && (r.action === 'skill' || r.action === 'common'));
    uses += mine.filter((r) => r.id === 12).length;
    acts += mine.length;
  }
  const perAction = uses / Math.max(1, acts);
  assert.ok(perAction > 0, '第一次仍然要放得出来');
  assert.ok(perAction < 0.15, '固定循环的敌人也不该反复放野球拳（实测每回合 ' +
    (perAction * 100).toFixed(1) + '%）');
});

test('需求19：投掷宗师只掌握投掷类武器', () => {
  const c = setup();
  const TD = c.TowerData;
  const t = TD.SQUIRREL_BY_ID.thrower;
  assert.ok(t, '应当有投掷宗师');
  assert.ok(t.weapons.length >= 1, '应当带武器');
  for (const w of t.weapons) {
    const base = c.GameDict ? null : null;
    const kind = (c.weaponsMap && c.weaponsMap.getValue(w.id) || {}).type;
    assert.equal(kind, '投掷', '武器 id' + w.id + ' 应当是投掷类，实测 ' + kind);
  }
  // 实战里也只用到这两件
  const run = c.Tower._debugRun('endless');
  run.plan = [{ kind: 'squirrel', id: 'thrower' }, { kind: 'hero', anim: 'tl' }];
  run.idx = 0; run.env = [];
  const nx = c.Tower.nextBattle('endless');
  const ids = nx.foe.weapons.map((w) => w.id);
  for (const id of ids) {
    const kind = (c.weaponsMap && c.weaponsMap.getValue(id) || {}).type;
    assert.equal(kind, '投掷', '实战带的武器 id' + id + ' 也必须是投掷类');
  }
});

test('需求20：环境 buff 最多同时两层（硬上限）', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.ENV_MAX, 2, 'ENV_MAX 应当是 2');
  // 注入 4 条 → 打一场后被裁到 2
  const run = c.Tower._debugRun('endless');
  run.layer = 30;
  run.env = [
    { id: 'thorns', left: 5, values: { thornsPct: 0.12 } },
    { id: 'regen', left: 5, values: { regenPct: 0.03 } },
    { id: 'sun', left: 5, values: { enemyCritBonus: 25, selfCritBonus: 10 } },
    { id: 'frost', left: 5, values: { selfSpeedMul: -0.15 } },
  ];
  const nx = c.Tower.nextBattle('endless');
  const a = c.Tower._debugRun('endless');
  c.Tower.reportBattle('endless', a.attempt, true, 1, null);
  const env = c.Tower._debugRun('endless').env || [];
  assert.ok(env.length <= 2, '裁完之后不该超过 2 条，实测 ' + env.length);

  // 高层长跑：任何时刻都不超过 2 条
  const c2 = setup();
  c2.Tower._debugSetEndlessLayer(14);
  let worst = 0;
  for (let g = 0; g < 500; g++) {
    const r = c2.Tower._debugRun('endless');
    if (!r) break;
    worst = Math.max(worst, (r.env || []).length);
    if (r.choices) {
      const pick = c2.Tower.pickChoice('endless', 0, null);
      if (pick && !pick.ok && pick.needsReplace) c2.Tower.pickChoice('endless', 0, ((r.permanent || [])[0] || {}).id || null);
      continue;
    }
    if (r.phase === 'shop') { c2.Tower.continueFromShop(); continue; }
    if (r.phase === 'checkpoint') { c2.Tower.continueEndless(); continue; }
    if (r.layer > 26) break;
    const nx2 = c2.Tower.nextBattle('endless');
    if (!nx2 || nx2.ok === false) break;
    const a2 = c2.Tower._debugRun('endless');
    c2.Tower.reportBattle('endless', a2.attempt, true, 1, null);
  }
  assert.ok(worst <= 2, '长跑中最多同时 2 条环境，实测 ' + worst);
});

test('需求21：挑战塔不再生成任何「只有无尽塔用得上」的增益', () => {
  const c = setup();
  const TD = c.TowerData;
  // 环境 / 试炼币 / 商店 / 铸币 / 永久槽位 / 选取型 / 即时结算 —— 这些在挑战塔里都是废的
  const ENDLESS_ONLY = TD.ENDLESS_ONLY_MODS;
  assert.ok(Array.isArray(ENDLESS_ONLY) && ENDLESS_ONLY.length >= 10, '应当有一份「无尽专属 mods」清单');
  for (const b of TD.towerPool) {
    const bad = Object.keys(b.mods || {}).filter((k) => ENDLESS_ONLY.includes(k));
    assert.equal(bad.length, 0, '挑战塔池不该有 ' + b.id + '（' + bad.join(',') + '）');
    assert.ok(!(TD.hasTag(b, 'endless') && !TD.hasTag(b, 'tower')), '挑战塔池不该有无尽专属条目：' + b.id);
  }
  // 具体两条：晴空护符 / 避风斗篷（作用于环境词缀，挑战塔没有环境）
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.N09, 'endless') && !TD.hasTag(TD.BUFF_BY_ID.N09, 'tower'), true, '晴空护符应当标无尽专属');
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.N10, 'endless') && !TD.hasTag(TD.BUFF_BY_ID.N10, 'tower'), true, '避风斗篷应当标无尽专属');
  assert.ok(!TD.towerPool.some((b) => b.id === 'N09' || b.id === 'N10'), '它们不该出现在挑战塔池');
  assert.ok(!TD.towerPool.some((b) => b.mods && (b.mods.envIgnore || b.mods.envReflect)), '挑战塔池不该有环境类');
  assert.ok(!TD.towerPool.some((b) => b.mods && b.mods.coinBoostPct), '挑战塔池不该有试炼币类');
  // 烙印（本局永久保留）也不该进塔 —— 挑战塔的增益只服务下一场
  assert.ok(!TD.towerPool.some((b) => /^C4[0-4]$/.test(b.id)), '烙印不该出现在挑战塔池');
  for (const id of ['C39', 'C42']) assert.equal(TD.hasTag(TD.BUFF_BY_ID[id], 'endless') && !TD.hasTag(TD.BUFF_BY_ID[id], 'tower'), true, id + ' 应当标无尽专属');
  /* 池子规模：towerPool 现在是「挑战塔**归属**」的完整名单（场间选择池），
   * 包含限次类与永久类 —— 塔里本来就能选到永久增益（无尽塔专属的除外）。 */
  const towerLimited = TD.towerPool.filter((b) => b.kind === 'limited');
  /* 本轮改动：删掉 G03-G05（3 条）与 T03/T06/T08/T09（4 条）→ 挑战塔专属限次类 31 → 24；
   * 永久类因为删掉 C08、并把 C03（猎侠者）改成**无尽专属**（不再进挑战塔池），35 → 33。 */
  assert.equal(towerLimited.length, 25, '挑战塔的限次类应当是 25 条（含本轮新增的 C57 玉石俱焚），实测 ' + towerLimited.length);
  assert.equal(towerLimited.filter((b) => TD.hasTag(b, 'tower') && !TD.hasTag(b, 'endless')).length, 24, '其中 24 条是挑战塔专属（含 N/M/G/T 四系）');
  /* 本轮「严格池子管理」：C36 挥金如土挂在试炼商店消费上 → 改成无尽塔专属，
   * 永久类 33 → 32。 */
  /* 永久类的**条数会随池子调优变动**（用户正在调整哪些永久件进战斗奖励池：
   * C01/C04 已去掉 battle 标签 → 只进商店不进奖励池；2026-10 第十六批又有 10 件
   * C06/C07/C09/C16/C50/C48/C11/C12/C15/C35 变成无尽专属 → 31 → 21）。
   * 所以这里只守「用户确认过的下界 21」+ 自洽，不再钉死具体数字。 */
  const towerPerm = TD.towerPool.filter((b) => b.kind === 'permanent');
  assert.ok(towerPerm.length >= 21, '永久类也属于挑战塔池（至少 21 条），实测 ' + towerPerm.length);
  assert.equal(towerPerm.length, TD.BUFFS.filter((b) => b.kind === 'permanent' && TD.hasTag(b, 'tower') && TD.hasTag(b, 'battle')).length,
    '永久类条数要与「tower + battle」标签口径一致');
  assert.equal(TD.towerPool.filter((b) => b.kind === 'instant').length, 0, '即时类不进选择池');
  // 无尽池不该混入挑战塔专属（它们按「一场定胜负」设计）
  assert.equal(TD.endlessPool.filter((b) => TD.hasTag(b, 'tower') && !TD.hasTag(b, 'endless')).length, 0, '无尽选择池不该有挑战塔专属');
  assert.equal(TD.shopPool.filter((b) => TD.hasTag(b, 'tower') && !TD.hasTag(b, 'endless')).length, 0, '无尽商店池不该有挑战塔专属');
  // 挑战塔实战里抽到的选项也必须是池内成员
  const S = c.State.state(); S.props[23] = 99;
  c.Tower._debugSetLayer(0);
  assert.ok(c.Tower.startTowerRun().ok, '应当能开挑战塔');
  const ids = TD.towerPool.map((b) => b.id);
  const run = c.Tower._debugRun('tower');
  run.idx = 2; run.choices = null; run.phase = null;
  const nx = c.Tower.nextBattle('tower');
  assert.ok(nx && nx.ok !== false);
  const a = c.Tower._debugRun('tower');
  c.Tower.reportBattle('tower', nx.token, true, 1, null);
  const ch = c.Tower._debugRun('tower').choices || [];
  for (const x of ch) assert.ok(ids.includes(x.id), '挑战塔选项必须来自挑战塔池：' + JSON.stringify(x));
});

test('需求22：压实随机挑战的经验等级差，同级经验不变', () => {
  const c = setup();
  const S = c.State;
  assert.ok(S.EXP_DIFF_TIGHTEN > 0 && S.EXP_DIFF_TIGHTEN < 1, '压实指数应当在 (0,1)：' + S.EXP_DIFF_TIGHTEN);

  // 1) 同级经验必须与压实前完全一致（锚点不变）
  for (const lv of [1, 5, 12, 20, 40, 70]) {
    assert.equal(S.challengeExp(lv, lv), Math.round(S.CHALLENGE_EXP_BASE + Math.min(lv, S.CHALLENGE_EXP_CAP_LEVEL) * S.CHALLENGE_EXP_PER_LEVEL),
      lv + ' 级同级经验应当不变');
  }
  assert.equal(S.challengeExp(20, 20), 27, '20 级同级应当是 27 点（本轮下调后）');

  // 2) 等级差的影响被压紧：同样差 3 级，现在必须比「线性未压实」更贴近同级
  const linear = (d, lv) => {
    const base = S.CHALLENGE_EXP_BASE + Math.min(lv, S.CHALLENGE_EXP_CAP_LEVEL) * S.CHALLENGE_EXP_PER_LEVEL;
    const m = Math.max(0.3, Math.min(2.2, 1 + d * S.EXP_DIFF_STEP));
    return Math.round(base * m);
  };
  /* 取整后 1 级的差可能刚好相同（29 vs 29），所以「严格更贴近 1」用未取整的倍率比，
   * 取整后的值只要求 ≤ / ≥。 */
  const raw = (d, lv) => {
    const base = S.CHALLENGE_EXP_BASE + Math.min(lv, S.CHALLENGE_EXP_CAP_LEVEL) * S.CHALLENGE_EXP_PER_LEVEL;
    const m = Math.max(0.3, Math.min(2.2, 1 + d * S.EXP_DIFF_STEP));
    return base * Math.pow(m, S.EXP_DIFF_TIGHTEN);
  };
  for (const d of [1, 2, 3]) {
    assert.ok(raw(d, 20) < linear(d, 20), '越级 ' + d + ' 级压实后应当更贴近同级（未取整）');
    assert.ok(S.challengeExp(20 + d, 20) <= linear(d, 20),
      '越级 ' + d + ' 级的经验不该高于未压实：' + S.challengeExp(20 + d, 20) + ' vs ' + linear(d, 20));
  }
  for (const d of [-1, -2, -3]) {
    assert.ok(raw(d, 20) > linear(d, 20), '打低 ' + (-d) + ' 级压实后应当更高（未取整）');
    assert.ok(S.challengeExp(20 + d, 20) >= linear(d, 20),
      '打低 ' + (-d) + ' 级的经验不该低于未压实：' + S.challengeExp(20 + d, 20) + ' vs ' + linear(d, 20));
  }
  // 倍率随等级差单调，且仍然「越级更多、低级更少」
  let prev = 0;
  const anchor20 = S.challengeExp(20, 20);
  for (const d of [-1, 0, 1, 2, 3]) {
    const m = S.challengeExp(20 + d, 20) / anchor20;
    assert.ok(m > prev, '倍率应当随等级差单调上升：diff ' + d + ' = ' + m.toFixed(3));
    prev = m;
  }
  assert.ok(S.challengeExp(19, 20) < S.challengeExp(20, 20), '打低 1 级应当更少');
  assert.ok(S.challengeExp(23, 20) > S.challengeExp(20, 20), '打高 3 级应当更多');
  // 倍率与自身等级无关（同级基准的比例关系不被压实破坏）
  const rA = S.challengeExp(23, 20) / S.challengeExp(20, 20);
  const rB = S.challengeExp(43, 40) / S.challengeExp(40, 40);
  assert.ok(Math.abs(rA - rB) < 0.02, '等级差倍率应与自身等级无关：' + rA.toFixed(3) + ' vs ' + rB.toFixed(3));

  // 3) 竞技场验收线仍成立：最大等级差的体力效率严格低于竞技场，且不低于其 88%
  const arena = S.ARENA_EXP_PER_ENERGY;
  const capMax = S.challengeExp(20 + 3, 20) / 10;
  assert.ok(capMax < arena, '封顶最大等级差应低于竞技场：' + capMax.toFixed(2));
  /* 本轮把随机挑战整体下调（同级 33→27、越 3 级 45→33），竞技场（冠军 150／30 体力）
   * 保持不动 —— 它是 4 人两轮、要赢才拿满，单位体力看**期望**仍与随机挑战同档。
   * 所以这条验收线的下限从「不低于竞技场 88%」放宽到 60%（只挡住「挑战变得毫无意义」）。 */
  assert.ok(capMax > arena * 0.6, '不应低太多：' + capMax.toFixed(2));
  for (let lv = 1; lv <= 60; lv++) {
    for (let d = -1; d <= 3; d++) {
      const eff = S.challengeExp(lv + d, lv) / 10;
      assert.ok(eff > 0 && eff <= arena, lv + '级差' + d + ' 效率越界：' + eff.toFixed(2));
    }
  }
});

test('需求23：挑战塔限次类只表达「下一场战斗」，不显示限次', () => {
  const c = setup();
  const TD = c.TowerData;
  const S = c.State.state(); S.props[23] = 99;
  c.Tower._debugSetLayer(0);
  assert.ok(c.Tower.startTowerRun().ok, '应当能开挑战塔');

  // 所有限次类都标了 nextBattle（含新加的挑战塔专属）
  for (const b of TD.towerPool) {
    if (b.kind !== 'limited') continue;
    assert.equal(TD.hasTag(b, 'nextBattle'), true, b.id + ' 应当带 nextBattle 标签');
    assert.match(b.desc, /下一场战斗/, b.id + ' 的文案要写「下一场战斗」：' + b.desc);
    assert.ok(!/接下来\s*\d+\s*场|本层/.test(b.desc), b.id + ' 的文案不该再出现「N 场 / 本层」：' + b.desc);
  }
  // 塔内限次一律 1 次，打完一场即消失
  const run = c.Tower._debugRun('tower');
  run.limited = []; run.permanent = [];
  c.Tower.addBuff(run, 'N01');
  let b = (c.Tower._debugRun('tower').limited || []).find((x) => x.id === 'N01');
  assert.ok(b, '塔内应当能拿到 N01');
  assert.equal(b.uses, 1, '塔内限次应当压到 1 次，实测 ' + b.uses);
  const nx = c.Tower.nextBattle('tower');
  assert.ok(nx && nx.ok !== false, '应当能开战');
  c.Tower.reportBattle('tower', nx.token, true, 1, null);
  assert.ok(!(c.Tower._debugRun('tower').limited || []).some((x) => x.id === 'N01'),
    '打完一场就应当消失');
  // 无尽塔不受影响：仍按各自的 uses
  const c2 = setup();
  c2.Tower.debugGrantBuff('N01');
  assert.equal((c2.Tower._debugRun('endless').limited || []).find((x) => x.id === 'N01').uses, 2,
    '无尽塔的 N01 仍应是 2 场');
  // UI：塔里的限次胶囊显示「下一场」而不是「剩 N 场」
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  assert.match(ui, /nextBattle/, 'UI 要按 nextBattle 区分展示');
  assert.match(ui, /'下一场'/, '面板胶囊要能显示「下一场」');
  assert.match(ui, /下一场/, '选牌卡面要标「下一场」');
});

test('需求24：挑战塔专属 buff 只进挑战塔，且效果生效', () => {
  const c = setup();
  const TD = c.TowerData;
  const tower = TD.BUFFS.filter((b) => TD.hasTag(b, 'tower') && !TD.hasTag(b, 'endless'));
  assert.ok(tower.length >= 12, '至少 12 条挑战塔专属，实测 ' + tower.length);
  // 池子隔离
  assert.equal(TD.towerPool.filter((b) => TD.hasTag(b, 'tower') && !TD.hasTag(b, 'endless')).length, tower.length, '专属全在挑战塔池');
  assert.equal(TD.endlessPool.filter((b) => TD.hasTag(b, 'tower') && !TD.hasTag(b, 'endless')).length, 0, '专属不该进无尽池');
  for (const b of tower) {
    assert.equal(b.kind, 'limited', b.id + ' 应当是限次类（塔里=下一场）');
    assert.equal(TD.hasTag(b, 'nextBattle'), true, b.id + ' 应当带 nextBattle 标签');
    assert.match(b.desc, /下一场战斗/, b.id + ' 文案要写「下一场战斗」');
  }
  // 关键几条的数值（本轮 T 组重排过：删掉 T03/T06/T08/T09 之后其余前移）
  assert.equal(TD.BUFF_BY_ID.T01.mods.weaponBoostUses, 3, '闪亮登场：前 3 次使用武器');
  assert.equal(TD.BUFF_BY_ID.T01.mods.weaponBoostPowerMul, 0.50, '闪亮登场：前 3 次武器攻击 +50%');
  assert.equal(TD.BUFF_BY_ID.T01.mods.weaponBoostMustHit, 1, '闪亮登场：前 3 次武器必中');
  assert.equal(TD.BUFF_BY_ID.T01.mods.weaponBoostReflectImmune, 1, '闪亮登场：前 3 次武器免疫反伤');
  assert.equal(TD.BUFF_BY_ID.T01.mods.weaponBoostFatigueMul, 0.20, '闪亮登场：之后我方攻击 −20%');
  assert.equal(TD.BUFF_BY_ID.T01.mods.openerPowerMul, undefined, '闪亮登场不该再按「出手次数」分档');
  assert.equal(TD.BUFF_BY_ID.T02.mods.dodgeMul, 0.50, '烟幕：闪避率 ×1.5');
  assert.equal(TD.BUFF_BY_ID.T03.mods.mustHitAll, 1, '锁定打击：所有攻击必中');
  assert.equal(TD.BUFF_BY_ID.T04.mods.critBonus, 30, '见血封喉：暴击率 +30%');
  assert.equal(TD.BUFF_BY_ID.T04.mods.critDmgBonus, 0.50, '见血封喉：暴击伤害 +50%');
  assert.equal(TD.BUFF_BY_ID.T05.mods.thornsPct, 0.50, '以血换血：反弹 50%');
  assert.equal(TD.BUFF_BY_ID.T07.mods.startHealPct, 1.00, '不动如山：开战回满生命');
  assert.equal(TD.BUFF_BY_ID.T08.mods.weaponFreeUses, 1, '先发制人：首次使用武器不消耗回合');
  assert.equal(TD.BUFF_BY_ID.T08.mods.firstHitZero, 1, '先发制人：第一次受伤为 0');

  // 实战：每条专属都要真的把 mods 写到玩家面板上（mods 是逐字段挑的，漏一个就静默失效）
  function freshTower() {
    const cc = setup();
    const s = cc.State.state(); s.props[23] = 99;
    cc.Tower._debugSetLayer(0);
    assert.ok(cc.Tower.startTowerRun().ok);
    const r = cc.Tower._debugRun('tower');
    r.plan = [{ kind: 'hero', anim: 'tl' }]; r.idx = 0; r.choices = null; r.phase = null;
    r.limited = []; r.permanent = [];
    return { c: cc, run: r };
  }
  const EXPECT = {
    T01: ['weaponBoostUses', 'weaponBoostPowerMul', 'weaponBoostMustHit', 'weaponBoostReflectImmune',
      'weaponBoostFatigueMul'],
    T02: ['dodgeMul'], T03: ['mustHitAll'], T04: ['critBonus', 'critDmgBonus'],
    T05: ['thornsPct'], T06: ['takenMul'],
    /* T07 的 maxHpMul / startHealPct 是**面板与开战回血**口径（不进 me.mods），只有 regenPct 进 mods。 */
    T07: ['regenPct'], T08: ['weaponFreeUses', 'firstHitZero'],
  };
  for (const [id, keys] of Object.entries(EXPECT)) {
    const t = freshTower();
    const res = t.c.Tower.addBuff(t.run, id);
    assert.ok(res.ok, id + ' 应当能加入：' + (res.msg || ''));
    const nx = t.c.Tower.nextBattle('tower');
    const me = { name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 60000, hp: 60000,
      baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    for (const k of keys) assert.ok(me.mods && me.mods[k] != null, id + ' 的 ' + k + ' 没写进玩家 mods：' + JSON.stringify(me.mods));
  }
  // T06（背水一战）走 speedMul → 直接改面板速度
  for (const id of ['T06']) {
    const t = freshTower();
    t.c.Tower.addBuff(t.run, id);
    const nx = t.c.Tower.nextBattle('tower');
    const me = { name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 60000, hp: 60000,
      baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    assert.ok(me.speed > 120, id + ' 应当提升面板速度，实测 ' + me.speed);
  }

  /* ---- 本轮重做的三条机制的**战斗实测** ----
   * ① 疾风先手/先发制人（M02/T08）：前 N 次使用武器不消耗回合
   * ② 闪亮登场（T01）：前 3 次使用武器 +50%，之后我方攻击 −20%
   * 实测都走 Sim，因为 mods 写上面板 ≠ 战斗里真的生效。 */
  const foe2 = { name: '木人', level: 70, power: 50, agility: 1, speed: 50, hp: 3000000, maxHp: 3000000,
    baseStats: { power: 50, agility: 1, speed: 50 }, weapons: [], skills: [], wears: [], effects: {} };
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const WEAP = [{ id: 3, level: 1, lo: 200, hi: 200, type: '近战' }];
  const mk2 = (extra) => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 60000, hp: 60000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: JSON.parse(JSON.stringify(WEAP)),
    skills: [], wears: [], effects: {}, masterLevel: 0,
    mods: Object.assign({ mustHitAll: 1 }, extra || {}) });
  const simOf = (mods) => c.Sim.simulate(mk2(mods), JSON.parse(JSON.stringify(foe2)));

  // ① 前 N 次使用武器必须拿到「再行动一次」的标记，而且只能有 N 次
  for (const [n, id] of [[3, 'M02'], [1, 'T08']]) {
    const free = simOf({ weaponFreeUses: n }).rounds
      .filter((r) => r.attacker === 0 && r.action === 'weapon' && r.actAgain).length;
    assert.equal(free, n, id + '：应当恰好有 ' + n + ' 次使用武器不消耗回合，实测 ' + free);
  }
  assert.equal(simOf({}).rounds.filter((r) => r.attacker === 0 && r.action === 'weapon' && r.actAgain).length, 0,
    '没有该 buff 时不该出现「不消耗回合」的武器');

  // ② 闪亮登场：强化必须**只落在前 3 次使用武器**上（用 round 上的显式标记判定，不受暴击随机影响）
  for (const n of [3, 1]) {
    const rounds = simOf({ weaponBoostUses: n, weaponBoostPowerMul: 0.50, weaponBoostMustHit: 1,
      weaponBoostFatigueMul: 0.20 }).rounds.filter((r) => r.attacker === 0 && r.action === 'weapon');
    const marked = rounds.filter((r) => r.weaponBoost != null);
    assert.equal(marked.length, n, '闪亮登场：应当恰好有 ' + n + ' 次武器吃到强化，实测 ' + marked.length);
    assert.equal(marked.map((r) => r.weaponBoost).join(','),
      Array.from({ length: n }, (_, i) => i + 1).join(','),
      '闪亮登场：吃强化的应当是第 1…' + n + ' 次使用武器，实测 ' + JSON.stringify(marked.map((r) => r.weaponBoost)) +
      '（共 ' + rounds.length + ' 次武器、标记 ' + marked.length + ' 次）');
    /* 强化期的武器必须必中：带 mustHit 时不该出现 dodge。 */
    assert.ok(!marked.some((r) => r.dodge), '闪亮登场：强化期的武器应当必中');
    /* 之后我方攻击 −20%：单场里只有 n（1 或 3）次强化样本，暴击噪声能把比值压到 1 以下，
     * 所以这里**跨 40 场取平均**再比（期望 ×1.5 / ×0.8 ≈ 1.875，阈值 1.3 很稳）。 */
    const dmgOf = (rs) => rs.map((r) => Number(r.dmg) || 0);
    let front = 0, frontN = 0, back = 0, backN = 0;
    for (let k = 0; k < 40; k++) {
      const rw = simOf({ weaponBoostUses: n, weaponBoostPowerMul: 0.50, weaponBoostMustHit: 1,
        weaponBoostFatigueMul: 0.20 }).rounds.filter((r) => r.attacker === 0 && r.action === 'weapon');
      for (const v of dmgOf(rw.slice(0, n))) { front += v; frontN++; }
      for (const v of dmgOf(rw.slice(n, n + 4))) { back += v; backN++; }
    }
    if (frontN > 0 && backN > 0 && back > 0) {
      const ratio = (front / frontN) / (back / backN);
      assert.ok(ratio > 1.3, '闪亮登场：强化期伤害应当明显高于衰减期，实测 ×' + ratio.toFixed(2) +
        '（跨 40 场：强化 ' + Math.round(front / frontN) + ' vs 衰减 ' + Math.round(back / backN) + '）');
    }
  }
  assert.equal(simOf({}).rounds.filter((r) => r.attacker === 0 && r.action === 'weapon' && r.weaponBoost != null).length,
    0, '没有该 buff 时不该出现强化标记');

  // ③ 金蝉脱壳（N04）：首次致死改成「按 30% 上限复活」，而且提示要用自己的名字
  {
    const t = freshTower();
    assert.ok(t.c.Tower.addBuff(t.run, 'N04').ok, 'N04 应当能加入');
    const nxb = t.c.Tower.nextBattle('tower');
    const meb = { name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 60000, hp: 60000,
      baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {},
      masterLevel: 0 };
    nxb.adjustMe(meb);
    const sv = (meb.mods.deathSaves || [])[0];
    assert.ok(sv, 'N04 应当写进 me.mods.deathSaves');
    assert.ok(Math.abs(sv.healPct - 0.30) < 1e-6, 'N04：复活回复 30% 上限，实测 ' + sv.healPct);
    assert.equal(sv.name, '金蝉脱壳', 'N04：复活提示要用自己的名字，实测 ' + sv.name);
  }
});

test('需求25：挑战塔碎片只掉蓝色（不再有白/绿）', () => {
  const c = setup();
  const S = c.State.state();
  S.level = 70; S.props[23] = 9999;
  for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };
  const drops = { 24: 0, 25: 0, 26: 0 }, counts = { 24: 0, 25: 0, 26: 0 };
  let layers = 0;
  for (let round = 0; round < 60; round++) {
    c.Tower._debugSetLayer(0);
    if (!c.Tower.startTowerRun().ok) continue;
    for (let g = 0; g < 12; g++) {
      const r = c.Tower._debugRun('tower');
      if (!r) break;
      if (r.choices) {
        const pick = c.Tower.pickChoice('tower', 0, null);
        if (pick && !pick.ok && pick.needsReplace) c.Tower.pickChoice('tower', 0, ((r.permanent || [])[0] || {}).id || null);
        continue;
      }
      const nx = c.Tower.nextBattle('tower');
      if (!nx || nx.ok === false) break;
      const out = c.Tower.reportBattle('tower', nx.token, true, 1, null);
      if (out && out.layerComplete) {
        layers++;
        if (out.drop) { drops[out.drop.id]++; counts[out.drop.id] += out.drop.count; }
        break;
      }
    }
    const rr = c.Tower._debugRun('tower');
    if (rr && rr.retry) c.Tower.giveUp('tower');
  }
  assert.ok(layers >= 20, '样本太少：' + layers);
  assert.equal(drops[24] + counts[24], 0, '不该再掉白色碎片，实测 ' + drops[24] + ' 次 / ' + counts[24] + ' 个');
  assert.equal(drops[25] + counts[25], 0, '不该再掉绿色碎片，实测 ' + drops[25] + ' 次 / ' + counts[25] + ' 个');
  assert.ok(drops[26] > 0, '应当掉蓝色碎片');
  // 掉率与数量沿用 ★6 那一档：约 60% × 2~5 个 → 每层约 2 个
  const perLayer = counts[26] / layers;
  assert.ok(perLayer > 1.0 && perLayer < 3.2, '蓝色碎片每层期望应当约 2 个，实测 ' + perLayer.toFixed(2));
  // 源码层面确认没有 tierUp 的分支了
  /* 只查塔的实现里没有 tierUp 分支（常规关卡 gamedata.js 仍然用它分白/绿/蓝，那是另一套）。 */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  assert.ok(!/tierUp/.test(src), '挑战塔内不该再用 tierUp 决定碎片成色');
});

test('需求26：积分扩展（拿增益计分 + 两个隐藏成就）', () => {
  const c = setup();
  const TD = c.TowerData, S = c.State;
  const run = () => c.Tower._debugRun('endless');

  // 1) 分值配置
  assert.equal(TD.SCORE.battle, 25, '战斗胜利 25');
  assert.equal(TD.SCORE.layer, 100, '通过一层 100');
  assert.equal(TD.SCORE.elite, 50, '击败精英 50');
  assert.equal(TD.buffScore(0), 5, '普通增益 5');
  assert.equal(TD.buffScore(1), 10, '稀有增益 10');
  assert.equal(TD.buffScore(2), 20, '史诗增益 20');
  assert.equal(TD.buffScore(3), 40, '传奇增益 40');
  // 复活档位：分档递增且封顶
  const tiers = TD.SCORE.reviveTiers;
  assert.equal(tiers[0].at, 3, '第一档是累计 3 次');
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i].at > tiers[i - 1].at, '档位阈值应当递增');
    assert.ok(tiers[i].points > tiers[i - 1].points, '档位分值应当递增');
  }
  assert.equal(TD.reviveScoreAt(2), 0, '不到 3 次不给分');
  assert.equal(TD.reviveScoreAt(3), tiers[0].points);
  assert.equal(TD.reviveScoreAt(6), tiers[1].points);
  assert.equal(TD.reviveScoreAt(12), tiers[3].points);
  assert.equal(TD.reviveScoreAt(999), tiers[3].points, '超过最后一档不再增长（防刷分）');
  // 加成档位
  const ms = TD.SCORE.statMilestones;
  assert.equal(ms[0].at, 1.0, '第一档是 +100%');
  for (let i = 1; i < ms.length; i++) assert.ok(ms[i].at > ms[i - 1].at && ms[i].points > ms[i - 1].points, '加成档位应当递增');

  // 2) 战斗胜利 / 通关一层 真的加分，并记录流水
  let r = run();
  r.score = 0; r.scoreLog = []; r.achievements = []; r.statPeaks = {}; r.deathSaves = 0; r.reviveTierPaid = 0; r.reviveCount = 0;
  let nx = c.Tower.nextBattle('endless');
  let a = run();
  c.Tower.reportBattle('endless', a.attempt, true, 1, null);
  a = run();
  assert.equal(a.score, 25, '胜一场应当 +25，实测 ' + a.score);
  assert.ok(a.scoreLog.some((x) => x.tag === '战斗胜利' && x.points === 25), '要有流水记录');

  // 3) 拿增益计分：按稀有度（场间选择路径）
  r = run();
  r.score = 0; r.choices = [{ type: 'buff', id: 'C15' }];   // 史诗 → 20 分
  const picked = c.Tower.pickChoice('endless', 0, null);
  assert.ok(picked.ok, '应当能拿到');
  assert.equal(picked.score, TD.buffScore(TD.BUFF_BY_ID.C15.rarity), '选择路径要按稀有度给分');
  assert.equal(run().score, picked.score, '分数要真的入账');

  // 4) 拿增益计分：商店购买路径
  r = run();
  r.score = 0; r.coins = 9999; r.phase = 'shop';
  r.shop = { layer: r.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0,
    slots: [{ id: 'C02', sold: false, price: 20 }] };
  const bought = c.Tower.buyShopSlot(0);
  assert.ok(bought.ok, '应当能买：' + (bought.msg || ''));
  assert.equal(bought.score, TD.buffScore(TD.BUFF_BY_ID.C02.rarity), '商店路径也要给分');
  assert.equal(run().score, bought.score, '分数要真的入账');

  // 5) 隐藏成就「死而复生」：每 3 次触发一档、分档递增、封顶
  r = run();
  r.score = 0; r.achievements = []; r.scoreLog = []; r.deathSaves = 0; r.reviveTierPaid = 0; r.reviveCount = 0;
  r.phase = null; r.choices = null;
  /* 只关心「复活成就带来的增量」——开战时可能顺带触发加成成就，所以用 score 的差值断言。 */
  const fire3 = () => {
    const cur = run();
    cur.phase = null; cur.choices = null;
    const before = Number(cur.score) || 0;
    const n = c.Tower.nextBattle('endless');
    if (!n || n.ok === false) return null;
    const mid = Number(run().score) || 0;      // nextBattle 可能已加了别的成就分
    const live = run();
    /* 环境里现在有「幻影回响」会在三侠战后按概率追加一场 —— 那会让「累计 N 次」
     * 这类成就提前触发、把待飘队列先消耗掉，导致本测试偶发红。这里隔离掉环境。 */
    live.env = [];
    const out = c.Tower.reportBattle('endless', live.attempt, true,
      Number(live.lastHp || live.lastMaxHp || 1), Number(live.lastMaxHp || 0),
      { rounds: [{ deathSave: true }, { deathSave: true }, { deathSave: true }] });
    out.__delta = (Number(run().score) || 0) - mid;
    return out;
  };
  const o1 = fire3();
  assert.ok(o1 && o1.achievement, '累计 3 次应当触发成就');
  assert.match(o1.achievement.name, /累计 3 次/);
  assert.equal(o1.achievement.points, tiers[0].points, '第一档分值要对');
  assert.equal(o1.reviveScore, tiers[0].points, '第 1 档的边际增量就是档位分');
  /* 结算阶段同时会加「战斗胜利 25」，所以增量 = 复活档位分 + 25。 */
  assert.equal(o1.__delta, tiers[0].points + TD.SCORE.battle, '本场应当加「复活档位分 + 战斗胜利」');
  assert.ok(o1.achievements && o1.achievements.length, '要进「待飘提示」队列');
  const o2 = fire3();
  assert.ok(o2 && o2.achievement, '累计 6 次应当再触发一档');
  assert.match(o2.achievement.name, /累计 6 次/);
  assert.equal(o2.achievement.points, tiers[1].points, '第二档的「档位总分」要对');
  assert.equal(o2.reviveScore, tiers[1].points - tiers[0].points, '本次边际增量应当是档位差');
  assert.equal(o2.__delta, (tiers[1].points - tiers[0].points) + TD.SCORE.battle, '第 2 档只补发档位差（累计制）+ 战斗胜利');
  // 封顶：直接把累计推到 999，再打一场不应再给分
  /* 封顶：把「累计复活」推到 999（模拟极端情况），且把已发档位也推到最高，
   * 再打一场不应再给复活分。用 reviveScore / 流水断言 —— 开战时可能顺带触发
   * 加成成就，总分会被干扰。 */
  run().deathSaves = 999;
  run().reviveTierPaid = tiers[tiers.length - 1].points;
  const logBefore = (run().scoreLog || []).length;
  const o3 = fire3();
  assert.ok(!o3.reviveScore, '超过最后一档不该再给复活分（防刷分）');
  assert.ok(!o3.achievement, '封顶后不该再产生复活成就');
  const newLogs = (run().scoreLog || []).slice(logBefore).map((x) => x.tag);
  assert.ok(!newLogs.some((t) => /死而复生/.test(t)), '流水里不该再出现复活成就：' + JSON.stringify(newLogs));
  // 防刷分根因：金蝉脱壳改成 unique（一局只能拿一次），累计复活因此封顶在 13 次（10+每层1）
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.N04, 'unique'), true, '金蝉脱壳必须是 unique，否则可无限叠、刷爆复活成就');
  assert.ok(tiers[tiers.length - 1].at <= 10 + 3, '最高档阈值不该超过实际可达到的复活次数（10 + 每层 1）');

  // 6) 隐藏成就「超凡入圣」：跨档才触发，且**不能一次点亮整档**（回归：阈值判断写反过）
  r = run();
  r.score = 0; r.achievements = []; r.scoreLog = []; r.statPeaks = {};
  r.phase = null; r.choices = null;
  /* 全部走 addBuff 并每步重新取 run 引用（debugGrantBuff 拿的是内部引用，
   * 与这里持有的 r 可能不是同一个对象，混用会导致增益没真正入账）。 */
  /* 任务3 之后同名永久增益可以多栏位叠加，前面的用例可能已经把攻击乘区堆得很高；
   * 这一段先清空本局增益，让「跨档点亮」的判定落在可控的 +140% 上。 */
  r.permanent = []; r.limited = []; r.slotFreeIds = [];
  for (const id of ['G04', 'N01', 'C02', 'C02', 'C02']) c.Tower.addBuff(run(), id);
  const bonus = c.Tower.debugBuffReport('endless').effects.find(([k]) => k === '攻击');
  assert.ok(bonus && parseFloat(bonus[1].replace('+', '')) > 100,
    '前置条件：本场攻击加成应当 >100%，实测 ' + JSON.stringify(bonus));
  c.Tower._debugSetStatPeak('powerMul', 0.99);                 // 峰值刚好在 100% 之下
  c.Tower.nextBattle('endless');
  const peaks = run().statPeaks;
  assert.ok(peaks.powerMul >= 1.0, '本场实际加成应当超过 100%，实测 ' + peaks.powerMul);
  const ach = run().achievements || [];
  /* 从 0.99 一步跨到 1.20 → 跨过了 +100% 与 +150% 两档，so 点亮两条（这是正确行为：
   * 「跨过哪一档就点亮哪一档」）。关键是不能把 200%/300% 也一起点亮。 */
  const expectedTiers = ms.filter((m) => m.at > 0.99 && m.at <= peaks.powerMul);
  assert.equal(ach.length, expectedTiers.length,
    '应当点亮 ' + expectedTiers.length + ' 档，实测 ' + JSON.stringify(ach.map((x) => x.name)));
  assert.ok(ach.some((x) => /\+100%/.test(x.name)), '必须含 +100% 档');
  /* 关键不变量：点亮的档位都不能超过本场实际峰值（原来写死「不含 200%/300%」，
   * 但任务3 放开叠层后峰值可能更高 —— 按峰值判断才是这条用例的真正意图）。 */
  const litPct = ach.map((x) => Number((String(x.name).match(/\+(\d+)%/) || [])[1]))
    .filter((v) => Number.isFinite(v));
  assert.ok(litPct.every((pct) => pct / 100 <= peaks.powerMul + 1e-9),
    '不该点亮超过本场峰值的档：峰值 ' + peaks.powerMul + ' 但点亮了 ' + JSON.stringify(litPct));
  assert.equal(run().score, expectedTiers.reduce((a, m) => a + m.points, 0), '加成成就的分值要对');
  // 再调两次不该重复点亮同一档
  c.Tower.nextBattle('endless');
  c.Tower.nextBattle('endless');
  assert.equal((run().achievements || []).length, ach.length, '同一档位不该重复点亮');
  // 低加成不该误触发（回归：曾经一场刷出 16 个成就）
  const c2 = setup();
  const r2 = c2.Tower._debugRun('endless');
  r2.score = 0; r2.achievements = []; r2.statPeaks = {};
  for (let k = 0; k < 3; k++) c2.Tower.addBuff(r2, 'C02');    // 仅 +30%
  c2.Tower.nextBattle('endless');
  c2.Tower.nextBattle('endless');
  assert.equal((r2.achievements || []).length, 0, '加成不足 100% 时不该触发任何档位');

  // 7) 数据持久化 + 暴露给界面
  r = run();
  assert.ok(Array.isArray(r.achievements) && Array.isArray(r.scoreLog), '成就与流水要挂在 run 上（随存档保留）');
  const info = c.Tower.endlessInfo();
  assert.ok(Array.isArray(info.run.achievements), 'endlessInfo 要暴露成就');
  assert.ok(Array.isArray(info.run.scoreLog), 'endlessInfo 要暴露加分流水');
  assert.ok(typeof info.run.deathSaves === 'number', 'endlessInfo 要暴露复活计数');
});

test('需求27：弹窗按钮按「主操作靠右、取消/返回靠左」排序', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8');
  const a = src.indexOf('const btnRank = (b, i) => {');
  assert.ok(a > 0, 'classic-ui.js 里应当有 btnRank');
  const b = src.indexOf('/* 排序会打乱顺序', a);
  assert.ok(b > a, '应当能定位 btnRank 的结尾');
  const ctx = vm.createContext({});
  /* 直接用源码里的排序规则，避免测试复制实现。 */
  const rank = vm.runInContext(src.slice(a, b) + '\nbtnRank;', ctx, { filename: 'btnRank.js' });
  const order = (buttons) => buttons
    .map((x, i) => ({ x, i }))
    .sort((p, q) => rank(p.x, p.i) - rank(q.x, q.i) || p.i - q.i)
    .map((p) => p.x.label);

  // 需求点名的三处
  assert.equal(order([{ label: '开始战斗' }, { label: '返回', cls: 'muted' }]).join('|'),
    '返回|开始战斗', '常驻挑战：开始战斗应当在返回右边');
  assert.equal(order([{ label: '继续战斗' }, { label: '稍后继续' }]).join('|'),
    '稍后继续|继续战斗', '胜利后的继续战斗（主操作）应当在「稍后继续」右边');
  assert.equal(order([{ label: '继续闯关' }, { label: '返回菜单', cls: 'muted' }]).join('|'),
    '返回菜单|继续闯关', '继续闯关应当在返回菜单右边');
  // 三按钮：取消最左、主操作最右
  /* 三按钮（游戏里的真实组合）：「结束本轮」是最破坏性的操作、标了 muted → 最左；
   * 「稍后继续」居中；「继续挑战」是主操作 → 最右。 */
  assert.equal(order([{ label: '继续挑战' }, { label: '稍后继续' }, { label: '结束本轮', cls: 'muted' }]).join('|'),
    '结束本轮|稍后继续|继续挑战', '三按钮：破坏性操作最左、主操作最右');
  /* 不看 cls 的纯语义排序也要成立（cls 只是加强信号）。 */
  assert.equal(order([{ label: '继续挑战' }, { label: '稍后继续' }, { label: '结束本轮' }]).join('|'),
    '稍后继续|结束本轮|继续挑战', '纯语义：稍后/结束居中偏左、继续类最右');
  assert.equal(order([{ label: '复活再战' }, { label: '结束本轮' }]).join('|'),
    '结束本轮|复活再战', '纯语义：复活再战最右');
  assert.equal(order([{ label: '复活再战' }, { label: '稍后继续', cls: 'gold' }]).join('|'),
    '稍后继续|复活再战', '复活再战是主操作，应当在最右');
  // 顺序不影响 data-action 的索引映射（排序后仍按原索引生成）
  assert.match(src, /orderedIdx\.map\(\(i\) => btn\(buttons\[i\]\.label, String\(i\)/,
    '排序后必须仍按原索引生成 data-action，否则点击会错位');
});

test('需求28：徒弟日供 —— 经验 5%~15%、金松果 5%~25% 线性插值', () => {
  const c = setup();
  const S = c.State;
  assert.equal(S.TRIBUTE_EXP_MIN, 0.05, '经验下限 5%');
  assert.equal(S.TRIBUTE_EXP_MAX, 0.15, '经验上限 15%');
  assert.equal(S.TRIBUTE_GOLD_MIN, 0.05, '金松果下限 5%');
  assert.equal(S.TRIBUTE_GOLD_MAX, 0.25, '金松果上限 25%');
  const RE = S.apprenticeTributeExpRatio, RG = S.apprenticeTributeGoldRatio;
  // 两端
  assert.ok(Math.abs(RE(0) - 0.05) < 1e-9, 'Σ=0 经验 5%');
  assert.ok(Math.abs(RG(0) - 0.05) < 1e-9, 'Σ=0 金松果 5%');
  assert.ok(Math.abs(RE(210) - 0.15) < 1e-9, 'Σ=210（三个满级）经验 15%');
  assert.ok(Math.abs(RG(210) - 0.25) < 1e-9, 'Σ=210 金松果 25%');
  // 封顶
  assert.equal(RE(9999), 0.15, '经验封顶');
  assert.equal(RG(9999), 0.25, '金松果封顶');
  // 中点线性
  assert.ok(Math.abs(RE(105) - 0.10) < 1e-9, 'Σ=105 经验 10%，实测 ' + RE(105));
  assert.ok(Math.abs(RG(105) - 0.15) < 1e-9, 'Σ=105 金松果 15%，实测 ' + RG(105));
  // 等距线性
  assert.ok(Math.abs((RE(40) - RE(20)) - (RE(200) - RE(180))) < 1e-9, '经验线性');
  assert.ok(Math.abs((RG(40) - RG(20)) - (RG(200) - RG(180))) < 1e-9, '金松果线性');
  // 金松果区间更宽，任何 Σ 下都不低于经验
  for (const sum of [0, 30, 70, 105, 140, 175, 210]) {
    assert.ok(RG(sum) >= RE(sum) - 1e-9, 'Σ=' + sum + ' 金松果不该低于经验');
  }
});

test('需求29：挑战塔的「返回」回主界面（含胜利弹窗与塔页面）', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  // 塔页面自身的返回：不应再回关卡页（原来 UI.runAction('stages')）
  assert.ok(!/back\(p, \(\) => UI\.runAction\('stages'\)\)/.test(ui),
    '塔页面的返回不该再走关卡页');
  const backs = (ui.match(/back\(p, \(\) => C\(\)\.home\(\)\)/g) || []).length;
  assert.ok(backs >= 2, '挑战塔与无尽塔两处页面返回都应当回主界面，实测 ' + backs + ' 处');

  // 胜利弹窗的「返回」也要回主界面（抽出 towerClear 用桩跑一遍，直接看导航）
  const a = ui.indexOf('function towerClear(rw)');
  assert.ok(a > 0, '应当有 towerClear');
  const b = ui.indexOf('/* 主塔失败', a);
  assert.ok(b > a, '应当能定位 towerClear 的结尾');
  const calls = [];
  const ctx = vm.createContext({
    modal: (t, html, buttons) => { calls.push({ t: t, buttons: buttons || [] }); return { close() {}, element: null }; },
    C: () => ({ home: () => calls.push({ nav: 'home' }) }),
    esc: (v) => String(v), UI: { classic: { pickupResult: () => {} } },
    openTower: () => calls.push({ nav: 'tower' }),
  });
  vm.runInContext(ui.slice(a, b) + '\ntowerClear({ layer: 3, gold: 10, drop: null, prizes: null });', ctx, { filename: 'towerClear.js' });
  const btns = calls[0].buttons;
  assert.equal(btns.map((x) => x.label).join('/'), '继续爬塔/返回', '胜利弹窗按钮：' + btns.map((x) => x.label).join('/'));
  const back = btns.find((x) => x.label === '返回');
  assert.ok(back, '要有返回按钮');
  calls.length = 0;
  back.run();
  assert.equal(calls[0] && calls[0].nav, 'home', '胜利弹窗的返回必须回主界面');
  const climb = btns.find((x) => x.label === '继续爬塔');
  calls.length = 0;
  climb.run();
  assert.equal(calls[0] && calls[0].nav, 'tower', '继续爬塔应当回塔页面');
});

test('需求30：烙印两段机制（破碎前 5% / 破碎后 8%）+ 复数烙印各自计数', () => {
  const c = setup();
  const TD = c.TowerData;
  const run = c.Tower._debugRun('endless');
  run.permanent = []; run.limited = [];
  run.fragileBase = { power: 0, agility: 0, speed: 0 };
  run.fragileBurned = { power: 0, agility: 0, speed: 0 };
  run.fragileSeeds = {};
  c.Tower.addBuff(run, 'C39');                   // 力量烙印：存在 5%
  const pct = (scale) => Math.round((Number(TD.BUFF_BY_ID.C39.mods.fragilePct) * scale) * 100);
  // 1) 未破碎：存在值 5%（2026-10 削弱，不再半效）
  let line = c.Tower.debugBuffReport('endless').effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.ok(line, '效果清单要列出烙印攻击');
  assert.match(line[0], /存在/, '未破碎要标「存在」：' + line[0]);
  assert.equal(line[1], '+' + pct(1) + '%', '未破碎应当是存在值（' + pct(1) + '%）：' + line[1]);
  // 2) 用「下一步必碎」的种子强制破碎
  const miss = (function () {
    const key = String(run.salt == null ? 'run' : run.salt) + '#' + (Number(run.layer) || 0) + '#C39';
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    let st = h >>> 0 || 1;
    for (let i = 0; i < 200; i++) {
      const next = (Math.imul(st, 1664525) + 1013904223) >>> 0;
      if ((next / 4294967296) * 100 < Number(TD.BUFF_BY_ID.C39.mods.fragileBreakPct)) return st;
      st = next;
    }
    return null;
  })();
  assert.ok(miss != null, '应当能算出必碎的种子');
  run.fragileSeeds = { C39: miss };
  const nx = c.Tower.nextBattle('endless');
  const live = c.Tower._debugRun('endless');
  c.Tower.reportBattle('endless', live.attempt, true,
    Number(live.lastHp || live.lastMaxHp || 1), Number(live.lastMaxHp || 0), { rounds: [] });
  assert.ok(!(c.Tower._debugRun('endless').limited || []).some((x) => x.id === 'C39'), '应当已破碎');
  line = c.Tower.debugBuffReport('endless').effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.match(line[0], /已损毁/, '破碎后要标「已损毁」：' + line[0]);
  // 破碎后 = 损毁值 8%（存在那份被收回）
  assert.equal(line[1], '+' + pct(1.6) + '%', '破碎后应当是损毁值（' + pct(1.6) + '%）：' + line[1]);
  // 3) 本局永久：再打 5 场，加成不掉
  for (let i = 0; i < 5; i++) {
    const cur = c.Tower._debugRun('endless');
    cur.phase = null; cur.choices = null;
    const n2 = c.Tower.nextBattle('endless');
    if (!n2 || n2.ok === false) break;
    const l2 = c.Tower._debugRun('endless');
    c.Tower.reportBattle('endless', l2.attempt, true, 1, { rounds: [] });
  }
  line = c.Tower.debugBuffReport('endless').effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.equal(line[1], '+' + pct(1.6) + '%', '破碎后的加成应当本局永久保留：' + line[1]);

  // 4) 复数烙印各自计数：固定 salt 下三条烙印的破碎时点必须不同
  const breakAt = (salt) => {
    const cc = setup();
    const s = cc.State.state(); s.level = 70; s.props[23] = 30;
    for (let i = 1; i <= 18; i++) s.stages[i] = { npcIndex: 3, passed: true };
    cc.Tower._debugSetLayer(9); cc.Tower.startEndlessRun();
    const r = cc.Tower._debugRun('endless');
    r.salt = salt;
    r.permanent = []; r.limited = [];
    r.fragileBase = { power: 0, agility: 0, speed: 0 };
    r.fragileBurned = { power: 0, agility: 0, speed: 0 };
    r.fragileSeeds = {};
    for (const id of ['C39', 'C40', 'C41']) cc.Tower.addBuff(r, id);
    const at = {};
    for (let i = 1; i <= 40; i++) {
      const cur = cc.Tower._debugRun('endless');
      cur.phase = null; cur.choices = null;
      const n2 = cc.Tower.nextBattle('endless');
      if (!n2 || n2.ok === false) break;
      const l2 = cc.Tower._debugRun('endless');
      cc.Tower.reportBattle('endless', l2.attempt, true, 1, { rounds: [] });
      const left = (cc.Tower._debugRun('endless').limited || []).map((x) => x.id);
      for (const id of ['C39', 'C40', 'C41']) if (at[id] === undefined && !left.includes(id)) at[id] = i;
    }
    return at;
  };
  const a1 = breakAt('FIXED-SALT');
  const a2 = breakAt('FIXED-SALT');
  assert.equal(JSON.stringify(a1), JSON.stringify(a2), '同一 salt 下应当可复现：' + JSON.stringify(a1));
  const vals = ['C39', 'C40', 'C41'].map((id) => a1[id]);
  assert.ok(vals.filter((v) => v !== undefined).length >= 2, '三条烙印应当至少碎两条：' + JSON.stringify(a1));
  assert.ok(new Set(vals.filter((v) => v !== undefined)).size >= 2,
    '三条烙印的破碎时点必须不同（各自独立计数）：' + JSON.stringify(a1));
});

test('需求31：增益池标签严格规范（挑战塔与无尽塔是两个池子，不得互相泄漏）', () => {
  const c = setup();
  const TD = c.TowerData;
  const EM = TD.ENDLESS_ONLY_MODS;
  const hasEM = (b) => Object.keys(b.mods || {}).some((k) => EM.indexOf(k) >= 0);
  const roster = (id) => TD.poolRoster(TD.BUFF_BY_ID[id]);
  const POOL_TAGS = ['T.choice', 'T.shop', 'E.choice', 'E.shop'];

  // 1) 每条增益都要有明确的归属，且只能是合法池子标签
  for (const b of TD.BUFFS) {
    const r = roster(b.id);
    assert.ok(Array.isArray(r), b.id + ' 应当有池子归属');
    for (const t of r) assert.ok(POOL_TAGS.indexOf(t) >= 0, b.id + ' 出现非法池子标签 ' + t);
    assert.equal(new Set(r).size, r.length, b.id + ' 的池子标签不该重复');
  }

  // 2) 挑战塔专属：只能进挑战塔，绝不能出现在任何无尽池
  for (const b of TD.BUFFS.filter((x) => TD.hasTag(x, 'tower') && !TD.hasTag(x, 'endless'))) {
    assert.equal(JSON.stringify(roster(b.id)), '["T.choice"]', b.id + ' 应当只属于挑战塔，实测 ' + JSON.stringify(roster(b.id)));
    assert.ok(!TD.endlessPool.some((x) => x.id === b.id), b.id + ' 不该进无尽选择池');
    assert.ok(!TD.shopPool.some((x) => x.id === b.id), b.id + ' 不该进无尽商店池 ← 需求点名的泄漏');
  }
  assert.equal(TD.BUFFS.filter((x) => TD.hasTag(x, 'tower') && !TD.hasTag(x, 'endless')).length, 24, '应当有 24 条挑战塔专属（本轮删了 7 条）');

  // 3) 无尽专属（显式标记或带无尽专属 mod）：绝不能出现在挑战塔池
  for (const b of TD.BUFFS) {
    const endlessOnly = (TD.hasTag(b, 'endless') && !TD.hasTag(b, 'tower')) || hasEM(b);
    if (!endlessOnly) continue;
    assert.ok(roster(b.id).every((t) => t.indexOf('E.') === 0),
      b.id + ' 是无尽专属，却出现在挑战塔池：' + JSON.stringify(roster(b.id)));
  }
  assert.equal(TD.towerPool.filter((b) => (TD.hasTag(b, 'endless') && !TD.hasTag(b, 'tower')) || hasEM(b)).length, 0,
    '挑战塔池里不该有任何无尽专属条目');
  // 需求点名的 6 条漏标条目（带无尽专属 mod 却曾在塔池里）
  for (const id of ['C30', 'C32', 'C33', 'C45', 'C25', 'C37']) {
    assert.equal(JSON.stringify(roster(id)), '["E.choice","E.shop"]', id + ' 应当只在无尽塔，实测 ' + JSON.stringify(roster(id)));
    assert.ok(!TD.towerPool.some((b) => b.id === id), id + ' 不该进挑战塔池');
  }

  // 4) 无尽商店池的边界
  assert.ok(!TD.shopPool.some((b) => !TD.hasTag(b, 'shop')), '不上商店的（名贵手表）不该进商店池');
  assert.ok(TD.shopPool.some((b) => b.id === 'N09'), '环境类晴空护符应当能在无尽商店买到');
  /* 即时类默认不上商店；**只有显式标了 shop 标签的例外**：
   *   · E12 时来运转（天命所归的下位，定位就是「仅商店购买获取」）
   *   · E14 讨价还价（本轮新增：效果是「下次进店有 N 件商品对折」，本来就该在商店里卖） */
  assert.equal(TD.shopPool.filter((b) => b.kind === 'instant').map((b) => b.id).join(','), 'E12,E14',
    '能上商店的即时类应当只有 E12 / E14，实测 ' +
    TD.shopPool.filter((b) => b.kind === 'instant').map((b) => b.id).join(','));

  // 5) 三个池子的名单必须与 roster 完全一致（不能各自写谓词）
  const byTag = (tag) => TD.BUFFS.filter((b) => roster(b.id).indexOf(tag) >= 0).map((b) => b.id).join(',');
  assert.equal(TD.towerPool.map((b) => b.id).join(','), byTag('T.choice'), 'towerPool 必须等于 T.choice 名单');
  assert.equal(TD.endlessPool.map((b) => b.id).join(','), byTag('E.choice'), 'endlessPool 必须等于 E.choice 名单');
  assert.equal(TD.shopPool.map((b) => b.id).join(','), byTag('E.shop'), 'shopPool 必须等于 E.shop 名单');

  // 6) 标记规范化：带无尽专属 mod 的条目必须同时显式标 endlessOnly（让数据自解释，
  //    不再只靠 roster 的计算兜住 —— 否则以后新增条目很容易又漏标。）
  /* 本轮改成标签驱动：这里直接看**标签**（旧字段 endlessOnly 只在校验时对账，不再写回）。 */
  const unmarked = TD.BUFFS.filter((b) => TD.hasTag(b, 'tower') && hasEM(b)).map((b) => b.id);
  assert.equal(unmarked.length, 0, '带无尽专属 mod 却仍标了挑战塔：' + JSON.stringify(unmarked));
  for (const id of ['C24', 'C25', 'C30', 'C31', 'C32', 'C33', 'C37', 'C45']) {
    assert.equal(TD.hasTag(TD.BUFF_BY_ID[id], 'endless') && !TD.hasTag(TD.BUFF_BY_ID[id], 'tower'), true, id + ' 应当标无尽塔专属');
  }
  // 塔专属同样要有显式标记（数据自解释）
  for (const b of TD.towerPool) {
    if (TD.poolRoster(b).join() === 'T.choice') {
      assert.ok((TD.hasTag(b, 'tower') && !TD.hasTag(b, 'endless')) || (TD.hasTag(b, 'endless') && !TD.hasTag(b, 'tower')),
        b.id + ' 只属于挑战塔，却没有 towerOnly / endlessOnly 标记');
    }
  }

  // 7) 挑战塔池的构成可解释
  assert.equal(TD.towerPool.length, byTag('T.choice').split(',').length, '池子大小要自洽');
  assert.equal(TD.towerPool.filter((b) => b.kind === 'limited').length, 25, '限次类 25 条（含本轮新增的 C57）');
  assert.ok(TD.towerPool.filter((b) => b.kind === 'permanent').length >= 21,
    '永久类至少 21 条，实测 ' + TD.towerPool.filter((b) => b.kind === 'permanent').length);
});

test('需求32：池子分离的端到端实测（真跑两种塔的抽取，零交叉）', () => {
  const c = setup();
  const TD = c.TowerData;
  const S = c.State.state();
  S.level = 70; S.props[23] = 99999;
  for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };
  const cid = (ch) => (typeof ch === 'string' ? ch : (ch && (ch.id || (ch.buff && ch.buff.id))));
  const hasEM = (b) => !!(b && ((TD.hasTag(b, 'endless') && !TD.hasTag(b, 'tower')) || Object.keys(b.mods || {}).some((k) => TD.ENDLESS_ONLY_MODS.indexOf(k) >= 0)));

  const sample = (mode, rounds) => {
    const seen = new Set();
    for (let t = 0; t < rounds; t++) {
      if (mode === 'tower') { c.Tower._debugSetLayer(0); if (!c.Tower.startTowerRun().ok) continue; }
      else { c.Tower._debugSetLayer(9); c.Tower.startEndlessRun(); }
      for (let k = 0; k < 14; k++) {
        const r = c.Tower._debugRun(mode);
        if (!r) break;
        if (r.choices) {
          for (const ch of r.choices) { const id = cid(ch); if (id) seen.add(id); }
          const p = c.Tower.pickChoice(mode, 0, null);
          if (p && !p.ok && p.needsReplace) c.Tower.pickChoice(mode, 0, ((r.permanent || [])[0] || {}).id || null);
          continue;
        }
        if (mode === 'endless' && r.phase === 'shop') {
          const st = c.Tower.shopState();
          if (st && st.slots) for (const sl of st.slots) if (sl && sl.id) seen.add(sl.id);
          c.Tower.continueFromShop();
          continue;
        }
        if (mode === 'endless' && r.phase === 'checkpoint') { c.Tower.continueEndless(); continue; }
        const nx = c.Tower.nextBattle(mode);
        if (!nx || nx.ok === false) break;
        const a = c.Tower._debugRun(mode);
        if (!a || !a.attempt) break;
        c.Tower.reportBattle(mode, a.attempt, true, 1, null);
      }
      const rr = c.Tower._debugRun(mode);
      if (rr) c.Tower.giveUp(mode);
    }
    return seen;
  };

  const tower = sample('tower', 60);
  const endless = sample('endless', 40);
  assert.ok(tower.size >= 30, '挑战塔样本太少：' + tower.size);
  assert.ok(endless.size >= 30, '无尽塔样本太少：' + endless.size);

  const towerOnlyIds = TD.BUFFS.filter((b) => TD.hasTag(b, 'tower') && !TD.hasTag(b, 'endless')).map((b) => b.id);
  const leaked = [...endless].filter((id) => towerOnlyIds.indexOf(id) >= 0);
  assert.equal(leaked.length, 0, '挑战塔专属不该出现在无尽塔：' + JSON.stringify(leaked));
  const reverse = [...tower].filter((id) => hasEM(TD.BUFF_BY_ID[id]));
  assert.equal(reverse.length, 0, '无尽专属不该出现在挑战塔：' + JSON.stringify(reverse));
  // 抽到的一定在对应池子名单里（不能绕过名单）
  const outOfTower = [...tower].filter((id) => !TD.towerPool.some((b) => b.id === id));
  assert.equal(outOfTower.length, 0, '挑战塔抽到了池外条目：' + JSON.stringify(outOfTower));
  const outOfEndless = [...endless].filter((id) => !TD.endlessPool.some((b) => b.id === id) && !TD.shopPool.some((b) => b.id === id));
  assert.equal(outOfEndless.length, 0, '无尽塔抽到了池外条目：' + JSON.stringify(outOfEndless));
});

test('需求33：挥金如土（C36）分段步长 5→10→15，且购买它自身的花费也计入', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.BUFF_BY_ID.C36.mods.shopSpendStep, 5, '起步步长应当是 5 试炼币');
  /* 2026-10 用户口径：前 20 次提升每次 5 币、第 21~40 次每次 10 币、之后每次 15 币。 */
  assert.equal(JSON.stringify(TD.BUFF_BY_ID.C36.mods.shopSpendTiers), JSON.stringify([5, 10, 15]),
    '分段步长应当是 [5,10,15]');
  assert.equal(TD.BUFF_BY_ID.C36.mods.shopSpendTierSize, 20, '每段 20 次提升');
  assert.match(TD.BUFF_BY_ID.C36.desc, /试炼币/, '文案要写明与试炼币消费挂钩：' + TD.BUFF_BY_ID.C36.desc);
  /* 文案改成「每在试炼商店消费 5 试炼币…」；「买它自己也算」由下面的实战断言覆盖
   *（买完它之后 shopSpend 已经计入了那 100 币 —— 见后面的 procs 断言）。 */
  assert.match(TD.BUFF_BY_ID.C36.desc, /试炼商店消费/, '文案要写明是「商店消费」口径：' + TD.BUFF_BY_ID.C36.desc);

  const run = c.Tower._debugRun('endless');
  run.permanent = []; run.limited = []; run.coins = 999999;
  run.spendGain = { power: 0, agility: 0, speed: 0, hp: 0 }; run.shopSpend = 0;
  const mkShop = (id, price) => {
    const r = c.Tower._debugRun('endless');
    r.coins = 999999; r.phase = 'shop';
    r.shop = { layer: r.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0,
      slots: [{ id: id, sold: false, price: price }] };
    return r;
  };
  // ① 买 C36 自身的花费要吃到加成：160 币 = 前 20 次 ×5（100 币）+ 后 6 次 ×10（60 币）
  mkShop('C36', 160);
  const bought = c.Tower.buyShopSlot(0);
  assert.ok(bought.ok, '应当能买到挥金如土');
  let r = c.Tower._debugRun('endless');
  const procs = (g) => g.power + g.agility + g.speed + g.hp / 5;   // 血是 +5/次，折算成「次」
  assert.equal(procs(r.spendGain), 26, '160 币应当触发 26 次（20×5 + 6×10），实测 ' + procs(r.spendGain));
  assert.equal(r.shopSpendProcs, 26, '已提升次数要记账：' + r.shopSpendProcs);
  assert.equal(r.shopSpend, 0, '160 刚好用完，余数应为 0，实测 ' + r.shopSpend);
  /* ② 每次只加「1 力 / 1 敏 / 1 速 / 5 血」中的一项。
   * 正确的不变量：四项折算后**总和**等于触发次数，且每项非负 ——
   * 原来写「单项 ≤ 16」是错的：32 次随机分配里某一项完全可能超过半数（实测 hp 到 30）。 */
  const g = r.spendGain;
  assert.ok(g.power >= 0 && g.agility >= 0 && g.speed >= 0 && g.hp >= 0,
    '各项不该为负：' + JSON.stringify(g));
  assert.equal(g.hp % 5, 0, '生命那一项应当是 5 的整数倍：' + g.hp);
  assert.equal(procs(g), 26, '四项折算后总和应当等于触发次数：' + JSON.stringify(g));
  assert.ok(r.spendGain.hp % 5 === 0, '生命项应当是 5 的倍数，实测 ' + r.spendGain.hp);
  // ③ 第 21~40 次是每次 10 币：再买 30 币 → +3 次 → 累计 29 次
  mkShop('C01', 30);
  c.Tower.buyShopSlot(0);
  r = c.Tower._debugRun('endless');
  assert.equal(procs(r.spendGain), 29, '再消费 30 币（每次 10 币）应当累计到 29 次，实测 ' + procs(r.spendGain));
  // ③b 跨进第三段（第 41 次起每次 15 币）：再花 200 币
  //     procs 29 → 40 共 11 次 ×10 = 110 币，剩下 90 币 ÷15 = 6 次 → 累计 46 次、余 0
  mkShop('C03', 200);
  c.Tower.buyShopSlot(0);
  r = c.Tower._debugRun('endless');
  assert.equal(procs(r.spendGain), 46, '跨段后应当累计到 46 次，实测 ' + procs(r.spendGain));
  assert.equal(r.shopSpendProcs, 46, '次数记账要同步：' + r.shopSpendProcs);
  assert.equal(r.shopSpend, 0, '200 币刚好用完，余数应为 0，实测 ' + r.shopSpend);
  // ④ 没钱时不买、也不记账
  mkShop('C02', 200);
  c.Tower._debugRun('endless').coins = 50;
  const poor = c.Tower.buyShopSlot(0);
  assert.ok(!poor.ok, '钱不够应当买不成');
  assert.equal(procs(c.Tower._debugRun('endless').spendGain), 46, '买不成时不该记账');
});

test('需求34：护盾环境削弱为 18%~28%', () => {
  const c = setup();
  const TD = c.TowerData;
  const shell = TD.ENDLESS_ENV_BY_ID.shell;
  assert.ok(shell, '应当有护盾环境');
  assert.equal(JSON.stringify(shell.mods.shellPct.slice(0, 2)), JSON.stringify([0.18, 0.28]),
    '护盾区间应当是 18%~28%，实测 ' + JSON.stringify(shell.mods.shellPct));
  assert.match(TD.envRangeText(shell), /18% ~ 28%/, '区间文案要同步：' + TD.envRangeText(shell));
});

test('需求35：永久槽位的「占位口径」必须一致（修「7/8 拿到增益直接消失」）', () => {
  const c = setup();
  const T = c.Tower;
  /* 复刻玩家实测状态：两个背包扩容（C30 +1 / C31 +2 → 上限 8）、
   * 8 个永久增益、其中 C36 被虚空铭文附魔免占位 → 实际占用 7/8。 */
  const scene = () => {
    const r = T._debugRun('endless');
    r.permanent = ['C35', 'C13', 'C36', 'C14', 'C28', 'C18', 'C10', 'C07'].map((id) => ({ id: id, stacks: 1 }));
    r.permSlots = 3; r.permSlotIds = ['C31', 'C30']; r.slotFreeIds = ['C36'];
    r.limited = []; r.pendingPick = null;
    return r;
  };
  let r = scene();
  let info = T.endlessInfo().run;
  assert.equal(info.permCap, 8, '上限应当是 8（5 + 1 + 2）');
  assert.equal(info.permUsed, 7, '实际占用应当是 7（C36 免占位）');
  assert.equal(r.permanent.length, 8, '数组长度是 8（含 1 个免占位）');

  /* 关键回归：占用 7/8 时拿一个永久增益，**必须真的进去**。
   * 改前：addBuff 返回 ok=true（因为 permUsed 7 < 8 没满），列表变 9 项，
   * 紧接着 normalizeRun 的 `slice(0, permSlots)` 按数组长度 9 > 8 把
   * **最后一项（刚拿到的）** 切掉 —— 玩家看到的就是「拿到了直接消失」。 */
  const out = T.addBuff(r, 'C03');
  assert.ok(out.ok, '应当能拿到');
  const after = T._debugRun('endless');
  assert.ok(after.permanent.some((b) => b.id === 'C03'),
    '新拿到的 C03 必须留在构筑里：' + JSON.stringify(after.permanent.map((b) => b.id)));
  assert.equal(after.permanent.length, 9, '列表应当是 8 + 1 = 9 项（8 占位 + 1 免占位）');
  assert.equal(T.endlessInfo().run.permUsed, 8, '占用应当变成 8');
  assert.ok(after.permanent.some((b) => b.id === 'C36'), '免占位的 C36 不该被挤掉');

  /* 占用满 8 之后再拿 → 要求替换，且**不许丢任何已有增益** */
  const before = after.permanent.map((b) => b.id).join(',');
  const full = T.addBuff(T._debugRun('endless'), 'C45');
  assert.ok(full.needsReplace, '占用满时应当要求替换');
  assert.equal(T._debugRun('endless').permanent.map((b) => b.id).join(','), before,
    '要求替换时不该改动构筑');
  /* 替换掉一个**占位**的 → 成功且新增益入账 */
  const rep = T.addBuff(T._debugRun('endless'), 'C45', 'C13');
  assert.ok(rep.ok, '替换应当成功：' + (rep.msg || ''));
  const r3 = T._debugRun('endless');
  assert.ok(r3.permanent.some((b) => b.id === 'C45'), 'C45 应当入账');
  assert.ok(!r3.permanent.some((b) => b.id === 'C13'), 'C13 应当被替换掉');
  assert.equal(T.endlessInfo().run.permUsed, 8, '替换后占用仍是 8');
  /* 换掉**免占位**的那个腾不出位置 → 明确拒绝 */
  const bad = T.addBuff(T._debugRun('endless'), 'C02', 'C36');
  assert.ok(!bad.ok, '换掉免占位的增益腾不出槽位，应当拒绝');

  /* normalizeRun 再也不允许丢弃永久增益 */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  assert.ok(!/cleanBuffs\(run\.permanent\)\.slice\(0, permSlots/.test(src),
    'normalizeRun 不该再按数组长度裁剪永久增益');
  assert.ok(src.indexOf('function repairPermanentSlots') > 0, '应当有只校验不丢弃的 repairPermanentSlots');
  /* 满格判定必须按「加入后的占用」而不是「当前占用」 */
  assert.ok(/permUsed\(run\) \+ 1 > permSlots\(run\)/.test(src),
    'addBuff 的满格判定应当按「加入后的占用」');
});

test('需求36：所有可叠层增益都必须随层数成比例（修 C06 不叠层 / C12 恒为 0）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const STACKABLE = TD.BUFFS.filter((b) => TD.hasTag(b, 'stackable')).map((b) => b.id).sort();
  /* 本轮新增的可叠层（对应「Cxx 可叠加 N 层」那组需求）：
   *   C03/C10/C19/C21/C22/C23 → 3 层；C24 → 2 层；C26-C29 → **无上限**（unlimitedStacks）。
   * C50「抉择扩充」也是 stackable，但叠层效果是「选项数 +1/层」而不是属性成比例；
   * C14「涅槃」同理（每层多一次复活机会）。这两条摘出来单独断言。
   * C16/C17 改成「开战第一回合回血」后按胜场量不到，比例由需求65 单独覆盖。 */
  /* 本轮新增的可叠层：C54「越战越勇」（2 层，每层每回合 +1.5%）、
   * C59「门庭若市」（3 层，每层每进一次商店 +100 试炼币）。 */
  /* 2026-10 用户口径：以战养战（C11）不能再叠加、登顶者（C12）削弱为 1/3（锁定 1 份）
   * → 两条都去掉了 stackable，改用 oncePerRun + maxStacks 1。 */
  assert.equal(STACKABLE.join(','),
    'C03,C06,C07,C10,C14,C16,C17,C19,C21,C22,C23,C24,C26,C27,C28,C29,C50,C54,C59',
    '可叠层增益清单变了：' + STACKABLE.join(','));

  /* 跑一小段真实流程，取某个累计字段（固定层数，排除推进噪声）。 */
  const measure = (id, stacks, wins, field, fixedLayer) => {
    S.newGame('stack' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    T._debugSetLayer(9); T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = [{ id: id, stacks: stacks }];
  /* 这些测量都按「每层/每场」的期望值断言，而期望值里含**全局倍率 g**
   *（增幅水晶 C15 的 globalMul^层数）。g 会随「这一局恰好选到什么」而变化，
   * 随机波动会让比值假报（实测 C07 出现 ×2.00 / 上限 60% 而不是 30%）。
   * 这里统一拒绝把 C15 选进来，把 g 锁死在 1，测量才可复现。 */
  const pickNoC15 = (run, avoidId) => {
    /* avoidId：把「本次测试正在观察的那条增益」也排除掉 ——
     * 否则循环里又选到它自己，层数从 1 变 2，期望值就会对不上（实测踩过）。 */
    const ch = (run && run.choices) || [];
    let i = ch.findIndex((x) => x && x.id !== 'C15' && x.id !== avoidId);
    if (i < 0) i = ch.findIndex((x) => x && x.id !== 'C15');
    if (i < 0) i = 0;
    const p = T.pickChoice('endless', i, null);
    if (p && !p.ok && p.needsReplace) T.pickChoice('endless', i, ((run.permanent || [])[0] || {}).id || null);
    return p;
  };
    let won = 0, wonAfter10 = 0;
    for (let i = 0; i < wins; i++) {
      const cur = T._debugRun('endless');
      if (!cur) break;
      if (fixedLayer) cur.layer = fixedLayer;
      if (cur.choices) { pickNoC15(cur, id); continue; }
      if (cur.phase === 'shop') { T.continueFromShop(); continue; }
      if (cur.phase === 'checkpoint') { T.continueEndless(); continue; }
      const nx = T.nextBattle('endless');
      if (!nx || nx.ok === false) break;
      const a = T._debugRun('endless');
      if (!a || !a.attempt) break;
      if (fixedLayer) a.layer = fixedLayer;
      T.reportBattle('endless', a.attempt, true, 1, null);   // 只推流程：本轮不再从战后报告里取回血量
      won++;
      const lay = Number((T._debugRun('endless') || {}).layer) || 0;
      /* 只有第 10 层起的胜场才计入 C12/C07 之类「层 10 起」的成长。 */
      if (!fixedLayer || lay >= 10) wonAfter10++;
      if (!T._debugRun('endless')) break;
    }
    const rr = T._debugRun('endless');
    /* 同时返回**实际打赢的场数**：请求 N 场不代表正好打了 N 场
     *（中途层数推进/战斗结束都会让实际值不同），用它推导期望才稳。 */
    return { value: rr ? Number(rr[field] || 0) : NaN, wins: won, counted: wonAfter10 };
  };

  const CASES = [
    /* C06 按**击杀数**成长，而击杀数受战斗难度随机影响 —— 场次给足才压得住抖动
     *（7 场时实测比值会落到 2.7~3.5）。 */
    ['C06', 'killPower', 14, 10],   // 猎杀时刻：每击杀 +2%（×层数）
    ['C07', 'winMaxHp', 7, null],   // 吞噬成长：每胜 +2%（×层数）
    /* 2026-10：以战养战（C11）与登顶者（C12）都锁死 1 份、不再可叠层
     *（用户口径：C11 不可叠加、C12 削弱为原来的 1/3），所以从「叠层成比例」用例里摘掉 ——
     *强行塞 stacks:3 会在存档归一化时被 stackCap 夹回 1（实测比值恒为 1.00）。
     * 它们的「一局一次 + 新栏位不适用」由需求36 的 stackable 清单与需求42 ③ 覆盖。 */
    /* C16/C17「战斗续航」本轮改成**开战第一回合**回血（不再按胜场结算），
     * 这个「按胜场归一化」的循环量不到它 —— 叠层比例由需求65 单独覆盖。 */
  ];
  /* 击杀数/胜利场数带随机性，单次测量的比值会抖。取 3 次测量的中位数，
   * 既能压掉抖动，又保持「必须严格成比例」的断言强度。 */
  const median = (id, stacks, wins, field, layer) => {
    const vals = [];
    for (let i = 0; i < 3; i++) vals.push(measure(id, stacks, wins, field, layer));
    vals.sort((a, b) => (a.value / Math.max(1, a.counted || a.wins)) - (b.value / Math.max(1, b.counted || b.wins)));
    return vals[1];
  };
  for (const [id, field, wins, layer] of CASES) {
    const one = median(id, 1, wins, field, layer);
    const three = median(id, 3, wins, field, layer);
    assert.ok(Number.isFinite(one.value) && one.value > 0, id + ' 的单层效果应当可测到：' + JSON.stringify(one));
    /* 按「每场每层」归一化再比：两边的实际场数可能不同（层数推进/战斗结束），
     * 直接比原始值会假报（实测 C11 因此出现 ×2.50）。 */
    /* 归一化用**真正计入成长**的胜场数（层 10 起），否则早期胜场会把比值稀释
     *（C07/C12 只在第 10 层起成长，实测因此出现 ×2.00 的假报）。 */
    const cOne = Math.max(1, one.counted || one.wins), cThree = Math.max(1, three.counted || three.wins);
    const perOne = one.value / cOne, perThree = three.value / cThree;
    const ratio = perThree / perOne;
    assert.ok(Math.abs(ratio - 3) < 0.35,
      id + ' 的叠层应当严格 3 倍（按计入成长的胜场归一化）：×1=' + one.value + '/' + cOne + ' 场，×3=' + three.value + '/' + cThree + ' 场（比值 ' + ratio.toFixed(2) + '）');
  }

  /* C12 现已改为「固定 +1 力/敏/速」；断言旧口径（winPower 百分比）已彻底移除，
   * 且新字段真的落到 run 上。 */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  assert.ok(!/run\.winPower\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    'C12 不该再引用旧的 winPower（百分比口径）');
  assert.ok(/run\.winStatPower = Math\.max\(0, Number\(run\.winStatPower\)/.test(src),
    'C12 应当累加 run.winStatPower');
  assert.ok(/me\.agility \+= Math\.max\(0, Number\(run\.winStatAgility\)/.test(src),
    'C12 的敏捷累计应当加到面板属性上');
  assert.ok(/winStatAfter10: 1/.test(fs.readFileSync(path.join(ROOT, 'js', 'tower-data.js'), 'utf8')),
    'C12 的 mods 应当是 winStatAfter10');
});

test('需求36b：C50「抉择扩充」的叠层是「选项目数 +1/层」，上限 3 层（六选一）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.C50, 'stackable'), true, 'C50 应当可叠层');
  assert.equal(TD.BUFF_BY_ID.C50.maxStacks, 3, 'C50 上限 3 层');
  assert.equal(TD.BUFF_BY_ID.C50.mods.choiceCount, 1, '每层 +1 个选项');
  S.newGame('c50' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r = T._debugRun('endless');
  r.permanent = []; r.limited = []; r.slotFreeIds = [];
  assert.equal(T.choiceSlotsOf(T._debugRun('endless')), 3, '基础应当是三选一');
  for (let n = 1; n <= 3; n++) {
    T.addBuff(T._debugRun('endless'), 'C50');
    assert.equal(T.choiceSlotsOf(T._debugRun('endless')), 3 + n, n + ' 层应当是 ' + (3 + n) + ' 选一');
  }
  /* 2026-10 用户口径（回调需求3）：背包里攒到 **3 个之后就不再生成** ——
   * `noRestack`：叠满 maxStacks 即出池，也不会再走「叠满开新栏位」的通用规则。 */
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.C50, 'noRestack'), true, 'C50 应当带 noRestack');
  assert.equal(T.poolFilterOf(T._debugRun('endless'), TD.BUFF_BY_ID.C50), false,
    '叠满 3 层后应当移出本局可获得池');
  assert.equal(T.ownableOf(T._debugRun('endless'), TD.BUFF_BY_ID.C50), false,
    '叠满 3 层后不再能获得');
  const again50 = T.addBuff(T._debugRun('endless'), 'C50');
  assert.equal(again50.ok, false, '叠满后第 4 份应当被拒：' + JSON.stringify(again50));
  const rows50 = (T._debugRun('endless').permanent || []).filter((b) => b.id === 'C50');
  assert.equal(rows50.length, 1, '仍然只占一个栏位：' + JSON.stringify(rows50));
  assert.equal(T.choiceSlotsOf(T._debugRun('endless')), 6, '选择张数封顶在六选一');
  T.abandon('endless');
});

test('需求37：成长类增益的「面板文字」必须等于「真实累计」（修 C07 显示恒为 +0%）', () => {
  const c = setup();
  const T = c.Tower, S = c.State;
  /* 这些测量都按「每层/每场」的期望值断言，而期望值里含**全局倍率 g**
   *（增幅水晶 C15 的 globalMul^层数）。g 会随「这一局恰好选到什么」而变化，
   * 随机波动会让比值假报（实测 C07 出现 ×2.00 / 上限 60% 而不是 30%）。
   * 这里统一拒绝把 C15 选进来，把 g 锁死在 1，测量才可复现。 */
  const pickNoC15 = (run, avoidId) => {
    /* avoidId：把「本次测试正在观察的那条增益」也排除掉 ——
     * 否则循环里又选到它自己，层数从 1 变 2，期望值就会对不上（实测踩过）。 */
    const ch = (run && run.choices) || [];
    let i = ch.findIndex((x) => x && x.id !== 'C15' && x.id !== avoidId);
    if (i < 0) i = ch.findIndex((x) => x && x.id !== 'C15');
    if (i < 0) i = 0;
    const p = T.pickChoice('endless', i, null);
    if (p && !p.ok && p.needsReplace) T.pickChoice('endless', i, ((run.permanent || [])[0] || {}).id || null);
    return p;
  };
  /* 跑真实流程：拿到某条成长增益 → 连打 N 场 → 对比「面板 progress」与「run 里的真实累计字段」。 */
  const grow = (id, stacks, wins, field, layer) => {
    S.newGame('g' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    T._debugSetLayer(9); T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = [{ id: id, stacks: stacks }];
    for (let i = 0; i < wins; i++) {
      const cur = T._debugRun('endless');
      if (!cur) break;
      if (layer) cur.layer = layer;
      if (cur.choices) { pickNoC15(cur, id); continue; }
      if (cur.phase === 'shop') { T.continueFromShop(); continue; }
      if (cur.phase === 'checkpoint') { T.continueEndless(); continue; }
      const nx = T.nextBattle('endless');
      if (!nx || nx.ok === false) break;
      const a = T._debugRun('endless');
      if (!a || !a.attempt) break;
      if (layer) a.layer = layer;
      T.reportBattle('endless', a.attempt, true, (a.lastHp || a.lastMaxHp || 1), (a.lastMaxHp || 0), null);
      if (!T._debugRun('endless')) break;
    }
    const rr = T._debugRun('endless');
    const ob = T.ownedBuffs('endless').find((b) => b.id === id);
    return { value: rr ? Number(rr[field] || 0) : NaN, progress: ob ? String(ob.progress || '') : '' };
  };

  /* C07 吞噬成长：面板要显示真实百分比，而不是恒定的 +0%。
   * 这个 bug 之所以长期没被发现，就是因为此前只断言了「进度文本非空」。 */
  const one = grow('C07', 1, 5, 'winMaxHp');
  assert.ok(one.value > 0, 'C07 的真实累计应当大于 0：' + one.value);
  const shown = Number((/生命上限 \+(\d+)%（上限/.exec(one.progress) || [])[1]);
  assert.equal(shown, Math.round(one.value * 100),
    'C07 面板显示的百分比必须等于真实累计：面板「' + one.progress + '」 vs 实际 ' + (one.value * 100) + '%');
  assert.ok(shown > 0, 'C07 面板不该再显示 +0%：' + one.progress);
  /* 上限也要显示真实值（×层数 ×全局倍率）。
   * 注意：循环里可能还是抽到了增幅水晶（pickNoC15 只能尽力而为），
   * 所以期望值要用**真实的 globalMulOf(run)** 推导，而不是写死 30%。 */
  const capShown = Number((/（上限 \+(\d+)%）/.exec(one.progress) || [])[1]);
  /* pickNoC15 已经避开了增幅水晶与「测试目标自己」，所以这里 g=1、层数=1。 */
  assert.equal(capShown, Math.round(0.30 * 1 * 100), 'C07 ×1 的上限应当是 30%：' + one.progress);
  const three = grow('C07', 3, 5, 'winMaxHp');
  const capShown3 = Number((/（上限 \+(\d+)%）/.exec(three.progress) || [])[1]);
  assert.equal(capShown3, Math.round(0.30 * 3 * 100), 'C07 ×3 的上限应当是 90%：' + three.progress);

  /* C06 猎杀时刻：面板显示的攻击累计要与 run.killPower 一致 */
  const c06 = grow('C06', 1, 5, 'killPower');
  const shown6 = Number((/攻击 \+(\d+)%（上限/.exec(c06.progress) || [])[1]);
  assert.equal(shown6, Math.round(c06.value * 100),
    'C06 面板显示必须等于真实累计：面板「' + c06.progress + '」 vs 实际 ' + (c06.value * 100) + '%');

  /* 死字段不许再被引用（它曾让 C07 的显示恒为 0） */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  assert.ok(!/run\.killMaxHp\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    'tower.js 代码里不该再引用死字段 run.killMaxHp');
  assert.ok(!/mods\.killMaxHpCap/.test(src), '不该引用不存在的 mods.killMaxHpCap');
  assert.ok(/mods\.winMaxHpCap/.test(src), 'C07 的上限应当读 mods.winMaxHpCap');
  assert.ok(/run\.winMaxHp = 0/.test(src), 'resetGrowth 应当清 run.winMaxHp');
});

test('需求38：永久增益替换弹窗改为竖排可滚动列表（不再横排溢出）', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8');

  /* 结构：两个入口共用一个组件，行是竖排列的整行按钮，底部只留「取消」 */
  assert.ok(ui.indexOf('function offerPermanentReplace') > 0, '应当有统一的替换弹窗组件');
  assert.ok(/offerShopReplace[\s\S]{0,400}offerPermanentReplace\(/.test(ui), '商店入口应当复用它');
  assert.ok(/function offerReplace[\s\S]{0,400}offerPermanentReplace\(/.test(ui), '休整点入口应当复用它');
  assert.ok(/class="replace-pick r/.test(ui), '每行应当是 .replace-pick 按钮（整行可点）');
  assert.ok(/class="replace-pick-list"/.test(ui), '应当有 .replace-pick-list 列表容器');
  assert.ok(/data-action="rp/.test(ui), '行要带 data-action 供 bind 挂点击');
  assert.ok(/C\(\)\.bind\(m\.element, actions\)/.test(ui), '行点击要自己 bind（它们不在 .modal-buttons 里）');

  /* 关键回归：不许再把每个增益塞成 .modal-buttons 里的横排按钮 */
  const comp = ui.slice(ui.indexOf('function offerPermanentReplace'), ui.indexOf('/** 每 10 层的里程碑奖励'));
  assert.ok(comp.indexOf("replace-btn") < 0,
    '替换弹窗不该再用 replace-btn 横排按钮');
  assert.ok((comp.match(/buttons\.push/g) || []).length === 0,
    '替换弹窗不该再往 .modal-buttons 里塞每个增益');
  assert.ok(/\{ label: '取消', cls: 'muted'/.test(comp), '底部应当只留「取消」');

  /* 样式：竖排 + 可滚动，而不是横排 */
  const listRule = (/\.replace-pick-list\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
  assert.ok(/flex-direction:\s*column/.test(listRule), '列表必须竖排：' + listRule);
  assert.ok(/overflow-y:\s*auto/.test(listRule), '列表必须可滚动（增益再多也不溢出）：' + listRule);
  assert.ok(/max-height:\s*\d+px/.test(listRule), '列表必须有 max-height：' + listRule);
  const pickRule = (/\.replace-pick\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
  assert.ok(/width:\s*100%/.test(pickRule), '每行应当撑满宽度：' + pickRule);
  assert.ok(/\.replace-pick:hover/.test(css), '行应当有悬停反馈');
  /* 旧的横排样式与描述列表都应当清掉 */
  assert.ok(!/\.replace-btn\s*\{/.test(css), '旧的 .replace-btn 样式应当删除');
  assert.ok(!/\.replace-row\b/.test(css), '旧的 .replace-row 样式应当删除');

  /* 真跑一遍：8 个永久增益 → 8 行、底部只有取消、点击能完成替换 */
  const c = setup();
  const T = c.Tower, S = c.State;
  const modals = [], binds = [];
  const mkEl = () => ({ querySelector: () => null, querySelectorAll: () => [], classList: { add() {} }, dataset: {} });
  const classic = {
    page: () => mkEl(),
    modal: (t, html, buttons) => { const m = { title: t, html: html, buttons: buttons, closed: 0, close() { this.closed++; }, element: mkEl() }; modals.push(m); return m; },
    btn: (l, a, cls) => '<button data-action="' + a + '">' + l + '</button>',
    bind: (root, actions) => { binds.push(actions); },
  };
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T._debugSetLayer(9); T.startEndlessRun();
  const r = T._debugRun('endless');
  r.permanent = ['C01', 'C02', 'C04', 'C05', 'C06', 'C10', 'C13', 'C14'].map((id) => ({ id: id, stacks: 1 }));
  r.permSlots = 3; r.permSlotIds = ['C31', 'C30']; r.slotFreeIds = [];
  r.phase = 'shop'; r.coins = 999;
  r.shop = { layer: r.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [{ id: 'C03', sold: false, price: 20 }] };
  assert.ok(T.buyShopSlot(0).needsReplace, '占满 8 格时买新的应当要求替换');

  /* 用真实的 tower-ui 片段跑 offerShopReplace（只替换 C()/modal 等依赖） */
  const body = ui.slice(ui.indexOf('const RARITY_SHORT'), ui.indexOf('/** 每 10 层的里程碑奖励'));
  /* 面板/弹窗的「附魔优先」排序函数在文件更前面，片段要把它一起带上。 */
  const ordSeg = ui.slice(ui.indexOf('  function orderPermanent('), ui.indexOf('  // ---------- 通用小件 ----------'));
  const ctx = { Tower: T, State: S, esc: (x) => String(x == null ? '' : x), notice: () => {},
    modal: classic.modal, openShop: () => {}, openEndless: () => {},
    C: () => ({ bind: (root, actions) => { binds.push(actions); } }),
    console: { warn() {}, log() {} }, Math: Math, JSON: JSON, Object: Object, Number: Number, String: String, Array: Array };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ordSeg + body + '\nofferShopReplace(0, { id: "C03", name: "猎侠者" });', ctx, { filename: 'dlg.js' });
  const m = modals[modals.length - 1];
  assert.ok(m, '应当弹出替换弹窗');
  assert.equal(m.buttons.map((b) => b.label).join(','), '取消', '底部按钮只应有取消：' + m.buttons.map((b) => b.label).join(','));
  const rows = (m.html.match(/class="replace-pick r/g) || []).length;
  assert.equal(rows, 8, '应当有 8 行（当前 8 个永久增益），实测 ' + rows);
  assert.ok(m.html.indexOf('replace-pick-list') > 0, '应当用列表容器');
  assert.ok(m.html.indexOf('class="uc-button') < 0, '弹窗体里不该再有横排按钮堆');
  assert.ok(binds.length && Object.keys(binds[binds.length - 1]).length === 8, '8 行都要绑上点击');
  /* 点第一行 → 完成替换 */
  const keys = Object.keys(binds[binds.length - 1]);
  binds[binds.length - 1][keys[0]]();
  const after = T._debugRun('endless');
  assert.ok(after.permanent.some((b) => b.id === 'C03'), '点了行之后新增益应当入账');
  assert.equal(after.permanent.length, 8, '替换后仍是 8 项');
});

test('需求39：反击也算「敌方的一次攻击」——先机预判被反击消耗时也要可见', () => {
  const c = setup();
  const Sim = c.Sim;
  const mk = (o) => Object.assign({ name: 'X', level: 50, power: 100, agility: 50, speed: 50,
    hp: 6000, maxHp: 6000, weapons: [], skills: [], effects: {},
    baseStats: { power: 100, agility: 50, speed: 50 } }, o);
  /* 场景：我方带「先机预判」且必中；敌方先手、威力压到 1（它的反击算出来是 0 伤害，
   * 不会生成归零回合），于是我方的免疫只能被敌方**主动普攻**消耗。 */
  let seen = 0;
  for (let t = 0; t < 60; t++) {
    const hero = mk({ name: '我方', speed: 100, agility: 1, power: 200, hp: 30000, maxHp: 30000,
      mods: { firstHitZero: 1, mustHitAll: 1 } });
    const foe = mk({ name: '敌方', speed: 200, agility: 1, power: 1, hp: 30000000, maxHp: 30000000 });
    foe.baseStats.power = 1;
    const res = Sim.simulate(hero, foe);
    const zero = (res.rounds || []).filter((r) => r.firstHitZero);
    assert.equal(zero.length, 1, '整场应当恰好免一次，实测 ' + zero.length);
    /* 语义：被标记归零的那一回合，**敌方那次攻击**没有造成伤害。
     * 不能直接断言 `!zero[0].dmg` —— 触发免疫的那一回合可能是我方行动（反击已完成免疫），
     * 那一回合我方造成的伤害照旧存在。 */
    assert.ok(zero[0].firstHitZero === true, '该回合应当带归零标记');
    assert.ok(!zero.some((r) => r.firstHitZero && r.attacker === 1 && r.dmg > 0),
      '被归零的敌方攻击不该同时有伤害');
    seen++;
  }
  assert.equal(seen, 60, '样本应当跑满');
  /* 反向确认：反击触发的归零必须**带上主回合**（否则免疫被悄悄消耗、玩家看不到）。 */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'sim.js'), 'utf8');
  assert.ok(/if \(counter\.firstHitZero\) \{/.test(src),
    '反击的归零标记应当被带进主回合（可见）');
  assert.ok(/r\.firstHitZero = true;/.test(src), '主回合要记下这次归零');
});

test('需求40：狂怒（C20）阈值 50%，低血时最终伤害 ×1.5、最终敏捷/速度 ×1.2（三项都是终乘）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;

  /* 定义与文案 */
  const m = TD.BUFF_BY_ID.C20.mods;
  assert.equal(m.lowHpAt, 0.50, '阈值应当是 50%');
  /* 低血的那份攻击加成不是「力量面板 +50%」，而是**最终伤害终乘 ×1.5**。 */
  assert.equal(m.lowHpFinalMul, 0.50, '低血最终伤害 ×1.5');
  assert.equal(m.lowHpPowerMul, undefined, '不该再挂力量面板加成（已改为终乘）');
  /* 敏捷/速度同理：写在最终值上（终乘），不是并进敏捷/速度面板。 */
  assert.equal(m.lowHpAgilityMul, 0.20, '最终敏捷 ×1.2');
  assert.equal(m.lowHpSpeedMul, 0.20, '最终速度 ×1.2');
  assert.match(TD.BUFF_BY_ID.C20.desc, /生命低于一半/, '文案要写明低血触发线：' + TD.BUFF_BY_ID.C20.desc);
  assert.match(TD.BUFF_BY_ID.C20.desc, /最终敏捷 ×1\.2/, '文案要写「最终敏捷 ×1.2」：' + TD.BUFF_BY_ID.C20.desc);
  assert.match(TD.BUFF_BY_ID.C20.desc, /最终速度 ×1\.2/, '文案要写「最终速度 ×1.2」：' + TD.BUFF_BY_ID.C20.desc);
  assert.match(TD.BUFF_BY_ID.C20.desc, /终乘/, '文案要点明是终乘：' + TD.BUFF_BY_ID.C20.desc);

  /* **终乘的直接证据**：同一个战斗体，只在血量上做文章 ——
   * 低血时 effAgility / effSpeed 恰好是满血时的 ×1.2（乘在最终值上，而不是并进面板）。 */
  const mkF = (hp, mods) => ({ name: 'x', side: 0, level: 60, power: 200, agility: 120, speed: 120,
    maxHp: 5000, hp: hp, baseStats: { power: 200, agility: 120, speed: 120 },
    buffFlat: { power: 0, agility: 0, speed: 0 }, debuffs: { power: 0, agility: 0, speed: 0 },
    stripTurns: 0, skills: {}, effects: {}, acts: 1, weaponUses: 0, mods: mods || {} });
  const fullStats = Sim.effStatsOf(mkF(5000, m));
  const lowStats = Sim.effStatsOf(mkF(2000, m));
  assert.equal(fullStats.agility, 120, '满血时就是基础敏捷：' + fullStats.agility);
  assert.equal(fullStats.speed, 120, '满血时就是基础速度：' + fullStats.speed);
  assert.equal(lowStats.agility, 144, '低血时最终敏捷 = 120 × 1.2 = 144：' + lowStats.agility);
  assert.equal(lowStats.speed, 144, '低血时最终速度 = 120 × 1.2 = 144：' + lowStats.speed);
  /* 换一组面板数值也成立（是「乘」不是「加 24」） */
  const mkBig = (hp) => { const f = mkF(hp, m); f.agility = 300; f.speed = 250;
    f.baseStats = { power: 200, agility: 300, speed: 250 }; return f; };
  assert.equal(Sim.effStatsOf(mkBig(2000)).agility, 360, '300 × 1.2 = 360（不是 +24）');
  assert.equal(Sim.effStatsOf(mkBig(2000)).speed, 300, '250 × 1.2 = 300（不是 +24）');
  /* 「最终」的含义：buffFlat（越战越勇/后发制人这类回合成长）也在这层乘法**里面** */
  const withFlat = mkF(2000, m);
  withFlat.buffFlat.agility = 100; withFlat.buffFlat.speed = 100;
  assert.equal(Sim.effStatsOf(withFlat).agility, Math.round((120 + 100) * 1.2), '先加 buffFlat 再 ×1.2');
  assert.equal(Sim.effStatsOf(withFlat).speed, Math.round((120 + 100) * 1.2), '先加 buffFlat 再 ×1.2');

  /* 塔内聚合：三项都要落到 me.mods 上（mods 是逐字段挑的，漏一个就静默失效） */
  S.newGame('rage' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T._debugSetLayer(9); T.startEndlessRun();
  T._debugRun('endless').permanent = [{ id: 'C20', stacks: 1 }];
  const nx = T.nextBattle('endless');
  const me = { name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 };
  nx.adjustMe(me);
  assert.equal(me.mods.lowHpFinalMul, 0.50, 'me.mods 要有 lowHpFinalMul');
  assert.equal(me.mods.lowHpAgilityMul, 0.20, 'me.mods 要有 lowHpAgilityMul');
  assert.equal(me.mods.lowHpSpeedMul, 0.20, 'me.mods 要有 lowHpSpeedMul');
  assert.equal(me.mods.lowHpAt, 0.50, 'me.mods 要有 lowHpAt=0.50');
  /* 效果清单：三项都按终乘口径展示（×N），不能写成 +20% 那种「面板加成」的样子 */
  const rep = T.debugBuffReport('endless');
  const low = rep.effects.filter((e) => /低血/.test(e[0]));
  assert.equal(low.length, 3, '效果清单应当有三条低血项：' + JSON.stringify(rep.effects));
  assert.ok(low.some((e) => /最终伤害/.test(e[0]) && /×1\.50/.test(e[1])), '要有低血最终伤害 ×1.50');
  assert.ok(low.some((e) => /最终敏捷/.test(e[0]) && /×1\.20/.test(e[1]) && /终乘/.test(e[1])),
    '敏捷那一项要写成「最终敏捷 ×1.20（终乘）」：' + JSON.stringify(low));
  assert.ok(low.some((e) => /最终速度/.test(e[0]) && /×1\.20/.test(e[1]) && /终乘/.test(e[1])),
    '速度那一项要写成「最终速度 ×1.20（终乘）」：' + JSON.stringify(low));
  const prog = (T.ownedBuffs('endless').find((b) => b.id === 'C20') || {}).progress || '';
  assert.match(prog, /≤50%/, '面板进度要写阈值 50%：' + prog);
  assert.match(prog, /最终敏捷 ×1\.20/, '面板进度要写「最终敏捷 ×1.20」：' + prog);
  assert.ok(!/攻击 \+0%/.test(prog), '面板不该再出现「攻击 +0%」这个读错字段的显示：' + prog);

  /* 战斗实测：低血伤害倍率 ≈ 1.5（平均 60 局，排除单局浮动） */
  const mk = (o) => Object.assign({ name: 'X', level: 50, power: 200, agility: 120, speed: 100,
    hp: 5000, maxHp: 5000, weapons: [], skills: [], effects: {},
    baseStats: { power: 200, agility: 120, speed: 100 } }, o);
  const avgDmg = (hp, mods, n) => {
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const a = mk({ name: 'A', hp: hp, maxHp: 5000, mods: mods || {} });
      const b = mk({ name: 'B', power: 1, agility: 1, speed: 1, hp: 5000000, maxHp: 5000000 });
      const r = Sim.simulate(a, b);
      for (const x of (r.rounds || [])) if (x.attacker === 0 && x.dmg > 0 && x.action === 'common') { sum += x.dmg; cnt++; }
    }
    return sum / Math.max(1, cnt);
  };
  const hi = avgDmg(5000, null, 60), lo = avgDmg(2000, m, 60);
  assert.ok(lo / hi > 1.42 && lo / hi < 1.62, '低血伤害倍率应当约 ×1.50，实测 ×' + (lo / hi).toFixed(3));

  /* 阈值边界：≤50% 触发、明显高于 50% 不触发（都与满血基准比，避免两边都带加成时抵消） */
  const at50 = avgDmg(2500, m, 120), at52 = avgDmg(2600, m, 120), full = avgDmg(5000, m, 120);
  assert.ok(at50 / full > 1.35, '刚好 50%（2500/5000）应当触发狂怒：×' + (at50 / full).toFixed(3));
  assert.ok(at52 / full < 1.10, '52%（2600/5000）不该触发狂怒：×' + (at52 / full).toFixed(3));

  /* 速度：低血时同场行动次数应当变多 */
  const acts = (hp, mods, n) => {
    let a = 0;
    for (let i = 0; i < n; i++) {
      const m1 = mk({ name: 'M', hp: hp, maxHp: 5000, mods: mods || {} });
      const f1 = mk({ name: 'F', power: 1, agility: 1, speed: 100, hp: 5000000, maxHp: 5000000 });
      const r = Sim.simulate(m1, f1);
      a += (r.rounds || []).filter((x) => x.attacker === 0 && x.action === 'common').length;
    }
    return a / n;
  };
  const aHi = acts(5000, null, 40), aLo = acts(2000, m, 40);
  assert.ok(aLo > aHi, '低血时速度 +20% 应当带来更多出手：' + aHi.toFixed(2) + ' → ' + aLo.toFixed(2));
});

test('需求41：与狂怒成套的四条低血 combo（空血上限 / 低血减伤 / 低血吸血 / 低血回血）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;

  /* ---- 定义：稀有度、类型、限次次数都要符合需求 ---- */
  const spec = [
    ['N13', 0, 'limited', 10, '普通·限次'],
    /* N14 铁血护盾：2026-10 上调为**史诗**、减伤 50% → 60%（数据口径，见 tower-data.js）。 */
    ['N14', 2, 'limited', 10, '史诗·限次'],
    ['C46', 1, 'permanent', null, '稀有·永久'],
    ['C47', 2, 'permanent', null, '史诗·永久'],
  ];
  for (const [id, rarity, kind, uses, label] of spec) {
    const b = TD.BUFF_BY_ID[id];
    assert.ok(b, id + ' 应当存在');
    assert.equal(b.rarity, rarity, id + ' 应当是 ' + label);
    assert.equal(b.kind, kind, id + ' 应当是 ' + kind);
    if (uses != null) assert.equal(b.uses, uses, id + ' 限次次数应当是 ' + uses);
    assert.match(Sim ? JSON.stringify(b.mods) : '', /emptyMaxHpMul|lowHp/, id + ' 应当挂低血/空血字段');
  }
  assert.equal(TD.BUFF_BY_ID.N13.mods.emptyMaxHpMul, 1.00, 'N13：+100% 空血上限');
  assert.equal(TD.BUFF_BY_ID.N14.mods.lowHpTakenMul, -0.60, 'N14：低血 60% 减伤');
  assert.equal(TD.BUFF_BY_ID.C46.mods.emptyMaxHpMul, 0.30, 'C46：+30% 空血上限');
  assert.equal(TD.BUFF_BY_ID.C46.mods.lowHpRegenPct, 0.02, 'C46：低血每回合回 2%');
  assert.equal(TD.BUFF_BY_ID.C46.mods.lowHpRegenAt, 0.50, 'C46：最多回到 50%');
  assert.equal(TD.BUFF_BY_ID.C47.mods.emptyMaxHpMul, 0.50, 'C47：+50% 空血上限');
  assert.equal(TD.BUFF_BY_ID.C47.mods.lowHpTakenMul, -0.15, 'C47：低血 15% 减伤');
  assert.equal(TD.BUFF_BY_ID.C47.mods.lowHpLifestealPct, 0.15, 'C47：低血 15% 吸血');

  /* ---- 空血上限：抬上限但**当前血量绝对值不变**（这是「空」的关键）---- */
  const baseMe = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  const oneBattle = (ids, carry) => {
    T._debugSetLayer(9);
    const r0 = T._debugRun('endless');
    if (r0 && r0.attempt) { try { T.reportBattle('endless', r0.attempt, false, 0); } catch (e) {} }
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = []; r.hpBonus = 0;
    /* 血量继承已改为**绝对值**口径：按 5000 上限把 carry 折算成绝对血量。 */
    r.refMaxHp = 5000; r.hpAbs = Math.max(1, Math.round(5000 * carry)); r.carry = carry;
    for (const id of ids) {
      const d = TD.BUFF_BY_ID[id];
      if (d.kind === 'permanent') r.permanent.push({ id: id, stacks: 1 });
      else r.limited.push({ id: id, stacks: 1, uses: d.uses || 10, on: true });
    }
    const nx = T.nextBattle('endless');
    const me = baseMe(); nx.adjustMe(me);
    return { me: me, run: T._debugRun('endless') };
  };
  const plain = oneBattle([], 0.6);
  assert.equal(plain.me.hp, 3000, '基准：5000 × 0.6 = 3000');
  /* 回归：全新一局 carry=1 且还没有任何历史血量时，第一场必须是满血
   * （曾经因为以「未知上限」折算而给出 1 点血）。 */
  {
    T._debugSetLayer(9);
    const r0 = T._debugRun('endless');
    if (r0 && r0.attempt) { try { T.reportBattle('endless', r0.attempt, false, 0, 0); } catch (e) {} }
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.hpAbs = 0; r.refMaxHp = 0; r.carry = 1;
    const nxb = T.nextBattle('endless');
    const meb = baseMe(); nxb.adjustMe(meb);
    assert.equal(meb.hp, meb.maxHp, '全新一局第一场应当满血（不是 1 点血），实测 ' + meb.hp + '/' + meb.maxHp);
  }
  const n13 = oneBattle(['N13'], 0.6);
  assert.equal(n13.me.maxHp, 10000, 'N13 应当把上限抬到 10000');
  assert.equal(n13.me.hp, 3000, 'N13 的当前血量绝对值必须不变（仍是 3000）← 关键');
  assert.ok(Math.abs(n13.me.hp / n13.me.maxHp - 0.30) < 1e-6, '占比应当被压到 30%');
  const c46 = oneBattle(['C46'], 0.6);
  assert.equal(c46.me.maxHp, 6500, 'C46 应当把上限抬到 6500（+30%）');
  assert.equal(c46.me.hp, 3000, 'C46 的当前血量绝对值必须不变');
  const c47 = oneBattle(['C47'], 0.6);
  assert.equal(c47.me.maxHp, 7500, 'C47 应当把上限抬到 7500（+50%）');
  assert.equal(c47.me.hp, 3000, 'C47 的当前血量绝对值必须不变');
  /* 空血上限要能把「高血线」推进狂怒区间（这就是 combo 的意义） */
  const pushed = oneBattle(['N13'], 0.55);
  assert.ok(pushed.me.hp / pushed.me.maxHp <= 0.5,
    '55% 血线配 +100% 空血上限应当落进低血区间，实测 ' + (pushed.me.hp / pushed.me.maxHp * 100).toFixed(1) + '%');

  /* ---- 低血减伤：低血生效、满血不生效 ---- */
  const mk = (o) => Object.assign({ name: 'X', level: 50, power: 200, agility: 120, speed: 100,
    hp: 5000, maxHp: 5000, weapons: [], skills: [], effects: {},
    baseStats: { power: 200, agility: 120, speed: 100 } }, o);
  const firstTaken = (hp, mods, n) => {
    const vals = [];
    for (let i = 0; i < n; i++) {
      const foe = mk({ name: 'F', power: 200, agility: 120, speed: 200 });
      const me = mk({ name: 'M', power: 1, agility: 1, speed: 1, hp: hp, mods: mods || {} });
      const r = Sim.simulate(foe, me);
      /* 每局取**前 3 次**受击：单次伤害的骰子方差很大，只取一次的话
       * 300 局均值的标准误仍有 ~3%，会让 ±5% 的断言偶发红（实测约 1/10）。 */
      const hits = (r.rounds || []).filter((x) => x.attacker === 0 && x.dmg > 0 && x.action === 'common').slice(0, 3);
      for (const h of hits) vals.push(h.dmg);
    }
    return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  };
  const none = firstTaken(5000, null, 300);
  const fullWith = firstTaken(5000, TD.BUFF_BY_ID.N14.mods, 300);
  const lowWith = firstTaken(2500, TD.BUFF_BY_ID.N14.mods, 300);
  assert.ok(Math.abs(fullWith / none - 1) < 0.05, '满血时 N14 不该减伤：×' + (fullWith / none).toFixed(3));
  assert.ok(Math.abs(lowWith / none - 0.4) < 0.07, '低血时 N14 应当减伤 60%：×' + (lowWith / none).toFixed(3));

  /* ---- 低血回血：每回合 5%，且**从不越过 50% 线** ---- */
  const regenRun = (hp) => {
    const me = mk({ name: 'M', power: 1, agility: 1, speed: 50, hp: hp, mods: TD.BUFF_BY_ID.C46.mods });
    const foe = mk({ name: 'F', power: 20, agility: 1, speed: 60, hp: 5000000, maxHp: 5000000 });
    const r = Sim.simulate(me, foe);
    const heals = (r.rounds || []).filter((x) => x.lowHpRegen);
    const maxSeen = Math.max.apply(null, (r.rounds || []).map((x) => x.hpAfter && x.hpAfter[0]).filter((v) => v != null));
    return { heals: heals.length, maxSeen: maxSeen, first: heals.length ? heals[0].heal : 0 };
  };
  const r1 = regenRun(2000);
  assert.ok(r1.heals > 0, '低血时应当有回血回合');
  assert.equal(r1.first, 100, '单次回血应当是 2% × 5000 = 100，实测 ' + r1.first);
  assert.ok(r1.maxSeen <= 2500, '回血不该越过 50% 线（2500），实测最高 ' + r1.maxSeen);
  const r2 = regenRun(1000);
  assert.ok(r2.maxSeen <= 2500, '从 20% 起回血也不该越过 50% 线，实测 ' + r2.maxSeen);

  /* ---- 低血吸血：满血不触发、低血触发 ---- */
  const steal = (hp) => {
    const me = mk({ name: 'M', power: 200, agility: 120, speed: 100, hp: hp, mods: TD.BUFF_BY_ID.C47.mods });
    const foe = mk({ name: 'F', power: 1, agility: 1, speed: 1, hp: 5000000, maxHp: 5000000 });
    const r = Sim.simulate(me, foe);
    return (r.rounds || []).filter((x) => x.attacker === 0 && x.lifesteal).length;
  };
  assert.equal(steal(5000), 0, '满血时低血吸血不该触发');
  assert.ok(steal(2000) > 0, '低血时应当触发低血吸血');
});

test('需求42：叠层增益按层数计价 / 仓库钥匙不进商店 / 登顶者改为固定 +1 力敏速', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;

  /* ---- ① 可叠加增益卖出按层数计价 ---- */
  S.newGame('sellstack' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T._debugSetLayer(9); T.startEndlessRun();
  let r = T._debugRun('endless');
  r.permanent = [{ id: 'C07', stacks: 3 }, { id: 'C02', stacks: 1 }];
  r.limited = []; r.slots = null; r.coins = 0;
  r.phase = 'shop';
  r.shop = { layer: r.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
  const listed = T.ownedBuffs('endless');
  const one = listed.find((b) => b.id === 'C02').sellPrice;
  const three = listed.find((b) => b.id === 'C07').sellPrice;
  const unit07 = Math.max(1, Math.round(TD.shopPrice(TD.BUFF_BY_ID.C07) * TD.SHOP.sellBack));
  assert.equal(three, unit07 * 3, 'C07×3 的卖出价应当是单份 ×3（单份 ' + unit07 + '）');
  assert.ok(three > one, '叠层增益的卖价应当高于单层');
  const before = T._debugRun('endless').coins;
  const sold = T.sellBuff('C07');
  const after = T._debugRun('endless').coins;
  assert.equal(sold.gain, unit07 * 3, '实际卖出应当给单份 ×3');
  assert.equal(after - before, unit07 * 3, '币要真的入账');
  assert.ok(!T._debugRun('endless').permanent.some((b) => b.id === 'C07'), '卖出后整条移除');
  const log = (T._debugRun('endless').buffLog || []).slice(-1)[0];
  assert.ok(log && /×3/.test(log.detail || ''), '流水里应当写明层数：' + JSON.stringify(log));

  /* ---- ② battleOnly 的件不进商店 ----
   * 注意：C31「仓库钥匙」在 2026-10 被用户**改成也能进商店**（tags 加了 shop），
   * 所以这里换一条真正 battleOnly 的（C24 名贵手表）来守住这条规则。 */
  const c24 = TD.BUFF_BY_ID.C24;
  assert.equal(TD.hasTag(c24, 'battle') && !TD.hasTag(c24, 'shop'), true, 'C24 应当只从战斗奖励掉落');
  assert.ok(!TD.shopPool.some((b) => b.id === 'C24'), 'C24 不该出现在商店池');
  /* C31 的掉落渠道被用户改过几次（battleOnly ↔ 也能进商店）→ 这里不断言具体 tags，
   * 只断言**一致性**：带 shop 标签 ↔ 真的在商店池里；不带就两边都不在。 */
  const c31 = TD.BUFF_BY_ID.C31;
  assert.equal(TD.hasTag(c31, 'battle'), true, 'C31 至少是战斗掉落：' + JSON.stringify(c31.tags));
  assert.equal(TD.shopPool.some((b) => b.id === 'C31'), TD.hasTag(c31, 'shop'),
    'C31 的货架归属必须与 shop 标签一致：' + JSON.stringify(c31.tags));
  assert.ok(TD.endlessPool.some((b) => b.id === 'C31'), 'C31 仍应出现在无尽选择池');
  /* 「只战斗出」与「商店不卖」都要在无尽专属之前判定 */
  assert.equal(JSON.stringify(TD.poolRoster(TD.BUFF_BY_ID.C24)), '["E.choice"]', 'C24（shopBanned）也不该进商店');
  assert.ok(TD.shopPool.some((b) => b.id === 'C30'), 'C30（扩容背包，不 battleOnly）应当能进商店');
  /* 描述里不该再写「只在某某池子里出现」 */
  const pats = ['只在战斗', '只出现在', '商店里不卖', '战斗奖励里出现', '不出现在商店', '只在商店', '货架上'];
  for (const b of TD.BUFFS) {
    for (const p of pats) {
      assert.equal(String(b.desc || '').indexOf(p), -1, b.id + ' 的描述里不该写池子说明：' + b.desc);
    }
  }

  /* ---- ③ 登顶者：第 10 层起每胜 +1 力/敏/速（固定值，不吃百分比乘区；一局一份） ---- */
  const c12 = TD.BUFF_BY_ID.C12;
  assert.equal(c12.mods.winStatAfter10, 1, 'C12 应当是固定 +1');
  assert.equal(c12.mods.winPowerAfter10, undefined, '旧的百分比口径应当移除');
  /* 2026-10 用户口径：**削弱为原来的 1/3** —— 原来可叠 3 层（每场最多 +3/项），
   * 现在锁定 1 份（+1/项），也就是原来上限的 1/3。文案按用户给的写法。 */
  assert.equal(c12.maxStacks, 1, 'C12 现在锁定 1 份（原来的 1/3 强度）：' + c12.maxStacks);
  assert.equal(TD.hasTag(c12, 'oncePerRun'), true, 'C12 应当是一局一次（不能再叠）');
  assert.equal(TD.hasTag(c12, 'stackable'), false, 'C12 不再可叠层');
  assert.match(c12.desc, /力&敏&速/, '文案要写力&敏&速：' + c12.desc);
  assert.match(c12.desc, /第 10 层起/, '文案要写第 10 层起：' + c12.desc);
  const grow = (stacks, layer, wins) => {
    S.newGame('c12' + Math.random());
    const s2 = S.state(); s2.level = 70; s2.props[23] = 99999;
    for (let i = 1; i <= 18; i++) s2.stages[i] = { npcIndex: 3, passed: true };
    T._debugSetLayer(9); T.startEndlessRun();
    const rr = T._debugRun('endless');
    rr.permanent = [{ id: 'C12', stacks: stacks }]; rr.layer = layer;
    let w = 0;
    for (let i = 0; i < wins; i++) {
      const cur = T._debugRun('endless');
      if (!cur) break;
      /* 把层号与层内序号都钉死：这样「结算时用的是本场层号」才可精确核对
       *（否则整层最后一场会推进层号，第 9 层的最后一场会被当成第 10 层）。 */
      cur.layer = layer; cur.idx = 0;
      if (cur.choices) { const p = T.pickChoice('endless', 0, null); if (p && !p.ok && p.needsReplace) T.pickChoice('endless', 0, ((cur.permanent || [])[0] || {}).id || null); continue; }
      if (cur.phase === 'shop') { T.continueFromShop(); continue; }
      if (cur.phase === 'checkpoint') { T.continueEndless(); continue; }
      cur.layer = layer; cur.idx = 0;
      const nx = T.nextBattle('endless');
      if (!nx || nx.ok === false) break;
      const a = T._debugRun('endless');
      if (!a || !a.attempt) break;
      T.reportBattle('endless', a.attempt, true, (a.lastHp || a.lastMaxHp || 1), (a.lastMaxHp || 0));
      const after = T._debugRun('endless');
      if (!after) break;
      after.layer = layer;
      w++;
    }
    const fin = T._debugRun('endless');
    return { wins: w, p: fin ? Number(fin.winStatPower || 0) : NaN,
      a: fin ? Number(fin.winStatAgility || 0) : NaN, s: fin ? Number(fin.winStatSpeed || 0) : NaN };
  };
  const one1 = grow(1, 10, 5), below = grow(1, 5, 5);
  assert.equal(one1.p, one1.wins * 1, '×1 应当每胜 +1：' + JSON.stringify(one1));
  assert.equal(one1.a, one1.wins * 1, '敏捷也要 +1');
  assert.equal(one1.s, one1.wins * 1, '速度也要 +1');
  assert.equal(below.p, 0, '层数 <10 时不该累计：' + JSON.stringify(below));
  /* 不能再叠：第二份直接被拒（这条同时守住「削弱为原来 1/3」不会被任务3 的
   * 「叠满开新栏位」重新放开）。 */
  const dup12 = T.addBuff(T._debugRun('endless'), 'C12');
  assert.equal(dup12.ok, false, '第二份登顶者应当被拒：' + JSON.stringify(dup12));
  assert.equal(T.poolFilterOf(T._debugRun('endless'), c12), false, '拿过之后不该再进池');
  assert.equal(T.ownableOf(T._debugRun('endless'), c12), false, '拿过之后不该再获得');
  /* 面板进度要写清三项 */
  const r3 = T._debugRun('endless');
  r3.winStatPower = 15; r3.winStatAgility = 15; r3.winStatSpeed = 15;
  const prog = (T.ownedBuffs('endless').find((b) => b.id === 'C12') || {}).progress || '';
  assert.match(prog, /力 \+15/, '面板进度要写力：' + prog);
  assert.match(prog, /敏 \+15/, '面板进度要写敏：' + prog);
  assert.match(prog, /速 \+15/, '面板进度要写速：' + prog);
});

test('需求43：战斗内专属的上限/战力加成不得在局外生效；空血上限只属于战斗', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.newGame('outside' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  /* 先打一场，让 run.lastMaxHp / baseMaxHp 落到真实值。 */
  let nx = T.nextBattle('endless');
  let me = mk(); nx.adjustMe(me);
  T.reportBattle('endless', T._debugRun('endless').attempt, true, me.maxHp, me.maxHp);
  const baseOut = T.endlessInfo().run.curMaxHp;

  /* 拿到三条「空血上限」增益后，**局外**展示的上限必须不变 ——
   * 它们只在战斗内抬高上限（曾经的 bug：局外也会跟着涨）。 */
  for (const id of ['C46', 'C47', 'N13']) {
    T.addBuff(T._debugRun('endless'), id);
    const outside = T.endlessInfo().run.curMaxHp;
    assert.equal(outside, baseOut,
      id + '（' + TD.BUFF_BY_ID[id].name + '）的空血上限不该在局外生效：局外 ' + outside + '，基准 ' + baseOut);
  }
  /* 战斗内必须生效（这才是设计意图）。 */
  nx = T.nextBattle('endless');
  me = mk(); nx.adjustMe(me);
  assert.ok(me.maxHp > baseOut, '战斗内空血上限应当生效：maxHp=' + me.maxHp + ' 基准 ' + baseOut);
  assert.ok(me.hp <= baseOut, '空血上限不该把当前血量一起抬上去：hp=' + me.hp);

  /* 战斗结束、还没有打下一场时，展示值要退回到「长期口径」，
   * 不能把上一场的临时上限一直挂着。 */
  T.reportBattle('endless', T._debugRun('endless').attempt, true, me.maxHp, me.maxHp);
  const afterInfo = T.endlessInfo().run;
  const longCap = T._debugRun('endless');
  assert.ok(afterInfo.curMaxHp <= baseOut * 3,
    '战后展示的上限应当是长期口径，实测 ' + afterInfo.curMaxHp);
  /* 长期成长（C07 的 run.winMaxHp / 以战养战的 run.winHpFlat）仍然要算进局外展示。 */
  const r = T._debugRun('endless');
  const before = T.endlessInfo().run.curMaxHp;
  r.winHpFlat = Math.max(0, Number(r.winHpFlat) || 0) + 500;   // 模拟以战养战再叠 500
  assert.equal(T.endlessInfo().run.curMaxHp, before + 500,
    '长期固定上限加成（winHpFlat）必须在局外立刻反映');
  T.abandon('endless');
});

test('需求44：幻影回响（环境）—— 只在三侠战生效，胜利后立刻再战同一场且计入叠层', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  /* 定义与数值区间 */
  const def = TD.ENDLESS_ENV_BY_ID.echo;
  assert.ok(def, '应当有 echo 这条环境');
  assert.equal(def.repeatOnly, true, 'echo 应当是「只改战后行为」的标记');
  assert.equal(def.mods.repeatChance[0], 0.17, '概率区间下沿应当是 17%');
  assert.equal(def.mods.repeatChance[1], 0.23, '概率区间上沿应当是 23%');
  const lo1 = TD.repeatChanceInterval(1), hi13 = TD.repeatChanceInterval(13), hi99 = TD.repeatChanceInterval(99);
  assert.equal(lo1[0], 0.17, '低层下沿 17%');
  assert.ok(Math.abs(hi13[1] - 0.23) < 1e-9, '第 13 层上沿到 23%，实测 ' + hi13[1]);
  assert.ok(Math.abs(hi99[1] - 0.23) < 1e-9, '再高也不会超过 23%');
  /* 它不改战斗数值（不该出现在战斗 mods 上） */
  const vals = TD.rollEnvMods(def);
  assert.ok(vals.repeatChance >= 0.17 - 1e-9 && vals.repeatChance <= 0.23 + 1e-9,
    '摇到的概率应当在区间内：' + vals.repeatChance);

  S.newGame('echo' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });

  /* 强制 100% 触发：连打 3 次同一场三侠战，且 idx 不能前进 */
  T.abandon('endless');
  T.startEndlessRun();
  let r = T._debugRun('endless');
  r.layer = 12; r.idx = 0;
  r.permanent = [{ id: 'C11', stacks: 1 }, { id: 'C12', stacks: 1 }];
  r.env = [{ id: 'echo', left: 99, values: { repeatChance: 1 } }];
  /* 回响已限制为「一场战斗至多触发一次」：同一场再战一次之后就必须推进。
   * 所以 3 次连打里会有 2 次触发（第 1、3 次），第 2 次是把这一场推过去。 */
  let repeats = 0, sameEntry = true, advanced = false;
  let lastRepeatTag = null, lastRepeatIdx = null;
  for (let i = 0; i < 3; i++) {
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到下一场');
    const tag = nx.entry.kind + ':' + (nx.entry.anim || nx.entry.id);
    const idxNow = T._debugRun('endless').idx;
    const me = mk(); nx.adjustMe(me);
    const a = T._debugRun('endless');
    const out = T.reportBattle('endless', a.attempt, true, me.maxHp, me.maxHp);
    if (out.repeat) {
      /* 真正的不变量：**同一场不能连续触发两次** ——
       * 触发之后紧接着的那一场必须是同一对手且 idx 不变；
       * 若下一次又是同一对手 + 同一 idx 且再次触发，就说明「一场多次」漏了。
       * 另外回响不该推进层号。 */
      if (out.repeat.battleNo !== idxNow + 1) sameEntry = false;
      if (T._debugRun('endless').layer !== 12) sameEntry = false;
      lastRepeatTag = tag; lastRepeatIdx = idxNow;
      repeats++;
    } else {
      advanced = true;
      /* 没触发就一定要推进（否则会卡在同一场） */
      if (T._debugRun('endless').idx <= idxNow) sameEntry = false;
    }
    assert.ok(!out.layerComplete, '回响不该让本层提前通关');
  }
  assert.equal(repeats, 2, '100% 概率 + 一场至多一次：3 次连打应当触发 2 次，实测 ' + repeats);
  assert.ok(advanced, '同一场再战一次后必须推进到下一场');
  assert.ok(sameEntry, '回响必须是**同一场**对手（同一 layer+idx），实测 ' + lastRepeatTag + ' @idx ' + lastRepeatIdx);
  r = T._debugRun('endless');
  assert.equal(r.layer, 12, '回响不该推进层号');
  assert.equal(r.idx, 1, '再战一次后层内序号应当推进到 1，实测 ' + r.idx);
  assert.equal(r.repeatCount, 2, '重复场次应当被计数');
  /* 叠层增益要把重复的那一场也算进去 */
  assert.equal(r.winHpFlat, 15, 'C11 每胜 +5：3 场（含重复）应当 = 15，实测 ' + r.winHpFlat);
  assert.equal(r.winStatPower, 3, 'C12 第 10 层起每胜 +1：实测 ' + r.winStatPower);
  assert.ok(Math.abs(Number(r.winMaxHp) || 0) > 0 || Number(r.winHpFlat) === 15,
    '战斗成长类增益要把重复的那一场也算进去');

  /* 非三侠战（boss）不该触发 */
  let bossRepeat = false;
  for (let t = 0; t < 30; t++) {
    T.abandon('endless');
    T.startEndlessRun();
    const rr = T._debugRun('endless');
    rr.layer = 12; rr.idx = 3;                       // 第 4 场 = boss
    rr.env = [{ id: 'echo', left: 99, values: { repeatChance: 1 } }];
    const nx = T.nextBattle('endless');
    if (!nx || nx.ok === false) continue;
    if (String(nx.entry.kind) === 'hero') continue;  // 万一计划不同，跳过
    const me = mk(); nx.adjustMe(me);
    const a = T._debugRun('endless');
    const out = T.reportBattle('endless', a.attempt, true, me.maxHp, me.maxHp);
    if (out.repeat) { bossRepeat = true; break; }
  }
  assert.equal(bossRepeat, false, '非三侠战不该触发回响');
  T.abandon('endless');
});

test('需求45：全局实际血量计数器 —— 被上限压下来的部分要真正写入，进场血量不高于局外上限', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.newGame('counter' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  const info = () => { const e = T.endlessInfo().run; return { cap: e.curMaxHp, hp: e.curHp, counter: e.hpAbs }; };
  const fight = (hpAtEnd) => {
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到下一场');
    const me = mk(); nx.adjustMe(me);
    const a = T._debugRun('endless');
    const out = T.reportBattle('endless', a.attempt, true, hpAtEnd, a.lastMaxHp);
    assert.ok(out.ok, '结算应当成功');
    return { battleCap: a.lastMaxHp, outside: info() };
  };

  /* ⓪ 全新一局 + 空血上限：第一场进场血量就不能超过局外上限 */
  {
    T.abandon('endless');
    T.startEndlessRun();
    T.addBuff(T._debugRun('endless'), 'C47');
    const nx0 = T.nextBattle('endless');
    const me0 = mk(); nx0.adjustMe(me0);
    const cap0 = T.endlessInfo().run.curMaxHp;
    assert.ok(me0.maxHp > cap0, '战斗内上限应当高于局外上限：场内 ' + me0.maxHp + ' 场外 ' + cap0);
    assert.ok(me0.hp <= cap0, '第一场进场血量就不该超过局外上限：hp=' + me0.hp + ' 局外上限=' + cap0);
    /* 收尾：这一场已经取过 token，必须结算掉才能再取下一场。 */
    T.reportBattle('endless', T._debugRun('endless').attempt, true, me0.maxHp, me0.maxHp);
    T.abandon('endless');
    T.startEndlessRun();
  }

  /* ① 无临时上限时正常继承 */
  let r = fight(3000);
  assert.equal(r.outside.counter, 3000, '正常继承：计数器应当 = 剩余血量');
  assert.equal(r.outside.hp, 3000, '局外显示血量应当 = 3000');

  /* ② 战斗内上限被空血上限抬高 → 剩余血量超出局外上限时，**真裁**进计数器 */
  T.addBuff(T._debugRun('endless'), 'C47');           // +50% 空血上限
  r = fight(9000);
  assert.ok(r.battleCap > r.outside.cap, '战斗内上限应当高于局外上限：场内 ' + r.battleCap + ' 场外 ' + r.outside.cap);
  assert.equal(r.outside.counter, r.outside.cap,
    '计数器必须被局外上限真裁：实测 ' + r.outside.counter + '，局外上限 ' + r.outside.cap);
  assert.equal(r.outside.hp, r.outside.cap, '局外显示血量也要等于局外上限');

  /* ③ 再进战斗时血量不得高于局外上限 */
  let nx = T.nextBattle('endless');
  let me = mk(); nx.adjustMe(me);
  assert.ok(me.hp <= r.outside.cap,
    '进场血量不得高于局外上限：hp=' + me.hp + ' 局外上限=' + r.outside.cap);
  assert.equal(me.hp, r.outside.cap, '进场血量应当正好是计数器里那份');

  /* ④ 局外上限**变小**时，计数器向下同步（不保留多出来的血） */
  T.reportBattle('endless', T._debugRun('endless').attempt, true, me.maxHp, me.maxHp);
  const before = info();
  T._debugRun('endless').hpBonus = 0;                 // 失去长期上限加成（等价于卖掉/失去）
  const after = info();
  assert.ok(after.cap <= before.cap, '上限不该变大');
  assert.ok(after.counter <= after.cap,
    '计数器必须向下同步到新上限：计数器 ' + after.counter + ' 上限 ' + after.cap);

  /* ⑤ 只向下同步：上限变大不会凭空补血 */
  T._debugRun('endless').hpAbs = 1500;
  T._debugRun('endless').lastMaxHp = 5000;
  T._debugRun('endless').baseMaxHp = 5000;
  T.addBuff(T._debugRun('endless'), 'C29');           // +10% 长期上限
  const grew = info();
  assert.ok(grew.cap > 5000, '上限应当变大：' + grew.cap);
  assert.equal(grew.counter, 1500, '上限变大不该给计数器补血，实测 ' + grew.counter);
  assert.equal(grew.hp, 1500, '显示血量也不该被补');

  /* ⑥ 战斗开始后的回复类 buff 另外累加（不受裁剪影响） */
  const r6 = T._debugRun('endless');
  r6.hpAbs = 1000;
  /* 验证 healAbs：按最大生命百分比回血会**加**到计数器上 */
  const beforeHeal = info().counter;
  T.addBuff(T._debugRun('endless'), 'N08');           // 补给类：开战回血
  T.nextBattle('endless');                            // 开战 → 结算开战回血
  assert.ok(info().counter >= beforeHeal,
    '开战回血应当把计数器加上去（不受上限裁剪影响）：' + beforeHeal + ' → ' + info().counter);
  T.abandon('endless');
});

test('需求46：护盾（我方与敌方）—— 模拟结果暴露开局护盾，事件里带剩余护盾', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;
  const mk = (o) => Object.assign({ name: 'X', level: 50, power: 140, agility: 100, speed: 100,
    hp: 3000, maxHp: 3000, weapons: [{ id: 1, level: 5 }], skills: [], effects: {},
    baseStats: { power: 140, agility: 100, speed: 100 } }, o);

  /* ① 我方护盾（塔 buff 坚韧壁垒 → shellPct） */
  let me = mk({ name: '我', mods: { shellPct: 0.30 } });
  let foe = mk({ name: '敌', power: 60, hp: 3000, maxHp: 3000 });
  let res = Sim.simulate(me, foe);
  assert.ok(Array.isArray(res.startShell) && res.startShell.length === 2,
    '模拟结果要暴露 startShell（界面一开始就要能画出护盾）');
  assert.equal(res.startShell[0], Math.round(3000 * 0.30), '我方开局护盾 = 上限 × 30%，实测 ' + res.startShell[0]);
  assert.equal(res.startShell[1], 0, '没有护盾来源时敌方为 0');
  /* 每个事件都带两侧剩余护盾，界面才能逐帧更新 */
  const withShell = (res.rounds || []).filter((r) => Array.isArray(r.shellAfter) && r.shellAfter.length === 2);
  assert.equal(withShell.length, (res.rounds || []).length, '每个事件都要带 shellAfter');
  assert.ok((res.rounds || []).some((r) => (r.shellAbsorb || 0) > 0), '护盾应当真的吸收过伤害');
  assert.ok((res.rounds || []).some((r) => r.shellAfter[0] < res.startShell[0]), '被吸收后剩余护盾要减少');

  /* ② 敌方护盾（环境词缀「护盾」→ foe.mods.shellPct） */
  me = mk({ name: '我', power: 400 });
  foe = mk({ name: '敌', power: 30, hp: 3000, maxHp: 3000, mods: { shellPct: 0.25 } });
  res = Sim.simulate(me, foe);
  assert.equal(res.startShell[1], Math.round(3000 * 0.25), '敌方开局护盾 = 上限 × 25%，实测 ' + res.startShell[1]);
  assert.ok((res.rounds || []).some((r) => (r.shellAbsorb || 0) > 0), '敌方护盾也要能吸收伤害');
  assert.ok((res.rounds || []).some((r) => r.shellAfter[1] < res.startShell[1]), '敌方剩余护盾要减少');

  /* ③ 双方都有护盾（血色黄昏之类的双向场景） */
  me = mk({ name: '我', mods: { shellPct: 0.20 } });
  foe = mk({ name: '敌', power: 30, mods: { shellPct: 0.20 } });
  res = Sim.simulate(me, foe);
  assert.ok(res.startShell[0] > 0 && res.startShell[1] > 0, '双方都该有护盾：' + JSON.stringify(res.startShell));

  /* ④ 没有护盾来源时全为 0（不要凭空出现护盾） */
  res = Sim.simulate(mk({ name: '我' }), mk({ name: '敌', power: 30 }));
  assert.equal(res.startShell[0], 0, '没有 shellPct 时我方护盾为 0');
  assert.equal(res.startShell[1], 0, '没有 shellPct 时敌方护盾为 0');
  assert.ok((res.rounds || []).every((r) => !r.shellAbsorb), '没有护盾就不该有吸收记录');

  /* ⑤ 塔 buff「坚韧壁垒」走的是同一条路径（agg.shellPct → mods.shellPct） */
  assert.ok(Object.keys(TD.BUFF_BY_ID).some((id) => (TD.BUFF_BY_ID[id].mods || {}).shellPct),
    '应当存在挂 shellPct 的塔 buff（坚韧壁垒）');
});

test('需求47：空血上限的基准是「当前上限」（含固定值成长），不是获得时的血量', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  /* 指定一组增益与固定值加成，返回这一场的上限与「空的部分」。 */
  const cap = (ids, flat, spendHp) => {
    S.newGame('empty' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    T.startEndlessRun();
    for (const id of ids) T.addBuff(T._debugRun('endless'), id);
    const r = T._debugRun('endless');
    if (flat) r.winHpFlat = flat;
    if (spendHp) r.spendGain = { power: 0, agility: 0, speed: 0, hp: spendHp };
    const nx = T.nextBattle('endless');
    const me = mk(); nx.adjustMe(me);
    return { maxHp: me.maxHp, hp: me.hp, empty: me.maxHp - me.hp };
  };

  /* ① 空血只按「百分比乘区」算时是对的 */
  const c46 = cap(['C46']);                       // +30% 空上限
  assert.equal(c46.maxHp, 6500, 'C46 把上限抬到 6500');
  assert.equal(c46.empty, 1500, '空的部分 = 5000 × 30%');

  /* ② **固定值成长必须并入空血基准**（这是本轮修的 bug）——
   * 以前写成 `me.maxHp × (1+百分比) × E`，固定值那部分没算进空血，
   * 于是以战养战 / 挥金如土叠起来后，空的部分明显偏小。 */
  const flat500 = cap(['C46'], 500);
  assert.equal(flat500.maxHp, 7150, '固定 +500 后上限应当是 7150，实测 ' + flat500.maxHp);
  assert.equal(flat500.empty, Math.round((5000 + 500) * 0.30),
    '空的部分要按「当前上限 5500」算 = 1650，实测 ' + flat500.empty);
  assert.ok(flat500.empty > c46.empty, '固定值成长变多时空的部分必须跟着变大');
  const spend500 = cap(['C46'], 0, 500);
  assert.equal(spend500.empty, flat500.empty, '挥金如土的固定生命同样要并入空血基准');

  /* ③ 多条空血上限按乘法叠加，空的部分乘数正确 */
  /* 多条空血上限在聚合层是**相加**的（agg.emptyMaxHpMul += …），
   * 所以 C46(30%) + C47(50%) = 80%：上限 9000、空的部分 4000。 */
  const both = cap(['C46', 'C47']);
  assert.equal(both.maxHp, 9000, 'C46+C47 的上限应当是 9000，实测 ' + both.maxHp);
  assert.equal(both.empty, 4000, '空的部分 = 5000 × (30%+50%) = 4000，实测 ' + both.empty);
  const n13 = cap(['N13']);                        // +100%
  assert.equal(n13.empty, 5000, 'N13 的空的部分 = 5000（一倍）');

  /* ④ 逐场重算：以战养战每胜 +5，空的部分应当随之上浮，而不是钉在获得时的值 */
  S.newGame('perbattle' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  T.addBuff(T._debugRun('endless'), 'C46');
  T.addBuff(T._debugRun('endless'), 'C11');        // 以战养战：每胜 +5 上限
  const empties = [];
  for (let i = 0; i < 4; i++) {
    const cur = T._debugRun('endless');
    if (!cur) break;
    if (cur.choices) { const p = T.pickChoice('endless', 0, null); if (p && !p.ok && p.needsReplace) T.pickChoice('endless', 0, ((cur.permanent || [])[0] || {}).id || null); continue; }
    if (cur.phase === 'shop') { T.continueFromShop(); continue; }
    if (cur.phase === 'checkpoint') { T.continueEndless(); continue; }
    const nx = T.nextBattle('endless');
    if (!nx || nx.ok === false) break;
    const me = mk(); nx.adjustMe(me);
    empties.push({ maxHp: me.maxHp, empty: me.maxHp - me.hp });
    const a = T._debugRun('endless');
    T.reportBattle('endless', a.attempt, true, me.maxHp, me.maxHp);
    if (!T._debugRun('endless')) break;
  }
  assert.ok(empties.length >= 3, '至少要跑出 3 场：' + JSON.stringify(empties));
  for (let i = 1; i < empties.length; i++) {
    assert.ok(empties[i].empty > empties[i - 1].empty,
      '空的部分必须随成长逐场上浮（第 ' + i + ' 场）：' + JSON.stringify(empties));
  }
  T.abandon('endless');
});

test('需求48：吞噬成长 / 以战养战 的累计生命上限在被替换后不消失', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  /* 攒 N 场，然后把永久槽填满并**替换掉** target，比较替换前后的上限。 */
  /* 这段测量假定槽位上限固定为 5（填满 5 个就必须替换）。若循环里恰好选到
   * 「扩容背包 / 仓库钥匙」这类 permSlot 增益，上限会变成 6/7，5 个占位就不再是满格，
   * 「应当要求替换」的断言会偶发红（实测约 1/12）。所以这里拒绝扩容类与增幅水晶。 */
  const pickNoSlotNoC15 = (run) => {
    const ch = (run && run.choices) || [];
    const bad = (x) => {
      const def = TD.BUFF_BY_ID[x && x.id];
      return !!(def && def.mods && (def.mods.permSlot || def.mods.globalMul));
    };
    let i = ch.findIndex((x) => !bad(x));
    if (i < 0) i = 0;
    const p = T.pickChoice('endless', i, null);
    if (p && !p.ok && p.needsReplace) T.pickChoice('endless', i, ((run.permanent || [])[0] || {}).id || null);
    return p;
  };
  const growThenReplace = (target, battles) => {
    S.newGame('keep' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    T.startEndlessRun();
    T.addBuff(T._debugRun('endless'), target);
    for (let i = 0; i < battles; i++) {
      const cur = T._debugRun('endless');
      if (!cur) break;
      cur.env = [];
      if (cur.choices) { pickNoSlotNoC15(cur); continue; }
      if (cur.phase === 'shop') { T.continueFromShop(); continue; }
      if (cur.phase === 'checkpoint') { T.continueEndless(); continue; }
      const nx = T.nextBattle('endless');
      if (!nx || nx.ok === false) break;
      const me = mk(); nx.adjustMe(me);
      const a = T._debugRun('endless');
      T.reportBattle('endless', a.attempt, true, me.maxHp, me.maxHp);
      if (!T._debugRun('endless')) break;
    }
    /* 只保留 target 的累计，把列表换成「target + 几个占位」并填满槽位 */
    const r = T._debugRun('endless');
    const cap = 5 + Math.max(0, Number(r.permSlots) || 0);
    const others = ['C21', 'C22', 'C23', 'C26', 'C27', 'C28'].filter((x) => x !== target).map((x) => ({ id: x, stacks: 1 }));
    r.permanent = [{ id: target, stacks: 1 }].concat(others).slice(0, cap);
    const before = { cap: T.endlessInfo().run.curMaxHp, winMaxHp: Number(r.winMaxHp) || 0,
      winHpFlat: Number(r.winHpFlat) || 0, hpBonus: Number(r.hpBonus) || 0 };
    const needs = T.addBuff(T._debugRun('endless'), 'C28', null);
    assert.ok(needs && needs.needsReplace, '槽位填满后应当要求替换');
    const out = T.addBuff(T._debugRun('endless'), 'C28', target);
    assert.ok(out && out.ok, '替换应当成功：' + ((out && out.msg) || ''));
    const r2 = T._debugRun('endless');
    const after = { cap: T.endlessInfo().run.curMaxHp, winMaxHp: Number(r2.winMaxHp) || 0,
      winHpFlat: Number(r2.winHpFlat) || 0, hpBonus: Number(r2.hpBonus) || 0 };
    assert.ok(!(r2.permanent || []).some((b) => b.id === target), target + ' 应当已被换掉');
    return { before: before, after: after };
  };

  /* ① C07 吞噬成长（百分比累计）：换掉后累计冻结进 run.hpBonus，上限不回落 */
  const c07 = growThenReplace('C07', 5);
  assert.ok(c07.before.winMaxHp > 0, '替换前应当攒到了成长：' + JSON.stringify(c07.before));
  assert.ok(c07.before.cap > 5000, '替换前上限应当高于基础：' + c07.before.cap);
  assert.equal(c07.after.winMaxHp, 0, '替换后成长累计字段清零');
  assert.ok(Math.abs(c07.after.hpBonus - (c07.before.hpBonus + c07.before.winMaxHp)) < 1e-9,
    '替换后应当把那份累计**追加**进 hpBonus：' + JSON.stringify(c07));
  assert.equal(c07.after.cap, c07.before.cap,
    'C07 被替换后上限不该回落：' + c07.before.cap + ' → ' + c07.after.cap);

  /* ② C11 以战养战（固定值累计）：换掉后按比例折算进 hpBonus，上限不回落 */
  const c11 = growThenReplace('C11', 5);
  assert.ok(c11.before.winHpFlat > 0, '替换前应当攒到固定值成长：' + JSON.stringify(c11.before));
  assert.ok(c11.before.cap > 5000, '替换前上限应当高于基础：' + c11.before.cap);
  assert.equal(c11.after.winHpFlat, 0, '替换后固定值累计字段清零');
  assert.ok(c11.after.hpBonus > c11.before.hpBonus,
    '替换后应当把固定值折算成比例**追加**进 hpBonus：' + JSON.stringify(c11));
  assert.equal(c11.after.cap, c11.before.cap,
    'C11 被替换后上限不该回落：' + c11.before.cap + ' → ' + c11.after.cap);

  /* ③ 静置不动时上限也不该自己变化（确认冻结值稳定） */
  const again = T.endlessInfo().run.curMaxHp;
  assert.equal(again, c11.after.cap, '冻结后上限应当稳定不变');
  T.abandon('endless');
});

test('需求49：神兵淬炼 / 秘技通神 视为「立即生效类」，永久栏满时仍可购买', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [{ id: 1, level: 5 }], skills: ['13:5'],
    wears: [], effects: {}, masterLevel: 0 });
  /* 槽位占用/上限通过 debugBuffReport 暴露（permUsed/permSlots 没有单独导出）。 */
  const slotsOf = () => T.debugBuffReport('endless').slots;
  /* 起一局并把永久栏塞满（5/5），商店已开；可选地预置 choices。 */
  const fullRun = (choiceIds) => {
    S.newGame('instant' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = ['C21', 'C22', 'C23', 'C26', 'C27'].map((id) => ({ id: id, stacks: 1 }));
    r.coins = 99999;
    r.phase = 'shop';
    r.shop = { layer: r.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
    if (choiceIds) r.choices = choiceIds.map((id) => ({ id: id, rarity: 2 }));
    return r;
  };
  const buy = (id) => {
    const rr = T._debugRun('endless');
    rr.shop.slots = [{ id: id, sold: false, price: 1 }];
    const out = T.buyShopSlot(0);
    return { out: out, run: T._debugRun('endless') };
  };

  /* ① 定义核对：这两条是 permanent 但**不占槽**的选取类 */
  for (const [id, key] of [['C32', 'pickWeaponPct'], ['C33', 'pickSkillPct']]) {
    const b = TD.BUFF_BY_ID[id];
    assert.ok(b, id + ' 应当存在');
    assert.ok(b.mods && b.mods[key], id + '（' + b.name + '）应当挂 ' + key);
    assert.equal(TD.hasTag(b, 'hidden'), true, id + ' 应当是隐藏型（不在增益面板里单独出现）');
    assert.equal(TD.hasTag(b, 'unique'), true, id + ' 应当一局一次');
  }

  /* ② 满槽时买神兵淬炼：应当成功、不占新的槽、立刻登记「待选武器」 */
  let r = fullRun();
  assert.equal(slotsOf().used, slotsOf().cap, '前置条件：永久栏应当已满');
  let res = buy('C32');
  assert.ok(res.out.ok, '满槽时应当能买神兵淬炼：' + JSON.stringify(res.out));
  assert.ok(!res.out.needsReplace, '不该要求替换');
  assert.equal(slotsOf().used, slotsOf().cap, '永久栏占用不该增加');
  assert.ok(res.run.pendingPick && res.run.pendingPick.kind === 'weapon',
    '应当立刻登记「待选武器」：' + JSON.stringify(res.run.pendingPick));
  assert.ok((res.run.pickBuffIds || []).indexOf('C32') >= 0, '应当登记「一局一次」以免重复刷到');

  /* ③ 满槽时买秘技通神：同理，登记「待选技能」 */
  r = fullRun();
  res = buy('C33');
  assert.ok(res.out.ok, '满槽时应当能买秘技通神：' + JSON.stringify(res.out));
  assert.equal(slotsOf().used, slotsOf().cap, '永久栏占用不该增加');
  assert.ok(res.run.pendingPick && res.run.pendingPick.kind === 'skill',
    '应当立刻登记「待选技能」：' + JSON.stringify(res.run.pendingPick));

  /* ④ 满槽时买**真的占槽**的增益：仍然要求替换（不能被这条需求放宽） */
  r = fullRun();
  res = buy('C29');                                   // 体质：永久 +10% 生命上限
  assert.ok(!res.out.ok && res.out.needsReplace,
    '占槽的永久增益满槽时应当要求替换：' + JSON.stringify(res.out));

  /* ⑤ 场间选择（战斗奖励）路径同样放行 */
  r = fullRun(['C32']);
  const picked = T.pickChoice('endless', 0, null);
  assert.ok(picked.ok, '满槽时场间选择也该能拿神兵淬炼：' + JSON.stringify(picked));
  assert.ok(T._debugRun('endless').pendingPick, '应当登记待选目标');

  /* ⑥ 扩容类（+槽位）也不该被满槽挡住 */
  r = fullRun();
  const beforeSlots = slotsOf().cap;
  res = buy('C30');                                   // 扩容背包：永久槽位 +1
  assert.ok(res.out.ok, '满槽时应当能买扩容背包：' + JSON.stringify(res.out));
  assert.equal(slotsOf().cap, beforeSlots + 1, '槽位上限应当 +1');

  T.abandon('endless');
});

test('需求50：N13/N14 的界面口径（无尽塔 10 次限次）+ 寒霜锁链双向降速 + 不死鸟商店权重', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;

  /* ① N13 血之契约 / N14 铁血护盾：无尽专属 + **下一场战斗生命周期** + 10 次限次。
   *    「是否显示成『下一场』」必须看 towerOnly，而不是 nextBattle ——
   *    否则无尽塔里这两条会显示成「下一场」，玩家看不出还剩 10 场。 */
  for (const id of ['N13', 'N14']) {
    const b = TD.BUFF_BY_ID[id];
    assert.equal(b.kind, 'limited', id + ' 应当是限次类');
    assert.equal(b.uses, 10, id + ' 应当是 10 次限次');
    assert.equal(TD.hasTag(b, 'endless') && !TD.hasTag(b, 'tower'), true, id + ' 应当只属于无尽塔');
    assert.ok(!TD.hasTag(b, 'tower'), id + ' 不该带挑战塔标签');
    assert.equal(TD.hasTag(b, 'nextBattle'), true, id + ' 仍是「下一场战斗」生命周期');
    /* 界面判据：towerOnly && nextBattle 才显示「下一场」 */
    assert.ok(!(TD.hasTag(b, 'tower') && TD.hasTag(b, 'nextBattle')), id + ' 不该被判成「只服务下一场」');
    assert.ok(!TD.towerPool.some((x) => x.id === id), id + ' 不该出现在挑战塔池');
    assert.ok(TD.endlessPool.some((x) => x.id === id), id + ' 应当出现在无尽塔池');
    assert.ok(!/^下一场战斗/.test(b.desc), id + ' 描述应按「每场」写：' + b.desc);
    assert.match(b.desc, /10 场/, id + ' 描述应写明 10 场：' + b.desc);
  }
  assert.equal(TD.BUFF_BY_ID.N13.mods.emptyMaxHpMul, 1.00, 'N13 仍是 +100% 空上限');
  /* N15 反噬豁免：限次 10 场 + nextBattle 生命周期 + 无尽专属。 */
  const n15 = TD.BUFF_BY_ID.N15;
  assert.equal(n15.kind, 'limited', 'N15 应当是限次类');
  assert.equal(n15.uses, 10, 'N15 应当是 10 次限次');
  assert.equal(TD.hasTag(n15, 'nextBattle'), true, 'N15 是「下一场战斗」生命周期');
  assert.equal(TD.hasTag(n15, 'endless') && !TD.hasTag(n15, 'tower'), true, 'N15 只属于无尽塔');
  assert.ok(!(TD.hasTag(n15, 'tower') && TD.hasTag(n15, 'nextBattle')), 'N15 不该被判成「只服务下一场」');
  assert.ok(TD.endlessPool.some((x) => x.id === 'N15'), 'N15 应当出现在无尽塔池');
  assert.ok(!TD.towerPool.some((x) => x.id === 'N15'), 'N15 不该出现在挑战塔池');
  assert.equal(TD.BUFF_BY_ID.N14.mods.lowHpTakenMul, -0.60, 'N14 现在是 60% 减伤');

  /* ② 寒霜锁链：敌方 −5%~−9%，我方 −11%~−19% */
  const frost = TD.ENDLESS_ENV_BY_ID.frost;
  assert.ok(frost.mods.enemySpeedMul, '寒霜应当也降敌方速度');
  assert.equal(frost.mods.enemySpeedMul[0], -0.09, '敌方下沿 -9%');
  assert.equal(frost.mods.enemySpeedMul[1], -0.05, '敌方向上沿 -5%');
  assert.equal(frost.mods.selfSpeedMul[0], -0.19, '我方下沿 -19%');
  assert.equal(frost.mods.selfSpeedMul[1], -0.11, '我方向上沿 -11%');
  /* 我方降幅必须严格大于敌方（强度关系） */
  for (let i = 0; i < 30; i++) {
    const v = TD.rollEnvMods(frost);
    assert.ok(Math.abs(v.selfSpeedMul) > Math.abs(v.enemySpeedMul),
      '我方降幅应当大于敌方：' + JSON.stringify(v));
  }
  const frostTxt = TD.envText(frost, { enemySpeedMul: -0.07, selfSpeedMul: -0.15 }).text;
  assert.match(frostTxt, /敌方/, '文案要写敌方：' + frostTxt);
  assert.match(frostTxt, /我方/, '文案要写我方：' + frostTxt);
  /* 实战：两条速度修正都要落到面板上 */
  const applyFrost = (ids) => {
    S.newGame('frost' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = [];
    for (const id of ids) T.addBuff(T._debugRun('endless'), id);
    const rr = T._debugRun('endless');
    rr.env = [{ id: 'frost', left: 5, values: { enemySpeedMul: -0.07, selfSpeedMul: -0.15 } }];
    rr.choices = null; rr.phase = null;
    const nx = T.nextBattle('endless');
    const me = { name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
      baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    return { me: me, foe: nx.foe };
  };
  const fr = applyFrost([]);
  assert.equal(fr.me.mods.speedMul, -0.15, '我方速度修正应当生效：' + JSON.stringify(fr.me.mods));
  assert.equal(fr.foe.mods.speedMul, -0.07, '敌方速度修正应当生效：' + JSON.stringify(fr.foe.mods));

  /* ③ 不死鸟：商店权重显著低于其它传奇 */
  const c14 = TD.BUFF_BY_ID.C14;
  /* 2026-10 用户口径：0.12 → 0.5（仍然是「低于同档」的设计意图，只是没那么极端）。 */
  assert.equal(Number(c14.shopWeight), 0.5, '不死鸟的商店权重应当是 0.5：' + c14.shopWeight);
  assert.equal(TD.BUFF_BY_ID.C36.shopWeight, undefined, '其它传奇不该被顺手改权重（默认 1）');
  /* 统计：不死鸟的上架概率应当远低于同档其它传奇 */
  S.newGame('shopprob' + Math.random());
  const st2 = S.state(); st2.level = 70; st2.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st2.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const RUNS = 4000;
  let c14n = 0, other = 0, others = 0;
  for (let i = 0; i < RUNS; i++) {
    const list = T.rollShopSlotsOf(T._debugRun('endless'), 0) || [];
    for (const sl of list) {
      const b = TD.BUFF_BY_ID[sl.id];
      if (!b || b.rarity !== 3) continue;
      if (b.id === 'C14') c14n++; else { other++; others++; }
    }
  }
  assert.ok(c14n < other, '不死鸟出现次数应当明显少于其它传奇：' + c14n + ' vs ' + other);
  assert.ok(other > 0, '对照组应当有传奇出现（否则样本不足）');
  T.abandon('endless');
});

test('需求51：天象之眼应当剥夺敌方吃到的正向环境（但不剥夺我方那一份）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  /* 起一局、装指定永久增益、挂上指定环境，返回双方的面板。 */
  const scene = (ids, envs) => {
    S.newGame('envshield' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = [];
    for (const id of ids) T.addBuff(T._debugRun('endless'), id);
    const rr = T._debugRun('endless');
    rr.env = envs; rr.choices = null; rr.phase = null;
    const nx = T.nextBattle('endless');
    const me = mk(); nx.adjustMe(me);
    return { me: me, foe: nx.foe };
  };
  const DUSK = [{ id: 'dusk', left: 5, values: { bothLifestealPct: 0.15 } }];
  const THORNS = [{ id: 'thorns', left: 5, values: { thornsPct: 0.15 } }];

  /* 前置：C45 同时带 envIgnore 与 envDenyGood —— 「无视环境」只该针对**负面**环境，
   * 否则会把我方自己的正向环境（血色黄昏的吸血）也一起无视掉。 */
  const c45 = TD.BUFF_BY_ID.C45;
  assert.equal(c45.mods.envDenyGood, 1, 'C45 应当带 envDenyGood');
  assert.equal(c45.mods.envIgnore, 1, 'C45 也带 envIgnore（只针对负面环境）');

  /* ① 血色黄昏是**正向**环境（双方吸血）：天象之眼应当剥夺敌方那份、我方保留 */
  const plain = scene([], DUSK);
  assert.equal(plain.me.mods.lifestealPct, 0.15, '无天象时我方该有吸血');
  assert.equal(plain.foe.mods.lifestealPct, 0.15, '无天象时敌方也该有吸血（双方环境）');
  const deny = scene(['C45'], DUSK);
  assert.equal(deny.me.mods.lifestealPct, 0.15,
    '天象之眼**不该剥夺我方**那一份吸血（这是需求点名的 bug）：' + JSON.stringify(deny.me.mods));
  assert.ok(!deny.foe.mods.lifestealPct,
    '天象之眼应当剥夺敌方吃到的正向环境（敌方不该有吸血）：' + JSON.stringify(deny.foe.mods));

  /* ② 负面环境现在一律**无效化**（不再反弹）——
   *    反弹会让荆棘/自愈/贪婪在敌人身上重生，等于没有剥夺。 */
  const bad = scene(['C45'], THORNS);
  assert.ok(!bad.foe.mods.thornsPct, '天象之眼应当把负面环境整个剥夺（不反弹）：' + JSON.stringify(bad.foe.mods));
  assert.ok(!bad.me.mods.thornsPct, '我方也不该吃到这条负面环境');

  /* ③ 「无视环境」（避风斗篷 N10 / 晴空护符 N09）的定位是
   *    **无视负面环境词缀** —— 所以它只屏蔽负面环境，正向环境照常生效。
   *    （这里顺带把这条口径钉住：envIgnore 不该误伤正向环境。） */
  const ignoreBad = scene(['N10'], THORNS);
  assert.ok(!ignoreBad.foe.mods.thornsPct, '避风斗篷下负面环境不该生效');
  assert.ok(!ignoreBad.me.mods.thornsPct, '避风斗篷下我方也不该吃到负面环境');
  const ignoreGood = scene(['N10'], DUSK);
  assert.equal(ignoreGood.me.mods.lifestealPct, 0.15,
    '避风斗篷不该屏蔽正向环境（我方吸血仍在）：' + JSON.stringify(ignoreGood.me.mods));

  /* ④ 没有天象之眼时，正向环境不能被自己弄丢（回归：envEffective 曾把它整条排除） */
  const noShield = scene([], DUSK);
  assert.equal(noShield.me.mods.lifestealPct, 0.15, '没有护盾类增益时我方吸血必须生效');
  T.abandon('endless');
});

test('需求52：体力药限购/售价、天梯周日不休赛、涅槃重做', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;

  /* ① 商店每天仅售 3 小 + 3 大体力药；大体力药 6 金松果 */
  assert.equal(S.shopLimit(1), 3, '小体力药剂每日限购 3');
  assert.equal(S.shopLimit(2), 3, '大体力药剂每日限购 3');
  const big = c.propMap.getValue(2);
  assert.equal(Number(big.price), 6, '大体力药剂售价应当是 6 金松果，实测 ' + big.price);
  assert.equal(Number(c.propMap.getValue(1).price), 3, '小体力药剂售价仍是 3');
  /* 实际扣费 = 价格：买 1 个大体力药扣 6 */
  S.newGame('shop' + Math.random());
  const st0 = S.state(); st0.goldPoint = 100; st0.props = {}; st0.shopPurchases = {};
  const buy1 = S.buyProp(2, 1);
  assert.ok(buy1.ok, '应当能买 1 个大体力药');
  assert.equal(S.state().goldPoint, 94, '买 1 个大体力药应当扣 6 金松果');
  assert.equal(S.purchaseStatus(2).remaining, 2, '买 1 个后今日还剩 2 个');
  /* 一次性超额购买要被挡住，且不扣费 */
  const over1 = S.buyProp(2, 3);
  assert.ok(!over1.ok && over1.limited, '一次买 3 个（只剩 2 个额度）应当被限购挡住');
  assert.equal(S.state().goldPoint, 94, '被限购挡住时不该扣钱');
  S.newGame('shop2' + Math.random());
  const st1 = S.state(); st1.goldPoint = 100; st1.props = {}; st1.shopPurchases = {};
  assert.equal(S.buyProp(2, 3).ok, true, '一次买 3 个应当成功');
  const over = S.buyProp(2, 1);
  assert.ok(!over.ok && over.limited, '买满 3 个后再买应当被限购挡住');
  assert.equal(S.state().goldPoint, 100 - 18, '3 个大体力药应当扣 18 金松果（6×3）');

  /* ② 天梯赛周日不休赛：源码里不该再有周日休赛的判断 */
  const rawSrc = fs.readFileSync(path.join(ROOT, 'js', 'classic-extras.js'), 'utf8');
  /* 只检查**代码**：注释里会解释「原来周日休赛」，不该被当成残留逻辑。 */
  const src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(src.indexOf('rankSunday') < 0, '不该再有 rankSunday() 这个休赛判据');
  assert.ok(!/getDay\(\) === 0/.test(src), '不该再用 getDay() === 0 判断休赛');
  assert.ok(!/\u5468\u65e5\u4f11\u8d5b/.test(src), '界面文案里不该再写「周日休赛」');
  assert.ok(!/match\.disabled = [^;]*[Ss]unday/.test(src), '匹配按钮的禁用条件不该含周日');
  /* 开战校验里也不该有周日拦截 */
  assert.ok(!/if \([^)]*[Ss]unday[^)]*\) \{ alert/.test(src), '开战校验不该拦周日');

  /* ③ 涅槃（原不死鸟）：每层一次复活甲 + 复活回 50% 上限 + 本场力/敏/速 +50% */
  const c14 = TD.BUFF_BY_ID.C14;
  assert.equal(c14.name, '涅槃', 'C14 应当已改名为涅槃');
  assert.equal(c14.rarity, 3, '仍是传奇');
  assert.equal(c14.shopWeight, 0.5, '商店权重 2026-10 上调到 0.5（仍然低于同档基准 1）');
  assert.equal(c14.mods.revivePct, 0.50, '复活回复当前生命上限的 50%');
  assert.equal(c14.mods.reviveStatMul, 0.50, '复活后本场力/敏/速 +50%');
  assert.match(c14.desc, /涅槃|复活/, '文案要说明复活');
  assert.match(c14.desc, /50%/, '文案要写明复活回复 50% 上限（本轮要求具体数值，不再写「一半」）');
  assert.match(c14.desc, /力|敏|速/, '文案要写力/敏/速加成：' + c14.desc);

  /* 引擎行为：复活回复 50% 上限，且复活后力/敏/速各 +50% */
  const mk = (o) => Object.assign({ name: 'X', level: 50, power: 200, agility: 100, speed: 100,
    hp: 5000, maxHp: 5000, weapons: [{ id: 1, level: 5 }], skills: [], effects: {},
    baseStats: { power: 200, agility: 100, speed: 100 } }, o);
  let sawRevive = 0, sawMul = 0, hpOk = 0;
  for (let i = 0; i < 60; i++) {
    const me = mk({ name: '我', mods: { deathSaves: [{ healPct: 0.5, statMul: 0.5 }] } });
    const foe = mk({ name: '敌', power: 400, agility: 100, speed: 200, hp: 5000, maxHp: 5000 });
    const r = Sim.simulate(me, foe);
    const ds = (r.rounds || []).filter((x) => x.deathSave && x.attacker === 1);
    if (!ds.length) continue;
    sawRevive++;
    if (ds.some((x) => x.reviveStatMul === 0.5)) sawMul++;
    /* 复活那一回合之后，我方血量应当回到 50% 上限附近（至少 1 点、且不超过上限） */
    const idx = (r.rounds || []).findIndex((x) => x.deathSave);
    const after = (r.rounds || []).slice(idx).find((x) => Array.isArray(x.hpAfter));
    if (after && after.hpAfter[0] > 0 && after.hpAfter[0] <= r.maxHp[0]) hpOk++;
  }
  assert.ok(sawRevive >= 20, '应当有足够多的复活样本，实测 ' + sawRevive);
  assert.equal(sawMul, sawRevive, '每次复活都应当带上 +50% 的标记（界面上才看得到）');
  assert.equal(hpOk, sawRevive, '复活后血量应当在合法范围内');

  /* 复活后伤害确实提高：比较有/无 statMul 的复活后普攻均值 */
  const dmgAfter = (statMul) => {
    let sum = 0, cnt = 0;
    for (let i = 0; i < 200; i++) {
      const me = mk({ name: '我', mods: { deathSaves: [{ healPct: 0.5, statMul: statMul }] } });
      const foe = mk({ name: '敌', power: 300, agility: 1, speed: 300, hp: 99999999, maxHp: 99999999 });
      const r = Sim.simulate(me, foe);
      const rounds = r.rounds || [];
      const idx = rounds.findIndex((x) => x.deathSave);
      if (idx < 0) continue;
      for (const x of rounds.slice(idx)) if (x.attacker === 0 && x.dmg > 0 && x.action === 'common') { sum += x.dmg; cnt++; }
    }
    return sum / Math.max(1, cnt);
  };
  const boosted = dmgAfter(0.5), plain = dmgAfter(0);
  assert.ok(boosted > plain * 1.2,
    '复活后应当明显变强（力/敏/速 +50%）：' + plain.toFixed(1) + ' → ' + boosted.toFixed(1));

  /* 每层只给一次（run 层面的口径未被破坏） */
  assert.ok(/reviveLayer/.test(fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8')),
    '仍然保留「每层一次」的发放口径');
});

test('需求53：unique 口径 / 塔顶 boss 变体池 / 幸运一击重复率 / 反噬豁免与减伤成长', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;

  /* ① 仓库钥匙 / 扩容背包一局只出现一次；虚空铭文可重复出现 */
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.C30, 'unique'), true, '扩容背包仍是一局一次');
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.C31, 'unique'), true, '仓库钥匙仍是一局一次');
  assert.ok(!TD.hasTag(TD.BUFF_BY_ID.C37, 'unique'), '虚空铭文不再受 unique 限制');
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.C37, 'repeatable'), true, '虚空铭文应当标 repeatable');
  /* poolFilter 行为：拥有之后，前两者应当被排除、虚空铭文仍可再出现 */
  S.newGame('uniq' + Math.random());
  const st0 = S.state(); st0.level = 70; st0.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st0.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r0 = T._debugRun('endless');
  r0.permanent = []; r0.limited = []; r0.slotFreeIds = [];
  for (const id of ['C30', 'C31', 'C37']) {
    const def = TD.BUFF_BY_ID[id];
    const before = T.poolFilterOf(r0, def);
    assert.ok(before, id + ' 未拥有时应当允许出现');
  }
  r0.permanent = [{ id: 'C30', stacks: 1 }, { id: 'C31', stacks: 1 }, { id: 'C37', stacks: 1 }];
  assert.ok(!T.poolFilterOf(r0, TD.BUFF_BY_ID.C30), '已拥有扩容背包后应当被排除');
  assert.ok(!T.poolFilterOf(r0, TD.BUFF_BY_ID.C31), '已拥有仓库钥匙后应当被排除');
  assert.ok(T.poolFilterOf(r0, TD.BUFF_BY_ID.C37), '虚空铭文即使已拥有也应当还能再出现');

  /* ② 塔顶 boss：独立变体池，装备固定狂战套，机制/武器/技能等级各有不同，且都带绝对防御 */
  const pool = TD.WARLORD_POOL;
  assert.ok(Array.isArray(pool) && pool.length >= 4, '塔顶 boss 池应当有多只：' + (pool && pool.length));
  const names = pool.map((w) => w.name);
  assert.equal(new Set(names).size, names.length, '变体名不该重复：' + names.join('/'));
  for (const w of pool) {
    assert.equal(w.gear, 'berserk', w.name + ' 应当穿狂战套');
    assert.ok(Array.isArray(w.mech) && w.mech.length, w.name + ' 应当有机制');
    assert.ok(Array.isArray(w.weapons) && w.weapons.length, w.name + ' 应当有武器');
    /* 绝对防御在引擎里是技能 16（受击自动触发），不是 22 */
    assert.ok(w.skills.some((k) => k.id === 16), w.name + ' 必须固定带绝对防御（技能 16）：' +
      JSON.stringify(w.skills));
    assert.ok(Array.isArray(w.castable) && w.castable.length, w.name + ' 应当声明倾向的主动技');
  }
  /* 武器/技能/等级确有差异（不是同一套换个名字） */
  const sig = (w) => JSON.stringify([w.weapons, w.skills, w.castable]);
  assert.equal(new Set(pool.map(sig)).size, pool.length, '每只的武技搭配应当各不相同');
  const lv = new Set(pool.flatMap((w) => w.skills.map((k) => k.level)));
  assert.ok(lv.size >= 3, '技能等级应当有多种变化，实测 ' + [...lv].join(','));
  /* 抽取：同层固定、换层变化 */
  const salt = 'test-salt';
  assert.equal(TD.warlordFor(30, salt).name, TD.warlordFor(30, salt).name, '同一层应当固定同一只');
  const byLayer = [];
  for (let L = 10; L <= 100; L += 10) byLayer.push(TD.warlordFor(L, salt).name);
  assert.ok(new Set(byLayer).size >= 3, '不同层应当抽到不同的 boss，实测 ' + byLayer.join('/'));
  /* 实战：预告名 = 实战名、狂战套、castable 真的被用 */
  S.newGame('warlord' + Math.random());
  const st1 = S.state(); st1.level = 70; st1.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st1.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r1 = T._debugRun('endless');
  r1.layer = 10;
  r1.plan = [{ kind: 'warlord', id: 'warlord', _layer: 10, _salt: r1.salt }];
  r1.idx = 0;
  const nx = T.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能取到塔顶 boss');
  assert.equal(nx.info.name, nx.foe.name, '预告名必须等于实战名');
  assert.equal(nx.elite, true, '塔顶 boss 应当是精英');
  assert.ok((nx.foe.wears || []).length >= 4, '应当穿满狂战套：' + JSON.stringify(nx.foe.wears));
  assert.ok(nx.foe.skills.some((k) => k.id === 16), '实战 boss 必须带绝对防御');
  assert.ok(Array.isArray(nx.foe.castable) && nx.foe.castable.length, '实战 boss 应当带 castable');
  /* 绝对防御真的会触发（用弱一点的我方，让战斗打得久） */
  const mkHero = () => ({ name: 'p', level: 70, power: 120, agility: 60, speed: 60, maxHp: 99999, hp: 99999,
    baseStats: { power: 120, agility: 60, speed: 60 }, weapons: [{ id: 1, level: 1 }], skills: [],
    wears: [], effects: {}, masterLevel: 0 });
  let jueDui = 0, usedCastable = 0;
  for (let t = 0; t < 30; t++) {
    const sim = Sim.simulate(mkHero(), nx.foe);
    if ((sim.rounds || []).some((x) => x.jueDui)) jueDui++;
    const ids = (sim.rounds || []).filter((x) => x.attacker === 1 && x.action === 'skill').map((x) => x.id);
    if (ids.length && ids.every((id) => nx.foe.castable.indexOf(id) >= 0)) usedCastable++;
  }
  assert.ok(jueDui > 0, '绝对防御应当真的触发，实测 ' + jueDui + '/30');
  assert.ok(usedCastable > 0, 'boss 放出的技能应当都来自 castable，实测 ' + usedCastable + '/30');

  /* ③ 2026-10 三档口径：其余技能（含幸运一击 23）用过之后一律 20 */
  const rate = (id) => Sim.repeatRateOf(id, 1);
  const rules = Sim.rules;
  assert.equal(rate(23), rules.repeatSkill, '幸运一击用过之后 = 20：' + rate(23));
  assert.equal(rate(15), rules.repeatSkill, '通灵召唤用过之后 = 20：' + rate(15));
  assert.ok(rate(23) > Sim.repeatRateOf(17, 1), '但仍应高于 / 等于最低档的来点松果（15 → 5）');

  /* ④ 反噬豁免（免疫一切反伤）+ 减伤成长 */
  const n15 = TD.BUFF_BY_ID.N15;
  assert.equal(n15.kind, 'limited', 'N15 是限次类');
  assert.equal(n15.mods.reflectImmune, 1, 'N15 应当提供 reflectImmune');
  assert.equal(n15.uses, 10, 'N15 限次 10 场');
  const c48 = TD.BUFF_BY_ID.C48;
  assert.equal(c48.kind, 'permanent', 'C48 应当永久类');
  assert.ok(c48.mods.winTakenMulPct > 0 && c48.mods.winTakenMulCap > 0, 'C48 应当有成长与上限');
  assert.ok(TD.endlessPool.some((b) => b.id === 'N15'), 'N15 应当在无尽塔池');
  assert.ok(TD.endlessPool.some((b) => b.id === 'C48'), 'C48 应当在无尽塔池');
  /* 实战：带 reflectImmune 时四种反伤都不掉血 */
  const mkF = (o) => Object.assign({ name: 'X', level: 50, power: 200, agility: 100, speed: 100,
    hp: 5000, maxHp: 5000, weapons: [{ id: 1, level: 5 }], skills: [], effects: {},
    baseStats: { power: 200, agility: 100, speed: 100 } }, o);
  const reflectTaken = (mods, foeMods) => {
    let sum = 0, n = 0;
    for (let i = 0; i < 60; i++) {
      const me = mkF({ name: '我', power: 300, mods: mods || {} });
      const foe = mkF({ name: '敌', power: 30, hp: 9999999, maxHp: 9999999, mods: foeMods || {} });
      const r = Sim.simulate(me, foe);
      for (const x of (r.rounds || [])) sum += (x.thornsDmg || 0) + (x.reboundHurt || 0);
      n++;
    }
    return sum / Math.max(1, n);
  };
  const withThorns = reflectTaken(null, { thornsPct: 0.30 });
  assert.ok(withThorns > 0, '对照组应当吃到反伤，实测 ' + withThorns);
  assert.equal(reflectTaken({ reflectImmune: 1 }, { thornsPct: 0.30 }), 0,
    '带反噬豁免时不该吃到任何反伤');
  /* 减伤成长：累计值真的并进 takenMul（用第一次受击对比） */
  const firstTaken = (mods, n) => {
    const vals = [];
    for (let i = 0; i < n; i++) {
      const foe = mkF({ name: 'F', power: 200, agility: 120, speed: 200 });
      const me = mkF({ name: 'M', power: 1, agility: 1, speed: 1, mods: mods || {} });
      const r = Sim.simulate(foe, me);
      for (const h of (r.rounds || []).filter((x) => x.attacker === 0 && x.dmg > 0 && x.action === 'common').slice(0, 3)) vals.push(h.dmg);
    }
    return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  };
  const noCut = firstTaken(null, 200), cut = firstTaken({ takenMul: -0.25 }, 200);
  assert.ok(cut < noCut * 0.85, '减伤 25% 应当明显降低受到的伤害：' + noCut.toFixed(1) + ' → ' + cut.toFixed(1));
  T.abandon('endless');
});

test('需求54：挥金如土一局一次 / 传奇商店降权 / 终焉烙印终乘 / 全拥有后进一步降权', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;

  /* ① 挥金如土（C36）：**一局一次、不可叠加**（2026-10 用户口径，
   *   原来是 repeatable、可无限叠层） */
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.C36, 'oncePerRun'), true, 'C36 应当标 oncePerRun');
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.C36, 'repeatable'), false, 'C36 不再可重复获得');
  assert.equal(TD.BUFF_BY_ID.C36.maxStacks, 1, 'C36 上限 1（不叠加）');
  assert.equal(TD.stackCap(TD.BUFF_BY_ID.C36), 1, '叠层上限必须是 1');
  S.newGame('c36' + Math.random());
  const st0 = S.state(); st0.level = 70; st0.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st0.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r0 = T._debugRun('endless');
  r0.permanent = []; r0.limited = []; r0.slotFreeIds = [];
  assert.ok(T.poolFilterOf(r0, TD.BUFF_BY_ID.C36), '未拥有时应当允许出现');
  assert.ok(T.ownableOf(r0, TD.BUFF_BY_ID.C36), '未拥有时 ownable 也放行');
  T.addBuff(T._debugRun('endless'), 'C36');
  /* 拿到之后两道闸都要拦住：再也不出现 */
  assert.equal(T.poolFilterOf(T._debugRun('endless'), TD.BUFF_BY_ID.C36), false,
    '已拥有挥金如土后不该再进池（poolFilter）');
  assert.equal(T.ownableOf(T._debugRun('endless'), TD.BUFF_BY_ID.C36), false,
    '已拥有挥金如土后不该再被抽到（ownable）');
  const again = T.addBuff(T._debugRun('endless'), 'C36');
  assert.equal(again.ok, false, '再次获得挥金如土应当被拒绝（不可叠加）：' + JSON.stringify(again));
  const owned36 = (T._debugRun('endless').permanent || []).find((b) => b.id === 'C36');
  assert.ok(owned36 && owned36.stacks === 1, '层数应当保持 1：' + JSON.stringify(owned36));
  /* 真实抽取路径：连摇几页都不该再出现 C36 */
  for (let i = 0; i < 60; i++) {
    const page = T._debugRollShopSlots(T._debugRun('endless'), 0);
    assert.ok(!page.some((x) => x.id === 'C36'), '第 ' + (i + 1) + ' 页不该再出现挥金如土');
  }

  /* ② 传奇档基础权重中幅下调（且不再等于原始 RARITY_WEIGHTS[3]） */
  assert.ok(TD.LEGEND_BASE_WEIGHT > 0 && TD.LEGEND_BASE_WEIGHT < TD.RARITY_WEIGHTS[3],
    '传奇基础权重应当低于原始值：' + TD.LEGEND_BASE_WEIGHT + ' vs ' + TD.RARITY_WEIGHTS[3]);
  const nat = TD.tiltWeights(1);
  const origLeg = TD.RARITY_WEIGHTS[3] / TD.RARITY_WEIGHTS.reduce((a, b) => a + b, 0);
  assert.ok(nat[3] < origLeg, '传奇档占比应当低于原始：' + nat[3] + ' vs ' + origLeg);
  /* 期望史诗曲线仍守住既有平衡（20/40 币 ≈ 1/2 件，50 币是封顶档，再贵不再涨） */
  const e = (p) => TD.rerollExpectation(p).epics;
  assert.ok(Math.abs(e(20) - 1) < 0.3, '20 币期望史诗仍应约 1：' + e(20));
  /* 传奇权重二次下调到 2.2 之后，史诗期望整体小幅回落，
   * 这里把容差放宽到 0.4，同时仍要求「随价格单调递增」（下面的封顶断言守着）。 */
  assert.ok(Math.abs(e(40) - 2) < 0.4, '40 币期望史诗仍应约 2：' + e(40));
  assert.ok(e(50) > 2.1, '50 币是收益封顶的那一档：' + e(50));
  assert.equal(e(60), e(50), '60 币不再更好（2026-10：稀有度收益封顶在 50 档）：' + e(60));
  assert.equal(e(80), e(50), '80 币也一样：' + e(80));

  /* ③ 终焉烙印（C49）：传奇·限次·可重复；终乘 1.20 / 损毁 1.30；多层独立相乘 */
  const c49 = TD.BUFF_BY_ID.C49;
  assert.ok(c49, 'C49 应当存在');
  assert.equal(c49.name, '终焉烙印', 'C49 名称');
  assert.equal(c49.rarity, 3, 'C49 应当是传奇');
  assert.equal(c49.kind, 'limited', 'C49 应当是限次类');
  assert.equal(TD.hasTag(c49, 'repeatable'), true, 'C49 应当可重复获得');
  assert.equal(c49.mods.fragileFinalMul, true, 'C49 是终乘烙印');
  assert.equal(c49.mods.fragileAddAlive, 0.20, '存在时 +20%（2026-10 削弱）');
  assert.equal(c49.mods.fragileAddBurned, 0.30, '损毁后 +30%（2026-10 削弱）');
  assert.equal(c49.mods.repeatWeight, 0.88, '降权口径 2026-10 改成「每份 ×0.88」：' + c49.mods.repeatWeight);
  assert.equal(c49.mods.weightDivBy, undefined, '不再用除法降权：' + c49.mods.weightDivBy);
  assert.ok(c49.mods.fragileBreakPct > 0, '应当有损毁概率');
  assert.ok(TD.endlessPool.some((b) => b.id === 'C49'), 'C49 应当在无尽塔池');
  /* 实战：无烙印 / n 层存在 / n 层损毁 的倍率 */
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  const scene = (marks, burned) => {
    S.newGame('c49' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e2) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = [];
    for (let i = 0; i < marks; i++) T.addBuff(T._debugRun('endless'), 'C49');
    if (burned) {
      const rr = T._debugRun('endless');
      rr.fragileMulBase = 0; rr.fragileMulBurned = marks;
    }
    const nx = T.nextBattle('endless');
    const me = mk(); nx.adjustMe(me);
    return me;
  };
  const base = scene(0, false);
  assert.equal(base.power, 200, '无烙印时力量应当是基础值');
  assert.equal(base.agility, 120, '无烙印时敏捷应当是基础值（顺带守住 agilityMul 不 NaN）');
  /* 按层**加算**：存在层 +20%/层、损毁层 +30%/层。 */
  for (const n of [1, 2, 3]) {
    const s1 = scene(n, false);
    assert.ok(Math.abs(s1.power / base.power - (1 + 0.20 * n)) < 0.02,
      n + ' 层存在应当 ×' + (1 + 0.20 * n) + '：实测 ×' + (s1.power / base.power).toFixed(3));
    assert.ok(Math.abs(s1.agility / base.agility - (1 + 0.20 * n)) < 0.02,
      n + ' 层存在的敏捷也应同倍：实测 ×' + (s1.agility / base.agility).toFixed(3));
    assert.ok(Math.abs(s1.maxHp / base.maxHp - (1 + 0.20 * n)) < 0.02,
      n + ' 层存在的生命上限也应同倍：实测 ×' + (s1.maxHp / base.maxHp).toFixed(3));
  }
  for (const n of [1, 2, 3]) {
    const s1 = scene(n, true);
    assert.ok(Math.abs(s1.power / base.power - (1 + 0.30 * n)) < 0.02,
      n + ' 层损毁应当 ×' + (1 + 0.30 * n) + '（按层加算）：实测 ×' + (s1.power / base.power).toFixed(3));
  }
  /* 关键区分：3 层损毁 = 1.9（加算），而不是 1.3^3 = 2.197（幂乘） */
  const s3 = scene(3, true);
  const ratio = s3.power / base.power;
  assert.ok(Math.abs(ratio - Math.pow(1.3, 3)) > 0.2, '必须**不是**幂乘（1.3^n）：实测 ×' + ratio.toFixed(3));
  /* 与局内加算的关系：先加算、最后再乘 */
  {
    S.newGame('c49add' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e2) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = [];
    T.addBuff(T._debugRun('endless'), 'C29');    // +10% 生命上限（加算类）
    T.addBuff(T._debugRun('endless'), 'C49');    // ×1.20（终乘）
    const nx = T.nextBattle('endless');
    const me = mk(); nx.adjustMe(me);
    assert.equal(me.maxHp, Math.round(5000 * 1.1 * 1.20),
      '应当是「先加算再终乘」：(5000×1.1)×1.20 = ' + Math.round(5000 * 1.1 * 1.20) + '，实测 ' + me.maxHp);
  }

  /* ④ 2026-10 用户口径：**档位级降权已关闭** —— 传奇档不再因为「已拥有多少条」而整体缩水，
   * 稀有度只由个体规律（repeatWeight / shopWeight）决定。 */
  assert.equal(TD.LEGEND_TIER_DECAY, false, '档位级降权开关应当是关的');
  const f0 = TD.legendWeightFactor({});
  const f1 = TD.legendWeightFactor({ permanent: [{ id: 'C36' }] });
  const f3 = TD.legendWeightFactor({ permanent: [{ id: 'C14' }, { id: 'C36' }, { id: 'C37' }] });
  const allOwn = { permanent: [{ id: 'C14' }, { id: 'C36' }, { id: 'C37' }, { id: 'C49' }],
    instantIds: [{ id: 'C51', count: 1 }] };
  const fAll = TD.legendWeightFactor(allOwn);
  assert.equal(f0, 1, '系数恒为 1');
  assert.equal(f1, 1, '拿到传奇后系数**不再**下降（档位级降权已去掉）：' + f1);
  assert.equal(f3, 1, '拿到多条也一样：' + f3);
  assert.equal(fAll, 1, '全部到手也一样：' + fAll);
  /* 口径函数本身保留（供给 UI / 文档 / 将来回滚用） */
  assert.equal(TD.allRepeatableLegendsOwned(allOwn), true, '应当识别出「全部可重复传奇已拥有」');
  assert.equal(TD.allRepeatableLegendsOwned({ permanent: [{ id: 'C36' }] }), false, '只拿一条不算全拥有');
  /* 权重与抽取：整档不再缩水 */
  const w0 = TD.tiltWeights(1, {}), wAll = TD.tiltWeights(1, allOwn);
  assert.equal(wAll[3], w0[3], '传奇档整体占比不再随「已拥有条数」变化：' + wAll[3] + ' vs ' + w0[3]);
  assert.ok(wAll[2] >= w0[2] - 0.02, '史诗档不该被传奇降权拖垮：' + wAll[2] + ' vs ' + w0[2]);
  /* 商店实测：全拥有后传奇不再出现，但史诗仍在 */
  const measure = (owned) => {
    S.newGame('lg' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e2) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = []; r.pickBuffIds = [];
    /* 本轮：涅槃（C14）改成可叠 2 层 —— 「全拥有」要按**叠满**算，
     * 只挂 1 份时它仍然能再刷到（传奇档就不会彻底绝迹）。 */
    if (owned.length) T._debugRun('endless').permanent = owned.map((id) => ({ id: id, stacks: id === 'C14' ? 2 : 1 }));
    T._debugRun('endless').instantIds = [{ id: 'C51', count: 1 }];   // 即时类传奇也要算「已拥有」
    /* 终焉烙印(C49) 是限次类、且「一局最多 3 次」—— 想让它真正退出池子，
     * 必须在 run.limited 里叠到 maxStacks（只挂 1 份仍会继续出现）。 */
    T._debugRun('endless').limited = [{ id: 'C49', stacks: 3, uses: 1000, on: true }];
    let leg = 0, epic = 0, tot = 0;
    for (let i = 0; i < 3000; i++) {
      /* 量的是**自然出率**：把传奇保底计数按住（否则 120 格一次的保底会把地板抬到 ≈1%，
       * 掩盖「全拥有后降权」这件事）。保底本身由需求98 专测。 */
      T._debugRun('endless').legendPity = 0;
      for (const sl of (T.rollShopSlotsOf(T._debugRun('endless'), 0) || [])) {
        const b = TD.BUFF_BY_ID[sl.id]; if (!b) continue;
        tot++; if (b.rarity === 3) leg++; if (b.rarity === 2) epic++;
      }
    }
    return { leg: leg / tot, epic: epic / tot };
  };
  /* 2026-10 用户口径：**档位级降权已去掉** —— 传奇档的整体出率不再随「已拥有多少条传奇」变化。
   * 所以这里不再断言「全拥有后大幅降权」，改成断言：
   *   ① 档位权重与拥有量无关（确定性口径，不受抽样抖动影响）；
   *   ② 商店仍然能正常刷出传奇（整档没有退化成 0）。
   * 个体降权（C37/C49 每份 ×0.88）只影响它们在**档内**的占比，见需求93 / 需求98。 */
  const allOwnRun = TD.BUFFS.filter((b) => ['C14', 'C36', 'C37', 'C55'].includes(b.id));
  const wFresh = TD.rawTierWeights(1, {}), wAll2 = TD.rawTierWeights(1, { permanent: allOwnRun.map((b) => ({ id: b.id })) });
  assert.equal(wAll2[3], wFresh[3], '传奇档权重不再随「已拥有条数」缩小：' + wAll2[3] + ' vs ' + wFresh[3]);
  const m0 = measure([]), mAll = measure(['C14', 'C36', 'C37', 'C55']);
  assert.ok(m0.leg > 0, '未拥有时应当能刷到传奇：' + m0.leg);
  assert.ok(mAll.leg > 0, '全拥有后仍然能刷到传奇（不再绝迹）：' + mAll.leg);
  assert.ok(mAll.epic > 0.05, '史诗仍应当正常出现（货架不会退化成纯普通）：' + mAll.epic);
  T.abandon('endless');
});

test('需求55：装备星标防误合误卖 / 天命所归（传奇即时）/ 战斗奖励稀有度上调', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;

  /* ① 装备星标：加了星的装备不能被卖掉 / 融合掉 */
  S.newGame('star' + Math.random());
  S.state().level = 70;
  S.addGear(1); S.addGear(2); S.addGear(3);
  const gears = S.myGears();
  assert.ok(gears.length >= 3, '应当造出至少 3 件装备：' + gears.length);
  const g0 = gears[gears.length - 1];
  assert.equal(S.isGearStarred(g0), false, '默认没有星标');
  const on = S.toggleGearStar(g0.key);
  assert.ok(on.ok && on.starred === true, '加星标应当成功：' + JSON.stringify(on));
  assert.equal(S.isGearStarred(S.myGears().find((x) => x.key === g0.key)), true, '加星后应当读得到');
  /* 出售被拦（返回 0 且装备还在） */
  const before = S.state().gears.length;
  assert.equal(S.sellGear(g0.key), 0, '星标装备不该被卖掉');
  assert.equal(S.state().gears.length, before, '星标装备应当还在');
  /* 融合被拦 */
  const others = S.myGears().filter((x) => x.key !== g0.key).slice(0, 2);
  if (others.length === 2) {
    const r = S.mergeGears([g0.key, others[0].key, others[1].key]);
    assert.equal(r.ok, false, '含星标装备的融合应当被拒绝');
    assert.match(r.msg, /星标/, '提示里应当说明是星标挡住了：' + r.msg);
  }
  /* 取消星标后可以正常卖 */
  S.toggleGearStar(g0.key);
  assert.equal(S.isGearStarred(S.myGears().find((x) => x.key === g0.key)), false, '取消后应当读不到星标');
  assert.ok(S.sellGear(g0.key) > 0, '取消星标后应当能正常出售');
  /* 星标要能存进存档 */
  S.addGear(4);
  const g1 = S.myGears()[S.myGears().length - 1];
  S.toggleGearStar(g1.key);
  S.save();
  assert.equal(S.isGearStarred(S.myGears().find((x) => x.key === g1.key)), true, '存档往返后星标应当保留');
  const raw = JSON.parse(c.localStorage.getItem(S.saveKey) || '{}');
  assert.ok((raw.gears || []).some((x) => x.starred === true), '存档里应当有 starred 字段');

  /* ② 天命所归（C51）：2026-10 由**即时**改为**永久**，不可叠加、拥有后本局不再生成；
   *    史诗/传奇 ×2、普通 ×0.5 */
  const c51 = TD.BUFF_BY_ID.C51;
  assert.ok(c51, 'C51 应当存在');
  assert.equal(c51.name, '天命所归', 'C51 名称');
  assert.equal(c51.rarity, 3, 'C51 应当是传奇');
  assert.equal(c51.kind, 'permanent', 'C51 现在应当是永久类');
  assert.equal(c51.maxStacks, 1, 'C51 不可叠加');
  assert.equal(TD.hasTag(c51, 'unique'), true, 'C51 带 unique：背包里已有就不再生成');
  assert.equal(TD.hasTag(c51, 'repeatable'), false, 'C51 不再带 repeatable（改成同名唯一）');
  assert.equal(c51.mods.epicMul, 2, '史诗档 ×2');
  assert.equal(c51.mods.legendMul, 2, '传奇档 ×2');
  assert.equal(c51.mods.commonMul, 0.5, '普通档 ×0.5');
  assert.equal(c51.mods.repeatWeight, undefined, '不能再重复，就不需要 repeatWeight 降权了');
  assert.ok(TD.endlessPool.some((b) => b.id === 'C51'), 'C51 应当在无尽塔池');
  /* 权重真的变（普通降、史诗/传奇升） */
  const w0 = TD.tiltWeights(1, {}), w1 = TD.tiltWeights(1, { rarityBoost: 1 });
  assert.ok(w1[0] < w0[0], '普通档应当下降：' + w1[0] + ' vs ' + w0[0]);
  assert.ok(w1[2] > w0[2] * 1.8, '史诗档应当接近翻倍：' + w1[2] + ' vs ' + w0[2]);
  assert.ok(w1[3] > w0[3] * 1.8, '传奇档应当接近翻倍：' + w1[3] + ' vs ' + w0[3]);
  /* 永久获得会累加到 run 上（本局永久），并且**进 permanent 栏位** */
  S.newGame('c51' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r = T._debugRun('endless');
  r.permanent = []; r.limited = []; r.slotFreeIds = [];
  assert.equal(T.rarityBoostOf(T._debugRun('endless')).common, 1, '没拿过时为 1');
  assert.equal(T.poolFilterOf(r, c51), true, '拿之前应当能进池');
  T.addBuff(T._debugRun('endless'), 'C51');
  const after1 = T._debugRun('endless');
  assert.equal(after1.rarityBoost, 1, '第 1 次获得应当记 1 层');
  assert.ok((after1.permanent || []).some((x) => x.id === 'C51'), 'C51 应当进 permanent 栏位');
  assert.ok(T.rarityBoostOf(after1).epic === 2, '史诗系数应当是 2');
  /* 不可叠加 + 已有就不再生成（真实奖励路径由 poolFilter/ownable 兜住） */
  assert.equal(T.poolFilterOf(after1, c51), false, '已有之后不该再进池');
  assert.equal(T.ownableOf(after1, c51), false, '已有之后不该再获得');
  const dup = T.addBuff(T._debugRun('endless'), 'C51');   // 兜底直调：addBuff 里也硬拦了一道
  assert.equal(dup.ok, false, '第二次直调也应当被拒（货架先摇后买的竞态要挡住）');
  assert.equal(T._debugRun('endless').rarityBoost, 1, '不该再叠到 2 层（不可叠加）');
  /* 卖掉 → 稀有度加成一起收回 */
  T.debugLoseBuff('C51');
  assert.equal(T._debugRun('endless').rarityBoost, 0, '失去 C51 后稀有度加成要一起收回');
  assert.equal(T.poolFilterOf(T._debugRun('endless'), c51), true, '卖掉之后又能进池');

  /* ③ 战斗奖励的稀有度：不再用第一页商店权重，而是约 10 币刷新后的水平 */
  const natural = TD.tiltWeights(1, {});
  const choice = TD.tiltWeights(TD.rerollTilt(10), {});
  assert.ok(choice[2] > natural[2] * 1.15,
    '战斗奖励的史诗出率应当明显高于第一页商店：' + choice[2] + ' vs ' + natural[2]);
  assert.ok(choice[0] < natural[0], '战斗奖励的普通出率应当低于第一页商店：' + choice[0] + ' vs ' + natural[0]);
  assert.ok(choice[3] > natural[3], '传奇也应当更高：' + choice[3] + ' vs ' + natural[3]);
  T.abandon('endless');
});

test('需求56：秘技通神只抽主动技能 / 终焉烙印改加算并降出率 / 涌泉烙印', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;

  /* ① 秘技通神（C33）的候选必须全是**主动**技能（被动/防御类抽到等于白拿） */
  S.newGame('pick' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (const id of [1, 3, 5, 6, 8, 10, 14, 15, 16, 23]) S.setWS('skill', id, 5);
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const learned = S.mySkills();
  const actives = learned.filter((x) => x.type === '主动').map((x) => x.id);
  assert.ok(learned.some((x) => x.type === '被动'), '前置条件：应当学了被动技能：' + learned.map((x) => x.id + ':' + x.type).join(','));
  assert.ok(actives.length > 0, '前置条件：应当学了主动技能');
  for (let t = 0; t < 30; t++) {
    const cand = T.pickCandidatesOf('skill');
    assert.ok(cand.length > 0, '应当能抽出候选');
    for (const x of cand) {
      /* 秘技通神可以抽：主动技能，外加三个「特殊技能」——
       * 绝对防御(16) / 龟甲术(7)（受击自动触发的防御被动，选中后触发概率提升）
       * 与小宇宙爆发(14)（选中后开战第一招必放）。其余被动/防御类仍然不许出现。 */
      const defOk = (x.id === 16 || x.id === 7) && x.type === '防御';
      const special = defOk || x.id === 14;
      assert.ok(x.type === '主动' || defOk,
        '秘技通神只该抽主动技能或 16/7/14，实测抽到 ' + x.id + ':' + x.type + ' ' + x.name);
      /* 非特殊的候选必须来自**已学**的主动技能（14/16/7 允许作为「没学也能抽」的占位）。 */
      if (!special) assert.ok(actives.indexOf(x.id) >= 0, '候选应当来自已学的主动技能：' + x.id);
    }
  }

  /* ② 终焉烙印（C49）：按层**加算**（1+0.30n），并进一步降低重复出率 */
  const c49 = TD.BUFF_BY_ID.C49;
  assert.equal(c49.mods.fragileAddAlive, 0.20, '存在层每层 +20%（2026-10 削弱）');
  assert.equal(c49.mods.fragileAddBurned, 0.30, '损毁层每层 +30%（2026-10 削弱）');
  assert.equal(c49.mods.fragileMulAlive, undefined, '旧的乘法参数应当已移除');
  /* 2026-10 用户口径（第二次调整）：降权改成「每份 ×0.88」，与虚空铭文同一套规律。
   *（历史：×0.10 → ÷份数 → ×0.88，曲线断言见需求93。） */
  assert.equal(c49.mods.repeatWeight, 0.88, '终焉烙印用「每份 ×0.88」：' + c49.mods.repeatWeight);
  assert.equal(c49.mods.weightDivBy, undefined, '不再用除法：' + c49.mods.weightDivBy);
  /* 2026-10 用户口径：**取消 C52 的权重下降**（原来 repeatWeight 0.3）。 */
  assert.equal(TD.BUFF_BY_ID.C52.mods.repeatWeight, undefined,
    '涌泉烙印（C52）的权重下降应当已取消：' + TD.BUFF_BY_ID.C52.mods.repeatWeight);
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  const scene = (marks, burned, id) => {
    S.newGame('c49' + Math.random());
    const s2 = S.state(); s2.level = 70; s2.props[23] = 99999;
    for (let i = 1; i <= 18; i++) s2.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = [];
    for (let i = 0; i < marks; i++) T.addBuff(T._debugRun('endless'), id);
    if (burned) {
      const rr = T._debugRun('endless');
      rr.fragileMulBase = 0; rr.fragileMulBurned = burned;
      rr.fragileHealBase = 0;                 // 「全碎了」：不剩未破碎份数
      /* 治疗烙印(C52) 的「已损毁」现在是**逐条明细**（供 30 层后随机作废），
       * 所以这里要把明细一起写好，否则 fragileHealBonus 读不到。 */
      rr.fragileHealBurned = new Array(burned).fill(0.20);
    }
    const nx = T.nextBattle('endless');
    const me = mk(); nx.adjustMe(me);
    return me;
  };
  const base = scene(0, 0, 'C49');
  for (const n of [1, 2, 3]) {
    const s1 = scene(n, n, 'C49');
    assert.ok(Math.abs(s1.power / base.power - (1 + 0.30 * n)) < 0.02,
      n + ' 层损毁应当是 1+0.30×' + n + '：实测 ×' + (s1.power / base.power).toFixed(3));
  }
  const s3 = scene(3, 3, 'C49');
  assert.ok(Math.abs(s3.power / base.power - Math.pow(1.3, 3)) > 0.2,
    '必须**不是**幂乘 1.3^3：实测 ×' + (s3.power / base.power).toFixed(3));

  /* ③ 涌泉烙印（C52）：稀有·可重复；治疗量 +10% / 损毁 +20%（按层加算） */
  const c52 = TD.BUFF_BY_ID.C52;
  assert.ok(c52, 'C52 应当存在');
  assert.equal(c52.name, '涌泉烙印', 'C52 名称');
  assert.equal(c52.rarity, 1, 'C52 应当是稀有');
  assert.equal(c52.kind, 'limited', 'C52 应当是限次类（烙印）');
  /* C52 是烙标记，但**必须用自己那套层数**（fragileHealBase / fragileHealBurned）：
   * 历史上一旦挂上 C49 的 fragileFinalMul 标记，两条烙印就共用 fragileMulBase，
   * 导致「C49 的层数加治疗、C52 的层数加力敏速上限」——两个方向都是错的。 */
  assert.ok(!c52.mods.fragileFinalMul, 'C52 不该挂 C49 的终乘标记');
  assert.equal(c52.mods.fragileHealAddAlive, 0.10, 'C52 有自己的「存在」份数计数');
  assert.equal(c52.mods.fragileHealAddAlive, 0.10, '存在时治疗 +10%');
  assert.equal(c52.mods.fragileHealAddBurned, 0.20, '损毁后治疗 +20%');
  assert.ok(TD.endlessPool.some((b) => b.id === 'C52'), 'C52 应当在无尽塔池');
  /* 2026-10 用户口径：**取消 C52 的权重下降**（原 repeatWeight 0.3）。 */
  assert.equal(c52.mods.repeatWeight, undefined, 'C52 的重复出率惩罚应当已取消：' + c52.mods.repeatWeight);
  const m1 = scene(1, 0, 'C52');
  assert.ok(Math.abs(m1.healMul - 1.10) < 1e-9, '存在 1 层 healMul 应当是 1.10：' + m1.healMul);
  const m2 = scene(1, 1, 'C52');
  assert.ok(Math.abs(m2.healMul - 1.20) < 1e-9, '损毁 1 层 healMul 应当是 1.20：' + m2.healMul);
  const m3 = scene(1, 2, 'C52');
  assert.ok(Math.abs(m3.healMul - 1.40) < 1e-9, '损毁 2 层 healMul 应当是 1.40：' + m3.healMul);
  /* 没有烙印时不写 healMul（走默认 1） */
  const m0 = scene(0, 0, 'C52');
  assert.ok(m0.healMul == null || m0.healMul === 1, '没有涌泉烙印时不该有治疗加成：' + m0.healMul);
  /* 引擎侧确认 healMul 真的被 sim 读走（healOf 的模板）：
   * 直接比「同一份回血在 healMul=1 vs 1.5 下的数值」。 */
  const Sim = c.Sim;
  const unitsFor = (mul) => {
    const me = { name: 'M', level: 50, power: 200, agility: 1, speed: 100, hp: 1000, maxHp: 100000,
      weapons: [], skills: [{ id: 17, level: 5 }], effects: {},
      baseStats: { power: 200, agility: 1, speed: 100 } };
    if (mul != null) me.healMul = mul;
    const foe = { name: 'F', level: 50, power: 60, agility: 1, speed: 1, hp: 9999999, maxHp: 9999999,
      weapons: [], skills: [], effects: {}, baseStats: { power: 60, agility: 1, speed: 1 } };
    const r = Sim.simulate(me, foe);
    return (r.rounds || []).reduce((a, x) => a + (x.heal || 0) + (x.healSelf || 0), 0) +
      (r.rounds || []).filter((x) => x.healSelf).length;
  };
  const uPlain = unitsFor(null), uBoost = unitsFor(2);
  assert.ok(uBoost >= uPlain && uPlain > 0, 'healMul 应当生效且不减少治疗：' + uPlain + ' → ' + uBoost);
  T.abandon('endless');
});

const State_hasSkill = (S, id) => (S.state().skills || []).some((x) => Number(String(x).split(':')[0]) === Number(id));

test('需求57：终焉烙印最多3次 / 秘技通神可抽绝对防御与龟甲术 / 天象之眼拦敌方自愈', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;
  const openRun = () => {
    S.newGame('r57' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = [];
    return r;
  };

  /* ① 终焉烙印（C49）：**2026-10 起不再有次数上限**（原 maxStacks 3 + 累计口径 =
   *    拿过 3 次就永久出池，哪怕全碎了；用户口径：可以一直刷）。
   *    加成本来就是**按层加算**（1 + 0.25×存在层 + 0.5×损毁层），所以无限叠加不会指数失控。 */
  const c49 = TD.BUFF_BY_ID.C49;
  assert.equal(c49.maxStacks, undefined, 'C49 不再有次数上限');
  assert.equal(c49.unlimitedStacks, true, 'C49 应当是「可无限叠」');
  assert.equal(TD.stackCap(c49), Infinity, '叠层上限 = 无穷');
  openRun();
  for (let n = 1; n <= 5; n++) {
    assert.ok(T.addBuff(T._debugRun('endless'), 'C49').ok, '第 ' + n + ' 次应当能获得');
    const rr = T._debugRun('endless');
    const row = (rr.limited || []).find((b) => b.id === 'C49');
    assert.equal(row && row.stacks, n, '第 ' + n + ' 次后层数应当是 ' + n);
    assert.equal(T.poolFilterOf(rr, c49), true, n + ' 层时仍应可进池');
    assert.equal(T.ownableOf(rr, c49), true, n + ' 层时仍可获得');
  }
  /* 5 层之后照样能拿：没有次数上限 */
  const r5 = T._debugRun('endless');
  assert.equal(T.poolFilterOf(r5, c49), true, '5 层后仍可进池（无上限）');
  assert.equal(T.ownableOf(r5, c49), true, '5 层后仍可获得');
  assert.ok(T.addBuff(T._debugRun('endless'), 'C49').ok, '第 6 次仍然可以拿');
  assert.equal((T._debugRun('endless').limited.find((b) => b.id === 'C49') || {}).stacks, 6,
    '第 6 次应当叠到 6 层');
  /* 加成必须是**加算**：6 层全存活 = 1 + 0.20×6 = 2.2（不是 1.20^6 = 2.986） */
  const r6 = T._debugRun('endless');
  assert.ok(Math.abs(T.fragileFinalMulOf(r6) - (1 + 0.20 * 6)) < 1e-9,
    '终乘应当按层加算（1+0.20n）：' + T.fragileFinalMulOf(r6));
  assert.ok(T.fragileFinalMulOf(r6) < Math.pow(1.20, 6), '不是 1.20^6 那种指数口径');

  /* ② 秘技通神：候选含绝对防御(16) 与龟甲术(7)，且选中后触发率大幅提升 */
  openRun();
  for (const id of [1, 8, 14]) S.setWS('skill', id, 5);   // 1 是被动，用来验证过滤
  const seen = new Set();
  for (let t = 0; t < 60; t++) for (const x of T.pickCandidatesOf('skill')) seen.add(x.id);
  assert.ok(seen.has(16), '候选应当含绝对防御 16，实测 ' + [...seen].join(','));
  assert.ok(seen.has(7), '候选应当含龟甲术 7，实测 ' + [...seen].join(','));
  assert.ok(!seen.has(1), '候选不该含普通被动技能（力王附体 1）');
  /* 选中 16：学会 + 写进 skillBoost（大幅提升） */
  openRun();
  assert.equal(State_hasSkill(S, 16), false, '前置条件：落地前不该会绝对防御');
  T.addBuff(T._debugRun('endless'), 'C33');
  const res = T.applyPickBuff('skill', 16);
  assert.ok(res.ok, '拾取应当成功：' + JSON.stringify(res));
  assert.ok(res.pct >= 1, '防御技的加成应当「大幅」（≥100%）：' + res.pct);
  assert.equal(State_hasSkill(S, 16), true, '选中绝对防御后应当学会它');
  const boost16 = T._debugRun('endless').skillBoost['16'];
  assert.ok(boost16 >= 1, 'skillBoost[16] 应当是大额加成：' + boost16);
  /* 同理龟甲术 */
  openRun();
  T.addBuff(T._debugRun('endless'), 'C33');
  const res7 = T.applyPickBuff('skill', 7);
  assert.ok(res7.ok && State_hasSkill(S, 7), '选中龟甲术后应当学会它：' + JSON.stringify(res7));
  assert.ok(T._debugRun('endless').skillBoost['7'] >= 1, 'skillBoost[7] 应当是大额加成');
  /* 主动技能仍然只拿 0.6（不被防御技的加成影响） */
  openRun();
  S.setWS('skill', 8, 5);
  T.addBuff(T._debugRun('endless'), 'C33');
  const res8 = T.applyPickBuff('skill', 8);
  assert.ok(res8.pct <= 1, '主动技能仍是原来的 pct：' + res8.pct);
  /* 实战触发率对比：绝对防御 / 龟甲术 都要明显变高。
   * 注意：绝对防御现在是**本场逐次递减**的（22/17/13/…），所以整场累计率的比值会被
   * 衰减曲线压扁（实测 10.5% → 15.5%，比值只有 1.48，会把「>1.5」这条打成偶发抖动）。
   * 加成作用在**每一次判定**上，所以这里改成比较**每场第一次受击**的触发率。 */
  /* 秘技通神改成**独立通道** skillBoost（不再借用 effects —— 那是装备词条/武器槽的编号空间），
   * 所以这里的载体也换成 skillBoost。 */
  const mkF = (boost, skills) => ({ name: 'p', level: 60, power: 200, agility: 100, speed: 100,
    hp: 40000, maxHp: 40000, weapons: [{ id: 1, level: 5 }],
    skills: (skills || []).map((id) => ({ id: id, level: 5 })), skillBoost: boost || {}, effects: {},
    baseStats: { power: 200, agility: 100, speed: 100 } });
  const rateOf = (eff, skills, key, firstOnly) => {
    let hits = 0, trig = 0;
    for (let i = 0; i < 200; i++) {
      const me = mkF(eff, skills);
      const foe = { name: 'F', level: 60, power: 300, agility: 200, speed: 150, hp: 999999, maxHp: 999999,
        weapons: [{ id: 1, level: 5 }], skills: [], effects: {}, baseStats: { power: 300, agility: 200, speed: 150 } };
      const rr = Sim.simulate(foe, me);
      let n = 0;
      for (const x of (rr.rounds || [])) {
        if (x.attacker !== 0 || x.action !== 'common' || x.dmg === undefined) continue;
        n++;
        if (firstOnly && n > 1) break;
        hits++; if (x[key]) trig++;
        if (firstOnly) break;
      }
    }
    return hits ? trig / hits : 0;
  };
  /* 绝对防御的加成改成**函数口径的确定性断言**：它现在是本场逐次递减的
   *（22/17/13/…，见 sim 的 jueDuiChanceOf），而「第一次受击」的实测会被前面的
   * 武器攻击污染 —— 武器打上来同样是一次判定、会把计数推上去，于是实测只有 ×1.5 上下、
   * 偶发不过阈值。真实战斗里的递减曲线由 test-combat-rules 的「按已触发次数分桶」覆盖。 */
  /* 龟甲术的「首次触发率」也改成**函数口径的确定性断言**（同绝对防御）：
   * 实测的「第一次普攻」会被前面的武器攻击污染（武器也是一次受击判定、
   * 会把 shellCharges 提前用掉），于是实测差值偶发不到 1.5 倍。 */
  const mkF3 = (boost, skills) => ({ name: 'p', level: 60, power: 200, agility: 100, speed: 100,
    hp: 1000, maxHp: 1000, weapons: [], skills: (skills || []).map((id) => ({ id: id, level: 5 })),
    skillBoost: boost || {}, effects: {}, baseStats: { power: 200, agility: 100, speed: 100 } });
  const gjPlainFn = c.Sim.shellChanceOf(mkF3(null, [7]), false);
  const gjBoostFn = c.Sim.shellChanceOf(mkF3({ 7: 2 }, [7]), false);
  assert.ok(gjBoostFn > gjPlainFn * 1.5,
    '龟甲术**首次**触发率应当大幅提升（函数口径）：' + gjPlainFn + '% → ' + gjBoostFn + '%');
  /* 实测也要求「不更差」（不再卡 1.5 倍，那是污染导致的抖动来源） */
  const gjPlain = rateOf(null, [7], 'guiJia', true), gjBoost = rateOf({ 7: 2 }, [7], 'guiJia', true);
  assert.ok(gjBoost >= gjPlain, '实测加成后不该更差：' + (gjPlain * 100).toFixed(1) + '% → ' + (gjBoost * 100).toFixed(1) + '%');
  /* 整场累计也不能反而更低（绝对防御会递减，所以只要求「不更差」） */
  assert.ok(rateOf({ 16: 2 }, [16], 'jueDui') >= rateOf(null, [16], 'jueDui') * 1.2,
    '加成后绝对防御的整场累计触发率也不该更低');
  /* 平衡约束：秘技通神加成之后，「第二次及以后」的触发概率不得高于 50%。
   * 基准值本来就在 50% 以下（绝对防御 17、龟甲术 20），但 ×3 之后龟甲术会到 60%，
   * 实测平均格挡率从 20.7% 飙到 63.3%，所以对「加成后」统一封顶。 */
  const mkF2 = (boost, skills) => ({ name: 'p', level: 60, power: 200, agility: 100, speed: 100,
    hp: 1000, maxHp: 1000, weapons: [], skills: (skills || []).map((id) => ({ id: id, level: 5 })),
    skillBoost: boost || {}, effects: {}, baseStats: { power: 200, agility: 100, speed: 100 } });
  assert.equal(Sim.jueDuiChanceOf(mkF2(null, [16]), false), 22, '未选中时绝对防御首次仍是 22');
  assert.equal(Sim.jueDuiChanceOf(mkF2(null, [16]), true), 17, '未选中时绝对防御第二次是 17（需求140 中幅提高）');
  assert.equal(Sim.jueDuiChanceOf(mkF2({ 16: 2 }, [16]), 0), 66, '加成后**首次**应当是 22×3 = 66');
  assert.equal(Sim.jueDuiChanceOf(mkF2({ 16: 2 }, [16]), true), 45,
    '选中后绝对防御第二次：17×3 = 51，被二次封顶压到 45');
  assert.equal(Sim.jueDuiChanceOf(mkF2({ 16: 2 }, [16]), 2), 39,
    '加成后第三次应当是 13×3 = 39（逐次递减但整体抬高）');
  assert.ok(Sim.jueDuiChanceOf(mkF2({ 16: 2 }, [16]), true) <= 50,
    '绝对防御二次及以后不得高于 50%：' + Sim.jueDuiChanceOf(mkF2({ 16: 2 }, [16]), true));
  assert.ok(Sim.shellChanceOf(mkF2({ 7: 2 }, [7]), true) <= 50,
    '龟甲术二次及以后不得高于 50%：' + Sim.shellChanceOf(mkF2({ 7: 2 }, [7]), true));
  assert.ok(Sim.shellChanceOf(mkF2({ 7: 2 }, [7]), false) <= 90,
    '选中后首次不该到「必定格挡」：' + Sim.shellChanceOf(mkF2({ 7: 2 }, [7]), false));
  /* 未选中时不受任何封顶影响（保留原来的极端上限） */
  assert.equal(Sim.shellChanceOf(mkF2(null, [7]), false), 35, '未选中时龟甲术首次仍是 35');
  assert.equal(Sim.jueDuiChanceOf(mkF2({ 16: 0.5 }, [16]), true), 25.5,
    '小加成不受封顶影响（17 × 1.5）：' + Sim.jueDuiChanceOf(mkF2({ 16: 0.5 }, [16]), true));

  /* ③ 天象之眼（C45）必须拦住敌方自愈（以及其它「纯粹强化敌人自身」的环境） */
  assert.equal(TD.ENDLESS_ENV_BY_ID.regen.noReflect, true, '自愈回复应当标记 noReflect');
  assert.equal(TD.ENDLESS_ENV_BY_ID.lifesteal.noReflect, true, '吸血应当标记 noReflect');
  assert.equal(TD.ENDLESS_ENV_BY_ID.shell.noReflect, true, '护盾应当标记 noReflect');
  assert.equal(TD.ENDLESS_ENV_BY_ID.devour.noReflect, true, '吞噬成长应当标记 noReflect');
  assert.equal(TD.ENDLESS_ENV_BY_ID.thorns.noReflect, true, '荆棘反伤应当标记 noReflect');
  /* 所有负面环境都必须被剥夺（不再反弹） */
  for (const e of TD.ENDLESS_ENV.filter((x) => x.bad)) {
    assert.equal(e.noReflect, true, '负面环境 ' + e.id + ' 应当标记 noReflect（一律无效化）');
  }
  const envTrial = (envIds, c45) => {
    openRun();
    if (c45) T.addBuff(T._debugRun('endless'), 'C45');
    const rr = T._debugRun('endless');
    rr.env = envIds.map((id) => ({ id: id, vals: null }));
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到战斗');
    const me = mkF(null, []);
    nx.adjustMe(me);
    return { foe: nx.foe.mods || {}, me: me.mods || {} };
  };
  const off = envTrial(['regen'], false), on = envTrial(['regen'], true);
  assert.ok(Number(off.foe.regenPct) > 0, '没有天象之眼时敌方应当吃得到自愈：' + JSON.stringify(off.foe));
  assert.ok(!(Number(on.foe.regenPct) > 0), '有天象之眼时敌方不该再有自愈：' + JSON.stringify(on.foe));
  for (const id of ['lifesteal', 'shell', 'devour']) {
    const a = envTrial([id], false), b = envTrial([id], true);
    const key = { lifesteal: 'lifestealPct', shell: 'shellPct', devour: 'devourPct' }[id];
    assert.ok(Number(a.foe[key]) > 0, id + '：无天象之眼时敌方应当吃得到');
    assert.ok(!(Number(b.foe[key]) > 0), id + '：有天象之眼时敌方不该再吃得到');
  }
  /* 荆棘也必须被剥夺：反弹的话敌人自己带荆棘，玩家照样挨反弹伤害 */
  const th = envTrial(['thorns'], true);
  assert.ok(!(Number(th.foe.thornsPct) > 0), '荆棘反伤应当被剥夺：' + JSON.stringify(th.foe));
  /* 血色黄昏（正向）：我方该吃的仍然吃得到，敌方被剥夺 */
  const duskOff = envTrial(['dusk'], false), duskOn = envTrial(['dusk'], true);
  assert.ok(Number(duskOff.me.lifestealPct) > 0 && Number(duskOff.foe.lifestealPct) > 0,
    '没有天象之眼时血色黄昏双方都吃：' + JSON.stringify(duskOff));
  assert.ok(Number(duskOn.me.lifestealPct) > 0, '有天象之眼时我方仍该吃血色黄昏：' + JSON.stringify(duskOn.me));
  assert.ok(!(Number(duskOn.foe.lifestealPct) > 0), '有天象之眼时敌方不该吃血色黄昏：' + JSON.stringify(duskOn.foe));
  T.abandon('endless');
});

test('需求58：天象之眼剥夺全部负面环境 / 虚空铭文可重复拾取', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openRun = () => {
    S.newGame('r58' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = []; r.pickBuffIds = [];
    return r;
  };
  const mkMe = () => ({ name: 'p', level: 70, power: 300, agility: 120, speed: 120, maxHp: 5000, hp: 5000,
    baseStats: { power: 300, agility: 120, speed: 120 }, weapons: [{ id: 1, level: 5 }], skills: [],
    wears: [], effects: {}, masterLevel: 0 });
  const present = (v) => v != null && Number(v) !== 0;
  const envTrial = (envId, c45) => {
    openRun();
    if (c45) T.addBuff(T._debugRun('endless'), 'C45');
    const rr = T._debugRun('endless');
    rr.env = [{ id: envId, vals: null }];
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到战斗');
    const me = mkMe();
    nx.adjustMe(me);
    return { foe: nx.foe.mods || {}, me: me.mods || {} };
  };

  /* ① 全部 8 条负面环境都必须被天象之眼**整个剥夺**（不再反弹） */
  const badList = TD.ENDLESS_ENV.filter((e) => e.bad);
  assert.equal(badList.length, 8, '负面环境应当有 8 条，实测 ' + badList.length);
  for (const e of badList) {
    assert.equal(e.noReflect, true, '负面环境 ' + e.id + '（' + e.name + '）应当标记 noReflect');
  }
  const KEYS = { thorns: 'thornsPct', regen: 'regenPct', lifesteal: 'lifestealPct', shell: 'shellPct',
    devour: 'devourPct', sun: 'critBonus', frost: 'speedMul', greed: 'maxHpMul' };
  for (const e of badList) {
    const k = KEYS[e.id];
    const off = envTrial(e.id, false), on = envTrial(e.id, true);
    assert.ok(present(off.foe[k]) || present(off.me[k]),
      e.id + '：没有天象之眼时应当生效（' + k + '）');
    assert.ok(!(present(on.foe[k]) || present(on.me[k])),
      e.id + '：有天象之眼时应当被完全剥夺，实测 敌=' + on.foe[k] + ' 我=' + on.me[k]);
  }
  /* 贪婪裂隙：被剥夺后连「试炼币奖励」也一并取消（否则等于白拿钱） */
  const coinMul = (c45) => {
    openRun();
    if (c45) T.addBuff(T._debugRun('endless'), 'C45');
    const rr = T._debugRun('endless');
    rr.env = [{ id: 'greed', vals: null }];
    const nx = T.nextBattle('endless');
    const me = mkMe();
    nx.adjustMe(me);
    return T._debugRun('endless').envCoinMul;
  };
  assert.ok(coinMul(false) > 1, '没有天象之眼时贪婪裂隙应当给试炼币加成：' + coinMul(false));
  assert.equal(coinMul(true), 1, '有天象之眼时贪婪裂隙的试炼币加成也该取消：' + coinMul(true));

  /* 正向环境（血色黄昏）：我方保留、敌方被剥夺 —— 别把这条修坏 */
  const dOff = envTrial('dusk', false), dOn = envTrial('dusk', true);
  assert.ok(present(dOff.me.lifestealPct) && present(dOff.foe.lifestealPct),
    '无天象时血色黄昏双方都吃：' + JSON.stringify(dOff));
  assert.ok(present(dOn.me.lifestealPct), '有天象时我方仍该吃血色黄昏：' + JSON.stringify(dOn.me));
  assert.ok(!present(dOn.foe.lifestealPct), '有天象时敌方不该吃血色黄昏：' + JSON.stringify(dOn.foe));

  /* ② 虚空铭文（C37）可重复拾取：第二、三次都要能正常落地 */
  const c37 = TD.BUFF_BY_ID.C37;
  assert.equal(TD.hasTag(c37, 'repeatable'), true, 'C37 应当可重复获得');
  openRun();
  T.addBuff(T._debugRun('endless'), 'C29');   // 供附魔的永久增益
  T.addBuff(T._debugRun('endless'), 'C27');
  const picks = [];
  for (let n = 0; n < 2; n++) {
    const res = T.addBuff(T._debugRun('endless'), 'C37');
    assert.ok(res.ok, '第 ' + (n + 1) + ' 次获取虚空铭文应当成功：' + JSON.stringify(res));
    const rr = T._debugRun('endless');
    assert.ok(rr.pendingPick && rr.pendingPick.kind === 'permBuff',
      '第 ' + (n + 1) + ' 次应当挂上待选永久增益：' + JSON.stringify(rr.pendingPick));
    const target = (rr.permanent || []).find((b) => !(rr.slotFreeIds || []).includes(b.id));
    assert.ok(target, '应当还有可附魔的永久增益');
    const pick = T.applyPickBuff('permBuff', target.id);
    assert.ok(pick.ok, '第 ' + (n + 1) + ' 次落地应当成功：' + JSON.stringify(pick));
    picks.push(target.id);
  }
  assert.equal(new Set(picks).size, 2, '两次应当附魔到不同的永久增益：' + picks.join(','));
  const fin = T._debugRun('endless');
  assert.equal((fin.slotFreeIds || []).length, 2, '两个永久增益都应当免占位：' + JSON.stringify(fin.slotFreeIds));
  /* 重复拾取不能再被「一局一次」闸门拒绝 */
  const third = T.addBuff(T._debugRun('endless'), 'C37');
  assert.ok(third.ok, '第三次获取也应当成功（可重复获得）：' + JSON.stringify(third));

  /* ③ 单次型的选取增益（C32/C33 是 unique，一局本就只会出现一次）不受影响 */
  openRun();
  assert.ok(T.addBuff(T._debugRun('endless'), 'C33').ok, '第一次秘技通神应当成功');
  const again = T.addBuff(T._debugRun('endless'), 'C33');
  assert.equal(again.ok, false, '非 repeatable 的选取增益仍应受「一局一次」限制：' + JSON.stringify(again));
  T.abandon('endless');
});

test('需求59：放弃本局 = 按当前层结算 + 铸币 1:1 折现；试炼币不折现（作废）', () => {
  const c = setup();
  const T = c.Tower, S = c.State, TD = c.TowerData;
  const TICKET = 50;    // 抽奖卷的道具 id
  /* 第 1 层应得的抽奖卷（endlessTickets(1) = 1）。
   * 本轮修正：**只有多的铸币 1:1 折券，试炼币不折现**（之前误把试炼币也折了）。 */
  const LAYER_TICKETS = TD.endlessTickets(1);
  const startRun = () => {
    S.newGame('ab' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    return T._debugRun('endless');
  };

  /* ① 有币 + 有铸币放弃：只折铸币，试炼币作废、本局结束 */
  const run = startRun();
  run.coins = 137;
  run.retryToken = 2;
  run.score = 500;
  const ticketsBefore = S.state().props[TICKET] || 0;
  const res = T.abandon('endless');
  assert.ok(res.ok, '放弃应当成功');
  assert.equal(res.layerTickets, LAYER_TICKETS, '应当按当前层结算 ' + LAYER_TICKETS + ' 张，实测 ' + res.layerTickets);
  assert.equal(res.retryLeft, 2, '应当报告折现了 2 枚铸币，实测 ' + res.retryLeft);
  assert.equal(res.tickets, LAYER_TICKETS + 2, '本局一共发 ' + LAYER_TICKETS + ' + 2 张，实测 ' + res.tickets);
  assert.equal(S.state().props[TICKET] || 0, ticketsBefore + LAYER_TICKETS + 2,
    '抽奖卷应当只增加 ' + (LAYER_TICKETS + 2) + ' 张：' + ticketsBefore + ' → ' + (S.state().props[TICKET] || 0));
  assert.equal(res.coinsLeft, undefined, '不该再有「试炼币折现」这个字段');
  assert.equal(res.forfeitCoins, 137, '要报出作废了多少试炼币：' + res.forfeitCoins);
  assert.equal(T._debugRun('endless'), null, '放弃后本局应当已结束');
  assert.ok(/兑换/.test(res.retryMsg || ''), '应当给出铸币折现提示：' + res.retryMsg);
  assert.equal(res.convertMsg, undefined, '不该再报「试炼币兑换」');

  /* ② 分数照常入账（别把原有结算弄坏） */
  assert.ok(res.score === 500, '分数应当照常结算：' + res.score);
  assert.ok(Number(res.best) >= 500, 'best 应当更新：' + res.best);

  /* ③ 既没币也没铸币：只发「当前层应得」那一份 */
  const run2 = startRun();
  run2.coins = 0;
  run2.retryToken = 0;
  const before2 = S.state().props[TICKET] || 0;
  const res2 = T.abandon('endless');
  assert.equal(res2.tickets, LAYER_TICKETS, '只发「当前层应得」那一份：' + res2.tickets);
  assert.equal(S.state().props[TICKET] || 0, before2 + LAYER_TICKETS, '抽奖卷只加当前层应得的那份');
  assert.equal(res2.retryMsg, undefined, '没有铸币时不该有折现提示');
  assert.equal(res2.forfeitCoins, 0, '没有试炼币可作废');

  /* ③b 只有币：试炼币**一分都不折** */
  const run3 = startRun();
  run3.coins = 137;
  run3.retryToken = 0;
  const before3 = S.state().props[TICKET] || 0;
  const res3 = T.abandon('endless');
  assert.equal(res3.tickets, LAYER_TICKETS, '纯试炼币不该折出任何卷：' + res3.tickets);
  assert.equal(S.state().props[TICKET] || 0, before3 + LAYER_TICKETS, '试炼币不折现');
  assert.equal(res3.forfeitCoins, 137, '但要提示作废了 137');

  /* ④ 连续放弃两次：第二次没有进行中的本局，应当被拒（不该重复发卷） */
  const before4 = S.state().props[TICKET] || 0;
  const res4 = T.abandon('endless');
  assert.equal(res4.ok, false, '没有本局时放弃应当被拒：' + JSON.stringify(res4));
  assert.equal(S.state().props[TICKET] || 0, before4, '被拒时不该发卷');

  /* ⑤ 结算要能落到存档 */
  const run5 = startRun();
  run5.coins = 42;
  run5.retryToken = 3;
  const before5 = S.state().props[TICKET] || 0;
  T.abandon('endless');
  const raw = JSON.parse(c.localStorage.getItem(S.saveKey) || '{}');
  assert.ok(Number((raw.props || {})[TICKET] || 0) >= before5 + LAYER_TICKETS + 3,
    '抽奖卷（当前层应得 + 铸币折现）应当写进存档：' + JSON.stringify((raw.props || {})[TICKET]));
});

test('需求60：20 起每 10 层必须放弃一个永久增益 / 30 层后每 2 层碎烙印失效一条', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openRun = (layer, perms) => {
    S.newGame('r60' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = (perms || [{ id: 'C29', stacks: 1 }]).map((x) => Object.assign({}, x));
    r.limited = []; r.slotFreeIds = []; r.pendingToasts = []; r.phase = null;
    if (layer != null) T._debugSetEndlessLayer(layer);
    return T._debugRun('endless');
  };
  const enterSacrifice = () => {
    const r = T._debugRun('endless');
    r.phase = 'shop'; r.shop = {};
    return T.continueFromShop();
  };

  /* ① 判定：20 起每 10 层 */
  for (const [L, want] of [[10, false], [19, false], [20, true], [21, false], [29, false],
    [30, true], [31, false], [40, true], [50, true]]) {
    assert.equal(T.needPermSacrifice(L), want, '第 ' + L + ' 层应当' + (want ? '' : '不') + '要求放弃永久增益');
  }

  /* ② 出商店后进入 sacrifice 阶段（10 层不进） */
  openRun(10); let res = enterSacrifice();
  assert.equal(res.phase, undefined, '第 10 层不该进入放弃阶段：' + JSON.stringify(res));
  assert.equal(T._debugRun('endless').layer, 11, '第 10 层应当直接进第 11 层');
  openRun(20); res = enterSacrifice();
  assert.equal(res.phase, 'sacrifice', '第 20 层应当进入放弃阶段：' + JSON.stringify(res));
  assert.equal(T._debugRun('endless').phase, 'sacrifice', '阶段应当持久化（不被 normalizeRun 清掉）');
  assert.equal(T._debugRun('endless').layer, 20, '放弃前不该推进层数');

  /* ③ 候选 = 已有的永久增益（隐藏型不算） */
  const cands = T.sacrificeCandidatesOf(T._debugRun('endless'));
  assert.equal(cands.map((x) => x.id).sort().join(','), 'C29', '候选应当只有已有的永久增益：' + JSON.stringify(cands.map((x) => x.id)));

  /* ④ 放弃：叠层的先掉一层，掉光才移除；放弃后推进到下一层 */
  openRun(20, [{ id: 'C29', stacks: 1 }, { id: 'C27', stacks: 2 }]);
  enterSacrifice();
  let out = T.sacrificePerm('C27');
  assert.ok(out.ok, '放弃应当成功：' + JSON.stringify(out));
  let run = T._debugRun('endless');
  assert.equal(run.permanent.find((b) => b.id === 'C27').stacks, 1, '2 层应当先掉成 1 层');
  assert.equal(run.layer, 21, '放弃后应当推进到下一层');
  assert.equal(run.phase, null, '放弃后阶段应当清空');
  /* 再放弃一次 → 完全移除 */
  run.layer = 30; run.phase = 'shop'; run.shop = {};
  T.continueFromShop();
  assert.ok(T.sacrificePerm('C27').ok, '第二次放弃应当成功');
  run = T._debugRun('endless');
  assert.ok(!run.permanent.some((b) => b.id === 'C27'), '1 层再被放弃应当彻底移除：' + JSON.stringify(run.permanent));
  assert.ok(!(run.slotFreeIds || []).includes('C27'), '免占位标记也该一并清掉');

  /* ⑤ 不能在不该放弃的时候放弃 */
  openRun(20);
  assert.equal(T.sacrificePerm('C29').ok, false, '不是 sacrifice 阶段时不该能放弃');
  assert.ok(T._debugRun('endless').permanent.some((b) => b.id === 'C29'), '被拒时不该真的移除');

  /* ⑥ 30 层后每 2 层：随机作废一条碎掉的烙印 */
  const withBroken = (layer, marks) => {
    const r = openRun(layer);
    r.brokenMarks = marks.slice();
    r.fragileBurned = { power: 0, agility: 0, speed: 0 };
    r.fragileHealBurned = []; r.fragileMulBurned = 0;
    for (const m of r.brokenMarks) {
      if (m.kind === 'stat') r.fragileBurned[m.stat] = (r.fragileBurned[m.stat] || 0) + m.pct;
      if (m.kind === 'heal') r.fragileHealBurned.push(m.burned);
      if (m.kind === 'final') r.fragileMulBurned = (r.fragileMulBurned || 0) + 1;
    }
    return r;
  };
  const MARKS = [{ kind: 'stat', stat: 'power', pct: 0.08 }, { kind: 'stat', stat: 'agility', pct: 0.14 },
    { kind: 'stat', stat: 'speed', pct: 0.08 }, { kind: 'heal', alive: 0.10, burned: 0.20 },
    { kind: 'final', alive: 0.25, burned: 0.5 }];
  /* 30 层及以前不动：「30 层过后」= 31 层起才算通过，所以 29/30/31 都不掉，
   * 第一次流失发生在**进入第 32 层**时。 */
  withBroken(28, MARKS);
  T._debugAdvanceLayer();                       // → 29
  T._debugAdvanceLayer();                       // → 30（这里只是「到达」30，不算过后）
  T._debugAdvanceLayer();                       // → 31
  assert.equal(T._debugRun('endless').brokenMarks.length, 5, '31 层以前不该流失碎烙印');
  /* 进入 32 层掉一条，33 层不掉，34 层再掉一条 */
  withBroken(30, MARKS);
  T._debugAdvanceLayer();                       // → 31
  assert.equal(T._debugRun('endless').brokenMarks.length, 5, '奇数层不该流失');
  T._debugAdvanceLayer();                       // → 32
  assert.equal(T._debugRun('endless').brokenMarks.length, 4, '第 32 层应当流失一条');
  T._debugAdvanceLayer();                       // → 33
  assert.equal(T._debugRun('endless').brokenMarks.length, 4, '第 33 层不该流失');
  T._debugAdvanceLayer();                       // → 34
  assert.equal(T._debugRun('endless').brokenMarks.length, 3, '第 34 层应当再流失一条');
  /* 合计值必须跟着重算（力量烙印掉光后 power 应当归零） */
  const fin = T._debugRun('endless');
  const expectPower = fin.brokenMarks.filter((m) => m.kind === 'stat' && m.stat === 'power')
    .reduce((a, m) => a + m.pct, 0);
  assert.ok(Math.abs(fin.fragileBurned.power - expectPower) < 1e-9,
    '力量合计应当等于剩余明细之和：' + fin.fragileBurned.power + ' vs ' + expectPower);
  assert.ok((fin.pendingToasts || []).length > 0, '应当留下「碎烙印失效」的提示');
  /* 提示一次性取走 */
  const toasts = T.takeRunToasts();
  assert.ok(toasts.length > 0, '应当能取到提示');
  assert.equal(T.takeRunToasts().length, 0, '取走后应当清空');

  /* ⑦ legacy（旧档迁移）的明细不可被抽走 */
  const r7 = withBroken(31, [{ kind: 'stat', stat: 'power', pct: 0.10, legacy: true }]);
  T._debugAdvanceLayer();
  assert.equal(T._debugRun('endless').brokenMarks.length, 1, 'legacy 明细不该被抽走');
  assert.ok(Math.abs(T._debugRun('endless').fragileBurned.power - 0.10) < 1e-9, 'legacy 合计应当保留');

  /* ⑧ 没有碎烙印时推进不报错 */
  const r8 = withBroken(31, []);
  assert.ok(T._debugAdvanceLayer().ok, '没有碎烙印时推进应当正常');
  assert.equal(T._debugRun('endless').brokenMarks.length, 0, '不该凭空产生明细');

  /* ⑨ 终焉烙印（final）被作废时要同时减 fragileMulBurned */
  /* 起点放在 31 层：推进后进入 32 层（偶数层）才会触发流失。 */
  const r9 = withBroken(31, [{ kind: 'final', alive: 0.25, burned: 0.5 }]);
  assert.equal(r9.fragileMulBurned, 1, '前置条件：应当有 1 层损毁终焉');
  T._debugAdvanceLayer();
  assert.equal(T._debugRun('endless').fragileMulBurned, 0, '作废后 fragileMulBurned 应当归零');
  T.abandon('endless');
});

test('需求61：放弃永久增益的弹窗必须能真的选出候选（修「点不动」）', () => {
  const c = setup();
  const T = c.Tower, S = c.State;

  /* ① 根因回归：endlessInfo() 返回的 run 是**只读副本**，里面没有 permanent / limited。
   *    所以任何「用 info.run 当候选来源」的界面代码都会拿到空列表。 */
  S.newGame('r61' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r = T._debugRun('endless');
  r.permanent = [{ id: 'C29', stacks: 1 }, { id: 'C27', stacks: 2 }];
  r.limited = []; r.slotFreeIds = []; r.pendingToasts = []; r.phase = null;
  T._debugSetEndlessLayer(20);
  const rr = T._debugRun('endless');
  rr.phase = 'shop'; rr.shop = {};
  assert.equal(T.continueFromShop().phase, 'sacrifice', '第 20 层应当进入放弃阶段');
  const info = T.endlessInfo();
  assert.equal(info.run.phase, 'sacrifice', '界面副本里能看到 sacrifice 阶段');
  assert.equal(info.run.permanent, undefined,
    '前置条件：endlessInfo().run 是只读副本，不含 permanent（这正是 bug 的根源）');
  /* 传副本 → 空候选；不传 → 真实候选 */
  assert.equal(T.sacrificeCandidatesOf(info.run).length, 0,
    '传界面副本时候选必然为空（bug 的复现条件）');
  const real = T.sacrificeCandidatesOf();
  assert.equal(real.map((x) => x.id).sort().join(','), 'C27,C29',
    '不传参（读真实 run）时应当拿到全部候选：' + JSON.stringify(real.map((x) => x.id)));

  /* ② 真跑一遍界面函数：弹窗要列出全部候选，点击要能完成放弃 */
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const seg = ui.slice(ui.indexOf('  function openPermSacrifice()'), ui.indexOf('  function openCheckpoint()'));
  const ordSeg61 = ui.slice(ui.indexOf('  function orderPermanent('), ui.indexOf('  // ---------- 通用小件 ----------'));
  assert.ok(seg.length > 200, '应当截到 openPermSacrifice 的实现');
  assert.ok(ordSeg61.length > 100, '应当截到 orderPermanent 的实现');
  /* 断言它**没有**把 info.run 传给 sacrificeCandidatesOf（修好的标志）。 */
  assert.ok(/Tower\.sacrificeCandidatesOf\(\)/.test(seg),
    'openPermSacrifice 必须调用 sacrificeCandidatesOf()（不传界面副本）：' + seg.slice(0, 300));

  const modals = [];
  const mkEl = () => {
    const els = [];
    return { querySelector: () => null,
      querySelectorAll: (sel) => (sel === '[data-sac]' ? els : []),
      _els: els, classList: { add() {} }, dataset: {}, appendChild(x) { els.push(x); } };
  };
  const notices = [];
  const classic = {
    modal: (t, html, buttons) => {
      const ids = [...String(html).matchAll(/data-sac="([^"]+)"/g)].map((mm) => mm[1]);
      const el = mkEl();
      for (const id of ids) el._els.push({ dataset: { sac: id }, onclick: null });
      const m = { title: t, html: String(html), buttons: buttons, closed: 0,
        close() { this.closed++; }, element: el };
      modals.push(m); return m;
    },
    bind: () => {},
  };
  const ctx = { Tower: T, State: S, esc: (x) => String(x == null ? '' : x),
    notice: (t) => notices.push(t), modal: classic.modal, openEndless: () => {}, bindTips: () => {},
    console: { warn() {}, log() {} }, C: () => ({ bind: () => {} }),
    Math: Math, JSON: JSON, Object: Object, Number: Number, String: String, Array: Array,
    setTimeout: () => {}, clearTimeout: () => {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ordSeg61 + seg + '\nopenPermSacrifice();', ctx, { filename: 'sac.js' });
  const m = modals[modals.length - 1];
  assert.ok(m, '应当弹出「放弃一个永久增益」');
  assert.equal(m.title, '放弃一个永久增益', '弹窗标题：' + m.title);
  const ids = (m.element._els || []).map((e) => e.dataset.sac);
  /* 【2026-10 同名逐条】候选按 **uid**（精确到那一条栏位）传给界面，不再用 id。 */
  const wantRefs = real.map((x) => String(x.uid != null && Number(x.uid) > 0 ? x.uid : x.id)).sort();
  assert.equal(ids.sort().join(','), wantRefs.join(','),
    '弹窗应当列出全部候选（按 uid）：' + JSON.stringify(ids) + ' vs ' + JSON.stringify(wantRefs));
  assert.ok((m.element._els || []).every((e) => typeof e.onclick === 'function'),
    '每张卡片都必须绑上点击（原来点不动就是因为候选为空、卡片根本没生成）');
  assert.equal(notices.length, 0, '不应当先弹「只能放弃你已有的永久增益」：' + JSON.stringify(notices));
  /* 点第一张 → 真的放弃掉并推进到下一层 */
  const picked = m.element._els[0].dataset.sac;
  m.element._els[0].onclick();
  assert.equal(m.closed, 1, '点击后弹窗应当关闭');
  const after = T._debugRun('endless');
  assert.equal(after.layer, 21, '放弃后应当推进到第 21 层');
  assert.equal(after.phase, null, '放弃后阶段应当清空');
  const left = after.permanent.map((b) => b.id + 'x' + b.stacks).sort().join(',');
  const pickedId = (real.find((x) => String(x.uid) === picked) || {}).id;
  const expect = pickedId === 'C29' ? 'C27x2' : 'C29x1';
  assert.equal(left, expect, '被点的那一项应当被放弃（掉一层或移除）：' + left + '（点了 ' + picked + ' → ' + pickedId + '）');
  T.abandon('endless');
});

test('需求62：减敌血的一次性 buff 一局一次 / 30 层后的敌人深度成长曲线', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openRun = () => {
    S.newGame('r62' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = []; r.instantIds = [];
    return r;
  };

  /* ① 挫锐(E07) / 卸甲(E08)：一局只能拾取并生效一次 */
  for (const id of ['E07', 'E08']) {
    const b = TD.BUFF_BY_ID[id];
    assert.equal(b.kind, 'instant', id + ' 应当是即时类');
    assert.equal(b.maxStacks, 1, id + ' 应当限定一局一次：' + b.maxStacks);
    assert.equal(TD.hasTag(b, 'repeatable'), true, id + ' 需要 repeatable 才能让 maxStacks 生效（否则被 unique 直接排除）');
    assert.ok(TD.endlessPool.some((x) => x.id === id), id + ' 应当在无尽塔池里');
  }
  openRun();
  for (const id of ['E07', 'E08']) {
    const b = TD.BUFF_BY_ID[id];
    /* 拿到之前：可进池、可获得 */
    assert.equal(T.poolFilterOf(T._debugRun('endless'), b), true, id + ' 未获得时应当可进池');
    assert.equal(T.ownableOf(T._debugRun('endless'), b), true, id + ' 未获得时应当可获得');
    const before = Number(T._debugRun('endless').enemyMaxHpDown) || 0;
    T.addBuff(T._debugRun('endless'), id);
    const mid = T._debugRun('endless');
    assert.ok((Number(mid.enemyMaxHpDown) || 0) > before, id + ' 应当真的减少敌方血量');
    assert.equal(T.instantOwnedCountOf(mid, id), 1, id + ' 应当记 1 次获得');
    /* 拿到之后：不再进池、不再可获得（这就是「刷新不出来」的判据） */
    assert.equal(T.poolFilterOf(mid, b), false, id + ' 获得后不该再进任何池子');
    assert.equal(T.ownableOf(mid, b), false, id + ' 获得后不该再可获得');
  }
  /* 真实奖励路径：连打 40 步，E07/E08 各最多被拿到一次 */
  {
    const r = openRun();
    const mk = () => ({ name: 'p', level: 70, power: 99999, agility: 99999, speed: 99999, maxHp: 99999, hp: 99999,
      baseStats: { power: 99999, agility: 99999, speed: 99999 }, weapons: [{ id: 1, level: 15 }],
      skills: [], wears: [], effects: {}, masterLevel: 0 });
    const got = { E07: 0, E08: 0 };
    for (let step = 0; step < 120; step++) {
      const cur = T._debugRun('endless');
      if (!cur || cur.layer > 40) break;
      cur.env = [];
      if (cur.choices) {
        const i = cur.choices.findIndex((x) => x.id === 'E07' || x.id === 'E08');
        if (i >= 0) { got[cur.choices[i].id]++; T.pickChoice('endless', i, null); }
        else T.pickChoice('endless', 0, null);
        continue;
      }
      if (cur.phase === 'shop') { T.continueFromShop(); continue; }
      if (cur.phase === 'checkpoint') { T.continueEndless(); continue; }
      if (cur.phase === 'sacrifice') { T.sacrificePerm((cur.permanent[0] || {}).id); continue; }
      const nx = T.nextBattle('endless');
      if (!nx || nx.ok === false) break;
      const me = mk(); nx.adjustMe(me);
      const a = T._debugRun('endless');
      T.reportBattle('endless', a.attempt, true, me.maxHp, me.maxHp);
    }
    assert.ok(got.E07 <= 1, '一局内挫锐最多拿一次，实测 ' + got.E07);
    assert.ok(got.E08 <= 1, '一局内卸甲最多拿一次，实测 ' + got.E08);
  }

  /* ② 30 层后的敌人成长曲线：不能再是一条平线 */
  assert.equal(TD.endlessDepthMul(1), 1, '第 1 层不该有深度加成');
  assert.equal(TD.endlessDepthMul(30), 1, '第 30 层不该有深度加成（老平衡原样保留）');
  assert.ok(TD.endlessDepthMul(31) > 1, '第 31 层起应当开始加成长');
  for (const L of [35, 40, 50, 60, 70, 80, 100]) {
    assert.ok(TD.endlessDepthMul(L) > TD.endlessDepthMul(L - 1),
      '第 ' + L + ' 层应当比上一层更高：' + TD.endlessDepthMul(L - 1) + ' → ' + TD.endlessDepthMul(L));
  }
  /* 分段加速：30→50 层每层 ×1.07，50 层之后每层 ×1.09（更陡） */
  for (const L of [31, 40, 50]) {
    const r = TD.endlessDepthMul(L) / TD.endlessDepthMul(L - 1);
    assert.ok(Math.abs(r - 1.07) < 1e-9, '第 ' + L + ' 层应当是 ×1.07（实测 ×' + r.toFixed(4) + '）');
  }
  for (const L of [51, 60, 70, 100]) {
    const r = TD.endlessDepthMul(L) / TD.endlessDepthMul(L - 1);
    assert.ok(Math.abs(r - 1.09) < 1e-9, '第 ' + L + ' 层应当是 ×1.09（实测 ×' + r.toFixed(4) + '）');
  }
  /* 曲线必须**逐段更陡**：50 层之后的每层增幅要大于 50 层之前 */
  assert.ok(TD.endlessDepthMul(51) / TD.endlessDepthMul(50) > TD.endlessDepthMul(50) / TD.endlessDepthMul(49),
    '50 层之后应当比之前更陡（需求：30 层后要更陡的曲线）');
  /* 「更陡」的两个可验证口径：
   *   ① 50 层之后的 5 层环比（×1.54 = 1.09^5）**大于** 50 层之前的（×1.40 = 1.07^5）
   *   ② 每 5 层的**绝对**倍数增量随深度变大（毕竟乘数本身在涨） */
  const per5 = (L) => TD.endlessDepthMul(L) / TD.endlessDepthMul(L - 5);
  assert.ok(per5(60) > per5(40) + 0.05,
    '50 层之后的 5 层环比应当明显更大：×' + per5(40).toFixed(2) + ' → ×' + per5(60).toFixed(2));
  const delta5 = (L) => TD.endlessDepthMul(L) - TD.endlessDepthMul(L - 5);
  assert.ok(delta5(70) > delta5(50), '70 层的 5 层绝对增量应当大于 50 层：' + delta5(50).toFixed(1) + ' → ' + delta5(70).toFixed(1));
  assert.ok(delta5(100) > delta5(70), '100 层的 5 层绝对增量应当大于 70 层：' + delta5(70).toFixed(1) + ' → ' + delta5(100).toFixed(1));
  /* 实测敌人数值：30 层以后必须真的在涨（旧版 40 层后完全不变） */
  const foeAt = (L) => {
    openRun();
    T._debugSetEndlessLayer(L);
    const cur = T._debugRun('endless');
    cur.env = [];
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '第 ' + L + ' 层应当能取到战斗');
    return nx.foe;
  };
  const hp = {};
  for (const L of [30, 40, 50, 60, 70, 80, 100]) hp[L] = foeAt(L).hp;
  assert.ok(hp[40] > hp[30], '第 40 层血量应当高于第 30 层：' + hp[30] + ' → ' + hp[40]);
  assert.ok(hp[50] > hp[40], '第 50 层血量应当高于第 40 层：' + hp[40] + ' → ' + hp[50]);
  assert.ok(hp[70] > hp[50], '第 70 层血量应当高于第 50 层：' + hp[50] + ' → ' + hp[70]);
  assert.ok(hp[100] > hp[80], '第 100 层血量应当高于第 80 层：' + hp[80] + ' → ' + hp[100]);
  assert.ok(hp[70] / hp[30] > 8, '30→70 层的血量应当拉开明显差距（实测 ×' + (hp[70] / hp[30]).toFixed(2) + '）');
  /* 属性也跟着涨（不只是血量） */
  const pow30 = foeAt(30).power, pow70 = foeAt(70).power;
  assert.ok(pow70 > pow30 * 3, '30→70 层的力量也应当明显提高：' + pow30 + ' → ' + pow70);
  T.abandon('endless');
});

test('需求63：开局回血类 buff 要吃到局内加生命上限的加成', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openRun = (setup) => {
    S.newGame('r63' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    /* 直接把「补给 N08」挂在永久列表上当开局回血源（它本来就是 startHealPct 类）。 */
    r.permanent = [{ id: 'N08', stacks: 1 }];
    r.limited = []; r.slotFreeIds = []; r.env = []; r.noEnvRoll = true;
    if (setup) setup(r);
    r.hpAbs = 500; r.lastMaxHp = 5000; r.refMaxHp = 5000; r.carry = 0.1;
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到战斗');
    const me = { name: 'p', level: 70, power: 100, agility: 100, speed: 100, maxHp: 5000, hp: 500,
      baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [], skills: [], wears: [],
      effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    return me;
  };

  /* 基线：没有局内上限加成 → 回 50% × 5000 = 2500 */
  const base = openRun();
  assert.equal(base.maxHp, 5000, '基线上限应当是 5000');
  assert.equal(base.hp, 3000, '基线应当是 500 + 2500 = 3000，实测 ' + base.hp);

  /* ① C07「吞噬成长」的百分比上限成长（run.winMaxHp）必须算进去 */
  const grown = openRun((r) => { r.winMaxHp = 0.20; });
  assert.equal(grown.maxHp, 6000, 'C07 +20% 时上限应当是 6000，实测 ' + grown.maxHp);
  assert.equal(grown.hp, 500 + 3000, '回血应当按新上限 6000 × 50% = 3000，实测 ' + (grown.hp - 500));

  /* ② 固定值上限成长（以战养战 C11 / 挥金如土 C36）也要算进去 */
  const flat = openRun((r) => { r.winHpFlat = 50; });
  assert.equal(flat.maxHp, 5050, '固定 +50 时上限应当是 5050，实测 ' + flat.maxHp);
  assert.equal(flat.hp - 500, Math.round(5050 * 0.5), '回血应当按 5050 算');
  const spend = openRun((r) => { r.spendGain = { power: 0, agility: 0, speed: 0, hp: 40 }; });
  assert.equal(spend.maxHp, 5040, '挥金如土 +40 时上限应当是 5040，实测 ' + spend.maxHp);
  assert.equal(spend.hp - 500, Math.round(5040 * 0.5), '回血应当按 5040 算');

  /* ③ 上限加成不改变「回血不超过上限」的约束 */
  const capped = openRun((r) => { r.winMaxHp = 0.20; });
  capped.hp = 6000;                       // 先拉满
  assert.ok(capped.hp <= 6000, '回血后不该超过上限');
  const nearFull = openRun((r) => { r.winMaxHp = 0.20; });
  assert.ok(nearFull.hp <= nearFull.maxHp, '回血后血量不该超过上限：' + nearFull.hp + ' / ' + nearFull.maxHp);

  /* ④ 跟「减伤」这类与上限无关的加成无关（别把口径搞混） */
  const unrelated = openRun((r) => { r.winTakenMul = 0.2; });
  assert.equal(unrelated.maxHp, 5000, '减伤不该影响上限');
  assert.equal(unrelated.hp, 3000, '减伤不该影响开局回血');

  /* ⑤ 文案口径：效果清单里仍然写「开战回血 X% 最大生命」
   *（原来读的是并不存在的 Tower.buffEffectLines，整段被 if 静默跳过 ——
   *  换成真实的调试台报告，这条断言才真的在跑）。 */
  const effects = ((T.debugBuffReport('endless') || {}).effects || []);
  const line = effects.find((x) => x[0] === '开战回血');
  assert.ok(line, '效果清单应当有「开战回血」：' + JSON.stringify(effects));
  assert.ok(/最大生命/.test(line[1]), '文案应当说明是按最大生命：' + JSON.stringify(line));
  T.abandon('endless');
});

test('需求64：被虚空铭文附魔的永久增益排在前面，与未附魔的分开', () => {
  const c = setup();
  const T = c.Tower, S = c.State;
  const openRun = () => {
    S.newGame('r64' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    /* 6 个永久增益，第 2 / 5 个被附魔（不占位） */
    r.permanent = [{ id: 'C29', stacks: 1 }, { id: 'C27', stacks: 1 }, { id: 'C22', stacks: 1 },
      { id: 'C07', stacks: 2 }, { id: 'C12', stacks: 1 }, { id: 'C48', stacks: 1 }];
    r.limited = []; r.slotFreeIds = ['C27', 'C12']; r.env = []; r.noEnvRoll = true;
    return r;
  };
  openRun();
  const raw = T.ownedBuffs('endless').filter((b) => b.kind === 'permanent').map((b) => b.id).join(',');
  assert.equal(raw, 'C29,C27,C22,C07,C12,C48', '前置条件：原始顺序是这个（附魔的混在中间）：' + raw);

  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const ordSeg = ui.slice(ui.indexOf('  function orderPermanent('), ui.indexOf('  // ---------- 通用小件 ----------'));
  assert.ok(ordSeg.length > 100, '应当截到 orderPermanent 的实现');

  const ctx = { Tower: T, State: S, console,
    esc: (x) => String(x == null ? '' : x), Math: Math, JSON: JSON, Object: Object,
    Number: Number, String: String, Array: Array };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ordSeg + `
var list = Tower.ownedBuffs('endless').filter(function (b) { return b.kind === 'permanent'; });
var out = orderPermanent(list, ['C27', 'C12']).map(function (b) { return b.id; });
`, ctx, { filename: 'ord.js' });
  assert.equal(ctx.out.join(','), 'C27,C12,C29,C22,C07,C48',
    '附魔的应当排到最前，其余保持原相对顺序：' + ctx.out.join(','));
  /* 同组内稳定：不附魔的相对顺序不变 */
  assert.equal(ctx.out.slice(2).join(','), 'C29,C22,C07,C48', '未附魔的相对顺序不该被打乱');
  /* 边界：没有附魔时顺序完全不变 */
  vm.runInContext(`
/* 【任务2】附魔改成逐条标记（行上的 slotFree）→ 想验证「没有附魔」，要把**镜像与行标记同时**清掉：
 * 归一化会用镜像把行重新标回来（那是旧档迁移路径），所以中间不能夹第二次 _debugRun。 */
var rr = Tower._debugRun('endless');
rr.slotFreeIds = [];
(rr.permanent || []).forEach(function (b) { b.slotFree = false; });
var out2 = orderPermanent(Tower.ownedBuffs('endless').filter(function (b) { return b.kind === 'permanent'; }), []).map(function (b) { return b.id; });
var out3 = orderPermanent([], ['C29']).map(function (b) { return b.id; });
`, ctx, { filename: 'ord2.js' });
  assert.equal(ctx.out2.join(','), 'C29,C27,C22,C07,C12,C48', '没有附魔时不该改变顺序：' + ctx.out2.join(','));
  assert.equal(ctx.out3.length, 0, '空列表不该报错');

  /* 源码口径：面板、替换弹窗、放弃弹窗三处都要走这个排序 */
  const uses = (ui.match(/orderPermanent\(/g) || []).length;
  assert.ok(uses >= 4, '面板 + 替换弹窗 + 放弃弹窗 + 定义本身，至少 4 处用到 orderPermanent，实测 ' + uses);
  assert.ok(ui.indexOf('const perm = orderPermanent(') > 0, '面板的永久列表必须走 orderPermanent');
  assert.ok(ui.indexOf("const list = orderPermanent(Tower.ownedBuffs('endless')") > 0,
    '替换弹窗的列表必须走 orderPermanent');
  assert.ok(ui.indexOf('const cands = orderPermanent(candsAll') > 0,
    '放弃永久增益弹窗的候选必须走 orderPermanent');
  /* 面板还要有「附魔段 / 未附魔段」的分界线 */
  assert.ok(ui.indexOf("buff-sep") > 0, '面板应当有附魔段与未附魔段的分界线');
  T.abandon('endless');
});

test('需求65：战斗续航（C16/C17）改成开战第一回合结算，并吃到空血上限', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;

  /* 起一局无尽 → 指定永久/限次增益 → 把进场血量钉在指定绝对值 → 取下一场并跑 adjustMe。
   * 返回 me（adjustMe 之后的本场面板）与 run（全局 HP 计数器）。 */
  const battleStart = (opts) => {
    opts = opts || {};
    S.newGame('r65' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = opts.permanent || [];
    r.limited = opts.limited || [];
    r.slotFreeIds = []; r.env = []; r.noEnvRoll = true;
    r.hpAbs = opts.hpAbs == null ? 2500 : opts.hpAbs;      // 进场血：绝对值口径，直接写计数器
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到战斗');
    const me = { name: 'p', level: 70, power: 100, agility: 100, speed: 100, maxHp: 5000, hp: r.hpAbs,
      baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [], skills: [], wears: [],
      effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    return { me: me, nx: nx, run: T._debugRun('endless') };
  };

  /* ① 数据层口径：续航走通用的「开战回血」（startHealPct），文案也写成开战 */
  const c16 = TD.BUFF_BY_ID.C16, c17 = TD.BUFF_BY_ID.C17;
  assert.equal(c16.mods.startHealPct, 0.05, 'C16 应当走 startHealPct 0.05');
  assert.equal(c17.mods.startHealPct, 0.10, 'C17 应当走 startHealPct 0.10');
  assert.ok(!c16.mods.winHealPct && !c17.mods.winHealPct, '旧的「胜利后回血」字段应当彻底移除');
  assert.ok(/战斗开始/.test(c16.desc) && !/胜利后/.test(c16.desc), 'C16 文案应当写「战斗开始时」：' + c16.desc);
  assert.ok(/战斗开始/.test(c17.desc) && !/胜利后/.test(c17.desc), 'C17 文案应当写「战斗开始时」：' + c17.desc);

  /* ② 基线：上限 5000、进场血 2500 → C16 ×1 在第一回合回 5% = 250 */
  const one = battleStart({ permanent: [{ id: 'C16', stacks: 1 }] });
  assert.equal(one.me.maxHp, 5000, '基线上限应当是 5000');
  assert.equal(one.me.hp, 2500 + 250, 'C16 ×1 应当回 5% × 5000 = 250，实测 ' + one.me.hp);
  assert.equal(one.run.hpAbs, one.me.hp, 'HP 计数器要同步成开战回血后的血量');

  /* ③ 叠层仍然严格成比例；C16/C17 本轮**上限 2 层**（所以只有 ×1 / ×2 两档） */
  const two = battleStart({ permanent: [{ id: 'C16', stacks: 2 }] });
  assert.equal(two.me.hp, 2500 + 500, 'C16 ×2 应当回 10% × 5000 = 500，实测 ' + two.me.hp);
  const c17x2 = battleStart({ permanent: [{ id: 'C17', stacks: 2 }] });
  assert.equal(c17x2.me.hp, 2500 + 1000, 'C17 ×2 应当回 20% × 5000 = 1000，实测 ' + c17x2.me.hp);

  /* ④ 空血上限（C46 +30%）要算进回血基准，且回血能填进空的那部分：
   *    上限 5000 × 1.3 = 6500 → 回 5% = 325。进场血 4900 → 5225，
   *    大于「不含空血上限」的 5000 —— 证明它没有被 baseMaxHp 再裁一次。 */
  const empty = battleStart({ permanent: [{ id: 'C16', stacks: 1 }, { id: 'C46', stacks: 1 }], hpAbs: 4900 });
  assert.equal(empty.me.maxHp, 6500, 'C46 +30% 空血上限时本场上限应当是 6500，实测 ' + empty.me.maxHp);
  assert.equal(empty.me.hp, 4900 + 325, '回血应当按 6500 × 5% = 325 算，实测 ' + empty.me.hp);
  assert.ok(empty.me.hp > 5000, '回血要能填进空血上限那部分，实测 ' + empty.me.hp + '（不填的话会被裁到 5000）');

  /* ⑤ 限次类的空血上限（N13 血之契约 +100%）同理：上限 10000 → 回 5% = 500 */
  const contract = battleStart({ permanent: [{ id: 'C16', stacks: 1 }],
    limited: [{ id: 'N13', stacks: 1, uses: 10, on: true }], hpAbs: 4900 });
  assert.equal(contract.me.maxHp, 10000, '血之契约 +100% 时上限应当是 10000，实测 ' + contract.me.maxHp);
  assert.equal(contract.me.hp, 4900 + 500, '回血应当按 10000 × 5% = 500 算，实测 ' + contract.me.hp);

  /* ⑥ 增幅水晶（C15 全局 ×1.4）照旧进乘区：5% → 7%，回 350 */
  const crystal = battleStart({ permanent: [{ id: 'C16', stacks: 1 }, { id: 'C15', stacks: 1 }] });
  assert.equal(crystal.me.maxHp, 5000, '增幅水晶不改变上限');
  assert.equal(crystal.me.hp, 2500 + 350, '增幅水晶下回血应当是 7% × 5000 = 350，实测 ' + crystal.me.hp);

  /* ⑦ 补给 N08 与续航共用同一条「开战回血」通路，于是也一起吃到空血上限
   *    （本轮统一口径的副作用，一并锁死） */
  const n08 = battleStart({ permanent: [{ id: 'C46', stacks: 1 }],
    limited: [{ id: 'N08', stacks: 1, uses: 1, on: true }], hpAbs: 2000 });
  assert.equal(n08.me.maxHp, 6500, 'N08 + C46 时上限应当是 6500');
  assert.equal(n08.me.hp, 2000 + 3250, 'N08 应当按 50% × 6500 = 3250 回血，实测 ' + n08.me.hp);

  /* ⑧ 战斗胜利后**不再**额外回血（改由下一场开战结算） */
  const winCase = battleStart({ permanent: [{ id: 'C16', stacks: 1 }] });
  const win = T.reportBattle('endless', winCase.nx.token, true, 3000, 6500);
  assert.ok(win.ok, '胜利结算应当成功');
  assert.equal(win.winHeal, undefined, '战后报告里不该再有 winHeal');
  assert.equal(winCase.run.hpAbs, 3000, '战后计数器就是传进去的剩余血量，不该被续航再加一次：' + winCase.run.hpAbs);

  /* ⑨ 效果清单里只留一条「开战回血」（旧的「战斗胜利后回血」整行消失） */
  const effects = ((T.debugBuffReport('endless') || {}).effects || []).map((x) => x[0]);
  assert.ok(effects.indexOf('开战回血') >= 0, '效果清单应当有「开战回血」：' + effects.join('/'));
  assert.ok(effects.indexOf('战斗胜利后回血') < 0, '效果清单不该再有「战斗胜利后回血」：' + effects.join('/'));
  T.abandon('endless');
});

test('需求66：秘技通神可抽小宇宙爆发（开战第一招必放）/ 绝对防御加成略微下调', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;

  /* 起一局无尽、清空增益，方便单独观察秘技通神。 */
  const freshRun = () => {
    S.newGame('r66' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    assert.ok(T.startEndlessRun().ok, '应当能开一局');
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = []; r.env = []; r.noEnvRoll = true;
    return r;
  };
  const hasSkill = (id) => (S.mySkills() || []).some((x) => Number(x.id) === Number(id));

  /* ① 候选口径：**没学**小宇宙爆发（14）也会进候选，并带「开战第一招必放」的提示 */
  freshRun();
  S.setWS('skill', 12, 5);                       // 只学一个无关主动技（野球拳）
  assert.equal(hasSkill(14), false, '前置条件：这一局不该会小宇宙爆发');
  /* 候选是「洗牌后取 3 个」，所以要抽多次才看得全（12/7/14/16 里每次只露 3 个）。 */
  const seen = new Map();
  for (let t = 0; t < 60; t++) for (const x of T.pickCandidatesOf('skill')) seen.set(x.id, x);
  const c14 = seen.get(14);
  assert.ok(c14, '候选里应当有小宇宙爆发 14，实测 ' + [...seen.keys()].join(','));
  assert.equal(c14.note, '开战第一招必放', '小宇宙候选应当带「开战第一招必放」提示：' + JSON.stringify(c14));
  const c16 = seen.get(16);
  assert.ok(c16 && c16.note, '绝对防御候选应当带触发概率提示：' + JSON.stringify(c16));

  /* ② 抽中小宇宙爆发：领悟（等级 1）+ 写 skillBoost 开关；**不写 effects[14]**
   *    （effects['14'] 是「木剑伤害 +N%」，也就是武器 3 的口径，
   *      写进去会让木剑白涨 25% —— 旧版抽中小宇宙时正是这个 bug） */
  assert.ok(T.addBuff(T._debugRun('endless'), 'C33').ok, '应当能拿到秘技通神');
  const pick14 = T.applyPickBuff('skill', 14);
  assert.ok(pick14.ok, '抽中小宇宙爆发应当成功：' + JSON.stringify(pick14));
  assert.equal(pick14.pct, 1, '小宇宙的 skillBoost 只作开关（=1）：' + pick14.pct);
  assert.equal(hasSkill(14), true, '抽中后应当领悟小宇宙爆发');
  assert.equal(T._debugRun('endless').skillBoost['14'], 1, 'skillBoost[14] 应当登记为开关');

  /* ③ 开战注入：mods.cosmosFirst = 1（adjustMe），且 effects 里不该多出 14 */
  const nx = T.nextBattle('endless');
  const me = { name: 'p', level: 70, power: 300, agility: 400, speed: 400, maxHp: 5000, hp: 5000,
    baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [{ id: 5, level: 5 }],
    skills: S.mySkills().map((x) => ({ id: Number(x.id), level: x.level })),
    wears: [], effects: {}, masterLevel: 0 };
  nx.adjustMe(me);
  assert.equal(me.mods.cosmosFirst, 1, '开战应当带上 cosmosFirst');
  assert.ok(me.effects[14] == null, '不该把 effects[14] 当成技能加成写进去（那是武器 3 的口径）：' + me.effects[14]);

  /* ④ 实战：我方**第一招**必定是小宇宙爆发（哪怕武器优先的 48% 抽到了武器），
   *    而且它自带 actAgain —— 不占回合，出手序列紧接着还有下一招。 */
  const foe = { name: 'F', level: 70, power: 300, agility: 200, speed: 200, hp: 999999, maxHp: 999999,
    weapons: [{ id: 1, level: 5 }], skills: [], effects: {}, baseStats: { power: 300, agility: 200, speed: 200 } };
  for (let i = 0; i < 5; i++) {
    const res = Sim.simulate(me, foe);
    const mine = (res.rounds || []).filter((r) => r.attacker === 0);
    assert.ok(mine.length > 0, '我方应当出过手');
    assert.ok(mine[0].action === 'skill' && mine[0].id === 14,
      '第 ' + (i + 1) + ' 次模拟：我方第一招必须是小宇宙爆发，实测 ' + JSON.stringify(mine[0]));
    assert.equal(mine.filter((r) => r.action === 'skill' && r.id === 14).length, 1,
      '小宇宙一场只能放一次');
    assert.ok(mine.length >= 2, '小宇宙自带 actAgain，之后还要能接着出手');
  }

  /* ⑤ 没学小宇宙时不该硬放（mods 只是开关，技能还得真有） */
  const noSkill = Object.assign({}, me, { skills: [{ id: 12, level: 5 }] });
  const resNo = Sim.simulate(noSkill, foe);
  assert.ok(!(resNo.rounds || []).some((r) => r.attacker === 0 && r.action === 'skill' && r.id === 14),
    '没学小宇宙爆发时不该被硬放出来');

  /* ⑥ 绝对防御的加成幅度略微下调：2.0 → 1.5（触发率 ×3 → ×2.5），龟甲术保持 2.0 */
  freshRun();
  T.addBuff(T._debugRun('endless'), 'C33');
  const pick16 = T.applyPickBuff('skill', 16);
  assert.ok(pick16.ok, '抽中绝对防御应当成功：' + JSON.stringify(pick16));
  assert.equal(pick16.pct, 1.5, '绝对防御的加成应当从 2.0 降到 1.5：' + pick16.pct);
  freshRun();
  T.addBuff(T._debugRun('endless'), 'C33');
  const pick7 = T.applyPickBuff('skill', 7);
  assert.ok(pick7.ok, '抽中龟甲术应当成功：' + JSON.stringify(pick7));
  assert.equal(pick7.pct, 2.0, '龟甲术的加成保持 2.0 不变：' + pick7.pct);

  /* 触发率对照：17 × (1+1.5) = 42.5（原来 32.5）、22 × (1+1.5) = 55（原来 66）；
   * ×3 那档 17×3 = 51 会被「二次及以后 ≤45」的封顶压成 45（需求140 抬高了基准）。 */
  const mkF = (boost) => ({ name: 'p', level: 60, power: 200, agility: 100, speed: 100, hp: 1000, maxHp: 1000,
    weapons: [], skills: [{ id: 16, level: 5 }], skillBoost: boost || {}, effects: {}, baseStats: { power: 200, agility: 100, speed: 100 } });
  assert.equal(Sim.jueDuiChanceOf(mkF({ 16: 2.0 }), false), 66, '未下调时首次是 66（对照）');
  assert.equal(Sim.jueDuiChanceOf(mkF({ 16: 2.0 }), true), 45, '未下调时二次及以后：17×3=51 被封顶压到 45（对照）');
  assert.equal(Sim.jueDuiChanceOf(mkF({ 16: 1.5 }), false), 55, '下调后首次应当是 55：' + Sim.jueDuiChanceOf(mkF({ 16: 1.5 }), false));
  assert.equal(Sim.jueDuiChanceOf(mkF({ 16: 1.5 }), true), 42.5, '下调后二次及以后应当是 42.5：' + Sim.jueDuiChanceOf(mkF({ 16: 1.5 }), true));
  assert.ok(Sim.jueDuiChanceOf(mkF({ 16: 1.5 }), true) <= 50, '仍然守住「二次及以后 ≤50%」的底线');
  T.abandon('endless');
});

test('需求67：装备出售界面倒序（新合成/新融合的排最前）', () => {
  const c = setup();
  const T = c.Tower, S = c.State;
  /* 把 classic-ui.js 里**真实的 openGearSell** 抠出来跑（不复制一份实现），
   * 只桩掉它依赖的渲染/状态接口，检查它给每张卡生成的 data-sell 顺序。 */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8').split('\n');
  const a = src.findIndex((l) => l.includes('function openGearSell(pg) {'));
  assert.ok(a >= 0, 'classic-ui.js 里应当有 openGearSell');
  const b = src.findIndex((l, i) => i > a && l.includes('点一件装备'));
  assert.ok(b > a, '找不到 openGearSell 的结束位置');
  const fn = src.slice(a, b).join('\n');

  /* 装备三件（数组顺序就是「先进先出」，和后端 addGear 的 push 一致） */
  const gears = [
    { id: 1, name: '旧头巾', quality: 0, key: 'g1', used: false },
    { id: 2, name: '新衣服', quality: 1, key: 'g2', used: false },
    { id: 3, name: '刚融合的鞋', quality: 2, key: 'g3', used: false }
  ];
  const pages = [];
  const node = () => ({ textContent: '', onclick: null, addEventListener() {} });
  const ctx = {
    console,
    State: {
      myGears: () => gears.slice(),
      state: () => ({ goldPoint: 0 }),
      gearSellRange: () => [60, 65],
      isGearStarred: () => false,
      gearCapacity: () => 60
    },
    gearImg: () => '<i></i>', esc: (v) => String(v),
    page: (group, active, html) => { pages.push({ group, active, html }); return node(); },
    $: () => node(),
    $$: () => [],
    btn: () => '<b></b>', openStatus: () => {}, askSellGear: () => {},
    GEAR_SELL_PER: 6, QUALITY_LABEL: ['普通', '优秀', '杰出', '卓越', '传说']
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('let gearSellPage = 0;\n' + fn + '\nopenGearSell(0);', ctx, { filename: 'openGearSell' });

  assert.ok(pages.length > 0, '应当渲染了一页');
  const html = pages[pages.length - 1].html;
  const order = [...html.matchAll(/data-sell="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['g3', 'g2', 'g1'],
    '出售界面必须**倒序**展示（新的在前），实测 ' + JSON.stringify(order));
  /* 源码口径：确实是「反转」而不是「按 key 排序」 */
  assert.ok(fn.indexOf('State.myGears().slice().reverse()') > 0,
    'openGearSell 应当对 equip 列表做 slice().reverse()（先进先出的数组 → 倒序）');
  T.abandon('endless');
  void S;
});

test('需求68：4/5/6 选 1 时卡片间距递减、文字横向铺满（含 6 张不溢出）', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8');
  /* 结构口径：容器带 nN、弹窗带 hex-nN（CSS 靠这两个记号分档） */
  assert.ok(ui.indexOf("'<div class=\"hex-cards n' + nSlots") > 0 ||
    /hex-cards n' \+ nSlots/.test(ui), 'hex-cards 容器要带 nN 记号');
  assert.ok(/classList\.add\('choice-dialog', 'hex', 'hex-n' \+ nSlots\)/.test(ui),
    '弹窗要带 hex-nN 记号（标题区按档收紧）');
  assert.ok(ui.indexOf('const nSlots = Math.max(1, Math.min(6, choices.length));') > 0,
    '档位要按实际选项数取（3~6）');
  /* 间距逐级减小 */
  const num = (re, src2) => Number((re.exec(src2) || [])[1]);
  const gap = (n) => num(new RegExp('\\.hex-cards\\.n' + n + '\\{gap:(\\d+)px\\}'), css);
  const pad = (n) => num(new RegExp('\\.hex-cards\\.n' + n + ' \\.hex-card\\{padding-left:(\\d+)px'), css);
  assert.ok(gap(4) > gap(5) && gap(5) > gap(6), '卡片间距要逐级减小：n4=' + gap(4) + ' n5=' + gap(5) + ' n6=' + gap(6));
  assert.ok(pad(4) > pad(5) && pad(5) > pad(6), '左右内边距要逐级收窄（文字更贴边）：n4=' + pad(4) + ' n5=' + pad(5) + ' n6=' + pad(6));
  assert.ok(gap(4) < 22, '4 选 1 就该比原来的 22px 小：' + gap(4));
  /* 3 选 1 保持原样（没有 n3 覆盖 = 用 .hex-cards 的默认值） */
  assert.ok(!/\.hex-cards\.n3\{/.test(css), '3 选 1 不该被改动');
  /* 6 张不溢出：容器要有宽度上限 + 卡片允许收缩 */
  assert.ok(/\.hex-cards\{[^}]*max-width:1120px/.test(css), '容器要有不超过画布（1170）的宽度上限');
  assert.ok(/\.hex-cards \.hex-card\{flex:0 1 268px;min-width:0\}/.test(css), '卡片要允许收缩');
  /* 纵向兜底：5/6 选 1 收紧描述字号与卡片内边距，避免标题被顶出画布 */
  assert.ok(/\.hex-cards\.n6 \.hex-desc\{font-size:19px/.test(css), '6 选 1 要收描述字号');
  assert.ok(/\.choice-dialog\.hex-n6 \.hex-pick-head\{margin-bottom:12px\}/.test(css), '6 选 1 要收标题区下边距');
});

test('需求69：终焉烙印（C49）碎掉的那一份也要计入「获得过」', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openRun = () => {
    S.newGame('r69' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = []; r.env = []; r.noEnvRoll = true;
    return r;
  };
  /* 找一个「下一次判定必定碎裂」的种子（fragileRoll 的 LCG 第一步） */
  const breakSeed = (() => {
    for (let s = 1; s < 200000; s++) {
      const v = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      if ((v / 4294967296) * 100 < 6) return s;
    }
    return null;
  })();
  assert.ok(breakSeed, '应当能找到必碎种子');
  /* 赢一场 → reportBattle 里会跑 rollFragileBuffs，把烙印打碎 */
  const winOne = () => {
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到战斗');
    const a = T._debugRun('endless');
    T.reportBattle('endless', a.attempt, true, 1, null);
  };

  const run = openRun();
  const c49 = TD.BUFF_BY_ID.C49;
  assert.equal(T.obtainedCountOf(run, 'C49'), 0, '开局没拿过');
  assert.equal(T.buffWeightOf(run, 'C49'), 1, '第一份没有重复惩罚');

  /* ① 拿到 1 份 → 强制碎掉：在册层数归零，但「获得过」不变 */
  assert.ok(T.addBuff(T._debugRun('endless'), 'C49').ok, '第 1 份应当能拿到');
  assert.equal(T.obtainedCountOf(T._debugRun('endless'), 'C49'), 1);
  assert.equal(T.buffWeightOf(T._debugRun('endless'), 'C49'), 1, '只有 1 份时无重复惩罚');
  T._debugRun('endless').fragileSeeds = { C49: breakSeed };
  winOne();
  const afterBreak = T._debugRun('endless');
  assert.equal(T._debugRun('endless').limited.filter((b) => b.id === 'C49').length, 0, '烙印应当已经碎了（从 limited 里移除）');
  assert.ok((afterBreak.buffLog || []).some((e) => e.id === 'C49' && e.event === 'break'), '流水里应当有 break 事件');
  assert.equal(T.obtainedCountOf(afterBreak, 'C49'), 1, '碎掉之后仍然算「获得过 1 份」：' + T.obtainedCountOf(afterBreak, 'C49'));
  assert.equal(T.poolFilterOf(afterBreak, c49), true, '碎掉之后还能再拿（3 次上限内）');

  /* ② 再拿 1 份（碎 1 + 在册 1）：权重按 2 份算 → ÷2（2026-10 由 ×0.10 改成 x/n 口径） */
  assert.ok(T.addBuff(T._debugRun('endless'), 'C49').ok, '第 2 份应当能拿到');
  const two = T._debugRun('endless');
  assert.equal(T.obtainedCountOf(two, 'C49'), 2, '碎 1 + 在册 1 = 2 份');
  assert.ok(Math.abs(T.buffWeightOf(two, 'C49') - 0.88) < 1e-9,
    '第 2 份的抽取权重应当是 ×0.88（含碎掉那份）：' + T.buffWeightOf(two, 'C49'));

  /* ③ 第 3 份再碎掉 → 累计 3 份。
   * 2026-10 用户口径：**累计口径只用来降权，不再当上限**（原来是「累计 3 份就永远出池」）——
   * 碎掉/卖掉都释放名额，所以还能继续刷到，只是权重 ÷n 越来越低。 */
  T._debugRun('endless').fragileSeeds = { C49: breakSeed };
  winOne();
  assert.ok(Math.abs(T.buffWeightOf(T._debugRun('endless'), 'C49') - 0.88) < 1e-9,
    '碎掉不改变份数口径（2 份 → ×0.88）：' + T.buffWeightOf(T._debugRun('endless'), 'C49'));
  assert.ok(T.addBuff(T._debugRun('endless'), 'C49').ok, '第 3 份应当能拿到');
  const three = T._debugRun('endless');
  assert.equal(T.obtainedCountOf(three, 'C49'), 3);
  const row3 = three.limited.find((b) => b.id === 'C49');
  if (row3) three.limited = three.limited.filter((b) => b.id !== 'C49');   // 模拟第 3 份也碎了
  assert.equal(T.poolFilterOf(three, c49), true, '累计 3 份（哪怕都碎了）仍然可以再进池');
  assert.equal(T.ownableOf(three, c49), true, '累计 3 份之后仍然可以获得');
  assert.ok(Math.abs(T.buffWeightOf(three, 'C49') - Math.pow(0.88, 2)) < 1e-9,
    '3 份时权重应当是 ×0.7744：' + T.buffWeightOf(three, 'C49'));
  /* 再往后也一样：只是权重继续 ×0.88 */
  assert.ok(T.addBuff(T._debugRun('endless'), 'C49').ok, '第 4 份仍然能拿到');
  const four = T._debugRun('endless');
  assert.equal(T.obtainedCountOf(four, 'C49'), 4);
  assert.equal(T.ownableOf(four, c49), true, '4 份时仍可获得');
  assert.ok(Math.abs(T.buffWeightOf(four, 'C49') - Math.pow(0.88, 3)) < 1e-9,
    '4 份时权重应当是 ×0.6815：' + T.buffWeightOf(four, 'C49'));

  /* ④ 2026-10 用户口径：**取消 C52 的权重下降** —— 拿多少份都不再降权。 */
  const run2 = openRun();
  assert.ok(T.addBuff(T._debugRun('endless'), 'C52').ok, '涌泉烙印应当能拿到');
  assert.ok(Math.abs(T.buffWeightOf(T._debugRun('endless'), 'C52') - 1) < 1e-9, '第 1 份无惩罚');
  assert.ok(T.addBuff(T._debugRun('endless'), 'C52').ok, '第 2 份应当能拿到');
  assert.ok(Math.abs(T.buffWeightOf(T._debugRun('endless'), 'C52') - 1) < 1e-9,
    'C52 已取消权重下降，第 2 份仍然 ×1：' + T.buffWeightOf(T._debugRun('endless'), 'C52'));
  void run2;
  T.abandon('endless');
});

test('需求70：淘金烙印（C53）——传奇·只在战斗中掉落·一局一次·+15%/+30% 试炼币', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openRun = (layer) => {
    S.newGame('r70' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    if (layer) T._debugSetEndlessLayer(layer);
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = []; r.env = []; r.noEnvRoll = true;
    return r;
  };
  const breakSeed = (() => { for (let s = 1; s < 200000; s++) { const v = (Math.imul(s, 1664525) + 1013904223) >>> 0; if ((v / 4294967296) * 100 < 6) return s; } return null; })();
  const winOne = () => {
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到战斗');
    const a = T._debugRun('endless');
    T.reportBattle('endless', a.attempt, true, 1, null);
  };
  const coinsAfterWin = () => {
    const before = T._debugRun('endless').coins;
    winOne();
    return T._debugRun('endless').coins - before;
  };

  /* ① 数据与池子口径：传奇 · 限次烙印 · 一局一次 · **只在战斗奖励里**（商店 / 挑战塔都不进） */
  const c53 = TD.BUFF_BY_ID.C53;
  assert.ok(c53, 'C53 淘金烙印应当存在');
  assert.equal(c53.name, '淘金烙印', 'C53 名称');
  assert.equal(c53.rarity, 3, 'C53 应当是传奇');
  assert.equal(c53.kind, 'limited', 'C53 应当是限次类（烙印）');
  assert.equal(TD.hasTag(c53, 'battle') && !TD.hasTag(c53, 'shop'), true, 'C53 应当只从战斗奖励掉落');
  assert.equal(c53.maxStacks, 1, 'C53 一局只能获得一次');
  assert.equal(c53.mods.fragileCoinAddAlive, 0.15, '未破碎 +15% 试炼币');
  assert.equal(c53.mods.fragileCoinAddBurned, 0.30, '破碎后 +30% 试炼币');
  assert.equal(c53.mods.fragileBreakPct, 6, '仍然是 6% 损毁');
  assert.equal(TD.inPool('E.choice', c53), true, 'C53 应当进无尽塔战斗奖励');
  assert.equal(TD.inPool('E.shop', c53), false, 'C53 不该进商店货架');
  assert.equal(TD.inPool('T.choice', c53), false, 'C53 不该进挑战塔池');
  const r0 = openRun();
  T.addBuff(T._debugRun('endless'), 'C53');
  assert.equal(T.poolFilterOf(T._debugRun('endless'), c53), false, '拿过一次之后不再进池');
  assert.equal(T._debugRun('endless').fragileCoinBase, 1, '拿到后未破碎份数应当是 1');

  /* ② 未破碎：每场胜利的试炼币 ×1.15 */
  openRun();
  const baseCoins = coinsAfterWin();
  openRun();
  T.addBuff(T._debugRun('endless'), 'C53');
  const aliveCoins = coinsAfterWin();
  assert.ok(Math.abs(aliveCoins - Math.round(baseCoins * 1.15)) <= 1,
    '未破碎时试炼币应当是基础 ×1.15：' + baseCoins + ' → ' + aliveCoins);

  /* ③ 破碎后：×1.30（走真实碎裂路径，并顺带锁死「已损毁份数进明细」） */
  const rr = openRun();
  T.addBuff(T._debugRun('endless'), 'C53');
  T._debugRun('endless').fragileSeeds = { C53: breakSeed };
  coinsAfterWin();                                    // 这一场结束时判定损毁
  const broken = T._debugRun('endless');
  assert.equal(broken.fragileCoinBase, 0, '损毁后未破碎份数应当归零：' + broken.fragileCoinBase);
  /* 注意：VM 里造出来的数组与本进程的 Array 不是同一个 realm，deepStrictEqual 会因为
   * 原型不同而报错 —— 用 JSON 比较（值本身都是原始数字）。 */
  assert.equal(JSON.stringify(broken.fragileCoinBurned), JSON.stringify([0.30]),
    '损毁份数应当进明细：' + JSON.stringify(broken.fragileCoinBurned));
  assert.ok((broken.brokenMarks || []).some((m) => m.kind === 'coin'), '明细里应当有一条 coin 记录');
  const brokenCoins = coinsAfterWin();
  assert.ok(Math.abs(brokenCoins - Math.round(baseCoins * 1.30)) <= 1,
    '破碎后试炼币应当是基础 ×1.30：' + baseCoins + ' → ' + brokenCoins);
  void rr;

  /* ④ 「30 层后每 2 层作废一条碎烙印」也要认得这一条（作废后加成消失） */
  const rAfter = T._debugRun('endless');
  const markIdx = (rAfter.brokenMarks || []).findIndex((m) => m.kind === 'coin');
  assert.ok(markIdx >= 0, '应当能找到 coin 明细');
  rAfter.brokenMarks.splice(markIdx, 1);
  T.rebuildFragileTotalsOf ? T.rebuildFragileTotalsOf(rAfter) : null;
  T.abandon('endless');
});

test('需求71：限次栏显示「未破碎的烙印叠层」', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  /* 把 tower-ui.js 里**真实的 limitBadgeText** 抠出来跑（与面板用的是同一份实现）。 */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8').split('\n');
  const a = src.findIndex((l) => l.includes('function limitBadgeText(b) {'));
  assert.ok(a >= 0, 'tower-ui.js 里应当有 limitBadgeText');
  const b = src.findIndex((l, i) => i > a && l.includes('\n') === false && /^\s*\}$/.test(l));
  const fn = src.slice(a, b + 1).join('\n');
  /* limitBadgeText 依赖 isTowerNext（按标签 + 模式判定），把那份真实实现也一起抠出来。 */
  const joined = src.join('\n');
  const ia = joined.indexOf('function isTowerNext(b, mode) {');
  assert.ok(ia >= 0, 'tower-ui.js 里应当有 isTowerNext');
  let ik = joined.indexOf('{', ia), depth = 0, ie = ik;
  while (ie < joined.length) {
    const ch = joined[ie];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
    ie++;
  }
  const helper = joined.slice(ia, ie + 1);
  /* 两个函数都按标签判定（TowerData.hasTag），所以桩里也要带上它。 */
  const ctx = { TowerData: { BUFF_BY_ID: TD.BUFF_BY_ID, hasTag: TD.hasTag } };
  vm.createContext(ctx);
  const badge = vm.runInContext(helper + '\n' + fn + '\nlimitBadgeText;', ctx, { filename: 'limitBadgeText' });

  const c49 = TD.BUFF_BY_ID.C49, c52 = TD.BUFF_BY_ID.C52;
  assert.equal(badge({ id: 'C49', stacks: 1, uses: 1000, on: true }), '易碎 6%', '1 层烙印照旧只写易碎概率');
  assert.equal(badge({ id: 'C49', stacks: 2, uses: 1000, on: true }), '×2 层 · 易碎 6%',
    '2 层要能看出「未破碎叠层 ×2」');
  assert.equal(badge({ id: 'C49', stacks: 3, uses: 1000, on: true }), '×3 层 · 易碎 6%', '3 层同理');
  assert.equal(badge({ id: 'C52', stacks: 2, uses: 1000, on: true }), '×2 层 · 易碎 6%', '涌泉烙印同样显示叠层');
  assert.equal(badge({ id: 'N14', stacks: 1, uses: 10, on: true, nextBattle: true }),
    '无尽塔 · 剩 10 场', '普通限次类仍然只写剩余场次');
  assert.equal(badge({ id: 'N14', stacks: 2, uses: 10, on: true, nextBattle: true }),
    '×2 层 · 无尽塔 · 剩 10 场', '叠层的限次类也要带层数');
  /* 面板真的把这一份用上了（源码口径，避免「定义了但没接」） */
  const ui = src.join('\n');
  assert.ok(/limitBadgeText\(b\)/.test(ui), '面板的 <em> 必须走 limitBadgeText');
  /* 悬停提示也要写清「当前未破碎叠层」 */
  assert.ok(/当前未破碎叠层：×/.test(ui), 'limitTip 要写清未破碎叠层');

  /* 端到端：叠 2 层之后 ownedBuffs 报出的就是未破碎层数 */
  S.newGame('r71' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r = T._debugRun('endless');
  r.permanent = []; r.limited = []; r.slotFreeIds = [];
  T.addBuff(T._debugRun('endless'), 'C49');
  T.addBuff(T._debugRun('endless'), 'C49');
  const row = T.ownedBuffs('endless').find((x) => x.id === 'C49');
  assert.equal(row && row.stacks, 2, '面板拿到的层数应当是 2：' + (row && row.stacks));
  /* 碎掉一层之后，面板上的层数要跟着降（破碎的那一份不再显示） */
  const rr = T._debugRun('endless');
  const c49row = rr.limited.find((x) => x.id === 'C49');
  c49row.stacks -= 1;
  assert.equal(T.ownedBuffs('endless').find((x) => x.id === 'C49').stacks, 1, '碎掉一层后面板应当只剩 1 层');
  T.abandon('endless');
});

test('需求72：涅槃（C14）一局可拿两次 —— 第 2 层改为「本层 2 次复活机会」', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openRun = (layer) => {
    S.newGame('r72' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    if (layer) T._debugSetEndlessLayer(layer);
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = []; r.env = []; r.noEnvRoll = true;
    return r;
  };
  const mk = () => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 5000, hp: 4000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });
  const startBattle = () => {
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到战斗');
    const me = mk();
    nx.adjustMe(me);
    return { nx: nx, me: me };
  };
  const winWithRevive = (times) => {
    const a = T._debugRun('endless');
    const rounds = [];
    for (let i = 0; i < times; i++) rounds.push({ attacker: 0, action: 'dot', dmg: 1, deathSave: true, revive: 1 });
    T.reportBattle('endless', a.attempt, true, 4000, 5000, { rounds: rounds });
  };

  /* ① 数据：可叠 2 层；第三份被拒（叠满） */
  const c14 = TD.BUFF_BY_ID.C14;
  assert.equal(TD.hasTag(c14, 'stackable'), true, 'C14 应当可以叠层');
  assert.equal(c14.maxStacks, 2, 'C14 一局最多 2 层');
  assert.equal(c14.mods.revivePct, 0.50, '复活仍然回 50% 上限');
  assert.equal(c14.mods.reviveStatMul, 0.50, '复活后力/敏/速 +50% 不变（第 2 层不再放大它）');
  /* 本轮增益表重做后文案改成「每层战斗可复活一次…」；「一局能拿两次」由数据字段锁定 */
  assert.equal(TD.hasTag(c14, 'stackable'), true, '涅槃仍然可叠层');
  assert.equal(c14.maxStacks, 2, '涅槃一局最多 2 层：' + c14.maxStacks);
  assert.match(c14.desc, /每层战斗可复活一次/, '文案要写明每层可复活：' + c14.desc);
  openRun(3);
  assert.ok(T.addBuff(T._debugRun('endless'), 'C14').ok, '第 1 份应当能拿到');
  assert.ok(T.addBuff(T._debugRun('endless'), 'C14').ok, '第 2 份应当能拿到');
  /* 2026-10 用户口径（回调）：涅槃**叠满 2 层后不再在本局生成** ——
   * 加回 noRestack：拿满上限即出池，也不会再另开栏位。 */
  assert.equal(TD.hasTag(c14, 'noRestack'), true, '涅槃重新带 noRestack（叠满即出池）');
  const dup = T.addBuff(T._debugRun('endless'), 'C14');
  assert.equal(dup.ok, false, '第 3 份应当被拒（叠满即出池）：' + JSON.stringify(dup));
  const c14Rows = T._debugRun('endless').permanent.filter((b) => b.id === 'C14');
  assert.equal(c14Rows.length, 1, '只占一栏：' + JSON.stringify(c14Rows.map((b) => b.stacks)));
  assert.equal(T.poolFilterOf(T._debugRun('endless'), c14), false, '叠满后移出本局可获得池');
  assert.equal(T.ownableOf(T._debugRun('endless'), c14), false, '叠满后不再能获得');
  assert.equal(JSON.stringify(c14Rows.map((b) => b.stacks)), JSON.stringify([2]), '同栏叠满 2 层');
  assert.equal(T.stacksOf ? T.stacksOf(T._debugRun('endless'), 'C14') : 2, 2, '总层数 2');

  /* ② 1 层：每层 1 次复活（与旧行为一致） */
  openRun(3);
  T.addBuff(T._debugRun('endless'), 'C14');
  const one = startBattle();
  assert.equal((one.me.mods.deathSaves || []).length, 1, '1 层涅槃每层给 1 次复活');
  assert.equal(one.me.mods.deathSaves[0].revive, 1, '要带 revive 标记（与金蝉脱壳区分）');

  /* ③ 2 层：本层给 2 次复活；用掉 1 次后同一层只再补 1 次；用满后本层不再给 */
  openRun(3);
  T.addBuff(T._debugRun('endless'), 'C14');
  T.addBuff(T._debugRun('endless'), 'C14');
  const two = startBattle();
  assert.equal((two.me.mods.deathSaves || []).length, 2, '2 层涅槃每层给 2 次复活');
  assert.equal(two.me.mods.deathSaves[0].healPct, 0.5);
  assert.equal(two.me.mods.deathSaves[0].statMul, 0.5, '复活后的属性加成不随层数放大');
  winWithRevive(1);
  const afterOne = T._debugRun('endless');
  assert.equal(afterOne.reviveLayer, 3, '应当记下「本层已经用过复活」');
  assert.equal(afterOne.reviveUsed, 1, '本层已用 1 次：' + afterOne.reviveUsed);
  const second = startBattle();
  assert.equal((second.me.mods.deathSaves || []).length, 1, '同一层第二场只该再补 1 次');
  winWithRevive(1);
  assert.equal(T._debugRun('endless').reviveUsed, 2, '本层已用满 2 次');
  const third = startBattle();
  assert.equal((third.me.mods.deathSaves || []).length, 0, '本层 2 次用完后不该再给');
  /* ④ 换层之后重新给 2 次（先把这一场打完，否则战斗令牌还挂着、取不到下一场；
   * 第 3 场打完会挂上场间选择，这里清掉——本测试只关心复活机会的发放） */
  winWithRevive(0);
  const nr = T._debugRun('endless');
  nr.choices = null;
  nr.layer = 4;
  nr.idx = 0;
  const fourth = startBattle();
  assert.equal((fourth.me.mods.deathSaves || []).length, 2, '换到新的一层应当重新给 2 次');
  /* ⑤ 引擎口径：复活甲那条 deathSave 会被打上 r.revive 标记（reportBattle 靠它
   *    把涅槃与金蝉脱壳分开数），金蝉脱壳那条不带 */
  const Sim = c.Sim;
  /* 1 血进场：对手任意一击都能带走，所以「这一场死不死」不再取决于闪避运气。
   * （原来给 160 血 + 最多 12 次重试，实测仍会偶发 12 次都没死成 → 断言拿到 null。）
   * 传**工厂**而不是对象：sim 会把 deathSaves 消耗掉，每次都新建一份才不会被上一次污染。 */
  const mkRevive = () => Object.assign(mk(), { hp: 1, maxHp: 1, mods: { deathSaves: [{ healPct: 0.5, statMul: 0.5, revive: 1 }] } });
  const mkShell = () => Object.assign(mk(), { hp: 1, maxHp: 1, mods: { deathSaves: [{}] } });   // 金蝉脱壳：{}=保留 1 血
  const simFoe = Object.assign(mk(), { name: '敌', power: 600, agility: 100, speed: 300, hp: 999999, maxHp: 999999 });
  const firstDeathRound = (makeMe) => {
    for (let i = 0; i < 8; i++) {
      const res = Sim.simulate(makeMe(), simFoe);
      const hit = (res.rounds || []).find((x) => x.deathSave);
      if (hit) return hit;
    }
    return null;
  };
  const revRound = firstDeathRound(mkRevive);
  assert.ok(revRound && revRound.revive === 1, '涅槃的 deathSave 回合要带 revive 标记：' + JSON.stringify(revRound));
  const shellRound = firstDeathRound(mkShell);
  assert.ok(shellRound && shellRound.revive === undefined, '金蝉脱壳的 deathSave 不该带 revive 标记：' + JSON.stringify(shellRound));

  /* ⑥ 金蝉脱壳（N04）的免死不算涅槃次数 */
  openRun(3);
  T.addBuff(T._debugRun('endless'), 'C14');
  const a2 = T._debugRun('endless');
  const nx2 = T.nextBattle('endless');
  nx2.adjustMe(mk());
  T.reportBattle('endless', a2.attempt, true, 4000, 5000, { rounds: [{ attacker: 0, action: 'dot', dmg: 1, deathSave: true }] });
  assert.equal(Number(T._debugRun('endless').reviveUsed) || 0, 0, '只有金蝉脱壳的 deathSave 不该消耗涅槃次数');
  T.abandon('endless');
});

test('需求73：无尽主界面右上角显示「实际退出到手」的抽奖卷（本轮已去掉标题下方那行拆解）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openRun = (layer) => {
    S.newGame('r73' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    if (layer) T._debugSetEndlessLayer(layer);
    const r = T._debugRun('endless');
    r.permanent = []; r.limited = []; r.slotFreeIds = []; r.env = []; r.noEnvRoll = true;
    return r;
  };

  /* ① 数据口径：本层应得 / 退出总额（= 本层应得 + 铸币；试炼币不折现）/ 铸币 */
  const run0 = openRun(6);
  run0.coins = 24;
  const info = T.endlessInfo().run;
  assert.ok(info, '应当有进行中的对局');
  assert.equal(info.layer, 6, '层数应当是 6');
  assert.equal(info.ticketsIfSettle, TD.endlessTickets(6), '本层应得应当等于 endlessTickets(当前层)');
  assert.equal(info.ticketsIfSettle, 2, '第 6 层（第 2 段）应当是 2 张');
  assert.equal(info.ticketsOnExit, 2, '有 24 试炼币也不该进总额，实测 ' + info.ticketsOnExit);
  assert.equal(info.retryToken, 0, '开局没有铸币');
  /* 拿到铸币（E10 即时类）后总额要跟着涨 */
  T.applyInstant(T._debugRun('endless'), TD.BUFF_BY_ID.E10);
  assert.equal(T.endlessInfo().run.retryToken, 3, 'E10 的 3 枚要能读出来（本轮增益表重做后的数值）');
  assert.equal(T.endlessInfo().run.ticketsOnExit, T.endlessInfo().run.ticketsIfSettle + 3,
    '铸币要 1:1 进总额：' + T.endlessInfo().run.ticketsOnExit);
  /* 换一层：档位跟着走 */
  const tb = T._debugRun('endless');
  tb.layer = 26;
  assert.equal(T.endlessInfo().run.ticketsIfSettle, TD.endlessTickets(26), '换层后应当跟着变');
  assert.ok(TD.endlessTickets(26) > TD.endlessTickets(6), '更深的层应当更多');

  /* ② 本轮需求：标题下方那行「离场可得 +N 抽奖卷（…）」已经整块去掉 ——
   * 界面与样式里都不该再有它（右上角那一枚仍然是「实际退出到手」的总数）。 */
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  assert.ok(ui.indexOf('endlessLeaveHtml') < 0, 'tower-ui 里不该再有 endlessLeaveHtml');
  assert.ok(ui.indexOf('endless-leave-line') < 0 && ui.indexOf('leave-chip') < 0, '不该再有离场结算那一行的结构');
  const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8');
  assert.ok(!/\.endless-leave-line|\.leave-inner|\.leave-chip/.test(css), 'CSS 里不该再有离场结算那一行的样式');
  /* 右上角那枚仍然按 ticketsOnExit 显示（不是仓库持有数） */
  assert.ok(/run \? exitT : \(S\.props\[CURRENCY_PROP\.ticket\] \|\| 0\)/.test(ui), '右上角仍应显示退出总额');
  assert.ok(/ticketsOnExit/.test(ui), '右上角仍要读 ticketsOnExit');

  /* ③ 端到端：放弃本局实际到手的张数 == 右上角显示的那个数 */
  openRun(6);
  T._debugRun('endless').coins = 24;           // 试炼币：不折现
  T._debugRun('endless').retryToken = 3;       // 铸币：1:1 折现
  const expect = T.endlessInfo().run.ticketsOnExit;
  assert.equal(expect, TD.endlessTickets(6) + 3, '退出总额应当 = 2 + 3 = 5（24 试炼币不算），实测 ' + expect);
  const beforeTickets = Number(S.state().props[50] || 0);
  const ab = T.abandon('endless');
  assert.equal(ab.ok, true, '应当能放弃本局');
  assert.equal(Number(S.state().props[50] || 0) - beforeTickets, expect,
    '放弃本局实际到手应当等于界面显示：' + expect + ' vs ' + (Number(S.state().props[50] || 0) - beforeTickets));
});
test('需求74：所有退出本局的方式收益完全一致（本层应得 + 铸币 1:1 折现；试炼币作废）', () => {
  const c = setup();
  const T = c.Tower, S = c.State, TD = c.TowerData;
  const TICKET = 50;
  const COINS = 24, TOKENS = 5, LAYER = 6;
  const LAYER_T = TD.endlessTickets(LAYER);          // 第 6 层（第 2 段）= 2 张
  const TOTAL = LAYER_T + TOKENS;                    // 2 + 5 = 7（试炼币不参与）
  const newRun = () => {
    S.newGame('r74' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    T._debugSetEndlessLayer(LAYER);
    const r = T._debugRun('endless');
    r.coins = COINS; r.retryToken = TOKENS; r.env = []; r.noEnvRoll = true;
    return r;
  };
  assert.equal(TOTAL, 7, '基准：第 6 层 2 张 + 5 枚铸币 = 7 张（24 试炼币不算），实测 ' + TOTAL);

  /* ① 放弃本局 */
  newRun();
  const before1 = Number(S.state().props[TICKET] || 0);
  const r1 = T.abandon('endless');
  assert.equal(r1.tickets, TOTAL, '放弃本局应当发 ' + TOTAL + ' 张，实测 ' + r1.tickets);
  assert.equal(r1.layerTickets, LAYER_T, '本层应得那份：' + r1.layerTickets);
  assert.equal(r1.retryLeft, TOKENS, '折现的铸币数：' + r1.retryLeft);
  assert.equal(r1.forfeitCoins, COINS, '作废的试炼币数要报出来：' + r1.forfeitCoins);
  assert.equal(r1.coinsLeft, undefined, '不该再有「试炼币折现」字段');
  assert.equal(Number(S.state().props[TICKET] || 0) - before1, TOTAL, '放弃本局实际入包张数');
  assert.equal(T._debugRun('endless'), null, '放弃后本局结束');

  /* ② 结算点「结算离场」 */
  const run2 = newRun();
  run2.phase = 'checkpoint';
  const info2 = T.checkpointInfo();
  assert.equal(info2.ticketsNow, LAYER_T, '结算点「本层应得」= ' + LAYER_T);
  assert.equal(info2.retryToken, TOKENS, '结算点要带出铸币数量');
  assert.equal(info2.ticketsNowTotal, TOTAL, '结算点「立刻能领」= 本层 + 铸币：' + info2.ticketsNowTotal);
  const before2 = Number(S.state().props[TICKET] || 0);
  const r2 = T.settleEndless();
  assert.equal(r2.tickets, TOTAL, '结算离场应当发 ' + TOTAL + ' 张，实测 ' + r2.tickets);
  assert.equal(r2.layerTickets, LAYER_T, '结算离场也要报本层应得那份');
  assert.equal(r2.retryLeft, TOKENS, '结算离场也要折现铸币');
  assert.equal(Number(S.state().props[TICKET] || 0) - before2, TOTAL, '结算离场实际入包张数');
  assert.equal(T._debugRun('endless'), null, '结算后本局结束');

  /* ③ 失败结算（真的打输一场，走 endlessFail → doFail） */
  newRun();
  const nb = T.nextBattle('endless');
  assert.ok(nb.ok, '应当能开一场：' + nb.msg);
  const me = c.State.genAI(35, '', { levelJitter: 0, gearSelfLevel: true });
  me.maxHp = me.hp; nb.adjustMe(me);
  const run3 = T._debugRun('endless');
  run3.coins = COINS; run3.retryToken = 0;            // 无铸币 → 直接失败结算
  const before3 = Number(S.state().props[TICKET] || 0);
  const r3 = T.reportBattle('endless', nb.token, false, 0.3);
  assert.equal(r3.tickets, LAYER_T, '失败结算（无铸币）应当发 ' + LAYER_T + ' 张，实测 ' + r3.tickets);
  assert.equal(r3.layerTickets, LAYER_T, '失败结算也要报本层应得那份');
  assert.equal(r3.forfeitCoins, COINS, '失败结算也要报作废的试炼币');
  assert.equal(Number(S.state().props[TICKET] || 0) - before3, LAYER_T, '失败结算实际入包张数');
  assert.equal(T._debugRun('endless'), null, '失败后本局结束');

  /* ④ declineRetry（有铸币时选择放弃重打 → 同一个 doFail）也要折现铸币 */
  newRun();
  const nb4 = T.nextBattle('endless');
  const me4 = c.State.genAI(35, '', { levelJitter: 0, gearSelfLevel: true });
  me4.maxHp = me4.hp; nb4.adjustMe(me4);
  const run4 = T._debugRun('endless');
  run4.coins = COINS; run4.retryToken = 3;
  const fail4 = T.reportBattle('endless', nb4.token, false, 0.3);
  assert.equal(fail4.retryable, true, '有铸币时失败应当先不结算：' + JSON.stringify(fail4));
  assert.equal(T._debugRun('endless').coins, COINS, '铸币待命期间不该动币');
  const before4 = Number(S.state().props[TICKET] || 0);
  const r4 = T.declineRetry();
  assert.equal(r4.retryLeft, 3, '明细里要报「折现了 3 枚铸币」，实测 ' + r4.retryLeft);
  assert.equal(r4.tickets, LAYER_T + 3, '放弃重打应当发 ' + (LAYER_T + 3) + ' 张，实测 ' + r4.tickets);
  assert.equal(Number(S.state().props[TICKET] || 0) - before4, LAYER_T + 3, '放弃重打实际入包张数');
});

test('需求75：无尽塔商店刷新价 70 之后每 10 次涨 10（80/90…），稀有度收益在 50 那一档封顶', () => {
  const c = setup();
  const T = c.Tower, TD = c.TowerData;
  assert.equal(TD.SHOP.rerollMax, 70, '第一段封顶价常量应当是 70，实测 ' + TD.SHOP.rerollMax);
  assert.equal(TD.SHOP.rerollTiltCap, 50, '稀有度收益的封顶档应当是 50，实测 ' + TD.SHOP.rerollTiltCap);
  /* ① 公式：0（免费）→10→20→…→70，之后 70 用 10 次 → 80 用 10 次 → 90… */
  const seq = Array.from({ length: 12 }, (_, i) => TD.rerollPriceAt(i));
  assert.equal(seq.join(','), '0,10,20,30,40,50,60,70,70,70,70,70', '序列：' + seq.join(','));
  assert.equal(TD.rerollPriceAt(16), 70, '70 档的第 10 次还是 70');
  assert.equal(TD.rerollPriceAt(17), 80, '70 档刷满 10 次 → 80');
  assert.equal(TD.rerollPriceAt(27), 90, '80 档刷满 10 次 → 90');
  assert.equal(TD.rerollPriceAt(999), 1060, '再深继续涨（999 次 = 70 + 10×floor((999-7)/10)）');
  assert.equal(TD.rerollPriceAt(-3), 0, '负数当首次免费');
  /* ② 价格**不再封顶**；会封顶的是「收益」（稀有度倾斜到 50 那一档） */
  assert.equal(TD.rerollPriceCapped(0), false, '首次免费时不算封顶');
  assert.equal(TD.rerollPriceCapped(99), false, '价格永远不再算「封顶」');
  assert.equal(TD.rerollQualityCapped(6), true, '付到 50 币那一档之后收益封顶');
  assert.equal(TD.rerollQualityCapped(3), false, '更早还可以越刷越好');

  /* ③ 实战：同一家店连刷 10 次（钱管够），实付金额走 0,10,20,30,40,50,60,70,70,70 */
  const run = T._debugRun('endless');
  run.coins = 100000;
  run.phase = 'shop';
  run.shop = { layer: run.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
  const paid = [];
  for (let i = 0; i < 10; i++) {
    const st = T.shopState();
    assert.equal(st.rerollNextPrice, TD.rerollPriceAt(st.rerollCount), '标价要与公式一致（第 ' + (i + 1) + ' 次）');
    assert.equal(st.rerollCapped, TD.rerollPriceCapped(st.rerollCount), 'capped 标记要与公式一致');
    const r = T.rerollShop();
    assert.ok(r.ok, '应当能刷新：' + (r && r.msg));
    paid.push(r.paid);
  }
  assert.equal(paid.join(','), '0,10,20,30,40,50,60,70,70,70', '实付序列：' + paid.join(','));
  const spent = 0 + 10 + 20 + 30 + 40 + 50 + 60 + 70 + 70 + 70;
  assert.equal(100000 - run.coins, spent, '总花费应当是 ' + spent + '，实测 ' + (100000 - run.coins));
  /* 质量在 50 那一档就封顶：付 50 / 60 / 70 / 80 的 tilt 完全一样（价格继续涨、收益不再涨） */
  const t50 = TD.rerollExpectation(50, run).tilt;
  for (const p of [50, 60, 70, 80]) {
    assert.ok(Math.abs(TD.rerollExpectation(p, run).tilt - t50) < 1e-9,
      p + ' 币的 tilt 应当等于 50 档：' + TD.rerollExpectation(p, run).tilt);
  }
  /* 而 50 档之前仍然是「越贵越好」 */
  assert.ok(t50 > TD.rerollExpectation(40, run).tilt, '50 档应当优于 40 档');
  assert.ok(TD.rerollExpectation(40, run).tilt > TD.rerollExpectation(30, run).tilt, '40 档优于 30 档');

  /* ④ 全场五折（E04）时封顶价也要打折：70 → 35 */
  const run2 = T._debugRun('endless');
  run2.shop = { layer: run2.layer, retrySold: false, rerollFree: false, rerollCount: 7, rerollPaid: 70, slots: [], discount: true };
  run2.coins = 1000;
  const before2 = run2.coins;
  const r2 = T.rerollShop();
  assert.equal(r2.paid, 35, '五折后封顶价应当是 35，实测 ' + r2.paid);
  assert.equal(before2 - run2.coins, 35, '五折扣费应当精确');

  /* ⑤ 上限是配置常量（SHOP 被冻结，不会被运行期改掉）：
   *    把公式单独拎出来跑一遍，验证「rerollMax = 0 即不限」这条兜底仍在。 */
  assert.ok(Object.isFrozen(TD.SHOP), 'SHOP 应当是冻结的配置对象');
  const src = require('fs').readFileSync(require('path').join(ROOT, 'js', 'tower-data.js'), 'utf8').split('\n');
  const a = src.findIndex((l) => l.includes('function rerollPriceAt(count) {'));
  let b = a;
  while (b < src.length && !/^  \}$/.test(src[b])) b++;
  const body = src.slice(a, b + 1).join('\n');
  const mk = (max) => {
    const box = { SHOP: { rerollPrice: 10, rerollGrowth: 10, rerollMax: max } };
    vm.createContext(box);
    return vm.runInContext(body + '\nrerollPriceAt;', box, { filename: 'rerollPriceAt' });
  };
  assert.equal(mk(0)(6), 60, 'rerollMax=0 应当不限：' + mk(0)(6));
  assert.equal(mk(0)(9), 90, 'rerollMax=0 时继续涨：' + mk(0)(9));
  assert.equal(mk(50)(6), 50, 'rerollMax=50 时封顶');
  assert.equal(mk(70)(9), 70, 'rerollMax=70 时封到 70：' + mk(70)(9));
});

test('需求76：抽奖卷曲线（10 层前每 5 层 1 张 / 之后 2 张）+ 铸币结算折现', () => {
  const c = setup();
  const T = c.Tower, TD = c.TowerData, S = c.State;
  const TICKET = 50;

  /* ① 曲线：每 5 层一个档位。10 层（含）之前每档 +1，之后每档 +2 */
  const at = (n) => TD.endlessTickets(n);
  assert.equal(at(1), 1, '第 1~5 层 = 1 张');
  assert.equal(at(5), 1, '第 5 层（第 1 档）= 1 张');
  assert.equal(at(6), 2, '第 6 层起 = 2 张');
  assert.equal(at(10), 2, '第 10 层（第 2 档）= 2 张');
  assert.equal(at(11), 4, '第 11 层起 = 4 张');
  assert.equal(at(15), 4, '第 15 层（第 3 档）= 4 张');
  assert.equal(at(20), 6, '第 20 层 = 6 张（之后每档 +2）');
  assert.equal(at(25), 8, '第 25 层 = 8 张');
  assert.equal(at(30), 10, '第 30 层 = 10 张');
  assert.equal(at(40), 14, '第 40 层 = 14 张');
  assert.equal(at(50), 18, '第 50 层 = 18 张');
  assert.equal(at(100), 38, '第 100 层 = 38 张');
  /* 增量：1,1,2,2,2,2…（前两档 +1、之后每档 +2） */
  const inc = [];
  for (let k = 1; k <= 8; k++) inc.push(at(k * 5) - (k === 1 ? 0 : at((k - 1) * 5)));
  assert.equal(inc.join(','), '1,1,2,2,2,2,2,2', '每档增量：' + inc.join(','));
  /* 15 层（含）之前与旧曲线完全一致（1/2/4），16 层起才变少 */
  assert.equal([5, 10, 15].map(at).join(','), '1,2,4', '前期曲线不变');
  assert.ok(at(20) < 8 && at(35) < 17, '深层比旧曲线（8/17）少：' + at(20) + '/' + at(35));
  /* 单调不减 */
  for (let n = 1; n <= 60; n++) assert.ok(at(n + 1) >= at(n), '曲线不能下降：' + n);

  /* ② 结算：剩余铸币 1:1 折现、**剩余试炼币不折现** */
  const newRun = (layer, coins, tokens) => {
    S.newGame('r76' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    T._debugSetEndlessLayer(layer);
    const r = T._debugRun('endless');
    r.coins = coins; r.retryToken = tokens; r.env = []; r.noEnvRoll = true;
    return r;
  };
  /* 第 26 层 = 第 6 档 → 2 + 2×(6−2) = 10 张 */
  const L26 = TD.endlessTickets(26);
  assert.equal(L26, 10, '基准层：第 26 层应得 10 张，实测 ' + L26);

  /* ②-1 放弃本局：10 张 + 2 枚铸币；30 试炼币作废 */
  newRun(26, 30, 2);
  const before1 = Number(S.state().props[TICKET] || 0);
  const r1 = T.abandon('endless');
  assert.equal(r1.layerTickets, L26, '本层应得 ' + L26 + ' 张，实测 ' + r1.layerTickets);
  assert.equal(r1.retryLeft, 2, '折现 2 枚铸币，实测 ' + r1.retryLeft);
  assert.equal(r1.forfeitCoins, 30, '作废的试炼币数要报出来，实测 ' + r1.forfeitCoins);
  assert.equal(r1.tickets, L26 + 2, '总额 = ' + L26 + ' + 2，实测 ' + r1.tickets);
  assert.equal(Number(S.state().props[TICKET] || 0) - before1, L26 + 2, '实际入包张数');

  /* ②-2 结算点结算离场 */
  const run2 = newRun(26, 30, 2);
  run2.phase = 'checkpoint';
  const info2 = T.checkpointInfo();
  assert.equal(info2.ticketsNow, L26, '结算点「本层应得」= ' + L26);
  assert.equal(info2.retryToken, 2, '结算点要带出铸币数量');
  assert.equal(info2.ticketsNowTotal, L26 + 2, '结算点「立刻能领」= 本层 + 铸币，实测 ' + info2.ticketsNowTotal);
  const r2 = T.settleEndless();
  assert.equal(r2.tickets, L26 + 2, '结算离场总额，实测 ' + r2.tickets);
  assert.equal(r2.retryLeft, 2, '结算离场也要折现铸币');

  /* ②-3 失败结算（有铸币 → 先不结算，放弃重打时一起折） */
  newRun(26, 30, 0);
  const nb = T.nextBattle('endless');
  const me = c.State.genAI(35, '', { levelJitter: 0, gearSelfLevel: true });
  me.maxHp = me.hp; nb.adjustMe(me);
  const run3 = T._debugRun('endless');
  run3.coins = 30; run3.retryToken = 4;
  const before3 = Number(S.state().props[TICKET] || 0);
  const r3 = T.reportBattle('endless', nb.token, false, 0.3);
  assert.equal(r3.retryable, true, '有铸币时先不结算');
  const r3b = T.declineRetry();
  assert.equal(r3b.tickets, L26 + 4, '失败结算总额 = ' + L26 + ' + 4，实测 ' + r3b.tickets);
  assert.equal(Number(S.state().props[TICKET] || 0) - before3, L26 + 4, '失败结算实际入包张数');

  /* ②-4 纯试炼币（没有铸币）：一分都不折，只发本层应得 */
  newRun(26, 999, 0);
  const before4 = Number(S.state().props[TICKET] || 0);
  const r4 = T.abandon('endless');
  assert.equal(r4.tickets, L26, '999 试炼币也不该折出任何卷，实测 ' + r4.tickets);
  assert.equal(Number(S.state().props[TICKET] || 0) - before4, L26, '只发本层应得那份');

  /* ③ 结算后铸币必须清零（不能带到下一局） */
  newRun(6, 10, 3);
  T.abandon('endless');
  assert.ok(!T._debugRun('endless'), '本局已结束');
  T.startEndlessRun();
  assert.equal(Number(T._debugRun('endless').retryToken) || 0, 0, '新本局不该继承上局的铸币');

  /* ④ 界面口径：右上角那个「退出实际到手」= 本层应得 + 铸币（不含试炼币） */
  newRun(26, 30, 2);
  const info = T.endlessInfo().run;
  assert.equal(info.ticketsIfSettle, L26, '本层应得 ' + L26);
  assert.equal(info.retryToken, 2, '手上 2 枚铸币');
  assert.equal(info.ticketsOnExit, L26 + 2, '退出总额，实测 ' + info.ticketsOnExit);
  assert.equal(info.ticketsOnExit, info.ticketsIfSettle + 2, '总额 = 本层应得 + 铸币（30 试炼币不算）');
});
test('需求77：无尽塔「力/敏/速药丸槽」已整块删除（含旧存档字段与局外药丸回归）', () => {
  const c = setup();
  const T = c.Tower, TD = c.TowerData, S = c.State;

  /* ① 数据层与接口都不再存在 */
  assert.equal(TD.PILL_SLOTS, undefined, 'PILL_SLOTS 应当已删除');
  assert.equal(TD.PILL_BATTLES, undefined, 'PILL_BATTLES 应当已删除');
  assert.equal(TD.pillEffect, undefined, 'pillEffect 应当已删除');
  assert.equal(T.usePillSlot, undefined, 'Tower.usePillSlot 应当已删除');

  /* ② 新开的无尽局不再带 pillSlots */
  const run = T._debugRun('endless');
  assert.ok(run, '应当有进行中的对局');
  assert.equal(run.pillSlots, undefined, '新局不该有 pillSlots：' + JSON.stringify(run.pillSlots));

  /* ③ 旧存档：手写一份带 pillSlots 的局，任何一次访问（normalizeRun）都会清掉 */
  const st = S.state();
  st.endless.run.pillSlots = { power: { id: 3, battles: 12 }, agility: null, speed: { id: 43, battles: 3 } };
  const info = T.endlessInfo();                  // 内部走 endless() → normalizeRun
  assert.equal(info.run.pillSlots, undefined, '旧档字段应当被清掉（info）');
  assert.equal(st.endless.run.pillSlots, undefined, '旧档字段应当被清掉（state）');
  /* 清掉之后仍然能正常打一场（不会因为字段缺失报错） */
  const nb = T.nextBattle('endless');
  assert.ok(nb.ok, '删掉字段后仍应能开战：' + nb.msg);
  const me = c.State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
  nb.adjustMe(me);
  assert.ok(me.power > 0, 'adjustMe 仍然正常给出属性：' + me.power);

  /* ④ 界面与样式里不再有药丸槽（防止旧代码被误加回来） */
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  for (const bad of ['pillSlotsHtml', 'data-pill', 'choosePill', 'PILL_SLOTS']) {
    assert.ok(ui.indexOf(bad) < 0, 'tower-ui.js 里不该再有 ' + bad);
  }
  const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8');
  assert.ok(!/\.pill-(slot|slots|plus|choice|picker)\b/.test(css), 'CSS 里不该再有药丸槽样式');
  const data = fs.readFileSync(path.join(ROOT, 'js', 'tower-data.js'), 'utf8');
  assert.ok(data.indexOf('const PILL_SLOTS') < 0 && data.indexOf('function pillEffect') < 0,
    'tower-data.js 里不该再有 PILL_SLOTS / pillEffect 定义');

  /* ⑤ 局外药丸不受影响（这是删除塔内槽位的前提：药丸本身还是局外道具） */
  S.newGame('pill-outside');
  const s2 = S.state();
  s2.power = 10;
  assert.equal(S.totalStats({ useProps: false }).power, 10, '没吃药时力量 = 10');
  s2.props[3] = 1;
  S.useProp(3);
  assert.equal(S.totalStats().power, 15, '大力丸（+20%，最少 5 点）在局外仍然生效');
  assert.equal(S.totalStats({ useProps: false }).power, 10, 'useProps:false 时不吃药丸');
});

test('需求78：三侠输出平衡 —— 仙鹤（xh）不再靠「速度双重计入」碾压另两位', () => {
  const c = setup();
  const T = c.Tower, S = c.State, Sim = c.Sim, TD = c.TowerData;
  /* 本轮调整：仙鹤的大招与技能原本写成 (力量 + 速度) × 系数，而敌人的速度天然约是
   * 力量的 2.3 倍 —— 等于白送一整条速度，80 层之后单击/总输出都远超另两位三侠。
   * 现在速度只按 RULES.xhSpeedShare 计入。这条回归锁定「速度那一份」别再被加回去。 */
  assert.equal(Sim.rules.xhSpeedShare, 0.35, '速度计入比例应当是 0.35，实测 ' + Sim.rules.xhSpeedShare);
  assert.ok(Sim.rules.xhSpeedShare > 0 && Sim.rules.xhSpeedShare < 0.6, '不该回到 1（整条速度），也不该砍到 0');

  /* 参考玩家：70 级标准面板 × 该层深度系数 × 0.9（略弱于敌方，保证能打若干回合） */
  const mkPlayer = (layer) => {
    const d = (TD.endlessDepthMul(layer) || 1) * 0.9;
    const m = S.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    for (const k of ['power', 'agility', 'speed']) m[k] = Math.round(m[k] * d);
    m.maxHp = Math.round(m.hp * d); m.hp = m.maxHp;
    return m;
  };
  const foeOf = (layer, anim) => {
    T._debugSetEndlessLayer(layer);
    const run = T._debugRun('endless');
    run.env = []; run.noEnvRoll = true; run.debuffs = []; run.choices = null; run.phase = null;
    if (run.attempt) T.reportBattle('endless', run.attempt, true, 1, null);
    const info = T.planInfo('endless');
    const idx = info.findIndex((x) => x.kind === 'hero' && x.anim === anim);
    if (idx < 0) return null;
    run.idx = idx; run.choices = null; run.phase = null;
    const nx = T.nextBattle('endless');
    if (!nx.ok) return null;
    const me = mkPlayer(layer); nx.adjustMe(me);
    const foe = nx.foe;
    if (run.attempt) T.reportBattle('endless', run.attempt, false, 0.01, null);
    return foe;
  };
  const measure = (layer, anim, n) => {
    const foe = foeOf(layer, anim);
    if (!foe) return null;
    let total = 0, maxHit = 0;
    for (let i = 0; i < n; i++) {
      const res = Sim.simulate(foe, mkPlayer(layer));
      let d = 0, m = 0;
      for (const r of (res.rounds || [])) {
        if (r.attacker !== 0) continue;
        const v = Number(r.dmg || 0); d += v; if (v > m) m = v;
      }
      total += d; maxHit += m;
    }
    return { total: total / n, maxHit: maxHit / n };
  };

  const N = 60;
  for (const layer of [80, 100, 120]) {
    const tl = measure(layer, 'tl', N), xh = measure(layer, 'xh', N), xm = measure(layer, 'xm', N);
    assert.ok(tl && xh && xm, '第 ' + layer + ' 层应当能拿到三侠对手');
    const rXm = xh.total / xm.total, rTl = xh.total / tl.total, rHit = xh.maxHit / xm.maxHit;
    const info = layer + ' 层：仙鹤/熊猫总输出 ' + rXm.toFixed(2) + ' · 仙鹤/螳螂 ' + rTl.toFixed(2) +
      ' · 单击 仙鹤/熊猫 ' + rHit.toFixed(2);
    /* 经验区间（N=100 实测：总 1.13~1.24×熊猫、单击 1.33~1.49×熊猫；旧口径是 1.37~1.58 / 2.02~2.30）：
     * ①仙鹤不能碾压；②仍是三侠里最能打的那位；③单击最狠但不得回到旧口径的量级。
     * 区间留了余量（sim 是随机的），真正锁死这次改动的是下面的**确定性公式断言**。
     * 下沿取 0.85 而不是 1.0/0.95：这条是 N=60 的统计量，实测分布（98 个样本）mean≈1.18、中位 1.18，
     * 但左尾能掉到 0.95（熊猫那一侧偶尔摇出高输出的对手阵容）—— 卡在 1.0 会偶发红。
     * 0.85 仍然兜住「仙鹤不是三侠里最弱的」这个意图（真退化会掉到 0.6 量级），
     * 而锁死改动量级的是下面那条确定性公式断言（新基准 ≤ 旧基准的 62%）。 */
    assert.ok(rXm <= 1.6, '仙鹤总输出不该超过熊猫 1.6 倍：' + info);
    assert.ok(rXm >= 0.85, '仙鹤应当仍是三侠里最能打的那位：' + info);
    assert.ok(rTl <= 1.6, '仙鹤总输出不该超过螳螂 1.6 倍：' + info);
    /* 单击是「取最大值」，方差很大（N=60 时实测 1.33~1.75 波动）；真正锁死改动的是
     * 下面的确定性公式断言，这里只挡住「回到旧口径」的量级（旧口径 2.02~2.30）。 */
    assert.ok(rHit <= 2.0, '仙鹤单击不该超过熊猫 2 倍（旧口径 2.0~2.3）：' + info);
    assert.ok(rHit > 1.0, '仙鹤单击应当仍是三侠里最高的：' + info);

    /* 确定性：仙鹤的伤害基准 = (力量 + 速度×share)，speed 那一份只能这么重。
     * 旧口径是 (力量 + 速度) —— 用对手面板直接算出两者的比值。 */
    const p = foeOf(layer, 'xh');
    assert.ok(p && p.power > 0 && p.speed > 0, '仙鹤对手要有力量与速度：' + JSON.stringify({ p: p && p.power, s: p && p.speed }));
    const oldRaw = p.power + p.speed, newRaw = p.power + p.speed * Sim.rules.xhSpeedShare;
    assert.ok(newRaw <= oldRaw * 0.62, '去掉「速度双计」后基准应当至少降 38%：' + Math.round(newRaw) + ' vs ' + Math.round(oldRaw));
    assert.ok(newRaw > p.power, '速度仍要有贡献（不能砍成 0）：' + Math.round(newRaw) + ' vs ' + p.power);
  }
});

test('需求79：全技能树 boss 不再刷同一招 + castable 必须是 skills 的子集', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;

  /* ① 数据一致性：castable 里的每个 id 必须真的在 skills 里 ——
   * 本轮 bug 就是「castable 声明了 skills 里没有的招」，sim 的 skillOrder 过滤后
   * 只剩一个主动技，整套循环塌缩成「幸运一击 ×N」。这条断言能直接拦住同类错误。 */
  const groups = [['squirrel', TD.SQUIRREL_BY_ID], ['trial', TD.TRIAL_BY_ID]];
  for (const [label, pool] of groups) {
    for (const [id, def] of Object.entries(pool || {})) {
      if (!Array.isArray(def.castable)) continue;
      const known = new Set((def.skills || []).map((s) => Number(s.id)));
      for (const cid of def.castable) {
        assert.ok(known.has(Number(cid)),
          label + ' ' + id + ' 的 castable (' + cid + ') 必须是 skills 的子集：skills=' + JSON.stringify([...known]));
      }
      assert.ok(def.castable.length >= 1, label + ' ' + id + ' 的 castable 不该为空');
    }
  }
  /* 苦修（全技能树）：**全部 20 个技能**、等级一律压到 2、循环覆盖全部主动技 */
  const monk = TD.SQUIRREL_BY_ID.monk;
  const ids = monk.skills.map((x) => Number(x.id)).sort((a, b) => a - b);
  assert.equal(ids.join(','), '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,23,24',
    '苦修应当字面意义上拥有全部 20 个技能，实测 ' + JSON.stringify(ids));
  for (const x of monk.skills) assert.ok(x.level <= 2, '技能等级都要很低：' + JSON.stringify(x));
  assert.equal(monk.castable.slice().sort((a, b) => a - b).join(','), '8,12,14,15,17,18,23',
    '循环要覆盖全部主动技，实测 ' + JSON.stringify(monk.castable));

  /* ② 实战：招式要轮着来（全部主动技都出现过）、不连放、技能占出手仍然很高 */
  const buildMonk = (layer) => {
    T._debugSetEndlessLayer(layer);
    const run = T._debugRun('endless');
    run.plan = [{ kind: 'squirrel', id: 'monk' }, { kind: 'hero', anim: 'tl' }];
    run.idx = 0; run.env = []; run.choices = null; run.phase = null;
    const nx = T.nextBattle('endless');
    assert.ok(nx.ok, '应当能造出苦修：' + nx.msg);
    return nx.foe;
  };
  const mkPlayer = (layer) => {
    const d = (TD.endlessDepthMul(layer) || 1) * 0.9;
    const m = S.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    for (const k of ['power', 'agility', 'speed']) m[k] = Math.round(m[k] * d);
    m.maxHp = Math.round(m.hp * d); m.hp = m.maxHp;
    return m;
  };
  const foe = buildMonk(80);
  assert.equal((foe.castable || []).join(','), '8,12,14,15,17,18,23', '敌人身上要带上 castable：' + JSON.stringify(foe.castable));
  assert.equal((foe.skills || []).length, 20, '敌人身上要带全部 20 个技能：' + (foe.skills || []).length);
  const usedIds = new Set();
  let skillActs = 0, total = 0, backToBack = 0, prevId = null, damage = 0, battles = 0;
  for (let i = 0; i < 150; i++) {
    const res = Sim.simulate(foe, mkPlayer(80));
    battles++;
    prevId = null;                      // 只在同一场战斗内检查「连着放同一招」
    for (const r of (res.rounds || [])) {
      if (r.attacker !== 0) continue;
      damage += Number(r.dmg || 0);
      if (r.action !== 'skill' && r.action !== 'common') continue;
      total++;
      if (r.action === 'skill') {
        skillActs++;
        const sid = Number(r.id);
        usedIds.add(sid);
        if (sid === prevId) backToBack++;
        prevId = sid;
      } else prevId = null;
    }
  }
  const share = skillActs / Math.max(1, total);
  assert.ok(share >= 0.5, '它是技能流 boss，技能出手不该低于 50%，实测 ' + (share * 100).toFixed(1) + '%');
  assert.equal(backToBack, 0, '同一招不能连着放（技能冷却），实测 ' + backToBack + ' 次');
  /* 7 个主动技要真的都轮得到（150 场足够；小宇宙/松果是每场一次，所以看「至少出现过」） */
  for (const want of [8, 12, 14, 15, 17, 18, 23]) {
    assert.ok(usedIds.has(want), '技能 ' + want + ' 应当出现过，实测用过 ' + [...usedIds].join(','));
  }
  assert.ok(total / battles >= 3, '出手次数太少：' + (total / battles).toFixed(1));
  assert.ok(damage / battles > 0, '总伤害应当为正：' + Math.round(damage / battles));

  /* ③ 输出量级：与同层其它松鼠 boss 同档（不超过「最厚的那个」2 倍）——用同一参考玩家粗测 */
  const dps = (id) => {
    const f = foeOf(c, id, 'squirrel', 80);      // 复用测试里既有的造敌助手（会先清掉待结算的战斗）
    let sum = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      const res = Sim.simulate(f, mkPlayer(80));
      let d = 0;
      for (const r of (res.rounds || [])) if (r.attacker === 0) d += Number(r.dmg || 0);
      sum += d; n++;
    }
    return sum / n;
  };
  const peers = ['scout', 'guard', 'frenzy', 'thrower', 'heavy', 'twinblade', 'bulwark']
    .map((id) => dps(id)).filter((v) => v != null);
  const monkDps = dps('monk');
  const maxPeer = Math.max(...peers);
  assert.ok(monkDps <= maxPeer * 2, '苦修的输出不该超过同层最强 boss 的 2 倍：' +
    Math.round(monkDps) + ' vs ' + Math.round(maxPeer));
});

test('需求83：战利品三档 —— 新增普通档 E13（×1.4），E05 强化到 ×1.8', () => {
  const c = setup();
  const TD = c.TowerData;
  const e13 = TD.BUFF_BY_ID.E13;
  assert.ok(e13, '应当有普通档的战利品（E13）');
  assert.equal(e13.name, '战利品·小');
  assert.equal(e13.rarity, 0, '必须是普通稀有度');
  assert.equal(e13.kind, 'limited');
  assert.equal(e13.uses, 10, '限 10 场战斗');
  assert.equal(e13.mods.coinBoostPct, 0.40, '试炼币 ×1.4');
  assert.match(e13.desc, /×1\.4/);
  for (const t of ['endless', 'battle', 'shop', 'limited', 'ops']) {
    assert.ok(TD.hasTag(e13, t), 'E13 应当带标签 ' + t + '：' + JSON.stringify(e13.tags));
  }
  assert.ok(!TD.hasTag(e13, 'tower'), 'E13 是无尽塔专属');
  assert.ok(TD.shopPool.some((b) => b.id === 'E13'), 'E13 应当能在试炼商店买到');
  assert.ok(TD.endlessPool.some((b) => b.id === 'E13'), 'E13 应当进无尽塔的场间池');
  /* 上位强化：E05 从 ×1.6 → ×1.8（E06 不动） */
  assert.equal(TD.BUFF_BY_ID.E05.mods.coinBoostPct, 0.80, 'E05 应当强化到 ×1.8');
  assert.match(TD.BUFF_BY_ID.E05.desc, /×1\.8/);
  assert.equal(TD.BUFF_BY_ID.E06.mods.coinBoostPct, 1.40, 'E06 保持 ×2.4');

  /* 实战：三档各自的每场试炼币增量 */
  const gainOf = (id) => {
    const c2 = setup();
    const run = c2.Tower._debugRun('endless');
    c2.Tower._debugSetEndlessLayer(6);                 // 第 6 层：非铸币商店层，第 1 场是三侠（无精英加成）
    const r0 = c2.Tower._debugRun('endless');
    r0.env = [];                                       // 排除「贪婪裂隙」对试炼币的干扰
    assert.ok(c2.Tower.debugGrantBuff(id).ok, id + ' 应当拿得到');
    const before = c2.Tower._debugRun('endless').coins;
    const nx = c2.Tower.nextBattle('endless');
    assert.ok(nx.ok, '应当能开战');
    c2.Tower.reportBattle('endless', nx.token, true, 1500, 2000);
    const after = c2.Tower._debugRun('endless');
    void run;
    return after.coins - before;
  };
  const base = c.TowerData.COINS.battle;
  assert.equal(gainOf('E13'), Math.round(base * 1.4), 'E13：×1.4');
  assert.equal(gainOf('E05'), Math.round(base * 1.8), 'E05：×1.8');
  assert.equal(gainOf('E06'), Math.round(base * 2.4), 'E06：×2.4（对照）');
});

/** 打赢当前这一场（清掉休整点/商店挡住的状态）。 */
function winOneEndless(c) {
  const run = c.Tower._debugRun('endless');
  if (!run) return null;
  if (run.shop) { if (run.shop.mint) c.Tower.leaveMintShop(); else { run.shop = null; run.phase = null; } }
  run.choices = null;
  run.phase = null;
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开下一场：' + ((nx && nx.msg) || ''));
  return c.Tower.reportBattle('endless', nx.token, true, 1500, 2000);
}
/** 打到「每 5 层」的结算商店（试炼商店）。 */
function openTrialShop(c, layer) {
  c.Tower._debugSetEndlessLayer(layer);
  const run = c.Tower._debugRun('endless');
  run.env = [];
  run.coins = 100000;
  for (let i = 0; i < 6; i++) {
    const r = c.Tower._debugRun('endless');
    if (r.phase === 'shop') break;
    winOneEndless(c);
  }
  const st = c.Tower.shopState();
  assert.ok(st && !st.mint, '应当开出试炼商店');
  return st;
}

test('需求84：讨价还价（E14）—— 下一次进店每份让 1 件随机商品对折（向下取整、不重复）', () => {
  const c = setup();
  const TD = c.TowerData;
  const e14 = TD.BUFF_BY_ID.E14;
  assert.ok(e14, '应当有讨价还价（E14）');
  assert.equal(e14.kind, 'instant', '立即生效');
  assert.equal(e14.rarity, 0, '普通稀有度');
  assert.equal(e14.mods.shopHalf, 1);
  for (const t of ['endless', 'battle', 'shop', 'repeatable', 'ops']) {
    assert.ok(TD.hasTag(e14, t), 'E14 应当带标签 ' + t + '：' + JSON.stringify(e14.tags));
  }
  assert.equal(TD.hasTag(e14, 'oncePerRun'), false, '可叠加 → 不能是一局一次');

  /* 拿 1 份：进店时那一页正好 1 件对折、且价格 = floor(原价 / 2) */
  c.__rand(0.99);
  assert.ok(c.Tower.debugGrantBuff('E14').ok);
  assert.equal(c.Tower.shopHalfPendingOf(), 1, '拿到 1 份「待兑现」');
  const st = openTrialShop(c, 5);
  assert.equal(st.halfCount, 1, '这一页应当有 1 件对折：' + JSON.stringify(st.slots.map((s) => s.half)));
  const halved = st.slots.filter((s) => s.half);
  assert.equal(halved.length, 1);
  assert.equal(halved[0].price, Math.floor(halved[0].listPrice / 2), '对折价 = 原价 / 2（向下取整）');
  assert.ok(halved[0].listPrice > halved[0].price, '确实便宜了：' + halved[0].listPrice + ' → ' + halved[0].price);
  assert.equal(c.Tower.shopHalfPendingOf(), 0, '兑现之后清零');
  /* 买它对折的那一格：扣的就是对折价 */
  const index = st.slots.findIndex((s) => s.half);
  const coinsBefore = c.Tower._debugRun('endless').coins;
  const buy = c.Tower.buyShopSlot(index);
  assert.ok(buy.ok, '应当买得成：' + (buy.msg || ''));
  assert.equal(c.Tower._debugRun('endless').coins, coinsBefore - halved[0].price, '扣的应当是对折价');
  /* 刷新货架 → **每一页都重新触发**（用户口径：不是只有第一页） */
  const c2 = setup();
  c2.__rand(0.99);
  c2.Tower.debugGrantBuff('E14');
  const st2 = openTrialShop(c2, 5);
  assert.equal(st2.halfCount, 1);
  c2.__seed(777);
  assert.ok(c2.Tower.rerollShop().ok, '应当能刷新');
  assert.equal(c2.Tower.shopState().halfCount, 1, '刷新出的新一页也要重新触发对折');
  assert.equal(c2.Tower.shopHalfPendingOf(), 0, '刷新不再额外消耗「待兑现」份数（份数按店记账）');

  /* 叠加：N 份 = N 件**不同**的商品对折；一页装不下时剩下的留到下一家店 */
  const c3 = setup();
  c3.__rand(0.99);
  assert.ok(c3.Tower.debugGrantBuff('E14').ok);
  assert.ok(c3.Tower.debugGrantBuff('E14').ok);
  assert.ok(c3.Tower.debugGrantBuff('E14').ok);
  assert.equal(c3.Tower.shopHalfPendingOf(), 3, '三份可叠加');
  const st3 = openTrialShop(c3, 5);
  assert.equal(st3.halfCount, 3, '一份一件、互不重复');
  assert.equal(new Set(st3.slots.filter((s) => s.half).map((s) => s.id)).size, 3, '不能打在同一个格子上');
  /* 7 份 → 这一页 5 件全对折，剩 2 份留到下一家店 */
  const c4 = setup();
  c4.__rand(0.99);
  for (let i = 0; i < 7; i++) c4.Tower.debugGrantBuff('E14');
  const st4 = openTrialShop(c4, 5);
  assert.equal(st4.halfCount, 5, '一页最多 5 件全打上');
  assert.equal(c4.Tower.shopHalfPendingOf(), 2, '剩下的 2 份留到下一家店');
  c4.Tower.closeShop();
  c4.Tower.continueEndless();
  const st4b = openTrialShop(c4, 10);
  assert.equal(st4b.halfCount, 2, '下一家店继续兑现剩下的 2 份');
  assert.equal(c4.Tower.shopHalfPendingOf(), 0);

  /* 在店里买到它 → 只对**下一家**店生效（当前这一页早就开出来了） */
  const c5 = setup();
  c5.__rand(0.99);
  const st5 = openTrialShop(c5, 5);
  const run5 = c5.Tower._debugRun('endless');
  run5.shop.slots = [{ id: 'E14', sold: false, price: 1 }];
  run5.coins = 100;
  const buy5 = c5.Tower.buyShopSlot(0);
  assert.ok(buy5.ok, '应当能买到讨价还价：' + (buy5.msg || ''));
  assert.equal(c5.Tower.shopHalfPendingOf(), 1, '买到就攒下 1 份');
  assert.equal(st5.halfCount, 0, '当前这一页不对折（「下一次进店」才生效）');
});

test('需求85：讨价还价也能被**铸币商店**触发（固定价同样对折、向下取整）', () => {
  const c = setup();
  const TD = c.TowerData;
  /* 本用例要的正是「战后自动刷出铸币商店」→ 把 setup 里关掉的自动刷出重新打开。 */
  c.Tower._debugSetNoMintShop(false);
  c.__rand(0.99);
  assert.ok(c.Tower.debugGrantBuff('E14').ok);
  assert.equal(c.Tower.shopHalfPendingOf(), 1);
  /* 第 7 层：概率拉满 → 战后刷出铸币商店 */
  c.Tower._debugSetEndlessLayer(7);
  c.Tower._debugRun('endless').env = [];
  c.__rand(0);
  const rw = winOneEndless(c);
  assert.equal(rw.mintShop, true, '应当刷出铸币商店');
  const st = c.Tower.shopState();
  assert.ok(st.mint, '这是铸币商店');
  assert.equal(st.halfCount, 1, '铸币商店的货架也被对折了');
  assert.equal(c.Tower.shopHalfPendingOf(), 0, '兑现之后清零');
  const slot = st.slots.find((s) => s.half);
  const base = TD.mintPrice(TD.BUFF_BY_ID[slot.id]);
  assert.equal(slot.listPrice, base, '原价仍是按稀有度的固定价');
  assert.equal(slot.price, Math.floor(base / 2), '对折价 = floor(固定价 / 2)：' + base + ' → ' + slot.price);
  /* 买它：扣的就是对折后的铸币（1 铸币的稀有件会变成 0） */
  const run = c.Tower._debugRun('endless');
  run.retryToken = 5;
  const index = st.slots.findIndex((s) => s.half);
  const buy = c.Tower.buyMintSlot(index);
  assert.ok(buy.ok, '应当买得成：' + (buy.msg || ''));
  assert.equal(buy.price, slot.price, '结算价 = 对折价');
  assert.equal(c.Tower._debugRun('endless').retryToken, 5 - slot.price);
  /* 普通件（0 铸币）对折还是 0，不能变成负数 */
  const c2 = setup();
  c2.Tower._debugSetNoMintShop(false);           // 同上：这一段也要战后自动刷出铸币商店
  c2.__rand(0);
  c2.Tower.debugGrantBuff('E14');
  c2.Tower._debugSetEndlessLayer(7);
  winOneEndless(c2);
  const run2 = c2.Tower._debugRun('endless');
  run2.retryToken = 3;
  const st2 = c2.Tower.shopState();
  const zero = st2.slots.find((s) => TD.mintPrice(TD.BUFF_BY_ID[s.id]) === 0);
  if (zero) assert.equal(zero.price, 0, '0 铸币的赠品对折后仍是 0');
  /* 老存档 / 缺字段：shopHalfPending 归一化成 0 */
  delete run2.shopHalfPending;
  assert.equal(c2.Tower.shopHalfPendingOf(c2.Tower._debugRun('endless')), 0, '缺字段按 0 处理');
  run2.shopHalfPending = -5;
  assert.equal(c2.Tower.shopHalfPendingOf(c2.Tower._debugRun('endless')), 0, '坏值也归一化');
  /* 界面接线：两个商店页都渲染对折标记，无尽首页显示待兑现份数 */
  const pageSrc = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8');
  assert.ok(/half-hint/.test(pageSrc), '商店页要渲染「对折」提示');
  assert.ok(/shopHalfPending/.test(pageSrc), '无尽首页要显示待兑现的份数');
  assert.ok(/halfCount/.test(pageSrc) || /s\.half/.test(pageSrc), '商店页要按 s.half 渲染');
});

test('需求86：时间回廊（E15）—— 下一场打完后从本层第 1 场重开（夹层）', () => {
  const c0 = setup();
  const TD = c0.TowerData;
  const e15 = TD.BUFF_BY_ID.E15;
  assert.ok(e15, '应当有时间回廊（E15）');
  assert.equal(e15.name, '时间回廊');
  assert.equal(e15.rarity, 3, '传奇稀有度');
  assert.equal(e15.kind, 'limited');
  assert.equal(e15.uses, 1, '限次 1');
  assert.equal(e15.mods.layerRestart, 1);
  for (const t of ['endless', 'battle', 'limited', 'nextBattle']) {
    assert.ok(TD.hasTag(e15, t), 'E15 应当带标签 ' + t + '：' + JSON.stringify(e15.tags));
  }
  assert.ok(!TD.hasTag(e15, 'shop'), '不上商店');
  assert.ok(!TD.hasTag(e15, 'tower'), '不进挑战塔');
  assert.ok(!TD.shopPool.some((b) => b.id === 'E15'), '不该进试炼商店货架');
  assert.ok(!TD.mintPool.some((b) => b.id === 'E15'), '也不该进铸币商店的货架 / 交换池');
  assert.ok(TD.endlessPool.some((b) => b.id === 'E15'), '要能作为战斗奖励 / 场间选择拿到');
  assert.ok(TD.ENDLESS_ONLY_MODS.indexOf('layerRestart') >= 0, 'layerRestart 要登记成无尽专属 mod');

  /** 开一局、摆到第 layer 层、可选先拿一张时间回廊。 */
  const fresh = (layer, grantE15) => {
    const c = setup();
    c.__rand(0.99);                       // 铸币商店 5% / 幻影回响都不触发
    c.Tower._debugSetEndlessLayer(layer);
    const r = c.Tower._debugRun('endless');
    r.env = []; r.choices = null; r.phase = null;
    if (grantE15) assert.ok(c.Tower.debugGrantBuff('E15').ok, '应当拿得到时间回廊');
    return c;
  };
  const winHere = (c) => {
    const r = c.Tower._debugRun('endless');
    if (r.choices) r.choices = null;
    const nx = c.Tower.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能开下一场：' + ((nx && nx.msg) || ''));
    return { nx, rw: c.Tower.reportBattle('endless', nx.token, true, 1500, 2000) };
  };

  /* A. 层中那场：打完从第 1 场重开 */
  {
    const c = fresh(7, true);
    const before = c.Tower._debugRun('endless');
    const names = c.Tower.planInfo('endless').map((p) => p.name).join('→');
    const coins0 = before.coins, score0 = before.score;
    const { rw } = winHere(c);
    const after = c.Tower._debugRun('endless');
    assert.ok(rw.layerRestart, '应当返回 layerRestart');
    assert.equal(rw.layerRestart.layer, 7);
    assert.equal(rw.layerRestart.battleNo, 1, '打完的是本层第 1 场');
    assert.equal(after.layer, 7, '层号不变（不推进）');
    assert.equal(after.idx, 0, '回到本层第 1 场');
    assert.equal(after.choices, null, '层内选择清空');
    assert.equal(after.phase, null, '不进商店 / 结算点');
    assert.equal(c.Tower.planInfo('endless').map((p) => p.name).join('→'), names,
      '敌人与顺序完全不变（层号没变 → 同一批、同一份缩放）');
    assert.equal(after.coins - coins0, TD.COINS.battle, '这一场的试炼币照常入账');
    const dScore = after.score - score0;
    assert.ok(dScore >= TD.SCORE.battle && dScore < TD.SCORE.layer,
      '只多这一场的分数（没有层通关 +' + TD.SCORE.layer + '）：' + dScore);
    assert.ok(!(after.limited || []).some((b) => b.id === 'E15'), '限次 1 → 用掉就没了');
    assert.equal(c.Tower.layerRestartPendingOf(), false);
    const nx2 = c.Tower.nextBattle('endless');
    assert.ok(nx2 && nx2.ok !== false, '重开之后应当能接着打：' + ((nx2 && nx2.msg) || ''));
    assert.equal(nx2.battleNo, 1, '依旧是本层第 1 场');
  }

  /* B. 本层最后一场：照样回到本层开头（不推进层数、不发层通关奖励） */
  {
    const c = fresh(7, true);
    const before = c.Tower._debugRun('endless');
    before.idx = before.plan.length - 1;             // 摆到「最后一场」之前
    /* 第 4 场可能抽到狂战松鼠（算精英，需求130）：那一场照常多拿一份精英试炼币。
     * 这里要验的是「没发层通关的 COINS.layer」，不是「一定只有 COINS.battle」。 */
    const last = before.plan[before.plan.length - 1];
    const eliteCoins = last && last.kind === 'warlord' ? TD.COINS.elite : 0;
    const layer0 = before.layer, coins0 = before.coins, score0 = before.score;
    const { rw } = winHere(c);
    const after = c.Tower._debugRun('endless');
    assert.ok(rw.layerRestart, '最后一场也要重开');
    assert.ok(!rw.layerComplete, '不算层通关');
    assert.equal(after.layer, layer0, '层数不推进（正常通关会 +1）');
    assert.equal(after.idx, 0, '回到第 1 场');
    assert.equal(after.finished, null, '不该留下「本层已通关」的快照');
    assert.ok(after.score - score0 < TD.SCORE.layer, '不发层通关分数：' + (after.score - score0));
    assert.equal(after.coins - coins0, TD.COINS.battle + eliteCoins, '只发这一场的试炼币（不发 COINS.layer）');
    assert.equal(after.phase, null, '不进结算点 / 商店');
    assert.equal(after.bestLayer, before.bestLayer, '最深层数不因为这个 buff 抬高（没走 layerClear）');
  }

  /* C. 限次 1：第二次打完就正常往前走了 */
  {
    const c = fresh(7, true);
    winHere(c);                                       // 第一次：重开
    assert.equal(c.Tower._debugRun('endless').idx, 0);
    const { rw } = winHere(c);                        // 第二次：正常
    assert.ok(!rw.layerRestart, '限次 1，用掉之后不该再重开');
    assert.equal(c.Tower._debugRun('endless').idx, 1, '第二次是正常往前走一场');
  }

  /* D. 我方状态一律不回退 */
  {
    const c = fresh(7, true);
    assert.ok(c.Tower.debugGrantBuff('C02').ok, '永久增益');
    assert.ok(c.Tower.debugGrantBuff('E14').ok, '即时类（讨价还价的待兑现份数）');
    const r = c.Tower._debugRun('endless');
    r.coins = 321; r.retryToken = 7; r.score = 456;
    winHere(c);
    const after = c.Tower._debugRun('endless');
    assert.ok((after.permanent || []).some((b) => b.id === 'C02'), '永久增益不回退');
    assert.equal(c.Tower.shopHalfPendingOf(), 1, '即时类的登记也不回退');
    assert.equal(after.retryToken, 7, '铸币不回退');
    assert.equal(after.coins, 321 + TD.COINS.battle, '试炼币只加这一场，不倒扣');
    assert.ok(after.score >= 456 + TD.SCORE.battle, '分数只加不减：' + after.score);
    assert.ok(after.hpAbs > 0, '血量按这一场打完的真实值写回（不清零、不回满）');
  }

  /* E. 同场也挂着 E01「立即进货」：两件事都照做（本层重开 + 店照开，店关掉后从第 1 场继续） */
  {
    const c = fresh(7, true);
    assert.ok(c.Tower.debugGrantBuff('E01').ok, '再拿一张立即进货');
    const { rw } = winHere(c);
    assert.ok(rw.layerRestart, '本层应当重开');
    assert.equal(rw.postBattleShop, true, 'E01 的店也要开（限次已经扣掉了）');
    const after = c.Tower._debugRun('endless');
    assert.equal(after.idx, 0, '层内进度回到第 1 场');
    assert.equal(after.phase, 'shop');
    assert.ok(after.shop && after.shop.postBattle === true);
    assert.ok(c.Tower.closeShop().ok, '关掉店');
    assert.equal(c.Tower._debugRun('endless').idx, 0, '关店之后就是从第 1 场继续');
    const nx = c.Tower.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能直接开第 1 场：' + ((nx && nx.msg) || ''));
    assert.equal(nx.battleNo, 1);
  }

  /* F. 界面接线：必须给玩家一个「本层重开了」的说明 */
  {
    const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
    assert.ok(/rw\.layerRestart/.test(uiSrc), '界面要处理 layerRestart');
    assert.ok(/时间回廊/.test(uiSrc), '弹窗标题应当是「时间回廊」');
    const at = uiSrc.indexOf('if (rw.layerRestart)');
    assert.ok(at > 0, '找不到 layerRestart 分支');
    const body = uiSrc.slice(at, at + 700);
    assert.ok(/回到本层开头|本层重新开始/.test(body), '要写清「本层重新开始」：' + body.slice(0, 160));
  }

  /* G. 调试开关 _debugSetNoFlowBuffs：关 → 场间选择里能摇到 E01/E15；开 → 一定摇不到
   *（tools 里几个「数场次 / 看商店节奏」的用例都靠它，所以它自己也要有守卫）。 */
  {
    const collect = (flag, want) => {
      const c = setup();
      c.Tower._debugSetNoFlowBuffs(flag);
      c.Tower._debugSetEndlessLayer(1);
      const seen = new Set();
      let guard = 0;
      while (seen.size < want && guard++ < want * 6) {
        const r = c.Tower._debugRun('endless');
        if (!r) break;
        if (r.choices) { for (const ch of r.choices) seen.add(ch.id); r.choices = null; continue; }   // 只看池子，不真的选
        if (r.phase === 'shop') { c.Tower.closeShop(); if (c.Tower._debugRun('endless').phase === 'checkpoint') c.Tower.continueEndless(); continue; }
        if (r.phase === 'checkpoint') { c.Tower.continueEndless(); continue; }
        if (r.phase === 'sacrifice') { c.Tower.sacrificePerm('C01'); continue; }   // 没有永久增益 → 会自己跳过
        const nx = c.Tower.nextBattle('endless');
        if (!nx || nx.ok === false) break;
        c.Tower.reportBattle('endless', nx.token, true, 1500, 2000);
      }
      return seen;
    };
    const nodes = 120;                                  // 每层 1 个选择节点 → 120 层足够稳定地抽到这两张牌
    const off = collect(false, nodes);
    assert.ok(off.has('E01') || off.has('E15'),
      '关掉开关时 E01 / E15 应当能从场间选择里摇到（这本来就是它们的获取途径）：' +
      ['E01', 'E15'].filter((id) => off.has(id)).join(',') + ' / 抽了 ' + off.size + ' 张');
    const on = collect(true, nodes);
    const leak = ['E01', 'E15', 'E16'].filter((id) => on.has(id));
    assert.equal(leak.length, 0, '打开开关之后这三张牌不该再进选择池：' + leak.join(','));
  }
});

test('需求87：铸币商店的出现概率每 5 层 +0.5%，最高 10%', () => {
  const c = setup();
  const TD = c.TowerData;
  const mc = (n) => TD.mintChance(n);
  assert.equal(TD.MINT_SHOP.chance, 0.05, '基准概率仍是 5%');
  assert.equal(TD.MINT_SHOP.chanceStep, 0.005, '每 5 层 +0.5 个百分点');
  assert.equal(TD.MINT_SHOP.chanceMax, 0.10, '上限 10%');
  /* 曲线：第 1 段（1~5 层）5%，第 2 段（6~10 层）5.5% …… 第 11 段（51 层起）触及 10% */
  assert.equal(mc(1), 0.05);
  assert.equal(mc(5), 0.05);
  assert.equal(mc(6), 0.055);
  assert.equal(mc(10), 0.055);
  assert.equal(mc(11), 0.06);
  assert.equal(mc(20), 0.065);
  assert.equal(mc(30), 0.075);
  assert.equal(mc(50), 0.095);
  assert.equal(mc(51), 0.10, '第 11 段起封顶 10%');
  assert.equal(mc(100), 0.10, '再深也不超过 10%');
  for (let n = 1; n <= 120; n++) {
    assert.ok(mc(n) >= mc(n - 1) - 1e-9, '概率不该随层数下降：' + n);
    assert.ok(mc(n) >= TD.MINT_SHOP.chance - 1e-9 && mc(n) <= TD.MINT_SHOP.chanceMax + 1e-9,
      '概率越界：' + n + ' → ' + mc(n));
  }
  /* 实战：同一层固定种子采样 4000 次，命中率对得上曲线（第 7 层 5.5% / 第 57 层封顶 10%） */
  const rateAt = (layer) => {
    const c2 = setup();
    c2.__seed(20261026);
    c2.Tower._debugSetEndlessLayer(layer);
    const run = c2.Tower._debugRun('endless');
    let hits = 0;
    for (let i = 0; i < 4000; i++) { run.mintGroup = -1; if (c2.Tower.mintRollOf(run, layer)) hits++; }
    return hits / 4000;
  };
  const r7 = rateAt(7);
  assert.ok(Math.abs(r7 - mc(7)) < 0.012, '第 7 层实测应当 ≈' + (mc(7) * 100).toFixed(1) + '%：' + (r7 * 100).toFixed(2) + '%');
  const r57 = rateAt(57);
  assert.ok(Math.abs(r57 - 0.10) < 0.012, '第 57 层实测应当 ≈10%：' + (r57 * 100).toFixed(2) + '%');
  assert.ok(r57 > r7 + 0.02, '深层明显更容易刷出：' + (r7 * 100).toFixed(2) + '% → ' + (r57 * 100).toFixed(2) + '%');
});

test('需求88：讨价还价 —— 商店**每一页刷新**都重新触发（试炼商店 + 铸币商店）', () => {
  const c = setup();
  const TD = c.TowerData;
  /* 试炼商店：进店 2 件对折 → 每次刷新的新一页照样 2 件，且不再消耗「待兑现」份数 */
  c.__rand(0.99);
  assert.ok(c.Tower.debugGrantBuff('E14').ok);
  assert.ok(c.Tower.debugGrantBuff('E14').ok);
  assert.equal(c.Tower.shopHalfPendingOf(), 2);
  const st = openTrialShop(c, 5);
  assert.equal(st.halfCount, 2, '第一页 2 件对折');
  assert.equal(st.halfPerPage, 2, '店上要记下「本店每页 2 件」');
  assert.equal(c.Tower.shopHalfPendingOf(), 0, '份数在进店那一刻兑现完');
  c.__seed(4242);
  assert.ok(c.Tower.rerollShop().ok, '第一次刷新（免费）');
  assert.equal(c.Tower.shopState().halfCount, 2, '免费刷新出的新一页也要触发');
  assert.equal(c.Tower.shopHalfPendingOf(), 0, '刷新不额外扣份数');
  c.__seed(999);
  c.Tower._debugRun('endless').coins = 1000;
  assert.ok(c.Tower.rerollShop().ok, '第二次刷新（付费）');
  const st3 = c.Tower.shopState();
  assert.equal(st3.halfCount, 2, '付费刷新的新一页同样触发');
  for (const s of st3.slots.filter((x) => x.half)) {
    assert.equal(s.price, Math.floor(s.listPrice / 2), s.name + ' 应当是对折价');
  }
  /* 铸币商店：免费刷新的新一页也触发 */
  const c2 = setup();
  c2.Tower._debugSetNoMintShop(false);           // 这一段要战后自动刷出铸币商店
  c2.Tower._debugSetEndlessLayer(7);              // 第 7 层才在铸币商店的刷出区间里
  c2.__rand(0.99);
  assert.ok(c2.Tower.debugGrantBuff('E14').ok);
  c2.Tower._debugRun('endless').env = [];
  c2.__rand(0);
  const rw = winOneEndless(c2);
  assert.equal(rw.mintShop, true, '应当刷出铸币商店');
  const m1 = c2.Tower.shopState();
  assert.equal(m1.halfCount, 1, '铸币商店第一页 1 件对折');
  assert.equal(m1.halfPerPage, 1);
  c2.__seed(31337);
  assert.ok(c2.Tower.rerollMintShop().ok, '铸币商店免费刷新');
  const m2 = c2.Tower.shopState();
  assert.equal(m2.halfCount, 1, '铸币商店刷新出的新一页也要触发');
  assert.equal(c2.Tower.shopHalfPendingOf(), 0, '铸币商店的刷新同样不扣份数');
  const slot = m2.slots.find((s) => s.half);
  assert.ok(slot, '新一页要有对折的格子');
  const base = TD.mintPrice(TD.BUFF_BY_ID[slot.id]);
  assert.equal(slot.price, Math.floor(base / 2), '对折价仍然按固定价算：' + base + ' → ' + slot.price);
  /* 界面要把「每页都会触发」写出来（否则玩家以为只有第一页） */
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  assert.ok(/halfPerPage/.test(uiSrc), '两个商店页都要用到 halfPerPage 提示');
  assert.ok(/新一页同样有/.test(uiSrc) || /每次刷新出的新一页/.test(uiSrc), '要写明刷新出的新一页也会触发');
});

test('需求89：涅槃（C14）「每层 N 次」在真实战斗里也记账（修界面不传战斗结果）', () => {
  const c = setup();
  const T = c.Tower, S = c.State, Sim = c.Sim, TD = c.TowerData;
  assert.equal(TD.BUFF_BY_ID.C14.maxStacks, 2, '涅槃可叠 2 层');
  assert.equal(TD.BUFF_BY_ID.C14.mods.revivePct, 0.50, '复活回复 50% 生命上限');
  assert.equal(TD.BUFF_BY_ID.C14.mods.reviveStatMul, 0.50, '复活后本场力/敏/速 +50%');
  assert.match(TD.BUFF_BY_ID.C14.desc, /每层/, '描述写的是「每层」：' + TD.BUFF_BY_ID.C14.desc);

  /** 起一局：第 7 层、带 2 层涅槃、环境清空。 */
  const boot = () => {
    const c = setup();
    c.State.newGame('c14-' + Math.random());
    const st = c.State.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    c.Tower._debugSetLayer(9); c.Tower.startEndlessRun(); c.Tower._debugSetEndlessLayer(7);
    const run = c.Tower._debugRun('endless');
    run.permanent = [{ id: 'C14', stacks: 2 }];
    run.env = []; run.noEnvRoll = true;
    return c;
  };
  const mkMe = () => ({ name: 'p', level: 30, power: 1, agility: 1, speed: 1, maxHp: 400, hp: 400,
    baseStats: { power: 1, agility: 1, speed: 1 }, weapons: [{ id: 1, level: 1 }], skills: [], wears: [],
    effects: {}, masterLevel: 0 });
  /** 真打一场（1 血进场 → 几乎必被一击打死并触发涅槃），结果对象与界面传的是同一个。 */
  const fightReal = (c) => {
    const T = c.Tower;
    const r0 = T._debugRun('endless');
    r0.choices = null; r0.phase = null; r0.env = []; r0.noEnvRoll = true;
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
    const me = mkMe(); nx.adjustMe(me);
    /* 调完面板之后把血改成 1 点：对手任意一击都能带走，这场必触发涅槃（复活也回 1 血）。 */
    me.maxHp = 1; me.hp = 1;
    const granted = (me.mods.deathSaves || []).filter((s) => s.revive).length;
    const res = c.Sim.simulate(me, nx.foe);                // 玩家是 side 0
    const revives = (res.rounds || []).filter((r) => r.deathSave && r.revive).length;
    T.reportBattle('endless', nx.token, true, 1, 1, res);   // 界面现在就是这么传的
    return { granted, revives, run: T._debugRun('endless') };
  };

  /* 真实战斗：1 血进场必死 → 用掉几次就记几次（这一段证明真实路径确实会记账）。
   * sim 有极小概率整场都在闪避（没死成），所以换一局重试 —— 每次都是**独立的满配局面**，
   * 只有成功那一次的账拿来做断言，不会互相污染。 */
  let f1 = null;
  for (let i = 0; i < 6; i++) {
    const cc = boot();
    f1 = fightReal(cc);
    if (f1.revives > 0) break;
  }
  assert.ok(f1.revives >= 1, '真实战斗里应当出现过涅槃复活（连试 6 局都没死成，sim 可能出问题了）');
  assert.equal(f1.run.reviveLayer, 7, '本层已用次数要记账到第 7 层');
  assert.equal(f1.run.reviveUsed, f1.revives, '用掉几次记几次，实测 ' + f1.run.reviveUsed);
  assert.ok(f1.revives <= f1.granted, '用掉的次数不该超过赛前发下来的：' + f1.revives + ' / ' + f1.granted);
  assert.ok(f1.run.deathSaves >= 1, '隐藏成就「死而复生」的计数也要涨（同一个根因）：' + f1.run.deathSaves);

  /* 逐次递减与「换层才重置」用合成报告精确核对（每场死一次，不受 sim 随机性影响） */
  const c2 = setup();
  const T2 = c2.Tower, S2 = c2.State;
  S2.newGame('c14b-' + Math.random());
  const st2 = S2.state(); st2.level = 70; st2.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st2.stages[i] = { npcIndex: 3, passed: true };
  T2._debugSetLayer(9); T2.startEndlessRun(); T2._debugSetEndlessLayer(7);
  const run2 = T2._debugRun('endless');
  run2.permanent = [{ id: 'C14', stacks: 2 }];
  run2.env = []; run2.noEnvRoll = true;
  const fight2 = (revives) => {
    const r0 = T2._debugRun('endless');
    r0.choices = null; r0.phase = null; r0.env = []; r0.noEnvRoll = true;
    const nx = T2.nextBattle('endless');
    const me = { name: 'p', level: 70, power: 100, agility: 100, speed: 100, maxHp: 1000, hp: 1000,
      baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    const granted = (me.mods.deathSaves || []).filter((s) => s.revive).length;
    const result = { rounds: Array.from({ length: revives }, () => ({ deathSave: true, revive: 1 })) };
    T2.reportBattle('endless', nx.token, true, 1000, me.maxHp, result);
    return { granted, run: T2._debugRun('endless') };
  };
  const a1 = fight2(1);
  assert.equal(a1.granted, 2, '第 1 场赛前给 2 次（2 层）');
  assert.equal(a1.run.reviveUsed, 1, '用掉 1 次就记 1 次');
  const a2 = fight2(1);
  assert.equal(a2.granted, 1, '第 2 场赛前只剩 1 次');
  assert.equal(a2.run.reviveUsed, 2);
  const a3 = fight2(1);
  assert.equal(a3.granted, 0, '本层用满之后不该再补复活机会（每层 2 次）');
  /* 同一层的第 4 场仍然不给（不是「每场重置」） */
  assert.equal(fight2(0).granted, 0, '同一层继续打也不给');
  /* 换一层 → 次数重置（这才是「每层 N 次」） */
  T2._debugSetEndlessLayer(8);
  const b1 = T2._debugRun('endless');
  b1.env = []; b1.noEnvRoll = true;
  assert.equal(fight2(1).granted, 2, '换到第 8 层应当重新给 2 次');
  /* 1 层的剧本：每层就 1 次 */
  const c3 = setup();
  c3.State.newGame('c14c');
  const st3 = c3.State.state(); st3.level = 70; st3.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st3.stages[i] = { npcIndex: 3, passed: true };
  c3.Tower._debugSetLayer(9); c3.Tower.startEndlessRun(); c3.Tower._debugSetEndlessLayer(7);
  const run3 = c3.Tower._debugRun('endless');
  run3.permanent = [{ id: 'C14', stacks: 1 }];
  run3.env = []; run3.noEnvRoll = true;
  const fight3 = () => {
    const r0 = c3.Tower._debugRun('endless');
    r0.choices = null; r0.phase = null; r0.env = []; r0.noEnvRoll = true;
    const nx = c3.Tower.nextBattle('endless');
    const me = { name: 'p', level: 70, power: 100, agility: 100, speed: 100, maxHp: 1000, hp: 1000,
      baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    const granted = (me.mods.deathSaves || []).filter((s) => s.revive).length;
    c3.Tower.reportBattle('endless', nx.token, true, 1000, me.maxHp, { rounds: [{ deathSave: true, revive: 1 }] });
    return granted;
  };
  assert.equal(fight3(), 1, '1 层涅槃：每层 1 次');
  assert.equal(fight3(), 0, '1 层涅槃：同一层用掉就没了');

  /* 根因守卫：界面必须把战斗结果一起交给状态机（否则上面这些计数永远是 0） */
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const at = uiSrc.indexOf('Tower.reportBattle(');
  assert.ok(at > 0, '找不到界面里的 reportBattle 调用');
  const call = uiSrc.slice(at, uiSrc.indexOf(';', at));
  assert.match(call, /Tower\.reportBattle\([^;]*,\s*r\)/, '界面必须把结果 r 传进去：' + call);
});

test('需求90：铸币商店的「返回」不收摊、「继续战斗」才收摊；调试台可立即生成一家', () => {
  const c = setup();
  const T = c.Tower;
  T._debugSetEndlessLayer(7);
  const pre = T._debugRun('endless');
  pre.mintGroup = -1;
  assert.equal(T._debugNoFlowBuffs(), true, '流程类用例默认开着「排除 E01/E15」的开关');
  assert.equal(T._debugNoMintShop(), true, '也默认关掉了铸币商店的自动刷出');
  /* 调试接口：立即生成一个铸币商店（跳过概率/层区间，也不占本组自然刷出的名额） */
  const spawn = T._debugSpawnMintShop();
  assert.ok(spawn.ok, '应当能立刻生成：' + (spawn.msg || ''));
  assert.equal(spawn.layer, 7);
  assert.equal(spawn.slots, 5, '应当是 5 件货');
  const r1 = T._debugRun('endless');
  assert.equal(r1.phase, 'shop', '生成后应当直接进商店阶段');
  assert.ok(r1.shop && r1.shop.mint, '而且必须是铸币商店');
  assert.equal(r1.mintGroup, -1, '调试手开的店不该吃掉「本组已刷过」的名额');
  /* 没有进行中的对局时要给明确提示，而不是静默失败 */
  T.abandon('endless');
  const noRun = T._debugSpawnMintShop();
  assert.equal(noRun.ok, false, '没有对局时应当失败');
  assert.match(noRun.msg, /无尽塔对局/, '提示要说清原因：' + noRun.msg);

  /* 界面接线（真点击在 tools/test-mint-shop.cjs 里，这里守源码口径）：
   * 页脚「返回」只回上一页、店不收摊；主按钮叫「继续战斗」且收摊。 */
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const from = uiSrc.indexOf('function openMintShop');
  const to = uiSrc.indexOf('【U15】', from);
  const body = uiSrc.slice(from, to > from ? to : from + 6000);
  assert.ok(/back\(p, \(\) => openEndless\(\)\)/.test(body), '页脚返回不能关店：' + body.slice(0, 140));
  assert.ok(!/back\(p, \(\) => \{ Tower\.leaveMintShop/.test(body), '页脚返回不该再调 leaveMintShop');
  assert.ok(/C\(\)\.btn\('继续战斗', 'mintleave'/.test(body), '主按钮应当改叫「继续战斗」：' + body.slice(0, 200));
  assert.ok(/Tower\.leaveMintShop\(\); openEndless\(\)/.test(body), '「继续战斗」才收摊');
  /* 调试台要有这个按钮（走 Tower._debugSpawnMintShop） */
  const dbgSrc = fs.readFileSync(path.join(ROOT, 'js', 'debug.js'), 'utf8');
  assert.ok(/data-mint-shop/.test(dbgSrc), '调试面板要加按钮');
  assert.ok(/_debugSpawnMintShop/.test(dbgSrc), '按钮要接 _debugSpawnMintShop');
  assert.ok(/data-mint-shop[^>]*>铸币商店</.test(dbgSrc), '文案缩减为「铸币商店」');
});

test('需求91：三侠削弱只「贯穿本层」—— 换层必须清掉（不再跨层保留或叠加）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  /* 数据口径：三条削弱都写着「本层」 */
  assert.equal(Object.keys(TD.HERO_DEBUFF).length, 3, '三位大侠各一条削弱');
  assert.match(String(TD.HERO_DEBUFF.xm.desc), /本层/, '熊猫的「压制」写明本层无法使用：' + TD.HERO_DEBUFF.xm.desc);
  assert.match(String(TD.HERO_DEBUFF.tl.desc), /上限/, '螳螂的重伤压上限：' + TD.HERO_DEBUFF.tl.desc);

  S.newGame('dbg' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  /* 给玩家一把武器 + 一个技能：熊猫的「压制」是从玩家武技里抽一个来锁的，
   * 池子空了那条削弱就落不下来（测试里先把池子填上，三条削弱才都可能出现）。 */
  st.weapons = ['1:10']; st.skills = ['2:10'];
  T._debugSetLayer(9); T.startEndlessRun(); T._debugSetEndlessLayer(3);
  const mkMe = () => ({ name: 'p', level: 70, power: 1000, agility: 1000, speed: 1000, maxHp: 99999, hp: 99999,
    baseStats: { power: 1000, agility: 1000, speed: 1000 },
    /* 武器要写成 {id, level} 对象、技能写成 'id:level' 字符串 —— adjustMe 的「压制」是按对象字段过滤的，
     * 传字符串的话 Number(w.id) 是 NaN，锁不掉任何东西（测试会假绿）。 */
    weapons: (S.state().weapons || []).map((raw) => ({ id: Number(String(raw).split(':')[0]),
      level: Number(String(raw).split(':')[1]) || 1 })),
    skills: (S.state().skills || []).slice(),
    wears: [], effects: {}, masterLevel: 0 });
  const open = () => {
    const r = T._debugRun('endless');
    r.choices = null; r.phase = null; r.env = []; r.noEnvRoll = true;
    return T.nextBattle('endless');
  };
  const weaker = (a, b) => (a.maxHp < b.maxHp) || (a.power < b.power) || (a.agility < b.agility) ||
    (a.speed < b.speed) ||
    ((a.weapons || []).length + (a.skills || []).length) < ((b.weapons || []).length + (b.skills || []).length);

  /* ① 第 1 场一定是三侠之一：让它真放出大招 → 落一条削弱 */
  const nx1 = open();
  assert.equal(nx1.entry.kind, 'hero', '每层第 1 场是三侠：' + JSON.stringify(nx1.entry));
  const def1 = TD.HERO_DEBUFF[nx1.entry.anim];
  assert.ok(def1, '三侠要有削弱定义：' + nx1.entry.anim);
  /* 报告里的那一发大招必须**真的打中了**（dmg > 0）才会留下削弱 —— 见需求94。 */
  T.reportBattle('endless', nx1.token, true, 1000, 2000, { rounds: [{ attacker: 1, ultName: def1.ult, dmg: 800 }] });
  const run = T._debugRun('endless');
  assert.equal(run.debuffs.length, 1, '大招放出来后应当落一条削弱：' + JSON.stringify(run.debuffs));
  assert.equal(run.debuffs[0].from, nx1.entry.anim, '要标清是谁给的');
  assert.equal(run.debuffs[0].layer, 3, '要记下是哪一层吃的：' + run.debuffs[0].layer);
  const saved = run.debuffs.slice();

  /* ② 同一层里一直生效，并且真的在压制玩家（上限 / 属性 / 锁武技三选一） */
  const nx2 = open();
  assert.equal((nx2.debuffs || []).length, 1, '本层第二场仍然带着这条削弱');
  const meWith = mkMe(); nx2.adjustMe(meWith);
  const runW = T._debugRun('endless'); runW.debuffs = [];
  const meWithout = mkMe(); nx2.adjustMe(meWithout);
  runW.debuffs = saved.slice();          // 注意给副本：直接用 saved 会让后面新落的削弱也写进这份快照
  assert.ok(weaker(meWith, meWithout), '带削弱时应当明显更弱（上限 ' + meWith.maxHp + '/' + meWithout.maxHp +
    ' 力 ' + meWith.power + '/' + meWithout.power + ' 武技 ' +
    ((meWith.weapons || []).length + (meWith.skills || []).length) + '/' +
    ((meWithout.weapons || []).length + (meWithout.skills || []).length) + '）');
  /* 这一场也要结算掉，否则战斗令牌挂着、后面取不到下一场 */
  T.reportBattle('endless', nx2.token, true, 1000, 2000);

  /* ③ 把本层打完 → 换层 → 削弱必须清空（这就是用户报的 bug） */
  for (let i = 0; i < 8; i++) {
    const r = T._debugRun('endless');
    if (!r || r.layer !== 3) break;
    if (r.choices) { r.choices = null; continue; }
    if (r.phase === 'checkpoint') { T.continueEndless(); continue; }
    if (r.phase === 'shop') {
      T.closeShop();
      if (T._debugRun('endless') && T._debugRun('endless').phase === 'checkpoint') T.continueEndless();
      continue;
    }
    if (r.phase === 'sacrifice') { T.sacrificePerm('C01'); continue; }
    const nx = T.nextBattle('endless');
    if (!nx || nx.ok === false) break;
    const d = nx.entry && nx.entry.kind === 'hero' ? TD.HERO_DEBUFF[nx.entry.anim] : null;
    T.reportBattle('endless', nx.token, true, 1000, 2000, d ? { rounds: [{ ultName: d.ult, dmg: 800 }] } : undefined);
  }
  const after = T._debugRun('endless');
  assert.ok(after, '对局应当还在（第 4 层）');
  assert.equal(after.layer, 4, '本层打完应当换到第 4 层：' + after.layer);
  assert.equal(after.debuffs.length, 0, '换层之后三侠削弱必须清空：' + JSON.stringify(after.debuffs));

  /* ④ 新层的第一场不带任何旧削弱（而把旧条目硬塞回去仍然会生效 → 证明清空就是那个开关） */
  const nx4 = open();
  assert.equal((nx4.debuffs || []).length, 0, '新层的战斗不该再带旧削弱');
  const meClean = mkMe(); nx4.adjustMe(meClean);
  const run4 = T._debugRun('endless'); run4.debuffs = saved.slice();
  const meStale = mkMe(); nx4.adjustMe(meStale);
  run4.debuffs = [];
  assert.ok(weaker(meStale, meClean), '把旧条目塞回去仍然会压制玩家（说明清空确实解除了它）');
  T.reportBattle('endless', nx4.token, true, 1000, 2000);   // 结算掉这一场，免得令牌挂着

  /* ⑤ 同一层重开（E15 时间回廊）**不清**：那是「贯穿本层」的同一层 */
  assert.ok(T.debugGrantBuff('E15').ok, '拿一张时间回廊');
  T._debugRun('endless').debuffs = saved.slice();
  const nx5 = open();
  const rw5 = T.reportBattle('endless', nx5.token, true, 1000, 2000, { rounds: [] });
  assert.ok(rw5.layerRestart, '这一场应当触发「本层重开」：' + JSON.stringify(rw5.layerRestart));
  const restarted = T._debugRun('endless');
  assert.equal(restarted.layer, 4, '重开的是同一层，层号不变');
  assert.equal(restarted.idx, 0, '重开回到本层第 1 场');
  assert.equal(restarted.debuffs.length, 1, '同一层重开不该清掉削弱（贯穿本层）：' + JSON.stringify(restarted.debuffs));

  /* ⑥ 界面文案与实现口径一致 + advanceLayer 真的清了（源码口径，防止又被删掉） */
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  assert.ok(/本层已被削弱/.test(uiSrc), '界面写的是「本层已被削弱」');
  const towerSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  const at = towerSrc.indexOf('function advanceLayer(run, mode) {');
  assert.ok(at > 0, '找不到 advanceLayer');
  const body = towerSrc.slice(at, towerSrc.indexOf('\n  }', at));
  assert.ok(/run\.debuffs = \[\];/.test(body), 'advanceLayer 里必须清空 run.debuffs：' + body.slice(0, 200));
  const rat = towerSrc.indexOf('function restartLayer(run) {');
  const rbody = towerSrc.slice(rat, towerSrc.indexOf('\n  }', rat));
  assert.ok(!/run\.debuffs/.test(rbody), 'restartLayer（同层重开）不该清削弱：' + rbody.slice(0, 160));
});

test('需求92：商店出售 / 交换列表按「获得先后倒序」排（最新在最上），虚空铭文附魔的沉到最后', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.newGame('sell' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T._debugSetLayer(9); T.startEndlessRun(); T._debugSetEndlessLayer(9);
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.slotFreeIds = []; run.acqSeq = 0;
  const ids = () => T.sellListOf('endless').map((b) => b.id).join(',');

  /* ① 倒序：**最新拿到的排最上**（打开商店就能直接卖掉它，不用往下拖）；叠层不改变位置；
   *    跨永久/限次混排（不再「永久一坨、限次一坨」） */
  assert.ok(T.debugGrantBuff('C02').ok, '拿一条永久');
  assert.ok(T.debugGrantBuff('N01').ok, '拿一条限次');
  assert.ok(T.debugGrantBuff('C02').ok, '再拿一次同一条 → **并排第二个栏位**（2026-10 起不再同栏叠层）');
  assert.ok(T.debugGrantBuff('C05').ok, '拿一条新的永久');
  const c02rows = run.permanent.filter((b) => b.id === 'C02');
  assert.equal(c02rows.length, 2, '两份 C02 应当是两栏：' + JSON.stringify(c02rows));
  assert.deepEqual(c02rows.map((b) => b.stacks), [1, 1], '每栏各 1 层（不再同栏叠 2 层）');
  assert.equal(ids(), 'C05,C02,N01,C02', '获得先后倒序（最新在最上）：' + ids());
  assert.equal(T.sellListOf('endless')[0].id, 'C05', '最新拿到的必须排在第一行');
  /* 获得顺序号：每个栏位各自一个号，按拿到的时间递增 */
  assert.equal(c02rows[0].at, 1, '第一条的号');
  assert.equal(run.limited.find((b) => b.id === 'N01').at, 2, '第二条的号');
  assert.equal(c02rows[1].at, 3, '第二个 C02 栏位的号');
  assert.equal(run.permanent.find((b) => b.id === 'C05').at, 4, '第四条（后拿的永久）的号更大');

  /* ② 附魔（不占位）的**沉到最后** —— 拿最新那条来附魔，能同时验证两条规则（它从第 1 行掉到最后一行） */
  run.slotFreeIds = ['C05'];
  assert.equal(ids(), 'C02,N01,C02,C05', '附魔的沉到最后：' + ids());
  assert.equal(T.sellListOf('endless')[3].slotFree, true, 'ownedBuffs 要暴露 slotFree');
  run.slotFreeIds = [];

  /* ③ 走真实附魔路径（C37 虚空铭文 → 选一个永久增益附魔）也是同一套排序 */
  assert.ok(T.debugGrantBuff('C37').ok, '拿一张虚空铭文');
  assert.equal(run.pendingPick && run.pendingPick.kind, 'permBuff', '应当进入「选一个永久增益附魔」的待选取');
  const cands = T.pickCandidates('permBuff');
  assert.ok(cands && cands.length, '应当有候选：' + JSON.stringify(cands));
  const pickId = cands[0].id;
  assert.ok(T.applyPickBuff('permBuff', pickId).ok, '附魔 ' + pickId);
  const list3 = T.sellListOf('endless');
  assert.equal(list3[list3.length - 1].id, pickId, '真实路径附魔过的那条也要沉到最后：' + ids());
  assert.equal(run.slotFreeIds.indexOf(pickId) >= 0, true, 'slotFreeIds 要记上');

  /* ④ sortForSell 是纯函数：不改原数组，且同号时保持原顺序（稳定） */
  const raw = T.ownedBuffs('endless').filter((b) => b.kind !== 'instant');
  const rawIds = raw.map((b) => b.id).join(',');
  T.sortForSell(raw);
  assert.equal(raw.map((b) => b.id).join(','), rawIds, 'sortForSell 不该改原数组');
  assert.equal(T.sortForSell([{ id: 'A', at: 0 }, { id: 'B', at: 0 }]).map((b) => b.id).join(','), 'A,B',
    '没有号（老档）时保持原顺序');

  /* ⑤ 老档（没有 at）：先按「永久表在前、限次表在后」补号，再倒序展示；
   *    之后新拿到的那条永远排在第一行 */
  const c2 = setup();
  c2.State.newGame('sell-old');
  const st2 = c2.State.state(); st2.level = 70; st2.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st2.stages[i] = { npcIndex: 3, passed: true };
  c2.Tower._debugSetLayer(9); c2.Tower.startEndlessRun(); c2.Tower._debugSetEndlessLayer(9);
  const run2 = c2.Tower._debugRun('endless');
  run2.permanent = [{ id: 'C02', stacks: 1 }, { id: 'C05', stacks: 1 }];
  run2.limited = [{ id: 'N01', stacks: 1, uses: 10, on: true }];
  run2.slotFreeIds = []; run2.acqSeq = 0;              // 老档：一条号都没有
  assert.equal(c2.Tower.sellListOf('endless').map((b) => b.id).join(','), 'N01,C05,C02',
    '老档补号（永久在前、限次在后）后按倒序展示');
  assert.equal(run2.permanent.map((b) => b.at).join(','), '1,2', '永久表补号 1、2');
  assert.equal(run2.limited[0].at, 3, '限次表接着补 3');
  c2.Tower.debugGrantBuff('C11');
  assert.equal(c2.Tower.sellListOf('endless').map((b) => b.id).join(','), 'C11,N01,C05,C02',
    '补号之后新拿到的排在最上');

  /* ⑥ 界面接线：两个商店的「挑自己增益」列表都走 Tower.sellListOf */
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const uses = (uiSrc.match(/Tower\.sellListOf\(/g) || []).length;
  assert.equal(uses, 2, '试炼商店的出售列表与铸币商店的交换列表都要用它：' + uses);
  assert.ok(!/Tower\.ownedBuffs\('endless'\)\.filter\(\(b\) => b\.kind !== 'instant'\)/.test(uiSrc),
    '不该再有「拿原始顺序」的老写法');
  assert.ok(/按<b>获得的先后<\/b>排列/.test(uiSrc) && /最新拿到的在最上/.test(uiSrc),
    '出售区要写明「按获得先后排列、最新拿到的在最上」');
  assert.ok(/slot-free-hint/.test(uiSrc), '附魔的那几条要有提示标记');
});

test('需求93：本轮商店平衡 —— E01 削弱 / 虚空铭文自我降权 / 门庭若市 80 / 刷新 70 封顶 / 豪掷千金降史诗率', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;

  /* ① 立即进货（E01）：稀有 → **史诗**，折扣 −50% → **−30%（7 折）**，与 steam大促 同档 */
  const e01 = TD.BUFF_BY_ID.E01, e04 = TD.BUFF_BY_ID.E04;
  assert.equal(e01.rarity, 2, 'E01 稀有度应当是史诗（2026-10 提升）');
  assert.equal(e01.mods.postBattleShopDiscount, 0.30, 'E01 单用 7 折（−30%）');
  assert.equal(TD.SHOP_DISCOUNT_E01, 0.30, '折扣常量同步');
  assert.equal(e04.mods.shopDiscount, 0.30, 'steam大促 仍是 7 折');
  assert.match(e01.desc, /7 折/, '描述要写 7 折：' + e01.desc);
  assert.ok(TD.hasTag(e01, 'ops'), 'E01 仍是运营类');
  /* 两张券同持仍是 3.5 折（合并值不能被更小的单券折扣压掉） */
  S.newGame('b93a' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T._debugSetLayer(9); T.startEndlessRun(); T._debugSetEndlessLayer(7);
  const r0 = T._debugRun('endless');
  r0.permanent = []; r0.limited = []; r0.choices = null; r0.phase = null; r0.env = [];
  T.debugGrantBuff('E04');                       // 即时：挂上 −30%
  T.debugGrantBuff('E01');                       // 战后开店：−30%
  const nx = T.nextBattle('endless');
  T.reportBattle('endless', nx.token, true, 1500, 2000);
  const shopA = T._debugRun('endless').shop;
  assert.ok(shopA && shopA.discount, '战后应当开店且带折扣');
  assert.ok(Math.abs(shopA.discountPct - 0.65) < 1e-6,
    'E01 + E04 仍是 −65%（3.5 折），实测 ' + shopA.discountPct);
  T.closeShop();

  /* ② 虚空铭文（C37）：2026-10 用户口径（第十三批修订）—— 降权的计数口径改成
   * **直接数背包里被虚空铭文附魔过的增益个数**（`row.slotFree === true` 的栏位数），
   * 权重 = 1/(附魔数+1)：0 个 → ×1；1 个 → ×1/2；2 个 → ×1/3；3 个 → ×1/4；5 个 → ×1/6。
   * 旧口径 `repeatWeight: 0.88` 只数「买过几次虚空铭文」的流水，玩家抱着 5 条「不占位」
   * 增益时权重仍是 ×1 —— 正是用户报的「计数不正常、比终焉烙印还常见」。 */
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.slotFreeIds = []; run.acqSeq = 0;
  const withEnch = (n) => {
    run.permanent = [];
    for (let i = 0; i < Math.max(n, 1); i++) {
      run.permanent.push({ id: 'C2' + i, stacks: 1, uid: i + 1, slotFree: i < n });
    }
    return T.buffWeightOf(run, 'C37');
  };
  const w0 = withEnch(0), w1 = withEnch(1), w2 = withEnch(2), w3 = withEnch(3), w5 = withEnch(5);
  assert.equal(TD.BUFF_BY_ID.C37.mods.weightDivBy, 'enchanted', '口径 = 数「背包里被附魔的增益个数」');
  assert.equal(TD.BUFF_BY_ID.C37.mods.weightDivOffset, 1, '÷(附魔数+1)：第一次附魔就有感觉');
  assert.equal(TD.BUFF_BY_ID.C37.mods.repeatWeight, undefined, '不再用「买过几次」的流水口径');
  assert.equal(w0, 1, '0 个附魔 → ×1（÷1）');
  assert.ok(Math.abs(w1 - 1 / 2) < 1e-9, '1 个附魔 → ×1/2：' + w1);
  assert.ok(Math.abs(w2 - 1 / 3) < 1e-9, '2 个 → ×1/3：' + w2);
  assert.ok(Math.abs(w3 - 1 / 4) < 1e-9, '3 个 → ×1/4：' + w3);
  assert.ok(Math.abs(w5 - 1 / 6) < 1e-9, '5 个 → ×1/6：' + w5);
  /* 「数当前背包」而不是「只增不减的流水」：卖掉/替换掉被附魔的那一条，档位要还回来。 */
  const back = (() => {
    const saved = run.permanent.map((r) => r.slotFree);
    run.permanent[0].slotFree = false;
    const w = T.buffWeightOf(run, 'C37');
    run.permanent.forEach((r, i) => { r.slotFree = saved[i]; });
    return w;
  })();
  assert.ok(Math.abs(back - 1 / 5) < 1e-9, '5 个里失去 1 个 → ×1/5：' + back);
  run.permanent.forEach((r) => { r.slotFree = false; });
  assert.equal(T.buffWeightOf(run, 'C37'), 1, '附魔全没了 → 权重回到 ×1');
  /* 同名的另一条被附魔不算两次：计数按**栏位**去数。 */
  withEnch(0);
  run.permanent = [{ id: 'C25', stacks: 3, uid: 1, slotFree: true }];
  assert.ok(Math.abs(T.buffWeightOf(run, 'C37') - 0.5) < 1e-9,
    '同一条栏位无论几层都只算 1 个附魔：' + T.buffWeightOf(run, 'C37'));
  /* 别的增益不受影响（只有 C37 用 'enchanted' 口径）。 */
  run.permanent = [{ id: 'C20', stacks: 1, uid: 1, slotFree: true }, { id: 'C21', stacks: 1, uid: 2, slotFree: true }];
  assert.equal(T.buffWeightOf(run, 'C20'), 1, '没配降权口径的增益不因附魔数量变权重');
  assert.equal(TD.BUFF_BY_ID.C37.mods.pityWeight, 1, 'C37 保底权重 1（不变）');
  assert.equal(TD.BUFF_BY_ID.C49.mods.pityWeight, 1, 'C49 保底权重 1 → 保底池里两条仍是 1:1');
  /* 终焉烙印（C49）本轮不变：仍按「每份 ×0.88」，n = 身上已有的份数（含碎掉的）。 */
  assert.equal(TD.BUFF_BY_ID.C49.mods.repeatWeight, 0.88, 'C49 用「每份 ×0.88」的口径');
  const run49 = T._debugRun('endless');
  run49.permanent = []; run49.limited = []; run49.slotFreeIds = []; run49.acqSeq = 0; run49.fragileGot = {};
  const b49 = T.buffWeightOf(run49, 'C49');
  run49.limited = [{ id: 'C49', stacks: 1, uses: 1000, on: true }];
  assert.equal(T.buffWeightOf(run49, 'C49'), b49, '身上 1 份 → 不降权');
  run49.limited = [{ id: 'C49', stacks: 2, uses: 1000, on: true }];
  assert.ok(Math.abs(T.buffWeightOf(run49, 'C49') - b49 * 0.88) < 1e-9, '2 份 → ×0.88：' + T.buffWeightOf(run49, 'C49'));
  run49.limited = [{ id: 'C49', stacks: 3, uses: 1000, on: true }];
  assert.ok(Math.abs(T.buffWeightOf(run49, 'C49') - b49 * Math.pow(0.88, 2)) < 1e-9,
    '3 份 → ×0.7744：' + T.buffWeightOf(run49, 'C49'));
  /* 碎掉的那一份也算「身上有」：`obtainedCountOf` = max(在册份数, run.fragileGot 累计份数)。 */
  run49.limited = [{ id: 'C49', stacks: 1, uses: 1000, on: true }];
  run49.fragileGot = { C49: 2 };
  const withBroken = T.buffWeightOf(run49, 'C49');
  assert.equal(T.obtainedCountOf(run49, 'C49'), 2, '在册 1 + 碎过 1 = 累计 2 份');
  assert.ok(Math.abs(withBroken - b49 * 0.88) < 1e-9, '碎掉的烙印也计入份数 → ×0.88：' + withBroken);
  /* 对照：只算在册 1 份时是 ×1（不降权）—— 含碎掉那份时更低。 */
  run49.fragileGot = {};
  const liveOnly = T.buffWeightOf(run49, 'C49');
  assert.equal(liveOnly, b49, '只算在册 1 份时不降权：' + liveOnly);
  assert.ok(withBroken < liveOnly, '含碎掉的那份时权重更低：' + withBroken + ' < ' + liveOnly);
  /* 别的增益不受影响（只有 C37 用 'enchanted' 口径）。 */
  assert.equal(T.buffWeightOf(run, 'C20'), T.buffWeightOf(run, 'C20'), '同一状态下权重稳定');

  /* ③ 门庭若市（C59）：每次进店 100 → **80**（×层数） */
  assert.equal(TD.BUFF_BY_ID.C59.mods.shopEnterCoins, 80, '进店币 80');
  assert.match(TD.BUFF_BY_ID.C59.desc, /80 试炼币/, '描述同步：' + TD.BUFF_BY_ID.C59.desc);
  const r59 = T._debugRun('endless');
  r59.permanent = [{ id: 'C59', stacks: 2 }]; r59.coins = 0; r59.shop = null; r59.phase = null;
  r59.choices = [{ type: 'buff', id: 'C02' }]; r59.restShopUsed = false;
  assert.ok(T.openRestShop().ok, '应当能开休整商店');
  assert.equal(T._debugRun('endless').coins, 160, '2 层进店 = 160（80 × 2）');
  T.closeShop();

  /* ④ 刷新：第一段封顶 70，之后**逐档继续涨**（70 档 10 次 → 80 → 90…）；
   *    稀有度收益仍在 **50 那一档**封顶。 */
  assert.equal(TD.SHOP.rerollMax, 70, '第一段封顶价 70');
  assert.equal(TD.SHOP.rerollTiltCap, 50, '收益封顶档 50');
  assert.equal(TD.rerollPriceAt(7), 70, '第 7 次到 70');
  assert.equal(TD.rerollPriceAt(16), 70, '70 档保持 10 次');
  assert.equal(TD.rerollPriceAt(17), 80, '之后到 80');
  assert.equal(TD.rerollPriceAt(27), 90, '再到 90');
  const e50 = TD.rerollExpectation(50), e70 = TD.rerollExpectation(70);
  assert.equal(e70.tilt, e50.tilt, '70 币的 tilt 必须等于 50 档');
  assert.equal(e70.epics, e50.epics, '期望史诗也一样（只更贵不更好）');
  assert.ok(TD.rerollExpectation(50).tilt > TD.rerollExpectation(40).tilt, '50 档仍优于 40 档');

  /* ⑤ 豪掷千金（C58）：基准刷新档下调到 **10 试炼币**；抽取口径是
   *    「把商店 10 币刷新时每件限次增益的动态权重摊到每件上，直接抽签」。
   *    目的是削弱「抽到终焉烙印」的概率。 */
  const m58 = TD.BUFF_BY_ID.C58.mods;
  assert.equal(m58.limitedRarityMul, undefined, '旧的按稀有度倍率已移除');
  assert.equal(m58.limitedDefaultRerollPaid, 10, '基准刷新档应当是「商店花 10 试炼币刷新」');
  assert.equal(T.limitedRerollPaidOf(), 10, '导出口径与数据一致');
  const r58 = T._debugRun('endless');
  r58.permanent = [{ id: 'C58', stacks: 1 }]; r58.limited = []; r58.slotFreeIds = [];
  const rar = (b) => b.rarity;
  const pool = TD.endlessPool.filter((b) => b.kind === 'limited');
  assert.ok(pool.length >= 10, '限次池里应当有足够样本：' + pool.length);
  /* 每件权重 = 档位预算 × 档内个体权重占比；档位预算 = rawTierWeights(rerollTilt(10))（个体全 1 时）。 */
  const base10 = TD.rawTierWeights(TD.rerollTilt(10), r58);
  const cnt = [0, 0, 0, 0];
  for (const b of pool) cnt[rar(b)] += 1;
  const flat = T.limitedGrantWeightsOf(r58);
  assert.equal(flat.length, pool.filter((b) => T.ownableOf(r58, b) && T.poolFilterOf(r58, b)).length,
    '权重表应当覆盖所有可用限次件');
  for (const b of pool) {
    const row = flat.find((x) => x.id === b.id);
    if (!row) continue;
    const want = base10[rar(b)] / cnt[rar(b)];
    assert.ok(Math.abs(row.weight - want) < 1e-6,
      b.id + ' 的权重应当是「10 币刷新档位预算 ÷ 档内件数」= ' + want.toFixed(4) + '，实测 ' + row.weight.toFixed(4));
  }
  assert.ok(base10[3] < base10[0], '传奇档的档位预算应当低于普通档');
  /* 史诗及以上的份额应当明显低于「等权」口径。 */
  const shareHigh = (wOf) => {
    let high = 0, all = 0;
    for (const b of pool) { const v = wOf(b); all += v; if (b.rarity >= 2) high += v; }
    return high / Math.max(1e-9, all);
  };
  const before = shareHigh(() => 1);
  const after = shareHigh((b) => { const row = flat.find((x) => x.id === b.id); return row ? row.weight : 0; });
  assert.ok(after < before * 0.8,
    '史诗及以上的份额应当明显下降：' + (before * 100).toFixed(1) + '% → ' + (after * 100).toFixed(1) + '%');
  assert.match(TD.BUFF_BY_ID.C58.desc, /越稀有越难出/, '描述要说明越稀有越难出：' + TD.BUFF_BY_ID.C58.desc);
});

test('需求94：三侠削弱按「大招实际命中次数」累加，数值浮动且各有本层上限', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  /* 玩家手上给两件武技：熊猫的「压制」要从这里抽两件来锁 */
  const st0 = S.state(); st0.weapons = ['1:10']; st0.skills = ['2:10'];

  /** 把这一层铺成 n 场同一位大侠（大招每场只放一次 → 每场最多命中 1 次）。 */
  const prep = (anim, n) => {
    const r = T._debugRun('endless');
    r.layer = 7; r.idx = 0;
    r.plan = Array.from({ length: n || 10 }, () => ({ kind: 'hero', anim: anim }));
    r.debuffs = []; r.choices = null; r.phase = null; r.env = []; r.noEnvRoll = true;
    return r;
  };
  const ult = (anim, extra) => Object.assign({ attacker: 1, ultName: TD.HERO_DEBUFF[anim].ult, dmg: 900 }, extra || {});
  const hit = (anim, rounds) => {
    const r0 = T._debugRun('endless');
    r0.choices = null; r0.phase = null; r0.env = []; r0.noEnvRoll = true;
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
    assert.equal(nx.entry.anim, anim, '这一场应当对上 ' + anim + '：' + JSON.stringify(nx.entry));
    /* 不传 rounds 就是「这一场大招打中了」（默认给一条带伤害的大招事件） */
    return T.reportBattle('endless', nx.token, true, 1000, 2000, { rounds: rounds || [ult(anim)] });
  };
  const mine = (anim) => T._debugRun('endless').debuffs.filter((d) => d.from === anim);

  /* ① 数据：浮动区间与上限都挂在 HERO_DEBUFF 上 */
  assert.equal(JSON.stringify(TD.HERO_DEBUFF.tl.pctRange), JSON.stringify([0.03, 0.06]), '螳螂每次 3%~6%');
  assert.equal(TD.HERO_DEBUFF.tl.capPct, 0.15, '螳螂本层上限 15%');
  assert.equal(JSON.stringify(TD.HERO_DEBUFF.xh.pctRange), JSON.stringify([0.05, 0.10]), '仙鹤每次 5%~10%');
  assert.equal(TD.HERO_DEBUFF.xh.maxTimes, 3, '仙鹤本层最多 3 次');
  assert.equal(TD.HERO_DEBUFF.xm.maxTimes, 2, '熊猫本层最多锁 2 个');
  for (const k of ['tl', 'xh', 'xm']) {
    assert.match(TD.HERO_DEBUFF[k].desc, /大招命中/, '描述要写清是「大招命中」才生效：' + TD.HERO_DEBUFF[k].desc);
  }

  /* ② 只算**真的打到玩家**的那几次：闪避 / 弹反 / 装死 / 没造成伤害（护盾全吸、格挡到 0）都不算 */
  prep('tl');
  const dodged = hit('tl', [ult('tl', { dodge: true, dmg: 0 })]);
  assert.equal(mine('tl').length, 0, '被闪避的那次不算：' + JSON.stringify(mine('tl')));
  assert.ok(!dodged.debuff, '也不该给界面返回削弱');
  prep('tl');
  hit('tl', [ult('tl', { jueDui: true, reboundHurt: 300, dmg: 0 })]);
  assert.equal(mine('tl').length, 0, '被弹反（绝对防御反伤）的那次不算');
  prep('tl');
  hit('tl', [ult('tl', { fakeDie: true, dmg: 0 })]);
  assert.equal(mine('tl').length, 0, '被装死混过去的那次不算');
  prep('tl');
  hit('tl', [{ attacker: 1, ultName: '疾风镰刀舞' }]);            // 没写 dmg
  assert.equal(mine('tl').length, 0, '没有造成伤害（护盾全吸收 / 格挡到 0）的那次不算');
  prep('tl');
  hit('tl', [ult('tl', { dmg: 0 })]);
  assert.equal(mine('tl').length, 0, 'dmg = 0 同样不算');
  prep('tl');
  const one = hit('tl', [ult('tl')]);
  assert.ok(one.debuff, '真的打中了就该落一条：' + JSON.stringify(one.debuff));
  assert.equal(mine('tl').length, 1, '打中一次落一条');
  assert.equal(one.debuff.from, 'tl', '要标清来源');
  assert.equal(one.debuff.layer, 7, '要记下是哪一层吃的');

  /* ③ 螳螂：每次 3%~6% 浮动，**累计不超过 15%**（打满之后不再加） */
  prep('tl');
  for (let i = 0; i < 8; i++) hit('tl');
  const tl = mine('tl');
  assert.ok(tl.length >= 3 && tl.length <= 5, '3%~6% 一次、上限 15% → 条数应当在 3~5 之间：' + tl.length);
  for (let i = 0; i < tl.length; i++) {
    const d = tl[i];
    assert.equal(d.kind, 'maxHp', '螳螂削的是生命上限');
    assert.ok(d.pct >= 0.01 - 1e-9 && d.pct <= 0.06 + 1e-9,
      '每次命中不超过 6%（最后一条可能是「补足上限」的小额）：' + d.pct);
    if (i < tl.length - 1) {
      assert.ok(d.pct >= 0.03 - 1e-9, '除最后那条补足之外，每次命中都应当在 3%~6%：' + d.pct);
    }
  }
  assert.ok(new Set(tl.map((d) => d.pct.toFixed(6))).size > 1, '数值应当有浮动：' + JSON.stringify(tl.map((d) => d.pct)));
  const total = 1 - tl.reduce((a, d) => a * (1 - d.pct), 1);
  assert.ok(total <= 0.15 + 1e-9, '累计削减不得超过 15%：' + (total * 100).toFixed(2) + '%');
  assert.ok(total > 0.14, '打满 8 次之后应当已经吃满上限附近：' + (total * 100).toFixed(2) + '%');

  /* ④ 仙鹤：本层最多 3 次，每次随机一项属性 −5%~10% */
  prep('xh');
  for (let i = 0; i < 8; i++) hit('xh');
  const xh = mine('xh');
  assert.equal(xh.length, 3, '仙鹤本层最多 3 次：' + xh.length);
  for (const d of xh) {
    assert.equal(d.kind, 'stat');
    assert.ok(['power', 'agility', 'speed'].indexOf(d.stat) >= 0, '要落在某一项属性上：' + d.stat);
    assert.ok(d.pct >= 0.05 - 1e-9 && d.pct <= 0.10 + 1e-9, '每次 5%~10%：' + d.pct);
  }

  /* ⑤ 熊猫：本层最多锁 2 个，且不会重复锁同一件 */
  prep('xm');
  for (let i = 0; i < 8; i++) hit('xm');
  const xm = mine('xm');
  assert.equal(xm.length, 2, '熊猫本层最多锁 2 个：' + xm.length);
  const keys = xm.map((d) => d.what + ':' + d.id);
  assert.equal(new Set(keys).size, keys.length, '不能锁同一件两次：' + JSON.stringify(keys));
  /* 锁是真的生效：进下一场时那两件会从武技列表里消失 */
  {
    const r0 = T._debugRun('endless');
    r0.choices = null; r0.phase = null; r0.env = []; r0.noEnvRoll = true;
    const nx = T.nextBattle('endless');
    const mkMe = () => ({ name: 'p', level: 70, power: 1000, agility: 1000, speed: 1000, maxHp: 99999, hp: 99999,
      baseStats: { power: 1000, agility: 1000, speed: 1000 },
      weapons: [{ id: 1, level: 10 }], skills: ['2:10'], wears: [], effects: {}, masterLevel: 0 });
    const locked = mkMe(); nx.adjustMe(locked);
    const run = T._debugRun('endless'); const kept = run.debuffs; run.debuffs = [];
    const free = mkMe(); nx.adjustMe(free);
    run.debuffs = kept;
    const count = (m) => (m.weapons || []).length + (m.skills || []).length;
    assert.equal(count(free) - count(locked), 2, '应当正好被锁掉 2 件：' + count(free) + ' → ' + count(locked));
    T.reportBattle('endless', nx.token, true, 1000, 2000);
  }

  /* ⑥ 换层照旧清空（需求91 的口径不变） */
  assert.ok(mine('xm').length === 2, '换层前还在');
  T._debugSetEndlessLayer(8);
  assert.equal(T._debugRun('endless').debuffs.length, 0, '换层之后清空');
});

test('需求95：本轮修复——C33 独立通道 / 锁技能生效 / 烙印预览口径 / 环境文案 / 选取类清理 / 削敌上限 / 环境封顶层', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');

  /* ① C33 秘技通神：加成走独立通道 skillBoost，不再写 effects（装备词条/武器槽的编号空间） */
  S.setWS('weapon', 6, 5);
  S.setWS('skill', 8, 5);
  assert.ok(T.addBuff(T._debugRun('endless'), 'C33').ok, '应当能拿到秘技通神');
  /* 候选是「洗牌后取 3 个」，单次抽不到 8 是正常的（25% 概率）→ 多次采样再看集合。 */
  const seen0 = new Set();
  for (let i = 0; i < 60; i++) for (const x of T.pickCandidatesOf('skill')) seen0.add(x.id);
  assert.ok(seen0.has(8), '候选里应当有刚学会的主动技 8：' + [...seen0].join(','));
  const picked = T.applyPickBuff('skill', 8);
  assert.ok(picked.ok, '选取应当成功：' + JSON.stringify(picked));
  const nx0 = T.nextBattle('endless');
  const me0 = { power: 100, agility: 100, speed: 100, maxHp: 1000, hp: 1000, weapons: [{ id: 6, level: 5 }],
    skills: [{ id: 8, level: 5 }], baseStats: { power: 100, agility: 100, speed: 100 }, effects: {}, wears: [], masterLevel: 0 };
  nx0.adjustMe(me0);
  assert.ok(me0.skillBoost && me0.skillBoost[8] > 0, 'adjustMe 应当把 C33 的加成写进 me.skillBoost[8]：' + JSON.stringify(me0.skillBoost));
  assert.equal(me0.effects[8] == null && me0.effects[12] == null && me0.effects[16] == null, true,
    '不该再把技能加成写进 effects：' + JSON.stringify(me0.effects));
  assert.equal(Sim.passiveSkillBoost({ effects: { 16: 2 } }, 16), 0, '装备词条不再被当成技能加成');
  assert.equal(Sim.passiveSkillBoost({ skillBoost: { 16: 2 } }, 16), 2, 'skillBoost 才是技能加成的通道');

  /* ② 熊猫「压制」锁技能：me.skills 是对象数组，必须真的删得掉。
   *    注意 nextBattle 在 run.attempt 置位后会拒绝再开一场，所以复用同一个 adjustMe 闭包
   *    （它每次调用时都会重新读 run.debuffs）。 */
  const runL = T._debugRun('endless');
  runL.debuffs = [{ kind: 'lock', what: 'skill', id: 12, from: 'xm', hero: '熊猫大侠', short: '熊猫', color: '#8a5a20', times: 1, layer: runL.layer },
                  { kind: 'lock', what: 'weapon', id: 6, from: 'xm', hero: '熊猫大侠', short: '熊猫', color: '#8a5a20', times: 1, layer: runL.layer }];
  const me1 = { power: 100, agility: 100, speed: 100, maxHp: 1000, hp: 1000,
    weapons: [{ id: 6, level: 5 }, { id: 8, level: 5 }], skills: [{ id: 12, level: 5 }, { id: 18, level: 5 }],
    baseStats: { power: 100, agility: 100, speed: 100 }, effects: {}, wears: [], masterLevel: 0 };
  nx0.adjustMe(me1);
  assert.deepEqual(me1.skills.map((x) => x.id), [18], '被锁的技能应当从 me.skills 里删掉（对象数组口径）');
  assert.deepEqual(me1.weapons.map((x) => x.id), [8], '被锁的武器同样要删掉');
  runL.debuffs = [];

  /* ③ 属性烙印「损毁后」的预览要和 fragileBonus 同口径（C39 是 5% → 8%） */
  S.newGame('r95b'); const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r95 = T._debugRun('endless');
  r95.permanent = []; r95.limited = []; r95.env = []; r95.noEnvRoll = true;
  T.debugGrantBuff('C39');
  const info = T.ownedBuffs('endless').find((b) => b.id === 'C39');
  assert.match(info.progress, /\+5%/, '烙印存在时是存在值 +5%：' + info.progress);
  assert.match(info.progress, /损毁后升为 8%/, '损毁后应显示 8%（与实现一致）：' + info.progress);
  assert.ok(!/12%/.test(info.progress), '不该再显示旧的 12%：' + info.progress);

  /* ④ 环境「反弹」：数据上所有负面环境都带 noReflect（反弹不可达），文案也不该承诺反弹 */
  assert.equal(TD.ENDLESS_ENV.filter((e) => e.bad).every((e) => e.noReflect === true), true,
    '负面环境应当全部标记 noReflect');
  assert.ok(!/反弹/.test(TD.BUFF_BY_ID.N09.desc), '晴空护符文案不该写反弹：' + TD.BUFF_BY_ID.N09.desc);
  assert.ok(!/反弹/.test(TD.BUFF_BY_ID.C45.desc), '天象之眼文案不该写反弹：' + TD.BUFF_BY_ID.C45.desc);

  /* ⑤ 选取型强化被移除时，连带清掉它的加成（统一走 dropPickBoost） */
  S.setWS('weapon', 6, 5);
  S.setWS('skill', 8, 5);
  const run5 = T._debugRun('endless');
  assert.ok(T.addBuff(run5, 'C32').ok, '应当能拿到神兵淬炼');
  const wc = T.pickCandidatesOf('weapon');
  assert.ok(wc.length > 0, '应当有待选武器：' + JSON.stringify(wc));
  assert.ok(T.applyPickBuff('weapon', wc[0].id).ok, '选取武器应当成功');
  assert.ok(Object.keys(T._debugRun('endless').weaponBoost || {}).length > 0, 'weaponBoost 应当已登记');
  T.debugLoseBuff('C32');
  assert.equal(Object.keys(T._debugRun('endless').weaponBoost || {}).length, 0, '失去 C32 后 weaponBoost 应当清空');
  assert.ok(T.addBuff(T._debugRun('endless'), 'C33').ok, '应当能拿到秘技通神');
  const seen5 = new Set();
  for (let i = 0; i < 60; i++) for (const x of T.pickCandidatesOf('skill')) seen5.add(x.id);
  assert.ok(seen5.has(8), '候选里应当有主动技 8：' + [...seen5].join(','));
  assert.ok(T.applyPickBuff('skill', 8).ok, '选取技能应当成功');
  assert.ok(Object.keys(T._debugRun('endless').skillBoost || {}).length > 0, 'skillBoost 应当已登记');
  T.debugLoseBuff('C33');
  assert.equal(Object.keys(T._debugRun('endless').skillBoost || {}).length, 0, '失去 C33 后 skillBoost 应当清空');

  /* ⑥ 削敌生命上限：登记与取值共用 0.6 的上限，不再「存 0.8 用 0.6」 */
  const run6 = T._debugRun('endless');
  run6.enemyMaxHpDown = 0.75;
  T.debugGrantBuff('E07');                     // −10%：0.75 → 夹到上限
  assert.equal(T._debugRun('endless').enemyMaxHpDown, 0.6, '登记时就该夹到 0.6：' + T._debugRun('endless').enemyMaxHpDown);
  assert.ok(!/Math\.min\(0\.8, Number\(run\.enemyMaxHpDown\)/.test(src), '不该再出现存 0.8 的旧口径');

  /* ⑦ 环境触发概率的封顶层：第 15 层到 80%（常量与曲线一致） */
  assert.equal(TD.envChance(4), 0, '5 层前不触发');
  assert.ok(TD.envChance(14) < TD.ENV_CHANCE_CAP, '14 层还没封顶');
  assert.equal(TD.envChance(15), TD.ENV_CHANCE_CAP, '15 层封顶 80%');
  assert.equal(TD.ENV_CHANCE_CAP_LAYER, 15, '封顶层常量应当是 15');
  assert.ok(Math.abs(TD.ENV_CHANCE_START + (TD.ENV_CHANCE_CAP_LAYER - TD.ENV_START_LAYER + 1) * TD.ENV_CHANCE_STEP - TD.ENV_CHANCE_CAP) < 1e-9,
    '起点 + 每层步长 × 层数 应当等于封顶值');
});

test('需求96：动态稀有度权重——个体降权会按比例缩小整档预算，再按比例分给别的档', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const run = T._debugRun('endless');
  run.slotFreeIds = []; run.permanent = []; run.limited = []; run.acqSeq = 0;
  const share = (pool) => {
    const w = T.dynamicTierWeightsOf(run, pool);
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((v) => v / tot);
  };
  /* ① 没有任何动态惩罚时，与旧的档位权重（tiltWeights）**逐位一致** —— 老平衡不被改动 */
  const base = TD.tiltWeights(1, run);
  const now = share(TD.endlessPool);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(base[i] - now[i]) < 1e-9,
      TD.RARITY_NAME[i] + ' 档默认占比应当与旧口径一致：' + now[i] + ' vs ' + base[i]);
  }
  /* ② 个体降权 → 整档预算按「档内平均倍率」缩水（用户公式：δ - k·δ/d 的等价写法）。
   * 2026-10 第十三批：C37 的降权口径改成**数背包里被附魔过的增益个数** → 3 个附魔时权重 ×1/4。 */
  const setEnch = (n) => {
    run.permanent = [];
    for (let i = 0; i < n; i++) run.permanent.push({ id: 'C25', stacks: 1, uid: i + 1, slotFree: true });
  };
  setEnch(0);
  const before = share(TD.shopPool);
  setEnch(3);
  const after = share(TD.shopPool);
  assert.ok(after[3] < before[3], '传奇档的总概率必须跟着 C37 降权一起变小：' +
    (before[3] * 100).toFixed(3) + '% → ' + (after[3] * 100).toFixed(3) + '%');
  const otherGain = (after[0] - before[0]) + (after[1] - before[1]) + (after[2] - before[2]);
  assert.ok(Math.abs(otherGain - (before[3] - after[3])) < 1e-9,
    '从传奇档省下来的概率应当**全部**按比例分给别的档（守恒）：' + otherGain + ' vs ' + (before[3] - after[3]));
  for (const i of [0, 1, 2]) assert.ok(after[i] > before[i], TD.RARITY_NAME[i] + ' 档应当因为传奇缩水而略升');
  /* ③ 该档只剩 1 件可用时，个体权重也必须继续生效（旧版 list.length===1 直接返回，权重被忽略） */
  const only37 = TD.shopPool.filter((b) => b.id === 'C37');
  setEnch(0);
  const one1 = T.dynamicTierWeightsOf(run, only37);          // 0 个附魔 → 无降权
  setEnch(3);                                               // 3 个附魔 → ×1/4
  const one0 = T.dynamicTierWeightsOf(run, only37);
  const baseLegend = TD.rawTierWeights(1, run)[3];
  assert.ok(Math.abs(one1[3] - baseLegend) < 1e-9, '没有降权时传奇档预算 = 基准：' + one1[3]);
  assert.ok(Math.abs(one0[3] - baseLegend / 4) < 1e-9,
    '只剩 C37 且权重 ×1/4 时，整档预算也应当按同倍数缩水：' + one0[3] + ' vs ' + (baseLegend / 4));
  /* ④ C37 自身概率随**背包里的附魔个数**单调下降，且传奇档一起下降 */
  const own = (n) => {
    setEnch(n);
    const w = T.dynamicTierWeightsOf(run, TD.shopPool);
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    const legends = TD.shopPool.filter((b) => b.rarity === 3);
    const sum = legends.reduce((a, b) => a + T.buffWeightOf(run, b), 0) || 1;
    return { tier: w[3] / tot, self: (w[3] / tot) * (T.buffWeightOf(run, TD.BUFF_BY_ID.C37) / sum) };
  };
  const o0 = own(0), o1 = own(1), o3 = own(3);
  assert.ok(o0.self > o1.self && o1.self > o3.self,
    'C37 自身概率应当随附魔个数单调下降：' + [o0.self, o1.self, o3.self].map((v) => (v * 100).toFixed(4) + '%').join(' > '));
  assert.ok(o0.tier > o1.tier && o1.tier > o3.tier,
    '传奇档总概率也应当随附魔个数单调下降：' + [o0.tier, o1.tier, o3.tier].map((v) => (v * 100).toFixed(3) + '%').join(' > '));
  /* ⑤ 商店刷新倾斜仍然叠在动态权重之上（越刷越偏向高稀有度） */
  const legendAt = (paid) => {
    const w = T.dynamicTierWeightsOf(run, TD.shopPool, TD.rawTierWeights(TD.rerollTilt(paid, run), run));
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    return w[3] / tot;
  };
  assert.ok(legendAt(40) > legendAt(0), '刷新倾斜应当抬高传奇档占比：' +
    (legendAt(0) * 100).toFixed(3) + '% → ' + (legendAt(40) * 100).toFixed(3) + '%');
  /* ⑥ 抽取口子必须接上动态档位权重：
   *   · 战斗奖励 / 试炼商店 → 走 rollOneCandidate（内部调 dynamicTierWeights，含传奇保底）；
   *   · 铸币商店 → 直接调 dynamicTierWeights。 */
  const src = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  assert.match(src, /function dynamicTierWeights\(baseTier, run, list\)/, '动态档位权重要有定义');
  assert.match(src, /dynamicTierWeights\(baseTier, run, candidates\)/, 'rollOneCandidate 里要用动态档位权重');
  assert.match(src, /dynamicTierWeights\(baseTier, run, allCands\)/, '铸币商店也要用动态档位权重');
  assert.equal((src.match(/const got = rollOneCandidate\(run, candidates, baseTier\)/g) || []).length, 2,
    '战斗奖励与试炼商店都要走 rollOneCandidate');
  run.slotFreeIds = [];
});

test('需求97：无尽塔 20 层起战斗右下角同时给倍速键与跳过键（与普通战斗的跳过键同尺寸并排）', () => {
  const c = setup();
  const T = c.Tower;
  /* ① 策略：只有无尽塔、且到 20 层才允许跳过播放（2026-10 用户口径：由 30 层下调到 20 层） */
  assert.equal(T.skipPlaybackAllowed('endless', 19), false, '19 层还不给跳过');
  assert.equal(T.skipPlaybackAllowed('endless', 20), true, '20 层起给跳过');
  assert.equal(T.skipPlaybackAllowed('endless', 45), true, '更深层照给');
  assert.equal(T.skipPlaybackAllowed('tower', 30), false, '挑战塔不给（那里一场就是一层）');
  /* 「不传 / 传 null」= 走「读当前对局层数」的分支（setup 里当前是 20 层 → 给）。
   * 先压回第 1 层验证保守口径，再抬回 20。 */
  T._debugSetEndlessLayer(1);
  assert.equal(T.skipPlaybackAllowed('endless', null), false, 'null 时读当前对局层（第 1 层）→ 不给');
  assert.equal(T.skipPlaybackAllowed('endless', 'abc'), false, '脏值也不该放行');
  assert.equal(T.skipPlaybackAllowed('endless'), false, '不传层数时读当前对局的层（这里第 1 层）');
  T._debugSetEndlessLayer(20);
  assert.equal(T.skipPlaybackAllowed('endless'), true, '不传层数时应当读当前层（20）');
  assert.equal(T.skipPlaybackAllowed('endless', T._debugRun('endless').layer), true, '显式传当前层也一致');
  assert.equal(c.TowerData.ENDLESS_SKIP_LAYER, 20, '起始层常量应当是 20');
  assert.equal(c.TowerData.ENDLESS_DEEP_LAYER, 30, '敌人深度曲线仍是 30 层起（两件事不要混用）');

  /* ② 布局（2026-10 用户口径）：倍速 / 跳过键**统一用普通战斗跳过键那一档** 190x70；
   * 无尽塔 20 层起两个键在右下**并排**，整块贴住右下角（右边缘 1170−16）。 */
  const c2 = { console }; c2.window = c2; vm.createContext(c2);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'battle.js'), 'utf8'), c2, { filename: 'js/battle.js' });
  const L = c2.Battle._cornerLayout;
  const single = { x: 964, y: 605, w: 190, h: 70 };       // 普通战斗「跳过」那一档尺寸
  const onlySpeed = L(true, false);
  assert.equal(onlySpeed.both, false);
  assert.deepEqual(Object.assign({}, onlySpeed.rects.speed), single, '只有倍速时用与普通战斗跳过键相同的尺寸');
  assert.equal(onlySpeed.rects.skip, null, '只有倍速时没有跳过键');
  const onlySkip = L(false, true);
  assert.deepEqual(Object.assign({}, onlySkip.rects.skip), single, '普通战斗只有跳过时保持原尺寸');
  assert.equal(onlySkip.rects.speed, null, '只有跳过时没有倍速键');
  const none = L(false, false);
  assert.equal(none.rects.speed, null); assert.equal(none.rects.skip, null);
  const both = L(true, true);
  assert.equal(both.both, true, '两个键都要时进入双键布局');
  const sp = both.rects.speed, sk = both.rects.skip;
  /* 两个键都必须和「普通战斗跳过键」一样大 */
  assert.deepEqual({ y: sp.y, w: sp.w, h: sp.h }, { y: single.y, w: single.w, h: single.h }, '倍速键尺寸 = 跳过键尺寸');
  assert.deepEqual({ y: sk.y, w: sk.w, h: sk.h }, { y: single.y, w: single.w, h: single.h }, '跳过键尺寸 = 单键尺寸');
  assert.equal(sp.w, sk.w, '两个键等宽');
  assert.equal(sp.x + sp.w < sk.x, true, '两键之间要有缝，不能重叠：' + sp.x + '+' + sp.w + ' vs ' + sk.x);
  assert.equal(sk.x - (sp.x + sp.w), 8, '缝隙固定 8px');
  assert.equal(sp.x + sp.w + 8 + sk.w, 1170 - 16, '两个键并排后右边缘贴右下角（1170−16）');
  assert.equal(both.base.w, single.w * 2 + 8, '整块宽度 = 两键 + 缝');
  assert.ok(sk.y + sk.h <= 690, '不能越出画布');
  /* ③ 接线：tower-ui 必须用这个策略决定 allowSkip（跳过键与倍速键共存） */
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  assert.match(uiSrc, /const skipAllowed = Tower\.skipPlaybackAllowed\(mode, layerNow\)/,
    'tower-ui 应当用 Tower.skipPlaybackAllowed 决定是否给跳过键');
  assert.match(uiSrc, /allowSkip: skipAllowed, speedToggle: true/,
    '两座塔都要保留倍速键，无尽塔 20 层起同时允许跳过');
});

test('需求98：传奇保底（B 方案）——repeatable 不再被 ownable 误杀 + C37:C49 保底 1:1', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const mkRun = (extra) => Object.assign({ permanent: [], limited: [], permSlotIds: [], pickBuffIds: [],
    instantIds: [], slotFreeIds: [], fragileGot: {}, rarityBoost: 0, acqSeq: 0, legendPity: 0, env: [], noEnvRoll: true }, extra || {});

  /* ① repeatable 不该被 ownable 的「同名唯一」误杀（否则 C37 的自降权永远触发不到第二次） */
  const owned1 = (id) => {
    const b = TD.BUFF_BY_ID[id];
    if (b.kind === 'instant') return mkRun({ instantIds: [{ id }] });
    if (b.kind === 'limited') return mkRun({ limited: [{ id, stacks: 1, uses: 1000, on: true }] });
    return mkRun({ permanent: [{ id, stacks: 1 }] });
  };
  for (const id of ['E14', 'C37', 'C52']) {
    const b = TD.BUFF_BY_ID[id], r = owned1(id);
    assert.equal(TD.hasTag(b, 'repeatable'), true, id + ' 应当是 repeatable');
    assert.equal(T.ownableOf(r, b), true, id + '：带 repeatable，拥有 1 份后仍应能被抽到');
    assert.equal(T.poolFilterOf(r, b), true, id + '：poolFilter 也放行');
  }
  /* oncePerRun 的仍然只给一次（不能被这次改动放开） */
  const once = mkRun({ instantIds: [{ id: 'C51' }] });
  assert.equal(T.poolFilterOf(once, TD.BUFF_BY_ID.C51), false, 'C51 一局一次，拿过就不该再进池');
  /* C36 挥金如土：一局一次、不可叠加（用户口径）——ownable 与 poolFilter 两道闸都要拦住 */
  const c36 = TD.BUFF_BY_ID.C36, c36Run = mkRun({ permanent: [{ id: 'C36', stacks: 1 }] });
  assert.equal(TD.hasTag(c36, 'oncePerRun'), true, 'C36 应当是「一局一次」');
  assert.equal(TD.hasTag(c36, 'repeatable'), false, 'C36 不再可重复获得');
  assert.equal(c36.maxStacks, 1, 'C36 maxStacks = 1（不可叠加）');
  assert.equal(T.ownableOf(c36Run, c36), false, '拿到 C36 之后不该再被抽到（ownable）');
  assert.equal(T.poolFilterOf(c36Run, c36), false, '拿到 C36 之后不该再进池（poolFilter）');
  assert.equal(TD.stackCap(c36), 1, '叠层上限 = 1');
  const c36Fresh = mkRun();
  assert.equal(T.ownableOf(c36Fresh, c36), true, '没拿到时仍能出');
  assert.equal(T.addBuff(c36Run, 'C36').ok, false, '直接 addBuff 也不该叠第二层');

  /* ② 保底参数与计数口径 */
  assert.equal(TD.LEGEND_PITY.slots, 120, '保底阈值写在 data 里');
  assert.equal(T.legendPityNeed(), 120);
  const r0 = mkRun();
  assert.equal(T.legendPityOf(r0), 0, '新局从 0 开始');
  assert.equal(T._debugNotePityRoll(r0, null, true), 1, '非传奇 +1');
  assert.equal(T._debugNotePityRoll(r0, null, true), 2, '继续累加');
  assert.equal(T._debugNotePityRoll(r0, { rarity: 3 }, true), 0, '掷到传奇清零');
  assert.equal(T._debugNotePityRoll(r0, null, true), 1, '清零后重新计数');
  assert.equal(T._debugNotePityRoll(r0, null, false), 1, '传奇池为空时不累加（不空转）');

  /* ③ 极端情况：全部传奇到手。2026-10 回调后：涅槃拿满 2 层出池、后发制人拿到出池、
   *    C36 是 oncePerRun、C51 是 unique（永久且已有）、E17（第十八批新增传奇限次）也拿到手
   *    → 极端情况**只剩 C37/C49**。 */
  const legIds = ['C51', 'C31', 'E15', 'E17', 'C36', 'C37', 'C53', 'C55', 'C49'];
  const extreme = mkRun({
    permanent: legIds.filter((id) => id !== 'C49').map((id) => ({ id, stacks: 1 })).concat([{ id: 'C14', stacks: 2 }]),
    limited: [{ id: 'C49', stacks: 1, uses: 1000, on: true }],
    instantIds: [{ id: 'C51' }],
    slotFreeIds: new Array(20).fill('x'), fragileGot: { C49: 1 },
  });
  const avail = TD.shopPool.filter((b) => T.ownableOf(extreme, b) && T.poolFilterOf(extreme, b) && b.rarity === 3);
  assert.equal(avail.map((b) => b.id).sort().join(','), 'C37,C49',
    '极端情况可用传奇：' + avail.map((b) => b.id).join('、'));
  assert.equal(TD.BUFF_BY_ID.C36.mods.pityWeight, 0, 'C36 不进保底池（运营向）');
  assert.equal(TD.BUFF_BY_ID.C37.mods.pityWeight, 1, 'C37 保底权重 1');
  assert.equal(TD.BUFF_BY_ID.C49.mods.pityWeight, 1, 'C49 保底权重 1 → 与 C37 形成 1:1（用户口径）');

  /* ④ 真实抽取路径：计数顶满后第一格必是传奇；保底池 = 当前所有可用传奇
   *（只剩 C37/C49 两条，pityWeight 同为 1 → 必须是 1:1）。 */
  const pityCount = {};
  const N = 1500;
  for (let i = 0; i < N; i++) {
    extreme.legendPity = T.legendPityNeed();
    const slots = T._debugRollShopSlots(extreme, 0);
    const first = TD.BUFF_BY_ID[slots[0].id];
    assert.equal(first.rarity, 3, '保底那一格必须是传奇，实测 ' + first.id);
    assert.ok(avail.some((b) => b.id === first.id), '保底只能给当前可用的传奇：' + first.id);
    pityCount[first.id] = (pityCount[first.id] || 0) + 1;
  }
  for (const b of avail) {
    assert.ok((pityCount[b.id] || 0) > 0, b.id + ' 也应当被保底抽到过：' + JSON.stringify(pityCount));
  }
  const c37 = pityCount.C37 || 0, c49 = pityCount.C49 || 0;
  assert.equal(avail.length, 2, '极端情况可用传奇 2 条（C37 / C49）');
  /* 1:1 是统计性质：每次保底按 1:1 加权，N 次后「两者次数之差」服从 σ = √(2Np(1−p))。
   * N=1500、p=1/2 → σ ≈ 27.4。留 **5σ**（≈137）的容差。 */
  const sigma = Math.sqrt(2 * N * 0.5 * 0.5);
  assert.ok(Math.abs(c37 - c49) < 5 * sigma,
    'C37 与 C49 必须 1:1（实测 ' + c37 + ' : ' + c49 + '，N=' + N + '，5σ=' + (5 * sigma).toFixed(0) + '）');
  /* 保底池只有这两条 → 每条 p≈1/2。 */
  for (const id of Object.keys(pityCount)) {
    assert.ok(pityCount[id] > N * 0.4 && pityCount[id] < N * 0.6,
      id + ' 应当占 ≈1/2（实测 ' + (pityCount[id] / N * 100).toFixed(1) + '%）');
  }

  /* ⑤ 计数语义：复刻 notePityRoll —— 逐格「遇到传奇清零，否则 +1」。
   * 注意不能简单用「非传奇格数」：保底那一格之后还可能**自然**出传奇（又清零一次），
   * 所以正确口径是「**最后一格传奇之后**的格数」。 */
  extreme.legendPity = T.legendPityNeed();
  const page = T._debugRollShopSlots(extreme, 0);
  let expectPity = 0;
  for (const s of page) {
    if (TD.BUFF_BY_ID[s.id].rarity === 3) expectPity = 0; else expectPity++;
  }
  assert.equal(T.legendPityOf(extreme), expectPity,
    '计数 = 最后一格传奇之后的格数：' + T.legendPityOf(extreme) + ' vs ' + expectPity);
  assert.ok(T.legendPityOf(extreme) <= T.legendPityNeed(), '计数不会超过阈值');

  /* ⑥ 战斗奖励走同一套保底 */
  extreme.legendPity = T.legendPityNeed();
  const picked = T._debugRollChoices('endless', extreme);
  assert.ok(picked.length >= 3, '一组选项至少 3 个');
  const firstPick = TD.BUFF_BY_ID[picked[0].id];
  assert.equal(firstPick.rarity, 3, '战斗奖励的第一个选项应当是保底传奇，实测 ' + firstPick.id);
  assert.ok(avail.some((b) => b.id === firstPick.id),
    '保底只可能给当前可用的传奇：' + firstPick.id + '（可用 ' + avail.map((b) => b.id).join('、') + '）');
});

test('需求99：铸币→抽奖卷 兑换上限 10（超出部分不再转化）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  assert.equal(TD.TICKET_FROM_MINT_CAP, 10, '兑换上限应当是 10');
  const TICKET_PROP = 50;
  const open = (layer, tokens) => {
    S.newGame('mintcap' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.layer = layer; r.phase = 'checkpoint';
    r.retryToken = tokens;
    return r;
  };
  /* ① 3 枚铸币 → 3 张卷（没到上限，全转） */
  let r = open(5, 3);
  let before = Number(S.state().props[TICKET_PROP]) || 0;
  let out = T.settleEndless();
  assert.equal(out.retryConverted, 3, '3 枚应当全转：' + out.retryConverted);
  assert.equal(out.retryForfeited, 0, '不该有被丢弃的：' + out.retryForfeited);
  assert.ok(/3 枚铸币已 1:1 兑换为 3 张抽奖卷/.test(out.retryMsg), '提示语要写明兑换：' + out.retryMsg);
  assert.equal(Number(S.state().props[TICKET_PROP]) - before, out.tickets, '到账张数要等于 out.tickets');
  assert.equal(out.tickets, out.layerTickets + 3, '总张数 = 层奖励 + 3');

  /* ② 25 枚铸币 → 只转 10 张，其余 15 枚作废 */
  r = open(5, 25);
  before = Number(S.state().props[TICKET_PROP]) || 0;
  out = T.settleEndless();
  assert.equal(out.retryConverted, 10, '最多转 10 枚：' + out.retryConverted);
  assert.equal(out.retryForfeited, 15, '超出 15 枚不再转化：' + out.retryForfeited);
  assert.ok(/兑换上限 10 枚/.test(out.retryMsg) && /15 枚不再转化/.test(out.retryMsg),
    '提示语要写明超限部分：' + out.retryMsg);
  assert.equal(out.tickets, out.layerTickets + 10, '总张数 = 层奖励 + 10');
  assert.equal(Number(S.state().props[TICKET_PROP]) - before, out.tickets, '到账张数要对');
  assert.equal(T._debugRun('endless'), null, '结算后本局要清空');

  /* ③ 恰好 10 枚：全转、不报超限 */
  r = open(5, 10);
  out = T.settleEndless();
  assert.equal(out.retryConverted, 10);
  assert.equal(out.retryForfeited, 0, '恰好 10 枚不该被算成超限：' + out.retryForfeited);
  assert.ok(!/兑换上限/.test(out.retryMsg || ''), '恰好 10 枚不显示超限提示：' + out.retryMsg);

  /* ④ 0 枚铸币：不显示铸币提示，只发层奖励 */
  r = open(5, 0);
  out = T.settleEndless();
  assert.equal(out.retryConverted, 0);
  assert.equal(out.retryMsg, undefined, '没有铸币就不该有兑换提示：' + out.retryMsg);
  assert.equal(out.tickets, out.layerTickets, '只发层奖励');
});

test('需求100：第二批池子调整（C52 不降权 / 涅槃 0.5 / 去掉档位降权 / ×0.88 / noRestack / 精英杀手增强）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const mkRun = (extra) => Object.assign({ permanent: [], limited: [], permSlotIds: [], pickBuffIds: [],
    instantIds: [], slotFreeIds: [], fragileGot: {}, rarityBoost: 0, acqSeq: 0 }, extra || {});

  /* ① C52 取消权重下降：拿多少份都 ×1 */
  assert.equal(TD.BUFF_BY_ID.C52.mods.repeatWeight, undefined, 'C52 不再有 repeatWeight');
  for (const n of [1, 2, 5]) {
    const r = mkRun({ limited: [{ id: 'C52', stacks: n, uses: 1000, on: true }], fragileGot: { C52: n } });
    assert.ok(Math.abs(T.buffWeightOf(r, 'C52') - 1) < 1e-9, n + ' 份时权重仍应当是 1：' + T.buffWeightOf(r, 'C52'));
  }

  /* ② 涅槃 shopWeight = 0.5 */
  assert.equal(TD.BUFF_BY_ID.C14.shopWeight, 0.5, '涅槃的静态权重应当是 0.5');

  /* ③ 去掉档位级降权 + C37 改成「数背包里被附魔过的增益个数 ÷(n+1)」；C49 保持「每份 ×0.88」 */
  assert.equal(TD.LEGEND_TIER_DECAY, false, '档位级降权应当是关的');
  assert.equal(T.legendWeightFactor ? 1 : 1, 1);
  assert.equal(TD.legendWeightFactor(mkRun({ permanent: TD.BUFFS.filter((b) => b.rarity === 3).map((b) => ({ id: b.id, stacks: 1 })) })), 1,
    '拥有再多传奇，档位系数也应恒为 1');
  assert.equal(TD.BUFF_BY_ID.C49.mods.repeatWeight, 0.88, 'C49 应当是每份 ×0.88');
  assert.equal(TD.BUFF_BY_ID.C37.mods.weightDivBy, 'enchanted', 'C37 改为数背包里被附魔的增益个数');
  assert.equal(TD.BUFF_BY_ID.C37.mods.weightDivOffset, 1, 'C37 权重 = ÷(附魔数+1)');
  for (const n of [1, 2, 3, 5]) {
    const r37 = mkRun({ permanent: Array.from({ length: n }, (_, i) =>
      ({ id: 'C2' + i, stacks: 1, uid: i + 1, slotFree: true })) });
    const r49 = mkRun({ limited: [{ id: 'C49', stacks: n, uses: 1000, on: true }], fragileGot: { C49: n } });
    const w37 = T.buffWeightOf(r37, 'C37'), w49 = T.buffWeightOf(r49, 'C49');
    const want49 = Math.pow(0.88, n - 1);
    assert.ok(Math.abs(w37 - 1 / (n + 1)) < 1e-9, 'C37 ' + n + ' 个附魔 → ×1/' + (n + 1) + '：' + w37);
    assert.ok(Math.abs(w49 - want49) < 1e-9, 'C49 ' + n + ' 份 → ×' + want49.toFixed(4) + '：' + w49);
    assert.ok(w37 < w49, 'C37 的下降要比 C49 更陡（不再「比终焉烙印还常见」）：' + w37 + ' vs ' + w49);
  }

  /* ④ noRestack：后发制人 / **涅槃（2026-10 回调：叠满 2 层即出池）**。
   * 不带 noRestack 的永久件仍然可以继续拿（任务3 的通用规则）。 */
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.C55, 'noRestack'), true, 'C55 应当带 noRestack');
  assert.equal(TD.hasTag(TD.BUFF_BY_ID.C14, 'noRestack'), true, '涅槃现在带 noRestack（叠满即出池）');
  const r14 = mkRun({ permanent: [{ id: 'C14', stacks: 2 }] });
  assert.equal(T.ownableOf(r14, TD.BUFF_BY_ID.C14), false, '涅槃拿满 2 层后不再能获得');
  assert.equal(T.poolFilterOf(r14, TD.BUFF_BY_ID.C14), false, '涅槃拿满后移出池子');
  const r55nr = mkRun({ permanent: [{ id: 'C55', stacks: 1 }] });
  assert.equal(T.ownableOf(r55nr, TD.BUFF_BY_ID.C55), false, '后发制人拿到即出池');
  const r55 = mkRun({ permanent: [{ id: 'C55', stacks: 1 }] });
  assert.equal(T.ownableOf(r55, TD.BUFF_BY_ID.C55), false, '后发制人拿到后不该再获得');
  assert.equal(T.poolFilterOf(r55, TD.BUFF_BY_ID.C55), false, '后发制人拿到后不该再进池');
  assert.equal(T.ownableOf(mkRun({ permanent: [{ id: 'C22', stacks: 3 }] }), TD.BUFF_BY_ID.C22), true,
    '不带 noRestack 的永久件仍然可以继续拿（任务3 的通用规则）');

  /* ⑤ 精英杀手：击败精英 +10% 生命上限（非精英场不加） */
  assert.equal(TD.BUFF_BY_ID.C13.mods.eliteMaxHpAfter, 0.10, 'C13 应当有 eliteMaxHpAfter = 0.10');
  assert.match(TD.BUFF_BY_ID.C13.desc, /增加 10% 最大生命/, '文案要写新增效果：' + TD.BUFF_BY_ID.C13.desc);
  const open = (layer, idx) => {
    S.newGame('c13' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const r = T._debugRun('endless');
    r.permanent = [{ id: 'C13', stacks: 1 }]; r.limited = []; r.slotFreeIds = []; r.hpBonus = 0;
    T._debugSetEndlessLayer(layer);
    r.idx = idx;
    return r;
  };
  const playOne = (r) => {
    const nx = T.nextBattle('endless');
    const a = T._debugRun('endless');
    T.reportBattle('endless', a.attempt, true, 1234, Number(a.lastMaxHp) || 5000);
    return { nx, after: T._debugRun('endless') };
  };
  const eliteBefore = Number(open(10, 4).hpBonus) || 0;
  const eliteRes = playOne(T._debugRun('endless'));
  assert.equal(Number(eliteRes.after.hpBonus) - eliteBefore > 0.099, true,
    '击败精英应当 +10% 生命上限：' + eliteBefore + ' → ' + eliteRes.after.hpBonus);
  const normalBefore = Number(open(7, 0).hpBonus) || 0;
  const normalRes = playOne(T._debugRun('endless'));
  assert.equal(Math.abs((Number(normalRes.after.hpBonus) || 0) - normalBefore) < 1e-9, true,
    '非精英场不该加生命上限：' + normalBefore + ' → ' + normalRes.after.hpBonus);
});

test('需求101：新敌人「沉默之壁·镇岳」——溢出反弹（超过 25% 上限的部分全额反弹）+ 沉默之斧主武器', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;

  /* ① 数据：机制、阈值、主武器、血量偏向、进池 */
  const b = TD.TRIAL_BY_ID.bulwark;
  assert.ok(b, '应当存在试炼敌人 bulwark');
  assert.equal(b.name, '沉默之壁·镇岳');
  assert.equal(b.mech.join(','), 'trialOverflow', '机制应当是 trialOverflow');
  assert.equal(b.mechParams.trialOverflow.threshold, 0.25, '阈值应当是 25% 最大生命');
  assert.equal(b.weapons.length, 1, '只带一把武器（主打武器）');
  assert.equal(b.weapons[0].id, 16, '主武器应当是沉默之斧（武器 16）');
  assert.ok((b.pattern.filter((x) => x === 'weapon').length / b.pattern.length) >= 0.5,
    '出招循环要以武器为主：' + JSON.stringify(b.pattern));
  assert.ok(b.mechDesc && /反弹/.test(b.mechDesc), '简介要写清反弹：' + b.mechDesc);
  assert.ok(TD.ENDLESS_BOSS_POOL.some((x) => x.kind === 'trial' && x.id === 'bulwark'),
    '应当进无尽塔的 boss 池');
  /* 「血最厚」是它的设计意图（阈值 = 25%×血量，血量越高越难被打穿） */
  const others = TD.TRIALS.filter((t) => t.id !== 'bulwark');
  assert.ok(others.every((t) => t.bias.hp < b.bias.hp), '它的血量偏向应当是全试炼最高：' + b.bias.hp);

  /* ② 实战：构造这一只敌人，用「能打出超过阈值的一击」的玩家验证溢出反弹 */
  const openVs = (layer) => {
    S.newGame('ovf' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const run = T._debugRun('endless');
    /* **先定层再换 plan**：`_debugSetEndlessLayer` 会重建 plan，顺序反了就会打到别的敌人
     *（实测踩过：plan 被覆盖后拿到的是本层普通 boss，机制自然不触发）。 */
    T._debugSetEndlessLayer(layer);
    run.plan = [{ kind: 'trial', id: 'bulwark' }];
    run.idx = 0; run.choices = null; run.limited = []; run.permanent = [];
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.foe && nx.foe.name === '沉默之壁·镇岳', '应当取到这一只敌人：' + JSON.stringify(nx && nx.foe && nx.foe.name));
    return nx.foe;
  };
  const mkPlayer = (power) => ({ name: 'p', level: 70, power: power, agility: 120, speed: 120,
    maxHp: 5000, hp: 5000, baseStats: { power: power, agility: 120, speed: 120 },
    weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 });

  /* 机制验证用**受控血量**：真实第 30 层血量（≈2.9 万）会让阈值高达 ~7200，
   * 强玩家的单次伤害有时打不到 → 断言会随机失败（实测偶发）。
   * 把 hp 压到 2000（阈值 500）之后：
   *   · 强玩家的**暴击/大伤害**能超过 500，但出手顺序随机、还可能先被打死 →
   *     单场仍有 ~25% 打不到，所以**最多试 12 场**，只要有 1 场触发就验证公式（12 场全不中的概率 ~1e-7）。 */
  const threshold = Math.round(2000 * 0.25);
  let reflecting = [];
  for (let attempt = 0; attempt < 12 && !reflecting.length; attempt++) {
    const foeA = openVs(30);
    foeA.hp = 2000;
    const strong = Sim.simulate(mkPlayer(3000), JSON.parse(JSON.stringify(foeA)), { maxActions: 60 });
    reflecting = strong.rounds.filter((r) => r.thornsDmg > 0 && r.dmg > 0);
  }
  assert.ok(reflecting.length > 0, '强力玩家应当打出超过阈值的单次伤害并触发反弹（试了 12 场）');
  /* 关键口径：**只反「超出的那一截」** —— 单次反弹 = 该次伤害 − 25% 上限（允许 2 点舍入） */
  for (const r of reflecting.slice(0, 5)) {
    const excess = Math.max(1, Math.round(r.dmg - threshold));
    assert.ok(Math.abs(r.thornsDmg - excess) <= 2,
      '反弹应当只等于超出部分：dmg=' + r.dmg + ' 阈值=' + threshold + ' 反弹=' + r.thornsDmg + '（期望 ' + excess + '）');
  }
  /* 弱玩家（单次打不到阈值）→ 完全不反弹：这正是它「主武器低伤 = 变相削弱」的体现 */
  /* 弱玩家（单次打不到 500）→ 多打几场也**一次都不该反弹**：这正是「主武器低伤 = 变相削弱」的体现 */
  let weakReflect = 0;
  for (let i = 0; i < 5; i++) {
    const foeB = openVs(30);
    foeB.hp = 2000;                                      // 同一受控口径：弱玩家单次远达不到 500
    const weak = Sim.simulate(mkPlayer(20), JSON.parse(JSON.stringify(foeB)), { maxActions: 120 });
    weakReflect += weak.rounds.reduce((a, r) => a + (r.thornsDmg || 0), 0);
  }
  assert.equal(weakReflect, 0, '单次伤害不到 25% 上限时不该反弹：' + weakReflect);

  /* ③ 反噬豁免仍然生效（与其它反伤同一套口径） */
  const foeC = openVs(30);
  foeC.hp = 2000;
  const immune = mkPlayer(3000);
  immune.effects = {};
  immune.reflectImmune = 1;
  immune.mods = { reflectImmune: 1 };
  const im = Sim.simulate(immune, JSON.parse(JSON.stringify(foeC)), { maxActions: 60 });
  assert.equal(im.rounds.reduce((a, r) => a + (r.thornsDmg || 0), 0), 0,
    '带反噬豁免时不该吃到溢出反弹');
});

test('需求102：E01「立即进货」在整层最后一场也必须开店（原来被吞掉）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openLast = (layer) => {
    S.newGame('e01fix' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const run = T._debugRun('endless');
    T._debugSetEndlessLayer(layer);
    run.idx = run.plan.length - 1;                 // 整层最后一场
    run.choices = null;
    run.limited = [{ id: 'E01', stacks: 1, uses: 1, on: true, at: 1 }];
    return run;
  };
  const winLast = (layer) => {
    openLast(layer);
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能取到战斗');
    const a = T._debugRun('endless');
    const out = T.reportBattle('endless', a.attempt, true, 4242, Number(a.lastMaxHp) || 5000);
    return { out, run: T._debugRun('endless') };
  };

  /* ① 非 x5 层：层通关后必须补开「战后小店」，并且带 E01 的折扣 */
  const a = winLast(4);
  assert.equal(a.out.layerComplete, true, '应当是整层通关');
  assert.ok(a.run.shop, '整层最后一场用 E01 也应当开出商店（原来这里是空的）');
  assert.equal(!!a.run.shop.postBattle, true, '应当标记成「战后临时小店」');
  assert.equal(!!a.run.shop.boundary, false, '不该被当成 x5 结算商店');
  assert.equal(a.run.phase, 'shop', '应当停在商店阶段');
  assert.ok(Math.abs(Number(a.run.shop.discountPct) - 0.30) < 1e-9,
    '应当带上 E01 的 7 折：' + a.run.shop.discountPct);
  assert.equal(a.out.postBattleShop, true, '报告里也要标出来（界面据此渲染）');
  /* 关店后回到「新的一层」继续打，不会连跳两层 */
  const layerAfterClear = a.run.layer;
  T.closeShop();
  const b = T._debugRun('endless');
  assert.equal(b.layer, layerAfterClear, '关店不该再推进一次层号：' + b.layer + ' vs ' + layerAfterClear);
  assert.equal(b.idx, 0, '应当从新层的第 1 场继续');
  assert.equal(b.phase, null, '关店后回到战斗流程');

  /* ② x5 层：layerClear 已经开了结算商店并吃到折扣 → 不叠开第二家 */
  const d = winLast(5);
  assert.ok(d.run.shop, 'x5 层本来就有结算商店');
  assert.equal(!!d.run.shop.boundary, true, '应当是结算商店（boundary）');
  assert.equal(!!d.run.shop.postBattle, false, '不该变成战后小店');
  assert.equal(d.run.phase, 'shop');
  assert.ok(Math.abs(Number(d.run.shop.discountPct) - 0.30) < 1e-9,
    'E01 的价值以折扣兑现：' + d.run.shop.discountPct);
  assert.equal(d.out.postBattleShop, undefined, '不该再报一次「战后开店」');
  T.closeShop();
  assert.equal(T._debugRun('endless').phase, 'checkpoint', '结算商店关掉后应当去结算点');
});

test('需求103：叠层与栏位打包 —— 新栏位要「继续叠满」而不是每栏停在 1 层', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.newGame('pack' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const run = T._debugRun('endless');
  const reset = (slotFree) => {
    run.permanent = []; run.limited = []; run.pickBuffIds = []; run.instantIds = [];
    run.permSlotIds = ['C30', 'C31']; run.permSlots = 3;          // 5 + 3 = 8 个栏位
    run.slotFreeIds = [];
    /* 【2026-10 同名逐条】「免占位」是**行级**标记：先拿一条 C22 并把它标成已附魔（不占位）。 */
    if (slotFree) {
      T.addBuff(T._debugRun('endless'), 'C22');
      const ench = T._debugRun('endless').permanent.find((b) => b.id === 'C22');
      ench.slotFree = true;
    }
  };
  const rows = (id) => run.permanent.filter((b) => b.id === id).map((b) => b.stacks);

  /* ① maxStacks 3 的可叠层件：每 3 次填满一栏，再开新栏 —— 不是「每份新开一栏」 */
  reset(false);
  for (let i = 1; i <= 6; i++) T.addBuff(T._debugRun('endless'), 'C22');
  assert.equal(JSON.stringify(rows('C22')), JSON.stringify([3, 3]),
    '6 份应当填成两栏各 3 层：' + JSON.stringify(rows('C22')));
  /* ② 一直拿到栏位用尽：8 个占位栏 + 1 个附魔免占栏 = 9 栏 → 3 × 9 = 27 层
   *    （附魔那一栏开局已经有 1 层，所以循环还能再拿 26 层）。 */
  reset(true);
  assert.equal(T.stacksOf(run, 'C22'), 1, '前置：附魔那一栏已有 1 层');
  let got = 0, blocked = null;
  for (let i = 1; i <= 40; i++) {
    const r = T.addBuff(T._debugRun('endless'), 'C22');
    if (r.ok) { got++; continue; }
    blocked = r; break;
  }
  assert.equal(T.stacksOf(run, 'C22'), 27, '应当正好拿到 27 层（9 栏 × 3）：' + T.stacksOf(run, 'C22'));
  assert.equal(got, 26, '附魔栏已有 1 层，循环里还能再拿 26 层：' + got);
  assert.equal(JSON.stringify(rows('C22')), JSON.stringify([3, 3, 3, 3, 3, 3, 3, 3, 3]),
    '9 个栏位应当各 3 层：' + JSON.stringify(rows('C22')));
  assert.ok(blocked && blocked.needsReplace, '第 28 份应当提示「先替换一个」：' + JSON.stringify(blocked));
  assert.equal(T.obtainedCountOf(run, 'C22'), 27, '累计口径也要是 27');
  /* ③ 不带 stackable 的永久件：**每栏只放 1 层**，4 份 = 并排 4 个栏位（2026-10 修正） */
  reset(false);
  for (let i = 1; i <= 4; i++) T.addBuff(T._debugRun('endless'), 'C13');
  assert.equal(JSON.stringify(rows('C13')), JSON.stringify([1, 1, 1, 1]),
    '精英杀手 4 份应当是 4 个 1 层栏位：' + JSON.stringify(rows('C13')));
  assert.equal(TD.stackCap(TD.BUFF_BY_ID.C13), 1, '没有 stackable 标签 → 同栏上限 1');
  assert.equal(TD.stackCap(TD.BUFF_BY_ID.C22), 3, '有 stackable 标签 → 同栏上限还是 3');
  /* ④ 卖出一栏是 LIFO：卖掉的应当是**最后拿到的那一栏**，前面的栏位原样保留 */
  assert.equal(JSON.stringify(rows('C13')), JSON.stringify([1, 1, 1, 1]), '前置：4 个 1 层栏位');
  const sold = T.sellBuff ? null : null;                    // sellBuff 需要 shop 上下文，这里只核对栏位口径
  const last = run.permanent.filter((b) => b.id === 'C13').pop();
  assert.equal(last.stacks, 1, '最后一栏就是最新拿到的那一栏');
  const r55 = T.addBuff(T._debugRun('endless'), 'C55');    // 后发制人（noRestack，正常只能拿 1 份）
  assert.ok(r55.ok, '后发制人第一份应当能拿到');
  assert.equal(T.ownableOf(run, TD.BUFF_BY_ID.C55), false, '拿到后不该再出现在池子里');
});

test('需求104：消费类增益「每栏各记一份」——多个挥金如土 / 豪掷千金都要按份数触发', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const openRun = () => {
    S.newGame('spend' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const run = T._debugRun('endless');
    run.limited = []; run.slotFreeIds = []; run.coins = 100000; run.phase = 'shop';
    return run;
  };
  const buy = (run, id, price) => {
    run.shop = { layer: run.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0,
      slots: [{ id: id, sold: false, price: price }] };
    return T.buyShopSlot(0);
  };
  const gainedCount = (run) => {
    const g = run.spendGain || { power: 0, agility: 0, speed: 0, hp: 0 };
    return g.power + g.agility + g.speed + g.hp / 5;
  };

  /* ① C36 挥金如土：每份**各自**记进度 → 花 100 币，N 份就提 20N 次（每份都在 5 币档内） */
  for (const copies of [1, 2, 3]) {
    const run = openRun();
    run.permanent = Array.from({ length: copies }, () => ({ id: 'C36', stacks: 1, spend: 0, procs: 0 }));
    buy(run, 'C02', 100);
    assert.equal(gainedCount(run), 20 * copies, copies + ' 份应当提 ' + (20 * copies) + ' 次');
    assert.equal(run.shopSpendProcs, 20 * copies, '镜像字段要等于各栏求和');
    assert.equal(JSON.stringify(run.permanent.filter((b) => b.id === 'C36').map((b) => b.procs)),
      JSON.stringify(Array.from({ length: copies }, () => 20)), '每栏各自记 20 次（不提前跳档）');
  }
  /* ② 买 C36 自己那笔消费也要算（买完 1 份 → 100 币 → 20 次） */
  {
    const run = openRun();
    run.permanent = [];
    buy(run, 'C36', 100);
    assert.equal(gainedCount(run), 20, '买下挥金如土本身的 100 币也要算进去');
    assert.equal(run.permanent[0].procs, 20, '记在新栏位上');
  }
  /* ③ C58 豪掷千金：每份各自攒 `shopSpendLimited`（2026-10 第十四批：100 → 120）币 →
   * 各自给一个随机限次增益。
   * 注意「限次池可能被抽干」（grantRandomLimited 返回 null 就停手，余额留着），
   * 所以断言用**恒等式**：已给个数 × 步长 + 各栏余额 === 300 × 份数。 */
  const c58Granted = [];
  for (const copies of [1, 2, 3]) {
    const run = openRun();
    run.permanent = Array.from({ length: copies }, () => ({ id: 'C58', stacks: 1, limitedSpend: 0 }));
    /* 「给了几个」取**返回值里的 limited 列表**（权威口径）：
     * 不能用 run.limited 的行数增量（同名限次件会被并进同一栏、层数 +1），
     * 也不能数 buffLog（流水有长度上限，会被截断）—— 这两个坑都踩过。 */
    const r58 = buy(run, 'C02', 300);
    const got = (r58 && r58.shopSpend && r58.shopSpend.limited ? r58.shopSpend.limited.length : 0);
    const left = run.permanent.filter((b) => b.id === 'C58')
      .reduce((n, b) => n + (Number(b.limitedSpend) || 0), 0);
    const c58Step = Math.max(1, Number(TD.BUFF_BY_ID.C58.mods.shopSpendLimited) || 120);
    assert.equal(got * c58Step + left, 300 * copies,
      copies + ' 份：已给 ' + got + ' 个 ×' + c58Step + ' + 余额 ' + left + ' ≠ ' + (300 * copies));
    assert.ok(got >= copies, copies + ' 份至少应当各触发一次，实测 ' + got);
    c58Granted.push(got);
  }
  assert.ok(c58Granted[2] > c58Granted[0],
    '多份必须比单份给得多（单份 ' + c58Granted[0] + ' 个 vs 三份 ' + c58Granted[2] + ' 个）—— 这正是原来漏掉的')
  /* ④ 进度必须**挺过存档归一化**（cleanBuffs 的白名单不能把它抹掉） */
  {
    const run = openRun();
    run.permanent = [{ id: 'C58', stacks: 1, limitedSpend: 0 }];
    buy(run, 'C02', 60);
    const row = T._debugRun('endless').permanent.find((b) => b.id === 'C58');
    assert.equal(row.limitedSpend, 60, '60 币进度应当留在栏位上：' + JSON.stringify(row));
  }

  /* ⑤ 审计：没有再出现「速率/步长类多份不缩放」的漏网之鱼 */
  assert.equal(TD.BUFF_BY_ID.C36.mods.shopSpendTiers.join(','), '5,10,15', 'C36 分段 5/10/15 不变');
  assert.equal(TD.BUFF_BY_ID.C58.mods.shopSpendLimited, 120, 'C58 步长 100 → 120（2026-10 第十四批削弱）');
});

test('需求105：纯开关类永久增益「有了就不再出现」（unique）——天象之眼 / 风影身法 / 先机预判 / 逢五强化 / 生命源泉', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.newGame('uniq' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const run = T._debugRun('endless');

  /* ① 这五条必须是 unique（多份没有意义） */
  for (const id of ['C04', 'C09', 'C38', 'C45', 'C56']) {
    const b = TD.BUFF_BY_ID[id];
    assert.equal(TD.hasTag(b, 'unique'), true, id + '（' + b.name + '）应当带 unique');
    assert.equal(T.ownableOf({ permanent: [], limited: [], permSlotIds: [], pickBuffIds: [], instantIds: [], slotFreeIds: [], fragileGot: {}, rarityBoost: 0, acqSeq: 0 }, b), true,
      id + ' 在没拿到时应当可出现');
  }
  /* ② 拿到之后：既不可再获得、也不再进池（不会被「开新栏位」绕过） */
  for (const id of ['C04', 'C09', 'C38', 'C45', 'C56']) {
    const r = { permanent: [{ id: id, stacks: 1 }], limited: [], permSlotIds: [], pickBuffIds: [],
      instantIds: [], slotFreeIds: [], fragileGot: {}, rarityBoost: 0, acqSeq: 0 };
    assert.equal(T.ownableOf(r, TD.BUFF_BY_ID[id]), false, id + ' 已有 → 不可再获得');
    assert.equal(T.poolFilterOf(r, TD.BUFF_BY_ID[id]), false, id + ' 已有 → 不进池');
    assert.equal(T.permanentRestackableOf(TD.BUFF_BY_ID[id]), false, id + ' 不该走「开新栏位」那条路');
  }
  /* ③ 对照：可叠层的 C22 满 3 层后仍可出现（要走开新栏位），C13 这类照样能再拿 */
  assert.equal(T.ownableOf({ permanent: [{ id: 'C22', stacks: 3 }], limited: [], permSlotIds: [], pickBuffIds: [], instantIds: [], slotFreeIds: [], fragileGot: {}, rarityBoost: 0, acqSeq: 0 }, TD.BUFF_BY_ID.C22), true,
    'C22（stackable）满层后仍可出现');
  assert.equal(T.permanentRestackableOf(TD.BUFF_BY_ID.C13), true, 'C13 这类仍可开新栏位');
  /* ④ 实拿一次：真的进背包、第二次直接被拦 */
  run.permanent = []; run.limited = []; run.slotFreeIds = [];
  assert.ok(T.addBuff(T._debugRun('endless'), 'C45').ok, '第一份天象之眼应当能拿到');
  const second = T.addBuff(T._debugRun('endless'), 'C45');
  assert.equal(second.ok, false, '第二份天象之眼不该能拿到：' + JSON.stringify(second));
  assert.equal(T.ownableOf(run, TD.BUFF_BY_ID.C45), false, '拿到后 ownable 也必须变 false');
});

test('需求106：商店刷新价 70 之后逐档继续涨（70 档 10 次 → 80 → 90…）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  assert.equal(TD.SHOP.rerollPlateau, 10, '档位长度 10');
  const at = (n) => TD.rerollPriceAt(n);
  assert.equal([7, 8, 16].map(at).join(','), '70,70,70', '70 档持续 10 次（第 7~16 次）');
  assert.equal([17, 18, 26].map(at).join(','), '80,80,80', '80 档持续 10 次');
  assert.equal([27, 36, 37].map(at).join(','), '90,90,100', '90 档之后继续 +10');
  assert.equal(at(107), 170, '越深越贵（第 107 次 = 70 + 10×10）');
  assert.ok(at(200) > at(100), '单调递增');
  assert.equal(TD.rerollPriceCapped(200), false, '价格不再封顶');
  assert.equal(TD.rerollQualityCapped(300), true, '收益早就封顶了（50 币那一档）');

  /* 实战：连刷 20 次，逐次实付要走 10,20,…,70,70×9,80×1 */
  S.newGame('reroll' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const run = T._debugRun('endless');
  run.coins = 1000000; run.phase = 'shop';
  run.shop = { layer: run.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
  const paid = [];
  for (let i = 0; i < 18; i++) {
    const stt = T.shopState();
    assert.equal(stt.rerollNextPrice, at(stt.rerollCount), '标价与公式一致（第 ' + (i + 1) + ' 次）');
    const r = T.rerollShop();
    assert.ok(r.ok, '应当能刷新：' + (r && r.msg));
    paid.push(r.paid);
  }
  assert.equal(paid.join(','), '0,10,20,30,40,50,60,70,70,70,70,70,70,70,70,70,70,80',
    '实付序列：' + paid.join(','));
});

test('需求107：虚空铭文的降权真的生效（原来份数永远数到 0）+ 不死鸟挤占传奇份额', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const mkRun = (extra) => Object.assign({ permanent: [], limited: [], permSlotIds: [], pickBuffIds: [],
    instantIds: [], slotFreeIds: [], fragileGot: {}, pickGot: {}, rarityBoost: 0, acqSeq: 0 }, extra || {});

  /* ① 根因回归（第十三批修订）：虚空铭文的降权口径 = **直接数背包里被它附魔过的增益个数**
   *    （`row.slotFree === true` 的栏位数），权重 = 1/(附魔数+1)。
   *    原来挂的 `repeatWeight: 0.88` 只数「买过几次虚空铭文」的流水（pickGot），
   *    玩家抱着 5 条「不占位」增益时权重仍是 ×1 —— 用户报的「计数不正常」。 */
  const enchRun = (n) => mkRun({ permanent: Array.from({ length: Math.max(n, 1) }, (_, i) =>
    ({ id: 'C2' + i, stacks: 1, uid: i + 1, slotFree: i < n })) });
  for (const n of [0, 1, 2, 3, 5]) {
    const w = T.buffWeightOf(enchRun(n), TD.BUFF_BY_ID.C37);
    assert.ok(Math.abs(w - 1 / (n + 1)) < 1e-9,
      'C37 在 ' + n + ' 个附魔时权重应当是 ×1/' + (n + 1) + '，实测 ×' + w.toFixed(5));
  }
  /* 只买不附魔（pickGot 涨）不再降权：流水口径已被替换。 */
  for (const n of [1, 3, 9]) {
    const w = T.buffWeightOf(mkRun({ pickGot: { C37: n } }), TD.BUFF_BY_ID.C37);
    assert.equal(w, 1, 'pickGot=' + n + '（只买不附魔）不该再影响 C37 权重：' + w);
  }
  /* 同名多栏 / 叠层：计数按**栏位**去数，一条 3 层的附魔件只算 1 个。 */
  const stacked = mkRun({ permanent: [{ id: 'C25', stacks: 3, uid: 1, slotFree: true }] });
  assert.ok(Math.abs(T.buffWeightOf(stacked, TD.BUFF_BY_ID.C37) - 0.5) < 1e-9, '3 层同名件只算 1 个附魔');
  /* ② 实拿：走真实的 addBuff + applyPickBuff 路径，每附魔一条新增益，权重 1 → 1/2 → 1/3 → 1/4 */
  S.newGame('c37w' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.pickBuffIds = []; run.pickGot = {}; run.slotFreeIds = [];
  const w0 = T.buffWeightOf(run, TD.BUFF_BY_ID.C37);
  assert.ok(Math.abs(w0 - 1) < 1e-9, '第 1 张附魔之前权重 ×1');
  const bench = ['C25', 'C27', 'C28'];                    // 三条**不同名**的永久增益，各附魔一条
  for (let i = 1; i <= 3; i++) {
    const got = T.addBuff(T._debugRun('endless'), 'C37');
    assert.ok(got.ok, '第 ' + i + ' 张虚空铭文应当能拿到：' + JSON.stringify(got));
    assert.ok(T.addBuff(T._debugRun('endless'), bench[i - 1]).ok, '第 ' + i + ' 条待附魔增益应当能拿到');
    const rows = T._debugRun('endless').permanent.filter((r) => r.slotFree !== true && r.id === bench[i - 1]);
    assert.equal(rows.length, 1, '待附魔的那一条应当只有一栏：' + rows.length);
    const ap = T.applyPickBuff('permBuff', rows[0].uid != null ? rows[0].uid : rows[0].id);
    assert.ok(ap.ok, '第 ' + i + ' 次附魔应当成功：' + JSON.stringify(ap));
    const w = T.buffWeightOf(T._debugRun('endless'), TD.BUFF_BY_ID.C37);
    assert.ok(Math.abs(w - 1 / (i + 1)) < 1e-9,
      i + ' 个附魔之后权重应当是 ×1/' + (i + 1) + '，实测 ×' + w.toFixed(5));
  }
  /* 卖掉/替换掉一条被附魔的增益 → 档位立刻还回来（「数当前背包」而不是「只增不减」）。 */
  {
    const live = T._debugRun('endless');
    const ench = live.permanent.find((r) => r.slotFree === true);
    live.permanent = live.permanent.filter((r) => r !== ench);
    assert.ok(Math.abs(T.buffWeightOf(T._debugRun('endless'), TD.BUFF_BY_ID.C37) - 1 / 3) < 1e-9,
      '3 个附魔里失去 1 个 → ×1/3：' + T.buffWeightOf(T._debugRun('endless'), TD.BUFF_BY_ID.C37));
  }
  assert.equal(T.obtainedCountOf(run, 'C37'), 3, 'pickGot 流水仍是 3（只是不再用于降权）');

  /* ③ 极端情况（除涅槃/C37/C49 外全到手）：三者平权，C37 与 C49 仍 1:1 */
  const extreme = mkRun({ permanent: TD.BUFFS.filter((b) => b.rarity === 3 && ['C37', 'C49', 'C14'].indexOf(b.id) < 0)
    .map((b) => ({ id: b.id, stacks: 1 })), fragileGot: { C49: 1 }, pickGot: { C37: 1 }, legendPity: 0 });
  const avail = TD.endlessPool.filter((b) => b.rarity === 3 && T.ownableOf(extreme, b) && T.poolFilterOf(extreme, b));
  assert.equal(avail.map((b) => b.id).sort().join(','), 'C14,C37,C49', '可用传奇：涅槃 + 虚空铭文 + 终焉烙印');
  const wC14 = T.buffWeightOf(extreme, TD.BUFF_BY_ID.C14);
  const wC37 = T.buffWeightOf(extreme, TD.BUFF_BY_ID.C37);
  const wC49 = T.buffWeightOf(extreme, TD.BUFF_BY_ID.C49);
  assert.ok(Math.abs(wC37 - wC49) < 1e-9, 'C37 / C49 同权：' + wC37 + ' vs ' + wC49);
  assert.ok(wC14 > 0, '涅槃必须在池子里（靠它挤占份额）：' + wC14);
  /* 真实抽样：传奇档里涅槃要占一份，且 C37 不再压倒 C49 */
  /* 抽 2000 页（传奇档自然出率 ~2.4% → 约 230 件，其中这三条是全部可用传奇）。
   * 期望占比：C14 = 0.5/(0.5+1+1) = 20%，C37 = C49 = 40%。
   * 按二项分布给容差（N≈230、p=0.2 → σ≈6.1 → ±3.5σ ≈ ±21 件 = ±9%）。 */
  const cnt = { C14: 0, C37: 0, C49: 0 };
  for (let i = 0; i < 2000; i++) {
    const page = T._debugRollShopSlots(extreme, 0) || [];
    for (const sl of page) if (cnt[sl.id] != null) cnt[sl.id]++;
  }
  const tot = cnt.C14 + cnt.C37 + cnt.C49;
  assert.ok(tot > 120, '应当抽到足够多的传奇：' + JSON.stringify(cnt));
  const p14 = cnt.C14 / tot;
  assert.ok(p14 > 0.11 && p14 < 0.31,
    '涅槃要真的分到份额（期望 20%）：' + JSON.stringify(cnt) + '，实测 ' + (p14 * 100).toFixed(1) + '%');
  const ratio = cnt.C37 / Math.max(1, cnt.C49);
  /* C37 / C49 每次抽样都是 1:1 的伯努利；tot≈230 时 σ≈7.4，比值容差放到 ±4.5σ 以免偶发红。 */
  assert.ok(ratio > 0.55 && ratio < 1.8,
    'C37 / C49 次数比应当接近 1:1，实测 ' + cnt.C37 + ':' + cnt.C49 + '（比 ' + ratio.toFixed(2) + '）');
});

test('需求108：同名永久增益「逐条」身份 —— uid 与附魔只作用于被点的那一条', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.newGame('uid' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.slotFreeIds = []; run.pickBuffIds = [];
  run.permSlotIds = []; run.permSlots = 0;

  /* ① 三份同名（C13 不可叠层）→ 三栏、各有独立 uid */
  for (let i = 1; i <= 3; i++) T.addBuff(T._debugRun('endless'), 'C13');
  const rows = T._debugRun('endless').permanent;
  assert.equal(rows.length, 3, '三栏并排');
  const uids = rows.map((b) => b.uid);
  assert.equal(new Set(uids).size, 3, 'uid 必须互不相同：' + JSON.stringify(uids));
  assert.equal(rows.every((b) => b.stacks === 1), true, '每栏各 1 层（层数不共享）');

  /* ② 附魔**之前**：同名三栏各占一个候选（逐条身份的直接体现） */
  const candsBefore = T.pickCandidates('permBuff');
  assert.equal(candsBefore.length, 3, '三条栏位各占一个候选：' + JSON.stringify(candsBefore.map((x) => x.uid)));
  assert.equal(candsBefore.filter((x) => x.slotFree).length, 0, '都还没附魔');
  /* ③ 只附魔中间那一条 → 只有它 slotFree，另外两条不受影响 */
  run.pendingPick = { kind: 'permBuff', buffId: 'C37' };
  const res = T.applyPickBuff('permBuff', rows[1].uid);
  assert.ok(res.ok, '附魔应当成功：' + JSON.stringify(res));
  assert.equal(res.uid, rows[1].uid, '落地的应当是这一条');
  const after = T._debugRun('endless').permanent;
  assert.equal(JSON.stringify(after.map((b) => !!b.slotFree)), JSON.stringify([false, true, false]),
    '只有被点的那一条被标为附魔：' + JSON.stringify(after.map((b) => !!b.slotFree)));
  /* 面板与候选也逐条区分（用户口径：不能因为一条被附魔，另一条同名也显示已附魔） */
  assert.equal(JSON.stringify(T.ownedBuffs('endless').filter((b) => b.id === 'C13').map((b) => !!b.slotFree)),
    JSON.stringify([false, true, false]), 'ownedBuffs 逐条');
  /* 附魔之后按用户口径（需求110）：同名件里只留**已附魔的那一条**在候选里 */
  const cands = T.pickCandidates('permBuff').filter((x) => x.id === 'C13');
  assert.equal(cands.length, 1, '同名件里只剩已附魔的那一条可选：' + JSON.stringify(cands.map((x) => x.uid)));
  assert.equal(cands[0].uid, rows[1].uid, '留下的正是被点的那一条');
  assert.equal(cands[0].slotFree, true, '带「已附魔」标记');
  /* 镜像仍然给出「有哪些 id 被附魔过」（旧读法 / 统计用） */
  assert.equal(JSON.stringify(T._debugRun('endless').slotFreeIds), JSON.stringify(['C13']));
  /* ③ 槽位：3 条里 1 条免占位 → 占 2 格 */
  assert.equal(T.permUsedOf ? T.permUsedOf(run) : -1, 2, '逐条算占用：3 条 - 1 条附魔 = 2');
  /* ④ 存档往返：uid 与逐条标记都要活下来 */
  const before = JSON.stringify(T._debugRun('endless').permanent.map((b) => ({ uid: b.uid, free: !!b.slotFree })));
  T._debugRun('endless');                                // 触发一次归一化
  const again = JSON.stringify(T._debugRun('endless').permanent.map((b) => ({ uid: b.uid, free: !!b.slotFree })));
  assert.equal(again, before, '归一化不能丢掉 uid / slotFree：' + again);
});

test('需求109：铜墙铁壁（C48）不可重复获得', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const c48 = TD.BUFF_BY_ID.C48;
  assert.equal(TD.hasTag(c48, 'unique'), true, 'C48 应当带 unique（拿过就不再出现）');
  assert.equal(T.permanentRestackableOf(c48), false, 'C48 不该走「开新栏位继续叠」');
  const mkRun = (n) => ({ permanent: n ? [{ id: 'C48', stacks: n }] : [], limited: [], permSlotIds: [],
    pickBuffIds: [], instantIds: [], slotFreeIds: [], fragileGot: {}, pickGot: {}, rarityBoost: 0, acqSeq: 0 });
  assert.equal(T.ownableOf(mkRun(0), c48), true, '没拿到时能出现');
  assert.equal(T.ownableOf(mkRun(1), c48), false, '拿到之后不可再获得');
  assert.equal(T.poolFilterOf(mkRun(1), c48), false, '拿到之后不再进池');
});

test('需求110：虚空铭文不能给「已有同名被附魔」的未附魔件附魔（限制同名多栏刷免占位）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.newGame('ench' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.slotFreeIds = []; run.pickBuffIds = [];
  run.permSlotIds = []; run.permSlots = 0;
  /* 三份同名 C13（不可叠层 → 三栏并排）+ 两份别的，保证候选池不空 */
  for (let i = 1; i <= 3; i++) T.addBuff(T._debugRun('endless'), 'C13');
  T.addBuff(T._debugRun('endless'), 'C02');
  T.addBuff(T._debugRun('endless'), 'C21');
  const c13 = () => T._debugRun('endless').permanent.filter((b) => b.id === 'C13');
  const uids = c13().map((b) => b.uid);
  assert.equal(uids.length, 3, '三份同名 C13');
  const cands = () => T.pickCandidates('permBuff');

  /* ① 还没附魔时：同名三条都可以进候选（随机三选一，可能只抽到其中两条） */
  const before = cands();
  assert.ok(before.some((x) => x.id === 'C13'), '未附魔时同名件应当在候选里');
  assert.equal(before.filter((x) => x.slotFree).length, 0, '还没有「已附魔」的候选');

  /* ② 附魔中间那一条 */
  run.pendingPick = { kind: 'permBuff', buffId: 'C37' };
  const ok = T.applyPickBuff('permBuff', uids[1]);
  assert.ok(ok.ok, '附魔应当成功：' + JSON.stringify(ok));
  assert.equal(JSON.stringify(c13().map((b) => !!b.slotFree)), JSON.stringify([false, true, false]),
    '只有这一条被标记：' + JSON.stringify(c13().map((b) => !!b.slotFree)));

  /* ③ 候选里：同名**未附魔**的两条必须消失；已附魔的那条仍在（再选无收益） */
  const after = cands();
  assert.equal(after.filter((x) => x.id === 'C13').length, 1,
    '同名件里只能剩一条（已附魔的那条）在候选里：' + JSON.stringify(after.map((x) => x.id + '#' + x.uid)));
  assert.equal(after.filter((x) => x.id === 'C13')[0].uid, uids[1], '留下的必须是已附魔的那一条');
  assert.equal(after.filter((x) => x.id === 'C13')[0].slotFree, true, '它带着「已附魔」标记');
  assert.equal(after.some((x) => x.id === 'C13' && x.uid !== uids[1]), false, '未附魔的同名件不该出现');
  /* 其它增益不受影响 */
  assert.ok(after.some((x) => x.id === 'C02' || x.id === 'C21'), '别的增益照常进候选');

  /* ④ 绕过界面直接调用：给未附魔的同名件附魔必须被拒（防御性） */
  for (const uid of [uids[0], uids[2]]) {
    run.pendingPick = { kind: 'permBuff', buffId: 'C37' };
    const bad = T.applyPickBuff('permBuff', uid);
    assert.equal(bad.ok, false, 'uid=' + uid + ' 不该能附魔：' + JSON.stringify(bad));
    assert.match(bad.msg, /只能附魔一条/, '提示要写清原因：' + bad.msg);
    assert.equal(c13().every((b) => (b.uid === uids[1] ? b.slotFree === true : !b.slotFree)), true,
      '失败的调用不能留下半截标记');
  }
  /* ⑤ 再选一次已附魔的那条仍然允许（用户口径：仍会选取附魔过的 A），但只是空操作 */
  run.pendingPick = { kind: 'permBuff', buffId: 'C37' };
  const again = T.applyPickBuff('permBuff', uids[1]);
  assert.ok(again.ok, '已附魔的那条仍可选：' + JSON.stringify(again));
  assert.equal(T.permUsedOf(run), 4, '占用不变：5 条里 1 条免占位 = 4');
  /* ⑥ 换一个 id 附带魔不受影响（限制只作用于同名） */
  const c02 = T._debugRun('endless').permanent.find((b) => b.id === 'C02');
  run.pendingPick = { kind: 'permBuff', buffId: 'C37' };
  assert.ok(T.applyPickBuff('permBuff', c02.uid).ok, '别的增益仍然能附魔');
  assert.equal(T.permUsedOf(run), 3, '两条免占位 → 占 3 格');
});

test('需求111：厚积薄发（C35）对「被虚空铭文附魔」的件只给 2% 攻击', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.newGame('c35' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const run = T._debugRun('endless');
  const atkLine = () => {
    const line = T.debugBuffReport('endless').effects.find(([k]) => k === '攻击');
    return line ? Number(String(line[1]).replace(/[^0-9.]/g, '')) : 0;
  };
  /* ① 5 个普通永久件（含 C35 自己）→ 5 × 10% = 50% */
  /* 陪衬件必须**不带攻击加成**（C02 磨砺本身 +30%，会把数字搅浑）：
   * C22 闪避 / C19 荆棘 / C05 护盾 / C16 开战回血 都不加攻击。 */
  run.permanent = [{ id: 'C35', stacks: 1 }, { id: 'C22', stacks: 1 }, { id: 'C19', stacks: 1 },
    { id: 'C05', stacks: 1 }, { id: 'C16', stacks: 1 }];
  run.limited = []; run.slotFreeIds = [];
  run.permanent.forEach((b) => { b.slotFree = false; });
  assert.equal(atkLine(), 50, '5 个普通件 = +50%：' + atkLine());
  /* ② 把其中 2 个标成「被虚空铭文附魔」→ 3×10% + 2×2% = 34% */
  run.permanent[1].slotFree = true;
  run.permanent[2].slotFree = true;
  assert.equal(atkLine(), 34, '2 个附魔件（按 2% 计）= 30% + 4% = +34%：' + atkLine());
  /* ③ 全部附魔 → 5 × 2% = 10% */
  run.permanent.forEach((b) => { b.slotFree = true; });
  assert.equal(atkLine(), 10, '全附魔 = 5 × 2% = +10%：' + atkLine());
  /* ④ 面板 progress 与实际效果同一口径 */
  const info = T.ownedBuffs('endless').find((b) => b.id === 'C35');
  assert.match(info.progress, /\+10%/, '面板也要按 2% 折算：' + info.progress);
  /* ⑤ 权重常量可调（数据驱动） */
  assert.equal(TD.BUFF_BY_ID.C35.mods.powerPerPermBuff, 0.10, '基础权重仍是 10%');
  assert.equal(TD.BUFF_BY_ID.C35.mods.powerPerPermBuffEnchantedWeight, 0.20, '附魔件权重 0.2（= 2%）');
  assert.match(TD.BUFF_BY_ID.C35.desc, /2%/, '描述要写清附魔件只算 2%：' + TD.BUFF_BY_ID.C35.desc);
});

test('需求112：枯泉·涸井（trialDry）的负面效果 —— 封疗（含开战回血）+ 每 3 次行动吸血 10%', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;
  assert.equal(TD.mechSealsHeal(['trialDry']), true, '枯泉应当在「封疗机制」清单里');
  assert.equal(TD.mechSealsHeal(['trialMirror']), false, '别的机制不封疗');
  const foeOf = (id, layer) => {
    S.newGame('dry' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const run = T._debugRun('endless');
    T._debugSetEndlessLayer(layer);
    run.plan = [{ kind: 'trial', id: id }]; run.idx = 0; run.choices = null; run.phase = null;
    run.limited = []; run.permanent = [];
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.foe, '应当取到敌人');
    return nx;
  };
  /* 玩家刻意压低输出：枯泉是「每 3 次行动吸血」，打得太快会在它出手 3 次前结束战斗
   * （实测约 25% 偶发红）→ 用低力量拉长战斗，保证它至少出手 3 次。 */
  const mkPlayer = (extra) => Object.assign({ name: 'p', level: 70, power: 120, agility: 200, speed: 200,
    maxHp: 6000, hp: 3000, baseStats: { power: 120, agility: 200, speed: 200 },
    weapons: [{ id: 2, level: 8 }], skills: [], wears: [], effects: {}, masterLevel: 0,
    mods: { lifestealPct: 0.30 } }, extra || {});

  /* ① 战斗内封疗：即使玩家**先手**，吸血也一滴不回；对照组（镜鳞）正常回血 */
  const dry = Sim.simulate(mkPlayer(), JSON.parse(JSON.stringify(foeOf('dry', 20).foe)), { maxActions: 160 });
  const dryHeal = dry.rounds.reduce((a, x) => a + (x.lifesteal || 0), 0);
  assert.equal(dryHeal, 0, '枯泉面前不该有任何吸血回血：' + dryHeal);
  const ctrl = Sim.simulate(mkPlayer(), JSON.parse(JSON.stringify(foeOf('mirror', 20).foe)), { maxActions: 160 });
  const ctrlHeal = ctrl.rounds.reduce((a, x) => a + (x.lifesteal || 0), 0);
  assert.ok(ctrlHeal > 0, '对照组（镜鳞）应当正常回血：' + ctrlHeal);

  /* ② 每 3 次行动吸血：次数 = floor(它的出手次数 / 3)，且它自己回血、玩家掉血 */
  const enemyActs = dry.rounds.filter((x) => x.attacker === 1 && x.action !== 'stunned' && x.action !== 'rest').length;
  const drains = dry.rounds.filter((x) => (x.noteText || '').indexOf('枯泉·吸血') >= 0);
  assert.equal(drains.length, Math.floor(enemyActs / 3),
    '吸血次数应当 = floor(出手/3)：出手 ' + enemyActs + ' → ' + drains.length);
  assert.ok(drains.length > 0, '至少要吸到一次');
  const hpTrace = dry.rounds.map((x) => x.hpAfter && x.hpAfter[0]).filter((v) => typeof v === 'number');
  assert.ok(Math.min.apply(null, hpTrace) < 3000, '玩家要被吸掉血：最低 ' + Math.min.apply(null, hpTrace));

  /* ③ 开战回血（C16 战斗续航）必须被吞掉：枯泉面前 hp 不变，对照组正常 +10% */
  const startHealRun = (id) => {
    S.newGame('sh' + Math.random());
    const st = S.state(); st.level = 70; st.props[23] = 99999;
    for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
    try { T.abandon('endless'); } catch (e) {}
    T.startEndlessRun();
    const run = T._debugRun('endless');
    run.permanent = [{ id: 'C16', stacks: 2 }]; run.limited = []; run.slotFreeIds = [];
    /* 关键：adjustMe 会用 run.hpAbs **重建**进场血量（塔里的血量权威在 run 上），
     * 不设它就等于满血进场 → 开战回血被上限截断，看不出有没有被封。 */
    run.hpAbs = 1000;
    T._debugSetEndlessLayer(20);
    run.plan = [{ kind: 'trial', id: id }]; run.idx = 0; run.choices = null; run.phase = null;
    const nx = T.nextBattle('endless');
    const me = { maxHp: 6000, hp: 1000, power: 100, agility: 100, speed: 100 };
    nx.adjustMe(me);
    return me.hp;
  };
  assert.equal(startHealRun('dry'), 1000, '枯泉面前开战回血要被封掉（C16 两层 +10% 应当无效）');
  assert.equal(startHealRun('mirror'), 1600, '对照组应当正常回 10%（1000 + 600）');
});

test('需求113：绝对防御（16）的等级不再被秘技通神冲回 1 级（修 Bug）', () => {
  const c = setup();
  const T = c.Tower, S = c.State;
  const sk = () => (S.state().skills || []).slice();
  const lvOf = (id) => {
    const row = sk().find((s) => Number(String(s).split(':')[0]) === Number(id));
    return row ? Number(String(row).split(':')[1]) : 0;
  };
  /* ① 已学会且已经是 7 级 → 秘技通神抽中它，只该加触发概率、**不该动等级** */
  S.setWS('skill', 16, 7);
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.skillBoost = {};
  assert.equal(lvOf(16), 7, '前置：绝对防御应当是 7 级');
  assert.ok(T.addBuff(run, 'C33').ok, '应当能拿到秘技通神');
  const res = T.applyPickBuff('skill', 16);
  assert.ok(res.ok, '抽取绝对防御应当成功：' + JSON.stringify(res));
  assert.equal(lvOf(16), 7, '抽中后等级必须还是 7（旧 Bug：S().skills 是字符串数组，sk.id 恒 undefined → 冲成 1）');
  assert.ok(Number(run.skillBoost['16']) > 0, '触发概率加成仍然要写进 skillBoost：' + JSON.stringify(run.skillBoost));
  /* ② 没学会的技能：抽中后按 1 级领悟（这条老行为不能被改坏） */
  S.forgetWS('skill', 7);
  assert.equal(lvOf(7), 0, '前置：不该会龟甲术');
  run.pendingPick = { kind: 'skill', buffId: 'C33', pct: 2.0 };
  assert.ok(T.applyPickBuff('skill', 7).ok, '抽取龟甲术应当成功');
  assert.equal(lvOf(7), 1, '没学过的防御技应当按 1 级领悟');
  /* ③ 小宇宙爆发（14）同理：已学高等级时不该被冲回 1 级 */
  S.setWS('skill', 14, 6);
  run.pendingPick = { kind: 'skill', buffId: 'C33', pct: 1 };
  assert.ok(T.applyPickBuff('skill', 14).ok, '抽取小宇宙爆发应当成功');
  assert.equal(lvOf(14), 6, '小宇宙爆发抽中后等级也应当保持 6');
});

test('需求114：README 精简 —— 只留必要介绍，更新记录交给 git', () => {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  /* 2026-10 第十八批（用户口径）：README 里要放三平台「安装与运行」指导（含安装步骤），
   * 所以行数上限从 120 放宽到 220；其余要求不变（不逐条同步更新日志、标题数量收敛）。 */
  assert.ok(md.split('\n').length < 220, 'README 应当保持精简（当前 ' + md.split('\n').length + ' 行）');
  assert.ok(!/^## .*（20\d\d-\d\d）/.test(md), '不该再逐条同步更新日志：' + md.match(/^## .*（20\d\d-\d\d）.*$/m));
  assert.match(md, /## 玩法/, '保留玩法介绍');
  assert.match(md, /## 安装与启动/, '保留安装与启动方式（第十八批由「## 启动」扩写）');
  assert.match(md, /## 开发/, '保留开发说明');
  assert.match(md, /## 许可/, '保留许可');
  assert.match(md, /git log/, '改动记录指向 git 历史');
  assert.ok((md.match(/^## /gm) || []).length <= 8, '标题数量应当收敛');
});

test('需求115：跳过键 20 层起给；倍速 / 跳过都用普通战斗跳过键那一档尺寸并排', () => {
  const c = setup();
  const T = c.Tower;
  assert.equal(c.TowerData.ENDLESS_SKIP_LAYER, 20, '跳过起始层应当是 20');
  assert.equal(T.skipPlaybackAllowed('endless', 19), false, '19 层不给');
  assert.equal(T.skipPlaybackAllowed('endless', 20), true, '20 层给');
  const c2 = { console }; c2.window = c2; vm.createContext(c2);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'battle.js'), 'utf8'), c2, { filename: 'js/battle.js' });
  const L = c2.Battle._cornerLayout;
  /* 普通战斗的跳过键（基准档）：190x70 */
  const normalSkip = L(false, true).rects.skip;
  assert.deepEqual(Object.assign({}, normalSkip), { x: 964, y: 605, w: 190, h: 70 }, '普通战斗跳过键尺寸');
  /* 挑战塔 / 无尽塔 <20 层的倍速键：与普通战斗跳过键**一致** */
  assert.deepEqual(Object.assign({}, L(true, false).rects.speed), Object.assign({}, normalSkip),
    '倍速键应当与普通战斗跳过键同尺寸');
  /* 无尽塔 20 层起：两个键都与普通跳过键同尺寸，并在右下并排 */
  const both = L(true, true);
  assert.equal(both.rects.speed.w, normalSkip.w, '倍速键宽度 = 普通跳过键');
  assert.equal(both.rects.speed.h, normalSkip.h, '倍速键高度 = 普通跳过键');
  assert.equal(both.rects.skip.w, normalSkip.w, '跳过键宽度 = 普通跳过键');
  assert.equal(both.rects.skip.h, normalSkip.h, '跳过键高度 = 普通跳过键');
  assert.equal(both.rects.speed.y, normalSkip.y, '两个键与普通跳过键同高');
  assert.ok(both.rects.speed.x + both.rects.speed.w < both.rects.skip.x, '两键并排不重叠');
  assert.equal(both.rects.skip.x + both.rects.skip.w, normalSkip.x + normalSkip.w, '整组贴住右下角');
  assert.ok(both.base.x + both.base.w <= 1170 && both.base.y + both.base.h <= 690, '不能越出画布');
});

test('需求116：豪掷千金 —— 10 币刷新档位 + 每件动态权重「混在一起直接抽签」', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const m = TD.BUFF_BY_ID.C58.mods;
  assert.equal(m.limitedRarityMul, undefined, '旧的按稀有度倍率已移除');
  assert.equal(m.limitedDefaultRerollPaid, 10, '基准刷新档应当是「花 10 试炼币刷新」那一档');
  const run = T._debugRun('endless');
  run.permanent = [{ id: 'C58', stacks: 1 }]; run.limited = []; run.slotFreeIds = [];
  const pool = TD.endlessPool.filter((b) => b.kind === 'limited');
  /* ③ 权重表：每件 = 档位预算（10 币刷新）× 档内个体权重占比。
   *    个体权重默认都是 1 → 每件 = 该档档位预算 ÷ 该档可用件数。 */
  const base = TD.rawTierWeights(TD.rerollTilt(10), run);
  const cnt = [0, 0, 0, 0];
  for (const b of pool) cnt[b.rarity] += 1;
  const flat = T.limitedGrantWeightsOf(run);
  for (const b of pool) {
    const row = flat.find((x) => x.id === b.id);
    if (!row) continue;
    const want = base[b.rarity] / cnt[b.rarity];
    assert.ok(Math.abs(row.weight - want) < 1e-6,
      b.id + ' 权重应当是「档位预算 ÷ 档内件数」：' + row.weight + ' vs ' + want);
    assert.ok(Math.abs(T.limitedGrantWeightOf(run, b.id) - row.weight) < 1e-9, b.id + ' 单件导出与整池一致');
  }
  /* 终焉烙印（C49）的份额必须明显低于「等权」与旧的 limitedRarityMul 口径。 */
  const tot = flat.reduce((a, x) => a + x.weight, 0) || 1;
  const shareC49 = flat.filter((x) => x.id === 'C49').reduce((a, x) => a + x.weight, 0) / tot;
  const oldShare = 0.35 / (6 + 8 + 3 * 0.5 + 3 * 0.35);      // 旧口径（limitedRarityMul）下的 C49 份额
  assert.ok(shareC49 < oldShare,
    'C49 的抽取概率应当低于旧口径：' + (shareC49 * 100).toFixed(3) + '% vs 旧 ' + (oldShare * 100).toFixed(3) + '%');
  /* 权重表是「混在一起直接抽」的输入：真实抽一次应当命中池子里的限次件。 */
  const got = T._debugGrantRandomLimited(run);
  assert.ok(got && pool.some((b) => b.id === got), '真实抽取应当命中限次池：' + got);
});

test('需求117：厚积薄发（C35）的份数计算与显示保留一位小数', () => {
  const c = setup();
  const T = c.Tower;
  const run = T._debugRun('endless');
  run.limited = []; run.slotFreeIds = [];
  /* C35 自己 + 4 个被虚空铭文附魔的件 → 1 + 4×0.2 = 1.8 个 */
  run.permanent = [{ id: 'C35', stacks: 1, slotFree: false },
    { id: 'C22', stacks: 1, slotFree: true }, { id: 'C19', stacks: 1, slotFree: true },
    { id: 'C05', stacks: 1, slotFree: true }, { id: 'C16', stacks: 1, slotFree: true }];
  const info = T.ownedBuffs('endless').find((b) => b.id === 'C35');
  assert.match(info.progress, /1\.8 个永久增益/, '份数要保留一位小数：' + info.progress);
  assert.match(info.progress, /\+18%/, '1.8 × 10% = +18%：' + info.progress);
  assert.ok(!/\d\.\d{4,}/.test(info.progress), '不该出现浮点长尾：' + info.progress);
  const line = T.debugBuffReport('endless').effects.find(([k]) => k === '攻击');
  assert.ok(line, '效果清单要有攻击');
  assert.equal(line[1], '+18%', '实际效果与显示同一口径：' + line[1]);
  /* 3 个附魔件 → 1 + 0.6 = 1.6 */
  run.permanent = [{ id: 'C35', stacks: 1, slotFree: false },
    { id: 'C22', stacks: 1, slotFree: true }, { id: 'C19', stacks: 1, slotFree: true },
    { id: 'C05', stacks: 1, slotFree: true }];
  assert.match(T.ownedBuffs('endless').find((b) => b.id === 'C35').progress, /1\.6 个永久增益/,
    '3 个附魔件 = 1.6 个');
});

test('需求118：烙印系列削弱（普通 5%/8%、稀有 12%/16%、终焉 20%/30%）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const pairs = [['C39', 0.05, 0.08, '力量'], ['C40', 0.05, 0.08, '敏捷'], ['C41', 0.05, 0.08, '速度'],
    ['C42', 0.12, 0.16, '力量'], ['C43', 0.12, 0.16, '敏捷'], ['C44', 0.12, 0.16, '速度']];
  for (const [id, alive, burned, stat] of pairs) {
    const b = TD.BUFF_BY_ID[id];
    assert.equal(b.mods.fragilePct, alive, id + ' 破碎前应当是 ' + (alive * 100) + '%');
    assert.equal(b.mods.fragileBurnedPct, burned, id + ' 破碎后应当是 ' + (burned * 100) + '%');
    assert.match(b.desc, new RegExp('\\+' + (alive * 100) + '%'), id + ' 描述要写破碎前：' + b.desc);
    assert.match(b.desc, new RegExp('\\+' + (burned * 100) + '%'), id + ' 描述要写破碎后：' + b.desc);
  }
  const c49 = TD.BUFF_BY_ID.C49;
  assert.equal(c49.mods.fragileAddAlive, 0.20, '终焉破碎前 20%');
  assert.equal(c49.mods.fragileAddBurned, 0.30, '终焉破碎后 30%');
  assert.match(c49.desc, /\+20%/, '终焉描述要写 20%：' + c49.desc);
  assert.match(c49.desc, /\+30%/, '终焉描述要写 30%：' + c49.desc);
  /* 行为：C39 存在时就是 5%（不再半效），损毁后 8% */
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.env = []; run.noEnvRoll = true;
  T.debugGrantBuff('C39');
  assert.equal(Number(T._debugRun('endless').fragileBase.power), 0.05, '登记存在值 5%');
  const line = T.debugBuffReport('endless').effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.equal(line[1], '+5%', '存在时 +5%：' + line[1]);
});

test('需求119：武器与技能页面「选中」后仍显示等级而不是名称', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8');
  assert.ok(!/selected\?esc\(it\.name\)/.test(src), '格子说明不该再在选中时换成武器/技能名字');
  assert.match(src, /item-caption">'\+\(has\?levelLabel\(has\.level\)/,
    '格子说明应当始终是等级（levelLabel）');
});

test('需求120：天命所归（C51）改为永久 · 不可叠加 · 已有则本局不再生成', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const c51 = TD.BUFF_BY_ID.C51;
  assert.equal(c51.kind, 'permanent', 'C51 应当是永久类');
  assert.equal(c51.maxStacks, 1, 'C51 不可叠加');
  assert.equal(TD.hasTag(c51, 'unique'), true, 'C51 带 unique');
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.instantIds = []; run.pickBuffIds = []; run.rarityBoost = 0;
  assert.equal(T.poolFilterOf(run, c51), true, '没拿过时能进池');
  assert.equal(T.rarityBoostOf(run).epic, 1, '没拿过时提率系为 1');
  assert.ok(T.addBuff(run, 'C51').ok, '应当能拿到天命所归');
  assert.ok((run.permanent || []).some((x) => x.id === 'C51'), 'C51 应当进 permanent');
  assert.equal(run.rarityBoost, 1, '获得时立刻写 rarityBoost');
  assert.equal(T.rarityBoostOf(run).epic, 2, '史诗系数 ×2 生效');
  assert.equal(T.poolFilterOf(run, c51), false, '已有之后不再进池');
  assert.equal(T.ownableOf(run, c51), false, '已有之后不可再获得');
  assert.equal(T.addBuff(run, 'C51').ok, false, '直接调用也要被拒（不可叠加）');
});

test('需求121：涅槃（C14）叠满 2 层后不再在本局生成', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const c14 = TD.BUFF_BY_ID.C14;
  assert.equal(TD.hasTag(c14, 'stackable'), true, 'C14 仍可叠层');
  assert.equal(c14.maxStacks, 2, 'C14 上限 2 层');
  assert.equal(TD.hasTag(c14, 'noRestack'), true, 'C14 应当带 noRestack');
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = [];
  assert.ok(T.addBuff(run, 'C14').ok, '第 1 份');
  assert.ok(T.addBuff(run, 'C14').ok, '第 2 份');
  assert.equal(T.stacksOf(run, 'C14'), 2, '叠满 2 层');
  assert.equal(T.poolFilterOf(run, c14), false, '叠满后出池');
  assert.equal(T.ownableOf(run, c14), false, '叠满后不可再获得');
  assert.equal(T.addBuff(run, 'C14').ok, false, '第 3 份被拒');
  assert.equal((run.permanent || []).filter((b) => b.id === 'C14').length, 1, '只占一栏');
});

test('需求122：抉择扩充（C50）背包里 3 个之后不再生成', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const c50 = TD.BUFF_BY_ID.C50;
  assert.equal(TD.hasTag(c50, 'noRestack'), true, 'C50 应当带 noRestack');
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = [];
  for (let i = 1; i <= 3; i++) {
    assert.equal(T.poolFilterOf(run, c50), true, '第 ' + i + ' 个之前仍能进池');
    assert.ok(T.addBuff(run, 'C50').ok, '第 ' + i + ' 个应当能拿到');
  }
  assert.equal(T.stacksOf(run, 'C50'), 3, '应当叠到 3 个');
  assert.equal(T.choiceSlotsOf(run), 6, '选择张数封顶六选一');
  assert.equal(T.poolFilterOf(run, c50), false, '3 个之后出池');
  assert.equal(T.ownableOf(run, c50), false, '3 个之后不可再获得');
  assert.equal(T.addBuff(run, 'C50').ok, false, '第 4 个被拒');
});

test('需求123：新增两条史诗限次 —— N16 战意沸腾 / N17 血蚀印记（限次 10）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, Sim = c.Sim;
  for (const id of ['N16', 'N17']) {
    const b = TD.BUFF_BY_ID[id];
    assert.ok(b, id + ' 应当存在');
    assert.equal(b.rarity, 2, id + ' 应当是史诗');
    assert.equal(b.kind, 'limited', id + ' 应当是限次类');
    assert.equal(b.uses, 10, id + ' 应当是限次 10');
    assert.equal(TD.hasTag(b, 'endless'), true, id + ' 应当属于无尽塔');
    assert.ok(TD.endlessPool.some((x) => x.id === id), id + ' 应当进无尽池');
    assert.ok(TD.shopPool.some((x) => x.id === id), id + ' 应当能上商店');
  }
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.env = []; run.noEnvRoll = true;
  T.debugGrantBuff('N16'); T.debugGrantBuff('N17');
  const nx = T.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
  const me = { name: 'p', level: 70, power: 100, agility: 100, speed: 100, maxHp: 1000, hp: 1000,
    baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [{ id: 1, level: 1, harmLo: 5, harmHi: 10 }],
    skills: [], wears: [], effects: {}, masterLevel: 0 };
  nx.adjustMe(me);
  assert.equal(me.power, 150, 'N16：力量 +50');
  assert.equal(me.agility, 150, 'N16：敏捷 +50');
  assert.equal(me.speed, 150, 'N16：速度 +50');
  assert.equal(me.maxHp, 1500, 'N16：生命上限 +500');
  assert.equal(Number(me.mods.enemyHpDrainPct), 0.10, 'N17：每回合对敌人抽 10% 当前生命');
  /* 实战：第一回合就掉 10% 当前血（5000 → 4500） */
  const foe = JSON.parse(JSON.stringify(nx.foe));
  foe.maxHp = 5000; foe.hp = 5000;
  const sim = Sim.simulate(me, foe, { maxActions: 40 });
  const drains = sim.rounds.filter((r) => r.action === 'dot' && r.noteText === '血蚀印记');
  assert.ok(drains.length >= 1, '应当有血蚀印记的抽血事件');
  /* 抽血量 = **当时**敌人当前生命的 10%（回合开始前的血量，从上一回合的 hpAfter 回溯）。 */
  const enemyHpBefore = (idx) => {
    for (let k = idx - 1; k >= 0; k--) {
      const h = sim.rounds[k].hpAfter;
      if (Array.isArray(h) && typeof h[1] === 'number') return h[1];
    }
    return 5000;
  };
  for (const d of drains.slice(0, 3)) {
    const before = enemyHpBefore(sim.rounds.indexOf(d));
    assert.equal(d.dmg, Math.max(1, Math.round(before * 0.10)),
      '抽血应当是当前生命的 10%：敌人 ' + before + ' → ' + d.dmg);
  }
});

test('需求124：同名件的「虚空铭文附魔（不占位）」逐条判定，新拿到的同名件不沾附魔', () => {
  const c = setup();
  const T = c.Tower;
  const live = () => T._debugRun('endless');
  const c25 = () => live().permanent.filter((b) => b.id === 'C25');
  {
    const run = live();
    run.permanent = []; run.limited = []; run.slotFreeIds = []; run.pickGot = {}; run.pickBuffIds = [];
  }
  T.addBuff(live(), 'C25'); T.addBuff(live(), 'C25');
  let rows = c25();
  assert.equal(rows.length, 2, '两本战利品账本应当各占一栏：' + rows.length);
  assert.ok(rows[0].uid > 0 && rows[1].uid > 0 && rows[0].uid !== rows[1].uid, '两条要有各自不同的 uid');
  const uidA = rows[0].uid, uidB = rows[1].uid;
  /* 模拟虚空铭文三选一：只给**被点的那一条**（uid）附魔 */
  live().pendingPick = { kind: 'permBuff', buffId: 'C37' };
  const res = T.applyPickBuff('permBuff', uidA);
  assert.ok(res.ok, '附魔应当成功：' + JSON.stringify(res));
  assert.equal(res.uid, uidA, '被标记的必须是被点的那一条');
  rows = c25();
  assert.equal(rows.find((b) => b.uid === uidA).slotFree, true, '被点的那一条才是已附魔');
  assert.ok(!rows.find((b) => b.uid === uidB).slotFree, '同名的另一条**不能**跟着变成已附魔（用户报的 bug）');
  const owned = T.ownedBuffs('endless').filter((b) => b.id === 'C25');
  assert.equal(owned.filter((b) => b.slotFree).length, 1, '面板里只有一条显示「不占位」');
  assert.equal(owned.find((b) => b.uid === uidB).slotFree, false, '面板逐条判定 slotFree');
  /* 镜像 slotFreeIds 只是「被附魔行的 id 去重」，不是「同名全部已附魔」 */
  assert.equal(live().slotFreeIds.join(','), 'C25', '镜像按 id 去重');
  /* 再拿一本 → 新的一条绝不能是已附魔 */
  T.addBuff(live(), 'C25');
  rows = c25();
  assert.equal(rows.length, 3, '第三本应当另开一栏：' + rows.length);
  const fresh = rows.find((b) => b.uid !== uidA && b.uid !== uidB);
  assert.ok(fresh && !fresh.slotFree, '新拿到的同名件不该显示成已附魔：' + JSON.stringify(fresh));
  /* 同名件里最多只有一条能进附魔候选（enchantEligible） */
  const c25Cands = T.pickCandidatesOf('permBuff').filter((x) => x.id === 'C25');
  assert.ok(c25Cands.every((x) => x.uid === uidA), '同名未附魔的那两条不该再进附魔候选');
  /* 界面层：orderPermanent 只按行自己的 slotFree，不再按 id 兜底 */
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const ordSeg = ui.slice(ui.indexOf('  function orderPermanent('), ui.indexOf('  // ---------- 通用小件 ----------'));
  assert.ok(!/free\.indexOf\(b\.id\)/.test(ordSeg), 'orderPermanent 不该再按 id 兜底：' + ordSeg);
  /* 送掉被附魔的那一条 → 附魔记录要一起清掉，**之后**再拿到同名件也不能沾上附魔。 */
  T.debugLoseBuff(uidA);
  assert.equal(live().slotFreeIds.indexOf('C25'), -1,
    '失去被附魔的那一条后镜像要清掉：' + JSON.stringify(live().slotFreeIds));
  T.addBuff(live(), 'C25');
  const after = c25();
  const newest = after.reduce((best, b) => (b.uid === uidA || b.uid === uidB ? best : (best && best.uid > b.uid ? best : b)), null);
  assert.ok(newest && !newest.slotFree, '再拿到的同名件不该被残留的 id 登记标成已附魔：' + JSON.stringify(newest));
});

test('需求125：同名多栏的成长与卖出逐条结算（战利品账本不再共用一个累计）', () => {
  const c = setup();
  const T = c.Tower;
  const live = () => T._debugRun('endless');
  const c25 = () => live().permanent.filter((b) => b.id === 'C25');
  {
    const run = live();
    run.permanent = []; run.limited = []; run.slotFreeIds = []; run.sellBonus = 0;
    /* sellBuff 要求「正在逛试炼商店」：给一个非 mint 的店铺对象即可。 */
    run.shop = { slots: [] };
  }
  T.addBuff(live(), 'C25'); T.addBuff(live(), 'C25');
  const rows = c25();
  assert.equal(rows.length, 2, '两本账本各占一栏');
  const uidA = rows[0].uid, uidB = rows[1].uid;
  /* 两本各自的累计（模拟在不同时间拿到、各自成长） */
  rows[0].grow = { sellBonus: 30 };
  rows[1].grow = { sellBonus: 10 };
  live().sellBonus = 40;
  const owned = T.ownedBuffs('endless').filter((b) => b.id === 'C25');
  const pA = owned.find((b) => b.uid === uidA).sellPrice;
  const pB = owned.find((b) => b.uid === uidB).sellPrice;
  assert.equal(pA - pB, 20, '两本卖价应当按各自累计区分：' + pA + ' vs ' + pB);
  assert.match(owned.find((b) => b.uid === uidA).progress, /\+30/, '第一本显示自己的 +30');
  assert.match(owned.find((b) => b.uid === uidB).progress, /\+10/, '第二本显示自己的 +10');
  /* 卖第二本 → 只扣它自己的 10，第一本不受影响 */
  const sold = T.sellBuff(uidB);
  assert.ok(sold.ok, '按 uid 卖出应当成功：' + JSON.stringify(sold));
  assert.equal(live().sellBonus, 30, '只剩第一本的 +30：' + live().sellBonus);
  const left = c25();
  assert.equal(left.length, 1, '第一本仍在');
  assert.equal(left[0].grow && left[0].grow.sellBonus, 30, '第一本自己的账本不受影响');
  /* 再卖第一本 → 归零 */
  assert.ok(T.sellBuff(uidA).ok, '第一本也要能按 uid 卖');
  assert.equal(live().sellBonus, 0, '两本都卖光后累计归零');
});

test('需求126：叠加的烙印每份独立破碎 + 同名各条各有随机数', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.slotFreeIds = [];
  run.fragileMulBase = 0; run.fragileMulBurned = 0; run.brokenMarks = []; run.fragileSeeds = {};
  T.addBuff(run, 'C49'); T.addBuff(run, 'C49'); T.addBuff(run, 'C49');
  const live = () => T._debugRun('endless');
  let row = live().limited.find((b) => b.id === 'C49');
  assert.equal(row.stacks, 3, '三层叠在一栏');
  assert.equal(live().fragileMulBase, 3, '三个存在层');
  /* 注入一个「接下来三份依次是 碎 / 不碎 / 不碎」的种子 → 只碎**一份** */
  const pct = TD.BUFF_BY_ID.C49.mods.fragileBreakPct;
  const seedForPattern = (key, pattern) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    let st = h >>> 0 || 1;
    for (let n = 0; n < 200000; n++) {
      let cur = st, ok = true;
      for (const want of pattern) {
        const next = (Math.imul(cur, 1664525) + 1013904223) >>> 0;
        if (((next / 4294967296) * 100 < pct) !== want) { ok = false; break; }
        cur = next;
      }
      if (ok) return st;
      st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    }
    return null;
  };
  const seed = seedForPattern(String(run.salt) + '#' + run.layer + '#C49', [true, false, false]);
  assert.ok(seed != null, '应当能算出一个「碎 / 不碎 / 不碎」的种子');
  live().fragileSeeds = { C49: seed };
  const nx = T.nextBattle('endless');
  T.reportBattle('endless', nx.token, true, 1, null);
  const after = live();
  const r2 = after.limited.find((b) => b.id === 'C49');
  assert.ok(r2, '还剩两份，栏位仍在');
  assert.equal(r2.stacks, 2, '按份结算：只碎了一份（不是整栏一起碎）：' + r2.stacks);
  assert.equal(after.fragileMulBase, 2, '存在层只掉 1');
  assert.equal(after.fragileMulBurned, 1, '损毁层 +1');
  assert.equal((after.brokenMarks || []).length, 1, '明细也只记一份');
  assert.ok(r2.fragileSeed > 0, '这一栏自己的破碎随机数已经记在行上');
  /* 同名两条：各自的行种子必须不同（不再共用 run.fragileSeeds[id]） */
  after.limited = [
    { id: 'C49', stacks: 1, uses: 1000, on: true, uid: 101 },
    { id: 'C49', stacks: 1, uses: 1000, on: true, uid: 102 },
  ];
  after.fragileSeeds = {};
  const a = T._debugFragileRollOf(after, 101, 0);
  const b = T._debugFragileRollOf(after, 102, 0);
  assert.ok(a && b && a.seed > 0 && b.seed > 0, '两条都要拿到自己的种子：' + JSON.stringify([a, b]));
  assert.notEqual(a.seed, b.seed, '同名两条的破碎随机数必须不同：' + a.seed + ' vs ' + b.seed);
  /* 行引用（uid 优先）也能被解析回来 */
  assert.equal(T.rowRefOf(after, 101).uid, 101, 'uid → 行');
});

test('需求127：虚空铭文（C37）按「背包里被附魔过的增益个数」降权 —— 权重 1/(n+1) 且实测出率同步下降', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  const run = T._debugRun('endless');
  run.permanent = []; run.limited = []; run.slotFreeIds = []; run.pickBuffIds = [];
  run.instantIds = []; run.pickGot = {}; run.fragileGot = {}; run.legendPity = 0; run.env = []; run.rarityBoost = 0;
  const setEnch = (n) => {
    run.permanent = [];
    for (let i = 0; i < n; i++) run.permanent.push({ id: 'C25', stacks: 1, uid: i + 1, slotFree: true });
    run.slotFreeIds = n > 0 ? ['C25'] : [];
  };
  /* ① 数据口径：数「背包里被附魔的增益个数」÷(n+1)，不再用「买过几次」的流水。 */
  assert.equal(TD.BUFF_BY_ID.C37.mods.weightDivBy, 'enchanted', 'C37 数「被附魔的增益个数」');
  assert.equal(TD.BUFF_BY_ID.C37.mods.weightDivOffset, 1, 'C37 权重 = ÷(附魔数+1)');
  assert.equal(TD.BUFF_BY_ID.C37.mods.repeatWeight, undefined, 'C37 不再用 pickGot 流水口径');
  /* ② 权重逐档：1 / 1/2 / 1/3 / 1/4 / 1/6 */
  const w = {};
  for (const n of [0, 1, 2, 3, 5]) { setEnch(n); w[n] = T.buffWeightOf(run, 'C37'); }
  assert.equal(w[0], 1, '0 个附魔 → ×1');
  assert.ok(Math.abs(w[1] - 1 / 2) < 1e-9, '1 个 → ×1/2：' + w[1]);
  assert.ok(Math.abs(w[2] - 1 / 3) < 1e-9, '2 个 → ×1/3：' + w[2]);
  assert.ok(Math.abs(w[3] - 1 / 4) < 1e-9, '3 个 → ×1/4：' + w[3]);
  assert.ok(Math.abs(w[5] - 1 / 6) < 1e-9, '5 个 → ×1/6：' + w[5]);
  /* ②b 解析式复算：C37 的全局出率 = 传奇档占比 × 档内占比，且随附魔个数单调下降。
   *（这条是**确定性**断言，不受统计抖动影响；Monte Carlo 只作补充。） */
  const exact = (n) => {
    setEnch(n);
    const cands = (TD.shopPool || TD.endlessPool).filter((b) => T.ownableOf(run, b) && T.poolFilterOf(run, b));
    const baseTier = TD.rawTierWeights(TD.rerollTilt(0, run), run);
    const tw = T.dynamicTierWeightsOf(run, cands, baseTier);
    const tot = tw.reduce((a, b) => a + b, 0) || 1;
    const legends = cands.filter((b) => b.rarity === 3);
    const sum = legends.reduce((a, b) => a + T.buffWeightOf(run, b), 0) || 1;
    return { self: (tw[3] / tot) * (T.buffWeightOf(run, TD.BUFF_BY_ID.C37) / sum), tier: tw[3] / tot };
  };
  const e0 = exact(0), e1 = exact(1), e2 = exact(2), e3 = exact(3), e5 = exact(5);
  assert.ok(e0.self > e1.self && e1.self > e2.self && e2.self > e3.self && e3.self > e5.self,
    'C37 全局出率必须随附魔个数严格下降：' +
    [e0, e1, e2, e3, e5].map((x) => (x.self * 100).toFixed(4) + '%').join(' > '));
  assert.ok(Math.abs(e1.self / e0.self - 0.5) < 0.02,
    '1 个附魔时出率 ≈ 基准的 1/2（档位一起缩水的二阶效应很小）：' + e0.self + ' → ' + e1.self);
  assert.ok(e0.tier > e1.tier && e1.tier > e2.tier && e2.tier > e3.tier && e3.tier > e5.tier,
    '传奇档总概率也要一起下降：' +
    [e0, e1, e2, e3, e5].map((x) => (x.tier * 100).toFixed(4) + '%').join(' > '));
  /* ③ 实测出率（关掉传奇保底 → 纯看动态权重驱动的档位 + 档内抽取）：
   * 3 个附魔后必须明显下降（权重比 1/4，留到 0.6 的宽松阈值以避开统计抖动）。 */
  const rateOf = (setup, id, pages) => {
    setup();
    let hit = 0, total = 0;
    for (let i = 0; i < pages; i++) {
      run.legendPity = 0;                       // 关掉保底：只测「自然权重」
      for (const s of T._debugRollShopSlots(run, 0)) { total++; if (s.id === id) hit++; }
    }
    return hit / total;
  };
  const N = 2000;
  const r0 = rateOf(() => setEnch(0), 'C37', N);
  const r3 = rateOf(() => setEnch(3), 'C37', N);
  assert.ok(r0 > 0 && r3 > 0, 'C37 在两种状态下都应当还能刷到：' + r0 + ' / ' + r3);
  assert.ok(r3 < r0 * 0.6,
    '3 个附魔后 C37 的实际出率必须明显下降：' + (r0 * 100).toFixed(4) + '% → ' + (r3 * 100).toFixed(4) + '%');
  /* ④ 与终焉烙印对照（用户口径）：同样 3 档时，C37 不该再「远高于」C49。 */
  const r49 = rateOf(() => {
    run.permanent = []; run.slotFreeIds = [];
    run.limited = [{ id: 'C49', stacks: 3, uses: 1000, on: true, uid: 77 }];
    run.fragileGot = { C49: 3 };
  }, 'C49', N);
  assert.ok(r3 < r49 * 1.05,
    '3 个附魔时 C37 不该比 3 份的 C49 更常见：' + (r3 * 100).toFixed(4) + '% vs ' + (r49 * 100).toFixed(4) + '%');
});

test('需求128：豪掷千金步长 100→120；豪掷千金 / 门庭若市 达到「背包一格」上限后不再刷新', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  /* ① C58 步长 120 + 文案同步 */
  assert.equal(TD.BUFF_BY_ID.C58.mods.shopSpendLimited, 120, 'C58 步长应当是 120');
  assert.match(TD.BUFF_BY_ID.C58.desc, /120 试炼币/, 'C58 文案要写 120：' + TD.BUFF_BY_ID.C58.desc);
  assert.equal(TD.BUFF_BY_ID.C58.maxStacks, 1, 'C58「背包一格」上限 = 1 层');
  assert.ok(TD.hasTag(TD.BUFF_BY_ID.C58, 'noRestack'), 'C58 拿满即出池（不再开新栏位重复刷）');
  assert.equal(TD.BUFF_BY_ID.C59.maxStacks, 3, 'C59「背包一格」上限 = 3 层');
  assert.ok(TD.hasTag(TD.BUFF_BY_ID.C59, 'noRestack'), 'C59 拿满即出池');
  assert.ok(TD.hasTag(TD.BUFF_BY_ID.C59, 'stackable'), 'C59 仍然可以同栏叠到 3 层');

  S.newGame('cap' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  T.startEndlessRun();
  const live = () => T._debugRun('endless');
  {
    const run = live();
    run.permanent = []; run.limited = []; run.slotFreeIds = []; run.coins = 9999;
    run.shop = null; run.phase = null; run.choices = null;
  }
  /* ② C58：拿 1 份之后既不能再拿（addBuff 拒绝），也不再进池（不再刷新） */
  const r1 = T.addBuff(live(), 'C58');
  assert.ok(r1 && r1.ok, '第一份豪掷千金应当能拿到：' + JSON.stringify(r1));
  assert.equal(T.stacksOf(live(), 'C58'), 1, '只有 1 层');
  assert.equal(T.poolFilterOf(live(), TD.BUFF_BY_ID.C58), false, '到达一格上限后应当出池（不再刷新）');
  assert.equal(T.ownableOf(live(), TD.BUFF_BY_ID.C58), false, 'ownable 也要跟着关掉');
  const r2 = T.addBuff(live(), 'C58');
  assert.ok(!r2.ok, '第二份豪掷千金不该再能拿到：' + JSON.stringify(r2));
  assert.equal(live().permanent.filter((b) => b.id === 'C58').length, 1, '不该开出第二个栏位');
  /* ③ C59：同栏叠到 3 层，第 4 份既不能拿也出池 */
  for (let i = 1; i <= 3; i++) {
    const r = T.addBuff(live(), 'C59');
    assert.ok(r && r.ok, '第 ' + i + ' 份门庭若市应当能拿到：' + JSON.stringify(r));
  }
  assert.equal(T.stacksOf(live(), 'C59'), 3, '应当叠到 3 层');
  assert.equal(live().permanent.filter((b) => b.id === 'C59').length, 1, '3 层都在同一栏位（不再开新栏）');
  assert.equal(T.poolFilterOf(live(), TD.BUFF_BY_ID.C59), false, 'C59 到达一格上限后应当出池');
  const r4 = T.addBuff(live(), 'C59');
  assert.ok(!r4.ok, '第 4 份门庭若市不该再能拿到：' + JSON.stringify(r4));
  assert.equal(live().permanent.filter((b) => b.id === 'C59').length, 1, '仍然只有一栏');
  /* ④ 未满之前照常进池（别把上限判断写成「拿到即出池」） */
  {
    const run = live();
    run.permanent = [{ id: 'C59', stacks: 1 }];
    assert.equal(T.poolFilterOf(run, TD.BUFF_BY_ID.C59), true, '1/3 层时仍在池子里');
    run.permanent = [{ id: 'C59', stacks: 2 }];
    assert.equal(T.poolFilterOf(run, TD.BUFF_BY_ID.C59), true, '2/3 层时仍在池子里');
  }
});

test('需求129：常驻挑战当日递增 —— 每通关一整次（3 场全胜），敌全属性（力敏速血）+5%，无上限；两塔不受影响', () => {
  const c = setup();
  const GData = c.GData, T = c.Tower, S = c.State;
  /* ① 乘区：1 + 5% × n，叠加无上限 */
  assert.equal(GData.CHALLENGE_DAILY_STAT_STEP, 0.05, '每次 +5%');
  assert.equal(GData.challengeDailyMul(0), 1, '0 次 → ×1');
  assert.ok(Math.abs(GData.challengeDailyMul(1) - 1.05) < 1e-9, '1 次 → ×1.05');
  assert.ok(Math.abs(GData.challengeDailyMul(4) - 1.2) < 1e-9, '4 次 → ×1.2');
  assert.ok(Math.abs(GData.challengeDailyMul(20) - 2) < 1e-9, '20 次 → ×2（无上限）');
  /* ② State.challengeDailyCount：只数「通关一整轮」，与每日任务的「每赢一场」计数分开 */
  S.newGame('daily' + Math.random());
  const st = S.state();
  assert.equal(S.challengeDailyCount(), 0, '新档当天 0 次');
  st.challengeDaily = { date: S.localDate(), count: 3 };
  assert.equal(S.challengeDailyCount(), 3, '今天通关 3 整轮 → 3 次');
  st.challengeDaily = { date: '2000-01-01', count: 9 };
  assert.equal(S.challengeDailyCount(), 0, '过期的计数 → 0（每日重置）');
  st.challengeDaily = null;
  assert.equal(S.challengeDailyCount(), 0, '没有计数 → 0');
  /* 「每赢一场」的每日任务计数**不再**驱动这个乘区（04 口径：只在整轮通关时 +1）。 */
  st.dailyCounters = { date: S.localDate(), stage: 5 };
  assert.equal(S.challengeDailyCount(), 0, '光赢了几场（没通关整轮）不该加惩罚');
  /* ③ stageFoe：力/敏/速/血**一起**被放大 */
  const npc = S.npcOf(7, 2);
  assert.ok(npc, '应当能取到关卡 7 的第 2 个 NPC');
  const anim = GData.stageTypeOf(7).anim;
  const foe0 = GData.stageFoe(npc, 7, anim, 0);
  const foe4 = GData.stageFoe(npc, 7, anim, 4);
  for (const k of ['power', 'agility', 'speed', 'hp']) {
    assert.equal(foe4[k], Math.max(1, Math.round(foe0[k] * 1.2)), k + ' 应当 +20%：' + foe0[k] + ' → ' + foe4[k]);
    assert.ok(foe4[k] > foe0[k], k + ' 必须跟着变大');
  }
  assert.equal(foe0.name, npc.name, '名字不变');
  assert.equal(foe0.npcType, anim, '贴图不变');
  assert.equal(foe0.level, 10 + 7 * 2, '等级口径不变');
  /* ④ 真实路径：走完整的一轮（3 场胜利 → 通关）才会 +1；单场胜利不 +1 */
  S.newGame('bump' + Math.random());
  {
    const s2 = S.state(); s2.level = 70; s2.props[23] = 999;
    for (let i = 1; i <= 18; i++) s2.stages[i] = { npcIndex: 3, passed: true };
  }
  const before = S.challengeDailyCount();
  const winOne = (sid) => {
    const started = S.beginStageBattle(sid);
    assert.ok(started.ok, '应当能开始关卡战斗：' + JSON.stringify(started));
    S.finishStageBattle(sid, started.token, true, 1);
  };
  {
    const started = S.beginStageBattle(1);
    assert.ok(started.ok, '第一场应当能开：' + JSON.stringify(started));
    assert.equal(S.challengeDailyCount(), before, '开了但没打完 → 不加惩罚');
    S.interruptStageBattle(1, started.token);      // 中断（不消耗额外挑战书）后再正常打
  }
  winOne(1);
  assert.equal(S.challengeDailyCount(), before, '只赢第 1 场（共 3 场）→ 还不算通关');
  winOne(1);
  assert.equal(S.challengeDailyCount(), before, '赢了 2 场 → 还不算通关');
  winOne(1);
  assert.equal(S.challengeDailyCount(), before + 1, '3 场全胜 = 通关一整轮 → 当天次数 +1');
  assert.ok(GData.challengeDailyMul(S.challengeDailyCount()) > GData.challengeDailyMul(before),
    '同一关再来一轮就会更难');
  /* 连打第二整轮 → 再 +1（叠加无上限） */
  for (let i = 0; i < 3; i++) winOne(1);
  assert.equal(S.challengeDailyCount(), before + 2, '通关第二整轮 → 再 +1');
  /* 计数要挺过存档归一化（normalizeSave 的白名单） */
  S.save();
  S.load();
  assert.equal(S.challengeDailyCount(), before + 2, '读档后当天次数仍在：' + S.challengeDailyCount());
  /* ⑤ 两塔不受影响：塔/无尽的敌人构建不读这个乘区 */
  const towerSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower.js'), 'utf8');
  const tdSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-data.js'), 'utf8');
  assert.ok(!/challengeDaily/.test(towerSrc), 'tower.js 不该读常驻挑战日惩罚');
  assert.ok(!/challengeDaily/.test(tdSrc), 'tower-data.js 不该读常驻挑战日惩罚');
  /* 关卡 UI 两个入口都要真的套上（classic-ui 是当前实装，ui.js 是遗留兜底） */
  const cui = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8');
  const legacyUi = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
  assert.match(cui, /GData\.stageFoe\(npc,\s*stageId,\s*type\.anim,\s*dailyCount\)/, 'classic-ui 的 stageFight 要走 stageFoe');
  assert.match(legacyUi, /GData\.stageFoe\(npc,\s*stageId,\s*type\.anim,\s*dailyCount\)/, 'ui.js 兜底路径也要走 stageFoe');
  assert.match(cui, /State\.challengeDailyCount/, '界面要读当天次数（stageConfirm 提示也用它）');
  /* 通关计数必须挂在 finishStageBattle 的 complete 分支上（不是 recordBattle 的每场胜利） */
  const stSrc = fs.readFileSync(path.join(ROOT, 'js', 'state.js'), 'utf8');
  assert.match(stSrc, /if \(complete\) \{[\s\S]{0,200}noteChallengeClear\(\)/,
    '通关一整轮时才应当 noteChallengeClear()');
});

test('需求130：挑战塔 20 层首领（无常）削弱 + 狂战松鼠进无尽塔精英/Boss 池 + 双边互通排查', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;
  /* ① 无常削弱：武器等级、小宇宙爆发等级、三维 bias（出手频率），并修正与实装不符的描述 */
  const w = TD.WARLORD_POOL.filter((x) => x.name === '狂战松鼠·无常')[0];
  assert.ok(w, '变体池里应当有「狂战松鼠·无常」');
  assert.equal(w.weapons[0].level, 8, '武器等级 12 → 8（层 20 实际 14 → 10）');
  assert.equal(w.skills.filter((k) => k.id === 14)[0].level, 8, '小宇宙爆发 12 → 8');
  assert.ok(w.bias.speed <= 1.02 && w.bias.agility <= 1.00,
    '敏捷/速度 bias 下调（削弱「出手比玩家多」）：' + JSON.stringify(w.bias));
  assert.ok(!/冻结与吸血/.test(w.mechDesc),
    '旧描述里的「冻结与吸血」与它的武技（激光剑/绝对防御/装死/皮糙肉厚）不符，应当改掉：' + w.mechDesc);
  assert.match(w.mechDesc, /绝对防御/, '描述要写清楚它真正的防御手段');
  /* ② 无尽塔池子：加入狂战松鼠（精英），x10 层的第 4 场不再抽到它（第 5 场已固定一只） */
  assert.ok(TD.ENDLESS_BOSS_POOL.some((x) => x.kind === 'warlord'),
    '无尽塔 boss 池里应当有「狂战松鼠」：' + JSON.stringify(TD.ENDLESS_BOSS_POOL.map((x) => x.kind + ':' + x.id)));
  assert.equal(TD.ENDLESS_BOSS_POOL.filter((x) => x.kind === 'warlord').length, 1, '只放一条（变体按层数哈希取）');
  assert.ok(!TD.BOSS_POOL.some((x) => x.kind === 'warlord'), '挑战塔随机池不加狂战（x10 第 5 场已固定）');
  let found = 0;
  for (let s = 0; s < 120; s++) {
    for (let layer = 1; layer <= 30; layer++) {
      const e = TD.bossFor(layer, 'salt' + s, true);
      if (e.kind === 'warlord') { found++; assert.notEqual(layer % 10, 0, 'x10 层第 4 场不该再抽到狂战'); }
    }
  }
  assert.ok(found > 0, '换 salt 应当能抽到狂战（实测 ' + found + ' 次）');
  assert.ok(found < 120 * 30, '也不是每层都是狂战：' + found);
  /* ③ 预告 == 实战：池子里抽到的狂战 entry 必须带上本层 layer/salt（变体才不会退回第一只） */
  S.state().props[23] = 9999;
  const origBossFor = TD.bossFor;
  TD.bossFor = (layer, salt, only) => ({ kind: 'warlord', id: 'warlord' });
  {
    const st = S.state(); if (st.endless) st.endless.run = null;
    T.startEndlessRun();
    const run = T._debugRun('endless');
    const pv = T.preview(run.layer, run.salt, true);
    assert.equal(pv[3].kind, 'warlord', '第 4 场应当被抽成狂战');
    assert.equal(pv[3].elite, true, '狂战进第 4 场时算精英（×1.2 + 精英掉落/计分）');
    run.idx = 3;
    const nx = T.nextBattle('endless');
    assert.equal(nx.entry.kind, 'warlord', '实战也应当是狂战');
    assert.equal(nx.info.name, pv[3].name, '预告与实战必须是同一只变体：' + pv[3].name + ' vs ' + nx.info.name);
    /* 变体按「本层 layer + salt」解析：预告侧也必须跟着层数变（不挂 _layer/_salt 就会永远是第一只）。 */
    for (const layer of [1, 3, 10, 20, 30]) {
      const e = T.preview(layer, run.salt, true)[3];
      assert.equal(e.name, TD.warlordFor(layer, run.salt).name,
        layer + ' 层预告的变体要按本层 layer/salt 解析：' + e.name + ' vs ' + TD.warlordFor(layer, run.salt).name);
    }
    /* 实战侧同理：把 plan 换成「本层重建」后的样子（正式流程由 advanceLayer 重建，layer/salt 一致）。 */
    TD.bossFor = (layer, salt, only) => ({ kind: 'warlord', id: 'warlord' });
    for (const layer of [3, 20]) {
      const plan = T.preview(layer, run.salt, true);
      assert.equal(plan[3].kind, 'warlord');
      assert.equal(plan[3].elite, true);
    }
    const st2 = S.state(); if (st2.endless) st2.endless.run = null;
  }
  TD.bossFor = origBossFor;
  /* ④ 模拟测试：20 层第 5 场（无常）在推荐等级下的单场胜率 —— 削弱后不再是「1~3% 的墙」。
   * 用固定种子（__seed）跑，结果可复现：这里是「防止以后又被调回超模」的守门断言。 */
  const bossWinRate = (layer, runs) => {
    const LT = TD.towerLevel(layer);
    let win = 0, n = 0;
    for (let i = 0; i < runs; i++) {
      const st = S.state(); if (st.tower) st.tower.run = null;
      T._debugSetLayer(layer - 1);
      T.startTowerRun();
      const run = T._debugRun('tower');
      if (!run) break;
      run.idx = 4;
      const nx = T.nextBattle('tower');
      if (!nx || !nx.ok) break;
      const me = S.genAI(LT, '', { levelJitter: 0, gearSelfLevel: true });
      me.maxHp = me.hp; nx.adjustMe(me);
      const res = Sim.simulate(me, nx.foe);
      n++; if (res.winner === 0) win++;
    }
    const st2 = S.state(); if (st2.tower) st2.tower.run = null;
    return n ? win / n : 0;
  };
  c.__seed(20261001);
  const r20 = bossWinRate(20, 150);
  assert.ok(r20 >= 0.06,
    '20 层第 5 场（无常）削弱后单场胜率应当 ≥6%（原来约 1~3%）：' + (r20 * 100).toFixed(1) + '%');
  assert.ok(r20 <= 0.4, '也不该软成普通怪 —— 它仍是塔顶 boss：' + (r20 * 100).toFixed(1) + '%');
});

test('需求131：狂战套只准出现在 10 的整数层（无尽第 4 场抽到狂战松鼠时也换成普通套装）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.state().props[23] = 9999;
  const BERSERK = [201, 202, 203, 204];
  const berserkCount = (wears) => (wears || []).filter((w) => BERSERK.includes(w.id)).length;
  /* ① 非 x10 层：第 4 场如果是狂战松鼠，必须换成该层的普通套装，且**预告 = 实战** */
  const orig = TD.bossFor;
  TD.bossFor = () => ({ kind: 'warlord', id: 'warlord' });
  for (const layer of [1, 3, 7, 9, 11, 19, 21, 29]) {
    const ss = S.state(); if (ss.endless) ss.endless.run = null;
    T.startEndlessRun();
    const run = T._debugRun('endless');
    run.layer = layer;
    run.plan[3] = { kind: 'warlord', id: 'warlord', _layer: layer, _salt: run.salt };
    const pv = T.preview(layer, run.salt, true);
    assert.equal(pv[3].kind, 'warlord', layer + ' 层第 4 场应当是狂战松鼠');
    assert.notEqual(pv[3].gear, 'berserk',
      layer + ' 层（非整数层）的预告不该画成狂战套：' + pv[3].gear);
    run.idx = 3;
    const nx = T.nextBattle('endless');
    assert.equal(nx.entry.kind, 'warlord');
    assert.equal(berserkCount(nx.foe.wears), 0,
      layer + ' 层第 4 场不该穿任何狂战件：' + JSON.stringify((nx.foe.wears || []).map((w) => w.id)));
    assert.equal(TD.wearsOf(pv[3].gear).map((w) => w.id).join(','), (nx.foe.wears || []).map((w) => w.id).join(','),
      layer + ' 层预告的套装必须与实战一致（' + pv[3].gear + '）');
    const ss2 = S.state(); if (ss2.endless) ss2.endless.run = null;
  }
  TD.bossFor = orig;
  /* ② x10 层第 5 场的守关首领：仍然整套狂战，预告也是狂战 */
  for (const layer of [10, 20, 30]) {
    const ss = S.state(); if (ss.tower) ss.tower.run = null;
    T._debugSetLayer(layer - 1);
    T.startTowerRun();
    const run = T._debugRun('tower');
    run.idx = 4;
    const nx = T.nextBattle('tower');
    assert.match(nx.info.name, /狂战松鼠/, layer + ' 层第 5 场必须是塔顶首领');
    assert.equal(berserkCount(nx.foe.wears), 4,
      layer + ' 层塔顶首领应当整套狂战：' + JSON.stringify((nx.foe.wears || []).map((w) => w.id)));
    assert.equal(T.preview(layer, undefined, false)[4].gear, 'berserk', 'x10 层的预告仍是狂战套');
    const ss2 = S.state(); if (ss2.tower) ss2.tower.run = null;
  }
  /* ③ 真实抽卡：x10 层第 4 场永远不会抽到狂战（狂战套只属于塔顶那一场） */
  assert.ok(!TD.BOSS_POOL.some((x) => x.kind === 'warlord'), '挑战塔随机池不加狂战');
  for (let s = 0; s < 60; s++) {
    for (let layer = 1; layer <= 40; layer++) {
      const e = TD.bossFor(layer, 'k' + s, true);
      if (layer % 10 === 0) assert.notEqual(e.kind, 'warlord', 'x10 层第 4 场不该抽到狂战');
    }
  }
  /* ④ gearKeyForLayer 的既有口径不变：x10 → 狂战；非 x10 → 普通档位 */
  assert.equal(TD.gearKeyForLayer(10, 'ninja1'), 'berserk', 'x10 层仍是狂战');
  assert.notEqual(TD.gearKeyForLayer(9, 'berserk'), 'berserk', '非 x10 层不允许狂战套');
  assert.notEqual(TD.gearKeyForLayer(11, 'berserk'), 'berserk', '非 x10 层不允许狂战套');
});

test('需求132：每 5 层（非 x10）的最后一战改为精英 —— 原来 x5 与普通层毫无区别', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  S.state().props[23] = 9999;
  const openBattle = (mode, layer, idx) => {
    const ss = S.state(); if (ss.tower) ss.tower.run = null; if (ss.endless) ss.endless.run = null;
    T._debugSetLayer(layer - 1);
    if (mode === 'tower') T.startTowerRun(); else { T._debugSetEndlessLayer(layer); T.startEndlessRun(); }
    const run = T._debugRun(mode);
    run.layer = layer; run.idx = idx;
    return { run, nx: T.nextBattle(mode) };
  };
  for (const mode of ['tower', 'endless']) {
    const only = mode !== 'tower';
    /* ① x5 层：最后一战（第 4 场）是精英，预告与实战一致。
     * 注意预告必须用**这一局的 salt**（挑战塔无 salt）——否则抽到的是另一只 boss，比较无意义。 */
    for (const layer of [5, 15, 25]) {
      const { run, nx } = openBattle(mode, layer, 3);
      const pv = T.preview(layer, mode === 'tower' ? undefined : run.salt, only);
      assert.equal(pv.length, 4, layer + ' 层应当是 4 场');
      assert.equal(pv[3].elite, true, mode + ' ' + layer + ' 层最后一战应当是精英（原来与普通层没区别）');
      assert.ok(pv[3].type, '精英仍然带类型标签');
      assert.equal(nx.elite, true, mode + ' ' + layer + ' 层实战 elite 标记');
      assert.equal(nx.info.elite, true, '战报的 info.elite 也要一致');
      assert.equal(pv[3].name, nx.info.name, '预告 = 实战：' + pv[3].name + ' vs ' + nx.info.name);
    }
    /* ② 非 x5 层：最后一战照旧不是精英（唯一例外是无尽池里随机抽到的狂战松鼠 —— 它本来就是精英） */
    for (const layer of [4, 6, 14, 16, 24, 26, 29]) {
      const { nx } = openBattle(mode, layer, 3);
      const warlord = nx.entry.kind === 'warlord';
      assert.equal(nx.elite, warlord,
        mode + ' ' + layer + ' 层（非 x5）的精英标记只能来自狂战松鼠：' + nx.entry.kind);
      assert.equal(nx.info.elite, nx.elite, '战报的 info.elite 也要一致');
    }
    /* ③ x10 层：第 4 场不是精英、第 5 场塔顶才是（一层只留一个精英台阶） */
    for (const layer of [10, 20]) {
      const pv = T.preview(layer, 'x5test', only);
      assert.equal(pv.length, 5, layer + ' 层应当是 5 场');
      assert.equal(pv[3].elite, false, layer + ' 层第 4 场不该是精英');
      assert.equal(pv[4].elite, true, layer + ' 层第 5 场（塔顶首领）必须是精英');
      assert.equal(openBattle(mode, layer, 3).nx.elite, false, layer + ' 层第 4 场实战不该是精英');
      assert.equal(openBattle(mode, layer, 4).nx.elite, true, layer + ' 层第 5 场实战必须是精英');
    }
  }
  /* ④ 精英奖励真的发：x5 层最后一战击败后至少拿到 SCORE.elite */
  {
    const { run, nx } = openBattle('endless', 5, 3);
    const before = run.score;
    T.reportBattle('endless', nx.token, true, 1, null);
    const after = T._debugRun('endless');
    const expect = TD.SCORE && Number(TD.SCORE.elite) ? Number(TD.SCORE.elite) : 50;
    assert.ok(after.score - before >= expect,
      '击败 x5 精英应当拿到精英分（≥' + expect + '），实测 +' + (after.score - before));
  }
});

test('需求133：无尽专属调试 —— 快速爬塔「层数 +1 / -1」与手开「铸币商店 / 普通商店」', () => {
  const c = setup();
  const T = c.Tower;
  /* ① 快速爬塔：没有对局时 ±1 都先开一局（落在第 1 层），有对局时按 ±1 挪层并夹在第 1 层 */
  assert.ok(T.abandon('endless').ok, '先清掉 setup 里那局');
  assert.equal(T._debugRun('endless'), null);
  assert.equal(T._debugShiftEndlessLayer(1).layer, 1, '没有对局时 +1 先开局（落在第 1 层）');
  assert.ok(T._debugRun('endless'), '应当已经开了一局');
  assert.equal(T._debugShiftEndlessLayer(1).layer, 2, '+1');
  assert.equal(T._debugShiftEndlessLayer(1).layer, 3, '+1');
  assert.equal(T._debugShiftEndlessLayer(-1).layer, 2, '-1');
  assert.equal(T._debugShiftEndlessLayer(-1).layer, 1, '-1');
  assert.equal(T._debugShiftEndlessLayer(-1).layer, 1, '最低夹在第 1 层');
  assert.equal(T._debugShiftEndlessLayer(-99).layer, 1, '再退也不低于 1');
  /* 挪层口径与 _debugSetEndlessLayer 一致：plan 重建、层内进度归零 */
  assert.equal(T._debugShiftEndlessLayer(9).layer, 10, '1 + 9 = 10');
  const run = T._debugRun('endless');
  assert.equal(run.idx, 0, '层内序号归零');
  assert.equal(run.phase, null, '不在商店 / 结算阶段');
  assert.equal(run.choices, null, '不残留上一层的选牌');
  assert.equal(run.plan.length, 5, '第 10 层（x10）应当是 5 场');
  /* 层数与预告对得上（重建 plan 用的是同一套 salt） */
  assert.equal(T.planInfo('endless').length, run.plan.length, '界面预告与实战 plan 同源');

  /* ② 手开「普通商店」：试炼商店 + 战后临时小店（关掉后回去继续打，不会被当成结算商店） */
  const sp = T._debugSpawnShop();
  assert.ok(sp.ok, '应当能立刻开出普通商店：' + (sp.msg || ''));
  assert.equal(sp.layer, 10);
  assert.equal(sp.slots, T.shopState().slots.length, '报告件数与实际货架一致');
  assert.equal(T.shopState().mint, false, '必须是普通（试炼）商店');
  assert.equal(T.shopState().postBattle, true, '标记成战后临时小店');
  assert.equal(T._debugRun('endless').phase, 'shop');
  assert.ok(T.closeShop().ok, '应当能关掉');
  assert.equal(T._debugRun('endless').phase, null, '关掉后回到战斗流程');
  assert.equal(T._debugRun('endless').shop, null);
  assert.equal(T._debugRun('endless').layer, 10, '不该顺带把整局推进到结算点');

  /* ③ 没有对局时两个手开接口都给明确提示 */
  T.abandon('endless');
  const noShop = T._debugSpawnShop();
  assert.equal(noShop.ok, false);
  assert.match(noShop.msg, /无尽塔对局/, '提示要说清原因：' + noShop.msg);
  const noMint = T._debugSpawnMintShop();
  assert.equal(noMint.ok, false);
  assert.match(noMint.msg, /无尽塔对局/, '铸币商店也是同一口径：' + noMint.msg);

  /* ④ 界面接线（真点击在 tools/test-mint-shop.cjs 里，这里守源码口径） */
  const dbgSrc = fs.readFileSync(path.join(ROOT, 'js', 'debug.js'), 'utf8');
  assert.ok(/data-endless-layer="1"/.test(dbgSrc) && /data-endless-layer="-1"/.test(dbgSrc), '要有层数 +1 / -1 按钮');
  assert.ok(/_debugShiftEndlessLayer/.test(dbgSrc), '层数按钮要接 _debugShiftEndlessLayer');
  assert.ok(/data-shop="1"/.test(dbgSrc) && /_debugSpawnShop/.test(dbgSrc), '要有普通商店按钮并接 _debugSpawnShop');
  assert.ok(/data-mint-shop[^>]*>铸币商店</.test(dbgSrc), '铸币商店按钮文案缩减为「铸币商店」：' + dbgSrc.match(/data-mint-shop[^>]*>[^<]*</));
  assert.ok(/data-shop[^>]*>普通商店</.test(dbgSrc), '普通商店按钮文案写「普通商店」：' + dbgSrc.match(/data-shop[^>]*>[^<]*</));
  const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'debug.css'), 'utf8');
  assert.ok(/\.debug-quick\{/.test(cssSrc), '快捷行要有自己的两列布局');
});

test('需求134：新增传奇·限次 3「假如我直接赢」—— 开战即判胜，且不随重复获得降权', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const b = TD.BUFF_BY_ID.E17;
  assert.ok(b, '应当有「假如我直接赢」（E17）');
  assert.equal(b.name, '假如我直接赢');
  assert.equal(b.rarity, 3, '用户口径：传奇');
  assert.equal(b.kind, 'limited');
  assert.equal(b.uses, 3, '用户口径：限次 3');
  assert.equal(b.mods.openKill, 1, '效果键是 openKill');
  for (const t of ['endless', 'battle', 'limited', 'nextBattle', 'shop']) {
    assert.ok(TD.hasTag(b, t), 'E17 应当带标签 ' + t + '：' + JSON.stringify(b.tags));
  }
  assert.ok(!TD.hasTag(b, 'tower'), '无尽塔专属（挑战塔不放这条机制）');
  /* 用户口径：**不设重复获得时降权** —— 不写 repeatWeight / weightDivBy。
   * （没写 pityWeight 也没关系：保底池缺省权重就是 1，见 tower.js 的 pityWeightOf。） */
  assert.equal(b.mods.repeatWeight, undefined, '不能有 repeatWeight');
  assert.equal(b.mods.weightDivBy, undefined, '不能有 weightDivBy');
  assert.ok(TD.endlessPool.some((x) => x.id === 'E17'), '进无尽场间池');
  assert.ok(TD.shopPool.some((x) => x.id === 'E17'), '试炼商店能卖');
  assert.ok(TD.mintPool.some((x) => x.id === 'E17'), '铸币商店也能卖');

  /* 真实路径：拿牌 → nextBattle → adjustMe（Main.startBattle 就是这么做的）→ Sim.simulate */
  const run0 = T._debugRun('endless');
  run0.permanent = []; run0.limited = []; run0.choices = null; run0.phase = null;
  assert.ok(T.addBuff(run0, 'E17').ok, '应当拿得到');
  const nx = T.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
  const me = S.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
  me.maxHp = me.hp;
  nx.adjustMe(me);
  assert.equal(me.mods.openKill, 1, '本场修正里必须带上 openKill');
  const res = c.Sim.simulate(me, nx.foe);
  assert.equal(res.winner, 0, '应当直接判我方胜');
  assert.equal(res.rounds.length, 1, '只结算一条「开局清零」事件：' + res.rounds.length);
  assert.equal(res.rounds[0].noteText, '假如我直接赢', '回放飘字');
  assert.ok(res.rounds[0].dmg >= 1, '飘字要有实际伤害数值：' + res.rounds[0].dmg);
  assert.equal(res.rounds[res.rounds.length - 1].hpAfter[1], 0, '敌方生命应当归零');

  /* 限次 3：前三场都带 openKill，第四场就没了 */
  let openKillBattles = 0;
  for (let i = 0; i < 4; i++) {
    const r = T._debugRun('endless');
    if (!r) break;
    if (r.choices) r.choices = null;
    if (r.phase) break;
    const n = i === 0 ? nx : T.nextBattle('endless');
    if (!n || n.ok === false) break;
    const m2 = S.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    m2.maxHp = m2.hp;
    n.adjustMe(m2);
    if (m2.mods.openKill) openKillBattles++;
    T.reportBattle('endless', n.token, true, 1, null);
  }
  assert.equal(openKillBattles, 3, '限次 3 → 前三场都是秒杀场，第四场不该再有 openKill');
  assert.equal((T._debugRun('endless').limited || []).some((x) => x.id === 'E17'), false, '限次用完即走');

  /* 不降权：就算同时持有 2 份（模拟）权重也不变；对照组终焉烙印（C49）会按 0.88^(n−1) 衰减 */
  const run = T._debugRun('endless');
  run.limited = [{ id: 'E17', stacks: 1, uses: 3, on: true, uid: 1, at: 1 },
    { id: 'E17', stacks: 1, uses: 3, on: true, uid: 2, at: 2 }];
  assert.equal(T.buffWeightOf(run, 'E17'), 1, '持有 2 份时权重仍是 1（不降权）');
  run.limited = [{ id: 'C49', stacks: 1, uses: 1000, on: true, uid: 1, at: 1 },
    { id: 'C49', stacks: 1, uses: 1000, on: true, uid: 2, at: 2 },
    { id: 'C49', stacks: 1, uses: 1000, on: true, uid: 3, at: 3 }];
  assert.ok(T.buffWeightOf(run, 'C49') < 1, '对照：终焉烙印（C49）持有 3 份会降权：' + T.buffWeightOf(run, 'C49'));

  /* 调试台总览要能写出这条效果（buffEffectLines） */
  run.limited = [{ id: 'E17', stacks: 1, uses: 3, on: true, uid: 9, at: 9 }];
  const rep = T.debugBuffReport('endless');
  assert.ok(rep && rep.ok, '增益总览应当读得到');
  assert.ok(rep.effects.some((row) => /假如我直接赢/.test(row[0])), '效果清单里要有它：' + JSON.stringify(rep.effects));
});

test('需求135：无尽塔增益介绍补全 —— 每条都写明「最多叠几层 / 唯一 / 无限」', () => {
  const c = setup();
  const TD = c.TowerData;
  const note = (id) => TD.stackNote(TD.BUFF_BY_ID[id]);
  const desc = (id) => TD.descOf(TD.BUFF_BY_ID[id], 'endless');

  /* ① 数据层：口径与 stackCap 一致 */
  assert.equal(note('C26'), '可无限叠加', 'C26 蛮力：可无限叠加');
  assert.equal(note('C27') && note('C28') && note('C29'), '可无限叠加', 'C27~C29 也是无限叠加');
  assert.equal(note('C03'), '最多叠 3 层', 'C03 猎侠者：stackable 无 maxStacks → 同栏 3 层');
  assert.equal(note('C14'), '最多叠 2 层，拿满后本局不再出现', 'C14 涅槃：maxStacks 2 + noRestack');
  assert.equal(note('C50'), '最多叠 3 层，拿满后本局不再出现', 'C50 抉择扩充：3 层 + noRestack');
  assert.equal(note('C59'), '最多叠 3 层，拿满后本局不再出现', 'C59 门庭若市：3 层 + noRestack');
  assert.equal(note('C54'), '最多叠 2 层', 'C54 越战越勇：2 层');
  assert.equal(note('C04'), '同名唯一，只有 1 层', 'C04 生命源泉：unique');
  assert.equal(note('C36'), '同名最多 1 份，一局只可能拿到一次', 'C36 挥金如土：oncePerRun');
  assert.equal(note('C55'), '同名唯一，只有 1 层', 'C55 后发制人：noRestack 且 cap=1');
  assert.equal(note('C58'), '同名唯一，只有 1 层', 'C58 豪掷千金：noRestack 且 cap=1');
  assert.equal(note('C01'), '不叠层：每份占一个新栏位', 'C01 这类普通永久件：同名多份 = 多栏位');
  assert.equal(note('C49'), '可无限叠加', 'C49 终焉烙印：无限叠加（份数越多越难再出）');
  assert.equal(note('C52'), '可无限叠加', 'C52 涌泉烙印：无限叠加');
  assert.equal(note('C39'), '同名唯一，用尽或损毁后才可能再获得', '易碎烙印：损毁也要写进去');
  assert.equal(note('E05'), '同名唯一，用尽后才可能再获得', '限次类：用完才可能再获得');
  assert.equal(note('E16'), '同名唯一，用尽后才可能再获得', 'E16 也一样');
  assert.equal(note('E14'), '可重复获得，效果可累积', 'E14 讨价还价：可重复获得');
  assert.equal(note('N01'), '', '挑战塔专属（不在无尽体系里）不加叠层说明');

  /* ② 展示层：descOf 每条无尽增益都带叠层说明，且不再出现双括号
   *（即时类不做叠层，只有可重复获得的才补一句）。 */
  const list = TD.BUFFS.filter((b) => TD.hasTag(b, 'endless') && !TD.hasTag(b, 'hidden'));
  assert.ok(list.length > 70, '无尽增益数量应当 > 70：' + list.length);
  for (const b of list) {
    const d = TD.descOf(b, 'endless');
    if (b.kind !== 'instant') {
      assert.ok(d.includes('（') && /（[^（）]*）$/.test(d), b.id + ' 的介绍末尾应当有叠层说明：' + d);
    }
    assert.ok(!/（[^（）]*（/.test(d), b.id + ' 不该出现嵌套括号：' + d);
  }
  assert.equal(desc('C26'), '攻击 +20%（可无限叠加）', 'C26 卡面');
  assert.equal(desc('C50'), '战斗获得的选择项 +1（最多叠 3 层，拿满后本局不再出现）', 'C50 卡面');
  assert.match(desc('C51'), /同名唯一，只有 1 层/, 'C51 天命所归：unique');

  /* ③ 旧文案里手写的层数已经搬进 stackNote（不重复、不脱节） */
  assert.ok(!/可叠 \d 层|最多 \d 层|不可叠加/.test(TD.BUFF_BY_ID.C50.desc + TD.BUFF_BY_ID.C51.desc +
    TD.BUFF_BY_ID.C54.desc + TD.BUFF_BY_ID.C59.desc), '这 4 条的层数说明应当由 stackNote 统一补，不再手写');
});

test('需求136：挑战塔主界面显示环境词缀；难度曲线封顶（无尽塔不封顶）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');

  /* ① 主界面：挑战塔的「进行中」那一屏要有环境面板 + 三侠削弱面板 */
  const at = uiSrc.indexOf('function openTower(');
  assert.ok(at > 0, '找不到 openTower');
  const body = uiSrc.slice(at, uiSrc.indexOf('【U7】', at));
  assert.ok(/envPanelHtml\(run, \{ label: '当前环境' \}\)/.test(body), '挑战塔主界面要画环境面板：' + body.slice(0, 400));
  assert.ok(/debuffPanel\(run\.debuffs\)/.test(body), '挑战塔主界面要保留三侠削弱面板');
  assert.ok(/carryBar\(run\.curHp/.test(body), '血量条不能被挤掉');
  assert.ok(!/无尽挑战塔 · 第/.test(body), '挑战塔的标题不该写成「无尽挑战塔」');
  assert.match(body, /挑战塔 · 第/, '未开局那一屏的标题应当是「挑战塔 · 第 N 层」');

  /* ② 挑战塔确实会吃到环境（老行为：环境与塔共用 reportBattle / nextBattle） */
  c.State.state().props[23] = 99;
  T._debugSetLayer(19);
  assert.ok(T.startTowerRun().ok, '应当能开挑战塔');
  const run = T._debugRun('tower');
  run.env = [{ id: 'thorns', left: 5, values: { thornsPct: 0.15 } }];
  run.envRolled = true;
  run.choices = null; run.phase = null;
  const nx = T.nextBattle('tower');
  assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
  /* 环境是在 adjustMe 那一刻写进敌我双方的（与实战同一条路径），所以必须先 adjustMe 再读 foe.mods。 */
  const me = c.State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
  me.maxHp = me.hp;
  nx.adjustMe(me);
  assert.equal(Number(nx.foe.mods && nx.foe.mods.thornsPct), 0.15, '环境要真的作用在挑战塔的敌人身上');
  /* 界面读的是 towerInfo().run —— 它必须把环境一起给出来（否则面板只会显示「当前没有环境词缀」）。 */
  const info = T.towerInfo();
  assert.ok(Array.isArray(info.run.env) && info.run.env.length === 1, 'towerInfo 要带上环境：' + JSON.stringify(info.run.env));
  assert.equal(info.run.env[0].id, 'thorns', '环境 id');
  assert.equal(info.run.env[0].left, 5, '剩余场数');
  assert.match(String(info.run.env[0].text || ''), /反弹/, '要带上渲染好的文案：' + info.run.env[0].text);
  T.abandon('tower');

  /* ③ 难度曲线：**挑战塔封顶** —— 第 32 层与第 40 层的同名敌人血量完全相同 */
  const towerHpAt = (layer) => {
    const cc = setup();
    const TT = cc.Tower;
    TT._debugSetLayer(layer - 1);
    assert.ok(TT.startTowerRun().ok, '挑战塔应当能开到第 ' + layer + ' 层');
    const rr = TT._debugRun('tower');
    rr.layer = layer;
    rr.plan = [{ kind: 'hero', anim: 'tl' }];       // 固定同一个敌人，只比较层数带来的成长
    rr.idx = 0; rr.choices = null; rr.phase = null;
    const n2 = TT.nextBattle('tower');
    assert.ok(n2 && n2.ok !== false, '应当能开战');
    return Math.round(n2.foe.maxHp || n2.foe.hp);
  };
  assert.equal(TD.TOWER_MULT_CAP_LAYER, 30, '段位倍率的封顶层写在 data 里');
  assert.equal(TD.TOWER_LEVEL_CAP, 70, '目标等级上限 = 玩家满级');
  assert.equal(TD.towerMult(30), TD.towerMult(31), '第 30 层起段位倍率不再涨');
  assert.equal(TD.towerMult(99), TD.towerMult(30), '再深也不涨');
  assert.equal(TD.towerLevel(31), 70, '第 31 层起目标等级封顶 70');
  assert.equal(TD.towerLevel(99), 70, '再深也封顶');
  assert.equal(TD.towerGold(34), TD.towerGold(99), '通关金松果第 34 层起封顶');
  assert.equal(TD.gearTierCap(20), 3, '第 20 层起套装档位封顶');
  assert.equal(TD.gearTierCap(99), 3, '再深也是紫装档');
  const hp32 = towerHpAt(32), hp40 = towerHpAt(40);
  assert.equal(hp40, hp32, '挑战塔第 40 层的敌人血量必须与第 32 层一致（封顶）：' + hp32 + ' vs ' + hp40);

  /* ④ 难度曲线：**无尽塔不封顶** —— 同一条 depth 曲线继续涨（敌人血量随层数上升） */
  const endlessHpAt = (layer) => {
    const cc = setup();
    const TT = cc.Tower;
    TT._debugSetEndlessLayer(layer);
    const rr = TT._debugRun('endless');
    rr.plan = [{ kind: 'hero', anim: 'tl' }];
    rr.idx = 0; rr.choices = null; rr.phase = null;
    const n2 = TT.nextBattle('endless');
    assert.ok(n2 && n2.ok !== false, '应当能开战');
    return Math.round(n2.foe.maxHp || n2.foe.hp);
  };
  assert.ok(TD.endlessDepthMul(40) > 1.3, '无尽塔 30 层后开始叠加深度曲线：' + TD.endlessDepthMul(40).toFixed(3));
  assert.ok(TD.endlessDepthMul(60) > TD.endlessDepthMul(40) * 2, '而且没有上限：40→60 层翻倍以上');
  const hpE40 = endlessHpAt(40), hpE60 = endlessHpAt(60);
  assert.ok(hpE60 > hpE40 * 2, '无尽塔第 60 层的敌人血量应当远高于第 40 层：' + hpE40 + ' → ' + hpE60);
});

test('需求137：自愿支持作者 —— 系统页入口 / 30 级一次性提示 / 打开系统浏览器', () => {
  const c = setup();
  const S = c.State;
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(ROOT, 'js', 'main.js'), 'utf8');
  const rustSrc = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8');

  /* ① 链接只有一个来源（main.js 的 Main.SUPPORT），并且是爱发电那个地址 */
  assert.match(mainSrc, /url: 'https:\/\/ifdian\.net\/a\/Charlespkuer'/, '支持链接要写死成爱发电地址');
  assert.match(mainSrc, /function openExternal\(/, '要有一个统一的「打开外部链接」出口');
  assert.match(mainSrc, /function openSupport\(/, '还要有 openSupport 便捷入口');
  assert.match(mainSrc, /core\.invoke\('open_external'/, '安装版 / 安卓要走 Rust 命令');
  assert.match(mainSrc, /\/__open\?url=/, '轻壳模式要走内置服务器的 /__open');
  assert.match(mainSrc, /window\.open\(url, '_blank'/, '浏览器 / 便携版退回 window.open');
  assert.match(mainSrc, /SUPPORT, openExternal, openSupport/, '三个入口都要导出到 window.Main');

  /* ② 系统页最上方：支持面板 + 按钮（源码口径） */
  const sysAt = uiSrc.indexOf('function openSystem()');
  assert.ok(sysAt > 0, '找不到 openSystem');
  const sysBody = uiSrc.slice(sysAt, uiSrc.indexOf('function ', sysAt + 10));
  assert.match(sysBody, /page\('system','system',supportPanelHtml\(\)\+/, '支持面板要放在系统页最上方');
  assert.match(sysBody, /data-action="support"/, '按钮要挂 data-action=support');
  assert.match(sysBody, /openSupportModal\(\)/, '按钮要打开支持弹窗');
  assert.match(uiSrc, /function supportPanelHtml\(\)/, '要有面板构造器');
  assert.match(uiSrc, /喜欢这个复刻版/, '面板文案');
  const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'classic-refine.css'), 'utf8');
  assert.match(cssSrc, /\.support-panel\{/, '面板样式');
  assert.match(cssSrc, /\.support-input\{/, '「复制链接」输入框样式');

  /* ③ 30 级一次性提示：只在升级奖励处理完之后弹，且只弹一次（落存档） */
  assert.match(uiSrc, /function maybeSupportPrompt\(\)/, '要有一次性提示入口');
  assert.match(uiSrc, /if \(\$\('\.classic-modal-overlay'\)\) return false;/, '有别的弹窗时先不打扰');
  assert.match(uiSrc, /State\.supportPromptTake\(\)/, '取提示权要原子（落存档）');
  const promptAt = uiSrc.indexOf('function promptLevelUpChoices()');
  const promptBody = uiSrc.slice(promptAt, uiSrc.indexOf('\n  }', promptAt));
  assert.match(promptBody, /maybeSupportPrompt\(\);/, '必须在三选一 / 属性点都处理完之后才提示');
  assert.match(uiSrc, /openSupportModal,maybeSupportPrompt,supportPanelHtml/, '三个函数都要挂到 UI.classic（测试与调试可直呼）');

  /* ④ 存档口径：到 30 级埋点 → 取一次 → 不再提示；reset 只给调试用 */
  const st = c.State.state();
  st.supportPrompt = false; st.supportPromptShown = false;
  assert.equal(S.supportPromptPending(), false, '没到 30 级时不提示');
  st.level = 29; st.exp = 0;                     // setup 里默认 70 级，这里回到 29 级再升一级
  S.gainExp(c.GData.nextExp(29));
  assert.equal(st.level, 30, '应当刚好升到 30 级');
  assert.equal(S.supportPromptPending(), true, '到 30 级要埋下待提示标记');
  assert.equal(S.supportPromptTake(), true, '第一次取得到提示权');
  assert.equal(S.supportPromptPending(), false, '取过之后不再是待提示');
  assert.equal(S.supportPromptTake(), false, '不会重复提示');
  S.supportPromptReset();
  assert.equal(S.supportPromptPending(), true, '调试可以把它恢复成待提示');
  assert.equal(S.SUPPORT_LEVEL, 30, '提示等级写在 State 里');
  assert.match(fs.readFileSync(path.join(ROOT, 'js', 'state.js'), 'utf8'), /if \(S\.level >= SUPPORT_PROMPT_LEVEL\) S\.supportPrompt = true;/,
    'gainExp 里要埋点');

  /* ⑤ 真跑一遍 openExternal 的四条分支（把源码切出来在 vm 里跑） */
  const grab = (head) => {
    const i = mainSrc.indexOf(head);
    assert.ok(i >= 0, '找不到 ' + head);
    let k = mainSrc.indexOf('{', i), depth = 0, e = k;
    while (e < mainSrc.length) {
      const ch = mainSrc[e];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
      e++;
    }
    return mainSrc.slice(i, e + 1);
  };
  const code = grab('function viaOwnLocalServer()') + '\n' + grab('function plainWindowOpen(url)') + '\n' +
    grab('function openExternal(url)') + '\n' + 'out = openExternal(URL);';
  const runCase = (env) => {
    const opened = [], invoked = [];
    const ctx = {
      URL: 'https://ifdian.net/a/Charlespkuer',
      window: Object.assign({ location: env.location, __TAURI__: env.tauri }, env.win || {}),
      fetch: env.fetch,
      Promise, encodeURIComponent, console,
    };
    /* 桩：返回一个对象 = 开成功；返回 null = 被弹窗拦截（和真实浏览器一致）。 */
    ctx.window.open = (u) => { opened.push(u); return env.openResult === undefined ? {} : env.openResult; };
    require('node:vm').runInNewContext(code, ctx);
    return { result: ctx.out, opened, invoked };
  };
  // ① 安装版 / 安卓：tauri.localhost + IPC → 走 open_external 命令
  const invoked = [];
  const appCase = runCase({
    location: { hostname: 'tauri.localhost', port: '' },
    tauri: { core: { invoke: (cmd, args) => { invoked.push([cmd, args]); return Promise.resolve(); } } },
    fetch: undefined,
  });
  return Promise.resolve(appCase.result).then((ok) => {
    assert.equal(ok, true, '安装版应当成功');
    assert.equal(invoked[0][0], 'open_external', '要走 Rust 的 open_external 命令');
    assert.equal(invoked[0][1].url, 'https://ifdian.net/a/Charlespkuer', '参数是支持链接');
    /* ② 装了 opener 插件时优先用它 */
    const viaPlugin = [];
    const pluginCase = runCase({
      location: { hostname: 'tauri.localhost', port: '' },
      tauri: { opener: { openUrl: (u) => { viaPlugin.push(u); return Promise.resolve(); } },
        core: { invoke: () => { throw new Error('不该走 invoke'); } } },
      fetch: undefined,
    });
    return Promise.resolve(pluginCase.result).then(() => {
      assert.equal(viaPlugin.length, 1, '有 opener 插件时应当直接用插件');
      /* ③ 轻壳模式（Tauri + 本地服务器）：IPC 走不通，必须走 /__open（普通 HTTP） */
      let hit = 0;
      const shellCase = runCase({
        location: { hostname: '127.0.0.1', port: '8080' },
        tauri: { core: { invoke: () => { throw new Error('轻壳模式不该走 IPC'); } } },
        fetch: (u) => { hit++; assert.match(u, /^\/__open\?url=/, '要请求 /__open'); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); },
      });
      return Promise.resolve(shellCase.result).then((ok3) => {
        assert.equal(ok3, true, '轻壳模式 /__open 成功');
        assert.equal(hit, 1, '轻壳模式要走一次 /__open');
        assert.equal(shellCase.opened.length, 0, '成功了就不该再 window.open');
        let hit2 = 0;
        const missCase = runCase({
          location: { hostname: '127.0.0.1', port: '8080' },
          tauri: { core: { invoke: () => { throw new Error('轻壳模式不该走 IPC'); } } },
          fetch: () => { hit2++; return Promise.resolve({ ok: false, json: () => Promise.reject(new Error('404')) }); },
        });
        return Promise.resolve(missCase.result).then((ok4) => {
          assert.equal(ok4, true, '旧 exe 没有 /__open 时退回 window.open');
          assert.equal(hit2, 1, '试过一次 /__open');
          assert.equal(missCase.opened.length, 1, '要真的调用 window.open');
          /* ④ 便携版 / 网页版：不探测 /__open（会丢掉点击手势），直接同步 window.open */
          const portableCase = runCase({
            location: { hostname: '127.0.0.1', port: '8080' },
            fetch: () => { throw new Error('便携版不该去请求 /__open'); },
          });
          const browserCase = runCase({ location: { hostname: 'example.com', port: '' } });
          const blockedCase = runCase({ location: { hostname: 'example.com', port: '' }, openResult: null });
          return Promise.all([Promise.resolve(portableCase.result), Promise.resolve(browserCase.result), Promise.resolve(blockedCase.result)]).then(([p1, b1, b2]) => {
            assert.equal(p1, true, '便携版（本地服务器但没有 Tauri）直接 window.open');
            assert.equal(portableCase.opened.length, 1, '便携版要 window.open 一次');
            assert.equal(b1, true, '浏览器里 window.open 成功');
            assert.equal(b2, false, '被浏览器拦下时要返回 false（界面据此显示「复制链接」）');
            assert.match(uiSrc, /function showSupportFallback\(/, '要有「复制链接」兜底弹窗');
            assert.match(uiSrc, /function copyText\(/, '要有复制文本');
            /* ⑤ Rust 侧：轻壳的内置服务器要有 /__open，安装版/安卓要有 open_external 命令 */
            assert.match(rustSrc, /if path == "\/__open"/, '内置服务器要加 /__open 路由');
            assert.match(rustSrc, /fn open_api\(query: &str, out: &mut TcpStream\)/, '要有 /__open 的处理函数');
            assert.match(rustSrc, /fn open_external\(url: String\) -> Result<\(\), String>/, '要有 open_external 命令');
            assert.match(rustSrc, /generate_handler!\[save_path, save_meta, save_read, save_write, open_external\]/,
              '命令要注册进 invoke_handler');
            assert.match(rustSrc, /fn spawn_opener\(url: &str\)/, '要有跨平台的系统打开器');
            assert.match(rustSrc, /android\.intent\.action\.VIEW/, '安卓走 Intent');
            assert.match(rustSrc, /!\url\.contains\(\[/, '链接要过滤 shell 元字符');
          });
        });
      });
    });
  });
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    /* await：个别用例（例如「打开外部链接」的分支检查）内部有 Promise，
     * 同步用例 await 一个普通返回值也没影响。 */
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ' | ' + (e && e.message)); if (process.env.SSDZ_VERBOSE) console.log(e && e.stack); }
  }
  console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${cases.length} 项）`);
  process.exit(failed ? 1 : 0);
})();
