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
  const MECH_NAME = { berserk: '血性狂暴', rhythmCrit: '瞬杀节奏', regen: '百草回春', thorns: '荆棘铁壁', poison: '毒藤缠绕', freeze: '寒冰禁锢', wolf: '唤狼协战', lifesteal: '血之渴望', shell: '磐岩之壳', devour: '无尽吞噬' };

  // ---------- 通用小件 ----------
  function carryBar(carry) {
    const pct = Math.round((carry == null ? 1 : carry) * 100);
    return '<div class="tower-carry"><span>血量继承</span><div class="tower-carry-bar"><i style="width:' + pct + '%"></i></div><b>' + pct + '%</b></div>';
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
  function planHtml(preview) {
    return '<ol class="tower-plan">' + preview.map((b, i) =>
      '<li class="' + (b.elite ? 'elite' : '') + '"><span class="tower-plan-no">' + (i + 1) + '</span>' +
      '<b>' + esc(b.name) + '</b>' + (b.elite ? '<em class="elite-tag">精英</em>' : '') +
      (b.mechDesc ? '<span class="tower-plan-mech">' + esc(b.mechDesc) + '</span>' : '') +
      (b.elite && b.mechs && b.mechs[1] ? '<span class="tower-plan-mech">叠加：' + esc(MECH_NAME[b.mechs[1]] || b.mechs[1]) + '</span>' : '') +
      '</li>').join('') + '</ol>';
  }

  // ---------- 主塔 ----------
  function openTower() {
    const info = Tower.towerInfo();
    let main;
    if (info.run) {
      const run = info.run;
      main = '<h2 class="tower-title">第 ' + run.layer + ' 层 · 第 ' + run.battleNo + '/' + run.battleCount + ' 场</h2>' +
        '<div class="tower-stats">已累积松果 <b class="gold-text">' + run.pot + '</b>（失败只保底 30%）</div>' +
        carryBar(run.carry) + ownedBuffsHtml('tower') +
        '<div class="tower-actions">' + C().btn('继续战斗', 'fight', 'gold') + C().btn('放弃本层', 'abandon', 'muted small') + '</div>';
    } else {
      main = '<h2 class="tower-title">无尽挑战塔 · 第 ' + info.nextLayer + ' 层</h2>' +
        '<div class="tower-stats">目标等级 ' + info.level + ' · 强度 ×' + info.mult.toFixed(2) + ' · ' + info.battles + ' 场连战 · 通关金松果 <b class="gold-text">' + info.gold + '</b></div>' +
        '<p class="tower-rule">每层 1 张挑战书；连战只继承剩余血量，不自动回复。场间可选择回血或增益。</p>' +
        '<h4 class="tower-plan-title">本层对手预告</h4>' + planHtml(info.preview) +
        '<div class="tower-actions">' + C().btn('开始挑战（挑战书×1）', 'fight', 'gold') + '<span class="tower-book-count">现有挑战书 ' + info.books + ' 张</span></div>';
    }
    const content = '<div class="tower-page">' + towerVisual(info.nextLayer, info.maxLayer, 'tower') + '<div class="tower-main">' + main + '</div></div>';
    const p = C().page('challenge', 'stages', content, { cls: 'tower-board' });
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
    let main;
    if (info.run) {
      const run = info.run;
      const nextLabel = run.choices ? '场间休整（四选一）' : run.phase === 'shop' ? '进入试炼商店' : run.phase === 'checkpoint' ? '前往结算点' : '继续战斗';
      main = '<h2 class="tower-title">无尽模式 · 第 ' + run.layer + ' 层（第 ' + run.segment + ' 段）</h2>' +
        '<div class="tower-stats">分数 <b class="gold-text">' + run.score + '</b> · 试炼币 <b class="gold-text">' + run.coins + '</b> · 现在离场可得抽奖卷 <b>' + run.ticketsIfSettle + '</b> 张（需到 5 的倍数层结算）</div>' +
        '<div class="tower-stats small">第 ' + run.battleNo + '/' + run.battleCount + ' 场 · 本局最深 ' + run.bestLayer + ' 层</div>' +
        carryBar(run.carry) + ownedBuffsHtml('endless') +
        '<div class="tower-actions">' + C().btn(nextLabel, 'fight', 'gold') +
        (Tower.shopState() ? C().btn('试炼商店', 'shop', 'small') : '') +
        C().btn('放弃本局', 'abandon', 'muted small') + '</div>';
    } else {
      main = '<h2 class="tower-title">无尽模式</h2>' +
        '<div class="tower-stats">历史最高 <b class="gold-text">' + info.best + '</b> 分 · 本周最高 ' + info.weekBest + ' 分 · 最深 ' + info.bestLayer + ' 层</div>' +
        '<p class="tower-rule">免门票，从 1 层冲分。每 5 层进商店并可结算离场拿抽奖卷：20 层前翻倍（1/2/4/8），之后每段 +3；中途失败卷作废。怪物每段 ×1.5 并叠加机制，撑得越久越刺激。</p>' +
        '<div class="tower-actions">' + C().btn('开始冲塔（免费）', 'fight', 'gold') + '<span class="tower-book-count">现有抽奖卷 ' + info.tickets + ' 张</span></div>';
    }
    const content = '<div class="tower-page">' + towerVisual(info.run ? info.run.layer : 1, 0, 'endless') + '<div class="tower-main">' + main + '</div></div>';
    const p = C().page('challenge', 'stages', content, { cls: 'tower-board' });
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
    const head = '<div class="hex-pick-head"><h2 class="hex-title">整装待发</h2>' +
      '<p class="hex-sub">' + (mode === 'tower'
        ? '第 ' + (run.battleNo || 4) + ' 场之前最后一次整备 —— 选一张带进去。'
        : '场间休整 —— 选一张带进去。') + '</p>' +
      (debuffs.length
        ? '<div class="hex-debuffs"><span class="hex-debuff-label">本层已被削弱</span>' +
          debuffs.map((d) => '<span class="hex-debuff">' + esc(d.text || d.name) + '</span>').join('') + '</div>'
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
    C().modal('层数通关', '<div class="result-box"><div class="result-title win">第 ' + rw.layer + ' 层通关！</div>' +
      '<div class="result-lines">金松果 +' + rw.gold + '</div>' +
      (rw.drop ? '<p>获得 ' + esc(rw.drop.name) + ' ×' + rw.drop.count + '</p>' : '') +
      '<p class="small-label">层数 +1，下一层对手更强、松果更多。</p></div>',
      [{ label: '继续爬塔', cls: 'gold', run: openTower }, { label: '返回', run: () => C().home() }], { small: true });
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
