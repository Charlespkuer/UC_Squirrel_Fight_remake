/* 开发检查：量出圆形翻页按钮里「整个箭头」（白色填充 + 深色描边）的墨迹包围盒，
 * 判断箭头在圆形按钮内是否水平/竖直居中。
 * node tools/research/measure-chevron.cjs <shot.png> <btnLeft> <btnTop> <btnW> <btnH>
 */
const fs = require('node:fs');
const path = require('node:path');
const g = require(path.join(process.env.USERPROFILE || 'C:/Users/Charles',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
process.chdir(path.resolve(__dirname, '..', '..', '..'));
(async () => {
  const [file, l, t, w, h] = process.argv.slice(2);
  const img = await g.loadImage(file);
  const scale = img.width / 1170;
  const c = g.createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const L = Math.round(+l * scale), T = Math.round(+t * scale);
  const W = Math.round(+w * scale), H = Math.round(+h * scale);
  const d = cx.getImageData(L, T, W, H).data;
  const at = (i, j) => { const o = (j * W + i) * 4; return [d[o], d[o + 1], d[o + 2]]; };
  // 只在按钮内部中央区（离边缘 11px 以上）找箭头：白色填充 或 深色描边
  const isWhite = (r, g2, b) => r > 232 && g2 > 230 && b > 214;
  const isInk = (r, g2, b) => {
    const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b);
    return mx - mn < 70 && mx < 165;         // 深灰描边（排除绿色）
  };
  const inner = (i, j) => i > 10 && i < W - 11 && j > 10 && j < H - 11;
  const rows = [];
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0;
  for (let j = 0; j < H; j++) {
    let cnt = 0;
    for (let i = 0; i < W; i++) {
      if (!inner(i, j)) continue;
      const [r, g2, b] = at(i, j);
      if (!isWhite(r, g2, b) && !isInk(r, g2, b)) continue;
      cnt++; n++;
      if (i < minX) minX = i; if (i > maxX) maxX = i;
      if (j < minY) minY = j; if (j > maxY) maxY = j;
    }
    rows.push(cnt);
  }
  console.log('region ' + W + 'x' + H + ' scale=' + scale.toFixed(4) + ' rows: ' + rows.join(','));
  if (!n) { console.log('no arrow ink found'); return; }
  const inkCy = (minY + maxY) / 2, inkCx = (minX + maxX) / 2;
  const btnCy = (H - 1) / 2, btnCx = (W - 1) / 2;
  console.log(JSON.stringify({
    inkPixels: n,
    inkBox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    inkCenter: { x: +inkCx.toFixed(2), y: +inkCy.toFixed(2) },
    buttonCenter: { x: +btnCx.toFixed(2), y: +btnCy.toFixed(2) },
    offsetShotPx: { x: +(inkCx - btnCx).toFixed(2), y: +(inkCy - btnCy).toFixed(2) },
    offsetPagePx: { x: +((inkCx - btnCx) / scale).toFixed(2), y: +((inkCy - btnCy) / scale).toFixed(2) },
  }));
})();
