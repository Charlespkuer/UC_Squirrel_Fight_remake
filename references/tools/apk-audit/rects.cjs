/* Turn the original client's literal top-left coordinates into true rectangles.
 *
 * The client positions atlas frames by top-left only; the size comes from imgMap
 * in js/orig/assets.js ([label, sx, sy, sw, sh]). This resolves the pairs found by
 * shared-chrome.cjs into x/y/w/h so an HTML layout can be compared honestly. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..', '..');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/orig/Map.min.js', 'js/orig/assets.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}

function frame(sheet, label) {
  const list = sandbox.imgMap.getValue(sheet);
  if (!Array.isArray(list)) return null;
  const row = list.find((r) => String(r[0]) === String(label));
  if (!row) return null;
  return { sx: row[1], sy: row[2], sw: row[3], sh: row[4] };
}

// name, sheet, label, x, y  — from shared-chrome.cjs
const ITEMS = [
  ['顶栏 title_frame', 'resource_3', '0', 6, 5],
  ['页框/底板 frame', 'resource_3', '5', 144, 133],
  ['内容底板 diban', 'resource_1', '53', 189, 183],
  ['返回 button_back', 'resource_1', '42', 1054, 23],
  ['返回 btn_back', 'resource_1', '43', 938, 37],
  ['标签 title1(3:7)', 'resource_3', '7', 49, 38],
  ['标签选中(3:7a)', 'resource_3', '7a', 49, 38],
  ['标签 title2', 'resource_3', '7', 239, 38],
  ['标签 title3', 'resource_3', '7', 429, 38],
  ['标签 title4', 'resource_3', '7', 619, 38],
  ['页脚按钮 frame_btn01', 'resource_3', '8', 234, 487],
  ['页脚按钮 frame_btn02', 'resource_3', '8', 659, 487],
  ['左翻页 button_left', 'resource_6', '20', 7, 371],
  ['右翻页 button_right', 'resource_6', '20', 1165, 371],
  ['跳过关卡 tiaoguo', 'resource_4', '7', 983, 609],
  ['标题条(4:39)', 'resource_4', '39', 159, 56],
  ['小底板(1:33)', 'resource_1', '33', 243, 207],
  ['弹窗框(1:24)', 'resource_1', '24', 111, 158],
];

console.log('元素                     起点        帧尺寸      => 真实矩形 (x, y, w, h)');
for (const [name, sheet, label, x, y] of ITEMS) {
  const f = frame(sheet, label);
  if (!f) { console.log(`  ${name.padEnd(22)} ${(x + ',' + y).padEnd(11)} (帧未找到)`); continue; }
  console.log(`  ${name.padEnd(22)} ${(x + ',' + y).padEnd(11)} ${String(f.sw + 'x' + f.sh).padEnd(10)} => (${x}, ${y}, ${f.sw}, ${f.sh})  右/下 ${x + f.sw}/${y + f.sh}`);
}

// Panel-centred layout conclusions
const board = frame('resource_3', '5');
const top = frame('resource_3', '0');
const tab = frame('resource_3', '7');
console.log('\n关键结论：');
console.log(`  顶栏 resource_3:0  (6,5,${top.sw},${top.sh})  横跨 x=6..${6 + top.sw}，y=5..${5 + top.sh}`);
console.log(`  底板 resource_3:5  (144,133,${board.sw},${board.sh})  居中? 左${144} 右${1170 - (144 + board.sw)}  水平中心=${144 + board.sw / 2}`);
console.log(`  标签 3:7 ${tab.sw}x${tab.sh}，x 起点 49/239/429/619/809 => 间距 190，${tab.sw > 190 ? '相邻重叠 ' + (tab.sw - 190) + 'px' : '相邻留空 ' + (190 - tab.sw) + 'px'}`);
