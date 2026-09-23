/* ============================================================
 * engine.js — 素材加载 & 原版 AnimationStr 动画播放器
 *
 * 原版坐标体系（经实测校准）：
 *   · 舞台 = 1170 x 690，所有动画元素的 (tx,ty) 就是该坐标系下的绝对位置
 *   · 元素自带缩放 (a,b,c,d)，Q.scale 全局缩放 = 1
 *   · 图元标签 "75" 为占位/定位点，永远不绘制
 *   · 标签 > 1000 为武器替身槽（1001-1017 / 1101-1117 / 1201-1217）
 *
 * 数据来源：js/orig/animationStr.js（AnimationStr）、assets.js /
 * asset2.js（imgMap 帧表 + 图片路径表）
 * ============================================================ */
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

  // ---------- 帧表工具：兼容 data.js 的两种帧表格式 ----------
  // A 类（assets.js）：["label", x, y, w, h, regX, regY]
  // B 类（asset2.js）：[label, x, y, "a-b"|"all", gridSize]
  function getDef(id) {
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
  /** 把一条帧记录转成 {sx,sy,sw,sh,regX,regY}；B 类需要图宽来换算网格 */
  function normFrame(f, imgW, imgH) {
    const x = +f[1], y = +f[2];
    const dim = f[3], grid = +f[4] || 1;
    if (typeof dim === 'string') {
      let w, h, regX = 0, regY = 0;
      if (dim === 'all') { w = Math.max(1, Math.floor((imgW - x) / grid)); h = Math.max(1, Math.floor((imgH - y) / grid)); }
      else {
        const m = dim.split('-').map(Number);
        w = Math.max(1, Math.floor((m[1] - m[0] + 1) * grid));
        h = w;
      }
      return { sx: x, sy: y, sw: w, sh: h, regX: regX, regY: regY };
    }
    return { sx: x, sy: y, sw: +dim || 1, sh: +f[4] || 1, regX: +f[5] || 0, regY: +f[6] || 0 };
  }

  // ---------- 图片路径表 ----------
  const SRC_MAP = {};
  (function buildSrcMap() {
    if (typeof asstes !== 'undefined' && Array.isArray(asstes)) for (const a of asstes) if (a && a.id) SRC_MAP[a.id] = a.src;
    for (const k of Object.getOwnPropertyNames(window)) {
      if (!/^asset/.test(k)) continue;
      const v = window[k];
      if (Array.isArray(v)) { for (const a of v) if (a && a.id && a.src) SRC_MAP[a.id] = a.src; }
    }
    // 装备图标（asset2.js 已给出，这里兜底）
    if (HAS_IMGMAP && Array.isArray(imgMap.keys)) {
      for (const t of ['Arm', 'Body', 'Foot', 'HandI', 'HandO', 'Head']) {
        for (const key of imgMap.keys) if (String(key).indexOf(t + '_') === 0) SRC_MAP[key] = 'images/equip/' + t + '/' + key + '.png';
      }
    }
  })();

  /** 按 id 猜图片路径（兜底） */
  const SOURCE_ALIAS = {
    // 原版把首页元素单独切成一个 movieclip（shouyebiao），
    // 它的位图与 resource_1 是同一张，只是帧表不同。
    shouyebiao: 'images/resource_1.png',
  };
  function guessSrc(id) {
    if (SRC_MAP[id]) return SRC_MAP[id];
    if (SOURCE_ALIAS[id]) return SOURCE_ALIAS[id];
    if (/^(Head|HandO|HandI|Body|Arm|Foot)_/.test(id)) return 'images/equip/' + id.split('_')[0] + '/' + id + '.png';
    return null;
  }

  // ---------- 图片加载 ----------
  const cache = Object.create(null);   // src -> {img, ok}
  const pendingImages = Object.create(null);
  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    const c = cache[src];
    if (c) return c.ok ? Promise.resolve(c.img) : Promise.resolve(null);
    if (pendingImages[src]) return pendingImages[src];
    pendingImages[src] = new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        cache[src] = { img: ok ? img : null, ok };
        delete pendingImages[src];
        if (!ok) log('img-fail ' + src);
        resolve(ok ? img : null);
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      try { img.src = src; } catch (e) { finish(false); }
      // 极端环境下 onload 可能不触发，做个兜底
      setTimeout(() => finish(false), 12000);
    });
    return pendingImages[src];
  }
  function loadUrl(url) { return loadImage(url); }

  // ---------- 标签 -> 图集 索引（后注册的优先，便于覆盖） ----------
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
  /** 在指定的图集列表里按优先级找 label（避免不同角色/场景同名标签互相污染） */
  function spriteIn(ids, label) {
    for (const id of ids) {
      const sh = SHEETS[id];
      if (!sh || !sh.img || !sh.img.naturalWidth) continue;
      const fr = sh.frames[label];
      if (fr) return { sh: sh, fr: fr };
    }
    return null;
  }
  /** 把某些图集提升到全局索引的最后（最高优先级），避免同名标签被场景图集抢走 */
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

  // ---------- 图集（sheet）注册 ----------
  const SHEETS = Object.create(null);   // id -> {id, img, w, h, def, frames:{label:frame}}
  function registerSheet(id, img) {
    if (SHEETS[id]) return SHEETS[id];
    const def = getDef(id);
    const sh = { id: id, img: img, w: img.width, h: img.height, def: def, frames: Object.create(null) };
    const list = frameList(def);
    if (list) {
      for (const f of list) {
        const key = String(f[0]);
        if (!sh.frames[key]) sh.frames[key] = normFrame(f, img.width, img.height);
      }
    } else if (def && def.w && def.h) {
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
  /** 加载一批图集（按 id） */
  function loadSheets(ids) {
    const jobs = [];
    for (const id of ids) {
      if (!id || SHEETS[id]) continue;
      const src = guessSrc(id);
      jobs.push(loadImage(src).then((img) => (img ? registerSheet(id, img) : null)));
    }
    return Promise.all(jobs);
  }
  /** 直接按文件路径加载并注册一个图集（原版有些图没有 id 记录） */
  function loadSheetFromUrl(id, url) {
    if (SHEETS[id]) return Promise.resolve(SHEETS[id]);
    return loadImage(url).then((img) => (img ? registerSheet(id, img) : null));
  }
  function sheet(id) { return SHEETS[id] || null; }

  // ---------- 动画数据 ----------
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

  // ---------- 绘制 ----------
  const WEAR_LABELS = { '-1': 0, '4': 1, '5': 2, '1': 3, '3': 4, '6': 5 };
  /** 原版 Drawable.drawSquirrel 的六个替换位；支持装备实例列表、槽位对象和旧版 wears 字符串。 */
  function wearsFor(source) {
    const out = [null, null, null, null, null, null];
    if (!source) return out;
    function add(item, slot) {
      if (!item) return;
      if (item.src) { out[slot] = { src: item.src, label: String(item.label == null ? 0 : item.label) }; return; }
      const parts = typeof item === 'string' ? item.split(':') : [];
      const id = parts.length ? Number(parts[0]) : Number(item.id || item);
      let level = item.maxLevel || 1;
      if (Array.isArray(item.ext)) for (const e of item.ext) level = Math.max(level, Number(e.level) || 1);
      for (let i = 3; i < parts.length; i += 2) level = Math.max(level, Number(parts[i]) || 1);
      let gear, set;
      try { gear = gearMap.getValue(id); set = gear && gearSetMap.getValue(gear.setId); } catch (e) { return; }
      if (!gear || !set) return;
      const type = Number(gear.type), index = Number(set.index), tier = Math.min(3, level);
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
      for (const [x, y] of [[0, 0], [f.sw, 0], [0, f.sh], [f.sw, f.sh]]) {
        const tx = el.tx + (x - f.regX) * el.a + (y - f.regY) * el.c;
        const ty = el.ty + (x - f.regX) * el.b + (y - f.regY) * el.d;
        minX = Math.min(minX, tx); minY = Math.min(minY, ty); maxX = Math.max(maxX, tx); maxY = Math.max(maxY, ty);
      }
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  }
  /** 绘制一帧动画到 ctx（调用前请先 setTransform(1,0,0,1,0,0)） */
  function drawFrame(ctx, frame, opt) {
    if (!frame) return 0;
    opt = opt || {};
    const scale = opt.scale == null ? 1 : opt.scale;
    const ox = opt.x || 0, oy = opt.y || 0;
    const mirror = !!opt.mirror;
    const filters = opt.only || null;     // 只画这些标签（数组或 Set）
    const exclude = opt.exclude || null;
    const wl = opt.weaponLabel == null ? null : String(opt.weaponLabel);
    const sheets = opt.sheets || null;    // 指定图集（按优先级）；不指定则用全局标签索引
    let n = 0;
    const hasFilter = filters ? (typeof filters.has === 'function' ? (l) => filters.has(l) : (l) => filters.indexOf(l) >= 0) : null;
    const hasExclude = exclude ? (typeof exclude.has === 'function' ? (l) => exclude.has(l) : (l) => exclude.indexOf(l) >= 0) : null;
    for (const el of frame) {
      let label = el.label;
      if (!label) continue;
      if (label === '75') continue;
      if (+label > 1000) {
        if (wl == null) continue;
        label = wl;   // 武器替身
      }
      if (hasFilter && !hasFilter(label)) continue;
      if (hasExclude && hasExclude(label)) continue;
      const sp = frameSprite(label, opt);
      if (!sp) continue;
      const f = sp.fr;
      let a = el.a * scale, b = el.b * scale, c = el.c * scale, d = el.d * scale;
      let tx = (el.tx - (f.regX * el.a + f.regY * el.c)) * scale;
      let ty = (el.ty - (f.regX * el.b + f.regY * el.d)) * scale;
      if (mirror) { a = -a; c = -c; tx = -tx + (W + ox) * scale; ty += oy * scale; }
      else { tx += ox * scale; ty += oy * scale; }
      ctx.save();
      ctx.globalAlpha *= el.alpha * (opt.alpha == null ? 1 : opt.alpha);
      ctx.transform(a, b, c, d, tx, ty);
      ctx.drawImage(sp.sh.img, f.sx, f.sy, f.sw, f.sh, 0, 0, f.sw, f.sh);
      ctx.restore();
      n++;
    }
    return n;
  }

  /** 静态图元（按标签取图集帧）绘制到 (dx,dy)，dw/dh 为显示尺寸 */
  function drawSprite(ctx, id, label, dx, dy, dw, dh) {
    const sh = SHEETS[id];
    if (!sh || !sh.img || !sh.img.naturalWidth) return false;
    const f = sh.frames[String(label)] || sh.frames[String(label).toUpperCase()];
    if (!f) return false;
    ctx.drawImage(sh.img, f.sx, f.sy, f.sw, f.sh, dx, dy, dw == null ? f.sw : dw, dh == null ? f.sh : dh);
    return true;
  }
  function frameSize(id, label) {
    const sh = SHEETS[id];
    if (!sh) return null;
    const f = sh.frames[String(label)];
    return f ? { w: f.sw, h: f.sh } : null;
  }
  function has(id) { const sh = SHEETS[id]; return !!(sh && sh.img && sh.img.naturalWidth); }

  // ---------- 动画播放器 ----------
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

  // ---------- 数字（原版位图数字） ----------
  function numKeys(id) {
    const def = getDef(id);
    if (def && def.k) return String(def.k).split(',');
    const sh = SHEETS[id];
    if (sh) return Object.keys(sh.frames);
    return [];
  }
  /**
   * 用位图数字绘制数值。
   * sheetId: fightNum_r / fightNum_g / fightNum_y / jingyanshuzi / num_28 / energyNum ...
   * o: {align:'left'|'center'|'right', h: 显示高度, gap: 字距, sx: 缩放}
   */
  function drawNumber(ctx, sheetId, text, x, y, o) {
    const sh = SHEETS[sheetId];
    if (!sh) return 0;
    o = o || {};
    const keys = numKeys(sheetId);
    const chars = String(text).split('');
    let h = o.h != null ? o.h : frameSize(sheetId, keys[0]) ? frameSize(sheetId, keys[0]).h : 24;
    const gap = o.gap == null ? 0 : o.gap;
    // 量宽
    const items = [];
    let total = 0;
    for (const ch of chars) {
      const ki = keys.indexOf(ch);
      if (ki < 0) continue;   // 未收录的字符（如 "/"）直接跳过，不画成 0
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

  // ---------- 文字（描边） ----------
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

  // ---------- 位图按钮（原版按钮贴图 + 文字） ----------
  /**
   * 绘制一个原版风格按钮。返回 {x,y,w,h}
   * o: {sheet:'button3', label:'1', w, h, text, size, tcolor, tstroke, onClick}
   */
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

  // ---------- 模块内用到的所有图集 id（供 battle / main 预加载） ----------
  // 只列 data.js 里真实存在图片文件的 id（anniu/qita/ss/button1-3 等在原版素材包中缺失）
  const CORE_SHEETS = [
    // 角色 / 武器
    'SQ_01', 'SQ_02', 'weaponAttack', 'throwweaponAttack',
    // 位图数字
    'fightNum_r', 'fightNum_g', 'fightNum_y', 'tilishuzi', 'energyNum', 'expNum', 'jingyanshuzi', 'num_28', 'num_36',
    // 通用特效
    'effectCommonAttack', 'weaponEffect', 'throwEffect', 'win_effect', 'die', 'runAround', 'hurtRunBack', 'beatBack', 'think',
    'skill_6', 'skill_7', 'skill_8', 'skill_9', 'skill_13', 'skill_14', 'skill_15', 'skill_16_1', 'skill_16_2',
    'skill_17', 'skill_18', 'skill_23', 'skill_8_d', 'skill_9_d', 'skill_15_d', 'skill_18_d_1', 'skill_18_d_2',
    'lightning1', 'lightning2', 'lightning3', 'lightning4', 'lightning5',
    // NPC
    'tl', 'tl_effect', 'xh1', 'xh2', 'xh_effect1', 'xh_effect2', 'xm1', 'xm2', 'xm_effect',
    'woodman1', 'woodman2', 'woodman_effect',
    // 场地
    'fightBg', 'fightBack', 'fightMid', 'fightFront',
    'fightBg_robot_mid', 'fightBg_robot_front', 'fightBg_robot_effect',
    'fightBg_meltRoom_front', 'fightBg_meltRoom_effect',
    'fightBg_wood_1', 'fightBg_wood_3', 'fightBg_wood_4', 'fightBg_wood_effect2', 'fightBg_wood_effect6',
    'fightBg_seaWorld_front', 'fightBg_seaWorld_effect',
    // 图标
    'wuqi', 'wuqi2', 'jineng', 'daoju', 'jinbeidaoju', 'tudi', 'go', 'starter_effect',
    // UI
    'shouyebiao', 'resource_1', 'resource_2', 'resource_3', 'resource_4', 'resource_5', 'resource_6', 'resource_7',
    'resource_9', 'resource_10', 'resource_11', 'resource_12', 'resource_13', 'resource_14', 'resource_15', 'resource_16',
    'resource8', 'shengbai', 'new', 'loadingp', 'loadingShadow', 'substarate', 'substarate0', 'tanchutiao',
    'draw', 'activity', 'GM_01', 'GM_02', 'openLogo', 'shade', 'plus', 'minus',
  ];

  window.Engine = {
    W: W, H: H,
    SRC_MAP: SRC_MAP,
    SHEETS: SHEETS,
    CORE_SHEETS: CORE_SHEETS,
    getDef: getDef, frameList: frameList, frameAt: frameAt,
    loadImage: loadImage, loadUrl: loadUrl, loadSheets: loadSheets, loadSheetFromUrl: loadSheetFromUrl,
    sheet: sheet, spriteFor: spriteFor, spriteIn: spriteIn, pinSheets: pinSheets, frameSize: frameSize, has: has,
    anim: anim, hasAnim: hasAnim, animNames: animNames,
    drawFrame: drawFrame, drawSprite: drawSprite,
    frameBounds: frameBounds, wearsFor: wearsFor, loadWears: loadWears,
    makePlayer: makePlayer, playAnim: playAnim, updatePlayer: updatePlayer, drawPlayer: drawPlayer, killInst: killInst,
    drawNumber: drawNumber, measureNumber: measureNumber, numKeys: numKeys,
    text: text, drawButton: drawButton,
    log: log,
  };
})();
