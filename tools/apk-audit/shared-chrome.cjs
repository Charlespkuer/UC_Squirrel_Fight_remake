/* Find UI elements the original client repeats across many screens: shared chrome
 * (window frame, tabs bar, back button, currency row, footer). Those are the ones
 * worth aligning the HTML rebuild against, because one correction applies everywhere. */
const fs = require('node:fs');
const path = require('node:path');

const views = JSON.parse(fs.readFileSync(path.join(__dirname, 'original-views.json'), 'utf8'));
const byKey = new Map();

for (const [view, data] of Object.entries(views)) {
  const seen = new Set();
  for (const el of data.elements) {
    if (el.x == null || el.y == null) continue;
    const key = `${el.src || '-'}:${el.label ?? '-'}@${el.x},${el.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!byKey.has(key)) byKey.set(key, { ...el, views: [] });
    byKey.get(key).views.push(view);
  }
}

const rows = [...byKey.values()].filter((r) => r.views.length >= 3)
  .sort((a, b) => b.views.length - a.views.length || String(a.src).localeCompare(String(b.src)));

console.log(`共 ${byKey.size} 个唯一 (素材,x,y)；其中出现在 ≥3 个界面的有 ${rows.length} 个：\n`);
console.log('次数  x     y     src:label           id                 出现的界面');
for (const r of rows) {
  console.log([
    String(r.views.length).padStart(3),
    String(r.x).padStart(5),
    String(r.y).padStart(5),
    (r.src + ':' + (r.label ?? '-')).padEnd(18),
    String(r.id ?? '-').padEnd(19),
    r.views.slice(0, 6).join(',') + (r.views.length > 6 ? '…' : ''),
  ].join(' '));
}

// Panel/frame extents: the bg bitmaps that define each screen's board.
console.log('\n各界面底板（id=bg / frame / diban）：');
for (const [view, data] of Object.entries(views)) {
  const bg = data.elements.filter((e) => /^(bg|frame\d*|diban|title_frame)$/.test(String(e.id)));
  if (!bg.length) continue;
  console.log(`  ${view.padEnd(20)} ` + bg.map((e) => `${e.id}(${e.x},${e.y}) ${e.src}:${e.label ?? '-'}`).join('  '));
}
