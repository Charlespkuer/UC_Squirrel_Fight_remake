/* ============================================================
 * state.js — 玩家状态、存档、养成系统（武器/技能/装备/道具/关卡）
 * 数值规则复刻自原版 player.js 与 GameDict.js
 * ============================================================ */

/* ------------------------------------------------------------
 * 目录：玩家状态 / 存档 / 养成系统
 * Ctrl+F 搜节号（如「【S1】」）直达对应代码块。
 *
 *  【S1】基础  【S2】师徒系统  【S3】存档
 *  【S4】体力  【S5】武器/技能实例  【S6】升级武器/技能
 *  【S7】真·武器 / 真·技能  【S8】装备  【S9】宝石
 *  【S10】属性合计  【S11】道具  【S12】天使果实 / 恶魔果实
 *  【S13】自由属性点  【S14】每日收益流水  【S15】经验 / 升级
 *  【S16】战斗后结算  【S17】超级松鼠  【S18】好友
 *  【S19】复仇  【S20】AI 玩家生成  【S21】关卡
 *  【S22】每日任务  【S23】导出 window.State
 * ------------------------------------------------------------ */
(function () {
  'use strict';

  /* ============================================================
   * 【S1】基础：存档键 / 调试开关判定 / 新开局
   * ============================================================ */
  const testMode = typeof location !== 'undefined' && /(?:^|[?&])(?:test=[12]|qa=1)(?:&|$)/.test(location.search || '');
  const SAVE_KEY = testMode ? 'ssdz_test_save_v1' : 'ssdz_save_v1';
  /* 双界面独立存档：经典/现代各一份进度，同一条文件/localStorage 记录里放两个槽位。
   * 槽位选择存在 localStorage 的 ssdz_ui_mode（界面切换时由 UI 写入）。 */
  const UI_MODE_KEY = 'ssdz_ui_mode';
  const SAVE_SLOTS = ['modern', 'classic'];
  const DEFAULT_SAVE_SLOT = 'classic';
  const ENERGY_INTERVAL = 5 * 60 * 1000;
  const ENERGY_HARD_CAP = 999;
  /* 单个道具的数量上限：任何来源（掉落、礼包、任务、商店、调试）都不会超过它。
   * 收口放在 save()/normalizeSave 里，这样新增道具的地方不用各自记一遍。 */
  const PROP_HARD_CAP = 9999;
  /* 这三个编号在原版里是货币/经验值（挂进背包也用不掉），存档里出现就直接忽略。 */
  const CURRENCY_PROP_IDS = [8, 15, 40];
  const MAX_PLAYER_LEVEL = 70;
  /* 随机挑战/竞技场/天梯的对手难度系数（成长预算同曲线，这里补 AI 不会"挑点"的差距）。 */
  const RANDOM_FOE_SCALE = 1.08;
  const FREE_POINT_RANDOM = 2;
  /* 到这一级时给玩家一次「自愿支持作者」的提示（一次性，落存档；不换取任何游戏内好处）。 */
  const SUPPORT_PROMPT_LEVEL = 30;
  /* 自选点能加的四项，以及每一点给多少（生命一点 = 5 点血，和随机点、
   * 永久属性道具 19 的口径一致）。 */
  const STAT_KEYS = ['power', 'agility', 'speed', 'hp'];
  const STAT_NAMES = { power: '力量', agility: '敏捷', speed: '速度', hp: '生命' };
  const STAT_FIELDS = { power: 'power', agility: 'agility', speed: 'speed', hp: 'maxHp' };
  const STAT_GAIN = { power: 1, agility: 1, speed: 1, hp: 5 };
  /* 四项平衡的份额口径：生命按 HP_PER_STAT 点折算成 1 点属性。
   * 自然成长到 15 级时三项约 14.6、生命约 145，折算后四项刚好各占约 25%，
   * 所以「平均份额」= 25%，门槛取它的八成（20%）：某一项被压到平均的
   * 80% 以下时必须先补它，由系统直接代选（转化丸的「占比过低」是另一种口径）。 */
  const HP_PER_STAT = 10;
  const STAT_SHARE_MIN = 0.20;
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
   * 它只决定「展示层」（window.UI.classic 由哪一套原语实现提供），
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

  function normalizeSave(raw) {
    const next = Object.assign(clone(GData.NEW_PLAYER), raw);
    next.level = Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(next.level, GData.NEW_PLAYER.level, 1)));
    for (const key of ['power', 'agility', 'speed', 'maxHp']) {
      next[key] = integer(next[key], GData.NEW_PLAYER[key], 1);
    }
    for (const key of ['exp', 'energy', 'goldPoint', 'goldCup', 'dailyWins', 'allWins', 'dailyFails', 'allFails', 'reborn', 'joinRankCount', 'lotteryFree', 'woodRecord', 'woodCount', 'woodDamage', 'freePoints']) {
      next[key] = integer(next[key], GData.NEW_PLAYER[key]);
    }
    // 体力上限由等级直接决定（满级 180），再叠上超级松鼠的增量；旧档的旧曲线超额值在这里被收回。
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
    next.name = typeof next.name === 'string' && next.name.trim() ? next.name : '小松鼠';
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
    // 真升级的当日次数（费用递增，24:00 清零）：换天就归零
    next.trueUpgrades = (object(raw.trueUpgrades) && raw.trueUpgrades.date === localDate())
      ? { date: raw.trueUpgrades.date, count: Math.max(0, integer(raw.trueUpgrades.count, 0)) }
      : { date: localDate(), count: 0 };
    // 每日收益流水（徒弟日供）：只保留最近 7 天、日期合法、非负整数
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
        // 8 金松果 / 15 经验 / 40 金杯是货币与经验值（原版 useType 0/3），不该出现在背包里；
        if (CURRENCY_PROP_IDS.includes(Number(id))) continue;
        const count = Math.min(PROP_HARD_CAP, integer(source[id], 0));
        if (propMap.getValue(id) && count > 0) next[key][id] = count;
      }
    }
    const usedSlots = new Set(), gearKeys = new Set();
    next.gears = (Array.isArray(next.gears) ? next.gears : []).filter((g) => object(g) && gearMap.getValue(g.id)).map((g, index) => {
      const info = gearInst(g.id);
      let key = typeof g.key === 'string' && g.key ? g.key : 'legacy_' + index;
      if (gearKeys.has(key)) key += '_' + index;
      gearKeys.add(key);
      const used = g.used === true && info.useLevel <= next.level && !usedSlots.has(info.type);
      if (used) usedSlots.add(info.type);
      /* attr：本件装备的主属性点（基准 ±10% 的 roll 结果）。老档没这个字段时按基准值补。 */
      const entry = { id: info.id, key, used, ext: normalizeExt(g.ext),
        attr: integer(g.attr, 0, 0) || info.attrBase };
      if (g.orange === true) entry.orange = true;
      /* 星标：标记后不会被误融合 / 误出售（防止手滑把好装备合掉）。 */
      if (g.starred === true) entry.starred = true;
      const gemLv = g.gem && gemLevel(g.gem.id);
      if (gemLv) entry.gem = { id: 100 + gemLv, ext: Math.max(1, Math.min(99, integer(g.gem.ext, 1, 1))) };
      return entry;
    });
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
    const savedRuns = object(next.stageRuns) ? next.stageRuns : {};
    next.stageRuns = {};
    for (const id of Object.keys(savedRuns)) {
      const run = savedRuns[id];
      if (!npcOf(Number(id), 1) || !object(run)) continue;
      // A page reload interrupts playback, but never charges the entry/revival twice.
      next.stageRuns[id] = { npcIndex: Math.min(3, integer(run.npcIndex, 1, 1)), revives: Math.min(2, integer(run.revives, 0)), needsRevive: run.needsRevive === true };
      if (Number.isFinite(Number(run.carryHp))) next.stageRuns[id].carryHp = Math.max(0, Math.min(1, Number(run.carryHp)));
    }
    for (const id of Object.keys(next.stages)) {
      const progress = next.stages[id];
      if (!npcOf(Number(id), 1) || !object(progress)) { delete next.stages[id]; continue; }
      // Older saves recorded only the next NPC. Preserve that already-paid run.
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
        since: validLocalDate(p.since) ? p.since : localDate(),
        joinedAt: Number(p.joinedAt) > 0 ? Number(p.joinedAt) : localDateTime(validLocalDate(p.since) ? p.since : localDate(), 0, 0),
        lastExpDate: typeof p.lastExpDate === 'string' ? p.lastExpDate : '',
        tributeClaimedDate: validLocalDate(p.tributeClaimedDate) ? p.tributeClaimedDate : '',
      }));
    // Reload cancels an unfinished local recruitment and returns its entry fee.
    if (object(next.recruitChallenge) && next.recruitChallenge.fee === 10 && typeof next.recruitChallenge.token === 'string') next.goldPoint += 10;
    next.recruitChallenge = null;
    next.masterKickDate = typeof next.masterKickDate === 'string' ? next.masterKickDate : '';
    /* 村庄建筑（祭坛 / 神迹 / 幻兽牧场）：老档没有这个字段 → 按原版"每个建筑 1 级"补一份。
     * `upgrading` + `doneAt` 是"升级中"的倒计时；`buffId` + `buffDate` 是祭坛当天的随机状态
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
    next.battles = (Array.isArray(next.battles) ? next.battles : []).filter(validBattle).slice(0, 50);
    /* 「消息」上的红点（new）记账：**必须落存档**（用户 2026-10 口径）。
     * 经典主界面的红点判据是"消息列表里最新一条的时间戳 > 上次看过消息页的时间点"。
     * 这个"看到哪了"原本写在 localStorage（`ssdz_msg_seen`）—— 桌面壳（Tauri）的
     * WebView 每次启动都是新的数据目录，localStorage 不跨次启动保留，于是**每次打开游戏
     * 红点都重新亮一次**（用户报的就是"每次打开游戏后消息必有 new"）。
     * 落进存档就跟着 save/progress.json 走，换机器同步也一致（红点不会再重复亮）。
     * 形状只做浅校验：非负整数、不超过当前时间（未来时间会让红点再也不亮）。 */
    next.msgSeenAt = Math.min(Date.now(), integer(next.msgSeenAt, 0, 0));
    // 好友：只保留名字合法的条目，等级夹在 1~满级，最多 20 位
    next.friends = (Array.isArray(raw.friends) ? raw.friends : []).filter((f) => object(f) && typeof f.name === 'string' && f.name.trim())
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
    /* 连续登录天数（0 = 还没领过）。日期仍以 dailyClaimDate 为准，天数只做展示与加奖。 */
    next.loginStreak = Math.max(0, integer(next.loginStreak, 0, 0));
    /* 好友留言：只保留「好友名 → 最近 50 条 / 每条 ≤80 字」的干净结构。 */
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
    /* 常驻挑战的「当日已通关次数」（每日递增惩罚的计数，见 challengeDailyCount）。 */
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
    // 无尽挑战塔：浅校验（深校验在 tower.js 懒做）。进行中的战斗令牌一律作废——
    // 刷新/重进后重打该场，不重复扣挑战书、不掉层。
    {
      const runShape = (r) => {
        if (!object(r)) return null;
        const layer = Math.floor(Number(r.layer));
        if (!Number.isFinite(layer) || layer < 1 || !Array.isArray(r.plan) || !r.plan.length) return null;
        const copy = Object.assign({}, r);
        delete copy.attempt;
        copy.choices = null;
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
        shieldDate: typeof en.shieldDate === 'string' ? en.shieldDate : '',
        /* 【2026-10 第一百零三批 用户报的 bug】**剧情的「只播一次」记账必须跟着存档走**。
         * 它是**跨局**的账：第一次遇商人 / 第一次失去烙印 / 第一次遇巡视（`patrolGate`）…
         * 以前这里是一份显式白名单，没列到的字段一律丢掉 —— 于是「无尽塔玩到一半退出游戏再重进」
         * 之后所有「第一次」的文案都会重播一遍（用户实测：商店 / 烙印 / 巡视全变回第一次的文案）。
         * ⚠ 以后往 `endless()` 上加字段（尤其是各种「已经播过 / 已经给过」的计数）时，
         * **记得一起加到这里**，否则它就是「重载即清零」的易失字段。
         * 形状只做浅校验：保留**所有** id（旧档里可能有现在已删掉的剧情名，留着无害），
         * 丢掉非布尔的垃圾值。 */
        storySeen: (() => {
          const src = object(en.storySeen) ? en.storySeen : {};
          const out = {};
          for (const k of Object.keys(src)) if (src[k] === true || src[k] === 1) out[String(k)] = true;
          return out;
        })(),
        /* 剧情 / 挑战模式的开关（默认剧情模式）：同样不能在重载后被打回默认。 */
        storyOn: en.storyOn !== false,
        run: runShape(en.run),
      };
    }
    return next;
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
      uiMode: UIMODE_KEYS.includes(String(st.uiMode)) ? String(st.uiMode) : 'classic',
    };
  }
  /** 当前偏好（没有存档时给默认值，读到的对象就是存档里的那一份）。 */
  function settings() {
    if (!S) return normalizeSettings(null);
    if (!object(S.settings)) S.settings = normalizeSettings(null);
    return S.settings;
  }
  /** 改一项或几项偏好并立即存盘。 */
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
    const target = dual.slots[mode];
    const other = dual.slots[otherMode(mode)] || null;
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
    if (pref === legacyMode) {
      otherSlot = null;
      S = legacy;
      return true;
    }
    S = null;
    otherSlot = legacy;
    return false;
  }
  function adoptPayload(raw) {
    if (!object(raw)) return false;
    const dual = applyDualPayload(raw);
    return dual === null ? applyLegacyPayload(raw) : dual;
  }
  /** 当前界面 + 另一界面两份进度一起序列化；顶层仍是当前进度的原始字段，
   *  旧工具/同步脚本读 name/level/savedAt 不受影响。 */
  function savePayload() {
    if (!S) return S;
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

  /** 分辨率档位对应的高度（0 = 跟随窗口）。 */
  function resolutionHeight(key) {
    const row = RESOLUTIONS.find((r) => r.key === String(key));
    return row ? row.height : 0;
  }

  // ---------- 调试开关（js/debug.js 未加载时全部为关闭） ----------
  function debugOn(key) {
    try { return !!(window.Debug && window.Debug.enabled && window.Debug.enabled(key)); } catch (e) { return false; }
  }
  /* 【2026-10 用户口径】调试开关的唯一出口要**挂到 window** 上：
   * tower.js 里那句 `typeof debugOn === 'function' && debugOn(flag)` 找的是全局，
   * 而它以前只是这里的模块内函数 —— 于是挑战塔/无尽塔读调试开关**永远是 false**，
   * 「无尽试炼币拉满」「爬塔不耗挑战书」这两个开关因此一直是死的（用户实测报的就是这个）。
   * 挂上之后 bare `debugOn` 在 vm/浏览器里都能解析到它，两个模式里的调试开关才真正生效。 */
  if (typeof window !== 'undefined') window.debugOn = debugOn;

  /* ============================================================
   * 【S2】师徒系统（拜师/收徒/日供）
   * ============================================================ */
  // ---------- 师徒系统 ----------
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
  /** 拜师：记录师父（含等级、属性快照）并自动学会师父驾到。 */
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
  /** 出师：解除与师父的关系（花费用由界面负责扣除）。 */
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
  /* ============================================================
   * 【S2b】村庄建筑（祭坛 1 / 神迹 3 / 幻兽牧场 4）
   * ------------------------------------------------------------
   * 对齐原版 `MainMovie.as`：
   *   · `goHomeLand` 的服务端回包给每个建筑 `{buildingId, level, upgrading, upgraded,
   *     attrAdd, remainTime, buffId}`（:4346-4416），`buildingUnlock` 表在 :19145
   *     （`buildingUpInfo`：等级 1~30 的 碎片/经验/金松果双倍几率 + 升级金松果 + 升级小时）；
   *   · 「升级完成」在下次进入村庄时结算（`checkUpgraded` :9763），
   *     神迹那一档按 `attrAdd` 给 1 点力/敏/速 或 5 点生命（:9780-9801）；
   *   · 「领取当日随机状态」（`gainBuff` :4417）每天一次，三种之一：1 经验双倍 / 2 碎片双倍 /
   *     3 关卡金松果双倍，持续到当天 24:00（`buffId` 存在建筑上）。
   * 复刻没有服务端，所以这三套都落存档、用 `localDate()` 当天判定。
   * ============================================================ */
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
  const petNextExp = (level) => Math.max(100, Math.round(100 * Math.max(1, Number(level) || 1)));
  const buildingUnlocked = (key) => BUILDING_KEYS.includes(key);
  /** 建筑的"当前档位外观"：原版 `showUpgrading` 用 `ceil(level/5)` 挑立绘帧
   *  （MainMovie.as:9687/9696/9706）。这里只算，不碰界面。 */
  function buildingTier(level) {
    return Math.max(1, Math.min(6, Math.ceil(Math.max(1, Number(level) || 1) / 5)));
  }
  /** 升到「当前等级 + 1」需要的开销：原版取的是**当前等级那一行**（`getBuildingUpInfo(level)`，
   *  见 `homeLandLevelUp` :10887 与 `parseUpgradeBuilding` :4707）。 */
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
   *  `upgraded == "true"` 的建筑升一级，并按 `addType` 给神迹发属性点。
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
    /* 神迹的属性点是**加到玩家身上的**（原版 :4374-4387 直接改 `oldMyInfo.player`），
     * 所以这里同步写进四维基础值，`totalStats()` 一读就生效。 */
    for (const d of done) {
      if (d.key !== 'miracle') continue;
      const rec = S.buildings.miracle.add || {};
      /* 每次完成只加**这一档**，所以按"上一个等级对应的那一项"加权：
       * 这里直接用 settleBuildings 上面刚加过的那一项（addType）。 */
      if (d.addType === 0) S.power = integer(S.power, 1) + 1;
      else if (d.addType === 1) S.agility = integer(S.agility, 1) + 1;
      else if (d.addType === 2) S.speed = integer(S.speed, 1) + 1;
      else S.maxHp = integer(S.maxHp, 1) + 5;
      void rec;
    }
    if (done.length) save();
    return done;
  }
  /** 一键/取建筑（`null` = 还没解锁）。 */
  function building(key) {
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
  /** 建筑升级：扣金松果 + 起倒计时（原版 `upgradeBuilding` :4700 → `homeLandLevelUpMc` 帧 5）。 */
  function upgradeBuilding(key) {
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
    const b = S.buildings && S.buildings[key];
    return !!(b && b.buffDate === localDate() && integer(b.buffId, 0) > 0);
  }
  /** 祭坛「领取当日随机状态」：三种之一，持续到当天 24:00。 */
  function claimBuildingBuff(key) {
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
  /** 当前生效的当日状态（0 = 没有）。`kind`：'arenaExp' / 'arenaProp' / 'stageGold'。 */
  function activeBuildingBuff(kind) {
    const want = kind === 'arenaExp' ? 1 : kind === 'arenaProp' ? 2 : kind === 'stageGold' ? 3 : 0;
    if (!want) return false;
    for (const key of BUILDING_KEYS) {
      const b = S.buildings && S.buildings[key];
      if (b && integer(b.buffId, 0) === want && b.buffDate === localDate()) return true;
    }
    return false;
  }
  /** 建筑给的"当日双倍"概率（百分数）：没 buff 就是 0，有就取该建筑当前等级那一档。 */
  function buildingDoubleRate(key, kind) {
    const bid = kind === 'arenaExp' ? 1 : kind === 'arenaProp' ? 2 : kind === 'stageGold' ? 3 : 0;
    if (!bid || !activeBuildingBuff(kind)) return 0;
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
    const skill = PET_SKILLS[p.skillId] || { name: '未知技能', remark: '暂无说明' };
    return {
      key: p.key, id: p.id, name: p.name, grade: p.grade, maxLevel: p.maxLevel,
      leadership: p.leadership, skillId: p.skillId, skillName: skill.name, skillRemark: skill.remark,
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
    /* 原版 hatch.do 的星级权重没有导出；这里按 1★55% / 2★27% / 3★13% / 4★5% 的常见权重。 */
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
  /** 进化：消耗目标 + 2 只同星级非出战幻兽 + 金松果，变成高一星的随机幻兽。 */
  function evolvePet(targetKey) {
    const target = petByKey(targetKey);
    if (!target) return { ok: false, msg: '找不到要进化的幻兽' };
    if (target.grade >= 4) return { ok: false, msg: '四星幻兽已经是最高星级' };
    const nextGrade = target.grade + 1;
    const mats = (S.pets || []).filter((p) => p.key !== target.key && p.grade === target.grade && !(S.petsTeam || []).includes(p.key)).slice(0, 2);
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
      else if ([4, 5, 10].includes(sid)) out.hp += grade * 8 + lv * 4;
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
  /* ============================================================
   * 徒弟日供：系数按「所有徒弟等级之和」**线性插值**，经验与金松果分开给
   *
   *   Σ = 0（没有徒弟）           → 经验 5%  金松果 5%
   *   Σ = TRIBUTE_LEVEL_SUM_FULL  → 经验 15% 金松果 25%
   *   中间线性：ratio = min + Σ × (max − min) / FULL
   *
   * 系数乘的是**我自己昨天**赚到的总经验与金松果（earnOn(昨天)），次日领取。
   * 多个徒弟按各自等级占「等级之和」的份额分这份贡品，合计正好是 ratio × 昨日收益。
   * Σ = 210 对应 3 个满级（70 级）徒弟。
   * ============================================================ */
  const TRIBUTE_EXP_MIN = 0.05, TRIBUTE_EXP_MAX = 0.15;      // 经验：前一天的 5% ~ 15%
  const TRIBUTE_GOLD_MIN = 0.05, TRIBUTE_GOLD_MAX = 0.25;    // 金松果：前一天的 5% ~ 25%
  const TRIBUTE_LEVEL_SUM_FULL = 210;        // 3 个满级徒弟：3 × 70
  function apprenticeLevelSum(list) {
    return (Array.isArray(list) ? list : []).reduce((sum, p) => sum + Math.max(1, integer(p && p.level, 1)), 0);
  }
  /** 线性插值：Σ 从 0 到 FULL 对应 min → max，超出封顶。 */
  function tributeLerp(sum, min, max) {
    const lo = Number(min) || 0, hi = Number(max) || 0;
    const span = (hi - lo) / TRIBUTE_LEVEL_SUM_FULL;
    const raw = lo + Math.max(0, integer(sum, 0)) * span;
    return Math.min(hi, Math.max(lo, raw));
  }
  /** 经验日供系数（5% ~ 15%）。 */
  function apprenticeTributeExpRatio(sum) { return tributeLerp(sum, TRIBUTE_EXP_MIN, TRIBUTE_EXP_MAX); }
  /** 金松果日供系数（5% ~ 25%）。 */
  function apprenticeTributeGoldRatio(sum) { return tributeLerp(sum, TRIBUTE_GOLD_MIN, TRIBUTE_GOLD_MAX); }
  /* 兼容旧调用：以前只有一个「总系数」，返回经验那一档（两者下限相同、口径最接近）。 */
  function apprenticeTributeRatio(sum) { return apprenticeTributeExpRatio(sum); }
  /** 总日供 + 按等级份额的分配表。用累计取整，保证各徒弟份额之和正好等于总量（不被 floor 蚕食）。 */
  function apprenticeTributeTable(list) {
    const rows = Array.isArray(list) ? list : [];
    const date = yesterdayDate();
    const mine = earnOn(date);
    const sum = apprenticeLevelSum(rows);
    /* 经验与金松果用各自的比例（金松果区间更宽：5%~25%）。 */
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
  /** 所有徒弟今天还能领的日供合计（经验 + 金松果）。 */
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
    const token='recruit_'+Date.now()+'_'+(++recruitSequence);
    S.goldPoint-=10;S.recruitChallenge={token,fee:10,candidate:clone(candidate)};save();
    return {ok:true,token,foe:clone(object(candidate.master)&&candidate.master.name?candidate.master:candidate)};
  }
  function cancelRecruitChallenge(token) {
    if (!S.recruitChallenge||S.recruitChallenge.token!==token)return false;
    S.goldPoint+=S.recruitChallenge.fee;S.recruitChallenge=null;save();return true;
  }
  function finishRecruitChallenge(token,win) {
    const run=S.recruitChallenge;if(!run||run.token!==token)return {ok:false};
    S.recruitChallenge=null;
    const added=win?addPrentice(run.candidate):null;
    tickPropStates();const exp=win?20:0,ups=gainExp(exp);save();
    return {ok:true,win,exp,gold:0,ups,recruited:added&&added.ok?added.apprentice:null,
      msg:win?(added.ok?'收【'+run.candidate.name+'】为徒！':added.msg):'收徒挑战失败，提升实力后再来。'};
  }
  /** 师父每天可踢出 1 个徒弟。 */
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

  /* ============================================================
   * 【S3】存档：读写 / 校验 / 版本迁移
   * ============================================================ */
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
      S.savedAt = Date.now();
      if (storageMode() === 'file') { scheduleFileWrite(); return true; }
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
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ============================================================
   * 存档：**主存档 = 游戏目录下的 save/progress.json**
   *
   * 由本地服务器的 /__save 读写（`node serve.js`）。
   *   · 有本地服务器：进度只写这个文件，浏览器 localStorage **不再当存档用**
   *     （首次会把老档迁进文件，然后删掉旧的 ssdz_save_v1 键）。
   *   · 没有本地服务器（GitHub Pages、file://）：退回 localStorage，否则无处可存；
   *     系统页会显示当前用的是哪一种，避免「以为存在文件里」的误会。
   *   · 自检档（?test=1 / ?qa=1）永远只写 localStorage，绝不碰正式存档文件。
   *
   * 冲突保护：写之前比较文件里的 savedAt，文件更新（另一台机器刚玩过）时不覆盖，
   * 只标记冲突，由玩家在系统页点「载入文件里的存档」。
   * ============================================================ */
  const SAVE_URL = '__save';
  const LEGACY_KEY = SAVE_KEY;                       // 旧的 localStorage 存档键
  const fileState = { available: false, transportReady: false, checked: false, code: 0, fileAt: 0, fileExists: false, lastProbe: 0, error: '', reason: '', lastWrite: 0, lastLoad: 0, lastRead: 0, lastReadErr: '', conflict: false, dirty: false, freshLocal: false, path: 'save/progress.json' };
  let fileTimer = 0;
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
    try { localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(LEGACY_KEY + '_sync'); } catch (e) {}
  }
  /** 浏览器兜底档是不是「更新且等级不低于文件里这份」——换机器/双机同步后本机没跟上时，
   * 它就是玩家真正的最新进度，不能当成残留垃圾悄悄删掉（交给 fileWrite 的冲突保护处理）。 */
  function localSaveWorthKeeping(fileAt) {
    const local = localSaveMeta();
    if (!local) return false;
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
  /** 宿主替换存档通道（Tauri 里用 Rust 端命令读写文件）。 */
  function setSaveTransport(t) {
    saveTransport = t && typeof t.probe === 'function' ? t : null;
    if (saveTransport && saveTransport.path) fileState.path = saveTransport.path;
    fileState.checked = false;
    fileState.available = false;
  }
  const isFileProtocol = () => typeof location !== 'undefined' && location.protocol === 'file:';
  /** 浏览器 localStorage 里有没有兜底存档（boot 判断「能不能回落」时用，不改动内存状态）。 */
  function hasLocalSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }
  /** 浏览器兜底档的等级与时间戳（判断「文件里的是不是那份该用的档」时用）。 */
  function localSaveMeta() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!object(parsed)) return null;
      return { level: Math.max(1, integer(parsed.level, 1, 1)), savedAt: Number(parsed.savedAt) || 0 };
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
        // 手机上第一次运行就是后者，不该弹红色报错横幅。
        fileState.transportReady = !!meta.ok;
        fileState.fileAt = Number(meta.savedAt) || 0;
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
  async function fileLoad() {
    if (!fileState.available) await fileProbe();
    if (!fileState.available) return false;
    fileState.lastRead = 0;
    fileState.lastReadErr = '';
    try {
      const info = saveTransport ? await saveTransport.read() : await (await fetch(SAVE_URL, { cache: 'no-store' })).json();
      fileState.fileAt = Number(info.savedAt) || 0;
      if (info.exists && info.data) {
        const parsed = typeof info.data === 'string' ? JSON.parse(info.data) : info.data;
        if (!object(parsed)) throw new Error('存档内容不是对象');
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
         * （内部时间戳比文件 mtime 旧），fileAt 就永远大于 localAt，自动保存会被
         * 「存档文件更新，已跳过写入」永久挡住 —— 表现在玩家身上就是「打了半天进度没保存」。 */
        S.savedAt = fileState.fileAt || Number(parsed.savedAt) || Date.now();
        // 文件是主存档，旧的浏览器兜底档就此退休；
        // 但「更新且更强」的那份要留着（见 localSaveWorthKeeping）。
        forgetLegacyIfRedundant(fileState.fileAt);
        fileState.conflict = false;
        return true;
      }
      // 文件还不存在：把浏览器里的老档迁进来（只做一次）
      if (load()) {
        const ok = await fileWrite(true);
        if (ok.ok) forgetLegacy();     // 迁移：这份兜底档已经写进文件了
        return true;
      }
      return false;
    } catch (e) {
      fileState.lastReadErr = String((e && e.message) || e);
      fileState.error = fileState.lastReadErr;
      return false;
    }
  }
  /** 读存档文件的元信息（savedAt / exists）。**1.2 秒内复用上一次结果**：
   *  连点几下触发的防抖写盘不再每次都先打一个 `?meta=1`；`force`（系统页「立即写入」）
   *  仍然强制重新探测，跨机器冲突保护不受影响。 */
  async function probeMeta(force) {
    const now = Date.now();
    if (!force && fileState.lastProbe && now - fileState.lastProbe < 1200) {
      return { savedAt: fileState.fileAt, exists: fileState.fileExists };
    }
    const meta = saveTransport ? await saveTransport.probe()
      : await (await fetch(SAVE_URL + '?meta=1', { cache: 'no-store' })).json();
    fileState.lastProbe = now;
    fileState.fileAt = Number(meta.savedAt) || fileState.fileAt;
    fileState.fileExists = meta.exists === true || fileState.fileAt > 0;
    return meta;
  }
  /** 把当前进度写进 save/progress.json（force=true 时不检查「文件是否更新」）。 */
  async function fileWrite(force) {
    if (testMode) return { ok: false, msg: '自检档不写正式存档' };
    if (!fileState.available) await fileProbe();
    if (!fileState.available) return { ok: false, msg: '存档写入不可用：' + (fileState.reason || '未知原因') };
    try {
      const meta = await probeMeta(!!force);
      const fileAt = Number(meta.savedAt) || 0;
      const localAt = (S && S.savedAt) || 0;
      // 存档文件里已有别的进度（新浏览器 / 换了机器第一次打开）：不覆盖，先让玩家决定
      if (meta.exists && fileState.freshLocal && fileAt > 0) {
        fileState.conflict = true; fileState.fileAt = fileAt;
        return { ok: false, conflict: true, msg: '存档文件里已有进度（' + fmtTime(fileAt) + '），没有覆盖' };
      }
      if (!force && fileAt > localAt + 1000) {
        fileState.conflict = true; fileState.fileAt = fileAt;
        return { ok: false, conflict: true, msg: '存档文件更新（' + fmtTime(fileAt) + '），已跳过写入' };
      }
      const body = JSON.stringify(savePayload());
      const out = saveTransport ? await saveTransport.write(body)
        : await (await fetch(SAVE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).json();
      if (!out.ok) throw new Error(out.msg || '写入失败');
      fileState.fileAt = Number(out.savedAt) || Date.now();
      fileState.fileExists = true;
      fileState.lastProbe = Date.now();
      fileState.lastWrite = Date.now();
      fileState.conflict = false;
      fileState.dirty = false;
      fileState.freshLocal = false;
      // 刚写进去的就是当前进度；浏览器兜底档只在「更新且不低于当前等级」时才留着
      forgetLegacyIfRedundant(fileState.fileAt);
      return { ok: true, msg: '已写入 ' + fileState.path, fileAt: fileState.fileAt };
    } catch (e) {
      fileState.error = String((e && e.message) || e);
      return { ok: false, msg: '写入存档失败：' + fileState.error };
    }
  }
  /** 界面上「立即写入」按钮用：立刻写，不受防抖影响。 */
  function fileWriteNow() { return fileWrite(true); }
  /** 存档文件的信息（系统页显示用）。 */
  function fileInfo() {
    return {
      mode: storageMode(), available: fileState.available, checked: fileState.checked,
      transportReady: fileState.transportReady,
      conflict: fileState.conflict, fileAt: fileState.fileAt, localAt: (S && S.savedAt) || 0,
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
    if (!S || storageMode() !== 'file' || typeof setTimeout !== 'function') return;
    fileState.dirty = true;
    if (fileTimer) clearTimeout(fileTimer);
    fileTimer = setTimeout(() => { fileTimer = 0; void fileWrite(); }, 400);
  }
  function flushFileWrite() {
    rememberUiMode();
    if (fileTimer) { clearTimeout(fileTimer); fileTimer = 0; }
    if (!S || storageMode() !== 'file' || !fileState.dirty) return;
    try {
      const body = JSON.stringify(savePayload());
      if (typeof fetch === 'function') void fetch(SAVE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
    } catch (e) {}
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    /* 只留 `pagehide` 与「页面隐藏」两个出口：`beforeunload` 与它们重复，
     * 关页/切后台时会把同一份 360 KB 存档连发三遍（2026-10 审计）。
     * `flushFileWrite` 自己还会判 dirty —— 没改过就不上传。 */
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
    S = clone(GData.NEW_PLAYER);
    Object.assign(S, GData.initialStats());
    S.stageRuns = {};
    S.friends = [];
    S.name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 20) : '小松鼠';
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
  /* ---------- 「战斗操作键」的解锁等级（2026-10 用户口径） ----------
   * 10 级解锁 2 倍速、20 级解锁跳过 —— 一开始两个都没有。
   * 挑战塔 / 无尽塔本身要 30 级才开，所以塔里这两个键天然都在
   *（塔的「跳过」另有一条层数门槛：无尽塔 20 层起，见 Tower.skipPlaybackAllowed）。 */
  const SPEED_UNLOCK_LEVEL = 10;
  const SKIP_UNLOCK_LEVEL = 20;
  function unlockedSpeed() { return !!S && Number(S.level) >= SPEED_UNLOCK_LEVEL; }
  function unlockedSkip() { return !!S && Number(S.level) >= SKIP_UNLOCK_LEVEL; }

  /* ============================================================
   * 【S4】体力（5 分钟回 1 点）
   * ============================================================ */
  // ---------- 体力（5分钟回1点，初始上限90，升级提升上限） ----------
  function tickEnergy() {
    syncDailyStats();
    const now = Date.now();
    if (debugOn('infiniteEnergy')) { S.energy = S.maxEnergy; S.lastEnergyTs = now; return; }
    syncVipEnergyCap();
    tickVipDaily();
    // 超级松鼠特权 3：体力恢复速度 1.1~1.5 倍
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
    const remain = Math.max(0, ENERGY_INTERVAL - (Date.now() - S.lastEnergyTs));
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
      // 其它道具没有「批量」概念，退化成单个使用
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

  /* ============================================================
   * 【S5】武器/技能实例（含等级换算）
   * ============================================================ */
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

  /* ============================================================
   * 【S6】升级武器/技能（成功率/费用/失败保护）
   * ============================================================ */
  // ---------- 升级武器/技能（upgradeMap: 成功率/费用/卷轴/玩家等级限制） ----------
  const UPGRADE_COIN = 40;
  const UPGRADE_FAIL_BONUS = 5;   // 每次失败 +5%
  /* ============================================================
   * 【S7】真·武器 / 真·技能（终局线 11~15 级）
   * ============================================================ */
  /* ---------- 真·武器 / 真·技能（终局线，等级 11~15 = 真1~真5） ----------
   * 成功率沿用原表 upgradeMap 的第 10~14 行：100% / 8% / 5% / 4% / 3%。
   * 费用不新引入货币：参考里 U点 的汇率是 10U=50金松果（1U=5金松果），
   * 所以「当天第 N 次真升级 = 2N U点」直接按汇率折成 10N 金松果（10/20/30…），
   * 当日 24:00 清零。真升级**不吃失败保底**——终局线就该慢一些。 */
  const TRUE_UPGRADE_GOLD_PER_U = 5;
  const TRUE_SKILL_MAX_LEVEL = 15;
  const isTrueLevel = (level) => (Number(level) || 0) >= 10;
  const trueUpgradeDate = () => localDate();
  function trueAttemptsToday() {
    if (!object(S.trueUpgrades) || S.trueUpgrades.date !== trueUpgradeDate()) return 0;
    return Math.max(0, integer(S.trueUpgrades.count, 0));
  }
  /** 今天下一次真升级的金松果价：第 N 次 = 2N U点 × 5 金松果。 */
  function trueUpgradeCost() { return 2 * (trueAttemptsToday() + 1) * TRUE_UPGRADE_GOLD_PER_U; }
  function bumpTrueUpgrade() {
    const date = trueUpgradeDate();
    if (!object(S.trueUpgrades) || S.trueUpgrades.date !== date) S.trueUpgrades = { date, count: 0 };
    S.trueUpgrades.count = Math.max(0, integer(S.trueUpgrades.count, 0)) + 1;
  }
  const upgradeFailKey = (kind, id) => (kind === 'weapon' ? 'w' : 's') + Number(id);
  function upgradeFails(kind, id) {
    const m = object(S) && object(S.upgradeFails) ? S.upgradeFails : {};
    return Math.max(0, integer(m[upgradeFailKey(kind, id)], 0));
  }
  /** 基础成功率 + 失败累积，封顶 100%。 */
  const upgradeRate = (baseRate, fails) => Math.min(100, Math.max(0, integer(baseRate, 0)) + Math.max(0, integer(fails, 0)) * UPGRADE_FAIL_BONUS);
  function upgradeInfo(kind, id) {
    if (kind !== 'weapon' && kind !== 'skill') return null;
    id = Number(id);
    const list = kind === 'weapon' ? myWeapons() : mySkills();
    const it = list.find((x) => x.id === id);
    if (!it) return null;
    if (kind === 'skill' && [6, 13].includes(id)) return { max: true, fixed: true, item: it, msg: '该技能不能升级' };
    if (kind === 'skill' && it.level >= TRUE_SKILL_MAX_LEVEL) return { max: true, item: it, msg: '技能已达到真5上限' };
    const row = upgradeMap.getValue(it.level); // 当前等级对应升级行
    if (!row) return { max: true };
    const baseRate = parseInt(row.rate);
    const isTrue = isTrueLevel(it.level);
    // 真升级不吃失败保底：概率就是原表的固定值
    const fails = isTrue ? 0 : upgradeFails(kind, id);
    return {
      max: false, item: it, baseRate, fails, isTrue, rate: upgradeRate(baseRate, fails),
      coin: isTrue ? trueUpgradeCost() : UPGRADE_COIN,
      trueAttempt: trueAttemptsToday() + 1,
      book: parseInt(row.book), levelLimit: parseInt(row.levelLimit),
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
    const ok = debugOn('noUpgradeFail') ? true : Math.random() * 100 < info.rate;
    if (!object(S.upgradeFails)) S.upgradeFails = {};
    const failKey = upgradeFailKey(kind, id);
    // 真升级每次尝试都记一次「今日第几次」（费用递增），但绝不累积失败保底
    if (info.isTrue) bumpTrueUpgrade();
    if (ok) {
      bumpDaily('upgrade', 1, true);
      const arr = kind === 'weapon' ? S.weapons : S.skills;
      for (let i = 0; i < arr.length; i++) {
        const [wid, lv] = arr[i].split(':').map(Number);
        if (wid === id) { arr[i] = wid + ':' + (lv + 1); break; }
      }
      delete S.upgradeFails[failKey];      // 成功清零，下次回到基础概率
    } else if (!info.isTrue) {
      S.upgradeFails[failKey] = Math.min(999, info.fails + 1);   // 普通升级：失败累积，下次 +5%
    }
    save();
    const nextRate = ok ? null : upgradeRate(info.baseRate, info.fails + 1);
    return {
      ok, rate: info.rate, fails: ok ? 0 : info.fails + 1, nextRate, isTrue: !!info.isTrue,
      msg: ok ? (info.isTrue ? '真化成功！' : '升级成功！')
        : '升级失败……再接再厉！' + (!info.isTrue && nextRate ? '（下次成功率 ' + nextRate + '%）' : ''),
    };
  }

  /* ============================================================
   * 【S8】装备：穿戴/出售/融合/星标
   * ============================================================ */
  // ---------- 装备 ----------
  let gearKeySeq = 1;
  function normalizeExt(ext) {
    return (Array.isArray(ext) ? ext : []).filter((e) => object(e) && attachmentMap.getValue(e.id)).map((e) => ({
      id: Number(e.id), level: Math.min(3, integer(e.level, 1, 1)),
    }));
  }
  /** 装备主属性点的**基准值**：优先取原版 Flash 装备独立属性点表（gamedata.js 的
   *  【GD5】GData.GEAR_BASE_ATTR，288 条），退回 gearMap.abilities 里该部位那一位
   *  —— 两者对本版已有的 128 件逐条一致，所以取不到也不会算出不同的数。 */
  function gearBaseAttr(id) {
    const table = (typeof GData !== 'undefined' && GData && GData.GEAR_BASE_ATTR) || null;
    const hit = table ? table[Number(id)] : undefined;
    if (Number.isFinite(hit)) return hit;
    const g = gearMap.getValue(id);
    return g ? parseInt(g.abilities.split(',')[parseInt(g.type)]) || 0 : 0;
  }
  /* 每件装备的主属性带 ±10% 浮动：产出时（掉落/碎片合成/融合/商店）roll 一次写进实例，
   * 所以同名装备的数值不再完全一样。老档没有 attr 字段时按基准值算。
   * 用四舍五入而不是取整区间：基准 1/2/3 这种小数值不会因为 ±10% 就翻倍。 */
  const GEAR_ATTR_JITTER = 0.1;
  function rollGearAttr(id) {
    const base = gearBaseAttr(id);
    if (!base) return 0;
    const factor = 1 - GEAR_ATTR_JITTER + Math.random() * GEAR_ATTR_JITTER * 2;
    return Math.max(1, Math.round(base * factor));
  }
  function gearInst(id, ext, attr) {
    const g = gearMap.getValue(id);
    if (!g) return null;
    const set = gearSetMap.getValue(g.setId);
    const type = parseInt(g.type); // 0头巾(敏捷) 1手套(力量) 2衣服(生命) 3鞋(速度)
    const base = gearBaseAttr(id);
    const rolled = attr == null ? base : integer(attr, base, 0) || base;
    const abilityVal = rolled > 0 ? rolled : base;
    const attrName = ['敏捷', '力量', '生命', '速度'][type];
    const quality = parseInt(set ? set.quality : 0); // 0白1绿2蓝3紫
    /* 穿戴装备的最低门槛统一为 10 级（ssfight 状态页 b_change 的 10 级门槛）；
     * 高品质装备原有的 25/30/50/60 使用等级继续保留，所以这里取 max，而不是一律压成 10。 */
    const setLevel = parseInt(set ? set.level : 1);
    return {
      id: parseInt(id), name: g.name, type, attrName, abilityVal, attrBase: base, quality,
      useLevel: Math.max(10, Number.isFinite(setLevel) ? setLevel : 10),
      price: parseInt(set ? set.price : 10),
      setId: parseInt(g.setId), ext: normalizeExt(ext),
    };
  }
  function myGears() {
    return S.gears.map((g) => {
      const info = gearInst(g.id, g.ext, g.attr);
      if (!info) return null;
      const out = Object.assign(info, { used: g.used, key: g.key });
      if (g.orange === true) { out.orange = true; out.quality = 4; }   // 传说（橙）为实例级品质
      if (g.gem && gemLevel(g.gem.id)) out.gem = { id: Number(g.gem.id), ext: g.gem.ext };
      return out;
    }).filter(Boolean);
  }
  // 穿戴位: 0头巾 1手套 2衣服 3鞋
  function wear(gearKey) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g) return false;
    const gi = gearInst(g.id);
    if (!gi || S.level < gi.useLevel) return false;
    for (const o of S.gears) if (o.used && gearInst(o.id) && gearInst(o.id).type === gi.type) o.used = false;
    g.used = true; save(); return true;
  }
  function unwear(gearKey) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (g) { g.used = false; save(); }
  }
  /* 卖出装备的金松果：按品质分档、在区间内随机。
   * 白 55-60 / 绿 60-65 / 蓝 65-70 / 紫 90-110 / 橙 180-220（橙是实例级传说品质）。
   * 紫/橙两档由 70-75 / 75-80 上调，拉开与蓝装的差距。 */
  const GEAR_SELL_RANGE = Object.freeze([[55, 60], [60, 65], [65, 70], [90, 110], [180, 220]]);
  const gearSellRange = (quality) => GEAR_SELL_RANGE[Math.max(0, Math.min(GEAR_SELL_RANGE.length - 1, integer(quality, 0)))] || GEAR_SELL_RANGE[0];
  const gearSellPrice = (quality) => { const [lo, hi] = gearSellRange(quality); return lo + Math.floor(Math.random() * (hi - lo + 1)); };
  /** 品质需要按实例算：橙装是写在实例上的 quality=4。 */
  function gearQuality(gear) { return gear && gear.orange === true ? 4 : (gearInst(gear.id) || {}).quality || 0; }
  /** 切换星标：标上之后不会被误融合 / 误出售。 */
  function toggleGearStar(gearKey) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g) return { ok: false, msg: '装备不存在' };
    g.starred = g.starred !== true;
    save();
    return { ok: true, starred: g.starred === true,
      msg: g.starred ? '已加星标：不会被误融合或误出售' : '已取消星标' };
  }
  function isGearStarred(gear) {
    if (!gear) return false;
    if (gear.starred === true) return true;
    const key = gear.key;
    if (!key) return false;
    const g = (S.gears || []).find((x) => x.key === key);
    return !!(g && g.starred === true);
  }
  function sellGear(gearKey) {
    const i = S.gears.findIndex((x) => x.key === gearKey);
    if (i < 0) return 0;
    /* 星标装备不参与出售（返回 0，界面据此提示）。 */
    if (S.gears[i].starred === true) return 0;
    const gold = gearSellPrice(gearQuality(S.gears[i]));
    S.gears.splice(i, 1);
    addGold(gold); save();
    return gold;
  }
  /* 「更换装备」页的展示顺序（用户口径 2026-10）：**穿着中 > 星标 > 获得顺序**。
   *   · 第 1 档：当前穿在身上的（含「穿着 + 星标」，它仍然属于第 1 档）；
   *   · 第 2 档：加了星标的（防误合/误卖的收藏品，玩家要找它们）；
   *   · 第 3 档：其余按**获得时间**（`S.gears` 的先后，也就是入包顺序）排。
   * 用显式下标做稳定排序，所以同一档里永远是「先拿到的在前」。 */
  function gearsInDisplayOrder(list) {
    const src = Array.isArray(list) ? list : myGears();
    return src
      .map((gear, index) => ({ gear, index, rank: (gear.used ? 0 : 2) + (isGearStarred(gear) ? 0 : 1) }))
      .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
      .map((item) => item.gear);
  }
  /* 背包里可以直接卖的道具（装备走 sellGear）：默认按**字典价格的一半**回收
   * （向下取整），所以商店里买得到的、以及字典里标了价的材料都能卖。
   * 字典里 price 为 0 或占位 1 的道具（兑换用的卷轴、碎片、礼包、天梯碎片、
   * 超级药丸、果实种子这类「不可购买」的物品）不开放回收；
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
   *（normalizeSave 会把 props 里的 8/15/40 丢掉）。2026-10 用户口径「玩家的金杯数量会同步到背包中」：
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
  /** 当前可回收的道具编号（升序），供界面/帮助与测试使用。 */
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
    if (S.props[id] <= 0) delete S.props[id];
    const gold = price * n;
    addGold(gold);
    bumpDaily('sell', n, true);   // 每日任务：卖出 N 个道具
    save();
    const item = propMap.getValue(id);
    return { ok: true, sold: n, gold, price, msg: '卖出 ' + (item ? item.name : '道具') + ' ×' + n + '，获得 ' + gold + ' 金松果' };
  }
  /* ============================================================
   * 【S9】宝石（45 级开启，镶嵌/拆卸）
   * ============================================================ */
  // ---------- 宝石（45级开启） ----------
  function gemLevel(id) { id = Number(id); return id >= 101 && id <= 107 ? id - 100 : 0; }
  /* 橙装镶嵌宝石的主属性加成：沿用原版数值。
   * 原版 MainMovie.as:45-54 getPercentById：5*(n²-n+2)，n = 宝石等级（1..7）
   * → 10 / 20 / 40 / 70 / 110 / 160 / 220 %。 */
  function gemPercent(lv) { lv = integer(lv, 0, 0); return lv > 0 ? 5 * (lv * lv - lv + 2) : 0; }
  /* 宝石合成成功率：0.88^lv（lv = 材料宝石等级）→ 88% / 77% / 68% / 60% / 53% / 46%。 */
  const gemMergeRate = (lv) => Math.pow(0.88, Math.max(1, Math.min(6, integer(lv, 1, 1))));
  /** 45级起，关卡通关与竞技场获胜有几率获得1级（75%）或2级（25%）宝石。 */
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
  /** 镶嵌免费；每件橙装限1颗；附加属性提升幅度随机，拆卸后重新镶嵌可重随。 */
  /* 镶嵌 / 卸下宝石的金松果费用（2026-10 用户口径：装上与卸下**都要** 5 金松果）。 */
  const GEM_SOCKET_COST = 5;
  function socketGem(gearKey, gemId) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g) return { ok: false, msg: '装备不存在' };
    if (g.orange !== true) return { ok: false, msg: '只有橙色（传说）装备可以镶嵌宝石' };
    if (g.gem) return { ok: false, msg: '每件装备最多镶嵌 1 颗宝石，请先卸下原有宝石' };
    const lv = gemLevel(gemId);
    if (!lv || !(S.props[gemId] > 0)) return { ok: false, msg: '没有该宝石' };
    if (S.goldPoint < GEM_SOCKET_COST) return { ok: false, msg: '镶嵌需要 ' + GEM_SOCKET_COST + ' 金松果' };
    S.goldPoint -= GEM_SOCKET_COST;
    S.props[gemId]--;
    g.gem = { id: Number(gemId), ext: lv * (2 + Math.floor(Math.random() * 3)) };
    save();
    return { ok: true, msg: propMap.getValue(gemId).name + ' 镶嵌成功（−' + GEM_SOCKET_COST + ' 金松果）：主属性 +' + gemPercent(lv) + '%，附加属性效果 +' + g.gem.ext + '%' };
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

  /* 装备合成 / 融合的金松果费用：按参与材料的品质分档。
   * 白 30 / 绿 40 / 蓝 50 / 紫 60 / 橙 70 / 黑 80（黑装暂未开放，先把位子留出来）。 */
  const GEAR_COST_BY_QUALITY = Object.freeze([30, 40, 50, 60, 70, 80]);
  const gearCostOf = (quality) => GEAR_COST_BY_QUALITY[
    Math.max(0, Math.min(GEAR_COST_BY_QUALITY.length - 1, integer(quality, 0)))] || GEAR_COST_BY_QUALITY[0];

  // 碎片合成: 24白/25绿/26蓝 ×10 + 金松果（白30/绿40/蓝50）→ 随机装备
  function composeGear(propId) {
    propId = Number(propId);
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
  // 融合: 3件同部位同品质 → 高一级品质
  function gearPart(id) {
    const def = gearMap.getValue(id);
    return def ? Number(def.type) : -1;
  }
  /** 把一份对手穿戴表规整成 `[{id, ext, type}]`（`type` 缺失时按装备字典反查）。
   *  原版这些都由服务端下发；复刻的 `genAI` 抽出来的装备**没有 `type`**，
   *  挑战页 / 状态页要把装备贴到立绘的**部位容器**上，缺了 `type` 整件都贴不上去。
   *  三处（好友 / 师父 / 徒弟）共用这一份，别再各写一遍。 */
  function normalizeFoeGears(list) {
    return (Array.isArray(list) ? list : []).map((g) => {
      const id = Number(g && g.id != null ? g.id : g);
      if (!Number.isFinite(id) || id <= 0) return null;
      const out = {
        id: id,
        ext: Array.isArray(g && g.ext) ? g.ext.slice(0, 3) : [],
        attr: g && g.attr ? g.attr : undefined,
        type: g && g.type != null ? Number(g.type) : gearPart(id),
      };
      /* 橙装与宝石是**实例级**字段（同 id 的紫装不是橙装）；好友/师徒快照也要带过去，
       * 否则挑战页立绘、查看装备、切磋时的套装收益都会退回紫装。 */
      if (g && g.orange === true) out.orange = true;
      const gemLv = g && g.gem && gemLevel(g.gem.id);
      if (gemLv) out.gem = { id: 100 + gemLv, ext: Math.max(1, Math.min(99, integer(g.gem.ext, 1, 1))) };
      return out;
    }).filter(Boolean);
  }
  function gearPartQuality(id) {
    const def = gearMap.getValue(id);
    const set = def ? gearSetMap.getValue(parseInt(def.setId)) : null;
    return set ? parseInt(set.quality) : -1;
  }
  /** 某部位 + 某品质的全部装备 id（融合产物从这里随机取一件）。 */
  function gearIdsOf(part, quality) {
    const out = [];
    gearMap.each((k, v) => { if (Number(v.type) === Number(part) && gearPartQuality(parseInt(v.id)) === Number(quality)) out.push(parseInt(v.id)); });
    return out;
  }
  function gearName(id) { const d = gearMap.getValue(id); return d ? d.name : ''; }
  function gearSetOf(id) { const d = gearMap.getValue(id); return d ? parseInt(d.setId) : -1; }

  /* ---------- 套装收益（数值表在 gamedata.js【GD6】，原版没有这套机制） ----------
   * 家族 = 装备名去掉部位后缀 —— 「忍者护额/拳套/服/鞋」都算**忍者**家族，
   * 所以同名跨品质（忍者绿/蓝/紫）能拼在一起，凑名的难度比凑某个 setId 低得多。
   * 阈值只有 2 件 / 4 件两档，4 件档**叠加**在 2 件档之上。
   * 品质取所穿该家族装备里**最低**的那一件（整套成色按最差的一件算）。
   * 属性类收益并进 totalStats；战斗类收益由 applySetBonuses 写成 fighter.setFx ——
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
  /** 某个家族的收益合计（2 件档 + 4 件档叠加）；不足 2 件返回 null。 */
  function setBonusOf(entry) {
    const table = entry && GData.setBonusTable(entry.family);
    if (!table || !(entry.count >= 2)) return null;
    const raw = GData.SET_BONUS_RAW_KEYS || [];
    const eff = {};
    const add = (src) => {
      for (const [k, v] of Object.entries(src || {})) {
        /* 结构值（openerRounds / lowHpAt）取大值而不是相加 —— 两档都给同一个键时不该翻倍。 */
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
    const counts = setPieceCounts();
    const out = [];
    for (const family of Object.keys(counts)) {
      const entry = counts[family], table = GData.setBonusTable(family);
      const eff = setBonusOf(entry);
      const tier = entry.count >= 4 ? 4 : entry.count >= 2 ? 2 : 0;
      out.push({
        family, count: entry.count, quality: entry.quality, tier, active: tier > 0,
        text: eff ? GData.setBonusText(eff) : [],
        /* 2 件与 4 件两档各自的实际数值（界面里分别列出来，让玩家看得到「下一档给什么」）。 */
        tiers: [2, 4].map((need) => ({
          need, on: entry.count >= need,
          text: GData.setBonusText(GData.setBonusScale(family, entry.quality, table[need])),
        })),
      });
    }
    out.sort((a, b) => (b.count - a.count) || (b.quality - a.quality) || a.family.localeCompare(b.family));
    return out;
  }
  /** 某一件装备所属家族的套装信息（装备详情面板用）。
   *  `viewQuality` 是**正在看的那一件**的品质：一件都还没穿时，用它来预估这一套的收益数值。 */
  function setBonusForGear(id, viewQuality) {
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
   *  脱光装备时一起失效 —— 它本来就是装备给的。
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
    const eff = setBonusEffects(gears, level);
    foe.power += eff.stats.power;
    foe.agility += eff.stats.agility;
    foe.speed += eff.stats.speed;
    foe.hp += eff.stats.hp;          // 对手的 hp 就是它的生命上限（与上面装备主属性的加法同口径）
    return applySetBonuses(foe, gears, level);
  }

  /* ---------- 融合的两条核心规则（数值都提在这里，方便调） ----------
   * ① 产物名称三选一（只有「2 件同名」「3 件同名」才进这一支）：
   *    · **2 件同名**：50% 沿用原名 / **3% 变异狂战** / **47% 变成随机其它装备**；
   *    · **3 件同名**：97% 沿用原名 / 3% 变异狂战（三件同名更容易保住名字）。
   *    变异目标是狂战套（setId 51，紫档 id 201-204，按部位对应）；
   *    目标品质没有狂战件时（绿/蓝档）不掷变异，那 3% 归到「随机其它」那一支。
   *    2026-10 用户口径：变异率从初版 25%/10% 两轮下调到 **两件 3% / 三件 3%**，
   *    并把两件同名「保不住名」的那部分明确成 47% 随机其它装备（以前是并回随机池）。 */
  const FUSION_SAME_NAME_RATE = { 2: 0.50, 3: 0.97 };
  const FUSION_MUTANT_RATE = { 2: 0.03, 3: 0.03 };
  const FUSION_MUTANT_SET = 51;
  /* ② 词条继承：在 ≥2 件材料里都出现的词条保留下来，每条按 FUSION_EXT_UPGRADE_RATE 概率升 1 星
   *    （上限 3 星，对应原版融合帮助第 4 条「融合时有几率提升附加属性的星级」）；
   *    一件共有词条都没有时，按目标品质的槽位数随机生成。 */
  const FUSION_EXT_UPGRADE_RATE = 0.5;
  const FUSION_EXT_MAX_LEVEL = 3;
  /* 产物品质 → 词条槽位数（绿 0 / 蓝 1 / 紫 2 / 橙 3）。 */
  const FUSION_EXT_SLOTS = { 1: 0, 2: 1, 3: 2, 4: 3 };
  const fusionSlots = (quality) => FUSION_EXT_SLOTS[Math.max(0, Math.min(4, integer(quality, 0)))] || 0;
  /** 按目标品质随机生成词条（蓝 1 条 ≤2 星、紫/橙 2~3 条 ≤3 星）。 */
  function randomExtForQuality(quality) {
    const slots = fusionSlots(quality);
    return slots ? randomExt(slots, quality >= 3 ? 3 : 2) : [];
  }
  /** 融合产物的词条继承：共有（≥2 件出现）的保留并可能升星，没有共有的就随机。 */
  function mergeExt(gs, targetQuality) {
    const slots = fusionSlots(targetQuality);
    if (!slots) return [];
    const count = {}, level = {};
    for (const g of gs) {
      const seen = new Set();
      for (const e of normalizeExt(g.ext)) {
        level[e.id] = Math.max(level[e.id] || 0, e.level);
        if (seen.has(e.id)) continue;      // 同一件材料里重复的同名词条只算一份
        seen.add(e.id);
        count[e.id] = (count[e.id] || 0) + 1;
      }
    }
    const shared = Object.keys(level).map(Number)
      .filter((id) => count[id] >= 2)
      .sort((a, b) => (level[b] - level[a]) || (a - b))
      .slice(0, slots);
    if (!shared.length) return randomExtForQuality(targetQuality);
    const out = shared.map((id) => {
      let lv = level[id];
      if (lv < FUSION_EXT_MAX_LEVEL && Math.random() < FUSION_EXT_UPGRADE_RATE) lv += 1;
      return { id, level: lv };
    });
    /* 高稀有度有 2~3 个词条槽，但「共有词条」可能只有 1 条（典型：三件都带同一个词条，
     * 以前只返回这 1 条，产物就只剩一个词条）。空槽必须按目标品质补满，且不能和已有词条重复。 */
    if (out.length < slots) {
      const used = new Set(out.map((e) => e.id));
      out.push(...randomExt(slots - out.length, targetQuality >= 3 ? 3 : 2, used));
    }
    return out;
  }
  /** 融合产物的目标装备。名称按「三件材料的同名情况」三选一：
   *   · 两件同名 → 50% 沿用原名 / 3% 变异狂战 / 47% 随机其它装备
   *   · 三件同名 → 97% 沿用原名 / 3% 变异狂战
   *   · 三件全不同名 → 完全随机（不掷变异）
   *  判定顺序 = 先掷变异、再掷保名，剩下的走随机其它；这样三段的概率就是字面值。
   *  若该名字在目标品质不存在（例如斗斗/挑斗白装没有绿装），退回完全随机。
   *  返回 { id, mutant }：mutant 为 true 表示这次是狂战变异。 */
  function pickMergeTarget(gs, part, targetQuality) {
    const pool = gearIdsOf(part, targetQuality);
    if (!pool.length) return null;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const names = gs.map((g) => gearName(g.id));
    const dup = names.filter((n) => n === names[0]).length;
    const same = dup >= 2 ? names[0] : (names[1] === names[2] ? names[1] : null);
    if (same) {
      const hit = pool.filter((id) => gearName(id) === same);
      const mutants = pool.filter((id) => gearSetOf(id) === FUSION_MUTANT_SET);
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
  /** 三件同品质装备融合成一件更高品质装备。
   *  默认仍要求同部位（旧规则/现代模式）；经典融合页传 `allowMixedParts:true`
   *  去掉同部位需求，结果部位沿用第一件材料（品质仍必须一致）。 */
  function mergeGears(keys, opts) {
    if (!Array.isArray(keys) || keys.length !== 3 || new Set(keys).size !== 3) return { ok: false, msg: '请选择三件不同的装备' };
    const gs = keys.map((k) => S.gears.find((x) => x.key === k)).filter(Boolean);
    if (gs.length !== 3) return { ok: false, msg: '装备不存在' };
    if (gs.some((g) => g.used)) return { ok: false, msg: '不能融合已穿戴的装备' };
    /* 星标装备受保护：不参与融合（防止误合成）。 */
    if (gs.some((g) => g.starred === true)) {
      return { ok: false, msg: '有装备已加星标（防误合），先取消星标再融合' };
    }
    if (gs.some((g) => g.orange)) return { ok: false, msg: '传说装备已是最高品质' };
    const part = gearPart(gs[0].id), q = gearPartQuality(gs[0].id);
    if (part < 0) return { ok: false, msg: '装备数据异常' };
    const samePart = gs.every((g) => gearPart(g.id) === part);
    if (!samePart && !(opts && opts.allowMixedParts)) return { ok: false, msg: '需要三件同部位的装备' };
    if (gs.some((g) => gearPartQuality(g.id) !== q)) return { ok: false, msg: '需要三件同品质的装备' };
    const partName = ['头巾', '手套', '衣服', '鞋子'][part] || '装备';
    const cost = gearCostOf(q);
    if (S.goldPoint < cost) return { ok: false, msg: '融合费用不足（需要 ' + cost + ' 金松果）' };
    if (q >= 3) {
      // 3 件同部位紫装 → 该部位一件橙装（传说）
      const target = pickMergeTarget(gs, part, 3);
      if (target == null) return { ok: false, msg: '这个部位还没有可合成的传说' + partName + '。' };
      S.goldPoint -= cost;
      S.gears = S.gears.filter((g) => !keys.includes(g.key));
      const made = addGear(target.id, mergeExt(gs, 4));
      const inst = made && S.gears.find((x) => x.key === made.key);
      if (inst) { inst.orange = true; save(); }
      bumpDaily('merge', 1, true);   // 每日任务：合成或融合 N 次装备
      return { ok: true, gear: Object.assign(made || {}, { orange: true, quality: 4, mutant: target.mutant }) };
    }
    const target = pickMergeTarget(gs, part, q + 1);
    if (target == null) return { ok: false, msg: '这个部位还没有更高品质的' + partName + '。' };
    S.goldPoint -= cost;
    S.gears = S.gears.filter((g) => !keys.includes(g.key));
    const g = addGear(target.id, mergeExt(gs, q + 1));
    bumpDaily('merge', 1, true);   // 每日任务：合成或融合 N 次装备
    save();
    return { ok: true, gear: Object.assign(g || {}, { mutant: target.mutant }) };
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
  function extText(ext) {
    return (ext || []).map((e) => {
      const a = attachmentMap.getValue(e.id);
      if (!a) return '';
      const v = a.ability.split(',')[Math.min(e.level - 1, a.ability.split(',').length - 1)];
      return a.name.replace('N', v);
    }).filter(Boolean);
  }
  function addGear(id, ext, attr) {
    const rolled = attr == null ? rollGearAttr(id) : (integer(attr, 0, 0) || rollGearAttr(id));
    const info = gearInst(id, ext, rolled);
    if (!info) return null;
    let key;
    do { key = 'g' + Date.now() + '_' + (gearKeySeq++); } while (S.gears.some((g) => g.key === key));
    S.gears.push({ id: info.id, used: false, key, ext: info.ext, attr: rolled });
    save();
    return Object.assign(info, { key, used: false });
  }

  // 原装备界面规则：同种附加能力不叠加，只取最高一条。
  function equipmentEffects() {
    const effects = {};
    for (const gear of S.gears) {
      if (!gear.used) continue;
      const info = gearInst(gear.id, gear.ext, gear.attr);
      if (!info || S.level < info.useLevel) continue;
      for (const ext of normalizeExt(gear.ext)) {
        const values = attachmentMap.getValue(ext.id).ability.split(',').map(Number);
        const boost = gear.gem ? 1 + gear.gem.ext / 100 : 1;   // 橙装宝石提升附加属性效果
        effects[ext.id] = Math.max(effects[ext.id] || 0, Math.round(values[ext.level - 1] * boost));
      }
    }
    return effects;
  }

  /* ============================================================
   * 【S10】属性合计（基础+装备+药剂）
   * ============================================================ */
  // ---------- 属性合计（基础+装备+药剂状态） ----------
  function totalStats(opts) {
    opts = opts || {};
    let power = S.power, agility = S.agility, speed = S.speed, hp = S.maxHp;
    for (const g of S.gears) {
      if (!g.used) continue;
      const gi = gearInst(g.id, g.ext, g.attr);
      if (!gi || S.level < gi.useLevel) continue;
      let val = gi.abilityVal;
      if (g.gem) val = Math.round(val * (1 + gemPercent(gemLevel(g.gem.id)) / 100));   // 橙装宝石提升主属性（原版曲线）
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
    // 药剂状态（挑战类战斗生效，关卡/竞技无效）
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

  /* ============================================================
   * 【S11】道具：使用/出售/合成
   * ============================================================ */
  // ---------- 道具 ----------
  /* 每日限购：卷轴/永久属性/果实这类每天 1 件；四种普通药丸（大力丸/敏捷丸/速度丸/经验丸）
   * 每天 3 颗；**大小体力药剂每天各 3 个**（体力是硬资源，限紧一点）；
   * 其余消耗品 5 件。超级药丸走名字里的「永久」分支，仍是 1 件。 */
  const SHOP_DAILY_PILLS = [3, 4, 5, 7];
  const SHOP_PILL_LIMIT = 3;
  /* 体力药剂（1 = 小、2 = 大）：每天各限购 3 个。 */
  const SHOP_DAILY_ENERGY = [1, 2];
  const SHOP_ENERGY_LIMIT = 3;
  /* 单独点名的每日限购（覆盖上面的默认值）。2026-10 用户口径：
   * **勇气徽章（39，碎片竞技场入场券）每天 3 个**（原来落在默认的 5）。
   * 注意道具行里最后一个字段是 useType，不是购买数量 —— 限购只认这里。 */
  const SHOP_DAILY_LIMITS = { 39: 3 };
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
  /* ---------- 金宝箱 / 魔法袋（原版 Flash 的两件开箱道具）----------
   * 原版客户端只负责「展示奖品 + 播放动画」，真正的奖品由服务端 `chest.do` 下发；
   * 离线版在这里落一张等价的权重表。黑色凤凰/圣熊套装在本版没有对应装备数据，
   * 用「高级宝石 / 属性点 / 金松果」替代（见文档里的“离线范围”说明）。 */
  function rollChestReward(kind) {
    const r = Math.random();
    const give = (id, count) => {
      const p = propMap.getValue(id);
      S.props[id] = (S.props[id] || 0) + count;
      return { kind: 'prop', id, count, name: p ? p.name : '道具' };
    };
    if (kind === 'gold') {
      if (r < 0.04) return give(106, 1);                 // 6级宝石
      if (r < 0.28) return give(105, r < 0.14 ? 2 : 1);  // 5级宝石
      if (r < 0.43) { S.freePoints = (S.freePoints || 0) + 16; return { kind: 'points', count: 16, name: '基础属性点' }; }
      if (r < 0.55) { S.freePoints = (S.freePoints || 0) + 12; return { kind: 'points', count: 12, name: '基础属性点' }; }
      if (r < 0.67) { S.freePoints = (S.freePoints || 0) + 10; return { kind: 'points', count: 10, name: '基础属性点' }; }
      if (r < 0.77) { S.freePoints = (S.freePoints || 0) + 8; return { kind: 'points', count: 8, name: '基础属性点' }; }
      if (r < 0.83) return give(79, 1);                 // 魔法袋（原版活动道具，这里给金宝箱一条循环）
      const n = 500 + Math.floor(Math.random() * 3) * 250;
      addGold(n);
      return { kind: 'gold', count: n, name: '金松果' };
    }
    // 魔法袋：稀有道具 + 孵化点 / 召唤证 / 高级宝石
    if (r < 0.03) return give(106, 1);
    if (r < 0.18) return give(105, 1);
    if (r < 0.33) return give(26, 5 + Math.floor(Math.random() * 6));
    if (r < 0.50) return give(82, 1 + Math.floor(Math.random() * 2));
    if (r < 0.70) { const add = 6 + Math.floor(Math.random() * 3) * 2; S.freePoints = (S.freePoints || 0) + add; return { kind: 'points', count: add, name: '基础属性点' }; }
    if (r < 0.85) { const n = 300 + Math.floor(Math.random() * 5) * 50; addGold(n); return { kind: 'gold', count: n, name: '金松果' }; }
    S.hatchPoint = (S.hatchPoint || 0) + 100;
    return { kind: 'hatch', count: 100, name: '孵化点' };
  }
  function openChestProp(id) {
    id = Number(id);
    if (![79, 90].includes(id)) return { ok: false, msg: '不是可开启的宝箱' };
    if ((S.props[id] || 0) <= 0) return { ok: false, msg: '没有该道具' };
    S.props[id]--;
    const reward = rollChestReward(id === 90 ? 'gold' : 'magic');
    save();
    return { ok: true, id, reward, msg: '打开' + (id === 90 ? '金宝箱' : '魔法袋') + '：' + reward.name + ' ×' + reward.count };
  }


  function useProp(id, param) {
    id = parseInt(id);
    if ((S.props[id] || 0) <= 0) return { ok: false, msg: '没有该道具' };
    const p = propMap.getValue(id);
    if (!p) return { ok: false, msg: '没有该道具' };
    if (id === 79 || id === 90) return openChestProp(id);
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
      case 47:   // 天使果实：随机三选一（学会一个）
      case 48: { // 恶魔果实：随机三选一（遗忘一个）
        // 这里只回传候选，由界面弹窗选完再走 applyFruitChoice，所以提前返回、不消耗果实
        const fruit = fruitOptions(id);
        if (!fruit) {
          return { ok: false, msg: id === 47 ? '获得失败：可能已达上限或运气不佳' : '没有可以遗忘的武器或技能' };
        }
        return { ok: false, needsFruitChoice: true, fruit: id, mode: fruit.mode, options: fruit.options, msg: '请从三个里选一个' };
      }
      case 28: case 29: case 30: case 31: case 32: case 49: { // 礼包
        const gift = giftMap.getValue(id);
        if (!gift) return { ok: false, msg: '礼包数据缺失' };
        if (S.level < parseInt(gift.level)) return { ok: false, msg: `需要${gift.level}级才能打开` };
        // 1/5/10/15/20 级礼包用 GData 里的加强清单，其它礼包仍按原表
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
  /**
   * 升级奖励的「三选一」候选：从还能学的池子里抽最多 n 个不重复的。
   * 池子空了（已满 / 没有可学的）就返回空数组，调用方据此不发奖励。
   */
  function wsChoices(n) {
    const pool = wsPool();
    const want = Math.min(Math.max(1, integer(n, 3, 1)), pool.length);
    const picked = [];
    while (picked.length < want && pool.length) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return picked.map(wsInfo).filter(Boolean);
  }
  /* ============================================================
   * 【S12】天使果实 / 恶魔果实（随机三选一）
   * ============================================================ */
  /* ---------- 天使果实 / 恶魔果实 ----------
   * 天使果实：从「还能学」的池子里随机抽最多 3 个候选，玩家挑一个学会；
   * 恶魔果实：从已拥有的武器/技能里随机抽最多 3 个候选，玩家挑一个遗忘。
   * 都不再是「直接随机生效」。候选在 useProp 里只负责回传，真正改动在 applyFruitChoice。 */
  function ownedWSChoices(n) {
    const all = [
      ...S.weapons.map((w) => wsInfo('w' + w.split(':')[0])),
      ...S.skills.map((s) => wsInfo('s' + s.split(':')[0])),
    ].filter(Boolean);
    const pool = all.slice(), picked = [];
    while (picked.length < Math.max(1, integer(n, 3, 1)) && pool.length) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return picked;
  }
  /** 果实的三选一候选；条件不满足（武技已满 / 只剩一个）时返回 null。 */
  function fruitOptions(id) {
    id = Number(id);
    if (id === 47) { const options = wsChoices(3); return options.length ? { mode: 'gain', options } : null; }
    if (id === 48) {
      if (S.weapons.length + S.skills.length <= 1) return null;
      return { mode: 'lose', options: ownedWSChoices(3) };
    }
    return null;
  }
  /** 应用果实三选一的结果，成功后消耗掉那个果实。 */
  function applyFruitChoice(id, kind, targetId) {
    id = Number(id); targetId = Number(targetId);
    kind = kind === 'weapon' ? 'weapon' : 'skill';
    if (!(S.props[id] > 0)) return { ok: false, msg: '没有这个果实' };
    const label = kind === 'weapon' ? '武器' : '技能';
    if (id === 47) {
      const info = grantWS((kind === 'weapon' ? 'w' : 's') + targetId);
      if (!info) return { ok: false, msg: '这个' + label + '暂时学不了' };
      S.props[id]--; if (S.props[id] <= 0) delete S.props[id];
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
      S.props[id]--; if (S.props[id] <= 0) delete S.props[id];
      bumpDaily('use', 1, true);
      save();
      return { ok: true, msg: '遗忘了 ' + ((info && info.name) || label) };
    }
    return { ok: false, msg: '这个道具不能这样用' };
  }
  /** 还没选的「三选一」：升级发下来就必须选掉（和自由属性点一样，只是会排队）。 */
  function pendingWS() { return S && Array.isArray(S.wsPicks) ? S.wsPicks.length : 0; }
  /* ============================================================
   * 「自愿支持作者」的一次性提示（30 级）
   *
   * 规则（用户口径 2026-10）：升到 30 级时弹一次；界面在**升级奖励处理完之后**才弹，
   * 不打断三选一 / 属性点流程（见 classic-ui 的 maybeSupportPrompt）。
   * 只做提示，不换取任何游戏内好处；关掉 / 点过之后不再出现。
   * ============================================================ */
  function supportPromptPending() { return !!(S && S.supportPrompt) && !(S && S.supportPromptShown); }
  /** 取一次提示权（原子）：真待提示时立刻记「已提示」并返回 true，否则 false。 */
  function supportPromptTake() {
    if (!supportPromptPending()) return false;
    S.supportPromptShown = true;
    save();
    return true;
  }
  /** 调试用：把「支持作者」提示恢复成**待提示**（下一次合适的时机还会弹一次；不碰等级）。 */
  function supportPromptReset() {
    if (!S) return false;
    S.supportPrompt = true;
    S.supportPromptShown = false;
    save();
    return true;
  }
  const SUPPORT_LEVEL = SUPPORT_PROMPT_LEVEL;
  /** 当前这一组的三个候选。 */
  function currentWSChoices() { return pendingWS() ? (S.wsPicks[0] || []) : []; }
  /** 从当前这组里选一个（kind+id），学会它并把这组出队。 */
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
  /** 手气不错：把还没选的组全部随机选掉（调试一键满级那种情况用）。 */
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

  /* ============================================================
   * 【S13】自由属性点（升级自选，失衡代选）
   * ============================================================ */
  // ---------- 自由属性点（升级自选，四项平衡，占比过低由系统代选） ----------
  /** 某一项按「属性点」口径的份额（生命 10 点折算 1 点）。 */
  function statPoints(source, key) {
    const s = object(source) ? source : S;
    const raw = Math.max(0, Number(s && s[STAT_FIELDS[key]]) || 0);
    return key === 'hp' ? raw / HP_PER_STAT : raw;
  }
  /** 力/敏/速/生命四项的占比（自然成长时各约 25%）。 */
  function statShares(source) {
    let total = 0;
    for (const key of STAT_KEYS) total += statPoints(source, key);
    const out = {};
    for (const key of STAT_KEYS) out[key] = total > 0 ? statPoints(source, key) / total : 1 / STAT_KEYS.length;
    return out;
  }
  /** 占比低于 STAT_SHARE_MIN 的属性里最低的那一项；四项都达标时返回 null。 */
  function forcedStat(source) {
    const shares = statShares(source);
    const low = STAT_KEYS.filter((key) => shares[key] < STAT_SHARE_MIN - 1e-9);
    if (!low.length) return null;
    return low.reduce((a, b) => (shares[b] < shares[a] ? b : a));
  }
  /** 占比最低的那一项（不管有没有过低）。 */
  function lowestStat(source) {
    const shares = statShares(source);
    return STAT_KEYS.reduce((a, b) => (shares[b] < shares[a] ? b : a));
  }
  /** 把一点加到某一项上（生命一点 = 5 点血）。 */
  function grantPoint(target) {
    S[STAT_FIELDS[target]] += STAT_GAIN[target];
    return target;
  }
  /** 还没分配的自由属性点：升级时就该选掉，这里只是「弹窗还没点完」的计数。 */
  function pendingPoints() { return Math.max(0, integer(S && S.freePoints, 0)); }
  /**
   * 分配一点自由属性点（力/敏/速各 +1，生命 +5）。
   * 占比过低的属性必须优先补：requested 不是它时系统直接代选，
   * 返回值里 redirected=true 供界面提示，规则不靠界面自觉。
   */
  function allocatePoint(attr) {
    if (pendingPoints() <= 0) return { ok: false, msg: '没有待分配的自由属性点' };
    if (!STAT_KEYS.includes(attr)) return { ok: false, msg: '自由属性点只能加到力量、敏捷、速度或生命' };
    const forced = forcedStat();
    const target = forced || attr;
    grantPoint(target);
    S.freePoints = pendingPoints() - 1;
    // 记下这一次到底加到了哪一项，供「撤回」原样退回去（含系统代选的那一下）
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
   * 撤回上一次自由属性点分配：把那次加上的属性原样减掉、点数退回待分配。
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
  /** 一键把待分配点铺平到四项（每次选占比最低的一项，天然满足占比门槛）。 */
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

  /* ============================================================
   * 【S14】每日收益流水（徒弟日供数据源）
   * ============================================================ */
  // ---------- 每日收益流水（徒弟日供的数据源） ----------
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
  /** 某一天自己赚到的经验与金松果（徒弟日供读昨天那一天）。 */
  function earnOn(date) {
    const row = (Array.isArray(S.earnHistory) ? S.earnHistory : []).find((d) => object(d) && d.date === date);
    return { exp: row ? Math.max(0, integer(row.exp, 0)) : 0, gold: row ? Math.max(0, integer(row.gold, 0)) : 0 };
  }
  /** 【2026-10 用户口径】调试台「重置每日与体力计时」专用：把日供的**第二道门**也放开 ——
   *  日供数额取自 `earnHistory` 的**昨天**那一条，昨天没有记录（新档 / 当天刚开始玩）时
   *  总量恒为 0，`claimable` 永远是 false，于是「清掉今日已领标记」也白搭（界面仍报领不到）。
   *  这里在「昨天那条不存在或全 0」时，把今天的收益复制一份当成昨天，让重置真的等价于
   *  「回到新的一天、日供可以再领一次」。
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
  /** 给玩家加金松果并计入当日收益流水；opts.count === false 表示这不是「赚到的」。 */
  function addGold(n, opts) {
    n = Math.round(Number(n) || 0);
    if (!S || !n) return 0;
    S.goldPoint += n;
    if (n > 0 && !(opts && opts.count === false)) trackEarn('gold', n);
    return n;
  }

  /* ============================================================
   * 【S15】经验 / 升级
   * ============================================================ */
  // ---------- 经验 / 升级 ----------
  // 返回升级信息数组（可能连升）
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
      const bookLevel = GData.ATTRIBUTE_BOOK_LEVELS.includes(S.level);
      const growth = { power: 0, agility: 0, speed: 0, hp: bookLevel ? 0 : 5 };
      if (bookLevel) S.props[37] = (S.props[37] || 0) + 1;
      else for (let point = 0; point < FREE_POINT_RANDOM; point++) {
        const attr = ['power', 'agility', 'speed', 'hp'][Math.floor(Math.random() * 4)];
        growth[attr] += attr === 'hp' ? 5 : 1;
      }
      const { power: pw, agility: ag, speed: sp, hp } = growth;
      S.power += pw; S.agility += ag; S.speed += sp; S.maxHp += hp;
      // 第 3 点由玩家在升级弹窗里自选（力/敏/速/生命）；某一项占比过低时
      let freePoint = 0, autoPoint = null;
      if (!bookLevel) {
        const forced = forcedStat();
        if (forced) { grantPoint(forced); autoPoint = forced; }
        else { S.freePoints = pendingPoints() + 1; freePoint = 1; }
      }
      // 体力上限按等级重算（2~3 级每级 +3、4~20 每级 +2、21~70 每级 +1，69 级 179、满级 180）
      S.maxEnergy = Math.max(S.maxEnergy, energyCapForLevel(S.level));
      // 升级奖励：到指定等级时给一组「三选一」候选，玩家在弹窗里选一个
      // （wsChoices 为空表示池子已满/没有可学的，就不发奖励）
      const gained = null;
      const choices = GData.WS_LEVELS.includes(S.level) ? wsChoices(3) : [];
      if (choices.length) S.wsPicks.push(choices);
      if (S.level === 5 && !S.reborn) addGold(50);
      // 升级礼包：卷轴 / 药剂 / 丹药，逢 5 级与属性书等级再加一份大礼包
      const gifts = (GData.levelGift ? GData.levelGift(S.level) : []).map((g) => {
        const item = propMap.getValue(g.id);
        S.props[g.id] = (S.props[g.id] || 0) + g.count;
        return { id: g.id, count: g.count, name: item ? item.name : '道具' };
      });
      ups.push({
        level: S.level, power: pw, agility: ag, speed: sp, hp,
        reward: gained ? gained.name : null,
        rewardId: gained ? gained.id : null,
        rewardKind: gained ? gained.kind : null,
        wsChoice: choices.length,
        attributeBook: bookLevel,
        freePoint,
        autoPoint,
        autoPointName: autoPoint ? STAT_NAMES[autoPoint] : null,
        gifts,
      });
    }
    save();
    return ups;
  }

  /* ============================================================
   * 【S16】战斗后结算（挑战玩家）
   * ============================================================ */
  // ---------- 战斗后结算（挑战玩家） ----------
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
  function tickPropStates() {
    for (const k of Object.keys(S.propsStates)) {
      if (S.propsStates[k] > 0) S.propsStates[k]--;
    }
  }
  const EXP_PILL = { 7: 0.4, 44: 0.6 };   // 经验丸 40% / 超级经验丸 60%  /** 当前生效的经验加成百分比（经验丸 + 超级经验丸，可叠加）。 */
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
    const fruit = seedId === 45 ? 47 : seedId === 46 ? 48 : 0;
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

  /** 天梯碎片合成：10 个天梯碎片 + 50 金松果 → 随机一个力量/敏捷/速度转化丸。
   *  依据 references/new/微信图片_20260924010916_259_2.jpg：天梯战飘出的碎片就是这个用途。 */
  function composeConvertPill() {
    const need = GData.CONVERT_SHARD_COST, id = GData.CONVERT_SHARD_ID;
    if ((S.props[id] || 0) < need) return { ok: false, msg: '需要 ' + need + ' 个' + GData.CONVERT_SHARD_NAME };
    if (S.goldPoint < 50) return { ok: false, msg: '合成需要 50 金松果' };
    S.props[id] -= need;
    S.goldPoint -= 50;
    const pills = GData.CONVERT_PILLS;
    const got = pills[Math.floor(Math.random() * pills.length)];
    S.props[got] = (S.props[got] || 0) + 1;
    save();
    const item = propMap.getValue(got);
    return { ok: true, msg: '合成成功：' + (item ? item.name : '转化丸'), prop: got, name: item ? item.name : '转化丸' };
  }

  /* ============================================================
   * 【S17】超级松鼠（原版 VIP）
   * ============================================================ */
  // ---------- 超级松鼠（原版 VIP） ----------
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
  /** 装备容量：原版特权 5 首次开通永久 +6 格。 */
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
  /** 特权：每日首次登陆 +1 超级松鼠经验，累积自动升级。 */
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
  /** 调试/验证用。 */
  function grantVip(days, level) {
    const v = vipState();
    v.until = Math.max(Date.now(), vipUntil()) + Math.max(1, Number(days) || 1) * 86400000;
    if (level) v.level = Math.max(1, Math.min(VIP_MAX_LEVEL, Number(level)));
    if (!v.level) v.level = 1;
    syncVipEnergyCap(); save();
    return { until: v.until, level: v.level };
  }

  /* ============================================================
   * 【S18】好友（离线版 NPC 好友）
   * ============================================================ */
  // ---------- 好友（离线版：随机 NPC 也能加） ----------
  /* 好友只是本地保存的一份对手快照（名字 + 等级 + 三维），可以切磋，不连接真实玩家。 */
  const FRIEND_LIMIT = 20;
  const friendLimit = () => FRIEND_LIMIT;
  function friendList() { if (!Array.isArray(S.friends)) S.friends = []; return S.friends; }
  function friendOf(name) { return S.friends.find((f) => f.name === name) || null; }
  /** 把一位对手（随机 NPC、师父、天梯对手都行）加为好友。 */
  function addFriend(foe) {
    const name = foe && foe.name ? String(foe.name).trim().slice(0, 20) : '';
    if (!name) return { ok: false, msg: '好友信息无效' };
    if (friendOf(name)) return { ok: false, msg: '【' + name + '】已经是好友了' };
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
       * （挑战页要给部位容器找对应装备，缺了 type 整件都贴不上去）。
       * 武器 / 技能是**切磋时的出手池**：不存的话好友切磋只能一直普攻，
       * 就没法走和随机挑战同一套「武器 / 技能 / 普攻」权重抽取。
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
   *  除了经典模式挑战页的"右侧对手展示"（装备贴图 + 战斗力），
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
  /* ============================================================
   * 好友留言（本地离线版）
   * ------------------------------------------------------------
   * 原版「查看好友 → 留言」走的是 `openWap(leaveMsgUrl + playerId)` 的外链留言板；
   * 离线版没有服务端，这里落进存档：`friendMessages[好友名] = [{text, at}]`。
   * 只允许给**当前好友列表里的好友**留言；删除好友时一起清掉。
   * ============================================================ */
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
  /** 把好友快照还原成可以战斗的对手对象（切磋用）。
   *  ⚠ 武器 / 技能必须一起带进战斗：`Sim` 的出手模型是「武器 / 技能 / 普攻」三方权重竞争，
   *  缺了这两个数组，好友就只剩普攻，和随机挑战同一只对手的表现完全不同。
   *  老档缺字段时先走 `ensureFriendLoadout()` 就地补全（与挑战页右侧展示共用同一份快照）。 */
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
  /** 推荐好友：玩家等级附近的随机 NPC（不超过满级）。 */
  function rollFriendCandidates(count) {
    const n = Math.max(1, Math.min(8, Math.round(Number(count) || 3)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const level = Math.max(1, Math.min(MAX_PLAYER_LEVEL, S.level + Math.floor(Math.random() * 7) - 2));
      out.push(genAI(level, '', { levelJitter: 1, gearSelfLevel: true }));
    }
    return out;
  }

  // 战斗奖励（挑战/竞技胜利）；胜利经验在基准值上下浮动，期望值随对手等级提升
  /* 主动挑战的经验：只看「自己的等级」和「与对手的等级差」。
   *   基准 = BASE + min(自己等级, 20) × PER_LEVEL   ← 20 级封顶，增长比以前慢
   *   倍率 = 1 + 等级差 × STEP（对手比自己高才多给，低了就少给）
   * 封顶后同级一场 33 点、最大等级差（+3）约 47 点，也就是 4.7 点体力，
   * 略低于经验竞技场的 150/30 = 5.0（竞技场仍是最快的经验来源）。
   * nextExp 每级涨得比这里快，所以每升一级需要的场次仍然越来越多。 */
  /* 随机挑战经验（2026-10 下调）：同级收益整体降低，等级差带来的增幅也大幅收窄。
   *   1) 同级基准：20 + 等级×0.65 → **16 + 等级×0.55**（20 级：33 → 27，−18%；1 级：21 → 17）
   *   2) 等级差：线性 +14%/级、压实指数 0.88 → **+9%/级、压实 0.78**
   *      同样越 3 级：倍率 1.36 → 1.22（经验 45 → 33，−27%），越级不再「滚雪球」。
   * 竞技场（冠军 150／30 体力）保持不变 —— 它是 4 人两轮、要赢才拿满，
   * 单位体力的**期望**仍与随机挑战同档；这轮只动随机挑战这一侧。 */
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
  /** 一次主动挑战胜利的经验期望（不含随机浮动与经验丸）。
   *  等级差只影响倍率，且被 EXP_DIFF_TIGHTEN 压实；diff = 0 时倍率恒为 1.00，
   *  所以**同级别挑战的经验期望不变**。 */
  function challengeExp(foeLevel, myLevel) {
    const mine = Math.max(1, Math.round(Number(myLevel) || (S && S.level) || 1));
    const diff = Math.max(-15, Math.min(15, Math.round(Number(foeLevel) || mine) - mine));
    const base = CHALLENGE_EXP_BASE + Math.min(mine, CHALLENGE_EXP_CAP_LEVEL) * CHALLENGE_EXP_PER_LEVEL;
    const linear = Math.max(EXP_DIFF_FLOOR, Math.min(EXP_DIFF_CAP, 1 + diff * EXP_DIFF_STEP));
    const mult = Math.pow(linear, EXP_DIFF_TIGHTEN);
    return Math.round(base * mult);
  }
  /** 随机挑战实际会遇到的等级差范围（classic-ui 的 genOpponents：level-1 ~ level+3）。 */
  const CHALLENGE_DIFF_RANGE = [-1, 3];
  /** 通关一级需要的挑战场次（用同级对手估算），用于核对「越来越难」。 */
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
  /* ============================================================
   * 【S19】复仇（消息页复仇标签）
   * ============================================================ */
  /* ---------- 复仇（消息页「复仇」标签） ----------
   * 输掉的挑战记在 S.battles 里，玩家可以拿录像里记下的对手数据再打一次。
   * 胜利只给「少量」经验与金松果：按同级对手赢一场能拿到的经验的
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
  /** 标记某条败绩已复仇成功（false = 记录不存在或已经复仇过）。 */
  function markRevenged(id) {
    const battle = (S.battles || []).find((b) => b && b.id === id);
    if (!battle || battle.revenged) return false;
    battle.revenged = Date.now();
    save();
    return true;
  }
  /** 原版 `alertRevenge`：第 n 次复仇要 `(n+1)*20` 金松果，赢了抢 `(n+1)*5+3` 金杯。
   *  `id` 是战斗记录 id；记录不存在时按第 1 次算（界面只在列表里的记录上调用）。 */
  function revengeInfo(id) {
    const battle = (S.battles || []).find((b) => b && b.id === id);
    const n = Math.max(0, Math.floor(Number(battle && battle.revengeCount) || 0));
    return { count: n, cost: (n + 1) * 20, cups: (n + 1) * 5 + 3, revenged: !!(battle && battle.revenged) };
  }
  function noteRevenge(id) {
    const battle = (S.battles || []).find((b) => b && b.id === id);
    if (!battle) return 0;
    battle.revengeCount = Math.max(0, Math.floor(Number(battle.revengeCount) || 0)) + 1;
    save();
    return battle.revengeCount;
  }

  /* ============================================================
   * 【S20】AI 玩家生成
   * ============================================================ */
  // ---------- AI 玩家生成 ----------
  /** AI 名字池：固定昵称池 + 前缀后缀组合，组合空间远大于固定名单。 */
  const AI_PREFIX = ['松果', '橡果', '坚果', '瓜子', '松针', '尾巴', '树梢', '森林', '飞天', '闪电', '暴躁', '萌萌',
    '快乐', '无敌', '狂战', '吃瓜', '鼠胆', '大尾', '老', '小', '铁齿', '铜牙', '旋风', '疾风'];
  const AI_CORE = ['小弟', '小鼠', '大侠', '无双', '王者', '姐姐', '妹妹', '群众', '英雄', '达人', '杀手', '猎手',
    '终结者', '收藏家', '舞者', '王子', '公主', '一霸', '战神', '掌门', '小旋风', '大魔王', '掌门人', '小队长'];
  const AI_NICK = ['吱吱喳喳', '鼠你最棒', '鼠不尽的快乐', '鼠来运转', '松鼠妹妹', '啃果群众', '尾巴翘翘', '闪电鼠',
    '吃瓜小鼠', '鼠胆英雄', '森林一霸', '松果收藏家', '暴躁小鼠', '快乐松鼠', '鼠大王', '松涛依旧', '坚果猎人',
    '瓜子杀手', '老松鼠', '鼠门弄斧', '松间明月', '大尾巴狼', '树梢舞者', '松针小王子', '橡果终结者'];

  const AI_TITLE = ['', '', '', '', '的师傅', '的师兄', '的宿敌', '二世'];

  /** 随机生成一个对手名字：固定昵称池或「前缀+核心词」，少数带称号。 */
  function randomAIName(rng) {
    const r = typeof rng === 'function' ? rng : Math.random;
    // 固定昵称（已经朗朗上口，不加称号）
    if (r() < 0.3) return AI_NICK[Math.floor(r() * AI_NICK.length)];
    const name = AI_PREFIX[Math.floor(r() * AI_PREFIX.length)] + AI_CORE[Math.floor(r() * AI_CORE.length)];
    // 称号只加在组合名上，且不超过 12 字
    const title = AI_TITLE[Math.floor(r() * AI_TITLE.length)];
    return (name + title).slice(0, 12);
  }

  /**
   * 生成一个对手。
   * opts.levelJitter：在 level 上下浮动的等级范围（默认 ±2）
   * opts.minLevel：对手等级的下限（默认 1）
   * opts.gear：是否按等级随机穿戴装备（默认按玩家等级判断）
   * opts.gearSelfLevel：按对手自身等级装备（默认 false，用玩家等级判断解锁）
   * opts.name：直接指定名字
   */
  function genAI(level, nameSuffix, opts) {
    opts = opts || {};
    level = integer(level, 1, 1);
    const jitter = Number.isFinite(opts.levelJitter) ? Math.max(0, Math.floor(opts.levelJitter)) : 2;
    const rolled = jitter ? integer(level + Math.floor(Math.random() * (2 * jitter + 1)) - jitter, 1, 1) : level;
    // 满级 70：挑战/天梯/竞技场都在玩家等级上下浮动，玩家接近满级时浮上去就会冒出 71 级以上的对手，
    // 所以在出口处统一夹一次（所有对手生成都走这里）。
    const finalLevel = Math.min(MAX_PLAYER_LEVEL, Math.max(integer(opts.minLevel, 1, 1), rolled));
    const name = (opts.name ? String(opts.name) : randomAIName()) + (nameSuffix || '');
    // 离线对手遵循相同的基础成长预算，避免用旧高成长公式压过新建玩家。
    const base = GData.initialStats();
    for (let lv = 2; lv <= finalLevel; lv++) {
      const bookLevel = GData.ATTRIBUTE_BOOK_LEVELS.includes(lv);
      if (bookLevel) {
        for (let point = 0; point < 8; point++) base[STAT_KEYS[Math.floor(Math.random() * 3)]] += 1;
        continue;
      }
      base.maxHp += 5;
      // 与玩家共用同一套点位预算：2 点随机（1/4 概率 +5 生命）+ 1 点自由点。
      // 对手不弹窗，自由点默认在四项里随机挑；占比过低时一律优先补
      // （和玩家的代选规则一致）。opts.freePointBias 是给平衡测量用的：
      // 'lowest' 走平均分配，force/power/agility/speed/hp 走堆单项。
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
    /* 武器/技能**总数 = GData.wsLimit(finalLevel)**（跟着敌人等级走，不是随机个数）；
     * 只有「分到武器还是技能」和「各自几级」是随机的。一个池抽空时从另一个池补，
     * 保证总池够时正好 nWS 个。 */
    for (let i = 0; i < nWS; i++) {
      const wantWeapon = Math.random() < 0.55;
      let pool = wantWeapon ? wsPool : skPool;
      if (!pool.length) pool = wantWeapon ? skPool : wsPool;   // 池空就换另一边，别少给
      const chooseWeapon = pool === wsPool;
      if (!pool.length) break;
      const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      let hi = 1;
      while (hi < (chooseWeapon ? 15 : 10) && Number(upgradeMap.getValue(hi).levelLimit) <= finalLevel) hi++;
      if (!chooseWeapon && [6, 13].includes(id)) hi = 1;
      (chooseWeapon ? weapons : skills).push(id + ':' + (1 + Math.floor(Math.random() * hi)));
    }
    const foe = {
      name, level: finalLevel, power: base.power, agility: base.agility, speed: base.speed,
      hp: base.maxHp, baseStats: { power: base.power, agility: base.agility, speed: base.speed, hp: base.maxHp },
      weapons, skills, isAI: true, effects: {},
    };
    // 装备：等级越高穿得越多、品质越好，并随机带附加属性
    const playerLevel = S && Number.isFinite(S.level) ? S.level : 1;
    const gearLevel = opts.gearSelfLevel ? finalLevel : Math.max(playerLevel, 1);
    if (opts.gear !== false) foe.gears = randomAIGears(finalLevel, gearLevel);
    for (const gear of foe.gears || []) {
      const info = gearInst(gear.id, gear.ext, gear.attr);
      if (!info) continue;
      /* 宝石加成与玩家侧 `totalStats` / `equipmentEffects` 同一条口径：
       * 主属性 ×(1 + gemPercent%)，附加词条 ×(1 + gem.ext%)。 */
      const gemLv = gear.gem ? gemLevel(gear.gem.id) : 0;
      const mainMul = gemLv ? 1 + gemPercent(gemLv) / 100 : 1;
      foe[['agility', 'power', 'hp', 'speed'][info.type]] += Math.round(info.abilityVal * mainMul);
      const gemBoost = gear.gem ? 1 + Math.max(0, Number(gear.gem.ext) || 0) / 100 : 1;
      for (const ext of gear.ext || []) {
        const def = attachmentMap.getValue(ext.id);
        if (!def) continue;
        const values = String(def.ability || '').split(',').map(Number);
        const val = Math.round(values[ext.level - 1] * gemBoost);
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
    /* 随机对手的**难度系数**（2026-11 用户口径："敌人属性略偏低"）。
     * 成长预算与玩家完全同一条曲线（见 `test-points`），但玩家会把每级自选点堆到
     * 力/敏、还会挑装备；AI 的随机点/随机装备打出来就偏软。这里只给**随机挑战 /
     * 竞技场 / 天梯**那几路传 `statScale`，不动关卡/塔（它们另有自己的曲线），
     * 也不改 `baseStats`（成长预算的断言仍按原值）。
     * 实测（`genAI` 玩家 optimized vs 随机对手，300 场/档）：1.08 把 15~70 级的
     * 胜率从 70~85% 压到约 57~71%，是"略偏强一点"而没到翻盘。 */
    const statScale = Number(opts.statScale);
    if (Number.isFinite(statScale) && statScale > 0 && statScale !== 1) {
      for (const key of ['power', 'agility', 'speed']) {
        foe[key] = Math.max(1, Math.round(foe[key] * statScale));
      }
      foe.hp = Math.max(1, Math.round(foe.hp * statScale));
      foe.statScale = statScale;
    }
    /* 随机对手是**满血生成**：把上限显式写出来。以前没有 maxHp，幻兽加血时会把上限
     * 误设成 `1 + bonus.hp`，Sim 再把敌人当前血量夹到几十点 —— 经典血条从满血
     * 一帧掉到 0，就是用户报的「敌人血量异常大幅降低」。 */
    if (foe.maxHp == null) foe.maxHp = Math.max(1, Math.round(foe.hp));
    return foe;
  }

  /* ---------- 对手身上「狂战套」的出现率（2026-10 用户口径，需求164） ----------
   * 狂战套（set 51，唯一的 **50 级套**）以前**独占「最高档」**：50 级以后
   * 每件装备有 75% 落进那一档 → 随机对手几乎人人全身狂战。现在改成**整只对手掷一次**：
   *   · 50 级起：10% +（等级 − 50）× 1%  →  50 级 10%、55 级 15%、60 级 20%、70 级 30%
   *   · 50 级之前：0（那套本来就要 50 级才解锁，压根不在池子里）
   * 命中 → 四件都穿狂战（仍然受穿戴率影响）；没命中 → 完全避开狂战，改穿次高档。
   * 曲线只影响**随机对手**（genAI 这条路：随机挑战 / 天梯 / 竞技场 / 推荐好友）；
   * 挑战塔的狂战敌人由 tower.js 自己造（x10 层守关），不经过这里。 */
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

  /* ---------- 随机对手的橙装 / 宝石期望 ----------
   * 橙装不是靠「高 id」：和玩家融合出来的橙装一样，是**实例级** `orange: true`
   * （底层仍是紫装 id，`gearQuality()` 会按实例算成品质 4）。
   * 两个期望都跟**玩家等级**（`refLevel`；`gearSelfLevel` 时就是对手自身等级）挂钩：
   *   · 橙装：30 级起才可能出现，30 级每件约 1% → 50 级 8% → 70 级 25%（封顶 35%）；
   *   · 宝石：45 级（原版宝石解锁）起才可能镶，橙装每件 20% → 70 级 70%；
   *     宝石等级期望 45 级 1 级 → 70 级 5 级（±1 抖动，夹在 1~7）。
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

  /** 按等级随机穿装备：优先穿当前等级能穿的最好套装（与正常玩家成长一致），偶尔穿低一档的旧装。 */
  function randomAIGears(foeLevel, refLevel) {
    const level = Math.max(1, Math.min(foeLevel, Math.floor(refLevel || foeLevel || 1)));
    const sets = [];
    gearSetMap.each((id, set) => {
      if (set && Number(set.level) <= level) sets.push({ id: Number(id), level: Number(set.level), quality: parseInt(set.quality) || 0 });
    });
    if (!sets.length) return [];
    // 正常玩家闯关到10级后基本穿满当前套装，对手的穿戴率不能差太多
    const wearChance = Math.min(0.95, 0.5 + level / 40);
    // 套装按等级从高到低分档；低等级套装的加成远小于高档，不能等概率随机
    const tiers = [];
    for (const set of sets.slice().sort((a, b) => b.level - a.level)) {
      const top = tiers[tiers.length - 1];
      if (top && top.level === set.level) top.sets.push(set);
      else tiers.push({ level: set.level, sets: [set] });
    }
    /* 狂战套**按部位**掷（2026-10 用户口径：70 级每件 50%、50 级下限 10%）：
     * 每个部位独立判一次，命中就从「狂战那一档」里挑，没命中就从**剔除狂战之后**的档位池里挑
     *（狂战是最高档唯一的成员，不剔掉的话没命中的部位仍有 75% 落进它，等于白压）。 */
    const berserkPool = tiers.filter((tier) => tier.sets.some((set) => set.id === BERSERK_SET_ID));
    const normalPool = tiers.map((tier) => ({ level: tier.level, sets: tier.sets.filter((set) => set.id !== BERSERK_SET_ID) }))
      .filter((tier) => tier.sets.length);
    if (!berserkPool.length && !normalPool.length) return [];
    const pieceChance = berserkChance(level);
    const out = [];
    const usedType = new Set();
    for (let slot = 0; slot < 4; slot++) {
      if (Math.random() > wearChance) continue;
      const useBerserk = berserkPool.length > 0 && Math.random() < pieceChance;
      const pool = useBerserk ? berserkPool : normalPool;
      if (!pool.length) break;
      // 75% 穿最好一档，20% 次一档，5% 随机一档旧装；同部位冲突时重选
      for (let attempt = 0; attempt < 3; attempt++) {
        const roll = Math.random();
        const tier = roll < 0.75 ? pool[0]
          : roll < 0.95 ? pool[Math.min(1, pool.length - 1)]
          : pool[Math.floor(Math.random() * pool.length)];
        const set = tier.sets[Math.floor(Math.random() * tier.sets.length)];
        const gearsOfSet = [];
        gearMap.each((k, v) => { if (parseInt(v.setId) === set.id) gearsOfSet.push(parseInt(v.id)); });
        if (!gearsOfSet.length) break;
        /* 命中狂战那一档的**这一件一定给狂战件**：狂战套正好 4 件 = 4 个部位、
         * 而身上最多 4 个部位，所以「取一件没用过的部位」必定取得到 —— 这样
         *「每个部位 50%」才是真的 50%。若沿用「随机取件 + 同部位不重复」，
         * 命中率会被重选吃掉约 4 成（实测 60 级 23.7%，口径要 30%），量出来跟标称对不上。 */
        let gid = null;
        if (useBerserk) {
          gid = gearsOfSet.find((id) => { const it = gearInst(id); return it && !usedType.has(it.type); });
        }
        if (gid == null) gid = gearsOfSet[Math.floor(Math.random() * gearsOfSet.length)];
        const info = gearInst(gid);
        if (!info || usedType.has(info.type)) continue;   // 同部位不重复穿
        usedType.add(info.type);
        // 原版白绿无词条，蓝装1条且最多2星，紫装2条且最多3星。
        const extSlots = fusionSlots(info.quality);
        const ext = extSlots ? randomExt(extSlots, info.quality >= 3 ? 3 : 2) : [];
        const piece = { id: gid, used: true, ext, attr: rollGearAttr(gid) };   // 主属性同样 ±10% 浮动
        /* 橙装 / 宝石：只对紫装档掷；橙装是**实例级** quality=4（不是换高 id），
         * 所以经典战斗的 q4 帧、套装收益、宝石的主属性/词条加成都会照玩家那一套生效。 */
        const ref = Math.max(1, Math.floor(Number(refLevel) || level));
        if (Number(info.quality) >= 3 && Math.random() < aiOrangeChance(ref)) {
          piece.orange = true;
          if (Math.random() < aiGemChance(ref)) {
            const lv = aiGemLevel(ref);
            if (lv) piece.gem = { id: 100 + lv, ext: lv * (2 + Math.floor(Math.random() * 3)) };
          }
        }
        out.push(piece);
        break;
      }
    }
    return out;
  }

  /* ============================================================
   * 【S21】关卡（进度/星级/扫荡）
   * ============================================================ */
  // ---------- 关卡 ----------
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
    /* 超级大关（19-36）：字典里没有这三扇门的 NPC，按同星级「大侠」模板生成，
     * 只保留 1 号位（原版每关 1 个敌人）。模板：超级螳螂←4-6、仙鹤←10-12、熊猫←16-18。 */
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
      // Recovered dictionary typo: #127 is 4-star crane (stage 10), not stage 4.
      const actualStage = Number(v.id) === 127 ? 10 : Number(v.stageId);
      if (actualStage === stageId && Number(v.npcIndex) === npcIndex) found = actualStage === Number(v.stageId) ? v : Object.assign({}, v, { stageId: String(actualStage) });
    });
    // 攻略数值为准：同星级同位置的NPC血量一致（三位师父只差攻击模式）
    const hp = found && GData.stageNpcHp(stageId, npcIndex);
    if (found && hp) found = Object.assign({}, found, { hp: String(hp) });
    return found;
  }

  // Original Mission: level 10, six sequential difficulties per master, one
  // challenge book per three-NPC run; one extra book per revival (maximum two).
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
    // A migrated old run remains resumable even if the old client let it bypass a lock.
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
    if (!run) run = S.stageRuns[stageId] = { npcIndex: 1, revives: 0, needsRevive: false };
    else if (run.needsRevive) { run.revives++; run.needsRevive = false; }
    run.attempt = 'stage_' + Date.now() + '_' + (++stageAttemptSeq);
    save();
    return { ok: true, npcIndex: run.npcIndex, token: run.attempt };
  }
  function interruptStageBattle(stageId, token) {
    const run = S.stageRuns && S.stageRuns[stageId];
    if (!run || run.attempt !== token) return false;
    delete run.attempt;
    save();
    return true;
  }
  function finishStageBattle(stageId, token, win, carryRatio) {
    stageId = Number(stageId);
    const run = S.stageRuns && S.stageRuns[stageId];
    if (!run || run.attempt !== token) return { ok: false };
    delete run.attempt;
    if (!win) {
      run.needsRevive = true;
      delete run.carryHp;   // 复活再战回满血
      save();
      return { ok: true, win: false, complete: false, exp: 0, gold: 0, ups: [], run: stageRun(stageId) };
    }
    // 每场胜利按攻略表发放该NPC的经验
    const fightExp = GData.stageNpcExp(stageId, run.npcIndex);
    const total = GData.stageEnemyCount ? GData.stageEnemyCount(stageId) : 3;
    const complete = run.npcIndex === total;
    const old = stageProgress(stageId);
    const nextNpc = Math.min(total, run.npcIndex + 1);
    S.stages[stageId] = { npcIndex: Math.max(old.npcIndex, nextNpc), passed: old.passed || complete };
    if (complete) {
      delete S.stageRuns[stageId];
      /* 常驻挑战「当日已通关次数」+1：只在一整轮（3 场全胜）通关时记，
       * 供「每通关一整次 → 敌全属性 +5%」的每日递增惩罚用（见 challengeDailyCount）。 */
      noteChallengeClear();
    }
    else {
      run.npcIndex = nextNpc;
      // 连续挑战不回满血：下一场只继承本场剩余血量（进入时再回复25%）
      if (Number.isFinite(carryRatio)) run.carryHp = Math.max(0, Math.min(1, carryRatio));
    }
    // 关卡碎片掉落：本次击败的 NPC 就可能掉碎片（不必等到整轮通关）。
    // 掉率与数量区间由 GData.STAGE_FRAGMENT 统一控制（掉率调高、数量区间收窄）。
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
       *   · 仙鹤关靠「越级」拿到蓝的那一支：没中就退回绿色的 base。
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
     * （MainMovie.as:4417-4444）领到的第三种状态就是"挑战关卡时有机会获得更多金松果"，
     * 几率 = 祭坛当前等级那一档（`buildingUpInfo`）。这里在**发放金松果的那一处**掷一次，
     * 于是界面显示的 `gold` 与实际入账永远是同一个数（不会出现"显示双倍、账上没加"）。 */
    let goldBuff = false;
    if (gold > 0 && activeBuildingBuff('stageGold')) {
      const rate = buildingDoubleRate('altar', 'stageGold');
      if (rate > 0 && Math.random() * 100 < rate) goldBuff = true;
    }
    addGold(gold * (goldBuff ? 2 : 1));
    // 45级起通关有几率获得1-2级宝石
    const gem = complete ? rollGemDrop(20) : null;
    /* 超级大关通关额外 5% 掉一个金宝箱（金宝箱本身是原版活动道具；给超级关一个稳定获取口，
     * 帮助页会把它写成「超级大关通关 5%」）。 */
    let chest = null;
    if (complete && GData.isSuperStage && GData.isSuperStage(stageId) && Math.random() < 0.05) {
      S.props[90] = (S.props[90] || 0) + 1;
      chest = { id: 90, count: 1, name: '金宝箱' };
    }
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
  /* 打开「12 小时一天」时，12:00 起换成「第二天」的日期键，于是每日礼包、免费抽奖、
   * 每日任务、天梯今日场次、弟子日供、师父踢人、真化次数、
   * VIP 每日、挑战塔当天刷新的 boss 等**所有每日刷新在 0 点与 12 点各来一次**。
   * 格式仍是 YYYY-MM-DD（存档校验 validLocalDate、earnOn 按日期查表都依赖它）。 */
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
    // 旧档没有日期时先标记今天，保留已累计的当日数据。
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
  /* ============================================================
   * 【S22b】常驻挑战的「当日已通关次数」
   *
   * 2026-10 第十五批（用户口径）：一天之内**每通关一整次常驻挑战**
   * （3 场连战全胜 = 1 次），常驻挑战的**所有敌人**全属性（力/敏/速/血）再 +5%，
   * 叠加无上限 —— 用来抑制「一天之内无限刷常驻挑战」。
   *
   * 与每日任务的 `stage` 计数区分开：那个是**每赢一场** +1（供任务「通关 N 次关卡挑战」用），
   * 这里只在**一整轮通关**时 +1（见 finishStageBattle 的 complete 分支）。
   * 随每日刷新（0 点 / 12 点，见 localDate）归零。
   * 挑战塔与无尽塔走各自的敌人构建，不读这里，天然不受影响。
   * ============================================================ */
  function challengeDaily() {
    const date = localDate();
    const cur = object(S.challengeDaily) ? S.challengeDaily : null;
    if (!cur || cur.date !== date) return { date, count: 0 };
    return { date, count: Math.max(0, Math.floor(Number(cur.count) || 0)) };
  }
  function challengeDailyCount() { return challengeDaily().count; }
  /** 通关一整次常驻挑战（3 场连战全胜）→ 当天次数 +1。 */
  function noteChallengeClear() {
    const cur = challengeDaily();
    S.challengeDaily = { date: cur.date, count: cur.count + 1 };
    save();
    return S.challengeDaily.count;
  }
  function dailyStatus() {
    const date = localDate();
    const claimed = S.dailyClaimDate === date;
    const days = Math.max(0, integer(S.loginStreak, 0, 0));
    /* 连续天数：今天已领 → 记的天数；昨天领过 → 今天续上；否则从 1 重新算。
     * 奖励随天数小幅递增（第 1 天 150，第 7 天 270），第 7 天多给 1 本挑战书；
     * 原版登录奖励的 `loginReward.days/goldCount` 是服务端下发，离线版用这条可预期的公式。 */
    const streak = claimed ? Math.max(1, days)
      : (S.dailyClaimDate === yesterdayDate() ? Math.max(1, days) + 1 : 1);
    const step = Math.min(7, streak);
    return { date, claimed, streak, gold: 150 + (step - 1) * 20, challengeBooks: 1 + (streak % 7 === 0 ? 1 : 0) };
  }

  /* ============================================================
   * 【S22】每日任务
   * ============================================================ */
  // ---------- 每日任务 ----------
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
    { key: 'sell',      name: '卖出 {n} 个道具',          steps: [1, 2, 3] },
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
  /** 当天的空计数器：键跟着 QUEST_TYPES 走，加新任务不用再改这里。 */
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
    { id: 45, range: [1, 1], weight: 0.4 },   // 天使果实种子
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
    // 只抽当前等级做得完的任务（等级也在种子之外单独参与：同一天升级会换掉做不了的题）
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
    // 除了「换天」，「当前等级做不了的任务」也要重抽（升级后旧题失效、旧档里存的越级题也会被换掉）；
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
  /** 记录一次当天行为，供每日任务计数。
   *  `silent=true` 时只改内存、不落盘 —— 给「一次动作里要记好几项」的调用方用，
   *  由外层在动作末尾统一 `save()` 一次（2026-10 审计：以前一次战斗结算最多连写 6 次存档）。 */
  function bumpDaily(key, n, silent) {
    if (!QUEST_KEYS.includes(key)) return 0;
    questState();
    S.dailyCounters[key] = Math.max(0, (Number(S.dailyCounters[key]) || 0) + (Number(n) || 1));
    if (!silent) save();
    return S.dailyCounters[key];
  }
  /** 战斗行为统一在这里记：一场算战斗，赢了再算胜场；再按战斗类型记各自的计数器。
   *  **不落盘**：调用方（`recordBattle`）末尾只 `save()` 一次。 */
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
  /** 有可领取的东西时给首页「活动」图标加提示动效。 */
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
    addGold(daily.gold);
    S.props[23] = (S.props[23] || 0) + daily.challengeBooks;
    S.loginStreak = daily.streak;
    S.dailyClaimDate = daily.date;
    save();
    return { ok: true, msg: '连续登录 ' + daily.streak + ' 天：金松果 +' + daily.gold + '，挑战书 +' + daily.challengeBooks,
      gold: daily.gold, challengeBooks: daily.challengeBooks, streak: daily.streak, date: daily.date };
  }

  function validBattle(entry) {
    return object(entry) && object(entry.me) && object(entry.foe) && object(entry.result)
      && Array.isArray(entry.result.rounds) && entry.result.rounds.length > 0 && entry.result.rounds.length <= 240
      && Array.isArray(entry.result.maxHp) && entry.result.maxHp.length === 2 && entry.result.maxHp.every((hp) => Number.isFinite(hp) && hp > 0)
      && entry.result.rounds.every((round) => object(round) && (round.attacker === 0 || round.attacker === 1)
        && Array.isArray(round.hpAfter) && round.hpAfter.length === 2 && round.hpAfter.every((hp) => Number.isFinite(hp) && hp >= 0))
      && (entry.result.winner === 0 || entry.result.winner === 1);
  }
  let battleKeySeq = 1;
  function recordBattle(entry) {
    if (!validBattle(entry)) return null;
    let snapshot;
    try { snapshot = clone(entry); } catch (e) { return null; }
    do { snapshot.id = 'b' + Date.now() + '_' + battleKeySeq++; } while ((S.battles || []).some((battle) => battle.id === snapshot.id));
    snapshot.createdAt = Date.now();
    snapshot.kind = typeof snapshot.kind === 'string' ? snapshot.kind : '挑战';
    snapshot.region = integer(snapshot.region, 0);
    snapshot.winner = snapshot.result.winner;
    S.battles = [snapshot].concat(S.battles || []).slice(0, 50);
    bumpBattleDaily(snapshot.winner === 0, snapshot.kind);
    save();
    /* 不再 clone 第二遍：`snapshot` 已写进 S.battles，返回值只给调用方读/展示；
     * 以前这里多深拷一份 360 KB 的录像，是战斗结束卡顿的一部分（2026-10 审计）。 */
    return snapshot;
  }
  function battleHistory() { return clone(S.battles || []); }
  /* 「消息」红点的两个出口（经典主界面 `SfUiMain.hasNewMessages` 用）：
   *   msgSeenAt()        —— 上次看过消息页的时间戳（0 = 从没看过）
   *   markMessagesSeen() —— 把"看到哪了"推到**当前最新一条消息的时间**并存盘
   * 记的是**消息时间**而不是 `Date.now()`：战斗记录是按 createdAt 排的，
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

  /* ============================================================
   * 【S23】导出 window.State
   * ============================================================ */
  window.State = {
    saveKey: SAVE_KEY, uiModeKey: UI_MODE_KEY, testMode: !!testMode, rememberUiMode,
    save, load, newGame, state, switchMode, activeUiMode, hasModeSave, tickEnergy, energyCountdown,
    fileProbe, fileLoad, fileWrite, fileWriteNow, fileInfo, storageMode, flushFileWrite, setSaveTransport, syncFormatTime: fmtTime, markLocalFresh: () => { fileState.freshLocal = true; },
    hasLocalSave, localSaveMeta, fileLoadedThisBoot,
    vipActive, vipLevel, vipUntil, vipDaysLeft, vipRegenMul, vipPassiveExpCap, vipExpNeed,
    vipRow, buyVip, grantVip, tickVipDaily, gearCapacity, syncVipEnergyCap,
    VIP_LEVELS, VIP_LEVEL_EXP, VIP_MAX_LEVEL, VIP_PLANS, VIP_ENERGY_BONUS, vipEnergyCap, VIP_GEAR_BONUS, GEAR_CAPACITY,
    weaponInst, skillInst, myWeapons, mySkills, wsLimit, ownedWSCount,
    upgradeInfo, doUpgrade, upgradeFails, UPGRADE_COIN, UPGRADE_FAIL_BONUS,
    trueAttemptsToday, trueUpgradeCost, isTrueLevel, TRUE_SKILL_MAX_LEVEL, TRUE_UPGRADE_GOLD_PER_U,
    fruitOptions, applyFruitChoice,
    trackEarn, earnOn, ensureYesterdayEarnings, addGold,
    apprenticeTributeTable,
    TRIBUTE_LEVEL_SUM_FULL,
    undoPoint, undoDepth, hasUpgradableWS,
    gearInst, myGears, wear, unwear, sellGear, gearSellPrice, gearSellRange, gearQuality, composeGear, mergeGears, addGear, extText, randomExt,
    gearBaseAttr, rollGearAttr, gearCostOf, GEAR_ATTR_JITTER,
    FUSION_SAME_NAME_RATE, FUSION_MUTANT_RATE, FUSION_MUTANT_SET, FUSION_EXT_UPGRADE_RATE,
    toggleGearStar, isGearStarred, gearsInDisplayOrder,
    gemLevel, gemPercent, gemMergeRate, rollGemDrop, mergeGems, socketGem, unsocketGem,
    totalStats, equipmentEffects, shopLimit, purchaseStatus, buyProp, useProp, openChestProp, gainRandomWS, wsChoices, wsInfo,
    pendingWS, currentWSChoices, chooseWS, chooseWSRandom,
    /* 30 级「自愿支持作者」的一次性提示（落存档，不换任何游戏内好处）。 */
    supportPromptPending, supportPromptTake, supportPromptReset, SUPPORT_LEVEL,
    SPEED_UNLOCK_LEVEL, SKIP_UNLOCK_LEVEL, unlockedSpeed, unlockedSkip,
    BERSERK_SET_ID, BERSERK_LEVEL, BERSERK_CHANCE_AT_50, BERSERK_CHANCE_AT_70, berserkChance,
    GEM_SOCKET_COST,
    gainExp, consumeEnergy, tickPropStates, fightReward, revengeReward, markRevenged, revengeInfo, noteRevenge, REVENGE_EXP_RATIO, expBoostPct, gainExpWithBoost,
    apprenticeTributeExpRatio, apprenticeTributeGoldRatio, TRIBUTE_EXP_MIN, TRIBUTE_EXP_MAX, TRIBUTE_GOLD_MIN, TRIBUTE_GOLD_MAX,
    // 师徒
    apprenticeCap, learnSkill, setMaster, clearMaster, addPrentice, removePrentice,
    /* 村庄建筑（祭坛 / 神迹 / 幻兽牧场）：等级 / 升级 / 当日状态 / 神迹属性点。 */
    BUILDING_UP_INFO, BUILDING_MAX_LEVEL, BUILDING_KEYS, BUILDING_IDS, BUILDING_LABEL,
    building, buildingUnlocked, buildingTier, buildingUpInfo, upgradeBuilding,
    settleBuildings, buildingBuffClaimed, claimBuildingBuff, activeBuildingBuff,
    buildingDoubleRate, miracleRecord, normalizeFoeGears,
    petLeadership, pets, petByKey, petTeam, hatchPet, setPetTeam, feedPet, evolvePet, petBattleBonus, applyPetBonuses, randomPetLoadout, PETS, PET_SKILLS,
    gearPart, gearPartQuality, gearIdsOf, autoEnergyPotion,
    gearSetFamily, setPieceCounts, setBonusOf, setBonusEffects, setBonusList, setBonusForGear,
    applySetBonuses, applyFoeSetBonuses,
    apprenticeDailyExp, apprenticeDailyGold, apprenticeDailyTotal, apprenticeDailyStatus,
    apprenticeLevelSum, apprenticeTributeRatio, claimApprenticeExp, canKickToday, kickPrentice,
    beginRecruitChallenge, finishRecruitChallenge, cancelRecruitChallenge,
    MASTER_SKILL_ID, MASTER_SKILL_NAME,
    genAI, RANDOM_FOE_SCALE, stageProgress, setStageProgress, npcOf, highestStageId, stageRun, stageAccess, stageReward,
    beginStageBattle, finishStageBattle, interruptStageBattle, abandonStageRun,
    localDate, dailyStatus, challengeDailyCount, noteChallengeClear, refreshDaily: syncDailyStats, claimDaily, recordBattle, battleHistory,
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
    statShares, forcedStat, lowestStat, pendingPoints, allocatePoint, allocateEvenly,
    STAT_SHARE_MIN, STAT_KEYS, STAT_NAMES, STAT_GAIN, HP_PER_STAT, FREE_POINT_RANDOM,
    CHALLENGE_EXP_BASE, CHALLENGE_EXP_PER_LEVEL, CHALLENGE_EXP_CAP_LEVEL, EXP_DIFF_STEP, EXP_DIFF_TIGHTEN,
    CHALLENGE_DIFF_RANGE, ARENA_CHAMPION_EXP, ARENA_ENERGY_COST, ARENA_EXP_PER_ENERGY,
  };
})();
