/* 临时脚本：裁切并放大截图指定区域，便于比对像素细节。
 * node tools/research/crop-zoom.cjs <in.png> <out.png> <x> <y> <w> <h> [scale]
 */
const fs = require('node:fs');
const path = require('node:path');
const g = require(path.join(process.env.USERPROFILE || 'C:/Users/Charles',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
process.chdir(path.resolve(__dirname, '..', '..'));
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
