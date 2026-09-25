/* Run with: node tools/test-state.cjs. Uses the original dictionary and isolated saves. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
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

test('单个道具数量上限 9999：存档收口、读档也会夹住', () => {
  const g = game(), S = g.State, s = S.state();
  assert.equal(S.PROP_HARD_CAP, 9999);
  // 内存里加爆也会在 save() 时收口
  s.props[1] = 99999; s.props[2] = 9999; s.props[23] = 10000;
  S.save();
  assert.equal(s.props[1], 9999);
  assert.equal(s.props[2], 9999);
  assert.equal(s.props[23], 9999);
  assert.equal(JSON.parse(g.storage.get(S.saveKey)).props[1], 9999);
  // 负数与非数字会被清掉，不会写进存档
  s.props[24] = -5; s.props[25] = 'abc';
  S.save();
  assert.equal(s.props[24], undefined);
  assert.equal(s.props[25], undefined);
  // 旧档里超上限的数量在 normalizeSave 时也会被夹住
  g.storage.set(S.saveKey, JSON.stringify({ level: 5, props: { 1: 50000, 26: 12 } }));
  S.load();
  const loaded = S.state();
  assert.equal(loaded.props[1], 9999);
  assert.equal(loaded.props[26], 12);
  // 未到上限的正常数量原样保留
  assert.equal(loaded.props[1] + loaded.props[26], 10011);
});

test('卖出道具：默认回收字典价格的一半，无价/占位价的道具不开放回收', () => {
  const g = game(), S = g.State, s = S.state();
  // 商店里买得到的：半价（向下取整）
  assert.equal(S.propSellPrice(1), 1, '小体力药剂 3 → 1');
  assert.equal(S.propSellPrice(2), 2, '大体力药剂 5 → 2');
  assert.equal(S.propSellPrice(3), 10, '大力丸 20 → 10');
  assert.equal(S.propSellPrice(23), 10, '挑战书 20 → 10');
  assert.equal(S.propSellPrice(13), 150, '转生果 300 → 150');
  assert.equal(S.propSellPrice(47), 100, '天使果实 200 → 100（旧规则就是这个价）');
  assert.equal(S.propSellPrice(37), 500, '属性书 1000 → 500');
  assert.equal(S.propSellPrice(101), 10, '宝石 20 → 10');
  // 字典里 price 为 0 或占位 1 的（卷轴/碎片/礼包/天梯碎片/种子/超级药丸/恶魔果实）不开放回收
  for (const id of [6, 9, 16, 21, 22, 24, 25, 26, 28, 32, 40, 41, 44, 45, 46, 48, 49, 50, 51]) {
    assert.equal(S.propSellPrice(id), 0, id + ' 不该可卖');
  }
  assert.equal(S.sellProp(46, 1).ok, false, '不能卖的道具会被拒');
  const ids = S.sellableProps();
  assert.ok(ids.includes(47) && ids.includes(2) && ids.includes(101), '可卖清单含药水/果实/宝石');
  assert.ok(ids.length >= 20, '大部分标了价的道具都能卖：' + ids.length + ' 种');
  assert.ok(ids.every((id) => S.propSellPrice(id) > 0));
  // 结算：数量与金松果一起走，超过持有会被夹住，卖光后键被删掉
  assert.equal(S.sellProp(47, 3).ok, false, '背包里没有就不给卖');
  s.props[47] = 5; s.goldPoint = 10;
  const r = S.sellProp(47, 2);
  assert.equal(r.ok, true); assert.equal(r.sold, 2); assert.equal(r.gold, 200);
  assert.equal(s.props[47], 3); assert.equal(s.goldPoint, 210);
  const all = S.sellProp(47, 99);
  assert.equal(all.sold, 3); assert.equal(s.props[47], undefined); assert.equal(s.goldPoint, 510);
  assert.equal(S.sellProp(47, 1).ok, false);
  assert.equal(JSON.parse(g.storage.get(S.saveKey)).props[47], undefined);
  // 药水按半价卖
  s.props[1] = 4; s.goldPoint = 0;
  const small = S.sellProp(1, 4);
  assert.equal(small.gold, 4); assert.equal(s.goldPoint, 4); assert.equal(s.props[1], undefined);
});

test('调试用武技接口：获得/改等级/遗忘，等级夹在 1~15 且不重复', () => {
  const g = game(), S = g.State, s = S.state();
  assert.ok(S.weaponList().length > 0 && S.skillList().length > 0, '武器与技能表都读得到');
  const w = S.weaponList()[0], k = S.skillList()[0];
  const got = S.setWeapon(w.id, 7);
  assert.equal(got.ok, true); assert.equal(got.level, 7);
  assert.equal(s.weapons.includes(w.id + ':7'), true);
  S.setWeapon(w.id, 12);
  assert.equal(s.weapons.filter((x) => Number(String(x).split(':')[0]) === w.id).length, 1, '不会重复添加');
  assert.equal(s.weapons.includes(w.id + ':12'), true);
  assert.equal(S.setWeapon(w.id, 99).level, 15, '等级上限 15');
  assert.equal(S.setSkill(k.id, 0).level, 1, '等级下限 1');
  assert.equal(S.forgetWeapon(w.id).ok, true);
  assert.equal(s.weapons.some((x) => Number(String(x).split(':')[0]) === w.id), false);
  assert.equal(S.forgetWeapon(w.id).ok, false, '遗忘两次第二次失败');
  assert.equal(S.forgetSkill(k.id).ok, true);
  assert.equal(S.setSkill(9999, 1).ok, false);
});

test('满级 70 级：经验不再升级，69 级 179、满级 180 体力上限', () => {
  const g = game(), S = g.State, s = S.state();
  assert.equal(S.MAX_PLAYER_LEVEL, 70);
  assert.equal(S.energyCapForLevel(1), 90);
  assert.equal(S.energyCapForLevel(2), 93);
  assert.equal(S.energyCapForLevel(10), 110);
  assert.equal(S.energyCapForLevel(20), 130);
  assert.equal(S.energyCapForLevel(30), 140);
  assert.equal(S.energyCapForLevel(69), 179);
  assert.equal(S.energyCapForLevel(70), 180);
  // 低等级段确实比以前低（旧曲线 10 级 117 / 20 级 137）
  assert.ok(S.energyCapForLevel(10) < 117 && S.energyCapForLevel(20) < 137, '低等级体力上限下调');
  // 一路喂经验到满级后不再升级
  s.exp = 0; S.gainExp(1e9);
  assert.equal(s.level, 70, '满级封顶');
  assert.equal(s.maxEnergy, 180, '满级体力上限 180');
  S.save(); S.load();
  assert.equal(S.state().level, 70); assert.equal(S.state().maxEnergy, 180);
  // 旧档（旧成长曲线算出的更高上限）读档时被收回；超过 70 级的等级也压回 70
  g.storage.set(S.saveKey, JSON.stringify({ level: 70, maxEnergy: 999, props: {} }));
  S.load();
  assert.equal(S.state().maxEnergy, 180);
  g.storage.set(S.saveKey, JSON.stringify({ level: 99, maxEnergy: 300, props: {} }));
  S.load();
  assert.equal(S.state().level, 70);
  assert.equal(S.state().maxEnergy, 180);
});

test('好友系统：随机 NPC 也能加为好友，重名/满员有提示，删除与存档往返正常', () => {
  const g = game(), S = g.State;
  assert.equal(S.friendLimit(), 20);
  assert.equal(S.friendList().length, 0);
  const cands = S.rollFriendCandidates(3);
  assert.equal(cands.length, 3);
  assert.ok(cands.every((c) => c.level >= 1 && c.level <= S.MAX_PLAYER_LEVEL), '推荐等级不超过满级');
  const first = S.addFriend(cands[0]);
  assert.equal(first.ok, true); assert.equal(S.friendList().length, 1);
  assert.equal(S.friendList()[0].name, cands[0].name);
  assert.equal(S.addFriend(cands[0]).ok, false, '同名不能重复加');
  assert.equal(S.addFriend({ name: '   ' }).ok, false, '空名字不给加');
  assert.equal(S.addFriend({ name: '超长名字'.repeat(8), level: 3 }).ok, true, '超长名字会被截断');
  assert.ok(S.friendList()[1].name.length <= 20);
  for (let i = 0; i < 25; i++) S.addFriend({ name: '路人' + i, level: 3 + i, power: 5, agility: 5, speed: 5, hp: 40 });
  assert.equal(S.friendList().length, 20, '好友上限 20');
  assert.match(S.addFriend({ name: '再来一个' }).msg, /好友已满/);
  // 切磋用的对手对象
  const foe = S.friendFoe(S.friendList()[0]);
  assert.equal(foe.name, S.friendList()[0].name);
  assert.equal(foe.level, S.friendList()[0].level);
  assert.equal(foe.hp, S.friendList()[0].hp);
  // 存档往返：好友与等级都保留，超过满级的旧好友被压回
  S.save();
  g.storage.set(S.saveKey, JSON.stringify(Object.assign(JSON.parse(g.storage.get(S.saveKey)), {
    friends: [{ name: '老友', level: 99, power: 9, agility: 9, speed: 9, hp: 90 }],
  })));
  S.load();
  assert.equal(S.friendList().length, 1);
  assert.equal(S.friendList()[0].level, S.MAX_PLAYER_LEVEL, '好友等级不超过满级');
  assert.equal(S.removeFriend('老友').ok, true);
  assert.equal(S.friendList().length, 0);
  assert.equal(S.removeFriend('老友').ok, false);
});

test('每日任务种类够多（16 种挑 4 条），计数器覆盖全部任务', () => {
  const g = game(), S = g.State, s = S.state();
  assert.equal(S.QUEST_TYPES.length, 16, '16 种任务');
  const keys = S.QUEST_TYPES.map((t) => t.key);
  assert.equal(new Set(keys).size, 16, 'key 不重复');
  const list = S.questStatus();
  assert.equal(list.length, 4, '每天 4 条');
  assert.equal(new Set(list.map((q) => q.key)).size, 4, '同一天不重复抽同一种');
  for (const key of keys) assert.ok(key in s.dailyCounters, '计数器覆盖 ' + key);
  for (const q of list) assert.ok(q.need > 0 && q.name && !q.name.includes('{n}'), '任务文案要填好目标：' + q.name);
});

test('每日任务计数：合成/融合装备、宝石、使用/购买/卖出道具、拾取、天梯/切磋/挑战', () => {
  const g = game(), S = g.State, s = S.state();
  S.questStatus();   // 建好当天的计数器
  const c = (key) => s.dailyCounters[key] || 0;
  // 碎片合成装备 → merge
  s.props[24] = 20; s.goldPoint = 1000;
  assert.equal(S.composeGear(24).ok, true);
  assert.equal(c('merge'), 1, '碎片合成装备要计入 merge');
  // 3 件同名装备融合 → merge
  const trio = [S.addGear(21), S.addGear(21), S.addGear(21)];
  s.goldPoint = 1000;
  assert.equal(S.mergeGears(trio.map((x) => x.key)).ok, true);
  assert.equal(c('merge'), 2, '装备融合也要计入 merge');
  // 宝石合成 → gem
  s.props[101] = 3; s.goldPoint = 1000;
  S.mergeGems(101);
  assert.equal(c('gem'), 1);
  // 使用道具 → use
  s.props[1] = 3;
  S.useProp(1);
  assert.equal(c('use'), 1);
  // 商店购买 → buy
  s.goldPoint = 1000;
  S.buyProp(1, 2);
  assert.equal(c('buy'), 2);
  // 卖出天使果实 → sell
  s.props[47] = 3;
  S.sellProp(47, 2);
  assert.equal(c('sell'), 2);
  // 战斗类型 → challenge / rank / spar（另加 fight/win）
  const entry = (kind) => ({ me: { name: '我' }, foe: { name: '敌' }, kind, region: 0,
    result: { winner: 0, rounds: [{ attacker: 0, hpAfter: [10, 0] }], maxHp: [40, 40] } });
  assert.ok(S.recordBattle(entry('challenge')));
  assert.ok(S.recordBattle(entry('rank')));
  assert.ok(S.recordBattle(entry('friend')));
  assert.equal(c('challenge'), 1);
  assert.equal(c('rank'), 1);
  assert.equal(c('spar'), 1);
  assert.equal(c('fight'), 3);
  assert.equal(c('win'), 3);
  // 过关胜利只算 stage
  assert.ok(S.recordBattle(entry('stage')));
  assert.equal(c('stage'), 1);
  assert.equal(c('challenge'), 1, '关卡胜利不该算成随机挑战');
});

test('货币类编号（8 金松果 / 15 经验 / 40 金杯）不会留在背包里', () => {
  const g = game(), S = g.State;
  // 旧档里被调试面板当道具发过的货币，读档时清掉
  g.storage.set(S.saveKey, JSON.stringify({ level: 5, goldPoint: 100, goldCup: 0, props: { 8: 999, 15: 50, 40: 12, 1: 7 } }));
  S.load();
  const s = S.state();
  assert.equal(s.props[8], undefined, '金松果不进背包');
  assert.equal(s.props[15], undefined, '经验不进背包');
  assert.equal(s.props[40], undefined, '金杯不进背包');
  assert.equal(s.props[1], 7, '真正的道具照常保留');
  // 存回去也不会再写进 props
  S.save();
  const saved = JSON.parse(g.storage.get(S.saveKey));
  assert.equal(saved.props[8], undefined);
  assert.ok(saved.props[1] >= 7);
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

test('1/5/10/15/20 级礼包：金松果回到旧版数量，种类更丰富且不重复发放', () => {
  const g = game(), s = g.State.state();
  // 原表（GameDict）保持逐字节不动，实际清单在 GData.GIFT_PACK_BOOST 里
  assert.equal(g.giftMap.getValue(28).prize, '29:1|8:50|2:3|1:5');
  const oldGold = { 28: 50, 29: 50, 30: 100, 31: 150, 32: 200 };
  for (const id of [28, 29, 30, 31, 32]) {
    const boost = g.GData.giftPackPrize(id);
    const rows = g.giftMap.getValue(id).prize.split('|').map((item) => item.split(':').map(Number));
    assert.ok(boost && boost.length, id + ' 级礼包有清单');
    // 金松果用旧版数量
    assert.equal((boost.find((b) => b.id === 8) || {}).count, oldGold[id], id + ' 级礼包金松果回到旧版');
    // 大小体力药剂都给，但都不多
    const small = (boost.find((b) => b.id === 1) || {}).count || 0;
    const big = (boost.find((b) => b.id === 2) || {}).count || 0;
    assert.ok(small >= 1 && small <= 5, id + ' 小体力药剂数量适中：' + small);
    assert.ok(big >= 1 && big <= 3, id + ' 大体力药剂数量适中：' + big);
    // 链式礼包（下一级的礼包）仍然保留
    const chain = rows.find(([pid]) => pid >= 29 && pid <= 32);
    if (chain) assert.ok(boost.some((b) => b.id === chain[0] && b.count === chain[1]), id + ' 的下一级礼包仍要保留');
    // 种类要丰富：至少还有一个药丸或卷轴
    assert.ok(boost.some((b) => [21, 22, 7, 44].includes(b.id)), id + ' 级礼包应有卷轴/药丸之类的额外奖励');
  }
  // 20 级礼包 30 片蓝色碎片
  assert.equal(g.GData.giftPackPrize(32).find((b) => b.id === 26).count, 30);
  assert.equal(g.State.useProp(28).ok, true);
  assert.equal(s.goldPoint, 100 + oldGold[28]); assert.equal(s.props[29], 1);
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
  // 奖励：纯随机 1~2 项，金松果/经验/道具都在同一个池子里抽，抽到才有
  const seenKinds = new Set();
  for (const q of list) {
    assert.ok(q.rewards.length >= 1 && q.rewards.length <= 2, '每条 1~2 项奖励，实际 ' + q.rewards.length);
    assert.ok(q.rewards.every((r) => r.name && r.count > 0), '每种奖励都有名字和数量（不会只剩数字）');
    for (const r of q.rewards) {
      seenKinds.add(r.kind);
      if (r.kind === 'gold') assert.ok(r.count >= 10 && r.count <= 30, '金松果 10~30，实际 ' + r.count);
      if (r.kind === 'exp') assert.ok(r.count >= 50 && r.count <= 80, '经验 50~80，实际 ' + r.count);
      // 药丸一次只能给 1 个
      if (r.kind === 'prop' && [3, 4, 5, 7, 44].includes(r.id)) assert.equal(r.count, 1, '药丸数量必须是 1，实际 ' + r.count);
    }
    // 金松果与经验不是固定奖励：没有就是没有
    assert.equal(q.gold, (q.rewards.find((r) => r.kind === 'gold') || { count: 0 }).count);
    assert.equal(q.exp, (q.rewards.find((r) => r.kind === 'exp') || { count: 0 }).count);
  }
  // 池子里金松果与经验都只是候选，不再保证出现
  assert.ok(S.QUEST_GOLD && S.QUEST_GOLD.kind === 'gold' && S.QUEST_EXP && S.QUEST_EXP.kind === 'exp');
  // 高级药丸（超级经验丸 44）概率大幅下调：权重最低，实际概率只有百分之几
  {
    const pool = S.QUEST_EXTRA_POOL;
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    const superPill = pool.find((item) => item.id === 44);
    const best = Math.max(...pool.map((item) => item.weight));
    assert.ok(superPill && superPill.weight === Math.min(...pool.map((item) => item.weight)), '超级经验丸权重应最低');
    const chance = superPill.weight / total;
    assert.ok(chance < 0.05, '超级经验丸概率应低于 5%，实际 ' + (chance * 100).toFixed(1) + '%');
    assert.ok(chance < best / total / 5, '应明显低于最高权重的奖励');
    // 药丸数量固定 1（池子里就不能是区间）
    for (const item of pool) if ([3, 4, 5, 7, 44].includes(item.id)) {
      assert.equal(item.range[0], 1, '药丸数量应为 1：id ' + item.id);
      assert.equal(item.range[1], 1, '药丸数量应为 1：id ' + item.id);
    }
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

  // 领奖：每条任务按它自己的奖励结算，且不能重复领
  const gold0 = s.goldPoint;
  const props0 = JSON.parse(JSON.stringify(s.props));
  const reward = S.claimQuest(0);
  assert.equal(reward.ok, true);
  assert.equal(s.goldPoint, gold0 + target.gold);
  assert.ok(target.exp === 0 || s.exp > 0 || s.level > 1, '有经验奖励就会结算（可能升级）');
  for (const r of target.rewards) {
    if (r.kind === 'prop') assert.ok(s.props[r.id] > (props0[r.id] || 0), '道具 ' + r.id + ' 已入袋');
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

test('挑战经验只看等级差：等级成长 20 级封顶、单位体力效率略低于竞技场，且每级越来越难', () => {
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
  // 20 级封顶：之后单场经验不再随等级增长，但 20 级之前仍在慢慢涨
  assert.equal(S.challengeExp(60, 60), S.challengeExp(20, 20), '20 级之后应封顶');
  assert.equal(S.challengeExp(40, 40), S.challengeExp(20, 20), '20 级之后应封顶');
  assert.ok(S.challengeExp(19, 19) < S.challengeExp(20, 20), '20 级之前仍应增长');
  assert.ok(S.challengeExp(2, 2) < S.challengeExp(19, 19), '等级越高经验越多（封顶前）');
  // 单位体力效率：任何等级都不超过竞技场（150/30 = 5.0），挑战不再是刷经验的最优解
  const arenaPerEnergy = S.ARENA_EXP_PER_ENERGY;
  const perEnergy = (foeLevel, myLevel) => S.challengeExp(foeLevel, myLevel) / 10;   // 随机挑战 10 体力一场
  const [dMin, dMax] = S.CHALLENGE_DIFF_RANGE;
  for (let lv = 1; lv <= 60; lv++) {
    for (let d = dMin; d <= dMax; d++) {
      const exp = S.challengeExp(lv + d, lv);
      assert.ok(exp > 0, lv + '级差' + d + ' 经验应为正');
      assert.ok(exp / 10 <= arenaPerEnergy, lv + '级差' + d + ' 的挑战效率 ' + (exp / 10).toFixed(2) + ' 不应超过竞技场');
    }
  }
  // 封顶 + 最大等级差时略低于竞技场（同一体力口径），但不是低一大截
  const capMax = perEnergy(20 + dMax, 20), capSame = perEnergy(20, 20);
  assert.ok(capMax < arenaPerEnergy, '封顶最大等级差应略低于竞技场：' + capMax.toFixed(2));
  assert.ok(capMax > arenaPerEnergy * 0.88, '不应低太多：' + capMax.toFixed(2));
  assert.ok(capSame < arenaPerEnergy);
  // 每级越来越难：通关一级所需的同级场次单调递增
  let prev = 0;
  for (let lv = 1; lv <= 60; lv++) {
    const fights = S.challengeFightsPerLevel(lv);
    assert.ok(fights > prev, lv + ' 级应比上一级更慢：' + fights.toFixed(1) + ' vs ' + prev.toFixed(1));
    prev = fights;
  }
  // 与旧公式（27 + 等级×1.2）相比确实下调了
  assert.ok(S.challengeExp(20, 20) < 27 + 20 * 1.2, '20 级同级应低于旧公式，实际 ' + S.challengeExp(20, 20));
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
