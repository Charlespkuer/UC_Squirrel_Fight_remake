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
  'js/state.js', 'js/sim.js', 'js/tower-hero.js', 'js/tower.js', 'js/tower-plot.js', 'js/battle-drops.js'];
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
    c.State.newGame('勇者回归');
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

// DOM primitives only: real classic-ui creates, queries and wires every page and catalog.
function modernUi(c) {
  const dataKey = key => key.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  class Node {
    constructor(tag) {
      this.tagName = tag; this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.attrs = {};
      this.dataset = {}; this.style = { setProperty() {} }; this.className = ''; this._text = ''; this.listeners = {}; this.disabled = false;
      this.classList = { contains: x => this.className.split(/\s+/).includes(x),
        add: (...xs) => { this.className = [...new Set(this.className.split(/\s+/).concat(xs))].join(' ').trim(); },
        remove: (...xs) => { this.className = this.className.split(/\s+/).filter(x => !xs.includes(x)).join(' '); },
        toggle: (x, on) => this.classList[on == null ? (this.classList.contains(x) ? 'remove' : 'add') : on ? 'add' : 'remove'](x) };
    }
    get isConnected() { return this.tagName === 'html' || !!this.parentNode?.isConnected; }
    appendChild(n) { n.remove(); this.children.push(n); n.parentNode = this; return n; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); if (k.startsWith('data-')) this.dataset[dataKey(k)] = String(v); if (k === 'disabled') this.disabled = true; }
    getAttribute(k) { return k === 'class' ? this.className : k.startsWith('data-') ? this.dataset[dataKey(k)] : this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; if (k === 'disabled') this.disabled = false; }
    set textContent(v) { this.children = []; this._text = String(v); }
    get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
    set innerHTML(html) {
      this.children = []; this._text = ''; this.markup = String(html); const stack = [this];
      for (const token of String(html).match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (token.startsWith('<')) {
          const hit = /^<([\w-]+)([^>]*)>/.exec(token); if (!hit) continue;
          const n = new Node(hit[1]);
          for (const a of hit[2].matchAll(/([^\s=/>]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) n.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? '');
          stack[stack.length - 1].appendChild(n);
          if (!/^(img|input|br|hr|link|meta)$/.test(n.tagName) && !token.endsWith('/>')) stack.push(n);
        } else { const n = new Node('#text'); n._text = token; stack[stack.length - 1].appendChild(n); }
      }
    }
    get innerHTML() { return this.markup || ''; }
    matches(selector) {
      const parts = selector.trim().split(/\s+/).filter(x => x !== '>');
      const one = (n, s) => n?.nodeType === 1 && (!/^[\w-]+/.test(s) || n.tagName === s.match(/^[\w-]+/)[0]) &&
        [...s.matchAll(/\.([\w-]+)/g)].every(m => n.classList.contains(m[1])) &&
        [...s.matchAll(/#([\w-]+)/g)].every(m => n.getAttribute('id') === m[1]) &&
        [...s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(m => m[2] == null ? n.getAttribute(m[1]) != null : n.getAttribute(m[1]) === m[2]);
      if (!one(this, parts.pop())) return false;
      let at = this.parentNode;
      while (parts.length) { const part = parts.pop(); while (at && !one(at, part)) at = at.parentNode; if (!at) return false; at = at.parentNode; }
      return true;
    }
    querySelectorAll(s) { const out = []; const visit = n => { for (const ch of n.children) { if (s.split(',').some(x => ch.matches(x))) out.push(ch); visit(ch); } }; visit(this); return out; }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { for (let n = this; n; n = n.parentNode) if (n.matches(s)) return n; return null; }
    contains(n) { return n === this || this.children.some(ch => ch.contains(n)); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    focus() {}
    insertAdjacentHTML(where, html) { const box = new Node('div'); box.innerHTML = html; for (const n of [...box.children]) this.appendChild(n); }
    getContext() { return null; }
    click() { if (this.disabled) return; const e = { target: this, preventDefault() {}, stopPropagation() {} }; if (this.onclick) this.onclick(e); for (const fn of this.listeners.click || []) fn(e); }
  }
  const root = new Node('html'), body = root.appendChild(new Node('body')), ui = body.appendChild(new Node('div')); ui.setAttribute('id', 'ui');
  c.document = { documentElement: root, body, head: new Node('head'), createElement: tag => new Node(tag), querySelector: s => root.querySelector(s), querySelectorAll: s => root.querySelectorAll(s), addEventListener() {}, readyState: 'complete' };
  c.Image = class { constructor() { this.complete = false; } addEventListener() {} }; c.setTimeout = () => 0; c.clearTimeout = () => {};
  c.Engine.loadWears = async () => []; c.State.setSettings({ uiMode: 'modern' });
  for (const file of ['js/ui.js', 'js/classic-ui.js', 'js/tower-ui.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), c, { filename: file });
  return { ui, find: s => ui.querySelector(s), click: s => { const n = ui.querySelector(s); assert.ok(n, s); n.click(); } };
}

test('勇者只带所选的三个5级武技和外观，账号成长与消耗品不进入战斗', () => {
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
  assert.ok(next.fighter, '勇者模式应提供独立的玩家战斗体');
  const fighter = next.fighter;
  assert.deepEqual([fighter.power, fighter.agility, fighter.speed, fighter.maxHp], [65, 65, 65, 800]);
  assert.deepEqual([...fighter.weapons, ...fighter.skills].map(it => it.level), [5, 5, 5]);
  assert.equal(count(run.hero), 3);
  assert.deepEqual(plain(fighter.gears.map(it => it.id)), [203]);
  assert.equal(fighter.pets.length, 0);
  assert.deepEqual(plain(fighter.effects), {});
  assert.equal(account(), before, '独立勇者战斗不能修改账号武技、装备、药剂或幻兽');
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

test('战后成长只结算一次，读档保留勇者，铸币重试退回战前成长', () => {
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

test('塔内武技强化和特殊领悟只作用于本局勇者，不写回账号', () => {
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

test('勇者专属货品真实扣费生效，剧情之剑唯一且在镜复制完成后克制敌人', () => {
  const { c: normal } = setup(), ordinary = start(normal, false);
  for (const id of ['HS01', 'HS02', 'HS03', 'HS04', 'HB01']) {
    assert.equal(normal.Tower.poolFilterOf(ordinary, normal.TowerData.BUFF_BY_ID[id]), false);
  }
  const { c } = setup(), run = start(c), T = c.Tower, H = c.TowerHero;
  run.coins = 500; run.phase = 'shop';
  run.shop = { layer: 1, rest: true, slots: [{ id: 'HS03', sold: false, price: 60 }] };
  const beforeW1 = Number(run.hero.weapons.find(it => it.startsWith('1:')).split(':')[1]);
  const training = T.buyShopSlot(0, undefined, { heroChoice: { ref: 'w:1' } });
  assert.equal(training.ok, true, training.msg);
  assert.ok(training.price > 0);
  assert.equal(run.coins, 500 - training.price);
  assert.equal(Number(run.hero.weapons.find(it => it.startsWith('1:')).split(':')[1]), 15, 'HS03 应把选定武技直接升到真5');
  assert.ok(beforeW1 < 15);
  /* HS02：自选遗忘 + 自选学习，新武技继承旧等级；不改变总数。 */
  const beforeCount = count(run.hero);
  // 第一件 HS03 已经买掉；重新放一件 HS02 到货架
  run.phase = 'shop';
  run.shop = { layer: 1, rest: true, slots: [{ id: 'HS02', sold: false, price: 60 }] };
  const swap = T.buyShopSlot(0, undefined, { heroChoice: { forgetRef: 'w:1', learnRef: 'w:2' } });
  assert.equal(swap.ok, true, swap.msg);
  assert.equal(count(run.hero), beforeCount, 'HS02 不改变武技总数');
  assert.equal(run.hero.weapons.some(it => it.startsWith('1:')), false, '被遗忘的武器应移除');
  assert.equal(run.hero.weapons.find(it => it.startsWith('2:')), '2:15', '新武器继承被遗忘武器的真5等级');
  for (let n = H.cappedCount(run.hero); n < 24; n++) assert.equal(H.learn(run.hero, { rng: () => 0 }).ok, true);
  const refs = () => [...run.hero.weapons.map(it => 'w:' + it), ...run.hero.skills.map(it => 's:' + it)];
  const known = new Set(refs());
  run.retryToken = 3;
  run.shop = { mint: true, layer: 1, slots: [{ id: 'HS04', sold: false }] };
  const secret = T.buyMintSlot(0);
  assert.equal(secret.ok, true, secret.msg);
  assert.equal(run.retryToken, 0);
  assert.equal(count(run.hero), 25);
  assert.equal(H.cappedCount(run.hero), 24, 'HS04 学会的武技不占普通 24 项上限');
  assert.equal(H.uncappedCount(run.hero), 1);
  assert.deepEqual(refs().filter(it => !known.has(it)).map(it => Number(it.split(':')[2])), [5]);
  assert.equal(T.buffWeightOf(run, 'HS04'), 0.5, 'HS04 每获得一次，动态权重按 0.5^n 减半');
  run.hero.patrolWins = 1;
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

test('勇者新规则：开局无 60 币、习得 5 级、铸币修炼 +3~5、巡逻魔王让 HB01 成长', () => {
  const { c } = setup(), T = c.Tower, H = c.TowerHero;
  const run = start(c);
  assert.equal(run.coins, 0, '开局不再送 60 试炼币');
  assert.equal(T.heroEventInfo(), null, '开局不再有 departure 际遇');
  const learned = H.learn(run.hero, { rng: () => 0.99 });
  assert.equal(learned.ok, true, learned.msg);
  assert.equal(learned.level, 5, '所有新习得武技都是 5 级');
  run.retryToken = 3;
  const before = Number(run.hero.weapons.find(it => it.startsWith('1:')).split(':')[1]);
  const trained = T.coinTrainHero('w:1');
  assert.equal(trained.ok, true, trained.msg);
  const after = Number(run.hero.weapons.find(it => it.startsWith('1:')).split(':')[1]);
  assert.ok(after - before >= 3 && after - before <= 5, '铸币修炼应随机 +3~5 级，实际 +' + (after - before));
  assert.equal(run.retryToken, 2, '铸币修炼消耗 1 枚铸币');
  /* 首次巡逻胜利触发 forge；这里先标记已读，再验证下一场巡逻让 HB01 成长。 */
  run.hero.patrolWins = 1;
  run.hero.events = Object.assign({}, run.hero.events, { forge: true });
  run.permanent.push({ id: 'HB01', stacks: 1, uid: 9001, at: 9001 });
  run.plan = [{ kind: 'patrol', id: 'patrol', _layer: run.layer, _salt: run.salt, x00: false }];
  run.idx = 0; run.choices = null; run.phase = null; run.attempt = null; run.finished = null;
  const next = T.nextBattle('endless');
  assert.equal(next.ok, true, next.msg);
  const won = T.reportBattle('endless', next.token, true, 800, 800);
  assert.equal(won.ok, true, won.msg);
  const sword = run.permanent.find(it => it.id === 'HB01');
  assert.equal(sword.stacks, 2, '击败巡逻魔王后 HB01 应成长一层');
  assert.equal(T.heroBladeOf(run).stacks, 2);
  assert.equal(run.hero.patrolWins, 2);
  /* 照影之境只保留 HB01 本体与层数，不会把剑的成长吞掉。 */
  run.layer = 100; run.phase = 'mirror'; run.mirrorTaken = 100;
  run.plan = [{ kind: 'patrol', id: 'patrol', _layer: 100, _salt: run.salt, x00: true, audience: 'king' }];
  run.idx = 0; run.choices = null; run.finished = null;
  run.permanent.unshift({ id: c.TowerData.MIRROR.id, stacks: 1, uid: 9002, at: 9002 });
  const mirror = T.enterMirrorWorld();
  assert.equal(mirror.ok, true, mirror.msg);
  const kept = run.permanent.find(it => it.id === 'HB01');
  assert.equal(kept.stacks, 2, '照影之境必须保留 HB01 的破镜层数');
  assert.equal(T.heroBladeOf(run).stacks, 2);
  assert.equal(run.layer, 101);
});

test('巡视魔王每个 10 层区块只刷新一次：击败后时间回廊重开本层不再出现', () => {
  const { c, store } = setup();
  c.Tower._debugSetNoMintShop(true);
  start(c, false);
  const findPatrol = (ctx, positive) => {
    for (let L = 41; L <= 99; L++) {
      ctx.Tower._debugSetEndlessLayer(L);
      const r = ctx.Tower._debugRun('endless');
      const at = r.plan.findIndex((e) => e && e.kind === 'patrol' && !e.x00);
      if (at >= 0 && (!positive || at > 0)) return { layer: L, idx: at };
    }
    return null;
  };
  const winNext = (ctx) => {
    const r = ctx.Tower._debugRun('endless');
    r.choices = null; r.phase = null; r.finished = null;
    const nx = ctx.Tower.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '应当能开下一场：' + ((nx && nx.msg) || ''));
    return ctx.Tower.reportBattle('endless', nx.token, true, 1, null);
  };

  /* A. 还没打赢巡视魔王就用时间回廊：它必须还在（不能说这个区块已经刷过了）。 */
  let hit = findPatrol(c, true);
  assert.ok(hit, '应当能找到一个非第一场的巡视层');
  assert.equal(c.Tower.debugGrantBuff('E15').ok, true);
  let rw = winNext(c);
  let run = c.Tower._debugRun('endless');
  assert.equal(rw.layerRestart.layer, hit.layer);
  assert.equal(rw.layerRestart.patrolSkipped, false);
  assert.equal(run.patrolDoneWins, 0);
  assert.ok(run.plan.some((e) => e && e.kind === 'patrol' && !e.x00),
    '没打魔王就重开，这一层的巡视魔王不能被吞掉');

  /* B. 打赢巡视魔王后再用时间回廊：同一个 10 层区块不再刷新魔王。 */
  c.Tower.abandon('endless');
  assert.equal(c.Tower.startEndlessRun().ok, true);
  hit = findPatrol(c, false);
  assert.ok(hit, '应当能找到巡视层');
  for (let i = 0; i < hit.idx; i++) winNext(c);
  let nx = c.Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开巡视那场：' + ((nx && nx.msg) || ''));
  assert.equal(nx.foe.patrol, true);
  assert.equal(c.Tower.debugGrantBuff('E15').ok, true);
  rw = c.Tower.reportBattle('endless', nx.token, true, 1, null);
  run = c.Tower._debugRun('endless');
  assert.ok(rw.layerRestart, '这一场应当触发时间回廊');
  assert.equal(rw.layerRestart.patrolSkipped, true, '回归层应当跳过巡视刷新');
  assert.equal(run.idx, 0, '回到本层第 1 场');
  assert.equal(run.patrolDoneWins, 1, '宏观计数记下这个区块已经用过一次');
  assert.ok(run.patrolDoneBlock > 0);
  assert.ok(!run.plan.some((e) => e && e.kind === 'patrol' && !e.x00),
    '同一个 10 层区块的巡视魔王不能再刷新');
  assert.ok(run.plan.length >= 4, '被替换的三侠 / 首领位要回到 plan 里，场数不变');

  /* 存档往返：计数与「不再刷新」的 plan 都要保留。 */
  c.State.save();
  const loaded = setup(store, true).c;
  loaded.Tower._debugSetNoMintShop(true);
  const lr = loaded.Tower._debugRun('endless');
  assert.equal(lr.patrolDoneWins, 1);
  assert.ok(!lr.plan.some((e) => e && e.kind === 'patrol' && !e.x00));

  /* C. 换到下一个 10 层区块：计数只属于旧区块，新区块的巡视魔王照常刷新。 */
  const later = findPatrol(loaded, true);
  assert.ok(later, '新区块应当也有巡视层');
  assert.equal(loaded.Tower.debugGrantBuff('E15').ok, true);
  const rwC = winNext(loaded);
  const runC = loaded.Tower._debugRun('endless');
  assert.equal(rwC.layerRestart.patrolSkipped, false, '新区块还没打赢巡视魔王');
  assert.ok(runC.plan.some((e) => e && e.kind === 'patrol' && !e.x00),
    '旧区块的计数不能吞掉新区块的巡视魔王');
});

test('现代勇者状态与武技页使用局内等级，训练、外观和返回保留勇者回调', () => {
  const { c } = setup(), run = start(c), s = c.State.state();
  run.hero.weapons = ['1:12']; run.hero.skills = []; run.retryToken = 1;
  s.weapons = ['2:15']; s.skills = ['7:15']; s.goldPoint = 789;
  const account = () => JSON.stringify([s.goldPoint, s.weapons, s.skills, s.gears]);
  const before = account(), dom = modernUi(c), real = c.UI.classic.openHeroPage;
  let context, back = 0;
  c.UI.classic.openHeroPage = (hero, opts) => { context = hero; return real(hero, opts); };
  c.TowerUI.openHeroStatus();
  assert.ok(dom.find('.status-right')); assert.match(dom.find('.stat-strip').textContent, /800/);
  assert.equal(dom.find('[data-action="hero-train"]').textContent, '铸币修炼');
  /* 现代外观页直接走 onEquip（纸娃娃 + 6 格列表在 classic-ui 里），
   * 不走旧的 onGears 自绘层；全装备池是 GEAR_BASE 的原始 288 件去掉
   * 46/67、47/68 两组重复黑装后的 280 件，包括黑装上位（比如浣熊 q5）
   * 与原本没进 gearMap 的深海/机器猫 q3。 */
  assert.equal(typeof context.onEquip, 'function');
  assert.equal(context.gearList.length, 280, '勇者外观池合并重复黑装后应当是 280 件');
  const blackRaccoon = context.gearList.find((g) => Number(g.id) === 237);
  assert.ok(blackRaccoon && Number(blackRaccoon.quality) === 5 && blackRaccoon.name === '浣熊头饰',
    'q5 黑装浣熊头饰必须在勇者外观池里');
  assert.equal(blackRaccoon.family, '浣熊', '黑装上位也要按套装家族分组');
  assert.ok(context.gearList.some((g) => Number(g.id) === 189 && Number(g.quality) === 3),
    '原本漏掉的深海 q3 也要进外观池');
  const equipped = context.onEquip([203, 0, 0, 0]);
  assert.equal(equipped.ok, true);
  assert.deepEqual(plain(run.hero.appearance.map(g => g.id)), [203]);
  /* 没有进 gearMap 的 q5 外观也要能被 TowerHero.normalize 接受并落盘。 */
  const blackSaved = c.Tower.setHeroAppearance([{ id: 237, type: 0, ext: [] }]);
  assert.equal(blackSaved.ok, true, blackSaved.msg);
  assert.deepEqual(plain(blackSaved.appearance.map((g) => Number(g.id))), [237]);
  context.onBack = () => { back++; c.UI.runAction('status'); };
  dom.click('[data-action="weapons"]');
  assert.match(dom.find('[data-item="1"]').textContent, /真2/);
  assert.equal(dom.find('[data-item="2"]').classList.contains('locked'), true);
  dom.click('[data-item="1"]');
  const train = dom.find('.classic-modal-overlay').querySelectorAll('button').find(n => /铸币修炼/.test(n.textContent));
  assert.ok(train); train.click();
  assert.deepEqual(plain(run.hero.weapons), ['1:15']); assert.equal(run.retryToken, 0);
  dom.click('[data-action="skills"]');
  assert.equal(dom.find('[data-item="7"]').classList.contains('locked'), true, '空技能表不能借用账号已学龟甲术');
  dom.click('[data-action="home"]'); assert.equal(back, 1);
  assert.ok(dom.find('[data-action="gears"]'), '退出勇者上下文后恢复普通状态页动作');
  assert.equal(account(), before, '英雄详情修炼不能扣账号金松果或修改账号武技装备');
});

test('勇者外观池把重复的黑狂战 / 黑怒战套合并成一套', () => {
  const { c } = setup(); start(c);
  const dom = modernUi(c);
  const real = c.UI.classic.openHeroPage;
  let context;
  c.UI.classic.openHeroPage = (hero, opts) => { context = hero; return real(hero, opts); };
  c.TowerUI.openHeroStatus();
  assert.ok(context && Array.isArray(context.gearList), '外观页应当拿到 gearList');
  const countOf = (setId) => context.gearList.filter((g) => Number(g.setId) === setId).length;
  assert.equal(context.gearList.length, 280, '原始 288 件合并 46/67、47/68 两组重复黑装后是 280 件');
  assert.equal(countOf(46), 4, '黑狂战保留 46（181~184）这一套');
  assert.equal(countOf(47), 4, '黑怒战保留 47（185~188）这一套');
  assert.equal(countOf(67) + countOf(68), 0, '67/68 这两套重复 id 不该再出现');
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

test('勇者每层最后一战按武技数领悟，第一层最后一战必定领悟', () => {
  const { c } = setup(), H = c.TowerHero;
  assert.equal(H.learnChanceForCount(4), 0.8, '4 个武技 → 80%');
  assert.equal(H.learnChanceForCount(10), 0.5, '10 个武技 → 50%');
  assert.equal(H.learnChanceForCount(20), 0.3, '20 个武技 → 30%');
  const first = H.create({ picks: PICKS }).hero;
  const g1 = H.grow(first, { layer: 1, lastBattle: true, rng: () => 0.99 });
  assert.equal(g1.learn && g1.learn.ok, true, '第一层最后一战应当 100% 领悟');
  assert.equal(count(first), 4, '初始 3 + 第一层领悟 1 = 4');
  const noLast = H.grow(first, { layer: 2, lastBattle: false, rng: () => 0 });
  assert.equal(noLast.learn, null, '非最后一战不再领悟');
  const hero4 = H.create({ picks: PICKS }).hero;
  assert.equal(H.learn(hero4, { rng: () => 0 }).ok, true, '补到 4 个武技');
  const hit = H.grow(hero4, { layer: 2, lastBattle: true, rng: () => 0.79 });
  assert.equal(hit.learn && hit.learn.ok, true, '4 个武技时 0.79 应落在 80% 内');
  const hero4b = H.create({ picks: PICKS }).hero;
  H.learn(hero4b, { rng: () => 0 });
  const miss = H.grow(hero4b, { layer: 2, lastBattle: true, rng: () => 0.81 });
  assert.equal(miss.learn, null, '4 个武技时 0.81 应落在 80% 外');
  /* 真实战斗路径：第一层最后一场（plan 只有一场）也要把 lastBattle 传进去。 */
  const { c: towerC } = setup(), tower = towerC.Tower;
  const realRun = start(towerC);
  realRun.plan = [realRun.plan[realRun.plan.length - 1]];
  realRun.idx = 0; realRun.choices = null; realRun.phase = null;
  const realNext = tower.nextBattle('endless');
  assert.equal(realNext.ok, true, realNext.msg);
  const realWon = tower.reportBattle('endless', realNext.token, true, 800, 800);
  assert.equal(realWon.ok, true, realWon.msg);
  assert.equal(count(realRun.hero), 4, '第一层最后一战实际报告胜利后应领悟一个');
});

test('授业事件替换第一次自然铸币商店，并把复盘旧招改为随机升级 4 次', () => {
  const { c } = setup(), T = c.Tower;
  const run = start(c);
  T._debugSetEndlessLayer(7);
  const r = T._debugRun('endless');
  r.plan = [r.plan[r.plan.length - 1]];
  r.idx = 0; r.choices = null; r.phase = null; r.attempt = null;
  r.hero.events = {}; r.heroMentorMintDone = false; r.heroMentorPending = false; r.mintGroup = -1;
  vm.runInContext('Math.random = () => 0;', c);
  const nx = T.nextBattle('endless');
  assert.equal(nx.ok, true, nx.msg);
  const won = T.reportBattle('endless', nx.token, true, 800, 800);
  assert.equal(won.ok, true, won.msg);
  assert.equal(r.heroMentorPending, true, '第一次自然铸币商店应改为挂起授业事件');
  assert.equal(r.shop, null, '这一次不再开铸币商店');
  const event = T.heroEventInfo();
  assert.equal(event && event.id, 'mentor', '授业事件应替换第一次自然铸币商店');
  const before = run.hero.weapons.concat(run.hero.skills).reduce((n, raw) => n + Number(raw.split(':')[1]), 0);
  const training = event.choices.find((it) => it.effect === 'training');
  const out = T.resolveHeroEvent(training.id);
  assert.equal(out.ok, true, out.msg);
  const after = run.hero.weapons.concat(run.hero.skills).reduce((n, raw) => n + Number(raw.split(':')[1]), 0);
  assert.equal(after - before, 4, '复盘旧招应随机升级 4 次');
  assert.equal(r.heroMentorPending, false);
  assert.equal(r.hero.events.mentor, true);
});

test('钟声之前：自选武技升满 / 300 试炼币，且破晓铸痕已移除', () => {
  const make = (events) => {
    const { c } = setup();
    const run = start(c);
    run.layer = 80;
    run.hero.events = Object.assign({
      forge: true, mentor: true, campfire: true, reflection: true, 'returning-sword': true,
    }, events || {});
    run.heroMentorPending = false;
    run.phase = null; run.choices = null; run.attempt = null;
    return { c, run };
  };
  const first = make();
  const event = first.c.Tower.heroEventInfo();
  assert.equal(event && event.id, 'last-lesson');
  const maximize = event.choices.find((it) => it.effect === 'maximize');
  assert.equal(maximize && maximize.desc.includes('真5'), true, '选项一应说明直接升满');
  const ref = 'w:' + String(first.run.hero.weapons[0]).split(':')[0];
  const out = first.c.Tower.resolveHeroEvent(maximize.id, { heroChoice: { ref } });
  assert.equal(out.ok, true, out.msg);
  assert.equal(Number(String(first.run.hero.weapons.find((it) => it.startsWith(String(ref.slice(2)) + ':')).split(':')[1])), 15,
    '选中的武技应直接升到真5');
  assert.equal(first.c.Tower.heroEventInfo(), null);

  const second = make();
  const coinsEvent = second.c.Tower.heroEventInfo();
  const coins = coinsEvent.choices.find((it) => it.effect === 'coins');
  const coinsOut = second.c.Tower.resolveHeroEvent(coins.id);
  assert.equal(coinsOut.ok, true, coinsOut.msg);
  assert.equal(second.run.coins, 300, '钟声之前选钱应给 300 试炼币');

  const mirror = make({ 'last-lesson': true });
  mirror.run.layer = 100;
  mirror.run.phase = 'mirror';
  assert.equal(mirror.c.Tower.heroEventInfo(), null, '破晓铸痕事件应已移除');
});

test('营火与镜外的新雪改为接下来 10 场每回合回血', () => {
  const { c } = setup(), T = c.Tower;
  const run = start(c);
  run.hero.wins = 25;
  run.hero.events = { forge: true, mentor: true };
  run.heroMentorPending = false;
  const camp = T.heroEventInfo();
  assert.equal(camp && camp.id, 'campfire');
  const regen5 = camp.choices.find((it) => it.effect === 'regen5');
  assert.equal(T.resolveHeroEvent(regen5.id).ok, true);
  assert.equal(run.eventRegen.length, 1);
  assert.equal(run.eventRegen[0].pct, 0.05);
  assert.equal(run.eventRegen[0].left, 10);
  const battle = T.nextBattle('endless');
  assert.equal(battle.ok, true, battle.msg);
  assert.ok(Math.abs(Number(battle.fighter.mods.regenPct) - 0.05) < 1e-9, '本场应吃到 5% 每回合回血');
  run.eventRegen[0].left = 1;
  const won = T.reportBattle('endless', battle.token, true, 800, 800);
  assert.equal(won.ok, true, won.msg);
  assert.equal(run.eventRegen.length, 0, '第 10 场结束后计时应消失');

  const secondCtx = setup();
  const second = start(secondCtx.c);
  const T2 = secondCtx.c.Tower;
  second.layer = 101;
  second.hero.events = { forge: true, mentor: true, campfire: true, reflection: true, 'returning-sword': true, 'last-lesson': true };
  second.heroMentorPending = false;
  second.phase = null; second.choices = null; second.attempt = null;
  const cycle = T2.heroEventInfo();
  assert.equal(cycle && cycle.id.startsWith('cycle-'), true);
  const regen10 = cycle.choices.find((it) => it.effect === 'regen10');
  assert.equal(T2.resolveHeroEvent(regen10.id).ok, true);
  assert.equal(second.eventRegen[0].pct, 0.10);
  assert.equal(second.eventRegen[0].left, 10);
});

test('勇者真化武技白值 ×1.5 / 真5 ×2，普通模式不受影响', () => {
  const { c } = setup(), H = c.TowerHero, S = c.State;
  assert.equal(H.trueBaseMul(10), 1);
  assert.equal(H.trueBaseMul(11), 1.5);
  assert.equal(H.trueBaseMul(14), 1.5);
  assert.equal(H.trueBaseMul(15), 2);

  const hero = H.create({ picks: PICKS }).hero;
  hero.weapons = ['1:10']; hero.skills = [];
  const normal10 = S.weaponInst('1:10');
  const f10 = H.fighter(hero);
  assert.equal(f10.weapons[0].harmLo, normal10.harmLo, '10级白值不变');
  assert.equal(f10.weapons[0].trueBaseMul, 1);

  hero.weapons = ['1:11'];
  const normal11 = S.weaponInst('1:11');
  const f11 = H.fighter(hero);
  assert.equal(f11.weapons[0].harmLo, Math.round(normal11.harmLo * 1.5), '真1白值 ×1.5');
  assert.equal(f11.weapons[0].trueBaseMul, 1.5);

  hero.weapons = ['1:15'];
  const normal15 = S.weaponInst('1:15');
  const f15 = H.fighter(hero);
  assert.equal(f15.weapons[0].harmLo, Math.round(normal15.harmLo * 2), '真5白值 ×2');
  assert.equal(f15.weapons[0].trueBaseMul, 2);
  assert.equal(S.weaponInst('1:15').harmLo, normal15.harmLo, '普通模式仍是原始白值');

  hero.weapons = []; hero.skills = ['1:11'];
  const passive = H.fighter(hero);
  const passive11 = Math.round(c.GData.passiveBonus(1, 11) * 1.5);
  assert.equal(passive.power, 65 + passive11, '真化被动也吃白值乘数');

  hero.skills = ['8:15'];
  const skill = H.fighter(hero);
  assert.equal(skill.skills[0].trueBaseMul, 2, '伤害技能真5标记 ×2');
});

test('默认无尽模式仍以账号面板开局，不创建勇者资料', () => {
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

test('现代勇者准备跨武器、技能和分页点亮三个武技，再从真实状态页提交', () => {
  const { c } = setup(), dom = modernUi(c);
  let submitted = null;
  c.Tower.startEndlessRun = options => { submitted = plain(options); return { ok: false, msg: '停止在开局契约边界' }; };
  c.TowerUI.openHeroSetup();
  assert.equal(dom.find('[data-action="hero-start"]').textContent, '开始冒险');
  assert.equal(dom.find('[data-action="hero-gear"]').textContent, '外观装备');
  assert.equal(dom.find('[data-action="hero-start"]').disabled, true);
  dom.click('[data-action="weapons"]'); dom.click('[data-item="1"]'); dom.click('[data-action="next"]');
  const second = Number(dom.find('.catalog-cell[data-item]').getAttribute('data-item'));
  assert.notEqual(second, 1); dom.click('[data-item="' + second + '"]');
  dom.click('[data-action="status"]');
  assert.equal(dom.find('[data-action="hero-start"]').disabled, true);
  dom.click('[data-action="hero-start"]'); assert.equal(submitted, null);
  dom.click('[data-action="skills"]'); dom.click('[data-item="7"]'); dom.click('[data-action="status"]');
  assert.equal(dom.find('[data-action="hero-start"]').disabled, false);
  dom.click('[data-action="hero-start"]');
  assert.deepEqual(submitted, { ruleset: 'hero', hero: {
    picks: [{ kind: 'weapon', id: 1 }, { kind: 'weapon', id: second }, { kind: 'skill', id: 7 }],
    appearance: [], stats: { power: 65, agility: 65, speed: 65 } } });
});

test('勇者剧本每段剧情都有独立文本，并全部走剧情模式模板', () => {
  const { c } = setup();
  start(c);
  const P = c.TowerPlot;
  assert.ok(P && P.HERO_SCRIPTS, 'tower-plot 要导出勇者剧情表');
  const ids = Object.keys(P.SCRIPTS);
  assert.equal(ids.length, 43, '默认剧情段数变化时要同步补勇者文本');
  for (const id of ids) {
    const lines = P.HERO_SCRIPTS[id];
    assert.ok(Array.isArray(lines) && lines.length > 0, id + ' 缺勇者专属文本');
    assert.ok(lines.join('').length >= 8, id + ' 的勇者文本不能是空壳');
    assert.notDeepEqual(plain(lines), plain(P.SCRIPTS[id].lines), id + ' 必须重写，不能照抄默认剧本');
  }
  const intro = P.script('intro');
  assert.deepEqual(plain(intro.lines), plain(P.HERO_SCRIPTS.intro), '勇者开局要取勇者文本');
  assert.notDeepEqual(plain(intro.lines), plain(P.SCRIPTS.intro.lines), '勇者开局不能复用默认剧本');
  assert.notDeepEqual(plain(P.script('merchant').lines), plain(P.SCRIPTS.merchant.lines), '进商店要换勇者商人');
  assert.notDeepEqual(plain(P.script('patrolGate').lines), plain(P.SCRIPTS.patrolGate.lines), '巡视首次相遇要换勇者镜巡');
  /* 勇者局的「只播一次」用 hero: 前缀：先玩过默认模式也不能吞掉勇者主线。 */
  c.State.state().endless.storySeen = { gate20: true };
  assert.equal(c.Tower.storySeen('gate20'), false, '勇者局不能沿用默认局的 seen');
  c.Tower.markStorySeen('gate20');
  assert.equal(c.State.state().endless.storySeen['hero:gate20'], true, '勇者局记在 hero: 前缀');
  assert.equal(c.State.state().endless.storySeen.gate20, true, '默认局原有记账不能被覆盖');
  /* 勇者际遇也只能走剧情模式整屏（不得再有事件卡兜底）。 */
  const ui = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(!/hero-event-card/.test(ui), '勇者际遇不能再保留非剧情模板的事件卡');
  assert.match(P.eventHtml({ title: '测试', lines: ['一行'], choices: [{ id: 'x', label: '走', desc: '' }] }),
    /class="tower-story hero-story"/, '勇者际遇要用剧情模式模板');
});
