/* Report the real pixel size of original atlas frames, so the client's literal
 * top-left coordinates can be turned into true rectangles (x, y, w, h) that a
 * CSS layout can actually be aligned against.
 *
 *   node tools/apk-audit/frame-size.cjs resource_3:5 resource_1:53 resource_4:7 ...
 *   node tools/apk-audit/frame-size.cjs --common
 */
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
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/orig/assets.js', 'js/orig/asset2.js', 'js/orig/animationStr.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

// assets.js declares the sheet manifests; find the one holding id -> {label: w,h}.
const sheets = {};
for (const key of Object.keys(sandbox)) {
  const v = sandbox[key];
  if (!v || typeof v !== 'object') continue;
  const probe = Array.isArray(v) ? v[0] : v[Object.keys(v)[0]];
  if (probe && typeof probe === 'object' && ('w' in probe || 'width' in probe)) sheets[key] = v;
}
const sheetNames = Object.keys(sheets);

function size(sheet, label) {
  const s = sheets[sheet];
  if (!s) return null;
  const f = s[label] || (Array.isArray(s) ? s.find((x) => String(x.label) === String(label)) : null);
  if (!f) return null;
  const w = f.w ?? f.width, h = f.h ?? f.height;
  const x = f.x ?? 0, y = f.y ?? 0;
  return Number.isFinite(w) && Number.isFinite(h) ? { x, y, w, h } : null;
}

const args = process.argv.slice(2);

if (args.includes('--sheets')) {
  console.log('可用的图集清单：' + sheetNames.join(', '));
  for (const n of sheetNames) {
    const keys = Object.keys(sheets[n]);
    console.log(`  ${n.padEnd(16)} ${Array.isArray(sheets[n]) ? 'array' : 'object'}  条目 ${keys.length}  例: ${keys.slice(0, 8).join(',')}`);
  }
  process.exit(0);
}

// Elements that define the original's shared chrome, from shared-chrome.cjs.
const COMMON = [
  'resource_3:0', 'resource_3:5', 'resource_1:53', 'resource_1:42', 'resource_1:43',
  'resource_3:7', 'resource_3:7a', 'resource_3:8', 'resource_6:19', 'resource_6:20',
  'resource_4:7', 'resource_4:39', 'resource_1:33', 'resource_1:17', 'resource_1:24',
  'resource_1:19', 'resource_5:1', 'resource_2:10a', 'resource_2:11a', 'resource_2:12a',
  'resource_2:13a', 'resource_2:14a', 'resource_2:8', 'resource_2:9a', 'resource_12:18',
  'resource_1:18', 'resource_6:4', 'resource_9:36', 'substarate', 'substarate0',
];
const list = args.includes('--common') ? COMMON : args;

if (!list.length) {
  console.error('用法: node tools/apk-audit/frame-size.cjs <sheet:label> ... | --common | --sheets');
  process.exit(1);
}
console.log('sheet:label            帧内偏移       尺寸');
for (const spec of list) {
  const [sheet, label = null] = spec.includes(':') ? spec.split(':') : [spec, null];
  const s = size(sheet, label);
  console.log(`  ${spec.padEnd(20)} ${s ? String(s.x + ',' + s.y).padEnd(12) : '(未找到)'.padEnd(12)} ${s ? s.w + ' x ' + s.h : ''}`);
}
