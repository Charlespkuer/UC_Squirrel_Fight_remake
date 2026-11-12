// js/tauri-bridge.js — Tauri save channel. Light shell (own server on 127.0.0.1:<port>) uses /__save like
// the web build; packaged desktop (tauri.localhost / tauri://) and mobile use Rust commands, saving under
// %APPDATA%\com.ssdz.classic\save or /data/user/0/<pkg>/save. __TAURI__ is ACL-denied there, async on mobile.
(function () {
  'use strict';
  var host = ((window.location && window.location.hostname) || '').toLowerCase();
  var port = (window.location && window.location.port) || '';
  var viaOwnServer = (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') && !!port;
  // Only 127.0.0.1/localhost WITH a port is our own server; everything else goes to Tauri. Checking only
  // the tauri: protocol missed Windows http://tauri.localhost/ and silently fell back to localStorage.
  // The plain web build (including file:// debugging) is never affected.

  // Diagnostic switch ?ssdzdbg=1: writes document.title + console; on Android use
  // `adb logcat | findstr ssdz-bridge`. Silent by default.
  var DBG = /[?&]ssdzdbg=1(?:&|$)/.test((window.location && window.location.search) || '');
  function diag(msg) {
    if (!DBG) return;
    try {
      document.title = '[DBG] ' + msg;
      console.log('[ssdz-bridge] ' + msg);
    } catch (e) {}
  }

  // Collect load failures in capture phase (error does not bubble); paths + count are enough
  // to tell "whole site 404" from "a few missing files".
  var diagShown = false;
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
    // Light shell / manually started local server: use /__save, same path as the web build.
    diag('走本地服务器 /__save');
    return;
  }

  // Tauri v2 may expose invoke as __TAURI__.core.invoke (withGlobalTauri) or as
  // __TAURI_INTERNALS__.invoke. Some ROMs/old WebViews only inject the latter; do not
  // decide "not native" from __TAURI__ alone.
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
    // Mobile/some ROMs inject async: poll for it (up to 20s); also retry when returning to the foreground.
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (tryStart('轮询 ' + (tries * 100) + 'ms')) { clearInterval(timer); return; }
      if (tries >= 200) {                // 200 × 100ms = give up after 20s
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

  // Visible diagnostics when the native bridge never arrives (iQOO/vivo ROMs): WebView version, page
  // URL/protocol, failed-image count + first paths and first JS error. Non-blocking and closable;
  // window.__ssdzDiag() returns the same object for adb. Only shown on a Tauri page, never on the web build.
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
  // Only prompt when the page comes from a Tauri resource protocol; the web build has no bridge.
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
  function start(invoke) {
    // Marks the Tauri shell; main.js uses it to replace the "open with launcher" hint.
    try { window.__SSDZ_TAURI_APP__ = true; } catch (e) {}

    function whenReady() {
      if (!window.State || typeof State.setSaveTransport !== 'function') { diag('State 未就绪'); return; }
      // Ask for the real save path first: State reads transport.path during probe, so order matters.
      invoke('save_path').then(function (p) {
        diag('save_path=' + p);
        State.setSaveTransport(buildTransport(p || '')); // eslint-disable-line no-use-before-define
      }).catch(function (e) {
        diag('save_path 失败: ' + e);
        State.setSaveTransport(buildTransport(''));      // eslint-disable-line no-use-before-define
      });
    }

    function buildTransport(pathText) {
      // Log invoke results/errors into diag (useful for mobile save issues).
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
        // opts.force is only passed by the debug "reset account"; Rust save_write refuses to
        // overwrite existing progress with a fresh level-1 save unless forced.
        write: function (text, opts) {
          return invoke('save_write', { data: text, force: !!(opts && opts.force) })
            .then(function (r) { return trace('save_write', r); });
        },
      };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
    else whenReady();
    // state.js loads before this file; the load listener is only a safety net.
    window.addEventListener('load', whenReady);
  }
})();
