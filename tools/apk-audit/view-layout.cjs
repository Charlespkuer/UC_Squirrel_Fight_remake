/* Dump the original client's UI layout for one screen class.
 *
 * The shipped client builds every screen from literal coordinates, e.g.
 *   BitmapFactory.createButton({id:"button_back",x:234,y:487,src:"resource_3",label:"8"})
 * so the real layout of a screen is recoverable exactly, instead of being inferred
 * from screenshots. Read-only; reads straight out of references/h5ssdz_9game_4230.apk.
 *
 *   node tools/apk-audit/view-layout.cjs --list
 *   node tools/apk-audit/view-layout.cjs Mission
 *   node tools/apk-audit/view-layout.cjs Mission --json
 */
const apk = require('./apk-zip.cjs');
const fs = require('node:fs');
const path = require('node:path');

const source = apk.readGameText('js/ssdz-pkg2.js');

/** All screen classes: window.<Name>=a})(); */
function viewNames() {
  const names = new Set();
  for (const m of source.matchAll(/window\.([A-Z][A-Za-z0-9_]*)=a\}\)\(\);/g)) names.add(m[1]);
  return [...names].sort();
}

/** The IIFE body that defines the given view class. */
function viewBody(name) {
  const marker = `window.${name}=a})();`;
  const end = source.indexOf(marker);
  if (end < 0) return null;
  const start = source.lastIndexOf('(function(){', end);
  if (start < 0) return null;
  return source.slice(start, end + marker.length);
}

function fmt(n) { return Number(n); }
function attr(obj, key) {
  const m = new RegExp(key + '\\s*:\\s*("([^"]*)"|(-?\\d+(?:\\.\\d+)?))').exec(obj);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : fmt(m[3]);
}

function layout(body) {
  const rows = [];
  for (const m of body.matchAll(/(?:BitmapFactory\.(createBitmap|createButton)|new\s+Q\.(Text|BitmapText))\(([^;]{0,400}?)\)/g)) {
    const kind = m[1] ? m[1] : 'Q.' + m[2];
    const args = m[3];
    const obj = args.startsWith('{') ? args.slice(0, args.indexOf('}') + 1) : args;
    const text = args.startsWith('"') ? (/^"((?:[^"\\]|\\.)*)"/.exec(args) || [])[1] : null;
    rows.push({
      kind,
      id: attr(obj, 'id'),
      x: attr(obj, 'x'),
      y: attr(obj, 'y'),
      w: attr(obj, 'w'),
      h: attr(obj, 'h'),
      src: attr(obj, 'src'),
      label: attr(obj, 'label'),
      rect: attr(obj, 'rect'),
      text: text ? text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : null,
    });
  }
  return rows;
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const name = args.find((a) => !a.startsWith('--'));

function describe(n) {
  const body = viewBody(n) || '';
  const rows = layout(body);
  return {
    view: n,
    states: [...new Set([...body.matchAll(/setCurrentState2?\("([^"]+)"/g)].map((m) => m[1]))],
    serverCalls: [...new Set([...body.matchAll(/JsonLoader\.([A-Za-z0-9_]+)/g)].map((m) => 'JsonLoader.' + m[1]))],
    assets: [...new Set(rows.filter((r) => r.src).map((r) => r.src + (r.label != null ? ':' + r.label : '')))],
    elements: rows,
  };
}

if (args.includes('--all')) {
  const out = path.join(__dirname, 'original-views.json');
  const data = Object.fromEntries(viewNames().map((n) => [n, describe(n)]));
  fs.writeFileSync(out, JSON.stringify(data, null, 1));
  const elements = Object.values(data).reduce((n, v) => n + v.elements.length, 0);
  console.log(`导出 ${Object.keys(data).length} 个界面 / ${elements} 个元素 -> ${out}`);
  process.exit(0);
}

if (args.includes('--list') || !name) {
  const names = viewNames();
  console.log(`原始客户端共 ${names.length} 个界面类：`);
  for (const n of names) {
    const d = describe(n);
    console.log(`  ${n.padEnd(20)} 元素 ${String(d.elements.length).padStart(4)}  子状态 ${d.states.length}  接口 ${d.serverCalls.length}`);
  }
  process.exit(0);
}

const body = viewBody(name);
if (!body) {
  console.error('找不到界面类 ' + name + '；用 --list 查看可用的名字。');
  process.exit(1);
}
const { states, serverCalls: calls, assets, elements: rows } = describe(name);

if (asJson) {
  console.log(JSON.stringify({ view: name, states, serverCalls: calls, assets, elements: rows }, null, 1));
} else {
  console.log(`# ${name}`);
  console.log(`子状态 : ${states.join(', ') || '-'}`);
  console.log(`服务端 : ${calls.join(', ') || '-'}`);
  console.log(`用到的素材: ${assets.join(', ')}`);
  console.log('');
  console.log('kind                 id                   x     y     w    h    src:label');
  for (const r of rows) {
    console.log([
      String(r.kind).padEnd(20),
      String(r.id == null ? '-' : r.id).padEnd(20),
      String(r.x == null ? '-' : r.x).padStart(5),
      String(r.y == null ? '-' : r.y).padStart(5),
      String(r.w == null ? '-' : r.w).padStart(4),
      String(r.h == null ? '-' : r.h).padStart(4),
      (r.src || '') + (r.label != null ? ':' + r.label : '') + (r.text ? '  「' + r.text + '」' : ''),
    ].join(' '));
  }
  console.log(`\n共 ${rows.length} 个元素。`);
}
