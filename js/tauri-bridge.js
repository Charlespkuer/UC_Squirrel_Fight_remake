/* ============================================================
 * js/tauri-bridge.js —— 桌面 / 移动外壳（Tauri）里的存档通道
 *
 * 三种运行方式：
 *   1. **轻壳模式**（桌面默认）：外壳自带迷你文件服务器，窗口打开 http://127.0.0.1:<端口>/index.html，
 *      存档走和网页版**完全一样**的 `/__save`（写 <游戏目录>/save/progress.json）。
 *      Tauri 也会往页面里注入 window.__TAURI__，但那边调用命令会被 ACL 拒绝
 *      （"Command save_meta not allowed by ACL"），而且本来就不需要，所以这里必须跳过。
 *   2. **桌面安装包模式**：页面来自 Tauri 的资源协议——Windows 上是 `http://tauri.localhost/`，
 *      macOS/Linux 上是 `tauri://localhost`——旁边没有游戏目录、也没有 `/__save`，
 *      这时才改用 Rust 端命令读写存档（Windows: %APPDATA%\com.ssdz.classic\save\progress.json）。
 *   3. **移动端（Android/iOS）**：前端嵌在安装包里，同样是资源协议（Android 上是
 *      `http://tauri.localhost/`），存档写应用私有目录（/data/user/0/<包名>/save/progress.json）。
 *      ⚠️ 移动端上 window.__TAURI__ 是**异步注入**的：本文件在页面解析阶段执行时
 *      它往往还不存在，所以必须轮询等它（见下面的 setInterval）。
 *
 * 判断依据：**只有「带端口的 127.0.0.1 / localhost」才是我们自己的服务器**，其余交给 Tauri。
 * （早先只看 `tauri:` 协议，Windows 安装版的 `http://tauri.localhost/` 就漏掉了，
 *   结果是安装版存档莫名退回 localStorage。）网页版（含 file:// 调试）永远不受影响。
 *
 * 诊断：默认静默。要看存档通道到底通没通，加 ?ssdzdbg=1 打开页面
 * （把关键信息写进 document.title 并打到 console；Android 上可用
 *   adb logcat | findstr ssdz-bridge  看到）。
 * ============================================================ */
(function () {
  'use strict';
  var host = ((window.location && window.location.hostname) || '').toLowerCase();
  var port = (window.location && window.location.port) || '';
  var viaOwnServer = (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') && !!port;

  /** 诊断开关：?ssdzdbg=1 打开（移动端排查存档时用）。 */
  var DBG = /[?&]ssdzdbg=1(?:&|$)/.test((window.location && window.location.search) || '');
  function diag(msg) {
    if (!DBG) return;
    try {
      document.title = '[DBG] ' + msg;
      console.log('[ssdz-bridge] ' + msg);
    } catch (e) {}
  }

  /* ============================================================
   * 原生桥没接上时的**可见诊断**（iQOO/vivo 这类国产 ROM 的专项取证）
   *
   * 用户口径（2026-10）："iQOO 手机上安卓包读不到本体，只能走保底路径，而且保底路径下
   * 大量图像无法显示"。外壳这边能确定的是：页面来自 `tauri.localhost` 却没拿到
   * `__TAURI__/__TAURI_INTERNALS__` 的 invoke —— 于是存档只能退回浏览器兜底。
   * 但**图像为什么缺**在桌面上复现不出来，必须拿到真机的一组事实：
   *   · WebView 内核版本（老内核缺 structuredClone / :has 之类会直接报错）
   *   · 页面 URL / 协议（是不是被 ROM 的"网页加速"改写）
   *   · 图片加载失败的数量与前几张的路径（判断是整站 404 还是个别文件）
   *   · 首个 JS 报错
   * 这里把这几项摊在页面上（不挡住游戏，可关闭），并有 `window.__ssdzDiag()` 供 adb 取值。
   * ============================================================ */
  var diagShown = false;
  /* 图片/脚本加载失败采集：capture 阶段拿 error 事件（这些 error 不冒泡）。
   * 只记路径与数量，够判断"整站 404"还是"个别文件"。 */
  try {
    window.__ssdzFailedImages = { list: [] };
    window.addEventListener('error', function (ev) {
      var t = ev && ev.target;
      if (!t || !t.tagName) return;
      var tag = String(t.tagName).toUpperCase();
      if (tag !== 'IMG' && tag !== 'SCRIPT' && tag !== 'LINK') return;
      var src = t.src || t.href || '';
      var list = window.__ssdzFailedImages.list;
      if (list.length < 40) list.push(tag.toLowerCase() + ':' + String(src).replace(location.origin, '').slice(0, 80));
    }, true);
  } catch (e) {}
  try { window.__ssdzDiag = function (why) { return diagInfo(why); }; } catch (e) {}

  if (viaOwnServer) {
    // 轻壳 / 手动起的本地服务器：用 /__save，和网页版同一条路
    diag('走本地服务器 /__save');
    return;
  }

  /** Tauri v2 的全局 API 有两种形态：`withGlobalTauri` 的 `__TAURI__.core.invoke`，
   *  以及内核始终会放的 `__TAURI_INTERNALS__.invoke`。部分国产 ROM / 旧 WebView 上
   *  前者可能没有注入或晚到，但后者可用 —— 不能只看 `__TAURI__` 就判定“不是原生环境”。 */
  function findInvoke() {
    var T = window.__TAURI__, I = window.__TAURI_INTERNALS__;
    if (T && T.core && typeof T.core.invoke === 'function') return T.core.invoke.bind(T.core);
    if (I && typeof I.invoke === 'function') return I.invoke.bind(I);
    return null;
  }
  var started = false;
  function tryStart(label) {
    if (started) return true;
    var invoke = findInvoke();
    if (!invoke) return false;
    started = true;
    diag('TAURI 就绪' + (label ? '（' + label + '）' : ''));
    start(invoke);
    return true;
  }
  var T = window.__TAURI__;
  diag('url=' + location.href + ' TAURI=' + (T ? Object.keys(T).join('|') : 'null') +
    ' INTERNALS=' + (window.__TAURI_INTERNALS__ ? 'yes' : 'no'));

  if (!tryStart('立即')) {
    // 移动端/部分 ROM 异步注入：轮询等它（最多 20 秒；期间切前台也会再试）
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (tryStart('轮询 ' + (tries * 100) + 'ms')) { clearInterval(timer); return; }
      if (tries >= 200) {                // 200 × 100ms = 20 秒后放弃
        clearInterval(timer);
        diag('20 秒内没等到 Tauri invoke（TAURI/INTERNALS 都没有）');
        showBridgeDiag();
      }
    }, 100);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') tryStart('回到前台');
      });
    }
    return;
  }

  /* ============================================================
   * 原生桥没接上时的**可见诊断**（iQOO/vivo 这类国产 ROM 的专项取证）
   *
   * 用户口径（2026-10）："iQOO 手机上安卓包读不到本体，只能走保底路径，而且保底路径下
   * 大量图像无法显示"。石壳这边能确定的是：页面来自 `tauri.localhost` 却没拿到
   * `__TAURI__/__TAURI_INTERNALS__` 的 invoke —— 于是存档只能退回浏览器兜底。
   * 但**图像为什么缺**在桌面上复现不出来，必须拿到真机的一组事实：
   *   · WebView 内核版本（老内核缺 structuredClone / :has 之类会直接报错）
   *   · 页面 URL / 协议（是不是被 ROM 的"网页加速"改写）
   *   · 图片加载失败的数量与前几张的路径（判断是整站 404 还是个别文件）
   *   · 首个 JS 报错
   * 这里把这几项摊在页面上（不挡住游戏，可关闭），并有 `window.__ssdzDiag()` 供 adb 取值。
   * ============================================================ */
  var diagShown = false;
  function imageFailStats() {
    var list = (window.__ssdzFailedImages && window.__ssdzFailedImages.list) || [];
    return { count: list.length, first: list.slice(0, 6) };
  }
  function diagInfo(reason) {
    var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    var m = /Chrome\/(\d+)/.exec(ua);
    return {
      reason: reason || '桥接未就绪',
      url: String(location.href),
      protocol: String(location.protocol),
      host: String(location.hostname),
      webview: m ? Number(m[1]) : 0,
      ua: ua,
      tauri: !!window.__TAURI__,
      internals: !!window.__TAURI_INTERNALS__,
      images: imageFailStats(),
      errors: (window.__errs || []).slice(-5),
    };
  }
  /** 只有「页面来自外壳资源协议」时才提示桥没就绪：普通网页版本来就没有原生桥。 */
  function isTauriPage() {
    try {
      var h = String(location.hostname || '');
      return h === 'tauri.localhost' || String(location.protocol || '') === 'tauri:';
    } catch (e) { return false; }
  }
  function showBridgeDiag() {
    if (diagShown || !isTauriPage() || typeof document === 'undefined' || !document.body) return;
    diagShown = true;
    var info = diagInfo();
    var el = document.createElement('div');
    el.id = 'ssdz-bridge-diag';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:min(560px,92vw);' +
      'background:#fff8e1;color:#4a3413;border:3px solid #b98a3c;border-radius:14px;padding:10px 12px;' +
      'font:12px/1.5 "Microsoft YaHei",sans-serif;box-shadow:0 4px 14px #0006';
    var img = info.images;
    el.innerHTML = '<b>原生存档桥没有就绪</b><br>' +
      '这局会先用「浏览器兜底存档」（重开可能丢进度）。请把这整段截图反馈：<br>' +
      '<span style="font-family:monospace;font-size:11px">' +
      'URL=' + info.protocol + '//' + info.host + ' · WebView=' + (info.webview || '?') +
      ' · TAURI=' + info.tauri + ' · INTERNALS=' + info.internals +
      ' · 图片失败=' + img.count + (img.first.length ? '（' + img.first.join(' , ') + '）' : '') +
      (info.errors.length ? '<br>首个报错：' + String(info.errors[0]).slice(0, 160) : '') +
      '</span><br><button type="button" id="ssdz-diag-copy" style="margin-top:6px">复制诊断</button> ' +
      '<button type="button" id="ssdz-diag-close">关闭</button>';
    document.body.appendChild(el);
    var close = el.querySelector('#ssdz-diag-close');
    if (close) close.onclick = function () { el.remove(); };
    var copy = el.querySelector('#ssdz-diag-copy');
    if (copy) copy.onclick = function () {
      var text = JSON.stringify(info);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        else { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
      } catch (e) {}
    };
  }
  /* 图片加载失败采集：capture 阶段拿 error 事件（img/script 的 error 不冒泡）。
   * 只记路径与数量，够判断"整站 404"还是"个别文件"。 */

  function start(invoke) {
    // 标记：这个环境是 Tauri 外壳（桌面安装版 / 移动端），存档走原生命令。
    // main.js 会用它把提示文案从「请用启动器打开」换成更贴切的说法。
    try { window.__SSDZ_TAURI_APP__ = true; } catch (e) {}

    function whenReady() {
      if (!window.State || typeof State.setSaveTransport !== 'function') { diag('State 未就绪'); return; }
      // 先把真实存档路径问出来（系统页要显示它），再交给 State ——
      // State 是在探测时读 transport.path 的，所以顺序不能反。
      invoke('save_path').then(function (p) {
        diag('save_path=' + p);
        State.setSaveTransport(buildTransport(p || '')); // eslint-disable-line no-use-before-define
      }).catch(function (e) {
        diag('save_path 失败: ' + e);
        State.setSaveTransport(buildTransport(''));      // eslint-disable-line no-use-before-define
      });
    }

    function buildTransport(pathText) {
      /** 把 invoke 的结果/异常也记进诊断（排查移动端存档时非常有用）。 */
      function trace(what, value) {
        diag(what + '=' + (typeof value === 'string' ? value : JSON.stringify(value)));
        return value;
      }
      return {
        label: '桌面应用',
        path: pathText,
        probe: function () {
          return invoke('save_meta').then(function (meta) {
            trace('save_meta', meta);
            return {
              ok: meta && meta.ok !== false, exists: !!(meta && meta.exists),
              savedAt: Number(meta && meta.savedAt) || 0, path: pathText || (meta && meta.path),
              maxLevel: Number(meta && meta.maxLevel) || 0, minLevel: Number(meta && meta.minLevel) || 0,
              reborn: Number(meta && meta.reborn) || 0,
              backup: !!(meta && meta.backup), corrupt: !!(meta && meta.corrupt),
            };
          }, function (e) { trace('save_meta 失败', String(e)); throw e; });
        },
        read: function () { return invoke('save_read').then(function (r) { return trace('save_read', r); }); },
        /* 第二参数 `opts.force` 只由调试面板「彻底重置账号」传 true；Rust 端的
         * save_write 会拒绝用全新 1 级档覆盖已有进度，必须显式放行。 */
        write: function (text, opts) {
          return invoke('save_write', { data: text, force: !!(opts && opts.force) })
            .then(function (r) { return trace('save_write', r); });
        },
      };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
    else whenReady();
    // state.js 在本文件之前加载，正常情况下这里已经能调用；保险起见再补一次
    window.addEventListener('load', whenReady);
  }
})();
