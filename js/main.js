/* ============================================================
 * main.js — 启动引导、主界面场景、战斗调度
 * ============================================================ */
(function () {
  'use strict';

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
  const HOME_BG_BLUR = 1.1;

  /** 主界面背景：等比铺满 1170×690，可加轻微虚化与淡化作纱。
   *  原版 main.jpg 细节很密，HUD 与角色压上去会互相抢，所以默认轻微虚化 + 提亮。 */
  function drawHomeBg(ctx, blur) {
    if (!mainBg) { ctx.fillStyle = '#3d6b35'; ctx.fillRect(0, 0, W, H); return; }
    const scale = Math.max(W / mainBg.width, H / mainBg.height);
    const dw = mainBg.width * scale, dh = mainBg.height * scale;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    ctx.save();
    if (blur) ctx.filter = 'blur(' + blur + 'px)';
    ctx.drawImage(mainBg, ox, oy, dw, dh);
    if (blur) ctx.filter = 'none';
    if (blur) {
      // 淡化作纱：只压很薄一层，底图细节尽量保留
      ctx.fillStyle = 'rgba(255,250,236,0.09)';
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
      g.addColorStop(0, 'rgba(40,60,35,0)');
      g.addColorStop(1, 'rgba(30,48,28,0.11)');
      ctx.fillStyle = g;
      ctx.fillRect(0, H * 0.62, W, H * 0.38);
    }
    ctx.restore();
  }
  let homeT = 0;
  let muted = localStorage.getItem('ssdz_music_muted') === '1';
  let activeBattle = null;

  function fitCanvas() {
    // Classic menu screenshots use 920:560; APK combat keeps its native 1170:690.
    const layoutHeight = $('#ui .classic-page') ? W * 560 / 920 : H;
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
    ui.style.height = H + 'px';
    ui.style.transform = 'scale(' + sx + ',' + sy + ')';
    ui.style.setProperty('--uiscale', Math.min(sx, sy));
    ui.style.fontSize = (16 * Math.min(sx, sy)) + 'px';
    // 位图数字按设计尺寸逐字绘制，缩放变化后需要按新比例重画一次。
    if (window.UI && UI.renderNumbers) UI.renderNumbers();
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
  /** 存档载入后把偏好接过来：存档优先，并回写 localStorage 供下次启动（标题画面）用。 */
  function applyStoredSettings() {
    try {
      if (!window.State || !State.settings || !State.state || !State.state()) return;
      const st = State.settings();
      volume = clampVolume(st.volume);
      muted = st.muted === true || volume <= 0;
      localStorage.setItem('ssdz_music_volume', String(volume));
      localStorage.setItem('ssdz_music_muted', muted ? '1' : '0');
      applyVolume();
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
    mainBg = await Engine.loadImage('images/main.jpg');
    if (!mainBg) mainBg = await Engine.loadImage('images/classic/village.svg');
    mainBgSoft = !!mainBg && /main\.jpg$/i.test(mainBg.src || '');
    drawLoading(0.25, '正在加载角色素材…');
    setStatus('加载角色素材…');
    await Engine.loadSheets(['SQ_01', 'SQ_02', 'weaponAttack', 'throwweaponAttack', 'main_e1', 'main_e2', 'main_e3',
      'wuqi', 'wuqi2', 'jineng', 'daoju', 'jinbeidaoju', 'tudi', 'go', 'starter_effect', 'loadingp',
      'fightNum_r', 'fightNum_g', 'fightNum_y', 'tilishuzi', 'energyNum', 'expNum', 'jingyanshuzi', 'num_28', 'num_36',
      'resource_1', 'resource_6', 'resource_13', 'resource_15', 'resource_16', 'resource_3', 'resource_4',
      'resource_5', 'resource_9', 'resource_10', 'resource_11', 'resource_12', 'resource_14', 'resource_2', 'resource_7', 'resource8',
      'new', 'shengbai', 'tanchutiao', 'loadingShadow', 'substarate', 'substarate0', 'draw', 'activity', 'plus', 'minus']);
    drawLoading(0.6, '正在加载战斗素材…');
    setStatus('加载战斗素材…');
    await Engine.loadSheets(['effectCommonAttack', 'weaponEffect', 'throwEffect', 'win_effect', 'die', 'runAround',
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
    // 角色/特效图集必须优先于场景图集，否则同名标签会被场景图元抢走
    Engine.pinSheets(['SQ_01', 'SQ_02', 'weaponAttack', 'throwweaponAttack',
      'effectCommonAttack', 'weaponEffect', 'throwEffect', 'win_effect', 'die', 'runAround', 'hurtRunBack', 'beatBack', 'think',
      'skill_6', 'skill_7', 'skill_8', 'skill_8_d', 'skill_9', 'skill_9_d', 'skill_13', 'skill_14', 'skill_15', 'skill_15_d',
      'skill_16_1', 'skill_16_2', 'skill_17', 'skill_18', 'skill_18_d_1', 'skill_18_d_2', 'skill_23',
      'tl', 'tl_effect', 'xh1', 'xh2', 'xh_effect1', 'xh_effect2', 'xm1', 'xm2', 'xm_effect',
      'woodman1', 'woodman2', 'woodman_effect']);
    drawLoading(0.95, '准备完成');
    setStatus('松鼠大战 · 怀旧单机版');
    UI.installFavicon();
    await new Promise((r) => setTimeout(r, 150));
    // 存档：主存档是游戏目录下的 save/progress.json（本地服务器提供），
    // 没有服务器时才退回浏览器 localStorage（老档会在第一次读文件时自动迁进去）
    let loaded = false;
    try { loaded = await State.fileLoad(); } catch (e) { loaded = false; }
    if (loaded || State.load()) showHome();
    else showTitle();
    // 首页数字按当前调试设置（数字宽度）重画一次，保证刷新后立即生效
    if (window.UI && UI.renderNumbers) UI.renderNumbers();
    if (/[?&]test=1(?:&|$)/.test(location.search)) runSelfTest();
    if (/[?&]test=2(?:&|$)/.test(location.search)) runBattleLoop();
  }

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
      const regs = window.__homeRegions || [];
      ok('home-render', mode === 'home' && regs.length === 5 && document.querySelectorAll('.home-menu button').length === 5, 'regions=' + regs.length);
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
        Main.startBattle(State.genAI(1), { region: 0, onEnd: (w, r) => resolve({ w: w, rounds: r.rounds.length }) });
      });
      await new Promise((r) => setTimeout(r, 2500));
      document.querySelector('[aria-label="跳过战斗"]')?.click();
      const res = await Promise.race([battleDone, new Promise((r) => setTimeout(() => r(null), 30000))]);
      ok('battle', !!res, res ? ('winner=' + res.w + ' rounds=' + res.rounds)
        : 'timeout sheets=' + Object.keys(Engine.SHEETS).length + ' errs=' + (window.__errs || []).slice(0, 6).join(';'));
      await new Promise((r) => setTimeout(r, 900));
      ok('back-home', mode === 'home');
      // 逐个菜单面板做渲染冒烟测试（先临时升到 30 级以覆盖天梯赛）
      State.state().level = Math.max(30, State.state().level);
      State.state().integral = 1500;
      const keys = ['challenge', 'stages', 'arena', 'rank', 'weapons', 'skills', 'bag', 'gears', 'shop', 'lottery', 'master', 'help'];
      for (const k of keys) {
        try {
          UI.runAction(k);
          await new Promise((r) => setTimeout(r, 160));
          const panel = document.querySelector('#ui .panel, #ui .classic-page, #ui .classic-modal');
          ok('panel:' + k, !!panel && panel.textContent.length > 10);
          const close = document.querySelector('#ui .panel-close');
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
        <img class="classic-portrait" src="images/classic/squirrel-classic.png" alt="经典松鼠">
        <div class="title-form"><input id="name-input" maxlength="12" aria-label="松鼠昵称" placeholder="给你的松鼠起个名字" value="小松鼠">
        <button id="start-btn" class="uc-button gold">开始游戏</button></div>
        <div class="title-tip">怀旧单机版 · 进度自动保存</div>
      </div>`;
    let last = performance.now();
    (function loop(now) {
      if (mode !== 'title') return;
      const dt = Math.min(50, now - last); last = now;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawHomeBg(ctx, mainBgSoft ? HOME_BG_BLUR : 0);
      
      // 标题画面也放一只待机松鼠，避免"主界面没有松鼠动作"
      titleT += dt;
      rafId = requestAnimationFrame(loop);
    })(performance.now());
    $('#start-btn').onclick = () => {
      const name = $('#name-input').value.trim() || '小松鼠';
      State.newGame(name);
      playBgm('main');
      showHome();
    };
    $('#name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#start-btn').click(); });
  }
  let titleT = 0;

  // ---------- 主界面：有松鼠动作的场景 + 原版 HUD ----------
  let homeRegions = [];
  function showHome() {
    mode = 'home';
    applyStoredSettings();
    UI.renderHome();
    fitCanvas();
    playBgm('main');
    buildHomeScene();
    let last = performance.now();
    cancelAnimationFrame(rafId);
    (function loop(now) {
      if (mode !== 'home') return;
      const dt = Math.min(50, now - last); last = now;
      homeT += dt;
      Engine.updatePlayer(mainPlayer, dt);
      if (homeBgPlayer) Engine.updatePlayer(homeBgPlayer, dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawHomeBg(ctx, mainBgSoft ? HOME_BG_BLUR : 0);
      
      if (homeBgPlayer) Engine.drawPlayer(ctx, homeBgPlayer);
      homeRegions = UI.drawHomeHud(ctx, W, H);
      window.__homeRegions = homeRegions;
      rafId = requestAnimationFrame(loop);
    })(performance.now());
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
   *  帧推进交给 Engine 播放器，绘制在 UI.drawHomeHud 的主角盒子里完成。 */
  function buildHomeScene() {
    mainPlayer = Engine.makePlayer();
    homeBgPlayer = null;
    homeT = 0;
    const SQ = ['SQ_01', 'SQ_02'];
    const walkName = ['mainWalk1', 'mainWalk2', 'mainWalk3'].find((n) => Engine.hasAnim(n)) || 'standby';
    homeWalk = Engine.playAnim(mainPlayer, walkName, { loop: true, fps: 22, layer: 2, sheets: SQ });
    if (Engine.hasAnim(walkName + '_e')) {
      Engine.playAnim(mainPlayer, walkName + '_e', { loop: true, fps: 22, layer: 4, sheets: ['main_e1'] });
    }
  }
  let homeBgPlayer = null, homeWalk = null;

  // ---------- 战斗调度 ----------
  async function startBattle(foe, opts) {
    opts = opts || {};
    if (mode === 'battle') return;
    const S = State.state();
    if (opts.cost && !State.consumeEnergy(opts.cost)) { UI.toast('体力不足，无法开始战斗'); return; }
    const stats = State.totalStats({ useProps: opts.useProps !== false });
    const maxHp = Math.max(1, Math.round(stats.hp));
    // hpRatio 是关卡连战的入场血量比例：hp 按比例继承，maxHp 仍是不变的上限。
    const startRatio = opts.hpRatio == null ? 1 : Math.min(1, Math.max(0.01, Number(opts.hpRatio) || 0));
    const me = {
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
    mode = 'battle';
    cancelAnimationFrame(rafId);
    $('#ui').innerHTML = '';
    fitCanvas();
    playBgm('fight');
    if (opts.region != null && foe && foe.region == null) foe.region = opts.region;
    let settled = false;
    const controller = await Battle.run({
      canvas, me, foe, region: opts.region, kind: opts.kind, collectDrops: opts.collectDrops !== false,
      dropRandom: window.QA_FIXTURE && QA_FIXTURE.dropRandom,
      onEnd: (winner, result, loot) => {
        if (settled) return;
        settled = true;
        activeBattle = null;
        if (State.state() !== S) { showHome(); return; }
        State.recordBattle({ me, foe, result, region: opts.region != null ? opts.region : foe.region || 0, kind: opts.kind || 'challenge' });
        playBgm('main');
        // 战斗结束后主界面渲染循环处于暂停态，先恢复它，再弹结果面板
        showHome();
        opts.onEnd && opts.onEnd(winner, result);
        if (UI.classic && UI.classic.pickupResult) UI.classic.pickupResult(loot);
      },
      onError: () => {
        if (settled) return;
        settled = true; activeBattle = null; showHome();
        if (State.state() !== S) return;
        UI.toast('战斗播放中断，请重新挑战'); if (opts.onError) opts.onError();
      },
    });
    if (!settled) activeBattle = controller;
  }

  async function replayBattle(entry, onEnd) {
    if (!entry || mode === 'battle') return;
    const owner = State.state();
    let settled = false;
    mode = 'battle'; cancelAnimationFrame(rafId); $('#ui').innerHTML = ''; fitCanvas(); playBgm('fight');
    const controller = await Battle.run({ canvas, me: entry.me, foe: entry.foe, region: entry.region, result: entry.result, collectDrops: false,
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

  window.Main = { showHome, showTitle, startBattle, replayBattle, resizeLayout:fitCanvas, setMuted, isMuted: () => muted,
    volume: volumeValue, setVolume, homePlayer: () => mainPlayer, setHomeFps, W, H,
    settings: settingsSnapshot, setResolution, setFullscreen, isFullscreen: () => !!document.fullscreenElement };
  window.addEventListener('DOMContentLoaded', boot);
})();
