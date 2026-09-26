/* Minimal, dependency-free ZIP reader for the shipped APK.
 *
 * The APK is a plain ZIP and its assets/game.zip is *stored* (not deflated), so the
 * original client sources can be read straight out of the APK without unpacking
 * 35 MB to disk. Read-only; no third-party modules.
 *
 *   const apk = require('./apk-zip.cjs');
 *   apk.listGameFiles()            -> ['js/GameDict.js', 'images/...', ...]
 *   apk.readGameFile('js/player.js') -> utf8 string
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
/** 项目根：从脚本所在目录往上找含 index.html 的那一层（tools/ 放哪都能用）。 */
function findRoot(start) {
  const fsx = require('node:fs'), px = require('node:path');
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fsx.existsSync(px.join(d, 'index.html'))) return d;
    const up = px.dirname(d);
    if (up === d) break;
    d = up;
  }
  return px.resolve(start, '..');
}


const APK = path.join(findRoot(__dirname), 'references', 'h5ssdz_9game_4230.apk');

/** Parse a ZIP buffer into { name -> {method, size, offset} } using the central directory. */
function entries(buf) {
  const eocd = (() => {
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) return i;
    }
    throw new Error('不是有效的 ZIP：找不到 EOCD');
  })();
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录损坏 @' + p);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (!name.endsWith('/')) out.set(name, { method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Read one entry's bytes from a ZIP buffer. */
function read(buf, entry) {
  const p = entry.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error('本地头损坏 @' + p);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + (entry.method === 0 ? entry.size : buf.readUInt32LE(p + 18)));
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error('不支持的压缩方式 ' + entry.method);
}

let apkBuf = null, apkIndex = null, gameBuf = null, gameIndex = null;
function apk() {
  if (!apkBuf) {
    if (!fs.existsSync(APK)) throw new Error('找不到 APK：' + APK);
    apkBuf = fs.readFileSync(APK);
    apkIndex = entries(apkBuf);
  }
  return apkIndex;
}
function game() {
  if (!gameBuf) {
    const e = apk().get('assets/game.zip');
    if (!e) throw new Error('APK 内没有 assets/game.zip');
    gameBuf = read(apkBuf, e);
    gameIndex = entries(gameBuf);
  }
  return gameIndex;
}

module.exports = {
  APK,
  apkEntries: () => [...apk().keys()],
  readApkFile: (name) => { const e = apk().get(name); if (!e) throw new Error('APK 内没有 ' + name); return read(apkBuf, e); },
  listGameFiles: () => [...game().keys()].sort(),
  readGameFile: (name) => {
    const e = game().get(name) || game().get(name.replace(/\\/g, '/'));
    if (!e) throw new Error('game.zip 内没有 ' + name);
    return read(gameBuf, e);
  },
  readGameText: (name) => module.exports.readGameFile(name).toString('utf8'),
};

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'list') console.log(module.exports.listGameFiles().join('\n'));
  else if (cmd === 'read') process.stdout.write(module.exports.readGameText(arg));
  else console.log('用法: node tools/apk-audit/apk-zip.cjs list | read <game.zip 内路径>');
}
