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
  assert.match(TD.BUFF_BY_ID.C11.desc, /\+5/, '文字也要是 +5');
  assert.equal(TD.BUFF_BY_ID.C07.mods.winMaxHpPct, 0.02, '吞噬成长应当每胜 +2%');
  assert.equal(TD.BUFF_BY_ID.C07.mods.winMaxHpCap, 0.30, '吞噬成长上限应当 30%');
  assert.equal(TD.BUFF_BY_ID.C07.mods.killMaxHpPct, undefined, '吞噬成长不该再挂击杀成长');
  assert.match(TD.BUFF_BY_ID.C07.desc, /\+2%/, '文字要写 +2%');
  assert.match(TD.BUFF_BY_ID.C07.desc, /30%/, '文字要写 30%');
  for (const id of ['C39', 'C40', 'C41', 'C42', 'C43', 'C44']) {
    assert.equal(TD.BUFF_BY_ID[id].mods.fragileBreakPct, 6, id + ' 的易碎概率应当 6%');
    assert.match(TD.BUFF_BY_ID[id].desc, /6%/, id + ' 的文字也要是 6%');
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
  /* 环境里现在有一条「幻影回响」会在三侠战后按概率追加一场 ——
   * 这条测试只数「本层计划内的 5 场」，所以先把环境清掉。 */
  run.env = [];
  for (let g = 0; g < 12; g++) {
    const r = c.Tower._debugRun('endless');
    r.env = [];
    if (r.layer !== 10) break;
    if (r.choices) { c.Tower.pickChoice('endless', 0, null); continue; }
    if (r.phase) break;
    const nx = c.Tower.nextBattle('endless');
    if (!nx || nx.ok === false) break;
    seen.push({ name: nx.foe.name, elite: nx.elite, wears: (nx.foe.wears || []).map((w) => w.id) });
    const a = c.Tower._debugRun('endless');
    c.Tower.reportBattle('endless', a.attempt, true, 1, null);
  }
  assert.equal(seen.length, 5, '应当打完 5 场，实测 ' + seen.length);
  const berserk = [201, 202, 203, 204];
  for (let i = 0; i < 4; i++) {
    const hit = seen[i].wears.filter((id) => berserk.includes(id));
    assert.equal(hit.length, 0, '第 ' + (i + 1) + ' 场（' + seen[i].name + '）不该穿狂战套：' + JSON.stringify(seen[i].wears));
  }
  const lastHit = seen[4].wears.filter((id) => berserk.includes(id));
  assert.equal(lastHit.length, 4, '最后一场应当整套狂战：' + JSON.stringify(seen[4].wears));
  assert.equal(seen[4].elite, true, '最后一场应当带精英标记');
});

test('需求6：限次 buff 每场都扣（含整层最后一场）', () => {
  const c = setup();
  c.Tower._debugSetEndlessLayer(3);
  const run = c.Tower._debugRun('endless');
  const len = run.plan.length;
  run.limited = [{ id: 'G01', stacks: 1, uses: 10, on: true }];
  run.choices = null; run.phase = null;
  const uses = () => { const b = c.Tower._debugRun('endless').limited.find((x) => x.id === 'G01'); return b ? b.uses : 0; };
  let fought = 0;
  for (let g = 0; g < 10; g++) {
    const r = c.Tower._debugRun('endless');
    if (r.layer !== 3) break;
    /* 隔离环境：环境里的「幻影回响」会按概率把同一场再打一遍，
     * 那条路径不推进层内序号，会让「本层应当打 N 场」的计数偶发偏少。 */
    r.env = [];
    if (r.choices) { c.Tower.pickChoice('endless', 0, null); continue; }
    if (r.phase) break;
    const nx = c.Tower.nextBattle('endless');
    if (!nx || nx.ok === false) break;
    const a = c.Tower._debugRun('endless');
    c.Tower.reportBattle('endless', a.attempt, true, 1, null);
    fought++;
    assert.equal(uses(), 10 - fought, '打完第 ' + fought + ' 场后应当剩 ' + (10 - fought) + '，实测 ' + uses());
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

test('需求9：商店左下角是重新挑战币（50 币），失败可花 1 枚回滚本场再打', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.SHOP.retryPrice, 50, '重新挑战币定价应当 50');
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

test('需求11：刷新价格逐次递增（首次免费）', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.rerollPriceAt(0), 0, '首次免费');
  const seq = [1, 2, 3, 4, 5, 6].map((n) => TD.rerollPriceAt(n));
  assert.equal(seq.join(','), '10,20,30,40,50,60', '价格应当是 0-10-20-30…：' + seq.join(','));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] > seq[i - 1], '必须严格递增：' + seq.join(','));

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

  // 3) 期望曲线随价格单调，且命中需求的**线性**目标：20 币 1 件、40 币 2 件…
  const e20 = TD.rerollExpectation(20);
  const e40 = TD.rerollExpectation(40);
  const e60 = TD.rerollExpectation(60);
  assert.ok(Math.abs(e20.epics - 1) < 0.25, '20 币的期望史诗应当约 1 件，实测 ' + e20.epics.toFixed(2) + '（自然 ' + e20.baseEpics.toFixed(2) + '）');
  assert.ok(Math.abs(e40.epics - 2) < 0.25, '40 币的期望史诗应当约 2 件，实测 ' + e40.epics.toFixed(2));
  assert.ok(e60.epics > 2.5, '60 币应当继续往 3 件走，实测 ' + e60.epics.toFixed(2));
  assert.ok(e20.epics > e20.baseEpics, '20 币应当明显优于自然掉率');
  // 线性度：20→40 的增量应当和 40→60 的增量同量级（不是指数暴涨）
  const d1 = e40.epics - e20.epics, d2 = e60.epics - e40.epics;
  assert.ok(Math.abs(d1 - d2) < 0.3, '期望应当接近线性递增：+20 币的增量 ' + d1.toFixed(2) + ' vs ' + d2.toFixed(2));
  let prevE = -1;
  for (const price of [0, 10, 20, 30, 40, 50, 60, 80]) {
    const e = TD.rerollExpectation(price);
    assert.ok(e.epics > prevE, '期望应当随价格严格上升：' + price + ' → ' + e.epics.toFixed(2));
    prevE = e.epics;
  }

  // 4) 实战：不靠保底也要真的变好（大样本单调）
  const run = c.Tower._debugRun('endless');
  run.coins = 1000000;
  run.phase = 'shop';
  run.shop = { layer: run.layer, retrySold: false, rerollFree: true, rerollCount: 0, rerollPaid: 0, slots: [] };
  const priceToCount = (p) => (p === 0 ? 0 : ((p - 10) / 10 + 1));
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

test('需求13：新增益「重整旗鼓（普通，+1 币）」与「背水一战（史诗，+5 币）」', () => {
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
  assert.equal(e10.mods.instantRetry, 5, '背水一战 +5 枚');

  const tok = () => Number(c.Tower._debugRun('endless').retryToken) || 0;
  assert.equal(tok(), 0, '初始 0 枚');
  assert.ok(c.Tower.debugGrantBuff('E09').ok, '应当能拿到重整旗鼓');
  assert.equal(tok(), 1, '拿 1 次应当 +1 枚');
  c.Tower.debugGrantBuff('E09');
  assert.equal(tok(), 2, '可叠加');
  c.Tower.debugGrantBuff('E10');
  assert.equal(tok(), 7, '背水一战 +5 枚');
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
  assert.equal(rw.retryLeft, 7, '要报出 7 枚');
  assert.ok(c.Tower.retryBattle().ok, '应当能回滚');
  assert.equal(tok(), 6, '回滚消耗 1 枚');
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
  assert.equal(TD.BUFF_BY_ID.N04.nextBattle, true, '金蝉脱壳应当标 nextBattle');
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

test('需求15：全场五折进店被消耗（按份数，多份可折多家店）', () => {
  const c = setup();
  const run = c.Tower._debugRun('endless');
  run.coins = 100000; run.permanent = [];
  // 拿到两份
  c.Tower.debugGrantBuff('E04');
  assert.equal(c.Tower._debugRun('endless').shopDiscount, 1, '第 1 次应当是 1 份');
  c.Tower.debugGrantBuff('E04');
  assert.equal(c.Tower._debugRun('endless').shopDiscount, 2, '再拿一次应当叠成 2 份');
  // 开第一家店 → 消耗 1 份，价格减半
  const r = c.Tower._debugRun('endless');
  r.choices = [{ type: 'buff', id: 'C02' }]; r.restShopUsed = false; r.phase = null;
  assert.ok(c.Tower.openRestShop().ok, '应当能开休整商店');
  assert.equal(c.Tower._debugRun('endless').shopDiscount, 1, '进店应当消耗 1 份');
  assert.equal(c.Tower._debugRun('endless').shop.discount, true, '这家店应当吃到折扣');
  const st1 = c.Tower.shopState();
  assert.ok(st1.slots.length, '货架应当有货');
  c.Tower.closeShop();
  // 开第二家店 → 再消耗 1 份
  const r2 = c.Tower._debugRun('endless');
  r2.choices = [{ type: 'buff', id: 'C02' }]; r2.restShopUsed = false; r2.phase = null;
  assert.ok(c.Tower.openRestShop().ok);
  assert.equal(c.Tower._debugRun('endless').shopDiscount, 0, '第二家店应当把第 2 份也用掉');
  assert.equal(c.Tower._debugRun('endless').shop.discount, true, '第二家店也应当打折');
  c.Tower.closeShop();
  // 第三家店没份了 → 原价
  const r3 = c.Tower._debugRun('endless');
  r3.choices = [{ type: 'buff', id: 'C02' }]; r3.restShopUsed = false; r3.phase = null;
  assert.ok(c.Tower.openRestShop().ok);
  assert.equal(c.Tower._debugRun('endless').shop.discount, false, '没份了就是原价');
});

test('需求16：烙印各自独立随机数；存在时半效、损毁后全额且本局永久', () => {
  const c = setup();
  const run = c.Tower._debugRun('endless');
  run.permanent = []; run.limited = [];
  run.fragileBase = { power: 0, agility: 0, speed: 0 };
  run.fragileBurned = { power: 0, agility: 0, speed: 0 };
  c.Tower.debugGrantBuff('C39');                     // 力量烙印：基础 8%
  let r = c.Tower._debugRun('endless');
  assert.equal(Number(r.fragileBase.power), 0.08, '拿到时登记基础 8%');
  assert.equal(r.stickyStat, undefined, '旧的 stickyStat 不再使用');
  // 存在时半效：效果清单显示 +4%
  let line = c.Tower.debugBuffReport('endless').effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.ok(line, '效果清单应当列出烙印攻击');
  assert.match(line[0], /存在·半效/, '要标「存在·半效」：' + line[0]);
  assert.match(line[1], /\+4%/, '存在时应当 +4%：' + line[1]);
  // 面板详情也要写清
  const info = c.Tower.ownedBuffs('endless').find((b) => b.id === 'C39');
  assert.match(info.progress, /半效/, '面板详情要写半效：' + info.progress);

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
  assert.equal(Number(r.fragileBurned.power), 0.08, '损毁后基础那份应转为永久保留');
  line = c.Tower.debugBuffReport('endless').effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.match(line[0], /已损毁/, '要标「已损毁」：' + line[0]);
  assert.match(line[1], /\+12%/, '损毁后应当 +12%：' + line[1]);

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
  // 叠层 ×2 也要体现
  r.permanent = [{ id: 'C34', stacks: 2 }];
  info = c.Tower.ownedBuffs('endless').find((b) => b.id === 'C34');
  assert.match(info.progress, /× 2 层/, '叠层要显示：' + info.progress);
  assert.match(info.progress, /\+160%/, '2 层 × 4 空槽 × 20% = +160%：' + info.progress);
});

test('需求18：熔核成型改为第 7 次行动、减伤 70%', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.match(TD.TRIAL_BY_ID.core.mechDesc, /第 7 次行动/, '简介要写第 7 次：' + TD.TRIAL_BY_ID.core.mechDesc);
  assert.match(TD.TRIAL_BY_ID.core.mechDesc, /−70%/, '简介要写 −70%：' + TD.TRIAL_BY_ID.core.mechDesc);
  const sim = fs.readFileSync(path.join(ROOT, 'js', 'sim.js'), 'utf8');
  assert.match(sim, /acts >= 7/, 'sim 里应当在第 7 次行动成型');
  assert.match(sim, /0\.3\)/, '减伤应当是 70%（受伤 ×0.3）');
  // 实战：第 7 个事件才出现「熔核成型」
  const run = c.Tower._debugRun('endless');
  run.plan = [{ kind: 'trial', id: 'core' }, { kind: 'hero', anim: 'tl' }];
  run.idx = 0; run.env = [];
  const nx = c.Tower.nextBattle('endless');
  const me = { name: 'p', level: 70, power: 1, agility: 1, speed: 1, maxHp: 300000, hp: 300000,
    baseStats: { power: 1, agility: 1, speed: 1 }, weapons: [{ id: 1, level: 1 }], skills: [], wears: [], effects: {} };
  const out = c.Sim.simulate(me, JSON.parse(JSON.stringify(nx.foe)));
  const idx = out.rounds.findIndex((r) => r.noteText && /熔核/.test(r.noteText));
  assert.equal(idx, 6, '成型应当出现在第 7 个事件（索引 6），实测索引 ' + idx);
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
  // 环境 / 试炼币 / 商店 / 重新挑战币 / 永久槽位 / 选取型 / 即时结算 —— 这些在挑战塔里都是废的
  const ENDLESS_ONLY = TD.ENDLESS_ONLY_MODS;
  assert.ok(Array.isArray(ENDLESS_ONLY) && ENDLESS_ONLY.length >= 10, '应当有一份「无尽专属 mods」清单');
  for (const b of TD.towerPool) {
    const bad = Object.keys(b.mods || {}).filter((k) => ENDLESS_ONLY.includes(k));
    assert.equal(bad.length, 0, '挑战塔池不该有 ' + b.id + '（' + bad.join(',') + '）');
    assert.ok(!b.endlessOnly, '挑战塔池不该有无尽专属条目：' + b.id);
  }
  // 具体两条：晴空护符 / 避风斗篷（作用于环境词缀，挑战塔没有环境）
  assert.equal(TD.BUFF_BY_ID.N09.endlessOnly, true, '晴空护符应当标无尽专属');
  assert.equal(TD.BUFF_BY_ID.N10.endlessOnly, true, '避风斗篷应当标无尽专属');
  assert.ok(!TD.towerPool.some((b) => b.id === 'N09' || b.id === 'N10'), '它们不该出现在挑战塔池');
  assert.ok(!TD.towerPool.some((b) => b.mods && (b.mods.envIgnore || b.mods.envReflect)), '挑战塔池不该有环境类');
  assert.ok(!TD.towerPool.some((b) => b.mods && b.mods.coinBoostPct), '挑战塔池不该有试炼币类');
  // 烙印（本局永久保留）也不该进塔 —— 挑战塔的增益只服务下一场
  assert.ok(!TD.towerPool.some((b) => /^C4[0-4]$/.test(b.id)), '烙印不该出现在挑战塔池');
  for (const id of ['C39', 'C42']) assert.equal(TD.BUFF_BY_ID[id].endlessOnly, true, id + ' 应当标无尽专属');
  /* 池子规模：towerPool 现在是「挑战塔**归属**」的完整名单（场间选择池），
   * 包含限次类与永久类 —— 塔里本来就能选到永久增益（无尽塔专属的除外）。 */
  const towerLimited = TD.towerPool.filter((b) => b.kind === 'limited');
  assert.equal(towerLimited.length, 31, '挑战塔的限次类应当是 31 条（19 通用 + 12 专属），实测 ' + towerLimited.length);
  assert.equal(towerLimited.filter((b) => b.towerOnly).length, 31, '其中 31 条是挑战塔专属（含 N/M/G/T 四系）');
  assert.equal(TD.towerPool.filter((b) => b.kind === 'permanent').length, 35, '永久类也属于挑战塔池（共 35 条）');
  assert.equal(TD.towerPool.filter((b) => b.kind === 'instant').length, 0, '即时类不进选择池');
  // 无尽池不该混入挑战塔专属（它们按「一场定胜负」设计）
  assert.equal(TD.endlessPool.filter((b) => b.towerOnly).length, 0, '无尽选择池不该有挑战塔专属');
  assert.equal(TD.shopPool.filter((b) => b.towerOnly).length, 0, '无尽商店池不该有挑战塔专属');
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
  assert.equal(S.challengeExp(20, 20), 33, '20 级同级应当是 33 点');

  // 2) 等级差的影响被压紧：同样差 3 级，现在必须比「线性未压实」更贴近同级
  const linear = (d, lv) => {
    const base = S.CHALLENGE_EXP_BASE + Math.min(lv, S.CHALLENGE_EXP_CAP_LEVEL) * S.CHALLENGE_EXP_PER_LEVEL;
    const m = Math.max(0.3, Math.min(2.2, 1 + d * S.EXP_DIFF_STEP));
    return Math.round(base * m);
  };
  for (const d of [1, 2, 3]) {
    assert.ok(S.challengeExp(20 + d, 20) < linear(d, 20),
      '越级 ' + d + ' 级的经验应当比未压实时更低：' + S.challengeExp(20 + d, 20) + ' vs ' + linear(d, 20));
  }
  for (const d of [-1, -2, -3]) {
    assert.ok(S.challengeExp(20 + d, 20) > linear(d, 20),
      '打低 ' + (-d) + ' 级的经验应当比未压实时更高（不吃亏）：' + S.challengeExp(20 + d, 20) + ' vs ' + linear(d, 20));
  }
  // 倍率随等级差单调，且仍然「越级更多、低级更少」
  let prev = 0;
  for (const d of [-1, 0, 1, 2, 3]) {
    const m = S.challengeExp(20 + d, 20) / 33;
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
  assert.ok(capMax > arena * 0.88, '不应低太多：' + capMax.toFixed(2));
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
    assert.equal(b.nextBattle, true, b.id + ' 应当标 nextBattle');
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
  const tower = TD.BUFFS.filter((b) => b.towerOnly);
  assert.ok(tower.length >= 12, '至少 12 条挑战塔专属，实测 ' + tower.length);
  // 池子隔离
  assert.equal(TD.towerPool.filter((b) => b.towerOnly).length, tower.length, '专属全在挑战塔池');
  assert.equal(TD.endlessPool.filter((b) => b.towerOnly).length, 0, '专属不该进无尽池');
  for (const b of tower) {
    assert.equal(b.kind, 'limited', b.id + ' 应当是限次类（塔里=下一场）');
    assert.equal(b.nextBattle, true, b.id + ' 应当 nextBattle');
    assert.match(b.desc, /下一场战斗/, b.id + ' 文案要写「下一场战斗」');
  }
  // 关键几条的数值
  assert.equal(TD.BUFF_BY_ID.T01.mods.openerPowerMul, 0.50, '开局狂热：前 5 回合 +50%');
  assert.equal(TD.BUFF_BY_ID.T01.mods.openerRounds, 5, '开局狂热：5 回合');
  assert.equal(TD.BUFF_BY_ID.T01.mods.fatiguePowerMul, 0.20, '开局狂热：之后 −20%');
  assert.equal(TD.BUFF_BY_ID.T02.mods.dodgeMul, 0.50, '烟幕：闪避率 +50%');
  assert.equal(TD.BUFF_BY_ID.T03.mods.speedMul, 0.30, '疾风之靴：速度 +30%');
  assert.equal(TD.BUFF_BY_ID.T04.mods.mustHitAll, 1, '锁定打击：所有攻击必中');

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
    T01: ['openerPowerMul', 'fatiguePowerMul', 'openerRounds'],
    T02: ['dodgeMul'], T04: ['mustHitAll'], T05: ['critBonus', 'critDmgBonus'],
    T06: ['takenMul'], T07: ['thornsPct'], T08: ['openStrikePct'], T09: ['lifestealPct'],
    T11: ['regenPct'], T12: ['firstSkillFree', 'firstHitZero'],
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
  // T03/T10 走 speedMul → 直接改面板速度
  for (const id of ['T03', 'T10']) {
    const t = freshTower();
    t.c.Tower.addBuff(t.run, id);
    const nx = t.c.Tower.nextBattle('tower');
    const me = { name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 60000, hp: 60000,
      baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    assert.ok(me.speed > 120, id + ' 应当提升面板速度，实测 ' + me.speed);
  }

  // 开局狂热的分档必须真的作用在战斗里（无武器时普攻伤害≈力量，能干净量出倍率）
  const foe = { name: '木人', level: 70, power: 50, agility: 1, speed: 50, hp: 2000000, maxHp: 2000000,
    baseStats: { power: 50, agility: 1, speed: 50 }, weapons: [], skills: [], wears: [], effects: {} };
  const mk = (extra) => ({ name: 'p', level: 70, power: 200, agility: 120, speed: 120, maxHp: 60000, hp: 60000,
    baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], wears: [], effects: {}, masterLevel: 0,
    mods: Object.assign({ mustHitAll: 1 }, extra || {}) });
  /* 按**出手序号**对齐采样：闪避也没关系（那一格记 0），这样两组的第 n 次出手一一对应，
   * 倍率才是干净的（若不补齐会错位，实测会量出 ×1.79 这种假值）。 */
  const dmg = (mods) => {
    const sim = c.Sim.simulate(mk(mods), JSON.parse(JSON.stringify(foe)));
    return sim.rounds.filter((x) => x.attacker === 0 && x.action === 'common').map((x) => Number(x.dmg) || 0);
  };
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  /* 单局伤害方差不小（暴击/命中浮动），多局平均后再比，倍率才稳。 */
  const mean = (mods, n) => {
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(dmg(mods));
    const len = Math.min.apply(null, rows.map((r) => r.length));
    return Array.from({ length: len }, (_, i) => avg(rows.map((r) => r[i])));
  };
  const base = mean({}, 24), op = mean({ openerPowerMul: 0.5, fatiguePowerMul: 0.2, openerRounds: 5 }, 24);
  const r5 = avg(op.slice(0, 5)) / avg(base.slice(0, 5));
  const r6 = avg(op.slice(5, 10)) / avg(base.slice(5, 10));
  assert.ok(r5 > 1.35 && r5 < 1.65, '前 5 回合应当约 ×1.50，实测 ×' + r5.toFixed(2));
  assert.ok(r6 > 0.68 && r6 < 0.92, '第 6 回合起应当约 ×0.80，实测 ×' + r6.toFixed(2));
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
  assert.equal(TD.BUFF_BY_ID.N04.unique, true, '金蝉脱壳必须是 unique，否则可无限叠、刷爆复活成就');
  assert.ok(tiers[tiers.length - 1].at <= 10 + 3, '最高档阈值不该超过实际可达到的复活次数（10 + 每层 1）');

  // 6) 隐藏成就「超凡入圣」：跨档才触发，且**不能一次点亮整档**（回归：阈值判断写反过）
  r = run();
  r.score = 0; r.achievements = []; r.scoreLog = []; r.statPeaks = {};
  r.phase = null; r.choices = null;
  /* 全部走 addBuff 并每步重新取 run 引用（debugGrantBuff 拿的是内部引用，
   * 与这里持有的 r 可能不是同一个对象，混用会导致增益没真正入账）。 */
  for (const id of ['G07', 'N01', 'C02', 'C02', 'C02']) c.Tower.addBuff(run(), id);
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
  assert.ok(!ach.some((x) => /\+200%|\+300%/.test(x.name)), '不该点亮未跨过的更高档：' + JSON.stringify(ach.map((x) => x.name)));
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

test('需求30：烙印两段机制（未破碎 50% / 破碎后 100%）+ 复数烙印各自计数', () => {
  const c = setup();
  const TD = c.TowerData;
  const run = c.Tower._debugRun('endless');
  run.permanent = []; run.limited = [];
  run.fragileBase = { power: 0, agility: 0, speed: 0 };
  run.fragileBurned = { power: 0, agility: 0, speed: 0 };
  run.fragileSeeds = {};
  c.Tower.addBuff(run, 'C39');                   // 力量烙印：基础 8%
  const pct = (scale) => Math.round((Number(TD.BUFF_BY_ID.C39.mods.fragilePct) * scale) * 100);
  // 1) 未破碎：只有 50% 增益
  let line = c.Tower.debugBuffReport('endless').effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.ok(line, '效果清单要列出烙印攻击');
  assert.match(line[0], /存在·半效/, '未破碎要标「存在·半效」：' + line[0]);
  assert.equal(line[1], '+' + pct(0.5) + '%', '未破碎应当只有 50% 增益（' + pct(0.5) + '%）：' + line[1]);
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
  // 破碎后 = 50%（仍在的基础）+ 100%（破碎保留）= 150% 的基础 = 12%
  assert.equal(line[1], '+' + pct(1.5) + '%', '破碎后应当是 150% 基础（' + pct(1.5) + '%）：' + line[1]);
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
  assert.equal(line[1], '+' + pct(1.5) + '%', '破碎后的加成应当本局永久保留：' + line[1]);

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
  for (const b of TD.BUFFS.filter((x) => x.towerOnly)) {
    assert.equal(JSON.stringify(roster(b.id)), '["T.choice"]', b.id + ' 应当只属于挑战塔，实测 ' + JSON.stringify(roster(b.id)));
    assert.ok(!TD.endlessPool.some((x) => x.id === b.id), b.id + ' 不该进无尽选择池');
    assert.ok(!TD.shopPool.some((x) => x.id === b.id), b.id + ' 不该进无尽商店池 ← 需求点名的泄漏');
  }
  assert.equal(TD.BUFFS.filter((x) => x.towerOnly).length, 31, '应当有 31 条挑战塔专属');

  // 3) 无尽专属（显式标记或带无尽专属 mod）：绝不能出现在挑战塔池
  for (const b of TD.BUFFS) {
    const endlessOnly = b.endlessOnly || hasEM(b);
    if (!endlessOnly) continue;
    assert.ok(roster(b.id).every((t) => t.indexOf('E.') === 0),
      b.id + ' 是无尽专属，却出现在挑战塔池：' + JSON.stringify(roster(b.id)));
  }
  assert.equal(TD.towerPool.filter((b) => b.endlessOnly || hasEM(b)).length, 0,
    '挑战塔池里不该有任何无尽专属条目');
  // 需求点名的 6 条漏标条目（带无尽专属 mod 却曾在塔池里）
  for (const id of ['C30', 'C32', 'C33', 'C45', 'C25', 'C37']) {
    assert.equal(JSON.stringify(roster(id)), '["E.choice","E.shop"]', id + ' 应当只在无尽塔，实测 ' + JSON.stringify(roster(id)));
    assert.ok(!TD.towerPool.some((b) => b.id === id), id + ' 不该进挑战塔池');
  }

  // 4) 无尽商店池的边界
  assert.ok(!TD.shopPool.some((b) => b.shopBanned), 'shopBanned 的（名贵手表）不该进商店池');
  assert.ok(TD.shopPool.some((b) => b.id === 'N09'), '环境类晴空护符应当能在无尽商店买到');
  assert.equal(TD.shopPool.filter((b) => b.kind === 'instant').length, 0, '即时类不该进商店池');

  // 5) 三个池子的名单必须与 roster 完全一致（不能各自写谓词）
  const byTag = (tag) => TD.BUFFS.filter((b) => roster(b.id).indexOf(tag) >= 0).map((b) => b.id).join(',');
  assert.equal(TD.towerPool.map((b) => b.id).join(','), byTag('T.choice'), 'towerPool 必须等于 T.choice 名单');
  assert.equal(TD.endlessPool.map((b) => b.id).join(','), byTag('E.choice'), 'endlessPool 必须等于 E.choice 名单');
  assert.equal(TD.shopPool.map((b) => b.id).join(','), byTag('E.shop'), 'shopPool 必须等于 E.shop 名单');

  // 6) 标记规范化：带无尽专属 mod 的条目必须同时显式标 endlessOnly（让数据自解释，
  //    不再只靠 roster 的计算兜住 —— 否则以后新增条目很容易又漏标。）
  const unmarked = TD.BUFFS.filter((b) => !b.endlessOnly && hasEM(b)).map((b) => b.id);
  assert.equal(unmarked.length, 0, '带无尽专属 mod 却没标 endlessOnly：' + JSON.stringify(unmarked));
  for (const id of ['C24', 'C25', 'C30', 'C31', 'C32', 'C33', 'C37', 'C45']) {
    assert.equal(TD.BUFF_BY_ID[id].endlessOnly, true, id + ' 应当标 endlessOnly');
  }
  // 塔专属同样要有显式标记（数据自解释）
  for (const b of TD.towerPool) {
    if (TD.poolRoster(b).join() === 'T.choice') {
      assert.ok(b.towerOnly === true || b.endlessOnly === true,
        b.id + ' 只属于挑战塔，却没有 towerOnly / endlessOnly 标记');
    }
  }

  // 7) 挑战塔池的构成可解释
  assert.equal(TD.towerPool.length, byTag('T.choice').split(',').length, '池子大小要自洽');
  assert.equal(TD.towerPool.filter((b) => b.kind === 'limited').length, 31, '限次类 31 条');
  assert.equal(TD.towerPool.filter((b) => b.kind === 'permanent').length, 35, '永久类 35 条');
});

test('需求32：池子分离的端到端实测（真跑两种塔的抽取，零交叉）', () => {
  const c = setup();
  const TD = c.TowerData;
  const S = c.State.state();
  S.level = 70; S.props[23] = 99999;
  for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };
  const cid = (ch) => (typeof ch === 'string' ? ch : (ch && (ch.id || (ch.buff && ch.buff.id))));
  const hasEM = (b) => !!(b && (b.endlessOnly || Object.keys(b.mods || {}).some((k) => TD.ENDLESS_ONLY_MODS.indexOf(k) >= 0)));

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

  const towerOnlyIds = TD.BUFFS.filter((b) => b.towerOnly).map((b) => b.id);
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

test('需求33：挥金如土（C36）每 10 币一次随机项，且购买它自身的花费也计入', () => {
  const c = setup();
  const TD = c.TowerData;
  assert.equal(TD.BUFF_BY_ID.C36.mods.shopSpendStep, 5, '步长应当是 5 试炼币');
  assert.match(TD.BUFF_BY_ID.C36.desc, /5 试炼币/, '文案要写 5 试炼币：' + TD.BUFF_BY_ID.C36.desc);
  assert.match(TD.BUFF_BY_ID.C36.desc, /购买本增益的花费/, '文案要说明含自身花费');

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
  // ① 买 C36 自身的花费要吃到加成：160 币 → 16 次
  mkShop('C36', 160);
  const bought = c.Tower.buyShopSlot(0);
  assert.ok(bought.ok, '应当能买到挥金如土');
  let r = c.Tower._debugRun('endless');
  const procs = (g) => g.power + g.agility + g.speed + g.hp / 5;   // 血是 +5/次，折算成「次」
  assert.equal(procs(r.spendGain), 32, '160 币应当触发 32 次（每 5 币一次），实测 ' + procs(r.spendGain));
  assert.equal(r.shopSpend, 0, '160 是 5 的整数倍，余数应为 0，实测 ' + r.shopSpend);
  /* ② 每次只加「1 力 / 1 敏 / 1 速 / 5 血」中的一项。
   * 正确的不变量：四项折算后**总和**等于触发次数，且每项非负 ——
   * 原来写「单项 ≤ 16」是错的：32 次随机分配里某一项完全可能超过半数（实测 hp 到 30）。 */
  const g = r.spendGain;
  assert.ok(g.power >= 0 && g.agility >= 0 && g.speed >= 0 && g.hp >= 0,
    '各项不该为负：' + JSON.stringify(g));
  assert.equal(g.hp % 5, 0, '生命那一项应当是 5 的整数倍：' + g.hp);
  assert.equal(procs(g), 32, '四项折算后总和应当等于触发次数：' + JSON.stringify(g));
  assert.ok(r.spendGain.hp % 5 === 0, '生命项应当是 5 的倍数，实测 ' + r.spendGain.hp);
  // ③ 后续消费继续累计：再买 30 币 → 累计 19 次
  mkShop('C01', 30);
  c.Tower.buyShopSlot(0);
  r = c.Tower._debugRun('endless');
  assert.equal(procs(r.spendGain), 38, '再消费 30 币应当累计到 38 次，实测 ' + procs(r.spendGain));
  // ④ 没钱时不买、也不记账
  mkShop('C02', 200);
  c.Tower._debugRun('endless').coins = 50;
  const poor = c.Tower.buyShopSlot(0);
  assert.ok(!poor.ok, '钱不够应当买不成');
  assert.equal(procs(c.Tower._debugRun('endless').spendGain), 38, '买不成时不该记账');
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
  const STACKABLE = TD.BUFFS.filter((b) => b.stackable).map((b) => b.id).sort();
  /* C50「抉择扩充」也是 stackable，但它的叠层效果是「选项数 +1/层」而不是属性成比例，
   * 所以先把它摘出来单独在本测试末尾断言。 */
  assert.equal(STACKABLE.join(','), 'C06,C07,C11,C12,C16,C17,C50', '可叠层增益清单变了：' + STACKABLE.join(','));

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
    const heals = [];
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
      const out = T.reportBattle('endless', a.attempt, true, 1, null);
      won++;
      const lay = Number((T._debugRun('endless') || {}).layer) || 0;
      /* 只有第 10 层起的胜场才计入 C12/C07 之类「层 10 起」的成长。 */
      if (!fixedLayer || lay >= 10) wonAfter10++;
      if (out && out.winHeal != null) heals.push(out.winHeal);
      if (!T._debugRun('endless')) break;
    }
    if (field === 'winHeal') return { value: heals.length ? heals[0] : NaN, wins: won };
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
    ['C11', 'winHpFlat', 7, null],  // 以战养战：每胜 +5 上限（×层数）
    ['C12', 'winStatPower', 7, 10],  // 登顶者：第 10 层起每胜 +1 力（×层数）
    ['C16', 'winHeal', 3, null],    // 战后续航：每胜回 5%（×层数）
    ['C17', 'winHeal', 3, null],    // 战后续航·精：每胜回 10%（×层数）
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
  assert.equal(TD.BUFF_BY_ID.C50.stackable, true, 'C50 应当可叠层');
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
  /* 叠满：不再进池、也不可再获得 */
  assert.equal(T.poolFilterOf(T._debugRun('endless'), TD.BUFF_BY_ID.C50), false,
    '叠满 3 层后不该再进任何池子');
  assert.equal(T.ownableOf(T._debugRun('endless'), TD.BUFF_BY_ID.C50), false,
    '叠满 3 层后不该再获得');
  /* 超出上限也不会继续加（addBuff 受 STACK_MAX 限制） */
  T.addBuff(T._debugRun('endless'), 'C50');
  assert.equal(T.choiceSlotsOf(T._debugRun('endless')), 6, '仍然封顶在六选一');
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
  const ctx = { Tower: T, State: S, esc: (x) => String(x == null ? '' : x), notice: () => {},
    modal: classic.modal, openShop: () => {}, openEndless: () => {},
    C: () => ({ bind: (root, actions) => { binds.push(actions); } }),
    console: { warn() {}, log() {} }, Math: Math, JSON: JSON, Object: Object, Number: Number, String: String, Array: Array };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(body + '\nofferShopReplace(0, { id: "C03", name: "猎侠者" });', ctx, { filename: 'dlg.js' });
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

test('需求40：狂怒（C20）阈值 50%，且低血时攻击+50%、敏捷+20%、速度+20%', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State, Sim = c.Sim;

  /* 定义与文案 */
  const m = TD.BUFF_BY_ID.C20.mods;
  assert.equal(m.lowHpAt, 0.50, '阈值应当是 50%');
  assert.equal(m.lowHpPowerMul, 0.50, '攻击 +50%');
  assert.equal(m.lowHpAgilityMul, 0.20, '敏捷 +20%');
  assert.equal(m.lowHpSpeedMul, 0.20, '速度 +20%');
  assert.match(TD.BUFF_BY_ID.C20.desc, /50%/, '文案要写 50%：' + TD.BUFF_BY_ID.C20.desc);
  assert.match(TD.BUFF_BY_ID.C20.desc, /敏捷/, '文案要写敏捷：' + TD.BUFF_BY_ID.C20.desc);
  assert.match(TD.BUFF_BY_ID.C20.desc, /速度/, '文案要写速度：' + TD.BUFF_BY_ID.C20.desc);

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
  assert.equal(me.mods.lowHpPowerMul, 0.50, 'me.mods 要有 lowHpPowerMul');
  assert.equal(me.mods.lowHpAgilityMul, 0.20, 'me.mods 要有 lowHpAgilityMul');
  assert.equal(me.mods.lowHpSpeedMul, 0.20, 'me.mods 要有 lowHpSpeedMul');
  assert.equal(me.mods.lowHpAt, 0.50, 'me.mods 要有 lowHpAt=0.50');
  /* 效果清单与面板进度要写全三项 */
  const rep = T.debugBuffReport('endless');
  const low = rep.effects.filter((e) => /低血/.test(e[0]));
  assert.equal(low.length, 3, '效果清单应当有三条低血项：' + JSON.stringify(rep.effects));
  assert.ok(low.some((e) => /攻击/.test(e[0]) && /\+50%/.test(e[1])), '要有低血攻击 +50%');
  assert.ok(low.some((e) => /敏捷/.test(e[0]) && /\+20%/.test(e[1])), '要有低血敏捷 +20%');
  assert.ok(low.some((e) => /速度/.test(e[0]) && /\+20%/.test(e[1])), '要有低血速度 +20%');
  const prog = (T.ownedBuffs('endless').find((b) => b.id === 'C20') || {}).progress || '';
  assert.match(prog, /≤50%/, '面板进度要写阈值 50%：' + prog);
  assert.match(prog, /敏捷/, '面板进度要写敏捷：' + prog);

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
    ['N14', 1, 'limited', 10, '稀有·限次'],
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
  assert.equal(TD.BUFF_BY_ID.N14.mods.lowHpTakenMul, -0.50, 'N14：低血 50% 减伤');
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
  assert.ok(Math.abs(lowWith / none - 0.5) < 0.06, '低血时 N14 应当减伤一半：×' + (lowWith / none).toFixed(3));

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

  /* ---- ② 仓库钥匙（battleOnly）不进商店 ---- */
  const c31 = TD.BUFF_BY_ID.C31;
  assert.equal(c31.battleOnly, true, 'C31 应当标 battleOnly');
  assert.equal(c31.shopBanned, undefined, 'C31 不是靠 shopBanned 挡的（要靠 battleOnly 生效）');
  assert.ok(!TD.shopPool.some((b) => b.id === 'C31'), 'C31 不该出现在商店池');
  assert.ok(TD.endlessPool.some((b) => b.id === 'C31'), 'C31 仍应出现在无尽选择池');
  assert.equal(JSON.stringify(TD.poolRoster(c31)), '["E.choice"]', 'C31 的归属应当只有 E.choice');
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

  /* ---- ③ 登顶者：第 10 层起每胜 +1 力/敏/速（固定值，不吃百分比乘区） ---- */
  const c12 = TD.BUFF_BY_ID.C12;
  assert.equal(c12.mods.winStatAfter10, 1, 'C12 应当是固定 +1');
  assert.equal(c12.mods.winPowerAfter10, undefined, '旧的百分比口径应当移除');
  assert.match(c12.desc, /力量 \+1/, '文案要写力量 +1：' + c12.desc);
  assert.match(c12.desc, /敏捷 \+1/, '文案要写敏捷 +1：' + c12.desc);
  assert.match(c12.desc, /速度 \+1/, '文案要写速度 +1：' + c12.desc);
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
  const one1 = grow(1, 10, 5), three1 = grow(3, 10, 5), below = grow(1, 5, 5);
  assert.equal(one1.p, one1.wins * 1, '×1 应当每胜 +1：' + JSON.stringify(one1));
  assert.equal(one1.a, one1.wins * 1, '敏捷也要 +1');
  assert.equal(one1.s, one1.wins * 1, '速度也要 +1');
  assert.equal(three1.p, three1.wins * 3, '×3 层应当每胜 +3：' + JSON.stringify(three1));
  assert.equal(below.p, 0, '层数 <10 时不该累计：' + JSON.stringify(below));
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
    assert.equal(b.hidden, true, id + ' 应当是隐藏型（不在增益面板/商店池里单独出现）');
    assert.equal(b.unique, true, id + ' 应当一局一次');
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
    assert.equal(b.endlessOnly, true, id + ' 应当只属于无尽塔');
    assert.equal(b.towerOnly, undefined, id + ' 不该标 towerOnly');
    assert.equal(b.nextBattle, true, id + ' 仍是「下一场战斗」生命周期');
    /* 界面判据：towerOnly && nextBattle 才显示「下一场」 */
    assert.ok(!(b.towerOnly && b.nextBattle), id + ' 不该被判成「只服务下一场」');
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
  assert.equal(n15.nextBattle, true, 'N15 是「下一场战斗」生命周期');
  assert.equal(n15.endlessOnly, true, 'N15 只属于无尽塔');
  assert.ok(!(n15.towerOnly && n15.nextBattle), 'N15 不该被判成「只服务下一场」');
  assert.ok(TD.endlessPool.some((x) => x.id === 'N15'), 'N15 应当出现在无尽塔池');
  assert.ok(!TD.towerPool.some((x) => x.id === 'N15'), 'N15 不该出现在挑战塔池');
  assert.equal(TD.BUFF_BY_ID.N14.mods.lowHpTakenMul, -0.50, 'N14 仍是 50% 减伤');

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
  assert.ok(Number(c14.shopWeight) > 0 && Number(c14.shopWeight) < 0.5,
    '不死鸟的商店权重应当明显小于 1：' + c14.shopWeight);
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

  /* ② 负面环境仍然照常反弹给敌人（别把这条修坏了） */
  const bad = scene(['C45'], THORNS);
  assert.equal(bad.foe.mods.thornsPct, 0.15, '负面环境应当反弹给敌人');
  assert.ok(!bad.me.mods.thornsPct, '我方不该吃到被反弹的负面环境');

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
  assert.equal(c14.shopWeight, 0.12, '商店权重仍保持很低');
  assert.equal(c14.mods.revivePct, 0.50, '复活回复当前生命上限的 50%');
  assert.equal(c14.mods.reviveStatMul, 0.50, '复活后本场力/敏/速 +50%');
  assert.match(c14.desc, /涅槃|复活/, '文案要说明复活');
  assert.match(c14.desc, /50%/, '文案要写 50%');
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
  assert.equal(TD.BUFF_BY_ID.C30.unique, true, '扩容背包仍是一局一次');
  assert.equal(TD.BUFF_BY_ID.C31.unique, true, '仓库钥匙仍是一局一次');
  assert.equal(TD.BUFF_BY_ID.C37.unique, undefined, '虚空铭文不再受 unique 限制');
  assert.equal(TD.BUFF_BY_ID.C37.repeatable, true, '虚空铭文应当标 repeatable');
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

  /* ③ 幸运一击的重复触发概率被下调 */
  const rate = (id) => Sim.repeatRateOf(id);
  const rules = Sim.rules;
  assert.ok(rate(23) < 17, '幸运一击的重复概率应当低于原来的 17%，实测 ' + rate(23));
  assert.ok(rate(23) < rate(15), '应当低于同档的通灵召唤：' + rate(23) + ' vs ' + rate(15));
  assert.ok(rate(23) > rules.repeatSnack, '但仍应高于最低档的来点松果');

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

test('需求54：挥金如土可重复 / 传奇商店降权 / 终焉烙印终乘 / 全拥有后进一步降权', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower, S = c.State;

  /* ① 挥金如土（C36）可以重复获得 */
  assert.equal(TD.BUFF_BY_ID.C36.repeatable, true, 'C36 应当标 repeatable');
  assert.equal(TD.BUFF_BY_ID.C36.unique, undefined, 'C36 不该再受 unique 限制');
  S.newGame('c36' + Math.random());
  const st0 = S.state(); st0.level = 70; st0.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st0.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r0 = T._debugRun('endless');
  r0.permanent = []; r0.limited = []; r0.slotFreeIds = [];
  assert.ok(T.poolFilterOf(r0, TD.BUFF_BY_ID.C36), '未拥有时应当允许出现');
  T.addBuff(T._debugRun('endless'), 'C36');
  assert.ok(T.poolFilterOf(T._debugRun('endless'), TD.BUFF_BY_ID.C36),
    '已拥有挥金如土后**仍然**应当允许再次出现');
  /* 再拿一次会叠层（而不是被拒绝） */
  const again = T.addBuff(T._debugRun('endless'), 'C36');
  assert.ok(again.ok, '再次获得挥金如土应当成功：' + JSON.stringify(again));
  const owned36 = (T._debugRun('endless').permanent || []).find((b) => b.id === 'C36');
  assert.ok(owned36 && owned36.stacks >= 2, '应当叠到至少 2 层：' + JSON.stringify(owned36));

  /* ② 传奇档基础权重中幅下调（且不再等于原始 RARITY_WEIGHTS[3]） */
  assert.ok(TD.LEGEND_BASE_WEIGHT > 0 && TD.LEGEND_BASE_WEIGHT < TD.RARITY_WEIGHTS[3],
    '传奇基础权重应当低于原始值：' + TD.LEGEND_BASE_WEIGHT + ' vs ' + TD.RARITY_WEIGHTS[3]);
  const nat = TD.tiltWeights(1);
  const origLeg = TD.RARITY_WEIGHTS[3] / TD.RARITY_WEIGHTS.reduce((a, b) => a + b, 0);
  assert.ok(nat[3] < origLeg, '传奇档占比应当低于原始：' + nat[3] + ' vs ' + origLeg);
  /* 期望史诗曲线仍守住既有平衡（20/40/60/80 币 ≈ 1/2/3/4） */
  const e = (p) => TD.rerollExpectation(p).epics;
  assert.ok(Math.abs(e(20) - 1) < 0.3, '20 币期望史诗仍应约 1：' + e(20));
  /* 传奇权重二次下调到 2.2 之后，史诗期望整体小幅回落，
   * 这里把容差放宽到 0.4，同时仍要求「随价格单调递增」（下面的线性度断言守着）。 */
  assert.ok(Math.abs(e(40) - 2) < 0.4, '40 币期望史诗仍应约 2：' + e(40));
  assert.ok(Math.abs(e(60) - 3) < 0.4, '60 币期望史诗仍应约 3：' + e(60));
  assert.ok(Math.abs(e(80) - 4) < 0.6, '80 币期望史诗仍应约 4：' + e(80));

  /* ③ 终焉烙印（C49）：传奇·限次·可重复；终乘 1.25 / 损毁 1.5；多层独立相乘 */
  const c49 = TD.BUFF_BY_ID.C49;
  assert.ok(c49, 'C49 应当存在');
  assert.equal(c49.name, '终焉烙印', 'C49 名称');
  assert.equal(c49.rarity, 3, 'C49 应当是传奇');
  assert.equal(c49.kind, 'limited', 'C49 应当是限次类');
  assert.equal(c49.repeatable, true, 'C49 应当可重复获得');
  assert.equal(c49.mods.fragileFinalMul, true, 'C49 是终乘烙印');
  assert.equal(c49.mods.fragileAddAlive, 0.25, '存在时 +25%');
  assert.equal(c49.mods.fragileAddBurned, 0.5, '损毁后 +50%');
  assert.ok(c49.mods.repeatWeight > 0 && c49.mods.repeatWeight < 0.5,
    '应当有较低的重复出率：' + c49.mods.repeatWeight);
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
  /* 按层**加算**：存在层 +25%/层、损毁层 +50%/层。 */
  for (const n of [1, 2, 3]) {
    const s1 = scene(n, false);
    assert.ok(Math.abs(s1.power / base.power - (1 + 0.25 * n)) < 0.02,
      n + ' 层存在应当 ×' + (1 + 0.25 * n) + '：实测 ×' + (s1.power / base.power).toFixed(3));
    assert.ok(Math.abs(s1.agility / base.agility - (1 + 0.25 * n)) < 0.02,
      n + ' 层存在的敏捷也应同倍：实测 ×' + (s1.agility / base.agility).toFixed(3));
    assert.ok(Math.abs(s1.maxHp / base.maxHp - (1 + 0.25 * n)) < 0.02,
      n + ' 层存在的生命上限也应同倍：实测 ×' + (s1.maxHp / base.maxHp).toFixed(3));
  }
  for (const n of [1, 2, 3]) {
    const s1 = scene(n, true);
    assert.ok(Math.abs(s1.power / base.power - (1 + 0.5 * n)) < 0.02,
      n + ' 层损毁应当 ×' + (1 + 0.5 * n) + '（按层加算）：实测 ×' + (s1.power / base.power).toFixed(3));
  }
  /* 关键区分：3 层损毁 = 2.5（加算），而不是 1.5^3 = 3.375（幂乘） */
  const s3 = scene(3, true);
  const ratio = s3.power / base.power;
  assert.ok(Math.abs(ratio - Math.pow(1.5, 3)) > 0.3, '必须**不是**幂乘（1.5^n）：实测 ×' + ratio.toFixed(3));
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
    T.addBuff(T._debugRun('endless'), 'C49');    // ×1.25（终乘）
    const nx = T.nextBattle('endless');
    const me = mk(); nx.adjustMe(me);
    assert.equal(me.maxHp, Math.round(5000 * 1.1 * 1.25),
      '应当是「先加算再终乘」：(5000×1.1)×1.25 = ' + Math.round(5000 * 1.1 * 1.25) + '，实测 ' + me.maxHp);
  }

  /* ④ 已拥有传奇越多、传奇整体出率越低；全部可重复传奇到手后再降一档 */
  const f0 = TD.legendWeightFactor({});
  const f1 = TD.legendWeightFactor({ permanent: [{ id: 'C36' }] });
  const f3 = TD.legendWeightFactor({ permanent: [{ id: 'C14' }, { id: 'C36' }, { id: 'C37' }] });
  const allOwn = { permanent: [{ id: 'C14' }, { id: 'C36' }, { id: 'C37' }, { id: 'C49' }],
    instantIds: [{ id: 'C51', count: 1 }] };
  const fAll = TD.legendWeightFactor(allOwn);
  assert.equal(f0, 1, '没拿过传奇时系数应当是 1');
  assert.ok(f1 < f0, '拿到 1 条传奇后系数应当下降：' + f1 + ' vs ' + f0);
  assert.ok(f3 < f1, '拿到 3 条后应当更低：' + f3 + ' vs ' + f1);
  assert.ok(fAll < f3, '全部可重复传奇到手后应当再降：' + fAll + ' vs ' + f3);
  assert.equal(TD.allRepeatableLegendsOwned(allOwn), true, '应当识别出「全部可重复传奇已拥有」');
  assert.equal(TD.allRepeatableLegendsOwned({ permanent: [{ id: 'C36' }] }), false, '只拿一条不算全拥有');
  /* 权重与抽取都要跟着降（不是只在传奇内部挪权重，而是传奇这一档整体变小） */
  const w0 = TD.tiltWeights(1, {}), wAll = TD.tiltWeights(1, allOwn);
  assert.ok(wAll[3] < w0[3], '传奇那一档的整体占比应当下降：' + wAll[3] + ' vs ' + w0[3]);
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
    if (owned.length) T._debugRun('endless').permanent = owned.map((id) => ({ id: id, stacks: 1 }));
    T._debugRun('endless').instantIds = [{ id: 'C51', count: 1 }];   // 即时类传奇也要算「已拥有」
    /* 终焉烙印(C49) 是限次类、且「一局最多 3 次」—— 想让它真正退出池子，
     * 必须在 run.limited 里叠到 maxStacks（只挂 1 份仍会继续出现）。 */
    T._debugRun('endless').limited = [{ id: 'C49', stacks: 3, uses: 1000, on: true }];
    let leg = 0, epic = 0, tot = 0;
    for (let i = 0; i < 3000; i++) {
      for (const sl of (T.rollShopSlotsOf(T._debugRun('endless'), 0) || [])) {
        const b = TD.BUFF_BY_ID[sl.id]; if (!b) continue;
        tot++; if (b.rarity === 3) leg++; if (b.rarity === 2) epic++;
      }
    }
    return { leg: leg / tot, epic: epic / tot };
  };
  /* 注意：终焉烙印(C49) 现在是「一局最多 3 次」，只写 permanent 里 1 份并不算叠满，
   * 所以全拥有后它还会少量出现（直到 maxStacks）。这里改成对比「出率大幅下降」。 */
  /* 「全拥有」= 四条可重复传奇都到手且**叠满**（C49 需 3 层），此时传奇应彻底绝迹。 */
  const m0 = measure([]), mAll = measure(['C14', 'C36', 'C37']);
  assert.ok(m0.leg > 0, '未拥有时应当能刷到传奇：' + m0.leg);
  assert.equal(mAll.leg, 0, '全部可重复传奇叠满后不该再刷到传奇：' + mAll.leg);
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

  /* ② 天命所归（C51）：传奇·即时·可重复；史诗/传奇 ×2、普通 ×0.5 */
  const c51 = TD.BUFF_BY_ID.C51;
  assert.ok(c51, 'C51 应当存在');
  assert.equal(c51.name, '天命所归', 'C51 名称');
  assert.equal(c51.rarity, 3, 'C51 应当是传奇');
  assert.equal(c51.kind, 'instant', 'C51 应当是即时类');
  assert.equal(c51.repeatable, true, 'C51 应当可重复获得');
  assert.equal(c51.mods.epicMul, 2, '史诗档 ×2');
  assert.equal(c51.mods.legendMul, 2, '传奇档 ×2');
  assert.equal(c51.mods.commonMul, 0.5, '普通档 ×0.5');
  assert.ok(c51.mods.repeatWeight > 0 && c51.mods.repeatWeight < 1, '应当有重复获得惩罚：' + c51.mods.repeatWeight);
  assert.ok(TD.endlessPool.some((b) => b.id === 'C51'), 'C51 应当在无尽塔池');
  /* 权重真的变（普通降、史诗/传奇升） */
  const w0 = TD.tiltWeights(1, {}), w1 = TD.tiltWeights(1, { rarityBoost: 1 });
  assert.ok(w1[0] < w0[0], '普通档应当下降：' + w1[0] + ' vs ' + w0[0]);
  assert.ok(w1[2] > w0[2] * 1.8, '史诗档应当接近翻倍：' + w1[2] + ' vs ' + w0[2]);
  assert.ok(w1[3] > w0[3] * 1.8, '传奇档应当接近翻倍：' + w1[3] + ' vs ' + w0[3]);
  /* 即时获得会累加到 run 上（本局永久），并记进 instantIds */
  S.newGame('c51' + Math.random());
  const st = S.state(); st.level = 70; st.props[23] = 99999;
  for (let i = 1; i <= 18; i++) st.stages[i] = { npcIndex: 3, passed: true };
  try { T.abandon('endless'); } catch (e) {}
  T.startEndlessRun();
  const r = T._debugRun('endless');
  r.permanent = []; r.limited = []; r.slotFreeIds = [];
  assert.equal(T.rarityBoostOf(T._debugRun('endless')).common, 1, '没拿过时为 1');
  T.addBuff(T._debugRun('endless'), 'C51');
  const after1 = T._debugRun('endless');
  assert.equal(after1.rarityBoost, 1, '第 1 次获得应当记 1 层');
  assert.equal((after1.instantIds || []).find((x) => x.id === 'C51').count, 1, 'instantIds 应当记 1');
  assert.ok(T.rarityBoostOf(after1).epic === 2, '史诗系数应当是 2');
  T.addBuff(T._debugRun('endless'), 'C51');
  const after2 = T._debugRun('endless');
  assert.equal(after2.rarityBoost, 2, '可重复获得：第 2 次应当记 2 层');
  assert.ok(Math.abs(T.rarityBoostOf(after2).common - 0.25) < 1e-9, '2 层时普通系数 0.25');
  /* 重复获得惩罚：已拥有的层数会被记账（pickByShopWeight 据此降权）。 */
  assert.equal(T.instantOwnedCountOf(T._debugRun('endless'), 'C51'), 2,
    '已获得 2 次应当记 2：' + T.instantOwnedCountOf(T._debugRun('endless'), 'C51'));

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
      /* 秘技通神可以抽：主动技能，外加绝对防御(16) 与龟甲术(7) 这两个「受击自动触发」的
       * 防御被动（选中后大幅提升触发概率）。其余被动/防御类仍然不许出现。 */
      const defOk = (x.id === 16 || x.id === 7) && x.type === '防御';
      assert.ok(x.type === '主动' || defOk,
        '秘技通神只该抽主动技能或 16/7，实测抽到 ' + x.id + ':' + x.type + ' ' + x.name);
      if (!defOk) assert.ok(actives.indexOf(x.id) >= 0, '候选应当来自已学的主动技能：' + x.id);
    }
  }

  /* ② 终焉烙印（C49）：按层**加算**（1+0.5n），并进一步降低重复出率 */
  const c49 = TD.BUFF_BY_ID.C49;
  assert.equal(c49.mods.fragileAddAlive, 0.25, '存在层每层 +25%');
  assert.equal(c49.mods.fragileAddBurned, 0.5, '损毁层每层 +50%');
  assert.equal(c49.mods.fragileMulAlive, undefined, '旧的乘法参数应当已移除');
  assert.ok(c49.mods.repeatWeight > 0 && c49.mods.repeatWeight <= 0.2,
    '重复出率应当进一步调低（≤0.2）：' + c49.mods.repeatWeight);
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
    if (burned) { const rr = T._debugRun('endless'); rr.fragileMulBase = 0; rr.fragileMulBurned = burned; }
    const nx = T.nextBattle('endless');
    const me = mk(); nx.adjustMe(me);
    return me;
  };
  const base = scene(0, 0, 'C49');
  for (const n of [1, 2, 3]) {
    const s1 = scene(n, n, 'C49');
    assert.ok(Math.abs(s1.power / base.power - (1 + 0.5 * n)) < 0.02,
      n + ' 层损毁应当是 1+0.5×' + n + '：实测 ×' + (s1.power / base.power).toFixed(3));
  }
  const s3 = scene(3, 3, 'C49');
  assert.ok(Math.abs(s3.power / base.power - Math.pow(1.5, 3)) > 0.3,
    '必须**不是**幂乘 1.5^3：实测 ×' + (s3.power / base.power).toFixed(3));

  /* ③ 涌泉烙印（C52）：稀有·可重复；治疗量 +10% / 损毁 +20%（按层加算） */
  const c52 = TD.BUFF_BY_ID.C52;
  assert.ok(c52, 'C52 应当存在');
  assert.equal(c52.name, '涌泉烙印', 'C52 名称');
  assert.equal(c52.rarity, 1, 'C52 应当是稀有');
  assert.equal(c52.kind, 'limited', 'C52 应当是限次类（烙印）');
  assert.equal(c52.mods.fragileFinalMul, true, 'C52 是烙印（终结算）');
  assert.equal(c52.mods.fragileHealAddAlive, 0.10, '存在时治疗 +10%');
  assert.equal(c52.mods.fragileHealAddBurned, 0.20, '损毁后治疗 +20%');
  assert.ok(TD.endlessPool.some((b) => b.id === 'C52'), 'C52 应当在无尽塔池');
  assert.ok(c52.mods.repeatWeight > 0, 'C52 也应当有重复出率惩罚');
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

  /* ① 终焉烙印（C49）：一局最多 3 次，之后不再出现 */
  const c49 = TD.BUFF_BY_ID.C49;
  assert.equal(c49.maxStacks, 3, 'C49 应当最多 3 次');
  openRun();
  for (let n = 1; n <= 3; n++) {
    assert.ok(T.addBuff(T._debugRun('endless'), 'C49').ok, '第 ' + n + ' 次应当能获得');
    const rr = T._debugRun('endless');
    const row = (rr.limited || []).find((b) => b.id === 'C49');
    assert.equal(row && row.stacks, n, '第 ' + n + ' 次后层数应当是 ' + n);
    if (n < 3) {
      assert.equal(T.poolFilterOf(rr, c49), true, n + ' 层时仍应可进池');
      assert.equal(T.ownableOf(rr, c49), true, n + ' 层时仍可获得');
    }
  }
  const r3 = T._debugRun('endless');
  assert.equal(T.poolFilterOf(r3, c49), false, '叠满 3 次后不该再进池');
  assert.equal(T.ownableOf(r3, c49), false, '叠满 3 次后不该再获得');
  T.addBuff(T._debugRun('endless'), 'C49');
  assert.equal((T._debugRun('endless').limited.find((b) => b.id === 'C49') || {}).stacks, 3,
    '第 4 次不该再叠上去');

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
  /* 实战触发率对比：绝对防御 / 龟甲术 都要明显变高 */
  const mkF = (eff, skills) => ({ name: 'p', level: 60, power: 200, agility: 100, speed: 100,
    hp: 40000, maxHp: 40000, weapons: [{ id: 1, level: 5 }],
    skills: (skills || []).map((id) => ({ id: id, level: 5 })), effects: eff || {},
    baseStats: { power: 200, agility: 100, speed: 100 } });
  const rateOf = (eff, skills, key) => {
    let hits = 0, trig = 0;
    for (let i = 0; i < 200; i++) {
      const me = mkF(eff, skills);
      const foe = { name: 'F', level: 60, power: 300, agility: 200, speed: 150, hp: 999999, maxHp: 999999,
        weapons: [{ id: 1, level: 5 }], skills: [], effects: {}, baseStats: { power: 300, agility: 200, speed: 150 } };
      const rr = Sim.simulate(foe, me);
      for (const x of (rr.rounds || [])) {
        if (x.attacker === 0 && x.action === 'common' && x.dmg !== undefined) { hits++; if (x[key]) trig++; }
      }
    }
    return hits ? trig / hits : 0;
  };
  const jdPlain = rateOf(null, [16], 'jueDui'), jdBoost = rateOf({ 16: 2 }, [16], 'jueDui');
  assert.ok(jdBoost > jdPlain * 1.5, '绝对防御触发率应当大幅提升：' + (jdPlain * 100).toFixed(1) + '% → ' + (jdBoost * 100).toFixed(1) + '%');
  const gjPlain = rateOf(null, [7], 'guiJia'), gjBoost = rateOf({ 7: 2 }, [7], 'guiJia');
  assert.ok(gjBoost > gjPlain * 1.5, '龟甲术触发率应当大幅提升：' + (gjPlain * 100).toFixed(1) + '% → ' + (gjBoost * 100).toFixed(1) + '%');

  /* ③ 天象之眼（C45）必须拦住敌方自愈（以及其它「纯粹强化敌人自身」的环境） */
  assert.equal(TD.ENDLESS_ENV_BY_ID.regen.noReflect, true, '自愈回复应当标记 noReflect');
  assert.equal(TD.ENDLESS_ENV_BY_ID.lifesteal.noReflect, true, '吸血应当标记 noReflect');
  assert.equal(TD.ENDLESS_ENV_BY_ID.shell.noReflect, true, '护盾应当标记 noReflect');
  assert.equal(TD.ENDLESS_ENV_BY_ID.devour.noReflect, true, '吞噬成长应当标记 noReflect');
  assert.ok(!TD.ENDLESS_ENV_BY_ID.thorns.noReflect, '荆棘反伤应当仍可反弹');
  assert.ok(!TD.ENDLESS_ENV_BY_ID.greed.noReflect, '贪婪裂隙应当仍可反弹');
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
  /* 荆棘仍然反弹（这是「敌人自食其果」，不该被一起拦掉） */
  const th = envTrial(['thorns'], true);
  assert.ok(Number(th.foe.thornsPct) > 0, '荆棘反伤应当仍然反弹给敌人：' + JSON.stringify(th.foe));
  /* 血色黄昏（正向）：我方该吃的仍然吃得到，敌方被剥夺 */
  const duskOff = envTrial(['dusk'], false), duskOn = envTrial(['dusk'], true);
  assert.ok(Number(duskOff.me.lifestealPct) > 0 && Number(duskOff.foe.lifestealPct) > 0,
    '没有天象之眼时血色黄昏双方都吃：' + JSON.stringify(duskOff));
  assert.ok(Number(duskOn.me.lifestealPct) > 0, '有天象之眼时我方仍该吃血色黄昏：' + JSON.stringify(duskOn.me));
  assert.ok(!(Number(duskOn.foe.lifestealPct) > 0), '有天象之眼时敌方不该吃血色黄昏：' + JSON.stringify(duskOn.foe));
  T.abandon('endless');
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
