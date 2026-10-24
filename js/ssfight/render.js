/* Original ssfight timeline/SVG interpreter. Runtime assets: images/ssfight/ui/.
 * Handles shapes, text, nested MovieClips, masks and per-view animation registries.
 * load/loadExtra share in-flight requests; page modules hydrate their own values.
 * Static policy stops autoplay and is inherited by newly created descendants.
 * setContentHost preserves an optional feedback shell across timeline changes;
 * clip definitions stay outside it, attachments remain above timeline artwork.
 * Entry: SfRender.mount / mountSymbol. Navigation/index: js/ssfight/AGENTS.md.
 * Unsupported Flash actions and general filters are not emulated.
 */
(function () {
  'use strict';

  const BASE = 'images/ssfight/ui/';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';

  let bundle = null;      // { timeline, tags, hash }
  let loadPromise = null;
  const extraPromises = new Map();

  /* ---------- 素材库加载（一次，之后缓存） ---------- */
  async function load() {
    if (bundle) return bundle;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const [tl, tags, textFields] = await Promise.all([
        fetch(BASE + 'timeline.json', { cache: 'force-cache' }).then((r) => r.json()),
        fetch(BASE + 'tags.json', { cache: 'force-cache' }).then((r) => r.json()),
        // EditText boxes/alignment come from SWF metadata, not exported glyph baselines.
        fetch(BASE + 'textfields.json', { cache: 'force-cache' })
          .then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      ]);
      const hash = new Map();
      for (const t of tags) hash.set(String(t.id), t);
      bundle = { timeline: tl, tags, hash, textFields };
      return bundle;
    })();
    try { return await loadPromise; }
    finally { loadPromise = null; }
  }
  function loaded() { return !!bundle; }

  /** 追加一份素材包（例如装备容器的 `tags-gear.json`）。
   * **按需加载**：装备那 1224 个标签有 1.8 MB，而村庄页每次挂载都要拉 `tags.json` ——
   * 把它们塞进同一份等于给每次进首页白加 1.8 MB。只在真要给主角穿装备时调一次。 */
  async function loadExtra(file) {
    const b = await load();
    if (b.extra && b.extra.has(file)) return b;
    if (extraPromises.has(file)) return extraPromises.get(file);
    const pending = (async () => {
      const r = await fetch(BASE + file, { cache: 'force-cache' });
      if (!r || !r.ok) throw new Error('素材包缺失：' + file);
      const list = await r.json();
      const exactGear = file === 'tags-gear.json' || file === 'tags-gear-color.json';
      for (const t of list) {
        const k = String(t.id);
        /* 两套装备包都从原 SWF 恢复 MATRIX 精度，共享标签在生成时校验一致。
         * 覆盖页面里同 id 的旧舍入稿；其余包不能因切页顺序把精度降回去。 */
        if (exactGear || !b.hash.has(k)) b.hash.set(k, t);
      }
      // 已量过的父容器可能依赖刚校准的子元件，下一次挂载须重新量真实边界。
      if (exactGear) bboxCache.clear();
      if (!b.extra) b.extra = new Set();
      b.extra.add(file);
      return b;
    })();
    extraPromises.set(file, pending);
    try { return await pending; }
    finally { extraPromises.delete(file); }
  }

  const el = (name, attrs) => {
    const n = document.createElementNS(SVGNS, name);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    return n;
  };

  /* ---------- 形状定义 → 可复用的 SVG 模板 ---------- */
  /* 官方的 processShape 会把渐变/图案/纯色分别注册到 <defs> 再让 path 去 url(#…) 引用；
   * 这里同样做，只是按 id 缓存，避免重复生成。 */
  function defsHost(root) {
    if (!root.__defs) {
      const d = el('defs');
      root.insertBefore(d, root.firstChild);
      root.__defs = d;
    }
    return root.__defs;
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

  /** 把 shape 标签变成一棵可 cloneNode 的 <g type="shape"> */
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
            if (!rootDefs.querySelector('#' + CSS.escape(id))) {
              rootDefs.appendChild(f.tp === 3
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
            if (!rootDefs.querySelector('#' + CSS.escape(id))) {
              rootDefs.appendChild(l.fi.tp === 3 ? gradientNode(3, l.fi, id) : gradientNode(2, l.fi, id));
            }
            path.setAttribute('stroke', 'url(#' + id + ')');
          }
          /* ⚠ 只有**这段本来就没有填充**时才能写 fill:none。
           * 以前是无条件写 —— 于是"既有填充又有描边"的段落（SWF 里很常见）填充被抹掉，
           * 画面上就是"某一块没有填色"（用户 2026-10 报的主界面金松果图标右下角缺一块）。 */
          if (seg.fi === undefined || !(tag.Fs || [])[seg.fi]) path.setAttribute('fill', 'none');
        }
      }
      g.appendChild(path);
    }
    return g;
  }

  /* ---------- tp 11 文本 → <text> ----------
   * 【断行】SVG 的 `<text>` **不会**把内容里的 `\r`/`\n` 当断行 —— Chrome 的 SVG 文本布局
   * 不实现 CSS 的 `white-space` 断行（官方导出给每个 `<text>` 写了 `white-space:pre`，
   * 实测一样不断），所以照搬官方那条路的话，"1.…\r2.…\r3.…" 会连成一行冲出字段框。
   * 断行信息在导出里是**真的**（原版 Flash 的 EditText 认 \r），这里把它还原出来。
   *
   * 一行从哪来，有两种情况（实测这些包里的 95 个文本标签，只有这四种形态）：
   *   · **逐字定位**：多个 rs、且各自的 `x` 不同 —— 那是"一个字一个 rs"的排版
   *     （例：征战页的"正在等待队友…"21 个 rs、技能书的"L"/"V"）。
   *     这类**必须按 rs 自己的 x/y 摆**，不能当行叠起来。
   *   · **普通文本**：一个 rs，里面用 `\r` 分段（例：祭坛的三行双倍几率、征战的"技能\r技能…"）
   *     —— 按 CR/LF 拆成多行。
   *   · **HTML 文本字段**（`tt=='html'`，rs 带 `fs`/字体名、没有 x/y）：**一个 rs 一行**
   *     （例：神迹的"每次升级均可获得1个随机属性点" / "" / "（5点生命…）"；按"行内 run
   *     拼接"会连成 35 个字挤进 306 宽的框里，明显不是原意）。
   * 行的纵向位置：首行沿用已经标定过的基线公式，之后每行加一个**行距**。
   * 行距取 `1.15 × 字号 + leading`：`1.15` 是官方渲染器给字体写死的 `line-height`
   * （`processFont` 里 `font-face line-height="1.15"`），`leading` 是字段自己的 `lead`。
   * ⚠ **不要**改成"把行平均摊在字段框高度里" —— 字段框是美术随手画大的（祭坛那条框高 90.7，
   * 而三行 11 号字只要 40 出头），摊开会让行距变成两倍，第 3 行直接压到底部按钮上（实测）。 */
  const FONT_MAP = { 2030: 'SimHei', 3146: 'Microsoft YaHei' };
  function fontFamily(fd) {
    const s = String(fd == null ? '' : fd);
    const base = /^\d+$/.test(s) ? (FONT_MAP[s] || ('ft' + s)) : (s || 'sans-serif');
    return `'${base}', 'Microsoft YaHei', 'PingFang SC', sans-serif`;
  }
  /** 把 tag.rs 拆成"要画的每一行"（见上面那段说明）。 */
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
  /* ---------- 自动换行（`setText(..., { wrap: true })`） ----------
   * SVG `<text>` 不会按字段框宽自动折行；`setText` 只认显式 \r/\n。技能说明这类
   * 单行长文案会被横向裁掉（详情页的「技能：…」就是）。这里按文本框的 `bd` 宽度拆行，
   * 优先用 canvas 真实测量；量不到时退回「全角 1em / ASCII 0.56em」的估算。
   * 只在调用方显式要 wrap 时生效，不改变其他页面现有的换行语义。 */
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
  /** 拆成「不会从标点开头」的最小片段：ASCII 数字/单词成组，中文标点贴在前一个片段后。 */
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
  /** 把一段文案按文本框宽度拆成多行（保留显式换行）；节点没有字段元数据时原样返回。 */
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
  /** 按 `g.__textBox` 重新生成 `<text>` 子节点（`setText` 换文案时也走这里）。
   *  ⚠ 生成出来的 `<text>` 一律塞进一层**没有 transform 的内层 `<g>`** 里，并把
   *  「字段框宽度的水平裁剪」挂在那层上 —— Flash 的 EditText 本来就会把超出字段框的字裁掉，
   *  而 SVG 的 `<text>` 不裁：长昵称会直接压到右边的拳套图标上（实测）。
   *  裁剪必须挂在**没有 transform 的那一层**：SVG 规定 `clip-path` 的 `userSpaceOnUse`
   *  用的是"引用它的那个元素的父坐标系"，挂在带矩阵的容器上整个框会跟着矩阵跑偏。 */
  /** 原版素材里的**占位串**：作者在文本字段里写死的假数据，真值由界面运行时写进去。
   *  实测两处：状态页的 `expNum` 写的是 **"999999/999999"**、武器详情 `requirement`
   *  里是 **"900000"** —— 挂载到界面填值之间那一瞬间玩家看到的就是这些数
   *  （用户 2026-10 报的"点武器或技能再切回状态页面的时候，满屏幕的所有数字都会变成
   *  9999999 或 00000000 持续 1 秒左右"）。
   *  判据：**整串只有同一个数字、且长度 ≥ 5**（`999999/999999` 拆成两段也一样）。
   *  游戏里没有任何一个真实数值长这样（数值要么更短、要么不是同一个数字），
   *  所以按"出生即空白"处理最省事：`xp` 的 `blank` 选项与这里双保险。 */
  function isPlaceholderRun(tx) {
    const s = String(tx == null ? '' : tx).trim();
    if (s.length < 5) return false;
    /* 作者写死的两串（实测；换素材时在这里补一条即可）。 */
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
      b.tag && b.tag.tf, b.meta && b.meta.fh, b.box]);
    if (b.renderSignature === signature && b.renderHost && b.renderHost.parentNode === g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    const host = el('g');
    b.lines.forEach((L, i) => {
      /* 占位串**不画**（见 `isPlaceholderRun`）：出生就是空白，等界面写值。 */
      if (isPlaceholderRun(L.tx)) return;
      const t = el('text');
      t.textContent = L.tx == null ? '' : String(L.tx);
      if (L.b) t.setAttribute('font-weight', 'bold');
      t.setAttribute('font-size', L.h || (b.meta && b.meta.fh) || 12);
      t.setAttribute('font-family', fontFamily(L.fd));
      t.setAttribute('fill', L.c || '#000000');
      t.setAttribute('fill-rule', 'nonzero');
      t.setAttribute('style', 'white-space:pre');
      /* 文本标签自带的 `tf` 变换必须应用（官方 processText 里 `h.setAttribute("transform", a.tf)`）。
       * 漏掉它的话文字会落在错位置 —— 实测村庄页的昵称因此偏到了顶栏下沿。 */
      if (b.tag && b.tag.tf) t.setAttribute('transform', b.tag.tf);
      if (b.perRun) {
        /* 逐字定位：完全照导出里的 rs 坐标，不做任何重算 */
        if (L.x !== undefined) t.setAttribute('x', L.x);
        if (L.y !== undefined) t.setAttribute('y', L.y);
      } else {
        if (b.anchor === 'middle' || b.anchor === 'end') t.setAttribute('text-anchor', b.anchor);
        t.setAttribute('x', b.x);
        t.setAttribute('y', Math.round((b.base + i * b.step) * 100) / 100);
      }
      host.appendChild(t);
    });
    /* 只有**横向**裁：纵向放开（-600..600），多行文案该露几行就露几行。 */
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
  /** tp 11 文本 → <g type="text">（原版界面里"玩家名字在这里"就是这种占位文本） */
  function textNode(tag, rootDefs) {
    const g = el('g', { type: 'text' });
    const meta = bundle && bundle.textFields ? bundle.textFields[String(tag.id)] : null;
    const lines = textLines(tag);
    const rs = tag.rs || [];
    const perRun = lines.length > 0 && !!lines[0].run;
    /* Flash 的 EditText 语义：html5 导出的 rs.x/rs.y 是字段框左下角而非字形位置，
     * 真正的水平对齐方式与字段框在 textfields.json（SWF 提取）里。
     * 有元数据时按 Flash 规则重算：水平在 [XMin+lm, XMax-rm] 内对齐，
     * 首行基线 = YMin + 上边距(2) + leading + 0.88×字号（SimHei ascent≈0.88em）。 */
    let box = null, x = 0, anchor = 'start', base = 0, step = 0;
    if (meta && meta.bd) {
      const xmin = meta.bd[0], xmax = meta.bd[1], ymin = meta.bd[2], ymax = meta.bd[3];
      const firstH = lines[0].h || meta.fh || 12;
      /* 首行缩进 `ind`：SWF 里读出来偶尔是 3275 这种明显不合理的值（实测 3396/3398），
       * 加进 x 会把整段推到屏幕外。超过半个框宽就当没有缩进。 */
      const ind = (meta.ind && meta.ind < (xmax - xmin) / 2) ? meta.ind : 0;
      box = { xmin, xmax, ymin, ymax };
      anchor = meta.al === 2 ? 'middle' : meta.al === 1 ? 'end' : 'start';
      x = meta.al === 2 ? (xmin + xmax) / 2
        : meta.al === 1 ? (xmax - (meta.rm || 0))
          : (xmin + (meta.lm || 0) + ind);
      base = ymin + 2 + (meta.lead || 0) + 0.88 * firstH;
      /* 行距与行数无关（见上面那段注释）：1.15em + leading，负数 leading 也照减 */
      step = 1.15 * firstH + (meta.lead || 0);
    } else if (rs[0]) {
      /* 没有字段元数据（textfields.json 缺失）：退回导出里的 rs 坐标（官方那条路） */
      x = rs[0].x !== undefined ? rs[0].x : 0;
      base = rs[0].y !== undefined ? rs[0].y : 0;
    }
    g.__textBox = { tag, meta, lines, perRun, box, x, anchor, base, step };
    g.__defs = rootDefs || null;
    drawLines(g);
    return g;
  }
  /** 换掉一个文本容器的内容（`SfRender.setText`）。
   *  `str` 里的换行会**真的断行** —— 界面代码拼多行文案（祭坛三行几率、神迹记录…）全靠它。
   *  `opts.wrap = true` 时再按当前字段框宽自动折行（详情页的长技能说明用）。
   *  返回 false = 这个节点不是文本容器（调用方自己兜底），true = 换好了。 */
  function setText(node, str, opts) {
    if (!node || !node.__textBox) return false;
    const b = node.__textBox;
    /* `noClip`：战斗 HUD 的血量数字框只有 59 单位宽，六位数以上的生命会被字段框裁掉。
     * 只对明确要求放开的字段生效（`refreshBlood`），其它界面仍按原版 EditText 裁切。 */
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
      /* 行距是常数（见 textNode 的注释），换行数不用重算 */
    }
    drawLines(node);
    return true;
  }

  /* ---------- 颜色变换 cx → feComponentTransfer ---------- */
  /* cx = {Rm,Ra,Gm,Ga,Bm,Ba,Am,Aa}（乘/加，0~256 体系），官方是逐个改写 fill 的颜色；
   * 用滤镜表达等价且不用碰填充。
   * ⚠ 导出数据里颜色变换就挂在放置的 `cx` 上（`p.cx = {...}`），**没有** `p.cx.cx` 这一层；
   *   以前只认 `p.cx.cx`，于是全部 cx 被跳过 —— 装备画稿本来是灰阶、靠 cx 上色，
   *   表现就是「彩色装备全变成黑白主色调」（用户 2026-11 口径）。这里两种形状都兼容。 */
  function cxOf(p) {
    const c = p && p.cx;
    if (!c) return null;
    return (c.cx && typeof c.cx === 'object') ? c.cx : c;
  }
  function cxFilterFor(rootDefs, tagId, depth, c) {
    const key = ['Rm', 'Ra', 'Gm', 'Ga', 'Bm', 'Ba', 'Am', 'Aa']
      .map((k) => (c[k] === undefined ? '' : String(c[k]))).join('_');
    const id = 'cx' + tagId + '_' + depth + '_' + key;
    if (!rootDefs.querySelector('#' + id)) cxFilter(rootDefs, id, c);
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
    rootDefs.appendChild(f);
    return id;
  }

  /* ---------- 颜色变换：能直接改画的就不要再走 SVG 滤镜 ----------
   * 原版把 ColorTransform 导成 placement.cx；以前一律做成 <filter> +
   * feComponentTransfer。带装备的经典战斗里这种滤镜能到 100+ 个（狂战/黑装把
   * 同一套灰稿按部位染色）：每个滤镜都是一次离屏合成，在 Android WebView 上
   * 既拖帧，也会在部分 GPU 上把整棵子树画丢、画黑。这里把**纯色**填充/描边
   * 直接做同样的线性变换（公式与 cxFilter 完全一致：
   *   out = clamp(c.Rm / 256 * v + c.Ra)），把滤镜省掉；
   * 渐变 / 图案 / 位图 / 嵌套滤镜仍保留原滤镜，避免改变它们的观感。 */
  /* 只烘焙不透明 rgb：rgba 的 alpha 不在 feFuncRGB 里，烘焙会把它变成不透明。 */
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
  /** 这个 cx 是否只改 RGB、且 alpha 恒等（否则还是交给滤镜处理整组合成）。 */
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
    /* 子树里还有滤镜、或已经有**别的节点**烘焙过的 cx（嵌套颜色变换）：
     * 父级再烘会覆盖子级的合成结果，这一档仍交给 SVG 滤镜。 */
    let blocked = false;
    walkElements(node, (p) => {
      if (blocked) return;
      if (p.getAttribute('filter') != null) { blocked = true; return; }
      if (p.__sfBakedBy && p.__sfBakedBy !== node) { blocked = true; return; }
      /* 子树里还有会自己换帧的 MovieClip：它换帧后新画稿不会经过父级的烘焙，
       * 这一档必须保留父级 filter（滤镜作用在整棵子树上，换帧也跟得上）。 */
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
  /** 把 cx 烘到纯色填充/描边上。成功返回 true（不要再挂 filter）；失败返回 false。 */
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
  /** 给某个节点应用一档 cx：优先烘焙；渐变/位图/alpha 仍走 SVG 滤镜。 */
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
    /* 烘不了（渐变/位图/嵌套滤镜）：先把本节点上一帧烘过的纯色还原，再挂滤镜，
     * 否则滤镜会把已经乘过一次的颜色再乘一次。 */
    if (node.__sfBaked) { restoreColorTransform(node); node.__sfBaked = false; }
    updateAttribute(node, 'filter', 'url(#' + cxFilterFor(rootDefs, tagId, depth, c) + ')');
  }

  /* ---------- 帧构建：SWF 标签流 → 每帧「层级 → 放置」快照 ---------- */
  /* 官方那条 diff 逻辑写得很绕（h/j/g/e/o 一堆数组）；这里用等价但直观的做法：
   * 维护 深度→放置 的表，遇到 tp:1 就快照一份，遇到 remove 就删该深度。
   * 关键差别：放置里没给 `ma` 时沿用上一次该深度的矩阵（官方也是这么合并的）。
   *
   * `rp`（替换标记）的处理是动画正确与否的关键，语义要钉死：
   *   · rp 是**这条放置动作**的属性 —— 只在"这条标签真正出现的那个帧段"有效；
   *   · 快照里**跨帧携带**的放置必须剥掉 rp，否则每一帧都被当成"替换"，
   *     子实例永远重建、播放头永远归 0（实测：myself 初始放置全带 rp，
   *     泄漏后 89 帧动画卡在第 1 帧）；
   *   · 同帧重复 gotoAndStop 也不算替换（Flash 里停在原帧不会重建显示列表）；
   *   · 但**帧推进时同深度同 id 的显式 rp 是真重置**（原版用它重播局部小动作，
   *     实测 main 页闭包里有 52 处，如 myself 的 5188/4950）—— 这个必须保留。 */
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
      frames.push(f);
      seg = new Set();
    };
    for (const p of Sf || []) {
      if (p.tp === 1) { snap(); continue; }
      if (p.remove) { cur.delete(p.d); seg.delete(p.d); continue; }
      if (p.id === undefined) continue;
      const prev = cur.get(p.d);
      const merged = Object.assign({}, prev || {}, p);
      /* 导出器以 opacity 表示显式 ColorTransform；RGB 为恒等时省略 cx。
       * 只有矩阵更新时仍继承颜色，显式重置颜色时则不能留下上一帧的灰化滤镜。 */
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

  /* ---------- 播放注册表与节拍器 ----------
   * Flash 里没有任何"动画系统"：每个 MovieClip 各自维护播放头，舞台按帧率统一走帧。
   * 这里等价：一个 setInterval（按 timeline.Fr），每拍推进所有"播放中且多帧"的实例。
   *
   * ⚠⚠ 注册表**按视图分开**（`opts.live`），不是全剧一个：
   *   复刻里有"页面上面再盖一层"的用法（状态页的武器详情、挑战页的二级页、村庄页上的
   *   地点弹窗），每一次都是一次独立的 `mount` / `mountSymbol`。注册表原来是模块级单例、
   *   挂载时整表 `clear()` —— 于是**盖一层子页就把底层那一页从播放表里清空**（底层所有动画
   *   当场停住），而关掉子页时 `destroy()` 又 `stopTicker()`，底层再也回不来。
   *   ui-status 只好用"关详情时把整页重挂一遍"绕过去，观感就是整屏一闪、页码与 tab 归位 ——
   *   用户报的"ui 乱跳"里有一份就是这个。
   *   现在每个视图各有一份注册表，节拍器统一走一遍所有活着的视图，互相不干扰。 */
  const views = new Set();       // 活着的视图（每个视图一棵实例树，key 是它自己的 <svg>）
  let ticker = 0, tickCount = 0;
  /* 失焦暂停：macOS 切到别的 App 时 `window` 会 blur，但 `document.hidden` 仍是 false。
   * 首页那条 14fps 节拍会一直重建 SVG 子树（实测约 420 个节点/秒），游戏只是放在后面
   * 也照样占 CPU。只认**真的收到过 blur**，不拿 `document.hasFocus()` 当启动初值 ——
   * 部分 WebView 会一开始就报 false，那样动画会永远不动。 */
  let pageBlurred = false;
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('blur', () => { pageBlurred = true; });
    window.addEventListener('focus', () => { pageBlurred = false; });
  }
  let clipSeq = 0;               // 实例自增号（`debug()` 里用来跨两次采样认同一颗实例）
  let cpSeq = 0;                 // clipPath 的全局唯一 id 计数（蒙版用）

  /** 某个实例所属视图的播放注册表（挂载时由 `opts.live` 一路继承下去）。 */
  function regOf(clip) { return clip && clip.opts && clip.opts.live; }
  function unregisterDeep(clip) {
    const reg = regOf(clip);
    if (reg) reg.delete(clip);
    for (const v of clip.nodes.values()) if (v.clip) unregisterDeep(v.clip);
    for (const c of clip.__attached || []) unregisterDeep(c);
  }
  function startTicker(fps) {
    /* ⚠ 这里**不能**清注册表：mount 是先建完整棵实例树（全部注册）再启节拍的，
     * 第一版 startTicker 里调 stopTicker() 顺手 clear 了注册表，
     * 结果整页只有"之后才出生"的实例在播 —— 首页松鼠永远停在第 1 帧。
     * 清表是视图自己的事（`destroy` / 新视图新表），不是启节拍的事。 */
    if (ticker) clearInterval(ticker);
    const ms = Math.max(16, 1000 / (fps || 14));
    ticker = setInterval(() => {
      if (typeof document !== 'undefined' && (document.hidden || pageBlurred)) return;
      tickCount++;
      for (const view of [...views]) {
        if (!view.root || !view.root.isConnected) {
          view.live.clear(); views.delete(view); continue;
        }
        for (const c of [...view.live]) {
          /* 被"钉住"的实例（装备持有者）：帧号由外面指定，不自己走。
           * 不钉住的话它会自由播放，每帧放出一个不同的挂点，装备就会在角色身上乱跳。 */
          if (c.__pinFrame != null) {
            if (c.frame !== c.__pinFrame) { c.frame = c.__pinFrame; try { c.showFrame(); } catch (e) {} }
            continue;
          }
          if (!c.playing || c.frames.length < 2) continue;
          if (!c.g.isConnected) { unregisterDeep(c); continue; }   // 已被摘除的实例：回收
          c.frame = (c.frame + 1) % c.frames.length;
          try { c.showFrame(); } catch (e) {}
        }
        /* 每拍结束后的视图钩子：页面用它把"必须压在角色上面的装备骨"重新提到末尾
         * （换帧会按深度重排 `myself` 的子节点，`liftBone()` 只做一次会被后续放置顶掉）。
         * 只有主页注册了这个钩子，战斗/状态页不设，开销为零。 */
        if (typeof view.onTick === 'function') { try { view.onTick(); } catch (e) {} }
      }
      if (!views.size) stopTicker();
    }, ms);
  }
  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = 0; }
  }

  /* ============================================================
   * 静态页策略 —— **"UI 在自己所有可达帧之间乱跳"的统一解法**
   * ------------------------------------------------------------
   * 【根因】这一层忠实实现了 Flash 的语义：`MovieClip` 一出生就 `playing = true`，
   *   节拍器按 14 fps 把它从头到尾循环推进。原版的页面之所以看着"静"，是因为 AS 代码
   *   在每一处都显式 `gotoAndStop`/`stop` 过（按钮停常态帧、立绘停当前外观帧、
   *   数字精灵停某一位、tab 停选中/未选中那一档）。复刻把 AS 换成了 JS，但**没有任何一层
   *   "这一页是静态页"的统一声明** —— "静音"是靠各页各写一遍**事后扫描**
   *   （ui-main.js 的 `freezeDescendants`）实现的，而事后扫描有两个天生的洞：
   *     · **只对扫的那一刻存在的实例生效**。`showFrame()` 换帧会重建子树、新实例默认
   *       `playing = true`；任何一次 `gotoAndStop`（切 tab、换页、翻页、换行、换帧刷新）
   *       之后没有紧接着再扫一遍的元件就开始自播。实测：状态页从武器页切回状态帧后，
   *       立绘四个部位（188 帧）与装备挂点 `ikNode_9`（11 帧）全部开始循环 ——
   *       立绘乱动、装备在自己所有挂点之间乱跳。
   *     · **只走 `nodes`（换帧放置表）**，扫不到 `attachChild()` 挂上去的库元件及其子树。
   *       实测：武器 / 技能页 10 颗图标各自内部那颗 4 帧元件（元件号 = 图标号 − 1）
   *       全部在循环 —— 十颗图标一起"乱跳"。
   * 【解法】把"该静"写成**规则**（按元件名 / 元件号匹配，不绑实例），挂在视图上、
   *   **随实例向下继承**，并在**任何一次实例出生**时套一遍。规则跨换帧重建永久有效，
   *   也不再有"扫不到"的死角（attachChild 的子树同样继承）。
   * 【为什么用 `playing = false` 而不是 `pinFrame`】`pinFrame` 是"每一拍强制拨回这一帧"，
   *   界面代码之后调 `gotoAndStop` 会在 71 ms 内被拨回去 —— 历史上反复踩这个坑
   *   （每个页面文件里都有一段"必须先摘 `__pinFrame`"的注释）。`playing = false` 只是
   *   "不自己往前走"：`gotoAndStop` / `gotoAndPlay` / `pinFrame` / `playOnce` 全部照常生效。
   * 【谁该继续播】只认白名单（`keep`）：原版自带、本来就该一直播的装饰动画。
   *   其余一律"出生即冻结"。
   * ========================================================== */
  /** 造一条策略。/`keep` 里既可以放元件名（`na`，同名字的实例都算），也可以放元件号。 */
  function makePolicy(spec) {
    const s = spec || {};
    const toSet = (v) => new Set((v ? (Array.isArray(v) || v instanceof Set ? [...v] : [v]) : []).map(String));
    return { keepName: toSet(s.keepNames), keepId: toSet(s.keepIds), blankName: toSet(s.blankNames) };
  }
  /** 这一颗是否命中白名单（= 该继续自己播，且**整棵子树都不冻**）。 */
  function policyKeeps(pol, name, id) {
    if (!pol) return false;
    return pol.keepId.has(String(id)) || !!(name && pol.keepName.has(String(name)));
  }
  /** 出生 / 重建之后按策略处理一颗实例：命中白名单的整棵子树免冻，其余 `playing = false`。
   *  ⚠ 冻结**不碰帧号**（帧号永远由界面代码做主，冻结 ≠ 钉帧，见上面那段注释）—— 唯一例外是
   *  `blankNames` 里的**位图数字精灵**：它们的第 1 帧是数字 0、**末帧才是"空白档"**，
   *  没有数据可显示时要停的是末帧。这条规则也写在策略里（而不是事后再扫一遍），
   *  所以 `measureFrameBoxes()` 那种"临时拨帧"把子树重建掉之后，新实例**出生就自动复位**。 */
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
  /** 递归把策略应用到一棵**已经存在**的子树上（含 `attachChild` 挂上来的那一支）。
   *  ⚠ 必须**沿着树往下写 `__policy`**，不能只 `applyStatic()`：`applyStatic` 读的是
   *  实例自己的 `__policy`，而挂载时建出来的那些实例是在"视图还没有策略"的时候出生的
   *  （它们的 `__policy` 是 null）—— 只读不写的话这一遍扫描等于什么都没冻。 */
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

  /* ---------- MovieClip：一个精灵实例 ---------- */
  function MovieClip(tag, rootDefs, opts) {
    this.tag = tag;
    this.uid = ++clipSeq;            // 实例唯一号（`debug()` 用；跨采样认同一颗实例）
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
    /* 静态页策略（见上面那段注释）：`__policy` 由父实例继承下来，`__keepAnim` = 已经判定
     * "这一支该继续播"（整棵子树免检），`__playLock` = 界面代码正在自己推帧，别冻它。
     * 根视图的策略由 `buildView` 从 `opts.policy` 装，子实例一律从父实例抄。 */
    this.__policy = null;
    this.__keepAnim = false;
    this.__playLock = false;
    const reg = this.opts && this.opts.live;
    if (reg) reg.add(this);
  }
  /** 给一棵子树立"静态页策略"。规则**只由实例名 / 元件号描述**，所以换帧重建出来的
   *  新实例自动适用（这是与老的"事后扫一遍实例"最本质的区别，见上面那段注释）。 */
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
  /* 蒙版（SWF `cD` 裁剪深度）的 clipPath 宿主：挂在本实例的 <g> 里，
   * 这样 id 唯一、作用域也只在本实例内。 */
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
      /* 只有**形状**能直接当蒙版；tp 39 精灵当蒙版的情况村庄页没有，遇到就退回不裁
       * （宁可多画一层，也不要裁错整块界面）。
       * ⚠ 路径必须**直接**放进 <clipPath>：SVG 规定 clipPath 的子元素只能是形状元素，
       * 包一层 <g>（shapeNode 的产物）会被整组忽略 —— clipPath 变空 → 被裁的兄弟整块消失
       * （体力/经验条的填充就是这么"没了"的）。 */
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
    const frame = this.frames[this.frame] || new Map();
    /* 帧是否真的推进了：同帧重复 showFrame（比如每秒刷新数值时的 gotoAndStop(原帧)）
     * 在 Flash 里不会重建显示列表，rp 也不重新生效。 */
    const frameAdvanced = this.__shownFrame !== this.frame;
    this.names.clear();
    const depths = [...frame.keys()].sort((a, b) => a - b);
    /* Most animation steps only change matrices. Moving every reused node to the end of its
     * parent would still invalidate the SVG display list. Skip moves only when the complete
     * depth order already matches, including the boundary before runtime attachments. */
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
    /* 裁剪深度（SWF `cD`）：带 cD 的放置是**蒙版**，遮住「比自己深、且不超过 cD」的兄弟节点，
     * 而它自己**不参与绘制**（Flash 里蒙版形状只是一条裁剪轮廓）。
     * 村庄页只有两处 —— 体力条的填充（7022 d1→cD 3）与经验条的填充（4318 同理），
     * 但缺了它后果很明显：蒙版形状没有填充样式 → SVG 默认填成**黑色**，既盖住「体力」两个字，
     * 又让填充条整条露出来（和经验条外框对不上）。 */
    const masks = [];
    for (const d of depths) {
      const q = frame.get(d);
      if (q && q.cD !== undefined) masks.push({ d: d, cD: q.cD, p: q });
    }
    const isMaskDepth = (d) => { for (const m of masks) if (m.d === d) return true; return false; };
    const maskOf = (d) => { for (const m of masks) if (d > m.d && d <= m.cD) return m; return null; };
    const next = new Map();
    for (const d of depths) {
      const p = frame.get(d);
      const prev = this.nodes.get(d);
      /* 实例复用（动画的关键）：同深度、同元件 → 保留原实例，只更新变换，
       * 子 clip 的播放头不重置 —— Flash 就是这么做的。
       * 唯一的例外：帧推进后，该深度有一条"这一帧段里真正出现"的 rp 放置 ——
       * 那是 Flash 的真重置（新实例从第 1 帧播），main 页闭包里有 52 处这种用法。 */
      const replace = frameAdvanced && !!(p.rp && p.placedHere);
      if (prev && prev.id === String(p.id) && !replace) {
        prev.node.__baseMa = p.ma || null;
        applyNodeXform(prev.node);
        updateAttribute(prev.node, 'opacity', p.opacity);
        applyCx(prev.node, cxOf(p), this.rootDefs, this.tag.id, d);
        /* 蒙版可以在后续帧出现、撤销或改变覆盖深度，不能只更新已有 wrapper。
         * 保留眼珠等子实例的播放头，但按当前显示列表重新绑定裁剪关系。 */
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
      /* 替换 / 换元件：旧实例（含子树）注销，新实例从第 1 帧开始播 */
      if (prev) {
        if (prev.clip) unregisterDeep(prev.clip);
        /* ⚠ 必须按**自己的实际父节点**摘，不能只认 `this.g`：`popWrap()` 会把可见内容
         * 搬进一层 `<g class="uc-pop">` 壳里，那时节点的 parentNode 是壳而不是 `this.g`，
         * 老写法直接跳过删除 → 节点留在壳里继续画 → **每次换帧叠一层重影**
         * （用户 2026-10 报的"选中后的循环动画循环多了之后一堆重影"就是这个）。 */
        const oldHost = prev.wrap || prev.node;
        if (oldHost.parentNode) oldHost.parentNode.removeChild(oldHost);
      }
      const child = this.tagFor(p.id);
      if (!child) continue;                       // 该页素材没提取 → 跳过（不报错）
      let node, clip;
      if (child.tp === 39) {
        clip = new MovieClip(child, this.rootDefs, this.opts);
        clip.parent = this;
        /* 【静态页策略】出生就按父实例的规则处理 —— 这里是"乱跳"被根治的地方：
         * 无论换帧重建多少次，新实例一出生就是 `playing = false`，不会自己走。 */
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
      /* 被蒙版罩住的兄弟：套一层带 clip-path 的 <g>（wrapper 不带 transform，
       * 于是 clipPath 与蒙版处在同一个父坐标系里，矩阵直接对得上）。 */
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
      /* 新实例出生回调：**必须在节点进文档之后**再调。
       * 原版每个挂点精灵在自己的 frame 1 脚本里"自我声明"该长哪件装备；复刻没有 AS，
       * 由外面在这里接管（见 ui-main.js 的穿搭逻辑）。
       * ⚠ 以前回调放在 `placeFrameNode` 之前，`setSymbol` → `anchorToBBox` 里的
       * `getBBox()` 量不到（节点还不在文档里），只能等下一帧；装备就会被隐藏一帧
       * —— 战斗每回合复位身体时，玩家看到的就是"闪一下"（用户 2026-10 口径）。 */
      if (clip && this.opts && typeof this.opts.onClip === 'function') {
        try { this.opts.onClip(clip); } catch (e) {}
      }
      next.set(d, { id: String(p.id), node, clip, wrap, isMask: isMaskDepth(d), na: p.na || null });
    }
    /* 新帧里不存在的深度：移除（并注销子树）
     * ⚠ 与上面"替换"那一支同理：按**自己的实际父节点**摘。`popWrap()` 的 `<g class="uc-pop">`
     * 壳会让 `parentNode === this.g` 判假，漏删的节点会一直留在壳里被画出来 ——
     * 表现就是"动画循环越久、重影越多"（用户 2026-10 报的主界面重影）。 */
    for (const [d, old] of this.nodes) {
      if (next.has(d)) continue;
      if (old.clip) unregisterDeep(old.clip);
      const host = old.wrap || old.node;
      if (host.parentNode) host.parentNode.removeChild(host);
    }
    this.nodes = next;
    this.__shownFrame = this.frame;
    /* 页面可选的帧后处理；素材自身的深度和蒙版由上面的显示列表维护。
     * 回调异常不能中断整棵动画树。 */
    if (typeof this.__frameFix === 'function') {
      try { this.__frameFix(this); } catch (e) {}
    }
    return this;
  };
  MovieClip.prototype.tagFor = function (id) {
    if (!bundle) return null;
    return bundle.hash.get(String(id)) || null;
  };
  /** 按名字取子元件：原版界面代码就是靠这个寻址的 */
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
  /** 把实例**钉在某一帧**上：节拍不再自己推进它（装备持有者用）。1-based 帧号。 */
  MovieClip.prototype.pinFrame = function (n) {
    const idx = Math.max(0, Math.min(this.frames.length - 1, (n || 1) - 1));
    this.__pinFrame = idx;
    if (this.frame !== idx) { this.frame = idx; try { this.showFrame(); } catch (e) {} }
    return this;
  };
  MovieClip.prototype.frameCount = function () { return this.frames.length; };
  /* ---------- 复刻侧的"微调变换" ----------
   * 原版矩阵（`ma`）由**父级**在换帧时写到自己身上，所以直接 setAttribute('transform')
   * 会被下一帧冲掉。这里把两者分开存：`__baseMa` = 原版矩阵、`__extra` = 复刻侧附加段，
   * 合成时是 `matrix(base) <extra>`（SVG 里左边先作用，等价于"先 extra 再 base"）。
   * 用途：经验百分比数字缩放/居中（`ui-main.js`）、装备挂点的锚点补偿。 */
  MovieClip.prototype.setExtraTransform = function (t) {
    this.g.__extra = t || '';
    this.applyXform();
    return this;
  };
  /** 把「原版矩阵 + 复刻侧附加段」合成写回某个节点。形状与精灵通用。 */
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
  /** 给**本实例某个深度上的子节点**（含形状）挂一段附加变换。 */
  MovieClip.prototype.setDepthExtra = function (depth, extra) {
    const v = this.nodes.get(depth);
    if (!v) return false;
    v.node.__extra = extra || '';
    applyNodeXform(v.node);
    return true;
  };
  /** 把本实例**换成另一个元件的视图** —— 原版给角色穿装备就是
   * `挂点.attachMovie(容器).gotoAndStop(frame)`（MainMovie.as:6608 constructBpData）。
   * 而挂点精灵自己是个**空壳**（实测 5120 第 1 帧 0 个放置），所以不必真开一条 attach 通道，
   * 直接把时间轴换成容器的时间轴、再 gotoAndStop(frame) 就行 —— 帧差分 / 节点复用 / 动画
   * 这些既有机制全部照旧生效。 */
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
    /* 【静态页策略】换了时间轴 = 元件号变了，白名单要按新元件号重判一次 */
    this.__keepAnim = false;
    applyStatic(this, null);
    return true;
  };
  /** 在本实例上**直接挂一个子元件**（原版 `chooseEquipLoader` 的
   * `mc.attachMovie(容器, "mc"+type+which, 100, {_x:0,_y:0})` 走的就是这条：
   * 容器不是挂到"挂点空壳"上，而是直接挂到 `myself` 自己身上，坐标就是它自己的画稿坐标）。
   * 手动挂的子节点不进 `nodes` 表，所以换帧的清扫不会动它。 */
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
  /** 界面代码显式接管"让这一颗自己播"（`playOnce` 那种自己推帧的场合）：
   *  打上记号之后静态页策略在接管期间不再冻它；`holdAnim(false)` 交回去。 */
  MovieClip.prototype.holdAnim = function (on) { this.__playLock = on !== false; return this; };
  MovieClip.prototype.detachAll = function () {
    for (const c of this.__attached || []) {
      unregisterDeep(c);
      if (c.g.parentNode) c.g.parentNode.removeChild(c.g);
    }
    this.__attached = [];
  };
  /** 把内容缩放 `s` 后，再平移到「缩放后的包围盒 <mode> 点 = 本实例原点」。
   * 依据：原版 `constructBpData` 并不直接挂容器，而是 `convertMcToBp(容器)` 渲染成**位图**再
   * `attachBitmap`（MainMovie.as:6643-6646 / :6798）—— 位图的锚点由 `convertMcToBp` 决定，
   * 而它**在反编译源码里没有定义**，所以锚点只能实测标定：
   *   'topleft' = 包围盒左上角（位图的天然锚点）
   *   'center'  = 包围盒中心
   *   'bottom'  = 包围盒下边中点
   * `s` 是缩放补偿。`tail` 是"画稿自身偏移"（每件装备不一样，见 ui-main.js 的 GEAR_OFFSET_BY_ID）——
   * **必须从这里拼进去**：实例刚建出来时还没进文档，`getBBox()` 拿不到，会安排下一帧重算，
   * 那次重算会**整段重写 `__extra`**；调用方如果在外面 append 偏移，会被这次重算悄悄抹掉
   * （2026-10 就是踩了这个：偏移量看着写对了，实测一点没动）。 */
  /* 装备容器的包围盒只跟「元件号 + 帧号」有关，量一次就能一直用。
   * 缓存它之后，战斗里每回合重建身体/挂点时不必再等下一帧量 bbox ——
   * 否则等 bbox 的那一帧要把装备藏起来，玩家看到的就是每回合闪一下（2026-10 口径）。 */
  const bboxCache = new Map();
  MovieClip.prototype.anchorToBBox = function (s, mode, tail, retry) {
    const self = this, sc = (s && s !== 1) ? s : 1, md = mode || 'topleft';
    const after = tail ? ' ' + tail : '';
    /* 【装备/贴图在屏幕上方闪一下】实例刚出生时还没进文档，`getBBox()` 量不到，
     * 这里会等下一帧再量。那一帧里节点已经用**容器画稿自己的原始坐标**画出来
     * （装备挂点的局部原点在角色身上，画稿却按另一套坐标铺开），观感就是屏幕上方
     * 闪一下一件装备/半只小人。等包围盒期间先藏起来，量到（或重试也量不到）再放回。
     * `__anchorSeq` 防止换符号后旧的 rAF 回调把新内容按旧包围盒摆一次。 */
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
      /* 子树还在**同一个同步任务**里构建：`showFrame()` 先 `new MovieClip` + `showFrame()`、
       * 之后才 `placeFrameNode()` 把它放进父节点，所以挂点 / 装备容器出生那一刻
       * `isConnected === false`，`getBBox()` 恒为 0。战斗角色本体（`attachChild` 挂 7689 /
       * 6532，再逐层建动作片断）正是这条路径 —— 只靠下面的 rAF 补锚点在**隐藏标签页**
       * （rAF 被节流/暂停）永远不会执行，身体装备就停在没锚点的位置（用户 2026-10 口径：
       * "战斗中的身体装备贴图完全没有合身"）。
       * 先排一个 microtask：同步构建结束后整棵树已经入文档，再量一次就能**同拍**补上锚点；
       * rAF 那条保留给"布局还没算完"的情况。 */
      if (!retry && this.g && this.g.isConnected === false && typeof Promise !== 'undefined') {
        Promise.resolve().then(() => {
          if (self.__anchorSeq !== seq) return;
          try { self.anchorToBBox(sc, md, tail, true); } catch (e) {}
        });
        return;
      }
      if (!retry && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          /* 这一帧里如果已经换了符号 / 重新锚定过，旧回调不能再拿旧包围盒摆一次。 */
          if (self.__anchorSeq !== seq) return;
          try { self.anchorToBBox(sc, md, tail, true); } catch (e) {}
        });
      } else {
        /* 重试也量不到（或没有 rAF）：不要把它永久藏住，保持原来的行为。 */
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

  /* ---------- 挂载：根时间轴第 N 帧 → 一棵 SVG ---------- */
  /** 建根 `<svg>`：`viewBox` 用**根舞台**（`timeline.Ft/Fw/Fh`），缩放交给容器。
   *  原版舞台就是裁切框，所以超出舞台的内容照原样裁掉 —— 与 Flash 一致。 */
  function svgRoot(rootHost, viewBox, preserve) {
    const svg = el('svg', {
      viewBox: viewBox,
      /* 默认 meet（等比装进容器、留边）而不是 slice（裁切）：
       * 原版舞台的边缘就是顶栏/底栏，裁掉就少内容。 */
      preserveAspectRatio: preserve || 'xMidYMid meet',
      width: '100%', height: '100%',
    });
    rootHost.appendChild(svg);
    return svg;
  }
  /** 把一块 `<svg>` 的「屏幕坐标 ↔ 用户坐标」关系算出来。
   *
   *  为什么不用 `getScreenCTM()`：WebKit 209220（iOS 15.5/15.6 仍复现）的 CTM 不含
   *  祖先 CSS transform 的 scale，本作 `#ui` 用 `transform: scale(sx,sy)` 适配窗口，
   *  直接乘 CTM 会把覆盖物画到旁边 / 尺寸缩小。
   *
   *  也**不能假设 sx === sy**：系统设置「全面屏」时 `fitCanvas()` 让两轴各自铺满窗口
   *  （见 main.js），iPhone 横屏下 x、y 比例能差 30% 以上。以前这里只用
   *  `rect.width / viewBox.width` 一个比例，金环/手指/三侠图集层在全面屏下会横向拉宽、
   *  纵向压扁，看起来就是「位置和大小突然变了」。
   *
   *  返回的 `toUser()` / `toClient()` 对两轴分别换算；`content` 是 viewBox 内容在
   *  **设计单位**（未乘 `#ui`）里的矩形，供 HTML 覆盖层直接按设计坐标定位。
   *  量不到（隐藏 / 尚未布局）时返回 null。 */
  function svgScreenMap(svg) {
    if (!svg || !svg.getBoundingClientRect || !svg.viewBox) return null;
    let box;
    try { box = svg.getBoundingClientRect(); } catch (e) { return null; }
    const vb = svg.viewBox.baseVal;
    if (!box || !(box.width > 0) || !(box.height > 0) || !vb || !(vb.width > 0) || !(vb.height > 0)) return null;
    /* 需要的是 **CSS 布局尺寸**（不含 #ui transform），用它把屏幕像素折回设计像素。
     * 优先读 computed style：`width:auto;height:100%` 在 WebKit 上会解析成实际 px，
     * 而且**不会**像 SVG 的 clientWidth/clientHeight 那样在个别 WKWebView 版本里
     * 退回 viewBox 尺寸/0。clientWidth 只作兜底，最后才退回屏幕矩形。 */
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

  /** 建一棵挂在 `root`（一个 `<svg>`）上的时间轴：共用 mount / mountSymbol 的收尾。
   *  `framesOverride` 给根时间轴用（它的帧快照在 `timeline.frames` 里已经切好了）。 */
  function buildView(root, tag, tl, o, frame, framesOverride) {
    if (!o.live) o.live = new Set();                // 本视图的播放注册表（见"播放注册表"那段注释）
    const view = new MovieClip(tag, root, o);
    view.g = root;                                  // 根时间轴自己就是一个 <svg>
    view.live = o.live;                             // 本视图的播放注册表（节拍器按视图遍历）
    if (framesOverride) view.frames = framesOverride;
    view.frame = Math.max(0, Math.min(view.frames.length - 1, (frame || 1) - 1));
    /* 根时间轴相当于已经被 `_root.gotoAndStop(标签)` 停住（原版界面代码就是这么切的），
     * 只有它里面的子元件继续自动播放。 */
    view.playing = false;
    /* 挂载时就能声明"这是一页静态页"（`opts.policy`）：子树里所有实例**出生即冻结**
     * （见上面"静态页策略"那段注释）。页面代码随后再调 `freezeDescendants` 也等价（幂等）。 */
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
      /* ⚠ 不再无条件 `stopTicker()`：别的视图（盖在下面的那一页）还在播。
       * 一个视图都不剩时才停节拍。 */
      if (!views.size) stopTicker();
    };
    return view;
  }
  async function mount(container, opts) {
    const b = await load();
    /* ⚠ 复制一份 opts：播放注册表（`live`）与静态页策略（`policy`）要写在**这一次挂载自己的**
     * 对象上，直接改调用方传进来的对象会把上一次挂载的设置带进来。 */
    const o = Object.assign({}, opts || {});
    const tl = b.timeline;
    container.classList.add('ssfight-view');
    while (container.firstChild) container.removeChild(container.firstChild);

    const viewBox = tl.Ft.xi + ' ' + tl.Ft.yi + ' ' + (tl.Fw || 320) + ' ' + (tl.Fh || 196);
    const root = svgRoot(container, viewBox, o.preserveAspectRatio);
    if (tl.Bg && tl.Bg !== '#FFFFFF') {
      root.appendChild(el('rect', { x: tl.Ft.xi, y: tl.Ft.yi, width: tl.Fw, height: tl.Fh, fill: tl.Bg }));
    }

    /* 根时间轴也是一条 SWF 标签流，同一个 MovieClip 概念；
     * 只是它的帧快照在导出里已经切好了（timeline.frames），直接用。 */
    const rootTag = { id: 'root', tp: 39, Sf: null };
    const frames = tl.frames.map((placements) => {
      const m = new Map();
      for (const p of placements) m.set(p.d, p);
      return m;
    });
    return buildView(root, rootTag, tl, o, o.frame === undefined ? 1 : o.frame, frames);
  }

  /* ---------- 挂载：**一个库元件**（不是根时间轴的帧）----------
   * 原版有一大批页面不是根时间轴的帧，而是运行时 `_root.attachMovie("家园弹出", …)` 挂上去的
   * **库元件**（村庄四个地点的场景就是：家园弹出 3957 / 幻兽牧场 4381 / 征战 3437）。
   * 它们不在 `timeline.json` 里，所以走这条独立的路。
   *
   * 三个要点：
   *  · **viewBox 用根舞台**，不用元件自己的包围盒：原版是挂在根舞台上、`_xscale=100`、(0,0)，
   *    跟村庄页共用同一套坐标，超出 320×196 的部分由舞台裁掉。元件自己的 `Ft` 是
   *    **所有帧的并集**（实测 4381 是 -273..600 × -349..523），拿它当视口会把整页缩成一小团。
   *  · 根元件**必须 `playing=false`**：这类容器本身就是"11 页共用一条时间轴"，
   *    让它自由播就会在页与页之间循环 —— 正是用户看到过的"UI 胡乱播放动画"。
   *  · 素材包要**先** `loadExtra()`（调用方负责），这里是纯渲染。
   *
   * 用法： await SfRender.loadExtra('tags-homeland.json');
   *        const view = await SfRender.mountSymbol(el, '3957', { frame: 1, label: '祭坛' });
   *        view.byName('text2') / view.gotoAndStop(3) */
  async function mountSymbol(container, id, opts) {
    const b = await load();
    const tag = b.hash.get(String(id));
    if (!tag) throw new Error('素材库里没有元件 ' + id + '（对应的 tags-*.json 没加载？）');
    if (tag.tp !== 39) throw new Error('元件 ' + id + ' 不是精灵（tp' + tag.tp + '），挂不了');
    const o = Object.assign({}, opts || {});
    const tl = b.timeline;
    /* ⚠ 挂**库元件**的都是"二级/整页展开"的那一层（挑战页 7638 / 状态页 7218 /
     * 村庄地点页 / 动作菜单 4756…），它们**不属于村庄主页**。
     * `classic.css` 有一条"进二级页时把村庄主页藏掉"的规则，靠 `ssfight-home-page`
     * 这个标记来认人（见那里的注释）—— 所以这里把它摘干净，免得被误伤藏掉。 */
    container.classList.remove('ssfight-home-page');
    while (container.firstChild) container.removeChild(container.firstChild);
    const viewBox = o.viewBox || (tl.Ft.xi + ' ' + tl.Ft.yi + ' ' + (tl.Fw || 320) + ' ' + (tl.Fh || 196));
    const root = svgRoot(container, viewBox, o.preserveAspectRatio);
    const view = buildView(root, tag, tl, o, o.frame === undefined ? 1 : o.frame);
    /* `opts.blank`：**建树的那一刻**就把几个字段清空。
     * ------------------------------------------------------------
     * 原版素材里的文本字段带**作者的占位串**（状态页的 `expNum` 写的是
     * "999999/999999"、武器详情 `requirement` 里是 "900000"），真值由界面在挂载之后
     * 才写进去 —— 中间那一瞬间（`mountSymbol` 的 `await` 回来之前）玩家看到的
     * 就是满屏的 9999999 / 00000000（用户 2026-10 报的"切回来全屏数字变 9999999
     * 或 00000000 持续 1 秒左右"）。这些字段的值**百分百由界面提供**，
     * 所以出生就清空最省事，也不用改素材。
     * 传 `na` 名字数组；不传 / 空数组时行为完全不变。 */
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
    load, loaded, loadExtra, mount, mountSymbol, buildFrames, stopTicker,
    /** 换掉一个文本容器的内容（**会真的按换行断行**；`opts.wrap=true` 时按字段框宽自动折行）。返回是否认出来了。 */
    setText,
    /** 屏幕坐标 ↔ SVG 用户坐标（两轴分别换算；全面屏/`#ui` 非等比缩放也正确）。
     *  页面覆盖物（引导金环、三侠图集层）用它，避免 iOS 15 的 `getScreenCTM` 209220。 */
    svgScreenMap,
    BASE,
    /** 素材库是否已就绪（页面里可以先探测再决定要不要走经典模式） */
    tags: () => (bundle ? bundle.tags : null),
    timeline: () => (bundle ? bundle.timeline : null),
    /** 当前注册的播放实例数（自检/调试用） */
    liveCount: () => { let n = 0; for (const v of views) n += v.live.size; return n; },
    /** 当前活着的视图数（盖层场景下会 >1；自检用） */
    viewCount: () => views.size,
    /** 把一条**静态页策略**套到一个视图上（`ui-main.js` 的 `freezeDescendants` 走这里）。
     *  `spec = { keepNames: [...名字], keepIds: [...元件号], blankNames: [...末帧空白的数字精灵] }`。
     *  规则会随实例向下继承，换帧重建出来的新实例自动适用。 */
    setStaticPolicy: (view, spec) => (view && view.setStaticPolicy ? view.setStaticPolicy(spec) : null),
    /** 自检/调试：节拍数 + 每个注册实例的播放状态 */
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
