/* Run with: node tools/test-state.cjs. Uses the original dictionary and isolated saves. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function game(search) {
  const storage = new Map();
  let now = new Date(2026, 8, 23, 23, 55).getTime();
  let seed = 617;
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = {
    Date: TestDate,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  };
  if (search !== undefined) context.location = { search };
  context.window = context;
  vm.createContext(context);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js', 'js/sim.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const math = vm.runInContext('Math', context);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  context.State.newGame('测试松鼠');
  return { ...context, storage, math, advance: (ms) => { now += ms; } };
}
const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const tests = [];
function test(name, run) { tests.push([name, run]); }

test('浏览器 QA 和自检存档隔离，正式存档不会被测试覆盖', () => {
  for (const search of ['?test=1', '?test=2', '?qa=1', '?view=home&test=1', '?qa=1&screen=bag']) {
    const g = game(search);
    const original = JSON.stringify({ name: '正式玩家', level: 30, goldPoint: 888 });
    g.storage.set('ssdz_save_v1', original);
    assert.equal(g.State.saveKey, 'ssdz_test_save_v1');
    g.State.newGame('自动测试'); g.State.claimDaily(); g.State.save();
    assert.equal(g.storage.get('ssdz_save_v1'), original);
    assert.equal(JSON.parse(g.storage.get('ssdz_test_save_v1')).name, '自动测试');
    assert.equal(g.State.load(), true); assert.equal(g.State.state().name, '自动测试');
  }
  for (const search of [undefined, '', '?test=12', '?test=1x', '?qa=0', '?contest=1']) {
    const g = game(search);
    assert.equal(g.State.saveKey, 'ssdz_save_v1');
    assert.ok(g.storage.has('ssdz_save_v1')); assert.equal(g.storage.has('ssdz_test_save_v1'), false);
  }
});

test('旧存档保留等级、物品、关卡并独立补全新字段', () => {
  const g = game();
  g.storage.set('ssdz_save_v1', JSON.stringify({ name: '老玩家', level: 25, goldPoint: 703, energy: 67, weapons: ['15:12'], stages: { 7: { npcIndex: 2, passed: false } }, props: { 23: 4 } }));
  assert.equal(g.State.load(), true);
  const s = g.State.state();
  assert.equal(s.level, 25); assert.equal(s.goldPoint, 703); assert.equal(s.energy, 67);
  assert.equal(s.props[23], 4); assert.equal(s.stages[7].npcIndex, 2);
  s.propsStates[7] = 10;
  assert.equal(g.GData.NEW_PLAYER.propsStates[7], undefined);
  same(g.State.battleHistory(), []);
});

test('破损字段得到校正，非对象存档被拒绝', () => {
  const g = game();
  g.storage.set('ssdz_save_v1', JSON.stringify({ level: -1, energy: -8, props: null, skills: ['1:0', '1:3', '999:1'], gears: null, stages: { 1: null }, lastEnergyTs: 0 }));
  assert.equal(g.State.load(), true);
  assert.equal(g.State.state().level, 1); assert.equal(g.State.state().energy, 0);
  same(g.State.mySkills().map((s) => [s.id, s.level]), [[1, 1]]);
  g.State.tickEnergy(); assert.equal(g.State.state().energy, 0);
  for (const value of ['null', '[]', '7', '{broken']) {
    g.storage.set('ssdz_save_v1', value); assert.equal(g.State.load(), false);
  }
});

test('每日奖励按照本地日期发放，同日重载后不重复领取', () => {
  const g = game(), s = g.State.state();
  assert.equal(g.State.claimDaily().ok, true);
  assert.equal(s.goldPoint, 250); assert.equal(s.props[23], 1);
  assert.equal(g.State.claimDaily().ok, false);
  g.State.load(); assert.equal(g.State.claimDaily().ok, false);
  g.advance(6 * 60 * 1000);
  assert.equal(g.State.dailyStatus().claimed, false);
  assert.equal(g.State.claimDaily().ok, true);
  assert.equal(g.State.state().goldPoint, 400); assert.equal(g.State.state().props[23], 2);
});

test('旧存档首次迁移每日统计日期时保留当日数据，重载不清零', () => {
  const g = game();
  g.storage.set('ssdz_save_v1', JSON.stringify({ name: '老玩家', dailyWins: 7, dailyFails: 3, joinRankCount: 4, allWins: 80, allFails: 20 }));
  assert.equal(g.State.load(), true);
  let s = g.State.state();
  assert.equal(s.dailyStatsDate, g.State.localDate());
  same([s.dailyWins, s.dailyFails, s.joinRankCount, s.allWins, s.allFails], [7, 3, 4, 80, 20]);
  assert.equal(JSON.parse(g.storage.get('ssdz_save_v1')).dailyStatsDate, g.State.localDate());
  g.State.tickEnergy(); g.State.claimDaily(); g.State.load(); s = g.State.state();
  same([s.dailyWins, s.dailyFails, s.joinRankCount], [7, 3, 4]);
});

test('跨本地午夜在体力刷新时日切并保存，即使体力已满也正常', () => {
  const g = game(), s = g.State.state();
  s.dailyWins = 9; s.dailyFails = 2; s.joinRankCount = 6; s.allWins = 120; s.allFails = 40;
  s.energy = s.maxEnergy; g.State.save();
  const oldDate = s.dailyStatsDate;
  g.advance(6 * 60 * 1000);
  g.State.tickEnergy();
  assert.notEqual(s.dailyStatsDate, oldDate); assert.equal(s.dailyStatsDate, g.State.localDate());
  same([s.dailyWins, s.dailyFails, s.joinRankCount, s.allWins, s.allFails], [0, 0, 0, 120, 40]);
  const saved = JSON.parse(g.storage.get('ssdz_save_v1'));
  same([saved.dailyWins, saved.dailyFails, saved.joinRankCount, saved.dailyStatsDate], [0, 0, 0, g.State.localDate()]);
  s.dailyWins = 1; s.joinRankCount = 1;
  g.State.tickEnergy();
  same([s.dailyWins, s.joinRankCount], [1, 1]);
});

test('隔日加载会日切；每日礼包领取本身不清除任何统计', () => {
  const g = game(), s = g.State.state();
  s.dailyWins = 5; s.dailyFails = 1; s.joinRankCount = 2; g.State.save();
  const originalDate = s.dailyStatsDate;
  g.advance(24 * 60 * 60 * 1000);
  assert.equal(g.State.claimDaily().ok, true);
  same([s.dailyWins, s.dailyFails, s.joinRankCount, s.dailyStatsDate], [5, 1, 2, originalDate]);
  assert.equal(g.State.load(), true);
  const next = g.State.state();
  same([next.dailyWins, next.dailyFails, next.joinRankCount], [0, 0, 0]);
  assert.equal(next.dailyStatsDate, g.State.localDate());
  assert.equal(g.State.dailyStatus().claimed, true);
  assert.equal(next.goldPoint, 250); assert.equal(next.props[23], 1);
});

test('只调整设备 Date.now 时，统计与每日奖励共用同一本地日期', () => {
  const g = game(), s = g.State.state();
  s.dailyWins = 2; g.State.claimDaily();
  const original = g.Date.now();
  g.Date.now = () => original + 24 * 60 * 60 * 1000;
  g.State.tickEnergy();
  assert.equal(s.dailyWins, 0);
  assert.equal(g.State.dailyStatus().claimed, false);
  assert.equal(g.State.claimDaily().ok, true);
  assert.equal(s.dailyClaimDate, s.dailyStatsDate);
});

test('体力离线恢复保留余秒，满体力时不积攒免费恢复', () => {
  const g = game(), s = g.State.state();
  s.energy = 100;
  g.advance(11 * 60 * 1000); g.State.tickEnergy();
  assert.equal(s.energy, 102); assert.equal(g.State.energyCountdown(), '4:00');
  s.energy = 120;
  g.advance(24 * 60 * 60 * 1000);
  assert.equal(g.State.consumeEnergy(10), true);
  assert.equal(s.energy, 110);
  g.State.tickEnergy(); assert.equal(s.energy, 110);
  assert.equal(g.State.consumeEnergy(111), false); assert.equal(g.State.consumeEnergy(-10), false);
  g.State.load(); assert.equal(g.State.state().energy, 110);
});

test('升级遵循原表等级与资源限制，零卷轴不会产生 NaN', () => {
  const g = game(), s = g.State.state();
  assert.equal(g.State.doUpgrade('weapon', 1).ok, false);
  s.level = 5;
  assert.equal(g.State.doUpgrade('weapon', '1').ok, true);
  assert.equal(s.weapons[0], '1:2'); assert.equal(s.goldPoint, 50);
  assert.equal(s.props[22], undefined);
  s.level = 7;
  assert.equal(g.State.doUpgrade('weapon', 1).ok, false);
  assert.equal(s.goldPoint, 50);
  s.props[22] = 7;
  assert.equal(g.State.doUpgrade('weapon', 1).ok, true);
  assert.equal(s.props[22], 0); assert.equal(s.weapons[0], '1:3');
});

test('购买拒绝负数、小数和无穷数量，合法购买正常扣款', () => {
  const g = game(), s = g.State.state();
  for (const count of [-5, 0, 1.5, Infinity]) assert.equal(g.State.buyProp(1, count).ok, false);
  assert.equal(s.goldPoint, 100);
  assert.equal(g.State.buyProp(1, 2).ok, true);
  assert.equal(s.goldPoint, 94); assert.equal(s.props[1], 5);
});

test('装备穿戴等级、槽位互斥、融合材料和附加属性生效', () => {
  const g = game(), s = g.State.state();
  const one = g.State.addGear(1, [{ id: 28, level: 1 }]);
  assert.equal(g.State.wear(one.key), false);
  s.level = 20;
  assert.equal(g.State.wear(one.key), true);
  const two = g.State.addGear(5);
  assert.equal(g.State.wear(two.key), true);
  assert.equal(g.State.myGears().find((x) => x.key === one.key).used, false);
  g.State.wear(one.key); s.skills = ['2:5'];
  assert.equal(g.State.totalStats().agility, s.agility + 1 + 12);
  g.State.unwear(one.key);
  const count = s.gears.length;
  assert.equal(g.State.mergeGears([one.key, one.key, one.key]).ok, false);
  const otherSlot = g.State.addGear(2);
  assert.equal(g.State.mergeGears([one.key, two.key, otherSlot.key]).ok, false);
  assert.equal(s.goldPoint, 100); assert.equal(s.gears.length, count + 1);
  const three = g.State.addGear(1), four = g.State.addGear(1);
  const result = g.State.mergeGears([one.key, three.key, four.key]);
  assert.equal(result.ok, true); assert.equal(result.gear.quality, 1);
  assert.equal(s.goldPoint, 50);
});

test('礼包可打开且不重复发放，满体力药剂不浪费', () => {
  const g = game(), s = g.State.state();
  assert.equal(g.State.useProp(28).ok, true);
  assert.equal(s.goldPoint, 150); assert.equal(s.props[29], 1);
  assert.equal(g.State.useProp(28).ok, false);
  assert.equal(g.State.useProp(29).ok, false);
  s.energy = s.maxEnergy;
  const count = s.props[1];
  assert.equal(g.State.useProp(1).ok, false); assert.equal(s.props[1], count);
});

test('相同装备附加能力只取最高一条，跨装备和同件装备均不叠加', () => {
  const g = game(), s = g.State.state(); s.level = 20; s.skills = ['1:5'];
  const head = g.State.addGear(1, [{ id: 27, level: 1 }, { id: 27, level: 2 }]);
  const hand = g.State.addGear(2, [{ id: 27, level: 3 }]);
  g.State.wear(head.key); g.State.wear(hand.key);
  assert.equal(g.State.equipmentEffects()[27], 80);
  assert.equal(g.State.totalStats().power, s.power + g.State.gearInst(2).abilityVal + 18);
  g.State.unwear(hand.key);
  assert.equal(g.State.equipmentEffects()[27], 40);
  assert.equal(g.State.totalStats().power, s.power + 14);
});

test('关卡重打不倒退已解锁的 NPC，通关标记和存档保持', () => {
  const g = game();
  g.State.setStageProgress(1, { npcIndex: 3, passed: false });
  const progress = g.State.stageProgress(1); progress.npcIndex = 2;
  g.State.setStageProgress(1, progress);
  assert.equal(g.State.stageProgress(1).npcIndex, 3);
  g.State.setStageProgress(1, { npcIndex: 3, passed: true });
  g.State.setStageProgress(1, { npcIndex: 1, passed: false });
  g.State.load();
  assert.equal(g.State.stageProgress(1).passed, true);
  assert.equal(g.State.setStageProgress(999, { npcIndex: 3 }), false);
});

test('不使用药剂的战斗不消耗有效次数，被动技能按原字典增长', () => {
  const g = game(), s = g.State.state();
  s.skills = ['1:1', '2:2', '3:3', '4:1']; s.propsStates[3] = 20; s.propsStates[7] = 20;
  const stats = g.State.totalStats({ useProps: false });
  same(stats, { power: 10, agility: 12, speed: 11, hp: 58 });
  g.State.fightReward(true, { useProps: false });
  assert.equal(s.propsStates[3], 20); assert.equal(s.propsStates[7], 20);
  g.State.fightReward(true); assert.equal(s.propsStates[3], 19);
});

const fighter = (extra) => Object.assign({ name: '松鼠', level: 1, power: 10, agility: 10, speed: 10, hp: 100, weapons: [], skills: [] }, extra);

test('反击后的血量快照与胜负一致，不遗漏最后一击', () => {
  const g = game(); g.math.random = () => 0.2;
  const result = g.Sim.simulate(fighter({ hp: 5 }), fighter({ power: 100 }));
  assert.equal(result.rounds[0].counterDmg > 0, true);
  assert.equal(result.rounds[0].hpAfter[0], 0);
  assert.equal(result.rounds.length, 1); assert.equal(result.winner, 1);
});

test('方天画戟在攻击前蓄力，武器升级伤害与原表一致', () => {
  const g = game(); g.math.random = () => 0.5;
  const result = g.Sim.simulate(fighter({ weapons: ['1:1'] }), fighter({ hp: 250 }));
  const mine = result.rounds.filter((r) => r.attacker === 0);
  assert.equal(mine[0].action, 'rest'); assert.equal(mine[1].action, 'weapon');
  assert.equal(g.State.weaponInst('1:11').harmLo, 15 + 9 * 12 + 20);
  assert.equal(g.State.weaponInst('2').harmLo, 12);
});

test('高速行动不会饿死较慢的一方，速度翻倍约行动两倍', () => {
  const g = game(); g.math.random = () => 0.8;
  const result = g.Sim.simulate(fighter({ speed: 200, hp: 100000 }), fighter({ speed: 100, hp: 100000 }));
  const counts = [0, 0]; result.rounds.forEach((r) => counts[r.attacker]++);
  assert.equal(counts[0], 80); assert.equal(counts[1], 40);
});

test('师父驾到使用师父等级，下一次普通攻击保留必中', () => {
  const g = game();
  const ordinary = [0.9, 0.9, 0.5, 0.9, 0.9];
  // 对手先攻击：100→65→30；低血呼叫真实7级师父，恢复28点。
  const rolls = [...ordinary, ...ordinary, ...ordinary, 0.1, ...ordinary, 0.9, 0, 0.5, 0.9, 0.9];
  g.math.random = () => rolls.length ? rolls.shift() : 0.9;
  const result = g.Sim.simulate(fighter({ power: 1, skills: ['13:1'], masterLevel: 7 }), fighter({ speed: 11, power: 35, hp: 10000 }));
  const mine = result.rounds.filter((r) => r.attacker === 0);
  const summoned = mine.findIndex((r) => r.id === 13);
  assert.ok(summoned > 0, '满血时不呼叫师父');
  assert.equal(mine[summoned].healSelf, 28);
  assert.equal(mine.filter((r) => r.id === 13).length, 1);
  assert.equal(mine[summoned + 1].action, 'common');
  assert.equal(mine[summoned + 1].dodge, undefined);
  assert.ok(mine[summoned + 1].dmg > 0);
});

test('装备词条改变对应武器伤害与减伤，不只显示说明', () => {
  const g = game(); g.math.random = () => 0.5;
  const attacker = fighter({ weapons: ['2:1'], hp: 10000 });
  const defender = fighter({ hp: 10000 });
  const plain = g.Sim.simulate(attacker, defender).rounds[0].dmg;
  const geared = g.Sim.simulate({ ...attacker, effects: { 6: 100, 13: 100 } }, defender).rounds[0].dmg;
  const reduced = g.Sim.simulate({ ...attacker, effects: { 6: 100, 13: 100 } }, { ...defender, effects: { 9: 50 } }).rounds[0].dmg;
  assert.equal(geared, plain * 3); assert.equal(reduced, Math.round(geared * 0.5));
});

test('全部原版武器、技能与 NPC 的事件流都能有限结束并维持合法血量', () => {
  const g = game();
  const fixtures = [];
  g.weaponsMap.each((id) => fixtures.push(fighter({ weapons: [id + ':15'], hp: 600, speed: 80 })));
  g.skillsMap.each((id) => fixtures.push(fighter({ skills: [id + ':15'], hp: 600, speed: 80 })));
  g.npcsMap.each((id, npc) => fixtures.push({ name: npc.name, level: 20, power: +npc.power, agility: +npc.agility, speed: +npc.speed, hp: +npc.hp,
    weapons: [], skills: npc.skills ? npc.skills.split('|') : [], npcType: g.GData.stageTypeOf(+npc.stageId).anim }));
  for (const fixture of fixtures) {
    const result = g.Sim.simulate(fixture, fighter({ weapons: ['14:10', '16:10'], skills: ['6:1', '7:10', '16:10', '17:10'], hp: 600, speed: 80 }));
    assert.ok(result.rounds.length > 0 && result.rounds.length <= 240);
    for (const round of result.rounds) for (let side = 0; side < 2; side++) {
      assert.ok(Number.isFinite(round.hpAfter[side]) && round.hpAfter[side] >= 0 && round.hpAfter[side] <= result.maxHp[side], fixture.name);
    }
    assert.ok(result.winner === 0 || result.winner === 1);
  }
});

test('战报保存独立快照，重载可回放，最多保留最新 50 条', () => {
  const g = game();
  const me = fighter({ name: '我' }), foe = fighter({ name: '对手' });
  const result = g.Sim.simulate(me, foe);
  const saved = g.State.recordBattle({ me, foe, result, region: 3, kind: '关卡' });
  assert.equal(saved.region, 3); assert.equal(saved.createdAt, g.Date.now());
  me.name = '已修改'; result.rounds[0].hpAfter[0] = 99999;
  assert.equal(g.State.battleHistory()[0].me.name, '我');
  assert.notEqual(g.State.battleHistory()[0].result.rounds[0].hpAfter[0], 99999);
  for (let i = 0; i < 54; i++) g.State.recordBattle({ me: fighter(), foe: fighter({ name: String(i) }), result: saved.result });
  g.State.load();
  const history = g.State.battleHistory();
  assert.equal(history.length, 50); assert.equal(history[0].foe.name, '53'); assert.equal(history[49].foe.name, '4');
  assert.equal(history[0].result.rounds.length > 0, true);
  history[0].foe.name = '外部修改'; assert.equal(g.State.battleHistory()[0].foe.name, '53');
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS', name); }
  catch (error) { failed++; console.error('FAIL', name, error.stack); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
