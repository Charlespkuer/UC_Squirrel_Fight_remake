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
  for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  }
  c.State.newGame('环境测试');
  const S = c.State.state();
  S.level = 70;
  S.props[23] = 30;
  for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };
  c.Tower._debugSetLayer(9);
  assert.ok(c.Tower.startEndlessRun().ok, '应该能开一局无尽塔');
  c.Tower._debugSetEndlessLayer(20);
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
  assert.equal(foe.mech.length, 0, '敌人身上不该再有机制标签：' + JSON.stringify(foe.mech));
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

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ' | ' + (e && e.message)); if (process.env.SSDZ_VERBOSE) console.log(e && e.stack); }
  }
  console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${cases.length} 项）`);
  process.exit(failed ? 1 : 0);
})();
