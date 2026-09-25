/* Run: node tools/test-points.cjs. 自由属性点（升级自选 + 四项平衡、占比过低系统代选）规则测试。
 * 用真实词典与 state.js，随机源固定，便于复现。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', '..');
const GAIN = { power: 1, agility: 1, speed: 1, hp: 5 };
function setup() {
  const storage = new Map(); let seed = 20260924;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [new Date(2026, 8, 24, 12).getTime()])); } static now() { return new Date(2026, 8, 24, 12).getTime(); } }
  const c = { Date: Clock, location: { search: '?qa=1' }, localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) } };
  c.window = c; vm.createContext(c);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  const math = vm.runInContext('Math', c); math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  c.State.newGame('加点测试');
  return { ...c, storage, math, s: () => c.State.state(), saved: () => JSON.parse(storage.get(c.State.saveKey)) };
}
const tests = [];
const test = (name, run) => tests.push([name, run]);
const total = (s) => s.power + s.agility + s.speed + s.maxHp / 5;
const shares = (s) => { const t = s.power + s.agility + s.speed + s.maxHp / 10; return { power: s.power / t, agility: s.agility / t, speed: s.speed / t, hp: (s.maxHp / 10) / t }; };
const NAMES = { power: '力量', agility: '敏捷', speed: '速度', hp: '生命' };

test('每级升级预算不变：2 点随机 + 1 点自选，自选点要么当场被系统代选、要么等弹窗点掉', () => {
  const g = setup(), s = g.s();
  let pending = 0, auto = 0;
  for (let level = 2; level <= 70; level++) {
    const before = total(s), beforeFree = s.freePoints || 0;
    const ups = g.State.gainExp(g.GData.nextExp(level - 1));
    assert.equal(ups.length, 1);
    const u = ups[0], free = (s.freePoints || 0) - beforeFree;
    if ([53, 59, 65].includes(level)) { assert.equal(free, 0); assert.equal(u.attributeBook, true); continue; }
    assert.equal(total(s) - before + free, 4, '每级仍是 3 点属性 + 生命 5');
    assert.equal(free + (u.autoPoint ? 1 : 0), 1, '自选点只有一个去处');
    if (u.autoPoint) { auto++; assert.equal(u.autoPointName, NAMES[u.autoPoint]); assert.equal(u.freePoint, 0); }
    else { pending++; assert.equal(u.freePoint, 1); }
    // 代选只能落在占比最低且低于门槛的那一项上
    if (u.autoPoint) {
      const sh = shares(s);
      assert.ok(sh[u.autoPoint] >= g.State.STAT_SHARE_MIN - 1e-9, u.autoPoint + ' 补过之后应回到门槛以上：' + JSON.stringify(sh));
    }
  }
  assert.equal(pending + auto, 66, '2~70 级共 69 级，去掉 53/59/65 三次属性书，剩 66 次成长');
  assert.ok(pending > 0 && auto > 0, '两种分支都应该出现过：pending=' + pending + ' auto=' + auto);
});

test('四项占比：低于门槛（20%）必须加那一项，正好等于门槛不算过低', () => {
  const g = setup(), s = g.s();
  // 20/20/20/40 —— 三项正好卡在门槛上
  s.power = 20; s.agility = 20; s.speed = 20; s.maxHp = 400;
  assert.equal(g.State.forcedStat(), null, '正好 20% 不算过低');
  s.power = 19;
  assert.equal(g.State.forcedStat(), 'power');
  s.power = 30; s.agility = 15; s.speed = 30; s.maxHp = 250;
  assert.equal(g.State.forcedStat(), 'agility', '取最低的那一项');
  // 生命也是平衡点：三围高、血量低时会被强制补生命
  s.power = 40; s.agility = 30; s.speed = 25; s.maxHp = 50;
  assert.equal(g.State.forcedStat(), 'hp');
  assert.ok(Math.abs(g.State.statShares().hp - 0.05) < 1e-9);
  // 生命按 10 点 = 1 点属性折算
  s.power = 30; s.agility = 30; s.speed = 30; s.maxHp = 300;
  const sh = g.State.statShares();
  for (const key of ['power', 'agility', 'speed', 'hp']) assert.ok(Math.abs(sh[key] - 0.25) < 1e-9, key + ' 25%');
  assert.equal(g.State.forcedStat(), null);
  // 也接受外部数据对象（genAI 的成长对象用 maxHp 存血）
  assert.equal(g.State.forcedStat({ power: 30, agility: 30, speed: 30, maxHp: 300 }), null);
  assert.equal(g.State.forcedStat({ power: 100, agility: 30, speed: 30, maxHp: 10 }), 'hp');
  assert.equal(g.State.lowestStat({ power: 100, agility: 30, speed: 31, maxHp: 10 }), 'hp');
});

test('分配：四项可选（生命 +5），非法属性/没有点数都拒绝；代选时忽略玩家选择并如实回报', () => {
  const g = setup(), s = g.s();
  assert.equal(g.State.pendingPoints(), 0);
  assert.equal(g.State.allocatePoint('power').ok, false, '没有点数不能分配');
  s.freePoints = 3;
  assert.equal(g.State.allocatePoint('luck').ok, false, '不存在的属性被拒');
  assert.equal(g.State.allocatePoint(undefined).ok, false);
  assert.equal(s.freePoints, 3, '失败的分配不扣点');
  s.power = 30; s.agility = 30; s.speed = 30; s.maxHp = 300;
  const hpBefore = s.maxHp;
  const one = g.State.allocatePoint('hp');
  assert.equal(one.ok, true); assert.equal(one.attr, 'hp'); assert.equal(one.gain, 5);
  assert.equal(s.maxHp, hpBefore + GAIN.hp, '生命一点 = 5 点血');
  assert.equal(s.freePoints, 2);
  // 某一项过低时，点别的项也会被改成补那一项
  s.power = 100; s.agility = 40; s.speed = 40; s.maxHp = 100;
  const before = { ...s };
  const r = g.State.allocatePoint('power');
  assert.equal(r.ok, true); assert.equal(r.attr, 'hp'); assert.equal(r.requested, 'power');
  assert.equal(r.redirected, true, '占比过低时系统代选');
  assert.equal(s.power, before.power, '没有加到玩家点的那一项');
  assert.equal(s.maxHp, before.maxHp + GAIN.hp);
  assert.equal(s.freePoints, 1);
  assert.match(r.msg, /生命/);
  // 四项都达标之后就能自由加了
  s.power = 30; s.agility = 30; s.speed = 30; s.maxHp = 300;
  const free = g.State.allocatePoint('speed');
  assert.equal(free.attr, 'speed'); assert.equal(free.redirected, false); assert.equal(free.forced, false);
  assert.equal(s.speed, 31); assert.equal(s.freePoints, 0);
  assert.equal(g.State.allocatePoint('power').ok, false, '点完了就不能再加');
});

test('平均分配：清空待分配点，四项都不会被压得更偏', () => {
  const g = setup(), s = g.s();
  // 自然成长附近的状态（一键满级攒点后的样子：四项本来就各占约 25%）
  s.power = 23; s.agility = 21; s.speed = 28; s.maxHp = 240; s.freePoints = 30;
  const beforeTotal = total(s), before = shares(s);
  const beforeSpread = Math.max(...Object.values(before)) - Math.min(...Object.values(before));
  const r = g.State.allocateEvenly();
  assert.equal(r.ok, true); assert.equal(r.remaining, 0); assert.equal(g.State.pendingPoints(), 0);
  assert.equal(total(s), beforeTotal + 30, '30 点全部落地（生命按 +5 计）');
  assert.equal(r.added.power + r.added.agility + r.added.speed + r.added.hp, 30);
  const after = shares(s);
  for (const key of ['power', 'agility', 'speed', 'hp']) assert.ok(after[key] > 0.15, key + '=' + after[key].toFixed(3));
  const afterSpread = Math.max(...Object.values(after)) - Math.min(...Object.values(after));
  assert.ok(afterSpread <= beforeSpread + 0.06, '平均分配不会让四项更偏：' + beforeSpread.toFixed(3) + ' → ' + afterSpread.toFixed(3));
  assert.equal(g.State.allocateEvenly().remaining, 0, '没有点时调用是安全的空操作');
});

test('一直堆同一项也会被系统拉回平衡（四项占比收敛，不会永远被强制）', () => {
  const g = setup(), s = g.s();
  for (let lv = 1; lv < 20; lv++) g.State.gainExp(g.GData.nextExp(s.level));
  s.freePoints = 0;
  let forced = 0, manual = 0;
  for (let i = 0; i < 40; i++) {
    const ups = g.State.gainExp(g.GData.nextExp(s.level));
    if (ups[0] && ups[0].autoPoint) { forced++; continue; }
    const r = g.State.allocatePoint('power');       // 玩家一直想加力量
    if (r.redirected) forced++; else manual++;
  }
  const sh = shares(s);
  for (const key of ['power', 'agility', 'speed', 'hp']) {
    assert.ok(sh[key] > 0.15 && sh[key] < 0.40, key + ' 收敛在合理区间：' + sh[key].toFixed(3));
  }
  assert.ok(manual > 0, '玩家的选择仍然生效 ' + manual + ' 次');
  assert.ok(forced > 0 && forced < 40, '过低时会被强制补，但不是每次都强制（强制 ' + forced + '/40）');
});

test('升级时占比过低由系统直接代选（含生命），不再挂起等玩家', () => {
  const g = setup(), s = g.s();
  s.level = 20; s.exp = 0; s.power = 100; s.agility = 40; s.speed = 40; s.maxHp = 100; s.freePoints = 0;
  const ups = g.State.gainExp(g.GData.nextExp(20));
  assert.equal(ups.length, 1);
  assert.equal(ups[0].autoPoint, 'hp', '血量占比过低时由系统补生命');
  assert.equal(ups[0].freePoint, 0);
  assert.equal(s.maxHp, 100 + ups[0].hp + GAIN.hp, '代选的生命已经进属性（另有本次随机成长的血量）');
  assert.equal(s.freePoints, 0, '代选的点不会挂在待分配里');
  // 四项均衡时正常挂起，等升级弹窗点掉
  s.power = 30; s.agility = 30; s.speed = 30; s.maxHp = 300;
  const ups2 = g.State.gainExp(g.GData.nextExp(s.level));
  assert.equal(ups2[0].autoPoint, null);
  assert.equal(ups2[0].freePoint, 1);
  assert.equal(s.freePoints, 1);
});

test('自由属性点存进存档、读档保留，旧存档按 0 补全', () => {
  const g = setup(), s = g.s();
  s.freePoints = 4; g.State.save();
  assert.equal(g.saved().freePoints, 4);
  g.State.load();
  assert.equal(g.s().freePoints, 4);
  const legacy = { ...g.s() }; delete legacy.freePoints;
  g.storage.set(g.State.saveKey, JSON.stringify(legacy));
  g.State.load();
  assert.equal(g.s().freePoints, 0, '旧档没有这个字段也不该报错');
  assert.equal(g.State.pendingPoints(), 0);
  // 转生不清空待分配点（点数已经发下来了）
  const s2 = g.s(); s2.level = 20; s2.freePoints = 3; s2.props[13] = 1;
  assert.equal(g.State.useProp(13).ok, true);
  assert.equal(g.s().freePoints, 3);
});

test('对手（genAI）与玩家共用同一套成长预算、四项口径与占比门槛', () => {
  const g = setup();
  for (const level of [5, 10, 15, 20, 25, 40, 53, 70]) {
    for (let i = 0; i < 30; i++) {
      const foe = g.State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true, gear: false });
      const books = [53, 59, 65].filter((lv) => lv <= level).length;
      assert.equal(foe.baseStats.power + foe.baseStats.agility + foe.baseStats.speed + foe.baseStats.hp / 5,
        22 + (level - 1) * 4 + books * 4, '等级 ' + level);
      assert.equal(foe.baseStats.hp % 5, 0);
      const b = foe.baseStats;
      const t = b.power + b.agility + b.speed + b.hp / 10;
      const sh = { power: b.power / t, agility: b.agility / t, speed: b.speed / t, hp: (b.hp / 10) / t };
      const sum = sh.power + sh.agility + sh.speed + sh.hp;
      assert.ok(Math.abs(sum - 1) < 1e-9, '四项占比相加为 1');
      // 自然成长下四项都在门槛附近，不会有某一项被彻底饿着
      for (const key of ['power', 'agility', 'speed', 'hp']) assert.ok(sh[key] > 0.15, '等级 ' + level + ' ' + key + '=' + sh[key].toFixed(3));
    }
  }
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS', name); }
  catch (error) { failed++; console.error('FAIL', name, error.stack); }
}
console.log(`${tests.length - failed}/${tests.length} free point tests passed`);
process.exitCode = failed ? 1 : 0;
