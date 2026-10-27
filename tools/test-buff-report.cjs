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

function setup(seed) {
  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
  const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  c.window = c; c.self = c;
  vm.createContext(c);
  /* 【固定随机流】这一局要抽层、抽间场增益、抽巡逻替换……不固定的话「抽到哪一条」每次都不同，
   * 断言就会偶发红灯：2026-10 远端 **windows-latest 就红过一次**（同一个提交 ubuntu / macos 都过，
   * 本机连跑 40 次也不复现）—— 属于典型的「概率性断言没固定随机流」。
   * 这里换成确定性 LCG：每个用例都从同一个种子开始，走同一条路径。
   *（`Date` 上面已经固定成 2026-09-26 12:00，两个时间源一起钉死。） */
  vm.runInContext('(function(){var s=' + (Number(seed) || 20260926) +
    ';Math.random=function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};})()', c);
  for (const f of ['js/gamedict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js', 'js/tower-plot.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  }
  c.State.newGame('增益总览测试');
  const S = c.State.state();
  S.level = 70;
  for (let i = 1; i <= 36; i++) S.stages[i] = { npcIndex: 3, passed: true };
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
  const g = c.Tower.debugGrantBuff('C39');           // 力量烙印：存在 +5%，损毁后 +8%
  assert.ok(g.ok, '应该能获得易碎烙印');
  /* 2026-10：拿到时登记的是**存在值**（fragilePct，不再是「基础的一半」）。 */
  assert.equal(Number((run.fragileBase || {}).power), 0.05, '拿到烙印时应当登记存在值 0.05');

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
  /* 2026-10：损毁后升为损毁值（fragileBurnedPct）并本局永久保留 ——
   * 实际 = 尚未破碎的存在值 + 已损毁那份。
   * 注意：这 300 场里玩家**可能在休整点又选到同一枚烙印**（C39 在无尽选择池与商店池里），
   * 所以期望必须按**真实的 base/burned**推导，不能硬编码百分比。 */
  const powerLine = rep.effects.find(([k]) => /烙印.*攻击/.test(k));
  assert.ok(powerLine, '效果清单里应当仍列出烙印攻击：' + JSON.stringify(rep.effects));
  assert.match(powerLine[0], /已损毁/, '损毁后要标「已损毁」：' + powerLine[0]);
  const fb = after.fragileBase || {}, bn = after.fragileBurned || {};
  const expectPct = Math.round((Number(fb.power || 0) + Number(bn.power || 0)) * 100);
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
  /* 【第八十一批 用户口径】限次件**持有期间照样能再刷出来**，再获得 = **直接叠加场次**
   *（只加 uses、不加 stacks、也不开新栏位）。原来 ownable 把「已持有的非叠层件」一律踢出池子，
   * 于是商店 / 场间三选一里再也刷不到它；个别口子刷出来了也会被 addBuff 拒「已经叠满了」。 */
  {
    const T = c.Tower, TD = c.TowerData;
    const r = T._debugRun('endless');
    r.limited = [];
    const n03 = TD.BUFF_BY_ID.N03;
    assert.ok(T.debugGrantBuff('N03').ok, '先拿一条活血丹（限次 3 场）');
    assert.equal(T.ownableOf(r, n03), true, '持有期间它仍应当能刷出来（ownable）');
    assert.equal(T.poolFilterOf(r, n03), true, '池子口径也要放行（poolFilter）');
    let up = T.debugGrantBuff('N03');
    assert.equal(up.ok, true, '同名再获得不该被拒：' + JSON.stringify(up));
    up = T.debugGrantBuff('N03');
    const rows = (r.limited || []).filter((b) => b.id === 'N03');
    assert.equal(rows.length, 1, '同名限次件只有一条，不是一栏一条：' + JSON.stringify(rows));
    assert.equal(rows[0].stacks, 1, '不做单独的层数计数（用户口径「不需要单独计数」）：' + rows[0].stacks);
    assert.equal(rows[0].uses, 9, '3 场 × 3 份 → 场次 9：' + rows[0].uses);
    /* 三类**不**走这条路的（各自的取舍写进注释，回头要放开只改判据）：
     * 烙印（靠层数算强度）、unique（一局一次）、流程类（再拿一份就是再开一家店 / 再重开一层）。 */
    r.limited = [{ id: 'C49', stacks: 1, uses: 1000, on: true, uid: 8801 }];
    assert.equal(T.ownableOf(r, TD.BUFF_BY_ID.C49), true, '烙印本来就能叠（走层数那条路）');
    T.debugGrantBuff('C49');
    assert.equal((r.limited || []).find((b) => b.id === 'C49').stacks, 2, '烙印仍然叠层数，不是场次');
    r.limited = [{ id: 'N04', stacks: 1, uses: 10, on: true, uid: 8802 }];
    assert.equal(T.ownableOf(r, TD.BUFF_BY_ID.N04), false, 'unique 的限次件（金蝉脱壳）仍是一局一份');
    r.limited = [{ id: 'E15', stacks: 1, uses: 1, on: true, uid: 8803 }];
    assert.equal(T.ownableOf(r, TD.BUFF_BY_ID.E15), false, '流程类（时间回廊）不能反复拿');
    r.limited = [];
  }
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

test('增幅铭文（史诗·铭文）：给选中的永久增益 ×1.5，且同一张铭文不能重复附在同一条上', () => {
  const c = setup();
  const { Tower } = c;
  freshRun(c);
  Tower.debugGrantBuff('C26');                       // 蛮力：攻击 +20%（永久）—— 只发这一条，候选就是确定的
  /* 铭文是**独立类型**：不占槽位、只登记「待选一条永久增益」。 */
  const granted = Tower.debugGrantBuff('C60');
  const run = Tower._debugRun('endless');
  assert.equal(granted.buff.kind, 'inscription', 'C60 应当是 inscription 类型');
  /* vm 里造的对象跨 realm，deepEqual 会因原型不同而假红 —— 比字符串。 */
  assert.equal(JSON.stringify(run.pendingPick), JSON.stringify({ kind: 'permBuff', buffId: 'C60', mul: 1.5 }), '待选里带着 ×1.5');
  const cands = Tower.pickCandidates('permBuff');
  assert.equal(cands.length, 1, '候选就是那条唯一的永久增益：' + cands.length);
  const target = cands[0];
  const done = Tower.applyPickBuff('permBuff', target.uid);
  assert.equal(done.ok, true);
  assert.equal(done.enchMul, 1.5, '附魔落地后该条倍率 1.5');
  const row = run.permanent.find((b) => Number(b.uid) === Number(target.uid));
  assert.equal(row.enchants.join(','), 'C60', '行上记着吃过哪张铭文');
  /* 效果真的 ×1.5：蛮力攻击 20% → 30%（与增幅水晶同一套「乘在效果上」的逻辑）。 */
  const map = Object.fromEntries(Tower.debugBuffReport('endless').effects);
  assert.match(map['攻击'], /\+30%/, '被附魔那条应当是 20% × 1.5 = 30%：' + map['攻击']);
  /* 同一张铭文不能重复附在同一条上：它不再进候选，硬选也会被拒。 */
  Tower.debugGrantBuff('C60');
  assert.equal(Tower.pickCandidates('permBuff').some((x) => Number(x.uid) === Number(target.uid)), false,
    '已吃过 C60 的那一条不该再进候选');
  const again = Tower.applyPickBuff('permBuff', target.uid);
  assert.equal(again.ok, false, '硬选同一条应当被拒');
  assert.match(again.msg, /同一张铭文/, '拒绝理由要说清是同一张铭文：' + again.msg);
  /* 【2026-10 第七十三批】外框数据：界面按 buff 报告行的 enchMul / slotFree 画三种外框
   *（水晶=红、虚空=青、两者同时=一半红一半蓝），所以这两个字段必须逐条带出来。 */
  {
    const cF = setup();
    cF.Tower._debugSetEndlessLayer(35);
    cF.Tower.debugGrantBuff('C26');
    const one = () => (cF.Tower.ownedBuffs('endless') || []).find((b) => b.id === 'C26') || {};
    assert.equal(Number(one().enchMul) || 1, 1, '没附魔时 enchMul 是 1');
    assert.equal(one().slotFree === true, false, '没附魔时不占位标记为假');
    cF.Tower.debugGrantBuff('C60');                       // 水晶铭文（效果 ×1.5）
    cF.Tower.applyPickBuff('permBuff', one().uid);
    assert.equal(one().enchMul, 1.5, '水晶铭文 → enchMul 1.5（界面据此画红框）');
    assert.equal(one().slotFree === true, false, '这时还没有虚空铭文');
    cF.Tower.debugGrantBuff('C37');                       // 虚空铭文（不占位）
    cF.Tower.applyPickBuff('permBuff', one().uid);
    assert.equal(one().slotFree, true, '虚空铭文 → slotFree（界面据此画青框）');
    assert.equal(one().enchMul, 1.5, '两条同时附魔 → 两个字段都真（界面画一半红一半蓝）');
    const css = fs.readFileSync(require('node:path').join(__dirname, '..', 'css/tower.css'), 'utf8').replace(/\r\n/g, '\n');
    for (const cls of ['ench-crystal', 'ench-both']) {
      assert.ok(css.includes('.buff-tag.' + cls), 'CSS 里要有 .buff-tag.' + cls);
    }
    /* 双色外框 = 两个伪元素各画半圈（::before 左红 / ::after 右青，clip-path 各裁一半）。
     * ⚠ 不要退回「单个 ::before + z-index:-1 画在元素背后」：父级 `position:relative` +
     *   z-index 会自建层叠上下文，负 z-index 的子元素其实画在**父级背景之上** → 整块被铺满。 */
    const bothCss = (css.match(/\.buff-tag\.ench-both\{[\s\S]{0,420}/) || [''])[0];
    assert.ok(/::before[^}]*?border-color:#c0392b/.test(bothCss), '左半圈是红色：' + bothCss.slice(0, 120));
    assert.ok(/::after[^}]*?border-color:#3f9d9d/.test(bothCss), '右半圈是青色（虚空铭文那支）');
    assert.ok(/::before[^}]*?clip-path:inset\(0 50% 0 0\)/.test(bothCss) &&
      /::after[^}]*?clip-path:inset\(0 0 0 50%\)/.test(bothCss), '两个半圈要用 clip-path 各裁一半');
    assert.ok(!/z-index:\s*-1/.test(bothCss), '不能再用负 z-index 的「背后」写法');
    /* 列表里（替换弹窗 / 出售列表 / 交换列表）原本只给虚空留了行内标记，水晶那条只画了框 ——
     * 这些「挑一条丢掉」的列表上也得看得出它被 ×1.5 过（第七十四批补齐）。 */
    const uiSrc = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(/crysHtml[\s\S]{0,160}rp-crys/.test(uiSrc), '替换弹窗要有水晶标记（.rp-crys）');
    assert.ok((uiSrc.match(/enchMark\(b\)\.crysHint/g) || []).length >= 2, '出售与交换列表都要带上水晶提示');
    assert.ok(/\.replace-pick \.rp-crys/.test(css), '.rp-crys 要有样式（与 .rp-free 同款、红系）');
    assert.ok(/\.shop-sell-row \.crystal-hint/.test(css), '.crystal-hint 要有样式（与 .slot-free-hint 同款、红系）');
    /* 【第七十五批真凶】无尽塔**主面板**（buffPanelsHtml）原来自己拼 class、只认 slot-free，
     * 水晶的红框在玩家一直盯着的那块面板上根本不存在。所有渲染「已拥有的增益」的地方都要走 enchCls。
     * ⚠ 抠出来的片段要**先去注释**：那段的注释里就写着 `enchCls(b)` 这几个字，
     *  不去注释的话「故意改回 bug 版」也能蒙混过关（实测过一次）。 */
    assert.ok(/function enchCls\(/.test(uiSrc), '要有唯一的附魔类名出口 enchCls()');
    const panel = (uiSrc.match(/function buffPanelsHtml[\s\S]{0,3200}/) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(/enchCls\(b\)/.test(panel), 'buffPanelsHtml 必须走 enchCls（否则水晶框在主面板上不存在）');
    assert.ok(/em\.crys \? ' · ×'/.test(panel), '主面板还要把倍率写进 <i>（一眼看出被强化过）');
  }
  /* 但**别的**铭文还能附在同一条上（一个 buff 可以吃多个不同铭文）。 */
  Tower.debugGrantBuff('C37');                       // 虚空铭文：免占位
  const free = Tower.applyPickBuff('permBuff', target.uid);
  assert.equal(free.ok, true, '另一个铭文应当还能附在同一条上：' + (free.msg || ''));
  assert.equal(free.slotFree, true);
  assert.equal(free.enchMul, 1.5, '免占位不该改倍率');
  /* ⚠ 归一化会用 cleanBuffs 重建行对象 —— 断言要**重新取一次**，不能读旧引用。 */
  const after = Tower._debugRun('endless').permanent.find((b) => Number(b.uid) === Number(target.uid));
  assert.equal(after.slotFree, true, '免占位标记也在同一条上');
  assert.equal(after.enchMul, 1.5, '两种铭文叠加：倍率仍在');
  assert.match(Object.fromEntries(Tower.debugBuffReport('endless').effects)['攻击'], /\+30%/,
    '×1.5 与免占位共存后效果仍是 30%');
  /* 【第八十批 用户口径】0.88^n 的**降权**必须按这张铭文**自己的**附魔数算：
   * 原来 C60 照抄了 C37 的 `weightDivBy: 'enchanted'`（数的是虚空的「不占位」标记），
   * 于是水晶铭文附魔再多条，它自己的 n 也一直是「被虚空附魔过的条数」（多半 0）→ 0.88^n 从未生效。 */
  {
    const rW = Tower._debugRun('endless');
    rW.permanent = [
      { id: 'C02', stacks: 1, enchants: ['C60'], enchMul: 1.5 },
      { id: 'C05', stacks: 1, enchants: ['C60'], enchMul: 1.5 },
      { id: 'C19', stacks: 1, slotFree: true },          // 虚空附魔的那条：不该影响水晶的计数
    ];
    rW.pickGot = {};
    const close = (v, want) => Math.abs(v - want) < 1e-9;
    assert.ok(close(Tower.buffDynamicPenaltyOf(rW, 'C60'), Math.pow(0.88, 2)),
      '水晶铭文：附魔 2 条 → 0.88²，实测 ' + Tower.buffDynamicPenaltyOf(rW, 'C60').toFixed(4));
    assert.ok(close(Tower.buffDynamicPenaltyOf(rW, 'C37'), 0.88),
      '虚空铭文：只数自己的「不占位」1 条 → 0.88，实测 ' + Tower.buffDynamicPenaltyOf(rW, 'C37').toFixed(4));
    /* 碎裂 / 延续铭文不给谁附魔：按「自己出现过几次」降权（weightDivBy: 'owned'）。 */
    rW.pickGot = { C61: 2, C62: 1 };
    assert.ok(close(Tower.buffDynamicPenaltyOf(rW, 'C61'), Math.pow(0.88, 2)), '碎裂铭文按自己的出现次数');
    assert.ok(close(Tower.buffDynamicPenaltyOf(rW, 'C62'), 0.88), '延续铭文按自己的出现次数');
  }
});

test('碎裂 / 延续铭文与烙印升华：碎烙印、限次 +5、以及「未破碎烙印超过 3 份」的商店门槛', () => {
  const c = setup();
  const { Tower, TowerData: TD } = c;
  freshRun(c);
  Tower.debugGrantBuff('C39');                       // 力量烙印（限次·易碎）
  Tower.debugGrantBuff('E05');                       // 战利品（限次 10 场）
  assert.equal(Tower.unbrokenBrandCount(Tower._debugRun('endless')), 1, '未破碎烙印 1 份');
  /* ① 延续铭文 C62：只能挑非烙印的限次增益，剩余场次 +5。 */
  Tower.debugGrantBuff('C62');
  const lim = Tower.pickCandidates('limitedBuff');
  assert.equal(lim.length, 1, '候选只有战利品（烙印除外）：' + lim.map((x) => x.name).join(','));
  assert.equal(lim[0].name, '战利品');
  const up = Tower.applyPickBuff('limitedBuff', lim[0].uid);
  assert.equal(up.ok, true);
  assert.equal(up.uses, 15, '10 场 → 15 场：' + up.uses);
  /* ①b 【第八十批 用户口径】特殊设定：延续铭文**不能取流程类限次增益**：
   * E01 立即进货（下一场开店）、E15 时间回廊（重开本层）、E16 铸币商队（下一场开铸币店）。
   * 候选里过滤 + 直接点也被拒（双保险）。 */
  {
    const rE = Tower._debugRun('endless');
    /* 记下原状，用完**原样放回**（后面几段还接着用这一局的 limited 列表）。 */
    const keepLimited = rE.limited, keepPending = rE.pendingPick;
    const flowRows = [
      { id: 'E01', stacks: 1, uses: 1, on: true, uid: 777001 },
      { id: 'E15', stacks: 1, uses: 1, on: true, uid: 777003 },
      { id: 'E16', stacks: 1, uses: 1, on: true, uid: 777004 },
    ];
    rE.limited = flowRows.concat([{ id: 'N03', stacks: 1, uses: 3, on: true, uid: 777002 }]);
    rE.pendingPick = { kind: 'limitedBuff', buffId: 'C62', addUses: 5 };
    const cands = Tower.pickCandidates('limitedBuff');
    for (const row of flowRows) {
      assert.ok(cands.every((x) => x.id !== row.id), row.id + ' 不该进延续铭文的候选：' +
        JSON.stringify(cands.map((x) => x.id)));
      const bad = Tower.applyPickBuff('limitedBuff', row.uid);
      assert.equal(bad.ok, false, '直接点 ' + row.id + ' 也要被拒：' + JSON.stringify(bad));
      assert.match(bad.msg || '', /流程类/, '拒绝理由要说清是流程类：' + bad.msg);
      assert.equal(rE.limited.find((b) => b.id === row.id).uses, 1, row.id + ' 的场次不能被加上去');
    }
    assert.ok(cands.some((x) => x.id === 'N03'), '其它限次增益照旧可选：' + JSON.stringify(cands.map((x) => x.id)));
    rE.limited = keepLimited; rE.pendingPick = keepPending;
  }
  /* ①a 淘金烙印（C53）是**烙印类里的特殊烙印**（用户口径 2026-10）：
   * 「拾取一次后立马移除出该场所有 buff 池，与碎不碎裂无关」——
   * 别的烙印（C49 终焉 / C52 涌泉）仍然可以无限叠加。 */
  {
    const cB = setup();
    cB.Tower._debugSetEndlessLayer(33);
    const rB = cB.Tower._debugRun('endless');
    rB.env = []; rB.choices = null; rB.phase = null;
    const c53 = cB.TowerData.BUFF_BY_ID.C53;
    assert.equal(c53.maxStacks, 1, 'C53 的获得上限就是 1 份');
    assert.equal(cB.Tower.poolFilterOf(rB, c53), true, '没拿到之前它在池子里');
    assert.equal(cB.Tower.debugGrantBuff('C53').ok, true);
    const rB2 = cB.Tower._debugRun('endless');
    assert.equal(cB.Tower.poolFilterOf(rB2, c53), false, '拾取一次后立刻出池（掉落 / 场间选择 / 商店都不再给）');
    assert.equal(cB.Tower.debugGrantBuff('C53').ok, false, '再拿一份会被拒');
    /* 碎裂**不影响**这条：主动碎掉之后依然出池（本来就是出池状态）。 */
    cB.Tower.debugGrantBuff('C61');
    const c61 = cB.Tower.pickCandidates('brandBuff').find((x) => x.id === 'C53');
    if (c61) cB.Tower.applyPickBuff('brandBuff', c61.uid);
    assert.equal(cB.Tower.poolFilterOf(cB.Tower._debugRun('endless'), c53), false, '碎过之后当然还是出池');
    /* 对照：终焉烙印（C49）没有这个特殊口径，碎掉一份后额度内仍可再拿（需求69）。 */
    assert.equal(cB.TowerData.BUFF_BY_ID.C49.maxStacks, undefined, 'C49 不带上限字段');
  }
  /* ①a2 点石成金（E19，传奇 +300 试炼币）战斗后权重 ×0.5。 */
  {
    const cc = setup();
    assert.equal(cc.TowerData.BUFF_BY_ID.E19.shopWeight, 0.5, 'E19 权重应当是 0.5');
    assert.equal(cc.TowerData.BUFF_BY_ID.E18.shopWeight, undefined, '同为代币的丰饶之角不动');
  }
  /* ①b 关掉的限次 buff 也必须能被选到（用户口径：关闭 ≠ 不存在；「假如我直接赢」就是这么被漏掉的）。 */
  Tower.debugGrantBuff('E17');                       // 假如我直接赢（传奇·限次 2 场）
  const e17 = Tower._debugRun('endless').limited.find((b) => b.id === 'E17');
  assert.ok(e17, '拿到了 E17');
  e17.on = false;                                    // 玩家在界面上把它关掉
  Tower.debugGrantBuff('C62');
  const off1 = Tower.pickCandidates('limitedBuff').find((x) => x.id === 'E17');
  assert.ok(off1, '关掉的限次 buff 仍要进候选');
  assert.equal(off1.off, true, '候选里标出「已关闭」');
  const up2 = Tower.applyPickBuff('limitedBuff', off1.uid);
  assert.equal(up2.uses, 7, '2 场 → 7 场：' + up2.uses);
  assert.equal(Tower._debugRun('endless').limited.find((b) => b.id === 'E17').on, false, '开关状态不被动过');
  /* ①c 软锁修复：**一条烙印都没有**时拿到碎裂铭文，不能挂 pendingPick
   *（挂了界面每次都弹 0 候选的空弹窗，点不掉也走不了 —— 用户实测的卡死）。 */
  {
    const c2 = setup();
    c2.Tower._debugSetEndlessLayer(31);
    const r2 = c2.Tower._debugRun('endless');
    r2.env = []; r2.choices = null; r2.phase = null;
    assert.equal(c2.Tower.hasPickTargetsOf(r2, 'brandBuff'), false, '开局没有任何烙印');
    const got = c2.Tower.debugGrantBuff('C61');
    assert.equal(got.ok, true, '铭文本身还是要发到手（不能被吞掉）');
    const after = c2.Tower._debugRun('endless');
    assert.ok(!after.pendingPick, '没有目标时不许挂 pendingPick：' + JSON.stringify(after.pendingPick || null));
    assert.equal((after.deferredPicks || []).length, 1, '记进 deferredPicks 先留着');
    assert.equal(c2.Tower.pickCandidates('brandBuff').length, 0, '此时候选确实是 0 个');
    /* 之后拿到一条烙印 → 自动接上待选并落地 */
    c2.Tower.debugGrantBuff('C49');
    const r3 = c2.Tower._debugRun('endless');
    assert.equal(r3.pendingPick && r3.pendingPick.kind, 'brandBuff', '拿到烙印后自动接上：' + JSON.stringify(r3.pendingPick));
    c2.Tower.applyPickBuff('brandBuff', c2.Tower.pickCandidates('brandBuff')[0].uid);
    assert.ok(!c2.Tower._debugRun('endless').pendingPick, '落地后清空');
    /* 第二道防线：老存档里遗留的、目标已消失的 pendingPick 必须被收走 */
    const r4 = c2.Tower._debugRun('endless');
    r4.pendingPick = { kind: 'limitedBuff', buffId: 'C62', addUses: 5 };
    r4.limited = [];
    c2.Tower.deferPendingPick();
    const r5 = c2.Tower._debugRun('endless');
    assert.ok(!r5.pendingPick, '遗留的 pendingPick 被收走（不再卡死）');
    assert.ok((r5.deferredPicks || []).some((x) => x.buffId === 'C62'), 'C62 进 deferredPicks');
  }
  /* ② 碎裂铭文 C61：挑一条烙印，全部份数一起碎（碎 = 升级为全额并永久保留）。 */
  Tower.debugGrantBuff('C39');                       // 再叠一份 → 同栏 2 份
  Tower.debugGrantBuff('C61');
  const brands = Tower.pickCandidates('brandBuff');
  assert.equal(brands.length, 1, '候选只有那条烙印');
  assert.equal(brands[0].stacks, 2, '两份一起算：' + brands[0].stacks);
  const broke = Tower.applyPickBuff('brandBuff', brands[0].uid);
  assert.equal(broke.ok, true);
  assert.equal(broke.broken, 2, '两份都碎：' + broke.broken);
  assert.equal(Tower.unbrokenBrandCount(Tower._debugRun('endless')), 0, '碎完就没有未破碎的了');
  assert.ok(Number(Tower._debugRun('endless').fragileBurned.power) > 0, '破碎后的加成记进「永久保留」明细');
  /* ③ 烙印升华 E20：未破碎烙印 ≤3 时不上架；超过 3 份才出现，且一用就把所有烙印碎光。 */
  assert.equal(Tower.poolFilterOf(Tower._debugRun('endless'), TD.BUFF_BY_ID.E20), false, '没烙印时 E20 不该上架');
  for (const id of ['C40', 'C41', 'C42', 'C43']) Tower.debugGrantBuff(id);
  assert.equal(Tower.unbrokenBrandCount(Tower._debugRun('endless')), 4, '补到 4 份');
  assert.equal(Tower.poolFilterOf(Tower._debugRun('endless'), TD.BUFF_BY_ID.E20), true, '超过 3 份时 E20 上架');
  const r = Tower.debugGrantBuff('E20');
  assert.equal(r.res.brokenBrands, 4, '一次碎掉全部 4 份：' + JSON.stringify(r.res.brokenBrands));
  assert.equal(Tower.unbrokenBrandCount(Tower._debugRun('endless')), 0, '全部破碎');
});
test('档位徽记：传奇档要有自己的「金色方框 + 钻石」标志（不再和普通档一样是个黄圆）', () => {
  /* 用户口径 2026-10 第七十九批：选择卡上的档位徽记，普通 ● / 稀有 ◆ / 史诗 ★，
   * 传奇档原来落进 else 也画 ●（和普通档撞脸，还只是一个光秃秃的黄圆）。
   * 这里**把源码里的徽记表抠出来求值**（不是文本匹配，避免被注释骗过），并核对 CSS 画的那个方框。 */
  const src = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  /* ⚠ 先**剥掉注释**再查代码：上面那段说明里就引用了旧表达式（写注释引用旧写法 → 断言被自己的注释骗过，
   * 这个坑前面批次踩过一次）。徽记表也从剥干净的源码里抠，避免「代码被注释掉但正则还命中」。 */
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const hit = /const RARITY_EMBLEM = \[([^\]]*)\]/.exec(bare);
  assert.ok(hit, '选择卡应当有一张 RARITY_EMBLEM 档位徽记表');
  const emblems = hit[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.equal(emblems.length, 4, '四档都要有徽记：' + JSON.stringify(emblems));
  assert.equal(emblems.slice(0, 3).join(''), '●◆★', '普通/稀有/史诗保持 ● / ◆ / ★：' + JSON.stringify(emblems));
  assert.notEqual(emblems[3], emblems[0], '传奇档不能复用普通档的 ●（原来就是它）');
  assert.ok(/RARITY_EMBLEM\[b\.rarity\]/.test(bare), '渲染选择卡时要真的用这张表');
  assert.ok(!/rarity === 2 \? '★'/.test(bare), '旧的三元表达式应当已经删掉');
  const css = fs.readFileSync(path.join(ROOT, 'css/tower.css'), 'utf8').replace(/\r\n/g, '\n');
  const box = (/\.hex-card\.r3 \.hex-emblem\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
  assert.ok(/width:\s*46px/.test(box) && /height:\s*46px/.test(box), '传奇徽记是个正方形方框：' + box);
  assert.ok(/border:\s*3px solid #ffd76a/.test(box), '方框要是金色描边：' + box);
  /* ⚠ font-size 必须归零：透明的字形在 flex 行里照样占宽，会把里面的钻石挤成 0 宽（实测踩过）。 */
  assert.ok(/font-size:\s*0/.test(box), '要把字形收掉，否则方框里的钻石会被挤没：' + box);
  const dia = (/\.hex-card\.r3 \.hex-emblem::before\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
  assert.ok(/rotate\(45deg\)/.test(dia), '方框里那颗钻石是旋转 45° 的方块：' + dia);
  assert.ok(/width:\s*19px/.test(dia) && /height:\s*19px/.test(dia), '钻石尺寸（要小于方框）：' + dia);
  assert.ok(/\.choice-dialog\.hex-n6 \.hex-card\.r3 \.hex-emblem\s*\{/.test(css), '6 选 1 收窄时要跟着缩一档');
});

test('巡逻（魔王战）：随机替换任意一场、魔王本体、收缴与「运营类不生效 / 挥金如土生效」', () => {
  const c = setup();
  const { Tower, TowerData: TD } = c;
  freshRun(c);
  const run0 = Tower._debugRun('endless');
  assert.ok(run0, '应当有进行中的对局');
  const salt = run0.salt;
  /* ① 出场规则：41 层起、每个 10 层区块一层、x0/x5 不触发。 */
  assert.equal(TD.isPatrolLayer(35, salt), false, '41 层之前不触发');
  for (const L of [40, 45, 50, 55]) assert.equal(TD.isPatrolLayer(L, salt), false, 'x0/x5 不触发：' + L);
  const marks = [];
  for (let block = 4; block <= 9; block++) {
    const hits = [];
    for (let m = 1; m <= 9; m++) if (TD.isPatrolLayer(block * 10 + m, salt)) hits.push(m);
    assert.equal(hits.length, 1, '每个 10 层区块恰好一场巡逻（第 ' + block + ' 区块）：' + hits.join(','));
    marks.push(hits[0]);
  }
  /* ② 巡逻层里替换掉一场（三侠/精英位），并同时算精英。 */
  const at = TD.patrolLayerInBlock(4, salt);
  Tower._debugSetEndlessLayer(at);
  const plan = Tower._debugRun('endless').plan;
  const pe = plan.filter((x) => x.kind === 'patrol');
  assert.equal(pe.length, 1, '恰好一场巡逻：' + plan.map((x) => x.kind).join(','));
  assert.equal(Tower.isEliteEntryOf(pe[0], at, false), true, '巡逻算精英位');
  /* ③ 替换而不是新增：场数不变，且能看出被替换的是第几场（预告同口径）。 */
  assert.equal(plan.length, TD.heroOrder ? 4 : 4, '巡逻层的场数不变（替换，不是新增）：' + plan.length);
  assert.ok(pe[0].replacedIndex >= 0 && pe[0].replacedIndex < plan.length, '记录了被替换的下标：' + pe[0].replacedIndex);
  const info = Tower.preview(at, salt, true).find((f) => f.patrol);
  /* 【第七十八批 用户口径】预告里不再有「替换第 N 场」黄标（`replaced` 字段取消），
   * 那一场改用自己的**淡红色背景**（`.tower-plan li.patrol`）标识特殊性。 */
  assert.ok(info, '预告里要认得出这一场是魔王');
  assert.equal(info.replaced, undefined, '不该再有「替换了哪一场」的标记字段');
  assert.equal(info.type, '精英 首领', '档位介绍改成「精英 首领」：' + info.type);
  assert.equal(info.name, TD.PATROL.name, '名字跟着 PATROL.name：' + info.name);
  assert.ok(!/替换/.test(info.mechDesc), '预告文案里也不该再讲「替换了谁」：' + info.mechDesc.slice(0, 60));
  const planCss = fs.readFileSync(path.join(ROOT, 'css/tower.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/\.tower-plan li\.patrol\s*\{[^}]*background:\s*#ffdcd6/.test(planCss),
    '魔王那一场要用淡红色背景标识');
  assert.ok(!/\.patrol-tag\s*\{/.test(planCss), '黄标样式应当删掉（不留死样式）');
  /* ③ 普通 x0 层（如 50 层）**不**触发觐见魔王：仍是「三侠 ×3 + 首领 + 守关」5 场。 */
  Tower._debugSetEndlessLayer(50);
  const p50 = Tower._debugRun('endless').plan;
  assert.equal(p50.length, 5, '50 层是普通结构：' + p50.map((x) => x.kind).join(','));
  assert.equal(p50.some((x) => x.audience === 'king'), false, '50 层不该有魔王');
  /* 整百层（100 / 200…）才是三连战 觐见魔王：两名近卫（无奖励）+ 魔王本体。 */
  Tower._debugSetEndlessLayer(100);
  const p100 = Tower._debugRun('endless').plan;
  assert.equal(p100.length, 3, '100 层 3 场：' + p100.map((x) => x.kind).join(','));
  assert.equal(p100[0].kind, 'warlord', '第一场是近卫');
  assert.equal(p100[1].kind, 'warlord', '第二场是近卫');
  assert.equal(p100[0].audience, 'guard');
  assert.equal(!!p100[0].noReward && !!p100[1].noReward, true, '两名近卫没有 buff 奖励');
  assert.equal(p100[2].kind, 'patrol', '第三场是魔王');
  assert.equal(p100[2].audience, 'king', '整百层那场是「觐见魔王」形态');
  const kingInfo = Tower.preview(100, salt, true, 'endless').find((x) => x.kind === 'patrol');
  assert.match(kingInfo.type, /觐见/, '预告里标成觐见：' + kingInfo.type);
  assert.match(kingInfo.mechDesc, /觐见魔王/, '预告有叙事文案');
  /* ④ 收缴：纯运营类不生效、挥金如土生效（按上交时的快照）。 */
  assert.equal(Tower.isPureOpsBuffOf(TD.BUFF_BY_ID.E01), true, '立即进货是纯运营类');
  assert.equal(Tower.isPureOpsBuffOf(TD.BUFF_BY_ID.C36), false, '挥金如土不是纯运营类（它给属性成长）');
  run0.patrolTolls = [{ id: 'E01', name: '立即进货', stacks: 1 }];
  const foeOps = Tower.buildFoeOf('endless', at, pe[0], salt, false).foe;
  Tower.applyPatrolTollToFoeOf(run0, foeOps);
  assert.match(foeOps.tollBuffs.join(','), /运营类·不生效/, '纯运营类要标成不生效：' + foeOps.tollBuffs.join(','));
  run0.patrolTolls = [{ id: 'C36', name: '挥金如土', stacks: 1 }];
  const foeC36 = Tower.buildFoeOf('endless', at, pe[0], salt, false).foe;
  const beforePow = foeC36.power;
  Tower.applyPatrolTollToFoeOf(run0, foeC36);
  assert.ok(run0.patrolShopGift && run0.patrolShopGift.step > 0, '挥金如土登记了分段');
  Tower.addShopSpendOf(run0, 50);
  const foeC36b = Tower.buildFoeOf('endless', at, pe[0], salt, false).foe;
  Tower.applyPatrolTollToFoeOf(run0, foeC36b);
  const gained = ['power', 'agility', 'speed', 'hp'].reduce((a, k) => a + (Number(run0.patrolFoeGain[k]) || 0), 0);
  assert.ok(gained > 0, '玩家商店消费后魔王真的涨了：' + JSON.stringify(run0.patrolFoeGain));
  assert.ok(foeC36b.power >= beforePow, '魔王面板跟着涨');
  run0.patrolTolls = [];          // 清掉这两条造出来的记录，下面 ⑤ 走真实收缴流程
  delete run0.patrolShopGift;
  delete run0.patrolFoeGain;
  /* ④ 魔王本体：名字固定、穿全套橙狂战、全武器全技能真5。 */
  const built = Tower.buildFoeOf('endless', at, pe[0], salt, false);
  assert.equal(built.foe.name, TD.PATROL.name, '固定名字');
  /* 【2026-10 第七十四批】橙狂战套要**真的显示**：wear 必须是 {src,label} 形态
   *（裸字符串会被 wearsFor 当成装备 id 去查 gearMap，`Number('Head_113_1')` = NaN → 整条丢掉，
   *  于是魔王一件都穿不上）；而且 engine 里必须真有这几张图的帧表，否则图集注册出来 0 帧，照样画不出来。 */
  const outfit = TD.PATROL.outfit;
  assert.equal(outfit.length, 6, '六个部位：' + JSON.stringify(outfit));
  assert.ok(outfit.every((w) => w && w.src && String(w.label) === '0'), '必须是 {src,label} 形态');
  assert.equal(built.foe.wears.map((w) => w && w.src).join(','), outfit.map((w) => w.src).join(','),
    '战斗里的 wears 就是 PATROL.outfit');
  {
    const engineSrc = fs.readFileSync(path.join(ROOT, 'js/engine.js'), 'utf8').replace(/\r\n/g, '\n');
    for (const w of outfit) assert.ok(engineSrc.includes(w.src + ':'), 'engine.js 的 EXTRA_DEFS 里要有 ' + w.src);
    /* 手导素材是 1x 的，要靠帧表里的显示尺寸放大回原版贴图同级（第 8/9 列 dw/dh）。 */
    assert.ok(/dw\/dh/.test(engineSrc) && /EXTRA_DEFS/.test(engineSrc), '帧表要支持显示尺寸（dw/dh）');
  }
  /* 橙狂战套**真的给性能**：战斗修正走 setFx 独立通道（属性那半在 adjustMe 的复制之后落，见 ⑥）。 */
  assert.ok(built.foe.setFx && built.foe.setFx.lowHpFinalMul > 0, '狂战套的战斗修正要写进 setFx：' + JSON.stringify(built.foe.setFx));
  assert.equal(built.foe.setFx.critBonus, 5.9, '2 件档暴击率 +5.9%');
  assert.equal(built.foe.setFx.lowHpAt, 0.4, '4 件档低血阈值 40%');
  const countOf = (map) => { let n = 0; if (map && map.each) map.each(() => n++); return n; };
  assert.equal(built.foe.weapons.length, countOf(c.weaponsMap), '持有全部武器');
  assert.equal(built.foe.skills.length, countOf(c.skillsMap), '持有全部技能');
  assert.ok(built.foe.weapons.every((w) => w.level === 15) && built.foe.skills.every((k) => k.level === 15), '全部真5（15 级）');
  /* ⑤ 收缴：候选只给「持有的最高稀有度」那一档；交出只掉一层（涅槃两层掉一层）。 */
  Tower.debugGrantBuff('C14');                 // 涅槃（传奇·可叠 2 层）
  Tower.debugGrantBuff('C14');
  const cands = Tower.patrolTollCandidates();
  assert.equal(cands.top, 3, '候选档位 = 持有的最高稀有度');
  const ne = cands.list.find((x) => x.id === 'C14');
  assert.ok(ne && ne.stacks === 2, '涅槃两层进候选：' + JSON.stringify(ne));
  const paid = Tower.payPatrolToll(ne.ref);
  assert.equal(paid.ok, true);
  assert.equal(paid.left, 1, '交出涅槃只掉一层：' + paid.left);
  const left = run0.permanent.find((b) => b.id === 'C14');
  assert.equal(left.stacks, 1, '行上还剩一层');
  assert.equal(run0.patrolTolls.length, 1, '上交记录留给 x0 的魔王');
  /* ⑤b 【第七十七批 用户口径】候选 =「本局当前**还在生效**的最高稀有度」，
   * 不止背包里那一档 —— **已破碎的烙印**（行已经没了、加成还挂着）与
   * **已附魔成功的铭文**（不占栏位）都要能交出去，且交付语义各不相同。 */
  {
    const pay = (ref) => Tower.payPatrolToll(run0, ref);
    const candOf = (id) => Tower.patrolTollCandidates(run0).list.find((x) => x.id === id);
    /* ① 破碎的终焉烙印（C49）：交出 = **层数 -1**（明细也要一起收回 —— 合计是从明细重算的）。 */
    run0.permanent = []; run0.limited = [];
    run0.brokenMarks = [{ kind: 'final', alive: 0.25, burned: 0.5 }];
    run0.fragileMulBase = 0; run0.fragileMulBurned = 1;
    const c49 = candOf('C49');
    assert.ok(c49 && c49.cat === 'brand' && c49.broken === 1,
      '破碎的终焉烙印要进候选：' + JSON.stringify(Tower.patrolTollCandidates(run0).list));
    assert.equal(pay(c49.ref).ok, true, '交出破碎的终焉烙印');
    assert.equal(run0.fragileMulBurned, 0, '终焉烙印层数 -1');
    assert.equal((run0.brokenMarks || []).length, 0, '明细一起收回（否则下次重建会把那层加回来）');
    /* ② 破碎的淘金烙印（C53）：交出 = 失去增幅 **+ 退回 buff 池**。 */
    run0.brokenMarks = [{ kind: 'coin', alive: 0.15, burned: 0.30 }];
    run0.fragileCoinBase = 0; run0.fragileCoinBurned = [0.30];
    run0.fragileGot = Object.assign({}, run0.fragileGot, { C53: 1 });
    assert.equal(Tower.poolFilterOf(run0, TD.BUFF_BY_ID.C53), false, '拿到过一次的淘金烙印本来已经出池');
    const c53 = candOf('C53');
    assert.ok(c53, '破碎的淘金烙印要进候选：' + JSON.stringify(Tower.patrolTollCandidates(run0).list));
    const r53 = pay(c53.ref);
    assert.equal(r53.backToPool, true, '交出淘金烙印要把它退回池子：' + JSON.stringify(r53));
    /* ⚠ 别用 deepEqual 比 []：对象来自 vm 沙箱，跨 realm 的空数组原型不同，会假红 —— 比长度。 */
    assert.equal(Array.from(run0.fragileCoinBurned || []).length, 0,
      '已损毁的试炼币增幅也一并收回：' + JSON.stringify(run0.fragileCoinBurned));
    assert.equal(Tower.poolFilterOf(run0, TD.BUFF_BY_ID.C53), true, '退回之后它能再刷出来');
    /* ③ 已附魔成功的虚空铭文（C37）：交出 = 随机撤一份附魔；撤掉「不占位」导致永久位溢出 → 继续丢。 */
    run0.brokenMarks = []; run0.fragileCoinBurned = [];
    run0.permanent = [
      { id: 'C02', stacks: 1, uid: 9201, at: 1, slotFree: true },
      { id: 'C05', stacks: 1, uid: 9202, at: 2 }, { id: 'C11', stacks: 1, uid: 9203, at: 3 },
      { id: 'C19', stacks: 1, uid: 9204, at: 4 }, { id: 'C21', stacks: 1, uid: 9205, at: 5 },
      { id: 'C22', stacks: 1, uid: 9206, at: 6 },
    ];
    run0.phase = null;
    const c37 = candOf('C37');
    assert.ok(c37 && c37.cat === 'insc', '已附魔的虚空铭文（不占栏位）也要进候选：' +
      JSON.stringify(Tower.patrolTollCandidates(run0).list));
    const r37 = pay(c37.ref);
    assert.equal(r37.undone, 'C02', '随机撤掉了一条附魔：' + JSON.stringify(r37));
    assert.equal(r37.needDiscard, true, '撤掉「不占位」后永久位溢出 → 还要再丢一个');
    assert.equal(run0.phase, 'patrolDiscard', 'phase 落到巡逻丢弃');
    /* ④ 已附魔的水晶铭文（C60）：交出 = 撤一份 ×1.5，倍率按**剩下的**铭文重算。 */
    run0.phase = null;
    run0.permanent = [
      { id: 'C02', stacks: 1, uid: 9301, at: 1, enchants: ['C60'], enchMul: 1.5 },
      { id: 'C05', stacks: 1, uid: 9302, at: 2, enchants: ['C60'], enchMul: 1.5 },
    ];
    const c60 = candOf('C60');
    assert.ok(c60 && c60.alive === 2, '水晶铭文附魔了两条 → 候选里写 2：' + JSON.stringify(c60));
    const r60 = pay(c60.ref);
    assert.equal(r60.ok, true, '交出水晶铭文');
    const leftC60 = run0.permanent.filter((b) => (b.enchants || []).indexOf('C60') >= 0);
    assert.equal(leftC60.length, 1, '只撤掉一条上的附魔：' + JSON.stringify(run0.permanent));
    assert.equal(leftC60[0].enchMul, 1.5, '剩下的那条保持 ×1.5');
    assert.equal(run0.permanent.find((b) => b.uid === r60.undone || b.id === r60.undone).enchMul, 1,
      '被撤掉的那条倍率回到 1');
    /* 收拾干净：phase 不清的话，下一步的 nextBattle 会被「请先完成商店与结算」拒掉。 */
    run0.phase = null;
    run0.permanent = []; run0.limited = [];
    run0.brokenMarks = []; run0.fragileMulBurned = 0; run0.fragileCoinBurned = [];
    run0.patrolTolls = [];
    /* 界面：两个收缴弹窗都**不再分页**（用户口径：去掉右下角的左右翻页、自然上下滚动），
     * 点击也要按候选的 `ref` 交付 —— 烙印 / 铭文没有 uid。 */
    {
      const uiSrc = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
      const toll = uiSrc.slice(uiSrc.indexOf('function openPatrolToll'), uiSrc.indexOf('function offerShopReplace'));
      assert.ok(toll.length > 200, '应当能切到两个收缴弹窗的源码');
      assert.ok(!/fusion-pagination/.test(toll), '收缴 / 丢弃弹窗不该再有左右翻页');
      assert.ok(!/PATROL_PAGE/.test(toll), '分页常量也该清掉');
      assert.ok(/payPatrolToll\(c\.ref\)/.test(toll), '点击要按候选的 ref 交付');
      assert.ok(/patrolListHtml\(/.test(toll) && /replace-pick-list/.test(uiSrc), '列表仍然用可滚动的 .replace-pick-list');
    }
  }
  /* ⑥ 失败路径（用户口径 2026-10 第六十六批）：
   *   · **x00 的「觐见魔王」输了照常结算失败**（它是爬塔的终点仪式，不是路上偶遇的巡逻）；
   *   · **普通「巡逻」战输了不结算** —— 返回 patrol 标记 + phase 落到收缴，
   *     而且这个 phase 必须挺过归一化（否则界面弹不出收缴面板，会掉进失败结算）。 */
  Tower._debugSetEndlessLayer(100);
  const kingRun = Tower._debugRun('endless');
  kingRun.env = []; kingRun.choices = null; kingRun.noEnvRoll = true; kingRun.idx = 2;
  const kx = Tower.nextBattle('endless');
  assert.equal(kx.entry.kind, 'patrol', '100 层第 3 场是魔王');
  assert.equal(kx.entry.x00, true, '它是 x00 形态');
  const krw = Tower.reportBattle('endless', kx.token, false, 1, 2000, null);
  assert.equal(krw.win, false);
  assert.ok(!krw.patrol, 'x00 的魔王战输了要**正常结算**，不给收缴这条路');
  assert.equal(krw.layer, 100, '结算结果带着这一层：' + JSON.stringify(krw).slice(0, 80));
  /* 普通巡逻层：不结算，走收缴。 */
  let patrolLayer = 0;
  for (let L = 41; L <= 60; L++) if (TD.isPatrolLayer(L, salt)) { patrolLayer = L; break; }
  assert.ok(patrolLayer > 0, '应能找到巡逻层');
  Tower._debugSetEndlessLayer(patrolLayer);
  const pr = Tower._debugRun('endless');
  /* ⑦ 定格面板、**不持有玩家的增益**（2026-10 第七十七批用户口径）：
   * 魔王只照抄玩家第一回合开始时的力/敏/速/血（各种乘区已经在里面）与装备词条 / 裸属性 / 师父等级；
   * 涅槃（deathSaves）、后发制人（catchUpPct）、越战越勇（roundStatPct）、治疗烙印（healMul）、
   * 秘技通神（skillBoost）这类**局内**东西一律不给它。
   * 两条真实增益先把「玩家的那份」喂出来，确认它们确实**没有**被抄过去。
   * ⚠ 必须在 nextBattle **之前**给 —— agg 是 nextBattle 当场聚合的，adjustMe 用的是那一份快照。 */
  Tower.debugGrantBuff('C21');
  Tower.debugGrantBuff('C14');
  pr.env = []; pr.choices = null; pr.noEnvRoll = true;
  pr.idx = pr.plan.findIndex((e) => e.kind === 'patrol');
  const px = Tower.nextBattle('endless');
  {
    /* ⚠ 不要往 me.mods 里塞东西：adjustMe 把 `me.mods` 当**环境词缀输入**读过一次
     *（`for (const [k,v] of Object.entries(envModsMine)) mods[k] = (Number(mods[k])||0) + v`），
     * 真实流程里 main.js 造的 me 根本没有这个字段。这里按真实流程来，看 adjustMe 自己聚合出来的那一包。 */
    const meStub = { power: 1234, agility: 567, speed: 89, hp: 4321, maxHp: 4321,
      baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [], skills: [], effects: { 12: 0.25 },
      masterLevel: 3, healMul: 1.4, skillBoost: { 14: 0.6 } };
    px.adjustMe(meStub);
    const mf = px.foe;
    assert.equal(mf.power, 1234 + 9, '面板照抄玩家，再叠狂战套 2 件档力量 +9：' + mf.power);
    assert.equal(mf.agility, 567, '敏捷照抄');
    assert.equal(mf.maxHp, 4321, '生命上限照抄');
    /* 玩家这一场确实有增益（暴击精通 + 涅槃），但魔王**不该**拿到它们。 */
    assert.ok(Number(meStub.mods && meStub.mods.critBonus) > 0, '玩家自己是有暴击精通的');
    assert.ok(Array.isArray(meStub.mods.deathSaves) && meStub.mods.deathSaves.length > 0, '玩家自己有涅槃');
    assert.ok(!mf.mods || (!mf.mods.critBonus && !mf.mods.deathSaves),
      '魔王**不持有**玩家的增益包（涅槃 / 后发制人 / 越战越勇这类局内效果都不该生效）：' + JSON.stringify(mf.mods));
    assert.equal(mf.healMul, undefined, '治疗烙印（healMul）是局内增益，不给魔王');
    assert.equal(mf.skillBoost, undefined, '秘技通神（skillBoost）是局内增益，不给魔王');
    assert.equal(mf.effects['12'], 0.25, '装备词条属于面板，照抄');
    assert.equal(mf.masterLevel, 3, '师父等级属于账号进度，照抄');
    assert.equal(mf.baseStats.power, 100, '裸属性照抄（真·色诱之术脱装备后要用）');
    /* 行为逻辑与玩家同源：没有 npcType、也没有固定出招循环（sim 见 pattern 为空即走随机选招）。 */
    assert.equal(mf.npcType, null, '魔王必须走「玩家式 AI」分支');
    assert.ok(!(mf.pattern && mf.pattern.length), '魔王没有固定出招循环：' + JSON.stringify(mf.pattern));
  }
  const prw = Tower.reportBattle('endless', px.token, false, 1, 2000, null);
  assert.equal(prw.patrol, true, '普通巡逻战输了不结算');
  assert.equal(prw.phase, 'patrolToll');
  assert.equal(Tower._debugRun('endless').phase, 'patrolToll', 'phase 必须挺过归一化');
  assert.equal(Tower.endlessInfo().run.layer, patrolLayer, '层数不动');
  /* ⑦ 收尾：交完账要**继续推进**到下一场。
   * 【第七十八批修 bug】原来 finishPatrolToll 只清 phase / patrolTollAt，**层内序号不动** ——
   * 下一次 nextBattle 取到的还是同一场巡逻，玩家交完 buff 被扔回这场战斗的开头，永远过不去（用户实测）。
   * 现在与胜利路径同一套推进：idx + 1；本层打完就 layerClear（层号 +1、idx 归 0）。 */
  Tower._debugRun('endless').phase = 'patrolToll';
  const beforeIdx = Tower._debugRun('endless').idx;
  const beforeLayer = Tower._debugRun('endless').layer;
  const done = Tower.finishPatrolToll();
  assert.equal(done.ok, true, '收缴要能正常结束');
  const after = Tower._debugRun('endless');
  assert.equal(after.phase, null, '收缴结束后继续巡逻');
  const moved = (after.idx === beforeIdx + 1) || (after.layer === beforeLayer + 1 && after.idx === 0);
  assert.ok(moved, '交完账必须推进到下一场（不能原地重打巡逻）：idx ' + beforeIdx + '→' + after.idx +
    ' / 层 ' + beforeLayer + '→' + after.layer);
  /* 推进之后「下一场」不该还是那一场巡逻 —— 也就是说 nextBattle 不会再给同一个 entry。
   * 若这一层已打完就跳过（layerClear 会开店 / 换层，phase 不为空是正常的）。 */
  if (!after.phase) {
    const nxt = Tower.nextBattle('endless');
    assert.ok(nxt && nxt.ok !== false, '推进之后要能开下一场：' + ((nxt && nxt.msg) || ''));
    assert.ok(!(nxt.entry && nxt.entry.kind === 'patrol' && nxt.entry.replacedIndex === pe[0].replacedIndex &&
      nxt.entry._layer === pe[0]._layer), '不该又回到同一场巡逻：' + JSON.stringify(nxt.entry));
  }
});
test('觐见魔王（x00）：固定持有两件涅槃plus（3 条命）+ 两件破碎终焉烙印，且「假如我直接赢」只吃一条命', () => {
  /* 2026-10 第八十二批 用户口径。x00 那一只额外固定持有：
   *   · 两件涅槃plus —— 每条命：死亡回满血 + 当场生命上限 +20%、减伤 15%（可叠加）；
   *   · 两件已破碎的终焉烙印 —— 终乘 ×1.6（力/敏/速/生命上限）。
   * 于是它一共 3 条命，E17「假如我直接赢」只干掉第一条。 */
  const c = setup();
  const { Tower, TowerData: TD, Sim } = c;
  freshRun(c);
  Tower._debugSetEndlessLayer(100);                 // 整百层 = 觐见魔王三连战
  const run = Tower._debugRun('endless');
  run.env = []; run.choices = null; run.phase = null;
  /* 前两场是近卫，直接判胜推过去。 */
  for (let guard = 0; run.idx < 2 && guard < 8; guard++) {
    const nx = Tower.nextBattle('endless');
    assert.ok(nx && nx.ok !== false, '近卫战要能开起来：' + ((nx && nx.msg) || ''));
    Tower.reportBattle('endless', nx.token, true, 9999, 9999, { rounds: [] });
  }
  const bx = Tower.nextBattle('endless');
  assert.equal(bx.entry.kind, 'patrol', '第三场是魔王本体');
  assert.equal(bx.entry.x00, true, '它带着 x00 标记');
  const meStub = { power: 500, agility: 400, speed: 300, hp: 9000, maxHp: 9000,
    baseStats: { power: 100, agility: 100, speed: 100 }, weapons: [], skills: [], effects: {}, masterLevel: 3 };
  bx.adjustMe(meStub);
  const foe = bx.foe;
  assert.equal(foe.demonLives, 3, '一共 3 条命（本体 + 两件涅槃plus）：' + foe.demonLives);
  assert.equal((foe.mods.deathSaves || []).length, 2, 'deathSaves 里两条涅槃plus');
  for (const sv of foe.mods.deathSaves) {
    assert.equal(sv.bossLife, true, '这两条命要带 bossLife（E17 才认它）');
    assert.equal(sv.healPct, 1, '每条命回满血');
    assert.equal(sv.maxHpMul, 0.2, '每条命生命上限 +20%');
    assert.equal(sv.takenMul, -0.15, '每条命减伤 15%');
    assert.equal(sv.name, '涅槃+');
  }
  assert.equal(foe.brokenBrandFinalMul, 1.6, '两件破碎终焉烙印 → 终乘 ×1.6');
  /* 幂等：adjustMe 万一被调两次，命数不能翻倍、终乘也不能叠成 2.56。 */
  bx.adjustMe(meStub);
  assert.equal(foe.demonLives, 3, '重复调用 adjustMe 不该加命：' + foe.demonLives);
  assert.equal((foe.mods.deathSaves || []).length, 2, 'deathSaves 也不能翻倍');
  assert.equal(foe.brokenBrandFinalMul, 1.6, '终乘仍是 ×1.6：' + foe.brokenBrandFinalMul);
  assert.equal(foe.maxHp, Math.round(9000 * 1.6), '重复复制后面板仍是 ×1.6：' + foe.maxHp);
  assert.equal(foe.maxHp, Math.round(9000 * 1.6), '终乘要真的乘进生命上限：' + foe.maxHp);
  assert.ok(foe.power > meStub.power * 1.5, '力/敏/速同样吃终乘：' + foe.power);
  /* 真打一场：碾压配置下要**恰好复活 2 次**（3 条命）。 */
  const mkFoe = () => JSON.parse(JSON.stringify({ name: foe.name, level: 70, power: foe.power, agility: foe.agility,
    speed: foe.speed, hp: foe.maxHp, maxHp: foe.maxHp, weapons: [], skills: [], effects: {},
    baseStats: foe.baseStats, mods: foe.mods, setFx: foe.setFx || null }));
  const hero = { name: '我', level: 70, power: 100000, agility: 100000, speed: 100000,
    hp: 500000, maxHp: 500000, weapons: [{ id: 3, level: 15 }], skills: [], effects: {},
    baseStats: { power: 100000, agility: 100000, speed: 100000 } };
  const killed = Sim.simulate(hero, mkFoe());
  const revives = (killed.rounds || []).filter((r) => r.deathSave);
  assert.equal(revives.length, 2, '三条命 → 复活两次：' + revives.length);
  assert.ok(revives.every((r) => /涅槃\+/.test(r.noteText || '')), '复活提示要写涅槃+：' + JSON.stringify(revives.map((r) => r.noteText)));
  assert.equal(killed.winner, 0, '杀满三条命才算赢');
  /* 【第八十三批修 bug】sim **不能**把调用方的命吃掉：同一只 foe 再模拟一次，命数必须还在。
   * 原来 `makeCombatant` 直接共享 `mods` 引用，sim 里的 `deathSaves.shift()` 会把 foe 的命一起扣光 ——
   * 第二次模拟（重放 / 重打 / 任何重复结算）就变成**一击秒杀**，正是用户看到的「魔王还是直接判胜」。 */
  {
    const live = mkFoe();
    const r1 = Sim.simulate(hero, live);
    assert.equal((live.mods.deathSaves || []).length, 2, '模拟一次之后 foe 的命不该被扣掉：' + (live.mods.deathSaves || []).length);
    assert.equal(r1.rounds.filter((r) => r.deathSave).length, 2, '第一场照样复活两次');
    const r2 = Sim.simulate(hero, live);
    assert.equal(r2.rounds.filter((r) => r.deathSave).length, 2, '同一只 foe 再打一次仍要复活两次（不能变一击秒杀）');
    const r3 = Sim.simulate(Object.assign({}, hero, { mods: { openKill: 1 } }), live);
    assert.equal(r3.rounds.filter((r) => r.deathSave).length >= 2, true,
      'E17 在重复模拟之后也只吃掉第一条命：' + r3.rounds.filter((r) => r.deathSave).length);
    assert.ok(r3.rounds.length > 1, 'E17 不会一击终结：' + r3.rounds.length);
  }
  /* 「假如我直接赢」：只吃掉一条命 —— 第一回合是**复活**而不是终局。 */
  const withE17 = Sim.simulate(Object.assign({}, hero, { mods: { openKill: 1 } }), mkFoe());
  const first = (withE17.rounds || [])[0] || {};
  assert.equal(first.deathSave, true, 'E17 那一击要触发第一条命：' + JSON.stringify({ dmg: first.dmg, note: first.noteText }));
  assert.match(first.noteText || '', /假如我直接赢/, '飘字要写清是 E17 打的：' + first.noteText);
  assert.match(first.noteText || '', /涅槃\+/, '并带上涅槃+：' + first.noteText);
  assert.ok((first.hpAfter || [])[1] > 0, '魔王没死，还活着：' + JSON.stringify(first.hpAfter));
  assert.ok((withE17.rounds || []).length > 1, 'E17 不再一击终结：' + withE17.rounds.length);
  assert.ok(withE17.rounds.filter((r) => r.deathSave).length >= 2, '还得再杀两条命');
  /* 对照：**普通敌人**身上的真涅槃照旧被 E17 无视（这是 E17 原本的设计，不能一起改掉）。 */
  const plain = { name: '小怪', level: 70, power: 100, agility: 100, speed: 100, hp: 5000, maxHp: 5000,
    weapons: [], skills: [], effects: {}, baseStats: { power: 100, agility: 100, speed: 100 },
    mods: { deathSaves: [{ healPct: 0.5, statMul: 0.5, revive: true, name: '涅槃' }] } };
  const oneShot = Sim.simulate(Object.assign({}, hero, { mods: { openKill: 1 } }), plain);
  assert.equal(oneShot.rounds.length, 1, '普通敌人仍是一击带走：' + oneShot.rounds.length);
  assert.equal(oneShot.rounds.filter((r) => r.deathSave).length, 0, '它的涅槃不触发');
  /* 反向：寻常巡逻层那只**不**额外持有（用户口径限定 x00）。 */
  {
    /* 先把上面那场没报结果的战斗收掉（否则 nextBattle 会被「上一场还没结算」拒掉）。 */
    if (Tower.interruptBattle) Tower.interruptBattle('endless');
    const at = TD.patrolLayerInBlock(4, run.salt);
    Tower._debugSetEndlessLayer(at);
    const r2 = Tower._debugRun('endless');
    r2.env = []; r2.choices = null; r2.phase = null; delete r2.attempt;
    r2.idx = r2.plan.findIndex((e) => e.kind === 'patrol');
    const px = Tower.nextBattle('endless');
    assert.ok(px && px.ok !== false && typeof px.adjustMe === 'function',
      '寻常巡逻层那只也要能开起来：' + ((px && px.msg) || ''));
    px.adjustMe(meStub);
    assert.equal(px.foe.demonLives, undefined, '寻常巡逻层那只不额外持有涅槃plus');
    assert.equal(px.foe.mods && px.foe.mods.deathSaves, undefined, '它也不该有额外的命');
    assert.equal(px.foe.brokenBrandFinalMul, undefined, '终乘只给 x00');
  }
});

test('巡视的传奇三选一不再挤掉第 3 场的战斗掉落：两批都保留、选完自动接上', () => {
  const c = setup(20261026);
  const T = c.Tower, TD = c.TowerData;
  T.setStoryEnabled(false);
  freshRun(c);
  T._debugSetEndlessLayer(7);
  const run = T._debugRun('endless');
  run.choices = null; run.choiceQueue = []; run.phase = null; run.env = []; run.noEnvRoll = true;
  delete run.attempt; delete run.pendingRetry;
  /* 第一次巡视会固定发渴血之剑（替代传奇），这条用例要测的是**已持剑后**的巡视传奇。 */
  assert.equal(T.debugGrantBuff('HB01').ok, true);
  /* 4 场层：第 3 场打完本该给一次普通战斗掉落；这里把这一场换成巡视。 */
  run.idx = 2;
  run.plan[2] = { kind: 'patrol', id: 'patrol', _layer: run.layer, _salt: run.salt };
  const nx = T.nextBattle('endless');
  assert.ok(nx && nx.ok !== false, '应当能开战：' + ((nx && nx.msg) || ''));
  const rw = T.reportBattle('endless', nx.token, true, 1000, 1000, null);
  assert.equal(rw.choicesKind, 'patrolLegendary', '先展示巡视的传奇三选一');
  assert.ok(rw.choices && rw.choices.length, '巡视应当给传奇奖励');
  assert.ok(rw.choices.every((ch) => TD.BUFF_BY_ID[ch.id].rarity === 3),
    '巡视这一批必须都是传奇：' + JSON.stringify(rw.choices));
  assert.equal((rw.choiceQueue || []).length, 1, '普通战斗掉落要排队，不能被挤掉');
  assert.equal(rw.choiceQueue[0].kind, 'normal', '排队的是普通战斗掉落');
  const normalIds = rw.choiceQueue[0].choices.map((ch) => ch.id).join(',');
  assert.ok(normalIds.length > 0, '普通掉落应当有内容');

  const picked = T.pickChoice('endless', 0);
  assert.ok(picked && picked.ok, '先选巡视那批：' + ((picked && picked.msg) || ''));
  assert.equal(run.choicesKind, 'normal', '选完巡视后自动接上普通战斗掉落');
  assert.equal(run.choices.map((ch) => ch.id).join(','), normalIds, '接上的必须是原先排队的那一批');
  const picked2 = T.pickChoice('endless', 0);
  assert.ok(picked2 && picked2.ok, '普通掉落也要能正常选：' + ((picked2 && picked2.msg) || ''));
  assert.equal(run.choices, null, '两批都选完就清空');
  assert.equal((run.choiceQueue || []).length, 0, '队列也要清空');
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

  // 切出 debug.js 里真实的 renderBuffReport 来跑（读源码做文本定位前先归一 CRLF：
  // Git for Windows 检出会把 LF 变成 CRLF，行尾的 \r 会让 '\n  function …' 这类锚定找空 —— 见 tools/AGENTS.md 第 7 条）
  const src = fs.readFileSync(path.join(ROOT, 'js', 'debug.js'), 'utf8').replace(/\r\n/g, '\n');
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
