// engine.js — assets + original AnimationStr player. Stage 1170×690, element (tx,ty) is absolute,
// tag "75" is a placeholder never drawn, labels >1000 are weapon slots. Data source js/gamedict.js;
// never read references/ at runtime.
(function () {
  'use strict';

  const W = 1170, H = 690;
  const MISSING = Object.create(null);
  function log(m) {
    if (MISSING[m]) return;
    MISSING[m] = 1;
    if (typeof console !== 'undefined' && console.warn) console.warn('[engine] ' + m);
  }

  const HAS_ANIM = (typeof AnimationStr !== 'undefined' && AnimationStr);
  const HAS_IMGMAP = (typeof imgMap !== 'undefined' && imgMap && typeof imgMap.getValue === 'function');

  // Frame formats: A = ["label",x,y,w,h,regX,regY]; B = [label,x,y,"a-b"|"all",gridSize]. Original imgMap
  // is generated read-only by gen-vendor-data.cjs, so repo-added frames live here: optional dw/dh =
  // on-screen size (default w/h; regX/regY then in scaled px). Orange layers recolor set 51 (berserker, sprite 32).
  const EXTRA_DEFS = Object.freeze({
    Head_113_1: [['0', 0, 0, 449, 355, 93, 164]],
    HandO_113_1: [['0', 0, 0, 176, 149, 57, 48]],
    Body_113_1: [['0', 0, 0, 239, 196, 170, 131]],
    Foot_113_1: [['0', 0, 0, 70, 53, 16, 21]],
    HandI_113_1: [['0', 0, 0, 134, 130, 39, 57]],
    Arm_113_1: [['0', 0, 0, 124, 114, 44, 45]],
  });
  function getDef(id) {
    if (EXTRA_DEFS[id]) return EXTRA_DEFS[id];
    if (!HAS_IMGMAP) return null;
    try { return imgMap.getValue(id); } catch (e) { return null; }
  }
  function frameList(def) {
    if (Array.isArray(def)) return def;
    if (Array.isArray(def && def.frames)) return def.frames;
    return null;
  }
  function frameAt(def, label) {
    const list = frameList(def);
    if (!list) return null;
    const want = String(label);
    for (const f of list) if (String(f[0]) === want) return f;
    return null;
  }
  // Normalize a frame record; B-class needs the image size for its grid. dw/dh = display size.
  function normFrame(f, imgW, imgH) {
    const x = +f[1], y = +f[2];
    const dim = f[3], grid = +f[4] || 1;
    const dst = (fr) => {
      if (f[7] != null && f[7] !== '') fr.dw = +f[7] || fr.sw;
      if (f[8] != null && f[8] !== '') fr.dh = +f[8] || fr.sh;
      return fr;
    };
    if (typeof dim === 'string') {
      let w, h, regX = 0, regY = 0;
      if (dim === 'all') { w = Math.max(1, Math.floor((imgW - x) / grid)); h = Math.max(1, Math.floor((imgH - y) / grid)); }
      else {
        const m = dim.split('-').map(Number);
        w = Math.max(1, Math.floor((m[1] - m[0] + 1) * grid));
        h = w;
      }
      return dst({ sx: x, sy: y, sw: w, sh: h, regX: regX, regY: regY });
    }
    return dst({ sx: x, sy: y, sw: +dim || 1, sh: +f[4] || 1, regX: +f[5] || 0, regY: +f[6] || 0 });
  }
  /** 一帧的显示尺寸（原版帧 = 源尺寸）。 */
  function frameDst(f) {
    return { w: f.dw == null ? f.sw : f.dw, h: f.dh == null ? f.sh : f.dh };
  }

  const SRC_MAP = {};
  (function buildSrcMap() {
    if (typeof asstes !== 'undefined' && Array.isArray(asstes)) for (const a of asstes) if (a && a.id) SRC_MAP[a.id] = a.src;
    for (const k of Object.getOwnPropertyNames(window)) {
      if (!/^asset/.test(k)) continue;
      const v = window[k];
      if (Array.isArray(v)) { for (const a of v) if (a && a.id && a.src) SRC_MAP[a.id] = a.src; }
    }
    // Gear icons (already in asset2.js; this is a fallback).
    if (HAS_IMGMAP && Array.isArray(imgMap.keys)) {
      for (const t of ['Arm', 'Body', 'Foot', 'HandI', 'HandO', 'Head']) {
        for (const key of imgMap.keys) if (String(key).indexOf(t + '_') === 0) SRC_MAP[key] = 'images/battle/outfit/' + t + '/' + key + '.png';
      }
    }
  })();

  // Guess an image path by id (fallback).
  const SOURCE_ALIAS = {
    // Original splits the home UI into a "shouyebiao" movieclip using the same bitmap as resource_1,
    // only the frame table differs.
    shouyebiao: 'images/atlas/resource_1.png',
  };
  function guessSrc(id) {
    if (SRC_MAP[id]) return SRC_MAP[id];
    if (SOURCE_ALIAS[id]) return SOURCE_ALIAS[id];
    if (/^(Head|HandO|HandI|Body|Arm|Foot)_/.test(id)) return 'images/battle/outfit/' + id.split('_')[0] + '/' + id + '.png';
    return null;
  }

  const cache = Object.create(null);   // src -> {img, ok}
  const pendingImages = Object.create(null);
  const waitingSheets = Object.create(null); // src -> ids waiting for a successful image
  // Per-image fallback timeout: local assets load in ms, so 4s is enough to call a request dead
  // instead of holding the first screen for 12s on one stuck request.
  const IMG_TIMEOUT_MS = 4000;
  const IMG_RETRY_MS = 1000;
  // Batch deadline: wait for all but at most this long; stragglers keep loading and still register.
  // The first screen only waits for its required batch (see js/main.js startup).
  const SHEETS_DEADLINE_MS = 5000;
  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    const c = cache[src];
    // ok:true can still be a 0×0 broken image (some WebViews fire onload then fail decode);
    // treating it as loaded would permanently hide the good image.
    if (c && c.ok) {
      if (c.img && (c.img.naturalWidth || c.img.width)) return Promise.resolve(c.img);
      delete cache[src];
    }
    if (pendingImages[src]) return pendingImages[src];
    // A failed local read can recover after resume; retain a short cooldown, not a permanent miss.
    if (c && Date.now() < c.retryAt) return Promise.resolve(null);
    if (c) delete cache[src];
    pendingImages[src] = new Promise((resolve) => {
      const img = new Image();
      // Large-image decode must not block the main thread: synchronous decode drops a frame on Android WebView.
      try { img.decoding = 'async'; } catch (e) {}
      let settled = false, timer = 0, failedEntry = null;
      const ready = () => {
        cache[src] = { img, ok: true };
        const ids = waitingSheets[src];
        if (ids) {
          delete waitingSheets[src];
          for (const id of ids) registerSheet(id, img);
        }
      };
      const finish = (ok) => {
        if (settled) {
          // The timeout released its caller, but a late onload can still restore requested sheets.
          if (ok && failedEntry && cache[src] === failedEntry) ready();
          return;
        }
        settled = true;
        if (timer) clearTimeout(timer);          // Clear the fallback timer on both success and failure.
        if (ok) ready();
        else cache[src] = failedEntry = { img: null, ok: false, retryAt: Date.now() + IMG_RETRY_MS };
        delete pendingImages[src];
        if (!ok) log('img-fail ' + src);
        resolve(ok ? img : null);
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      try { img.src = src; } catch (e) { finish(false); }
      // Some environments may never fire onload; keep a fallback.
      timer = setTimeout(() => finish(false), IMG_TIMEOUT_MS);
    });
    return pendingImages[src];
  }
  function loadUrl(url) { return loadImage(url); }

  // Honor/MagicOS WebView can drop decoded images on memory reclaim (naturalWidth stays, drawImage paints
  // nothing): retrySheet reloads direct then fetch→blob, imagesHealthy draws to 2×2 + reads a pixel, and
  // recoverSheets swaps the image into the same sheet. Never run unconditionally at startup.
  const sheetSrc = Object.create(null);        // id -> 原始 src（重试/兜底时要知道从哪来）
  const retryPending = Object.create(null);    // id -> 进行中的恢复 Promise
  let healthCanvas = null;

  // Fetch bytes and decode via a blob: URL, for devices whose direct <img> path can no longer paint.
  function loadImageViaBlob(src) {
    if (!src || typeof fetch !== 'function' || typeof URL === 'undefined' || !URL.createObjectURL) return Promise.resolve(null);
    return fetch(src, { cache: 'force-cache' }).then((r) => (r && r.ok ? r.blob() : null)).then((blob) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      return new Promise((resolve) => {
        const img = new Image();
        try { img.decoding = 'async'; } catch (e) {}
        let settled = false;
        const done = (ok) => {
          if (settled) return;
          settled = true;
          if (ok) { img.__blobUrl = url; resolve(img); }
          else { try { URL.revokeObjectURL(url); } catch (e) {} resolve(null); }
        };
        img.onload = () => done(true);
        img.onerror = () => done(false);
        setTimeout(() => done(false), IMG_TIMEOUT_MS + 2000);
        try { img.src = url; } catch (e) { done(false); }
      });
    }).catch(() => null);
  }

  // Swap the new image into the existing sheet (keeps frames and animation instance refs).
  function applySheetImage(id, img) {
    const sh = SHEETS[id];
    if (sh && sh.frames && Object.keys(sh.frames).length) {
      sh.img = img;
      sh.w = img.naturalWidth || img.width;
      sh.h = img.naturalHeight || img.height;
      return sh;
    }
    if (sh) delete SHEETS[id];                 // 之前注册的是坏图（0 尺寸），重新建帧表
    return registerSheet(id, img);
  }

  // Refetch one sheet; force also replaces an image that "looks loaded" (decoded data may be gone).
  function retrySheet(id, force) {
    id = String(id);
    if (!force && has(id)) return Promise.resolve(SHEETS[id]);
    if (retryPending[id]) return retryPending[id];
    const src = sheetSrc[id] || guessSrc(id);
    if (!src) return Promise.resolve(null);
    retryPending[id] = (async () => {
      // Refetch directly. With force, drop the cache entry so a new request really goes out.
      if (force || (cache[src] && !cache[src].ok)) delete cache[src];
      let img = await loadImage(src);
      if (!img) img = await loadImageViaBlob(src);
      if (!img) return null;
      cache[src] = { img, ok: true, blobUrl: img.__blobUrl || (cache[src] && cache[src].blobUrl) };
      return applySheetImage(id, img);
    })().finally(() => { delete retryPending[id]; });
    return retryPending[id];
  }

  // Ids still missing images or whose images are broken.
  function missingSheets(ids) {
    return (ids || []).filter((id) => id && !has(String(id)));
  }

  function retrySheets(ids, force) {
    return Promise.all((ids || []).map((id) => retrySheet(id, force)));
  }

  // Requeue previously failed images on foreground (zero requests in normal play).
  function retryFailedImages() {
    let n = 0;
    for (const src of Object.keys(cache)) {
      if (cache[src] && cache[src].ok) continue;
      delete cache[src];
      n++;
      loadImage(src).catch(() => {});
    }
    return n;
  }

  // Draw the atlas small into 2×2 and read a pixel: non-transparent means drawImage currently works.
  // Uses a scratch canvas only; detects "naturalWidth intact but image unpaintable".
  function imagesHealthy(ids) {
    if (typeof document === 'undefined' || !document.createElement) return true;
    const list = (ids || []).filter((id) => has(String(id)));
    if (!list.length) return false;
    try {
      if (!healthCanvas) { healthCanvas = document.createElement('canvas'); healthCanvas.width = healthCanvas.height = 2; }
      const ctx = healthCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return true;                   // Environments without a 2D context (headless regression) are not judged broken.
      for (const id of list.slice(0, 4)) {
        const sh = SHEETS[String(id)];
        if (!sh || !sh.img) continue;
        ctx.clearRect(0, 0, 2, 2);
        ctx.drawImage(sh.img, 0, 0, sh.img.naturalWidth || sh.img.width, sh.img.naturalHeight || sh.img.height, 0, 0, 2, 2);
        const data = ctx.getImageData(0, 0, 2, 2).data;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 8) return true;
      }
      return false;
    } catch (e) {
      return false;                            // drawImage/getImageData throwing is also "cannot paint".
    }
  }

  // Force-refetch a batch of sheets (recovery path; caller repaints).
  function recoverSheets(ids) {
    return retrySheets(ids, true);
  }

  // Label -> atlas index; later registrations win so overrides work.
  const LABEL_INDEX = Object.create(null);
  function indexSheet(sh) {
    for (const k in sh.frames) {
      if (!LABEL_INDEX[k]) LABEL_INDEX[k] = [];
      if (LABEL_INDEX[k].indexOf(sh) < 0) LABEL_INDEX[k].push(sh);
    }
  }
  function spriteFor(label) {
    const list = LABEL_INDEX[label];
    if (!list || !list.length) return null;
    const sh = list[list.length - 1];
    return { sh: sh, fr: sh.frames[label] };
  }
  // Find a label within a specific atlas list by priority (keeps same-named labels from other characters/scenes out).
  function spriteIn(ids, label) {
    for (const id of ids) {
      const sh = SHEETS[id];
      if (!sh || !sh.img || !(sh.img.naturalWidth || sh.img.width)) continue;
      const fr = sh.frames[label];
      if (fr) return { sh: sh, fr: fr };
    }
    return null;
  }
  // Move sheets to the end of the global index (highest priority) so scene atlases cannot steal same-named labels.
  function pinSheets(ids) {
    for (const id of ids) {
      const sh = SHEETS[id];
      if (!sh) continue;
      for (const k in sh.frames) {
        const list = LABEL_INDEX[k];
        if (!list) { LABEL_INDEX[k] = [sh]; continue; }
        const i = list.indexOf(sh);
        if (i >= 0) list.splice(i, 1);
        list.push(sh);
      }
    }
  }

  const SHEETS = Object.create(null);   // id -> {id, img, w, h, def, frames:{label:frame}}
  function registerSheet(id, img) {
    const old = SHEETS[id];
    if (old) {
      // A previously registered id used to win forever, so a 0×0 first decode blocked the good image;
      // broken sheets may now be replaced (the recovery path relies on it).
      if (old.img && (old.img.naturalWidth || old.img.width)) return old;
      delete SHEETS[id];
    }
    const def = getDef(id);
    const sh = { id: id, img: img, w: img.width, h: img.height, def: def, frames: Object.create(null) };
    const list = frameList(def);
    if (list) {
      for (const f of list) {
        const key = String(f[0]);
        if (!sh.frames[key]) sh.frames[key] = normFrame(f, img.width, img.height);
      }
    } else if (def && def.w && def.h) {
      // 原版数字、武器和技能图标使用规则网格，没有 frames 数组。
      // 原版数字、武器和技能图标使用规则网格，并没有 frames 数组。
      const keys = def.k ? String(def.k).split(',') : Array.from({ length: def.n || 1 }, (_, i) => String(i));
      const cols = Math.max(1, Math.floor(img.width / def.w));
      keys.forEach((key, i) => {
        sh.frames[key] = { sx: (i % cols) * def.w, sy: Math.floor(i / cols) * def.h, sw: def.w, sh: def.h, regX: 0, regY: 0 };
      });
    }
    SHEETS[id] = sh;
    indexSheet(sh);
    return sh;
  }
  // Load a batch, waiting at most opts.deadlineMs (default 5s). Stragglers keep loading and still
  // register, so spriteFor finds them later — "late", not "lost". battle.js re-requests its sheets
  // before a fight and reuses the in-flight loads.
  function loadSheets(ids, opts) {
    const jobs = [];
    for (const id of ids) {
      if (!id || has(id)) continue;
      const src = guessSrc(id);
      if (src) sheetSrc[id] = src;
      if (src && !(cache[src] && cache[src].ok)) (waitingSheets[src] || (waitingSheets[src] = new Set())).add(id);
      jobs.push(loadImage(src).then((img) => (img ? registerSheet(id, img) : null)));
    }
    const all = Promise.all(jobs);
    const ms = Math.max(0, Number(opts && opts.deadlineMs) || SHEETS_DEADLINE_MS);
    return Promise.race([all, new Promise((resolve) => setTimeout(resolve, ms))]).then(() => undefined);
  }
  // Load and register a sheet by file path (some original images have no id).
  function loadSheetFromUrl(id, url) {
    if (has(id)) return Promise.resolve(SHEETS[id]);
    if (url) sheetSrc[id] = url;
    if (url && !(cache[url] && cache[url].ok)) (waitingSheets[url] || (waitingSheets[url] = new Set())).add(id);
    return loadImage(url).then((img) => (img ? registerSheet(id, img) : null));
  }
  function sheet(id) { return SHEETS[id] || null; }

  // Mutant trio recolor: original *_boss.swf is 404 in the references (only Panda3.swf exists), so
  // colors come from classic stage style 4738 frames 4-6. Recolor the normal atlas at runtime
  // (mantis green→cyan, crane dimmed, panda black/white→purple-red); swap mutantSheets() when real boss art appears.
  const MUTANT_BASE_SHEETS = Object.freeze({
    tl: ['tl'], xh: ['xh1', 'xh2'], xm: ['xm1', 'xm2'],
  });
  const mutantPending = Object.create(null);
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    const d = max - min;
    if (!d) return [0, 0, l];
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  // Sample a [pos,r,g,b] gradient (used for panda/crane luminance mapping).
  function gradientAt(t, stops) {
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], z = stops[i + 1];
      if (t <= z[0] || i === stops.length - 2) {
        const k = clamp01((t - a[0]) / Math.max(1e-6, z[0] - a[0]));
        return [a[1] + (z[1] - a[1]) * k, a[2] + (z[2] - a[2]) * k, a[3] + (z[3] - a[3]) * k];
      }
    }
    const last = stops[stops.length - 1];
    return [last[1], last[2], last[3]];
  }
  // Elite portrait colors (style 4738 frames 4-6): tl cyan body + purple blade; xh gray-black
  // feathers + orange beak; xm red body + purple-black patches/hat. Panda is easy to wreck: normal is
  // warm white + black patches + brown hat; only recolor the BROWN hat purple, other luminance goes red.
  function mutantPixel(mode, r, g, b) {
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (mode === 'xm') {
      // Red main gradient: #36121c (patches) -> #922e3a (mid) -> #de726e (fur highlight); darker and
      // slightly purple, not fluorescent coral.
      const red = gradientAt(lum, [
        [0.00, 54, 18, 28], [0.20, 104, 32, 44], [0.45, 146, 46, 58],
        [0.70, 178, 64, 74], [0.88, 202, 86, 92], [1.00, 222, 114, 112],
      ]);
      // Only the brown hat/trim (low luminance, brownish saturation) mixes purple; white fur/patches do not.
      let [h, s, l] = rgbToHsl(r, g, b);
      if (s > 0.28 && h >= 15 && h <= 55 && l < 0.58) {
        const purple = gradientAt(lum, [
          [0.00, 64, 40, 72], [0.45, 118, 78, 124], [0.75, 154, 108, 156], [1.00, 186, 138, 184],
        ]);
        return [red[0] * 0.30 + purple[0] * 0.70, red[1] * 0.30 + purple[1] * 0.70, red[2] * 0.30 + purple[2] * 0.70];
      }
      return red;
    }
    if (mode === 'xh') {
      // Crane: gray-black feathers + orange beak. White maps to ~#adadad, blue neck turns gray;
      // yellow beak/red crest keep warm colors, brown hat goes gray-brown.
      const gray = gradientAt(lum, [
        [0.00, 30, 30, 30], [0.35, 80, 78, 76], [0.65, 125, 123, 121],
        [0.85, 160, 160, 160], [1.00, 172, 172, 172],
      ]);
      let [h, s, l] = rgbToHsl(r, g, b);
      // Only high-saturation yellow beak and red crest are warm; brown hat (s≈0.3-0.4) takes the gray-brown branch.
      const warm = s > 0.50 && ((h >= 10 && h <= 55) || h < 10 || h > 345);
      if (warm) {
        return gradientAt(lum, [
          [0.00, 100, 45, 30], [0.50, 160, 95, 55], [1.00, 185, 115, 70],
        ]);
      }
      if (s > 0.12 && s <= 0.50 && h >= 15 && h <= 55) {
        return gradientAt(lum, [
          [0.00, 45, 38, 34], [0.50, 140, 127, 112], [1.00, 170, 160, 145],
        ]);
      }
      return gray;
    }
    let [h, s, l] = rgbToHsl(r, g, b);
    if (mode === 'tl') {
      // Greens move to cyan-blue (65°-175° -> 190°-210°); purple blade is pinned at 285°.
      if (s > 0.12 && h >= 65 && h <= 175) h = 190 + (h - 65) / 110 * 20;
      else if (s > 0.10 && h >= 270 && h <= 335) h = 285;
      s = clamp01(s * 1.08);
    }
    return hslToRgb(h, s, l);
  }
  // Copy a loaded sheet into a recolored canvas under a new id using the same frame table.
  function tintSheet(srcId, dstId, mode) {
    const src = SHEETS[srcId];
    const img = src && src.img;
    if (!img || !img.width || !img.height || typeof document === 'undefined' || !document.createElement) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    let pixels;
    try { pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (e) { return null; }
    const d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const out = mutantPixel(mode, d[i], d[i + 1], d[i + 2]);
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
    }
    ctx.putImageData(pixels, 0, 0);
    const sh = { id: dstId, img: canvas, w: canvas.width, h: canvas.height, def: src.def, frames: Object.assign({}, src.frames) };
    SHEETS[dstId] = sh;
    return sh;
  }
  // Ensure a mutant recolor sheet exists (once); silently falls back to the normal atlas on failure.
  function ensureMutantSheets(kind) {
    const bases = MUTANT_BASE_SHEETS[kind];
    if (!bases) return Promise.resolve(false);
    if (mutantPending[kind]) return mutantPending[kind];
    // Wait for every source image to be truly ready before tinting: loadSheets has a 5s deadline and
    // SHEETS[id] may not exist yet — tinting an empty image would fall back to the normal skin for the
    // first battle. loadImage() shares the cache and resolves when the image arrives.
    const jobs = bases.map((id) => {
      if (SHEETS[id]) return Promise.resolve();
      const src = guessSrc(id);
      if (!src) return Promise.resolve();
      return loadImage(src).then((img) => { if (img) registerSheet(id, img); });
    });
    mutantPending[kind] = Promise.all(jobs).then(() => {
      for (const id of bases) if (!SHEETS[id + '_mut']) tintSheet(id, id + '_mut', kind);
      const ok = bases.every((id) => !!SHEETS[id + '_mut']);
      if (!ok) delete mutantPending[kind];      // allow a retry next battle (e.g. canvas reclaimed by the OS)
      return ok;
    }).catch(() => { delete mutantPending[kind]; return false; });
    return mutantPending[kind];
  }
  // Atlas to draw for this kind: recolored version when ready, normal atlas otherwise.
  function mutantSheets(kind) {
    const bases = MUTANT_BASE_SHEETS[kind];
    if (!bases) return null;
    return bases.map((id) => (SHEETS[id + '_mut'] ? id + '_mut' : id));
  }

  const ANIM_CACHE = Object.create(null);
  function parseAnim(str) {
    const frames = [];
    for (const f of String(str).split(':')) {
      const elems = [];
      for (const e of f.split('|')) {
        const p = e.split(',');
        elems.push({
          label: String(p[0]).trim(),
          alpha: p[1] === undefined || p[1] === '' ? 1 : +p[1],
          a: p[2] === undefined || p[2] === '' ? 1 : +p[2],
          b: p[3] === undefined || p[3] === '' ? 0 : +p[3],
          c: p[4] === undefined || p[4] === '' ? 0 : +p[4],
          d: p[5] === undefined || p[5] === '' ? 1 : +p[5],
          tx: p[6] === undefined || p[6] === '' ? 0 : +p[6],
          ty: p[7] === undefined || p[7] === '' ? 0 : +p[7],
        });
      }
      if (elems.length) frames.push(elems);
    }
    return frames;
  }
  function anim(name) {
    if (name == null) return null;
    if (name in ANIM_CACHE) return ANIM_CACHE[name];
    const s = HAS_ANIM ? AnimationStr[name] : null;
    const v = s ? parseAnim(s) : null;
    ANIM_CACHE[name] = v;
    return v;
  }
  function hasAnim(name) { return !!anim(name); }
  function animNames() { return HAS_ANIM ? Object.keys(AnimationStr) : []; }

  // Modern outfit atlases only cover sets 1-32 + 113: 1-5 white/green, 6-18 blue (2 tiers),
  // 19-31 purple/32 saint (up to 3 tiers), 113 special. Black 33-40 / deep sea / robot cat have no
  // art and are filtered out by the appearance page. Keep in sync with images/battle/outfit/ (test-tower-hero.cjs scans it).
  const MODERN_OUTFIT_TIERS = new Map([
    ...[1, 2, 3, 4, 5, 32, 113].map((index) => [index, 1]),
    ...[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((index) => [index, 2]),
    ...[19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31].map((index) => [index, 3]),
  ]);
  function hasModernOutfit(index) {
    return MODERN_OUTFIT_TIERS.has(Number(index));
  }
  // Highest drawable tier for head/gloves (incl. inner glove HandI); clothes/shoes/arms have no tiers.
  function modernOutfitTier(index, type) {
    const ty = Number(type);
    if (ty !== 0 && ty !== 1 && ty !== 4) return 1;
    return MODERN_OUTFIT_TIERS.get(Number(index)) || 1;
  }
  const WEAR_LABELS = { '-1': 0, '4': 1, '5': 2, '1': 3, '3': 4, '6': 5 };
  function wearsFor(source) {
    const out = [null, null, null, null, null, null];
    if (!source) return out;
    function add(item, slot) {
      if (!item) return;
      if (item.src) { out[slot] = { src: item.src, label: String(item.label == null ? 0 : item.label) }; return; }
      const parts = typeof item === 'string' ? item.split(':') : [];
      const id = parts.length ? Number(parts[0]) : Number(item.id || item);
      let level = item.maxLevel || 1;
      // Hero-outfit differential tier (1-3, same as tower-ui heroGearTierCount): head/glove names
      // append _1/_2/_3. Account gear has no tier and goes through ext below.
      if (item.tier) level = Math.max(level, Math.min(3, Number(item.tier) || 1));
      if (Array.isArray(item.ext)) for (const e of item.ext) level = Math.max(level, Number(e.level) || 1);
      for (let i = 3; i < parts.length; i += 2) level = Math.max(level, Number(parts[i]) || 1);
      let gear, set;
      try { gear = gearMap.getValue(id); set = gear && gearSetMap.getValue(gear.setId); } catch (e) { return; }
      if (!gear || !set) return;
      const type = Number(gear.type), index = Number(set.index);
      // Sets with no modern atlas (black 33-40 / deep sea / robot cat) draw nothing: better empty than
      // requesting a non-existent Head_33_1. The appearance page already filters them in modern mode.
      if (!hasModernOutfit(index)) return;
      const tier = Math.min(modernOutfitTier(index, type), Math.min(3, level));
      const put = (n) => {
        const prefix = ['Head', 'HandO', 'Body', 'Foot', 'HandI', 'Arm'][n];
        out[n] = { src: prefix + '_' + index + ([0, 1, 4].includes(n) && index !== 32 ? '_' + tier : ''), label: '0' };
      };
      put(type);
      if (type === 1) put(4);
      if (type === 2) put(5);
    }
    if (typeof source === 'string') source.split(';').forEach((item) => add(item));
    else if (Array.isArray(source)) source.forEach((item, slot) => { if (!item || item.used !== false) add(item, slot); });
    else for (let slot = 0; slot < 6; slot++) add(typeof source.getValue === 'function' ? source.getValue(slot) : source[slot], slot);
    return out;
  }
  async function loadWears(source) {
    const wears = wearsFor(source);
    await loadSheets(wears.filter(Boolean).map((w) => w.src));
    return wears;
  }
  function frameSprite(label, opt) {
    const slot = WEAR_LABELS[label];
    const wear = opt.wears && slot != null && opt.wears[slot];
    return (wear && spriteIn([wear.src], String(wear.label == null ? 0 : wear.label))) ||
      (opt.sheets ? spriteIn(opt.sheets, label) : spriteFor(label));
  }
  function frameBounds(frame, opt) {
    opt = opt || {};
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of frame || []) {
      if (el.label === '75' || el.alpha <= 0 || (opt.exclude && opt.exclude.includes(el.label))) continue;
      const label = +el.label > 1000 ? opt.weaponLabel : el.label;
      if (label == null) continue;
      const sp = frameSprite(String(label), opt);
      if (!sp) continue;
      const f = sp.fr;
      const fd = frameDst(f);
      for (const [x, y] of [[0, 0], [fd.w, 0], [0, fd.h], [fd.w, fd.h]]) {
        const tx = el.tx + (x - f.regX) * el.a + (y - f.regY) * el.c;
        const ty = el.ty + (x - f.regX) * el.b + (y - f.regY) * el.d;
        minX = Math.min(minX, tx); minY = Math.min(minY, ty); maxX = Math.max(maxX, tx); maxY = Math.max(maxY, ty);
      }
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  }
  // Draw one animation frame to ctx (call setTransform(1,0,0,1,0,0) first).
  function drawFrame(ctx, frame, opt) {
    if (!frame) return 0;
    opt = opt || {};
    const scale = opt.scale == null ? 1 : opt.scale;
    const ox = opt.x || 0, oy = opt.y || 0;
    const mirror = !!opt.mirror;
    const filters = opt.only || null;
    const exclude = opt.exclude || null;
    const glow = opt.weaponGlow || null;
    const wl = opt.weaponLabel == null ? null : String(opt.weaponLabel);
    const sheets = opt.sheets || null;
    let n = 0;
    const hasFilter = filters ? (typeof filters.has === 'function' ? (l) => filters.has(l) : (l) => filters.indexOf(l) >= 0) : null;
    const hasExclude = exclude ? (typeof exclude.has === 'function' ? (l) => exclude.has(l) : (l) => exclude.indexOf(l) >= 0) : null;
    for (const el of frame) {
      let label = el.label;
      if (!label) continue;
      if (label === '75') continue;
      if (+label > 1000) {
        if (wl == null) continue;
        label = wl;
      }
      if (hasFilter && !hasFilter(label)) continue;
      if (hasExclude && hasExclude(label)) continue;
      const sp = frameSprite(label, opt);
      if (!sp) continue;
      const f = sp.fr;
      const fd = frameDst(f);
      let a = el.a * scale, b = el.b * scale, c = el.c * scale, d = el.d * scale;
      let tx = (el.tx - (f.regX * el.a + f.regY * el.c)) * scale;
      let ty = (el.ty - (f.regX * el.b + f.regY * el.d)) * scale;
      if (mirror) { a = -a; c = -c; tx = -tx + (W + ox) * scale; ty += oy * scale; }
      else { tx += ox * scale; ty += oy * scale; }
      ctx.save();
      ctx.globalAlpha *= el.alpha * (opt.alpha == null ? 1 : opt.alpha);
      // True weapon: glow only weapon stand-ins (label > 1000), never body/clothes. Shadow is set
      // after the transform; shadowBlur is in screen pixels, so it stays a stable halo when scaled.
      if (glow && +el.label > 1000) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 18;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
      ctx.transform(a, b, c, d, tx, ty);
      ctx.drawImage(sp.sh.img, f.sx, f.sy, f.sw, f.sh, 0, 0, fd.w, fd.h);
      ctx.restore();
      n++;
    }
    return n;
  }

  // Draw a static sprite (frame looked up by label) to (dx,dy); dw/dh are display size.
  function drawSprite(ctx, id, label, dx, dy, dw, dh) {
    const sh = SHEETS[id];
    if (!sh || !sh.img || !(sh.img.naturalWidth || sh.img.width)) return false;
    const f = sh.frames[String(label)] || sh.frames[String(label).toUpperCase()];
    if (!f) return false;
    ctx.drawImage(sh.img, f.sx, f.sy, f.sw, f.sh, dx, dy, dw == null ? f.sw : dw, dh == null ? f.sh : dh);
    return true;
  }
  function frameSize(id, label) {
    const sh = SHEETS[id];
    if (!sh) return null;
    const f = sh.frames[String(label)];
    return f ? frameDst(f) : null;
  }
  function has(id) { const sh = SHEETS[id]; return !!(sh && sh.img && (sh.img.naturalWidth || sh.img.width)); }

  function makePlayer() { return { list: [] }; }
  function playAnim(player, name, opts) {
    const frames = anim(name);
    if (!frames) { log('no-anim ' + name); if (opts && opts.onDone) opts.onDone(); return null; }
    opts = opts || {};
    const inst = {
      name: name, frames: opts.reverse ? frames.slice().reverse() : frames, frame: 0, timer: 0,
      fps: opts.fps || 20, loop: !!opts.loop,
      x: opts.x || 0, y: opts.y || 0,
      scale: opts.scale == null ? 1 : opts.scale,
      mirror: !!opts.mirror,
      weaponLabel: opts.weaponLabel == null ? null : String(opts.weaponLabel),
      weaponGlow: opts.weaponGlow || null,
      only: opts.only || null, exclude: opts.exclude || null,
      sheets: opts.sheets || null,
      wears: opts.wears || null,
      holdLast: !!opts.holdLast,
      onFrame: opts.onFrame || null,
      onDone: opts.onDone || null,
      alpha: opts.alpha == null ? 1 : opts.alpha,
      layer: opts.layer || 0,
      done: false, dead: false,
    };
    player.list.push(inst);
    return inst;
  }
  function killInst(inst) { if (!inst) return; inst.dead = true; inst.done = true; inst.onDone = null; }
  function updatePlayer(player, dtMs) {
    for (const inst of player.list) {
      if (inst.done || inst.dead) continue;
      inst.timer += dtMs;
      const ft = 1000 / inst.fps;
      let guard = 0;
      while (inst.timer >= ft && guard++ < 240) {
        inst.timer -= ft;
        inst.frame++;
        if (inst.onFrame && inst.frame < inst.frames.length) inst.onFrame(inst.frame, inst);
        if (inst.frame >= inst.frames.length) {
          if (inst.loop) inst.frame = 0;
          else {
            inst.frame = inst.frames.length - 1;
            inst.done = true;
            const cb = inst.onDone; inst.onDone = null;
            if (cb) cb();
            break;
          }
        }
      }
    }
    player.list = player.list.filter((i) => !i.dead && (!i.done || i.holdLast));
  }
  function drawPlayer(ctx, player) {
    const list = player.list.slice().sort((a, b) => a.layer - b.layer);
    for (const inst of list) {
      ctx.save();
      drawFrame(ctx, inst.frames[inst.frame], inst);
      ctx.restore();
    }
  }

  function numKeys(id) {
    const def = getDef(id);
    if (def && def.k) return String(def.k).split(',');
    const sh = SHEETS[id];
    if (sh) return Object.keys(sh.frames);
    return [];
  }
  // Draw a value with bitmap digits. sheetId: fightNum_r/g/y, jingyanshuzi, num_28, energyNum...
  // o: {align:'left'|'center'|'right', h: display height, gap: letter spacing, sx: scale}.
  function drawNumber(ctx, sheetId, text, x, y, o) {
    const sh = SHEETS[sheetId];
    if (!sh) return 0;
    o = o || {};
    const keys = numKeys(sheetId);
    const chars = String(text).split('');
    let h = o.h != null ? o.h : frameSize(sheetId, keys[0]) ? frameSize(sheetId, keys[0]).h : 24;
    const gap = o.gap == null ? 0 : o.gap;
    const items = [];
    let total = 0;
    for (const ch of chars) {
      const ki = keys.indexOf(ch);
      if (ki < 0) continue;   // characters not in the sheet (e.g. "/") are skipped, never drawn as 0
      const f = sh.frames[keys[ki]];
      if (!f) continue;
      const w = f.sw * (h / f.sh);
      items.push({ f: f, w: w });
      total += w + gap;
    }
    if (!items.length) return 0;
    total -= gap;
    let cx = x;
    if (o.align === 'center') cx = x - total / 2;
    else if (o.align === 'right') cx = x - total;
    for (const it of items) {
      ctx.drawImage(sh.img, it.f.sx, it.f.sy, it.f.sw, it.f.sh, cx, y, it.w, h);
      cx += it.w + gap;
    }
    return total;
  }
  function measureNumber(sheetId, text, h) {
    const keys = numKeys(sheetId);
    const sh = SHEETS[sheetId];
    if (!sh) return 0;
    let total = 0;
    for (const ch of String(text)) {
      const ki = keys.indexOf(ch);
      if (ki < 0) continue;
      const f = sh.frames[keys[ki]];
      if (!f) continue;
      total += f.sw * (h / f.sh);
    }
    return total;
  }

  function text(ctx, str, x, y, o) {
    o = o || {};
    ctx.save();
    ctx.font = (o.bold === false ? '' : 'bold ') + (o.size || 22) + 'px ' + (o.font || '"Microsoft YaHei", sans-serif');
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.stroke !== false) {
      ctx.lineWidth = o.lineWidth || Math.max(3, (o.size || 22) * 0.22);
      ctx.strokeStyle = o.strokeColor || 'rgba(0,0,0,.72)';
      ctx.lineJoin = 'round';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = o.color || '#ffe066';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  // Draw an original-style button; returns {x,y,w,h}. o: {sheet,label,w,h,text,size,tcolor,tstroke,onClick}.
  function drawButton(ctx, x, y, w, h, o) {
    o = o || {};
    const sheetId = o.sheet || 'button3';
    const label = o.label == null ? '1' : String(o.label);
    const sh = SHEETS[sheetId];
    ctx.save();
    if (sh && sh.frames[label]) {
      const f = sh.frames[label];
      if (o.pressed) ctx.globalAlpha = 0.86;
      ctx.drawImage(sh.img, f.sx, f.sy, f.sw, f.sh, x, y, w, h);
      if (o.disabled) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#333';
        ctx.fillRect(x, y, w, h);
      }
    } else {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#f7d08a'); g.addColorStop(1, '#e8a33d');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.lineWidth = 3; ctx.strokeStyle = '#8a4b1f'; ctx.strokeRect(x, y, w, h);
    }
    ctx.restore();
    if (o.text) {
      text(ctx, o.text, x + w / 2, y + h / 2 + (o.size || 20) * 0.36, {
        size: o.size || 20, align: 'center', color: o.tcolor || '#fff6d8',
        strokeColor: o.tstroke || 'rgba(90,40,0,.85)', lineWidth: (o.size || 20) * 0.26,
      });
    }
    return { x: x, y: y, w: w, h: h };
  }

  // Only ids that actually have files (anniu/qita/ss/button1-3 are missing from the original pack).
  const CORE_SHEETS = [
    'SQ_01', 'SQ_02', 'weaponAttack', 'throwweaponAttack',
    'fightNum_r', 'fightNum_g', 'fightNum_y', 'tilishuzi', 'energyNum', 'expNum', 'jingyanshuzi', 'num_28', 'num_36',
    'effectCommonAttack', 'weaponEffect', 'throwEffect', 'win_effect', 'die', 'runAround', 'hurtRunBack', 'beatBack', 'think',
    'skill_6', 'skill_7', 'skill_8', 'skill_9', 'skill_13', 'skill_14', 'skill_15', 'skill_16_1', 'skill_16_2',
    'skill_17', 'skill_18', 'skill_23', 'skill_8_d', 'skill_9_d', 'skill_15_d', 'skill_18_d_1', 'skill_18_d_2',
    'lightning1', 'lightning2', 'lightning3', 'lightning4', 'lightning5',
    'tl', 'tl_effect', 'xh1', 'xh2', 'xh_effect1', 'xh_effect2', 'xm1', 'xm2', 'xm_effect',
    'woodman1', 'woodman2', 'woodman_effect',
    'fightBg', 'fightBack', 'fightMid', 'fightFront',
    'fightBg_robot_mid', 'fightBg_robot_front', 'fightBg_robot_effect',
    'fightBg_meltRoom_front', 'fightBg_meltRoom_effect',
    'fightBg_wood_1', 'fightBg_wood_3', 'fightBg_wood_4', 'fightBg_wood_effect2', 'fightBg_wood_effect6',
    'fightBg_seaWorld_front', 'fightBg_seaWorld_effect',
    'wuqi', 'wuqi2', 'jineng', 'daoju', 'jinbeidaoju', 'tudi', 'go', 'starter_effect',
    'shouyebiao', 'resource_1', 'resource_2', 'resource_3', 'resource_4', 'resource_5', 'resource_6', 'resource_7',
    'resource_9', 'resource_10', 'resource_11', 'resource_12', 'resource_13', 'resource_14', 'resource_15', 'resource_16',
    'resource8', 'shengbai', 'new', 'loadingp', 'loadingShadow', 'substarate', 'substarate0', 'tanchutiao',
    'draw', 'activity', 'GM_01', 'GM_02', 'openLogo', 'shade', 'plus', 'minus',
  ];

  // Give failed images another chance on foreground: Honor/Huawei WebView reclaim images while
  // backgrounded. retryFailedImages only touches the failed table, so this is a no-op normally.
  try {
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') retryFailedImages();
      });
    }
  } catch (e) {}
  window.Engine = {
    W: W, H: H,
    SRC_MAP: SRC_MAP,
    SHEETS: SHEETS,
    CORE_SHEETS: CORE_SHEETS,
    getDef: getDef, frameList: frameList, frameAt: frameAt,
    loadImage: loadImage, loadUrl: loadUrl, loadSheets: loadSheets, loadSheetFromUrl: loadSheetFromUrl,
    // Battle image-loss recovery: direct refetch / fetch→blob fallback / canvas health check / forced swap.
    retrySheet, retrySheets, retryFailedImages, missingSheets, imagesHealthy, recoverSheets,
    sheet: sheet, spriteFor: spriteFor, spriteIn: spriteIn, pinSheets: pinSheets, frameSize: frameSize, has: has,
    ensureMutantSheets: ensureMutantSheets, mutantSheets: mutantSheets,
    // Modern outfit coverage table: the appearance page filters undrawable gear and the draw layer clamps tiers.
    hasModernOutfit: hasModernOutfit, modernOutfitTier: modernOutfitTier, MODERN_OUTFIT_TIERS: MODERN_OUTFIT_TIERS,
    anim: anim, hasAnim: hasAnim, animNames: animNames,
    drawFrame: drawFrame, drawSprite: drawSprite,
    frameBounds: frameBounds, wearsFor: wearsFor, loadWears: loadWears,
    makePlayer: makePlayer, playAnim: playAnim, updatePlayer: updatePlayer, drawPlayer: drawPlayer, killInst: killInst,
    drawNumber: drawNumber, measureNumber: measureNumber, numKeys: numKeys,
    text: text, drawButton: drawButton,
    log: log,
  };
})();
