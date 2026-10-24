#!/usr/bin/env node
/* ============================================================
 * tools/build-web.cjs —— 生成网页版 / PWA 静态站点
 *
 * 用法：
 *   node tools/build-web.cjs                 # 输出 dist-web/
 *   node tools/build-web.cjs --out _site     # GitHub Pages 工作流用
 *
 * 做的事情：
 *   1. 复制 scripts/index.html → index.html，并注入 PWA meta、web mode 标记和 pwa.js；
 *   2. 复制 css/ js/ images/ audio/（跳过 images/_reference、.DS_Store、node_modules）；
 *   3. 复制 web-pwa/manifest.webmanifest、web-pwa/icons、web-pwa/pwa.js；
 *   4. 把 sw.js 模板里的 __CORE_ASSETS__ / __SW_VERSION__ 替换成实际清单；
 *   5. 复制 scripts/version.json。
 *
 * 产出目录是纯静态文件，可直接丢给 GitHub Pages / Cloudflare Pages / OSS+CDN。
 * 不依赖第三方包；Node 18+。
 * ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const PWA = path.join(ROOT, 'web-pwa');
const ARGS = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = ARGS.indexOf(name);
  return i >= 0 && i + 1 < ARGS.length ? ARGS[i + 1] : fallback;
};
const has = (name) => ARGS.includes(name);
const OUT = path.resolve(ROOT, argValue('--out', 'dist-web'));

function fail(msg) {
  console.error('\n[x] ' + msg);
  process.exit(1);
}
function info(msg) { console.log('— ' + msg); }
function ok(msg) { console.log('✓ ' + msg); }

function usage() {
  console.log(`松鼠大战网页版 / PWA 构建

用法：
  node tools/build-web.cjs                 输出 dist-web/
  node tools/build-web.cjs --out _site     指定输出目录

产出：
  index.html  manifest.webmanifest  sw.js  version.json
  css/  js/  images/  audio/  icons/

说明：
  · 网页版存档在浏览器 localStorage，和 Tauri 原生包的 App 容器不互通；
  · 玩家从旧企业版迁移时，先在游戏里「系统 → 导入存档」导入救援 JSON；
  · 部署必须用 HTTPS（Service Worker 要求；localhost 例外）。
`);
}

function isIgnored(src) {
  const base = path.basename(src);
  if (base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini') return true;
  if (base === 'node_modules' || base === '.git' || base === '__pycache__') return true;
  const rel = path.relative(ROOT, src).split(path.sep);
  if (rel.includes('_reference')) return true;
  return false;
}

function copyTree(from, to) {
  if (!fs.existsSync(from)) fail('缺少目录：' + from);
  fs.cpSync(from, to, { recursive: true, filter: (src) => !isIgnored(src) });
}

function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile() && p.toLowerCase().endsWith(ext)) out.push(p);
    }
  }
  return out.sort();
}

function toUrl(abs) {
  return './' + path.relative(OUT, abs).split(path.sep).join('/');
}

function readVersion() {
  const file = path.join(SCRIPTS, 'version.json');
  if (!fs.existsSync(file)) return { version: 'dev' };
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : { version: 'dev' };
  } catch (e) {
    return { version: 'dev' };
  }
}

function writeIndex() {
  const src = path.join(SCRIPTS, 'index.html');
  if (!fs.existsSync(src)) fail('找不到网页入口：' + src);
  let html = fs.readFileSync(src, 'utf8');
  if (!html.includes('</head>')) fail('scripts/index.html 里找不到 </head>');
  if (!html.includes('</body>')) fail('scripts/index.html 里找不到 </body>');

  const head = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
    '<meta name="theme-color" content="#173b2a">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="松鼠大战">',
    '<script>window.__SSDZ_WEB_MODE__=true;</script>',
  ].join('\n');
  html = html.replace('</head>', head + '\n</head>');
  html = html.replace('</body>', '<script src="js/pwa.js" defer></script>\n</body>');
  fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
}

function writeServiceWorker(core, version) {
  const template = path.join(PWA, 'sw.js');
  if (!fs.existsSync(template)) fail('找不到 Service Worker 模板：' + template);
  let sw = fs.readFileSync(template, 'utf8');
  sw = sw.split('__SW_VERSION__').join(version);
  sw = sw.split('__CORE_ASSETS__').join(JSON.stringify(core, null, 2));
  if (sw.includes('__SW_VERSION__') || sw.includes('__CORE_ASSETS__')) {
    fail('Service Worker 模板里还有未替换的占位符。');
  }
  fs.writeFileSync(path.join(OUT, 'sw.js'), sw, 'utf8');
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile()) total += fs.statSync(p).size;
    }
  }
  return total;
}

function main() {
  if (has('--help') || has('-h')) { usage(); return; }
  for (const p of [path.join(PWA, 'manifest.webmanifest'), path.join(PWA, 'sw.js'),
    path.join(PWA, 'pwa.js'), path.join(PWA, 'icons')]) {
    if (!fs.existsSync(p)) fail('缺少 PWA 资源：' + p);
  }

  console.log('松鼠大战 · 网页版 / PWA 构建');
  info('输出：' + OUT);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  info('复制 css / js / images / audio（跳过 _reference）');
  copyTree(path.join(ROOT, 'css'), path.join(OUT, 'css'));
  copyTree(path.join(ROOT, 'js'), path.join(OUT, 'js'));
  copyTree(path.join(ROOT, 'images'), path.join(OUT, 'images'));
  copyTree(path.join(ROOT, 'audio'), path.join(OUT, 'audio'));

  info('写入 index.html（PWA meta + web mode）');
  writeIndex();

  const versionInfo = readVersion();
  const versionFile = path.join(SCRIPTS, 'version.json');
  // 根 version.json 给静态页/部署用；scripts/version.json 给游戏里的更新检查用
  // （经典 UI 会按源码里的相对路径 fetch('scripts/version.json')）。
  fs.mkdirSync(path.join(OUT, 'scripts'), { recursive: true });
  if (fs.existsSync(versionFile)) {
    fs.copyFileSync(versionFile, path.join(OUT, 'version.json'));
    fs.copyFileSync(versionFile, path.join(OUT, 'scripts', 'version.json'));
  } else {
    fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify(versionInfo, null, 2), 'utf8');
    fs.writeFileSync(path.join(OUT, 'scripts', 'version.json'), JSON.stringify(versionInfo, null, 2), 'utf8');
  }
  const version = String(versionInfo.version || 'dev').replace(/[^\w.-]/g, '_') +
    '-' + String(versionInfo.commit || '').replace(/[^\w.-]/g, '_') +
    '-' + Date.now().toString(36);

  info('复制 PWA 资源');
  fs.copyFileSync(path.join(PWA, 'manifest.webmanifest'), path.join(OUT, 'manifest.webmanifest'));
  copyTree(path.join(PWA, 'icons'), path.join(OUT, 'icons'));
  fs.copyFileSync(path.join(PWA, 'pwa.js'), path.join(OUT, 'js', 'pwa.js'));

  const core = [
    './',
    './index.html',
    './manifest.webmanifest',
    './version.json',
    './scripts/version.json',
    ...walk(path.join(OUT, 'css'), '.css').map(toUrl),
    ...walk(path.join(OUT, 'js'), '.js').map(toUrl),
    ...walk(path.join(OUT, 'icons'), '.png').map(toUrl),
  ];
  writeServiceWorker(core, version);

  const mb = (dirSize(OUT) / 1024 / 1024).toFixed(1) + ' MB';
  ok('网页版站点：' + OUT + '（' + mb + '）');
  console.log('  PWA：manifest.webmanifest / sw.js / icons（' + core.length + ' 个预缓存文件）');
  console.log('  版本：' + version);
  console.log('');
  console.log('部署：');
  console.log('  · GitHub Pages：Settings → Pages → Source 选 GitHub Actions，工作流会跑本脚本；');
  console.log('  · Cloudflare Pages / 国内静态托管：构建命令 node tools/build-web.cjs，输出目录 dist-web；');
  console.log('  · 必须 HTTPS；玩家用 Safari 打开，分享 → 添加到主屏幕。');
}

try { main(); } catch (e) {
  console.error('\n[x] ' + (e && e.stack || e));
  process.exit(1);
}
