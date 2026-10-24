/*
 * Run: node tools/test-fusion.cjs
 * Requires only Node.js built-ins; no browser or external packages.
 * These nine interaction checks run the shipped State and original dictionary
 * against an in-memory QA save. The small DOM adapter supplies button events;
 * the actual layout is checked separately in the browser.
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
const files = ['js/gamedict.js', 'js/gamedata.js', 'js/state.js', 'js/classic-fusion.js'];

function setup(ids = [21, 21, 21, 22, 201, 202], opts = {}) {
  const storage = new Map([['ssdz_save_v1', 'untouched']]), modals = [], toasts = [];
  let page, board, nodes = [];
  const dataKey = (type) => 'fusion' + type[0].toUpperCase() + type.slice(1);
  function query(selector) {
    if (selector === '[data-fusion-gear]:not(:disabled)') {
      return nodes.find((node) => node.dataset.fusionGear && !node.disabled) || null;
    }
    const match = selector.match(/^\[data-fusion-(gear|slot|action)(?:="([^"]+)")?\]$/);
    if (!match) return null;
    const key = dataKey(match[1]);
    return nodes.find((node) => node.dataset[key] !== undefined &&
      (match[2] === undefined || node.dataset[key] === match[2])) || null;
  }
  function all(selector) {
    const match = selector.match(/data-fusion-(gear|slot|action)/);
    return match ? nodes.filter((node) => node.dataset[dataKey(match[1])] !== undefined) : [];
  }
  const context = {
    console, location: { search: '?qa=1' },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  };
  context.window = context;
  context.UI = {
    currentUiMode: () => opts.mode || 'classic',
    classic: {
      page() {
        if (page) page.isConnected = false;
        board = {
          querySelector: query, querySelectorAll: all, markup: '',
          set innerHTML(html) {
            this.markup = html;
            nodes = [];
            for (const match of html.matchAll(/<button\b([^>]*)>/g)) {
              const dataset = {};
              for (const attr of match[1].matchAll(/data-fusion-(gear|slot|action)="([^"]*)"/g)) {
                dataset[dataKey(attr[1])] = attr[2];
              }
              nodes.push({ dataset, disabled: /\sdisabled(?:\s|$)/.test(match[1]), focus() {} });
            }
          },
          get innerHTML() { return this.markup; },
        };
        page = { isConnected: true, setAttribute() {}, querySelector: (selector) => selector === '.fusion-board' ? board : query(selector) };
        return page;
      },
      btn: (label, action) => '<button data-action="' + action + '">' + label + '</button>',
      spr: (sheet, label) => '<img src="images/ui/sprites/' + sheet + '-' + label + '.png">',
      goldIcon: () => '<img src="images/ui/icons/gold-acorn.png">',
      toast: (message) => toasts.push(message),
      modal: (title, html, buttons) => modals.push({ title, html, buttons }),
    },
    runAction() { page.isConnected = false; },
  };
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(rootDir, file), 'utf8'), context, { filename: file });
  context.State.newGame('融合测试');
  context.State.setSettings({ uiMode: opts.mode || 'classic' });
  Object.assign(context.State.state(), { level: 50, goldPoint: opts.gold || 100, gears: [] });
  const gears = ids.map((id) => context.State.addGear(id));
  if (opts.orange) {
    for (const raw of context.State.state().gears) raw.orange = true;   // 底层紫装实例标成传说（橙）
  }
  if (opts.starred) {
    for (const raw of context.State.state().gears) raw.starred = true;   // 旧档残留星标：经典模式应忽略
  }
  context.ClassicFusion.open();
  const get = (type, value) => query('[data-fusion-' + type + '="' + value + '"]');
  function click(type, value) {
    const node = get(type, value);
    assert.ok(node, 'Button exists: ' + type + '/' + value);
    assert.equal(node.disabled, false, 'Button is enabled: ' + type + '/' + value);
    node.onclick();
  }
  return { context, storage, modals, toasts, get, click, gears, get board() { return board; }, leave() { page.isConnected = false; } };
}

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('三件蓝装融合成紫装，只扣50金松果，正式存档保持不变', () => {
  const game = setup(), keys = game.gears.slice(0, 3).map((gear) => gear.key);
  assert.equal(game.get('action', 'fuse').disabled, true);
  keys.forEach((key) => game.click('gear', key));
  assert.equal(game.get('action', 'fuse').disabled, false);
  assert.ok(game.board.innerHTML.includes('卓越头巾'), '预览写成「卓越 + 部位」：' + game.board.innerHTML.match(/fusion-preview-label">[^<]*/));
  game.click('action', 'fuse');
  assert.equal(game.context.State.state().goldPoint, 50);
  const inventory = game.context.State.myGears();
  assert.equal(inventory.length, 4);
  assert.ok(keys.every((key) => !inventory.some((gear) => gear.key === key)));
  assert.equal(inventory.at(-1).quality, 3);
  assert.equal(game.modals[0].title, '融合成功');
  assert.ok(game.modals[0].html.includes('卓越'));
  assert.equal(game.storage.get('ssdz_save_v1'), 'untouched');
  assert.equal(JSON.parse(game.storage.get('ssdz_test_save_v1')).goldPoint, 50);
});

/* 第 2 项：不再要求同名，同部位 + 同品质即可融合，产物是该部位的随机装备 */
test('三件不同名的同部位同品质装备可以融合，产物仍是该部位', () => {
  // 21 格斗头巾 / 25 拳斗头巾 / 29 忍者护额：都是「头巾 + 品质2（杰出）」
  const game = setup([21, 25, 29]);
  assert.equal(game.get('action', 'fuse').disabled, true);
  game.gears.forEach((gear) => game.click('gear', gear.key));
  assert.equal(game.get('action', 'fuse').disabled, false, '不同名但同部位同品质应当可以融合');
  game.click('action', 'fuse');
  const made = game.context.State.myGears().find((gear) => !game.gears.some((old) => old.key === gear.key));
  assert.equal(made.quality, 3, '品质提升一级');
  assert.equal(game.context.State.gearPart(made.id), 0, '产物仍是头巾');
  assert.ok(game.modals[0].html.includes('（头巾）'), '成功弹窗写明部位：' + game.modals[0].html.slice(-160));
});

test('经典和现代都可选择并融合三个不同部位的同品质装备', () => {
  for (const mode of ['classic', 'modern']) {
    const game = setup([21, 201, 22, 23], { mode });
    game.click('gear', game.gears[0].key);
    assert.equal(game.get('gear', game.gears[1].key).disabled, true, '品质不同不能混入');
    for (const index of [2, 3]) {
      assert.equal(game.get('gear', game.gears[index].key).disabled, false, mode + ' 不限制材料部位');
      game.click('gear', game.gears[index].key);
    }
    assert.equal(game.get('action', 'fuse').disabled, false);
    game.click('action', 'fuse');
    assert.equal(game.modals[0].title, '融合成功');
    assert.equal(game.context.State.state().goldPoint, 50);
  }
});

test('橙装跨部位也能凑齐三件并合成黑装', () => {
  /* 49 头巾 / 50 手套 / 51 衣服：底层都是紫装 id，实例标 orange 后品质是 4。
   * 旧版卡片虽然亮着，但点击时还要求「与第一件同部位」，于是第 2/3 件怎么点都进不去，
   * 玩家看到的就是「橙装无法选中、合不出黑装」。 */
  const game = setup([49, 50, 51], { orange: true, gold: 1000, starred: true });
  game.gears.forEach((gear) => game.click('gear', gear.key));
  assert.equal(game.get('action', 'fuse').disabled, false, '三件不同部位的橙装要能同时放入');
  game.click('action', 'fuse');
  const made = game.context.State.myGears().find((gear) => !game.gears.some((old) => old.key === gear.key));
  assert.ok(made, '融合产物应当入包');
  assert.equal(made.quality, 5, '三件橙装 → 黑色装备');
  assert.equal(game.context.State.state().goldPoint, 800, '橙装融合一次扣 200 金松果');
  assert.equal(game.modals[0].title, '融合成功');
  assert.ok(game.modals[0].html.includes('黑色'), '成功弹窗写明黑色品质');
});

test('原版融合页的材料清单包含橙装，且提示不再写死「蓝色」', () => {
  const src = fs.readFileSync(path.join(rootDir, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  const materials = src.slice(src.indexOf('function fusionMaterials()'), src.indexOf('function fusionSelected()'));
  assert.ok(materials.includes('.filter((g) => !g.used)'), '原版融合材料只按未穿戴过滤：' + materials);
  assert.ok(!/!g\.orange/.test(materials), '不能再把橙装从材料里剔掉');
  assert.match(src, /function rewriteFusionPrompt\(view, text\)/, '原版「请先放入3件蓝色的装备」要改成可随同套状态更新的通用提示');
});

/* 推荐材料按品质计数，跨部位的三件也是一个可融合组。 */
test('装备按同品质成组排序，跨部位凑得齐三件的排最前', () => {
  const game = setup([22, 13, 21, 23]);
  const names = [...game.board.innerHTML.matchAll(/data-fusion-gear="[^"]+"[^>]*>[\s\S]*?fusion-gear-name">([^<]+)</g)].map((m) => m[1]);
  assert.equal(names.length, 4, '四件都渲染出来：' + names.join(','));
  assert.deepEqual(names.slice(0, 3).sort(), game.gears.filter((g) => g.quality === 2).map((g) => g.name).sort(),
    '三个不同部位的品质2材料应排在前面：' + names.join(','));
  assert.ok(game.board.innerHTML.includes('同品质 3 件'), '推荐数量按品质计算');
});

test('重复选择会移除材料，支持槽位移除和清空，错ID及最高品质不能混入', () => {
  const game = setup([21, 21, 21, 22, 201]), first = game.gears[0], second = game.gears[1];
  game.click('gear', first.key);
  assert.equal(game.get('gear', game.gears[3].key).disabled, false, '不同部位现在可以混入');
  game.click('gear', second.key);
  game.click('gear', first.key);
  assert.ok(game.board.innerHTML.includes('已放入 1/3'));
  assert.equal(game.get('action', 'fuse').disabled, true);
  game.click('slot', '0');
  assert.ok(game.board.innerHTML.includes('已放入 0/3'));
  assert.equal(game.get('gear', game.gears[3].key).disabled, false);
  assert.equal(game.get('gear', game.gears[4].key).disabled, false); // 紫装现在可以继续融合为橙装
  game.click('gear', first.key);
  game.click('action', 'clear');
  assert.ok(game.board.innerHTML.includes('已放入 0/3'));
});

test('已穿戴装备不能选择', () => {
  const game = setup([21, 21, 21, 22]);
  game.context.State.wear(game.gears[0].key);
  game.context.ClassicFusion.open();
  assert.equal(game.get('gear', game.gears[0].key).disabled, true);
});

test('余额不足时按钮禁用，直接调用也不会消耗材料', () => {
  const game = setup([21, 21, 21]);
  game.context.State.state().goldPoint = 49;
  game.gears.forEach((gear) => game.click('gear', gear.key));
  assert.equal(game.get('action', 'fuse').disabled, true);
  assert.ok(game.board.innerHTML.includes('还需要 1 个'));
  game.get('action', 'fuse').onclick();
  assert.equal(game.context.State.myGears().length, 3);
  assert.equal(game.context.State.state().goldPoint, 49);
});

test('重复触发融合不会再次扣款或领取装备', () => {
  const game = setup([21, 21, 21]);
  game.gears.forEach((gear) => game.click('gear', gear.key));
  const originalClick = game.get('action', 'fuse').onclick;
  originalClick(); originalClick();
  assert.equal(game.context.State.state().goldPoint, 50);
  assert.equal(game.modals.length, 1);
});

test('提交前重新校验装备穿戴状态', () => {
  const game = setup([21, 21, 21]);
  game.gears.forEach((gear) => game.click('gear', gear.key));
  game.context.State.wear(game.gears[0].key);
  game.get('action', 'fuse').onclick();
  assert.equal(game.context.State.state().goldPoint, 100);
  assert.equal(game.context.State.myGears().length, 3);
  assert.ok(game.toasts[0].includes('穿戴'));
});

test('装备分页按钮在首尾页正确禁用', () => {
  const game = setup([21, 21, 21, 21, 21, 21, 21]);
  assert.equal(game.get('action', 'previous').disabled, true);
  assert.equal(game.get('action', 'next').disabled, false);
  game.click('action', 'next');
  assert.ok(game.board.innerHTML.includes('2 / 2'));
  assert.equal(game.get('action', 'next').disabled, true);
  game.click('action', 'previous');
  assert.ok(game.board.innerHTML.includes('1 / 2'));
});

test('空背包显示说明并禁用融合', () => {
  const game = setup([]);
  assert.ok(game.board.innerHTML.includes('还没有可以选择的装备'));
  assert.equal(game.get('action', 'fuse').disabled, true);
});

test('离开融合页后遗留的点击不会扣款', () => {
  const game = setup([21, 21, 21]);
  game.gears.forEach((gear) => game.click('gear', gear.key));
  const originalClick = game.get('action', 'fuse').onclick;
  game.leave(); originalClick();
  assert.equal(game.context.State.state().goldPoint, 100);
});

/* 规则条只能是一句话：它所在的 board 是固定高度的纵向 flex，规则条一长
 * 就会把下面的装备列表（flex:1 1 auto）压到 0、装备卡整片消失。
 * 2026-10 第二十九批就是这么炸的 —— 当时把整段说明连 <br> 塞了进去，
 * flex 把每段文字拆成独立 item，规则条变成一堆竖条，装备列表被挤没。 */
test('规则条保持单行且完整说明收在弹窗里', () => {
  const game = setup([21, 21, 21]);
  const rules = game.board.innerHTML.match(/<p class="fusion-rules">([\s\S]*?)<\/p>/);
  assert.ok(rules, '规则条存在');
  assert.ok(!rules[1].includes('<br>'), '规则条里不能有 <br>（flex 会把它拆成一堆竖条）');
  const text = rules[1].replace(/<[^>]+>/g, '');
  assert.ok(text.length <= 60, '规则条只放一句话，实际 ' + text.length + ' 字：' + text);
  assert.ok(game.get('action', 'rules'), '有「详细规则」入口');
  game.click('action', 'rules');
  const modal = game.modals[game.modals.length - 1];
  assert.equal(modal.title, '融合规则');
  for (const key of ['材料', '费用', '产物', '名称', '词条']) {
    assert.ok(modal.html.includes(key), '详细规则里要有「' + key + '」');
  }
  /* 装备卡必须照常渲染（这一步是在防「列表被挤没」的老毛病） */
  assert.ok(game.board.innerHTML.includes('data-fusion-gear='), '装备列表要渲染出卡片');
});

test('融合只有一条共有词条时，仍按品质补满词条槽', () => {
  const game = setup();
  const S = game.context.State;
  const state = S.state();
  state.level = 60; state.goldPoint = 1000; state.gears = [];
  const keys = [0, 1, 2].map(() => S.addGear(201, [{ id: 1, level: 1 }]).key);
  const result = S.mergeGears(keys);
  assert.equal(result.ok, true);
  assert.equal(result.gear.quality, 4);
  assert.equal(result.gear.ext.length, 3, '橙装应有 3 条词条');
  assert.equal(new Set(result.gear.ext.map((ext) => ext.id)).size, 3, '词条不能重复');
  assert.ok(result.gear.ext.some((ext) => ext.id === 1), '共有的那条词条要保留');
});

test('三件同套装融合必定得到该套下一品质同部位', () => {
  const game = setup([201, 202, 203, 177, 178, 179], { gold: 1000 });
  const S = game.context.State;
  vm.runInContext('globalThis.__oldRandom = Math.random; Math.random = () => 0', game.context);
  try {
    /* 旧规则在三件不同名时完全随机，固定 0 会挑到别的套装；同套保底必须无视它。 */
    const purple = game.gears.slice(0, 3).map((g) => g.key);
    const orange = S.mergeGears(purple);
    assert.equal(orange.ok, true, orange.msg || '紫装融合应成功');
    assert.equal(orange.gear.id, 205, '3 件狂战紫装 → 狂战橙头盔');
    assert.equal(S.gearSetFamily(orange.gear.id), '狂战');
    assert.equal(S.gearPart(orange.gear.id), 0);
    assert.equal(orange.gear.quality, 4);

    const orangeFury = game.gears.slice(3, 6).map((g) => g.key);
    const black = S.mergeGears(orangeFury);
    assert.equal(black.ok, true, black.msg || '橙装融合应成功');
    assert.equal(black.gear.id, 185, '3 件怒战橙装 → 怒战黑头盔（同套取 id 最小件）');
    assert.equal(S.gearSetFamily(black.gear.id), '怒战');
    assert.equal(S.gearPart(black.gear.id), 0);
    assert.equal(black.gear.quality, 5);

    /* 机器猫的「头 / 拳」是裸后缀，按单件名去后缀会拆成两族；融合认套必须按 setId 的公共前缀。 */
    const cat = setup([209, 210, 211], { gold: 1000 });
    const catInfo = cat.context.State.fusionFamilyInfo(cat.gears);
    assert.equal(catInfo && catInfo.family, '机器猫', '机器猫头/拳/服要认成同一套');
    assert.equal(catInfo && catInfo.quality, 5, '机器猫橙装同套保底到黑装');
  } finally {
    vm.runInContext('Math.random = globalThis.__oldRandom; delete globalThis.__oldRandom', game.context);
  }
});

for (const [name, run] of tests) {
  run();
  console.log('PASS ' + name);
}
console.log('Fusion interaction checks passed: ' + tests.length + ' scenarios.');
