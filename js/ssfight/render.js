// 经典界面时间轴/SVG 解释器：素材 images/ssfight/ui/，入口 SfRender.mount / mountSymbol。
// 只解释已提交素材；不支持的 Flash 动作和通用滤镜不模拟。
(function () {
  'use strict';

  const BASE = 'images/ssfight/ui/';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';

  let bundle = null;
  let loadPromise = null;
  const extraPromises = new Map();
  const releaseTimers = new Map();

  // 先 force-cache；失败再用 no-store 重取：换包后 WebView 可能缓存了上一版/被截断的同 URL 响应，
  // 原样重试会一直命中坏缓存（经典主页挂不出来）。
  async function fetchJson(file, noCache) {
    const r = await fetch(BASE + file, noCache ? { cache: 'no-store' } : { cache: 'force-cache' });
    if (!r || !r.ok) throw new Error('素材包缺失：' + file);
    return r.json();
  }
  async function fetchJsonRetry(file) {
    try { return await fetchJson(file); }
    catch (e) { return fetchJson(file, true); }
  }
  async function load() {
    if (bundle) return bundle;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const [tl, tags, textFields] = await Promise.all([
        fetchJsonRetry('timeline.json'),
        fetchJsonRetry('tags.json'),
        // EditText boxes/alignment come from SWF metadata, not exported glyph baselines.
        fetchJsonRetry('textfields.json').catch(() => ({})),
      ]);
      const hash = new Map();
      for (const t of tags) hash.set(String(t.id), t);
      bundle = { timeline: tl, tags, hash, textFields, extraLists: new Map() };
      return bundle;
    })();
    try { return await loadPromise; }
    finally { loadPromise = null; }
  }
  function loaded() { return !!bundle; }

  function rebuildHash(clearBBox) {
    const hash = new Map();
    for (const t of bundle.tags) hash.set(String(t.id), t);
    for (const [file, list] of bundle.extraLists) {
      const exactGear = file === 'tags-gear.json' || file === 'tags-gear-color.json';
      for (const t of list) {
        const k = String(t.id);
        /* 两套装备包都从原 SWF 恢复 MATRIX 精度，共享标签在生成时校验一致。
         * 覆盖页面里同 id 的旧舍入稿；其余包不能因切页顺序把精度降回去。 */
        if (exactGear || !hash.has(k)) hash.set(k, t);
      }
    }
    bundle.hash = hash;
    /* 已量过的父容器可能依赖刚校准的子元件，下一次挂载须重新量真实边界。 */
    if (clearBBox) bboxCache.clear();
  }

  /* 小体积静态表（装备帧号 / 挂点 / 图标映射）：多个页面共用，一次会话只取一次。
   * 与 `loadExtra` 分开：tags 包会按页面释放，这些表不参与释放。 */
  const tablePromises = new Map();
  function loadTable(file) {
    const key = String(file);
    const hit = tablePromises.get(key);
    if (hit) return hit;
    const pending = fetchJsonRetry(key).catch((e) => {
      tablePromises.delete(key);
      throw e;
    });
    tablePromises.set(key, pending);
    return pending;
  }

  // 按需加载装备包（tags-gear*.json 约 1.8MB）；不要并进 tags.json，否则每次进首页都白拉。
  async function loadExtra(file) {
    cancelExtraRelease(file);
    const b = await load();
    if (b.extra && b.extra.has(file)) return b;
    if (extraPromises.has(file)) return extraPromises.get(file);
    const pending = (async () => {
      const list = await fetchJsonRetry(file);
      const exactGear = file === 'tags-gear.json' || file === 'tags-gear-color.json';
      b.extraLists.set(file, list);
      rebuildHash(exactGear);
      if (!b.extra) b.extra = new Set();
      b.extra.add(file);
      return b;
    })();
    extraPromises.set(file, pending);
    try { return await pending; }
    finally { extraPromises.delete(file); }
  }

  function cancelExtraRelease(file) {
    const timer = releaseTimers.get(file);
    if (!timer) return;
    releaseTimers.delete(file);
    if (timer.kind === 'idle') {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(timer.id);
    } else clearTimeout(timer.id);
  }

  function releaseExtra(file) {
    cancelExtraRelease(file);
    if (!bundle || !bundle.extraLists || !bundle.extraLists.has(file)) return false;
    bundle.extraLists.delete(file);
    if (bundle.extra) bundle.extra.delete(file);
    rebuildHash(true);
    return true;
  }

  /** 延后到空闲帧再释放：给离场动画 / 返回首页让出主线程；同一包再次 loadExtra 会取消。 */
  function queueExtraRelease(file, delayMs) {
    if (!bundle || !bundle.extraLists || !bundle.extraLists.has(file)) return false;
    cancelExtraRelease(file);
    const timer = setTimeout(() => {
      releaseTimers.delete(file);
      const run = () => {
        const hold = releaseTimers.get(file);
        if (!hold || hold.kind !== 'idle') return;
        releaseExtra(file);
      };
      if (typeof requestIdleCallback === 'function') {
        const idle = requestIdleCallback(run, { timeout: 2000 });
        releaseTimers.set(file, { kind: 'idle', id: idle });
      } else releaseExtra(file);
    }, Math.max(0, Number(delayMs) || 0));
    releaseTimers.set(file, { kind: 'timeout', id: timer });
    return true;
  }

  const el = (name, attrs) => {
    const n = document.createElementNS(SVGNS, name);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    return n;
  };

  /* 同一页的 `<defs>` 会挂几百个渐变 / 滤镜；逐个 querySelector 是 O(n²)。
   * 用挂在 defs 节点上的集合记账，与 DOM 同生命周期。 */
  function defIds(rootDefs) {
    if (!rootDefs.__defIds) rootDefs.__defIds = new Set();
    return rootDefs.__defIds;
  }
  function hasDef(rootDefs, id) { return defIds(rootDefs).has(id); }
  function addDef(rootDefs, id, node) {
    defIds(rootDefs).add(id);
    rootDefs.appendChild(node);
  }

  function gradientNode(kind, spec, id) {
    const g = el(kind === 3 ? 'radialGradient' : 'linearGradient', { id });
    for (const k in spec) {
      if (k === 'sp' || k === 'tp' || k === 'image') continue;
      if (typeof spec[k] === 'object') continue;
      g.setAttribute(k, spec[k]);
    }
    for (const s of spec.sp || []) {
      const st = el('stop');
      for (const k in s) if (typeof s[k] !== 'object') st.setAttribute(k, s[k]);
      g.appendChild(st);
    }
    return g;
  }

  function patternNode(spec, id) {
    const p = el('pattern', { id });
    for (const k in spec) {
      if (k === 'image' || k === 'tp') continue;
      if (typeof spec[k] === 'object') continue;
      p.setAttribute(k, spec[k]);
    }
    const img = el('image');
    for (const k in spec.image || {}) {
      const v = spec.image[k];
      if (k === 'xlink:href' || k === 'href') img.setAttributeNS(XLINK, 'href', BASE + v);
      else img.setAttribute(k, v);
    }
    p.appendChild(img);
    return p;
  }

  function shapeNode(rootDefs, tag) {
    const g = el('g', { type: 'shape' });
    for (const seg of tag.pt || []) {
      // Flash segments without a fill style are not painted; SVG defaults to black.
      const path = el('path', { d: seg.da, fill: 'none' });
      if (seg.fi !== undefined) {
        const f = (tag.Fs || [])[seg.fi];
        if (f) {
          if (f.tp === 1) {
            path.setAttribute('fill', f.c || '#000000');
            if (f['fill-opacity'] !== undefined) path.setAttribute('fill-opacity', f['fill-opacity']);
          } else {
            const id = 'f' + tag.id + ':' + seg.fi;
            if (!hasDef(rootDefs, id)) {
              addDef(rootDefs, id, f.tp === 3
                ? gradientNode(3, f, id)
                : f.tp === 2 ? gradientNode(2, f, id) : patternNode(f, id));
            }
            path.setAttribute('fill', 'url(#' + id + ')');
          }
        }
      }
      if (seg.ln !== undefined) {
        const l = (tag.Ls || [])[seg.ln];
        if (l) {
          for (const k in l) if (typeof l[k] !== 'object') path.setAttribute(k, l[k]);
          if (l.fi) {
            const id = 'l' + tag.id + ':' + seg.ln;
            if (!hasDef(rootDefs, id)) {
              addDef(rootDefs, id, l.fi.tp === 3 ? gradientNode(3, l.fi, id) : gradientNode(2, l.fi, id));
            }
            path.setAttribute('stroke', 'url(#' + id + ')');
          }
          // 只有这段本来没有填充时才写 fill:none；无条件写会抹掉"既有填充又有描边"段落的填充。
          if (seg.fi === undefined || !(tag.Fs || [])[seg.fi]) path.setAttribute('fill', 'none');
        }
      }
      g.appendChild(path);
    }
    return g;
  }

  /* SVG <text> 不把 \r/\n 当断行（white-space:pre 也不断）：按 rs 坐标逐字定位，或按 CR/LF 拆行。
   * 行距 = 1.15 × 字号 + lead；不要把行平均摊进字段框高度，否则行距翻倍、末行压到按钮。
   * HTML 文本字段（tt=='html'，rs 带 fs、无 x/y）一个 rs 一行。 */
  const FONT_MAP = { 2030: 'SimHei', 3146: 'Microsoft YaHei' };
  function fontFamily(fd) {
    const s = String(fd == null ? '' : fd);
    const base = /^\d+$/.test(s) ? (FONT_MAP[s] || ('ft' + s)) : (s || 'sans-serif');
    return `'${base}', 'Microsoft YaHei', 'PingFang SC', sans-serif`;
  }
  function textLines(tag) {
    const rs = tag.rs || [];
    if (!rs.length) return [{ tx: '', h: null }];
    const xs = new Set(rs.map((r) => Number(r.x || 0)));
    const perRun = rs.length > 1 && xs.size > 1;          // 每个 rs 自带坐标 = 逐字定位
    if (perRun) {
      return rs.map((r) => ({ tx: r.tx, h: r.h || r.fs, c: r.c, b: r.b, fd: r.fd, x: r.x, y: r.y, run: true }));
    }
    const out = [];
    for (const r of rs) {
      for (const tx of String(r.tx == null ? '' : r.tx).split(/\r\n|\r|\n/)) {
        out.push({ tx, h: r.h || r.fs, c: r.c, b: r.b, fd: r.fd });
      }
    }
    return out.length ? out : [{ tx: '', h: null }];
  }
  // setText(..., { wrap:true }) 时按字段框宽度折行（SVG <text> 不会自动折行）：
  // 优先 canvas 实测宽度，量不到时按全角 1em / ASCII 0.56em 估算。
  const NO_LINE_START = /[，。！？；：、）》】”’…·]/;
  let measureCanvas = null;
  let measureCanvasTried = false;
  function measureContext() {
    if (measureCanvasTried) return measureCanvas;
    measureCanvasTried = true;
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const c = document.createElement('canvas');
      measureCanvas = c && c.getContext ? c.getContext('2d') : null;
    } catch (e) { measureCanvas = null; }
    return measureCanvas;
  }
  function charWidth(ch, em) {
    if (ch === ' ') return em * 0.34;
    return /[\x20-\x7e]/.test(ch) ? em * 0.56 : em;
  }
  function measureTextWidth(text, em, fd) {
    const ctx = measureContext();
    if (ctx) {
      try {
        ctx.font = em + 'px ' + fontFamily(fd);
        const w = ctx.measureText(String(text)).width;
        if (w > 0) return w;
      } catch (e) { /* 退回估算 */ }
    }
    let w = 0;
    for (const ch of String(text)) w += charWidth(ch, em);
    return w;
  }
  /* 安卓 WebView 的数字墨高比 Windows 字体矮（≈0.725em vs 0.775em），按基线画会显得挂低。
   * 只对纯数字短串按当前字体实测墨高抬升 ≤0.05em；中文/混排墨高跨平台一致，不碰。 */
  const DIGIT_REF_ASCENT = 0.775;
  const digitAscentCache = new Map();
  function digitAscent(fd) {
    const key = String(fd == null ? '' : fd);
    if (digitAscentCache.has(key)) return digitAscentCache.get(key);
    let ratio = DIGIT_REF_ASCENT;
    const ctx = measureContext();
    if (ctx) {
      try {
        ctx.font = '100px ' + fontFamily(fd);
        const m = ctx.measureText('0123456789');
        const asc = Number(m && m.actualBoundingBoxAscent);
        if (asc > 0) ratio = Math.min(0.9, Math.max(0.6, asc / 100));
      } catch (e) { /* 量不到就按参考字体处理，差量为 0 */ }
    }
    digitAscentCache.set(key, ratio);
    return ratio;
  }
  function digitLift(text, fd) {
    if (!/^\d{1,4}$/.test(String(text == null ? '' : text).trim())) return 0;
    return Math.max(0, Math.min(0.05, DIGIT_REF_ASCENT - digitAscent(fd)));
  }
  /** 折行单元：ASCII 数字/单词成组，中文标点粘在前一单元后（不让行首出现标点）。 */
  function wrapTokens(text) {
    const tokens = [];
    let ascii = '';
    const flush = () => { if (ascii) { tokens.push(ascii); ascii = ''; } };
    for (const ch of String(text)) {
      if (/[A-Za-z0-9.%+\-]/.test(ch)) { ascii += ch; continue; }
      flush();
      if (NO_LINE_START.test(ch) && tokens.length) tokens[tokens.length - 1] += ch;
      else tokens.push(ch);
    }
    flush();
    return tokens;
  }
  function wrapParagraph(text, maxWidth, em, fd) {
    const tokens = wrapTokens(text);
    const lines = [];
    let line = '';
    for (const token of tokens) {
      if (!line) { line = token; continue; }
      if (measureTextWidth(line + token, em, fd) <= maxWidth) { line += token; continue; }
      lines.push(line);
      line = token;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }
  function wrapText(node, str) {
    const b = node && node.__textBox;
    const meta = b && b.meta;
    const text = String(str == null ? '' : str);
    if (!b || b.perRun || !meta || !meta.bd) return text;
    const width = Math.max(24, (meta.bd[1] - meta.bd[0]) - (meta.lm || 0) - (meta.rm || 0) - 1);
    const em = (b.lines[0] && b.lines[0].h) || meta.fh || 12;
    return text.split(/\r\n|\r|\n/)
      .flatMap((p) => (p ? wrapParagraph(p, width, em, meta.fd) : ['']))
      .join('\n');
  }
  /** 原版素材写死的占位串（expNum 的 999999/999999、requirement 的 900000），真值由界面挂载后写入。
   *  判据：整串是同一个数字重复且长度 ≥5；不画出来，否则切页瞬间满屏 9999999。 */
  function isPlaceholderRun(tx) {
    const s = String(tx == null ? '' : tx).trim();
    if (s.length < 5) return false;
    // 换素材时在这里补占位串。
    if (s === '900000' || s === '999999/999999') return true;
    if (/^(\d)\1{4,}$/.test(s)) return true;
    const parts = s.split(/[\/\s%×x-]+/).filter(Boolean);
    return parts.length > 0 && parts.every((p) => /^(\d)\1{4,}$/.test(p));
  }
  function drawLines(g) {
    const b = g.__textBox;
    if (!b) return;
    // Numeric/status polling often repeats the same text. Keep glyphs and their clip path intact.
    const signature = JSON.stringify([b.lines, b.perRun, b.x, b.anchor, b.base, b.step,
      b.tag && b.tag.tf, b.meta && b.meta.fh, b.box, b.userText]);
    if (b.renderSignature === signature && b.renderHost && b.renderHost.parentNode === g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    const host = el('g');
    b.lines.forEach((L, i) => {
      // 占位串只在首次建树时藏；界面写进来的真值即使是 11111 / 999999 也要照常显示。
      if (b.userText !== true && isPlaceholderRun(L.tx)) return;
      const t = el('text');
      t.textContent = L.tx == null ? '' : String(L.tx);
      if (L.b) t.setAttribute('font-weight', 'bold');
      t.setAttribute('font-size', L.h || (b.meta && b.meta.fh) || 12);
      t.setAttribute('font-family', fontFamily(L.fd));
      t.setAttribute('fill', L.c || '#000000');
      t.setAttribute('fill-rule', 'nonzero');
      t.setAttribute('style', 'white-space:pre');
      /* 文本自带的 tf 变换必须应用；漏掉文字会落到错位置（村庄页昵称会偏到顶栏下沿）。 */
      if (b.tag && b.tag.tf) t.setAttribute('transform', b.tag.tf);
      if (b.perRun) {
        if (L.x !== undefined) t.setAttribute('x', L.x);
        if (L.y !== undefined) t.setAttribute('y', L.y);
      } else {
        if (b.anchor === 'middle' || b.anchor === 'end') t.setAttribute('text-anchor', b.anchor);
        t.setAttribute('x', b.x);
        const lift = digitLift(L.tx, L.fd) * (Number(L.h) || Number((b.meta && b.meta.fh) || 12));
        t.setAttribute('y', Math.round((b.base + i * b.step - lift) * 100) / 100);
      }
      host.appendChild(t);
    });
    /* 只做横向裁（纵向 -600..600）；clipPath 必须挂在无 transform 的内层 <g> 上，
     * 否则 userSpaceOnUse 会跟着矩阵跑偏。 */
    if (b.box && g.__defs) {
      if (!g.__clipId) {
        g.__clipId = 'sftxt' + (++cpSeq);
        const cp = el('clipPath', { id: g.__clipId, clipPathUnits: 'userSpaceOnUse' });
        cp.appendChild(el('rect', {
          x: b.box.xmin - 0.5, y: -600,
          width: Math.max(1, b.box.xmax - b.box.xmin + 1), height: 1200,
        }));
        g.__defs.appendChild(cp);
      }
      host.setAttribute('clip-path', 'url(#' + g.__clipId + ')');
    }
    g.appendChild(host);
    b.renderSignature = signature;
    b.renderHost = host;
  }
  function textNode(tag, rootDefs) {
    const g = el('g', { type: 'text' });
    const meta = bundle && bundle.textFields ? bundle.textFields[String(tag.id)] : null;
    const lines = textLines(tag);
    const rs = tag.rs || [];
    const perRun = lines.length > 0 && !!lines[0].run;
    /* 有 textfields.json 元数据时按 Flash 规则排版：水平在 [XMin+lm, XMax-rm] 内对齐，
     * 首行基线 = 框顶 + 2 + leading + 0.88×字号；没有元数据则退回 rs 的 x/y。 */
    let box = null, x = 0, anchor = 'start', base = 0, step = 0;
    if (meta && meta.bd) {
      const xmin = meta.bd[0], xmax = meta.bd[1], ymin = meta.bd[2], ymax = meta.bd[3];
      const firstH = lines[0].h || meta.fh || 12;
      // 首行缩进 ind 偶尔是 3275 这类坏值；超过半个框宽就当没有缩进。
      const ind = (meta.ind && meta.ind < (xmax - xmin) / 2) ? meta.ind : 0;
      box = { xmin, xmax, ymin, ymax };
      anchor = meta.al === 2 ? 'middle' : meta.al === 1 ? 'end' : 'start';
      x = meta.al === 2 ? (xmin + xmax) / 2
        : meta.al === 1 ? (xmax - (meta.rm || 0))
          : (xmin + (meta.lm || 0) + ind);
      base = ymin + 2 + (meta.lead || 0) + 0.88 * firstH;
      // 行距 = 1.15em + leading，与行数无关（负数 leading 也照减）。
      step = 1.15 * firstH + (meta.lead || 0);
    } else if (rs[0]) {
      x = rs[0].x !== undefined ? rs[0].x : 0;
      base = rs[0].y !== undefined ? rs[0].y : 0;
    }
    g.__textBox = { tag, meta, lines, perRun, box, x, anchor, base, step, userText: false };
    g.__defs = rootDefs || null;
    drawLines(g);
    return g;
  }
  /** 字号=1 时估算宽度：中文/全角 1em，ASCII 默认 0.56em（SimHei 实测约 0.5em，留余量）；
   *  spacing 为每字字距。只用于 fitTextWidth 兜底，真实宽度仍以浏览器字体为准。 */
  function estimateTextWidth(text, opts) {
    const o = opts || {};
    const ascii = Number.isFinite(Number(o.ascii)) ? Number(o.ascii) : 0.56;
    const spacing = Number.isFinite(Number(o.spacing)) ? Number(o.spacing) : 0;
    const em = Number.isFinite(Number(o.em)) ? Number(o.em) : 1;
    let units = 0, chars = 0;
    for (const ch of String(text == null ? '' : text)) {
      units += /^[\x20-\x7e]$/.test(ch) ? ascii : 1;
      chars++;
    }
    return units * em + chars * spacing;
  }
  /** 放不下时只缩字号（不裁字、不横向压扁）；战场 name1 只有 82.1 宽，7 个汉字就放不下。
   *  opts: ascii / spacing / min / width；返回最终字号（没缩就是原字号）。 */
  function fitTextWidth(node, opts) {
    if (!node || !node.__textBox) return 0;
    const b = node.__textBox;
    const meta = b.meta || {};
    const host = node.g || node;
    const list = host && host.querySelectorAll ? [...host.querySelectorAll('text')] : [];
    if (!list.length) return 0;
    const measured = Number(list[0].getAttribute('font-size')) || (b.lines[0] && b.lines[0].h) || meta.fh || 12;
    /* 同一节点可能每秒重刷（主界面昵称）：以第一次见到的字号为基准，避免越缩越小；
     * setText 重建文本时字号回到素材值。 */
    const KEY = '__sfFitBase';
    if (!(b[KEY] > 0)) b[KEY] = measured;
    const base = b[KEY];
    const W = Number(opts && opts.width) || (b.box ? (b.box.xmax - b.box.xmin - (meta.lm || 0) - (meta.rm || 0)) : 0);
    if (!(W > 0)) return base;
    const spacing = Number.isFinite(Number(opts && opts.spacing)) ? Number(opts.spacing) : 0;
    const min = Number.isFinite(Number(opts && opts.min)) ? Number(opts.min) : 6;
    let widest = 0, widestUnits = 0, widestChars = 0;
    for (const el of list) {
      const text = String(el.textContent == null ? '' : el.textContent);
      const units = estimateTextWidth(text, { ascii: opts && opts.ascii, em: 1 });
      const chars = [...text].length;
      const w = units * base + chars * spacing;
      if (w > widest) { widest = w; widestUnits = units; widestChars = chars; }
    }
    if (!(widest > W + 0.01) || !(widestUnits > 0)) return base;
    const avail = W - widestChars * spacing;
    const size = Math.max(min, Math.floor((avail / widestUnits) * 10) / 10);
    for (const el of list) el.setAttribute('font-size', String(size));
    return size;
  }
  /** 按指定字号重排多行文本：只改 <text> 字号不动行距，第二行会压到下一个字段。
   *  与 textNode 同一套公式：首行基线 = 框顶 + 2 + leading + 0.88×字号，行距 = 1.15×字号 + leading。 */
  function layoutText(node, opts) {
    if (!node || !node.__textBox) return 0;
    const b = node.__textBox;
    const meta = b.meta || {};
    const natural = (b.lines[0] && b.lines[0].h) || meta.fh || 12;
    const size = Math.max(4, Number(opts && opts.size) || natural);
    b.lines = b.lines.map((L) => Object.assign({}, L, { h: size }));
    if (meta.bd) {
      b.base = meta.bd[2] + 2 + (meta.lead || 0) + 0.88 * size;
      b.step = 1.15 * size + (meta.lead || 0);
    }
    b.renderSignature = null;
    drawLines(node);
    return size;
  }
  /** 换文本：str 里的 \r/\n 会真实断行；opts.wrap=true 时按字段框宽自动折行。
   *  返回 false = 不是文本容器，调用方自行兜底。 */
  function setText(node, str, opts) {
    if (!node || !node.__textBox) return false;
    const b = node.__textBox;
    b.userText = true;
    // noClip：战斗 HUD 血量框仅 59 宽，六位数以上生命会被裁掉；只对 refreshBlood 放开。
    if (opts && opts.noClip) { b.box = null; b.renderSignature = null; }
    const text = (opts && opts.wrap) ? wrapText(node, str) : String(str == null ? '' : str);
    const h0 = (b.lines[0] && b.lines[0].h) || null;
    if (b.perRun) {
      /* 逐字定位的字段（"正在等待队友…"那种一个字一个 rs）：只写第一个 rs，其余清空 ——
       * 整串塞进每一个 rs 会叠成一团黑影。 */
      b.lines = b.lines.map((L, i) => Object.assign({}, L, { tx: i === 0 ? text : '' }));
    } else {
      b.lines = text.split(/\r\n|\r|\n/).map((tx, i) => {
        const proto = b.lines[Math.min(i, b.lines.length - 1)] || {};
        return { tx, h: h0 || proto.h, c: proto.c, b: proto.b, fd: proto.fd };
      });
    }
    drawLines(node);
    return true;
  }

  /* 颜色变换 cx = {Rm,Ra,Gm,Ga,Bm,Ba,Am,Aa}（0~256 乘/加）；用滤镜等价表达，不碰填充。
   * 导出里 cx 直接挂在放置上（p.cx），没有 p.cx.cx 这一层；两种形状都兼容。 */
  function cxOf(p) {
    const c = p && p.cx;
    if (!c) return null;
    return (c.cx && typeof c.cx === 'object') ? c.cx : c;
  }
  function cxFilterFor(rootDefs, tagId, depth, c) {
    const key = ['Rm', 'Ra', 'Gm', 'Ga', 'Bm', 'Ba', 'Am', 'Aa']
      .map((k) => (c[k] === undefined ? '' : String(c[k]))).join('_');
    const id = 'cx' + tagId + '_' + depth + '_' + key;
    if (!hasDef(rootDefs, id)) cxFilter(rootDefs, id, c);
    return id;
  }
  function cxFilter(rootDefs, id, c) {
    const f = el('filter', { id, x: '-20%', y: '-20%', width: '140%', height: '140%',
      'color-interpolation-filters': 'sRGB' });
    const ct = el('feComponentTransfer');
    f.appendChild(ct);
    const map = [['R', 'Rm', 'Ra'], ['G', 'Gm', 'Ga'], ['B', 'Bm', 'Ba'], ['A', 'Am', 'Aa']];
    for (const [ch, mk, ak] of map) {
      const fn = el('feFunc' + ch, { type: 'linear' });
      if (c[mk] !== undefined) fn.setAttribute('slope', c[mk] / 256);
      if (c[ak] !== undefined) fn.setAttribute('intercept', c[ak] / 255);
      ct.appendChild(fn);
    }
    addDef(rootDefs, id, f);
    return id;
  }

  /* 纯色填充/描边直接做线性变换（公式同 cxFilter），省掉 SVG 滤镜：带装备的战斗滤镜可到
   * 100+ 个，Android WebView 上拖帧且部分 GPU 会画丢、画黑；渐变/图案/位图/嵌套滤镜保留原滤镜。
   * 只烘焙不透明 rgb：rgba 的 alpha 不在 feFuncRGB 里，烘焙会把它变成不透明。 */
  const COLOR_RGB = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i;
  const COLOR_HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  function parseSolidColor(v) {
    const s = String(v || '').trim();
    if (!s) return null;
    let m = COLOR_RGB.exec(s);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    m = COLOR_HEX.exec(s);
    if (m) {
      const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return null;
  }
  /** 与 `cxFilter` 的 feFuncX 线性档同一公式。 */
  function cxChannel(c, mk, ak, value) {
    const slope = c[mk] === undefined ? 1 : Number(c[mk]) / 256;
    const intercept = c[ak] === undefined ? 0 : Number(c[ak]);
    return Math.max(0, Math.min(255, Math.round(slope * value + intercept)));
  }
  /** 只改 RGB 且 alpha 恒等才烘焙；否则整组交给滤镜。 */
  function cxRgbOnly(c) {
    if (!c) return false;
    const am = c.Am === undefined ? 256 : Number(c.Am);
    const aa = c.Aa === undefined ? 0 : Number(c.Aa);
    return am === 256 && aa === 0;
  }
  const PAINT_TAGS = { path: 1, rect: 1, circle: 1, ellipse: 1, polygon: 1, polyline: 1, text: 1 };
  /** 深度遍历元素（不用逗号选择器：最小 DOM 回归只认单选择器）。 */
  function walkElements(node, fn) {
    for (const c of node.childNodes || []) {
      if (!c || c.nodeType !== 1) continue;
      fn(c);
      walkElements(c, fn);
    }
  }
  function colorPaintList(node) {
    if (!node || !node.childNodes) return null;
    /* 节点自己是多帧 MovieClip 时不能把父级 cx 烘进当前画稿：下一帧会换掉内部节点，
     * 烘过的颜色当场丢失；这一档挂父级 filter。 */
    if (node.__clip && node.__clip.frames && node.__clip.frames.length > 1) return null;
    // 子树已有滤镜、或别的节点烘过 cx（嵌套变换）：父级再烘会覆盖子级合成，保留滤镜。
    let blocked = false;
    walkElements(node, (p) => {
      if (blocked) return;
      if (p.getAttribute('filter') != null) { blocked = true; return; }
      if (p.__sfBakedBy && p.__sfBakedBy !== node) { blocked = true; return; }
      // 子树还有多帧 MovieClip：换帧后的新画稿不经过父级烘焙，必须挂父级 filter。
      if (p.__clip && p.__clip.frames && p.__clip.frames.length > 1) { blocked = true; return; }
      if (!PAINT_TAGS[String(p.tagName || '').toLowerCase()]) return;
      for (const attr of ['fill', 'stroke']) {
        const raw = p.getAttribute(attr);
        if (raw == null || raw === 'none') continue;
        if (/^url\(/i.test(raw)) { blocked = true; return; }  // 渐变 / 图案 / 位图
        if (/^(inherit|currentColor|context-fill|context-stroke)$/i.test(raw)) { blocked = true; return; }
        if (!parseSolidColor((p.__sfBasePaint && p.__sfBasePaint[attr]) || raw)) { blocked = true; return; }
      }
    });
    if (blocked) return null;
    const paints = [];
    walkElements(node, (p) => {
      if (!PAINT_TAGS[String(p.tagName || '').toLowerCase()]) return;
      for (const attr of ['fill', 'stroke']) {
        const raw = p.getAttribute(attr);
        if (raw == null || raw === 'none') continue;
        const base = (p.__sfBasePaint && p.__sfBasePaint[attr]) || raw;
        paints.push({ el: p, attr: attr, base: base, rgb: parseSolidColor(base) });
      }
    });
    return paints;
  }
  function bakeColorTransform(node, c) {
    if (!cxRgbOnly(c)) return false;
    const paints = colorPaintList(node);
    if (!paints || !paints.length) return false;
    for (const p of paints) {
      if (!p.el.__sfBasePaint) p.el.__sfBasePaint = {};
      p.el.__sfBasePaint[p.attr] = p.base;
      p.el.__sfBakedBy = node;
      p.el.setAttribute('data-sf-baked', '1');
      p.el.setAttribute(p.attr, 'rgb(' + cxChannel(c, 'Rm', 'Ra', p.rgb[0]) + ','
        + cxChannel(c, 'Gm', 'Ga', p.rgb[1]) + ',' + cxChannel(c, 'Bm', 'Ba', p.rgb[2]) + ')');
    }
    return true;
  }
  /** 去掉 cx 时把**本节点**烘焙过的颜色还原成原稿（不动子级自己烘的色）。 */
  function restoreColorTransform(node) {
    if (!node || !node.childNodes) return;
    walkElements(node, (p) => {
      if (p.__sfBakedBy !== node) return;
      const b = p.__sfBasePaint;
      if (b) for (const k of Object.keys(b)) p.setAttribute(k, b[k]);
      p.__sfBasePaint = null;
      p.__sfBakedBy = null;
      p.removeAttribute('data-sf-baked');
    });
  }
  function applyCx(node, c, rootDefs, tagId, depth) {
    if (!node) return;
    if (!c) {
      /* 只有真烘过才遍历子树；绝大多数没有 cx 的节点每帧都走这里，不能退化成 O(N²)。 */
      if (node.__sfBaked) { restoreColorTransform(node); node.__sfBaked = false; }
      updateAttribute(node, 'filter', null);
      return;
    }
    if (bakeColorTransform(node, c)) {
      node.__sfBaked = true;
      updateAttribute(node, 'filter', null);
      return;
    }
    // 烘不了时先把上一帧烘过的纯色还原再挂滤镜，否则颜色会被乘两次。
    if (node.__sfBaked) { restoreColorTransform(node); node.__sfBaked = false; }
    updateAttribute(node, 'filter', 'url(#' + cxFilterFor(rootDefs, tagId, depth, c) + ')');
  }

  /* 帧构建：维护 深度→放置 表，tp:1 快照，remove 删深度；放置没给 ma 时沿用上次矩阵。
   * rp 只在该放置真正出现的帧段有效；跨帧携带必须剥掉，否则子实例每帧重建、播放头归 0。
   * 帧推进时同深度同 id 的显式 rp 是真重置（重播局部动作），必须保留。 */
  function buildFrames(Sf) {
    const frames = [];
    let cur = new Map();          // 当前存活：depth → 合并后的放置
    let seg = new Set();          // 本帧段里真正出现放置标签的深度
    const snap = () => {
      const f = new Map();
      for (const [d, p] of cur) {
        const c = Object.assign({}, p);
        if (seg.has(d)) c.placedHere = true;
        else { delete c.rp; delete c.placedHere; }
        f.set(d, c);
      }
      // 帧内容建树后不再变：缓存排序深度/蒙版/具名放置，避免 showFrame 每拍重算（战斗 100+ 实例）。
      const depths = [...f.keys()].sort((a, b) => a - b);
      const masks = [];
      for (const d of depths) {
        const q = f.get(d);
        if (q && q.cD !== undefined) masks.push({ d: d, cD: q.cD, p: q });
      }
      f.__depths = depths;
      f.__masks = masks;
      f.__maskDepths = new Set(masks.map((m) => m.d));
      f.__hasNames = depths.some((d) => { const q = f.get(d); return !!(q && q.na); });
      frames.push(f);
      seg = new Set();
    };
    for (const p of Sf || []) {
      if (p.tp === 1) { snap(); continue; }
      if (p.remove) { cur.delete(p.d); seg.delete(p.d); continue; }
      if (p.id === undefined) continue;
      const prev = cur.get(p.d);
      const merged = Object.assign({}, prev || {}, p);
      // 导出用 opacity 表示显式 ColorTransform；RGB 恒等时省略 cx，显式重置时不能留下上一帧灰化。
      if (p.opacity !== undefined && p.cx === undefined) delete merged.cx;
      if (p.ma === undefined && prev && prev.ma !== undefined) merged.ma = prev.ma;
      if (p.rp === undefined) delete merged.rp;
      delete merged.placedHere;
      cur.set(p.d, merged);
      seg.add(p.d);
    }
    if (!frames.length) snap();
    return frames;
  }

  /* 播放注册表按视图分开（opts.live）：叠加子页时共用注册表会 clear 掉底层动画，关子页 destroy 后也回不来。
   * 每个视图一份，节拍器遍历所有活视图。 */
  const views = new Set();       // 活着的视图（每个视图一棵实例树，key 是它自己的 <svg>）
  let ticker = 0, tickCount = 0;
  /* 失焦暂停：macOS 切 App 时 window 会 blur 而 document.hidden 仍 false；只认真的收到过 blur，
   * 不拿 hasFocus() 当初始值（部分 WebView 一开始就 false，动画会永远不动）。 */
  let pageBlurred = false;
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('blur', () => { pageBlurred = true; });
    window.addEventListener('focus', () => { pageBlurred = false; });
  }
  let clipSeq = 0;               // 实例自增号（`debug()` 跨采样认实例用）
  let cpSeq = 0;                 // clipPath 的全局唯一 id 计数（蒙版用）

  function regOf(clip) { return clip && clip.opts && clip.opts.live; }
  function unregisterDeep(clip) {
    const reg = regOf(clip);
    if (reg) reg.delete(clip);
    for (const v of clip.nodes.values()) if (v.clip) unregisterDeep(v.clip);
    for (const c of clip.__attached || []) unregisterDeep(c);
  }
  /** display:none / visibility:hidden 都算看不见；取不到样式按可见处理，绝不冻住整页。 */
  function rootVisible(root) {
    try {
      if (!root) return false;
      if (root.style && root.style.display === 'none') return false;
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(root);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
      }
    } catch (e) { /* 取不到样式就当可见，绝不因此冻住整页 */ }
    return true;
  }
  function startTicker(fps) {
    // ⚠ 启动节拍不能清注册表：mount 先注册完整棵树再启节拍，清表会让先出生的实例不播。
    if (ticker) clearInterval(ticker);
    const ms = Math.max(16, 1000 / (fps || 14));
    ticker = setInterval(() => {
      if (typeof document !== 'undefined' && (document.hidden || pageBlurred)) return;
      tickCount++;
      for (const view of [...views]) {
        if (!view.root || !view.root.isConnected) {
          view.live.clear(); views.delete(view); continue;
        }
        /* 被盖住/藏起的页（visibility:hidden、合成页 display:none）不用走帧，否则白烧主线程；
         * 可见性每 10 拍复核一次，查太勤反而制造样式重算。 */
        if (view.__visible === undefined || tickCount % 10 === 0) view.__visible = rootVisible(view.root);
        if (view.__visible === false) continue;
        for (const c of [...view.live]) {
          // 被钉住的实例（装备持有者）帧号由外面指定；不钉住会在所有挂点间乱跳。
          if (c.__pinFrame != null) {
            if (c.frame !== c.__pinFrame) { c.frame = c.__pinFrame; try { c.showFrame(); } catch (e) {} }
            continue;
          }
          if (!c.playing || c.frames.length < 2) continue;
          if (!c.g.isConnected) { unregisterDeep(c); continue; }
          // 自己不可见的实例播放头照走但不重画；看不见的帧没有光栅化价值。
          const st = c.g.style;
          if (st && (st.visibility === 'hidden' || st.display === 'none')) {
            c.frame = (c.frame + 1) % c.frames.length;
            continue;
          }
          c.frame = (c.frame + 1) % c.frames.length;
          try { c.showFrame(); } catch (e) {}
        }
        /* 每拍结束的视图钩子：主页用它重提装备骨（换帧会按深度重排子节点，只提一次会被后续放置顶掉）。 */
        if (typeof view.onTick === 'function') { try { view.onTick(); } catch (e) {} }
      }
      if (!views.size) stopTicker();
    }, ms);
  }
  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = 0; }
  }
  /** iOS 切后台回来 WKWebView 可能丢掉 SVG 内嵌位图解码结果（背景整块消失）：
   *  摘挂 <image> href 并原地重挂 SVG 强制重绘。仅 main.js 的 iOS 恢复钩子调用，不改帧和业务状态。 */
  function repaintRaster() {
    for (const view of views) {
      const root = view.root;
      if (!root || !root.isConnected) continue;
      const images = root.querySelectorAll ? root.querySelectorAll('image') : [];
      for (const img of images) {
        const href = img.getAttributeNS(XLINK, 'href') || img.getAttribute('href');
        if (!href) continue;
        try {
          img.removeAttributeNS(XLINK, 'href');
          img.removeAttribute('href');
          const restore = () => {
            try { if (img.isConnected) img.setAttributeNS(XLINK, 'href', href); } catch (e) {}
          };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore); else restore();
        } catch (e) {}
      }
      try {
        const prev = root.style.transform;
        root.style.transform = 'translateZ(0)';
        void root.getBoundingClientRect();
        root.style.transform = prev;
        // 原地摘挂 SVG 只让 WebKit 重建合成层；节点、事件与当前帧都保留。
        const parent = root.parentNode;
        if (parent) {
          const next = root.nextSibling;
          parent.removeChild(root);
          parent.insertBefore(root, next);
        }
      } catch (e) {}
    }
  }

  /* 静态页策略：规则按元件名/元件号匹配，随实例向下继承，并在每次实例出生时套一遍，
   * 所以换帧重建也有效（事后扫描会漏掉新实例和 attachChild 子树）。
   * 冻结用 playing=false 而非 pinFrame：pinFrame 会覆盖界面自己的 gotoAndStop。 */
  function makePolicy(spec) {
    const s = spec || {};
    const toSet = (v) => new Set((v ? (Array.isArray(v) || v instanceof Set ? [...v] : [v]) : []).map(String));
    return { keepName: toSet(s.keepNames), keepId: toSet(s.keepIds), blankName: toSet(s.blankNames) };
  }
  function policyKeeps(pol, name, id) {
    if (!pol) return false;
    return pol.keepId.has(String(id)) || !!(name && pol.keepName.has(String(name)));
  }
  /** 冻结不碰帧号，唯一例外：blankNames 的位图数字精灵第 1 帧是 0、末帧才是空白，
   *  没有数据时要停末帧。规则写进策略，换帧重建后新实例出生即自动复位。 */
  function applyStatic(clip, name) {
    if (!clip || !clip.gotoAndStop) return;
    const pol = clip.__policy;
    if (!pol || clip.__keepAnim || clip.__playLock) return;
    if (policyKeeps(pol, name, clip.tag && clip.tag.id)) { clip.__keepAnim = true; return; }
    clip.playing = false;
    if (name && pol.blankName.has(String(name)) && clip.frames.length > 1
      && clip.frame !== clip.frames.length - 1) {
      clip.frame = clip.frames.length - 1;
      try { clip.showFrame(); } catch (e) {}
    }
  }
  /** 必须沿树向下写 __policy 再 applyStatic：挂载时出生的实例 __policy 还是 null，
   *  只读不写这一遍等于什么都没冻。 */
  function walkStatic(clip) {
    const pol = clip.__policy, keep = clip.__keepAnim;
    for (const rec of clip.nodes.values()) {
      if (rec.clip) {
        rec.clip.__policy = pol;
        rec.clip.__keepAnim = rec.clip.__keepAnim || keep;
        applyStatic(rec.clip, rec.na);
        walkStatic(rec.clip);
      }
    }
    for (const c of clip.__attached || []) {
      c.__policy = pol;
      c.__keepAnim = c.__keepAnim || keep;
      applyStatic(c, c.g && c.g.getAttribute ? c.g.getAttribute('attach-name') : null);
      walkStatic(c);
    }
  }

  function MovieClip(tag, rootDefs, opts) {
    this.tag = tag;
    this.uid = ++clipSeq;
    this.rootDefs = rootDefs;
    this.opts = opts || {};
    this.frames = buildFrames(tag.Sf);
    this.frame = 0;
    this.__shownFrame = -1;          // 上次实际展示的帧（-1 = 还没展示过）
    this.playing = true;             // Flash 默认：MovieClip 一放出来就循环播放
    this.names = new Map();          // na → 子 clip / 元素
    this.nodes = new Map();          // depth → { id, node, clip }
    this.g = el('g', { type: 'sprite' });
    this.g.setAttribute('sid', String(tag.id));
    this.__cps = new Map();          // 蒙版深度 → { id, el, sig }
    /* __policy 从父实例继承；__keepAnim = 整棵子树免冻，__playLock = 界面正在自己推帧。
     * 根视图策略由 buildView 从 opts.policy 装，子实例一律抄父实例。 */
    this.__policy = null;
    this.__keepAnim = false;
    this.__playLock = false;
    const reg = this.opts && this.opts.live;
    if (reg) reg.add(this);
  }
  /** 规则只由实例名 / 元件号描述，换帧重建的新实例自动适用。 */
  MovieClip.prototype.setStaticPolicy = function (spec) {
    this.__policy = spec ? makePolicy(spec) : null;
    this.__keepAnim = false;
    applyStatic(this, null);
    walkStatic(this);
    return this;
  };
  /** Optional presentation wrapper. Timeline updates retain its identity and CSS state. */
  MovieClip.prototype.setContentHost = function (host) {
    this.__contentHost = host;
    return this;
  };
  MovieClip.prototype.getContentHost = function () {
    const host = this.__contentHost;
    return host && host.parentNode === this.g ? host : this.g;
  };
  MovieClip.prototype.placeFrameNode = function (node) {
    const host = this.getContentHost();
    // Runtime attachments occupy higher depths than the timeline card/background.
    const attached = (this.__attached || []).find((c) => c.g.parentNode === host);
    host.insertBefore(node, attached ? attached.g : null);
  };
  // 蒙版 clipPath 挂在本实例 <g> 内，id 唯一、作用域只在本实例。
  MovieClip.prototype.clipHost = function () {
    if (!this.__clipHost) {
      this.__clipHost = el('defs');
      this.__clipHost.setAttribute('type', 'clip');
      this.g.insertBefore(this.__clipHost, this.g.firstChild);
    }
    return this.__clipHost;
  };
  /** 取/建该蒙版深度的 clipPath，返回它的 id。几何只在「元件 id 或矩阵变了」时重建。 */
  MovieClip.prototype.clipFor = function (m) {
    let cp = this.__cps.get(m.d);
    if (!cp) {
      cp = { id: 'sfc' + (++cpSeq), el: el('clipPath'), sig: null };
      cp.el.setAttribute('id', cp.id);
      cp.el.setAttribute('clipPathUnits', 'userSpaceOnUse');
      this.clipHost().appendChild(cp.el);
      this.__cps.set(m.d, cp);
    }
    const sig = String(m.p.id) + '|' + (m.p.ma || '');
    if (cp.sig !== sig) {
      cp.sig = sig;
      while (cp.el.firstChild) cp.el.removeChild(cp.el.firstChild);
      const child = this.tagFor(m.p.id);
      /* 只有形状能当蒙版；路径必须直接放进 <clipPath>，包一层 <g>（shapeNode 产物）会被整组忽略，
       * 被裁的兄弟整块消失（体力/经验条填充）。tp39 精灵当蒙版时退回不裁。 */
      if (child && child.tp === 2) {
        for (const seg of child.pt || []) {
          const path = el('path', { d: seg.da });
          if (m.p.ma) path.setAttribute('transform', 'matrix(' + m.p.ma + ')');
          cp.el.appendChild(path);
        }
      } else {
        cp.sig = null;
        return null;
      }
    }
    return cp.id;
  };
  MovieClip.prototype.showFrame = function () {
    // 同帧重复 showFrame（HUD 每回合 gotoAndStop 同帧）直接返回，避免无谓重建（战斗 100+ 实例）。
    if (this.__shownFrame === this.frame) return this;
    const frame = this.frames[this.frame] || new Map();
    // 走到这里帧一定推进了（同帧已返回），rp 才可能是真重置。
    const frameAdvanced = true;
    if (frame.__hasNames || this.names.size) this.names.clear();
    const depths = frame.__depths || (frame.__depths = [...frame.keys()].sort((a, b) => a - b));
    /* Most animation steps only change matrices; re-appending reused nodes would still invalidate
     * the SVG display list. Skip moves only when the full depth order already matches. */
    let keepOrder = depths.length === this.nodes.size;
    const ordered = [];
    if (keepOrder) {
      for (const d of depths) {
        const p = frame.get(d), old = this.nodes.get(d);
        if (!old || old.id !== String(p.id) || (frameAdvanced && p.rp && p.placedHere)) { keepOrder = false; break; }
        ordered.push(old.wrap || old.node);
      }
    }
    if (keepOrder) {
      const host = this.getContentHost(), nodes = new Set(ordered);
      const attached = new Set((this.__attached || []).map(c => c.g));
      let at = 0, pastAttachment = false;
      for (const node of host.childNodes) {
        if (attached.has(node)) pastAttachment = true;
        if (nodes.has(node) && (pastAttachment || node !== ordered[at++])) { keepOrder = false; break; }
      }
      if (at !== ordered.length) keepOrder = false;
    }
    /* cD 放置是蒙版：遮住更深且不超过 cD 的兄弟，自己只当裁剪轮廓不绘制。
     * 不处理时蒙版形状会按 SVG 默认填黑，盖住文字并让填充条露出来（村庄体力/经验条）。 */
    const masks = frame.__masks || (frame.__masks = (() => {
      const out = [];
      for (const d of depths) {
        const q = frame.get(d);
        if (q && q.cD !== undefined) out.push({ d: d, cD: q.cD, p: q });
      }
      return out;
    })());
    const maskDepths = frame.__maskDepths || (frame.__maskDepths = new Set(masks.map((m) => m.d)));
    const isMaskDepth = (d) => maskDepths.has(d);
    const maskOf = (d) => { for (const m of masks) if (d > m.d && d <= m.cD) return m; return null; };
    const next = new Map();
    for (const d of depths) {
      const p = frame.get(d);
      const prev = this.nodes.get(d);
      /* 同深度同元件复用原实例（只更新变换），子 clip 播放头不重置 —— Flash 语义。
       * 例外：帧推进后该深度有真正出现的 rp 放置，那是真重置，新实例从第 1 帧播。 */
      const replace = frameAdvanced && !!(p.rp && p.placedHere);
      if (prev && prev.id === String(p.id) && !replace) {
        prev.node.__baseMa = p.ma || null;
        applyNodeXform(prev.node);
        updateAttribute(prev.node, 'opacity', p.opacity);
        applyCx(prev.node, cxOf(p), this.rootDefs, this.tag.id, d);
        // 蒙版可在后续帧出现/撤销/改覆盖深度：按当前显示列表重绑裁剪，保留子实例播放头。
        updateAttribute(prev.node, 'clip-depth', p.cD);
        const oldTarget = prev.wrap || prev.node;
        const mReuse = maskOf(d);
        const cpId = mReuse && this.clipFor(mReuse);
        if (cpId) {
          if (!prev.wrap) {
            prev.wrap = el('g');
            if (prev.node.parentNode) prev.node.parentNode.insertBefore(prev.wrap, prev.node);
            prev.wrap.appendChild(prev.node);
          }
          updateAttribute(prev.wrap, 'clip-from', mReuse.d);
          updateAttribute(prev.wrap, 'clip-path', 'url(#' + cpId + ')');
        } else if (prev.wrap) {
          const wrap = prev.wrap;
          if (wrap.parentNode) wrap.parentNode.insertBefore(prev.node, wrap);
          else wrap.removeChild(prev.node);
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          prev.wrap = null;
        }
        const target = prev.wrap || prev.node;
        const isMask = isMaskDepth(d);
        if (prev.isMask && oldTarget !== target) updateAttribute(oldTarget, 'visibility', null);
        if (isMask) updateAttribute(target, 'visibility', 'hidden');
        else if (prev.isMask) updateAttribute(target, 'visibility', null);
        prev.isMask = isMask;
        if (p.na) this.names.set(p.na, prev.clip || prev.node);
        if (!keepOrder) this.placeFrameNode(prev.wrap || prev.node);
        next.set(d, prev);
        continue;
      }
      if (prev) {
        if (prev.clip) unregisterDeep(prev.clip);
        /* 必须按实际父节点摘：popWrap() 会把内容搬进 <g class="uc-pop"> 壳，
         * 只认 this.g 会漏删，节点留在壳里继续画 → 每次换帧叠一层重影。 */
        const oldHost = prev.wrap || prev.node;
        if (oldHost.parentNode) oldHost.parentNode.removeChild(oldHost);
      }
      const child = this.tagFor(p.id);
      if (!child) continue;                       // 该页素材没提取 → 跳过（不报错）
      let node, clip;
      if (child.tp === 39) {
        clip = new MovieClip(child, this.rootDefs, this.opts);
        clip.parent = this;
        // 出生即按父实例规则处理：无论换帧重建多少次，新实例一出生就 playing=false。
        clip.__policy = this.__policy;
        clip.__keepAnim = this.__keepAnim;
        clip.showFrame();
        applyStatic(clip, p.na);
        node = clip.g;
        node.__clip = clip;
      } else if (child.tp === 11) {
        node = textNode(child, this.rootDefs);
      } else {
        node = shapeNode(this.rootDefs, child);
      }
      node.setAttribute('depth', d);
      node.__baseMa = p.ma || null;
      applyNodeXform(node);
      if (p.opacity !== undefined) node.setAttribute('opacity', p.opacity);
      applyCx(node, cxOf(p), this.rootDefs, this.tag.id, d);
      if (p.cD !== undefined) node.setAttribute('clip-depth', p.cD);
      if (p.na) this.names.set(p.na, clip || node);
      // 被蒙版罩住的兄弟套一层不带 transform 的 <g>，clipPath 与蒙版同处父坐标系。
      let wrap = null;
      const m = maskOf(d);
      if (m) {
        const cpId = this.clipFor(m);
        if (cpId) {
          wrap = el('g');
          wrap.setAttribute('clip-from', String(m.d));
          wrap.setAttribute('clip-path', 'url(#' + cpId + ')');
          wrap.appendChild(node);
        }
      }
      const target = wrap || node;
      if (isMaskDepth(d)) target.setAttribute('visibility', 'hidden');
      this.placeFrameNode(target);
      /* 出生回调必须在节点进文档之后调：原版挂点在 frame 1 自声明装备，复刻在这里接管。
       * 放文档前 setSymbol → anchorToBBox 的 getBBox() 量不到，装备会隐藏/闪一帧。 */
      if (clip && this.opts && typeof this.opts.onClip === 'function') {
        try { this.opts.onClip(clip); } catch (e) {}
      }
      next.set(d, { id: String(p.id), node, clip, wrap, isMask: isMaskDepth(d), na: p.na || null });
    }
    // 新帧不存在的深度要移除并注销子树；同样按实际父节点摘，否则 uc-pop 壳里的节点会留下重影。
    for (const [d, old] of this.nodes) {
      if (next.has(d)) continue;
      if (old.clip) unregisterDeep(old.clip);
      const host = old.wrap || old.node;
      if (host.parentNode) host.parentNode.removeChild(host);
    }
    this.nodes = next;
    this.__shownFrame = this.frame;
    // 页面可选帧后处理；回调异常不能中断整棵动画树。
    if (typeof this.__frameFix === 'function') {
      try { this.__frameFix(this); } catch (e) {}
    }
    return this;
  };
  MovieClip.prototype.tagFor = function (id) {
    if (!bundle) return null;
    return bundle.hash.get(String(id)) || null;
  };
  MovieClip.prototype.byName = function (name) { return this.names.get(name) || null; };
  MovieClip.prototype.byNameDeep = function (name) {
    let hit = this.names.get(name);
    if (hit) return hit;
    for (const v of this.names.values()) {
      if (v instanceof MovieClip) { hit = v.byNameDeep(name); if (hit) return hit; }
    }
    return null;
  };
  MovieClip.prototype.gotoAndStop = function (n) {
    const i = Math.max(0, Math.min(this.frames.length - 1, (n | 0) - 1));
    this.frame = i; this.playing = false; this.showFrame(); return this;
  };
  MovieClip.prototype.gotoAndPlay = function (n) {
    const i = Math.max(0, Math.min(this.frames.length - 1, (n | 0) - 1));
    this.frame = i; this.playing = true; this.showFrame(); return this;
  };
  MovieClip.prototype.play = function () { this.playing = true; return this; };
  MovieClip.prototype.stop = function () { this.playing = false; return this; };
  /** 钉在某一帧（1-based），节拍不再推进它；装备持有者用。 */
  MovieClip.prototype.pinFrame = function (n) {
    const idx = Math.max(0, Math.min(this.frames.length - 1, (n || 1) - 1));
    this.__pinFrame = idx;
    if (this.frame !== idx) { this.frame = idx; try { this.showFrame(); } catch (e) {} }
    return this;
  };
  MovieClip.prototype.frameCount = function () { return this.frames.length; };
  /* 原版矩阵 ma 由父级换帧时写入，直接写 transform 会被下一帧冲掉。分开存：
   * __baseMa = 原版矩阵，__extra = 复刻附加段，合成 matrix(base) <extra>。 */
  MovieClip.prototype.setExtraTransform = function (t) {
    this.g.__extra = t || '';
    this.applyXform();
    return this;
  };
  function updateAttribute(node, name, value) {
    const next = value == null || value === '' ? null : String(value);
    if (node.getAttribute(name) === next) return;
    if (next === null) node.removeAttribute(name);
    else node.setAttribute(name, next);
  }
  function applyNodeXform(node) {
    const t = ((node.__baseMa ? 'matrix(' + node.__baseMa + ')' : '') + ' ' + (node.__extra || '')).trim();
    updateAttribute(node, 'transform', t);
  }
  MovieClip.prototype.applyXform = function () { applyNodeXform(this.g); };
  MovieClip.prototype.setDepthExtra = function (depth, extra) {
    const v = this.nodes.get(depth);
    if (!v) return false;
    v.node.__extra = extra || '';
    applyNodeXform(v.node);
    return true;
  };
  /** 原版穿装备 = 挂点.attachMovie(容器).gotoAndStop(frame)；挂点是空壳（如 5120 第 1 帧 0 放置），
   *  所以直接换时间轴再 gotoAndStop，帧差分/节点复用照旧生效。 */
  MovieClip.prototype.setSymbol = function (symbolId, frame, scale, anchorBBox, tail) {
    const tag = this.tagFor(symbolId);
    if (!tag || tag.tp !== 39) return false;
    if (String(this.tag.id) !== String(symbolId)) {
      this.detachAll();
      /* 旧子树先注销，否则它们会留在播放注册表里空转 */
      for (const v of this.nodes.values()) if (v.clip) unregisterDeep(v.clip);
      this.nodes.clear();
      this.names.clear();
      const content = this.getContentHost();
      for (const c of [...content.childNodes]) if (c !== this.__clipHost) content.removeChild(c);
      this.tag = tag;
      this.g.setAttribute('sid', String(tag.id));
      this.frames = buildFrames(tag.Sf);
      this.__shownFrame = -1;
    }
    this.gotoAndStop(frame || 1);
    const s = (scale && scale !== 1) ? scale : 1;
    /* `tail`（画稿自身偏移）必须在 anchorToBBox **里面**拼，不能在调用方 append —— 见那边的注释 */
    if (anchorBBox) this.anchorToBBox(s, anchorBBox === true ? 'topleft' : anchorBBox, tail);
    else this.setExtraTransform(('scale(' + s + ')' + (tail ? ' ' + tail : '')).trim());
    // 换了时间轴 = 元件号变了，白名单要按新元件号重判一次。
    this.__keepAnim = false;
    applyStatic(this, null);
    return true;
  };
  /** 原版 chooseEquipLoader 把容器直接 attachMovie 到 myself 上（不是挂点空壳），坐标用自身画稿。
   *  手动挂的子节点不进 nodes 表，换帧清扫不会动它。 */
  MovieClip.prototype.attachChild = function (symbolId, frame, name) {
    const tag = this.tagFor(symbolId);
    if (!tag || tag.tp !== 39) return null;
    const clip = new MovieClip(tag, this.rootDefs, this.opts);
    clip.parent = this;
    clip.__policy = this.__policy;
    clip.__keepAnim = this.__keepAnim;
    clip.gotoAndStop(frame || 1);
    applyStatic(clip, name);
    clip.g.setAttribute('type', 'attached');
    if (name) clip.g.setAttribute('attach-name', name);
    this.getContentHost().appendChild(clip.g);
    if (!this.__attached) this.__attached = [];
    this.__attached.push(clip);
    return clip;
  };
  /** 接管这一颗自己播：__playLock 期间静态策略不再冻它；holdAnim(false) 交回。 */
  MovieClip.prototype.holdAnim = function (on) { this.__playLock = on !== false; return this; };
  MovieClip.prototype.detachAll = function () {
    for (const c of this.__attached || []) {
      unregisterDeep(c);
      if (c.g.parentNode) c.g.parentNode.removeChild(c.g);
    }
    this.__attached = [];
  };
  /** 把内容缩放 s 后平移到「缩放后包围盒的 mode 点 = 本实例原点」；mode: topleft/center/bottom。
   *  tail 必须从这里拼进 __extra：进文档前 getBBox 量不到，下一帧重算会整段重写 __extra。 */
  // 装备容器包围盒只跟元件号+帧号有关；缓存后战斗每回合重建挂点不必等下一帧，否则会闪一下。
  const bboxCache = new Map();
  MovieClip.prototype.anchorToBBox = function (s, mode, tail, retry) {
    const self = this, sc = (s && s !== 1) ? s : 1, md = mode || 'topleft';
    const after = tail ? ' ' + tail : '';
    /* 实例刚出生还没进文档，getBBox() 量不到，会等下一帧；期间按容器原始坐标画会闪一件装备，
     * 先藏起来。__anchorSeq 防止换符号后旧回调按旧包围盒摆新内容。 */
    const seq = (this.__anchorSeq = (this.__anchorSeq || 0) + 1);
    const cacheKey = this.tag ? String(this.tag.id) + '@' + this.frame : '';
    let b = cacheKey ? bboxCache.get(cacheKey) : null;
    const restore = () => {
      if (seq !== this.__anchorSeq || !this.__anchorHidden || !this.g || !this.g.style) return;
      this.__anchorHidden = false;
      this.g.style.visibility = this.__anchorPrevVisibility || '';
    };
    if (!b) {
      if (!this.__anchorHidden && this.g && this.g.style) {
        this.__anchorHidden = true;
        this.__anchorPrevVisibility = this.g.style.visibility;
        this.g.style.visibility = 'hidden';
      }
      this.g.__extra = '';
      this.applyXform();
      try { b = this.g.getBBox(); } catch (e) { b = null; }
      if (b && b.width && b.height && cacheKey) bboxCache.set(cacheKey, { x: b.x, y: b.y, width: b.width, height: b.height });
    }
    if (!b || (!b.width && !b.height)) {
      /* 子树在同一个同步任务里构建：showFrame() 建完才 placeFrameNode 入文档，出生时 getBBox() 恒 0。
       * 只靠 rAF 在隐藏标签页会被节流/暂停，装备停在未锚点位置；先排 microtask 同拍补锚点。 */
      if (!retry && this.g && this.g.isConnected === false && typeof Promise !== 'undefined') {
        Promise.resolve().then(() => {
          if (self.__anchorSeq !== seq) return;
          try { self.anchorToBBox(sc, md, tail, true); } catch (e) {}
        });
        return;
      }
      if (!retry && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          // 换符号/重锚过就放弃旧回调。
          if (self.__anchorSeq !== seq) return;
          try { self.anchorToBBox(sc, md, tail, true); } catch (e) {}
        });
      } else {
        // 重试也量不到：不要永久藏住。
        restore();
      }
      return;
    }
    const px = md === 'center' ? b.x + b.width / 2 : md === 'bottom' ? b.x + b.width / 2 : b.x;
    const py = md === 'center' ? b.y + b.height / 2 : md === 'bottom' ? b.y + b.height : b.y;
    this.g.__extra = 'translate(' + (-px * sc) + ',' + (-py * sc) + ') scale(' + sc + ')' + after;
    this.applyXform();
    restore();
  };

  /** 建根 <svg>：viewBox 用根舞台（timeline.Ft/Fw/Fh），缩放交给容器。
   *  原版舞台就是裁切框，所以超出舞台的内容照原样裁掉 —— 与 Flash 一致。 */
  function svgRoot(rootHost, viewBox, preserve) {
    const svg = el('svg', {
      viewBox: viewBox,
      // 默认 meet 不 slice：原版舞台边缘就是顶栏/底栏，裁掉会少内容。
      preserveAspectRatio: preserve || 'xMidYMid meet',
      width: '100%', height: '100%',
    });
    rootHost.appendChild(svg);
    return svg;
  }
  /** 屏幕坐标 ↔ SVG 用户坐标。不用 getScreenCTM()：WebKit 209220 的 CTM 不含祖先 CSS transform 的 scale，
   *  而 #ui 用 transform:scale 适配窗口。也不能假设 sx===sy：全面屏下两轴比例可差 30%。
   *  返回 toUser/toClient/content；量不到（隐藏/未布局）返回 null。 */
  function svgScreenMap(svg) {
    if (!svg || !svg.getBoundingClientRect || !svg.viewBox) return null;
    let box;
    try { box = svg.getBoundingClientRect(); } catch (e) { return null; }
    const vb = svg.viewBox.baseVal;
    if (!box || !(box.width > 0) || !(box.height > 0) || !vb || !(vb.width > 0) || !(vb.height > 0)) return null;
    /* 要的是 CSS 布局尺寸（不含 #ui transform）；优先 computed style：
     * 个别 WKWebView 的 clientWidth/Height 会退回 viewBox 或 0。 */
    let cw = 0, ch = 0;
    try {
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(svg);
        cw = parseFloat(cs && cs.width) || 0;
        ch = parseFloat(cs && cs.height) || 0;
      }
    } catch (e) { /* 无样式环境（单测）走兜底 */ }
    if (!(cw > 0) || !(ch > 0)) { cw = Number(svg.clientWidth) || 0; ch = Number(svg.clientHeight) || 0; }
    if (!(cw > 0) || !(ch > 0)) { cw = box.width; ch = box.height; }
    if (!(cw > 0) || !(ch > 0)) return null;
    const kx = box.width / cw, ky = box.height / ch;
    const par = String(svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
    const ax = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5;
    const ay = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
    let offX = 0, offY = 0, mx, my;
    if (/\bnone\b/.test(par)) {
      mx = cw / vb.width; my = ch / vb.height;
    } else {
      const s = /\bslice\b/.test(par)
        ? Math.max(cw / vb.width, ch / vb.height)
        : Math.min(cw / vb.width, ch / vb.height);
      const cwScaled = vb.width * s, chScaled = vb.height * s;
      offX = (cw - cwScaled) * ax;
      offY = (ch - chScaled) * ay;
      mx = my = s;
    }
    const scaleX = mx * kx, scaleY = my * ky;
    const x0 = box.left + offX * kx - vb.x * scaleX;
    const y0 = box.top + offY * ky - vb.y * scaleY;
    return {
      svg: svg, box: box, viewBox: { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
      scaleX: scaleX, scaleY: scaleY, x0: x0, y0: y0,
      /* viewBox 内容在**设计单位**里的矩形（相对 svg 元素左上角）。 */
      content: { x: offX, y: offY, width: vb.width * mx, height: vb.height * my },
      toUser: (sx, sy) => ({ x: (sx - x0) / scaleX, y: (sy - y0) / scaleY }),
      toClient: (ux, uy) => ({ x: x0 + ux * scaleX, y: y0 + uy * scaleY }),
    };
  }

  /** 建一棵挂在 root（一个 <svg>）上的时间轴，共用 mount / mountSymbol 的收尾；framesOverride 给根时间轴。 */
  function buildView(root, tag, tl, o, frame, framesOverride) {
    if (!o.live) o.live = new Set();                // 本视图的播放注册表
    const view = new MovieClip(tag, root, o);
    view.g = root;                                  // 根时间轴自己就是一个 <svg>
    view.live = o.live;
    if (framesOverride) view.frames = framesOverride;
    view.frame = Math.max(0, Math.min(view.frames.length - 1, (frame || 1) - 1));
    // 根时间轴已被原版 gotoAndStop(标签) 停住，只有子元件继续自动播放。
    view.playing = false;
    // opts.policy 让子树所有实例出生即冻结（见上方静态页策略）；之后 freezeDescendants 等价（幂等）。
    view.__policy = o.policy ? makePolicy(o.policy) : null;
    view.showFrame();
    startTicker(tl.Fr);
    views.add(view);
    view.timeline = tl;
    view.labels = tl.labels;
    view.gotoLabel = function (name) {
      const f = tl.labels[name];
      if (!f) return null;
      view.frame = f - 1;
      view.showFrame();
      return view;
    };
    view.root = root;
    view.destroy = function () {
      views.delete(view);
      if (o.live) o.live.clear();
      if (root.parentNode) root.parentNode.removeChild(root);
      // ⚠ 不要无条件 stopTicker：别的视图还在播，一个视图都不剩时才停。
      if (!views.size) stopTicker();
    };
    return view;
  }
  async function mount(container, opts) {
    const b = await load();
    // ⚠ 复制 opts：live/policy 必须写在本次挂载自己的对象上，不能污染调用方。
    const o = Object.assign({}, opts || {});
    const tl = b.timeline;
    container.classList.add('ssfight-view');
    while (container.firstChild) container.removeChild(container.firstChild);

    const viewBox = tl.Ft.xi + ' ' + tl.Ft.yi + ' ' + (tl.Fw || 320) + ' ' + (tl.Fh || 196);
    const root = svgRoot(container, viewBox, o.preserveAspectRatio);
    if (tl.Bg && tl.Bg !== '#FFFFFF') {
      root.appendChild(el('rect', { x: tl.Ft.xi, y: tl.Ft.yi, width: tl.Fw, height: tl.Fh, fill: tl.Bg }));
    }

    // 根时间轴同样是 SWF 标签流，帧快照在 timeline.frames 里已切好。
    const rootTag = { id: 'root', tp: 39, Sf: null };
    const frames = tl.frames.map((placements) => {
      const m = new Map();
      for (const p of placements) m.set(p.d, p);
      return m;
    });
    return buildView(root, rootTag, tl, o, o.frame === undefined ? 1 : o.frame, frames);
  }

  /* 挂库元件（不在 timeline 里，如村庄地点 3957/4381/3437）：viewBox 用根舞台而不是元件 Ft，
   * 否则整页缩成一小团；根元件必须 playing=false，否则在页间循环播；素材包由调用方先 loadExtra。 */
  async function mountSymbol(container, id, opts) {
    const b = await load();
    const tag = b.hash.get(String(id));
    if (!tag) throw new Error('素材库里没有元件 ' + id + '（对应的 tags-*.json 没加载？）');
    if (tag.tp !== 39) throw new Error('元件 ' + id + ' 不是精灵（tp' + tag.tp + '），挂不了');
    const o = Object.assign({}, opts || {});
    const tl = b.timeline;
    /* 挂库元件的都是二级/整页层，不属于村庄主页；classic.css 靠 ssfight-home-page 标记隐藏主页，
     * 这里要摘干净，免得被误伤。 */
    container.classList.remove('ssfight-home-page');
    while (container.firstChild) container.removeChild(container.firstChild);
    const viewBox = o.viewBox || (tl.Ft.xi + ' ' + tl.Ft.yi + ' ' + (tl.Fw || 320) + ' ' + (tl.Fh || 196));
    const root = svgRoot(container, viewBox, o.preserveAspectRatio);
    const view = buildView(root, tag, tl, o, o.frame === undefined ? 1 : o.frame);
    /* opts.blank：建树那一刻就清空这些 na 字段。素材占位串（expNum 999999/999999、
     * requirement 900000）在 await 回来前会露馅，真值全部由界面挂载后写入。 */
    if (o.blank && o.blank.length) {
      for (const name of o.blank) {
        const hit = view.byName ? view.byName(name) : null;
        if (hit) { try { setText(hit, ''); } catch (e) {} }
      }
    }
    view.symbolId = String(id);
    view.label = o.label || '';
    return view;
  }

  window.SfRender = {
    load, loaded, loadExtra, loadTable, releaseExtra, queueExtraRelease, mount, mountSymbol, buildFrames, stopTicker,
    /** iOS 回前台重解码 SVG 位图 + 强制图层重绘（main.js 的恢复钩子调用）。 */
    repaintRaster,
    /** 会真的按换行断行；opts.wrap=true 时按字段框宽折行。 */
    setText,
    /** 只在放不下时缩字号（不裁字、不横向压扁）；见 `fitTextWidth` 的注释。 */
    fitTextWidth,
    /** 按最终字号重算多行文本的首行基线与行距（缩字号后必须一起收，避免第二行压到下一个字段）。 */
    layoutText,
    /** 文本宽度估算（字号 = 1 时）：回归与其它页面的自适应共用。 */
    estimateTextWidth,
    /** 屏幕坐标 ↔ SVG 用户坐标（两轴分别换算；全面屏/#ui 非等比缩放也正确）。 */
    svgScreenMap,
    BASE,
    tags: () => (bundle ? bundle.tags : null),
    timeline: () => (bundle ? bundle.timeline : null),
    liveCount: () => { let n = 0; for (const v of views) n += v.live.size; return n; },
    viewCount: () => views.size,
    /** 给视图套静态页策略，规则随实例继承。spec: { keepNames, keepIds, blankNames }。 */
    setStaticPolicy: (view, spec) => (view && view.setStaticPolicy ? view.setStaticPolicy(spec) : null),
    debug: () => {
      const clips = [];
      for (const v of views) {
        for (const c of v.live) {
          clips.push({
            uid: c.uid, sid: String(c.tag.id), frame: c.frame, frames: c.frames.length,
            playing: c.playing, connected: c.g.isConnected,
          });
        }
      }
      return { tickCount, views: views.size, clips };
    },
  };
})();
