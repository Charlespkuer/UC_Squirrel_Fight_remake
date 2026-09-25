/* 开发检查：把 images/classic/sprites 下按 sheet 分组，拼成带标签的联络表，便于挑选可用素材。
 * node tools/research/contact-sheet.cjs resource_2 resource_6 ...
 * 输出 tools/research/sheet-<name>.png
 */
const fs = require('node:fs');
const path = require('node:path');
const g = require(path.join(process.env.USERPROFILE || 'C:/Users/Charles',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
process.chdir(path.resolve(__dirname, '..', '..', '..'));

(async () => {
  const names = process.argv.slice(2);
  const dir = 'images/classic/sprites';
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  for (const name of names) {
    const files = all.filter((f) => f.startsWith(name + '-'))
      .sort((a, b) => {
        const num = (s) => { const m = s.match(/-(\d+)([a-z]?)\.png$/); return m ? Number(m[1]) * 10 + (m[2] ? m[2].charCodeAt(0) - 96 : 0) : 0; };
        return num(a) - num(b);
      });
    if (!files.length) { console.log('no frames for ' + name); continue; }
    const CELL = 132, PAD = 20, LABEL = 18;
    const cols = Math.min(8, files.length);
    const rows = Math.ceil(files.length / cols);
    const c = g.createCanvas(cols * CELL + PAD, rows * (CELL + LABEL) + PAD);
    const cx = c.getContext('2d');
    cx.fillStyle = '#20262b'; cx.fillRect(0, 0, c.width, c.height);
    let maxW = 0, maxH = 0;
    for (let i = 0; i < files.length; i++) {
      const img = await g.loadImage(path.join(dir, files[i]));
      maxW = Math.max(maxW, img.width); maxH = Math.max(maxH, img.height);
      const col = i % cols, row = Math.floor(i / cols);
      const x = PAD / 2 + col * CELL, y = PAD / 2 + row * (CELL + LABEL);
      // 棋盘底便于看透明区域
      cx.fillStyle = '#2c343a'; cx.fillRect(x, y, CELL - 6, CELL - 6);
      cx.fillStyle = '#39424a';
      for (let by = 0; by < CELL - 6; by += 12) for (let bx = 0; bx < CELL - 6; bx += 12) {
        if (((bx / 12) + (by / 12)) % 2 === 0) cx.fillRect(x + bx, y + by, 12, 12);
      }
      const k = Math.min((CELL - 14) / img.width, (CELL - 14) / img.height, 1);
      const w = img.width * k, h = img.height * k;
      cx.imageSmoothingEnabled = k < 1;
      cx.drawImage(img, x + (CELL - 6 - w) / 2, y + (CELL - 6 - h) / 2, w, h);
      cx.fillStyle = '#ffeb99'; cx.font = '11px monospace';
      cx.fillText(files[i].replace(name + '-', '').replace('.png', ''), x + 2, y + CELL + 10);
    }
    const out = 'tools/research/sheet-' + name + '.png';
    fs.writeFileSync(out, c.toBuffer('image/png'));
    console.log(out + '  ' + files.length + ' frames  ' + c.width + 'x' + c.height + '  maxSource ' + maxW + 'x' + maxH);
  }
})();
