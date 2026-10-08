/*
 * Run: node tools/test-extras.cjs
 * Isolated action tests use the shipped dictionaries, State and Sim. The small
 * DOM adapter supplies event targets; visual layout remains a browser QA check.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
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

const rootDir = findRoot(__dirname);

function setup() {
  const memory = new Map(), timers = [], pages = [], modals = [], battles = [], markup = [];
  let now = new Date(2026, 8, 23, 15).getTime(), randomSeed = 615;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  function elementRoot(html) {
    const nodes = new Map();
    for (const match of html.matchAll(/data-(action|goods|prize|master|recruit|prentice|weapon|skill)="([^"]+)"/g)) {
      nodes.set('[data-' + match[1] + '="' + match[2] + '"]', {
        dataset: { [match[1]]: match[2] }, classList: { toggle() {} }, textContent: '', disabled: false,
      });
    }
    for (const key of ['status', 'gold']) {
      if (html.includes('data-lottery-' + key)) nodes.set('[data-lottery-' + key + ']', { textContent: '' });
    }
    return {
      html, isConnected: true,
      querySelector: selector => nodes.get(selector) || null,
      querySelectorAll: selector => [...nodes].filter(([key]) => key.startsWith(selector.slice(0, -1) + '=')).map(([, value]) => value),
    };
  }
  function leave() {
    pages.forEach(page => { page.isConnected = false; });
    modals.forEach(modal => { modal.element.isConnected = false; });
  }
  const c = {
    Date: ClockDate, location: { search: '?qa=1' }, console,
    localStorage: { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) },
    setTimeout: callback => timers.push(callback),
  };
  c.window = c;
  vm.createContext(c);
  for (const file of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/state.js', 'js/sim.js']) {
    vm.runInContext(fs.readFileSync(path.join(rootDir, file), 'utf8'), c, { filename: file });
  }
  const math = vm.runInContext('Math', c);
  math.random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 4294967296; };
  c.State.newGame('测试松鼠');
  const classic = {
    page: (group, active, html) => {
      leave(); markup.push([group + '/' + active, html]);
      const page = elementRoot(html + '<button data-action="home">返回</button>'); pages.push(page); return page;
    },
    modal: (title, html, buttons) => {
      markup.push(['modal/' + title, html]);
      const modal = { title, html, buttons, element: elementRoot(html), close() { this.element.isConnected = false; } };
      modals.push(modal); return modal;
    },
    btn: (label, action) => '<button data-action="' + action + '">' + label + '</button>',
    icon: (kind, id) => '<img src="images/classic/icons/' + kind + '-' + id + '.png">',
    // 升级奖励面板：这里只做最小渲染，供断言检查文本内容
    upsHtml: (ups) => (ups && ups.length)
      ? '<div class="reward-stack">' + ups.map((u) => '<div class="reward-panel">升到 ' + u.level + ' 级' +
          (u.reward ? '<span class="reward-text">' + u.reward + '</span>' : '') + '</div>').join('') + '</div>'
      : '',
    toast() {}, home: leave, bind() {},
  };
  c.UI = { classic, runAction: leave };
  c.Main = {
    startBattle: async (foe, opts) => {
      if (opts.cost && !c.State.consumeEnergy(opts.cost)) return;
      leave(); battles.push({ foe, opts }); return {};
    },
  };
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'js/classic-extras.js'), 'utf8'), c, { filename: 'js/classic-extras.js' });
  return {
    c, memory, timers, pages, modals, battles, markup, math, leave,
    advance: ms => { now += ms; },
    page: () => pages.at(-1),
    node: action => pages.at(-1).querySelector('[data-action="' + action + '"]'),
    click(action) {
      const target = this.node(action);
      assert.ok(target && target.onclick, 'Button exists: ' + action);
      assert.equal(target.disabled, false, 'Button is enabled: ' + action);
      target.onclick();
    },
    modalClick(index = 0) {
      const modal = modals.at(-1), button = modal.buttons[index];
      assert.ok(button && button.run, 'Modal action exists: ' + modal.title + '/' + index);
      if (button.close !== false) modal.close();
      button.run();
    },
    settle(index, winner) { battles[index].opts.onEnd(winner); },
    flushTimers() {
      let count = 0;
      while (timers.length) { assert.ok(++count < 1000, 'Animation ends'); timers.shift()(); }
    },
    saved: () => JSON.parse(memory.get(c.State.saveKey)),
  };
}

const tests = [];
function test(name, run) { tests.push([name, run]); }
function enterArena(g, kind) {
  g.c.State.state().level = Math.max(g.c.State.state().level, kind === 1 ? 20 : 11);
  g.c.ClassicExtras.arena(); g.click(kind === 1 ? 'arena-fragment' : 'arena-exp'); g.modalClick();
}
function assertBalanced(markup) {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const [name, html] of markup) {
    const stack = [];
    for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
      const tag = match[2].toLowerCase();
      if (voidTags.has(tag) || match[0].endsWith('/>')) continue;
      if (match[1]) assert.equal(stack.pop(), tag, name + ': mismatched ' + match[0]);
      else stack.push(tag);
    }
    assert.equal(stack.length, 0, name + ': unclosed ' + stack.join(', '));
  }
}

test('竞技11/20级门槛在报名确认时再次校验，不扣低等级资源', () => {
  const g = setup(), s = g.c.State.state();
  g.c.ClassicExtras.arena(); g.click('arena-exp');
  assert.match(g.modals.at(-1).html, /11级/); assert.equal(g.battles.length, 0);
  s.level = 19; g.c.ClassicExtras.arena(); g.click('arena-fragment');
  assert.match(g.modals.at(-1).html, /20级/); assert.equal(s.energy, 90);
  s.level = 11; g.c.ClassicExtras.arena(); g.click('arena-exp');
  s.level = 1; g.modalClick(); assert.equal(g.battles.length, 0); assert.equal(s.energy, 90);
});

test('竞技报名扣费：碎片场=勇气徽章、经验场=英雄帖，且进场必付费', () => {
  const c = setup();
  const S = c.c.State;
  const s = S.state();
  s.level = 25;
  const pay = (energy, ticket36, badge39, kind) => {
    s.energy = energy; s.props[1] = 0; s.props[2] = 0; s.props[36] = ticket36; s.props[39] = badge39;
    const before = { e: s.energy, t: s.props[36], b: s.props[39] };
    const r = c.c.ClassicExtras.payArenaEntry(s, kind);
    return { r, before, after: { e: s.energy, t: s.props[36], b: s.props[39] } };
  };
  // 优先级：**体力 > 准入道具 > 喝药**。体力充足时扣体力，道具不动。
  let x = pay(90, 3, 3, 0);
  assert.ok(x.r.ok && x.r.by === 'energy', '经验场体力充足应当扣体力');
  assert.equal(x.after.e, 60, '经验场体力 90→60，实测 ' + x.after.e);
  assert.equal(x.after.t, 3, '体力够时不该动英雄帖');
  x = pay(90, 3, 3, 1);
  assert.ok(x.r.ok && x.r.by === 'energy', '碎片场体力充足应当扣体力');
  assert.equal(x.after.e, 60, '碎片场体力 90→60，实测 ' + x.after.e);
  assert.equal(x.after.b, 3, '体力够时不该动勇气徽章');
  // 体力刚好 30 也走体力
  x = pay(30, 1, 1, 1);
  assert.ok(x.r.ok && x.r.by === 'energy', '体力刚好 30 应当扣体力');
  assert.equal(x.after.e, 0, '体力 30→0，实测 ' + x.after.e);
  assert.equal(x.after.b, 1, '体力够时不该动徽章');
  // 体力不足 → 经验场扣英雄帖(36)
  x = pay(10, 1, 0, 0);
  assert.ok(x.r.ok && x.r.by === 'item' && x.r.itemId === 36, '经验场体力不足时扣英雄帖');
  assert.equal(x.after.t, 0, '英雄帖 1→0');
  assert.equal(x.after.e, 10, '体力不该动');
  // 体力不足 → 碎片场扣勇气徽章(39)
  x = pay(10, 0, 1, 1);
  assert.ok(x.r.ok && x.r.by === 'item' && x.r.itemId === 39, '碎片场体力不足时扣勇气徽章');
  assert.equal(x.after.b, 0, '勇气徽章 1→0');
  assert.equal(x.after.e, 10, '体力不该动');
  // 碎片场**不能**用英雄帖
  x = pay(10, 3, 0, 1);
  assert.ok(!x.r.ok, '碎片场不该接受英雄帖');
  assert.equal(x.after.t, 3, '被拒时英雄帖不该被扣');
  // 经验场**不能**用勇气徽章
  x = pay(10, 0, 3, 0);
  assert.ok(!x.r.ok, '经验场不该接受勇气徽章');
  assert.equal(x.after.b, 3, '被拒时勇气徽章不该被扣');
  // 弹尽粮绝 → 拒绝且不扣任何东西
  x = pay(0, 0, 0, 0);
  assert.ok(!x.r.ok, '什么都没有时应当拒绝');
  assert.equal(x.after.e, 0, '被拒时体力不该动');
  x = pay(0, 0, 0, 1);
  assert.ok(!x.r.ok, '碎片场什么都没有时应当拒绝');
  // 不变量：只要 ok，就必须真的少点什么；且**只扣一种**（体力或对应道具）
  for (const kind of [0, 1]) {
    for (const [e, t, b] of [[90, 0, 0], [30, 0, 0], [10, 1, 0], [10, 0, 1], [29, 5, 5]]) {
      const y = pay(e, t, b, kind);
      if (!y.r.ok) continue;
      const dE = y.before.e - y.after.e, dT = y.before.t - y.after.t, dB = y.before.b - y.after.b;
      assert.ok(dE + dT + dB > 0, 'ok 时必须有扣除（kind=' + kind + ' e=' + e + ' t=' + t + ' b=' + b + '）');
      const changed = [dE > 0, dT > 0, dB > 0].filter(Boolean).length;
      assert.equal(changed, 1, '一次报名只该扣一种资源（kind=' + kind + ' dE=' + dE + ' dT=' + dT + ' dB=' + dB + '）');
      if (y.r.by === 'energy') assert.ok(dE === 30, '体力路径应当正好扣 30，实测 ' + dE);
      if (y.r.by === 'item') {
        assert.ok(y.r.itemId === (kind ? 39 : 36), '道具路径应当扣对应入场券');
        assert.equal(kind ? dB : dT, 1, '道具路径应当正好扣 1 枚');
      }
    }
  }
  // 端到端：走真实报名入口（体力充足 → 扣 30 体力）
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 90; ss.props[39] = 3; ss.props[36] = 3;
    enterArena(g, 1);
    assert.equal(ss.energy, 60, '碎片场报名应当扣 30 体力，实测 ' + ss.energy);
    assert.equal(ss.props[39], 3, '体力够时不该动勇气徽章');
    assert.equal(g.battles.length, 1, '应当开始比赛');
  }
  // 端到端：体力不足 → 扣勇气徽章
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 10; ss.props[1] = 0; ss.props[2] = 0; ss.props[39] = 1;
    enterArena(g, 1);
    assert.equal(ss.props[39], 0, '碎片场体力不足应当扣勇气徽章');
    assert.equal(ss.energy, 10, '体力不该动');
    assert.equal(g.battles.length, 1, '应当开始比赛');
  }
  // 回归：**体力 0 + 勇气徽章 1** 报名碎片场 —— 以前会被粗判不变量误报「报名异常，请反馈」
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 0; ss.props[1] = 0; ss.props[2] = 0; ss.props[39] = 1; ss.props[36] = 0;
    enterArena(g, 1);
    assert.equal(ss.props[39], 0, '体力 0 时应当扣勇气徽章');
    assert.equal(ss.energy, 0, '体力本来就没有，不该变负');
    assert.equal(g.battles.length, 1, '应当正常开始比赛');
    const last = g.modals.at(-1) || {};
    assert.ok(!/异常|请反馈/.test(String(last.html) || ''), '不该出现「报名异常」提示：' + last.html);
    assert.ok(!/报名异常/.test(String(last.title) || ''), '不该出现「报名异常」弹窗：' + last.title);
  }
  // 回归：**体力 0 + 勇气徽章 5** → 只扣 1 枚
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 0; ss.props[1] = 0; ss.props[2] = 0; ss.props[39] = 5;
    enterArena(g, 1);
    assert.equal(ss.props[39], 4, '只该扣 1 枚勇气徽章，实测剩 ' + ss.props[39]);
    assert.equal(g.battles.length, 1, '应当正常开始比赛');
  }
  // 喝药兜底（第三方优先级）：体力不足、无准入道具时才喝药
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 0; ss.props[1] = 0; ss.props[2] = 1; ss.props[39] = 0; ss.props[36] = 0;
    enterArena(g, 0);
    assert.equal(g.battles.length, 1, '有大体力药剂时应当能进场');
    assert.equal(Number(ss.props[2] || 0), 0, '大体力药剂应当被喝掉');
    assert.equal(ss.energy, 0, '喝药补到 30 后再扣 30，体力回到 0');
  }
  // 药剂**补不够**时不该白白喝掉（体力 0 + 只有小药剂 +10）
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 0; ss.props[1] = 1; ss.props[2] = 0; ss.props[39] = 0; ss.props[36] = 0;
    enterArena(g, 0);
    assert.equal(g.battles.length, 0, '小药剂补不到 30 时不该进场');
    assert.equal(Number(ss.props[1] || 0), 1, '补不够时不该白喝掉小体力药剂 ← 曾经会白扔');
    assert.equal(ss.energy, 0, '体力不该变');
  }
  // 有大有小：应当优先喝能把体力补够的那瓶（缺 30 → 先看大药剂）
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 0; ss.props[1] = 1; ss.props[2] = 1; ss.props[39] = 0; ss.props[36] = 0;
    enterArena(g, 1);
    assert.equal(g.battles.length, 1, '应当能进场');
    assert.equal(Number(ss.props[2] || 0), 0, '应当先喝大体力药剂');
    assert.equal(Number(ss.props[1] || 0), 1, '小体力药剂不该被动');
  }
  // 有准入道具时**不喝药**（道具优先于喝药）
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 0; ss.props[1] = 1; ss.props[2] = 1; ss.props[39] = 1; ss.props[36] = 0;
    enterArena(g, 1);
    assert.equal(Number(ss.props[39] || 0), 0, '有徽章时应当用徽章');
    assert.equal(Number(ss.props[2] || 0), 1, '有徽章时不该喝药');
    assert.equal(Number(ss.props[1] || 0), 1, '有徽章时不该喝药');
  }
  // 体力充足时**不喝药也不花道具**（体力优先级最高）
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 90; ss.props[1] = 1; ss.props[2] = 1; ss.props[39] = 3; ss.props[36] = 3;
    enterArena(g, 1);
    assert.equal(ss.energy, 60, '体力 90→60');
    assert.equal(Number(ss.props[39] || 0), 3, '体力够时不该动徽章');
    assert.equal(Number(ss.props[2] || 0), 1, '体力够时不该喝药');
  }
  // 回归：体力 0 + 无徽章 → 拒绝，且提示「没有勇气徽章」
  {
    const g = setup(), ss = g.c.State.state();
    ss.level = 25; ss.energy = 0; ss.props[1] = 0; ss.props[2] = 0; ss.props[39] = 0; ss.props[36] = 3;
    enterArena(g, 1);
    assert.equal(g.battles.length, 0, '没有徽章时不该进场');
    assert.equal(ss.props[36], 3, '英雄帖不该被扣');
    assert.match(String(g.modals.at(-1).html), /勇气徽章/, '应当提示缺少勇气徽章');
  }
  // 源码层面：两段式扣费的旧写法不该再出现
  const src = fs.readFileSync(path.join(rootDir, 'js', 'classic-extras.js'), 'utf8');
  assert.ok(src.indexOf('function payArenaEntry') > 0, '应当有统一的 payArenaEntry');
  assert.ok(!/if \(s\.energy >= 30\) \{ if \(!State\.consumeEnergy\(30\)\) return; \}/.test(src),
    '旧的「两段式」扣费写法应当已被 payArenaEntry 取代');
});

test('竞技战果弹窗：「返回竞技场」在主操作位（最右）', () => {
  const g = setup(), s = g.c.State.state();
  s.level = 25;
  enterArena(g, 0);
  g.settle(0, 0); g.modalClick(); g.settle(1, 0);
  const modal = g.modals.at(-1);
  const labels = modal.buttons.map((b) => b.label);
  assert.equal(labels.join('/'), '查看录像/返回竞技场', '战果弹窗按钮：' + labels.join('/'));
  const back = modal.buttons.find((b) => b.label === '返回竞技场');
  const movie = modal.buttons.find((b) => b.label === '查看录像');
  assert.ok(back && back.primary === true, '返回竞技场应当标 primary（靠右）');
  assert.ok(movie && movie.muted === true, '查看录像应当标 muted（靠左）');
});

test('竞技两战只付一次报名费用，冠军150经验且不额外赠送金松果', () => {
  const g = setup(), s = g.c.State.state();
  enterArena(g, 0); assert.equal(s.energy, 60); assert.equal(g.battles.length, 1);
  g.settle(0, 0);
  const modalCount = g.modals.length;
  g.settle(0, 0); assert.equal(g.modals.length, modalCount); assert.equal(s.exp, 0);
  g.modalClick(); assert.equal(s.energy, 60); assert.equal(g.battles.length, 2);
  g.settle(1, 0); assert.equal(s.goldPoint, 100); assert.equal(s.level, 11); assert.equal(s.exp, 150);
  const saved = JSON.stringify(g.saved()); g.settle(1, 0); assert.equal(JSON.stringify(g.saved()), saved);
  assert.equal(s.classicArenaRun, null);
  assert.equal(g.battles[0].opts.kind, 'arena'); assert.equal(g.battles[1].opts.useProps, false);
  assertBalanced(g.markup);
});

test('经验竞技冠亚季四名分别150/75/45/0，半决赛落败必须再打季军赛', () => {
  for (const [semiWin, secondWin, reward, place] of [[0, 0, 150, '冠军'], [0, 1, 75, '亚军'], [1, 0, 45, '季军'], [1, 1, 0, '第四名']]) {
    const g = setup(), s = g.c.State.state(); enterArena(g, 0);
    g.settle(0, semiWin); g.settle(0, semiWin);
    assert.equal(s.exp, 0); assert.equal(g.modals.at(-1).title, semiWin === 0 ? '晋级决赛' : '争夺季军');
    g.modalClick(); g.settle(1, secondWin); g.settle(1, secondWin);
    assert.equal(s.exp, reward); assert.equal(s.goldPoint, 100); assert.equal(s.energy, 60);
    assert.match(g.modals.at(-1).html, new RegExp('获得' + place)); assertBalanced(g.markup);
  }
});

test('经验竞技场吃经验丸加成：经验丸+40%、超级经验丸+60%，并按场次消耗', () => {
  // 单丸：150 -> 210
  {
    const g = setup(), s = g.c.State.state();
    s.propsStates[7] = 20; enterArena(g, 0);
    assert.equal(g.c.State.expBoostPct(), 40);
    g.settle(0, 0); g.modalClick(); g.settle(1, 0); g.settle(1, 0);
    assert.equal(s.exp, 210, '150 × 1.4 = 210');
    assert.equal(s.propsStates[7], 19, '按场次消耗 1 次');
  }
  // 双丸叠加：150 -> 300
  {
    const g = setup(), s = g.c.State.state();
    s.propsStates[7] = 20; s.propsStates[44] = 20; enterArena(g, 0);
    assert.equal(g.c.State.expBoostPct(), 100);
    g.settle(0, 0); g.modalClick(); g.settle(1, 0); g.settle(1, 0);
    assert.equal(s.exp, 300, '150 × 2 = 300');
    assert.equal(s.propsStates[7], 19); assert.equal(s.propsStates[44], 19);
  }
  // 没有药丸时不加成
  {
    const g = setup(), s = g.c.State.state(); enterArena(g, 0);
    assert.equal(g.c.State.expBoostPct(), 0);
    g.settle(0, 0); g.modalClick(); g.settle(1, 0); g.settle(1, 0);
    assert.equal(s.exp, 150);
  }
  // 碎片场只给碎片，不发经验、也不消耗经验丸
  {
    const g = setup(), s = g.c.State.state();
    s.propsStates[7] = 20; s.energy = 0; s.props[39] = 1; s.props[1] = 0; s.props[2] = 0; enterArena(g, 1);
    g.settle(0, 0); g.modalClick(); g.settle(1, 0); g.settle(1, 0);
    assert.equal(s.exp, 0, '碎片场不发经验');
    assert.equal(s.propsStates[7], 20, '碎片场不消耗经验丸');
  }
});

test('碎片竞技四名依次 8/6/4/3 蓝片、不发经验与金松果，票据仅扣一次', () => {
  for (const [semiWin, secondWin, shards] of [[0, 0, 8], [0, 1, 6], [1, 0, 4], [1, 1, 3]]) {
    // 第 3 项：体力不足会先自动喝药剂，所以这里清空药剂，专门验证「碎片场用勇气徽章」
    const g = setup(), s = g.c.State.state(); s.energy = 0; s.props[39] = 1; s.props[1] = 0; s.props[2] = 0;
    enterArena(g, 1); assert.equal(s.props[39], 0); assert.equal(s.energy, 0);
    g.settle(0, semiWin); g.modalClick(); g.settle(1, secondWin); g.settle(1, secondWin);
    assert.equal(s.props[26], shards); assert.equal(s.goldPoint, 100); assert.equal(s.exp, 0);
  }
  // 真正「弹尽粮绝」：体力差 1 点、没有药剂也没有帖子 → 不允许进场
  const poor = setup(); const ps = poor.c.State.state();
  ps.energy = 29; ps.props[1] = 0; ps.props[2] = 0; ps.props[36] = 0; ps.props[39] = 0;
  enterArena(poor, 0);
  assert.equal(poor.battles.length, 0); assert.equal(poor.c.State.state().energy, 29);
});

test('季军对手来自另一组败者，决赛对手来自另一组胜者', () => {
  for (const semiWin of [0, 1]) {
    const g = setup(); let number = 0;
    g.c.State.genAI = level => ({ name: '选手' + (++number), level, hp: 100, power: 10, agility: 10, speed: 10, weapons: [], skills: [] });
    g.c.Sim.simulate = () => ({ winner: 1 });
    enterArena(g, 0); assert.equal(g.battles[0].foe.name, '选手1');
    g.settle(0, semiWin); g.modalClick(); assert.equal(g.battles[1].foe.name, semiWin === 0 ? '选手3' : '选手2');
  }
});

test('竞技保存中断进度，刷新后继续季军赛不再收费且旧回调不能发奖', () => {
  const g = setup(); enterArena(g, 0); g.settle(0, 1); g.modalClick(1);
  assert.equal(g.saved().classicArenaRun.phase, 'third');
  g.c.State.load(); const s = g.c.State.state();
  g.c.ClassicExtras.arena(); g.click('arena-resume');
  assert.equal(g.battles.length, 2); assert.equal(s.energy, 60);
  g.battles[1].opts.onError(); g.c.ClassicExtras.arena(); g.click('arena-resume');
  assert.equal(g.battles.length, 3); assert.equal(s.energy, 60);
  g.settle(1, 0); assert.equal(s.exp, 0);
  g.settle(2, 0); assert.equal(s.exp, 45); assert.equal(s.classicArenaRun, null);
  assertBalanced(g.markup);
});

test('天梯30级门槛、胜3杯败1杯、防双击与重复回调', () => {
  const g = setup(), s = g.c.State.state(); g.math.random = () => 0.5;
  g.c.ClassicExtras.rank(); assert.equal(g.battles.length, 0); assert.equal(s.integral, null);
  s.level = 30; g.c.ClassicExtras.rank();
  const handler = g.node('rank-fight').onclick; handler(); handler();
  assert.equal(g.battles.length, 1); assert.equal(s.joinRankCount, 1);
  assert.equal(s.energy, 90); assert.equal(s.goldPoint, 100);
  g.settle(0, 0); g.settle(0, 0);
  assert.equal(s.integral, 1527); assert.equal(s.goldCup, 3); assert.equal(s.exp, 0);
  g.c.ClassicExtras.rank(); g.click('rank-fight'); g.settle(1, 1); g.settle(1, 1);
  assert.equal(s.integral, 1512); assert.equal(s.goldCup, 4); assert.equal(s.exp, 0);
  assert.equal(s.joinRankCount, 2); assert.equal(g.battles[0].opts.kind, 'rank'); assertBalanced(g.markup);
});

test('天梯前10场免费、后10场各5金、20场上限，次日恢复次数', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30; g.math.random = () => 0.5;
  for (let i = 0; i < 20; i++) {
    g.c.ClassicExtras.rank(); g.click('rank-fight'); g.settle(i, 1);
    assert.equal(s.goldPoint, 100 - Math.max(0, i - 9) * 5);
    assert.equal(s.joinRankCount, i + 1);
  }
  assert.equal(s.goldPoint, 50); assert.equal(s.energy, 90);
  g.c.ClassicExtras.rank(); assert.equal(g.node('rank-fight').disabled, true);
  g.node('rank-fight').onclick(); assert.equal(g.battles.length, 20);
  g.advance(86400000); g.c.ClassicExtras.rank(); assert.equal(s.joinRankCount, 0);
  g.click('rank-fight'); assert.equal(s.goldPoint, 50); assert.equal(s.joinRankCount, 1);
});

test('天梯不足5金不扣次数，中断仅退款一次且跨午夜不扣新日次数', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30; s.joinRankCount = 10; s.goldPoint = 4;
  g.c.ClassicExtras.rank(); g.click('rank-fight'); assert.equal(g.battles.length, 0); assert.equal(s.joinRankCount, 10); assert.equal(s.goldPoint, 4);
  s.goldPoint = 5; g.click('rank-fight'); assert.equal(s.goldPoint, 0); assert.equal(s.joinRankCount, 11);
  g.battles[0].opts.onError(); g.battles[0].opts.onError(); g.settle(0, 0);
  assert.equal(s.goldPoint, 5); assert.equal(s.joinRankCount, 10); assert.equal(s.goldCup, 0);
  g.c.ClassicExtras.rank(); g.click('rank-fight'); g.advance(86400000); g.battles[1].opts.onError();
  assert.equal(s.joinRankCount, 0); assert.equal(s.goldPoint, 5);
});

test('天梯胜利夺杯为明确离线概率，失败不会夺杯', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30; g.math.random = () => 0;
  g.c.ClassicExtras.rank(); assert.match(g.page().html, /25%/);
  g.click('rank-fight'); g.settle(0, 0); assert.equal(s.goldCup, 6);
  g.c.ClassicExtras.rank(); g.click('rank-fight'); g.settle(1, 1); assert.equal(s.goldCup, 7);
});

test('第 2 项：天梯匹配等级只跟积分挂钩，70 级封顶', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30; s.joinRankCount = 0;
  const E = g.c.ClassicExtras.rankFoeExpectLevel;
  assert.equal(E(1500), 30, '1500 分（初始分）从 30 级档起步');
  assert.equal(E(1750), 40, '每 +25 分 +1 级');
  assert.equal(E(2500), 70, '2500 分到顶');
  assert.equal(E(99999), 70, '封顶 70 级');
  // 匹配到的实际等级围绕期望值抖动，且绝不超过 70
  g.math.random = () => 0.5;
  assert.equal(g.c.ClassicExtras.rankFoeLevel(1750), 40, '随机取中值时正好等于期望');
  const levels = [];
  for (let i = 0; i < 40; i++) {
    g.math.random = () => (i % 20) / 20;
    const lv = g.c.ClassicExtras.rankFoeLevel(99999);
    levels.push(lv);
    assert.ok(lv <= 70 && lv >= 1, '等级在 1~70 内：' + lv);
  }
  assert.ok(Math.max(...levels) > 66 && Math.min(...levels) >= 66, '高杯时整体贴近满级：' + levels.slice(0, 5).join(','));
  // 实战：匹配到的对手 level 就是这条曲线给的等级（不再贴玩家等级）
  s.level = 30; s.goldCup = 0; s.goldPoint = 100; s.integral = 2600;
  g.math.random = () => 0.5;
  g.c.ClassicExtras.rank(); g.click('rank-fight');
  assert.equal(g.battles.at(-1).foe.level, 70, '高积分 + 30 级玩家也会匹配到满级对手');
  // 金杯多寡不再影响匹配（花金杯不会让对手变软）
  g.settle(0, 0);                                    // 收掉上一场，否则 rankAttempt 未清、按钮禁用
  s.integral = 1500; s.goldCup = 5000;
  g.c.State.save();
  g.c.ClassicExtras.rank(); g.click('rank-fight');
  assert.equal(g.battles.at(-1).foe.level, 30, '积分 1500 就还是 30 级档，跟金杯无关');
});

test('天梯每天都可比赛（周日不休赛），金杯商店每天都能打开，跨日旧按钮仍重新校验', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30;
  // 基准时间是周三：商店照样能打开
  g.c.ClassicExtras.rank(); g.click('rank-shop'); assert.match(g.page().html, /data-goods/);
  /* 「跨日旧按钮要重新校验」用**每日场次上限**来验（原来靠周日休赛）：
   * 先把今日场次打满，此时旧按钮的闭包仍指向「满场」那一份状态，
   * 直接调用它不该开打；重新渲染出新按钮之后才轮到明天。 */
  const st = g.c.State.state();
  const keep = st.joinRankCount;
  st.joinRankCount = 20;
  g.c.ClassicExtras.rank();
  const stale = g.node('rank-fight').onclick;
  assert.equal(g.node('rank-fight').disabled, true, '满 20 场时按钮应当禁用');
  stale();
  assert.equal(g.battles.length, 0, '满场时旧按钮不该开打');
  /* 需求：周日不休赛 —— 推进 4 天（到周日）后按钮仍可点、点了就能开打。 */
  st.joinRankCount = keep;
  g.advance(4 * 86400000);
  g.c.ClassicExtras.rank(); assert.equal(g.node('rank-fight').disabled, false);   // 周日不休赛
  g.click('rank-shop'); assert.match(g.page().html, /data-goods/);
  g.c.ClassicExtras.rank();
  g.click('rank-fight'); assert.equal(g.battles.length, 1);                       // 周日真的能打
});

test('金杯商店兑换校验积分与两种货币，不扣积分，每周限一件且下周一重置', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30; s.integral = 1900; s.goldCup = 1000; s.goldPoint = 500;
  g.c.ClassicExtras.rank(); g.click('rank-shop'); g.click('rank-shop-next');
  const choose = () => g.page().querySelector('[data-goods="11"]').onclick();
  choose(); g.modalClick(); assert.equal(s.goldCup, 1000); assert.equal(s.goldPoint, 500); assert.equal(s.gears.length, 0);
  s.integral = 2000; choose(); const confirm = g.modals.at(-1).buttons[0].run; confirm(); confirm();
  assert.equal(s.goldCup, 0); assert.equal(s.goldPoint, 300); assert.equal(s.gears[0].id, 201); assert.equal(s.rankPurchases[11], 1); assert.equal(s.integral, 2000);
  s.goldCup = 2000; choose(); g.modalClick(); assert.equal(s.gears.length, 1); assert.equal(s.goldPoint, 300);
  assert.match(g.modals.at(-1).html, /本周的兑换次数已用完/);
  g.c.State.save(); g.c.State.load(); const loaded = g.c.State.state();
  g.c.ClassicExtras.rankShop(); g.click('rank-shop-next'); choose(); g.modalClick(); assert.equal(loaded.gears.length, 1);
  // 第 3 项：限兑按**周**重置 —— 隔一天还不能买，隔一周才可以
  g.advance(86400000); g.c.ClassicExtras.rankShop(); g.click('rank-shop-next'); choose(); g.modalClick();
  assert.equal(loaded.gears.length, 1, '第二天仍然买不了（每周限一件）');
  assert.match(g.modals.at(-1).html, /本周的兑换次数已用完/);
  g.advance(6 * 86400000); g.c.ClassicExtras.rankShop(); g.click('rank-shop-next'); choose(); g.modalClick();
  assert.equal(loaded.gears.length, 2); assert.equal(loaded.goldPoint, 100); assert.equal(loaded.goldCup, 1000); assert.equal(loaded.rankPurchases[11], 1);
  assertBalanced(g.markup);
});

test('金杯商店跨周：限兑按周重置，未标周次的旧购买计数在迁移时清空', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30; s.integral = 2000; s.goldCup = 4000; s.goldPoint = 1000;
  s.rankPurchases = { 11: 1 };   // 旧档只有计数、没有日期
  g.c.ClassicExtras.rankShop(); g.click('rank-shop-next');
  assert.deepEqual(JSON.parse(JSON.stringify(s.rankPurchases)), {});   // 迁移到按周重置时清空
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.rankPurchaseWeek), '记下本周周一：' + s.rankPurchaseWeek);
  assert.equal(s.rankPurchaseDay, undefined, '旧的按天标记要删掉');
  g.page().querySelector('[data-goods="11"]').onclick(); g.modalClick();
  assert.equal(s.gears.length, 1);
  g.page().querySelector('[data-goods="11"]').onclick(); g.modalClick();
  assert.equal(s.gears.length, 1);
  assert.match(g.modals.at(-1).html, /本周的兑换次数已用完/);
  g.advance(3 * 86400000);                         // 同一周内（周三 → 周六）
  g.c.ClassicExtras.rankShop(); g.click('rank-shop-next');
  g.page().querySelector('[data-goods="11"]').onclick(); g.modalClick();
  assert.equal(s.gears.length, 1, '同一周内不能再买');
  g.advance(3 * 86400000);                         // 跨到下一周
  g.c.ClassicExtras.rankShop(); g.click('rank-shop-next');
  g.page().querySelector('[data-goods="11"]').onclick(); g.modalClick();
  assert.equal(s.gears.length, 2);
  assert.equal(s.rankPurchases[11], 1);
});


test('抽奖首抽免费、防双击，付费经验奖扣20并真正升级', () => {
  const g = setup(), s = g.c.State.state(); g.math.random = () => 0;
  g.c.ClassicExtras.lottery(); const first = g.node('lottery-spin').onclick; first(); first();
  assert.equal(s.props[22], 10); assert.equal(s.lotteryFree, 0); assert.equal(s.goldPoint, 100);
  // 每日任务「抽取 {n} 次每日幸运抽奖」要有计数：抽一次算一次，双击只算一次
  assert.equal(s.dailyCounters.lottery, 1, '第一次抽奖记 1 次');
  g.flushTimers(); g.math.random = () => 0.35; g.click('lottery-spin');
  assert.equal(s.goldPoint, 80); assert.equal(s.level, 2); assert.equal(s.exp, 30);
  assert.equal(s.dailyCounters.lottery, 2, '第二次抽奖累加到 2 次');
  g.flushTimers(); assert.equal(g.saved().goldPoint, 80); assert.equal(g.saved().dailyCounters.lottery, 2, '每日任务计数已存盘');
  assertBalanced(g.markup);
});

test('每日抽奖：右上角抽奖卷角标 + 删掉底部说明 + 连抽 10 次', () => {
  const g = setup(), s = g.c.State.state();
  s.lotteryFree = 1; s.props[50] = 3; s.goldPoint = 100;      // 免费 1 + 抽奖卷 3 + 金松果 100
  g.c.ClassicExtras.lottery();
  const html = g.markup.at(-1)[1];
  /* ① 右上角标注仓库抽奖卷数量（refreshTickets 就地刷新用的就是 [data-lottery-ticket]） */
  assert.ok(/lottery-ticket-corner/.test(html), '要有右上角角标：' + html.slice(0, 200));
  assert.ok(/lottery-ticket-corner[\s\S]*?data-lottery-ticket/.test(html), '角标里要带抽奖卷数量节点');
  assert.ok(/data-lottery-ticket>3</.test(html), '角标应当显示仓库里的 3 张：' + html.slice(0, 260));
  /* ② 底部那两句说明（「每天免费一次，之后…」「当前金松果：」）已经删掉 */
  assert.ok(html.indexOf('每天免费') < 0, '底部不该再有「每天免费一次…」说明');
  assert.ok(html.indexOf('当前金松果') < 0, '底部不该再有「当前金松果：」');
  assert.ok(html.indexOf('data-lottery-gold') < 0, '金松果节点已随说明一起删除');
  /* ③ 保留「今日免费 N 次」状态与两个按钮 */
  assert.ok(/data-lottery-status/.test(html), '今日免费次数状态要保留');
  assert.ok(/data-action="lottery-spin"/.test(html) && /data-action="lottery-spin10"/.test(html), '要有单抽与连抽两个按钮');
  /* ④ 单抽按钮文案按当前资源变化（说明文字删掉后靠按钮表达费用） */
  assert.ok(/免费抽奖/.test(html), '有免费次数时按钮写「免费抽奖」');
  s.lotteryFree = 0; s.props[50] = 2;
  g.c.ClassicExtras.lottery();
  assert.ok(/用抽奖卷抽奖/.test(g.markup.at(-1)[1]), '有抽奖卷时按钮写「用抽奖卷抽奖」');
  s.props[50] = 0; s.goldPoint = 60;
  g.c.ClassicExtras.lottery();
  assert.ok(/20 金松果抽奖/.test(g.markup.at(-1)[1]), '只能花金松果时按钮写「20 金松果抽奖」');

  /* ⑤ 连抽 10 次：扣费顺序「免费 → 抽奖卷 → 金松果」，每日任务按 10 次计数 */
  const g2 = setup(), s2 = g2.c.State.state();
  /* 注意：refreshLotteryDay() 在跨天时会把免费次数重置为 1，所以这里要先把日期钉成今天 */
  s2.lotteryDate = new g2.c.Date(g2.c.Date.now()).toDateString();
  s2.lotteryFree = 2; s2.props[50] = 5; s2.goldPoint = 100;    // 2 免费 + 5 卷 + 100 金（=5 次）→ 12 次够抽 10
  g2.c.ClassicExtras.lottery();
  const beforeTickets = s2.props[50], beforeGold = s2.goldPoint;
  g2.math.random = () => 0;              // 固定抽到「不发金松果」的那一档，好核对扣费
  g2.click('lottery-spin10');
  assert.equal(s2.lotteryFree, 0, '先吃掉 2 次免费');
  assert.equal(s2.props[50] || 0, 0, '再吃掉 5 张抽奖卷（扣到 0 时字段会被删掉）');
  assert.equal(s2.goldPoint, beforeGold - 60, '剩下 3 次按 20 金松果扣');
  assert.equal(s2.dailyCounters.lottery, 10, '连抽 10 次要给每日任务记 10 次');
  assert.equal(g2.saved().dailyCounters.lottery, 10, '计数要立即落盘');
  g2.flushTimers();
  const ten = g2.modals.at(-1);
  assert.equal(ten.title, '连抽 10 次', '结束后要弹十连汇总：' + ten.title);
  /* 十连结果要一屏铺开：5×2 的奖励格（与抽奖页同款样式），不做上下滚动 */
  assert.equal((ten.html.match(/class="extra-prize won"/g) || []).length, 10, '十连结果要有 10 个奖励格');
  assert.ok(/lottery-result-grid/.test(ten.html), '十连结果要用 5×2 网格：' + ten.html.slice(0, 200));
  assert.ok(ten.html.indexOf('lottery-win-row') < 0, '不该再用滚动列表样式');
  assertBalanced(g2.markup);

  /* ⑥ 资源不够 10 次：直接拒绝，一点资源都不扣 */
  const g3 = setup(), s3 = g3.c.State.state();
  s3.lotteryDate = new g3.c.Date(g3.c.Date.now()).toDateString();
  s3.lotteryFree = 0; s3.props[50] = 2; s3.goldPoint = 40;      // 2 张卷 + 2 次金松果 = 4 次 < 10
  g3.c.ClassicExtras.lottery();
  const goldBefore = s3.goldPoint, ticketBefore = s3.props[50];
  g3.click('lottery-spin10');
  assert.equal(s3.goldPoint, goldBefore, '不够 10 次时不该扣金松果');
  assert.equal(s3.props[50], ticketBefore, '不够 10 次时不该扣抽奖卷');
  assert.equal((s3.dailyCounters || {}).lottery || 0, 0, '不够 10 次时不该计入每日任务');
  assert.ok(/连抽 10 次需要/.test(g3.modals.at(-1).html), '要说明差多少资源：' + g3.modals.at(-1).html);
  assertBalanced(g3.markup);
});

test('每条每日任务都有计数来源（防止再出现「抽奖任务不识别」）', () => {
  const source = ['js/state.js', 'js/classic-extras.js', 'js/battle-drops.js']
    .map((file) => fs.readFileSync(path.join(rootDir, file), 'utf8')).join('\n');
  const wired = new Set([...source.matchAll(/bumpDaily\('([a-z]+)'/g)].map((m) => m[1]));
  // 这几个走 bumpBattleDaily(win, kind) 按战斗类型记，没有字面量调用
  ['fight', 'win', 'stage', 'arena', 'rank', 'spar', 'challenge'].forEach((key) => wired.add(key));
  const keys = ['win', 'fight', 'challenge', 'stage', 'arena', 'rank', 'spar', 'lottery',
    'merge', 'gem', 'upgrade', 'use', 'buy', 'sell', 'pickup', 'energy'];
  const missing = keys.filter((key) => !wired.has(key));
  assert.deepEqual(missing, [], '这些每日任务没有计数来源：' + missing.join('、'));

  // 运行时再确认一遍：计数真的会变成任务进度（抽奖任务现在能被识别）
  const g = setup(), s = g.c.State.state();
  s.quests = { date: g.c.State.localDate(), list: [{ key: 'lottery', need: 2, rewards: [], claimed: false }] };
  g.c.State.bumpDaily('lottery', 1);
  const row = g.c.State.questStatus()[0];
  assert.equal(row.name, '抽取 2 次每日幸运抽奖');
  assert.equal(row.progress, 1, '抽一次进度是 1');
  assert.equal(row.done, false);
  g.c.State.bumpDaily('lottery', 1);
  assert.equal(g.c.State.questStatus()[0].done, true, '抽满 2 次后任务可领取');
});

test('对手等级封顶：随机挑战/擂台再抖也不会冒出 70 级以上的 NPC', () => {
  const g = setup();
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    for (const asked of [70, 74, 90]) {
      const foe = g.c.State.genAI(asked, '', { levelJitter: 3 });
      seen.add(foe.level);
      assert.ok(foe.level <= 70, 'genAI(' + asked + ') 生成了 ' + foe.level + ' 级');
      assert.ok(foe.level >= 1, 'genAI(' + asked + ') 等级不能低于 1');
    }
  }
  assert.ok(seen.has(70), '满级附近的对手应该真的能生成 70 级（不是全被压到很低）：' + [...seen].sort((a, b) => a - b).join(','));
  // 满级玩家在挑战/擂台里按 ±3 浮动，夹过之后不越界
  const s = g.c.State.state(); s.level = 70;
  for (let i = 0; i < 40; i++) {
    const foe = g.c.State.genAI(Math.max(1, s.level + Math.floor(g.math.random() * 6) - 3));
    assert.ok(foe.level <= 70, '满级玩家的对手是 ' + foe.level + ' 级');
  }
});

test('抽奖离开动画后奖品已保存，重入可继续且旧计时器不会重发奖励', () => {
  const g = setup(), s = g.c.State.state(); g.math.random = () => 0;
  g.c.ClassicExtras.lottery(); g.click('lottery-spin');
  assert.equal(g.saved().props[22], 10); assert.equal(g.saved().lotteryFree, 0);
  g.leave(); g.c.ClassicExtras.lottery();
  assert.equal(g.node('lottery-spin').disabled, false);
  g.click('lottery-spin'); assert.equal(s.props[22], 20); assert.equal(s.goldPoint, 80);
  g.flushTimers(); assert.equal(s.props[22], 20); assert.equal(s.goldPoint, 80);
  assert.equal(g.node('lottery-spin').disabled, false);
  g.c.State.load(); assert.equal(g.c.State.state().props[22], 20);
});

test('抽奖里改成两个随机普通药丸，不再直接发天使果实种子', () => {
  const g = setup(), s = g.c.State.state();
  const table = g.c.ClassicExtras.lotteryPrizes;
  assert.equal(table.length, 10);
  assert.ok(table.every((p) => p.id !== 45), '奖池里不再有天使果实种子');
  /* 2026-10 第十六批：大体力药剂（道具 2）从 ×4 削弱到 ×3 */
  const big = table.filter((p) => p.id === 2);
  assert.equal(big.length, 1, '奖池里应当只有一个大体力药剂奖位：' + JSON.stringify(big));
  assert.equal(big[0].count, 3, '大体力药剂 ×3（本轮由 4 削弱到 3），实测 ' + big[0].count);
  assert.match(big[0].label, /大体力药剂 ×3/, '文案同步：' + big[0].label);
  const pills = table.filter((p) => p.pills);
  assert.equal(pills.length, 1, '只有一个「随机普通药丸」奖位');
  assert.equal(pills[0].pills, 2, '一次给两个药丸');
  // 0.85 → 选中第 9 项；药丸抽取也用同一个随机数（落到列表最后一个 → 经验丸）
  g.math.random = () => 0.85;
  const before = {}; [3, 4, 5, 7].forEach((id) => (before[id] = s.props[id] || 0));
  g.c.ClassicExtras.lottery(); g.click('lottery-spin'); g.flushTimers();
  const gained = [3, 4, 5, 7].reduce((sum, id) => sum + ((s.props[id] || 0) - before[id]), 0);
  assert.equal(gained, 2, '实际到手两个普通药丸');
  assert.equal(s.goldPoint, 100, '这一档不发金松果');
  assert.ok(g.modals.at(-1).html.includes('经验丸'), '结算弹窗显示真实抽到的药丸：' + g.modals.at(-1).html.slice(0, 120));
});

test('抽奖旧日期迁移不白送次数，新的一天仅恢复一次免费机会', () => {
  const g = setup(), s = g.c.State.state();
  s.lotteryDate = new g.c.Date(g.c.Date.now()).toDateString(); s.lotteryFree = 0;
  g.c.ClassicExtras.lottery(); assert.equal(s.lotteryFree, 0);
  g.advance(24 * 60 * 60 * 1000); g.c.ClassicExtras.lottery(); assert.equal(s.lotteryFree, 1);
  g.math.random = () => 0; g.click('lottery-spin'); g.flushTimers();
  g.c.ClassicExtras.lottery(); assert.equal(s.lotteryFree, 0);
  s.goldPoint = 19; const props = JSON.stringify(s.props); g.click('lottery-spin');
  assert.equal(s.goldPoint, 19); assert.equal(JSON.stringify(s.props), props);
});

test('拜师后自动学会师父驾到，出师花20金松果且角色数据完整', () => {
  const g = setup(), s = g.c.State.state();
  s.level = 12; s.goldPoint = 100;
  g.c.ClassicExtras.master();
  // 新界面：先点候选人卡片选中，再点「拜他为师」
  const card = g.page().querySelector('[data-master="0"]');
  assert.ok(card && card.onclick, '师父候选人卡片可点击');
  card.onclick();
  g.click('master-join');
  assert.ok(s.master, '已记录师父');
  assert.ok(g.saved().master, '师父已存档');
  assert.equal(typeof s.master.level, 'number', '师父等级写成数字');
  // 拜师后自动学会师父驾到（技能 13）
  const learned = s.skills.some((x) => Number(String(x).split(':')[0]) === 13);
  assert.ok(learned, '自动学会师父驾到：' + JSON.stringify(s.skills));
  // 出师要花 20 金松果
  g.c.ClassicExtras.master(); g.click('master-leave'); g.modalClick();
  assert.equal(s.master, null); assert.equal(g.saved().master, null);
  assert.equal(s.goldPoint, 80, '出师扣除20金松果');
  assertBalanced(g.markup);
});

test('收徒上限随师父等级1/2/3，仅扣10金松果且重复调用不多发徒弟', () => {
  const g = setup(), s = g.c.State.state();
  assert.equal(g.c.State.apprenticeCap(5), 1);
  assert.equal(g.c.State.apprenticeCap(10), 2);
  assert.equal(g.c.State.apprenticeCap(19), 2);
  assert.equal(g.c.State.apprenticeCap(20), 3);
  s.level = 5;
  g.c.ClassicExtras.master('apprentice');
  const handler = g.node('master-recruit').onclick; handler(); handler();
  assert.equal(s.energy, 90); assert.equal(s.goldPoint, 90); assert.equal(g.battles.length, 1);
  assert.equal(g.battles[0].opts.cost, undefined);
  g.settle(0, 0); g.settle(0, 0);
  assert.equal(s.prentices.length, 1, '重复回调不多发徒弟');
  // 5 级只能收 1 个：界面提示名额已满，且再点收徒不会开战
  g.c.ClassicExtras.master('apprentice');
  assert.ok(g.page().html.includes('收徒名额已满'), '名额满时给出提示');
  const battlesBefore = g.battles.length;
  g.node('master-recruit').onclick();
  assert.equal(g.battles.length, battlesBefore, '名额满时不再发起收徒挑战');
  // 升级到 20 级后可收 3 个
  s.level = 20;
  s.prentices.push({ name: '二徒弟', level: 4 }, { name: '三徒弟', level: 6 });
  g.c.ClassicExtras.master('apprentice');
  assert.ok(g.page().querySelector('[data-prentice="2"]'), '三个徒弟都列出');
  const before = s.prentices.length;
  g.c.ClassicExtras.master('apprentice');
  g.click('prentice-leave'); g.modalClick();
  assert.equal(s.prentices.length, before - 1, '可以让徒弟离开');
  assertBalanced(g.markup);
});

test('徒弟日供 = 等级之和的系数 × 我昨日收益；新增当天不能领，次日只领一次且踢人每天一次', () => {
  const g = setup(), s = g.c.State.state();
  s.level = 20; s.exp = 0; s.goldPoint = 0;
  g.c.State.addPrentice({ name: '甲', level: 10 });
  g.c.State.addPrentice({ name: '乙', level: 20 });
  assert.equal(g.c.State.apprenticeDailyTotal().exp, 0, '当天还没有昨日收益');
  assert.equal(g.c.State.claimApprenticeExp().ok, false, '新增当天不能领');

  // 当天赚 1000 经验 + 200 金松果（走真实入口记账）
  g.c.State.gainExp(1000);
  g.c.State.addGold(200);
  g.advance(86400000);                       // 次日结算

  /* 经验与金松果的日供系数是两条线性插值（区间不同），分别核对。 */
  const expRatio = g.c.State.apprenticeTributeExpRatio(10 + 20);
  const goldRatio = g.c.State.apprenticeTributeGoldRatio(10 + 20);
  const total = g.c.State.apprenticeDailyTotal();
  assert.ok(Math.abs(total.exp - 1000 * expRatio) <= 2, '经验合计≈经验系数×收益：' + total.exp);
  assert.ok(Math.abs(total.gold - 200 * goldRatio) <= 2,
    '金松果合计≈金松果系数×收益（' + goldRatio.toFixed(3) + '）：' + total.gold);
  const perA = g.c.State.apprenticeDailyExp(s.prentices[0]);
  const perB = g.c.State.apprenticeDailyExp(s.prentices[1]);
  assert.ok(perB > perA, '等级高的徒弟分的份额更多：' + perA + ' < ' + perB);
  assert.equal(perA + perB, total.exp, '各徒弟份额之和 = 合计');

  const expBefore = s.exp, goldBefore = s.goldPoint;
  const r = g.c.State.claimApprenticeExp();
  assert.ok(r.ok && r.count === 2, JSON.stringify(r));
  assert.equal(s.exp, expBefore + total.exp, '日供经验加到师父身上');
  assert.equal(s.goldPoint, goldBefore + total.gold, '日供金松果也加到师父身上');
  assert.ok(!g.c.State.claimApprenticeExp().ok, '同一天不能再领');
  // 日供本身不再计入当日收益，避免滚雪球
  assert.equal(g.c.State.earnOn(g.c.State.localDate()).exp, 0, '领到的日供不算我今天的收益');

  // 踢人每天 1 次
  assert.ok(g.c.State.canKickToday());
  assert.ok(g.c.State.kickPrentice('甲').ok);
  assert.ok(!g.c.State.canKickToday(), '当天不能再踢');
  assert.ok(!g.c.State.kickPrentice('乙').ok, '当天第二次踢人被拒绝');
  assert.equal(s.prentices.length, 1);
  assertBalanced(g.markup);
});

test('超级松鼠：两档价格 150/500，且到期不重置等级、续费从原等级继续', () => {
  const g = setup(), s = g.c.State.state();
  assert.equal(JSON.stringify(g.c.State.VIP_PLANS.map((p) => [p.days, p.gold])), JSON.stringify([[7, 150], [30, 500]]));
  s.goldPoint = 10000;
  assert.equal(g.c.State.buyVip(7).ok, true);
  assert.equal(s.goldPoint, 10000 - 150, '7 天 150');
  assert.equal(g.c.State.buyVip(30).ok, true);
  assert.equal(s.goldPoint, 10000 - 150 - 500, '30 天 500');
  // 养到 4 级
  s.vip.level = 4; s.vip.exp = 0;
  assert.equal(g.c.State.vipLevel(), 4);
  // 到期：特权停掉，但等级与经验留在存档里
  g.advance(40 * 86400000);
  assert.equal(g.c.State.vipActive(), false, '已到期');
  assert.equal(g.c.State.vipLevel(), 0, '到期后特权等级按 0 算');
  assert.equal(s.vip.level, 4, '存档里的等级不能被清掉');
  g.c.State.save(); g.c.State.load();
  assert.equal(g.c.State.state().vip.level, 4, '读档也不会重置');
  // 续费从原等级继续
  g.c.State.state().goldPoint = 10000;
  g.c.State.buyVip(7);
  assert.equal(g.c.State.vipLevel(), 4, '续费后从 Lv4 继续');
});

test('刷新师父/徒弟会换人且范围合理，候选人都带可查看的属性', () => {
  const g = setup(), s = g.c.State.state();
  s.level = 25;
  g.c.ClassicExtras.master();
  const html1 = g.page().html;
  const names = (h) => [...h.matchAll(/data-master="\d+"/g)].length;
  assert.equal(names(html1), 3, '给 3 位师父候选');
  g.click('master-refresh');
  const html2 = g.page().html;
  assert.equal(names(html2), 3, '刷新后仍是 3 位');
  // 师父等级应高于玩家（+2~+12）；只取「data-master」卡片里的等级
  const levels = [...html2.matchAll(/data-master="\d+"[\s\S]*?candidate-level">等级 (\d+)/g)].map((m) => Number(m[1]));
  assert.equal(levels.length, 3, '三位候选都带等级：' + JSON.stringify(levels));
  assert.ok(levels.every((lv) => lv >= 27 && lv <= 37), '师父等级在 +2~+12 范围内：' + levels.join(','));
  // 详情里能看到四维与武器/技能
  assert.ok(html2.includes('candidate-detail'), '有候选详情区');
  assert.ok(/力/.test(html2) && /敏/.test(html2) && /速/.test(html2) && /命/.test(html2), '详情含四维');
  assert.ok(html2.includes('profile-gear'), '详情含武器与技能清单');
  // 徒弟页在另一个页签里
  g.c.ClassicExtras.master('apprentice');
  g.click('recruit-refresh');
  assert.equal([...g.page().html.matchAll(/data-recruit="\d+"/g)].length, 3, '给 3 位徒弟候选');  assertBalanced(g.markup);
});

test('师徒候选等级合理化：不超过满级 70，徒弟不会超过师父', () => {
  const g = setup(), s = g.c.State.state();
  s.level = 70;
  g.c.ClassicExtras.master('master');
  let masterLevels = [...g.page().html.matchAll(/data-master="\d+"[\s\S]*?candidate-level">等级 (\d+)/g)].map((m) => Number(m[1]));
  assert.equal(masterLevels.length, 3);
  assert.ok(masterLevels.every((lv) => lv <= 70), '70 级时师父候选不超过满级：' + masterLevels.join(','));
  // 换一批再看，多次随机都不能超过满级
  for (let i = 0; i < 6; i++) {
    g.click('master-refresh');
    masterLevels = [...g.page().html.matchAll(/data-master="\d+"[\s\S]*?candidate-level">等级 (\d+)/g)].map((m) => Number(m[1]));
    assert.ok(masterLevels.every((lv) => lv >= 1 && lv <= 70), '师父等级 1~70：' + masterLevels.join(','));
  }
  g.c.ClassicExtras.master('apprentice');
  for (let i = 0; i < 6; i++) {
    g.click('recruit-refresh');
    const recruitLevels = [...g.page().html.matchAll(/data-recruit="\d+"[\s\S]*?candidate-level">等级 (\d+)/g)].map((m) => Number(m[1]));
    assert.equal(recruitLevels.length, 3);
    assert.ok(recruitLevels.every((lv) => lv >= 1 && lv <= 70), '徒弟等级 1~70：' + recruitLevels.join(','));
    assert.ok(recruitLevels.every((lv) => lv <= s.level + 1), '徒弟不会比师父强太多：' + recruitLevels.join(','));
  }
  assertBalanced(g.markup);
});

test('收徒金松果不足不启动，零体力可以收徒，落败消耗一次药剂状态', () => {
  const g = setup(), s = g.c.State.state(); s.energy = 0;s.goldPoint=9;
  g.c.ClassicExtras.master('apprentice'); g.click('master-recruit'); assert.equal(g.battles.length, 0); assert.equal(s.goldPoint,9);
  s.goldPoint = 10; s.propsStates[3] = 20; g.c.ClassicExtras.master('apprentice'); g.click('master-recruit');
  g.settle(0, 1); g.settle(0, 1);
  assert.equal(s.energy, 0);assert.equal(s.goldPoint,0); assert.equal(s.prentices.length, 0); assert.equal(s.exp, 0); assert.equal(s.propsStates[3], 19);
});

test('日供系数：经验 5%~15%、金松果 5%~25%，均按等级之和线性插值', () => {
  const g = setup();
  const RE = g.c.State.apprenticeTributeExpRatio;    // 经验
  const RG = g.c.State.apprenticeTributeGoldRatio;   // 金松果
  // 下限：没有任何徒弟也是 5%
  assert.equal(g.c.State.TRIBUTE_EXP_MIN, 0.05, '经验下限 5%');
  assert.equal(g.c.State.TRIBUTE_EXP_MAX, 0.15, '经验上限 15%');
  assert.equal(g.c.State.TRIBUTE_GOLD_MIN, 0.05, '金松果下限 5%');
  assert.equal(g.c.State.TRIBUTE_GOLD_MAX, 0.25, '金松果上限 25%');
  assert.ok(Math.abs(RE(0) - 0.05) < 1e-9, '没徒弟也是经验 5%：' + RE(0));
  assert.ok(Math.abs(RG(0) - 0.05) < 1e-9, '没徒弟也是金松果 5%：' + RG(0));
  assert.ok(Math.abs(RE(1) - 0.05) < 0.01, '一个 1 级徒弟 ≈ 5% 保底：' + RE(1));
  // 上限：三个满级（Σ=210）正好到顶
  assert.ok(Math.abs(RE(210) - 0.15) < 1e-9, 'Σ=210 经验正好 15%：' + RE(210));
  assert.ok(Math.abs(RG(210) - 0.25) < 1e-9, 'Σ=210 金松果正好 25%：' + RG(210));
  assert.equal(RE(999), 0.15, '经验封顶 15%');
  assert.equal(RG(999), 0.25, '金松果封顶 25%');
  // 线性：等距的等级之和给出等距的系数
  assert.ok(Math.abs((RE(40) - RE(20)) - (RE(200) - RE(180))) < 1e-9, '经验线性递增');
  assert.ok(Math.abs((RG(40) - RG(20)) - (RG(200) - RG(180))) < 1e-9, '金松果线性递增');
  // 金松果那条始终不低于经验那条（区间更宽）
  for (const sum of [0, 50, 105, 160, 210]) {
    assert.ok(RG(sum) >= RE(sum) - 1e-9, '金松果系数不该低于经验：Σ=' + sum + ' ' + RG(sum) + ' vs ' + RE(sum));
  }

  // 三个满级徒弟：合计正好是我昨日收益的 15%（经验）/ 25%（金松果）
  const s = g.c.State.state();
  s.level = 20; s.exp = 0; s.goldPoint = 0;
  g.c.State.addPrentice({ name: '满级甲', level: 70 });
  g.c.State.addPrentice({ name: '满级乙', level: 70 });
  g.c.State.addPrentice({ name: '满级丙', level: 70 });
  g.c.State.gainExp(1000);
  g.c.State.addGold(400);
  g.advance(86400000);
  const total = g.c.State.apprenticeDailyTotal();
  assert.equal(total.exp, 150, '三个满级徒弟合计 15% 经验');
  assert.equal(total.gold, 100, '三个满级徒弟合计 25% 金松果');
  g.c.ClassicExtras.master('apprentice');
  assert.match(g.page().html, /等级之和/);
  const before = s.exp;
  g.click('master-claim');
  assert.equal(s.exp, before + 150, '点击领取真的发出 150 经验（三个满级徒弟 = 昨日收益的 15%）');
  assert.equal(g.c.State.claimApprenticeExp().ok, false, '当天只能领一次');
  assertBalanced(g.markup);
});

test('日供只认我自己的昨日收益：读档稳定、不重抽，也不减少徒弟经验', () => {
  const g = setup(), s = g.c.State.state(); s.level = 20; s.exp = 0; s.goldPoint = 0;
  g.c.State.addPrentice({ name: '下午入门', level: 20 });
  const p = s.prentices[0]; p.exp = 123;
  assert.equal(g.c.State.apprenticeDailyStatus(p).newApprentice, true, '入门当天没有「昨天」');
  assert.equal(g.c.State.claimApprenticeExp().ok, false);
  assert.equal(g.c.State.apprenticeDailyTotal().exp, 0);

  const earnDay = g.c.State.localDate();
  g.c.State.gainExp(500); g.c.State.addGold(100);
  g.advance(86400000);                       // 次日结算

  const daily = g.c.State.apprenticeDailyStatus(p);
  assert.equal(daily.date, earnDay, '结算的是前一天');
  assert.equal(daily.mine.exp, 500, '读的是我昨天的收益');
  assert.equal(daily.mine.gold, 100);
  assert.equal(daily.ratio, g.c.State.apprenticeTributeRatio(20));
  assert.ok(daily.exp > 0 && daily.gold > 0);
  // 反复读不重抽
  const snapshot = JSON.parse(JSON.stringify(daily));
  assert.deepEqual(JSON.parse(JSON.stringify(g.c.State.apprenticeDailyStatus(p))), snapshot);
  g.c.State.save(); g.c.State.load();
  const loaded = g.c.State.state().prentices[0];
  assert.deepEqual(JSON.parse(JSON.stringify(g.c.State.apprenticeDailyStatus(loaded))), snapshot, '读档后日供不变');
  assert.equal(g.c.State.claimApprenticeExp().total, daily.exp);
  assert.equal(loaded.exp, 123, '领日供不减徒弟自己的经验');
  assert.equal(g.c.State.claimApprenticeExp().ok, false, '当天只能领一次');
  // 新的一天：今天没赚东西，所以昨天的日供是 0
  g.advance(86400000);
  const next = g.c.State.apprenticeDailyStatus(loaded);
  assert.equal(next.claimed, false);
  assert.equal(next.exp, 0, '昨天没赚到就没有日供');
  assert.equal(g.c.State.claimApprenticeExp().ok, false);
});

test('新收徒当天领不了、次日才能领；缺日期旧档从迁移日开始并保留当日已领取标记', () => {
  const g = setup();
  g.advance((8 * 60 + 59) * 60000);           // 23:59 收徒
  g.c.State.addPrentice({ name: '深夜', level: 20 });
  g.advance(120000);                          // 跨过零点
  assert.equal(g.c.State.apprenticeDailyTotal().exp, 0, '刚收徒当天没有可领的日供');
  assert.equal(g.c.State.claimApprenticeExp().ok, false, '收徒当天领不了');
  // 日供按「天」结算：跨过零点后的这一天就是它第一个完整贡献日，攒下我的收益后次日可领
  g.c.State.gainExp(600); g.c.State.addGold(150);
  g.advance(86400000);
  assert.ok(g.c.State.apprenticeDailyStatus(g.c.State.state().prentices[0]).exp > 0, '门下的收益日才有日供');
  assert.equal(g.c.State.claimApprenticeExp().ok, true, '次日领取前一天的日供');
  // 缺 since 的旧档：迁移到当天，当天领不了，且保留当日已领取标记
  g.memory.set(g.c.State.saveKey, JSON.stringify({ level: 20, prentices: [{ name: '旧徒弟', level: 20, lastExpDate: g.c.State.localDate() }] }));
  g.c.State.load();
  const p = g.c.State.state().prentices[0];
  assert.equal(p.since, g.c.State.localDate(), '缺日期旧档从迁移日开始');
  assert.equal(p.lastExpDate, g.c.State.localDate(), '保留当日已领取标记');
  assert.equal(g.c.State.claimApprenticeExp().ok, false, '迁移当天领不了');
});

test('收徒页面重入不再次收费，播放错误退款一次且迟到胜负回调不能收徒',()=>{
  const g=setup(),s=g.c.State.state();s.level=20;
  g.c.ClassicExtras.master('apprentice');const oldClick=g.node('master-recruit').onclick;oldClick();
  assert.equal(s.goldPoint,90);g.c.ClassicExtras.master('apprentice');g.click('master-recruit');oldClick();
  assert.equal(g.battles.length,1);assert.equal(s.goldPoint,90);
  const battle=g.battles[0];battle.opts.onError();battle.opts.onError();g.settle(0,0);
  assert.equal(s.goldPoint,100);assert.equal(s.prentices.length,0);assert.equal(s.exp,0);assert.equal(s.recruitChallenge,null);
  g.c.ClassicExtras.master('apprentice');g.click('master-recruit');assert.equal(g.battles.length,2);assert.equal(s.goldPoint,90);
});

test('刷新未完收徒挑战退费并使旧回调无效，换账号不把徒弟或奖励发到新档',()=>{
  const g=setup(),s=g.c.State.state();s.level=20;g.c.ClassicExtras.master('apprentice');g.click('master-recruit');
  assert.equal(g.saved().recruitChallenge.fee,10);g.c.State.load();const loaded=g.c.State.state();
  assert.equal(loaded.goldPoint,100);assert.equal(loaded.recruitChallenge,null);g.settle(0,0);assert.equal(loaded.prentices.length,0);
  g.c.ClassicExtras.master('apprentice');g.click('master-recruit');g.c.State.newGame('新档');g.settle(1,0);g.battles[1].opts.onError();
  assert.equal(g.c.State.state().goldPoint,100);assert.equal(g.c.State.state().prentices.length,0);assert.equal(g.c.State.state().exp,0);
});

test('有师父则挑战已有师父，无师父则挑战候选自己，收徒结果仍保存候选',()=>{
  const g=setup(),s=g.c.State.state();s.level=20;
  const candidate={name:'候选',level:5,power:10,agility:10,speed:10,hp:60,weapons:[],skills:[]};
  let start=g.c.State.beginRecruitChallenge(candidate);assert.equal(start.foe.name,'候选');g.c.State.cancelRecruitChallenge(start.token);
  candidate.master={name:'已有师父',level:25,power:40,agility:30,speed:25,hp:150,weapons:['3:1'],skills:[]};
  start=g.c.State.beginRecruitChallenge(candidate);assert.equal(start.foe.name,'已有师父');assert.equal(start.foe.level,25);
  const result=g.c.State.finishRecruitChallenge(start.token,true);assert.equal(result.recruited.name,'候选');assert.equal(result.recruited.level,5);
  assert.ok(result.recruited.skills.includes('13:1'));assert.equal(g.c.State.finishRecruitChallenge(start.token,true).ok,false);
  assert.equal(g.c.State.beginRecruitChallenge(candidate).ok,false);assert.equal(s.goldPoint,90);
});

test('收徒异步启动失败退费且恢复可再次挑战',async()=>{
  const g=setup(),s=g.c.State.state();s.level=20;g.c.Main.startBattle=async()=>{throw new Error('Missing resource');};
  g.c.ClassicExtras.master('apprentice');g.click('master-recruit');assert.equal(s.goldPoint,90);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(s.goldPoint,100);assert.equal(s.recruitChallenge,null);
  g.c.Main.startBattle=async(foe,opts)=>{g.battles.push({foe,opts});};
  g.c.ClassicExtras.master('apprentice');g.click('master-recruit');assert.equal(g.battles.length,1);assert.equal(s.goldPoint,90);
});

test('出师重复确认和换档遗留确认不重复扣20金松果',()=>{
  const g=setup(),s=g.c.State.state();g.c.State.setMaster({name:'师父',level:20});
  g.c.ClassicExtras.master('master');g.click('master-leave');const confirm=g.modals.at(-1).buttons[0].run;confirm();confirm();assert.equal(s.goldPoint,80);
  g.c.State.setMaster({name:'师父二',level:20});g.c.ClassicExtras.master('master');g.click('master-leave');const stale=g.modals.at(-1).buttons[0].run;
  g.c.State.newGame('新档');stale();assert.equal(g.c.State.state().goldPoint,100);assert.equal(g.c.State.state().master,null);
});

test('师徒存档文本经过转义，四个页面模板保持标签闭合', () => {
  const g = setup(), s = g.c.State.state();
  // 用真实写入接口构造带 html 的名字，属性也要正常显示
  g.c.State.setMaster({ name: '<img src=x onerror=alert(1)>', level: 9, power: 11, agility: 12, speed: 13, hp: 14, weapons: ['3:1'], skills: ['13:1'] });
  g.c.State.addPrentice({ name: '<script>bad()</script>', level: 8, power: 21, agility: 22, speed: 23, hp: 24, weapons: ['3:1'], skills: ['13:1'] });
  g.c.ClassicExtras.master('master'); const htmlMaster = g.page().html;
  assert.ok(htmlMaster.includes('&lt;img'), '师父名字被转义');
  assert.ok(htmlMaster.includes('&gt;11&lt;') || htmlMaster.includes('>11<'), '师父力量显示');
  g.c.ClassicExtras.master('apprentice'); const htmlApp = g.page().html;
  assert.ok(htmlApp.includes('&lt;script&gt;'), '徒弟名字被转义');
  assert.ok(htmlApp.includes('>24<') || htmlApp.includes('&gt;24&lt;'), '徒弟生命显示');
  g.c.ClassicExtras.arena(); s.level = 30; g.c.ClassicExtras.rank(); g.c.ClassicExtras.lottery();
  assertBalanced(g.markup);
});

test('超级松鼠（原版VIP）：金松果购买、体力上限+60、恢复倍率、装备格子与到期回收', () => {
  const g = setup(), s = g.c.State.state();
  const base = s.maxEnergy;
  s.goldPoint = 0;
  assert.equal(g.c.State.vipActive(), false);
  assert.equal(g.c.State.vipLevel(), 0);
  assert.equal(g.c.State.gearCapacity(), 100);
  assert.equal(g.c.State.buyVip(7).ok, false, '金松果不足不能买');
  s.goldPoint = 5000;
  const bought = g.c.State.buyVip(7);
  assert.equal(bought.ok, true);
  assert.equal(s.goldPoint, 5000 - 150, '7 天 150 金松果');
  assert.equal(g.c.State.vipActive(), true);
  assert.equal(g.c.State.vipDaysLeft(), 7);
  assert.equal(s.maxEnergy, g.c.State.energyCapForLevel(s.level) + 60, '特权8：当前等级上限 +60');
  assert.equal(g.c.State.gearCapacity(), 106, '特权5：永久 +6 装备格子');
  assert.equal(g.c.State.vipRegenMul(), 1.1, '1 级恢复 1.1 倍');
  // 每日首次登陆 +1 超级松鼠经验，重复调用不再加
  assert.equal(g.c.State.tickVipDaily().gained, true);
  assert.equal(s.vip.exp, 1);
  assert.equal(g.c.State.tickVipDaily().gained, false);
  // 10 级特权表
  g.c.State.grantVip(0, 10);
  assert.equal(g.c.State.vipLevel(), 10);
  assert.equal(g.c.State.vipRegenMul(), 1.5);
  assert.equal(g.c.State.vipPassiveExpCap(), 400);
  // 到期后上限与格子回到原值（用 1 而不是 Date.now()-1000，避免测试沙箱的假时钟偏差）
  s.vip.until = 1;
  g.c.State.syncVipEnergyCap();
  assert.equal(g.c.State.vipActive(), false);
  assert.equal(s.maxEnergy, base, '到期退回原上限');
  assert.equal(g.c.State.gearCapacity(), 100);
  // 续期累加而不是覆盖
  s.goldPoint = 5000;
  g.c.State.buyVip(7); const first = g.c.State.vipUntil();
  g.c.State.buyVip(30);
  assert.ok(g.c.State.vipUntil() > first + 29 * 86400000, '续期在剩余时间上累加');
});

test('排行榜：离线模拟、包含自己、三个排序都成立', () => {
  const g = setup(), s = g.c.State.state();
  s.level = 33; s.goldCup = 9; s.integral = 1234; s.name = '测试鼠';
  g.c.ClassicExtras.toplist();
  const html = g.page().html;
  assert.match(html, /排行榜/);
  assert.match(html, /我的名次/);
  assert.match(html, /测试鼠/);
  assert.match(html, /Lv 33/, '自己那一行按等级显示');
  assert.match(html, /1234/, '自己的天梯积分出现');
  assert.match(html, /data-action="cup"/, '三个排序分页都在');
  assert.match(html, /离线模拟/, '明确标注为单机离线模拟');
  // 33 级够天梯门槛：自己那一行带真实金杯与积分
  assert.match(html, /测试鼠（我）<\/span><span class="toplist-lv">Lv 33<\/span><span class="toplist-cup">9 金杯<\/span><span class="toplist-score">1234<\/span>/,
    '够级时自己那一行显示金杯与积分');
  assertBalanced(g.markup);

  // 天梯赛 30 级才开启：不够级时自己的金杯与积分留空，也不进天梯榜
  const low = setup(), ls = low.c.State.state();
  ls.level = 20; ls.goldCup = 9; ls.integral = 1234; ls.name = '小松鼠';
  low.c.ClassicExtras.toplist();
  const lowLvHtml = low.page().html;        // 默认的等级榜
  // 不满 30 级的 NPC 不能带金杯与积分（只有够级的松鼠才有）
  const lvRows = [...lowLvHtml.matchAll(/<span class="toplist-lv">Lv (\d+)<\/span><span class="toplist-cup">([^<]*)<\/span><span class="toplist-score">([^<]*)<\/span>/g)]
    .map((m) => ({ level: Number(m[1]), cup: m[2], score: m[3] }));
  assert.ok(lvRows.length >= 10, '等级榜应该有足够多行可检查，实际 ' + lvRows.length);
  const under30 = lvRows.filter((row) => row.level < 30);
  assert.ok(under30.length > 0, '20 级视角下确实会出现不满 30 级的对手');
  assert.ok(under30.every((row) => row.cup === '—' && row.score === '—'),
    '不满 30 级的对手不能有金杯与积分：' + JSON.stringify(under30.slice(0, 3)));
  const over30 = lvRows.filter((row) => row.level >= 30);
  assert.ok(over30.length > 0, '20 级视角下也有够级的对手');
  assert.ok(over30.every((row) => /金杯/.test(row.cup) && /^\d+$/.test(row.score)),
    '够级的对手才有金杯与积分：' + JSON.stringify(over30.slice(0, 3)));
  assert.ok(lvRows.every((row) => row.level <= 70), '排行榜对手也不能超过满级 70');
  low.click('cup');                       // 切到金杯榜
  const lowHtml = low.page().html;
  assert.match(lowHtml, /未参赛/, '不够级显示未参赛');
  assert.match(lowHtml, /天梯赛需要 30 级才能参加/, '给出等级门槛说明');
  assert.match(lowHtml, /小松鼠（我）<\/span><span class="toplist-lv">Lv 20<\/span><span class="toplist-cup">—<\/span><span class="toplist-score">—<\/span>/,
    '不够级时自己那一行两列都是破折号');
  assert.match(lowHtml, /toplist-row me unranked/, '不够级的自己标记为未上榜');
  assertBalanced(low.markup);
});

test('VIP 页面：显示原版 8 条特权与两档价格，不删除系统页原有分页', () => {
  const g = setup();
  g.c.State.state().goldPoint = 5000;
  g.c.ClassicExtras.vip();
  const vipHtml = g.page().html;
  assert.match(vipHtml, /超级松鼠/);
  assert.match(vipHtml, /\u4e0d\u4f1a\u91cd\u7f6e/, '未开通时也要写明等级不会重置');
  assert.match(vipHtml, /体力上限 \+60/);
  assert.match(vipHtml, /7 \u5929[\s\S]*?150/, '7 天 150 金松果');
  assert.match(vipHtml, /30 \u5929[\s\S]*?500/, '30 天 500 金松果');
  assert.match(vipHtml, /被动经验上限/);
  assertBalanced(g.markup);
});

(async()=>{
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS', name); }
    catch (error) { failed++; console.error('FAIL', name, error.stack); }
  }
  console.log(`${tests.length - failed}/${tests.length} extras tests passed`);
  process.exitCode = failed ? 1 : 0;
})();
