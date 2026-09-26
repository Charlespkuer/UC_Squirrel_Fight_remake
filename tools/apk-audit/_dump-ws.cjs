/* 临时：把 APK 里的 weaponsMap / skillsMap 全量导出，并与本地 GameDict.js 逐字节对比（跑完即删）。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const apk = require('./apk-zip.cjs');
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


const ROOT = findRoot(__dirname);

function loadDict(source, tag) {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(apk.readGameFile('js/Map.min.js').toString('utf8'), sandbox, { filename: 'Map.min.js' });
  vm.runInContext(source, sandbox, { filename: tag + '/GameDict.js' });
  return sandbox;
}
const apkDict = apk.readGameFile('js/GameDict.js').toString('utf8');
const localPath = path.join(ROOT, 'js', 'orig', 'GameDict.js');
const localDict = fs.readFileSync(localPath, 'utf8');

const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16);
console.log('=== 字典文件本体 ===');
console.log('APK  js/GameDict.js   ' + apkDict.length + ' 字符  sha256:' + sha(apkDict));
console.log('本地 js/orig/GameDict.js ' + localDict.length + ' 字符  sha256:' + sha(localDict));
console.log(apkDict === localDict ? '→ 逐字节完全相同' : '→ 有差异！');

const A = loadDict(apkDict, 'apk'), L = loadDict(localDict, 'local');

function dump(map, label) {
  const rows = [];
  map.each((k, v) => rows.push(v));
  rows.sort((a, b) => Number(a.id) - Number(b.id));
  console.log('\n=== ' + label + '（' + rows.length + ' 条）===');
  for (const r of rows) {
    const keys = Object.keys(r).filter((k) => k !== 'source');
    console.log('  ' + keys.map((k) => k + '=' + JSON.stringify(r[k])).join('  '));
  }
  return rows;
}
const aW = dump(A.weaponsMap, 'APK weaponsMap 武器');
const aS = dump(A.skillsMap, 'APK skillsMap 技能');
dump(A.upgradeMap, 'APK upgradeMap 武技升级');
dump(A.attachmentMap, 'APK attachmentMap 装备附加（前 8 条）').slice(8);
