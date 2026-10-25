#!/usr/bin/env node
/* ============================================================
 * tools/verify.cjs — 无尽塔「全流程对账」三件套（**合并**自原先三个 verify-*.cjs）
 *
 *   node tools/verify.cjs story    [seed] [maxSteps] [--quiet]   剧情全流程对账机器人
 *   node tools/verify.cjs layer100 [轮数]                        整百层「王庭 + 第一近卫」定向回归
 *   node tools/verify.cjs stacking [--verbose]                   同名叠加审计
 *   node tools/verify.cjs all                                    依次跑这三项（默认）
 *
 * 为什么合并：三个工具原来各带一套一模一样的引导（vm 里加载真 js/、localStorage 桩、
 * 账号解锁到 70 级、固定随机流），合并后只剩一份头部；三块正文按原样放在各自函数里，
 * 行为与合并前一致（用 node tools/verify.cjs <模式> 单独跑任一项）。
 * 它们都属于「跑一次几分钟、按需手跑」的验证工具（不进 CI，CI 只枚举 test-*.cjs）；
 * 应当条件与实测对照见 docs/剧情触发条件.md。
 * ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const LOAD = ['js/gamedict.js', 'js/gamedata.js', 'js/battle-drops.js', 'js/tower-data.js',
  'js/state.js', 'js/sim.js', 'js/tower.js', 'js/tower-plot.js'];

/* ============================================================
 * runStoryFlow() —— 原 tools/verify-story-flow.cjs 的正文（**原样搬入**，只去掉了重复的头部样板）
 * ============================================================ */
async function runStoryFlow() {
  const SEED = Number(process.argv[2] || 12345);
  const MAX_STEPS = Number(process.argv[3] || 4000);
  const QUIET = process.argv.includes('--quiet');

  /* ---------------- 界面桩（与 tools/test-mint-shop.cjs 同款，另加真定时器队列） ---------------- */
  function uiHarness(c) {
    const rendered = [];
    const handlers = new Map();
    const el = () => ({
      innerHTML: '', dataset: {}, getContext: null,
      querySelector: (sel) => { if (!handlers.has(sel)) handlers.set(sel, { onclick: null }); return handlers.get(sel); },
      querySelectorAll: () => [], appendChild: () => {}, remove: () => {}, replaceWith: () => {},
      classList: { add: () => {}, remove: () => {} },
    });
    vm.runInContext('globalThis.__q=[]; setTimeout=function(fn,ms){__q.push(fn);return __q.length;}; clearTimeout=function(){};', c);
    c.document = { createElement: () => el(), body: { appendChild: () => {} }, activeElement: null,
      querySelector: () => null, querySelectorAll: () => [] };
    c.UI = { classic: {
      page: (g, a, content) => { const node = el(); rendered.push({ kind: 'page', content: content, node: node }); return node; },
      modal: (t, content, buttons) => { rendered.push({ kind: 'modal', title: t, content: content, buttons: buttons || [] }); return { element: el(), close: () => {} }; },
      btn: (label, action, cls) => '<button class="' + (cls || '') + '" data-action="' + action + '">' + label + '</button>',
      icon: () => '<i></i>', bind: () => {}, home: () => {}, refreshHeader: () => {},
    } };
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/tower-plot.js'), 'utf8'), c, { filename: 'js/tower-plot.js' });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8'), c, { filename: 'js/tower-ui.js' });
    const page = () => String((rendered.filter((r) => r.kind === 'page').pop() || {}).content || '');
    const modals = () => rendered.filter((r) => r.kind === 'modal');
    return {
      rendered,
      page,
      /* 剧情屏 / 停留提示屏的判据：整屏都带 `.tower-story`（2026-10 用户口径去掉了右下角
       * 「继续」按钮，所以不能再拿 `data-action="story-next"` 当判据）。 */
      screen: () => (/data-story-text/.test(page()) ? '剧情屏'
        : /烙印失效/.test(page()) ? '停留提示屏'
          : /tower-story/.test(page()) ? '提示屏'
            : /data-action="mirror-pick"/.test(page()) ? '拾取屏'
              : /data-action="fight"/.test(page()) ? '主界面' : '其它'),
      has: (a) => new RegExp('data-action="' + a + '"').test(page()),
      click: (a) => { const h = handlers.get('[data-action="' + a + '"]'); if (!h || !h.onclick) return false; h.onclick(); return true; },
      /* 只按**当前这一屏**上真的存在的按钮点（避免点到上一屏残留的处理器） */
      clickVisible: (a) => (new RegExp('data-action="' + a + '"').test(page()) ? (() => { const h = handlers.get('[data-action="' + a + '"]'); if (!h || !h.onclick) return false; h.onclick(); return true; })() : false),
      /* 剧情推进：点屏幕任意位置（与真人同一条路；剧情屏没有「继续」按钮了）。 */
      storyNext: () => {
        const pg = rendered.filter((r) => r.kind === 'page').pop();
        if (!pg || !pg.node || typeof pg.node.onclick !== 'function') return false;
        pg.node.onclick({ target: null });
        return true;
      },
      lastModal: () => modals().pop() || null,
      modalCount: () => modals().length,
      flush: function (limit) {
        for (let i = 0; i < (limit || 400); i++) {
          const list = vm.runInContext('(function(){var l=__q.slice();__q.length=0;return l;})()', c);
          if (!list.length) return i;
          list.forEach((fn) => { try { fn(); } catch (e) { /* 界面桩里的动画回调出错不算 */ } });
        }
        return -1;
      },
    };
  }

  /* ---------------- 起一局（固定随机流，可复现） ---------------- */
  function setup(seed) {
    const store = new Map();
    class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
    const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
    c.window = c; c.self = c;
    vm.createContext(c);
    for (const f of LOAD) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
    c.State.newGame('机器人' + seed);
    const S = c.State.state();
    S.level = 70; S.props[23] = 30; S.props[21] = 20; S.props[22] = 20;
    /* 机器人也要有武器 / 技能：否则「神兵淬炼 / 秘技通神」这类选取型强化没有可选目标，
     * 弹窗会一直重开（那是另一个待修的软锁，与剧情无关；这里先给上目标继续爬塔）。 */
    S.weapons = ['1:5', '2:5', '3:5', '4:5'];
    S.skills = ['1:5', '2:5', '3:5', '4:5'];
    for (let i = 1; i <= 36; i++) S.stages[i] = { npcIndex: 3, passed: true };
    /* 游戏内随机 = 固定 LCG（同一 seed 完全可复现） */
    vm.runInContext('(function(){var s=' + (seed >>> 0) + ';Math.random=function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};})()', c);
    c.Main = { startBattle: () => Promise.resolve(), showHome: () => {} };
    c.Tower.startEndlessRun();
    c.Tower.setStoryEnabled(true);
    return c;
  }

  /* ---------------- 机器人 ---------------- */
  const ENTRY = { 20: ['gate20'], 30: ['layer30'], 40: ['layer40'], 90: ['layer90'], 95: ['layer95'] };
  const X00 = ['layer100', 'x00a'];

  (async () => {
    const c = setup(SEED);
    const T = c.Tower, TD = c.TowerData, ui = uiHarness(c);
    const wait = () => new Promise((r) => setTimeout(r, 0));

    /* 记录每一段「开始播」的剧情（包住 TowerPlot.begin —— 界面就是用它的返回值渲染这一屏的）。
     * `layer` 是「播这一段时所在的层」，用于核对「本次到达整百层」这一套。 */
    const begun = [];
    const origBegin = c.TowerPlot.begin;
    c.TowerPlot.begin = function (id) {
      const def = c.TowerPlot.SCRIPTS[id];
      /* 连续同一个 id = 同一段在反复重画这一屏（界面每次 render 都会 begin 一次），不算「又播了一遍」。 */
      if (!begun.length || begun[begun.length - 1].id !== id) {
        const run = T._debugRun('endless');
        begun.push({ id: id, layer: run ? run.layer : -1, step: step, once: !!(def && def.once) });
      }
      return origBegin(id);
    };
    /** 这一段最近一次是不是**在第 layer 层**播的（整百层那五段按「每次到达」核对）。 */
    const playedAt = (id, layer) => begun.some((b) => b.id === id && b.layer === layer);

    const bad = [];
    const note = (msg, extra) => { if (bad.length < 12) bad.push(msg + (extra ? ' ｜ ' + extra : '')); };
    let step = 0;
    let lastLayer = 0;
    let handledModals = 0;
    const ring = [];
    /* 这一场战斗的输赢由机器人决定（巡逻偶尔输，用来跑收缴流程；魔王战永远赢，免得整局结束）。 */
    let nextWin = true;
    c.Main.startBattle = (foe, opts) => {
      Promise.resolve().then(() => opts.onEnd(nextWin ? 0 : 1, { hpAfter: [nextWin ? 4200 : 0], maxHp: [5200], rounds: [] }));
      return Promise.resolve();
    };
    const R = (() => { let s = (SEED ^ 0x9e3779b9) >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; })();

    /* 「第一场战斗开打之前，这一层的入场剧情必须已经播过」——在**取到令牌之前**核对。 */
    const checkBeforeBattle = (run) => {
      const L = run.layer, idx = run.idx;
      const isX00 = (Math.floor(L) || 0) > 0 && (Math.floor(L) || 0) % 100 === 0;
      if (isX00) {
        /* 整百层：这一套是「每次到达都讲一遍」的（不看存档 seen 表）。 */
        const pre = Math.max(0, Math.floor(Number(run.x00PreNo) || 0));
        if (idx === 0) {
          if (pre < 2) note('第 ' + L + ' 层第 1 场之前只讲到第 ' + pre + ' 段（王庭 / 第一近卫 共 2 段）');
          if (!playedAt('layer100', L)) note('第 ' + L + ' 层第 1 场之前没播 layer100（王庭）');
          if (!playedAt('x00a', L)) note('第 ' + L + ' 层第 1 场之前没播 x00a（第一近卫）');
        }
        if (idx === 1 && !playedAt('x00b', L)) note('第 ' + L + ' 层第 2 场之前没播 x00b（第二近卫）');
        if (idx === 2 && !playedAt('x00c', L)) note('第 ' + L + ' 层第 3 场之前没播 x00c（三重王命）');
        return;
      }
      if (idx !== 0) return;
      for (const id of (ENTRY[L] || [])) if (!T.storySeen(id)) note('第 ' + L + ' 层第 1 场之前没播 ' + id);
    };
    /* 巡逻那一场之前，本层的巡视剧情必须已经讲过（patrolStoryAt 记的就是这件事）。 */
    const checkPatrol = (run) => {
      const entry = (run.plan || [])[run.idx];
      if (!entry || entry.kind !== 'patrol' || entry.x00) return;
      const at = Math.floor(Number(run.patrolStoryAt) || 0);
      if (at !== Math.floor(Number(run.layer) || 0)) note('第 ' + run.layer + ' 层巡视那一场之前没讲巡视剧情（patrolStoryAt=' + at + '）');
    };
    /* 播过的「只播一次」不许再播一次。 */
    const checkReplay = () => {
      const seen = Object.create(null);
      for (const b of begun) {
        if (!b.once) continue;
        if (seen[b.id]) note('「只播一次」的剧情播了两次：' + b.id + '（第 ' + seen[b.id] + ' / ' + b.step + ' 步）');
        seen[b.id] = b.step;
        if (T.storySeen(b.id) && begun.filter((x) => x.id === b.id).length > 1) note('已记 seen 之后又播了一次：' + b.id);
      }
    };

    while (step++ < MAX_STEPS) {
      c.TowerUI.openEndless();
      ui.flush(60);
      await wait();
      c.TowerUI.openEndless();
      const run = T._debugRun('endless');
      if (!run) { note('对局在第 ' + step + ' 步没了（层数 ' + (lastLayer || '?') + '）'); break; }
      lastLayer = run.layer;
      const scr = ui.screen();
      ring.push('#' + step + ' ' + scr + ' L' + run.layer + ' idx' + run.idx + ' phase=' + String(run.phase) +
        ' story=' + JSON.stringify(run.story) + ' pend=' + JSON.stringify(run.pendingStory) +
        ' choices=' + (run.choices ? run.choices.length : 0) + ' shop=' + (run.shop ? 'y' : 'n') +
        ' 弹窗=' + ui.rendered.filter((r) => r.kind === 'modal').length +
        ' 最新弹窗=' + JSON.stringify((ui.rendered.filter((r) => r.kind === 'modal').pop() || {}).title || null) +
        ' pendingPick=' + JSON.stringify(run.pendingPick || null));
      if (ring.length > 40) ring.shift();

      /* ① 剧情 / 提示屏 → 一直「点屏幕」读完（2026-10 用户口径：剧情屏没有「继续」按钮了） */
      if (scr === '剧情屏' || scr === '提示屏' || scr === '停留提示屏') {
        checkReplay();
        ui.storyNext();
        ui.flush(20);
        continue;
      }
      /* ② 拾取屏 → 拾取 */
      if (scr === '拾取屏') { ui.clickVisible('mirror-pick'); ui.flush(60); continue; }
      /* ③ 弹窗：里程碑 / 回响 / 镜中世界确认 / 收缴 / 放弃 —— **只处理新出现的那个**
       * （界面桩不会「关掉」弹窗，历史记录会一直留着；按索引认新的）。 */
      const allModals = ui.rendered.filter((r) => r.kind === 'modal');
      const modal = allModals.length > handledModals ? allModals[allModals.length - 1] : null;
      if (modal && modal.buttons && modal.buttons.length) {
        handledModals = allModals.length;
        const labels = modal.buttons.map((b) => b.label);
        const pick = labels.indexOf('是') >= 0 ? '是'
          : labels.indexOf('继续') >= 0 ? '继续'
            : labels.indexOf('下一场') >= 0 ? '下一场'
              : labels.indexOf('再战一场') >= 0 ? '再战一场'
                : labels.indexOf('留在这里') >= 0 ? '留在这里'
                  : labels.indexOf('继续冲塔') >= 0 ? '继续冲塔'
                    : labels[0];
        const b = modal.buttons.find((x) => x.label === pick);
        if (b && b.run) { b.run(); ui.flush(20); continue; }
      }
      /* ④ 局内阶段 */
      if (run.phase === 'shop') {
        /* 随机买几件（不买也行），然后走人 */
        const shop = T.shopState ? T.shopState() : null;
        const slots = (shop && shop.slots) || [];
        const buys = slots.map((s, i) => i).filter(() => R() < 0.5);
        for (const i of buys) { try { T.buyShopSlot(i); } catch (e) { /* 买不起就算了 */ } }
        T.continueFromShop && run.phase === 'shop' && run.shop && run.shop.boundary ? T.continueFromShop() : T.closeShop();
        c.TowerUI.openEndless();
        continue;
      }
      if (run.phase === 'checkpoint') { T.continueEndless(); continue; }
      if (run.phase === 'sacrifice') {
        const cands = T.sacrificeCandidatesOf() || [];
        if (cands.length) T.sacrificePerm(cands[0].uid != null ? cands[0].uid : cands[0].id);
        else { run.phase = null; }
        continue;
      }
      if (run.phase === 'patrolToll' || run.phase === 'patrolDiscard') {
        const cands = (T.patrolTollCandidates() || {}).list || [];
        if (cands.length) T.payPatrolToll(cands[0].ref);
        T.finishPatrolToll();
        continue;
      }
      if (run.phase === 'mirror') {
        if (T.mirrorPending()) { ui.clickVisible('mirror-pick'); ui.flush(60); continue; }
        ui.clickVisible('fight');           // → 确认弹窗（下一轮处理）
        ui.flush(20);
        continue;
      }
      /* ⑤ 场间选择 */
      if (run.choices) {
        let res = T.pickChoice('endless', 0);
        /* 永久位满了 → 界面会弹「先选一个替换掉」：机器人拿一条已有的换上（照影之境不换）。 */
        if (res && res.needsReplace) {
          const cands = (run.permanent || []).filter((b) => b && b.id !== TD.MIRROR.id && b.slotFree !== true);
          for (const cand of cands) {
            res = T.pickChoice('endless', 0, cand.uid != null ? cand.uid : cand.id);
            if (res && res.ok) break;
          }
        }
        if (res && !res.ok) { note('场间选择选不了：' + (res.msg || '')); break; }
        c.TowerUI.openEndless();
        continue;
      }
      /* ⑥ 开打（先核对「入场剧情是否已经播过」） */
      checkBeforeBattle(run);
      checkPatrol(run);
      const before = { layer: run.layer, idx: run.idx };
      nextWin = true;
      const entry = (run.plan || [])[run.idx] || {};
      if (entry.kind === 'patrol' && !entry.x00 && R() < 0.35) nextWin = false;      // 巡逻偶尔输
      if (!ui.clickVisible('fight')) { note('这一屏没有可点的「继续战斗」（' + scr + '）'); break; }
      await wait();
      ui.flush(30);
      const after = T._debugRun('endless');
      if (after && after.layer === before.layer && after.idx === before.idx && !after.attempt) {
        /* 没开打也没变状态：可能是被剧情的闸拦住了（那也算正常），下一轮重画会看到剧情屏 */
      }
      if (before.layer === 100 && before.idx === 0) {
        /* 第 100 层第 1 场结束之后：这一段（本层）早该讲完了 —— 按「每次到达都讲」的新口径核对 */
        const pre = Math.max(0, Math.floor(Number((after || {}).x00PreNo) || 0));
        if (pre < 2 || !playedAt('layer100', 100) || !playedAt('x00a', 100)) {
          note('第 100 层第 1 场打完之后「王庭 + 第一近卫」还没讲完（x00PreNo=' + pre + '）');
        }
      }
      if (after && after.layer === 100 && after.idx === 2 && !playedAt('x00b', 100)) note('第 100 层第 2 场之前没播 x00b（第二近卫）');
      if (after && after.layer === 100 && after.idx === 3 && !playedAt('x00c', 100)) note('第 100 层第 3 场之前没播 x00c（三重王命）');
      if (after && after.layer > 100 && before.layer === 100) {
        if (!playedAt('x00win', 100)) note('第 100 层打完之后没播 x00win（终章）');
        if (!T.mirrorStacks()) note('第 100 层打完没有拿到照影之境');
      }
      if (T.storySeen('layer31') === false && run.layer > 40) { /* 失烙印：见下面的循环末检查 */ }
      if (lastLayer !== run.layer) { /* 换层了 */ }
    }

    console.log('跑完 seed=' + SEED + ' 步数=' + step + ' 最终层=' + (T._debugRun('endless') ? T._debugRun('endless').layer : '无对局'));
    console.log('播过的剧情（前 40 条）：' + begun.slice(0, 40).map((b) => b.id + '@' + b.layer).join(' → '));
    if (step >= MAX_STEPS) { console.log('最后 40 步：'); ring.forEach((r) => console.log('   ' + r)); }
    console.log('storySeen = ' + JSON.stringify(c.State.state().endless.storySeen));
    if (bad.length) {
      console.log('\n❌ 违规 ' + bad.length + ' 条：');
      bad.forEach((b, i) => console.log('  ' + (i + 1) + '. ' + b));
      process.exitCode = 1;
    } else {
      console.log('✅ 剧情触发条件全部满足（' + begun.length + ' 段）');
    }
  })();
}

/* ============================================================
 * runStoryLayer100() —— 原 tools/verify-story-layer100.cjs 的正文（**原样搬入**，只去掉了重复的头部样板）
 * ============================================================ */
async function runStoryLayer100() {
  const ROUNDS = Number(process.argv[2] || 40);

  function uiHarness(c) {
    const rendered = [];
    const handlers = new Map();
    const el = () => ({
      innerHTML: '', dataset: {}, getContext: null,
      querySelector: (sel) => { if (!handlers.has(sel)) handlers.set(sel, { onclick: null }); return handlers.get(sel); },
      querySelectorAll: () => [], appendChild: () => {}, remove: () => {}, replaceWith: () => {},
      classList: { add: () => {}, remove: () => {} },
    });
    vm.runInContext('globalThis.__q=[]; setTimeout=function(fn,ms){__q.push(fn);return __q.length;}; clearTimeout=function(){};', c);
    c.document = { createElement: () => el(), body: { appendChild: () => {} }, activeElement: null,
      querySelector: () => null, querySelectorAll: () => [] };
    c.UI = { classic: {
      page: (g, a, content) => { const node = el(); rendered.push({ kind: 'page', content: content, node: node }); return node; },
      modal: (t, content, buttons) => { rendered.push({ kind: 'modal', title: t, content: content, buttons: buttons || [] }); return { element: el(), close: () => {} }; },
      btn: (label, action, cls) => '<button class="' + (cls || '') + '" data-action="' + action + '">' + label + '</button>',
      icon: () => '<i></i>', bind: () => {}, home: () => {}, refreshHeader: () => {},
    } };
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/tower-plot.js'), 'utf8'), c, { filename: 'js/tower-plot.js' });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8'), c, { filename: 'js/tower-ui.js' });
    const page = () => String((rendered.filter((r) => r.kind === 'page').pop() || {}).content || '');
    return {
      rendered, page,
      /* 剧情屏 / 提示屏判据同上面那个桩：看 `.tower-story`（「继续」按钮已按用户口径去掉）。 */
      screen: () => (/data-story-text/.test(page()) ? 'story' : /tower-story/.test(page()) ? 'notice'
        : /data-action="mirror-pick"/.test(page()) ? 'pickup' : /data-action="fight"/.test(page()) ? 'main' : 'other'),
      storyId: () => { const m = page().match(/data-story-id="([^"]+)"/); return m ? m[1] : null; },
      has: (a) => new RegExp('data-action="' + a + '"').test(page()),
      clickVisible: (a) => {
        if (!new RegExp('data-action="' + a + '"').test(page())) return false;
        const h = handlers.get('[data-action="' + a + '"]'); if (!h || !h.onclick) return false;
        h.onclick(); return true;
      },
      /* 剧情推进：点屏幕任意位置（剧情屏没有「继续」按钮了）。 */
      storyNext: () => {
        const pg = rendered.filter((r) => r.kind === 'page').pop();
        if (!pg || !pg.node || typeof pg.node.onclick !== 'function') return false;
        pg.node.onclick({ target: null });
        return true;
      },
      modals: () => rendered.filter((r) => r.kind === 'modal'),
      flush: function (limit) {
        for (let i = 0; i < (limit || 200); i++) {
          const list = vm.runInContext('(function(){var l=__q.slice();__q.length=0;return l;})()', c);
          if (!list.length) return i;
          list.forEach((fn) => { try { fn(); } catch (e) {} });
        }
        return -1;
      },
    };
  }

  function setup(seed) {
    const store = new Map();
    class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
    const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
    c.window = c; c.self = c;
    vm.createContext(c);
    for (const f of LOAD) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
    c.State.newGame('fuzz' + seed);
    const S = c.State.state();
    S.level = 70; S.props[23] = 30;
    S.weapons = ['1:5', '2:5', '3:5']; S.skills = ['1:5', '2:5', '3:5'];
    for (let i = 1; i <= 36; i++) S.stages[i] = { npcIndex: 3, passed: true };
    vm.runInContext('(function(){var s=' + (seed >>> 0) + ';Math.random=function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};})()', c);
    c.Main = { startBattle: () => Promise.resolve(), showHome: () => {} };
    c.Tower.startEndlessRun();
    c.Tower.setStoryEnabled(true);
    return c;
  }

  /** 一轮：摆好某个局面 → 打完第 99 层最后一场 → 一直玩到第 100 层第 1 场开打 →
   *  检查「开打之前 layer100 与 x00a 都已经播过（或早就 seen）」。 */
  async function round(seed, variant) {
    const c = setup(seed);
    const T = c.Tower, TD = c.TowerData, ui = uiHarness(c);
    const wait = () => new Promise((r) => setTimeout(r, 0));
    const begun = [];
    const origBegin = c.TowerPlot.begin;
    c.TowerPlot.begin = function (id) {
      if (!begun.length || begun[begun.length - 1] !== id) begun.push(id);
      return origBegin(id);
    };
    let win = true;
    c.Main.startBattle = (foe, opts) => {
      Promise.resolve().then(() => opts.onEnd(win ? 0 : 1, { hpAfter: [win ? 4200 : 0], maxHp: [5200], rounds: [] }));
      return Promise.resolve();
    };
    /* 摆局面：99 层、Boss 场之前 */
    T._debugSetEndlessLayer(99);
    const run = T._debugRun('endless');
    run.idx = run.plan.length - 1;                    // 本层最后一场
    run.choices = null; run.phase = null; run.finished = null;
    delete run.attempt; delete run.story;
    T.clearRunStory('endless');
    /* 把 100 层那两段的 seen 清掉（模拟第一次爬到 100） */
    const st = c.State.state().endless.storySeen || {};
    delete st.layer100; delete st.x00a; delete st.x00b; delete st.x00c; delete st.x00win;
    delete st.layer31; delete st.patrolGate;
    /* 变体：构造各种「进 100 层之前」的局面 */
    const V = variant || {};
    if (V.brokenMark) run.brokenMarks = [{ kind: 'stat', stat: 'power', pct: 0.12 }];
    if (V.markAlreadyLost) T.markStorySeen('layer31');
    if (V.gateSeen) T.markStorySeen('patrolGate');
    if (V.pendingPatrolFailStory) run.patrolFailStoryAt = 99;
    if (V.staleStory) run.story = V.staleStory;
    if (V.pendingStory) { run.pendingStory = V.pendingStory; run.pendingStoryHold = !!V.hold; }
    if (V.x00stage) run.x00stage = V.x00stage;
    if (V.seenLayer100) T.markStorySeen('layer100');      // 只播过其中一段
    if (V.seenX00a) T.markStorySeen('x00a');
    if (V.e01) T.debugGrantBuff('E01');
    if (V.e15) T.debugGrantBuff('E15');
    if (V.e16) T.debugGrantBuff('E16');
    if (V.fullPerms) { for (const id of ['C01', 'C02', 'C04', 'C05', 'C06']) { try { T.debugGrantBuff(id); } catch (e) {} } }
    /* 第 99 层最后一场：偶尔是巡逻（本层最后一场正好是巡逻的局面） */
    const entry = run.plan[run.idx];
    const isPatrol = entry && entry.kind === 'patrol' && !entry.x00;
    if (V.loseLast) win = false;
    /* 真界面：先重画 → 该读的剧情读完 → 点「继续战斗」 → onEnd */
    let steps = 0, guard = 0;
    let startedBattle1 = false;
    while (guard++ < 60) {
      c.TowerUI.openEndless();
      ui.flush(40);
      await wait();
      c.TowerUI.openEndless();
      const r = T._debugRun('endless');
      const scr = ui.screen();
      steps++;
      /* 目标：走到第 100 层第 1 场开打（layer=100 且取到令牌） */
      if (r.layer === 100 && r.idx === 0 && scr === 'main' && !r.choices && !r.phase) {
        /* 开打之前核对不变量：**这一层**的王庭 + 第一近卫都必须已经播过（不是「以前播过就行」） */
        const pre = Math.max(0, Math.floor(Number(r.x00PreNo) || 0));
        if (pre < 2) return { ok: false, why: '第 100 层第 1 场开打前只讲到第 ' + pre + ' 段（应有 2 段：王庭 / 第一近卫）', begun: begun.slice(), variant: V };
        if (begun.indexOf('layer100') < 0) return { ok: false, why: '这一段没播过 layer100（王庭）', begun: begun.slice(), variant: V };
        if (begun.indexOf('x00a') < 0) return { ok: false, why: '这一段没播过 x00a（第一近卫）', begun: begun.slice(), variant: V };
        startedBattle1 = true;
        return { ok: true, begun: begun.slice() };
      }
      /* 剧情 / 提示屏 → 点继续 */
      if (scr === 'story' || scr === 'notice') { ui.storyNext(); ui.flush(20); continue; }
      if (scr === 'pickup') { ui.clickVisible('mirror-pick'); ui.flush(40); continue; }
      /* 弹窗 */
      const modals = ui.modals();
      const m = modals[modals.length - 1];
      if (m && m.buttons && m.buttons.length && !m.__done) {
        m.__done = true;
        const labels = m.buttons.map((b) => b.label);
        const want = labels.indexOf('是') >= 0 ? '是' : labels.indexOf('继续') >= 0 ? '继续'
          : labels.indexOf('下一场') >= 0 ? '下一场' : labels.indexOf('再战一场') >= 0 ? '再战一场' : labels[0];
        const b = m.buttons.find((x) => x.label === want);
        if (b && b.run) { b.run(); ui.flush(20); continue; }
      }
      /* 阶段 */
      if (r.phase === 'shop' && r.shop) { T.closeShop(); continue; }
      if (r.phase === 'checkpoint') { T.continueEndless(); continue; }
      if (r.phase === 'sacrifice') {
        const cands = T.sacrificeCandidatesOf() || [];
        if (cands.length) T.sacrificePerm(cands[0].uid != null ? cands[0].uid : cands[0].id); else r.phase = null;
        continue;
      }
      if (r.phase === 'patrolToll' || r.phase === 'patrolDiscard') {
        const cands = (T.patrolTollCandidates() || {}).list || [];
        if (cands.length) T.payPatrolToll(cands[0].ref);
        T.finishPatrolToll();
        continue;
      }
      if (r.phase === 'mirror') { if (T.mirrorPending()) { ui.clickVisible('mirror-pick'); ui.flush(40); } else { ui.clickVisible('fight'); ui.flush(20); } continue; }
      if (r.choices) {
        let res = T.pickChoice('endless', 0);
        if (res && res.needsReplace) {
          const cands = (r.permanent || []).filter((b) => b && b.id !== TD.MIRROR.id && b.slotFree !== true);
          for (const cand of cands) { res = T.pickChoice('endless', 0, cand.uid != null ? cand.uid : cand.id); if (res && res.ok) break; }
        }
        continue;
      }
      if (!ui.clickVisible('fight')) return { ok: false, why: '这一屏没有可点的按钮（' + scr + '）', begun: begun.slice(), variant: V };
      await wait();
      ui.flush(30);
    }
    return { ok: false, why: '转了 ' + guard + ' 步都没走到「第 100 层第 1 场」', begun: begun.slice(), variant: V };
  }

  (async () => {
    const variants = [];
    variants.push({ name: '素局' });
    for (const v of [
      { brokenMark: true },                                  // 100 层会随机丢烙印 → layer31 插队
      { brokenMark: true, markAlreadyLost: true },
      { e01: true }, { e15: true }, { e16: true },
      { e01: true, brokenMark: true },
      { fullPerms: true }, { fullPerms: true, brokenMark: true },
      { gateSeen: true },                                    // 之前偶遇过巡视
      { pendingPatrolFailStory: true, loseLast: true },      // 99 层最后一场是巡逻且输了
      { x00stage: 2 }, { x00stage: 4 },                      // 段号残留
      { pendingStory: 'layer31', hold: true },               // 待播槽残留
      { pendingStory: 'layer31', hold: false },
      { staleStory: 'patrolFailB' },                         // run.story 残留（旧档）
      { staleStory: 'patrolWin' },
      { staleStory: 'gate20c' },
      { brokenMark: true, pendingStory: 'layer31', hold: true, e01: true },
      { brokenMark: true, e01: true, staleStory: 'restock' },
      /* 只播过其中一段（另一半被顶掉过的旧局面） */
      { seenLayer100: true }, { seenX00a: true },
      { seenLayer100: true, x00stage: 3 }, { seenX00a: true, x00stage: 4 },
      /* ★ 用户实测的现场：**上一局/上一次已经看过那两段**（存档 seen 里有），
       *   这次再爬到 100 层（含从 101 层挪回来）—— 按新口径仍然要在第 1 场之前重讲一遍。 */
      { seenLayer100: true, seenX00a: true },
      { seenLayer100: true, seenX00a: true, e01: true, brokenMark: true },
      /* 段号残留 + 两段都没播 */
      { x00stage: 4, brokenMark: true },
      /* 上一场是巡逻且输了（收缴流程刚走完就进 100 层） */
      { loseLast: true }, { loseLast: true, pendingPatrolFailStory: true },
      /* 上一场是巡逻且输了、而且巡逻剧情刚好在同层（patrolStoryAt 记账） */
      { gateSeen: true, loseLast: true },
    ]) variants.push(v);

    let pass = 0, fail = 0;
    for (let i = 0; i < ROUNDS; i++) {
      for (let k = 0; k < variants.length; k++) {
        const V = Object.assign({}, variants[k]);
        const name = V.name || JSON.stringify(V).slice(0, 60);
        delete V.name;
        const r = await round(1000 + i * 37 + k, V);
        if (r.ok) pass++;
        else {
          fail++;
          console.log('❌ 第 ' + i + ' 轮 · 变体 ' + name + '：' + r.why);
          console.log('   播过：' + (r.begun || []).join(' → '));
          if (fail >= 8) { console.log('（失败已到 8 条，先停）'); i = ROUNDS; break; }
        }
      }
    }
    console.log('\n结果：通过 ' + pass + ' · 失败 ' + fail);
    process.exitCode = fail ? 1 : 0;
  })();
}

/* ============================================================
 * runBuffStacking() —— 原 tools/verify-buff-stacking.cjs 的正文（**原样搬入**，只去掉了重复的头部样板）
 * ============================================================ */
async function runBuffStacking() {
  const VERBOSE = process.argv.includes('--verbose');

  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
  const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const f of LOAD) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  c.Main = { startBattle: () => Promise.resolve(), showHome: () => {} };
  const T = c.Tower, TD = c.TowerData;

  /** 每条增益都从**干净的一局**开始（只保留账号 / 关卡解锁）。 */
  function freshRun() {
    c.State.newGame('叠加审计');
    const S = c.State.state();
    S.level = 70; S.props[23] = 99999; S.weapons = ['1:5']; S.skills = ['1:5'];
    for (let i = 1; i <= 36; i++) S.stages[i] = { npcIndex: 3, passed: true };
    vm.runInContext('(function(){var s=4242;Math.random=function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};})()', c);
    T.startEndlessRun();
    T.setStoryEnabled(false);
    const run = T._debugRun('endless');
    run.noEnvRoll = true; run.env = []; run.debuffs = [];
    return run;
  }
  /** 用一场「探针战斗」把聚合结果读出来（me.mods + 三围 / 血上限）。 */
  function snapshot(run) {
    run.idx = 0; run.choices = null; run.phase = null; delete run.attempt; run.env = [];
    const nx = T.nextBattle('endless');
    if (!nx.ok) throw new Error('取下一场失败：' + nx.msg);
    const me = { power: 1000, agility: 1000, speed: 1000, hp: 5000, maxHp: 5000,
      baseStats: { power: 200, agility: 120, speed: 120 }, weapons: [], skills: [], effects: {}, masterLevel: 0 };
    nx.adjustMe(me);
    delete run.attempt;
    const out = { 'me.power': me.power, 'me.agility': me.agility, 'me.speed': me.speed,
      'me.maxHp': me.maxHp, 'me.healMul': me.healMul == null ? 1 : me.healMul };
    for (const [k, v] of Object.entries(me.mods || {})) {
      if (typeof v === 'number') out['mods.' + k] = v;
      else if (Array.isArray(v)) out['mods.' + k] = v.length;
    }
    return out;
  }
  const near = (a, b, tol) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.02);
  /** 本来就**不该**随层数放大的：阈值 / 开关 / 规则封顶。 */
  const NONSCALING = new Set(['mods.lowHpAt', 'mods.lowHpRegenAt', 'mods.mustHitAll', 'mods.mustHitFirst',
    'mods.firstHitZero', 'mods.firstHitZeroFreeTurn', 'mods.firstDodge', 'mods.openKill', 'mods.cosmosFirst',
    'mods.reflectImmune', 'mods.enemyHpDrainPct', 'mods.thornsPct', 'mods.firstSkillFree', 'mods.dmgMul']);

  /* 审计对象：上限 > 1 的（能叠层），以及「同名再获得 = 场次累加」的限次类。 */
  const cands = TD.BUFFS.filter((b) => {
    if (b.kind === 'instant' || b.kind === 'inscription') return false;
    if (TD.stackCap(b) > 1) return true;
    return b.kind === 'limited' && TD.hasTag(b, 'repeatable') && !TD.hasTag(b, 'unique') && (b.uses || 0) < 100;
  });

  let problems = 0, checked = 0;
  const out = [];
  out.push('同名叠加审计：' + cands.length + ' 条（每条单独起一局）\n');
  for (const b of cands) {
    const capReal = TD.stackCap(b);
    /* 「有上限」= 显式声明过（`stackable` 或 `maxStacks`）；没写的永久件每份占一个新栏位。 */
    const capped = TD.hasTag(b, 'stackable') || Math.max(0, Math.floor(Number(b.maxStacks) || 0)) >= 2;
    /* 这一类才是「有了就再也拿不到第二份」：unique（纯开关）/ 一局一次。
     * ⚠ `noRestack` 不算：它只是「**拿满 maxStacks 之后**移出可获得池」，
     * 上限之内照样叠（例：C14 涅槃 2 层、C50 抉择扩充 2 层）。 */
    const oneOnly = TD.hasTag(b, 'unique') || TD.hasTag(b, 'oncePerRun');
    const restackStop = TD.hasTag(b, 'noRestack') ? Math.max(1, Math.floor(Number(b.maxStacks) || 1)) : 0;
    /* 拿的次数：**上限 + 2**（有限上限时）—— 顺带验证「叠满之后新栏位还能继续叠」。 */
    const tries = capReal === Infinity ? 4 : Math.min(8, capReal + 2);
    const rowsOf = (run) => (run.permanent || []).concat(run.limited || []).filter((r) => r && r.id === b.id);
    const run = freshRun();
    const base = snapshot(run);
    /* —— ① 获得路径 —— */
    const g1 = T.debugGrantBuff(b.id);
    const one = snapshot(run);
    const oneRow = rowsOf(run)[0] || {};
    const grants = [];
    for (let i = 1; i < tries; i++) grants.push(T.debugGrantBuff(b.id));
    const accepted = (g1 && g1.ok !== false ? 1 : 0) + grants.filter((g) => g && g.ok !== false).length;
    const cap = snapshot(run);
    const rs = rowsOf(run);
    const stacks = Math.max(0, ...rs.map((r) => Number(r.stacks) || 0));
    const uses = rs.reduce((n, r) => n + (Number(r.uses) || 0), 0);
    const total = rs.reduce((n, r) => n + Math.max(1, Number(r.stacks) || 1), 0);
    /* 效果该按**总层数**放大（多栏一起算）；限次类走场次口径。 */
    const ratio = total > 1 ? total : (uses > Math.max(1, Number(oneRow.uses) || 0) ? Math.min(4, accepted) : 1);
    const rejected = grants.filter((g) => g && g.ok === false).map((g) => g.msg);
    const acquire = [];
    const expectAccepted = oneOnly ? 1 : (restackStop ? Math.min(tries, restackStop) : tries);
    if (!rs.length) acquire.push('一份都没拿到（' + JSON.stringify(rejected) + '）');
    if (oneOnly && accepted > 1) acquire.push('这一类本该「有了就不再出现」，却收下了 ' + accepted + ' 份');
    if (accepted !== expectAccepted) {
      acquire.push('拿 ' + tries + ' 次应当收下 ' + expectAccepted + ' 份，实际 ' + accepted +
        '（' + JSON.stringify(rejected.slice(0, 2)) + '）');
    }
    if (capped && capReal !== Infinity && stacks > capReal) acquire.push('有一栏叠到 ' + stacks + ' 层，超过每栏上限 ' + capReal);
    if (rs.length && total !== accepted && uses <= Math.max(1, Number(oneRow.uses) || 0)) {
      acquire.push('收下 ' + accepted + ' 份，但总层数只有 ' + total + '（丢层了）');
    }
    /* —— ② 效果路径 ——
     * ⚠ 必须遍历 base / one / cap 的**并集**：像 `mods.roundStatPct` 这种字段在没拿到增益时
     * 根本不存在（不是 0），只看 base 的键会把「这条增益到底有没有随层数放大」整个漏掉
     *（这正是「叠了没用」最容易藏的地方）。缺的键按字段语义取中性值。 */
    const badFields = [];
    const grew = [];
    const zeroOf = (key) => (key === 'me.healMul' ? 1 : 0);
    const keys = new Set([...Object.keys(base), ...Object.keys(one), ...Object.keys(cap)]);
    for (const key of keys) {
      const b0 = key in base ? base[key] : zeroOf(key);
      const v1 = key in one ? one[key] : zeroOf(key);
      const vN = key in cap ? cap[key] : zeroOf(key);
      if (typeof v1 !== 'number' || typeof vN !== 'number' || typeof b0 !== 'number') continue;
      if (NONSCALING.has(key)) continue;
      const d1 = v1 - b0, dN = vN - b0;
      if (Math.abs(d1) < 1e-9) continue;                       // 这条增益本来就不碰这个字段
      grew.push(key.replace(/^me\.|^mods\./, '') + ' ' + d1.toFixed(4) + '→' + dN.toFixed(4));
      const addOk = near(dN, d1 * ratio, 1e-6);
      const relOk = b0 > 0 && near(vN / b0, 1 + ratio * (v1 / b0 - 1), 1e-6);
      if (!addOk && !relOk) badFields.push(key + '（1 份 ' + d1.toFixed(4) + ' → ' + tries + ' 份 ' + dN.toFixed(4) + '）');
    }
    checked++;
    const bad = acquire.length || badFields.length;
    if (bad) problems++;
    out.push((bad ? '⚠ ' : '✓ ') + b.id + ' ' + b.name + '（' + b.kind + '，每栏上限 ' + (capReal === Infinity ? '∞' : capReal) + '）' +
      ' 拿 ' + tries + ' 次 → 收下 ' + accepted + ' 份 · 栏位 ' + rs.length + ' 条 ' + JSON.stringify(rs.map((r) => r.stacks)) +
      ' · 合计 ' + total + ' 层' + (uses ? ' · uses ' + uses : '') +
      (acquire.length ? '\n     ❗获得路径：' + acquire.join('；') : '') +
      (badFields.length ? '\n     ❗效果没按总层数放大：' + badFields.join('；') : ''));
    if (grew.length) out.push('     效果随层数：' + grew.slice(0, 6).join(' · '));
    if (VERBOSE) out.push('     base=' + JSON.stringify(base) + '\n     one =' + JSON.stringify(one) + '\n     cap =' + JSON.stringify(cap));
  }
  console.log(out.join('\n'));
  console.log('\n审计 ' + checked + ' 条 · 有问题 ' + problems + ' 条');
  process.exitCode = problems ? 1 : 0;
}

/* ============================================================
 * 命令行：node tools/verify.cjs <story|layer100|stacking|all> [参数…]
 * ============================================================ */
(async () => {
  const mode = (process.argv[2] || 'all').toLowerCase();
  const rest = process.argv.slice(3);
  /* 三个正文按原样读 process.argv[2]/[3]：调用前把 argv 摆成它们期待的样子。 */
  const withArgv = async (fn, args) => {
    const saved = process.argv;
    process.argv = ['node', 'verify.cjs', ...args];
    try { return await fn(); } finally { process.argv = saved; }
  };
  if (mode === 'story') return withArgv(runStoryFlow, rest);
  if (mode === 'layer100') return withArgv(runStoryLayer100, rest);
  if (mode === 'stacking') return withArgv(runBuffStacking, rest);
  if (mode === 'all') {
    await withArgv(runStoryFlow, []);
    await withArgv(runStoryLayer100, ['1']);
    await withArgv(runBuffStacking, []);
    return;
  }
  console.error('用法：node tools/verify.cjs <story|layer100|stacking|all> [参数…]');
  process.exitCode = 2;
})();
