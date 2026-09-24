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

test('经验竞技冠亚季四名分别150/75/25/0，半决赛落败必须再打季军赛', () => {
  for (const [semiWin, secondWin, reward, place] of [[0, 0, 150, '冠军'], [0, 1, 75, '亚军'], [1, 0, 25, '季军'], [1, 1, 0, '第四名']]) {
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
  // 碎片场不给经验，也不消耗药丸
  {
    const g = setup(), s = g.c.State.state();
    s.propsStates[7] = 20; s.energy = 0; s.props[39] = 1; enterArena(g, 1);
    g.settle(0, 0); g.modalClick(); g.settle(1, 0); g.settle(1, 0);
    assert.equal(s.exp, 0); assert.equal(s.propsStates[7], 20, '碎片场不消耗经验丸');
  }
});

test('碎片竞技四名分别8/6/4/3蓝片，不混发经验或金松果，票据仅扣一次', () => {
  for (const [semiWin, secondWin, shards] of [[0, 0, 8], [0, 1, 6], [1, 0, 4], [1, 1, 3]]) {
    const g = setup(), s = g.c.State.state(); s.energy = 0; s.props[39] = 1;
    enterArena(g, 1); assert.equal(s.props[39], 0); assert.equal(s.energy, 0);
    g.settle(0, semiWin); g.modalClick(); g.settle(1, secondWin); g.settle(1, secondWin);
    assert.equal(s.props[26], shards); assert.equal(s.goldPoint, 100); assert.equal(s.exp, 0);
  }
  const poor = setup(); poor.c.State.state().energy = 29; enterArena(poor, 0);
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
  g.settle(2, 0); assert.equal(s.exp, 25); assert.equal(s.classicArenaRun, null);
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

test('天梯周一至周六比赛、商店仅周日，跨日旧按钮仍重新校验', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30;
  g.c.ClassicExtras.rank(); g.click('rank-shop'); assert.match(g.modals.at(-1).html, /每周日/);
  const stale = g.node('rank-fight').onclick;
  g.advance(4 * 86400000); stale(); assert.equal(g.battles.length, 0);
  g.c.ClassicExtras.rank(); assert.equal(g.node('rank-fight').disabled, true);
  g.click('rank-shop'); assert.match(g.page().html, /data-goods/);
  g.advance(86400000); g.c.ClassicExtras.rank(); assert.equal(g.node('rank-fight').disabled, false);
  g.click('rank-fight'); assert.equal(g.battles.length, 1);
});

test('周日兑换校验积分与两种货币，不扣积分，每周限一件并在下周重置', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30; s.integral = 1900; s.goldCup = 1000; s.goldPoint = 500;
  g.advance(4 * 86400000); g.c.ClassicExtras.rank(); g.click('rank-shop'); g.click('rank-shop-next');
  const choose = () => g.page().querySelector('[data-goods="11"]').onclick();
  choose(); g.modalClick(); assert.equal(s.goldCup, 1000); assert.equal(s.goldPoint, 500); assert.equal(s.gears.length, 0);
  s.integral = 2000; choose(); const confirm = g.modals.at(-1).buttons[0].run; confirm(); confirm();
  assert.equal(s.goldCup, 0); assert.equal(s.goldPoint, 300); assert.equal(s.gears[0].id, 201); assert.equal(s.rankPurchases[11], 1); assert.equal(s.integral, 2000);
  s.goldCup = 2000; choose(); g.modalClick(); assert.equal(s.gears.length, 1); assert.equal(s.goldPoint, 300);
  g.c.State.save(); g.c.State.load(); const loaded = g.c.State.state();
  g.c.ClassicExtras.rankShop(); g.click('rank-shop-next'); choose(); g.modalClick(); assert.equal(loaded.gears.length, 1);
  g.advance(7 * 86400000); g.c.ClassicExtras.rankShop(); g.click('rank-shop-next'); choose(); g.modalClick();
  assert.equal(loaded.gears.length, 2); assert.equal(loaded.goldPoint, 100); assert.equal(loaded.goldCup, 1000); assert.equal(loaded.rankPurchases[11], 1);
  assertBalanced(g.markup);
});

test('周日跨午夜确认禁止兑换，未标日期的旧购买计数保留到本周结束', () => {
  const g = setup(), s = g.c.State.state(); s.level = 30; s.integral = 2000; s.goldCup = 4000; s.goldPoint = 1000;
  s.rankPurchases = { 11: 1 }; g.advance(4 * 86400000);
  g.c.ClassicExtras.rankShop(); g.click('rank-shop-next');
  g.page().querySelector('[data-goods="11"]').onclick(); g.modalClick(); assert.equal(s.gears.length, 0);
  g.page().querySelector('[data-goods="12"]').onclick(); g.advance(86400000); g.modalClick();
  assert.equal(s.goldCup, 4000); assert.equal(s.goldPoint, 1000); assert.equal(s.gears.length, 0);
  assert.match(g.modals.at(-1).html, /商店已休息/);
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

test('徒弟日贡按昨日活动产出，新增当天不能领，次日只领一次且踢人每天一次', () => {
  const g = setup(), s = g.c.State.state();
  s.level = 20; s.exp = 0;
  g.c.State.addPrentice({name:'甲',level:10});g.c.State.addPrentice({name:'乙',level:20});
  assert.equal(g.c.State.apprenticeDailyTotal(),0);assert.equal(g.c.State.claimApprenticeExp().ok,false);
  g.advance(86400000);
  const perA = g.c.State.apprenticeDailyExp(s.prentices[0]);
  const perB = g.c.State.apprenticeDailyExp(s.prentices[1]);
  assert.ok(perA>0&&perB>0);
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

test('收徒金松果不足不启动，零体力可以收徒，落败消耗一次药剂状态', () => {
  const g = setup(), s = g.c.State.state(); s.energy = 0;s.goldPoint=9;
  g.c.ClassicExtras.master('apprentice'); g.click('master-recruit'); assert.equal(g.battles.length, 0); assert.equal(s.goldPoint,9);
  s.goldPoint = 10; s.propsStates[3] = 20; g.c.ClassicExtras.master('apprentice'); g.click('master-recruit');
  g.settle(0, 1); g.settle(0, 1);
  assert.equal(s.energy, 0);assert.equal(s.goldPoint,0); assert.equal(s.prentices.length, 0); assert.equal(s.exp, 0); assert.equal(s.propsStates[3], 19);
});

test('日贡严格按普通及关卡10%和体力竞技5%，排除拾取抽奖与英雄帖竞技',()=>{
  const g=setup();
  const activities=[{kind:'challenge',exp:100},{kind:'challenged',exp:50},{kind:'stage',exp:30},{kind:'arena',entry:'energy',exp:200},
    {kind:'arena',entry:'ticket',exp:900},{kind:'pickup',exp:900},{kind:'lottery',exp:900}];
  assert.equal(g.c.State.apprenticeTribute(activities),28);
  assert.equal(g.c.State.apprenticeTribute([{kind:'challenge',exp:19},{kind:'arena',entry:'energy',exp:1}]),1);
  const s=g.c.State.state();s.level=20;g.c.State.addPrentice({name:'账目徒弟',level:15});const p=s.prentices[0];
  p.since='2026-09-22';p.joinedAt=new g.c.Date(2026,8,22).getTime();p.tributeLedger=[{date:'2026-09-22',simulated:true,activities}];
  g.c.State.save();g.c.ClassicExtras.master('apprentice');
  assert.equal(g.c.State.apprenticeDailyTotal(),28);assert.match(g.page().html,/离线活动账目/);assert.match(g.page().html,/不计日贡/);
  g.click('master-claim');assert.equal(s.exp,28);assert.equal(p.tributeClaimedDate,'2026-09-22');
  assert.equal(g.c.State.claimApprenticeExp().ok,false);assert.equal(g.c.State.apprenticeDailyTotal(),0);
  g.c.State.load();assert.equal(g.c.State.claimApprenticeExp().ok,false);assert.equal(g.c.State.state().exp,28);assertBalanced(g.markup);
});

test('本地昨日日贡账目持久稳定，只有入门后的活动，读页面不重抽且不减徒弟经验',()=>{
  const g=setup(),s=g.c.State.state();s.level=20;g.c.State.addPrentice({name:'下午入门',level:20});
  const p=s.prentices[0];p.exp=123;
  assert.equal(g.c.State.apprenticeDailyStatus(p).newApprentice,true);assert.equal(g.c.State.claimApprenticeExp().ok,false);
  g.advance(86400000);const daily=g.c.State.apprenticeDailyStatus(p);
  assert.ok(daily.activities.length>0&&daily.activities.length<=8);assert.equal(daily.date,'2026-09-23');assert.ok(daily.exp>0);
  assert.ok(daily.activities.every(a=>a.at>=p.joinedAt));assert.ok(daily.activities.every(a=>new g.c.Date(a.at).getHours()>=15));
  const snapshot=JSON.parse(JSON.stringify(daily));g.math.random=()=>.99999;
  assert.deepEqual(JSON.parse(JSON.stringify(g.c.State.apprenticeDailyStatus(p))),snapshot);
  g.c.State.save();g.c.State.load();const loaded=g.c.State.state().prentices[0];
  assert.deepEqual(JSON.parse(JSON.stringify(g.c.State.apprenticeDailyStatus(loaded))),snapshot);
  assert.equal(g.c.State.claimApprenticeExp().total,daily.exp);assert.equal(loaded.exp,123);
  const claimedExp=g.c.State.state().exp;assert.equal(g.c.State.claimApprenticeExp().ok,false);assert.equal(g.c.State.state().exp,claimedExp);
  g.advance(86400000);const next=g.c.State.apprenticeDailyStatus(loaded);assert.equal(next.date,'2026-09-24');assert.equal(next.claimed,false);
  assert.equal(loaded.tributeLedger.length,2);
});

test('深夜新收徒不会补算入门前活动，缺日期旧档从迁移日开始且保留当日已领取标记',()=>{
  const g=setup();g.advance((8*60+59)*60000);g.c.State.addPrentice({name:'深夜',level:20});
  g.advance(120000);assert.equal(g.c.State.apprenticeDailyTotal(),0);assert.equal(g.c.State.claimApprenticeExp().ok,false);
  assert.equal(g.c.State.apprenticeDailyStatus(g.c.State.state().prentices[0]).activities.length,0);
  g.memory.set(g.c.State.saveKey,JSON.stringify({level:20,prentices:[{name:'旧徒弟',level:20,lastExpDate:g.c.State.localDate()}]}));
  g.c.State.load();const p=g.c.State.state().prentices[0];assert.equal(p.since,g.c.State.localDate());assert.equal(g.c.State.claimApprenticeExp().ok,false);
  g.advance(86400000);assert.ok(g.c.State.apprenticeDailyStatus(p).exp>0);assert.equal(g.c.State.claimApprenticeExp().ok,true);
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

(async()=>{
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS', name); }
    catch (error) { failed++; console.error('FAIL', name, error.stack); }
  }
  console.log(`${tests.length - failed}/${tests.length} extras tests passed`);
  process.exitCode = failed ? 1 : 0;
})();
