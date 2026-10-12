#!/usr/bin/env node
/* ============================================================
 * tools/test-env-buff.cjs — 环境词缀（无尽塔唯一常驻负面机制）回归
 *
 * 需求：
 *   1) 段位机制（荆棘反伤/自愈回复/吸血/护盾/吞噬成长）**全部并入环境词缀**，
 *      只保留这一个常驻负面机制来源；
 *   2) 所有环境 buff 都能悬停查看具体效果；
 *   3) 环境的具体数值在小范围内随机。
 *
 * 用法：node tools/test-env-buff.cjs
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
const FORMER_MECHS = ['thorns', 'regen', 'lifesteal', 'shell', 'devour'];

function setup() {
  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
  const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const f of ['js/gamedict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js', 'js/tower-plot.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  }
  c.State.newGame('环境测试');
  const S = c.State.state();
  S.level = 70;
  S.props[23] = 30;
  for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };
  c.Tower._debugSetLayer(9);
  assert.ok(c.Tower.startEndlessRun().ok, '应该能开一局无尽塔');
  /* x0 层现在是「觐见魔王」三连战（近卫是狂战松鼠），敌人构成与旧口径不同 ——
   * 这个套件验的是环境词缀的实战数值，改用 x9 层（普通三侠 + 首领，且不在巡逻层区间）。 */
  c.Tower._debugSetEndlessLayer(19);
  return c;
}

/** 给本局塞一条指定环境（数值手工指定，便于精确断言）。 */
function withEnv(c, list) {
  c.Tower._debugRun('endless').env = list;
}
/** 取下一场并跑 adjustMe，返回 { foe, me }。 */
function nextFoe(c, player) {
  const nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应该能开出下一场：' + ((nx && nx.msg) || ''));
  const me = player || { name: '玩家', level: 70, power: 140, agility: 120, speed: 120, maxHp: 2000, hp: 2000,
    baseStats: { power: 140, agility: 120, speed: 120 }, weapons: [{ id: 1, level: 15 }], skills: [], wears: [], effects: {}, masterLevel: 0 };
  nx.adjustMe(me);
  return { foe: nx.foe, me, nx };
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('环境池已并入原段位机制，且“段位机制”这条链路不再自动出现', () => {
  const c = setup();
  const TD = c.TowerData;
  const ids = TD.ENDLESS_ENV.map((e) => e.id);
  for (const id of FORMER_MECHS) {
    assert.ok(ids.includes(id), '原机制 ' + id + ' 应当并入环境池');
    assert.equal(TD.ENDLESS_ENV_BY_ID[id].mech, true, id + ' 应当标成 mech（界面会标「机制」）');
  }
  // 旧接口还在（兼容），但实战里不再自动挂机制
  assert.equal(c.Tower._debugRun('endless').mechs.length, 0, 'run.mechs 应当恒为空');
  const { foe } = nextFoe(c);
  /* x0 层现在是「觐见魔王」三连战，第一位是狂战松鼠近卫 —— 它带的是**变体自己的**机制（berserk 等），
      与「段位机制并入环境」这件事无关，所以这里只断言「不再出现旧段位机制」。 */
    const OLD_MECHS = ['trialMirror', 'trialLifesteal', 'trialDry', 'trialThorns', 'trialShield'];
    assert.equal(foe.mech.filter((m) => OLD_MECHS.indexOf(m) >= 0).length, 0, '敌人身上不该再有旧段位机制：' + JSON.stringify(foe.mech));
  // 无尽信息里暴露的 mechs 也应为空
  assert.equal(c.Tower.endlessInfo().run.mechs.length, 0, 'endlessInfo().run.mechs 也应为空');
});

test('环境数值在小范围内随机：落在区间内、且多次抽取会变', () => {
  const c = setup();
  const TD = c.TowerData;
  for (const def of TD.ENDLESS_ENV) {
    const samples = [];
    for (let i = 0; i < 40; i++) samples.push(TD.rollEnvMods(def));
    for (const [key, spec] of Object.entries(def.mods)) {
      const lo = Number(spec[0]), hi = Number(spec[1]);
      for (const v of samples) {
        assert.ok(v[key] >= lo - 1e-9 && v[key] <= hi + 1e-9, def.name + '.' + key + ' 越界：' + v[key] + ' ∉ [' + lo + ',' + hi + ']');
      }
      const uniq = new Set(samples.map((v) => v[key].toFixed(6)));
      if (hi > lo) assert.ok(uniq.size > 1, def.name + '.' + key + ' 应当随机（区间 ' + lo + '~' + hi + '），实测只有 ' + uniq.size + ' 种取值');
    }
  }
});

test('悬停文案：每条环境都有完整效果 + 数值区间（界面据此渲染 data-tip）', () => {
  const c = setup();
  const TD = c.TowerData;
  for (const def of TD.ENDLESS_ENV) {
    const t = TD.envText(def);
    assert.ok(t.text && t.text.length > 4, def.name + ' 的效果文案太短：' + t.text);
    // 模板占位符必须全部被替换掉
    assert.ok(!/%\w+%/.test(t.text), def.name + ' 还有未替换的占位符：' + t.text);
    assert.ok(t.keys.length >= 1, def.name + ' 应当至少有一个数值');
    const range = TD.envRangeText(def);
    assert.ok(range && range.length >= 1, def.name + ' 应当有数值区间文案');
    assert.ok(!/undefined|NaN/.test(range), def.name + ' 区间文案有脏值：' + range);
  }
  // 同一条环境在不同取值下文案会跟着变（数值真的写进了文案）
  const def = TD.ENDLESS_ENV_BY_ID.thorns;
  const a = TD.envText(def, { thornsPct: 0.11 }).text;
  const b = TD.envText(def, { thornsPct: 0.16 }).text;
  assert.notEqual(a, b, '不同数值的文案应当不同：' + a + ' / ' + b);
  assert.match(a, /11%/, '数值应当出现在文案里：' + a);
  assert.match(b, /16%/, '数值应当出现在文案里：' + b);
});

test('界面渲染：每条环境胶囊都带 data-tip（悬停可看）', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  // 取真实的 envChip 来跑（不复制实现）
  const start = ui.indexOf('function envChip(');
  assert.ok(start > 0, 'tower-ui.js 里应该有 envChip');
  const end = ui.indexOf('\n  }', start);
  const ctx = vm.createContext({
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
  });
  const envChip = vm.runInContext(ui.slice(start, end + 4) + '\nenvChip;', ctx, { filename: 'envChip.js' });
  const html = envChip({ id: 'thorns', name: '荆棘反伤', bad: true, mech: true, left: 4,
    text: '敌人受到伤害时反弹 +13%', rangeText: '10% ~ 16%' });
  assert.match(html, /data-tip="[^"]+"/, '环境胶囊必须带 data-tip：' + html);
  assert.match(html, /敌人受到伤害时反弹 \+13%/, '悬停里要有完整效果');
  assert.match(html, /数值区间：10% ~ 16%/, '悬停里要有数值区间');
  assert.match(html, /剩余 4 场/, '悬停里要有剩余场数');
  assert.match(html, /env-mech/, '原机制类要带 env-mech 标记');
  // 塔内所有弹窗都要走「自动绑定悬停」的包装
  assert.ok(/function modal\(title, content, buttons, opts\) \{\s*\n\s*const m = C\(\)\.modal\(/.test(ui),
    '塔内 modal 包装应当自动 bindTips');
  const raw = (ui.match(/C\(\)\.modal\(/g) || []).length;
  assert.equal(raw, 1, '除了包装函数内部，不该再有裸的 C().modal 调用（否则里面的提示绑不上）');
});

test('每条环境都真的作用到战斗里（逐条实战验证）', () => {
  const c = setup();

  // 荆棘反伤：敌人受击时反弹
  withEnv(c, [{ id: 'thorns', left: 5, values: { thornsPct: 0.15 } }]);
  let r = nextFoe(c);
  assert.ok(r.foe.mods.thornsPct > 0, '荆棘反伤应当写进敌人 mods');
  let sim = c.Sim.simulate(r.me, r.foe);
  assert.ok(sim.rounds.some((x) => (x.thornsDmg || 0) > 0), '荆棘反伤应当真的反弹伤害');

  // 自愈回复
  c.Tower.abandon && (function () { try { c.Tower.abandon('endless'); } catch (e) {} })();
  const c2 = setup();
  withEnv(c2, [{ id: 'regen', left: 5, values: { regenPct: 0.03 } }]);
  r = nextFoe(c2);
  assert.ok(r.foe.mods.regenPct > 0, '自愈回复应当写进 mods');
  sim = c2.Sim.simulate(r.me, r.foe);
  assert.ok(sim.rounds.some((x) => x.action === 'regen'), '自愈回复应当真的回血');

  // 护盾
  const c3 = setup();
  withEnv(c3, [{ id: 'shell', left: 5, values: { shellPct: 0.25 } }]);
  r = nextFoe(c3);
  assert.ok(r.foe.mods.shellPct > 0, '护盾应当写进 mods.shellPct（由 sim 按 maxHp 换算）');

  // 吸血
  const c4 = setup();
  withEnv(c4, [{ id: 'lifesteal', left: 5, values: { lifestealPct: 0.30 } }]);
  r = nextFoe(c4);
  assert.ok(r.foe.mods.lifestealPct > 0, '吸血应当写进 mods');
  sim = c4.Sim.simulate({ name: 'p', level: 70, power: 1, agility: 1, speed: 1, maxHp: 5000, hp: 5000,
    baseStats: { power: 1, agility: 1, speed: 1 }, weapons: [{ id: 1, level: 15 }], skills: [], wears: [], effects: {} }, r.foe);
  assert.ok(sim.rounds.some((x) => (x.lifesteal || 0) > 0), '吸血应当真的回血');

  // 吞噬成长
  const c5 = setup();
  withEnv(c5, [{ id: 'devour', left: 5, values: { devourPct: 0.02 } }]);
  r = nextFoe(c5);
  assert.ok(r.foe.mods.devourPct > 0, '吞噬成长应当写进 mods.devourPct');

  // 烈日灼烧：敌方暴击
  const c6 = setup();
  withEnv(c6, [{ id: 'sun', left: 5, values: { enemyCritBonus: 25 } }]);
  r = nextFoe(c6);
  assert.ok(r.foe.crit >= 25, '烈日灼烧应当给敌人暴击：' + r.foe.crit);

  // 寒霜锁链：我方速度下降（且要在属性算完之后生效 —— 放在属性算之前会被覆盖）
  const mkPlayer = () => ({ name: 'p', level: 70, power: 140, agility: 120, speed: 120, maxHp: 2000, hp: 2000,
    baseStats: { power: 140, agility: 120, speed: 120 }, weapons: [{ id: 1, level: 15 }], skills: [], wears: [], effects: {} });
  const cBase = setup();
  const base = nextFoe(cBase, mkPlayer());                     // 不带环境的对照组
  const cFrost = setup();
  withEnv(cFrost, [{ id: 'frost', left: 5, values: { selfSpeedMul: -0.20 } }]);
  const frosted = nextFoe(cFrost, mkPlayer());
  assert.ok(frosted.me.speed < base.me.speed,
    '寒霜锁链应当压低我方速度：' + frosted.me.speed + ' vs ' + base.me.speed);
});

test('旧档兼容：没有 values 的环境实例会自动补摇一次', () => {
  const c = setup();
  // 模拟旧存档：env 里只有 id 与 left
  withEnv(c, [{ id: 'thorns', left: 3 }]);
  const info = c.Tower.endlessInfo();
  const e = info.run.env[0];
  assert.ok(e.values && typeof e.values.thornsPct === 'number', '应当就地补出 values：' + JSON.stringify(e.values));
  assert.ok(e.text && /%/.test(e.text), '应当渲染出带数值的文案：' + e.text);
  assert.ok(e.rangeText, '应当带数值区间');
});

test('挑战塔的环境不承诺试炼币：贪婪裂隙在塔里改名「厚甲裂隙」，只剩敌方生命上限', () => {
  const c = setup();
  const TD = c.TowerData;
  const greed = TD.ENDLESS_ENV_BY_ID.greed;
  const values = { coinBonus: 0.5, enemyMaxHpMul: 0.15 };
  // ① 无尽塔照旧：文案提试炼币、数值也真的摇得出来
  const endlessText = TD.envText(greed, values);
  assert.match(endlessText.text, /试炼币 \+50%/, '无尽塔照旧显示试炼币加成：' + endlessText.text);
  assert.ok(TD.rollEnvMods(greed, 'endless').coinBonus > 0, '无尽塔照旧摇出试炼币键');
  // ② 挑战塔：改名 + 文案与数值都不再有无尽收益那一档
  const towerDef = TD.envDefFor(greed, 'tower');
  assert.equal(towerDef.name, '厚甲裂隙', '挑战塔里改名为厚甲裂隙');
  assert.equal(Object.keys(towerDef.mods).includes('coinBonus'), false, '塔里的 mods 不含 coinBonus');
  const towerText = TD.envText(greed, values, 'tower');
  assert.ok(!/试炼币/.test(towerText.text), '塔里的文案不该再提试炼币：' + towerText.text);
  assert.match(towerText.text, /敌方生命上限 \+15%/);
  assert.equal(TD.rollEnvMods(greed, 'tower').coinBonus, undefined, '塔里也摇不出试炼币键');
  assert.equal(TD.envRangeText(greed, 'tower'), '10% ~ 18%', '区间只列真正生效的那一档');
  assert.match(TD.envPreviewText(greed, 'tower'), /敌方生命上限 10%~18%/, '开打前的预告写区间，不写现摇值');
  // ③ 抽取池：只剩无尽收益词条的环境进不了塔池；贪婪裂隙改名后仍在池子里
  const pool = TD.envPoolFor('tower');
  assert.ok(!pool.some((e) => Object.keys(e.mods || {}).every((k) => TD.ENDLESS_REWARD_MOD_KEYS.includes(k))),
    '只剩无尽收益词条的环境不该进挑战塔的池子');
  assert.ok(pool.some((e) => e.id === 'greed'), '贪婪裂隙仍留在塔池里（已改名）');
  assert.ok(pool.map((e) => TD.envDefFor(e, 'tower').name).includes('厚甲裂隙'));
  // ④ 塔里实际生效的数值同样剔掉试炼币（连旧档里注入的 values 也算）
  assert.ok(c.Tower.startTowerRun().ok, '应该能开一层挑战塔');
  const towerRun = c.Tower._debugRun('tower');
  towerRun.env = [{ id: 'greed', left: 4, values: values }];
  const e = c.Tower.towerInfo().run.env[0];
  assert.equal(e.name, '厚甲裂隙');
  assert.equal(e.values.coinBonus, undefined, '塔里生效的数值不含试炼币：' + JSON.stringify(e.values));
  assert.ok(e.values.enemyMaxHpMul > 0, '敌方生命上限那一档照常生效');
  assert.ok(!/试炼币/.test(e.text), '塔里的当前环境文案也不提试炼币：' + e.text);
});

test('100 层循环：层号 → 机制开关的映射每轮严格一致，只有敌人数值续着长', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  /* 0）用户口径（2026-10）：101-104 层没有环境；随机丢烙印要等到「原来的层数 +100」（132 层）。 */
  for (const n of [101, 102, 103, 104]) assert.equal(TD.canHaveEnv(n), false, '第 ' + n + ' 层不该有环境');
  assert.equal(TD.canHaveEnv(105), true, '第 105 层 = 第 2 轮第 5 层 → 照旧抽环境');
  assert.equal(TD.envChance(105), TD.envChance(5), '105 层的触发概率必须等于 5 层（20%）');
  assert.equal(TD.envChance(105), 0.2, '实测 ' + TD.envChance(105));
  for (let n = 101; n <= 131; n++) assert.equal(TD.canBrandLoss(n), false, '第 ' + n + ' 层不该丢烙印');
  assert.equal(TD.canBrandLoss(132), true, '第 132 层 = 第 2 轮第 32 层 → 开始丢烙印');
  /* 1）逐层比对：第 N 层 与 第 N+100 层的**全部**按层机制完全一致（第 1~300 层）。 */
  const cycleLayer = (n) => ((n - 1) % 100) + 1;
  const modsAt = (n) => JSON.stringify({
    env: TD.canHaveEnv(n),
    envForced2: TD.canHaveEnv(n) && cycleLayer(n) >= TD.ENV_TWO_LAYER,
    envChance: TD.envChance(n),
    brandLoss: TD.canBrandLoss(n),
    /* 「交一个增益」的门槛也是**轮内**层号（第 1 轮 20/30/…/100 → 第 2 轮 120/130/…/200）。 */
    sacrifice: cycleLayer(n) >= 20 && n % 10 === 0 && TD.sacrificeAllowed(n),
    shopSlots: TD.endlessShopSlots(n),
    choiceCut: TD.choiceCut(n),
    noShop: TD.layerNoShop(n),
    patrol: TD.isPatrolLayer(n, 12345),
    shopBoundary: n % 5 === 0,
  });
  for (let n = 1; n <= 100; n++) {
    assert.equal(modsAt(n + 100), modsAt(n), '第 ' + n + ' 层与第 ' + (n + 100) + ' 层的机制开关必须完全一致');
    assert.equal(modsAt(n + 200), modsAt(n), '第 ' + n + ' 层与第 ' + (n + 200) + ' 层同样要一致');
  }
  /* 2）真的抽：101~104 层抽不到、105 层起抽得到（与 1~4 / 5 层对照）。 */
  const hits = (layer, tries) => { let n = 0; for (let i = 0; i < tries; i++) n += T.rollEnvOf(layer).length; return n; };
  for (const n of [101, 102, 103, 104]) assert.equal(hits(n, 120), 0, '第 ' + n + ' 层不该抽到环境');
  assert.ok(hits(105, 120) > 0, '第 105 层应当抽得到环境');
  assert.ok(hits(150, 120) > 0, '第 150 层应当抽得到环境');
  assert.equal(hits(4, 120), 0, '第 4 层不该抽到环境（第 1 轮口径不变）');
  assert.ok(hits(5, 120) > 0, '第 5 层应当抽得到环境');
  /* 3）真的丢烙印：进 132 层丢一条、101 / 131 层不丢（走真实 advanceLayer）。 */
  const probeLoss = (n) => {
    T._debugSetEndlessLayer(n - 1);
    const r = T._debugRun('endless');
    r.brokenMarks = [{ kind: 'stat', stat: 'power', pct: 0.05, alive: 0, burned: 0.05 }];
    r.lostMarks = [];
    T._debugAdvanceLayer();
    return (T._debugRun('endless').lostMarks || []).length;
  };
  assert.equal(probeLoss(32), 1, '进第 32 层丢一条（第 1 轮口径不变）');
  assert.equal(probeLoss(101), 0, '进第 101 层不该丢');
  assert.equal(probeLoss(131), 0, '进第 131 层不该丢');
  assert.equal(probeLoss(132), 1, '进第 132 层应当丢一条');
  /* 4）唯一例外：敌人数值继续长（不重置）。 */
  assert.ok(TD.endlessDepthMul(101) > TD.endlessDepthMul(100), '101 层敌人数值仍高于 100 层');
  assert.ok(TD.endlessDepthMul(201) > TD.endlessDepthMul(200), '201 层同样');
  /* 5）跨轮进层（200 → 201）时清掉残留环境，给新一轮干净起点。 */
  T._debugSetEndlessLayer(200);
  T._debugRun('endless').env = [{ id: 'thorns', left: 5, values: { thornsPct: 0.15 } }];
  T._debugAdvanceLayer();
  assert.equal(T._debugRun('endless').layer, 201);
  assert.equal((T._debugRun('endless').env || []).length, 0, '跨轮时旧环境应当清掉');
});

test('无尽塔主线剧情：层号/事件 → 该播哪一段（埋点与推进）', () => {
  const c = setup();
  const TD = c.TowerData, T = c.Tower;
  /* ① 层号 → 入场剧情：只挂在**第一场**上；这些层之外一处都不挂。 */
  const planAt = (layer) => { T._debugSetEndlessLayer(layer); return T._debugRun('endless').plan; };
  const ENTRY = { 20: 'gate20', 30: 'layer30', 40: 'layer40', 90: 'layer90', 95: 'layer95', 100: 'x00stage' };
  for (const [layer, id] of Object.entries(ENTRY)) {
    assert.equal(planAt(Number(layer))[0].entryStory, id, '第 ' + layer + ' 层第一场应当挂 ' + id);
  }
  for (const layer of [1, 5, 19, 21, 31, 41, 99]) {
    assert.ok(!planAt(layer)[0].entryStory, '第 ' + layer + ' 层不该有入场剧情');
  }
  /* ② 点「继续战斗」= 开战前先把剧情挂上；同一次开战重复调用不会换段。 */
  T._debugSetEndlessLayer(20);
  T.nextBattle('endless');
  assert.equal(T._debugRun('endless').story, 'gate20', '第 20 层第 1 场开战前应当挂 gate20');
  T.nextBattle('endless');
  assert.equal(T._debugRun('endless').story, 'gate20', '重复调用不该换段');
  /* ③ 播过的（storySeen）不再挂 —— 重开一局也不打断。 */
  T.markStorySeen('gate20');
  T.clearRunStory('endless');
  /* ⚠ `nextBattle` 会留下一枚「这一场还没结算」的令牌（真实流程里由战斗回调消耗掉）；
   * 测试里手工跨过去时必须显式收回，否则后面所有 nextBattle 都会被它挡住。 */
  delete T._debugRun('endless').attempt;
  /* ④ 整百层五段：王庭 → 第一近卫 →（段间）第二近卫 → 三重王命 → 终章。 */
  T._debugSetEndlessLayer(100);
  T.nextBattle('endless');
  assert.equal(T._debugRun('endless').story, 'layer100', '第 100 层第 1 场之前先播王庭');
  T.markStorySeen('layer100');
  assert.equal(T.nextEntryStoryOf(), 'x00a', '王庭播完接着第一近卫');
  T.clearRunStory('endless');
  const winOne = () => {
    const r = T._debugRun('endless');
    r.choices = null; r.phase = null;
    if (r.shop) r.shop = null;
    delete r.attempt;
    const nx = T.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能开下一场：' + ((nx && nx.msg) || ''));
    return T.reportBattle('endless', nx.token, true, 1500, 2000);
  };
  winOne();
  assert.equal(T._debugRun('endless').story, 'x00b', '第 1 场之后应当挂第二近卫');
  T.markStorySeen('x00b'); T.clearRunStory('endless');
  winOne();
  assert.equal(T._debugRun('endless').story, 'x00c', '第 2 场之后应当挂三重王命');
  T.markStorySeen('x00c'); T.clearRunStory('endless');
  winOne();
  assert.equal(T._debugRun('endless').story, 'x00win', '第 3 场之后应当挂终章');
  /* ⑤ 献祭：离店之后**先挂剧情**再进 sacrifice 阶段（不是先弹窗）。 */
  T.markStorySeen('x00win'); T.clearRunStory('endless');
  T._debugSetEndlessLayer(20);
  T.debugGrantBuff('C06');
  const run = T._debugRun('endless');
  run.idx = run.plan.length - 1; run.choices = null; run.phase = null;
  delete run.attempt;
  const nx20 = T.nextBattle('endless');
  T.reportBattle('endless', nx20.token, true, 1500, 2000);
  assert.equal(T.endlessInfo().run.phase, 'shop', '第 20 层是 x5 → 结算商店');
  T.markStorySeen('gate20'); T.clearRunStory('endless');
  T.continueFromShop();
  assert.equal(T.endlessInfo().run.phase, 'sacrifice', '离店之后进献祭阶段');
  assert.equal(T.endlessInfo().run.story, 'gate20b', '并且已经挂上「石门天平倾斜」那段（剧情优先于弹窗）');
  /* ⑥ 献祭完成 → 石门开启那一段；之后的献供从 offer1~5 里随机。 */
  T.markStorySeen('gate20b');
  const cands = T.sacrificeCandidatesOf();
  assert.ok(cands.length, '应当有可献祭的增益');
  T.sacrificePerm(cands[0].uid != null ? cands[0].uid : cands[0].id);
  assert.equal(T._debugRun('endless').story, 'gate20c', '献祭完成应当挂 gate20c');
  T.markStorySeen('gate20c'); T.clearRunStory('endless');
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    T.debugGrantBuff('C06');
    T._debugSetEndlessLayer(30);
    const r = T._debugRun('endless');
    r.idx = r.plan.length - 1; r.choices = null; r.phase = null;
    delete r.attempt;
    const n = T.nextBattle('endless');
    T.reportBattle('endless', n.token, true, 1500, 2000);
    T.continueFromShop();
    const s = T.endlessInfo().run.story;
    if (s) { seen.add(s); assert.ok(/^offer[1-5]$/.test(s), '只能从 offer1~5 里抽，实测 ' + s); }
    T.clearRunStory('endless');
  }
  assert.ok(seen.size > 1, '重复献供应当随机抽段（实测只出现 ' + [...seen].join(',') + '）');
  /* ⑦ 第一次失去烙印：先让提示停留（pendingStory + hold），再播剧情；只触发一次。 */
  T._debugSetEndlessLayer(31);
  const r31 = T._debugRun('endless');
  r31.brokenMarks = [{ kind: 'stat', stat: 'power', pct: 0.05, alive: 0, burned: 0.05 }];
  T._debugAdvanceLayer();                      // 31 → 32（轮内 32、偶数 → 丢烙印）
  const after = T.endlessInfo().run;
  assert.equal(after.pendingStoryId, 'layer31', '第一次丢烙印应当交接待播的 layer31');
  assert.equal(after.pendingStoryHold, true, '并且要求「提示先停留」');
  assert.equal(after.story, null, '不该直接用 run.story 抢在提示前面');
  assert.equal((T._debugRun('endless').lostMarks || []).length, 1, '这一层确实丢了一条烙印');
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
