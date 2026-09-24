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
const rootDir = path.resolve(__dirname, '..');
const files = ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js', 'js/classic-fusion.js'];

function setup(ids = [21, 21, 21, 22, 201, 202]) {
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
      spr: (sheet, label) => '<img src="images/classic/sprites/' + sheet + '-' + label + '.png">',
      toast: (message) => toasts.push(message),
      modal: (title, html, buttons) => modals.push({ title, html, buttons }),
    },
    runAction() { page.isConnected = false; },
  };
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(rootDir, file), 'utf8'), context, { filename: file });
  context.State.newGame('融合测试');
  Object.assign(context.State.state(), { level: 50, goldPoint: 100, gears: [] });
  const gears = ids.map((id) => context.State.addGear(id));
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
  assert.ok(game.board.innerHTML.includes('卓越装备'));
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

test('重复选择会移除材料，支持槽位移除和清空，错ID及最高品质不能混入', () => {
  const game = setup([21, 21, 21, 22, 201]), first = game.gears[0], second = game.gears[1];
  game.click('gear', first.key);
  assert.equal(game.get('gear', game.gears[3].key).disabled, true);
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

for (const [name, run] of tests) {
  run();
  console.log('PASS ' + name);
}
console.log('Fusion interaction checks passed: ' + tests.length + ' scenarios.');
