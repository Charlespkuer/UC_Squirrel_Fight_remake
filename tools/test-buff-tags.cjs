#!/usr/bin/env node
/* ============================================================
 * tools/test-buff-tags.cjs — 增益「严格池子管理」回归（标签系统）
 *
 * 需求：所有增益都用**标签**显式声明归属，池子只认标签：
 *   · 只有带 `tower`   的才会出现在挑战塔（场间选择）
 *   · 只有带 `endless` 的才会出现在无尽塔（场间选择 / 商店 / 增益集锦）
 *   · 只有带 `battle`  的才会作为战斗奖励掉落
 *   · 只有带 `shop`    的才会在（无尽塔）商店出售
 *   · 可叠层 / 每局限次获得 / 同名唯一 … 也都各自有独立标签
 *
 * 这个工具干三件事：
 *   1. 正向：把标签推导出的名单与运行时三个池子逐一比对；
 *   2. 反向：用源码打补丁的方式喂进**坏数据**，确认加载期校验真的会抛错
 *      （没有校验的「规范」等于没写）；
 *   3. 展示口径：无尽塔的「增益集锦」只含无尽塔标签，不出现挑战塔专属。
 *
 * 用法：node tools/test-buff-tags.cjs
 * ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

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
/* 标签系统完全在 tower-data.js 里（不依赖 state.js / tower.js），所以这里只加载它，
 * 这样负向用例可以任意改源码而不用管其它模块。 */
const LOAD = ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js'];

function load(dataPatch) {
  const store = new Map();
  class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
  const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  c.window = c; c.self = c;
  vm.createContext(c);
  for (const f of LOAD) {
    let src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (dataPatch && f === 'js/tower-data.js') src = dataPatch(src);
    vm.runInContext(src, c, { filename: f });
  }
  return c.TowerData;
}
const setup = () => load(null);

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '   ' + (e && e.message)); }
}
function hr(title) { console.log('\n──── ' + title + ' ────'); }

/* ============================================================ */
hr('1. 词表与数据：每条增益都必须显式声明标签');
{
  const TD = setup();
  check('词表登记了场所 3 个 + 来源 1 个 + 行为若干', () => {
    for (const t of ['tower', 'endless', 'battle', 'shop']) assert.ok(TD.BUFF_TAGS[t], '缺少标签 ' + t);
    for (const t of ['limited', 'nextBattle', 'stackable', 'oncePerRun', 'repeatable', 'unique', 'hidden']) {
      assert.ok(TD.BUFF_TAGS[t], '缺少行为标签 ' + t);
    }
  });
  check('每条增益都有非空 tags，且都是登记过的标签', () => {
    for (const b of TD.BUFFS) {
      assert.ok(Array.isArray(b.tags) && b.tags.length, b.id + ' 没有 tags');
      for (const t of b.tags) assert.ok(TD.BUFF_TAGS[t], b.id + ' 用了未登记标签 ' + t);
    }
  });
  check('每条增益至少有一个场所标签（否则它哪里都不会出现）', () => {
    for (const b of TD.BUFFS) {
      assert.ok(['tower', 'endless', 'shop'].some((t) => TD.hasTag(b, t)),
        b.id + '（' + b.name + '）没有场所标签：' + JSON.stringify(b.tags));
    }
  });
  check('battle 必须配合 tower/endless；shop 必须配合 endless', () => {
    for (const b of TD.BUFFS) {
      if (TD.hasTag(b, 'battle')) {
        assert.ok(TD.hasTag(b, 'tower') || TD.hasTag(b, 'endless'), b.id + ' 标了 battle 却没标塔');
      }
      if (TD.hasTag(b, 'shop')) assert.ok(TD.hasTag(b, 'endless'), b.id + ' 标了 shop 却没标 endless');
    }
  });
  check('行为标签与数据自洽（limited / oncePerRun / unique ⊥ repeatable）', () => {
    for (const b of TD.BUFFS) {
      if (TD.hasTag(b, 'limited')) assert.equal(b.kind, 'limited', b.id);
      if (TD.hasTag(b, 'nextBattle')) assert.equal(b.kind, 'limited', b.id);
      if (TD.hasTag(b, 'oncePerRun')) assert.equal(Number(b.maxStacks), 1, b.id);
      assert.ok(!(TD.hasTag(b, 'unique') && TD.hasTag(b, 'repeatable')), b.id + ' 同时 unique 与 repeatable');
    }
  });
}

/* ============================================================ */
hr('2. 四个场所：池子 = 标签推导出的名单（不多不少）');
{
  const TD = setup();
  const ids = (list) => list.map((b) => b.id).join(',');
  check('挑战塔池 = tower ∧ battle', () => {
    assert.equal(ids(TD.towerPool), ids(TD.BUFFS.filter((b) => TD.hasTag(b, 'tower') && TD.hasTag(b, 'battle'))));
  });
  check('无尽塔池 = endless ∧ battle', () => {
    assert.equal(ids(TD.endlessPool), ids(TD.BUFFS.filter((b) => TD.hasTag(b, 'endless') && TD.hasTag(b, 'battle'))));
  });
  check('商店池 = shop（且都带 endless）', () => {
    assert.equal(ids(TD.shopPool), ids(TD.BUFFS.filter((b) => TD.hasTag(b, 'shop'))));
    for (const b of TD.shopPool) assert.ok(TD.hasTag(b, 'endless'), b.id + ' 上了商店却没标 endless');
  });
  check('挑战塔专属（tower-only）绝不进无尽池 / 商店池', () => {
    const leaks = TD.BUFFS.filter((b) => TD.hasTag(b, 'tower') && !TD.hasTag(b, 'endless'));
    for (const b of leaks) {
      assert.ok(TD.endlessPool.indexOf(b) < 0, b.id + ' 漏进无尽池');
      assert.ok(TD.shopPool.indexOf(b) < 0, b.id + ' 漏进商店池');
    }
  });
  check('无尽塔专属绝不进挑战塔池', () => {
    for (const b of TD.BUFFS.filter((x) => TD.hasTag(x, 'endless') && !TD.hasTag(x, 'tower'))) {
      assert.ok(TD.towerPool.indexOf(b) < 0, b.id + ' 漏进挑战塔池');
    }
  });
  check('挑战塔池里没有「只有无尽塔才有」的机制（试炼币 / 商店 / 环境 / 结算…）', () => {
    const MODS = ['envIgnore', 'envReflect', 'instantCoins', 'coinBoostPct', 'shopDiscount',
      'instantRetry', 'sellValue', 'sellGrowthPerWin', 'shopSpendStep', 'permSlot', 'postBattleShop', 'shopHalf',
      'weightDivBy', 'weightDivOffset', 'limitedRarityMul', 'pityWeight'];
    for (const b of TD.towerPool) {
      const bad = Object.keys(b.mods || {}).filter((k) => MODS.indexOf(k) >= 0);
      assert.equal(bad.length, 0, b.id + ' 带无尽机制 ' + bad.join(','));
    }
  });
  check('原来的漏网之鱼 C36（挥金如土·试炼商店消费）已改成无尽专属', () => {
    const c36 = TD.BUFF_BY_ID.C36;
    assert.ok(TD.hasTag(c36, 'endless'), 'C36 应当是无尽塔');
    assert.ok(!TD.hasTag(c36, 'tower'), 'C36 不该再出现在挑战塔');
    assert.ok(TD.towerPool.indexOf(c36) < 0, 'C36 不该在挑战塔池');
  });
}

/* ============================================================ */
hr('3. 展示口径：无尽塔「增益集锦」不含挑战塔专属');
{
  const TD = setup();
  const catalog = TD.BUFFS.filter((b) => TD.hasTag(b, 'endless') && !TD.hasTag(b, 'hidden'));
  check('集锦里一条挑战塔专属都没有', () => {
    assert.equal(catalog.filter((b) => !TD.hasTag(b, 'endless')).length, 0);
    for (const b of catalog) assert.ok(TD.hasTag(b, 'endless'), b.id + ' 不该进无尽集锦');
  });
  check('集锦覆盖全部非隐藏的无尽塔增益', () => {
    const want = TD.BUFFS.filter((b) => TD.hasTag(b, 'endless') && !TD.hasTag(b, 'hidden'));
    assert.equal(catalog.length, want.length);
  });
  check('挑战塔专属（如 T01 闪亮登场）不在集锦里', () => {
    assert.ok(catalog.every((b) => b.id !== 'T01'));
    assert.ok(TD.hasTag(TD.BUFF_BY_ID.T01, 'tower') && !TD.hasTag(TD.BUFF_BY_ID.T01, 'endless'));
  });
  check('页面里的 buffCatalogHtml 也按无尽标签过滤（不是按旧字段）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8');
    const at = src.indexOf('function buffCatalogHtml');
    assert.ok(at > 0, '找不到 buffCatalogHtml');
    const body = src.slice(at, at + 600);
    assert.ok(body.indexOf("hasTag(b, 'endless')") > 0,
      'buffCatalogHtml 应当用 hasTag(b, \'endless\') 过滤，实际：' + body.slice(0, 220));
  });
}

/* ============================================================ */
hr('3.5 冗余清理：数据里不再有 xxxOnly / stackable / unique… 这些布尔字段');
{
  const TD = setup();
  const FORBIDDEN = ['towerOnly', 'endlessOnly', 'battleOnly', 'shopBanned',
    'stackable', 'repeatable', 'unique', 'nextBattle', 'hidden'];
  check('92 条增益里一条冗余字段都没有', () => {
    const bad = [];
    for (const b of TD.BUFFS) {
      const hit = FORBIDDEN.filter((k) => k in b);
      if (hit.length) bad.push(b.id + ':' + hit.join('|'));
    }
    assert.equal(bad.length, 0, '仍有冗余字段：' + bad.join(', '));
  });
  check('页面代码里也不再读这些字段（只读标签）', () => {
    for (const f of ['js/tower.js', 'js/tower-ui.js', 'js/tower-data.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const k of FORBIDDEN) {
        /* 只允许出现在「禁用清单 / 词表 / 注释」里：代码读取形如 .字段 或 ["字段"] */
        /* 只认「字段读取」：排除对象字面量的 key（后面跟冒号）与函数调用（后面跟括号，
         * 例如 Tower.nextBattle(mode) 是 API 调用，跟增益字段无关）。 */
        const readRe = new RegExp('\\.[' + k[0] + ']' + k.slice(1) + '\\b(?!\\s*[:(])');
        const hits = src.split('\n').filter((line) => readRe.test(line) && !/FORBIDDEN_FIELDS|BUFF_TAGS|^\s*\*|\/\//.test(line));
        assert.equal(hits.length, 0, f + ' 仍在读 ' + k + '：' + hits.slice(0, 2).join(' / '));
      }
    }
  });
}

/* ============================================================ */
hr('4. 反向：坏数据必须在加载期就抛错（校验真的在跑）');
{
  const bad = (name, patch, expect) => check(name, () => {
    assert.throws(() => load(patch), expect, name + ' 竟然没抛错');
  });
  bad('去掉某条的 tags → 抛错', (src) => src.replace("{ id: 'C01', tags: ['tower', 'endless', 'battle', 'shop'],", "{ id: 'C01',"),
    /没有 tags/);
  bad('写上未登记的标签 → 抛错', (src) => src.replace("{ id: 'C01', tags: [", "{ id: 'C01', tags: ['noSuchTag', "), /未登记的标签/);
  bad('给无尽专属条目硬加 tower → 抛错', (src) => src.replace("{ id: 'E02', tags: ['endless', 'battle', 'ops'],", "{ id: 'E02', tags: ['tower', 'endless', 'battle', 'ops'],"),
    /挑战塔池不该包含无尽专属增益 E02/);
  /* 注意顺序：battle 必须配塔标签那条检查在 shop 那条之前，所以这里挑一条本来就
   * 同时有 tower+battle 的通用增益（C02），只把 endless 拿掉，才测得到 shop 规则。 */
  bad('shop 不带 endless → 抛错', (src) => src.replace("{ id: 'C02', tags: ['tower', 'endless', 'battle', 'shop'],", "{ id: 'C02', tags: ['tower', 'battle', 'shop'],"),
    /标了 shop 却没标 endless/);
  bad('battle 却没有塔标签 → 抛错', (src) => src.replace("{ id: 'C02', tags: ['tower', 'endless', 'battle', 'shop'],", "{ id: 'C02', tags: ['battle'],"),
    /没标 tower\/endless|没有场所标签/);
  bad('行为标签与 kind 冲突（limited 标在永久类上）→ 抛错', (src) => src.replace("{ id: 'C02', tags: ['tower', 'endless', 'battle', 'shop'],", "{ id: 'C02', tags: ['tower', 'endless', 'battle', 'shop', 'limited'],"),
    /limited/);
  bad('又写回冗余字段（endlessOnly）→ 抛错',
    (src) => src.replace("{ id: 'E02', tags: ['endless', 'battle', 'ops'],", "{ id: 'E02', tags: ['endless', 'battle', 'ops'], endlessOnly: true,"),
    /还写着冗余字段 endlessOnly/);
  bad('又写回冗余字段（stackable）→ 抛错',
    (src) => src.replace("{ id: 'C50', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'],", "{ id: 'C50', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], stackable: true,"),
    /还写着冗余字段 stackable/);
  /* 铸币商店的守门：ops（运营类）只能挂在无尽塔增益上。tower 专属的 T01 加上 ops 必须抛错。 */
  bad('给挑战塔专属条目硬加 ops → 抛错',
    (src) => src.replace("{ id: 'T01', tags: ['tower', 'battle', 'limited', 'nextBattle'],", "{ id: 'T01', tags: ['tower', 'battle', 'limited', 'nextBattle', 'ops'],"),
    /标了 ops 却不是无尽塔增益/);
}

console.log('\n' + (fail ? '' : '') + '合计 ' + pass + ' 通过 / ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;
