#!/usr/bin/env node
'use strict';
// Reusable build gate: check the actual ELF segments and APK storage alignment.
// No-argument usage checks the newest APK in src-tauri/dist.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const HEADER_BYTES = 65536;
const MACHINES = { 'arm64-v8a': 183, x86_64: 62, 'armeabi-v7a': 40, x86: 3 };

function elfInfo(bytes, abi) {
  if (bytes.length < 64 || bytes.toString('hex', 0, 4) !== '7f454c46' || bytes[5] !== 1) {
    throw Error('Not a little-endian Android ELF library');
  }
  const bits = bytes[4], machine = bytes.readUInt16LE(18);
  if (bits !== 1 && bits !== 2) throw Error('Unsupported ELF class');
  if (abi && MACHINES[abi] !== machine) throw Error('ELF machine does not match ABI ' + abi);
  const offset = bits === 2 ? Number(bytes.readBigUInt64LE(32)) : bytes.readUInt32LE(28);
  const stride = bytes.readUInt16LE(bits === 2 ? 54 : 42);
  const count = bytes.readUInt16LE(bits === 2 ? 56 : 44);
  if (stride < (bits === 2 ? 56 : 32) || !count || offset + stride * count > bytes.length) {
    throw Error('Invalid or unsupported ELF program-header table');
  }
  const alignment = [], required = bits === 2 ? 16384 : 4096;
  for (let i = 0; i < count; i++) {
    const row = offset + i * stride;
    if (bytes.readUInt32LE(row) !== 1) continue; // PT_LOAD
    const align = bits === 2 ? Number(bytes.readBigUInt64LE(row + 48)) : bytes.readUInt32LE(row + 28);
    alignment.push(align);
    if (align < required || (align & (align - 1)) !== 0) {
      throw Error('ELF LOAD alignment ' + align + ' is below ' + required + ' bytes; rebuild the native library');
    }
  }
  if (!alignment.length) throw Error('ELF contains no LOAD segments');
  return { bits: bits === 2 ? 64 : 32, alignment, required };
}
function readAt(fd, offset, count) {
  const bytes = Buffer.alloc(count);
  if (fs.readSync(fd, bytes, 0, count, offset) !== count) throw Error('Truncated package');
  return bytes;
}
function nativeEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, length = Math.min(size, 65557);
    const tail = readAt(fd, size - length, length);
    let end = -1;
    for (let i = length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === length) { end = i; break; }
    }
    if (end < 0) throw Error('APK ZIP directory not found');
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) throw Error('Multi-disk ZIP is unsupported');
    const count = tail.readUInt16LE(end + 10), offset = tail.readUInt32LE(end + 16);
    if (count === 65535 || offset === 0xffffffff) throw Error('ZIP64 package requires a ZIP64-aware verifier');
    const out = []; let cursor = offset;
    for (let i = 0; i < count; i++) {
      const row = readAt(fd, cursor, 46);
      if (row.readUInt32LE(0) !== 0x02014b50) throw Error('Invalid ZIP directory entry');
      const nameLength = row.readUInt16LE(28), extra = row.readUInt16LE(30), comment = row.readUInt16LE(32);
      const name = readAt(fd, cursor + 46, nameLength).toString('utf8');
      cursor += 46 + nameLength + extra + comment;
      const match = /^lib\/([^/]+)\/[^/]+\.so$/.exec(name);
      if (!match) continue;
      if (row.readUInt16LE(8) & 1) throw Error('Encrypted native library: ' + name);
      const local = row.readUInt32LE(42), head = readAt(fd, local, 30);
      if (head.readUInt32LE(0) !== 0x04034b50) throw Error('Invalid local ZIP entry: ' + name);
      const start = local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const compressed = row.readUInt32LE(20), raw = row.readUInt32LE(24);
      if (!compressed || !raw || start + compressed > size) throw Error('Invalid library bounds: ' + name);
      out.push({ name, abi: match[1], method: row.readUInt16LE(10), start, compressed, raw });
    }
    if (!out.length) throw Error('APK contains no native libraries');
    return out;
  } finally { fs.closeSync(fd); }
}
async function entryHeader(file, entry) {
  const fd = fs.openSync(file, 'r');
  if (entry.method === 0) {
    try { return readAt(fd, entry.start, Math.min(HEADER_BYTES, entry.raw)); }
    finally { fs.closeSync(fd); }
  }
  fs.closeSync(fd);
  if (entry.method !== 8) throw Error('Unsupported ZIP compression: ' + entry.name);
  const input = fs.createReadStream(file, { start: entry.start, end: entry.start + entry.compressed - 1 });
  const output = zlib.createInflateRaw(); input.pipe(output);
  const chunks = []; let length = 0;
  try {
    input.on('error', err => output.destroy(err));
    for await (const chunk of output) {
      const take = chunk.subarray(0, HEADER_BYTES - length); chunks.push(take); length += take.length;
      if (length >= HEADER_BYTES) break;
    }
    return Buffer.concat(chunks);
  } finally { input.destroy(); output.destroy(); }
}
async function checkPackage(file) {
  const results = [];
  for (const entry of nativeEntries(file)) {
    try {
      const info = elfInfo(await entryHeader(file, entry), entry.abi);
      if (entry.method === 0 && entry.start % info.required !== 0) {
        throw Error('Uncompressed library is not ZIP-aligned to ' + info.required + ' bytes');
      }
      results.push({ name: entry.name, ...info });
    } catch (err) { throw Error(entry.name + ': ' + err.message); }
  }
  return results;
}
async function main(args) {
  if (args[0] === '--library') {
    const fd = fs.openSync(args[1], 'r');
    let info;
    try { info = elfInfo(readAt(fd, 0, Math.min(fs.fstatSync(fd).size, HEADER_BYTES)), args[2]); }
    finally { fs.closeSync(fd); }
    console.log('PASS native ' + args[2] + ': ELF LOAD ' + info.alignment.join('/'));
    return;
  }
  let file = args[0];
  if (!file) {
    const dir = path.join(__dirname, '../src-tauri/dist');
    file = fs.readdirSync(dir).filter(n => n.endsWith('.apk')).map(n => path.join(dir, n))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  }
  if (!file) throw Error('No APK found; pass the package path');
  const results = await checkPackage(file);
  for (const row of results) console.log('PASS ' + row.name + ': ELF LOAD ' + row.alignment.join('/'));
  console.log('PASS APK ELF / ZIP alignment: ' + path.basename(file));
}
module.exports = { elfInfo, nativeEntries, checkPackage };
if (require.main === module) main(process.argv.slice(2)).catch(err => { console.error('FAIL ' + err.message); process.exitCode = 1; });
