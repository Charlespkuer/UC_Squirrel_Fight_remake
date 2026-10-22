/* ============================================================================
 * ui-guide.js —— ssfight 新手引导（原版 3625，25 帧）
 *
 * 原版 `viewMission()`（MainMovie.as:6814）在根上挂 `新手引导`，然后按
 * `guideMap[nowPage].mcIndex` 切帧；每一帧是一张整屏提示：暗色说明条 +
 * 黄色手指 + 半透明目标按钮示意。这里沿用同一颗 25 帧素材，不另画引导框。
 *
 * 步骤号 = 原版 `nowPage`（guideMap 的键，:19411），frame = 3625 的帧（=`mcIndex`）。
 * 时间与下一跳照 guideMap / viewMission：
 *   · 页 2 帧 2.6 秒、页 12 3 秒、页 21/23/24/25 4 秒后自动 doMission；
 *   · 页 7/8/9/10 由玩家的真实动作推进（开道具详情 → 点「使用」→ 点提示「确定」→
 *     点背包「返回菜单」），见 doMission(7..10) 与 useProp 成功里的 viewNextMission；
 *   · 页 11 指首页「开始挑战」，点开挑战页进 12，f12 在原版就是 3 秒自动收尾（next -1）；
 *   · 页 13 是 5 级白装：原版 showLevelUp 里 `nowPage=13` + viewMission，f13 盖在**升级页**
 *     的「确定」上（:7160）；点掉进 14（首页「状态」）→ 15（状态页两个页签）→ 22
 *     （guideMap 15→22，f22 =「赠送你一件白色装备，快去『状态』里找到并穿上它」，
 *     specailState=1：下次点击就 doMission，:21721）；
 *   · 页 17/19/20/26 在村庄页，点对应地点推进（HOME_LAND :9529-9622），
 *     20（神迹）点完先记着，回家时原版置 nowPage=25 → f24（天梯）4 秒自动收；
 *   · 页 21/23（帧 16）/24（帧 23）都是纯文字帧：4 级 / 10 级 / 15 级，4 秒自动收。
 * 原版页 16/18 没有任何触发点（guideMap 里孤立）；f16 是竞技场文案，已经在 10 级
 * step23 复用；f18 是 23 级「酒馆/pub」文案，本复刻没有酒馆界面，不接这一帧。
 * ========================================================================== */
(function () {
  'use strict';
  const GUIDE_FILE = 'tags-guide.json';
  const SYMBOL = '3625';
  /* next = 当前帧播完后自动推进的 nowPage（99 = 收工）。 */
  const STEPS = {
    1: { frame: 1, ms: 0 },
    2: { frame: 2, ms: 2600, next: 3, stay: false },
    3: { frame: 3, ms: 4200, next: 4, stay: true },
    4: { frame: 4, ms: 4200, next: 5, stay: true },
    5: { frame: 5, ms: 4200, next: 6, stay: true },
    6: { frame: 6, ms: 4200, next: 7, stay: false },
    7: { frame: 7, ms: 0 },                          // 等玩家在第一格道具上点开详情（seeProp）
    8: { frame: 8, ms: 0, above: true },             // 道具详情弹窗「使用」
    9: { frame: 9, ms: 0, above: true },             // 「使用X成功。」提示弹窗「确定」
    10: { frame: 10, ms: 0 },                        // 背包「返回菜单」→ 回主界面
    11: { frame: 11, ms: 4200, next: 12, stay: false },  // 首页「开始挑战」
    12: { frame: 12, ms: 3000, next: 99 },           // 挑战页，原版 3 秒自动收
    13: { frame: 13, ms: 0, above: true },           // 升级页「确定」（5 级白装）
    14: { frame: 14, ms: 4200, next: 15, stay: false },  // 首页「状态」
    15: { frame: 15, ms: 0 },                        // 状态页两个页签
    17: { frame: 17, ms: 0 },                        // 村庄「祭坛」
    19: { frame: 19, ms: 0 },                        // 村庄「幻兽」
    20: { frame: 20, ms: 0 },                        // 村庄「神迹」
    21: { frame: 21, ms: 4000, next: 99 },           // 4 级纯文字
    22: { frame: 22, ms: 0, clickDismiss: true },    // 状态页：去穿上白装（下次点击收起）
    23: { frame: 16, ms: 4000, next: 99 },           // 10 级纯文字（guideMap 23 → mcIndex 16）
    24: { frame: 23, ms: 4000, next: 99 },           // 15 级纯文字
    25: { frame: 24, ms: 4000, next: 99 },           // 神迹回来：天梯
    26: { frame: 25, ms: 0 },                        // 村庄「征战」
  };
  /* 原版等级事件（showLevelUp / showLevelupTips，:7160-7300）→ 步骤号。 */
  const LEVEL_STEPS = { 4: 21, 5: 13, 10: 23, 15: 24, 20: 17, 25: 19, 30: 20, 35: 26 };
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
  function escText(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /* 原版每帧的「目标」是一颗预烘焙的**绿色高亮胶囊**（3589/3590/…），本应叠在
   * 真实按钮上做高亮。但转成 SVG 后它的绿色渐变 + 滤镜没有按原版还原，只剩半透明
   * 黑阴影 —— 用户看到的就是「按钮被蒙了一层黑」。这里把这颗高亮胶囊拿掉，改成
   * 跟原位置的**金色描边光环**；真实按钮保持原亮度，黄色手指仍指向它。
   * 3602/3609 是 f10（背包「返回菜单」）与 f15（状态页页签）的同类胶囊，一并拿掉。 */
  const TARGET_ART = new Set(['3589', '3590', '3591', '3592', '3593', '3595', '3596', '3597', '3598', '3599', '3602', '3609']);
  /* 这几步的目标是弹窗/页脚里的**真实 DOM 按钮**，不是素材里预烘焙的位置：
   * 手与金环都移到真按钮上。 */
  const DOM_TARGETS = {
    7: () => {
      const page = document.querySelector('.classic-page[data-screen="bag"]');
      return page && (page.querySelector('.catalog-cell[data-prop="1"] .item-icon') ||
        page.querySelector('.catalog-cell[data-prop="2"] .item-icon') ||
        page.querySelector('.catalog-cell[data-prop] .item-icon'));
    },
    /* 8：经典背包已换成原版 4886 f1 弹窗，金环贴在那颗「使用」按钮上；
     * 旧 DOM 选择器留作商店/回退弹窗的兜底。 */
    8: () => document.querySelector('.sf-prop-use-view [data-prop-use]') ||
      document.querySelector('.classic-modal-overlay .modal-buttons button[data-action="0"]'),
    9: () => document.querySelector('.classic-modal-overlay .modal-buttons button[data-action="0"]'),
    10: () => document.querySelector('.classic-page[data-screen="bag"] footer [data-action="home"]'),
    13: () => document.querySelector('.sf-levelup-view [depth="20"]'),
  };
  /* 首页底部菜单：原版实例名 → 真实按钮。引导帧里的手指是**烘焙位置**，桌面窗口比例
   * 刚好对上时看不出问题；安卓的 guide 层会被压成 641×378（viewBox 320×196，x 方向有
   * ~12px letterbox），烘焙位置与真实按钮会错开。这里按实例名把手指/金环钉到真实按钮上。 */
  const HOME_TARGETS = {
    1: ['7006', 'challenge'],   // 开始挑战
    3: ['7006', 'challenge'],   // 升级奖励（引导帧文案是“升级后有机会获得武器技能”）
    4: ['7011', 'messages'],    // 新消息
    5: ['7006', 'challenge'],   // 升到 3 级
    6: ['6994', 'bag'],         // 道具
    11: ['7006', 'challenge'],  // 开始挑战
    14: ['6999', 'status'],     // 状态
  };
  /** 首页真实按钮的屏幕矩形：SVG 主界面按原版实例名找，DOM 主界面按 data-action 找。 */
  function homeTargetRect(stepNo) {
    const spec = HOME_TARGETS[stepNo];
    if (!spec) return null;
    try {
      const page = document.querySelector('.ssfight-home') || document;
      const svg = page.querySelector('svg');
      /* 首页菜单的实例名在导出 SVG 里是 `sid`（不是 `name`）；两种都兜一下。 */
      const g = (svg && (svg.querySelector('g[sid="' + spec[0] + '"]') || svg.querySelector('g[name="' + spec[0] + '"]'))) ||
        document.querySelector('g[sid="' + spec[0] + '"]') ||
        document.querySelector('g[name="' + spec[0] + '"]');
      if (g) {
        const r = g.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) return r;
      }
      const btn = document.querySelector('button[data-action="' + spec[1] + '"]');
      if (btn) {
        const r = btn.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) return r;
      }
    } catch (e) {}
    return null;
  }
  function highlightTargets(view, stepNo) {
    if (!view || !view.g) return;
    const svg = view.g;
    /* 屏幕坐标 → SVG 用户坐标**不能只信 getScreenCTM**：WebKit 209220 在 iOS 15.5/15.6
     * 仍复现 —— getScreenCTM 不含祖先 CSS transform 的 scale（#ui 自己有 scale），
     * 于是手指/金环被画到旁边。`SfRender.svgScreenMap()` 用「SVG 实测矩形 +
     * clientWidth/Height + viewBox + preserveAspectRatio」两轴分别反算：
     * 等比缩放时和旧算法一致；「全面屏」下 #ui 的 sx !== sy 时也不会把金环
     * 横向拉宽/纵向压扁（引导框「大小又不对」就是这一档）。 */
    const map = (window.SfRender && SfRender.svgScreenMap) ? SfRender.svgScreenMap(svg) : null;
    if (!map) return;
    const toPoint = map.toUser;
    const toRect = (r) => {
      const p1 = toPoint(r.left, r.top);
      const p2 = toPoint(r.left + r.width, r.top + r.height);
      return { x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y };
    };
    const nodes = [...svg.querySelectorAll('g[type="sprite"]')].filter((n) => TARGET_ART.has(String(n.getAttribute('sid'))));
    const rects = nodes.map((n) => { try { return n.getBoundingClientRect(); } catch (e) { return null; } });
    const rings = new Set();
    const addRing = (r, dxScreen) => {
      const shifted = dxScreen ? { left: r.left + dxScreen, top: r.top, width: r.width, height: r.height } : r;
      const box = toRect(shifted);
      if (!box) return;
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
      /* 金环固定在 SVG 根上：guide 的子组可能带自己的 transform，塞进去会被二次变换。 */
      if (hand && hand.parentNode === svg) svg.insertBefore(ring, hand);
      else svg.appendChild(ring);
    };
    const hand = svg.querySelector('g[type="sprite"][sid="3586"]');
    if (hand && hand.dataset.guideT === undefined) hand.dataset.guideT = hand.getAttribute('transform') || '';
    const moveHand = (target) => {
      if (!hand) return null;
      try {
        /* 手指在素材里就是 SVG 根的直接子节点（不是带自己 transform 的子组），
         * 所以直接用根坐标算位移；不再经过 hand.parentNode.getScreenCTM()。 */
        const hr = hand.getBoundingClientRect();
        const a = toPoint(hr.left, hr.top);
        const b = toPoint(hr.right, hr.bottom);
        const c = toPoint(target.left + target.width / 2, target.top + target.height / 2);
        const addX = c.x - (a.x + b.x) / 2;
        const addY = c.y - b.y;
        /* 手指可能已经因为窗口 resize 被移动过一次：在**已累计的位移**上再加本次差值，
         * 不能拿本次差值直接覆盖旧 translate（否则第二次重算会跳回半个原位）。 */
        const dx = (Number(hand.dataset.guideDx) || 0) + addX;
        const dy = (Number(hand.dataset.guideDy) || 0) + addY;
        hand.dataset.guideDx = String(dx);
        hand.dataset.guideDy = String(dy);
        hand.setAttribute('transform', 'translate(' + dx.toFixed(2) + ',' + dy.toFixed(2) + ') ' + (hand.dataset.guideT || ''));
        return hand;
      } catch (e) { return null; }
    };
    /* 素材里那颗绿色高亮一律不画（转 SVG 后只剩黑阴影）；真实按钮用金环示意。 */
    for (const node of nodes) node.style.display = 'none';
    /* DOM 目标（弹窗按钮 / 升级页确定）是异步挂的：没出现就等一会儿再画，
     * 最多 ~1.4 秒，之后退回素材原位；8/9 两步没有原位可退，干脆不画。 */
    let tries = 0;
    const paint = () => {
      for (const r of [...svg.querySelectorAll('rect.sf-guide-target')]) r.remove();
      rings.clear();
      const domOf = DOM_TARGETS[stepNo];
      if (domOf) {
        const el = domOf();
        if (el && el.isConnected) {
          const ir = el.getBoundingClientRect();
          moveHand(ir);
          addRing(ir, 0);
          return;
        }
        if (tries++ < 12) { setTimeout(paint, 120); return; }
        if (stepNo === 8 || stepNo === 9) return;
      }
      /* 首页：把烘焙手指/金环钉到真实菜单按钮（安卓 letterbox 下烘焙位置会歪）。
       * 引导常常比首页 SVG 先挂上（尤其安卓），按钮还没出来就等一会儿再量。 */
      const homeRect = homeTargetRect(stepNo);
      if (homeRect) {
        moveHand(homeRect);
        addRing(homeRect, 0);
        return;
      }
      if (HOME_TARGETS[stepNo] && tries++ < 12) { setTimeout(paint, 120); return; }
      nodes.forEach((node, i) => {
        const r = rects[i];
        if (!r || !r.width || !r.height) return;
        /* f3 的目标块在素材里只盖住按钮上沿，硬画一圈会显得错位；这一帧只把暗块拿掉，
         * 手指仍指向按钮。 */
        if (stepNo === 3) return;
        addRing(r, 0);
      });
    };
    paint();
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
    clearTimeout(old.reflowTimer);
    if (old.reflow) {
      try { window.removeEventListener('resize', old.reflow); } catch (e) {}
      try { if (window.visualViewport) window.visualViewport.removeEventListener('resize', old.reflow); } catch (e) {}
    }
    if (old.dismiss) {
      try { document.removeEventListener('pointerdown', old.dismiss, true); } catch (e) {}
      try { document.removeEventListener('touchstart', old.dismiss, true); } catch (e) {}
    }
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
  /** 原版 22 号步骤是 specailState=1 的收尾帧（:21721）：下一次按下（isPressedFire）就
   *  doMission。切页签的那一次点击不算 —— 挂监听推迟一个任务，躲开当前这次事件派发。 */
  function armClickDismiss(record, stepNo) {
    setTimeout(() => {
      if (!current || current !== record || record.step !== stepNo) return;
      const onDown = () => {
        try { document.removeEventListener('pointerdown', onDown, true); } catch (e) {}
        try { document.removeEventListener('touchstart', onDown, true); } catch (e) {}
        if (current !== record || record.step !== stepNo) return;
        setStep(99);
        hide();
      };
      record.dismiss = onDown;
      document.addEventListener('pointerdown', onDown, true);
      /* iOS 15 的 WKWebView 可能只在 SVG 上派发 touch 事件、不派发 pointerdown；
       * 22 号步骤是“下一次轻点收起”，只挂 pointerdown 会一直收不掉。 */
      document.addEventListener('touchstart', onDown, { capture: true, passive: true });
    }, 80);
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
    /* `sf-clickthrough`：整层只负责“讲”，不能吃掉目标按钮的轻点。不能只靠父级的
     * `pointer-events:none` 继承进 SVG —— iOS 15 的 WKWebView 在这条继承上不可靠，
     * 手指/金环压住「开始挑战」时按钮就点不动了（见 classic-refine.css 的同名规则）。 */
    host.className = 'sf-guide-view sf-clickthrough stage' + (spec.above ? ' above' : '') + (ctx === 'battle' ? ' battle' : '');
    host.setAttribute('aria-hidden', 'true');
    host.dataset.guideStep = String(stepNo);
    ui.appendChild(host);
    const seq = ++generation;
    current = { seq, host, view: null, timer: 0, step: stepNo, ctx, dismiss: null };
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
        /* 安卓切横屏 / 状态栏隐藏 / 地址栏伸缩都会改视口，guide 的尺寸也跟着变；
        /* 安卓切横屏 / 状态栏隐藏 / 地址栏伸缩都会改视口，guide 的尺寸也跟着变；
         * 不重算的话手指和金环会停在旧屏幕位置（看起来就是“歪着指别处”）。 */
        const reflow = () => {
          if (!current || current.seq !== mine || !current.view) return;
          clearTimeout(current.reflowTimer);
          current.reflowTimer = setTimeout(() => {
            if (!current || current.seq !== mine || !current.view) return;
            try { highlightTargets(current.view, spec.frame); } catch (e) { err(e); }
          }, 120);
        };
        current.reflow = reflow;
        try { window.addEventListener('resize', reflow); } catch (e) {}
        try { if (window.visualViewport) window.visualViewport.addEventListener('resize', reflow); } catch (e) {}
        if (spec.clickDismiss) armClickDismiss(current, stepNo);
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
    if (n === 10) { setStep(11); show(11, 'home'); return; }   // 从背包「返回菜单」回来
    if (n === 11 || n === 14) { show(n, 'home'); return; }
    /* 13：5 级白装。原版是盖在升级页上的（showLevelUp 里 nowPage=13 + viewMission）；
     * 升级页没起来（素材缺失）时在首页放行到 14，别把流程卡住。 */
    if (n === 13) { setStep(14); show(14, 'home'); return; }
    if (n === 21 || n === 23 || n === 24 || n === 25) { show(n, 'home'); return; }
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
  /** 经典背包页的上下文提示（f6→f7 体力药剂 / f8·f10 的兜底重放）。 */
  function onPage(name) {
    if (!classic()) { hide(); return; }
    if (name === 'home') { onHome(); return; }
    const n = step();
    /* 点中下一处入口就算完成当前一步，不必等计时：
     *   f3「升级奖励」→ 开始挑战；f4「新消息」→ 消息；f5「升到 3 级」→ 开始挑战。 */
    if (name === 'challenge' && n === 3) { setStep(4); hide(); return; }
    if (name === 'message' && n === 4) { setStep(5); hide(); return; }
    if (name === 'challenge' && n === 5) { setStep(6); hide(); return; }
    /* f11「升到 5 级有惊喜」/ f12：点开挑战页 → 12（f12 原版 3 秒自动收）。 */
    if (name === 'challenge' && (n === 11 || n === 12)) {
      if (n === 11) setStep(12);
      show(12, 'challenge');
      return;
    }
    if (name === 'bag') {
      if (n === 6) { setStep(7); show(7, 'bag'); return; }
      /* 8：详情弹窗被关掉后又回背包（重放）；10：「使用成功」提示确定后指「返回菜单」。 */
      if (n === 7 || n === 8 || n === 10) { show(n, 'bag'); return; }
      if (n === 9) return;   // 提示还开着：不动
    }
    if (name === 'status') {
      if (n === 14) { setStep(15); show(15, 'status'); return; }
      if (n === 15 || n === 22) { show(n, 'status'); return; }
    }
    if (name === 'village' && (n === 17 || n === 19 || n === 20 || n === 26)) { show(n, 'village'); return; }
    /* 点对应地点就是完成（guideMap 17/19/20/26 → -1）；只有神迹（20）先记着：
     * 原版「回家」按钮在 showGuide25 时 nowPage=25 → f24（天梯）。 */
    if (name === 'village-altar' && n === 17) { setStep(99); hide(); return; }
    if (name === 'village-beast' && n === 19) { setStep(99); hide(); return; }
    if (name === 'village-miracle' && n === 20) { setStep(25); hide(); return; }
    if (name === 'village-war' && n === 26) { setStep(99); hide(); return; }
    hide();
  }
  /* 5 级换装：进页面时随机发一件白装（用户 2026-10 口径），教程本身仍用原版
   * 3625 的 13→14→15→22 流程；这里不再另造介绍页。 */
  function onGears() {
    if (!classic()) return;
    const t = tutorial();
    const S = state();
    if (!t || !S || Number(S.level) < 5) return;
    if (step() < 13) return;   // 先走完 5 级升级页，别抢在 f13 前面
    /* 一次性标记在 State 里（`starterGearGiven`，随存档走）；`t.gearsGift` 只作旧档兼容。 */
    if (S.starterGearGiven || t.gearsGift) return;
    let gear = null;
    try { gear = State.grantStarterGear && State.grantStarterGear(); } catch (e) { err(e); }
    if (gear) {
      t.gearsGift = true;      // 旧字段保留一份，给旧版本/旧档迁移识别
      if (window.UI && UI.toast) UI.toast('新手福利：获得【' + gear.name + '】，已放入装备背包');
    }
  }
  /* 背包里点开道具详情（原版 seeProp，doMission(7)）。商店/兑换页的详情不算。 */
  function onPropDetail(id, mode) {
    if (!classic() || mode) return;
    const n = step();
    if (n === 7) { setStep(8); show(8, 'bag'); return; }
    if (n === 8) { show(8, 'bag'); return; }
    if (n === 9) { setStep(10); show(10, 'bag'); }   // 「使用成功」提示被叉掉：等同确认
  }
  /* 点「使用」成功：原版 useProp 成功在 nowPage>0 时走
   * `showTips(4,0,"使用X成功。")+viewNextMission()`（:1519）→ 页 9。教程期间由引导接管
   * 这条提示：关掉详情弹窗、弹「提示」小窗（确定后进 10 回背包），f9 的金环就贴在它的
   * 「确定」上。返回 true = 调用方不要再走原来的 toast/关窗流程。 */
  function onPropUsed(id, name, r, detail) {
    if (!classic() || step() !== 8 || !r || !r.ok) return false;
    if (!(window.UI && UI.classic && UI.classic.modal)) return false;
    setStep(9);
    try { if (detail && detail.close) detail.close(); } catch (e) {}
    UI.classic.modal('提示', '<p>' + escText('使用' + name + '成功。' + (r.msg || '')) + '</p>', [
      { label: '确定', run: () => { setStep(10); onPage('bag'); } },
    ], { small: true });
    show(9, 'bag');
    return true;
  }
  /* 状态页页签：原版 tab1/tab2.onFire 只在 nowPage==15 才 doMission+showStatusTab
   * （:13721-13760）→ guideMap 15→22。所以切到别的页签 = 完成 15、进 22。 */
  function onStatusTab(key) {
    if (!classic()) return;
    const n = step();
    if (key === 'status') return;   // 点的就是当前页签：原版要 tab_wz != 2/3 才推进
    if (n === 15) { setStep(22); show(22, 'status'); return; }
    if (n === 22) show(22, 'status');
  }
  /* 升级页打开（战果页刚挂上时）。原版 showLevelUp：到 5 级 → nowPage=13 → viewMission
   * 把 f13 盖在升级页上（指「确定」）。其余等级页（21/23/24/17/19/20/26）在回到首页/村庄
   * 时由 onHome / onPage 显示。 */
  function onLevelup(ups) {
    if (!classic() || !ups || !ups.length) return;
    let max = 0;
    for (const u of ups) max = Math.max(max, Number(u && u.level) || 0);
    const page = LEVEL_STEPS[max];
    if (!page) return;
    setStep(page);
    if (page === 13) show(13, 'levelup');
  }
  /* 升级页关掉：原版 doMission(13) = gotoAndStop("main") → 页 14（首页「状态」）。 */
  function onLevelupDone() {
    if (!classic()) return;
    if (step() === 13) { setStep(14); hide(); }
  }
  function skip() {
    const t = tutorial();
    if (t) { t.step = 99; try { State.save(); } catch (e) {} }
    hide();
  }
  window.SfGuide = Object.freeze({
    onHome, onBattleStart, onPage, onPropDetail, onPropUsed, onStatusTab, onLevelup, onLevelupDone,
    onGears,
    hide, skip, step: () => step(),
  });
})();
