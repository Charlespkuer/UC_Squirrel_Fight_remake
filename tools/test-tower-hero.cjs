#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
// Same dependency order as scripts/index.html; no rendering or browser bootstrap.
const LOAD = ['js/gamedict.js', 'js/engine.js', 'js/gamedata.js', 'js/tower-data.js',
  'js/state.js', 'js/sim.js', 'js/tower-hero.js', 'js/tower.js', 'js/battle-drops.js'];
const PICKS = [{ kind: 'weapon', id: 1 }, { kind: 'skill', id: 7 }, { kind: 'skill', id: 9 }];
const plain = value => JSON.parse(JSON.stringify(value));
const count = hero => hero.weapons.length + hero.skills.length;

function setup(store = new Map(), reload = false) {
  const c = { console, location: { search: '?qa=1' }, localStorage: {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, value) => store.set(k, String(value)), removeItem: k => store.delete(k),
  } };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const file of LOAD) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), c, { filename: file });
  // Explicit fixed stream: avoid unrelated rare shops and random events in lifecycle cases.
  vm.runInContext('Math.random = () => 0.99;', c);
  if (reload) assert.equal(c.State.load(), true, '应当读回测试存档');
  else {
    c.State.newGame('英雄回归');
    const s = c.State.state(); s.level = 90;
    for (let id = 1; id <= 36; id++) s.stages[id] = { npcIndex: 3, passed: true };
  }
  return { c, store };
}
function start(c, hero = true) {
  const options = hero ? { ruleset: 'hero', hero: { picks: PICKS, appearance: [{ id: 203, ext: [] }] } } : undefined;
  const result = c.Tower.startEndlessRun(options);
  assert.equal(result.ok, true, result.msg);
  c.Tower.setStoryEnabled(false);
  c.Tower._debugSetNoFlowBuffs(true);
  if (hero) {
    for (let n = 0; n < 20; n++) {
      const event = c.Tower.heroEventInfo();
      if (!event) break;
      assert.equal(c.Tower.resolveHeroEvent(event.choices[0].id).ok, true);
    }
    assert.equal(c.Tower.heroEventInfo(), null);
  }
  return c.Tower._debugRun('endless');
}
function profile(c) {
  const result = c.TowerHero.create({ picks: PICKS });
  assert.equal(result.ok, true, result.msg);
  return result.hero;
}

test('英雄只带所选的三个5级武技和外观，账号成长与消耗品不进入战斗', () => {
  const { c } = setup(), s = c.State.state();
  Object.assign(s, { power: 5000, agility: 4000, speed: 3000, maxHp: 8000,
    weapons: ['2:15'], skills: ['1:15'], gears: [{ key: 'account', id: 207, used: true, ext: [] }] });
  s.propsStates = { 3: 5, 4: 5, 5: 5 };
  s.hatchPoint = 200;
  const pet = c.State.hatchPet(); assert.equal(pet.ok, true);
  s.petsTeam = [pet.pet.key];
  const account = () => JSON.stringify([s.weapons, s.skills, s.gears, s.propsStates, s.pets, s.petsTeam]);
  const before = account(), run = start(c), next = c.Tower.nextBattle('endless');
  assert.equal(next.ok, true, next.msg);
  assert.ok(next.fighter, '英雄模式应提供独立的玩家战斗体');
  const fighter = next.fighter;
  assert.deepEqual([fighter.power, fighter.agility, fighter.speed, fighter.maxHp], [65, 65, 65, 800]);
  assert.deepEqual([...fighter.weapons, ...fighter.skills].map(it => it.level), [5, 5, 5]);
  assert.equal(count(run.hero), 3);
  assert.deepEqual(plain(fighter.gears.map(it => it.id)), [203]);
  assert.equal(fighter.pets.length, 0);
  assert.deepEqual(plain(fighter.effects), {});
  assert.equal(account(), before, '独立英雄战斗不能修改账号武技、装备、药剂或幻兽');
});

test('普通升级失败每次增加2个百分点，成功清保底，真级维持固定概率', () => {
  const { c } = setup(), h = profile(c), H = c.TowerHero;
  // Exact boundary draws: 60% fails at .60, then the accumulated 62% succeeds at .619.
  const failed = H.upgrade(h, 'w:1', { rng: () => 0.60 });
  assert.equal(failed.success, false);
  assert.equal(failed.level, 5);
  const passed = H.upgrade(h, 'w:1', { rng: () => 0.619 });
  assert.equal(passed.rate, 62);
  assert.equal(passed.level, 6);
  assert.equal(h.upgradeFails.w1, undefined);
  h.weapons = ['1:11']; h.upgradeFails.w1 = 20;
  const trueFailed = H.upgrade(h, 'w:1', { rng: () => 0.08 });
  assert.equal(trueFailed.rate, 8);
  assert.equal(trueFailed.success, false);
  assert.equal(h.upgradeFails.w1, undefined);
  assert.equal(H.upgrade(h, 'w:1', { rng: () => 0.079 }).level, 12);
});

test('普通学习在24个武技停止，特殊学习仍可突破上限', () => {
  const { c } = setup(), h = profile(c), H = c.TowerHero;
  for (let n = count(h); n < 24; n++) assert.equal(H.learn(h, { rng: () => 0 }).ok, true);
  const blocked = H.learn(h, { rng: () => 0 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.atCap, true);
  assert.equal(count(h), 24);
  const special = H.learn(h, { special: true, rng: () => 0 });
  assert.equal(special.ok, true);
  assert.equal(count(h), 25);
});

test('战后成长只结算一次，读档保留英雄，铸币重试退回战前成长', () => {
  const { c, store } = setup();
  const run = start(c); run.retryToken = 2; run.hpAbs = 90; run.carry = 0.1;
  assert.equal(c.Tower.debugGrantBuff('C16').ok, true);
  const next = c.Tower.nextBattle('endless');
  assert.equal(next.ok, true, next.msg);
  assert.equal(next.fighter.hp, 130, '800上限的5%开战治疗应只回复40点');
  assert.equal(run.retrySnap.hpAbs, 90, '重试快照必须保留开战治疗前的残血');
  assert.equal(c.Tower.reportBattle('endless', next.token, true, 800, 800).ok, true);
  const hero = plain(c.Tower._debugRun('endless').hero);
  assert.equal(hero.wins, 1);
  assert.equal(c.Tower.reportBattle('endless', next.token, true, 800, 800).ok, false);
  assert.deepEqual(plain(c.Tower._debugRun('endless').hero), hero);
  c.State.save();
  const loaded = setup(store, true).c;
  assert.deepEqual(plain(loaded.Tower._debugRun('endless').hero), hero);
  assert.equal(loaded.Tower.retryBattle().ok, true);
  assert.equal(loaded.Tower._debugRun('endless').hero.wins, 0);
  assert.equal(loaded.Tower._debugRun('endless').hpAbs, 90);
  const retry = loaded.Tower.nextBattle('endless');
  assert.equal(retry.ok, true, retry.msg);
  assert.equal(retry.fighter.hp, 130, '读档重试仍从90治疗到130，不能叠成170');
  assert.equal(loaded.Tower.reportBattle('endless', retry.token, false, 0, 800).retryable, true);
  assert.equal(loaded.Tower.retryBattle().ok, true);
  assert.equal(loaded.Tower._debugRun('endless').hpAbs, 90);
  const again = loaded.Tower.nextBattle('endless');
  assert.equal(again.ok, true, again.msg);
  assert.equal(again.fighter.hp, 130, '战败重试也只结算一次开战治疗');
  assert.equal(loaded.Tower.reportBattle('endless', again.token, true, 800, 800).ok, true);
  assert.equal(loaded.Tower._debugRun('endless').hero.wins, 1);
});

test('塔内武技强化和特殊领悟只作用于本局英雄，不写回账号', () => {
  const { c } = setup(), s = c.State.state();
  s.weapons = ['1:5']; s.skills = ['1:10'];
  const before = JSON.stringify([s.weapons, s.skills]), run = start(c);
  run.hero.weapons = ['2:5'];
  assert.equal(c.Tower.debugGrantBuff('C32').ok, true);
  assert.deepEqual(plain(c.Tower.pickCandidates('weapon').map(it => it.id)), [2]);
  assert.equal(c.Tower.applyPickBuff('weapon', 2).ok, true);
  assert.equal(c.Tower.debugGrantBuff('C33').ok, true);
  assert.equal(c.Tower.applyPickBuff('skill', 14).ok, true);
  assert.equal(c.Tower._debugRun('endless').hero.skills.some(it => /^14:/.test(it)), true);
  assert.equal(JSON.stringify([s.weapons, s.skills]), before);
});

test('英雄专属货品真实扣费生效，剧情之剑唯一且在镜复制完成后克制敌人', () => {
  const { c: normal } = setup(), ordinary = start(normal, false);
  for (const id of ['HS01', 'HS02', 'HS03', 'HS04', 'HB01']) {
    assert.equal(normal.Tower.poolFilterOf(ordinary, normal.TowerData.BUFF_BY_ID[id]), false);
  }
  const { c } = setup(), run = start(c), T = c.Tower, H = c.TowerHero;
  const totalLevels = () => [...run.hero.weapons, ...run.hero.skills].reduce((sum, it) => sum + Number(it.split(':')[1]), 0);
  run.coins = 500; run.phase = 'shop';
  run.shop = { layer: 1, rest: true, slots: [{ id: 'HS03', sold: false, price: 60 }] };
  const before = totalLevels(), training = T.buyShopSlot(0);
  assert.equal(training.ok, true, training.msg);
  assert.ok(training.price > 0);
  assert.equal(run.coins, 500 - training.price);
  assert.equal(totalLevels(), before + 1);
  for (let n = count(run.hero); n < 24; n++) assert.equal(H.learn(run.hero, { rng: () => 0 }).ok, true);
  const refs = () => [...run.hero.weapons.map(it => 'w:' + it), ...run.hero.skills.map(it => 's:' + it)];
  const known = new Set(refs());
  run.retryToken = 3;
  run.shop = { mint: true, layer: 1, slots: [{ id: 'HS04', sold: false }] };
  const secret = T.buyMintSlot(0);
  assert.equal(secret.ok, true, secret.msg);
  assert.equal(run.retryToken, 0);
  assert.equal(count(run.hero), 25);
  assert.deepEqual(refs().filter(it => !known.has(it)).map(it => Number(it.split(':')[2])), [5]);
  run.hero.eliteWins = 1;
  const forge = T.heroEventInfo(), used = T.permUsedOf(run);
  assert.equal(forge.id, 'forge');
  const sword = forge.choices.find(it => it.effect === 'sword');
  assert.equal(T.resolveHeroEvent(sword.id).ok, true);
  assert.equal(T.permUsedOf(run), used);
  assert.equal(T.resolveHeroEvent(sword.id).ok, false);
  assert.equal(run.permanent.filter(it => it.id === 'HB01').length, 1);
  const mirror = blade => {
    const probe = plain(run);
    Object.assign(probe, { layer: 100, idx: 0, phase: null, choices: null, shop: null,
      plan: [{ kind: 'patrol', id: 'patrol', x00: true, audience: 'king' }] });
    if (!blade) probe.permanent = probe.permanent.filter(it => it.id !== 'HB01');
    const next = T.nextBattle('endless', probe);
    assert.equal(next.ok, true, next.msg);
    next.adjustMe(H.fighter(probe.hero));
    return next.foe;
  };
  const without = mirror(false), withSword = mirror(true);
  assert.equal(withSword.power, Math.round(without.power * 0.8));
  assert.equal(withSword.maxHp, Math.round(without.maxHp * 0.65));
});

test('勇者状态快照：四维、武技等级、外观与成长都来自本局英雄', () => {
  const { c } = setup();
  const run = start(c);
  let captured = null;
  c.UI = { classic: {
    modal: (title, content) => { captured = { title, content }; return { element: null }; },
    gearName: (id) => ({ 203: '狂战铠甲' }[Number(id)] || ('装备' + Number(id))),
  } };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8'), c, { filename: 'js/tower-ui.js' });
  c.TowerUI.openHeroStatus();
  assert.equal(captured.title, '勇者 · 状态');
  assert.match(captured.content, /力量/);
  assert.match(captured.content, /敏捷/);
  assert.match(captured.content, /速度/);
  assert.match(captured.content, /生命/);
  assert.match(captured.content, /武器/);
  assert.match(captured.content, /技能/);
  assert.match(captured.content, /龟甲术/);
  assert.match(captured.content, /Lv\.5/);
  assert.match(captured.content, /狂战铠甲/, '外观部位要显示本局英雄穿的那一件');
  assert.match(captured.content, /未穿戴/, '没选的部位要标成未穿戴');
  assert.equal(run.hero.wins, 0);
});

test('爬塔中换外观只改本局勇者四部位，不碰账号装备并能读档保留', () => {
  const { c, store } = setup(), s = c.State.state();
  s.gears = [{ key: 'account', id: 207, used: true, ext: [] }];
  const run = start(c);
  const account = JSON.stringify(s.gears);
  const res = c.Tower.setHeroAppearance([{ id: 203, ext: [] }]);
  assert.equal(res.ok, true, res.msg);
  const appearance = plain(c.Tower._debugRun('endless').hero.appearance);
  assert.deepEqual(appearance.map(it => it.id), [203]);
  assert.deepEqual(appearance.map(it => it.type), [2]);
  assert.equal(JSON.stringify(s.gears), account, '外观装备不能写回账号装备栏');
  c.State.save();
  const loaded = setup(store, true).c;
  assert.deepEqual(plain(loaded.Tower._debugRun('endless').hero.appearance.map(it => it.id)), [203]);
  assert.equal(loaded.Tower.setHeroAppearance([{ id: 203, ext: [] }]).ok, true);
  assert.equal(run.hero.wins, 0);
});

test('勇者四维：生命800、力敏速65，按20%下限在55~85之间重分配并读档保留', () => {
  const { c, store } = setup(), H = c.TowerHero, R = H.statRules();
  assert.deepEqual(plain(R.initial), { power: 65, agility: 65, speed: 65 });
  assert.equal(R.floor, 55, '20% 下限 = ceil(275 × 20%)');
  assert.equal(R.cap, 85, '单项上限 = 275 − 80 − 55×2');
  let out = H.adjustStat({ power: 65, agility: 65, speed: 65 }, 0, 'power', 'down');
  assert.equal(out.ok, true);
  assert.deepEqual(plain(out.values), { power: 64, agility: 65, speed: 65 });
  assert.equal(out.pool, 1);
  out = H.adjustStat({ power: 55, agility: 65, speed: 65 }, 10, 'power', 'down');
  assert.equal(out.ok, false, '不能低于 20% 下限');
  out = H.adjustStat({ power: 85, agility: 55, speed: 55 }, 0, 'power', 'up');
  assert.equal(out.ok, false, '满额 / 没有可分配点都不能再加');
  const started = c.Tower.startEndlessRun({ ruleset: 'hero', hero: {
    picks: PICKS, stats: { power: 85, agility: 55, speed: 55 } } });
  assert.equal(started.ok, true, started.msg);
  const base = () => {
    const run = c.Tower._debugRun('endless');
    return [run.hero.base.power, run.hero.base.agility, run.hero.base.speed, run.hero.base.maxHp];
  };
  assert.deepEqual(base(), [85, 55, 55, 800]);
  c.State.save();
  const loaded = setup(store, true).c;
  const run = loaded.Tower._debugRun('endless');
  assert.deepEqual([run.hero.base.power, run.hero.base.agility, run.hero.base.speed, run.hero.base.maxHp],
    [85, 55, 55, 800]);
});

test('默认无尽模式仍以账号面板开局，不创建英雄资料', () => {
  const { c } = setup(), s = c.State.state();
  s.maxHp = 3500;
  const expected = c.State.totalStats({ useProps: false }).hp;
  const run = start(c, false), next = c.Tower.nextBattle('endless');
  assert.equal(next.ok, true, next.msg);
  assert.equal(run.baseMaxHp, expected);
  assert.equal(run.hero == null, true);
  assert.equal(next.fighter == null, true);
  assert.equal(typeof next.adjustMe, 'function');
});

test('英雄主界面用左下小全身照替代本局英雄信息窗，点开可看状态', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8');
  assert.doesNotMatch(ui, /heroRunHtml|hero-run-panel/, '爬塔主界面不再渲染那块本局英雄信息窗');
  assert.match(ui, /function heroPortraitButtonHtml/, '英雄模式要提供小全身照入口');
  assert.match(ui, /data-action="hero-status"/, '小全身照要能点开勇者状态');
  assert.match(ui, /TowerPlot\.modeButtonHtml\(\) \+ heroPortraitButtonHtml\(info\.run\)/,
    '小全身照应挂在「剧情模式」开关右侧');
  assert.match(ui, /function openHeroStatus/, '需要打开勇者状态查看页');
  /* 经典模式：准备页 / 回看页都复用随机挑战「查看敌人」那颗 7218 状态页。 */
  assert.match(ui, /SfStatus\.openHero\(/, '准备页与回看页要复用经典状态页的 openHero');
  assert.match(ui, /function openHeroGearPicker/, '外观装备选择层要有独立的可滚动页');
  assert.match(ui, /Tower\.setHeroAppearance\(/, '爬塔中换外观要落到本局勇者而不是账号');
});

test('英雄准备页点亮三个武技后才能开始，外观只按所选部位提交', () => {
  const { c } = setup();
  let picks = [], gears = [], submitted = null;
  const fakeList = () => {
    const set = new Set();
    return { add: (x) => set.add(x), remove: (x) => set.delete(x),
      toggle: (x, on) => { if (on === undefined ? set.has(x) : !on) set.delete(x); else set.add(x); },
      contains: (x) => set.has(x) };
  };
  const controls = new Map();
  const control = selector => {
    if (!controls.has(selector)) controls.set(selector, {
      textContent: '', disabled: false, onclick: null, innerHTML: '', hidden: false,
      dataset: {}, isConnected: true, classList: fakeList(), setAttribute() {},
    });
    return controls.get(selector);
  };
  const page = {
    querySelector: control,
    querySelectorAll: (selector) => {
      if (selector === '[data-hero-pick]') return picks;
      if (selector === '[data-hero-gear]') return gears;
      return [];
    },
  };
  c.Tower.endlessInfo = () => ({ run: null });
  c.Tower.startEndlessRun = options => { submitted = plain(options); return { ok: false, msg: '停止在开局契约边界' }; };
  c.UI = { classic: {
    btn: (label, action) => '<button data-action="' + action + '">' + label + '</button>',
    modal: () => null,
    page: (group, active, html) => {
      picks = [...html.matchAll(/data-hero-pick="([^"]+)"/g)].map(hit => ({
        dataset: { heroPick: hit[1], heroKind: hit[1].split(':')[0] },
        classList: fakeList(), hidden: false, setAttribute() {}, onclick: null,
      }));
      gears = [...html.matchAll(/data-hero-gear="(\d+)" data-gear-part="(\d+)"/g)].map(hit => ({
        dataset: { heroGear: hit[1], gearPart: hit[2] }, classList: fakeList(), onclick: null,
      }));
      return page;
    },
  } };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8'), c, { filename: 'js/tower-ui.js' });
  c.TowerUI.openHeroSetup();
  const startButton = control('[data-action="hero-start"]');
  const note = control('[data-hero-start-note]');
  assert.equal(startButton.disabled, true);
  for (let i = 0; i < 2; i++) picks[i].onclick();
  assert.equal(startButton.disabled, true, '未点亮三个时不能开始');
  picks[2].onclick();
  assert.equal(startButton.disabled, false);
  assert.equal(picks[3].classList.contains('is-locked'), true, '点亮满 3 个后，其余选项进入不可再点亮的锁定态');
  assert.match(note.textContent, /已点亮 3 个/, '准备完毕后底部提示应更新');
  /* 再点一下已点亮的武技就熄灭 → 又不能开始；再点回来才恢复。 */
  picks[0].onclick();
  assert.equal(startButton.disabled, true, '点暗一个后不足 3 个');
  picks[0].onclick();
  assert.equal(startButton.disabled, false);
  /* 外观：选一件只占它自己的部位；再点一次脱下。 */
  const gear = gears.find(it => it.dataset.heroGear === '177') || gears[0];
  assert.ok(gear, '装备列表里应当有可选的装备');
  gear.onclick();
  assert.equal(gear.classList.contains('is-equipped'), true);
  startButton.onclick();
  assert.deepEqual(submitted, {
    ruleset: 'hero', hero: { picks: picks.slice(0, 3).map(it => {
      const [kind, id] = it.dataset.heroPick.split(':'); return { kind, id: Number(id) };
    }), appearance: [{ id: Number(gear.dataset.heroGear), ext: [] }],
      stats: { power: 65, agility: 65, speed: 65 } },
  });
});
