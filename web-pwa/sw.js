/* ============================================================
 * 松鼠大战 PWA Service Worker（模板）
 *
 * 这个文件由 tools/build-web.cjs 复制到站点根 sw.js，并把两个版本/清单占位符
 * 替换成本次构建的缓存版本和实际的核心文件数组（占位符只出现在下面的常量里）。
 *
 * 缓存策略：
 *   · 页面导航：network-first，断网回退缓存的 index.html；
 *   · HTML / JS / CSS / version.json：network-first（保证更新），失败回退缓存；
 *   · 图片 / 音频 / 字体：cache-first + 运行时缓存（看过的才缓存）；
 *   · 只处理同源 GET；Range 请求与 __save 直接放行。
 *
 * 首页/脚本/样式会预缓存（约几 MB），所以断网也能启动到标题页；
 * 图片/音频不全量预缓存（全站 100+ MB），第一次看某个场景仍然需要网络，
 * 看过之后才会进入运行时缓存。
 * ============================================================ */
'use strict';

const VERSION = '__SW_VERSION__';
const CORE_CACHE = 'ssdz-core-' + VERSION;
const RUNTIME_CACHE = 'ssdz-runtime-' + VERSION;
const CORE = __CORE_ASSETS__;
const RUNTIME_MAX = 400;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    // 逐个 add：某个资源 404 不应让整个 SW 安装失败。
    await Promise.all(CORE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (e) { /* 单个失败忽略 */ }
    }));
    // 首次安装立即接管；版本更新时等待旧页面全部关闭，避免新旧 JS 混用。
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 只清本项目的缓存：GitHub Pages 的项目站点共享 charlespkuer.github.io 这个 origin，
    // 无差别删除会把同 origin 下其它项目的 PWA 缓存也删掉。
    await Promise.all(keys
      .filter((key) => key.startsWith('ssdz-') && key !== CORE_CACHE && key !== RUNTIME_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  // 音频拖动会带 Range；部分缓存实现不支持 206，直接交给网络。
  if (req.headers.has('range')) return;
  // 静态站没有 __save；即使以后接了后端也不要缓存它。
  if (url.pathname.endsWith('/__save') || url.pathname.includes('/__save')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, CORE_CACHE, './index.html'));
    return;
  }

  if (url.pathname.endsWith('/version.json') || /\.(?:html|js|css)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(req, CORE_CACHE));
    return;
  }

  if (/\.(?:png|jpe?g|webp|gif|svg|ico|mp3|ogg|wav|m4a|woff2?|ttf|otf)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
  }
});

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    // no-cache：向服务器 revalidate，避免 GitHub Pages 的 HTTP 缓存把旧 HTML/JS 又塞回新 SW 缓存。
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) await cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return new Response('离线，且这个资源还没有缓存。', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok && res.type === 'basic') {
    await cache.put(req, res.clone());
    await trim(cache, RUNTIME_MAX);
  }
  return res;
}

async function trim(cache, max) {
  try {
    const keys = await cache.keys();
    if (keys.length <= max) return;
    for (const key of keys.slice(0, keys.length - max)) await cache.delete(key);
  } catch (e) { /* 清旧缓存失败不影响本次请求 */ }
}
