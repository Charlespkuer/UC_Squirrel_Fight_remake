/* Measure the ink extent of each glyph in images/num_28.png (26x23 cells) so the
 * digit advance can be tightened without clipping neighbouring characters. */
const fs = require('node:fs');
const path = require('node:path');
let graphics;
try { graphics = require('@napi-rs/canvas'); }
catch { graphics = require(path.join(process.env.USERPROFILE || 'C:/Users/Charles', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')); }
const file = path.resolve(__dirname, '..', '..', 'images', 'num_28.png');
const img = graphics.createCanvas ? null : null;
const src = graphics.loadImage ? null : null;
const { createCanvas, loadImage } = graphics;

(async () => {
  const image = await loadImage(file);
  const W = 26, H = 23, keys = '0123456789%×';
  const c = createCanvas(image.width, image.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(image, 0, 0);
  console.log(`atlas: ${image.width} x ${image.height}  cells: ${image.width / W} x ${image.height / H}`);
  console.log('idx  glyph  inkLeft inkRight inkWidth  leftPad rightPad');
  let minLeft = W, maxRight = 0;
  for (let i = 0; i < keys.length; i++) {
    const d = ctx.getImageData(i * W, 0, W, H).data;
    let left = W, right = -1;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (d[(y * W + x) * 4 + 3] > 24) { if (x < left) left = x; if (x > right) right = x; break; }
      }
    }
    if (right < 0) { console.log(`  ${i}   ${keys[i]}    (空)`); continue; }
    minLeft = Math.min(minLeft, left); maxRight = Math.max(maxRight, right);
    console.log(`  ${String(i).padStart(2)}   ${keys[i]}      ${String(left).padStart(4)} ${String(right).padStart(7)} ${String(right - left + 1).padStart(8)} ${String(left).padStart(8)} ${String(W - 1 - right).padStart(8)}`);
  }
  console.log(`\n最宽墨迹: ${maxRight - minLeft + 1} / 格宽 ${W}  → 最小安全推进 ≈ ${(((maxRight - minLeft + 1) / W) * 100).toFixed(0)}% 格宽`);
})();
