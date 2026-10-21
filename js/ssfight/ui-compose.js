/* ============================================================
 * ui-compose.js — 经典模式的道具合成（碎片 / 种子 / 宝石 / 转化丸）
 * ------------------------------------------------------------
 * 原版链路：
 *   `showComposeWin(prop)`（MainMovie.as:21022）→ `loadMcs([["道具1","daojuSub"]])`
 *     并把 `daojuSub.gotoAndStop(5)`：道具图标 + 名称 + 费用 + 「合成 / 取消」。
 *   点合成 → `showCompose1()`（:16325）`loadMcs([["合成中","compose"]])`（库元件 4402）→
 *     服务端回包 → `showCompose2()`（:16329）把 4402 停在结果帧，写 `c1` / `t_name` /
 *     `t_temp` / `t_baseOther`，宝石成功走 `gotoAndPlay(31)`，失败走 `showTips`。
 * 复刻把数值交给 State（composeGear / composeSeed / composeConvertPill / mergeGems），
 * 这里只负责原版 4886 f5 的合成页、4402 的过场与结果页。
 * ========================================================== */
(function () {
  'use strict';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = () => (window.SfUiMain && SfUiMain.toolkit) || null;
  const C = () => (window.UI && UI.classic) || null;
  const clipOf = (host, name) => (host && host.byName ? host.byName(name) : null);
  const stopAt = (clip, frame) => {
    if (!clip || !clip.gotoAndStop) return;
    try { clip.gotoAndStop(frame); } catch (e) {}
  };
  const GEAR_QUALITY_COLOR = ['#542201', '#65a844', '#2365c9', '#6544a8', '#ff9900', '#000000'];
  /** 4402「合成中」播到结果帧的时长；道具合成与装备融合共用同一段 CG。 */
  const COMPOSE_CG_MS = 1400;

  let session = null;
  let composeExtraLoaded = false;

  function loadComposeExtra() {
    if (composeExtraLoaded) return Promise.resolve(true);
    return Promise.resolve(SfRender.loadExtra('tags-compose.json')).then(() => {
      composeExtraLoaded = true;
      return true;
    }).catch(() => false);
  }

  function createHost() {
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const host = document.createElement('section');
    host.className = 'classic-home ssfight-sub ssfight-view sf-compose-view';
    host.setAttribute('aria-label', '道具合成');
    ui.appendChild(host);
    return host;
  }

  function destroy() {
    const rec = session;
    session = null;
    if (!rec) return;
    if (rec.resultView) { try { rec.resultView.destroy(); } catch (e) {} }
    if (rec.pageView) { try { rec.pageView.destroy(); } catch (e) {} }
    if (rec.host && rec.host.parentNode) rec.host.parentNode.removeChild(rec.host);
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
  }

  function close() {
    const rec = session;
    destroy();
    if (rec && typeof rec.onClose === 'function') { try { rec.onClose(); } catch (e) {} }
  }

  function setText(view, name, value) {
    const clip = clipOf(view, name);
    if (clip) SfRender.setText(clip, String(value == null ? '' : value));
  }

  function setTextColor(view, name, color) {
    const clip = clipOf(view, name);
    const g = clip && (clip.g || clip);
    if (!g || !g.querySelectorAll) return;
    for (const t of g.querySelectorAll('text')) t.setAttribute('fill', color);
  }

  /** 把 PNG 图标放到原版 c1 的图标位里（居中，随 c1 的框大小缩放）。 */
  function paintIcon(clip, src) {
    if (!clip || !clip.g || !src) return;
    const host = clip.getContentHost ? clip.getContentHost() : clip.g;
    if (!host) return;
    for (const old of host.querySelectorAll('image.sf-compose-icon')) old.remove();
    let box = { x: 0, y: 0, width: 44, height: 44 };
    try { if (clip.g.getBBox) box = clip.g.getBBox(); } catch (e) {}
    const base = Math.min(Math.max(24, Number(box.width) || 44), Math.max(24, Number(box.height) || 44));
    const size = Math.round(base * 0.86);
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('class', 'sf-compose-icon');
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

  function wireButton(clip, onFire, opts) {
    if (!clip || !clip.g) return;
    const o = opts || {};
    const idle = o.idle == null ? 1 : o.idle;
    const hover = o.hover == null ? 2 : o.hover;
    const press = o.press == null ? 1 : o.press;
    const t = T();
    clip.g.style.cursor = 'pointer';
    clip.g.style.pointerEvents = 'auto';
    stopAt(clip, idle);
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
      stopAt(clip, press);
      onFire();
    });
  }

  function isComposeProp(id) {
    return [24, 25, 26, 45, 46, 77, 78].includes(id) || id === (window.GData && GData.CONVERT_SHARD_ID) || !!(window.State && State.gemLevel(id));
  }

  function costText(id) {
    const lv = State.gemLevel(id);
    if (lv) {
      return '合成成功率:' + Math.round(State.gemMergeRate(lv) * 100) + '%\n合成费用:10金松果\n合成条件:\n3个同级宝石';
    }
    const base = propMap.getValue(id);
    const isFragment = [24, 25, 26, 77, 78].includes(id);
    const gold = isFragment ? (State.gearCostOf ? State.gearCostOf({ 24: 0, 25: 1, 26: 2, 77: 5, 78: 5 }[id]) : 50) : 50;
    return '每次合成消耗\n' + gold + '个金松果。\n合成条件:\n10个' + (base ? base.name : '材料');
  }

  function iconSrc(kind, id) {
    if (kind === 'gear') return 'images/ui/icons/gear/gear-' + Number(id) + '.png';
    return 'images/ui/icons/prop/prop-' + Number(id) + '.png';
  }

  function fillPage(view, id) {
    const base = propMap.getValue(id);
    if (!base) return;
    setText(view, 'name', base.name);
    setText(view, 'cost', costText(id));
    const c1 = clipOf(view, 'c1');
    stopAt(c1, 2);
    paintIcon(c1, iconSrc('prop', id));
  }

  /** 用户 2026-10 口径：合成页的「合成 / 取消」左右对调，取消在左、合成在右。
   *  ⚠ 两颗按钮是**不同元件**（4878 合成 / 4419 取消），画稿原点也不一样，
   *  不能像使用窗那样只按 `__baseMa` 的 x 差平移（实测会叠在一起）。
   *  这里按**屏幕包围盒中心**互换，再用各自的「屏幕矩形 ÷ 本地包围盒」折回局部单位
   *  （不用 getScreenCTM：iOS 15 会漏掉祖先 CSS transform 的 scale，WebKit 209220）。 */
  function swapComposeButtons(view) {
    const compose = clipOf(view, 'b_hc');
    const cancel = clipOf(view, 'b_back');
    if (!compose || !cancel || !compose.g || !cancel.g) return false;
    const cr = compose.g.getBoundingClientRect(), br = cancel.g.getBoundingClientRect();
    const cCenter = (cr.left + cr.right) / 2, bCenter = (br.left + br.right) / 2;
    const scaleOf = (clip) => {
      try {
        /* 屏幕矩形 ÷ 本地包围盒 = 含所有祖先 CSS transform 的总比例。
         * iOS 15 的 getScreenCTM 漏掉祖先 scale（WebKit 209220），不能再拿 m.a 折回。 */
        const rr = clip.g.getBoundingClientRect();
        const bb = clip.g.getBBox();
        const s = bb && bb.width ? rr.width / bb.width : (bb && bb.height ? rr.height / bb.height : 0);
        return s > 1e-6 ? s : 1;
      } catch (e) { return 1; }
    };
    const dxC = (bCenter - cCenter) / scaleOf(compose);
    const dxB = (cCenter - bCenter) / scaleOf(cancel);
    if (compose.setExtraTransform) compose.setExtraTransform('translate(' + dxC.toFixed(3) + ',0)');
    if (cancel.setExtraTransform) cancel.setExtraTransform('translate(' + dxB.toFixed(3) + ',0)');
    return true;
  }

  function wirePage(view, rec) {
    wireButton(clipOf(view, 'b_hc'), () => {
      if (rec.busy) return;
      rec.busy = true;
      runCompose(rec).catch((e) => {
        if (window.__errs) window.__errs.push('compose: ' + (e && e.message));
        rec.busy = false;
        showFailure('合成界面出错，请稍后再试。');
      });
    }, { idle: 1, hover: 2, press: 1 });
    wireButton(clipOf(view, 'b_back'), close, { idle: 1, hover: 2, press: 1 });
  }

  function composeAction(id) {
    if ([24, 25, 26, 77, 78].includes(id)) return State.composeGear(id);
    if ([45, 46].includes(id)) return State.composeSeed(id);
    if (id === (window.GData && GData.CONVERT_SHARD_ID)) return State.composeConvertPill();
    if (State.gemLevel(id)) return State.mergeGems(id);
    return { ok: false, msg: '这个道具不能合成' };
  }

  /** `t_temp` / `t_baseOther` 的框宽只放得下约 11 个全角字；原版服务端会断好行，
   *  复刻自己断，避免长描述横向裁掉。 */
  function wrapText(value, cols) {
    const s = String(value == null ? '' : value);
    const width = Math.max(4, cols || 11);
    const out = [];
    for (const para of s.split('\n')) {
      if (!para) { out.push(''); continue; }
      for (let i = 0; i < para.length; i += width) out.push(para.slice(i, i + width));
    }
    return out.join('\n');
  }

  function resultOf(r, id) {
    const kind = State.gemLevel(id) ? 'gem' : 'prop';
    if (r.gear) {
      const info = State.gearInst ? State.gearInst(r.gear.id, r.gear.ext, r.gear.attr) : null;
      const name = (window.UI && UI.classic && UI.classic.gearName)
        ? UI.classic.gearName(Number(r.gear.id)) : ((info && info.name) || '装备');
      const quality = State.gearQuality ? State.gearQuality(r.gear) : ((info && info.quality) || 0);
      const extra = State.extText ? (State.extText(r.gear.ext) || []) : [];
      const temp = info ? ('基本属性:' + (info.attrName || '') + '+' + Math.max(0, Math.round(Number(info.abilityVal) || 0))) : '';
      return { name: name, temp: wrapText(temp), extra: extra.length ? wrapText('附加属性:' + extra.join(' / ')) : '', icon: 'gear', id: r.gear.id, gear: r.gear, quality: quality };
    }
    if (kind === 'gem') {
      const gid = id + 1;
      const def = propMap.getValue(gid);
      return { name: def ? def.name : '宝石', temp: '橙色装备可镶嵌宝石。\n宝石等级越高，功效越好！', extra: '', icon: 'prop', id: gid, quality: -1 };
    }
    if (r.propId) {
      const def = propMap.getValue(r.propId);
      return { name: (def && def.name) || r.name || '道具', temp: wrapText((def && def.remark) || ''), extra: '', icon: 'prop', id: r.propId, quality: -1 };
    }
    if (r.prop) {
      const def = propMap.getValue(r.prop);
      return { name: (def && def.name) || r.name || '道具', temp: wrapText((def && def.remark) || ''), extra: '', icon: 'prop', id: r.prop, quality: -1 };
    }
    return { name: '合成成功', temp: '', extra: '', icon: '', id: 0, quality: -1 };
  }

  function fillResultPage(view, result) {
    const c1 = clipOf(view, 'c1');
    stopAt(c1, 2);
    setText(view, 't_name', result.name);
    setText(view, 't_temp', result.temp);
    setText(view, 't_baseOther', result.extra);
    if (result.quality >= 0) setTextColor(view, 't_name', GEAR_QUALITY_COLOR[Math.max(0, Math.min(5, result.quality))]);
    /* 装备结果按原版 `showFusionResult()` 挂 `convertLink` 的**整张预上色卡**
     * （MainMovie.as:19024）；查不到符号（老包 / 缺品质）才退回原来的 PNG。 */
    let painted = false;
    if (result.icon === 'gear' && result.gear && window.SfStatus && SfStatus.paintGearCard) {
      painted = !!SfStatus.paintGearCard(c1, result.gear);
    }
    if (!painted && result.icon) paintIcon(c1, iconSrc(result.icon, result.id));
    for (const n of ['button2', 'button3']) {
      const b = clipOf(view, n);
      if (b && b.g) b.g.style.display = 'none';
    }
    const ok = clipOf(view, 'button1');
    if (ok && ok.g) ok.g.style.display = '';
    wireButton(ok, close, { idle: 2, hover: 2, press: 1 });
  }

  async function playResult(rec, result) {
    const host = rec.host;
    if (!host || !host.isConnected) return;
    if (rec.pageView && rec.pageView.g) rec.pageView.g.style.display = 'none';
    const view = await SfRender.mountSymbol(host, '4402', { frame: 1, label: '合成中' });
    if (session !== rec || !host.isConnected) { try { view.destroy(); } catch (e) {} return; }
    rec.resultView = view;
    try { view.gotoAndPlay(1); } catch (e) {}
    await new Promise((r) => setTimeout(r, COMPOSE_CG_MS));
    if (session !== rec || rec.resultView !== view) return;
    try { view.gotoAndStop(44); } catch (e) {}
    if (result.icon === 'gear' && window.SfStatus && SfStatus.ensureGearColors) {
      try { await SfStatus.ensureGearColors(); } catch (e) {}
    }
    fillResultPage(view, result);
  }

  async function playFailure(rec, msg) {
    const host = rec.host;
    if (host && host.isConnected) {
      if (rec.pageView && rec.pageView.g) rec.pageView.g.style.display = 'none';
      try {
        const view = await SfRender.mountSymbol(host, '4402', { frame: 1, label: '合成中' });
        if (session === rec && host.isConnected) {
          rec.resultView = view;
          try { view.gotoAndPlay(1); } catch (e) {}
          await new Promise((r) => setTimeout(r, 900));
        }
      } catch (e) {}
    }
    if (session === rec) { destroy(); showFailure(msg); }
  }

  function showFailure(msg) {
    const c = C();
    if (c && c.modal) {
      c.modal('合成失败', '<div class="extra-result"><p>' + esc(msg || '合成失败') + '</p></div>',
        [{ label: '知道了', cls: 'gold' }], { small: true });
      return;
    }
    if (window.UI && UI.toast) UI.toast(msg || '合成失败');
  }

  async function runCompose(rec) {
    const r = composeAction(rec.propId);
    if (!r || r.ok === false) {
      rec.busy = false;
      destroy();
      showFailure((r && r.msg) || '合成失败');
      return;
    }
    if (r.success === false) {
      await playFailure(rec, r.msg || '合成失败');
      return;
    }
    await playResult(rec, resultOf(r, rec.propId));
  }

  /** 装备融合结果。
   *  `opts.playCg` = 先完整播一遍 4402「合成中」（与道具合成同一颗 CG），再停在结果帧；
   *  不传则只挂 f44（旧行为，保留给不需要过场的调用方）。
   *  融合页的 3763「融合中」不再叠加播放，避免两段过场串在一起。 */
  async function showGearResult(gear, opts) {
    if (!gear) return false;
    destroy();
    const host = createHost();
    if (!host) return false;
    const rec = { host: host, propId: 0, pageView: null, resultView: null, busy: true,
      onClose: opts && opts.onClose };
    session = rec;
    const playCg = !!(opts && opts.playCg);
    try {
      await SfRender.loadExtra('tags-status.json');
      const extra = await loadComposeExtra();
      if (!extra) throw new Error('tags-compose.json');
      if (session !== rec || !host.isConnected) return false;
      const view = await SfRender.mountSymbol(host, '4402', {
        frame: playCg ? 1 : 44, label: playCg ? '合成中' : '融合结果',
      });
      if (session !== rec || !host.isConnected) { try { view.destroy(); } catch (e) {} return false; }
      rec.resultView = view;
      if (playCg) {
        try { view.gotoAndPlay(1); } catch (e) {}
        await new Promise((r) => setTimeout(r, COMPOSE_CG_MS));
        if (session !== rec || rec.resultView !== view || !host.isConnected) return false;
        try { view.gotoAndStop(44); } catch (e) {}
      } else {
        try { view.gotoAndStop(44); } catch (e) {}
      }
      if (window.SfStatus && SfStatus.ensureGearColors) {
        try { await SfStatus.ensureGearColors(); } catch (e) {}
      }
      fillResultPage(view, resultOf({ gear: gear }, 0));
      try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
      return true;
    } catch (e) {
      if (window.__errs) window.__errs.push('compose gear result: ' + (e && e.message));
      destroy();
      showFailure('融合结果界面加载失败，请稍后再试。');
      return false;
    }
  }

  async function open(propId, opts) {
    const id = Number(propId);
    if (!propMap.getValue(id) || !isComposeProp(id)) return false;
    destroy();
    const host = createHost();
    if (!host) return false;
    const rec = { host: host, propId: id, pageView: null, resultView: null, busy: false,
      onClose: opts && opts.onClose };
    session = rec;
    try {
      await SfRender.loadExtra('tags-status.json');
      const extra = await loadComposeExtra();
      if (!extra) throw new Error('tags-compose.json');
      if (session !== rec || !host.isConnected) return false;
      const view = await SfRender.mountSymbol(host, '4886', { frame: 5, label: '道具合成' });
      if (session !== rec || !host.isConnected) { try { view.destroy(); } catch (e) {} return false; }
      rec.pageView = view;
      fillPage(view, id);
      /* 取消在左、合成在右（用户 2026-10 口径；碎片/种子/宝石/转化丸共用这一页）。 */
      swapComposeButtons(view);
      wirePage(view, rec);
      try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
      return true;
    } catch (e) {
      if (window.__errs) window.__errs.push('compose open: ' + (e && e.message));
      destroy();
      showFailure('合成界面加载失败，请稍后再试。');
      return false;
    }
  }

  window.SfCompose = Object.freeze({
    open: open,
    showGearResult: showGearResult,
    close: close,
    destroy: destroy,
    active: () => !!session,
    isComposeProp: isComposeProp,
  });
})();
