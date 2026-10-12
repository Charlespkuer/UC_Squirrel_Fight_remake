/* Run with: node tools/test-state.cjs. Uses the original dictionary and isolated saves. */
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
function game(search) {
  const storage = new Map();
  let now = new Date(2026, 8, 23, 23, 55).getTime();
  let seed = 617;
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = {
    Date: TestDate,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  };
  if (search !== undefined) context.location = { search };
  context.window = context;
  vm.createContext(context);
  for (const file of ['js/gamedict.js', 'js/gamedata.js', 'js/state.js', 'js/sim.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const math = vm.runInContext('Math', context);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  context.State.newGame('测试松鼠');
  // ctx 是 vm 里的真·全局对象（写 window.Debug 这类开关要用它，展开出来的只是拷贝）
  return { ...context, ctx: context, storage, math, advance: (ms) => { now += ms; } };
}
const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const tests = [];
function test(name, run) { tests.push([name, run]); }

test('浏览器 QA 和自检存档隔离，正式存档不会被测试覆盖', () => {
  for (const search of ['?test=1', '?test=2', '?qa=1', '?view=home&test=1', '?qa=1&screen=bag']) {
    const g = game(search);
    const original = JSON.stringify({ name: '正式玩家', level: 30, goldPoint: 888 });
    g.storage.set('ssdz_save_v1', original);
    assert.equal(g.State.saveKey, 'ssdz_test_save_v1');
    g.State.newGame('自动测试'); g.State.claimDaily(); g.State.save();
    assert.equal(g.storage.get('ssdz_save_v1'), original);
    assert.equal(JSON.parse(g.storage.get('ssdz_test_save_v1')).name, '自动测试');
    assert.equal(g.State.load(), true); assert.equal(g.State.state().name, '自动测试');
  }
  for (const search of [undefined, '', '?test=12', '?test=1x', '?qa=0', '?contest=1']) {
    const g = game(search);
    assert.equal(g.State.saveKey, 'ssdz_save_v1');
    assert.ok(g.storage.has('ssdz_save_v1')); assert.equal(g.storage.has('ssdz_test_save_v1'), false);
  }
});

test('单个道具数量上限 9999：存档收口、读档也会夹住', () => {
  const g = game(), S = g.State, s = S.state();
  assert.equal(S.PROP_HARD_CAP, 9999);
  // 内存里加爆也会在 save() 时收口
  s.props[1] = 99999; s.props[2] = 9999; s.props[23] = 10000;
  S.save();
  assert.equal(s.props[1], 9999);
  assert.equal(s.props[2], 9999);
  assert.equal(s.props[23], 9999);
  assert.equal(JSON.parse(g.storage.get(S.saveKey)).props[1], 9999);
  // 负数与非数字会被清掉，不会写进存档
  s.props[24] = -5; s.props[25] = 'abc';
  S.save();
  assert.equal(s.props[24], undefined);
  assert.equal(s.props[25], undefined);
  // 旧档里超上限的数量在 normalizeSave 时也会被夹住
  g.storage.set(S.saveKey, JSON.stringify({ level: 5, props: { 1: 50000, 26: 12 } }));
  S.load();
  const loaded = S.state();
  assert.equal(loaded.props[1], 9999);
  assert.equal(loaded.props[26], 12);
  // 未到上限的正常数量原样保留
  assert.equal(loaded.props[1] + loaded.props[26], 10011);
});

test('卖出道具：默认回收字典价格的一半，无价/占位价的道具不开放回收', () => {
  const g = game(), S = g.State, s = S.state();
  // 商店里买得到的：半价（向下取整）
  assert.equal(S.propSellPrice(1), 1, '小体力药剂 3 → 1');
  assert.equal(S.propSellPrice(2), 3, '大体力药剂 6 → 3（售价已上调到 6 金松果）');
  assert.equal(S.propSellPrice(3), 10, '大力丸 20 → 10');
  assert.equal(S.propSellPrice(23), 10, '挑战书 20 → 10');
  assert.equal(S.propSellPrice(13), 150, '转生果 300 → 150');
  assert.equal(S.propSellPrice(47), 100, '天使果实 200 → 100（旧规则就是这个价）');
  assert.equal(S.propSellPrice(37), 500, '属性书 1000 → 500');
  assert.equal(S.propSellPrice(101), 10, '宝石 20 → 10');
  // 第 2 项：恶魔果实字典里没有售价，单独定价 100 金松果回收
  assert.equal(S.propSellPrice(48), 100, '恶魔果实单独定价 100');
  // 第 3 项：武器/技能卷轴单独定价 2 金松果一张
  assert.equal(S.propSellPrice(22), 2, '武器卷轴 2 金松果一张');
  assert.equal(S.propSellPrice(21), 2, '技能卷轴 2 金松果一张');
  // 转化丸（10/11/12 力量/敏捷/速度）：字典价 240 → 半价 120，三颗都能卖
  for (const id of [10, 11, 12]) assert.equal(S.propSellPrice(id), 120, id + ' 转化丸半价 120');
  // 字典里 price 为 0 或占位 1 的（碎片/礼包/天梯碎片/种子/超级药丸）不开放回收
  for (const id of [6, 9, 16, 24, 25, 26, 28, 32, 40, 41, 44, 45, 46, 49, 50, 51]) {
    assert.equal(S.propSellPrice(id), 0, id + ' 不该可卖');
  }
  assert.equal(S.sellProp(46, 1).ok, false, '不能卖的道具会被拒');
  const ids = S.sellableProps();
  assert.ok(ids.includes(47) && ids.includes(2) && ids.includes(101), '可卖清单含药水/果实/宝石');
  assert.ok(ids.length >= 20, '大部分标了价的道具都能卖：' + ids.length + ' 种');
  assert.ok(ids.every((id) => S.propSellPrice(id) > 0));
  // 结算：数量与金松果一起走，超过持有会被夹住，卖光后键被删掉
  assert.equal(S.sellProp(47, 3).ok, false, '背包里没有就不给卖');
  s.props[47] = 5; s.goldPoint = 10;
  const r = S.sellProp(47, 2);
  assert.equal(r.ok, true); assert.equal(r.sold, 2); assert.equal(r.gold, 200);
  assert.equal(s.props[47], 3); assert.equal(s.goldPoint, 210);
  const all = S.sellProp(47, 99);
  assert.equal(all.sold, 3); assert.equal(s.props[47], undefined); assert.equal(s.goldPoint, 510);
  assert.equal(S.sellProp(47, 1).ok, false);
  assert.equal(JSON.parse(g.storage.get(S.saveKey)).props[47], undefined);
  // 药水按半价卖
  s.props[1] = 4; s.goldPoint = 0;
  const small = S.sellProp(1, 4);
  assert.equal(small.gold, 4); assert.equal(s.goldPoint, 4); assert.equal(s.props[1], undefined);
});

test('背包的卖出弹窗：三种转化丸都能真的卖掉，且卖完退回背包（同天使/恶魔果实，不回主界面）', () => {
  const g = game(), S = g.State, s = S.state();
  /* 把 classic-ui.js 里**真实的 sellDialog** 抠出来，用桩跑一遍。
   * 2026-10 的 bug：函数里写的是裸的 `bagCountOf(id)`，而 classic-ui 里根本没有这个全局
   * （真名是 State.bagCountOf），于是点「卖出」第一行就 ReferenceError ——
   * **所有**道具都卖不掉（玩家看到的是敏捷/速度转化丸卖不出去）。
   * 桩里**故意不提供** bagCountOf 这类全局，逼它自己通过 State 解析 —— 再写回裸标识符就会红。
   * 2026-10 第二个口径（用户点名的）：这几样卖完要退回**背包**（上一级界面），
   * 早先误写成 home()（回主界面）—— 玩家观感是「卖一个就被踢出背包回主页」。 */
  const ui = fs.readFileSync(path.join(root, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = ui.indexOf('function sellDialog(');
  assert.ok(at > 0, 'classic-ui.js 里应该有 sellDialog');
  const fn = ui.slice(at, ui.indexOf('\n  }', at) + 4);
  /* 「卖一个就退出去」的名单也从源码里读出来（它在 IIFE 里，没导出）——
   * 这样断言的是**真实名单**：谁把转化丸从名单里去掉，下面退回背包那条就会红。 */
  const listMatch = ui.match(/const SELL_LEAVE_IDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(listMatch, 'classic-ui.js 里应该有 SELL_LEAVE_IDS');
  const SELL_LEAVE_IDS = listMatch[1].split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
  for (const id of [10, 11, 12, 47, 48]) {
    assert.ok(SELL_LEAVE_IDS.includes(id), id + ' 应当在「卖一个就退出去」的名单里：' + JSON.stringify(SELL_LEAVE_IDS));
  }
  const opened = [], left = { closed: 0, home: 0, back: 0 };
  const ctx = {
    State: S, propMap: g.propMap, SELL_LEAVE_IDS,
    esc: (v) => String(v == null ? '' : v), icon: () => '', toast: () => {}, $: () => null,
    home: () => { left.home++; },
    modal: (title, content, buttons) => {
      opened.push({ title, content, buttons });
      return { element: { querySelector: () => null, querySelectorAll: () => [] }, close() { left.closed++; } };
    },
  };
  vm.createContext(ctx);
  const sellDialog = vm.runInContext(fn + '\nsellDialog;', ctx, { filename: 'sellDialog.js' });
  /* 三种转化丸（120）与天使果实 47（100）走同一条路径：点「卖出」→ 扣 1 个 / 加钱 /
   * 关掉卖出弹窗 / 退回**背包**（调用 after()，也就是背包那条重绘回调）；**不能**调 home()。 */
  for (const [id, gold] of [[10, 120], [11, 120], [12, 120], [47, 100]]) {
    s.props[id] = 2; s.goldPoint = 0; opened.length = 0; left.closed = 0; left.home = 0; left.back = 0;
    sellDialog(id, () => { left.back++; });
    assert.equal(opened.length, 1, id + ' 应当打开卖出弹窗');
    assert.match(opened[0].title, /卖出道具/);
    assert.match(opened[0].content, new RegExp('可回收 ' + gold), id + ' 弹窗里要写清回收价');
    const btn = opened[0].buttons.find((b) => b.label === '卖出');
    assert.ok(btn && btn.run, id + ' 弹窗里要有「卖出」按钮');
    btn.run();
    assert.equal(S.state().props[id], 1, id + ' 卖一个扣一个');
    assert.equal(S.state().goldPoint, gold, id + ' 卖一个给 ' + gold + ' 金松果');
    assert.equal(left.closed, 1, id + ' 卖完要关掉卖出弹窗');
    assert.equal(left.back, 1, id + ' 卖完要退回背包（调用 after() 重绘背包）');
    assert.equal(left.home, 0, id + ' 卖完**不能**回主界面（home() 是回主页，不是「上一级界面」）');
  }
});

test('橙装的「镶嵌 / 取下宝石」必须真的出现在详情弹窗里（按钮行不能被挤到画布外）', () => {
  const g = game(), S = g.State, s = S.state();
  s.level = 70; s.goldPoint = 100000;
  /* 用真实融合做一件橙装：三件同部位同品质（紫）→ 传说。
   * 2026-10 用户报「橙装的镶嵌与取下宝石功能消失了」——代码里其实一直都在，
   * 是**按钮排被挤出可视区**：橙装详情比普通装备多一颗「镶嵌/卸下宝石（5金）」，
   * 加上「星标」后按钮从一行变两行，而弹窗 max-height:625px 会把第二行顶到画布
   * （1170x690）下沿之外（用 headless Chrome 量过：第二行 top=716 bottom=780）。
   * 所以这条用例同时钉住两件事：①按钮真的生成；②正文有限高，按钮排不会被顶出去。 */
  const all = [];
  g.ctx.__gears = all;
  vm.runInContext('gearMap.each(function (k, v) { __gears.push({ id: Number(v.id), type: Number(v.type) }); })', g.ctx);
  const byPartQ = new Map();
  for (const it of all) {
    const key = it.type + ':' + S.gearPartQuality(it.id);
    if (!byPartQ.has(key)) byPartQ.set(key, []);
    byPartQ.get(key).push(it.id);
  }
  let orangeKey = null;
  for (const [key, ids] of byPartQ) {
    if (!key.endsWith(':3') || ids.length < 3) continue;
    const keys = ids.slice(0, 3).map((id) => S.addGear(id, S.randomExt(3)).key);
    const r = S.mergeGears(keys);
    if (r.ok) { orangeKey = r.gear.key; break; }
  }
  assert.ok(orangeKey, '应当能靠三件紫装融合出一件橙装');
  assert.equal(s.gears.find((x) => x.key === orangeKey).orange, true, '融合产物必须带 orange 标记（否则界面不给宝石按钮）');

  /* 把真实的 openGear 抠出来跑：没宝石时要给「镶嵌宝石」，镶上之后要变「卸下宝石」。 */
  const ui = fs.readFileSync(path.join(root, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = ui.indexOf('function openGear(key)');
  assert.ok(at > 0, 'classic-ui.js 里应该有 openGear');
  const fn = ui.slice(at, ui.indexOf('\n  }', at) + 4);
  const openGear = (key) => {
    const seen = [];
    const ctx = {
      State: S, propMap: g.propMap, esc: (v) => String(v == null ? '' : v), icon: () => '',
      gearImg: () => '<img>', setBonusBlock: () => '', toast: () => {}, notice: () => {},
      gearPage: 0, openGears: () => {},
      modal: (title, content, buttons) => { seen.push({ title, buttons }); return { element: { classList: { add() {} } } }; },
    };
    vm.createContext(ctx);
    const f = vm.runInContext(fn + '\nopenGear;', ctx, { filename: 'openGear.js' });
    f(key);
    return (seen[0] || { buttons: [] }).buttons.map((b) => b.label);
  };
  const noGem = openGear(orangeKey);
  assert.ok(noGem.some((l) => l.indexOf('镶嵌宝石') === 0), '橙装详情里必须有「镶嵌宝石」：' + JSON.stringify(noGem));
  s.props[101] = 1;
  assert.equal(S.socketGem(orangeKey, 101).ok, true, '镶嵌应当成功');
  const withGem = openGear(orangeKey);
  assert.ok(withGem.some((l) => l.indexOf('卸下宝石') === 0), '镶过宝石后详情里必须有「卸下宝石」：' + JSON.stringify(withGem));

  /* ② 版式契约：详情弹窗的正文必须限高（否则第二行按钮会被画布裁掉，功能"消失"）。 */
  const css = fs.readFileSync(path.join(root, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(css, /\.gear-detail[\s\S]{0,200}?\.modal-body[\s\S]{0,120}?max-height:\s*\d+px/,
    'classic-refine.css 里必须给装备详情弹窗的正文限高（不然橙装的宝石按钮会被挤到画布外）');
});

test('调试台「重置每日与体力计时」也重置徒弟日供（含「昨天必须有收益流水」那一道门）', () => {
  const g = game();
  /* 调试模块要一个够用的 DOM 壳（它初始化时会挂面板与监听）。 */
  const stubEl = () => ({ innerHTML: '', textContent: '', dataset: {}, style: {}, className: '', value: '', title: '',
    querySelector: () => stubEl(), querySelectorAll: () => [], appendChild: () => {}, removeChild: () => {},
    remove: () => {}, addEventListener: () => {}, setAttribute: () => {}, getAttribute: () => null,
    focus: () => {}, blur: () => {}, closest: () => null, contains: () => false, insertBefore: () => {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } });
  g.ctx.document = { readyState: 'complete', createElement: () => stubEl(), createTextNode: () => stubEl(),
    body: stubEl(), head: stubEl(), documentElement: stubEl(), activeElement: null,
    addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => stubEl(), querySelectorAll: () => [] };
  /* window === ctx：addEventListener / setTimeout 都要挂在 ctx 上（挂在展开出来的副本上没用）。 */
  g.ctx.addEventListener = () => {};
  g.ctx.removeEventListener = () => {};
  if (typeof g.ctx.setTimeout !== 'function') {
    g.ctx.setTimeout = () => 0;
    g.ctx.clearTimeout = () => {};
  }
  vm.runInContext(fs.readFileSync(path.join(root, 'js/debug.js'), 'utf8'), g.ctx, { filename: 'js/debug.js' });
  const reset = g.ctx.Debug.actions().find((a) => a.label === '重置每日与体力计时');
  assert.ok(reset, '调试台里应当有「重置每日与体力计时」这条工具');
  assert.ok(/日贡|日供/.test(reset.note), '说明里要提到弟子日供：' + reset.note);

  const S = g.State.state();
  const today = g.State.localDate();
  const y = (() => {
    const [yy, mm, dd] = today.split('-').map(Number);
    const d = new Date(yy, mm - 1, dd); d.setDate(d.getDate() - 1);
    const p = (v) => String(v).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  })();
  S.prentices = [{ name: '小徒', level: 70, since: '2026-01-01', joinedAt: 1, lastExpDate: '', tributeClaimedDate: '' }];

  /* ① 昨天有真实流水：领过一次 → 重置后能再领 */
  S.earnHistory = [{ date: y, exp: 1000, gold: 500 }];
  assert.ok(g.State.apprenticeDailyTotal().gold > 0, '先确认能领');
  g.State.claimApprenticeExp();
  assert.equal(g.State.apprenticeDailyTotal().gold, 0, '领过了就该是 0');
  reset.run();
  assert.ok(g.State.apprenticeDailyTotal().gold > 0, '重置后应当又能领');

  /* ② 昨天**没有**流水（只有今天）：旧的实现到这里就卡住了 ——
   *    界面报「今日已领取」清掉了，但日供数额取自昨天的流水、恒为 0，于是永远领不到。
   *    现在重置会把今天的流水补一份当成昨天，让「回到新的一天」这件事真的成立。 */
  g.State.state().earnHistory = [{ date: today, exp: 800, gold: 400 }];
  g.State.state().prentices[0].lastExpDate = '';
  g.State.state().prentices[0].tributeClaimedDate = '';
  assert.equal(g.State.apprenticeDailyTotal().gold, 0, '昨天没流水 → 现在确实领不到（复现问题现场）');
  reset.run();
  const after = g.State.apprenticeDailyTotal();
  assert.ok(after.exp > 0 && after.gold > 0, '重置后应当能领到（把今天的流水当昨天结算）：' + JSON.stringify(after));
  const goldBefore = g.State.state().goldPoint;
  g.State.claimApprenticeExp();
  assert.ok(g.State.state().goldPoint > goldBefore, '金松果要真的到账');

  /* ③ 今天也没有收益时不凭空造收益（不刷钱） */
  g.State.state().earnHistory = [];
  const gold0 = g.State.state().goldPoint;
  reset.run();
  assert.equal(g.State.apprenticeDailyTotal().gold, 0, '今天没赚钱就不该凭空出现日供');
  assert.equal(g.State.state().goldPoint, gold0, '金松果不该被改动');
  assert.equal((g.State.state().earnHistory || []).length, 0, '不该凭空写入流水');
});

test('调试用武技接口：获得/改等级/遗忘，等级夹在 1~15 且不重复', () => {
  const g = game(), S = g.State, s = S.state();
  assert.ok(S.weaponList().length > 0 && S.skillList().length > 0, '武器与技能表都读得到');
  const w = S.weaponList()[0], k = S.skillList()[0];
  const got = S.setWeapon(w.id, 7);
  assert.equal(got.ok, true); assert.equal(got.level, 7);
  assert.equal(s.weapons.includes(w.id + ':7'), true);
  S.setWeapon(w.id, 12);
  assert.equal(s.weapons.filter((x) => Number(String(x).split(':')[0]) === w.id).length, 1, '不会重复添加');
  assert.equal(s.weapons.includes(w.id + ':12'), true);
  assert.equal(S.setWeapon(w.id, 99).level, 15, '等级上限 15');
  assert.equal(S.setSkill(k.id, 0).level, 1, '等级下限 1');
  assert.equal(S.forgetWeapon(w.id).ok, true);
  assert.equal(s.weapons.some((x) => Number(String(x).split(':')[0]) === w.id), false);
  assert.equal(S.forgetWeapon(w.id).ok, false, '遗忘两次第二次失败');
  assert.equal(S.forgetSkill(k.id).ok, true);
  assert.equal(S.setSkill(9999, 1).ok, false);
});

test('满级 70 级：经验不再升级，69 级 179、满级 180 体力上限', () => {
  const g = game(), S = g.State, s = S.state();
  assert.equal(S.MAX_PLAYER_LEVEL, 70);
  assert.equal(S.energyCapForLevel(1), 90);
  assert.equal(S.energyCapForLevel(2), 93);
  assert.equal(S.energyCapForLevel(10), 110);
  assert.equal(S.energyCapForLevel(20), 130);
  assert.equal(S.energyCapForLevel(30), 140);
  assert.equal(S.energyCapForLevel(69), 179);
  assert.equal(S.energyCapForLevel(70), 180);
  // 低等级段确实比以前低（旧曲线 10 级 117 / 20 级 137）
  assert.ok(S.energyCapForLevel(10) < 117 && S.energyCapForLevel(20) < 137, '低等级体力上限下调');
  // 一路喂经验到满级后不再升级
  s.exp = 0; S.gainExp(1e9);
  assert.equal(s.level, 70, '满级封顶');
  assert.equal(s.maxEnergy, 180, '满级体力上限 180');
  S.save(); S.load();
  assert.equal(S.state().level, 70); assert.equal(S.state().maxEnergy, 180);
  // 旧档（旧成长曲线算出的更高上限）读档时被收回；超过 70 级的等级也压回 70
  g.storage.set(S.saveKey, JSON.stringify({ level: 70, maxEnergy: 999, props: {} }));
  S.load();
  assert.equal(S.state().maxEnergy, 180);
  g.storage.set(S.saveKey, JSON.stringify({ level: 99, maxEnergy: 300, props: {} }));
  S.load();
  assert.equal(S.state().level, 70);
  assert.equal(S.state().maxEnergy, 180);
});

test('好友系统：随机 NPC 也能加为好友，重名/满员有提示，删除与存档往返正常', () => {
  const g = game(), S = g.State;
  assert.equal(S.friendLimit(), 20);
  assert.equal(S.friendList().length, 0);
  const cands = S.rollFriendCandidates(3);
  assert.equal(cands.length, 3);
  assert.ok(cands.every((c) => c.level >= 1 && c.level <= S.MAX_PLAYER_LEVEL), '推荐等级不超过满级');
  const first = S.addFriend(cands[0]);
  assert.equal(first.ok, true); assert.equal(S.friendList().length, 1);
  assert.equal(S.friendList()[0].name, cands[0].name);
  assert.equal(S.addFriend(cands[0]).ok, false, '同名不能重复加');
  assert.equal(S.addFriend({ name: '   ' }).ok, false, '空名字不给加');
  assert.equal(S.addFriend({ name: '超长名字'.repeat(8), level: 3 }).ok, true, '超长名字会被截断');
  assert.ok(S.friendList()[1].name.length <= 20);
  for (let i = 0; i < 25; i++) S.addFriend({ name: '路人' + i, level: 3 + i, power: 5, agility: 5, speed: 5, hp: 40 });
  assert.equal(S.friendList().length, 20, '好友上限 20');
  assert.match(S.addFriend({ name: '再来一个' }).msg, /好友已满/);
  // 切磋用的对手对象
  const foe = S.friendFoe(S.friendList()[0]);
  assert.equal(foe.name, S.friendList()[0].name);
  assert.equal(foe.level, S.friendList()[0].level);
  assert.equal(foe.hp, S.friendList()[0].hp);
  // 存档往返：好友与等级都保留，超过满级的旧好友被压回
  S.save();
  g.storage.set(S.saveKey, JSON.stringify(Object.assign(JSON.parse(g.storage.get(S.saveKey)), {
    friends: [{ name: '老友', level: 99, power: 9, agility: 9, speed: 9, hp: 90 }],
  })));
  S.load();
  assert.equal(S.friendList().length, 1);
  assert.equal(S.friendList()[0].level, S.MAX_PLAYER_LEVEL, '好友等级不超过满级');
  assert.equal(S.removeFriend('老友').ok, true);
  assert.equal(S.friendList().length, 0);
  assert.equal(S.removeFriend('老友').ok, false);
});

test('存档往返：剧情「只播一次」的记账与剧情模式开关必须保留（退出游戏再重进不能变回第一次）', () => {
  const g = game(), S = g.State;
  /* 用户 2026-10 报的 bug：无尽塔玩到一半退出游戏再重进后，商人的第一次文案、第一次失去烙印、
   * 第一次遇巡视全都重播一遍 —— 根因就是 normalizeSave 里那份 endless 白名单没列
   * `storySeen` / `storyOn`，重载时被整包丢掉。这条用例把「存档往返要留住它们」钉死。 */
  const run = { layer: 7, plan: [{ kind: 'battle' }], idx: 0 };
  g.storage.set(S.saveKey, JSON.stringify(Object.assign(JSON.parse(g.storage.get(S.saveKey)), {
    endless: { best: 10, bestLayer: 7, storySeen: { merchant: true, patrolGate: true, layer31: true, 老剧情名: true }, storyOn: false, run: run },
  })));
  S.load();
  const e = S.state().endless;
  assert.equal(e.storySeen.merchant, true, '第一次遇商人的记账要留着');
  assert.equal(e.storySeen.patrolGate, true, '第一次遇巡视的记账要留着');
  assert.equal(e.storySeen.layer31, true, '第一次失去烙印的记账要留着');
  assert.equal(e.storySeen['老剧情名'], true, '旧档里已经不存在的剧情名也照留（无害，不该被清洗掉）');
  assert.equal(S.state().endless.storyOn, false, '挑战模式的开关也要跟着存档走');
  assert.equal(S.storyEnabled ? S.storyEnabled() : S.state().endless.storyOn !== false, false, '读出来仍然是挑战模式');
  /* 再存一次：往返之后不许把记账洗掉（以前第一次保存就会把它们写没）。 */
  S.save();
  S.load();
  assert.deepEqual(Object.keys(S.state().endless.storySeen).sort(), ['layer31', 'merchant', 'patrolGate', '老剧情名'],
    '第二遍存/读之后记账仍在：' + JSON.stringify(S.state().endless.storySeen));
  /* 形状清洗：坏值（字符串 / 数字 0）不当成「已播过」，也不该留在存档里。 */
  g.storage.set(S.saveKey, JSON.stringify(Object.assign(JSON.parse(g.storage.get(S.saveKey)), {
    endless: { storySeen: { a: true, b: 'yes', c: 0, d: 1 }, run: run },
  })));
  S.load();
  assert.deepEqual(Object.keys(S.state().endless.storySeen).sort(), ['a', 'd'],
    '只认「真」的记账：' + JSON.stringify(S.state().endless.storySeen));
  /* 挑战塔的「本层免费再战一次」同样不能在重载后丢。 */
  g.storage.set(S.saveKey, JSON.stringify(Object.assign(JSON.parse(g.storage.get(S.saveKey)), {
    tower: { maxLayer: 3, retry: { layer: 3, date: '2026-10-12' }, run: run },
  })));
  S.load();
  /* ⚠ 这些对象来自 vm 上下文，原型不同：用 deepEqual 会因原型比较而误报，逐字段比。 */
  const retry = S.state().tower.retry;
  assert.equal(retry && retry.layer, 3, '免费重试标记要保留，实测 ' + JSON.stringify(retry));
  assert.equal(retry && retry.date, '2026-10-12', '免费重试标记的日期也要留着：' + JSON.stringify(retry));
  g.storage.set(S.saveKey, JSON.stringify(Object.assign(JSON.parse(g.storage.get(S.saveKey)), {
    tower: { maxLayer: 3, retry: { layer: 0, date: 'x' } },
  })));
  S.load();
  assert.equal(S.state().tower.retry, null, '坏掉的 retry（层号 0）当作没有');
});

test('每日任务种类够多（16 种挑 4 条），计数器覆盖全部任务', () => {
  const g = game(), S = g.State, s = S.state();
  assert.equal(S.QUEST_TYPES.length, 16, '16 种任务');
  const keys = S.QUEST_TYPES.map((t) => t.key);
  assert.equal(new Set(keys).size, 16, 'key 不重复');
  const list = S.questStatus();
  assert.equal(list.length, 4, '每天 4 条');
  assert.equal(new Set(list.map((q) => q.key)).size, 4, '同一天不重复抽同一种');
  for (const key of keys) assert.ok(key in s.dailyCounters, '计数器覆盖 ' + key);
  for (const q of list) assert.ok(q.need > 0 && q.name && !q.name.includes('{n}'), '任务文案要填好目标：' + q.name);
});

test('每日任务计数：合成/融合装备、宝石、使用/购买/卖出道具、拾取、天梯/切磋/挑战', () => {
  const g = game(), S = g.State, s = S.state();
  S.questStatus();   // 建好当天的计数器
  const c = (key) => s.dailyCounters[key] || 0;
  // 碎片合成装备 → merge
  s.props[24] = 20; s.goldPoint = 1000;
  assert.equal(S.composeGear(24).ok, true);
  assert.equal(c('merge'), 1, '碎片合成装备要计入 merge');
  // 装备回收价按品质分档：白 55-60 / 绿 60-65 / 蓝 65-70 / 紫 90-110 / 橙 180-220
  // （回归：gearQuality 曾被同名的「按 id 取品质」函数顶掉，紫装一路掉到 55-60）
  const SELL_RANGE = [[55, 60], [60, 65], [65, 70], [90, 110], [180, 220]];
  for (let q = 0; q <= 4; q++) {
    const [lo, hi] = S.gearSellRange(q);
    assert.equal(lo, SELL_RANGE[q][0], '第 ' + q + ' 档下限');
    assert.equal(hi, SELL_RANGE[q][1], '第 ' + q + ' 档上限');
  }
  {
    const purple = S.addGear(202);            // 狂战拳甲：卓越（紫）
    const before = s.goldPoint;
    const paid = S.sellGear(purple.key);
    assert.ok(paid >= 90 && paid <= 110, '紫装回收价应落在 90-110，实际 ' + paid);
    assert.equal(s.goldPoint, before + paid, '卖价真的入账');
  }

  // 3 件同部位同品质装备融合 → merge（第 2 项：允许不同名，产物是该部位随机装备）
  const trio = [S.addGear(21), S.addGear(25), S.addGear(29)];
  s.goldPoint = 1000;
  const merged = S.mergeGears(trio.map((x) => x.key));
  assert.equal(merged.ok, true);
  assert.equal(merged.gear.quality, 3, '融合产物品质 +1');
  assert.equal(S.gearPart(merged.gear.id), 0, '产物仍是同一部位（头巾）');
  assert.equal(c('merge'), 2, '装备融合也要计入 merge');
  // 宝石合成 → gem
  s.props[101] = 3; s.goldPoint = 1000;
  S.mergeGems(101);
  assert.equal(c('gem'), 1);
  // 使用道具 → use
  s.props[1] = 3;
  S.useProp(1);
  assert.equal(c('use'), 1);
  // 商店购买 → buy
  s.goldPoint = 1000;
  S.buyProp(1, 2);
  assert.equal(c('buy'), 2);
  // 卖出天使果实 → sell
  s.props[47] = 3;
  S.sellProp(47, 2);
  assert.equal(c('sell'), 2);
  // 战斗类型 → challenge / rank / spar（另加 fight/win）
  const entry = (kind) => ({ me: { name: '我' }, foe: { name: '敌' }, kind, region: 0,
    result: { winner: 0, rounds: [{ attacker: 0, hpAfter: [10, 0] }], maxHp: [40, 40] } });
  assert.ok(S.recordBattle(entry('challenge')));
  assert.ok(S.recordBattle(entry('rank')));
  assert.ok(S.recordBattle(entry('friend')));
  assert.equal(c('challenge'), 1);
  assert.equal(c('rank'), 1);
  assert.equal(c('spar'), 1);
  assert.equal(c('fight'), 3);
  assert.equal(c('win'), 3);
  // 过关胜利只算 stage
  assert.ok(S.recordBattle(entry('stage')));
  assert.equal(c('stage'), 1);
  assert.equal(c('challenge'), 1, '关卡胜利不该算成随机挑战');
});

test('货币类编号（8 金松果 / 15 经验 / 40 金杯）不会留在背包里', () => {
  const g = game(), S = g.State;
  // 旧档里被调试面板当道具发过的货币，读档时清掉
  g.storage.set(S.saveKey, JSON.stringify({ level: 5, goldPoint: 100, goldCup: 0, props: { 8: 999, 15: 50, 40: 12, 1: 7 } }));
  S.load();
  const s = S.state();
  assert.equal(s.props[8], undefined, '金松果不进背包');
  assert.equal(s.props[15], undefined, '经验不进背包');
  assert.equal(s.props[40], undefined, '金杯不进背包');
  assert.equal(s.props[1], 7, '真正的道具照常保留');
  // 存回去也不会再写进 props
  S.save();
  const saved = JSON.parse(g.storage.get(S.saveKey));
  assert.equal(saved.props[8], undefined);
  assert.ok(saved.props[1] >= 7);
});

test('旧存档保留等级、物品、关卡并独立补全新字段', () => {
  const g = game();
  g.storage.set('ssdz_save_v1', JSON.stringify({ name: '老玩家', level: 25, goldPoint: 703, energy: 67, weapons: ['15:12'], stages: { 7: { npcIndex: 2, passed: false } }, props: { 23: 4 } }));
  assert.equal(g.State.load(), true);
  const s = g.State.state();
  assert.equal(s.level, 25); assert.equal(s.goldPoint, 703); assert.equal(s.energy, 67);
  assert.equal(s.props[23], 4); assert.equal(s.stages[7].npcIndex, 2);
  s.propsStates[7] = 10;
  assert.equal(g.GData.NEW_PLAYER.propsStates[7], undefined);
  same(g.State.battleHistory(), []);
});

test('破损字段得到校正，非对象存档被拒绝', () => {
  const g = game();
  g.storage.set('ssdz_save_v1', JSON.stringify({ level: -1, energy: -8, props: null, skills: ['1:0', '1:3', '999:1'], gears: null, stages: { 1: null }, lastEnergyTs: 0 }));
  assert.equal(g.State.load(), true);
  assert.equal(g.State.state().level, 1); assert.equal(g.State.state().energy, 0);
  same(g.State.mySkills().map((s) => [s.id, s.level]), [[1, 1]]);
  g.State.tickEnergy(); assert.equal(g.State.state().energy, 0);
  for (const value of ['null', '[]', '7', '{broken']) {
    g.storage.set('ssdz_save_v1', value); assert.equal(g.State.load(), false);
  }
});

test('每日奖励按照本地日期发放，同日重载后不重复领取', () => {
  const g = game(), s = g.State.state();
  assert.equal(g.State.claimDaily().ok, true);
  assert.equal(s.goldPoint, 250); assert.equal(s.props[23], 1);
  assert.equal(g.State.claimDaily().ok, false);
  g.State.load(); assert.equal(g.State.claimDaily().ok, false);
  g.advance(6 * 60 * 1000);
  assert.equal(g.State.dailyStatus().claimed, false);
  assert.equal(g.State.claimDaily().ok, true);
  assert.equal(g.State.state().goldPoint, 400); assert.equal(g.State.state().props[23], 2);
});

test('旧存档首次迁移每日统计日期时保留当日数据，重载不清零', () => {
  const g = game();
  g.storage.set('ssdz_save_v1', JSON.stringify({ name: '老玩家', dailyWins: 7, dailyFails: 3, joinRankCount: 4, allWins: 80, allFails: 20 }));
  assert.equal(g.State.load(), true);
  let s = g.State.state();
  assert.equal(s.dailyStatsDate, g.State.localDate());
  same([s.dailyWins, s.dailyFails, s.joinRankCount, s.allWins, s.allFails], [7, 3, 4, 80, 20]);
  assert.equal(JSON.parse(g.storage.get('ssdz_save_v1')).dailyStatsDate, g.State.localDate());
  g.State.tickEnergy(); g.State.claimDaily(); g.State.load(); s = g.State.state();
  same([s.dailyWins, s.dailyFails, s.joinRankCount], [7, 3, 4]);
});

test('跨本地午夜在体力刷新时日切并保存，即使体力已满也正常', () => {
  const g = game(), s = g.State.state();
  s.dailyWins = 9; s.dailyFails = 2; s.joinRankCount = 6; s.allWins = 120; s.allFails = 40;
  s.energy = s.maxEnergy; g.State.save();
  const oldDate = s.dailyStatsDate;
  g.advance(6 * 60 * 1000);
  g.State.tickEnergy();
  assert.notEqual(s.dailyStatsDate, oldDate); assert.equal(s.dailyStatsDate, g.State.localDate());
  same([s.dailyWins, s.dailyFails, s.joinRankCount, s.allWins, s.allFails], [0, 0, 0, 120, 40]);
  const saved = JSON.parse(g.storage.get('ssdz_save_v1'));
  same([saved.dailyWins, saved.dailyFails, saved.joinRankCount, saved.dailyStatsDate], [0, 0, 0, g.State.localDate()]);
  s.dailyWins = 1; s.joinRankCount = 1;
  g.State.tickEnergy();
  same([s.dailyWins, s.joinRankCount], [1, 1]);
});

test('隔日加载会日切；每日礼包领取本身不清除任何统计', () => {
  const g = game(), s = g.State.state();
  s.dailyWins = 5; s.dailyFails = 1; s.joinRankCount = 2; g.State.save();
  const originalDate = s.dailyStatsDate;
  g.advance(24 * 60 * 60 * 1000);
  assert.equal(g.State.claimDaily().ok, true);
  same([s.dailyWins, s.dailyFails, s.joinRankCount, s.dailyStatsDate], [5, 1, 2, originalDate]);
  assert.equal(g.State.load(), true);
  const next = g.State.state();
  same([next.dailyWins, next.dailyFails, next.joinRankCount], [0, 0, 0]);
  assert.equal(next.dailyStatsDate, g.State.localDate());
  assert.equal(g.State.dailyStatus().claimed, true);
  assert.equal(next.goldPoint, 250); assert.equal(next.props[23], 1);
});

test('只调整设备 Date.now 时，统计与每日奖励共用同一本地日期', () => {
  const g = game(), s = g.State.state();
  s.dailyWins = 2; g.State.claimDaily();
  const original = g.Date.now();
  g.Date.now = () => original + 24 * 60 * 60 * 1000;
  g.State.tickEnergy();
  assert.equal(s.dailyWins, 0);
  assert.equal(g.State.dailyStatus().claimed, false);
  assert.equal(g.State.claimDaily().ok, true);
  assert.equal(s.dailyClaimDate, s.dailyStatsDate);
});

test('体力离线恢复保留余秒，满体力时不积攒免费恢复', () => {
  const g = game(), s = g.State.state();
  s.energy = 80;
  g.advance(11 * 60 * 1000); g.State.tickEnergy();
  assert.equal(s.energy, 82); assert.equal(g.State.energyCountdown(), '4:00');
  s.energy = s.maxEnergy;
  g.advance(24 * 60 * 60 * 1000);
  assert.equal(g.State.consumeEnergy(10), true);
  assert.equal(s.energy, s.maxEnergy - 10);
  g.State.tickEnergy(); assert.equal(s.energy, s.maxEnergy - 10);
  assert.equal(g.State.consumeEnergy(s.maxEnergy - 9), false); assert.equal(g.State.consumeEnergy(-10), false);
  g.State.load(); assert.equal(g.State.state().energy, s.maxEnergy - 10);
});

test('升级遵循原表等级与资源限制，零卷轴不会产生 NaN', () => {
  const g = game(), s = g.State.state();
  s.weapons = ['1:1'];
  assert.equal(g.State.doUpgrade('weapon', 1).ok, false);
  s.level = 5;
  assert.equal(g.State.doUpgrade('weapon', '1').ok, true);
  assert.equal(s.weapons[0], '1:2'); assert.equal(s.goldPoint, 60);   // 第 5 项：一次 40 松果
  assert.equal(s.props[22], undefined);
  s.level = 7;
  assert.equal(g.State.doUpgrade('weapon', 1).ok, false);
  assert.equal(s.goldPoint, 60);
  s.props[22] = 7;
  assert.equal(g.State.doUpgrade('weapon', 1).ok, true);
  assert.equal(s.props[22], 0); assert.equal(s.weapons[0], '1:3');
});

test('升级一次 40 松果；失败后成功率每次 +5%，封顶 100%，成功清零', () => {
  // 把随机源钉成 1 → 概率判定必定失败，可以确定性地看失败累积
  const g = game(), S = g.State, s = S.state();
  g.math.random = () => 1;
  s.weapons = ['15:9']; s.level = 40; s.goldPoint = 100000; s.props[22] = 9999;
  const rates = [];
  for (let i = 0; i < 5; i++) { rates.push(S.upgradeInfo('weapon', 15).rate); S.doUpgrade('weapon', 15); }
  assert.deepEqual(rates, [10, 15, 20, 25, 30], '每次失败 +5%');
  assert.equal(S.upgradeInfo('weapon', 15).coin, 40, '一次 40 松果');
  for (let i = 0; i < 30; i++) S.doUpgrade('weapon', 15);
  assert.equal(S.upgradeInfo('weapon', 15).rate, 100, '封顶 100%');
  // 随机源钉成 0 → 必定成功，成功后失败计数清零
  const g2 = game(), S2 = g2.State, s2 = S2.state();
  g2.math.random = () => 0;
  s2.weapons = ['15:9']; s2.level = 40; s2.goldPoint = 100000; s2.props[22] = 9999;
  assert.equal(S2.upgradeFails('weapon', 15), 0);
  assert.equal(S2.doUpgrade('weapon', 15).fails, 0);
  assert.equal(S2.upgradeFails('weapon', 15), 0, '成功即清零');
});

test('卖出装备按品质给价：白55-60 / 绿60-65 / 蓝65-70 / 紫90-110 / 橙180-220', () => {
  const g = game(), S = g.State;
  const expect = [[55, 60], [60, 65], [65, 70], [90, 110], [180, 220]];
  expect.forEach(([lo, hi], q) => {
    assert.deepEqual(Array.from(S.gearSellRange(q)), [lo, hi], '品质 ' + q + ' 区间');
    for (let i = 0; i < 60; i++) {
      const v = S.gearSellPrice(q);
      assert.ok(v >= lo && v <= hi, '品质 ' + q + ' 出价 ' + v + ' 应落在 ' + lo + '~' + hi);
    }
  });
  assert.deepEqual(Array.from(S.gearSellRange(9)), [180, 220], '越界品质夹到最高档');
  assert.deepEqual(Array.from(S.gearSellRange(-3)), [55, 60], '负品质夹到最低档');
});

test('天使/恶魔果实改成随机三选一，选完才消耗', () => {
  const g = game(), S = g.State, s = S.state();
  s.level = 60; s.goldPoint = 100000;
  s.weapons = ['15:1']; s.skills = ['12:1'];
  s.props[47] = 2; s.props[48] = 2;

  // 天使果实：回传最多 3 个可学候选，此时还不能消耗果实
  const gain = S.useProp(47);
  assert.equal(gain.ok, false);
  assert.equal(gain.needsFruitChoice, true, '要弹窗让玩家选');
  assert.equal(gain.mode, 'gain');
  assert.ok(gain.options.length >= 1 && gain.options.length <= 3, '候选 1~3 个');
  assert.equal(s.props[47], 2, '未选之前不消耗果实');
  const pick = gain.options[0];
  const applied = S.applyFruitChoice(47, pick.kind, pick.id);
  assert.equal(applied.ok, true, applied.msg);
  assert.equal(s.props[47], 1, '选完才扣一个');
  assert.ok((pick.kind === 'weapon' ? s.weapons : s.skills).some((x) => parseInt(x) === pick.id), '真的学会了');

  // 恶魔果实：候选都来自已拥有的，选中后忘掉那一个
  const before = s.weapons.length + s.skills.length;
  const lose = S.useProp(48);
  assert.equal(lose.needsFruitChoice, true);
  assert.equal(lose.mode, 'lose');
  assert.ok(lose.options.length >= 1 && lose.options.length <= 3);
  for (const o of lose.options) {
    const inW = s.weapons.some((x) => parseInt(x) === o.id);
    const inS = s.skills.some((x) => parseInt(x) === o.id);
    assert.ok((o.kind === 'weapon' ? inW : inS), '候选必须是自己拥有的：' + o.name);
  }
  const drop = lose.options[0];
  assert.equal(S.applyFruitChoice(48, drop.kind, drop.id).ok, true);
  assert.equal(s.weapons.length + s.skills.length, before - 1, '真的忘掉了一个');
  assert.equal(s.props[48], 1);
});

test('自由属性点分配可以撤回，撤回只退弹窗里分配的那些', () => {
  const g = game(), S = g.State, s = S.state();
  s.power = 10; s.agility = 10; s.speed = 10; s.maxHp = 100; s.hp = 100; s.freePoints = 3;
  assert.equal(S.undoDepth(), 0, '一开始没有可撤回的');
  assert.equal(S.undoPoint().ok, false, '没分配过就撤不了');

  const p1 = S.allocatePoint('power');
  assert.equal(p1.ok, true);
  assert.equal(s.power, 11);
  assert.equal(s.freePoints, 2);
  assert.equal(S.undoDepth(), 1);

  const p2 = S.allocatePoint('hp');
  assert.equal(s.maxHp, 105, '生命 +5');
  assert.equal(s.freePoints, 1);

  // 撤回一次：生命 −5、点数退回
  const u1 = S.undoPoint();
  assert.equal(u1.ok, true);
  assert.equal(u1.attr, 'hp');
  assert.equal(s.maxHp, 100);
  assert.equal(s.freePoints, 2);
  assert.ok(s.hp <= s.maxHp, '撤回生命后当前血量不能超过上限');

  // 撤回第二次：力量 −1、回到最初
  const u2 = S.undoPoint();
  assert.equal(u2.attr, 'power');
  assert.equal(s.power, 10);
  assert.equal(s.freePoints, 3);
  assert.equal(S.undoDepth(), 0, '退完了');
  assert.equal(S.undoPoint().ok, false);

  // 撤回栈按顺序记录，跨读档保留；成长得来的属性不会被退掉
  s.freePoints = 2;
  S.allocatePoint('agility');
  S.allocatePoint('speed');
  S.save();
  S.load();
  const reloaded = S.state();
  assert.equal(S.undoDepth(), 2, '读档后仍能撤回');
  S.undoPoint();
  assert.equal(reloaded.speed, 10);
});

test('商店每日限购：四种普通药丸每天 3 颗', () => {
  const g = game(), S = g.State;
  for (const id of [3, 4, 5, 7]) {
    assert.equal(S.shopLimit(id), 3, (S.propName ? S.propName(id) : id) + ' 每日 3 颗');
    assert.equal(S.purchaseStatus(id).limit, 3);
  }
  /* 养成平衡：大小体力药剂每天各限购 3 个。 */
  assert.equal(S.shopLimit(1), 3, '小体力药剂每日 3 个');
  assert.equal(S.shopLimit(2), 3, '大体力药剂每日 3 个');
  assert.equal(S.shopLimit(23), 5, '挑战书仍是 5 件');
  assert.equal(S.shopLimit(13), 1, '转生果每日 1 件');
  /* 2026-10 用户口径：勇气徽章（碎片竞技场入场券）每天 3 个（原来落在默认的 5）。 */
  assert.equal(S.shopLimit(39), 3, '勇气徽章每日 3 个');
  assert.equal(S.purchaseStatus(39).limit, 3);
  // 超级药丸在字典里 buy=false，不进商店，限购多少都无所谓
  for (const id of [41, 42, 43, 44]) assert.equal(S.purchaseStatus(id).buyable, false, id + ' 不进商店');
});

test('超级松鼠特权 8：体力上限在当前等级上限之上 +60，到期原样退回', () => {
  const g = game(), S = g.State, s = S.state();
  const day = 86400000;
  for (const lv of [1, 10, 30, 50, 70]) {
    const cap = S.energyCapForLevel(lv);
    s.level = lv;
    s.vip = { level: 1, exp: 0, until: 0, capAdded: 0, capApplied: false, lastDaily: '' };
    s.maxEnergy = cap;                       // 普通状态：正好是等级上限
    // 开通
    s.vip.until = Date.now() + day;
    S.syncVipEnergyCap();
    assert.equal(s.maxEnergy, cap + 60, lv + ' 级开通后应为等级上限+60');
    // 到期
    s.vip.until = 0;
    S.syncVipEnergyCap();
    assert.equal(s.maxEnergy, cap, lv + ' 级到期应退回等级上限');
  }
  // 开通期间升级：上限跟着新等级走，仍然是 +60
  s.level = 30; s.vip = { level: 1, exp: 0, until: Date.now() + day, capAdded: 0, capApplied: false, lastDaily: '' };
  s.maxEnergy = S.energyCapForLevel(30);
  S.syncVipEnergyCap();
  assert.equal(s.maxEnergy, S.energyCapForLevel(30) + 60);
  s.level = 50;
  s.maxEnergy = Math.max(s.maxEnergy, S.energyCapForLevel(50));
  S.syncVipEnergyCap();
  assert.equal(s.maxEnergy, S.energyCapForLevel(50) + 60, '升级后仍应为新等级上限+60');
  // 读档保留
  S.save(); S.load();
  assert.equal(S.state().maxEnergy, S.energyCapForLevel(50) + 60, '读档后 VIP 加成还在');
  // 读档时若已到期则按等级上限收口
  S.state().vip.until = 0; S.save(); S.load();
  assert.equal(S.state().maxEnergy, S.energyCapForLevel(50), '到期读档按等级上限');
});

test('真·武器/真·技能：成功率沿用原表、费用按当日次数递增、24:00 清零、不吃失败保底', () => {
  const g = game(), S = g.State, s = S.state();
  s.level = 70; s.goldPoint = 1000000; s.props[21] = 9999; s.props[22] = 9999;
  // 真1~真5 的成功率就是原表 upgradeMap 第 10~14 行
  for (const [lv, rate] of [[10, 100], [11, 8], [12, 5], [13, 4], [14, 3]]) {
    s.skills = ['12:' + lv];
    const info = S.upgradeInfo('skill', 12);
    assert.equal(info.rate, rate, '技能等级 ' + lv + '（真' + (lv - 10) + '）成功率应为 ' + rate + '%');
    assert.equal(info.isTrue, true);
  }
  s.weapons = ['4:10'];
  assert.equal(S.upgradeInfo('weapon', 4).rate, 100, '武器 10→11 也是真1：100%');
  // 真5 之后到顶
  s.skills = ['12:15'];
  assert.equal(S.upgradeInfo('skill', 12).max, true, '真5 是上限');
  // 费用：当日第 N 次 = 2N U点 × 5 金松果 = 10/20/30…
  s.skills = ['12:10']; s.trueUpgrades = { date: S.localDate(), count: 0 };
  g.math.random = () => 1;                       // 必定失败，纯粹看费用与计数
  const costs = [];
  for (let i = 0; i < 5; i++) { costs.push(S.upgradeInfo('skill', 12).coin); S.doUpgrade('skill', 12); }
  assert.deepEqual(costs, [10, 20, 30, 40, 50], '费用按当日次数递增');
  const after = S.upgradeInfo('skill', 12);
  assert.equal(after.fails, 0, '真升级绝不累积失败保底');
  assert.equal(after.rate, 100, '真升级的成功率始终是原表值');
  // 24:00 清零
  g.advance(86400000);
  assert.equal(S.trueAttemptsToday(), 0, '换天次数清零');
  assert.equal(S.upgradeInfo('skill', 12).coin, 10, '次日费用回到第一次');
  // 普通升级（9→10）仍然是 40 松果、仍然吃失败保底
  s.skills = ['12:9'];
  const normal = S.upgradeInfo('skill', 12);
  assert.equal(normal.coin, 40);
  assert.equal(normal.isTrue, false);
  S.doUpgrade('skill', 12);
  assert.equal(S.upgradeInfo('skill', 12).rate, 15, '普通升级失败仍然 +5%');
});

test('每日任务「抽取每日幸运抽奖」最多要求 2 次', () => {
  const g = game(), S = g.State;
  const q = S.QUEST_TYPES.find((t) => t.key === 'lottery');
  assert.ok(q, '任务表里有抽奖任务');
  assert.deepEqual(Array.from(q.steps), [1, 2], '不再出现 3 次：' + JSON.stringify(q.steps));
});

test('购买拒绝负数、小数和无穷数量，合法购买正常扣款', () => {
  const g = game(), s = g.State.state();
  for (const count of [-5, 0, 1.5, Infinity]) assert.equal(g.State.buyProp(1, count).ok, false);
  assert.equal(s.goldPoint, 100);
  assert.equal(g.State.buyProp(1, 2).ok, true);
  assert.equal(s.goldPoint, 94); assert.equal(s.props[1], 5);
});

test('装备穿戴等级、槽位互斥、融合材料和附加属性生效', () => {
  const g = game(), s = g.State.state();
  const one = g.State.addGear(1, [{ id: 28, level: 1 }]);
  assert.equal(g.State.wear(one.key), false);
  s.level = 20;
  assert.equal(g.State.wear(one.key), true);
  const two = g.State.addGear(5);
  assert.equal(g.State.wear(two.key), true);
  assert.equal(g.State.myGears().find((x) => x.key === one.key).used, false);
  g.State.wear(one.key); s.skills = ['2:5'];
  assert.equal(g.State.totalStats().agility, s.agility + 1 + 12);
  g.State.unwear(one.key);
  const count = s.gears.length;
  assert.equal(g.State.mergeGears([one.key, one.key, one.key]).ok, false);
  const otherSlot = g.State.addGear(2);
  assert.equal(g.State.mergeGears([one.key, two.key, otherSlot.key]).ok, false);
  assert.equal(s.goldPoint, 100); assert.equal(s.gears.length, count + 1);
  const three = g.State.addGear(1), four = g.State.addGear(1);
  const result = g.State.mergeGears([one.key, three.key, four.key]);
  assert.equal(result.ok, true); assert.equal(result.gear.quality, 1);
  assert.equal(s.goldPoint, 70);   // 白装融合 30 金松果（按材料品质分档）
});

test('需求146：套装收益 —— 同名 2/4 件两档、按最低品质缩放，且真的进战斗', () => {
  const g = game(), s = g.State.state();
  s.level = 30;
  const wear = (id) => { const it = g.State.addGear(id); assert.equal(g.State.wear(it.key), true, id + ' 可穿戴'); return it; };
  const ninja = () => g.State.setBonusList().find((x) => x.family === '忍者');
  /* 忍者紫（setId 15：护额 57 / 拳套 58 / 服 59 / 鞋 60）——先穿 2 件，只拿到 2 件档 */
  wear(58); wear(59);
  assert.equal(ninja().count, 2); assert.equal(ninja().tier, 2);
  same(ninja().text, ['闪避率 +3.9%']);        // 2 × 紫装系数 1.3 × 全局 1.5
  assert.equal(g.State.totalStats().speed, s.speed);       // 2 件档还没给速度
  /* 补满 4 件：4 件档**叠加**在 2 件档上（先穿鞋、再穿护额，中间取一次基准） */
  wear(60);
  const speedWithShoe = g.State.totalStats().speed;      // 忍者鞋自身那段，此时还只有 2 件档
  wear(57);
  assert.equal(ninja().tier, 4);
  same(ninja().text, ['速度 +2', '闪避率 +9.8%']);   // 速度 1×1.3×1.5 取整；闪避 (2+3)×1.3×1.5
  assert.equal(g.State.setBonusEffects().stats.speed, 2);
  assert.equal(g.State.totalStats().speed, speedWithShoe + 2);   // 套装的速度加成进了属性合计
  /* 换掉一件紫手套 → 蓝手套（同家族、不同品质）：整套按**最低**品质算，收益掉到蓝装档 */
  const blue = g.State.addGear(30);
  assert.equal(g.State.wear(blue.key), true);
  assert.equal(ninja().count, 4); assert.equal(ninja().quality, 2);
  same(ninja().text, ['速度 +2', '闪避率 +7.5%']);
  /* 战斗侧：走独立通道 setFx（不是塔 buff 的 mods），固定随机流下 A/B 对比 */
  const me = { name: '我', level: 30, power: 40, agility: 40, speed: 40, hp: 400, maxHp: 400, weapons: [], skills: [], effects: {} };
  const foe = { name: '敌', level: 30, power: 30, agility: 30, speed: 30, hp: 300, maxHp: 300, weapons: [], skills: [], effects: {} };
  assert.equal(g.State.applySetBonuses(me), me.setFx);
  assert.equal(me.setFx.dodgeBonus, 7.5);
  const reseed = () => { let seed = 999; g.math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; };
  reseed(); const plain = g.Sim.simulate({ ...me, setFx: null }, foe, {}).rounds.length;
  reseed(); const buffed = g.Sim.simulate({ ...me, setFx: { dmgMul: 2 } }, foe, {}).rounds.length;
  assert.ok(buffed < plain, '套装收益的伤害乘区要真的缩短战斗：' + plain + ' → ' + buffed);
  /* 2026-10 用户口径：装备页上那条常驻的「套装收益：…」介绍行**已删**，
   * 套装效果只在**点开具体装备**时说明（详情里逐档标出哪一条已生效）。
   * 这里做源码级断言，避免有人手滑把它加回装备页。 */
  const src = fs.readFileSync(path.join(root, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(!/setBonusSummary/.test(src), '装备页的套装收益摘要函数应当已经删掉');
  assert.ok(!/gear-set-line/.test(src), '装备页不该再渲染套装收益那一行');
  assert.ok(/function setBonusBlock\(/.test(src), '装备详情里的套装小节要留着');
});

test('需求148：「更换装备」页按「穿着中 > 星标 > 获得顺序」展示', () => {
  const g = game(), s = g.State.state();
  s.level = 30;
  /* 按 a → b → c → d → e 的顺序入手（拳斗头巾/手套/服/鞋 + 忍者护额，部位互不冲突） */
  const keys = [13, 14, 15, 16, 57].map((id) => g.State.addGear(id).key);
  const [a, b, c, d, e] = keys;
  const order = () => g.State.gearsInDisplayOrder().map((x) => x.key);
  same(order(), keys);                                   // 什么都没做时就是获得顺序
  g.State.wear(b);                                       // 穿着 → 最优先
  g.State.toggleGearStar(d);                             // 星标 → 次优先
  same(order(), [b, d, a, c, e]);
  g.State.wear(c);                                       // 穿第二件（同部位互斥，b 保留）
  same(order(), [b, c, d, a, e]);                        // 穿着组内仍是获得顺序（b 早于 c）
  g.State.toggleGearStar(b);                             // 又穿又标 → 仍在第 1 档最前
  same(order(), [b, c, d, a, e]);
  g.State.unwear(b);                                     // 卸下后落到星标档（b 早于 d）
  same(order(), [c, b, d, a, e]);
  g.State.toggleGearStar(a);                             // 给 a 加星标 → 进星标档，同档内 a 最早入手
  same(order(), [c, a, b, d, e]);
  g.State.toggleGearStar(b);                             // 取消 b 的星标 → b 回到「获得顺序」档
  same(order(), [c, a, d, b, e]);
});

test('1/5/10/15/20 级礼包：金松果回到旧版数量，种类更丰富且不重复发放', () => {
  const g = game(), s = g.State.state();
  // 原表（GameDict）保持逐字节不动，实际清单在 GData.GIFT_PACK_BOOST 里
  assert.equal(g.giftMap.getValue(28).prize, '29:1|8:50|2:3|1:5');
  const oldGold = { 28: 50, 29: 50, 30: 100, 31: 150, 32: 200 };
  for (const id of [28, 29, 30, 31, 32]) {
    const boost = g.GData.giftPackPrize(id);
    const rows = g.giftMap.getValue(id).prize.split('|').map((item) => item.split(':').map(Number));
    assert.ok(boost && boost.length, id + ' 级礼包有清单');
    // 金松果用旧版数量
    assert.equal((boost.find((b) => b.id === 8) || {}).count, oldGold[id], id + ' 级礼包金松果回到旧版');
    // 大小体力药剂都给，但都不多
    const small = (boost.find((b) => b.id === 1) || {}).count || 0;
    const big = (boost.find((b) => b.id === 2) || {}).count || 0;
    assert.ok(small >= 1 && small <= 5, id + ' 小体力药剂数量适中：' + small);
    assert.ok(big >= 1 && big <= 3, id + ' 大体力药剂数量适中：' + big);
    // 链式礼包（下一级的礼包）仍然保留
    const chain = rows.find(([pid]) => pid >= 29 && pid <= 32);
    if (chain) assert.ok(boost.some((b) => b.id === chain[0] && b.count === chain[1]), id + ' 的下一级礼包仍要保留');
    // 种类要丰富：至少还有一个药丸或卷轴
    assert.ok(boost.some((b) => [21, 22, 7, 44].includes(b.id)), id + ' 级礼包应有卷轴/药丸之类的额外奖励');
  }
  // 20 级礼包 30 片蓝色碎片
  assert.equal(g.GData.giftPackPrize(32).find((b) => b.id === 26).count, 30);
  assert.equal(g.State.useProp(28).ok, true);
  assert.equal(s.goldPoint, 100 + oldGold[28]); assert.equal(s.props[29], 1);
  assert.equal(g.State.useProp(28).ok, false);
  assert.equal(g.State.useProp(29).ok, false);
  // 满体力时药剂仍然可用，会顶到自然上限之上
  s.energy = s.maxEnergy;
  const count = s.props[1];
  const capped = g.State.useProp(1);
  assert.equal(capped.ok, true, '满体力也可以用，超出部分保留');
  assert.equal(s.energy, s.maxEnergy + 10);
  assert.equal(s.props[1], count - 1, '用掉的药剂要扣');
  // 超过自然上限后不再自然回复
  const before = s.energy;
  g.advance(30 * 60 * 1000);
  g.State.tickEnergy();
  assert.equal(s.energy, before, '超上限时不再自然回复');
  // 到达硬上限 999 才拒绝，且不扣道具
  s.energy = g.State.energyHardCap();
  const held = s.props[1];
  assert.equal(g.State.useProp(1).ok, false);
  assert.equal(s.props[1], held, '硬上限时不能白扣药剂');
  // 批量使用：一次用多个，最终停在硬上限
  s.energy = 0; s.props[2] = 50;
  const many = g.State.usePropMany(2, 'all');
  assert.equal(many.ok, true);
  assert.equal(s.energy, g.State.energyHardCap());
  assert.equal(many.used, 34, '999/30 向上需要 34 个大体力药剂');
  assert.equal(s.props[2], 50 - many.used);
  // 存档往返不会把超上限的体力清掉
  g.State.save(); g.State.load();
  assert.equal(g.State.state().energy, g.State.energyHardCap());
});

test('相同装备附加能力只取最高一条，跨装备和同件装备均不叠加', () => {
  const g = game(), s = g.State.state(); s.level = 20; s.skills = ['1:5'];
  const head = g.State.addGear(1, [{ id: 27, level: 1 }, { id: 27, level: 2 }]);
  const hand = g.State.addGear(2, [{ id: 27, level: 3 }]);
  g.State.wear(head.key); g.State.wear(hand.key);
  assert.equal(g.State.equipmentEffects()[27], 80);
  assert.equal(g.State.totalStats().power, s.power + g.State.gearInst(2).abilityVal + 18);
  g.State.unwear(hand.key);
  assert.equal(g.State.equipmentEffects()[27], 40);
  assert.equal(g.State.totalStats().power, s.power + 14);
});

test('关卡重打不倒退已解锁的 NPC，通关标记和存档保持', () => {
  const g = game();
  g.State.setStageProgress(1, { npcIndex: 3, passed: false });
  const progress = g.State.stageProgress(1); progress.npcIndex = 2;
  g.State.setStageProgress(1, progress);
  assert.equal(g.State.stageProgress(1).npcIndex, 3);
  g.State.setStageProgress(1, { npcIndex: 3, passed: true });
  g.State.setStageProgress(1, { npcIndex: 1, passed: false });
  g.State.load();
  assert.equal(g.State.stageProgress(1).passed, true);
  assert.equal(g.State.setStageProgress(999, { npcIndex: 3 }), false);
});

test('不使用药剂的战斗不消耗有效次数，被动技能按原字典增长', () => {
  const g = game(), s = g.State.state();
  s.skills = ['1:1', '2:2', '3:3', '4:1']; s.propsStates[3] = 20; s.propsStates[7] = 20;
  const stats = g.State.totalStats({ useProps: false });
  same(stats, { power: s.power + 2, agility: s.agility + 4, speed: s.speed + 4, hp: s.maxHp + 5 });
  g.State.fightReward(true, { useProps: false });
  assert.equal(s.propsStates[3], 20); assert.equal(s.propsStates[7], 20);
  g.State.fightReward(true); assert.equal(s.propsStates[3], 19);
});

const fighter = (extra) => Object.assign({ name: '松鼠', level: 1, power: 10, agility: 10, speed: 10, hp: 100, weapons: [], skills: [] }, extra);

test('反击后的血量快照与胜负一致，不遗漏最后一击', () => {
  const g = game(); g.math.random = () => 0.2;
  const result = g.Sim.simulate(fighter({ hp: 5 }), fighter({ power: 100 }));
  assert.equal(result.rounds[0].counterDmg > 0, true);
  assert.equal(result.rounds[0].hpAfter[0], 0);
  assert.equal(result.rounds.length, 1); assert.equal(result.winner, 1);
});

test('反击口径：只有近战武器与普攻能触发反击（远程 / 技能 / 已反伤都不行）', () => {
  /* 2026-10 第八十批用户口径。这里**不锁随机流**：断言的是**结构性**规则 ——
   * 「某类回合里一次反击都不该出现」（由代码分支决定，与随机无关），
   * 以及「近战 / 普攻这两类里必须出现过反击」（样本给足 40 场，实测每类都有几百次）。 */
  const g = game();
  const isCounter = (r) => r.counterDmg != null || r.counterDodge || r.counterFakeDie;
  let melee = 0, meleeCounter = 0, ranged = 0, rangedCounter = 0, skill = 0, skillCounter = 0, commonCounter = 0;
  for (let t = 0; t < 40; t++) {
    /* 我方带近战木剑(3) + 投掷飞镖(5) + 主动技色诱之术(8)，三类动作都会用上。 */
    const me = fighter({ power: 80, speed: 80, hp: 4000, weapons: ['3:5', '5:5'], skills: ['8:3'] });
    const foe = fighter({ power: 20, speed: 20, hp: 60000 });
    for (const r of g.Sim.simulate(me, foe).rounds) {
      if (r.attacker !== 0) continue;
      if (r.action === 'weapon' && r.wtype === '近战') { melee++; if (isCounter(r)) meleeCounter++; }
      else if (r.action === 'weapon') { ranged++; if (isCounter(r)) rangedCounter++; }
      else if (r.action === 'skill') { skill++; if (isCounter(r)) skillCounter++; }
      else if (r.action === 'common' && isCounter(r)) commonCounter++;
    }
  }
  assert.ok(melee > 50 && ranged > 50 && skill > 20,
    '样本要覆盖三类动作：近战 ' + melee + ' / 远程 ' + ranged + ' / 技能 ' + skill);
  assert.equal(rangedCounter, 0, '远程武器不该触发反击，实测 ' + rangedCounter);
  assert.equal(skillCounter, 0, '技能不该触发反击，实测 ' + skillCounter);
  assert.ok(meleeCounter > 0, '近战武器仍然可以被反击，实测 ' + meleeCounter);
  assert.ok(commonCounter > 0, '普攻仍然可以被反击，实测 ' + commonCounter);
  /* 已经反伤过的那一手不再反击：敌方带荆棘，我方每次武器攻击都被反伤回应。 */
  let thornRounds = 0, thornCounter = 0;
  for (let t = 0; t < 40; t++) {
    const me = fighter({ power: 80, speed: 80, hp: 4000, weapons: ['3:5'] });
    const foe = fighter({ power: 20, speed: 20, hp: 60000, mech: ['thorns'] });
    for (const r of g.Sim.simulate(me, foe).rounds) {
      if (r.attacker !== 0 || r.action !== 'weapon') continue;
      thornRounds++;
      if (isCounter(r)) thornCounter++;
    }
  }
  assert.ok(thornRounds > 50, '荆棘场景里要有我方武器回合：' + thornRounds);
  assert.equal(thornCounter, 0, '反伤已经回应过的那一手不再反击，实测 ' + thornCounter);
});

test('方天画戟在攻击前蓄力，武器升级伤害与原表一致', () => {
  const g = game(); g.math.random = () => 0.5;
  const result = g.Sim.simulate(fighter({ weapons: ['1:1'] }), fighter({ hp: 250 }));
  const mine = result.rounds.filter((r) => r.attacker === 0);
  assert.equal(mine[0].action, 'rest'); assert.equal(mine[1].action, 'weapon');
  assert.equal(g.State.weaponInst('1:11').harmLo, 15 + 9 * 12 + 20);
  assert.equal(g.State.weaponInst('2').harmLo, 12);
});

test('高速行动不会饿死较慢的一方，速度翻倍约行动两倍', () => {
  const g = game(); g.math.random = () => 0.8;
  const result = g.Sim.simulate(fighter({ speed: 200, hp: 100000 }), fighter({ speed: 100, hp: 100000 }));
  const counts = [0, 0]; result.rounds.forEach((r) => counts[r.attacker]++);
  assert.equal(counts[0], 80); assert.equal(counts[1], 40);
});

test('师父驾到使用师父等级，下一次普通攻击保留必中', () => {
  const g = game();
  const ordinary = [0.9, 0.9, 0.5, 0.9, 0.9];
  // 对手先攻击：100→65→30；低血呼叫真实7级师父，恢复28点。
  const rolls = [...ordinary, ...ordinary, ...ordinary, 0.1, ...ordinary, 0.9, 0, 0.5, 0.9, 0.9];
  g.math.random = () => rolls.length ? rolls.shift() : 0.9;
  const result = g.Sim.simulate(fighter({ power: 1, skills: ['13:1'], masterLevel: 7 }), fighter({ speed: 11, power: 35, hp: 10000 }));
  const mine = result.rounds.filter((r) => r.attacker === 0);
  const summoned = mine.findIndex((r) => r.id === 13);
  assert.ok(summoned > 0, '满血时不呼叫师父');
  assert.equal(mine[summoned].healSelf, 28);
  assert.equal(mine.filter((r) => r.id === 13).length, 1);
  assert.equal(mine[summoned + 1].action, 'common');
  assert.equal(mine[summoned + 1].dodge, undefined);
  assert.ok(mine[summoned + 1].dmg > 0);
});

test('装备词条改变对应武器伤害与减伤，不只显示说明', () => {
  const g = game(); g.math.random = () => 0.5;
  const attacker = fighter({ weapons: ['2:1'], hp: 10000 });
  const defender = fighter({ hp: 10000 });
  const plain = g.Sim.simulate(attacker, defender).rounds[0].dmg;
  const geared = g.Sim.simulate({ ...attacker, effects: { 6: 100, 13: 100 } }, defender).rounds[0].dmg;
  const reduced = g.Sim.simulate({ ...attacker, effects: { 6: 100, 13: 100 } }, { ...defender, effects: { 9: 50 } }).rounds[0].dmg;
  assert.equal(geared, plain * 3); assert.equal(reduced, Math.round(geared * 0.5));
});

test('徒手攻击的权重：基准 50，工具再多也让它的份额不低于 5%', () => {
  const g = game();
  /* kindWeights 收的是「候选对象」，权重按 .id 查 —— 与 pickKind 的调用口径一致。 */
  const cand = (ids) => ids.map((id) => ({ id }));
  const me = (ids) => fighter({ hp: 10000, usedWeapons: {}, usedSkills: {}, weapons: cand(ids), skills: cand(ids) });
  /* 徒手基准 = 50（2026-10 用户口径：从 30 提到 50）。 */
  const bare = g.Sim.kindWeights(me([]), [], []);
  assert.equal(bare.common, 50);
  assert.equal(bare.commonShare, 1);
  /* 一把武器：仍用基准 50，份额远高于保底。 */
  const one = g.Sim.kindWeights(me([2]), cand([2]), []);
  assert.equal(one.common, 50);
  assert.ok(one.commonShare > 0.3, '一把武器时徒手仍占三成以上：' + one.commonShare);
  /* 工具拉满（17 武器 + 17 技能，各 100 权重）：份额被压到保底 5%，权重被抬到基准之上。 */
  const ids = Array.from({ length: 17 }, (_, i) => i + 1);
  const heavy = g.Sim.kindWeights(me(ids), cand(ids), cand(ids));
  assert.ok(heavy.common > 50, '工具极多时徒手权重被抬到基准之上：' + heavy.common);
  assert.ok(Math.abs(heavy.commonShare - 0.05) < 1e-9, '保底正好 5%：' + heavy.commonShare);
  assert.equal(heavy.weapon + heavy.skill + heavy.common, heavy.total);
});

test('全部原版武器、技能与 NPC 的事件流都能有限结束并维持合法血量', () => {
  const g = game();
  const fixtures = [];
  g.weaponsMap.each((id) => fixtures.push(fighter({ weapons: [id + ':15'], hp: 600, speed: 80 })));
  g.skillsMap.each((id) => fixtures.push(fighter({ skills: [id + ':15'], hp: 600, speed: 80 })));
  g.npcsMap.each((id, npc) => fixtures.push({ name: npc.name, level: 20, power: +npc.power, agility: +npc.agility, speed: +npc.speed, hp: +npc.hp,
    weapons: [], skills: npc.skills ? npc.skills.split('|') : [], npcType: g.GData.stageTypeOf(+npc.stageId).anim }));
  for (const fixture of fixtures) {
    const result = g.Sim.simulate(fixture, fighter({ weapons: ['14:10', '16:10'], skills: ['6:1', '7:10', '16:10', '17:10'], hp: 600, speed: 80 }));
    assert.ok(result.rounds.length > 0 && result.rounds.length <= 240);
    for (const round of result.rounds) for (let side = 0; side < 2; side++) {
      assert.ok(Number.isFinite(round.hpAfter[side]) && round.hpAfter[side] >= 0 && round.hpAfter[side] <= result.maxHp[side], fixture.name);
    }
    assert.ok(result.winner === 0 || result.winner === 1);
  }
});

test('战报保存独立快照，重载可回放，最多保留最新 50 条', () => {
  const g = game();
  const me = fighter({ name: '我' }), foe = fighter({ name: '对手' });
  const result = g.Sim.simulate(me, foe);
  const saved = g.State.recordBattle({ me, foe, result, region: 3, kind: '关卡' });
  assert.equal(saved.region, 3); assert.equal(saved.createdAt, g.Date.now());
  me.name = '已修改'; result.rounds[0].hpAfter[0] = 99999;
  assert.equal(g.State.battleHistory()[0].me.name, '我');
  assert.notEqual(g.State.battleHistory()[0].result.rounds[0].hpAfter[0], 99999);
  for (let i = 0; i < 54; i++) g.State.recordBattle({ me: fighter(), foe: fighter({ name: String(i) }), result: saved.result });
  g.State.load();
  const history = g.State.battleHistory();
  assert.equal(history.length, 50); assert.equal(history[0].foe.name, '53'); assert.equal(history[49].foe.name, '4');
  assert.equal(history[0].result.rounds.length > 0, true);
  history[0].foe.name = '外部修改'; assert.equal(g.State.battleHistory()[0].foe.name, '53');
});

test('经验丸说明不再声称竞技场无效，其它限制仍保留', () => {
  const g = game();
  const pill = g.propMap.getValue(7), superPill = g.propMap.getValue(44);
  assert.equal(pill.name, '经验丸');
  assert.doesNotMatch(pill.remark, /竞技/);
  assert.match(pill.remark, /40%/);
  assert.match(pill.remark, /关卡中无效/, '关卡的无效说明要保留');
  assert.doesNotMatch(superPill.remark, /竞技/);
  assert.match(superPill.remark, /60%/);
  assert.match(superPill.remark, /天梯赛无效/, '天梯赛的无效说明要保留');
  // 说明修正必须落在底层行数组上，重新取值也要能看到（Map#getValue 每次新建对象）
  assert.equal(pill.remark, g.propMap.getValue(7).remark);
  // 重复执行是幂等的，不会把已改好的文案再改坏
  g.GData.applyPropRemarkFixes();
  assert.match(g.propMap.getValue(7).remark, /关卡中无效/);
  assert.equal(g.propMap.getValue(7).remark, pill.remark);
});

test('每日任务：当天固定抽取、进度来真实计数、只能领一次且重载保留', () => {
  const g = game();
  const S = g.State, s = S.state();
  const list = S.questStatus();
  assert.equal(list.length, 4, '每天 4 条');
  const keys = list.map((q) => q.key).join(',');
  for (let i = 0; i < 5; i++) S.questStatus();
  assert.equal(S.questStatus().map((q) => q.key).join(','), keys, '同一天反复读取不会重抽');
  assert.ok(list.every((q) => q.need > 0), '每条都有目标');
  // 奖励：纯随机 1~2 项，金松果/经验/道具都在同一个池子里抽，抽到才有
  const seenKinds = new Set();
  for (const q of list) {
    assert.ok(q.rewards.length >= 1 && q.rewards.length <= 2, '每条 1~2 项奖励，实际 ' + q.rewards.length);
    assert.ok(q.rewards.every((r) => r.name && r.count > 0), '每种奖励都有名字和数量（不会只剩数字）');
    for (const r of q.rewards) {
      seenKinds.add(r.kind);
      if (r.kind === 'gold') assert.ok(r.count >= 10 && r.count <= 30, '金松果 10~30，实际 ' + r.count);
      if (r.kind === 'exp') assert.ok(r.count >= 50 && r.count <= 80, '经验 50~80，实际 ' + r.count);
      // 药丸一次只能给 1 个
      if (r.kind === 'prop' && [3, 4, 5, 7, 44].includes(r.id)) assert.equal(r.count, 1, '药丸数量必须是 1，实际 ' + r.count);
    }
    // 金松果与经验不是固定奖励：没有就是没有
    assert.equal(q.gold, (q.rewards.find((r) => r.kind === 'gold') || { count: 0 }).count);
    assert.equal(q.exp, (q.rewards.find((r) => r.kind === 'exp') || { count: 0 }).count);
  }
  // 池子里金松果与经验都只是候选，不再保证出现
  assert.ok(S.QUEST_GOLD && S.QUEST_GOLD.kind === 'gold' && S.QUEST_EXP && S.QUEST_EXP.kind === 'exp');
  // 高级药丸（超级经验丸 44）概率大幅下调：权重最低，实际概率只有百分之几
  {
    const pool = S.QUEST_EXTRA_POOL;
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    const superPill = pool.find((item) => item.id === 44);
    const best = Math.max(...pool.map((item) => item.weight));
    assert.ok(superPill && superPill.weight === Math.min(...pool.map((item) => item.weight)), '超级经验丸权重应最低');
    const chance = superPill.weight / total;
    assert.ok(chance < 0.05, '超级经验丸概率应低于 5%，实际 ' + (chance * 100).toFixed(1) + '%');
    assert.ok(chance < best / total / 5, '应明显低于最高权重的奖励');
    // 药丸数量固定 1（池子里就不能是区间）
    for (const item of pool) if ([3, 4, 5, 7, 44].includes(item.id)) {
      assert.equal(item.range[0], 1, '药丸数量应为 1：id ' + item.id);
      assert.equal(item.range[1], 1, '药丸数量应为 1：id ' + item.id);
    }
  }
  assert.equal(S.questClaimable(), 0, '没做任务时没有可领取');

  // 进度来自当天真实计数
  const target = list[0];
  assert.equal(target.progress, 0);
  S.bumpDaily(target.key, target.need);
  const after = S.questStatus()[0];
  assert.equal(after.progress, target.need);
  assert.equal(after.done, true);
  assert.equal(after.claimable, true);
  assert.equal(S.questClaimable(), 1);

  // 领奖：每条任务按它自己的奖励结算，且不能重复领
  const gold0 = s.goldPoint;
  const props0 = JSON.parse(JSON.stringify(s.props));
  const reward = S.claimQuest(0);
  assert.equal(reward.ok, true);
  assert.equal(s.goldPoint, gold0 + target.gold);
  assert.ok(target.exp === 0 || s.exp > 0 || s.level > 1, '有经验奖励就会结算（可能升级）');
  for (const r of target.rewards) {
    if (r.kind === 'prop') assert.ok(s.props[r.id] > (props0[r.id] || 0), '道具 ' + r.id + ' 已入袋');
  }
  assert.equal(S.claimQuest(0).ok, false, '不能重复领取');
  assert.equal(S.questClaimable(), 0);

  // 未完成的任务不能领
  const pending = S.questStatus().find((q) => !q.done);
  if (pending) assert.equal(S.claimQuest(pending.index).ok, false, '未完成不能领');

  // 存档往返保留领取状态与计数
  S.save(); S.load();
  assert.equal(S.questStatus()[0].claimed, true);
  assert.equal(S.questStatus()[0].progress, target.need);

  // 跨天重置：任务与计数一起换新
  g.advance(2 * 24 * 3600 * 1000);
  S.tickEnergy();
  const next = S.questStatus();
  assert.equal(next.length, 4);
  assert.ok(next.every((q) => !q.claimed), '新的一天全部重置');
  assert.ok(next.every((q) => q.progress === 0), '新的一天计数归零');
});

test('每日任务按角色等级抽题：做不了的任务不会出现，升级换题也不多领奖励', () => {
  const g = game(), S = g.State, s = S.state();
  /* 任务池随等级变大：1 级 10 种 → 10 级加关卡与装备合成 → 11 级加竞技场 → 30 级加天梯 → 45 级加宝石。
   * 第 1 项：「升级武器或技能」固定 1 次，而且只在手上真有升得动的武技时出现。
   * 手上给一把 1 级武器（升 1→2 需要玩家 5 级，见 upgradeMap 的 levelLimit），
   * 所以 2~4 级这条任务不出现，5 级起才回到池子里。 */
  const count = (lv) => S.questPoolFor(lv).length;
  const upgradeType = S.QUEST_TYPES.find((t) => t.key === 'upgrade');
  assert.deepEqual(Array.from(upgradeType.steps), [1], '升级任务固定 1 次');
  s.weapons = ['1:1'];
  assert.equal(count(1), 10, '1 级池子：' + S.questPoolFor(1).map((t) => t.key).join(','));
  assert.equal(S.hasUpgradableWS(2), false, '2 级时 1 级武器还升不动（需要玩家 5 级）');
  assert.equal(count(2), 10, '升不动就不该出现升级任务');
  assert.equal(count(4), 10);
  assert.equal(S.hasUpgradableWS(5), true, '5 级起 1→2 的等级门槛满足');
  assert.equal(count(5), 11);
  assert.equal(count(10), 13);
  assert.equal(count(11), 14);
  assert.equal(count(30), 15);
  assert.equal(count(45), 16, '45 级才是全部 16 种');
  // 全部顶到等级上限之后：池子里没有升级任务，当天已抽到的升级任务也会被换掉
  s.weapons = ['1:15'];
  s.level = 70;
  assert.equal(S.hasUpgradableWS(70), false, '已满级的武器升不动');
  assert.equal(S.questPoolFor(70).some((t) => t.key === 'upgrade'), false, '升不动时池子里没有升级任务');
  s.weapons = ['1:1'];
  for (const lv of [1, 5, 10, 20, 30, 45, 70]) {
    for (const type of S.questPoolFor(lv)) assert.ok((type.minLevel || 1) <= lv, type.key + ' 不该出现在 ' + lv + ' 级');
    for (const type of S.QUEST_TYPES) {
      assert.equal(S.questAvailableAt(type.key, lv), (type.minLevel || 1) <= lv, type.key + ' @ ' + lv);
    }
  }
  // 各个门槛和实际功能对得上（改了门槛要一起改这里）
  const gate = (key) => (S.QUEST_TYPES.find((t) => t.key === key) || {}).minLevel || 1;
  assert.equal(gate('stage'), 10, '关卡 10 级开启');
  assert.equal(gate('merge'), 10, '装备合成要关卡碎片');
  assert.equal(gate('arena'), 11, '经验竞技场 11 级开启');
  assert.equal(gate('rank'), 30, '天梯赛 30 级开启');
  assert.equal(gate('gem'), 45, '宝石 45 级才有产出');
  assert.equal(gate('upgrade'), 2, '2 级才有第一件武器/技能（能否做还要看手上有没有升得动的）');
  // 1 级当天抽到的 4 条都必须能做
  s.level = 1; s.quests = null;
  const low = S.questStatus();
  assert.equal(low.length, 4);
  assert.ok(low.every((q) => S.questAvailableAt(q.key, 1)), '1 级抽到：' + low.map((q) => q.key).join(','));
  // 同一天同一等级反复读不换题
  assert.equal(S.questStatus().map((q) => q.key).join(','), low.map((q) => q.key).join(','));
  // 旧档里存的越级任务（例如 20 级存了天梯任务）要被换掉，且已领取的条数照旧占位
  s.level = 20;
  s.quests = { date: S.localDate(), list: [
    { key: 'rank', need: 2, rewards: [], claimed: false },
    { key: 'win', need: 2, rewards: [], claimed: true },
  ] };
  const fixed = S.questStatus();
  assert.equal(fixed.length, 4);
  assert.ok(!fixed.some((q) => q.key === 'rank'), '越级的旧题会被换掉：' + fixed.map((q) => q.key).join(','));
  assert.equal(fixed.filter((q) => q.claimed).length, 1, '已领取的 1 条继续占位，不会当天多领');
  // 升级到 30 级后：原本合法的题不会被换（只是池子变大）
  const keep = S.questStatus().map((q) => q.key).join(',');
  s.level = 30;
  assert.equal(S.questStatus().map((q) => q.key).join(','), keep, '升级不会换掉仍然能做的题');
});

test('音量/静音/分辨率/全面屏设置写进存档并读得回来', () => {
  const g = game(), S = g.State, s = S.state();
  same(s.settings, { volume: 1, muted: false, resolution: 'auto', fullscreen: false });
  assert.equal(S.RESOLUTIONS.length, 6, '六档分辨率');
  assert.equal(S.resolutionHeight('auto'), 0);
  assert.equal(S.resolutionHeight('1080'), 1080);
  assert.equal(S.resolutionHeight('4k'), 0, '认不出的档位当自动');
  S.setSettings({ volume: 0.35, muted: true, resolution: '900', fullscreen: true });
  same(S.settings(), { volume: 0.35, muted: true, resolution: '900', fullscreen: true });
  // 存档往返（浏览器存档模式下 save/load 走 localStorage）
  S.save(); S.load();
  same(S.state().settings, { volume: 0.35, muted: true, resolution: '900', fullscreen: true });
  // 坏值一律回落，不让坏档把画面或音量弄坏
  same(S.normalizeSettings({ volume: 'x', muted: 'yes', resolution: 42, fullscreen: 1 }),
    { volume: 1, muted: false, resolution: 'auto', fullscreen: false });
  same(S.normalizeSettings({ volume: 5 }), { volume: 1, muted: false, resolution: 'auto', fullscreen: false });
  same(S.normalizeSettings(null), { volume: 1, muted: false, resolution: 'auto', fullscreen: false });
  // 旧档（没有 settings 字段）读进来要有默认值
  const legacy = JSON.parse(JSON.stringify(s));
  delete legacy.settings;
  same(S.normalizeSettings(legacy.settings), { volume: 1, muted: false, resolution: 'auto', fullscreen: false });
});

test('挑战经验只看等级差：等级成长 20 级封顶、单位体力效率略低于竞技场，且每级越来越难', () => {
  const g = game();
  const S = g.State;
  // 同级/越级/低级
  for (const lv of [10, 20, 40, 60]) {
    const same = S.challengeExp(lv, lv);
    const up = S.challengeExp(lv + 3, lv);
    const down = S.challengeExp(lv - 3, lv);
    assert.ok(up > same, lv + ' 级打高 3 级应更多：' + up + ' vs ' + same);
    assert.ok(down < same, lv + ' 级打低 3 级应更少：' + down + ' vs ' + same);
  }
  // 等级差倍率与自身等级无关
  const ratioA = S.challengeExp(23, 20) / S.challengeExp(20, 20);
  const ratioB = S.challengeExp(43, 40) / S.challengeExp(40, 40);
  assert.ok(Math.abs(ratioA - ratioB) < 0.02, '等级差倍率应与自身等级无关：' + ratioA.toFixed(3) + ' vs ' + ratioB.toFixed(3));
  // 20 级封顶：之后单场经验不再随等级增长，但 20 级之前仍在慢慢涨
  assert.equal(S.challengeExp(60, 60), S.challengeExp(20, 20), '20 级之后应封顶');
  assert.equal(S.challengeExp(40, 40), S.challengeExp(20, 20), '20 级之后应封顶');
  assert.ok(S.challengeExp(19, 19) < S.challengeExp(20, 20), '20 级之前仍应增长');
  assert.ok(S.challengeExp(2, 2) < S.challengeExp(19, 19), '等级越高经验越多（封顶前）');
  // 单位体力效率：任何等级都不超过竞技场（150/30 = 5.0），挑战不再是刷经验的最优解
  const arenaPerEnergy = S.ARENA_EXP_PER_ENERGY;
  const perEnergy = (foeLevel, myLevel) => S.challengeExp(foeLevel, myLevel) / 10;   // 随机挑战 10 体力一场
  const [dMin, dMax] = S.CHALLENGE_DIFF_RANGE;
  for (let lv = 1; lv <= 60; lv++) {
    for (let d = dMin; d <= dMax; d++) {
      const exp = S.challengeExp(lv + d, lv);
      assert.ok(exp > 0, lv + '级差' + d + ' 经验应为正');
      assert.ok(exp / 10 <= arenaPerEnergy, lv + '级差' + d + ' 的挑战效率 ' + (exp / 10).toFixed(2) + ' 不应超过竞技场');
    }
  }
  // 封顶 + 最大等级差时略低于竞技场（同一体力口径），但不是低一大截
  const capMax = perEnergy(20 + dMax, 20), capSame = perEnergy(20, 20);
  assert.ok(capMax < arenaPerEnergy, '封顶最大等级差应略低于竞技场：' + capMax.toFixed(2));
  assert.ok(capMax > arenaPerEnergy * 0.6, '不应低太多：' + capMax.toFixed(2));
  assert.ok(capSame < arenaPerEnergy);
  // 每级越来越难：通关一级所需的同级场次单调递增
  let prev = 0;
  for (let lv = 1; lv <= 60; lv++) {
    const fights = S.challengeFightsPerLevel(lv);
    assert.ok(fights > prev, lv + ' 级应比上一级更慢：' + fights.toFixed(1) + ' vs ' + prev.toFixed(1));
    prev = fights;
  }
  // 与旧公式（27 + 等级×1.2）相比确实下调了
  assert.ok(S.challengeExp(20, 20) < 27 + 20 * 1.2, '20 级同级应低于旧公式，实际 ' + S.challengeExp(20, 20));
});

test('升级礼包：每级给消耗品，逢 5 级与属性书等级再给大礼包，并真的进背包', () => {
  const g = game(), S = g.State, s = S.state();
  const before = JSON.parse(JSON.stringify(s.props));
  // 逐级升到 6 级，收集每次升级的礼包
  const all = [];
  s.exp = 0;
  for (let i = 0; i < 60 && s.level < 6; i++) {
    for (const u of S.gainExp(g.GData.nextExp(s.level))) all.push(u);
  }
  assert.equal(s.level, 6, '应升到 6 级，实际 ' + s.level);
  assert.equal(all.length, 5, '升了 5 级就有 5 份礼包，实际 ' + all.length);
  for (const u of all) {
    assert.ok(Array.isArray(u.gifts) && u.gifts.length >= 1, '每级都应有礼包：' + JSON.stringify(u.gifts));
    assert.ok(u.gifts.every((x) => x.id && x.count > 0 && x.name), '礼包项要有 id/数量/名字');
    assert.equal(new Set(u.gifts.map((x) => x.id)).size, u.gifts.length, '同一次礼包不重复同一种道具');
  }
  // 逢 5 级的大礼包明显比普通等级多
  const lv5 = all.find((u) => u.level === 5);
  assert.ok(lv5.gifts.length >= 4, '5 级大礼包应更丰富，实际 ' + lv5.gifts.length);
  // 礼包真的进了背包
  const after = s.props;
  const totalAdded = all.reduce((n, u) => n + u.gifts.reduce((m, x) => m + x.count, 0), 0);
  const delta = Object.keys(after).reduce((n, k) => n + Math.max(0, (after[k] || 0) - (before[k] || 0)), 0);
  assert.ok(delta >= totalAdded, '礼包道具应全部进背包：新增 ' + delta + ' / 礼包 ' + totalAdded);
});

test('复仇：败绩可标记一次，复仇补偿是赢场经验的一部分且带金松果', () => {
  const g = game();
  const me = fighter({ name: '我' }), foe = fighter({ name: '宿敌', level: 30, hp: 100000, power: 80 });
  const result = g.Sim.simulate(me, foe);
  const saved = g.State.recordBattle({ me, foe, result, region: 3, kind: 'challenge' });
  assert.ok(saved && saved.id);
  assert.equal(!!g.State.battleHistory()[0].revenged, false, '新记录还没复仇过');
  assert.equal(g.State.markRevenged('不存在的 id'), false);
  assert.equal(g.State.markRevenged(saved.id), true);
  assert.equal(g.State.markRevenged(saved.id), false, '同一条记录只能算一次');
  assert.ok(g.State.battleHistory()[0].revenged > 0, '标记会写进战报并落盘');

  // 补偿量：低于赢一场（约 1.0× challengeExp），且有少量金松果
  const exp0 = g.State.state().exp, gold0 = g.State.state().goldPoint;
  const rw = g.State.revengeReward(30);
  const win = g.State.fightReward(true, { foeLevel: 30 });
  assert.ok(rw.exp > 0 && rw.gold >= 1 && rw.gold <= 3);
  assert.ok(rw.exp < win.exp, '复仇补偿 ' + rw.exp + ' 应少于赢一场 ' + win.exp);
  assert.ok(g.State.state().goldPoint >= gold0 + rw.gold);
  assert.equal(typeof g.State.REVENGE_EXP_RATIO, 'number');
  assert.ok(exp0 >= 0);
});

test('调试开关「12 小时一天」：过了中午算第二天，每日刷新 12 点也来一次', () => {
  const g = game();
  // 没有开关时：日期键只在午夜翻页
  g.advance(5 * 60 * 1000);                             // 23:55 → 次日 00:00
  assert.equal(g.State.localDate(), '2026-09-24');
  g.advance(13 * 60 * 60 * 1000);                       // → 13:00
  assert.equal(g.State.localDate(), '2026-09-24', '没开开关时下午仍是当天');

  // 打开开关（真实入口是调试面板，这里直接挂 vm 里的 window.Debug）
  g.ctx.Debug = { enabled: (key) => key === 'shortDay' };
  g.advance(-1 * 60 * 60 * 1000);                       // 回到 12:00 整
  assert.equal(g.State.localDate(), '2026-09-25', '12:00 起算第二天');
  g.advance(-60 * 1000);                                // 11:59
  assert.equal(g.State.localDate(), '2026-09-24', '11:59 仍是当天');

  // 端到端：每日礼包在「短日」里 12 点能再领一次
  const g2 = game();
  g2.ctx.Debug = { enabled: (key) => key === 'shortDay' };
  g2.advance(5 * 60 * 1000);                            // 次日 00:00
  assert.equal(g2.State.claimDaily().ok, true);
  assert.equal(g2.State.claimDaily().ok, false, '同一天不能领两次');
  g2.advance(12 * 60 * 60 * 1000);                      // → 12:00
  g2.State.refreshDaily();                              // 调试开关 on() 里手动跑的那一步
  const gold0 = g2.State.state().goldPoint;
  assert.equal(g2.State.claimDaily().ok, true, '12 点应当能再领一次每日礼包');
  assert.equal(g2.State.state().goldPoint, gold0 + 150);

  // 弟子日供的「昨天」跟着短日走（否则会结算成两天前）
  const g3 = game();
  assert.equal(g3.State.localDate(), '2026-09-23');
  g3.ctx.Debug = { enabled: (key) => key === 'shortDay' };
  g3.advance(60 * 60 * 1000);                           // 次日 00:55
  assert.equal(g3.State.localDate(), '2026-09-24');
  g3.advance(12 * 60 * 60 * 1000);                      // → 12:55
  assert.equal(g3.State.localDate(), '2026-09-25');
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS', name); }
  catch (error) { failed++; console.error('FAIL', name, error.stack); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
