/* ============================================================
 * js/touch-fallback.js —— iOS 老版本 WKWebView 的触摸兜底
 *
 * 背景：iOS 15.x 的 WKWebView 在部分场景下不会把一次轻点合成为 click
 * （尤其页面在 html/body 上声明了 touch-action、或控件在 transform/SVG 里时），
 * 表现就是“画面能开、按钮完全点不动”。这里不改变正常浏览器的行为：
 *   · 只监听触摸设备；
 *   · 先等原生 click 420ms；真 click 到了就不补发；
 *   · 没等到才在触摸点找到控件，补发一个 detail=0 的 click。
 *   · **新的 touchstart 会作废上一拍还没到点的兜底**：安卓 Chromium 会把间隔 < ~300ms
 *     的两下轻点当成双击手势，第一下的原生 click 根本不来；旧代码等满 420ms 再补发
 *     旧坐标的 click，此时第二下已经结束、页面可能已换掉，第二下的 click 就会落到
 *     新页面同一坐标上（实测「道具→状态」最后停在背包）。双击按双击处理，兜底不插手。
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
  /* 这一拍触摸的序号。新的 touchstart 会把它 +1，上一拍还没到点的 420ms 兜底立刻作废。
   * 为什么必须有：安卓 Chromium 在「两下轻点间隔 < ~300ms」时会把它当成双击手势，
   * **第一下的原生 click 根本不会派发**；旧代码的兜底等满 420ms 后补发第一下的 click，
   * 此时第二下已经结束、页面可能已经换掉 —— 第二下的 click 就落到新页面同一坐标上
   * （实测：点「道具」再点「状态」，最后停在背包）。双击就该按双击处理，不由兜底插手。 */
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
    /* 直接点在元件 <g> 上，不要再让 svg 路由把同一发 click 处理第二遍
     * （按钮自己的 click 监听一般会 stopPropagation，这里再上一道保险）。 */
    synthOn(clip.g, x, y);
    return true;
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
    /* 经典界面整页是 SVG：如果元素层只给了 canvas/遮罩，就找覆盖触摸点的 svg。 */
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
      /* 兜底补发的 click 一律打标记：路由器据此避免重复处理，换页输入锁也只吞
       * 「真实轻点 / 兜底补发」这两种，程序化 `.click()`（自检与自动流程）照常放行。 */
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
    /* 先作废上一拍未到点的兜底：这一下可能是双击的第二下（原生 click 会由浏览器给），
     * 也可能用户已经改变了主意；都不该再由上一拍的旧坐标补发 click。 */
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
      /* 这一拍之后又按了新的触摸：交给新那一下的原生 click / 双击手势，不再补发。 */
      if (mine !== tapId) return;
      if (suspended() || now() - began > CLICK_WAIT + 500 || !sameScene(oldScene)) return;
      if (!anchor || anchor.isConnected === false || disabled(target)) return;
      var current = targetAt(x, y);
      if (!current || (current.ownerSVGElement || current) !== anchor) return;
      var currentClip = svgClipAt(x, y);
      if ((svgClip || currentClip) && (!svgClip || currentClip !== svgClip || !svgClip.g || svgClip.g.isConnected === false)) return;
      /* 原生 click 已经来了（通常 touchend 后 0~50ms），不要重复触发。
       * `__sfTrustedClickAt` 是换页输入锁吞掉可信 click 时留下的时间戳：那一下没有
       * 走到这里（document 捕获被 stopImmediatePropagation 截住），但同样不该补发。 */
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
    /* 原生 click 被装饰层吃掉：按触点转发给下面真正的控件（正常浏览器不会走到这里，
     * 因为 pointer-events:none 根本不会让装饰层成为 click target）。 */
    if (!clickThrough(e.target)) return;
    if (activateSvgAt(e.clientX, e.clientY)) return;
    synthOn(targetAt(e.clientX, e.clientY), e.clientX, e.clientY);
  }, true);
})();
