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

  if (viaOwnServer) {
    // 轻壳 / 手动起的本地服务器：用 /__save，和网页版同一条路
    diag('走本地服务器 /__save');
    return;
  }

  var T = window.__TAURI__;
  diag('url=' + location.href + ' TAURI=' + (T ? Object.keys(T).join('|') : 'null'));

  if (!T || !T.core || typeof T.core.invoke !== 'function') {
    // 移动端异步注入：轮询等它几秒（桌面端第一次就能命中，等于没有额外开销）
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var A = window.__TAURI__;
      if (A && A.core && typeof A.core.invoke === 'function') {
        clearInterval(timer);
        diag('TAURI 就绪，等了 ' + (tries * 100) + 'ms');
        start(A.core.invoke);
      } else if (tries >= 40) {          // 40 × 100ms = 4 秒后放弃
        clearInterval(timer);
        diag('4 秒内没等到 window.__TAURI__（' + (A ? Object.keys(A).join('|') : 'null') + '）');
      }
    }, 100);
    return;
  }

  diag('TAURI 立即可用');
  start(T.core.invoke);

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
            };
          }, function (e) { trace('save_meta 失败', String(e)); throw e; });
        },
        read: function () { return invoke('save_read').then(function (r) { return trace('save_read', r); }); },
        write: function (text) { return invoke('save_write', { data: text }).then(function (r) { return trace('save_write', r); }); },
      };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
    else whenReady();
    // state.js 在本文件之前加载，正常情况下这里已经能调用；保险起见再补一次
    window.addEventListener('load', whenReady);
  }
})();
