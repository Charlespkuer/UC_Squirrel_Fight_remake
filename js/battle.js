/* UC 松鼠大战战斗播放器。动作、装备替换位与命中帧取自原版 APK。
 * 原版时间轴已包含接近、闪避、返回的位置；松鼠朝右，NPC 默认朝左。
 */

/* ------------------------------------------------------------
 * 目录：战斗播放器（按回合事件流驱动动画）
 * Ctrl+F 搜节号（如「【BT1】」）直达对应代码块。
 *
 *  【BT1】常量与素材表  【BT2】NPC 头像与动画名映射  【BT3】战斗播放主流程 run
 *  【BT4】导出 window.Battle
 * ------------------------------------------------------------ */
(function () {
  'use strict';
  /* ============================================================
   * 【BT1】常量与素材表（图集/特效/命中帧）
   * ============================================================ */
  const W = 1170, H = 690, FPS = 20;
  const SQ = ['SQ_01', 'SQ_02', 'weaponAttack', 'throwweaponAttack'];
  const NPC_SHEETS = { tl: ['tl'], xh: ['xh1', 'xh2'], xm: ['xm1', 'xm2'], wood: ['woodman1', 'woodman2'] };
  const NPC_EFFECTS = { tl: ['tl_effect'], xh: ['xh_effect1', 'xh_effect2'], xm: ['xm_effect'], wood: ['woodman_effect'] };
  /* 挑战塔 NPC：战斗行为用独立 npcType（tw_*，sim.js 里走普通 NPC 行动、不触发三侠大招），
   * 贴图与动画复用三侠的表。优先从 TowerData 取体型指派，测试环境缺TowerData时用内联兜底。 */
  const TOWER_NPC_ANIM = window.TowerData
    ? Object.fromEntries(TowerData.NPCS.map((n) => ['tw_' + n.id, n.anim]))
    : { tw_berserker: 'xm', tw_assassin: 'tl', tw_medic: 'xh', tw_ironwall: 'xm', tw_bramble: 'xh', tw_frostmage: 'xh', tw_tamer: 'tl', tw_vampire: 'tl', tw_golem: 'xm', tw_devourer: 'xm' };
  const npcBase = (type) => TOWER_NPC_ANIM[type] || type;
  // FightStats.js 原版先把 1024 宽场景放大 1.4355 倍，再居中裁切，不能压成 1170 × 690。
  const BG_SCALE = 1.4355;
  const REGIONS = {
    0: { name: '水上人家', layers: [
      { id: 'fightBack', scale: BG_SCALE, fx: 'effect_layer1_fightBg1', fxSheet: 'fightMid' },
      { fx: 'effect_layer2_fightBg1', fxSheet: 'fightMid' },
      { id: 'fightFront', scale: BG_SCALE, y: 399 },
    ] },
    1: { name: '机器人工厂', layers: [
      { id: 'fightBg_robot_mid', scale: BG_SCALE },
      { id: 'fightBg_robot_front', scale: BG_SCALE, fx: 'fightBg_robot_effect' },
    ] },
    2: { name: '熔岩密室', layers: [{ id: 'fightBg_meltRoom_front', scale: BG_SCALE, fx: 'fightBg_meltRoom_effect' }] },
    3: { name: '神秘森林', layers: [
      { id: 'fightBg_wood_1', scale: BG_SCALE, fx: 'fightBg_wood_effect2' },
      { id: 'fightBg_wood_3', scale: BG_SCALE },
      { id: 'fightBg_wood_4', scale: BG_SCALE, fx: 'fightBg_wood_effect6', fy: -6 },
    ] },
    4: { name: '海底世界', layers: [{ id: 'fightBg_seaWorld_front', scale: 1, fx: 'fightBg_seaWorld_effect' }] },
  };
  const FX_SHEETS = {
    effect_commonAtack: ['effectCommonAttack'], effect_weapon: ['weaponEffect'], effect_throw: ['throwEffect'],
    effect_hitMe: ['hurtRunBack'], effect_runBack: ['hurtRunBack'], effect_hurtRunBack: ['hurtRunBack'],
    effect_dead: ['die'], effect_win: ['win_effect'], effect_runAround: ['runAround'], effect_beatBack: ['beatBack'],
    effect_skill_6: ['skill_6'], effect_skill_7: ['skill_7'], effect_skill_8: ['skill_8'],
    effect_skill_8_defend: ['skill_8_d'], effect_skill_9: ['skill_9'], effect_skill_9_1: ['skill_9_d'],
    effect_skill_11: ['think'], effect_skill_13: ['skill_13', 'skill_14', 'skill_17'], effect_skill_14: ['skill_14'],
    effect_skill_15: ['skill_15'], effect_skill_15_defend: ['skill_15_d'], effect_skill_16: ['skill_16_1', 'skill_16_2'],
    effect_skill_17: ['skill_17'], effect_skill_18: ['skill_18'], effect_skill_18_defend_1: ['skill_18_d_1'],
    effect_skill_18_defend_2: ['skill_18_d_2'], effect_skill_23: ['skill_23'],
  };
  // 原版 CommonAttack / WeaponAttack / ThrowWeaponAttack / Skill_* 的回调帧。
  const HIT_FRAME = { fightCommonAttack: 8, fightWeaponAttack: 7, fightThrowWeaponAttack: 13,
    skill_8: 14, skill_9: 7, skill_13: 40, skill_14: 16, skill_15: 22, skill_17: 38, skill_18: 18, skill_23: 29,
    tl_common_attack: 6, tl_skill_attack: 10, xh_common_attack: 6, xh_skill_attack: 10,
    xm_common_attack: 6, xm_skill_attack: 8, beatBack: 4 };
  const RANGED = new Set([5, 6, 7, 8, 9, 10, 13, 14]);
  const weaponLabelFor = (id, level) => String((level > 10 ? 1200 : level > 7 ? 1100 : 1000) + Number(id));
  const isThrowing = (id) => RANGED.has(Number(id));
  const SKILL_DEFEND = { 8: ['skill_8_1', 'effect_skill_8_defend'], 12: ['skill_9_1', 'effect_skill_9_1'],
    15: ['skill_15_1', 'effect_skill_15_defend'], 18: ['skill_18_2', 'effect_skill_18_defend_2'] };
  let activeController = null;

  /* ============================================================
   * 【BT2】NPC 头像与动画名映射
   * ============================================================ */
  /* 右下角操作区的布局（纯函数，导出给测试直接核对）。
   * 原版字面坐标 (983,609) 的 164x60 框会压到血条，所以基准块下移到右下角。
   * 2026-10 用户口径：**所有**倍速 / 跳过键统一用「普通战斗的跳过键」那一档尺寸
   * 190x70（贴住 1170x690 画布右下角，右/下各留 16px）：
   *   · 只有倍速（挑战塔 / 无尽塔 <20 层）→ 单键 190x70；
   *   · 只有跳过（普通战斗的跳过播放）→ 同样 190x70；
   *   · 倍速 + 跳过（无尽塔 20 层起）→ **两个 190x70 在右下并排**（中间留 8px 缝），
   *     整块正好贴住右下角（右边缘 1170−16）。
   * 返回 { rects: { speed, skip }, both, base }，rect 为 null 表示这个键不显示。 */
  function cornerLayout(speedToggle, allowSkip) {
    const single = { x: W - 16 - 190, y: H - 15 - 70, w: 190, h: 70 };   // = { 964, 605, 190, 70 }
    if (speedToggle && allowSkip) {
      const gap = 8, w = single.w, h = single.h;
      const x = W - 16 - (w * 2 + gap);                                  // 两个键一起贴右下角
      return {
        both: true, base: { x: x, y: single.y, w: w * 2 + gap, h: h },
        rects: {
          speed: { x: x, y: single.y, w: w, h: h },
          skip: { x: x + w + gap, y: single.y, w: w, h: h },
        },
      };
    }
    if (speedToggle) return { both: false, base: single, rects: { speed: single, skip: null } };
    if (allowSkip) return { both: false, base: single, rects: { speed: null, skip: single } };
    return { both: false, base: single, rects: { speed: null, skip: null } };
  }
  function makeAvatar(npcType) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 122;
    const ctx = canvas.getContext('2d');
    const label = { tl: '4', xh: '5', xm: '6' }[npcType] || '3';
    const size = Engine.frameSize('resource_12', label);
    if (size) {
      const scale = Math.max(122 / size.w, 122 / size.h);
      Engine.drawSprite(ctx, 'resource_12', label, (122 - size.w * scale) / 2, 0, size.w * scale, size.h * scale);
    }
    return canvas;
  }

  function npcAnim(type, action) {
    const names = { idle: 'rest', common: 'common_attack', skill: 'skill_attack', hit: 'hitMe', dodge: 'runAround', back: 'runBack', die: 'die', win: 'win' };
    if (type === 'wood') return action === 'hit' ? 'wood_hitMe' : 'wood_rest';
    return type + '_' + (names[action] || action);
  }
  function nameOf(map, id, fallback) {
    try { const item = map.getValue(id); return item ? item.name : fallback; } catch (e) { return fallback; }
  }

  /* ============================================================
   * 【BT3】战斗播放主流程 run
   * ============================================================ */
    /** 把回合里的「新上限 / 当前血量」应用到血条数组上（玉石俱焚这类**压缩上限**的效果）。
   *  独立成纯函数：一是逻辑清楚，二是单测可以直接跑它（战斗回放本体依赖 rAF，headless 里驱动不动）。
   *  返回 { capped } —— 这一回合有没有真的压低上限（用来决定要不要飘字）。 */
  function applyRoundCaps(maxHpArr, hpsArr, r) {
    let capped = false;
    if (Array.isArray(r.maxHp) && r.maxHp.length === 2) {
      for (const side of [0, 1]) {
        const next = Math.max(1, Math.round(Number(r.maxHp[side]) || maxHpArr[side]));
        if (next < maxHpArr[side]) { maxHpArr[side] = next; capped = true; }
      }
    }
    if (Array.isArray(r.hp) && r.hp.length === 2) {
      for (const side of [0, 1]) {
        const v = Math.max(0, Math.min(maxHpArr[side], Math.round(Number(r.hp[side]) || hpsArr[side])));
        if (v !== hpsArr[side]) hpsArr[side] = v;
      }
    }
    return { capped: capped };
  }

  async function run(opts) {
    if (activeController) activeController.cancel();
    const canvas = opts.canvas, ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    const result = opts.result || Sim.simulate(opts.me, opts.foe);
    const regionKey = opts.region == null ? (opts.foe.region == null ? 0 : opts.foe.region) : opts.region;
    const region = REGIONS[regionKey] || REGIONS[0];
    const sources = [opts.me, opts.foe];
    const wears = sources.map((f) => Engine.wearsFor(f.wears || f.gears));
    const load = new Set([...SQ, 'resource_12', 'resource_2', 'go', 'fightNum_r', 'fightNum_y', 'fightNum_g']);
    for (const f of sources) if (f.npcType) for (const id of [...(NPC_SHEETS[f.npcType] || []), ...(NPC_EFFECTS[f.npcType] || [])]) load.add(id);
    for (const ids of Object.values(FX_SHEETS)) for (const id of ids) load.add(id);
    for (const side of wears) for (const wear of side) if (wear) load.add(wear.src);
    for (const layer of region.layers) { if (layer.id) load.add(layer.id); if (layer.fx) load.add(layer.fxSheet || layer.fx); }
    await Engine.loadSheets([...load]);
    for (const layer of region.layers) if (layer.id && !Engine.has(layer.id)) await Engine.loadSheetFromUrl(layer.id, 'images/' + layer.id + '.png');

    const player = Engine.makePlayer(), scenePlayers = [];
    const fighters = sources.map((info, side) => ({ info, side, npc: info.npcType ? npcBase(info.npcType) : null, inst: null, dead: false, wears: wears[side] }));
    // maxHp 必须用真实上限：关卡连战时 me.hp 只是按比例继承的当前血量，
    // 拿它当上限会让血条显示成满血，并让模拟按错误的上限计算。
    const hpOf = (f) => Math.max(1, Math.round(Number(f.hp) || 1));
    const hps = sources.map((f) => Math.min(hpOf(f), Number(f.maxHp) > 0 ? Math.round(Number(f.maxHp)) : hpOf(f)));
    /* 护盾（石像鬼机制 / 塔 buff「坚韧壁垒」）：初值取模拟的开局护盾，
     * 之后每帧跟随事件里的 shellAfter 更新。血条上画一段浅蓝，数值旁标「＋护盾 N」。 */
    const shields = Array.isArray(result.startShell) && result.startShell.length === 2
      ? result.startShell.map((v) => Math.max(0, Math.round(Number(v) || 0)))
      : [0, 0];
    const maxHp = sources.map((f, side) => Number(f.maxHp) > 0 ? Math.max(hps[side], Math.round(Number(f.maxHp))) : hps[side]);
    const floaters = [], sleepers = new Set();
    let stopped = false, skipped = false, ending = false, raf = 0, round = 99, countdown = null;
    let last = performance.now(), shake = 0, combatStarted = false;
    /* 右下角操作区：绘制与点击区共用同一组矩形。
     * 原版字面坐标 (983,609) 的 164x60 框会把按钮压出血条，所以用 190x70。
     * 2026-10：无尽塔 30 层起**同时**要倍速键与跳过键 —— 两个都在时把这块横切成两半
     * （中间留 8px 缝），只有一个时仍占满整块，与旧版逐像素一致。 */
    const speedToggle = !!opts.speedToggle;
    const allowSkip = opts.allowSkip !== false;
    let speed = 1;
    const corner = cornerLayout(speedToggle, allowSkip);
    const cornerRects = corner.rects;
    /* 所有倍速 / 跳过键都用「普通战斗跳过键」那一档尺寸（190x70）→ 字号统一 46。 */
    const cornerFont = 46;
    const cornerVisible = !!(cornerRects.speed || cornerRects.skip);
    const previousClick = canvas.onclick;
    const ui = document.getElementById('ui');
    const pickups = opts.collectDrops && !opts.result && window.BattleDrops ? BattleDrops.create({ root: ui, random: opts.dropRandom, kind: opts.kind }) : null;
    // 无障碍点击层跟着矩形走，避免两处坐标各改一半而错位。
    const rectStyleOf = (r) => ['left:' + (r.x / W * 100).toFixed(3) + '%', 'top:' + (r.y / H * 100).toFixed(3) + '%',
      'width:' + (r.w / W * 100).toFixed(3) + '%', 'height:' + (r.h / H * 100).toFixed(3) + '%'].join(';');
    const cornerDom = [];
    function addCornerButton(rect, label, aria) {
      if (!ui || !rect) return null;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.textContent = label;
      b.style.cssText = 'position:absolute;' + rectStyleOf(rect) + ';padding:0;border:0;background:transparent;color:transparent;cursor:pointer;pointer-events:auto;z-index:20;';
      ui.appendChild(b); cornerDom.push(b);
      return b;
    }
    const speedButton = addCornerButton(cornerRects.speed, speed + '×', '切换战斗速度');
    const skipButton = addCornerButton(cornerRects.skip, '跳过', '跳过战斗');
    function clean() {
      cancelAnimationFrame(raf); for (const b of cornerDom) b.remove();
      if (pickups) pickups.close();
      if (canvas.onclick === onClick) canvas.onclick = previousClick;
      canvas.style.cursor = '';
      for (const wake of [...sleepers]) wake();
      sleepers.clear();
    }
    const controller = { cancel() { stopped = true; clean(); }, skip() { if (!ending && !skipped && !stopped) { skipped = true; if (pickups) pickups.skip(); for (const wake of [...sleepers]) wake(); } }, result };
    activeController = controller;
    /** 右下角「倍速」键：1× → 2× → 3× → 1× 循环。 */
    function speedAction() {
      if (ending || stopped || !speedButton) return;
      speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
      speedButton.textContent = speed + '×';
      speedButton.setAttribute('aria-label', '切换战斗速度（当前 ' + speed + '×）');
    }
    /** 右下角「跳过」键：直接跳到结算（结果早已由模拟器算好，跳过不改变胜负）。 */
    function skipAction() { controller.skip(); }
    if (speedButton) speedButton.onclick = speedAction;
    if (skipButton) skipButton.onclick = skipAction;
    function onClick(event) {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * W / rect.width, y = (event.clientY - rect.top) * H / rect.height;
      for (const [r, act] of [[cornerRects.speed, speedAction], [cornerRects.skip, skipAction]]) {
        if (!r) continue;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { act(); return; }
      }
    }
    canvas.onclick = cornerVisible ? onClick : null;
    const aborted = () => stopped || skipped;
    function wait(ms) {
      if (aborted()) return Promise.resolve();
      return new Promise((resolve) => {
        let timer;
        const wake = () => { clearTimeout(timer); sleepers.delete(wake); resolve(); };
        sleepers.add(wake); timer = setTimeout(wake, speed > 1 ? ms / speed : ms);
      });
    }
    function mirrorFor(side) { return fighters[side].npc ? side === 0 : side === 1; }
    function killSide(side) {
      // An interrupted reaction must release its await, even if a newer action
      // replaces it before the timeline reaches its final frame.
      if (fighters[side].finishAction) fighters[side].finishAction();
      for (const inst of player.list) if (inst.side === side) Engine.killInst(inst);
      fighters[side].inst = null;
    }
    function play(side, name, options) {
      const f = fighters[side], o = options || {};
      const inst = Engine.playAnim(player, name, Object.assign({ fps: FPS, holdLast: true,
        sheets: f.npc ? NPC_SHEETS[f.npc] : SQ, mirror: mirrorFor(side), wears: f.npc ? null : f.wears,
        exclude: f.npc === 'xm' ? ['91'] : null, layer: side + 1 }, o));
      if (inst) { inst.side = side; f.inst = inst; }
      return inst;
    }
    function idle(side) {
      killSide(side);
      if (!fighters[side].dead) play(side, fighters[side].npc ? npcAnim(fighters[side].npc, 'idle') : 'standby', { loop: true });
    }
    function effect(name, side, extra) {
      if (!name || !Engine.hasAnim(name)) return null;
      return Engine.playAnim(player, name, Object.assign({ fps: FPS, layer: 5, mirror: mirrorFor(side),
        sheets: fighters[side].npc && name.startsWith(fighters[side].npc + '_') ? NPC_EFFECTS[fighters[side].npc] : FX_SHEETS[name] }, extra));
    }
    function action(side, name, options) {
      const o = options || {};
      if (aborted() || !Engine.hasAnim(name)) return Promise.resolve();
      killSide(side);
      return new Promise((resolve) => {
        let settled = false;
        const done = () => { if (!settled) {
          settled = true; sleepers.delete(done);
          if (fighters[side].finishAction === done) fighters[side].finishAction = null;
          resolve();
        } };
        fighters[side].finishAction = done;
        sleepers.add(done);
        if (!play(side, name, Object.assign({}, o, { onDone: done }))) done();
      });
    }
    function point(side) {
      const f = fighters[side], inst = f.inst;
      if (inst) {
        const box = Engine.frameBounds(inst.frames[inst.frame], { sheets: inst.sheets, wears: inst.wears, exclude: ['54', '75', '91'] });
        if (box) return { x: (inst.mirror ? W - (box.x + box.w / 2) : box.x + box.w / 2) + inst.x, y: Math.max(160, box.y - 40) };
      }
      return { x: side ? 875 : 295, y: 260 };
    }
    function floater(side, text, color, big) {
      const p = point(side);
      const count = floaters.filter((f) => f.side === side && f.age < 250).length;
      floaters.push({ side, text: String(text), color: color || 'r', big: !!big, x: p.x, y: p.y - count * 43, age: 0 });
    }
    function applyHp(r, counterPending, before) {
      if (Array.isArray(r.shellAfter) && r.shellAfter.length === 2) {
        for (let side = 0; side < 2; side++) shields[side] = Math.max(0, Math.round(Number(r.shellAfter[side]) || 0));
      }
      if (!r.hpAfter) return;
      for (let side = 0; side < 2; side++) {
        let next = r.hpAfter[side];
        if (counterPending && before && (r.counterDmg || r.counterFakeDie || r.counterRebound)) {
          // hpAfter is clamped at zero. Adding an overkill counter damage back
          // would manufacture HP, so derive this frame from the event's start.
          next = before[side] + (side === r.attacker
            ? (r.healSelf || 0) + (r.lifesteal || 0) - (r.selfBurn || 0) - (r.reboundHurt || 0)
            : -(r.dmg || 0));
        }
        hps[side] = Math.max(0, Math.min(maxHp[side], next));
      }
    }
    for (const layer of region.layers) {
      const p = Engine.makePlayer();
      if (layer.fx && Engine.hasAnim(layer.fx)) Engine.playAnim(p, layer.fx, { fps: FPS, loop: true, sheets: [layer.fxSheet || layer.fx], y: layer.fy || 0 });
      scenePlayers.push(p);
    }
    function drawScene() {
      ctx.fillStyle = '#17263f'; ctx.fillRect(0, 0, W, H);
      region.layers.forEach((layer, i) => {
        const sheet = Engine.SHEETS[layer.id];
        if (sheet) {
          const scale = layer.scale || 1, width = W / scale;
          ctx.drawImage(sheet.img, Math.max(0, (sheet.img.width - width) / 2), 0, Math.min(sheet.img.width, width), sheet.img.height,
            0, layer.y || 0, W, sheet.img.height * scale);
        }
        Engine.drawPlayer(ctx, scenePlayers[i]);
      });
    }
    function rounded(x, y, w, h, radius, color) {
      ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = color; ctx.fill();
    }
    function drawHud() {
      // references/162442 与 162553：浅色姓名框、金黄色双向血条、居中的剩余回合。
      for (let side = 0; side < 2; side++) {
        const right = side === 1, x = right ? 634 : -20, width = 556, y = 51, height = 61;
        const nx = right ? 724 : 114;
        rounded(nx, -7, 336, 60, 13, 'rgba(239,239,225,.72)');
        Engine.text(ctx, sources[side].name || (right ? '对手' : '小松鼠'), nx + 168, 39,
          { size: 32, bold: false, align: 'center', color: '#9f3f17', stroke: false });
        rounded(x, y, width, height, 31, '#ff6100');
        const pct = Math.max(0, Math.min(1, hps[side] / maxHp[side]));
        /* 护盾按「占上限的比例」画成血条后面的一段 —— 敌方血条是从右往左长的，
         * 所以那一侧的护盾段要贴在血条的**左端**，保持「越靠内越先被打掉」的直觉。 */
        const sp = Math.max(0, Math.min(1, (Number(shields[side]) || 0) / maxHp[side]));
        ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, width, height, 31); ctx.clip();
        if (sp > 0) {
          ctx.fillStyle = 'rgba(120,226,255,.95)';
          ctx.fillRect(right ? x + width * (1 - pct - sp) : x + width * pct, y, width * sp, height);
        }
        const gradient = ctx.createLinearGradient(0, y, 0, y + height); gradient.addColorStop(0, '#ffd323'); gradient.addColorStop(1, '#ffaa0e');
        ctx.fillStyle = gradient; ctx.fillRect(right ? x + width * (1 - pct) : x, y, width * pct, height); ctx.restore();
        Engine.text(ctx, Math.round(hps[side]) + '/' + maxHp[side], x + width / 2, y + 42,
          { size: 36, align: 'center', color: '#fff8d4', bold: false, stroke: false });
        /* 护盾数值写在生命值右边（有护盾才画，避免平时干扰）。 */
        if (shields[side] > 0) {
          Engine.text(ctx, '＋护盾 ' + Math.round(shields[side]), x + width / 2 + 104, y + 40,
            { size: 24, align: 'left', color: '#8fe8ff' });
        }
      }
      const debuffs = Array.isArray(opts.debuffs) ? opts.debuffs : [];
      if (debuffs.length) {
        let dx = 8;
        for (const d of debuffs) {
          const body = String(d.text || d.name || '削弱');
          const who = d.short || d.hero || '';
          const whoW = who ? 18 + who.length * 20 : 0;
          const width2 = Math.max(104, whoW + body.length * 21 + 22);
          const color = d.color || '#7e1c16';
          rounded(dx, 116, width2, 36, 18, 'rgba(30,16,10,.80)');
          if (whoW) {
            ctx.save(); ctx.beginPath(); ctx.roundRect(dx, 116, width2, 36, 18); ctx.clip();
            ctx.fillStyle = color; ctx.fillRect(dx, 116, whoW, 36); ctx.restore();
            Engine.text(ctx, who, dx + whoW / 2, 142, { size: 19, align: 'center', color: '#fff8d4', stroke: false });
          }
          ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.beginPath();
          ctx.roundRect(dx, 116, width2, 36, 18); ctx.stroke();
          Engine.text(ctx, body, dx + whoW + 11, 142, { size: 22, align: 'left', color: '#ffe6df', stroke: false });
          dx += width2 + 8;
        }
      }
      Engine.text(ctx, String(Math.max(0, round)).padStart(2, '0'), W / 2, 101,
        { size: 63, align: 'center', color: '#fff', strokeColor: '#301314', lineWidth: 6 });
      /* 挑战塔题面：这条规则决定「什么时候该爆发」，进层前预告里读过，战斗里再贴一次备忘 */
      if (opts.trial && opts.trial.text) {
        const label = String(opts.trial.text);
        const bw = Math.min(W - 40, label.length * 21 + 44);
        rounded(W / 2 - bw / 2, 160, bw, 40, 20, 'rgba(74,32,104,.80)');
        ctx.lineWidth = 2; ctx.strokeStyle = '#d9b6f5'; ctx.beginPath();
        ctx.roundRect(W / 2 - bw / 2, 160, bw, 40, 20); ctx.stroke();
        Engine.text(ctx, label, W / 2, 188, { size: 22, align: 'center', color: '#f4e6ff', stroke: false });
      }
      if (!ending && cornerVisible) {
        /* 画一个圆角键：fast = 倍速（蓝色，>1× 时才亮）；否则是跳过（绿色）。 */
        const drawKey = (b, label, fast) => {
          rounded(b.x, b.y + 5, b.w, b.h, 34, fast ? '#0d2a45' : '#23350a');
          const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
          if (fast) { g.addColorStop(0, '#8fd8ff'); g.addColorStop(.4, '#4aa8ee'); g.addColorStop(1, '#1c6fbe'); }
          else { g.addColorStop(0, '#cefa79'); g.addColorStop(.4, '#98df41'); g.addColorStop(1, '#6cac18'); }
          rounded(b.x, b.y, b.w, b.h, 34, g);
          ctx.lineWidth = 4; ctx.strokeStyle = fast ? '#123c63' : '#374f11'; ctx.stroke();
          Engine.text(ctx, label, b.x + b.w / 2, b.y + b.h / 2 + Math.round(cornerFont * 0.36),
            { size: cornerFont, align: 'center', color: '#fff', strokeColor: fast ? '#123c63' : '#432715', lineWidth: 7 });
        };
        if (cornerRects.speed) drawKey(cornerRects.speed, speed + '×', speed > 1);
        if (cornerRects.skip) drawKey(cornerRects.skip, '跳过', false);
      }
    }
    function render(now) {
      if (stopped) return;
      const dt = Math.min(100, Math.max(0, now - last)) * speed; last = now;
      if (pickups && combatStarted && !ending && !skipped && !document.hidden) pickups.tick(dt);
      Engine.updatePlayer(player, dt); scenePlayers.forEach((p) => Engine.updatePlayer(p, dt));
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (shake > 0) { ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake); shake = Math.max(0, shake - dt * .04); }
      drawScene(); Engine.drawPlayer(ctx, player); ctx.restore();
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i]; f.age += dt;
        if (f.age > 1100) { floaters.splice(i, 1); continue; }
        const rise = Math.min(55, f.age * .05), scale = 1 + Math.sin(Math.min(1, f.age / 200) * Math.PI) * .2;
        ctx.save(); ctx.globalAlpha = Math.min(1, (1100 - f.age) / 450);
        const h = (f.big ? 62 : 48) * scale;
        if (/^[+-]?\d+$/.test(f.text) && Engine.drawNumber(ctx, 'fightNum_' + f.color, f.text, f.x, f.y - rise, { align: 'center', h })) {}
        else Engine.text(ctx, f.text, f.x, f.y - rise + 35, { align: 'center', size: f.big ? 40 : 30, color: f.color === 'g' ? '#a8fa54' : '#ffe147', strokeColor: '#6a240b', lineWidth: 6 });
        ctx.restore();
      }
      drawHud();
      if (countdown != null) {
        const size = Engine.frameSize('go', countdown);
        if (size) Engine.drawSprite(ctx, 'go', countdown, W / 2 - size.w / 2, 300 - size.h / 2, size.w, size.h);
      }
      raf = requestAnimationFrame(render);
    }

    async function reaction(side, r) {
      const f = fighters[side];
      let name = f.npc ? npcAnim(f.npc, 'hit') : 'hitMe', fx = f.npc ? f.npc + '_effect_hitMe' : 'effect_hitMe';
      if (r.dodge) { name = f.npc ? npcAnim(f.npc, 'dodge') : 'runAround'; fx = f.npc ? f.npc + '_effect_runAround' : 'effect_runAround'; }
      else if (!f.npc && r.fakeDie) { name = 'skill_6'; fx = 'effect_skill_6'; }
      else if (!f.npc && r.jueDui) { name = 'skill_16'; fx = 'effect_skill_16'; }
      else if (!f.npc && r.guiJia) { name = 'skill_7'; fx = 'effect_skill_7'; }
      else if (!f.npc && r.action === 'skill' && r.id === 18) {
        const variant = r.disarmApplied ? 2 : 1;
        name = 'skill_18_' + variant; fx = 'effect_skill_18_defend_' + variant;
      }
      else if (!f.npc && r.action === 'skill' && SKILL_DEFEND[r.id]) [name, fx] = SKILL_DEFEND[r.id];
      if (!Engine.hasAnim(name)) name = f.npc ? npcAnim(f.npc, 'idle') : 'hitMe';
      effect(fx, side);
      await action(side, name);
      // APK 的松鼠闪避只有后撤帧；反向播放同一组帧平滑归位。
      if (r.dodge && !f.npc && !aborted()) await action(side, name, { reverse: true, fps: 30 });
    }
    async function returnHome(side, name, moved) {
      if (aborted() || fighters[side].dead) return;
      const f = fighters[side];
      if (moved) {
        const back = f.npc ? npcAnim(f.npc, 'back') : 'fanhui';
        if (Engine.hasAnim(back)) { effect(f.npc ? f.npc + '_effect_runBack' : 'effect_runBack', side); await action(side, back); }
      }
      idle(side);
    }
    async function playRound(r) {
      const att = r.attacker, def = 1 - att, f = fighters[att];
      const beforeHp = hps.slice();
      const beforeMax = maxHp.slice();
      if (r.action === 'dot') { applyHp(r); floater(r.selfDot ? att : def, '-' + r.dmg, 'y'); if (r.noteText) floater(r.noteSide != null ? r.noteSide : att, r.noteText, 'y'); await wait(400); return; }
      if (r.action === 'buff') {
        /* 塔 buff：回合开始的自增益（越战越勇 / 后发制人 / 玉石俱焚）——
         * 没有伤害也没有治疗，只飘一行字说明，别掉进下面的攻击分支播动画。
         * 但「玉石俱焚」会同时压低**双方的血量上限**，所以要把上限与当前血量
         * 一起更新到血条上（否则玩家在战斗里只看到飘字、看不到上限变化）。 */
        const capResult = applyRoundCaps(maxHp, hps, r);
        if (r.noteText) floater(r.noteSide != null ? r.noteSide : att, r.noteText, 'y');
        /* 上限被压下来了：两边各飘一次新上限，配合血条数字一起看得到效果。 */
        if (capResult.capped) {
          for (const side of [0, 1]) {
            if (Number(r.maxHp[side]) < beforeMax[side]) floater(side, '上限 ' + maxHp[side], 'y');
          }
        }
        await wait(320);
        return;
      }
      if (r.action === 'regen') {   // 塔机制/buff：回合开始回复（百草回春/活血丹/回春术）
        applyHp(r); floater(att, '+' + r.heal, 'g'); if (r.noteText) floater(att, r.noteText, 'y');
        await wait(420); return;
      }
      if (r.action === 'rest' || r.action === 'stunned') {
        applyHp(r); floater(att, r.action === 'rest' ? '休息' : '眩晕', 'y');
        // 思考气泡里画的是方天画戟，只有蓄力方天画戟的休息回合才能播放；眩晕回合只飘字
        if (r.preparingWeapon === 1 && !f.npc) { effect('effect_skill_11', att); await action(att, 'commonThink'); idle(att); }
        else await wait(500);
        return;
      }
      let name, fx, weaponLabel = null;
      if (f.npc) {
        name = npcAnim(f.npc, r.action === 'skill' ? 'skill' : 'common');
        fx = f.npc + (r.action === 'skill' ? '_effect_skillAttack' : '_effect_commonAttack');
        if (r.ultName) floater(att, r.ultName, 'r', true);
      } else if (r.action === 'weapon') {
        name = isThrowing(r.id) ? 'fightThrowWeaponAttack' : 'fightWeaponAttack';
        fx = isThrowing(r.id) ? 'effect_throw' : 'effect_weapon'; weaponLabel = weaponLabelFor(r.id, r.level || 1);
      } else if (r.action === 'skill') {
        name = 'skill_' + (r.id === 12 ? 9 : r.id); fx = 'effect_' + name;
        floater(att, nameOf(skillsMap, r.id, '技能'), 'y');
      } else { name = 'fightCommonAttack'; fx = 'effect_commonAtack'; }
      if (!Engine.hasAnim(name)) { name = f.npc ? npcAnim(f.npc, 'idle') : 'fightCommonAttack'; fx = null; }
      const frames = Engine.anim(name), hit = Math.min(frames.length - 1, HIT_FRAME[name] || Math.floor(frames.length * .55));
      let didHit = false, defending = Promise.resolve();
      function impact() {
        if (didHit || aborted()) return;
        didHit = true; applyHp(r, true, beforeHp);
        if (r.dodge) { floater(def, '闪避', 'y', true); defending = reaction(def, r); }
        else if (r.noDmg) {
          if (r.healSelf) floater(att, '+' + r.healSelf, 'g');
          if (r.buffUp) floater(att, '属性提升', 'g');
        }
        else {
          defending = reaction(def, r);
          if (r.dmg) floater(def, '-' + r.dmg, r.crit ? 'y' : 'r', !!r.crit);
          if (r.crit) { floater(def, '暴击', 'y', true); shake = 12; }
          if (r.hits > 1 || r.multiHit > 1) floater(def, (r.hits || r.multiHit) + '连击', 'y');
          if (r.fakeDie) floater(def, '装死', 'y');
          if (r.jueDui) floater(def, '绝对防御', 'y');
          if (r.debuffText) floater(def, r.debuffText, 'y');
          if (r.lifesteal) floater(att, '+' + r.lifesteal, 'g');
          if (r.reboundHurt) floater(att, '-' + r.reboundHurt, 'r');
          if (r.selfBurn) floater(att, '-' + r.selfBurn, 'r');
          // 挑战塔：护盾吸收 / 荆棘反弹 / 机制提示（狂暴·禁锢·吞噬·瞬杀·毒藤·金蝉脱壳·涅槃）
          if (r.shellAbsorb) floater(def, '护盾-' + r.shellAbsorb, 'y');
          if (r.thornsDmg) floater(att, '-' + r.thornsDmg, 'r');
          if (r.noteText) floater(r.noteSide != null ? r.noteSide : att, r.noteText, 'y');
        }
      }
      effect(fx, att, { weaponLabel });
      await action(att, name, { weaponLabel, onFrame: (frame) => { if (frame === hit) impact(); } });
      if (!didHit && !aborted()) impact();
      await defending;
      if (aborted()) return;
      const moved = !f.npc ? (name === 'fightCommonAttack' || name === 'fightWeaponAttack') : name === f.npc + '_common_attack' && f.npc !== 'xh';
      let recoveredFromCounter = false;
      // 反击原版使用 beatBack；进攻者仍停在接近后的动作末帧，不提前瞬移回待机。
      if ((r.counterDmg || r.counterFakeDie || r.counterRebound) && hps[def] > 0) {
        floater(def, '反击', 'y');
        const counterName = fighters[def].npc ? fighters[def].npc + '_beatBack' : 'beatBack';
        let counterHit = false, counterReaction = Promise.resolve();
        const counterImpact = () => {
          if (counterHit || aborted()) return; counterHit = true; applyHp(r);
          if (r.counterDmg) floater(att, '-' + r.counterDmg, 'r');
          if (r.counterFakeDie) {
            floater(att, '装死', 'y');
            counterReaction = reaction(att, { fakeDie: true });
            return;
          }
          if (r.counterRebound) {
            floater(att, '绝对防御', 'y'); floater(def, '-' + r.counterRebound, 'r');
            counterReaction = reaction(att, { jueDui: true });
            return;
          }
          const hurt = moved ? (f.npc ? f.npc + '_hurtRunBack' : 'bjBack') : (f.npc ? npcAnim(f.npc, 'hit') : 'hitMe');
          if (Engine.hasAnim(hurt)) {
            effect(moved ? (f.npc ? f.npc + '_effect_hurtRunBack' : 'effect_hurtRunBack') : (f.npc ? f.npc + '_effect_hitMe' : 'effect_hitMe'), att);
            counterReaction = action(att, hurt); recoveredFromCounter = moved;
          }
        };
        effect(fighters[def].npc ? fighters[def].npc + '_effect_beatBack' : 'effect_beatBack', def);
        if (Engine.hasAnim(counterName)) await action(def, counterName, { onFrame: (frame) => { if (frame === 4) counterImpact(); } });
        counterImpact();
        await counterReaction;
      }
      applyHp(r);
      await returnHome(att, name, moved && !recoveredFromCounter);
      idle(def);
      await wait(170);
    }
    async function perform() {
      idle(0); idle(1); raf = requestAnimationFrame(render);
      // 原版开场为 3、2、1、GO，runAround 是闪避动画，不能拿来循环入场。
      for (const n of ['1', '2', '3', '0']) { if (aborted()) break; countdown = n; await wait(n === '0' ? 500 : 420); }
      countdown = null;
      combatStarted = true;
      for (let i = 0; i < result.rounds.length; i++) {
        if (aborted()) break;
        round = Math.max(0, 99 - i); await playRound(result.rounds[i]);
      }
      if (stopped) return;
      ending = true; for (const b of cornerDom) b.remove();
      if (pickups) pickups.close();
      const finalRound = result.rounds[result.rounds.length - 1]; if (finalRound) applyHp(finalRound);
      // skip 唤醒当前动作后直接完成；自然结束保留倒地末帧和胜利演出。
      if (!skipped) {
        const winner = result.winner, loser = 1 - winner;
        fighters[loser].dead = true;
        const dead = fighters[loser].npc ? npcAnim(fighters[loser].npc, 'die') : 'die';
        effect(fighters[loser].npc ? fighters[loser].npc + '_effect_die' : 'effect_dead', loser);
        await action(loser, Engine.hasAnim(dead) ? dead : npcAnim(fighters[loser].npc, 'idle'));
        const win = fighters[winner].npc ? npcAnim(fighters[winner].npc, 'win') : 'win';
        effect(fighters[winner].npc ? fighters[winner].npc + '_effect_win' : 'effect_win', winner);
        await action(winner, Engine.hasAnim(win) ? win : npcAnim(fighters[winner].npc, 'idle'));
        await wait(450);
      }
      if (stopped) return;
      stopped = true; clean(); if (activeController === controller) activeController = null;
      // 结算方需要「战斗结束时的剩余血量」（关卡连战要按比例继承）。
      // Sim.simulate 只在逐帧 r.hpAfter 上给血量，这里把最后一帧提到 result 上。
      const hpRound = [...result.rounds].reverse().find((x) => x && Array.isArray(x.hpAfter) && x.hpAfter.length === 2);
      result.hpAfter = hpRound ? [Math.max(0, hpRound.hpAfter[0]), Math.max(0, hpRound.hpAfter[1])] : null;
      const loot = pickups ? pickups.summary() : { items: [], ups: [] };
      if (loot.items.length) result.pickups = loot.items;
      if (opts.onEnd) opts.onEnd(result.winner, result, loot);
    }
    perform().catch((error) => { controller.cancel(); console.error('[battle]', error); if (opts.onError) opts.onError(error); });
    return controller;
  }
  /* ============================================================
   * 【BT4】导出 window.Battle
   * ============================================================ */
  window.Battle = {
    /* 内部纯函数（供 tools/*.cjs 直接单测；游戏逻辑不依赖它） */
    _applyRoundCaps: applyRoundCaps, _cornerLayout: cornerLayout,
    run, makeAvatar, REGIONS, weaponLabelFor, isThrowing };
})();
