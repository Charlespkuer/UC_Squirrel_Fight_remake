/* 双机同步（scripts/sync/sync.js）+ 一键拉取远端更新（scripts/update-game.js）回归测试：
 * 在两个临时「游戏目录」之间真的传文件与存档；更新侧用手写的最小 zip 造一个「远端便携包」，
 * 走一遍「解压 → 算计划 → 覆盖」的真实路径（不联网）。
 * 跑法：node tools/test-sync.cjs
 * 不需要 ZeroTier：两台「机器」都在 127.0.0.1 上，用不同的根目录模拟。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SYNC_SRC = path.join(ROOT, 'scripts', 'sync', 'sync.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ssdz-sync-test-'));
const A = path.join(TMP, 'A');
const B = path.join(TMP, 'B');
const TOKEN = 'test-token-0123456789';
let PORT = 0;
let server = null;
let passed = 0;

function ok(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log('  ✓ ' + name);
}
/** 手写一个最小 zip（stored / 不压缩）：用例要造「远端便携包」，但不想依赖系统有没有 zip 命令。 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(zipPath, dir) {
  const files = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const abs = path.join(d, n);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else files.push([path.relative(dir, abs).split(path.sep).join('/'), fs.readFileSync(abs)]);
    }
  })(dir);
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  fs.writeFileSync(zipPath, Buffer.concat([Buffer.concat(chunks), cdBuf, eocd]));
  return files.length;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
/** 搭一个最小「游戏目录」：有 index.html、几个源文件、save/、以及各种应该被忽略的杂物。 */
function makeRoot(dir, name, port) {
  // 首页和真实布局一样放在 scripts/ 里（根目录的 index.html 属于旧布局，已被忽略）
  write(path.join(dir, 'scripts/index.html'), '<!DOCTYPE html>\n');
  write(path.join(dir, 'js/a.js'), 'console.log(1)\n');
  write(path.join(dir, 'css/b.css'), 'body{}\n');
  write(path.join(dir, 'save/progress.json'), JSON.stringify({ name, level: 1, savedAt: 1000, weapons: [], skills: [], props: {} }));
  write(path.join(dir, 'save/server.out.log'), 'log\n');
  write(path.join(dir, 'node_modules/pkg/index.js'), 'module.exports=1\n');
  // 开发截图是「跑出来」的产物，不进同步清单；同目录下的脚本属于源码，要照常同步
  write(path.join(dir, 'tools/verification/shot.png'), 'png\n');
  write(path.join(dir, 'tools/research/shot.png'), 'png\n');
  write(path.join(dir, 'tools/research/keep.cjs'), 'module.exports=1\n');
  write(path.join(dir, '.git/config'), '[core]\n');
  write(path.join(dir, '.DS_Store'), 'junk');
  // 根目录的启动器是本机私货（不进清单）；scripts/ 里的那份是仓库正式副本，必须照常同步
  write(path.join(dir, '启动游戏.command'), '#!/bin/bash\necho root\n');
  write(path.join(dir, 'scripts/启动游戏.command'), '#!/bin/bash\necho scripts\n');
  write(path.join(dir, 'scripts/sync/sync.js'), fs.readFileSync(SYNC_SRC, 'utf8'));
  write(path.join(dir, 'scripts/sync/sync.config.json'), JSON.stringify({ name, port, token: TOKEN, peers: {}, ignore: [] }, null, 2));
  /* ⚠ **必须有一份 .gitignore**：同步的屏蔽标准就是它（`sync.js` 的「.gitignore 感知」）。
   * 以前这里不写，于是"读 .gitignore"那条路**从来没被测到过** —— 前导 `/` 没锚定
   * （`/启动游戏.command` 把 `scripts/启动游戏.command` 一起忽略）这个 bug 就藏在盲区里。
   * 内容照仓库那份的**语义**精简：任意层级的目录名、前导 / 锚定、`**` 跨层、`!` 例外。 */
  write(path.join(dir, '.gitignore'),
    '# 本地产物\nout/\nreferences/\nimages/_reference/\nsave/\nnode_modules/\n__pycache__/\n' +
    '# 本机私货：只锚定游戏根那一个文件（前导 /）\n/启动游戏.command\n' +
    '# 固定相对路径与 ** 跨层\nsrc-tauri/target/\nimages/classic/**/.bak-upscale/\n' +
    '# 例外（! 后写优先）：`*.tmp` 命中内置清单，这一条必须能把它救回来\n*.tmp\n!tools/research/keep.tmp\n');
  // .gitignore 里被屏蔽、但同步必须照常搬的东西（既要挡、也要验证不误伤）
  write(path.join(dir, 'out/junk.bin'), 'junk\n');
  /* git 的规矩：**父目录被排除时，里面的 ! 例外救不回来**（`gitignore(5)` 明写）——
   * 所以这里故意在 out/ 下写一个被 `!` 点名的文件，断言它仍然不进清单。 */
  write(path.join(dir, 'out/keep.me'), 'keep\n');
  write(path.join(dir, 'images/_reference/shot.png'), 'png\n');
  write(path.join(dir, 'images/classic/foo/.bak-upscale/big.png'), 'png\n');
  write(path.join(dir, 'src-tauri/target/debug/x'), 'bin\n');
  write(path.join(dir, 'tools/research/keep.tmp'), 'tmp\n');
}
function run(dir, args, expectFail) {
  const exe = path.join(dir, 'scripts', 'sync', 'sync.js');
  try {
    return execFileSync(process.execPath, [exe].concat(args), { encoding: 'utf8', cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (expectFail) return String((e.stdout || '') + (e.stderr || ''));
    throw new Error('命令失败：' + args.join(' ') + '\n' + (e.stdout || '') + (e.stderr || ''));
  }
}
function get(host, port, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method: 'GET', path: urlPath, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ping(port) {
  try { const r = await get('127.0.0.1', port, '/api/ping'); return r.status === 200; } catch (e) { return false; }
}
/** 让系统分配一个临时端口：GitHub Windows runner 会保留 19000 附近的端口段，
 * 固定扫描 19000..19500 会全部 EACCES，测试在 Windows CI 上直接“找不到空闲端口”。 */
async function freePort(exclude) {
  for (let i = 0; i < 10; i++) {
    const s = http.createServer();
    await new Promise((resolve, reject) => {
      s.once('error', reject);
      s.listen(0, '127.0.0.1', resolve);
    });
    const p = s.address().port;
    await new Promise((resolve) => s.close(resolve));
    if (p !== exclude) return p;
  }
  throw new Error('找不到空闲端口');
}

(async () => {
  PORT = await freePort();

  makeRoot(A, 'A-mac', PORT);
  makeRoot(B, 'B-win', PORT);

  console.log('双机同步回归（临时目录 ' + TMP + '，端口 ' + PORT + '）');
  try {
    // ---- 起 B 的接收服务 ----
    server = spawn(process.execPath, [path.join(B, 'scripts', 'sync', 'sync.js'), 'serve'], { cwd: B, stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 40 && !up; i++) { await sleep(200); up = await ping(PORT); }
    ok('接收服务能起来', up);
    ok('/api/ping 不需要口令', (await get('127.0.0.1', PORT, '/api/ping')).status === 200);

    // ---- 口令 ----
    ok('口令不对 → 403', (await get('127.0.0.1', PORT, '/api/manifest', { 'x-ssdz-token': 'wrong' })).status === 403);
    ok('口令正确 → 200', (await get('127.0.0.1', PORT, '/api/manifest', { 'x-ssdz-token': TOKEN })).status === 200);

    // ---- 忽略清单：save/、node_modules/、.git/、*.log、sync.config.json、.DS_Store 都不进清单 ----
    const man = JSON.parse((await get('127.0.0.1', PORT, '/api/manifest', { 'x-ssdz-token': TOKEN })).body);
    const names = man.entries.map((e) => e.p).sort();
    ok('清单里没有 save/ node_modules/ .git/ .DS_Store', !names.some((p) => /^(save|node_modules|\.git)\//.test(p) || /(^|\/)\.DS_Store$/.test(p)));
    ok('清单里没有 *.log 与 sync.config.json', !names.some((p) => /\.log$/.test(p) || /sync\.config\.json$/.test(p)));
    ok('清单里有正常的源文件', names.includes('scripts/index.html') && names.includes('js/a.js') && names.includes('scripts/sync/sync.js'));
    ok('开发截图不进清单，tools/research 下的脚本照常同步',
      !names.some((p) => /^tools\/(verification|research)\/.*\.(png|jpg)$/.test(p)) && names.includes('tools/research/keep.cjs'));
    /* 根目录的启动器是本机私货（原生版路径/浏览器 profile/权限位都跟机器绑定）→ 不进清单；
     * 但**只忽略根目录那一个**，scripts/ 里的正式副本必须照常同步（前导 / 的锚定语义容易写错）。
     * ⚠ 这一条同时守着 `gitignoreGlobRegex` 的锚定：`.gitignore` 里写的是 `/启动游戏.command`，
     *   没锚定的话 `scripts/启动游戏.command` 会被一起吃掉（2026-10-16 修的就是这个）。 */
    ok('根目录启动器不进清单，scripts/ 里的正式副本照常同步',
      !names.includes('启动游戏.command') && names.includes('scripts/启动游戏.command'));

    /* ---- 屏蔽标准 = 游戏目录里的 .gitignore（见 makeRoot 里写的那份）----
     * 用户 2026-10 口径："使用双端对齐工具时读取 .gitignore 作为屏蔽标准，不要再同步 out 等文件夹。" */
    const st = JSON.parse((await get('127.0.0.1', PORT, '/local/status')).body);
    ok('/local/status 报出屏蔽标准（.gitignore 条数 + 探针）',
      !!(st.ignore && st.ignore.gitignore && st.ignore.gitignore.path === '.gitignore'
        && st.ignore.gitignore.rules >= 8 && st.ignore.sample && st.ignore.sample.out === true
        && st.ignore.sample.save === true && st.ignore.sample.code === true));
    ok('.gitignore 里的本地产物不进清单（out/ references/ images/_reference/ src-tauri/target/ **/.bak-upscale/）',
      !names.some((p) => /^out\//.test(p) || /^references\//.test(p) || /^images\/_reference\//.test(p)
        || /^src-tauri\/target\//.test(p) || /\.bak-upscale\//.test(p)));
    ok('.gitignore 的 `!` 例外压得住内置清单（tools/research/keep.tmp 照常同步）',
      names.includes('tools/research/keep.tmp'));
    ok('父目录被排除时 `!` 救不回来（out/keep.me 仍不进清单，与 git 语义一致）',
      !names.includes('out/keep.me'));
    ok('被 .gitignore 挡住的路径，对端直接读不到（/api/file 拒绝）',
      (await get('127.0.0.1', PORT, '/api/file?path=' + encodeURIComponent('out/junk.bin'), { 'x-ssdz-token': TOKEN })).status !== 200);

    // ---- 路径穿越与忽略路径一律拒绝 ----
    const bad = ['../A/js/a.js', '..%2f..%2fetc%2fpasswd', '/etc/passwd', 'save/progress.json', 'scripts/sync/sync.config.json'];
    let allBad = true;
    for (const p of bad) {
      const r = await get('127.0.0.1', PORT, '/api/file?path=' + encodeURIComponent(p), { 'x-ssdz-token': TOKEN });
      if (r.status === 200) allBad = false;
    }
    ok('路径穿越 / 忽略路径读不到', allBad);

    // ---- /local 只认本机 Origin ----
    ok('/local/status 无 Origin 可读', (await get('127.0.0.1', PORT, '/local/status')).status === 200);
    ok('/local/status 带外部 Origin → 403', (await get('127.0.0.1', PORT, '/local/status', { Origin: 'https://evil.example' })).status === 403);
    ok('/local/status 带本机 Origin → 200', (await get('127.0.0.1', PORT, '/local/status', { Origin: 'http://127.0.0.1:8080' })).status === 200);

    // ---- 文件同步：push 把本机较新的文件送过去 ----
    write(path.join(A, 'js/a.js'), 'console.log(2222)\n');
    let out = run(A, ['push', '127.0.0.1', '--files']);
    ok('push 报告送了 1 个文件', /推送 1\/1 个文件/.test(out));
    ok('对端拿到新内容', fs.readFileSync(path.join(B, 'js/a.js'), 'utf8') === 'console.log(2222)\n');
    ok('修改时间被对齐（下次不会再传）', Math.floor(fs.statSync(path.join(A, 'js/a.js')).mtimeMs / 1000) === Math.floor(fs.statSync(path.join(B, 'js/a.js')).mtimeMs / 1000));
    out = run(A, ['push', '127.0.0.1', '--files']);
    ok('再 push 没有改动', /没有需要推送的改动/.test(out));

    // ---- 文件同步：pull 把对端较新的文件取回来 ----
    write(path.join(B, 'css/b.css'), 'body{color:red}\n');
    out = run(A, ['pull', '127.0.0.1', '--files']);
    ok('pull 报告取了 1 个文件', /拉取 1\/1 个文件/.test(out));
    ok('本机拿到对端内容', fs.readFileSync(path.join(A, 'css/b.css'), 'utf8') === 'body{color:red}\n');

    // ---- --verify：同大小同时间、内容不同也要认出来 ----
    const mt = fs.statSync(path.join(B, 'js/a.js')).mtime;
    write(path.join(A, 'js/a.js'), 'console.log(3333)\n');
    fs.utimesSync(path.join(A, 'js/a.js'), mt, mt);
    ok('普通比对看不出（大小时间都一样）', /没有需要推送的改动/.test(run(A, ['push', '127.0.0.1', '--files'])));
    ok('--verify 认得出来', /推送 1\/1 个文件/.test(run(A, ['push', '127.0.0.1', '--files', '--verify'])));
    ok('--verify 之后对端是 3333', fs.readFileSync(path.join(B, 'js/a.js'), 'utf8') === 'console.log(3333)\n');

    // ---- --dry 不动手，而且本机新加的文件也在计划里 ----
    write(path.join(A, 'js/dry.js'), 'console.log("dry")\n');
    const dryOut = run(A, ['push', '127.0.0.1', '--files', '--dry']);
    ok('--dry 只列计划', /\[dry\]/.test(dryOut));
    ok('--dry 计划里有本机新加的文件', /\[dry\] → js\/dry\.js/.test(dryOut));
    ok('--dry 真的没写过去', !fs.existsSync(path.join(B, 'js/dry.js')));
    ok('push 会把本机新加的文件送过去', /推送 1\/1 个文件/.test(run(A, ['push', '127.0.0.1', '--files'])));
    ok('对端真的有了新文件', fs.existsSync(path.join(B, 'js/dry.js')));

    // ---- pull 会把对端新加的文件取回来 ----
    write(path.join(B, 'js/fromB.js'), 'console.log("fromB")\n');
    ok('pull 取回对端新加的文件', /拉取 1\/1 个文件/.test(run(A, ['pull', '127.0.0.1', '--files'])));
    ok('本机真的有了对端新文件', fs.existsSync(path.join(A, 'js/fromB.js')));

    // ---- 存档：方向由用户点出来（push/pull），不再用「时间更新」拦；覆盖前一定备份 ----
    // 这游戏自动保存极频繁，谁刚打开过谁的时间就最新，用 savedAt 判断谁新毫无意义，
    // 所以改成一律照做 + 被覆盖的那侧进度更靠前时提醒一句。
    const T_ALICE = 1700000000000, T_BOB = 1800000000000;
    const putSave = (dir, obj) => {
      const f = path.join(dir, 'save/progress.json');
      write(f, JSON.stringify(obj));
      fs.utimesSync(f, obj.savedAt / 1000, obj.savedAt / 1000);
    };
    putSave(A, { name: 'Alice', level: 10, savedAt: T_ALICE, weapons: [], skills: [], props: {} });
    putSave(B, { name: 'Bob', level: 42, savedAt: T_BOB, weapons: [], skills: [], props: {} });

    /* ---- 二级确认的预览：/local/{save,files}/preview 只读比对，不写任何东西 ----
     * 游戏页面点「送/取存档」「推/拉文件」时先调这两个接口，把这一趟「会改什么」摆出来。
     * A 再起一个服务实例（换个监听端口）代表「游戏页面所在那台」的服务；配置里的端口仍是
     * 两端共用的 PORT，所以预览的目标就是 B。 */
    {
      const PORT_A = await freePort(PORT);
      const aSrv = spawn(process.execPath, [path.join(A, 'scripts', 'sync', 'sync.js'), 'serve', '--port', String(PORT_A)], { cwd: A, stdio: 'ignore' });
      try {
        let upA = false;
        for (let i = 0; i < 40 && !upA; i++) { await sleep(200); upA = await ping(PORT_A); }
        ok('A 的同步服务能起来（预览用）', upA);
        write(path.join(A, 'js/preview-new.js'), 'console.log("preview")\n');
        const pv = JSON.parse((await get('127.0.0.1', PORT_A, '/local/files/preview?peer=127.0.0.1')).body);
        const sv = JSON.parse((await get('127.0.0.1', PORT_A, '/local/save/preview?peer=127.0.0.1')).body);
        const pn = fs.statSync(path.join(A, 'js/preview-new.js')).size;
        ok('二级确认预览：报出会改的文件/字节数与两边等级经验，且只读不写',
          pv.ok === true && pv.push.count === 1 && pv.pull.count === 0 && pv.push.bytes === pn
          && pv.push.files.some((f) => f.p === 'js/preview-new.js' && f.s === pn)
          && !fs.existsSync(path.join(B, 'js/preview-new.js'))
          && sv.ok === true && sv.localExists === true && sv.remoteExists === true
          && sv.local.name === 'Alice' && sv.local.level === 10 && sv.remote.name === 'Bob' && sv.remote.level === 42
          && sv.ahead === 'b' && sv.localSavedAt === T_ALICE && sv.remoteSavedAt === T_BOB);
      } finally {
        aSrv.kill('SIGTERM');
        await sleep(300);
      }
    }

    out = run(A, ['push', '127.0.0.1', '--save']);
    ok('对面进度更靠前时照样推（不再被时间判断挡下）', /已把存档送到/.test(out));
    ok('并且提醒了对面的进度更靠前', /更靠前/.test(out));
    ok('对端真的被覆盖成 Alice', JSON.parse(fs.readFileSync(path.join(B, 'save/progress.json'), 'utf8')).name === 'Alice');
    ok('覆盖前自动备份', fs.readdirSync(path.join(B, 'save/backup')).some((f) => /^progress-.*\.json$/.test(f)));
    ok('对端文件时间被对齐成存档时间', Math.abs(fs.statSync(path.join(B, 'save/progress.json')).mtimeMs - T_ALICE) < 1000);
    out = run(A, ['push', '127.0.0.1', '--save']);
    // 内容一样时不再重复推同一份（对端每次被覆盖都会留一份备份，白推只会堆垃圾）
    ok('推过一次之后不会重复推同一份存档', /已经一致/.test(out) && !/已把存档送到/.test(out));
    // 但本机内容真的变了，就必须能再推
    putSave(A, { name: 'Alice2', level: 11, savedAt: T_ALICE + 5000, weapons: [], skills: [], props: {} });
    out = run(A, ['push', '127.0.0.1', '--save']);
    ok('本机存档内容变了之后还能再推', /已把存档送到/.test(out));
    out = run(A, ['pull', '127.0.0.1', '--save']);
    ok('pull 能把存档取回来', JSON.parse(fs.readFileSync(path.join(A, 'save/progress.json'), 'utf8')).name === 'Alice2');
    ok('本机旧档也备份了', fs.readdirSync(path.join(A, 'save/backup')).length >= 1);
    // 用户实际遇到的那个场景：本机时间更新（刚开过游戏=自动保存），但进度其实更靠前，
    // 这时候「取回对面存档」必须照样执行，并且提醒一句。
    putSave(A, { name: 'AliceHigh', level: 50, savedAt: T_BOB + 600000, weapons: [], skills: [], props: {} });
    putSave(B, { name: 'BobLow', level: 10, savedAt: T_BOB, weapons: [], skills: [], props: {} });
    out = run(A, ['pull', '127.0.0.1', '--save']);
    ok('本机时间更新但进度更靠前时，pull 照样执行', /已从/.test(out));
    ok('并且提醒本机进度更靠前', /本机的进度更靠前/.test(out));
    ok('本机确实被对面的覆盖了', JSON.parse(fs.readFileSync(path.join(A, 'save/progress.json'), 'utf8')).name === 'BobLow');

    // ---- 对端服务停掉后，给的是人话而不是崩溃 ----
    server.kill('SIGTERM');
    server = null;
    await sleep(500);
    out = run(A, ['push', '127.0.0.1', '--files'], true);
    ok('对端服务连不上时提示清楚', /连不上/.test(out) && /同步服务/.test(out));

    // ---- 一键拉取远端更新：解压远端便携包 → 算计划 → 覆盖（存档与机器配置必须原样保留） ----
    {
      const upd = require(path.join(ROOT, 'scripts', 'update-game.js'));
      ok('更新永远不覆盖存档 / 同步口令 / 取证与构建产物', upd.ignored('save/progress.json')
        && upd.ignored('scripts/sync/sync.config.json') && upd.ignored('node_modules/pkg/index.js')
        && upd.ignored('references/x.bin') && upd.ignored('src-tauri/target/x') && upd.ignored('.git/config')
        && !upd.ignored('js/a.js') && !upd.ignored('scripts/index.html'));

      const vroot = path.join(TMP, 'vroot');
      write(path.join(vroot, 'scripts/version.json'), JSON.stringify({ version: '9.9.9', commit: 'abc1234', date: '2026-01-01' }));
      ok('本机版本取自 scripts/version.json', upd.readVersion(vroot).version === '9.9.9');

      /* 造一个「远端便携包」：新版 js/a.js + 新文件 js/new.js + 故意改过的存档与同步口令
       *（这两个必须被忽略，否则一键更新会毁掉玩家的档和两台机器的配对）。 */
      const pkg = path.join(TMP, 'pkg');
      write(path.join(pkg, 'scripts/index.html'), '<!DOCTYPE html>\n');
      write(path.join(pkg, 'js/a.js'), 'console.log("new")\n');
      write(path.join(pkg, 'js/new.js'), 'console.log("brand new")\n');
      write(path.join(pkg, 'css/b.css'), 'body{color:red}\n');
      write(path.join(pkg, 'scripts/version.json'), JSON.stringify({ version: '9.9.10' }));
      write(path.join(pkg, 'save/progress.json'), '{"name":"远端"}\n');
      write(path.join(pkg, 'scripts/sync/sync.config.json'), '{"token":"远端口令"}\n');
      write(path.join(pkg, 'node_modules/pkg/index.js'), 'module.exports=1\n');
      const zip = path.join(TMP, 'pkg.zip');
      const entries = makeZip(zip, pkg);
      ok('造出便携包 zip', entries >= 6 && fs.statSync(zip).size > 0);

      const dest = path.join(TMP, 'unzip');
      const ex = upd.extract(zip, dest);
      ok('系统自带工具能解开便携包（tar / unzip / python）', ex.ok && !!ex.by);
      const src = upd.findPackageRoot(dest);
      ok('能认出包里的游戏目录', src === dest || (src && fs.existsSync(path.join(src, 'js'))));

      const target = path.join(TMP, 'target');
      write(path.join(target, 'scripts/index.html'), '<!DOCTYPE html>\n');
      write(path.join(target, 'js/a.js'), 'console.log("old")\n');
      write(path.join(target, 'save/progress.json'), '{"name":"本机","level":42}\n');
      write(path.join(target, 'scripts/sync/sync.config.json'), '{"token":"本机口令"}\n');
      const plan = upd.planTree(src).map((f) => f.p);
      ok('计划 = 要覆盖的游戏文件，且排掉存档 / 口令 / node_modules',
        plan.includes('js/a.js') && plan.includes('js/new.js') && plan.includes('css/b.css')
        && !plan.some((x) => x.startsWith('save/') || x === 'scripts/sync/sync.config.json' || x.startsWith('node_modules')));

      const dry = upd.applyFiles(target, src, upd.planTree(src), true);
      ok('dry：只报数不写盘', dry.files === plan.length && fs.readFileSync(path.join(target, 'js/a.js'), 'utf8').includes('old'));

      const backup = upd.backupSave(target);
      const real = upd.applyFiles(target, src, upd.planTree(src), false);
      ok('真更新：游戏文件被覆盖', real.files === plan.length
        && fs.readFileSync(path.join(target, 'js/a.js'), 'utf8').includes('new')
        && fs.existsSync(path.join(target, 'js/new.js')));
      ok('存档与同步口令原样保留', fs.readFileSync(path.join(target, 'save/progress.json'), 'utf8').includes('本机')
        && fs.readFileSync(path.join(target, 'scripts/sync/sync.config.json'), 'utf8').includes('本机口令'));
      ok('更新前自动备份了一份存档', !!backup && fs.existsSync(path.join(target, backup)));

      /* 接线：三种来源的入口都在（服务器两条 + 界面三按钮 + 同步服务的 dry 预览） */
      const serveSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'serve.js'), 'utf8');
      const rustSrc = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8');
      const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'classic-ui.js'), 'utf8');
      const syncSrc = fs.readFileSync(SYNC_SRC, 'utf8');
      ok('便携版 / 源码版有 /__update 路由', /rel === '\/__update'/.test(serveSrc) && /update-game\.js/.test(serveSrc));
      ok('轻壳 exe 有 /__update 路由（缺 Node 时给提示）', /"\/__update"/.test(rustSrc) && /NO_NODE/.test(rustSrc));
      ok('系统页有「游戏更新」面板与三个来源 + 下载页兜底',
        /updatePanelHtml/.test(uiSrc) && /update-source-sync/.test(uiSrc) && /update-source-release/.test(uiSrc)
        && /update-source-git/.test(uiSrc) && /update-page/.test(uiSrc));
      ok('同步服务的拉取接口支持 dry 预览', /dry: url\.searchParams\.get\('dry'\) === '1'/.test(syncSrc));
      /* 长驻服务不能复用全局 keep-alive socket：ZeroTier 换地址 / 对端休眠后，
       * 池里的死连接会让游戏内「推文件」的预览直接 EHOSTUNREACH，而 CLI 每次新进程正常。 */
      ok('长驻同步服务不复用 keep-alive socket', /agent:\s*false/.test(syncSrc));
      /* 旧客户端（没重编的 exe / 旧服务器进程）没有同源 /__update —— 界面必须回退到
       * 本机同步服务新增的更新通道，否则用户就只能看到「本机不支持」。 */
      ok('旧客户端也能更新：同步服务带 /local/update 通道，界面会回退过去',
        /'\/local\/update\/check'/.test(syncSrc) && /'\/local\/update\/run'/.test(syncSrc)
        && /runUpdateHelper/.test(syncSrc) && /\/local\/update\/check/.test(uiSrc) && /channel === 'sync'/.test(uiSrc)
        && /syncPanel\(\)\+updatePanelHtml\(\)/.test(uiSrc));

      /* 2026-10 用户报「一键同步 / 重启同步服务 点了没反应，终端还有乱码」：
       * ① 乱码 = 控制台代码页还是 936，node 的 UTF-8 中文被当 ANSI 解 → 两个 .cmd 入口先 `chcp 65001`；
       * ② 没反应 = 老配置里存的 8788 落在 Windows 保留段 8719-8818（Hyper-V 预留）→ 绑不上，
       *    服务永远起不来 → sync.js 起服务前先 `ensureBindablePort()` 自愈换端口，
       *    界面那边也不能再写死端口（`SYNC_PORTS` 以前只被取 `[0]`，等于只认 18788）。 */
      const cmdLaunchers = ['一键同步.cmd', '重启同步服务.cmd']
        .map((f) => fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8').replace(/\r\n/g, '\n'));
      ok('两个同步入口：控制台先切 UTF-8，服务起不来时按 Windows 保留段自愈端口，界面跟着探测',
        cmdLaunchers.every((s) => /^chcp 65001 >nul/m.test(s))
        && /async function ensureBindablePort/.test(syncSrc) && /await ensureBindablePort\(/.test(syncSrc)
        && /function windowsPortExcluded/.test(syncSrc) && /function ensureUtf8Console/.test(syncSrc)
        && /await syncProbeAny\(\)/.test(uiSrc) && /for \(const p of SYNC_PORTS\)/.test(uiSrc));
    }

    console.log('\n双机同步回归通过：' + passed + ' 项');
  } finally {
    if (server) server.kill('SIGTERM');
    await sleep(200);
    try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }); } catch (e) {}
  }
})().catch((e) => {
  console.error('\n[x] ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
