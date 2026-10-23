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
  /* 默认按“老号”跑：新号前三天每日礼包会额外发新手福利，除了专门测它的用例，
   * 其它用例保持原来的金松果/道具期望。 */
  context.State.state().newbieStartDate = '';
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
  // 字典里 price 为 0 或占位 1 的（碎片/礼包/属性碎片/种子/超级药丸）不开放回收
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
  {
    const raw = s.gears.find((x) => x.key === orangeKey);
    assert.equal(S.gearInst(raw.id).quality, 4, '融合产物要落到原版 q4 橙装 id，不能再用紫装 id + orange 标记');
    assert.equal(raw.orange, undefined, 'q4 橙装不再需要实例级 orange 标记');
  }

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
  assert.ok(!noGem.some((l) => /（5金）|\(5金\)/.test(l)), '宝石按钮文案不带「（5金）」：' + JSON.stringify(noGem));
  s.props[101] = 1;
  assert.equal(S.socketGem(orangeKey, 101).ok, true, '镶嵌应当成功');
  const withGem = openGear(orangeKey);
  assert.ok(withGem.some((l) => l.indexOf('卸下宝石') === 0), '镶过宝石后详情里必须有「卸下宝石」：' + JSON.stringify(withGem));
  assert.ok(!withGem.some((l) => /（5金）|\(5金\)/.test(l)), '宝石按钮文案不带「（5金）」：' + JSON.stringify(withGem));

  /* ② 版式契约：详情弹窗的按钮**保持固定尺寸、只靠间距自适应**（用户口径 2026-10：
   *    「固定 UI 的长宽比，一行不同数量调整间距就行」），并且正文限高 ——
   *    两者合起来才能保证宝石按钮不会被画布裁掉。 */
  const css = fs.readFileSync(path.join(root, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(css, /\.gear-detail[\s\S]{0,400}?\.modal-body[\s\S]{0,200}?max-height:\s*\d+px/,
    'classic-refine.css 里必须给装备详情弹窗的正文限高（不然按钮会被挤到画布外）');
  assert.match(css, /\.gear-detail[\s\S]{0,400}?\.modal-buttons[^{}]*\{[^}]*flex-wrap:\s*nowrap/,
    '装备详情的按钮排要明确 nowrap（用户口径：一行放得下就别换行）');
  assert.ok(!/\.gear-detail[\s\S]{0,400}?\.modal-buttons[^{}]*\{[^}]*flex:\s*1\s+1\s+0/.test(css),
    '按钮不能被拉成等宽满填充（要保留游戏那套固定尺寸，只调间距）');
});

test('调试台「快进24小时」按当前界面推进时间，现代与经典互不影响', () => {
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
  g.ctx.addEventListener = () => {};
  g.ctx.removeEventListener = () => {};
  if (typeof g.ctx.setTimeout !== 'function') {
    g.ctx.setTimeout = () => 0;
    g.ctx.clearTimeout = () => {};
  }
  vm.runInContext(fs.readFileSync(path.join(root, 'js/debug.js'), 'utf8'), g.ctx, { filename: 'js/debug.js' });
  const fast = g.ctx.Debug.actions().find((a) => a.label === '快进24小时');
  assert.ok(fast, '调试台里应当有「快进24小时」这条工具');
  assert.ok(/另一个界面/.test(fast.note) && /日贡|日供/.test(fast.note), '说明要写清槽位隔离与弟子日供');

  const S = g.State, DAY = 24 * 60 * 60 * 1000;
  const today = S.localDate();
  const classic = S.state();
  classic.prentices = [{ name: '小徒', level: 70, since: '2026-01-01', joinedAt: 1, lastExpDate: '', tributeClaimedDate: '' }];
  classic.earnHistory = [{ date: today, exp: 1000, gold: 500 }];
  classic.energy = 0; classic.lastEnergyTs = Date.now();

  /* 现代槽位快进：只改现代；切回经典时经典还是今天、偏移仍是 0 */
  assert.equal(S.switchMode('modern').created, true);
  const modern = S.state();
  const modernDate = S.localDate();
  fast.run();
  assert.equal(modern.debugClockOffset, DAY, '现代槽位记下 24 小时偏移');
  assert.notEqual(S.localDate(), modernDate, '现代日期前进一天');
  S.switchMode('classic');
  assert.equal(Number(S.state().debugClockOffset) || 0, 0, '切换经典后不继承现代的偏移');
  assert.equal(S.localDate(), today, '经典日期没有被现代的快进改掉');

  /* 经典槽位再快进：体力回满、弟子日供按“新一天”结算 */
  fast.run();
  assert.equal(S.state().debugClockOffset, DAY, '经典槽位独立记下 24 小时偏移');
  assert.notEqual(S.localDate(), today, '经典日期也前进一天');
  assert.equal(S.state().energy, S.state().maxEnergy, '快进后体力回满');
  assert.ok(S.apprenticeDailyTotal().gold > 0, '今天的流水成为昨天的日供来源');
  const goldBefore = S.state().goldPoint;
  S.claimApprenticeExp();
  assert.ok(S.state().goldPoint > goldBefore, '弟子日供金松果到账');

  /* 再切回现代：现代仍是自己的 24 小时，不会被经典再叠加一次 */
  S.switchMode('modern');
  assert.equal(S.state().debugClockOffset, DAY, '现代偏移保持自己的 24 小时');
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

test('调试所得账本：只回收调试部分，保留玩家原有物品与等级', () => {
  const g = game(), S = g.State, s = S.state();
  const w = S.weaponList()[0], w2 = S.weaponList()[1] || S.weaponList()[0];
  const k = S.skillList()[0];
  s.props[1] = 10; s.goldPoint = 100; s.weapons = [w.id + ':2']; s.skills = [];
  const legitGear = S.addGear(1, S.randomExt(0)).key;
  const before = S.debugSnapshot();
  s.props[1] += 5; s.goldPoint += 1000;
  S.setWeapon(w.id, 9);            // 已有武器：只记「调试升到 9」
  if (w2.id !== w.id) S.setWeapon(w2.id, 5);   // 原来没有：记整件
  S.setSkill(k.id, 4);
  const debugGear = S.addGear(2, S.randomExt(0)).key;
  s.exp += 30;
  const changes = S.debugRecordDiff(before, '测试：调试发放');
  assert.ok(changes && changes.props && changes.props[1] === 5, '要记录道具净增量');
  assert.equal(changes.gold, 1000, '要记录金松果净增量');
  let sum = S.debugLedgerSummary();
  assert.ok(sum.hasData && sum.removable >= 4, '索引里要能看到可回收项：' + JSON.stringify(sum.entries));
  assert.equal(sum.entries.some((e) => e.kind === 'weapon' && e.id === w2.id && e.mode === 'remove'), w2.id !== w.id,
    '原来没有的武器应整件回收');
  assert.equal(sum.entries.some((e) => e.kind === 'weapon' && e.id === w.id && e.mode === 'restore' && e.before === 2), true,
    '原有武器应还原到调试前等级');
  assert.equal(sum.entries.some((e) => e.kind === 'gear' && e.key === debugGear), true, '调试生成的装备要能回收');
  s.props[1] -= 3;                 // 玩家消耗掉 3 个（无论哪一份，最多只能回收 2 个）
  const r = S.clearDebugGains();
  assert.equal(r.ok, true);
  assert.equal(s.props[1], 10, '只回到调试前基线，不能把玩家原有 10 个扣掉');
  assert.equal(s.goldPoint, 100, '只扣调试加的金松果');
  assert.equal(s.weapons.some((x) => Number(String(x).split(':')[0]) === w.id && String(x).endsWith(':9')), false,
    '原有武器要还原');
  assert.equal(s.weapons.includes(w.id + ':2'), true, '原有武器等级保留');
  assert.equal(s.weapons.some((x) => Number(String(x).split(':')[0]) === w2.id), false, '调试新武器要移除');
  assert.equal(s.skills.some((x) => Number(String(x).split(':')[0]) === k.id), false, '调试新技能要移除');
  assert.ok(s.gears.some((x) => x.key === legitGear), '玩家原有装备必须保留');
  assert.equal(s.gears.some((x) => x.key === debugGear), false, '调试装备必须移除');
  assert.equal(S.debugLedgerSummary().removable, 0, '清理后没有可回收项');
  assert.ok(S.debugLedgerSummary().history.length >= 2, '发放与清理都要留在索引里');
});

test('满级 90 级：经验不再升级，69 级 179、70 级 180、满级 200 体力上限', () => {
  const g = game(), S = g.State, s = S.state();
  assert.equal(S.MAX_PLAYER_LEVEL, 90);
  assert.equal(S.energyCapForLevel(1), 90);
  assert.equal(S.energyCapForLevel(2), 93);
  assert.equal(S.energyCapForLevel(10), 110);
  assert.equal(S.energyCapForLevel(20), 130);
  assert.equal(S.energyCapForLevel(30), 140);
  assert.equal(S.energyCapForLevel(69), 179);
  assert.equal(S.energyCapForLevel(70), 180);
  assert.equal(S.energyCapForLevel(90), 200);
  // 经验表：51~70 接 ssfight 原表，71~90 同曲线外推
  assert.equal(g.GData.nextExp(50), 7280);
  assert.equal(g.GData.nextExp(70), 38580);
  assert.equal(g.GData.nextExp(89), 166500);
  assert.equal(g.GData.nextExp(90), 179820);
  // 低等级段确实比以前低（旧曲线 10 级 117 / 20 级 137）
  assert.ok(S.energyCapForLevel(10) < 117 && S.energyCapForLevel(20) < 137, '低等级体力上限下调');
  // 一路喂经验到满级后不再升级
  s.exp = 0; S.gainExp(1e9);
  assert.equal(s.level, 90, '满级封顶');
  assert.equal(s.maxEnergy, 200, '满级体力上限 200');
  assert.equal(s.props[90], 20, '71~90 共 20 个金宝箱');
  S.save(); S.load();
  assert.equal(S.state().level, 90); assert.equal(S.state().maxEnergy, 200);
  // 旧档（旧成长曲线算出的更高上限）读档时被收回；超过 90 级的等级也压回 90
  g.storage.set(S.saveKey, JSON.stringify({ level: 70, maxEnergy: 999, props: {} }));
  S.load();
  assert.equal(S.state().maxEnergy, 180);
  g.storage.set(S.saveKey, JSON.stringify({ level: 99, maxEnergy: 300, props: {} }));
  S.load();
  assert.equal(S.state().level, 90);
  assert.equal(S.state().maxEnergy, 200);
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

/* 好友切磋的出手池：`friendFoe` 以前把 weapons / skills 清空，好友只会普攻，
 * 和随机挑战同一只对手的「武器 / 技能 / 普攻」权重抽取完全不是一回事。 */
test('好友切磋：武器/技能/装备跟快照一起进战斗，老档好友也要补出出手池', () => {
  const g = game(), S = g.State;
  const friend = {
    name: '切磋陪练', level: 20, power: 30, agility: 30, speed: 30, hp: 300,
    weapons: ['1:5', '4:3'], skills: ['1:3', '9:2'],
    gears: [{ id: 201, ext: [] }],
  };
  assert.equal(S.addFriend(friend).ok, true);
  const spar = S.friendFoe(S.friendList()[0]);
  assert.equal(spar.weapons.join(','), '1:5,4:3', '切磋要带武器池');
  assert.equal(spar.skills.join(','), '1:3,9:2', '切磋要带技能池');
  assert.equal(spar.gears.length, 1, '切磋要带装备（经典战斗里还要贴图）');
  /* 老档好友没有 skills：`friendFoe` 先走 ensureFriendLoadout 就地补，
   * 补完的出手池必须非空，否则又退回「只会普攻」。 */
  S.friendList()[0].skills = undefined;
  const oldSpar = S.friendFoe(S.friendList()[0]);
  assert.ok(oldSpar.skills.length > 0, '老档好友要补出技能池');
  assert.ok(oldSpar.weapons.length > 0, '老档好友要补出武器池');
});

/* 好友留言：原版「查看好友 → 留言」是外链留言板；离线版落存档。
 * 删除好友时要连留言一起清掉，不能留孤儿数据。 */
test('好友留言：落存档、只给好友留言、删除好友一起清掉', () => {
  const g = game(), S = g.State;
  assert.equal(S.leaveFriendMessage('不存在', '你好').ok, false, '不是好友不能留言');
  assert.equal(S.addFriend({ name: '留言对象', level: 10, power: 9, agility: 9, speed: 9, hp: 90 }).ok, true);
  assert.equal(S.leaveFriendMessage('留言对象', '   ').ok, false, '空留言不保存');
  const r = S.leaveFriendMessage('留言对象', '  你好，切磋吗？  ');
  assert.equal(r.ok, true);
  assert.equal(S.friendMessages('留言对象')[0].text, '你好，切磋吗？', '留言正文要 trim');
  S.save(); S.load();
  assert.equal(S.friendMessages('留言对象').length, 1, '留言要跟着存档往返');
  assert.equal(S.removeFriend('留言对象').ok, true);
  assert.equal(S.friendMessages('留言对象').length, 0, '删除好友要一起清掉留言');
});

/* 随机对手的「武器 + 技能」总数必须等于该等级的可拥有上限（不是随机个数）；
 * 高等级还要能随机出橙装与宝石，低等级不能出橙装。 */
test('随机对手：武技总数跟等级走，高等级能出橙装与宝石', () => {
  const g = game(), S = g.State;
  S.state().level = 70; S.save();
  const high = S.genAI(70, '', { levelJitter: 0 });
  assert.equal(high.weapons.length + high.skills.length, g.GData.wsLimit(70),
    '70 级随机对手的武技总数必须是 wsLimit(70)');
  let orange = 0, gem = 0, gemLevels = [];
  for (let i = 0; i < 240; i++) {
    const foe = S.genAI(70, '', { levelJitter: 0 });
    for (const gear of foe.gears || []) {
      if (!gear.orange) continue;
      orange++;
      if (gear.gem) { gem++; gemLevels.push(S.gemLevel(gear.gem.id)); }
    }
  }
  assert.ok(orange > 0, '70 级随机对手应能出橙装（实得 ' + orange + ' 件）');
  assert.ok(gem > 0, '橙装上应能随机镶宝石（实得 ' + gem + ' 颗）');
  assert.ok(gemLevels.every((lv) => lv >= 1 && lv <= 7), '宝石等级夹在 1~7：' + gemLevels.join(','));
  S.state().level = 10;
  const low = S.genAI(10, '', { levelJitter: 0 });
  assert.equal(low.weapons.length + low.skills.length, g.GData.wsLimit(10),
    '10 级随机对手的武技总数必须是 wsLimit(10)');
  assert.ok((low.gears || []).every((gear) => !gear.orange), '10 级不能出橙装');
});

/* 练功木桩：对齐 reference 里 `Stakes` 的口径 —— 木桩不判死亡，战斗按固定回合收尾。
 * 原版 `maxRounds` 是 60；这里按用户口径固定 10 回合（`DUMMY.rounds`），
 * 木桩只锁生命；本例固定随机流为 0.1，使流星锤三连触发，并用显式出招顺序验证真实事件。 */
test('练功木桩：10 次训练锁血但保留 800+ 伤害，分项纪录取真实出手并跨读档保存', () => {
  const g = game(), Sim = g.Sim;
  g.math.random = () => 0.1;
  const me = {
    name: '测试松鼠', level: 30, power: 10000, agility: 130, speed: 110, hp: 1200, maxHp: 1200,
    baseStats: { power: 10000, agility: 130, speed: 110 },
    weapons: [{ id: 10, level: 15 }], skills: [{ id: 12, level: 6 }], effects: {},
    pattern: ['common', 'weapon', 'skill'],
  };
  const dummy = {
    name: '测攻击木头人', level: 1, power: 0, agility: 15, speed: 0, hp: 800, maxHp: 800,
    baseStats: { power: 0, agility: 15, speed: 0, hp: 800 },
    weapons: [], skills: [], npcType: 'wood', effects: {},
    practice: true, practiceRounds: 10,
  };
  const r = Sim.simulate(me, dummy);
  assert.equal(r.rounds.length, 10, '固定 10 次出手就收尾（不会因为 800 血被打空提前结束）');
  assert.ok(r.rounds.every((x) => x.attacker === 0), '木桩不抢回合：10 次全是玩家出手');
  assert.ok(r.rounds.every((x) => x.hpAfter[0] === me.hp), '木桩不还手：玩家血量不减');
  const heavy = r.rounds.find((x) => x.action === 'common' && x.dmg > 800);
  assert.ok(heavy, '真实普攻事件必须保留 800+ 伤害，不能显示或统计成 799');
  assert.equal(heavy.hpAfter[1], 1, '伤害超过生命时，木桩锁在 1 血继续训练');
  const multi = r.rounds.find((x) => x.action === 'weapon' && x.hits === 3);
  assert.ok(multi && multi.dmg > 2400, '真实三连事件的三段均须完整累计，不能按木桩生命截伤害');
  assert.ok(r.rounds.every((x) => x.hpAfter[1] === Math.max(1, 800 - (Number(x.dmg) || 0))),
    '这一拍先扣血到最低 1，不能立刻回满或把 r.dmg 改成扣血量');
  assert.ok(r.rounds.slice(1).every((x, i) => Number(x.practiceHeal || 0) === 800 - r.rounds[i].hpAfter[1]),
    '从第二拍起，只恢复上一拍实际失去的生命');
  const dealt = r.rounds.reduce((n, x) => n + (x.attacker === 0 ? (Number(x.dmg) || 0) : 0), 0);
  assert.ok(dealt > 0, '木桩照常累计伤害：' + dealt);
  assert.equal(r.winner, 0, '木桩不还手，玩家按血量比例获胜');
  const record = g.State.recordWoodBattle(r);
  assert.equal(record.current.total, dealt);
  for (const [action, key] of [['common', 'handDamage'], ['weapon', 'weaponDamage'], ['skill', 'skillDamage']]) {
    const sum = r.rounds.filter((x) => x.action === action).reduce((n, x) => n + (x.dmg || 0), 0);
    assert.ok(sum > 0, action + ' 必须来自本场实际出手');
    assert.equal(record.best[key], sum);
  }
  const handOnly = g.Sim.simulate({ ...me, power: 20000, pattern: ['common'] }, dummy);
  g.State.recordWoodBattle(handOnly);
  g.State.load();
  assert.ok(g.State.state().woodBest.handDamage > record.best.handDamage);
  assert.equal(g.State.state().woodBest.weaponDamage, record.best.weaponDamage, '不同场次独立保留分项最佳');
  assert.equal(g.State.state().woodBest.skillDamage, record.best.skillDamage);
  assert.equal(g.State.state().woodCount, 2);
});

/* 经典主界面「消息」上的 new 红点：记账必须落在**存档**里。
 * 2026-10 用户报"每次打开游戏后消息必有 new" —— 根因是这份记账原来写在 localStorage
 * （`ssdz_msg_seen`），而桌面壳（Tauri）每次启动的 WebView 都是新数据目录、不保留 localStorage，
 * 于是红点每次都重新亮一次。这条用例钉两件事：① 存档往返后"看到哪了"不回退；
 * ② 未来时间戳（会让红点永远不亮）在读档时被夹回当下。 */
test('消息红点的「看到哪了」落存档：往返不回退，未来时间戳被夹回', () => {
  const g = game(), S = g.State;
  S.recordBattle({
    me: { name: '测试松鼠', level: 5, hp: 100, maxHp: 100, weapons: [], skills: [] },
    foe: { name: '对手', level: 5, hp: 100, maxHp: 100, weapons: [], skills: [] },
    result: { winner: 0, rounds: [{ attacker: 0, hpAfter: [90, 0] }], maxHp: [100, 100] },
  });
  const newest = g.State.battleHistory()[0].createdAt;
  assert.ok(newest > 0, '战斗记录应带 createdAt');
  assert.equal(S.msgSeenAt(), 0, '新档还没看过消息页 → 记账为 0（红点亮着）');
  assert.equal(S.markMessagesSeen(), newest, '看过一遍 → 记账推到最新一条的时间');
  assert.equal(JSON.parse(g.storage.get(S.saveKey)).msgSeenAt, newest, '记账必须立刻写进存档');
  S.load();
  assert.equal(S.msgSeenAt(), newest, '读档后不回退（否则每次进游戏红点又亮）');
  g.storage.set(S.saveKey, JSON.stringify(Object.assign(JSON.parse(g.storage.get(S.saveKey)), {
    msgSeenAt: Date.now() + 99999999,
  })));
  S.load();
  assert.ok(S.msgSeenAt() <= Date.now(), '未来时间戳被夹回当下（否则红点再也不亮）');
});

test('存档往返：剧情「只播一次」的记账与剧情模式开关必须保留（退出游戏再重进不能变回第一次）', () => {
  const g = game(), S = g.State;  /* 用户 2026-10 报的 bug：无尽塔玩到一半退出游戏再重进后，商人的第一次文案、第一次失去烙印、
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

test('每日任务种类够多（15 种挑 4 条，不含卖出），计数器覆盖全部任务', () => {
  const g = game(), S = g.State, s = S.state();
  assert.equal(S.QUEST_TYPES.length, 15, '15 种任务');
  const keys = S.QUEST_TYPES.map((t) => t.key);
  assert.equal(new Set(keys).size, 15, 'key 不重复');
  assert.ok(!keys.includes('sell'), '每日任务不再包含卖出');
  const list = S.questStatus();
  assert.equal(list.length, 4, '每天 4 条');
  assert.equal(new Set(list.map((q) => q.key)).size, 4, '同一天不重复抽同一种');
  for (const key of keys) assert.ok(key in s.dailyCounters, '计数器覆盖 ' + key);
  for (const q of list) assert.ok(q.need > 0 && q.name && !q.name.includes('{n}'), '任务文案要填好目标：' + q.name);
});

test('每日任务计数：合成/融合装备、宝石、使用/购买道具、拾取、天梯/切磋/挑战', () => {
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

test('连续登录：第1天100，每多一天+10，150封顶；附加奖励按日期在7种道具间轮换，断签回第1天', () => {
  const g = game();
  const day = 24 * 60 * 60 * 1000;
  const d1 = g.State.dailyStatus();
  const x1 = g.State.dailyGiftExtra(d1.date);
  assert.equal(d1.streak, 1); assert.equal(d1.gold, 100);
  assert.equal(d1.extra.id, x1.id, '每日礼包附加奖励必须与日期轮换表一致');
  assert.equal(d1.extra.count, 1);
  assert.equal(g.State.claimDaily().ok, true);
  assert.equal(g.State.state().props[x1.id], 1, '领取后附加道具进背包');
  const ids = [x1.id];
  for (let n = 2; n <= 7; n++) {
    g.advance(day);
    const d = g.State.dailyStatus();
    const x = g.State.dailyGiftExtra(d.date);
    assert.equal(d.streak, n, '第 ' + n + ' 天连续');
    assert.equal(d.gold, Math.min(150, 100 + (n - 1) * 10));
    assert.equal(d.extra.id, x.id, '第 ' + n + ' 天的附加奖励要轮换');
    ids.push(d.extra.id);
    assert.equal(g.State.claimDaily().ok, true);
    assert.ok(g.State.state().props[x.id] >= 1, '附加道具进背包');
  }
  assert.equal(g.State.state().loginStreak, 7);
  g.advance(day * 3);                       // 断签三天
  const d8 = g.State.dailyStatus();
  assert.equal(d8.streak, 1); assert.equal(d8.gold, 100);
  assert.equal(d8.extra.id, g.State.dailyGiftExtra(d8.date).id);
  assert.equal(new Set(ids).size, 7, '连续七天应轮换到七种不同附加道具');
  assert.deepEqual([...new Set(ids)].sort((a, b) => a - b), [23, 36, 39, 41, 42, 43, 82],
    '轮换池只能是挑战书/英雄帖/勇气徽章/召唤证/三种超级药丸');
});

test('新号前三天每日礼包额外发 3 个大体力药剂 + 150 金松果，第 4 天停止', () => {
  const g = game(), S = g.State, s = S.state();
  const day = 24 * 60 * 60 * 1000;
  s.newbieStartDate = S.localDate();
  s.goldPoint = 0; s.props[2] = 0;
  for (let n = 1; n <= 3; n++) {
    const d = S.dailyStatus();
    assert.equal(d.newbie && d.newbie.day, n, '第 ' + n + ' 天有新手福利');
    const r = S.claimDaily();
    assert.equal(r.ok, true);
    assert.equal(r.newbie && r.newbie.gold, 150);
    assert.equal(s.props[2], n * 3, '每天额外 3 个大体力药剂');
    if (n < 3) g.advance(day);
  }
  g.advance(day);
  const d4 = S.dailyStatus();
  assert.equal(d4.newbie, null, '第 4 天不再发新手福利');
  const beforeGold = s.goldPoint, beforeEnergy = s.props[2];
  const r4 = S.claimDaily();
  assert.equal(r4.ok, true);
  assert.equal(s.props[2], beforeEnergy, '第 4 天不再加大体力药剂');
  assert.equal(s.goldPoint, beforeGold + d4.gold, '第 4 天只发普通连续登录金松果');
});

test('每日奖励按照本地日期发放，同日重载后不重复领取', () => {
  const g = game(), s = g.State.state();
  const first = g.State.dailyStatus();
  const e1 = first.extra;
  assert.equal(g.State.claimDaily().ok, true);
  assert.equal(s.goldPoint, 200); assert.equal(s.props[e1.id], 1);
  assert.equal(g.State.claimDaily().ok, false);
  g.State.load(); assert.equal(g.State.claimDaily().ok, false);
  g.advance(6 * 60 * 1000);
  assert.equal(g.State.dailyStatus().claimed, false);
  const second = g.State.dailyStatus();
  const day2Gold = second.gold;   // 连续登录第 2 天：100 + 10
  assert.equal(g.State.claimDaily().ok, true);
  assert.equal(g.State.state().goldPoint, 200 + day2Gold);
  assert.equal(g.State.state().props[second.extra.id], 1, '第二天的轮换道具进背包');
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
  const claimedExtra = g.State.dailyGiftExtra(g.State.localDate());
  assert.equal(next.goldPoint, 200); assert.equal(next.props[claimedExtra.id], 1);
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
  assert.equal(s.weapons[0], '1:2'); assert.equal(s.goldPoint, 50);   // 原表第 1 行 coin = 50
  assert.equal(s.props[22], undefined);
  s.level = 7;
  assert.equal(g.State.doUpgrade('weapon', 1).ok, false);
  assert.equal(s.goldPoint, 50);
  s.props[22] = 7;
  assert.equal(g.State.doUpgrade('weapon', 1).ok, true);
  assert.equal(s.props[22], 0); assert.equal(s.weapons[0], '1:3');
});

test('普通1~9级升级一次 50 松果；每次失败 +2%，封顶 100%，成功清零', () => {
  // 把随机源钉成 1 → 概率判定必定失败
  const g = game(), S = g.State, s = S.state();
  g.math.random = () => 1;
  s.weapons = ['15:9']; s.level = 40; s.goldPoint = 100000; s.props[22] = 9999;
  const rates = [];
  for (let i = 0; i < 5; i++) { rates.push(S.upgradeInfo('weapon', 15).rate); S.doUpgrade('weapon', 15); }
  assert.deepEqual(rates, [10, 12, 14, 16, 18], '普通升级每次失败 +2%');
  assert.equal(S.upgradeInfo('weapon', 15).coin, 50, '一次 50 松果');
  for (let i = 0; i < 50; i++) S.doUpgrade('weapon', 15);
  assert.equal(S.upgradeInfo('weapon', 15).rate, 100, '失败够多后封顶 100%');
  // 随机源钉成 0 → 必定成功，成功后失败计数清零
  const g2 = game(), S2 = g2.State, s2 = S2.state();
  g2.math.random = () => 0;
  s2.weapons = ['15:9']; s2.level = 40; s2.goldPoint = 100000; s2.props[22] = 9999;
  assert.equal(S2.doUpgrade('weapon', 15).fails, 0);
  assert.equal(S2.upgradeFails('weapon', 15), 0, '成功即清零');
  assert.equal(s2.weapons[0], '15:10');
});

test('卖出装备按品质给价：白55-60 / 绿60-65 / 蓝65-70 / 紫90-110 / 橙180-220 / 黑500-700', () => {
  const g = game(), S = g.State;
  const expect = [[55, 60], [60, 65], [65, 70], [90, 110], [180, 220], [500, 700]];
  expect.forEach(([lo, hi], q) => {
    assert.deepEqual(Array.from(S.gearSellRange(q)), [lo, hi], '品质 ' + q + ' 区间');
    for (let i = 0; i < 60; i++) {
      const v = S.gearSellPrice(q);
      assert.ok(v >= lo && v <= hi, '品质 ' + q + ' 出价 ' + v + ' 应落在 ' + lo + '~' + hi);
    }
  });
  assert.deepEqual(Array.from(S.gearSellRange(9)), [500, 700], '越界品质夹到最高档');
  assert.deepEqual(Array.from(S.gearSellRange(-3)), [55, 60], '负品质夹到最低档');
});

test('黑装注册：281~288 可实例化，品质 5 / 使用等级 60 / 主属性按部位', () => {
  const g = game(), S = g.State;
  for (let id = 281; id <= 288; id++) {
    const gi = S.gearInst(id);
    assert.ok(gi, '黑装 ' + id + ' 应该有 gearMap/gearSetMap 行');
    assert.equal(gi.quality, 5, '黑装品质');
    assert.equal(gi.useLevel, 60, '黑装使用等级');
  }
  assert.equal(S.gearInst(281).abilityVal, 70, '凤凰头盔 +70 敏');
  assert.equal(S.gearInst(282).abilityVal, 70, '凤凰拳甲 +70 力');
  assert.equal(S.gearInst(283).abilityVal, 490, '凤凰铠甲 +490 生命');
  assert.equal(S.gearInst(284).abilityVal, 70, '凤凰短靴 +70 速');
  const made = S.addGear(281);
  assert.ok(made && made.quality === 5 && made.useLevel === 60, '黑装可以真的入包');
});

test('黑装支持镶嵌/卸下宝石：扣 5 金、主属性生效、卸下返还', () => {
  const g = game(), S = g.State;
  S.newGame('黑装宝石', { uiMode: 'classic' });
  const s = S.state();
  s.level = 90; s.goldPoint = 1000; s.props[103] = 1;
  const gear = S.addGear(281);
  assert.ok(gear, '黑装能入包');
  assert.equal(S.canSocketGem(gear), true, '黑装应被判定为可镶嵌');
  assert.equal(S.wear(gear.key), true, '黑装能穿戴');
  const before = S.totalStats().agility;
  const r = S.socketGem(gear.key, 103);
  assert.equal(r.ok, true, '黑装镶嵌应成功：' + r.msg);
  assert.equal(s.goldPoint, 995, '镶嵌扣 5 金松果');
  assert.equal(s.props[103], 0, '镶嵌消耗 1 颗三级宝石');
  assert.ok(s.gears.find((x) => x.key === gear.key).gem, '黑装实例上要写入 gem');
  assert.ok(S.totalStats().agility > before, '宝石主属性加成要进入总属性');
  const un = S.unsocketGem(gear.key);
  assert.equal(un.ok, true, '黑装卸下宝石应成功：' + un.msg);
  assert.equal(s.goldPoint, 990, '卸下再扣 5 金松果');
  assert.equal(s.props[103], 1, '卸下后宝石回到背包');
  assert.equal(s.gears.find((x) => x.key === gear.key).gem, undefined, '卸下后不再有 gem');
});

test('橙装 q4 使用原版初始属性：狂战 205-208 = 45/45/315/45，融合不再拿紫装底子', () => {
  const g = game(), S = g.State;
  S.newGame('橙装属性', { uiMode: 'classic' });
  const s = S.state();
  s.level = 90; s.goldPoint = 10000;
  const h = S.addGear(205), p = S.addGear(206), b = S.addGear(207), f = S.addGear(208);
  for (const [item, val] of [[h, 45], [p, 45], [b, 315], [f, 45]]) {
    assert.equal(item.quality, 4, '橙装应为 quality 4');
    assert.equal(item.abilityVal, val, '橙装主属性要取原版 q4 值，不能是紫装底子');
    assert.equal(item.useLevel, 50, '橙装使用等级 50');
  }
  assert.equal(S.gearInst(205).abilityVal, 45, 'gearInst(205) 也要是 q4 值');
  /* 三件紫狂战头 → 橙狂战头：目标应是 q4 id 205，不是 201 + orange 标记 */
  const mats = [S.addGear(201), S.addGear(201), S.addGear(201)];
  g.math.random = () => 0.5;   // 不触发 3% 变异，走同名保名
  const r = S.mergeGears(mats.map((x) => x.key));
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.gear.quality, 4, '紫→橙产物品质 4');
  assert.equal(r.gear.id, 205, '三件狂战头应合成 q4 狂战头 205');
  assert.equal(r.gear.abilityVal, 45, '产物主属性取 q4 的 45');
  assert.equal(s.gears.find((x) => x.key === r.gear.key).orange, undefined, 'q4 橙装不再用实例 orange 标记');
  /* 旧档迁移：紫 id + orange:true + 旧紫属性 → q4 id + q4 基准值 */
  s.gears.push({ id: 201, key: 'legacyOrange', used: false, ext: [], attr: 25, orange: true });
  S.save();
  const raw = JSON.parse(g.storage.get(S.saveKey));
  const legacy = raw.gears.find((x) => x.key === 'legacyOrange');
  legacy.orange = true; legacy.attr = 25;
  g.storage.set(S.saveKey, JSON.stringify(raw));
  assert.equal(S.load(), true);
  const migrated = S.state().gears.find((x) => x.key === 'legacyOrange');
  assert.equal(migrated.id, 205, '旧橙装迁移到同部位同名的 q4 id');
  assert.equal(migrated.attr, 45, '旧橙装迁移后主属性改为 q4 基准值');
  assert.equal(migrated.orange, undefined, '迁移后去掉实例 orange 标记');
});

test('现代界面删除黑装内容：不可获得/合成/开卡，读档清理；经典界面保留', () => {
  const g = game(), S = g.State;
  S.newGame('现代黑装', { uiMode: 'modern' });
  assert.equal(S.blackGearEnabled(), false);
  assert.equal(S.addGear(281), null, '现代界面不能获得黑装');
  const s = S.state();
  s.level = 90; s.goldPoint = 5000; s.props[77] = 10; s.props[80] = 1; s.props[89] = 1;
  assert.equal(S.composeGear(77).ok, false, '现代界面不能合成黑装');
  assert.equal(S.useProp(80, '71').ok, false, '现代界面不能开黑卡');
  assert.equal(S.useProp(89, '281').ok, false, '现代界面不能开黑装自选箱');
  assert.equal(S.blackCardOptions().length, 0);
  assert.equal(S.blackGearBoxOptions().length, 0);
  const before = JSON.stringify(S.totalStats());
  s.gears.push({ id: 281, used: true, key: 'bk', ext: [], attr: 70 });
  assert.equal(S.myGears().some((x) => x.id === 281), false, '现代界面的黑装不进装备列表');
  assert.equal(JSON.stringify(S.totalStats()), before, '现代界面的黑装不计属性');
  S.save(); S.load();
  assert.equal(S.state().gears.some((x) => x.id === 281), false, '读档时清掉现代槽位的黑装');
  assert.equal(S.state().props[80], undefined, '读档时清掉黑卡');

  S.newGame('经典黑装', { uiMode: 'classic' });
  assert.equal(S.blackGearEnabled(), true);
  assert.ok(S.addGear(281), '经典界面仍能获得黑装');
  assert.equal(S.blackCardOptions().length, 2);
  assert.equal(S.blackGearBoxOptions().length, 8);
});

test('黑装碎片合成：10 碎片 + 1000 金，四件优先给缺失部位', () => {
  const g = game(), S = g.State, s = S.state();
  s.goldPoint = 5000; s.props[77] = 40;
  const made = [];
  for (let i = 0; i < 4; i++) {
    const r = S.composeGear(77);
    assert.equal(r.ok, true, r.msg);
    made.push(r.gear);
  }
  assert.equal(new Set(made.map((x) => x.type)).size, 4, '四件部位不重复：' + made.map((x) => x.name).join(','));
  assert.equal(s.props[77], undefined, '40 个碎片刚好用完');
  assert.equal(s.goldPoint, 1000, '4 件 ×1000 金');
});

test('黑色卡片 / 黑装自选箱：选完才消耗，开出碎片/金松果/指定黑装', () => {
  const g = game(), S = g.State, s = S.state();
  s.props[80] = 1; s.props[89] = 1; s.goldPoint = 0;
  const need = S.useProp(80);
  assert.equal(need.ok, false); assert.equal(need.needsBlackChoice, true);
  assert.equal(s.props[80], 1, '没选之前不消耗卡片');
  const card = S.useProp(80, '71');
  assert.equal(card.ok, true, card.msg);
  assert.ok(s.props[77] >= 1 && s.props[77] <= 2, '凤凰碎片 1~2 个');
  assert.ok(s.goldPoint >= 100 && s.goldPoint <= 400, '黑卡另给 100~400 金');
  assert.ok(!(s.props[80] > 0), '选完消耗卡片');
  const boxNeed = S.useProp(89);
  assert.equal(boxNeed.ok, false); assert.equal(boxNeed.needsBlackGearChoice, true);
  assert.equal(s.props[89], 1);
  const box = S.useProp(89, '285');
  assert.equal(box.ok, true, box.msg);
  assert.ok(s.gears.some((x) => x.id === 285), '自选圣熊头盔进包');
  assert.ok(!(s.props[89] > 0), '选完消耗自选箱');
});

test('黑装融合：3 件黑装 → 1 件同部位黑装，20% 返 1 张黑卡', () => {
  const g = game(), S = g.State, s = S.state();
  s.goldPoint = 5000;
  g.math.random = () => 0.1;
  const a = S.addGear(281), b = S.addGear(281), c = S.addGear(281);
  const r = S.mergeGears([a.key, b.key, c.key], { allowMixedParts: true });
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.gear.quality, 5, '产物仍是黑装');
  assert.equal(r.gear.setId, 71, '留在凤凰套');
  assert.equal(r.card, 1, '20% 判定命中');
  assert.ok((s.props[80] || 0) >= 1, '黑色卡片真的入包');
  assert.equal(s.goldPoint, 4000, '黑装融合 1000 金');
});

test('橙装融合：3 件橙装 → 1 件黑装（原版 composeType=3）；现代界面拒绝', () => {
  const g = game(), S = g.State;
  S.newGame('橙合黑', { uiMode: 'classic' });
  const s = S.state(); s.level = 60; s.goldPoint = 5000;
  const mats = [0, 1, 2].map(() => S.addGear(205));
  const r = S.mergeGears([mats[0].key, mats[1].key, mats[2].key], { allowMixedParts: true });
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.gear.quality, 5, '3 橙装应融合出黑装');
  assert.equal(s.goldPoint, 4800, '橙装融合 200 金松果');
  assert.equal(s.gears.some((x) => x.orange), false, '橙装材料被消耗');

  S.newGame('现代橙合黑', { uiMode: 'modern' });
  const s2 = S.state(); s2.level = 60; s2.goldPoint = 5000;
  const mats2 = [0, 1, 2].map(() => S.addGear(205));
  const denied = S.mergeGears([mats2[0].key, mats2[1].key, mats2[2].key], { allowMixedParts: true });
  assert.equal(denied.ok, false, '现代界面没有黑装，橙装不能继续融合');
  assert.equal(s2.gears.filter((x) => Number(x.id) === 205).length, 3, '拒绝时材料不被消耗');
});

test('黑装宝箱档：金宝箱 8% 黑卡 / 2% 完整黑装，魔法袋必得 1 黑卡', () => {
  const g = game(), S = g.State, s = S.state();
  s.props[90] = 2; s.props[79] = 1;
  g.math.random = () => 0.45;                        // 金宝箱 [0.41,0.49) = 黑卡
  let r = S.openChestProp(90);
  assert.equal(r.reward.kind, 'prop'); assert.equal(r.reward.id, 80);
  assert.equal(s.props[80], 1, '8% 黑卡档入包');
  g.math.random = () => 0.50;                        // [0.49,0.51) = 完整黑装
  r = S.openChestProp(90);
  assert.equal(r.reward.kind, 'gear', '2% 完整黑装档');
  const blackIds = [181, 182, 183, 184, 185, 186, 187, 188, 281, 282, 283, 284, 285, 286, 287, 288];
  assert.ok(s.gears.some((x) => blackIds.includes(x.id)), '完整黑装真的进装备栏');
  g.math.random = () => 0.5;
  r = S.openChestProp(79);
  assert.equal(r.card, 1, '魔法袋额外给 1 张黑卡');
  assert.equal(s.props[80], 2, '黑卡累计');
  /* 金宝箱重开不再出完整黑装：同一随机点（0.50）首开是黑装，重开折成黑卡。 */
  s.props[90] = 1; s.goldPoint = 10000;
  g.math.random = () => 0.50;
  const opened = S.beginChest(90);
  assert.equal(opened.pending.reward.kind, 'gear', '首开 2% 档仍是完整黑装');
  g.math.random = () => 0.50;
  const again = S.reopenChest();
  assert.equal(again.pending.reward.kind, 'prop', '重开不出完整黑装');
  assert.equal(again.pending.reward.id, 80, '重开折成黑色卡片');
  assert.equal(S.confirmChest().ok, true);
});

test('无尽塔黑卡周限：每周最多 10 张，周一重置', () => {
  const g = game(), S = g.State, s = S.state();
  for (let i = 1; i <= 10; i++) assert.equal(S.grantEndlessBlackCard(1).gain, 1, '第 ' + i + ' 张');
  assert.equal(S.grantEndlessBlackCard(1).gain, 0, '第 11 张被周限拦住');
  assert.equal(s.props[80], 10);
  g.advance(7 * 86400000);
  assert.equal(S.grantEndlessBlackCard(1).gain, 1, '下一周重置后可再拿');
  assert.equal(s.props[80], 11);
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
  /* 2026-10 用户口径：勇气徽章（碎片竞技场入场券）每天 5 个。 */
  assert.equal(S.shopLimit(39), 5, '勇气徽章每日 5 个');
  assert.equal(S.purchaseStatus(39).limit, 5);
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

test('真·武器/真·技能：成功率与费用走原表，真化不保底；普通升级每次失败 +2%', () => {
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
  // 标准升阶（showWeaponSkill3 → upgradeWeapon(...,3,1)）：coin/book 与普通升级同一张表
  s.skills = ['12:10'];
  g.math.random = () => 1;                       // 必定失败，等级停在 10
  const costs = [];
  for (let i = 0; i < 5; i++) {
    const info = S.upgradeInfo('skill', 12);
    costs.push([info.coin, info.book]);
    S.doUpgrade('skill', 12);
  }
  assert.deepEqual(costs, [[100, 25], [100, 25], [100, 25], [100, 25], [100, 25]],
    '真1 标准升阶：100 松果 + 25 技能卷轴，固定不递增');
  const after = S.upgradeInfo('skill', 12);
  assert.equal(after.fails, 0, '真化线没有失败保底');
  assert.equal(after.rate, 100, '真1 成功率固定为原表 100%');
  s.skills = ['12:11'];
  for (let i = 0; i < 3; i++) S.doUpgrade('skill', 12);
  assert.equal(S.upgradeInfo('skill', 12).rate, 8, '真2 失败三次仍是 8%：真化线不吃 +2% 保底');
  // 普通升级（9→10）走第 9 行：50 松果、10% 固定
  s.skills = ['12:9'];
  const normal = S.upgradeInfo('skill', 12);
  assert.equal(normal.coin, 50);
  assert.equal(normal.isTrue, false);
  s.props[21] = 9999;
  S.doUpgrade('skill', 12);
  assert.equal(S.upgradeInfo('skill', 12).rate, 12, '普通升级失败一次 +2%');
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

test('5 级换装教程随机送一件 5 级可穿的白装', () => {
  const g = game(), S = g.State, s = S.state();
  s.level = 5;
  const gear = S.grantStarterGear();
  assert.ok(gear && gear.key, '应能抽到一件白装');
  assert.equal(gear.quality, 0, '只送白色装备');
  assert.equal(gear.useLevel, 5, '5 级可以立刻穿上');
  assert.ok(S.myGears().some((x) => x.key === gear.key), '装备已入背包');
  assert.equal(S.wear(gear.key), true, '教程送的装备能当场穿');
  assert.equal(S.grantStarterGear(), null, '同一个存档只能领一次');
  S.save(); S.load();
  assert.equal(S.grantStarterGear(), null, '读档后也不能重新触发');
});

test('装备穿戴等级、槽位互斥、融合材料和附加属性生效', () => {
  const g = game(), s = g.State.state();
  const one = g.State.addGear(1, [{ id: 28, level: 1 }]);
  assert.equal(one.useLevel, 5, '白装 5 级可穿（更换装备门槛已下调）');
  assert.equal(g.State.wear(one.key), false);
  s.level = 5;
  assert.equal(g.State.wear(one.key), true, '5 级可以穿戴');
  s.level = 20;
  const two = g.State.addGear(5);
  assert.equal(g.State.wear(two.key), true);
  assert.equal(g.State.myGears().find((x) => x.key === one.key).used, false);
  g.State.wear(one.key); s.skills = ['2:5'];
  assert.equal(g.State.totalStats().agility, s.agility + 1 + 12);
  g.State.unwear(one.key);
  const count = s.gears.length;
  assert.equal(g.State.mergeGears([one.key, one.key, one.key]).ok, false);
  const otherQuality = g.State.addGear(10);
  assert.equal(g.State.mergeGears([one.key, two.key, otherQuality.key]).ok, false, '跨部位允许，品质仍须一致');
  assert.equal(s.goldPoint, 100); assert.equal(s.gears.length, count + 1);
  const three = g.State.addGear(1), four = g.State.addGear(1);
  const result = g.State.mergeGears([one.key, three.key, four.key]);
  assert.equal(result.ok, true); assert.equal(result.gear.quality, 1);
  assert.equal(s.goldPoint, 70);   // 白装融合 30 金松果（按材料品质分档）
});

test('融合默认允许跨部位材料，现代与经典遵循同一品质要求', () => {
  const g = game(), S = g.State;
  const a = S.addGear(9), b = S.addGear(10), c = S.addGear(11);   // 绿装：头/手/衣服
  assert.equal(S.gearQuality(a), 1); assert.equal(S.gearQuality(b), 1); assert.equal(S.gearQuality(c), 1);
  const r = S.mergeGears([a.key, b.key, c.key]);
  assert.equal(r.ok, true, '默认接口也允许不同部位');
  assert.equal(r.gear.quality, 2, '同品质三件升一档');
});

test('融合词条：两件以上材料重合的词条必定继承（跨部位/跨名字）', () => {
  const g = game(), S = g.State;
  const mats = [
    S.addGear(21, [{ id: 1, level: 1 }, { id: 2, level: 1 }]),
    S.addGear(22, [{ id: 1, level: 2 }]),
    S.addGear(23, [{ id: 3, level: 1 }]),
  ];
  g.math.random = () => 0.9;    // 非必继承槽全部不中，且保名/随机取件不会越界
  const r = S.mergeGears(mats.map((x) => x.key), { allowMixedParts: true });
  assert.equal(r.ok, true);
  const ids = r.gear.ext.map((e) => e.id);
  assert.ok(ids.includes(1), '词条 1 在两件材料里出现，必须继承；实际 ' + ids.join(','));
  assert.equal(r.gear.ext.find((e) => e.id === 1).level, 2, '继承时取材料里的最高星级');
});

test('融合词条每个槽 50% 从材料继承，跨部位/跨名字也生效', () => {
  const g = game(), S = g.State;
  assert.equal(S.FUSION_EXT_INHERIT_RATE, 0.5, '每个产物词条槽的继承概率是 50%');
  /* 蓝装头/手/衣服（id 21/22/23）各带一条不同词条：三件完全不同部位、不同名字。 */
  const mats = [[1], [2], [3]].map((ids, i) => {
    const gear = S.addGear([21, 22, 23][i], ids.map((id) => ({ id, level: 1 })));
    gear.used = false;
    return gear;
  });
  g.math.random = () => 0;      // 每个继承判定都中，且每条都触发 +1 星
  const r = S.mergeGears(mats.map((x) => x.key), { allowMixedParts: true });
  assert.equal(r.ok, true);
  assert.equal(r.gear.ext.length, 2, '紫装产物两个词条槽');
  same(r.gear.ext.map((e) => e.id), [1, 2]);          // 两个槽分别从两件不同材料继承
  same(r.gear.ext.map((e) => e.level), [2, 2]);       // 继承后按 50% 概率升 1 星
  assert.ok(r.gear.ext.every((e) => [1, 2, 3].includes(e.id)), '继承的词条只能来自三件材料');
});

test('需求146：套装收益 —— 同名 2/4 件两档、按最低品质缩放，且真的进战斗', () => {
  const g = game(), s = g.State.state();
  s.level = 30;
  /* 套装收益只在现代模式启用；本用例验证机制本身，先切现代。 */
  g.State.setSettings({ uiMode: 'modern' });
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
  /* 经典版装备页没有套装收益介绍入口，因此玩家/AI 在经典模式下整套关闭，避免隐藏生效。 */
  s.settings.uiMode = 'classic';
  assert.equal(g.State.setBonusEffects().stats.speed, 0, '经典模式玩家套装属性必须关闭');
  assert.equal(g.State.totalStats().speed, speedWithShoe, '经典模式套装速度不能再进属性合计');
  assert.equal(g.State.setBonusList().length, 0, '经典模式不再列套装收益');
  assert.equal(g.State.setBonusForGear(57, 3), null, '经典模式装备详情不再显示套装小节');
  assert.equal(g.State.applySetBonuses(me), null, '经典模式玩家战斗修正必须为空');
  assert.equal(me.setFx, undefined, '经典模式不能给玩家留 setFx');
  /* 2026-10 用户口径：装备页上那条常驻的「套装收益：…」介绍行**已删**，
   * 套装效果只在**点开具体装备**时说明（详情里逐档标出哪一条已生效）。
   * 这里做源码级断言，避免有人手滑把它加回装备页。 */
  const src = fs.readFileSync(path.join(root, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(!/setBonusSummary/.test(src), '装备页的套装收益摘要函数应当已经删掉');
  assert.ok(!/gear-set-line/.test(src), '装备页不该再渲染套装收益那一行');
  assert.ok(/function setBonusBlock\(/.test(src), '装备详情里的套装小节要留着');
});

test('需求148：「更换装备」页按「穿着中 > 星标 > 获得顺序」展示（现代界面）', () => {
  const g = game();
  g.State.newGame('现代星标排序', { uiMode: 'modern' });
  const s = g.State.state();
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

test('经典模式没有星标：旧档 starred 既不拦出售/融合，也读不出来', () => {
  const g = game(), S = g.State;
  S.newGame('经典无星标', { uiMode: 'classic' });
  const s = S.state(); s.level = 60; s.goldPoint = 1000;
  const a = S.addGear(49), b = S.addGear(50), c = S.addGear(51);
  for (const raw of s.gears) if ([a.key, b.key, c.key].includes(raw.key)) raw.starred = true;
  assert.equal(S.isGearStarred(s.gears[0]), false, '经典模式忽略旧档星标');
  assert.equal(S.toggleGearStar(a.key).ok, false, '经典模式不能加星标');
  assert.ok(S.sellGear(c.key) > 0, '带旧星标的装备在经典模式仍可出售');
  const made = S.mergeGears([a.key, b.key, S.addGear(49).key], { allowMixedParts: true });
  assert.equal(made.ok, true, '带旧星标的装备在经典模式仍可融合：' + (made.msg || ''));
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
  same(stats, { power: s.power + 2, agility: s.agility + 4, speed: s.speed + 3, hp: s.maxHp + 8 });
  /* 真化被动按原表“再提高 N”逐档累加：力王真5 +39、风驰 +24、身强 +180。 */
  s.skills = ['1:15', '3:15', '4:15'];
  const trueStats = g.State.totalStats({ useProps: false });
  same(trueStats, { power: s.power + 39, agility: s.agility, speed: s.speed + 24, hp: s.maxHp + 180 });
  g.State.fightReward(true, { useProps: false });
  assert.equal(s.propsStates[3], 20); assert.equal(s.propsStates[7], 20);
  g.State.fightReward(true); assert.equal(s.propsStates[3], 19);
});

test('真化武器/技能数值严格对齐 ssfight 原表（不是真5端点线性插值）', () => {
  const g = game(), G = g.GData;
  // “有 N% 几率”类：当档绝对值
  assert.deepEqual([11, 12, 13, 14, 15].map((lv) => G.trueSkillValue(9, lv)), [2, 5, 9, 14, 20], '暴击 4 倍几率');
  assert.deepEqual([11, 12, 13, 14, 15].map((lv) => G.trueSkillValue(10, lv)), [0.5, 1, 2, 3, 5], '皮糙减暴击');
  assert.deepEqual([11, 12, 13, 14, 15].map((lv) => G.trueSkillValue(8, lv)), [8, 16, 28, 40, 56], '色诱脱装备');
  // “将再提高 N”类：逐真级累加
  assert.deepEqual([11, 12, 13, 14, 15].map((lv) => G.trueSkillValue(14, lv)), [2, 5, 9, 14, 20], '小宇宙累计 +20%');
  assert.deepEqual([11, 12, 13, 14, 15].map((lv) => G.trueSkillValue(18, lv)), [6, 14, 24, 36, 54], '吸铁累计 +54%');
  assert.deepEqual([11, 12, 13, 14, 15].map((lv) => G.trueSkillValue(24, lv)), [8, 16, 26, 36, 48], '致命反击累计 +48%');
  // 被动：1~10 级基础 + 真化累加
  assert.equal(G.passiveBonus(1, 15), 39, '力王真5 +39');
  assert.equal(G.passiveBonus(3, 15), 24, '风驰真5 +24');
  assert.equal(G.passiveBonus(4, 15), 180, '身强真5 +180');
  assert.equal(G.passiveBonus(5, 15), 47, '武器好手真5 +47');
  // 真武器追加效果是固定一次，不是每真级叠加
  assert.equal(G.trueWeaponBonus({ id: 4, level: 15 }, 'combo'), 5, '西瓜刀真化 +5% 连击');
  assert.equal(G.trueWeaponBonus({ id: 4, level: 10 }, 'combo'), 0, '普通形态不生效');
  // 真武器基础伤害按 harmAdd1 逐真级累计
  const w = g.State.weaponInst('4:15');
  assert.equal(w.harmLo, 142); assert.equal(w.harmHi, 150, '西瓜刀真5 142-150');
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
  const g = game(); g.math.random = () => 0.3;
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
  assert.equal(counts[0], 40); assert.equal(counts[1], 20);
});

test('无敌模式：玩家血量只增不减（残血进场也先顶满），超时不会按血量比例判负', () => {
  /* 2026-10 用户口径：开「无敌模式」后在无尽塔里还会被打死 —— 根因是以前只在几条主路径上
   * 兜到 1 点血，枯泉吸血 / 持续伤害 / 自伤这些旁路照旧掉血，血量被打到 1 之后
   * 120 手超时会按**血量比例**判负。现在给玩家侧装「只增不减」的 hp 访问器。 */
  const g = game();
  g.math.random = () => 0.5;
  /* 对照组：没有无敌时，枯泉（trialDry）会把玩家的血一路吸干（塔里还有连战继承的残血）。 */
  const plain = g.Sim.simulate(fighter({ hp: 30, maxHp: 100, power: 1 }),
    fighter({ hp: 100000, power: 1, mech: ['trialDry'] }));
  assert.equal(plain.rounds.some((r) => r.hpAfter[0] < 30), true, '对照组：血量确实会掉');
  /* 开无敌：残血 30/100 进场 → 先顶到上限，之后任何掉血都不写进计数器。 */
  g.ctx.Debug = { enabled: (key) => key === 'godMode' };
  const god = g.Sim.simulate(fighter({ hp: 30, maxHp: 100, power: 1 }),
    fighter({ hp: 100000, power: 1, mech: ['trialDry'] }));
  assert.equal(god.maxHp[0], 100, '上限不变');
  assert.equal(god.rounds.every((r) => r.hpAfter[0] === 100), true,
    '血量计数器全程保持 100：' + JSON.stringify(god.rounds.map((r) => r.hpAfter[0]).slice(0, 12)));
  assert.equal(god.rounds.every((r) => r.godSave !== true), true, '不会再走「兜到 1 点血」那条老路');
  assert.equal(god.winner, 0, '吸不动 + 超时按血量比例也是我方胜');
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
  const g = game(); g.math.random = () => 0.3;
  const attacker = fighter({ weapons: ['2:1'], hp: 10000 });
  const defender = fighter({ hp: 10000 });
  const plain = g.Sim.simulate(attacker, defender).rounds[0].dmg;
  const geared = g.Sim.simulate({ ...attacker, effects: { 6: 100, 13: 100 } }, defender).rounds[0].dmg;
  const reduced = g.Sim.simulate({ ...attacker, effects: { 6: 100, 13: 100 } }, { ...defender, effects: { 9: 50 } }).rounds[0].dmg;
  assert.equal(geared, plain * 3); assert.equal(reduced, Math.round(geared * 0.5));
});

test('徒手攻击的权重：基准 100，工具再多也让它的份额不低于 5%', () => {
  const g = game();
  /* kindWeights 收的是「候选对象」，权重按 .id 查 —— 与 pickKind 的调用口径一致。 */
  const cand = (ids) => ids.map((id) => ({ id }));
  const me = (ids) => fighter({ hp: 10000, usedWeapons: {}, usedSkills: {}, weapons: cand(ids), skills: cand(ids) });
  /* 徒手基准 = 100（2026-10 用户新口径）。 */
  const bare = g.Sim.kindWeights(me([]), [], []);
  assert.equal(bare.common, 100);
  assert.equal(bare.commonShare, 1);
  /* 一把武器：仍用基准 100，份额远高于保底。 */
  const one = g.Sim.kindWeights(me([2]), cand([2]), []);
  assert.equal(one.common, 100);
  assert.ok(one.commonShare > 0.3, '一把武器时徒手仍占三成以上：' + one.commonShare);
  /* 工具拉满（17 武器 + 17 技能，各 100 权重）：份额被压到保底 5%，权重被抬到基准之上。 */
  const ids = Array.from({ length: 17 }, (_, i) => i + 1);
  const heavy = g.Sim.kindWeights(me(ids), cand(ids), cand(ids));
  assert.ok(heavy.common > 100, '工具极多时徒手权重被抬到基准之上：' + heavy.common);
  assert.ok(Math.abs(heavy.commonShare - 0.05) < 1e-9, '保底正好 5%：' + heavy.commonShare);
  assert.equal(heavy.weapon + heavy.skill + heavy.common, heavy.total);
});

test('出手权重新表：技能 5 / 普通武器 8 / 投掷前两次 100 / 徒手 100；绝对防御与龟甲术按等级首/次/三次', () => {
  const g = game(), S = g.Sim;
  assert.equal(S.rules.repeatSkill, 5);
  assert.equal(S.rules.repeatWeapon, 8);
  assert.equal(S.rules.commonAttackWeight, 100);
  assert.equal(S.repeatRateOf(17, 1), 1, '来点松果二次及以后权重 1');
  assert.equal(S.actionWeights.skill({ usedSkills: { 15: true }, skillUseCount: { 15: 1 }, effects: {} }, 15), 5);
  const att = { weapons: [{ id: 1, type: '近战' }, { id: 5, type: '投掷' }, { id: 10, type: '投掷' }, { id: 7, type: '投掷' }], usedWeapons: {}, weaponUseCount: {}, effects: {} };
  assert.equal(S.actionWeights.weapon(att, att.weapons[0]), 100, '普通武器首次 100');
  att.usedWeapons[1] = true; att.weaponUseCount[1] = 1;
  assert.equal(S.actionWeights.weapon(att, att.weapons[0]), 8, '普通武器二次起 8');
  assert.equal(S.actionWeights.weapon(att, att.weapons[1]), 100, '投掷武器第一次 100');
  att.usedWeapons[5] = true; att.weaponUseCount[5] = 1;
  assert.equal(S.actionWeights.weapon(att, att.weapons[1]), 100, '投掷武器第二次仍 100');
  att.weaponUseCount[5] = 2;
  assert.equal(S.actionWeights.weapon(att, att.weapons[1]), 8, '投掷武器第三次起 8');
  /* 流星锤（10）/橡皮擦（7）虽是投掷，第二次起按近战 8；流星锤三连击仍只算一次使用。 */
  att.usedWeapons[10] = true; att.weaponUseCount[10] = 1;
  att.usedWeapons[7] = true; att.weaponUseCount[7] = 1;
  assert.equal(S.actionWeights.weapon(att, att.weapons[2]), 8, '流星锤第二次起 8');
  assert.equal(S.actionWeights.weapon(att, att.weapons[3]), 8, '橡皮擦第二次起 8');
  const d16 = (lv, n) => S.jueDuiChanceOf({ skills: { 16: lv }, effects: {}, skillBoost: {} }, n);
  assert.deepEqual([1, 5, 10].map((lv) => d16(lv, 0)), [20, 22, 24.5]);
  assert.deepEqual([11, 13, 15].map((lv) => d16(lv, 1)), [5, 15, 24]);
  assert.equal(d16(10, 1), 0.5); assert.equal(d16(15, 2), 0.5);
  const s7 = (lv, n) => S.shellChanceOf({ skills: { 7: lv }, effects: {}, skillBoost: {} }, n);
  assert.deepEqual([1, 5, 10].map((lv) => s7(lv, 0)), [20, 22, 24.5]);
  assert.deepEqual([11, 13, 15].map((lv) => s7(lv, 1)), [5, 15, 24]);
  assert.equal(s7(10, 1), 1); assert.equal(s7(15, 2), 1);
  /* 流星锤三连击：固定随机 0 必中 2% 那一下，一次行动打出 3 段。 */
  const meteor = fighter({ power: 100, weapons: [{ id: 10, level: 1 }], mods: { mustHitFirst: 1 }, hp: 100000 });
  const dummy = fighter({ power: 1, agility: 1, speed: 1, hp: 1000000, maxHp: 1000000 });
  g.math.random = () => 0;
  const wround = g.Sim.simulate(meteor, dummy).rounds.find((r) => r.attacker === 0 && r.action === 'weapon');
  assert.equal(wround && wround.hits, 3, '流星锤应当有连续扔 3 次的概率并且一次行动打出 3 段');
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
  const oversized = Array.from({ length: 58 }, (_, i) => ({ ...saved, id: 'old-' + i,
    foe: { ...saved.foe, name: i < 50 ? '保留-' + i : '已删除的旧录像' } }));
  // 导出/写盘本身也要收口：不依赖 recordBattle，不能只在消息列表上截显示。
  g.State.state().battles = oversized.slice();
  assert.equal(JSON.parse(g.State.exportPayload()).battles.length, 50);
  assert.equal(g.State.state().battles.length, 50);
  const base = JSON.parse(g.State.exportPayload());
  const old = { ...base, level: 10, battles: oversized, __dualMode: 'classic',
    __dualOther: { ...base, level: 10, settings: { ...base.settings, uiMode: 'modern' }, battles: oversized } };
  const before = JSON.stringify(old);
  g.storage.set(g.State.saveKey, before);
  g.State.load();
  const after = g.storage.get(g.State.saveKey), disk = JSON.parse(after);
  assert.equal(disk.battles.length, 50);
  assert.equal(disk.__dualOther.battles.length, 50, '未激活的另一槽也必须从存档删掉超额录像');
  assert.ok(after.length < before.length);
  assert.ok(!after.includes('已删除的旧录像'), '同日读旧档后主动回写，删除的数据不再占存档');
  g.State.switchMode('modern');
  g.State.recordBattle({ me: fighter(), foe: fighter({ name: '现代新战报' }), result: saved.result });
  assert.equal(g.State.battleHistory().length, 50);
  assert.equal(g.State.battleHistory()[0].foe.name, '现代新战报');
  const legacy = { ...old, __dualOther: undefined, __dualSaves: { modern: old.__dualOther } };
  g.storage.set(g.State.saveKey, JSON.stringify(legacy));
  g.State.load();
  const migrated = JSON.parse(g.storage.get(g.State.saveKey));
  assert.equal(migrated.battles.length, 50);
  assert.equal(migrated.__dualOther.battles.length, 50);
  assert.ok(!('__dualSaves' in migrated), '旧双槽格式回写后不再留下重复录像数组');
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
  assert.equal(count(1), 9, '1 级池子（已去掉卖出）：' + S.questPoolFor(1).map((t) => t.key).join(','));
  assert.equal(S.hasUpgradableWS(2), false, '2 级时 1 级武器还升不动（需要玩家 5 级）');
  assert.equal(count(2), 9, '升不动就不该出现升级任务');
  assert.equal(count(4), 9);
  assert.equal(S.hasUpgradableWS(5), true, '5 级起 1→2 的等级门槛满足');
  assert.equal(count(5), 10);
  assert.equal(count(10), 12);
  assert.equal(count(11), 13);
  assert.equal(count(30), 14);
  assert.equal(count(45), 15, '45 级才是全部 15 种');
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

test('音量/静音/分辨率/全面屏/状态栏/跳过显示/界面模式写进存档并读得回来', () => {
  const g = game(), S = g.State, s = S.state();
  same(s.settings, { volume: 1, muted: false, resolution: 'auto', fullscreen: false, hideStatusBar: true, showSkip: true, uiMode: 'classic' });
  assert.equal(S.RESOLUTIONS.length, 6, '六档分辨率');
  assert.equal(S.UIMODES.length, 2, '两档界面模式');
  assert.equal(S.resolutionHeight('auto'), 0);
  assert.equal(S.resolutionHeight('1080'), 1080);
  assert.equal(S.resolutionHeight('4k'), 0, '认不出的档位当自动');
  S.setSettings({ volume: 0.35, muted: true, resolution: '900', fullscreen: true, hideStatusBar: false, uiMode: 'classic' });
  same(S.settings(), { volume: 0.35, muted: true, resolution: '900', fullscreen: true, hideStatusBar: false, showSkip: true, uiMode: 'classic' });
  // 存档往返（浏览器存档模式下 save/load 走 localStorage）
  S.save(); S.load();
  same(S.state().settings, { volume: 0.35, muted: true, resolution: '900', fullscreen: true, hideStatusBar: false, showSkip: true, uiMode: 'classic' });
  // 坏值一律回落，不让坏档把画面或音量弄坏（界面模式认不出时按默认经典）
  same(S.normalizeSettings({ volume: 'x', muted: 'yes', resolution: 42, fullscreen: 1, uiMode: 'neon' }),
    { volume: 1, muted: false, resolution: 'auto', fullscreen: false, hideStatusBar: true, showSkip: true, uiMode: 'classic' });
  same(S.normalizeSettings({ volume: 5 }), { volume: 1, muted: false, resolution: 'auto', fullscreen: false, hideStatusBar: true, showSkip: true, uiMode: 'classic' });
  same(S.normalizeSettings(null), { volume: 1, muted: false, resolution: 'auto', fullscreen: false, hideStatusBar: true, showSkip: true, uiMode: 'classic' });
  // 旧档（没有 settings 字段）读进来要有默认值
  const legacy = JSON.parse(JSON.stringify(s));
  delete legacy.settings;
  same(S.normalizeSettings(legacy.settings), { volume: 1, muted: false, resolution: 'auto', fullscreen: false, hideStatusBar: true, showSkip: true, uiMode: 'classic' });
});

test('跳过键：超级松鼠 10 级解锁、非 VIP 20 级；系统页开关可隐藏', () => {
  const g = game(), S = g.State, s = S.state();
  const day = 24 * 60 * 60 * 1000;
  s.level = 10;
  s.vip = { level: 1, exp: 0, until: 0, capAdded: 0, capApplied: false, lastDaily: '' };
  assert.equal(S.unlockedSkip(), false, '10 级非 VIP 还不解锁');
  s.vip.until = Date.now() + day;
  assert.equal(S.unlockedSkip(), true, '超级松鼠 10 级解锁跳过');
  assert.equal(S.skipButtonEnabled(), true, '默认显示跳过键');
  S.setSettings({ showSkip: false });
  assert.equal(S.skipButtonEnabled(), false, '系统页关闭后不显示跳过键');
  S.setSettings({ showSkip: true });
  s.vip.until = 0;
  s.level = 19;
  assert.equal(S.unlockedSkip(), false, '非 VIP 19 级未解锁');
  s.level = 20;
  assert.equal(S.unlockedSkip(), true, '非 VIP 20 级解锁');
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

test('升级礼包：每级给消耗品，逢 5 级再给大礼包，并真的进背包', () => {
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

test('商店：47号需要30级；数量购买按单价×数量扣费', () => {
  const g = game(), s = g.State.state();
  s.goldPoint = 100000; s.level = 29;
  const bad = g.State.buyProp(47, 1);
  assert.equal(bad.ok, false); assert.equal(bad.levelLocked, true);
  s.level = 30;
  const gold0 = s.goldPoint, own0 = s.props[1] || 0;
  const r = g.State.buyProp(1, 3);
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.props[1], own0 + 3);
  assert.equal(s.goldPoint, gold0 - 3 * Number(g.window.propMap.getValue(1).price));
});

test('金宝箱/魔法袋：道具已注册，开箱消耗 1 个并落到背包/属性/金松果', () => {
  const g = game(), s = g.State.state();
  assert.equal(g.window.propMap.getValue(90).name, '金宝箱');
  assert.equal(g.window.propMap.getValue(79).name, '魔法袋');
  s.props[90] = 2; s.props[79] = 1;
  const before = { gold: s.goldPoint, free: s.freePoints || 0, hatch: s.hatchPoint || 0, g105: s.props[105] || 0, g106: s.props[106] || 0 };
  const r1 = g.State.openChestProp(90);
  assert.equal(r1.ok, true);
  assert.equal(s.props[90], 1);
  assert.ok(r1.reward && r1.reward.count > 0);
  assert.ok(s.goldPoint > before.gold || (s.freePoints || 0) > before.free || (s.hatchPoint || 0) > before.hatch
    || (s.props[105] || 0) > before.g105 || (s.props[106] || 0) > before.g106, '开箱奖励必须真的入账');
  const r2 = g.State.openChestProp(79);
  assert.equal(r2.ok, true);
  assert.ok(!(s.props[79] > 0), '魔法袋消耗完');
  assert.equal(g.State.openChestProp(79).ok, false, '没有魔法袋时不能再开');
});

test('金宝箱重开：金松果逐档上涨、重开不消耗箱子、500 次封顶、确认才入账', () => {
  const g = game(), s = g.State.state();
  s.props[90] = 1; s.goldPoint = 1000000;
  const b = g.State.beginChest(90);
  assert.equal(b.ok, true);
  assert.ok(!(s.props[90] > 0), '开箱消耗 1 个金宝箱');
  assert.equal(g.State.chestState().lotteryCount, 0);
  assert.deepEqual([0, 3, 6, 9, 12, 499, 500].map(g.State.chestReopenCost), [50, 75, 100, 150, 200, 8300, 0]);
  const r = g.State.reopenChest();
  assert.equal(r.ok, true); assert.equal(r.cost, 50);
  assert.equal(s.goldPoint, 1000000 - 50);
  assert.equal(g.State.chestState().lotteryCount, 1);
  assert.ok(!(s.props[90] > 0), '重开不再消耗金宝箱');
  s.goldPoint = 10000000;
  for (let i = 1; i < 500; i++) assert.equal(g.State.reopenChest().ok, true, '第 ' + (i + 1) + ' 次重开');
  assert.equal(g.State.chestState().lotteryCount, 500);
  assert.equal(g.State.reopenChest().ok, false, '500 次后不能再重开');
  const c = g.State.confirmChest();
  assert.equal(c.ok, true);
  assert.equal(g.State.chestState(), null);
  // 待领取结果落存档：读档会自动入账，不会把箱子消耗掉却丢掉奖励
  s.props[90] = 1; g.State.beginChest(90); g.State.save();
  g.State.load();
  assert.equal(g.State.chestState(), null, '读档自动结算待领取结果');
});

test('复仇：败绩可标记一次，复仇补偿是赢场经验的一部分且带金松果', () => {
  const g = game();
  const me = fighter({ name: '我' }), foe = fighter({ name: '宿敌', level: 30, hp: 100000, power: 80 });
  const result = g.Sim.simulate(me, foe);
  const saved = g.State.recordBattle({ me, foe, result, region: 3, kind: 'challenge' });
  assert.ok(saved && saved.id);
  assert.equal(!!g.State.battleHistory()[0].revenged, false, '新记录还没复仇过');
  const rv0 = g.State.revengeInfo(saved.id);
  assert.deepEqual([rv0.count, rv0.cost, rv0.cups, rv0.cupsMin], [0, 20, 0, 0], '普通挑战复仇不抢金杯');
  assert.equal(rv0.ladder, false);
  /* 只有天梯赛败绩的复仇才有金杯（0~1）。 */
  const rankSaved = g.State.recordBattle({ me, foe, result, region: 2, kind: 'rank' });
  const rankRv = g.State.revengeInfo(rankSaved.id);
  assert.deepEqual([rankRv.cups, rankRv.cupsMin, rankRv.ladder], [1, 0, true], '天梯复仇才有 0~1 金杯');
  assert.equal(g.State.noteRevenge(saved.id), 1);
  const rv1 = g.State.revengeInfo(saved.id);
  assert.deepEqual([rv1.count, rv1.cost, rv1.cups, rv1.cupsMin], [1, 40, 0, 0], '普通挑战复仇涨价后也不抢金杯');
  assert.equal(g.State.markRevenged('不存在的 id'), false);
  assert.equal(g.State.markRevenged(saved.id), true);
  assert.equal(g.State.markRevenged(saved.id), false, '同一条记录只能算一次');
  assert.ok(g.State.battleHistory().find((b) => b.id === saved.id).revenged > 0, '标记会写进战报并落盘');

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
  const dailyGold = g2.State.dailyStatus().gold;
  assert.equal(g2.State.claimDaily().ok, true, '12 点应当能再领一次每日礼包');
  assert.equal(g2.State.state().goldPoint, gold0 + dailyGold, '奖励按连续登录天数递增');

  // 弟子日供的「昨天」跟着短日走（否则会结算成两天前）
  const g3 = game();
  assert.equal(g3.State.localDate(), '2026-09-23');
  g3.ctx.Debug = { enabled: (key) => key === 'shortDay' };
  g3.advance(60 * 60 * 1000);                           // 次日 00:55
  assert.equal(g3.State.localDate(), '2026-09-24');
  g3.advance(12 * 60 * 60 * 1000);                      // → 12:55
  assert.equal(g3.State.localDate(), '2026-09-25');
});

test('双界面存档：经典/现代进度互不覆盖，切换/重载各回各的槽位', () => {
  const g = game(), S = g.State, storage = g.storage;
  S.state().name = '经典号';
  S.state().level = 12;
  S.save();
  const r = S.switchMode('modern');
  assert.equal(r.created, true, '目标界面还没有存档时新建 1 级角色');
  assert.equal(S.state().level, 1);
  assert.equal(S.activeUiMode(), 'modern');
  assert.equal(S.state().settings.uiMode, 'modern');
  S.state().name = '现代号';
  S.state().level = 22;
  S.save();
  assert.equal(S.switchMode('classic').created, false);
  assert.equal(S.state().name, '经典号');
  assert.equal(S.state().level, 12);
  assert.equal(S.switchMode('modern').created, false);
  assert.equal(S.state().name, '现代号');
  assert.equal(S.state().level, 22);
  const raw = JSON.parse(storage.get(S.saveKey));
  assert.equal(raw.__dualMode, 'modern');
  assert.equal(raw.__dualOther.name, '经典号', '另一界面只存在 __dualOther，顶层仍是当前界面');
  storage.set('ssdz_ui_mode', 'classic');
  assert.equal(S.load(), true);
  assert.equal(S.state().name, '经典号');
  storage.set('ssdz_ui_mode', 'modern');
  assert.equal(S.load(), true);
  assert.equal(S.state().name, '现代号');
});

test('旧单槽存档按 uiMode 认领，另一界面从 1 级开始', () => {
  const g = game(), S = g.State, storage = g.storage;
  storage.delete('ssdz_ui_mode');
  storage.set(S.saveKey, JSON.stringify({ name: '旧现代号', level: 25, settings: { uiMode: 'modern' } }));
  assert.equal(S.load(), true);
  assert.equal(S.activeUiMode(), 'modern');
  assert.equal(S.state().name, '旧现代号');
  assert.equal(S.switchMode('classic').created, true);
  assert.equal(S.state().level, 1);
  assert.equal(S.switchMode('modern').created, false);
  assert.equal(S.state().name, '旧现代号');
});

test('村庄建筑：祭坛当日状态、神迹属性点、幻兽升级/孵化/编队/喂养', () => {
  const g = game(), S = g.State;
  /* 最低使用等级：祭坛 1 / 幻兽 25 / 神迹 30；未到等级时建筑不可用。 */
  S.state().level = 1;
  assert.equal(S.building('altar').level, 1, '祭坛从村庄开放即可用');
  assert.equal(S.building('beast'), null, '低级时幻兽牧场不可用');
  assert.equal(S.building('miracle'), null, '低级时神迹不可用');
  assert.equal(S.buildingUnlockLevel('altar'), 1);
  assert.equal(S.buildingUnlockLevel('beast'), 25);
  assert.equal(S.buildingUnlockLevel('miracle'), 30);
  assert.equal(S.WAR_UNLOCK_LEVEL, 35);
  S.state().level = 30;
  S.state().goldPoint = 10000;
  S.save();
  // 祭坛：一天一次的随机状态
  const altar = S.building('altar');
  assert.equal(altar.level, 1);
  const buff = S.claimBuildingBuff('altar');
  assert.equal(buff.ok, true);
  const buffKind = buff.buffId === 1 ? 'arenaExp' : buff.buffId === 2 ? 'arenaProp' : 'stageGold';
  assert.equal(S.activeBuildingBuff(buffKind), true, '祭坛当日状态必须被判为生效');
  assert.ok(S.buildingDoubleRate('altar', buffKind) > 0, '祭坛等级对应的双倍几率要落实');
  assert.equal(S.claimBuildingBuff('altar').ok, false, '同一天只能领一次');
  // 祭坛升级（倒计时完成结算）
  assert.equal(S.upgradeBuilding('altar').ok, true);
  S.state().buildings.altar.doneAt = g.ctx.Date.now() - 1;
  S.settleBuildings();
  assert.equal(S.building('altar').level, 2, '祭坛升级完成');
  // 神迹升级：完成时发一个随机属性点并记进记录
  assert.equal(S.upgradeBuilding('miracle').ok, true);
  S.state().buildings.miracle.doneAt = g.ctx.Date.now() - 1;
  S.settleBuildings();
  const rec = S.miracleRecord();
  assert.equal(S.building('miracle').level, 2);
  assert.equal(rec.power + rec.agility + rec.speed + rec.hp / 5, 1, '神迹完成时恰好加 1 个属性点');
  // 幻兽牧场：升级 +200 孵化点、+1 存储格
  assert.equal(S.state().hatchPoint, 1000);
  assert.equal(S.upgradeBuilding('beast').ok, true);
  S.state().buildings.beast.doneAt = g.ctx.Date.now() - 1;
  S.settleBuildings();
  assert.equal(S.building('beast').level, 2);
  assert.equal(S.state().hatchPoint, 1200);
  assert.equal(S.state().petsCapacity, 7);
  // 孵化 3 只，编队 1 只，喂养消耗剩下的
  const h1 = S.hatchPet(); assert.equal(h1.ok, true);
  const h2 = S.hatchPet(); assert.equal(h2.ok, true);
  const h3 = S.hatchPet(); assert.equal(h3.ok, true);
  assert.equal(S.pets().length, 3);
  assert.equal(S.state().hatchPoint, 600);
  const t1 = S.setPetTeam([h1.pet.key]);
  assert.equal(t1.ok, true, t1.msg);
  const before = S.petByKey(h1.pet.key).level;
  const fed = S.feedPet(h1.pet.key);
  assert.equal(fed.ok, true, fed.msg);
  assert.ok(S.petByKey(h1.pet.key).level >= before);
  assert.equal(S.pets().length, 1, '两只材料被消耗');
  assert.equal(S.state().petsTeam.length, 1, '出战幻兽不会被喂掉');
  // 进化：目标在出战队伍里也能进化；材料从队伍外的同星级幻兽补
  S.setPetTeam([h1.pet.key]);
  const evoBase = S.petByKey(h1.pet.key);
  for (let i = 0; i < 2; i++) {
    S.state().pets.push({ key: 'evo' + i, id: evoBase.id, name: evoBase.name, grade: evoBase.grade,
      maxLevel: evoBase.maxLevel, leadership: evoBase.leadership, skillId: evoBase.skillId,
      level: 1, exp: 0, nextExp: 100 });
  }
  const evo = S.evolvePet(evoBase.key, ['evo0', 'evo1']);
  assert.equal(evo.ok, true, evo.msg);
  assert.equal(evo.pet.grade, evoBase.grade + 1, '进化后高一星');
  same(S.state().petsTeam, [evo.pet.key], '出战目标进化后，新幻兽要补回出战队伍');
  same(evo.materials, [evoBase.name, evoBase.name]);
  assert.equal(evo.materials.length, 2, '进化要消耗玩家明确选中的两只材料');
  S.state().pets.push({ key: 'skillProbe', id: 1, name: '技能探针', grade: 1, maxLevel: 10,
    leadership: 5, skillId: 7, level: 1, exp: 0, nextExp: 100 });
  const skillInfo = S.pets().find((p) => p.key === 'skillProbe');
  same([skillInfo.skillValue, skillInfo.skillNextValue, skillInfo.skillLevelupRemark],
    [11, 12, '额外承受伤害提高至X%'], '详情页要知道 X 的当前值/下一级值，说明里的 X 由页面替换');
  // 幻兽战斗加成与随机敌人幻兽
  const team = S.setPetTeam([evo.pet.key]);
  if (!team.ok) S.setPetTeam([]);
  const bonus = S.petBattleBonus(S.petTeam());
  assert.ok(bonus.power + bonus.agility + bonus.speed + bonus.hp > 0, '出战幻兽要给战斗加成');
  const target = { power: 10, agility: 10, speed: 10, hp: 100, maxHp: 100 };
  S.applyPetBonuses(target, S.petTeam());
  assert.ok(target.maxHp >= 100 && target.power >= 10, '战斗面板能落到属性上');
  const foes = S.randomPetLoadout(50);
  assert.ok(foes.length >= 1 && foes.length <= 3, '随机敌人 1~3 只幻兽');
  assert.ok(foes.every((p) => p.level >= 1 && p.name), '随机敌人幻兽有等级和名字');
});

/* 幻兽加血不能把「只有 hp、没有 maxHp」的 AI 压成 1+bonus 的低血量：
 * 那会让 Sim 把敌人当前血量夹到几十点，经典血条从满血一帧掉到 0。 */
test('幻兽加血：没有 maxHp 的对手按当前满血加上限，不能被压成几十点', () => {
  const g = game(), S = g.State;
  const target = { power: 10, agility: 10, speed: 10, hp: 700 };
  S.applyPetBonuses(target, [{ grade: 4, level: 10, skillId: 4 }]);
  const bonusHp = 4 * 8 + 10 * 4;   // petBattleBonus：grade×8 + level×4
  assert.equal(target.maxHp, 700 + bonusHp, '上限 = 原满血 + 幻兽加血');
  assert.equal(target.hp, 700 + bonusHp, '当前血量也要一起加上');
  const foe = S.genAI(70, '', { levelJitter: 0 });
  assert.equal(foe.maxHp, foe.hp, '随机对手生成时就要带满血上限');
});

/* 随机挑战的预告读 `genAI` 的同一只 foe；幻兽若等 `Main.startBattle` 才抽，
 * 预告看到的力敏速命就是没加幻兽的旧值，进战斗后凭空变高。 */
test('随机挑战预告与实战同源：genAI 生成时就抽幻兽并落到面板', () => {
  const g = game(), S = g.State;
  const foe = S.genAI(40, '', { levelJitter: 0, statScale: 1.08 });
  assert.ok(Array.isArray(foe.pets) && foe.pets.length >= 1 && foe.pets.length <= 3,
    'genAI 生成时就要带 1~3 只幻兽：' + JSON.stringify(foe.pets));
  assert.equal(foe.__petBonusesApplied, true, '幻兽加成要在生成时落到面板（预览读的就是这份）');
  const bonus = S.petBattleBonus(foe.pets);
  assert.ok(foe.petBonus && foe.petBonus.power === bonus.power && foe.petBonus.hp === bonus.hp,
    '面板要记录已经加过的幻兽加成，供预览/实战共用');
  const before = { power: foe.power, agility: foe.agility, speed: foe.speed, hp: foe.hp, maxHp: foe.maxHp };
  S.applyPetBonuses(foe, foe.pets);
  same({ power: foe.power, agility: foe.agility, speed: foe.speed, hp: foe.hp, maxHp: foe.maxHp }, before);
  assert.ok(foe.maxHp >= foe.hp && foe.hp > 0, '幻兽加血后仍是合法满血面板');
});

/* 原版 25 级后才开放幻兽牧场（MainMovie.as:1362 的提示）；随机敌人也不能提前带。 */
test('随机敌人的幻兽尊重 25 级解锁：24 级 0 只、25 级 1~3 只', () => {
  const g = game(), S = g.State;
  assert.equal(S.PET_UNLOCK_LEVEL, 25, '幻兽解锁等级是 25');
  assert.equal(S.randomPetLoadout(24).length, 0, '24 级及以下不抽幻兽');
  const low = S.genAI(24, '', { levelJitter: 0 });
  assert.ok(!Array.isArray(low.pets) || low.pets.length === 0, '低等级随机对手不能带幻兽：' + JSON.stringify(low.pets));
  assert.ok(!low.petBonus || !Object.values(low.petBonus).some((v) => v > 0), '低等级对手面板不能有幻兽加成');
  const high = S.genAI(25, '', { levelJitter: 0 });
  assert.ok(Array.isArray(high.pets) && high.pets.length >= 1 && high.pets.length <= 3,
    '25 级起随机对手才带 1~3 只幻兽：' + JSON.stringify(high.pets));
});

/* 三种降三维投掷武器：命中后要把对手的敏捷/速度/力量写进 debuff，并且下一次有效三维
 * 确实变低（不是只飘字）。顺便覆盖调试层用的 `effStats` 快照。 */
test('投掷武器降三维：死老鼠/屎坨坨/菜刀命中后有效三维下降', () => {
  const g = game(), Sim = g.Sim;
  const cases = [[5, 'agility', '死老鼠'], [6, 'speed', '屎坨坨'], [8, 'power', '菜刀']];
  for (const [weaponId, stat, label] of cases) {
    let applied = null;
    for (let attempt = 0; attempt < 30 && !applied; attempt++) {
      const me = { name: '测试松鼠', level: 30, hp: 5000, maxHp: 5000, power: 100, agility: 100, speed: 500,
        weapons: [{ id: weaponId, level: 10 }], skills: [], effects: {} };
      const foe = { name: '木桩', level: 30, hp: 99999, maxHp: 99999, power: 300, agility: 300, speed: 300,
        weapons: [], skills: [], effects: {} };
      const result = Sim.simulate(me, foe, { collectStats: true });
      const idx = result.rounds.findIndex((r) => r && r.action === 'weapon' && Number(r.id) === weaponId && r.debuffStat === stat);
      if (idx < 0) continue;
      const after = result.rounds[idx].effStats && result.rounds[idx].effStats[1];
      const before = idx > 0 ? result.rounds[idx - 1].effStats[1] : foe;
      assert.ok(after && Number(after[stat]) < Number(before[stat]),
        label + ' 命中后 ' + stat + ' 应下降：' + (before && before[stat]) + ' → ' + (after && after[stat]));
      applied = { before: before[stat], after: after[stat] };
    }
    assert.ok(applied, label + ' 在 30 场模拟里应至少命中一次并应用降三维');
  }
});

/* 幻兽技能真正进 Sim：行动时触发要发一条独立的 `action:'pet'` 回合，
 * 经典回放据此按 `29 + petId` 播原版动画；`isRound:0` 表示不占 60 手行动上限。 */
/* 现代随机战斗的「查看对手」：武技等级与装备加成要能从 foe 原始字段翻出来。 */
test('现代随机对手详情：武技等级与装备加成可读', () => {
  const g = game(), S = g.State;
  const foe = S.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
  const d = S.foeLoadout(foe);
  assert.ok(d && d.level === 70, '详情要带对手等级');
  assert.ok(d.weapons.length + d.skills.length > 0, '至少能看到一件武器或技能');
  assert.ok(d.weapons.every((w) => w.name && w.level >= 1), '武器要有名字和具体等级');
  assert.ok(d.skills.every((s) => s.name && s.level >= 1), '技能要有名字和具体等级');
  assert.ok(d.gears.length > 0, '70 级随机对手应穿装备');
  assert.ok(d.gears.every((x) => x.name && x.attrName && Number.isFinite(Number(x.abilityVal))),
    '装备要带主属性和加成数值');
  assert.ok(d.gears.some((x) => Array.isArray(x.ext) && x.ext.length) || d.gears.some((x) => x.gem),
    '至少能看到一条附加词条或宝石');
});

test('幻兽技能进战斗：奋力一击会产出可回放的 pet 回合', () => {
  const g = game(), Sim = g.Sim;
  assert.equal(Sim.petSkillValueOf(1, 10), 60, '奋力一击 10 级 = 24 + 4×9');
  assert.equal(Sim.petSkillTriggerOf(1, 10), 30, '奋力一击固定 30%');
  const me = { name: '我', level: 30, hp: 5000, maxHp: 5000, power: 80, agility: 80, speed: 90,
    weapons: [{ id: 15, level: 10 }], skills: [{ id: 8, level: 1 }],
    pets: [{ id: 1, name: '蛮犀牛', grade: 1, level: 10, skillId: 1 }] };
  const foe = { name: '木桩', level: 30, hp: 9000, maxHp: 9000, power: 10, agility: 10, speed: 10,
    weapons: [], skills: [] };
  let pet = null;
  for (let i = 0; i < 40 && !pet; i++) {
    const result = Sim.simulate(me, foe);
    pet = (result.rounds || []).find((r) => r.action === 'pet');
  }
  assert.ok(pet, '40 场里至少要掷中一次 30% 的行动协战');
  assert.equal(pet.petId, 1);
  assert.equal(pet.petSkillId, 1);
  assert.equal(pet.isRound, 0, '幻兽协战不占行动上限');
  assert.ok(pet.dmg > 0, '奋力一击要真的扣血');
  assert.ok(Array.isArray(pet.hpAfter) && pet.hpAfter.length === 2, '回合快照要带双方血量');
});

/* 色诱之术：原版描述「略过对手一回合」= 眩晕，真化才追加脱装。
 * 玩家常只看到脱装，误以为没有眩晕 —— 这里把 sim 的 stun 事件钉住。 */
test('色诱之术：命中带眩晕（跳过对手一回合），真化才追加脱装', () => {
  const g = game(), Sim = g.Sim;
  const me = { name: '我', level: 50, hp: 5000, maxHp: 5000, power: 50, agility: 50, speed: 10,
    weapons: [], skills: [{ id: 8, level: 15 }], castable: [8], effects: {} };
  const foe = { name: '木桩', level: 50, hp: 9999, maxHp: 9999, power: 10, agility: 1, speed: 10,
    weapons: [], skills: [], effects: {} };
  let sawStun = false, sawStunnedTurn = false, sawStrip = false;
  for (let i = 0; i < 20 && !(sawStun && sawStunnedTurn && sawStrip); i++) {
    const rounds = Sim.simulate(me, foe).rounds || [];
    if (rounds.some((r) => r.stunApplied)) sawStun = true;
    if (rounds.some((r) => r.action === 'stunned')) sawStunnedTurn = true;
    if (rounds.some((r) => r.stripApplied || r.specialEffect === 1)) sawStrip = true;
  }
  assert.ok(sawStun, '色诱命中要标 stunApplied（原版「略过对手一回合」）');
  assert.ok(sawStunnedTurn, '对手下一回合要真的被跳过（action:stunned）');
  assert.ok(sawStrip, '真·色诱 56% 脱装要在 20 场内掷中');
});

/* 果实种子合成：原版走「道具合成」页；规则统一收进 State.composeSeed。 */
test('果实种子合成：10 个种子 + 50 金松果换 1 个果实，材料/金币不足会拒绝', () => {
  const g = game(), S = g.State, s = S.state();
  s.props[45] = 10; s.goldPoint = 50;
  const r = S.composeSeed(45);
  assert.equal(r.ok, true);
  assert.equal(s.props[45], 0);
  assert.equal(s.props[47], 1, '天使果实种子合成天使果实');
  assert.equal(s.goldPoint, 0);
  assert.equal(S.composeSeed(45).ok, false, '没有种子时不能合成');
  s.goldPoint = 50;
  assert.equal(S.composeSeed(46).ok, false, '没有恶魔果实种子时不能合成');
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS', name); }
  catch (error) { failed++; console.error('FAIL', name, error.stack); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exitCode = failed ? 1 : 0;
