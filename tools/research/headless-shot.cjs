/* 开发检查工具：无头 Chrome 截图 + 取回页面内 window.__report。
 * 仅用于本地验证，不参与游戏运行。
 *
 * node tools/research/headless-shot.cjs "<url>" <out.png> [--eval "<js>"] [--wait <selector>] [--w 1170] [--h 690]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const { requireChrome } = require('./find-chrome.cjs');
const CHROME = requireChrome();
const PORT = 9333;

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b.slice(0, 200))); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简 WebSocket 客户端（仅客户端帧，够 CDP 用） */
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = Buffer.from(String(Math.random())).toString('base64').slice(0, 22) + '==';
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
    });
    req.on('upgrade', (res, socket) => {
      const handlers = { text: [], close: [] };
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          if (buf.length < 2) return;
          const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 0x8) { handlers.close.forEach((f) => f()); return; }
          if (op !== 0x1) continue;   // 忽略 ping/pong/二进制
          const text = payload.toString('utf8');
          handlers.text.forEach((f) => f(text));
        }
      });
      const send = (text) => {
        const data = Buffer.from(text, 'utf8');
        const mask = Buffer.from([1, 2, 3, 4]);
        let head;
        if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
        else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
        else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
        const masked = Buffer.alloc(data.length);
        for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i & 3];
        socket.write(Buffer.concat([head, mask, masked]));
      };
      resolve({
        send,
        onText: (f) => handlers.text.push(f),
        onClose: (f) => handlers.close.push(f),
        close: () => socket.destroy(),
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const args = process.argv.slice(2);
  const url = args[0];
  const out = path.resolve(args[1] || 'shot.png');
  const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
  const evalJs = opt('eval', null);
  const preJs = opt('pre', null);   // 截图前执行（用于跳转到目标界面）
  const waitSel = opt('wait', null);
  const W = Number(opt('w', 1170)), H = Number(opt('h', 690));
  // 默认 --hide-scrollbars（macOS 的覆盖式滚动条行为）；加 --scrollbars 就按 Windows
  // 那样显示占位滚动条，用来复现「同一个界面在 mac 正常、在 win 换行/被裁」的问题。
  const showScrollbars = args.includes('--scrollbars');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chrome-'));

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    ...(showScrollbars ? [] : ['--hide-scrollbars']), '--force-device-scale-factor=1',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + PORT,
    '--window-size=' + W + ',' + H, 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try { const list = await get('http://127.0.0.1:' + PORT + '/json/list'); target = list.find((t) => t.type === 'page'); } catch (e) {}
  }
  if (!target) { console.error('chrome debug endpoint 未就绪'); chrome.kill(); process.exit(1); }

  const ws = await wsConnect(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.onText((text) => {
    const msg = JSON.parse(text);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push('EXCEPTION ' + (d.exception && d.exception.description || d.text) + ' @' + (d.url || '') + ':' + d.lineNumber);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(msg.params.type + ' ' + msg.params.args.map((a) => a.value != null ? a.value : (a.description || a.type)).join(' '));
    } else if (msg.method === 'Log.entryAdded') {
      logs.push('LOG[' + msg.params.entry.level + '] ' + msg.params.entry.text);
    }
  });
  const cmd = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evaluate = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await cmd('Page.enable');
  await cmd('Runtime.enable');
  await cmd('Log.enable');
  await cmd('Page.navigate', { url });
  const deadline = Date.now() + 40000;
  let ready = false;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      if (waitSel) {
        if (await evaluate('!!document.querySelector(' + JSON.stringify(waitSel) + ')')) { ready = true; break; }
      } else if (await evaluate('!!(window.__report || window.__home)')) { ready = true; break; }
    } catch (e) {}
  }
  await sleep(700);

  if (preJs) {
    try { console.log('pre -> ' + JSON.stringify(await evaluate(preJs))); }
    catch (e) { console.error('pre 失败: ' + e.message); }
    await sleep(600);
  }
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (shot.result && shot.result.data) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('shot -> ' + out + (ready ? '' : '  (等待条件未满足，仍已截图)'));
  } else console.error('captureScreenshot 失败: ' + JSON.stringify(shot).slice(0, 300));

  if (evalJs) {
    try { console.log('eval -> ' + JSON.stringify(await evaluate(evalJs), null, 1)); }
    catch (e) { console.error('eval 失败: ' + e.message); }
  }
  // --then <url>：在同一会话里再打开一个页面，用于验证跨刷新的持久化
  const thenUrl = opt('then', null);
  if (thenUrl) {
    await cmd('Page.navigate', { url: thenUrl });
    let ok2 = false;
    for (let i = 0; i < 60 && !ok2; i++) {
      await sleep(400);
      try { ok2 = await evaluate('!!(window.__report || window.__home)'); } catch (e) {}
    }
    await sleep(700);
    const shot2 = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (shot2.result && shot2.result.data) {
      const out2 = out.replace(/\.png$/i, '-after.png');
      fs.writeFileSync(out2, Buffer.from(shot2.result.data, 'base64'));
      console.log('shot(after reload) -> ' + out2);
    }
    const report2 = await evaluate('(window.__report || window.__home) ? JSON.stringify(window.__report || window.__home) : null');
    if (report2) console.log('report(after reload) -> ' + report2);
    if (evalJs) {
      try { console.log('eval(after reload) -> ' + JSON.stringify(await evaluate(evalJs), null, 1)); }
      catch (e) { console.error('eval(after reload) 失败: ' + e.message); }
    }
  }
  const report = await evaluate('(window.__report || window.__home) ? JSON.stringify(window.__report || window.__home) : null');
  if (report) console.log('report -> ' + report);
  const pageErrs = await evaluate('(window.__errs||[]).join(" ;; ")');
  if (pageErrs) console.log('page errors -> ' + pageErrs);
  if (logs.length) console.log('logs ->\n  ' + logs.join('\n  '));

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
