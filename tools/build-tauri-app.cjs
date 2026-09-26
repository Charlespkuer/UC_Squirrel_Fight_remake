/* 桌面版的构建入口（以「本地尽量轻」为目标）。
 *
 *   node tools/build-tauri-app.cjs            # 编译 → 把 exe 拷到 src-tauri/dist/（约 3 MB）
 *   node tools/build-tauri-app.cjs --clean    # 编译 → 拷贝 → cargo clean（删掉 target/，约 2.8 GB）
 *   node tools/build-tauri-app.cjs --installer # 另打一个 NSIS 安装包（临时暂存 web/，打完就删）
 *
 * 为什么要有这个脚本：
 *   Rust 的 target/ 是编译中间产物，动辄 2~3 GB，但**运行完全不需要**它；
 *   真正要留的只有 src-tauri/dist/ssdz-classic.exe（轻壳，几 MB，前端不在里面，
 *   窗口自带迷你服务器，直接读游戏目录里的 index.html / images / audio）。
 *   所以平时用 --clean 构建，磁盘上就只多一个几 MB 的 exe。
 *
 * 安装包（给别人装的那种）才需要把前端一起带上：那一版用
 * tauri.bundle.conf.json 把 frontendDist 指到临时生成的 web/，打完这个脚本会把 web/ 删掉。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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
const APP = path.join(DIST, 'ssdz-classic.exe');
const WEB = path.join(TAURI, 'web');
const args = process.argv.slice(2);
const CLEAN = args.includes('--clean');
const INSTALLER = args.includes('--installer');

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

const built = path.join(TAURI, 'target', 'release', 'ssdz-classic.exe');
if (!fs.existsSync(built)) {
  console.error('[x] 没找到产物：' + built);
  process.exit(1);
}
fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(built, APP);
console.log('✓ 已生成 ' + path.relative(ROOT, APP) + '（' + mb(fs.statSync(APP).size) + '）');

if (INSTALLER) {
  console.log('— 打安装包：临时暂存前端到 src-tauri/web（结束会删掉）');
  run(process.execPath, [path.join(__dirname, 'build-tauri-web.cjs')], { cwd: ROOT });
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
console.log('  ' + path.relative(ROOT, APP) + '  ' + mb(fs.statSync(APP).size) + '（轻壳：前端与存档都在游戏目录里）');
console.log('  双击游戏目录里的 启动游戏.cmd 就会用它开原生窗口。');
if (!CLEAN) console.log('  想立刻回收编译缓存：node tools/build-tauri-app.cjs --clean（会重新编译一次）');
