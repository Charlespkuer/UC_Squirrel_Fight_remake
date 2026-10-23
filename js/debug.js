/* ============================================================
 * debug.js — 开发调试开关面板
 *
 * 用 Ctrl+Shift+D 或右上角「调试」按钮打开。所有开关只读写本地
 * localStorage 的 ssdz_debug 项，不写进正式存档 ssdz_save_v1，
 * 删除这一项（或点「全部关闭」）即可完全恢复原状。
 *
 * 其它模块按需读取：Debug.enabled('infiniteEnergy')、Debug.numberStretch()。
 * ============================================================ */

/* ------------------------------------------------------------
 * 目录：开发调试开关面板
 * Ctrl+F 搜节号（如「【DBG1】」）直达对应代码块。
 *
 *  【DBG1】开关存取  【DBG2】开关表  【DBG3】一次性工具
 *  【DBG4】面板构建与渲染  【DBG5】导出 window.Debug
 * ------------------------------------------------------------ */
(function () {
  'use strict';

  /* 开发者开关：false = 经典界面不显示调试按钮/面板，调试开关也不生效；
   * true  = 经典界面也照常可用。需要时只改这一行。
   * ⚠ 提交前必须保持 false：`test-ssfight-render` 的 checkDualSaveAndDebugGate 按这条断言
   *   （经典界面默认隐藏调试入口，只保留这个源码开关）。本地调试临时改 true 别一起提交。 */
  const DEBUG_IN_CLASSIC = false;

  /* 【快进 24 小时】把「当前存档」的调试时钟偏移加到 Date.now 上。
   * 偏移存在各自槽位的 `debugClockOffset` 里：经典/现代两套存档互不影响；
   * 切换界面后 `State.state()` 变了，这里读到的就是另一套的偏移。
   * 只改 Date.now（游戏内日期都从它派生），不碰系统时间。 */
  const nativeDateNow = Date.now.bind(Date);
  function debugClockOffset() {
    try {
      const S = window.State && State.state ? State.state() : null;
      return Math.max(0, Number(S && S.debugClockOffset) || 0);
    } catch (e) { return 0; }
  }
  if (!Date.__ssdzDebugClock) {
    Date.now = () => nativeDateNow() + debugClockOffset();
    Date.__ssdzDebugClock = true;
  }

  /** 当前是不是经典界面。只在浏览器有 UI 时判断；纯状态测试/无 UI 宿主视为允许。 */
  function classicUiActive() {
    try {
      if (window.UI && typeof UI.currentUiMode === 'function') return UI.currentUiMode() === 'classic';
    } catch (e) {}
    return false;
  }
  function debugAllowed() { return DEBUG_IN_CLASSIC || !classicUiActive(); }

  /* ============================================================
   * 【DBG1】开关存取（localStorage 隔离）
   * ============================================================ */
  const STORE_KEY = 'ssdz_debug';
  /* 开关的默认值。新增开关要同时加进这里与下面的 TOGGLES；
   * set() 以 TOGGLES 为准，所以这里漏了也不会出现「开关点不动」的老问题
   * （历史上 noTowerCost / endlessCoin 就漏在这里过，那两个开关于是形同虚设；
   * 2026-10 已按用户口径删掉 —— 见下面 TOGGLES 里的说明）。 */
  const defaults = { infiniteEnergy: false, godMode: false, shortDay: false, noUpgradeFail: false, freeUpgrade: false, freeShop: false, noStageCost: false, noCoinCost: false, battleStats: false };
  const state = Object.assign({}, defaults);
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch (e) {}
  // 首页位图数字的横向拉伸比：固定值，图集里的数字比参考图窄
  const NUMBER_STRETCH = 1.25;

  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function enabled(key) { return debugAllowed() && state[key] === true; }
  function get(key) { return debugAllowed() ? state[key] : false; }
  function numberStretch() { return NUMBER_STRETCH; }
  // 位图可能比脚本晚加载完成，图就绪后按当前宽度重画一次
  window.addEventListener('load', () => { if (window.UI && UI.renderNumbers) UI.renderNumbers(); });

  /* ============================================================
   * 【DBG2】开关表
   * ============================================================ */
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
      key: 'shortDay', label: '12 小时一天',
      note: '一天视为 12 小时：中午 12 点也算新的一天。每日礼包、免费抽奖、每日任务、天梯今日场次、弟子日供、师父踢人、真化次数、VIP 每日、挑战塔当天刷新的 boss 等，全部会在 12 点再刷一次（金杯商店的限兑是按周的，不受影响）',
      on() {
        if (!window.State || !State.state()) return;
        // 打开时如果已经是下午，日期键会直接跳到「第二天」——手动跑一次每日检查，
        // 让所有每日刷新立刻生效，不用等下一次进首页。
        if (State.refreshDaily) State.refreshDaily();
        State.save();
        if (window.UI && UI.refreshHome) UI.refreshHome();
      },
    },
    {
      key: 'godMode', label: '无敌模式',
      note: '战斗里玩家的血量只增不减（开战先顶到上限）：吸血、持续伤害、自伤、反伤这些掉血全部不生效，既不会被击倒，也不会在 120 手超时里按血量比例判负',
      on() {},
    },
    {
      key: 'battleStats', label: '战斗三维显示',
      note: '现代战斗左上/右上实时显示双方有效力量、敏捷、速度（含装备、增益与「敏捷/速度/力量降低」）；只影响显示，不改战斗数值',
    },
    { key: 'noUpgradeFail', label: '升级必定成功', note: '武器与技能升级不再失败' },
    { key: 'freeUpgrade', label: '升级无需消耗', note: '升级不扣金松果、不扣武器/技能卷轴，也不受等级限制' },
    { key: 'freeShop', label: '道具免费', note: '商店购买不扣金松果' },
    { key: 'noStageCost', label: '关卡不耗挑战书', note: '入场与复活都不消耗挑战书；挑战塔 / 无尽挑战塔的进层也一样不消耗' },
    /* 2026-10 用户口径：原来这条是「无尽试炼币拉满」（开局送 9999 试炼币，且实测没生效），
     * 改成「试炼币不消耗」——试炼商店（买 / 刷新 / 买铸币）与铸币商店结账都不扣代币。 */
    { key: 'noCoinCost', label: '试炼币不消耗', note: '试炼商店（买增益 / 刷新货架 / 买铸币）与铸币商店购买都不扣代币，余额不足也照买' },
  ];
  function set(key, value, session) {
    if (!debugAllowed()) return false;
    const def = TOGGLES.find((t) => t.key === key);
    if (!def) return false;
    const changed = state[key] !== (value === true);
    state[key] = value === true;
    save();
    if (changed && state[key] && session === true && def.on) def.on();
    return state[key];
  }
  function toggle(key, session) { return set(key, !state[key], session); }
  function reset() {
    for (const def of TOGGLES) state[def.key] = false;
    save();
    if (window.UI && UI.refreshHome) UI.refreshHome();
    return state;
  }

  // 一键升级目标等级：与游戏满级一致（State.MAX_PLAYER_LEVEL = 90）
  const MAX_LEVEL = (window.State && State.MAX_PLAYER_LEVEL) || 90;
  /* ============================================================
   * 【DBG3】一次性工具（重置/发放/遗忘）
   * ============================================================ */
  // ---------- 一次性工具 ----------
  const ACTIONS = [
    { label: '一键满级', note: '从当前等级一路走「真实升级流程」到 ' + MAX_LEVEL + ' 级：属性成长、升级礼包（道具）与武器/技能「三选一」都会照常发放；攒下的三选一和自选属性点会在结束后弹窗处理（弹窗里有「全部随机」「平均分配」）',
      run() {
        const S = State.state();
        const from = S.level;
        if (from >= MAX_LEVEL) return '已经是 ' + MAX_LEVEL + ' 级或更高（调试上限 ' + MAX_LEVEL + '）';
        const gain = { power: 0, agility: 0, speed: 0, hp: 0 };
        let levels = 0, gifts = 0, books = 0, picks = 0, chests = 0;
        // 每次只喂「当前等级升下一级」所需的经验，走完整的 gainExp 流程
        for (let guard = 0; S.level < MAX_LEVEL && guard < 200; guard++) {
          const ups = State.gainExp(GData.nextExp(S.level));
          if (!ups.length) break;
          for (const u of ups) {
            levels++;
            gain.power += u.power; gain.agility += u.agility; gain.speed += u.speed; gain.hp += u.hp;
            gifts += (u.gifts || []).length;
            if (u.attributeBook) books++;
            if (u.chest) chests += u.chest;
            if (u.wsChoice) picks++;
          }
        }
        if (window.UI && UI.refreshHome) UI.refreshHome();
        renderOwned();
        // 一路上攒下的三选一与自选属性点：直接弹出处理（一键满级会攒几十组/几十点）
        if (window.UI && UI.classic && UI.classic.promptLevelUpChoices) UI.classic.promptLevelUpChoices();
        return '等级 ' + from + ' → ' + S.level + '（' + levels + ' 级）：力量+' + gain.power + ' 敏捷+' + gain.agility +
          ' 速度+' + gain.speed + ' 生命+' + gain.hp + '，升级礼包 ' + gifts + ' 件' + (books ? '、属性书 ' + books + ' 本' : '') +
          (chests ? '、金宝箱 ' + chests + ' 个' : '') +
          (picks ? '，武器/技能三选一 ' + picks + ' 组' : '，没有新的武技可选') +
          (S.freePoints ? '，本次分配弹窗里还有 ' + S.freePoints + ' 点没点完' : '');
      } },
    { label: '一键升级', note: '按正常升级结算一次经验，属性成长、升级礼包与武器/技能三选一照常；到 ' + MAX_LEVEL + ' 级就停下',
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
    { label: '金松果 +10000', run() { State.addGold(10000, { count: false }); State.save(); UI.refreshHome(); return '金松果 +10000'; } },
    { label: '全道具 +10', run() {
        const S = State.state();
        let n = 0;
        // 金松果/金杯/经验不是背包道具，跳过（要加它们用上面的「快速获取物品」）；
        // 松鼠拳套 / 绿松果在本版没有产出与使用逻辑，也不发。
        propMap.each((id) => {
          if (+id > 0 && !CURRENCY_PROPS[+id] && !UNUSED_PROPS.has(+id)) {
            S.props[id] = (S.props[id] || 0) + 10;
            n++;
          }
        });
        State.save(); UI.refreshHome();
        return n + ' 种道具各 +10（货币、经验与 2 件游戏内没有的道具已跳过）';
      } },
    { label: '武技满级', run() {
        const S = State.state();
        S.weapons = S.weapons.map((w) => w.split(':')[0] + ':15');
        S.skills = S.skills.map((s) => s.split(':')[0] + ':15');
        State.save();
        return '已有武器与技能已满级';
      } },
    { label: '解锁关卡', run() {
        const S = State.state();
        for (let id = 1; id <= 18; id++) S.stages[id] = { npcIndex: 3, passed: true };
        State.save();
        return '18 个关卡已标记通关';
      } },
    { label: '快进24小时', note: '只把当前界面（经典/现代各自独立）的游戏时间前进 24 小时：每日礼包、免费抽奖、天梯今日场次与金杯商店限兑、每日任务、弟子日贡、对手刷新费用、体力恢复都按新的一天结算；另一个界面的存档与时间不动。体力会回满，可连续刷关卡/挑战，升级更快',
      run() {
        const S = State.state();
        if (!S) return '当前没有存档';
        const before = Math.max(0, Number(S.debugClockOffset) || 0);
        S.debugClockOffset = before + 24 * 60 * 60 * 1000;
        S.energy = S.maxEnergy;
        S.lastEnergyTs = Date.now();
        try { if (State.refreshDaily) State.refreshDaily(); } catch (e) {}
        try { if (State.tickEnergy) State.tickEnergy(); } catch (e) {}
        State.save();
        if (window.UI && UI.refreshHome) UI.refreshHome();
        if (window.UI && UI.refreshHeader) UI.refreshHeader();
        return '当前界面已快进24小时：每日/周重置、体力恢复与弟子日供都按新一天结算（另一个界面不受影响）';
      } },
    { label: '重弹提示', note: '把 30 级那次「自愿支持作者」的一次性提示恢复成待提示：下一次首页刷新或升级奖励处理完之后会再弹一次（正式流程只在升到 30 级时弹一次）',
      run() {
        if (!(State.supportPromptReset && State.supportPromptReset())) return '当前版本没有这个接口';
        if (window.UI && UI.classic && UI.classic.maybeSupportPrompt) UI.classic.maybeSupportPrompt();
        return '已恢复支持作者提示（若首页没有立刻弹出，回一次首页或关掉当前弹窗即可）';
      } },
  ];
  /* 2026-10 用户口径：删掉「清空无尽塔剧情进度」这条调试工具（面板上不再提供）。
   * 底层接口 `Tower._debugResetStory` 保留 —— 无尽塔的剧情回归用例要靠它复位。 */

  /** 彻底重置账号：清除武器与技能，回到全新开局。
   *  State.newGame 会重建 NEW_PLAYER（weapons = []、skills = []），
   *  所以升级过程中随机领悟的武器/技能也会一并消失。
   *  weaponId 可以指定开局武器；'random' 表示从原版武器表里随机挑一把。 */
  function resetAccount(name, weaponId) {
    const S = State.state();
    const who = typeof name === 'string' && name.trim() ? name.trim() : (S && S.name) || '小松鼠';
    for (const def of TOGGLES) state[def.key] = false;
    save();
    /* 不清整条 saveKey：现在这是一份双界面槽位存档，删掉会把另一界面的进度也带走。
     * 新开局只覆盖当前界面槽位，另一槽由 State.newGame/save 原样保留。 */
    // 默认采用无武技的普通开局；调试时也可指定武器。
    let chosen = null;
    const list = State.weaponList ? State.weaponList() : [];
    if (weaponId === 'random' && list.length) {
      chosen = list[Math.floor(Math.random() * list.length)];
    } else if (Number.isSafeInteger(Number(weaponId)) && Number(weaponId) > 0) {
      chosen = list.find((w) => w.id === Number(weaponId)) || null;
    }
    State.newGame(who, Object.assign({ force: true }, chosen ? { weaponId: chosen.id, weaponLevel: 1 } : {}));
    /* 新档是 classic，但当前页可能还是旧模式/旧等级的 DOM；只 refreshHome 只会改数字，
     * 不会重画整页，于是会出现"经典 + 现代混在一起"且引导不启动。直接重进首页。 */
    try {
      if (window.Main && Main.showHome) Main.showHome();
      else if (window.UI && UI.refreshHome) UI.refreshHome();
    } catch (e) {
      if (window.UI && UI.refreshHome) UI.refreshHome();
    }
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
    propMap.each((id, v) => {
      if (+id > 0 && !UNUSED_PROPS.has(+id)) rows.push({ id: +id, name: v.name });
    });
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

  /** 无尽塔增益：下拉全表（编号 + 名称 + 稀有度/类型）。 */
  function buffOptions() {
    const rows = (window.TowerData && TowerData.BUFFS) || [];
    const rar = (window.TowerData && TowerData.RARITY_NAME) || ['普通', '稀有', '史诗', '传奇'];
    const kind = { limited: '限次', permanent: '永久', instant: '即时' };
    return rows.map((b) => '<option value="' + b.id + '">' + b.id + ' ' + esc(b.name) +
      '（' + (rar[b.rarity] || '') + '·' + (kind[b.kind] || '') + '）</option>').join('');
  }
  /** 无尽塔专属：立即获得指定增益（走 Tower.debugGrantBuff）。 */
  function grantBuff(id) {
    if (!(window.Tower && Tower.debugGrantBuff)) return '当前版本没有这个接口';
    const r = Tower.debugGrantBuff(id);
    renderOwned();
    if (window.TowerUI && TowerUI.openEndless && State.state().endless && State.state().endless.run) TowerUI.openEndless();
    return r.ok ? '获得【' + r.buff.name + '】' + (r.granted ? '（永久槽位 +' + r.granted + '）' : '') : (r.msg || '没成功');
  }
  /** 无尽塔专属：立即失去指定增益（走 Tower.debugLoseBuff）。 */
  function loseBuff(id) {
    if (!(window.Tower && Tower.debugLoseBuff)) return '当前版本没有这个接口';
    const def = (window.TowerData && TowerData.BUFF_BY_ID && TowerData.BUFF_BY_ID[id]) || null;
    const r = Tower.debugLoseBuff(id);
    renderOwned();
    if (window.TowerUI && TowerUI.openEndless && State.state().endless && State.state().endless.run) TowerUI.openEndless();
    return r.ok ? '失去【' + ((def && def.name) || id) + '】' : (r.msg || '没成功');
  }
  /** 无尽塔专属调试：**立刻生成一个铸币商店**（跳过 5%~10% 的概率与层区间判定）。
   *  走正式开店路径（掷货架 / 讨价还价对折 / C59 进门币都照常），只是不占「本组已刷过」的名额。 */
  function spawnMintShop() {
    if (!(window.Tower && Tower._debugSpawnMintShop)) return '当前版本没有这个接口';
    const r = Tower._debugSpawnMintShop();
    if (!r || !r.ok) return (r && r.msg) || '没成功';
    if (window.TowerUI && TowerUI.openMintShop) TowerUI.openMintShop();
    renderOwned();
    return '已在第 ' + r.layer + ' 层生成铸币商店（' + r.slots + ' 件货）';
  }
  /** 无尽塔专属调试：**立刻生成一个普通（试炼）商店** —— 与铸币商店按钮同一口径，
   *  只是货架换回试炼币交易，关掉后回去继续打。 */
  function spawnShop() {
    if (!(window.Tower && Tower._debugSpawnShop)) return '当前版本没有这个接口';
    const r = Tower._debugSpawnShop();
    if (!r || !r.ok) return (r && r.msg) || '没成功';
    if (window.TowerUI && TowerUI.openShop) TowerUI.openShop();
    renderOwned();
    return '已在第 ' + r.layer + ' 层生成普通商店（' + r.slots + ' 件货）';
  }
  /** 无尽塔专属调试：**快速爬塔** —— 当前层数 ±1（没有对局时先开一局，落在第 1 层）。 */
  function shiftEndlessLayer(delta) {
    if (!(window.Tower && Tower._debugShiftEndlessLayer)) return '当前版本没有这个接口';
    const r = Tower._debugShiftEndlessLayer(delta);
    if (!r || !r.ok) return (r && r.msg) || '没成功';
    renderOwned();
    refreshEndlessPage();
    return '无尽塔：现在是第 ' + r.layer + ' 层';
  }
  /** 无尽塔界面刷新：有对局就重画无尽主界面（与 grantBuff / shiftEndlessLayer 同一行为）。 */
  function refreshEndlessPage() {
    try {
      if (window.TowerUI && TowerUI.openEndless && window.State && State.state()
          && State.state().endless && State.state().endless.run) TowerUI.openEndless();
    } catch (e) { /* 界面刷新失败不影响数值 */ }
  }
  /** 无尽塔专属调试：**直接发试炼币**（数量由面板输入框决定，等价于 E02/E03）。 */
  function grantEndlessCoins(count) {
    if (!(window.Tower && Tower._debugGrantCoins)) return '当前版本没有这个接口';
    const r = Tower._debugGrantCoins(count);
    if (!r || !r.ok) return (r && r.msg) || '没成功';
    renderOwned();
    refreshEndlessPage();
    return '试炼币 +' + r.amount + '（第 ' + r.layer + ' 层现有 ' + r.total + '）';
  }
  /** 无尽塔专属调试：**直接发铸币**（数量由面板输入框决定，等价于 E09/E10）。 */
  function grantEndlessMint(count) {
    if (!(window.Tower && Tower._debugGrantMint)) return '当前版本没有这个接口';
    const r = Tower._debugGrantMint(count);
    if (!r || !r.ok) return (r && r.msg) || '没成功';
    renderOwned();
    refreshEndlessPage();
    return '铸币 +' + r.amount + '（现有 ' + r.total + ' 枚）';
  }

  /* 调试所得账本的外壳：操作前快照 → 执行 → 记录净增量。
   * 所有「直接发东西」的按钮都从这里走，系统页才能按索引只回收调试部分。
   * 不包裹「遗忘」「重置每日」这类**减少/不改变物品**的操作。 */
  function traceDebug(label, fn) {
    let before = null;
    try { before = (window.State && State.debugSnapshot) ? State.debugSnapshot() : null; } catch (e) {}
    const out = fn();
    try { if (before && window.State && State.debugRecordDiff) State.debugRecordDiff(before, label); } catch (e) {}
    return out;
  }

  /* 8 金松果 / 15 经验 / 40 金杯在原版里就是货币或经验值，不是背包道具：
   * 挂进背包只是个用不掉的死物（useType 0/3），所以取物时直接加到对应字段上。 */
  const CURRENCY_PROPS = { 8: 'gold', 40: 'goldCup', 15: 'exp' };
  /* 原始 GameDict 里有两行，但本版游戏内既没有产出途径、也没有使用逻辑：
   *   6 松鼠拳套（被挑战经验 +40%）
   *   9 绿松果（双倍金松果掉落）
   * 调试「快速获取物品」的下拉与「全道具 +10」都不再列/发，避免发一堆用不掉的死物。 */
  const UNUSED_PROPS = new Set([6, 9]);
  /** 直接往背包里加道具（调试用，不扣任何货币），并刷新首页/背包。
   *  仍然遵守 9999 的单件上限；金松果/金杯/经验走各自的货币字段。 */
  function grantItem(id, count) {
    const S = State.state ? State.state() : null;
    if (!S) return '还没有存档，先开始游戏';
    const n = Math.max(1, Math.min(999, Math.round(Number(count) || 1)));
    const key = Number(id);
    if (UNUSED_PROPS.has(key)) return '这件道具在游戏内没有产出与用途，调试添加已跳过';
    const def = propMap.getValue(key);
    if (!def) return '道具表里没有编号 ' + id;
    const currency = CURRENCY_PROPS[key];
    if (currency) {
      let msg;
      if (currency === 'gold') { State.addGold(n, { count: false }); msg = '金松果 +' + n + '（现有 ' + S.goldPoint + '）'; }
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

  /* ============================================================
   * 【DBG4】面板构建与渲染
   * ============================================================ */
  // ---------- 面板 ----------
  let panel = null, gear = null, drag = null;
  /* 玩家手动拖过面板之后就不再让面板跟内屏走（按钮始终跟随）。 */
  let panelPinned = false;
  let layoutBound = false;

  /** 游戏**内屏**的可见包围盒：经典/现代界面都是 `#ui`（1150×690 设计空间）经
   *  `Main.resizeLayout()` 等比缩放后的那个矩形。窗口比例和舞台不一致时，窗口四周会留黑边，
   *  `position:fixed` 贴的是**外框**（窗口），会掉进黑边里；这里改成按内屏的矩形定位。
   *  `#ui` 还没挂上（启动最早的一瞬间）时退回窗口尺寸。 */
  function stageRect() {
    let r = null;
    try {
      const ui = document.getElementById('ui');
      r = ui && ui.getBoundingClientRect ? ui.getBoundingClientRect() : null;
    } catch (e) { r = null; }
    if (r && r.width > 120 && r.height > 90) return r;
    const de = document.documentElement || {};
    const vw = Math.max(1, de.clientWidth || window.innerWidth || 1);
    const vh = Math.max(1, de.clientHeight || window.innerHeight || 1);
    return { left: 0, top: 0, right: vw, bottom: vh, width: vw, height: vh, windowFallback: true };
  }
  /** 把入口按钮（以及没被拖过的面板）贴到内屏的右上角。
   *  尺寸用 getBoundingClientRect 量：按钮本身是 fixed + 不缩放，所以这里只需要平移。 */
  function layoutDebugUi() {
    if (!gear) return;
    const r = stageRect();
    const margin = 6;
    /* 按钮隐藏时 offsetWidth 是 0，用一个够用的兜底宽度（实测约 58×34）。 */
    const gw = Math.max(28, gear.offsetWidth || 58);
    const gh = Math.max(20, gear.offsetHeight || 34);
    const gearLeft = Math.max(r.left + 2, r.right - margin - gw);
    const gearTop = Math.max(r.top + 2, r.top + margin);
    gear.style.right = 'auto';
    gear.style.left = Math.round(gearLeft) + 'px';
    gear.style.top = Math.round(gearTop) + 'px';
    if (!panel) return;
    const room = Math.max(160, r.bottom - (gearTop + gh + 8) - 8);
    /* 面板高度也按内屏算（内联样式优先于 CSS 里的 100vh 兜底），别让它伸到黑边/状态栏外面。 */
    panel.style.maxHeight = Math.round(room) + 'px';
    if (panelPinned) return;          // 玩家拖过就留在原地，别再拽回来
    const pw = Math.max(240, Math.min(panel.offsetWidth || 396, r.width - 16));
    panel.style.right = 'auto';
    panel.style.left = Math.round(Math.max(r.left + 8, gearLeft + gw - pw)) + 'px';
    panel.style.top = Math.round(gearTop + gh + 8) + 'px';
  }
  /** 内屏尺寸会变的三条路：窗口 resize / 转屏；`Main.resizeLayout()` 改 `#ui` 的 transform；
   *  切界面模式重建 `#ui`。前两条直接监听，第三条用 MutationObserver 盯 style/class。 */
  function bindLayout() {
    if (layoutBound) return;
    layoutBound = true;
    try { window.addEventListener('resize', layoutDebugUi); } catch (e) {}
    try { window.addEventListener('orientationchange', () => setTimeout(layoutDebugUi, 120)); } catch (e) {}
    try {
      if (window.visualViewport) window.visualViewport.addEventListener('resize', layoutDebugUi);
    } catch (e) {}
    try {
      if (document.addEventListener) {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') layoutDebugUi(); });
      }
    } catch (e) {}
    try {
      const ui = document.getElementById('ui');
      if (ui && typeof MutationObserver === 'function') {
        new MutationObserver(layoutDebugUi).observe(ui, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    } catch (e) {}
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function build() {
    if (panel) return;
    panel = document.createElement('aside');
    panel.className = 'debug-panel';
    panel.setAttribute('aria-label', '调试面板');
    panel.innerHTML =
      '<header class="debug-head"><b>调试面板</b><span class="debug-hint">Ctrl+Shift+D</span><button type="button" class="debug-x" aria-label="关闭调试面板">×</button></header>' +
      '<div class="debug-body"><ul class="debug-list">' +
      TOGGLES.map((t) => '<li><label class="debug-row" data-key="' + t.key + '" title="' + esc(t.note || t.label) + '"><input type="checkbox" data-key="' + t.key + '"' + (state[t.key] ? ' checked' : '') + '><span class="debug-name">' + esc(t.label) + '</span></label></li>').join('') +
      '</ul><div class="debug-grant">' +
      '<span class="debug-grant-title">快速获取物品</span>' +
      '<label class="debug-grant-row"><select data-item-select aria-label="选择要获取的道具">' + itemOptions() + '</select>' +
      '<input type="number" data-item-count min="1" max="999" step="1" value="10" inputmode="numeric" aria-label="获取数量">' +
      '<button type="button" class="uc-button tiny" data-item-grant="1">获取</button></label>' +
      '<p class="debug-grant-note">直接进背包、不扣金松果；碎片、果实种子、属性碎片等全部道具都在下拉里。</p>' +
      '<p class="debug-grant-note">永久属性点硬上限 <b>651</b>（含调试）：到顶后属性丸/属性书会拒绝使用；直接改存档也会在保存、读档和战斗前收口。</p></div>' +
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
      '<div class="debug-grant debug-buff">' +
      '<span class="debug-grant-title">无尽塔：立即获得 / 失去增益</span>' +
      '<label class="debug-grant-row debug-ws-row"><span class="debug-ws-tag">增益</span>' +
      '<select data-buff-select aria-label="选择要获得或失去的增益">' + buffOptions() + '</select>' +
      '<button type="button" class="uc-button tiny" data-buff-grant="1">获得</button>' +
      '<button type="button" class="uc-button tiny muted" data-buff-lose="1">失去</button></label>' +
      /* 无尽塔专属：快速爬塔（层数 ±1）—— 免去一层层打上去 */
      '<div class="debug-grant-row debug-quick"><span class="debug-ws-tag">层数</span>' +
      '<button type="button" class="uc-button tiny" data-endless-layer="1" title="无尽塔专属：当前层数 +1（还没有对局就先开一局，落在第 1 层）">层数 +1</button>' +
      '<button type="button" class="uc-button tiny" data-endless-layer="-1" title="无尽塔专属：当前层数 −1（最低第 1 层）">层数 -1</button></div>' +
      /* 无尽塔专属：手开商店 —— 铸币商店 / 普通（试炼）商店，都不看概率与层区间 */
      '<div class="debug-grant-row debug-quick"><span class="debug-ws-tag">商店</span>' +
      '<button type="button" class="uc-button tiny" data-mint-shop="1" title="无尽塔专属：立刻生成一个铸币商店（跳过 5%~10% 的概率与层区间判定，也不占本组的自然刷出名额）">铸币商店</button>' +
      '<button type="button" class="uc-button tiny" data-shop="1" title="无尽塔专属：立刻生成一个普通（试炼）商店（跳过每 5 层的结算判定；关掉后回去继续打）">普通商店</button></div>' +
      /* 无尽塔专属：直接发局内货币（试炼币 / 铸币），数量自己填 */
      '<div class="debug-grant-row debug-num-row"><span class="debug-ws-tag">试炼币</span>' +
      '<input type="number" data-endless-coins min="1" max="1000000" step="1" value="500" inputmode="numeric" aria-label="要获得的试炼币数量">' +
      '<button type="button" class="uc-button tiny" data-endless-grant-coins="1" title="无尽塔专属：立刻获得指定数量的试炼币（与 E02/E03 的即时试炼币同一条口径；没有对局时先开始一局）">获得</button></div>' +
      '<div class="debug-grant-row debug-num-row"><span class="debug-ws-tag">铸币</span>' +
      '<input type="number" data-endless-mint min="1" max="100000" step="1" value="10" inputmode="numeric" aria-label="要获得的铸币数量">' +
      '<button type="button" class="uc-button tiny" data-endless-grant-mint="1" title="无尽塔专属：立刻获得指定数量的铸币（试炼商店 50 试炼币换 1 枚的那种，与 E09/E10 同口径）">获得</button></div>' +
      '<div class="debug-ws-owned" data-buff-owned></div>' +
      /* 增益总览：当前生效 + 已获得过的全部（含一次生效、用尽、损毁、失去）+ 累计提升效果 */
      '<div class="debug-buff-report" data-buff-report></div>' +
      '<p class="debug-grant-note">需要在无尽塔对局中（先开始一局）。点已获得增益后面的 × 可直接失去；扩容类增益一局只能拿一次。</p></div>' +
      '<div class="debug-actions">' +
      ACTIONS.map((a, i) => '<button type="button" class="uc-button tiny" data-act="' + i + '" title="' + esc(a.note || a.label) + '">' + esc(a.label) + '</button>').join('') +
      '</div><div class="debug-danger"><label class="debug-weapon"><span>开局武器</span><select data-weapon-select aria-label="彻底重置后的开局武器">' + weaponOptions('default') + '</select></label>' +
      '<button type="button" class="debug-reset-account" data-reset-account="1">彻底重置</button>' +
      '<span>清空存档回到全新开局：等级、属性、道具、装备、关卡进度，以及 1 级后随机领悟的武器与技能全部清掉。开局武器可先用上面的下拉选择（默认沿用原版的方天画戟）。</span></div>' +
      '<p class="debug-foot">开关保存在 <b>ssdz_debug</b>，不写进正式存档。<button type="button" class="debug-link" data-reset="1">全部关闭</button></p>' +
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
      if (a) msg(traceDebug('调试：' + a.label, () => a.run()));
    };
    // 快速获取物品：选道具 + 数量后点「获取」，回车同样生效
    const grantBtn = panel.querySelector('[data-item-grant]');
    const grantSelect = panel.querySelector('[data-item-select]');
    const grantCount = panel.querySelector('[data-item-count]');
    const doGrant = () => {
      const id = Number(grantSelect.value);
      const def = propMap.getValue(id);
      msg(traceDebug('调试：获取 ' + ((def && def.name) || ('道具#' + id)), () => grantItem(id, Number(grantCount.value))));
    };
    grantBtn.onclick = doGrant;
    grantCount.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doGrant(); } };
    grantSelect.onchange = () => {
      const def = propMap.getValue(Number(grantSelect.value));
      if (def) msg('已选中 ' + def.name + '，当前拥有 ' + ((State.state() || { props: {} }).props[grantSelect.value] || 0) + ' 个');
    };
    // 武器/技能：选表 + 等级后获得（回车同样生效），已有武技后面的 × 直接遗忘
    for (const btn of panel.querySelectorAll('[data-ws-learn]')) {
      const kind = btn.dataset.wsLearn;
      btn.onclick = () => {
        const id = Number(panel.querySelector('[data-ws-select="' + kind + '"]').value);
        const level = Number(panel.querySelector('[data-ws-level="' + kind + '"]').value);
        const def = (kind === 'skill' ? State.skillList() : State.weaponList()).find((x) => Number(x.id) === id);
        msg(traceDebug('调试：获得' + (kind === 'skill' ? '技能 ' : '武器 ') + ((def && def.name) || id),
          () => grantWS(kind, id, level)));
      };
      const levelInput = panel.querySelector('[data-ws-level="' + kind + '"]');
      levelInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
    }
    // 无尽塔增益：下拉选一个，就能「获得」或「失去」
    panel.querySelector('[data-buff-grant]').onclick = () => msg(grantBuff(panel.querySelector('[data-buff-select]').value));
    panel.querySelector('[data-buff-lose]').onclick = () => msg(loseBuff(panel.querySelector('[data-buff-select]').value));
    // 无尽塔专属：立刻生成一个铸币商店 / 一个普通商店；层数 ±1 快速爬塔
    panel.querySelector('[data-mint-shop]').onclick = () => msg(spawnMintShop());
    panel.querySelector('[data-shop]').onclick = () => msg(spawnShop());
    for (const b of panel.querySelectorAll('[data-endless-layer]')) {
      b.onclick = () => msg(shiftEndlessLayer(Number(b.dataset.endlessLayer)));
    }
    // 无尽塔专属：直接发试炼币 / 铸币（数量取输入框，空输入按 1）
    panel.querySelector('[data-endless-grant-coins]').onclick = () =>
      msg(grantEndlessCoins(panel.querySelector('[data-endless-coins]').value));
    panel.querySelector('[data-endless-grant-mint]').onclick = () =>
      msg(grantEndlessMint(panel.querySelector('[data-endless-mint]').value));
    panel.querySelector('[data-buff-owned]').onclick = (e) => {
      const b = e.target.closest('[data-buff-forget]');
      if (b) msg(loseBuff(b.dataset.buffForget));
    };
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
      msg('再次点击「彻底重置」确认：清空 ' + who + ' 的全部进度与随机获得的武器/技能，开局武器「' + pickedName + '」');
      const btn = panel.querySelector('[data-reset-account]');
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = '确认彻底重置？';
        setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = '彻底重置'; } }, 4000);
        return;
      }
      btn.dataset.armed = ''; btn.textContent = '彻底重置';
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

    // 拖动标题栏移动面板（拖过之后就不再自动贴内屏；边界仍按内屏算，免得拖到黑边里找不回来）
    const head = panel.querySelector('.debug-head');
    head.onpointerdown = (e) => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      panelPinned = true;
      head.setPointerCapture(e.pointerId);
    };
    head.onpointermove = (e) => {
      if (!drag) return;
      const stage = stageRect();
      const maxX = Math.max(stage.left, stage.right - panel.offsetWidth);
      const maxY = Math.max(stage.top, stage.bottom - 40);
      const x = Math.max(stage.left, Math.min(maxX, e.clientX - drag.dx));
      const y = Math.max(stage.top, Math.min(maxY, e.clientY - drag.dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
      panel.style.right = 'auto';
    };
    head.onpointerup = (e) => { drag = null; try { head.releasePointerCapture(e.pointerId); } catch (err) {} };

    mark();
    bindLayout();
    layoutDebugUi();
    // 启动时只还原面板显示；已保存的开关由游戏本身按标记生效，
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
    renderBuffReport(panel);
    /* 无尽塔增益：列出本局已获得的永久/限次增益，点 × 直接失去 */
    const bbox = panel.querySelector('[data-buff-owned]');
    if (bbox) {
      const run = (State.state().endless && State.state().endless.run) || null;
      if (!run) { bbox.innerHTML = '<span class="debug-grant-note">当前没有无尽塔对局。</span>'; }
      else {
        const rar = (window.TowerData && TowerData.RARITY_NAME) || ['普通', '稀有', '史诗', '传奇'];
        const rows = []
          .concat((run.permanent || []).map((b) => ({ b, tag: '永久' })))
          .concat((run.limited || []).map((b) => ({ b, tag: '限次' + (b.uses != null ? ' 剩' + b.uses : '') })))
          .concat((run.permSlotIds || []).map((id) => ({ b: { id }, tag: '槽位' })))
          .concat((run.pickBuffIds || []).map((id) => {
            // 选取型（神兵淬炼/秘技通神）：标出已经强化到哪一个武器/技能
            const def = (window.TowerData && TowerData.BUFF_BY_ID && TowerData.BUFF_BY_ID[id]) || {};
            const boost = (def.mods && def.mods.pickSkillPct) ? (run.skillBoost || {}) : (run.weaponBoost || {});
            const keys = Object.keys(boost);
            let who = '';
            if (keys.length) {
              const list = (def.mods && def.mods.pickSkillPct) ? (State.mySkills ? State.mySkills() : []) : (State.myWeapons ? State.myWeapons() : []);
              const hit = list.find((x) => String(x.id) === String(keys[0]));
              who = hit ? ' · 已强化 ' + hit.name : ' · 已强化 #' + keys[0];
            } else if (run.pendingPick && run.pendingPick.buffId === id) who = ' · 待三选一';
            return { b: { id }, tag: '选取' + who };
          }));
        const chip = ({ b, tag }) => {
          const def = (window.TowerData && TowerData.BUFF_BY_ID && TowerData.BUFF_BY_ID[b.id]) || { name: b.id, rarity: 0 };
          return '<span class="debug-ws-chip">' + (rar[def.rarity] || '') + ' ' + esc(def.name) +
            ' <b>' + tag + '</b><button type="button" data-buff-forget="' + b.id + '" title="失去' + esc(def.name) +
            '" aria-label="失去' + esc(def.name) + '">×</button></span>';
        };
        bbox.innerHTML = rows.length ? rows.map(chip).join('')
          : '<span class="debug-grant-note">本局还没有任何增益（槽位 ' + ((window.TowerData && TowerData.PERMANENT_SLOTS) || 5) + (run.permSlots || 0) + ' 格）。</span>';
      }
    }
  }
  /** 无尽塔增益总览：已获得过的全部增益（含一次生效/用尽/损毁/失去）+ 当前实际提升。 */
  function renderBuffReport(root) {
    const box = root.querySelector('[data-buff-report]');
    if (!box) return;
    if (!window.Tower || !Tower.debugBuffReport) { box.innerHTML = ''; return; }
    let rep = null;
    try { rep = Tower.debugBuffReport('endless'); } catch (e) { rep = null; }
    if (!rep || !rep.ok) {
      box.innerHTML = '<div class="debug-report-head">增益总览</div><span class="debug-grant-note">' +
        esc((rep && rep.msg) || '暂时读不到（需要先开始一局无尽塔）。') + '</span>';
      return;
    }
    const rar = (window.TowerData && TowerData.RARITY_NAME) || ['普通', '稀有', '史诗', '传奇'];
    const KIND_LABEL = { permanent: '永久', limited: '限次', instant: '立即生效', inscription: '铭文', hidden: '隐藏' };
    const EVENT_LABEL = { get: '获得', stack: '叠加', instant: '立即生效', expire: '用尽消失', break: '损毁', lose: '失去' };
    const EVENT_CLS = { get: 'get', stack: 'stack', instant: 'instant', expire: 'gone', break: 'broken', lose: 'gone' };

    /* ① 当前实际提升（聚合后的效果清单） */
    const effects = (rep.effects || []).length
      ? '<div class="debug-effect-list">' + rep.effects.map(([k, v]) =>
          '<span class="debug-effect"><i>' + esc(k) + '</i><b>' + esc(v) + '</b></span>').join('') + '</div>'
      : '<span class="debug-grant-note">当前没有任何生效中的加成。</span>';

    /* ② 已获得过的全部增益（去重，按类别分组） */
    const groups = { permanent: [], limited: [], instant: [], hidden: [] };
    for (const it of rep.collected || []) (groups[it.kind] || groups.hidden).push(it);
    const chip = (it) => '<span class="debug-ws-chip" title="' + esc((it.detail ? it.detail + ' · ' : '') + (KIND_LABEL[it.kind] || '')) + '">' +
      (rar[it.rarity] || '') + ' ' + esc(it.name) + ' <b>' + esc(it.tag) + '</b></span>';
    const groupHtml = ['permanent', 'limited', 'instant', 'hidden'].map((k) => {
      const list = groups[k];
      if (!list.length) return '';
      return '<div class="debug-report-row"><span class="debug-report-tag">' + (KIND_LABEL[k] || '其它') + ' ×' + list.length + '</span>' +
        list.map(chip).join('') + '</div>';
    }).join('');

    /* ③ 获取/消失流水（时间顺序，最近的在下） */
    const hist = (rep.history || []).slice().reverse().slice(0, 40);
    const histHtml = hist.length
      ? '<ol class="debug-buff-log">' + hist.map((e) => {
          const def = (window.TowerData && TowerData.BUFF_BY_ID && TowerData.BUFF_BY_ID[e.id]) || { name: e.id };
          return '<li class="' + (EVENT_CLS[e.event] || '') + '"><i>第 ' + e.layer + ' 层</i>' +
            '<b>' + esc(EVENT_LABEL[e.event] || e.event) + '</b>' + esc(def.name) +
            (e.detail ? '<em>' + esc(e.detail) + '</em>' : '') + '</li>';
        }).join('') + '</ol>'
      : '<span class="debug-grant-note">还没有增益流水（获得 / 用尽 / 损毁 / 失去都会记一笔）。</span>';

    box.innerHTML =
      '<div class="debug-report-head">增益总览 · 本局第 ' + (rep.layer || 1) + ' 层' +
        '<span class="debug-report-slots">永久槽位 ' + (rep.slots ? rep.slots.used + '/' + rep.slots.cap : '—') + '</span></div>' +
      '<div class="debug-report-sec"><h5>当前实际提升（所有生效中的增益合计）</h5>' + effects + '</div>' +
      '<div class="debug-report-sec"><h5>已获得过的全部增益（含一次生效 / 用尽 / 损毁 / 失去）</h5>' +
        (groupHtml || '<span class="debug-grant-note">还没有获得过任何增益。</span>') + '</div>' +
      '<div class="debug-report-sec"><h5>获取 / 消失流水（最近 40 条）</h5>' + histHtml + '</div>';
  }

  function isOpen() { return !!(panel && panel.classList.contains('open')); }
  function refreshAvailability() {
    if (!gear) return false;
    const ok = debugAllowed();
    gear.style.display = ok ? '' : 'none';
    if (!ok) { panel.classList.remove('open'); gear.classList.remove('open'); }
    /* display 一变，按钮的可见宽高也跟着变（隐藏时量不到），重新贴一次内屏。 */
    if (ok) layoutDebugUi();
    return ok;
  }
  function togglePanel(force) {
    if (!panel) build();
    if (!debugAllowed()) { refreshAvailability(); return false; }
    const open = force == null ? !isOpen() : force === true;
    panel.classList.toggle('open', open);
    gear.classList.toggle('open', open);
    if (open) { mark(); layoutDebugUi(); }
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

  function init() { build(); bindKeys(); refreshAvailability(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ============================================================
   * 【DBG5】导出 window.Debug
   * ============================================================ */
  window.Debug = {
    enabled, get, set, toggle, reset, numberStretch, resetAccount, forgetWS, MAX_LEVEL,
    /* 控制台/探针直接调这两个入口时也要落到调试所得账本里。 */
    grantItem: (id, count) => {
      const def = propMap.getValue(Number(id));
      return traceDebug('调试：获取 ' + ((def && def.name) || ('道具#' + id)), () => grantItem(id, count));
    },
    grantWS: (kind, id, level) => {
      const def = (kind === 'skill' ? State.skillList() : State.weaponList()).find((x) => Number(x.id) === Number(id));
      return traceDebug('调试：获得' + (kind === 'skill' ? '技能 ' : '武器 ') + ((def && def.name) || id),
        () => grantWS(kind, id, level));
    },
    open: () => togglePanel(true), close: () => togglePanel(false), togglePanel, refresh: refreshAvailability,
    allowed: debugAllowed, DEBUG_IN_CLASSIC, state: () => Object.assign({}, state),
    /* 按内屏重新贴一次入口按钮/面板（窗口尺寸、分辨率档位、界面模式变化后都可以手动叫一次）。 */
    layout: layoutDebugUi, stageRect,
    /* 【DBG5b】一次性工具清单（只读）：面板按它渲染按钮，回归/探针也可以用它直接跑某一条
     * （`Debug.actions().find((a) => a.label === '快进24小时').run()`）——
     * 与真人点按钮走的是**同一份实现**，不会出现「测试绿、点按钮不生效」那种错位。
     * 这里包一层账本记录，控制台直接跑也会留下索引。 */
    actions: () => ACTIONS.map((a) => ({ label: a.label, note: a.note,
      run: () => traceDebug('调试：' + a.label, () => a.run()) })),
  };
})();
