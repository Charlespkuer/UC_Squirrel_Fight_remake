/* 双机同步（tools/sync/sync.js）回归测试：在两个临时「游戏目录」之间真的传文件与存档。
 * 跑法：node tools/test-sync.cjs
 * 不需要 ZeroTier：两台「机器」都在 127.0.0.1 上，用不同的根目录模拟。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SYNC_SRC = path.join(ROOT, 'tools', 'sync', 'sync.js');
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
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
/** 搭一个最小「游戏目录」：有 index.html、几个源文件、save/、以及各种应该被忽略的杂物。 */
function makeRoot(dir, name, port) {
  write(path.join(dir, 'index.html'), '<!DOCTYPE html>\n');
  write(path.join(dir, 'js/a.js'), 'console.log(1)\n');
  write(path.join(dir, 'css/b.css'), 'body{}\n');
  write(path.join(dir, 'save/progress.json'), JSON.stringify({ name, level: 1, savedAt: 1000, weapons: [], skills: [], props: {} }));
  write(path.join(dir, 'save/server.out.log'), 'log\n');
  write(path.join(dir, 'node_modules/pkg/index.js'), 'module.exports=1\n');
  write(path.join(dir, '.git/config'), '[core]\n');
  write(path.join(dir, '.DS_Store'), 'junk');
  write(path.join(dir, 'tools/sync/sync.js'), fs.readFileSync(SYNC_SRC, 'utf8'));
  write(path.join(dir, 'tools/sync/sync.config.json'), JSON.stringify({ name, port, token: TOKEN, peers: {}, ignore: [] }, null, 2));
}
function run(dir, args, expectFail) {
  const exe = path.join(dir, 'tools', 'sync', 'sync.js');
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

(async () => {
  // 找一个能用的端口（本机同时可能在跑真的同步服务，所以别写死）
  for (let p = 19000; p < 19500 && !PORT; p++) {
    const s = http.createServer();
    const free = await new Promise((res) => { s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => res(true)); });
    s.close();
    if (free) PORT = p;
  }
  assert.ok(PORT, '找不到空闲端口');

  makeRoot(A, 'A-mac', PORT);
  makeRoot(B, 'B-win', PORT);

  console.log('双机同步回归（临时目录 ' + TMP + '，端口 ' + PORT + '）');
  try {
    // ---- 起 B 的接收服务 ----
    server = spawn(process.execPath, [path.join(B, 'tools', 'sync', 'sync.js'), 'serve'], { cwd: B, stdio: 'ignore' });
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
    ok('清单里有正常的源文件', names.includes('index.html') && names.includes('js/a.js') && names.includes('tools/sync/sync.js'));

    // ---- 路径穿越与忽略路径一律拒绝 ----
    const bad = ['../A/js/a.js', '..%2f..%2fetc%2fpasswd', '/etc/passwd', 'save/progress.json', 'tools/sync/sync.config.json'];
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

    // ---- 存档：对方更新时不覆盖，--force 才覆盖，且覆盖前备份 ----
    write(path.join(A, 'save/progress.json'), JSON.stringify({ name: 'Alice', level: 10, savedAt: 1000, weapons: [], skills: [], props: {} }));
    write(path.join(B, 'save/progress.json'), JSON.stringify({ name: 'Bob', level: 42, savedAt: 9000000000000, weapons: [], skills: [], props: {} }));
    fs.utimesSync(path.join(A, 'save/progress.json'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    fs.utimesSync(path.join(B, 'save/progress.json'), new Date(2030, 0, 1), new Date(2030, 0, 1));
    out = run(A, ['push', '127.0.0.1', '--save']);
    ok('对端更新 → push 被挡下', /没有推送/.test(out));
    ok('对端存档没被动过', JSON.parse(fs.readFileSync(path.join(B, 'save/progress.json'), 'utf8')).name === 'Bob');
    out = run(A, ['push', '127.0.0.1', '--save', '--force']);
    ok('--force 才真的覆盖', JSON.parse(fs.readFileSync(path.join(B, 'save/progress.json'), 'utf8')).name === 'Alice');
    ok('覆盖前自动备份', fs.readdirSync(path.join(B, 'save/backup')).some((f) => /^progress-.*\.json$/.test(f)));
    out = run(A, ['pull', '127.0.0.1', '--save']);
    ok('pull 能把存档取回来', JSON.parse(fs.readFileSync(path.join(A, 'save/progress.json'), 'utf8')).level === 10);
    ok('本机旧档也备份了', fs.readdirSync(path.join(A, 'save/backup')).length >= 1);

    // ---- 对端服务停掉后，给的是人话而不是崩溃 ----
    server.kill('SIGTERM');
    server = null;
    await sleep(500);
    out = run(A, ['push', '127.0.0.1', '--files'], true);
    ok('对端服务连不上时提示清楚', /连不上/.test(out) && /同步服务/.test(out));

    console.log('\n双机同步回归通过：' + passed + ' 项');
  } finally {
    if (server) server.kill('SIGTERM');
    await sleep(200);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
})().catch((e) => {
  console.error('\n[x] ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
