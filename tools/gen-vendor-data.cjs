#!/usr/bin/env node
/* ============================================================
 * tools/gen-vendor-data.cjs — 把原版数据抽成游戏自己的 js/gamedict.js
 *
 * 背景：js/orig/ 里的 5 个原版文件以前是**运行时依赖**（scripts/index.html 直接 <script> 引入）。
 * 现在原版文件整包归到 references/orig/（只作参考、不参与运行），游戏运行需要的那部分数据
 * 由这个脚本抽取、生成 js/gamedict.js，之后再也不用碰 references/。
 *
 * 只抽真正被游戏代码用到的（判断依据：grep 游戏 js/*.js，引用数为 0 的一律不抽）：
 *   · GameDict.js 的 10 个数据字典（武器/技能/道具/装备/套装/强化/NPC/附件/天梯商品/礼包）
 *   · assets.js 的 asstes 素材清单（引擎用它把 id 映射到图片路径）
 *   · assets.js 的 imgMap 图集帧表（引擎用它找每帧在图里的坐标/尺寸/注册点）
 *   · animationStr.js 的 AnimationStr 动画帧表（引擎的动画播放器读它）
 *   · asset2.js 的 asset_* 路径表（**注意：这类是动态读取的**）：
 *     engine.js 的 buildSrcMap() 会遍历 `Object.getOwnPropertyNames(window)`，
 *     把前缀为 `asset` 的数组里的 {id,src} 全部并进 SRC_MAP —— 所以按变量名 grep 是扫不到的。
 *     三侠（tl/xh/xm）、木人、新手礼包、logo 系列全靠它，漏一个就整只怪画不出来。
 *   · 明确不抽（确实没人用）：Map.min.js 的小 Map、
 *     GameDict.js 的 stagesMap/giftsMap/buy91Info/vipProps/words/reg_terms/equipImgMap
 *
 * 用法：node tools/gen-vendor-data.cjs            # 生成 js/gamedict.js
 *      node tools/gen-vendor-data.cjs --check     # 只校验 js/gamedict.js 是否最新
 * ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function findRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'index.html'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(start, '..');
}
const ROOT = findRoot(__dirname);
/* 原版文件优先从 references/orig 读；还没搬的话读 js/orig（迁移期两边都认）。 */
const ORIG_DIRS = [path.join(ROOT, 'references', 'orig'), path.join(ROOT, 'js', 'orig')];
function origFile(name) {
  for (const dir of ORIG_DIRS) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) return f;
  }
  throw new Error('找不到原版文件 ' + name + '（应在 references/orig/ 或 js/orig/）');
}

/** 要迁出的数据字典：全局名 → 一句说明（写进生成文件的注释里）。 */
const DICTS = [
  ['weaponsMap', '武器'],
  ['skillsMap', '技能'],
  ['propMap', '道具'],
  ['gearMap', '装备'],
  ['gearSetMap', '装备套装'],
  ['upgradeMap', '强化'],
  ['npcsMap', 'NPC/关卡敌人'],
  ['attachmentMap', '装备附件（天赋/武技）'],
  ['rankgoodsMap', '天梯商店'],
  ['giftMap', '礼包'],
];

/** 从 GameDict.js 源码里精确抓出每一次 put 的「原始字符串 + 真正的分隔符」。
 *  为什么不用运行时的数组反推：`"a;b;c".split(";")` 之后，分隔符就看不出来了，
 *  而原版数据里**每条的分隔符并不一样**（武器 10 用 `;`、其余用空格，remark 里还带空格），
 *  只能从源码文本里读。 */
function parsePutTable(file) {
  const src = fs.readFileSync(file, 'utf8');
  const table = new Map();
  const re = /(\w+)\.put\(\s*(-?\d+)\s*,\s*("(?:[^"\\]|\\.)*")\s*(?:\.split\(\s*("(?:[^"\\]|\\.)*")\s*\))?\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const dict = m[1];
    const key = Number(m[2]);
    let text;
    try { text = JSON.parse(m[3]); } catch (e) { continue; }
    let sep = ' ';
    if (m[4]) { try { sep = JSON.parse(m[4]); } catch (e) { sep = ' '; } }
    table.set(dict + '#' + key, { text, sep });
  }
  return table;
}

/** 在干净上下文里跑原版文件，把它定义的全局取出来（这些文件都是 `var X = ...` 形式）。 */
function loadOriginals() {
  const ctx = { window: null, console, document: undefined };
  ctx.window = ctx;
  vm.createContext(ctx);
  /* 先跑 Map.min.js，然后把它的构造函数包一层：原版数据里有些值是带**双空格**的
   * （例如武器 10「对手闪避增加20% ,每级…」），如果先 split(' ') 再 join(' ') 会把双空格折叠、
   * 字段整体错位。所以这里在 put 的那一刻就把「原始字符串」留一份，生成时用它。 */
  vm.runInContext(fs.readFileSync(origFile('Map.min.js'), 'utf8'), ctx, { filename: 'Map.min.js' });
  vm.runInContext(`
    (function () {
      const Real = window.Map;
      window.Map = function (fields) {
        const dict = new Real(fields);
        const put = dict.put.bind(dict);
        dict.raw = Object.create(null);
        dict.sep = Object.create(null);
        const note = (id, value) => {
          /* 同一个 id 可能被 put 多次（后写的会覆盖），所以这里也取最后一次 */
          if (typeof value === 'string') { dict.raw[id] = value; dict.sep[id] = ' '; return; }
          if (!Array.isArray(value)) { dict.raw[id] = ''; dict.sep[id] = ' '; return; }
          /* 原版是 put("...".split("X"))，值已经是数组，分隔符 X 看不出来了。
           * 用「数组元素里是否还残留分隔符」反推最稳：
           * 若某元素以「;」开头 → 原来是按空格拆的（说明真分隔符是 ;，被空格拆坏了）→ 用 ';'
           * 否则按空格拆出来的结果就用空格拼回去。 */
          const probe = value.join(' ');
          const sep = /(^|[^ ]);/.test(probe) && value.some((v) => String(v).startsWith(';')) ? ';'
            : (value.some((v) => String(v).startsWith(',')) ? ',' : ' ');
          dict.raw[id] = value.join(sep);
          dict.sep[id] = sep;
        };
        dict.put = function (id, value) { note(id, value); return put(id, value); };
        dict.setValue = function (id, value) { note(id, value); return Real.prototype.setValue.call(dict, id, value); };
        return dict;
      };
    })();
  `, ctx, { filename: 'capture-raw.js' });
  for (const name of ['GameDict.js', 'assets.js', 'asset2.js', 'animationStr.js']) {
    vm.runInContext(fs.readFileSync(origFile(name), 'utf8'), ctx, { filename: name });
  }
  return ctx;
}

/** 把字典的原始值逐条读出来（保持原样的字符串，运行时由 gamedict 的 getValue 拆字段）。 */
function dumpDict(map, name, putTable) {
  if (!map) throw new Error('原版数据里没有 ' + name);
  const fields = map.fields || null;
  const keys = Array.isArray(map.keys) ? map.keys.slice() : [];
  const rows = keys.map((k) => {
    const fromSource = putTable.get(name + '#' + Number(k));
    if (fromSource) return { key: k, raw: fromSource.text, sep: fromSource.sep };
    const raw = map[k];
    const text = typeof raw === 'string' ? raw : (Array.isArray(raw) ? raw.join(' ') : String(raw));
    return { key: k, raw: text, sep: ' ' };
  });
  return { fields, rows };
}

function jsString(text) {
  return JSON.stringify(String(text));
}

function build() {
  const ctx = loadOriginals();
  const putTable = parsePutTable(origFile('GameDict.js'));
  const out = [];
  out.push('/* ============================================================');
  out.push(' * gamedict.js — 原版数据字典 / 素材清单 / 动画帧表（**运行时数据，不是参考文件**）');
  out.push(' *');
  out.push(' * 这个文件由 tools/gen-vendor-data.cjs 从原版数据自动生成，不要手改。');
  out.push(' * 原版文件本体在 references/orig/（只作参考，不参与运行）；游戏跑起来只认这里的数据，');
  out.push(' * 所以运行过程中不会再引用 references/ 下的任何文件。');
  out.push(' *');
  out.push(' * 数据来源：references/orig/GameDict.js、assets.js、animationStr.js');
  out.push(' * 重新生成：node tools/gen-vendor-data.cjs');
  out.push(' * ============================================================ */');
  out.push('(function () {');
  out.push("  'use strict';");
  out.push('');
  out.push('  /* ---------- 原版小 Map 的等价实现 ----------');
  out.push('   * 原版 Map.min.js 会**覆盖全局 Map**（new Set() 都会跟着坏掉，属于历史坑），');
  out.push('   * 这里只做一个内部工厂，不再碰全局名字。API 与原来完全一致：');
  out.push('   * getValue(id) 把空格分隔的值按 fields 展开成对象并附 source；setValue/put/remove/');
  out.push('   * each/toArray/getKeyIndex/hasKey 也都有。 */');
  out.push('  function createDict(fields) {');
  out.push('    const api = {');
  out.push('      fields: fields || null,');
  out.push('      keys: [],');
  out.push('      /* 原版把值直接挂在字典对象上（dict[1] 也能取到），这里保持同样行为 */');
  out.push('      hasKey(id) { return this[id] !== undefined; },');
  out.push('      setValue(id, value) { if (this[id] === undefined) this.keys.push(id); this[id] = value; },');
  out.push('      put(id, value) { this.setValue(id, value); },');
  out.push('      getValue(id) {');
  out.push('        const value = this[id];');
  out.push('        if (value && fields) {');
  out.push('          const row = {};');
  out.push('          for (let i = 0; i < fields.length; i++) row[fields[i]] = value[i];');
  out.push('          row.source = value;');
  out.push('          return row;');
  out.push('        }');
  out.push('        return value;');
  out.push('      },');
  out.push('      remove(id) {');
  out.push('        if (this[id] === undefined) return;');
  out.push('        for (let i = this.keys.length - 1; i >= 0; i--) if (this.keys[i] === id) this.keys.splice(i, 1);');
  out.push('        delete this[id];');
  out.push('      },');
  out.push('      each(fn) { for (let i = 0; i < this.keys.length; i++) fn(this.keys[i], this.getValue(this.keys[i]), i); },');
  out.push('      toArray() { const list = []; this.each((id, value) => list.push(value)); return list; },');
  out.push('      getKeyIndex(id) { for (let i = 0; i < this.keys.length; i++) if (this.keys[i] === id) return i; return -1; },');
  out.push('    };');
  out.push('    return api;');
  out.push('  }');
  out.push('');
  out.push('  /* ---------- 原版数据字典（值按原样保留字符串，读取时再按 fields 拆） ---------- */');
  for (const [name, label] of DICTS) {
    const map = ctx[name];
    if (!map) { out.push('  /* ' + name + '（' + label + '）：原版数据里没有，跳过 */'); continue; }
    const { fields, rows } = dumpDict(map, name, putTable);
    // 键保持原类型（原版 keys 里是数字 1、2、3…，不是字符串）
    const rowsText = rows.map((r) => '[' + (typeof r.key === 'number' ? r.key : JSON.stringify(String(r.key))) + ', ' + jsString(r.raw) + ', ' + jsString(r.sep) + ']').join(',\n      ');
    out.push('  /* ' + label + '：' + rows.length + ' 条 */');
    out.push('  const ' + name + ' = createDict(' + JSON.stringify(fields) + ');');
    out.push('  [\n      ' + rowsText + ',\n  ].forEach(function (row) { ' + name + '.setValue(row[0], row[1].split(row[2])); });');
  }
  out.push('');
  out.push('  /* ---------- 素材清单（engine.js 用 id 找图片路径） ---------- */');
  const asstes = ctx.asstes;
  if (!Array.isArray(asstes)) throw new Error('原版 assets.js 里没有 asstes 数组');
  out.push('  const asstes = [');
  out.push(asstes.map((a) => '    { id: ' + jsString(a.id) + ', size: ' + Number(a.size || 0) + ', src: ' + jsString(a.src) + ' }').join(',\n'));
  out.push('  ];');
  out.push('');
  out.push('  /* ---------- 原版 asset_* 路径表（三侠/木人/新手/logo）----------');
  out.push('   * engine.js 的 buildSrcMap() 是**动态**遍历 window 上 `asset` 前缀的数组来收图片路径的，');
  out.push('   * 所以这里必须保持原来的变量名，不能改名或合并成一个大数组。');
  out.push('   * 名字对不上 = 三侠（tl/xh/xm）等模型整只加载不出来。 */');
  const assetNames = Object.keys(ctx).filter((k) => /^asset/.test(k) && Array.isArray(ctx[k]));
  if (!assetNames.length) throw new Error('原版 asset2.js 里没找到 asset_* 数组');
  for (const name of assetNames) {
    const list = ctx[name];
    const rows = list.map((a) => '{ id: ' + JSON.stringify(String(a.id)) + ', size: ' + Number(a.size || 0) + ', src: ' + JSON.stringify(String(a.src)) + ' }');
    out.push('  const ' + name + ' = [' + (rows.length ? '\n    ' + rows.join(',\n    ') + ',\n  ' : '') + '];');
  }
  out.push('');
  out.push('  /* ---------- 图集帧表 imgMap（engine.js 用它查每一帧在图里的位置）----------');
  out.push('   * 键是图集标签（如 SQ_01 / button1），值是帧数组：[标签, x, y, w, h, regX, regY]；');
  out.push('   * 没有 fields 展开，getValue(key) 原样返回那个数组。 */');
  const imgMap = ctx.imgMap;
  if (!imgMap || !Array.isArray(imgMap.keys)) throw new Error('原版 assets.js 里没有 imgMap');
  out.push('  const imgMap = createDict(null);');
  out.push('  [');
  out.push(imgMap.keys.map((k) => '    [' + JSON.stringify(String(k)) + ', ' + JSON.stringify(imgMap[k]) + ']').join(',\n'));
  out.push('  ].forEach(function (row) { imgMap.setValue(row[0], row[1]); });');
  out.push('');
  out.push('  /* ---------- 动画帧表（engine.js 的动画播放器读它；纯数据，原样搬过来） ---------- */');
  const anim = ctx.AnimationStr;
  if (!anim || typeof anim !== 'object') throw new Error('原版 animationStr.js 里没有 AnimationStr');
  const animKeys = Object.keys(anim);
  out.push('  const AnimationStr = {');
  out.push(animKeys.map((k) => '    ' + JSON.stringify(k) + ': ' + jsString(anim[k])).join(',\n'));
  out.push('  };');
  out.push('');
  out.push('  /* ---------- 挂到全局：与原来 <script> 直接定义这些变量的效果一致 ---------- */');
  out.push('  const exported = { ' + DICTS.map((d) => d[0]).join(', ') + ', asstes, imgMap, AnimationStr, ' + assetNames.join(', ') + ' };');
  out.push('  if (typeof window !== \'undefined\') { for (const k of Object.keys(exported)) window[k] = exported[k]; }');
  out.push('  else { for (const k of Object.keys(exported)) globalThis[k] = exported[k]; }');
  out.push('})();');
  out.push('');
  return out.join('\n');
}

const target = path.join(ROOT, 'js', 'gamedict.js');
const next = build();
if (process.argv.includes('--check')) {
  // references/orig/ 不存在（精简发布包）时没得比，直接跳过
  const hasOrig = ORIG_DIRS.some((d) => fs.existsSync(path.join(d, 'GameDict.js')));
  if (!hasOrig) { console.log('· 跳过：找不到 references/orig/（精简包里没有原版文件，属正常）'); process.exit(0); }
  const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (cur === next) { console.log('✓ js/gamedict.js 是最新的（' + (next.length / 1048576).toFixed(2) + ' MB）'); process.exit(0); }
  console.error('✗ js/gamedict.js 与生成结果不一致，请重新生成：node tools/gen-vendor-data.cjs');
  process.exit(1);
}
fs.writeFileSync(target, next, 'utf8');
console.log('已生成 js/gamedict.js：' + (next.length / 1048576).toFixed(2) + ' MB');
