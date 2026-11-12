// ui-levelup.js — 升级奖励页（原版 7795 第 30 帧）; four `fourProperties` slots (7794) are display-only:
// stat growth + auto points merged per level, physical rewards occupy slots, weapon-choice modal opens after.
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const SPLASH_SINGLE = 1100;
  const SPLASH_MULTI = 700;
  // 7795 sits at root stage (-11.3,-6.25) and its full-screen CG (7775) draws from (11.3,4.9).
  // Plain mountSymbol loses both offsets (CG leaks top-left, clipped bottom-right). This viewBox is
  // the same 320×196 crop as the original stage, so child nodes need no extra translation.
  const STAGE_VIEWBOX = '11.3 6.25 320 196';
  // Stat-card art = the four permanent stat books (props 16 str / 17 agi / 18 spd / 19 HP; prop-16..19.png).
  // SWF exports named 生命/敏捷/力量/速度 resolve to acorn/fruit/book/gift — do not use those.
  const STAT = {
    hp: { name: '生命', prop: 19 },
    agility: { name: '敏捷', prop: 17 },
    power: { name: '力量', prop: 16 },
    speed: { name: '速度', prop: 18 },
  };
  const STAT_ORDER = ['hp', 'agility', 'power', 'speed'];   // Same order as the original showReward array.
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
  // Four slots are ~5 hanzi wide: shorten gift names («体力药×2»); the card icon carries the detail.
  function giftLabel(g) {
    let name = String(g.name || '道具').replace(/^(小|大|中)/, '');
    if (/礼包/.test(name)) name = '礼包';
    else if (/药剂|药水/.test(name)) name = name.replace(/(药剂|药水)$/, '药');
    const count = Number(g.count) > 1 ? '×' + g.count : '';
    return clipText(name + count, 5);
  }
  // Auto-allocated point: str/agi/spd +1, HP +5 (same as State.STAT_GAIN).
  function statGain(key) {
    const g = window.State && State.STAT_GAIN && Number(State.STAT_GAIN[key]);
    return g > 0 ? g : (key === 'hp' ? 5 : 1);
  }
  // One reward -> one of the original four slots (label + icon). Stats merge random growth +
  // auto points into this level's total, display only (the player never picks). Weapon choice is
  // deferred to a modal after closing; tomes/chest/gift/random skill keep physical slots.
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
    // Gift pinecone (id 8) uses the classic small pinecone (original 3867 vector), not modern
    // 330×330 prop-8; other props go through UI.classic.propIconSrc.
    if (icon.kind === 'prop') {
      if (Number(icon.id) === 8) return 'images/ui/icons/gold-acorn.svg';
      const classic = window.UI && window.UI.classic;
      if (classic && typeof classic.propIconSrc === 'function') return classic.propIconSrc(icon.id);
      return 'images/ui/icons/prop/prop-' + icon.id + '.png';
    }
    return 'images/ui/icons/' + icon.kind + '/' + icon.kind + '-' + icon.id +
      (icon.kind === 'weapon' || icon.kind === 'skill' ? '.svg' : '.png');
  }
  // Card art: modern prop/skill atlas when available, else a character badge; stat cards use
  // prop-16..19 in the original 7778 gold card, icon.scale makes them slightly larger.
  function setCardArt(slot, icon) {
    if (!slot || !slot.g) return;
    try { if (slot.gotoAndStop) slot.gotoAndStop(1); } catch (e) { /* no frame structure: keep current content */ }
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
  // Confirm = original 3152 capsule + 4659 text; both unnamed, so picked by depth.
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
  // Reward pages; max four per page, matching original 7794 frames 1-4.
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
    if (gear && gear.g) gear.g.style.display = 'none';       // Original single-gear slot; modern level-up rewards never use it.
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
  // Tag the 7775 full-screen CG group so a following weapon-choice modal can keep it as background.
  function markBackground(view) {
    if (!view || !view.g) return;
    let cg = null;
    try { cg = view.g.querySelector(':scope > g > path[fill^="url(#f7775"]'); } catch (e) { cg = null; }
    if (cg && cg.parentNode && cg.parentNode.classList) cg.parentNode.classList.add('sf-levelup-cg');
  }
  // Whether a weapon-choice modal still needs the player after the level-up page closes.
  function pendingWs() {
    try {
      return !!(window.State && typeof State.pendingWS === 'function' && State.pendingWS() > 0);
    } catch (e) { return false; }
  }
  // Keep only the full-screen CG: hide panel/slots/confirm and lower the background under the modal.
  function holdBackground() {
    if (!inst || !inst.host) return false;
    inst.backgroundHeld = true;
    inst.ready = false;
    clearTimeout(inst.timer);
    if (inst.host.classList) inst.host.classList.add('sf-levelup-bg-only');
    markBackground(inst.view);
    return true;
  }
  // Modal/points handled: remove the background layer.
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
    // Weapon choice still pending: keep the page, leave the full-screen CG as modal background;
    // classic-ui calls releaseBackground() after both choice and points are handled.
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
