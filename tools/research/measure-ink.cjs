/* 开发检查：在截图里量出按钮内部「字形」的墨迹中心，判断箭头是否居中。
 * node tools/research/measure-ink.cjs <shot.png> <x> <y> <w> <h> [mode]
 *   mode: dark(默认，找比底色暗的字形) | white(找白色字形，用于绿色按钮上的白箭头)
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
  const [file, x, y, w, h, mode] = process.argv.slice(2);
  const white = mode === 'white';
  const img = await g.loadImage(file);
  const c = g.createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const X = Math.round(Number(x)), Y = Math.round(Number(y)), W = Math.round(Number(w)), H = Math.round(Number(h));
  const d = cx.getImageData(X, Y, W, H).data;
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0, sx = 0, sy = 0;
  const pad = 3;
  for (let j = pad; j < H - pad; j++) {
    for (let i = pad; i < W - pad; i++) {
      const o = (j * W + i) * 4;
      const R = d[o], G = d[o + 1], B = d[o + 2];
      const lum = R * 0.299 + G * 0.587 + B * 0.114;
      const hit = white
        ? (lum > 205 && R > 185 && G > 185 && B > 175 && Math.max(R, G, B) - Math.min(R, G, B) < 60)
        : (lum < 150);
      if (!hit) continue;
      n++; sx += i; sy += j;
      if (i < minX) minX = i; if (i > maxX) maxX = i;
      if (j < minY) minY = j; if (j > maxY) maxY = j;
    }
  }
  const out = n ? {
    file, region: { x: X, y: Y, w: W, h: H }, mode: white ? 'white' : 'dark', inkPixels: n,
    inkBox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    inkCenterInRegion: { x: +((minX + maxX) / 2).toFixed(2), y: +((minY + maxY) / 2).toFixed(2) },
    regionCenter: { x: +((W - 1) / 2).toFixed(2), y: +((H - 1) / 2).toFixed(2) },
    inkOffsetFromCenter: { x: +((minX + maxX) / 2 - (W - 1) / 2).toFixed(2), y: +((minY + maxY) / 2 - (H - 1) / 2).toFixed(2) },
    centroidOffsetFromCenter: { x: +(sx / n - (W - 1) / 2).toFixed(2), y: +(sy / n - (H - 1) / 2).toFixed(2) },
  } : { file, inkPixels: 0, note: '该模式下没有找到字形' };
  console.log(JSON.stringify(out));
})();
