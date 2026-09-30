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
  const SCOPE = { battle: '单场', layer: '本层', run: '跨层' };

  // ---------- 通用小件 ----------
  function carryBar(carry) {
    const pct = Math.round((carry == null ? 1 : carry) * 100);
    return '<div class="tower-carry"><span>血量继承</span><div class="tower-carry-bar"><i style="width:' + pct + '%"></i></div><b>' + pct + '%</b></div>';
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
  /** 三侠的招牌技会留削弱（速杀可规避）——入口页先给一句提示，悬停看三条具体效果。 */
  function heroDebuffHint() {
    if (!TowerData.HERO_DEBUFF) return '';
    const tips = ['tl', 'xh', 'xm'].map((k) => TowerData.HERO_DEBUFF[k]).filter(Boolean)
      .map((d) => '· ' + d.name + '：' + d.desc).join('\n');
    return '<p class="tower-rule tower-rule-hint" title="' + esc(tips) +
      '">三侠的招牌技会给本层留下削弱（' + esc(tips.split('\n').map((t) => t.split('：')[0].slice(2)).join(' / ')) +
      '），速杀可以规避 · 悬停看具体数值</p>';
  }
  function buffTag(b, stacks) {
    return '<span class="buff-tag r' + b.rarity + '" title="' + esc(b.desc) + '">' + esc(b.name) +
      '<i>' + SCOPE[b.scope] + '</i>' + (stacks > 1 ? '<em>×' + stacks + '</em>' : '') + '</span>';
  }
  function ownedBuffsHtml(mode) {
    const list = Tower.ownedBuffs(mode);
    if (!list.length) return '';
    return '<div class="tower-buffs"><h4>本局构筑</h4><div class="buff-tags">' +
      list.map((b) => buffTag(b, b.stacks)).join('') + '</div></div>';
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
    const caption = (mode === 'tower' ? '已通关 ' + maxLayer + ' 层' : '本局第 ' + layer + ' 层') +
      '<br><span class="tower-caption-hint">再 ' + (next5 - layer) + ' 层是' + (toElite ? '第 ' + next5 + ' 层精英' : '第 ' + next5 + ' 层') + '</span>';
    return '<div class="tower-visual" aria-label="塔层进度"><div class="tower-floors">' + floors + '</div>' +
      '<div class="tower-visual-caption">' + caption + '</div></div>';
  }
  /* 第 1 项：对手从左到右排成一行「小人像 + 名字 + 类型」，
   * 机制还是挂在悬停气泡上（列表本身不占高度），松鼠形态会把装备一起画出来。 */
  function planHtml(preview) {
    return '<ol class="tower-plan">' + preview.map((b, i) =>
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
      main = '<h2 class="tower-title">第 ' + run.layer + ' 层 · 第 ' + run.battleNo + '/' + run.battleCount + ' 场</h2>' +
        '<div class="tower-stats">已累积松果 <b class="gold-text">' + run.pot + '</b>（失败只保底 30%）</div>' +
        carryBar(run.carry) + debuffPanel(run.debuffs) + ownedBuffsHtml('tower') +
        '<div class="tower-actions">' + C().btn('继续战斗', 'fight', 'gold') + C().btn('放弃本层', 'abandon', 'muted small') + '</div>';
    } else {
      // 第 1 项：标题与数据并排、规则压成一行，保证一屏能放下 5 行预告 + 开始按钮
      main = '<div class="tower-head"><h2 class="tower-title">无尽挑战塔 · 第 ' + info.nextLayer + ' 层</h2>' +
        '<div class="tower-stats">目标等级 ' + info.level + ' · 强度 ×' + info.mult.toFixed(2) + ' · ' + info.battles + ' 场连战 · 通关金松果 <b class="gold-text">' + info.gold + '</b></div></div>' +
        '<p class="tower-rule" title="第 4 场是随机 boss；三侠顺序每层随机。悬停任意对手可以看它的机制与出招循环">每层 1 张挑战书 · 连战只继承血量 · 对手顺序每层随机（悬停看机制）· 通关另补 3 场挑战的掉落</p>' +
        heroDebuffHint() +
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
      const nextLabel = run.choices ? '场间休整（四选一）' : run.phase === 'shop' ? '进入试炼商店' : run.phase === 'checkpoint' ? '前往结算点' : '继续战斗';
      main = '<h2 class="tower-title">无尽模式 · 第 ' + run.layer + ' 层（第 ' + run.segment + ' 段）</h2>' +
        '<div class="tower-stats">分数 <b class="gold-text">' + run.score + '</b> · 试炼币 <b class="gold-text">' + run.coins + '</b> · 现在离场可得抽奖卷 <b>' + run.ticketsIfSettle + '</b> 张（需到 5 的倍数层结算）</div>' +
        '<div class="tower-stats small">第 ' + run.battleNo + '/' + run.battleCount + ' 场 · 本局最深 ' + run.bestLayer + ' 层</div>' +
        carryBar(run.carry) + debuffPanel(run.debuffs) + ownedBuffsHtml('endless') +
        '<div class="tower-actions">' + C().btn(nextLabel, 'fight', 'gold') +
        (Tower.shopState() ? C().btn('试炼商店', 'shop', 'small') : '') +
        C().btn('放弃本局', 'abandon', 'muted small') + '</div>';
    } else {
      main = '<h2 class="tower-title">无尽模式</h2>' +
        '<div class="tower-stats">历史最高 <b class="gold-text">' + info.best + '</b> 分 · 本周最高 ' + info.weekBest + ' 分 · 最深 ' + info.bestLayer + ' 层</div>' +
        '<p class="tower-rule">免门票，从 1 层冲分。每 5 层进商店并可结算离场拿抽奖卷：20 层前翻倍（1/2/4/8），之后每段 +3；中途失败卷作废。怪物每段 ×1.5 并叠加机制，撑得越久越刺激。</p>';
      footer = '<div class="tower-actions tower-footer">' +
        '<span class="tower-book-count">现有抽奖卷 ' + info.tickets + ' 张</span>' +
        C().btn('开始冲塔（免费）', 'fight', 'gold') + '</div>';
    }
    const content = '<div class="tower-page' + (footer ? ' has-footer' : '') + '">' + towerVisual(info.run ? info.run.layer : 1, 0, 'endless') +
      '<div class="tower-main">' + main + '</div>' + (footer || '') + '</div>';
    const p = C().page('challenge', 'stages', content, { cls: 'tower-board' });
    bindTips(p);
    back(p, () => UI.runAction('stages'));
    on(p, 'fight', () => {
      if (info.run) {
        if (info.run.choices) { offerChoice('endless', info.run.choices); return; }
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
    on(p, 'abandon', () => {
      C().modal('放弃本局', '<p>放弃后未结算的抽奖卷全部作废（分数仍会入账），确定吗？</p>', [
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
  function afterBattle(mode, rw) {
    if (!rw.win) { mode === 'tower' ? towerDefeat(rw) : endlessDefeat(rw); return; }
    if (rw.choices) { offerChoice(mode, rw.choices); return; }
    if (rw.layerComplete) {
      if (mode === 'tower') { towerClear(rw); return; }
      if (rw.phase === 'shop') { openShop(); return; }
    }
    // 普通一场胜利：直接给「下一场」
    C().modal('战斗胜利', '<div class="result-box"><div class="result-title win">胜 利！</div>' +
      '<p>' + (mode === 'tower' ? '已累积松果 ' + rw.potGold : '分数 ' + rw.score + ' · 试炼币 ' + rw.coins) + '</p></div>',
      [{ label: '下一场', cls: 'gold', run: () => fight(mode) }], { small: true });
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
      '<span class="hex-scope">' + SCOPE[b.scope] + '</span>' +
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
       { label: '结束本层（领安慰奖）', cls: 'muted', run: () => {
          const out = Tower.giveUp('tower');
          C().modal('本层结束', '<p>安慰奖：金松果 +' + (out.consolation || 0) + '</p>',
            [{ label: '返回', cls: 'gold', run: () => C().home() }], { small: true });
        } },
       { label: '返回', run: () => C().home() }], { small: true });
  }
  function endlessDefeat(rw) {
    C().modal('挑战失败', '<div class="result-box"><div class="result-title lose">倒在了第 ' + rw.layer + ' 层</div>' +
      '<div class="result-lines">本局分数 ' + rw.score + '（历史最高 ' + rw.best + '）</div>' +
      '<p>未结算的抽奖卷已作废。</p>' +
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
      '<i>' + RARITY[s.rarity] + ' · ' + SCOPE[s.scope] + '</i><span>' + esc(s.desc) + '</span>' +
      (s.sold ? '<em>已购入</em>' : C().btn(s.price + ' 币', 'buy' + i, 'small gold')) + '</div>').join('');
    const owned = Tower.ownedBuffs('endless').filter((b) => b.scope !== 'battle');
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
      '<div class="checkpoint-option"><b>继续挑战</b><span>撑到第 ' + info.nextCheckpoint + ' 层可得 <b class="gold-text">' + info.ticketsNext + '</b> 张；中途失败则全部作废</span></div>' +
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
