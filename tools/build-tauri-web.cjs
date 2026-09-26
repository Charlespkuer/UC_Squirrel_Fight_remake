/* 把运行需要的静态文件复制到 src-tauri/web —— **只有打安装包时才需要**。
 * 轻壳（默认的桌面版）不嵌前端：它自带迷你服务器，直接读游戏目录里的
 * index.html / css / js / images / audio，所以平时根本不用生成这份副本。
 *
 *   node tools/build-tauri-web.cjs          # 生成快照（打安装包前）
 *   node tools/build-tauri-web.cjs --check  # 检查快照是不是最新的
 *
 * 生成时写 web/BUILD.txt（内容指纹 + 文件数 + 时间），--check 用它判断是否过期。
 * 打安装包用：node tools/build-tauri-app.cjs --installer（它会临时生成、打完自动删掉）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
const OUT = path.join(ROOT, 'src-tauri', 'web');
const ITEMS = ['css', 'js', 'images', 'audio'];
// 首页在 scripts/index.html 里；快照里仍然放到 web/ 根，让 html 里的相对引用原样可用
const ENTRY_SRC = path.join(ROOT, 'scripts', 'index.html');
const STAMP = path.join(OUT, 'BUILD.txt');
const CHECK = process.argv.includes('--check');

function walk(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, acc);
    else acc.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return acc;
}

/** 内容指纹：只算 index.html / css / js 的字节（图片音频太大且很少改，用文件数+总大小代替） */
function fingerprint() {
  const hash = crypto.createHash('sha256');
  let files = 0;
  let bytes = 0;
  for (const item of ITEMS.concat(['scripts/index.html'])) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) {
      for (const rel of walk(src).sort()) {
        const full = path.join(src, rel);
        const size = fs.statSync(full).size;
        files++;
        bytes += size;
        if (/\.(html|css|js)$/i.test(rel)) hash.update(rel).update(fs.readFileSync(full));
      }
    } else {
      const size = fs.statSync(src).size;
      files++;
      bytes += size;
      if (/\.(html|css|js)$/i.test(item)) hash.update(item).update(fs.readFileSync(src));
    }
  }
  return { hash: hash.digest('hex').slice(0, 16), files, bytes };
}

function readStamp() {
  if (!fs.existsSync(STAMP)) return null;
  const text = fs.readFileSync(STAMP, 'utf8');
  const get = (k) => (text.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];
  return { hash: get('hash'), files: Number(get('files')), bytes: Number(get('bytes')), built: get('built') };
}

function copy(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(dest, name));
  } else {
    fs.copyFileSync(src, dest);
  }
}

const now = fingerprint();

if (CHECK) {
  const stamp = readStamp();
  if (!stamp) {
    console.error('[x] src-tauri/web 还没有生成过：先跑 node tools/build-tauri-web.cjs');
    process.exit(1);
  }
  const stale = stamp.hash !== now.hash || stamp.files !== now.files;
  if (stale) {
    console.error('[x] src-tauri/web 快照已过期（app 会嵌到旧前端）：');
    console.error('    快照 hash=' + stamp.hash + ' files=' + stamp.files + '（' + stamp.built + '）');
    console.error('    当前源 hash=' + now.hash + ' files=' + now.files);
    console.error('    重新生成：node tools/build-tauri-web.cjs');
    process.exit(1);
  }
  console.log('✓ src-tauri/web 快照是最新的（hash=' + now.hash + '，' + now.files + ' 个文件，' + (now.bytes / 1048576).toFixed(1) + ' MB）');
  process.exit(0);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const item of ITEMS) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) { console.warn('跳过（不存在）: ' + item); continue; }
  copy(src, path.join(OUT, item));
}

const files = walk(OUT).length;
let size = 0;
for (const rel of walk(OUT)) size += fs.statSync(path.join(OUT, rel)).size;
fs.writeFileSync(STAMP, [
  '# 这份快照由 tools/build-tauri-web.cjs 生成；桌面版（Tauri）嵌的就是它。',
  '# 改了前端就要重新生成（或直接 npm run build，beforeBuildCommand 会自动重跑）。',
  'hash=' + now.hash,
  'files=' + now.files,
  'bytes=' + now.bytes,
  'built=' + new Date().toISOString(),
  'from=' + ROOT,
  '',
].join('\n'));

console.log('已生成 src-tauri/web：' + files + ' 个文件，' + (size / 1048576).toFixed(1) + ' MB，指纹 ' + now.hash);
console.log('（Tauri 的 frontendDist 指向它，安装包不会带上 references/ 与开发工具）');
