// 经典背包「道具使用」弹窗：挂原版「道具1」4886 第 1 帧，文字/图标写进原版字段。
// 原版 seeProp()（MainMovie.as:20852）对 useType==1 走 showUsePropWin(:20992)：
// loadMcs 后 daojuSub.gotoAndStop(1)，填 c1/name/vipDes，button1 使用、button2 取消。
// 素材包 tags-daoju.json（道具页 + 4886 闭包），只有真的打开弹窗才拉取。
(function () {
  'use strict';

  const T = () => (window.SfUiMain && SfUiMain.toolkit) || null;
  const clipOf = (host, name) => (host && host.byName ? host.byName(name) : null);
  const stopAt = (clip, frame) => {
    if (!clip || !clip.gotoAndStop) return;
    try { clip.gotoAndStop(frame); } catch (e) {}
  };
  const iconSrc = (id) => {
    const classic = window.UI && window.UI.classic;
    if (classic && typeof classic.propIconSrc === 'function') return classic.propIconSrc(id);
    return [79, 82, 90].includes(Number(id))
      ? 'images/ui/icons/prop/prop-' + Number(id) + '.svg'
      : 'images/ui/icons/prop/prop-' + Number(id) + '.png';
  };

  let session = null;

  function createHost(extra) {
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const host = document.createElement('section');
    // 宿主约定：ssfight-view 保住经典层，ssfight-sub 抬到二级页之上；
    // classic-home 的 pointer-events:none 由按钮自己覆盖。
    // 不要加 ssfight-home：main.js 的 fitCanvas 把它当 320×196 整页，一挂弹窗
    // 就会把 #ui 从 690 改成 716.625，底下的背包/商店背景跟着纵向拉伸、漂移。
    host.className = 'classic-home ssfight-sub ssfight-view sf-prop-use-view' + (extra ? ' ' + extra : '');
    host.setAttribute('aria-label', '道具使用');
    ui.appendChild(host);
    return host;
  }

  // 只拆这一份 session，不碰后来打开的那一份；异步/旧 handle 回来时尤其重要。
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

  // 把图标放进 c1（3414 第 2 帧的空图标位），做法与合成页一致。
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

  // 矢量图标对应原版 c1.attachMovie(<道具名>) 的库元件；prop-icons.json 由
  // gen-ssfight-ui.cjs daoju 从 SWF 导出 id→元件号，tags-daoju.json 含其闭包。
  // 先画 PNG 兜底，矢量挂上来后再删掉，素材缺失/慢加载时不会出现空图标。
  let propIconMapPromise = null;
  function propIconMap() {
    if (!propIconMapPromise) {
      propIconMapPromise = (window.SfRender && SfRender.loadTable
        ? SfRender.loadTable('prop-icons.json').catch(() => null)
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

  // 原版按钮的放置矩阵形如 (0.927963,0,0,0.927963,x,y)，从 __baseMa 解析。
  function baseMatrix(clip) {
    const raw = clip && clip.g && clip.g.__baseMa;
    if (typeof raw !== 'string') return null;
    const p = raw.split(',').map(Number);
    return p.length === 6 && p.every((v) => Number.isFinite(v)) ? p : null;
  }

  // 兜底：拿不到几何时只把两颗按钮的 x 平移到对方原位，y / 缩放不变。
  function swapButtons(use, cancel) {
    const a = baseMatrix(use), b = baseMatrix(cancel);
    if (!a || !b) return;
    const dx = b[4] - a[4];
    const sa = Math.abs(a[0]) || 1, sb = Math.abs(b[0]) || 1;
    if (use.setExtraTransform) use.setExtraTransform('translate(' + (dx / sa).toFixed(3) + ',0)');
    if (cancel.setExtraTransform) cancel.setExtraTransform('translate(' + (-dx / sb).toFixed(3) + ',0)');
  }

  // 取消在左、使用/购买在右，围绕弹窗中心对称；用 screenCTM 把目标中心换回设计单位，
  // 所以 720p 手机和桌面缩放都一致。拿不到几何时退回 swapButtons。
  const BUTTON_USE_SCALE = 1.03;   // 背包「使用」键放大到商店窗两颗按钮的视觉大小
  const BUTTON_GAP_RATIO = 0.45;   // 间距 = 按钮宽度的 45%
  function layoutActionButtons(view, right, cancel, mode) {
    if (!right || !cancel || !right.g || !cancel.g || !right.setExtraTransform) return false;
    const svg = right.g.ownerSVGElement || view.g.ownerSVGElement;
    const vb = svg && svg.viewBox && svg.viewBox.baseVal;
    const centerX = vb && vb.width ? vb.x + vb.width / 2 : 160;
    const ctm = svg && svg.getScreenCTM ? svg.getScreenCTM() : null;
    if (!ctm || !(Math.abs(ctm.a) > 1e-6)) { swapButtons(right, cancel); return false; }
    const scaleX = Math.abs(ctm.a);
    const offsetX = ctm.e;
    const midPx = offsetX + centerX * scaleX;
    const place = (clip, isRight) => {
      const m = baseMatrix(clip);
      if (!m) return false;
      const s = Math.abs(m[0]) || 1;
      const k = mode === 'use' ? BUTTON_USE_SCALE / s : 1;
      clip.setExtraTransform('scale(' + k.toFixed(5) + ')');
      const r0 = clip.g.getBoundingClientRect();
      if (!r0.width) return false;
      const gap = r0.width * BUTTON_GAP_RATIO;
      const targetPx = isRight
        ? midPx + gap / 2 + r0.width / 2
        : midPx - gap / 2 - r0.width / 2;
      const tx = ((targetPx - (r0.left + r0.width / 2)) / scaleX) / s;
      clip.setExtraTransform('translate(' + tx.toFixed(3) + ',0) scale(' + k.toFixed(5) + ')');
      return true;
    };
    const okA = place(cancel, false), okB = place(right, true);
    if (!okA || !okB) { swapButtons(right, cancel); return false; }
    return true;
  }

  // 商店购买窗：4886 f1 版式，只并入 f2 的 d22 购买(4505) / d26 取消(4419)；
  // f2 的数量条、左右箭头、UC 会员提示都不进合并帧。
  // f1 自带的 d9 使用 / d13 取消必须删掉，否则会和并入的两颗叠在一起。
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
    // TRAP: 帧数组被整体替换后必须强制重建显示列表：showFrame() 对“同帧重复调用”
    // 会直接返回；不重置 __shownFrame，合并进来的购买/取消永远不会出现。
    view.__shownFrame = -1;
    view.showFrame();
    return true;
  }

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
  // 默认第 1 帧常态、第 2 帧悬停；opts.idle / opts.hover 可覆盖（合成页也复用）。
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
      // 点完指针仍停在按钮上：保持悬停色，真正移开时 mouseleave 再回常态。
      stopAt(clip, hover);
      onFire();
    });
  }

  // 说明排版三处弹窗共用（10px、最多两行、黑色，行高沿用素材烘焙值）；
  // 改这里会同时影响使用 / 详情 / 购买窗。
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

  // onBuy 返回 true 表示买完关窗，返回 false 则保留（多件限购继续买）。
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
      mergeBuyFrame(view);
      fillBuy(view, id, base);
      const buy = clipOf(view, 'button2');
      const cancel = clipOf(view, 'button3');
      layoutActionButtons(view, buy, cancel, 'buy');
      const setReason = (text) => writeRemark(view, text == null ? '' : text);
      const draw = () => {
        if (!buy) return;
        const off = rec.stock <= 0;
        // 点击路由按包围盒判归属：只关 pointer-events 没用，鼠标扫过仍会变绿，
        // 所以售罄必须 unregisterHit；也不压透明度，按钮颜色保持与取消键一致。
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
          // 路由一撤 mouseleave 不会再回来；停止售卖时把购买键拨回常态帧，
          // 否则点完最后一件时它会停在悬停绿色。
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
      // 4505 f1 = 4504 奶油灰(3150)，f2 = 绿色(3152)；常态用 f1、悬停用 f2。
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

  // 4886 的 vipDes 原版只有一两行：按 __textBox 框宽断行，最多两行，超出截断。
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

  // 不可使用道具的详情复用 4886 f1，只留「取消/返回」；卷轴、挑战书、英雄帖、勇气徽章、
  // 抽奖卷等走这里，介绍写 vipDes，矢量图标同背包。
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

  // 返回 handle { close, sync, element, view, propId }；opts.onUse(handle) / onClose()。
  // 素材/挂载失败返回 null；调用方可以退回原 DOM 弹窗。
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
    // #ui 被整页换掉（切页 / 回首页 / 重开）时宿主会被直接摘掉；主动拆 view，
    // 别让 SfRender 的播放注册表留着已经离开文档的子树。
    if (window.MutationObserver) {
      try {
        rec.observer = new MutationObserver(() => {
          if (!host.isConnected && !rec.closed) closeSession(rec);
        });
        // 宿主是 #ui 的直接子节点：只盯直接子树 + body 一层防 #ui 整体被换；
        // 不用 subtree，避免页面里的 SVG 动画每帧都触发一遍。
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
      layoutActionButtons(view, use, cancel, 'use');
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
    // 供回归/探针核对：使用/详情挂 f1；购买窗挂 f1 后并入 f2 的两颗按钮。
    frame: 1,
    buyFrame: 1,
    buyButtonsFrame: 2,
    symbol: '4886',
  });
})();
