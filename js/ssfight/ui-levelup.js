/* ============================================================================
 * ui-levelup.js —— 升级奖励页（ssfight 原版 7795 第 30 帧）+ 现代升级奖励数据
 *
 * 原版 `showLevelUp()`（MainMovie.as:7035）先 `gotoAndStop("levelup")` 播
 * 7795 第 1~29 帧的「NN 级达成」大图，第 30 帧停住并 `showReward()` 把
 * 四格 `fourProperties`（7794）填上：属性各一卡 + 底部「确定」。
 * 原版 `showReward()`（MainMovie.as:7069-7189）按「生命 / 敏捷 / 力量 / 速度」
 * 往 `c1` 里 `attachMovie` 对应属性图；下面四格文字写「生命+5」这类增量。
 * 四维只是**展示**，不是让玩家选。属性卡图用背包/商店那四本永久属性书的
 * 图标（道具 16~19：力 / 敏 / 速 / HP），原版 SWF 没有它们的同名导出，
 * 项目里一直保留着 `prop-16..19.png`（见 classic-ui 的 PROP_SVG_IDS 注释）。
 * 本作沿用这套：四维成长 + 系统代分配点合并成当级总增量显示在四格里，
 * 属性书 / 金宝箱 / 礼包等实物奖励照常占格；武技三选一不再放占位卡，
 * 关掉升级页后再弹三选一弹窗。
 * ========================================================================== */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const SPLASH_SINGLE = 1100;
  const SPLASH_MULTI = 700;
  /* 原版把 7795 挂在根舞台 (-11.3,-6.25) 上（`timeline.json` 的 levelup 标签），
   * 它自己的全屏 CG（7775）从 (11.3,4.9) 开始画。直接 `mountSymbol` 会丢掉这两个
   * 偏移：CG 左上露出底页、右下被屏外裁掉，面板也偏右下（用户 2026-11 截图）。
   * 把视口换成同一块 320×196 裁切，等价于原版舞台的取景，不用再平移子节点。 */
  const STAGE_VIEWBOX = '11.3 6.25 320 196';
  /* 四维卡图 = 背包里那四本永久属性书的图标（道具 16 力 / 17 敏 / 18 速 / 19 HP）。
   * 用户截图 p1 就是这四张；SWF 里 `生命/敏捷/力量/速度` 的同名导出会落到
   * acorn/fruit/book/gift，不是四维书，别再用那一套。 */
  const STAT = {
    hp: { name: '生命', prop: 19 },
    agility: { name: '敏捷', prop: 17 },
    power: { name: '力量', prop: 16 },
    speed: { name: '速度', prop: 18 },
  };
  const STAT_ORDER = ['hp', 'agility', 'power', 'speed'];   // 与原版 showReward 的数组顺序一致
  let inst = null;
  let seq = 0;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function err(e) {
    if (window.__errs) window.__errs.push('SfLevelUp: ' + (e && (e.stack || e.message) || e));
  }
  function clipText(value, max) {
    let s = String(value == null ? '' : value);
    if (s.length > max) s = s.slice(0, Math.max(1, max - 1)) + '…';
    return s;
  }
  /** 四格文字只有约 5 个汉字宽：礼包名收成「体力药×2 / 礼包×1」这类能读全的短标签，
   *  具体是什么道具由卡片图标表达。 */
  function giftLabel(g) {
    let name = String(g.name || '道具').replace(/^(小|大|中)/, '');
    if (/礼包/.test(name)) name = '礼包';
    else if (/药剂|药水/.test(name)) name = name.replace(/(药剂|药水)$/, '药');
    const count = Number(g.count) > 1 ? '×' + g.count : '';
    return clipText(name + count, 5);
  }
  /** 系统代分配点的一点值：力/敏/速 +1，生命 +5（与 `State.STAT_GAIN` 同一口径）。 */
  function statGain(key) {
    const g = window.State && State.STAT_GAIN && Number(State.STAT_GAIN[key]);
    return g > 0 ? g : (key === 'hp' ? 5 : 1);
  }
  /** 一件升级奖励 → 一张原版四格卡（label + 图标）。
   *  · 四维：随机成长 + 系统代分配点合并成**本级总增量**，按原版顺序
   *    （生命 / 敏捷 / 力量 / 速度）各占一格；只是展示，玩家不用选。
   *  · 武技三选一：不放占位卡（用户 2026-11 口径：「三选一」标识太傻），
   *    关掉升级页后再弹三选一弹窗。
   *  · 属性书 / 金宝箱 / 礼包 / 旧版随机武技仍按实物占格。 */
  function entriesFor(up) {
    const out = [];
    const gain = { hp: Number(up.hp) || 0, agility: Number(up.agility) || 0, power: Number(up.power) || 0, speed: Number(up.speed) || 0 };
    if (up.autoPoint && gain[up.autoPoint] != null) gain[up.autoPoint] += statGain(up.autoPoint);
    for (const key of STAT_ORDER) {
      if (gain[key] > 0) out.push({
        label: STAT[key].name + '+' + gain[key],
        icon: { kind: 'prop', id: STAT[key].prop, scale: 0.98 },
      });
    }
    if (up.attributeBook) out.push({ label: '属性书', icon: { kind: 'prop', id: 37 } });
    if (up.chest) out.push({ label: '金宝箱×' + up.chest, icon: { kind: 'prop', id: 90 } });
    (up.gifts || []).forEach((g) => {
      out.push({ label: giftLabel(g), icon: { kind: 'prop', id: g.id } });
    });
    if (up.reward) {
      out.push({
        label: clipText(up.reward, 5),
        icon: up.rewardId ? { kind: up.rewardKind === 'weapon' ? 'weapon' : 'skill', id: up.rewardId } : { badge: '!' },
      });
    }
    if (!out.length) out.push({ label: '等级提升', icon: { badge: 'UP' } });
    return out;
  }
  function chunks(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }
  function iconHref(icon) {
    if (!icon || !icon.kind || icon.id == null) return '';
    /* 礼包里的金松果（id 8）在经典模式统一用经典那张小松果（原版 3867 矢量），
     * 不用现代 330×330 prop-8。其余道具走 `UI.classic.propIconSrc`（原版无框矢量优先）。 */
    if (icon.kind === 'prop') {
      if (Number(icon.id) === 8) return 'images/ui/icons/gold-acorn.png';
      const classic = window.UI && window.UI.classic;
      if (classic && typeof classic.propIconSrc === 'function') return classic.propIconSrc(icon.id);
      return 'images/ui/icons/prop/prop-' + icon.id + '.png';
    }
    return 'images/ui/icons/' + icon.kind + '/' + icon.kind + '-' + icon.id + '.png';
  }
  /** 卡片 c1 槽里放图标：优先用现代道具/武技图集切图，没有贴图的用字徽。
   *  四维卡用背包那四本永久属性书的图标（prop-16..19），放进原版 7778 金卡；
   *  `icon.scale` 让书卡比普通道具略大一点，标签仍由四格文字写增量。 */
  function setCardArt(slot, icon) {
    if (!slot || !slot.g) return;
    try { if (slot.gotoAndStop) slot.gotoAndStop(1); } catch (e) { /* 帧结构缺省时保持现状 */ }
    const host = (slot.getContentHost && slot.getContentHost()) || slot.g;
    if (!host) return;
    for (const old of host.querySelectorAll('.sf-levelup-cardart')) old.remove();
    const href = icon && iconHref(icon);
    let b = null;
    try { b = slot.g.getBBox(); } catch (e) { b = null; }
    if (!b || !(b.width > 0) || !(b.height > 0)) return;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (href) {
      const scale = Number(icon && icon.scale) > 0 ? Number(icon.scale) : 0.76;
      const size = Math.min(b.width, b.height) * scale;
      const img = document.createElementNS(NS, 'image');
      img.setAttribute('class', 'sf-levelup-cardart');
      img.setAttribute('x', (cx - size / 2).toFixed(2));
      img.setAttribute('y', (cy - size / 2).toFixed(2));
      img.setAttribute('width', size.toFixed(2));
      img.setAttribute('height', size.toFixed(2));
      img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      img.setAttribute('href', href);
      img.setAttributeNS(XLINK, 'xlink:href', href);
      img.setAttribute('pointer-events', 'none');
      host.appendChild(img);
      return;
    }
    const badge = (icon && icon.badge) || '?';
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'sf-levelup-cardart');
    t.setAttribute('x', cx.toFixed(2));
    t.setAttribute('y', (cy + Math.min(b.width, b.height) * 0.15).toFixed(2));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-family', 'SimHei,Microsoft YaHei,sans-serif');
    t.setAttribute('font-size', (Math.min(b.width, b.height) * (badge.length > 1 ? 0.3 : 0.48)).toFixed(2));
    t.setAttribute('font-weight', '700');
    t.setAttribute('fill', '#fff6d8');
    t.setAttribute('stroke', '#5b2c12');
    t.setAttribute('stroke-width', '1.1');
    t.setAttribute('paint-order', 'stroke');
    t.setAttribute('pointer-events', 'none');
    t.textContent = badge;
    host.appendChild(t);
  }
  function setCard(fp, index, entry) {
    const p = fp && fp.byName ? fp.byName('p' + index) : null;
    const text = fp && fp.byName ? fp.byName('text' + index) : null;
    const slot = p && p.byName ? p.byName('c1') : null;
    const t = window.SfUiMain && SfUiMain.toolkit;
    if (text && t) t.setText(text, entry.label || '');
    if (slot) setCardArt(slot, entry.icon);
  }
  /** 按钮「确定」是原版 3152 胶囊 + 4659 文字（都没有实例名，直接按深度取）。 */
  function wireConfirm(view) {
    if (!view || !view.g) return;
    for (const depth of ['20', '22']) {
      const n = view.g.querySelector(':scope > [depth="' + depth + '"]');
      if (!n || n.__sfLevelUpBound) continue;
      n.__sfLevelUpBound = true;
      n.style.pointerEvents = 'auto';
      n.style.cursor = 'pointer';
      n.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        confirm();
      });
      n.setAttribute('role', 'button');
      n.setAttribute('tabindex', '0');
      n.setAttribute('aria-label', '确定');
      n.addEventListener('keydown', (e) => {
        if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); confirm(); }
      });
      if (depth === '20') {
        n.addEventListener('mouseenter', () => { n.style.filter = 'brightness(1.08)'; });
        n.addEventListener('mouseleave', () => { n.style.filter = ''; });
      }
    }
  }
  function pageIndicator(view, page, total) {
    if (!view || !view.g) return;
    let t = view.g.querySelector(':scope > .sf-levelup-page');
    if (total <= 1) { if (t) t.remove(); return; }
    if (!t) {
      t = document.createElementNS(NS, 'text');
      t.setAttribute('class', 'sf-levelup-page');
      t.setAttribute('x', '281');
      t.setAttribute('y', '33');
      t.setAttribute('text-anchor', 'end');
      t.setAttribute('font-family', 'SimHei,Microsoft YaHei,sans-serif');
      t.setAttribute('font-size', '10');
      t.setAttribute('font-weight', '700');
      t.setAttribute('fill', '#7a5528');
      t.setAttribute('pointer-events', 'none');
      view.g.appendChild(t);
    }
    t.textContent = (page + 1) + '/' + total;
  }
  function freeze(view) {
    try {
      if (window.SfUiMain && SfUiMain.toolkit && SfUiMain.toolkit.freezeDescendants) SfUiMain.toolkit.freezeDescendants(view);
    } catch (e) { err(e); }
    if (view) view.playing = false;
  }
  function setLevel(view, level) {
    const num = view && view.byName ? view.byName('level') : null;
    const t = window.SfUiMain && SfUiMain.toolkit;
    if (num && t && t.showNumber) {
      try { t.showNumber(level, num, 0, 0, 'right'); } catch (e) { err(e); }
    }
  }
  /** 当前这一级的奖励分页；每页最多四个，照原版 7794 的 1~4 帧。 */
  function currentPages() {
    return chunks(entriesFor(inst.ups[inst.upIndex]), 4);
  }
  function showSplash() {
    if (!inst || !inst.view) return;
    const up = inst.ups[inst.upIndex];
    inst.page = 0;
    inst.pages = currentPages();
    inst.ready = false;
    inst.lock = false;
    inst.view.gotoAndStop(1);
    inst.view.playing = false;
    freeze(inst.view);
    setLevel(inst.view, up.level);
    pageIndicator(inst.view, 0, 0);
    clearTimeout(inst.timer);
    const wait = reduceMotion() ? 0 : (inst.ups.length > 1 ? SPLASH_MULTI : SPLASH_SINGLE);
    inst.timer = setTimeout(() => {
      if (!inst || inst.seq !== seq) return;
      showReward();
    }, wait);
  }
  function showReward() {
    if (!inst || !inst.view) return;
    const pages = currentPages();
    inst.pages = pages;
    if (inst.page >= pages.length) inst.page = pages.length - 1;
    const cards = pages[inst.page] || [];
    const view = inst.view;
    view.gotoAndStop(30);
    view.playing = false;
    freeze(view);
    const gear = view.byName ? view.byName('c1') : null;
    if (gear && gear.g) gear.g.style.display = 'none';       // 原版单件装备格：现代升级奖励没有这一格
    const fp = view.byName ? view.byName('fourProperties') : null;
    if (fp) {
      try { fp.gotoAndStop(Math.max(1, Math.min(4, cards.length))); } catch (e) { err(e); }
      freeze(view);
      for (let i = 0; i < cards.length && i < 4; i++) setCard(fp, i + 1, cards[i]);
    }
    pageIndicator(view, inst.page, pages.length);
    wireConfirm(view);
    markBackground(view);
    inst.ready = true;
  }
  /** 给 7775 全屏 CG 那一组打标：确定后若还要弹三选一，可以只留它当背景。 */
  function markBackground(view) {
    if (!view || !view.g) return;
    let cg = null;
    try { cg = view.g.querySelector(':scope > g > path[fill^="url(#f7775"]'); } catch (e) { cg = null; }
    if (cg && cg.parentNode && cg.parentNode.classList) cg.parentNode.classList.add('sf-levelup-cg');
  }
  /** 升级页关掉后是否还有必须由玩家处理的武技三选一。 */
  function pendingWs() {
    try {
      return !!(window.State && typeof State.pendingWS === 'function' && State.pendingWS() > 0);
    } catch (e) { return false; }
  }
  /** 只留全屏 CG：面板 / 四格 / 确定都藏起来，背景层降到弹窗之下，给三选一当底图。 */
  function holdBackground() {
    if (!inst || !inst.host) return false;
    inst.backgroundHeld = true;
    inst.ready = false;
    clearTimeout(inst.timer);
    if (inst.host.classList) inst.host.classList.add('sf-levelup-bg-only');
    markBackground(inst.view);
    return true;
  }
  /** 三选一 / 加点都处理完：把背景层收掉。 */
  function releaseBackground() {
    if (!inst || !inst.backgroundHeld) return false;
    destroy();
    return true;
  }
  function confirm() {
    if (!inst || !inst.ready || inst.lock) return;
    inst.lock = true;
    setTimeout(() => { if (inst) inst.lock = false; }, 220);
    if (inst.page < inst.pages.length - 1) {
      inst.page++;
      showReward();
      return;
    }
    if (inst.upIndex < inst.ups.length - 1) {
      inst.upIndex++;
      showSplash();
      return;
    }
    finish();
  }
  function finish() {
    if (!inst) return;
    const cb = inst.onDone;
    /* 后面还有武技三选一：先别拆整页，只留全屏 CG 给弹窗当背景；
     * `releaseBackground()` 由 classic-ui 在三选一 / 加点都处理完后调用。 */
    if (pendingWs()) {
      holdBackground();
      if (typeof cb === 'function') {
        try { cb(); } catch (e) { err(e); }
      }
      return;
    }
    destroy();
    if (typeof cb === 'function') {
      try { cb(); } catch (e) { err(e); }
    }
  }
  function destroy() {
    seq++;
    if (!inst) return;
    clearTimeout(inst.timer);
    const old = inst;
    inst = null;
    try { if (old.view) old.view.destroy(); } catch (e) {}
    try { if (old.host && old.host.parentNode) old.host.parentNode.removeChild(old.host); } catch (e) {}
  }
  async function mount(host, mine) {
    const view = await SfRender.mountSymbol(host, '7795', {
      frame: 1, label: '等级提升', viewBox: STAGE_VIEWBOX,
    });
    if (!inst || inst.seq !== mine) { try { view.destroy(); } catch (e) {} return; }
    inst.view = view;
    freeze(view);
    showSplash();
  }
  function fail(e) {
    err(e);
    if (!inst) return;
    const cb = inst.onDone;
    destroy();
    if (typeof cb === 'function') { try { cb(); } catch (x) { err(x); } }
  }
  function open(ups, onDone) {
    const list = (ups || []).filter(Boolean);
    if (!list.length) { if (onDone) onDone(); return false; }
    destroy();
    const mine = ++seq;
    inst = {
      seq: mine, ups: list, upIndex: 0, page: 0, pages: [], timer: 0, onDone,
      host: document.createElement('section'), view: null, backgroundHeld: false,
    };
    inst.host.className = 'classic-home ssfight-home ssfight-view sf-levelup-view';
    inst.host.setAttribute('role', 'dialog');
    inst.host.setAttribute('aria-modal', 'true');
    inst.host.setAttribute('aria-label', '升级奖励');
    inst.host.tabIndex = 0;
    inst.host.addEventListener('keydown', (e) => {
      if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); confirm(); }
    });
    const ui = document.getElementById('ui') || document.body;
    ui.appendChild(inst.host);
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    try { inst.host.focus({ preventScroll: true }); } catch (e) {}
    if (!window.SfRender || !SfRender.mountSymbol || !SfRender.load) { fail(new Error('素材库未就绪')); return false; }
    SfRender.load().then(() => {
      if (!inst || inst.seq !== mine) return null;
      return mount(inst.host, mine);
    }).catch(fail);
    return true;
  }
  window.SfLevelUp = Object.freeze({
    open, destroy, releaseBackground,
    isOpen: () => !!(inst && inst.host && inst.host.isConnected),
  });
})();
