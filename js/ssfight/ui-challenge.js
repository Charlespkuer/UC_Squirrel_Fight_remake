// 页根 7638 的 9 个非空帧：1 好友 / 2 随机 / 3 关卡 / 4 竞技场规则 / 5 报名 / 6 首屏 /
// 7 天梯菜单 / 8 天梯榜 / 9 奖励说明。
(function () {
  'use strict';

  // 公共交互件（量热区 / 动效壳 / 按下闪 / 钉帧 / 数字精灵）在 ui-main.js 实现并导出。
  const T = () => (window.SfUiMain && window.SfUiMain.toolkit) || null;
  const S = () => (window.State && State.state && State.state()) || null;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TABS = [['tab', 'random'], ['tab1', 'friends'], ['tab2', 'arena'], ['tab3', 'gates']];
  const PAGE = { friends: 1, random: 2, gates: 3, arena: 6 };
  // 竞技场子页帧：4 规则 / 5 报名 / 6 首屏 / 7 菜单 / 8 天梯榜 / 9 奖励说明。
  const ARENA = { rules: 4, join: 5, home: 6, menu: 7, ladder: 8 };

  // 复刻偏差：点行 = 选中（右侧显示力敏速命），点右端拳套卡 s1..s4 = 开战；
  let current = null;
  // 随机挑战名单缓存：离开随机页再回来不刷新；只缓存随机页那一批，
  // 新档 / 读档（State.state() 换对象）后自动作废；手动刷新或打完一场仍会清空。
  let randomCache = null;
  let seq = 0;
  // 刷新玩家不扣金松果，最多 10 次；随机挑战开始或超过 10 分钟重置。
  const REFRESH_LIMIT = 10;
  const REFRESH_WINDOW = 10 * 60 * 1000;
  let refreshTimer = 0;
  function clearRefreshTimer() {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = 0; }
  }
  function refreshState() {
    const s = S(), now = Date.now();
    let rf = (s && s.challengeRefresh) || {};
    if (!Number.isFinite(rf.count) || !Number.isFinite(rf.ts) || now - rf.ts > REFRESH_WINDOW) {
      rf = { count: 0, ts: now };
      if (s) s.challengeRefresh = rf;
    }
    rf.count = Math.max(0, Math.min(REFRESH_LIMIT, Number(rf.count) || 0));
    return rf;
  }
  function refreshRemaining(rf) {
    return Math.max(0, REFRESH_LIMIT - Math.max(0, Number(rf && rf.count) || 0));
  }

  // 原版 relation（服务端下发）→ 两套帧号：s1..s4 关系标志 7251：
  const REL = { friend: 0, prentice: 1, master: 2, stranger: 3, dummy: 4 };
  const relOf = (foe) => {
    if (foe && foe.dummy) return REL.dummy;
    // 原版随机页对手一律是陌生人（服务端 getFriends("random") 强制 relation=3），
    if (current && current.tab === 'random') return REL.stranger;
    if (foe && foe.kind === 'master') return REL.master;
    if (foe && foe.kind === 'prentice') return REL.prentice;
    return REL.friend;
  };
  // 木人必须走第 3 帧：原版把 relation==4 与 0/3/null 并列 gotoAndStop(3)，
  // 7251 只有 7 帧（2 徒弟 / 4 -1 / 5 -2 / 6、7 空档），没有木人专用标志帧。
  const RELATION_BADGE = { '-2': 5, '-1': 4, '0': 3, '1': 2, '2': 1, '3': 3, '4': 3 };
  function relationFrame(foe) {
    return RELATION_BADGE[String(relOf(foe))] || 3;
  }
  const MENU_CASE = (rel) => {
    switch (rel) {
      case REL.master: return 2;     // 我的师父
      case REL.prentice: return 3;   // 我的徒弟
      case REL.stranger: return 5;   // 陌生人
      case REL.dummy: return 6;      // 测攻击木头人
      default: return 1;             // 好友（actionType 4「陪练」复刻用不到）
    }
  };
  const clipOf = (host, name) => (host && host.byName ? host.byName(name) : null);
  function stopAt(clip, n) {
    if (!clip || !clip.gotoAndStop) return;
    try { clip.gotoAndStop(n); } catch (e) {}
  }
  function setText(clip, str) {
    const t = T();
    if (t && clip) t.setText(clip, str == null ? '' : String(str));
  }
  function tabClip(view, name) {
    const direct = clipOf(view, name);
    if (direct) return direct;
    const tap = clipOf(view, 'tiaozhanTap');
    return tap && tap.byName ? tap.byName(name) : null;
  }
  // 字号来自 textfields.json，改这两个常量即可。⚠ 换帧会重建文本节点（导出放置带 rp），
  // 所以每次换帧后都要 repaintRows()，否则选中别的敌人后原行名字会变回占位串。
  const ROW_BADGE = { x0: -1, x1: 18.05, y0: -8.95, y1: 9.45 };   // 元件 7233（等级徽章）局部框
  const LEVEL_MA = { x: 1.9, y: -6.95 };                          // 元件 7235 的放置平移
  const LEVEL_FONT = 14;                                          // 元件 7235 的字号（textfields.json）
  const LEVEL_INK = 0.714;                                        // 数字墨高 / 字号（实测）
  // 昵称落点微调（舞台单位）：两个常量集中在这里，改这一处即可。
  const NAME_DY = 3.4;                                            // 昵称相对字段框的下移量（舞台单位）
  const NAME_DX = 1.2;                                            // 昵称右移量（舞台单位）
  function alignRowText(row) {
    if (!row || !row.byName) return;
    const lg = row.byName('flevel');
    const lnode = lg && (lg.g || lg);
    if (lnode && lnode.querySelectorAll) {
      const x = (ROW_BADGE.x0 + ROW_BADGE.x1) / 2 - LEVEL_MA.x;
      const y = (ROW_BADGE.y0 + ROW_BADGE.y1) / 2 - LEVEL_MA.y + (LEVEL_INK * LEVEL_FONT) / 2;
      for (const t of lnode.querySelectorAll('text')) {
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('x', x);
        t.setAttribute('y', y);
      }
    }
    const ng = row.byName('friendname');
    const nnode = ng && (ng.g || ng);
    if (nnode && nnode.querySelectorAll) {
      for (const t of nnode.querySelectorAll('text')) {
        if (t.__rowBaseY == null) t.__rowBaseY = Number(t.getAttribute('y') || 0);
        if (t.__rowBaseX == null) t.__rowBaseX = Number(t.getAttribute('x') || 0);
        t.setAttribute('y', t.__rowBaseY + NAME_DY);
        t.setAttribute('x', t.__rowBaseX + NAME_DX);
      }
    }
  }
  function setVisible(clip, on) {
    if (clip && clip.g) clip.g.style.visibility = on ? '' : 'hidden';
  }
  // 换帧/换页会把 <g> 子节点整个重建，动效壳与点击区要补回来。
  function refreshShell(clip) {
    const t = T();
    if (!t || !clip || !clip.g) return;
    t.popWrap(clip);
    const shell = clip.g.querySelector(':scope > g.uc-pop');
    if (shell) t.wirePopPress(shell);
  }
  // 与状态页同一套写法，见 ui-status.js。
  function wireClickable(clip, spec) {
    const t = T();
    if (!t || !clip || !clip.g) return;
    spec = spec || {};
    const idleOf = () => (typeof spec.idle === 'function' ? spec.idle() : (spec.idle == null ? 1 : spec.idle));
    clip.__pinFrame = null;
    clip.__chFire = spec.onFire || null;
    clip.__chIdle = idleOf;
    clip.__chAfter = spec.after || null;
    clip.__chHover = Number(spec.hover) || 0;
    clip.__chPress = Number(spec.press) || 0;
    // 回调每次 wireClickable 都刷新（闭包里的行号会变），监听只挂一次。
    clip.__chHoverCb = spec.onHover || null;
    if (!clip.__chListeners) {
      clip.__chListeners = true;
      clip.g.addEventListener('mouseenter', () => {
        if (clip.__chHoverCb) clip.__chHoverCb();
        if (!clip.__chHover) return;
        stopAt(clip, clip.__chHover);
        refreshShell(clip);
        if (clip.__chAfter) clip.__chAfter();
      });
      clip.g.addEventListener('mouseleave', () => {
        stopAt(clip, clip.__chIdle ? clip.__chIdle() : 1);
        refreshShell(clip);
        if (clip.__chAfter) clip.__chAfter();
      });
      clip.g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (clip.__chPress) t.pressFlash(clip, clip.__chIdle ? clip.__chIdle() : 1, () => refreshShell(clip));
        if (clip.__chAfter) clip.__chAfter();
        if (clip.__chFire) clip.__chFire();
      });
    }
    // 下面这段每次调用都要跑：unwire() 会把元件从点击路由摘掉，而随机页第 4 行
    // 是先被当空槽注销、再重新接上的；写成“接过线就 return”会让「刷新玩家」收不到点击。
    stopAt(clip, idleOf());
    clip.g.style.cursor = 'pointer';
    clip.g.style.pointerEvents = 'auto';
    t.measureHitBox(clip);
    t.popWrap(clip);
    const shell = clip.g.querySelector(':scope > g.uc-pop');
    if (shell) t.wirePopPress(shell);
    if (clip.__chAfter) clip.__chAfter();
  }
  // 换页会重建子树，热区登记表里会留下已不在树上的元件；清空重来，否则表会一直长。
  function resetHits(svg) {
    const t = T();
    if (!t || !svg) return;
    const r = t.routerOf(svg);
    r.list.length = 0;
    r.hovered = null;
  }

  const FACE_PARTS = [
    { type: 0, cells: [['mc_head', 0]] },
    { type: 1, cells: [['mc_fistL', 0], ['mc_fistR', 1]] },   // 外拳套 / 内拳套
    { type: 2, cells: [['mc_body', 0], ['mc_handL', 1], ['mc_handR', 1]] },  // 衣服 / 手臂×2
    { type: 3, cells: [['mc_footL', 0], ['mc_footR', 0]] },
  ];
  let gearTables = null;
  async function loadGearTables() {
    if (gearTables) return gearTables;
    const j = (f) => SfRender.loadTable(f).catch(() => null);
    const [frames, slots] = await Promise.all([j('gear-frames.json'), j('gear-slots.json')]);
    if (!frames || !slots) return null;
    const cont = {};
    // showFace 的挂点用非 B 立绘容器；B 容器服务战斗骨骼，注册原点不同，不能共用。
    for (const c of slots.portraitContainer || []) cont[c.type] = c.ids;
    // 橙装有原版 q4 id；只带 orange:true 的实例仍兼容。橙稿帧按同部位同名字的 q4 帧查，
    // 与状态页 / 战斗 planSide 同一条规则。
    const keyOf = (g) => Number(g.type) + '|' + String(g.name || '');
    const q4 = new Map();
    for (const g of frames.gear || []) if (Number(g.quality) === 4) q4.set(keyOf(g), g.frame);
    const orangeFrameById = new Map();
    for (const g of frames.gear || []) {
      if (Number(g.quality) !== 3) continue;
      const f = q4.get(keyOf(g));
      if (f) orangeFrameById.set(Number(g.id), f);
    }
    gearTables = { frameById: new Map((frames.gear || []).map((g) => [Number(g.id), g.frame])), orangeFrameById, cont: cont };
    return gearTables;
  }
  function showFace(bg, byType) {
    if (!bg || !gearTables) return 0;
    let n = 0;
    for (const row of FACE_PARTS) {
      const g = byType[row.type];
      const orange = !!(g && (g.orange === true || Number(g.quality) > 3));
      const base = g
        ? ((orange && gearTables.orangeFrameById && gearTables.orangeFrameById.get(Number(g.id))) ||
           gearTables.frameById.get(Number(g.id)))
        : 0;
      // 附加属性是数组，只对头/拳套用最大强化档；衣服/鞋子跨档会变另一套画稿，不能加偏移。
      const raw = g && g.ext;
      const extMax = Math.max(0, Math.min(3, Array.isArray(raw)
        ? raw.reduce((m, e) => Math.max(m, Number(e && e.level) || 0), 0)
        : Number(raw) || 0));
      const addr = (row.type === 0 || row.type === 1) && extMax > 0 ? extMax - 1 : 0;
      const frame = base ? base + addr : 0;
      for (const pair of row.cells) {
        const clip = bg.byName ? bg.byName(pair[0]) : null;
        if (!clip || !clip.detachAll) continue;
        clip.detachAll();
        if (!frame) continue;
        const sym = gearTables.cont[row.type] && gearTables.cont[row.type][pair[1]];
        if (!sym) continue;
        if (clip.attachChild(sym, frame, 'wear')) n++;
      }
    }
    return n;
  }
  // 战力（原版 user.totalharm）：对手所有武器伤害上限之和，与战斗里用的同一份数据。
  function totalHarm(foe) {
    let sum = 0;
    for (const w of (foe && foe.weapons) || []) {
      try { const inst = State.weaponInst(w); if (inst) sum += Number(inst.harmHi) || 0; } catch (e) {}
    }
    return sum;
  }
  // 四维是文本字段 7220-7223，原版 showPic2 用 setText；不能用 showNumber（数字精灵写不进去）。
  function paintStats(view, foe) {
    const bg = clipOf(view, 'rightBg');
    if (!bg || !bg.byName) return;
    const fields = [['power', 'power'], ['agility', 'agility'], ['speed', 'speed'], ['hp', 'hp']];
    for (const f of fields) {
      const c = bg.byName(f[0]);
      if (c) setText(c, foe ? String(Math.max(0, Math.round(Number(foe[f[1]]) || 0))) : '');
    }
    if (window.SfUiMain) SfUiMain.showNumber(foe ? totalHarm(foe) : 0, bg, 0, 0, 'left', 5);
  }
  /** 木桩那一档专用：`rightBg` 的第 3 帧里**没有**四维字段与战斗力数字精灵，
   *  所以只在字段确实存在时才写（拿不到就什么都不做，不要去 `paintStats` 里空转）。 */
  function paintStatsIfPresent(view, bg, foe) {
    const hasField = bg.byName && bg.byName('power');
    if (!hasField) return;
    paintStats(view, foe || null);
  }
  function showUserPic(view, foe) {
    const bg = clipOf(view, 'rightBg');
    if (!bg) return;
    // 测攻击木头人是真实一行数据（kind:'dummy', relation:4），也必须走木桩档，否则停 f1 画成松鼠。
    const dummy = !!(foe && (foe.dummy || foe.kind === 'dummy' || foe.kind === 'wood'));
    stopAt(bg, dummy ? 3 : (foe ? 1 : 3));
    refreshShell(bg);
    if (!foe || dummy) {
      /* 木桩那一档**没有四维字段、也没有战斗力那一排位图数字**（f3 里 `hp`/`power`/`num1..5`
       * 都已经被 `rm` 掉了），所以这里不能照常写值 —— `byName` 拿不到就什么也不写。 */
      paintStatsIfPresent(view, bg, foe);
      return;
    }
    const byType = [];
    for (const g of foe.gears || []) {
      /* `genAI` 抽出来的装备只有 `{id, ext, used}`，**没有 `type`** —— 部位要从装备字典里反查
       * （`State.gearPart(id)`）。少了这一步就整件都贴不上去（右侧立绘空着）。 */
      const ty = Number(g.type != null ? g.type : (State.gearPart ? State.gearPart(g.id) : NaN));
      if (!Number.isFinite(ty)) continue;
      if (byType[ty] === undefined) byType[ty] = g;
    }
    showFace(bg, byType);
    paintStats(view, foe);
  }

  function rollRoster() {
    const s = S();
    const out = [];
    for (let i = 0; i < 3; i++) {
      try { out.push(State.genAI(Math.max(1, (s ? s.level : 1) + i - 1), '', { levelJitter: 2, minLevel: 1, statScale: State.RANDOM_FOE_SCALE || 1.08 })); }
      catch (e) { out.push(null); }
    }
    return out;
  }
  function friendRoster() {
    const list = (State.friendList ? State.friendList() : []) || [];
    // gears / weapons 是 State.addFriend 存下的好友自己那套（原版服务端下发）；
    // 缺字段的老档由 ensureFriendLoadout 按等级就地补并写回存档，否则右侧空立绘 + 战力 0。
    const friends = list.map((f) => {
      const fr = (State.ensureFriendLoadout ? State.ensureFriendLoadout(f) : f) || f;
      return {
        name: fr.name, level: fr.level, power: fr.power, agility: fr.agility, speed: fr.speed, hp: fr.hp,
        gears: fr.gears || [], weapons: fr.weapons || [], kind: 'friend', friend: true,
      };
    });
    // 好友页名单顺序 = 师徒 → 木头人 → 好友（原版 friendsArray 也把师徒排在好友前，
    const out = [];
    const s = (S() || {});
    const seen = new Set();
    const push = (row) => {
      if (!row || !row.name) return;
      const key = String(row.name).trim();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(row);
    };
    if (s.master && s.master.name) push(foeRow(s.master, 'master'));
    for (const p of (s.prentices || [])) push(foeRow(p, 'prentice'));
    push(dummyRow(s));
    // 师徒 / 木人已在最前：好友里同名的（先加好友后拜师）直接跳过，
    // 否则会在第二页再出现一次。
    for (const f of friends) push(f);
    return out;
  }
  // 师徒条目 → 一行数据：ensureFriendLoadout 要作用在**原对象**上（新造的壳只有 name/level，
  // 三维会全 undefined 落到 ||1）；返回的整套字段（含 weapons/skills/gears）都要带出来。
  function foeRow(src, kind) {
    if (!src || !src.name) return null;
    const s = S() || {};
    const lv = Math.max(1, Math.round(Number(src.level) || Number(s.level) || 1));
    // 只有 {name, level} 的师徒：三维现算一份用于显示，不写回存档（拜师/收徒时已定）。
    if (src.power == null) {
      const rolled = (State.ensureFriendLoadout
        ? State.ensureFriendLoadout({ name: src.name, level: lv })
        : null) || { name: src.name, level: lv };
      return Object.assign({}, rolled, {
        name: src.name, level: lv, kind: kind, friend: kind !== 'dummy', row: src,
        weapons: (rolled.weapons || []).slice(), skills: (rolled.skills || []).slice(),
        gears: (rolled.gears || []).slice(),
      });
    }
    // 有三维（正常路径）：ensureFriendLoadout 就地补装备，补的是**同一个对象**，返回的也是它。
    const full = (State.ensureFriendLoadout ? State.ensureFriendLoadout(src) : src) || src;
    return {
      name: src.name, level: lv,
      power: Number(full.power) || 1, agility: Number(full.agility) || 1,
      speed: Number(full.speed) || 1, hp: Number(full.hp) || 1,
      weapons: (full.weapons || []).slice(), skills: (full.skills || []).slice(),
      gears: (full.gears || []).slice(),
      kind: kind, friend: kind !== 'dummy', row: src,
    };
  }
  // 走 Stakes 木桩类，不判死亡、每回合回满，所以是固定回合训练场；生命最低保留 1，
  // 伤害按真实数值记录；回合数见 DUMMY.rounds（原版全局 maxRounds=60，这里固定 10）。
  const DUMMY = {
    id: 400, name: '测攻击木头人', level: 1,
    power: 0, agility: 15, speed: 0, hp: 800,
    rounds: 10,                 // 固定训练回合（原版 maxRounds=60；木桩本身不会死）
  };
  function dummyRow(s) {
    return {
      name: DUMMY.name, level: DUMMY.level,
      power: DUMMY.power, agility: DUMMY.agility, speed: DUMMY.speed, hp: DUMMY.hp,
      gears: [], weapons: [], skills: [],
      kind: 'dummy', npcType: 'wood', dummy: true, friend: true, count: 10000,
      record: {
        count: Number((s || {}).woodCount) || 0,
        rounds: DUMMY.rounds,
        damage: Number((s || {}).woodDamage) || 0,
      },
    };
  }

  // 原版文本字段不会自动折行（SVG <text> 也不会）：字段框宽见 __textBox.meta.bd
  // （例：info1=4730 宽 127、desc=7276 宽 271），原版文案由服务端断好，这里必须自己断。
  function wrap(text, per) {
    const out = [];
    for (const para of String(text == null ? '' : text).split('\n')) {
      let line = '';
      for (const ch of para) {
        line += ch;
        if (line.length >= per) { out.push(line); line = ''; }
      }
      out.push(line);
    }
    return out.join('\n');
  }
  // 纵向画到框外（render.js 只裁宽、不裁高）。fitText 用 canvas 量一次单位字号字宽并缓存，
  const charWCache = new WeakMap();
  let measureCtx = null;
  function charUnit(clip) {
    const tb = clip && clip.__textBox;
    if (!tb || !tb.meta || !tb.meta.bd) return null;
    if (charWCache.has(clip)) return charWCache.get(clip);
    let w = 1, font = '', fontSize = 12;
    try {
      // 字体/字号从画出来的 <text> 上读（getComputedStyle 会解析成最终字体列表），
      // 量出来的宽度与渲染一致；读不到再退回导出里的 h / 默认字体。
      const t = clip.g && clip.g.querySelector ? clip.g.querySelector('text') : null;
      if (t && window.getComputedStyle) {
        const cs = getComputedStyle(t);
        fontSize = parseFloat(cs.fontSize) || 12;
        font = fontSize + 'px ' + (cs.fontFamily || 'SimHei');
      }
      if (!font) {
        fontSize = (tb.lines[0] && tb.lines[0].h) || tb.meta.fh || 12;
        font = fontSize + 'px SimHei,"Microsoft YaHei",sans-serif';
      }
      if (!measureCtx) {
        const cv = document.createElement('canvas');
        measureCtx = cv.getContext && cv.getContext('2d');
      }
      if (measureCtx) {
        measureCtx.font = font;
        w = measureCtx.measureText('国').width / fontSize;
      }
    } catch (e) { /* 量不到就按 1em（全角）估 */ }
    if (!(w > 0.2 && w < 3)) w = 1;
    charWCache.set(clip, w);
    return w;
  }
  function fieldWidth(clip) {
    const tb = clip && clip.__textBox;
    if (!tb || !tb.meta || !tb.meta.bd) return null;
    const w = tb.meta.bd[1] - tb.meta.bd[0] - (tb.meta.lm || 0) - (tb.meta.rm || 0);
    return w > 8 ? w : null;
  }
  function fitText(clip, text) {
    const W = fieldWidth(clip);
    const u = charUnit(clip);
    if (!W || !u) return wrap(text, 12);              // 量不到退回按 12 字硬断
    const tb = clip.__textBox;
    const fontSize = (tb.lines[0] && tb.lines[0].h) || tb.meta.fh || 12;
    const per = Math.max(4, Math.floor(W / (u * fontSize)));
    const out = [];
    for (const para of String(text == null ? '' : text).split('\n')) {
      let line = '', wid = 0;
      for (const ch of para) {
        const adv = ch.charCodeAt(0) < 0x2E80 ? 0.55 : 1;
        if (wid + adv > per && line) { out.push(line); line = ''; wid = 0; }
        line += ch; wid += adv;
      }
      out.push(line);
    }
    return out.join('\n');
  }
  // 4756 的 info1/info2 框高只有 86 / 44：原版字号 12 时 5 行就顶到框底，
  // 缩到 11 后同样行数仍落在原框内；只改行高/行距/首行基线，不动字体与框宽。
  function setFieldText(clip, text, size) {
    if (!clip || !clip.__textBox || !size) return setText(clip, text);
    const tb = clip.__textBox;
    tb.lines = tb.lines.map((L) => Object.assign({}, L, { h: size }));
    tb.step = 1.15 * size + (tb.meta.lead || 0);
    if (tb.box) tb.base = tb.box.ymin + 2 + (tb.meta.lead || 0) + 0.88 * size;
    return setText(clip, fitText(clip, text));
  }

  function fillChrome(view) {
    const s = S(), t = T();
    if (!s || !t) return;
    // showFirendsMain :12991-12994：体力两颗数字 + 体力条蒙版。
    SfUiMain.showNumber(s.energy, clipOf(view, 'energy'), 0, 0, 'right');
    SfUiMain.showNumber(s.maxEnergy, clipOf(view, 'maxEnergy'), 0, 0, 'left');
    fitEnergy(view);
    const pct = Math.ceil(s.energy * 100 / Math.max(1, s.maxEnergy));
    stopAt(clipOf(view, 'energyMc'), Math.max(1, Math.min(101, pct + 1)));
  }
  // 原版 4315 数字与 7254 斜线一起排版：条内沿 x249.7..307.9 / y16.25..24.66，
  // 数字最大缩放 0.405（原放置 0.74 × 缩小档 0.546），斜线缩到同一字高。
  const ENERGY_FIT = { left: 255, right: 303, centerY: 20.45, height: 5.1, scale: 0.405, gap: 1.15 };
  function fitEnergy(view) {
    const energy = clipOf(view, 'energy'), max = clipOf(view, 'maxEnergy');
    const slash = view.nodes && Array.from(view.nodes.values()).find((r) => r.id === '7254');
    const nodes = [energy && energy.g, slash && slash.node, max && max.g];
    if (nodes.some((g) => !g || !g.getBBox || !g.setAttribute)) return;
    let boxes;
    try { boxes = nodes.map((g) => g.getBBox()); } catch (e) { return; }
    if (boxes.some((b) => !(b.width > 0 && b.height > 0))) return;
    const f = ENERGY_FIT;
    const slashScale = f.height / boxes[1].height;
    const numberScale = Math.min(f.scale, f.height / Math.max(boxes[0].height, boxes[2].height),
      (f.right-f.left-boxes[1].width*slashScale-2*f.gap) / (boxes[0].width+boxes[2].width));
    if (!(numberScale > 0 && isFinite(numberScale))) return;
    const scales = [numberScale, slashScale, numberScale];
    const widths = boxes.map((b, i) => b.width * scales[i]);
    let x = (f.left+f.right-widths.reduce((a, b) => a+b, 0)-2*f.gap) / 2;
    nodes.forEach((g, i) => {
      const b = boxes[i], k = scales[i];
      // getBBox 不含自身放置矩阵，所以重复刷新不会累计缩小，也不依赖窗口偏移。
      applyMatrix(g, {
        a: k, b: 0, c: 0, d: k,
        e: x-b.x*k, f: f.centerY-(b.y+b.height/2)*k,
      });
      x += widths[i]+f.gap;
    });
  }
  function applyMatrix(g, m) {
    g.setAttribute('transform', 'matrix(' + m.a + ',' + m.b + ',' + m.c + ',' + m.d + ',' + m.e + ',' + m.f + ')');
  }
  // matrix(a,b,c,d,e,f)；不是这个写法就返回 null（宁可不动也不要画歪）。
  function parseMatrix(str) {
    const m = /matrix\(\s*([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)\s*\)/.exec(String(str || ''));
    if (!m) return null;
    return { a: +m[1], b: +m[2], c: +m[3], d: +m[4], e: +m[5], f: +m[6] };
  }
  function setTabs(view, active) {
    for (const row of TABS) stopAt(tabClip(view, row[0]), row[1] === active ? 2 : 1);
  }
  function wireChrome(view, host) {
    const t = T();
    // 返回：原版回主界面 gotoAndStop("main")。竞技场 f4/f6/f7/f8 的「返回」是回上一级，
    // 由各自分支先接；这里只对“页根上真有 back”的页兜底（wireClickable 每次都重设回调）。
    wireClickable(clipOf(view, 'back'), { hover: 2, onFire: () => { destroy(); if (window.UI && UI.runAction) UI.runAction('home'); } });
    for (const row of TABS) {
      const key = row[1];
      wireClickable(tabClip(view, row[0]), {
        // 悬停 = 原版“键盘光标停在 tab 那一行” → 第 3 帧，与状态页同一套口径（见 ui-status.js）。
        hover: 3, press: 0,
        idle: () => (current && current.tab === key ? 2 : 1),
        onFire: () => showTab(key),
      });
    }
    void t;
  }

  // 否则之后对同一实例 wireClickable 会接不上回调（「刷新玩家」就这么坏过）。
  function unwire(clip) {
    const t = T();
    if (!t || !clip) return;
    clip.__chFire = null;
    clip.__chIdle = () => 1;
    if (clip.g && clip.g.style) clip.g.style.cursor = 'default';
    t.unregisterHit(clip);
  }
  function setRowTexts(row, item) {
    if (!row || !row.byName) return;
    const nameClip = row.byName('friendname');
    setText(nameClip, item ? item.name : '');
    // 7 个汉字（84 单位）放得下 88.2 的框；21 个英文字母约 126 单位。
    if (item && window.SfRender && SfRender.fitTextWidth) SfRender.fitTextWidth(nameClip, { ascii: 0.5, min: 7 });
    setText(row.byName('flevel'), item ? item.level : '');
    alignRowText(row);
  }
  function repaintRows() {
    if (!current || !current.view) return;
    const rows = current.rows || [];
    for (let i = 0; i < 4; i++) {
      if (current.refreshRow && i === 3) continue;      // 随机页第 4 行是「刷新玩家」，不是对手行
      setRowTexts(clipOf(current.view, 'f' + (i + 1)), rows[i] || null);
    }
  }
  function fillRows(view, rows, sel, pageOff) {
    const off = Number(pageOff) || 0;
    if (current) {
      const padded = [];
      for (let i = 0; i < 4; i++) padded.push(rows[i] || null);
      current.rows = padded;
      current.pageOff = off;
    }
    for (let i = 0; i < 4; i++) {
      const row = clipOf(view, 'f' + (i + 1));
      const card = clipOf(view, 's' + (i + 1));
      const item = rows[i];
      setRowTexts(row, item || null);
      // 拳套卡按 relation 切 1~5 帧，末帧空白。随机页只有 3 行，第 4 行是「刷新玩家」，
      const blank = card && card.frameCount ? card.frameCount() : 1;
      if (card) stopAt(card, item ? relationFrame(item) : blank);
      // vip1..vip4(7252) 是服务端 VIP 角标；没有数据，整颗藏掉。
      const vip = clipOf(view, 'vip' + (i + 1));
      if (vip) { stopAt(vip, 1); setVisible(vip, false); }
      if (!item) { unwire(row); unwire(card); continue; }
      const idx = i;
      const idleFrame = () => (current && current.sel === idx ? 2 : 1);
      // 这一行的命中面（原版点立绘 = 点这一行），挂同一个回调。
      const hoverSelect = () => { if (current && current.sel !== idx) selectRow(idx); };
      wireClickable(row, {
        hover: 0, press: 0,
        idle: idleFrame,
        after: repaintRows,          // 换帧重建文本 → 补回名字与等级
        onHover: hoverSelect,
        // showActionWin :23381，挂「挑战1」4756 第 1 帧）。复刻点行 = 打开动作菜单，
        onFire: () => { selectRow(idx); openFriendMenu(idx); },
      });
      wireClickable(card, {
        hover: 0, press: 0,
        idle: () => relationFrame(item),
        onHover: hoverSelect,
        onFire: () => { selectRow(idx); openFriendMenu(idx); },
      });
    }
    showUserPic(view, rows[sel] || null);
  }
  // 原版键盘光标一动就选中并换右侧，所以这里挂在 mouseenter 上，而不是只在点击时。
  // 换帧会重建行文本与 .uc-pop 壳，所以补 refreshShell + repaintRows。
  function selectRow(i) {
    if (!current) return;
    current.sel = i;
    if (current.tab === 'random' && randomCache && randomCache.state === S()) randomCache.sel = i;
    for (let k = 0; k < 4; k++) {
      const row = clipOf(current.view, 'f' + (k + 1));
      if (row && row.gotoAndStop) { stopAt(row, k === i ? 2 : 1); refreshShell(row); }
    }
    repaintRows();                                     // 换帧重建了文本节点 → 重写一遍
    showUserPic(current.view, foeAt(i));
  }
  function fightRow(i) {
    const foe = foeAt(i);
    if (!foe) return;
    if (foe.dummy) { startDummyFight(foe); return; }
    // 好友页里打人 = 切磋（不扣体力、不结算奖励）；随机页才是主动挑战（10 体力 + 奖励）。
    startFight(foe, (current && current.tab === 'friends') ? 'friend' : 'challenge');
  }
  // 打完是「战斗统计」页（手 / 武 / 技三段伤害 + 历史最高 + 排名），不是普通战果。
  // State.recordWoodBattle 保存总伤害与分项最佳；woodRecord 只保留给旧档读取。
  function startDummyFight(foe) {
    const s = S();
    if (!s || !window.Main || !Main.startBattle) return;
    const dummy = Object.assign({}, foe, {
      npcType: 'wood', name: DUMMY.name, level: DUMMY.level,
      power: DUMMY.power, agility: DUMMY.agility, speed: DUMMY.speed, hp: DUMMY.hp,
      baseStats: { power: DUMMY.power, agility: DUMMY.agility, speed: DUMMY.speed, hp: DUMMY.hp },
      weapons: [], skills: [], gears: [], effects: {},
      /* 每回合回满 800；生命锁 1，但伤害不封顶。固定 practiceRounds 次出手收尾。 */
      practice: true, practiceRounds: DUMMY.rounds,
    });
    const back = () => { SfChallenge.openAt('friends'); if (window.UI && UI.runAction) UI.runAction('challenge'); };
    Main.startBattle(dummy, {
      cost: 0, kind: 'wood', useProps: false, keepScreen: true,
      // 木桩战：不飘奖励、不开宝箱。
      collectDrops: false, skipChest: true,
      // 木桩战给的是「战斗统计」弹窗，不是奖励 CG；skipResultPanel 避免原版战果页先闪一遍
      skipResultPanel: true,
      // 经典/现代两套播放器的剩余回合数都按这一场自己的上限显示（默认 60）。
      maxRounds: DUMMY.rounds,
      onEnd: (winner, result) => {
        const record = State.recordWoodBattle(result);
        if (!record) { back(); return; }
        destroy();
        back();
        const extra = '本次总伤害 ' + record.current.total + '　固定 ' + DUMMY.rounds + ' 回合<br>' +
          '武器伤害 ' + record.current.weaponDamage + '　技能伤害 ' + record.current.skillDamage +
          '　徒手伤害 ' + record.current.handDamage + '<br>' +
          '历史最高伤害 ' + record.totalBest + '　累计训练 ' + record.count + ' 次<br>' +
          '木桩每回合恢复满血（800），生命最低为 1，伤害按实际数值记录';
        if (window.UI && window.UI.classic && UI.classic.resultModal) {
          UI.classic.resultModal(winner === 0, { exp: 0, gold: 0, ups: [] }, extra, null);
        }
      },
      onError: () => { back(); },
    }).catch(() => { back(); });
  }
  // 3 徒弟 6..9 / 4 陪练 15·16 / 5 陌生人 11..14 / 6 木人 26..28。鼠标用透明热区。
  // box = [x0, y0, x1, y1]，DOM 热区铺在这一块上（舞台单位）。
  const MENU_LAYOUT = {
    /* case 1（actionType 1）：关系 0 好友（4 项：挑战 / 返回 / 查看 / 收为徒弟）。
     * 随机页也借用这一档的紧凑面板（第四颗字形换成「加好友」，见 `captureAddFriendGlyph`）。 */
    1: { base: 1, rows: [
      { d: 0, box: [88.4, 41.9, 231.8, 65.8], act: 'fight', key: 'fight', label: '挑战Ta！' },
      { d: 1, box: [88.4, 70.2, 231.8, 94.1], act: 'back', key: 'back', label: '返回' },
      { d: 2, box: [88.4, 99.0, 231.8, 122.9], act: 'view', key: 'view', label: '查看' },
      { d: 3, box: [88.4, 127.9, 231.8, 151.8], act: 'add', key: 'add', label: '收为徒弟' },
    ] },
    /* case 2（actionType 2）：关系 2 我的师父（挑战 / 为师父加油 / 退出师门 / 查看·返回两颗）
     * 帧 20..24；第 4 行两颗分别是 23（查看）与 24（返回）。 */
    2: { base: 20, rows: [
      { d: 0, box: [88.4, 41.9, 231.8, 65.8], act: 'fight', key: 'fight', label: '挑战Ta！' },
      { d: 1, box: [88.4, 70.6, 231.8, 94.5], act: 'cheer', key: 'cheer', label: '为师父加油' },
      { d: 2, box: [88.4, 99.0, 231.8, 122.9], act: 'quitmaster', key: 'quitmaster', label: '退出师门' },
      { d: 3, x2: true, box: [88.4, 127.9, 156, 151.8], box2: [164, 127.9, 231.8, 151.8],
        act: 'view', act2: 'back', key: 'view', label: '查看', label2: '返回', d2: 4 },
    ] },
    /* case 3（actionType 3）：关系 1 我的徒弟（4 项：挑战 / 返回 / 查看 / 逐出师门），帧 6..9 */
    3: { base: 6, rows: [
      { d: 0, box: [88.4, 41.9, 231.8, 65.8], act: 'fight', key: 'fight', label: '挑战Ta！' },
      { d: 1, box: [88.4, 70.2, 231.8, 94.1], act: 'back', key: 'back', label: '返回' },
      { d: 2, box: [88.4, 99.0, 231.8, 122.9], act: 'view', key: 'view', label: '查看' },
      { d: 3, box: [88.4, 127.9, 231.8, 151.8], act: 'eject', key: 'eject', label: '逐出师门' },
    ] },
    4: { base: 15, rows: [
      { d: 0, box: [88.4, 62.3, 231.8, 86.2], act: 'fight', key: 'fight', label: '挑战Ta！' },
      { d: 1, box: [88.4, 108.9, 231.8, 132.8], act: 'back', key: 'back', label: '返回' },
    ] },
    5: { base: 11, rows: [
      { d: 0, box: [88.4, 31.9, 231.8, 55.8], act: 'fight', key: 'fight', label: '挑战Ta！' },
      { d: 1, box: [88.4, 61.6, 231.8, 85.5], act: 'back', key: 'back', label: '返回' },
      { d: 2, box: [88.4, 95.2, 231.8, 119.1], act: 'view', key: 'view', label: '查看' },
      { d: 3, box: [88.4, 127.1, 231.8, 151.0], act: 'add', key: 'add', label: '加好友' },
    ] },
    // case 6：木人（relation 4）只有 3 项：测攻击 / 查看记录 / 关闭，没有「加好友」。
    6: { base: 26, rows: [
      { d: 0, box: [88.4, 41.9, 231.8, 65.8], act: 'fight', key: 'fight', label: '测攻击' },
      { d: 1, box: [88.4, 82.6, 231.8, 106.5], act: 'record', key: 'record', label: '查看记录' },
      { d: 2, box: [88.4, 123.2, 231.8, 147.1], act: 'back', key: 'back', label: '关闭' },
    ] },
  };

  function menuHost() {
    if (current && current.sub && current.sub.host && current.sub.host.isConnected) return current.sub.host;
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const el = document.createElement('section');
    el.className = 'classic-home ssfight-home ssfight-sub';
    el.setAttribute('aria-label', '对手动作');
    ui.appendChild(el);
    current.sub = { host: el, view: null, dom: true, menu: false };
    return el;
  }
  function currentFoe() {
    return foeAt(Number(current && current.sel) || 0);
  }
  // 「界面上第 i 行是谁」的唯一取件口径：只查 current.rows（这一页显示的 4 行）。
  // 不要用 current.roster[i]（整份名单）——好友页只显示其中 4 行，会取到别的对手。
  function foeAt(i) {
    if (!current) return null;
    // current.rows 已经是按页偏移切过的 4 行；不要再加 pageOff（会偏移两遍）。
    return (current.rows || [])[Number(i) || 0] || null;
  }
  // 二级页开着时停用底页的点击路由：二级页 svg 只铺满舞台矩形，四周透明区不挡指针，
  function routerOfHost(host) {
    const t = T();
    const svg = host && host.querySelector ? host.querySelector('svg') : null;
    return (t && svg) ? t.routerOf(svg) : null;
  }
  /** 停用/恢复底页的点击路由（`host` = 底页容器；不传就取 `current.host`）。 */
  function setBaseRouterEnabled(host, on) {
    const r = routerOfHost(host || (current && current.host));
    if (!r || !r.setEnabled) return false;
    return r.setEnabled(!!on);
  }

  function openFriendMenu(i) {
    current.sel = Number(i) || 0;
    if (current.tab === 'random' && randomCache && randomCache.state === S()) randomCache.sel = current.sel;
    const foe = foeAt(current.sel);
    if (!foe) return;
    const host = menuHost();
    if (!host) return;
    guard(showFriendMenu(host, foe, current.sel));
  }
  async function showFriendMenu(host, foe, rowIndex) {
    const page = current;
    const view = await openSub(1);
    if (!isCurrentSub(view, page)) return;
    resetHits(view.g.ownerSVGElement);
    page.sub.menu = true;
    const rel = relOf(foe);
    const c = MENU_CASE(rel);
    const sub = clipOf(view, 'subframe');
    let compactRandom = c === 5 && page.tab === 'random';
    let layout = MENU_LAYOUT[c] || MENU_LAYOUT[3];
    if (compactRandom) {
      const glyph = captureAddFriendGlyph(sub);
      if (glyph && glyph.length) {
        const fr = MENU_LAYOUT[1];
        layout = Object.assign({}, fr, {
          rows: fr.rows.map((row, i) => (i === 3 ? Object.assign({}, row, { label: '加好友' }) : row)),
        });
      } else {
        compactRandom = false;
      }
    }
    const setFrame = (d) => {
      menuSetFrame(sub, layout, d);
      if (compactRandom) paintAddFriendGlyph(sub);
    };
    /* 行热区铺在**DOM 层**（不动原版显示列表）：悬停就把 `subframe` 拨到"那一行被选中"的帧
     * ⚠ 菜单一出生就**先拨到第 1 行被选中**的那一帧：原版进来时 `jiantou_WZ_Y2 = 1`
     * ⚠⚠ 用户 2026-10 口径（本批 ②-其二）："不要设 挑战ta 为默认选中……直接固定最后一个
     *   悬停的对象亮就行，我不希望一直切换到挑战ta亮。"
     *   （原版出生态）。这样高亮永远只在"指针真正到过的那一行"上来回，不会再自己跳回挑战Ta。 */
    let lastD = 0;
    host.querySelectorAll('.sf-mrow').forEach((n) => n.remove());
    const mp = menuMap(view, host);
    const put = (row, box, act, label, d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sf-mrow';
      b.setAttribute('data-m', act);
      b.setAttribute('aria-label', label || act);
      b.style.left = mp.x(box[0]) + 'px';
      b.style.top = mp.y(box[1]) + 'px';
      b.style.width = mp.s(box[2] - box[0]) + 'px';
      b.style.height = mp.s(box[3] - box[1]) + 'px';
      b.addEventListener('mouseenter', () => { lastD = d; setFrame(d); });
      /* 移开**不归位**：留住最后悬停那一行（见上面那段注释）。 */
      b.addEventListener('click', (e) => { e.stopPropagation(); menuFire(act, foe, rowIndex); });
      host.appendChild(b);
    };
    for (const row of layout.rows) {
      put(row, row.box, row.act, row.label, row.d);
      if (row.x2 && row.box2) put(row, row.box2, row.act2, row.label2, row.d2 != null ? row.d2 : row.d);
    }
    setFrame(lastD);
    /* 原版只有「收为徒弟 / 加好友」，没有主动拜师按钮（师父是服务端 relation）。
     * 随机挑战页不显示。已经有师父、或对象本身就是师父/徒弟/木人时也不显示。 */
    host.querySelectorAll('.sf-master-btn').forEach((n) => n.remove());
    const me = S() || {};
    const canMaster = current && current.tab === 'friends' && !me.master && foe
      && foe.kind === 'friend' && !foe.dummy;
    if (canMaster) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'uc-button gold sf-master-btn';
      b.textContent = '拜师';
      b.setAttribute('aria-label', '拜 ' + foe.name + ' 为师');
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); askMaster(foe); });
      host.appendChild(b);
    }
  }

  /** 主动拜师：经典弹窗里确认当前对手的属性，确认后 `State.setMaster`（自动学师父驾到）。 */
  function askMaster(foe) {
    const C = window.UI && UI.classic;
    const s = S() || {};
    if (s.master) { if (window.UI && UI.toast) UI.toast('你已经有师父了，先出师才能再拜师。'); return; }
    const go = () => {
      if (S() !== s) return;
      if (s.master) { if (window.UI && UI.toast) UI.toast('你已经有师父了。'); return; }
      const r = State.setMaster(foe);
      if (window.UI && UI.toast) UI.toast(r.ok ? ('已拜【' + foe.name + '】为师，学会「师父驾到」') : (r.msg || '拜师失败'));
      if (!r.ok) return;
      closeSub();
      showTab(current ? current.tab : 'friends');
    };
    const body = '<div class="result-box"><div class="sf-fd-head"><b>' + esc(foe.name) + '</b><span>Lv' + esc(foe.level) + ' · 拜师</span></div>' +
      '<div class="sf-fd-stats"><span class="sf-fd-stat p"><b>力</b><i>' + esc(foe.power == null ? '-' : foe.power) + '</i></span>' +
        '<span class="sf-fd-stat a"><b>敏</b><i>' + esc(foe.agility == null ? '-' : foe.agility) + '</i></span>' +
        '<span class="sf-fd-stat s"><b>速</b><i>' + esc(foe.speed == null ? '-' : foe.speed) + '</i></span>' +
        '<span class="sf-fd-stat h"><b>命</b><i>' + esc(foe.hp == null ? '-' : foe.hp) + '</i></span></div>' +
      '<p class="sf-fmenu-note">拜师后自动学会「师父驾到」：战斗中生命不高于 50% 时有概率请师父出场，恢复师父等级 ×4 的生命，并让下一次攻击必中。</p></div>';
    if (C && C.modal) {
      C.modal('拜师', body, [
        { label: '取消', cls: 'muted' },
        { label: '拜他为师', cls: 'gold', run: go },
      ], { small: true });
    } else if (typeof window.confirm === 'function' && window.confirm('拜【' + foe.name + '】为师？')) {
      go();
    }
  }
  function menuMap(view, host) {
    const svg = view && view.root;
    const r = svg && svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    const vb = svg ? String(svg.getAttribute('viewBox') || '0 0 320 196').split(/[\s,]+/).map(Number) : null;
    const box = host && host.getBoundingClientRect ? host.getBoundingClientRect() : null;
    const hs = host ? (Number(getComputedStyle(host).getPropertyValue('--uiscale')) || 1) : 1;
    const k = (r && r.width && vb && vb[2]) ? r.width / vb[2] : 3.577;
    const ox = r && box ? (r.left - box.left) / hs : 0;
    const oy = r && box ? (r.top - box.top) / hs : 0;
    const vx = vb ? vb[0] : 0, vy = vb ? vb[1] : 0;
    return {
      k: k / hs,
      x: (sx) => ox + (sx - vx) * k / hs,
      y: (sy) => oy + (sy - vy) * k / hs,
      s: (n) => n * k / hs,
    };
  }
  function menuSetFrame(sub, layout, d) {
    if (!sub || !layout) return;
    const n = sub.frameCount ? sub.frameCount() : 29;
    const off = Math.max(0, Number(d) || 0);
    try { sub.gotoAndStop(Math.max(1, Math.min(n, layout.base + off))); } catch (e) {}
  }
  let addFriendGlyph = null;
  /** 第四行那颗字的 path（`getBBox()` 的局部坐标：y≈79、高 15 左右）。 */
  function fourthRowGlyphPaths(sub) {
    const out = [];
    if (!sub || !sub.g || !sub.g.querySelectorAll) return out;
    for (const p of sub.g.querySelectorAll('path')) {
      let b = null;
      try { b = p.getBBox(); } catch (e) { b = null; }
      if (b && b.y >= 75 && b.y <= 85 && b.height >= 14 && b.height <= 17) out.push(p);
    }
    return out;
  }
  /** 从陌生人档抄一份「加好友」字形（帧 14；帧 11..14 的字形相同，只有绿高亮在动），
   *  抄完回到原帧（同步操作，不会落屏）。 */
  function captureAddFriendGlyph(sub) {
    if (addFriendGlyph && addFriendGlyph.length) return addFriendGlyph;
    if (!sub || !sub.gotoAndStop) return null;
    const back = (sub.frame || 0) + 1;
    try {
      sub.gotoAndStop(14);
      addFriendGlyph = fourthRowGlyphPaths(sub).map((p) => p.cloneNode(true));
    } catch (e) { addFriendGlyph = null; }
    try { sub.gotoAndStop(back); } catch (e) {}
    return addFriendGlyph;
  }
  /** 每次拨帧后重贴：好友档画稿自带「收为徒弟」，先藏掉再把「加好友」贴到同一层。
   *  ⚠ 必须**先复原上一次**再重新找原字形：真实点击打开菜单后，指针落在菜单首行上会再
   *    （用户 2026-10 报的"点最上面一行敌人时加好友异常隐形"）。 */
  function paintAddFriendGlyph(sub) {
    if (!addFriendGlyph || !addFriendGlyph.length || !sub || !sub.g) return false;
    for (const n of sub.g.querySelectorAll('[data-sf-addfriend-glyph]')) n.remove();
    for (const n of sub.g.querySelectorAll('[data-sf-addfriend-hide]')) {
      n.style.display = '';
      n.removeAttribute('data-sf-addfriend-hide');
    }
    const cur = fourthRowGlyphPaths(sub);
    if (!cur.length) return false;
    const parent = cur[0].parentNode;
    for (const p of cur) {
      p.style.display = 'none';
      p.setAttribute('data-sf-addfriend-hide', '1');
    }
    for (const p of addFriendGlyph) {
      const n = p.cloneNode(true);
      n.setAttribute('data-sf-addfriend-glyph', '1');
      parent.appendChild(n);
    }
    return true;
  }
  function openRecruitConfirm(foe) {
    const page = current;
    if (!page || !foe) return;
    const pending = openSub(2);
    guard(Promise.resolve(pending).then((view) => {
      if (!isCurrentSub(view, page)) return;
      const confirm = clipOf(view, 'button1');
      const cancel = clipOf(view, 'button2');
      wireClickable(confirm, {
        hover: 0, press: 0, idle: 1,
        onFire: () => {
          if (current !== page) return;
          const tab = page.tab || 'friends';
          closeSub();
          startRecruitChallenge(foe, tab);
        },
      });
      wireClickable(cancel, { hover: 0, press: 0, idle: 1, onFire: () => closeSub() });
    }));
  }
  function waitChallengeView(limit) {
    const max = Number(limit) || 120;
    return new Promise((resolve) => {
      let n = 0;
      const tick = () => {
        const view = window.SfChallenge && SfChallenge.view ? SfChallenge.view() : null;
        if ((view && view.g && view.g.isConnected) || n++ >= max) { resolve(); return; }
        setTimeout(tick, 50);
      };
      tick();
    });
  }
  function startRecruitChallenge(foe, tab) {
    const s = State.state();
    const started = State.beginRecruitChallenge ? State.beginRecruitChallenge(foe) : { ok: false, msg: '收徒挑战不可用' };
    if (!started.ok) {
      if (window.UI && UI.toast) UI.toast(started.msg || '收徒挑战失败');
      return;
    }
    const token = started.token;
    let settled = false;
    const restore = async () => {
      closeSub();
      SfChallenge.openAt(tab || 'friends');
      if (window.UI && UI.runAction) UI.runAction('challenge');
      await waitChallengeView();
    };
    const interrupted = () => {
      if (settled) return;
      settled = true;
      if (State.state() !== s) return;
      State.cancelRecruitChallenge(token);
      restore();
      if (window.UI && UI.toast) UI.toast('收徒挑战中断，已退还10金松果。');
    };
    try {
      Promise.resolve(Main.startBattle(started.foe, {
        kind: 'master', useProps: true, region: 0, skipResultPanel: true,
        keepScreen: true,
        onError: interrupted,
        onEnd: async (winner) => {
          if (settled) return;
          settled = true;
          if (State.state() !== s) { await restore(); return; }
          const result = State.finishRecruitChallenge(token, winner === 0);
          await restore();
          if (!result.ok) return;
          if (window.SfFightResult) {
            SfFightResult.open({
              kind: 'result', title: result.win ? '收徒成功' : '收徒失败',
              win: result.win, exp: result.exp, ups: result.ups, text: result.msg,
              actions: [{ label: '返回', run: () => {} }],
            }).catch((error) => { if (window.UI && UI.toast) UI.toast(error.message); });
          } else if (window.UI && UI.toast) UI.toast(result.msg);
        },
      })).catch(interrupted);
    } catch (e) { interrupted(); }
  }

  function menuFire(action, foe, rowIndex) {
    switch (action) {
      case 'fight':
        closeSub();
        fightRow(rowIndex);
        return;
      case 'view':
      case 'record':
        openFriendDetail(foe);
        return;
      case 'add': {
        /* relation 0（好友）那一档原版是「收为徒弟」（`doAction(4)` → `showGetStuWin`），
         * 陌生人（relation 3）那一档才是「加好友」。
         * 确认后 `getStudent` 扣 10 金松果并打一场收徒挑战；复刻不能直接 `addPrentice`。 */
        if (foe.dummy) { closeSub(); return; }
        if (foe.kind === 'friend' && !foe.stranger) { openRecruitConfirm(foe); return; }
        const r = State.addFriend ? State.addFriend(foe) : { ok: false, msg: '不能添加' };
        if (window.UI && UI.toast) UI.toast(r.msg || (r.ok ? '已添加好友' : '添加失败'));
        if (r.ok) { closeSub(); showTab(current.tab); }
        return;
      }
      case 'cheer':
        if (window.UI && UI.toast) UI.toast('加油！加油！师父必胜！');
        return;
      case 'quitmaster': {
        const cost = 20;
        if (window.UI && UI.classic && UI.classic.modal) {
          UI.classic.modal('退出师门', '<p>退出师门需要花费 ' + cost + ' 个金松果，是否确定？</p>', [
            { label: '确定', run: () => {
              const s = S() || {};
              if (Number(s.goldPoint) < cost) { if (window.UI && UI.toast) UI.toast('金松果不足'); return; }
              s.goldPoint -= cost;
              if (State.clearMaster) State.clearMaster();
              try { State.save(); } catch (e) {}
              closeSub();
              showTab(current.tab);
            } },
            { label: '返回', cls: 'muted' },
          ], { small: true });
        }
        return;
      }
      case 'eject': {
        if (State.kickPrentice) {
          const r = State.kickPrentice(foe.name);
          if (window.UI && UI.toast) UI.toast(r.msg || (r.ok ? '已逐出师门' : '不能逐出'));
          if (r.ok) { closeSub(); showTab(current.tab); }
        }
        return;
      }
      default:
        closeSub();
    }
  }
  function openFriendDetail(foe) {
    closeSub();
    if (foe && foe.dummy) { openDummyRecord(foe); return; }
    if (window.SfStatus && SfStatus.openFriend) {
      /* **不要拆挑战页**：状态页是盖在它上面的一层。返回时只摘掉那一层，好友名单、
       * 当前页/选中行原样保留 —— 用户口径「返回后不会刷新敌人」。 */
      let p = null;
      try {
        p = SfStatus.openFriend(foe, () => {
          /* 挑战页还在就什么都不做，直接露出下面那一页；只有它真的不在了才重开。 */
          if (!current && window.UI && UI.runAction) UI.runAction('challenge');
        });
      } catch (e) {
        /* 同步抛出（素材没加载完之类）：退回"查看装备"那一层说明，别让点击变成静默失败。 */
        if (window.__errs) window.__errs.push('SfStatus friend throw: ' + (e && e.message));
        openFriendGears(foe);
        return;
      }
      if (p && typeof p.catch === 'function') {
        p.catch((e) => { if (window.__errs) window.__errs.push('SfStatus friend: ' + (e && e.message)); });
      }
      return;
    }
    openFriendGears(foe);
  }
  function openFriendGears(foe) {
    const host = menuHost();
    if (!host || !foe) return;
    const C = window.UI && UI.classic;
    const gearNames = { 0: '头部', 1: '拳套', 2: '衣服', 3: '鞋子' };
    const gears = (foe.gears || []).map((g) => {
      const gid = Number(g && g.id != null ? g.id : g);
      const ty = Number(g && g.type != null ? g.type : (State.gearPart ? State.gearPart(g.id) : -1));
      const orange = !!(g && (g.orange === true || Number(g.quality) === 4));
      const gemLv = g && g.gem && State.gemLevel ? State.gemLevel(g.gem.id) : 0;
      const extra = [gearNames[ty] || '', orange ? '橙装' : '', gemLv ? '宝石 Lv' + gemLv : '']
        .filter(Boolean).join(' · ');
      return '<li><span class="sf-fd-icon gear" data-img="images/ui/icons/gear/gear-' + gid + '.png"></span>' +
        '<b' + (orange ? ' style="color:#c45a12"' : '') + '>' + esc(C && C.gearName ? C.gearName(gid) : ('装备' + gid)) + (orange ? '（橙）' : '') + '</b>' +
        '<i>' + esc(extra) + '</i></li>';
    }).join('') || '<li class="none">（未穿戴）</li>';
    const stat = (k, v, cls) => '<span class="sf-fd-stat ' + cls + '"><b>' + k + '</b><i>' + v + '</i></span>';
    host.querySelectorAll('.sf-mrow').forEach((n) => n.remove());
    host.innerHTML =
      '<div class="sf-fdetail">' +
        '<div class="sf-fd-head"><b>' + esc(foe.name) + '</b><span>Lv' + esc(foe.level) + ' · 装备</span></div>' +
        '<div class="sf-fd-stats">' + stat('力', foe.power, 'p') + stat('敏', foe.agility, 'a') + stat('速', foe.speed, 's') + stat('命', foe.hp, 'h') + '</div>' +
        '<h4>身上穿的</h4><ul class="sf-fd-list gears">' + gears + '</ul>' +
        '<button type="button" class="sf-fmenu-btn" data-m="back">返回</button>' +
      '</div>';
    for (const box of host.querySelectorAll('.sf-fd-icon')) {
      const img = box.getAttribute('data-img');
      if (img) box.innerHTML = '<img alt="" src="' + img + '">';
    }
    const bk = host.querySelector('[data-m="back"]');
    if (bk) bk.addEventListener('click', () => openFriendMenu(Number(current && current.sel) || 0));
  }
  /** 原版 MainMovie.as:18221..18223 的顺序：武器、技能、徒手。
   * 分项最佳独立保存；旧档没有分项时保留「未记录」，不虚构排名。 */
  function openDummyRecord(foe) {
    if (!current) return;
    const s = S() || {};
    const n = Number(s.woodCount) || 0, best = Number(s.woodDamage) || 0;
    guard(openOriginalDialog('3535', { owner: current.host, label: '个人记录', paint(view, close) {
      stopAt(clipOf(view, 'title'), 2);
      for (const [i, key] of ['weaponDamage', 'skillDamage', 'handDamage'].entries()) {
        const value = s.woodBest && Number(s.woodBest[key]);
        setText(clipOf(view, 'text' + (i + 1)), value == null ? '未记录' : String(value || 0));
      }
      for (let i = 1; i <= 4; i++) stopAt(clipOf(view, 'newRecord' + i), 3);
      if (best < 100000) {
        T().showNumber(best, view, 0, 0, 'left', 5);
      } else {
        T().showNumber(88888, view, 0, 0, 'left', 5);
        const digits = Array.from({ length: 5 }, (_, i) => clipOf(view, 'num' + (i + 1)));
        const svg = view.g.ownerSVGElement || view.g;
        const points = [];
        const inverse = view.g.getCTM().inverse();
        for (const digit of digits) {
          const box = digit.g.getBBox(), transform = inverse.multiply(digit.g.getCTM());
          for (const [x, y] of [[box.x, box.y], [box.x + box.width, box.y + box.height]]) {
            const point = svg.createSVGPoint(); point.x = x; point.y = y;
            points.push(point.matrixTransform(transform));
          }
          digit.g.style.visibility = 'hidden';
        }
        const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
        const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const size = bottom - top;
        for (const [key, value] of Object.entries({ x: (left + right) / 2, y: (top + bottom) / 2,
          'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size,
          'font-family': '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif', 'font-weight': '900',
          fill: '#fffaf0', stroke: '#55290e', 'stroke-width': 1.5, 'paint-order': 'stroke fill',
          'stroke-linejoin': 'round', 'data-dummy-damage': String(best) })) text.setAttribute(key, value);
        text.textContent = String(best);
        view.g.appendChild(text);
        const width = text.getComputedTextLength();
        if (width > right - left - 3) text.setAttribute('font-size', size * (right - left - 3) / width);
      }
      setText(clipOf(view, 'text4'), fitText(clipOf(view, 'text4'),
        '最高总伤害 ' + best + '；训练 ' + n + ' 次\n三项为各场分项最佳，可能来自不同场次'));
      const back = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      back.setAttribute('data-name', 'recordBack');
      for (const rec of view.nodes.values()) {
        if (['3152', '3190'].includes(String(rec.id)) && rec.node) back.appendChild(rec.node);
      }
      view.g.appendChild(back);
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const bounds = back.getBBox();
      for (const [key, value] of Object.entries({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, fill: 'transparent', 'pointer-events': 'all' })) hit.setAttribute(key, value);
      back.appendChild(hit); back.style.cursor = 'pointer';
      back.addEventListener('click', e => { e.stopPropagation(); close(); });
      if (window.SfUiFeedback) SfUiFeedback.bind(back);
    } }));
    void foe;
  }
  /** 「查看装备」—— 由**状态页**上的那一颗（`b_change` 第 4/5 帧，原版 `friendEquipsInfo()`
   *  ⚠ 这里以前**根本没有这个函数**：`ui-status.js` 的 `openFriendGears()` 是
   *    `if (window.SfChallenge && SfChallenge.showFriendGears) { … }` + 兜底
   *    随机页，装备一件都看不到 —— 用户 2026-10 报的"点开查看装备时会闪退、完善这个页面"。
   *  返回回**他的状态页**（原版 `状态1` 第 7 帧的返回就是回状态页，不是回挑战页）。 */
  function showFriendGears(foe) {
    const target = foe || currentFoe();
    /* 主路径：状态页自己盖一层（原版那一页的返回就是回状态页，所以不拆任何东西）。
     * ⚠ 这里**不要**先 `SfStatus.openFriend()` —— 那是"重开一整页状态页"，
     *   等于把用户刚看的页面重建一遍（观感是闪一下），而且返回栈会多一层。 */
    if (window.SfStatus && SfStatus.showFriendGears && SfStatus.current && SfStatus.current()) {
      SfStatus.showFriendGears();
      return;
    }
    /* 状态页不在场（从别处调过来）：退回挑战页自己的说明面板，至少不静默失败。 */
    if (current) { current.sel = Number(current.sel) || 0; openFriendGears(target); return; }
    if (window.SfStatus && SfStatus.openFriend) {
      try {
        const p = SfStatus.openFriend(target, () => { if (window.UI && UI.runAction) UI.runAction('challenge'); });
        if (p && typeof p.catch === 'function') p.catch((e) => { if (window.__errs) window.__errs.push('SfStatus gears: ' + (e && e.message)); });
        return;
      } catch (e) {
        if (window.__errs) window.__errs.push('SfStatus gears throw: ' + (e && e.message));
      }
    }
    destroy();
    if (window.UI && UI.runAction) UI.runAction('challenge');
  }
  async function mountMiniIcon(box, sym) {
    try {
      await SfRender.loadExtra('tags-wsicon.json');
      const v = await SfRender.mountSymbol(box, String(sym), { frame: 1, label: '图标', viewBox: '-2 -3 50 46' });
      if (!box.isConnected) { try { v.destroy(); } catch (e) {} }
    } catch (e) { /* 挂不上就留空框，不影响这一页其它内容 */ }
  }
  /** 开战：走复刻的战斗调度（与原版 `fightType` + "temp" 帧等价的那一段）。
   * `kind` 两档，**结算规则完全不同**：
   *   · `'challenge'` = 随机挑战：扣 10 体力、吃药品加成、有随机掉落、打赢结算经验与金松果
   *     "在好友界面挑战人和人的时候都不会有体力消耗、经验获取、金松果获取与随机掉落获取等。"
   *     所以这一档 **不扣体力、不吃药品加成、不飘掉落、`onEnd` 不结算任何奖励**
   *       经典页这一档以前漏了，照它对齐即可 —— 两边共用 `kind:'friend'` 这一个名字。 */
  /** 战斗期间把这一页「按住」在原位（`Main.startBattle` / `SfFight.run` 会清 `#ui`，
   *  但跳过带 hold 标记的节点），打完只还原显示 —— 回来的是**同一棵 SVG**，既不重新
   *  挂载、也不触发 WebKit 对整棵子树的重新布局。随机挑战 / 切磋 / 关卡连战共用这一套。 */
  const BATTLE_HOLD_ATTR = 'data-sf-battle-hold';
  /** 战斗期间把这一页「按在原地」：不从 `#ui` 摘下，只隐藏并标记。
   * 返回时就是那一下卡顿（用户 2026-10：iOS「随机战斗完回随机挑战页会卡一下」）。
   * 现在让它留在文档里，战斗页盖在上面；隐藏只关掉绘制与命中，不打散布局，
   * 返回时只 `visibility` 还原，不再重挂。`SfBattle` 清 `#ui` 时也会跳过带这个标记的节点
   * （见 `Main.clearUiForBattle` / `ui-fight.js` 的 `run`）。 */
  function holdPageForBattle() {
    const page = current;
    const host = page && page.host;
    if (!host || !host.parentNode) return null;
    /* ⚠ **不要** `closeSub()`：关卡的三级页（难度页 / 出战确认）如果在这里拆掉，
     * 战后 `openGate()` 只能重新 mount 一颗 4756 —— 那就是"回到有继续挑战页面时卡一下"。
     * sub host 同样留在树上，只隐藏并标记；战后按原顺序还原。 */
    const sub = (page.sub && page.sub.host) ? page.sub : null;
    const mark = (el) => {
      if (!el || !el.setAttribute) return;
      el.setAttribute(BATTLE_HOLD_ATTR, '');
      el.style.visibility = 'hidden';
      el.style.pointerEvents = 'none';
    };
    mark(host);
    if (sub) mark(sub.host);
    return { page: page, host: host, sub: sub };
  }
  function unmarkHeld(el) {
    if (!el || !el.removeAttribute) return;
    el.removeAttribute(BATTLE_HOLD_ATTR);
    if (el.style) {
      el.style.visibility = '';
      el.style.pointerEvents = '';
    }
  }
  function resumePageAfterBattle(hold, tab, opts) {
    if (!hold || !hold.host || !hold.page) return false;
    if (current !== hold.page || current.host !== hold.host) return false;
    const ui = document.getElementById('ui');
    /* 理论上页面一直没离开 #ui；只有被别的清屏逻辑摘掉时才补挂一次（兜底）。 */
    if (!hold.host.isConnected) {
      if (!ui) return false;
      ui.appendChild(hold.host);
    }
    if (hold.host.isConnected === false) return false;
    unmarkHeld(hold.host);
    /* 隐藏期间 `SfRender` 的节拍器会把这一视图标记为不可见而跳过；还原后强制它
     * 下一拍重新量一次，否则页面里还在播的装饰动画要等最多 10 拍（≈0.7 s）才恢复。 */
    try { if (hold.page.view) hold.page.view.__visible = undefined; } catch (e) {}
    /* 三级页要按原顺序还原：主页面之后 = 仍然盖在上面。 */
    if (opts && opts.keepSub && hold.sub && hold.sub.host) {
      if (!hold.sub.host.isConnected && ui) ui.appendChild(hold.sub.host);
      unmarkHeld(hold.sub.host);
      try { if (hold.sub.view) hold.sub.view.__visible = undefined; } catch (e) {}
      if (current.sub && current.sub.view) setBaseRouterEnabled(current.host, false);
    }
    hold.page.roster = null;       // 打完回来换一批对手（与原 `backToRandom` 同口径）
    randomCache = null;            // 同上：战斗结束后的随机页要重抽，不吃旧缓存
    hold.page.sel = 0;
    hold.page.page = 1;
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    if (opts && opts.keepSub && hold.sub && hold.sub.host && hold.sub.host.isConnected) {
      return true;
    }
    try { showTab(tab || 'random'); } catch (e) {
      if (window.__errs) window.__errs.push('challenge resume: ' + (e && e.message));
      return false;
    }
    return true;
  }
  function startFight(foe, kind) {
    const s = S();
    if (!s || !window.Main || !Main.startBattle) return;
    const friend = kind === 'friend';
    if (!friend && Number(s.energy) < 10) {
      if (window.UI && UI.toast) UI.toast('体力不足（需要 10 点），每 5 分钟恢复 1 点，也可以使用体力药剂');
      return;
    }
    /* 每次随机挑战开始都把「刷新玩家」次数归零（与 classic-ui 的 DOM 路径同一口径）：
     * 打完一个随机敌人就重新获得 10 次刷新。 */
    if (!friend) {
      clearRefreshTimer();
      s.challengeRefresh = { count: 0, ts: Date.now() };
      try { State.save(); } catch (e) {}
    }
    /* 经验/金松果在**第一张战果页出现前**算好：战果页直接写"经验 + 金松果 + 悬浮物品"，
     * 开完宝箱就回随机挑战页，不再弹第三张结算。`settle` 自己缓存，SfFight 与 onEnd
     * 各调一次也只发一次奖励。 */
    let reward = null;
    const settle = friend ? null : (winner) => {
      if (reward) return reward;
      const win = winner === 0;
      if (win) { s.dailyWins++; s.allWins++; } else { s.dailyFails++; s.allFails++; }
      reward = State.fightReward(win, { foeLevel: foe.level });
      return reward;
    };
    const go = () => {
      /* 战斗前把挑战页按住（见 `holdPageForBattle`）：打完只还原显示，
       * 不再 `destroy()` + 重新挂载 —— 那一步就是"背景 UI 闪一下"的来源。 */
      const hold = holdPageForBattle();
      const restore = (tab) => {
        if (resumePageAfterBattle(hold, tab)) return true;
        destroy();
        if (window.SfChallenge && SfChallenge.openAt) SfChallenge.openAt(tab);
        if (window.UI && UI.runAction) UI.runAction('challenge');
        return false;
      };
      Main.startBattle(foe, {
        cost: friend ? 0 : 10, kind: kind || 'challenge', useProps: !friend,
        collectDrops: !friend,
        /* 切磋既没有局内悬浮奖励，也没有战后宝箱（用户 2026-11 口径）。 */
        skipChest: friend,
        /* 原版打完回到 `tiaozhan` 的那一页（:2814-2819 `gotoAndStop("temp")` 之后由服务端
         * 而首页的 `renderHome()` 会把挑战页拆掉 —— 观感就是"打完跳回现代界面"。 */
        keepScreen: true,
        rewardFor: settle,
        /* 切磋没有奖励、也没宝箱，局内那张战果页直接跳过；挑战则**保留**第一张战果页，
         * 让它先显示经验/金松果/悬浮物品，等 1.5 s 再进开宝箱。 */
        skipResultPanel: friend,
        onEnd: (winner) => {
          const backToFriends = () => { restore('friends'); };
          if (friend) {
            restore('friends');
            /* 切磋**不摆奖励面板**（`resultModal` 那一栏固定写"经验 +X 金松果 +Y"，
             * 这里两项都是 0，摆出来只会让人以为结算漏了）—— 直接用同一个弹窗外壳写明白。 */
            const C = window.UI && UI.classic;
            const body = '<p>' + (winner === 0 ? '切磋胜利！' : '再接再厉——') + '和【' + esc(foe.name || '好友') + '】的切磋结束。</p>'
              + '<p class="small-label">切磋不消耗体力、不结算经验与金松果，也不会有战利品；<br>想赚奖励请去「随机」或「关卡」。</p>';
            if (window.SfFightResult && window.UI && UI.currentUiMode && UI.currentUiMode() === 'classic') {
              SfFightResult.open({ kind: 'result', title: '切磋结果', win: winner === 0, text: body,
                actions: [{ label: '确定', run: backToFriends }] }).catch(error => { if (UI.toast) UI.toast(error.message); });
              return;
            }
            if (C && C.modal) C.modal('切磋结果', body, [{ label: '确定', run: backToFriends }], { small: true });
            else if (window.UI && UI.toast) UI.toast('切磋结束：不消耗体力、不结算奖励。');
            return;
          }
          settle(winner);                             // canvas 回退时 SfFight 没机会调 rewardFor
          restore('random');
          if (window.UI && UI.classic && UI.classic.promptLevelUpChoices) UI.classic.promptLevelUpChoices();
        },
      }).catch(() => { restore(friend ? 'friends' : 'random'); });
    };
    go();
  }

  function showTab(key, keepPage) {
    if (!current) return;
    clearRefreshTimer();
    const view = current.view;
    /* 随机页回到上次选中的那一行（名单缓存还在时）；其它 tab 仍从头开始。 */
    current.sel = (key === 'random' && randomCache && randomCache.state === S())
      ? Math.max(0, Number(randomCache.sel) || 0) : 0;
    current.refreshRow = false;
    current.tab = key;
    /* 页码归位第一页：`current.page` 是**跨 tab 共用**的一份状态，不重置的话
     * "好友页翻到第 3 页 → 切随机 → 再切回好友"会落在第 3 页（原版每进一次页面都是
     * ⚠ `keepPage`：**翻页箭头自己**调 `showTab` 时不能再归位 —— 以前这里无条件写回 1，
     *   （用户 2026-10 报的"好友界面无法正常翻页"就是这个）。 */
    if (!keepPage) current.page = 1;
    /* 战斗正在播的时候**不要重画**（见 `goArenaPage` 的注释）：这一页的显示树是给
     * 挑战界面看的，战斗期间 `#stage` 已经被战斗画布占着，重画只会把说明层盖回去。 */
    if (inBattle()) { current.tab = key; return; }
    closeSub();
    resetHits(view.g.ownerSVGElement);
    stopAt(view, PAGE[key] || PAGE.random);
    wireChrome(view, current.host);
    if (key === 'gates') showGates();
    else if (key === 'arena') showArena();
    else if (key === 'friends') showFriends();
    else showRandom();
    /* ⚠ 收尾必须**重新静音 + 重写顶栏数值**：`stopAt(view, 帧)` 会重建整棵子树，
     * `settleFrame` 会把规则重新挂到新视图上，之后任何一次换帧重建都自动适用。 */
    settleFrame(view);
    fillChrome(view);
    setTabs(view, key);
  }
  /** 把左右翻页箭头摆到"名单列两侧"（舞台坐标，实测）。
   *  · 用户 2026-10 口径："好友界面的翻页键向右翻页键的位置不对，太靠右了，
   *  · **真正的坑是箭头元件的原点不在画稿中心**：`3156` 的透明热区在局部
   *    （中心 ≈ 4.8）—— 摆放点写的是"热区中心"，所以**热区永远比看得见的箭头偏右
   *    （卡到 190.5 为止），画稿落在 182.4..197，鼠标一眼能看到、也点得到。 */
  const ARROW_Y = 80.8;
  const ARROW_POS = { left: { x: 8.6, y: ARROW_Y }, right: { x: 208.1, y: ARROW_Y } };
  /* 箭头元件（3156）导出实测是**两帧**：第 1 帧 = 箭头画稿，第 2 帧 = **空帧**。
   * （用户 2026-10 报的"鼠标悬停在翻页键上时翻页键会消失"）—— 那一档根本没有画稿，
   * 原版也从来没往那一帧拨过（原版是键盘操作，箭头只有"常态"）。所以悬停**不改帧**，
   * 反馈交给点击路由统一加的 `.sf-hover`（暖色光晕 + 微放大，见 css/classic-refine.css）。 */
  const ARROW_SPEC = (onFire) => ({ hover: 0, press: 0, idle: 1, onFire: onFire });
  function placeArrows(view) {
    for (const k of ['left', 'right']) {
      const c = clipOf(view, k);
      const g = c && (c.g || c);
      if (!g || !g.setAttribute) continue;
      const m = parseMatrix(g.getAttribute('transform'));
      if (!m) continue;
      const p = ARROW_POS[k];
      g.setAttribute('transform', 'matrix(' + m.a + ',' + m.b + ',' + m.c + ',' + m.d + ',' + p.x + ',' + p.y + ')');
    }
  }
  /** 换帧之后重新把这一页"静"下来（规则按名字 / 元件号写，重建出来的新实例自动适用）。 */
  function settleFrame(view) { applySilence(view); }
  /** 把这一页"静"下来：按钮 / 箭头 / 行 / 拳套卡都是**状态精灵**，不冻住会各自循环播。
   *  ⚠ 老的写法要列两张例外表（`skip` 里"我们自己拨帧的" + `protect` 里"数字精灵不许钉"）——
   *  "要自己拨帧的"和"数字精灵"都得躲开它。现在的静态页策略只写 `playing = false`
   *  换页帧会重建子树，所以每次换帧后要重来一遍（规则按名字 / 元件号写，重建也认）。 */
  function applySilence(view) {
    const t = T();
    if (!t) return;
    t.freezeDescendants(view);
  }

  /** 随机挑战（`showRandomFriends` :13131）：页帧 2，一页 3 行 + 第 4 行是「刷新玩家」。 */
  function showRandom() {
    const view = current.view;
    const s = S();
    clearRefreshTimer();
    /* 名单缓存和 `current.roster` 分开：`current.roster` 是各 tab 共用的，好友页会把它
     * 换成好友名单；随机页如果每次都重抽，离开挑战页再回来就换了一批（用户口径不要）。
     * 只有手动刷新 / 打完一场 / 换档才清空 randomCache。 */
    if (!randomCache || randomCache.state !== s || !randomCache.roster || !randomCache.roster.length) {
      randomCache = { state: s, roster: rollRoster() };
    }
    current.roster = randomCache.roster;
    current.page = 1;
    current.refreshRow = true;
    current.sel = Math.max(0, Math.min(randomCache.roster.length - 1, Number(randomCache.sel) || 0));
    randomCache.sel = current.sel;
    fillRows(view, current.roster.slice(0, 3), current.sel, 0);
    /* 随机页**只有 3 行**：第 4 行是「刷新玩家」按钮，那颗拳套卡 `s4` 不归 `fillRows` 管。
     * 原版 `doShowFriends`（:13353）每一行都先清到末帧，这里补上 —— 否则从好友页切回来时
     * `s4` 还挂着"师父 / 徒弟 / 木人"的标志（用户 2026-10 报的正是这个）。 */
    const s4 = clipOf(view, 's4');
    if (s4) { stopAt(s4, s4.frameCount ? s4.frameCount() : 1); unwire(s4); }
    const vip4 = clipOf(view, 'vip4');
    if (vip4) { stopAt(vip4, 1); setVisible(vip4, false); }
    const refresh = clipOf(view, 'f4');                    // 7273：刷新按钮
    const rf = refreshState();
    const left = refreshRemaining(rf);
    const exhausted = left <= 0;
    if (refresh && refresh.byName) {
      setText(refresh.byName('friendname'), '刷新玩家');
      setText(refresh.byName('flevel'), '');
    }
    if (refresh && refresh.g) {
      refresh.g.style.opacity = exhausted ? '0.42' : '';
      refresh.g.setAttribute('aria-disabled', exhausted ? 'true' : 'false');
    }
    wireClickable(refresh, {
      hover: 2, press: 2, idle: 1,
      onFire: () => {
        const sNow = S();
        const rfNow = refreshState();
        if (refreshRemaining(rfNow) <= 0) {
          if (window.UI && UI.toast) UI.toast('刷新次数已用完：挑战一个随机敌人或等待10分钟后再刷新');
          return;
        }
        sNow.challengeRefresh = { count: rfNow.count + 1, ts: Date.now() };
        try { State.save(); } catch (e) {}
        /* 手动刷新：作废缓存，下一次 showRandom 重抽。 */
        randomCache = null;
        showTab('random');
      },
    });
    if (refresh && refresh.g) {
      refresh.g.style.cursor = exhausted ? 'not-allowed' : 'pointer';
      refresh.g.style.pointerEvents = exhausted ? 'none' : 'auto';
      refresh.g.style.outline = 'none';
      refresh.g.style.webkitTapHighlightColor = 'transparent';
    }
    /* 次数用完后自动等窗口结束再重绘，不必让玩家手动重进页面。 */
    if (exhausted) {
      const wait = Math.max(1000, REFRESH_WINDOW - (Date.now() - rf.ts) + 50);
      refreshTimer = setTimeout(() => {
        refreshTimer = 0;
        if (current && current.tab === 'random' && !current.sub) showTab('random');
      }, wait);
    }
    setText(clipOf(view, 'page'), '1/1');
    setVisible(clipOf(view, 'left'), false);
    setVisible(clipOf(view, 'right'), false);
    showUserPic(view, current.roster[current.sel || 0] || null);
  }

  /** 添加好友页的候选等级：与现代模式「师徒」刷新师父候选完全同一条公式
   *  （玩家等级 +2~+12，不超过满级），这样“添加好友”和“拜师”看到的是同一档对手。 */
  function rollAddFriendCandidates() {
    const s = S() || {};
    const cap = State.MAX_PLAYER_LEVEL || 90;
    const base = Math.max(3, Math.min(Number(s.level) || 1, cap));
    return Array.from({ length: 3 }, () => State.genAI(
      Math.min(cap, Math.max(2, base + 2 + Math.floor(Math.random() * 11))), '',
      { levelJitter: 0, gearSelfLevel: true }));
  }
  /** 好友页「添加好友」：原版这里弹一个推荐窗口；复刻把它做成一个真正的页面，
   *  候选等级与「师徒」刷新一致，右下角的「拜师」直接拜当前选中的候选为师。 */
  function openAddFriendPage() {
    const C = window.UI && UI.classic;
    if (!C || !C.modal) { if (window.UI && UI.toast) UI.toast('添加好友界面不可用'); return; }
    let cands = rollAddFriendCandidates(), selected = 0, added = new Set();
    const body = () => '<div class="sf-addfriend">' +
      '<p class="sf-addfriend-tip">选中一位推荐好友，可添加好友或在右下角拜师。</p>' +
      '<div class="sf-addfriend-list">' + cands.map((c, i) => {
        const has = !!(State.friendOf && State.friendOf(c.name) || added.has(c.name));
        return '<div class="sf-addfriend-row' + (i === selected ? ' active' : '') + '" data-add-i="' + i + '">' +
          '<span class="sf-addfriend-identity"><span class="sf-addfriend-lv">Lv.' + esc(c.level) + '</span>' +
          '<b class="sf-addfriend-name">' + esc(c.name) + '</b></span>' +
          '<span class="sf-addfriend-stats"><i>力 ' + esc(c.power) + '</i><i>敏 ' + esc(c.agility) + '</i><i>速 ' + esc(c.speed) + '</i><i>血 ' + esc(c.hp) + '</i></span>' +
          '<button type="button" class="uc-button tiny ' + (has ? 'muted' : 'gold') + '" data-add-friend="' + i + '"' + (has ? ' disabled' : '') + '>' + (has ? '已是好友' : '加好友') + '</button>' +
          '</div>';
      }).join('') + '</div>' +
      '<div class="sf-addfriend-foot"><button type="button" class="uc-button tiny" data-add-refresh>换一批</button></div></div>';
    const m = C.modal('添加好友', body(), [
      { label: '关闭', cls: 'muted' },
      { label: '拜师', cls: 'gold', run: () => {
        const cand = cands[selected];
        if (!cand) return;
        if (State.state().master) { if (window.UI && UI.toast) UI.toast('你已经有师父了，先出师才能再拜师。'); return; }
        m.close();
        askMaster(cand);
      } },
    ], { small: false });
    const root = m && m.element;
    if (!root) return;
    root.classList.add('sf-addfriend-dialog');
    const repaint = () => {
      const box = root.querySelector('.modal-body');
      if (box) box.innerHTML = body();
    };
    root.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add-friend]');
      if (add) {
        e.preventDefault(); e.stopPropagation();
        const c = cands[Number(add.dataset.addFriend)];
        if (!c) return;
        const r = State.addFriend(c);
        if (r.ok) { added.add(c.name); if (window.UI && UI.toast) UI.toast(r.msg); }
        else if (window.UI && UI.toast) UI.toast(r.msg || '添加失败');
        repaint();
        return;
      }
      if (e.target.closest('[data-add-refresh]')) {
        e.preventDefault(); e.stopPropagation();
        cands = rollAddFriendCandidates(); selected = 0; added = new Set(); repaint();
        return;
      }
      const row = e.target.closest('[data-add-i]');
      if (row) { selected = Number(row.dataset.addI) || 0; repaint(); }
    });
  }

  function showFriends() {
    const view = current.view;
    const all = friendRoster();
    const pages = Math.max(1, Math.ceil(all.length / 4));
    current.page = Math.min(Math.max(1, current.page || 1), pages);
    const slice = all.slice((current.page - 1) * 4, current.page * 4);
    /* `roster` 留**整份**（原版 `friendsArray` 就是整份，`pageNum1` 才是页）：
     * `current.rows` 才是"这一页显示的那 4 行"（`fillRows` 按页偏移切好）。
     * 以前这里把 `roster` 也切成这一页的 4 条，`foeAt` 又按整份的偏移去查 → 差了一整页。 */
    current.roster = all;
    current.refreshRow = false;
    fillRows(view, slice, current.sel || 0, (current.page - 1) * 4);
    setText(clipOf(view, 'page'), current.page + '/' + pages);
    setVisible(clipOf(view, 'left'), current.page > 1);
    setVisible(clipOf(view, 'right'), current.page < pages);
    /* ⚠ 翻页箭头在这一帧里的落点是**导出数据里的样子**（实测 `left` 在舞台 x≈10、
     * `right` 却在 x≈184 —— 正好压在名单中间），看起来就是"翻页按钮乱跑 / 像消失了"。
     * 用户 2026-10 口径："当前的好友界面翻页按钮会消失，进行修复。"
     * 这里把两颗摆到**以名单列为基准左右对称**的位置（左贴名单左沿 / 右贴名单右沿），
     * 与其余几页一致；悬停不改帧（箭头第 2 帧是空帧，拨过去就"消失"）。 */
    placeArrows(view);
    /* 翻页箭头：`showTab(key, true)` —— **不能**让 `showTab` 把页码拨回第 1 页。 */
    wireClickable(clipOf(view, 'left'), ARROW_SPEC(() => { current.page--; current.sel = 0; showTab('friends', true); }));
    wireClickable(clipOf(view, 'right'), ARROW_SPEC(() => { current.page++; current.sel = 0; showTab('friends', true); }));
    wireClickable(clipOf(view, 'addfriend'), {
      hover: 2,
      onFire: openAddFriendPage,
    });
    if (!all.length) setText(clipOf(view, 'page'), '1/1');
    showUserPic(view, slice[current.sel || 0] || null);
  }

  const GATE_CARD = { open: 1, running: 2, locked: 3 };
  /* 用户 2026-10 口径（本批）："挑战界面仍然在任何情况下都是显示的继续挑战，
   *   希望能参考 ssfight 给出正确的显示逻辑。"
   *   `_loc2 <= getMaxGate()+1` → `gotoAndStop(1)`（金「挑战他」），否则 `gotoAndStop(3)`（灰）。
   *  （`showhardWin`，:23409-23438：`keep == "true"` 才 `gotoAndStop(2)`）。
   * 三扇门一起显示，就是用户看到的样子。现在照原版收成两档。 */
  function gateState(t) {
    const types = (window.GData && GData.STAGE_TYPES) || [];
    if (!types[t]) return 'locked';
    let open = false;
    for (let st = 1; st <= 6; st++) {
      if (State.stageAccess(t * 6 + st).ok) { open = true; break; }
    }
    return open ? 'open' : 'locked';
  }
  function gateCardFrame(t) {
    return gateState(t) === 'locked' ? GATE_CARD.locked : GATE_CARD.open;
  }
  function showGates() {
    const view = current.view;
    const types = (window.GData && GData.STAGE_TYPES) || [];
    const sub = clipOf(view, 'fubenSub');
    const level = Number((S() || {}).level) || 1;
    if (!sub) return;
    stopAt(sub, level > 4 ? 1 : 2);
    if (level <= 4) { wireClickable(clipOf(view, 'back'), { hover: 2, onFire: () => { destroy(); UI.runAction('home'); } }); return; }
    const pageCount = Math.max(1, Math.ceil(types.length / 3));
    const page = Math.max(0, Math.min(pageCount - 1, Number(current.gatePage) || 0));
    current.gatePage = page;
    let sel = Math.max(0, Math.min(types.length - 1, Number(current.gateSel) || 0));
    if (sel < page * 3 || sel >= page * 3 + 3) sel = page * 3;
    current.gateSel = sel;
    stopAt(sub.byName ? sub.byName('newYearMc') : null, 2);     // 元旦角标：没有活动 → 空帧
    for (let i = 0; i < 3; i++) {
      const t = page * 3 + i;
      const card = sub.byName ? sub.byName('button' + (i + 1)) : null;   // 4748：1 可打 / 2 继续挑战 / 3 锁定
      const bg = sub.byName ? sub.byName('bg' + (i + 1)) : null;         // 7549：帧 = 门号×2−1
      if (!types[t]) { setVisible(card, false); setVisible(bg, false); continue; }
      setVisible(card, true); setVisible(bg, true);
      stopAt(card, gateCardFrame(t));
      stopAt(bg, t * 2 + 1);
      wireClickable(card, {
        hover: 0, press: 0,
        idle: () => gateCardFrame(t),
        onFire: () => {
          if (gateState(t) === 'locked') { lockedNotice(t); return; }
          current.gateSel = t;
          guard(openGate(t));
        },
      });
      /* 悬停就把说明条换成这个门的（原版是"光标停在哪一个门就写哪一个门"的说明）。 */
      if (card && card.g) {
        card.g.addEventListener('mouseenter', () => {
          if (!current || current.gateSel === t) return;
          current.gateSel = t;
          writeGateDesc(sub, types, t);
        });
      }
    }
    writeGateDesc(sub, types, sel);
    /* 原版一页 3 个门、共 6 个门 → 2 页；左右翻页按钮只在该翻的时候显示。 */
    const left = sub.byName ? sub.byName('left_btn') : null;
    const right = sub.byName ? sub.byName('right_btn') : null;
    setVisible(left, page > 0);
    setVisible(right, page < pageCount - 1);
    setText(clipOf(view, 'page'), (page + 1) + '/' + pageCount);
    const flip = (delta) => {
      const next = Math.max(0, Math.min(pageCount - 1, page + delta));
      if (next === page) return;
      current.gatePage = next;
      current.gateSel = next * 3;
      showGates();
    };
    wireClickable(left, { hover: 0, onFire: () => flip(-1) });
    wireClickable(right, { hover: 0, onFire: () => flip(1) });
    wireClickable(clipOf(view, 'back'), { hover: 2, onFire: () => { destroy(); if (window.UI && UI.runAction) UI.runAction('home'); } });
  }
  function writeGateDesc(sub, types, i) {
    const type = types[i];
    const text = type ? (type.name + type.desc + '，' + type.recommend + '。') : '';
    setText(sub.byName ? sub.byName('desc') : null, wrap(text, 22));
  }
  function lockedNotice(t) {
    const msg = State.stageAccess(t * 6 + 1).msg;
    if (window.UI && UI.toast) UI.toast(msg);
  }

  function arenaGo(page) {
    if (!current) return;
    current.arenaPage = page;
    showTab('arena');
  }
  function goArenaPage(page) {
    if (page) {
      arenaPage = page;
      if (current) current.arenaPage = page;
    }
    /* ⚠ 挑战页那一层**可能已经不在 DOM 上了**：`Main.startBattle` 一开打就
     * `$('#ui').innerHTML = ''`（把整棵显示树清掉），`current.view` 于是成了"连着但不在树上"
     * 现在**先看显示树还在不在**，不在就重新挂一整页（挂完由 `open()` 落到 `arenaPage`）。 */
    if (!current || !viewAttached()) {
      if (page) pendingArenaPage = page;
      pendingTab = 'arena';
      SfChallenge.openAt('arena');
      if (window.UI && UI.runAction) UI.runAction('challenge');
      /* 页面是异步挂的：战果弹窗必须等背景真的回来再开，否则会被 openChallenge
       * 的 `#ui.innerHTML = …` 当成旧节点清掉（用户 2026-11 报的“打完天梯返回卡死”）。 */
      return waitArenaView();
    }
    /* ⚠ 开打的那一瞬间也会走到这里（`fightArena` 里是 `Main.startBattle(...)` 之后紧跟
     * 而且会把赛事说明那层 DOM 又盖回战斗画面上。所以**战斗中只记页码、不动显示树**
     * （赛事提示条也要收掉 —— 它压在战斗画面底部会挡住「倍速 / 跳过」两键）。 */
    if (inBattle()) { closeArenaHint(); return; }
    /* ⚠⚠ "当时正在打"和"存档里 `busy` 还是 true"（打一半关掉页面 / 刷新）是两回事：
     *   以前只按 `run.busy` 判，刷新之后 `inBattle()` 永远为真、`goArenaPage('match')`
     *   每次都在这儿 return —— 挑战页那一层**永远不重建**，`#ui` 里只剩一条赛事提示条，
     *   `busy` 只用来判"战斗画面是否还在"（见 `inBattle`），回到赛事页就把它抹掉。 */
    ClassicExtrasClearBusy();
    showTab('arena');
    return Promise.resolve();
  }
  function waitArenaView(limit) {
    const max = Number(limit) || 120;
    return new Promise((resolve) => {
      let n = 0;
      const tick = () => {
        if (!current || viewAttached() || n++ >= max) { resolve(); return; }
        setTimeout(tick, 50);
      };
      tick();
    });
  }
  function viewAttached() {
    return !!(current && current.view && current.view.g && current.view.g.isConnected && current.host && current.host.isConnected);
  }
  /** 现在有没有一场战斗正在播。
   *  （`Battle.cornerLayout` 造的「倍速 / 跳过」，`aria-label` 是它俩的固定标识）。
   *  ⚠ 只按 `busy` 判会在"打一半刷新"之后永远为真，那一页就再也画不出来了。 */
  function inBattle() {
    const CE = window.ClassicExtras;
    if (!CE || !CE.arenaRun) return false;
    const run = CE.arenaRun();
    if (!(run && run.busy)) return false;
    return battleOnStage();
  }
  function battleOnStage() {
    return !!document.querySelector('[aria-label="跳过战斗"],[aria-label="切换战斗速度"]');
  }
  /** 把存档里"打了一半"的 `busy` 抹掉（回到赛事页时用；不抹会一直卡在"战斗中"）。 */
  function ClassicExtrasClearBusy() {
    const CE = window.ClassicExtras;
    if (CE && CE.clearArenaBusy) { try { CE.clearArenaBusy(); } catch (e) {} }
  }
  /* 竞技场报名后的"赛事页"：原版是 7638 的**第 5 帧**（`join1..4` 四个席位 + `statu`），
   * 由服务端开房后 `showRacing2` 拨过去。复刻的对手在本地生成，所以这一页照原版帧摆席位：
   *   · `join1..4`（席位卡 3385）第 1 帧 = 有人（带 `name` / `level` 两个字段），第 2 帧 = 空位；
   * ⚠ 这里以前把小半个屏幕都盖成复刻自研的 DOM 面板（`.sf-arena`），
   *   战斗一结束那层还挂在赛事页上、又压住战果弹窗 —— 用户口径是"一切看齐 ssfight、不调用现代界面 ui"，
   *   只能用"下一场开始"来推进），赛事信息本身全部落在原版帧的席位与 `statu` 上。 */
  function showArenaMatch() {
    const view = current && current.view;
    if (!view) return;
    closeArenaHint();
    stopAt(view, ARENA.join);
    wireClickable(clipOf(view, 'back'), { hover: 2, onFire: () => arenaGo('home') });
    const run = (window.ClassicExtras && ClassicExtras.arenaRun) ? ClassicExtras.arenaRun() : null;
    paintArenaSeats(view, run);
    /* 随机匹配 / 决赛 / 季军赛页只展示 3 秒（对齐天梯的「战斗准备中」），随后自动开打；
     * 初始匹配页不再摆「进入半决赛」按钮，决赛/季军页的结果弹窗也会在 3 秒后自动让位。 */
    if (run && !run.busy && !run.settled) scheduleArenaAutoFight(run);
    if (run && run.matching) return;
    if (run && !run.matching && window.SfFightResult && window.UI && UI.currentUiMode && UI.currentUiMode() === 'classic') {
      if (SfFightResult.isOpen()) return;
      const phase = run.phase, foe = phase === 'final' ? run.finalist : phase === 'third' ? run.consolation : run.foe;
      const title = phase === 'final' ? '决赛' : phase === 'third' ? '季军赛' : '半决赛';
      /* 用户 2026-11 口径（与联机版同步）：这一页只留「谁打谁 + 开始/返回」。
       * 战斗后的原版战果页（局内 7772 那张：经验 + 悬浮物品三格）。 */
      SfFightResult.open({ kind: 'arena', title, neutral: phase === 'semi', win: phase === 'semi' ? null : phase !== 'third', player: S(), foe,
        actions: [{ label: '开始' + title, run: () => { destroy(); ClassicExtras.fightArena(run); } },
          { label: '返回', run: () => arenaGo('home') }],
      }).catch(error => { if (window.UI && UI.toast) UI.toast(error.message); });
      return;
    }
    /* 贴底的细提示条（只在赛事页出现，**不进 `menuHost()`**）。
     * ⚠ 以前这一页用的是 `menuHost()` + 整块 `.sf-arena` 面板：它是按"对手动作菜单"建的
     *   常驻层，赛事页一离开没人收，战斗画面上就一直挂着那一层（还会压住战果弹窗）——
     *   现在它自己一个宿主、由 `closeArenaHint()` 在切页/开打时收干净。 */
    const ui = document.getElementById('ui');
    if (!ui) return;
    const host = document.createElement('section');
    host.className = 'classic-home ssfight-home ssfight-arenahint';
    host.setAttribute('aria-label', '竞技赛事');
    host.innerHTML = arenaMatchHtml(run);
    ui.appendChild(host);
    arenaHintHost = host;
    const fight = host.querySelector('[data-m="fight"]');
    if (fight) fight.addEventListener('click', () => {
      closeArenaHint();
      /* 匹配页 → 真正开打：清掉匹配标记，下一场回来才是战果/下一轮弹窗。 */
      if (run && run.matching) { run.matching = false; if (window.ClassicExtras && ClassicExtras.saveArenaRun) { try { ClassicExtras.saveArenaRun(run); } catch (e) {} } }
      if (window.ClassicExtras && ClassicExtras.fightArena) { destroy(); ClassicExtras.fightArena(run); }
    });
    const back = host.querySelector('[data-m="back"]');
    if (back) back.addEventListener('click', () => arenaGo('home'));
  }
  let arenaHintHost = null;
  /* 竞技场赛事页自动进战斗的等待时间：与天梯「战斗准备中」的 3 秒一致。
   * 切页、返回、手动点「开始」都会走 `closeArenaHint()` 取消计时，避免离开页面后还开战。 */
  const ARENA_AUTO_FIGHT_MS = 3000;
  let arenaAutoTimer = null;
  function cancelArenaAutoFight() {
    if (arenaAutoTimer) { clearTimeout(arenaAutoTimer); arenaAutoTimer = null; }
  }
  function scheduleArenaAutoFight(run) {
    cancelArenaAutoFight();
    if (!run || run.busy || run.settled) return;
    const phase = run.phase;
    arenaAutoTimer = setTimeout(() => {
      arenaAutoTimer = null;
      if (!current || inBattle()) return;
      const CE = window.ClassicExtras;
      if (!CE || !CE.arenaRun || !CE.fightArena) return;
      const live = CE.arenaRun();
      /* 手动开打 / 已经换阶段 / 已经结算 → 这一拍不再补开一场。 */
      if (!live || live !== run || live.busy || live.settled || live.phase !== phase) return;
      if (window.SfFightResult && SfFightResult.destroy) {
        try { SfFightResult.destroy(); } catch (e) {}
      }
      if (live.matching) {
        live.matching = false;
        if (CE.saveArenaRun) { try { CE.saveArenaRun(live); } catch (e) {} }
      }
      closeArenaHint();
      destroy();
      CE.fightArena(live);
    }, ARENA_AUTO_FIGHT_MS);
  }
  function closeArenaHint() {
    cancelArenaAutoFight();
    if (arenaHintHost && arenaHintHost.parentNode) arenaHintHost.parentNode.removeChild(arenaHintHost);
    arenaHintHost = null;
  }
  /** 竞技场赛事页的四个席位（原版 `showRacing2` 摆 `join1..4`）。
   *  所以只填"玩家 + 已确定的对手"，其余留空位 —— 不编服务端才会有的对手数据。 */
  function paintArenaSeats(view, run) {
    const s = S() || {};
    const rows = [null, null, null, null];
    if (run) {
      rows[0] = { name: s.name || '我', level: s.level };
      if (run.phase === 'semi') {
        rows[1] = run.foe || null;
        rows[2] = run.finalist || null;
        rows[3] = run.consolation || null;
      } else {
        rows[1] = run.foe || null;
        rows[2] = (run.phase === 'final' ? run.finalist : run.consolation) || null;
        rows[3] = run.consolation || null;
      }
    }
    for (let i = 0; i < 4; i++) {
      const card = clipOf(view, 'join' + (i + 1));
      if (!card) continue;
      const who = rows[i];
      stopAt(card, who ? 1 : 2);                      // 1 = 有人 / 2 = 空位
      /* 冠军杯子角标（`cup`）：只有"已经赢下最终那场"才配戴，复刻不预判，一律藏掉。 */
      setVisible(clipOf(card, 'cup'), false);
      if (!who) continue;
      setText(clipOf(card, 'name'), String(who.name == null ? '' : who.name));
      setText(clipOf(card, 'level'), String(who.level == null ? '' : who.level));
    }
    const statu = clipOf(view, 'statu');
    if (!statu) return;
    /* `statu`（7572）是两帧状态精灵：f1 =「匹配对手…」+ 7570 那颗 12 帧省略号动画，
     * ⚠ 不能用 `setText(statu, …)`：这颗是矢量画稿，没有文本字段，写了也不会显示。 */
    if (!run) { stopAt(statu, 2); return; }
    stopAt(statu, run.matching ? 1 : 2);
    if (run.matching) {
      /* 只放行 7570 这一颗：整页静态策略继续冻着，省略号按 12 帧循环。
       * 每次 `stopAt(statu, 1)` 可能重建子元件，所以先设策略、再取当前那颗。 */
      if (statu.setStaticPolicy) statu.setStaticPolicy({ keepIds: ['7570'] });
      const dot = [...statu.nodes.values()].find((r) => String(r.id) === '7570');
      if (dot && dot.clip) { dot.clip.__pinFrame = null; dot.clip.playing = true; }
    }
  }
  function arenaMatchHtml(run) {
    const phase = run ? run.phase : 'semi';
    const title = phase === 'final' ? '决赛' : phase === 'third' ? '季军赛' : '半决赛';
    const foe = phase === 'final' ? (run && run.finalist) : phase === 'third' ? (run && run.consolation) : (run && run.foe);
    return '<div class="sf-arena sf-arena-hint' + (run && run.matching ? ' matching' : '') + '">' +
      '<b>' + (run && run.matching ? '随机匹配完成 · ' : '') + esc(title) + '</b>' +
      (foe ? '<span>对手 ' + esc(foe.name) + '　Lv' + esc(foe.level) + '</span>' : '') +
      '<span>本场不再扣体力</span>' +
      '<button type="button" class="sf-mbtn main" data-m="fight">' + (run && run.matching ? '进入' : '开始') + esc(title) + '</button>' +
      '<button type="button" class="sf-mbtn" data-m="back">返回</button>' +
      '</div>';
  }
  function showArena() {
    const view = current.view;
    const lv = Math.max(1, Math.round(Number((S() || {}).level) || 1));
    const page = current.arenaPage || 'home';
    if (page === 'rules') return showArenaRules();
    if (page === 'menu') return showArenaMenu();
    if (page === 'match') return showArenaMatch();
    if (page === 'ladder') return showArenaLadder();
    stopAt(view, ARENA.home);
    const compete = clipOf(view, 'compete');
    stopAt(compete, lv >= 10 ? 1 : 2);
    wireClickable(compete && compete.byName ? compete.byName('button1') : null, {
      hover: 0, press: 0, idle: 1,
      onFire: () => {
        if (lv < 10) { if (window.UI && UI.toast) UI.toast('10级以上才可进入！'); return; }
        arenaGo('rules');
      },
    });
    wireClickable(compete && compete.byName ? compete.byName('button2') : null, {
      hover: 0, press: 0, idle: 1,
      onFire: () => { if (lv < 30) { if (window.UI && UI.toast) UI.toast('天梯赛需要达到30级。'); return; } arenaGo('menu'); },
    });
    wireClickable(clipOf(view, 'back'), {
      hover: 2,
      onFire: () => { destroy(); if (window.UI && UI.runAction) UI.runAction('home'); },
    });
  }
  /** 冠军赛规则页（`showRacing1` :15179 的 arenaType==1 分支 → 帧 4）。
   *  原版这一页只有一颗「开始竞技」：`arenaType=1` 是四人竞技场，奖励同时写经验 / 蓝碎片 /
   *  孵化点；复刻把经验场与碎片场拆成两套名次奖励（见 `classic-extras`），所以这一颗
   *  打开一个**小选择弹窗**：左英雄帖 = 经验场，右勇气徽章 = 碎片场。
   *  ⚠ 不新造按钮画稿，也不把整页换成现代 DOM；仍然只动原版 7638 第 4 帧。 */
  function showArenaRules() {
    const view = current.view;
    stopAt(view, ARENA.rules);
    /* 说明按真实框宽断行，写清两场名次奖励与门槛；选择弹窗只放两个道具图标。
     * ⚠ 这一块是右侧圆角面板里唯一的正文（字段框 215 宽、行距 13.8、字号 12）。
     *   · 标题行用「、」分隔三类奖励并去掉斜杠两侧的空格，不再把「点」挤成孤字；
     *   · 正文起点 x 从 3 调到 7：左侧留出约 8 个舞台单位，最宽的 16 字行右侧也还剩约 9 个。 */
    const desc = clipOf(view, 'desc');
    if (desc) setText(desc, fitText(desc,
      '【名次奖励】经验、蓝碎片、孵化点\n' +
      '冠军　150 / 8 / 40\n亚军　100 / 6 / 35\n' +
      '季军　 50 / 4 / 30\n殿军　 30 / 3 / 25\n' +
      '【报名】30体力，体力不足用入场券\n' +
      '经验场10级；碎片场/幻兽场15级'));
    // 面板左沿 93.3、文本框左沿 92；x=7 让正文离圆角约 8 个单位，右侧仍留得下 16 字行。
    const descNode = desc && (desc.g || desc);
    if (descNode) for (const text of descNode.querySelectorAll('text')) text.setAttribute('x', '7');
    const start = clipOf(view, 'startCompete');
    wireClickable(start, {
      hover: 0, press: 0, idle: 1,
      /* 原版这一颗是 `joinArena.do`（开房 → 服务端回 `showRacing2` 落赛事页）。
       * 复刻没有服务端，等价物是 `ClassicExtras.chooseArena()`：先选经验场 / 碎片场，
       * 再走 `startArenaCompete(kind)` 的等级 / 扣费 / 抽对手流程。 */
      onFire: () => {
        const CE = window.ClassicExtras;
        if (CE && CE.chooseArena) CE.chooseArena();
        else if (CE && CE.startArenaCompete) CE.startArenaCompete(0);
        else if (CE && CE.arena) CE.arena();
      },
    });
    wireClickable(clipOf(view, 'back'), { hover: 0, onFire: () => arenaGo('home') });
  }

  /** 天梯赛菜单（`showRacing1` :15244 的 arenaType==2 分支 → 帧 7：三颗键 + 返回）。
   *  复刻以前把三颗都接成了"排行榜"，用户 2026-10 报的"完善天梯赛的开始比赛按钮与
   *  金杯商店的跳转"就是这一条。玩法仍接 `js/classic-extras.js` 的实现。 */
  function showArenaMenu() {
    const view = current.view;
    stopAt(view, ARENA.menu);
    wireClickable(clipOf(view, 'button1'), {
      hover: 0, press: 0, idle: 1,
      onFire: () => { const CE = window.ClassicExtras; if (CE && CE.rankShop) CE.rankShop(0, 'ladder'); else arenaGo('ladder'); },
    });
    wireClickable(clipOf(view, 'button2'), {
      hover: 0, press: 0, idle: 1,
      onFire: () => startLadderMatch(),
    });
    wireClickable(clipOf(view, 'button3'), { hover: 0, press: 0, idle: 1, onFire: () => arenaGo('ladder') });
    wireClickable(clipOf(view, 'back'), { hover: 0, onFire: () => arenaGo('home') });
  }
  /* 「开始比赛」：直接开一场天梯对局。打完之后**回原版这一页**（天梯菜单），
   * 不是复刻自研的 DOM 天梯页 —— 否则整块背景又从原版 ui 换成现代 ui
   * （用户 2026-10 口径："不要在挑战途中背景会切换为现代界面"）。 */
  function startLadderMatch() {
    const CE = window.ClassicExtras;
    if (!CE) { arenaGo('ladder'); return; }
    if (CE.startRankFlow) CE.startRankFlow(() => goArenaPage('menu'));
    else if (CE.rankMatch) CE.rankMatch(() => { arenaGo('menu'); });
    else arenaGo('ladder');
  }
  /** 天梯榜（`showRank` → 帧 8）：**本赛区榜**。
   *  原版 `rankList.do` 不带参数、由服务端回 `type`（1..6 帧 = 30-39 … 80-90）；
   *  单机版由 `State.rankBoard()` 给出同一形状的数据：本赛区 30/33 个人机 + 玩家自己。 */
  function showArenaLadder() {
    const view = current.view;
    const s = S() || {};
    stopAt(view, ARENA.ladder);
    const board = State.rankBoard ? State.rankBoard() : null;
    const rows = (board && board.top) || [];
    const frame = Math.max(0, Math.min(6, Number(board && board.frame) || 0));
    stopAt(clipOf(view, 'type'), frame || 1);
    let page = 0;
    const pages = Math.max(1, Math.ceil(rows.length / 4));
    const paint = () => {
      for (let i = 0; i < 4; i++) {
        const e = rows[page * 4 + i];
        setText(clipOf(view, 'rank' + (i + 1)), e ? String(e.rank || page * 4 + i + 1) : '');
        setText(clipOf(view, 'name' + (i + 1)), e ? String(e.name || '') : '');
        setText(clipOf(view, 'inte' + (i + 1)), e ? String(e.score) : '');
      }
      setText(clipOf(view, 'myinte'), String(Math.max(0, Math.round(Number(s.integral) || 0))));
      setText(clipOf(view, 'myrank'), board && board.me && board.me.rank > 0 ? String(board.me.rank) : '-');
      setVisible(clipOf(view, 'left'), pages > 1 && page > 0);
      setVisible(clipOf(view, 'right'), pages > 1 && page < pages - 1);
    };
    paint();
    if (State.rankSyncWeek) State.rankSyncWeek();
    wireClickable(clipOf(view, 'button1'), {
      hover: 0, press: 0, idle: 1,
      onFire: () => {
        const CE = window.ClassicExtras;
        const C = window.UI && UI.classic;
        if (!CE || !CE.claimRankCup || !C) { if (CE && CE.rankShop) CE.rankShop(); return; }
        State.rankSyncWeek();
        const r = CE.claimRankCup();
        const icon = C.icon ? C.icon('prop', 40) : '';
        const body = '<div class="rank-claim">' +
          '<div class="rank-claim-line"><span>当前排名</span><b>第 ' + (r.rank || '-') + ' 名</b>' +
            '<span>积分</span><b>' + Math.max(0, Math.round(Number(s.integral) || 0)) + '</b></div>' +
          (r.ok
            ? '<div class="rank-claim-reward"><span class="reward-icon">' + icon + '</span><b>金杯 +' + r.cups + '</b><span>当前 ' + r.goldCup + '</span></div>'
            : '<p class="rank-claim-note">' + esc(r.msg) + '</p>') +
          '<p class="small-label">' + (r.ok ? '每周一 0 点积分减半；赛区前30名且超过至少一个人机即可领取50金杯。' : '每周结算后赛区前30名可领取一次（需要先超过一个人机）。') + '</p>' +
          '</div>';
        C.modal('天梯奖励', body, [{ label: '知道了', cls: 'gold' }], { small: true });
      },
    });
    wireClickable(clipOf(view, 'left'), { hover: 0, onFire: () => {
      if (page <= 0) return;
      page -= 1;
      paint();
    } });
    wireClickable(clipOf(view, 'right'), { hover: 0, onFire: () => {
      if (page >= pages - 1) return;
      page += 1;
      paint();
    } });
    wireClickable(clipOf(view, 'back'), { hover: 0, onFire: () => arenaGo('menu') });
  }
  let originalDialog = null;
  function closeOriginalDialog(owner, expected) {
    const dialog = originalDialog;
    if (!dialog || (owner && dialog.owner !== owner) || (expected && dialog !== expected)) return false;
    originalDialog = null;
    if (dialog.view) dialog.view.destroy();
    dialog.host.remove();
    if (dialog.owner && dialog.owner.isConnected) {
      dialog.owner.style.pointerEvents = dialog.pointerEvents;
      setBaseRouterEnabled(dialog.owner, true);
    }
    return true;
  }
  async function openOriginalDialog(symbol, options) {
    options = options || {};
    closeOriginalDialog();
    const owner = options.owner || (current && current.host);
    const ui = document.getElementById('ui');
    if (!owner || !owner.isConnected || !ui) return null;
    const host = document.createElement('section');
    host.className = 'classic-home ssfight-home ssfight-sub sf-original-dialog';
    host.setAttribute('aria-label', options.label || '确认');
    host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true');
    ui.appendChild(host);
    const dialog = { host, owner, view: null, pointerEvents: owner.style.pointerEvents };
    originalDialog = dialog;
    owner.style.pointerEvents = 'none'; setBaseRouterEnabled(owner, false);
    try {
      await SfRender.loadExtra('tags-social-dialog.json');
      if (originalDialog !== dialog || !owner.isConnected) { closeOriginalDialog(owner, dialog); return null; }
      const view = await SfRender.mountSymbol(host, symbol, { frame: 1, label: options.label || '确认' });
      if (originalDialog !== dialog || !owner.isConnected) { view.destroy(); closeOriginalDialog(owner, dialog); return null; }
      dialog.view = view;
      T().freezeDescendants(view);
      hideSubBackdrop(view);
      options.paint(view, () => closeOriginalDialog(owner, dialog));
      return view;
    } catch (e) { closeOriginalDialog(owner, dialog); throw e; }
  }
  function openOriginalConfirm(options) {
    options = options || {};
    return openOriginalDialog('4421', { owner: options.owner, label: options.label || '确认', paint(view, close) {
      setText(clipOf(view, 'info'), fitText(clipOf(view, 'info'), options.text || ''));
      const ok = clipOf(view, 'button1');
      const cancel = clipOf(view, 'button2');
      /* 竞技场报名确认：原版 4421 是「确定在左、取消在右」，用户要求调换。
       * 只交换两个按钮的 x 位置（y / 缩放不动），点击语义仍绑在 button1=确定 / button2=取消；
       * 必须在 wireClickable 之前换，热区才会按新位置量。其他确认框不传 swapButtons，保持原版。
       * `options.extraGap` 再把这组键向左右各推开一半（舞台单位），只用于用户点名的报名确认。 */
      if (options.swapButtons && ok && cancel && ok.g && cancel.g) {
        const ma = (clip) => {
          const p = String((clip && clip.g && clip.g.__baseMa) || '').split(',').map(Number);
          return p.length === 6 && p.every((v) => Number.isFinite(v)) ? p : null;
        };
        const a = ma(ok), b = ma(cancel);
        if (a && b) {
          const dx = b[4] - a[4];
          const sa = Math.abs(a[0]) || 1, sb = Math.abs(b[0]) || 1;
          const halfGap = Math.max(0, Number(options.extraGap) || 0) / 2;
          if (ok.setExtraTransform) ok.setExtraTransform('translate(' + ((dx + halfGap) / sa).toFixed(3) + ',0)');
          if (cancel.setExtraTransform) cancel.setExtraTransform('translate(' + ((-dx - halfGap) / sb).toFixed(3) + ',0)');
        }
      }
      /* 4399/4419 的第 2 帧是绿色悬停态（第 1 帧米色常态）；鼠标移上去变绿、移开还原。 */
      const buttonSpec = { idle: 1, hover: 2, press: 2 };
      wireClickable(ok, Object.assign({}, buttonSpec, { onFire: () => { if (close() && options.accept) options.accept(); } }));
      wireClickable(cancel, Object.assign({}, buttonSpec, { onFire: close }));
    } });
  }
  function subHost() {
    if (!current) return null;
    if (current.sub && current.sub.host && current.sub.host.isConnected) return current.sub.host;
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const el = document.createElement('section');
    el.className = 'classic-home ssfight-home ssfight-sub';
    el.setAttribute('aria-label', '挑战二级页');
    ui.appendChild(el);
    current.sub = { host: el, view: null };
    return el;
  }
  async function openSub(frame) {
    const page = current;
    if (!page) return null;
    const host = subHost();
    if (!host) return null;
    /* 二级/三级页一出现就停用**底页那根点击路由**（见 `setBaseRouterEnabled` 的注释）：
     * 用户 2026-10 口径"在这个页面下，上一级界面不会对鼠标的移动做出反馈"。 */
    setBaseRouterEnabled(page.host, false);
    const sub = page.sub, mine = (sub.request || 0) + 1;
    sub.request = mine;
    let view = sub.view;
    if (!view) {
      view = await SfRender.mountSymbol(host, '4756', { frame: frame || 5, label: '挑战二级页' });
      if (current !== page || page.sub !== sub || sub.request !== mine || host.isConnected === false) {
        try { view.destroy(); } catch (e) {}
        return null;
      }
      sub.view = view;
      T().freezeDescendants(view);
    } else {
      resetHits(view.g.ownerSVGElement);
      stopAt(view, frame || 5);
    }
    hideSubBackdrop(view);
    return view;
  }
  function isCurrentSub(view, page) {
    return !!(view && page && current === page && page.sub && page.sub.view === view &&
      page.sub.host.isConnected !== false && view.g && view.g.isConnected !== false);
  }
  /** 动作菜单（4756 第 1 帧）里有一张铺满舞台的 `3142`：黑色底 + `cx` 偏蓝 + 0.7 opacity，
   *  用户 2026-11 口径："多级页面不要这层可见滤镜。" 这里直接收掉这一张蒙层，
   *  菜单本体（`subframe` 4723）与底页都不动。 */
  function hideSubBackdrop(view) {
    if (!view || !view.nodes) return false;
    for (const rec of view.nodes.values()) {
      if (rec && String(rec.id) === '3142' && rec.node) {
        rec.node.style.display = 'none';
        return true;
      }
    }
    return false;
  }
  /** 二级/三级页的点击入口统一走它：挂载失败要留下痕迹（`window.__errs`），
   *  否则异步挂载的拒绝会变成"点了没反应"。 */
  function guard(promise) {
    if (promise && typeof promise.catch === 'function') {
      promise.catch((e) => { if (window.__errs) window.__errs.push('SfChallenge sub: ' + (e && e.message)); });
    }
  }
  function closeSub() {
    closeArenaHint();
    if (current) closeOriginalDialog(current.host);
    /* 收二级页的同时**恢复底页那根点击路由**（`openSub` / `showFriendMenu` 里停用的那一根）：
     * 不恢复的话退回一级页之后整页对鼠标没反应。放在 `current.sub = null` 之前取 host。 */
    if (current && current.host) setBaseRouterEnabled(current.host, true);
    if (!current || !current.sub) return;
    if (current.sub.view) { try { current.sub.view.destroy(); } catch (e) {} }
    if (current.sub.host && current.sub.host.parentNode) current.sub.host.parentNode.removeChild(current.sub.host);
    current.sub = null;
  }
  /** 三级页 = 难度选择（`showhardWin` :23409：`tiaozhanSub.gotoAndStop(5)` + `style` 按门号切帧
   *  ⚠ 「继续挑战」**只在六级页的这一档**（用户 2026-10 口径："参考 ssfight 给出正确的显示逻辑"）。
   *  复刻的 `State.stageRun(id)` 就是那份 `keep`：**一轮打到一半还留着存档**（没通关时
   *  `stageRuns[id]` 不会被删，整轮 3 场全胜才 `delete`，见 state.js 的 `finishStageBattle`）。
   *  和新一轮该不该继续毫无关系。 */
  async function openGate(t) {
    const page = current;
    const view = await openSub(5);
    if (!isCurrentSub(view, page)) return;
    resetHits(view.g.ownerSVGElement);
    stopAt(clipOf(view, 'style'), t + 1);
    const starFrame = (id) => (State.stageRun(id) ? 2 : (State.stageAccess(id).ok ? 1 : 3));
    for (let st = 1; st <= 6; st++) {
      const id = t * 6 + st;
      const card = clipOf(view, 'button' + st);
      stopAt(card, starFrame(id));
      wireClickable(card, {
        hover: 0, press: 0,
        idle: () => starFrame(id),
        onFire: () => ((State.stageRun(id) || State.stageAccess(id).ok) ? guard(openGateConfirm(t, st)) : lockedNotice(t)),
      });
    }
    wireClickable(clipOf(view, 'back'), { hover: 0, onFire: () => { closeSub(); showTab('gates'); } });
  }
  /** 三级页 = 出战确认（`showFightWin` :1192：`gotoAndStop(4)` + `info1`/`info2` + 两颗键）。
   *  ⚠ 用户 2026-10 口径："关卡界面点击挑战后的界面中的介绍文字排版有大问题，严重超出屏幕范围。"
   *  断得过窄 → 行数翻倍，而 `render.js` 的文本容器**只按框宽横向裁、纵向是放开的**，
   *  现在改用 `fitText()`：拿字段自己的框宽 + 实际字体量出来的字符宽算每行能放几个字符。
   *  ⚠ 另外要把**行数**卡在框高里：原版那两颗键（`button1` / `button2`）就在文字正下方，
   *  再多一行就压上去。两段文案都压到"够放"的条数。 */
  async function openGateConfirm(t, st) {
    const id = t * 6 + st;
    const page = current;
    const view = await openSub(4);
    if (!isCurrentSub(view, page)) return;
    resetHits(view.g.ownerSVGElement);
    const s = S(), type = GData.stageTypeOf(id), run = State.stageRun(id);
    const npc = State.npcOf(id, run ? run.npcIndex : 1);
    const reward = State.stageReward(id);
    const exhausted = run && run.needsRevive && run.revives >= 2;
    const cost = exhausted ? '复活机会已用完' : run ? (run.needsRevive ? '复活需1个挑战书' : '不消耗挑战书') : '每轮1个挑战书';
    const info1 = clipOf(view, 'info1'), info2 = clipOf(view, 'info2');
    const enemyCount = GData.stageEnemyCount ? GData.stageEnemyCount(id) : 3;
    const expText = enemyCount === 1 ? String(GData.stageNpcExp(id, 1))
      : [1, 2, 3].map((i) => GData.stageNpcExp(id, i)).join('/');
    /* `info1`（4730）：消耗 + 奖励。原版框高 86、字号 12 时行距 14.8，5 行会顶到框底；
     * 缩到 11 号后仍是原字体、行数不变，但 5 行只到 65 左右，不再压到下面的 `info2`。 */
    setFieldText(info1, '【消耗】' + cost + '\n【奖励】经验' + expText + '、金松果' + reward.gold + '、几率得碎片', 11);
    /* `info2`（4727）：对手 + 连战规则。原版框只放得下 3 行（框高 44、行距 11.8），
     * 4 行就会压住下面的两颗键 —— 缩到 11 号后 4 行到 39.6，刚好在框内。 */
    setFieldText(info2,
      '对手：' + npc.name + '（' + (run ? run.npcIndex : 1) + '/' + enemyCount + '）\n' +
      (enemyCount === 1 ? '超级大关只有1个敌人\n中途失败可用挑战书复活'
        : '连续击败3名敌人\n中途失败可用挑战书复活'), 11);
    const ok = clipOf(view, 'button1'), no = clipOf(view, 'button2');
    /* 用户 2026-10 口径：出战确认的「返回 / 战斗」位置对调（原版战斗在左、返回在右），
     * 的 swapButtons 同一套做法：只换两个 clip 的 x 位移，点击语义仍绑
     * button1=战斗 / button2=返回，且必须在 `wireClickable` 之前换，热区才会按新位置重新量。
     * 注意方向：战斗要移到右槽，返回移到左槽；`GAP` 是两颗键合计再拉开的舞台单位。 */
    if (ok && no && ok.g && no.g) {
      const ma = (clip) => String(clip.g.__baseMa || '').split(',').map(Number);
      const a = ma(ok), b = ma(no);
      if (a.length === 6 && b.length === 6 && a.every(Number.isFinite) && b.every(Number.isFinite)) {
        const dx = b[4] - a[4], GAP = 26, halfGap = GAP / 2;
        const sa = Math.abs(a[0]) || 1, sb = Math.abs(b[0]) || 1;
        if (ok.setExtraTransform) ok.setExtraTransform('translate(' + ((dx + halfGap) / sa).toFixed(3) + ',0)');
        if (no.setExtraTransform) no.setExtraTransform('translate(' + ((-dx - halfGap) / sb).toFixed(3) + ',0)');
      }
    }
    wireClickable(ok, {
      hover: 0, press: 0, idle: 1,
      onFire: () => {
        const c = window.UI && UI.classic;
        /* ⚠ 不要先 `closeSub()` / `destroy()`：`stageFight()` 会把整棵挑战页（连同这颗
         * 出战确认页）摘下来、打完原样挂回。在这里拆掉就只能战后重建，回来还是会卡一下。
         * 真正清屏的是 `Main.startBattle` 的 `#ui.innerHTML=''`；页面由
         * `holdPageForBattle()` 保管。 */
        if (c && c.stageFight) { c.stageFight(id); return; }
        /* 没有经典关卡入口（现代/素材缺失）才退回"先拆页再走 UI 路由"。 */
        closeSub();
        destroy();
        if (window.UI && UI.runAction) UI.runAction('stages');
      },
    });
    wireClickable(no, { hover: 0, press: 0, idle: 1, onFire: () => { closeSub(); showTab('gates'); } });
    if (exhausted) stopAt(ok, 3);
    void type;
  }

  let openTrace = '';
  /* 下一次 `open()` 直接落到哪个 tab（`openAt` 用；`open()` 是异步的，
   * 调用方没法"挂完再切"——所以让挂载自己带上目标 tab）。 */
  let pendingTab = null;
  let pendingGate = null;
  let arenaPage = null;
  let pendingArenaPage = null;
  async function open(container) {
    openTrace = 'start';
    if (!window.SfRender || !window.SfRender.mountSymbol) throw new Error('SfRender 未加载（缺 js/ssfight/render.js）');
    const t = T();
    if (!t) throw new Error('SfUiMain.toolkit 不在（缺 js/ssfight/ui-main.js）');
    let host = container || (current && current.host);
    if (!host) {
      const ui = document.getElementById('ui');
      if (ui) {
        ui.innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠挑战"></section>';
        host = ui.querySelector('.ssfight-home');
      }
    }
    if (!host) { openTrace = 'no-host'; return false; }
    const mine = ++seq;
    destroyView();
    openTrace = 'destroyed mine=' + mine;
    await SfRender.loadExtra('tags-challenge.json');
    if (mine !== seq || host.isConnected === false) { openTrace = 'stale'; return false; }
    /* 对手立绘要贴**它自己的装备**（原版 `showFace`）：容器素材在 `tags-gear.json`（1.8 MB），
     * 只有真进挑战页才拉；拉不到就只是不贴装备，不影响整页。 */
    try { await SfRender.loadExtra('tags-gear.json'); } catch (e) {}
    await loadGearTables();
    if (mine !== seq || host.isConnected === false) { openTrace = 'stale'; return false; }
    const view = await SfRender.mountSymbol(host, '7638', { frame: PAGE.random, label: '挑战' });
    if (mine !== seq || host.isConnected === false) {
      try { view.destroy(); } catch (e) {}
      return false;
    }
    openTrace = 'mounted';
    const wantArena = pendingArenaPage || arenaPage;
    current = { view: view, host: host, tab: 'random', page: 1, sel: 0, gateSel: 0, roster: null, rows: [], refreshRow: false, arenaPage: wantArena || 'home', sub: null };
    pendingArenaPage = null;
    arenaPage = null;    /* 量一次布局（见 ui-main.js 里同一处的注释：经典整页 320×196，`#ui` 高度在 716.625 / 690
     * 之间切，不重量就会"屏幕边缘失去填充"）。 */
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    applySilence(view);
    try { showTab(pendingTab || 'random'); } catch (e) { if (window.__errs) window.__errs.push('challenge showTab: ' + (e && e.message)); }
    pendingTab = null;
    if (pendingGate != null && current) {
      const g = pendingGate; pendingGate = null;
      current.gatePage = Math.floor(g / 3);
      current.gateSel = g;
      try { guard(openGate(g)); } catch (e) {}
    }
    openTrace = 'done';
    return true;
  }
  function destroyView() {
    clearRefreshTimer();
    if (current) {
      closeSub();
      if (current.view) { try { current.view.destroy(); } catch (e) {} }
    }
    closeArenaHint();
    current = null;
  }
  function destroy() {
    seq++;
    destroyView();
    const statusOpen = !!(window.SfStatus && SfStatus.current && SfStatus.current());
    if (!statusOpen && window.SfRender && SfRender.releaseExtra) SfRender.releaseExtra('tags-challenge.json');
  }

  window.SfChallenge = Object.freeze({
    open: open,
    destroy: destroy,
    showTab: (k) => showTab(k),
    /** 打开挑战页并**直接落到某个 tab**（`open()` 是异步的，挂完再切会落到还没建好的树上）。
     *  关卡战打完之后回到「关卡」用的是它 —— 不然会掉回随机页 / 复刻自研的 DOM 关卡页。 */
    openAt: (k) => { pendingTab = k || 'random'; },
    /** 战斗前把当前挑战页从 `#ui` 摘下来、打完原样挂回去（同一棵 SVG，不重挂）。
     *  `resumePageAfterBattle(hold, tab)` 返回 false 时调用方才退回重挂路径。 */
    holdPageForBattle: holdPageForBattle,
    resumePageAfterBattle: resumePageAfterBattle,
    /** 竞技场里的子页（`home` / `rules` / `menu` / `ladder`）——给回归用例与
     *  外部入口用，不用真的去点那几颗按钮。 */
    setArenaPage: (p) => { arenaGo(p || 'home'); },
    goArenaPage: (p) => goArenaPage(p),
    /** 切到「关卡」tab 并直接进第 t 种类型的难度页（`backToStages(t)` 用）。
     *  页面还没挂好时先记下来，`open()` 挂完自动补上。 */
    openGateAt: (t) => {
      const n = Math.max(0, Math.min(5, Number(t) || 0));
      if (!current) { pendingGate = n; return; }
      current.gatePage = Math.floor(n / 3);
      current.gateSel = n;
      showTab('gates');
      guard(openGate(n));
    },
    /** 关卡连战回到**已经挂着的**难度页：只更新三级页的星标/文案，不 `showTab`
     *  把整页原样挂回之后的刷新。 */
    refreshGateAt: (t) => {
      const n = Math.max(0, Math.min(5, Number(t) || 0));
      if (!current) { pendingGate = n; return; }
      current.gatePage = Math.floor(n / 3);
      current.gateSel = n;
      guard(openGate(n));
    },
    resetRoster: () => { randomCache = null; if (current) { current.roster = null; current.sel = 0; current.arenaPage = 'home'; } },
    /** 打开某一行的动作菜单（探针 / 外部入口用；等价于点那一行）。 */
    openFriendMenu: (i) => openFriendMenu(Number(i) || 0),
    openAddFriendPage,
    openOriginalConfirm,
    closeOriginalDialog,
    openDummyRecord,
    /** 「查看装备」（原版 `friendEquipsInfo()`）：状态页上那颗 `b_change` 的 4/5 帧调它。
     *  ⚠ 以前没有这个导出 —— 状态页调 `SfChallenge.showFriendGears` 永远拿到 undefined，
     *  于是点「查看装备」直接兜底回挑战页（用户 2026-10 报的"会闪退"）。 */
    showFriendGears: (foe) => showFriendGears(foe),
    selectRow: (i) => selectRow(i),
    view: () => (current ? current.view : null),
    subView: () => (current && current.sub ? current.sub.view : null),
    current: () => (current ? { tab: current.tab, page: current.page, sel: current.sel, arenaPage: current.arenaPage } : null),
    /** 内部状态快照（调试 / 回归探针用）：行数据、名单、右面板写进去的文本。 */
    debug: () => {
      if (!current) return null;
      const texts = (n) => {
        const c = clipOf(current.view, n);
        return c && c.g ? [...c.g.querySelectorAll('text')].map((t) => t.textContent) : null;
      };
      const bg = clipOf(current.view, 'rightBg');
      const btext = (n) => {
        const c = bg && bg.byName ? bg.byName(n) : null;
        return c && c.g ? [...c.g.querySelectorAll('text')].map((t) => t.textContent) : null;
      };
      return {
        tab: current.tab, page: current.page, sel: current.sel, refreshRow: current.refreshRow,
        rows: (current.rows || []).map((r) => (r ? { name: r.name, level: r.level, power: r.power, agility: r.agility, speed: r.speed, hp: r.hp, kind: r.kind } : null)),
        roster: (current.roster || []).map((r) => (r ? { name: r.name, level: r.level, power: r.power, hp: r.hp, kind: r.kind } : null)),
        rightBgFrame: bg ? bg.frame : null,
        stats: { power: btext('power'), agility: btext('agility'), speed: btext('speed'), hp: btext('hp') },
        rowNames: [1, 2, 3, 4].map((i) => {
          const r = clipOf(current.view, 'f' + i);
          const nm = r && r.byName ? r.byName('friendname') : null;
          const lv = r && r.byName ? r.byName('flevel') : null;
          const tx = (c) => (c && c.g ? [...c.g.querySelectorAll('text')].map((t) => t.textContent).join('') : null);
          return { row: 'f' + i, name: tx(nm), level: tx(lv) };
        }),
      };
    },
    trace: () => openTrace,
  });
})();
