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
  s.energy = 80;
  g.advance(11 * 60 * 1000); g.State.tickEnergy();
  assert.equal(s.energy, 82); assert.equal(g.State.energyCountdown(), '4:00');
  s.energy = s.maxEnergy;
  g.advance(24 * 60 * 60 * 1000);
  assert.equal(g.State.consumeEnergy(10), true);
  assert.equal(s.energy, s.maxEnergy - 10);
  g.State.tickEnergy(); assert.equal(s.energy, s.maxEnergy - 10);
  assert.equal(g.State.consumeEnergy(s.maxEnergy - 9), false); assert.equal(g.State.consumeEnergy(-10), false);
  g.State.load(); assert.equal(g.State.state().energy, s.maxEnergy - 10);
});

test('升级遵循原表等级与资源限制，零卷轴不会产生 NaN', () => {
  const g = game(), s = g.State.state();
  s.weapons = ['1:1'];
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

test('礼包可打开且不重复发放；药剂可以顶过自然上限，到硬上限才不浪费', () => {
  const g = game(), s = g.State.state();
  assert.equal(g.State.useProp(28).ok, true);
  assert.equal(s.goldPoint, 150); assert.equal(s.props[29], 1);
  assert.equal(g.State.useProp(28).ok, false);
  assert.equal(g.State.useProp(29).ok, false);
  // 满体力时药剂仍然可用，会顶到自然上限之上
  s.energy = s.maxEnergy;
  const count = s.props[1];
  const capped = g.State.useProp(1);
  assert.equal(capped.ok, true, '满体力也可以用，超出部分保留');
  assert.equal(s.energy, s.maxEnergy + 10);
  assert.equal(s.props[1], count - 1, '用掉的药剂要扣');
  // 超过自然上限后不再自然回复
  const before = s.energy;
  g.advance(30 * 60 * 1000);
  g.State.tickEnergy();
  assert.equal(s.energy, before, '超上限时不再自然回复');
  // 到达硬上限 999 才拒绝，且不扣道具
  s.energy = g.State.energyHardCap();
  const held = s.props[1];
  assert.equal(g.State.useProp(1).ok, false);
  assert.equal(s.props[1], held, '硬上限时不能白扣药剂');
  // 批量使用：一次用多个，最终停在硬上限
  s.energy = 0; s.props[2] = 50;
  const many = g.State.usePropMany(2, 'all');
  assert.equal(many.ok, true);
  assert.equal(s.energy, g.State.energyHardCap());
  assert.equal(many.used, 34, '999/30 向上需要 34 个大体力药剂');
  assert.equal(s.props[2], 50 - many.used);
  // 存档往返不会把超上限的体力清掉
  g.State.save(); g.State.load();
  assert.equal(g.State.state().energy, g.State.energyHardCap());
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
  same(stats, { power: s.power + 2, agility: s.agility + 4, speed: s.speed + 4, hp: s.maxHp + 5 });
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

test('经验丸说明不再声称竞技场无效，其它限制仍保留', () => {
  const g = game();
  const pill = g.propMap.getValue(7), superPill = g.propMap.getValue(44);
  assert.equal(pill.name, '经验丸');
  assert.doesNotMatch(pill.remark, /竞技/);
  assert.match(pill.remark, /40%/);
  assert.match(pill.remark, /关卡中无效/, '关卡的无效说明要保留');
  assert.doesNotMatch(superPill.remark, /竞技/);
  assert.match(superPill.remark, /60%/);
  assert.match(superPill.remark, /天梯赛无效/, '天梯赛的无效说明要保留');
  // 说明修正必须落在底层行数组上，重新取值也要能看到（Map#getValue 每次新建对象）
  assert.equal(pill.remark, g.propMap.getValue(7).remark);
  // 重复执行是幂等的，不会把已改好的文案再改坏
  g.GData.applyPropRemarkFixes();
  assert.match(g.propMap.getValue(7).remark, /关卡中无效/);
  assert.equal(g.propMap.getValue(7).remark, pill.remark);
});

test('每日任务：当天固定抽取、进度来真实计数、只能领一次且重载保留', () => {
  const g = game();
  const S = g.State, s = S.state();
  const list = S.questStatus();
  assert.equal(list.length, 4, '每天 4 条');
  const keys = list.map((q) => q.key).join(',');
  for (let i = 0; i < 5; i++) S.questStatus();
  assert.equal(S.questStatus().map((q) => q.key).join(','), keys, '同一天反复读取不会重抽');
  assert.ok(list.every((q) => q.need > 0), '每条都有目标');
  // 奖励构成：金松果 10~30、经验 50~80，外加 1~3 种道具
  for (const q of list) {
    assert.ok(q.gold >= 10 && q.gold <= 30, '金松果 10~30，实际 ' + q.gold);
    assert.ok(q.exp >= 50 && q.exp <= 80, '经验 50~80，实际 ' + q.exp);
    assert.ok(q.extras.length >= 1 && q.extras.length <= 3, '额外道具 1~3 种，实际 ' + q.extras.length);
    const kinds = q.rewards.map((r) => r.kind);
    assert.equal(kinds[0], 'gold'); assert.equal(kinds[1], 'exp');
    assert.ok(q.rewards.every((r) => r.name && r.count > 0), '每种奖励都有名字和数量（不会只剩数字）');
    assert.equal(new Set(q.extras.map((e) => e.id)).size, q.extras.length, '同一单不重复给同一种道具');
  }
  assert.equal(S.questClaimable(), 0, '没做任务时没有可领取');

  // 进度来自当天真实计数
  const target = list[0];
  assert.equal(target.progress, 0);
  S.bumpDaily(target.key, target.need);
  const after = S.questStatus()[0];
  assert.equal(after.progress, target.need);
  assert.equal(after.done, true);
  assert.equal(after.claimable, true);
  assert.equal(S.questClaimable(), 1);

  // 领奖：加金松果与经验，道具也进背包，且不能重复领
  const gold0 = s.goldPoint;
  const props0 = JSON.stringify(s.props);
  const reward = S.claimQuest(0);
  assert.equal(reward.ok, true);
  assert.equal(s.goldPoint, gold0 + target.gold);
  assert.ok(s.exp > 0 || s.level > 1, '经验奖励会结算（可能升级）');
  for (const extra of target.extras) {
    assert.ok(s.props[extra.id] > (JSON.parse(props0)[extra.id] || 0), '道具 ' + extra.id + ' 已入袋');
  }
  assert.equal(S.claimQuest(0).ok, false, '不能重复领取');
  assert.equal(S.questClaimable(), 0);

  // 未完成的任务不能领
  const pending = S.questStatus().find((q) => !q.done);
  if (pending) assert.equal(S.claimQuest(pending.index).ok, false, '未完成不能领');

  // 存档往返保留领取状态与计数
  S.save(); S.load();
  assert.equal(S.questStatus()[0].claimed, true);
  assert.equal(S.questStatus()[0].progress, target.need);

  // 跨天重置：任务与计数一起换新
  g.advance(2 * 24 * 3600 * 1000);
  S.tickEnergy();
  const next = S.questStatus();
  assert.equal(next.length, 4);
  assert.ok(next.every((q) => !q.claimed), '新的一天全部重置');
  assert.ok(next.every((q) => q.progress === 0), '新的一天计数归零');
});

test('挑战经验只看等级差：20 级起单位体力效率反超竞技场，且每级越来越难', () => {
  const g = game();
  const S = g.State;
  // 同级/越级/低级
  for (const lv of [10, 20, 40, 60]) {
    const same = S.challengeExp(lv, lv);
    const up = S.challengeExp(lv + 3, lv);
    const down = S.challengeExp(lv - 3, lv);
    assert.ok(up > same, lv + ' 级打高 3 级应更多：' + up + ' vs ' + same);
    assert.ok(down < same, lv + ' 级打低 3 级应更少：' + down + ' vs ' + same);
  }
  // 等级差倍率与自身等级无关
  const ratioA = S.challengeExp(23, 20) / S.challengeExp(20, 20);
  const ratioB = S.challengeExp(43, 40) / S.challengeExp(40, 40);
  assert.ok(Math.abs(ratioA - ratioB) < 0.02, '等级差倍率应与自身等级无关：' + ratioA.toFixed(3) + ' vs ' + ratioB.toFixed(3));
  // 没有硬上限：经验随等级持续增长
  assert.ok(S.challengeExp(60, 60) > S.challengeExp(20, 20) * 1.5, '不应被压平');
  // 单位体力效率：20 级之前不如竞技场，20 级起反超，而且之后一直保持
  const arenaPerEnergy = S.ARENA_EXP_PER_ENERGY;   // 150/30 = 5
  const perEnergy = (lv) => S.challengeExp(lv, lv) / 10;   // 随机挑战 10 体力一场
  assert.ok(perEnergy(19) <= arenaPerEnergy, '19 级还不该反超：' + perEnergy(19).toFixed(2));
  for (let lv = 20; lv <= 60; lv++) {
    assert.ok(perEnergy(lv) > arenaPerEnergy, lv + ' 级单位体力效率应反超竞技场：' + perEnergy(lv).toFixed(2));
  }
  // 单场经验仍低于竞技场冠军（只看随机挑战实际会遇到的等级差 -1~+3）
  const [dMin, dMax] = S.CHALLENGE_DIFF_RANGE;
  for (let lv = 1; lv <= 60; lv++) {
    for (let d = dMin; d <= dMax; d++) {
      const exp = S.challengeExp(lv + d, lv);
      assert.ok(exp < S.ARENA_CHAMPION_EXP, lv + '级差' + d + ' 的挑战经验 ' + exp + ' 应低于竞技场 ' + S.ARENA_CHAMPION_EXP);
      assert.ok(exp > 0);
    }
  }
  // 每级越来越难：通关一级所需的同级场次单调递增
  let prev = 0;
  for (let lv = 1; lv <= 60; lv++) {
    const fights = S.challengeFightsPerLevel(lv);
    assert.ok(fights > prev, lv + ' 级应比上一级更慢：' + fights.toFixed(1) + ' vs ' + prev.toFixed(1));
    prev = fights;
  }
  // 挑战效率确实提高了：20 级同级明显高于旧公式的 10+20*1.2=34
  assert.ok(S.challengeExp(20, 20) >= 34 * 1.3, '挑战经验效率应提升，实际 ' + S.challengeExp(20, 20));
});

test('升级礼包：每级给消耗品，逢 5 级与属性书等级再给大礼包，并真的进背包', () => {
  const g = game(), S = g.State, s = S.state();
  const before = JSON.parse(JSON.stringify(s.props));
  // 逐级升到 6 级，收集每次升级的礼包
  const all = [];
  s.exp = 0;
  for (let i = 0; i < 60 && s.level < 6; i++) {
    for (const u of S.gainExp(g.GData.nextExp(s.level))) all.push(u);
  }
  assert.equal(s.level, 6, '应升到 6 级，实际 ' + s.level);
  assert.equal(all.length, 5, '升了 5 级就有 5 份礼包，实际 ' + all.length);
  for (const u of all) {
    assert.ok(Array.isArray(u.gifts) && u.gifts.length >= 1, '每级都应有礼包：' + JSON.stringify(u.gifts));
    assert.ok(u.gifts.every((x) => x.id && x.count > 0 && x.name), '礼包项要有 id/数量/名字');
    assert.equal(new Set(u.gifts.map((x) => x.id)).size, u.gifts.length, '同一次礼包不重复同一种道具');
  }
  // 逢 5 级的大礼包明显比普通等级多
  const lv5 = all.find((u) => u.level === 5);
  assert.ok(lv5.gifts.length >= 4, '5 级大礼包应更丰富，实际 ' + lv5.gifts.length);
  // 礼包真的进了背包
  const after = s.props;
  const totalAdded = all.reduce((n, u) => n + u.gifts.reduce((m, x) => m + x.count, 0), 0);
  const delta = Object.keys(after).reduce((n, k) => n + Math.max(0, (after[k] || 0) - (before[k] || 0)), 0);
  assert.ok(delta >= totalAdded, '礼包道具应全部进背包：新增 ' + delta + ' / 礼包 ' + totalAdded);
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS', name); }
  catch (error) { failed++; console.error('FAIL', name, error.stack); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
