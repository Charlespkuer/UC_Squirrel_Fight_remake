/* ============================================================
 * 网页版 / PWA 启动脚本
 *
 * 只由 tools/build-web.cjs 注入到网页构建的 index.html；
 * Tauri 桌面/安卓/iOS 原生包不会加载它。
 *
 * 职责：
 *   1. 标记 window.__SSDZ_WEB_MODE__，让 main.js / classic-ui.js 按“网页版存档”
 *      显示文案，而不是把静态托管当成“本地服务器没开”的错误；
 *   2. 在 HTTPS / localhost 下注册 sw.js。
 * ============================================================ */
(function () {
  'use strict';
  window.__SSDZ_WEB_MODE__ = true;

  var secure = location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]';
  if (!secure || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      try {
        if (reg.waiting) window.__SSDZ_PWA_WAITING__ = true;
        reg.addEventListener('updatefound', function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              // 新版本已装好，但旧页面还在用旧缓存；下次从主屏幕/标签页打开时生效。
              window.__SSDZ_PWA_WAITING__ = true;
            }
          });
        });
      } catch (e) { /* 更新提示只是锦上添花 */ }
    }).catch(function () { /* Safari 隐私模式/不支持时静默 */ });
  });
})();
