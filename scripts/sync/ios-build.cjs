'use strict';

// Auth is supplied by sync.js. This endpoint accepts source snapshots, never shell commands.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const MAX_FILE = 128 * 1024 * 1024;
const UPLOAD_TTL = 30 * 60 * 1000;
const BUILD_TTL = 2 * 60 * 60 * 1000;
const MAX_LINES = 800;
const MAX_LOG_CHARS = 100000;

function sourcePath(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\\:\x00-\x1f\x7f]/.test(value)) return false;
  const parts = value.split('/');
  if (parts.some((p) => !p || p.startsWith('.') || p.endsWith('.') || p.endsWith(' '))) return false;
  if (/^(css|js|images|audio)\/.+/.test(value)) return true;
  if (['scripts/index.html', 'scripts/version.json', 'tools/build-ios.cjs', 'tools/build-tauri-app.cjs'].includes(value)) return true;
  if (!value.startsWith('src-tauri/')) return false;
  const sub = value.slice(10);
  return /^(src|capabilities|icons|empty)\/.+/.test(sub) ||
    /^(Cargo\.toml|Cargo\.lock|build\.rs|tauri[^/]*\.json|Info\.ios\.plist|app-icon\.png|package\.json|package-lock\.json)$/.test(sub);
}

function reply(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function problem(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function jsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw problem('Manifest is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_) { throw problem('Invalid JSON body.'); }
}

// Do not follow links from either the private workspace or the Mac source cache.
async function safeFile(base, rel, mkdir = false) {
  const file = path.resolve(base, ...rel.split('/'));
  if (!file.startsWith(path.resolve(base) + path.sep)) throw problem('Invalid source path.');
  let at = base;
  const parts = rel.split('/');
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) at = path.join(at, parts[i]);
    let stat;
    try { stat = await fsp.lstat(at); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (mkdir && i < parts.length - 1) {
        await fsp.mkdir(at).catch((error) => { if (error.code !== 'EEXIST') throw error; });
        const created = await fsp.lstat(at);
        if (!created.isDirectory() || created.isSymbolicLink()) throw problem('Invalid source directory.');
        continue;
      }
      continue;
    }
    if (stat.isSymbolicLink()) throw problem('Symbolic links are not accepted.');
    if (i < parts.length - 1 && !stat.isDirectory()) throw problem('A source parent is not a directory.');
    if (i === parts.length - 1 && !stat.isFile()) throw problem('Source must be a regular file.');
  }
  return file;
}

async function matches(file, entry) {
  try {
    const stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) return false;
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === entry.sha256;
  } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

function createIosBuildService({ root }) {
  root = fs.realpathSync(root);
  const suffix = crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
  const base = path.join(fs.realpathSync(os.tmpdir()), 'squirrel-fight-ios-' + suffix);
  const source = path.join(base, 'source');
  const stateFile = path.join(base, 'job.json');
  const previousManifest = path.join(base, 'source-manifest.json');
  const jobs = new Map();
  let current = null;
  let preparing = false;
  let checking = null;
  let saveTimer = null;
  let orphanPid = null;

  function processGroupAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try { process.kill(process.platform === 'win32' ? pid : -pid, 0); return true; }
    catch (error) { return error.code === 'EPERM'; }
  }

  function persist(job) {
    try {
      fs.mkdirSync(base, { recursive: true });
      const data = { id: job.id, version: job.version, state: job.state, lines: job.lines,
        lineStart: job.lineStart, error: job.error, artifacts: job.artifacts,
        childPid: job.childPid || null, updated: job.updated };
      const tmp = stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, stateFile);
    } catch (_) { /* A failed metadata write must not crash the running build. */ }
  }

  function log(job, text) {
    const clean = String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    for (const line of clean.split(/\r?\n/)) {
      if (!line.trim()) continue;
      job.lines.push(line.slice(0, 3000));
    }
    while (job.lines.length > MAX_LINES || job.lines.reduce((n, s) => n + s.length, 0) > MAX_LOG_CHARS) {
      job.lines.shift(); job.lineStart++;
    }
    job.updated = Date.now();
    if (!saveTimer) {
      saveTimer = setTimeout(() => { saveTimer = null; if (current) persist(current); }, 700);
      saveTimer.unref();
    }
  }

  function failJob(job, message) {
    job.state = 'failed'; job.error = message; job.updated = Date.now();
    log(job, '[failed] ' + message); persist(job);
  }

  // Retain the latest failure tail across sync-daemon restarts.
  try {
    const old = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (/^[a-f0-9]{32}$/.test(old.id)) {
      old.lineStart = old.lineStart || 0; old.lines = Array.isArray(old.lines) ? old.lines.slice(-MAX_LINES) : [];
      old.artifacts = Array.isArray(old.artifacts) ? old.artifacts : [];
      if (old.state === 'running' || old.state === 'uploading') {
        if (old.state === 'running' && processGroupAlive(old.childPid)) orphanPid = old.childPid;
        old.state = 'failed'; old.error = 'Sync service restarted before this job completed.';
      }
      jobs.set(old.id, old);
    }
  } catch (_) {}

  function getJob(url) {
    const id = url.searchParams.get('id');
    const job = jobs.get(id);
    if (!job) throw problem('Unknown build job.', 404);
    if (job.state === 'uploading' && Date.now() - job.updated > UPLOAD_TTL) {
      for (const upload of job.uploads.values()) upload.destroy();
      failJob(job, 'Source upload expired after 30 minutes.');
    }
    return job;
  }

  function runBuilder(cwd, args, { job = null, timeout = 90000 } = {}) {
    return new Promise((resolve, reject) => {
      let tail = '';
      let expired = false;
      let killer;
      const child = spawn(process.execPath, [path.join(cwd, 'tools', 'build-ios.cjs'), ...args], {
        cwd: os.tmpdir(), windowsHide: true, detached: process.platform !== 'win32',
        env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (job) { job.child = child; job.childPid = child.pid || null; persist(job); }
      function terminate(signal) {
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch (_) {}
      }
      const timer = setTimeout(() => {
        expired = true; terminate('SIGTERM');
        killer = setTimeout(() => terminate('SIGKILL'), 3000); killer.unref();
      }, timeout);
      timer.unref();
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
        const text = chunk.toString('utf8'); tail = (tail + text).slice(-12000);
        if (job) log(job, text);
      });
      child.once('error', (error) => { clearTimeout(timer); clearTimeout(killer); reject(error); });
      child.once('close', (code) => {
        clearTimeout(timer); clearTimeout(killer);
        if (expired) terminate('SIGKILL');
        if (job) { job.child = null; job.childPid = null; persist(job); }
        if (expired) reject(new Error('iOS build process exceeded its time limit.'));
        else if (code !== 0) reject(new Error('iOS builder exited with code ' + code + '. ' + tail.trim().slice(-1800)));
        else resolve(tail);
      });
    });
  }

  async function check(res) {
    if (process.platform !== 'darwin') return reply(res, 200, { ok: true, api: 1, platform: process.platform, ready: false, msg: 'iOS builds require macOS.' });
    if (!checking) checking = runBuilder(root, ['--check']).then(
      (tail) => ({ ready: true, msg: tail.trim() }),
      (error) => ({ ready: false, msg: error.message })
    ).finally(() => { checking = null; });
    const result = await checking;
    reply(res, 200, { ok: true, api: 1, platform: process.platform, ...result });
  }

  async function prepare(req, res) {
    if (orphanPid && processGroupAlive(orphanPid)) throw problem('A build from the previous sync-service process is still active; wait for it to exit.', 409);
    orphanPid = null;
    if (preparing || (current && (current.state === 'running' || (current.uploads && current.uploads.size)))) {
      throw problem('An iOS build or upload is already active.', 409);
    }
    preparing = true;
    try {
      const body = await jsonBody(req);
      if (!body || typeof body.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(body.version)) throw problem('Invalid build version.');
      if (!Array.isArray(body.variants) || !body.variants.length || body.variants.some((v) => !['modern', 'legacy'].includes(v)) || new Set(body.variants).size !== body.variants.length) throw problem('Invalid iOS variants.');
      if (!Array.isArray(body.files) || !body.files.length || body.files.length > 40000) throw problem('Invalid source manifest.');
      const files = new Map();
      let total = 0;
      for (const entry of body.files) {
        if (!entry || !sourcePath(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE || !/^[a-f0-9]{64}$/.test(entry.sha256) || files.has(entry.path)) throw problem('Invalid or duplicate source entry.');
        total += entry.size;
        if (total > 2 * 1024 * 1024 * 1024) throw problem('Source snapshot is too large.', 413);
        files.set(entry.path, { path: entry.path, size: entry.size, sha256: entry.sha256 });
      }
      for (const required of ['tools/build-ios.cjs', 'tools/build-tauri-app.cjs', 'scripts/index.html', 'src-tauri/tauri.conf.json', 'src-tauri/package.json', 'src-tauri/Cargo.toml']) {
        if (!files.has(required)) throw problem('Source manifest is missing ' + required);
      }
      if (current && current.state === 'uploading') failJob(current, 'Replaced by a new source snapshot.');
      await fsp.mkdir(base, { recursive: true });
      if ((await fsp.lstat(base)).isSymbolicLink()) throw problem('Workspace cannot be a symbolic link.');
      await fsp.mkdir(source, { recursive: true });
      if ((await fsp.lstat(source)).isSymbolicLink()) throw problem('Workspace cannot be a symbolic link.');
      const job = { id: crypto.randomBytes(16).toString('hex'), version: body.version,
        variants: ['modern', 'legacy'].filter((v) => body.variants.includes(v)), files, missing: new Set(),
        uploads: new Map(), lines: [], lineStart: 0, artifacts: [], state: 'uploading', error: '', updated: Date.now() };
      // Include abandoned uploads/copies in the next cleanup, even if no build was started.
      let tracked = [];
      try { tracked = JSON.parse(await fsp.readFile(previousManifest, 'utf8')); } catch (_) {}
      if (!Array.isArray(tracked)) tracked = [];
      const knownPaths = [...new Set([...tracked.filter(sourcePath), ...files.keys()])];
      const trackingTmp = previousManifest + '.tmp';
      await fsp.writeFile(trackingTmp, JSON.stringify(knownPaths));
      await fsp.rename(trackingTmp, previousManifest);
      for (const entry of files.values()) {
        const dest = await safeFile(source, entry.path, true);
        if (await matches(dest, entry)) continue;
        let copied = false;
        try {
          const cached = await safeFile(root, entry.path);
          if (await matches(cached, entry)) {
            const tmp = dest + '.cache-' + job.id;
            try {
              await fsp.copyFile(cached, tmp, fs.constants.COPYFILE_EXCL);
              if (await matches(tmp, entry)) { await fsp.rename(tmp, dest); copied = true; }
            } finally { await fsp.unlink(tmp).catch(() => {}); }
          }
        } catch (error) {
          if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code) && !error.status) throw error;
        }
        if (!copied) job.missing.add(entry.path);
      }
      current = job; jobs.set(job.id, job);
      log(job, 'Snapshot prepared: ' + files.size + ' files; ' + job.missing.size + ' uploads needed.');
      persist(job);
      reply(res, 200, { ok: true, id: job.id, missing: [...job.missing] });
    } finally { preparing = false; }
  }

  async function upload(req, res, url) {
    const job = getJob(url);
    const rel = url.searchParams.get('path');
    if (preparing || job !== current || job.state !== 'uploading') throw problem('Job is not accepting files.', 409);
    if (!job.files.has(rel)) throw problem('File is not requested by this snapshot.');
    if (job.uploads.has(rel)) throw problem('This file is already uploading.', 409);
    const entry = job.files.get(rel);
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) !== entry.size) throw problem('Content length does not match the manifest.');
    job.uploads.set(rel, req);
    let tmp;
    const hash = crypto.createHash('sha256');
    let size = 0;
    try {
      const dest = await safeFile(source, rel, true);
      tmp = dest + '.upload-' + job.id;
      const meter = new Transform({ transform(chunk, _, done) {
        size += chunk.length;
        if (size > entry.size || size > MAX_FILE) return done(problem('Upload exceeds its declared size.', 413));
        hash.update(chunk); job.updated = Date.now(); done(null, chunk);
      } });
      await pipeline(req, meter, fs.createWriteStream(tmp, { flags: 'wx' }));
      if (size !== entry.size || hash.digest('hex') !== entry.sha256) throw problem('Upload checksum or size mismatch.');
      if (job !== current || job.state !== 'uploading') throw problem('Upload job is no longer active.', 409);
      await safeFile(source, rel);
      await fsp.rename(tmp, dest);
      job.missing.delete(rel); job.updated = Date.now();
      reply(res, 200, { ok: true });
    } finally {
      job.uploads.delete(rel);
      if (tmp) await fsp.unlink(tmp).catch(() => {});
    }
  }

  async function execute(job) {
    const deadline = Date.now() + BUILD_TTL;
    try {
      await runBuilder(source, ['--check'], { job, timeout: Math.min(90000, deadline - Date.now()) });
      const outputDir = path.join(base, 'artifacts', job.id);
      await fsp.mkdir(outputDir, { recursive: true });
      for (const variant of job.variants) {
        const name = 'squirrel_fight_' + job.version + (variant === 'legacy' ? '_ios_legacy_unsigned.ipa' : '_ios_unsigned.ipa');
        const output = path.join(source, 'src-tauri', 'dist', name);
        await fsp.unlink(output).catch((e) => { if (e.code !== 'ENOENT') throw e; });
        log(job, '[build] ' + variant);
        await runBuilder(source, variant === 'legacy' ? ['--legacy'] : [], { job, timeout: Math.max(1, deadline - Date.now()) });
        const stat = await fsp.lstat(output);
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Expected IPA was not generated: ' + name);
        await fsp.rename(output, path.join(outputDir, name));
        job.artifacts.push({ name, size: stat.size });
      }
      job.state = 'succeeded'; job.updated = Date.now();
      log(job, '[done] All requested IPA variants are ready.'); persist(job);
    } catch (error) { failJob(job, error.message); }
  }

  async function start(res, url) {
    const job = getJob(url);
    if (process.platform !== 'darwin') throw problem('iOS builds require macOS.', 409);
    if (preparing || job !== current || job.state !== 'uploading' || job.uploads.size) throw problem('Job cannot be started.', 409);
    if (job.missing.size) throw problem('Source snapshot is incomplete.', 409);
    // Reserve the single build slot before awaiting any filesystem operation.
    job.state = 'running'; persist(job);
    try {
      for (const entry of job.files.values()) {
        if (!await matches(await safeFile(source, entry.path), entry)) throw problem('Source snapshot changed: ' + entry.path, 409);
      }
      const conf = JSON.parse(await fsp.readFile(await safeFile(source, 'src-tauri/tauri.conf.json'), 'utf8'));
      if (conf.version !== job.version) throw problem('Snapshot version does not match the requested build.');
      let previous = [];
      try { previous = JSON.parse(await fsp.readFile(previousManifest, 'utf8')); } catch (_) {}
      if (!Array.isArray(previous)) previous = [];
      for (const rel of previous) {
        if (sourcePath(rel) && !job.files.has(rel)) {
          const file = await safeFile(source, rel);
          await fsp.unlink(file).catch((e) => { if (e.code !== 'ENOENT') throw e; });
        }
      }
      await fsp.writeFile(previousManifest, JSON.stringify([...job.files.keys()]));
      const dependencies = path.join(root, 'src-tauri', 'node_modules');
      if (!(await fsp.stat(dependencies)).isDirectory()) throw problem('Mac src-tauri/node_modules is missing.');
      const link = path.join(source, 'src-tauri', 'node_modules');
      try {
        const stat = await fsp.lstat(link);
        if (!stat.isSymbolicLink() || await fsp.realpath(link) !== await fsp.realpath(dependencies)) throw problem('Unexpected workspace node_modules entry.');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        await fsp.symlink(dependencies, link, 'dir');
      }
      log(job, '[start] Isolated source snapshot ' + job.version + '; Mac working tree is unchanged.');
      persist(job);
      reply(res, 200, { ok: true, id: job.id });
      void execute(job);
    } catch (error) { failJob(job, error.message); throw error; }
  }

  async function route(req, res, url) {
    if (url.pathname === '/api/ios-build/check' && req.method === 'GET') return check(res);
    if (url.pathname === '/api/ios-build/prepare' && req.method === 'POST') return prepare(req, res);
    if (url.pathname === '/api/ios-build/file' && req.method === 'PUT') return upload(req, res, url);
    if (url.pathname === '/api/ios-build/start' && req.method === 'POST') return start(res, url);
    if (url.pathname === '/api/ios-build/job' && req.method === 'GET') {
      const job = getJob(url);
      const requested = Number(url.searchParams.get('offset') || 0);
      if (!Number.isSafeInteger(requested) || requested < 0) throw problem('Invalid log offset.');
      const offset = job.lineStart + job.lines.length;
      return reply(res, 200, { ok: true, id: job.id, state: job.state,
        lines: job.lines.slice(Math.max(0, requested - job.lineStart)), offset,
        error: job.error || '', artifacts: job.state === 'succeeded' ? job.artifacts : [] });
    }
    if (url.pathname === '/api/ios-build/artifact' && req.method === 'GET') {
      const job = getJob(url);
      const name = url.searchParams.get('name');
      const artifact = job.state === 'succeeded' && job.artifacts.find((a) => a.name === name);
      if (!artifact || !/^[A-Za-z0-9_.+-]+\.ipa$/.test(name)) throw problem('Artifact is not available.', 404);
      const file = path.join(base, 'artifacts', job.id, name);
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== artifact.size) throw problem('Artifact is not available.', 404);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size,
        'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="' + name + '"' });
      return pipeline(fs.createReadStream(file), res);
    }
    throw problem('Unknown iOS build endpoint or method.', 404);
  }

  const expiryTimer = setInterval(() => {
    if (current && current.state === 'uploading' && Date.now() - current.updated > UPLOAD_TTL) {
      for (const req of current.uploads.values()) req.destroy();
      failJob(current, 'Source upload expired after 30 minutes.');
    }
  }, 60000);
  expiryTimer.unref();

  return {
    capabilities: () => ({ api: 1, platform: process.platform, available: process.platform === 'darwin' }),
    handle(req, res, url) {
      if (!url.pathname.startsWith('/api/ios-build/')) return false;
      void route(req, res, url).catch((error) => {
        if (res.headersSent) { if (!res.destroyed) res.destroy(); return; }
        reply(res, error.status || 500, { ok: false, error: error.message });
      });
      return true;
    },
  };
}

module.exports = { createIosBuildService };
