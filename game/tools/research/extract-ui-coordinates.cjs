// Read-only index of static sprite placements in the bundled UC Android client.
// Run: node tools/research/extract-ui-coordinates.cjs
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const source = fs.readFileSync(path.join(root, 'original/js/ssdz-pkg2.js'), 'utf8');
const parts = source.split(/(?=^\(function \(\) \{)/m);
const result = {};
let offset = 0;
for (const part of parts) {
  const names = [...part.matchAll(/window\.(\w+)\s*=/g)].map(m => m[1]);
  if (!names.length) { offset += part.length; continue; }
  const sprites = [];
  for (const m of part.matchAll(/BitmapFactory\.(createBitmap|createButton)\(\{([^{}]+)\}\)/g)) {
    const sprite = { type: m[1] === 'createButton' ? 'button' : 'bitmap' };
    for (const field of m[2].matchAll(/(\w+):\s*("(?:[^"\\]|\\.)*"|[-+]?\d+(?:\.\d+)?(?:e\d+)?|true|false)\s*[,\n]/g)) {
      try { sprite[field[1]] = JSON.parse(field[2]); } catch {}
    }
    if (!sprite.src) continue;
    sprite.line = source.slice(0, offset + m.index).split('\n').length;
    sprites.push(sprite);
  }
  result[names.join(', ')] = {
    sourceLine: source.slice(0, offset).split('\n').length,
    note: 'Includes conditional, hidden and dialog sprites; later property assignments and dynamic layouts are not applied.',
    sprites,
  };
  offset += part.length;
}
fs.writeFileSync(path.join(root, 'original-ui-coordinates.json'), JSON.stringify(result, null, 2));
console.log(`Indexed ${Object.keys(result).length} modules and ${Object.values(result).reduce((n, p) => n + p.sprites.length, 0)} sprite placements.`);
