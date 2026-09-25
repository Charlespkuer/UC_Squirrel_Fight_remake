/* ============================================================
 * js/tauri-bridge.js —— 桌面外壳（Tauri）里的存档通道
 *
 * 两种桌面运行方式：
 *   1. **轻壳模式**（默认）：外壳自带迷你文件服务器，窗口打开 http://127.0.0.1:<端口>/index.html，
 *      存档走和网页版**完全一样**的 `/__save`（写 <游戏目录>/save/progress.json）。
 *      Tauri 也会往页面里注入 window.__TAURI__，但那边调用命令会被 ACL 拒绝
 *      （"Command save_meta not allowed by ACL"），而且本来就不需要，所以这里必须跳过。
 *   2. **安装包模式**：页面来自 Tauri 的资源协议——Windows 上是 `http://tauri.localhost/`，
 *      macOS/Linux 上是 `tauri://localhost`——旁边没有游戏目录、也没有 `/__save`，
 *      这时才改用 Rust 端命令读写存档（Windows: %APPDATA%\com.ssdz.classic\save\progress.json）。
 *
 * 判断依据：**只有「带端口的 127.0.0.1 / localhost」才是我们自己的服务器**，其余交给 Tauri。
 * （早先只看 `tauri:` 协议，Windows 安装版的 `http://tauri.localhost/` 就漏掉了，
 *   结果是安装版存档莫名退回 localStorage。）网页版（含 file:// 调试）永远不受影响。
 * ============================================================ */
(function () {
  'use strict';
  var host = ((window.location && window.location.hostname) || '').toLowerCase();
  var port = (window.location && window.location.port) || '';
  var viaOwnServer = (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') && !!port;
  if (viaOwnServer) {
    // 轻壳 / 手动起的本地服务器：用 /__save，和网页版同一条路
    return;
  }
  var T = window.__TAURI__;
  if (!T || !T.core || typeof T.core.invoke !== 'function') return;
  var invoke = T.core.invoke;

  function whenReady() {
    if (!window.State || typeof State.setSaveTransport !== 'function') return;
    // 先把真实存档路径问出来（系统页要显示它），再交给 State ——
    // State 是在探测时读 transport.path 的，所以顺序不能反。
    invoke('save_path').then(function (p) {
      State.setSaveTransport(buildTransport(p || '')); // eslint-disable-line no-use-before-define
    }).catch(function () {
      State.setSaveTransport(buildTransport(''));      // eslint-disable-line no-use-before-define
    });
  }

  function buildTransport(pathText) {
    return {
      label: '桌面应用',
      path: pathText,
      probe: function () {
        return invoke('save_meta').then(function (meta) {
          return {
            ok: meta && meta.ok !== false, exists: !!(meta && meta.exists),
            savedAt: Number(meta && meta.savedAt) || 0, path: pathText || (meta && meta.path),
          };
        });
      },
      read: function () { return invoke('save_read'); },
      write: function (text) { return invoke('save_write', { data: text }); },
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
  else whenReady();
  // state.js 在本文件之前加载，正常情况下这里已经能调用；保险起见再补一次
  window.addEventListener('load', whenReady);
})();
