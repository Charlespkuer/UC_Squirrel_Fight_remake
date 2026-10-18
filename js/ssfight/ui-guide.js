/* ============================================================================
 * ui-guide.js —— ssfight 新手引导（原版 3625，25 帧）
 *
 * 原版 `viewMission()`（MainMovie.as:6814）在根上挂 `新手引导`，然后按
 * `guideMap[nowPage].mcIndex` 切帧；每一帧是一张整屏提示：暗色说明条 +
 * 黄色手指 + 半透明目标按钮示意。这里沿用同一颗 25 帧素材，不另画引导框。
 *
 * 本批接线的是 1~7 帧：第一场战斗 → 自动战斗 → 升级奖励 → 新消息 →
 * 升到 3 级 → 体力消耗/点道具 → 体力药剂。和原版一样，底部按钮按等级解锁：
 * 2 级才有「消息」，3 级才全开（`constructMainMenu`），所以 f4/f6 都等对应等级
 * 到了再在首页出现；8~25 帧（竞技场/祭坛/幻兽/神迹/天梯/征战…）后续补。
 * ========================================================================== */
(function () {
  'use strict';
  const GUIDE_FILE = 'tags-guide.json';
  const SYMBOL = '3625';
  /* 帧号 = 原版 `mcIndex`；next = 当前帧播完后自动推进的 nowPage。 */
  const STEPS = {
    1: { frame: 1, ms: 0 },
    2: { frame: 2, ms: 2600, next: 3, stay: false },
    3: { frame: 3, ms: 4200, next: 4, stay: true },
    4: { frame: 4, ms: 4200, next: 5, stay: true },
    5: { frame: 5, ms: 4200, next: 6, stay: true },
    6: { frame: 6, ms: 4200, next: 7, stay: false },
    7: { frame: 7, ms: 4200, next: 99, stay: false },
  };
  let current = null;
  let generation = 0;

  function classic() {
    return !!(window.UI && UI.currentUiMode && UI.currentUiMode() === 'classic');
  }
  function state() {
    return window.State && State.state ? State.state() : null;
  }
  /** 新档 / 旧档的引导进度。旧档（>1 级）没有这个字段时直接视为已完成，
   *  不把老玩家拽回新手引导。 */
  function tutorial() {
    const S = state();
    if (!S) return null;
    if (!S.tutorial || typeof S.tutorial.step !== 'number') {
      S.tutorial = { step: Number(S.level) <= 1 ? 1 : 99 };
    }
    return S.tutorial;
  }
  function step() {
    const t = tutorial();
    return t ? t.step : 99;
  }
  function setStep(n) {
    const t = tutorial();
    if (!t) return;
    t.step = n;
    try { State.save(); } catch (e) {}
  }
  function err(e) {
    if (window.__errs) window.__errs.push('SfGuide: ' + (e && (e.stack || e.message) || e));
  }
  /* 原版每帧的「目标」是一颗预烘焙的**绿色高亮胶囊**（3589/3590/…），本应叠在
   * 真实按钮上做高亮。但转成 SVG 后它的绿色渐变 + 滤镜没有按原版还原，只剩半透明
   * 黑阴影 —— 用户看到的就是「按钮被蒙了一层黑」。这里把这颗高亮胶囊拿掉，改成
   * 原位置的**金色描边光环**；真实按钮保持原亮度，黄色手指仍指向它。 */
  const TARGET_ART = new Set(['3589', '3590', '3591', '3592', '3593', '3595', '3596', '3597', '3598', '3599']);
  function highlightTargets(view, stepNo) {
    if (!view || !view.g) return;
    const svg = view.g;
    let sr = null;
    try { sr = svg.getBoundingClientRect(); } catch (e) { sr = null; }
    const vb = svg.viewBox && svg.viewBox.baseVal;
    if (!sr || !vb || !sr.width || !sr.height) return;
    const nodes = [...svg.querySelectorAll('g[type="sprite"]')].filter((n) => TARGET_ART.has(String(n.getAttribute('sid'))));
    const rings = new Set();
    const toView = (r) => ({
      x: vb.x + (r.left - sr.left) / sr.width * vb.width,
      y: vb.y + (r.top - sr.top) / sr.height * vb.height,
      w: r.width / sr.width * vb.width,
      h: r.height / sr.height * vb.height,
    });
    const addRing = (r, before, dxScreen) => {
      const box = toView(r);
      if (dxScreen) box.x += dxScreen / sr.width * vb.width;
      const key = [Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h)].join(',');
      if (rings.has(key)) return;
      rings.add(key);
      const pad = Math.max(1.5, Math.min(4, box.h * 0.08));
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      ring.setAttribute('class', 'sf-guide-target');
      ring.setAttribute('x', (box.x - pad).toFixed(2));
      ring.setAttribute('y', (box.y - pad).toFixed(2));
      ring.setAttribute('width', (box.w + pad * 2).toFixed(2));
      ring.setAttribute('height', (box.h + pad * 2).toFixed(2));
      ring.setAttribute('rx', Math.max(2, Math.min(10, (box.h + pad * 2) / 2)).toFixed(2));
      ring.setAttribute('fill', 'rgba(255,237,120,.20)');
      ring.setAttribute('stroke', '#ffe45c');
      ring.setAttribute('stroke-width', '1.6');
      ring.setAttribute('pointer-events', 'none');
      (before && before.parentNode ? before.parentNode : svg).insertBefore(ring, before || null);
    };

    /* 背包里的 f7：目标不是 3625 里的固定胶囊，而是**真实的第一格道具**。
     * 用 DOM 里那颗 .item-icon 的屏幕框重画金环，并把黄色手指挪到道具中心
     * （原素材的手在 320×196 里是按主界面按钮摆的，直接套到背包会偏上/偏左）。 */
    if (stepNo === 7) {
      const page = document.querySelector('.classic-page[data-screen="bag"]');
      const icon = page && (page.querySelector('.catalog-cell[data-prop="1"] .item-icon') ||
        page.querySelector('.catalog-cell[data-prop="2"] .item-icon') ||
        page.querySelector('.catalog-cell[data-prop] .item-icon'));
      if (icon) {
        const ir = icon.getBoundingClientRect();
        const hand = svg.querySelector('g[type="sprite"][sid="3586"]');
        let before = null;
        if (hand) {
          const hr = hand.getBoundingClientRect();
          const dx = ((ir.left + ir.width / 2) - (hr.left + hr.width / 2)) / sr.width * vb.width;
          const dy = ((ir.top + ir.height / 2) - hr.bottom) / sr.height * vb.height;
          const old = hand.getAttribute('transform') || '';
          hand.setAttribute('transform', 'translate(' + dx.toFixed(2) + ',' + dy.toFixed(2) + ') ' + old);
          before = hand;
        }
        addRing(ir, before || nodes[0] || null, -16);
        for (const node of nodes) node.style.display = 'none';
        return;
      }
    }

    for (const node of nodes) {
      let r = null;
      try { r = node.getBoundingClientRect(); } catch (e) { r = null; }
      if (!r || !r.width || !r.height) continue;
      node.style.display = 'none';
      /* f3 的目标块在素材里只盖住按钮上沿，硬画一圈会显得错位；这一帧只把暗块拿掉，
       * 手指仍指向按钮。 */
      if (stepNo === 3) continue;
      addRing(r, node);
    }
  }

  function freeze(view) {
    try {
      if (window.SfUiMain && SfUiMain.toolkit && SfUiMain.toolkit.freezeDescendants) SfUiMain.toolkit.freezeDescendants(view);
    } catch (e) { err(e); }
    if (view) view.playing = false;
  }
  function hide() {
    generation++;
    if (!current) return;
    const old = current;
    current = null;
    clearTimeout(old.timer);
    try { if (old.view) old.view.destroy(); } catch (e) {}
    try { if (old.host && old.host.parentNode) old.host.parentNode.removeChild(old.host); } catch (e) {}
  }
  function samePage(ctx) {
    if (!ctx || ctx === 'battle') return true;
    if (!window.UI || !UI.currentScreen) return true;
    const now = UI.currentScreen();
    return ctx === 'home' ? (!now || now === 'home') : now === ctx;
  }
  function schedule(record, spec) {
    if (!spec.ms) return;
    const mine = record.seq;
    record.timer = setTimeout(() => {
      if (!current || current.seq !== mine) return;
      /* 页面已经被换掉 / 引导层已被清掉时不再硬推进，也不把下一帧盖到别人页面上。 */
      if (!current.host.isConnected || !samePage(record.ctx)) { hide(); return; }
      setStep(spec.next);
      if (spec.stay && step() === spec.next) show(spec.next, record.ctx);
      else hide();
    }, spec.ms);
  }
  function show(stepNo, ctx) {
    if (!classic()) { hide(); return; }
    const spec = STEPS[stepNo];
    if (!spec) { hide(); return; }
    if (!state() || step() !== stepNo) return;
    /* 原版底部键按等级解锁：2 级才出「消息」，3 级才全开（constructMainMenu）。
     * f4/f5 等 2 级，f6（指「道具」）等 3 级；等级没到就先藏，升级回首页再续。 */
    const level = Number(state().level) || 1;
    if (ctx === 'home' && ((stepNo === 4 || stepNo === 5) && level < 2)) { hide(); return; }
    if (ctx === 'home' && stepNo === 6 && level < 3) { hide(); return; }
    if (current && current.step === stepNo && current.ctx === ctx && current.host && current.host.isConnected) return;
    hide();
    const ui = document.getElementById('ui');
    if (!ui) return;
    const host = document.createElement('section');
    host.className = 'sf-guide-view' + (ctx === 'battle' ? ' battle' : '');
    host.setAttribute('aria-hidden', 'true');
    host.dataset.guideStep = String(stepNo);
    ui.appendChild(host);
    const seq = ++generation;
    current = { seq, host, view: null, timer: 0, step: stepNo, ctx };
    const mine = seq;
    Promise.resolve()
      .then(() => SfRender.load())
      .then(() => SfRender.loadExtra(GUIDE_FILE))
      .then(() => {
        if (!current || current.seq !== mine) return null;
        return SfRender.mountSymbol(host, SYMBOL, { frame: spec.frame, label: '新手引导' });
      })
      .then((view) => {
        if (!view) return;
        if (!current || current.seq !== mine) { try { view.destroy(); } catch (e) {} return; }
        current.view = view;
        freeze(view);
        highlightTargets(view, spec.frame);
        schedule(current, spec);
      })
      .catch((e) => { err(e); if (current && current.seq === mine) hide(); });
  }
  /** 首页：1 级先提示开战；战斗回来后自动串起 3/4/5。 */
  function onHome() {
    if (!classic()) { hide(); return; }
    const n = step();
    if (n === 1) { show(1, 'home'); return; }
    if (n === 2) { setStep(3); show(3, 'home'); return; }
    if (n === 3 || n === 4 || n === 5 || n === 6) { show(n, 'home'); return; }
    hide();
  }
  /** 战斗开始时只接第一场：f2「战斗会自动进行」，2.6 秒后推进到 f3。 */
  function onBattleStart() {
    if (!classic()) { hide(); return; }
    const n = step();
    if (n === 1) { setStep(2); show(2, 'battle'); return; }
    if (n === 2) { show(2, 'battle'); return; }
    hide();
  }
  /** 经典背包页的上下文提示（f7 体力药剂）。f4/f6 都在首页，等底部按钮按等级出现。 */
  function onPage(name) {
    if (!classic()) { hide(); return; }
    if (name === 'home') { onHome(); return; }
    const n = step();
    /* 点中下一处入口就算完成当前一步，不必等 4.2 秒计时：
     *   f3「升级奖励」→ 开始挑战；f4「新消息」→ 消息；f5「升到 3 级」→ 开始挑战；
     *   f6「试试道具」→ 道具（背包）。 */
    if (name === 'challenge' && n === 3) { setStep(4); hide(); return; }
    if (name === 'message' && n === 4) { setStep(5); hide(); return; }
    if (name === 'challenge' && n === 5) { setStep(6); hide(); return; }
    if (name === 'bag' && n === 6) { setStep(7); show(7, 'bag'); return; }
    if (name === 'bag' && n === 7) { show(7, 'bag'); return; }
    hide();
  }
  function skip() {
    const t = tutorial();
    if (t) { t.step = 99; try { State.save(); } catch (e) {} }
    hide();
  }
  window.SfGuide = Object.freeze({ onHome, onBattleStart, onPage, hide, skip, step: () => step() });
})();
