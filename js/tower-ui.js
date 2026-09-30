/* ============================================================
 * tower-ui.js — 无尽挑战塔界面（经典 UI 壳内）
 * 入口在「关卡」页下滑；主塔/无尽两个页面都在这里。
 * 爬塔可视化：左侧塔身楼层条 + 右侧当层对手预告/构筑。
 * ============================================================ */
(function () {
  'use strict';
  const C = () => UI.classic;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const find = (root, sel) => root.querySelector(sel);
  function on(root, action, handler) { const el = find(root, '[data-action="' + action + '"]'); if (el) el.onclick = handler; return el; }
  function back(root, handler, label) { const el = on(root, 'home', handler); if (el) el.textContent = label || '返回'; }
  function notice(text, buttons) { C().modal('提示', '<p>' + esc(text) + '</p>', buttons || [{ label: '知道了' }], { small: true }); }

  const RARITY = ['普通', '稀有', '史诗'];
  const SCOPE = { limited: '限次', permanent: '永久', instant: '即时' };
  const MECH_NAME = { thorns: '荆棘反伤', regen: '自愈回复', lifesteal: '吸血', shell: '护盾', devour: '吞噬成长' };
  const MECH_DESC = {
    thorns: '你每次命中它都会受到该次伤害 15% 的反伤',
    regen: '它每回合开始回复 3% 最大生命',
    lifesteal: '它的攻击回复伤害的 30%',
    shell: '它开局带 30% 最大生命的护盾',
    devour: '它每回合结束攻击永久 +2%（本场内无限叠）',
  };
  let replaceTarget = null;   // 第 1 项：永久增益满 5 格时，选中的「要被替换掉」的那个

  // ---------- 通用小件 ----------
  function carryBar(carry, label, cls) {
    const pct = Math.round((carry == null ? 1 : carry) * 100);
    return '<div class="tower-carry' + (cls ? ' ' + cls : '') + '"><span>' + (label || '血量继承') + '</span>' +
      '<div class="tower-carry-bar"><i style="width:' + pct + '%"></i></div><b>' + pct + '%</b></div>';
  }
  /** 悬停气泡：机制说明放在这里（第 1 项需求），预告列表就只需要一行名字。
   *  用 body 上的 fixed 层，避免被 .tower-main 的 overflow 裁掉。 */
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
  /** 一行对手的机制说明（悬停用）：机制 + 出招循环，不带「对策」。
   *  第 9 项：这就是普通 boss 简介，不出现「题面」这类策划词。 */
  function mechTip(info) {
    const parts = [];
    if (info.mechDesc) parts.push(info.mechDesc);
    if (info.patternDesc) parts.push(info.patternDesc);
    return parts.join('\n') || '没有特殊机制';
  }
  /* ---------- 对手头像（第 1 项） ----------
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
  /** 引擎渲染失败（动画/素材缺失）时退回立绘卡，保证列表里总有一张图。 */
  function fallbackPortrait(canvas, info) {
    const file = CHAR_FILE[info.anim] || 'mantis';
    const img = document.createElement('img');
    img.alt = ''; img.src = 'images/classic/characters/' + file + '-classic-card.png';
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
  /** 第 2 项：永久增益的悬停提示 —— 效果说明 + 当前叠层 + 换算后的合计（叠层是乘着生效的）。 */
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
    if (m.winHealPct) parts.push('每场胜利回血合计 ' + Math.round(m.winHealPct * b.stacks * 100) + '%');
    if (m.killPowerPct) parts.push('每击杀攻击 +' + Math.round(m.killPowerPct * b.stacks * 100) + '%');
    if (m.killMaxHpPct) parts.push('每击杀生命上限 +' + Math.round(m.killMaxHpPct * b.stacks * 100) + '%');
    if (m.revivePct) parts.push('复活回血 ' + Math.round(m.revivePct * 100) + '%');
    if (m.globalMul) parts.push('全局增幅 ×' + m.globalMul + (b.stacks > 1 ? '，可叠 ' + b.stacks + ' 层' : ''));
    if (buff.mods && buff.mods.shopDiscount) parts.push('下个商店 5 折');
    parts.push(replaceTarget === b.id ? '（当前已选为替换目标，点一下取消）' : '点一下选它作为要被替换掉的永久增益');
    return parts.join('\n');
  }
  /** 限次增益的悬停说明：效果 + 剩余场次 + 当前开关状态。 */
  function limitTip(b) {
    const buff = TowerData.BUFF_BY_ID[b.id];
    if (!buff) return b.name;
    return [buff.name + '（' + RARITY[b.rarity] + ' · 限次 ' + (buff.uses || 1) + ' 场）', buff.desc,
      '剩余 ' + b.uses + ' 场（每打完一场扣 1，扣完自动消失）',
      b.on ? '当前生效中 · 点一下可以关掉（关掉不扣次数）' : '当前已关闭 · 点一下重新开启'].join('\n');
  }
  /** 第 1 项：无尽主界面的增益面板 —— 永久（最多 5 格）+ 限次（可开关、扣次用完即消失）。 */
  function buffPanelsHtml(mode) {
    const run = mode === 'tower' ? Tower.towerInfo().run : Tower.endlessInfo().run;
    if (!run || mode !== 'endless') return '';
    const list = Tower.ownedBuffs('endless');
    const perm = list.filter((b) => b.kind === 'permanent');
    const lim = list.filter((b) => b.kind === 'limited');
    const cap = TowerData.PERMANENT_SLOTS || 5;
    const permHtml = perm.length
      ? perm.map((b) => '<span class="buff-tag r' + b.rarity + (b.id === replaceTarget ? ' replacing' : '') + '" data-replace="' + b.id +
          '" data-tip="' + esc(permTip(b)) + '" title="' + esc(permTip(b)) + '">' +
          esc(b.name) + '<i>永久</i>' + (b.stacks > 1 ? '<em>×' + b.stacks + '</em>' : '') + '</span>').join('')
      : '<span class="buff-empty">还没有永久增益（每层的休整点可以拿）</span>';
    const limHtml = lim.length
      ? lim.map((b) => '<button type="button" class="limit-tag r' + b.rarity + (b.on ? '' : ' off') + '" data-toggle="' + b.id +
          '" data-tip="' + esc(limitTip(b)) + '" title="' + esc(limitTip(b)) + '">' +
          '<b>' + esc(b.name) + '</b><i>' + (b.on ? '生效中' : '已关闭') + '</i><em>剩 ' + b.uses + ' 场</em></button>').join('')
      : '<span class="buff-empty">还没有限次增益</span>';
    return '<div class="tower-buffs endless-buffs">' +
      '<h4>永久增益 <span class="buff-slot-count">' + perm.length + '/' + cap + '</span>' +
      (replaceTarget ? '<span class="replace-hint">选一个要替换掉的（再点增益卡确认）</span>' : '') + '</h4>' +
      '<div class="buff-tags">' + permHtml + '</div>' +
      '<h4>限次增益 <span class="buff-slot-count">点一下开关</span></h4>' +
      '<div class="buff-tags">' + limHtml + '</div></div>';
  }
  /** 本层削弱（第 5 项）：一张卡 = 来源大侠 + 名字 + 具体数值，
   *  颜色跟着来源走，战斗 HUD 的胶囊、选 buff 页的提示用的是同一份数据。 */
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
  /* 第 6 项：塔页右上角的货币条。主塔看金松果与挑战书，无尽额外看本局试炼币与抽奖卷。 */
  const CURRENCY_PROP = { book: 23, ticket: 50 };
  function currencyHtml(mode) {
    const S = State.state();
    // 第 3 项：无尽塔右上只留文字（试炼币 / 抽奖卷），不带图标、也不显示金松果
    if (mode === 'endless') {
      const run = Tower.endlessInfo().run;
      const items = [];
      if (run) items.push({ name: '试炼币', value: run.coins });
      items.push({ name: '抽奖卷', value: S.props[CURRENCY_PROP.ticket] || 0 });
      return '<div class="tower-currency text-only">' + items.map((it) =>
        '<span class="currency-item"><b>' + it.value + '</b><i>' + it.name + '</i></span>').join('') + '</div>';
    }
    const items = [{ icon: 'images/classic/icons/prop-23.png', name: '挑战书', value: S.props[CURRENCY_PROP.book] || 0 },
      { icon: 'images/classic/icons/prop-1.png', name: '金松果', value: S.goldPoint }];
    return '<div class="tower-currency">' + items.map((it) =>
      '<span class="currency-item" data-live-gold="' + (it.name === '金松果' ? '1' : '') + '">' +
      '<img alt="" src="' + it.icon + '"><b>' + it.value + '</b><i>' + it.name + '</i></span>').join('') + '</div>';
  }
  /** 第 1 项：无尽塔右上角的三个属性药丸槽位（点一下从背包里嵌一颗，塔内持续 20 场）。 */
  function pillSlotsHtml(pillSlots) {
    const S = State.state();
    const slots = pillSlots || {};
    return '<div class="pill-slots">' + (TowerData.PILL_SLOTS || []).map((def) => {
      const cur = slots[def.key];
      const eff = cur && TowerData.pillEffect(cur.id);
      const icon = 'images/classic/icons/prop-' + (cur ? cur.id : def.ids[0]) + '.png';
      const tip = cur
        ? (propName(cur.id) + '：' + def.name + ' ' + (eff && eff.pct === 0.4 ? '+40%' : '+20%') + '，还剩 ' + cur.battles + ' 场')
        : '点一下嵌入' + def.name + '药丸（背包里有：' + def.ids.map((id) => (S.props[id] || 0) + '×' + propName(id)).join('、') + '）';
      return '<button type="button" class="pill-slot' + (cur ? ' filled' : '') + '" data-pill="' + def.key + '" title="' + esc(tip) + '">' +
        (cur ? '<img alt="" src="' + icon + '"><b>' + cur.battles + '</b>' : '<span class="pill-plus">+</span>') +
        '</button>';
    }).join('') + '</div>';
  }
  function propName(id) {
    try { const p = propMap.getValue(id); return p ? p.name : ('道具' + id); } catch (e) { return '道具' + id; }
  }
  /** 左侧塔身：当前层附近的一段楼层，自上而下。 */
  function towerVisual(layer, maxLayer, mode) {
    const top = Math.max(layer + 4, 6), bottom = Math.max(1, layer - 3);
    let floors = '';
    for (let i = top; i >= bottom; i--) {
      const cls = i < layer || (mode === 'tower' && i <= maxLayer) ? 'done' : i === layer ? 'now' : 'todo';
      floors += '<div class="tower-floor ' + cls + (i % 10 === 0 ? ' elite-floor' : i % 5 === 0 ? ' fifth-floor' : '') + '">' +
        (i === layer ? '<span class="tower-marker" aria-hidden="true"></span>' : '') + '<span class="tower-floor-no">' + i + '</span></div>';
    }
    // 下一个里程碑（5 的倍数层 / 10 的倍数层）提示，让玩家知道还有几层到商店或精英
    const next5 = Math.ceil((layer + 0.0001) / 5) * 5;
    const toElite = next5 % 10 === 0;
    // 第 1 项：无尽塔只留「本局第 N 层」，不再写「再 X 层是第 Y 层」
    const caption = mode === 'tower'
      ? '已通关 ' + maxLayer + ' 层' + '<br><span class="tower-caption-hint">再 ' + (next5 - layer) + ' 层是' + (toElite ? '第 ' + next5 + ' 层精英' : '第 ' + next5 + ' 层') + '</span>'
      : '本局第 ' + layer + ' 层';
    return '<div class="tower-visual" aria-label="塔层进度"><div class="tower-floors">' + floors + '</div>' +
      '<div class="tower-visual-caption">' + caption + '</div></div>';
  }
  /* 第 1 项：对手从左到右排成一行「小人像 + 名字 + 类型」，
   * 机制还是挂在悬停气泡上（列表本身不占高度），松鼠形态会把装备一起画出来。 */
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

  // ---------- 主塔 ----------
  function openTower() {
    const info = Tower.towerInfo();
    let main, footer = null;
    if (info.run) {
      const run = info.run;
      main = '<div class="tower-head"><h2 class="tower-title">第 ' + run.layer + ' 层 · 第 ' + run.battleNo + '/' + run.battleCount + ' 场</h2>' +
        '<div class="tower-stats">已累积松果 <b class="gold-text">' + run.pot + '</b>（失败只保底 30%）</div></div>' +
        currencyHtml('tower') +
        carryBar(run.carry) + debuffPanel(run.debuffs) + ownedBuffsHtml('tower') +
        '<div class="tower-actions">' + C().btn('继续战斗', 'fight', 'gold') + C().btn('放弃本层', 'abandon', 'muted small') + '</div>';
    } else {
      // 第 1 项：标题与数据并排、规则压成一行，保证一屏能放下 5 行预告 + 开始按钮
      main = '<div class="tower-head"><h2 class="tower-title">无尽挑战塔 · 第 ' + info.nextLayer + ' 层</h2>' +
        '<div class="tower-stats">目标等级 ' + info.level + ' · 强度 ×' + info.mult.toFixed(2) + ' · ' + info.battles + ' 场连战 · 通关金松果 <b class="gold-text">' + info.gold + '</b></div></div>' +
        currencyHtml('tower') +
        /* 把「三侠削弱」提示并进规则行（右上角多了货币条，版面高度要省下来），
         * 具体数值仍挂在悬停气泡里，信息不丢。 */
        '<p class="tower-rule" title="' + esc(heroDebuffTips()) + '">每层 1 张挑战书 · 连战只继承血量 · 对手顺序每层随机 · ' +
        '三侠的大招会留贯穿本层的削弱（速杀可规避）· 通关另补 3 场挑战的掉落 · 悬停看机制</p>' +
        '<h4 class="tower-plan-title">本层对手预告</h4>' + planHtml(info.preview);
      // 「开始挑战」在卡片右下角；挑战书数量放在它**左边**（第 1 项），按钮因此贴到最右
      footer = '<div class="tower-actions tower-footer">' +
        '<span class="tower-book-count">现有挑战书 ' + info.books + ' 张</span>' +
        C().btn('开始挑战（挑战书×1）', 'fight', 'gold') + '</div>';
    }
    const content = '<div class="tower-page' + (footer ? ' has-footer' : '') + '">' + towerVisual(info.nextLayer, info.maxLayer, 'tower') +
      '<div class="tower-main">' + main + '</div>' + (footer || '') + '</div>';
    const p = C().page('challenge', 'stages', content, { cls: 'tower-board' });
    bindTips(p);
    if (!info.run) fillFoeArt(p, info.preview);
    back(p, () => UI.runAction('stages'));
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
      C().modal('放弃挑战', '<p>放弃后本局已累积的松果将全部失去（也没有安慰奖），确定吗？</p>', [
        { label: '放弃', cls: 'muted', run: () => { Tower.abandon('tower'); openTower(); } },
        { label: '继续挑战', cls: 'gold' },
      ], { small: true });
    });
  }

  // ---------- 无尽 ----------
  function openEndless() {
    const info = Tower.endlessInfo();
    let main, footer = null;
    if (info.run) {
      const run = info.run;
      const nextLabel = run.choices ? '先选一张增益' : run.phase === 'shop' ? '进入试炼商店' : run.phase === 'checkpoint' ? '前往结算点' : '继续战斗';
      /* 第 2 项版面：左上角是三个属性药丸槽；下面紧贴标题一行小字只有分数；
       * 「当前遭遇的机制」下面直接跟已获得的增益（永久 / 限次），保证一屏看完不用下翻；
       * 本层对手缩成右侧竖排 1/2/3/4。 */
      const foes = Tower.preview(run.layer);   // 与 buildPlan 同源（run.plan 快照在页面重绘时可能还没刷新）
      const foeRows = foes.map((b, i) =>
        '<li class="' + (b.elite ? 'elite' : '') + (b.squirrel ? ' squirrel' : '') + '" tabindex="0" data-tip="' + esc(mechTip(b)) + '">' +
        foePortraitHtml(i, b) +
        '<b>' + esc(b.name) + '</b>' + (b.type ? '<span class="tower-plan-type">' + esc(b.type) + '</span>' : '') +
        (b.elite ? '<em class="elite-tag">精英</em>' : '') + '</li>').join('');
      const choicesHtml = run.choices
        ? '<div class="tower-buffs choice-onpage"><h4>休整点 · 选一张带走</h4><div class="hex-row">' +
          run.choices.map((c, i) => choiceCard(c, i)).join('') + '</div></div>' : '';
      /* 顶栏：标题 → 试炼币/抽奖卷 → 分数框 → 右边缘的三个药丸槽（等腰三角摆放）。
       * 血量紧贴标题下方（分数已经挪进顶栏，所以这里整体上提），字号与血条都放大一档；
       * 「继续战斗」在右下角，「放弃本局」更小、压在它左边偏下。 */
      main = '<div class="endless-run">' +
        '<div class="endless-topright">' + pillSlotsHtml(run.pillSlots) + currencyHtml('endless') +
        '<span class="endless-score-box"><i>分数</i><b>' + run.score + '</b></span></div>' +
        '<div class="endless-left">' +
        '<div class="endless-title-row"><h2 class="tower-title">无尽模式 · 第 ' + run.layer + ' 层（第 ' + run.segment + ' 段）</h2>' +
        '</div>' +
        carryBar(run.carry, '血量', 'endless-hp') +
        '<div class="tower-rule mech-bar"><b>当前遭遇的机制</b>' + (info.mechs && info.mechs.length
          ? info.mechs.map((m) => '<span class="mech-chip">' + esc(MECH_NAME[m] || m) + '<i>' + esc(MECH_DESC[m] || '') + '</i></span>').join('')
          : '<span class="mech-none">本段没有额外机制（第 1 段）</span>') + '</div>' +
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
        '<p class="tower-rule">免门票，从 1 层冲分。跨层自动回复 20% 生命。每 5 层进商店并可结算离场拿抽奖卷：20 层前翻倍（1/2/4/8），之后每段 +3；中途失败也不再归零，按当前层应得结算；每爬 10 层额外随机一份里程碑奖励（技能卷轴×10 / 武器卷轴×10 / 随机药丸）。怪物每段 ×1.5 并叠加机制，撑得越久越刺激。</p>';
      footer = '<div class="tower-actions tower-footer">' +
        '<span class="tower-book-count">现有抽奖卷 ' + info.tickets + ' 张</span>' +
        C().btn('开始冲塔（免费）', 'fight', 'gold') + '</div>';
    }
    const content = '<div class="tower-page' + (footer ? ' has-footer' : '') + '">' + towerVisual(info.run ? info.run.layer : 1, 0, 'endless') +
      '<div class="tower-main">' + main + '</div>' + (footer || '') + '</div>';
    const p = C().page('challenge', 'stages', content, { cls: 'tower-board' });
    bindTips(p);
    if (info.run) fillFoeArt(p, Tower.preview(info.run.layer));   // 第 3 项：松鼠类对手是 canvas，要等素材画上去
    back(p, () => UI.runAction('stages'));
    on(p, 'fight', () => {
      if (info.run) {
        if (info.run.choices) { notice('先在下面选一张增益（休整点）。'); return; }
        if (info.run.phase === 'shop') { openShop(); return; }
        if (info.run.phase === 'checkpoint') { openCheckpoint(); return; }
        fight('endless');
        return;
      }
      const started = Tower.startEndlessRun();
      if (!started.ok) { notice(started.msg); return; }
      fight('endless');
    });
    on(p, 'shop', () => openShop(true));
    p.querySelectorAll('[data-pill]').forEach((el) => {
      el.onclick = () => choosePill(el.dataset.pill);
    });
    on(p, 'rest-shop', () => {
      const res = Tower.openRestShop();
      if (!res.ok) { notice(res.msg || '现在不能开商店。'); return; }
      openShop();
    });
    on(p, 'abandon', () => {
      C().modal('放弃本局', '<p>放弃后按当前层应得的抽奖卷结算（分数照常入账），确定吗？</p>', [
        { label: '放弃', cls: 'muted', run: () => { Tower.abandon('endless'); openEndless(); } },
        { label: '继续冲塔', cls: 'gold' },
      ], { small: true });
    });
  }

  // ---------- 战斗闭环 ----------
  function reopen(mode) { if (mode === 'tower') openTower(); else openEndless(); }
  function fight(mode) {
    const nx = Tower.nextBattle(mode);
    if (!nx.ok) { reopen(mode); if (nx.msg) notice(nx.msg); return; }
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
        // 塔里的战斗不许跳过（否则整层白给），右下角改成 1×/2× 倍速切换
        allowSkip: false, speedToggle: true,
        // 塔的产出全部由状态机结算（松果/压缩碎片/抽奖卷），关掉战斗飘物，
        // 否则免门票的无尽模式可以无限刷飘物松果与经验。
        collectDrops: false,
        onError: () => Tower.interruptBattle(mode, nx.token),
        onEnd: (w, r) => {
          const hp = r && Array.isArray(r.hpAfter) ? r.hpAfter[0] : null, cap = r && Array.isArray(r.maxHp) ? r.maxHp[0] : 0;
          const ratio = w === 0 && Number.isFinite(hp) && cap > 0 ? Math.max(0, Math.min(1, hp / cap)) : 0;
          const rw = Tower.reportBattle(mode, nx.token, w === 0, ratio);
          reopen(mode);
          if (!rw.ok) return;                 // 令牌已作废的迟到回调，静默忽略
          afterBattle(mode, rw);
        },
      })).catch(interrupted);
    } catch (error) { interrupted(); }
  }
  /** 一场胜利后的「下一场」弹窗（里程碑奖励弹完也回到这里）。 */
  function winModal(mode, rw) {
    C().modal('战斗胜利', '<div class="result-box"><div class="result-title win">胜 利！</div>' +
      '<p>' + (mode === 'tower' ? '已累积松果 ' + rw.potGold : '分数 ' + rw.score + ' · 试炼币 ' + rw.coins) + '</p></div>',
      [{ label: '下一场', cls: 'gold', run: () => fight(mode) }], { small: true });
  }
  function afterBattle(mode, rw) {
    if (!rw.win) { mode === 'tower' ? towerDefeat(rw) : endlessDefeat(rw); return; }
    /* 第 1 项：无尽塔不搞弹窗 —— 一场打完（含休整点）直接回主界面，
     * 选增益、开关限次、看对手都在主界面上做；选完也不弹「继续战斗」，
     * 由玩家自己点主界面的按钮进下一场。主塔的弹窗流程保持不变。 */
    if (mode === 'endless') {
      const cont = () => { if (rw.layerComplete && rw.phase === 'shop') openShop(); else openEndless(); };
      if (rw.milestone) { milestoneModal(rw, cont); return; }
      cont();
      return;
    }
    if (rw.choices) { offerChoice(mode, rw.choices); return; }
    if (rw.layerComplete) { towerClear(rw); return; }
    winModal(mode, rw);
  }

  // ---------- 场间 4 选 1 ----------
  /* 场间选 buff（第 4 项）：改成「海克斯」式 —— 卡片自己就是框，
   * 外面不再套一层 modal 的奶油底板（.choice-dialog.hex 把 modal 本身做成透明的）。
   * 卡片按稀有度上色：普通/稀有/史诗 + 回血。 */
  const RARITY_CLASS = ['r0', 'r1', 'r2'];
  function choiceCard(c, i) {
    if (c.type === 'heal') {
      return '<button type="button" class="hex-card heal" data-choice="' + i + '">' +
        '<span class="hex-ribbon">补给</span>' +
        '<span class="hex-emblem">✚</span>' +
        '<b class="hex-name">紧急包扎</b>' +
        '<span class="hex-scope">立即生效</span>' +
        '<span class="hex-desc">回复 ' + Math.round(TowerData.FIXED_HEAL_PCT * 100) + '% 最大生命</span></button>';
    }
    const b = TowerData.BUFF_BY_ID[c.id];
    return '<button type="button" class="hex-card ' + RARITY_CLASS[b.rarity] + '" data-choice="' + i + '">' +
      '<span class="hex-ribbon">' + RARITY[b.rarity] + '</span>' +
      '<span class="hex-emblem">' + (b.rarity === 2 ? '★' : b.rarity === 1 ? '◆' : '●') + '</span>' +
      '<b class="hex-name">' + esc(b.name) + '</b>' +
      '<span class="hex-scope">' + SCOPE[b.kind] + (b.kind === 'limited' ? ' · ' + (b.uses || 1) + ' 场' : '') + '</span>' +
      '<span class="hex-desc">' + esc(b.desc) + '</span></button>';
  }
  function offerChoice(mode, choices) {
    const info = mode === 'tower' ? Tower.towerInfo() : Tower.endlessInfo();
    const run = info.run || {};
    const debuffs = (run.debuffs || []);
    const next = run.next;
    // 第 6 项：选 buff 之前先把「下一场是谁、有什么机制」摊开，
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
      (debuffs.length
        ? '<div class="hex-debuffs"><span class="hex-debuff-label">本层已被削弱（贯穿本层）</span>' +
          debuffs.map((d) => '<span class="hex-debuff" style="--hero-color:' + esc(d.color || '#7a4a18') + '">' +
            '<i>' + esc(d.short || d.hero || '大侠') + '</i>' + esc(d.text || d.name) + '</span>').join('') + '</div>'
        : '') +
      '</div>';
    const body = head + '<div class="hex-cards">' + choices.map(choiceCard).join('') + '</div>';
    const m = C().modal('', body, [], { locked: true });
    m.element.classList.add('choice-dialog', 'hex');
    m.element.querySelectorAll('[data-choice]').forEach((el) => {
      el.onclick = () => {
        const picked = Tower.pickChoice(mode, Number(el.dataset.choice));
        m.close();
        if (!picked.ok) { reopen(mode); return; }
        const text = picked.heal ? '回复了 ' + Math.round(TowerData.FIXED_HEAL_PCT * 100) + '% 最大生命，状态满满！'
          : '获得增益「' + picked.buff.name + '」：' + picked.buff.desc;
        C().modal('休整完毕', '<p>' + esc(text) + '</p>', [{ label: '继续战斗', cls: 'gold', run: () => fight(mode) }], { small: true });
      };
    });
  }

  // ---------- 主塔结算 ----------
  function towerClear(rw) {
    const prizes = (rw.prizes && rw.prizes.items) || [];
    const prizeLine = prizes.length
      ? '<div class="result-lines">悬浮奖品（3 场挑战的量）：' +
        prizes.map((p) => esc(p.name) + ' ×' + p.count).join('　') + '</div>'
      : '';
    C().modal('层数通关', '<div class="result-box"><div class="result-title win">第 ' + rw.layer + ' 层通关！</div>' +
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
  /* 主塔失败（第 1 项）：不再逼你重头打 —— 就地再战一次（免费），而且可以换一张 buff；
   * 想收手就「结束本层」拿 30% 安慰奖。 */
  function towerDefeat(rw) {
    C().modal('倒下在第 ' + (rw.battleNo || '?') + ' 场', '<div class="result-box"><div class="result-title lose">再接再厉</div>' +
      '<p>第 ' + rw.layer + ' 层第 ' + (rw.battleNo || '?') + '/' + (rw.battleCount || 4) + ' 场失败。</p>' +
      '<p class="gold-text">进度已保留：再战一次不用再花挑战书，也可以换一张增益。</p>' +
      '<div class="result-lines">收手的话，已累积的 ' + rw.potGold + ' 松果可换 30% 安慰奖</div></div>',
      [{ label: '再战一次', cls: 'gold', run: () => { if (rw.choices && rw.choices.length) offerChoice('tower', rw.choices); else fight('tower'); } },
       { label: '结束本层', cls: 'muted', run: () => {
          const out = Tower.giveUp('tower');
          C().modal('本层结束', '<p>安慰奖：金松果 +' + (out.consolation || 0) + '</p>',
            [{ label: '返回', cls: 'gold', run: () => C().home() }], { small: true });
        } },
       { label: '返回', run: () => C().home() }], { small: true });
  }
  /** 第 1 项：点药丸槽位 → 列出背包里该属性的药丸（普通/超级），选一颗嵌进去。 */
  function choosePill(key) {
    const run = Tower.endlessInfo().run;
    if (!run) return;
    const def = (TowerData.PILL_SLOTS || []).find((x) => x.key === key);
    if (!def) return;
    const S = State.state();
    const rows = def.ids.map((id) => {
      const have = S.props[id] || 0;
      const eff = TowerData.pillEffect(id);
      return '<div class="pill-choice' + (have ? '' : ' empty') + '"><img alt="" src="images/classic/icons/prop-' + id + '.png">' +
        '<div><b>' + esc(propName(id)) + '</b><span>' + def.name + ' +' + (eff.pct === 0.4 ? '40%' : '20%') +
        '（最少 ' + eff.min + ' 点）· 塔内 ' + TowerData.PILL_BATTLES + ' 场</span><i>背包 ' + have + ' 颗</i></div></div>';
    }).join('');
    const buttons = def.ids.filter((id) => (S.props[id] || 0) > 0).map((id) => ({
      label: '嵌入 ' + propName(id), cls: 'small gold',
      run: () => {
        const res = Tower.usePillSlot(key, id);
        if (!res.ok) { notice(res.msg); return; }
        openEndless();
      },
    }));
    buttons.push({ label: '返回', cls: 'muted', run: () => openEndless() });
    C().modal('嵌入' + def.name + '药丸', '<div class="pill-picker">' + rows + '</div>' +
      '<p class="small-label">药丸在无尽塔内持续 ' + TowerData.PILL_BATTLES + ' 场战斗（胜败都算），会扣背包里的道具。</p>',
      buttons, { small: true });
  }
  /** 永久增益满 5 格时：直接把「替换哪一个」摆出来选（比让玩家先点上面的标签直观）。 */
  function offerReplace(index, buff) {
    const list = Tower.ownedBuffs('endless').filter((b) => b.kind === 'permanent');
    const buttons = list.map((b) => ({
      label: '换成 ' + b.name + (b.stacks > 1 ? '（×' + b.stacks + '）' : ''),
      cls: 'small',
      run: () => { Tower.pickChoice('endless', index, b.id); openEndless(); },
    }));
    if (!buttons.length) { notice('永久增益已满，但没有可替换的目标。'); return; }
    buttons.push({ label: '取消', cls: 'muted', run: () => openEndless() });
    C().modal('永久增益已满 5 格', '<p>要拿下【' + esc(buff.name) + '】，请选择替换掉哪一个：</p>' +
      '<div class="replace-list">' + list.map((b) => '<div class="replace-row"><b>' + esc(b.name) + '</b><span>' + esc(b.desc || '') + '</span></div>').join('') + '</div>',
      buttons, { small: true });
  }
  /** 每 10 层的里程碑奖励（技能卷轴×10 / 武器卷轴×10 / 随机药丸）。 */
  function milestoneModal(rw, next) {
    const m = rw.milestone;
    const icon = C().icon ? C().icon('prop', m.propId) : '';
    C().modal('第 ' + rw.layer + ' 层 · 里程碑奖励', '<div class="result-box"><div class="result-title win">再进一步</div>' +
      '<p>你爬到了第 ' + rw.layer + ' 层，结算奖励随机抽取：</p>' +
      '<p class="milestone-reward">' + icon + '<b>' + esc(m.name) + '</b> ×' + m.count + '</p>' +
      '<div class="result-lines">已放入背包（每 10 层一次）</div></div>',
      [{ label: '继续', cls: 'gold', run: next }], { small: true });
  }
  function endlessDefeat(rw) {
    // 第 3 项：失败不再归零 —— 直接按当前层应得的抽奖卷结算
    C().modal('挑战失败', '<div class="result-box"><div class="result-title lose">倒在了第 ' + rw.layer + ' 层</div>' +
      '<div class="result-lines">本局分数 ' + rw.score + '（历史最高 ' + rw.best + '）</div>' +
      '<p class="gold-text">按当前进度结算：抽奖卷 +' + (rw.tickets || 0) + '（第 ' + rw.layer + ' 层应得）</p>' +
      (rw.shield ? '<p class="gold-text">保底奖励：本局到达过 15 层，赠送 1 次免费抽奖（每日限 1 次）！</p>' : '') + '</div>',
      [{ label: '再来一局', cls: 'gold', run: openEndless }, { label: '返回', run: () => C().home() }], { small: true });
  }

  // ---------- 无尽：试炼币商店 ----------
  function openShop(revisit) {
    const shop = Tower.shopState();
    if (!shop) { notice('商店还没开张：每通过 5 层开放一次。'); return; }
    const rarityCls = (r) => 'r' + r;
    const slots = shop.slots.map((s, i) =>
      '<div class="shop-slot ' + rarityCls(s.rarity) + (s.sold ? ' sold' : '') + '"><b>' + esc(s.name) + '</b>' +
      '<i>' + RARITY[s.rarity] + ' · ' + (SCOPE[s.kind] || '增益') + '</i><span>' + esc(s.desc) + '</span>' +
      (s.sold ? '<em>已购入</em>' : C().btn(s.price + ' 币', 'buy' + i, 'small gold')) + '</div>').join('');
    const owned = Tower.ownedBuffs('endless').filter((b) => b.kind !== 'instant');
    const sellRows = owned.length ? owned.map((b) =>
      '<div class="shop-sell-row">' + buffTag(b, b.stacks) + C().btn('卖出 +' + b.sellPrice, 'sell' + b.id, 'tiny muted') + '</div>').join('') :
      '<div class="small-label">还没有可出售的本层/跨层增益</div>';
    const content = '<div class="tower-shop">' +
      '<h2 class="tower-title">试炼商店 <span class="shop-coins">试炼币 ' + shop.coins + '</span></h2>' +
      '<div class="shop-shelf">' + slots + '</div>' +
      '<div class="shop-extra">' +
      '<div class="shop-slot heal' + (shop.healSold ? ' sold' : '') + '"><b>治疗泉水</b><i>每次商店限购 1 份</i><span>回复 40% 最大生命</span>' +
      (shop.healSold ? '<em>已购买</em>' : C().btn(shop.healPrice + ' 币', 'heal', 'small gold')) + '</div>' +
      '<div class="shop-slot reroll"><b>刷新货架</b><i>重新 Roll 5 个增益</i><span>当前拥有与已售出的不会再出现</span>' +
      C().btn(shop.rerollFree ? '免费刷新' : shop.rerollPrice + ' 币刷新', 'reroll', 'small') + '</div></div>' +
      '<h4>出售增益（回收 40%）</h4><div class="shop-sell">' + sellRows + '</div>' +
      '</div>';
    const p = C().page('challenge', 'stages', content, {
      cls: 'tower-board',
      right: '<span class="footer-right">' + C().btn(revisit ? '返回' : '离开商店，进入结算', 'leave', 'gold small') + '</span>',
    });
    back(p, () => revisit ? openEndless() : C().home());
    shop.slots.forEach((s, i) => on(p, 'buy' + i, () => {
      const r = Tower.buyShopSlot(i);
      if (!r.ok) { notice(r.msg || '买不了。'); return; }
      openShop(revisit);
    }));
    on(p, 'heal', () => { const r = Tower.buyShopHeal(); if (!r.ok) notice(r.msg || '买不了。'); openShop(revisit); });
    on(p, 'reroll', () => { const r = Tower.rerollShop(); if (!r.ok) notice(r.msg || '刷新失败。'); openShop(revisit); });
    owned.forEach((b) => on(p, 'sell' + b.id, () => { Tower.sellBuff(b.id); openShop(revisit); }));
    on(p, 'leave', () => {
      if (revisit) { openEndless(); return; }
      Tower.closeShop();
      openCheckpoint();
    });
  }

  // ---------- 无尽：结算点 ----------
  function openCheckpoint() {
    const info = Tower.checkpointInfo();
    if (!info) { openEndless(); return; }
    C().modal('结算点 · 第 ' + info.layer + ' 层', '<div class="checkpoint-box">' +
      '<div class="checkpoint-option"><b>结算离场</b><span>立刻领取 <b class="gold-text">' + info.ticketsNow + '</b> 张抽奖卷，本局结束（分数入账）</span></div>' +
      '<div class="checkpoint-option"><b>继续挑战</b><span>撑到第 ' + info.nextCheckpoint + ' 层可得 <b class="gold-text">' + info.ticketsNext + '</b> 张；中途失败也会按当时层数应得结算</span></div>' +
      '<p class="small-label">本局分数 ' + info.score + ' · 试炼币 ' + info.coins + '</p></div>',
      [
        { label: '结算离场', cls: 'gold', run: () => { const r = Tower.settleEndless(); if (r.ok) settleResult(r); else openEndless(); } },
        { label: '继续挑战', run: () => { Tower.continueEndless(); fight('endless'); } },
      ], { locked: true });
  }
  function settleResult(r) {
    C().modal('结算完成', '<div class="result-box"><div class="result-title win">满载而归！</div>' +
      '<div class="result-lines">抽奖卷 +' + r.tickets + '　本局分数 ' + r.score + '</div>' +
      '<p class="small-label">抽奖卷可在「每日幸运抽奖」里抵扣抽奖次数（免费次数用完后优先消耗）。</p></div>',
      [{ label: '再来一局', cls: 'gold', run: openEndless }, { label: '去抽奖', run: () => UI.runAction('lottery') }, { label: '返回', run: () => C().home() }], { small: true });
  }

  window.TowerUI = { openTower, openEndless };
})();
