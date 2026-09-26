/* ============================================================
 * tools/check-asset-paths.cjs —— 跨平台发布体检（Windows / macOS / Linux）
 *
 *   node tools/check-asset-paths.cjs
 *
 * 三项检查：
 *   1. 代码里写死的资源引用（`images/...` 这类，含目录前缀）逐段核对**真实大小写**。
 *      Windows 与 macOS 的文件系统默认不区分大小写，写错也能跑；发布到
 *      GitHub Pages / 任何 Linux 主机就会 404。
 *   2. 仓库里是否存在「只差大小写」的重复路径：这种文件在 Windows/macOS 上
 *      会互相覆盖，在 Linux 上又是两个文件，checkout 出来两边不一致。
 *   3. 断链：引用了但文件真的不存在。
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
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


const ROOT = findRoot(__dirname);
const SCAN_EXT = ['.html', '.css', '.js', '.json'];
// 跳过不参与发布的目录：原版归档源码、APK 取证工具与它们的产物、原客户端脚本副本、
// 以及 Tauri 的暂存目录（src-tauri/web 是 build-tauri-web.cjs 复制出来的构建产物，
// 其中 js/orig 本来就带一批「引用了但原版没打包」的路径，不该算发布断链）
// 按「路径结尾」判断，不写死 tools/ 在第几层（放哪都能用）
const SKIP_DIRS = new Set(['node_modules', '.git', 'js/orig', 'src-tauri', 'apk-audit', 'research/original']);
const ROOTS = 'images|css|js|audio|music|fonts|assets';
// 引号/括号里的资源路径：以四个已知资源目录开头，允许中文与常见符号
const REF_RE = new RegExp('["\'(`]((?:' + ROOTS + ')/[A-Za-z0-9_@%\\-./\\u4e00-\\u9fa5]*)', 'g');

const cache = new Map();
function listing(dir) {
  if (!cache.has(dir)) cache.set(dir, fs.existsSync(dir) ? fs.readdirSync(dir) : null);
  return cache.get(dir);
}
/** 逐段核对大小写；返回 null 表示存在，否则返回问题描述。 */
function resolveExact(rel, wantDir) {
  const parts = rel.split('/').filter(Boolean);
  let dir = ROOT;
  for (let i = 0; i < parts.length; i++) {
    const entries = listing(dir);
    if (!entries) return '父目录不存在：' + (path.relative(ROOT, dir).replace(/\\/g, '/') || '.');
    const hit = entries.find((name) => name === parts[i]);
    if (!hit) {
      const ci = entries.find((name) => name.toLowerCase() === parts[i].toLowerCase());
      return ci ? '大小写不一致 → 应为 ' + parts.slice(0, i).concat(ci).join('/') : '不存在';
    }
    dir = path.join(dir, hit);
  }
  const isDir = fs.statSync(dir).isDirectory();
  if (wantDir && !isDir) return '期望是目录，实际是文件';
  if (!wantDir && isDir) return '期望是文件，实际是目录';
  return null;
}
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || Array.from(SKIP_DIRS).some((s) => rel === s || rel.endsWith('/' + s))) continue;
      walk(full, out);
    } else if (SCAN_EXT.includes(path.extname(entry.name).toLowerCase())) out.push(rel);
  }
  return out;
}

/* ---------- 1 + 3：静态引用的路径与大小写 ---------- */
const files = walk(ROOT, []);
const problems = [];
let checked = 0;
for (const rel of files) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const seen = new Set();
  for (const match of text.matchAll(REF_RE)) {
    let ref = match[1];
    if (ref.includes('${')) ref = ref.slice(0, ref.indexOf('${'));   // 模板拼接只查前缀
    const isDir = ref.endsWith('/');
    const base = ref.replace(/\/+$/, '');
    if (!base || seen.has(base)) continue;
    seen.add(base);
    // 没有扩展名又不是目录结尾的（例如 'images/classic/icons/' + kind + '.png' 被切成 images/classic/icons）
    const looksFile = /\.[a-z0-9]{2,5}$/i.test(base);
    if (!isDir && !looksFile) continue;                              // 交给目录前缀那条规则
    checked++;
    const issue = resolveExact(base, isDir || !looksFile);
    if (issue) problems.push(rel + '  →  ' + ref + '   [' + issue + ']');
  }
}

/* ---------- 2：只差大小写的重复路径 ---------- */
const all = [];
(function walkAll(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      walkAll(full);
    } else all.push(rel);
  }
})(ROOT);
const byLower = new Map();
for (const rel of all) {
  const key = rel.toLowerCase();
  if (!byLower.has(key)) byLower.set(key, []);
  byLower.get(key).push(rel);
}
const collisions = [...byLower.values()].filter((group) => group.length > 1);

console.log('扫描 ' + files.length + ' 个源文件、' + all.length + ' 个仓库文件，核对 ' + checked + ' 条静态资源引用');
if (!problems.length) console.log('✓ 引用路径与大小写全部命中');
else {
  console.log('✗ 发现 ' + problems.length + ' 条引用问题：');
  for (const p of problems) console.log('  ' + p);
}
if (!collisions.length) console.log('✓ 没有只差大小写的重复路径（Windows/macOS/Linux checkout 一致）');
else {
  console.log('✗ 发现 ' + collisions.length + ' 组只差大小写的路径：');
  for (const group of collisions) console.log('  ' + group.join('  ==  '));
}
process.exitCode = problems.length || collisions.length ? 1 : 0;
