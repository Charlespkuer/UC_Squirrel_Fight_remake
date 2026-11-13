// 经典道具合成（碎片 / 种子 / 宝石 / 转化丸）：4886 f5 合成页 + 4402 过场/结果页。
// 数值全部走 State（composeGear / composeSeed / composeConvertPill / mergeGems），页面不复制规则。
(function () {
  'use strict';

  // 原版链路：showComposeWin(:21022) → 4886 f5（图标/名称/费用 + 合成/取消）；
  // 点合成 showCompose1(:16325) → 4402「合成中」，回包后 showCompose2(:16329) 停结果帧写
  // c1/t_name/t_temp/t_baseOther；宝石成功 gotoAndPlay(31)，失败 showTips。
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
  // 空闲回调：没有 requestIdleCallback（老 WebView）就退到 300 ms 后。
  const idle = (fn) => {
    try {
      if (typeof requestIdleCallback === 'function') { requestIdleCallback(fn, { timeout: 2500 }); return; }
    } catch (e) {}
    setTimeout(fn, 300);
  };
  // COMPOSE_CG_MS 是过场总时长；4402 若按舞台帧率 14 fps 播，44 帧要 3.1 秒。
  // 不能 setTimeout 后硬跳结果帧：playComposeCg 按总时长把 1→44 逐帧推完，
  // 慢设备也不会停在中途。
  const COMPOSE_CG_MS = 1400;
  // 结果帧（1 基）：fillResultPage 写这一帧，playCg:false 也直接挂它。
  const COMPOSE_RESULT_FRAME = 44;
  const cgStepMs = (frames) => Math.max(16, Math.round(COMPOSE_CG_MS / Math.max(1, frames - 1)));

  let session = null;

  /* 4402 与 4886 共用 tags-compose.json；destroy() 会 releaseExtra，这里不能再记「已加载」，
   * 否则第二次打开时 4402 已经不在 hash 里，合成与融合结果都会报错。SfRender 自己负责缓存。 */
  function loadComposeExtra() {
    return Promise.resolve(SfRender.loadExtra('tags-compose.json')).then(() => true).catch(() => false);
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
    if (window.SfRender && SfRender.releaseExtra) SfRender.releaseExtra('tags-compose.json');
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
  }

  // 会话还活着吗：宿主被整页清掉（#ui.innerHTML / 切页）时会只剩悬空 session，
  // active() 会一直报“开着”，之后还会对着不存在的节点写结果。
  function liveSession() {
    const rec = session;
    if (!rec) return null;
    if (rec.host && rec.host.isConnected) return rec;
    const stale = session;
    session = null;
    if (stale.resultView) { try { stale.resultView.destroy(); } catch (e) {} }
    if (stale.pageView) { try { stale.pageView.destroy(); } catch (e) {} }
    return null;
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
    const classic = window.UI && window.UI.classic;
    if (classic && typeof classic.iconSrc === 'function') return classic.iconSrc(kind, id);
    if (kind === 'gear') {
      if ([201, 202, 203, 204].includes(Number(id))) return 'images/ui/icons/gear/gear-' + Number(id) + '-classic.svg';
      return 'images/ui/icons/gear/gear-' + Number(id) + '.png';
    }
    if (classic && typeof classic.propIconSrc === 'function') return classic.propIconSrc(id);
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

  // 取消在左、合成在右（碎片/种子/宝石/转化丸共用这一页）。两颗按钮是不同元件
  // （4878 合成 / 4419 取消），画稿原点也不同，不能按 __baseMa 的 x 差平移；
  // 这里按屏幕包围盒中心互换，再用 屏幕矩形 ÷ 本地包围盒 折回局部单位。
  function swapComposeButtons(view) {
    const compose = clipOf(view, 'b_hc');
    const cancel = clipOf(view, 'b_back');
    if (!compose || !cancel || !compose.g || !cancel.g) return false;
    const cr = compose.g.getBoundingClientRect(), br = cancel.g.getBoundingClientRect();
    const cCenter = (cr.left + cr.right) / 2, bCenter = (br.left + br.right) / 2;
    const scaleOf = (clip) => {
      try {
        // 屏幕矩形 ÷ 本地包围盒 = 含祖先 CSS transform 的总比例。
        // iOS 15 的 getScreenCTM 漏掉祖先 scale（WebKit 209220），不能用 m.a 折回。
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

  // 道具说明按固定字数硬折（原版服务端会断好行）；装备结果不能走这里（基础属性带 (+10%)
  // 会被折开，第二行压到附加属性上），装备结果见 layoutResultFields。
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
      const extra = (State.extText ? (State.extText(r.gear.ext) || []) : []).filter(Boolean);
      // 基础属性不硬折（(+10%) 会被劈成两行）；附加属性每条一行。
      // 字号与行距由 layoutResultFields 按实际行数统一收。
      const temp = info ? ('基本属性:' + State.gearAttrText(info, { name: true })) : '';
      const extraText = extra.length ? '附加属性:' + extra[0] + (extra.length > 1 ? '\n' + extra.slice(1).join('\n') : '') : '';
      return { name: name, temp: temp, extra: extraText, icon: 'gear', id: r.gear.id, gear: r.gear, quality: quality };
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

  // 结果页两段文本（t_temp 基础属性 / t_baseOther 附加属性）共用同一字号：
  // 先按最宽字段缩到框内，再按各自行数与框高收一档，最后用 SfRender.layoutText
  // 重算基线/行距，避免第一条附加属性落回基础属性第二行的位置。
  function layoutResultFields(view, tempLines, extraLines) {
    const prep = (name, lines) => {
      const clip = clipOf(view, name);
      if (!clip || !clip.__textBox) return null;
      const b = clip.__textBox;
      const meta = b.meta || {};
      // 同一视图二次填充时先回素材字号：上一轮缩过的字号还留在 lines[0].h 里。
      b.lines[0].h = meta.fh || (b.lines[0] && b.lines[0].h) || 12;
      SfRender.setText(clip, lines.join('\n'));
      return clip;
    };
    const fields = [
      { clip: prep('t_temp', tempLines), lines: tempLines },
      { clip: prep('t_baseOther', extraLines), lines: extraLines },
    ].filter((f) => f.clip);
    if (!fields.length) return 0;
    let size = 12;
    for (const f of fields) {
      const b = f.clip.__textBox;
      const meta = b.meta || {};
      // ASCII 宽按 0.56 估会偏窄（Chrome 里 +30% 约 0.6em）；取 0.62 再留 3% 余量，防止末位 % 出框。
      const boxW = meta.bd ? (meta.bd[1] - meta.bd[0]) : 0;
      const fitOpts = { ascii: 0.62, min: 8 };
      if (boxW > 0) fitOpts.width = boxW * 0.97;
      const fit = SfRender.fitTextWidth ? SfRender.fitTextWidth(f.clip, fitOpts) : 0;
      if (fit > 0) size = Math.min(size, fit);
      // 纵向：末行基线不能越过字段框底（框高 = 原版给这一列留的行数）。
      const H = meta.bd ? (meta.bd[3] - meta.bd[2]) : 0;
      if (H > 0 && f.lines.length > 1) {
        const lead = meta.lead || 0;
        const byHeight = (H - 2 - lead * f.lines.length) / (0.88 + 1.15 * (f.lines.length - 1));
        if (byHeight > 0) size = Math.min(size, byHeight);
      }
    }
    size = Math.max(8, Math.floor(size * 10) / 10);
    for (const f of fields) {
      if (SfRender.layoutText) SfRender.layoutText(f.clip, { size: size });
    }
    return size;
  }

  function fillResultPage(view, result) {
    const c1 = clipOf(view, 'c1');
    stopAt(c1, 2);
    setText(view, 't_name', result.name);
    const tempLines = String(result.temp == null ? '' : result.temp).split(/\r\n|\r|\n/);
    const extraLines = String(result.extra == null ? '' : result.extra).split(/\r\n|\r|\n/);
    layoutResultFields(view, tempLines, extraLines);
    if (result.quality >= 0) setTextColor(view, 't_name', GEAR_QUALITY_COLOR[Math.max(0, Math.min(5, result.quality))]);
    // 装备结果按原版 showFusionResult() 挂 convertLink 的整张预上色卡（MainMovie.as:19024）；
    // 查不到符号（老包 / 缺品质）才退回 PNG。
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

  // 自己按 COMPOSE_CG_MS 把 4402 逐帧推到结果帧：gotoAndStop 后 playing=false，
  // 节拍器不插手。每帧核对会话身份，中途关页/换页立即停，不碰已销毁实例。
  async function playComposeCg(view, rec) {
    if (!view || !view.showFrame) return false;
    const total = Math.max(1, Math.min(COMPOSE_RESULT_FRAME, view.frames ? view.frames.length : COMPOSE_RESULT_FRAME));
    const step = cgStepMs(total);
    if (view.holdAnim) view.holdAnim(true);
    stopAt(view, 1);
    for (let f = 2; f <= total; f++) {
      await new Promise((r) => setTimeout(r, step));
      if (session !== rec || rec.resultView !== view || !view.g || !view.g.isConnected) return false;
      try { view.frame = f - 1; view.showFrame(); } catch (e) {}
    }
    if (session !== rec || rec.resultView !== view || !view.g || !view.g.isConnected) return false;
    stopAt(view, COMPOSE_RESULT_FRAME);
    if (view.holdAnim) view.holdAnim(false);
    return true;
  }

  async function playResult(rec, result) {
    const host = rec.host;
    if (!host || !host.isConnected) return;
    if (rec.pageView && rec.pageView.g) rec.pageView.g.style.display = 'none';
    const view = await SfRender.mountSymbol(host, '4402', { frame: 1, label: '合成中' });
    if (session !== rec || !host.isConnected) { try { view.destroy(); } catch (e) {} return; }
    rec.resultView = view;
    if (!(await playComposeCg(view, rec))) return;
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

  // opts.playCg 为真时先完整播一遍 4402（与道具合成同一段 CG）再停结果帧；
  // 否则只挂 f44。融合页的 3763「融合中」不要再叠加播放，避免两段过场串在一起。
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
        frame: playCg ? 1 : COMPOSE_RESULT_FRAME, label: playCg ? '合成中' : '融合结果',
      });
      if (session !== rec || !host.isConnected) { try { view.destroy(); } catch (e) {} return false; }
      rec.resultView = view;
      if (playCg) {
        if (!(await playComposeCg(view, rec))) return false;
      } else {
        stopAt(view, COMPOSE_RESULT_FRAME);
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
      swapComposeButtons(view);
      wirePage(view, rec);
      // 装备碎片（24/25/26/77/78）的结果页要 tags-gear-color.json（约 1.9 MB + 配色表），
      // 首次合成时才拉会卡在点完合成那一下；页面已出来，趁空闲预热，失败时结果页会再试。
      // 宝石 / 种子 / 转化丸不走这条，不预热。
      if ([24, 25, 26, 77, 78].includes(id)) {
        idle(() => { try { if (window.SfStatus && SfStatus.ensureGearColors) SfStatus.ensureGearColors(); } catch (e) {} });
      }
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
    // 只有宿主还在页面上才算开着：宿主被整页重建清掉后不能继续报 active，
    // 否则背包入口会以为合成页还开着而不再开新的。
    active: () => !!liveSession(),
    isComposeProp: isComposeProp,
  });
})();
