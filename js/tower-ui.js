/* ============================================================
 * tower-ui.js — 无尽挑战塔界面（经典 UI 壳内）
 * 入口在「关卡」页下滑；主塔/无尽两个页面都在这里。
 * 爬塔可视化：左侧塔身楼层条 + 右侧当层对手预告/构筑。
 *
 * 目录（Ctrl+F 搜「【U编号】」直达）：
 *   【U1】基础助手              【U7】无尽页面            【U13】无尽：里程碑·重试·战败结算
 *   【U2】通用小件              【U8】战斗闭环            【U14】无尽：试炼币商店
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
  /** 轻量飘字（比成就条更朴素，用于「碎烙印失效」这类过程提示）。 */
  function runToast(text) {
    const el = document.createElement('div');
    el.className = 'run-toast';
    el.textContent = String(text || '');
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('out'); }, 2400);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3200);
  }

  const RARITY = TowerData.RARITY_NAME || ['普通', '稀有', '史诗', '传奇'];
  const SCOPE = { limited: '限次', permanent: '永久', instant: '即时' };
  /* 无尽塔的「环境词缀」：段位机制（荆棘反伤/自愈回复/吸血/护盾/吞噬成长）已经并进来了，
   * 所以现在只有这一个常驻负面机制来源。每条环境都带：本局摇出来的实际数值、
   * 渲染好的效果文案、数值区间（悬停可见）。 */
  let replaceTarget = null;

  function orderPermanent(list, freeIds) {
    const free = freeIds || [];
    const arr = (list || []).slice();
    const isFree = (b) => free.indexOf(b.id) >= 0;
    return arr.map((b, i) => ({ b: b, i: i, f: isFree(b) ? 0 : 1 }))
      .sort((x, y) => (x.f - y.f) || (x.i - y.i))
      .map((x) => x.b);
  }

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
    return '当前血量 ' + hp + ' / 上限 ' + maxHp + '（下一场按**绝对值**继承，超出上限的部分裁掉）';
  }
  let tipEl = null;
  function showTip(text, anchor) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tower-tip-float'; document.body.appendChild(tipEl); }
    tipEl.textContent = text;
    tipEl.style.display = 'block';
    const r = anchor.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
    let top = r.bottom + 8;
    if (top + t.height > window.innerHeight - 8) top = Math.max(8, r.top - t.height - 8);
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
  /** 环境面板：当前生效的全部环境（唯一常驻负面机制）。没有环境时给一句提示。 */
  function envPanelHtml(run, opts) {
    const o = opts || {};
    const list = (run && run.env) || [];
    const chips = list.length
      ? list.map((e) => envChip(e, o)).join('')
      : '<span class="mech-none">当前没有环境词缀（第 ' + ((window.TowerData && TowerData.ENV_START_LAYER) || 5) + ' 层起可能出现）</span>';
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
    if (info.kind === 'hero') {
      const file = CHAR_FILE[info.anim] || 'mantis';
      return '<span class="foe-portrait"><img alt="" src="images/classic/characters/' + file + '-classic-card.png"></span>';
    }
    return '<span class="foe-portrait"><canvas width="' + AVATAR_SIZE + '" height="' + AVATAR_SIZE +
      '" data-foe-art="' + index + '" aria-hidden="true"></canvas></span>';
  }
  function fallbackPortrait(canvas, info) {
    const kind = info && info.kind;
    const file = CHAR_FILE[info && info.anim];
    let src = null;
    if (kind === 'hero') src = file ? 'images/classic/characters/' + file + '-classic-card.png' : null;
    else if (kind === 'npc') src = null;
    else src = 'images/classic/squirrel-classic.png';
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
    const wears = npc ? null : Engine.wearsFor(TowerData.wearsOf(info.gear));
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
  /** 三侠大招留削弱的具体数值（挂在规则行的悬停气泡上）。 */
  function heroDebuffTips() {
    if (!TowerData.HERO_DEBUFF) return '第 4 场是随机 boss；三侠顺序每层随机。';
    const tips = ['tl', 'xh', 'xm'].map((k) => TowerData.HERO_DEBUFF[k]).filter(Boolean)
      .map((d) => '· ' + d.name + '：' + d.desc).join('\n');
    return '三侠的大招会给本层留下削弱（速杀可规避）：\n' + tips + '\n\n第 4 场是随机 boss；悬停任意对手可以看它的机制与出招循环。';
  }
  /* ============================================================
   * 【U4】增益面板与货币条 —— buffPanelsHtml / currencyHtml
   * ============================================================ */
  function buffTag(b, stacks) {
    return '<span class="buff-tag r' + b.rarity + '" title="' + esc(b.desc) + '">' + esc(b.name) +
      '<i>' + SCOPE[b.kind] + '</i>' + (stacks > 1 ? '<em>×' + stacks + '</em>' : '') + '</span>';
  }
  function ownedBuffsHtml(mode) {
    const list = Tower.ownedBuffs(mode);
    if (!list.length) return '';
    return '<div class="tower-buffs"><h4>本局构筑</h4><div class="buff-tags">' +
      list.map((b) => buffTag(b, b.stacks)).join('') + '</div></div>';
  }
  function permTip(b) {
    const buff = TowerData.BUFF_BY_ID[b.id];
    if (!buff) return b.name;
    const parts = [buff.name + '（' + RARITY[b.rarity] + ' · 永久）', buff.desc];
    parts.push('当前叠层：×' + b.stacks + (b.stacks > 1 ? '（按层数累加）' : ''));
    const m = buff.mods || {};
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
    /* 狂怒：低血时攻/敏/速同时生效（阈值 + 三项一起写清楚）。 */
    if (m.lowHpPowerMul || m.lowHpAgilityMul || m.lowHpSpeedMul) {
      const low = '生命低于 ' + Math.round((m.lowHpAt || 0.5) * 100) + '% 时';
      const bits = [];
      if (m.lowHpPowerMul) bits.push('攻击 +' + Math.round(m.lowHpPowerMul * b.stacks * 100) + '%');
      if (m.lowHpAgilityMul) bits.push('敏捷 +' + Math.round(m.lowHpAgilityMul * b.stacks * 100) + '%');
      if (m.lowHpSpeedMul) bits.push('速度 +' + Math.round(m.lowHpSpeedMul * b.stacks * 100) + '%');
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
    if (m.catchUpPct) parts.push('战斗中每回合把「落后对手最多」的那一项补上差距的 ' + Math.round(m.catchUpPct * 100) + '%；每场战斗结束时清零');
    if (m.firstDodge) parts.push('每场战斗中第一次被攻击时必定闪避');
    if (m.roundMaxHpMul) parts.push('战斗中每回合双方生命上限 ×' + Math.round(m.roundMaxHpMul * 100) + '%（向下取整）；每场战斗结束时清零');
    if (m.shopSpendLimited) parts.push('每在试炼商店消费 ' + m.shopSpendLimited + ' 试炼币 → 立即获得 1 个随机限次增益');
    if (m.shopEnterCoins) parts.push('每进入一次试炼商店 +' + m.shopEnterCoins + ' 试炼币' +
      (b.stacks > 1 ? '（可叠 ' + b.stacks + ' 层）' : ''));
    if (m.mustHitAll) parts.push('这一场所有攻击必中');
    if (m.mustHitFirst) parts.push('首次攻击必中');
    if (m.pickPermanentFree) parts.push('可给一个已有的永久增益附魔免占位');
    if (m.fragileStat) parts.push('本局永久保留：' + ({ power: '力量', agility: '敏捷', speed: '速度' }[m.fragileStat] || m.fragileStat) +
      ' +' + Math.round((m.fragilePct || 0) * 100) + '%；每场 ' + (m.fragileBreakPct || 5) + '% 损毁');
    if (b.progress) parts.push('当前进度：' + b.progress);
    if (buff.mods && buff.mods.shopDiscount) parts.push('下个商店 ' + Math.round((1 - buff.mods.shopDiscount) * 100) / 10 + ' 折');
    if (buff.mods && buff.mods.postBattleShop) parts.push('下一场战斗后开一次商店');
    parts.push(replaceTarget === b.id ? '（当前已选为要拿掉的那个，点一下取消）' : '点一下选它作为要拿掉的那个永久增益');
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
    if (TowerData.hasTag(buff, 'tower') && TowerData.hasTag(buff, 'nextBattle')) {
      return [buff.name + '（' + RARITY[buff.rarity] + ' · 挑战塔 · 下一场战斗）', buff.desc,
        '打完这一场就消失（挑战塔的增益只服务下一场）',
        b.on ? '当前生效中 · 点一下可以关掉' : '当前已关闭 · 点一下重新开启'].join('\n');
    }
    return [buff.name + '（' + RARITY[buff.rarity] + ' · 限次 ' + (buff.uses || 1) + ' 场）', buff.desc,
      '剩余 ' + b.uses + ' 场（每打完一场扣 1，扣完自动消失）',
      b.on ? '当前生效中 · 点一下可以关掉（关掉不扣次数）' : '当前已关闭 · 点一下重新开启'].join('\n');
  }
  function limitBadgeText(b) {
    const def = TowerData.BUFF_BY_ID[b.id] || {};
    const stackTag = b.stacks > 1 ? '×' + b.stacks + ' 层 · ' : '';
    if (TowerData.hasTag(def, 'tower') && TowerData.hasTag(def, 'nextBattle')) return stackTag + '下一场';
    if (def.mods && def.mods.fragileBreakPct) return stackTag + '易碎 ' + def.mods.fragileBreakPct + '%';
    if (TowerData.hasTag(def, 'nextBattle')) return stackTag + '无尽塔 · 剩 ' + b.uses + ' 场';   // 无尽塔的单场限次类
    return stackTag + '剩 ' + b.uses + ' 场';
  }
  function buffPanelsHtml(mode) {
    const run = mode === 'tower' ? Tower.towerInfo().run : Tower.endlessInfo().run;
    if (!run || mode !== 'endless') return '';
    const list = Tower.ownedBuffs('endless');
    const freeIds = run.slotFreeIds || [];
    const perm = orderPermanent(list.filter((b) => b.kind === 'permanent'), freeIds);
    const lim = list.filter((b) => b.kind === 'limited');
    const cap = Number(run.permCap) || ((TowerData.PERMANENT_SLOTS || 5) + Math.max(0, Number(run.permSlots || 0)));   // 槽位上限含扩容类加成
    const permHtml = perm.length
      ? perm.map((b, i) => {
          const free = freeIds.indexOf(b.id) >= 0;
          const nextFree = i + 1 < perm.length && freeIds.indexOf(perm[i + 1].id) >= 0;
          const divider = (free && !nextFree) ? '<span class="buff-sep" aria-hidden="true"></span>' : '';
          return '<span class="buff-tag r' + b.rarity + (b.id === replaceTarget ? ' replacing' : '') +
            (free ? ' slot-free' : '') + '" data-replace="' + b.id +
            '" data-tip="' + esc(permTip(b)) + '" title="' + esc(permTip(b)) + '">' +
            esc(b.name) + '<i>' + (free ? '不占位' : '永久') + '</i>' +
            (b.stacks > 1 ? '<em>×' + b.stacks + '</em>' : '') + '</span>' + divider;
        }).join('')
      : '<span class="buff-empty">还没有永久增益（每层的休整点可以拿）</span>';
    const progList = perm.filter((b) => b.progress);
    const progHtml = progList.length
      ? '<div class="buff-progress-list">' + progList.map((b) =>
          '<span class="buff-progress-item"><b>' + esc(b.name) + '</b>' + esc(b.progress) + '</span>').join('') + '</div>'
      : '';
    const limHtml = lim.length
      ? lim.map((b) => '<button type="button" class="limit-tag r' + b.rarity + (b.on ? '' : ' off') + '" data-toggle="' + b.id +
          '" data-tip="' + esc(limitTip(b)) + '" title="' + esc(limitTip(b)) + '">' +
          '<b>' + esc(b.name) + '</b><i>' + (b.on ? '生效中' : '已关闭') + '</i><em>' +
          limitBadgeText(b) + '</em></button>').join('')
      : '<span class="buff-empty">还没有限次增益</span>';
    return '<div class="tower-buffs endless-buffs">' +
      '<h4>永久增益 <span class="buff-slot-count">' + (run.permUsed == null ? perm.length : run.permUsed) + '/' + cap + '</span>' +
      (replaceTarget ? '<span class="replace-hint">选一个要拿掉的（再点增益卡确认）</span>' : '') + '</h4>' +
      '<div class="buff-tags">' + permHtml + '</div>' + progHtml +
      '<h4>限次增益 <span class="buff-slot-count">点一下开关</span></h4>' +
      '<div class="buff-tags">' + limHtml + '</div></div>';
  }
  function debuffPanel(debuffs) {
    if (!debuffs || !debuffs.length) return '';
    // 每张卡带上「是哪位大侠给的」小头像 + 来源色，一眼就能对上本层的对手顺序
    return '<div class="tower-debuffs"><h4>本层已被削弱（贯穿本层）</h4><div class="debuff-cards">' +
      debuffs.map((d) => {
        const file = CHAR_FILE[d.from] || null;
        const face = file ? '<img class="debuff-face" alt="" src="images/classic/characters/' + file + '-classic-card.png">' : '';
        return '<div class="debuff-card" style="--hero-color:' + esc(d.color || '#7a4a18') + '">' + face +
          '<span class="debuff-from">' + esc(d.short || d.hero || '大侠') + '</span>' +
          '<b class="debuff-name">' + esc(d.name || '削弱') + '</b>' +
          '<span class="debuff-text">' + esc(d.text || '') + '</span></div>';
      }).join('') +
      '</div></div>';
  }
  function syncTickets() {
    if (window.ClassicExtras && ClassicExtras.refreshTickets) { try { ClassicExtras.refreshTickets(); } catch (e) { /* ignore */ } }
    if (window.UI && UI.refreshHeader) { try { UI.refreshHeader(); } catch (e) { /* ignore */ } }
  }
  const CURRENCY_PROP = { book: 23, ticket: 50 };
  function currencyHtml(mode) {
    const S = State.state();
    if (mode === 'endless') {
      const run = Tower.endlessInfo().run;
      const items = [];
      if (run) items.push({ name: '试炼币', value: run.coins });
      const exitT = run ? Math.max(0, Math.floor(Number(run.ticketsOnExit) || 0)) : 0;
      const layerT = run ? Math.max(0, Math.floor(Number(run.ticketsIfSettle) || 0)) : 0;
      const coins = run ? Math.max(0, Math.floor(Number(run.coins) || 0)) : 0;
      const tokens = run ? Math.max(0, Math.floor(Number(run.retryToken) || 0)) : 0;
      items.push({
        name: '抽奖卷',
        value: run ? exitT : (S.props[CURRENCY_PROP.ticket] || 0),
        tip: run
          ? ('现在退出实际到手 ' + exitT + ' 张：本层应得 ' + layerT + ' 张 + 铸币 ' + tokens +
             ' 枚 1:1 折现 ' + tokens + ' 张。\n' +
             '· 剩余试炼币（当前 ' + coins + ' 枚）**不折现**，本局结束即作废\n' +
             '· 结算点「结算离场」/「放弃本局」/ 失败结算 三条路收益完全一致，都是这个数\n' +
             '· 仓库里已有的抽奖卷不在这个数字里（去「每日幸运抽奖」页看总数）')
          : '仓库持有的抽奖卷总数'
      });
      /* 铸币（原名「重新挑战币」）：无尽塔主界面右上角直接标出**本场拥有多少枚**，
       * 鼠标悬停说明用途（失败时回滚本场 / 退出时 1:1 折成抽奖卷 / 商店售价）。 */
      items.push({
        name: '铸币',
        value: run ? tokens : 0,
        tip: run
          ? ('本场拥有 ' + tokens + ' 枚铸币。\n' +
             '· 战斗失败时可以花 1 枚回滚到该场开始前再打一次（血量 / 试炼币 / 分数 / 增益次数全部还原）\n' +
             '· 退出本局时剩余的铸币按 1:1 折成抽奖卷（' + tokens + ' 枚 → ' + tokens + ' 张，已经算进左边「抽奖卷」那个数）\n' +
             '· 试炼商店左下角可以用 50 试炼币买 1 枚')
          : '铸币：失败时回滚本场再打一次；退出时 1:1 折成抽奖卷'
      });
      return '<div class="tower-currency text-only">' + items.map((it) =>
        '<span class="currency-item"' + (it.tip ? ' data-tip="' + esc(it.tip) + '" title="' + esc(it.tip) + '"' : '') + '><b>' + it.value + '</b><i>' + it.name + '</i></span>').join('') + '</div>';
    }
    const items = [{ icon: 'images/classic/icons/prop-23.png', name: '挑战书', value: S.props[CURRENCY_PROP.book] || 0 },
      { icon: 'images/classic/icons/prop-1.png', name: '金松果', value: S.goldPoint }];
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
  function isTowerNext(b) {
    return !!(b && TowerData.hasTag(b, 'tower') && TowerData.hasTag(b, 'nextBattle'));
  }
  function buffCatalogHtml() {
    /* 增益集锦 = **无尽塔的全增益展示**：只列带无尽塔标签的条目，
     * 挑战塔专属（tower-only）一条都不出现；hidden 的（选取型强化）也不列。 */
    const list = TowerData.BUFFS.filter((b) => TowerData.hasTag(b, 'endless') && !TowerData.hasTag(b, 'hidden'));
    const byRarity = [0, 1, 2, 3].map((r) => list.filter((b) => b.rarity === r));
    const kindName = { limited: '限次', permanent: '永久', instant: '即时' };
    return '<div class="tower-buffs buff-catalog"><h4>增益集锦 <span class="buff-slot-count">共 ' + list.length + ' 种 · 悬停看效果</span></h4>' +
      byRarity.map((group, r) => group.length
        ? '<div class="catalog-row"><b class="catalog-rarity r' + r + '">' + (RARITY[r] || '') + '</b>' +
          '<div class="buff-tags">' + group.map((b) => '<span class="buff-tag r' + b.rarity + '" data-tip="' +
            esc(b.name + '（' + (RARITY[b.rarity] || '') + ' · ' +
              ((isTowerNext(b)) ? '下一场' : (kindName[b.kind] || '')) +
              (b.kind === 'limited' ? (isTowerNext(b) ? ' 下一场战斗' : ' ' + (b.uses || 1) + ' 场') : '') + '）\n' + b.desc) +
            '" title="' + esc(b.desc) + '">' + esc(b.name) + '<i>' + (kindName[b.kind] || '') + '</i></span>').join('') +
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
  function bossCatalogHtml() {
    const pool = Tower.bossPool ? Tower.bossPool() : [];
    if (!pool.length) return '';
    return '<div class="tower-buffs boss-catalog"><h4>BOSS 一览 <span class="buff-slot-count">' + pool.length + ' 个 · 第 4 场随机池</span></h4>' +
      '<ol class="tower-plan boss-grid">' + pool.map((b, i) =>
        '<li class="' + (b.elite ? 'elite ' : '') + (b.squirrel ? 'squirrel' : '') + '" tabindex="0" data-tip="' + esc(mechTip(b)) + '">' +
        '<b>' + esc(b.name) + '</b>' +
        (b.type ? '<span class="tower-plan-type">' + esc(b.type) + '</span>' : '') +
        (b.layers && b.layers.length ? '<span class="boss-layers">第 ' + b.layers.join(' / ') + ' 层</span>' : '') +
        '</li>').join('') + '</ol></div>';
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

  function openTower() {
    const info = Tower.towerInfo();
    let main, footer = null;
    if (info.run) {
      const run = info.run;
      main = '<div class="tower-head"><h2 class="tower-title">第 ' + run.layer + ' 层 · 第 ' + run.battleNo + '/' + run.battleCount + ' 场</h2>' +
        '<div class="tower-stats">已累积松果 <b class="gold-text">' + run.pot + '</b>（失败只保底 30%）</div></div>' +
        currencyHtml('tower') +
        carryBar(run.curHp, run.curMaxHp, '血量', '', hpTip(run)) + debuffPanel(run.debuffs) + ownedBuffsHtml('tower') +
        '<div class="tower-actions">' + C().btn('继续战斗', 'fight', 'gold') + C().btn('放弃本层', 'abandon', 'muted small') + '</div>';
    } else {
      main = '<div class="tower-head"><h2 class="tower-title">无尽挑战塔 · 第 ' + info.nextLayer + ' 层</h2>' +
        '<div class="tower-stats">目标等级 ' + info.level + ' · 强度 ×' + info.mult.toFixed(2) + ' · ' + info.battles + ' 场连战 · 通关金松果 <b class="gold-text">' + info.gold + '</b></div></div>' +
        currencyHtml('tower') +
        /* 把「三侠削弱」提示并进规则行（右上角多了货币条，版面高度要省下来），
         * 具体数值仍挂在悬停气泡里，信息不丢。 */
        '<p class="tower-rule" title="' + esc(heroDebuffTips()) + '">每层 1 张挑战书 · 连战只继承血量 · 对手顺序每层随机 · ' +
        '三侠的大招会留贯穿本层的削弱（速杀可规避）· 通关另补 3 场挑战的掉落 · 悬停看机制</p>' +
        '<h4 class="tower-plan-title">本层对手预告</h4>' + planHtml(info.preview);
      footer = '<div class="tower-actions tower-footer">' +
        '<span class="tower-book-count">现有挑战书 ' + info.books + ' 张</span>' +
        C().btn('开始挑战（挑战书×1）', 'fight', 'gold') + '</div>';
    }
    const content = '<div class="tower-page' + (footer ? ' has-footer' : '') + '">' + towerVisual(info.nextLayer, info.maxLayer, 'tower') +
      '<div class="tower-main">' + main + '</div>' + (footer || '') + '</div>';
    const p = C().page('challenge', 'stages', content, { cls: 'tower-board' });
    bindTips(p);
    if (!info.run) fillFoeArt(p, info.preview);
    back(p, () => C().home());
    on(p, 'fight', () => {
      if (info.run) {
        if (info.run.choices) { offerChoice('tower', info.run.choices); return; }
        fight('tower');
        return;
      }
      const started = Tower.startTowerRun();
      if (!started.ok) {
        notice(started.msg, started.needsBook ? [{ label: '去商店买挑战书', run: () => UI.runAction('shop') }, { label: '返回', cls: 'gold' }] : undefined);
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

  function openEndless() {
    const info = Tower.endlessInfo();
    let main, footer = null;
    if (info.run) {
      const run = info.run;
      const nextLabel = run.choices ? '先选一张增益'
        : run.phase === 'shop' ? '进入试炼商店'
        : run.phase === 'checkpoint' ? '前往结算点'
        : run.phase === 'sacrifice' ? '放弃一个永久增益' : '继续战斗';
      /* 只认 run.plan（实战真正会打的那一串）。以前这里另算一遍 preview(layer, salt)，
       * 只要重建 plan 时漏了 salt / squirrelsOnly，界面第 4 场的 boss 就和实战不是同一只。 */
      const foes = (Tower.planInfo ? Tower.planInfo('endless') : []).length
        ? Tower.planInfo('endless')
        : Tower.preview(run.layer, run.salt, true);
      const clearing = (run.phase === 'shop' || run.phase === 'checkpoint' || run.phase === 'sacrifice') && run.finished && run.finished.layer === run.layer;
      const beatenCount = clearing ? foes.length : Math.max(0, (run.battleNo || 1) - 1);
      const foeRows = foes.map((b, i) =>
        '<li class="' + (b.elite ? 'elite ' : '') + (b.squirrel ? 'squirrel ' : '') + (i < beatenCount ? 'beaten' : '') +
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
          run.choices.map((c, i) => choiceCard(c, i)).join('') + '</div></div>' : '';
      /* 顶栏：标题 → 试炼币/抽奖卷 → 分数框 → 右边缘的三个药丸槽（等腰三角摆放）。
       * 血量紧贴标题下方（分数已经挪进顶栏，所以这里整体上提），字号与血条都放大一档；
       * 「继续战斗」在右下角，「放弃本局」更小、压在它左边偏下。 */
      main = '<div class="endless-run">' +
        /* 右上角：药丸槽 + 试炼币/抽奖卷 + 分数框（横向一行，位置不变）。 */
        '<div class="endless-topright">' + currencyHtml('endless') +
        '<span class="endless-score-box"><i>分数</i><b>' + run.score + '</b></span></div>' +
        '<div class="endless-left">' +
        '<div class="endless-title-row"><h2 class="tower-title">无尽模式 · 第 ' + run.layer + ' 层（第 ' + run.segment + ' 段）</h2>' +
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
                  esc('挫锋：本局所有敌人的攻击力都按这个比例扣（与「威慑」叠加）') + '">敌人攻击力 −' +
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
        '<div class="endless-foes">' +
        '<ol class="tower-plan vertical">' + foeRows + '</ol></div></div>' +
        '<div class="endless-actions tower-actions">' +
        '<span class="endless-action-btns">' +
        C().btn('放弃本局', 'abandon', 'muted tiny') +
        C().btn(nextLabel, 'fight', 'gold') + '</span></div>';
    } else {
      main = '<h2 class="tower-title">无尽模式</h2>' +
        '<div class="tower-stats">历史最高 <b class="gold-text">' + info.best + '</b> 分 · 本周最高 ' + info.weekBest + ' 分 · 最深 ' + info.bestLayer + ' 层</div>' +
        currencyHtml('endless') +
        buffCatalogHtml() + bossCatalogHtml();
      footer = '<div class="tower-actions tower-footer">' +
        '<span class="tower-book-count">现有抽奖卷 ' + info.tickets + ' 张</span>' +
        C().btn('开始冲塔（免费）', 'fight', 'gold') + '</div>';
    }
    const content = '<div class="tower-page' + (footer ? ' has-footer' : '') + '">' + towerVisual(info.run ? info.run.layer : 1, 0, 'endless') +
      '<div class="tower-main">' + main + '</div>' + (footer || '') + '</div>';
    const p = C().page('challenge', 'stages', content, { cls: 'tower-board' });
    bindTips(p);
    if (info.run) fillFoeArt(p, Tower.planInfo ? Tower.planInfo('endless') : Tower.preview(info.run.layer, info.run.salt, true));
    back(p, () => C().home());
    on(p, 'fight', () => {
      if (info.run) {
        if (info.run.choices) { notice('先在下面选一张增益（休整点）。'); return; }
        if (info.run.phase === 'shop') { openShop(); return; }
        if (info.run.phase === 'checkpoint') { openCheckpoint(); return; }
        if (info.run.phase === 'sacrifice') { openPermSacrifice(); return; }
        fight('endless');
        return;
      }
      const started = Tower.startEndlessRun();
      if (!started.ok) { notice(started.msg); return; }
      fight('endless');
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
    /* 待选取的强化（神兵淬炼/秘技通神）没选完时，回到主界面自动补弹一次 */
    if (info.run && info.run.pendingPick) setTimeout(() => openPickBuff(info.run.pendingPick), 60);
    flushRunToasts();   // 「碎掉的烙印失效」这类过程提示
    /* 20 起每 10 层：出商店后必须放弃一个永久增益（不可取消）。 */
    if (info.run && info.run.phase === 'sacrifice') setTimeout(() => openPermSacrifice(), 60);
    on(p, 'rest-shop', () => {
      const res = Tower.openRestShop();
      if (!res.ok) { notice(res.msg || '现在不能开商店。'); return; }
      openShop();
    });
    on(p, 'abandon', () => {
      const leftCoins = Math.max(0, Math.floor(Number((info.run || {}).coins) || 0));
      const leftTokens = Math.max(0, Math.floor(Number((info.run || {}).retryToken) || 0));
      modal('放弃本局',
        '<p>放弃后按当前层应得的抽奖卷结算（分数照常入账）' +
        (leftTokens > 0 ? '，手上的 <b>' + leftTokens + '</b> 枚铸币会 <b>1:1</b> 折成抽奖卷' : '') +
        (leftCoins > 0 ? '；本局剩余的 <b>' + leftCoins + '</b> 试炼币<b>不折现</b>，会随本局作废' : '') +
        '，确定吗？</p>', [
        { label: '放弃', cls: 'muted', run: () => {
            const res = Tower.abandon('endless');
            syncTickets(); openEndless();
            /* 结算提示：本层应得的那一份 + 试炼币折现的那一份，分别说清楚。 */
            const msgs = [];
            if (res && res.layerTickets > 0) msgs.push('按第 ' + res.layer + ' 层结算：抽奖卷 +' + res.layerTickets);
            if (res && res.retryLeft > 0) msgs.push(res.retryMsg);
            if (msgs.length) msgs.push('本局共 +' + res.tickets + ' 张');
            if (msgs.length) runToast(msgs.join('；'));
          } },
        { label: '继续冲塔', cls: 'gold' },
      ], { small: true });
    });
  }

  /* ============================================================
   * 【U8】战斗闭环 —— fight / winModal / afterBattle
   * ============================================================ */

  function reopen(mode) { if (mode === 'tower') openTower(); else openEndless(); }
  function fight(mode) {
    const nx = Tower.nextBattle(mode);
    if (!nx.ok) { reopen(mode); if (nx.msg) notice(nx.msg); return; }
    flushAchievements(nx.achievements);      // 「超凡入圣」这类在开战时算出的成就
    const interrupted = () => {
      Tower.interruptBattle(mode, nx.token);
      reopen(mode);
      notice('战斗播放中断，进度已保留，可重新挑战这一场。');
    };
    try {
      Promise.resolve(Main.startBattle(nx.foe, {
        region: nx.region, kind: mode, useProps: false, hpRatio: nx.hpRatio, adjustMe: nx.adjustMe,
        debuffs: nx.debuffs || [],
        // boss 机制：贴一条在战斗画面里（进层预告 / 选 buff 页都读过，这里是备忘）
        trial: nx.info && nx.info.mechDesc ? { text: nx.info.mechDesc } : null,
        allowSkip: false, speedToggle: true,
        // 塔的产出全部由状态机结算（松果/压缩碎片/抽奖卷），关掉战斗飘物，
        // 否则免门票的无尽模式可以无限刷飘物松果与经验。
        collectDrops: false,
        onError: () => Tower.interruptBattle(mode, nx.token),
        onEnd: (w, r) => {
          const hp = r && Array.isArray(r.hpAfter) ? r.hpAfter[0] : null;
          const cap = r && Array.isArray(r.maxHp) ? r.maxHp[0] : (nx.effMaxHp ? nx.effMaxHp() : 0);
          const abs = w === 0 && Number.isFinite(hp) ? Math.max(1, Math.round(hp)) : 0;
          const rw = Tower.reportBattle(mode, nx.token, w === 0, abs, cap);
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
    if (!rw.win) {
      if (mode === 'tower') towerDefeat(rw);
      else if (rw.retryable) endlessRetryOffer(rw);
      else endlessDefeat(rw);
      return;
    }
    if (mode === 'endless') {
      const cont = () => { if (rw.layerComplete && rw.phase === 'shop') openShop(); else openEndless(); };
      if (rw.milestone) { milestoneModal(rw, cont); return; }
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
  function choiceCard(c, i) {
    const b = TowerData.BUFF_BY_ID[c.id];
    if (!b) return '';
    return '<button type="button" class="hex-card ' + RARITY_CLASS[b.rarity] + '" data-choice="' + i + '">' +
      '<span class="hex-ribbon">' + RARITY[b.rarity] + '</span>' +
      '<span class="hex-emblem">' + (b.rarity === 2 ? '★' : b.rarity === 1 ? '◆' : '●') + '</span>' +
      '<b class="hex-name">' + esc(b.name) + '</b>' +
      '<span class="hex-scope">' + (isTowerNext(b) ? '挑战塔' : SCOPE[b.kind]) +
        (b.kind === 'limited'
          ? (isTowerNext(b) ? ' · 下一场战斗' : ' · ' + (b.uses || 1) + ' 场')
          : '') + '</span>' +
      '<span class="hex-desc">' + esc(b.desc) + '</span></button>';
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
    const head = '<div class="hex-pick-head"><h2 class="hex-title">整装待发</h2>' +
      '<p class="hex-sub">' + (mode === 'tower'
        ? '第 ' + (run.battleNo || 4) + ' 场之前最后一次整备 —— 选一张带进去。'
        : '场间休整 —— 选一张带进去。') + '</p>' +
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
    const body = head + '<div class="hex-cards n' + nSlots + '">' + choices.map(choiceCard).join('') + '</div>';
    const m = modal('', body, [], { locked: true });
    m.element.classList.add('choice-dialog', 'hex', 'hex-n' + nSlots);
    m.element.querySelectorAll('[data-choice]').forEach((el) => {
      el.onclick = () => {
        const picked = Tower.pickChoice(mode, Number(el.dataset.choice));
        m.close();
        if (!picked.ok) { reopen(mode); return; }
        flushAchievements(picked.achievements);
        const text = '获得增益「' + picked.buff.name + '」：' + picked.buff.desc;
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
    modal('层数通关', '<div class="result-box"><div class="result-title win">第 ' + rw.layer + ' 层通关！</div>' +
      '<div class="result-lines">金松果 +' + rw.gold + '</div>' +
      (rw.drop ? '<p>获得 ' + esc(rw.drop.name) + ' ×' + rw.drop.count + '</p>' : '') +
      prizeLine +
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
    const label = isPerm ? '永久增益' : (pending.kind === 'skill' ? '技能' : '武器');
    if (!cands.length) {
      notice('你还没有任何' + label + '可选，这次强化先留着（之后拿到' + label + '再自动弹出）。', [{ label: '知道了', cls: 'gold', run: () => openEndless() }]);
      return;
    }
    /* 按钮只写名字，副标题换行显示（modal 按钮是 esc() 输出，用 \n + white-space:pre-line 换行）。
     * 特殊技能（小宇宙爆发 / 绝对防御 / 龟甲术）不按 Lv 展示，而是按 pickCandidates 给的 note。 */
    const buttons = cands.map((c) => ({
      label: c.name + '\n' + (isPerm ? ('×' + (c.stacks || 1) + ' 层') : (c.note || ('Lv' + (c.level || 1)))),
      cls: 'small pick-buff-btn' + (pending.kind === 'skill' ? '' : ' gold'),
      run: () => {
        const r = Tower.applyPickBuff(pending.kind, c.id);
        if (!r.ok) notice(r.msg || '强化失败。');
        openEndless();
      },
    }));
    modal(isPerm ? '附魔 · 选一个永久增益' : ('三选一 · ' + label + '强化'), '<p>' + esc(isPerm
      ? '从下面三张里选一个永久增益：它不再占用永久增益位（可叠加的则全部层数一起免疫占位，本局有效）。'
      : (pending.kind === 'skill'
        ? '从下面三个技能里选一个：主动技的触发概率大幅提升；防御技（绝对防御 / 龟甲术）另按被动触发概率加成；'
          + '小宇宙爆发则是「战斗开始后第一招必定放它」（本局有效）。'
        : '从下面三把武器里选一个：它的伤害 +100%（本局有效）。')) + '</p>', buttons, { small: true });
  }
  /* ============================================================
   * 【U12】永久增益「满了换一个」 —— offerPermanentReplace / offerReplace
   * ============================================================ */
  const RARITY_SHORT = ['普通', '稀有', '史诗', '传奇'];
  /** 永久增益替换弹窗：onPick(entry) 执行实际替换，onCancel() 返回。 */
  function offerPermanentReplace(opts) {
    const o = opts || {};
    const freeIds = (Tower.endlessInfo().run || {}).slotFreeIds || [];
    /* 与面板同一口径：附魔（不占位）的排在前面。 */
    const list = orderPermanent(Tower.ownedBuffs('endless').filter((b) => b.kind === 'permanent'), freeIds);
    if (!list.length) { notice('没有可以拿掉的永久增益。'); if (o.onCancel) o.onCancel(); return null; }
    const rows = list.map((b, i) => {
      const free = freeIds.indexOf(b.id) >= 0;
      return '<button type="button" class="replace-pick r' + b.rarity + '" data-action="rp' + i + '"' +
        ' title="' + esc(b.name + '：' + (b.desc || '')) + '">' +
        '<span class="rp-name">' + esc(b.name) + '</span>' +
        '<span class="rp-meta">' + (RARITY_SHORT[b.rarity] || '') +
          (b.stacks > 1 ? ' · ×' + b.stacks + ' 层' : '') +
          (free ? ' · <b class="rp-free">虚空铭文·不占位</b>' : '') + '</span>' +
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
  function offerShopReplace(index, buff) {
    offerPermanentReplace({
      prompt: '要买下【' + esc(buff.name) + '】，先拿掉下面哪一个？',
      footNote: '被换掉的那个会从构筑里移除（成长类增益的累计也一起清零）',
      onPick: (b) => {
        const r = Tower.buyShopSlot(index, b.id);
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
      onPick: (b) => { Tower.pickChoice('endless', index, b.id); openEndless(); },
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
    modal('第 ' + rw.layer + ' 层 · 里程碑奖励', '<div class="result-box"><div class="result-title win">再进一步</div>' +
      '<p>你爬到了第 ' + rw.layer + ' 层，结算奖励随机抽取：</p>' +
      '<p class="milestone-reward">' + icon + '<b>' + esc(m.name) + '</b> ×' + m.count + '</p>' +
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
      [{ label: '用 1 枚重新挑战', cls: 'gold', run: () => {
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
  /** 本局隐藏成就汇总（结算/失败弹窗用）。没有成就就返回空串。 */
  function achieveSummaryHtml() {
    const info = Tower.endlessInfo();
    const list = (info && info.run && info.run.achievements) || [];
    if (!list.length) return '';
    const total = list.reduce((a, x) => a + (Number(x.points) || 0), 0);
    return '<div class="achieve-summary"><b>本局隐藏成就 ' + list.length + ' 个 · 合计 +' + total + ' 分</b>' +
      list.map((x) => '<span>' + esc(x.name) + '<i>+' + (Number(x.points) || 0) + '</i></span>').join('') + '</div>';
  }
  /** 退出结算的明细文案（本层应得 + 试炼币 1:1 折现）——三条退出路径统一口径。 */
  function settleBreakdownHtml(r) {
    const layerT = Math.max(0, Math.floor(Number(r && r.layerTickets) || 0));
    const coins = Math.max(0, Math.floor(Number(r && r.forfeitCoins) || 0));
    const tokens = Math.max(0, Math.floor(Number(r && r.retryLeft) || 0));
    const total = Math.max(0, Math.floor(Number(r && r.tickets) || 0));
    if (!coins && !tokens) return '';
    return '<p class="small-label">明细：本层应得 ' + layerT + ' 张' +
      (tokens ? ' + 剩余 ' + tokens + ' 枚铸币 1:1 折现 ' + tokens + ' 张' : '') +
      ' = <b>' + total + '</b> 张' +
      (coins ? '（剩余 ' + coins + ' 试炼币不折现，随本局作废）' : '') + '</p>';
  }
  function endlessDefeat(rw) {
    modal('挑战失败', '<div class="result-box"><div class="result-title lose">倒在了第 ' + rw.layer + ' 层</div>' +
      '<div class="result-lines">本局分数 ' + rw.score + '（历史最高 ' + rw.best + '）</div>' +
      '<p class="gold-text">按当前进度结算：抽奖卷 +' + (rw.tickets || 0) + '（第 ' + rw.layer + ' 层应得）</p>' +
      settleBreakdownHtml(rw) +
      (rw.shield ? '<p class="gold-text">保底奖励：本局到达过 15 层，赠送 1 次免费抽奖（每日限 1 次）！</p>' : '') +
      achieveSummaryHtml() + '</div>',
      [{ label: '再来一局', cls: 'gold', run: openEndless }, { label: '返回', run: () => C().home() }], { small: true });
  }

  /* ============================================================
   * 【U14】无尽：试炼币商店 —— openShop
   * ============================================================ */

  function openShop(revisit) {
    const shop = Tower.shopState();
    if (!shop) { notice('商店还没开张：每通过 5 层开放一次。'); return; }
    /* 门庭若市（C59）：进门就给试炼币 —— 只在第一次渲染这家店时提示。 */
    if (shop.enterCoins && !shop.enterCoinsShown) {
      shop.enterCoinsShown = true;
      runToast('门庭若市：进店获得 ' + shop.enterCoins + ' 试炼币');
    }
    const rarityCls = (r) => 'r' + r;
    /* 注意：这是**商店槽位上报行**的字段 canStack（由 tower.js 用标签算好），
     * 不是增益数据里的字段 —— 旧数据字段 stackable 已经删掉、只留标签。 */
    const stackableOwned = (s) => s.ownedStacks > 0 && s.canStack;
    const slots = shop.slots.map((s, i) =>
      '<div class="shop-slot ' + rarityCls(s.rarity) + (s.sold ? ' sold' : '') +
        (stackableOwned(s) ? ' owned-stack' : '') + '"><b>' + esc(s.name) + '</b>' +
      '<i>' + RARITY[s.rarity] + ' · ' + (SCOPE[s.kind] || '增益') + '</i><span>' + esc(s.desc) + '</span>' +
      (stackableOwned(s) ? '<em class="stack-hint">已有 ×' + s.ownedStacks + ' · 可叠层</em>' : '') +
      (s.sold ? '<em>已购入</em>' : C().btn(s.price + ' 币', 'buy' + i, 'small gold')) + '</div>').join('');
    const owned = Tower.ownedBuffs('endless').filter((b) => b.kind !== 'instant');
    const sellRows = owned.length ? owned.map((b) =>
      '<div class="shop-sell-row">' + buffTag(b, b.stacks) + C().btn('卖出 +' + b.sellPrice, 'sell' + b.id, 'tiny muted') + '</div>').join('') :
      '<div class="small-label">还没有可出售的增益</div>';
    const content = '<div class="tower-shop">' +
      '<h2 class="tower-title">试炼商店 <span class="shop-coins">试炼币 ' + shop.coins + '</span></h2>' +
      '<div class="shop-shelf">' + slots + '</div>' +
      '<div class="shop-extra">' +
      '<div class="shop-slot retry' + (shop.retrySold ? ' sold' : '') + '"><b>铸币</b>' +
      '<i>每次商店限购 1 枚 · 已有 ' + shop.retryToken + ' 枚</i>' +
      '<span>失败时消耗 1 枚，回滚到该场战斗开始前再打一次</span>' +
      (shop.retrySold ? '<em>已购买</em>' : C().btn(shop.retryPrice + ' 币', 'retry', 'small gold')) + '</div>' +
      '<div class="shop-slot reroll"><b>刷新货架</b>' +
      '<i>第 ' + (shop.rerollCount + 1) + ' 次刷新 · ' +
      (shop.rerollFree ? '本次免费' :
        (shop.rerollCapped ? '本次 ' + shop.rerollNextPrice + ' 币（最高价，不再涨）'
          : '本次 ' + shop.rerollNextPrice + ' 币，下次更贵')) + '</i>' +
      '<span>' + (function () {
        const now = TowerData.rerollExpectation(shop.rerollFree ? 0 : shop.rerollNextPrice);
        const nextPaid = shop.rerollFree ? shop.rerollNextPrice : TowerData.rerollPriceAt(shop.rerollCount + 1);
        const nxt = TowerData.rerollExpectation(nextPaid);
        const f = (v) => (Math.round(v * 100) / 100).toFixed(2);
        return '越贵越好：本次期望史诗 ' + f(now.epics) + ' 件、传奇 ' + f(now.weights[3] * (TowerData.SHOP.slots || 5)) +
          ' 件；' + (shop.rerollCapped && !shop.rerollFree
            ? '已到最高价，期望不再提高'
            : '下次（' + nextPaid + ' 币）期望史诗 ' + f(nxt.epics) + ' 件') +
          '。当前拥有与已售出的不会再出现';
      })() + '</span>' +
      C().btn(shop.rerollFree ? '免费刷新' : shop.rerollNextPrice + ' 币刷新', 'reroll', 'small') + '</div></div>' +
      '<h4>出售增益（回收 40%，限次与永久都可卖）</h4><div class="shop-sell">' + sellRows + '</div>' +
      '</div>';
    const p = C().page('challenge', 'stages', content, {
      cls: 'tower-board',
      left: (!revisit && !shop.rest)
        ? '<span class="footer-left">' + C().btn('结算离场', 'settle', 'small gold') + '</span>' : '',
      right: '<span class="footer-right">' + C().btn(revisit || shop.rest ? '返回' : '继续挑战', 'leave', 'gold') + '</span>',
    });
    back(p, () => openEndless());
    shop.slots.forEach((s, i) => on(p, 'buy' + i, () => {
      const r = Tower.buyShopSlot(i);
      if (r && r.needsReplace) { offerShopReplace(i, r.buff); return; }
      if (!r.ok) { notice(r.msg || '买不了。'); return; }
      /* 豪掷千金（C58）：消费达标时当场给了一个随机限次增益，提示一下名字。 */
      const got = r.shopSpend && r.shopSpend.limited;
      if (got && got.length) {
        runToast('豪掷千金：获得「' + got.map((id) => (TowerData.BUFF_BY_ID[id] || {}).name || id).join('」「') + '」');
      }
      openShop(revisit);
    }));
    on(p, 'retry', () => {
      const r = Tower.buyRetryToken();
      if (!r.ok) notice(r.msg || '买不了。');
      else notice('已购买铸币（现有 ' + r.left + ' 枚）。失败时可以选择回滚本场再打一次。');
      openShop(revisit);
    });
    on(p, 'reroll', () => {
      const r = Tower.rerollShop();
      if (!r.ok) notice(r.msg || '刷新失败。');
      else if (r.paid > 0) notice('已花 ' + r.paid + ' 币刷新，本页期望史诗 ' + (r.expect ? r.expect.epics.toFixed(2) : '?') +
        ' 件 · 下次 ' + r.nextPrice + ' 币' + (r.nextPrice === r.paid ? '（已到最高价）' : ''));
      openShop(revisit);
    });
    owned.forEach((b) => on(p, 'sell' + b.id, () => { Tower.sellBuff(b.id); openShop(revisit); }));
    on(p, 'leave', () => {
      if (revisit || shop.rest) { openEndless(); return; }
      Tower.continueFromShop();       // 直接进下一段，不弹结算点窗口
      openEndless();
    });
    on(p, 'settle', () => {
      const out = Tower.settleFromShop();
      if (!out || !out.ok) { notice('现在还不能结算。'); return; }
      modal('本局结算', '<div class="result-box"><div class="result-title win">见好就收</div>' +
        '<p>抽奖卷 +<b class="gold-text">' + (out.tickets || 0) + '</b>（第 ' + out.layer + ' 层）</p>' +
        settleBreakdownHtml(out) +
        '<div class="result-lines">分数 ' + out.score + ' 已入账 · 历史最高 ' + out.best + '</div></div>',
        [{ label: '返回无尽塔', cls: 'gold', run: () => openEndless() }], { small: true });
    });
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
    const cands = orderPermanent(candsAll, (run && run.slotFreeIds) || []);
    const rows = cands.map((x) => {
      const b = x.buff;
      const stack = x.stacks > 1 ? ' <em class="sac-stack">×' + x.stacks + '</em>' : '';
      return '<button class="sac-card" data-sac="' + esc(x.id) + '">' +
        '<b class="q' + (b.rarity || 0) + '">' + esc(b.name) + '</b>' + stack +
        '<span class="sac-desc">' + esc(b.desc || '') + '</span></button>';
    }).join('');
    const p = modal('放弃一个永久增益',
      '<p class="sac-lead">第 ' + esc(run.layer) + ' 层已通过。作为代价，必须永久放弃<b>一个</b>永久增益' +
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
      '<p class="small-label">本局分数 ' + info.score + ' · 试炼币 ' + info.coins + '（不折现，随本局作废）</p></div>',
      [
        { label: '结算离场', cls: 'gold', run: () => { const r = Tower.settleEndless(); if (r.ok) settleResult(r); else openEndless(); } },
        { label: '继续挑战', run: () => { Tower.continueEndless(); fight('endless'); } },
      ], { locked: true });
  }
  function settleResult(r) {
    modal('结算完成', '<div class="result-box"><div class="result-title win">满载而归！</div>' +
      '<div class="result-lines">抽奖卷 +' + r.tickets + '　本局分数 ' + r.score + '</div>' +
      settleBreakdownHtml(r) +
      '<p class="small-label">抽奖卷可在「每日幸运抽奖」里抵扣抽奖次数（免费次数用完后优先消耗）。</p></div>',
      [{ label: '再来一局', cls: 'gold', run: openEndless }, { label: '去抽奖', run: () => { syncTickets();
            if (window.ClassicExtras && ClassicExtras.lottery) ClassicExtras.lottery(); else UI.runAction('lottery'); } }, { label: '返回', run: () => C().home() }], { small: true });
  }

  /* ============================================================
   * 【U17】模块导出 —— window.TowerUI
   * ============================================================ */
  window.TowerUI = { openTower, openEndless };
})();
