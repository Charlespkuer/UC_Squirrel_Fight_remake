#!/usr/bin/env node
/* ============================================================
 * tools/test-buff-report.cjs — 调试台「无尽塔增益总览」回归
 *
 * 需求：调试台要能看到无尽塔里**获得过的所有 buff**，包括一次生效类（立即进货 /
 * 试炼补贴）与损毁消失类（易碎烙印），并给出当前 buff 对玩家的**全部提升效果**。
 *
 * 这里在真实的 Tower 状态机上跑一局，逐项断言 Tower.debugBuffReport() 的内容。
 * 用法：node tools/test-buff-report.cjs
 * ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function findRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'index.html'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(start, '..');
}
const ROOT = findRoot(__dirname);

function setup() {
  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
  const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  }
  c.State.newGame('增益总览测试');
  const S = c.State.state();
  S.level = 70;
  for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };
  return c;
}

/** 开一局干净的无尽塔；上一局的残留先收干净。 */
function freshRun(c) {
  const { Tower } = c;
  Tower._debugSetLayer(9);
  let started = Tower.startEndlessRun();
  for (let guard = 0; !started.ok && guard < 5; guard++) {
    const run = Tower._debugRun('endless');
    if (run && run.attempt) { try { Tower.reportBattle('endless', run.attempt, false, 0); } catch (e) { /* 忽略 */ } }
    try { Tower.abandon('endless'); } catch (e) { /* 忽略 */ }
    started = Tower.startEndlessRun();
  }
  assert.ok(started.ok, '应该能开一局无尽塔：' + (started.msg || ''));
  return started;
}
/** 打完一场（默认胜利），用来推进限次增益的消耗。
 *  场间选择会自动处理（含「永久位已满 → 需要指定替换目标」的情况）。 */
function playOne(c, win) {
  const { Tower } = c;
  let run = Tower._debugRun('endless');
  assert.ok(run, '应该有进行中的对局');
  if (run.choices) {
    const pick = Tower.pickChoice('endless', 0, null);
    if (pick && !pick.ok && pick.needsReplace) {
      const owned = (run.permanent || [])[0];
      Tower.pickChoice('endless', 0, owned ? owned.id : null);
    }
    run = Tower._debugRun('endless');
  }
  /* 商店 / 结算点要先走完，否则 nextBattle 会以「请先完成商店与结算」拒绝。 */
  if (run.phase === 'shop') { Tower.continueFromShop(); run = Tower._debugRun('endless'); }
  else if (run.phase === 'checkpoint') { Tower.continueEndless(); run = Tower._debugRun('endless'); }
  const nx = Tower.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应该能开出下一场：' + ((nx && nx.msg) || ''));
  const token = Tower._debugRun('endless').attempt;
  assert.ok(token, '开战后应该有 attempt 令牌');
  return Tower.reportBattle('endless', token, win !== false, 1, null);
}
const byName = (rep, name) => (rep.collected || []).filter((x) => x.name === name);
const histOf = (rep, name) => (rep.history || []).filter((e) => {
  const id = e.id;
  return id === name || (byName(rep, name).some((x) => x.id === id));
});

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('一次生效类：用过之后仍然查得到，并写清「立即生效了什么」', () => {
  const c = setup();
  freshRun(c);
  const coinBefore = c.Tower._debugRun('endless').coins || 0;
  const g = c.Tower.debugGrantBuff('E03');           // 财源滚滚：立即 +120 试炼币
  assert.ok(g.ok, '应该能获得一次生效类增益');
  const coinsNow = c.Tower._debugRun('endless').coins || 0;
  assert.equal(coinsNow - coinBefore, 120, '立即生效类应当真的加币');

  const rep = c.Tower.debugBuffReport('endless');
  assert.ok(rep.ok, '应该能拿到收益报告');
  const hits = byName(rep, '财源滚滚');
  assert.equal(hits.length, 1, '一次生效类应当出现在「已获得过」里：' + JSON.stringify(rep.collected.map((x) => x.name)));
  assert.match(hits[0].tag, /立即生效/, '一次生效类要标注「立即生效」：' + hits[0].tag);
  assert.match(hits[0].detail, /试炼币 \+\d+/, '要写清具体给了多少：' + hits[0].detail);
  const log = rep.history.find((e) => e.id === 'E03');
  assert.ok(log, '流水里应当有这条记录');
  assert.equal(log.event, 'instant', '流水事件应是 instant');
  // 它不该出现在「当前生效」的永久/限次列表里（确实没有留存）
  const pending = c.Tower._debugRun('endless');
  assert.ok(!(pending.permanent || []).some((b) => b.id === 'E03'), '一次生效类不该留在 permanent 里');
  assert.ok(!(pending.limited || []).some((b) => b.id === 'E03'), '一次生效类不该留在 limited 里');
});

test('损毁消失类：易碎烙印损毁后仍能查到，且「永久保留的加成」继续显示', () => {
  const c = setup();
  freshRun(c);
  const run = c.Tower._debugRun('endless');
  const g = c.Tower.debugGrantBuff('C39');           // 力量烙印：基础 +8%，存在时半效
  assert.ok(g.ok, '应该能获得易碎烙印');
  /* 需求 3：拿到时登记的是「基础加成」（不是 stickyStat），实际生效值 = 基础的一半。 */
  assert.equal(Number((run.fragileBase || {}).power), 0.08, '拿到烙印时应当登记基础加成 0.08');

  // 强行让它损毁：连打若干场直到碎裂（每条烙印有自己的随机序列，不能靠改 Math.random）
  let broken = false;
  for (let i = 0; i < 300 && !broken; i++) {
    playOne(c, true);
    if (!(c.Tower._debugRun('endless').limited || []).some((b) => b.id === 'C39')) broken = true;
  }
  assert.ok(broken, '300 场之内力量烙印应当碎掉（每场 6%）');

  const rep = c.Tower.debugBuffReport('endless');
  const after = c.Tower._debugRun('endless');
  assert.ok(!(after.limited || []).some((b) => b.id === 'C39'), '损毁后烙印本身应当已经不在身上');
  const hits = byName(rep, '力量烙印');
  assert.ok(hits.length >= 1, '损毁类应当仍出现在「已获得过」里：' + JSON.stringify(rep.collected.map((x) => x.name)));
  const tags = hits.map((x) => x.tag).join(' ');
  assert.match(tags, /已获得/, '应当能看到「获得过」这一条：' + tags);
  assert.match(tags, /已损毁/, '应当能看到「损毁」这一条：' + tags);
  const broke = rep.history.find((e) => e.id === 'C39' && e.event === 'break');
  assert.ok(broke, '流水里应当有损毁记录：' + JSON.stringify(rep.history));
  /* 需求 3：损毁后升为全额并本局永久保留 —— 实际 = 0.5×基础 + 已损毁那份。
   * 注意：这 300 场里玩家**可能在休整点又选到同一枚烙印**（C39 在无尽选择池与商店池里），
   * 那样 fragileBase 会涨到 0.16、显示 +24% —— 所以期望必须按**真实的 base/burned**推导，
   * 不能硬编码 +12%（原来那样写会让这条断言随机红）。 */
  const powerLine = rep.effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.ok(powerLine, '效果清单里应当仍列出烙印攻击：' + JSON.stringify(rep.effects));
  assert.match(powerLine[0], /已损毁/, '损毁后要标「已损毁·全额永久」：' + powerLine[0]);
  const fb = after.fragileBase || {}, bn = after.fragileBurned || {};
  const expectPct = Math.round((Number(fb.power || 0) * 0.5 + Number(bn.power || 0)) * 100);
  assert.ok(expectPct > 0, '损毁后应当有永久保留的加成：' + expectPct);
  assert.match(powerLine[1], new RegExp('\\+' + expectPct + '%'),
    '损毁后的实际加成应当是 +' + expectPct + '%（基础 ' + fb.power + ' + 已损毁 ' + bn.power + '）：' + powerLine[1]);
});

test('限次类：用尽消失后仍查得到，剩余场数与用尽记录都对', () => {
  const c = setup();
  freshRun(c);
  assert.ok(c.Tower.debugGrantBuff('N01').ok, '应该能获得限次增益（蓄力一击，2 场）');
  let rep = c.Tower.debugBuffReport('endless');
  let hit = byName(rep, '蓄力一击')[0];
  assert.ok(hit, '限次增益应当在已获得列表里');
  assert.match(hit.tag, /剩2 场|剩 2 场/, '要显示剩余场数：' + hit.tag);

  playOne(c, true);                                   // 用掉 1 次 → 剩 1
  rep = c.Tower.debugBuffReport('endless');
  hit = byName(rep, '蓄力一击')[0];
  assert.match(hit.tag, /剩1 场|剩 1 场/, '打一场后应当剩 1 场：' + hit.tag);

  playOne(c, true);                                   // 用尽 → 自动消失
  rep = c.Tower.debugBuffReport('endless');
  const gone = c.Tower._debugRun('endless');
  assert.ok(!(gone.limited || []).some((b) => b.id === 'N01'), '用尽后不该还挂在本局身上');
  hit = byName(rep, '蓄力一击')[0];
  assert.ok(hit, '用尽后应当仍能在「已获得过」里查到');
  // 同 id 可能既有「获得」也有「用尽」，所以按 id 取那条用尽记录对应的 chip
  const expired = byName(rep, '蓄力一击');
  assert.ok(expired.length, '用尽的那条应当出现在已获得列表里：' + JSON.stringify(rep.collected));
  const etags = expired.map((x) => x.tag).join(' ');
  assert.match(etags, /已用尽消失/, '要标注用尽：' + etags);
  assert.ok(rep.history.some((e) => e.id === 'N01' && e.event === 'expire'), '流水里应当有用尽记录');
});

test('当前实际提升：列出所有生效增益的合计效果（不是只报个名字）', () => {
  const c = setup();
  freshRun(c);
  c.Tower.debugGrantBuff('C29');                      // 体质：生命上限 +10%（永久）
  c.Tower.debugGrantBuff('N01');                      // 蓄力一击：攻击 +40%（2 场）
  c.Tower.debugGrantBuff('N07');                      // 破军：暴击率 +20%、暴击伤害 +30%（3 场）
  c.Tower.debugGrantBuff('M03');                      // 坚守：受到伤害 −30%（2 场）
  const rep = c.Tower.debugBuffReport('endless');
  const map = Object.fromEntries(rep.effects);
  assert.ok(map['生命上限'], '应当列出生命上限：' + JSON.stringify(rep.effects));
  assert.match(map['生命上限'], /\+10%/, '生命上限应当 +10%（永久类会写进「永久累计」）：' + map['生命上限']);
  assert.ok(map['攻击'] && /\+40%/.test(map['攻击']), '攻击应当 +40%：' + map['攻击']);
  assert.ok(map['暴击率'] && /\+20%/.test(map['暴击率']), '暴击率应当 +20%：' + map['暴击率']);
  assert.ok(map['受到伤害'] && /-30%/.test(map['受到伤害']), '受到伤害应当 −30%：' + map['受到伤害']);
  // 槽位占用也要报出来（永久类上限 5）
  assert.ok(rep.slots && rep.slots.cap > 0, '应当报出永久槽位占用：' + JSON.stringify(rep.slots));
  assert.ok(rep.slots.used >= 1, '至少占 1 个永久槽：' + JSON.stringify(rep.slots));
});

test('挑战塔/无对局都要给明确答复，不能抛错', () => {
  const c = setup();
  assert.equal(c.Tower.debugBuffReport('endless').ok, false, '没有对局时应当返回 ok:false');
  assert.match(c.Tower.debugBuffReport('endless').msg, /没有/, '要给出原因');
  assert.equal(c.Tower.debugBuffReport('tower').ok, false, '挑战塔没有对局同样返回 ok:false');
});

test('调试台渲染：三块都出来（当前提升 / 已获得过的全部 / 流水）', () => {
  const c = setup();
  freshRun(c);
  c.Tower.debugGrantBuff('C29');    // 永久：生命上限 +10%
  c.Tower.debugGrantBuff('N01');    // 限次：攻击 +40%，2 场
  c.Tower.debugGrantBuff('E03');    // 一次生效：+120 试炼币

  // 切出 debug.js 里真实的 renderBuffReport 来跑
  const src = fs.readFileSync(path.join(ROOT, 'js', 'debug.js'), 'utf8');
  const start = src.indexOf('function renderBuffReport');
  assert.ok(start > 0, 'debug.js 里应该有 renderBuffReport');
  const end = src.indexOf('\n  function isOpen()', start);
  assert.ok(end > start, '找不到 renderBuffReport 的结尾');
  const body = src.slice(start, end);

  const node = { innerHTML: '' };
  const root = { querySelector: (sel) => (sel === '[data-buff-report]' ? node : null) };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const ctx = vm.createContext({ window: c, Tower: c.Tower, TowerData: c.TowerData, esc, console });
  vm.runInContext(body + '\nrenderBuffReport;', ctx, { filename: 'renderBuffReport.js' })(root);

  const html = node.innerHTML;
  assert.ok(html.length > 100, '渲染出来的内容不该是空的：' + html.slice(0, 120));
  assert.match(html, /当前实际提升/, '要有「当前实际提升」那一块（所有生效增益的合计）');
  assert.match(html, /已获得过的全部增益/, '要有「已获得过的全部」那一块');
  assert.match(html, /获取 \/ 消失流水/, '要有流水那一块');
  assert.match(html, /生命上限/, '效果清单里要列出生命上限');
  assert.match(html, /\+10%/, '生命上限的数值要带出来');
  assert.match(html, /体质/, '永久增益要出现在已获得列表里');
  assert.match(html, /财源滚滚/, '一次生效类也要出现在已获得列表里');
  assert.match(html, /已立即生效/, '一次生效类要标「已立即生效」');
  assert.match(html, /debug-effect/, '效果清单要用手搓的 pill 样式（.debug-effect）');
  assert.match(html, /debug-buff-log/, '流水要渲染成列表');
  // 没对局时不能崩，要给出提示
  const c2 = setup();
  const ctx2 = vm.createContext({ window: c2, Tower: c2.Tower, TowerData: c2.TowerData, esc, console });
  const fn2 = vm.runInContext(body + '\nrenderBuffReport;', ctx2, { filename: 'renderBuffReport2.js' });
  const node2 = { innerHTML: '' };
  fn2({ querySelector: () => node2 });
  assert.match(node2.innerHTML, /增益总览/, '没对局时也要显示标题');
  assert.match(node2.innerHTML, /无尽塔/, '并说明需要先开始一局');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ' | ' + (e && e.message)); if (process.env.SSDZ_VERBOSE) console.log(e && e.stack); }
  }
  console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${cases.length} 项）`);
  process.exit(failed ? 1 : 0);
})();
