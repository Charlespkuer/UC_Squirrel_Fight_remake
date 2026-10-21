/* ============================================================================
 * ui-levelup.js —— 升级奖励页（ssfight 原版 7795 第 30 帧）+ 现代升级奖励数据
 *
 * 原版 `showLevelUp()`（MainMovie.as:7035）先 `gotoAndStop("levelup")` 播
 * 7795 第 1~29 帧的「NN 级达成」大图，第 30 帧停住并 `showReward()` 把
 * 四格 `fourProperties`（7794）填上：属性各一卡 + 底部「确定」。
 * 原版四格只放「生命/力量/敏捷/速度/武技」；复刻的升级奖励机制更丰富
 * （自由点、三选一、属性书、礼包），这里保留原版版式，把奖励**分页**塞进
 * 同一组四格，不另画一套现代卡片。
 * ========================================================================== */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const SPLASH_SINGLE = 1100;
  const SPLASH_MULTI = 700;
  const STAT = {
    power: { name: '力量', char: '力', prop: 3 },
    agility: { name: '敏捷', char: '敏', prop: 4 },
    speed: { name: '速度', char: '速', prop: 5 },
    hp: { name: '生命', char: '命', prop: null },
  };
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
  function statGain(key) {
    const g = window.State && State.STAT_GAIN && Number(State.STAT_GAIN[key]);
    return g > 0 ? g : 1;
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
  /** 一件升级奖励 → 一张原版四格卡（label + 图标）。 */
  function entriesFor(up) {
    const out = [];
    const addStat = (key) => {
      const value = Number(up[key]) || 0;
      if (value <= 0) return;
      out.push({
        label: STAT[key].name + '+' + value,
        icon: key === 'hp' ? { badge: STAT[key].char } : { kind: 'prop', id: STAT[key].prop },
      });
    };
    addStat('power'); addStat('agility'); addStat('speed'); addStat('hp');
    if (up.attributeBook) out.push({ label: '属性书', icon: { kind: 'prop', id: 37 } });
    if (up.freePoint) out.push({ label: '自由点', icon: { badge: '点' } });
    if (up.autoPoint) {
      const key = up.autoPoint;
      const char = (STAT[key] && STAT[key].char) || '点';
      out.push({ label: clipText('代选' + char + '+' + statGain(key), 5), icon: { badge: char } });
    }
    if (up.wsChoice) out.push({ label: '三选一', icon: { badge: '选' } });
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
    /* 礼包里的金松果（id 8）在经典模式统一用经典那张小松果，不用现代 330×330 prop-8。 */
    if (icon.kind === 'prop' && Number(icon.id) === 8) return 'images/ui/icons/gold-acorn.png';
    return 'images/ui/icons/' + icon.kind + '/' + icon.kind + '-' + icon.id + '.png';
  }
  /** 卡片 c1 槽里放图标：优先用现代道具/武技图集切图，没有贴图的用字徽。 */
  function setCardArt(slot, icon) {
    if (!slot || !slot.g) return;
    const host = (slot.getContentHost && slot.getContentHost()) || slot.g;
    if (!host) return;
    for (const old of host.querySelectorAll('.sf-levelup-cardart')) old.remove();
    let b = null;
    try { b = slot.g.getBBox(); } catch (e) { b = null; }
    if (!b || !(b.width > 0) || !(b.height > 0)) return;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const href = icon && iconHref(icon);
    if (href) {
      const size = Math.min(b.width, b.height) * 0.76;
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
    inst.ready = true;
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
    const view = await SfRender.mountSymbol(host, '7795', { frame: 1, label: '等级提升' });
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
      host: document.createElement('section'), view: null,
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
    open, destroy, isOpen: () => !!(inst && inst.host && inst.host.isConnected),
  });
})();
