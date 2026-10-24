'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

// A real, uncompressed ZIP containing one fixture file; no external zip utility.
function ipaFixture() {
  const name = Buffer.from('Payload/Fixture.app/Info.plist');
  const data = Buffer.from('<plist/>');
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function runClient(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'tools/build-ios-remote.cjs'), '--variant', 'modern'],
      { cwd: os.tmpdir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const timer = setTimeout(() => child.kill(), 30000);
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
  });
}

test('Mac 本轮构建成功且 IPA 完整回传后，才替换 Windows 已有包', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssdz-ios-remote-test-'));
  const token = 'fixture-private-sync-token';
  const goodIpa = ipaFixture();
  const badIpa = Buffer.alloc(goodIpa.length, 0x78);
  const artifactName = 'squirrel_fight_1.2.3_ios_unsigned.ipa';
  const oldIpa = Buffer.from('keep the existing IPA until its replacement is complete');
  const jobs = new Map();
  const serverErrors = [];
  const write = (rel, data) => {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  };
  for (const dir of ['css', 'js', 'images', 'audio', 'src-tauri/src', 'src-tauri/icons'])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const rel of ['scripts/index.html', 'tools/build-ios.cjs', 'tools/build-tauri-app.cjs',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/build.rs',
    'src-tauri/Info.ios.plist', 'src-tauri/app-icon.png']) write(rel, 'fixture');
  for (const rel of ['scripts/version.json', 'src-tauri/package.json', 'src-tauri/package-lock.json',
    'src-tauri/tauri.conf.json', 'src-tauri/tauri.ios.conf.json']) write(rel, JSON.stringify({ version: '1.2.3' }));
  write('css/fixture.css', 'body { color: black; }');
  write('save/private.json', token);
  write('images/private.key', token);
  write('tools/build-ios-remote.cjs', fs.readFileSync(path.join(__dirname, 'build-ios-remote.cjs')));
  write('src-tauri/dist/' + artifactName, oldIpa);
  const json = (res, value, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers['x-ssdz-token'], token);
      const url = new URL(req.url, 'http://127.0.0.1');
      const route = url.pathname.replace('/api/ios-build/', '');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (route === 'check') return json(res, { ok: true, api: 1, platform: 'darwin', ready: true });
      if (route === 'prepare') {
        const snapshot = JSON.parse(body);
        const id = String(jobs.size + 1);
        jobs.set(id, { snapshot, uploads: new Set(), started: false });
        return json(res, { ok: true, id, missing: snapshot.files.map(file => file.path) });
      }
      const id = url.searchParams.get('id');
      const job = jobs.get(id);
      assert.ok(job, 'requests must refer to the current build job');
      if (route === 'file') {
        const rel = url.searchParams.get('path');
        const entry = job.snapshot.files.find(file => file.path === rel);
        assert.ok(entry);
        assert.equal(body.length, entry.size);
        job.uploads.add(rel);
        return json(res, { ok: true });
      }
      if (route === 'start') {
        assert.equal(job.uploads.size, job.snapshot.files.length);
        job.started = true;
        return json(res, { ok: true });
      }
      assert.equal(job.started, true);
      if (route === 'job') return json(res, { ok: true, state: 'succeeded', offset: 0,
        artifacts: [{ name: artifactName, size: goodIpa.length }] });
      if (route === 'artifact') {
        assert.equal(url.searchParams.get('name'), artifactName);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': goodIpa.length });
        return res.end(id === '1' ? badIpa : goodIpa);
      }
      json(res, { ok: false, error: 'Unexpected fixture route' }, 404);
    } catch (err) {
      serverErrors.push(err);
      if (!res.headersSent) json(res, { ok: false, error: err.message }, 500);
      else res.destroy();
    }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    write('scripts/sync/sync.config.json', JSON.stringify({ token, port: server.address().port, peers: { mac: '127.0.0.1' } }));
    const failed = await runClient(root);
    assert.notEqual(failed.code, 0, failed.output);
    assert.match(failed.output, /not an IPA ZIP archive/, failed.output);
    assert.deepEqual(fs.readFileSync(path.join(root, 'src-tauri/dist', artifactName)), oldIpa);
    const succeeded = await runClient(root);
    assert.equal(succeeded.code, 0, succeeded.output);
    assert.deepEqual(fs.readFileSync(path.join(root, 'src-tauri/dist', artifactName)), goodIpa);
    assert.deepEqual(serverErrors, []);
    assert.equal(jobs.size, 2);
    for (const { snapshot } of jobs.values()) {
      assert.equal(snapshot.version, '1.2.3');
      assert.ok(snapshot.files.every(file => !/^(?:save|scripts\/sync)\//.test(file.path) && !file.path.endsWith('.key')),
        'source snapshots must not include saved games, sync credentials or private keys');
    }
    assert.deepEqual(fs.readdirSync(path.join(root, 'src-tauri/dist')), [artifactName]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
