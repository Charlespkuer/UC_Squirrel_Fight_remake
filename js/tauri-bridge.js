/* ============================================================
 * js/tauri-bridge.js —— 桌面外壳（Tauri）里的存档通道
 *
 * 两种桌面运行方式：
 *   1. **轻壳模式**（默认，目标就是它）：外壳自带一个迷你文件服务器，
 *      窗口打开的是 http://127.0.0.1:<随机端口>/index.html，
 *      存档直接走和网页版**完全一样**的 `/__save`（写 <游戏目录>/save/progress.json）。
 *      Tauri 也会往 http 页面里注入 window.__TAURI__，但那边调用命令会被 ACL 拒绝
 *      （"Command save_meta not allowed by ACL"），而且本来就不需要——
 *      所以这一模式必须**跳过**桥接，否则存档会莫名其妙退回浏览器 localStorage。
 *   2. **安装包模式**：页面在 tauri://localhost（前端被编译进二进制、旁边没有游戏目录），
 *      这时才没有 /__save 可用，改用 Rust 端命令读写存档。
 *
 * 判断依据很简单：非 http(s) 页面才启用桥接。网页版（含 file:// 调试）永远不受影响。
 * ============================================================ */
(function () {
  'use strict';
  var proto = (window.location && window.location.protocol) || '';
  if (proto === 'http:' || proto === 'https:') {
    // 轻壳模式：服务器在旁边，用 /__save，和网页版同一条路
    return;
  }
  var T = window.__TAURI__;
  if (!T || !T.core || typeof T.core.invoke !== 'function') return;
  var invoke = T.core.invoke;

  function whenReady() {
    if (!window.State || typeof State.setSaveTransport !== 'function') return;
    State.setSaveTransport({
      label: '桌面应用',
      probe: function () {
        return invoke('save_meta').then(function (meta) {
          return {
            ok: meta && meta.ok !== false, exists: !!(meta && meta.exists),
            savedAt: Number(meta && meta.savedAt) || 0, path: meta && meta.path,
          };
        });
      },
      read: function () { return invoke('save_read'); },
      write: function (text) { return invoke('save_write', { data: text }); },
    });
    // 让系统页显示真实路径（Rust 侧算出来的）
    invoke('save_path').then(function (p) {
      if (p && window.State && State.fileInfo) document.documentElement.setAttribute('data-save-path', p);
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
  else whenReady();
  // state.js 在本文件之前加载，正常情况下这里已经能调用；保险起见再补一次
  window.addEventListener('load', whenReady);
})();
