/* Shared UI feedback for DOM cards and SVG pop shells. No work at import time. */
(function () {
  'use strict';

  const states = new WeakMap();
  const live = (node) => !!(node && node.classList && node.isConnected !== false);
  const disabled = (node) => !live(node) || node.disabled ||
    (node.getAttribute && node.getAttribute('aria-disabled') === 'true');
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function state(node) {
    let s = states.get(node);
    if (!s) { s = { options: {}, pickTimer: 0, pressTimer: 0, actionTimer: 0, pending: false }; states.set(node, s); }
    return s;
  }
  function target(node, s) {
    const shell = s.options.shell;
    return (typeof shell === 'function' ? shell() : shell) || node;
  }
  function selected(node, s) {
    const value = s.options.selected;
    return typeof value === 'function' ? !!value() : !!value;
  }
  function refresh(node, s) {
    const host = target(node, s);
    if (!live(host)) return null;
    host.classList.add('sf-feedback');
    host.classList.toggle('sf-selected', selected(node, s));
    return host;
  }
  function unpress(node, s) {
    if (s.pressTimer) clearTimeout(s.pressTimer);
    s.pressTimer = 0;
    const host = target(node, s);
    if (host && host.classList) host.classList.remove('pressed');
  }
  function press(node, s) {
    if (disabled(node)) return;
    const host = refresh(node, s);
    if (!host) return;
    unpress(node, s);
    void host.getBoundingClientRect();
    host.classList.add('pressed');
    s.pressTimer = setTimeout(() => unpress(node, s), 180);
  }
  function bind(node, options) {
    if (!node || !node.addEventListener || !node.classList) return node;
    const s = state(node);
    s.options = Object.assign({}, s.options, options || {});
    refresh(node, s);
    if (s.bound) return node;
    s.bound = true;
    node.addEventListener('pointerenter', () => {
      if (s.options.hover === false || disabled(node)) return;
      const host = refresh(node, s);
      if (host) host.classList.add('sf-hover');
    });
    node.addEventListener('pointerleave', () => {
      const host = target(node, s);
      if (s.options.hover !== false && host && host.classList) host.classList.remove('sf-hover');
      unpress(node, s);
    });
    node.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      press(node, s);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
      node.addEventListener(event, () => unpress(node, s));
    }
    node.addEventListener('keydown', (event) => {
      if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) press(node, s);
    });
    node.addEventListener('keyup', () => unpress(node, s));
    return node;
  }
  function pick(node) {
    if (!live(node)) return;
    const s = state(node), host = refresh(node, s);
    if (!host) return;
    if (s.pickTimer) clearTimeout(s.pickTimer);
    host.classList.remove('picked');
    void host.getBoundingClientRect();
    host.classList.add('picked');
    s.pickTimer = setTimeout(() => {
      s.pickTimer = 0;
      if (host.classList) host.classList.remove('picked');
    }, reduced() ? 0 : 500);
  }
  function tap(node, run, options) {
    if (disabled(node)) return false;
    const s = state(node);
    if (s.pending) return false; // Repeated clicks must not commit an earlier navigation.
    const opts = options || {}, host = refresh(node, s);
    s.pending = true;
    if (opts.press !== false) press(node, s);
    if (opts.pick) pick(node);
    if (opts.exit && host) host.classList.add('sf-leaving');
    const delay = reduced() ? 0 : Math.max(0, opts.delay == null ? 160 : Number(opts.delay) || 0);
    s.actionTimer = setTimeout(() => {
      s.actionTimer = 0;
      s.pending = false;
      if (host && host.classList) host.classList.remove('sf-leaving');
      if (!disabled(node) && typeof run === 'function') run();
    }, delay);
    return true;
  }
  function clear(node) {
    const s = node && states.get(node);
    if (!s) return;
    unpress(node, s);
    if (s.pickTimer) clearTimeout(s.pickTimer);
    if (s.actionTimer) clearTimeout(s.actionTimer);
    s.pickTimer = s.actionTimer = 0;
    s.pending = false;
    const host = target(node, s);
    if (host && host.classList) host.classList.remove('sf-hover', 'pressed', 'picked', 'sf-leaving');
  }

  window.SfUiFeedback = Object.freeze({ bind: bind, tap: tap, pick: pick, clear: clear });
})();
