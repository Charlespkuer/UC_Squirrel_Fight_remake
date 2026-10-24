/* ============================================================
 * main.js — 启动引导、主界面场景、战斗调度
 * ============================================================ */

/* ------------------------------------------------------------
 * 目录：启动引导 / 主界面场景 / 战斗调度
 * Ctrl+F 搜节号（如「【MN1】」）直达对应代码块。
 *
 *  【MN1】启动与画布  【MN2】音频  【MN3】素材加载
 *  【MN4】战斗观察模式  【MN5】自检模式  【MN6】标题画面
 *  【MN7】主界面场景  【MN8】战斗调度  【MN9】支持作者 / 打开外部链接  【MN10】导出 window.Main
 * ------------------------------------------------------------ */
(function () {
  'use strict';

  /* 安卓 WebView 对 HTML `paint-order: stroke fill` 只认第一个值（计算值会退化成
   * `stroke`），描边会盖在字芯上；`css/classic.css` 里的 `html.is-android` 分支改用
   * 八向 text-shadow 描边。这里尽早打标记，避免首屏按钮先按桌面规则画一遍。 */
  try {
    if (window.navigator && /Android/i.test(window.navigator.userAgent || '')) {
      document.documentElement.classList.add('is-android');
    }
  } catch (e) {}

  /* ============================================================
   * 【MN1】启动与画布（尺寸适配/输入）
   * ============================================================ */
  const $ = (s) => document.querySelector(s);
  const canvas = $('#stage');
  const ctx = canvas.getContext('2d');
  const W = 1170, H = 690;
  canvas.width = W; canvas.height = H;

  let mode = 'loading'; // loading | title | home | battle
  let mainPlayer = Engine.makePlayer();
  let rafId = null;
  let bgm = null, fightBgm = null;
  let mainBg = null, mainBgSoft = false;
  /* 经典模式用的首页底图：**2011 原版那 320×196 的扁平村庄底图**（ssfight.swf 内嵌位图）。
   * 加载的是 4× AI 超分版（1280×784）；原图不是矢量，1x 只作加载兜底 ——
   * 见 docs/经典模式-可行性.md §3.2 / §8。 */
  let mainBgSsfight = null;
  const HOME_BG_BLUR = 1.1;

  /** 主界面背景：等比铺满 1170×690，可加轻微虚化与淡化作纱。
   *  现代模式的 main.jpg 细节很密，HUD 与角色压上去会互相抢，所以默认轻微虚化 + 提亮；
   *  经典模式用原版底图，按「原图锐利」处理（见 homeBgBlur）。
   *  **静态层缓存**：虚化 + 白纱是纯静态的，以前每帧都在主画布上重做一次 canvas blur；
   *  现在按「尺寸 + 底图 + 虚化强度」缓存到离屏 canvas，主循环只 `drawImage` 一次。 */
  let homeBgCache = null, homeBgCacheKey = '';
  function paintHomeBg(c, bg, blur) {
    const scale = Math.max(W / bg.width, H / bg.height);
    const dw = bg.width * scale, dh = bg.height * scale;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    c.save();
    if (blur) c.filter = 'blur(' + blur + 'px)';
    c.drawImage(bg, ox, oy, dw, dh);
    if (blur) c.filter = 'none';
    if (blur) {
      // 淡化作纱：只压很薄一层，底图细节尽量保留
      c.fillStyle = 'rgba(255,250,236,0.09)';
      c.fillRect(0, 0, W, H);
      const g = c.createLinearGradient(0, H * 0.62, 0, H);
      g.addColorStop(0, 'rgba(40,60,35,0)');
      g.addColorStop(1, 'rgba(30,48,28,0.11)');
      c.fillStyle = g;
      c.fillRect(0, H * 0.62, W, H * 0.38);
    }
    c.restore();
  }
  function drawHomeBg(ctx, blur) {
    const bg = homeBgImage();
    if (!bg) { ctx.fillStyle = '#3d6b35'; ctx.fillRect(0, 0, W, H); return; }
    if (typeof document !== 'undefined' && document.createElement) {
      if (!homeBgCache) homeBgCache = document.createElement('canvas');
      const key = W + 'x' + H + '|' + blur + '|' + (bg.src || '') + '|' + (bg.naturalWidth || 0);
      if (homeBgCacheKey !== key) {
        homeBgCache.width = W; homeBgCache.height = H;
        paintHomeBg(homeBgCache.getContext('2d'), bg, blur);
        homeBgCacheKey = key;
      }
      ctx.drawImage(homeBgCache, 0, 0);
      return;
    }
    paintHomeBg(ctx, bg, blur);
  }
  /** 现在是不是「经典」界面模式（读存档；存档还没载入时按当前偏好，默认经典）。 */
  function uiModeIsClassic() {
    try {
      if (!window.State || !State.settings) return true;
      if (!State.state()) {
        return window.UI && UI.currentUiMode ? UI.currentUiMode() === 'classic' : true;
      }
      return State.settings().uiMode === 'classic';
    } catch (e) { return true; }
  }
  /**
   * 经典模式下村庄页由**原版导出数据**渲染成 SVG（`js/ssfight/`），canvas 不再画首页场景。
   * 判据用 DOM 上的 `.ssfight-home`：只有真的挂上了，才放心跳过 canvas 绘制。
   */
  function ssfightHomeActive() {
    return uiModeIsClassic() && !!window.SfUiMain && !!document.querySelector('.ssfight-home');
  }
  /**
   * 首页用哪张底图：
   *   · 现代模式 = 现在的写实重绘（`main.jpg`，安卓客户端素材）；
   *   · 经典模式 = **2011 原版那 320×196 的扁平村庄底图**（ssfight.swf 内嵌位图）。
   * 两张都在启动时预载，所以热切换不用重新加载。
   */
  function homeBgImage() {
    if (uiModeIsClassic() && mainBgSsfight) return mainBgSsfight;
    return mainBg;
  }
  /** 首页背景的虚化强度。**经典模式按原版「原图锐利」处理**（虚化与白纱一起关掉，
   *  见 docs/经典模式-可行性.md §4.1 #1）；现代模式保持现在的轻微虚化 + 提亮。 */
  function homeBgBlur() {
    if (uiModeIsClassic()) return 0;
    return mainBgSoft ? HOME_BG_BLUR : 0;
  }
  let homeT = 0;
  let muted = localStorage.getItem('ssdz_music_muted') === '1';
  let activeBattle = null;

  function fitCanvas() {
    // 页面高度由展示层决定：复刻的菜单页是 920:560 → 712.174，战斗/首页 canvas 是 690。
    // 经典模式的村庄页是原版 320×196 整页 → 716.625（见 UI.layoutHeight）。
    const layoutHeight = (window.UI && UI.layoutHeight) ? UI.layoutHeight(W, H)
      : ($('#ui .classic-page') ? W * 560 / 920 : H);
    // 用 documentElement.clientWidth/Height：它们**不含**滚动条占的位置，
    // 而 window.innerWidth/Height 含。Windows 的滚动条占位会让 innerWidth 在
    // 「弹窗出现/消失」时变化，导致整屏缩放跳一下；macOS 的覆盖式滚动条不占位，
    // 所以在 mac 上看不出来 —— 这里统一按不含滚动条的尺寸算，两个平台就一致了。
    const de = document.documentElement || {};
    const vw = Math.max(1, de.clientWidth || window.innerWidth || W);
    const vh = Math.max(1, de.clientHeight || window.innerHeight || layoutHeight);
    const st = settingsSnapshot();
    let sx, sy;
    if (st.fullscreen) {
      // 全面屏：两轴各自铺满窗口，不留黑边（窗口比例和 1170:690 差得多时会有轻微拉伸）
      sx = vw / W; sy = vh / layoutHeight;
    } else {
      // 分辨率：按选定档位等比放大，但不超过窗口能容纳的尺寸（不会溢出）；自动档就是铺满能容纳的最大等比尺寸
      const fit = Math.min(vw / W, vh / layoutHeight);
      const target = (window.State && State.resolutionHeight) ? State.resolutionHeight(st.resolution) : 0;
      sx = sy = target ? Math.min(fit, target / layoutHeight) : fit;
    }
    canvas.style.width = W * sx + 'px';
    canvas.style.height = H * sy + 'px';
    const ui = $('#ui');
    ui.style.width = W + 'px';
    /* 容器高度必须和 layoutHeight 用**同一个数**：整屏缩放是按 layoutHeight 算的，
     * 而 #ui 原来恒为 690。经典村庄页是原版 320×196 整页（716.625），装进 690 的盒子后
     * SVG 只能按高度铺满 → 左右各白给 21px 黑边，外面又因为缩放比不一致再白给上下两条。
     * 两处都是纯浪费，这里让盒子跟着走（只影响 ssflight 村庄页，其它屏照旧 690）。 */
    const tightHome = !!(window.SfUiMain && document.querySelector('.ssfight-home'));
    ui.style.height = (tightHome ? layoutHeight : H) + 'px';
    ui.style.transform = 'scale(' + sx + ',' + sy + ')';
    ui.style.setProperty('--uiscale', Math.min(sx, sy));
    ui.style.fontSize = (16 * Math.min(sx, sy)) + 'px';
    // 位图数字按设计尺寸逐字绘制，缩放变化后需要按新比例重画一次。
    if (window.UI && UI.renderNumbers) UI.renderNumbers();
    // 标题页是静态的（不再跑 rAF 循环）：窗口尺寸变化时补画一次背景。
    if (mode === 'title') { try { drawHomeBg(ctx, homeBgBlur()); } catch (e) {} }
  }
  window.addEventListener('resize', fitCanvas);

  /** 存档里的本机偏好（音量/静音/分辨率/全面屏）；存档还没载入时用 localStorage 兜底。 */
  function settingsSnapshot() {
    try {
      if (window.State && State.settings && State.state && State.state()) return State.settings();
    } catch (e) {}
    return {
      volume: clampVolume(localStorage.getItem('ssdz_music_volume')),
      muted: localStorage.getItem('ssdz_music_muted') === '1',
      resolution: 'auto',
      fullscreen: false,
      hideStatusBar: true,
    };
  }
  /** 把偏好写回存档：换浏览器/换机器（含双机同步）后设置还在。 */
  function persistSettings(patch) {
    if (patch && patch.volume != null) localStorage.setItem('ssdz_music_volume', String(patch.volume));
    if (patch && patch.muted != null) localStorage.setItem('ssdz_music_muted', patch.muted ? '1' : '0');
    try {
      if (window.State && State.setSettings && State.state && State.state()) { State.setSettings(patch); return true; }
    } catch (e) {}
    return false;
  }
  /** 安卓沉浸模式：只调原生壳；桌面/浏览器没有 SSDZAndroid 桥就当无操作。
   *  原生桥可能比设置晚注入，所以启动、切回前台、改设置都重新调一次。 */
  function applySystemBars() {
    let hide = true;
    try { hide = settingsSnapshot().hideStatusBar !== false; } catch (e) {}
    try {
      const bridge = window.SSDZAndroid;
      if (bridge && typeof bridge.setSystemBarsHidden === 'function') {
        bridge.setSystemBarsHidden(hide ? '1' : '0');
      }
    } catch (e) {}
    return hide;
  }
  /** 设置页的「状态栏」开关。 */
  function setHideStatusBar(on) {
    persistSettings({ hideStatusBar: on !== false });
    applySystemBars();
    setTimeout(fitCanvas, 0);
    return on !== false;
  }
  /** 存档载入后把偏好接过来：存档优先，并回写 localStorage 供下次启动（标题画面）用。
   *  **偏好没变就直接返回**：以前每次 `showHome()` 都要写 3 次 localStorage + `fitCanvas`、
   *  再被 `showHome` 里的第二次 `fitCanvas` 叠一遍；现在只有读档 / 切档 / 改设置才重跑。 */
  let appliedSettingsSig = '';
  function applyStoredSettings(force) {
    try {
      if (!window.State || !State.settings || !State.state || !State.state()) return;
      const st = State.settings();
      applySystemBars();
      const sig = [st.volume, st.muted === true, st.uiMode, st.resolution, st.fullscreen === true, st.hideStatusBar !== false].join('|');
      if (!force && sig === appliedSettingsSig) return;
      appliedSettingsSig = sig;
      volume = clampVolume(st.volume);
      muted = st.muted === true || volume <= 0;
      localStorage.setItem('ssdz_music_volume', String(volume));
      localStorage.setItem('ssdz_music_muted', muted ? '1' : '0');
      applyVolume();
      /* 界面模式：存档载入后以存档为准再落一次 <html data-ui-mode>
       * （classic-ui.js 启动时用的是 localStorage 兜底值）。 */
      if (window.UI && UI.applyUiMode) UI.applyUiMode(st.uiMode);
      try { if (window.Debug && Debug.refresh) Debug.refresh(); } catch (e) {}
      fitCanvas();
    } catch (e) {}
  }
  /** 全面屏开关：请求真全屏（浏览器与桌面外壳都支持），失败就只做画面铺满。 */
  function setFullscreen(on) {
    persistSettings({ fullscreen: !!on });
    try {
      const el = document.documentElement;
      if (on) {
        if (!document.fullscreenElement && el.requestFullscreen) {
          const r = el.requestFullscreen();
          if (r && typeof r.catch === 'function') r.catch(() => {});
        }
      } else if (document.fullscreenElement && document.exitFullscreen) {
        const r = document.exitFullscreen();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      }
    } catch (e) {}
    fitCanvas();
    return !!on;
  }
  /** 分辨率档位：'auto' 或 RESOLUTIONS 里的 key。 */
  function setResolution(key) {
    persistSettings({ resolution: String(key) });
    fitCanvas();
    return String(key);
  }
  // 进出系统全屏（含按 Esc）后重新算一次缩放；精简 DOM 环境（自检脚本）里没有这个 API
  if (document.addEventListener) document.addEventListener('fullscreenchange', () => fitCanvas());

  /* ============================================================
   * 【MN2】音频（BGM 音量调节）
   * ============================================================ */
  // ---------- 音频：BGM 音量可连续调节 ----------
  const BASE_VOLUME = 0.35;
  function clampVolume(v) {
    const n = Number(v);
    return Number.isFinite(n) && v !== null && v !== '' ? Math.max(0, Math.min(1, n)) : 1;
  }
  let volume = clampVolume(localStorage.getItem('ssdz_music_volume'));
  /** 0~1 的滑块音量：0 等同静音。 */
  function volumeValue() { return volume; }
  function setVolume(value) {
    volume = clampVolume(value);
    // 静音标记只在滑块归零或恢复时同步，避免两套状态互相覆盖
    if (volume <= 0) muted = true;
    else if (muted) muted = false;
    persistSettings({ volume: volume, muted: muted });
    applyVolume();
    return volume;
  }
  function applyVolume() {
    if (bgm) bgm.volume = BASE_VOLUME * volume;
    if (fightBgm) fightBgm.volume = BASE_VOLUME * volume;
  }

  function playBgm(which) {
    /* 已经切到后台（安卓按 Home / 浏览器切标签页）时不许再起播：
     * 任何一个界面动作都可能顺手调 playBgm，而后台播放正是玩家投诉的那件事。 */
    if (bgSuspended) return;
    if (muted || volume <= 0) { if (bgm) bgm.pause(); if (fightBgm) fightBgm.pause(); return; }
    try {
      let audio;
      if (which === 'main') {
        if (!bgm) { bgm = new Audio('audio/main_bg.mp3'); bgm.loop = true; bgm.volume = BASE_VOLUME * volume; }
        applyVolume();
        if (fightBgm) fightBgm.pause();
        audio = bgm;
      } else {
        if (!fightBgm) { fightBgm = new Audio('audio/fight_bg.mp3'); fightBgm.loop = true; fightBgm.volume = BASE_VOLUME * volume; }
        applyVolume();
        if (bgm) bgm.pause();
        audio = fightBgm;
      }
      const started = audio.play();
      // 浏览器可能因为「没有用户手势」拒绝自动播放：被拒时挂一次性监听，在第一次点击/按键时补播
      if (started && typeof started.catch === 'function') {
        started.then(() => setAudioBlocked(false)).catch(armAudioUnlock);
      }
    } catch (e) {}
  }
  /** 自动播放被拦下时在页面上提示「点一下开启音乐」；能播了就收起提示。 */
  let audioBlocked = false;
  /* ============================================================
   * 切后台冻结：音乐 + 游戏进度
   *
   * 安卓 WebView 的 <audio> **不会**跟着应用生命周期走：实测（API 35 模拟器，
   * 见 docs/更新记录.md 2026-10 本批）按 Home 之后 AudioPlaybackConfiguration
   * 仍然是 state:started，`document.hidden` 已经为 true，但没有任何人去 pause 它 ——
   * 于是玩家听到「音乐一直在后台响，除非彻底杀掉这个后台」。
   *
   * 三条路都汇到这两个函数：
   *   · 页面自己收到 visibilitychange（实测安卓 WebView 会发，且只发一次）；
   *   · 安卓壳 MainActivity.onPause / onResume 显式调 `__ssdzEnterBackground` / `__ssdzEnterForeground`；
   *   · 桌面浏览器切标签页（同一套 visibilitychange）。
   * 回到前台时**接着原来的位置继续放**（play() 就是 resume，不是重头开始）。
   * ============================================================ */
  let bgSuspended = false;
  function enterBackground() {
    if (bgSuspended) return;
    bgSuspended = true;
    try { if (bgm) bgm.pause(); } catch (e) {}
    try { if (fightBgm) fightBgm.pause(); } catch (e) {}
  }
  function enterForeground() {
    if (!bgSuspended) return;
    bgSuspended = false;
    applySystemBars();          // 回前台时原生壳可能重建过系统栏状态，重新落一次
    playBgm(mode === 'battle' ? 'fight' : 'main');
  }
  try {
    window.__ssdzEnterBackground = enterBackground;
    window.__ssdzEnterForeground = enterForeground;
    window.__ssdzIsBackgrounded = () => bgSuspended;
    if (document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') enterBackground(); else enterForeground();
      });
    }
  } catch (e) {}
  function setAudioBlocked(on) {
    if (audioBlocked === !!on) return;
    audioBlocked = !!on;
    document.body.classList.toggle('audio-blocked', audioBlocked);
    let hint = document.getElementById('audio-hint');
    if (audioBlocked && !hint) {
      hint = document.createElement('div');
      hint.id = 'audio-hint';
      hint.className = 'audio-hint';
      hint.setAttribute('role', 'status');
      hint.innerHTML = '<span aria-hidden="true">♪</span>点击画面任意处开启音乐';
      document.body.appendChild(hint);
    }
  }
  /** 自动播放被拦截时，等第一次用户交互再补播当前场景的 BGM（只挂一次）。 */
  let audioUnlockArmed = false;
  function armAudioUnlock() {
    setAudioBlocked(true);
    if (audioUnlockArmed) return;
    audioUnlockArmed = true;
    const events = ['pointerdown', 'keydown', 'touchstart'];
    const retry = () => {
      audioUnlockArmed = false;
      for (const name of events) window.removeEventListener(name, retry, true);
      playBgm(mode === 'battle' ? 'fight' : 'main');
    };
    for (const name of events) window.addEventListener(name, retry, true);
  }

  /* ============================================================
   * 【MN3】素材加载
   * ============================================================ */
  // ---------- 加载 ----------
  function drawLoading(pct, note) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#22303a';
    ctx.fillRect(0, 0, W, H);
    const sh = Engine.SHEETS['loadingp'];
    if (sh) {
      const w = 640, h = 640 * (sh.img.height / sh.img.width);
      ctx.drawImage(sh.img, (W - w) / 2, (H - h) / 2 - 40, w, h);
    } else {
      ctx.fillStyle = '#2d1f10';
      ctx.fillRect(0, 0, W, H);
    }
    // 进度条（原版 tanchutiao 素材）
    const bx = W / 2 - 250, by = H - 110, bw = 500, bh = 34;
    const bar = Engine.SHEETS['tanchutiao'];
    if (bar && bar.frames['0']) {
      const f = bar.frames['0'];
      ctx.drawImage(bar.img, f.sx, f.sy, f.sw, f.sh, bx, by, bw, bh);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(bx, by, bw, bh);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(bx + 4, by + 4, (bw - 8) * pct, bh - 8); ctx.clip();
    ctx.fillStyle = '#f5a623'; ctx.fillRect(bx + 4, by + 4, bw - 8, bh - 8);
    ctx.restore();
    Engine.text(ctx, note || '正在加载素材…', W / 2, by - 22, { size: 24, align: 'center', color: '#ffe066' });
    Engine.text(ctx, Math.round(pct * 100) + '%', W / 2, by + bh + 34, { size: 22, align: 'center', color: '#fff' });
  }

  /* 现代 canvas 战斗（`js/battle.js`）要用的特效/场景图集。
   * **不再放在启动主链路里等**：这批 80 多张图约 27 MB，以前启动会 `race(battleLoad, 2500ms)`，
   * 素材一多、磁盘一慢，首屏就白等最多 2.5 秒；而经典界面根本不用它们
   *（经典战斗是 `SfFight` 的 SVG 时间轴，见 `ui-fight.js`）。
   * 现在：经典模式直接跳过；现代模式等首页挂完、空闲下来再补拉，
   * 真开打时 `battle.js` 仍会 await 自己那份（引擎复用 in-flight 请求）。 */
  const BATTLE_SHEETS = Object.freeze(['effectCommonAttack', 'weaponEffect', 'throwEffect', 'win_effect', 'die', 'runAround',
    'hurtRunBack', 'beatBack', 'think', 'hitMe',
    'skill_6', 'skill_7', 'skill_8', 'skill_9', 'skill_13', 'skill_14', 'skill_15', 'skill_16_1', 'skill_16_2',
    'skill_17', 'skill_18', 'skill_23', 'skill_8_d', 'skill_9_d', 'skill_15_d', 'skill_18_d_1', 'skill_18_d_2',
    'tl', 'tl_effect', 'xh1', 'xh2', 'xh_effect1', 'xh_effect2', 'xm1', 'xm2', 'xm_effect',
    'woodman1', 'woodman2', 'woodman_effect',
    'lightning1', 'lightning2', 'lightning3', 'lightning4', 'lightning5',
    'fightBg', 'fightBack', 'fightMid', 'fightFront',
    'fightBg_robot_mid', 'fightBg_robot_front', 'fightBg_robot_effect',
    'fightBg_meltRoom_front', 'fightBg_meltRoom_effect',
    'fightBg_wood_1', 'fightBg_wood_3', 'fightBg_wood_4', 'fightBg_wood_effect2', 'fightBg_wood_effect6',
    'fightBg_seaWorld_front', 'fightBg_seaWorld_effect']);
  const BATTLE_PIN = Object.freeze(['effectCommonAttack', 'weaponEffect', 'throwEffect', 'win_effect', 'die', 'runAround',
    'hurtRunBack', 'beatBack', 'think',
    'skill_6', 'skill_7', 'skill_8', 'skill_8_d', 'skill_9', 'skill_9_d', 'skill_13', 'skill_14', 'skill_15', 'skill_15_d',
    'skill_16_1', 'skill_16_2', 'skill_17', 'skill_18', 'skill_18_d_1', 'skill_18_d_2', 'skill_23',
    'tl', 'tl_effect', 'xh1', 'xh2', 'xh_effect1', 'xh_effect2', 'xm1', 'xm2', 'xm_effect',
    'woodman1', 'woodman2', 'woodman_effect']);
  let battleAssetsPromise = null;
  /** 角色/特效图集必须优先于场景图集，否则同名标签会被场景图元抢走。 */
  function pinBattleAssets() {
    try { Engine.pinSheets(BATTLE_PIN); } catch (e) { return false; }
    return true;
  }
  /** 拉现代战斗图集（幂等）。经典模式不主动调它；切到现代 / 真开打时再拉。 */
  function preloadBattleAssets() {
    if (battleAssetsPromise) return battleAssetsPromise;
    battleAssetsPromise = Engine.loadSheets(BATTLE_SHEETS)
      .then(() => { pinBattleAssets(); return true; })
      .catch(() => false);
    return battleAssetsPromise;
  }
  /** 首页挂好之后再补拉：不和首屏抢磁盘/解码，也不让启动等它。 */
  function scheduleBattleAssets() {
    if (battleAssetsPromise || uiModeIsClassic()) return;
    const start = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      preloadBattleAssets();
    };
    setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 2000 });
      else start();
    }, 600);
  }

  async function boot() {
    const setStatus = (m) => {
      try { document.title = m; } catch (e) {}
      const el = document.getElementById('boot-note');
      if (el) el.textContent = m;
    };
    fitCanvas();
    // 一打开页面就起 BGM，不必等素材加载完或点「开始游戏」（被自动播放策略拦下时会在第一次交互补播）
    playBgm('main');
    drawLoading(0.05, '松鼠大战 · 怀旧复刻版');
    setStatus('加载背景…');
    // 主界面背景：用原版 main.jpg（868×512，比例与原设计空间一致）。
    // 加载失败时退回自绘村庄，保证离线也能显示。
    /* 两张底图并行拉：主图失败才退 village.svg（退回本身要等主图结果，所以放在 then 里）。 */
    const [mainImg, ssfImg] = await Promise.all([
      Engine.loadImage('images/ui/screens/main.jpg').then((img) => img || Engine.loadImage('images/ui/screens/village.svg')),
      Engine.loadImage('images/ssfight/ui/bitmap/3182_0.hd.jpg'),
    ]);
    mainBg = mainImg || null;
    mainBgSoft = !!mainBg && /main\.jpg$/i.test(mainBg.src || '');
    mainBgSsfight = ssfImg || null;
    drawLoading(0.25, '正在加载角色素材…');
    setStatus('加载角色素材…');
    const coreSheets = ['SQ_01', 'SQ_02', 'weaponAttack', 'throwweaponAttack', 'main_e1', 'main_e2', 'main_e3',
      'wuqi', 'wuqi2', 'jineng', 'daoju', 'jinbeidaoju', 'tudi', 'go', 'starter_effect', 'loadingp',
      'fightNum_r', 'fightNum_g', 'fightNum_y', 'tilishuzi', 'energyNum', 'expNum', 'jingyanshuzi', 'num_28', 'num_36',
      'resource_1', 'resource_6', 'resource_13', 'resource_15', 'resource_16', 'resource_3', 'resource_4',
      'resource_5', 'resource_9', 'resource_10', 'resource_11', 'resource_12', 'resource_14', 'resource_2', 'resource_7', 'resource8',
      'new', 'shengbai', 'tanchutiao', 'loadingShadow', 'substarate', 'substarate0', 'draw', 'activity', 'plus', 'minus'];
    /* 只有「首屏 + 首页」这批必须等。战斗图集（BATTLE_SHEETS）不在这里等 ——
     * 经典界面不用它，现代界面等首页挂好后由 `scheduleBattleAssets()` 空闲补拉。 */
    await Engine.loadSheets(coreSheets);
    drawLoading(0.85, '正在加载界面素材…');
    setStatus('加载界面素材…');
    // 角色/特效图集必须优先于场景图集，否则同名标签会被场景图元抢走
    Engine.pinSheets(['SQ_01', 'SQ_02', 'weaponAttack', 'throwweaponAttack']);
    drawLoading(0.95, '准备完成');
    setStatus('松鼠大战 · 怀旧单机版');
    UI.installFavicon();
    await new Promise((r) => setTimeout(r, 150));
    // 存档：主存档永远是游戏目录下的 save/progress.json（本地服务器提供）。
    // **磁盘存档优先**：只要服务器的存档接口能用，就一定读它；
    // 只有读不到文件时才退回浏览器 localStorage，而且必须把原因明明白白摆出来
    // （以前这里是静默回落：一个残留的 1 级浏览器档会让玩家以为存档丢了）。
    let loaded = false;
    /* 95% 守护：`fileLoad()` 走本地 HTTP/文件通道，若启动器/同步服务在返回页面时卡住，
     * 这里会永远停在「准备完成」那一条 95% 进度上。等 4 秒仍没结果就先按本地存档进游戏，
     * 不让玩家卡死在启动屏；迟到的磁盘读如果成功，下次启动会自然接上。 */
    let loadTimedOut = false;
    try {
      const result = await Promise.race([
        State.fileLoad(),
        new Promise((resolve) => setTimeout(() => resolve('__timeout__'), 4000)),
      ]);
      if (result === '__timeout__') loadTimedOut = true;
      else loaded = !!result;
    } catch (e) { loaded = false; }
    if (loadTimedOut) {
      setStatus('存档读取超时，先用本地存档进入…');
      const local = !!(State.hasLocalSave && State.hasLocalSave() && State.load && State.load());
      if (local) showHome(); else showTitle();
      if (UI && UI.toast) UI.toast('磁盘存档读取超时，已先用本地存档进入；连上之后会自动重载。');
      /* 超时**不能**等于放弃：安卓上 Tauri 的 save_* 命令是异步 IPC，桥接慢的时候
       * 一次 fileLoad 就可能超过这 4 秒。以前这里直接 return，既不挂横幅也不重试 ——
       * 于是整局都跑在浏览器兜底档上，退出时自然「没存上」。现在照样进重试循环。 */
      showSaveWarning();
      retryFileSave();
      bootDone = true;
      return;
    }
    /* 浏览器兜底档只在「磁盘上确实没有更高进度」时才允许顶上来。
     * 以前只看 `hasLocalSave()`：iOS 换包/桥接迟到时，浏览器里残留的 1 级档会把
     * 磁盘上几十级的正式档顶掉一次，下一次启动又读回文件 —— 玩家看到的就是
     * 「初始存档与有进度的存档横跳」。现在磁盘档的等级更高时直接不回落。 */
    const bootInfo = State.fileInfo ? (State.fileInfo() || {}) : {};
    const bootLocal = State.localSaveMeta ? State.localSaveMeta() : null;
    const bootLevel = Number(bootInfo.fileLevel) || 0;
    const localSafe = !!bootLocal && (!bootInfo.fileExists
      || bootLocal.level > bootLevel
      || (bootLocal.level === bootLevel && bootLocal.savedAt > (Number(bootInfo.fileAt) || 0) + 1000));
    const fellBack = !loaded && localSafe && !!State.hasLocalSave();
    if (loaded || (fellBack && State.load())) showHome();
    else showTitle();
    if (loaded) {
      /* 正式存档读进来了，但**本机浏览器镜像比文件还新**：说明上一次退出时那次文件写入
       * 没落盘（安卓切后台 → 异步 IPC 被系统回收打断，是这台设备上最常见的一种）。
       * 镜像就是上一次真正的进度，先用它，再立刻补写回文件；
       * 这比「以文件为准」把最后一段进度丢掉要正确得多。
       * 顺序很重要：先比时间，再看等级不低于文件里的那份，最后才 load() 覆盖内存状态。 */
      const local = State.localSaveMeta ? State.localSaveMeta() : null;
      const fileAt = (State.fileInfo() || {}).fileAt || 0;
      const fileLevel = ((State.state() || {}).level) || 1;
      /* 只有「镜像里记的文件 mtime == 文件当前 mtime」才认：说明文件在那次写失败之后
       * 没被任何人改过（包括同步服务/另一台机器/手动导入），镜像就是丢了的那一次进度。
       * base 对不上 → 文件是权威，镜像留给「系统 → 导入存档」处理，绝不自动覆盖。
       * 这样既救回安卓上丢掉的写盘，也不会在双机同步时用本机档盖掉对端。 */
      const mirrorNewer = !!local && local.base != null && Number(local.base) === Number(fileAt)
        && local.savedAt > fileAt + 1500;
      const recovered = mirrorNewer && local.level >= fileLevel && !!(State.load && State.load());
      if (recovered) {
        if (UI && UI.toast) UI.toast('已用本机最后一次自动存档恢复进度（上一次写文件没完成）');
        Promise.resolve(State.fileWriteNow && State.fileWriteNow()).catch(() => {});
      } else if (!!local && local.savedAt > fileAt + 1000 && local.level >= fileLevel) {
        /* 镜像更新、来源不明（base 对不上）：一律留着，交给冲突保护，
         * 别当成残留垃圾删掉。 */
        if (UI && UI.toast) UI.toast('浏览器里还有一份更新的存档，已先保留；要换用它请到「系统 → 导入存档」');
      } else {
        try {
          localStorage.removeItem(State.saveKey);
          localStorage.removeItem(State.saveKey + '_sync');
          localStorage.removeItem(State.saveKey + '_base');
        } catch (e) {}
      }
    } else {
      // 没读到磁盘存档：立刻把原因摆出来，同时后台重试（服务器晚一步起来也能自己恢复）
      showSaveWarning();
      retryFileSave();
    }
    // 首页数字按当前调试设置（数字宽度）重画一次，保证刷新后立即生效
    if (window.UI && UI.renderNumbers) UI.renderNumbers();
    if (/[?&]test=1(?:&|$)/.test(location.search)) runSelfTest();
    if (/[?&]test=2(?:&|$)/.test(location.search)) runBattleLoop();
    bootDone = true;
  }

  /* ============================================================
   * 存档告警与自动重连
   *
   * 触发场景：启动时如果服务器晚了一步、或者页面是被 file:// 打开、
   * 或者端口上蹲着一个没有 /__save 的旧服务器，fileLoad() 就会失败；
   * 此时绝不能静默退回 localStorage 里残留的旧档——必须挂红横幅明示并自动重连。
   *
   * 现在：① 磁盘存档永远是第一优先，读不到才回落，并且立刻在画面顶部
   *       挂一条横幅把原因写清楚（app 窗口里 confirm() 可能被吞掉，
   *       所以这里用页面内元素，不依赖弹窗）；
   *       ② 后台自动重试探测 + 读档，连上就自动重载，回到磁盘存档。
   * ============================================================ */
  let pageHiddenAt = 0;
  let saveBanner = null;

  /** 网页版/PWA：静态托管没有 /__save 是正常模式，不是“本地服务器没开”。
   *  pwa.js 会在网页构建里设 __SSDZ_WEB_MODE__；非 Tauri 的 http(s) 站点也按网页版处理。 */
  function isStaticWebMode() {
    if (window.__SSDZ_WEB_MODE__) return true;
    try {
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
      const host = String(location.hostname || '').toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return false;
      if (host === 'tauri.localhost') return false;
      return true;
    } catch (e) { return false; }
  }

  /** 顶部告警横幅：一直挂着，直到成功连上磁盘存档（或玩家自己关掉）。 */
  function showSaveWarning() {
    if (saveBanner) return saveBanner;
    // 网页版用 localStorage 是设计内的存档方式；系统页会说明，不挂“服务器没开”的错误横幅。
    if (isStaticWebMode()) return null;
    const info = (State.fileInfo && State.fileInfo()) || {};
    const inFile = location.protocol === 'file:';
    /* 原生外壳（桌面安装版 / iOS / Android）：首次运行还没有存档文件是正常的，
     * 路径是应用私有目录（iOS 上是 .../Application Support/com.ssdz.classic/save/progress.json），
     * 没必要把内部路径和「重试连线」挂给玩家看；第一笔存档写成功后文件自然会出现。
     * 轻壳模式（http://127.0.0.1:<端口>）不会设这个标记，仍然保留原来的提示。 */
    if (info.transportReady && !inFile && window.__SSDZ_TAURI_APP__) return null;
    const noApi = Number(info.code) === 404 || /404/.test(String(info.reason || ''));
    let how, color;
    if (info.transportReady && !inFile) {
      // 通道是好的，只是还没有存档文件（首次运行最常见）——不用红色报错吓人，
      // 等第一次保存就会写出文件，这条横幅随后会自己消失。
      color = '#1d5c3a';
      how = '还没有存档文件，第一次保存后就会自动写到这里：' + (info.path || 'save/progress.json') +
        '。现在可以直接开始玩。';
    } else if (inFile) {
      color = '#7a1010';
      how = '页面是 file:// 打开的，浏览器不允许读写存档文件。请关掉本窗口，用启动器重新打开游戏（Windows：双击根目录的 squirrel_fight.exe；macOS：双击 scripts/启动游戏.command）。';
    } else if (noApi) {
      color = '#8a4b00';
      how = '这个服务器没有 /__save 存档接口（多半是 python -m http.server 之类的静态服务器）。请先把它关掉，再用启动器打开（Windows：squirrel_fight.exe；macOS：scripts/启动游戏.command）。';
    } else {
      color = '#7a1010';
      how = '本地游戏服务没连上（多半是启动器还没把服务器拉起来，或者被别的程序占了端口）。请关掉本窗口，用启动器重新打开（Windows：squirrel_fight.exe；macOS：scripts/启动游戏.command）；也可以点上面的「重试连线」。';
    }
    const el = document.createElement('div');
    el.id = 'save-warning';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483000;background:' + color +
      ';color:#fff8ec;font:13px/1.55 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:9px 14px;' +
      'display:flex;gap:10px;align-items:flex-start;box-shadow:0 2px 10px rgba(0,0,0,.35)';
    saveBanner = el;   // 先登记：后面任何一步出错也不会重复挂第二条
    const text = document.createElement('div');
    text.style.cssText = 'flex:1 1 auto';
    const firstRun = !!info.transportReady && !inFile;
    text.innerHTML = (firstRun ? '<b>存档通道正常，还没有存档文件</b><br>' :
      '<b>⚠ 现在用的是浏览器兜底存档，' +
      'save/progress.json（磁盘上的正式存档）没有被读写。</b><br>') +
      '<span style="opacity:.92">' + (firstRun ? '' : '原因：' + esc(info.reason || info.error || '未知') + '<br>') +
      esc(how) + '</span>';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = '重试连线';
    retryBtn.style.cssText = 'flex:0 0 auto;padding:5px 12px;cursor:pointer';
    retryBtn.onclick = async () => {
      retryBtn.textContent = '正在重试…';
      const ok = await State.fileProbe();
      if (ok && await State.fileLoad()) { location.reload(); return; }
      retryBtn.textContent = '重试连线';
      if (UI && UI.toast) UI.toast('还是连不上本地服务器，确认启动器（scripts/启动游戏.cmd 或 squirrel_fight.exe）的窗口没报错后再试');
    };
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '先这样玩';
    closeBtn.style.cssText = 'flex:0 0 auto;padding:5px 12px;cursor:pointer';
    closeBtn.onclick = () => { el.remove(); saveBanner = null; };
    el.appendChild(text); el.appendChild(retryBtn); el.appendChild(closeBtn);
    document.body.appendChild(el);
    return el;
  }
  function hideSaveWarning() { if (saveBanner) { saveBanner.remove(); saveBanner = null; } }
  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /** 页面重新可见：在后台放了很久（比如启动器把它丢在后台才把服务器拉起来），
   *  重新露脸时补一次重试，不用玩家手动刷新。 */
  if (document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { pageHiddenAt = Date.now(); return; }
      const hiddenFor = pageHiddenAt ? Date.now() - pageHiddenAt : 0;
      pageHiddenAt = 0;
      if (hiddenFor > 10000) retryFileSave();
    });
  }

  async function retryFileSave() {
    // 网页版没有 /__save，重试 7 次只会白等；直接按 localStorage 模式运行。
    if (isStaticWebMode()) { hideSaveWarning(); return false; }
    if (State.fileLoadedThisBoot()) { hideSaveWarning(); return true; }
    // 首次运行没有存档文件：只要第一笔存档写成功，这条横幅就该消失
    if (((State.fileInfo() || {}).lastWrite || 0) > 0) { hideSaveWarning(); return true; }
    const delays = [300, 600, 1000, 1500, 2000, 2500, 3000];
    for (let i = 0; i < delays.length; i++) {
      await new Promise((r) => setTimeout(r, delays[i]));
      if (State.fileLoadedThisBoot()) { hideSaveWarning(); return true; }
      if (((State.fileInfo() || {}).lastWrite || 0) > 0) { hideSaveWarning(); return true; }
      try {
        const available = await State.fileProbe();
        if (!available) continue;
        const ok = await State.fileLoad();
        if (ok) { location.reload(); return true; }   // 连上了就以磁盘存档为准，重开一遍
      } catch (e) { /* 下一轮再试 */ }
    }
    if (!State.fileLoadedThisBoot() && !((State.fileInfo() || {}).lastWrite || 0)) showSaveWarning();
    return false;
  }
  /* 启动还没走完（还在拉素材/还没读档）时，桥接就绪只把存档**读进内存**，
   * 绝不 reload：安卓上 tauri-bridge 会在 DOMContentLoaded 与 window load 各问一次
   * `save_path`，于是 ssdz-save-transport-ready 可能连发两次；旧代码每次都走
   * retryFileSave → 读档成功 → location.reload()，新页面又在素材加载阶段收到同一个事件……
   * 实测（模拟器）会变成每 0.8 秒刷一次、启动进度永远停在 25%。 */
  let bootDone = false;
  async function preloadFileSave() {
    try {
      if (!(await State.fileProbe())) return false;
      return !!(await State.fileLoad());
    } catch (e) { return false; }
  }
  /* 部分国产 ROM 的 WebView 会把 Tauri 的全局对象晚十几秒才注入。桥一到就再试一次读写，
   * 不要因为启动时那 7 次重试已经跑完就永远停在“浏览器兜底存档”。 */
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('ssdz-save-transport-ready', function () {
      if (!bootDone) { void preloadFileSave(); return; }
      if (!State.fileLoadedThisBoot() && !((State.fileInfo() || {}).lastWrite || 0)) retryFileSave();
    });
  }

  /* ============================================================
   * 【MN4】战斗观察模式（?test=2）
   * ============================================================ */
  // ---------- 战斗观察模式（?test=2） ----------
  async function runBattleLoop() {
    await new Promise((r) => setTimeout(r, 600));
    State.newGame('观察鼠');
    const S = State.state();
    S.weapons = ['1:5', '6:8', '15:11']; S.skills = ['1:3', '5:2', '8:1'];
    S.power = 20; S.agility = 15; S.speed = 15; S.maxHp = 300;
    showHome();
    const foes = [
      () => State.genAI(3),
      () => Object.assign(State.genAI(5), { npcType: 'tl' }),
      () => Object.assign(State.genAI(8), { npcType: 'xm' }),
      () => Object.assign(State.genAI(6), { npcType: 'xh' }),
    ];
    let i = 0;
    const again = () => {
      const foe = foes[i % foes.length]();
      const region = (i >> 2) % 5;
      i++;
      startBattle(foe, { region: region, onEnd: () => setTimeout(again, 1400) });
    };
    again();
  }

  /* ============================================================
   * 【MN5】自检模式（?test=1）
   * ============================================================ */
  // ---------- 自检模式（?test=1） ----------
  async function runSelfTest() {
    const log = [];
    const ok = (name, cond, extra) => {
      log.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : ''));
      document.title = (log.some((l) => l.startsWith('FAIL')) ? 'TEST FAIL' : 'TEST RUNNING') + ' (' + log.length + ')';
    };
    window.__testlog = log;
    try {
      await new Promise((r) => setTimeout(r, 400));
      State.newGame('测试鼠');
      ok('newGame', State.state().name === '测试鼠' && State.state().level === 1);
      ok('sheets-loaded', Object.keys(Engine.SHEETS).length >= 40, Object.keys(Engine.SHEETS).length + ' sheets');
      showHome();
      await new Promise((r) => setTimeout(r, 700));
      /* 新号默认经典模式：首页是 `SfUiMain.mount()` 异步挂出来的原版 SVG 页，
       * 没有现代模式的 `.home-menu button` / `__homeRegions`。这里两种模式都认，
       * 否则 ?test=1 在默认（经典）档下会假红（2026-10 审计实测）。 */
      for (let i = 0; i < 30 && !document.querySelector('#ui .ssfight-home svg'); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const classicHome = document.querySelector('#ui .ssfight-home svg');
      const regs = window.__homeRegions || [];
      const modernHome = regs.length === 5 && document.querySelectorAll('.home-menu button').length === 5;
      ok('home-render', mode === 'home' && (!!classicHome || modernHome),
        classicHome ? 'classic svg' : 'regions=' + regs.length);
      ok('home-canvas', (() => {
        const c = document.getElementById('stage').getContext('2d');
        const d = c.getImageData(0, 0, W, H).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4 * 211) if (d[i] > 20 || d[i + 1] > 20) n++;
        return n > 200;
      })());
      State.state().weapons = ['1:1']; // Explicit test fixture; ordinary new players learn at level 2.
      const up = State.upgradeInfo('weapon', 1, 1);
      ok('upgradeInfo', up && up.rate > 0, JSON.stringify(up));
      const foe = State.genAI(1);
      const simRes = Sim.simulate(
        { name: 'A', level: 1, power: 8, agility: 8, speed: 8, hp: 50, weapons: [{ id: 1, level: 1 }], skills: [] }, foe);
      ok('simulate', simRes && (simRes.winner === 0 || simRes.winner === 1) && simRes.rounds.length > 0,
        'rounds=' + (simRes && simRes.rounds.length));
      // 转生果：回到 1 级并重置为初始武器与技能（与 NEW_PLAYER 一致）
      const rebornState = State.state();
      const savedWeapons = rebornState.weapons.slice(), savedSkills = rebornState.skills.slice();
      rebornState.level = 20; rebornState.weapons = ['1:5', '6:8', '15:11']; rebornState.skills = ['1:3'];
      rebornState.props[13] = 1;
      const reborn = State.useProp(13);
      const rebornOk = reborn.ok === true
        && JSON.stringify(rebornState.weapons) === JSON.stringify(GData.NEW_PLAYER.weapons)
        && JSON.stringify(rebornState.skills) === JSON.stringify(GData.NEW_PLAYER.skills)
        && rebornState.level === 1
        && !(rebornState.props[13] > 0);
      ok('rebirth-fruit-resets-weapons', rebornOk,
        'weapons=' + JSON.stringify(rebornState.weapons) + ' skills=' + JSON.stringify(rebornState.skills) + ' level=' + rebornState.level);
      rebornState.level = 20; rebornState.weapons = savedWeapons; rebornState.skills = savedSkills;
      const battleDone = new Promise((resolve) => {
        /* `skipChest`：经典模式的原版战斗在战果后会开「四选一宝箱」并**等玩家点**，
         * 自检没人点 → `onEnd` 永远不回调（2026-10 审计实测卡在这里）。
         * 冒烟只看战斗能不能跑完，宝箱流程由 ui-fight 自己的用例覆盖。 */
        Main.startBattle(State.genAI(1), { region: 0, skipChest: true, onEnd: (w, r) => resolve({ w: w, rounds: r.rounds.length }) });
      });
      /* 跳过键在经典模式里是 SVG 节点（而且要等 8.7 MB 的 tags-fight 包挂完才出现），
       * 所以不能只等 2.5 s 点一次；轮询到它出现为止。有 `click` 就点，没有（SVG）
       * 就派发冒泡 click —— 两种渲染器都能接住。 */
      for (let i = 0; i < 60; i++) {
        const skipBtn = document.querySelector('[aria-label="跳过战斗"]');
        if (skipBtn) {
          if (typeof skipBtn.click === 'function') skipBtn.click();
          else skipBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      const res = await Promise.race([battleDone, new Promise((r) => setTimeout(() => r(null), 45000))]);
      ok('battle', !!res, res ? ('winner=' + res.w + ' rounds=' + res.rounds)
        : 'timeout sheets=' + Object.keys(Engine.SHEETS).length + ' errs=' + (window.__errs || []).slice(0, 6).join(';'));
      await new Promise((r) => setTimeout(r, 900));
      ok('back-home', mode === 'home');
      // 逐个菜单面板做渲染冒烟测试（先临时升到 30 级以覆盖天梯赛）
      State.state().level = Math.max(30, State.state().level);
      State.state().integral = 1500;
      const keys = ['challenge', 'stages', 'arena', 'rank', 'weapons', 'skills', 'bag', 'gears', 'shop', 'lottery', 'master', 'help'];
      // 查哪些选择器由展示层给（UI.smokeSelectors）；否则换一套界面实现就没法自检了。
      const smoke = (window.UI && UI.smokeSelectors) ? UI.smokeSelectors()
        : { panel: '#ui .panel, #ui .classic-page, #ui .classic-modal', close: '#ui .panel-close' };
      for (const k of keys) {
        try {
          UI.runAction(k);
          /* 经典页面是异步挂载的（要拉 1~2 MB 的 tags 包），固定等 160 ms 会假红；
           * 轮询到面板出现为止（最多 2 s）。SVG 页没有 textContent 时看有没有 svg。 */
          let panel = null, ready = false;
          for (let i = 0; i < 50; i++) {
            panel = document.querySelector(smoke.panel);
            /* 页面容器可能**先出现、后填内容**（经典挑战页要等 7638 挂完才有字）。
             * 只看容器存在会在 t=0 假红，所以等到"有字或有 SVG"为止。 */
            if (panel && (panel.textContent.length > 10 || !!panel.querySelector('svg'))) { ready = true; break; }
            await new Promise((r) => setTimeout(r, 100));
          }
          ok('panel:' + k, ready);
          const close = document.querySelector(smoke.close);
          if (close) close.click();
          document.querySelectorAll('.classic-modal-overlay').forEach(e => e.remove());
          await new Promise((r) => setTimeout(r, 40));
        } catch (e) { ok('panel:' + k, false, e.message); }
      }
    } catch (e) {
      ok('exception', false, e.message + ' ' + (e.stack || '').split('\n')[1]);
    }
    const fails = log.filter((l) => l.startsWith('FAIL'));
    showHome();
    document.title = fails.length ? ('TEST FAIL x' + fails.length) : 'TEST PASS (' + log.length + ')';
    const div = document.createElement('div');
    div.id = 'test-report';
    div.style.cssText = 'position:absolute;left:8px;top:170px;z-index:99;background:rgba(0,0,0,.78);color:#7f7;font:12px monospace;padding:8px;max-width:560px;white-space:pre-wrap;border-radius:6px';
    div.textContent = log.join('\n');
    document.getElementById('ui').appendChild(div);
  }

  /* ============================================================
   * 【MN6】标题画面
   * ============================================================ */
  // ---------- 标题画面 ----------
  function showTitle() {
    mode = 'title';
    cancelAnimationFrame(rafId);
    // 打开页面就播 BGM（被浏览器自动播放策略拦掉时会在第一次点击/按键时补播）
    playBgm('main');
    const ui = $('#ui');
    ui.innerHTML = `
      <div class="title-screen">
        <div class="title-logo">松鼠大战</div>
        <div class="title-sub">UC乐园 · 熟悉的松鼠回来了</div>
        <img class="classic-portrait" src="images/ui/characters/squirrel-classic.png" alt="经典松鼠">
        <div class="title-form"><input id="name-input" maxlength="12" aria-label="松鼠昵称" placeholder="给你的松鼠起个名字" value="小松鼠">
        <button id="start-btn" class="uc-button gold">开始游戏</button></div>
        <div class="title-tip">怀旧单机版 · 进度自动保存</div>
      </div>`;
    /* 标题页是**静态**的：以前用 rAF 每帧重画同一张底图（titleT 也没人读），
     * 纯空转。现在只画一次；窗口 resize 由 fitCanvas 末尾补画。 */
    drawHomeBg(ctx, homeBgBlur());
    $('#start-btn').onclick = () => {
      const name = $('#name-input').value.trim() || '小松鼠';
      State.newGame(name);
      /* 新号默认经典界面：把新档里的 uiMode 立刻落到 <html>/localStorage，
       * 否则标题画面用的是上一次的兜底值，首屏会先闪现代界面。 */
      try { if (window.UI && UI.applyUiMode) UI.applyUiMode(State.settings().uiMode); } catch (e) {}
      playBgm('main');
      showHome();
    };
    $('#name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#start-btn').click(); });
  }

  /* ============================================================
   * 【MN7】主界面场景（松鼠动作 + HUD）
   * ============================================================ */
  // ---------- 主界面：有松鼠动作的场景 + 原版 HUD ----------
  let homeRegions = [];
  /** 只启动主界面 **canvas 场景**（背景 + 松鼠 + HUD 循环）：不碰 `#ui`、不碰引导。
   *  正常回首页走 `showHome()`（先重建 #ui 里的页面，再调这里）；
   *  `startBattle` 的 `keepScreen` 收尾（随机挑战 / 关卡连战 / 竞技场）也要调它 ——
   *  那一支的页面 DOM 由调用方自己恢复，但 **canvas 必须从战斗终帧切回主界面场景**：
   *  现代模式的挑战页背景是透明的（css/classic.css 的 `.classic-page` 只有顶部条带），
   *  不切的话打完那一眼奖励弹窗下面盖的还是战斗画面（用户 2026-10 报的
   *  "随机挑战战斗结束、弹奖励的时候背景还是战斗画面，应当是主界面"）。 */
  function startHomeScene() {
    mode = 'home';
    playBgm('main');
    /* 经典村庄页是 SVG 覆盖层：canvas 这边不画背景/主角/HUD，也就没必要每帧
     * 更新跑动播放器、做 gears 查询与 bounds 测量（2026-10 审计的首页空转）。 */
    const classicHome = ssfightHomeActive();
    if (!classicHome) buildHomeScene();
    else { mainPlayer = null; homeBgPlayer = null; }
    let last = performance.now();
    cancelAnimationFrame(rafId);
    (function loop(now) {
      if (mode !== 'home') return;
      if (classicHome || ssfightHomeActive()) {
        homeRegions = [];
        window.__homeRegions = homeRegions;
        // The SVG renderer owns this scene. Mode changes and battle returns restart this function.
        rafId = 0;
        return;
      }
      const dt = Math.min(50, now - last); last = now;
      homeT += dt;
      Engine.updatePlayer(mainPlayer, dt);
      if (homeBgPlayer) Engine.updatePlayer(homeBgPlayer, dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      /* 现代模式：背景走离屏缓存，只有主角/HUD 每帧更新。 */
      drawHomeBg(ctx, homeBgBlur());
      if (homeBgPlayer) Engine.drawPlayer(ctx, homeBgPlayer);
      homeRegions = UI.drawHomeHud(ctx, W, H);
      window.__homeRegions = homeRegions;
      rafId = requestAnimationFrame(loop);
    })(performance.now());
  }

  /** 回首页：重建 `#ui` 里的页面（`renderHome()` 会顺带清掉挑战页等覆盖层）＋启动场景。
   *  需要"页面别动"的战斗收尾（`keepScreen`）只调 `startHomeScene()`，不要调它。 */
  function showHome() {
    applyStoredSettings();
    UI.renderHome();
    fitCanvas();
    startHomeScene();
    /* 现代界面：首页已经画出来了，再空闲补拉 canvas 战斗图集；经典界面直接跳过。 */
    scheduleBattleAssets();
    if (window.SfGuide) { try { SfGuide.onHome(); } catch (e) { if (window.__errs) window.__errs.push('SfGuide home: ' + (e && e.message)); } }
  }

  // 主界面点击：命中菜单按钮
  canvas.addEventListener('click', (e) => {
    if (mode !== 'home') return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (W / r.width);
    const y = (e.clientY - r.top) * (H / r.height);
    const key = UI.hitRegion(homeRegions, x, y);
    if (key) UI.runAction(key);
  });

  /** 主界面场景：原版 mainWalk1 循环跑动（88 帧，含翻滚与拖影）。
   *  帧推进交给 Engine 播放器，绘制在 UI.drawHomeHud 的主角盒子里完成。
   *  **播放速度**：原版导出按 22fps 播（一循环 ≈4 秒），实测现代首页里松鼠跑得太赶
   *  （2026-10 用户口径「往返走的动画播慢一点」），降到 14fps（一循环 ≈6.3 秒）。
   *  位移是烘进每帧的偏移量，所以帧慢了、走动也一起慢，不需要另改位置。
   *  需要临时调回快/更慢：`Main.setHomeFps(帧率)`（调试入口）。 */
  const HOME_WALK_FPS = 14;
  function buildHomeScene() {
    mainPlayer = Engine.makePlayer();
    homeBgPlayer = null;
    homeT = 0;
    const SQ = ['SQ_01', 'SQ_02'];
    const walkName = ['mainWalk1', 'mainWalk2', 'mainWalk3'].find((n) => Engine.hasAnim(n)) || 'standby';
    homeWalk = Engine.playAnim(mainPlayer, walkName, { loop: true, fps: HOME_WALK_FPS, layer: 2, sheets: SQ });
    if (Engine.hasAnim(walkName + '_e')) {
      Engine.playAnim(mainPlayer, walkName + '_e', { loop: true, fps: HOME_WALK_FPS, layer: 4, sheets: ['main_e1'] });
    }
  }
  let homeBgPlayer = null, homeWalk = null;

  /* ============================================================
   * 【MN8】战斗调度
   * ============================================================ */
  /** 这一场由谁来播：经典模式 = **原版 fight 帧**（`js/ssfight/ui-fight.js`），
   *  现代模式 = canvas 播放器（`js/battle.js`）。
   *  ⚠ `SfFight` 要用的素材包（`tags-fight.json`，8.4 MB）是**按需加载**的；它自己的
   *    初始加载失败会**向上抛**，这里退回 canvas —— 宁可画面是复刻的，也不能让玩家打不了。 */
  function battleRenderer() {
    try {
      if (window.SfFight && SfFight.ready()
        && UI.currentUiMode && UI.currentUiMode() === 'classic') return SfFight;
    } catch (e) {}
    return Battle;
  }
  /** 跑一场：先试当前模式该走的渲染器，抛错就退回 canvas 再跑一次。
   *  征战动物 boss 在现代模式也借用 SfFight：它们只有经典 6833 矢量素材，
   *  现代 canvas 没有对应图集；`classicFight` 由 startBattle 按 `foe.campaign` 置位。 */
  async function runBattle(opts) {
    const first = opts && opts.classicFight && window.SfFight && SfFight.ready()
      ? SfFight : battleRenderer();
    if (first === Battle) return Battle.run(opts);
    try {
      return await SfFight.run(opts);
    } catch (error) {
      if (window.__errs) window.__errs.push('SfFight: ' + (error && error.message));
      return Battle.run(opts);
    }
  }
  // ---------- 战斗调度 ----------
  async function startBattle(foe, opts) {
    opts = opts || {};
    if (mode === 'battle') return;
    const S = State.state();
    if (opts.cost && !State.consumeEnergy(opts.cost)) { UI.toast('体力不足，无法开始战斗'); return; }
    /* 关卡「徒弟先上阵」：调用方传 `fighter` 时，这一场直接使用徒弟快照作为玩家侧，
     * 不再套玩家自己的装备/套装/幻兽乘区（那些属于师父，不能偷偷帮徒弟加面板）。 */
    const useFighter = !!(opts.fighter && typeof opts.fighter === 'object');
    const stats = useFighter ? null : State.totalStats({ useProps: opts.useProps !== false });
    // hpRatio 是关卡连战的入场血量比例：hp 按比例继承，maxHp 仍是不变的上限。
    const startRatio = opts.hpRatio == null ? 1 : Math.min(1, Math.max(0.01, Number(opts.hpRatio) || 0));
    const me = useFighter ? Object.assign({}, opts.fighter) : (() => {
      const maxHp = Math.max(1, Math.round(stats.hp));
      return {
        name: S.name, level: S.level,
        power: stats.power, agility: stats.agility, speed: stats.speed,
        hp: Math.max(1, Math.round(maxHp * startRatio)), maxHp,
        baseStats: { power: S.power, agility: S.agility, speed: S.speed },
        weapons: State.myWeapons().map((w) => ({ id: w.id, level: w.level, harmLo: w.harmLo, harmHi: w.harmHi })),
        skills: State.mySkills().map((s) => ({ id: s.id, level: s.level })),
        npcType: opts.myNpcType || null,
        wears: Engine.wearsFor(State.myGears().filter(g => g.used)),
        effects: State.equipmentEffects(), masterLevel: S.master ? S.master.level : 0,
      };
    })();
    if (useFighter) {
      me.maxHp = Math.max(1, Math.round(Number(me.maxHp || me.hp) || 1));
      me.hp = Math.max(1, Math.round(Math.min(me.maxHp, Number(me.hp) || me.maxHp) * startRatio));
    } else {
      // 挑战塔等玩法在构建完玩家面板后注入本场的 buff 修正（属性乘区/护盾/吸血等）。
      if (typeof opts.adjustMe === 'function') opts.adjustMe(me);
      /* 套装收益：属性部分已经在 totalStats 里加过，这里只落战斗修正（fighter.setFx）。
       * 放在 adjustMe **之后** —— 塔的 buff 走 mods、套装走 setFx，两包互不覆盖；
       * 也不吃塔的「增幅水晶」全局倍率（那是本局增益的倍率，装备收益不该被它放大）。 */
      State.applySetBonuses(me);
      /* 幻兽出战队伍：先把宠物加成落到玩家面板，再给随机 AI 对手生成 1~3 只幻兽。
       * 都是“开战前一次性”的数值面板，Sim 不需要知道幻兽的存储细节。 */
      try {
        me.pets = State.petTeam ? State.petTeam() : [];
        if (window.State && State.applyPetBonuses) State.applyPetBonuses(me, me.pets);
      } catch (e) { if (window.__errs) window.__errs.push('pet battle: ' + (e && e.message)); }
    }
    try {
      if (foe && foe.isAI && !Array.isArray(foe.pets) && opts.pets !== false && State.randomPetLoadout) {
        foe.pets = State.randomPetLoadout(foe.level);
      }
      if (foe && Array.isArray(foe.pets) && State.applyPetBonuses) State.applyPetBonuses(foe, foe.pets);
    } catch (e) { if (window.__errs) window.__errs.push('pet battle: ' + (e && e.message)); }
    mode = 'battle';
    cancelAnimationFrame(rafId);
    $('#ui').innerHTML = '';
    fitCanvas();
    playBgm('fight');
    if (opts.region != null && foe && foe.region == null) foe.region = opts.region;
    let settled = false;
    /* 这一场走的是不是原版 fight 帧（`SfFight`）。它决定战斗结束后**要不要**再弹复刻那层
     * 「战斗拾取」收益弹窗 —— 见 `onEnd` 末尾那条口径。 */
    const campaignClassic = !!(foe && foe.campaign && window.SfFight && SfFight.ready());
    const classicFight = campaignClassic || battleRenderer() === SfFight;
    const controller = await runBattle({
      classicFight: campaignClassic,
      canvas, me, foe, region: opts.region, kind: opts.kind, collectDrops: opts.collectDrops !== false,
      /* 右下角操作键：跳过 + 倍速，两个都要**等级解锁**（2026-10 用户口径）——
       * 2 倍速 10 级；跳过按超级松鼠页：VIP 10 级 / 非 VIP 20 级。系统页还能单独
       * 关掉跳过键的**显示**（`showSkip`），关闭后这里连按钮都不给。
       * 调用方传 false 仍能单独关掉（例如无尽塔 20 层以下）。
       * 挑战塔 / 无尽塔本身要 30 级才开，所以塔里天然都有（塔的跳过另有「20 层起」的层数门槛）。
       * 普通战斗的倍速上限是 2×（不给 3×），塔自己传 speedMax: 3 才拿得到 3×。 */
      allowSkip: opts.allowSkip !== false && (State.skipButtonEnabled ? State.skipButtonEnabled() : State.unlockedSkip()),
      speedToggle: opts.speedToggle !== false && State.unlockedSpeed(),
      speedMax: Number(opts.speedMax) > 0 ? Number(opts.speedMax) : 2,
      /* 训练木桩等特殊战斗的回合上限（默认 0 = 播放器自己的 60）。只影响 HUD 的剩余
       * 回合数字；真正的收尾由 Sim 的 practiceRounds 决定（见 js/sim.js）。 */
      maxRounds: Number(opts.maxRounds) > 0 ? Math.floor(Number(opts.maxRounds)) : 0,
      // 挑战塔 boss 机制：贴一条进战斗画面（opts.trial = {text}）
      trial: opts.trial,
      // 挑战塔：三侠大招留下的本层削弱（画在玩家血条下方）
      debuffs: opts.debuffs,
      dropRandom: (window.QA_FIXTURE && QA_FIXTURE.dropRandom) || opts.dropRandom,
      /* 挑战页在战果页出现前算经验/金松果（`State.fightReward`），让第一张战果页就能
       * 写全"经验 + 金松果 + 悬浮物品"；算过的结果由调用方缓存，`onEnd` 不重复发。 */
      rewardFor: opts.rewardFor,
      /* 调用方随后会自己摆战果页（原版 `fight` 第 2/3 帧）时，跳过局内那次 1.5 s 的
       * 战果页，避免同一份"经验 + 金松果"在开宝箱前后各闪一次。 */
      skipResultPanel: opts.skipResultPanel === true,
      hideVictoryCg: opts.hideVictoryCg === true,
      /* 竞技场 / 天梯 / 关卡连战**不发宝箱**（用户 2026-11 口径）：这些是连续挑战，
       * 奖励走各自的结算；随机挑战仍保留开宝箱。 */
      skipChest: opts.skipChest === true,
      onEnd: (winner, result, loot, reward) => {
        if (settled) return;
        settled = true;
        activeBattle = null;
        /* 切了档：这一场作废，回首页（原行为）。
         * ⚠ 顺序不能反：`State.state() !== S` 时**绝不能**去调 `opts.onEnd`，
         * 那个回调写的是旧档的结算。 */
        if (State.state() !== S) { showHome(); return; }
        State.recordBattle({ me, foe, result, region: opts.region != null ? opts.region : foe.region || 0, kind: opts.kind || 'challenge' });
        playBgm('main');
        /* ⚠ `keepScreen`：经典模式的**连战 / 竞技场**要"打完直接回原来那一页"。
         * 默认这条 `showHome()` 会先把 `#ui` 换成经典首页（并在 `renderHome()` 里
         * `SfChallenge.destroy()`），调用方的 `onEnd` 再想回挑战页就晚了 ——
         * 用户 2026-10 报的"关卡连战间隙会跳回现代界面 / 竞技场开始竞技也跳回现代界面"
         * 就是这个顺序造成的。传 `keepScreen: true` 时这里不换页，由调用方自己恢复。
         * ⚠⚠ 但**模式必须自己拨回 `home`**：`mode` 只在 `showHome()` 里被重置，
         *   而这一支恰恰不调 `showHome()` —— 于是打完一场之后 `mode` 永远停在 `'battle'`，
         *   下一场 `startBattle` 第一行的 `if (mode === 'battle') return;` 直接**静默返回**：
         *   关卡连战第二场"点了没反应"（用户 2026-10 报的"无法正常进行连战"）、
         *   竞技场决赛同样打不起来。
         * 另外 canvas 也要从战斗终帧切回主界面场景（`startHomeScene()` 一并做掉，语义就是
         *   "战斗播完了、界面由调用方恢复"）：现代模式的挑战页背景是透明的，只拨 `mode`
         *   不重画 canvas 的话，打完弹奖励时背景停在战斗画面上（用户 2026-10 报的
         *   "随机挑战战斗结束、弹奖励的时候背景还是战斗画面，应当是主界面"）。 */
        if (!opts.keepScreen) showHome();
        else startHomeScene();
        /* 现代 canvas 播放器不认 `rewardFor`（经典 SfFight 才在战果页出现前自己算）。
         * 这里在**确认还是同一个存档**之后再补算一次，交给调用方和收益弹窗：
         * 既让现代随机挑战的结算能写出经验/金松果，又不会在战斗中途切档时把奖励
         * 发给新档（`State.fightReward` 读写的是当前全局存档）。`settle` 自己缓存，
         * 调用方 `onEnd` 再调一次也只是取回同一份。
         * 经典渲染器已经把 reward 传进来了，不能重复算 —— 有的 `rewardFor` 不缓存。 */
        let finalReward = reward;
        if (!classicFight && finalReward == null && typeof opts.rewardFor === 'function') {
          try { finalReward = opts.rewardFor(winner); } catch (e) {
            if (window.__errs) window.__errs.push('battle rewardFor: ' + (e && (e.stack || e.message) || e));
          }
        }
        opts.onEnd && opts.onEnd(winner, result, loot, finalReward);
        /* 「战斗拾取」那层复刻自研的收益弹窗**只留给现代界面**。
         * 经典模式（原版 fight 帧）里收获是**画在战果页**上的 —— 原版 `showFightResult()`
         * （MainMovie.as:18703-18840）把这一场的东西填进 `c1/c2/c3` 三格 + `getExp`，
         * 战斗中飘到的道具另有 `获取道具`(3960) 那张小牌子，**没有**任何"结束后再弹一层"
         * 的实现（用户 2026-11 口径："收益弹窗的 ui 风格很明显和 ssfight 版本不符"）。
         * 所以这一档按"原版没有就删掉"处理：不再往原版战果页上盖一层 DOM 弹窗。
         * ⚠ 两座塔（挑战塔 / 无尽塔）也不走这里：塔的产出全部由
         * `Tower.reportBattle` 结算，塔页自己负责「战斗胜利 / 层数通关 / 选增益 / 里程碑」，
         * 战斗结束**不能再叠一层空的「战斗拾取」**（`collectDrops:false` 时它只有
         * 「胜利！」和一个确定键；用户 2026-10 报的就是无尽塔胜利后这个空弹窗）。 */
        const towerFight = opts.kind === 'tower' || opts.kind === 'endless';
        if (!classicFight && !towerFight && UI.classic && UI.classic.pickupResult) UI.classic.pickupResult(loot, finalReward, winner);
      },
      onError: () => {
        if (settled) return;
        settled = true; activeBattle = null; showHome();
        if (State.state() !== S) return;
        UI.toast('战斗播放中断，请重新挑战'); if (opts.onError) opts.onError();
      },
    });
    if (!settled) activeBattle = controller;
    if (!settled && window.SfGuide) {
      try { SfGuide.onBattleStart(); } catch (e) { if (window.__errs) window.__errs.push('SfGuide battle: ' + (e && e.message)); }
    }
  }

  async function replayBattle(entry, onEnd) {
    if (!entry || mode === 'battle') return;
    const owner = State.state();
    let settled = false;
    mode = 'battle'; cancelAnimationFrame(rafId); $('#ui').innerHTML = ''; fitCanvas(); playBgm('fight');
    const controller = await runBattle({ canvas, me: entry.me, foe: entry.foe, region: entry.region, result: entry.result, collectDrops: false,
      /* 录像回放同样遵守系统页的「跳过按钮」开关与等级/VIP 解锁，不在这里另开一套。 */
      allowSkip: State.skipButtonEnabled ? State.skipButtonEnabled() : true,
      onEnd: () => {
        if (settled) return;
        settled = true; activeBattle = null; showHome();
        if (State.state() === owner && onEnd) onEnd();
      },
      onError: () => {
        if (settled) return;
        settled = true; activeBattle = null; showHome();
        if (State.state() === owner) UI.toast('录像播放中断');
      },
    });
    if (!settled) activeBattle = controller;
  }
  function setMuted(value) {
    muted = !!value;
    // 取消静音时若滑块停在 0，恢复到默认音量
    if (!muted && volume <= 0) volume = clampVolume(localStorage.getItem('ssdz_music_volume')) || 1;
    persistSettings({ volume: volume, muted: muted });
    playBgm(mode === 'battle' ? 'fight' : 'main');
  }
  /** 调试/验证用：调整首页循环跑动的播放速度。 */
  function setHomeFps(fps) {
    const value = Math.max(1, Math.min(60, Number(fps) || 22));
    for (const inst of mainPlayer.list) inst.fps = value;
    return value;
  }

  /* ============================================================
   * 【MN9】「自愿支持作者」与「打开外部链接」
   *
   * 这个复刻版完全免费：没有内购、没有广告，支持纯属自愿，不换取任何游戏内好处。
   * 链接统一放这里，改渠道只动这一处（要点见 docs/更新记录.md）。
   * ============================================================ */
  const SUPPORT = Object.freeze({
    url: 'https://ifdian.net/a/Charlespkuer',
    label: '爱发电',
  });
  /** 当前页面是不是「我们自己的本地服务器」（轻壳模式 / 便携版的本地服务器）。 */
  function viaOwnLocalServer() {
    try {
      const h = String((window.location && window.location.hostname) || '').toLowerCase();
      const p = String((window.location && window.location.port) || '');
      return !!p && (h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]');
    } catch (e) { return false; }
  }
  function plainWindowOpen(url) {
    try {
      /* 注意：**不能**在 features 里写 'noopener' —— 按规范那样 window.open 一律返回 null，
       * 就分不清「被弹窗拦截」和「其实开成功了」。这里开完手动断开 opener 引用。 */
      const w = window.open(url, '_blank');
      if (!w) return false;
      try { w.opener = null; } catch (e) { /* 只读也不影响 */ }
      return true;
    } catch (e) { return false; }
  }
  /**
   * 用系统默认浏览器打开一个 http(s) 链接。返回 Promise<boolean>（true = 已交给浏览器）。
   *
   * 三种运行环境各走一条路（顺序即优先级）：
   *   1. **Tauri 安装版 / 安卓**（页面来自 tauri.localhost / tauri://）：走 Rust 命令
   *      `open_external`（src-tauri 里注册）；装了 opener 插件时则直接用它。
   *   2. **轻壳模式 / 便携版**（页面来自 http://127.0.0.1:端口）：轻壳的内置服务器提供
   *      `/__open?url=…`（Tauri 的 ACL 不允许这种「远端来源」调用 IPC，所以只能走 HTTP）；
   *      便携版（scripts/serve.js）没有这个路由 → 404 → 退回 window.open（那边就是真浏览器）。
   *   3. 纯浏览器 / file://：window.open。
   * 全部失败时返回 false，调用方据此显示「复制链接」兜底。
   */
  function openExternal(url) {
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u)) return Promise.resolve(false);
    const T = window.__TAURI__;
    const ownServer = viaOwnLocalServer();
    // ① 安装版 / 安卓（Tauri 应用，页面来自 tauri.localhost / tauri://）
    if (T && !ownServer) {
      if (T.opener && typeof T.opener.openUrl === 'function') {
        try { return Promise.resolve(T.opener.openUrl(u)).then(() => true, () => false); } catch (e) { /* 落下一步 */ }
      }
      if (T.core && typeof T.core.invoke === 'function') {
        return Promise.resolve(T.core.invoke('open_external', { url: u })).then(() => true, () => false);
      }
    }
    // ② 轻壳模式（Tauri + 自己的本地服务器）：IPC 会被 ACL 拒，走内置服务器的 /__open
    if (T && ownServer && typeof fetch === 'function') {
      return fetch('/__open?url=' + encodeURIComponent(u), { cache: 'no-store' })
        .then((r) => (r && r.ok ? r.json() : null))
        .then((j) => (j && j.ok ? true : plainWindowOpen(u)))
        .catch(() => plainWindowOpen(u));
    }
    /* ③ 便携版 / 网页版：直接同步 window.open。
     * **不能先 await fetch**（哪怕只是探测 /__open）—— 那样会丢掉「用户点击」这个手势，
     * 浏览器会把它当弹窗拦下来。 */
    return Promise.resolve(plainWindowOpen(u));
  }
  /** 便捷入口：**尽力**打开「支持作者」页（失败不弹窗）。
   *  界面请优先用 `UI.classic.openSupportModal()` —— 它带「复制链接」兜底。 */
  function openSupport() { return openExternal(SUPPORT.url); }

  /* ============================================================
   * 【MN10】导出 window.Main
   * ============================================================ */
  window.Main = { showHome, showTitle, startBattle, replayBattle, resizeLayout:fitCanvas, setMuted, isMuted: () => muted,
    volume: volumeValue, setVolume, homePlayer: () => mainPlayer, setHomeFps, W, H,
    settings: settingsSnapshot, setResolution, setFullscreen, setHideStatusBar, applySystemBars,
    isFullscreen: () => !!document.fullscreenElement,
    /* 现代 canvas 战斗图集：切到现代界面 / 真开打前可以主动预热（幂等，不阻塞首屏）。 */
    preloadBattleAssets, pinBattleAssets, battleAssetsReady: () => !!battleAssetsPromise,
    /* 自愿支持作者：链接与「打开系统浏览器」的统一出口（界面只调这两个）。 */
    SUPPORT, openExternal, openSupport };

  window.addEventListener('DOMContentLoaded', boot);
})();
