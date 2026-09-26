/* 临时脚本：裁切并放大截图指定区域，便于比对像素细节。
 * node tools/research/crop-zoom.cjs <in.png> <out.png> <x> <y> <w> <h> [scale]
 */
const fs = require('node:fs');
const path = require('node:path');
const g = require(path.join(process.env.USERPROFILE || 'C:/Users/Charles',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
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

process.chdir(findRoot(__dirname));
(async () => {
  const [inFile, outFile, x, y, w, h, scale] = process.argv.slice(2);
  const k = Number(scale || 3);
  const img = await g.loadImage(inFile);
  const c = g.createCanvas(Math.round(Number(w) * k), Math.round(Number(h) * k));
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, Number(x), Number(y), Number(w), Number(h), 0, 0, c.width, c.height);
  fs.writeFileSync(outFile, c.toBuffer('image/png'));
  console.log('wrote ' + outFile + ' ' + c.width + 'x' + c.height + ' from ' + inFile + ' (' + img.width + 'x' + img.height + ')');
})();
