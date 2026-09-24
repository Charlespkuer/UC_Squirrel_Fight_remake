/* Pull a readable window of code around a needle out of the minified ssdz-pkg2.js.
 * Usage: node tools/apk-audit/extract-window.cjs <needle> [before] [after] */
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'game', 'js', 'ssdz-pkg2.js');
const text = fs.readFileSync(file, 'utf8');
const needle = process.argv[2];
const before = Number(process.argv[3] || 300);
const after = Number(process.argv[4] || 900);

let from = 0, n = 0;
for (;;) {
  const i = text.indexOf(needle, from);
  if (i < 0) break;
  n++;
  console.log(`\n===== hit ${n} @ ${i} =====`);
  // Break the window into readable statements for inspection only.
  const win = text.slice(Math.max(0, i - before), i + after);
  console.log(win.replace(/,(?=[A-Za-z_$])/g, ',\n').replace(/;(?=[A-Za-z_$])/g, ';\n'));
  from = i + needle.length;
  if (n >= 6) break;
}
if (!n) console.log('no hits for ' + needle);
