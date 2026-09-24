/* Search / read the original client sources without unpacking the APK.
 *
 *   node tools/apk-audit/search.cjs <regex> [--files js/ssdz-pkg2.js,js/player.js] [--before 60] [--after 200] [--max 20] [--context]
 *   node tools/apk-audit/search.cjs --read js/vmGameBase.js [--from 0] [--len 2000]
 *   node tools/apk-audit/search.cjs --files
 *
 * --context prints a whitespace-collapsed one-line window (good for minified code);
 * without it the raw slice is printed with newlines preserved.
 */
const apk = require('./apk-zip.cjs');

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes('--' + name);
const num = (name, dflt) => Number(opt(name, dflt));

const allJs = () => apk.listGameFiles().filter((f) => /\.js$/i.test(f));

if (has('files')) {
  for (const f of apk.listGameFiles()) console.log(f);
  process.exit(0);
}

if (has('read')) {
  const text = apk.readGameText(opt('read'));
  const from = num('from', 0), len = num('len', 2000);
  let slice = text.slice(from, from + len);
  if (has('decode')) slice = slice.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  process.stdout.write(slice);
  process.exit(0);
}

const pattern = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--files'
  && argv[argv.indexOf(a) - 1] !== '--read' && argv[argv.indexOf(a) - 1] !== '--before'
  && argv[argv.indexOf(a) - 1] !== '--after' && argv[argv.indexOf(a) - 1] !== '--max');
if (!pattern) {
  console.error('用法: node tools/apk-audit/search.cjs <regex> [--files a.js,b.js] [--before N] [--after N] [--max N] [--context]');
  process.exit(1);
}
const re = new RegExp(pattern, 'g');
const before = num('before', 60), after = num('after', 200), max = num('max', 20);
const files = opt('files') ? opt('files').split(',') : allJs();
let hits = 0;

for (const file of files) {
  let text;
  try { text = apk.readGameText(file); } catch { continue; }
  for (const m of text.matchAll(re)) {
    if (++hits > max) break;
    const s = Math.max(0, m.index - before);
    const win = text.slice(s, m.index + m[0].length + after);
    console.log(`[${file} @${m.index}] ${has('context') ? win.replace(/\s+/g, ' ') : win}`);
    console.log('');
  }
  if (hits > max) break;
}
if (!hits) console.log('没有匹配：' + pattern);
else if (hits > max) console.log(`（已截断，命中超过 ${max} 处）`);
