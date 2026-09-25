/* Build images/classic/icons/prop-51.png — the ladder fragment icon.
 *
 * Derived art: the silhouette comes from the shipped 白色碎片 (prop-24.png), tinted
 * gold and stamped with a "?" to match the reference screenshot
 * references/new/微信图片_20260924010916_259_2.jpg (a golden shard with "?" as the
 * "please click" pickup in a ladder fight). Documented as derived, not original.
 */
const path = require('node:path');
const fs = require('node:fs');
let graphics;
try { graphics = require('@napi-rs/canvas'); }
catch { graphics = require(path.join(process.env.USERPROFILE || 'C:/Users/Charles', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')); }
const { createCanvas, loadImage } = graphics;

const root = path.resolve(__dirname, '..', '..');
const src = path.join(root, 'images', 'classic', 'icons', 'prop-24.png');
const out = path.join(root, 'images', 'classic', 'icons', 'prop-51.png');
if (fs.existsSync(out) && !process.argv.includes('--force')) { console.log('已存在，跳过：' + out); process.exit(0); }

(async () => {
  const shard = await loadImage(fs.readFileSync(src));
  const W = shard.width, H = shard.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(shard, 0, 0);

  // 只在碎片已有像素上刷金色，保留原来的高光与描边
  ctx.globalCompositeOperation = 'source-atop';
  const grad = ctx.createLinearGradient(0, H * 0.1, W * 0.9, H);
  grad.addColorStop(0, '#ffe9a8');
  grad.addColorStop(0.45, '#f4c451');
  grad.addColorStop(1, '#c98a1c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  // 中间的「?」，对应参考图里碎片上的问号
  const size = Math.round(H * 0.52);
  ctx.font = 'bold ' + size + 'px "Microsoft YaHei", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = W * 0.5, cy = H * 0.53;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, H * 0.05);
  ctx.strokeStyle = '#8a5a12';
  ctx.strokeText('?', cx, cy);
  ctx.fillStyle = '#fff3c4';
  ctx.fillText('?', cx, cy);

  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log('写入 ' + out + '  (' + W + 'x' + H + ')');
})();
