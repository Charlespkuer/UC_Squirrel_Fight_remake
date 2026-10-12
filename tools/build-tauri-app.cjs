/* 桌面版的构建入口（以「本地尽量轻」为目标）。
 *
 *   node tools/build-tauri-app.cjs            # 编译 → 把 exe 拷到 src-tauri/dist/ 和**游戏根目录**（约 3 MB）
 *   node tools/build-tauri-app.cjs --clean    # 编译 → 拷贝 → cargo clean（删掉 target/，约 2.8 GB）
 *   node tools/build-tauri-app.cjs --installer # 另打一个 NSIS 安装包（临时暂存 web/，打完就删）
 *   node tools/build-tauri-app.cjs --web      # 只生成前端快照 src-tauri/web（打安装包前用）
 *   node tools/build-tauri-app.cjs --web --check  # 检查那份快照是不是最新的（CI 用它）
 *
 * 为什么要有这个脚本：
 *   Rust 的 target/ 是编译中间产物，动辄 2~3 GB，但**运行完全不需要**它；
 *   真正要留的只有 squirrel_fight.exe（轻壳，几 MB，前端不在里面，
 *   游戏根目录那份就是 Windows 的双击入口；src-tauri/dist/ 里那份是留档，两者同一个文件）
 *   窗口自带迷你服务器，直接读游戏目录里的 index.html / images / audio）。
 *   所以平时用 --clean 构建，磁盘上就只多一个几 MB 的 exe。
 *
 * 安装包（给别人装的那种）才需要把前端一起带上：那一版用
 * tauri.bundle.conf.json 把 frontendDist 指到临时生成的 web/，打完这个脚本会把 web/ 删掉。
 *
 * 【2026-10 瘦身】原来「生成前端快照」是单独一个 tools/build-tauri-web.cjs，而这个脚本
 * 打安装包时又要调它 —— 两件事本来就是一件事（同一个 web/ 目录、同一份指纹），
 * 现在合并成这个脚本的 --web 模式（build-apk.ps1 / tauri.yml 改成 --web）。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
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
const TAURI = path.join(ROOT, 'src-tauri');
const DIST = path.join(TAURI, 'dist');
const APP = path.join(DIST, 'squirrel_fight.exe');
/** Windows 双击入口：游戏根目录下的同名 exe（和 scripts/、css/ 同级）。 */
const ROOT_APP = path.join(ROOT, 'squirrel_fight.exe');
const WEB = path.join(TAURI, 'web');
const args = process.argv.slice(2);
const CLEAN = args.includes('--clean');
const INSTALLER = args.includes('--installer');
const WEB_ONLY = args.includes('--web');
const WEB_CHECK = args.includes('--check');

/* ============================================================
 * 前端快照 src-tauri/web（原 tools/build-tauri-web.cjs 的正文）
 *
 * 轻壳（默认桌面版）不嵌前端：它自带迷你服务器直接读游戏目录；只有打**安装包**时才需要
 * 把 css/js/images/audio + 首页复制成一份快照。生成时写 web/BUILD.txt（内容指纹 + 文件数 + 时间），
 * --web --check 用它判断是否过期（CI 里跑这一条，防止安装包嵌到旧前端）。
 * ============================================================ */
const WEB_OUT = path.join(TAURI, 'web');
const WEB_ITEMS = ['css', 'js', 'images', 'audio'];
const WEB_STAMP = path.join(WEB_OUT, 'BUILD.txt');

/** 快照要**所有**文件（不能用文件末尾那个 walk：它只认 exe/msi/dmg 这类产物）。 */
function webWalk(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) webWalk(full, base, acc);
    else acc.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return acc;
}

function webFingerprint() {
  const hash = crypto.createHash('sha256');
  let files = 0;
  let bytes = 0;
  for (const item of WEB_ITEMS.concat(['scripts/index.html'])) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) {
      for (const rel of webWalk(src).sort()) {
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

function webReadStamp() {
  if (!fs.existsSync(WEB_STAMP)) return null;
  const text = fs.readFileSync(WEB_STAMP, 'utf8');
  const get = (k) => (text.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];
  return { hash: get('hash'), files: Number(get('files')), bytes: Number(get('bytes')), built: get('built') };
}

/** 生成（或校验）前端快照；返回 true 表示成功。 */
function buildWebSnapshot(checkOnly) {
  const now = webFingerprint();
  if (checkOnly) {
    const stamp = webReadStamp();
    if (!stamp) {
      console.error('[x] src-tauri/web 还没有生成过：先跑 node tools/build-tauri-app.cjs --web');
      return false;
    }
    if (stamp.hash !== now.hash || stamp.files !== now.files) {
      console.error('[x] src-tauri/web 快照已过期（app 会嵌到旧前端）：');
      console.error('    快照 hash=' + stamp.hash + ' files=' + stamp.files + '（' + stamp.built + '）');
      console.error('    当前源 hash=' + now.hash + ' files=' + now.files);
      console.error('    重新生成：node tools/build-tauri-app.cjs --web');
      return false;
    }
    console.log('✓ src-tauri/web 快照是最新的（hash=' + now.hash + '，' + now.files + ' 个文件，' + (now.bytes / 1048576).toFixed(1) + ' MB）');
    return true;
  }
  fs.rmSync(WEB_OUT, { recursive: true, force: true });
  fs.mkdirSync(WEB_OUT, { recursive: true });
  /* 首页在新布局里住在 scripts/index.html，但内嵌进安装包时仍要放到 web 根：
   * 页面里的 css/… 是按 URL 根解析的（网页版那边靠服务器的 / → scripts/index.html 映射）。 */
  const entry = ['index.html', 'scripts/index.html'].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
  if (entry) {
    fs.copyFileSync(entry, path.join(WEB_OUT, 'index.html'));
    console.log('首页：' + path.relative(ROOT, entry).replace(/\\/g, '/') + ' → web/index.html');
  } else {
    console.warn('警告：找不到 index.html（根目录或 scripts/），安装包里会没有首页');
  }
  for (const item of WEB_ITEMS) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) { console.warn('跳过（不存在）: ' + item); continue; }
    copyRecursive(src, path.join(WEB_OUT, item));
  }
  let size = 0;
  const files = webWalk(WEB_OUT);
  for (const rel of files) size += fs.statSync(path.join(WEB_OUT, rel)).size;
  fs.writeFileSync(WEB_STAMP, [
    '# 这份快照由 tools/build-tauri-app.cjs --web 生成；桌面版（Tauri）嵌的就是它。',
    '# 改了前端就要重新生成（或直接 npm run build，beforeBuildCommand 会自动重跑）。',
    'hash=' + now.hash,
    'files=' + now.files,
    'bytes=' + now.bytes,
    'built=' + new Date().toISOString(),
    'from=' + ROOT,
    '',
  ].join('\n'));
  console.log('已生成 src-tauri/web：' + files.length + ' 个文件，' + (size / 1048576).toFixed(1) + ' MB，指纹 ' + now.hash);
  console.log('（Tauri 的 frontendDist 指向它，安装包不会带上 references/ 与开发工具）');
  return true;
}

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) copyRecursive(path.join(src, name), path.join(dest, name));
  } else {
    fs.copyFileSync(src, dest);
  }
}

if (WEB_ONLY) {
  process.exit(buildWebSnapshot(WEB_CHECK) ? 0 : 1);
}

function findCargo() {
  const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const probe = spawnSync(exe, ['--version'], { stdio: 'ignore' });
  if (probe.status === 0) return exe;
  const home = os.homedir();
  const cand = path.join(home, '.cargo', 'bin', exe);
  if (fs.existsSync(cand)) return cand;
  return null;
}

function run(cmd, argv, opts) {
  console.log('> ' + [cmd].concat(argv).join(' '));
  const r = spawnSync(cmd, argv, Object.assign({ cwd: TAURI, stdio: 'inherit', env: ENV }, opts || {}));
  if (r.status !== 0) {
    console.error('[x] 命令失败：' + cmd + ' ' + argv.join(' '));
    process.exit(r.status || 1);
  }
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else total += fs.statSync(full).size;
    }
  }
  return total;
}

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

const cargo = findCargo();
if (!cargo) {
  console.error('[x] 找不到 cargo：先装 Rust（https://rustup.rs），或用 GitHub Actions 的 tauri.yml 打。');
  process.exit(1);
}
// Tauri CLI 自己也要能找到 cargo，所以把它的目录塞进 PATH
const ENV = Object.assign({}, process.env, {
  PATH: path.dirname(cargo) + path.delimiter + (process.env.PATH || ''),
});
// 安装包模式会临时生成 web/：不管成功失败都别留在磁盘上
if (INSTALLER) process.on('exit', () => { try { fs.rmSync(WEB, { recursive: true, force: true }); } catch (e) {} });

const targetBefore = dirSize(path.join(TAURI, 'target'));
run(cargo, ['build', '--release']);

const built = path.join(TAURI, 'target', 'release', 'squirrel_fight.exe');
if (!fs.existsSync(built)) {
  console.error('[x] 没找到产物：' + built);
  process.exit(1);
}
fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(built, APP);
console.log('✓ 已生成 ' + path.relative(ROOT, APP) + '（' + mb(fs.statSync(APP).size) + '）');
// 游戏根目录也放一份：那才是 Windows 的双击入口（scripts\启动游戏.cmd 也会先找它）
fs.copyFileSync(built, ROOT_APP);
console.log('✓ 已更新 ' + path.relative(ROOT, ROOT_APP) + '（' + mb(fs.statSync(ROOT_APP).size) + '，双击入口）');

if (INSTALLER) {
  console.log('— 打安装包：临时暂存前端到 src-tauri/web（结束会删掉）');
  if (!buildWebSnapshot(false)) { console.error('[x] 前端快照生成失败'); process.exit(1); }
  // 先清掉上一次的 bundle 目录，免得把旧版本的安装包也拷过去
  fs.rmSync(path.join(TAURI, 'target', 'release', 'bundle'), { recursive: true, force: true });
  run(process.execPath, [path.join(ROOT, 'src-tauri', 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
    'build', '--config', 'tauri.bundle.conf.json', '--bundles', process.platform === 'win32' ? 'nsis' : 'dmg,app'], { cwd: TAURI });
  const bundleDir = path.join(TAURI, 'target', 'release', 'bundle');
  if (fs.existsSync(bundleDir)) {
    for (const rel of walk(bundleDir)) {
      const src = path.join(bundleDir, rel);
      const dest = path.join(DIST, path.basename(src));
      fs.copyFileSync(src, dest);
      console.log('✓ 安装包 ' + path.relative(ROOT, dest) + '（' + mb(fs.statSync(dest).size) + '）');
    }
  }
  fs.rmSync(WEB, { recursive: true, force: true });
  console.log('✓ 已删除临时的 src-tauri/web（省 55 MB；打下一个安装包时会自动重建）');
}

function walk(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, acc);
    else if (/\.(exe|msi|dmg|app\.tar\.gz)$/i.test(e.name)) acc.push(path.relative(base, full));
  }
  return acc;
}

if (CLEAN) {
  console.log('— cargo clean：删掉 target/（编译中间产物，运行时不需要）');
  run(cargo, ['clean']);
  const after = dirSize(path.join(TAURI, 'target'));
  console.log('✓ target/ ' + mb(targetBefore) + ' → ' + mb(after) + '，释放 ' + mb(Math.max(0, targetBefore - after)));
}

console.log('');
console.log('桌面版目录现在是：');
console.log('  ' + path.relative(ROOT, ROOT_APP) + '  ' + mb(fs.statSync(ROOT_APP).size) + '（游戏根目录的双击入口）');
console.log('  ' + path.relative(ROOT, APP) + '  ' + mb(fs.statSync(APP).size) + '（同一个文件的留档副本）');
console.log('  双击根目录那个 exe 就会开原生窗口；脚本入口是 scripts\\启动游戏.cmd（兜底）。');
if (!CLEAN) console.log('  想立刻回收编译缓存：node tools/build-tauri-app.cjs --clean（会重新编译一次）');
