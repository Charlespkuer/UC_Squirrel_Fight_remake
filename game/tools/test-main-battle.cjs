/* Run: node tools/test-main-battle.cjs. Node built-ins only.
 * Real Main/State/GData/original dictionaries with an inert DOM and Battle
 * transport. We control completion callbacks to check ownership, replay
 * isolation and duplicate settlement without relying on animation timing.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const normalSave = JSON.stringify({ name: '正式账号哨兵', level: 34, goldPoint: 9999 });
const clone = (value) => JSON.parse(JSON.stringify(value));
function setup() {
  const storage = new Map([['ssdz_save_v1', normalSave], ['ssdz_music_muted', '1']]);
  const battles = [], summaries = [], toasts = [], renders = [];
  const ctx = { setTransform() {}, drawImage() {}, fillRect() {} };
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx, addEventListener() {} };
  const ui = { innerHTML: '', style: { setProperty() {} } };
  let autoComplete = false;
  const c = {
    console, innerWidth:1170, innerHeight:690, location: { search: '?qa=1' }, performance: { now: () => 0 },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {},
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: (selector) => selector === '#stage' ? canvas : selector === '#ui' ? ui : null },
    Engine: {
      makePlayer: () => ({ list: [] }), hasAnim: () => false, playAnim: () => ({}),
      wearsFor: () => [], updatePlayer() {}, drawPlayer() {},
    },
    UI: {
      renderHome: () => renders.push('home'), drawHomeHud: () => [], toast: (text) => toasts.push(text),
      classic: { pickupResult: (loot) => summaries.push(clone(loot)) },
    },
    QA_FIXTURE: { dropRandom: () => 0.25 },
    Battle: { async run(options) {
      battles.push(options);
      if (autoComplete) options.onEnd(0, resultFor(options), { items: [], ups: [] });
      return { cancel() {} };
    } },
  };
  c.window = c;
  vm.createContext(c);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js', 'js/main.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  }
  c.State.newGame('QA旧账号');
  return { c, storage, battles, summaries, toasts, renders, s: () => c.State.state(),
    auto: () => { autoComplete = true; },
    end(index = battles.length - 1, loot = { items: [], ups: [] }) {
      const battle = battles[index]; battle.onEnd(0, resultFor(battle), loot);
    },
  };
}
function foe() { return { name: '对手', level: 1, hp: 30, power: 5, agility: 5, speed: 5, weapons: [], skills: [] }; }
function resultFor(options) {
  return { winner: 0, maxHp: [options.me.hp, options.foe.hp], names: [options.me.name, options.foe.name],
    rounds: [{ attacker: 0, action: 'common', dmg: options.foe.hp, hpAfter: [options.me.hp, 0] }] };
}
function replayEntry(g) {
  const me = { ...foe(), name: g.s().name };
  return { me, foe: foe(), region: 3, result: resultFor({ me, foe: foe() }) };
}
const tests = [];
const test = (name, run) => tests.push([name, run]);

test('实时战斗开启拾取，传递独立随机源、裸属性和真实师父等级', async () => {
  const g = setup(), s = g.s();
  s.skills = ['1:10']; s.propsStates[3] = 20; s.master = { name: '师父', level: 33 };
  const energy = s.energy;
  await g.c.Main.startBattle(foe(), { cost: 10, region: 3 });
  const battle = g.battles[0];
  assert.equal(battle.collectDrops, true);
  assert.equal(battle.dropRandom, g.c.QA_FIXTURE.dropRandom);
  assert.deepEqual(clone(battle.me.baseStats), { power: s.power, agility: s.agility, speed: s.speed });
  assert.ok(battle.me.power > battle.me.baseStats.power);
  assert.equal(battle.me.masterLevel, 33);
  assert.equal(s.energy, energy - 10);
  g.end();
});

test('关卡连战入场按比例扣血，但生命上限保持不变', async () => {
  const g = setup(), s = g.s();
  s.power = 40; s.agility = 40; s.speed = 40; s.maxHp = 1000;
  const full = g.c.State.totalStats({ useProps: false }).hp;
  await g.c.Main.startBattle(foe(), { hpRatio: 0.65, useProps: false });
  const me = g.battles.at(-1).me;
  assert.equal(me.maxHp, full, '入场后生命上限仍是满血值');
  assert.equal(me.hp, Math.round(full * 0.65), '当前血量按 65% 继承');
  assert.ok(me.hp < me.maxHp, '残血入场不能被当成满血');
  g.end();
});

test('战斗进行中不重复扣体力或启动另一战，明确关闭拾取有效', async () => {
  const g = setup(), energy = g.s().energy;
  await g.c.Main.startBattle(foe(), { cost: 10, collectDrops: false });
  await g.c.Main.startBattle(foe(), { cost: 10 });
  assert.equal(g.battles.length, 1);
  assert.equal(g.s().energy, energy - 10);
  assert.equal(g.battles[0].collectDrops, false);
  g.end();
});

test('实时结算保存一份战报、发一次战果，并传递一次掉落汇总', async () => {
  const g = setup(); let finished = 0;
  await g.c.Main.startBattle(foe(), { kind: 'challenge', onEnd: () => { finished++; g.c.State.fightReward(true); } });
  const loot = { items: [{ id: 8, name: '金松果', count: 2 }], ups: [] };
  // Pickups already award their resources in BattleDrops; Main only reports it.
  g.s().goldPoint += 2;
  g.end(0, loot);
  const saved = JSON.stringify(g.s());
  g.end(0, loot); g.battles[0].onError();
  assert.equal(finished, 1); assert.equal(g.s().battles.length, 1);
  assert.equal(g.summaries.length, 1); assert.deepEqual(g.summaries[0], loot);
  assert.equal(JSON.stringify(g.s()), saved);
  assert.equal(g.toasts.length, 0, '结算后的延迟错误不能覆盖正常结果');
});

test('QA战斗结算不读写正式存档', async () => {
  const g = setup();
  await g.c.Main.startBattle(foe(), { cost: 10, onEnd: () => g.c.State.fightReward(true) });
  g.end();
  assert.equal(g.storage.get('ssdz_save_v1'), normalSave);
  const qa = JSON.parse(g.storage.get('ssdz_test_save_v1'));
  assert.equal(qa.name, 'QA旧账号'); assert.equal(qa.battles.length, 1);
  // 1 级一场挑战经验约 20 点，正好够升到 2 级（升级后 exp 会归零），两种结果都算发了奖
  assert.ok(qa.exp > 0 || qa.level > 1, 'QA 存档确实拿到经验：exp=' + qa.exp + ' level=' + qa.level);
});

test('重置账号后旧onEnd不发经验、掉落汇总或战报', async () => {
  const g = setup(); let finished = 0;
  await g.c.Main.startBattle(foe(), { onEnd: () => { finished++; g.c.State.fightReward(true); } });
  g.c.State.newGame('QA新账号');
  const before = JSON.stringify(g.s());
  g.end(0, { items: [{ id: 8, name: '金松果', count: 2 }], ups: [] }); g.end(0);
  assert.equal(JSON.stringify(g.s()), before);
  assert.equal(finished, 0); assert.equal(g.summaries.length, 0); assert.equal(g.s().battles.length, 0);
  assert.equal(g.storage.get('ssdz_save_v1'), normalSave);
});

test('同名账号重载也按owner隔离，旧错误回调不影响新账号', async () => {
  const g = setup(); let errors = 0;
  await g.c.Main.startBattle(foe(), { onError: () => errors++ });
  const old = g.s(); g.c.State.load(); assert.notEqual(g.s(), old);
  const before = JSON.stringify(g.s());
  g.battles[0].onError(); g.end(0);
  assert.equal(JSON.stringify(g.s()), before); assert.equal(errors, 0); assert.equal(g.toasts.length, 0);
});

test('录像显式关闭拾取，不扣体力不发奖励不再存战报', async () => {
  const g = setup(), entry = replayEntry(g), before = JSON.stringify(g.s()); let finished = 0;
  entry.result.pickups = [{ id: 8, name: '金松果', count: 2 }];
  await g.c.Main.replayBattle(entry, () => finished++);
  assert.equal(g.battles[0].collectDrops, false);
  assert.equal(g.battles[0].result, entry.result);
  g.end(0); g.end(0); g.battles[0].onError();
  assert.equal(finished, 1); assert.equal(JSON.stringify(g.s()), before);
  assert.equal(g.summaries.length, 0); assert.equal(g.toasts.length, 0);
  assert.equal(g.storage.get('ssdz_save_v1'), normalSave);
});

test('回放期间换档后不调用旧页面的完成回调', async () => {
  const g = setup(); let finished = 0;
  await g.c.Main.replayBattle(replayEntry(g), () => finished++);
  g.c.State.newGame('新账号'); const before = JSON.stringify(g.s());
  g.end(0); g.battles[0].onError();
  assert.equal(finished, 0); assert.equal(JSON.stringify(g.s()), before);
});

test('错误先到达时只处理中断一次，迟到onEnd不会发奖', async () => {
  const g = setup(); let finished = 0, errors = 0;
  await g.c.Main.startBattle(foe(), { onEnd: () => { finished++; g.c.State.fightReward(true); }, onError: () => errors++ });
  const before = JSON.stringify(g.s());
  g.battles[0].onError(); g.battles[0].onError(); g.end(0);
  assert.equal(errors, 1); assert.equal(finished, 0); assert.equal(g.toasts.length, 1);
  assert.equal(g.summaries.length, 0); assert.equal(JSON.stringify(g.s()), before);
  await g.c.Main.startBattle(foe()); assert.equal(g.battles.length, 2); g.end(1);
});

test('同步完成回调不会让启动状态卡在战斗中', async () => {
  const g = setup(); g.auto(); let finished = 0;
  await g.c.Main.startBattle(foe(), { onEnd: () => finished++ });
  await g.c.Main.startBattle(foe(), { onEnd: () => finished++ });
  assert.equal(finished, 2); assert.equal(g.battles.length, 2); assert.equal(g.s().battles.length, 2);
});

(async () => {
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name, error); }
  }
  console.log((tests.length - failed) + '/' + tests.length + ' Main battle integration checks passed');
  if (failed) process.exitCode = 1;
})();
