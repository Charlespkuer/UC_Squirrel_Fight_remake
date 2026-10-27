#!/usr/bin/env node
'use strict';
/* 经典跳过只终止战斗演出，必须继续真实战果、选箱、确认和一次结算。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');

function setup() {
  let now = 0, serial = 0;
  const timers = new Map(), rafs = new Map(), clips = [];
  const math = Object.create(Math); math.random = () => .25; // 固定随机流，四选一只核对入账次数。
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const node = () => ({ isConnected: true, style: {}, addEventListener() {}, remove() { this.isConnected = false; } });
  function clip(count = 10, names = {}) {
    const c = { g: node(), nodes: new Map(), __attached: [], frame: 0, playing: false, writes: 0,
      frames: Array.from({ length: count }, () => new Map([[1, {}]])),
      frameCount: () => count, byName: name => names[name] || null,
      gotoAndPlay(n) { this.frame = n - 1; this.playing = true; this.writes++; },
      gotoAndStop(n) { this.frame = n - 1; this.playing = false; this.writes++; },
      stop() { this.playing = false; },
    };
    clips.push(c); return c;
  }
  const env = { console, Promise, Set, Map, Math: math, Date,
    performance: { now: () => now }, document: { hidden: false },
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame(fn) { const id = ++serial; rafs.set(id, fn); return id; },
    cancelAnimationFrame: id => rafs.delete(id),
    State: { state: () => ({}) }, SfRender: {},
    BattleDrops: { poolFor: () => [{ id: 1, name: '固定奖品', count: 1, weight: 1 }],
      grant(items) { env.granted.push(...items); } }, granted: [],
  };
  env.window = env;
  let source = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  // 暴露真实闭包入口；controller 原文从 run 中提取，测试不维护另一份 skip/cancel。
  const begin = source.indexOf('    const controller = {', source.indexOf('async function run('));
  const end = source.indexOf('\n    rec.controller = controller;', begin);
  assert.ok(begin >= 0 && end > begin, '真实 controller 接口应可定位');
  const controller = source.slice(begin, end);
  source = source.replace('  window.SfFight = Object.freeze({', `
  window.__skip = { setLive(rec) { live = rec; }, perform, playClip,
    controller(rec) { const pickups = rec.pickups, result = rec.result, o = rec.o;
      ${controller}
      rec.controller = controller; return controller;
    } };
  window.SfFight = Object.freeze({`);
  vm.createContext(env); vm.runInContext(source, env, { filename: 'js/ssfight/ui-fight.js' });
  async function frame(finish) {
    if (finish) for (const c of clips) if (c.playing) c.frame = c.frameCount() - 1;
    const pending = [...rafs.values()]; rafs.clear();
    for (const fn of pending) fn(now);
    await flush();
  }
  async function nextTimer() {
    if (!timers.size) return false;
    now = Math.min(...[...timers.values()].map(t => t.at));
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
    await flush(); return true;
  }
  async function until(test, label) {
    for (let i = 0; i < 20 && !test(); i++) { await frame(true); await nextTimer(); }
    assert.ok(test(), label);
  }
  function battle(options = {}) {
    const log = { reward: 0, end: 0, skips: [], idleAfterResult: 0 };
    const attack = clip(60);
    const key = () => clip(2, { k: clip(10) });
    const chest = clip(2, Object.fromEntries([1, 2, 3, 4].flatMap(i => [['k' + i, key()], ['b' + i, clip(6)]])));
    const view = clip(6, { openChest: chest });
    view.destroy = () => { view.g.isConnected = false; };
    const rec = { view, timers: [], rafs: [], sleepers: new Set(), stopped: false, skipped: false,
      settling: false, ended: false, speed: 1, strip: [false, false], shields: [0, 0],
      hps: [100, 100], maxHp: [100, 100], roundsLeft: 1,
      rounds: [{ action: 'common', attacker: 0, hpAfter: [73, 0] }],
      result: { winner: 0, maxHp: [100, 100] },
    };
    rec.skipSignal = new Promise(resolve => { rec.wakeSkip = resolve; });
    const fighter = () => ({ blood: {}, holder: clip(8), isDead: () => false,
      idle() { if (rec.settling) log.idleAfterResult++; }, setStatu() {}, specialEffect() {},
      attack() { return env.__skip.playClip(attack); },
      dead: async () => {}, congratulate: async () => {},
      beAttack: async () => {}, comeBack: async () => {}, useSkillDefense: () => false,
    });
    rec.fighters = [fighter(), fighter()];
    rec.pickups = { summary: () => ({ items: [], ups: [] }), close() {}, skip: button => log.skips.push(button) };
    rec.o = { rewardFor() { log.reward++; return { exp: 1, gold: 2 }; },
      onEnd(winner, result) { log.end++; log.result = result; }, ...options };
    if (options.rounds) rec.rounds = options.rounds;
    if (options.hudReady) rec.hudReady = options.hudReady;
    env.__skip.setLive(rec);
    const control = env.__skip.controller(rec);
    const task = env.__skip.perform(rec, rec.o, rec.result, control);
    return { rec, control, task, log, attack };
  }
  return { env, rafs, frame, nextTimer, flush, until, battle };
}

async function test() {
  const g = setup(), b = g.battle(); await g.flush();
  assert.equal(b.attack.playing, true, '真 playRound 正在 await 出手动画');
  const late = [...g.rafs.values()];
  b.control.skip(true); b.control.skip(true);
  await g.frame(false); await g.flush();
  assert.equal(b.rec.phase, 'result', '跳过应立即离开未播完动作，进入真实战果阶段');
  assert.equal(b.log.reward, 1); assert.equal(b.log.end, 0, '进入战果不能提前触发最终结算回调');
  assert.deepEqual(b.log.skips, [true], '重复跳过不能重复补领奖励');
  assert.deepEqual(Array.from(b.rec.result.hpAfter), [73, 0], '跳过仍报告最后回合的剩余血量');
  const writes = b.attack.writes;
  b.attack.frame = 59;
  for (const fn of late) fn(0);
  await g.flush();
  assert.equal(b.attack.writes, writes, '已终止的动作观察器不能在战果页继续改帧');
  assert.equal(b.log.idleAfterResult, 0);
  await g.until(() => !!b.rec.chestPick, '跳过后仍应到真实选箱阶段');
  await g.nextTimer(); await g.frame(true);
  assert.equal(b.log.end, 0); assert.equal(g.env.granted.length, 0, '未选箱不能发宝箱奖或自动离场');
  g.env.SfFight.pickChest(2); g.env.SfFight.pickChest(2);
  await g.flush();
  assert.equal(g.env.granted.length, 0, '已跳过战斗也不能跳过选箱后的揭晓动画');
  assert.equal(b.rec.confirmChest, undefined);
  await g.frame(true);
  assert.ok(b.rec.confirmChest, '选箱动画完成后揭晓并等待玩家确认');
  assert.equal(g.env.granted.length, 1); assert.equal(b.log.end, 0);
  g.env.SfFight.confirmChest(); g.env.SfFight.confirmChest(); await b.task;
  assert.equal(b.log.end, 1); assert.equal(b.log.reward, 1);

  const canceled = g.battle(); await g.flush(); canceled.control.cancel();
  await g.frame(true); await g.nextTimer();
  assert.equal(canceled.log.reward, 0); assert.equal(canceled.log.end, 0, 'cancel 不等价于战斗完成');
  const canceledResult = g.battle({ rounds: [] });
  canceledResult.control.skip(true); await g.flush();
  assert.equal(canceledResult.rec.phase, 'result');
  const resultWrites = canceledResult.rec.view.writes;
  canceledResult.control.cancel();
  const replacement = g.battle({ rounds: [], hudReady: new Promise(() => {}), skipChest: true });
  await g.flush();
  assert.equal(canceledResult.rec.view.writes, resultWrites, '战果等待被取消后旧树不能继续切宝箱');
  assert.equal(replacement.rec.sleepers.size, 0, '旧场的宝箱等待不能注册到新场');
  assert.equal(canceledResult.log.end, 0); assert.equal(replacement.log.reward, 0);
  replacement.control.cancel();
  const prelude = g.battle({ rounds: [], hudReady: new Promise(() => {}), skipChest: true });
  prelude.control.skip(true); await g.flush();
  assert.equal(prelude.rec.phase, 'result', 'HUD 前奏未完成时跳过也能结算');
  await g.until(() => prelude.log.end === 1, '前奏跳过正常完成'); await prelude.task;
  const natural = g.battle({ rounds: [], skipChest: true });
  await g.until(() => natural.log.end === 1, '自然结束继续执行真实结算'); await natural.task;
  assert.equal(natural.log.reward, 1); assert.equal(natural.rec.result.skipped, false);
}

test().then(() => console.log('PASS 经典跳过及时终止演出，保留战果、宝箱与一次结算；取消不结算'))
  .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
