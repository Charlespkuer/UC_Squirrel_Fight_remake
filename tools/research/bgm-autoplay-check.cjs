/* 用「允许自动播放」的 Chrome 打开 bgm-check.html，确认代码在浏览器放行时确实会开屏播放。
 * 仅用于本地验证：node tools/research/bgm-autoplay-check.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const PORT = 9346;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = Buffer.from(String(Math.random())).toString('base64').slice(0, 22) + '==';
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chrome-'));
  const extra = process.argv.slice(2);
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + PORT, '--window-size=1170,690', 'about:blank',
    ...extra], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { const l = await get('http://127.0.0.1:' + PORT + '/json/list'); target = l.find((t) => t.type === 'page'); } catch (e) {} }
  if (!target) { console.error('chrome 未就绪'); chrome.kill(); process.exit(1); }
  const ws = await wsConnect(target.webSocketDebuggerUrl);
  let seq = 0; const pend = new Map();
  ws.onText((t) => { const m = JSON.parse(t); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const cmd = (method, params) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const ev = async (e) => { const r = await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
  await cmd('Page.enable'); await cmd('Runtime.enable');
  await cmd('Page.navigate', { url: 'http://127.0.0.1:8080/tools/research/bgm-check.html' });
  for (let i = 0; i < 90; i++) { await sleep(300); try { if (await ev('document.title === "READY"')) break; } catch (e) {} }
  console.log('autoplay allowed ->', await ev('JSON.stringify(window.__report.check)'));
  console.log('hint shown ->', await ev('JSON.stringify({blocked:document.body.classList.contains("audio-blocked"),hint:!!document.getElementById("audio-hint")})'));
  ws.close(); chrome.kill(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
