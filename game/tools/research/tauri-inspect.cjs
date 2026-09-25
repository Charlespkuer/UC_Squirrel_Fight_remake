/* 连到**已经跑起来的** Tauri 桌面版（WebView2）里执行一段 JS，用来核对
 * 「app 里嵌的前端到底是哪一版」——比如调试面板是不是新的两列布局、系统页能不能滚动。
 *
 * 用法：
 *   1) 带调试端口启动桌面版（PowerShell）：
 *        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
 *        src-tauri\target\release\ssdz-classic.exe
 *   2) 另开一个终端：
 *        node tools/research/tauri-inspect.cjs 9222 "document.title"
 *
 * 说明：Tauri 发布版把前端资源压在二进制里（brotli），没法用字符串搜索核对，
 * 所以只能像这样在真实窗口里问它一句。这个脚本只连接、不启动任何程序。
 */
const http = require('node:http');

const PORT = process.argv[2] || '9222';
const EXPRESSION = process.argv[3] || 'document.title';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = Buffer.from(String(Math.random())).toString('base64').slice(0, 22) + '==';
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
    });
    req.on('upgrade', (res, socket) => {
      const handlers = { text: [] };
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 0x8) return;
          if (op !== 0x1) continue;
          handlers.text.forEach((f) => f(payload.toString('utf8')));
        }
      });
      const send = (text) => {
        const data = Buffer.from(text, 'utf8');
        const mask = Buffer.from([1, 2, 3, 4]);
        let head;
        if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
        else { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
        const masked = Buffer.alloc(data.length);
        for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i & 3];
        socket.write(Buffer.concat([head, mask, masked]));
      };
      resolve({ send, onText: (f) => handlers.text.push(f), close: () => socket.destroy() });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const list = await get('http://127.0.0.1:' + PORT + '/json/list');
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* 还没起来 */ }
    if (!target) await sleep(250);
  }
  if (!target) {
    console.error('连不上调试端口 ' + PORT + '：确认桌面版是用 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=' + PORT + ' 启动的');
    process.exit(1);
  }
  const ws = await wsConnect(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onText((t) => {
    const m = JSON.parse(t);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const cmd = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  await cmd('Runtime.enable');
  const r = await cmd('Runtime.evaluate', { expression: EXPRESSION, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    console.error('页面里抛错了：' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    process.exitCode = 1;
  } else {
    const v = r.result && r.result.result ? r.result.result.value : undefined;
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  }
  ws.close();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
