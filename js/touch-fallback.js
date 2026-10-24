/* ============================================================
 * js/touch-fallback.js —— iOS 老版本 WKWebView 的触摸兜底
 *
 * 背景：iOS 15.x 的 WKWebView 在部分场景下不会把一次轻点合成为 click
 * （尤其页面在 html/body 上声明了 touch-action、或控件在 transform/SVG 里时），
 * 表现就是“画面能开、按钮完全点不动”。这里不改变正常浏览器的行为：
 *   · 只监听触摸设备；
 *   · 先等原生 click 420ms；真 click 到了就不补发；
 *   · 没等到才在触摸点找到控件，补发一个 detail=0 的 click。
 *
 * 另外两条 iOS 15 的兼容：
 *   · 父层的 pointer-events:none 不一定继承进 SVG 子树，装饰层（新手引导的手/金环）
 *     会把轻点吃掉。`hitAt()` 按 elementsFromPoint 跳过 `.sf-clickthrough`
 *     与 pointer-events:none 的层；原生 click 若仍被这种层吃掉，就在捕获阶段
 *     按触点转发给下面真正的控件。
 *   · 有些版本只合成 click、不派发 pointerdown/up（见 ui-main.js 的 SVG 路由）：
 *     那条路径由路由自己按触点放行；这里补发的 click 用 detail=0，不依赖按下目标。
 *
 * 脚本必须放在所有游戏脚本之后加载（index.html 末尾）。
 * ============================================================ */
(function () {
  'use strict';
  var touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  if (!touchCapable) return;

  var start = null;
  var lastTrustedClick = 0;
  var CLICK_WAIT = 420;
  var TAP_SLOP = 14;
  var TAP_TIME = 900;

  function now() { return Date.now(); }

  /** 这一层（或它的祖先）是不是“只展示、必须让点击穿透”的装饰层。
   *  用显式类名而不是只看计算后的 pointer-events：iOS 15 上父级的 none 可能没有
   *  继承进 SVG，计算值会骗人。 */
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

  /** 触摸点下第一层真正可交互的元素：跳过 click-through 装饰层与
   *  pointer-events:none 的命中层（透明热区自己不该接点击）。 */
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

  /** 直接问经典界面的 SVG 路由“这个点归谁”，然后在该元件的 <g> 上补一发 click。
   *  这条路不依赖原生 click 是否落在 SVG/是否被引导层吃掉，也不依赖 CTM：
   *  路由现在用 getBoundingClientRect + elementFromPoint 判定。 */
  function activateSvgAt(x, y) {
    var T = window.SfUiMain && window.SfUiMain.toolkit;
    if (!T || !T.routerOf) return false;
    var stack = elementStack(x, y);
    var seen = [];
    for (var i = 0; i < stack.length; i++) {
      var n = stack[i];
      if (!n || clickThrough(n)) continue;
      var svg = n.ownerSVGElement || ((n.tagName || '').toLowerCase() === 'svg' ? n : null);
      if (!svg || clickThrough(svg) || seen.indexOf(svg) >= 0) continue;
      seen.push(svg);
      var r = null;
      try { r = svg.__sfRouter || T.routerOf(svg); } catch (e) { r = null; }
      if (!r || !r.hit) continue;
      var owner = null;
      try { owner = r.hit(x, y); } catch (e) { owner = null; }
      if (owner && owner.clip && owner.clip.g) {
        /* 直接点在元件 <g> 上，不要再让 svg 路由把同一发 click 处理第二遍
         * （按钮自己的 click 监听一般会 stopPropagation，这里再上一道保险）。 */
        synthOn(owner.clip.g, x, y, true);
        return true;
      }
    }
    return false;
  }

  /** 触摸点上的控件。元素层拿不到可交互目标时，再在 #ui 里按矩形找一遍控件
   *  （取 DOM 顺序靠后的，通常更靠上层）。 */
  function targetAt(x, y) {
    var el = hitAt(x, y);
    if (!el) return null;
    /* 已经在 SVG 里（经典界面）：click 会冒泡到 svg 路由，直接用它。 */
    if (el.ownerSVGElement || (el.tagName || '').toLowerCase() === 'svg') return el;
    var clickable = null;
    try {
      clickable = el.closest && el.closest(
        'button,input,a,[role="button"],.uc-button,.uc-tab,.picture-button,.challenger,.village-door'
      );
    } catch (e) {}
    if (clickable) return clickable;

    var ui = document.getElementById('ui');
    if (!ui) return el;
    var nodes = ui.querySelectorAll(
      'button,input,a,[role="button"],.uc-button,.uc-tab,.picture-button,.challenger,.village-door,.home-menu button'
    );
    for (var i = nodes.length - 1; i >= 0; i--) {
      var r = nodes[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && visible(nodes[i])) return nodes[i];
    }
    /* 经典界面整页是 SVG：如果元素层只给了 canvas/遮罩，就找覆盖触摸点的 svg。 */
    var svgs = ui.querySelectorAll('svg');
    for (var j = svgs.length - 1; j >= 0; j--) {
      if (clickThrough(svgs[j])) continue;
      var sr = svgs[j].getBoundingClientRect();
      if (x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom && visible(svgs[j])) return svgs[j];
    }
    return el;
  }

  function synthOn(el, x, y, noRouter) {
    if (!el) return false;
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
      if (noRouter) ev.__sfSynth = true;
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
    if (!e.touches || e.touches.length !== 1) { start = null; return; }
    var t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, t: now() };
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
    start = null;
    if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP || dt > TAP_TIME) return;

    var began = now();
    setTimeout(function () {
      /* 原生 click 已经来了（通常 touchend 后 0~50ms），不要重复触发。 */
      if (lastTrustedClick && lastTrustedClick >= began) return;
      synthClick(x, y);
    }, CLICK_WAIT);
  }, { capture: true, passive: true });

  document.addEventListener('click', function (e) {
    if (!e.isTrusted) return;
    lastTrustedClick = now();
    /* 原生 click 被装饰层吃掉：按触点转发给下面真正的控件（正常浏览器不会走到这里，
     * 因为 pointer-events:none 根本不会让装饰层成为 click target）。 */
    if (!clickThrough(e.target)) return;
    if (activateSvgAt(e.clientX, e.clientY)) return;
    synthOn(targetAt(e.clientX, e.clientY), e.clientX, e.clientY);
  }, true);
})();
