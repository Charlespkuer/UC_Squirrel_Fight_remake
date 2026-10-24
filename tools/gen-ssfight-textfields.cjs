#!/usr/bin/env node
/*
 * tools/gen-ssfight-textfields.cjs — 从原版 ssfight.swf 提取 DefineEditText(tag 37) 的
 * 字段元数据（边界/对齐/边距/行距/字号），写到 images/ssfight/ui/textfields.json。
 *
 * 为什么需要这个：html5 导出的 tags.json 里文本标签(tp 11)只保留了 rs 文字段
 * （rs.x/rs.y 其实是字段框左下角，不是字形基线），丢掉了字段框边界与对齐方式。
 * 直接按 rs.x/rs.y 渲染会把昵称放到框底左端 —— 实测比原版 Flash 截图偏左 22、偏下 16。
 * Flash 对 EditText 的渲染语义：水平按 align 在 [XMin+lm, XMax-rm] 内对齐，
 * 首行基线在 YMin + 上边距 + leading + 字身 ascent 附近。渲染器需要这些数据。
 *
 * 用法: node tools/gen-ssfight-textfields.cjs
 * 输入: references/ssfight/ssfight/ssfight/ssfight.swf（构建期参考资料，运行时不读）
 * 输出: images/ssfight/ui/textfields.json  { id: {bd:[xmin,xmax,ymin,ymax], al, lm, rm, ind, lead, fh, fd, c} }
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SWF = path.join(ROOT, 'references/ssfight/ssfight/ssfight/ssfight.swf');
const OUT = path.join(ROOT, 'images/ssfight/ui/textfields.json');

function readRect(d, o) {
  const nbits = d[o] >> 3;
  let pos = o * 8 + 5;
  const vals = [];
  for (let i = 0; i < 4; i++) {
    let v = 0, s = false;
    for (let b = 0; b < nbits; b++) {
      const bit = (d[pos >> 3] >> (7 - (pos & 7))) & 1;
      if (b === 0 && bit) s = true;
      v = (v << 1) | bit;
      pos++;
    }
    if (s) v -= 1 << nbits;
    vals.push(v / 20);
  }
  return { vals, end: Math.ceil(pos / 8) };
}

function main() {
  const raw = fs.readFileSync(SWF);
  const sig = raw.slice(0, 3).toString();
  const data = sig === 'CWS' ? Buffer.concat([raw.slice(0, 8), zlib.inflateSync(raw.slice(8))])
    : sig === 'FWS' ? raw : null;
  if (!data) throw new Error('不认识的 SWF 头: ' + sig);

  let off = 8;
  const nb = data[off] >> 3;
  off += Math.ceil((5 + nb * 4) / 8) + 8; // 跳过舞台 RECT + frameRate/frameCount

  const out = {};
  let count = 0;
  while (off + 2 <= data.length) {
    const h = data.readUInt16LE(off); off += 2;
    const type = h >> 6;
    let len = h & 0x3f;
    if (len === 0x3f) { len = data.readUInt32LE(off); off += 4; }
    if (type === 37 && len > 4) {
      let p = off;
      const id = data.readUInt16LE(p); p += 2;
      const r = readRect(data, p); p = r.end;
      const f1 = data[p], f2 = data[p + 1]; p += 2;
      const flags = {
        hasText: !!(f1 & 0x80), multiline: !!(f1 & 0x20),
        hasTextColor: !!(f1 & 0x04), hasMaxLength: !!(f1 & 0x02), hasFont: !!(f1 & 0x01),
        hasFontClass: !!(f2 & 0x80), autoSize: !!(f2 & 0x40), hasLayout: !!(f2 & 0x20),
      };
      const rec = { bd: r.vals.map((v) => Math.round(v * 100) / 100) };
      if (flags.hasFont) { rec.fd = data.readUInt16LE(p); p += 2; }
      if (flags.hasFontClass) { p = data.indexOf(0, p) + 1; }
      if (flags.hasFont || flags.hasFontClass) { rec.fh = data.readUInt16LE(p) / 20; p += 2; }
      if (flags.hasTextColor) {
        const b0 = data[p], b1 = data[p + 1], b2 = data[p + 2];
        rec.c = `rgb(${b0},${b1},${b2})`;
        p += 4;
      }
      if (flags.hasMaxLength) p += 2;
      if (flags.hasLayout) {
        rec.al = data[p];                       // 0 左 1 右 2 居中 3 两端
        rec.lm = data.readUInt16LE(p + 1) / 20;
        rec.rm = data.readUInt16LE(p + 3) / 20;
        rec.ind = data.readUInt16LE(p + 5) / 20;
        rec.lead = data.readInt16LE(p + 7) / 20;
        p += 9;
      }
      if (flags.multiline) rec.ml = 1;
      if (flags.autoSize) rec.as = 1;
      out[id] = rec;
      count++;
    }
    off += len;
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`OK 提取 ${count} 个文本字段 → ${path.relative(ROOT, OUT)}`);
}

main();
