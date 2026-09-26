#!/usr/bin/env node
/* ============================================================
 * tools/serve.js — 本地静态服务器（零依赖）
 *
 * 用法: node tools/serve.js [端口] [--no-save]
 * 然后浏览器打开 http://127.0.0.1:8080
 *
 * 说明：直接双击 index.html（file://）也能玩，但部分浏览器会
 * 拦截本地文件读取，用这个服务器最稳。
 *
 * 存档文件（可选）：游戏会把存档同时写一份到 <游戏目录>/save/progress.json，
 * 既可当本地备份，也是接「自建同步服务」的接口层。
 * 接口只监听 127.0.0.1，加 --no-save 可整体关闭。
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');   // serve.js 在 scripts/ 里，游戏根是上一层
const ARGS = process.argv.slice(2);
const PORT = Number(ARGS.find((a) => /^[0-9]+$/.test(a)) || 8080);   // 端口可以写在任意位置：node tools/serve.js --no-save 8080

/* ---------- /__save：存档文件读写（本地备份 / 自建同步服务的接口层） ---------- */
const NO_SAVE = process.argv.includes('--no-save');
const SAVE_DIR = path.join(ROOT, 'save');
/* 首页 index.html 住在 scripts/ 里。浏览器地址仍然是 http://host:port/ （或 /index.html），
 * 页面里的 css/js/images/audio 都是相对 URL 根解析的，所以 html 里一个引用都不用改。 */
const ENTRY_REL = ['scripts/index.html', 'index.html'].find((f) => fs.existsSync(path.join(ROOT, f))) || 'index.html';
const SAVE_FILE = path.join(SAVE_DIR, 'progress.json');
const SAVE_MAX = 4 * 1024 * 1024;      // 存档上限 4 MB

function saveStat() {
  try { const st = fs.statSync(SAVE_FILE); return { exists: true, savedAt: Math.round(st.mtimeMs), size: st.size }; }
  catch (e) { return { exists: false, savedAt: 0, size: 0 }; }
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function handleSaveApi(req, res, url) {
  if (NO_SAVE) return json(res, 503, { ok: false, msg: '服务器以 --no-save 启动，存档文件同步已关闭' });
  if (req.method === 'GET') {
    const st = saveStat();
    if (url.searchParams.get('meta')) return json(res, 200, { ok: true, exists: st.exists, savedAt: st.savedAt, size: st.size });
    if (!st.exists) return json(res, 200, { ok: true, exists: false, savedAt: 0, data: null });
    try { return json(res, 200, { ok: true, exists: true, savedAt: st.savedAt, data: fs.readFileSync(SAVE_FILE, 'utf8') }); }
    catch (e) { return json(res, 500, { ok: false, msg: '读取存档失败：' + e.message }); }
  }
  if (req.method === 'POST') {
    let body;
    try { body = await readBody(req, SAVE_MAX); }
    catch (e) { return json(res, 413, { ok: false, msg: '存档太大或读取中断' }); }
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) { return json(res, 400, { ok: false, msg: '不是合法 JSON' }); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(res, 400, { ok: false, msg: '存档必须是对象' });
    try {
      fs.mkdirSync(SAVE_DIR, { recursive: true });
      fs.writeFileSync(SAVE_FILE, JSON.stringify(parsed), 'utf8');
      return json(res, 200, { ok: true, savedAt: saveStat().savedAt });
    } catch (e) { return json(res, 500, { ok: false, msg: '写入存档失败：' + e.message }); }
  }
  return json(res, 405, { ok: false, msg: '只支持 GET / POST' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let rel, url;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
    rel = decodeURIComponent(url.pathname);
  } catch (_) { res.writeHead(400); res.end('400'); return; }
  if (rel === '/__save') { handleSaveApi(req, res, url).catch(() => json(res, 500, { ok: false, msg: '服务器内部错误' })); return; }
  if (rel === '/' || rel === '' || rel === '/index.html') rel = '/' + ENTRY_REL;
  const file = path.join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('403'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('404 ' + rel); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  const st = saveStat();
  console.log('松鼠大战 · 怀旧复刻版');
  console.log('目录: ' + ROOT);
  console.log('地址: http://127.0.0.1:' + PORT + '/');
  console.log('自检: http://127.0.0.1:' + PORT + '/index.html?test=1');
  console.log('战斗观察: http://127.0.0.1:' + PORT + '/index.html?test=2');
  console.log(NO_SAVE
    ? '存档文件: 已关闭（--no-save）'
    : '存档文件: save/progress.json' + (st.exists ? '（已有存档 ' + new Date(st.savedAt).toLocaleString() + '）' : '（还没有，游戏保存后自动出现）'));
});
