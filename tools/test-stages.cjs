/* Run: node tools/test-stages.cjs. Uses the shipped State and actual mission UI callbacks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
/** 项目根：从脚本所在目录往上找含 index.html 的那一层（tools/ 放哪都能用）。 */
function findRoot(start) {
  const fsx = require('node:fs'), px = require('node:path');
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fsx.existsSync(px.join(d, 'index.html'))) return d;
    const up = px.dirname(d);
    if (up === d) break;
    d = up;
  }
  return px.resolve(start, '..');
}

const root = findRoot(__dirname);

function setup() {
  const storage = new Map(), pages = [], modals = [], battles = [];
  function elementRoot(html) {
    const nodes = new Map();
    for (const match of html.matchAll(/data-action="([^"]+)"/g)) nodes.set('[data-action="' + match[1] + '"]', { dataset: { action: match[1] }, textContent: '', onclick: null });
    return { html, querySelector: selector => nodes.get(selector) || null };
  }
  const c = { console, location: { search: '?qa=1' }, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } };
  c.window = c;
  vm.createContext(c);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  vm.runInContext('Math.random = () => 0.9', c); // Keep rewards independent of offline fragment RNG.
  c.State.newGame('关卡测试');
  Object.assign(c.State.state(), { level: 10, exp: 0, energy: 0, props: { 23: 10 } });
  c.esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  c.btn = (label, action, cls) => '<button class="' + (cls || '') + '" data-action="' + action + '">' + label + '</button>';
  c.$ = (selector, node) => node.querySelector(selector);
  c.page = (group, active, html) => { const page = elementRoot(html + c.btn('返回菜单', 'home')); pages.push(page); return page; };
  c.modal = (title, html, buttons) => { const modal = { title, html, buttons }; modals.push(modal); return modal; };
  c.notice = (msg, buttons) => c.modal('提示', c.esc(msg), buttons || [{ label: '确定' }]);
  c.home = () => { c.homeCount = (c.homeCount || 0) + 1; };
  c.openProp = id => { c.openedProp = id; };
  c.Main = { startBattle: (foe, opts) => { battles.push({ foe, opts }); return Promise.resolve(); } };
  const ui = fs.readFileSync(path.join(root, 'js/classic-ui.js'), 'utf8');
  const start = ui.indexOf('  const NPC_FILE='), end = ui.indexOf('  function openBag(', start);
  assert.ok(start >= 0 && end > start, 'Mission UI block is present');
  vm.runInContext(ui.slice(start, end), c, { filename: 'classic-ui.js mission callbacks' });
  return {
    c, storage, pages, modals, battles,
    s: () => c.State.state(),
    click(action) { const node = pages.at(-1).querySelector('[data-action="' + action + '"]'); assert.ok(node && node.onclick, action); node.onclick(); },
    modalClick(label) { const button = modals.at(-1).buttons.find(button => button.label === label); assert.ok(button && button.run, 'Modal action: ' + label); button.run(); },
    settle(index, win = true) { battles[index].opts.onEnd(win ? 0 : 1); },
    begin(id = 1) { const started = c.State.beginStageBattle(id); assert.equal(started.ok, true, started.msg); return started; },
    win(id = 1) { const started = this.begin(id); return c.State.finishStageBattle(id, started.token, true); },
    saved() { return JSON.parse(storage.get(c.State.saveKey)); },
  };
}
const tests = [];
const test = (name, run) => tests.push([name, run]);

test('54位关卡NPC全部匹配所属高手和星级，修正原表4星仙鹤误写stageId', () => {
  const g = setup();
  for (let id = 1; id <= 18; id++) for (let npcIndex = 1; npcIndex <= 3; npcIndex++) {
    const npc = g.c.State.npcOf(id, npcIndex);
    assert.ok(npc, 'NPC ' + id + '/' + npcIndex);
    assert.equal(npc.name.startsWith(g.c.GData.stageStar(id) + '星' + g.c.GData.stageTypeOf(id).name), true, npc.name);
    assert.equal(Number(npc.stageId), id);
  }
  assert.equal(g.c.State.npcOf(4, 1).id, '109'); assert.equal(g.c.State.npcOf(10, 1).id, '127');
});

test('10级门槛、18关逐星解锁、跨高手边界全部生效', () => {
  const g = setup(); g.s().level = 9;
  assert.equal(g.c.State.stageAccess(1).ok, false); assert.equal(g.c.State.beginStageBattle(1).ok, false);
  g.s().level = 10;
  assert.equal(g.c.State.stageAccess(1).ok, true);
  for (let id = 2; id <= 18; id++) assert.equal(g.c.State.stageAccess(id).ok, false);
  for (const id of [0, 1.5, 19, NaN]) assert.equal(g.c.State.beginStageBattle(id).ok, false);
  for (let id = 1; id <= 18; id++) {
    assert.equal(g.c.State.stageAccess(id).ok, true, 'Stage ' + id + ': ' + g.c.State.stageAccess(id).msg);
    g.s().props[23] = 1;
    g.win(id); g.win(id); const reward = g.win(id);
    assert.equal(reward.complete, true); assert.equal(reward.exp, (18 + ((id - 1) % 6)) * g.c.GData.STAGE_REWARD_MULT); assert.equal(reward.gold, 25 * g.c.GData.STAGE_GOLD_MULT);
    assert.equal(g.c.State.highestStageId(), id + 1);
    if (id < 17) assert.equal(g.c.State.stageAccess(id + 2).ok, false);
  }
});

test('三战只付1书，零体力也可开战，整轮总奖励只发一次', () => {
  const g = setup(), s = g.s(); s.props[23] = 1;
  let started = g.begin(); assert.equal(s.props[23], 0); assert.equal(s.energy, 0);
  assert.equal(g.c.State.beginStageBattle(1).ok, false);
  let rw = g.c.State.finishStageBattle(1, started.token, true);
  assert.equal(rw.complete, false); assert.equal(rw.exp, 3 * g.c.GData.STAGE_REWARD_MULT); assert.equal(s.goldPoint, 100);
  assert.equal(g.c.State.finishStageBattle(1, started.token, true).ok, false);
  started = g.begin(); assert.equal(started.npcIndex, 2); g.c.State.finishStageBattle(1, started.token, true);
  assert.equal(s.exp, 7 * g.c.GData.STAGE_REWARD_MULT); assert.equal(s.goldPoint, 100);
  started = g.begin(); assert.equal(started.npcIndex, 3); rw = g.c.State.finishStageBattle(1, started.token, true);
  assert.equal(rw.complete, true); assert.equal(s.exp, 25 * g.c.GData.STAGE_REWARD_MULT); assert.equal(s.goldPoint, 100 + 25 * g.c.GData.STAGE_GOLD_MULT);
  assert.equal(g.c.State.stageRun(1), null); assert.equal(g.c.State.stageProgress(1).passed, true);
  const saved = JSON.stringify(g.saved());
  assert.equal(g.c.State.finishStageBattle(1, started.token, true).ok, false); assert.equal(JSON.stringify(g.saved()), saved);
});

test('续关、刷新和中断重试不会再扣书，旧回调不能推进新战斗', () => {
  const g = setup(); g.s().props[23] = 1;
  g.win(); g.c.State.save(); g.c.State.load();
  assert.equal(g.c.State.stageRun(1).npcIndex, 2); assert.equal(g.s().props[23] || 0, 0);
  const interrupted = g.begin(); assert.equal(g.c.State.interruptStageBattle(1, interrupted.token), true);
  const resumed = g.begin(); assert.notEqual(resumed.token, interrupted.token);
  assert.equal(g.c.State.finishStageBattle(1, interrupted.token, true).ok, false);
  g.c.State.load(); assert.equal(g.c.State.stageRun(1).attempt, undefined);
  const afterReload = g.begin(); assert.equal(afterReload.npcIndex, 2);
  assert.equal(g.c.State.finishStageBattle(1, resumed.token, true).ok, false);
  g.c.State.finishStageBattle(1, afterReload.token, true); g.win();
  assert.equal(g.s().exp, 25 * g.c.GData.STAGE_REWARD_MULT); assert.equal(g.s().goldPoint, 100 + 25 * g.c.GData.STAGE_GOLD_MULT); assert.equal(g.s().energy, 0);
});

test('每次复活另付1书，最多2次，资源不足和重载不会绕过限制', () => {
  const g = setup(); g.s().props[23] = 1;
  const first = g.begin(); g.c.State.finishStageBattle(1, first.token, false);
  assert.equal(g.c.State.beginStageBattle(1).needsBook, true);
  assert.equal(g.c.State.stageRun(1).revives, 0);
  g.s().props[23] = 3;
  for (let revival = 1; revival <= 2; revival++) {
    const started = g.begin(); assert.equal(g.c.State.stageRun(1).revives, revival);
    assert.equal(started.npcIndex, 1); assert.equal(g.s().props[23], 3 - revival);
    g.c.State.finishStageBattle(1, started.token, false);
    g.c.State.save(); g.c.State.load();
  }
  assert.equal(g.c.State.beginStageBattle(1).ok, false); assert.equal(g.s().props[23], 1);
  assert.equal(g.s().exp, 0); assert.equal(g.s().goldPoint, 100);
  assert.equal(g.c.State.abandonStageRun(1), true);
  const fresh = g.begin(); assert.equal(fresh.npcIndex, 1); assert.equal(g.c.State.stageRun(1).revives, 0); assert.equal(g.s().props[23], 0);
});

test('复活后刷新重试不会再收费或增加复活数，后续NPC延续计数', () => {
  const g = setup(), first = g.begin(); g.c.State.finishStageBattle(1, first.token, false);
  const second = g.begin(); assert.equal(g.s().props[23], 8); assert.equal(g.c.State.stageRun(1).revives, 1);
  g.c.State.load(); const resumed = g.begin(); assert.equal(g.s().props[23], 8);
  assert.equal(g.c.State.stageRun(1).revives, 1); assert.notEqual(resumed.token, second.token);
  g.c.State.finishStageBattle(1, resumed.token, true); const npc2 = g.begin();
  g.c.State.finishStageBattle(1, npc2.token, false); assert.equal(g.c.State.stageRun(1).npcIndex, 2);
  g.begin(); assert.equal(g.s().props[23], 7); assert.equal(g.c.State.stageRun(1).revives, 2);
});

test('结束、重打和失败不倒退既有通关记录，重打从NPC1开始', () => {
  const g = setup(); g.win(); g.win(); g.win();
  let started = g.begin(); assert.equal(started.npcIndex, 1); assert.equal(g.c.State.stageProgress(1).passed, true);
  assert.equal(g.c.State.abandonStageRun(1), false); // Cannot cancel an in-flight callback.
  g.c.State.finishStageBattle(1, started.token, false);
  g.c.State.abandonStageRun(1); g.c.State.load();
  assert.equal(g.c.State.stageProgress(1).passed, true); assert.equal(g.c.State.highestStageId(), 2);
  started = g.begin(); assert.equal(started.npcIndex, 1);
  g.c.State.finishStageBattle(1, started.token, true); g.win(); g.win();
  // 这一段里前前后后一共通关两次，所以金松果是两轮的 25
  assert.equal(g.s().exp, 50 * g.c.GData.STAGE_REWARD_MULT); assert.equal(g.s().goldPoint, 100 + 2 * 25 * g.c.GData.STAGE_GOLD_MULT);
});

test('结束未完局后重载不会从历史NPC记录重新生成免费续局', () => {
  const g = setup(); g.win(); assert.equal(g.c.State.stageProgress(1).npcIndex, 2);
  g.c.State.abandonStageRun(1); g.c.State.load();
  assert.equal(g.c.State.stageRun(1), null);
  const books = g.s().props[23], fresh = g.begin();
  assert.equal(fresh.npcIndex, 1); assert.equal(g.s().props[23], books - 1);
});

test('旧版未完NPC、原版keep/revive和异常越级旧进度都能兼容迁移', () => {
  const g = setup();
  g.storage.set(g.c.State.saveKey, JSON.stringify({ level: 10, goldPoint: 888, props: {}, stages: { 7: { npcIndex: 2, passed: false }, 12: { npcIndex: 3, passed: true }, 13: { npcIndex: 2, passed: false, keep: true, revive: true, revives: 1 } } }));
  g.c.State.load(); assert.equal(g.s().goldPoint, 888); assert.equal(g.c.State.highestStageId(), 13);
  assert.equal(g.c.State.stageRun(7).npcIndex, 2); assert.equal(g.begin(7).npcIndex, 2);
  assert.equal(g.c.State.stageRun(12), null); assert.equal(g.c.State.stageProgress(12).passed, true);
  assert.equal(g.c.State.stageRun(13).needsRevive, true); assert.equal(g.c.State.beginStageBattle(13).needsBook, true);
  assert.equal(g.c.State.stageAccess(14).ok, false);
  const old = setup();
  old.storage.set(old.c.State.saveKey, JSON.stringify({ level: 10, stages: { 7: { npcIndex: 2 } }, props: {} })); old.c.State.load();
  assert.equal(old.c.State.highestStageId(), 1); assert.equal(old.c.State.stageAccess(7).ok, true); assert.equal(old.c.State.stageAccess(8).ok, false);
  old.c.openStages(); old.click('type1'); old.click('star1'); assert.match(old.modals.at(-1).html, /不消耗挑战书/);
});

test('UI锁定高手和灰星不会进入战斗或扣书', () => {
  const g = setup(); g.s().level = 9;
  g.c.openStages(); g.click('type0'); assert.match(g.modals.at(-1).html, /10级/);
  g.s().level = 10; g.c.openStages(); g.click('type1'); assert.match(g.modals.at(-1).html, /前面关卡/);
  g.click('type0'); g.click('star6'); assert.match(g.modals.at(-1).html, /前面关卡/);
  assert.equal(g.battles.length, 0); assert.equal(g.s().props[23], 10);
  assert.match(g.pages.at(-1).html, /class="small muted" data-action="star6"/);
});

test('UI三战与稍后继续完整连通，只付1书且重复战后回调被忽略', () => {
  const g = setup(); g.s().props[23] = 1;
  g.c.openStages(); g.click('type0'); g.click('star1');
  const expRow = [1, 2, 3].map((i) => g.c.GData.stageNpcExp(1, i)).join('/');
  assert.match(g.modals.at(-1).html, new RegExp('每场经验 ' + expRow));
  g.modalClick('开始战斗'); assert.equal(g.battles.length, 1); assert.equal(g.battles[0].opts.cost, undefined); assert.equal(g.battles[0].opts.useProps, false);
  g.settle(0); const count = g.modals.length; g.settle(0); assert.equal(g.modals.length, count);
  g.modalClick('稍后继续'); g.click('star1'); assert.match(g.modals.at(-1).html, /不消耗挑战书/);
  g.modalClick('继续战斗'); g.settle(1); g.modalClick('继续挑战'); g.modalClick('继续战斗'); g.settle(2);
  assert.equal(g.battles[1].opts.hpRatio, 0.25); assert.equal(g.battles[2].opts.hpRatio, 0.25);
  assert.match(g.modals.at(-1).html, new RegExp('经验 \\+' + (18 * g.c.GData.STAGE_REWARD_MULT) + '　通关金松果 \\+' + (25 * g.c.GData.STAGE_GOLD_MULT)));
  assert.equal(g.s().goldPoint, 100 + 25 * g.c.GData.STAGE_GOLD_MULT); assert.equal(g.s().props[23], 0);
  g.modalClick('继续闯关'); assert.match(g.pages.at(-1).html, /class="small" data-action="star2"/);
  g.click('star1'); assert.match(g.modals.at(-1).html, /（1\/3）/); assert.doesNotMatch(g.modals.at(-1).html, /data-action="npc/);
});

test('UI失败复活、结束确认、购买挑战书与错误重试都有出口', () => {
  const g = setup(); g.s().props[23] = 1;
  g.c.stageConfirm(1); g.modalClick('开始战斗'); g.settle(0, false);
  g.modalClick('复活再战'); assert.match(g.modals.at(-1).html, /复活需1个挑战书/);
  g.modalClick('复活再战'); g.modalClick('购买挑战书'); assert.equal(g.c.openedProp, 23);
  g.s().props[23] = 2;
  for (let i = 1; i <= 2; i++) { g.c.stageConfirm(1); g.modalClick('复活再战'); g.settle(i, false); }
  assert.equal(g.modals.at(-1).buttons.some(button => button.label === '复活再战'), false);
  g.modalClick('结束本轮'); assert.match(g.modals.at(-1).html, /记录会保留/); g.modalClick('结束本轮'); assert.equal(g.c.State.stageRun(1), null);
  g.s().props[23] = 1; g.c.stageConfirm(1); g.modalClick('开始战斗'); g.battles[3].opts.onError();
  assert.equal(g.c.State.stageRun(1).attempt, undefined); assert.equal(g.s().props[23], 0);
  g.c.stageConfirm(1); g.modalClick('继续战斗'); assert.equal(g.battles.length, 5);
});

test('战果按最后一帧剩余血量继承，缺少 hpAfter 也不抛错（跳过同样安全）', () => {
  const g = setup(); g.s().props[23] = 5;
  g.c.openStages(); g.click('type0'); g.click('star1');
  g.modalClick('开始战斗');
  assert.equal(g.battles.length, 1);
  // Battle 结束时会把最后一帧的 hpAfter 提到 result 上（Sim.simulate 本身只在逐帧里给），
  // 关卡连战据此继承剩余血量比例：300/400 = 0.75。
  g.battles.at(-1).opts.onEnd(0, { winner: 0, maxHp: [400, 100], hpAfter: [300, 0], rounds: [
    { attacker: 0, action: 'common', dmg: 20, hpAfter: [380, 100] },
    { attacker: 0, action: 'common', dmg: 100, hpAfter: [300, 0] },
  ] });
  assert.equal(g.c.State.stageRun(1).carryHp, 0.75);
  // 旧/异常形状：result 上只有逐帧 hpAfter（修复前这里会抛 TypeError 并被丢回主界面）。
  g.modalClick('继续挑战'); g.modalClick('继续战斗');
  assert.doesNotThrow(() => g.battles.at(-1).opts.onEnd(0, { winner: 0, maxHp: [400, 100], rounds: [
    { attacker: 0, action: 'common', dmg: 100, hpAfter: [120, 0] },
  ] }));
  assert.equal(g.c.State.stageRun(1).carryHp, 0);
  assert.equal(g.c.homeCount, undefined);
});

test('异步战斗启动失败可继续已付费本轮，清理token并回到关卡页', async () => {
  const g = setup(); g.s().props[23] = 1;
  const pagesBefore = g.pages.length;
  g.c.Main.startBattle = () => Promise.reject(new Error('Resource unavailable'));
  g.c.stageFight(1); await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.s().props[23], 0); assert.equal(g.c.State.stageRun(1).attempt, undefined);
  // 中断后应留在关卡页（战果弹窗的背景），而不是被丢回主界面
  assert.equal(g.c.homeCount, undefined);
  assert.ok(g.pages.length > pagesBefore, '回到关卡页');
  assert.match(g.modals.at(-1).html, /本轮进度已保留/);
  assert.equal(g.begin().npcIndex, 1); assert.equal(g.s().props[23], 0);
});

(async () => {
  test('连续挑战继承剩余血量（回复25%），失败复活回满，重载保留', () => {
  const g = setup(); g.s().props[23] = 5;
  let started = g.begin();
  g.c.State.finishStageBattle(1, started.token, true, 0.4);
  assert.equal(g.c.State.stageRun(1).carryHp, 0.4);
  g.c.State.save(); g.c.State.load();
  assert.equal(g.c.State.stageRun(1).carryHp, 0.4);
  started = g.begin();
  g.c.State.finishStageBattle(1, started.token, false);
  assert.equal(g.c.State.stageRun(1).carryHp, undefined);
});

let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS', name); }
    catch (error) { failed++; console.error('FAIL', name, error.stack); }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  process.exitCode = failed ? 1 : 0;
})();
