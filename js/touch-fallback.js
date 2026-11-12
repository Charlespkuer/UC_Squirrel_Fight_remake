// js/touch-fallback.js — iOS 15 WKWebView can fail to synthesize click (touch-action on html/body,
// controls inside transform/SVG). Only touch devices; wait 420ms for a native click, then synthesize
// detail=0. New touchstart cancels the pending tap (Android double-tap). Must load after game scripts.
(function () {
  'use strict';
  var touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  if (!touchCapable) return;

  var start = null;
  var lastTrustedClick = 0;
  // Touch sequence id: a new touchstart invalidates the pending 420ms fallback, so the previous
  // tap's stale coordinates cannot click on a page that already changed (Android double-tap).
  var tapId = 0;
  var CLICK_WAIT = 420;
  var TAP_SLOP = 14;
  var TAP_TIME = 900;

  function now() { return Date.now(); }

  function disabled(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (n.disabled || (n.getAttribute && n.getAttribute('aria-disabled') === 'true')) return true;
      try { if (n.matches && n.matches(':disabled')) return true; } catch (e) {}
    }
    return false;
  }

  function suspended() {
    return document.hidden || document.visibilityState === 'hidden' ||
      (typeof window.__ssdzIsBackgrounded === 'function' && window.__ssdzIsBackgrounded());
  }

  function cancelTap() { start = null; tapId++; }

  function scene() {
    var ui = document.getElementById('ui');
    return { ui: ui, nodes: ui ? Array.prototype.slice.call(ui.childNodes) : [] };
  }
  function sameScene(old) {
    var current = scene();
    return current.ui === old.ui && current.nodes.length === old.nodes.length &&
      current.nodes.every(function (n, i) { return n === old.nodes[i]; });
  }

  // Decorative layer that must pass clicks through. Use an explicit class, not computed
  // pointer-events: on iOS 15 a parent's `none` is not inherited into SVG, so the computed value lies.
  function clickThrough(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (n.classList && (n.classList.contains('sf-clickthrough') ||
        n.classList.contains('sf-guide-view'))) return true;
    }
    return false;
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var s = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (s && (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none')) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function elementStack(x, y) {
    var stack = [];
    try {
      if (document.elementsFromPoint) stack = document.elementsFromPoint(x, y) || [];
      else if (document.msElementsFromPoint) stack = document.msElementsFromPoint(x, y) || [];
    } catch (e) { stack = []; }
    if (!stack.length) {
      var one = document.elementFromPoint(x, y);
      if (one) stack = [one];
    }
    return stack;
  }

  // First real interactive element at the point; skip click-through decor and pointer-events:none hit layers.
  function hitAt(x, y) {
    var stack = elementStack(x, y);
    for (var i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (!el || clickThrough(el)) continue;
      var s = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (s && s.pointerEvents === 'none') continue;
      return el;
    }
    return null;
  }

  // Ask the classic SVG router who owns this point and synthesize a click on that clip's <g>;
  // does not depend on the native click landing in SVG or on CTM (router uses rects + elementFromPoint).
  function svgClipAt(x, y) {
    var T = window.SfUiMain && window.SfUiMain.toolkit;
    if (!T || !T.routerOf) return null;
    var stack = elementStack(x, y);
    var seen = [];
    for (var i = 0; i < stack.length; i++) {
      var n = stack[i];
      if (!n || clickThrough(n)) continue;
      var svg = n.ownerSVGElement || ((n.tagName || '').toLowerCase() === 'svg' ? n : null);
      if (!svg || clickThrough(svg) || seen.indexOf(svg) >= 0) continue;
      // TRAP: if the root SVG declares pointer-events:none, do not call routerOf() here — router init
      // flips it to auto. The battle skip-key overlay is such a shell; once opened it becomes a
      // full-screen hit layer and, after the skip key is removed, eats all chest-page touches.
      var svgPE = '';
      try { svgPE = window.getComputedStyle ? window.getComputedStyle(svg).pointerEvents : ''; } catch (e) {}
      if (svgPE === 'none') continue;
      seen.push(svg);
      var r = null;
      try { r = svg.__sfRouter || T.routerOf(svg); } catch (e) { r = null; }
      if (!r || !r.hit) continue;
      var owner = null;
      try { owner = r.hit(x, y); } catch (e) { owner = null; }
      if (owner && owner.clip && owner.clip.g) return owner.clip;
    }
    return null;
  }
  function activateSvgAt(x, y) {
    var clip = svgClipAt(x, y);
    if (!clip) return false;
    // Click directly on the clip <g>; stop the SVG router from handling the same click twice.
    synthOn(clip.g, x, y);
    return true;
  }

  // Fallback when the element layer has no target: scan #ui rects, prefer later DOM order (topmost).
  function targetAt(x, y) {
    var el = hitAt(x, y);
    if (!el) return null;
    // Already inside SVG (classic UI): let the click bubble to the SVG router.
    if (el.ownerSVGElement || (el.tagName || '').toLowerCase() === 'svg') return el;
    var clickable = null;
    try {
      clickable = el.closest && el.closest(
        'button,input,a,[role="button"],.uc-button,.uc-tab,.picture-button,.challenger,.village-door'
      );
    } catch (e) {}
    if (clickable) return disabled(clickable) ? null : clickable;

    var ui = document.getElementById('ui');
    if (!ui) return el;
    var nodes = ui.querySelectorAll(
      'button,input,a,[role="button"],.uc-button,.uc-tab,.picture-button,.challenger,.village-door,.home-menu button'
    );
    for (var i = nodes.length - 1; i >= 0; i--) {
      var r = nodes[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && visible(nodes[i])) return nodes[i];
    }
    // Classic pages are all SVG: if the element layer only returned canvas/overlay, find the covering svg.
    var svgs = ui.querySelectorAll('svg');
    for (var j = svgs.length - 1; j >= 0; j--) {
      if (clickThrough(svgs[j])) continue;
      var sr = svgs[j].getBoundingClientRect();
      if (x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom && visible(svgs[j])) return svgs[j];
    }
    return el;
  }

  function synthOn(el, x, y) {
    if (!el || disabled(el)) return false;
    try {
      var ev = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: 0,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: 0,
      });
      // Mark synthesized clicks so the router avoids double handling; the page-transition input lock
      // only swallows real/synthesized taps, programmatic .click() still passes.
      ev.__sfSynth = true;
      el.dispatchEvent(ev);
      return true;
    } catch (e) {
      return false;
    }
  }

  function synthClick(x, y) {
    if (activateSvgAt(x, y)) return true;
    return synthOn(targetAt(x, y), x, y);
  }

  document.addEventListener('touchstart', function (e) {
    // Invalidate the previous tap's pending fallback: this may be the second tap of a double-tap.
    tapId++;
    if (suspended() || !e.touches || e.touches.length !== 1) { start = null; return; }
    var t = e.touches[0];
    var target = targetAt(t.clientX, t.clientY);
    start = { x: t.clientX, y: t.clientY, t: now(), scene: scene(), target: target,
      anchor: target && (target.ownerSVGElement || target), svgClip: svgClipAt(t.clientX, t.clientY) };
    lastTrustedClick = 0;
  }, { capture: true, passive: true });

  document.addEventListener('touchend', function (e) {
    if (!start) return;
    var t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) { start = null; return; }
    var dx = t.clientX - start.x;
    var dy = t.clientY - start.y;
    var dt = now() - start.t;
    var x = t.clientX, y = t.clientY;
    var oldScene = start.scene, target = start.target, anchor = start.anchor, svgClip = start.svgClip;
    start = null;
    if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP || dt > TAP_TIME) return;

    var began = now();
    var mine = ++tapId;
    setTimeout(function () {
      // A newer touch happened: let its native click/double-tap handle it, do not synthesize.
      if (mine !== tapId) return;
      if (suspended() || now() - began > CLICK_WAIT + 500 || !sameScene(oldScene)) return;
      if (!anchor || anchor.isConnected === false || disabled(target)) return;
      var current = targetAt(x, y);
      if (!current || (current.ownerSVGElement || current) !== anchor) return;
      var currentClip = svgClipAt(x, y);
      if ((svgClip || currentClip) && (!svgClip || currentClip !== svgClip || !svgClip.g || svgClip.g.isConnected === false)) return;
      // A native click already arrived (usually 0-50ms after touchend) — do not duplicate. Trusted
      // click timestamps swallowed by the transition lock also count, hence __sfTrustedClickAt.
      var seen = Math.max(lastTrustedClick, Number(window.__sfTrustedClickAt) || 0);
      if (seen && seen >= began) return;
      synthClick(x, y);
    }, CLICK_WAIT);
  }, { capture: true, passive: true });

  document.addEventListener('touchcancel', cancelTap, { capture: true, passive: true });
  document.addEventListener('visibilitychange', function () { if (suspended()) cancelTap(); });
  window.addEventListener('pagehide', cancelTap);

  document.addEventListener('click', function (e) {
    if (!e.isTrusted) return;
    lastTrustedClick = now();
    window.__sfTrustedClickAt = lastTrustedClick;
    // Native click was eaten by a decorative layer: forward by touch point to the real control below
    // (normal browsers never hit this since pointer-events:none keeps the decor from being the target).
    if (!clickThrough(e.target)) return;
    if (activateSvgAt(e.clientX, e.clientY)) return;
    synthOn(targetAt(e.clientX, e.clientY), e.clientX, e.clientY);
  }, true);
})();
