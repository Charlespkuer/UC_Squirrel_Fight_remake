/* Compare the inner game.zip of h5ssdz_9game_4230.apk against the project tree.
 * Reports, for every APK asset, whether the project already has an identical copy,
 * a different copy, or nothing at all. Read-only audit. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..', '..');
const src = path.join(__dirname, 'game');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const norm = (s) => s.replace(/\\/g, '/').toLowerCase();

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, base, out);
    else out.push({ abs: p, rel: norm(path.relative(base, p)) });
  }
  return out;
}

// Everything the project ships, excluding the audit workspace itself and the
// raw reference screenshots (which are inputs, not extracted game assets).
const skip = new Set(['tools', 'references', 'node_modules', '.git']);
const project = walk(root).filter((f) => !skip.has(f.rel.split('/')[0]) && !f.rel.startsWith('tools/apk-audit/'));
const byRel = new Map(), byBase = new Map();
for (const f of project) {
  byRel.set(f.rel, f);
  const b = f.rel.split('/').pop();
  if (!byBase.has(b)) byBase.set(b, []);
  byBase.get(b).push(f);
}

const apk = walk(src);
const identical = [], different = [], missing = [];
for (const f of apk) {
  const size = fs.statSync(f.abs).size;
  // Candidate project locations: same relative path, js/orig move, or same basename.
  const cands = [];
  const direct = byRel.get(f.rel);
  if (direct) cands.push(direct);
  if (f.rel.startsWith('js/')) {
    const moved = byRel.get('js/orig/' + f.rel.slice(3));
    if (moved) cands.push(moved);
  }
  for (const b of byBase.get(f.rel.split('/').pop()) || []) cands.push(b);

  let same = null, diff = null;
  const h = size <= 8 * 1024 * 1024 ? sha(f.abs) : null;
  for (const c of cands) {
    if (fs.statSync(c.abs).size !== size) { if (!diff) diff = c; continue; }
    if (h && sha(c.abs) === h) { same = c; break; }
    if (!diff) diff = c;
  }
  const row = { rel: f.rel, size, where: same ? same.rel : null, other: !same && diff ? diff.rel : null };
  if (same) identical.push(row);
  else if (diff) different.push(row);
  else missing.push(row);
}

const fmt = (rows) => rows.sort((a, b) => b.size - a.size)
  .map((r) => `| \`${r.rel}\` | ${(r.size / 1024).toFixed(1)} KB | ${r.where || r.other || ''} |`).join('\n');

const report = `# h5ssdz_9game_4230.apk 内层 game.zip 与项目资源对照

- APK: \`E:\\squirrel fight1\\uc松鼠大战电脑版 PC版\\h5ssdz_9game_4230.apk\`
- 内层 \`assets/game.zip\`: 33,105,511 字节，存储方式为 stored（未压缩）
- 解出资源: ${apk.length} 个文件

## 汇总

| 状态 | 数量 |
| --- | --- |
| 项目已有完全相同的副本（逐字节 SHA-256 一致） | ${identical.length} |
| 项目有同名/同相对路径但内容不同的文件 | ${different.length} |
| 项目完全没有 | ${missing.length} |

## 完全一致（项目已完整收录）

| APK 内路径 | 大小 | 项目中的位置 |
| --- | --- | --- |
${fmt(identical)}

## 存在但内容不同

| APK 内路径 | 大小 | 项目中的对应文件 |
| --- | --- | --- |
${fmt(different) || '（无）'}

## 项目缺失（APK 里有、项目里找不到）

| APK 内路径 | 大小 | 最接近的项目文件 |
| --- | --- | --- |
${fmt(missing) || '（无）'}
`;

fs.writeFileSync(path.join(__dirname, 'report.md'), report);
console.log(`apk files      : ${apk.length}`);
console.log(`identical      : ${identical.length}`);
console.log(`different      : ${different.length}`);
console.log(`missing        : ${missing.length}`);
console.log('--- different (up to 40) ---');
for (const r of different.slice(0, 40)) console.log(`  ${r.rel}  ->  ${r.other}  (${(r.size / 1024).toFixed(1)} KB)`);
console.log('--- missing (up to 40) ---');
for (const r of missing.slice(0, 40)) console.log(`  ${r.rel}  (${(r.size / 1024).toFixed(1)} KB)`);
