#!/usr/bin/env node
/* ============================================================
 * tools/serve.js — 本地静态服务器（零依赖）
 *
 * 用法: node tools/serve.js [端口]
 * 然后浏览器打开 http://127.0.0.1:8080
 *
 * 说明：直接双击 index.html（file://）也能玩，但部分浏览器会
 * 拦截本地文件读取，用这个服务器最稳。
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || 8080);

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
  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]); }
  catch (_) { res.writeHead(400); res.end('400'); return; }
  if (rel === '/' || rel === '') rel = '/index.html';
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
  console.log('松鼠大战 · 怀旧复刻版');
  console.log('目录: ' + ROOT);
  console.log('地址: http://127.0.0.1:' + PORT + '/');
  console.log('自检: http://127.0.0.1:' + PORT + '/index.html?test=1');
  console.log('战斗观察: http://127.0.0.1:' + PORT + '/index.html?test=2');
});
