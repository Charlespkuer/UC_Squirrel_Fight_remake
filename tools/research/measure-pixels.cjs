/* 临时脚本：在截图里量出浅色（数字）像素的包围盒，用于核对像素级渲染。
 * node tools/research/measure-pixels.cjs <in.png> <x> <y> <w> <h> [mode]
 *   mode: light(默认) | dark
 */
const fs = require('node:fs');
const path = require('node:path');
const g = require(path.join(process.env.USERPROFILE || 'C:/Users/Charles',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
process.chdir(path.resolve(__dirname, '..', '..'));
(async () => {
  const [inFile, x, y, w, h, mode] = process.argv.slice(2);
  const img = await g.loadImage(inFile);
  const c = g.createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const X = Number(x), Y = Number(y), W = Number(w), H = Number(h);
  const d = cx.getImageData(X, Y, W, H).data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
  const wantDark = mode === 'dark';
  const rows = [];
  for (let j = 0; j < H; j++) {
    let count = 0;
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      const r = d[o], gg = d[o + 1], b = d[o + 2];
      const light = (r + gg + b) / 3;
      const hit = wantDark ? light < 90 : light > 200;
      if (!hit) continue;
      count++; n++;
      if (i < minX) minX = i; if (i > maxX) maxX = i;
      if (j < minY) minY = j; if (j > maxY) maxY = j;
    }
    rows.push(count);
  }
  const out = { file: inFile, region: { x: X, y: Y, w: W, h: H }, mode: mode || 'light', hits: n, box: n ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null, rows };
  console.log(JSON.stringify(out));
})();
