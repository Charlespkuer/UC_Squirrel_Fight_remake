/* Build unsigned IPAs on the paired Mac without overwriting its working tree.
 * Uses the authenticated sync service; no SSH, signing keys or dependencies.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const ROOT = path.resolve(__dirname, '..');
const VARIANTS = ['modern', 'legacy'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(args) {
  const opts = { peer: 'mac', variant: 'both', version: null, check: false, dryRun: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') opts.check = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (['--peer', '--variant', '--version'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(arg + ' requires a value');
      opts[arg.slice(2)] = args[++i];
    } else throw new Error('Unknown argument: ' + arg);
  }
  if (!['both', ...VARIANTS].includes(opts.variant)) throw new Error('--variant must be modern, legacy or both');
  return opts;
}

function expectedArtifacts(version, variants) {
  return variants.map(v => 'squirrel_fight_' + version + '_ios' + (v === 'legacy' ? '_legacy' : '') + '_unsigned.ipa');
}

function sourceManifest(root = ROOT) {
  const files = [];
  let excluded = 0;
  const add = (rel, required = true) => {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) {
      if (required) throw new Error('Required iOS source is missing: ' + rel);
      return;
    }
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('Symlinks are not allowed in the iOS snapshot: ' + rel);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        if (name.startsWith('.') || /\.(?:pem|key|p12|p8|mobileprovision)$/i.test(name)) { excluded++; continue; }
        add(rel + '/' + name);
      }
    } else if (stat.isFile()) {
      files.push({ path: rel, size: stat.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
    } else throw new Error('Unsupported source file: ' + rel);
  };
  for (const rel of ['css', 'js', 'images', 'audio', 'scripts/index.html', 'scripts/version.json',
    'tools/build-ios.cjs', 'tools/build-tauri-app.cjs', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
    'src-tauri/build.rs', 'src-tauri/src', 'src-tauri/Info.ios.plist', 'src-tauri/app-icon.png',
    'src-tauri/icons', 'src-tauri/package.json', 'src-tauri/package-lock.json']) add(rel);
  for (const rel of ['src-tauri/capabilities', 'src-tauri/empty']) add(rel, false);
  const configs = fs.readdirSync(path.join(root, 'src-tauri')).filter(name => /^tauri[^/]*\.json$/.test(name)).sort();
  for (const name of configs) add('src-tauri/' + name);
  if (!configs.includes('tauri.conf.json') || !configs.includes('tauri.ios.conf.json')) throw new Error('Missing Tauri iOS configuration');
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), excluded };
}

function connection(peer, root = ROOT) {
  const candidates = ['scripts/sync/sync.config.json', 'tools/sync/sync.config.json'].map(p => path.join(root, p));
  const file = candidates.find(p => fs.existsSync(p));
  if (!file) throw new Error('Set up the Windows/Mac sync connection first (scripts/sync/sync.config.json)');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const hostname = cfg.peers && cfg.peers[peer];
  if (typeof hostname !== 'string' || !hostname || /[\s/@?#]/.test(hostname)) throw new Error('Unknown sync peer: ' + peer);
  if (typeof cfg.token !== 'string' || !cfg.token) throw new Error('The sync token is not configured');
  const port = Number(cfg.port || 18788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid sync port');
  return { hostname, port, token: cfg.token };
}

function request(conn, method, route, { json, file, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
    const headers = { 'x-ssdz-token': conn.token };
    if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = body.length; }
    if (file) { headers['content-type'] = 'application/octet-stream'; headers['content-length'] = fs.statSync(file).size; }
    let input, response, deadline, settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (err) { if (input) input.destroy(); reject(err); }
      else resolve(value);
    };
    const req = http.request({ hostname: conn.hostname, port: conn.port, method, path: route, headers }, res => {
      response = res;
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) res.destroy(new Error('Unexpectedly large build response')); else chunks.push(chunk); });
      res.on('error', finish);
      res.on('aborted', () => finish(new Error('Mac build response was interrupted')));
      res.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { data = {}; }
        if (res.statusCode < 200 || res.statusCode >= 300 || data.ok === false) {
          const err = new Error(data.error || data.message || data.msg || ('Mac build service returned HTTP ' + res.statusCode));
          err.statusCode = res.statusCode;
          finish(err);
        } else finish(null, data);
      });
    });
    // Socket idle timeouts do not bound DNS/TCP setup, nor a slow trickle of bytes.
    deadline = setTimeout(() => req.destroy(new Error('Mac build request exceeded its deadline')), timeout);
    req.setTimeout(timeout, () => req.destroy(new Error('Mac build request timed out')));
    req.on('error', finish);
    req.once('close', () => {
      clearTimeout(deadline);
      if (!settled && (!response || !response.complete)) finish(new Error('Mac build connection closed before its response completed'));
    });
    if (file) { input = fs.createReadStream(file); input.on('error', err => req.destroy(err)); input.pipe(req); }
    else req.end(body);
  });
}

async function retry(action, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try { return await action(); }
    catch (err) {
      if (attempt >= attempts || (err.statusCode && err.statusCode < 500)) throw err;
      await sleep(attempt * 1000);
    }
  }
}

async function check(conn) {
  let data;
  try { data = await retry(() => request(conn, 'GET', '/api/ios-build/check', { timeout: 90000 })); }
  catch (err) {
    if (err.statusCode === 404) throw new Error('The Mac sync service needs its one-time update. On the Mac run: node scripts/sync/sync.js restart');
    throw err;
  }
  if (data.api !== 1 || data.platform !== 'darwin' || !data.ready) throw new Error(data.error || data.message || data.msg || 'The paired Mac is not ready for iOS builds');
  return data;
}

async function download(conn, id, artifact, dest) {
  const temp = dest + '.' + crypto.randomBytes(6).toString('hex') + '.part';
  try {
    await new Promise((resolve, reject) => {
      let deadline, response, settled = false;
      const finish = err => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (err) reject(err); else resolve();
      };
      const req = http.get({ hostname: conn.hostname, port: conn.port,
        path: '/api/ios-build/artifact?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(artifact.name),
        headers: { 'x-ssdz-token': conn.token } }, res => {
        response = res;
        if (res.statusCode !== 200) { res.resume(); const err = new Error('IPA download returned HTTP ' + res.statusCode); err.statusCode = res.statusCode; finish(err); return; }
        const length = Number(res.headers['content-length']);
        if (Number.isFinite(length) && length !== artifact.size) { res.destroy(); finish(new Error('IPA download size differs from the completed build')); return; }
        pipeline(res, fs.createWriteStream(temp, { flags: 'wx' })).then(() => finish(), finish);
      });
      deadline = setTimeout(() => req.destroy(new Error('IPA download exceeded ten minutes')), 10 * 60 * 1000);
      req.setTimeout(60000, () => req.destroy(new Error('IPA download timed out')));
      req.on('error', err => {
        // Let pipeline close the .part handle before the outer finally removes it on Windows.
        if (response) response.destroy(err); else finish(err);
      });
      req.once('close', () => {
        clearTimeout(deadline);
        // After a response starts, pipeline owns cleanup of its output file.
        if (!response) finish(new Error('IPA connection closed before a response was received'));
      });
    });
    if (fs.statSync(temp).size !== artifact.size) throw new Error('Incomplete IPA download: ' + artifact.name);
    const fd = fs.openSync(temp, 'r');
    const magic = Buffer.alloc(4);
    try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
    if (!magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('The returned artifact is not an IPA ZIP archive');
    // rename replaces a previous artifact only after the new download has passed validation.
    fs.renameSync(temp, dest);
  } finally { try { fs.unlinkSync(temp); } catch {} }
}

async function main(args = process.argv.slice(2)) {
  const opts = parseArgs(args);
  if (opts.help) {
    console.log('node tools/build-ios-remote.cjs [--peer mac] [--variant both|modern|legacy] [--version VERSION]\n' +
      '  --check     Check the Mac toolchain only; do not upload or build\n' +
      '  --dry-run   Show the source/output plan without network access or writes\n' +
      'Default: build both unsigned iOS variants and return them to src-tauri/dist.');
    return;
  }
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8').replace(/^\uFEFF/, '')).version;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid Tauri version');
  if (opts.version && opts.version !== version) throw new Error('--version must match src-tauri/tauri.conf.json (' + version + ')');
  const variants = opts.variant === 'both' ? VARIANTS : [opts.variant];
  const names = expectedArtifacts(version, variants);
  if (opts.dryRun) {
    const snapshot = sourceManifest();
    console.log('iOS peer: ' + opts.peer + '; version: ' + version + '; sources: ' + snapshot.files.length + ' files');
    for (const name of names) console.log('  src-tauri/dist/' + name);
    console.log('No network access, builds or file writes were performed.');
    return;
  }
  const conn = connection(opts.peer);
  console.log('[iOS] Checking the paired Mac...');
  await check(conn);
  if (opts.check) { console.log('[iOS] Mac toolchain is ready.'); return; }
  console.log('[iOS] Preparing an isolated source snapshot...');
  const snapshot = sourceManifest();
  if (snapshot.excluded) console.log('[iOS] Excluded ' + snapshot.excluded + ' hidden/private files from the snapshot.');
  // Creating a job is deliberately not retried: a dropped reply must not create duplicate jobs.
  const prepared = await request(conn, 'POST', '/api/ios-build/prepare', { json: { version, variants, files: snapshot.files }, timeout: 180000 });
  if (typeof prepared.id !== 'string' || !prepared.id || !Array.isArray(prepared.missing)) throw new Error('Invalid Mac build preparation response');
  const id = prepared.id;
  const prefix = '/api/ios-build/';
  const query = '?id=' + encodeURIComponent(id);
  const known = new Set(snapshot.files.map(f => f.path));
  if (new Set(prepared.missing).size !== prepared.missing.length || prepared.missing.some(p => !known.has(p))) throw new Error('The Mac requested files outside this build snapshot');
  console.log('[iOS] Job ' + id + ': uploading ' + prepared.missing.length + '/' + snapshot.files.length + ' changed files.');
  let cursor = 0, completed = 0, uploadError;
  let heartbeat = Date.now();
  await Promise.all(Array.from({ length: Math.min(4, prepared.missing.length) }, async () => {
    while (!uploadError && cursor < prepared.missing.length) {
      const rel = prepared.missing[cursor++];
      try {
        await retry(() => request(conn, 'PUT', prefix + 'file' + query + '&path=' + encodeURIComponent(rel), { file: path.join(ROOT, rel), timeout: 120000 }));
        completed++;
        if (Date.now() - heartbeat > 20000) { console.log('[iOS] Uploaded ' + completed + '/' + prepared.missing.length + ' files...'); heartbeat = Date.now(); }
      } catch (err) { uploadError = err; }
    }
  }));
  if (uploadError) throw uploadError;
  try { await request(conn, 'POST', prefix + 'start' + query, { json: {}, timeout: 180000 }); }
  catch (err) {
    // If the reply was lost after starting, resume polling that same job rather than launching another.
    let job;
    try { job = await retry(() => request(conn, 'GET', prefix + 'job' + query)); } catch {}
    if (!job || !['running', 'succeeded', 'failed'].includes(job.state)) throw new Error('Could not confirm Mac build startup for job ' + id + ': ' + err.message);
  }
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  let offset = 0, job, disconnectedAt = 0;
  heartbeat = Date.now();
  console.log('[iOS] Building on the Mac (modern and legacy jobs run sequentially)...');
  while (Date.now() < deadline) {
    try { job = await request(conn, 'GET', prefix + 'job' + query + '&offset=' + offset); disconnectedAt = 0; }
    catch (err) {
      if (err.statusCode && err.statusCode < 500) throw err;
      if (!disconnectedAt) { disconnectedAt = Date.now(); console.log('[iOS] Connection interrupted; reconnecting to the same Mac job...'); }
      if (Date.now() - disconnectedAt > 60000) throw new Error('Mac connection unavailable for 60 seconds. Build job ' + id + ' may still be running; ' + err.message);
      await sleep(3000); continue;
    }
    const lines = Array.isArray(job.lines) ? job.lines : [];
    if (lines.length > 30) console.log('[iOS] (' + (lines.length - 30) + ' earlier build log lines omitted)');
    for (const line of lines.slice(-30)) console.log('[Mac] ' + String(line));
    if (Number.isSafeInteger(job.offset) && job.offset >= offset) offset = job.offset;
    if (job.state === 'failed') throw new Error('Mac iOS build failed: ' + (job.error || 'see the build log above'));
    if (job.state === 'succeeded') break;
    if (Date.now() - heartbeat > 20000) { console.log('[iOS] Mac build is still running...'); heartbeat = Date.now(); }
    await sleep(2000);
  }
  if (!job || job.state !== 'succeeded') throw new Error('Mac iOS build exceeded two hours; job ' + id + ' may still be running');
  if (!Array.isArray(job.artifacts) || job.artifacts.length !== names.length ||
      new Set(job.artifacts.map(a => a.name)).size !== names.length ||
      job.artifacts.some(a => !names.includes(a.name) || !Number.isSafeInteger(a.size) || a.size < 4)) throw new Error('Mac build artifacts do not match the requested version and variants');
  const dist = path.join(ROOT, 'src-tauri/dist');
  fs.mkdirSync(dist, { recursive: true });
  for (const artifact of job.artifacts) {
    console.log('[iOS] Downloading ' + artifact.name + '...');
    await retry(() => download(conn, id, artifact, path.join(dist, artifact.name)));
    console.log('[iOS] Saved src-tauri/dist/' + artifact.name);
  }
}

module.exports = { parseArgs, sourceManifest, expectedArtifacts, connection, main };
if (require.main === module) main().catch(err => { console.error('[iOS] ' + err.message); process.exitCode = 1; });
