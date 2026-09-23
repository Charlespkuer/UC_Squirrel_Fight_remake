/*
 * Run: node tools/test-extras.cjs
 * Isolated action tests use the shipped dictionaries, State and Sim. The small
 * DOM adapter supplies event targets; visual layout remains a browser QA check.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const rootDir = path.resolve(__dirname, '..');

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
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js', 'js/sim.js']) {
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

test('竞技两战只付一次报名费用，半决赛与冠军回调只结算一次', () => {
  const g = setup(), s = g.c.State.state();
  enterArena(g, 0); assert.equal(s.energy, 70); assert.equal(g.battles.length, 1);
  g.settle(0, 0);
  const modalCount = g.modals.length;
  g.settle(0, 0); assert.equal(g.modals.length, modalCount); assert.equal(s.exp, 0);
  g.modalClick(); assert.equal(s.energy, 70); assert.equal(g.battles.length, 2);
  g.settle(1, 0); assert.equal(s.goldPoint, 110); assert.equal(s.level, 3); assert.equal(s.exp, 70);
  const saved = JSON.stringify(g.saved());
  g.settle(1, 0); assert.equal(JSON.stringify(g.saved()), saved);
  assert.equal(g.battles[0].opts.kind, 'arena'); assert.equal(g.battles[1].opts.useProps, false);
  assertBalanced(g.markup);
});

test('竞技半决赛落败仅发10经验，决赛落败发75经验', () => {
  const semi = setup(); enterArena(semi, 0); semi.settle(0, 1); semi.settle(0, 1);
  assert.equal(semi.c.State.state().exp, 10); assert.equal(semi.c.State.state().goldPoint, 100);
  const final = setup(); enterArena(final, 0); final.settle(0, 0); final.modalClick(); final.settle(1, 1); final.settle(1, 1);
  assert.equal(final.c.State.state().level, 2); assert.equal(final.c.State.state().exp, 55);
  assert.equal(final.c.State.state().energy, 70); assert.equal(final.c.State.state().goldPoint, 100);
});

test('竞技票据抵扣、碎片冠军奖励和体力不足校验', () => {
  const g = setup(), s = g.c.State.state(); s.energy = 0; s.props[39] = 1;
  enterArena(g, 1); assert.equal(s.props[39], 0); assert.equal(s.energy, 0);
  g.settle(0, 0); g.modalClick(); g.settle(1, 0); g.settle(1, 0);
  assert.equal(s.props[26], 8); assert.equal(s.goldPoint, 100); assert.equal(s.level, 2); assert.equal(s.exp, 10);
  const poor = setup(); poor.c.State.state().energy = 29; enterArena(poor, 0);
  assert.equal(poor.battles.length, 0); assert.equal(poor.c.State.state().energy, 29);
});

test('竞技稍后继续决赛不会再次报名扣款', () => {
  const g = setup(); enterArena(g, 0); g.settle(0, 0); g.modalClick(1);
  g.click('arena-resume'); assert.equal(g.battles.length, 2); assert.equal(g.c.State.state().energy, 70);
  g.settle(1, 0); assertBalanced(g.markup);
});

test('天梯30级门槛、胜负积分和金杯奖励、防双击与重复回调', () => {
  const g = setup(), s = g.c.State.state(); g.math.random = () => 0.5;
  g.c.ClassicExtras.rank(); assert.equal(g.battles.length, 0); assert.equal(s.integral, null);
  s.level = 30; g.c.ClassicExtras.rank();
  const handler = g.node('rank-fight').onclick; handler(); handler();
  assert.equal(g.battles.length, 1); assert.equal(s.joinRankCount, 1);
  assert.equal(s.energy, 100); assert.equal(s.goldPoint, 100); // This offline ladder has no entry fee.
  g.settle(0, 0); g.settle(0, 0);
  assert.equal(s.integral, 1527); assert.equal(s.goldCup, 5); assert.equal(s.exp, 30);
  g.c.ClassicExtras.rank(); g.click('rank-fight'); g.settle(1, 1); g.settle(1, 1);
  assert.equal(s.integral, 1512); assert.equal(s.goldCup, 6); assert.equal(s.exp, 40);
  assert.equal(s.joinRankCount, 2); assert.equal(g.battles[0].opts.kind, 'rank');
  assertBalanced(g.markup);
});

test('金杯商店校验积分及两种货币，正确兑换原装备且不超兑换限额', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30; s.integral = 1900; s.goldCup = 1000; s.goldPoint = 500;
  g.c.ClassicExtras.rank(); g.click('rank-shop'); g.click('rank-shop-next');
  const choose = () => g.page().querySelector('[data-goods="11"]').onclick();
  choose(); g.modalClick(); assert.equal(s.goldCup, 1000); assert.equal(s.goldPoint, 500); assert.equal(s.gears.length, 0);
  s.integral = 2000; choose(); g.modalClick();
  assert.equal(s.goldCup, 0); assert.equal(s.goldPoint, 300); assert.equal(s.gears[0].id, 201); assert.equal(s.rankPurchases[11], 1);
  s.goldCup = 2000; choose(); g.modalClick();
  assert.equal(s.gears.length, 1); assert.equal(s.goldCup, 2000); assert.equal(s.goldPoint, 300);
  assertBalanced(g.markup);
});

test('抽奖首抽免费、防双击，付费经验奖扣20并真正升级', () => {
  const g = setup(), s = g.c.State.state(); g.math.random = () => 0;
  g.c.ClassicExtras.lottery(); const first = g.node('lottery-spin').onclick; first(); first();
  assert.equal(s.props[22], 10); assert.equal(s.lotteryFree, 0); assert.equal(s.goldPoint, 100);
  g.flushTimers(); g.math.random = () => 0.35; g.click('lottery-spin');
  assert.equal(s.goldPoint, 80); assert.equal(s.level, 2); assert.equal(s.exp, 30);
  g.flushTimers(); assert.equal(g.saved().goldPoint, 80); assertBalanced(g.markup);
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

test('收徒上限随师父等级 1/2/3，收徒仅扣10体力且重复调用不多发徒弟', () => {
  const g = setup(), s = g.c.State.state();
  assert.equal(g.c.State.apprenticeCap(5), 1);
  assert.equal(g.c.State.apprenticeCap(10), 2);
  assert.equal(g.c.State.apprenticeCap(19), 2);
  assert.equal(g.c.State.apprenticeCap(20), 3);
  s.level = 5;
  g.c.ClassicExtras.master('apprentice');
  const handler = g.node('master-recruit').onclick; handler(); handler();
  assert.equal(s.energy, 90); assert.equal(g.battles.length, 1);
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

test('徒弟日贡按等级产出且每天只能领一次，师父每天只能踢一个徒弟', () => {
  const g = setup(), s = g.c.State.state();
  s.level = 20; s.exp = 0;
  s.prentices = [{ name: '甲', level: 10 }, { name: '乙', level: 20 }];
  const perA = g.c.State.apprenticeDailyExp(10);
  const perB = g.c.State.apprenticeDailyExp(20);
  assert.ok(perB > perA, '等级越高日贡越多');
  assert.equal(g.c.State.apprenticeDailyTotal(), perA + perB);
  const expBefore = s.exp;
  const r = g.c.State.claimApprenticeExp();
  assert.ok(r.ok && r.count === 2 && r.total === perA + perB, JSON.stringify(r));
  assert.equal(s.exp, expBefore + perA + perB, '日贡经验加到师父身上');
  assert.ok(!g.c.State.claimApprenticeExp().ok, '同一天不能再领');
  // 踢人每天 1 次
  assert.ok(g.c.State.canKickToday());
  assert.ok(g.c.State.kickPrentice('甲').ok);
  assert.ok(!g.c.State.canKickToday(), '当天不能再踢');
  assert.ok(!g.c.State.kickPrentice('乙').ok, '当天第二次踢人被拒绝');
  assert.equal(s.prentices.length, 1);
  assertBalanced(g.markup);
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

test('收徒不足体力不启动，落败不收徒并消耗一次药剂状态', () => {
  const g = setup(), s = g.c.State.state(); s.energy = 9;
  g.c.ClassicExtras.master('apprentice'); g.click('master-recruit'); assert.equal(g.battles.length, 0); assert.equal(s.energy, 9);
  s.energy = 10; s.propsStates[3] = 20; g.c.ClassicExtras.master('apprentice'); g.click('master-recruit');
  g.settle(0, 1); g.settle(0, 1);
  assert.equal(s.energy, 0); assert.equal(s.prentices.length, 0); assert.equal(s.exp, 0); assert.equal(s.propsStates[3], 19);
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

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS', name); }
  catch (error) { failed++; console.error('FAIL', name, error.stack); }
}
console.log(`${tests.length - failed}/${tests.length} extras tests passed`);
process.exitCode = failed ? 1 : 0;
