/* ============================================================
 * tower-ui.js — 无尽挑战塔界面（经典 UI 壳内）
 * 入口在「关卡」页下滑；主塔/无尽两个页面都在这里。
 * 爬塔可视化：左侧塔身楼层条 + 右侧当层对手预告/构筑。
 *
 * 目录（Ctrl+F 搜「【U编号】」直达）：
 *   【U1】基础助手              【U7】无尽页面            【U13】无尽：里程碑·重试·战败结算
 *   【U2】通用小件              【U8】战斗闭环            【U14】无尽：试炼币商店 + U14b 铸币商店
 *   【U3】对手头像与立绘        【U9】场间抉择弹窗        【U15】无尽：永久牺牲
 *   【U4】增益面板与货币条      【U10】主塔结算           【U16】无尽：结算点与结算
 *   【U5】入口图鉴与塔身可视化  【U11】选取型强化弹窗     【U17】模块导出 window.TowerUI
 *                               【U12】永久增益替换
 * ============================================================ */
(function () {
  'use strict';
  /* ============================================================
   * 【U1】基础助手 —— DOM 助手 / 飘字提示 / 排序
   * ============================================================ */
  const C = () => UI.classic;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const find = (root, sel) => root.querySelector(sel);
  function on(root, action, handler) { const el = find(root, '[data-action="' + action + '"]'); if (el) el.onclick = handler; return el; }
  function back(root, handler, label) { const el = on(root, 'home', handler); if (el) el.textContent = label || '返回'; }
  /** 【2026-10 用户口径】两座塔页面（挑战塔 / 无尽塔）的「返回」都回**上一级界面** = 关卡页
   *  （挑战塔与无尽塔本来就是关卡页里那两颗入口进来的：`[data-action="tower-entry"]` /
   *  `[data-action="endless-entry"]`），不是直接回主界面。
   *  `runAction` 只挂在 `window.UI` 顶层、**不在** `UI.classic` 里，测试桩里也可能没有 ——
   *  拿不到就退回 `C().home()`，免得点一下「返回」直接抛异常。 */
  function backToStages() {
    try {
      if (typeof UI !== 'undefined' && UI && typeof UI.runAction === 'function') { UI.runAction('stages'); return; }
    } catch (e) {}
    C().home();
  }
  function notice(text, buttons) { modal('提示', '<p>' + esc(text) + '</p>', buttons || [{ label: '知道了' }], { small: true }); }
  /** 隐藏成就的「飘一条提示」：非阻塞、几秒后自己消失，不打断操作。
   *  用 document 判空，保证无 DOM 环境（测试）调用不会炸。 */
  function achievementToast(item) {
    if (!item || typeof document === 'undefined' || !document.body) return;
    const el = document.createElement('div');
    el.className = 'achieve-toast';
    el.innerHTML = '<b>' + esc(item.name) + '</b><i>隐藏成就 · 分数 +' + esc(item.points || 0) + '</i>';
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('out'); }, 2600);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3400);
  }
  /** 把状态机返回的成就列表逐条飘出来（战斗前后都可能产生）。 */
  function flushAchievements(list) {
    for (const it of (list || [])) achievementToast(it);
  }
  /** 把状态机攒下的「本局待提示」取走并飘出来（例如「碎掉的烙印失效」）。 */
  function flushRunToasts() {
    let list = [];
    try { list = Tower.takeRunToasts ? Tower.takeRunToasts() : []; } catch (e) { list = []; }
    for (const t of list) runToast(t);
  }
  /** 轻量飘字（比成就条更朴素，用于「碎烙印失效」这类过程提示）。
   *  `hold`：停留更久（用户口径 2026-10：**第一次失去烙印**那一条要停久一点）——
   *  它紧跟着一段剧情，飘字太快闪过玩家根本来不及看。 */
  function runToast(text, hold) {
    const el = document.createElement('div');
    el.className = 'run-toast' + (hold ? ' hold' : '');
    el.textContent = String(text || '');
    document.body.appendChild(el);
    const stay = hold ? 7000 : 2400;
    setTimeout(() => { el.classList.add('out'); }, stay);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, stay + 800);
  }

  const RARITY = TowerData.RARITY_NAME || ['普通', '稀有', '史诗', '传奇'];
  const SCOPE = { limited: '限次', permanent: '永久', instant: '即时' };
  /* 无尽塔的「环境词缀」：段位机制（荆棘反伤/自愈回复/吸血/护盾/吞噬成长）已经并进来了，
   * 所以现在只有这一个常驻负面机制来源。每条环境都带：本局摇出来的实际数值、
   * 渲染好的效果文案、数值区间（悬停可见）。 */
  let replaceTarget = null;
  /** 【U20】被剧情屏让路的「里程碑奖励」（同一场战斗之后先播剧情，播完再弹它）。 */
  let pendingMilestone = null;
  /* 从经典村庄「征战」进来还是从关卡页进来：决定返回目标和顶部外壳。 */
  let towerOrigin = 'stages';
  function setTowerOrigin(opts) { if (opts && opts.from) towerOrigin = String(opts.from); }
  function classicTower() {
    try { return towerOrigin === 'village' && window.UI && UI.currentUiMode && UI.currentUiMode() === 'classic'; }
    catch (e) { return false; }
  }
  function backToVillageWar() {
    try {
      /* 用户口径：点「返回征战」回村庄主界面，不再弹「挑战塔/无尽塔」二选一。 */
      if (window.UI && UI.runAction) { UI.runAction('village'); return; }
    } catch (e) {}
    C().home();
  }
  function towerBack() { return classicTower() ? backToVillageWar() : backToStages(); }
  function classicTowerBar() {
    let b = '';
    try { b = C().btn('返回征战', 'home', 'gold'); } catch (e) { b = '<button type="button" class="uc-button gold" data-action="home">返回征战</button>'; }
    /* 顶部只留返回键；塔名/层数在页面内容里，不再额外压一行标题。 */
    return '<div class="classic-tower-bar">' + b + '</div>';
  }
  /** 经典塔页背景：**纯色**。
   *  · 挑战塔固定村庄绿；
   *  · 无尽塔随层数从村庄绿慢慢压到 100 层的暗红，每 100 层重制（101 层回绿）。 */
  function classicTowerBackground(mode, layer) {
    if (!classicTower()) return null;
    if (mode !== 'endless') return { color: '#4c7c50', t: 0 };
    /* 每 100 层重制：100 层暗红，101 层回到绿色，200 层再暗红。 */
    const cycle = ((Math.max(1, Number(layer) || 1) - 1) % 100) + 1;
    const t = Math.max(0, Math.min(1, (cycle - 1) / 99));
    const mix = (a, b) => Math.round(a + (b - a) * t);
    return {
      color: 'rgb(' + mix(76, 67) + ',' + mix(124, 8) + ',' + mix(80, 8) + ')',
      t: t,
    };
  }
  /** 把当前页的背景色写到 `--tower-bg`（CSS 只用这一个变量，别再加渐变端点）。 */
  function applyClassicTowerBg(p, mode, layer) {
    if (!p || !p.style) return;
    const bg = classicTowerBackground(mode, layer);
    if (bg) p.style.setProperty('--tower-bg', bg.color);
  }

  /* 附魔（不占位）的排前面：判据是**这一条栏位自己的** `slotFree`。
   * 【2026-10 同名逐条】不再用「同名 id 出现过」兜底 —— 那会让新拿到的同名件
   * 也显示成「已附魔（不占位）」。老档的 slotFree 已经在 normalizeRun 里逐条补好。 */
  function orderPermanent(list) {
    const arr = (list || []).slice();
    const isFree = (b) => !!(b && b.slotFree === true);
    /* 【U20】剧情件（`story` 标签，例：照影之境）**永远排在最前面** ——
     * 用户口径：拾取之后它就挂在「永久增益」的第一格上。
     * ⚠ 这里用 `window.TowerData` 而不是裸的 `TowerData`：本函数的源码片段会被单测截出来
     * 单独跑（见 test-fixes-round.cjs 的「需求64」），那个上下文里没有 TowerData ——
     * 缺了就当没有剧情件，排序与旧版完全一致。 */
    const TD = (typeof window !== 'undefined' && window && window.TowerData) ? window.TowerData : null;
    const isStory = (b) => {
      const def = (TD && TD.BUFF_BY_ID && b) ? TD.BUFF_BY_ID[b.id] : null;
      return !!(def && TD.hasTag && TD.hasTag(def, 'story'));
    };
    return arr.map((b, i) => ({ b: b, i: i, s: isStory(b) ? 0 : 1, f: isFree(b) ? 0 : 1 }))
      .sort((x, y) => (x.s - y.s) || (x.f - y.f) || (x.i - y.i))
      .map((x) => x.b);
  }
  /** 【2026-10 同名逐条】行引用：优先 uid（精确到那一条），没有 uid 才退回 id。
   *  放在 orderPermanent 之后：单测会截取「orderPermanent … 通用小件」这一段来跑，
   *  定义写在片段里才能被一起带上。 */
  const rowRef = (b) => (b && b.uid != null && Number(b.uid) > 0 ? String(b.uid) : (b ? String(b.id) : ''));

  /* ============================================================
   * 【U2】通用小件 —— 血条 / 悬停提示 / 弹窗封装 / 环境词缀胶囊
   * ============================================================ */
  // ---------- 通用小件 ----------

  function carryBar(hp, maxHp, label, cls, tip) {
    const cap = Math.max(0, Math.round(Number(maxHp) || 0));
    const cur = Math.max(0, Math.round(Number(hp) || 0));
    const pct = cap > 0 ? Math.max(0, Math.min(100, Math.round(cur / cap * 100))) : 0;
    const tipAttr = tip ? ' data-tip="' + esc(tip) + '" title="' + esc(tip) + '" tabindex="0"' : '';
    return '<div class="tower-carry' + (cls ? ' ' + cls : '') + '"' + tipAttr + '><span>' + (label || '血量') + '</span>' +
      '<div class="tower-carry-bar"><i style="width:' + pct + '%"></i></div><b>' +
      (cap > 0 ? (cur + ' / ' + cap) : '—') + '</b></div>';
  }
  /** 本局当前的血量上限 / 当前血量（血条悬停用）。 */
  function hpTip(run) {
    /* curMaxHp / curHp 都在 tower.js 里现算（拿到增益、抬上限立刻反映）。 */
    const maxHp = Number(run && run.curMaxHp) || Number(run && run.lastMaxHp) || 0;
    if (!(maxHp > 0)) return '血量上限：打完第一场后显示';
    const hp = Math.max(0, Math.round(Number(run && run.curHp != null ? run.curHp : run.lastHp) || 0));
    return '当前血量 ' + hp + ' / 上限 ' + maxHp;
  }
  let tipEl = null;
  function showTip(text, anchor) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tower-tip-float'; document.body.appendChild(tipEl); }
    tipEl.textContent = text;
    tipEl.style.display = 'block';
    const r = anchor.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
    /* 气泡默认挂在行下方；但无尽塔右下角固定着「继续战斗 / 放弃本局」两颗键，
     * 最后几行的气泡展开时会整块压住按钮。这里把下边界收在 `.endless-actions` 上沿，
     * 放不下就翻到上方（同一套判据，只是提前了上限）。 */
    let bottomLimit = window.innerHeight - 8;
    try {
      const actions = document.querySelector('.endless-actions');
      if (actions) {
        const ar = actions.getBoundingClientRect();
        if (ar.height > 0 && ar.top > 0) bottomLimit = Math.min(bottomLimit, ar.top - 8);
      }
    } catch (e) { /* 没有那一栏就按窗口算 */ }
    let top = r.bottom + 8;
    if (top + t.height > bottomLimit) top = Math.max(8, r.top - t.height - 8);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - t.width - 8));
    tipEl.style.left = Math.round(left) + 'px';
    tipEl.style.top = Math.round(top) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
  /** 把带 data-tip 的行绑上悬停/聚焦气泡（点击后也收起，避免残影）。 */
  function bindTips(root) {
    root.querySelectorAll('[data-tip]').forEach((el) => {
      const text = el.getAttribute('data-tip');
      el.onmouseenter = () => showTip(text, el);
      el.onmouseleave = hideTip;
      el.onfocus = () => showTip(text, el);
      el.onblur = hideTip;
      el.onclick = hideTip;
    });
  }
  function modal(title, content, buttons, opts) {
    const m = C().modal(title, content, buttons, opts);
    if (m && m.element) bindTips(m.element);
    return m;
  }
  /** 一条环境胶囊：悬停显示「完整效果 + 本局实际数值 + 数值区间 + 剩余场数」。
   *  数值已经是本局摇出来的那一份（tower.js envValues 注入）。 */
  function envChip(e, opts) {
    const o = opts || {};
    const tip = [
      e.text || e.desc || '',
      e.rangeText ? ('数值区间：' + e.rangeText) : '',
      '剩余 ' + e.left + ' 场',
    ].filter(Boolean).join('\n');
    const cls = 'mech-chip env-chip' + (e.bad ? ' env-bad' : ' env-good') + (e.mech ? ' env-mech' : '');
    return '<span class="' + cls + '" data-tip="' + esc(tip) + '" title="' + esc(tip) + '" tabindex="0">' +
      esc(e.name || e.id) +
      '<i>' + (o.compact ? ('剩' + e.left) : ('剩 ' + e.left + ' 场')) + '</i></span>';
  }
  /** 环境面板：当前生效的全部环境（唯一常驻负面机制）。没有环境时给一句提示。
   *  【100 层循环】环境按**轮内层号**开关：每轮都是「第 5 层起可能出现」，
   *  所以第 101~104 层与第 1~4 层一样没有环境（`canHaveEnv`），105 层起照旧。 */
  function envPanelHtml(run, opts) {
    const o = opts || {};
    const list = (run && run.env) || [];
    /* 【2026-10 用户口径】**没有环境词缀时整块不渲染** —— 以前会挂一行「当前环境」+
     * 「当前没有环境词缀（每轮第 5 层起可能出现）」的说明，用户不要这条提示：
     * 没影响就别占版面（有环境时照旧逐条列出）。 */
    if (!list.length) return '';
    const chips = list.map((e) => envChip(e, o)).join('');
    return '<div class="tower-rule mech-bar env-bar"><b>' + (o.label || '当前环境') + '</b>' + chips + '</div>';
  }
  function mechTip(info, mechs) {
    const parts = [];
    if (info.mechDesc) parts.push(info.mechDesc);
    if (info.patternDesc) parts.push(info.patternDesc);
    /* 生效中的环境词缀（唯一常驻负面机制）也写进气泡。调用方传进来的就是渲染好的文案。 */
    if (mechs && mechs.length) {
      parts.push('当前环境：' + mechs.join('；'));
    }
    return parts.join('\n') || '没有特殊机制';
  }
  /* ============================================================
   * 【U3】对手头像与立绘 —— foePortraitHtml / fillFoeArt
   * ============================================================ */
  /* ---------- 对手头像 ----------
   * 三侠 / 机制 NPC 用现成的经典立绘卡（characters/*.json 里的整身图）；
   * 松鼠形态的 boss 要连装备一起画，所以用引擎把「待机帧 + 装备图层」渲到小 canvas 上
   * —— 这套 wears 就是战斗里真正穿的那套（tower-data 的 GEAR / wearsOf）。 */
  const CHAR_FILE = { tl: 'mantis', xh: 'crane', xm: 'panda' };
  const SQ_SHEETS = ['SQ_01', 'SQ_02', 'weaponAttack', 'throwweaponAttack'];
  /* 机制 NPC 复用三侠的动画表，但立绘卡和三侠是同一张（预告里会出现「两个螳螂」），
   * 所以只有三侠用立绘卡，机制 NPC 也走引擎渲染（它们自己的待机帧）。 */
  const NPC_SHEETS = { tl: ['tl'], xh: ['xh1', 'xh2'], xm: ['xm1', 'xm2'] };
  const NPC_IDLE = { tl: 'tl_rest', xh: 'xh_rest', xm: 'xm_rest' };
  const AVATAR_SIZE = 104;
  function foePortraitHtml(index, info) {
    /* 征战动物 boss：现代模式也借经典 6833 素材（用户明确允许）；否则现代 canvas
     * 没有对应的动物图集，只会画成松鼠 / 空白。 */
    if (info.kind === 'campaign') {
      return '<span class="foe-portrait"><span class="sf-classic-campaign" data-campaign-foe="' +
        index + '"></span></span>';
    }
    /* 经典塔：三侠/机制 NPC 直接用关卡里那张经典立绘卡，松鼠 boss（含巡逻魔王）
     * 一律复用随机挑战右栏的 7232 + 装备挂点，不再画现代图集 canvas。 */
    if (classicTower()) {
      const file = (info.kind === 'hero' || info.kind === 'npc') ? (CHAR_FILE[info.anim] || 'mantis') : null;
      if (file) return '<span class="foe-portrait"><img alt="" src="images/ui/characters/' + file + '-classic-card.png"></span>';
      /* 松鼠 boss 直接复用随机挑战右栏那块 7232：同一颗元件、同一套装备挂点
       * （showFace 口径）。巡逻魔王也走这里 —— 它的黑色狂战套由 tower.js 的
       * `gear`（181~184 / 容器帧 119）交给 attachClassicGear() 贴上去；
       * 以前单独走 Engine canvas 才会变成现代图集外观、比例也和三侠卡对不上。 */
      return '<span class="foe-portrait"><span class="sf-classic-foe" data-classic-foe="' + index + '"></span></span>';
    }
    if (info.kind === 'hero') {
      const file = CHAR_FILE[info.anim] || 'mantis';
      return '<span class="foe-portrait"><img alt="" src="images/ui/characters/' + file + '-classic-card.png"></span>';
    }
    return '<span class="foe-portrait"><canvas width="' + AVATAR_SIZE + '" height="' + AVATAR_SIZE +
      '" data-foe-art="' + index + '" aria-hidden="true"></canvas></span>';
  }
  /* 经典塔松鼠 boss：直接复用随机挑战右栏 7232（frame1）和同一套装备挂点。
   * 装备数据可以是 tower-data 的 `gear` key（如 fist3，由 wearsOf() 展开），
   * 也可以是现成数组（巡逻魔王的 `classicGear` = 黑狂战 181~184）。 */
  let classicGearTables = null;
  const CLASSIC_FACE_PARTS = [
    { type: 0, cells: [['mc_head', 0]] },
    { type: 1, cells: [['mc_fistL', 0], ['mc_fistR', 1]] },
    { type: 2, cells: [['mc_body', 0], ['mc_handL', 1], ['mc_handR', 1]] },
    { type: 3, cells: [['mc_footL', 0], ['mc_footR', 0]] },
  ];
  async function loadClassicGear() {
    if (classicGearTables) return classicGearTables;
    try { await SfRender.loadExtra('tags-challenge.json'); } catch (e) {}
    try { await SfRender.loadExtra('tags-gear.json'); } catch (e) {}
    const B = 'images/ssfight/ui/';
    const j = (f) => fetch(B + f, { cache: 'force-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [frames, slots] = await Promise.all([j('gear-frames.json'), j('gear-slots.json')]);
    if (!frames || !slots) return null;
    const cont = {};
    for (const c of slots.container || []) cont[c.type] = c.ids;
    classicGearTables = { frameById: new Map((frames.gear || []).map((g) => [Number(g.id), g.frame])), cont: cont };
    return classicGearTables;
  }
  function classicGearType(g) {
    const ty = Number(g && g.type);
    if (Number.isFinite(ty) && ty >= 0 && ty <= 3) return ty;
    try {
      if (window.State && State.gearPart) {
        const t2 = Number(State.gearPart(Number(g && g.id)));
        if (Number.isFinite(t2) && t2 >= 0 && t2 <= 3) return t2;
      }
    } catch (e) {}
    return NaN;
  }
  function classicGearFrame(g) {
    if (!classicGearTables || !g) return 0;
    const base = classicGearTables.frameById.get(Number(g.id));
    if (!base) return 0;
    /* 与随机挑战 showFace 完全同一口径。 */
    return base + Math.max(0, (Number(g.ext) || 0) - 1);
  }
  function attachClassicGear(bg, info) {
    if (!bg || !classicGearTables || !info) return 0;
    const gearList = Array.isArray(info.gear)
      ? info.gear
      : (typeof info.gear === 'string' && window.TowerData && TowerData.wearsOf ? TowerData.wearsOf(info.gear) : []);
    if (!gearList.length) return 0;
    const byType = new Map();
    for (const raw of gearList) {
      const g = (raw && typeof raw === 'object') ? raw : { id: Number(raw) };
      const ty = classicGearType(g);
      if (Number.isFinite(ty) && !byType.has(ty)) byType.set(ty, g);
    }
    let n = 0;
    for (const row of CLASSIC_FACE_PARTS) {
      const g = byType.get(row.type);
      const frame = g ? classicGearFrame(g) : 0;
      for (const pair of row.cells) {
        const clip = bg.byName ? bg.byName(pair[0]) : null;
        if (!clip || !clip.detachAll) continue;
        clip.detachAll();
        if (!frame) continue;
        const sym = classicGearTables.cont[row.type] && classicGearTables.cont[row.type][pair[1]];
        if (sym && clip.attachChild(sym, frame, 'wear')) n++;
      }
    }
    return n;
  }
  async function fillClassicFoeArt(root, preview) {
    const hosts = root.querySelectorAll('[data-classic-foe]');
    if (!hosts.length) return;
    await loadClassicGear();
    for (const host of hosts) {
      const info = preview[Number(host.dataset.classicFoe)];
      if (!info || !host.isConnected) continue;
      try {
        const v = await SfRender.mountSymbol(host, '7232', { frame: 1, label: '经典对手' });
        if (!host.isConnected) { try { v.destroy(); } catch (e) {} continue; }
        SfUiMain.toolkit.freezeDescendants(v);
        v.playing = false;
        attachClassicGear(v, info);
        /* 只保留松鼠本体：头/身体/手脚/尾巴（ikNode_9）+ 装备挂点的祖先链；
         * 7232 的奶油底框、影子、花饰、属性条全部隐藏。 */
        if (info && info.gear) {
          /* 装备版（黑色/紫色狂战套等）不能只留挂点祖先：7232 的填充/阴影分布在其它根层，
           * 全隐藏会让铠甲缺一块填色。这里只隐藏奶油底框。 */
          for (const child of Array.from(v.g.children || [])) {
            if (!child.querySelector) continue;
            /* 只隐藏奶油底框 / 地面影子 / 花饰；它们是非松鼠元件，
             * 不能整层清空，否则紫色狂战的填色层会一起没掉。 */
            if (child.querySelector('path[d^="M10.35,-52.85"]') ||
                child.querySelector('path[d^="M-0.15,-9Q"]') ||
                child.querySelector('path[d^="M-48.65,-50.85"]')) {
              child.style.display = 'none';
            }
          }
        } else {
          const parts = ['mc_head', 'mc_body', 'mc_fistL', 'mc_fistR', 'mc_handL', 'mc_handR', 'mc_footL', 'mc_footR', 'ikNode_9'];
          const keepRoots = new Set();
          for (const name of parts) {
            const c = v.byName(name);
            if (!c || !c.g) continue;
            let node = c.g;
            while (node && node.parentNode && node.parentNode !== v.g) node = node.parentNode;
            if (node && node.parentNode === v.g) keepRoots.add(node);
          }
          for (const child of Array.from(v.g.children || [])) {
            if (String(child.tagName || '').toLowerCase() === 'defs') continue;
            if (!keepRoots.has(child)) child.style.display = 'none';
          }
        }
        /* 7232 里除了人物，还带战力图标、属性条、背景板等根级元件；只把人物挂点
         * 的祖先链留下来，其余根级子元素全部隐藏，否则它们会从裁切框下方露出来。 */
        for (const f of ['power', 'agility', 'speed', 'hp', 'num1', 'num2', 'num3', 'num4', 'num5']) {
          const c = v.byName(f); if (c && c.g) c.g.style.display = 'none';
        }
        for (const t of v.g.querySelectorAll('text')) { try { t.style.display = 'none'; } catch (e) {} }
        const svg = host.querySelector('svg');
        if (svg) {
          /* 人物坐标不是 getBBox() 的局部坐标（父级还有变换）；用屏幕矩形反算到 SVG
           * 用户坐标，再取一个**正方形**裁切框并居中，卡片里人物才会居中。
           * ⚠ 不用 getScreenCTM：iOS 15 会漏掉祖先 CSS transform 的 scale（WebKit 209220），
           * 卡片会被裁到偏位/过小。 */
          let bb = null;
          try {
            const sr = svg.getBoundingClientRect();
            const vb = svg.viewBox && svg.viewBox.baseVal;
            if (!sr || !vb || !sr.width || !sr.height || !vb.width || !vb.height) throw new Error('no rect');
            const par = String(svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
            const scale = /slice/.test(par) ? Math.max(sr.width / vb.width, sr.height / vb.height)
              : Math.min(sr.width / vb.width, sr.height / vb.height);
            const ax = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5;
            const ay = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
            const x0 = sr.left + (sr.width - vb.width * scale) * ax - vb.x * scale;
            const y0 = sr.top + (sr.height - vb.height * scale) * ay - vb.y * scale;
            const toUser = (sx, sy) => ({ x: (sx - x0) / scale, y: (sy - y0) / scale });
            /* 只量隐藏完非松鼠元件后的直接根层（人物 + 尾巴 + 装备）；
             * 整棵 v.g 的 bbox 会带舞台空白，不能拿来裁切。 */
            let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, n = 0;
            for (const child of Array.from(v.g.children || [])) {
              if (String(child.tagName || '').toLowerCase() !== 'g') continue;
              if (child.style && child.style.display === 'none') continue;
              const rr = child.getBoundingClientRect();
              if (!rr.width || !rr.height) continue;
              const a = toUser(rr.left, rr.top);
              const z = toUser(rr.right, rr.bottom);
              x1 = Math.min(x1, a.x, z.x); y1 = Math.min(y1, a.y, z.y);
              x2 = Math.max(x2, a.x, z.x); y2 = Math.max(y2, a.y, z.y);
              n++;
            }
            if (n) {
              const pad = 7;
              const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
              const side = Math.max(x2 - x1, y2 - y1) * 1.08 + pad * 2;
              bb = { x: cx - side / 2, y: cy - side / 2, width: side, height: side };
            }
          } catch (e) { bb = null; }
          if (!bb || !bb.width || !bb.height) bb = { x: -35, y: -60, width: 90, height: 90 };
          svg.setAttribute('viewBox', bb.x + ' ' + bb.y + ' ' + bb.width + ' ' + bb.height);
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          svg.style.width = '100%'; svg.style.height = '100%';
        }
        host.classList.add('ready');
      } catch (e) {
        if (window.__errs) window.__errs.push('classic foe art: ' + (e && e.message));
      }
    }
  }
  /** 经典塔里原版征战动物 boss 的小立绘：6833 按 mcFrame 拨到动物形态，裁成头像尺寸。
   *  ⚠ 与 `fillClassicFoeArt` 同一套套路（挂载 → 冻结 → 只留角色根层 → 用屏幕矩形反算
   *  viewBox 居中），区别只是元件是 6833、要保留的角色是它里面的 `playerMc` 动物模型。 */
  async function fillClassicCampaignArt(root, preview) {
    const hosts = root.querySelectorAll('[data-campaign-foe]');
    if (!hosts.length) return;
    try {
      await SfRender.loadExtra('tags-fight.json');
      await SfRender.loadExtra('tags-campaign-boss.json');
    } catch (e) {
      if (window.__errs) window.__errs.push('classic campaign art load: ' + (e && e.message));
      return;
    }
    for (const host of hosts) {
      const info = preview[Number(host.dataset.campaignFoe)];
      if (!info || !host.isConnected) continue;
      try {
        const v = await SfRender.mountSymbol(host, '6833', {
          frame: Math.max(1, Math.min(7, Number(info.mcFrame) || 1)), label: '征战首领',
        });
        if (!host.isConnected) { try { v.destroy(); } catch (e) {} continue; }
        SfUiMain.toolkit.freezeDescendants(v);
        v.playing = false;
        const model = v.byName('playerMc');
        /* 只保留动物模型所在的根级子树；6833 的其它层级是给战斗帧用的空白/辅助件。 */
        const keep = new Set();
        if (model && model.g) {
          let node = model.g;
          while (node && node.parentNode && node.parentNode !== v.g) node = node.parentNode;
          if (node && node.parentNode === v.g) keep.add(node);
        }
        for (const child of Array.from(v.g.children || [])) {
          if (String(child.tagName || '').toLowerCase() === 'defs') continue;
          if (keep.size && !keep.has(child)) child.style.display = 'none';
        }
        const svg = host.querySelector('svg');
        if (svg) {
          /* 同 `fillClassicFoeArt`：人物坐标要按屏幕矩形反算到 SVG 用户坐标，
           * 不能直接信 `getBBox()`（父级还有变换）。这里取模型自己的方形包围盒。 */
          let bb = null;
          try {
            const sr = svg.getBoundingClientRect();
            const vb = svg.viewBox && svg.viewBox.baseVal;
            if (!sr || !vb || !sr.width || !sr.height || !vb.width || !vb.height) throw new Error('no rect');
            const par = String(svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
            const scale = /slice/.test(par) ? Math.max(sr.width / vb.width, sr.height / vb.height)
              : Math.min(sr.width / vb.width, sr.height / vb.height);
            const ax = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5;
            const ay = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
            const x0 = sr.left + (sr.width - vb.width * scale) * ax - vb.x * scale;
            const y0 = sr.top + (sr.height - vb.height * scale) * ay - vb.y * scale;
            const toUser = (sx, sy) => ({ x: (sx - x0) / scale, y: (sy - y0) / scale });
            let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, n = 0;
            for (const child of Array.from(v.g.children || [])) {
              if (String(child.tagName || '').toLowerCase() !== 'g') continue;
              if (child.style && child.style.display === 'none') continue;
              const rr = child.getBoundingClientRect();
              if (!rr.width || !rr.height) continue;
              const a = toUser(rr.left, rr.top);
              const z = toUser(rr.right, rr.bottom);
              x1 = Math.min(x1, a.x, z.x); y1 = Math.min(y1, a.y, z.y);
              x2 = Math.max(x2, a.x, z.x); y2 = Math.max(y2, a.y, z.y);
              n++;
            }
            if (n) {
              const pad = 7;
              const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
              const side = Math.max(x2 - x1, y2 - y1) * 1.08 + pad * 2;
              bb = { x: cx - side / 2, y: cy - side / 2, width: side, height: side };
            }
          } catch (e) { bb = null; }
          if (!bb || !bb.width || !bb.height) bb = { x: -35, y: -60, width: 90, height: 90 };
          svg.setAttribute('viewBox', bb.x + ' ' + bb.y + ' ' + bb.width + ' ' + bb.height);
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          svg.style.width = '100%'; svg.style.height = '100%';
        }
        host.classList.add('ready');
      } catch (e) {
        if (window.__errs) window.__errs.push('classic campaign art: ' + (e && e.message));
      }
    }
  }
  function fallbackPortrait(canvas, info) {
    const kind = info && info.kind;
    const file = CHAR_FILE[info && info.anim];
    let src = null;
    if (kind === 'hero') src = file ? 'images/ui/characters/' + file + '-classic-card.png' : null;
    else if (kind === 'npc') src = null;
    else src = 'images/ui/characters/squirrel-classic.png';
    if (!src) { canvas.remove(); return; }
    const img = document.createElement('img');
    img.alt = ''; img.src = src;
    canvas.replaceWith(img);
  }
  /** 把松鼠 boss 的「待机帧 + 装备」画进小 canvas（素材缺失时静默留空）。 */
  async function drawFoeArt(canvas, info) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !window.Engine) return;
    // 松鼠形态的 boss 连装备一起画；机制 NPC 用它们自己的待机帧（立绘卡和三侠重了）。
    const npc = info.kind === 'npc';
    // 注意要过一遍 Engine.wearsFor：tower-data 给的是装备 id（{id:201}），
    // 引擎画图层时用的是 {src,label}（和战斗里 foe.wears 一样），少了这一步装备不会画出来。
    // 「巡逻」魔王在现代预告里仍优先用 info.outfit（橘色 113 的 {src,label} 图层）；
    // 经典预告不会走到这里 —— 它走 7232 + gear 181~184 的黑色狂战套（见 foePortraitHtml）。
    const wears = npc ? null
      : info.outfit ? Engine.wearsFor(info.outfit)
        : Engine.wearsFor(TowerData.wearsOf(info.gear));
    const sheets = npc ? (NPC_SHEETS[info.anim] || null) : SQ_SHEETS;
    const animName = npc ? (NPC_IDLE[info.anim] || 'tl_rest') : 'standby';
    const srcs = (sheets || []).concat((wears || []).map((w) => w && w.src).filter(Boolean));
    try {
      await Engine.loadSheets(srcs);
      const p = Engine.makePlayer();
      const inst = Engine.playAnim(p, animName, { fps: 20, loop: true, sheets: sheets, wears: wears, holdLast: true });
      if (!inst || !inst.frames.length) { fallbackPortrait(canvas, info); return; }
      const box = Engine.frameBounds(inst.frames[0], { sheets: sheets, wears: wears }) || { x: 0, y: 0, w: 1, h: 1 };
      const size = canvas.width, pad = 4;
      // 待机帧连武器/尾巴一起算包围盒，等比塞进方框后居中；再放大一档，
      // 让松鼠头像的视觉大小和三侠立绘卡接近（不裁切，靠 padding 控制）。
      const s = Math.min((size - pad * 2) / Math.max(1, box.w), (size - pad * 2) / Math.max(1, box.h)) * 1.04;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.setTransform(s, 0, 0, s, size / 2 - (box.x + box.w / 2) * s, size / 2 - (box.y + box.h / 2) * s);
      Engine.drawPlayer(ctx, p);
      canvas.dataset.drawn = '1';
    } catch (e) { /* 素材没到位时留空，不影响列表 */ }
  }
  /** 预告里所有需要 canvas 的对手头像一起画（异步，画完就算）。 */
  function fillFoeArt(root, preview) {
    const list = [];
    root.querySelectorAll('[data-foe-art]').forEach((c) => {
      const info = preview[Number(c.dataset.foeArt)];
      if (info && c.getContext) list.push(drawFoeArt(c, info));
    });
    return Promise.all(list);
  }
  /* 三侠大招留削弱的具体数值由 `heroDebuffPreviewHtml` 的 chips 悬停气泡给出
   *（原来这里还有一个 `heroDebuffTips()`，只服务挑战塔开局页那串规则介绍的悬停 ——
   * 规则介绍按 2026-10 用户口径整段删掉后它就没有调用点了，一并删掉）。 */
  /* ============================================================
   * 【U4】增益面板与货币条 —— buffPanelsHtml / currencyHtml
   * ============================================================ */
  function buffTag(b, stacks) {
    /* 【2026-10 第七十三批】铭文附魔的外框（用户口径）：
     *   · 虚空铭文（C37，`slotFree`）→ **青色**外框（原有）；
     *   · 水晶铭文（C60，`enchMul > 1`）→ **红色**外框；
     *   · 两条同时附魔 → **一半红一半蓝**（`.ench-both`，用 ::before 画双色环）。
     * 数据来自 buff 报告行（tower.js 的 debugBuffReport 逐条带出 `enchMul` / `slotFree`）。 */
    const mul = Number(b && b.enchMul) || 1;
    const free = !!(b && b.slotFree === true);
    const crys = mul > 1;
    const marks = [];
    if (free) marks.push('虚空铭文 · 不占位');
    if (crys) marks.push('水晶铭文 · 效果 ×' + mul);
    const tip = String(b.desc || '') + (marks.length ? '（' + marks.join('　') + '）' : '');
    return '<span class="buff-tag r' + b.rarity + enchCls(b) + '" title="' + esc(tip) + '">' + esc(b.name) +
      '<i>' + SCOPE[b.kind] + '</i>' + (stacks > 1 ? '<em>×' + stacks + '</em>' : '') + '</span>';
  }
  /** 铭文附魔的**类名出口**（画 .buff-tag 的地方都必须走这里）：
   *    虚空铭文（C37，不占位）→ `.slot-free`（青框）；水晶铭文（C60，×1.5）→ `.ench-crystal`（红框）；
   *    两个都吃 → `.ench-both`（一半红一半蓝）。
   *  ⚠ 教训：无尽塔**主面板**（`buffPanelsHtml`，玩家一直盯着的那块「永久增益 / 限次增益」）
   *  原来是**自己拼 class**、只认 `slot-free`，所以水晶的红框在它上面根本不存在 ——
   *  第七十三批只在「本局构筑」和商店列表两处生效，用户实测「看不到效果」就是这个。
   *  现在所有渲染器共用这一个出口，新增一种附魔不会再漏掉某一块面板。 */
  function enchCls(b) {
    const free = !!(b && b.slotFree === true);
    const crys = (Number(b && b.enchMul) || 1) > 1;
    return (free && crys) ? ' ench-both' : (crys ? ' ench-crystal' : (free ? ' slot-free' : ''));
  }
  function ownedBuffsHtml(mode) {
    const list = Tower.ownedBuffs(mode);
    if (!list.length) return '';
    return '<div class="tower-buffs"><h4>本局构筑</h4><div class="buff-tags">' +
      list.map((b) => buffTag(b, b.stacks)).join('') + '</div></div>';
  }
  function permTip(b, mirrorSnapshot) {
    const buff = TowerData.BUFF_BY_ID[b.id];
    if (!buff) return b.name;
    const parts = [buff.name + '（' + RARITY[b.rarity] + ' · 永久）', buff.desc];
    if (b.id === TowerData.MIRROR.id && mirrorSnapshot && mirrorSnapshot.source) {
      const s = mirrorSnapshot.source;
      parts.push('已封存至第 ' + mirrorSnapshot.absorbedThrough + ' 层的首回合属性');
      parts.push('攻击 ' + Math.round(s.power) + ' · 敏捷 ' + Math.round(s.agility) + ' · 速度 ' + Math.round(s.speed));
      parts.push('生命上限 ' + Math.round(s.maxHp) + '（封存时数值；后续装备变化仍生效）');
      const c = mirrorSnapshot.combat || {};
      const pct = (n) => String(Math.round(n * 10000) / 100) + '%';
      const combat = [];
      if (c.critBonus) combat.push('暴击 +' + c.critBonus + '%');
      if (c.critDmgBonus) combat.push('暴伤 +' + c.critDmgBonus + '%');
      if (c.dodgeBonus) combat.push('闪避 +' + c.dodgeBonus + '%');
      if (c.dodgeMul) combat.push('闪避倍率加成 ' + pct(c.dodgeMul));
      if (c.takenMul) combat.push('受伤修正 ' + pct(c.takenMul));
      if (c.lifestealPct) combat.push('吸血 ' + pct(c.lifestealPct));
      if (c.regenPct) combat.push('每回合回复 ' + pct(c.regenPct));
      if (c.shellPct) combat.push('开战护盾 ' + pct(c.shellPct));
      if (c.thornsPct) combat.push('反伤 ' + pct(c.thornsPct));
      if (c.dmgMul) combat.push('伤害 ×' + c.dmgMul);
      if (c.healMul) combat.push('治疗 ×' + c.healMul);
      if (c.reflectImmune) combat.push('反伤免疫');
      if (c.mustHitAll) combat.push('攻击必中');
      if (combat.length) parts.push('封存战斗加成：' + combat.join(' · '));
      parts.push('不占永久位；旧增益的成长、限次及经济效果不再触发');
    }
    parts.push(b.id === TowerData.MIRROR.id ? '镜界印记：×' + b.stacks
      : '当前叠层：×' + b.stacks + (b.stacks > 1 ? '（按层数累加）' : ''));
    /* 【第七十四批】本条被铭文附魔时要**写清楚**（否则悬停看到的还是没附魔的数字，
     * 玩家会以为「附了没效果」）：水晶这一条把下面所有**效果量**乘一次，
     * 与 tower.js 实际结算用的 `k = 层数 × 全局倍率 × row.enchMul` 同一口径；
     * 而 `lowHpAt` / `lowHpRegenAt` 是**阈值**（结算里取 max、不乘 k），所以不乘。 */
    const mul = Number(b.enchMul) || 1;
    const raw = buff.mods || {};
    const RAW_KEYS = ['lowHpAt', 'lowHpRegenAt'];
    const m = (mul === 1) ? raw : Object.keys(raw).reduce((o, k) => {
      const v = raw[k];
      o[k] = (typeof v === 'number' && RAW_KEYS.indexOf(k) < 0) ? v * mul : v;
      return o;
    }, {});
    if (b.slotFree === true) parts.push('铭文附魔：虚空铭文 · 不占位');
    if (mul > 1) parts.push('铭文附魔：水晶铭文 · 这一条本局效果 ×' + mul + '（下列合计已含）');
    if (m.powerMul) parts.push('攻击合计 +' + Math.round(m.powerMul * b.stacks * 100) + '%');
    if (m.maxHpMul) parts.push('生命上限合计 ' + (m.maxHpMul * b.stacks >= 0 ? '+' : '') + Math.round(m.maxHpMul * b.stacks * 100) + '%');
    if (m.critBonus) parts.push('暴击合计 +' + (m.critBonus * b.stacks) + '%');
    if (m.dodgeBonus) parts.push('闪避合计 +' + (m.dodgeBonus * b.stacks) + '%');
    if (m.lifestealPct) parts.push('吸血合计 ' + Math.round(m.lifestealPct * b.stacks * 100) + '%');
    if (m.thornsPct) parts.push('反伤合计 ' + Math.round(m.thornsPct * b.stacks * 100) + '%');
    if (m.speedMul) parts.push('速度合计 +' + Math.round(m.speedMul * b.stacks * 100) + '%');
    /* 战斗续航（C16/C17）：效果在**每场战斗的第一回合**结算（adjustMe 的 startHealPct），
     * 不是一个「战斗外累计」的数值，所以文案按「开战回血」写。 */
    if (m.startHealPct) parts.push('每场战斗开始回血合计 ' + Math.round(m.startHealPct * b.stacks * 100) + '%');
    if (m.killPowerPct) parts.push('每击杀攻击 +' + Math.round(m.killPowerPct * b.stacks * 100) + '%');
    /* 原来这里还有一条 `m.killMaxHpPct` —— 那个 mod 在任何增益上都不存在（死代码），
     * 换成真正在用的「每胜利生命上限」字段（C07 吞噬成长）。 */
    /* 狂怒：低血时攻/敏/速同时生效（阈值 + 三项一起写清楚）。
     * 敏捷/速度这两份是**终乘**（乘在最终值上，不并进敏捷/速度面板），所以这里按 ×N 写，
     * 免得玩家以为只是「面板 +20%」。 */
    if (m.lowHpPowerMul || m.lowHpAgilityMul || m.lowHpSpeedMul) {
      const low = '生命低于 ' + Math.round((m.lowHpAt || 0.5) * 100) + '% 时';
      const bits = [];
      if (m.lowHpPowerMul) bits.push('攻击 +' + Math.round(m.lowHpPowerMul * b.stacks * 100) + '%');
      if (m.lowHpAgilityMul) bits.push('最终敏捷 ×' + (1 + m.lowHpAgilityMul * b.stacks).toFixed(2));
      if (m.lowHpSpeedMul) bits.push('最终速度 ×' + (1 + m.lowHpSpeedMul * b.stacks).toFixed(2));
      parts.push(low + bits.join('、'));
    }
    if (m.winMaxHpPct) parts.push('每胜利生命上限 +' + Math.round(m.winMaxHpPct * b.stacks * 100) + '%');
    if (m.winMaxHpFlat) parts.push('每胜利生命上限 +' + Math.round(m.winMaxHpFlat * b.stacks));
    if (m.winStatAfter10) parts.push('第 10 层起每胜利 力/敏/速 各 +' + (m.winStatAfter10 * b.stacks));
    if (m.revivePct) {
      parts.push('复活回血 ' + Math.round(m.revivePct * 100) + '%' +
        (m.reviveStatMul ? '，复活后本场力/敏/速 +' + Math.round(m.reviveStatMul * 100) + '%' : ''));
      /* 涅槃可叠 2 层：本层复活机会 = 层数（第 2 层不改属性加成，只多一次机会）。 */
      parts.push('本层复活机会：' + Math.max(1, Math.floor(Number(b.stacks) || 1)) + ' 次');
    }
    if (m.globalMul) parts.push('全局增幅 ×' + m.globalMul + (b.stacks > 1 ? '，可叠 ' + b.stacks + ' 层' : ''));
    if (m.powerPerEmptySlot) parts.push('每个空的永久增益位 攻击 +' + Math.round(m.powerPerEmptySlot * 100) + '%');
    if (m.powerPerPermBuff) parts.push('每拥有 1 个永久增益 攻击 +' + Math.round(m.powerPerPermBuff * 100) + '%');
    if (m.shopSpendStep) parts.push('每消费 ' + m.shopSpendStep + ' 试炼币 → 随机获得 力+' + (m.shopSpendStat || 1) +
      ' / 敏+' + (m.shopSpendStat || 1) + ' / 速+' + (m.shopSpendStat || 1) + ' / 生命上限+' + (m.shopSpendHp || 5) + ' 其中一项');
    if (m.firstHitZero) parts.push('每场战斗敌方对我方的第一次攻击伤害归零');
    /* —— 本轮新增 6 个 —— */
    if (m.roundStatPct) parts.push('战斗中每回合开始 力/敏/速 各 +' +
      (Math.round(m.roundStatPct * b.stacks * 1000) / 10) + '%' + (b.stacks > 1 ? '（可叠 ' + b.stacks + ' 层）' : '') +
      '；每场战斗结束时清零');
    if (m.catchUpPct) parts.push('战斗中每回合把「落后对手最多」的那一项补上差距的 ' + Math.round(m.catchUpPct * 100) +
      '%，并让对手那一项减少同样的数值；每场战斗结束时清零');
    if (m.firstDodge) parts.push('每场战斗中第一次被攻击时必定闪避');
    if (m.roundMaxHpMul) parts.push('战斗中每回合双方生命上限 ×' + Math.round(m.roundMaxHpMul * 100) + '%（向下取整）；每场战斗结束时清零');
    if (m.shopSpendLimited) parts.push('每在试炼商店消费 ' + m.shopSpendLimited + ' 试炼币 → 立即获得 1 个随机限次增益');
    if (m.rerollTiltMul) parts.push('本局商店刷新的稀有度提升速度 ×' + m.rerollTiltMul +
      '（每花 10 试炼币带来的提升翻倍）');
    if (m.shopEnterCoins) parts.push('每进入一次试炼商店 +' + m.shopEnterCoins + ' 试炼币' +
      (b.stacks > 1 ? '（可叠 ' + b.stacks + ' 层）' : ''));
    if (m.mustHitAll) parts.push('这一场所有攻击必中');
    if (m.mustHitFirst) parts.push('首次攻击必中');
    if (m.pickPermanentFree) parts.push('可给一个已有的永久增益附魔免占位（铭文）');
    if (m.pickPermanentMul) parts.push('可给一个已有的永久增益附魔：这一条效果 ×' + Number(m.pickPermanentMul) + '（铭文）');
    if (m.pickBrandBreak) parts.push('可从已有的烙印里选一个，让它立刻全部破碎（铭文）');
    if (m.pickLimitedUses) parts.push('可从已有的限次增益里选一个（烙印除外），剩余场次 +' + Number(m.pickLimitedUses) + '（铭文）');
    if (m.breakAllBrands) parts.push('立即使持有的所有烙印破碎');
    if (m.brandGate != null) parts.push('只在未破碎的烙印超过 ' + Number(m.brandGate) + ' 份时才会上架');
    if (m.fragileStat) parts.push('本局永久保留：' + ({ power: '力量', agility: '敏捷', speed: '速度' }[m.fragileStat] || m.fragileStat) +
      ' +' + Math.round((m.fragilePct || 0) * 100) + '%；每场 ' + (m.fragileBreakPct || 5) + '% 损毁');
    if (b.progress) parts.push('当前进度：' + b.progress);
    if (buff.mods && buff.mods.shopDiscount) parts.push('下个商店 ' + Math.round((1 - buff.mods.shopDiscount) * 100) / 10 + ' 折');
    if (buff.mods && buff.mods.postBattleShop) parts.push('下一场战斗后开一次商店');
    parts.push(TowerData.hasTag(buff, 'story') ? '剧情藏品，不可替换、出售或献祭'
      : replaceTarget === rowRef(b) ? '（当前已选为要拿掉的那个，点一下取消）' : '点一下选它作为要拿掉的那个永久增益');
    return parts.join('\n');
  }
  /** 限次增益的悬停说明：效果 + 剩余场次 + 当前开关状态。 */
  function limitTip(b) {
    const buff = TowerData.BUFF_BY_ID[b.id];
    if (!buff) return b.name;
    const fragile = buff.mods && buff.mods.fragileBreakPct;
    if (fragile) {
      return [buff.name + '（' + RARITY[buff.rarity] + ' · 易碎）', buff.desc,
        '当前未破碎叠层：×' + (b.stacks || 1) +
          ((b.stacks || 1) > 1 ? '（每层独立计时，各自有 ' + fragile + '% 概率损毁）' : '（1 层，' + fragile + '% 概率损毁）'),
        '每打完一场有 ' + fragile + '% 概率损毁；损毁后加成仍然保留',
        b.on ? '当前生效中 · 点一下可以关掉' : '当前已关闭 · 点一下重新开启'].join('\n');
    }
    /* **只有挑战塔专属**的限次增益才「只服务下一场战斗」，卡面与悬停都不显示「N 场」。
     * 注意判据是 towerOnly 而不是 nextBattle —— 后者只是「下一场战斗生命周期」，
     * 无尽塔里的 N13 血之契约 / N14 铁血护盾同样带它，但它们是 **10 次限次**，
     * 必须照常显示总次数与当前剩余次数（否则玩家只看到「下一场」，
     * 完全看不出它其实还能用 10 场）。 */
    if (isTowerNext(buff, 'endless')) {
      return [buff.name + '（' + RARITY[buff.rarity] + ' · 挑战塔 · 下一场战斗）', buff.desc,
        '打完这一场就消失（挑战塔的增益只服务下一场）',
        b.on ? '当前生效中 · 点一下可以关掉' : '当前已关闭 · 点一下重新开启'].join('\n');
    }
    return [buff.name + '（' + RARITY[buff.rarity] + ' · 限次 ' + (buff.uses || 1) + ' 场）',
      TowerData.descOf(buff, 'endless'),
      '剩余 ' + b.uses + ' 场（每打完一场扣 1，扣完自动消失）',
      b.on ? '当前生效中 · 点一下可以关掉（关掉不扣次数）' : '当前已关闭 · 点一下重新开启'].join('\n');
  }
  function limitBadgeText(b) {
    const def = TowerData.BUFF_BY_ID[b.id] || {};
    const stackTag = b.stacks > 1 ? '×' + b.stacks + ' 层 · ' : '';
    if (isTowerNext(def, 'endless')) return stackTag + '下一场';
    if (def.mods && def.mods.fragileBreakPct) return stackTag + '易碎 ' + def.mods.fragileBreakPct + '%';
    if (TowerData.hasTag(def, 'nextBattle')) return stackTag + '无尽塔 · 剩 ' + b.uses + ' 场';   // 无尽塔的限次类（含 C57）
    return stackTag + '剩 ' + b.uses + ' 场';
  }
  function buffPanelsHtml(mode) {
    const run = mode === 'tower' ? Tower.towerInfo().run : Tower.endlessInfo().run;
    if (!run || mode !== 'endless') return '';
    const list = Tower.ownedBuffs('endless');
    /* 【2026-10 同名逐条】按每条自己的 `slotFree` 排 / 标记；`data-replace` 用 uid。 */
    const perm = orderPermanent(list.filter((b) => b.kind === 'permanent'));
    const lim = list.filter((b) => b.kind === 'limited');
    const cap = Number(run.permCap) || ((TowerData.PERMANENT_SLOTS || 5) + Math.max(0, Number(run.permSlots || 0)));   // 槽位上限含扩容类加成
    const permHtml = perm.length
      ? perm.map((b, i) => {
          const free = b.slotFree === true;
          const em = enchMark(b);
          const tip = permTip(b, run.mirrorSnapshot);
          const canReplace = !TowerData.hasTag(TowerData.BUFF_BY_ID[b.id], 'story');
          const nextFree = i + 1 < perm.length && perm[i + 1].slotFree === true;
          const divider = (free && !nextFree) ? '<span class="buff-sep" aria-hidden="true"></span>' : '';
          /* `enchCls(b)` 是附魔外框的**唯一出口**（虚空=青框 / 水晶=红框 / 两个都吃=半红半青）。
           * 这里原来是手拼的、只认 slot-free —— 水晶的红框在主面板上完全不存在。 */
          return '<span class="buff-tag r' + b.rarity + (rowRef(b) === replaceTarget ? ' replacing' : '') +
            enchCls(b) + '"' + (canReplace ? ' data-replace="' + esc(rowRef(b)) + '"' : '') +
            ' data-tip="' + esc(tip) + '" title="' + esc(tip) + '">' +
            esc(b.name) + '<i>' + (free ? '不占位' : '永久') + (em.crys ? ' · ×' + em.mul : '') + '</i>' +
            (b.stacks > 1 ? '<em>×' + b.stacks + '</em>' : '') + '</span>' + divider;
        }).join('')
      : '<span class="buff-empty">还没有永久增益（每层的休整点可以拿）</span>';
    const progList = perm.filter((b) => b.progress);
    const progHtml = progList.length
      ? '<div class="buff-progress-list">' + progList.map((b) =>
          '<span class="buff-progress-item"><b>' + esc(b.name) + '</b>' + esc(b.progress) + '</span>').join('') + '</div>'
      : '';
    const limHtml = lim.length
      ? lim.map((b) => '<button type="button" class="limit-tag r' + b.rarity + (b.on ? '' : ' off') + '" data-toggle="' + esc(rowRef(b)) +
          '" data-tip="' + esc(limitTip(b)) + '" title="' + esc(limitTip(b)) + '">' +
          '<b>' + esc(b.name) + '</b><i>' + (b.on ? '生效中' : '已关闭') + '</i><em>' +
          limitBadgeText(b) + '</em></button>').join('')
      : '<span class="buff-empty">还没有限次增益</span>';
    /* 讨价还价（E14）：即时类不进 permanent/limited，所以在这里单独把「攒着还没兑现的份数」
     * 摆出来 —— 不然玩家看不到自己叠了几层，进店前也预期不了。 */
    const halfPending = Math.max(0, Number(run.shopHalfPending) || 0);
    const halfHtml = halfPending > 0
      ? '<div class="buff-pending"><span class="pending-chip" data-tip="' +
        esc('讨价还价 ×' + halfPending + '：下一次进入商店（试炼商店或铸币商店）时，那一页有 ' +
          halfPending + ' 件随机商品价格减半（向下取整）、不会重复打同一件') + '">讨价还价 ×' + halfPending +
        '<i>下次进店 ' + halfPending + ' 件对折</i></span></div>'
      : '';
    return '<div class="tower-buffs endless-buffs">' +
      '<h4>永久增益 <span class="buff-slot-count">' + (run.permUsed == null ? perm.length : run.permUsed) + '/' + cap + '</span>' +
      (replaceTarget ? '<span class="replace-hint">选一个要拿掉的（再点增益卡确认）</span>' : '') + '</h4>' +
      '<div class="buff-tags">' + permHtml + '</div>' + progHtml + halfHtml +
      '<h4>限次增益 <span class="buff-slot-count">点一下开关</span></h4>' +
      '<div class="buff-tags">' + limHtml + '</div></div>';
  }
  function debuffPanel(debuffs) {
    if (!debuffs || !debuffs.length) return '';
    // 每张卡带上「是哪位大侠给的」小头像 + 来源色，一眼就能对上本层的对手顺序
    return '<div class="tower-debuffs"><h4>本层已被削弱（贯穿本层）</h4><div class="debuff-cards">' +
      debuffs.map((d) => {
        const file = CHAR_FILE[d.from] || null;
        const face = file ? '<img class="debuff-face" alt="" src="images/ui/characters/' + file + '-classic-card.png">' : '';
        return '<div class="debuff-card" style="--hero-color:' + esc(d.color || '#7a4a18') + '">' + face +
          '<span class="debuff-from">' + esc(d.short || d.hero || '大侠') + '</span>' +
          '<b class="debuff-name">' + esc(d.name || '削弱') + '</b>' +
          '<span class="debuff-text">' + esc(d.text || '') + '</span></div>';
      }).join('') +
      '</div></div>';
  }
  /* ---------- 挑战塔「开打前」的两块预告（2026-10 用户口径） ----------
   * 进行中那一屏给的是「当前环境 / 本层已被削弱」（envPanelHtml / debuffPanel）；
   * 开打前这一屏原来只有规则行里的一句话，玩家看不到具体会遇到什么，所以补这两块：
   *   · 本层可能的环境：按**挑战塔口径**列池子（不带试炼币那类只对无尽塔成立的收益档）；
   *   · 三侠大招会留下：每位大侠的大招会给本层留下哪种削弱（速杀可规避）。 */
  function envPreviewHtml(nextLayer) {
    const TD = window.TowerData;
    if (!TD || !TD.envPoolFor) return '';
    const startLayer = Math.max(1, Number(TD.ENV_START_LAYER) || 5);
    if (Number(nextLayer) < startLayer) {
      return '<div class="tower-rule mech-bar env-bar"><b>本层可能的环境</b>' +
        '<span class="mech-none">第 ' + startLayer + ' 层起可能出现（每层随机、持续 4~8 场）</span></div>';
    }
    const pool = TD.envPoolFor('tower');
    const chips = pool.map((raw) => {
      /* 按挑战塔口径取名（贪婪裂隙 → 厚甲裂隙），免得名字里承诺一个那边没有的收益。 */
      const def = TD.envDefFor ? TD.envDefFor(raw, 'tower') : raw;
      const text = TD.envPreviewText ? TD.envPreviewText(raw, 'tower') : String(def.desc || '');
      const range = TD.envRangeText ? TD.envRangeText(raw, 'tower') : '';
      const tip = text + (range ? '\n数值区间：' + range : '');
      return '<span class="mech-chip env-chip env-bad" data-tip="' + esc(tip) + '" title="' + esc(tip) + '" tabindex="0">' +
        esc(def.name) + '</span>';
    }).join('');
    return '<div class="tower-rule mech-bar env-bar"><b>本层可能的环境</b>' + chips + '</div>';
  }
  function heroDebuffPreviewHtml() {
    const TD = window.TowerData;
    if (!TD || !TD.HERO_DEBUFF) return '';
    const chips = ['tl', 'xh', 'xm'].map((k) => TD.HERO_DEBUFF[k]).filter(Boolean).map((d) => {
      const file = CHAR_FILE[d.anim];
      const face = file ? '<img class="mech-chip-face" alt="" src="images/ui/characters/' + file + '-classic-card.png">' : '';
      const tip = d.hero + '「' + d.ult + '」命中后：' + d.name + '\n' + d.desc +
        '\n（只有大招真的打到才会留下；速杀 / 闪避 / 弹反可以规避）';
      return '<span class="mech-chip debuff-chip" data-tip="' + esc(tip) + '" title="' + esc(tip) + '" tabindex="0">' +
        face + esc(d.hero || '大侠') + ' · ' + esc(d.name) + '</span>';
    }).join('');
    return chips ? '<div class="tower-rule mech-bar"><b>三侠大招会留下</b>' + chips + '</div>' : '';
  }
  /* ---------- 敌人成长倍率（【D2b】，2026-10 用户口径） ----------
   * 无尽塔的敌人面板 = 属性基数（目标等级，40 层封顶 70 级）× 段位倍率（31 层封顶 ×10）
   * × 深度倍率（30 层起叠加、**永不封顶**）。
   * ⚠ 用户口径：这一档**不出现在界面上**（局内主界面与开局页都不放）——
   *   原来那个「敌人成长 ×N」刻度块（foeScaleChip）已按 2026-10 用户口径删掉；
   *   倍率的计算与口径在 js/tower-data.js 的 endlessScaleParts / 【D2b】注释里。 */
  /** 商店「这一页几件」的说明（【100 层循环】，2026-10 用户口径）：
   *  1-20 层 5 件、21-40 层 4 件、41-100 层 3 件，第 101 层起回到 5 件。
   *  件数是规则，不写出来玩家会以为是随机变少。`count` 省略时按层算。 */
  function shopTierHint(layer, count) {
    if (!window.TowerData || !TowerData.endlessShopSlots) return '';
    const n = Math.max(1, Math.floor(Number(layer) || 1));
    const have = Math.max(0, Math.floor(Number(count != null ? count : TowerData.endlessShopSlots(n)) || 0));
    const cycle = Math.max(1, Math.floor(Number(TowerData.LAYER_CYCLE) || 100));
    const c = ((n - 1) % cycle) + 1;
    const band = c <= 20 ? '1-20 层每页 5 件' : c <= 40 ? '21-40 层每页 4 件' : '41-100 层每页 3 件';
    const nextAt = c <= 20 ? 21 : c <= 40 ? 41 : null;
    const tail = '；规则每 ' + cycle + ' 层重来一轮（第 ' + (cycle + 1) + ' 层回到每页 5 件）' +
      (nextAt ? '，第 ' + nextAt + ' 层起每页 ' + (nextAt === 21 ? 4 : 3) + ' 件' : '');
    const tip = '商店每页件数按层分档：' + band + tail +
      '。\n无尽塔每 ' + cycle + ' 层重来一轮（第 ' + (cycle + 1) +
      ' 层回到与第 1 层相同的规则），但敌人的数值继续接着长。';
    return '<p class="shop-tier" data-tip="' + esc(tip) + '" title="商店每页件数按层分档" tabindex="0">' +
      '本层商店 · 每页 <b>' + have + '</b> 件（' + band + '）</p>';
  }
  function syncTickets() {
    if (window.ClassicExtras && ClassicExtras.refreshTickets) { try { ClassicExtras.refreshTickets(); } catch (e) { /* ignore */ } }
    if (window.UI && UI.refreshHeader) { try { UI.refreshHeader(); } catch (e) { /* ignore */ } }
  }
  /* 挑战塔货币条要用的道具 id（挑战书）。抽奖卷（50）不在这里 —— 无尽塔局内不再显示它，
   * 见 currencyHtml 里 'endless' 分支的说明。 */
  const CURRENCY_PROP = { book: 23 };
  function currencyHtml(mode) {
    const S = State.state();
    if (mode === 'endless') {
      const run = Tower.endlessInfo().run;
      const items = [];
      /* 试炼币：除了本局持有量，再把**上一场战斗赚到的**标在旁边（回到主界面就能看到）。
       * 悬停里写清这一场是怎么算出来的：基础（按层分段，动态）× 每个乘区（战利品 / 淘金烙印 /
       * 贪婪裂隙 / 精英倍率），并把整张分层表列出来 —— 用户口径 2026-10。 */
      if (run) {
        const gained = Math.max(0, Math.floor(Number(run.lastCoinsGained) || 0));
        const bk = run.lastCoinBreak || null;
        const CO = TowerData.COINS || {};
        const coinLine = bk
          ? ('上一场战斗获得 ' + gained + ' 枚（基础 ' + bk.base + '（' + bk.band + '）' +
             (bk.boosts || []).map((b) => ' × ' + b.name + ' +' + Math.round((Number(b.pct) || 0) * 100) + '%').join('') +
             (bk.elite ? ' × 精英 ×' + bk.eliteMul : '') + '）')
          : (gained ? ('上一场战斗获得 ' + gained + ' 枚') : '');
        const nowBase = Math.max(1, Math.floor(Number(run.coinBase) || 0));
        items.push({
          name: '试炼币',
          value: run.coins,
          delta: gained || 0,
          tip: '本局持有 ' + Math.max(0, Math.floor(Number(run.coins) || 0)) + ' 试炼币' +
            (coinLine ? ('\n' + coinLine) : '') 
        });
      }
      /* 【2026-10 用户口径】这里**不再显示「抽奖卷」**：局内右上角只留 试炼币 + 铸币，
       * 抽奖卷的账挪到玩家真的要结算的时候算 —— 见「放弃本局」弹窗（abandon 分支）
       * 与商店 / 结算点的「结算离场」。想看仓库里现有多少张，去「每日幸运抽奖」页。
       * ⚠ 别把 `endlessInfo` 的 ticketsOnExit / ticketsIfSettle 删掉：弹窗要用它们。 */
      const tokens = run ? Math.max(0, Math.floor(Number(run.retryToken) || 0)) : 0;
      /* 铸币（原名「重新挑战币」）：无尽塔主界面右上角直接标出**本场拥有多少枚**，
       * 鼠标悬停说明用途（失败时回滚本场 / 退出时 1:1 折成抽奖卷 / 商店售价）。 */
      items.push({
        name: '铸币',
        value: run ? tokens : 0,
        tip: run
          ? ('本场拥有 ' + tokens + ' 枚铸币。\n' +
             '· 战斗失败时可花费 1 枚重新挑战\n' +
             '· 退出本局时剩余的铸币按 1:1 折成抽奖卷（最多折 ' +
             Math.max(0, Math.floor(Number(TowerData.TICKET_FROM_MINT_CAP) || 0)) + ' 枚）')
          : '铸币：失败时回滚本场再打一次；退出时 1:1 折成抽奖卷'
      });
      return '<div class="tower-currency text-only">' + items.map((it) =>
        '<span class="currency-item"' + (it.tip ? ' data-tip="' + esc(it.tip) + '" title="' + esc(it.tip) + '"' : '') + '><b>' + it.value + '</b>' +
        (it.delta ? '<em class="currency-delta">+' + it.delta + '</em>' : '') +
        '<i>' + it.name + '</i></span>').join('') + '</div>';
    }
    /* 金松果：**主界面之外统一用道具页那颗"橡果+金币"**（`images/ui/icons/gold-acorn.png`，
     * 用户 2026-10 口径：把主界面之外的金松果样式换掉）。
     * 历史：这里曾错用 prop-1.png（那是小体力药剂），后改成资源图集 resource_1 第 18 帧的单颗橡果；
     * 现在再统一到道具页那颗 —— 首页（非 ssflight 的经典首页）保留 resource_1-18 不动。 */
    const items = [{ icon: 'images/ui/icons/prop/prop-23.png', name: '挑战书', value: S.props[CURRENCY_PROP.book] || 0 },
      { icon: 'images/ui/icons/gold-acorn.png', name: '金松果', value: S.goldPoint }];
    return '<div class="tower-currency">' + items.map((it) =>
      '<span class="currency-item" data-live-gold="' + (it.name === '金松果' ? '1' : '') + '">' +
      '<img alt="" src="' + it.icon + '"><b>' + it.value + '</b><i>' + it.name + '</i></span>').join('') + '</div>';
  }
  /* ============================================================
   * 无尽主界面右上角的「离场结算」一行：
   *   · 离场可得 +N 抽奖卷 —— 与「结算点·结算离场 / 失败结算」同一口径
   *     （endlessTickets(当前层)，即 Tower.endlessInfo().run.ticketsIfSettle）
   *   · 铸币 ×M —— 失败后可回滚本场再打一次（不折现，不并进上面那个数字）
   * 两个数字都从 endlessInfo().run 里取，纯函数（便于测试直接跑这一份实现）。
   * ============================================================ */
  function propName(id) {
    try { const p = propMap.getValue(id); return p ? p.name : ('道具' + id); } catch (e) { return '道具' + id; }
  }
  /* ============================================================
   * 【U5】入口图鉴与塔身可视化 —— buffCatalogHtml / towerVisual / planHtml
   * ============================================================ */
  /* 卡片/悬停用的判据：**挑战塔专属**的「下一场战斗」限次类。
   * 判据全部走标签（tower ∧ nextBattle）；无尽塔的 N13/N14 同样带 nextBattle 标签，
   * 但它们是 10 次限次，必须照常显示总次数。 */
  function isTowerNext(b, mode) {
    /* 「只服务下一场战斗」是**挑战塔**的口径（那里一场就是一层）。
     * 无尽塔里同样的条目（C57 玉石俱焚）是 10 次限次，必须照常显示「限次 10 / 剩余 N 场」。
     * mode 省略时按挑战塔处理（历史调用点都是塔内卡片）。 */
    return !!(b && (mode === undefined || mode === 'tower') &&
      TowerData.hasTag(b, 'tower') && TowerData.hasTag(b, 'nextBattle'));
  }
  function buffCatalogHtml() {
    /* 增益集锦 = **无尽塔的全增益展示**：只列带无尽塔标签的条目，挑战塔专属（tower-only）一条都不出现。
     * 【2026-10 用户口径】以前是「hidden 一律不列」，于是**虚空铭文（C37）在传奇那一栏缺席**，
     * 玩家在商店里看得到、集锦里查不到。现在口径改成：
     *   · `catalog` 标签（选取型强化 C32/C33）→ 照列；
     *   · `kind: 'inscription'`（铭文 C37/C60）→ 照列；
     *   · 其余 hidden（彩蛋/特殊获取）仍然不列。 */
    const list = TowerData.BUFFS.filter((b) => TowerData.hasTag(b, 'endless') &&
      (!TowerData.hasTag(b, 'hidden') || TowerData.hasTag(b, 'catalog') || b.kind === 'inscription'));
    const byRarity = [0, 1, 2, 3].map((r) => list.filter((b) => b.rarity === r));
    const kindName = { limited: '限次', permanent: '永久', instant: '即时', inscription: '铭文' };
    return '<div class="tower-buffs buff-catalog"><h4>增益集锦 <span class="buff-slot-count">共 ' + list.length + ' 种 · 悬停看效果</span></h4>' +
      byRarity.map((group, r) => group.length
        ? '<div class="catalog-row"><b class="catalog-rarity r' + r + '">' + (RARITY[r] || '') + '</b>' +
          '<div class="buff-tags">' + group.map((b) => '<span class="buff-tag r' + b.rarity + '" data-tip="' +
            esc(b.name + '（' + (RARITY[b.rarity] || '') + ' · ' +
              (isTowerNext(b, 'endless') ? '下一场' : (kindName[b.kind] || '')) +
              (b.kind === 'limited' ? (isTowerNext(b, 'endless') ? ' 下一场战斗' : ' ' + (b.uses || 1) + ' 场') : '') + '）\n' +
              TowerData.descOf(b, 'endless')) +
            '" title="' + esc(TowerData.descOf(b, 'endless')) + '">' + esc(b.name) + '<i>' + (kindName[b.kind] || '') + '</i></span>').join('') +
          '</div></div>' : '').join('') + '</div>';
  }
  /** BOSS 卡的头像：用独立的 data-boss-art，渲染完由 paintBossCatalog 逐张作画（不会和同页其它画布串号）。 */
  function bossPortraitHtml(index, info) {
    return '<span class="foe-portrait"><canvas width="' + AVATAR_SIZE + '" height="' + AVATAR_SIZE +
      '" data-boss-art="' + index + '" aria-hidden="true"></canvas></span>';
  }
  /** 进塔页渲染完成后：按池子下标逐张把 boss 立绘画进画布（canvas 是空的就退回立绘卡）。 */
  function paintBossCatalog(root) {
    const pool = Tower.bossPool ? Tower.bossPool() : [];
    const nodes = Array.prototype.slice.call(root.querySelectorAll('[data-boss-art]'));
    if (!nodes.length) return;
    /* 进塔页往往在任何战斗之前打开：这时引擎/图集可能还没加载好，
     * drawFoeArt 会静默返回留下空白画布（就是「boss 没有图像」的原因）。
     * 这里做「空白就重试」：每 320ms 重画一次，最多 12 次，引擎就绪后自然补上。 */
    const blank = (c) => {
      try {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
        return true;
      } catch (_) { return false; }
    };
    let tries = 0;
    const run = () => {
      const pending = nodes.filter((c) => c.getContext && blank(c));
      if (!pending.length || tries++ > 12) return;
      pending.forEach((c) => { const info = pool[Number(c.dataset.bossArt)]; if (info) drawFoeArt(c, info); });
      setTimeout(run, 320);
    };
    run();
  }
  /* ---------- 敌人图鉴的两组简介：三侠 / 征战首领 ----------
   * 用户 2026-10 口径：BOSS 一览里要先把**每层都会遇到的三侠**与 **x0 层的征战动物首领**
   * 介绍清楚，再列首领池；顺序固定为「三侠 → 征战首领 → 首领池」。
   * 文案全部来自 `TowerData`（`HERO_DEBUFF` / `CAMPAIGN_BOSSES` / `campaignBossFor`），
   * 这里只负责排版 —— 别在界面里另抄一份机制说明。 */
  const HERO_ORDER = ['tl', 'xh', 'xm'];
  /** 三侠：卡片只放名字 / 出场位置；大招与贯穿削弱全部收进悬停说明。
   *  用户 2026-10 口径：图鉴里不要直接写攻击模式，与其它 boss 卡一样悬停才看机制。 */
  function heroCatalogHtml() {
    const HD = TowerData.HERO_DEBUFF;
    if (!HD) return '';
    const keys = HERO_ORDER.filter((k) => HD[k]);
    if (!keys.length) return '';
    return '<div class="boss-group"><b class="boss-group-title">三侠' +
      '<i>每层第 1~3 场 · 顺序随机</i></b>' +
      '<ol class="tower-plan boss-grid">' + keys.map((k) => {
        const h = HD[k];
        const tip = h.hero + ' · 大招「' + h.ult + '」（' + h.name + '）\n' + h.desc;
        return '<li class="hero" tabindex="0" data-tip="' + esc(tip) + '">' +
          '<b>' + esc(h.hero) + '</b>' +
          '<span class="tower-plan-type">第 1~3 场</span></li>';
      }).join('') + '</ol></div>';
  }
  /** 四雄（征战动物首领）：层号由 `campaignBossFor` 反查；卡面只保留层数 / 等级，
   *  出招循环与机制全部收进悬停说明（用户 2026-10 口径）。 */
  function campaignCatalogHtml() {
    const list = TowerData.CAMPAIGN_BOSSES;
    if (!Array.isArray(list) || !list.length) return '';
    const layerOf = {};
    for (let L = 10; L <= 990; L += 10) {
      const b = TowerData.campaignBossFor ? TowerData.campaignBossFor(L) : null;
      if (b && layerOf[b.id] == null) layerOf[b.id] = L;
    }
    const layers = Object.values(layerOf).sort((a, b) => a - b);
    const rows = list.map((b) => {
      const L = layerOf[b.id] || 0;
      const tip = [b.name + (L ? ' · 第 ' + L + ' 层（Lv' + b.level + '）' : ''),
        b.patternDesc || '', b.mechDesc || ''].filter(Boolean).join('\n');
      return '<li class="campaign" tabindex="0" data-tip="' + esc(tip) + '">' +
        '<b>' + esc(b.bigName || b.name) + '</b>' +
        '<span class="tower-plan-type">' + esc((L ? '第 ' + L + ' 层' : '征战首领') + ' · Lv' + b.level) + '</span></li>';
    }).join('');
    return '<div class="boss-group"><b class="boss-group-title">四雄' +
      '<i>' + (layers.length ? '征战副本 · 第 ' + layers.join(' / ') + ' 层最后一战' : '征战副本首领') + '</i></b>' +
      '<ol class="tower-plan boss-grid">' + rows + '</ol></div>';
  }
  /** 魔王：从首领里单独拆出来的一类。分组标题只写「魔王」，卡面只显示魔王/？？？；
   *  用户 2026-10 口径：悬停也全是「？？？」，不给出现位置/机制说明。 */
  function demonCatalogHtml(king) {
    if (!king) return '';
    return '<div class="boss-group"><b class="boss-group-title">魔王</b>' +
      '<ol class="tower-plan boss-grid">' +
      '<li class="patrol king" tabindex="0" data-tip="？？？">' +
      '<b>' + esc(king.name) + '</b>' +
      '<span class="tower-plan-type">魔王</span>' +
      '<span class="boss-rarity hidden">？？？</span>' +
      '</li></ol></div>';
  }
  function bossCatalogHtml() {
    const pool = Tower.bossPool ? Tower.bossPool() : [];
    /* 魔王单开一组：从首领池里摘出去，保留「？？？」防剧透，但不再跟普通首领混排。 */
    const king = pool.find((b) => b && b.king) || null;
    const rest = pool.filter((b) => b && !b.king);
    const heroes = heroCatalogHtml();
    const campaigns = campaignCatalogHtml();
    const demon = demonCatalogHtml(king);
    if (!rest.length && !heroes && !campaigns && !demon) return '';
    const HD = TowerData.HERO_DEBUFF || {};
    const counts = [];
    if (heroes) counts.push('三侠 ' + HERO_ORDER.filter((k) => HD[k]).length);
    if (rest.length) counts.push('首领 ' + rest.length);
    if (campaigns) counts.push('四雄 ' + (TowerData.CAMPAIGN_BOSSES || []).length);
    if (demon) counts.push('魔王 1');
    return '<div class="tower-buffs boss-catalog"><h4>BOSS 一览 <span class="buff-slot-count">' +
      counts.join(' · ') + '</span></h4>' + heroes +
      (rest.length
        ? '<b class="boss-group-title">首领<i>第 4 场 / 10 层守关</i></b>' +
          '<ol class="tower-plan boss-grid">' + rest.map((b, i) => {
            const tier = b.tier == null ? null : b.tier;
            /* 普通首领池不再有魔王；保留下面的 secret 分支只是防御未来数据。 */
            const secret = !!b.secret;
            const tip = secret ? '？？？' : ((b.rarity ? '装备稀有度：' + b.rarity + '。' : '') + mechTip(b));
            const rarity = secret ? '？？？' : ((b.rarity || '') + '装备');
            return '<li class="' + (b.elite ? 'elite ' : '') + (b.squirrel ? 'squirrel ' : '') + (b.king ? 'king ' : '') +
              (tier == null ? '' : 'tier-' + tier) + '" tabindex="0" data-tip="' + esc(tip) + '">' +
              '<b>' + esc(b.name) + '</b>' +
              (b.type ? '<span class="tower-plan-type">' + esc(b.type) + '</span>' : '') +
              '<span class="boss-rarity' + (secret ? ' hidden' : ' r' + tier) + '">' + esc(rarity) + '</span>' +
              '</li>';
          }).join('') + '</ol>'
        : '') + campaigns + demon + '</div>';
  }
  /** 左侧塔身：当前层附近的一段楼层，自上而下。
   *
   * 层数与行高都做成自适应的：窗外（更上面/更下面）还各留一点余量，配合 CSS 的
   * mask 淡出，看起来就是「塔还在往上/往下延伸」。以前固定只给 9 层（上下各 4），
   * 行高 34px + 间距 9px，实际一屏只能露出 6 层左右，无尽塔看着层数太少。
   *
   * 注意 mode==='tower' 时，历史最高层以下是「已通关」，再上面才是「待爬」；
   * 无尽塔没有上限（maxLayer 传 0），所以整列都算「待爬」，不能标成已通关。 */
  function towerVisual(layer, maxLayer, mode) {
    /* 当前层之上 / 之下各显示几层。配合 CSS 里 .tower-visual 的固定高度（470px）：
     * 13 层 ×约 29px + 12 ×3 间距 + 金冠(26) + 上下内边距(27) ≈ 470，正好铺满。
     * 演进过程：15 层(约22px) → 14 层(约27px) → 13 层(约29px)，
     * 塔身总高同时从 500px 收到 470px，所以每层反而更高。 */
    const ABOVE = 8, BELOW = 4;
    const top = layer + ABOVE, bottom = Math.max(1, layer - BELOW);
    let floors = '';
    for (let i = top; i >= bottom; i--) {
      /* 已通关 = 当前层以下（i < layer）或历史最高层以内；
       * 当前层自己一定要是 now —— 以前写成 (i < layer || i <= maxLayer)，
       * 「正在打第 20 层、历史最高 25 层」时当前层会被判成已通关，
       * 金色高亮和箭头一起消失，看着像卡在旧层。 */
      const done = mode === 'tower' && i !== layer && (i < layer || i <= maxLayer);
      const cls = done ? 'done' : i === layer ? 'now' : 'todo';
      floors += '<div class="tower-floor ' + cls + (i % 10 === 0 ? ' elite-floor' : i % 5 === 0 ? ' fifth-floor' : '') + '">' +
        (i === layer ? '<span class="tower-marker" aria-hidden="true"></span>' : '') +
        '<b class="tower-floor-no">' + i + '</b></div>';
    }
    return '<div class="tower-visual" aria-label="塔层进度"><div class="tower-floors">' + floors + '</div></div>';
  }
  function planHtml(preview, extraCls) {
    return '<ol class="tower-plan' + (extraCls || '') + '">' + preview.map((b, i) =>
      '<li class="' + (b.elite ? 'elite' : '') + (b.squirrel ? ' squirrel' : '') + '" tabindex="0" data-tip="' + esc(mechTip(b)) + '">' +
      '<span class="tower-plan-no">' + (i + 1) + '</span>' +
      foePortraitHtml(i, b) +
      '<b>' + esc(b.name) + '</b>' +
      (b.type ? '<span class="tower-plan-type">' + esc(b.type) + '</span>' : '') +
      (b.elite ? '<em class="elite-tag">精英</em>' : '') +
      '</li>').join('') + '</ol>';
  }

  /* ============================================================
   * 【U6】主塔页面 —— openTower
   * ============================================================ */

  function openTower(opts) {
    setTowerOrigin(opts);
    const info = Tower.towerInfo();
    let main, footer = null;
    if (info.run) {
      const run = info.run;
      main = '<div class="tower-head"><h2 class="tower-title">第 ' + run.layer + ' 层 · 第 ' + run.battleNo + '/' + run.battleCount + ' 场</h2>' +
        '<div class="tower-stats">已累积松果 <b class="gold-text">' + run.pot + '</b>（失败只保底 30%）</div></div>' +
        currencyHtml('tower') +
        /* 环境词缀与「三侠削弱」都摆在这一屏（与无尽塔同一套组件）：
         * 环境是挑战塔里**唯一会临时改变敌我数值**的东西，第 5 层起可能在层内抽到；
         * 三侠削弱是「贯穿本层」的。不带这两块的话，玩家只会觉得「敌人怎么突然变强了」。 */
        carryBar(run.curHp, run.curMaxHp, '血量', '', hpTip(run)) +
        envPanelHtml(run, { label: '当前环境' }) + debuffPanel(run.debuffs) + ownedBuffsHtml('tower') +
        '<div class="tower-actions">' + C().btn('继续战斗', 'fight', 'gold') + C().btn('放弃本层', 'abandon', 'muted small') + '</div>';
    } else {
      main = '<div class="tower-head"><h2 class="tower-title">挑战塔 · 第 ' + info.nextLayer + ' 层</h2>' +
        '<div class="tower-stats">目标等级 ' + info.level + ' · 强度 ×' + info.mult.toFixed(2) + ' · ' + info.battles + ' 场连战 · 通关金松果 <b class="gold-text">' + info.gold + '</b></div></div>' +
        currencyHtml('tower') +
        /* 【2026-10 用户口径】原来这里还有一串规则介绍（「每层 1 张挑战书 · 连战只继承血量 ·
         * 对手顺序每层随机 · 三侠大招会留削弱 · 第 5 层起有环境词缀 · 通关另补 3 场掉落」），
         * 用户要求去掉。信息没丢：挑战书数量在下面那颗「现有挑战书 N 张」、
         * 环境与三侠削弱各有一块自己的面板/预告、目标等级与连战场数在标题右边的 tower-stats 里。
         * 别再往这一屏加规则文字。 */
        /* 开打前就让人看清「这一层会碰上什么」：环境池（挑战塔口径）+ 三侠大招会留下什么。
         * 预告用 `horizontal` 变体：经典外壳里它是**横向一排**（用户口径 2026-10-19，
         * 原来被 classic-refine.css 的经典覆盖压成了 1×4 纵向卡片）；
         * 卡片本体沿用 tower.css 的默认样式（立绘在上、名字/类型在下），见那边的 `:not(.horizontal)` 排除。 */
        envPreviewHtml(info.nextLayer) + heroDebuffPreviewHtml() +
        '<h4 class="tower-plan-title">本层对手预告</h4>' + planHtml(info.preview, ' horizontal');
      footer = '<div class="tower-actions tower-footer">' +
        '<span class="tower-book-count">现有挑战书 ' + info.books + ' 张</span>' +
        /* 【2026-10 用户口径】按钮文案就是「开始挑战」，不再缀「（挑战书×1）」——
         * 消耗看左边那颗「现有挑战书 N 张」（再上面那串「每层 1 张挑战书…」的规则介绍
         * 也按用户口径整段删掉了）。 */
        C().btn('开始挑战', 'fight', 'gold') + '</div>';
    }
    const content = '<div class="tower-page' + (footer ? ' has-footer' : '') + '">' + towerVisual(info.nextLayer, info.maxLayer, 'tower') +
      '<div class="tower-main">' + main + '</div>' + (footer || '') + '</div>';
    const ct = classicTower();
    const p = C().page('challenge', 'stages', content, ct
      ? { cls: 'tower-board', noTabs: true, noFooter: true, pageClass: 'classic-tower', above: classicTowerBar() }
      : { cls: 'tower-board' });
    bindTips(p);
    if (!info.run) { fillFoeArt(p, info.preview); fillClassicFoeArt(p, info.preview); }
    back(p, towerBack, ct ? '返回征战' : '返回');
    /* 挑战塔是固定纯色（无尽塔才按层变色）。 */
    if (ct) applyClassicTowerBg(p, 'tower', info.run ? info.run.layer : info.nextLayer);
    on(p, 'fight', () => {
      if (info.run) {
        if (info.run.choices) { offerChoice('tower', info.run.choices); return; }
        fight('tower');
        return;
      }
      const started = Tower.startTowerRun();
      if (!started.ok) {
        notice(started.msg, started.needsBook ? [{ label: '买挑战书', run: () => UI.runAction('shop') }, { label: '返回', cls: 'gold' }] : undefined);
        return;
      }
      fight('tower');
    });
    on(p, 'abandon', () => {
      modal('放弃挑战', '<p>放弃后本局已累积的松果将全部失去（也没有安慰奖），确定吗？</p>', [
        { label: '放弃', cls: 'muted', run: () => { Tower.abandon('tower'); syncTickets(); openTower(); } },
        { label: '继续挑战', cls: 'gold' },
      ], { small: true });
    });
  }

  /* ============================================================
   * 【U7】无尽页面 —— openEndless
   * ============================================================ */

  /* ============================================================
   * 【U20】镜中世界 —— 整百层的「照影之境」拾取屏与黑白过场
   *
   * 用户口径 2026-10（逐条）：
   *   · 卡片**尽量居中**在屏幕上；
   *   · 拾取**不是**「点一下 buff 就消失进背包」：卡片留在原位，
   *     卡片之外的**整个屏幕慢慢变成纯白**；变成纯白之后，**连卡片一起**慢慢变成纯黑；
   *     然后以**稍快一点**的速度从黑回到游戏界面（界面侧的动画就在这里，状态在 tower.js）；
   *   · 回到界面时它已经在「永久增益」的最前面、介绍是 `？？？`，右下角是「继续挑战」。
   *
   * 三层结构（顺序就是 z 序）：
   *   ① `.mirror-veil`  —— 白色遮罩，**在卡片下面**（所以变白时卡片还在）；
   *   ② `.mirror-card`  —— 卡片本身；
   *   ③ `.mirror-black-veil` —— 黑色遮罩，挂在 `<body>` 上、**在一切之上**（连卡片一起变黑）；
   *      最后它自己淡出（比变黑快），露出重画好的主界面。
   * ⚠ 黑幕挂在 body 上而不是页面里：中间要重画一次主界面（拾取屏 → 主界面），
   *   挂在页面里会被这次重画一起换掉，过场就断了。
   * ============================================================ */
  const MIRROR_WHITE_MS = 1500;      // 卡片之外 → 纯白
  const MIRROR_BLACK_MS = 1500;      // 连卡片一起 → 纯黑
  const MIRROR_BACK_MS = 850;        // 黑 → 游戏界面（「较快一点」）
  let mirrorBlackVeilEl = null;
  /** 拾取屏的整屏内容：白色遮罩 + 居中的传奇卡片。 */
  function mirrorPickupHtml(run) {
    const def = (TowerData.MIRROR && TowerData.BUFF_BY_ID[TowerData.MIRROR.id]) || null;
    const owned = Math.max(0, Number(run && run.mirrorStacks) || 0);
    const rarity = def ? (Number(def.rarity) || 0) : 3;
    return '<div class="tower-mirror" data-mirror-stage>' +
        '<div class="mirror-veil" aria-hidden="true"></div>' +
        '<div class="mirror-card-wrap">' +
          /* ⚠ 卡片必须是 `data-action="mirror-pick"`：界面的点击绑定走 `on(p, 'mirror-pick')`，
           * 而它按 `[data-action="…"]` 找元素（用 data-mirror-pick 之类的自定义属性会绑不上，
           * 卡片就成了点不动的死按钮）。 */
          '<button type="button" class="mirror-card r' + rarity + '" data-action="mirror-pick" ' +
            'aria-label="拾取' + esc(def ? def.name : '照影之境') + '">' +
            '<span class="mirror-ribbon r' + rarity + '">' + esc(RARITY[rarity] || '传奇') + '</span>' +
            '<span class="mirror-emblem" aria-hidden="true"></span>' +
            '<b class="mirror-name">' + esc(def ? def.name : '照影之境') + '</b>' +
            '<span class="mirror-flavor">' + esc(def && def.flavor ? def.flavor : '映出一具完美的躯壳') + '</span>' +
            (owned > 0 ? '<span class="mirror-stacks">已在镜中 ×' + owned + ' → ×' + (owned + 1) + '</span>' : '') +
            '<span class="mirror-prompt">点击拾取</span>' +
          '</button>' +
        '</div></div>';
  }
  /** 黑色遮罩（挂在 body 上，跨重画存活）。`on=true` 变黑，`on=false` 淡出并移除。 */
  function mirrorBlackVeil(on) {
    if (typeof document === 'undefined' || !document || !document.body) return;
    if (on) {
      if (!mirrorBlackVeilEl) {
        mirrorBlackVeilEl = document.createElement('div');
        mirrorBlackVeilEl.className = 'mirror-black-veil';
        document.body.appendChild(mirrorBlackVeilEl);
      }
      /* 先以 opacity:0 入 DOM，再在下一帧加 `.on` —— 否则「插入 + 变 1」会被合并成一次，
       * 玩家看不到「慢慢变黑」这个过程（用户口径要的就是这个渐变）。 */
      setTimeout(() => { if (mirrorBlackVeilEl && mirrorBlackVeilEl.classList) mirrorBlackVeilEl.classList.add('on'); }, 20);
      return;
    }
    const el = mirrorBlackVeilEl;
    mirrorBlackVeilEl = null;
    if (!el) return;
    if (el.classList) el.classList.add('out');
    setTimeout(() => { if (el && el.remove) el.remove(); }, MIRROR_BACK_MS + 140);
  }
  /** 点卡片拾取：状态先落地（存档按这一刻算），再放三段过场动画。 */
  function pickMirror() {
    const res = Tower.takeMirrorReward ? Tower.takeMirrorReward() : { ok: false, msg: '当前版本没有这个接口。' };
    if (!res || !res.ok) { notice((res && res.msg) || '现在不能拾取。'); openEndless(); return; }
    const stage = (typeof document !== 'undefined' && document && typeof document.querySelector === 'function')
      ? document.querySelector('[data-mirror-stage]') : null;    if (stage && stage.classList) stage.classList.add('mirror-white');      // ① 卡片之外 → 纯白
    setTimeout(() => {
      mirrorBlackVeil(true);                                               // ② 连卡片一起 → 纯黑
      setTimeout(() => {
        openEndless();                                                     // ③ 黑幕之下换回游戏界面
        mirrorBlackVeil(false);                                            //    黑幕较快地淡出
        runToast('获得传奇增益「' + (res.name || '照影之境') + '」' + (res.stacks > 1 ? ' ×' + res.stacks : ''));
      }, MIRROR_BLACK_MS);
    }, MIRROR_WHITE_MS);
  }
  /** 右下角「继续挑战」：问一句要不要进镜中世界（用户口径的那句话）。 */
  function openMirrorConfirm() {
    const carryPct = Math.round(TowerData.ENDLESS_CYCLE_DISCOUNT * 100);
    modal('镜中世界',
      '<div class="mirror-confirm"><p>无尽之塔中的魔王已被击败，继续在镜中世界进行挑战吗？</p>' +
      '<p>本轮只封存静态四维与暴击、吸血、减伤等数值，成为不占位的永久基础。</p>' +
      '<p class="dim">后发制人、战斗续航、天命所归等纯局内触发不保留；旧构筑清空，成长、限次、经济与武器/技能选取强化停止，原增益重新入池；已有货币与累计战报保留。</p>' +
      '<p class="dim">新一轮敌人的基础属性降至上一轮末值的 ' + carryPct + '%，再按第 1—100 层的相对曲线成长。层内规则与构筑从头开始。</p></div>',
      [
        /* 按钮文案按 `docs/界面按钮文案规范.md`：动作标签 2~3 个汉字 —— 原来的「是 / 否」
         * 只有一个字，`test-button-labels` 会直接判违规（也是 `test-mint-shop` 期望「进入」的那颗）。 */
        { label: '进入', cls: 'gold', run: () => {
            const r = Tower.enterMirrorWorld ? Tower.enterMirrorWorld() : { ok: false };
            if (!r || !r.ok) notice((r && r.msg) || '现在还不能进镜中世界。');
            else replaceTarget = null;
            openEndless();
          } },
        { label: '取消', cls: 'muted' },
      ], { small: true });
  }

  function openEndless(opts) {
    setTowerOrigin(opts);
    /* 【U18c】到这一屏就**直接触发**该播的剧情（用户口径 2026-10：不要先点一次「继续战斗」）。
     * `Tower.autoPlayStory` 是「现在该播吗」的唯一判定（判定在 tower-plot 的 `due()`）：
     * 没剧情时它什么都不做；该播时它把 id 落到 `run.story` 上 —— 所以紧接着取到的 info
     * 已经带着这一段，这一屏**立刻**就是剧情屏。
     * ⚠ 必须问在 `endlessInfo()` **之前**（info 是快照，问晚了这一屏还是普通界面）。
     * 这一条覆盖所有「进到这一屏」的路径：层通关推进、离店 / 结算点继续、读档重进、
     * 调试挪层，以及「巡视」那一场走到眼前 —— 都不用玩家先点一下。 */
    try { if (Tower.autoPlayStory) Tower.autoPlayStory('endless'); } catch (e) { /* 判不出来就当没有 */ }
    const info = Tower.endlessInfo();
    let main, footer = null;
    /* 这一屏有没有「右下角固定动作条」（继续战斗 / 放弃本局）：
     * 剧情屏、拾取屏没有，不能给它们加底部留白。 */
    let runBoard = false;
    /* 对手数：60/70/80/90 层的第 5 场是四雄，整列会有 5 张卡；
     * 5 张时右下角动作条会压住最后一张（四雄头像被「继续战斗」盖住），
     * 页面要进入压缩布局，见 CSS 的 .foes-many。 */
    let foeCount = 0;
    /* 「还没开始」= 本局还在第 1 层、一场都没打完。
     * 这一屏**不显示抽奖卷 / 铸币**：currencyHtml 在「有对局」时显示的是**本局应得**的张数
     * （ticketsOnExit），玩家会误以为是自己仓库里的存量；所以干脆整块不渲染。
     * 打完第一场之后恢复显示（那时右上角的数字才有意义）。 */
    const notStarted = !!(info.run && info.run.layer === 1 && !(info.run.score > 0) && !(info.run.lastCoinsGained > 0));
    if (info.run) {
      const run = info.run;
      /* 【U18】剧情优先：这一屏该走剧情模式时，**局内 UI 一个都不渲染**（增益/减益/血量/
       * 环境/分数/铸币/试炼币/敌人预告全去掉），只留塔身 + 文字 + 右下角「继续」。
       * 剧情的文本与播片机都在 js/tower-plot.js（window.TowerPlot），这里只负责「把它画进这一屏」。 */
      const storyId = TowerPlot.pending(run);
      if (storyId) {
        main = TowerPlot.modeHtml(TowerPlot.begin(storyId), run.layer);
      } else if (run.pendingStoryId && run.pendingStoryHold) {
        /* 【U18c】第一次失去烙印：**先**把「碎掉的烙印失效」这条提示停留一下
         *（用户口径：这个弹窗要停留得久一些），点掉之后下一屏才进剧情。
         * 做成整屏而不是自动消失的飘字：「停留多久」由玩家自己掌控，不会被下一屏顶掉。 */
        const lost = (run.lostMarks && run.lostMarks.length)
          ? run.lostMarks[run.lostMarks.length - 1].label : '';
        main = TowerPlot.noticeHtml('烙印失效',
          '<p class="tower-story-line">碎掉的烙印失效：' + esc(lost || '一道烙印') + '</p>' +
          '<p class="tower-story-line done">它从你的存在中被抹去了。</p>');
      } else if (run.mirrorPending) {
        /* 【U20】整百层「觐见魔王」打完、终章剧情也播完了 → **拾取「照影之境」**这一屏
         *（用户口径：卡片尽量居中；点它之后卡片留在原位，整屏先白后黑再回到游戏界面）。
         * 剧情屏的优先级在它上面（刚刚那一段 `storyId`），所以顺序是：终章剧情 → 拾取屏。 */
        main = mirrorPickupHtml(run);
      } else if (run.phase === 'mirror' && !pendingMilestone &&
        Tower.canSettleEndlessVictory && Tower.canSettleEndlessVictory()) {
        return openEndlessSummary(Tower.previewEndlessSummary('win'));
      } else {
      const nextLabel = run.choices ? '先选一张增益'
        : run.phase === 'shop' ? (run.mintShop ? '进入铸币商店' : '进入试炼商店')
        : run.phase === 'checkpoint' ? '前往结算点'
        : run.phase === 'sacrifice' ? '放弃一个永久增益'
        /* 【U20】整百层：拾取完照影之境之后，右下角是「继续挑战」（不是「进入商店」——
         * 整百层本来也不开店），点它才问「要不要进镜中世界」。 */
        : run.phase === 'mirror' ? '继续挑战' : '继续战斗';
      /* 只认 run.plan（实战真正会打的那一串）。以前这里另算一遍 preview(layer, salt)，
       * 只要重建 plan 时漏了 salt / squirrelsOnly，界面第 4 场的 boss 就和实战不是同一只。 */
      const foes = (Tower.planInfo ? Tower.planInfo('endless') : []).length
        ? Tower.planInfo('endless')
        : Tower.preview(run.layer, run.salt, true);
      const clearing = (run.phase === 'shop' || run.phase === 'checkpoint' || run.phase === 'sacrifice' || run.phase === 'mirror') && run.finished && run.finished.layer === run.layer;
      const beatenCount = clearing ? foes.length : Math.max(0, (run.battleNo || 1) - 1);
      foeCount = foes.length;
      const foeRows = foes.map((b, i) =>
        '<li class="' + (b.elite ? 'elite ' : '') + (b.patrol ? 'patrol ' : '') + (b.squirrel ? 'squirrel ' : '') +
        (i < beatenCount ? 'beaten' : '') +
        '" tabindex="0" data-tip="' + esc(mechTip(b, (run.env || []).map((e) => e.text || e.desc || e.name))) + '">' +
        foePortraitHtml(i, b) +
        '<b>' + esc(b.name) + '</b>' + (b.type ? '<span class="tower-plan-type">' + esc(b.type) + '</span>' : '') +
        (b.elite ? '<em class="elite-tag">精英</em>' : '') +
        (i < beatenCount ? '<em class="beaten-tag">✓ 已战胜</em>' : '') + '</li>').join('');
      const choicesHtml = run.choices
        ? '<div class="tower-buffs choice-onpage"><h4>休整点 · 选一张带走</h4>' +
          /* 选牌是内联在这一屏的，所以「当前环境」要贴在卡片正上方 ——
           * 选牌时一眼能看到这一局现在顶着什么。 */
          (run.env && run.env.length
            ? '<div class="hex-seg-mechs inline"><span class="hex-next-label">当前环境</span>' +
              run.env.map((e) => envChip(e, { compact: true })).join('') + '</div>'
            : '') +
          '<div class="hex-row">' +
          /* 这里是**无尽塔**的首页：口径固定传 'endless'。
           * 注意不要写成裸 mode —— openEndless() 作用域里没有 mode，
           * 一旦 run.choices 有值就会 ReferenceError，整屏渲染不出来（战斗回来会卡住）。 */
          run.choices.map((c, i) => choiceCard(c, i, 'endless')).join('') + '</div></div>' : '';
      /* 顶栏：标题 → 试炼币/抽奖卷 → 分数框 → 右边缘的三个药丸槽（等腰三角摆放）。
       * 血量紧贴标题下方（分数已经挪进顶栏，所以这里整体上提），字号与血条都放大一档；
       * 「继续战斗」在右下角，「放弃本局」更小、压在它左边偏下。 */
      runBoard = true;
      main = '<div class="endless-run">' +
        /* 右上角：药丸槽 + 试炼币/抽奖卷 + 分数框（横向一行，位置不变）。
         * 本局还没打完第一场时不放货币条（见 notStarted 的说明），只留分数框。
         * 【2026-10 第八十四批】这里原来还挂了一个「敌人成长 ×N」框 —— **用户口径要求去掉**
         * （主界面右上角保持干净）；倍率只在开打前那一屏保留一份「1 层 = ×1」的刻度说明。 */
        '<div class="endless-topright">' + (notStarted ? '' : currencyHtml('endless')) +
        '<span class="endless-score-box"><i>分数</i><b>' + run.score + '</b></span></div>' +
        '<div class="endless-left">' +
        '<div class="endless-title-row"><h2 class="tower-title">无尽模式 · 第 ' + run.layer + ' 层' +
        '</div>' +
        carryBar(run.curHp, run.curMaxHp, '血量', 'endless-hp', hpTip(run)) +
        /* 环境词缀（唯一常驻负面机制）：
         * 段位机制已并入环境，这里只画一个面板；每条都带完整悬停说明与数值区间。
         * 三侠削弱（贯穿本层）与挫锐/卸甲（本局全局减益）是「本局累积的减益」，
         * 不是环境，所以仍旧跟在同一行后面，方便一眼看全。 */
        envPanelHtml(run, { label: '当前环境' }) +
          (run.enemyMaxHpDown > 0 || run.enemyPowerDown > 0
            ? '<div class="tower-rule mech-bar"><b>本局全局减益</b>' +
              (run.enemyMaxHpDown > 0
                ? '<span class="mech-chip debuff-chip enemy-down" data-tip="' +
                  esc('挫锐 / 卸甲：本局所有敌人的生命上限都按这个比例扣') + '">敌人生命上限 −' +
                  Math.round(run.enemyMaxHpDown * 100) + '%<i>本局全程</i></span>' : '') +
              (run.enemyPowerDown > 0
                ? '<span class="mech-chip debuff-chip enemy-down" data-tip="' +
                  esc('挫锋：立刻让本局所有敌人的攻击力 −15%') + '">敌人攻击力 −' +
                  Math.round(run.enemyPowerDown * 100) + '%<i>本局全程</i></span>' : '') +
              '</div>'
            : '') +
          (run.debuffs && run.debuffs.length
            ? '<div class="tower-rule mech-bar"><b>本层削弱（贯穿本层）</b>' +
              run.debuffs.map((d) => '<span class="mech-chip debuff-chip" style="--hero-color:' + esc(d.color || '#a8453a') +
                '" data-tip="' + esc(d.text || '') + '">' +
                esc(d.short || d.hero || '大侠') + esc(d.name || '削弱') + '<i>本层</i></span>').join('') + '</div>'
            : '') +
        choicesHtml + buffPanelsHtml('endless') + '</div>' +
        '<div class="endless-foes' + (foeCount >= 5 ? ' foes-many' : '') + '">' +
        '<ol class="tower-plan vertical">' + foeRows + '</ol></div></div>' +
        '<div class="endless-actions tower-actions">' +
        '<span class="endless-action-btns">' +
        C().btn('放弃本局', 'abandon', 'muted tiny') +
        C().btn(nextLabel, 'fight', 'gold') + '</span></div>';
      }
    } else {
      /* 还没开始（没有进行中的对局）：这一屏也**不显示抽奖卷 / 铸币**，
       * 下方那行「现有抽奖卷 X 张」一并去掉 —— 只留「开始冲塔」一个按钮。
       * 想看仓库抽奖卷总数请去「每日幸运抽奖」页（那边的口径就是仓库存量）。 */
      main = '<h2 class="tower-title">无尽模式</h2>' +
        '<div class="tower-stats">历史最高 <b class="gold-text">' + info.best + '</b> 分 · 本周最高 ' + info.weekBest + ' 分 · 最深 ' + info.bestLayer + ' 层</div>' +
        /* 【2026-10 用户口径】开局页**只留增益图鉴与敌人图鉴**：原来这里还有两块文字 ——
         * ①「敌人成长 ×N」刻度行（foeScaleChip，第 1 层 ×1 那把刻度）；
         * ②「每 100 层重来一轮，层号与机制严格对应…」的整段说明。
         * 两块都删掉了（倍率口径仍写在 tower-data 的【D2b】注释与 endlessScaleParts 里，
         * 不占开局页版面）。别再往这一屏加规则文字 —— 用户要的就是「buff + 敌人图鉴」。 */
        buffCatalogHtml() + bossCatalogHtml();
      footer = '<div class="tower-actions tower-footer">' +
        /* 2026-10 用户口径：这一颗按钮叫「开始攀登」（原来叫「开始冲塔」）。 */
        (info.lastSummary ? C().btn('上局战报', 'last-summary', 'muted') : '') +
        C().btn('开始攀登', 'fight', 'gold') + '</div>';
    }
    /* 刚播完剧情 → 整页带一个淡入类（【U18】不要硬切）。
     * ⚠️ 动画**只作用在 .tower-main**（见 CSS）：塔身不参与，否则左侧塔 UI 会跟着闪一下。 */
    const fadeIn = TowerPlot.takeFadeIn();
    const content = '<div class="tower-page' + (runBoard ? ' endless-page' : '') +
      (footer ? ' has-footer' : '') + (fadeIn ? ' tower-fade-in' : '') + '">' +
      towerVisual(info.run ? info.run.layer : 1, 0, 'endless') +
      '<div class="tower-main">' + main + '</div>' + (footer || '') +
      /* 【2026-10 用户口径】剧情 / 挑战模式开关**一直挂在塔的正下方**（绝对定位在页面左下角，
       * 也就是塔身那一列的下方）—— 不要塞进「放弃本局 / 继续战斗」那一行。 */
      TowerPlot.modeButtonHtml() + '</div>';
    const ct = classicTower();
    const p = C().page('challenge', 'stages', content, ct
      ? { cls: 'tower-board', noTabs: true, noFooter: true, pageClass: 'classic-tower', above: classicTowerBar() }
      : { cls: 'tower-board' });
    /* 【2026-10 用户口径】剧情页文字太长时要能自动下翻：整页重画会把文字区的滚动位置
     * 归零，而这一屏可能已经打完（没有下一次打字 tick 来带滚动），所以在画完之后同步补一次。 */
    if (typeof TowerPlot.afterRender === 'function') TowerPlot.afterRender();
    bindTips(p);
    if (info.run) { const pv = Tower.planInfo ? Tower.planInfo('endless') : Tower.preview(info.run.layer, info.run.salt, true); fillFoeArt(p, pv); fillClassicFoeArt(p, pv); fillClassicCampaignArt(p, pv); }
    back(p, towerBack, ct ? '返回征战' : '返回');
    if (ct) applyClassicTowerBg(p, 'endless', info.run ? info.run.layer : 1);
    /* 【2026-10 用户口径】剧情屏**没有「继续」按钮了**：点屏幕任意位置推进
     *（语义就是 `TowerPlot.next()` —— 正在打字时点一下＝立刻补完这一行，打完了再点＝下一行）。
     * `TowerPlot.showing()` 同时覆盖「剧情屏」与「停留一下」的提示屏（第一次失去烙印）。
     * ⚠ 点在按钮 / 带悬停气泡的元素上**不接管**：左下的「剧情/挑战模式」开关与「返回菜单」
     * 都不该顺手推进剧情（这几颗按钮就是这一屏上仅剩的可点控件）。 */
    if (TowerPlot.showing()) {
      p.onclick = (ev) => {
        const t = ev && ev.target;
        if (t && typeof t.closest === 'function' && t.closest('button, a, input, select, textarea, [data-tip]')) return;
        TowerPlot.next();
      };
    }
    /* 【U18b】左下角那颗按钮：剧情模式 ↔ 挑战模式，切完立刻重画这一屏。 */
    on(p, 'story-mode', () => { Tower.setStoryEnabled(!Tower.storyEnabled()); openEndless(); });
    on(p, 'last-summary', () => openEndlessSummary(info.lastSummary));
    on(p, 'fight', () => {
      if (info.run) {
        if (info.run.choices) { notice('先在下面选一张增益（休整点）。'); return; }
        if (info.run.phase === 'shop') { openShop(); return; }
        if (info.run.phase === 'checkpoint') { openCheckpoint(); return; }
        if (info.run.phase === 'sacrifice') { openPermSacrifice(); return; }
        /* 「巡逻」收缴（2026-10 第六十二批）：输了必须交出一个最高稀有度的增益才能继续。 */
        if (info.run.phase === 'patrolToll') { openPatrolToll(); return; }
        if (info.run.phase === 'patrolDiscard') { openPatrolDiscard(); return; }
        /* 【U20】整百层拾取完照影之境 → 这颗按钮是「继续挑战」：问一句要不要进镜中世界。 */
        if (info.run.phase === 'mirror') { openMirrorConfirm(); return; }
        fight('endless');
        return;
      }
      beginEndlessRun();
    });
    p.querySelectorAll('[data-choice]').forEach((el) => {
      el.onclick = () => {
        const index = Number(el.dataset.choice);
        const res = Tower.pickChoice('endless', index, replaceTarget);
        if (res && res.needsReplace) { offerReplace(index, res.buff); return; }
        if (!res || !res.ok) { notice((res && res.msg) || '这张选不了。'); openEndless(); return; }
        replaceTarget = null;
        if (res.pendingPick) { openPickBuff(res.pendingPick); return; }
        openEndless();      // 选完直接回主界面（不弹任何窗口）
      };
    });
    p.querySelectorAll('[data-toggle]').forEach((el) => {
      el.onclick = () => { Tower.toggleLimited(el.dataset.toggle); openEndless(); };
    });
    p.querySelectorAll('[data-replace]').forEach((el) => {
      el.onclick = () => {
        replaceTarget = replaceTarget === el.dataset.replace ? null : el.dataset.replace;
        openEndless();
      };
    });
    on(p, 'shop', () => openShop(true));
    /* 【U20】拾取「照影之境」（整百层那一屏）：点卡片 → 白 → 黑 → 回到游戏界面。 */
    on(p, 'mirror-pick', () => pickMirror());
    /* 待选取的强化（神兵淬炼/秘技通神）没选完时，回到主界面自动补弹一次 */
    if (info.run && info.run.pendingPick) setTimeout(() => openPickBuff(info.run.pendingPick), 60);
    /* 过程提示（「碎掉的烙印失效」这类）：**剧情屏上不飘** —— 整屏是剧情，
     * 飘字飘在它后面既看不到又浪费；留到剧情播完回主界面那次重画再飘。
     * 第一次失去烙印那一条会走 `hold`（停久一点），见 runToast / 【U18c】。 */
    if (!TowerPlot.showing()) flushRunToasts();
    /* 20 起每 10 层：出商店后必须放弃一个永久增益（不可取消）。
     * 【U18c】但**献祭前要先播剧情**（第 20 层那一段：「石门天平倾斜 → 苍老的声音」）——
     * 剧情屏上不能弹这个窗，否则剧情和弹窗叠在一起。剧情播完回主界面时这里会再跑一次。 */
    if (info.run && info.run.phase === 'sacrifice' && !TowerPlot.showing()) setTimeout(() => openPermSacrifice(), 60);
    /* 【U20】被剧情让路的「里程碑奖励」在这里补弹（同一场战斗之后的终章剧情播完才算轮到它）。 */
    if (pendingMilestone && !TowerPlot.showing()) {
      const pm = pendingMilestone;
      pendingMilestone = null;
      setTimeout(() => milestoneModal(pm.rw, pm.cont), 60);
    }
    on(p, 'rest-shop', () => {
      const res = Tower.openRestShop();
      if (!res.ok) { notice(res.msg || '现在不能开商店。'); return; }
      openShop();
    });
    on(p, 'abandon', () => {
      /* 【2026-10 用户口径】抽奖卷的账只在这里算：局内右上角不再显示它，
       * 玩家点「放弃本局」时把这一局的结算摊开（本层应得 + 铸币折现 = 到手）。
       * 数字来自 Tower.previewSettleTickets()（与真正发奖的 settleRunTickets 同一份口径，
       * 只算不改状态），所以弹窗承诺多少，点下去就是多少。 */
      const pv = Tower.previewSettleTickets ? Tower.previewSettleTickets() : null;
      const fmt = (v) => Math.max(0, Math.floor(Number(v) || 0));
      const lines = pv ? [
        '<li><span>按第 ' + pv.layer + ' 层应得</span><b class="gold-text">' + fmt(pv.layerTickets) + ' 张</b></li>',
        pv.mint > 0
          ? '<li><span>铸币折现（' + fmt(pv.mint) + ' 枚 ×1:1' +
            (pv.mintForfeited > 0 ? ('，上限 ' + pv.mintCap + ' 枚，超出 ' + fmt(pv.mintForfeited) + ' 枚作废') : '') +
            '）</span><b class="gold-text">+' + fmt(pv.mintConverted) + ' 张</b></li>'
          : '',
        '<li class="total"><span>结算到手</span><b>共 ' + fmt(pv.total) + ' 张抽奖卷</b></li>',
      ].filter(Boolean).join('') : '';
      modal('放弃本局',
        '<p>放弃后<b>按当前层结算抽奖卷</b>（分数照常入账）：</p>' +
        (lines ? '<ul class="settle-calc">' + lines + '</ul>' : '')
        , [
        { label: '放弃', cls: 'muted', run: () => {
            const res = Tower.abandon('endless');
            if (!res || !res.ok) { notice('当前无法结算，请先完成正在进行的战斗。'); return; }
            settleResult(res);
          } },
        { label: '继续冲塔', cls: 'gold' },
      ], { small: true });
    });
  }

  function beginEndlessRun() {
    const started = Tower.startEndlessRun();
    if (!started.ok) { notice(started.msg); return; }
    if (Tower.storyEnabled()) Tower.setRunStory('endless', 'intro');
    openEndless();
  }

  /* ============================================================
   * 【U8】战斗闭环 —— fight / winModal / afterBattle
   * ============================================================ */

  function reopen(mode) { if (mode === 'tower') openTower(); else openEndless(); }
  /** 开战前的最后一道闸：现在该先播剧情 → **不开打**。
   *
   *  【为什么必须在这里拦】入场剧情现在由进层时主动挂上（`run.story`），界面这一屏正显示剧情；
   *  玩家如果直接点「继续战斗」，`fight()` 会一路走下去把战斗开起来 —— 剧情就被跳过了。
   *  另外「巡视」那一场可能不是本层第 1 场，进层时还轮不到它，得走到那一场才播。
   *  两种情况都靠 `Tower.storyPendingForBattle`（**纯查询、不建令牌**）判掉，
   *  然后重画这一屏让剧情接着播；玩家读完再点一次才真开打。
   *  ⚠ 别改成「调 nextBattle 看看有没有剧情」：那会建出一枚 attempt 令牌，
   *  没剧情时又没地方收回，第二次点击会被 `run.attempt` 挡住（实测踩过）。 */
  function pendingStoryBlocksBattle(mode) {
    let blocked = false;
    try { blocked = Tower.storyPendingForBattle ? !!Tower.storyPendingForBattle(mode) : false; } catch (e) { blocked = false; }
    if (!blocked) return false;
    /* 剧情模式关掉时不该拦人（挑战模式 = 跳过所有文字剧情）。 */
    if (typeof Tower.storyEnabled === 'function' && !Tower.storyEnabled()) return false;
    /* 该播还没落的（巡视那一场）在这里补挂上，然后重画这一屏进剧情模式。 */
    try { Tower.autoPlayStory && Tower.autoPlayStory(mode); } catch (e) { /* 忽略 */ }
    reopen(mode);
    return true;
  }
  function fight(mode) {
    if (pendingStoryBlocksBattle(mode)) return;
    const nx = Tower.nextBattle(mode);
    if (!nx.ok) { reopen(mode); if (nx.msg) notice(nx.msg); return; }
    flushAchievements(nx.achievements);      // 「超凡入圣」这类在开战时算出的成就
    const interrupted = () => {
      Tower.interruptBattle(mode, nx.token);
      reopen(mode);
      notice('战斗播放中断，进度已保留，可重新挑战这一场。');
    };
    /* 无尽塔 20 层起，右下角在倍速键之外**再给一个跳过键**（用户口径 2026-10，
     * 起始层由 30 下调到 20；两个键都用「普通战斗的跳过键」那一档尺寸在右下并排，
     * 见 battle.js 的 cornerLayout）。
     * 跳过不影响胜负与收益：回合流本来就由 Sim.simulate 一次算完，跳过只是不播动画；
     * 塔内战斗本来也关了飘物（collectDrops:false），不会因为跳过丢掉落。 */
    const runNow = mode === 'tower' ? Tower.towerInfo().run : Tower.endlessInfo().run;
    const layerNow = runNow ? Math.max(1, Math.floor(Number(runNow.layer) || 1)) : 1;
    const skipAllowed = Tower.skipPlaybackAllowed(mode, layerNow);
    try {
      Promise.resolve(Main.startBattle(nx.foe, {
        region: nx.region, kind: mode, useProps: false, hpRatio: nx.hpRatio, adjustMe: nx.adjustMe,
        debuffs: nx.debuffs || [],
        // boss 机制：贴一条在战斗画面里（进层预告 / 选 buff 页都读过，这里是备忘）
        trial: nx.info && nx.info.mechDesc ? { text: nx.info.mechDesc } : null,
        // 塔里倍速可以到 3×（普通战斗只到 2×，见 main.js 的 startBattle）
        allowSkip: skipAllowed, speedToggle: true, speedMax: 3,
        /* 经典塔：胜利后不展示原版战果 CG。
         * 挑战塔保持原口径（只有经典村庄-征战入口藏，关卡页入口仍给原版战果页）；
         * **无尽塔不管从哪进都不要** —— 打完一场直接回塔页，不要那张全屏胜利图
         *（用户 2026-10 口径：「去掉无尽塔中战斗胜利后的那个胜利弹窗」）。
         * 注意 `hideVictoryCg` 只影响**胜利**：失败面板照旧（见 SfFight 的 `perform`）。 */
        hideVictoryCg: mode === 'endless' || classicTower(),
        // 塔的产出全部由状态机结算（松果/压缩碎片/抽奖卷），关掉战斗飘物，
        // 否则免门票的无尽模式可以无限刷飘物松果与经验。
        collectDrops: false,
        onError: () => Tower.interruptBattle(mode, nx.token),
        onEnd: (w, r) => {
          const hp = r && Array.isArray(r.hpAfter) ? r.hpAfter[0] : null;
          const cap = r && Array.isArray(r.maxHp) ? r.maxHp[0] : (nx.effMaxHp ? nx.effMaxHp() : 0);
          const abs = w === 0 && Number.isFinite(hp) ? Math.max(1, Math.round(hp)) : 0;
          /* **必须把战斗结果 `r` 一起交给状态机**：报告里的 rounds 里有 deathSave / revive 标记，
           * 涅槃（C14）的「每层 N 次」计数与隐藏成就「死而复生」都靠它。
           * 以前这里只传了 5 个参数，于是 C14 的计数在真实战斗里永远不涨 ——
           * 表现为「每场战斗都能复活一次」（用户报的 bug），成就也从来不触发。 */
          const rw = Tower.reportBattle(mode, nx.token, w === 0, abs, cap, r);
          reopen(mode);
          if (!rw.ok) return;                 // 令牌已作废的迟到回调，静默忽略
          afterBattle(mode, rw);
        },
      })).catch(interrupted);
    } catch (error) { interrupted(); }
  }
  /** 一场胜利后的「下一场」弹窗（里程碑奖励弹完也回到这里）。 */
  function winModal(mode, rw) {
    modal('战斗胜利', '<div class="result-box"><div class="result-title win">胜 利！</div>' +
      '<p>' + (mode === 'tower' ? '已累积松果 ' + rw.potGold : '分数 ' + rw.score + ' · 试炼币 ' + rw.coins) + '</p></div>',
      [{ label: '下一场', cls: 'gold', run: () => fight(mode) }], { small: true });
  }
  function afterBattle(mode, rw) {
    flushAchievements(rw.achievements);      // 「死而复生」这类在战斗结算时算出的成就
    /* 「巡逻」/「觐见魔王」输了**不走失败结算**（2026-10 第六十五批用户口径）：
     * 状态机那边已经把它标成 `patrol: true` 并挂上了 `phase = 'patrolToll'`，
     * 这里必须**先**处理它 —— 否则会掉进下面的 `!rw.win` 分支，弹出失败结算
     *（用户实测：100 层的魔王战输了直接被结算，只有普通巡逻战不会）。
     * 也不给「铸币回滚」的选项：按口径，这一场只收「一个最高稀有度的增益」。 */
    if (rw.patrol) { openPatrolToll(); return; }
    if (!rw.win) {
      if (mode === 'tower') towerDefeat(rw);
      else if (rw.retryable) endlessRetryOffer(rw);
      else endlessDefeat(rw);
      return;
    }
    if (mode === 'endless') {
      /* 【2026-10 用户口径】打完一场**不再自动进店**（原来「层末商店 / 铸币商店」会直接弹进店里，
       * 于是第 5 层那次「进店前的商人剧情」要等退出商店才看得到）。
       * 现在一律先回主界面：剧情该播就播，进店交给首页那颗
       * 「进入试炼商店 / 进入铸币商店」按钮。 */
      const cont = () => openEndless();
      /* 时间回廊（E15）：这一场打完就从本层第 1 场重开 —— 必须明确告诉玩家，
       * 否则「怎么又回到第 1 场了」会很懵。 */
      if (rw.layerRestart) {
        const lr = rw.layerRestart;
        modal('时间回廊', '<div class="result-box"><div class="result-title">回 廊</div>' +
          '<p>本层重新开始 —— 回到第 <b>1</b> 场再打一遍。</p>' +
          '<p class="dim">手上的增益、试炼币、分数与血量都<b>原样保留</b>，敌人的数值也不会提升' +
          '（第 ' + lr.layer + ' 层 · 第 ' + lr.battleNo + '/' + lr.battleCount + ' 场的收益照常入账）。</p></div>',
          [{ label: '回到开头', cls: 'gold', run: () => openEndless() }], { small: true });
        return;
      }
      if (rw.milestone) {
        /* 【U20】整十层里程碑与剧情可能**同一场战斗之后**一起触发（例：第 100 层的终章剧情）——
         * 弹窗盖在剧情屏上会把剧情压住（里程碑那一下点掉之前，玩家一个字都看不到）。
         * 剧情屏上先记着，等剧情播完回主界面那次重画再弹（见 openEndless 末尾）。 */
        if (TowerPlot.showing()) pendingMilestone = { rw: rw, cont: cont };
        else milestoneModal(rw, cont);
        return;
      }
      if (rw.repeat) {
        const rp = rw.repeat;
        modal(rp.name || '幻影回响',
          '<div class="result-box"><div class="result-title">回 响</div>' +
          '<p>三侠的幻影尚未散去 —— 立刻再战第 ' + Math.max(1, Number(rp.battleNo) || 1) + ' 场（同一对手）。</p>' +
          '<p class="dim">触发概率 ' + Math.round((Number(rp.chance) || 0) * 100) + '% · 这一场同样计入叠层</p></div>',
          [{ label: '再战一场', cls: 'gold', run: () => fight(mode) }], { small: true });
        return;
      }
      cont();
      return;
    }
    if (rw.choices) { offerChoice(mode, rw.choices); return; }
    if (rw.layerComplete) { towerClear(rw); return; }
    winModal(mode, rw);
  }

  /* ============================================================
   * 【U9】场间抉择弹窗（4 选 1） —— offerChoice / choiceCard
   * ============================================================ */

  const RARITY_CLASS = ['r0', 'r1', 'r2', 'r3'];
  /* 档位徽记（用户口径 2026-10 第七十九批）：普通 ● / 稀有 ◆ / 史诗 ★ / 传奇 ◆。
   * 原来写的是三元表达式 `rarity === 2 ? '★' : rarity === 1 ? '◆' : '●'` —— **传奇档落进 else 也画 ●**，
   * 既和普通档撞脸、又只是一个光秃秃的黄圆。现在传奇档有自己的字形，外面还套一圈**金色方框**
   * （见 css 的 `.hex-card.r3 .hex-emblem`），看起来就是「方框里嵌一颗钻石」。 */
  const RARITY_EMBLEM = ['●', '◆', '★', '◆'];
  function choiceCard(c, i, mode) {
    const b = TowerData.BUFF_BY_ID[c.id];
    if (!b) return '';
    const towerNext = isTowerNext(b, mode);
    return '<button type="button" class="hex-card ' + RARITY_CLASS[b.rarity] + '" data-choice="' + i + '">' +
      '<span class="hex-ribbon">' + RARITY[b.rarity] + '</span>' +
      '<span class="hex-emblem">' + (RARITY_EMBLEM[b.rarity] || '●') + '</span>' +
      '<b class="hex-name">' + esc(b.name) + '</b>' +
      '<span class="hex-scope">' + (towerNext ? '挑战塔' : SCOPE[b.kind]) +
        (b.kind === 'limited'
          ? (towerNext ? ' · 下一场战斗' : ' · 限次 ' + (b.uses || 1) + ' 场')
          : '') + '</span>' +
      '<span class="hex-desc">' + esc(TowerData.descOf(b, mode)) + '</span></button>';
  }
  function offerChoice(mode, choices) {
    const info = mode === 'tower' ? Tower.towerInfo() : Tower.endlessInfo();
    const run = info.run || {};
    const debuffs = (run.debuffs || []);
    const next = run.next;
    // 这一次选择才是真的对策选择（而不是看数值瞎选）。
    const nextHtml = next
      ? '<div class="hex-next"><span class="hex-next-label">下一场</span>' +
        '<b class="hex-next-name">' + esc(next.name) + '</b>' +
        (next.type ? '<span class="hex-next-type">' + esc(next.type) + '</span>' : '') +
        '<span class="hex-next-mech">' + esc(next.mechDesc || '没有特殊机制') + '</span>' +
        (next.patternDesc ? '<span class="hex-next-pattern">' + esc(next.patternDesc) + '</span>' : '') +
        '</div>'
      : '';
    const cut = mode === 'endless' && window.TowerData && TowerData.choiceCut ? TowerData.choiceCut(run.layer) : 0;
    const head = '<div class="hex-pick-head"><h2 class="hex-title">整装待发</h2>' +
      '<p class="hex-sub">' + (mode === 'tower'
        ? '第 ' + (run.battleNo || 4) + ' 场之前最后一次整备 —— 选一张带进去。'
        : '场间休整 —— 选一张带进去。' +
          /* 【100 层循环】21-40 层 −1、41-100 层 −2、101 层起回到 3 选 1。
           * 玩家看到「怎么只有 2 张」时要能看出这是规则，不是池子抽空了。 */
          (cut > 0 ? '（21-40 层选项 −1、41-100 层选项 −2：本层是 ' + cut + ' 项；第 ' +
            (Math.floor((Math.max(1, run.layer) - 1) / 100) * 100 + 101) + ' 层起恢复）' : '')) + '</p>' +
      nextHtml +
      /* 选牌弹窗也摊开「当前环境」——只写下一场自己的 mechDesc 会让人完全没准备。 */
      (mode === 'endless' && run.env && run.env.length
        ? '<div class="hex-seg-mechs"><span class="hex-next-label">当前环境</span>' +
          run.env.map((e) => envChip(e, { compact: true })).join('') + '</div>'
        : '') +
      (debuffs.length
        ? '<div class="hex-debuffs"><span class="hex-debuff-label">本层已被削弱（贯穿本层）</span>' +
          debuffs.map((d) => '<span class="hex-debuff" style="--hero-color:' + esc(d.color || '#7a4a18') + '">' +
            '<i>' + esc(d.short || d.hero || '大侠') + '</i>' + esc(d.text || d.name) + '</span>').join('') + '</div>'
        : '') +
      '</div>';
    const nSlots = Math.max(1, Math.min(6, choices.length));
    /* 注意要显式传 mode：Array.map 会把「数组本身」当第三个参数塞进来，
     * 那样卡片的「挑战塔 / 无尽塔」口径就全判成无尽塔了。 */
    const body = head + '<div class="hex-cards n' + nSlots + '">' + choices.map((c, i) => choiceCard(c, i, mode)).join('') + '</div>';
    const m = modal('', body, [], { locked: true });
    m.element.classList.add('choice-dialog', 'hex', 'hex-n' + nSlots);
    m.element.querySelectorAll('[data-choice]').forEach((el) => {
      el.onclick = () => {
        const picked = Tower.pickChoice(mode, Number(el.dataset.choice));
        m.close();
        if (!picked.ok) { reopen(mode); return; }
        flushAchievements(picked.achievements);
        const text = '获得增益「' + picked.buff.name + '」：' + TowerData.descOf(picked.buff, mode);
        const bonus = picked.score ? '<p class="gold-text">得分 +' + picked.score + '（获取增益）</p>' : '';
        modal('休整完毕', '<p>' + esc(text) + '</p>' + bonus,
          [{ label: '继续战斗', cls: 'gold', run: () => fight(mode) }], { small: true });
      };
    });
  }

  /* ============================================================
   * 【U10】主塔结算 —— towerClear / towerDefeat
   * ============================================================ */

  function towerClear(rw) {
    const prizes = (rw.prizes && rw.prizes.items) || [];
    const prizeLine = prizes.length
      ? '<div class="result-lines">悬浮奖品（3 场挑战的量）：' +
        prizes.map((p) => esc(p.name) + ' ×' + p.count).join('　') + '</div>'
      : '';
    /* 跳过键的代价（2026-10 用户口径）：跳过的场次在层结算里各随机抹掉一项 —— 明说一句，
     * 免得玩家以为奖品莫名其妙少了一包（见 tower.js 的 settlePrizes）。 */
    const lostList = (rw.prizes && rw.prizes.lost) || [];
    const lostLine = lostList.length
      ? '<div class="result-lines lost">跳过战斗：随机少收了 ' +
        lostList.map((p) => esc(p.name) + ' ×' + p.count).join('　') + '</div>'
      : '';
    const blackLine = !State.blackGearEnabled() ? '' : ((rw.black && rw.black.cards)
      ? '<div class="result-lines">黑装：黑色卡片 ×' + rw.black.cards + (rw.blackBox ? '、黑装自选箱 ×' + rw.blackBox : '') + '</div>'
      : (rw.blackBox ? '<div class="result-lines">黑装：黑装自选箱 ×' + rw.blackBox + '</div>' : ''));
    modal('层数通关', '<div class="result-box"><div class="result-title win">第 ' + rw.layer + ' 层通关！</div>' +
      '<div class="result-lines">金松果 +' + rw.gold + '</div>' +
      (rw.drop ? '<p>获得 ' + esc(rw.drop.name) + ' ×' + rw.drop.count + '</p>' : '') +
      prizeLine + lostLine + blackLine +
      '<p class="small-label">层数 +1，下一层对手更强、松果更多。</p></div>',
      [{ label: '继续爬塔', cls: 'gold', run: openTower }, { label: '返回', run: () => C().home() }], { small: true });
    // 经验/升级提示走和战斗拾取同一套 UI（追加到上面这个弹窗里）
    if (rw.prizes && rw.prizes.ups && rw.prizes.ups.length && UI.classic && UI.classic.pickupResult) {
      UI.classic.pickupResult({ items: [], ups: rw.prizes.ups });
    }
  }
  /* 主塔失败：就地再战一次（免费），而且可以换一张 buff；想收手就「结束本层」拿 30% 安慰奖。 */
  function towerDefeat(rw) {
    modal('倒下在第 ' + (rw.battleNo || '?') + ' 场', '<div class="result-box"><div class="result-title lose">再接再厉</div>' +
      '<p>第 ' + rw.layer + ' 层第 ' + (rw.battleNo || '?') + '/' + (rw.battleCount || 4) + ' 场失败。</p>' +
      '<p class="gold-text">进度已保留：再战一次不用再花挑战书，也可以换一张增益。</p>' +
      '<div class="result-lines">收手的话，已累积的 ' + rw.potGold + ' 松果可换 30% 安慰奖</div></div>',
      [{ label: '再战一次', cls: 'gold', run: () => { if (rw.choices && rw.choices.length) offerChoice('tower', rw.choices); else fight('tower'); } },
       { label: '结束本层', cls: 'muted', run: () => {
          const out = Tower.giveUp('tower');
          modal('本层结束', '<p>安慰奖：金松果 +' + (out.consolation || 0) + '</p>',
            [{ label: '返回', cls: 'gold', run: () => C().home() }], { small: true });
        } },
       { label: '返回', run: () => C().home() }], { small: true });
  }
  /** 选取型 buff（神兵淬炼 / 秘技通神）：立即从已有武器或技能里三选一，选完立刻生效。 */
  /* ============================================================
   * 【U11】选取型强化弹窗 —— openPickBuff
   * ============================================================ */
  function openPickBuff(pending) {
    const cands = Tower.pickCandidates(pending.kind);
    const isPerm = pending.kind === 'permBuff';
    const isBrand = pending.kind === 'brandBuff';
    const isLimited = pending.kind === 'limitedBuff';
    const label = isPerm ? '永久增益' : isBrand ? '烙印' : isLimited ? '限次增益' : (pending.kind === 'skill' ? '技能' : '武器');
    /* 这一次附的是哪张铭文 —— 决定文案与「已附魔」标记的口径：
     *   · 虚空铭文 C37（免占位）：标记是「已附魔（虚空铭文·不占位）」；
     *   · 水晶铭文 C60（效果 ×1.5）：标记是「已附魔（水晶铭文 ×1.5）」。
     * 身份优先用发牌时写进 `pending.buffId` 的那张；老档没写时退回 Tower 的共用出口
     *（`activeInscriptionId` —— 与 pickCandidates / hasPickTargets 同一口径，免得标记和候选错位）。 */
    const inscriptionId = (isPerm && pending.buffId) || (isPerm ? Tower.activeInscriptionId('permBuff', null, pending) : null) || 'C37';
    const inscriptionName = (TowerData.BUFF_BY_ID[inscriptionId] || {}).name || '铭文';
    const inscriptionMul = isPerm ? Number(pending.mul) || 0 : 0;
    /* 【2026-10 第七十六批】「这一条已经吃过**这张**铭文了吗」必须按**铭文种类**判，
     * 不能一律看 `slotFree` —— 那是**虚空铭文自己的效果**。原来的写法是「凡是 slotFree 就标已附魔」，
     * 于是（用户实测）水晶铭文触发的三选一里，标出来的却是被虚空附魔过的那几条，
     * 而被水晶附魔过的反而没有任何标记。
     * 判据与 tower.js 的 `applyInscription` / `inscriptionEligible` 同一套：
     *   · 免占位类（虚空铭文 C37，`mods.pickPermanentFree`）→ 记在行上的 `slotFree`，
     *     **不写 `enchants`**（重复选同一条本来就是空操作）；
     *   · 倍率类（水晶铭文 C60，`mods.pickPermanentMul`）→ 记在行上的 `enchants`（铭文 id 数组）。 */
    const inscDef = TowerData.BUFF_BY_ID[inscriptionId] || {};
    const inscFreeKind = !!(inscDef.mods && inscDef.mods.pickPermanentFree);
    /** 这一条身上**已经有哪几张铭文**（用 id 表示；虚空记在 slotFree 上，其余记在 enchants 里）。 */
    const inscIdsOf = (c) => {
      const out = [];
      const ench = (c && Array.isArray(c.enchants)) ? c.enchants : [];
      if (c && c.slotFree === true && ench.indexOf('C37') < 0) out.push('C37');
      for (const id of ench) if (id && out.indexOf(id) < 0) out.push(id);
      return out;
    };
    /** 这一条是否已经吃过**这次要附的那张**铭文（吃过了再选没有额外收益）。 */
    const hasThisInsc = (c) => isPerm && (inscFreeKind
      ? (c.slotFree === true || inscIdsOf(c).indexOf(inscriptionId) >= 0)
      : inscIdsOf(c).indexOf(inscriptionId) >= 0);
    if (!cands.length) {
      /* 候选 0 个 —— **必须把 pendingPick 收走**（状态机那边已经尽量不挂它了，这里是第二道防线：
       * 老存档 / 目标刚被卖掉或碎掉）。不收走的话，每次回到这一屏都会重新弹这个空弹窗，
       * 玩家点不掉也走不了 = 永久卡死（用户实测）。 */
      Tower.deferPendingPick();
      notice('你还没有任何' + label + '可选，这次强化先替你留着（之后拿到' + label + '会自动弹出）。',
        [{ label: '知道了', cls: 'gold', run: () => openEndless() }]);
      return;
    }
    /* 「已经被附魔过」的要在三选一里标出来（用户口径）：
     * 它们已经不再占位 / 已经吃过这张铭文，再选一次没有额外收益 —— 标出来玩家才不会白选。 */
    /* 【任务2】逐条判定：同名多栏时，只有被附魔过的那**一条**才算「已附魔」。
     * 候选里带了 uid（见 pickCandidates），点击时把它交给 applyPickBuff。
     * 【2026-10 同名逐条】不再用 run.slotFreeIds 按 id 兜底 —— 那会把新拿到的同名件也标成已附魔。 */
    /* 【2026-10 第七十六批】判据见上面的 hasThisInsc()：**只标这一张铭文附魔过的**，
     * 别再拿 slotFree 一刀切（那是虚空铭文的效果）。 */
    const doneCount = isPerm ? cands.filter((c) => hasThisInsc(c)).length : 0;
    /* 按钮只写名字，副标题换行显示（modal 按钮是 esc() 输出，用 \n + white-space:pre-line 换行）。
     * 特殊技能（小宇宙爆发 / 绝对防御 / 龟甲术）不按 Lv 展示，而是按 pickCandidates 给的 note。
     * 【2026-10 第七十八批 用户口径】永久增益那一支要**极简**：已经附魔过的那条只写
     * 「×N 层 · 已附魔」，不要再跟括号（哪张铭文、什么效果）与「再选没有额外收益」这类解释；
     * 别的铭文强化过的那条也不再补「另有 …」，保持列表干净。 */
    const buttons = cands.map((c) => {
      const done = hasThisInsc(c);
      return {
        label: c.name + '\n' + (isPerm
          ? ('×' + (c.stacks || 1) + ' 层' + (done ? ' · 已附魔' : ''))
          : (isBrand ? ('×' + (c.stacks || 1) + ' 份（未破碎）' + (c.off ? ' · 已关闭' : ''))
            : (isLimited ? ('剩余 ' + (c.uses || 1) + ' 场 → +' + (Number(pending.addUses) || 5) + (c.off ? ' · 已关闭' : ''))
              : (c.note || ('Lv' + (c.level || 1)))))),
        cls: 'small pick-buff-btn' + (done ? ' pick-done' : ((pending.kind === 'skill' || isBrand) ? '' : ' gold')),
        run: () => {
          /* 永久增益 / 烙印 / 限次增益都走 uid（精确到那一条栏位）；技能 / 武器仍用 id。 */
          const byUid = (isPerm || isBrand || isLimited) && c.uid;
          const r = Tower.applyPickBuff(pending.kind, byUid ? c.uid : c.id);
          if (!r.ok) notice(r.msg || '强化失败。');
          openEndless();
        },
      };
    });
    const title = isPerm ? (inscriptionMul ? (inscriptionName + ' · 选一个永久增益') : '附魔 · 选一个永久增益')
      : isBrand ? (inscriptionName + ' · 选一个烙印')
        : isLimited ? (inscriptionName + ' · 选一个限次增益')
          : ('三选一 · ' + label + '强化');
    /* 【2026-10 第七十八批 用户口径】永久增益那一支的说明**大幅精简** ——
     * 只留一句「选中的这条会怎样」，候选行上的标记自己会说话。 */
    const body = isPerm
      ? (inscriptionMul
        ? '选一个永久增益：被选中的这一条本局效果 ×' + inscriptionMul + '。'
        : '选一个永久增益：被选中的这一条本局不再占用永久位。')
        + (doneCount ? '标着「已附魔」的再选没有收益。' : '')
      : isBrand ? '从下面这些烙印里选一个：它**立刻破碎**（同一烙印有几份就一起破碎；破碎是升级 —— 每份都变成全额并永久保留）。'
        : isLimited ? '从下面这些限次增益里选一个：它的**剩余场次 +' + (Number(pending.addUses) || 5) +
          '**（烙印类不参与：它们没有「场次」这个概念）。'
          : (pending.kind === 'skill'
            ? '从下面三个技能里选一个：主动技的触发概率大幅提升；防御技（绝对防御 / 龟甲术）另按被动触发概率加成；'
              + '小宇宙爆发则是「战斗开始后第一招必定放它」（本局有效）。'
            : '从下面三把武器里选一个：它的伤害 +100%（本局有效）。');
    modal(title, '<p>' + esc(body) + '</p>', buttons, { small: true });
  }
  /* ============================================================
   * 【U12】永久增益「满了换一个」 —— offerPermanentReplace / offerReplace
   * ============================================================ */
  const RARITY_SHORT = ['普通', '稀有', '史诗', '传奇'];
  /** 铭文附魔的**行内标记**（与 buffTag 的外框同一套数据口径）：虚空 = 不占位、水晶 = 效果 ×N。
   *  列表里（替换弹窗 / 出售列表 / 交换列表）原本只给虚空留了一句，水晶那条只画了框、
   *  在这些「挑一条丢掉」的列表上看不出它被 ×1.5 过 —— 这里补上，两边口径一致。
   *  ⚠ 位置有约束：`test-fixes-round.cjs` 的「需求38」按两个源码锚点切一段出来单独跑
   *  （从 RARITY_SHORT 那行切到「每 10 层的里程碑奖励」那行），这个函数得落在这一段里面 ——
   *  挪到 buffTag 旁边会让那段切片缺依赖，那条用例会直接红。 */
  function enchMark(b) {
    const free = !!(b && b.slotFree === true);
    const mul = Number(b && b.enchMul) || 1;
    return {
      free: free, mul: mul, crys: mul > 1,
      freeHtml: free ? '<b class="rp-free">虚空铭文 · 不占位</b>' : '',
      crysHtml: mul > 1 ? '<b class="rp-crys">水晶铭文 · 效果 ×' + mul + '</b>' : '',
      freeHint: free ? '<em class="slot-free-hint">虚空铭文 · 不占位</em>' : '',
      crysHint: mul > 1 ? '<em class="crystal-hint">水晶铭文 · 效果 ×' + mul + '</em>' : '',
    };
  }
  /** 永久增益替换弹窗：onPick(entry) 执行实际替换，onCancel() 返回。 */
  function offerPermanentReplace(opts) {
    const o = opts || {};
    /* 与面板同一口径：附魔（不占位）的排在前面（按每条自己的 slotFree）。 */
    const list = orderPermanent(Tower.ownedBuffs('endless').filter((b) => b.kind === 'permanent'));
    if (!list.length) { notice('没有可以拿掉的永久增益。'); if (o.onCancel) o.onCancel(); return null; }
    const rows = list.map((b, i) => {
      const em = enchMark(b);
      return '<button type="button" class="replace-pick r' + b.rarity + '" data-action="rp' + i + '"' +
        ' title="' + esc(b.name + '：' + (b.desc || '')) + '">' +
        '<span class="rp-name">' + esc(b.name) + '</span>' +
        '<span class="rp-meta">' + (RARITY_SHORT[b.rarity] || '') +
          (b.stacks > 1 ? ' · ×' + b.stacks + ' 层' : '') +
          (em.free ? ' · ' + em.freeHtml : '') +
          (em.crys ? ' · ' + em.crysHtml : '') + '</span>' +
        '<span class="rp-desc">' + esc(b.desc || '') + '</span>' +
        '</button>';
    }).join('');
    const m = modal(o.title || '永久增益已满',
      '<p>' + o.prompt + '</p>' +
      '<div class="replace-pick-list">' + rows + '</div>' +
      '<p class="small-label">点一行把它拿掉' + (o.footNote ? '　·　' + o.footNote : '') + '</p>',
      [{ label: '取消', cls: 'muted', run: () => { if (o.onCancel) o.onCancel(); } }], { small: true });
    /* 行不在 .modal-buttons 里，所以这里自己挂点击（modal 已把 wrap 加进 DOM）。 */
    if (m && m.element) {
      const actions = {};
      list.forEach((b, i) => { actions['rp' + i] = () => { m.close(); o.onPick(b); }; });
      C().bind(m.element, actions);
    }
    return m;
  }
  /* ============================================================
   * 【U12b】「巡逻」收缴（2026-10 第六十二批；第七十七批去掉翻页）
   *   openPatrolToll    —— 挑一个**本局当前在生效的最高稀有度**条目交出去
   *   openPatrolDiscard —— 交出虚空铭文后永久位溢出，再丢一个
   * 两个列表都**不再分页**（用户口径：去掉右下角的左右翻页，自然上下滚动即可），
   * 用与「替换永久增益」同一套 `.replace-pick-list`（自带 max-height + overflow-y:auto）。
   * ============================================================ */
  /** 收缴列表的一行。`idx` 是它在整份列表（不分页）里的下标，点击时按 `data-action="pt<idx>"` 回传。 */
  function patrolRowHtml(c, idx) {
    /* 附魔状态也要标（与替换弹窗同一套标记）：这是「挑一条交出去」的列表，
     * 玩家得看得出哪一条被铭文强化过，别把 ×1.5 的那条交掉。 */
    const em = enchMark(c);
    /* 三类的副标题不一样：背包里的行 / 只剩已损毁层的烙印 / 已附魔成功的铭文。 */
    const cat = c.cat === 'insc' ? '铭文'
      : (c.kind === 'limited' ? '限次' : '永久');
    const bits = [RARITY_SHORT[c.rarity] || '', cat];
    if (c.cat === 'insc') {
      bits.push('已附魔 ' + Math.max(1, Number(c.alive) || 1) + ' 条');
    } else if (c.cat === 'brand') {
      bits.push('已损毁 ×' + Math.max(1, Number(c.broken) || 1) + '（交出掉 1 层）');
    } else {
      if (c.stacks > 1) bits.push('×' + c.stacks + ' 层' + (Number(c.broken) > 0 ? '（含已损毁 ' + c.broken + '）' : '') + '（只掉 1 层）');
      if (em.free) bits.push(em.freeHtml);
      if (em.crys) bits.push(em.crysHtml);
    }
    return '<button type="button" class="replace-pick r' + c.rarity + '" data-action="pt' + idx + '"' +
      ' title="' + esc(c.name + '（' + bits.filter((x) => x && x.indexOf('<') < 0).join('·') + '）') + '">' +
      '<span class="rp-name">' + esc(c.name) + '</span>' +
      '<span class="rp-meta">' + bits.join(' · ') + '</span>' +
      '</button>';
  }
  /** 收缴弹窗的列表主体（不分页 —— 整份列表一次画完，靠上下滚动看）。 */
  function patrolListHtml(list) {
    return '<div class="replace-pick-list">' + list.map((c, i) => patrolRowHtml(c, i)).join('') + '</div>';
  }
  function openPatrolToll() {
    const info = Tower.endlessInfo();
    const run = info && info.run;
    const got = Tower.patrolTollCandidates();
    if (!got || !got.list.length) {       // 没有可交的（理论上不会）：直接放过
      Tower.finishPatrolToll();
      openEndless();
      return null;
    }
    const draw = () => {
      const body = '<p>巡逻失手 —— 交出一个<b>' + (RARITY_SHORT[got.top] || '') + '</b>增益' +
        patrolListHtml(got.list);
      const m = modal('巡逻 · 上交一个增益', body, [{ label: '稍后再说', cls: 'muted', run: () => openEndless() }], { small: true });
      if (!m || !m.element) return;
      const actions = {};
      got.list.forEach((c, idx) => {
        actions['pt' + idx] = () => {
          const r = Tower.payPatrolToll(c.ref);
          if (!r.ok) { notice(r.msg || '上交失败。'); return; }
          m.close();
          if (r.needDiscard) { openPatrolDiscard(); return; }
          Tower.finishPatrolToll();
          /* 交出不同东西的效果不一样，提示也分开写，玩家才知道自己到底损失了什么。 */
          const what = c.cat === 'insc' ? '（随机取消一份附魔）'
            : (r.broken ? '（已损毁层 -1' + (r.backToPool ? '，并退回增益池' : '') + '）'
              : (r.removed ? '（整栏交出）' : '（掉 1 层）'));
          notice('【' + (r.name || '增益') + '】已上交' + what + '，继续巡逻。',
            [{ label: '继续', cls: 'gold', run: () => openEndless() }]);
        };
      });
      C().bind(m.element, actions);
    };
    draw();
    return run;
  }
  function openPatrolDiscard() {
    const list = orderPermanent(Tower.ownedBuffs('endless').filter((b) => b.kind === 'permanent'));
    if (!list.length) { Tower.finishPatrolToll(); openEndless(); return null; }
    const draw = () => {
      const rows = list.map((b, i) => {
        const em = enchMark(b);
        return '<button type="button" class="replace-pick r' + b.rarity + '" data-action="pd' + i + '"' +
          ' title="' + esc(b.name + '：' + (b.desc || '')) + '">' +
          '<span class="rp-name">' + esc(b.name) + '</span>' +
          '<span class="rp-meta">' + (RARITY_SHORT[b.rarity] || '') + (b.stacks > 1 ? ' · ×' + b.stacks + ' 层' : '') +
            (em.free ? ' · ' + em.freeHtml : '') + (em.crys ? ' · ' + em.crysHtml : '') + '</span>' +
          '<span class="rp-desc">' + esc(b.desc || '') + '</span></button>';
      }).join('');
      const m = modal('背包满了 · 丢一个',
        '<p>虚空铭文被收走了，它的「不占位」也随之失效 —— 永久位装不下了，丢掉一个：</p>' +
        '<div class="replace-pick-list">' + rows + '</div>', [{ label: '稍后再说', cls: 'muted', run: () => openEndless() }], { small: true });
      if (!m || !m.element) return;
      const actions = {};
      list.forEach((b, i) => {
        actions['pd' + i] = () => {
          const r = Tower.debugLoseBuff(b.uid);
          m.close();
          Tower.finishPatrolToll();
          notice('丢掉了【' + b.name + '】' + (r && r.ok ? '' : '（失败）'), [{ label: '继续', cls: 'gold', run: () => openEndless() }]);
        };
      });
      C().bind(m.element, actions);
    };
    draw();
    return null;
  }

  function offerShopReplace(index, buff) {
    offerPermanentReplace({
      prompt: '要买下【' + esc(buff.name) + '】，先拿掉下面哪一个？',
      footNote: '被换掉的那个会从构筑里移除（成长类增益的累计也一起清零）',
      onPick: (b) => {
        const r = Tower.buyShopSlot(index, rowRef(b));
        if (!r.ok) notice(r.msg || '买不了。');
        openShop(true);
      },
      onCancel: () => openShop(true),
    });
  }
  /** 永久增益满格时（休整点选择）—— 选一个拿掉再收下新的。 */
  function offerReplace(index, buff) {
    offerPermanentReplace({
      prompt: '要拿下【' + esc(buff.name) + '】，先拿掉下面哪一个？',
      footNote: '被换掉的那个会从构筑里移除（成长类增益的累计也一起清零）',
      onPick: (b) => { Tower.pickChoice('endless', index, rowRef(b)); openEndless(); },
      onCancel: () => openEndless(),
    });
  }
  /** 每 10 层的里程碑奖励（技能卷轴×10 / 武器卷轴×10 / 随机药丸）。 */
  /* ============================================================
   * 【U13】无尽：里程碑 · 重试 · 战败结算 —— milestoneModal / endlessDefeat
   * ============================================================ */
  function milestoneModal(rw, next) {
    const m = rw.milestone;
    const icon = C().icon ? C().icon('prop', m.propId) : '';
    const blackLine = (!State.blackGearEnabled() || !rw.black)
      ? ''
      : (rw.black.gain
        ? '<div class="result-lines">黑装：黑色卡片 ×' + rw.black.gain + '（本周剩 ' + rw.black.left + '/' + rw.black.cap + '）</div>'
        : '<div class="result-lines">黑装：本周黑色卡片已达上限（' + rw.black.cap + '/' + rw.black.cap + '）</div>');
    modal('第 ' + rw.layer + ' 层 · 里程碑奖励', '<div class="result-box"><div class="result-title win">再进一步</div>' +
      '<p>你爬到了第 ' + rw.layer + ' 层，结算奖励随机抽取：</p>' +
      '<p class="milestone-reward">' + icon + '<b>' + esc(m.name) + '</b> ×' + m.count + '</p>' +
      blackLine +
      '<div class="result-lines">已放入背包（每 10 层一次）</div></div>',
      [{ label: '继续', cls: 'gold', run: next }], { small: true });
  }
  function endlessRetryOffer(rw) {
    modal('本场失利 · 可以重新挑战',
      '<div class="result-box"><div class="result-title lose">再试一次？</div>' +
      '<p>倒在第 ' + rw.layer + ' 层第 ' + (rw.battleNo || '?') + '/' + (rw.battleCount || 4) + ' 场。</p>' +
      '<p class="gold-text">消耗 1 枚铸币，回滚到本场开始前（血量 / 试炼币 / 分数 / 增益次数全部还原），再打一次。</p>' +
      '<div class="result-lines">现有铸币 <b>' + (rw.retryLeft || 0) + '</b> 枚 · 本局分数 ' + rw.score +
      ' · 选「放弃本局」也一样按当前层应得 + 试炼币折现结算</div></div>',
      [{ label: '重新挑战', cls: 'gold', run: () => {
          const r = Tower.retryBattle();
          if (!r.ok) { notice(r.msg || '回滚失败。'); endlessDefeat(rw); return; }
          reopen('endless');
          fight('endless');
        } },
       { label: '放弃本局', cls: 'muted', run: () => {
          const out = Tower.declineRetry();
          endlessDefeat(out);
        } }], { small: true });
  }
  function endlessDefeat(rw) {
    settleResult(rw);
  }

  /* ============================================================
   * 【U14】无尽：试炼币商店 —— openShop
   * ============================================================ */

  /** 商店里「消费型」增益的提示（挥金如土 C36 / 豪掷千金 C58）。
   *  买货架、买铸币、刷新货架**三条路都是消费**，提示口径必须一致 ——
   *  2026-10 第八十一批用户反馈「买铸币好像不触发」：机制其实一直在算，只是界面从没说过。 */
  function shopSpendToast(spend) {
    if (!spend) return;
    const got = spend.limited;
    if (got && got.length) {
      runToast('豪掷千金：获得「' + got.map((id) => (TowerData.BUFF_BY_ID[id] || {}).name || id).join('」「') + '」');
    }
    const gained = spend.gained;
    if (gained && gained.length) {
      const mm = (TowerData.BUFF_BY_ID.C36 || {}).mods || {};
      const add = { power: 0, agility: 0, speed: 0, hp: 0 };
      for (const k of gained) {
        if (add[k] === undefined) continue;
        add[k] += (k === 'hp' ? Number(mm.shopSpendHp) || 5 : Number(mm.shopSpendStat) || 1);
      }
      const label = { power: '力量', agility: '敏捷', speed: '速度', hp: '生命上限' };
      const txt = ['power', 'agility', 'speed', 'hp'].filter((k) => add[k] > 0)
        .map((k) => label[k] + ' +' + add[k]).join('、');
      if (txt) runToast('挥金如土：' + txt);
    }
  }
  function openShop(revisit) {
    const shop = Tower.shopState();
    if (!shop) { notice('商店还没开张：每通过 5 层开放一次。'); return; }
    /* 铸币商店与试炼商店共用 run.shop，但界面完全两套（铸币交易 + 免费交换）—— 在这里分流。 */
    if (shop.mint) { openMintShop(); return; }
    /* 门庭若市（C59）：进门就给试炼币 —— 由 Tower 领取并清零，保证只飘一次字
     *（shopState() 是快照，往它上面写标记不会生效）。 */
    const enterCoins = Tower.claimShopEnterCoins ? Tower.claimShopEnterCoins() : 0;
    if (enterCoins > 0) runToast('门庭若市：进店获得 ' + enterCoins + ' 试炼币');
    const rarityCls = (r) => 'r' + r;
    /* 注意：这是**商店槽位上报行**的字段 canStack（由 tower.js 用标签算好），
     * 不是增益数据里的字段 —— 旧数据字段 stackable 已经删掉、只留标签。 */
    const stackableOwned = (s) => s.ownedStacks > 0 && s.canStack;
    const slots = shop.slots.map((s, i) =>
      '<div class="shop-slot ' + rarityCls(s.rarity) + (s.sold ? ' sold' : '') +
        (stackableOwned(s) ? ' owned-stack' : '') + (s.half ? ' half' : '') + '"><b>' + esc(s.name) + '</b>' +
      '<i>' + RARITY[s.rarity] + ' · ' + (SCOPE[s.kind] || '增益') + '</i><span>' + esc(s.desc) + '</span>' +
      (s.half ? '<em class="half-hint">讨价还价 · 对折（原价 ' + s.listPrice + ' 币）</em>' : '') +
      (stackableOwned(s) ? '<em class="stack-hint">已有 ×' + s.ownedStacks + ' · 可叠层</em>' : '') +
      (s.sold ? '<em>已购入</em>' : C().btn(s.price + ' 币', 'buy' + i, 'small gold')) + '</div>').join('');
    /* 出售列表：**按获得先后倒序**（最新拿到的在最上，点开就能卖），被虚空铭文附魔（不占位）
     * 的一律沉到最后 —— 排序在 Tower.sellListOf 里（跨永久/限次混排），这里只负责渲染。 */
    const owned = Tower.sellListOf('endless');
    const sellRows = owned.length ? owned.map((b) =>
      '<div class="shop-sell-row' + (b.slotFree ? ' slot-free' : '') + '">' + buffTag(b, b.stacks) +
      enchMark(b).freeHint + enchMark(b).crysHint +
      C().btn('卖出 +' + b.sellPrice, 'sell' + rowRef(b), 'tiny muted') + '</div>').join('') :
      '<div class="small-label">还没有可出售的增益</div>';
    const content = '<div class="tower-shop">' +
      '<h2 class="tower-title">试炼商店 <span class="shop-coins">试炼币 ' + shop.coins + '</span></h2>' +
      /* 【100 层循环】这一页几件是**按层分档**的（1-20 层 5 件 / 21-40 层 4 件 / 41-100 层 3 件，
       * 101 层回到 5 件）—— 写出来玩家才知道「深层商店变小了」是规则不是 bug。 */
      shopTierHint(shop.layer, shop.slots.length) +
      '<div class="shop-shelf">' + slots + '</div>' +
      '<div class="shop-extra">' +
      '<div class="shop-slot retry' + (shop.retrySold ? ' sold' : '') + '"><b>铸币</b>' +
      '<i>每次商店限购 1 枚 · 已有 ' + shop.retryToken + ' 枚</i>' +
      '<span>失败时消耗 1 枚，回滚到该场战斗开始前再打一次</span>' +
      (shop.retrySold ? '<em>已购买</em>' : C().btn(shop.retryPrice + ' 币', 'retry', 'small gold')) + '</div>' +
      '<div class="shop-slot reroll"><b>刷新货架</b>' +
      '<i>第 ' + (shop.rerollCount + 1) + ' 次刷新 · ' +
      /* 2026-10：价格**不再封顶**（70 档 10 次 → 80 → 90…），所以这里永远是「下次更贵」；
       * 真正会封顶的是**收益**（稀有度倾斜到 rerollTiltCap 那一档），下面那段文案负责说明。 */
      (shop.rerollFree ? '本次免费' : '本次 ' + shop.rerollNextPrice + ' 币，下次更贵') + '</i>' +
      '<span>' + (function () {
        /* 传 run：把「时来运转」（E12）的刷新提速反映到期望数字上。 */
        const liveRun = (Tower.endlessInfo() || {}).run || null;
        const shelf = Math.max(1, shop.slots.length);
        const now = TowerData.rerollExpectation(shop.rerollFree ? 0 : shop.rerollNextPrice, liveRun, shelf);
        const nextPaid = shop.rerollFree ? shop.rerollNextPrice : TowerData.rerollPriceAt(shop.rerollCount + 1);
        const nxt = TowerData.rerollExpectation(nextPaid, liveRun, shelf);
        const f = (v) => (Math.round(v * 100) / 100).toFixed(2);
        const speed = now.tiltRateMul > 1 ? '（时来运转：提速 ×' + now.tiltRateMul + '）' : '';
        /* 稀有度收益在 rerollTiltCap（50）那一档封顶：**价格会一直涨**（70→80→90…），
         * 但期望不再变好。界面上要写清楚，别让玩家以为「再加钱就会更好」。 */
        const cap = Math.max(0, Number((TowerData.SHOP || {}).rerollTiltCap) || 0);
        const tiltCapped = TowerData.rerollQualityCapped
          ? TowerData.rerollQualityCapped(shop.rerollCount + 1)
          : (cap > 0 && now.tilt >= nxt.tilt - 1e-9);
        return '越贵越好：本次期望史诗 ' + f(now.epics) + ' 件、传奇 ' + f(now.weights[3] * Math.max(1, shop.slots.length)) +
          ' 件' + speed + '；' + ((!shop.rerollFree && tiltCapped)
            ? '已到收益上限，期望不再提高（' + (cap > 0 ? cap + ' 币那一档封顶' : '最高价') + '，但价格还会继续涨）'
            : '下次（' + nextPaid + ' 币）期望史诗 ' + f(nxt.epics) + ' 件') +
          '。已售出的不会再出现；**限次增益可以重复刷出**（再拿一份就是场次叠加）' +
          /* 讨价还价（E14）：刷新出的每一页都会重新打折，写清件数免得玩家以为只有第一页。 */
          (shop.halfPerPage > 0 ? '。讨价还价：每次刷新出的新一页同样有 ' + shop.halfPerPage + ' 件对折' : '');
      })() + '</span>' +
      C().btn(shop.rerollFree ? '免费刷新' : shop.rerollNextPrice + ' 币刷新', 'reroll', 'small') + '</div></div>' +
      '<h4>出售增益（回收 40%，限次与永久都可卖）</h4>' +
      '<div class="shop-sell">' + sellRows + '</div>' +
      '</div>';
    const ct = classicTower();
    const p = C().page('challenge', 'stages', content, Object.assign({
      cls: 'tower-board',
      left: (!revisit && !shop.rest)
        ? '<span class="footer-left">' + C().btn('结算离场', 'settle', 'small gold') + '</span>' : '',
      right: '<span class="footer-right">' + C().btn(revisit || shop.rest ? '返回' : '继续挑战', 'leave', 'gold') + '</span>',
    }, ct ? { noTabs: true, pageClass: 'classic-tower', homeLabel: '返回' } : {}));
    back(p, () => openEndless(), '返回');
    /* 商店是无尽塔里的二级页：底色调跟着本层走，别在纯色塔页里突然露出村庄底图。 */
    if (ct) applyClassicTowerBg(p, 'endless', shop.layer);
    shop.slots.forEach((s, i) => on(p, 'buy' + i, () => {
      const r = Tower.buyShopSlot(i);
      if (r && r.needsReplace) { offerShopReplace(i, r.buff); return; }
      if (!r.ok) { notice(r.msg || '买不了。'); return; }
      shopSpendToast(r.shopSpend);
      openShop(revisit);
    }));
    on(p, 'retry', () => {
      const r = Tower.buyRetryToken();
      if (!r.ok) notice(r.msg || '买不了。');
      else {
        notice('已购买铸币（现有 ' + r.left + ' 枚）。失败时可以选择回滚本场再打一次。');
        shopSpendToast(r.shopSpend);
      }
      openShop(revisit);
    });
    on(p, 'reroll', () => {
      const r = Tower.rerollShop();
      if (!r.ok) notice(r.msg || '刷新失败。');
      else {
        if (r.paid > 0) notice('已花 ' + r.paid + ' 币刷新，本页期望史诗 ' + (r.expect ? r.expect.epics.toFixed(2) : '?') +
          ' 件 · 下次 ' + r.nextPrice + ' 币' + (r.nextPrice === r.paid ? '（已到最高价）' : ''));
        shopSpendToast(r.shopSpend);
      }
      openShop(revisit);
    });
    owned.forEach((b) => on(p, 'sell' + rowRef(b), () => { Tower.sellBuff(rowRef(b)); openShop(revisit); }));
    on(p, 'leave', () => {
      /* 休整商店 / 战后立即进货（E01）/ 立即开店 —— 关掉后回去继续打这一层；
       * 只有「每 5 层」的结算商店才去结算点。判据由 Tower 给（shopState 里的标记），
       * 界面不再自己猜层数。
       * **必须真的把店关掉**（Tower.closeShop / continueFromShop 都会收摊）：
       * 原来这一支只 openEndless() 而没有关店，phase 还停在 'shop' →
       * 首页按钮继续写「进入试炼商店」→ 玩家点了又进同一家店，看着就像「离不开商店」
       * （用户报的 bug）。 */
      if (revisit || shop.rest || shop.postBattle || !shop.boundary) {
        Tower.closeShop();
        openEndless();
        return;
      }
      Tower.continueFromShop();       // 直接进下一段，不弹结算点窗口
      openEndless();
    });
    bindShopSettle(p);
  }

  /** 商店页的「结算离场」按钮：试炼商店（每 5 层结算商店 / 休整店）与**顶掉结算商店的
   *  铸币商店**共用这一份 —— 后者本来就站在结算点上，不给离场等于把这一段的结算机会吞掉。 */
  function bindShopSettle(p) {
    on(p, 'settle', () => {
      const out = Tower.settleFromShop();
      if (!out || !out.ok) { notice('现在还不能结算。'); return; }
      settleResult(out);
    });
  }

  /* ============================================================
   * 【U14b】无尽：铸币商店（战后 5% 随机小店） —— openMintShop
   *
   * 规则（用户口径）：5 层之后的 x2/x3/x4 与 x7/x8/x9 层，每场战斗结束后 5% 概率刷出；
   * 同一组连续三层最多刷出一次。店里**花铸币买一件**（价格按稀有度固定 0/1/2/3）
   * 或者**免费拿自己的一件增益换一件**，二者做成其一店就消失（也可以直接送客）。
   * 免费刷新一次货架，刷新之后就不能再交换了。
   * ============================================================ */

  /** 铸币商店：买下 / 换完之后的事（店已经收摊）。 */
  function afterMintAction(text, r) {
    openEndless();                                    // 先把首页重绘好（店没了）
    runToast(text);
    if (r && r.pendingPick) openPickBuff(r.pendingPick);   // 选取型（神兵淬炼等）接着做三选一
  }
  /** 永久增益满格时在铸币商店买东西：先选一个拿掉（与试炼商店同一套替换弹窗）。 */
  function offerMintReplace(index, buff) {
    offerPermanentReplace({
      prompt: '要买下【' + esc(buff.name) + '】，先拿掉下面哪一个？',
      footNote: '被换掉的那个会从构筑里移除（成长类增益的累计也一起清零）',
      onPick: (b) => {
        const r = Tower.buyMintSlot(index, b.id);
        if (!r.ok) { notice(r.msg || '买不了。'); openMintShop(); return; }
        afterMintAction('买下了【' + r.buff.name + '】（铸币 −' + r.price + '）', r);
      },
      onCancel: () => openMintShop(),
    });
  }
  /** 免费交换的确认：换回什么是**当场摇**的，所以这里只确认「要不要拿它去换」。 */
  function confirmMintSwap(b) {
    modal('免费交换', '<p>把【' + esc(b.name) + '】（' + (RARITY[b.rarity] || '') + '）拿出去，换回一件新的？</p>' +
      '<p class="small-label">大概率换回**同稀有度的运营类**增益（普通件有 50% 升成稀有件），' +
      '小概率换回同稀有度的非运营增益。换完之后这家铸币商店立刻就走。</p>',
      [{ label: '再想想', cls: 'muted', run: () => openMintShop() },
       { label: '交换', cls: 'gold', run: () => {
         const r = Tower.swapMintBuff(rowRef(b));
         if (!r.ok) { notice(r.msg || '换不了。'); openMintShop(); return; }
         openEndless();                              // 店已收摊 → 先把首页重绘好
         modal('交换成功', '<div class="result-box"><div class="result-title win">换到了</div>' +
           '<p class="dim">拿出去：' + esc(r.fromName) + '（' + (RARITY[r.fromRarity] || '') + '）</p>' +
           '<p>换回：<b class="q' + (r.buff.rarity || 0) + '">' + esc(r.buff.name) + '</b>' +
           '（' + (RARITY[r.buff.rarity] || '') + (TowerData.hasTag(r.buff, 'ops') ? ' · 运营类' : '') + '）</p>' +
           '<p class="small-label">' + esc(TowerData.descOf(r.buff, 'endless')) + '</p></div>',
           [{ label: '继续冲塔', cls: 'gold', run: () => { if (r.pendingPick) openPickBuff(r.pendingPick); } }], { small: true });
       } }], { small: true });
  }
  function openMintShop(flash) {
    const shop = Tower.shopState();
    if (!shop || !shop.mint) { openEndless(); return; }
    /* 门庭若市（C59）：铸币商店**同样算一次进店**（用户口径），进门就发试炼币。
     * 与试炼商店同一套领取口径 —— 由 Tower 领一次并清零，界面只飘一次字。 */
    const enterCoins = Tower.claimShopEnterCoins ? Tower.claimShopEnterCoins() : 0;
    if (enterCoins > 0) runToast('门庭若市：进店获得 ' + enterCoins + ' 试炼币');
    const rarityCls = (r) => 'r' + r;
    const slots = shop.slots.map((s, i) =>
      '<div class="shop-slot ' + rarityCls(s.rarity) + (s.ops ? ' ops' : '') + (s.sold ? ' sold' : '') + (s.half ? ' half' : '') + '">' +
      '<b>' + esc(s.name) + '</b>' +
      '<i>' + (RARITY[s.rarity] || '') + ' · ' + (SCOPE[s.kind] || '增益') + (s.ops ? ' · 运营' : '') + '</i>' +
      '<span>' + esc(s.desc) + '</span>' +
      (s.half ? '<em class="half-hint">讨价还价 · 对折（原价 ' + s.listPrice + ' 铸币）</em>' : '') +
      (s.sold ? '<em>已购入</em>'
        : C().btn(s.price > 0 ? (s.price + ' 铸币') : '免费拿走', 'mintbuy' + i, 'small gold')) + '</div>').join('');
    /* 交换列表用与出售列表同一套排序（最新拿到的在最上、附魔不占位沉最后）：都是「挑自己的一条增益」。 */
    const owned = Tower.sellListOf('endless');
    const swapOpen = !!shop.swapAllowed;
    const swapRows = owned.length ? owned.map((b) =>
      '<div class="shop-sell-row' + (b.slotFree ? ' slot-free' : '') + '">' + buffTag(b, b.stacks) +
      enchMark(b).freeHint + enchMark(b).crysHint +
      (swapOpen ? C().btn('拿它交换', 'mintswap' + rowRef(b), 'tiny')
        : '<em class="mint-locked">已刷新 · 不可交换</em>') + '</div>').join('')
      : '<div class="small-label">还没有可以交换的永久 / 限次增益</div>';
    const content = '<div class="tower-shop mint">' +
      '<h2 class="tower-title">铸币商店 <span class="shop-coins">铸币 ' + shop.retryToken + '</span>' +
        '<span class="mint-coins">试炼币 ' + Math.max(0, Math.floor(Number(shop.coins) || 0)) + '</span></h2>' +
      '<p class="mint-lead">战后偶遇的流动商人：<b>花铸币买走一件</b>，或者<b>拿自己的一件增益免费换一件</b> —— ' +
        '做成其中任何一件，他立刻就走（也可以直接送客）。</p>' +
      /* E16「铸币商队」触发的那一家：写清来由（限次 1，用完这家店就没了） */
      (shop.byBuff ? '<p class="mint-flash">限次增益「铸币商队」触发的商队' +
        (shop.boundary ? '：它顶掉了这一段的结算商店，送客后照旧前往结算点' : '') + '。</p>' : '') +
      (flash ? '<p class="mint-flash">' + esc(flash) + '</p>' : '') +
      /* 【100 层循环】铸币商店的货架件数是固定的（整百层又整层不开店），
       * 这里只说明它与试炼商店的分档不同，免得玩家以为「这家店没变小」是 bug。 */
      '<p class="shop-tier">铸币商店货架固定 <b>' + Math.max(1, Number((TowerData.MINT_SHOP || {}).shelf) || 5) +
        '</b> 件（不吃试炼商店的按层分档）</p>' +
      '<div class="shop-shelf">' + slots + '</div>' +
      '<div class="shop-extra">' +
      '<div class="shop-slot reroll' + (shop.rerollFree ? '' : ' sold') + '"><b>刷新货架</b>' +
      '<i>' + (shop.rerollFree ? '免费刷新 · 还剩 1 次' : '免费刷新已用掉') + '</i>' +
      '<span>' + (shop.rerollFree
        ? '重新摇一车货（稀有度分布不变，普通档概率依旧被压低）。<b>刷新之后就不能再用「免费交换」了。</b>'
        : '这支商队不再接受交换，只能挑货或送客。') +
        (shop.halfPerPage > 0 ? '<b>讨价还价：新一页同样有 ' + shop.halfPerPage + ' 件对折。</b>' : '') + '</span>' +
      (shop.rerollFree ? C().btn('免费刷新', 'mintreroll', 'small') : '<em>已刷新</em>') + '</div>' +
      '<div class="shop-slot price"><b>价格表</b><i>按稀有度固定 · 不吃折扣</i>' +
      '<span>普通 ' + shop.mintPrices[0] + ' / 稀有 ' + shop.mintPrices[1] + ' / 史诗 ' + shop.mintPrices[2] +
        ' / 传奇 ' + shop.mintPrices[3] + ' 铸币。' +
        '铸币可在试炼商店左下角用 50 试炼币换取1。</span></div>' +
      '</div>' +
      '<h4>' + (swapOpen ? '等价交换：失去一件，得到一件' : '免费交换已不可用（货架刷新过了）') + '</h4>' +
      '<p class="small-label">大概率换回同稀有度的<b>运营类</b>增益（普通件有 50% 升成稀有件），' +
        '小概率换回同稀有度的非运营增益，永久与限次都能进行交换。</p>' +
      '<div class="shop-sell">' + swapRows + '</div>' +
      '</div>';
    /* boundary（E16「铸币商队」顶掉了每 5 层的结算商店）：它站在结算点上，
     * 所以补回试炼商店那一枚「结算离场」；普通铸币商店（层中偶遇）照旧没有。 */
    const ct = classicTower();
    const p = C().page('challenge', 'stages', content, Object.assign({ cls: 'tower-board',
      left: shop.boundary
        ? '<span class="footer-left">' + C().btn('结算离场', 'settle', 'small gold') + '</span>' : '',
      right: '<span class="footer-right">' + C().btn('继续战斗', 'mintleave', 'gold') + '</span>' },
    ct ? { noTabs: true, pageClass: 'classic-tower', homeLabel: '返回' } : {}));
    bindTips(p);
    /* 页脚「返回」= **只是回上一页，店不收摊**（用户口径）：回到无尽首页后按钮仍写「进入铸币商店」，
     * 想好了再进来买/换/刷新都行。真正让这家店消失的只有三件事：
     * 完成一次购买、完成一次交换、或者点这里的「继续战斗」。 */
    back(p, () => openEndless(), '返回');
    if (ct) applyClassicTowerBg(p, 'endless', shop.layer);
    if (shop.boundary) bindShopSettle(p);
    shop.slots.forEach((s, i) => on(p, 'mintbuy' + i, () => {
      const r = Tower.buyMintSlot(i);
      if (r && r.needsReplace) { offerMintReplace(i, r.buff); return; }
      if (!r.ok) { notice(r.msg || '买不了。'); return; }
      afterMintAction('买下了【' + r.buff.name + '】（铸币 −' + r.price + '，剩 ' + r.left + ' 枚）', r);
    }));
    on(p, 'mintreroll', () => {
      const r = Tower.rerollMintShop();
      if (!r.ok) { notice(r.msg || '刷新失败。'); return; }
      openMintShop('货架换了一批 —— 这支商队不再接受交换了。');
    });
    owned.forEach((b) => on(p, 'mintswap' + rowRef(b), () => confirmMintSwap(b)));
    /* 「继续战斗」：这家店到此为止（收摊）→ 回首页继续打。 */
    on(p, 'mintleave', () => { Tower.leaveMintShop(); openEndless(); });
  }

  /* ============================================================
   * 【U15】无尽：永久牺牲（20 起每 10 层放弃一个永久增益） —— openPermSacrifice
   * ============================================================ */

  function openPermSacrifice() {
    const info = Tower.endlessInfo();
    const run = info.run;
    if (!run || run.phase !== 'sacrifice') return;
    const candsAll = Tower.sacrificeCandidatesOf();
    if (!candsAll.length) { openEndless(); return; }
    /* 与面板 / 替换弹窗同一口径：附魔（不占位）的排在前面。 */
    const cands = orderPermanent(candsAll);
    const rows = cands.map((x) => {
      const b = x.buff;
      const stack = x.stacks > 1 ? ' <em class="sac-stack">×' + x.stacks + '</em>' : '';
      return '<button class="sac-card" data-sac="' + esc(rowRef(x)) + '">' +
        '<b class="q' + (b.rarity || 0) + '">' + esc(b.name) + '</b>' + stack +
        '<span class="sac-desc">' + esc(b.desc || '') + '</span></button>';
    }).join('');
    const p = modal('放弃一个永久增益',
      '<p class="sac-lead">你必须从随身藏品中选出一件，投入贡井。</p>' +
      '<p class="sac-lead dim">第 ' + esc(run.layer) + ' 层已通过。作为代价，必须永久放弃<b>一个</b>永久增益' +
      '（叠层的会先掉一层）。选中的增益会立刻从本局移除。</p>' +
      '<div class="sac-grid">' + rows + '</div>',
      [], { small: false, cls: 'sac-board' });
    p.element.querySelectorAll('[data-sac]').forEach((el) => {
      el.onclick = () => {
        const res = Tower.sacrificePerm(el.dataset.sac);
        if (!res.ok) { notice(res.msg || '放弃失败'); return; }
        p.close();
        if (res.lostMark) notice('碎掉的烙印失效：' + res.lostMark.label);
        openEndless();
      };
    });
  }

  /* ============================================================
   * 【U16】无尽：结算点与结算 —— openCheckpoint / settleResult
   * ============================================================ */

  function openCheckpoint() {
    const info = Tower.checkpointInfo();
    if (!info) { openEndless(); return; }
    modal('结算点 · 第 ' + info.layer + ' 层', '<div class="checkpoint-box">' +
      '<div class="checkpoint-option"><b>结算离场</b><span>立刻领取 <b class="gold-text">' + info.ticketsNowTotal + '</b> 张抽奖卷' +
        '（本层应得 ' + info.ticketsNow +
        (info.retryToken ? ' + 铸币 ' + info.retryToken + ' 枚 1:1 折现' : '') + '），本局结束（分数入账）</span></div>' +
      '<div class="checkpoint-option"><b>继续挑战</b><span>撑到第 ' + info.nextCheckpoint + ' 层本层应得升到 <b class="gold-text">' + info.ticketsNext + '</b> 张（试炼币照常折现）；中途失败也按同一口径结算</span></div>' +
      '<p class="small-label">本局分数 ' + info.score + ' · 试炼币 ' + info.coins + '</p></div>',
      [
        { label: '结算离场', cls: 'gold', run: () => { const r = Tower.settleEndless(); if (r.ok) settleResult(r); else openEndless(); } },
        { label: '继续挑战', run: () => { Tower.continueEndless(); fight('endless'); } },
      ], { locked: true });
  }
  function settleResult(r) {
    syncTickets();
    const summary = r && r.summary || Tower.endlessInfo().lastSummary;
    if (summary) openEndlessSummary(summary);
    else openEndless();
  }

  /** 战报只读取状态机的快照；打开、滚动和重看都不重新结算奖励。 */
  function summaryNumber(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Math.max(0, Math.floor(Number(value))).toLocaleString('zh-CN');
  }
  function summaryStat(label, value, note) {
    return '<div class="summary-stat"><span>' + esc(label) + '</span><strong>' + summaryNumber(value) +
      '</strong>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';
  }
  function openEndlessSummary(summary) {
    if (!summary) { openEndless(); return; }
    hideTip();
    const victory = summary.outcome === 'win';
    const settled = summary.settled === true;
    const layer = Math.max(1, Number(summary.layer) || 1);
    const buffs = Array.isArray(summary.buffs) ? summary.buffs : [];
    const achievements = Array.isArray(summary.achievements) ? summary.achievements : [];
    const kinds = { permanent: '永久', limited: '限次', instant: '即时' };
    const totals = { permanent: 0, limited: 0, instant: 0 };
    for (const buff of buffs) if (totals[buff.kind] !== undefined) totals[buff.kind] += Math.max(0, Number(buff.count) || 0);
    const buffTotals = Object.keys(kinds).filter(k => totals[k] > 0)
      .map(k => kinds[k] + ' ' + summaryNumber(totals[k]) + ' 份').join(' · ');
    const mode = summary.uiMode === 'classic' ? '经典界面' : summary.uiMode === 'modern' ? '现代界面' : '界面未记录';
    const subtitle = victory
      ? ('第 ' + layer + ' 层魔王已击败' + (settled ? ' · 本局已结算' : ' · 新的镜界仍在前方'))
      : ('征途止于第 ' + layer + ' 层 · ' + (summary.reason === 'defeat' ? '战斗失利' : '离场结算'));
    const buffRows = buffs.map(buff => {
      const def = TowerData.BUFF_BY_ID[buff.id];
      const desc = def ? TowerData.descOf(def, 'endless') : '';
      const rarity = Math.max(0, Math.min(3, Number(buff.rarity) || 0));
      return '<li class="summary-buff" data-rarity="' + rarity + '"' +
        (desc ? ' tabindex="0" data-tip="' + esc(desc) + '"' : '') + '>' +
        '<span class="summary-buff-name">' + esc(buff.name || (def && def.name) || buff.id) + '</span>' +
        '<span class="summary-buff-kind">' + esc((RARITY[rarity] || '') + ' · ' + (kinds[buff.kind] || '特殊')) + '</span>' +
        '<b class="summary-buff-count">×' + summaryNumber(buff.count) + '</b></li>';
    }).join('');
    const earnedAchievementPoints = item => item.earnedPoints != null ? Number(item.earnedPoints)
      : String(item.key || '').startsWith('revive:') ? null : Number(item.points);
    const achievementRows = achievements.map(item => {
      const points = earnedAchievementPoints(item);
      return '<li class="summary-achievement"><b>' + esc(item.name) + '</b><span>' +
        (points == null ? '计分档位 ' + summaryNumber(item.points) : '+' + summaryNumber(points)) + ' 分' +
        (item.layer ? ' · 第 ' + summaryNumber(item.layer) + ' 层' : '') + '</span></li>';
    }).join('');
    const allAchievementPointsKnown = achievements.every(item => earnedAchievementPoints(item) != null);
    const achievementPoints = achievements.reduce((total, item) => total + (earnedAchievementPoints(item) || 0), 0);
    const rewardNote = '层数奖励 ' + summaryNumber(summary.layerTickets) + ' 张' +
      (summary.bonusTickets > 0 ? ' · 百层胜利额外 ' + summaryNumber(summary.bonusTickets) + ' 张' : '') +
      (summary.mintConverted > 0 ? ' · 铸币折券 ' + summaryNumber(summary.mintConverted) + ' 张' : '');
    const notes = [
      settled ? '抽奖卷已放入背包，可用于每日幸运抽奖。' : '继续挑战将保留本局进度；离场时一次领取奖励。',
      summary.bonusTickets > 0 ? '在整百层胜利后选择离场，额外获得 ' + summaryNumber(summary.bonusTickets) + ' 张抽奖卷；继续挑战则不领取。' : '',
      summary.mintForfeited > 0 ? '铸币折券上限 ' + summaryNumber(summary.mintTicketCap) + ' 枚，超出 ' + summaryNumber(summary.mintForfeited) + ' 枚不再折券。' : '',
      summary.trialCoinsLeft > 0 && settled ? '离场剩余 ' + summaryNumber(summary.trialCoinsLeft) + ' 枚试炼币随本局结束，不折券。' : '',
      summary.freeDraws > 0 ? '保底奖励：另获 ' + summaryNumber(summary.freeDraws) + ' 次免费抽奖。' : '',
      summary.complete === false ? '本局开始于战报记录启用之前，未记录的累计项显示为「—」，增益仅列出可确认的记录。' : '',
    ].filter(Boolean).map(note => '<p>' + esc(note) + '</p>').join('');
    const actions = settled
      ? C().btn('返回', 'summary-lobby', 'muted') + C().btn('去抽奖', 'summary-lottery', '') + C().btn('再次攀登', 'summary-restart', 'gold')
      : C().btn('领奖离场', 'summary-settle', 'muted') + C().btn('继续挑战', 'summary-continue', 'gold');
    const report = '<article class="endless-summary" data-outcome="' + (victory ? 'win' : 'lose') + '" aria-label="无尽塔本局战报">' +
      '<header class="summary-heading"><span class="summary-kicker">无尽之塔 · ' + (victory ? '胜利结局' : '未竟结局') + '</span>' +
      '<h2 class="summary-ending">' + (victory ? '破晓登临' : '星火未熄') + '</h2>' +
      '<p class="summary-subtitle">' + esc(subtitle) + '</p><span class="summary-mode">' + mode + '</span></header>' +
      '<div class="summary-score"><span>本局总分</span><strong>' + summaryNumber(summary.score) + '</strong>' +
      '<small>' + (settled ? '本次攀登的最终得分' : '截至本次百层胜利的累计得分') + '</small></div>' +
      '<div class="summary-body"><section class="summary-section"><h3 class="summary-section-heading">增益足迹<small>' +
      (summary.complete === false ? '已记录 ' : '共 ') + summaryNumber(buffs.length) + ' 种 · ' + summaryNumber(summary.buffCount) + ' 份</small></h3>' +
      (buffRows ? '<ul class="summary-buffs">' + buffRows + '</ul>' : '<p class="summary-empty">' +
        (summary.complete === false ? '旧局未保留可确认的增益记录。' : '本局尚未获得增益。') + '</p>') +
      (buffTotals ? '<p class="summary-buff-totals">' + esc(buffTotals) + ' · 包含已用尽、售出及献祭的增益</p>' : '') + '</section>' +
      '<section class="summary-section"><h3 class="summary-section-heading">攀登战绩</h3><div class="summary-stats">' +
      summaryStat('击败敌人', summary.enemiesDefeated, '本局胜利场次') +
      summaryStat('通关层数', summary.layersCleared, '实际完成层数') +
      summaryStat('最深抵达', Math.max(layer, Number(summary.bestLayer) || 0), '层') +
      summaryStat('累计铸币', summary.mintEarned, '累计获得，含已使用') +
      summaryStat('累计试炼币', summary.trialCoinsEarned, '累计获得，含已使用') +
      summaryStat(settled ? '获得抽奖卷' : '离场可得抽奖卷', summary.tickets, rewardNote) + '</div></section>' +
      '<section class="summary-section"><h3 class="summary-section-heading">隐藏成就<small>' + summaryNumber(achievements.length) +
      ' 项' + (achievements.length && allAchievementPointsKnown ? ' · +' + summaryNumber(achievementPoints) + ' 分' : '') + '</small></h3>' +
      (achievementRows ? '<ul class="summary-achievements">' + achievementRows + '</ul>' : '<p class="summary-empty">本局暂无已记录的隐藏成就。</p>') +
      '</section><div class="summary-notes">' + notes + '</div></div><footer class="summary-actions">' + actions + '</footer></article>';
    const ct = classicTower();
    const content = '<div class="tower-page endless-summary-page">' + towerVisual(layer, 0, 'endless') +
      '<div class="tower-main">' + report + '</div></div>';
    const p = C().page('challenge', 'stages', content, ct
      ? { cls: 'tower-board', noTabs: true, noFooter: true, pageClass: 'classic-tower', above: classicTowerBar() }
      : { cls: 'tower-board' });
    if (ct) applyClassicTowerBg(p, 'endless', layer);
    back(p, towerBack, ct ? '返回征战' : '返回');
    bindTips(p);
    on(p, 'summary-lobby', () => openEndless());
    on(p, 'summary-restart', beginEndlessRun);
    on(p, 'summary-lottery', () => {
      syncTickets();
      if (window.ClassicExtras && ClassicExtras.lottery) ClassicExtras.lottery(); else UI.runAction('lottery');
    });
    on(p, 'summary-continue', openMirrorConfirm);
    on(p, 'summary-settle', () => {
      const out = Tower.settleEndlessVictory();
      if (!out || !out.ok) { notice(out && out.msg || '现在还不能领取奖励。'); return; }
      settleResult(out);
    });
  }


  /* ============================================================
   * 【U17】模块导出 —— window.TowerUI
   * ============================================================ */
  window.TowerUI = { openTower, openEndless, openMintShop, openShop, openPickBuff, openPatrolToll, openPatrolDiscard };
  /* 【U18】把「剧情播完之后回主界面」这条线接给 tower-plot.js ——
   * 剧情模块不直接引用 tower-ui（两个文件互不 require），只认这一根线。 */
  if (window.TowerPlot && TowerPlot.setMainOpener) TowerPlot.setMainOpener(openEndless);
})();
