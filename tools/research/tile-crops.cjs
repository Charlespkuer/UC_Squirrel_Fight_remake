/* 临时脚本：把多张截图的同一区域拼成对比图。
 * node tools/research/tile-crops.cjs <out.png> <x> <y> <w> <h> <in1> <in2> ...
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
  const [out, x, y, w, h, ...files] = process.argv.slice(2);
  const X = Number(x), Y = Number(y), W = Number(w), H = Number(h);
  const cols = Math.min(files.length, 4), rows = Math.ceil(files.length / cols);
  const c = g.createCanvas(cols * W, rows * H);
  const cx = c.getContext('2d');
  cx.fillStyle = '#111'; cx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < files.length; i++) {
    const img = await g.loadImage(files[i]);
    cx.drawImage(img, X, Y, W, H, (i % cols) * W, Math.floor(i / cols) * H, W, H);
    cx.fillStyle = '#ff0'; cx.font = '16px sans-serif';
    cx.fillText(path.basename(files[i]), (i % cols) * W + 6, Math.floor(i / cols) * H + 20);
  }
  fs.writeFileSync(out, c.toBuffer('image/png'));
  console.log('wrote ' + out + ' ' + c.width + 'x' + c.height);
})();
