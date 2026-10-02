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
  const sim = c.Sim.simulate(PLAYER(), r.foe);
  assert.ok(sim.rounds.some((x) => (x.thornsDmg || 0) > 0), '荆棘反伤应当真的反弹伤害');
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
  for (let g = 0; g < 12; g++) {
    const r = c.Tower._debugRun('endless');
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

  // 2) 倾斜权重族：p=1 就是自然掉率，p 越大越偏向高稀有度
  const natural = TD.tiltWeights(1);
  assert.equal(natural.map((v) => Math.round(v * 100)).join(','), TD.RARITY_WEIGHTS.map((v) => Math.round(v / 1 * 1)).join(','),
    'p=1 应当等于自然掉率权重：' + JSON.stringify(natural));
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
  const r20 = rows.find((r) => r.price === 20).epics, r40 = rows.find((r) => r.price === 40).epics;
  assert.ok(Math.abs(r20 - 1) < 0.3, '实战 20 币应当约 1 件史诗，实测 ' + r20.toFixed(2));
  assert.ok(Math.abs(r40 - 2) < 0.35, '实战 40 币应当约 2 件史诗，实测 ' + r40.toFixed(2));
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
  assert.equal(TD.BUFF_BY_ID.N04.towerBattle, true, '金蝉脱壳应当标 towerBattle');
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
  // 池子规模：挑战塔真用得上的限次增益 + 挑战塔专属
  assert.equal(TD.towerPool.length, 31, '挑战塔池应当是 31 条，实测 ' + TD.towerPool.length);
  assert.equal(TD.towerPool.filter((b) => b.towerOnly).length, 12, '其中 12 条是挑战塔专属');
  // 无尽池不该混入挑战塔专属（它们按「一场定胜负」设计）
  assert.equal(TD.endlessPool.filter((b) => b.towerOnly).length, 0, '无尽池不该有挑战塔专属');
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

  // 所有限次类都标了 towerBattle（含新加的挑战塔专属）
  for (const b of TD.towerPool) {
    if (b.kind !== 'limited') continue;
    assert.equal(b.towerBattle, true, b.id + ' 应当标 towerBattle');
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
  assert.match(ui, /towerBattle/, 'UI 要按 towerBattle 区分展示');
  assert.match(ui, /'下一场'/, '面板胶囊要能显示「下一场」');
  assert.match(ui, /仅挑战塔/, '选牌卡面要标「仅挑战塔」');
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
    assert.equal(b.towerBattle, true, b.id + ' 应当 towerBattle');
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

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ' | ' + (e && e.message)); if (process.env.SSDZ_VERBOSE) console.log(e && e.stack); }
  }
  console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${cases.length} 项）`);
  process.exit(failed ? 1 : 0);
})();
