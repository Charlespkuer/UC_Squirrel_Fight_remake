// state.js — 玩家状态、存档、养成（武器/技能/装备/道具/关卡）；数值规则复刻原版 player.js 与 GameDict.js。
// State 是存档与数值的唯一真值：页面只调 API，不另存一套。

(function () {
  'use strict';

  const testMode = typeof location !== 'undefined' && /(?:^|[?&])(?:test=[12]|qa=1)(?:&|$)/.test(location.search || '');
  const SAVE_KEY = testMode ? 'ssdz_test_save_v1' : 'ssdz_save_v1';
  /* 双界面独立存档：经典/现代各一份进度，同一条文件/localStorage 记录里放两个槽位。
   * 槽位选择存在 localStorage 的 ssdz_ui_mode（界面切换时由 UI 写入）。 */
  const UI_MODE_KEY = 'ssdz_ui_mode';
  const SAVE_SLOTS = ['modern', 'classic'];
  const BATTLE_HISTORY_LIMIT = 50;
  const DEFAULT_SAVE_SLOT = 'classic';
  const ENERGY_INTERVAL = 5 * 60 * 1000;
  const ENERGY_HARD_CAP = 999;
  /* 单个道具的数量上限：任何来源（掉落、礼包、任务、商店、调试）都不会超过它。
   * 收口放在 save()/normalizeSave 里，这样新增道具的地方不用各自记一遍。 */
  const PROP_HARD_CAP = 9999;
  /* 这三个编号在原版里是货币/经验值（挂进背包也用不掉），存档里出现就直接忽略。 */
  const CURRENCY_PROP_IDS = [8, 15, 40];
  /* 黑装只在经典界面保留；现代界面按用户 2026-10 口径**整体删除**：
   * 黑装 / 黑卡 / 黑碎片 / 自选箱都不进现代背包、不掉落、不出现于帮助图鉴。
   * 经典槽位不动（那边有原版矢量分层外观）。 */
  const BLACK_PROP_IDS = Object.freeze([77, 78, 80, 89]);
  /* 原版 `MainMovie.as:19620` 的 `var maxLevel = 90`：1~70 级每级 +3 属性 +5 生命，
   * 同时每级仍发 1 个金宝箱，并把单箱上限从 16 点压到 12 点（见 rollChestReward）。 */
  const MAX_PLAYER_LEVEL = 90;
  const RANDOM_FOE_SCALE = 1.08;
  const FREE_POINT_RANDOM = 2;
  /* 到这一级时给玩家一次「自愿支持作者」的提示（一次性，落存档；不换取任何游戏内好处）。 */
  const SUPPORT_PROMPT_LEVEL = 30;
  const STAT_KEYS = ['power', 'agility', 'speed', 'hp'];
  const STAT_NAMES = { power: '力量', agility: '敏捷', speed: '速度', hp: '生命' };
  const STAT_FIELDS = { power: 'power', agility: 'agility', speed: 'speed', hp: 'maxHp' };
  const STAT_GAIN = { power: 1, agility: 1, speed: 1, hp: 5 };
  /* **永久属性点硬上限 651**（ssfight 90 级总账）：
   * 装备主属性、被动技能、套装、药丸状态、幻兽是对战斗面板的外部加成，不占这 651 点预算。
   * 它必须**高于所有正常产出**（包括旧属性书/转生记录），但任何来源——含调试——都不能越过。 */
  const STAT_HARD_CAP = 651;
  /* 生命 5 点 = 1 点（总属性 / 651 上限 / 平均分配同一口径）。
   * **生命不参与三项占比**：原版 SSFight 的权重只约束力/敏/速。 */
  const HP_PER_STAT = 5;
  /* 原版 SSFight 的转化丸口径：力/敏/速任一项低于三项总和的 **25%** 时不能用。
   * 消耗门槛（原版道具 14/18），不进入这个占比。 */
  const SHARE_KEYS = ['power', 'agility', 'speed'];
  const STAT_SHARE_MIN = 0.25;
  /* 画面分辨率档位：'auto' 跟随窗口，其余按「设计基准高度」等比缩放并居中
   * （设计尺寸是 1170×690）。窗口装不下时自动按窗口缩小，不会溢出屏幕。 */
  const RESOLUTIONS = [
    { key: 'auto', label: '自动（跟随窗口）', height: 0 },
    { key: '690', label: '1170 × 690', height: 690 },
    { key: '720', label: '1280 × 720', height: 720 },
    { key: '810', label: '1440 × 810', height: 810 },
    { key: '900', label: '1600 × 900', height: 900 },
    { key: '1080', label: '1920 × 1080', height: 1080 },
  ];
  const RESOLUTION_KEYS = RESOLUTIONS.map((r) => r.key);
  /* 界面模式：'classic' = 参考原版 ssfight 的经典界面（默认）；'modern' = 现在的界面。
   * 不动状态层、战斗层与塔层 —— 逐屏取舍见 docs/经典模式-可行性.md。 */
  const UIMODES = [
    { key: 'modern', label: '现代' },
    { key: 'classic', label: '经典' },
  ];
  const UIMODE_KEYS = UIMODES.map((m) => m.key);
  function energyCapForLevel(level) {
    const lv = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.round(Number(level) || 1)));
    let cap = GData.NEW_PLAYER.maxEnergy;
    for (let i = 2; i <= lv; i++) cap += i <= 3 ? 3 : i <= 20 ? 2 : 1;
    return cap;
  }
  let S = null; // 当前界面槽位的玩家状态
  let otherSlot = null; // 另一个界面的完整存档（切换时交换）
  let saveMode = readUiModePref(); // 当前槽位；null = 还没有选择过（按旧档/新号规则决定）

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const integer = (value, fallback, min) => Number.isFinite(Number(value)) && value !== null
    ? Math.max(min == null ? 0 : min, Math.floor(Number(value))) : fallback;

  function normalizeItems(items, map) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).map((item) => {
      const parts = String(item).split(/[:,]/);
      const id = Number(parts[0]);
      if (!map.getValue(id) || seen.has(id)) return null;
      seen.add(id);
      return id + ':' + Math.min(15, integer(parts[1], 1, 1));
    }).filter(Boolean);
  }

  /** 存档里的「已开出、待领取」金宝箱结果：只收合法的五类奖励；坏数据直接丢掉。 */
  function normalizeChestPending(raw) {
    if (!object(raw) || Number(raw.propId) !== 90) return null;
    const reward = object(raw.reward) ? raw.reward : null;
    if (!reward || !['prop', 'points', 'gold', 'hatch', 'gear'].includes(String(reward.kind))) return null;
    const count = Math.min(1000000, integer(reward.count, 0));
    if (!(count > 0)) return null;
    const out = {
      propId: 90,
      reward: { kind: String(reward.kind), count, name: String(reward.name || '') },
      lotteryCount: Math.min(CHEST_REOPEN_MAX, Math.max(0, integer(raw.lotteryCount, 0))),
    };
    if (out.reward.kind === 'prop' || out.reward.kind === 'gear') {
      out.reward.id = integer(reward.id, 0);
      if (!(out.reward.kind === 'prop' ? propMap.getValue(out.reward.id) : gearMap.getValue(out.reward.id))) return null;
    }
    return out;
  }

  function normalizeSave(raw) {
    const next = Object.assign(clone(GData.NEW_PLAYER), raw);
    let recruitEnergyRefund = 0;
    next.level = Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(next.level, GData.NEW_PLAYER.level, 1)));
    for (const key of ['power', 'agility', 'speed', 'maxHp']) {
      next[key] = integer(next[key], GData.NEW_PLAYER[key], 1);
    }
    for (const key of ['exp', 'energy', 'goldPoint', 'goldCup', 'dailyWins', 'allWins', 'dailyFails', 'allFails', 'reborn', 'joinRankCount', 'lotteryFree', 'woodRecord', 'woodCount', 'woodDamage', 'freePoints']) {
      next[key] = integer(next[key], GData.NEW_PLAYER[key]);
    }
    next.woodBest = normalizeWoodBest(raw.woodBest);
    next.chestPending = normalizeChestPending(raw.chestPending);
    next.levelChests = Math.min(MAX_PLAYER_LEVEL - 70, Math.max(0, integer(raw.levelChests, 0)));
    next.blackCardsWeek = (() => {
      const src = object(raw.blackCardsWeek) ? raw.blackCardsWeek : {};
      return {
        week: typeof src.week === 'string' ? src.week : '',
        count: Math.max(0, Math.min(3, integer(src.count, 0))),
      };
    })();
    next.blackTowerLayer = Math.max(0, integer(raw.blackTowerLayer, 0));
    next.blackBox100 = raw.blackBox100 === true;
    // 体力上限由等级直接决定（满级 90 级 = 200），再叠上超级松鼠的增量；旧档的旧曲线超额值在这里被收回。
    {
      const v = object(raw.vip) ? raw.vip : {};
      // 体力上限的 +60 只在「读档时 VIP 仍在有效期」才给；capApplied 另有含义
      // （特权 5 的装备格子是首次开通永久生效，所以不能拿它来判断体力）
      const vipOn = Number(v.until) > Date.now();
      next.maxEnergy = energyCapForLevel(next.level) + (vipOn ? VIP_ENERGY_BONUS : 0);
    }
    next.energy = Math.min(ENERGY_HARD_CAP, next.energy);
    next.integral = next.integral == null ? null : integer(next.integral, 0);
    next.rankCupClaimWeek = typeof raw.rankCupClaimWeek === 'string' ? raw.rankCupClaimWeek : '';
    next.rankWeek = typeof raw.rankWeek === 'string' ? raw.rankWeek : '';
    next.rankWeekMatches = Math.max(0, integer(raw.rankWeekMatches, 0));
    next.rankWins = Math.max(0, integer(raw.rankWins, 0));
    next.rankLosses = Math.max(0, integer(raw.rankLosses, 0));
    next.rankBots = normalizeRankBots(raw.rankBots);
    /* 天梯商店购买次数：三本账都只收「数字 key → 非负整数」。
     * `rankMonthPurchases` 是两套狂战的月度账（每月 1 号 0 点重置，见 classic-extras）。 */
    next.rankPurchases = (() => {
      const src = object(raw.rankPurchases) ? raw.rankPurchases : {};
      const out = {};
      for (const key of Object.keys(src)) {
        const n = integer(src[key], 0);
        if (/^\d+$/.test(key) && n > 0) out[key] = n;
      }
      return out;
    })();
    next.rankPurchaseTotals = (() => {
      const src = object(raw.rankPurchaseTotals) ? raw.rankPurchaseTotals : {};
      const out = {};
      for (const key of Object.keys(src)) {
        const n = integer(src[key], 0);
        if (/^\d+$/.test(key) && n > 0) out[key] = n;
      }
      return out;
    })();
    next.rankMonthPurchases = (() => {
      const src = object(raw.rankMonthPurchases) ? raw.rankMonthPurchases : {};
      const out = {};
      for (const key of Object.keys(src)) {
        const n = integer(src[key], 0);
        if (/^\d+$/.test(key) && n > 0) out[key] = n;
      }
      return out;
    })();
    next.rankPurchaseMonth = typeof raw.rankPurchaseMonth === 'string' ? raw.rankPurchaseMonth : '';
    /* 旧存档最多 12 个汉字，保留原样；新昵称在标题页/改名时已按 7 个字收口。
     * 这里只防超大/损坏名字（导入或旧调试档），并去掉首尾空白。 */
    {
      const rawName = typeof next.name === 'string' ? next.name.trim() : '';
      const rules = typeof window !== 'undefined' && window.NicknameRules;
      next.name = rawName
        ? (rules && typeof rules.truncate === 'function' ? (rules.truncate(rawName, 36) || '小松鼠') : rawName.slice(0, 20))
        : '小松鼠';
    }
    next.lastEnergyTs = Number(next.lastEnergyTs) > 0 ? Math.min(Date.now(), integer(next.lastEnergyTs, Date.now(), 1)) : Date.now();
    next.upgradeFails = (() => {
      const src = object(raw.upgradeFails) ? raw.upgradeFails : {};
      const out = {};
      for (const key of Object.keys(src)) {
        if (!/^[ws]\d+$/.test(key)) continue;
        const v = integer(src[key], 0);
        if (v > 0) out[key] = Math.min(999, v);
      }
      return out;
    })();
    next.trueUpgrades = (object(raw.trueUpgrades) && raw.trueUpgrades.date === localDate())
      ? { date: raw.trueUpgrades.date, count: Math.max(0, integer(raw.trueUpgrades.count, 0)) }
      : { date: localDate(), count: 0 };
    next.earnHistory = (Array.isArray(raw.earnHistory) ? raw.earnHistory : [])
      .filter((d) => object(d) && validLocalDate(d.date))
      .slice(-EARN_DAYS)
      .map((d) => ({ date: d.date, exp: Math.max(0, integer(d.exp, 0)), gold: Math.max(0, integer(d.gold, 0)) }));
    next.pointUndo = (Array.isArray(raw.pointUndo) ? raw.pointUndo : [])
      .filter((key) => STAT_KEYS.includes(key)).slice(-500);
    next.weapons = normalizeItems(next.weapons, weaponsMap);
    next.skills = normalizeItems(next.skills, skillsMap);
    for (const key of ['props', 'propsStates']) {
      const source = object(next[key]) ? next[key] : {};
      next[key] = {};
      for (const id of Object.keys(source)) {
        if (CURRENCY_PROP_IDS.includes(Number(id))) continue;
        const count = Math.min(PROP_HARD_CAP, integer(source[id], 0));
        if (propMap.getValue(id) && count > 0) next[key][id] = count;
      }
    }
    const usedSlots = new Set(), gearKeys = new Set();
    next.gears = (Array.isArray(next.gears) ? next.gears : [])
      .map((g) => migrateLegacyOrangeGear(g))
      .filter((g) => object(g) && gearMap.getValue(g.id)).map((g, index) => {
      const info = gearInst(g.id);
      let key = typeof g.key === 'string' && g.key ? g.key : 'legacy_' + index;
      if (gearKeys.has(key)) key += '_' + index;
      gearKeys.add(key);
      const used = g.used === true && info.useLevel <= next.level && !usedSlots.has(info.type);
      if (used) usedSlots.add(info.type);
      /* attr：本件装备的主属性点（基准 ±5% 的 roll 结果）。老档没这个字段时按基准值补。
       * attrPct：这次 roll 的整数百分比；老档没有该字段时按 attr/基准反推后落库。 */
      const attr = integer(g.attr, 0, 0) || info.attrBase;
      const entry = { id: info.id, key, used, ext: normalizeExt(g.ext),
        attr: attr, attrPct: gearAttrPctOf(info.id, attr, g.attrPct) };
      if (g.orange === true) entry.orange = true;
      /* 星标：标记后不会被误融合 / 误出售（防止手滑把好装备合掉）。 */
      if (g.starred === true) entry.starred = true;
      const gemLv = g.gem && gemLevel(g.gem.id);
      if (gemLv) entry.gem = { id: 100 + gemLv };
      return entry;
    });
    /* 5 级换装教程的一次性白装。新档显式 false；旧档没有字段时按「已经升过 5 级 / 已有装备 /
     * 旧引导里已经记过 gearsGift」迁移，防止每次打开游戏都把教程奖励重发一遍。 */
    if (raw.starterGearGiven === true) next.starterGearGiven = true;
    else if (raw.starterGearGiven === false) next.starterGearGiven = false;
    else next.starterGearGiven = Number(next.level) > 5
      || (Array.isArray(next.gears) && next.gears.length > 0)
      || !!(raw.tutorial && raw.tutorial.gearsGift === true);
    next.stages = object(next.stages) ? next.stages : {};
    // 升级「三选一」还没选的组：只保留合法的 {kind,id}，并且不能是已经拥有的
    {
      const owned = new Set([
        ...(next.weapons || []).map((w) => 'w' + parseInt(w)),
        ...(next.skills || []).map((s) => 's' + parseInt(s)),
      ]);
      const picks = [];
      for (const group of Array.isArray(next.wsPicks) ? next.wsPicks : []) {
        if (!Array.isArray(group)) continue;
        const seen = new Set();
        const list = [];
        for (const c of group) {
          if (!object(c) || (c.kind !== 'weapon' && c.kind !== 'skill')) continue;
          const id = Number(c.id);
          const def = (c.kind === 'weapon' ? weaponsMap : skillsMap).getValue(id);
          const code = (c.kind === 'weapon' ? 'w' : 's') + id;
          if (!def || seen.has(code) || owned.has(code)) continue;
          seen.add(code);
          list.push({ kind: c.kind, id, name: def.name, remark: def.remark || '', type: def.type || '' });
        }
        if (list.length) picks.push(list);
        if (picks.length >= 40) break;   // 防止坏档堆出几百组
      }
      next.wsPicks = picks;
    }
    /* 天使/恶魔果实：已经抽出的 1 个随机结果必须原样保留（大退重进不重抽）；
     * 只在武技状态变化导致该候选失效时丢弃，绝不因为读档重新摇号。老档里的多候选只留第一个。 */
    {
      const rawFruit = object(next.fruitChoices) ? next.fruitChoices : {};
      const owned = new Set([
        ...(next.weapons || []).map((w) => 'w' + parseInt(w)),
        ...(next.skills || []).map((s) => 's' + parseInt(s)),
      ]);
      const fruitChoices = {};
      for (const id of [47, 48]) {
        const p = rawFruit[id];
        if (!object(p) || !Array.isArray(p.options)) continue;
        const mode = p.mode === 'lose' ? 'lose' : 'gain';
        const list = [];
        for (const c of p.options) {
          if (!object(c) || (c.kind !== 'weapon' && c.kind !== 'skill')) continue;
          const num = Number(c.id);
          const def = (c.kind === 'weapon' ? weaponsMap : skillsMap).getValue(num);
          if (!def) continue;
          const code = (c.kind === 'weapon' ? 'w' : 's') + num;
          if (mode === 'gain' && owned.has(code)) continue;
          if (mode === 'lose' && !owned.has(code)) continue;
          list.push({ kind: c.kind, id: num, name: def.name, remark: def.remark || '', type: def.type || '' });
        }
        if (list.length) fruitChoices[id] = { mode, options: list.slice(0, 1), at: Number(p.at) || 0 };
      }
      next.fruitChoices = fruitChoices;
    }
    {
      const rawSeen = object(next.fruitSeen) ? next.fruitSeen : {};
      const fruitSeen = {};
      for (const id of [47, 48]) {
        const list = Array.isArray(rawSeen[id]) ? rawSeen[id] : [];
        const out = [];
        for (const code of list) {
          if (typeof code !== 'string' || !/^[ws]\d+$/.test(code) || out.indexOf(code) >= 0) continue;
          out.push(code);
          if (out.length >= 500) break;
        }
        fruitSeen[id] = out;
      }
      next.fruitSeen = fruitSeen;
    }
    const savedRuns = object(next.stageRuns) ? next.stageRuns : {};
    next.stageRuns = {};
    for (const id of Object.keys(savedRuns)) {
      const run = savedRuns[id];
      if (!npcOf(Number(id), 1) || !object(run)) continue;
      next.stageRuns[id] = { npcIndex: Math.min(3, integer(run.npcIndex, 1, 1)), revives: Math.min(2, integer(run.revives, 0)), needsRevive: run.needsRevive === true, masterOnly: run.masterOnly === true, masterFree: run.masterFree === true };
      if (Number.isFinite(Number(run.carryHp))) next.stageRuns[id].carryHp = Math.max(0, Math.min(1, Number(run.carryHp)));
      if (run.foeCarryHp != null && Number.isFinite(Number(run.foeCarryHp))) next.stageRuns[id].foeCarryHp = Math.max(0, Math.min(1, Number(run.foeCarryHp)));
    }
    for (const id of Object.keys(next.stages)) {
      const progress = next.stages[id];
      if (!npcOf(Number(id), 1) || !object(progress)) { delete next.stages[id]; continue; }
      if (!next.stageRuns[id] && (progress.keep === true || (!object(raw.stageRuns) && progress.passed !== true && Number(progress.npcIndex) > 1))) {
        next.stageRuns[id] = { npcIndex: Math.min(3, integer(progress.npcIndex, 1, 1)), revives: Math.min(2, integer(progress.revives, 0)), needsRevive: progress.revive === true };
      }
      next.stages[id] = { npcIndex: Math.min(3, integer(progress.npcIndex, 1, 1)), passed: progress.passed === true };
      if (next.stages[id].passed) next.stages[id].npcIndex = 3;
    }
    next.wears = object(next.wears) ? next.wears : {};
    // 师徒：旧存档只有 {name, level}，补齐属性/武器技能/日贡字段
    next.master = object(next.master) && typeof next.master.name === 'string' ? {
      name: next.master.name.slice(0, 20),
      level: integer(next.master.level, 1, 1),
      power: Number.isFinite(Number(next.master.power)) ? Number(next.master.power) : null,
      agility: Number.isFinite(Number(next.master.agility)) ? Number(next.master.agility) : null,
      speed: Number.isFinite(Number(next.master.speed)) ? Number(next.master.speed) : null,
      hp: Number.isFinite(Number(next.master.hp)) ? Number(next.master.hp) : null,
      weapons: Array.isArray(next.master.weapons) ? next.master.weapons.slice(0, 20) : [],
      skills: Array.isArray(next.master.skills) ? next.master.skills.slice(0, 20) : [],
    } : null;
    next.prentices = (Array.isArray(next.prentices) ? next.prentices : [])
      .filter((p) => object(p) && typeof p.name === 'string')
      .slice(0, 3)
      .map((p) => ({
        name: p.name.slice(0, 20),
        level: integer(p.level, 1, 1),
        exp: integer(p.exp, 0),
        power: integer(p.power, 0, 0), agility: integer(p.agility, 0, 0),
        speed: integer(p.speed, 0, 0), hp: integer(p.hp, 0, 0),
        weapons: Array.isArray(p.weapons) ? p.weapons.slice(0, 20) : [],
        skills: Array.isArray(p.skills) ? p.skills.slice(0, 20) : [],
        gears: normalizeFoeGears(p.gears),
        since: validLocalDate(p.since) ? p.since : localDate(),
        joinedAt: Number(p.joinedAt) > 0 ? Number(p.joinedAt) : localDateTime(validLocalDate(p.since) ? p.since : localDate(), 0, 0),
        lastExpDate: typeof p.lastExpDate === 'string' ? p.lastExpDate : '',
        tributeClaimedDate: validLocalDate(p.tributeClaimedDate) ? p.tributeClaimedDate : '',
      }));
    if (object(next.recruitChallenge) && next.recruitChallenge.fee === 10 && typeof next.recruitChallenge.token === 'string') {
      next.goldPoint += 10;
      recruitEnergyRefund = Math.max(0, Number(next.recruitChallenge.energyFee) || 0);
    }
    next.recruitChallenge = null;
    if (recruitEnergyRefund) next.energy = Math.min(next.maxEnergy || ENERGY_HARD_CAP, next.energy + recruitEnergyRefund);
    next.masterKickDate = typeof next.masterKickDate === 'string' ? next.masterKickDate : '';
    /* 村庄建筑（祭坛 / 神迹 / 幻兽牧场）：老档没有这个字段 → 按原版"每个建筑 1 级"补一份。
     * （`buffDate` 不是今天就等于没有）；神迹的 `add` 是历年加出来的属性点。 */
    {
      const raw2 = object(raw.buildings) ? raw.buildings : {};
      next.buildings = {};
      for (const key of ['altar', 'miracle', 'beast']) {
        const b = object(raw2[key]) ? raw2[key] : {};
        const add = object(b.add) ? b.add : {};
        const upgrading = b.upgrading === true && Number(b.doneAt) > 0;
        next.buildings[key] = {
          level: Math.max(1, Math.min(BUILDING_MAX_LEVEL, integer(b.level, 1, 1))),
          upgrading: upgrading,
          doneAt: upgrading ? Math.max(0, integer(b.doneAt, 0)) : 0,
          buffId: Math.max(0, Math.min(3, integer(b.buffId, 0))),
          buffDate: validLocalDate(b.buffDate) ? b.buffDate : '',
          add: key === 'miracle'
            ? { power: Math.max(0, integer(add.power, 0)), agility: Math.max(0, integer(add.agility, 0)), speed: Math.max(0, integer(add.speed, 0)), hp: Math.max(0, integer(add.hp, 0)) }
            : null,
          addType: Number.isFinite(Number(b.addType)) ? Number(b.addType) : -1,
        };
      }
      /* ⚠ 这里**不结算**升级完成：结算必须发生在"进村庄"时（原版 `showHomeLand` → `checkUpgraded`），
       * 读档就结算会让"今天升级、明天回来看完成动画"这条路走不通。 */
    }
    /* 幻兽牧场：孵化点 / 存储格 / 幻兽列表 / 出战队伍。老档没有时给一份可体验的
     * 初始孵化点（1000），幻兽牧场升级会再补 200 点。 */
    ensurePetTables();
    {
      next.hatchPoint = Math.max(0, integer(raw.hatchPoint, 1000, 0, 9999999));
      next.petsCapacity = Math.max(1, Math.min(PET_MAX_CAPACITY, integer(raw.petsCapacity, 6, 1)));
      const seenKeys = new Set();
      next.pets = (Array.isArray(raw.pets) ? raw.pets : []).filter((p) => object(p)).slice(0, PET_MAX_CAPACITY).map((p) => {
        const def = PET_BY_ID.get(Number(p.id));
        if (!def) return null;
        let key = typeof p.key === 'string' && p.key ? p.key.slice(0, 40) : '';
        if (!key || seenKeys.has(key)) key = 'pet' + def.id + '_' + (seenKeys.size + 1);
        seenKeys.add(key);
        const level = Math.max(1, Math.min(def.maxLevel, integer(p.level, 1, 1)));
        return {
          key, id: def.id, name: def.name, grade: def.grade, maxLevel: def.maxLevel,
          leadership: def.leadership, skillId: def.skillId,
          level, exp: Math.max(0, integer(p.exp, 0)), nextExp: petNextExp(level),
        };
      }).filter(Boolean);
      const keys = new Set(next.pets.map((p) => p.key));
      next.petsTeam = [...new Set((Array.isArray(raw.petsTeam) ? raw.petsTeam : []).map(String))]
        .filter((k) => keys.has(k)).slice(0, 3);
    }
    // 超级松鼠（原版 VIP）：旧档没有这个字段，补一份未开通的默认值。
    {
      const v = object(raw.vip) ? raw.vip : {};
      next.vip = {
        level: Math.max(1, Math.min(VIP_MAX_LEVEL, integer(v.level, 1) || 1)),
        exp: Math.max(0, integer(v.exp, 0)),
        until: Math.max(0, integer(v.until, 0)),
        capAdded: Math.max(0, integer(v.capAdded, 0)),
        capApplied: v.capApplied === true,
        lastDaily: typeof v.lastDaily === 'string' ? v.lastDaily : '',
      };
    }
    next.battles = normalizeBattleHistory(next.battles);
    /* 「消息」上的红点（new）记账：**必须落存档**（用户 2026-10 口径）。
     * WebView 每次启动都是新的数据目录，localStorage 不跨次启动保留，于是**每次打开游戏
     * 红点都重新亮一次**（用户报的就是"每次打开游戏后消息必有 new"）。
     * 落进存档就跟着 save/progress.json 走，换机器同步也一致（红点不会再重复亮）。
     * 形状只做浅校验：非负整数、不超过当前时间（未来时间会让红点再也不亮）。 */
    next.msgSeenAt = Math.min(Date.now(), integer(next.msgSeenAt, 0, 0));
    // 好友：只保留名字合法的条目，等级夹在 1~满级；500 是防滥用安全线（原版无上限，见 FRIEND_LIMIT）
    /* 同名好友只留第一位：老档 / 早期联机存档里出现过重复名字（用户 2026-10-24 口径：
     * 已有重复项不会继续显示成两行；`addFriend` 也会在写入前再挡一次。 */
    const friendNames = new Set();
    next.friends = (Array.isArray(raw.friends) ? raw.friends : []).filter((f) => object(f) && typeof f.name === 'string' && f.name.trim())
      .filter((f) => {
        const name = String(f.name).trim().slice(0, 20);
        if (!name || friendNames.has(name)) return false;
        friendNames.add(name);
        return true;
      })
      .slice(0, FRIEND_LIMIT).map((f) => ({
        name: String(f.name).trim().slice(0, 20),
        level: Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(f.level, 1, 1))),
        power: integer(f.power, GData.NEW_PLAYER.power, 1),
        agility: integer(f.agility, GData.NEW_PLAYER.agility, 1),
        speed: integer(f.speed, GData.NEW_PLAYER.speed, 1),
        hp: integer(f.hp, GData.NEW_PLAYER.maxHp, 1),
        note: typeof f.note === 'string' ? f.note.slice(0, 12) : '',
        since: validLocalDate(f.since) ? f.since : localDate(),
      }));
    next.dailyClaimDate = typeof next.dailyClaimDate === 'string' ? next.dailyClaimDate : '';
    next.loginStreak = Math.max(0, integer(next.loginStreak, 0, 0));
    next.friendMessages = {};
    if (object(raw.friendMessages)) {
      for (const name of Object.keys(raw.friendMessages).slice(0, FRIEND_LIMIT)) {
        const list = Array.isArray(raw.friendMessages[name]) ? raw.friendMessages[name] : [];
        const clean = list.filter((m) => object(m) && typeof m.text === 'string' && m.text.trim())
          .slice(-50)
          .map((m) => ({
            text: String(m.text).trim().slice(0, 80),
            at: Math.max(0, Math.min(Date.now(), integer(m.at, 0, 0))),
          }));
        if (clean.length) next.friendMessages[String(name).trim().slice(0, 20)] = clean;
      }
    }
    // 每日任务：旧档没有就留空，首次打开「活动」时按当天补上
    next.quests = object(raw.quests) && Array.isArray(raw.quests.list) && typeof raw.quests.date === 'string' ? raw.quests : null;
    next.dailyCounters = object(raw.dailyCounters) && typeof raw.dailyCounters.date === 'string' ? raw.dailyCounters : null;
    next.dailyStatsDate = typeof next.dailyStatsDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(next.dailyStatsDate) ? next.dailyStatsDate : '';
    next.challengeDaily = object(raw.challengeDaily) && validLocalDate(raw.challengeDaily.date)
      ? { date: raw.challengeDaily.date, count: Math.max(0, integer(raw.challengeDaily.count, 0, 0)) }
      : null;
    next.shopPurchaseDate = typeof next.shopPurchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(next.shopPurchaseDate) ? next.shopPurchaseDate : '';
    next.shopPurchases = {};
    if (object(raw.shopPurchases)) for (const id of Object.keys(raw.shopPurchases)) {
      if (propMap.getValue(id)) next.shopPurchases[id] = integer(raw.shopPurchases[id], 0);
    }
    // 本机偏好（音乐音量/静音、分辨率、全面屏）也写进存档：换浏览器或换机器同步后设置还在。
    next.settings = normalizeSettings(raw.settings);
    // 刷新/重进后重打该场，不重复扣挑战书、不掉层。
    {
      const runShape = (r) => {
        if (!object(r)) return null;
        const layer = Math.floor(Number(r.layer));
        if (!Number.isFinite(layer) || layer < 1 || !Array.isArray(r.plan) || !r.plan.length) return null;
        const copy = Object.assign({}, r);
        delete copy.attempt;
        /* 待选增益 / 排队中的下一批 / 上一场失利的必选窗都要跟着存档走：
         * 以前这里把 choices 直接抹成 null，玩家退出重进就白丢一次战斗掉落
         *（还能靠重打同一场刷新）；`pendingRetry` 若不保留则可以直接无代价重打。
         * 深校验（无效 id、层号/场次对不上）在 tower.js 的 normalizeRun 里做。 */
        copy.choices = Array.isArray(copy.choices) ? copy.choices : null;
        copy.choiceQueue = Array.isArray(copy.choiceQueue) ? copy.choiceQueue : [];
        return copy;
      };
      const tw = object(raw.tower) ? raw.tower : {};
      next.tower = {
        maxLayer: Math.max(0, integer(tw.maxLayer, 0)),
        /* 「本层失败后免费再战一次」的标记（挑战塔）：以前这里没列它，刷新一次就白丢一次
         *（玩家视角＝「重进游戏后那次免费重试没了」）。层号与日期都要像存档里其它进度一样留着。 */
        retry: (object(tw.retry) && Math.floor(Number(tw.retry.layer)) >= 1)
          ? { layer: Math.floor(Number(tw.retry.layer)), date: typeof tw.retry.date === 'string' ? tw.retry.date : '' }
          : null,
        run: runShape(tw.run),
      };
      const en = object(raw.endless) ? raw.endless : {};
      next.endless = {
        best: Math.max(0, integer(en.best, 0)), weekBest: Math.max(0, integer(en.weekBest, 0)),
        weekKey: typeof en.weekKey === 'string' ? en.weekKey : '',
        bestLayer: Math.max(0, integer(en.bestLayer, 0)),
        /* 勇者剧本的最高纪录与经典分开记（用户 2026-10：入口只显示经典最高层/最高分）。
         * ⚠ 这里以前是显式白名单、漏了这三个字段 —— 读档后勇者纪录直接清零；新增字段必须补进来。 */
        heroBest: Math.max(0, integer(en.heroBest, 0)),
        heroWeekBest: Math.max(0, integer(en.heroWeekBest, 0)),
        heroBestLayer: Math.max(0, integer(en.heroBestLayer, 0)),
        shieldDate: typeof en.shieldDate === 'string' ? en.shieldDate : '',
        /* 剧情的「只播一次」记账必须跟着存档走（跨局）：以后往 endless() 加
         * 「已经播过/已经给过」字段时记得一起加到这里，否则重载即清零、文案重播。
         * 只做浅校验：保留所有 id，丢掉非布尔垃圾值。 */
        storySeen: (() => {
          const src = object(en.storySeen) ? en.storySeen : {};
          const out = {};
          for (const k of Object.keys(src)) if (src[k] === true || src[k] === 1) out[String(k)] = true;
          return out;
        })(),
        /* 剧情 / 挑战模式的开关（默认剧情模式）：同样不能在重载后被打回默认。 */
        storyOn: en.storyOn !== false,
        // 最近一局战报只展示既有结算，重载后不能丢失，也不能再次发奖。
        lastSummary: object(en.lastSummary) && en.lastSummary.version === 1
          ? Object.assign({}, en.lastSummary) : null,
        run: runShape(en.run),
      };
    }
    clampPermanentStats(next);
    return stripModernBlackContent(next);
  }

  /** 存档里的本机偏好；缺字段/坏值一律回落到默认值。 */
  function normalizeSettings(raw) {
    const st = object(raw) ? raw : {};
    const volume = Number(st.volume);
    return {
      volume: Number.isFinite(volume) && st.volume !== null && st.volume !== '' ? Math.max(0, Math.min(1, volume)) : 1,
      muted: st.muted === true,
      resolution: RESOLUTION_KEYS.includes(String(st.resolution)) ? String(st.resolution) : 'auto',
      fullscreen: st.fullscreen === true,
      /* 安卓沉浸模式：默认隐藏状态栏（桌面/网页没有这个开关的实际效果）；
       * 显式关闭过才保持 false。旧档没有这个字段时按 true 迁移，解决状态栏常驻。 */
      hideStatusBar: st.hideStatusBar !== false,
      /* 跳过键显示开关：默认开；关闭只隐藏战斗中的跳过键，不改变等级/VIP 解锁条件。 */
      showSkip: st.showSkip !== false,
      /* 后台运行开关：默认关（切后台暂停音乐并冻结计时器，省电）。
       * 打开后切后台不暂停音乐、安卓壳也不 pauseTimers，游戏继续跑。 */
      backgroundRun: st.backgroundRun === true,
      /* 兼容渲染：Android 16 / Adreno 的 Vulkan 合成器丢贴图层时，整页落软件图层。
       * auto = 只对现场确认过绿屏的**整机**（K90 Pro Max / MagicPad3 Pro）自动开（默认）；
       * on/off 供其它机型手动逃生；没有绿屏证据的机器不要自动开。 */
      compatRender: ['auto', 'on', 'off'].includes(String(st.compatRender)) ? String(st.compatRender) : 'auto',
      uiMode: UIMODE_KEYS.includes(String(st.uiMode)) ? String(st.uiMode) : 'classic',
    };
  }
  /** 当前偏好（没有存档时给默认值，读到的对象就是存档里的那一份）。 */
  function settings() {
    if (!S) return normalizeSettings(null);
    if (!object(S.settings)) S.settings = normalizeSettings(null);
    return S.settings;
  }
  function setSettings(patch) {
    const st = settings();
    if (object(patch)) for (const key of Object.keys(patch)) st[key] = patch[key];
    S.settings = normalizeSettings(st);
    save();
    return S.settings;
  }
  /* ---------- 双界面独立存档：槽位读写 ---------- */
  function readUiModePref() {
    try {
      const v = localStorage.getItem(UI_MODE_KEY);
      return SAVE_SLOTS.includes(String(v)) ? String(v) : null;
    } catch (e) { return null; }
  }
  function writeUiModePref(mode) {
    if (!SAVE_SLOTS.includes(String(mode))) return;
    try { localStorage.setItem(UI_MODE_KEY, String(mode)); } catch (e) {}
  }
  /** 记住「当前正在用的界面」：每次切模式、保存、关页都会写 localStorage。
   *  下次启动 `saveMode = readUiModePref()` 直接回到上次关掉的界面，而不是按默认槽位。 */
  function rememberUiMode() {
    const mode = (S && object(S.settings) && validSaveMode(S.settings.uiMode))
      ? String(S.settings.uiMode) : slotMode();
    if (S) {
      S.settings = normalizeSettings(S.settings);
      S.settings.uiMode = mode;
    }
    saveMode = mode;
    writeUiModePref(mode);
    return mode;
  }
  function validSaveMode(mode) { return SAVE_SLOTS.includes(String(mode)); }
  /** 旧档没有槽位标记时，按存档里的 settings.uiMode 认领。 */
  function playerMode(raw) {
    try { return normalizeSettings(object(raw) ? raw.settings : null).uiMode; }
    catch (e) { return 'classic'; }
  }
  /** 旧档里**明确写过的** uiMode；没有就返回 null，交给当前偏好认领。
   *  旧版本存档不一定有 settings，直接按 normalize 的默认 classic 会把它们塞错槽。 */
  function explicitPlayerMode(raw) {
    const m = object(raw) && object(raw.settings) ? String(raw.settings.uiMode) : '';
    return validSaveMode(m) ? m : null;
  }
  function slotMode() { return validSaveMode(saveMode) ? saveMode : DEFAULT_SAVE_SLOT; }
  function otherMode(mode) { return mode === 'modern' ? 'classic' : 'modern'; }
  /** 黑装内容是否可用：现代界面整体关闭，经典界面保持原样。 */
  function blackGearEnabled() { return slotMode() === 'classic'; }
  function isBlackGearId(id) {
    const gi = gearInst(Number(id));
    return !!gi && Number(gi.quality) === 5;
  }
  function isBlackPropId(id) { return BLACK_PROP_IDS.includes(Number(id)); }
  function canSocketGem(gear) {
    if (!gear) return false;
    /* 原始存档实例只有 id/orange，没有 quality；必须经 gearQuality 把 q4/q5 也从 gearMap 读出来。 */
    const q = gearQuality(gear);
    return gear.orange === true || q === 4 || q === 5 || isBlackGearId(gear.id);
  }
  function stripModernBlackContent(slot) {
    if (!slot || !object(slot) || !object(slot.settings) || slot.settings.uiMode !== 'modern') return slot;
    slot.gears = (Array.isArray(slot.gears) ? slot.gears : []).filter((g) => !isBlackGearId(g && g.id));
    if (object(slot.props)) for (const id of BLACK_PROP_IDS) delete slot.props[id];
    slot.blackCardsWeek = { week: '', count: 0 };
    slot.blackTowerLayer = 0;
    slot.blackBox100 = false;
    if (slot.chestPending && object(slot.chestPending.reward)) {
      const rw = slot.chestPending.reward;
      if ((rw.kind === 'prop' && isBlackPropId(rw.id)) || (rw.kind === 'gear' && isBlackGearId(rw.id))) {
        slot.chestPending = null;
      }
    }
    return slot;
  }
  function stripDualFields(raw) {
    const out = Object.assign({}, object(raw) ? raw : {});
    delete out.__dualMode;
    delete out.__dualOther;
    delete out.__dualSaves;
    return out;
  }
  function normalizeSlot(raw) {
    if (!object(raw)) return null;
    const slot = normalizeSave(stripDualFields(raw));
    delete slot.__dualMode;
    delete slot.__dualOther;
    delete slot.__dualSaves;
    return slot;
  }
  /** 双槽存档的槽位：顶层永远是**当前写出的界面**（旧工具/测试直接改顶层字段也有效），
   *  另一界面只存在 `__dualOther` 里。兼容短暂出现过的 `__dualSaves` 旧格式。 */
  function dualSlots(raw) {
    if (!object(raw) || (!object(raw.__dualOther) && !object(raw.__dualSaves))) return null;
    const top = normalizeSlot(raw);
    if (!top) return null;
    const topMode = explicitPlayerMode(raw) || (validSaveMode(raw.__dualMode) ? String(raw.__dualMode) : null)
      || playerMode(raw) || slotMode();
    const slots = { [topMode]: top };
    if (object(raw.__dualOther)) {
      const other = normalizeSlot(raw.__dualOther);
      if (other) slots[otherMode(topMode)] = other;
    } else if (object(raw.__dualSaves)) {
      const old = raw.__dualSaves;
      for (const mode of SAVE_SLOTS) {
        if (mode === topMode) continue;
        const slot = normalizeSlot(old[mode]);
        if (slot) slots[mode] = slot;
      }
    }
    return { slots, topMode };
  }
  /** 读一条双槽存档；返回 true=当前界面有进度，false=当前界面没有（但另一槽可能已放进 otherSlot）。 */
  function applyDualPayload(raw) {
    const dual = dualSlots(raw);
    if (!dual) return null;
    let mode = readUiModePref();
    if (!validSaveMode(mode)) mode = dual.topMode;
    if (!validSaveMode(mode)) mode = DEFAULT_SAVE_SLOT;
    let target = dual.slots[mode];
    let other = dual.slots[otherMode(mode)] || null;
    /* 当前界面槽位不见了、另一界面还有档：**直接载入另一槽**，不要停在标题页。
     * 旧行为是 S=null（显示标题/新开局），玩家会看到「初始存档」；下一次启动
     * 「在初始存档与有进度的存档之间横跳」。只有两槽都没有档时才返回 false。 */
    if (!target && other) {
      mode = otherMode(mode);
      target = other;
      other = null;
    } else if (target && other && isFreshPayload(target) && !isFreshPayload(other)) {
      /* 当前槽是 1 级空档、另一槽却是有进度的档：优先把进度救出来。
       * 看到的是「初始存档」；下一次界面偏好变化又可能读回另一槽 —— 横跳。
       * 只在当前槽确实是空档时换，玩家真在新号上打过一场（allWins/stages）就不动。 */
      const oldTarget = target;
      mode = otherMode(mode);
      target = other;
      other = oldTarget;
    }
    saveMode = mode;
    writeUiModePref(mode);
    otherSlot = other;
    if (!target) { S = null; return false; }
    S = target;
    S.settings = normalizeSettings(S.settings);
    S.settings.uiMode = mode;
    return true;
  }
  /** 旧版单槽存档：明确写过 uiMode 的按它认领；没写过的按当前偏好/新号默认认领。
   *  若当前偏好是另一界面且旧档明确属于另一界面，就把它放进另一槽。 */
  function applyLegacyPayload(raw) {
    const legacy = normalizeSlot(raw);
    if (!legacy) return false;
    const explicit = explicitPlayerMode(raw);
    const pref = readUiModePref();
    const legacyMode = explicit || pref || DEFAULT_SAVE_SLOT;
    legacy.settings = normalizeSettings(legacy.settings);
    legacy.settings.uiMode = legacyMode;
    if (!validSaveMode(pref)) {
      saveMode = legacyMode;
      writeUiModePref(legacyMode);
      otherSlot = null;
      S = legacy;
      return true;
    }
    saveMode = pref;
    writeUiModePref(pref);
    /* 旧版单槽存档只有这一份进度，**不能**因为 localStorage 里的界面偏好与它
     * 单槽档直接作为当前界面的进度载入，界面观感按当前偏好走。 */
    saveMode = pref;
    legacy.settings.uiMode = pref;
    otherSlot = null;
    S = legacy;
    return true;
  }
  function adoptPayload(raw, opts) {
    if (!object(raw)) return false;
    const dual = applyDualPayload(raw);
    const ok = dual === null ? applyLegacyPayload(raw) : dual;
    /* 上次开箱开出来、还没点「确定领取」就关掉游戏的那一包：进游戏时直接入账，
     * 避免「箱子已经消耗、奖励却永远拿不到」。
     * 导入路径会先 `deferSettle` —— 等校验/写盘都成功后由文件载入统一结算，
     * 避免一份还没写进去的档先把奖励发进旧档。 */
    if (!(opts && opts.deferSettle)) settlePendingChest();
    return ok;
  }
  /** 当前界面 + 另一界面两份进度一起序列化；顶层仍是当前进度的原始字段，
   *  旧工具/同步脚本读 name/level/savedAt 不受影响。 */
  function savePayload() {
    if (!S) return S;
    clampPermanentStats();
    // 所有写盘/镜像/导出都走这里；直接修改状态及未激活的另一槽也不能绕过上限。
    trimBattleHistory(S);
    if (otherSlot) trimBattleHistory(otherSlot);
    const mode = rememberUiMode();
    S.settings = normalizeSettings(S.settings);
    S.settings.uiMode = mode;
    const out = Object.assign({}, S);
    delete out.__dualMode;
    delete out.__dualOther;
    delete out.__dualSaves;
    out.__dualMode = mode;
    if (otherSlot) {
      otherSlot.settings = normalizeSettings(otherSlot.settings);
      otherSlot.settings.uiMode = otherMode(mode);
      out.__dualOther = otherSlot;
    }
    return out;
  }
  /** 当前进度的**完整**双槽快照（字符串）。导入失败时用它把内存恢复原样，
   *  不依赖磁盘/浏览器里那份是否已经被写到一半。 */
  function exportPayload() {
    try { return S ? JSON.stringify(savePayload()) : ''; } catch (e) { return ''; }
  }
  function restorePayload(raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return adoptPayload(parsed);
    } catch (e) { return false; }
  }
  /** 导入前把一份存档载入内存并生成**规范化后的**待写盘正文。
   *  返回的 `name/level` 是实际载入的槽位（双槽档不一定是顶层），
   *  调用方必须用它做成功提示与写后核对，不能拿原始 JSON 的顶层字段冒充。
   *  失败时不改内存；成功后若写盘失败，调用方用 `restorePayload` 回滚。 */
  function prepareImport(raw) {
    let parsed;
    try {
      /* iOS/Windows 上手工转存的文件可能带 UTF-8 BOM；JSON.parse 不认。 */
      const text = typeof raw === 'string' ? raw.replace(/^\uFEFF/, '') : raw;
      parsed = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) { return { ok: false, msg: '这个文件不是合法的 JSON' }; }
    if (!object(parsed) || Array.isArray(parsed)) return { ok: false, msg: '这不是一个存档对象' };
    const before = { S, otherSlot, saveMode };
    const beforePref = readUiModePref();
    const rollback = () => {
      S = before.S; otherSlot = before.otherSlot; saveMode = before.saveMode;
      try {
        if (beforePref) writeUiModePref(beforePref);
        else localStorage.removeItem(UI_MODE_KEY);
      } catch (e) {}
    };
    try {
      const loaded = adoptPayload(parsed, { deferSettle: true });
      if (!loaded) {
        rollback();
        return { ok: false, msg: '存档里没有当前界面可载入的进度' };
      }
      /* 待领取的金宝箱奖励在读档时结算；导入也一样，先结清再写，避免文件里永远留着
       * 一份「箱子已消耗、奖励未领取」的中间态。 */
      settlePendingChest({ save: false });
      S.savedAt = Date.now();
      const name = String(S.name || '小松鼠');
      const level = Math.max(1, Number(S.level) || 1);
      const mode = slotMode();
      let payload = '';
      try { payload = JSON.stringify(savePayload()); } catch (e) { payload = ''; }
      if (!payload) {
        rollback();
        return { ok: false, msg: '无法生成要写入的存档' };
      }
      return { ok: true, name, level, mode, payload };
    } catch (e) {
      rollback();
      return { ok: false, msg: '导入存档时出错：' + String((e && e.message) || e) };
    }
  }
  /** 把一份存档里**不会随时间/读档顺序变化**的进度字段抽成指纹。
   *  用于写盘后核对「读回来的就是刚导入的那份」；刻意排除 savedAt、体力回复时间戳等。 */
  function importFingerprint(raw) {
    let v;
    try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return ''; }
    if (!object(v)) return '';
    const arr = (x) => (Array.isArray(x) ? x.slice() : []);
    const sortedProps = (x) => {
      const out = {};
      if (object(x)) for (const key of Object.keys(x).sort()) out[key] = x[key];
      return out;
    };
    const slot = (x) => ({
      name: String(x.name || ''), level: Number(x.level) || 1,
      exp: Number(x.exp) || 0, reborn: Number(x.reborn) || 0, allWins: Number(x.allWins) || 0,
      power: Number(x.power) || 0, agility: Number(x.agility) || 0,
      speed: Number(x.speed) || 0, maxHp: Number(x.maxHp) || 0,
      energy: Number(x.energy) || 0, maxEnergy: Number(x.maxEnergy) || 0,
      goldPoint: Number(x.goldPoint) || 0, goldCup: Number(x.goldCup) || 0, integral: Number(x.integral) || 0,
      weapons: arr(x.weapons), skills: arr(x.skills), props: sortedProps(x.props),
      stages: sortedProps(x.stages),
      gears: arr(x.gears).map((g) => [Number(g && g.id) || 0, String((g && g.key) || ''),
        !!(g && g.used), Number(g && g.attr) || 0, arr(g && g.ext), g && g.gem ? [g.gem.id, 0] : null]),
      uiMode: object(x.settings) ? String(x.settings.uiMode || '') : '',
    });
    return JSON.stringify({
      slot: slot(v),
      other: object(v.__dualOther) ? slot(v.__dualOther) : null,
    });
  }
  /** 写盘后核对：真正读回来的当前槽位必须和 `prepareImport` 载入的是同一份。
   *  不是原始字节 —— 读档本身会刷新 savedAt 之类的时间戳。 */
  function verifyImport(prepared) {
    if (!prepared || !S) return false;
    const want = importFingerprint(prepared.payload);
    if (!want) return false;
    return want === importFingerprint(savePayload());
  }
  /** 切换界面槽位：保存当前进度，载入另一界面；没有另一界面时新建 1 级角色。 */
  function switchMode(mode) {
    const m = String(mode);
    if (!validSaveMode(m)) return { ok: false, mode: slotMode(), changed: false, created: false };
    if (m === slotMode()) return { ok: true, mode: m, changed: false, created: false };
    if (!S) {
      saveMode = m;
      writeUiModePref(m);
      return { ok: true, mode: m, changed: true, created: false };
    }
    save();
    const old = S;
    if (otherSlot) {
      const target = normalizeSlot(otherSlot);
      S = target;
      otherSlot = old;
      saveMode = m;
      writeUiModePref(m);
      S.settings = normalizeSettings(S.settings);
      S.settings.uiMode = m;
      settlePendingChest({ save: false });
      save();
      try { if (window.UI && UI.applyUiMode) UI.applyUiMode(m); } catch (e) {}
      return { ok: true, mode: m, changed: true, created: false };
    }
    saveMode = m;
    otherSlot = old;
    writeUiModePref(m);
    newGame((old && old.name) || '小松鼠', { uiMode: m });
    return { ok: true, mode: m, changed: true, created: true };
  }
  function activeUiMode() { return slotMode(); }
  function hasModeSave(mode) {
    const m = validSaveMode(mode) ? String(mode) : slotMode();
    return m === slotMode() ? !!S : !!otherSlot;
  }

  function resolutionHeight(key) {
    const row = RESOLUTIONS.find((r) => r.key === String(key));
    return row ? row.height : 0;
  }

  // ---------- 调试开关（js/debug.js 未加载时全部为关闭） ----------
  function debugOn(key) {
    try { return !!(window.Debug && window.Debug.enabled && window.Debug.enabled(key)); } catch (e) { return false; }
  }
  /* 【2026-10 用户口径】调试开关的唯一出口要**挂到 window** 上：
   * 挂上之后 bare `debugOn` 在 vm/浏览器里都能解析到它，两个模式里的调试开关才真正生效。 */
  if (typeof window !== 'undefined') window.debugOn = debugOn;

  // 收徒上限随师父等级变化：10 级前 1 个，10-19 级 2 个，20 级以上 3 个
  function apprenticeCap(level) {
    const lv = Number.isFinite(Number(level)) ? Number(level) : (S ? S.level : 1);
    return lv >= 20 ? 3 : lv >= 10 ? 2 : 1;
  }
  /** 拜师成功后自动学会的师父技能（原版技能 13＝师父驾到）。 */
  const MASTER_SKILL_ID = 13;
  const MASTER_SKILL_NAME = '师父驾到';
  /** 学习技能：已有则升级，返回本次结果（供界面提示）。
   *  拜师赠送的「师父驾到」不受武器/技能总数上限限制（剧情赠予）。 */
  function learnSkill(id, level) {
    id = Number(id);
    const base = skillsMap.getValue(id);
    if (!base) return { ok: false, msg: '没有这个技能' };
    const lv = Math.max(1, Math.min(15, Number(level) || 1));
    const entry = S.skills.find((s) => Number(String(s).split(':')[0]) === id);
    if (entry) {
      const cur = Number(String(entry).split(':')[1]) || 1;
      if (cur >= lv) return { ok: false, msg: '已经掌握【' + base.name + '】', name: base.name, level: cur, upgraded: false };
      S.skills[S.skills.indexOf(entry)] = id + ':' + lv;
      save();
      return { ok: true, msg: '【' + base.name + '】升到 ' + lv + ' 级', name: base.name, level: lv, upgraded: true };
    }
    S.skills.push(id + ':' + lv);
    save();
    return { ok: true, msg: '学会【' + base.name + '】', name: base.name, level: lv, upgraded: false };
  }
  function setMaster(master) {
    if (!master || !master.name) return { ok: false, msg: '师父信息无效' };
    S.master = {
      name: String(master.name).slice(0, 20),
      level: integer(master.level, 1, 1),
      power: Number.isFinite(Number(master.power)) ? Number(master.power) : null,
      agility: Number.isFinite(Number(master.agility)) ? Number(master.agility) : null,
      speed: Number.isFinite(Number(master.speed)) ? Number(master.speed) : null,
      hp: Number.isFinite(Number(master.hp)) ? Number(master.hp) : null,
      weapons: Array.isArray(master.weapons) ? master.weapons.slice() : [],
      skills: Array.isArray(master.skills) ? master.skills.slice() : [],
      /* 师父**身上穿的**也一起记下来：经典模式挑战页右侧要把师父自己的装备贴到立绘上、
       * 「查看」要显示他穿了什么（原版这两项都来自服务端下发的 `wearsList`）。
       * ⚠ 少了这一段，「查看师父」与右侧立绘就永远是空的（`State.gearPart` 也补不回来）。 */
      gears: normalizeFoeGears(master.gears),
    };
    const learned = learnSkill(MASTER_SKILL_ID, 1);
    save();
    return { ok: true, master: S.master, learned };
  }
  function clearMaster() { S.master = null; save(); return true; }
  /** 收徒：把对手的三围/武器技能一并记下来，便于查看徒弟数据。 */
  function addPrentice(foe) {
    if (!foe || !foe.name) return { ok: false, msg: '徒弟信息无效' };
    if (S.prentices.length >= apprenticeCap(S.level)) return { ok: false, msg: '收徒名额已满' };
    if (S.prentices.some((p) => p.name === foe.name)) return { ok: false, msg: '已经收过这个徒弟了' };
    const row = {
      name: String(foe.name).slice(0, 20),
      level: integer(foe.level, 1, 1),
      exp: integer(foe.exp, 0),
      power: integer(foe.power, 0, 0), agility: integer(foe.agility, 0, 0),
      speed: integer(foe.speed, 0, 0), hp: integer(foe.hp, 0, 0),
      weapons: Array.isArray(foe.weapons) ? foe.weapons.slice() : [],
      skills: Array.isArray(foe.skills) ? foe.skills.slice() : [],
      /* 徒弟身上穿的也记下来（「查看徒弟」要显示装备；原版由服务端下发 `wearsList`）。 */
      gears: normalizeFoeGears(foe.gears),
      since: localDate(),
      joinedAt: Date.now(), tributeClaimedDate: '',
    };
    if (!row.skills.some(skill => Number(String(skill).split(':')[0]) === MASTER_SKILL_ID)) row.skills.push(MASTER_SKILL_ID + ':1');
    S.prentices.push(row);
    save();
    return { ok: true, apprentice: row };
  }
  function removePrentice(name) {
    const i = S.prentices.findIndex((p) => p.name === name);
    if (i < 0) return false;
    S.prentices.splice(i, 1);
    save();
    return true;
  }
  /* 村庄建筑（祭坛/神迹/幻兽牧场）对齐原版 MainMovie.as：升级完成在下次进村庄结算，
   * 复刻无服务端，三套都落存档、用 localDate() 当天判定。 */
  /** 建筑等级 1~30：`[等级, 碎片双倍%, 经验双倍%, 金松果双倍%, 升级金松果, 升级小时]`
   *  —— 逐行照抄原版 `buildingUpInfo`（MainMovie.as:19145），不要在这里手改数值。 */
  const BUILDING_UP_INFO = [
    [1, 5, 5, 5, 50, 4], [2, 6, 6, 6, 60, 6], [3, 7, 7, 7, 70, 8], [4, 8, 8, 8, 80, 10],
    [5, 9, 9, 9, 90, 12], [6, 10, 10, 10, 100, 14], [7, 11, 11, 11, 110, 16], [8, 12, 12, 12, 120, 18],
    [9, 13, 13, 13, 130, 20], [10, 14, 14, 14, 140, 22], [11, 15, 15, 15, 150, 24], [12, 16, 16, 16, 160, 26],
    [13, 17, 17, 17, 170, 28], [14, 18, 18, 18, 180, 30], [15, 19, 19, 19, 190, 32], [16, 20, 20, 20, 200, 34],
    [17, 21, 21, 21, 210, 36], [18, 22, 22, 22, 220, 38], [19, 23, 23, 23, 230, 40], [20, 24, 24, 24, 240, 42],
    [21, 25, 25, 25, 250, 44], [22, 26, 26, 26, 260, 46], [23, 27, 27, 27, 270, 48], [24, 28, 28, 28, 280, 50],
    [25, 29, 29, 29, 290, 52], [26, 30, 30, 30, 300, 54], [27, 31, 31, 31, 310, 56], [28, 32, 32, 32, 320, 58],
    [29, 33, 33, 33, 330, 60], [30, 34, 34, 34, 340, 62],
  ];
  const BUILDING_MAX_LEVEL = 30;
  /** 建筑 id → 存档键（原版 `buildingId`：1 祭坛 / 3 神迹 / 4 幻兽牧场）。 */
  const BUILDING_KEYS = ['altar', 'miracle', 'beast'];
  const BUILDING_IDS = { altar: 1, miracle: 3, beast: 4 };
  /* 最低使用等级（原版服务端按等级放出 buildingInfo；客户端本身没有这张表，
   * 这里按原版攻略/建筑开放顺序落成常量）：
   *   幻兽牧场 25 级（原版提示“25级后至村庄幻兽牧场使用”）
   * `mc3/mc4/mc5` 的末帧就是原版的墓碑/关闭外观；未到等级时停在末帧，
   * 点它只提示解锁等级，不进入地点页。 */
  const BUILDING_UNLOCK_LEVEL = { altar: 1, miracle: 30, beast: 25 };
  const WAR_UNLOCK_LEVEL = 35;
  /* 幻兽字典（原版 petsInfo / petsSkills）与等级经验。 */
  /* ⚠ 不能在这里直接读 `GData`：test-min-deps 会单独加载 state.js 检查全局挂载，
   * 那时 GData 还没定义。字典在真正要用时再懒加载。 */
  const PETS = [];
  const PET_BY_ID = new Map();
  let PET_SKILLS = {};
  let PET_GRADE_EXP = { 1: 1000, 2: 2000, 3: 5000, 4: 10000, 5: 20000 };
  let PET_GRADE_COST = { 2: 50, 3: 100, 4: 200, 5: 500 };
  function ensurePetTables() {
    if (PETS.length) return;
    const gd = (typeof GData !== 'undefined' && GData) ? GData : null;
    if (!gd) return;
    for (const p of (Array.isArray(gd.PETS) ? gd.PETS : [])) { PETS.push(p); PET_BY_ID.set(p.id, p); }
    PET_SKILLS = gd.PET_SKILLS || {};
    PET_GRADE_EXP = gd.PET_GRADE_EXP || PET_GRADE_EXP;
    PET_GRADE_COST = gd.PET_GRADE_COST || PET_GRADE_COST;
  }
  const PET_MAX_CAPACITY = 300;
  /* 幻兽解锁等级：原版提示「25级后至村庄幻兽牧场使用」
   * （MainMovie.as:1362）。随机敌人在此之前不能带幻兽。 */
  const PET_UNLOCK_LEVEL = 25;
  const petNextExp = (level) => Math.max(100, Math.round(100 * Math.max(1, Number(level) || 1)));
  function buildingUnlockLevel(key) {
    return Number(BUILDING_UNLOCK_LEVEL[key]) || 0;
  }
  function buildingUnlocked(key) {
    if (!BUILDING_KEYS.includes(key)) return false;
    const lv = integer(S && S.level, 1, 1);
    return lv >= buildingUnlockLevel(key);
  }
  function buildingTier(level) {
    return Math.max(1, Math.min(6, Math.ceil(Math.max(1, Number(level) || 1) / 5)));
  }
  function buildingUpInfo(level) {
    const lv = Math.max(1, Math.min(BUILDING_MAX_LEVEL, Math.round(Number(level) || 1)));
    const row = BUILDING_UP_INFO[lv - 1] || BUILDING_UP_INFO[0];
    return { level: lv, propRate: row[1], expRate: row[2], goldRate: row[3], gold: row[4], hour: row[5] };
  }
  /** 神迹等级对应的累计属性点（原版每次升级给 1 个随机点，5 点生命 = 1 次；
   *  存档里按四项分开记，这里只做读取与展示）。 */
  function miracleRecord() {
    const b = S.buildings && S.buildings.miracle;
    const add = (b && b.add) || {};
    return {
      power: Math.max(0, integer(add.power, 0)), agility: Math.max(0, integer(add.agility, 0)),
      speed: Math.max(0, integer(add.speed, 0)), hp: Math.max(0, integer(add.hp, 0)) * 5,
    };
  }
  /** 进入村庄时结算「升级完成」：原版 `checkUpgraded`（:9763）在**下次进村庄**时把
   *  返回本次刚完成的建筑列表（界面拿它弹提示）。 */
  function settleBuildings() {
    const done = [];
    const now = Date.now();
    for (const key of BUILDING_KEYS) {
      const b = S.buildings && S.buildings[key];
      if (!b || !b.upgrading) continue;
      if (Number(b.doneAt) > now) continue;
      b.upgrading = false;
      b.doneAt = 0;
      b.level = Math.min(BUILDING_MAX_LEVEL, Math.max(1, integer(b.level, 1, 1)) + 1);
      if (key === 'miracle') {
        /* 原版 `goHomeLand` 的 `attrAdd`：0 力量 / 1 敏捷 / 2 速度 / 3 生命（+5）。
         * 复刻在**完成的那一刻**随机一次并落存档，之后「神迹记录」读的就是它。 */
        const roll = Math.floor(Math.random() * 4);
        b.add = b.add || { power: 0, agility: 0, speed: 0, hp: 0 };
        if (roll === 0) b.add.power = integer(b.add.power, 0) + 1;
        else if (roll === 1) b.add.agility = integer(b.add.agility, 0) + 1;
        else if (roll === 2) b.add.speed = integer(b.add.speed, 0) + 1;
        else b.add.hp = integer(b.add.hp, 0) + 1;
        b.addType = roll;
      }
      if (key === 'beast') {
        S.hatchPoint = Math.max(0, integer(S.hatchPoint, 0) + 200);
        S.petsCapacity = Math.max(1, Math.min(PET_MAX_CAPACITY, integer(S.petsCapacity, 6, 1) + 1));
      }
      done.push({ key: key, id: BUILDING_IDS[key], level: b.level, addType: integer(b.addType, 0) });
    }
    for (const d of done) {
      if (d.key !== 'miracle') continue;
      const rec = S.buildings.miracle.add || {};
      if (d.addType === 0) S.power = integer(S.power, 1) + 1;
      else if (d.addType === 1) S.agility = integer(S.agility, 1) + 1;
      else if (d.addType === 2) S.speed = integer(S.speed, 1) + 1;
      else S.maxHp = integer(S.maxHp, 1) + 5;
      void rec;
    }
    if (done.length) save();
    return done;
  }
  function building(key) {
    if (!buildingUnlocked(key)) return null;
    const b = S.buildings && S.buildings[key];
    if (!b) return null;
    const lv = Math.max(1, Math.min(BUILDING_MAX_LEVEL, integer(b.level, 1, 1)));
    const remain = b.upgrading ? Math.max(0, Math.ceil((Number(b.doneAt) - Date.now()) / 60000)) : 0;
    return {
      key: key, id: BUILDING_IDS[key], level: lv, tier: buildingTier(lv),
      upgrading: b.upgrading === true, remainTime: remain,
      buffId: integer(b.buffId, 0), buffDate: typeof b.buffDate === 'string' ? b.buffDate : '',
      add: b.add || { power: 0, agility: 0, speed: 0, hp: 0 },
    };
  }
  function upgradeBuilding(key) {
    if (!buildingUnlocked(key)) return { ok: false, msg: '需要达到 ' + buildingUnlockLevel(key) + ' 级才能使用' + (BUILDING_LABEL[key] || '这个建筑') };
    const b = S.buildings && S.buildings[key];
    if (!b) return { ok: false, msg: '这里还没有建筑' };
    if (b.upgrading) return { ok: false, msg: '这个建筑正在升级中' };
    const lv = Math.max(1, Math.min(BUILDING_MAX_LEVEL, integer(b.level, 1, 1)));
    if (lv >= BUILDING_MAX_LEVEL) return { ok: false, msg: '建筑已达最高级！' };
    const info = buildingUpInfo(lv);
    if (integer(S.goldPoint, 0) < info.gold) return { ok: false, msg: '金松果不足（需要 ' + info.gold + ' 个）' };
    S.goldPoint = integer(S.goldPoint, 0) - info.gold;
    b.upgrading = true;
    b.doneAt = Date.now() + info.hour * 3600000;
    save();
    return { ok: true, gold: info.gold, hour: info.hour, level: lv + 1 };
  }
  /** 当天是否还能在祭坛领状态（原版 `gainBuff` 一天一次，服务端判定）。 */
  function buildingBuffClaimed(key) {
    if (!buildingUnlocked(key)) return false;
    const b = S.buildings && S.buildings[key];
    return !!(b && b.buffDate === localDate() && integer(b.buffId, 0) > 0);
  }
  function claimBuildingBuff(key) {
    if (!buildingUnlocked(key)) return { ok: false, msg: '需要达到 ' + buildingUnlockLevel(key) + ' 级才能使用' + (BUILDING_LABEL[key] || '这个建筑') };
    const b = S.buildings && S.buildings[key];
    if (!b) return { ok: false, msg: '这里还没有建筑' };
    if (buildingBuffClaimed(key)) return { ok: false, msg: '今天已经领过了，明天再来' };
    const buffId = 1 + Math.floor(Math.random() * 3);
    b.buffId = buffId;
    b.buffDate = localDate();
    save();
    const msg = buffId === 1 ? '你获得了经验竞技场特殊状态，有几率在参加时获得双倍奖励！'
      : buffId === 2 ? '你获得了碎片竞技场特殊状态，有几率在参加时获得双倍奖励！'
        : '你获得了关卡特殊状态，有几率在挑战关卡时获得更多金松果！';
    return { ok: true, buffId: buffId, msg: msg };
  }
  function activeBuildingBuff(kind) {
    const want = kind === 'arenaExp' ? 1 : kind === 'arenaProp' ? 2 : kind === 'stageGold' ? 3 : 0;
    if (!want) return false;
    for (const key of BUILDING_KEYS) {
      if (!buildingUnlocked(key)) continue;
      const b = S.buildings && S.buildings[key];
      if (b && integer(b.buffId, 0) === want && b.buffDate === localDate()) return true;
    }
    return false;
  }
  /** 建筑给的"当日双倍"概率（百分数）：没 buff 就是 0，有就取该建筑当前等级那一档。 */
  function buildingDoubleRate(key, kind) {
    const bid = kind === 'arenaExp' ? 1 : kind === 'arenaProp' ? 2 : kind === 'stageGold' ? 3 : 0;
    if (!bid || !buildingUnlocked(key) || !activeBuildingBuff(kind)) return 0;
    const b = S.buildings && S.buildings[key];
    if (!b) return 0;
    const info = buildingUpInfo(integer(b.level, 1, 1));
    return bid === 1 ? info.expRate : bid === 2 ? info.propRate : info.goldRate;
  }
  const BUILDING_LABEL = { altar: '祭坛', miracle: '神迹', beast: '幻兽牧场' };

  /* ---------- 幻兽牧场：孵化 / 队伍 / 喂养 / 进化 ---------- */
  /** 幻兽牧场等级对应的领导力（原版 getBuildingUpInfo(level).leaderShip = (level-1)*3+7）。 */
  function petLeadership() {
    ensurePetTables();
    const b = S.buildings && S.buildings.beast;
    const lv = Math.max(1, Math.min(BUILDING_MAX_LEVEL, integer(b && b.level, 1, 1)));
    return (lv - 1) * 3 + 7;
  }
  function petInfo(p) {
    ensurePetTables();
    if (!p) return null;
    const skill = (typeof GData !== 'undefined' && GData.petSkillInfo ? GData.petSkillInfo(p.skillId, p.level) : null) ||
      PET_SKILLS[p.skillId] || { name: '未知技能', remark: '暂无说明' };
    /* 详情页的「下一级」提示：原版 `doShowSummonsDeTail` 用 `getSkillLevelupRemark(id, level+1)`
     * 避免页面自己再按 base/step 算一遍（公式只在 GData 留一份）。 */
    const nextLevel = Math.min(Math.max(1, integer(p.maxLevel, 50, 1)), Math.max(1, integer(p.level, 1, 1) + 1));
    const nextSkill = (typeof GData !== 'undefined' && GData.petSkillInfo)
      ? GData.petSkillInfo(p.skillId, nextLevel) : null;
    return {
      key: p.key, id: p.id, name: p.name, grade: p.grade, maxLevel: p.maxLevel,
      leadership: p.leadership, skillId: p.skillId, skillName: skill.name, skillRemark: skill.remark,
      skillValue: skill.value == null ? 0 : skill.value, skillTrigger: skill.trigger == null ? 0 : skill.trigger,
      skillLevelupRemark: skill.levelupRemark || '',
      skillNextValue: nextSkill && nextSkill.value != null ? nextSkill.value : (skill.value == null ? 0 : skill.value),
      level: p.level, exp: p.exp, nextExp: p.nextExp, inTeam: (S.petsTeam || []).includes(p.key),
    };
  }
  function pets() { return (S.pets || []).map(petInfo); }
  function petByKey(key) { return (S.pets || []).find((p) => p.key === String(key)) || null; }
  function petTeam() { return (S.petsTeam || []).map(petByKey).filter(Boolean).map(petInfo); }
  function randomPetDef(grade) {
    ensurePetTables();
    const pool = PETS.filter((p) => !grade || p.grade === grade);
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : PETS[0];
  }
  /** 孵化：200 孵化点，按星级权重随机一只 1 级幻兽；存储格满/点数不足返回失败。 */
  function hatchPet() {
    ensurePetTables();
    if (!S || !Array.isArray(S.pets)) return { ok: false, msg: '幻兽数据还没准备好' };
    if (S.pets.length >= Math.min(PET_MAX_CAPACITY, integer(S.petsCapacity, 6, 1))) return { ok: false, msg: '幻兽存储格已满，先升级牧场或开启存储格' };
    if (integer(S.hatchPoint, 0) < 200) return { ok: false, msg: '孵化点不足（每次孵化需要200点）' };
    const roll = Math.random();
    const grade = roll < 0.55 ? 1 : roll < 0.82 ? 2 : roll < 0.95 ? 3 : 4;
    const def = randomPetDef(grade);
    const pet = {
      key: 'pet' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      id: def.id, name: def.name, grade: def.grade, maxLevel: def.maxLevel,
      leadership: def.leadership, skillId: def.skillId,
      level: 1, exp: 0, nextExp: petNextExp(1),
    };
    S.hatchPoint = integer(S.hatchPoint, 0) - 200;
    S.pets.push(pet);
    save();
    return { ok: true, pet: petInfo(pet), hatchPoint: S.hatchPoint };
  }
  /** 出战队伍：最多 3 只，领导力总和不能超过牧场等级的领导力。 */
  function setPetTeam(keys) {
    const list = [...new Set((Array.isArray(keys) ? keys : []).map(String))].slice(0, 3);
    const petsList = list.map(petByKey).filter(Boolean);
    if (petsList.length !== list.length) return { ok: false, msg: '队伍里有幻兽不存在' };
    const need = petsList.reduce((n, p) => n + p.leadership, 0);
    const cap = petLeadership();
    if (need > cap) return { ok: false, msg: '领导力不足（需要 ' + need + ' / 当前 ' + cap + '）' };
    S.petsTeam = list;
    save();
    return { ok: true, team: petTeam(), need, cap };
  }
  /** 喂养：消耗 1~3 只非出战幻兽 + 每只 20 金松果，给目标幻兽加经验并自动升级。 */
  function feedPet(targetKey, materialKeys) {
    const target = petByKey(targetKey);
    if (!target) return { ok: false, msg: '找不到要喂养的幻兽' };
    let mats = (Array.isArray(materialKeys) ? materialKeys : []).map(String)
      .filter((k) => k && k !== target.key).map(petByKey).filter(Boolean);
    if (!mats.length) {
      mats = (S.pets || []).filter((p) => p.key !== target.key && !(S.petsTeam || []).includes(p.key))
        .sort((a, b) => a.level - b.level || a.grade - b.grade).slice(0, 3);
    }
    mats = [...new Map(mats.map((p) => [p.key, p])).values()].slice(0, 3);
    if (!mats.length) return { ok: false, msg: '没有可消耗的幻兽（出战队伍里的不能喂）' };
    if (target.level >= target.maxLevel) return { ok: false, msg: '这只幻兽已经满级了' };
    const gold = mats.length * 20;
    if (integer(S.goldPoint, 0) < gold) return { ok: false, msg: '金松果不足（需要 ' + gold + ' 个）' };
    const gain = mats.reduce((n, p) => n + p.grade * 100 + p.level * 30, 0) + 50;
    S.goldPoint = integer(S.goldPoint, 0) - gold;
    const removed = new Set(mats.map((p) => p.key));
    S.pets = (S.pets || []).filter((p) => !removed.has(p.key));
    target.exp = Math.max(0, integer(target.exp, 0) + gain);
    let levels = 0;
    while (target.level < target.maxLevel) {
      target.nextExp = petNextExp(target.level);
      if (target.exp < target.nextExp) break;
      target.exp -= target.nextExp;
      target.level += 1;
      levels += 1;
    }
    if (target.level >= target.maxLevel) target.exp = 0;
    target.nextExp = petNextExp(target.level);
    S.petsTeam = (S.petsTeam || []).filter((k) => (S.pets || []).some((p) => p.key === k));
    save();
    return { ok: true, target: petInfo(target), gained: gain, levels, gold, materials: mats.map((p) => p.name) };
  }
  /** 进化：消耗目标 + 2 只同星级非出战幻兽 + 金松果，变成高一星的随机幻兽。
   *  `materialKeys` 给了就按玩家选的 2 只结算（界面「自由选择」走这条）；
   *  不给 / 不是数组时保留旧的「自动取前两只」行为，供老调用与存档脚本兼容。 */
  function evolvePet(targetKey, materialKeys) {
    const target = petByKey(targetKey);
    if (!target) return { ok: false, msg: '找不到要进化的幻兽' };
    if (target.grade >= 4) return { ok: false, msg: '四星幻兽已经是最高星级' };
    const nextGrade = target.grade + 1;
    let mats;
    if (Array.isArray(materialKeys)) {
      const keys = [...new Set((materialKeys || []).map(String).filter((k) => k && k !== target.key))];
      if (keys.length !== 2) return { ok: false, msg: '进化需要选择 2 只同星级材料幻兽' };
      mats = keys.map(petByKey);
      if (mats.some((p) => !p)) return { ok: false, msg: '选择的材料幻兽不存在' };
      if (mats.some((p) => p.grade !== target.grade)) return { ok: false, msg: '材料幻兽需要与目标同星级' };
      if (mats.some((p) => (S.petsTeam || []).includes(p.key))) {
        return { ok: false, msg: '出战队伍里的幻兽不能作为材料' };
      }
    } else {
      mats = (S.pets || []).filter((p) => p.key !== target.key && p.grade === target.grade && !(S.petsTeam || []).includes(p.key)).slice(0, 2);
    }
    if (mats.length < 2) return { ok: false, msg: '进化需要 2 只同星级、且不在出战队伍里的幻兽' };
    const cost = PET_GRADE_COST[nextGrade] || 200;
    if (integer(S.goldPoint, 0) < cost) return { ok: false, msg: '金松果不足（需要 ' + cost + ' 个）' };
    const def = randomPetDef(nextGrade);
    const pet = {
      key: 'pet' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      id: def.id, name: def.name, grade: def.grade, maxLevel: def.maxLevel,
      leadership: def.leadership, skillId: def.skillId,
      level: 1, exp: 0, nextExp: petNextExp(1),
    };
    const remove = new Set([target.key, ...mats.map((p) => p.key)]);
    const wasTeam = (S.petsTeam || []).includes(target.key);
    S.goldPoint = integer(S.goldPoint, 0) - cost;
    S.pets = (S.pets || []).filter((p) => !remove.has(p.key));
    S.pets.push(pet);
    S.petsTeam = (S.petsTeam || []).filter((k) => k !== target.key);
    if (wasTeam) S.petsTeam.push(pet.key);
    save();
    return { ok: true, pet: petInfo(pet), cost, materials: mats.map((p) => p.name) };
  }

  /** 幻兽队伍对战斗的被动加成：本轮先按原版「特技类型」折算成力/敏/速/生命，
   * 让队伍真正影响战斗；后续再把各技能的触发式效果逐条搬进 Sim。 */
  function petBattleBonus(petList) {
    ensurePetTables();
    const out = { power: 0, agility: 0, speed: 0, hp: 0 };
    for (const p of (Array.isArray(petList) ? petList : [])) {
      if (!p) continue;
      const grade = Math.max(1, Number(p.grade) || 1);
      const lv = Math.max(1, Number(p.level) || 1);
      const sid = Number(p.skillId) || 0;
      if ([1, 2, 3, 9].includes(sid)) out.power += Math.ceil(grade * 1.5 + lv / 5);
      /* 【2026-10-29 用户口径】回光术（4）/ 凌波微步（5）/ 油光满面（10）的效果
       * 都在**触发时**结算（装死回血 / 闪避回血 / 行动净化），**不再预先加生命上限**：
       * 以前这里按 grade×8 + level×4 加 maxHp，玩家看到的就是「开战直接加血上限」，
       * 而且带几只就叠几份。现在这三类只保留通用的那点速度，血量完全由战斗中的触发决定。 */
      else if ([4, 5, 10].includes(sid)) { /* 触发型技能：不预加面板 */ }
      else out.agility += Math.ceil(grade * 1.2 + lv / 6);
      out.speed += Math.ceil(grade / 2);
    }
    return out;
  }
  /** 把幻兽加成落到一场战斗的参战者上（玩家与 AI 共用）。 */
  function applyPetBonuses(target, petList) {
    if (!target || target.__petBonusesApplied) return target;
    const bonus = petBattleBonus(petList);
    target.__petBonusesApplied = true;
    target.petBonus = bonus;
    for (const key of ['power', 'agility', 'speed']) target[key] = Math.max(1, Math.round((Number(target[key]) || 1) + bonus[key]));
    if (bonus.hp) {
      /* ⚠ 目标可能**没有 maxHp**（随机 AI 的 `genAI` 以前只给 `hp`）。不能再用
       * `(Number(target.maxHp) || 1) + bonus.hp` —— 那会把敌人的上限误设成
       * 「1 + 幻兽加血」（几十点），Sim 再把它的当前血量夹到几十点；经典血条则是
       * 从完整血量一帧掉到 0。没有上限时把 `hp` 当作满血，再加幻兽的血量加成。 */
      const current = Math.max(1, Math.round(Number(target.hp) || 1));
      const max = Math.max(current, Math.round(Number(target.maxHp) || 0));
      target.maxHp = Math.max(1, max + bonus.hp);
      target.hp = Math.max(1, current + bonus.hp);
    }
    return target;
  }
  /** 随机敌人的幻兽：1~3 只，等级随敌人等级成长；只给 Main 的随机对手用，
   * 不改变 genAI 的纯数值基线（平衡套件仍可单独测）。 */
  function randomPetLoadout(level, count) {
    ensurePetTables();
    if (!PETS.length) return [];
    const lv = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Number(level) || 1));
    /* 【幻兽解锁等级】低等级随机敌人不能带幻兽；原版 25 级后才开放幻兽牧场。
     * 经典/现代随机挑战、竞技场、天梯、推荐好友都从这条出口取幻兽，因此一并遵守。 */
    if (lv < PET_UNLOCK_LEVEL) return [];
    let n = Math.max(1, Math.min(3, Math.round(1 + lv / 28 + Math.random() * 0.8)));
    if (Number.isFinite(Number(count))) n = Math.max(0, Math.min(3, Number(count)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      const grade = roll < 0.55 ? 1 : roll < 0.82 ? 2 : roll < 0.95 ? 3 : 4;
      const def = randomPetDef(grade);
      const petLevel = Math.max(1, Math.min(def.maxLevel, Math.round(1 + lv / 8 + Math.random() * 3)));
      out.push({
        key: 'foePet' + i + '_' + Math.floor(Math.random() * 1e6).toString(36),
        id: def.id, name: def.name, grade: def.grade, maxLevel: def.maxLevel,
        leadership: def.leadership, skillId: def.skillId,
        level: petLevel, exp: 0, nextExp: petNextExp(petLevel),
      });
    }
    return out;
  }

  function validLocalDate(date) { return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date); }
  function localDateTime(date, hour, minute) { const [y,m,d] = date.split('-').map(Number); return new Date(y,m-1,d,hour,minute).getTime(); }
  /** 「昨天」跟着 localDate 走（12 小时一天的调试模式下也要跟着位移），
   *  徒弟日供结算的是「我昨天赚到的」，所以这里必须和日期键同一套口径。 */
  function yesterdayDate() {
    const [y, m, d] = localDate().split('-').map(Number);
    const date = new Date(y, m - 1, d); date.setDate(date.getDate() - 1);
    return dateKey(date);
  }
  const TRIBUTE_EXP_MIN = 0.05, TRIBUTE_EXP_MAX = 0.15;
  const TRIBUTE_GOLD_MIN = 0.05, TRIBUTE_GOLD_MAX = 0.25;
  const TRIBUTE_LEVEL_SUM_FULL = 270;
  function apprenticeLevelSum(list) {
    return (Array.isArray(list) ? list : []).reduce((sum, p) => sum + Math.max(1, integer(p && p.level, 1)), 0);
  }
  function tributeLerp(sum, min, max) {
    const lo = Number(min) || 0, hi = Number(max) || 0;
    const span = (hi - lo) / TRIBUTE_LEVEL_SUM_FULL;
    const raw = lo + Math.max(0, integer(sum, 0)) * span;
    return Math.min(hi, Math.max(lo, raw));
  }
  function apprenticeTributeExpRatio(sum) { return tributeLerp(sum, TRIBUTE_EXP_MIN, TRIBUTE_EXP_MAX); }
  function apprenticeTributeGoldRatio(sum) { return tributeLerp(sum, TRIBUTE_GOLD_MIN, TRIBUTE_GOLD_MAX); }
  /* 兼容旧调用：以前只有一个「总系数」，返回经验那一档（两者下限相同、口径最接近）。 */
  function apprenticeTributeRatio(sum) { return apprenticeTributeExpRatio(sum); }
  function apprenticeTributeTable(list) {
    const rows = Array.isArray(list) ? list : [];
    const date = yesterdayDate();
    const mine = earnOn(date);
    const sum = apprenticeLevelSum(rows);
    const expRatio = apprenticeTributeExpRatio(sum);
    const goldRatio = apprenticeTributeGoldRatio(sum);
    const ratio = expRatio;                                   // 兼容字段：旧界面读它显示「系数」
    const totalExp = Math.floor(mine.exp * expRatio), totalGold = Math.floor(mine.gold * goldRatio);
    const weightSum = sum || 1;                              // 全部徒弟等级之和（为 0 时兜底 1）
    const shares = [];
    let acc = 0, prevExp = 0, prevGold = 0;
    rows.forEach((p, i) => {
      acc += Math.max(1, integer(p && p.level, 1)) / weightSum;
      const last = i === rows.length - 1;
      const cumExp = last ? totalExp : Math.round(totalExp * acc);
      const cumGold = last ? totalGold : Math.round(totalGold * acc);
      shares.push({ exp: Math.max(0, cumExp - prevExp), gold: Math.max(0, cumGold - prevGold) });
      prevExp = cumExp; prevGold = cumGold;
    });
    return { date, mine, ratio, expRatio, goldRatio, totalExp, totalGold, shares };
  }
  function apprenticeDailyStatus(apprentice) {
    const p = object(apprentice) ? apprentice : null, today = localDate();
    const table = apprenticeTributeTable(S.prentices || []);
    const blank = { date: table.date, exp: 0, gold: 0, ratio: table.ratio,
      expRatio: table.expRatio, goldRatio: table.goldRatio, weight: 0, mine: table.mine,
      claimable: false, claimed: false, newApprentice: false };
    if (!p) return blank;
    if (!validLocalDate(p.since)) { p.since = today; p.joinedAt = Date.now(); save(); }
    const claimed = p.lastExpDate === today || p.tributeClaimedDate === table.date;
    // 今天才进门的徒弟没有「昨天」，等次日结算
    if (p.since > table.date) return Object.assign({}, blank, { claimed, newApprentice: true });
    const sum = apprenticeLevelSum(S.prentices || []) || 1;
    const weight = Math.max(1, integer(p.level, 1)) / sum;
    const idx = (S.prentices || []).indexOf(p);
    const share = idx >= 0 ? table.shares[idx] : { exp: 0, gold: 0 };
    return { date: table.date, exp: share.exp, gold: share.gold, ratio: table.ratio,
      expRatio: table.expRatio, goldRatio: table.goldRatio, weight, mine: table.mine,
      claimable: !claimed && (share.exp > 0 || share.gold > 0), claimed, newApprentice: false };
  }
  function apprenticeDailyExp(apprentice) { return apprenticeDailyStatus(apprentice).exp; }
  function apprenticeDailyGold(apprentice) { return apprenticeDailyStatus(apprentice).gold; }
  function apprenticeDailyTotal() {
    const out = { exp: 0, gold: 0 };
    for (const p of S.prentices || []) {
      const daily = apprenticeDailyStatus(p);
      if (!daily.claimable) continue;
      out.exp += daily.exp; out.gold += daily.gold;
    }
    return out;
  }
  function claimApprenticeExp() {
    const today = localDate();
    let totalExp = 0, totalGold = 0, count = 0;
    for (const p of S.prentices || []) {
      const daily = apprenticeDailyStatus(p);
      if (!daily.claimable) continue;
      p.lastExpDate = today; p.tributeClaimedDate = daily.date;
      totalExp += daily.exp; totalGold += daily.gold; count++;
    }
    if (!count) return { ok: false, msg: '暂无可领取的昨日日供，新收徒需等待次日结算。' };
    const ups = totalExp > 0 ? gainExp(totalExp, { noTrack: true }) : [];
    if (totalGold > 0) addGold(totalGold, { count: false });
    save();
    const parts = [];
    if (totalExp > 0) parts.push('经验 +' + totalExp);
    if (totalGold > 0) parts.push('金松果 +' + totalGold);
    return { ok: true, total: totalExp, gold: totalGold, count, ups,
      msg: count + ' 个徒弟昨日日供：' + (parts.join('　') || '无') };
  }
  let recruitSequence=0;
  function beginRecruitChallenge(candidate) {
    if (!object(candidate)||!candidate.name) return {ok:false,msg:'请选择收徒对象'};
    if (S.recruitChallenge) return {ok:false,msg:'收徒挑战尚未结束'};
    if (S.prentices.length>=apprenticeCap(S.level)) return {ok:false,msg:'收徒名额已满'};
    if (S.prentices.some(p=>p.name===String(candidate.name).slice(0,20))) return {ok:false,msg:'已经收过这个徒弟了'};
    if (S.goldPoint<10) return {ok:false,msg:'收徒挑战需要10金松果'};
    if (Number(S.energy) < 10) return {ok:false,msg:'体力不足10点，无法进行收徒挑战'};
    const token='recruit_'+Date.now()+'_'+(++recruitSequence);
    S.goldPoint-=10;
    /* 原版 `getStudent` 先 `hasEnoughEnergy()` 再打 `fightType=2`；服务端那场战斗
     * 按普通挑战扣 10 体力。离线版在开始挑战时一并扣，取消时和 10 金松果一起退回。 */
    S.energy=Math.max(0,Number(S.energy)-10);
    S.recruitChallenge={token,fee:10,energyFee:10,candidate:clone(candidate)};save();
    return {ok:true,token,foe:clone(object(candidate.master)&&candidate.master.name?candidate.master:candidate)};
  }
  function cancelRecruitChallenge(token) {
    if (!S.recruitChallenge||S.recruitChallenge.token!==token)return false;
    S.goldPoint+=S.recruitChallenge.fee;
    S.energy=Math.min(Number(S.maxEnergy)||ENERGY_HARD_CAP,Number(S.energy||0)+(Number(S.recruitChallenge.energyFee)||0));
    S.recruitChallenge=null;save();return true;
  }
  function finishRecruitChallenge(token,win) {
    const run=S.recruitChallenge;if(!run||run.token!==token)return {ok:false};
    S.recruitChallenge=null;
    const added=win?addPrentice(run.candidate):null;
    tickPropStates();const exp=win?20:0,ups=gainExp(exp);save();
    return {ok:true,win,exp,gold:0,ups,recruited:added&&added.ok?added.apprentice:null,
      msg:win?(added.ok?'收【'+run.candidate.name+'】为徒！':added.msg):'收徒挑战失败，提升实力后再来。'};
  }
  function canKickToday() {
    return (S.masterKickDate || '') !== localDate();
  }
  function kickPrentice(name) {
    if (!canKickToday()) return { ok: false, msg: '今天已经踢过一个徒弟了，明天再来' };
    const i = S.prentices.findIndex((p) => p.name === name);
    if (i < 0) return { ok: false, msg: '没有这个徒弟' };
    S.prentices.splice(i, 1);
    S.masterKickDate = localDate();
    save();
    return { ok: true, msg: '已让【' + name + '】离开师门' };
  }

  // ---------- 存档 ----------
  /** 把 S.props 里超过上限的数量收口（save 前统一调用）。 */
  function clampProps() {
    if (!S || !object(S.props)) return;
    for (const id of Object.keys(S.props)) {
      const count = Number(S.props[id]);
      if (!Number.isFinite(count)) { delete S.props[id]; continue; }
      if (count > PROP_HARD_CAP) S.props[id] = PROP_HARD_CAP;
      else if (count < 0) delete S.props[id];
    }
  }
  function save() {
    try {
      if (!S) return false;
      clampProps();
      clampPermanentStats();
      S.savedAt = Date.now();
      saveRevision++;
      if (storageMode() === 'file' || saveTransport) {
        fileState.dirty = true;
        writeMirror();
        scheduleFileWrite();
        return true;
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify(savePayload()));
      return true;
    } catch (e) { return false; }
  }
  /** 读浏览器里的存档（现在只在「没有本地服务器」或自检档时使用）。 */
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!object(parsed)) return false;
        if (!adoptPayload(parsed)) return false;
        syncDailyStats();
        if (battlePayloadNeedsTrim(parsed)) save();
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* 主存档 = 游戏目录 save/progress.json（本地服务器 /__save 读写）；没有服务器时退回
   * 文件更新时只标冲突、由玩家在系统页手动载入，绝不覆盖。 */
  const SAVE_URL = '__save';
  const LEGACY_KEY = SAVE_KEY;                       // 旧的 localStorage 存档键
  const fileState = { available: false, transportReady: false, checked: false, code: 0, fileAt: 0, fileExists: false, fileLevel: 0, fileReborn: 0, fileBackup: false, lastProbe: 0, error: '', reason: '', lastWrite: 0, lastLoad: 0, lastRead: 0, lastReadErr: '', conflict: false, dirty: false, freshLocal: false, forceWrite: false, path: 'save/progress.json' };
  let fileTimer = 0;
  let saveRevision = 0;
  let fileLoadGeneration = 0;
  let fileWriteTail = Promise.resolve();
  function queueFileWrite(write) {
    const task = fileWriteTail.then(write, write);
    fileWriteTail = task.catch(() => {});
    return task;
  }
  /** 一份存档里的最高等级（双槽取两槽最大；服务端水位线用同一套口径）。 */
  function payloadMaxLevel(obj) {
    if (!object(obj)) return 0;
    let lv = Math.max(0, integer(obj.level, 0, 0));
    if (object(obj.__dualOther)) lv = Math.max(lv, Math.max(0, integer(obj.__dualOther.level, 0, 0)));
    if (object(obj.__dualSaves)) {
      for (const slot of Object.values(obj.__dualSaves)) {
        if (object(slot)) lv = Math.max(lv, Math.max(0, integer(slot.level, 0, 0)));
      }
    }
    return lv;
  }
  /** 转生次数：等级合法降回 1 的唯一凭证（转生果 `reborn++`）。 */
  function payloadReborn(obj) {
    if (!object(obj)) return 0;
    return Math.max(0, integer(obj.reborn, 0, 0));
  }
  /** 这是不是「刚建的新档」——只有 1 级、没打过一场、没通关过、也不是转生。
   *  用它挡住「浏览器里的 1 级空档覆盖磁盘上几十级的正式存档」。
   *  ⚠ 不能只看等级：转生果会把等级降回 1（`reborn > 0`），那是合法存档；
   *  打过任意一场（`allWins > 0`）或通关过（`stages` 非空）的 1 级档也不是空档。 */
  function isFreshPayload(obj) {
    if (!object(obj)) return false;
    if (payloadMaxLevel(obj) > 1) return false;
    if (Math.max(0, integer(obj.reborn, 0, 0)) > 0) return false;
    if (Math.max(0, integer(obj.allWins, 0, 0)) > 0) return false;
    if (object(obj.stages) && Object.keys(obj.stages).length) return false;
    return true;
  }
  let transportAnnounced = false;
  /* 存档读写通道：默认走本地服务器的 /__save；宿主（Tauri 等）可以替换成自己的实现。
   * transport = { label, path?, probe(), read(), write(json) }，全部返回 Promise。 */
  let saveTransport = null;

  const fmtTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };
  /** 当前进度存在哪里：'file'（save/progress.json）或 'local'（浏览器兜底）。 */
  function storageMode() { return !testMode && fileState.available ? 'file' : 'local'; }
  function forgetLegacy() {
    try { localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(LEGACY_KEY + '_sync'); localStorage.removeItem(LEGACY_KEY + '_base'); localStorage.removeItem(LEGACY_KEY + '_pending'); } catch (e) {}
  }
  /** 浏览器兜底档是不是「更新且等级不低于文件里这份」——换机器/双机同步后本机没跟上时，
   * 它就是玩家真正的最新进度，不能当成残留垃圾悄悄删掉（交给 fileWrite 的冲突保护处理）。 */
  function localSaveWorthKeeping(fileAt) {
    const local = localSaveMeta();
    if (!local) return false;
    if (local.pending && local.base === Number(fileAt)) return true;
    const fileLevel = (S && S.level) || 1;
    return local.savedAt > (Number(fileAt) || 0) + 1000 && local.level >= fileLevel;
  }
  /** 收口：只有在「那份浏览器兜底档已经冗余」时才删它。
   *  读档、写档、后台补写所有路径都走这里，避免某一条路径把玩家更新的兜底档悄悄删掉。 */
  function forgetLegacyIfRedundant(fileAt) {
    if (localSaveWorthKeeping(fileAt)) return false;
    forgetLegacy();
    return true;
  }
  /* 同步镜像：文件存档之外再在 localStorage 存一份进度（安卓上最后一次写盘是异步链，
   * 进程回收时可能只跑一半）。带 base=写入时文件 mtime，启动时只有 mtime 未变才敢恢复（见 main.js boot）；
   * 文件写成功后 forgetLegacyIfRedundant() 删除它。不覆盖更强的旧兜底档，避免静默删档。 */
  function writeMirror() {
    try {
      if (typeof localStorage === 'undefined' || !S) return false;
      /* 只有「旧兜底档**等级更高**」时才让路：那种档是另一台机器/同步服务留下的，
       * 要留给玩家手动导入。同级（正常连点几下）照写，否则文件一直写失败时镜像会停旧。 */
      const old = localSaveMeta();
      const fileAt = Number(fileState.fileAt) || 0;
      const payload = savePayload();
      if (old && old.savedAt > fileAt + 1000 && old.level > payloadMaxLevel(payload)) return false;
      // 只探到 mtime、尚未读过文件时，不能把兜底档冒认为基于该文件的新进度。
      const base = !fileState.lastRead && fileState.fileExists ? (old && old.base != null ? old.base : '') : fileAt;
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      localStorage.setItem(SAVE_KEY + '_base', String(base));
      localStorage.setItem(SAVE_KEY + '_pending', '1');
      return true;
    } catch (e) { return false; }
  }
  /** 宿主替换存档通道（Tauri 里用 Rust 端命令读写文件）。 */
  function setSaveTransport(t) {
    saveTransport = t && typeof t.probe === 'function' ? t : null;
    if (saveTransport && saveTransport.path) fileState.path = saveTransport.path;
    fileState.checked = false;
    fileState.available = false;
    /* 移动端 `window.__TAURI__` 是异步注入的：启动早期 `fileLoad()` 可能已经因为
     *   · 已经有存档文件 → 不抢写，让 Main 的 retryFileSave 读文件并重载；
     *   · 还没有文件 → 把内存里的当前进度写出第一份，避免“第一次玩完退出就没了”。
     * 这里不能直接 fileLoad：玩家可能已经在本地档上操作，读文件顶掉会丢进度。 */
    if (saveTransport) {
      if (!transportAnnounced) {
        transportAnnounced = true;
        try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ssdz-save-transport-ready')); } catch (e) {}
      }
      setTimeout(() => {
        if (!saveTransport) return;
        void fileProbe().then((ok) => {
          if (!ok || !S || fileState.fileAt > 0) return;
          scheduleFileWrite();
        }).catch(() => {});
      }, 0);
    }
  }
  const isFileProtocol = () => typeof location !== 'undefined' && location.protocol === 'file:';
  /** 浏览器 localStorage 里有没有兜底存档（boot 判断「能不能回落」时用，不改动内存状态）。 */
  function hasLocalSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }
  /** 浏览器兜底档的等级与时间戳（判断「文件里的是不是那份该用的档」时用）。
   *  `base` = 写这份镜像时文件当时的 mtime（见 save()）；启动恢复用它判断镜像是否可用。 */
  function localSaveMeta() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!object(parsed)) return null;
      const baseRaw = localStorage.getItem(SAVE_KEY + '_base');
      const base = baseRaw == null || baseRaw === '' ? null : Number(baseRaw);
      return {
        level: Math.max(1, payloadMaxLevel(parsed)),
        savedAt: Number(parsed.savedAt) || 0,
        base: Number.isFinite(base) ? base : null,
        pending: localStorage.getItem(SAVE_KEY + '_pending') === '1',
      };
    } catch (e) { return null; }
  }
  /** 探一次存档通道在不在，并把「为什么不可用」记下来给界面显示。
   *  注意：只探「通道在不在」——读文件本身成功还是失败由 fileState.lastRead / lastReadErr 单独记，
   *  否则界面会把「连不上服务器」和「服务器没有存档接口」混成一句含糊的话。 */
  async function fileProbe() {
    if (testMode) { fileState.checked = true; fileState.available = false; fileState.code = 0; fileState.reason = '自检档不写正式存档'; return false; }
    fileState.code = 0;
    if (saveTransport) {
      try {
        const meta = await saveTransport.probe();
        fileState.available = !!meta.ok;
        // 区分「通道坏了」和「通道好用、只是还没有存档文件」——
        fileState.transportReady = !!meta.ok;
        fileState.fileAt = Number(meta.savedAt) || 0;
        fileState.fileExists = meta.exists === true || fileState.fileAt > 0;
        fileState.fileLevel = Math.max(0, integer(meta.maxLevel != null ? meta.maxLevel : meta.level, 0, 0));
        fileState.fileReborn = Math.max(0, integer(meta.reborn, 0, 0));
        fileState.fileBackup = !!meta.backup;
        fileState.reason = fileState.available ? '' : (meta.msg || '存档通道不可用');
        fileState.error = '';
      } catch (e) {
        fileState.available = false;
        fileState.transportReady = false;
        fileState.reason = '存档通道出错：' + String((e && e.message) || e);
        fileState.error = fileState.reason;
      }
      fileState.checked = true;
      return fileState.available;
    }
    if (typeof fetch !== 'function') { fileState.checked = true; fileState.available = false; fileState.reason = '这个环境没有 fetch，无法读写存档文件'; return false; }
    if (isFileProtocol()) {
      fileState.checked = true; fileState.available = false;
      fileState.reason = '页面是 file:// 打开的，浏览器不允许写文件。请用启动器打开游戏（Windows：squirrel_fight.exe 或 scripts/启动游戏.cmd；macOS：scripts/启动游戏.command；也可以 node scripts/serve.js）。';
      return false;
    }
    try {
      const res = await fetch(SAVE_URL + '?meta=1', { cache: 'no-store' });
      if (!res.ok) {
        fileState.code = res.status;
        fileState.reason = res.status === 404
          ? '服务器没有 /__save 接口（HTTP 404）：可能是 python3 -m http.server、旧版 serve.js，或页面来自别的静态托管。'
          : '服务器返回 HTTP ' + res.status;
        throw new Error(fileState.reason);
      }
      const info = await res.json();
      fileState.available = !!info.ok;
      fileState.fileAt = Number(info.savedAt) || 0;
      fileState.fileExists = info.exists === true || fileState.fileAt > 0;
      fileState.fileLevel = Math.max(0, integer(info.maxLevel != null ? info.maxLevel : info.level, 0, 0));
      fileState.fileReborn = Math.max(0, integer(info.reborn, 0, 0));
      fileState.fileBackup = !!info.backup;
      fileState.reason = fileState.available ? '' : (info.msg || '服务器关闭了存档写入（--no-save？）');
      fileState.error = '';
      if (info.path) fileState.path = info.path;
    } catch (e) {
      fileState.available = false;
      if (!fileState.reason) fileState.reason = '连不上本地服务器：' + String((e && e.message) || e);
      fileState.error = fileState.reason;
    }
    fileState.checked = true;
    return fileState.available;
  }
  /**
   * 读主存档：文件优先，没有文件就把 localStorage 里的老档迁进去。
   * 返回 true 表示内存里已经有可玩的进度。
   */
  async function fileLoad(request) {
    const generation = ++fileLoadGeneration;
    const current = () => generation === fileLoadGeneration && !(request && request.cancelled);
    if (!fileState.available) await fileProbe();
    if (!current() || !fileState.available) return false;
    fileState.lastRead = 0;
    fileState.lastReadErr = '';
    try {
      const info = saveTransport ? await saveTransport.read() : await (await fetch(SAVE_URL, { cache: 'no-store' })).json();
      // 超时退回本地档后，迟到的旧读不能再改内存、镜像或读档确认状态。
      if (!current()) return false;
      fileState.fileAt = Number(info.savedAt) || 0;
      fileState.fileLevel = Math.max(fileState.fileLevel, Math.max(0, integer(info.maxLevel, 0, 0)));
      fileState.fileReborn = Math.max(fileState.fileReborn, Math.max(0, integer(info.reborn, 0, 0)));
      fileState.fileBackup = !!info.backup || !!info.recoveredFrom;
      if (info.exists && info.data) {
        let parsed = typeof info.data === 'string' ? JSON.parse(info.data) : info.data;
        if (!object(parsed)) throw new Error('存档内容不是对象');
        /* 先选上次未确认的同源镜像，再结算宝箱/每日刷新；这些初始化会 save，
         * 若先载入旧文件，它们会把真正待恢复的同级进度覆盖掉。 */
        const local = localSaveMeta();
        if (local && local.base === fileState.fileAt && local.level >= payloadMaxLevel(parsed)
          && (local.pending || local.savedAt > fileState.fileAt + 1500)) {
          const mirror = JSON.parse(localStorage.getItem(SAVE_KEY));
          if (object(mirror)) parsed = mirror;
        }
        fileState.fileLevel = Math.max(fileState.fileLevel, payloadMaxLevel(parsed));
        fileState.fileReborn = Math.max(fileState.fileReborn, payloadReborn(parsed));
        const loaded = adoptPayload(parsed);
        fileState.lastLoad = Date.now();
        fileState.lastRead = fileState.fileAt || Date.now();
        if (!loaded) {
          /* 文件是另一界面的槽位，当前界面还没有独立存档：不把别的界面进度顶进来，
           * 让调用方去标题页/新开局；另一槽已经在 otherSlot 里，下一次保存会一起写回。 */
          fileState.lastReadErr = '当前界面还没有独立存档';
          fileState.conflict = false;
          return false;
        }
        syncDailyStats();
        /* savedAt 用服务器报的**文件时间**：它和 fileWrite() 里比较的 fileAt 是同一个时钟。
         * 以前这里用存档内部的 savedAt（游戏里的 Date.now()），一旦文件是由同步/手工恢复过来的
         * 「存档文件更新，已跳过写入」永久挡住 —— 表现在玩家身上就是「打了半天进度没保存」。 */
        S.savedAt = fileState.fileAt || Number(parsed.savedAt) || Date.now();
        // 文件是主存档，旧的浏览器兜底档就此退休；
        forgetLegacyIfRedundant(fileState.fileAt);
        fileState.conflict = false;
        if (battlePayloadNeedsTrim(parsed)) save();
        return true;
      }
      if (load()) {
        await fileWrite(true);   // 镜像仅由写入端按实际确认的版本清理。
        return current();
      }
      return false;
    } catch (e) {
      if (!current()) return false;
      fileState.lastReadErr = String((e && e.message) || e);
      fileState.error = fileState.lastReadErr;
      return false;
    }
  }
  /** 读存档文件的元信息（savedAt / exists）。**1.2 秒内复用上一次结果**：
   *  仍然强制重新探测，跨机器冲突保护不受影响。 */
  async function probeMeta(force) {
    const now = Date.now();
    if (!force && fileState.lastProbe && now - fileState.lastProbe < 1200) {
      return { savedAt: fileState.fileAt, exists: fileState.fileExists, maxLevel: fileState.fileLevel, reborn: fileState.fileReborn, backup: fileState.fileBackup };
    }
    const meta = saveTransport ? await saveTransport.probe()
      : await (await fetch(SAVE_URL + '?meta=1', { cache: 'no-store' })).json();
    fileState.lastProbe = now;
    fileState.fileAt = Number(meta.savedAt) || fileState.fileAt;
    fileState.fileExists = meta.exists === true || fileState.fileAt > 0;
    fileState.fileLevel = Math.max(fileState.fileLevel, Math.max(0, integer(meta.maxLevel != null ? meta.maxLevel : meta.level, 0, 0)));
    fileState.fileReborn = Math.max(fileState.fileReborn, Math.max(0, integer(meta.reborn, 0, 0)));
    fileState.fileBackup = !!meta.backup;
    return meta;
  }
  /** 把当前进度写进 save/progress.json（force=true 时不检查「文件是否更新」）。
   *  **防「1 级空档覆盖正式存档」**：iOS 换包/桥接迟到时，启动可能先走浏览器兜底档，
   *  随后一次自动保存就会把磁盘上几十级的存档写成 1 级。以前只有 HTTP 服务端有拦截，
   *  iOS 的 `save_write` 没有 —— 这就是「存档在初始档与有进度的档之间横跳」的来源之一。
   *  `fileState.forceWrite`（只有调试面板「彻底重置账号」会设）是唯一允许主动降级的路径。 */
  function fileWrite(force, options) {
    const allowFreshOverwrite = fileState.forceWrite === true;
    fileState.forceWrite = false;
    return queueFileWrite(() => writeCurrentFile(force, allowFreshOverwrite, options || {}));
  }
  async function writeCurrentFile(force, allowFreshOverwrite, options) {
    if (testMode) return { ok: false, msg: '自检档不写正式存档' };
    if (options.background && !fileState.dirty) return { ok: true, msg: '存档没有变化' };
    fileState.dirty = true;
    if (!fileState.available) await fileProbe();
    if (!fileState.available) return { ok: false, msg: '存档写入不可用：' + (fileState.reason || '未知原因') };
    try {
      const meta = await probeMeta(!!force || allowFreshOverwrite);
      const fileAt = Number(meta.savedAt) || 0;
      const localAt = (S && S.savedAt) || 0;
      const writtenRevision = saveRevision;
      const payload = savePayload();
      const body = JSON.stringify(payload);
      const incomingMax = payloadMaxLevel(payload);
      const fileLevel = Math.max(fileState.fileLevel, Math.max(0, integer(meta.maxLevel != null ? meta.maxLevel : meta.level, 0, 0)));
      /* **本次启动还没读过文件**（iOS 原生桥晚到最常见）：磁盘上又已经是正式进度时，
       * 先别写。否则页面按兜底档/旧状态跑出来的存档会盖掉还没读进来的正式档。 */
      if (!allowFreshOverwrite && !fileState.lastRead && fileState.fileExists && fileLevel >= 5) {
        fileState.conflict = true;
        return { ok: false, conflict: true, msg: '本次启动还没有成功读取磁盘存档，已暂缓写入（避免覆盖正式进度）' };
      }
      // 存档文件里已有别的进度（新浏览器 / 换了机器第一次打开）：不覆盖，先让玩家决定
      if (!allowFreshOverwrite && meta.exists && fileState.freshLocal && fileAt > 0) {
        fileState.conflict = true; fileState.fileAt = fileAt;
        return { ok: false, conflict: true, msg: '存档文件里已有进度（' + fmtTime(fileAt) + '），没有覆盖' };
      }
      /* 新档比磁盘档低 = 多半是旧兜底档/初始档回来了，拒绝覆盖。
       * 唯一合法的降级是转生果（reborn 增加）；1 级档玩到 2 级再写回去同样会被这里拦住。
       * 真正的重置/导入走 `forceWrite`（只由调试面板或导入流程设置）。 */
      const incomingReborn = payloadReborn(payload);
      if (!allowFreshOverwrite && incomingMax < fileLevel && incomingReborn <= fileState.fileReborn) {
        fileState.conflict = true;
        const what = isFreshPayload(payload) ? '全新的 1 级空档' : (incomingMax + ' 级旧档');
        return { ok: false, conflict: true, msg: '存档文件里已有 ' + fileLevel + ' 级进度，已拒绝用' + what + '覆盖' };
      }
      if (!force && !allowFreshOverwrite && fileAt > localAt + 1000) {
        fileState.conflict = true; fileState.fileAt = fileAt;
        return { ok: false, conflict: true, msg: '存档文件更新（' + fmtTime(fileAt) + '），已跳过写入' };
      }
      const out = saveTransport ? await saveTransport.write(body, { force: allowFreshOverwrite })
        : await (await fetch(SAVE_URL + (allowFreshOverwrite ? '?force=1' : ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: !!options.keepalive })).json();
      if (!out || out.ok !== true) throw new Error((out && out.msg) || '写入失败');
      fileState.fileAt = Number(out.savedAt) || Date.now();
      fileState.fileExists = true;
      fileState.lastProbe = Date.now();
      fileState.lastWrite = Date.now();
      if (!fileState.lastRead) fileState.lastRead = fileState.fileAt;
      fileState.conflict = false;
      fileState.dirty = saveRevision !== writtenRevision;
      fileState.error = '';
      fileState.freshLocal = false;
      /* 写成功 = 磁盘上现在就是这份档，等级/转生次数都以它为准确值。
       * 不能保留旧的 40 级水位：转生后合法回到 1 级，下一笔 2 级存档会
       * 因为「2 < 40 且 reborn 没变」被自己的水位线误拦。 */
      fileState.fileLevel = incomingMax;
      fileState.fileReborn = incomingReborn;
      // 旧回包只能确认它发出的版本；后续改动仍待写，并以刚确认的磁盘时间重建镜像。
      if (fileState.dirty) writeMirror();
      else {
        let confirmedMirror = false;
        try { confirmedMirror = localStorage.getItem(SAVE_KEY) === body; } catch (e) {}
        if (confirmedMirror) forgetLegacy();
        else forgetLegacyIfRedundant(fileState.fileAt);
      }
      return { ok: true, msg: '已写入 ' + fileState.path, fileAt: fileState.fileAt };
    } catch (e) {
      fileState.error = String((e && e.message) || e);
      return { ok: false, msg: '写入存档失败：' + fileState.error };
    }
  }
  /** 界面上「立即写入」按钮用：立刻写，不受防抖影响。 */
  function fileWriteNow() { return fileWrite(true); }
  /** 存档文件的信息（系统页显示用）。 */
  /** 安卓/桌面安装版的 Tauri 存档通道是否存在。导入存档必须走它，
   *  不能 fetch('/__save') —— tauri.localhost 没有那个 HTTP 接口。 */
  function hasFileTransport() { return !!saveTransport; }
  /** 读当前磁盘存档原文（给“导入前备份”用）；没有通道返回 null。 */
  async function readFileRaw() {
    if (!saveTransport) return null;
    try { const info = await saveTransport.read(); return info && info.data ? String(info.data) : null; }
    catch (e) { return null; }
  }
  /** 用导入的 JSON 原文覆盖正式存档（安装版/安卓走原生通道，带备份由调用方做）。 */
  function importFileRaw(raw) {
    return queueFileWrite(() => writeImportedFile(raw));
  }
  async function writeImportedFile(raw) {
    if (!saveTransport) return { ok: false, msg: '没有可用的存档通道' };
    try {
      let body = String(raw);
      const parsed = JSON.parse(body.replace(/^\uFEFF/, ''));
      if (battlePayloadNeedsTrim(parsed)) {
        for (const slot of [parsed, parsed.__dualOther,
          ...SAVE_SLOTS.map((mode) => object(parsed.__dualSaves) && parsed.__dualSaves[mode])]) {
          if (object(slot)) trimBattleHistory(slot);
        }
        body = JSON.stringify(parsed);
      }
      const out = await saveTransport.write(body, { force: true });
      /* 必须**明确**拿到 ok:true。iOS 的旧问题就是命令返回了空对象/非预期结果，
       * `out.ok === false` 放过了它，随后读回旧档还报「导入成功」。 */
      if (!out || out.ok !== true) return { ok: false, msg: (out && out.msg) || '原生存档通道没有确认写入成功' };
      // force 导入允许合法降级；后续普通保存不能继续拿导入前的高等级水位拦新档。
      fileState.fileAt = Number(out.savedAt) || fileState.fileAt;
      fileState.fileExists = true;
      fileState.fileLevel = payloadMaxLevel(parsed);
      fileState.fileReborn = payloadReborn(parsed);
      fileState.freshLocal = false;
      fileState.lastProbe = Date.now();
      fileState.lastWrite = Date.now();
      fileState.conflict = false;
      fileState.error = '';
      // 显式导入已成为主档，即使 mtime 恰与旧 base 同毫秒，也不能再恢复旧镜像。
      forgetLegacy();
      return { ok: true, savedAt: Number(out.savedAt) || 0 };
    } catch (e) {
      return { ok: false, msg: (e && e.message) || String(e) };
    }
  }
  function fileInfo() {
    return {
      mode: storageMode(), available: fileState.available, checked: fileState.checked,
      transportReady: fileState.transportReady,
      conflict: fileState.conflict, fileAt: fileState.fileAt, localAt: (S && S.savedAt) || 0,
      fileLevel: fileState.fileLevel, fileReborn: fileState.fileReborn, fileBackup: fileState.fileBackup, fileExists: fileState.fileExists,
      code: fileState.code,
      lastWrite: fileState.lastWrite, lastLoad: fileState.lastLoad,
      lastRead: fileState.lastRead, lastReadErr: fileState.lastReadErr,
      error: fileState.error,
      dirty: fileState.dirty, path: fileState.path, reason: fileState.reason,
    };
  }
  function fileLoadedThisBoot() { return fileState.lastRead > 0; }
  /** 保存后延迟写文件（连点几下只写一次）；页面要关掉时立刻补写。 */
  function scheduleFileWrite() {
    if (!S || (storageMode() !== 'file' && !saveTransport) || typeof setTimeout !== 'function') return;
    fileState.dirty = true;
    if (fileTimer) clearTimeout(fileTimer);
    fileTimer = setTimeout(() => { fileTimer = 0; void fileWrite(false, { background: true }); }, 400);
  }
  function flushFileWrite() {
    rememberUiMode();
    if (fileTimer) { clearTimeout(fileTimer); fileTimer = 0; }
    if (!S) return;
    /* 先把同步镜像写掉：这一步不依赖 WebView 的异步桥（安卓上 onPause 之后的
     * 下一次启动也能从镜像恢复（见 main.js boot 里 base 那一段）。 */
    if (!fileState.dirty) return;
    if (storageMode() === 'file' || saveTransport) writeMirror();
    if (storageMode() !== 'file' && !saveTransport) return;
    // 与防抖/立即保存共用队列、冲突保护和成功确认；隐藏事件重复到达也不并发写盘。
    return fileWrite(false, { background: true, keepalive: true });
  }
  /* 原生壳（Android MainActivity.onPause）通过这个入口在切后台时立刻刷盘。
   * 不能只依赖 pagehide：Tauri Android WebView 在按 Home/被系统回收时不一定派发。 */
  try { if (typeof window !== 'undefined') window.__ssdzFlushSave = flushFileWrite; } catch (e) {}
  if (typeof window !== 'undefined' && window.addEventListener) {
    /* 只留 pagehide 与「页面隐藏」两个出口：beforeunload 与它们重复，
     * 关页/切后台会把同一份存档连发三遍。flushFileWrite 自己还会判 dirty。 */
    window.addEventListener('pagehide', flushFileWrite);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushFileWrite(); });
    }
  }

  /** 普通新建账号无武技；调试重置的 opts.weaponId / weaponLevel 可指定开局武器。 */
  function newGame(name, opts) {
    const mode = validSaveMode(opts && opts.uiMode) ? String(opts.uiMode) : slotMode();
    saveMode = mode;
    writeUiModePref(mode);
    /* 新角色：如果另一界面已经有进度，这一份要和它一起写进文件，不能当成"全新文件"挡住写入。 */
    fileState.freshLocal = !otherSlot;
    /* 只有调试面板「彻底重置账号」这种**玩家二次确认过**的重置才允许主动把正式档降回 1 级；
     * 其它路径（启动回落、切界面、桥接迟到）一律走 fileWrite 的 1 级空档保护。 */
    fileState.forceWrite = !!(opts && opts.force);
    S = clone(GData.NEW_PLAYER);
    Object.assign(S, GData.initialStats());
    S.stageRuns = {};
    S.friends = [];
    /* 昵称上限 7 个汉字（英文/数字按 1/3 计）；标题页会先校验，这里再兜底截断，
     * 防止调试/脚本路径把超长名字写进存档。没有 `NicknameRules` 的测试环境退回旧行为。 */
    const rawName = typeof name === 'string' && name.trim() ? name.trim() : '小松鼠';
    const rules = typeof window !== 'undefined' && window.NicknameRules;
    S.name = rules && typeof rules.truncate === 'function'
      ? (rules.truncate(rawName, rules.MAX_UNITS) || '小松鼠')
      : rawName.slice(0, 20);
    S.newbieStartDate = localDate();   // 新号前三天每日礼包额外福利
    S.debugClockOffset = 0;            // 调试「快进24小时」按槽位独立
    S.lastEnergyTs = Date.now();
    S.dailyStatsDate = localDate();
    S.props = { 1: 3, 2: 2, 28: 1 }; // 送1级礼包
    S.settings = normalizeSettings(null);   // 新角色：音量/分辨率/全面屏的默认值也写进存档
    /* 新号默认经典界面（用户 2026-11 口径）：只有在没选过模式时 slotMode() 才回落到 classic；
     * 从现代槽位新建/重置时保持现代。 */
    S.settings.uiMode = mode;
    try { if (window.UI && UI.applyUiMode) UI.applyUiMode(mode); } catch (e) {}
    const weaponId = opts && Number(opts.weaponId);
    if (Number.isSafeInteger(weaponId) && weaponsMap.getValue(weaponId)) {
      const level = Math.min(15, Math.max(1, integer(opts.weaponLevel, 1, 1)));
      S.weapons = [weaponId + ':' + level];
    }
    save();
  }
  function state() { return S; }
  /* 战斗操作键解锁等级：10 级解锁 2 倍速；跳过要「超级松鼠 10 级」或非 VIP 20 级，
   * 塔的跳过另有层数门槛（无尽塔 10 层，见 Tower.skipPlaybackAllowed）。 */
  const SPEED_UNLOCK_LEVEL = 10;
  const SKIP_UNLOCK_LEVEL = 20;
  const VIP_SKIP_UNLOCK_LEVEL = 10;
  function unlockedSpeed() { return !!S && Number(S.level) >= SPEED_UNLOCK_LEVEL; }
  function unlockedSkip() {
    if (!S) return false;
    const lv = Number(S.level) || 0;
    return lv >= (vipActive() ? VIP_SKIP_UNLOCK_LEVEL : SKIP_UNLOCK_LEVEL);
  }
  /** 战斗里到底显不显示跳过键：等级/VIP 已解锁 **且** 系统页的显示开关没关。 */
  function skipButtonEnabled() {
    if (!S) return false;
    return settings().showSkip !== false && unlockedSkip();
  }

  // 体力：5 分钟回 1 点，初始上限 90，升级提升上限。
  function tickEnergy() {
    syncDailyStats();
    const now = Date.now();
    if (debugOn('infiniteEnergy')) { S.energy = S.maxEnergy; S.lastEnergyTs = now; return; }
    syncVipEnergyCap();
    tickVipDaily();
    const interval = ENERGY_INTERVAL / vipRegenMul();
    if (!Number.isFinite(S.lastEnergyTs) || S.lastEnergyTs <= 0 || S.lastEnergyTs > now) S.lastEnergyTs = now;
    if (S.energy >= S.maxEnergy) { S.lastEnergyTs = now; return; }
    const gain = Math.floor((now - S.lastEnergyTs) / interval);
    if (gain > 0) {
      S.energy = Math.min(S.maxEnergy, S.energy + gain);
      S.lastEnergyTs = S.energy === S.maxEnergy ? now : S.lastEnergyTs + gain * interval;
      save();
    }
  }
  function energyCountdown() {
    tickEnergy();
    if (S.energy >= S.maxEnergy) return '';
    const interval = ENERGY_INTERVAL / vipRegenMul();
    const remain = Math.max(0, interval - (Date.now() - S.lastEnergyTs));
    const m = Math.floor(remain / 60000), s = Math.floor((remain % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** 批量使用道具（目前只对药剂有意义）：一次用 count 个，返回合并结果。
   *  count 传 'all' 就用背包里全部（受硬上限 999 限制）。 */
  function usePropMany(id, count) {
    id = parseInt(id);
    const held = S.props[id] || 0;
    if (held <= 0) return { ok: false, msg: '没有该道具', used: 0 };
    let want = count === 'all' ? held : Math.max(1, Math.floor(Number(count) || 1));
    want = Math.min(want, held);
    if (id !== 1 && id !== 2) {
      const one = useProp(id);
      return { ok: one.ok, used: one.ok ? 1 : 0, msg: one.msg };
    }
    let used = 0, stopMsg = '';
    for (let i = 0; i < want; i++) {
      const r = useProp(id);
      if (!r.ok) { stopMsg = r.msg; break; }
      used++;
    }
    const name = (propMap.getValue(id) || {}).name || '药剂';
    return {
      ok: used > 0, used,
      msg: used ? '使用 ' + name + ' ×' + used + '　体力 ' + S.energy + '/' + S.maxEnergy + '（上限 ' + ENERGY_HARD_CAP + '）'
        : (stopMsg || '无法使用'),
    };
  }
  function energyHardCap() { return ENERGY_HARD_CAP; }

  // ---------- 武器/技能实例（含等级换算，同原版 addWeapons） ----------
  /** 原版武器表里的全部武器（按编号排序），供调试面板选择开局武器。 */
  function weaponList() {
    const out = [];
    weaponsMap.each((id, v) => { if (v && +id > 0) out.push({ id: +id, name: v.name, harm: v.harm, type: v.type }); });
    return out.sort((a, b) => a.id - b.id);
  }
  function weaponInst(str) {
    const [id, rawLevel] = String(str).split(/[:,]/).map(Number);
    const level = Math.min(15, integer(rawLevel, 1, 1));
    const base = weaponsMap.getValue(id);
    if (!base) return null;
    const w = { id, level, name: base.name, type: base.type, remark: base.remark };
    const [lo, hi] = base.harm.split('-').map(Number);
    let add = 0;
    if (level <= 10) add = parseInt(base.harmAdd) * (level - 1);
    else {
      add = parseInt(base.harmAdd) * 9;
      const extra = base.harmAdd1.split('|').map(Number);
      for (let i = 0; i < level - 10 && i < extra.length; i++) add += extra[i];
    }
    w.harmLo = lo + add; w.harmHi = hi + add;
    return w;
  }
  function skillInst(str) {
    const [id, rawLevel] = String(str).split(/[:,]/).map(Number);
    const level = Math.min(15, integer(rawLevel, 1, 1));
    const base = skillsMap.getValue(id);
    if (!base) return null;
    return { id, level, name: base.name, type: base.type, remark: base.remark };
  }
  function myWeapons() { return S.weapons.map(weaponInst).filter(Boolean); }
  function mySkills() { return S.skills.map(skillInst).filter(Boolean); }

  /** 原版技能表里的全部技能（按编号排序），供调试面板快速获得/遗忘。 */
  function skillList() {
    const out = [];
    skillsMap.each((id, v) => { if (v && +id > 0) out.push({ id: +id, name: v.name, type: v.type }); });
    return out.sort((a, b) => a.id - b.id);
  }
  /** 调试/工具用：直接获得（或改等级）指定武器/技能；已有就替换等级（可以调低）。 */
  function setWS(kind, id, level) {
    const map = kind === 'skill' ? skillsMap : weaponsMap;
    const def = map.getValue(Number(id));
    if (!def) return { ok: false, msg: '没有这个' + (kind === 'skill' ? '技能' : '武器') };
    const lv = Math.min(15, integer(level, 1, 1));
    const arr = kind === 'skill' ? S.skills : S.weapons;
    const at = arr.findIndex((x) => Number(String(x).split(':')[0]) === Number(id));
    const entry = Number(id) + ':' + lv;
    if (at >= 0) arr[at] = entry; else arr.push(entry);
    save();
    return { ok: true, kind, id: Number(id), level: lv, name: def.name, replaced: at >= 0, total: ownedWSCount(), limit: wsLimit() };
  }
  /** 调试/工具用：遗忘指定武器/技能。 */
  function forgetWS(kind, id) {
    const arr = kind === 'skill' ? S.skills : S.weapons;
    const at = arr.findIndex((x) => Number(String(x).split(':')[0]) === Number(id));
    if (at < 0) return { ok: false, msg: '还没有这个' + (kind === 'skill' ? '技能' : '武器') };
    const def = (kind === 'skill' ? skillsMap : weaponsMap).getValue(Number(id));
    arr.splice(at, 1);
    if (typeof debugForgetWS === 'function') debugForgetWS(kind, id);
    save();
    return { ok: true, kind, id: Number(id), name: def ? def.name : String(id), total: ownedWSCount(), limit: wsLimit() };
  }
  const setWeapon = (id, level) => setWS('weapon', id, level);
  const setSkill = (id, level) => setWS('skill', id, level);
  const forgetWeapon = (id) => forgetWS('weapon', id);
  const forgetSkill = (id) => forgetWS('skill', id);

  // 武技位置随固定领悟等级开放；拜师赠送技能13不占随机领悟位置。
  function wsLimit() { return GData.wsLimit(S.level); }
  function ownedWSCount() { return S.weapons.length + S.skills.filter(s => Number(String(s).split(':')[0]) !== MASTER_SKILL_ID).length; }

  /* 升级费用直接读 upgradeMap 的 coin/book（普通 50 松果、10→11 为 100；真化同表）；
   * UPGRADE_COIN 只给旧存档/旧调用方兜底，正常路径用行内 coin。 */
  const UPGRADE_COIN = 50;
  /* 1~9 级（升到 2~10 级）保留旧版“失败涨概率”，按用户口径削弱为**每次 +2%**，
   * 封顶 100%；10→11 起的真化线不吃这条保底，仍按原表固定成功率。 */
  const UPGRADE_FAIL_BONUS = 2;
  const TRUE_SKILL_MAX_LEVEL = 15;
  const isTrueLevel = (level) => (Number(level) || 0) >= 10;
  const upgradeFailKey = (kind, id) => (kind === 'weapon' ? 'w' : 's') + Number(id);
  /** 旧存档里的失败计数；只在普通 1~9 级升级时使用（真化线不读）。 */
  function upgradeFails(kind, id) {
    const m = object(S) && object(S.upgradeFails) ? S.upgradeFails : {};
    return Math.max(0, integer(m[upgradeFailKey(kind, id)], 0));
  }
  /** 普通升级：基础成功率 + 每次失败 +2%，封顶 100%。 */
  const upgradeRate = (baseRate, fails) =>
    Math.min(100, Math.max(0, integer(baseRate, 0)) + Math.max(0, integer(fails, 0)) * UPGRADE_FAIL_BONUS);
  function upgradeInfo(kind, id) {
    if (kind !== 'weapon' && kind !== 'skill') return null;
    id = Number(id);
    const list = kind === 'weapon' ? myWeapons() : mySkills();
    const it = list.find((x) => x.id === id);
    if (!it) return null;
    if (kind === 'skill' && [6, 13].includes(id)) return { max: true, fixed: true, item: it, msg: '该技能不能升级' };
    if (it.level >= TRUE_SKILL_MAX_LEVEL) return { max: true, item: it, msg: kind === 'weapon' ? '神器已达到真5上限' : '技能已达到真5上限' };
    const row = upgradeMap.getValue(it.level); // 当前等级对应升级行
    if (!row) return { max: true };
    const baseRate = parseInt(row.rate);
    const isTrue = isTrueLevel(it.level);
    const fails = isTrue ? 0 : upgradeFails(kind, id);
    return {
      max: false, item: it, baseRate, fails, isTrue,
      rate: upgradeRate(baseRate, fails),
      coin: parseInt(row.coin) || UPGRADE_COIN,
      book: parseInt(row.book) || 0,
      levelLimit: parseInt(row.levelLimit),
      bookId: kind === 'weapon' ? 22 : 21,
    };
  }
  function doUpgrade(kind, id) {
    id = Number(id);
    const info = upgradeInfo(kind, id);
    if (!info || info.max) return { ok: false, msg: info && info.msg || '已经是最高等级了！' };
    if (!debugOn('freeUpgrade')) {
      if (S.level < info.levelLimit) return { ok: false, msg: `需要玩家等级达到${info.levelLimit}级` };
      if (S.goldPoint < info.coin) return { ok: false, msg: '金松果不足！' };
      if ((S.props[info.bookId] || 0) < info.book) return { ok: false, msg: (kind === 'weapon' ? '武器' : '技能') + '卷轴不足！' };
      S.goldPoint -= info.coin;
      if (info.book > 0) S.props[info.bookId] -= info.book;
    }
    /* 每日任务按「尝试一次」计数：扣完费用、确定要掷成功率时先记，
     * 不能等到 ok 才记 —— 否则升级失败永远做不完这条任务（2026-11 用户口径）。 */
    bumpDaily('upgrade', 1, true);
    const ok = debugOn('noUpgradeFail') ? true : Math.random() * 100 < info.rate;
    if (!object(S.upgradeFails)) S.upgradeFails = {};
    const failKey = upgradeFailKey(kind, id);
    if (ok) {
      const arr = kind === 'weapon' ? S.weapons : S.skills;
      for (let i = 0; i < arr.length; i++) {
        const [wid, lv] = arr[i].split(':').map(Number);
        if (wid === id) { arr[i] = wid + ':' + (lv + 1); break; }
      }
      delete S.upgradeFails[failKey];      // 成功清零，下次回到基础概率
    } else if (!info.isTrue) {
      S.upgradeFails[failKey] = Math.min(999, info.fails + 1);   // 普通 1~9 级：每次失败 +2%
    }
    save();
    const nextRate = ok ? null : upgradeRate(info.baseRate, info.fails + 1);
    return {
      ok, rate: info.rate, fails: ok ? 0 : info.fails + 1, nextRate, isTrue: !!info.isTrue,
      msg: ok ? (info.isTrue ? '升阶成功。' : '升级成功。')
        : (info.isTrue ? '升阶失败：继续加油吧。'
          : '升级失败：继续加油吧。' + (nextRate ? '（下次成功率 ' + nextRate + '%）' : '')),
    };
  }

  let gearKeySeq = 1;
  /* 旧档/网页版 32「龟甲术N%几率抵挡2次」在 ssfight 表里已改为 44「龟甲术防降属性效果+N%」；
   * 读档时按同星级迁移，避免旧装备的词条被 normalize 直接丢掉。 */
  const LEGACY_EXT_ID = Object.freeze({ 32: 44 });
  function normalizeExt(ext) {
    return (Array.isArray(ext) ? ext : []).filter((e) => object(e) && attachmentMap.getValue(LEGACY_EXT_ID[Number(e.id)] || e.id)).map((e) => ({
      id: LEGACY_EXT_ID[Number(e.id)] || Number(e.id), level: Math.min(3, integer(e.level, 1, 1)),
    }));
  }
  /** 旧橙装是「紫装 id + orange:true」的模拟；读档时换成同部位同名的 q4 id 并恢复 q4 基准主属性。
   *  必须在 gearMap 过滤前执行，否则 q4 id 还不在 map 里会被丢掉。 */
  let orangeGearLookupCache = null;
  function orangeGearLookup() {
    if (orangeGearLookupCache) return orangeGearLookupCache;
    orangeGearLookupCache = new Map();
    try {
      gearMap.each((k, v) => {
        const set = gearSetMap.getValue(v.setId);
        if (set && Number(set.quality) === 4) orangeGearLookupCache.set(String(v.name) + '|' + Number(v.type), Number(k));
      });
    } catch (e) {}
    return orangeGearLookupCache;
  }
  function migrateLegacyOrangeGear(g) {
    if (!object(g) || g.orange !== true) return g;
    const old = gearInst(g.id);
    if (!old) return g;
    const target = orangeGearLookup().get(String(old.name) + '|' + Number(old.type));
    if (!target) return g;
    return Object.assign({}, g, { id: target, attr: gearBaseAttr(target), attrPct: 0, orange: undefined });
  }
  /** 装备主属性点的**基准值**：优先取原版 Flash 装备独立属性点表（gamedata.js 的
   *  —— 两者对本版已有的 128 件逐条一致，所以取不到也不会算出不同的数。 */
  function gearBaseAttr(id) {
    const table = (typeof GData !== 'undefined' && GData && GData.GEAR_BASE_ATTR) || null;
    const hit = table ? table[Number(id)] : undefined;
    if (Number.isFinite(hit)) return hit;
    const g = gearMap.getValue(id);
    return g ? parseInt(g.abilities.split(',')[parseInt(g.type)]) || 0 : 0;
  }
  /* 每件装备的主属性带 **±5%** 的小幅随机：产出时（掉落/碎片合成/融合/商店）roll 一次写进实例，
   * ⚠ 2026-10 用户口径：经典界面也重新启用这条随机（此前为了对齐原版 equipsArray 关掉了），
   * 幅度从原来的 ±10% 收到 ±5% —— 两套界面现在是同一条规则。
   * `最终值(+/-百分比)`；融合产物按三件材料 `attrPct` 的平均值取相邻两个整数。 */
  const GEAR_ATTR_PCT_MAX = 5;
  function gearAttrPctClamp(pct) {
    return Math.max(-GEAR_ATTR_PCT_MAX, Math.min(GEAR_ATTR_PCT_MAX,
      Number.isFinite(Number(pct)) ? Math.round(Number(pct)) : 0));
  }
  function gearAttrValueOf(id, pct) {
    const base = gearBaseAttr(id);
    if (!base) return 0;
    return Math.max(1, Math.round(base * (1 + gearAttrPctClamp(pct) / 100)));
  }
  /** 实例的随机百分比：优先读落库的 `attrPct`；老档没有该字段时按 attr/基准反推。 */
  function gearAttrPctOf(id, attr, pct) {
    if (pct != null && Number.isFinite(Number(pct))) return gearAttrPctClamp(pct);
    const base = gearBaseAttr(id);
    const value = Number(attr);
    if (!base || !Number.isFinite(value) || value <= 0) return 0;
    return gearAttrPctClamp(Math.round((value / base - 1) * 100));
  }
  function rollGearAttrPct() { return Math.floor(Math.random() * (GEAR_ATTR_PCT_MAX * 2 + 1)) - GEAR_ATTR_PCT_MAX; }
  function rollGearAttr(id) { return gearAttrValueOf(id, rollGearAttrPct()); }
  function gearInst(id, ext, attr, attrPct) {
    const g = gearMap.getValue(id);
    if (!g) return null;
    const set = gearSetMap.getValue(g.setId);
    const type = parseInt(g.type); // 0头巾(敏捷) 1手套(力量) 2衣服(生命) 3鞋(速度)
    const base = gearBaseAttr(id);
    const rolled = attr == null ? base : integer(attr, base, 0) || base;
    const abilityVal = rolled > 0 ? rolled : base;
    const attrName = ['敏捷', '力量', '生命', '速度'][type];
    const quality = parseInt(set ? set.quality : 0); // 0白1绿2蓝3紫
    /* 穿戴装备的最低门槛统一为 5 级（2026-10 用户把「更换装备」从 10 级下调到 5 级；
     * 新手 5 级教程送的白装必须能当场穿上）；高品质装备原有的 25/30/50/60 使用等级继续保留。 */
    const setLevel = parseInt(set ? set.level : 1);
    return {
      id: parseInt(id), name: g.name, type, attrName, abilityVal, attrBase: base,
      attrPct: gearAttrPctOf(id, abilityVal, attrPct), quality,
      useLevel: quality === 0 ? 5 : Math.max(5, Number.isFinite(setLevel) ? setLevel : 5),
      price: parseInt(set ? set.price : 10),
      setId: parseInt(g.setId), ext: normalizeExt(ext),
    };
  }
  function myGears() {
    return S.gears.map((g) => {
      const info = gearInst(g.id, g.ext, g.attr, g.attrPct);
      if (!info) return null;
      const out = Object.assign(info, { used: g.used, key: g.key });
      if (g.orange === true) { out.orange = true; out.quality = 4; }   // 兼容旧档的实例级橙标记
      if (g.gem && gemLevel(g.gem.id)) out.gem = { id: Number(g.gem.id), units: gemAffixUnits(g.gem.id) };
      return out;
    }).filter(Boolean).filter((g) => blackGearEnabled() || Number(g.quality) !== 5);
  }
  function wear(gearKey) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g) return false;
    if (!blackGearEnabled() && isBlackGearId(g.id)) return false;
    const gi = gearInst(g.id);
    if (!gi || S.level < gi.useLevel) return false;
    for (const o of S.gears) if (o.used && gearInst(o.id) && gearInst(o.id).type === gi.type) o.used = false;
    g.used = true; save(); return true;
  }
  function unwear(gearKey) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (g) { g.used = false; save(); }
  }
  const GEAR_SELL_RANGE = Object.freeze([[55, 60], [60, 65], [65, 70], [90, 110], [180, 220], [500, 700]]);
  const gearSellRange = (quality) => GEAR_SELL_RANGE[Math.max(0, Math.min(GEAR_SELL_RANGE.length - 1, integer(quality, 0)))] || GEAR_SELL_RANGE[0];
  const gearSellPrice = (quality) => { const [lo, hi] = gearSellRange(quality); return lo + Math.floor(Math.random() * (hi - lo + 1)); };
  function gearQuality(gear) { return gear && gear.orange === true ? 4 : (gearInst(gear.id) || {}).quality || 0; }
  /** 界面统一的装备主属性写法（2026-11 用户口径）：`84(+5%)` / `76(-3%)`。
   *  a = 加成后的结算值，b = 本件随机的整数百分比；`opts.name` 时前面带属性名。 */
  function gearAttrText(gear, opts) {
    if (!gear) return '';
    const value = Math.max(0, Math.round(Number(gear.abilityVal) || 0));
    const pct = gearAttrPctOf(gear.id, value, gear.attrPct);
    const body = value + '(' + (pct >= 0 ? '+' : '-') + Math.abs(pct) + '%)';
    return (opts && opts.name) ? ((gear.attrName ? gear.attrName + ' ' : '') + body) : body;
  }
  function starEnabled() { return slotMode() !== 'classic'; }
  /** 切换星标：标上之后不会被误融合 / 误出售。 */
  function toggleGearStar(gearKey) {
    if (!starEnabled()) return { ok: false, starred: false, msg: '经典模式没有星标' };
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g) return { ok: false, msg: '装备不存在' };
    g.starred = g.starred !== true;
    save();
    return { ok: true, starred: g.starred === true,
      msg: g.starred ? '已加星标：不会被误融合或误出售' : '已取消星标' };
  }
  function isGearStarred(gear) {
    if (!starEnabled() || !gear) return false;
    if (gear.starred === true) return true;
    const key = gear.key;
    if (!key) return false;
    const g = (S.gears || []).find((x) => x.key === key);
    return !!(g && g.starred === true);
  }
  function sellGear(gearKey) {
    const i = S.gears.findIndex((x) => x.key === gearKey);
    if (i < 0) return 0;
    /* 星标装备不参与出售（返回 0，界面据此提示）；经典模式 isGearStarred 恒 false。 */
    if (isGearStarred(S.gears[i])) return 0;
    const gold = gearSellPrice(gearQuality(S.gears[i]));
    S.gears.splice(i, 1);
    addGold(gold); save();
    return gold;
  }
  /* 「更换装备」页的展示顺序：**穿着中 > 星标（仅现代） > 获得顺序**。
   * 经典模式星标已整体移除，等价于「穿着中 > 获得顺序」。 */
  function gearsInDisplayOrder(list) {
    const src = Array.isArray(list) ? list : myGears();
    return src
      .map((gear, index) => ({ gear, index, rank: (gear.used ? 0 : 2) + (isGearStarred(gear) ? 0 : 1) }))
      .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
      .map((item) => item.gear);
  }
  /* 背包里可以直接卖的道具（装备走 sellGear）：默认按**字典价格的一半**回收
   * PROP_SELL_OVERRIDES 留作个别道具单独定价的例外表。 */
  const PROP_SELL_OVERRIDES = Object.freeze({
    48: 100,   // 恶魔果实：字典无价，单独定价 100
    21: 2,     // 技能卷轴：2 金松果一张
    22: 2,     // 武器卷轴：2 金松果一张
  });
  const MIN_SELL_PRICE = 2;   // 半价至少 1 金松果才有意义
  /* 养成平衡：大体力药剂（2）售价 5 → 6 金松果。
   * 字典（js/gamedict.js）是只读数据源，这里做一次运行期覆盖 —— 价格只有这一处权威，
   * 商店扣费与回收价都读 propMap.getValue(id).price，所以两边自动一致。 */
  const BIG_ENERGY_ID = 2;
  const BIG_ENERGY_PRICE = 6;
  (function applyShopPriceTuning() {
    const item = propMap && propMap.getValue ? propMap.getValue(BIG_ENERGY_ID) : null;
    if (!item) return;
    item.price = String(BIG_ENERGY_PRICE);
    if (Array.isArray(item.source) && item.source.length > 3) item.source[3] = String(BIG_ENERGY_PRICE);
  })();
  function propSellPrice(id) {
    id = Number(id);
    if (BAG_CURRENCY_PROP[id]) return 0;              // 货币类（金杯）不能卖
    if (PROP_SELL_OVERRIDES[id] != null) return PROP_SELL_OVERRIDES[id];
    const item = propMap.getValue(id);
    const price = item ? Math.max(0, Math.floor(Number(item.price) || 0)) : 0;
    return price >= MIN_SELL_PRICE ? Math.max(1, Math.floor(price / 2)) : 0;
  }
  /* 背包里的「货币类显示项」：金杯（40）在原版就是货币字段 `S.goldCup`，不进 `S.props`
   * 背包里照样列出它、数量**直接读货币字段**（只有一个真值来源，不会出现两处对不上），
   * 但不能卖也不能使用 —— 卖价 0，动作按钮只走「查看」。 */
  const BAG_CURRENCY_PROP = Object.freeze({ 40: 'goldCup' });
  function isBagCurrencyProp(id) { return !!BAG_CURRENCY_PROP[Number(id)]; }
  /** 背包/详情里显示的持有量：货币类读货币字段，其余读 `S.props`。 */
  function bagCountOf(id) {
    id = Number(id);
    const field = BAG_CURRENCY_PROP[id];
    if (field) return Math.max(0, integer(S[field], 0));
    return Math.max(0, integer(S.props[id], 0));
  }
  function sellableProps() {
    const ids = [];
    propMap.each((id) => { if (propSellPrice(id)) ids.push(Number(id)); });
    return ids.sort((a, b) => a - b);
  }
  /** 卖出背包道具（最多持有数量），返回获得的金松果。 */
  function sellProp(id, count) {
    id = Number(id);
    const price = propSellPrice(id);
    if (!price) return { ok: false, msg: '这个道具不能卖' };
    const held = S.props[id] || 0;
    if (held < 1) return { ok: false, msg: '背包里没有这个道具' };
    const n = Math.max(1, Math.min(held, Math.round(Number(count) || 1)));
    S.props[id] = held - n;
    if (S.props[id] <= 0) {
      delete S.props[id];
      /* 卖出最后一个果实时，作废它已经抽出的候选，避免留下无法使用的待选。 */
      if ((id === 47 || id === 48) && S.fruitChoices) delete S.fruitChoices[id];
    }
    const gold = price * n;
    addGold(gold);
    bumpDaily('sell', n, true);   // 每日任务：卖出 N 个道具
    save();
    const item = propMap.getValue(id);
    return { ok: true, sold: n, gold, price, msg: '卖出 ' + (item ? item.name : '道具') + ' ×' + n + '，获得 ' + gold + ' 金松果' };
  }
  function gemLevel(id) { id = Number(id); return id >= 101 && id <= 107 ? id - 100 : 0; }
  function gemPercent(lv) { lv = integer(lv, 0, 0); return lv > 0 ? 5 * (lv * lv - lv + 2) : 0; }
  /* 宝石对「附加属性」的增幅：原版不是随机百分比，而是按宝石等级给 1~12 个单位的阶梯。
   * 客户端 `getAttachment(id, star, count-1)` 按单位数取 extraValue，与星级 ability 相加。 */
  const GEM_AFFIX_UNITS = Object.freeze([1, 2, 3, 5, 7, 9, 12]);
  function gemAffixUnits(gemId) { const lv = gemLevel(gemId); return lv ? GEM_AFFIX_UNITS[lv - 1] : 0; }
  /** 某条词条在「星级 + 宝石增幅单位」下的实际值：ability[star-1] + extra[units-1]。 */
  function attachmentValue(id, star, units) {
    const def = attachmentMap.getValue(Number(id));
    if (!def) return { base: 0, extra: 0, total: 0 };
    const abilities = String(def.ability || '').split(',').map(Number);
    const extras = String(def.extra || '').split(',').map(Number);
    const starIdx = Math.max(0, Math.min(abilities.length - 1, (Number(star) || 1) - 1));
    const base = Number(abilities[starIdx]) || 0;
    const unitIdx = (Number(units) || 0) - 1;
    const extra = unitIdx >= 0 && unitIdx < extras.length ? (Number(extras[unitIdx]) || 0) : 0;
    return { base, extra, total: base + extra };
  }
  const gemMergeRate = (lv) => Math.pow(0.88, Math.max(1, Math.min(6, integer(lv, 1, 1))));
  function rollGemDrop(chancePct) {
    if (S.level < 45 || Math.random() * 100 >= chancePct) return null;
    const id = Math.random() < 0.25 ? 102 : 101;
    S.props[id] = (S.props[id] || 0) + 1;
    return { id, name: propMap.getValue(id).name };
  }
  /** 3个同级宝石 + 10金松果 → 有几率合成高一级；失败照扣费用，50%几率一颗材料降1级（1级碎裂）。
   *  成功率 = 0.88^材料等级。 */
  function mergeGems(id) {
    id = Number(id);
    const lv = gemLevel(id);
    if (!lv) return { ok: false, msg: '请选择宝石' };
    if (lv >= 7) return { ok: false, msg: '七级宝石已是最高等级' };
    if ((S.props[id] || 0) < 3) return { ok: false, msg: '需要 3 个同级宝石' };
    if (S.goldPoint < 10) return { ok: false, msg: '金松果不足 10 个' };
    S.props[id] -= 3; S.goldPoint -= 10;
    bumpDaily('gem', 1, true);   // 每日任务：合成 N 次宝石（材料已经扣掉就算一次）
    if (Math.random() < gemMergeRate(lv)) {
      S.props[id + 1] = (S.props[id + 1] || 0) + 1;
      save();
      return { ok: true, success: true, msg: '合成成功：' + propMap.getValue(id + 1).name + ' ×1' };
    }
    if (Math.random() < 0.5) {
      if (lv > 1) S.props[id - 1] = (S.props[id - 1] || 0) + 1;   // 退回一个降1级的
      save();
      return { ok: true, success: false, msg: lv > 1 ? '合成失败！一颗宝石降为 ' + propMap.getValue(id - 1).name : '合成失败！一颗宝石碎裂了' };
    }
    save();
    return { ok: true, success: false, msg: '合成失败，宝石没有变化' };
  }
  /** 镶嵌 / 卸下各 5 金松果；每件橙色或黑色装备限 1 颗。
   *  宝石不再随机附加属性百分比，而是按原版 1/2/3/5/7/9/12 个单位抬高词条增幅。 */
  const GEM_SOCKET_COST = 5;
  function socketGem(gearKey, gemId) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g) return { ok: false, msg: '装备不存在' };
    if (!canSocketGem(g)) return { ok: false, msg: '只有橙色（传说）或黑色装备可以镶嵌宝石' };
    if (g.gem) return { ok: false, msg: '每件装备最多镶嵌 1 颗宝石，请先卸下原有宝石' };
    const lv = gemLevel(gemId);
    if (!lv || !(S.props[gemId] > 0)) return { ok: false, msg: '没有该宝石' };
    if (S.goldPoint < GEM_SOCKET_COST) return { ok: false, msg: '镶嵌需要 ' + GEM_SOCKET_COST + ' 金松果' };
    S.goldPoint -= GEM_SOCKET_COST;
    S.props[gemId]--;
    g.gem = { id: Number(gemId) };
    const units = gemAffixUnits(gemId);
    const first = normalizeExt(g.ext)[0];
    const firstDef = first ? attachmentMap.getValue(first.id) : null;
    const firstVal = first ? attachmentValue(first.id, first.level, units) : null;
    const sample = firstDef && firstVal ? '，' + firstDef.name.replace('N', String(firstVal.total)) : '';
    save();
    return { ok: true, msg: propMap.getValue(gemId).name + ' 镶嵌成功（−' + GEM_SOCKET_COST + ' 金松果）：主属性 +' + gemPercent(lv) + '%，附加属性增幅 ' + units + ' 档' + sample };
  }
  function unsocketGem(gearKey) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g || !g.gem) return { ok: false, msg: '该装备没有镶嵌宝石' };
    if (S.goldPoint < GEM_SOCKET_COST) return { ok: false, msg: '卸下需要 ' + GEM_SOCKET_COST + ' 金松果' };
    S.goldPoint -= GEM_SOCKET_COST;
    S.props[g.gem.id] = (S.props[g.gem.id] || 0) + 1;
    delete g.gem;
    save();
    return { ok: true, msg: '已卸下宝石（−' + GEM_SOCKET_COST + ' 金松果），宝石放回背包' };
  }

  const GEAR_COST_BY_QUALITY = Object.freeze([30, 40, 50, 60, 200, 1000]);
  const gearCostOf = (quality) => GEAR_COST_BY_QUALITY[
    Math.max(0, Math.min(GEAR_COST_BY_QUALITY.length - 1, integer(quality, 0)))] || GEAR_COST_BY_QUALITY[0];

  function composeGear(propId) {
    propId = Number(propId);
    const blackSet = (typeof GData !== 'undefined' && GData.BLACK_SHARD_SET) ? Number(GData.BLACK_SHARD_SET[propId]) : 0;
    if (blackSet) {
      if (!blackGearEnabled()) return { ok: false, msg: '现代界面没有黑装内容' };
      if ((S.props[propId] || 0) < 10) return { ok: false, msg: '碎片不足10个！' };
      const cost = gearCostOf(5);
      if (S.goldPoint < cost) return { ok: false, msg: '金松果不足' + cost + '！' };
      const ids = [];
      gearMap.each((k, v) => { if (Number(v.setId) === blackSet) ids.push(Number(v.id)); });
      if (ids.length !== 4) return { ok: false, msg: '黑装数据不完整' };
      const typeOf = (id) => Number((gearMap.getValue(id) || {}).type);
      const owned = new Set((S.gears || []).filter((g) => ids.includes(Number(g.id))).map((g) => typeOf(g.id)));
      let gid = ids[Math.floor(Math.random() * ids.length)];
      if (owned.size < 4) {
        for (let tries = 0; tries < 2 && owned.has(typeOf(gid)); tries++) {
          gid = ids[Math.floor(Math.random() * ids.length)];
        }
        if (owned.has(typeOf(gid))) {
          const missing = ids.filter((id) => !owned.has(typeOf(id)));
          if (missing.length) gid = missing[Math.floor(Math.random() * missing.length)];
        }
      }
      S.props[propId] -= 10;
      if (S.props[propId] <= 0) delete S.props[propId];
      S.goldPoint -= cost;
      const g = addGear(gid, randomExtForQuality(5));
      bumpDaily('merge', 1, true);   // 每日任务：合成或融合 N 次装备
      save();
      return { ok: true, gear: g };
    }
    if (![24, 25, 26].includes(propId)) return { ok: false, msg: '请选择装备碎片' };
    if ((S.props[propId] || 0) < 10) return { ok: false, msg: '碎片不足10个！' };
    const quality = { 24: 0, 25: 1, 26: 2 }[propId];
    const cost = gearCostOf(quality);
    if (S.goldPoint < cost) return { ok: false, msg: '金松果不足' + cost + '！' };
    const candidates = [];
    gearSetMap.each((k, v) => { if (parseInt(v.quality) === quality) candidates.push(parseInt(v.id)); });
    const setId = candidates[Math.floor(Math.random() * candidates.length)];
    const gearsOfSet = [];
    gearMap.each((k, v) => { if (parseInt(v.setId) === setId) gearsOfSet.push(parseInt(v.id)); });
    const gid = gearsOfSet[Math.floor(Math.random() * gearsOfSet.length)];
    S.props[propId] -= 10; S.goldPoint -= cost;
    const g = addGear(gid, randomExtForQuality(quality));
    bumpDaily('merge', 1, true);   // 每日任务：合成或融合 N 次装备
    save();
    return { ok: true, gear: g };
  }
  function gearPart(id) {
    const def = gearMap.getValue(id);
    return def ? Number(def.type) : -1;
  }
  /** 把一份对手穿戴表规整成 `[{id, ext, type}]`（`type` 缺失时按装备字典反查）。
   *  原版这些都由服务端下发；复刻的 `genAI` 抽出来的装备**没有 `type`**，
   *  三处（好友 / 师父 / 徒弟）共用这一份，别再各写一遍。 */
  function normalizeFoeGears(list) {
    return (Array.isArray(list) ? list : []).map((g) => {
      const id = Number(g && g.id != null ? g.id : g);
      if (!Number.isFinite(id) || id <= 0) return null;
      const out = {
        id: id,
        ext: Array.isArray(g && g.ext) ? g.ext.slice(0, 3) : [],
        attr: g && g.attr ? g.attr : undefined,
        attrPct: g && g.attrPct != null ? gearAttrPctClamp(g.attrPct) : undefined,
        type: g && g.type != null ? Number(g.type) : gearPart(id),
      };
      /* 橙装与宝石是**实例级**字段（同 id 的紫装不是橙装）；好友/师徒快照也要带过去，
       * 否则挑战页立绘、查看装备、切磋时的套装收益都会退回紫装。 */
      if (g && g.orange === true) out.orange = true;
      const gemLv = g && g.gem && gemLevel(g.gem.id);
      if (gemLv) out.gem = { id: 100 + gemLv, units: gemAffixUnits(100 + gemLv) };
      return out;
    }).filter(Boolean);
  }
  function gearPartQuality(id) {
    const def = gearMap.getValue(id);
    const set = def ? gearSetMap.getValue(parseInt(def.setId)) : null;
    return set ? parseInt(set.quality) : -1;
  }
  /** 某部位 + 某品质的全部装备 id（融合产物从这里随机取一件）。
   *  `allow(id)`（可选）= 只保留满足条件的 id —— 现代界面用它把「没有贴图的装备」排除在融合之外。 */
  function gearIdsOf(part, quality, allow) {
    const out = [];
    gearMap.each((k, v) => {
      const id = parseInt(v.id);
      if (Number(v.type) !== Number(part) || gearPartQuality(id) !== Number(quality)) return;
      if (typeof allow === 'function' && !allow(id)) return;
      out.push(id);
    });
    return out;
  }
  function gearName(id) { const d = gearMap.getValue(id); return d ? d.name : ''; }
  function gearSetOf(id) { const d = gearMap.getValue(id); return d ? parseInt(d.setId) : -1; }

  /* ---------- 套装收益（数值表在 gamedata.js【GD6】，原版没有这套机制） ----------
   * 阈值只有 2 件 / 4 件两档，4 件档**叠加**在 2 件档之上。
   * **独立通道**，不复用塔 buff 的 mods（那是「本局增益」，与被脱光的装备是两回事）。 */
  const GEAR_PART_SUFFIX = /(头巾|头饰|头盔|护额|手套|拳套|拳甲|服|铠甲|衣服|鞋|短靴)$/;
  function gearSetFamily(id) {
    const d = gearMap.getValue(id);
    return d ? String(d.name).replace(GEAR_PART_SUFFIX, '') : '';
  }
  /** 当前**实际生效**的套装件数：家族 → { family, count, quality }。
   *  默认数玩家（`S.gears` / `S.level`）；传 `list`/`level` 就数别人（对手）。
   *  只数「已穿戴 + 等级够」的，与 totalStats / equipmentEffects 的口径一致。 */
  function setPieceCounts(list, level) {
    const gears = Array.isArray(list) ? list : S.gears;
    const lv = Number.isFinite(Number(level)) ? Number(level) : S.level;
    const map = {};
    for (const g of gears) {
      if (!g || g.used !== true) continue;
      const gi = gearInst(g.id, g.ext, g.attr);
      if (!gi || lv < gi.useLevel) continue;
      const family = gearSetFamily(gi.id);
      if (!family || !GData.setBonusTable(family)) continue;   // 表里没有的家族不参与
      const q = gearQuality(g);
      const entry = map[family] || (map[family] = { family, count: 0, quality: q });
      entry.count++;
      entry.quality = Math.min(entry.quality, q);
    }
    return map;
  }
  /** 经典模式不展示套装收益（原版没有这套机制，经典装备页也没有介绍入口）：
   *  玩家自己的属性/战斗修正与普通 AI 的套装收益整套关闭，避免“界面没说明、战斗里却偷偷生效”。
   *  现代模式保持；塔 Boss 走显式 `setBonusEffects(ids)` 的关卡设计不受影响。 */
  function classicSetBonusOff() {
    const mode = (S && S.settings && validSaveMode(S.settings.uiMode))
      ? String(S.settings.uiMode) : slotMode();
    return mode !== 'modern';
  }
  /** 某个家族的收益合计（2 件档 + 4 件档叠加）；不足 2 件返回 null。 */
  function setBonusOf(entry) {
    const table = entry && GData.setBonusTable(entry.family);
    if (!table || !(entry.count >= 2)) return null;
    const raw = GData.SET_BONUS_RAW_KEYS || [];
    const eff = {};
    const add = (src) => {
      for (const [k, v] of Object.entries(src || {})) {
        eff[k] = raw.includes(k)
          ? Math.max(Number(eff[k]) || 0, Number(v) || 0)
          : (Number(eff[k]) || 0) + Number(v);
      }
    };
    add(GData.setBonusScale(entry.family, entry.quality, table[2]));
    if (entry.count >= 4) add(GData.setBonusScale(entry.family, entry.quality, table[4]));
    return eff;
  }
  /** 当前生效的套装收益：{ stats:{power,agility,speed,hp}, fx:{战斗修正} }。
   *  不传参数就是玩家自己；对手侧由 applyFoeSetBonuses 传它自己的装备表进来。 */
  function setBonusEffects(list, level) {
    /* 只传 list 的是塔 Boss 的显式关卡套装；玩家自己 / 普通 AI 在经典模式下整套关闭。 */
    if (list == null && classicSetBonusOff()) {
      return { stats: { power: 0, agility: 0, speed: 0, hp: 0 }, fx: {} };
    }
    const raw = GData.SET_BONUS_RAW_KEYS || [];
    const counts = setPieceCounts(list, level);
    const stats = { power: 0, agility: 0, speed: 0, hp: 0 };
    const fx = {};
    for (const family of Object.keys(counts)) {
      const eff = setBonusOf(counts[family]);
      if (!eff) continue;
      for (const [k, v] of Object.entries(eff)) {
        if (GData.SET_BONUS_ATTR_KEYS.includes(k)) stats[k] += Number(v) || 0;
        else fx[k] = raw.includes(k)
          ? Math.max(Number(fx[k]) || 0, Number(v) || 0)
          : (Number(fx[k]) || 0) + (Number(v) || 0);
      }
    }
    return { stats, fx };
  }
  /** 界面用：当前生效的家族 + 每档的收益文案与下一档进度（含只有 1 件的家族）。 */
  function setBonusList() {
    if (classicSetBonusOff()) return [];
    const counts = setPieceCounts();
    const out = [];
    for (const family of Object.keys(counts)) {
      const entry = counts[family], table = GData.setBonusTable(family);
      const eff = setBonusOf(entry);
      const tier = entry.count >= 4 ? 4 : entry.count >= 2 ? 2 : 0;
      out.push({
        family, count: entry.count, quality: entry.quality, tier, active: tier > 0,
        text: eff ? GData.setBonusText(eff) : [],
        tiers: [2, 4].map((need) => ({
          need, on: entry.count >= need,
          text: GData.setBonusText(GData.setBonusScale(family, entry.quality, table[need])),
        })),
      });
    }
    out.sort((a, b) => (b.count - a.count) || (b.quality - a.quality) || a.family.localeCompare(b.family));
    return out;
  }
  function setBonusForGear(id, viewQuality) {
    if (classicSetBonusOff()) return null;
    const family = gearSetFamily(id);
    const table = GData.setBonusTable(family);
    if (!table) return null;
    const entry = setPieceCounts()[family] || { family, count: 0, quality: 0 };
    const quality = entry.count ? entry.quality : integer(viewQuality, 0);
    return {
      family, count: entry.count, quality,
      tiers: [2, 4].map((need) => ({
        need, on: entry.count >= need,
        text: GData.setBonusText(GData.setBonusScale(family, quality, table[need])),
      })),
    };
  }
  /** 把套装收益的战斗修正写进本场 fighter（属性部分已经在 totalStats 里加过）。
   *  写在独立字段 setFx 上：sim 侧只在读 mods 的地方顺带读一次，且被真·色诱之术
   *  `list`/`level` 不传就是玩家；对手侧走 applyFoeSetBonuses。 */
  function applySetBonuses(fighter, list, level) {
    if (!fighter || typeof fighter !== 'object') return null;
    const fx = setBonusEffects(list, level).fx;
    if (!Object.keys(fx).length) { delete fighter.setFx; return null; }
    fighter.setFx = fx;
    return fx;
  }
  /** **对手侧**：把套装收益（属性 + 战斗修正）落到 genAI 造出来的对手身上。
   *  注意：**挑战塔 / 无尽塔的敌人不走这里** —— tower.js 的 buildFoe 自己按层数曲线造敌人，
   *  那边的「套装」只用来决定外观（`wearsOf` 给的是贴图 wears），所以塔里两边都不吃套装收益。 */
  function applyFoeSetBonuses(foe, gears, level) {
    if (!foe || typeof foe !== 'object') return null;
    /* 经典模式普通 AI 也不吃隐藏套装；塔 Boss 的套装由 tower.js 显式调用 setBonusEffects。 */
    if (classicSetBonusOff()) return null;
    const eff = setBonusEffects(gears, level);
    foe.power += eff.stats.power;
    foe.agility += eff.stats.agility;
    foe.speed += eff.stats.speed;
    foe.hp += eff.stats.hp;          // 对手的 hp 就是它的生命上限（与上面装备主属性的加法同口径）
    return applySetBonuses(foe, gears, level);
  }

  /* 融合规则（对齐联机版）：部位从三件材料随机取；目标品质 = 材料品质+1（黑装封顶 5）；
   * 同部位优先同套，存在其它套时 2% 概率变异；词条按星级继承前两条、第三条随机。
   * 下面 FUSION_SAME_NAME_RATE / pickMergeTarget 是旧规则，只留旧档/旧界面引用，mergeGears 不调。 */
  const FUSION_SAME_NAME_RATE = { 2: 0.50, 3: 0.97 };
  const FUSION_MUTANT_RATE = { 2: 0.03, 3: 0.03 };
  const FUSION_MUTANT_SET = 51;
  /* 紫→橙变异的目标是橙色狂战（set 52，ids 205-208）；紫→橙时 51 是紫狂战，不能用。 */
  const FUSION_ORANGE_MUTANT_SET = 52;
  const FUSION_BLACK_MUTANT_SETS = Object.freeze([67, 68, 69, 70]);
  /* 联机版融合的变异概率（三件材料都有可用目标时）。 */
  const FUSION_ONLINE_MUTANT_RATE = 0.02;
  /* 旧版逐槽继承概率；联机版改成「前两条固定 + 第三条随机」，常量只为兼容旧界面导出。 */
  const FUSION_EXT_INHERIT_RATE = 0.5;
  const FUSION_EXT_UPGRADE_RATE = 0.5;
  const FUSION_EXT_MAX_LEVEL = 3;
  const FUSION_EXT_SLOTS = { 1: 0, 2: 1, 3: 2, 4: 3 };
  const fusionSlots = (quality) => FUSION_EXT_SLOTS[Math.max(0, Math.min(4, integer(quality, 0)))] || 0;
  function randomExtForQuality(quality) {
    const slots = fusionSlots(quality);
    return slots ? randomExt(slots, quality >= 3 ? 3 : 2) : [];
  }
  /** 融合产物的词条（2026-11 对齐联机版）：
   *  ① 把三件材料的词条按**星级从高到低**排列，同星级按材料顺序 / 材料内词条顺序；
   *  ④ 继承后每条仍有 50% 概率升 1 星（上限 3 星）；低品质只保留对应槽位。 */
  function mergeExt(gs, targetQuality) {
    const slots = fusionSlots(targetQuality);
    if (!slots) return [];
    const upgrade = (entry) => ({
      id: entry.id,
      level: entry.level < FUSION_EXT_MAX_LEVEL && Math.random() < FUSION_EXT_UPGRADE_RATE
        ? entry.level + 1 : entry.level,
    });
    /* 隐藏机制：只有**黑装产物**（3 橙→黑 / 3 黑→黑）在材料里恰好有 4 个
     * 最高星级。少于或不为 4 个共有词条时仍按常规槽位封顶，不对外写进帮助页。 */
    const sharedCounts = new Map(), sharedLevels = new Map(), sharedIndex = new Map();
    let cursor = 0;
    for (const g of gs) {
      const seen = new Set();
      for (const e of normalizeExt(g.ext)) {
        const id = Number(e.id);
        if (!sharedIndex.has(id)) sharedIndex.set(id, cursor++);
        sharedLevels.set(id, Math.max(sharedLevels.get(id) || 0, Number(e.level) || 1));
        if (seen.has(id)) continue;
        seen.add(id);
        sharedCounts.set(id, (sharedCounts.get(id) || 0) + 1);
      }
    }
    const shared = [...sharedCounts.entries()].filter(([, n]) => n >= 2)
      .map(([id]) => ({ id, level: sharedLevels.get(id) || 1, index: sharedIndex.get(id) || 0 }))
      .sort((a, b) => b.level - a.level || a.index - b.index);
    if (targetQuality === 5 && shared.length === 4) return shared.map(upgrade);
    const source = [];
    for (const g of gs) {
      for (const e of normalizeExt(g.ext)) {
        source.push({ id: e.id, level: e.level, index: source.length });
      }
    }
    const ordered = source.slice().sort((a, b) => b.level - a.level || a.index - b.index);
    const first = ordered.slice(0, Math.min(2, slots));
    const out = first.map(upgrade);
    const selected = new Set(first.map((e) => e.index));
    const remaining = ordered.filter((e) => !selected.has(e.index));
    const used = new Set(out.map((e) => Number(e.id)));
    while (out.length < slots) {
      if (remaining.length) {
        const picked = remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0];
        out.push(upgrade(picked));
        used.add(Number(picked.id));
      } else {
        const [extra] = randomExt(1, 1, used);
        if (!extra) break;
        out.push(upgrade(extra));
        used.add(Number(extra.id));
      }
    }
    return out;
  }
  /** 融合产物的目标装备。名称按「三件材料的同名情况」三选一：
   *  判定顺序 = 先掷变异、再掷保名，剩下的走随机其它；这样三段的概率就是字面值。
   *  ⚠ 三件同套的保底在 `familyUpgradeTarget` 里**先**处理；这里只服务跨套 / 无下一档的情况。
   *  返回 { id, mutant }：mutant 为 true 表示这次是狂战变异。 */
  function pickMergeTarget(gs, part, targetQuality, allow) {
    const pool = gearIdsOf(part, targetQuality, allow);
    if (!pool.length) return null;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const names = gs.map((g) => gearName(g.id));
    const dup = names.filter((n) => n === names[0]).length;
    const same = dup >= 2 ? names[0] : (names[1] === names[2] ? names[1] : null);
    if (same) {
      const hit = pool.filter((id) => gearName(id) === same);
      const mutantSets = targetQuality === 5 ? FUSION_BLACK_MUTANT_SETS
        : targetQuality === 4 ? [FUSION_ORANGE_MUTANT_SET] : [FUSION_MUTANT_SET];
      const mutants = pool.filter((id) => mutantSets.includes(gearSetOf(id)));
      const others = pool.filter((id) => gearName(id) !== same);
      const key = dup === 3 ? 3 : 2;
      /* 只有目标品质确实有狂战件时才掷变异，否则那 3% 归到「随机其它」。 */
      const mutantRate = mutants.length ? Math.max(0, Number(FUSION_MUTANT_RATE[key]) || 0) : 0;
      const sameRate = Math.max(0, Number(FUSION_SAME_NAME_RATE[key]) || 0);
      const roll = Math.random();
      if (mutantRate > 0 && roll < mutantRate) return { id: pick(mutants), mutant: true };
      if (hit.length && roll < mutantRate + sameRate) return { id: pick(hit), mutant: false };
      if (others.length) return { id: pick(others), mutant: false };   // 两件同名剩下的 47%：随机其它装备
      if (hit.length) return { id: pick(hit), mutant: false };         // 兜底：没有「其它」可挑就只能保名
    }
    return { id: pick(pool), mutant: false };
  }
  /* 「同套装」判定（融合保底用）：取该 setId 下四件装备名去掉部位后缀后的公共前缀。
   * 不能直接用 `gearSetFamily(单件)`：它按单件名去后缀，"机器猫头 / 机器猫拳" 会各自成族，
   * 而它们和 机器猫服 / 鞋 是同一套。这里只服务融合，不改套装收益的家族口径。 */
  const FUSION_PART_SUFFIXES = ['头巾', '头饰', '头盔', '护额', '拳套', '拳甲', '手套', '铠甲', '短靴', '服', '鞋', '头', '拳'];
  const FUSION_SET_FAMILY = new Map();
  function stripFusionPart(name) {
    let s = String(name == null ? '' : name);
    for (const suffix of FUSION_PART_SUFFIXES) {
      if (s.length > suffix.length && s.slice(-suffix.length) === suffix) return s.slice(0, -suffix.length);
    }
    return s;
  }
  function fusionSetFamily(setId) {
    const key = Number(setId);
    if (!Number.isFinite(key)) return '';
    if (FUSION_SET_FAMILY.has(key)) return FUSION_SET_FAMILY.get(key);
    const names = [];
    gearMap.each((k, v) => { if (Number(v.setId) === key) names.push(stripFusionPart(v.name)); });
    let family = names[0] || '';
    for (const name of names.slice(1)) {
      while (family && name.indexOf(family) !== 0) family = family.slice(0, -1);
    }
    FUSION_SET_FAMILY.set(key, family);
    return family;
  }
  /** 三件同套装的融合目标：下一品质、**首件材料部位**、同一套装家族。
   *  · 三件材料必须同属一个套装家族（狂战头盔/拳甲/铠甲 = 狂战；黑装 46/67 也算同一套）；
   *  · 目标品质没有该家族（早期白/绿套没有下一档）时返回 null，调用方回退到原有随机规则；
   *  · 同一家族在目标品质有多套数据（狂战 46/67、怒战 47/68）时取 id 最小件，避免随机抖动。 */
  function familyUpgradeTarget(gs, part, targetQuality, allow) {
    if (!Array.isArray(gs) || gs.length !== 3) return null;
    const families = gs.map((g) => {
      const def = gearMap.getValue(g && g.id);
      return def ? fusionSetFamily(def.setId) : '';
    });
    if (!families[0] || families.some((f) => f !== families[0])) return null;
    const pool = gearIdsOf(part, targetQuality, allow).filter((id) => {
      const def = gearMap.getValue(id);
      return def && fusionSetFamily(def.setId) === families[0];
    });
    if (!pool.length) return null;
    return { id: Math.min.apply(null, pool), mutant: false, family: families[0] };
  }
  /** 融合页提示：2026-11 对齐联机版后，产物部位/套装/词条都由随机决定，
   *  不再存在「三件同套必得」的确定产物，因此这里恒返回 null（界面不写保底提示）。
   *  保留函数是为了旧界面 / 旧回归仍能安全调用。 */
  function fusionFamilyInfo() {
    return null;
  }

  /** 融合产物的主属性百分比（2026-11 用户口径）：
   *  · 结果封顶 +5%（下限对称 -5%）。
   *  返回整数百分比，属性点由目标装备自己的基准值折算。 */
  function fusionAttrPctOf(pcts) {
    const list = (Array.isArray(pcts) ? pcts : []).map((p) => gearAttrPctClamp(p));
    const avg = list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    let lo = Math.floor(avg), hi = Math.ceil(avg);
    if (Number.isInteger(avg)) hi = avg + 1;
    const a = gearAttrPctClamp(lo), b = gearAttrPctClamp(hi);
    const candidates = a === b ? [a] : [a, b];
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  function fusionGearAttr(gs, targetId) {
    const pct = fusionAttrPctOf((gs || []).map((g) => gearAttrPctOf(g && g.id, g && g.attr, g && g.attrPct)));
    return { pct, attr: gearAttrValueOf(targetId, pct) };
  }
  /** 三件同品质装备融合：部位随机取一件，品质 +1（黑装封顶 5），同套优先、2% 变异；
   *  opts.targetAllowed(id) 可过滤产物（现代界面只允许有贴图的装备，避免合出空白装备）。 */
  function mergeGears(keys, opts) {
    if (!Array.isArray(keys) || keys.length !== 3 || new Set(keys).size !== 3) return { ok: false, msg: '请选择三件不同的装备' };
    const allow = (opts && typeof opts.targetAllowed === 'function') ? opts.targetAllowed : null;
    const gs = keys.map((k) => S.gears.find((x) => x.key === k)).filter(Boolean);
    if (gs.length !== 3) return { ok: false, msg: '装备不存在' };
    if (!blackGearEnabled() && gs.some((g) => isBlackGearId(g.id))) return { ok: false, msg: '现代界面没有黑装内容' };
    if (gs.some((g) => g.used)) return { ok: false, msg: '不能融合已穿戴的装备' };
    /* 星标装备受保护：不参与融合（防止误合成）；经典模式没有星标。 */
    if (gs.some((g) => isGearStarred(g))) {
      return { ok: false, msg: '有装备已加星标（防误合），先取消星标再融合' };
    }
    const q = gearQuality(gs[0]);
    if (gs.some((g) => gearQuality(g) !== q)) return { ok: false, msg: '需要三件同品质的装备' };
    /* 现代界面没有黑装：橙装（q4）不能再往上合，黑装材料也会在上面被拦。 */
    if (q >= 4 && !blackGearEnabled()) return { ok: false, msg: '现代界面没有黑装内容' };
    const sourceGear = gs[Math.floor(Math.random() * gs.length)];
    const part = gearPart(sourceGear.id);
    if (part < 0) return { ok: false, msg: '装备数据异常' };
    const cost = gearCostOf(q);
    if (S.goldPoint < cost) return { ok: false, msg: '融合费用不足（需要 ' + cost + ' 金松果）' };

    const targetQuality = Math.min(5, q + 1);
    const pool = gearIdsOf(part, targetQuality, allow);
    if (!pool.length) return { ok: false, msg: '该部位没有可融合的目标装备' };
    /* 目标优先跟「部位来源材料」同套；有其它套时才有 2% 变异。
     * 变异池：紫/蓝档 51（紫狂战）、紫→橙 52（橙狂战）、橙/黑档 67~70（深海/机器猫/怒战/狂战）。 */
    const family = fusionSetFamily(gearSetOf(sourceGear.id));
    const inherited = pool.filter((id) => fusionSetFamily(gearSetOf(id)) === family);
    const mutationSets = targetQuality === 5 ? FUSION_BLACK_MUTANT_SETS
      : targetQuality === 4 ? [FUSION_ORANGE_MUTANT_SET] : [FUSION_MUTANT_SET];
    const alternatives = pool.filter((id) => fusionSetFamily(gearSetOf(id)) !== family);
    const special = alternatives.filter((id) => mutationSets.includes(gearSetOf(id)));
    const mutants = special.length ? special : alternatives;
    const mutated = mutants.length > 0 && Math.random() < FUSION_ONLINE_MUTANT_RATE;
    const available = mutated ? mutants
      : (inherited.length ? inherited : pool.filter((id) => !mutants.includes(id)));
    const candidates = available.length ? available : pool;
    const id = candidates[Math.floor(Math.random() * candidates.length)];

    S.goldPoint -= cost;
    S.gears = S.gears.filter((g) => !keys.includes(g.key));
    const fused = fusionGearAttr(gs, id);
    const made = addGear(id, mergeExt(gs, targetQuality), fused.attr, fused.pct);
    const card = q >= 5 && Math.random() < 0.2 ? 1 : 0;
    if (card) S.props[80] = (S.props[80] || 0) + card;
    bumpDaily('merge', 1, true);   // 每日任务：合成或融合 N 次装备
    save();
    return { ok: true, gear: Object.assign(made || {}, { quality: targetQuality, mutant: mutated }), card };
  }
  function autoEnergyPotion(need) {
    const s = state();
    const deficit = Math.max(0, (Number(need) || 0) - s.energy);
    if (!deficit) return { ok: true, used: 0 };
    const order = deficit <= 10 ? [1, 2] : [2, 1];
    for (const id of order) {
      if (!(s.props[id] > 0)) continue;
      const res = useProp(id);
      if (res && res.ok) return { ok: true, used: id, msg: res.msg };
    }
    return { ok: false, msg: '体力不足，也没有体力药剂。' };
  }
  function randomExt(n, maxLevel, exclude) {
    maxLevel = Math.max(1, Math.min(3, Number(maxLevel) || 3));
    const ext = [];
    const used = new Set((exclude ? [...exclude] : []).map(Number));
    const ids = attachmentMap.keys.map(Number).filter((id) => Number.isFinite(id) && !used.has(id));
    for (let i = 0; i < n && ids.length; i++) {
      const aid = ids.splice(Math.floor(Math.random() * ids.length), 1)[0];
      ext.push({ id: aid, level: 1 + Math.floor(Math.random() * maxLevel) });
    }
    return ext;
  }
  /** 词条文本。`units` = 宝石增幅单位（0 = 不显示增幅，取星级基础值）。 */
  function extText(ext, units) {
    return (ext || []).map((e) => {
      const id = LEGACY_EXT_ID[Number(e.id)] || e.id;
      const a = attachmentMap.getValue(id);
      if (!a) return '';
      const v = attachmentValue(id, e.level, units);
      return a.name.replace('N', String(v.total));
    }).filter(Boolean);
  }
  function extTextForGear(gear, detail) {
    const units = gemAffixUnits(gear && gear.gem && gear.gem.id);
    return (gear && gear.ext ? gear.ext : []).map((e) => {
      const id = LEGACY_EXT_ID[Number(e.id)] || e.id;
      const a = attachmentMap.getValue(id);
      if (!a) return '';
      const v = attachmentValue(id, e.level, units);
      return a.name.replace('N', String(v.total)) + (detail && v.extra > 0 ? '（基础' + v.base + '+增幅' + v.extra + '）' : '');
    }).filter(Boolean);
  }
  function extExtraText(ext, units) {
    return (ext || []).map((e) => {
      const id = LEGACY_EXT_ID[Number(e.id)] || e.id;
      const a = attachmentMap.getValue(id);
      if (!a) return '';
      const v = attachmentValue(id, e.level, units);
      if (!v.extra) return '';
      const name = String(a.name || '');
      const sign = name.indexOf('-N%') >= 0 ? '-' : '+';
      const unit = name.indexOf('N点') >= 0 ? '点' : name.indexOf('N倍') >= 0 ? '倍' : '%';
      return sign + v.extra + unit;
    }).filter(Boolean);
  }
  function extExtraTextForGear(gear) {
    return extExtraText(gear && gear.ext, gemAffixUnits(gear && gear.gem && gear.gem.id));
  }
  function addGear(id, ext, attr, attrPct) {
    if (!blackGearEnabled() && isBlackGearId(id)) return null;
    /* attr / attrPct 可以只给一个：给 attr（旧档、调试、融合产物）就反推百分比；
     * 都没给才重新掷 -5~+5 的整数百分比。 */
    let pct, rolled;
    if (attr == null && attrPct == null) {
      pct = rollGearAttrPct();
      rolled = gearAttrValueOf(id, pct);
    } else if (attr == null) {
      pct = gearAttrPctClamp(attrPct);
      rolled = gearAttrValueOf(id, pct);
    } else {
      rolled = integer(attr, 0, 0) || gearAttrValueOf(id, attrPct);
      pct = gearAttrPctOf(id, rolled, attrPct);
    }
    const info = gearInst(id, ext, rolled, pct);
    if (!info) return null;
    let key;
    do { key = 'g' + Date.now() + '_' + (gearKeySeq++); } while (S.gears.some((g) => g.key === key));
    S.gears.push({ id: info.id, used: false, key, ext: info.ext, attr: rolled, attrPct: pct });
    save();
    return Object.assign(info, { key, used: false });
  }
  /** 5 级更换装备教程的随机白装：只从 5 级可穿的白色装备里抽一件。
   *  必须落存档（`starterGearGiven`）：不然每次重开游戏第一次进换装页都会再送一件。 */
  function grantStarterGear() {
    if (!S || S.starterGearGiven === true) return null;
    const ids = [];
    gearMap.each((k, v) => {
      const id = parseInt(k, 10);
      const gi = gearInst(id);
      if (gi && Number(gi.quality) === 0 && Number(gi.useLevel) <= 5) ids.push(id);
    });
    if (!ids.length) return null;
    const id = ids[Math.floor(Math.random() * ids.length)];
    const gear = addGear(id, randomExtForQuality(0));
    if (!gear) return null;
    S.starterGearGiven = true;
    save();
    return gear;
  }

  // 原装备界面规则：同种附加能力不叠加，只取最高一条。
  function equipmentEffects() {
    const effects = {};
    for (const gear of S.gears) {
      if (!gear.used) continue;
      if (!blackGearEnabled() && isBlackGearId(gear.id)) continue;
      const info = gearInst(gear.id, gear.ext, gear.attr);
      if (!info || S.level < info.useLevel) continue;
      const units = gemAffixUnits(gear.gem && gear.gem.id);
      for (const ext of normalizeExt(gear.ext)) {
        const v = attachmentValue(ext.id, ext.level, units);
        effects[ext.id] = Math.max(effects[ext.id] || 0, Math.round(v.total));
      }
    }
    return effects;
  }

  function permanentStatTotal(source) {
    const s = object(source) ? source : S;
    if (!s) return 0;
    const num = (v) => Math.max(0, Number(v) || 0);
    return num(s.power) + num(s.agility) + num(s.speed) + num(s.maxHp) / 5;
  }
  /** 还差多少才到 651 硬上限（永远 >= 0）。 */
  function statCapRoom(source) {
    return Math.max(0, STAT_HARD_CAP - permanentStatTotal(source));
  }
  /** 把永久属性点/待分配点收口到 651。**所有写盘与读档路径都必须经过这里**：
   *  只要保存或重载就会被拉回上限。返回本次被收掉的点数（含待分配点）。
   *  超出时优先从数值最大的那一项扣（生命按 5 点=1 点折算），四项都保底 1 点/5 血。 */
  function clampPermanentStats(source) {
    const s = object(source) ? source : S;
    if (!s) return 0;
    let power = Math.max(1, integer(s.power, 1, 1));
    let agility = Math.max(1, integer(s.agility, 1, 1));
    let speed = Math.max(1, integer(s.speed, 1, 1));
    let hp = Math.max(5, integer(s.maxHp, 5, 5));
    /* 生命按 5 点一格收口；旧档/调试写入的零头不参与上限计算。 */
    let hpPoints = Math.floor(hp / 5);
    const used = () => power + agility + speed + hpPoints;
    let excess = used() - STAT_HARD_CAP;
    let removed = 0;
    let guard = 0;
    while (excess > 0 && guard++ < 4096) {
      const pools = [
        { key: 'power', get: () => power, set: (v) => { power = v; } },
        { key: 'agility', get: () => agility, set: (v) => { agility = v; } },
        { key: 'speed', get: () => speed, set: (v) => { speed = v; } },
        { key: 'hp', get: () => hpPoints, set: (v) => { hpPoints = v; } },
      ].sort((a, b) => b.get() - a.get());
      let progressed = false;
      for (const pool of pools) {
        const take = Math.min(excess, Math.max(0, pool.get() - 1));
        if (take <= 0) continue;
        pool.set(pool.get() - take);
        excess -= take;
        removed += take;
        progressed = true;
        if (excess <= 0) break;
      }
      if (!progressed) break;
    }
    s.power = power; s.agility = agility; s.speed = speed; s.maxHp = hpPoints * 5;
    if (Number(s.hp) > s.maxHp) s.hp = s.maxHp;
    const room = Math.max(0, STAT_HARD_CAP - used());
    const free = Math.max(0, integer(s.freePoints, 0));
    if (free > room) {
      s.freePoints = Math.floor(room);
      removed += free - Math.floor(room);
    } else s.freePoints = free;
    return removed;
  }
  function totalStats(opts) {
    opts = opts || {};
    clampPermanentStats();
    let power = S.power, agility = S.agility, speed = S.speed, hp = S.maxHp;
    for (const g of S.gears) {
      if (!g.used) continue;
      if (!blackGearEnabled() && isBlackGearId(g.id)) continue;
      const gi = gearInst(g.id, g.ext, g.attr);
      if (!gi || S.level < gi.useLevel) continue;
      let val = gi.abilityVal;
      if (g.gem) val = Math.round(val * (1 + gemPercent(gemLevel(g.gem.id)) / 100));   // 橙色/黑色装备宝石提升主属性（原版曲线）
      if (gi.type === 0) agility += val;
      else if (gi.type === 1) power += val;
      else if (gi.type === 2) hp += val;
      else speed += val;
    }
    /* 套装收益的**属性部分**（战斗修正部分在 applySetBonuses，开局写进 fighter.setFx）。
     * 只有「同一家族 ≥2 件」才生效，与装备主属性同一口径、一起被色诱之术脱掉。 */
    const setStats = setBonusEffects().stats;
    power += setStats.power; agility += setStats.agility; speed += setStats.speed; hp += setStats.hp;
    // 被动技能
    const sk = mySkills();
    const has = (id) => sk.find((x) => x.id === id);
    const effects = equipmentEffects();
    let t;
    if ((t = has(1))) power += GData.passiveBonus(1, t.level) * (1 + (effects[27] || 0) / 100);
    if ((t = has(2))) agility += GData.passiveBonus(2, t.level) * (1 + (effects[28] || 0) / 100);
    if ((t = has(3))) speed += GData.passiveBonus(3, t.level) * (1 + (effects[29] || 0) / 100);
    if ((t = has(4))) hp += GData.passiveBonus(4, t.level) * (1 + (effects[30] || 0) / 100);
    if (opts.useProps !== false) {
      const st = S.propsStates || {};
      if (st[3] > 0) power += Math.max(Math.floor(power * 0.2), 5);
      if (st[4] > 0) agility += Math.max(Math.floor(agility * 0.2), 5);
      if (st[5] > 0) speed += Math.max(Math.floor(speed * 0.2), 5);
      if (st[41] > 0) power += Math.max(Math.floor(power * 0.4), 10);
      if (st[42] > 0) agility += Math.max(Math.floor(agility * 0.4), 10);
      if (st[43] > 0) speed += Math.max(Math.floor(speed * 0.4), 10);
    }
    return { power: Math.round(power), agility: Math.round(agility), speed: Math.round(speed), hp: Math.round(hp) };
  }

  const SHOP_DAILY_PILLS = [3, 4, 5, 7];
  const SHOP_PILL_LIMIT = 3;
  const SHOP_DAILY_ENERGY = [1, 2];
  const SHOP_ENERGY_LIMIT = 3;
  // 商店每日限购的单独覆盖（行里最后一个字段是 useType，不是数量）。
  const SHOP_DAILY_LIMITS = { 39: 5 };
  function shopLimit(id) {
    const key = Number(id), prop = propMap.getValue(key);
    if (!prop) return 0;
    if (SHOP_DAILY_LIMITS[key] != null) return SHOP_DAILY_LIMITS[key];
    if (SHOP_DAILY_PILLS.includes(key)) return SHOP_PILL_LIMIT;
    if (SHOP_DAILY_ENERGY.includes(key)) return SHOP_ENERGY_LIMIT;
    return [13, 16, 17, 18, 19, 37, 38, 47, 48].includes(key) || /宝箱|魔法袋|礼包|永久/.test(prop.name) ? 1 : 5;
  }
  function syncShopPurchases() {
    const date = localDate();
    if (S.shopPurchaseDate === date && object(S.shopPurchases)) return;
    if ((S.shopPurchaseDate && S.shopPurchaseDate !== date) || !object(S.shopPurchases)) S.shopPurchases = {};
    S.shopPurchaseDate = date;
    save();
  }
  function purchaseStatus(id) {
    id = Number(id);
    syncShopPurchases();
    const prop = propMap.getValue(id), limit = shopLimit(id), bought = integer(S.shopPurchases[id], 0);
    const buyable = !!prop && prop.buy === 'true';
    return { date: S.shopPurchaseDate, limit, bought, remaining: buyable ? Math.max(0, limit - bought) : 0, buyable };
  }
  function buyProp(id, count) {
    id = Number(id);
    const p = propMap.getValue(id);
    if (!p || p.buy !== 'true') return { ok: false, msg: '该物品不出售' };
    if (id === 47 && Number(S.level) < 30) return { ok: false, levelLocked: true, msg: '需要达到30级后才可购买此道具！' };
    count = count == null ? 1 : Number(count);
    if (!Number.isSafeInteger(count) || count <= 0) return { ok: false, msg: '购买数量必须是正整数' };
    const status = purchaseStatus(id);
    if (count > status.remaining) return { ok: false, limited: true, msg: status.remaining ? `今日还可购买${status.remaining}个${p.name}` : `${p.name}今日已达限购${status.limit}个`, ...status };
    const cost = parseInt(p.price) * count;
    if (!Number.isSafeInteger(cost) || cost < 0) return { ok: false, msg: '商品价格无效' };
    if (!debugOn('freeShop')) {
      if (S.goldPoint < cost) return { ok: false, msg: '金松果不足！' };
      S.goldPoint -= cost;
    }
    S.props[id] = (S.props[id] || 0) + count;
    S.shopPurchases[id] = status.bought + count;
    bumpDaily('buy', count, true);   // 每日任务：在商店购买 N 件道具
    save();
    return { ok: true, msg: `购买了${p.name}x${count}`, ...purchaseStatus(id) };
  }
  /* 金宝箱/魔法袋：原版奖品由服务端下发，这里落等价权重表。金宝箱单箱最高 12 点基础属性
   * 开箱结果先挂 S.chestPending，点「确定领取」才入账；魔法袋不出属性点。 */
  const CHEST_REOPEN_MAX = 500;
  function chestReopenCost(count) {
    count = Math.max(0, Math.floor(Number(count) || 0));
    if (count >= CHEST_REOPEN_MAX) return 0;
    const k = Math.floor(count / 3);
    if (k === 0) return 50;
    if (k === 1) return 75;
    return 100 + (k - 2) * 50;
  }
  function rollBlackChestGear() {
    const roll = Math.random();
    let setId;
    if (roll < 0.10) setId = Math.random() < 0.5 ? 71 : 72;
    else if (roll < 0.40) setId = 46;   // 黑狂战
    else setId = 47;                    // 黑怒战
    const ids = [];
    gearMap.each((k, v) => { if (Number(v.setId) === setId) ids.push(Number(v.id)); });
    if (!ids.length) return null;
    const id = ids[Math.floor(Math.random() * ids.length)];
    const def = gearMap.getValue(id);
    return { kind: 'gear', id, count: 1, name: def ? def.name : '黑装' };
  }
  /** 只摇奖、不入账：重开要能丢掉上一份结果，所以奖励在 confirm 时才落袋。
   *  **完整黑装只在首开出**（2%）；重开池把这一档折成黑色卡片，避免用金松果把 20 个金宝箱
   *  逐个刷成完整黑装、绕开挑战塔/无尽塔的产出节奏。 */
  function rollChestReward(kind) {
    const r = Math.random();
    const prop = (id, count) => {
      const p = propMap.getValue(id);
      return { kind: 'prop', id, count, name: p ? p.name : '道具' };
    };
    if (kind === 'gold' || kind === 'gold-reopen') {
      /* 现代界面没有黑卡/完整黑装：原来那 10% 折进金松果，属性点档位与总概率不变。 */
      if (!blackGearEnabled()) {
        if (r < 0.04) return prop(106, 1);
        if (r < 0.14) return prop(105, 2);
        if (r < 0.26) return prop(105, 1);
        if (r < 0.51) return { kind: 'gold', count: 500 + Math.floor(Math.random() * 3) * 250, name: '金松果' };
        if (r < 0.54) return { kind: 'points', count: 12, name: '基础属性点' };
        if (r < 0.62) return { kind: 'points', count: 10, name: '基础属性点' };
        if (r < 0.76) return { kind: 'points', count: 8, name: '基础属性点' };
        return { kind: 'points', count: 6, name: '基础属性点' };
      }
      if (r < 0.04) return prop(106, 1);
      if (r < 0.14) return prop(105, 2);
      if (r < 0.26) return prop(105, 1);
      if (r < 0.41) return { kind: 'gold', count: 500 + Math.floor(Math.random() * 3) * 250, name: '金松果' };
      if (r < 0.49) return prop(80, 1);
      if (r < 0.51) return kind === 'gold' ? (rollBlackChestGear() || prop(80, 1)) : prop(80, 1);
      if (r < 0.54) return { kind: 'points', count: 12, name: '基础属性点' };
      if (r < 0.62) return { kind: 'points', count: 10, name: '基础属性点' };
      if (r < 0.76) return { kind: 'points', count: 8, name: '基础属性点' };
      return { kind: 'points', count: 6, name: '基础属性点' };
    }
    if (r < 0.03) return prop(106, 1);
    if (r < 0.18) return prop(105, 1);
    if (r < 0.33) return prop(26, 5 + Math.floor(Math.random() * 6));
    if (r < 0.50) return prop(82, 1 + Math.floor(Math.random() * 2));
    if (r < 0.75) return { kind: 'gold', count: 300 + Math.floor(Math.random() * 5) * 50, name: '金松果' };
    return { kind: 'hatch', count: 100, name: '孵化点' };
  }
  /** 把一份已经确定的开箱奖励真正入账（点「确定领取」/ 读档自动结算时调用）。 */
  function grantChestReward(reward) {
    if (!reward || !(Number(reward.count) > 0)) return false;
    if (reward.kind === 'prop') {
      const id = Number(reward.id);
      if (!propMap.getValue(id)) return false;
      S.props[id] = (S.props[id] || 0) + Number(reward.count);
    } else if (reward.kind === 'points') {
      /* 651 硬上限：只把还有空间的部分放进待分配，超出部分直接丢弃。
       * 正常 90 级总账正好 651，最后一只箱子仍有 12 点空间；只有调试/旧档超额时才会走到这里。 */
      const room = Math.max(0, Math.floor(statCapRoom()));
      S.freePoints = pendingPoints() + Math.min(room, Math.max(0, Math.floor(Number(reward.count) || 0)));
    } else if (reward.kind === 'gold') {
      addGold(Number(reward.count));
    } else if (reward.kind === 'hatch') {
      S.hatchPoint = (S.hatchPoint || 0) + Number(reward.count);
    } else if (reward.kind === 'gear') {
      if (!blackGearEnabled() && isBlackGearId(reward.id)) return false;
      if (!addGear(Number(reward.id), randomExtForQuality(5))) return false;
    } else return false;
    return true;
  }
  function chestState() { return S && S.chestPending ? clone(S.chestPending) : null; }
  /** 开一个金宝箱：消耗 1 个，结果挂在 `S.chestPending`（可重开，确认才入账）。 */
  function beginChest(id) {
    id = Number(id) || 90;
    if (id !== 90) return { ok: false, msg: '只有金宝箱可以重开' };
    if (S.chestPending) return { ok: false, msg: '还有未领取的开箱结果，请先领取' };
    if ((S.props[90] || 0) <= 0) return { ok: false, msg: '没有金宝箱' };
    S.props[90]--;
    if (S.props[90] <= 0) delete S.props[90];
    S.chestPending = { propId: 90, reward: rollChestReward('gold'), lotteryCount: 0 };
    save();
    return { ok: true, pending: chestState(), msg: '打开金宝箱：' + S.chestPending.reward.name + ' ×' + S.chestPending.reward.count };
  }
  function confirmChest() {
    const p = S.chestPending;
    if (!p) return { ok: false, msg: '没有待领取的开箱结果' };
    const reward = p.reward;
    const roomBefore = reward.kind === 'points' ? Math.max(0, Math.floor(statCapRoom())) : null;
    if (!grantChestReward(reward)) return { ok: false, msg: '开箱奖励无效' };
    delete S.chestPending;
    save();
    const capped = roomBefore != null && roomBefore < Number(reward.count);
    return { ok: true, reward,
      msg: '领取' + reward.name + ' ×' + reward.count +
        (capped ? '（属性点已达硬上限 ' + STAT_HARD_CAP + '，超出部分未入账）' : '') };
  }
  /** 进游戏时把上次「已开出、没点领取」的结果直接入账，避免箱子消耗了奖励却丢掉。 */
  function settlePendingChest(opts) {
    if (!S || !S.chestPending) return false;
    const ok = grantChestReward(S.chestPending.reward);
    delete S.chestPending;
    if (!(opts && opts.save === false)) save();
    return ok;
  }
  function reopenChest() {
    const p = S.chestPending;
    if (!p) return { ok: false, msg: '没有可以重开的金宝箱' };
    if (p.lotteryCount >= CHEST_REOPEN_MAX) return { ok: false, msg: '重开已达' + CHEST_REOPEN_MAX + '次上限' };
    const cost = chestReopenCost(p.lotteryCount);
    if (S.goldPoint < cost) return { ok: false, msg: '金松果不足，重开需要' + cost + '金松果' };
    S.goldPoint -= cost;
    p.lotteryCount += 1;
    p.reward = rollChestReward('gold-reopen');
    save();
    return { ok: true, cost, pending: chestState(), msg: '重开：' + p.reward.name + ' ×' + p.reward.count };
  }
  function openChestProp(id) {
    id = Number(id);
    if (id === 79) {
      if ((S.props[79] || 0) <= 0) return { ok: false, msg: '没有该道具' };
      S.props[79]--;
      if (S.props[79] <= 0) delete S.props[79];
      const reward = rollChestReward('magic');
      grantChestReward(reward);
      const card = blackGearEnabled() ? 1 : 0;
      if (card) S.props[80] = (S.props[80] || 0) + card;
      save();
      return {
        ok: true, id, reward, card,
        msg: '打开魔法袋：' + reward.name + ' ×' + reward.count + (card ? '；额外获得黑色卡片 ×1' : ''),
      };
    }
    if (id !== 90) return { ok: false, msg: '不是可开启的宝箱' };
    if (S.chestPending) return { ok: false, msg: '还有未领取的开箱结果，请先领取' };
    const begin = beginChest(90);
    if (!begin.ok) return begin;
    return confirmChest();
  }


  function blackCardOptions() {
    if (!blackGearEnabled()) return [];
    return [
      { setId: 71, name: '凤凰', shardId: 77 },
      { setId: 72, name: '圣熊', shardId: 78 },
    ];
  }
  /** 只结算奖励，不消耗卡片（消耗统一由 useProp 末尾处理）。 */
  function applyBlackCard(setId) {
    if (!blackGearEnabled()) return { ok: false, msg: '现代界面没有黑装内容' };
    const set = Number(setId);
    if (![71, 72].includes(set)) return { ok: false, msg: '请选择凤凰或圣熊' };
    const shardId = set === 71 ? 77 : 78;
    const shards = Math.random() < 0.7 ? 1 : 2;
    const roll = Math.random();
    const gold = roll < 0.5 ? 100 : roll < 0.85 ? 200 : 400;
    S.props[shardId] = (S.props[shardId] || 0) + shards;
    addGold(gold);
    const def = propMap.getValue(shardId);
    return {
      ok: true, setId: set, shardId, shards, gold,
      msg: '打开黑色卡片：' + (def ? def.name : '黑装碎片') + ' ×' + shards + '，金松果 +' + gold,
    };
  }
  function blackGearBoxOptions() {
    if (!blackGearEnabled()) return [];
    const out = [];
    for (const setId of [71, 72]) {
      gearMap.each((k, v) => {
        if (Number(v.setId) !== setId) return;
        out.push({ id: Number(v.id), name: v.name, type: Number(v.type), setId });
      });
    }
    return out.sort((a, b) => (a.setId - b.setId) || (a.type - b.type));
  }
  function applyBlackGearBox(gearId) {
    if (!blackGearEnabled()) return { ok: false, msg: '现代界面没有黑装内容' };
    const id = Number(gearId);
    const hit = blackGearBoxOptions().find((o) => o.id === id);
    if (!hit) return { ok: false, msg: '请选择一件凤凰或圣熊装备' };
    const g = addGear(id, randomExtForQuality(5));
    if (!g) return { ok: false, msg: '黑装数据缺失' };
    return { ok: true, gear: g, msg: '获得' + g.name };
  }

  const ENDLESS_BLACK_CARD_CAP = 10;
  /** 本周周一的本地日期键（与天梯商店的按周刷新同一口径）。 */
  function blackCardWeekKey() {
    const d = new Date(Date.now());
    const day = (d.getDay() + 6) % 7;   // 周一 = 0
    d.setDate(d.getDate() - day);
    return dateKey(d);
  }
  function syncBlackCardsWeek() {
    const week = blackCardWeekKey();
    if (!object(S.blackCardsWeek)) S.blackCardsWeek = { week, count: 0 };
    if (S.blackCardsWeek.week !== week) S.blackCardsWeek = { week, count: 0 };
    S.blackCardsWeek.count = Math.max(0, Math.min(ENDLESS_BLACK_CARD_CAP, integer(S.blackCardsWeek.count, 0)));
    return S.blackCardsWeek;
  }
  function endlessBlackCardLeft() {
    syncBlackCardsWeek();
    return Math.max(0, ENDLESS_BLACK_CARD_CAP - S.blackCardsWeek.count);
  }
  /** 无尽塔层结算发黑卡：返回 { gain, left, cap }，到周限就 gain=0。 */
  function grantEndlessBlackCard(n) {
    if (!blackGearEnabled()) return { gain: 0, left: 0, cap: ENDLESS_BLACK_CARD_CAP, week: blackCardWeekKey() };
    syncBlackCardsWeek();
    const left = endlessBlackCardLeft();
    const gain = Math.min(left, Math.max(0, Math.floor(Number(n) || 0)));
    if (gain > 0) {
      S.blackCardsWeek.count += gain;
      S.props[80] = (S.props[80] || 0) + gain;
      save();
    }
    return { gain, left: left - gain, cap: ENDLESS_BLACK_CARD_CAP, week: S.blackCardsWeek.week };
  }

  function useProp(id, param) {
    id = parseInt(id);
    if (!blackGearEnabled() && isBlackPropId(id)) return { ok: false, msg: '现代界面没有黑装内容' };
    const p = propMap.getValue(id);
    if (!p) return { ok: false, msg: '没有该道具' };
    /* 宝箱先走自己的入口：金宝箱可能「箱子已消耗、结果待领取」（S.chestPending），
     * 这时背包里数量是 0，不能按普通道具直接判成「没有该道具」。 */
    if (id === 79 || id === 90) return openChestProp(id);
    if ((S.props[id] || 0) <= 0) return { ok: false, msg: '没有该道具' };
    /* 永久属性类道具：先看 651 硬上限，避免「道具已经扣了、点却没加上」。
     * 转化丸（10~12）只搬运三项之间的点数，不增加总额，不受此限。 */
    if (id >= 16 && id <= 19 && Math.floor(statCapRoom()) < 1) {
      return { ok: false, msg: '永久属性点已达硬上限 ' + STAT_HARD_CAP + ' 点' };
    }
    if (id === 37 && Math.floor(statCapRoom()) < 8) {
      return { ok: false, msg: '属性书需要 8 点空间，当前只剩 ' + Math.floor(statCapRoom()) + ' 点（硬上限 ' + STAT_HARD_CAP + '）' };
    }
    let msg = '使用成功';
    switch (id) {
      case 1: case 2: {
        tickEnergy();
        if (S.energy >= ENERGY_HARD_CAP) return { ok: false, msg: '体力已达上限 ' + ENERGY_HARD_CAP + ' 点' };
        const per = id === 1 ? 10 : 30;
        const restored = Math.min(per, ENERGY_HARD_CAP - S.energy);
        S.energy += restored;
        if (S.energy >= S.maxEnergy) S.lastEnergyTs = Date.now();
        msg = '恢复体力' + restored + '点（' + S.energy + '/' + S.maxEnergy + '）';
        break;
      }
      case 3: case 4: case 5: case 7: case 41: case 42: case 43: case 44:
        S.propsStates[id] = 20; msg = p.name + '生效，持续20次战斗'; break;
      case 10: case 11: case 12: { // 转化丸
        const from = id === 10 ? 'power' : id === 11 ? 'agility' : 'speed';
        const total = S.power + S.agility + S.speed;
        if (S[from] < total * 0.25) return { ok: false, msg: '该属性占比过低，不能使用' };
        const to = param === 'power' || param === 'agility' || param === 'speed' ? param : (['power', 'agility', 'speed'].filter((x) => x !== from))[Math.floor(Math.random() * 2)];
        if (to === from) return { ok: false, msg: '请选择另一种属性' };
        S[from]--;
        S[to]++;
        msg = '属性转换成功';
        break;
      }
      case 13: { // 转生果
        if (S.level >= 50) return { ok: false, msg: '达到50级后不能转生' };
        S.level = 1; S.exp = 0; Object.assign(S, GData.initialStats());
        /* 自由属性点必须一起清掉：转生可以在 50 级以下反复用，若把没点完的自由点留下，
         * 那 29 点要按记录重新加回去（否则会凭空少一截）。
         * 金宝箱已发数量 `levelChests` 同样不重置 —— 71~90 每级 1 个是账号累计上限。 */
        S.freePoints = 0; S.pointUndo = [];
        const mir = miracleRecord();
        S.power += mir.power; S.agility += mir.agility; S.speed += mir.speed; S.maxHp += mir.hp;
        S.weapons = []; S.skills = []; S.reborn++;
        for (const gear of S.gears) gear.used = false;
        msg = '转生成功！回到1级，装备保留';
        break;
      }
      case 16: S.power++; msg = '力量永久+1'; break;
      case 17: S.agility++; msg = '敏捷永久+1'; break;
      case 18: S.speed++; msg = '速度永久+1'; break;
      case 19: S.maxHp += 5; msg = '生命永久+5'; break;
      case 37: { // 属性书：8点自由分配，不替玩家自动选择。
        const attrs = ['power', 'agility', 'speed'];
        if (!object(param) || attrs.some(attr => !Number.isSafeInteger(param[attr]) || param[attr] < 0) || attrs.reduce((sum, attr) => sum + param[attr], 0) !== 8) {
          return { ok: false, needsAllocation: true, msg: '请将8点属性分配到力量、敏捷和速度' };
        }
        for (const attr of attrs) S[attr] += param[attr];
        msg = `力量+${param.power} 敏捷+${param.agility} 速度+${param.speed}`;
        break;
      }
      case 38: { const g = 20 + Math.floor(Math.random() * 80); addGold(g); msg = `打开红包，获得${g}金松果！`; break; }
      case 47:   // 天使果实：随机 1 个可学武技（确定=学会，取消也消耗）
      case 48: { // 恶魔果实：随机 1 个已拥有武技（确定=遗忘，取消也消耗）
        /* 已经抽出的结果必须原样复用：弹窗有取消键，但大退 / 重开背包不能重抽。 */
        const pending = S.fruitChoices && S.fruitChoices[id];
        if (pending && Array.isArray(pending.options) && pending.options.length) {
          return { ok: false, needsFruitChoice: true, fruit: id, mode: pending.mode, options: pending.options, msg: '请确认这次随机结果' };
        }
        const fruit = fruitOptions(id);
        if (!fruit) {
          return { ok: false, msg: id === 47 ? '获得失败：可能已达上限或没有可学的武技' : '没有可以遗忘的武器或技能' };
        }
        if (!object(S.fruitChoices)) S.fruitChoices = {};
        S.fruitChoices[id] = { mode: fruit.mode, options: fruit.options, at: Date.now() };
        save();
        return { ok: false, needsFruitChoice: true, fruit: id, mode: fruit.mode, options: fruit.options, msg: '请确认这次随机结果' };
      }
      case 28: case 29: case 30: case 31: case 32: case 49: { // 礼包
        const gift = giftMap.getValue(id);
        if (!gift) return { ok: false, msg: '礼包数据缺失' };
        if (S.level < parseInt(gift.level)) return { ok: false, msg: `需要${gift.level}级才能打开` };
        const boosted = GData.giftPackPrize ? GData.giftPackPrize(id) : null;
        const prizes = boosted || gift.prize.split('|').map((item) => {
          const [pid, num] = item.split(':').map(Number);
          return { id: pid, count: num };
        });
        const got = [];
        for (const { id: pid, count: num } of prizes) {
          if (pid === 8) { addGold(num); got.push(`金松果x${num}`); }
          else { S.props[pid] = (S.props[pid] || 0) + num; const pp = propMap.getValue(pid); got.push((pp ? pp.name : pid) + 'x' + num); }
        }
        msg = '获得：' + got.join('、');
        break;
      }
      case 80: { // 黑色卡片：选凤凰/圣熊 → 1~2 碎片 + 100/200/400 金松果
        const raw = String(param == null ? '' : param);
        let set = 0;
        if (raw === 'random') set = Math.random() < 0.5 ? 71 : 72;
        else if (raw === '71' || raw === '72') set = Number(raw);
        if (!set) return { ok: false, needsBlackChoice: true, options: blackCardOptions(), msg: '请选择凤凰或圣熊' };
        const card = applyBlackCard(set);
        if (!card.ok) return card;
        msg = card.msg;
        break;
      }
      case 89: { // 黑装自选箱：任选 1 件凤凰/圣熊（4 部位）
        const raw = String(param == null ? '' : param);
        if (!/^\d+$/.test(raw)) {
          return { ok: false, needsBlackGearChoice: true, options: blackGearBoxOptions(), msg: '请选择一件黑装' };
        }
        const box = applyBlackGearBox(Number(raw));
        if (!box.ok) return box;
        msg = box.msg;
        break;
      }
      default:
        return { ok: false, msg: '该道具不能直接使用' };
    }
    S.props[id]--;
    if (S.props[id] <= 0) delete S.props[id];
    bumpDaily('use', 1, true);   // 每日任务：使用 N 个道具
    save();
    return { ok: true, msg };
  }
  // 天使果实/升级：随机获得新武器或技能
  function gainRandomWS() {
    const pick = wsPool();
    if (!pick.length) return null;
    return grantWS(pick[Math.floor(Math.random() * pick.length)]);
  }
  /** 还能学、且没拥有的武器/技能池（'w3'/'s7' 这种编码）。 */
  function wsPool() {
    if (!S) return [];
    const ownedW = S.weapons.map((w) => parseInt(w.split(':')[0]));
    const ownedS = S.skills.map((s) => parseInt(s.split(':')[0]));
    if (ownedWSCount() >= wsLimit()) return [];
    const pool = [];
    weaponsMap.each((k, v) => { if (!ownedW.includes(parseInt(v.id)) && GData.canLearn('weapon', v.id, S.level)) pool.push('w' + v.id); });
    skillsMap.each((k, v) => { if (!ownedS.includes(parseInt(v.id)) && GData.canLearn('skill', v.id, S.level)) pool.push('s' + v.id); });
    return pool;
  }
  function wsInfo(code) {
    const kind = String(code)[0] === 'w' ? 'weapon' : 'skill';
    const id = Number(String(code).slice(1));
    const def = (kind === 'weapon' ? weaponsMap : skillsMap).getValue(id);
    return def ? { kind, id, name: def.name, remark: def.remark || '', type: def.type || '' } : null;
  }
  function grantWS(code) {
    const info = wsInfo(code);
    if (!info) return null;
    S[info.kind === 'weapon' ? 'weapons' : 'skills'].push(info.id + ':1');
    return info;
  }
  // 升级奖励三选一：从还能学的池子抽最多 n 个不重复；池空返回空数组，调用方据此不发奖励。
  function wsChoices(n) {
    const pool = wsPool();
    const want = Math.min(Math.max(1, integer(n, 3, 1)), pool.length);
    const picked = [];
    while (picked.length < want && pool.length) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return picked.map(wsInfo).filter(Boolean);
  }
  /* 果实：天使从「还能学」的池子抽 1 个并学会，恶魔从已拥有里抽 1 个遗忘（不可撤销）。
   * 取消弹窗照样消耗果实，但记进 fruitSeen，下一轮先给没出现过的；候选只回传，
   * 真正改动在 applyFruitChoice / cancelFruitChoice。 */
  function fruitCode(kind, id) { return (kind === 'weapon' ? 'w' : 's') + Number(id); }
  function fruitSeen(id) {
    if (!object(S.fruitSeen)) S.fruitSeen = {};
    if (!Array.isArray(S.fruitSeen[id])) S.fruitSeen[id] = [];
    return S.fruitSeen[id];
  }
  /** 果实的可抽池子（编码）：天使=还能学的，恶魔=已拥有的武器/技能。 */
  function fruitPool(id) {
    if (id === 47) return wsPool();
    return [
      ...S.weapons.map((w) => 'w' + parseInt(w, 10)),
      ...S.skills.map((s) => 's' + parseInt(s, 10)),
    ];
  }
  function fruitRoll(id, pool) {
    let seen = fruitSeen(id).filter((code) => pool.indexOf(code) >= 0);
    let rest = pool.filter((code) => seen.indexOf(code) < 0);
    if (!rest.length) { seen = []; rest = pool.slice(); }
    S.fruitSeen[id] = seen;
    const code = rest[Math.floor(Math.random() * rest.length)];
    return code ? wsInfo(code) : null;
  }
  /** 这一次的果实结果（只有 1 个候选）；条件不满足（武技已满 / 只剩一个）时返回 null。 */
  function fruitOptions(id) {
    id = Number(id);
    if (id === 47) {
      const pool = fruitPool(47);
      if (!pool.length) return null;
      const info = fruitRoll(47, pool);
      return info ? { mode: 'gain', options: [info] } : null;
    }
    if (id === 48) {
      if (S.weapons.length + S.skills.length <= 1) return null;
      const info = fruitRoll(48, fruitPool(48));
      return info ? { mode: 'lose', options: [info] } : null;
    }
    return null;
  }
  function applyFruitChoice(id, kind, targetId) {
    id = Number(id); targetId = Number(targetId);
    kind = kind === 'weapon' ? 'weapon' : 'skill';
    if (!(S.props[id] > 0)) return { ok: false, msg: '没有这个果实' };
    const pending = (S.fruitChoices && S.fruitChoices[id]) || (S.__onlineFruitChoices && S.__onlineFruitChoices[id]);
    if (pending && Array.isArray(pending.options)
      && !pending.options.some((c) => c && c.kind === kind && Number(c.id) === targetId)) {
      return { ok: false, msg: '请选择这次抽出的候选' };
    }
    const label = kind === 'weapon' ? '武器' : '技能';
    if (id === 47) {
      const info = grantWS((kind === 'weapon' ? 'w' : 's') + targetId);
      if (!info) return { ok: false, msg: '这个' + label + '暂时学不了' };
      S.props[id]--; if (S.props[id] <= 0) delete S.props[id];
      if (S.fruitChoices) delete S.fruitChoices[id];
      bumpDaily('use', 1, true);
      save();
      return { ok: true, msg: '获得了 ' + info.name + '！' };
    }
    if (id === 48) {
      const arr = kind === 'weapon' ? S.weapons : S.skills;
      const idx = arr.findIndex((x) => parseInt(x.split(':')[0]) === targetId);
      if (idx < 0) return { ok: false, msg: '没有这个' + label };
      // 忘掉之后至少要留一件，否则玩家会变成赤手空拳
      if (S.weapons.length + S.skills.length <= 1) return { ok: false, msg: '至少要留下一个武器或技能' };
      const info = wsInfo((kind === 'weapon' ? 'w' : 's') + targetId);
      arr.splice(idx, 1);
      if (typeof debugForgetWS === 'function') debugForgetWS(kind, targetId);
      S.props[id]--; if (S.props[id] <= 0) delete S.props[id];
      if (S.fruitChoices) delete S.fruitChoices[id];
      bumpDaily('use', 1, true);
      save();
      return { ok: true, msg: '遗忘了 ' + ((info && info.name) || label) };
    }
    return { ok: false, msg: '这个道具不能这样用' };
  }
  function cancelFruitChoice(id) {
    id = Number(id);
    if (!(S.props[id] > 0)) return { ok: false, msg: '没有这个果实' };
    const pending = (S.fruitChoices && S.fruitChoices[id]) || (S.__onlineFruitChoices && S.__onlineFruitChoices[id]);
    const c = object(pending) && Array.isArray(pending.options) ? pending.options[0] : null;
    if (!object(c) || (c.kind !== 'weapon' && c.kind !== 'skill')) {
      return { ok: false, msg: '这次随机结果已经结算过了' };
    }
    const seen = fruitSeen(id);
    const code = fruitCode(c.kind, c.id);
    if (seen.indexOf(code) < 0) seen.push(code);
    S.props[id]--; if (S.props[id] <= 0) delete S.props[id];
    if (object(S.fruitChoices) && S.fruitChoices[id]) delete S.fruitChoices[id];
    if (object(S.__onlineFruitChoices) && S.__onlineFruitChoices[id]) {
      /* 换一份对象再删：runOnSave 用旧档嵌套对象算 diff，原地删会让服务端漏发这次改动。 */
      S.__onlineFruitChoices = Object.assign({}, S.__onlineFruitChoices);
      delete S.__onlineFruitChoices[id];
    }
    bumpDaily('use', 1, true);
    save();
    return { ok: true, msg: '已取消：这次不' + (c.kind === 'weapon' ? '获得 ' : '遗忘 ') + (c.name || '这个武技') + '（果实已消耗）' };
  }
  /** 还没选的「三选一」：升级发下来就必须选掉（和自由属性点一样，只是会排队）。 */
  function pendingWS() { return S && Array.isArray(S.wsPicks) ? S.wsPicks.length : 0; }
  function pendingFruitChoices() {
    if (!S) return [];
    const map = {};
    if (object(S.fruitChoices)) Object.assign(map, S.fruitChoices);
    if (object(S.__onlineFruitChoices)) Object.assign(map, S.__onlineFruitChoices);
    const out = [];
    for (const id of [47, 48]) {
      const p = map[id];
      if (!object(p) || !Array.isArray(p.options) || !p.options.length) continue;
      out.push({ fruit: id, mode: p.mode === 'lose' ? 'lose' : 'gain', options: p.options });
    }
    return out;
  }
  function supportPromptPending() { return !!(S && S.supportPrompt) && !(S && S.supportPromptShown); }
  /** 取一次提示权（原子）：真待提示时立刻记「已提示」并返回 true，否则 false。 */
  function supportPromptTake() {
    if (!supportPromptPending()) return false;
    S.supportPromptShown = true;
    save();
    return true;
  }
  function supportPromptReset() {
    if (!S) return false;
    S.supportPrompt = true;
    S.supportPromptShown = false;
    save();
    return true;
  }
  const SUPPORT_LEVEL = SUPPORT_PROMPT_LEVEL;
  function currentWSChoices() { return pendingWS() ? (S.wsPicks[0] || []) : []; }
  function chooseWS(kind, id) {
    if (!S || !pendingWS()) return { ok: false, msg: '没有待选的武器/技能' };
    const list = S.wsPicks[0] || [];
    const hit = list.find((c) => c && c.kind === kind && Number(c.id) === Number(id));
    if (!hit) return { ok: false, msg: '这一组里没有这个选项' };
    const info = grantWS((kind === 'weapon' ? 'w' : 's') + Number(id));
    if (!info) return { ok: false, msg: '这个武器/技能暂时学不了' };
    S.wsPicks.shift();
    save();
    return { ok: true, kind: info.kind, id: info.id, name: info.name, remaining: pendingWS() };
  }
  function chooseWSRandom() {
    const got = [];
    if (!S || !pendingWS()) return { ok: true, got, remaining: 0 };
    let guard = 0;
    while (pendingWS() && guard++ < 200) {
      const list = S.wsPicks[0] || [];
      const pool = list.filter((c) => c && c.kind && !ownsWS(c.kind, c.id));
      if (!pool.length) { S.wsPicks.shift(); continue; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const r = chooseWS(pick.kind, pick.id);
      if (!r.ok) { S.wsPicks.shift(); continue; }
      got.push(r.name);
    }
    save();
    return { ok: true, got, remaining: pendingWS() };
  }
  function ownsWS(kind, id) {
    if (!S) return false;
    const key = Number(id) + ':';
    const list = kind === 'weapon' ? S.weapons : S.skills;
    return list.some((x) => String(x).indexOf(key) === 0);
  }

  function statPoints(source, key) {
    const s = object(source) ? source : S;
    const raw = Math.max(0, Number(s && s[STAT_FIELDS[key]]) || 0);
    return key === 'hp' ? raw / HP_PER_STAT : raw;
  }
  function statShares(source) {
    const s = object(source) ? source : S;
    let total = 0;
    const raw = {};
    for (const key of SHARE_KEYS) {
      raw[key] = Math.max(0, Number(s && s[STAT_FIELDS[key]]) || 0);
      total += raw[key];
    }
    const out = {};
    for (const key of SHARE_KEYS) out[key] = total > 0 ? raw[key] / total : 1 / SHARE_KEYS.length;
    return out;
  }
  /** 占比低于 25% 的力/敏/速里最低的那一项；三项都达标时返回 null。 */
  function forcedStat(source) {
    const shares = statShares(source);
    const low = SHARE_KEYS.filter((key) => shares[key] < STAT_SHARE_MIN - 1e-9);
    if (!low.length) return null;
    return low.reduce((a, b) => (shares[b] < shares[a] ? b : a));
  }
  function lowestStat(source) {
    const vals = {};
    for (const key of STAT_KEYS) vals[key] = statPoints(source, key);
    return STAT_KEYS.reduce((a, b) => (vals[b] < vals[a] ? b : a));
  }
  function grantPoint(target) {
    if (!S || !STAT_KEYS.includes(target)) return false;
    if (Math.floor(statCapRoom()) < 1) return false; // 651 点硬上限
    S[STAT_FIELDS[target]] += STAT_GAIN[target];
    return true;
  }
  function pendingPoints() { return Math.max(0, integer(S && S.freePoints, 0)); }
  /**
   * 力/敏/速占比低于 25% 时必须优先补：requested 不是它时系统直接代选，
   * 返回值里 redirected=true 供界面提示，规则不靠界面自觉。生命不参与三项占比。
   */
  function allocatePoint(attr) {
    if (pendingPoints() <= 0) return { ok: false, msg: '没有待分配的自由属性点' };
    if (!STAT_KEYS.includes(attr)) return { ok: false, msg: '自由属性点只能加到力量、敏捷、速度或生命' };
    const forced = forcedStat();
    const target = forced || attr;
    if (!grantPoint(target)) return { ok: false, msg: '永久属性点已达硬上限 ' + STAT_HARD_CAP + ' 点' };
    S.freePoints = pendingPoints() - 1;
    if (!Array.isArray(S.pointUndo)) S.pointUndo = [];
    S.pointUndo.push(target);
    save();
    return {
      ok: true, attr: target, requested: attr, gain: STAT_GAIN[target],
      forced: !!forced, redirected: !!forced && forced !== attr,
      remaining: S.freePoints,
      msg: forced === attr && forced
        ? STAT_NAMES[target] + '占比过低，这一点已加到' + STAT_NAMES[target]
        : forced
          ? STAT_NAMES[target] + '占比过低，系统自动分配到' + STAT_NAMES[target]
          : STAT_NAMES[target] + ' +' + STAT_GAIN[target],
    };
  }
  /**
   * 只回退「通过弹窗分配」的点（S.pointUndo 记着顺序），所以不会把成长得来的属性退掉。
   */
  function undoPoint() {
    if (!Array.isArray(S.pointUndo) || !S.pointUndo.length) return { ok: false, msg: '没有可以撤回的分配' };
    const attr = S.pointUndo.pop();
    if (!STAT_KEYS.includes(attr)) return { ok: false, msg: '撤回记录已失效' };
    S[STAT_FIELDS[attr]] = Math.max(1, S[STAT_FIELDS[attr]] - STAT_GAIN[attr]);
    if (attr === 'hp') S.hp = Math.min(S.hp, S.maxHp);
    S.freePoints = pendingPoints() + 1;
    save();
    return { ok: true, attr, gain: STAT_GAIN[attr], remaining: S.freePoints,
      msg: '已撤回：' + STAT_NAMES[attr] + ' −' + STAT_GAIN[attr] };
  }
  /** 还有几次可以撤回（界面用它决定按钮是否可用）。 */
  function undoDepth() { return Array.isArray(S.pointUndo) ? S.pointUndo.length : 0; }
  function allocateEvenly() {
    const added = { power: 0, agility: 0, speed: 0, hp: 0 };
    let guard = 0;
    while (pendingPoints() > 0 && guard++ < 10000) {
      const r = allocatePoint(lowestStat());
      if (!r.ok) break;
      added[r.attr]++;
    }
    return { ok: true, added, remaining: pendingPoints() };
  }

  /* 记下「今天」自己赚到多少经验与金松果，徒弟日供按**昨天**这条流水结算。
   * 经验只有 gainExp 一个入口、金松果统一走 addGold()，所以两个钩子就能覆盖全部真实收益；
   * 退款、读档恢复与调试发放用 addGold(n,{count:false}) 明确排除，不算进收益。 */
  const EARN_DAYS = 7;
  function trackEarn(kind, n) {
    n = Math.round(Number(n) || 0);
    if (!S || n <= 0) return;
    if (!Array.isArray(S.earnHistory)) S.earnHistory = [];
    const date = localDate();
    let row = S.earnHistory.find((d) => object(d) && d.date === date);
    if (!row) {
      row = { date, exp: 0, gold: 0 };
      S.earnHistory.push(row);
      S.earnHistory = S.earnHistory.slice(-EARN_DAYS);
    }
    row[kind] = Math.max(0, integer(row[kind], 0) + n);
  }
  function earnOn(date) {
    const row = (Array.isArray(S.earnHistory) ? S.earnHistory : []).find((d) => object(d) && d.date === date);
    return { exp: row ? Math.max(0, integer(row.exp, 0)) : 0, gold: row ? Math.max(0, integer(row.gold, 0)) : 0 };
  }
  /** 【2026-10 用户口径】调试台「重置每日与体力计时」专用：把日供的**第二道门**也放开 ——
   *  · 今天也没有收益（`today.exp/gold` 都是 0）→ 什么都不做（没有东西可结算，不凭空造收益）；
   *  · 昨天已经有非 0 记录 → 原样保留（不覆盖真实流水）；
   *  · 只服务调试台，不入正式玩法流程（正式玩法由真实日期推进时自然产生流水）。 */
  function ensureYesterdayEarnings() {
    if (!S) return { seeded: false };
    const y = yesterdayDate(), t = localDate();
    const mine = earnOn(t);
    if (!(mine.exp > 0 || mine.gold > 0)) return { seeded: false };
    const prev = (Array.isArray(S.earnHistory) ? S.earnHistory : []).find((d) => object(d) && d.date === y);
    const cur = prev ? { exp: Math.max(0, integer(prev.exp, 0)), gold: Math.max(0, integer(prev.gold, 0)) } : null;
    if (cur && (cur.exp > 0 || cur.gold > 0)) return { seeded: false };
    if (!Array.isArray(S.earnHistory)) S.earnHistory = [];
    if (prev) { prev.exp = mine.exp; prev.gold = mine.gold; }
    else S.earnHistory.push({ date: y, exp: mine.exp, gold: mine.gold });
    S.earnHistory = S.earnHistory.slice(-EARN_DAYS);
    return { seeded: true, date: y, exp: mine.exp, gold: mine.gold };
  }
  function addGold(n, opts) {
    n = Math.round(Number(n) || 0);
    if (!S || !n) return 0;
    S.goldPoint += n;
    if (n > 0 && !(opts && opts.count === false)) trackEarn('gold', n);
    return n;
  }

  // 代价是金宝箱单箱上限压到 12 点（总账与原版一致）。
  function gainExp(amount, opts) {
    const ups = [];
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= 0) return ups;
    const gained = Math.round(amount);
    S.exp += gained;
    if (!(opts && opts.noTrack)) trackEarn('exp', gained);
    while (S.level < MAX_PLAYER_LEVEL && S.exp >= GData.nextExp(S.level)) {
      S.exp -= GData.nextExp(S.level);
      S.level++;
      /* 到 30 级：埋一个一次性的「自愿支持作者」提示（界面在升级奖励处理完之后才弹，
       * 不会打断三选一 / 属性点流程；见 classic-ui 的 maybeSupportPrompt）。 */
      if (S.level >= SUPPORT_PROMPT_LEVEL) S.supportPrompt = true;
        /* 1~90 级统一成长：2 点随机 + 1 点系统分配 + 5 生命。原版 71~90 不再加属性，
       * 本版保留成长手感，代价是金宝箱单箱上限从 16 压到 12（总账仍 651）。 */
      const growth = { power: 0, agility: 0, speed: 0, hp: 5 };
      for (let point = 0; point < FREE_POINT_RANDOM; point++) {
        const attr = ['power', 'agility', 'speed', 'hp'][Math.floor(Math.random() * 4)];
        growth[attr] += attr === 'hp' ? 5 : 1;
      }
      const { power: pw, agility: ag, speed: sp, hp } = growth;
      S.power += pw; S.agility += ag; S.speed += sp; S.maxHp += hp;
      /* 第 3 点全部由系统分配（不再发升级自由点、不弹加点窗）：力/敏/速任一项低于 25% 时
       * 优先补最低项，三项都达标时四项随机。 */
      let autoPoint = null;
      const forced = forcedStat();
      const pointRoom = Math.floor(statCapRoom());
      if (pointRoom >= 1) {
        const target = forced || STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)];
        if (grantPoint(target)) autoPoint = target;
      }
      /* pointRoom < 1：已经顶到 651 硬上限（正常升级不会出现，只有调试/旧档超额时才会），
       * 这一点不再发放，不能让待分配点越过上限。 */
      /* 71~90 级：每级 1 个金宝箱（与原版一致；原版在这一段不再给属性，本版仍给 4 点，
       * `levelChests` 是**账号累计**上限 20：转生回到 1 级再升上来不会重复发，
       * 否则「20 箱 ×12 点」可以被转生无限刷穿 651。 */
      const chestCap = MAX_PLAYER_LEVEL - 70;
      const chest = S.level > 70 && integer(S.levelChests, 0) < chestCap ? 1 : 0;
      if (chest) {
        S.props[90] = (S.props[90] || 0) + chest;
        S.levelChests = integer(S.levelChests, 0) + chest;
      }
      // 体力上限按等级重算（2~3 级每级 +3、4~20 每级 +2、21~90 每级 +1，满级 200）
      S.maxEnergy = Math.max(S.maxEnergy, energyCapForLevel(S.level));
      // 升级奖励：到指定等级时给一组「三选一」候选，玩家在弹窗里选一个
      // （wsChoices 为空表示池子已满/没有可学的，就不发奖励）
      const choices = GData.WS_LEVELS.includes(S.level) ? wsChoices(3) : [];
      if (choices.length) S.wsPicks.push(choices);
      if (S.level === 5 && !S.reborn) addGold(50);
      const gifts = (GData.levelGift ? GData.levelGift(S.level) : []).map((g) => {
        const item = propMap.getValue(g.id);
        S.props[g.id] = (S.props[g.id] || 0) + g.count;
        return { id: g.id, count: g.count, name: item ? item.name : '道具' };
      });
      ups.push({
        level: S.level, power: pw, agility: ag, speed: sp, hp,
        reward: null,
        rewardId: null,
        rewardKind: null,
        wsChoice: choices.length,
        attributeBook: false,
        chest,
        freePoint: 0,
        autoPoint,
        autoPointName: autoPoint ? STAT_NAMES[autoPoint] : null,
        gifts,
      });
    }
    save();
    return ups;
  }

  // 战斗后结算（挑战玩家）。
  function consumeEnergy(n) {
    n = Number(n);
    if (!Number.isSafeInteger(n) || n < 0) return false;
    tickEnergy();
    if (debugOn('infiniteEnergy')) return true;
    if (S.energy < n) return false;
    S.energy -= n;
    bumpDaily('energy', n, true);
    save();
    return true;
  }
  // 竞技场按联机口径只让经验丸生效：属性丸不进面板、不扣次数；经验丸只在结算经验时扣 1 次。
  const STAT_PILL_IDS = [3, 4, 5, 41, 42, 43];
  const EXP_PILL = { 7: 0.4, 44: 0.6 };   // 经验丸 40% / 超级经验丸 60%
  function tickPropStates(opts) {
    const kind = opts && opts.kind;
    const keys = kind === 'stat' ? STAT_PILL_IDS
      : kind === 'exp' ? Object.keys(EXP_PILL)
        : Object.keys(S.propsStates);
    for (const k of keys) {
      if (Number(S.propsStates[k]) > 0) S.propsStates[k]--;
    }
  }
  function expBoostPct() {
    let pct = 0;
    for (const id of Object.keys(EXP_PILL)) if (S.propsStates[id] > 0) pct += EXP_PILL[id] * 100;
    return pct;
  }
  /** 给一段经验套上经验丸加成并结算（竞技场等也能吃到）。 */
  function gainExpWithBoost(amount) {
    const boosted = Math.round(Number(amount || 0) * (1 + expBoostPct() / 100));
    return { exp: boosted, ups: gainExp(boosted) };
  }

  /** 天使/恶魔果实种子：10 个种子 + 50 金松果 → 1 个果实。
   *  经典合成的页面/动画在 `js/ssfight/ui-compose.js`，这里只留数值规则。 */
  function composeSeed(seedId) {
    seedId = Number(seedId);
    const fruit = (seedId === 45) ? 47 : (seedId === 46) ? 48 : 0;
    if (!fruit) return { ok: false, msg: '这个种子不能合成' };
    if ((S.props[seedId] || 0) < 10) return { ok: false, msg: '需要 10 个' + (propMap.getValue(seedId) || {}).name };
    if (S.goldPoint < 50) return { ok: false, msg: '合成需要 50 金松果' };
    S.props[seedId] -= 10;
    S.goldPoint -= 50;
    S.props[fruit] = Math.min(PROP_HARD_CAP, (S.props[fruit] || 0) + 1);
    save();
    const item = propMap.getValue(fruit);
    return { ok: true, msg: '合成成功：' + (item ? item.name : '果实'), propId: fruit, name: item ? item.name : '果实' };
  }

  /** 属性碎片合成：10 个属性碎片 + 50 金松果 → 随机一个力量/敏捷/速度转化丸。
   *  用户 2026-10 口径：不要属性永久增加，所以不走原版 66 的 16~19 永久丸。 */
  function composeConvertPill() {
    const need = GData.CONVERT_SHARD_COST, id = GData.CONVERT_SHARD_ID;
    if ((S.props[id] || 0) < need) return { ok: false, msg: '需要 ' + need + ' 个' + GData.CONVERT_SHARD_NAME };
    if (S.goldPoint < 50) return { ok: false, msg: '合成需要 50 金松果' };
    S.props[id] -= need;
    S.goldPoint -= 50;
    const pills = GData.CONVERT_PILLS;
    const got = pills[Math.floor(Math.random() * pills.length)];
    S.props[got] = Math.min(PROP_HARD_CAP, (S.props[got] || 0) + 1);
    save();
    const item = propMap.getValue(got);
    return { ok: true, msg: '合成成功：' + (item ? item.name : '转化丸'), prop: got, name: item ? item.name : '转化丸' };
  }

  const VIP_LEVELS = [   // [等级, 被动经验上限/天, 体力恢复倍率]
    [1, 150, 1.1], [2, 150, 1.2], [3, 200, 1.2], [4, 200, 1.3], [5, 250, 1.3],
    [6, 300, 1.4], [7, 300, 1.4], [8, 350, 1.5], [9, 350, 1.5], [10, 400, 1.5],
  ];
  const VIP_LEVEL_EXP = [3, 5, 15, 30, 60, 60, 60, 60, 100];   // 升到下一级所需
  const VIP_MAX_LEVEL = 10;
  const VIP_ENERGY_BONUS = 60;   // 特权 8：在当前等级应有的体力上限之上再 +60
  const VIP_GEAR_BONUS = 6;      // 特权 5
  const VIP_PLANS = [Object.freeze({ days: 7, gold: 150 }), Object.freeze({ days: 30, gold: 500 })];
  const GEAR_CAPACITY = 100;

  function vipState() {
    if (!S.vip || typeof S.vip !== 'object') S.vip = { level: 1, exp: 0, until: 0, capAdded: 0, capApplied: false, lastDaily: '' };
    return S.vip;
  }
  function vipUntil() { return Math.max(0, Number(vipState().until) || 0); }
  function vipActive() { return vipUntil() > Date.now(); }
  function vipLevel() { return vipActive() ? Math.max(1, Math.min(VIP_MAX_LEVEL, Math.floor(Number(vipState().level) || 1))) : 0; }
  function vipRow(level) { return VIP_LEVELS[Math.max(1, Math.min(VIP_MAX_LEVEL, level)) - 1]; }
  function vipRegenMul() { const lv = vipLevel(); return lv ? vipRow(lv)[2] : 1; }
  function vipPassiveExpCap() { const lv = vipLevel(); return lv ? vipRow(lv)[1] : 0; }
  function vipExpNeed() { const lv = vipLevel() || 1; return VIP_LEVEL_EXP[Math.min(lv, VIP_MAX_LEVEL) - 1]; }
  function vipDaysLeft() { return Math.max(0, Math.ceil((vipUntil() - Date.now()) / 86400000)); }
  function gearCapacity() { return GEAR_CAPACITY + (vipState().capApplied ? VIP_GEAR_BONUS : 0); }
  /** VIP 生效时的体力上限 =「当前等级应有的上限」+ 60（特权 8）。 */
  function vipEnergyCap() { return energyCapForLevel(S.level) + VIP_ENERGY_BONUS; }
  /**
   * 特权 8：VIP 期间体力上限在等级上限之上 +60，到期原样退回。
   * 只搬动「上限本身」的 ±60 变化量，所以期间升级、或者被其它来源抬上去的
   * 上限都不会被误算；退回后也不会低于当前等级应有的基础上限。
   */
  function syncVipEnergyCap() {
    const v = vipState(), on = vipActive(), base = energyCapForLevel(S.level);
    if (on !== v.capApplied) {
      const before = base + (v.capApplied ? VIP_ENERGY_BONUS : 0);
      const after = base + (on ? VIP_ENERGY_BONUS : 0);
      v.capApplied = on;
      v.capAdded = on ? VIP_ENERGY_BONUS : 0;
      S.maxEnergy = Math.max(base, S.maxEnergy + (after - before));
    } else if (on) {
      // 期间升级：保险起见把上限抬到「新等级 + 60」
      const target = vipEnergyCap();
      if (S.maxEnergy < target) S.maxEnergy = target;
      v.capAdded = VIP_ENERGY_BONUS;
    }
    // 只按硬上限收口：药剂顶上去的超出部分要保住，不能因为上限变化被清掉
    if (S.energy > ENERGY_HARD_CAP) S.energy = ENERGY_HARD_CAP;
    return S.maxEnergy;
  }
  function tickVipDaily() {
    const v = vipState();
    if (!vipActive()) return { gained: false };
    const today = localDate();
    if (v.lastDaily === today) return { gained: false };
    v.lastDaily = today;
    v.exp = (Number(v.exp) || 0) + 1;
    let leveled = 0;
    while (v.level < VIP_MAX_LEVEL && v.exp >= VIP_EXP_NEED(v.level)) { v.exp -= VIP_EXP_NEED(v.level); v.level++; leveled++; }
    if (v.level >= VIP_MAX_LEVEL) v.exp = 0;
    save();
    return { gained: true, level: v.level, leveled: leveled };
  }
  function VIP_EXP_NEED(level) { return VIP_LEVEL_EXP[Math.max(1, Math.min(VIP_MAX_LEVEL, Math.floor(Number(level) || 1))) - 1]; }
  /** 购买/续期超级松鼠。days 必须命中 VIP_PLANS。 */
  function buyVip(days) {
    const plan = VIP_PLANS.find((p) => p.days === Number(days));
    if (!plan) return { ok: false, msg: '没有这个档位' };
    if (S.goldPoint < plan.gold) return { ok: false, msg: '金松果不足，需要 ' + plan.gold + ' 个' };
    S.goldPoint -= plan.gold;
    const v = vipState();
    const base = Math.max(Date.now(), vipUntil());
    v.until = base + plan.days * 86400000;
    if (!v.level) v.level = 1;
    syncVipEnergyCap();
    save();
    return { ok: true, msg: '已成为超级松鼠 ' + plan.days + ' 天', until: v.until, level: v.level };
  }
  function grantVip(days, level) {
    const v = vipState();
    v.until = Math.max(Date.now(), vipUntil()) + Math.max(1, Number(days) || 1) * 86400000;
    if (level) v.level = Math.max(1, Math.min(VIP_MAX_LEVEL, Number(level)));
    if (!v.level) v.level = 1;
    syncVipEnergyCap(); save();
    return { until: v.until, level: v.level };
  }

  // 原版没有好友数量上限；FRIEND_LIMIT 是联机服务端一次响应的防滥用预算（单机同数）。
  const FRIEND_LIMIT = 50;
  const friendLimit = () => FRIEND_LIMIT;
  function friendList() { if (!Array.isArray(S.friends)) S.friends = []; return S.friends; }
  function friendOf(name) { return S.friends.find((f) => f.name === name) || null; }
  function addFriend(foe) {
    const name = foe && foe.name ? String(foe.name).trim().slice(0, 20) : '';
    if (!name) return { ok: false, msg: '好友信息无效' };
    if (friendOf(name)) return { ok: false, msg: '【' + name + '】已经是好友了' };
    /* 师徒与好友是两份名单但挑战页排在同一列：重名判据必须连师徒一起看，
   * 否则好友页会出现与师父重复的第二行。 */
    if (S.master && String(S.master.name || '').trim() === name) {
      return { ok: false, msg: '【' + name + '】已经是你的师父了' };
    }
    if ((S.prentices || []).some((p) => p && String(p.name || '').trim() === name)) {
      return { ok: false, msg: '【' + name + '】已经是你的徒弟了' };
    }
    if (S.friends.length >= FRIEND_LIMIT) return { ok: false, msg: '好友已满（' + FRIEND_LIMIT + ' 位），先删掉几位吧' };
    S.friends.push({
      name,
      level: Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(foe.level, 1, 1))),
      power: integer(foe.power, 1, 1), agility: integer(foe.agility, 1, 1), speed: integer(foe.speed, 1, 1),
      hp: integer(foe.hp != null ? foe.hp : foe.maxHp, 1, 1),
      note: typeof foe.note === 'string' ? foe.note.slice(0, 12) : '',
      /* 好友的**穿戴、武器与技能**也一起存下来：经典模式的挑战页要把好友自己的装备贴到右侧立绘上、
       * 并显示它的战斗力（原版这两项都来自服务端下发的 `wearsList` / `totalharm`）。
       * ⚠ `genAI` 抽出来的装备只有 `{id, ext, used}`、**没有 `type`** —— 这里顺手把部位补上
       * 武器 / 技能是**切磋时的出手池**：不存的话好友切磋只能一直普攻，
       * 只留必要字段，老档没有就是空数组 —— 不影响任何既有逻辑。 */
      gears: normalizeFoeGears(foe.gears),
      weapons: (foe.weapons || []).slice(0, 8),
      skills: (foe.skills || []).slice(0, 16),
      since: localDate(),
    });
    save();
    return { ok: true, msg: '已把【' + name + '】加为好友', friend: friendOf(name), count: S.friends.length };
  }
  /** 老档里的好友没有 `gears` / `weapons` / `skills`（这三个字段是后来才陆续落存档的）：
   *  第一次读到时就按它的等级补一份（走 `genAI` 同一条随机路，与"推荐好友"一致），并写回存档。
   *  **切磋也直接读这份出手池**（见 `friendFoe`）—— 缺了武器/技能，好友就只会普攻，
   *  和随机挑战那套「武器 / 技能 / 普攻」权重抽取不一致。
   *  沿用项目里既有的"读到旧档就地补全"写法（同 `ClassicExtras.rank` 补 `integral`）。 */
  function ensureFriendLoadout(f) {
    if (!f) return f;
    const needGears = !Array.isArray(f.gears);
    const needWeapons = !Array.isArray(f.weapons);
    const needSkills = !Array.isArray(f.skills);
    if (!needGears && !needWeapons && !needSkills) return f;
    try {
      const roll = genAI(Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(f.level, 1, 1))), '', { gearSelfLevel: true });
      if (needGears) f.gears = normalizeFoeGears(roll.gears);
      if (needWeapons) f.weapons = (roll.weapons || []).slice(0, 8);
      if (needSkills) f.skills = (roll.skills || []).slice(0, 16);
      /* ⚠ 只补装备 / 武器 / 技能，**绝不要碰三维**：`f` 可能是师父 / 徒弟那一行
       * （它们的三维在 `setMaster` / `addPrentice` 时就存好了）。 */
    } catch (e) {
      if (needGears) f.gears = [];
      if (needWeapons) f.weapons = [];
      if (needSkills) f.skills = [];
    }
    try { save(); } catch (e) {}
    return f;
  }
  function removeFriend(name) {
    const at = S.friends.findIndex((f) => f.name === name);
    if (at < 0) return { ok: false, msg: '没有这位好友' };
    const [gone] = S.friends.splice(at, 1);
    if (object(S.friendMessages)) delete S.friendMessages[gone.name];
    save();
    return { ok: true, msg: '已把【' + gone.name + '】移出好友', count: S.friends.length };
  }
  const FRIEND_MESSAGE_MAX = 50;
  function friendMessages(name) {
    const who = String(name || '').trim();
    const all = object(S.friendMessages) ? S.friendMessages : {};
    const list = Array.isArray(all[who]) ? all[who] : [];
    return list.slice(-20).map((m) => ({ text: String(m.text || ''), at: Number(m.at) || 0 }));
  }
  function leaveFriendMessage(name, text) {
    const who = String(name || '').trim().slice(0, 20);
    const body = String(text == null ? '' : text).trim().slice(0, 80);
    if (!who) return { ok: false, msg: '好友信息无效' };
    if (!friendOf(who)) return { ok: false, msg: '只有好友才能留言' };
    if (!body) return { ok: false, msg: '留言不能为空' };
    if (!object(S.friendMessages)) S.friendMessages = {};
    const list = Array.isArray(S.friendMessages[who]) ? S.friendMessages[who] : [];
    list.push({ text: body, at: Date.now() });
    S.friendMessages[who] = list.slice(-FRIEND_MESSAGE_MAX);
    save();
    return { ok: true, msg: '留言已保存', list: friendMessages(who) };
  }
  /** friendFoe：武器/技能必须一起带进战斗（Sim 是武器/技能/普攻三方权重竞争），
   *  缺数组就只剩普攻。老档缺字段先走 ensureFriendLoadout() 就地补全。 */
  function friendFoe(friend) {
    if (!friend) return null;
    const full = ensureFriendLoadout(friend) || friend;
    return {
      name: full.name, level: full.level, power: full.power, agility: full.agility, speed: full.speed,
      hp: full.hp, maxHp: full.hp, baseStats: { power: full.power, agility: full.agility, speed: full.speed, hp: full.hp },
      weapons: (full.weapons || []).slice(), skills: (full.skills || []).slice(),
      gears: (full.gears || []).slice(),
      isAI: true, effects: {}, friend: true,
    };
  }
  function rollFriendCandidates(count) {
    const n = Math.max(1, Math.min(8, Math.round(Number(count) || 3)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const level = Math.max(1, Math.min(MAX_PLAYER_LEVEL, S.level + Math.floor(Math.random() * 7) - 2));
      out.push(genAI(level, '', { levelJitter: 1, gearSelfLevel: true }));
    }
    return out;
  }

  const CHALLENGE_EXP_BASE = 16;
  const CHALLENGE_EXP_PER_LEVEL = 0.55;
  const CHALLENGE_EXP_CAP_LEVEL = 20;
  const EXP_DIFF_STEP = 0.09;           // 每高 1 级 +9%（先算线性倍率，再压实）
  const EXP_DIFF_TIGHTEN = 0.78;
  const EXP_DIFF_FLOOR = 0.3;           // 对手低很多时的最低倍率
  const EXP_DIFF_CAP = 2.2;
  const ARENA_CHAMPION_EXP = 150;
  const ARENA_ENERGY_COST = 30;
  const ARENA_EXP_PER_ENERGY = ARENA_CHAMPION_EXP / ARENA_ENERGY_COST;   // 5.0
  function challengeExp(foeLevel, myLevel) {
    const mine = Math.max(1, Math.round(Number(myLevel) || (S && S.level) || 1));
    const diff = Math.max(-15, Math.min(15, Math.round(Number(foeLevel) || mine) - mine));
    const base = CHALLENGE_EXP_BASE + Math.min(mine, CHALLENGE_EXP_CAP_LEVEL) * CHALLENGE_EXP_PER_LEVEL;
    const linear = Math.max(EXP_DIFF_FLOOR, Math.min(EXP_DIFF_CAP, 1 + diff * EXP_DIFF_STEP));
    const mult = Math.pow(linear, EXP_DIFF_TIGHTEN);
    return Math.round(base * mult);
  }
  const CHALLENGE_DIFF_RANGE = [-1, 3];
  function challengeFightsPerLevel(level) {
    const gain = challengeExp(level, level);
    return gain > 0 ? GData.nextExp(level) / gain : Infinity;
  }
  function fightReward(win, opts) {
    opts = opts || {};
    const foeLevel = Math.max(1, Math.floor(Number(opts.foeLevel) || (S && S.level) || 1));
    const expBase = win
      ? Math.round(challengeExp(foeLevel, S.level) * (0.9 + Math.random() * 0.2))
      : Math.max(4, Math.round(challengeExp(foeLevel, S.level) * 0.08));
    const useProps = opts.useProps !== false;
    const expMul = 1 + (useProps ? expBoostPct() : 0) / 100;
    const gold = win ? 3 + Math.floor(Math.random() * 5) : (Math.random() < 0.3 ? 1 : 0);
    addGold(gold);
    const ups = gainExp(expBase * expMul);
    if (useProps) tickPropStates();
    save();
    return { exp: Math.round(expBase * expMul), gold, ups };
  }
  /* ---------- 复仇（消息页「复仇」标签） ----------
   * REVENGE_EXP_RATIO 折算 —— 算把上次失败少拿的那部分补回一点，
   * 但远低于正常赢一场，所以不会变成刷经验的入口。每条记录只能复仇成功一次。 */
  const REVENGE_EXP_RATIO = 0.35;
  function revengeReward(foeLevel) {
    const level = Math.max(1, Math.floor(Number(foeLevel) || (S && S.level) || 1));
    const full = challengeExp(level, (S && S.level) || 1);
    const exp = Math.max(4, Math.round(full * REVENGE_EXP_RATIO));
    const gold = 1 + Math.floor(Math.random() * 3);
    addGold(gold);
    const ups = gainExp(exp);
    save();
    return { exp, gold, ups };
  }
  function markRevenged(id) {
    const battle = (S.battles || []).find((b) => b && b.id === id);
    if (!battle || battle.revenged) return false;
    battle.revenged = Date.now();
    save();
    return true;
  }
  /** 复仇信息：第 n 次复仇要 `(n+1)*20` 金松果。
   *  **只有天梯赛（kind === 'rank'）的败绩复仇才抢金杯**，且改为 0~1 个；
   *  `cups` 是上限，实际值由界面在确认时掷一次（0 或 1），确认文案与结算共用同一次结果。
   *  `ladder` 供界面决定是否显示金杯相关文案；`id` 是战斗记录 id。 */
  function revengeInfo(id) {
    const battle = (S.battles || []).find((b) => b && b.id === id);
    const n = Math.max(0, Math.floor(Number(battle && battle.revengeCount) || 0));
    const ladder = !!(battle && battle.kind === 'rank');
    return { count: n, cost: (n + 1) * 20, ladder, cups: ladder ? 1 : 0, cupsMin: 0, revenged: !!(battle && battle.revenged) };
  }
  function noteRevenge(id) {
    const battle = (S.battles || []).find((b) => b && b.id === id);
    if (!battle) return 0;
    battle.revengeCount = Math.max(0, Math.floor(Number(battle.revengeCount) || 0)) + 1;
    save();
    return battle.revengeCount;
  }

  const AI_PREFIX = ['松果', '橡果', '坚果', '瓜子', '松针', '尾巴', '树梢', '森林', '飞天', '闪电', '暴躁', '萌萌',
    '快乐', '无敌', '狂战', '吃瓜', '鼠胆', '大尾', '老', '小', '铁齿', '铜牙', '旋风', '疾风'];
  const AI_CORE = ['小弟', '小鼠', '大侠', '无双', '王者', '姐姐', '妹妹', '群众', '英雄', '达人', '杀手', '猎手',
    '终结者', '收藏家', '舞者', '王子', '公主', '一霸', '战神', '掌门', '小旋风', '大魔王', '掌门人', '小队长'];
  const AI_NICK = ['吱吱喳喳', '鼠你最棒', '鼠不尽的快乐', '鼠来运转', '松鼠妹妹', '啃果群众', '尾巴翘翘', '闪电鼠',
    '吃瓜小鼠', '鼠胆英雄', '森林一霸', '松果收藏家', '暴躁小鼠', '快乐松鼠', '鼠大王', '松涛依旧', '坚果猎人',
    '瓜子杀手', '老松鼠', '鼠门弄斧', '松间明月', '大尾巴狼', '树梢舞者', '松针小王子', '橡果终结者'];

  const AI_TITLE = ['', '', '', '', '的师傅', '的师兄', '的宿敌', '二世'];
  // 人机昵称上限 7 个汉字：战斗血条 name2 字段只有 84.45 单位宽，更长的字会被裁掉。
  const AI_NAME_MAX = 7;

  /** 按汉字个数截断（只有兜底用；正常组合在生成时就保证放得下）。 */
  function clipAIName(name) {
    const chars = [...String(name == null ? '' : name)];
    return chars.length > AI_NAME_MAX ? chars.slice(0, AI_NAME_MAX).join('') : chars.join('');
  }
  function fitAIName(name, suffix) {
    const base = String(name == null ? '' : name);
    const extra = String(suffix == null ? '' : suffix);
    if (!extra) return base;
    return [...base + extra].length <= AI_NAME_MAX ? base + extra : base;
  }

  function randomAIName(rng) {
    const r = typeof rng === 'function' ? rng : Math.random;
    if (r() < 0.3) return clipAIName(AI_NICK[Math.floor(r() * AI_NICK.length)]);
    const name = AI_PREFIX[Math.floor(r() * AI_PREFIX.length)] + AI_CORE[Math.floor(r() * AI_CORE.length)];
    const title = AI_TITLE[Math.floor(r() * AI_TITLE.length)];
    return fitAIName(name, title);
  }

  /* 随机对手总属性上下限：下限取关卡数值模型的玩家基准曲线，并与 22+4×(等级−1) 取大；
   * 上限按「满成长 + 永久来源 + 当前等级最好装备/宝石/被动」估一个保守理论上限。
   * 总属性 = 力+敏+速+生命/5，生成后夹到 [下限, 上限]。 */
  const FOE_TOTAL_HP_DIV = 5;
  const FOE_TOTAL_CACHE = new Map();

  function foeTotalStats(foe) {
    if (!foe) return 0;
    return (Number(foe.power) || 0) + (Number(foe.agility) || 0)
      + (Number(foe.speed) || 0) + (Number(foe.hp) || 0) / FOE_TOTAL_HP_DIV;
  }
  /** 现代随机战斗的「查看对手」：把 foe 上的武技/装备原始字段翻成可读详情。
   *  classic 的查看页有自己的原版素材；现代界面直接渲染这份数据，两者共用同一份真值。 */
  function foeLoadout(foe) {
    if (!foe) return null;
    const parseWS = (entry) => {
      let id = 0, level = 1;
      if (typeof entry === 'string') {
        const p = entry.split(/[:,]/);
        id = Number(p[0]) || 0;
        level = Math.max(1, Number(p[1]) || 1);
      } else if (entry && typeof entry === 'object') {
        id = Number(entry.id) || 0;
        level = Math.max(1, Number(entry.level) || 1);
      }
      return { id, level };
    };
    const weapons = ((foe.weapons) || []).map((entry) => {
      const w = parseWS(entry);
      const def = weaponsMap.getValue(w.id);
      return { id: w.id, level: w.level, name: def ? def.name : ('武器#' + w.id), type: def ? def.type : '' };
    });
    const skills = ((foe.skills) || []).map((entry) => {
      const s = parseWS(entry);
      const def = skillsMap.getValue(s.id);
      return { id: s.id, level: s.level, name: def ? def.name : ('技能#' + s.id), type: def ? def.type : '' };
    });
    const gears = ((foe.gears) || []).map((g) => {
      const info = gearInst(g.id, g.ext, g.attr);
      if (!info) return null;
      const set = gearSetMap.getValue(info.setId);
      const gemLv = g.gem && gemLevel(g.gem.id);
      const rawQuality = Number(g.quality != null ? g.quality : info.quality);
      return {
        id: info.id, name: info.name, type: info.type,
        part: ['头巾', '手套', '衣服', '鞋子'][info.type] || '装备',
        quality: g.orange === true ? 4 : (Number.isFinite(rawQuality) ? rawQuality : 0),
        orange: g.orange === true,
        setName: set ? set.name : '',
        attrName: info.attrName, abilityVal: info.abilityVal,
        ext: extTextForGear(g),
        gem: gemLv ? { level: gemLv, percent: gemPercent(gemLv), units: gemAffixUnits(100 + gemLv) } : null,
      };
    }).filter(Boolean);
    return {
      name: foe.name || '', level: Number(foe.level) || 1,
      stats: {
        power: Number(foe.power) || 0, agility: Number(foe.agility) || 0,
        speed: Number(foe.speed) || 0, hp: Number(foe.hp) || 0, maxHp: Number(foe.maxHp) || Number(foe.hp) || 0,
      },
      weapons, skills, gears,
      pets: Array.isArray(foe.pets) ? foe.pets.map((p) => ({ name: p.name, grade: p.grade, level: p.level, skillId: p.skillId })) : [],
    };
  }
  /** 当前等级下武器/技能能升到的最高等级（原版强化表的 levelLimit ≤ 等级）。 */
  function aiToolMaxLevel(level) {
    const lv = Math.max(1, Math.floor(Number(level) || 0));
    let hi = 1;
    while (hi < 15 && Number(upgradeMap.getValue(hi).levelLimit) <= lv) hi++;
    return hi;
  }
  /** 正常成长到该等级的玩家总属性（关卡模型的玩家基准曲线，低等级兜底为初始 22 点）。 */
  function playerNormalTotal(level) {
    const lv = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(Number(level) || 1)));
    const growth = 22 + (lv - 1) * 4;
    const curve = 3 * GData.stagePlayerStat(lv) + GData.stagePlayerHp(lv) / FOE_TOTAL_HP_DIV;
    return Math.ceil(Math.max(growth, curve));
  }
  /** 该等级可达到的高配玩家总属性（保守上限；不含无限属性道具/幻兽）。 */
  function playerMaxTotal(level) {
    const lv = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(Number(level) || 1)));
    const growth = 22 + (lv - 1) * 4;
    const permanent = Math.max(0, Math.min(20, lv - 70)) * 12
      + (lv >= 25 ? 29 : 0) + (lv >= 30 ? 4 : 0);
    /* 被动技能：1 力 / 2 敏 / 3 速 / 4 血，按当前可升到的最高档。 */
    const toolMax = aiToolMaxLevel(lv);
    let passive = 0;
    for (const id of [1, 2, 3, 4]) passive += Math.max(0, Number(GData.passiveBonus(id, toolMax)) || 0);
    const gemMax = lv >= 45 ? Math.min(7, 1 + Math.floor((lv - 45) / 6)) : 0;
    const gemMul = gemMax ? 1 + gemPercent(gemMax) / 100 : 1;
    const best = [0, 0, 0, 0];
    for (const row of (GData.GEAR_BASE || [])) {
      const baseAttr = Number(row && row[5]) || 0;
      if (!(baseAttr > 0)) continue;
      const info = gearInst(row[0], [], gearAttrValueOf(row[0], GEAR_ATTR_PCT_MAX));   // 主属性 +5% 上限
      if (!info || Number(info.useLevel) > lv) continue;
      const type = Number(info.type);
      if (!(type >= 0 && type < 4)) continue;
      const val = Math.round((Number(info.abilityVal) || 0) * gemMul);
      if (val > best[type]) best[type] = val;
    }
    const gear = best.reduce((sum, val) => sum + val, 0);
    return Math.ceil(growth + permanent + passive + gear);
  }
  /** 某一等级的玩家总属性上下限（每级只算一次；装备/被动扫描不跟每次 genAI 走）。 */
  function playerTotalBounds(level) {
    const lv = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(Number(level) || 1)));
    let hit = FOE_TOTAL_CACHE.get(lv);
    if (hit) return hit;
    const normal = playerNormalTotal(lv);
    const max = Math.max(normal, playerMaxTotal(lv));
    hit = { level: lv, normal: normal, max: max };
    FOE_TOTAL_CACHE.set(lv, hit);
    return hit;
  }
  function addFoeTotalPoints(foe, points) {
    let n = Math.max(0, Math.ceil(Number(points) || 0));
    const order = ['power', 'agility', 'speed', 'hp'];
    let i = 0;
    while (n-- > 0) {
      const key = order[i++ % order.length];
      if (key === 'hp') foe.hp += 5;
      else foe[key] += 1;
    }
    foe.maxHp = foe.hp;
  }
  /** 从对手身上扣总属性点：优先扣大的项，任何一项都不低于 1（生命不低于 5）。 */
  function removeFoeTotalPoints(foe, points) {
    let n = Math.max(0, Math.ceil(Number(points) || 0));
    const order = ['power', 'agility', 'speed', 'hp'];
    let guard = 0;
    while (n > 0 && guard++ < 10000) {
      order.sort((a, b) => (Number(foe[b]) || 0) - (Number(foe[a]) || 0));
      let done = false;
      for (const key of order) {
        if (key === 'hp') {
          if ((Number(foe.hp) || 0) > 5) { foe.hp -= 5; done = true; break; }
        } else if ((Number(foe[key]) || 0) > 1) {
          foe[key] -= 1;
          done = true;
          break;
        }
      }
      if (!done) break;
      n--;
    }
    foe.maxHp = foe.hp;
  }
  /** 把对手总属性缩放到目标值；`limit='min'` 只补不扣，`limit='max'` 只扣不补。 */
  function scaleFoeToTotal(foe, target, limit) {
    const want = Math.max(4, Math.round(Number(target) || 0));
    const before = foeTotalStats(foe);
    if (!(before > 0)) return;
    const factor = want / before;
    for (const key of ['power', 'agility', 'speed']) {
      foe[key] = Math.max(1, Math.round((Number(foe[key]) || 1) * factor));
    }
    foe.hp = Math.max(5, Math.round((Number(foe.hp) || 5) * factor));
    foe.maxHp = foe.hp;
    const total = foeTotalStats(foe);
    if (limit === 'max') {
      if (total > want + 1e-9) removeFoeTotalPoints(foe, total - want);
    } else if (total < want - 1e-9) {
      addFoeTotalPoints(foe, want - total);
    }
  }
  /** 生成出口统一夹总属性：低于正常玩家总属性就抬上来，高于高配玩家上限就压下去。 */
  function applyFoeTotalBounds(foe) {    if (!foe) return foe;
    const level = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(Number(foe.level) || 1)));
    const bounds = playerTotalBounds(level);
    const total = foeTotalStats(foe);
    if (total < bounds.normal - 1e-9) scaleFoeToTotal(foe, bounds.normal, 'min');
    else if (total > bounds.max + 1e-9) scaleFoeToTotal(foe, bounds.max, 'max');
    foe.maxHp = Math.max(1, Math.round(Number(foe.hp) || 1));
    return foe;
  }

  /** 生成对手：levelJitter 等级浮动（默认 ±2）、minLevel 下限、gear 是否随机装备、
   *  gearSelfLevel 按对手自身等级解锁装备、name 指定名字、bounds===false 跳过总属性夹取。 */
  function genAI(level, nameSuffix, opts) {
    opts = opts || {};
    level = integer(level, 1, 1);
    const jitter = Number.isFinite(opts.levelJitter) ? Math.max(0, Math.floor(opts.levelJitter)) : 2;
    const rolled = jitter ? integer(level + Math.floor(Math.random() * (2 * jitter + 1)) - jitter, 1, 1) : level;
    const finalLevel = Math.min(MAX_PLAYER_LEVEL, Math.max(integer(opts.minLevel, 1, 1), rolled));
    /* 人机名字统一在出口收口到 7 个汉字；显式 `opts.name`（剧情/特殊 NPC）原样保留，
     * 只有随机人机才追加 `nameSuffix`（同样只加在放得下时）。 */
    const name = opts.name ? String(opts.name) : fitAIName(randomAIName(), nameSuffix);
    // 离线对手遵循相同的基础成长预算，避免用旧高成长公式压过新建玩家。
    const base = GData.initialStats();
    for (let lv = 2; lv <= finalLevel; lv++) {
      base.maxHp += 5;
      // 与玩家共用同一套点位预算：2 点随机（1/4 概率 +5 生命）+ 1 点系统分配。
      // 对手不弹窗，系统点默认在四项里随机挑；力/敏/速占比低于 25% 时优先补
      for (let point = 0; point < FREE_POINT_RANDOM; point++) {
        const key = ['power', 'agility', 'speed', 'maxHp'][Math.floor(Math.random() * 4)];
        base[key] += key === 'maxHp' ? 5 : 1;
      }
      const forced = forcedStat(base);
      let freeKey = opts.freePointBias;
      if (freeKey === 'lowest' || !STAT_KEYS.includes(freeKey)) {
        freeKey = freeKey === 'lowest' ? lowestStat(base) : STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)];
      }
      const target = forced || freeKey;
      if (target === 'hp') base.maxHp += STAT_GAIN.hp; else base[target] += STAT_GAIN[target];
    }
    const wsPool = [];
    weaponsMap.each((k, v) => { if (GData.canLearn('weapon', v.id, finalLevel)) wsPool.push(parseInt(v.id)); });
    const skPool = [];
    skillsMap.each((k, v) => { if (GData.canLearn('skill', v.id, finalLevel)) skPool.push(parseInt(v.id)); });
    const nWS = GData.wsLimit(finalLevel);
    const weapons = [], skills = [];
    /* 武器/技能总数 = GData.wsLimit(敌人等级)，只有分到哪类与各自几级是随机的；
     * 等级在 [下限, 11] 之间均匀取，下限由 aiToolMinLevel 给，最终 Math.min(lo, hi)。 */
    for (let i = 0; i < nWS; i++) {
      const wantWeapon = Math.random() < 0.55;
      let pool = wantWeapon ? wsPool : skPool;
      if (!pool.length) pool = wantWeapon ? skPool : wsPool;   // 池空就换另一边，别少给
      const chooseWeapon = pool === wsPool;
      if (!pool.length) break;
      const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      let hi = aiToolMaxLevel(finalLevel);
      if (!chooseWeapon && [6, 13].includes(id)) hi = 1;
      const lo = Math.min(aiToolMinLevel(finalLevel), hi);
      (chooseWeapon ? weapons : skills).push(id + ':' + (lo + Math.floor(Math.random() * (hi - lo + 1))));
    }
    const foe = {
      name, level: finalLevel, power: base.power, agility: base.agility, speed: base.speed,
      hp: base.maxHp, baseStats: { power: base.power, agility: base.agility, speed: base.speed, hp: base.maxHp },
      weapons, skills, isAI: true, effects: {},
    };
    const playerLevel = S && Number.isFinite(S.level) ? S.level : 1;
    const gearLevel = opts.gearSelfLevel ? finalLevel : Math.max(playerLevel, 1);
    if (opts.gear !== false) foe.gears = randomAIGears(finalLevel, gearLevel);
    for (const gear of foe.gears || []) {
      const info = gearInst(gear.id, gear.ext, gear.attr);
      if (!info) continue;
      /* 宝石加成与玩家侧 `totalStats` / `equipmentEffects` 同一条口径：
       * 主属性 ×(1 + gemPercent%)，附加词条按宝石增幅单位取 ability+extra。 */
      const gemLv = gear.gem ? gemLevel(gear.gem.id) : 0;
      const mainMul = gemLv ? 1 + gemPercent(gemLv) / 100 : 1;
      foe[['agility', 'power', 'hp', 'speed'][info.type]] += Math.round(info.abilityVal * mainMul);
      const gemUnits = gemAffixUnits(gear.gem && gear.gem.id);
      for (const ext of gear.ext || []) {
        const def = attachmentMap.getValue(ext.id);
        if (!def) continue;
        const val = Math.round(attachmentValue(ext.id, ext.level, gemUnits).total);
        if (Number.isFinite(val)) foe.effects[ext.id] = Math.max(foe.effects[ext.id] || 0, val);
      }
    }
    /* 套装收益：**对手也吃**（与玩家同一条数值表、同一套口径）。
     * 挑战塔 / 无尽塔的敌人不经过这里（tower.js 的 buildFoe 自己造），所以那两种模式不受影响。 */
    applyFoeSetBonuses(foe, foe.gears || [], finalLevel);
    for (const value of skills) {
      const skill = skillInst(value);
      const stat = { 1: 'power', 2: 'agility', 3: 'speed', 4: 'hp' }[skill.id];
      if (stat) foe[stat] += Math.round(GData.passiveBonus(skill.id, skill.level) * (1 + (foe.effects[26 + skill.id] || 0) / 100));
    }
    const statScale = Number(opts.statScale);
    if (Number.isFinite(statScale) && statScale > 0 && statScale !== 1) {
      for (const key of ['power', 'agility', 'speed']) {
        foe[key] = Math.max(1, Math.round(foe[key] * statScale));
      }
      foe.hp = Math.max(1, Math.round(foe.hp * statScale));
      foe.statScale = statScale;
    }
    /* 随机对手必须显式写 maxHp：缺上限时幻兽加血会把上限误设成 1+bonus.hp，
     * Sim 再把当前血量夹到几十点，经典血条会从满血一帧掉到 0。 */
    if (foe.maxHp == null) foe.maxHp = Math.max(1, Math.round(foe.hp));
    /* 【随机挑战预告 = 实战】幻兽必须在**生成对手时**就抽定并落到面板上。
     * 以前是 `Main.startBattle` 到开战前才 `randomPetLoadout` + `applyPetBonuses`：
     * 随机挑战/好友预览看到的是没加幻兽的力敏速命，进战斗后敌人却凭空多出
     * 1~3 只幻兽的属性（生命上限也一起涨），就是用户报的"预告属性和战斗内不符"。
     * `__petBonusesApplied` 防重，startBattle 再调一次也不会二次加。 */
    if (opts.pets !== false && foe.isAI && !Array.isArray(foe.pets)) {
      try {
        foe.pets = randomPetLoadout(finalLevel);
        applyPetBonuses(foe, foe.pets);
      } catch (e) { if (window.__errs) window.__errs.push('genAI pets: ' + (e && e.message)); }
    }
    /* 最后再夹总属性：幻兽加成也算进对手面板，避免加完幻兽后又跌破正常玩家下限。
     * `opts.bounds === false` 只给需要精确裸数值的调试/测量调用留出口；随机对手默认走。 */
    if (opts.bounds !== false) applyFoeTotalBounds(foe);
    return foe;
  }

  /* 随机对手的狂战套概率（只剩现代模式）：50 级起每部位 10% +（等级−50）×1%，等级更高更密；
   * 只影响生成的随机对手；挑战塔敌人由 tower.js 自造。 */
  const BERSERK_SET_ID = 51;
  const BERSERK_LEVEL = 50;
  const BERSERK_CHANCE_AT_50 = 0.10;    // 50 级：**每件装备** 10%（下限，2026-10 用户口径）
  const BERSERK_CHANCE_AT_70 = 0.50;    // 70 级：**每件装备** 50%（用户口径）
  const BERSERK_CHANCE_MAX = 0.80;
  /** 某等级下**每个部位**穿到狂战件的概率（0 = 池子里根本没有这一套）。
   *  50 级 10% → 70 级 50%，中间按等级线性（每级 +2 个百分点）。 */
  function berserkChance(level) {
    const lv = Math.floor(Number(level) || 0);
    if (lv < BERSERK_LEVEL) return 0;
    /* 按**整数百分点**算，免得出 0.30000000000000004 这种数（概率要拿去显示与断言） */
    const span = Math.max(1, MAX_PLAYER_LEVEL - BERSERK_LEVEL);
    const t = Math.min(1, Math.max(0, (lv - BERSERK_LEVEL) / span));
    const pct = Math.round(BERSERK_CHANCE_AT_50 * 100 + (BERSERK_CHANCE_AT_70 * 100 - BERSERK_CHANCE_AT_50 * 100) * t);
    return Math.min(BERSERK_CHANCE_MAX, pct / 100);
  }

  /* 随机对手武技等级下限：90 级最低真1(11)、50 级最低 6，中间线性插值、封到 11 止；
   * 真正的夹取在 genAI 里做（Math.min(lo, hi)），6/13 这类不能升级的仍是 1 级。 */
  const AI_TOOL_MIN_TRUE_LEVEL = 11;
  function aiToolMinLevel(level) {
    const lv = Math.max(1, Math.floor(Number(level) || 0));
    return Math.max(1, Math.min(AI_TOOL_MIN_TRUE_LEVEL, Math.floor((lv - 2) / 8)));
  }

  /* ---------- 随机对手装备的**档位下限 / 全套门槛**（2026-10 用户口径） ----------
   * ① **档位下限**（按套装使用等级）：等级越高，池里越不出现远古低档装——
   *   不再受 40 级以下那条 0.5+等级/40 的穿戴率影响（两项是同批用户口径）。 */
  const AI_FULL_GEAR_LEVEL = 40;
  function aiGearMinLevel(level) {
    const lv = Math.max(1, Math.floor(Number(level) || 0));
    if (lv >= 60) return 25;
    if (lv >= 40) return 20;
    return 0;
  }

  /* ---------- 随机对手的橙装 / 宝石期望 ----------
   *   · 橙装：30 级起才可能出现，30 级每件约 1% → 50 级 8% → 70 级 25%（封顶 35%）；
   *   · 宝石：45 级（原版宝石解锁）起才可能镶，橙装每件 20% → 70 级 70%；
   * 只对**紫装档（info.quality >= 3）**掷橙装 —— 白/绿/蓝装不能直接变成橙装。 */
  const AI_ORANGE_FROM_LEVEL = 30;
  const AI_GEM_FROM_LEVEL = 45;
  function aiOrangeChance(level) {
    const lv = Math.max(0, Number(level) || 0);
    if (lv < AI_ORANGE_FROM_LEVEL) return 0;
    const t = Math.max(0, Math.min(1, (lv - AI_ORANGE_FROM_LEVEL) / (MAX_PLAYER_LEVEL - AI_ORANGE_FROM_LEVEL)));
    return Math.min(0.35, 0.01 + 0.24 * t);
  }
  function aiGemChance(level) {
    const lv = Math.max(0, Number(level) || 0);
    if (lv < AI_GEM_FROM_LEVEL) return 0;
    const t = Math.max(0, Math.min(1, (lv - AI_GEM_FROM_LEVEL) / (MAX_PLAYER_LEVEL - AI_GEM_FROM_LEVEL)));
    return Math.min(0.85, 0.20 + 0.50 * t);
  }
  function aiGemLevel(level) {
    const lv = Math.max(0, Number(level) || 0);
    if (lv < AI_GEM_FROM_LEVEL) return 0;
    const base = 1 + Math.floor((lv - AI_GEM_FROM_LEVEL) / 6);
    const jitter = Math.floor(Math.random() * 3) - 1;   // -1 / 0 / +1
    return Math.max(1, Math.min(7, base + jitter));
  }

  function randomAIGears(foeLevel, refLevel) {
    const level = Math.max(1, Math.min(foeLevel, Math.floor(refLevel || foeLevel || 1)));
    const minSetLevel = aiGearMinLevel(level);
    const sets = [];
    gearSetMap.each((id, set) => {
      const lv = Number(set && set.level);
      /* 橙装 q4 只给玩家融合链 / 明确的掉落使用；随机 AI 继续走原来的紫装档 +
       * 实例橙色规则，避免把 q4 直接塞进 AI 池后整体难度无声上涨。 */
      if (set && Number.isFinite(lv) && lv <= level && lv >= minSetLevel && Number(set.quality) < 4) {
        sets.push({ id: Number(id), level: lv, quality: parseInt(set.quality) || 0 });
      }
    });
    if (!sets.length) return [];
    // 正常玩家闯关到10级后基本穿满当前套装，对手的穿戴率不能差太多；
    const alwaysFull = Math.max(1, Math.floor(Number(foeLevel) || 0)) >= AI_FULL_GEAR_LEVEL;
    const wearChance = alwaysFull ? 1 : Math.min(0.95, 0.5 + level / 40);
    const classicUniform = slotMode() === 'classic' && level >= BERSERK_LEVEL;
    let tiers = null, berserkPool = null, normalPool = null, pieceChance = 0;
    if (!classicUniform) {
      // 套装按等级从高到低分档；低等级套装的加成远小于高档，不能等概率随机
      tiers = [];
      for (const set of sets.slice().sort((a, b) => b.level - a.level)) {
        const top = tiers[tiers.length - 1];
        if (top && top.level === set.level) top.sets.push(set);
        else tiers.push({ level: set.level, sets: [set] });
      }
      /* 狂战套按部位掷：命中从狂战档挑，没命中从**剔除狂战之后**的档位池挑，
       * 否则没命中的部位仍会落进最高档、等于白压。 */
      berserkPool = tiers.filter((tier) => tier.sets.some((set) => set.id === BERSERK_SET_ID));
      normalPool = tiers.map((tier) => ({ level: tier.level, sets: tier.sets.filter((set) => set.id !== BERSERK_SET_ID) }))
        .filter((tier) => tier.sets.length);
      if (!berserkPool.length && !normalPool.length) return [];
      pieceChance = berserkChance(level);
    }
    const out = [];
    const usedType = new Set();
    for (let slot = 0; slot < 4; slot++) {
      if (Math.random() > wearChance) continue;
      let tier = null;
      if (classicUniform) {
        /* 均匀分布：池里**每一套**等概率（狂战只是其中之一，不再有单独概率） */
        const picked = sets[Math.floor(Math.random() * sets.length)];
        tier = { level: picked.level, sets: [picked] };
      } else {
        const useBerserk = berserkPool.length > 0 && Math.random() < pieceChance;
        const pool = useBerserk ? berserkPool : normalPool;
        if (!pool.length) break;                       // 两边池都空只在极端空池才发生，直接收工
        const roll = Math.random();
        tier = roll < 0.75 ? pool[0]
          : roll < 0.95 ? pool[Math.min(1, pool.length - 1)]
          : pool[Math.floor(Math.random() * pool.length)];
      }
      const set = tier.sets[Math.floor(Math.random() * tier.sets.length)];
      const gearsOfSet = [];
      gearMap.each((k, v) => { if (parseInt(v.setId) === set.id) gearsOfSet.push(parseInt(v.id)); });
      if (!gearsOfSet.length) break;
      /* 这一件**一定落在还没穿过的部位**：直接在没用过的部位里挑（每套正好 4 件 = 4 部位，
       * 40 级以上按口径必须四件齐，这里就不再留空。 */
      const candidates = gearsOfSet.filter((id) => {
        const it = gearInst(id);
        return it && !usedType.has(it.type);
      });
      if (!candidates.length) break;
      const gid = candidates[Math.floor(Math.random() * candidates.length)];
      const info = gearInst(gid);
      if (!info) continue;
      usedType.add(info.type);
      const extSlots = fusionSlots(info.quality);
      const ext = extSlots ? randomExt(extSlots, info.quality >= 3 ? 3 : 2) : [];
      const attrPct = rollGearAttrPct();                                    // 主属性同样 ±5% 浮动
      const piece = { id: gid, used: true, ext, attr: gearAttrValueOf(gid, attrPct), attrPct };
      const ref = Math.max(1, Math.floor(Number(refLevel) || level));
      if (info.quality === 3 && Math.random() < aiOrangeChance(ref)) {
        piece.orange = true;
        if (Math.random() < aiGemChance(ref)) {
          const lv = aiGemLevel(ref);
          if (lv) piece.gem = { id: 100 + lv };
        }
      }
      out.push(piece);
    }
    return out;
  }

  function stageProgress(stageId) {
    return clone(S.stages[stageId] || { npcIndex: 1, passed: false });
  }
  function setStageProgress(stageId, prog) {
    stageId = Number(stageId);
    if (!npcOf(stageId, 1) || !object(prog)) return false;
    const previous = stageProgress(stageId);
    const total = GData.stageEnemyCount ? GData.stageEnemyCount(stageId) : 3;
    const passed = previous.passed || prog.passed === true;
    S.stages[stageId] = { npcIndex: passed ? total : Math.min(total, Math.max(previous.npcIndex, integer(prog.npcIndex, 1, 1))), passed };
    save();
    return true;
  }
  function npcOf(stageId, npcIndex) {
    stageId = Number(stageId); npcIndex = Number(npcIndex);
    if (stageId >= 19 && stageId <= 36) {
      if (npcIndex !== 1) return null;
      const star = ((stageId - 19) % 6) + 1;
      const gate = Math.floor((stageId - 19) / 6);
      const templateStage = [1, 7, 13][gate] + (star - 1);
      const base = npcOf(templateStage, 3);
      if (!base) return null;
      const hp = GData.stageNpcHp(stageId, 1);
      const name = String(base.name || '').replace(/^\d+星/, '');
      return Object.assign({}, base, {
        id: 's' + stageId, name: '超级' + name, stageId: String(stageId), npcIndex: '1',
        isBoss: 'true', hp: String(hp),
      });
    }
    let found = null;
    npcsMap.each((k, v) => {
      const actualStage = Number(v.id) === 127 ? 10 : Number(v.stageId);
      if (actualStage === stageId && Number(v.npcIndex) === npcIndex) found = actualStage === Number(v.stageId) ? v : Object.assign({}, v, { stageId: String(actualStage) });
    });
    // 攻略数值为准：同星级同位置的NPC血量一致（三位师父只差攻击模式）
    const hp = found && GData.stageNpcHp(stageId, npcIndex);
    if (found && hp) found = Object.assign({}, found, { hp: String(hp) });
    return found;
  }

  function highestStageId() {
    let highest = 1;
    for (const id of Object.keys(S.stages)) if (S.stages[id].passed) highest = Math.max(highest, Number(id) + 1);
    return highest;
  }
  function stageRun(stageId) { return S.stageRuns && S.stageRuns[stageId] ? clone(S.stageRuns[stageId]) : null; }
  function stageAccess(stageId) {
    stageId = Number(stageId);
    if (!Number.isInteger(stageId) || !npcOf(stageId, 1)) return { ok: false, msg: '没有这个关卡。' };
    if (S.level < 10) return { ok: false, msg: '没有10级，不能挑战我们盖世五侠哦，加油哦！' };
    if (stageId > highestStageId() && !stageRun(stageId)) return { ok: false, msg: '请先通过前面关卡。' };
    return { ok: true };
  }
  function stageReward(stageId) {
    // 整轮经验 = 每场逐场经验之和（超级大关只有 1 场）；逐场发放，此处仅用于界面展示与离线估算
    const count = GData.stageEnemyCount ? GData.stageEnemyCount(stageId) : 3;
    let exp = 0;
    for (let i = 1; i <= count; i++) exp += GData.stageNpcExp(stageId, i);
    const gold = (GData.isSuperStage && GData.isSuperStage(stageId) ? 35 : 25) * (GData.STAGE_GOLD_MULT || 1);
    return { exp, gold };
  }
  /** 关卡连战里「先上阵」的徒弟：原版 `fightType == 6` 时服务端把左方设成徒弟，
   *  离线版**优先派等级最高的徒弟**出战（用户 2026-10 口径：徒弟里最强的那位上，
   *  没有徒弟就直接师父上阵。 */
  function stagePrentice() {
    const list = (Array.isArray(S.prentices) ? S.prentices : []).filter((p) => p && p.name);
    if (!list.length) return null;
    let best = list[0], bestLevel = Number(best.level) || 0;
    for (let i = 1; i < list.length; i++) {
      const lv = Number(list[i].level) || 0;
      if (lv > bestLevel) { best = list[i]; bestLevel = lv; }
    }
    return best;
  }
  /** 把徒弟快照变成可交给 `Main.startBattle({ fighter })` 的玩家侧面板。
   *  三维/武器/技能沿用收徒时保存的快照；装备补 `wears` 供经典战斗立绘使用。 */
  function stagePrenticeFighter() {
    const row = stagePrentice();
    if (!row) return null;
    const full = (typeof ensureFriendLoadout === 'function' ? ensureFriendLoadout(row) : row) || row;
    const level = Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(full.level, 1, 1)));
    let power = Number(full.power) || 0, agility = Number(full.agility) || 0;
    let speed = Number(full.speed) || 0, hp = Number(full.hp) || 0;
    if (!power || !agility || !speed || !hp) {
      const roll = genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
      power = power || roll.power; agility = agility || roll.agility;
      speed = speed || roll.speed; hp = hp || roll.hp;
    }
    const weapons = (full.weapons || []).map((w) => typeof w === 'string' ? weaponInst(w) : w).filter(Boolean);
    const skills = (full.skills || []).map((v) => typeof v === 'string' ? skillInst(v) : v).filter(Boolean);
    /* ⚠ 必须把 `gears` 一起交出去（哪怕是空数组）。
     * 用户 2026-10-24 报的就是这个。空数组 = 徒弟确实没穿，不再借用玩家的。 */
    const gears = normalizeFoeGears(full.gears || []);
    let wears = [null, null, null, null, null, null];
    try { wears = Engine.wearsFor(gears); } catch (e) {}
    return {
      name: full.name, level, power, agility, speed, hp: Math.max(1, Math.round(hp)), maxHp: Math.max(1, Math.round(hp)),
      baseStats: { power, agility, speed, hp },
      weapons, skills, gears, wears,
      effects: {}, masterLevel: S.level,
      isPrentice: true,
    };
  }
  let stageAttemptSeq = 0;
  function beginStageBattle(stageId) {
    stageId = Number(stageId);
    const access = stageAccess(stageId);
    if (!access.ok) return access;
    S.stageRuns = S.stageRuns || {};
    let run = S.stageRuns[stageId];
    if (run && run.attempt) return { ok: false, msg: '这场战斗尚未结束。' };
    if (run && run.needsRevive && run.revives >= 2) return { ok: false, msg: '本轮已用完2次复活机会，请结束本轮后重新挑战。' };
    const costsBook = !run || run.needsRevive;
    if (costsBook && !debugOn('noStageCost')) {
      if (!(S.props[23] > 0)) return { ok: false, needsBook: true, msg: '挑战书不足，快去商店中购买吧！' };
      S.props[23]--;
    }
    let reviving = false;
    if (!run) run = S.stageRuns[stageId] = { npcIndex: 1, revives: 0, needsRevive: false, masterOnly: false };
    else if (run.needsRevive) { reviving = true; run.revives++; run.needsRevive = false; }
    const prentice = !run.masterOnly && !reviving ? stagePrentice() : null;
    run.attempt = 'stage_' + Date.now() + '_' + (++stageAttemptSeq);
    save();
    return { ok: true, npcIndex: run.npcIndex, token: run.attempt,
      role: prentice ? 'prentice' : 'master', prentice: prentice ? prentice.name : null };
  }
  function interruptStageBattle(stageId, token) {
    const run = S.stageRuns && S.stageRuns[stageId];
    if (!run || run.attempt !== token) return false;
    delete run.attempt;
    save();
    return true;
  }
  function stagePrenticeLost(stageId, token, foeRatio) {
    const run = S.stageRuns && S.stageRuns[stageId];
    if (!run || run.attempt !== token) return false;
    delete run.attempt;
    run.masterOnly = true;
    delete run.carryHp;
    if (foeRatio != null && Number.isFinite(Number(foeRatio))) run.foeCarryHp = Math.max(0, Math.min(1, Number(foeRatio)));
    else delete run.foeCarryHp;
    save();
    return true;
  }
  function finishStageBattle(stageId, token, win, carryRatio) {
    stageId = Number(stageId);
    const run = S.stageRuns && S.stageRuns[stageId];
    if (!run || run.attempt !== token) return { ok: false };
    delete run.attempt;
    /* 每场结算后对手血量都不再保留：打赢进入下一名对手，打输复活也是满血重打。 */
    delete run.foeCarryHp;
    if (!win) {
      run.needsRevive = true;
      delete run.carryHp;   // 复活再战回满血
      save();
      return { ok: true, win: false, complete: false, exp: 0, gold: 0, ups: [], run: stageRun(stageId) };
    }
    const fightExp = GData.stageNpcExp(stageId, run.npcIndex);
    const total = GData.stageEnemyCount ? GData.stageEnemyCount(stageId) : 3;
    const complete = run.npcIndex === total;
    const old = stageProgress(stageId);
    const nextNpc = Math.min(total, run.npcIndex + 1);
    S.stages[stageId] = { npcIndex: Math.max(old.npcIndex, nextNpc), passed: old.passed || complete };
    if (complete) {
      delete S.stageRuns[stageId];
      noteChallengeClear();
    }
    else {
      run.npcIndex = nextNpc;
      if (Number.isFinite(carryRatio)) run.carryHp = Math.max(0, Math.min(1, carryRatio));
    }
    // 关卡碎片掉落：本次击败的 NPC 就可能掉碎片（不必等到整轮通关）。
    //   螳螂(1-6) 白为主 / 仙鹤(7-12) 绿为主 / 熊猫(13-18) 蓝为主（蓝为上限）。
    //   攻略.md：3星螳螂「大多白、小概率绿」，6星「绿色几率提高」——故 ★3-4 越1级、★5-6 越2级。
    const star = GData.stageStar(stageId);
    const frag = GData.STAGE_FRAGMENT;
    let drop = null;
    if (Math.random() < GData.stageChallengeFragmentChance(star)) {
      const superStage = !!(GData.isSuperStage && GData.isSuperStage(stageId));
      /* 普通 3 门：白/绿/蓝按大关递进；超级 3 门：直接掉蓝碎片（原版超级关的奖励档位更高）。 */
      const base = superStage ? 26 : 24 + Math.floor((stageId - 1) / 6);
      const up = superStage ? 0 : star >= 5 ? 2 : star >= 3 ? 1 : 0;
      const step = Math.min(base + up, 26);                     // 蓝碎片封顶
      let id = up > 0 && Math.random() >= frag.tierUp ? step : base;
      /* 蓝色碎片（26）**除碎片竞技场外**所有掉落都小幅降期望（2026-10 用户口径）：
       *   · 熊猫关（基础就是蓝）：这一次掉落干脆不给，白/绿本来也不在这里出；
       * 只动「蓝」这一档，螳螂的白/绿基础掉落完全不变。 */
      if (id === 26 && Math.random() >= Number(GData.BLUE_SHARD_DROP_MUL)) id = base === 26 ? 0 : base;
      if (id) {
        const count = GData.stageFragmentCount();
        S.props[id] = (S.props[id] || 0) + count;
        drop = { id, count, name: propMap.getValue(id).name };
      }
    }
    const gold = complete ? stageReward(stageId).gold : 0;
    /* 【祭坛当日状态 3】"关卡金松果双倍"：原版 `getBufRewarTips` / `parseGainBuff`
     * 于是界面显示的 `gold` 与实际入账永远是同一个数（不会出现"显示双倍、账上没加"）。 */
    let goldBuff = false;
    if (gold > 0 && activeBuildingBuff('stageGold')) {
      const rate = buildingDoubleRate('altar', 'stageGold');
      if (rate > 0 && Math.random() * 100 < rate) goldBuff = true;
    }
    addGold(gold * (goldBuff ? 2 : 1));
    const gem = complete ? rollGemDrop(20) : null;
    /* 金宝箱不再从超级关循环掉落：原版只在 71~90 级每级发 1 个（且可重开 500 次），
     * 这里同样只保留升级产出，否则「总属性点」会重新变成无上限。
     * 返回值里的 `chest` 字段保留给界面/回归读（现在恒为 null）。 */
    const chest = null;
    const ups = gainExp(fightExp);
    save();
    return { ok: true, win: true, complete, drop, gem, chest, ups, run: stageRun(stageId), exp: fightExp,
      gold: gold * (goldBuff ? 2 : 1), goldBase: gold, goldBuff: goldBuff };
  }
  function abandonStageRun(stageId) {
    if (!S.stageRuns || !S.stageRuns[stageId] || S.stageRuns[stageId].attempt) return false;
    delete S.stageRuns[stageId];
    save();
    return true;
  }

  // 本地日历日期，避免 UTC 日期造成午夜前后重复领取或晚八小时刷新。
  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** 调试开关「12 小时一天」：打开后一天只有 12 小时，过了中午就算第二天。 */
  function shortDay() { return !!(window.Debug && window.Debug.enabled && window.Debug.enabled('shortDay')); }
  // 打开「12 小时一天」时，12:00 起换成第二天的日期键，所有每日刷新在 0 点与 12 点各来一次；
  // 格式仍是 YYYY-MM-DD（存档校验 validLocalDate、earnOn 按日期查表都依赖它）。
  function localDate() {
    const now = new Date(Date.now());
    if (shortDay() && now.getHours() >= 12) {
      const next = new Date(now.getTime());
      next.setDate(next.getDate() + 1);
      return dateKey(next);
    }
    return dateKey(now);
  }
  function syncDailyStats() {
    const date = localDate();
    if (S.dailyStatsDate === date) return;
    if (S.dailyStatsDate) {
      S.dailyWins = 0;
      S.dailyFails = 0;
      S.joinRankCount = 0;
    }
    S.dailyStatsDate = date;
    if (object(S.challengeDaily) && S.challengeDaily.date !== date) S.challengeDaily = null;
    if (S.quests && S.quests.date !== date) S.quests = null;
    if (S.dailyCounters && S.dailyCounters.date !== date) S.dailyCounters = null;
    save();
  }
  // 常驻挑战当日通关次数：一整轮 3 场全胜才 +1（与每日任务的「每赢一场」分开计数），
  // 每次通关后所有敌人全属性 +5%、可叠；随每日刷新归零。挑战塔/无尽塔不读这里。
  function challengeDaily() {
    const date = localDate();
    const cur = object(S.challengeDaily) ? S.challengeDaily : null;
    if (!cur || cur.date !== date) return { date, count: 0 };
    return { date, count: Math.max(0, Math.floor(Number(cur.count) || 0)) };
  }
  function challengeDailyCount() { return challengeDaily().count; }
  function noteChallengeClear() {
    const cur = challengeDaily();
    S.challengeDaily = { date: cur.date, count: cur.count + 1 };
    save();
    return S.challengeDaily.count;
  }
  /* 每日礼包的「金松果之外」奖励：按本地日期轮换，每天换一种。
   * 用户 2026-10 口径：只在挑战书 / 英雄帖 / 勇气徽章 / 召唤证 / 三种超级药丸之间轮换。 */
  const DAILY_GIFT_EXTRAS = Object.freeze([
    { id: 23, name: '挑战书' }, { id: 36, name: '英雄帖' }, { id: 39, name: '勇气徽章' },
    { id: 82, name: '召唤证' }, { id: 41, name: '超级大力丸' }, { id: 42, name: '超级敏捷丸' }, { id: 43, name: '超级速度丸' },
  ]);
  /** 某一天（默认今天）轮到的每日礼包附加奖励。用 UTC 日期序号取模，跨时区/跨重载稳定。 */
  function dailyGiftExtra(date) {
    const src = validLocalDate(date) ? String(date) : localDate();
    const [y, m, d] = src.split('-').map(Number);
    const day = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
    const n = DAILY_GIFT_EXTRAS.length;
    const idx = ((day % n) + n) % n;
    return Object.assign({ count: 1, index: idx, date: src }, DAILY_GIFT_EXTRAS[idx]);
  }
  function dailyStatus() {
    const date = localDate();
    const claimed = S.dailyClaimDate === date;
    const days = Math.max(0, integer(S.loginStreak, 0, 0));
    /* 连续天数：今天已领 → 记的天数；昨天领过 → 今天续上；否则从 1 重新算。
     * 挑战书 / 英雄帖 / 勇气徽章 / 召唤证 / 三种超级药丸之间轮换。 */
    const streak = claimed ? Math.max(1, days)
      : (S.dailyClaimDate === yesterdayDate() ? Math.max(1, days) + 1 : 1);
    const extra = dailyGiftExtra(date);
    return { date, claimed, streak, gold: Math.min(150, 100 + (streak - 1) * 10), extra,
      newbie: newbieGift(date),
      /* 兼容旧界面/旧调用：只有轮到挑战书时才是 1。 */
      challengeBooks: extra.id === 23 ? extra.count : 0 };
  }
  /** 新号前三天（按建号本地日期算）的每日礼包附加福利：3 个大体力药剂 + 150 金松果。
   *  老档没有 `newbieStartDate`，一律不补，避免把老玩家当新号。 */
  function newbieGift(date) {
    const src = validLocalDate(date) ? String(date) : localDate();
    const start = validLocalDate(S.newbieStartDate) ? String(S.newbieStartDate) : '';
    if (!start) return null;
    const toDay = (s) => {
      const [y, m, d] = String(s).split('-').map(Number);
      return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
    };
    const day = toDay(src) - toDay(start) + 1;
    if (day < 1 || day > 3) return null;
    return { day, gold: 150, propId: 2, count: 3, name: '新手福利' };
  }

  const QUEST_TYPES = [
    { key: 'win',       name: '赢下 {n} 场对战',          steps: [2, 3, 5] },
    { key: 'fight',     name: '进行 {n} 场战斗',          steps: [4, 6, 8] },
    { key: 'challenge', name: '发起 {n} 次随机挑战',      steps: [2, 3, 5] },
    { key: 'stage',     name: '通关 {n} 次关卡挑战',      steps: [2, 3, 5], minLevel: 10 },
    { key: 'arena',     name: '参加 {n} 次竞技场比赛',    steps: [1, 2, 3], minLevel: 11 },
    { key: 'rank',      name: '参加 {n} 场天梯赛',        steps: [2, 3, 5], minLevel: 30 },
    { key: 'spar',      name: '和好友切磋 {n} 次',        steps: [1, 2, 3] },
    { key: 'lottery',   name: '抽取 {n} 次每日幸运抽奖',  steps: [1, 2] },   // 每日免费只有 1 次，最多要求 2 次
    { key: 'merge',     name: '合成或融合 {n} 次装备',    steps: [1, 2, 3], minLevel: 10 },
    { key: 'gem',       name: '合成 {n} 次宝石',          steps: [1, 2, 3], minLevel: 45 },
    { key: 'upgrade',   name: '升级武器或技能 {n} 次',    steps: [1], minLevel: 2 },   // 固定 1 次；全都升不动时整条不出现，见 questPoolFor
    { key: 'use',       name: '使用 {n} 个道具',          steps: [2, 4, 6] },
    { key: 'buy',       name: '在商店购买 {n} 件道具',    steps: [1, 2, 3] },
    { key: 'pickup',    name: '拾取 {n} 次战斗掉落',      steps: [1, 2, 3] },
    { key: 'energy',    name: '消耗 {n} 点体力',          steps: [10, 20, 30] },
  ];
  const QUEST_COUNT = 4;
  const QUEST_KEYS = QUEST_TYPES.map((q) => q.key);
  /** 这条任务在 level 级能不能做（没写 minLevel 的就是 1 级就能做）。 */
  function questAvailableAt(key, level) {
    const type = QUEST_TYPES.find((q) => q.key === key);
    if (!type) return false;
    return (type.minLevel || 1) <= Math.max(1, Number(level) || 1);
  }
  /**
   * 现在还有没有「升得动」的武器/技能：既没到自身等级上限，玩家等级也满足该级的等级门槛。
   * 两者任一不满足就升不了，所以只要一件升得动，「升级武器或技能」这条任务才有意义。
   */
  function hasUpgradableWS(level) {
    if (!S) return false;
    const lv = Math.max(1, Number(level) || S.level);
    for (const kind of ['weapon', 'skill']) {
      const list = kind === 'weapon' ? myWeapons() : mySkills();
      for (const it of list) {
        const info = upgradeInfo(kind, it.id);
        if (info && !info.max && lv >= info.levelLimit) return true;
      }
    }
    return false;
  }
  /**
   * 当前等级可完成的每日任务池（按 QUEST_TYPES 的固定顺序，保证同一天同一等级抽题稳定）。
   * 「升级武器或技能」额外要求手上真有升得动的武技：全都顶到等级上限时整条不触发。
   */
  function questPoolFor(level) {
    const lv = Math.max(1, Number(level) || 1);
    const pool = QUEST_TYPES.filter((q) => (q.minLevel || 1) <= lv);
    return hasUpgradableWS(lv) ? pool : pool.filter((q) => q.key !== 'upgrade');
  }
  function emptyCounters(date) {
    const counters = { date };
    for (const key of QUEST_KEYS) counters[key] = 0;
    return counters;
  }
  const QUEST_GOLD = { kind: 'gold', weight: 1.4, range: [10, 30] };
  const QUEST_EXP = { kind: 'exp', weight: 1.4, range: [50, 80] };
  const QUEST_EXTRA_POOL = [
    { id: 21, range: [3, 5], weight: 1.2 },   // 技能卷轴
    { id: 22, range: [3, 5], weight: 1.2 },   // 武器卷轴
    { id: 23, range: [1, 2], weight: 1.0 },   // 挑战书
    { id: 1, range: [1, 2], weight: 1.0 },    // 小体力药剂
    { id: 7, range: [1, 1], weight: 0.7, pill: true },    // 经验丸
    { id: 45, range: [1, 1], weight: 0.2 },   // 天使果实种子（0.5×）
    { id: 2, range: [1, 1], weight: 0.3 },    // 大体力药剂（高级）
    { id: 44, range: [1, 1], weight: 0.06, pill: true },  // 超级经验丸（高级药丸，概率大幅下调）
  ];

  function questSeed(date) {
    let h = 2166136261;
    for (const ch of String(date)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function questRng(seed) {
    let state = seed || 1;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  }
  const questRoll = (rnd, range) => range[0] + Math.floor(rnd() * (range[1] - range[0] + 1));

  function rollQuests() {
    const date = localDate();
    const rnd = questRng(questSeed(date));
    const pool = questPoolFor(S ? S.level : 1).map((q) => q.key);
    // Fisher–Yates：同一天的抽取顺序固定，刷新页面不会换题
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, Math.min(QUEST_COUNT, pool.length)).map((key) => {
      const type = QUEST_TYPES.find((q) => q.key === key);
      const tier = Math.floor(rnd() * type.steps.length);
      // 纯随机 1~2 项：金松果、经验、道具在同一个加权池里抽，抽到才给
      const bag = [QUEST_GOLD, QUEST_EXP].concat(QUEST_EXTRA_POOL.map((item) => ({
        kind: 'prop', id: item.id, weight: item.weight, range: item.range, pill: item.pill,
      })));
      const rewardCount = rnd() < 0.45 ? 1 : 2;
      const rewards = [];
      for (let i = 0; i < rewardCount && bag.length; i++) {
        const total = bag.reduce((sum, item) => sum + item.weight, 0);
        let roll = rnd() * total, pick = 0;
        for (let j = 0; j < bag.length; j++) { roll -= bag[j].weight; if (roll <= 0) { pick = j; break; } }
        const item = bag.splice(pick, 1)[0];
        rewards.push({
          kind: item.kind, id: item.id,
          count: item.pill ? 1 : questRoll(rnd, item.range),
        });
      }
      return { key, need: type.steps[tier], rewards, claimed: false };
    });
  }
  function questState() {
    const date = localDate();
    const level = S ? S.level : 1;
    const hasList = S.quests && typeof S.quests === 'object' && Array.isArray(S.quests.list) && S.quests.list.length > 0;
    const sameDay = !!(S.quests && S.quests.date === date);
    // 「升级武器或技能」还要看手上是否真有升得动的武技——把最后一件升满之后这条当天就该消失。
    const staleLevel = hasList && S.quests.list.some((q) => !q || !questAvailableAt(q.key, level)
      || (q.key === 'upgrade' && !hasUpgradableWS()));
    if (!hasList || !sameDay || staleLevel) {
      // 重抽时把「已经领过的条数」照旧占位，避免升级换题后当天多领一份奖励
      const claimedCount = sameDay && hasList ? S.quests.list.filter((q) => q && q.claimed === true).length : 0;
      S.quests = { date, list: rollQuests() };
      S.quests.list.forEach((q, i) => { q.claimed = i < claimedCount; });
      if (!sameDay) S.dailyCounters = emptyCounters(date);
      save();
    }
    if (!S.dailyCounters || S.dailyCounters.date !== date) {
      S.dailyCounters = emptyCounters(date);
      save();
    }
    return S.quests;
  }
  /** 记录一次当天行为供每日任务计数；silent=true 只改内存不落盘，
   *  由外层在动作末尾统一 save() 一次（避免一次结算连写多次存档）。 */
  function bumpDaily(key, n, silent) {
    if (!QUEST_KEYS.includes(key)) return 0;
    questState();
    S.dailyCounters[key] = Math.max(0, (Number(S.dailyCounters[key]) || 0) + (Number(n) || 1));
    if (!silent) save();
    return S.dailyCounters[key];
  }
  function bumpBattleDaily(win, kind) {
    bumpDaily('fight', 1, true);
    if (win) bumpDaily('win', 1, true);
    if (kind === 'stage' && win) bumpDaily('stage', 1, true);
    if (kind === 'arena') bumpDaily('arena', 1, true);
    if (kind === 'rank') bumpDaily('rank', 1, true);
    if (kind === 'friend') bumpDaily('spar', 1, true);
    if (kind === 'challenge') bumpDaily('challenge', 1, true);
  }
  /** 兼容旧档：老任务只有 gold/exp/extras，新任务直接存 rewards。 */
  function questRewards(q) {
    const nameOf = (id) => { const item = propMap.getValue(id); return item ? item.name : '道具'; };
    const out = [];
    if (Array.isArray(q.rewards) && q.rewards.length) {
      for (const r of q.rewards) {
        if (!r) continue;
        if (r.kind === 'gold') out.push({ kind: 'gold', id: 8, name: '金松果', count: Math.max(1, Number(r.count) || 1) });
        else if (r.kind === 'exp') out.push({ kind: 'exp', id: 15, name: '经验', count: Math.max(1, Number(r.count) || 1) });
        else if (r.id) out.push({ kind: 'prop', id: Number(r.id), name: nameOf(r.id), count: Math.max(1, Number(r.count) || 1) });
      }
      return out;
    }
    if (q.gold) out.push({ kind: 'gold', id: 8, name: '金松果', count: q.gold });
    if (q.exp) out.push({ kind: 'exp', id: 15, name: '经验', count: q.exp });
    for (const extra of Array.isArray(q.extras) ? q.extras : []) {
      if (extra && extra.id) out.push({ kind: 'prop', id: Number(extra.id), name: nameOf(extra.id), count: Math.max(1, Number(extra.count) || 1) });
    }
    return out;
  }
  function questStatus() {
    const quests = questState(), counters = S.dailyCounters;
    return quests.list.map((q, index) => {
      const type = QUEST_TYPES.find((t) => t.key === q.key) || { name: q.key };
      const progress = Math.min(q.need, Number(counters[q.key]) || 0);
      const rewards = questRewards(q);
      const pick = (kind) => { const r = rewards.find((x) => x.kind === kind); return r ? r.count : 0; };
      return {
        index, key: q.key, need: q.need,
        gold: pick('gold'), exp: pick('exp'),
        extras: rewards.filter((r) => r.kind === 'prop').map((r) => ({ id: r.id, count: r.count })),
        rewards,
        name: String(type.name).replace('{n}', q.need),
        progress, done: progress >= q.need, claimed: q.claimed === true,
        claimable: progress >= q.need && q.claimed !== true,
      };
    });
  }
  function questClaimable() { return questStatus().filter((q) => q.claimable).length; }
  function claimQuest(index) {
    const list = questStatus();
    const row = list[Number(index)];
    if (!row) return { ok: false, msg: '没有这个任务' };
    if (row.claimed) return { ok: false, msg: '这条任务已经领过了' };
    if (!row.done) return { ok: false, msg: '任务还没完成' };
    questState().list[row.index].claimed = true;
    const parts = [];
    for (const r of row.rewards) {
      if (r.kind === 'gold') { addGold(r.count); parts.push('金松果 +' + r.count); }
      else if (r.kind === 'exp') { gainExp(r.count); parts.push('经验 +' + r.count); }
      else { S.props[r.id] = (S.props[r.id] || 0) + r.count; parts.push(r.name + ' +' + r.count); }
    }
    save();
    return { ok: true, msg: '领取成功：' + parts.join('、'), gold: row.gold, exp: row.exp, extras: row.extras, rewards: row.rewards, ups: [] };
  }
  function claimDaily() {
    const daily = dailyStatus();
    if (daily.claimed) return { ok: false, msg: '今天的奖励已经领取，明天再来吧！', date: daily.date };
    const extra = daily.extra || dailyGiftExtra(daily.date);
    addGold(daily.gold);
    S.props[extra.id] = (S.props[extra.id] || 0) + extra.count;
    const newbie = daily.newbie || null;
    if (newbie) {
      addGold(newbie.gold);
      S.props[newbie.propId] = (S.props[newbie.propId] || 0) + newbie.count;
    }
    S.loginStreak = daily.streak;
    S.dailyClaimDate = daily.date;
    save();
    const newbieMsg = newbie
      ? '，新手福利：大体力药剂 +' + newbie.count + '、金松果 +' + newbie.gold
      : '';
    return { ok: true, msg: '连续登录 ' + daily.streak + ' 天：金松果 +' + daily.gold + '，' + extra.name + ' +' + extra.count + newbieMsg,
      gold: daily.gold + (newbie ? newbie.gold : 0), extra, newbie,
      challengeBooks: extra.id === 23 ? extra.count : 0, streak: daily.streak, date: daily.date };
  }

  function validBattle(entry) {
    return object(entry) && object(entry.me) && object(entry.foe) && object(entry.result)
      && Array.isArray(entry.result.rounds) && entry.result.rounds.length > 0 && entry.result.rounds.length <= 240
      && Array.isArray(entry.result.maxHp) && entry.result.maxHp.length === 2 && entry.result.maxHp.every((hp) => Number.isFinite(hp) && hp > 0)
      && entry.result.rounds.every((round) => object(round) && (round.attacker === 0 || round.attacker === 1)
        && Array.isArray(round.hpAfter) && round.hpAfter.length === 2 && round.hpAfter.every((hp) => Number.isFinite(hp) && hp >= 0))
      && (entry.result.winner === 0 || entry.result.winner === 1);
  }
  function normalizeBattleHistory(list) {
    return (Array.isArray(list) ? list : []).filter(validBattle).slice(0, BATTLE_HISTORY_LIMIT);
  }
  function trimBattleHistory(slot) {
    if (!Array.isArray(slot.battles)) slot.battles = [];
    else if (slot.battles.length > BATTLE_HISTORY_LIMIT) slot.battles.splice(BATTLE_HISTORY_LIMIT);
    return slot.battles;
  }
  function battlePayloadNeedsTrim(raw) {
    if (!object(raw)) return false;
    const slots = [raw, raw.__dualOther];
    if (object(raw.__dualSaves)) for (const mode of SAVE_SLOTS) slots.push(raw.__dualSaves[mode]);
    return slots.some((slot) => object(slot) && Array.isArray(slot.battles) && slot.battles.length > BATTLE_HISTORY_LIMIT);
  }
  function normalizeWoodBest(raw) {
    if (!object(raw)) return null; // 旧档没有分项，不能从总伤害猜出三类。
    return {
      handDamage: integer(raw.handDamage, 0),
      weaponDamage: integer(raw.weaponDamage, 0),
      skillDamage: integer(raw.skillDamage, 0),
    };
  }
  /** MainMovie.as:getRecord / showDeadManWin：徒手、武器、技能三个本场累计值。
   * 本地分别保存各类单场最佳；它们可能来自不同场，不拿它们的和冒充最高总伤害。 */
  function recordWoodBattle(result) {
    if (!S || !result || !Array.isArray(result.rounds) || !result.rounds.length) return null;
    const current = { handDamage: 0, weaponDamage: 0, skillDamage: 0, total: 0 };
    const types = { common: 'handDamage', weapon: 'weaponDamage', skill: 'skillDamage' };
    for (const round of result.rounds) {
      if (!round || round.attacker !== 0 || round.selfDot) continue;
      const damage = integer(round.dmg, 0);
      current.total += damage;
      if (types[round.action]) current[types[round.action]] += damage;
    }
    const best = normalizeWoodBest(S.woodBest) || { handDamage: 0, weaponDamage: 0, skillDamage: 0 };
    for (const key of Object.keys(best)) best[key] = Math.max(best[key], current[key]);
    S.woodBest = best;
    S.woodCount = integer(S.woodCount, 0) + 1;
    S.woodDamage = Math.max(integer(S.woodDamage, 0), current.total);
    save();
    return { current, best: clone(best), totalBest: S.woodDamage, count: S.woodCount };
  }
  let battleKeySeq = 1;
  function recordBattle(entry) {
    if (!validBattle(entry)) return null;
    let snapshot;
    try { snapshot = clone(entry); } catch (e) { return null; }
    const history = trimBattleHistory(S);
    do { snapshot.id = 'b' + Date.now() + '_' + battleKeySeq++; } while (history.some((battle) => battle && battle.id === snapshot.id));
    snapshot.createdAt = Date.now();
    snapshot.kind = typeof snapshot.kind === 'string' ? snapshot.kind : '挑战';
    snapshot.region = integer(snapshot.region, 0);
    snapshot.winner = snapshot.result.winner;
    S.battles = [snapshot].concat(history).slice(0, BATTLE_HISTORY_LIMIT);
    bumpBattleDaily(snapshot.winner === 0, snapshot.kind);
    save();
    /* 不再 clone 第二遍：`snapshot` 已写进 S.battles，返回值只给调用方读/展示；
     * 以前这里多深拷一份 360 KB 的录像，是战斗结束卡顿的一部分（2026-10 审计）。 */
    return snapshot;
  }
  function battleHistory() { return clone(S ? trimBattleHistory(S) : []); }
  /* 「消息」红点的两个出口（经典主界面 `SfUiMain.hasNewMessages` 用）：
   * 记 Now() 在时钟回拨或列表还没刷新时会漏判。 */
  function msgSeenAt() { return Math.max(0, integer(S && S.msgSeenAt, 0, 0)); }
  function markMessagesSeen() {
    const newest = (S && Array.isArray(S.battles) && S.battles.length) ? (Number(S.battles[0].createdAt) || 0) : 0;
    /* 没有消息时**不动**记账：否则开一次消息页会把时间戳推到现在，
     * 之后打的第一场战斗（createdAt 更早一点点）就被判成"已看过"。 */
    if (!newest) return 0;
    if (newest > msgSeenAt()) { S.msgSeenAt = newest; save(); }
    return S.msgSeenAt;
  }

  /* 调试账本：第一次发放时记基线（before），回收量 = min(granted, 当前-before)，
   * 花掉的部分只少收、不倒扣；武器/技能记第一次调试前等级，装备按实例 key 记。
   * 等级/经验/属性只进历史索引、不自动回退（会破坏升级链与天赋）。 */
  const DEBUG_LEDGER_MAX_HISTORY = 200;
  function debugLedgerEnsure() {
    if (!S) return null;
    if (!object(S.debugLedger)) {
      S.debugLedger = { v: 1, createdAt: Date.now(), props: {}, gold: null, goldCup: null, exp: null, weapons: {}, skills: {}, gears: [], history: [] };
    }
    const L = S.debugLedger;
    if (!object(L.props)) L.props = {};
    if (!object(L.weapons)) L.weapons = {};
    if (!object(L.skills)) L.skills = {};
    if (!Array.isArray(L.gears)) L.gears = [];
    if (!Array.isArray(L.history)) L.history = [];
    if (!Number.isFinite(Number(L.createdAt))) L.createdAt = Date.now();
    return L;
  }
  /** 当前武器/技能列表 → {id: level}，给快照与回收判断共用。 */
  function debugLevelMap(list) {
    const out = {};
    for (const entry of Array.isArray(list) ? list : []) {
      const [id, lv] = String(entry).split(':').map(Number);
      if (Number.isFinite(id) && id > 0) out[id] = Math.max(0, Number(lv) || 0);
    }
    return out;
  }
  function debugLevelOf(list, id) {
    for (const entry of Array.isArray(list) ? list : []) {
      const [wid, lv] = String(entry).split(':').map(Number);
      if (wid === Number(id)) return Math.max(0, Number(lv) || 0);
    }
    return 0;
  }
  /** 调试操作前的快照：只取会被发放/改动的字段，不深拷录像等大对象。 */
  function debugSnapshot() {
    if (!S) return null;
    return {
      props: Object.assign({}, S.props),
      goldPoint: Number(S.goldPoint) || 0,
      goldCup: Number(S.goldCup) || 0,
      exp: Number(S.exp) || 0,
      level: Number(S.level) || 1,
      power: Number(S.power) || 0, agility: Number(S.agility) || 0,
      speed: Number(S.speed) || 0, maxHp: Number(S.maxHp) || 0,
      weapons: debugLevelMap(S.weapons), skills: debugLevelMap(S.skills),
      gearKeys: (Array.isArray(S.gears) ? S.gears : []).map((g) => String(g.key)),
      wsPicks: Array.isArray(S.wsPicks) ? S.wsPicks.length : 0,
    };
  }
  function debugPushHistory(L, label, changes) {
    if (!L || !object(changes)) return;
    const entry = { at: Date.now(), label: String(label || '调试') };
    for (const key of ['props', 'weapons', 'skills', 'gears', 'gold', 'goldCup', 'exp', 'level', 'stats', 'picks', 'cleared']) {
      const v = changes[key];
      if (v == null) continue;
      if (Array.isArray(v) && !v.length) continue;
      if (object(v) && !Array.isArray(v) && !Object.keys(v).length) continue;
      if (typeof v === 'number' && !v) continue;
      entry[key] = v;
    }
    if (Object.keys(entry).length <= 2) return;
    L.history.push(entry);
    if (L.history.length > DEBUG_LEDGER_MAX_HISTORY) L.history.splice(0, L.history.length - DEBUG_LEDGER_MAX_HISTORY);
  }
  /** 记录「操作前快照 → 操作后」的净增量。debug.js 在所有发放按钮外面包一层。 */
  function debugRecordDiff(before, label) {
    if (!before || !S) return null;
    const L = debugLedgerEnsure();
    if (!L) return null;
    const changes = {};
    const propChanges = {};
    for (const id of Object.keys(S.props || {})) {
      const now = Number(S.props[id]) || 0, was = Number(before.props[id]) || 0;
      if (now <= was) continue;
      const delta = now - was;
      let e = L.props[id];
      if (!object(e)) e = L.props[id] = { before: was, granted: 0 };
      if (!Number.isFinite(Number(e.before))) e.before = was;
      e.granted = Math.max(0, Number(e.granted) || 0) + delta;
      propChanges[id] = delta;
    }
    if (Object.keys(propChanges).length) changes.props = propChanges;

    const cur = (key, name) => {
      const now = Number(S[key]) || 0, was = Number(before[key]) || 0;
      if (now <= was) return;
      const delta = now - was;
      let e = L[name];
      if (!object(e)) e = L[name] = { before: was, granted: 0 };
      if (!Number.isFinite(Number(e.before))) e.before = was;
      e.granted = Math.max(0, Number(e.granted) || 0) + delta;
      changes[name] = delta;
    };
    cur('goldPoint', 'gold');
    cur('goldCup', 'goldCup');

    const levelGain = Math.max(0, (Number(S.level) || 1) - (Number(before.level) || 1));
    const expGain = levelGain ? 0 : Math.max(0, (Number(S.exp) || 0) - (Number(before.exp) || 0));
    const stats = {
      power: Math.max(0, (Number(S.power) || 0) - (Number(before.power) || 0)),
      agility: Math.max(0, (Number(S.agility) || 0) - (Number(before.agility) || 0)),
      speed: Math.max(0, (Number(S.speed) || 0) - (Number(before.speed) || 0)),
      maxHp: Math.max(0, (Number(S.maxHp) || 0) - (Number(before.maxHp) || 0)),
    };
    const hasStats = Object.values(stats).some((n) => n > 0);
    if (levelGain || expGain || hasStats) {
      let e = L.exp;
      if (!object(e)) e = L.exp = { beforeLevel: Number(before.level) || 1, beforeExp: Number(before.exp) || 0, grantedExp: 0, levels: 0, stats: { power: 0, agility: 0, speed: 0, maxHp: 0 } };
      if (!object(e.stats)) e.stats = { power: 0, agility: 0, speed: 0, maxHp: 0 };
      e.levels = Math.max(0, Number(e.levels) || 0) + levelGain;
      e.grantedExp = Math.max(0, Number(e.grantedExp) || 0) + expGain;
      for (const k of Object.keys(stats)) e.stats[k] = Math.max(0, Number(e.stats[k]) || 0) + stats[k];
      if (levelGain) changes.level = levelGain;
      if (expGain) changes.exp = expGain;
      if (hasStats) changes.stats = stats;
    }

    const diffList = (list, beforeMap, target, keyName) => {
      const out = {};
      for (const id of Object.keys(debugLevelMap(list))) {
        const now = debugLevelOf(list, id), was = Number(beforeMap[id]) || 0;
        if (now <= was) continue;
        let e = target[id];
        if (!object(e)) e = target[id] = { before: was, granted: 0 };
        if (!Number.isFinite(Number(e.before))) e.before = was;
        e.granted = Math.max(Number(e.granted) || 0, now);
        out[id] = now;
      }
      if (Object.keys(out).length) changes[keyName] = out;
      return out;
    };
    diffList(S.weapons, before.weapons, L.weapons, 'weapons');
    diffList(S.skills, before.skills, L.skills, 'skills');

    const gearChanges = [];
    const beforeGears = new Set(Array.isArray(before.gearKeys) ? before.gearKeys : []);
    for (const g of (Array.isArray(S.gears) ? S.gears : [])) {
      const key = String(g.key);
      if (!key || beforeGears.has(key)) continue;
      if (!L.gears.includes(key)) L.gears.push(key);
      gearChanges.push(key);
    }
    if (gearChanges.length) changes.gears = gearChanges;

    const pickGain = Math.max(0, (Array.isArray(S.wsPicks) ? S.wsPicks.length : 0) - (Number(before.wsPicks) || 0));
    if (pickGain) changes.picks = pickGain;

    if (!Object.keys(changes).length) return null;
    debugPushHistory(L, label, changes);
    save();
    return changes;
  }
  /** 玩家主动遗忘武技：把账本里同名记录去掉，避免之后它被重新学会时被误判成调试所得。 */
  function debugForgetWS(kind, id) {
    if (!S || !object(S.debugLedger)) return;
    const map = kind === 'skill' ? S.debugLedger.skills : S.debugLedger.weapons;
    if (object(map)) delete map[Number(id)];
    save();
  }
  /** 账本摘要：给系统页/清理弹窗用。entries 是**当前还能回收**的条目。 */
  function debugLedgerSummary() {
    const L = S && object(S.debugLedger) ? S.debugLedger : null;
    if (!L) return { hasData: false, entries: [], history: [], removable: 0 };
    const entries = [];
    const addProp = (id, e, kind, name) => {
      const now = kind === 'gold' ? Number(S.goldPoint) || 0 : kind === 'goldCup' ? Number(S.goldCup) || 0 : Number(S.props[id]) || 0;
      const before = Math.max(0, Number(e && e.before) || 0);
      const granted = Math.max(0, Number(e && e.granted) || 0);
      const remove = Math.min(granted, Math.max(0, now - before));
      if (remove > 0) entries.push({ kind, id, name, remove, before, granted, current: now });
    };
    for (const id of Object.keys(L.props || {})) {
      const def = propMap.getValue(Number(id));
      addProp(id, L.props[id], 'prop', def ? def.name : ('道具#' + id));
    }
    if (object(L.gold)) addProp(8, L.gold, 'gold', '金松果');
    if (object(L.goldCup)) addProp(40, L.goldCup, 'goldCup', '金杯');
    const addWS = (map, kind) => {
      for (const id of Object.keys(map || {})) {
        const e = map[id];
        const list = kind === 'weapon' ? S.weapons : S.skills;
        const now = debugLevelOf(list, id);
        if (!now) continue;
        const before = Math.max(0, Number(e && e.before) || 0);
        const granted = Math.max(0, Number(e && e.granted) || 0);
        if (now > before && now <= granted) {
          const def = (kind === 'weapon' ? weaponsMap : skillsMap).getValue(Number(id));
          entries.push({ kind, id: Number(id), name: def ? def.name : (kind + '#' + id),
            mode: before > 0 ? 'restore' : 'remove', before, granted, current: now });
        }
      }
    };
    addWS(L.weapons, 'weapon');
    addWS(L.skills, 'skill');
    const gearKeys = new Set((Array.isArray(S.gears) ? S.gears : []).map((g) => String(g.key)));
    for (const key of (Array.isArray(L.gears) ? L.gears : [])) {
      if (!gearKeys.has(String(key))) continue;
      const g = (Array.isArray(S.gears) ? S.gears : []).find((x) => String(x.key) === String(key));
      const def = g && gearMap.getValue(g.id);
      entries.push({ kind: 'gear', key: String(key), name: def ? def.name : '装备', remove: 1 });
    }
    const exp = object(L.exp) ? {
      levels: Math.max(0, Number(L.exp.levels) || 0),
      grantedExp: Math.max(0, Number(L.exp.grantedExp) || 0),
      stats: object(L.exp.stats) ? L.exp.stats : null,
    } : null;
    const history = (Array.isArray(L.history) ? L.history : []).slice(-20);
    return { hasData: entries.length > 0 || history.length > 0, entries, history, removable: entries.length, exp, createdAt: Number(L.createdAt) || 0 };
  }
  /**
   * 等级/经验/属性不回退；已经花掉/融合掉/卖掉的调试物品无法找回，也不倒扣。
   */
  function clearDebugGains() {
    if (!S) return { ok: false, msg: '还没有存档' };
    const sum = debugLedgerSummary();
    if (!sum.entries.length) return { ok: false, msg: '没有可回收的调试所得', summary: sum };
    const removed = [];
    for (const e of sum.entries) {
      if (e.kind === 'prop') {
        const left = Math.max(0, (Number(S.props[e.id]) || 0) - e.remove);
        if (left > 0) S.props[e.id] = left; else delete S.props[e.id];
        removed.push(e.name + '×' + e.remove);
      } else if (e.kind === 'gold') {
        S.goldPoint = Math.max(0, (Number(S.goldPoint) || 0) - e.remove);
        removed.push('金松果×' + e.remove);
      } else if (e.kind === 'goldCup') {
        S.goldCup = Math.max(0, (Number(S.goldCup) || 0) - e.remove);
        removed.push('金杯×' + e.remove);
      } else if (e.kind === 'weapon' || e.kind === 'skill') {
        const list = e.kind === 'weapon' ? S.weapons : S.skills;
        const at = list.findIndex((x) => Number(String(x).split(':')[0]) === Number(e.id));
        if (at >= 0) {
          if (e.mode === 'remove') list.splice(at, 1);
          else list[at] = Number(e.id) + ':' + e.before;
          removed.push(e.name + (e.mode === 'remove' ? '（移除）' : '（还原到 Lv' + e.before + '）'));
        }
      } else if (e.kind === 'gear') {
        const beforeLen = (Array.isArray(S.gears) ? S.gears : []).length;
        S.gears = (Array.isArray(S.gears) ? S.gears : []).filter((g) => String(g.key) !== String(e.key));
        if (S.gears.length !== beforeLen) removed.push(e.name + '（装备）');
      }
    }
    const L = debugLedgerEnsure();
    L.props = {}; L.gold = null; L.goldCup = null; L.exp = null;
    L.weapons = {}; L.skills = {}; L.gears = []; L.clearedAt = Date.now();
    L.history.push({ at: Date.now(), label: '清理调试所得', cleared: removed.length });
    if (L.history.length > DEBUG_LEDGER_MAX_HISTORY) L.history.splice(0, L.history.length - DEBUG_LEDGER_MAX_HISTORY);
    save();
    return { ok: true, removed, summary: debugLedgerSummary(), msg: '已清理 ' + removed.length + ' 项调试所得' };
  }

  const RANK_DIVISIONS = Object.freeze([
    { key: 'd30', lo: 30, hi: 39, frame: 1, label: '30级-39级' },
    { key: 'd40', lo: 40, hi: 49, frame: 2, label: '40级-49级' },
    { key: 'd50', lo: 50, hi: 59, frame: 3, label: '50级-59级' },
    { key: 'd60', lo: 60, hi: 69, frame: 4, label: '60级-69级' },
    { key: 'd70', lo: 70, hi: 79, frame: 5, label: '70级-79级' },
    { key: 'd80', lo: 80, hi: 90, frame: 6, label: '80级-90级' },
  ]);
  const RANK_BOT_BASE_SCORE = 300;
  const RANK_BOT_FLOOR = 50;
  const RANK_BOT_PER_LEVEL = 3;
  const RANK_DAILY_LIMIT = 30;
  const RANK_FREE_PLAYS = 10;
  const RANK_PAID_COST = 5;
  const RANK_LATE_FROM = 20;
  const RANK_LATE_COST = 10;
  function rankFeeAt(played) {
    const n = Math.max(0, Math.floor(Number(played) || 0));
    if (n >= RANK_DAILY_LIMIT || n < RANK_FREE_PLAYS) return 0;
    return n >= RANK_LATE_FROM ? RANK_LATE_COST : RANK_PAID_COST;
  }
  const RANK_BOT_NAMES = Object.freeze([
    '松果见习生', '橡子巡逻员', '树洞守卫', '月光拾荒者', '雾林邮差', '坚果学徒',
    '古树见习', '溪谷哨兵', '星屑旅人', '雪原新兵', '苔原猎手', '树冠信使',
  ]);

  /** 每周一 0 点（本地时间）为界，返回周一的 YYYY-MM-DD。 */
  function rankWeekKey(now) {
    const d = new Date(Number(now) || Date.now());
    d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7;   // 周一 = 0
    d.setDate(d.getDate() - dow);
    return dateKey(d);
  }

  function rankDivisionOf(level) {
    const lv = Math.floor(Number(level) || 0);
    return RANK_DIVISIONS.find((d) => lv >= d.lo && lv <= d.hi) || null;
  }

  function rankBotPlan() {
    const out = [];
    let idx = 0;
    for (const d of RANK_DIVISIONS) {
      for (let lv = d.lo; lv <= d.hi; lv++) {
        for (let k = 0; k < RANK_BOT_PER_LEVEL; k++) {
          idx += 1;
          out.push({
            id: 'bot:' + d.key + ':' + lv + ':' + k, level: lv,
            name: RANK_BOT_NAMES[(idx - 1) % RANK_BOT_NAMES.length] + '·' + lv,
          });
        }
      }
    }
    return out;
  }

  function normalizeRankBots(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      if (!object(item)) continue;
      const id = String(item.id || '');
      if (!/^bot:/.test(id)) continue;
      out.push({
        id,
        level: Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(item.level, 1, 1))),
        name: String(item.name || '').slice(0, 24),
        score: Math.max(RANK_BOT_FLOOR, integer(item.score, 0)),
        wins: Math.max(0, integer(item.wins, 0)),
        losses: Math.max(0, integer(item.losses, 0)),
      });
    }
    return out;
  }

  function rankWeeksBetween(from, to) {
    const a = Date.parse(String(from) + 'T00:00:00Z');
    const b = Date.parse(String(to) + 'T00:00:00Z');
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
    return Math.max(1, Math.round((b - a) / (7 * 86400000)));
  }

  /** 换周：玩家积分减半、人机回 300 分清空胜负，幂等。首次（无 rankWeek 的旧档）只补
   *  本周标识与名册、不动已有积分，下一次真正的周一才开始减半。 */
  function rankSyncWeek() {
    const s = state();
    if (!s) return false;
    const week = rankWeekKey();
    const bots = Array.isArray(s.rankBots) ? s.rankBots : [];
    if (s.rankWeek === week && bots.length) return false;
    const fresh = !s.rankWeek;
    const missed = fresh ? 1 : rankWeeksBetween(s.rankWeek, week);
    s.rankWeek = week;
    if (!fresh) {
      s.integral = Math.max(0, Math.floor((Number(s.integral) || 0) / Math.pow(2, missed)));
      s.rankWeekMatches = 0;
      s.rankWins = 0;
      s.rankLosses = 0;
    }
    s.rankBots = rankBotPlan().map((b) => ({
      id: b.id, level: b.level, name: b.name, score: RANK_BOT_BASE_SCORE, wins: 0, losses: 0,
    }));
    save();
    return true;
  }

  function rankCompareRows(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (!!a.bot !== !!b.bot) return a.bot ? 1 : -1;
    return String(a.botId || a.name).localeCompare(String(b.botId || b.name));
  }

  /** 本赛区的完整榜（真人只有自己 + 该赛区人机），名次已排好。 */
  function rankBoard() {
    const s = state();
    const week = rankWeekKey();
    if (!s) return { week, division: null, frame: 0, label: '', top: [], me: { score: 0, rank: 0 } };
    rankSyncWeek();
    const div = rankDivisionOf(s.level);
    if (!div) return { week, division: null, frame: 0, label: '', top: [], me: { score: Math.max(0, Number(s.integral) || 0), rank: 0 } };
    const rows = [];
    for (const b of (s.rankBots || [])) {
      if (!b || !rankDivisionOf(b.level) || rankDivisionOf(b.level).key !== div.key) continue;
      rows.push({ bot: true, botId: b.id, name: b.name, level: b.level, score: b.score, wins: b.wins, losses: b.losses });
    }
    rows.push({
      bot: false, botId: '', name: s.name || '我', level: s.level,
      score: Math.max(0, Number(s.integral) || 0),
      wins: Math.max(0, Number(s.rankWins) || 0), losses: Math.max(0, Number(s.rankLosses) || 0), mine: true,
    });
    rows.sort(rankCompareRows);
    rows.forEach((row, i) => { row.rank = i + 1; });
    const me = rows.find((r) => r.mine);
    return {
      week, division: { key: div.key, lo: div.lo, hi: div.hi, frame: div.frame, label: div.label },
      frame: div.frame, label: div.label, top: rows,
      me: { score: me ? me.score : 0, rank: me ? me.rank : 0 },
    };
  }

  /** 随机挑一个对手人机：优先分数相近的 5 个，避免总打同一个人。 */
  function rankOpponent() {
    const board = rankBoard();
    if (!board.division) return null;
    const bots = board.top.filter((r) => r.bot);
    if (!bots.length) return null;
    const mine = Number(board.me.score) || 0;
    const near = bots.slice().sort((a, b) => Math.abs(a.score - mine) - Math.abs(b.score - mine)).slice(0, 5);
    return near[Math.floor(Math.random() * near.length)] || bots[0];
  }

  /** 积分档：与联机同一套（对手更高 +16；否则按分差 15/2/1/0，输了取负）。
   *  单机版没有联机版的「300 分以上只匹配真人 / 回落人机不计分」规则；
   *  在单机不会把收益抹成 0）。 */
  function rankIntegralDelta(myScore, foeScore, win, opts) {
    const gap = Number(foeScore) - Number(myScore);
    let mag;
    if (gap > 0) mag = 16;
    else {
      const ahead = -gap;
      if (ahead < 50) mag = 15;
      else if (ahead < 200) mag = 2;
      else if (ahead < 500) mag = 1;
      else mag = 0;
    }
    const delta = win ? mag : -mag;
    const floor = Math.max(0, Math.floor(Number(opts && opts.minWinGain) || 0));
    return (win && floor > 0) ? Math.max(floor, delta) : delta;
  }

  /** 一场天梯打完：玩家与人机同时结算（人机分数也真的会变）。 */
  function rankApplyResult(botId, win, delta) {
    const s = state();
    if (!s) return null;
    rankSyncWeek();
    const d = Math.round(Number(delta) || 0);
    s.integral = Math.max(0, Math.round((Number(s.integral) || 0) + d));
    s.rankWeekMatches = Math.max(0, Number(s.rankWeekMatches) || 0) + 1;
    if (win) s.rankWins = Math.max(0, Number(s.rankWins) || 0) + 1;
    else s.rankLosses = Math.max(0, Number(s.rankLosses) || 0) + 1;
    const bot = (s.rankBots || []).find((b) => b && String(b.id) === String(botId));
    if (bot) {
      /* 人机积分跟玩家反向同步结算，硬下限 50。 */
      bot.score = Math.max(RANK_BOT_FLOOR, Math.min(100000, Math.round((Number(bot.score) || 0) - d)));
      if (win) bot.losses = Math.max(0, Number(bot.losses) || 0) + 1;
      else bot.wins = Math.max(0, Number(bot.wins) || 0) + 1;
    }
    save();
    return { integral: s.integral, bot: bot ? { id: bot.id, score: bot.score } : null };
  }

  /** 周奖励资格：本赛区前 30、且至少超过一个人机、本周打过至少一场。 */
  function rankAwardStatus() {
    const s = state();
    if (!s) return { eligible: false, rank: 0, played: 0, surpassedBot: false, week: rankWeekKey(), claimed: false };
    const board = rankBoard();
    const meIdx = board.top.findIndex((r) => r.mine);
    const rank = meIdx >= 0 ? meIdx + 1 : 0;
    const surpassedBot = meIdx >= 0 && board.top.slice(meIdx + 1).some((r) => r.bot);
    const played = Math.max(0, Number(s.rankWeekMatches) || 0);
    const claimed = String(s.rankCupClaimWeek || '') === board.week;
    return {
      week: board.week, division: board.division, rank, played, surpassedBot,
      eligible: played > 0 && rank > 0 && rank <= 30 && surpassedBot,
      cups: 50, claimed,
    };
  }

  function claimRankCup() {
    const s = state();
    if (!s) return { ok: false, rank: 0, cups: 0, msg: '还没有存档。' };
    const st = rankAwardStatus();
    if (st.claimed) return { ok: false, already: true, rank: st.rank, cups: 0, goldCup: s.goldCup, msg: '本周的天梯奖励已经领取过了。' };
    if (!st.played) return { ok: false, rank: st.rank, cups: 0, goldCup: s.goldCup, msg: '本周还没有参加天梯赛，先打一场再来领奖吧。' };
    if (!(st.rank > 0) || st.rank > 30) return { ok: false, rank: st.rank, cups: 0, goldCup: s.goldCup, msg: '本周没有进入赛区前30名，暂时没有金杯奖励。' };
    if (!st.surpassedBot) return { ok: false, rank: st.rank, cups: 0, goldCup: s.goldCup, msg: '还没有超过任何一个赛区人机，暂时没有金杯奖励。' };
    s.goldCup = Math.max(0, Number(s.goldCup) || 0) + 50;
    s.rankCupClaimWeek = st.week;
    save();
    return { ok: true, rank: st.rank, cups: 50, goldCup: s.goldCup, msg: '恭喜进入赛区前30名，成功获得50个金杯奖励！' };
  }

  window.State = {
    saveKey: SAVE_KEY, uiModeKey: UI_MODE_KEY, testMode: !!testMode, rememberUiMode,
    save, load, newGame, state, switchMode, activeUiMode, hasModeSave, tickEnergy, energyCountdown,
    fileProbe, fileLoad, fileWrite, fileWriteNow, fileInfo, storageMode, flushFileWrite, setSaveTransport, hasFileTransport, readFileRaw, importFileRaw, exportPayload, restorePayload, prepareImport, verifyImport, importFingerprint, syncFormatTime: fmtTime, markLocalFresh: () => { fileState.freshLocal = true; },
    hasLocalSave, localSaveMeta, fileLoadedThisBoot,
    debugSnapshot, debugRecordDiff, debugForgetWS, debugLedgerSummary, clearDebugGains,
    vipActive, vipLevel, vipUntil, vipDaysLeft, vipRegenMul, vipPassiveExpCap, vipExpNeed,
    vipRow, buyVip, grantVip, tickVipDaily, gearCapacity, syncVipEnergyCap,
    VIP_LEVELS, VIP_LEVEL_EXP, VIP_MAX_LEVEL, VIP_PLANS, VIP_ENERGY_BONUS, vipEnergyCap, VIP_GEAR_BONUS, GEAR_CAPACITY,
    weaponInst, skillInst, myWeapons, mySkills, wsLimit, ownedWSCount,
    upgradeInfo, doUpgrade, upgradeFails, UPGRADE_COIN, UPGRADE_FAIL_BONUS,
    isTrueLevel, TRUE_SKILL_MAX_LEVEL,
    fruitOptions, applyFruitChoice, cancelFruitChoice, pendingFruitChoices,
    trackEarn, earnOn, ensureYesterdayEarnings, addGold,
    apprenticeTributeTable,
    TRIBUTE_LEVEL_SUM_FULL,
    undoPoint, undoDepth, hasUpgradableWS,
    gearInst, myGears, wear, unwear, sellGear, gearSellPrice, gearSellRange, gearQuality, gearAttrText, composeGear, mergeGears, addGear, grantStarterGear, extText, extTextForGear, extExtraText, extExtraTextForGear, randomExt,
    blackGearEnabled, isBlackGearId, BLACK_PROP_IDS,
    gearBaseAttr, gearAttrPctOf, gearAttrPctClamp, gearAttrValueOf, fusionAttrPctOf, rollGearAttr, rollGearAttrPct, gearCostOf,
    GEAR_ATTR_PCT_MAX, GEAR_ATTR_JITTER: GEAR_ATTR_PCT_MAX / 100,
    FUSION_SAME_NAME_RATE, FUSION_MUTANT_RATE, FUSION_MUTANT_SET, FUSION_ORANGE_MUTANT_SET, FUSION_EXT_UPGRADE_RATE,
    FUSION_ONLINE_MUTANT_RATE, FUSION_EXT_INHERIT_RATE, FUSION_EXT_SLOTS,
    toggleGearStar, isGearStarred, gearsInDisplayOrder,
    gemLevel, gemPercent, gemMergeRate, rollGemDrop, mergeGems, socketGem, unsocketGem, canSocketGem, gemAffixUnits, attachmentValue, GEM_AFFIX_UNITS,
    totalStats, equipmentEffects, shopLimit, purchaseStatus, buyProp, useProp, openChestProp, gainRandomWS, wsChoices, wsInfo,
    chestState, beginChest, confirmChest, reopenChest, chestReopenCost, CHEST_REOPEN_MAX, settlePendingChest,
    blackCardOptions, applyBlackCard, blackGearBoxOptions, applyBlackGearBox,
    ENDLESS_BLACK_CARD_CAP, blackCardWeekKey, syncBlackCardsWeek, endlessBlackCardLeft, grantEndlessBlackCard,
    pendingWS, currentWSChoices, chooseWS, chooseWSRandom,
    /* 30 级「自愿支持作者」的一次性提示（落存档，不换任何游戏内好处）。 */
    supportPromptPending, supportPromptTake, supportPromptReset, SUPPORT_LEVEL,
    SPEED_UNLOCK_LEVEL, SKIP_UNLOCK_LEVEL, VIP_SKIP_UNLOCK_LEVEL, unlockedSpeed, unlockedSkip, skipButtonEnabled,
    BERSERK_SET_ID, BERSERK_LEVEL, BERSERK_CHANCE_AT_50, BERSERK_CHANCE_AT_70, berserkChance,
    AI_FULL_GEAR_LEVEL, aiToolMinLevel, aiToolMaxLevel, aiGearMinLevel,
    playerNormalTotal, playerMaxTotal, playerTotalBounds, foeTotalStats, applyFoeTotalBounds, foeLoadout,
    GEM_SOCKET_COST,
    gainExp, consumeEnergy, tickPropStates, fightReward, revengeReward, markRevenged, revengeInfo, noteRevenge, REVENGE_EXP_RATIO, expBoostPct, gainExpWithBoost,
    apprenticeTributeExpRatio, apprenticeTributeGoldRatio, TRIBUTE_EXP_MIN, TRIBUTE_EXP_MAX, TRIBUTE_GOLD_MIN, TRIBUTE_GOLD_MAX,
    apprenticeCap, learnSkill, setMaster, clearMaster, addPrentice, removePrentice,
    /* 村庄建筑（祭坛 / 神迹 / 幻兽牧场）：等级 / 升级 / 当日状态 / 神迹属性点。 */
    BUILDING_UP_INFO, BUILDING_MAX_LEVEL, BUILDING_KEYS, BUILDING_IDS, BUILDING_LABEL,
    BUILDING_UNLOCK_LEVEL, WAR_UNLOCK_LEVEL, buildingUnlockLevel,
    building, buildingUnlocked, buildingTier, buildingUpInfo, upgradeBuilding,
    settleBuildings, buildingBuffClaimed, claimBuildingBuff, activeBuildingBuff,
    buildingDoubleRate, miracleRecord, normalizeFoeGears,
    petLeadership, PET_UNLOCK_LEVEL, pets, petByKey, petTeam, hatchPet, setPetTeam, feedPet, evolvePet, petBattleBonus, applyPetBonuses, randomPetLoadout, PETS, PET_SKILLS,
    gearPart, gearPartQuality, gearIdsOf, autoEnergyPotion,
    gearSetFamily, fusionFamilyInfo, setPieceCounts, setBonusOf, setBonusEffects, setBonusList, setBonusForGear,
    applySetBonuses, applyFoeSetBonuses,
    apprenticeDailyExp, apprenticeDailyGold, apprenticeDailyTotal, apprenticeDailyStatus,
    apprenticeLevelSum, apprenticeTributeRatio, claimApprenticeExp, canKickToday, kickPrentice,
    beginRecruitChallenge, finishRecruitChallenge, cancelRecruitChallenge,
    MASTER_SKILL_ID, MASTER_SKILL_NAME,
    genAI, randomAIName, fitAIName, clipAIName, AI_NAME_MAX,
    RANDOM_FOE_SCALE, stageProgress, setStageProgress, npcOf, highestStageId, stageRun, stageAccess, stageReward,
    beginStageBattle, finishStageBattle, interruptStageBattle, abandonStageRun, stagePrentice, stagePrenticeFighter, stagePrenticeLost,
    localDate, dailyStatus, dailyGiftExtra, challengeDailyCount, noteChallengeClear, refreshDaily: syncDailyStats, claimDaily, recordBattle, battleHistory, recordWoodBattle,
    /* 「消息」红点的记账（落存档，见 normalizeSave 里 msgSeenAt 那段注释）。 */
    msgSeenAt, markMessagesSeen,
    questStatus, questClaimable, claimQuest, bumpDaily, QUEST_TYPES, QUEST_EXTRA_POOL, QUEST_GOLD, QUEST_EXP,
    questState, questAvailableAt, questPoolFor, QUEST_COUNT,
    settings, setSettings, normalizeSettings, RESOLUTIONS, resolutionHeight,
    UIMODES, UIMODE_KEYS,
    sellProp, propSellPrice, sellableProps, PROP_SELL_OVERRIDES, MIN_SELL_PRICE,
    BAG_CURRENCY_PROP, isBagCurrencyProp, bagCountOf,
    friendLimit, friendList, friendOf, addFriend, removeFriend, friendFoe, rollFriendCandidates, FRIEND_LIMIT, ensureFriendLoadout,
    friendMessages, leaveFriendMessage, FRIEND_MESSAGE_MAX,
    weaponList, skillList, setWeapon, setSkill, forgetWeapon, forgetSkill, setWS, forgetWS,
    composeConvertPill, composeSeed, challengeExp, challengeFightsPerLevel, usePropMany, energyHardCap, ENERGY_HARD_CAP, PROP_HARD_CAP,
    MAX_PLAYER_LEVEL, energyCapForLevel,
    RANK_DIVISIONS, rankWeekKey, rankDivisionOf, rankBotPlan, rankSyncWeek,
    rankBoard, rankOpponent, rankIntegralDelta, rankApplyResult, rankAwardStatus, claimRankCup,
    RANK_DAILY_LIMIT, RANK_FREE_PLAYS, RANK_PAID_COST, RANK_LATE_FROM, RANK_LATE_COST, rankFeeAt,
    statShares, forcedStat, lowestStat, pendingPoints, allocatePoint, allocateEvenly,
    STAT_SHARE_MIN, SHARE_KEYS, STAT_KEYS, STAT_NAMES, STAT_GAIN, HP_PER_STAT, FREE_POINT_RANDOM,
    STAT_HARD_CAP, permanentStatTotal, statCapRoom, clampPermanentStats,
    CHALLENGE_EXP_BASE, CHALLENGE_EXP_PER_LEVEL, CHALLENGE_EXP_CAP_LEVEL, EXP_DIFF_STEP, EXP_DIFF_TIGHTEN,
    CHALLENGE_DIFF_RANGE, ARENA_CHAMPION_EXP, ARENA_ENERGY_COST, ARENA_EXP_PER_ENERGY,
  };
})();
