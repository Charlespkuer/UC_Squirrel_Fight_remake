/* ============================================================
 * ui-prop-use.js — 经典背包「道具使用」弹窗（原版「道具1」4886 第 1 帧）
 * ------------------------------------------------------------
 * 原版链路：
 *   `seeProp()`（MainMovie.as:20852）对 `useType == 1` 的道具走
 *   `showUsePropWin(prop)`（:20992）：
 *     `loadMcs([["道具1","daojuSub"]])` → `daojuSub.gotoAndStop(1)`
 *     填 `c1` 图标 / `name` / `vipDes`，`useDaojuButtons = [button1, button2]`。
 *   输入处理（:20545 的 state 1）左边 = 使用、右边 = 取消。
 *
 * 用户 2026-10 口径：**界面本身必须拉 ssfight 的素材替换**，但把「使用 / 取消」两颗
 * 按钮的左右位置对调。这里不画 DOM 弹窗：用 4886 第 1 帧原画，挂载后把 button1（使用）
 * 与 button2（取消）的 x 平移互换；文字/图标仍写进原版字段（name / vipDes / c1）。
 *
 * 素材包：`tags-daoju.json`（道具页 + 4886 闭包）。只有真的开「使用」弹窗才拉。
 * ========================================================== */
(function () {
  'use strict';

  const T = () => (window.SfUiMain && SfUiMain.toolkit) || null;
  const clipOf = (host, name) => (host && host.byName ? host.byName(name) : null);
  const stopAt = (clip, frame) => {
    if (!clip || !clip.gotoAndStop) return;
    try { clip.gotoAndStop(frame); } catch (e) {}
  };
  const iconSrc = (id) => [79, 82, 90].includes(Number(id))
    ? 'images/ui/icons/prop/prop-' + Number(id) + '.svg'
    : 'images/ui/icons/prop/prop-' + Number(id) + '.png';

  let session = null;

  function createHost(extra) {
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const host = document.createElement('section');
    /* 与 ui-compose / 状态页同一套宿主约定：ssfight-view 保住经典层，
     * ssfight-sub 抬到二级页之上；classic-home 的 pointer-events:none 由按钮自己覆盖。
     * ⚠ 不要加 `ssfight-home`：`main.js` 的 fitCanvas 把 `.ssfight-home` 当成
     *   320×196 整页，一挂弹窗就会把 #ui 从 690 改成 716.625，底下的背包/商店
     *   背景跟着纵向拉伸、漂移（用户 2026-10 报的“打开使用窗口背景漂移”）。 */
    host.className = 'classic-home ssfight-sub ssfight-view sf-prop-use-view' + (extra ? ' ' + extra : '');
    host.setAttribute('aria-label', '道具使用');
    ui.appendChild(host);
    return host;
  }

  /** 只拆这一份 session，不碰后来打开的那一份（异步/旧 handle 回来时尤其重要）。 */
  function dispose(rec) {
    if (!rec || rec.closed) return;
    rec.closed = true;
    if (rec.observer) { try { rec.observer.disconnect(); } catch (e) {} rec.observer = null; }
    if (rec.view) { try { rec.view.destroy(); } catch (e) {} }
    if (rec.host && rec.host.parentNode) rec.host.parentNode.removeChild(rec.host);
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
  }

  function destroy() {
    const rec = session;
    session = null;
    dispose(rec);
  }

  function closeSession(rec) {
    if (!rec || rec.closed) return;
    if (session === rec) session = null;
    dispose(rec);
    if (typeof rec.onClose === 'function') {
      try { rec.onClose(); } catch (e) {}
    }
  }

  function close() { closeSession(session); }

  function setText(view, name, value) {
    const clip = clipOf(view, name);
    if (clip) SfRender.setText(clip, String(value == null ? '' : value));
  }

  /** 把道具图集图标放进原版 c1（3414 第 2 帧的空图标位），与合成页同一条做法。 */
  function paintIcon(clip, src) {
    if (!clip || !clip.g || !src) return;
    const host = clip.getContentHost ? clip.getContentHost() : clip.g;
    if (!host) return;
    for (const old of host.querySelectorAll('image.sf-prop-use-icon')) old.remove();
    let box = { x: 0, y: 0, width: 44, height: 44 };
    try { if (clip.g.getBBox) box = clip.g.getBBox(); } catch (e) {}
    const base = Math.min(Math.max(24, Number(box.width) || 44), Math.max(24, Number(box.height) || 44));
    const size = Math.round(base * 0.86);
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('class', 'sf-prop-use-icon');
    img.setAttribute('href', src);
    img.setAttribute('xlink:href', src);
    img.setAttribute('x', String((Number(box.x) || 0) + ((Number(box.width) || 44) - size) / 2));
    img.setAttribute('y', String((Number(box.y) || 0) + ((Number(box.height) || 44) - size) / 2));
    img.setAttribute('width', String(size));
    img.setAttribute('height', String(size));
    img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    img.setAttribute('pointer-events', 'none');
    host.appendChild(img);
  }

  /* ---------- 矢量道具图标：原版 `c1.attachMovie(<道具名>)` 的库元件 ----------
   * `prop-icons.json` 是 `gen-ssfight-ui.cjs daoju` 从 SWF 导出的 id→元件号；
   * `tags-daoju.json` 现在含这些库元件的闭包。先画一张 PNG 兜底，矢量挂上来后
   * 再把它删掉，所以素材缺失/慢加载时不会出现空图标。 */
  let propIconMapPromise = null;
  function propIconMap() {
    if (!propIconMapPromise) {
      propIconMapPromise = (typeof fetch === 'function'
        ? fetch('images/ssfight/ui/prop-icons.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : Promise.resolve(null));
    }
    return propIconMapPromise;
  }

  async function paintVectorIcon(clip, id) {
    if (!clip || !clip.g || !window.SfRender || !SfRender.mountSymbol) return;
    const map = await propIconMap();
    const rec = map && map.byId && map.byId[String(id)];
    const sym = rec && rec.id;
    if (!sym || clip.g.isConnected === false) return;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:64px;height:64px;overflow:hidden;pointer-events:none';
    document.body.appendChild(host);
    let view = null;
    try {
      view = await SfRender.mountSymbol(host, sym, {
        frame: 1, label: '道具矢量图标', viewBox: '0 -2 47 47',
      });
      if (clip.g.isConnected === false) return;
      const src = view && (view.g || view.root);
      if (!src) return;
      const box = (() => { try { return clip.g.getBBox(); } catch (e) { return null; } })();
      const w = Math.max(24, Number(box && box.width) || 44);
      const h = Math.max(24, Number(box && box.height) || 44);
      const size = Math.min(w, h) * 0.92;
      const svg = src.cloneNode(true);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('x', String((Number(box && box.x) || 0) + (w - size) / 2));
      svg.setAttribute('y', String((Number(box && box.y) || 0) + (h - size) / 2));
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.setAttribute('pointer-events', 'none');
      const target = clip.getContentHost ? clip.getContentHost() : clip.g;
      if (!target) return;
      for (const old of target.querySelectorAll('image.sf-prop-use-icon')) old.remove();
      target.appendChild(svg);
    } catch (e) {
      if (window.__errs) window.__errs.push('prop vector icon: ' + (e && e.message));
    } finally {
      if (view) { try { view.destroy(); } catch (e) {} }
      host.remove();
    }
  }

  /** 原版按钮的放置矩阵（`0.927963,0,0,0.927963,x,y`）。 */
  function baseMatrix(clip) {
    const raw = clip && clip.g && clip.g.__baseMa;
    if (typeof raw !== 'string') return null;
    const p = raw.split(',').map(Number);
    return p.length === 6 && p.every((v) => Number.isFinite(v)) ? p : null;
  }

  /** 用户口径：把 ssfight 的「使用 / 取消」左右位置对调。
   * 两颗按钮的 y / 缩放不变，只把 x 平移到对方原来的位置。 */
  function swapButtons(use, cancel) {
    const a = baseMatrix(use), b = baseMatrix(cancel);
    if (!a || !b) return;
    const dx = b[4] - a[4];
    const sa = Math.abs(a[0]) || 1, sb = Math.abs(b[0]) || 1;
    if (use.setExtraTransform) use.setExtraTransform('translate(' + (dx / sa).toFixed(3) + ',0)');
    if (cancel.setExtraTransform) cancel.setExtraTransform('translate(' + (-dx / sb).toFixed(3) + ',0)');
  }

  /** 商店购买窗：挂 4886 第 1 帧（与背包详情窗同一份画稿），再把第 2 帧的
   *  两颗按钮（d22 购买 4505 / d26 取消 4419，含原版位置与缩放）并进来。
   *  用户 2026-10 口径：除「取消 / 购买」外，其余排版必须和背包详情完全一致；
   *  按钮位置/缩放沿用购买窗（f2），左右由 `swapButtons` 对调。
   *  f1 自带的「使用」(d9) 与「取消」(d13) 不能留，否则会和并入的两颗叠在一起。 */
  function mergeBuyFrame(view) {
    if (!view || !view.tag || !SfRender.buildFrames) return false;
    const all = SfRender.buildFrames(view.tag.Sf);
    const base = all[0], buy = all[1];
    if (!base || !buy) return false;
    const merged = new Map(base);
    merged.delete(9);
    merged.delete(13);
    for (const depth of [22, 26]) {
      const p = buy.get(depth);
      if (p) merged.set(depth, p);
    }
    view.frames = [merged];
    view.frame = 0;
    view.showFrame();
    return true;
  }

  /** 把一颗按钮水平移到弹窗中心（不可使用道具的详情只留一颗取消键）。 */
  function centerClip(clip, centerX) {
    if (!clip || !clip.g) return;
    const m = baseMatrix(clip);
    if (!m) return;
    const scale = Math.abs(m[0]) || 1;
    const b = (() => { try { return clip.g.getBBox(); } catch (e) { return null; } })();
    if (!b) return;
    const bx = Number(b.x) || 0, bw = Number(b.width) || 0;
    const current = m[4] + (bx + bw / 2) * m[0];
    const dx = (Number(centerX) - current) / scale;
    if (clip.setExtraTransform) clip.setExtraTransform('translate(' + dx.toFixed(3) + ',0)');
  }
  /** 接一颗原版按钮：默认第 1 帧常态（奶油灰）/ 第 2 帧悬停（绿）。
   *  `opts.idle` / `opts.hover` 可覆盖（合成页等也复用同一套约定）。 */
  function wireButton(clip, onFire, role, opts) {
    if (!clip || !clip.g) return;
    const idle = opts && opts.idle != null ? opts.idle : 1;
    const hover = opts && opts.hover != null ? opts.hover : 2;
    clip.g.style.cursor = 'pointer';
    clip.g.style.pointerEvents = 'auto';
    if (role === 'use') {
      clip.g.classList.add('sf-prop-use-btn');
      clip.g.setAttribute('data-prop-use', '1');
    } else if (role === 'buy') {
      clip.g.classList.add('sf-prop-buy-btn');
      clip.g.setAttribute('data-prop-buy', '1');
    } else if (role === 'cancel') {
      clip.g.classList.add('sf-prop-cancel-btn');
      clip.g.setAttribute('data-prop-cancel', '1');
    }
    stopAt(clip, idle);
    const t = T();
    if (t) {
      try { t.measureHitBox(clip); t.popWrap(clip); } catch (e) {}
      const shell = clip.g.querySelector(':scope > g.uc-pop');
      if (shell) { try { t.wirePopPress(shell); } catch (e) {} }
    }
    clip.g.addEventListener('mouseenter', () => stopAt(clip, hover));
    clip.g.addEventListener('mouseleave', () => stopAt(clip, idle));
    clip.g.addEventListener('click', (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      /* 点完指针仍在按钮上：保持悬停色；真正移开时 mouseleave 再回常态。 */
      stopAt(clip, hover);
      onFire();
    });
  }

  /** 道具说明：背包使用窗 / 不可使用道具的详情窗 / 商店购买窗共用同一套排版
   *  （10px、最多两行、黑色，行高沿用素材烘焙值）。用户 2026-10 口径：
   *  购买窗除两颗按钮外必须与背包详情逐项一致，所以这里只留一份实现。 */
  function writeRemark(view, text) {
    setWrappedField(clipOf(view, 'vipDes'), text == null ? '' : text, 10, 2);
  }

  function fill(view, id) {
    const base = propMap.getValue(Number(id));
    if (!base) return;
    setText(view, 'name', base.name);
    writeRemark(view, base.remark);
    const c1 = clipOf(view, 'c1');
    stopAt(c1, 2);
    paintIcon(c1, iconSrc(id));
    void paintVectorIcon(c1, id);
  }

  /* ---------- 商店购买窗：4886 第 1 帧版式 + 第 2 帧的两颗按钮 ----------
   * 用户 2026-10 口径：除「取消 / 购买」两颗按钮外，其余排版必须与背包详情
   * （4886 f1，同一个元件）完全一致；按钮位置/缩放沿用购买窗 f2 的 4505/4419，
   * 左右由 `swapButtons` 对调（取消在左、购买在右）。
   * f2 原版的数量条 / 左右箭头 / UC 会员提示都不进合并帧。 */
  function hideClip(clip) {
    const node = clip && (clip.g || clip);
    if (node && node.style) node.style.display = 'none';
  }

  function fillBuy(view, id, base) {
    setText(view, 'name', base.name);
    writeRemark(view, base.remark);
    const c1 = clipOf(view, 'c1');
    stopAt(c1, 2);
    paintIcon(c1, iconSrc(id));
    void paintVectorIcon(c1, id);
  }

  /**
   * 打开商店购买窗。`opts`：
   *   desc / stock / max / onBuy(qty, handle) / onClose()
   * `onBuy` 返回 true 表示买完关窗；返回 false 则保留（多件限购继续买）。
   */
  async function openBuy(propId, opts) {
    opts = opts || {};
    const id = Number(propId);
    const base = propMap.getValue(id);
    if (!base) return null;
    destroy();
    const host = createHost('sf-prop-buy-view');
    if (!host) return null;
    const rec = {
      host: host, propId: id, view: null, observer: null, mode: 'buy',
      onBuy: opts.onBuy, onClose: opts.onClose, onStale: opts.onStale,
      max: Math.max(1, Math.min(50, Number(opts.max) || 50)),
      stock: Math.max(0, Number(opts.stock) || 0),
    };
    session = rec;
    if (window.MutationObserver) {
      try {
        rec.observer = new MutationObserver(() => {
          if (!host.isConnected && !rec.closed) closeSession(rec);
        });
        if (host.parentNode) rec.observer.observe(host.parentNode, { childList: true });
        rec.observer.observe(document.body, { childList: true });
      } catch (e) { rec.observer = null; }
    }
    let view = null;
    try {
      await SfRender.loadExtra('tags-daoju.json');
      if (session !== rec || !host.isConnected) {
        if (rec.onStale) { try { rec.onStale(); } catch (e) {} }
        if (session === rec) destroy();
        return null;
      }
      view = await SfRender.mountSymbol(host, '4886', { frame: 1, label: '购买道具', blank: ['name', 'vipDes'] });
      if (session !== rec || !host.isConnected) {
        if (rec.onStale) { try { rec.onStale(); } catch (e) {} }
        try { view.destroy(); } catch (e) {}
        view = null;
        if (session === rec) destroy();
        return null;
      }
      rec.view = view;
      /* 用户 2026-10 口径：按钮外必须与背包详情（4886 f1）一致；f2 只借两颗按钮。 */
      mergeBuyFrame(view);
      fillBuy(view, id, base);
      const buy = clipOf(view, 'button2');
      const cancel = clipOf(view, 'button3');
      /* 用户口径：商店购买窗与背包使用窗一样，取消在左、购买在右。 */
      swapButtons(buy, cancel);
      const setReason = (text) => writeRemark(view, text == null ? '' : text);
      const draw = () => {
        if (!buy) return;
        const off = rec.stock <= 0;
        /* 售罄：把购买键从"点击路由"里摘掉（路由是按包围盒判归属的，只关
         * `pointer-events` 没用——鼠标扫过仍会派发 mouseenter 变绿）。
         * ⚠ 售罄时**不压透明度**：以前 `opacity:.65` 会把购买键整颗调浅，
         * 英雄帖/勇气徽章这类每天能买多件的商品买满后看着像"颜色不一样"。
         * 售罄只用路由注销 + 介绍文字说明，按钮颜色保持与取消键一致。 */
        const t = T();
        if (t && t.unregisterHit && t.registerHit) {
          if (off && !rec.buyUnregistered) {
            try { t.unregisterHit(buy); rec.buyUnregistered = true; } catch (e) {}
          } else if (!off && rec.buyUnregistered) {
            try { t.registerHit(buy, false); rec.buyUnregistered = false; } catch (e) {}
          }
        }
        if (buy.g) buy.g.style.opacity = '';
        if (off) {
          /* 路由一撤，mouseleave 不会再回来；把购买键拨回常态帧，
           * 否则点完最后一件时它会停在点击那一刻的悬停绿色。 */
          stopAt(buy, 1);
        }
        if (off && !rec.soldOutNoted) {
          rec.soldOutNoted = true;
          setReason('今日已经卖完了，明天再来。');
        } else if (!off && rec.soldOutNoted) {
          rec.soldOutNoted = false;
          setReason(base.remark || '');
        }
      };
      const handle = {
        close: () => closeSession(rec),
        sync: (next) => {
          if (next && Number.isFinite(Number(next.stock))) rec.stock = Math.max(0, Number(next.stock));
          draw();
        },
        setReason,
        element: host,
        get view() { return rec.view; },
        propId: id,
      };
      /* 购买键：4505 第 1 帧 = 4504（奶油灰 3150，与取消同画稿），第 2 帧才是绿色 3152。
       * 不再用第 3 帧深灰 + 换 fill 的旧做法。 */
      wireButton(buy, () => {
        if (rec.stock <= 0) return;
        let ok = false;
        try { ok = rec.onBuy ? rec.onBuy(1, handle) === true : false; } catch (e) {
          if (window.__errs) window.__errs.push('buy prop: ' + (e && e.message));
        }
        if (ok) closeSession(rec);
        else draw();
      }, 'buy', { idle: 1, hover: 2 });
      wireButton(cancel, () => closeSession(rec), 'cancel');
      draw();
      try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
      return handle;
    } catch (e) {
      if (window.__errs) window.__errs.push('buy prop: ' + (e && e.message));
      if (view) { try { view.destroy(); } catch (e2) {} }
      if (session === rec) destroy();
      return null;
    }
  }

  /** 把 4886 的长文本字段（vipDes）压成小字号、按框宽断行；原版字段只有一两行。 */
  function setWrappedField(clip, text, size, maxLines, dy, maxCols) {
    if (!clip) return;
    size = Number(size) || 10;
    const box = clip.__textBox && clip.__textBox.box;
    const width = box ? Math.max(40, box.xmax - box.xmin) : 223;
    const cap = Math.max(8, Number(maxCols) || 20);
    const per = Math.max(8, Math.min(cap, Math.floor(width / (size * 1.08))));
    const lines = [];
    for (const para of String(text == null ? '' : text).split(/\r\n|\r|\n/)) {
      const chars = Array.from(para);
      if (!chars.length) { lines.push(''); continue; }
      for (let i = 0; i < chars.length; i += per) lines.push(chars.slice(i, i + per).join(''));
    }
    const max = Math.max(1, Number(maxLines) || 2);
    if (lines.length > max) {
      lines.length = max;
      lines[max - 1] = Array.from(lines[max - 1]).slice(0, Math.max(1, per - 1)).join('') + '…';
    }
    if (!SfRender.setText(clip, lines.join('\n'))) return;
    const texts = Array.from((clip.g || clip).querySelectorAll('text'));
    const baseY = texts.length ? Number(texts[0].getAttribute('y')) || 0 : 0;
    texts.forEach((t, i) => {
      t.setAttribute('fill', '#000000');
      t.setAttribute('font-size', String(size));
      t.setAttribute('y', String(Math.round((baseY + (Number(dy) || 0) + i * size * 1.25) * 100) / 100));
    });
  }

  /** 不可使用道具的详情：仍用原版 4886 f1，但不显示「使用」，只留「取消/返回」。
   *  卷轴、挑战书、英雄帖、勇气徽章、抽奖卷等走这里；介绍写 vipDes，矢量图标同背包。 */
  function fillInfo(view, id, base) {
    setText(view, 'name', base.name);
    writeRemark(view, base.remark);
    const c1 = clipOf(view, 'c1');
    stopAt(c1, 2);
    paintIcon(c1, iconSrc(id));
    void paintVectorIcon(c1, id);
    hideClip(clipOf(view, 'button1'));       // 不可使用：不显示「使用」
  }

  async function openInfo(propId, opts) {
    opts = opts || {};
    const id = Number(propId);
    const base = propMap.getValue(id);
    if (!base) return null;
    destroy();
    const host = createHost('sf-prop-info-view');
    if (!host) return null;
    const rec = { host, propId: id, view: null, observer: null, mode: 'info', onClose: opts.onClose };
    session = rec;
    if (window.MutationObserver) {
      try {
        rec.observer = new MutationObserver(() => { if (!host.isConnected && !rec.closed) closeSession(rec); });
        if (host.parentNode) rec.observer.observe(host.parentNode, { childList: true });
        rec.observer.observe(document.body, { childList: true });
      } catch (e) { rec.observer = null; }
    }
    let view = null;
    try {
      await SfRender.loadExtra('tags-daoju.json');
      if (session !== rec || !host.isConnected) { if (session === rec) destroy(); return null; }
      view = await SfRender.mountSymbol(host, '4886', { frame: 1, label: '道具详情', blank: ['name', 'vipDes'] });
      if (session !== rec || !host.isConnected) {
        try { view.destroy(); } catch (e) {}
        if (session === rec) destroy();
        return null;
      }
      rec.view = view;
      fillInfo(view, id, base);
      const cancel = clipOf(view, 'button2');
      wireButton(cancel, () => closeSession(rec), 'cancel');
      centerClip(cancel, 160.275);
      const handle = {
        close: () => closeSession(rec),
        element: host,
        get view() { return rec.view; },
        propId: id,
      };
      try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
      return handle;
    } catch (e) {
      if (window.__errs) window.__errs.push('prop info: ' + (e && e.message));
      if (view) { try { view.destroy(); } catch (e2) {} }
      if (session === rec) destroy();
      return null;
    }
  }

  function sync(rec) {
    if (!rec || session !== rec || !rec.view) return;
    const base = propMap.getValue(rec.propId);
    if (!base) return;
    setText(rec.view, 'name', base.name);
    writeRemark(rec.view, base.remark);
  }

  /**
   * 打开「使用」弹窗。返回 handle（`{ close, sync, element, view, propId }`）；
   * 素材/挂载失败返回 null，调用方可以退回原 DOM 弹窗。
   * opts.onUse(handle) —— 玩家点「使用」（已换到右边）；
   * opts.onClose()    —— handle.close() 时回调。
   */
  async function open(propId, opts) {
    const id = Number(propId);
    const base = propMap.getValue(id);
    if (!base) return null;
    destroy();
    const host = createHost();
    if (!host) return null;
    const rec = {
      host: host, propId: id, view: null, observer: null,
      onUse: opts && opts.onUse, onClose: opts && opts.onClose, onCancel: opts && opts.onCancel,
    };
    session = rec;
    /* #ui 被整页换掉（切页 / 回首页 / 重开一局）时宿主会被直接摘掉，这里主动拆 view，
     * 别让 SfRender 的播放注册表留着一棵已经离开文档的子树。 */
    if (window.MutationObserver) {
      try {
        rec.observer = new MutationObserver(() => {
          if (!host.isConnected && !rec.closed) closeSession(rec);
        });
        /* 宿主是 #ui 的直接子节点：只盯 #ui 的直接子树变化，外加 body 一层防 #ui 整体被换；
         * 不用 subtree，避免页面里的 SVG 动画每帧都触发一遍。 */
        if (host.parentNode) rec.observer.observe(host.parentNode, { childList: true });
        rec.observer.observe(document.body, { childList: true });
      } catch (e) { rec.observer = null; }
    }
    let view = null;
    try {
      await SfRender.loadExtra('tags-daoju.json');
      if (session !== rec || !host.isConnected) {
        if (opts && opts.onStale) { try { opts.onStale(); } catch (e) {} }
        if (session === rec) destroy();
        return null;
      }
      view = await SfRender.mountSymbol(host, '4886', { frame: 1, label: '道具使用', blank: ['name', 'vipDes'] });
      if (session !== rec || !host.isConnected) {
        if (opts && opts.onStale) { try { opts.onStale(); } catch (e) {} }
        try { view.destroy(); } catch (e) {}
        view = null;
        if (session === rec) destroy();
        return null;
      }
      rec.view = view;
      fill(view, id);
      const use = clipOf(view, 'button1');
      const cancel = clipOf(view, 'button2');
      swapButtons(use, cancel);
      wireButton(use, () => { if (rec.onUse) rec.onUse(handle); }, 'use');
      wireButton(cancel, () => { closeSession(rec); if (rec.onCancel) rec.onCancel(); }, 'cancel');
      try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    } catch (e) {
      if (window.__errs) window.__errs.push('prop use: ' + (e && e.message));
      if (view) { try { view.destroy(); } catch (e2) {} }
      if (session === rec) destroy();
      return null;
    }
    const handle = {
      close: () => closeSession(rec),
      sync: () => sync(rec),
      element: host,
      get view() { return rec.view; },
      propId: id,
    };
    return handle;
  }

  window.SfPropUse = Object.freeze({
    open: open,
    openBuy: openBuy,
    openInfo: openInfo,
    close: close,
    destroy: destroy,
    active: () => !!session,
    /** 供回归/探针核对：使用/详情挂 f1；购买窗挂 f1 后并入 f2 的两颗按钮。 */
    frame: 1,
    buyFrame: 1,
    buyButtonsFrame: 2,
    symbol: '4886',
  });
})();
