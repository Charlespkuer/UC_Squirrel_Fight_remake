/* Run: node tools/test-combat-rules.cjs (Node built-ins only).
 * Evidence: references/new/reference.md and 攻略.md; original GameDict.
 * Deterministic random streams verify event ordering and resource-independent
 * combat rules. Server-only probabilities remain explicit Sim.rules defaults.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function game(fallback = 0.5, sequence = []) {
  const c = { console }; c.window = c;
  vm.createContext(c);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/sim.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  }
  const math = vm.runInContext('Math', c);
  math.random = () => sequence.length ? sequence.shift() : fallback;
  return c;
}
const fighter = (extra = {}) => ({ name: '测试松鼠', level: 20, power: 10, agility: 10, speed: 10, hp: 10000, weapons: [], skills: [], ...extra });
const rounds = (g, a = {}, b = {}, options) => g.Sim.simulate(fighter(a), fighter(b), options).rounds;
const tests = [];
const test = (name, run) => tests.push([name, run]);

test('师父在低血线才尝试救场，每场仅一次，使用真实师父等级', () => {
  const g = game();
  g.Debug = { enabled: (key) => key === 'godMode' };
  const events = rounds(g, { hp: 100, power: 1, skills: ['13:1'], masterLevel: 7 }, { power: 35, speed: 11 }, { masterChance: 100 });
  const index = events.findIndex((r) => r.id === 13);
  assert.ok(index > 0);
  assert.ok(events[index - 1].hpAfter[0] <= 35);
  assert.equal(events[index].healSelf, 28);
  assert.equal(events.filter((r) => r.id === 13).length, 1);
  assert.ok(events.length > index + 10, '长战斗中反复进入低血，仍不会再次呼叫');
});

test('高血量、无师父或未通过概率判定时，不会呼叫师父', () => {
  for (const masterLevel of [0, undefined]) {
    const g = game();
    const events = rounds(g, { hp: 100, power: 1, skills: ['13:1'], masterLevel }, { power: 35, speed: 11 }, { masterChance: 100 });
    assert.equal(events.some((r) => r.id === 13), false);
  }
  assert.equal(rounds(game(), { skills: ['13:1'], masterLevel: 100 }, { power: 1 }, { masterChance: 100 }).some((r) => r.id === 13), false);
  assert.equal(rounds(game(), { hp: 100, skills: ['13:1'], masterLevel: 20 }, { power: 35, speed: 11 }, { masterChance: 0 }).some((r) => r.id === 13), false);
});

test('师父血线包含35%边界，治疗不超过最大生命', () => {
  const events = rounds(game(), { hp: 100, power: 1, skills: ['13:1'], masterLevel: 100 }, { power: 65, speed: 11 }, { masterChance: 100 });
  assert.equal(events[0].hpAfter[0], 35);
  assert.equal(events[1].id, 13);
  assert.equal(events[1].healSelf, 65);
  assert.equal(events[1].hpAfter[0], 100);
});

test('师父之后的下一击必中，不会被中途对手行动消耗', () => {
  const ordinary = [0.9, 0.9, 0.5, 0.9, 0.9];
  const g = game(0.9, [...ordinary, ...ordinary, ...ordinary, 0.1, ...ordinary, 0.9, 0, 0.5, 0.9, 0.9]);
  const events = rounds(g, { hp: 100, power: 1, skills: ['13:1'], masterLevel: 7 }, { power: 35, speed: 11 });
  const my = events.filter((r) => r.attacker === 0), index = my.findIndex((r) => r.id === 13);
  assert.ok(index >= 0);
  assert.equal(my[index + 1].action, 'common');
  assert.equal(my[index + 1].dodge, undefined);
  assert.ok(my[index + 1].dmg > 0);
});

test('木剑持有时不加闪避，击中后加闪避，闪避增益不反复叠加', () => {
  const events = rounds(game(0.11), { weapons: ['3:10'] }, { speed: 11 });
  assert.equal(events[0].attacker, 1);
  assert.equal(events[0].dodge, undefined);
  assert.equal(events[1].id, 3);
  assert.equal(events[1].dodgeBuff, 30);
  assert.equal(events[2].dodge, true);
  assert.ok(events.filter((r) => r.dodgeBuff).every((r) => r.dodgeBuff === 30));
  const miss = rounds(game(0.9, [0.5, 0.5, 0]), { weapons: ['3:10'] });
  assert.equal(miss[0].dodge, true);
  assert.equal(miss[0].dodgeBuff, undefined);
  const relative = rounds(game(0.2), { weapons: ['3:10'] }, { speed: 11 });
  assert.equal(relative[2].dodge, undefined, '加成后的约13%闪避仍低于20%，不是加30个百分点');
});

test('移形换位按原有闪避率增幅计算，不直接增加百分点', () => {
  // 同敏捷时基础闪避约10%，十级移形为其增加23%，低于20%。
  const events = rounds(game(0.2), {}, { skills: ['11:10'] });
  assert.equal(events[0].dodge, undefined);
  assert.ok(events[0].dmg > 0);
  // 11%随机值位于基础闪避与增益后的闪避之间。
  const dodged = rounds(game(0.9, [0.9, 0.11]), {}, { skills: ['11:10'] });
  assert.equal(dodged[0].dodge, true);
});

test('野球拳十级为力量加速度的255%', () => {
  const events = rounds(game(), { power: 10, speed: 10, skills: ['12:10'] });
  assert.equal(events[0].id, 12);
  assert.equal(events[0].dmg, 51);
});

test('小宇宙使用裸属性，最低一点，装备附加单独增加并马上行动', () => {
  const events = rounds(game(), {
    power: 100, agility: 100, speed: 100, baseStats: { power: 20, agility: 5, speed: 20 },
    skills: ['14:10'], effects: { 36: 30 },
  }, { speed: 100 });
  assert.equal(events[0].id, 14);
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].statBonus)), { power: 32, agility: 1, speed: 2 });
  assert.equal(events[0].noDmg, true);
  assert.equal(events[0].dmg, undefined);
  assert.equal(events[1].attacker, 0);
  assert.equal(events[1].action, 'common');
  assert.equal(events[1].dmg, 132);
  assert.equal(events.filter((r) => r.id === 14).length, 1);
});

test('装死后立刻行动，即使对方速度远高于自己', () => {
  const events = rounds(game(), { power: 100, speed: 100 }, { hp: 10, power: 1, skills: ['6:1'] });
  assert.equal(events[0].fakeDie, true);
  assert.equal(events[0].hpAfter[1], 1);
  assert.equal(events[0].counterDmg, undefined);
  assert.equal(events[1].attacker, 1);
  assert.equal(events.filter((r) => r.fakeDie).length, 1);
});

test('装死打断武器连击，获得行动机会', () => {
  const events = rounds(game(0.2), { weapons: ['4:10'], speed: 100 }, { hp: 10, power: 1, skills: ['6:1'] });
  assert.equal(events[0].hits, 2);
  assert.equal(events[0].fakeDie, true);
  assert.equal(events[0].hpAfter[1], 1);
  assert.equal(events[1].attacker, 1);
});

test('橡皮擦和吸铁大法均可无视装死', () => {
  for (const attacker of [{ weapons: ['7:1'] }, { skills: ['18:1'] }]) {
    const events = rounds(game(), attacker, { hp: 1, skills: ['6:1'] });
    assert.equal(events[0].fakeDie, undefined);
    assert.equal(events[0].hpAfter[1], 0);
    assert.equal(events.length, 1);
  }
});

test('色诱和通灵可以闪避，幸运一击始终必中', () => {
  for (const skill of [8, 15]) {
    // 技能选择、抽选、可选伤害随机值均为0，从而命中闪避判定。
    const events = rounds(game(0), { skills: [skill + ':1'] });
    assert.equal(events[0].id, skill);
    assert.equal(events[0].dodge, true);
    assert.equal(events[0].stunApplied, undefined);
  }
  const lucky = rounds(game(0), { skills: ['23:1'] }, { agility: 1000 });
  assert.equal(lucky[0].dodge, undefined);
  assert.ok(lucky[0].dmg > 0);
});

test('普通龟甲只抵挡一次，附加属性可以增加一次', () => {
  const ordinary = rounds(game(0.3), {}, { skills: ['7:10'] });
  assert.equal(ordinary.filter((r) => r.guiJia).length, 1);
  const extra = rounds(game(0.3), {}, { skills: ['7:10'], effects: { 32: 100 } });
  assert.equal(extra.filter((r) => r.guiJia).length, 2);
});

test('来点松果不在满血时浪费，恢复后不占下一次行动', () => {
  const events = rounds(game(), { hp: 100, skills: ['17:1'] }, { power: 30, speed: 11 });
  const index = events.findIndex((r) => r.id === 17);
  assert.ok(index > 0);
  assert.equal(events[index].healSelf, 20);
  assert.equal(events[index].actAgain, true);
  assert.equal(events[index + 1].attacker, 0);
});

test('武器好手的固定加成不随力量倍率增长', () => {
  for (const power of [1, 100]) {
    const plain = rounds(game(), { power, weapons: ['2:1'] })[0].dmg;
    const specialist = rounds(game(), { power, weapons: ['2:1'], skills: ['5:10'] })[0].dmg;
    assert.equal(specialist - plain, 28);
  }
});

test('用户Debug无敌模式保留，反弹后的血量快照仍至少为1', () => {
  const g = game(0.2);
  g.Debug = { enabled: (key) => key === 'godMode' };
  const events = rounds(g, { hp: 1, power: 1000 }, { skills: ['16:10'], hp: 100000 });
  assert.ok(events.some((r) => r.reboundHurt));
  assert.ok(events.every((r) => r.hpAfter[0] >= 1));
});

test('流星锤即使未命中也给对手整场相对20%闪避增益', () => {
  const events = rounds(game(0.9, [0.5, 0.5, 0, 0.9, 0.9, 0.5, 0.9, 0.9, 0.9, 0.11]), { weapons: ['10:1'] });
  assert.equal(events[0].id, 10);
  assert.equal(events[0].dodge, true);
  assert.equal(events[2].action, 'common');
  assert.equal(events[2].dodge, true, '之后的普通攻击也受到流星锤闪避增益影响');
  const relative = rounds(game(0.2), { weapons: ['10:1'] });
  assert.equal(relative[0].dodge, undefined, '相对+20%约为12%，不增加20个百分点');
});

test('狼牙棒中毒在中招者四次出手掉血，包含不占回合的追加行动', () => {
  const events = rounds(game(0.8, [0.5, 0.5, 0.5, 0.5, 0.1, 0.9, 0.5, 0]), { weapons: ['12:1'] }, { skills: ['14:1'] });
  assert.equal(events[0].dotApplied, true);
  const poison = events.filter((r) => r.action === 'dot');
  assert.equal(poison.length, 4);
  assert.ok(poison.every((r) => r.attacker === 1 && r.dmg === 4));
  const cosmos = events.findIndex((r) => r.id === 14);
  assert.ok(cosmos > 0);
  assert.equal(events[cosmos + 1].action, 'dot');
  assert.equal(events[cosmos + 2].attacker, 1);
});

test('沉默之斧同时抑制武器好手等被动技能', () => {
  const attacker = { weapons: ['16:10'] }, defender = { weapons: ['2:1'], skills: ['5:10'] };
  const events = rounds(game(0.3), attacker, defender);
  assert.equal(events[0].silenceApplied, true);
  const muted = events.find((r) => r.attacker === 1 && r.action === 'weapon');
  const withoutSkill = rounds(game(0.3), attacker, { weapons: ['2:1'] }).find((r) => r.attacker === 1 && r.action === 'weapon');
  assert.equal(muted.dmg, withoutSkill.dmg);
});

test('来点松果每场战斗只能使用一次', () => {
  const events = rounds(game(0.3), { skills: ['17:5'], power: 1 }, { power: 50, hp: 100000 });
  const snacks = events.filter((r) => r.id === 17);
  assert.equal(snacks.length, 1);
  assert.ok(snacks[0].healSelf > 0);
  assert.ok(events.length > 30, '战斗足够长，排除了“没机会再用”的假象');
});

test('来点松果每场战斗只能使用一次', () => {
  const events = rounds(game(0.3), { skills: ['17:5'], power: 1 }, { power: 50, hp: 100000 });
  const snacks = events.filter((r) => r.id === 17);
  assert.equal(snacks.length, 1);
  assert.ok(snacks[0].healSelf > 0);
  assert.ok(events.length > 30, '战斗足够长，排除了“没机会再用”的假象');
});

test('仙鹤大招「仙鹤展翅」是其首次行动且每场仅一次', () => {
  const events = rounds(game(0.9), { hp: 100000, power: 1, speed: 100 }, { npcType: 'xh', power: 30, hp: 8000, speed: 10 });
  const ults = events.filter((r) => r.ultName === '仙鹤展翅');
  assert.equal(ults.length, 1);
  assert.equal(events[events.findIndex((r) => r.attacker === 1)], ults[0]);
});

test('螳螂生命低于20%才放「疾风镰刀舞」四连击，每场仅一次且高血量不放', () => {
  const events = rounds(game(0.9), { power: 50, hp: 100000 }, { npcType: 'tl', power: 5, hp: 1000 });
  const ults = events.filter((r) => r.ultName === '疾风镰刀舞');
  assert.equal(ults.length, 1);
  assert.equal(ults[0].multiHit, 4);
  assert.ok(ults[0].dmg > 0);
  // 触发那一帧螳螂血量必须已经低于 20%（削弱前是 35%，几乎每场都放）
  let hp = 1000;
  let frac = null;
  for (const r of events) {
    if (r.ultName === '疾风镰刀舞') { frac = hp / 1000; break; }
    if (Array.isArray(r.hpAfter)) hp = r.hpAfter[1];
  }
  assert.ok(frac != null && frac < 0.25, '触发时血量比例应明显偏低，实际 ' + frac);
  // 血量一直很高时一次都不该放：给一个打不死的对手
  const tanky = rounds(game(0.9), { power: 1, hp: 100000 }, { npcType: 'tl', power: 1, hp: 100000 });
  assert.equal(tanky.some((r) => r.ultName === '疾风镰刀舞'), false, '高血量不放四连击');
});

test('熊猫生命低于40%放「熊掌震地」并震晕对手一回合，每场仅一次', () => {
  const events = rounds(game(0.9), { power: 50, hp: 100000 }, { npcType: 'xm', power: 5, hp: 1000 });
  const ults = events.filter((r) => r.ultName === '熊掌震地');
  assert.equal(ults.length, 1);
  assert.equal(ults[0].stunApplied, true);
  assert.ok(events.some((r) => r.attacker === 0 && r.action === 'stunned'));
});

test('关卡连战入场：当前血量按比例继承，但生命上限保持不变', () => {
  const g = game();
  // 满血入场：上限与血量都由 hp 推出，行为不变。
  const full = g.Sim.simulate(fighter({ hp: 400 }), fighter({ hp: 400 }));
  assert.deepEqual(Array.from(full.maxHp), [400, 400]);
  // 残血入场（25%）：hp 是当前血量，maxHp 仍是不变的上限。
  // 修复前 maxHp 会被写成 100，血条显示成满血且上限被压低。
  const hurt = g.Sim.simulate(fighter({ hp: 100, maxHp: 400 }), fighter({ hp: 400 }));
  assert.deepEqual(Array.from(hurt.maxHp), [400, 400]);
  assert.ok(hurt.rounds.every((r) => r.hpAfter[0] <= 400));
  // 上限更高的那一方不会因为入场残血就被判定为「血量比例更高」而拖到超时判胜。
  const short = g.Sim.simulate(fighter({ hp: 10, maxHp: 400, power: 1, weapons: [] }), fighter({ hp: 400, power: 60 }));
  assert.equal(short.winner, 1, '残血一方应当战败，而不是按 10/10 满血拖到判定');
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name, error); }
}
console.log((tests.length - failed) + '/' + tests.length + ' combat rule checks passed');
if (failed) process.exitCode = 1;
