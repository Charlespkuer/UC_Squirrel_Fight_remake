/* ============================================================
 * debug.js — 开发调试开关面板
 *
 * 用 Ctrl+Shift+D 或右上角「调试」按钮打开。所有开关只读写本地
 * localStorage 的 ssdz_debug 项，不写进正式存档 ssdz_save_v1，
 * 删除这一项（或点「全部关闭」）即可完全恢复原状。
 *
 * 其它模块按需读取：Debug.enabled('infiniteEnergy')、Debug.numberStretch()。
 * ============================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'ssdz_debug';
  const defaults = { infiniteEnergy: false, godMode: false, noUpgradeFail: false, freeUpgrade: false, freeShop: false, noStageCost: false };
  const state = Object.assign({}, defaults);
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch (e) {}
  // 首页位图数字的横向拉伸比：固定值，图集里的数字比参考图窄
  const NUMBER_STRETCH = 1.25;

  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function enabled(key) { return state[key] === true; }
  function get(key) { return state[key]; }
  function numberStretch() { return NUMBER_STRETCH; }
  // 位图可能比脚本晚加载完成，图就绪后按当前宽度重画一次
  window.addEventListener('load', () => { if (window.UI && UI.renderNumbers) UI.renderNumbers(); });

  // ---------- 开关表 ----------
  // on(session) 只在玩家本次手动开启时触发（session === true）；
  // 启动时恢复已保存的开关只还原标记，不做副作用，等游戏自己按标记运行。
  const TOGGLES = [
    {
      key: 'infiniteEnergy', label: '无限体力',
      note: '战斗与拜师不再扣体力，进入首页自动回满',
      on() { const S = State.state(); if (!S) return; S.energy = S.maxEnergy; S.lastEnergyTs = Date.now(); State.save(); if (window.UI && UI.refreshHome) UI.refreshHome(); },
    },
    {
      key: 'godMode', label: '无敌模式',
      note: '战斗里玩家最低保留 1 点血，不会被击倒',
      on() {},
    },
    { key: 'noUpgradeFail', label: '升级必定成功', note: '武器与技能升级不再失败' },
    { key: 'freeUpgrade', label: '升级无需消耗', note: '升级不扣金松果、不扣武器/技能卷轴，也不受等级限制' },
    { key: 'freeShop', label: '道具免费', note: '商店购买不扣金松果' },
    { key: 'noStageCost', label: '关卡不耗挑战书', note: '入场与复活都不消耗挑战书' },
  ];
  function set(key, value, session) {
    if (!(key in defaults)) return false;
    const changed = state[key] !== (value === true);
    state[key] = value === true;
    save();
    const def = TOGGLES.find((t) => t.key === key);
    if (changed && state[key] && session === true && def && def.on) def.on();
    return state[key];
  }
  function toggle(key, session) { return set(key, !state[key], session); }
  function reset() {
    for (const def of TOGGLES) state[def.key] = false;
    save();
    if (window.UI && UI.refreshHome) UI.refreshHome();
    return state;
  }

  // 一键升级目标等级：与游戏满级一致（State.MAX_PLAYER_LEVEL = 70）
  const MAX_LEVEL = 70;
  // ---------- 一次性工具 ----------
  const ACTIONS = [
    { label: '一键满级', note: '从当前等级一路走「真实升级流程」到 ' + MAX_LEVEL + ' 级：属性成长、升级礼包（道具）与武器/技能「三选一」都会照常发放；攒下的三选一和自选属性点会在结束后弹窗处理（弹窗里有「全部随机」「平均分配」）',
      run() {
        const S = State.state();
        const from = S.level;
        if (from >= MAX_LEVEL) return '已经是 ' + MAX_LEVEL + ' 级或更高（调试上限 ' + MAX_LEVEL + '）';
        const gain = { power: 0, agility: 0, speed: 0, hp: 0 };
        let levels = 0, gifts = 0, books = 0, picks = 0;
        // 每次只喂「当前等级升下一级」所需的经验，走完整的 gainExp 流程
        for (let guard = 0; S.level < MAX_LEVEL && guard < 200; guard++) {
          const ups = State.gainExp(GData.nextExp(S.level));
          if (!ups.length) break;
          for (const u of ups) {
            levels++;
            gain.power += u.power; gain.agility += u.agility; gain.speed += u.speed; gain.hp += u.hp;
            gifts += (u.gifts || []).length;
            if (u.attributeBook) books++;
            if (u.wsChoice) picks++;
          }
        }
        if (window.UI && UI.refreshHome) UI.refreshHome();
        renderOwned();
        // 一路上攒下的三选一与自选属性点：直接弹出处理（一键满级会攒几十组/几十点）
        if (window.UI && UI.classic && UI.classic.promptLevelUpChoices) UI.classic.promptLevelUpChoices();
        return '等级 ' + from + ' → ' + S.level + '（' + levels + ' 级）：力量+' + gain.power + ' 敏捷+' + gain.agility +
          ' 速度+' + gain.speed + ' 生命+' + gain.hp + '，升级礼包 ' + gifts + ' 件' + (books ? '、属性书 ' + books + ' 本' : '') +
          (picks ? '，武器/技能三选一 ' + picks + ' 组' : '，没有新的武技可选') +
          (S.freePoints ? '，本次分配弹窗里还有 ' + S.freePoints + ' 点没点完' : '');
      } },
    { label: '一键升级（升1级）', note: '按正常升级结算一次经验，属性成长、升级礼包与武器/技能三选一照常；到 ' + MAX_LEVEL + ' 级就停下',
      run() {
        const S = State.state();
        if (S.level >= MAX_LEVEL) return '已经是 ' + MAX_LEVEL + ' 级或更高（调试上限 ' + MAX_LEVEL + '）';
        const ups = State.gainExp(GData.nextExp(S.level));
        if (!ups.length) return '经验不足，未能升级';
        const sum = (k) => ups.reduce((a, u) => a + u[k], 0);
        const last = ups[ups.length - 1];
        const gifts = ups.reduce((a, u) => a + (u.gifts || []).length, 0);
        const picks = ups.reduce((a, u) => a + (u.wsChoice ? 1 : 0), 0);
        renderOwned();
        if (window.UI && UI.classic && UI.classic.promptLevelUpChoices) UI.classic.promptLevelUpChoices();
        return '升到 ' + last.level + ' 级（力量+' + sum('power') + ' 敏捷+' + sum('agility') +
          ' 速度+' + sum('speed') + ' 生命+' + sum('hp') + '）' + (gifts ? '，礼包 ' + gifts + ' 件' : '') +
          (picks ? '，武器/技能三选一 ' + picks + ' 组' : '') +
          (last.autoPoint ? '，' + last.autoPointName + '占比过低已自动补 1 点' : '') +
          (S.freePoints ? '，本次分配弹窗里还有 ' + S.freePoints + ' 点没点完' : '');
      } },
    { label: '体力全满', run() { const S = State.state(); S.energy = S.maxEnergy; S.lastEnergyTs = Date.now(); State.save(); UI.refreshHome(); return '体力已回满'; } },
    { label: '金松果 +10000', run() { State.state().goldPoint += 10000; State.save(); UI.refreshHome(); return '金松果 +10000'; } },
    { label: '全道具 +10', run() {
        const S = State.state();
        let n = 0;
        // 金松果/金杯/经验不是背包道具，跳过（要加它们用上面的「快速获取物品」）
        propMap.each((id) => { if (+id > 0 && !CURRENCY_PROPS[+id]) { S.props[id] = (S.props[id] || 0) + 10; n++; } });
        State.save(); UI.refreshHome();
        return n + ' 种道具各 +10（货币与经验已跳过）';
      } },
    { label: '全部武器技能满级', run() {
        const S = State.state();
        S.weapons = S.weapons.map((w) => w.split(':')[0] + ':15');
        S.skills = S.skills.map((s) => s.split(':')[0] + ':15');
        State.save();
        return '已有武器与技能已满级';
      } },
    { label: '解锁全部关卡', run() {
        const S = State.state();
        for (let id = 1; id <= 18; id++) S.stages[id] = { npcIndex: 3, passed: true };
        State.save();
        return '18 个关卡已标记通关';
      } },
    { label: '重置每日与体力计时', note: '把每日礼包、免费抽奖、天梯今日场次与金杯商店限兑、每日任务进度、弟子日贡、对手刷新费用、体力计时都当成「新的一天」',
      run() {
        const S = State.state();
        const today = State.localDate();
        S.dailyClaimDate = '';                     // 每日礼包可以再领
        // 直接标记今天已同步，别再走 syncDailyStats 的「旧档没有日期」分支（那条分支会保留旧计数）
        S.dailyStatsDate = today;
        S.dailyWins = 0; S.dailyFails = 0;
        S.joinRankCount = 0;                       // 天梯赛今日已参赛场次
        S.rankPurchaseDay = ''; S.rankPurchases = {};   // 金杯商店每日限兑
        S.lotteryDate = today; S.lotteryFree = 1;  // 每日免费抽奖
        S.quests = null; S.dailyCounters = null;   // 每日任务：进度与领取状态清空，下次打开活动页重抽
        S.masterKickDate = '';                     // 师父今天又能让一名徒弟离开
        S.challengeRefresh = { count: 0, ts: Date.now() };   // 对手刷新费用
        for (const p of (S.prentices || [])) { p.lastExpDate = ''; p.tributeClaimedDate = ''; }   // 弟子日贡可再领
        S.lastEnergyTs = Date.now(); S.energy = S.maxEnergy;
        State.save();
        if (window.UI && UI.refreshHome) UI.refreshHome();
        if (window.UI && UI.refreshHeader) UI.refreshHeader();
        return '已重置：每日礼包、免费抽奖、天梯次数与限兑、每日任务、弟子日贡、刷新费用、体力计时';
      } },
  ];

  /** 彻底重置账号：清除武器与技能，回到全新开局。
   *  State.newGame 会重建 NEW_PLAYER（weapons = []、skills = []），
   *  所以升级过程中随机领悟的武器/技能也会一并消失。
   *  weaponId 可以指定开局武器；'random' 表示从原版武器表里随机挑一把。 */
  function resetAccount(name, weaponId) {
    const S = State.state();
    const who = typeof name === 'string' && name.trim() ? name.trim() : (S && S.name) || '小松鼠';
    for (const def of TOGGLES) state[def.key] = false;
    save();
    try { localStorage.removeItem(State.saveKey); } catch (e) {}
    try { localStorage.removeItem(State.saveKey + '_backup'); } catch (e) {}
    // 默认采用无武技的普通开局；调试时也可指定武器。
    let chosen = null;
    const list = State.weaponList ? State.weaponList() : [];
    if (weaponId === 'random' && list.length) {
      chosen = list[Math.floor(Math.random() * list.length)];
    } else if (Number.isSafeInteger(Number(weaponId)) && Number(weaponId) > 0) {
      chosen = list.find((w) => w.id === Number(weaponId)) || null;
    }
    State.newGame(who, chosen ? { weaponId: chosen.id, weaponLevel: 1 } : undefined);
    if (window.UI && UI.refreshHome) UI.refreshHome();
    return {
      name: who, weapons: State.state().weapons.slice(), skills: State.state().skills.slice(),
      weapon: chosen ? chosen.name : null, random: weaponId === 'random',
    };
  }

  /** 开局武器下拉：普通开局（2级领悟武技）+ 全部武器 + 随机。 */
  function weaponOptions(selected) {
    const list = State.weaponList ? State.weaponList() : [];
    let html = '<option value="default"' + (selected === 'default' ? ' selected' : '') + '>普通开局：2级领悟武技</option>';
    html += '<option value="random"' + (selected === 'random' ? ' selected' : '') + '>随机一把</option>';
    html += list.map((w) => '<option value="' + w.id + '"' + (String(selected) === String(w.id) ? ' selected' : '') + '>' +
      esc(w.name) + '（' + esc(w.harm) + '）</option>').join('');
    return html;
  }

  /** 快速获取物品用的道具下拉：字典里的全部道具；金松果/金杯/经验标注成货币。 */
  function itemOptions() {
    const rows = [];
    propMap.each((id, v) => { if (+id > 0) rows.push({ id: +id, name: v.name }); });
    rows.sort((a, b) => a.id - b.id);
    return rows.map((r) => {
      const tag = CURRENCY_PROPS[r.id] === 'gold' ? '（货币·金松果）' : CURRENCY_PROPS[r.id] === 'goldCup' ? '（货币·金杯）' : CURRENCY_PROPS[r.id] === 'exp' ? '（经验值）' : '';
      return '<option value="' + r.id + '">' + r.id + ' ' + esc(r.name) + tag + '</option>';
    }).join('');
  }

  /** 武器/技能下拉：字典全表，按编号排序。 */
  function wsOptions(kind) {
    const rows = (kind === 'skill' ? State.skillList() : State.weaponList()) || [];
    return rows.map((r) => '<option value="' + r.id + '">' + r.id + ' ' + esc(r.name) + '</option>').join('');
  }

  /** 直接获得/改等级指定武器、技能（等级 1~15）。 */
  function grantWS(kind, id, level) {
    const S = State.state ? State.state() : null;
    if (!S) return '还没有存档，先开始游戏';
    const fn = kind === 'skill' ? State.setSkill : State.setWeapon;
    const r = fn ? fn(Number(id), Number(level)) : { ok: false, msg: '当前版本没有这个接口' };
    if (window.UI && UI.refreshHome) UI.refreshHome();
    renderOwned();
    return r.ok
      ? (r.replaced ? '【' + r.name + '】等级改为 ' + r.level : '获得【' + r.name + '】Lv' + r.level) + '　武技 ' + r.total + '/' + r.limit
      : r.msg;
  }

  /** 遗忘指定武器、技能。 */
  function forgetWS(kind, id) {
    const S = State.state ? State.state() : null;
    if (!S) return '还没有存档，先开始游戏';
    const fn = kind === 'skill' ? State.forgetSkill : State.forgetWeapon;
    const r = fn ? fn(Number(id)) : { ok: false, msg: '当前版本没有这个接口' };
    if (window.UI && UI.refreshHome) UI.refreshHome();
    renderOwned();
    return r.ok ? '已遗忘【' + r.name + '】　武技 ' + r.total + '/' + r.limit : r.msg;
  }

  /* 8 金松果 / 15 经验 / 40 金杯在原版里就是货币或经验值，不是背包道具：
   * 挂进背包只是个用不掉的死物（useType 0/3），所以取物时直接加到对应字段上。 */
  const CURRENCY_PROPS = { 8: 'gold', 40: 'goldCup', 15: 'exp' };
  /** 直接往背包里加道具（调试用，不扣任何货币），并刷新首页/背包。
   *  仍然遵守 9999 的单件上限；金松果/金杯/经验走各自的货币字段。 */
  function grantItem(id, count) {
    const S = State.state ? State.state() : null;
    if (!S) return '还没有存档，先开始游戏';
    const n = Math.max(1, Math.min(999, Math.round(Number(count) || 1)));
    const key = Number(id);
    const def = propMap.getValue(key);
    if (!def) return '道具表里没有编号 ' + id;
    const currency = CURRENCY_PROPS[key];
    if (currency) {
      let msg;
      if (currency === 'gold') { S.goldPoint += n; msg = '金松果 +' + n + '（现有 ' + S.goldPoint + '）'; }
      else if (currency === 'goldCup') { S.goldCup += n; msg = '金杯 +' + n + '（现有 ' + S.goldCup + '）'; }
      else {
        const ups = State.gainExp(n);
        const last = ups[ups.length - 1];
        msg = '经验 +' + n + (last ? '（升到 ' + last.level + ' 级）' : '（现有 ' + S.exp + '/' + GData.nextExp(S.level) + '）');
      }
      State.save();
      if (window.UI && UI.refreshHome) UI.refreshHome();
      if (window.UI && UI.refreshHeader) UI.refreshHeader();
      return msg;
    }
    const cap = State.PROP_HARD_CAP || 9999;
    const before = S.props[id] || 0;
    S.props[id] = Math.min(cap, before + n);
    State.save();
    if (window.UI && UI.refreshHome) UI.refreshHome();
    if (window.UI && UI.refreshHeader) UI.refreshHeader();
    if (window.UI && UI.currentScreen && UI.currentScreen() === 'bag') UI.runAction('bag');
    const added = S.props[id] - before;
    return '获得 ' + def.name + ' ×' + added + '（现有 ' + S.props[id] + ' 个' + (S.props[id] >= cap ? '，已达上限 ' + cap : '') + '）';
  }

  // ---------- 面板 ----------
  let panel = null, gear = null, drag = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function build() {
    if (panel) return;
    panel = document.createElement('aside');
    panel.className = 'debug-panel';
    panel.setAttribute('aria-label', '调试面板');
    panel.innerHTML =
      '<header class="debug-head"><b>调试面板</b><span class="debug-hint">Ctrl+Shift+D</span><button type="button" class="debug-x" aria-label="关闭调试面板">×</button></header>' +
      '<div class="debug-body"><ul class="debug-list">' +
      TOGGLES.map((t) => '<li><label class="debug-row" data-key="' + t.key + '"><input type="checkbox" data-key="' + t.key + '"' + (state[t.key] ? ' checked' : '') + '><span class="debug-name">' + esc(t.label) + '</span><em class="debug-note">' + esc(t.note || '') + '</em></label></li>').join('') +
      '</ul><div class="debug-grant">' +
      '<span class="debug-grant-title">快速获取物品</span>' +
      '<label class="debug-grant-row"><select data-item-select aria-label="选择要获取的道具">' + itemOptions() + '</select>' +
      '<input type="number" data-item-count min="1" max="999" step="1" value="10" inputmode="numeric" aria-label="获取数量">' +
      '<button type="button" class="uc-button tiny" data-item-grant="1">获取</button></label>' +
      '<p class="debug-grant-note">直接进背包、不扣金松果；碎片、果实种子、天梯碎片等全部道具都在下拉里。</p></div>' +
      '<div class="debug-grant debug-ws">' +
      '<span class="debug-grant-title">武技：快速获得 / 遗忘</span>' +
      '<label class="debug-grant-row debug-ws-row"><span class="debug-ws-tag">武器</span>' +
      '<select data-ws-select="weapon" aria-label="选择要获得的武器">' + wsOptions('weapon') + '</select>' +
      '<input type="number" data-ws-level="weapon" min="1" max="15" step="1" value="1" inputmode="numeric" aria-label="武器等级">' +
      '<button type="button" class="uc-button tiny" data-ws-learn="weapon">获得</button></label>' +
      '<label class="debug-grant-row debug-ws-row"><span class="debug-ws-tag">技能</span>' +
      '<select data-ws-select="skill" aria-label="选择要获得的技能">' + wsOptions('skill') + '</select>' +
      '<input type="number" data-ws-level="skill" min="1" max="15" step="1" value="1" inputmode="numeric" aria-label="技能等级">' +
      '<button type="button" class="uc-button tiny" data-ws-learn="skill">获得</button></label>' +
      '<div class="debug-ws-owned" data-ws-owned></div>' +
      '<p class="debug-grant-note">点已有武技后面的 × 直接遗忘；等级会夹在 1~15。</p></div>' +
      '<div class="debug-actions">' +
      ACTIONS.map((a, i) => '<button type="button" class="uc-button tiny" data-act="' + i + '" title="' + esc(a.note || a.label) + '">' + esc(a.label) + '</button>').join('') +
      '</div><div class="debug-danger"><label class="debug-weapon"><span>开局武器</span><select data-weapon-select aria-label="彻底重置后的开局武器">' + weaponOptions('default') + '</select></label>' +
      '<button type="button" class="debug-reset-account" data-reset-account="1">彻底重置账号</button>' +
      '<span>清空存档回到全新开局：等级、属性、道具、装备、关卡进度，以及 1 级后随机领悟的武器与技能全部清掉。开局武器可先用上面的下拉选择（默认沿用原版的方天画戟）。</span></div>' +
      '<p class="debug-foot">开关保存在 <b>ssdz_debug</b>，不写进正式存档。<button type="button" class="debug-link" data-reset="1">全部关闭并清除</button></p>' +
      '<output class="debug-msg" aria-live="polite"></output></div>';

    gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'debug-gear';
    gear.textContent = '调试';
    gear.title = '调试面板（Ctrl+Shift+D）';
    gear.onclick = () => togglePanel();

    document.body.appendChild(gear);
    document.body.appendChild(panel);

    panel.querySelector('.debug-x').onclick = () => togglePanel(false);
    for (const input of panel.querySelectorAll('input[type="checkbox"]')) {
      input.onchange = () => {
        const on = set(input.dataset.key, input.checked);
        msg(input.dataset.key + '：' + (on ? '已开启' : '已关闭'));
        mark();
      };
    }
    const actions = panel.querySelector('.debug-actions');
    actions.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = ACTIONS[Number(b.dataset.act)];
      if (a) msg(a.run());
    };
    // 快速获取物品：选道具 + 数量后点「获取」，回车同样生效
    const grantBtn = panel.querySelector('[data-item-grant]');
    const grantSelect = panel.querySelector('[data-item-select]');
    const grantCount = panel.querySelector('[data-item-count]');
    const doGrant = () => msg(grantItem(Number(grantSelect.value), Number(grantCount.value)));
    grantBtn.onclick = doGrant;
    grantCount.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doGrant(); } };
    grantSelect.onchange = () => {
      const def = propMap.getValue(Number(grantSelect.value));
      if (def) msg('已选中 ' + def.name + '，当前拥有 ' + ((State.state() || { props: {} }).props[grantSelect.value] || 0) + ' 个');
    };
    // 武器/技能：选表 + 等级后获得（回车同样生效），已有武技后面的 × 直接遗忘
    for (const btn of panel.querySelectorAll('[data-ws-learn]')) {
      const kind = btn.dataset.wsLearn;
      btn.onclick = () => msg(grantWS(kind, panel.querySelector('[data-ws-select="' + kind + '"]').value,
        panel.querySelector('[data-ws-level="' + kind + '"]').value));
      const levelInput = panel.querySelector('[data-ws-level="' + kind + '"]');
      levelInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
    }
    panel.querySelector('[data-ws-owned]').onclick = (e) => {
      const b = e.target.closest('[data-ws-forget]');
      if (!b) return;
      const parts = String(b.dataset.wsForget).split(':');
      msg(forgetWS(parts[0], parts[1]));
    };
    panel.querySelector('[data-reset-account]').onclick = () => {
      const S = State.state();
      const who = S ? S.name : '小松鼠';
      const picked = panel.querySelector('[data-weapon-select]').value;
      const pickedName = picked === 'default' ? '原版初始武器'
        : picked === 'random' ? '随机一把' : (panel.querySelector('[data-weapon-select]').selectedOptions[0].textContent);
      // 两步确认，避免误点清掉进度
      msg('再次点击「彻底重置账号」确认：清空 ' + who + ' 的全部进度与随机获得的武器/技能，开局武器「' + pickedName + '」');
      const btn = panel.querySelector('[data-reset-account]');
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = '确认彻底重置？';
        setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = '彻底重置账号'; } }, 4000);
        return;
      }
      btn.dataset.armed = ''; btn.textContent = '彻底重置账号';
      const r = resetAccount(who, picked === 'default' ? undefined : picked);
      for (const input of panel.querySelectorAll('input[type="checkbox"]')) input.checked = false;
      mark();
      msg('账号已彻底重置：' + r.name + ' 回到 1 级，开局武器 ' + JSON.stringify(r.weapons) +
        '（' + (r.weapon || '方天画戟') + (r.random ? '，随机' : '') + '），技能 ' + JSON.stringify(r.skills));
    };
    panel.querySelector('[data-reset]').onclick = () => {
      reset();
      for (const input of panel.querySelectorAll('input[type="checkbox"]')) input.checked = false;
      msg('已关闭全部调试开关并清除记录');
      mark();
    };

    // 拖动标题栏移动面板
    const head = panel.querySelector('.debug-head');
    head.onpointerdown = (e) => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      head.setPointerCapture(e.pointerId);
    };
    head.onpointermove = (e) => {
      if (!drag) return;
      const x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - drag.dx));
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
      panel.style.right = 'auto';
    };
    head.onpointerup = (e) => { drag = null; try { head.releasePointerCapture(e.pointerId); } catch (err) {} };

    mark();
    // 启动时只还原面板显示；已保存的开关由游戏本身按标记生效，
    // 这里不再触发副作用（此时存档可能还没读出来）。
  }

  function msg(text) {
    if (!panel) return;
    const out = panel.querySelector('.debug-msg');
    out.textContent = text ? String(text) : '';
    clearTimeout(msg.timer);
    msg.timer = setTimeout(() => { if (out.textContent === String(text)) out.textContent = ''; }, 2600);
  }
  /** 同步面板状态与游戏是否真的在跑 */
  function mark() {
    if (!panel) return;
    const live = !!(window.State && State.state && State.state());
    panel.classList.toggle('debug-off', !live);
    for (const input of panel.querySelectorAll('input[type="checkbox"]')) input.checked = state[input.dataset.key] === true;
    renderOwned();
  }
  /** 面板里的「已有武技」列表：每项后面一个 × 直接遗忘。 */
  function renderOwned() {
    if (!panel) return;
    const box = panel.querySelector('[data-ws-owned]');
    if (!box) return;
    const live = !!(window.State && State.state && State.state());
    if (!live) { box.innerHTML = '<span class="debug-grant-note">还没有存档。</span>'; return; }
    const chip = (kind, inst) => '<span class="debug-ws-chip">' + (kind === 'skill' ? '技' : '武') + ' ' + esc(inst.name) +
      ' <b>Lv' + inst.level + '</b><button type="button" data-ws-forget="' + kind + ':' + inst.id + '" title="遗忘' +
      esc(inst.name) + '" aria-label="遗忘' + esc(inst.name) + '">×</button></span>';
    const html = (State.myWeapons ? State.myWeapons() : []).map((w) => chip('weapon', w)).join('') +
      (State.mySkills ? State.mySkills() : []).map((s) => chip('skill', s)).join('');
    box.innerHTML = html || '<span class="debug-grant-note">当前没有任何武器或技能。</span>';
  }
  function isOpen() { return !!(panel && panel.classList.contains('open')); }
  function togglePanel(force) {
    if (!panel) build();
    const open = force == null ? !isOpen() : force === true;
    panel.classList.toggle('open', open);
    gear.classList.toggle('open', open);
    if (open) mark();
    return open;
  }

  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) { togglePanel(false); return; }
      if (!(e.ctrlKey && e.shiftKey) || e.altKey || e.metaKey) return;
      if (String(e.key).toLowerCase() !== 'd') return;
      e.preventDefault();
      togglePanel();
    }, true);
  }

  function init() { build(); bindKeys(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Debug = {
    enabled, get, set, toggle, reset, numberStretch, resetAccount, grantItem, grantWS, forgetWS, MAX_LEVEL,
    open: () => togglePanel(true), close: () => togglePanel(false), togglePanel, state: () => Object.assign({}, state),
  };
})();
