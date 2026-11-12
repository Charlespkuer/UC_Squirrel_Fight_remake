// nickname.js — shared by the browser (window.NicknameRules) and server/auth.js; do not hardcode
// thresholds elsewhere. 7 hanzi max = 21 units; non-ASCII = 3 units, ASCII = 1 (integer, no float drift).
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.NicknameRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_UNITS = 21;
  const MAX_WEIGHT = 7;
  const MAX_ASCII = 21;
  const TOO_LONG = '昵称最多 7 个汉字（英文/数字按 1/3 个汉字计，最多 21 个）';

  // Must stay identical to auth.normalizeName's cleaning (server-side).
  function clean(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]+/g, '')
      .trim();
  }

  // ASCII printable = 1 unit; hanzi/fullwidth/emoji = 3.
  function charUnits(ch) {
    return /^[\x20-\x7e]$/.test(ch) ? 1 : 3;
  }

  function unitsOf(value) {
    let n = 0;
    for (const ch of clean(value)) n += charUnits(ch);
    return n;
  }

  // Fractional hanzi count for UI display only; comparisons must use units.
  function weightOf(value) {
    return unitsOf(value) / 3;
  }

  function tooLong(value) {
    return unitsOf(value) > MAX_UNITS;
  }

  // Shared by server auth.normalizeName and the register-page hint; reason === '' means ok.
  function check(value) {
    const name = clean(value);
    if (!name) return { ok: false, name: '', units: 0, weight: 0, reason: '名字不能为空' };
    const units = unitsOf(name);
    if (units > MAX_UNITS) {
      return { ok: false, name, units, weight: units / 3, reason: TOO_LONG };
    }
    return { ok: true, name, units, weight: units / 3, reason: '' };
  }

  // Truncates by units; only for internal fallbacks (e.g. AI names) where no ambiguity matters.
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
