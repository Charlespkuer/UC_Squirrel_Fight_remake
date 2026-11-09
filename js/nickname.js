/* ============================================================
 * nickname.js — 昵称长度规则（浏览器 / 服务端共用）
 * ------------------------------------------------------------
 * 用户 2026-11 口径：
 *   · 昵称上限 = **7 个汉字**；
 *   · 英文字母权重是汉字的 **1/3**（一个字母算 1/3 个字）。
 * 实现上按「三分之一字」做整数计数，避免 1/3 的浮点误差：
 *   · 汉字 / 全角符号 / emoji 等非 ASCII 字符 = 3 个单位；
 *   · ASCII 可见字符（英文、数字、半角符号、空格）= 1 个单位；
 *   · 上限 21 个单位 = 7 个汉字 = 21 个英文字母。
 *
 * 这份文件同时被浏览器（`window.NicknameRules`）和 Node
 * （`server/auth.js` 的 `require('../js/nickname')`）使用，服务端与注册页
 * 不再各写一套阈值。
 * ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.NicknameRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_UNITS = 21;          // 7 个汉字 × 3
  const MAX_WEIGHT = 7;          // 对外展示的“7 个汉字”
  const MAX_ASCII = 21;          // 21 × 1/3 = 7
  const TOO_LONG = '昵称最多 7 个汉字（英文/数字按 1/3 个汉字计，最多 21 个）';

  /** 去掉控制字符与首尾空白；与旧 `auth.normalizeName` 的清洗口径一致。 */
  function clean(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]+/g, '')
      .trim();
  }

  /** 单个码点占多少个“三分之一字”。 */
  function charUnits(ch) {
    return /^[\x20-\x7e]$/.test(ch) ? 1 : 3;
  }

  /** 整串占多少个“三分之一字”（21 = 7 个汉字）。 */
  function unitsOf(value) {
    let n = 0;
    for (const ch of clean(value)) n += charUnits(ch);
    return n;
  }

  /** 整串折合多少个汉字（可能带小数，仅给界面提示用）。 */
  function weightOf(value) {
    return unitsOf(value) / 3;
  }

  /** 是否超过上限。 */
  function tooLong(value) {
    return unitsOf(value) > MAX_UNITS;
  }

  /**
   * 校验昵称，返回统一结果（服务端 `auth.normalizeName` / 注册页即时提示共用）。
   * `name` 已去掉控制字符与首尾空白；`reason` 为空串表示通过。
   */
  function check(value) {
    const name = clean(value);
    if (!name) return { ok: false, name: '', units: 0, weight: 0, reason: '名字不能为空' };
    const units = unitsOf(name);
    if (units > MAX_UNITS) {
      return { ok: false, name, units, weight: units / 3, reason: TOO_LONG };
    }
    return { ok: true, name, units, weight: units / 3, reason: '' };
  }

  /** 按“三分之一字”截断（只给不会出现截断歧义的内部场景用，如 AI 名字兜底）。 */
  function truncate(value, maxUnits) {
    const limit = Number.isFinite(Number(maxUnits)) ? Math.max(0, Math.floor(Number(maxUnits))) : MAX_UNITS;
    let out = '', used = 0;
    for (const ch of clean(value)) {
      const u = charUnits(ch);
      if (used + u > limit) break;
      out += ch; used += u;
    }
    return out;
  }

  return {
    MAX_UNITS, MAX_WEIGHT, MAX_ASCII, TOO_LONG,
    clean, unitsOf, weightOf, tooLong, check, truncate,
  };
});
