#!/usr/bin/env node
/* ============================================================
 * tools/test-ui-flow.cjs — 界面跳转回归（战斗结算后该留在哪一页）
 *
 * 起因（实际发生过的 bug）：随机挑战战胜后点「确定」，人被弹回了**主界面**，
 * 而不是留在随机挑战页。根因是 resultModal 的「确定」默认动作是 home()，
 * 随机挑战那条路径没传 onOk —— 弹窗关闭后就把挑战页丢掉了。
 *
 * 做法：把 js/classic-ui.js 里真实的挑战页与 resultModal 代码切出来，
 * 在 Node vm 里配一套最小 DOM 桩跑，断言「点确定之后渲染的是哪一页」。
 *
 * 用法：node tools/test-ui-flow.cjs
 * ============================================================ */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

/** 取 classic-ui.js 里从 startMarker 到 endMarker 的一段（含 endMarker 行） */
function slice(lines, startMarker, endMarker) {
  const a = lines.findIndex((l) => l.includes(startMarker));
  assert.ok(a >= 0, '找不到起始标记：' + startMarker);
  const b = lines.findIndex((l, i) => i > a && l.includes(endMarker));
  assert.ok(b > a, '找不到结束标记：' + endMarker);
  return lines.slice(a, b + 1).join('\n');
}

/** 搭一个最小可跑环境：真 js/state.js + 挑战页/resultModal 的真实代码。 */
function harness() {
  const pages = [], modals = [], battles = [], storage = new Map();
  const c = {
    console, Set, Map, Date, Math, JSON, Number, String, Object, Array, Boolean, Promise, Error,
    setTimeout, clearTimeout, setInterval, clearInterval, isFinite, parseInt, parseFloat,
    location: { search: '?qa=1' },                     // testMode：存档只落 localStorage
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    Screen: {}, State: null, Main: null, GData: null, UI: null,
    propMap: null, weaponsMap: null, skillsMap: null,
  };
  c.window = c; c.self = c;
  c.window.addEventListener = () => {};
  vm.createContext(c);

  /* 真数据 + 真状态机（和浏览器同一个加载顺序的前半段） */
  for (const f of ['js/gamedict.js', 'js/gamedata.js', 'js/state.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  }

  /* 界面桩：只记录「渲染了哪一页、弹了哪些窗」 */
  c.esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  c.btn = (label, action, cls) => '<button class="' + (cls || '') + '" data-action="' + action + '">' + label + '</button>';
  c.spr = () => '<i></i>';
  c.icon = () => '<i></i>';
  c.frameUrl = () => 'x.png';
  c.upsHtml = () => '';
  c.statsHtml = () => '<div class="stats"></div>';
  c.portrait = () => {};
  c.toast = () => {};
  c.$$ = (selector, node) => (node && node.querySelectorAll ? node.querySelectorAll(selector) : []);
  c.$ = (selector, node) => (node && node.querySelector ? node.querySelector(selector) : null);
  c.page = (group, active, html) => {
    const nodes = new Map();
    for (const m of html.matchAll(/data-(action|foe)="([^"]+)"/g)) {
      const key = '[data-' + m[1] + '="' + m[2] + '"]';    // 键要和 $('[data-action="x"]') 的写法一致
      if (!nodes.has(key)) nodes.set(key, { dataset: { action: m[2], foe: m[2] }, textContent: '', onclick: null, addEventListener(_, fn) { this.onclick = fn; } });
    }
    const p = {
      group, active, html, nodes,
      querySelector: (sel) => nodes.get(sel) || null,
      querySelectorAll: (sel) => {
        const eq = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel.trim());
        if (!eq) return [];
        const [, name, value] = eq;
        return [...nodes.entries()]
          .filter(([k]) => {
            const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(k);
            return m && m[1] === name && (value === undefined || m[2] === value);
          })
          .map(([, v]) => v);
      },
    };
    pages.push(p);
    return p;
  };
  c.modal = (title, html, buttons) => {
    const m = { title, html, buttons: buttons || [] };
    modals.push(m);
    return m;
  };
  c.notice = (msg, buttons) => c.modal('提示', c.esc(msg), buttons || [{ label: '确定' }]);
  c.home = () => { pages.push({ group: 'home', active: 'home', html: '<section class="classic-home"></section>' }); };
  c.openBag = () => { pages.push({ group: 'bag', active: 'bag', html: '' }); };
  c.openMessages = () => { pages.push({ group: 'message', active: 'messages', html: '' }); };

  /* Main.startBattle 桩：立刻把结果交给 onEnd（不真打一场） */
  c.Main = {
    showHome: () => c.home(),
    startBattle: (foe, opts) => {
      battles.push({ foe, opts });
      if (opts && typeof opts.onEnd === 'function') opts.onEnd((opts._winner == null ? 0 : opts._winner));
      return Promise.resolve({});
    },
    homePlayer: () => null,
  };
  c.UI = { toast: () => {}, classic: {}, runAction: () => {} };

  /* 把真实代码切进来：挑战页 + resultModal（含状态声明，保证就是那一份实现） */
  const lines = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').split('\n');
  const declIdx = lines.findIndex((l) => l.includes('let opponents = [], selectedOpponent'));
  assert.ok(declIdx >= 0, '找不到 opponents 声明');
  const decl = lines[declIdx];
  const challenge = slice(lines, 'function genOpponents()', "  function resultModal(win,rw,extra,onOk) {")
    .replace(/\n\s*function resultModal\(win,rw,extra,onOk\) \{$/, '');
  const resultModal = slice(lines, 'function resultModal(win,rw,extra,onOk)', "  const NPC_FILE=")
    .replace(/\n\s*const NPC_FILE=$/, '');
  c.__code = decl + '\n' + challenge + '\n' + resultModal + '\n' + 'window.__ui = { openChallenge, resultModal, genOpponents, getOpponents: () => opponents, setWinner: null };';
  vm.runInContext(c.__code, c, { filename: 'classic-ui.js (challenge + resultModal)' });

  c.State.newGame('挑战测试');
  Object.assign(c.State.state(), { level: 26, energy: 30, props: { 1: 5 }, challengeRefresh: null });
  c.State.save();
  return { c, pages, modals, battles };
}

/** 打开挑战页 → 选一个对手 → 点「挑战他」→ 让 Main 桩立刻结束战斗 */
function fightOnce(h, out) {
  const { c } = h;
  vm.runInContext('window.__ui.openChallenge(true);', c);
  const page = h.pages[h.pages.length - 1];
  assert.equal(page.active, 'challenge', '应该先渲染随机挑战页');
  const foeBtn = page.querySelector('[data-foe="0"]');
  assert.ok(foeBtn, '挑战页要有可选对手');
  foeBtn.onclick();
  const page2 = h.pages[h.pages.length - 1];
  const fight = page2.querySelector('[data-action="fight"]');
  assert.ok(fight, '选中对手后要出现「挑战他」按钮');
  c.Main.startBattle = (foe, opts) => {
    h.battles.push({ foe, opts });
    if (opts && opts._winner != null) opts._winner = out;
    if (opts && typeof opts.onEnd === 'function') opts.onEnd(out);
    return Promise.resolve({});
  };
  fight.onclick();
}

const results = [];
function record(name, fn) { results.push([name, fn]); }

record('随机挑战战胜 → 点「确定」回到随机挑战页（不是主界面），并换一批新对手', () => {
  const h = harness();
  fightOnce(h, 0);
  const result = h.modals[h.modals.length - 1];
  assert.equal(result.title, '战斗结果', '战斗结束要弹「战斗结果」');
  const okBtn = result.buttons.find((b) => b.label === '确定');
  assert.ok(okBtn, '结果弹窗要有「确定」按钮');
  const pagesBefore = h.pages.length;

  okBtn.run();

  assert.ok(h.pages.length > pagesBefore, '点确定后必须重新渲染页面');
  const last = h.pages[h.pages.length - 1];
  assert.equal(last.active, 'challenge', '点确定后应该回到随机挑战页，而不是主界面（active=' + last.active + '）');
  assert.equal(last.group, 'challenge');
  assert.ok(/challenge-list/.test(last.html), '挑战页要重新渲染出对手列表');
  // 换一批新对手：三个可选对手都在
  for (const i of [0, 1, 2]) assert.ok(last.querySelector('[data-foe="' + i + '"]'), '要有第 ' + (i + 1) + ' 个对手');
  const foes = vm.runInContext('window.__ui.getOpponents().map(f => f.level).join(",")', h.c);
  assert.equal(foes.split(',').length, 3, '应该重新抽了 3 个对手，实际：' + foes);
});

record('随机挑战战败 → 点「确定」同样留在随机挑战页', () => {
  const h = harness();
  fightOnce(h, 1);
  const result = h.modals[h.modals.length - 1];
  assert.equal(result.title, '战斗结果');
  const okBtn = result.buttons.find((b) => b.label === '确定');
  okBtn.run();
  const last = h.pages[h.pages.length - 1];
  assert.equal(last.active, 'challenge', '战败点确定也要回到挑战页（active=' + last.active + '）');
});

record('回归：没有任何模式会「点确定后被弹回主界面」', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8');
  const start = ui.indexOf('function resultModal');
  const end = ui.indexOf('\n  }', start);
  const body = ui.slice(start, end);
  // 默认回主界面是这次 bug 的来源：每个调用点都必须自己说清楚回到哪
  assert.ok(/onOk/.test(body), 'resultModal 要保留 onOk 参数（调用方可指定返回页）');
  const call = ui.slice(ui.indexOf('function openChallenge'), ui.indexOf('function resultModal'));
  assert.match(call, /resultModal\(win,\s*rw,\s*'',\s*\(\)\s*=>\s*openChallenge\(true\)\)/,
    '随机挑战必须显式把「确定」指回挑战页：resultModal(win, rw, \'\', () => openChallenge(true))');
});

record('弹窗按钮样式统一：贴图按钮只留在页面页脚，弹窗里一律手搓', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8');

  /* ① 取真实的按钮工厂（不复制实现，避免测试和代码走偏） */
  const start = ui.indexOf('const btn = (label, action, cls, art)');
  assert.ok(start > 0, '找不到 btn 工厂（签名可能被改过）');
  const end = ui.indexOf('\n', start);
  const src = ui.slice(start, end);
  const ctx = vm.createContext({
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    buttonArt: { '返回菜单': 'return-menu', '更换装备': 'change-equipment' },
  });
  const btn = vm.runInContext(src + '\nbtn;', ctx, { filename: 'btn.js' });

  /* ② 手搓按钮：没有 <img class="classic-button-art">，直接显示文字 */
  const plain = btn('返回菜单', 'home', 'gold');
  assert.ok(!/classic-button-art/.test(plain), '默认（弹窗里）不该再出现贴图按钮：' + plain);
  assert.match(plain, />返回菜单<\/button>$/, '默认按钮要把文字直接显示出来：' + plain);
  assert.match(plain, /class="uc-button gold"/, '样式类要保留');

  /* ③ 贴图按钮：只有显式传 art=true 才会用切图 */
  const art = btn('返回菜单', 'home', 'gold', true);
  assert.match(art, /class="classic-button-art"[^>]*src="images\/classic\/new-reference\/buttons\/return-menu\.png"/, '页脚的贴图按钮要保留：' + art);
  assert.match(art, /reference-button-label/, '贴图按钮要有隐藏的无障碍文字');

  /* ④ 关卡通关弹窗（"继续闯关" + "返回菜单"）两个按钮必须同一种形式 */
  const stage = ui.slice(ui.indexOf("message='恭喜通关"), ui.indexOf("}else if(rw.win)"));
  const labels = [...stage.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['继续闯关', '返回菜单'], '通关弹窗的两个按钮：' + labels.join(' / '));
  assert.ok(!/art|classic-button-art/.test(stage), '通关弹窗里不该出现贴图按钮（它走的是真实的 btn 工厂）');

  /* ⑤ 全部 btn('返回菜单'…) 调用点：只有页面页脚那一处允许传 art=true */
  const calls = [...ui.matchAll(/btn\('返回菜单'[^)]*\)/g)].map((m) => m[0]);
  // 每一处 btn('返回菜单', …) 都必须显式写清楚用不用贴图（不写 = 手搓）
  for (const call of calls) assert.match(call, /,\s*(true|false)\)$/, '调用点要显式写 art 参数：' + call);
  const withArt = calls.filter((c) => /,\s*true\)$/.test(c));
  assert.equal(withArt.length, 1, '只允许页面页脚那一处使用贴图：' + calls.join(' | '));
  assert.match(ui.slice(0, ui.indexOf(withArt[0])), /page-footer[\s\S]*$/, '保留贴图的那一处应该是页面页脚');

  /* ⑥ 状态页那颗换成贴图的按钮也要显式传开关（否则会突然变成手搓，尺寸样式对不上） */
  assert.match(ui, /btn\('更换装备','gears','gold',true\)/, '状态页的「更换装备」要保持贴图样式');
});

record('塔身楼层：13 层够高、塔身高度固定 470px（两塔一致）、无尽塔不误标已通关', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const start = ui.indexOf('function towerVisual(layer, maxLayer, mode)');
  assert.ok(start > 0, 'tower-ui.js 里应该还有 towerVisual');
  const end = ui.indexOf('\n  }', start);
  const src = ui.slice(start, end + 4);
  const ctx = vm.createContext({ Math, String, Number });
  const towerVisual = vm.runInContext(src + '\ntowerVisual;', ctx, { filename: 'towerVisual.js' });

  const floorsOf = (html) => [...html.matchAll(/class="tower-floor ([^"]*)">/g)].map((m) => m[1]);
  const numbersOf = (html) => [...html.matchAll(/tower-floor-no">(\d+)</g)].map((m) => Number(m[1]));

  /* ① 层数要够多：以前固定 9 层（上下各 4），一屏只露 6 层 —— 太少了 */
  for (const [layer, mode] of [[1, 'endless'], [12, 'endless'], [40, 'tower'], [33, 'tower']]) {
    const html = towerVisual(layer, mode === 'tower' ? 30 : 0, mode);
    const nums = numbersOf(html);
    // 上 8 + 当前层 + 下 4 = 13；低位层受「楼号从 1 起」限制会少几层
    const expect = Math.min(12, layer - 1) + 1;
    assert.ok(nums.length >= expect, '第 ' + layer + ' 层（' + mode + '）只画了 ' + nums.length + ' 层，至少要 ' + expect);
    assert.ok(nums.length <= 13, '层数不该超过 13（层高要够高、不能挤成一团）：' + nums.length);
    // 中层/深层要给满：上 8 + 当前层 + 下 4
    if (layer > 20) assert.equal(nums.length, 13, '第 ' + layer + ' 层应该给满 13 层');
    assert.ok(nums.includes(layer), '必须包含当前层 ' + layer);
    assert.equal(nums[0] - nums[nums.length - 1], nums.length - 1, '层号要连续：' + nums.join(','));
    // 当前层下面不能出现 0 层或负数
    assert.ok(Math.min(...nums) >= 1, '不该出现第 0 层：' + nums.join(','));
    // 当前层下面要留出几层（第 1 层例外：它下面本来就没有了）
    if (layer > 1) assert.ok(nums.indexOf(layer) < nums.length - 1, '当前层下面要留出已爬过的楼层');
    // 当前层上方固定 8 层（楼层列表是自上而下，所以当前层的下标就是上面的层数）
    assert.equal(nums.indexOf(layer), 8, '当前层上方应该正好 8 层');
  }

  /* ② 挑战塔：历史最高层以下算「已通关」，之上是「待爬」 */
  const t = towerVisual(20, 25, 'tower');
  const tFloors = floorsOf(t);
  const tNums = numbersOf(t);
  tNums.forEach((n, i) => {
    const cls = tFloors[i];
    if (n === 20) assert.match(cls, /now|now /, '第 20 层是正在打的层，必须是 now：' + cls);
    else if (n < 20 || n <= 25) assert.match(cls, /done/, '第 ' + n + ' 层该是已通关：' + cls);
    else assert.match(cls, /todo/, '第 ' + n + ' 层该是待爬：' + cls);
  });
  assert.match(t, /tower-floor now/, '当前层要有 now 样式');
  assert.match(t, /tower-marker/, '当前层要有指示箭头');

  /* ③ 无尽塔没有上限：所有未爬的层都不能标成 done（以前 maxLayer=0 导致全列 done） */
  const e = towerVisual(9, 0, 'endless');
  const eFloors = floorsOf(e);
  const eNums = numbersOf(e);
  eNums.forEach((n, i) => {
    if (n === 9) { assert.match(eFloors[i], /now/, '第 9 层是当前层'); return; }
    assert.match(eFloors[i], /todo/, '无尽塔第 ' + n + ' 层不该标成已通关：' + eFloors[i]);
    assert.ok(!/done/.test(eFloors[i]), '无尽塔第 ' + n + ' 层出现了 done：' + eFloors[i]);
  });

  /* ④ 里程碑仍然标出来：5 的倍数金色、10 的倍数精英红 */
  assert.match(e, /tower-floor (todo|now|done) fifth-floor/, '第 5 的倍数层要有金色标记');
  assert.match(towerVisual(10, 0, 'tower'), /elite-floor/, '第 10 的倍数层要有精英标记');

  /* ⑤ CSS 必须是自适应行高（否则层数一多就被裁掉） */
  const css = fs.readFileSync(path.join(ROOT, 'css', 'tower.css'), 'utf8');
  assert.match(css, /\.tower-floor \{[^}]*flex: 1 1 29px/, '楼层要能按容器高度伸缩（目标层高 29px）');
  assert.match(css, /\.tower-floor \{[^}]*min-height: 20px/, '楼层要有最小可读高度（比上一版的 18px 更高）');
  assert.match(css, /\.tower-floors \{[^}]*gap: 3px/, '楼层间距收紧到 3px');
  assert.match(css, /\.tower-floors \{[^}]*justify-content: flex-end/, '塔身内容要贴在底部（上游留白）');
  assert.match(css, /mask-image: linear-gradient\(180deg, transparent 0/, '上下边缘要有淡出');
  /* 塔身必须有**确定高度**：只靠 flex 拉伸的话，挑战塔与无尽塔的主列内容高度不同，
   * 量出来的塔身高度就不一致（无尽塔明显偏矮）。 */
  const visualRule = [...css.matchAll(/\.tower-visual \{[^}]*\}/g)].map((m) => m[0]).pop();
  assert.match(visualRule, /height:\s*470px/, '塔身要钉一个确定高度（两个塔页才会一样高）：' + visualRule);
  assert.match(visualRule, /min-height:\s*0/, '确定高度要配 min-height:0，避免被内容顶开');
  // 两个塔页用的是同一个 .tower-visual，所以不存在“一个高一个矮”的分支
  const ui2 = fs.readFileSync(path.join(ROOT, 'js', 'tower-ui.js'), 'utf8');
  const calls = [...ui2.matchAll(/towerVisual\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 2, '两个塔页都该调用 towerVisual：' + calls.join(' | '));
  assert.equal((ui2.match(/<div class="tower-visual"/g) || []).length, 1,
    '塔身 HTML 只该由 towerVisual() 一处产出（两处各写一套就会出现一高一矮）');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of results) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ' | ' + (e && e.message)); if (process.env.SSDZ_VERBOSE) console.log(e && e.stack); }
  }
  console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${results.length} 项）`);
  process.exit(failed ? 1 : 0);
})();
