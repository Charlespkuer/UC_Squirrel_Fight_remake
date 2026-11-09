#!/usr/bin/env node
/* ============================================================
 * tools/test-android-shell.cjs —— 安卓壳生命周期契约
 *
 * 只钉一条可感知规则：**Android 16（HyperOS 3 / 澎湃 3）切后台回来不能黑屏**。
 * 实测（API 36 x86_64 模拟器 / WebView 133）壳里 `onPause()` + `pauseTimers()`
 * 之后回前台，页面永远停在冻结前最后一帧 —— DOM 还在、JS 还能跑，但画面不再
 * 更新（该出现的名字缺字、新加的图层不出现）。修法是 Android 16 起不再冻结，
 * 并在 onResume / onConfigurationChanged 调真实存在的 `window.__ssdzRelayout`
 * （2026-10 之前安卓壳一直在调，但页面没有定义它，iQOO 的重排是空转）。
 *
 * 用法：node tools/test-android-shell.cjs
 * ============================================================ */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function findRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'scripts', 'index.html')) || fs.existsSync(path.join(d, 'index.html'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(start, '..');
}
const ROOT = findRoot(__dirname);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const activity = read('src-tauri/android/MainActivity.kt');
const mainJs = read('js/main.js');
const renderJs = read('js/ssfight/render.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.message || e)); }
}

console.log('安卓壳生命周期');

test('Android 16 回前台不再黑屏：版本闸门在冻结之前，重排钩子在页面里真实存在', () => {
  const freeze = activity.slice(activity.indexOf('private fun freezeWebViewSoon'));
  const freezeBody = freeze.slice(0, freeze.indexOf('private fun thawWebView'));
  const gate = freezeBody.search(/Build\.VERSION\.SDK_INT\s*>=\s*(36|Build\.VERSION_CODES\.BAKLAVA)/);
  const pause = freezeBody.search(/view\.onPause\(\)|view\.pauseTimers\(\)/);
  assert.ok(gate >= 0, 'MainActivity 缺少 Android 16 版本闸门');
  assert.ok(pause > gate, '版本闸门必须在 onPause/pauseTimers 之前 return');
  assert.match(freezeBody, /if \(backgroundRun\) return/, '「后台运行」开关仍要保留');
  assert.match(activity, /view\.onPause\(\)[\s\S]{0,80}view\.pauseTimers\(\)/, 'Android 15 及以下的冻结不能一起删掉');

  const resume = activity.slice(activity.indexOf('override fun onResume'));
  const resumeBody = resume.slice(0, resume.indexOf('override fun onConfigurationChanged'));
  assert.match(resumeBody, /__ssdzRelayout[\s\S]*__ssdzEnterForeground/, 'onResume 应先重排再恢复前台状态');
  const cfg = activity.slice(activity.indexOf('override fun onConfigurationChanged'));
  const cfgBody = cfg.slice(0, cfg.indexOf('override fun onDestroy'));
  assert.match(cfgBody, /relayoutRunnable|__ssdzRelayout/,
    'onConfigurationChanged 必须通知重排（合并连拍后再调 __ssdzRelayout）');
  assert.match(cfgBody, /postDelayed\(relayoutRunnable,\s*80L\)/,
    '连续配置变化要合并成一拍（80ms），不能每拍都重排');

  assert.match(mainJs, /function relayoutNow\(\)[\s\S]*?fitCanvas\(\)/, 'relayoutNow 必须重新 fitCanvas');
  assert.match(mainJs, /window\.__ssdzRelayout\s*=\s*relayoutNow/, '页面必须导出 window.__ssdzRelayout');
  assert.match(mainJs, /dispatchEvent\(new Event\('resize'\)\)/, '必须补发 resize 让覆盖层重排');
  assert.match(mainJs, /androidMajorVersion\(\)\s*>=\s*16[\s\S]*?SfRender\.repaintRaster/, 'Android 16 回前台要重解码 SVG 位图');
  assert.match(renderJs, /function repaintRaster\(\)/, '显示层必须有 repaintRaster');
  assert.match(renderJs, /repaintRaster,/, 'repaintRaster 必须从 SfRender 导出');
});

test('昵称不用 CSS filter 加柔影：Android 16 回前台会把第一个字裁掉', () => {
  const src = read('js/ssfight/ui-main.js');
  const m = /const NAME_STYLE = \[([\s\S]*?)\]\.join\(';'\)/.exec(src);
  assert.ok(m, 'ui-main.js 里找不到 NAME_STYLE');
  assert.doesNotMatch(m[1], /filter\s*:/, 'filter:drop-shadow 会沿用重排前的滤镜区域，把最左一个字裁掉');
  assert.match(m[1], /text-shadow\s*:/, '柔影应走字形层的 text-shadow');
});

test('经典主页挂载失败不能只剩深绿底：看门狗 + 重试 + 空壳判定 + 兜底主页', () => {
  const classic = read('js/classic-ui.js');
  assert.match(classic, /function mountClassicHome\(box, attempt\)/, '经典主页挂载必须走带恢复的 mountClassicHome');
  assert.match(classic, /setTimeout\(\(\) => finish\(new Error\('挂载超时'\)\)/, '挂载必须有看门狗，不能无限等');
  assert.match(classic, /box\.remove\(\)/, '失败时先摘掉不透明空壳，否则 canvas 主页永远被盖住');
  assert.match(classic, /attempt < 2[\s\S]{0,600}mountClassicHome\(host, attempt \+ 1\)/, '挂载失败要重试');
  assert.match(classic, /forceDomHome = true[\s\S]{0,120}renderHome\(\)/, '首次失败就要退回可点的复刻主页（后台继续重试）');
  assert.match(mainJs, /function ssfightHomeActive\(\)[\s\S]{0,400}querySelector\('svg'\)/, 'ssfightHomeActive 不能只看壳在不在');
  assert.match(renderJs, /async function fetchJson\(file, noCache\)[\s\S]{0,200}no-store/, '素材 JSON 失败要绕开缓存重取一次');
  /* 2026-11 残余绿屏：mount 成功但 SVG 0×0 / 被挤出画面时，只数子节点会误判成「挂好了」。 */
  assert.match(classic, /function classicHomeHasArt\(box\)[\s\S]{0,900}getBoundingClientRect\(\)[\s\S]{0,400}< br\.width \* br\.height \* 0\.45/, '可见性判定必须量几何，不能只数子节点');
  assert.match(classic, /function scheduleClassicHomeVerify\(box, seq\)[\s\S]{0,900}repaintRaster/, '挂载成功后要复查并补一次重解码');
  assert.match(classic, /function failClassicHomeVisible\(box, seq, why\)[\s\S]{0,300}forceDomHome = true/, '几何异常要退回复刻主页');
  assert.match(classic, /classicHomeEscapeHatch[\s\S]{0,1200}pointerdown[\s\S]{0,1400}已切到安全模式/, '要有左上角连点 3 次的安全模式逃生口');
});

test('Android 16 / Adreno 绿屏：原生软件图层逃生口 + 经典主页先用原版底图占位', () => {
  /* Chromium 576362369：Android 16 + Adreno 的 WebView 在 Vulkan 合成路径会整块丢贴图层，
   * 页面只剩 CSS 底色 / 文字 / 悬浮 DOM。原生层显式落软件图层绕开，且只对已知风险 SoC 自动开。 */
  assert.match(activity, /fun shouldUseSoftwareRenderer\(\)[\s\S]{0,800}SOC_MODEL[\s\S]{0,400}SM8850/, '原生壳要按 Android 16 + SoC 自动判定');
  /* 自动档只覆盖现场确认过绿屏的整机；1.1.6 把 8 Gen 2/3 等也一并落到软件层，
   * 1.1.7 又把整个 SM8850 家族按到软件层 —— 这些原本能玩的机器更新后变成严重卡顿。
   * 1.1.8 起 SoC 只是第一道闸，整机型号（K90 Pro Max / MagicPad3 Pro）才决定自动开。 */
  {
    const fn = activity.slice(activity.indexOf('private fun shouldUseSoftwareRenderer'),
      activity.indexOf('private fun applySoftwareRender'));
    const known = /val known = listOf\(([^)]*)\)/.exec(fn);
    assert.ok(known, '自动档 SoC 名单要写成 listOf(...)');
    assert.deepEqual((known[1].match(/"[^"]+"/g) || []), ['"SM8850"'],
      '自动档只保留现场确认过绿屏的 SM8850，不能按 SoC 代际一刀切');
    assert.match(fn, /Build\.MODEL[\s\S]{0,200}names/, '同 SoC 还要按整机型号再筛一次（不能让整个 SM8850 家族都落软件层）');
    assert.match(fn, /names\.contains\("k90"\)/, 'K90 Pro Max 要命中自动档');
    assert.match(fn, /names\.contains\("magicpad3"\)/, 'MagicPad3 Pro 要命中自动档');
  }
  assert.match(activity, /setLayerType\(if \(enabled\) View\.LAYER_TYPE_SOFTWARE/, '要显式切到软件图层');
  assert.match(activity, /RenderBridge[\s\S]{0,500}setSoftwareRender/, '要保留 JS 逃生桥（设置页可手动切换）');
  assert.match(activity, /addJavascriptInterface\(RenderBridge\(\), "SSDZRender"\)/, '桥必须注入到页面');
  assert.match(mainJs, /function applyCompatRender\(\)[\s\S]{0,500}SSDZRender[\s\S]{0,120}setSoftwareRender/, '页面设置要能驱动原生软件图层');
  const classic = read('js/classic-ui.js');
  assert.match(classic, /classic-home ssfight-home ssfight-home-loading/, '经典主页挂载期间要有 loading 占位类');
  assert.match(read('css/classic.css'), /\.ssfight-home\.ssfight-home-loading\{[^}]*3182_0\.hd\.jpg/, '占位层必须用原版村庄底图，不能露出现代 canvas 松鼠');
});

test('老 WebView（Android 11 / Chromium 8x）兼容：整屏绝对层不依赖 inset 简写', () => {
  const fsMod = require('node:fs');
  const cssDir = path.join(ROOT, 'css');
  const declRe = /(^|[;{\n]\s*)inset\s*:\s*([^;}]+)(;?)/g;
  const valueRe = /^-?\d+(?:\.\d+)?(?:px|%)?(?:\s+-?\d+(?:\.\d+)?(?:px|%)?){0,3}$/;
  let checked = 0;
  for (const f of fsMod.readdirSync(cssDir).filter((x) => x.endsWith('.css'))) {
    const text = fsMod.readFileSync(path.join(cssDir, f), 'utf8');
    let m;
    while ((m = declRe.exec(text))) {
      if (!valueRe.test(m[2].trim())) continue;      // 注释里的 "inset:0` —— …" 不算声明
      checked++;
      const before = text.slice(Math.max(0, m.index - 240), m.index);
      assert.match(before, /(^|[;{\s])top\s*:/, `${f} 的 inset:${m[2].trim()} 缺 top 长写回退（Chromium <87 整层会塌成 0×0）`);
      assert.match(before, /(^|[;{\s])left\s*:/, `${f} 的 inset:${m[2].trim()} 缺 left 长写回退`);
    }
  }
  assert.ok(checked >= 30, 'inset 声明数量异常：只检查到 ' + checked + ' 条');
  const boot = mainJs.slice(mainJs.indexOf('async function boot()'), mainJs.indexOf('async function boot()') + 600);
  assert.match(boot, /applySystemBars\(\)/, '标题页也要先落一次沉浸（Android 11 三键导航会占掉一条）');
});

console.log('');
if (failed) { console.log(`${passed} passed, ${failed} failed`); process.exit(1); }
console.log(`全部通过：${passed}/${passed}`);
