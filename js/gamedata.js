/* ============================================================
 * gamedata.js — 复刻版游戏常量
 * 经验表来自百度百科 UC松鼠大战词条；NPC/武器/技能/装备等
 * 数值直接读自原版 GameDict.js
 * ============================================================ */

/* ------------------------------------------------------------
 * 目录：复刻版游戏常量（经验/关卡/终局数值）
 * Ctrl+F 搜节号（如「【GD1】」）直达对应代码块。
 *
 *  【GD1】经验表与学习限制  【GD2】关卡数值  【GD3】真·武器 / 真·技能
 *  【GD4】导出 window.GData  【GD5】装备独立属性点表  【GD6】套装收益
 * ------------------------------------------------------------ */
(function () {
  'use strict';

  /* `references/ssfight/unpacked/06-游戏数据/松鼠数据表.全量.md` 的「经验表」：
   * 1~50 级与旧表逐值相同；51~70 级原来缺史料、按每级 +250 补，现按原表补齐
   * （51 级 9500 … 70 级 38580）。71~90 级原表没有：按 70 级后的同一条曲线
   * （每级 ×1.08，取整到 10）外推，正好接上 `maxLevel = 90`（MainMovie.as:19620）。 */
  /* ============================================================
   * 【GD1】经验表与学习限制
   * ============================================================ */
  const EXP_TABLE = [0, 20, 60, 140, 220, 310, 400, 490, 580, 680, 850, 1020, 1140, 1270, 1400,
    1530, 1660, 1790, 1930, 2070, 2220, 2360, 2510, 2660, 2810, 2960, 3110, 3270, 3430, 3590,
    3750, 3910, 4080, 4240, 4410, 4580, 4750, 4920, 5100, 5270, 5450, 5630, 5810, 5990, 6170,
    6350, 6530, 6720, 6900, 7090, 7280,
    /* 51~70：原版「经验表」逐行抄录 */
    9500, 10180, 10910, 11700, 12560, 13490, 14490, 15570, 16740, 18010,
    19390, 20890, 22510, 24270, 26180, 28260, 30520, 32980, 35660, 38580,
    /* 71~90：同曲线外推（×1.08/级，取整到 10） */
    41670, 45000, 48600, 52490, 56690, 61230, 66130, 71420, 77130, 83300,
    89960, 97160, 104930, 113320, 122390, 132180, 142750, 154170, 166500, 179820];
  function nextExp(level) {
    if (level < EXP_TABLE.length) return EXP_TABLE[level];
    /* 90 级是硬上限，走不到这里；给旧工具/异常等级留一条同曲线兜底。 */
    let v = EXP_TABLE[EXP_TABLE.length - 1];
    for (let lv = EXP_TABLE.length; lv <= level; lv++) v = Math.round(v * 1.08 / 10) * 10;
    return v;
  }
  const WS_LEVELS = [2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 56, 62, 68];
  /* 53/59/65 级发属性书是旧离线版的自创（原版服务端升级回包没有这三个道具；
   * 原版 1~90 级每级都是「+3 属性 +5 生命」）。为把 90 级总获取额对齐到 651，
   * 这里不再替换成长；已有属性书仍可按道具说明使用（8 点）。 */
  const ATTRIBUTE_BOOK_LEVELS = [];
  function wsLimit(level) { return WS_LEVELS.filter(lv => lv <= level).length; }
  function canLearn(kind, id, level) {
    id = Number(id);
    if (kind === 'skill' && id === 13) return false;
    return level >= 50 || !(kind === 'weapon' ? [16, 17] : [23, 24]).includes(id);
  }
  /** 被动 1~5：1~10 级按原表每级增长；11~15 级按原表“再提高 N”逐真级累加。 */
  function passiveBonus(id, level) {
    id = Number(id);
    const lv = Math.max(1, Math.min(15, Number(level) || 1));
    const baseLv = Math.min(lv, 10);
    const extra = trueSkillValue(id, lv);
    if (id === 1 || id === 2) return 2 * baseLv + extra;
    if (id === 3) return 1 * baseLv + extra;
    if (id === 4) return 8 * baseLv + extra;
    if (id === 5) return 10 + 2 * (baseLv - 1) + extra;
    return 0;
  }
  function initialStats() {
    // 资料确定总量与生命区间，随机分配权重未留存；采用等概率分配。
    const hpPoints = 6 + Math.floor(Math.random() * 5);
    const stats = { power: 3, agility: 3, speed: 3, maxHp: hpPoints * 5 };
    for (let i = 0; i < 22 - hpPoints - 9; i++) stats[['power', 'agility', 'speed'][Math.floor(Math.random() * 3)]]++;
    return stats;
  }

  // 关卡类型（1-6 螳螂, 7-12 仙鹤, 13-18 熊猫；19-24/25-30/31-36 = 超级螳螂/仙鹤/熊猫，
  // 每类 6 星。超级大关照原版 `showhardWin`：每关只有 **1 个敌人**、经验 100 起，不再是三连战。）
  /* ============================================================
   * 【GD2】关卡数值（类型/血量/经验/碎片）
   * ============================================================ */
  const STAGE_TYPES = [
    { name: '螳螂', desc: '身手敏捷，攻击速度快，当生命过低时会有惊人的爆发力', recommend: '建议10-15级玩家挑战', anim: 'tl', sheets: ['tl', 'tl_effect'], gate: 1, enemies: 3 },
    { name: '仙鹤', desc: '动作优雅，柔中带刚，前期凶猛但不擅长持久战', recommend: '建议15-20级玩家挑战', anim: 'xh', sheets: ['xh1', 'xh2', 'xh_effect1', 'xh_effect2'], gate: 2, enemies: 3 },
    { name: '熊猫', desc: '憨厚可爱，擅长在对手进攻时抓住破绽进行反击', recommend: '建议20-25级玩家挑战', anim: 'xm', sheets: ['xm1', 'xm2', 'xm_effect'], gate: 3, enemies: 3 },
    { name: '超级螳螂', desc: '超级螳螂！不要怕，没准儿能打过。', recommend: '建议30-35级玩家挑战', anim: 'tl', sheets: ['tl', 'tl_effect'], gate: 4, enemies: 1, super: true },
    { name: '超级仙鹤', desc: '超级仙鹤！你觉得够强大就来试试吧。', recommend: '建议35-40级玩家挑战', anim: 'xh', sheets: ['xh1', 'xh2', 'xh_effect1', 'xh_effect2'], gate: 5, enemies: 1, super: true },
    { name: '超级熊猫', desc: '超级熊猫！能打过就说明你已经是神鼠了！', recommend: '建议40级以上玩家挑战', anim: 'xm', sheets: ['xm1', 'xm2', 'xm_effect'], gate: 6, enemies: 1, super: true },
  ];
  function stageTypeOf(stageId) { return STAGE_TYPES[Math.max(0, Math.min(STAGE_TYPES.length - 1, Math.floor((stageId - 1) / 6)))]; }
  function stageStar(stageId) { return ((stageId - 1) % 6) + 1; }
  /** 这一关有几个敌人：普通大关 3 个，超级大关 1 个（原版 `showhardWin` 的两种文案）。 */
  function stageEnemyCount(stageId) { const t = stageTypeOf(stageId); return t && t.enemies ? t.enemies : 3; }
  function isSuperStage(stageId) { return !!(stageTypeOf(stageId) && stageTypeOf(stageId).super); }

  // 攻略记载的关卡NPC血量与经验：同星级同位置三者一致，差异只在攻击模式。
  // 字典里熊猫4-6星的血量/属性异常膨胀（疑为原数据错误），以此表为准。
  const STAGE_NPC_HP = [[243, 292, 438], [262, 314, 471], [280, 336, 504], [335, 402, 603], [400, 479, 719], [501, 601, 901]];
  const STAGE_NPC_EXP = [[3, 4, 18], [3, 4, 19], [3, 4, 20], [3, 4, 21], [3, 4, 22], [3, 4, 23]];
  /* 关卡难度系数（本项目自己的平衡取舍，不是原版数值）。
   * 上面两张表仍是原表原样保留，只在取值时打折：整体挑战强度下调一点。
   * 想回到原版强度把这里全设成 1 即可。 */
  const STAGE_DIFFICULTY = Object.freeze({ hp: 0.85, power: 0.88, agility: 0.96, speed: 0.96 });
  /* 熊猫 ★4-6（关卡 16/17/18）的攻击三维修正表：原字典这几个数值异常膨胀
   * （★4 学徒 47、★5 109、★6 213，而 ★1-3 是 20/21/22），按前面星级的斜率顺延。
   * GameDict.js 里的原表保持逐字节不动，只在这里覆盖取值。 */
  const STAGE_NPC_STAT_FIX = Object.freeze({
    16: [{ power: 25, agility: 24, speed: 25 }, { power: 30, agility: 28, speed: 29 }, { power: 46, agility: 43, speed: 45 }],
    17: [{ power: 28, agility: 27, speed: 28 }, { power: 33, agility: 31, speed: 32 }, { power: 52, agility: 48, speed: 50 }],
    18: [{ power: 31, agility: 30, speed: 31 }, { power: 36, agility: 34, speed: 35 }, { power: 58, agility: 54, speed: 56 }],
  });
  const STAGE_REWARD_MULT = 1;
  const STAGE_GOLD_MULT = 1;
  const STAGE_FRAGMENT = Object.freeze({ base: 0.42, perStar: 0.03, min: 2, max: 5, tierUp: 0.72 });
  function stageFragmentChance(star) { return Math.min(1, STAGE_FRAGMENT.base + star * STAGE_FRAGMENT.perStar); }
  const STAGE_FRAGMENT_MUL = 0.88;
  function stageChallengeFragmentChance(star) { return Math.min(1, stageFragmentChance(star) * STAGE_FRAGMENT_MUL); }
  function stageFragmentCount(random) {
    const span = Math.max(0, STAGE_FRAGMENT.max - STAGE_FRAGMENT.min);
    return STAGE_FRAGMENT.min + Math.floor((random ? random() : Math.random()) * (span + 1));
  }
  /* 蓝色碎片（道具 26）掉落系数（2026-10 用户口径）：
   * **除了碎片竞技场**（它的名次奖励 8/6/4/3 张是专属产出，不动），其它所有会掉蓝色碎片的
   * 地方都按这个系数小幅降期望 —— 普通战斗拾取池、天梯赛拾取池、常驻挑战关卡掉落、挑战塔过关。
   * 改这一个数就能整体调松/调紧；白/绿碎片与碎片竞技场的产出都不受影响。 */
  const BLUE_SHARD_DROP_MUL = 0.85;
  const stageScale = (value, factor) => Math.max(1, Math.round(Number(value) * factor));

  /* ===== 关卡强度模型：按「推荐等级」标定 =====
   * 推荐等级 = [10,15,20][类型] + 星级 − 1 → 螳螂 ★1-6 ↔ 10-15、仙鹤 ↔ 15-20、熊猫 ↔ 20-25。
   * 推荐等级下玩家的基准均值：三围 ≈ 1.53×等级 − 2.23　生命 ≈ 13.58×等级 − 10.44。
   * 关卡 NPC 的三维与血量直接按这个基准算：
   *   学徒/拳师/大侠 三围 = 玩家 × 0.70/0.78/0.72（再乘类型系数，见下）
   *   学徒/拳师/大侠 血量 = 玩家 × 0.90/1.05/1.20
   * 字典里的攻击三维只用来保留「同一关三人的相对形状」（螳螂偏敏捷、熊猫偏力量），
   * 攻略血量表 STAGE_NPC_HP 成为历史参考；想回到旧模型把 STAGE_USE_LEVEL_MODEL 设成 false。
   * 类型系数是用来抵消三种战斗风格的实际强度差（仙鹤开场展翅/前期 1.3 倍、熊猫 45% 反击、
   * 螳螂双击+低血爆发），数值同样由测量得出。 */
  const STAGE_USE_LEVEL_MODEL = true;
  const STAGE_LEVEL_BAND = Object.freeze([[10, 15], [15, 20], [20, 25], [30, 35], [35, 40], [40, 45]]);
  const STAGE_ROLE_STAT = Object.freeze([0.70, 0.78, 0.72]);
  const STAGE_ROLE_HP = Object.freeze([0.90, 1.05, 1.20]);
  const STAGE_TYPE_SCALE = Object.freeze({ tl: 1.15, xh: 0.92, xm: 1.02 });
  /* 超级大关单敌人：三侠的普通类型系数（tl 1.15 / xh 0.92 / xm 1.02）是按三连战调出来的，
   * 单挑时仙鹤偏弱、熊猫后几星偏强。给超级关单独一套形状系数与血量倍率。
   * ⚠ 原版 viewer 里的 `Mantis_boss.swf` / `Crane_boss.swf` / `Panda_boss.swf` 与 `Panda3.swf`
   *    SHA-256 完全相同（都是同一份熊猫动作占位），没有独立的超级三侠战斗矢量可替换；
   *    所以超级关仍用 tl/xh/xm 的动作图集，只在数值上区分。 */
  const SUPER_TYPE_SCALE = Object.freeze({ tl: 1.28, xh: 0.98, xm: 1.05 });
  const SUPER_HP_MUL = Object.freeze({ tl: 1.60, xh: 1.80, xm: 1.60 });
  const STAGE_PLAYER_CURVE = Object.freeze({ statPer: 1.53, statBase: -2.23, hpPer: 13.58, hpBase: -10.44 });
  /* ============================================================
   * 【GD3】真·武器 / 真·技能（终局线）
   * ============================================================ */
  /* ---------- 真·武器 / 真·技能（终局线） ----------
   * 等级口径沿用原表：1~10 是普通，11~15 依次是真1~真5（upgradeMap 第 10~14 行
   * 的成功率 100/8/5/4/3% 正好对上「真1~真5」）。所以真等级 = 等级 − 10。
   *
   * 数值直接取 ssfight 原表：
   *   · 真武器 `harmAdd1` 是**逐真级累计**（convertHarm 的 getTotal）；
   *   · 真武器 `remark1`（des1）是**固定一次**的追加效果，不是每真级都加；
   *   · 真技能 `remark1Value` 是每一档的 N；
   *       - “有 N% 几率” = 当档绝对值（龟甲 / 色诱 / 暴击 / 皮糙 / 野球）；
   *       - “将再提高 N” = 逐真级累加（力王~武器好手、移形、小宇宙、通灵、
   *         绝对防御、松果、吸铁、致命反击）。
   *   这比旧版“只取真5端点 + 线性插值”更贴近原表；原表每一档都有明确值。 */
  const TRUE_SKILL_MAX = 5;
  /* 每项：[mode, values]；mode='abs' 当档绝对值，'extra' 逐级累加，'flat' 固定值。 */
  const TRUE_SKILL_TABLE = Object.freeze({
    1:  { mode: 'extra', values: [3, 3, 4, 4, 5],     stat: 'power',   text: '将再提高N点力量' },
    2:  { mode: 'extra', values: [3, 3, 4, 4, 5],     stat: 'agility', text: '将再提高N点敏捷' },
    3:  { mode: 'extra', values: [2, 2, 3, 3, 4],     stat: 'speed',   text: '将再提高N点速度' },
    4:  { mode: 'extra', values: [12, 16, 20, 24, 28], stat: 'hp',     text: '将再提高N点生命' },
    5:  { mode: 'extra', values: [3, 3, 4, 4, 5],     stat: 'weapon',  text: '将再提高N点武器伤害' },
    7:  { mode: 'abs',   values: [20, 40, 60, 80, 100], key: 'guiJia',  text: '有N%几率可多次使用' },
    8:  { mode: 'abs',   values: [8, 16, 28, 40, 56],  key: 'stripGear', text: '有N%几率脱光对方装备，持续4回合' },
    9:  { mode: 'abs',   values: [2, 5, 9, 14, 20],    key: 'crit4',   text: '在暴击发生时，有N%几率产生4倍伤害' },
    10: { mode: 'abs',   values: [0.5, 1, 2, 3, 5],    key: 'antiCrit', text: '使对手暴击几率减少N%' },
    11: { mode: 'extra', values: [4, 4, 6, 6, 8],      key: 'dodge',   text: '将再提高N%的闪避率' },
    12: { mode: 'abs',   values: [20, 40, 60, 80, 100], key: 'doubleHit', text: '有N%几率可多使用一次' },
    14: { mode: 'extra', values: [2, 3, 4, 5, 6],      key: 'cosmos',  text: '将再提高N%属性值' },
    15: { mode: 'extra', values: [10, 12, 14, 16, 18], key: 'extraFlat', text: '将再提高N点伤害' },
    16: { mode: 'extra', values: [5, 6, 7, 8, 9],      key: 'rebound', text: '将再提高N%反弹伤害' },
    17: { mode: 'extra', values: [6, 8, 10, 12, 14],   key: 'heal',    text: '将再提高N点补血量' },
    18: { mode: 'extra', values: [6, 8, 10, 12, 18],   key: 'disarm',  text: '收缴对手武器的成功率再提高N%' },
    23: { mode: 'flat',  value: 10,                   key: 'luckyBase', text: '将再提高10点基础伤害' },
    24: { mode: 'extra', values: [8, 8, 10, 10, 12],   key: 'counter', text: '将再提高N%反击伤害' },
  });
  /** 兼容旧读取口：真5端点（绝对项取最后一档，累加项取累计值）。 */
  const TRUE_SKILL_5 = Object.freeze(Object.keys(TRUE_SKILL_TABLE).reduce((m, k) => {
    const row = TRUE_SKILL_TABLE[k];
    m[k] = { key: row.key, value: row.mode === 'abs' ? row.values[4]
      : row.mode === 'flat' ? row.value
      : row.values.reduce((a, b) => a + b, 0), src: 'ssfight' };
    return m;
  }, {}));
  /* 真·武器的追加效果：数值取自原词典 weaponsMap[id].remark1
   * （西瓜刀 +5% 连击、流星锤 +3% 扔 3 次、激光剑 +3% 暴击、狼牙棒 +6 持续伤害、
   *   板砖 +3% 打晕、忍者镖 +2% 吸血、沉默之斧 +4% 沉默）。
   * **固定一次**，只在武器等级 > 10（真形态）时生效；不要乘真级。 */
  const TRUE_WEAPON_BONUS = Object.freeze({
    4: { combo: 5 }, 10: { triple: 3 }, 11: { crit: 3 },
    12: { dot: 6 }, 13: { stun: 3 }, 14: { lifesteal: 2 }, 16: { silence: 4 },
  });
  /** 真武器的某类加成（武器不是真形态时返回 0）。 */
  function trueWeaponBonus(weapon, key) {
    if (!weapon || Number(weapon.level) <= 10) return 0;
    const row = TRUE_WEAPON_BONUS[Number(weapon.id)];
    return row && row[key] ? row[key] : 0;
  }

  /** 真等级：11 级 = 真1 … 15 级 = 真5；10 级及以下为 0。 */
  function trueLevel(level) {
    return Math.max(0, Math.min(TRUE_SKILL_MAX, Math.round(Number(level) || 0) - 10));
  }
  /** 真技能在真N 的效果：abs/flat 返回当档值；extra 返回前 N 档累计值。 */
  function trueSkillValue(id, level) {
    const row = TRUE_SKILL_TABLE[Number(id)];
    const n = trueLevel(level);
    if (!row || n <= 0) return 0;
    if (row.mode === 'flat') return row.value;
    if (row.mode === 'abs') return row.values[n - 1];
    return row.values.slice(0, n).reduce((a, b) => a + b, 0);
  }
  /** 真技能第 N 档的原始 N（UI/说明用；extra 项不是累计值）。 */
  function trueSkillStep(id, level) {
    const row = TRUE_SKILL_TABLE[Number(id)];
    const n = trueLevel(level);
    if (!row || n <= 0) return 0;
    if (row.mode === 'flat') return row.value;
    return row.values[n - 1];
  }
  function trueSkillRow(id) { return TRUE_SKILL_TABLE[Number(id)] || null; }

  function stageTargetLevel(stageId) {
    const type = Math.max(0, Math.min(STAGE_TYPES.length - 1, Math.floor((Number(stageId) - 1) / 6)));
    return STAGE_LEVEL_BAND[type][0] + stageStar(stageId) - 1;
  }
  const stagePlayerStat = (level) => STAGE_PLAYER_CURVE.statPer * level + STAGE_PLAYER_CURVE.statBase;
  const stagePlayerHp = (level) => STAGE_PLAYER_CURVE.hpPer * level + STAGE_PLAYER_CURVE.hpBase;
  function stageTypeScale(stageId) {
    const type = STAGE_TYPES[Math.max(0, Math.min(STAGE_TYPES.length - 1, Math.floor((Number(stageId) - 1) / 6)))];
    return (type && STAGE_TYPE_SCALE[type.anim]) || 1;
  }
  const stageRoleIndex = (npcIndex) => Math.max(1, Math.min(3, Math.round(Number(npcIndex) || 1))) - 1;
  /** 超级大关只有一个敌人，按「大侠」档位算血/三维（普通关按 1/2/3 号位）。 */
  const stageRoleOf = (stageId, npcIndex) => isSuperStage(stageId) ? 2 : stageRoleIndex(npcIndex);

  /* ============================================================
   * 【D5b】常驻挑战的「当日重复惩罚」
   *
   * 2026-10 第十四批（用户口径）：一天之内每多打一次常驻挑战，所有常驻挑战的
   * 敌人全属性（力/敏/速/血）再 +5%，**叠加无上限** —— 抑制一天之内无限刷。
   *   · count = State.challengeDailyCount()（每赢下一场关卡战斗 +1，随每日刷新归零）
   *   · 乘区 = 1 + 0.05 × count（count = 0 → ×1，第一天照旧）
   * 只作用在**关卡模式**的敌人构建上（classic-ui 的 stageFight）；
   * 挑战塔 / 无尽塔走各自的敌人构建（tower.js 的 buildFoe），不读这里。
   * ============================================================ */
  const CHALLENGE_DAILY_STAT_STEP = 0.05;
  function challengeDailyMul(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    return 1 + CHALLENGE_DAILY_STAT_STEP * n;
  }
  /** 把乘区套到一项数值上（至少 1，四舍五入）。 */
  function challengeDailyScale(value, count) {
    return Math.max(1, Math.round((Number(value) || 0) * challengeDailyMul(count)));
  }
  /** 关卡模式（常驻挑战）的敌人对象：三维走 stageNpcStats，血走 npc.hp（npcOf 已填攻略表），
   *  最后统一套上「当日重复惩罚」乘区。两个 UI（classic-ui / 遗留 ui.js）共用这一份，
   *  避免两边算法漂移。 */
  function stageFoe(npc, stageId, anim, dailyCount) {
    const st = stageNpcStats(npc);
    const n = Math.max(0, Math.floor(Number(dailyCount) || 0));
    /* 超级三侠（19~36 关）= 原版 `loadPlayer` 的 `chooseWz` 4/5/6，本来走
     * `Mantis_boss.swf` / `Crane_boss.swf` / `Panda_boss.swf`。参考资料里这三个
     * 外部 SWF 全是 404（viewer 里只有 Panda3 的占位副本），所以没有原版变异战斗
     * 图集可挂；把 `mutant` 传给播放器，由 `Engine` 按经典精英立绘的配色做换色皮。
     * 普通三侠不带这个标记，继续用原版 `tl/xh/xm` 图集与动作。 */
    const mutant = isSuperStage(stageId);
    return {
      name: npc && npc.name, level: stageTargetLevel(stageId) + 5,
      power: challengeDailyScale(st.power, n),
      agility: challengeDailyScale(st.agility, n),
      speed: challengeDailyScale(st.speed, n),
      hp: challengeDailyScale(npc && npc.hp, n),
      weapons: [],
      skills: String((npc && npc.skills) || '').split('|').filter(Boolean)
        .map((s) => { const q = s.split(':'); return { id: +q[0], level: +q[1] }; }),
      npcType: anim,
      mutant: mutant,
    };
  }

  const STAGE_HP_MUL = 1.18;
  /* 「常驻三侠」额外增强：1~18 关的徒弟先上阵等于多一条命，这里把普通关的
   * 三侠三维/血量再抬 12%，超级大关（19~36 变异三侠）不受这条影响。 */
  const STAGE_REGULAR_MUL = 1.06;
  const stageRegularMul = (stageId) => isSuperStage(stageId) ? 1 : STAGE_REGULAR_MUL;
  function stageNpcHp(stageId, npcIndex) {
    const role = stageRoleOf(stageId, npcIndex);
    const regular = stageRegularMul(stageId);
    if (STAGE_USE_LEVEL_MODEL) {
      /* 超级大关：单敌人、按大侠档位再乘类型专属倍率（比普通关的 1/3 连战强度高得多）。 */
      const bossMul = isSuperStage(stageId) ? (SUPER_HP_MUL[stageTypeOf(stageId).anim] || 1.6) : 1;
      return Math.max(1, Math.round(stagePlayerHp(stageTargetLevel(stageId)) * STAGE_ROLE_HP[role] * STAGE_HP_MUL * bossMul * regular));
    }
    const row = STAGE_NPC_HP[stageStar(stageId) - 1];
    return row ? stageScale(row[role] || 0, STAGE_DIFFICULTY.hp * STAGE_HP_MUL * regular) : 0;
  }
  function stageNpcExp(stageId, npcIndex) {
    /* 原版 `showFightWin`：1-3 门 = 16 + 关号×3；4-6 门 = 100 + (关号−19)×10，
     * 且超级大关只有一个敌人（这里只在 1 号位发，2/3 号位为 0）。 */
    if (isSuperStage(stageId)) {
      if (Number(npcIndex) !== 1) return 0;
      return stageScale(100 + (Number(stageId) - 19) * 10, STAGE_REWARD_MULT);
    }
    const row = STAGE_NPC_EXP[stageStar(stageId) - 1];
    return row ? stageScale(row[npcIndex - 1] || 0, STAGE_REWARD_MULT) : 0;
  }
  /** 关卡 NPC 的攻击三维。新模型按推荐等级算；旧模型按字典数值 × STAGE_DIFFICULTY 打折。 */
  function stageNpcStats(npc) {
    const raw = npc || {};
    if (STAGE_USE_LEVEL_MODEL) {
      const stageId = Number(raw.stageId) || 1;
      const role = stageRoleOf(stageId, raw.npcIndex);
      const typeScale = isSuperStage(stageId) ? (SUPER_TYPE_SCALE[stageTypeOf(stageId).anim] || 1) : stageTypeScale(stageId);
      const power = Math.max(1, Math.round(stagePlayerStat(stageTargetLevel(stageId)) * STAGE_ROLE_STAT[role] * typeScale * stageRegularMul(stageId)));
      // 用字典里（含熊猫 ★4-6 修正表）的比例保留同关三人的相对形状
      const shape = (key) => { const v = Number(raw[key]), p = Number(raw.power); return v > 0 && p > 0 ? v / p : 1; };
      return { power, agility: Math.max(1, Math.round(power * shape('agility'))), speed: Math.max(1, Math.round(power * shape('speed'))) };
    }
    // 字典里熊猫 ★4-6 的攻击三维异常膨胀（大侠 40 → 47 → 109 → 213，而血量/星级是平滑增长的，
    // 明显是原数据错误），这里按 ★1-3 的增长斜率修正；血量仍走攻略表。
    const fix = STAGE_NPC_STAT_FIX[Number(raw.stageId)] && STAGE_NPC_STAT_FIX[Number(raw.stageId)][Number(raw.npcIndex) - 1];
    const base = fix || raw;
    const regular = stageRegularMul(raw.stageId);
    return {
      power: stageScale(base.power, STAGE_DIFFICULTY.power * regular),
      agility: stageScale(base.agility, STAGE_DIFFICULTY.agility * regular),
      speed: stageScale(base.speed, STAGE_DIFFICULTY.speed * regular),
    };
  }

  // 随机玩家名字池（怀旧风）
  const AI_NAMES = ['松鼠小弟', '无敌鼠哥', '萌萌小鼠', '狂战无双', '松果大侠', '飞天小鼠', '松鼠妹妹', '啃果群众',
    '鼠来宝', '尾巴翘翘', '松针小王子', '橡果终结者', '闪电鼠', '吃瓜小鼠', '鼠胆英雄', '森林一霸', '松果收藏家',
    '暴躁小鼠', '快乐松鼠', '鼠大王', '松涛依旧', '坚果猎人', '鼠不尽的快乐', '树梢舞者', '瓜子杀手', '鼠你最棒',
    '老松鼠', '鼠门弄斧', '松间明月', '吱吱喳喳', '鼠来运转', '大尾巴狼', '松果搬运工', '夜行小鼠', '铁尾阿泰', '竹林隐士', '雪原飞狐', '三只松鼠', '爱啃瓜子', '老松树', '闪电小尾', '橡果收藏家', '暴走仓鼠', '月下鼠影', '坚果骑士', '爱笑小鼠', '松塔守卫', '疾风鼠宝', '独眼大鼠', '甜心鼠妹', '山核桃', '冬眠冠军', '铁爪老三', '尾巴打结', '松针刺客', '一口一个', '无敌小胖', '暴躁栗子', '采果小队', '林间跃者', '白肚皮', '鼠界传奇'];
  const AI_TITLES = ['', '', '', '的师傅', ''];

  // 新手初始
  /* 幻兽（原版 `petsInfo`，MainMovie.as:19146）：id / 名字 / 星级 / 等级上限 / 领导力 / 技能。
   * 数据只做字典；孵化概率、喂养/进化规则在 State 里收口。 */
  const PETS = [
    [1, '蛮犀牛', 1, 10, 5, 1], [2, '小红帽', 1, 10, 5, 2], [3, '冰原狼', 1, 10, 5, 3], [4, '水晶波波', 1, 10, 5, 5],
    [5, '小花仙', 1, 10, 5, 4], [6, '木船河童', 1, 10, 5, 7], [7, '毒蘑菇', 1, 10, 5, 6], [8, '铁桶雪人', 2, 20, 8, 1],
    [9, '电锯木偶', 2, 20, 8, 2], [10, '沈王爷', 2, 20, 8, 5], [11, '巨舌笼包', 2, 20, 8, 4], [12, '菜婶婶', 2, 20, 8, 7],
    [13, '僵尸大少', 2, 20, 8, 6], [14, '哈哈小丑', 2, 20, 8, 8], [15, '长角飞龙', 3, 30, 15, 2], [16, '百战鳄鱼', 3, 30, 15, 1],
    [17, '绿踪仙鹿', 3, 30, 15, 4], [18, '跳神娃娃', 3, 30, 15, 8], [19, '南瓜大亨', 4, 40, 24, 1], [20, '深海幽鲨', 4, 40, 24, 8],
    [21, '小恶魔', 1, 10, 5, 9], [22, '大嘴恶花', 1, 10, 5, 11], [23, '哈拉兽', 2, 20, 8, 3], [24, '异星人', 2, 20, 8, 9],
    [25, '哇哇', 2, 20, 8, 11], [26, '铁嘴蜂', 3, 30, 15, 3], [27, '铃音海豚', 3, 30, 15, 5], [28, '招财熊猫', 3, 30, 15, 10],
    [29, '稻草人', 3, 30, 15, 6], [30, '酷法', 3, 30, 15, 7], [31, '神灯', 4, 40, 24, 3], [32, '仙玲', 4, 40, 24, 10],
  ].map(([id, name, grade, maxLevel, leadership, skillId]) => ({ id, name, grade, maxLevel, leadership, skillId }));
  /* 原版 `petsSkills`（MainMovie.as:19148）逐行抄下来的显示字段。
   * 数值表（`松鼠数据表.xlsx` 的「幻兽技能」页）最后两列是 **X 的初始值 / 每级成长值**，
   * 例如奋力一击 24 + 4×（等级−1）、狂暴 12% + 2%×（等级−1）。原版客户端不含服务端结算，
   * 这里把这两列显式落成数据，Sim 与牧场详情共用同一份，避免两边各写一条公式。 */
  const PET_SKILL_RULES = {
    /* id: { serie, kind, base, step, percent, trigger(固定几率；null = 用 X), maxTimes,
     *       onAction / onFakeDie / passive, hpBelow } */
    1: { serie: '破坏', kind: 'damage', base: 24, step: 4, percent: false, trigger: 30, maxTimes: 1, onAction: true },
    2: { serie: '破坏', kind: 'damage', base: 24, step: 4, percent: false, trigger: null, maxTimes: 1, onFakeDie: true },
    3: { serie: '破坏', kind: 'rage', base: 12, step: 2, percent: true, trigger: null, maxTimes: -1, passive: true },
    4: { serie: '神圣', kind: 'healPct', base: 10.5, step: 0.5, percent: true, trigger: null, maxTimes: 1, onFakeDie: true },
    5: { serie: '神圣', kind: 'dodgeHeal', base: 11.5, step: 1.5, percent: false, trigger: null, maxTimes: -1, passive: true },
    6: { serie: '诅咒', kind: 'healCut', base: 5.5, step: 0.5, percent: true, trigger: null, maxTimes: 1, onAction: true },
    7: { serie: '诅咒', kind: 'weak', base: 11, step: 1, percent: true, trigger: 35, maxTimes: 1, onAction: true },
    8: { serie: '诅咒', kind: 'seal', base: 9.5, step: 0.5, percent: true, trigger: null, maxTimes: 1, onAction: true },
    9: { serie: '破坏', kind: 'nextCrit', base: 5.5, step: 0.5, percent: true, trigger: null, maxTimes: 1, onAction: true },
    10: { serie: '神圣', kind: 'cleanse', base: 5.5, step: 0.5, percent: true, trigger: null, maxTimes: 1, onAction: true, hpBelow: 0.5 },
    11: { serie: '诅咒', kind: 'dotPlus', base: 5.5, step: 0.5, percent: true, trigger: null, maxTimes: 1, onAction: true },
  };
  const PET_SKILLS = {
    1: { name: '奋力一击', remark: '己方行动时30%几率发动，命中后直接减少对手X点血量', levelupRemark: '减少血量提高至X' },
    2: { name: '逆向推倒', remark: '装死后发动，命中后直接减少对手X点血量', levelupRemark: '减少血量提高至X' },
    3: { name: '狂暴', remark: '血量低于200点时，伤害额外提升X%', levelupRemark: '伤害额外提升至X%' },
    4: { name: '回光术', remark: '装死后回复松鼠血量上限的X%', levelupRemark: '回血上限提高至X%' },
    5: { name: '凌波微步', remark: '每次闪避时回复X点血量', levelupRemark: '回复血量提高至X' },
    6: { name: '三聚氰胺', remark: '行动时有X%几率诅咒对手，使其回血效果减半', levelupRemark: '触发几率提高至X%' },
    7: { name: '虚弱', remark: '行动时35%几率使对手受到武器攻击时额外承受X%伤害', levelupRemark: '额外承受伤害提高至X%' },
    8: { name: '整蛊专家', remark: '行动时有X%几率封锁对手一个武器或技能', levelupRemark: '触发几率提高至X%' },
    9: { name: '打兴奋剂', remark: '行动时有X%几率使下一次攻击必定暴击', levelupRemark: '触发几率提高至X%' },
    10: { name: '油光满面', remark: '血量低于50%时，每次行动有X%几率移除自身负面效果', levelupRemark: '触发几率提高至X%' },
    11: { name: '张牙舞爪', remark: '行动时有X%几率使对手的持续负面效果多持续1回合', levelupRemark: '触发几率提高至X%' },
  };
  for (const [id, rule] of Object.entries(PET_SKILL_RULES)) {
    if (PET_SKILLS[id]) Object.assign(PET_SKILLS[id], rule);
  }
  /** 幻兽技能在当前等级下的 X（伤害点 / 回血点 / 百分比）。 */
  function petSkillValue(id, level) {
    const rule = PET_SKILL_RULES[Number(id)];
    if (!rule) return 0;
    return rule.base + rule.step * (Math.max(1, Number(level) || 1) - 1);
  }
  /** 这一级「行动时」的触发几率（%）：固定值优先，否则就是 X 本身。 */
  function petSkillTrigger(id, level) {
    const rule = PET_SKILL_RULES[Number(id)];
    if (!rule) return 0;
    return rule.trigger == null ? petSkillValue(id, level) : rule.trigger;
  }
  /** 给界面用的合并视图（名字 / 说明 / 当前 X / 当前触发几率）。 */
  function petSkillInfo(id, level) {
    const info = PET_SKILLS[Number(id)];
    if (!info) return null;
    return Object.assign({ id: Number(id), value: petSkillValue(id, level), trigger: petSkillTrigger(id, level) }, info);
  }
  const PET_GRADE_EXP = { 1: 1000, 2: 2000, 3: 5000, 4: 10000, 5: 20000 };
  const PET_GRADE_COST = { 2: 50, 3: 100, 4: 200, 5: 500 };

  const NEW_PLAYER = {
    name: '', level: 1, exp: 0, power: 5, agility: 5, speed: 4, maxHp: 40,
    energy: 90, maxEnergy: 90, goldPoint: 100, goldCup: 0, integral: null,
    weapons: [],              // 2级首次随机获得武器或技能
    skills: [],
    gears: [], wears: {},      // gears: [{id,used,key,ext:[{id,level}]}]
    /* 5 级换装教程的一次性白装：必须落存档。旧档没有这个字段时按等级/已有装备迁移，
     * 避免每次打开游戏第一次进「更换装备」都再送一件。 */
    starterGearGiven: false,
    props: { 1: 3, 2: 2 },     // 小体力药剂x3 大体力药剂x2
    freePoints: 0,             // 升级发下来、还没分配的自由属性点
    wsPicks: [],               // 升级发下来、还没选的武器/技能「三选一」组
    propsStates: {},           // 药剂生效场次 {propId: count}
    stages: {},                // stageId -> {npcIndex, passed}
    dailyWins: 0, allWins: 0, dailyFails: 0, allFails: 0,
    master: null, prentices: [],
    /* 好友留言：{ 好友名: [{text, at}] }（经典「查看好友 → 留言」的本地离线实现）。 */
    friendMessages: {},
    lastEnergyTs: 0, reborn: 0, joinRankCount: 0, rankCupClaimWeek: '', lotteryDate: '', lotteryFree: 1,
    /* 天梯商店的限购：`rankPurchases` 按周重置（普通商品），`rankPurchaseTotals` 是
     * **账号累计**（力/敏/速/血永久丸，原版每个账号只能买 1 个，见 classic-extras）。 */
    rankPurchases: {}, rankPurchaseTotals: {}, rankPurchaseWeek: '',
    /* 金宝箱「已开出、还没点确定领取」的那一包（重开就换掉它，领取才入账）。
     * 关掉游戏再进会自动入账，不会把已经开出的奖励弄丢；见 state.js 的 settlePendingChest。 */
    chestPending: null,
    /* 71~90 级升级金宝箱的**账号累计**已发数量：上限 20（每级 1 个）。
     * 转生回到 1 级再升上来不会重复发，否则「20 箱 ×12 点」可以被转生无限刷。 */
    levelChests: 0,
    /* 无尽塔黑色卡片的周限：`{week:'YYYY-MM-DD', count:0}`，每周一重置，最多 10 张。
     * 挑战塔的黑卡是一次性里程碑，不记在这里。 */
    blackCardsWeek: { week: '', count: 0 },
    /* 挑战塔黑卡的一次性账：`blackTowerLayer` = 已经发到第几层（旧档补发用），
     * `blackBox100` = 100 层自选箱是否已经发过。 */
    blackTowerLayer: 0, blackBox100: false,
    woodRecord: 0, woodCount: 0, woodDamage: 0,
    dailyClaimDate: '', battles: [], shopPurchaseDate: '', shopPurchases: {},
    /* 村庄建筑（祭坛 / 神迹 / 幻兽牧场）：`{level, upgrading, doneAt, buffId, buffDate, add, addType}`。
     * 对齐原版 `buildingInfo`（MainMovie.as:4346 `goHomeLand` 的回包）。 */
    buildings: {
      altar: { level: 1, upgrading: false, doneAt: 0, buffId: 0, buffDate: '', add: null, addType: -1 },
      miracle: { level: 1, upgrading: false, doneAt: 0, buffId: 0, buffDate: '', add: { power: 0, agility: 0, speed: 0, hp: 0 }, addType: -1 },
      beast: { level: 1, upgrading: false, doneAt: 0, buffId: 0, buffDate: '', add: null, addType: -1 },
    },
    /* 幻兽牧场（原版 hatchPoint / petsCapacity / playerPets）。老档没有时给一笔
     * 可体验的孵化点；幻兽升级会再补 200 点并加存储格。 */
    hatchPoint: 1000,
    petsCapacity: 6,
    pets: [],
    petsTeam: [],
    /* 常驻挑战的「当日已通关次数」：{date, count}，每日递增惩罚的计数（见 State.challengeDailyCount）。 */
    challengeDaily: null,
    tower: { maxLayer: 0, run: null },                                    // 无尽挑战塔（主塔）
    endless: { best: 0, weekBest: 0, weekKey: '', bestLayer: 0, shieldDate: '', run: null },
  };

  // 竞技场 AI 名称前缀
  const ARENA_TITLES = ['经验场', '碎片场'];

  /* 升级礼包：以前只有属性成长 + 随机武技，逢 5 级多给一份卷轴/药剂。
   * 普通等级随机给 1~2 个消耗品，每逢 5 级再给一份大礼包。 */
  const LEVEL_GIFT_SMALL = [21, 22, 1, 2, 3, 4, 5, 7];              // 卷轴 / 药剂 / 丹药 / 经验丸
  const LEVEL_GIFT_BIG = { 23: 2, 21: 3, 22: 3, 2: 2 };             // 挑战书 + 卷轴 + 大体力药剂
  const LEVEL_GIFT_RARE = [44, 3, 4, 5, 7];                          // 大礼包额外再抽一个
  /** 抽本次升级的礼包，返回 [{id, count}]（同一种会合并计数）。 */
  function levelGift(level) {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const merged = Object.create(null);
    const add = (id, count) => { merged[id] = (merged[id] || 0) + count; };
    add(pick(LEVEL_GIFT_SMALL), 1 + Math.floor(Math.random() * 2));
    const big = level % 5 === 0 || ATTRIBUTE_BOOK_LEVELS.includes(level);
    if (big) {
      for (const id of Object.keys(LEVEL_GIFT_BIG)) add(Number(id), LEVEL_GIFT_BIG[id]);
      add(pick(LEVEL_GIFT_RARE), 1);
    }
    return Object.keys(merged).map((id) => ({ id: Number(id), count: merged[id] }));
  }

  const GIFT_PACK_BOOST = Object.freeze({
    28: [[29, 1], [8, 50], [1, 3], [2, 2], [21, 3], [22, 3]],
    29: [[30, 1], [8, 50], [1, 3], [2, 2], [21, 3], [22, 3], [7, 1]],
    30: [[31, 1], [8, 100], [23, 3], [1, 3], [2, 2], [22, 3], [7, 1]],
    31: [[32, 1], [8, 150], [23, 3], [1, 3], [2, 2], [21, 3], [7, 1]],
    32: [[8, 200], [23, 3], [26, 30], [1, 3], [2, 2], [21, 5], [22, 5], [7, 2], [44, 1]],
  });
  /** 加强后的礼包清单；不是这几个礼包时返回 null（调用方回退到原表）。 */
  function giftPackPrize(id) {
    const rows = GIFT_PACK_BOOST[Number(id)];
    return rows ? rows.map(([pid, count]) => ({ id: pid, count })) : null;
  }

  /* 属性碎片（原版 id 66；复刻沿用 id 51 这个已占用的存档槽，避免旧档迁移）。
   * 原版 `propsArray` 的 66 是「10 个属性碎片合出随机属性永久丸」，但用户 2026-10 口径
   * 明确**不要属性永久增加**，改为随机合成 10/11/12 的力量/敏捷/速度转化丸
   *（10 个 + 50 金松果）。天梯赛战斗里会飘出这块黄色三角「?」碎片。
   * 图标 images/ui/icons/prop/prop-51.png 按 references/new/微信图片_20260924010916_259_2.jpg
   * 的黄色三角 + 「?」重画；同样只在 gamedata 里补行，GameDict.js 保持与 APK 逐字节一致。 */
  const CONVERT_SHARD_ID = 51;
  const CONVERT_SHARD_NAME = '属性碎片';
  const CONVERT_SHARD_COST = 10;
  const CONVERT_FRUIT_ID = 46;         // 恶魔果实种子：天梯同样能掉
  const CONVERT_PILLS = [10, 11, 12];  // 力量/敏捷/速度转化丸（不是永久丸）
  function registerLadderShard() {
    const map = window.propMap;
    if (!map || typeof map.put !== 'function' || map.getValue(CONVERT_SHARD_ID)) return false;
    map.put(String(CONVERT_SHARD_ID), [String(CONVERT_SHARD_ID), CONVERT_SHARD_NAME,
      CONVERT_SHARD_COST + '个' + CONVERT_SHARD_NAME + '可以随机合成1个力量/敏捷/速度转化丸。每次合成需要50个金松果。',
      '', 'false', '2']);
    return true;
  }
  registerLadderShard();

  /* 原版 Flash 有、但安卓 H5 字典里缺的几件道具。**只在 gamedata 里补行**，
   * GameDict.js 保持与 APK 逐字节一致。id 50 在本版是「抽奖卷」（无尽塔产出），
   * 原版 50 是金宝箱 —— 为了不破坏无尽塔存档，金宝箱改用 90，魔法袋用原版 79。
   * 金宝箱单箱上限 12 点：原版 71~90 级每级只发 1 箱、单箱最高 16 点；
   * 本版 71~90 级继续每级 +4 点成长（多出 80 点），所以把 20 箱从 16 点压到 12 点
   * （20×12 = 240，与「原版 20×16 = 320」减去 80 点成长差后的 240 完全相等）。
   * 魔法袋按原版天梯商店回收，且不再出属性点（原版说明只承诺黑装碎片与其它稀有道具）。 */
  const EXTRA_PROPS = [
    ['77', '黑凤凰碎片', '10个碎片可以合成1件黑色凤凰装备（顶级黑色套装）。挑战塔、无尽塔的黑色卡片、魔法袋、金宝箱与黑装融合都有几率获得。', '', 'false', '3'],
    ['78', '黑圣熊碎片', '10个碎片可以合成1件黑色圣熊装备（顶级黑色套装）。挑战塔、无尽塔的黑色卡片、魔法袋、金宝箱与黑装融合都有几率获得。', '', 'false', '3'],
    ['79', '魔法袋', '打开后随机获得一种：6级宝石3%、5级宝石15%、蓝色碎片15%（5~10个）、召唤证17%（1~2个）、金松果25%（300~500）、孵化点25%（100）；并额外获得黑色卡片×1。原版另有黑凤凰/黑圣熊碎片，离线版由黑色卡片承接。', '', 'false', '1'],
    ['80', '黑色卡片', '打开后选择凤凰或圣熊：获得对应碎片1~2个，并额外获得100/200/400金松果。挑战塔（每20/50层1张）、无尽塔（每累计50层1张，周限10）、魔法袋、金宝箱与黑装融合都有几率获得。', '', 'false', '1'],
    ['82', '召唤证', '在体力不足时，可以使用召唤证参加幻兽竞技。', '10', 'true', '2'],
    ['89', '黑装自选箱', '打开后可以任选1件黑色凤凰或黑色圣熊装备（头/拳/衣/鞋）。挑战塔第100层首通获得。', '', 'false', '1'],
    ['90', '金宝箱', '打开后随机获得一种：6级宝石4%、5级宝石22%（10%两颗/12%一颗）、基础属性点49%（6/8/10/12点）、金松果15%（500/750/1000）、黑色卡片8%、完整黑装2%（仅首开）。可花金松果重开，最多500次，单箱最高12点；重开不出完整黑装。', '20', 'false', '5'],
  ];
  function registerExtraProps() {
    const map = window.propMap;
    if (!map || typeof map.put !== 'function') return 0;
    let n = 0;
    for (const row of EXTRA_PROPS) {
      if (map.getValue(row[0])) continue;
      map.put(row[0], row.slice());
      n++;
    }
    return n;
  }
  registerExtraProps();

  /* 原版天梯商店有「魔法袋」（`松鼠数据表` 其他商店：积分1300 / 金杯2000 / 金松果200）。
   * 安卓 H5 的 GameDict 只有 14 条、没有这一件，所以同样只在 gamedata 里补一行，
   * 不改已提交的 `js/gamedict.js`。限购按账号累计 1 次（与永久属性丸同一套账）。 */
  const EXTRA_RANK_GOODS = [
    ['19', '19,魔法袋,79,1,2000,200,1300,1,1,使用后有一定几率获得稀有道具。', ','],
  ];
  function registerRankGoods() {
    const map = window.rankgoodsMap;
    if (!map || typeof map.put !== 'function') return 0;
    let n = 0;
    for (const row of EXTRA_RANK_GOODS) {
      if (map.getValue(row[0])) continue;
      map.put(row[0], row[1].split(row[2]));
      n++;
    }
    return n;
  }
  registerRankGoods();

  /* 原版道具说明里写着经验丸「竞技场中无效」，但本版经验竞技场确实吃经验丸加成
   *（见 js/classic-extras.js 的 gainExpWithBoost 调用与 tools/test-extras.cjs），
   * 所以按实际行为改写这两条说明。GameDict.js 必须与 APK 保持逐字节一致，
   * 说明修正只在这里做。
   * 注意 Map#getValue 每次都会新建对象，改动必须落到 getValue(...).source 这个底层行数组。 */
  const PROP_REMARK_FIXES = [
    [7, '增加主动挑战获得经验值40%,持续20次战斗,关卡、竞技场中无效。',
        '增加主动挑战获得经验值40%,持续20次战斗,关卡中无效。'],
    [44, '增加主动挑战获得经验值60%,持续20次战斗,关卡,竞技,天梯赛无效。',
         '增加主动挑战获得经验值60%,持续20次战斗,关卡,天梯赛无效。'],
    // 抽奖卷（id 50）：原版字典只有占位说明，无尽挑战塔正式启用后补正式文案。
    [50, '我是抽奖卷',
         '无尽挑战塔·无尽模式的战利品。每日幸运抽奖的免费次数用尽后，优先消耗1张抽奖卷再抽1次。'],
    /* 【2026-10】js/gamedict.js 改成**按原版数据重新生成**之后（tools/gen-vendor-data.cjs），
     * 下面四条要还原的文案就搬到这里 —— 字典保持「与 APK 逐字节一致」，玩家看到的仍是本版口径：
     *   · 24/25 白/绿碎片的合成费用：本版按材料品质分档（白 30 / 绿 40 / 蓝 50，见 state.js），
     *     原版说明里两条都写 50；
     *   · 47/48 天使果实 / 恶魔果实的说明：本版用简短版（原版括号里的补充说明不采用）。 */
    [24, '10个白色碎片可以随机合成一件普通的装备,每次合成需要消耗50金松果。',
         '10个白色碎片可以随机合成一件普通的装备,每次合成需要消耗30金松果。'],
    [25, '10个绿色碎片可以随机合成一件优秀的装备,每次合成需要消耗50金松果。',
         '10个绿色碎片可以随机合成一件优秀的装备,每次合成需要消耗40金松果。'],
    [47, '可随机获得1个新武器或技能（需保证武、技总数不超过当前可拥有上限数）,若获得已有的武器/技能则使用失败。',
         '可随机获得1个新武器或技能,若获得已有的武器/技能则使用失败。'],
    [48, '可随机遗忘1个旧武器或技能（若无法使用天使果实就先使用它吧）。',
         '可随机遗忘1个旧武器或技能。'],
  ];
  function applyPropRemarkFixes() {
    const map = window.propMap;
    if (!map || typeof map.getValue !== 'function') return 0;
    const remarkAt = Array.isArray(map.fields) ? map.fields.indexOf('remark') : -1;
    let done = 0;
    for (const [id, from, to] of PROP_REMARK_FIXES) {
      const row = map.getValue(id);
      if (!row || !Array.isArray(row.source)) continue;
      const at = remarkAt >= 0 ? remarkAt : row.source.indexOf(from);
      if (at < 0 || row.source[at] !== from) { console.warn('[gamedata] 道具说明未按预期匹配，跳过：' + id); continue; }
      row.source[at] = to;
      done++;
    }
    return done;
  }
  applyPropRemarkFixes();


  /* ============================================================
   * 【GD5】装备独立属性点表（源：原版 Flash 客户端）
   * ============================================================ */
  /* 源 = references/ssfight/ssfight/ssfight/resource/动作/MainMovie.as:19142 的 equipsArray。
   * 每行 [装备id, setId, quality, type(0头巾1手套2衣服3鞋), 名称, base(主属性点)]，共 288 条。
   * 原版件数（288）严格覆盖本版（128：id 1-124 / 201-204），且这 128 条的数值与
   * gearMap.abilities 逐条一致；其余 160 条（id 125-200 / 205-288）先入库备用，
   * 等做「装备种类覆盖」时可以直接取用，不用再回去翻 Flash 源码。
   * 运行时的实际属性点 = base 上再乘 ±10% 的随机（见 state.js 的 rollGearAttr）。 */
  const GEAR_BASE = [
    [1, 1, 0, 0, '斗斗头巾', 1],
    [2, 1, 0, 1, '斗斗手套', 1],
    [3, 1, 0, 2, '斗斗服', 7],
    [4, 1, 0, 3, '斗斗鞋', 1],
    [5, 2, 0, 0, '挑斗头巾', 2],
    [6, 2, 0, 1, '挑斗手套', 2],
    [7, 2, 0, 2, '挑斗服', 14],
    [8, 2, 0, 3, '挑斗鞋', 2],
    [9, 3, 1, 0, '格斗头巾', 3],
    [10, 3, 1, 1, '格斗手套', 3],
    [11, 3, 1, 2, '格斗服', 21],
    [12, 3, 1, 3, '格斗鞋', 3],
    [13, 4, 1, 0, '拳斗头巾', 4],
    [14, 4, 1, 1, '拳斗手套', 4],
    [15, 4, 1, 2, '拳斗服', 28],
    [16, 4, 1, 3, '拳斗鞋', 4],
    [17, 5, 1, 0, '忍者护额', 5],
    [18, 5, 1, 1, '忍者拳套', 5],
    [19, 5, 1, 2, '忍者服', 35],
    [20, 5, 1, 3, '忍者鞋', 5],
    [21, 6, 2, 0, '格斗头巾', 6],
    [22, 6, 2, 1, '格斗手套', 6],
    [23, 6, 2, 2, '格斗服', 42],
    [24, 6, 2, 3, '格斗鞋', 6],
    [25, 7, 2, 0, '拳斗头巾', 6],
    [26, 7, 2, 1, '拳斗手套', 6],
    [27, 7, 2, 2, '拳斗服', 42],
    [28, 7, 2, 3, '拳斗鞋', 6],
    [29, 8, 2, 0, '忍者护额', 7],
    [30, 8, 2, 1, '忍者拳套', 7],
    [31, 8, 2, 2, '忍者服', 49],
    [32, 8, 2, 3, '忍者鞋', 7],
    [33, 9, 2, 0, '螳螂头饰', 7],
    [34, 9, 2, 1, '螳螂手套', 7],
    [35, 9, 2, 2, '螳螂服', 49],
    [36, 9, 2, 3, '螳螂鞋', 7],
    [37, 10, 2, 0, '仙鹤头饰', 8],
    [38, 10, 2, 1, '仙鹤拳套', 8],
    [39, 10, 2, 2, '仙鹤服', 56],
    [40, 10, 2, 3, '仙鹤鞋', 8],
    [41, 11, 2, 0, '熊猫头饰', 8],
    [42, 11, 2, 1, '熊猫拳套', 8],
    [43, 11, 2, 2, '熊猫服', 56],
    [44, 11, 2, 3, '熊猫鞋', 8],
    [45, 12, 2, 0, '浣熊头饰', 11],
    [46, 12, 2, 1, '浣熊拳套', 11],
    [47, 12, 2, 2, '浣熊服', 77],
    [48, 12, 2, 3, '浣熊鞋', 11],
    [77, 20, 2, 0, '骑士头盔', 6],
    [78, 20, 2, 1, '骑士手套', 6],
    [79, 20, 2, 2, '骑士服', 42],
    [80, 20, 2, 3, '骑士鞋', 6],
    [81, 21, 2, 0, '维京头盔', 7],
    [82, 21, 2, 1, '维京拳套', 7],
    [83, 21, 2, 2, '维京服', 49],
    [84, 21, 2, 3, '维京鞋', 7],
    [85, 22, 2, 0, '犀牛头盔', 8],
    [86, 22, 2, 1, '犀牛拳套', 8],
    [87, 22, 2, 2, '犀牛服', 56],
    [88, 22, 2, 3, '犀牛鞋', 8],
    [89, 23, 2, 0, '幕府头盔', 9],
    [90, 23, 2, 1, '幕府拳套', 9],
    [91, 23, 2, 2, '幕府服', 63],
    [92, 23, 2, 3, '幕府鞋', 9],
    [93, 24, 2, 0, '勇者头盔', 9],
    [94, 24, 2, 1, '勇者拳套', 9],
    [95, 24, 2, 2, '勇者服', 63],
    [96, 24, 2, 3, '勇者鞋', 9],
    [97, 25, 2, 0, '诅咒头盔', 11],
    [98, 25, 2, 1, '诅咒拳套', 11],
    [99, 25, 2, 2, '诅咒服', 77],
    [100, 25, 2, 3, '诅咒鞋', 11],
    [49, 13, 3, 0, '格斗头巾', 10],
    [50, 13, 3, 1, '格斗手套', 10],
    [51, 13, 3, 2, '格斗服', 70],
    [52, 13, 3, 3, '格斗鞋', 10],
    [53, 14, 3, 0, '拳斗头巾', 10],
    [54, 14, 3, 1, '拳斗手套', 10],
    [55, 14, 3, 2, '拳斗服', 70],
    [56, 14, 3, 3, '拳斗鞋', 10],
    [57, 15, 3, 0, '忍者护额', 11],
    [58, 15, 3, 1, '忍者拳套', 11],
    [59, 15, 3, 2, '忍者服', 77],
    [60, 15, 3, 3, '忍者鞋', 11],
    [61, 16, 3, 0, '螳螂头饰', 11],
    [62, 16, 3, 1, '螳螂手套', 11],
    [63, 16, 3, 2, '螳螂服', 77],
    [64, 16, 3, 3, '螳螂鞋', 11],
    [65, 17, 3, 0, '仙鹤头饰', 12],
    [66, 17, 3, 1, '仙鹤拳套', 12],
    [67, 17, 3, 2, '仙鹤服', 84],
    [68, 17, 3, 3, '仙鹤鞋', 12],
    [69, 18, 3, 0, '熊猫头饰', 12],
    [70, 18, 3, 1, '熊猫拳套', 12],
    [71, 18, 3, 2, '熊猫服', 84],
    [72, 18, 3, 3, '熊猫鞋', 12],
    [73, 19, 3, 0, '浣熊头饰', 15],
    [74, 19, 3, 1, '浣熊拳套', 15],
    [75, 19, 3, 2, '浣熊服', 105],
    [76, 19, 3, 3, '浣熊鞋', 15],
    [101, 26, 3, 0, '骑士头盔', 10],
    [102, 26, 3, 1, '骑士手套', 10],
    [103, 26, 3, 2, '骑士服', 70],
    [104, 26, 3, 3, '骑士鞋', 10],
    [105, 27, 3, 0, '维京头盔', 11],
    [106, 27, 3, 1, '维京拳套', 11],
    [107, 27, 3, 2, '维京服', 77],
    [108, 27, 3, 3, '维京鞋', 11],
    [109, 28, 3, 0, '犀牛头盔', 12],
    [110, 28, 3, 1, '犀牛拳套', 12],
    [111, 28, 3, 2, '犀牛服', 84],
    [112, 28, 3, 3, '犀牛鞋', 12],
    [113, 29, 3, 0, '幕府头盔', 13],
    [114, 29, 3, 1, '幕府拳套', 13],
    [115, 29, 3, 2, '幕府服', 91],
    [116, 29, 3, 3, '幕府鞋', 13],
    [117, 30, 3, 0, '勇者头盔', 13],
    [118, 30, 3, 1, '勇者拳套', 13],
    [119, 30, 3, 2, '勇者服', 91],
    [120, 30, 3, 3, '勇者鞋', 13],
    [121, 31, 3, 0, '诅咒头盔', 15],
    [122, 31, 3, 1, '诅咒拳套', 15],
    [123, 31, 3, 2, '诅咒服', 105],
    [124, 31, 3, 3, '诅咒鞋', 15],
    [201, 51, 3, 0, '狂战头盔', 25],
    [202, 51, 3, 1, '狂战拳甲', 25],
    [203, 51, 3, 2, '狂战铠甲', 175],
    [204, 51, 3, 3, '狂战短靴', 25],
    [125, 32, 4, 0, '格斗头巾', 20],
    [126, 32, 4, 1, '格斗手套', 20],
    [127, 32, 4, 2, '格斗服', 140],
    [128, 32, 4, 3, '格斗鞋', 20],
    [129, 33, 4, 0, '拳斗头巾', 20],
    [130, 33, 4, 1, '拳斗手套', 20],
    [131, 33, 4, 2, '拳斗服', 140],
    [132, 33, 4, 3, '拳斗鞋', 20],
    [133, 34, 4, 0, '忍者护额', 22],
    [134, 34, 4, 1, '忍者拳套', 22],
    [135, 34, 4, 2, '忍者服', 154],
    [136, 34, 4, 3, '忍者鞋', 22],
    [137, 35, 4, 0, '螳螂头饰', 22],
    [138, 35, 4, 1, '螳螂手套', 22],
    [139, 35, 4, 2, '螳螂服', 154],
    [140, 35, 4, 3, '螳螂鞋', 22],
    [141, 36, 4, 0, '仙鹤头饰', 24],
    [142, 36, 4, 1, '仙鹤拳套', 24],
    [143, 36, 4, 2, '仙鹤服', 168],
    [144, 36, 4, 3, '仙鹤鞋', 24],
    [145, 37, 4, 0, '熊猫头饰', 24],
    [146, 37, 4, 1, '熊猫拳套', 24],
    [147, 37, 4, 2, '熊猫服', 168],
    [148, 37, 4, 3, '熊猫鞋', 24],
    [149, 38, 4, 0, '浣熊头饰', 30],
    [150, 38, 4, 1, '浣熊拳套', 30],
    [151, 38, 4, 2, '浣熊服', 210],
    [152, 38, 4, 3, '浣熊鞋', 30],
    [153, 39, 4, 0, '骑士头盔', 20],
    [154, 39, 4, 1, '骑士手套', 20],
    [155, 39, 4, 2, '骑士服', 140],
    [156, 39, 4, 3, '骑士鞋', 20],
    [157, 40, 4, 0, '维京头盔', 22],
    [158, 40, 4, 1, '维京拳套', 22],
    [159, 40, 4, 2, '维京服', 154],
    [160, 40, 4, 3, '维京鞋', 22],
    [161, 41, 4, 0, '犀牛头盔', 24],
    [162, 41, 4, 1, '犀牛拳套', 24],
    [163, 41, 4, 2, '犀牛服', 168],
    [164, 41, 4, 3, '犀牛鞋', 24],
    [165, 42, 4, 0, '幕府头盔', 26],
    [166, 42, 4, 1, '幕府拳套', 26],
    [167, 42, 4, 2, '幕府服', 182],
    [168, 42, 4, 3, '幕府鞋', 26],
    [169, 43, 4, 0, '勇者头盔', 26],
    [170, 43, 4, 1, '勇者拳套', 26],
    [171, 43, 4, 2, '勇者服', 182],
    [172, 43, 4, 3, '勇者鞋', 26],
    [173, 44, 4, 0, '诅咒头盔', 30],
    [174, 44, 4, 1, '诅咒拳套', 30],
    [175, 44, 4, 2, '诅咒服', 210],
    [176, 44, 4, 3, '诅咒鞋', 30],
    [205, 52, 4, 0, '狂战头盔', 45],
    [206, 52, 4, 1, '狂战拳甲', 45],
    [207, 52, 4, 2, '狂战铠甲', 315],
    [208, 52, 4, 3, '狂战短靴', 45],
    [177, 45, 4, 0, '怒战头盔', 40],
    [178, 45, 4, 1, '怒战拳甲', 40],
    [179, 45, 4, 2, '怒战铠甲', 280],
    [180, 45, 4, 3, '怒战短靴', 40],
    [181, 46, 5, 0, '狂战头盔', 65],
    [182, 46, 5, 1, '狂战拳甲', 65],
    [183, 46, 5, 2, '狂战铠甲', 455],
    [184, 46, 5, 3, '狂战短靴', 65],
    [185, 47, 5, 0, '怒战头盔', 60],
    [186, 47, 5, 1, '怒战拳甲', 60],
    [187, 47, 5, 2, '怒战铠甲', 420],
    [188, 47, 5, 3, '怒战短靴', 60],
    [213, 54, 5, 0, '格斗头巾', 28],
    [214, 54, 5, 1, '格斗手套', 28],
    [215, 54, 5, 2, '格斗服', 196],
    [216, 54, 5, 3, '格斗鞋', 28],
    [217, 55, 5, 0, '拳斗头巾', 28],
    [218, 55, 5, 1, '拳斗手套', 28],
    [219, 55, 5, 2, '拳斗服', 196],
    [220, 55, 5, 3, '拳斗鞋', 28],
    [221, 56, 5, 0, '忍者护额', 32],
    [222, 56, 5, 1, '忍者拳套', 32],
    [223, 56, 5, 2, '忍者服', 224],
    [224, 56, 5, 3, '忍者鞋', 32],
    [225, 57, 5, 0, '螳螂头饰', 32],
    [226, 57, 5, 1, '螳螂手套', 32],
    [227, 57, 5, 2, '螳螂服', 224],
    [228, 57, 5, 3, '螳螂鞋', 32],
    [229, 58, 5, 0, '仙鹤头饰', 36],
    [230, 58, 5, 1, '仙鹤拳套', 36],
    [231, 58, 5, 2, '仙鹤服', 252],
    [232, 58, 5, 3, '仙鹤鞋', 36],
    [233, 59, 5, 0, '熊猫头饰', 36],
    [234, 59, 5, 1, '熊猫拳套', 36],
    [235, 59, 5, 2, '熊猫服', 252],
    [236, 59, 5, 3, '熊猫鞋', 36],
    [237, 60, 5, 0, '浣熊头饰', 48],
    [238, 60, 5, 1, '浣熊拳套', 48],
    [239, 60, 5, 2, '浣熊服', 336],
    [240, 60, 5, 3, '浣熊鞋', 48],
    [241, 61, 5, 0, '骑士头盔', 28],
    [242, 61, 5, 1, '骑士手套', 28],
    [243, 61, 5, 2, '骑士服', 196],
    [244, 61, 5, 3, '骑士鞋', 28],
    [245, 62, 5, 0, '维京头盔', 32],
    [246, 62, 5, 1, '维京拳套', 32],
    [247, 62, 5, 2, '维京服', 224],
    [248, 62, 5, 3, '维京鞋', 32],
    [249, 63, 5, 0, '犀牛头盔', 36],
    [250, 63, 5, 1, '犀牛拳套', 36],
    [251, 63, 5, 2, '犀牛服', 252],
    [252, 63, 5, 3, '犀牛鞋', 36],
    [253, 64, 5, 0, '幕府头盔', 40],
    [254, 64, 5, 1, '幕府拳套', 40],
    [255, 64, 5, 2, '幕府服', 280],
    [256, 64, 5, 3, '幕府鞋', 40],
    [257, 65, 5, 0, '勇者头盔', 40],
    [258, 65, 5, 1, '勇者拳套', 40],
    [259, 65, 5, 2, '勇者服', 280],
    [260, 65, 5, 3, '勇者鞋', 40],
    [261, 66, 5, 0, '诅咒头盔', 48],
    [262, 66, 5, 1, '诅咒拳套', 48],
    [263, 66, 5, 2, '诅咒服', 336],
    [264, 66, 5, 3, '诅咒鞋', 48],
    [193, 49, 3, 0, '机器猫头', 18],
    [194, 49, 3, 1, '机器猫拳', 18],
    [195, 49, 3, 2, '机器猫服', 126],
    [196, 49, 3, 3, '机器猫鞋', 18],
    [189, 48, 3, 0, '深海头饰', 18],
    [190, 48, 3, 1, '深海拳套', 18],
    [191, 48, 3, 2, '深海服', 126],
    [192, 48, 3, 3, '深海鞋', 18],
    [277, 70, 5, 0, '机器猫头', 56],
    [278, 70, 5, 1, '机器猫拳', 56],
    [279, 70, 5, 2, '机器猫服', 392],
    [280, 70, 5, 3, '机器猫鞋', 56],
    [273, 69, 5, 0, '深海头饰', 56],
    [274, 69, 5, 1, '深海拳套', 56],
    [275, 69, 5, 2, '深海服', 392],
    [276, 69, 5, 3, '深海鞋', 56],
    [285, 72, 5, 0, '圣熊头盔', 70],
    [286, 72, 5, 1, '圣熊拳甲', 70],
    [287, 72, 5, 2, '圣熊铠甲', 490],
    [288, 72, 5, 3, '圣熊短靴', 70],
    [281, 71, 5, 0, '凤凰头盔', 70],
    [282, 71, 5, 1, '凤凰拳甲', 70],
    [283, 71, 5, 2, '凤凰铠甲', 490],
    [284, 71, 5, 3, '凤凰短靴', 70],
    [209, 53, 4, 0, '机器猫头', 36],
    [210, 53, 4, 1, '机器猫拳', 36],
    [211, 53, 4, 2, '机器猫服', 252],
    [212, 53, 4, 3, '机器猫鞋', 36],
    [197, 50, 4, 0, '深海头饰', 36],
    [198, 50, 4, 1, '深海拳套', 36],
    [199, 50, 4, 2, '深海服', 252],
    [200, 50, 4, 3, '深海鞋', 36],
    [265, 67, 5, 0, '狂战头盔', 65],
    [266, 67, 5, 1, '狂战拳甲', 65],
    [267, 67, 5, 2, '狂战铠甲', 455],
    [268, 67, 5, 3, '狂战短靴', 65],
    [269, 68, 5, 0, '怒战头盔', 60],
    [270, 68, 5, 1, '怒战拳甲', 60],
    [271, 68, 5, 2, '怒战铠甲', 420],
    [272, 68, 5, 3, '怒战短靴', 60],
  ];
  const GEAR_BASE_ATTR = {};
  for (const row of GEAR_BASE) GEAR_BASE_ATTR[row[0]] = row[5];

  /* 黑装：`GEAR_BASE` 里 46/47/67~72 共 8 套、32 件的数据是全的，但 APK 的
   * `gearMap` 只有 128 件（1~124 / 201~204）、`gearSetMap` 只有 32 套 —— 所以
   * `addGear(281)` 现在会返回 null。这里在运行期补行，**不改已提交的 gamedict.js**：
   *   · gearSetMap：品质 5、使用等级 60（原版 `showFusion` 写「橙装50，黑装60级」）、
   *     组号/序号取原版 equipsArray（46=21 / 47=22 / 67=19 / 68=20 / 69=23 / 70=24 / 71=25 / 72=26）；
   *   · gearMap：abilities 按部位填（头=敏 / 手=力 / 衣=血 / 鞋=速），与 GEAR_BASE 逐值一致。
   * quality=5 的黑装在这里补；quality=4 的橙装由下面 registerOrangeGear() 按原版 288 行补齐。 */
  const BLACK_GEAR_SETS = Object.freeze([
    Object.freeze({ id: 46, group: 21, index: 33 }),
    Object.freeze({ id: 47, group: 22, index: 34 }),
    Object.freeze({ id: 67, group: 19, index: 35 }),
    Object.freeze({ id: 68, group: 20, index: 36 }),
    Object.freeze({ id: 69, group: 23, index: 37 }),
    Object.freeze({ id: 70, group: 24, index: 38 }),
    Object.freeze({ id: 71, group: 25, index: 39 }),
    Object.freeze({ id: 72, group: 26, index: 40 }),
  ]);
  const BLACK_SHARD_SET = Object.freeze({ 77: 71, 78: 72 });
  const BLACK_CARD_ID = 80;
  const BLACK_BOX_ID = 89;
  function registerBlackGear() {
    const gmap = window.gearMap, smap = window.gearSetMap;
    if (!gmap || !smap || typeof gmap.put !== 'function' || typeof smap.put !== 'function') return 0;
    let n = 0;
    for (const set of BLACK_GEAR_SETS) {
      if (smap.getValue(String(set.id))) continue;
      smap.put(String(set.id), [String(set.id), '5', String(set.group), '60', '1400', '1400', String(set.index)]);
      n++;
    }
    for (const row of GEAR_BASE) {
      const [id, setId, quality, type, name, base] = row;
      if (Number(quality) !== 5) continue;
      if (!BLACK_GEAR_SETS.some((set) => set.id === Number(setId))) continue;
      if (gmap.getValue(String(id))) continue;
      const abilities = [0, 0, 0, 0];
      abilities[Number(type)] = Number(base);
      gmap.put(String(id), [String(id), abilities.join(','), String(type), name, String(setId)]);
      n++;
    }
    return n;
  }
  registerBlackGear();

  /* 橙装 q4：APK 的 gearMap/gearSetMap 同样只有紫装档，原版 equipsArray 里的 125~180 /
   * 197~212 / 205~208 这 64 件 q4 数据没有进 map。以前用「紫装 id + orange 标记」模拟，
   * 结果橙装实际吃的是紫装基础值（狂战 25/175，而原版橙装是 45/315）。这里按原版表补齐
   * q4 的 set/gear 行，让 `addGear(205)` / 融合产物都拿到原版 q4 属性。
   * set.index 沿用同家族紫装的原画索引（狂战橙=32，黑=33），保证立绘仍走原版橙稿。 */
  const ORANGE_GEAR_SET_INDEX = Object.freeze({
    32: 6, 33: 7, 34: 8, 35: 9, 36: 10, 37: 11, 38: 12,
    39: 20, 40: 21, 41: 22, 42: 23, 43: 24, 44: 25,
    45: 34, 50: 37, 52: 32, 53: 38,
  });
  function registerOrangeGear() {
    const gmap = window.gearMap, smap = window.gearSetMap;
    if (!gmap || !smap || typeof gmap.put !== 'function' || typeof smap.put !== 'function') return 0;
    let n = 0;
    for (const row of GEAR_BASE) {
      const [id, setId, quality, type, name, base] = row;
      if (Number(quality) !== 4) continue;
      if (!smap.getValue(String(setId))) {
        const index = ORANGE_GEAR_SET_INDEX[Number(setId)] || Number(setId);
        smap.put(String(setId), [String(setId), '4', String(setId), '50', '0', '550', String(index)]);
        n++;
      }
      if (gmap.getValue(String(id))) continue;
      const abilities = [0, 0, 0, 0];
      abilities[Number(type)] = Number(base);
      gmap.put(String(id), [String(id), abilities.join(','), String(type), name, String(setId)]);
      n++;
    }
    return n;
  }
  registerOrangeGear();

  /* ============================================================
   * 【GD6】套装收益（**本复刻版新增，原版没有**）
   * ============================================================ */
  /* 原版的 gearSetMap.setId 只决定「使用等级 / 售价 / 品质颜色 / 贴图序号」，
   * 穿满一套**没有任何额外收益**（见原版 GameDict.js 的 gearSetMap 与
   * MainMovie.as 的 getEquips()：gather 属性时逐件相加，从不数同套件数）。
   * 所以这一整套机制是本版自己设计的，目标是：
   *   ① 让「凑齐一套同名的装备」本身成为一条追求线（现在装备只有名字/等级差异）；
   *   ② 收益压在「1~2 条好词条」的量级 —— 玩家为了套装收益要放弃跨套挑词条的自由，
   *      反之想要极品词条就得混搭、放弃套装收益；
   *   ③ 收益特征尽量贴合套装名字（忍者=闪避、骑士=减伤、狂战=低血狂暴……）。
   *
   * 口径：
   *   · **家族** = 装备名去掉部位后缀（忍者护额/拳套/服/鞋 → 忍者）。
   *     同名跨品质算同一家族（忍者绿/蓝/紫都叫忍者），所以「凑名」比「凑某个 setId」宽松得多。
   *   · 阈值只有 **2 件 / 4 件**两档，4 件档**叠加**在 2 件档之上（穿 4 件 = 2 件档 + 4 件档）。
   *   · 数值 = 基础值 × 品质系数，品质取**所穿该家族装备里最低的那一件**
   *     （套装成色按最差的一件算，所以要满收益就得整套同品质）。
   *
   * 键的含义（基础值以蓝装为 1.0 基准，改数值只动这张表）：
   *   power/agility/speed/hp  → 属性合计（state.js 的 totalStats 直接加）
   *   dmgMul                  → 造成的伤害 +N%（比例，0.06 = +6%）
   *   critBonus/critDmgBonus  → 暴击率 / 暴击伤害 +N 个百分点
   *   dodgeBonus              → 闪避率 +N 个百分点
   *   takenMul                → 受到伤害 +N%（**负数为减伤**）
   *   lifestealPct/thornsPct  → 吸血 / 反伤 N%
   *   shellPct                → 开局护盾 = N% 最大生命
   *   regenPct                → 每回合回复 N% 最大生命
   *   openerPowerMul/openerRounds → 开场前 N 次出手攻击 +N%
   *   lowHpAt + lowHp*        → 生命低于 N% 时生效的那一组（阈值不随品质缩放）
   * 其余键先不开放：没有对应的结算口子，写了也不会生效。
   *
   * **数值量级是实测标定的**（配对模拟：25 级随机玩家 vs 23 级随机对手，同一随机流，
   * 1000 组配对，见 docs/更新记录.md 第三十二/三十三批）。两条实测结论值得记住：
   *   ① **速度最贵**（+1 速度 ≈ +3pt 胜率，+10 力量只有 ≈ +4pt），所以带速度的家族必须很少；
   *   ② **反伤别给小数值** —— sim 里 `Math.max(1, round(伤害 × 比例))` 有 1 点地板，
   *      1~2% 的反伤实际等于「每次挨打固定反 1 点」，实测能顶 +6pt，所以这张表不用 thornsPct。
   */
  /* 品质系数：白 / 绿 / 蓝 / 紫 / 橙。
   * **橙 = 紫 × 1.5**（0.65 → 1.3 → 1.95）：橙装是三件紫装融合出来的顶级档，
   * 收益比紫装再高一半，才对得起「3 件紫 → 1 件橙」的成本。 */
  const SET_BONUS_TIER_MUL = Object.freeze([0.5, 0.75, 1, 1.3, 1.95]);
  /* 全局强度系数：整张表一起放大 / 缩小（改平衡时先动这一个数）。
   * 只乘「数值」，结构值（openerRounds / lowHpAt）不受影响。 */
  const SET_BONUS_GLOBAL_MUL = 1.5;
  /* 蓝套及以上的生命上限效果再单独乘一倍（见下表 hp 的取值口径）：
   * 先按 ×5 试过，实测紫色时一个 2 件档就是 +78 生命（≈ 25 级玩家血量的 30%），
   * 熊猫/犀牛只穿 2 件就顶别人满 4 件，家族之间彻底失衡 —— 用户改判为 ×2。 */
  const SET_BONUS_HP_MUL = 2;
  /* 白装专属家族：不属于「蓝套及以上」，生命不吃上面那一倍。 */
  const SET_BONUS_HP_EXEMPT = Object.freeze(['斗斗', '挑斗']);
  /* 家族品质下限（品质下标）：狂战是唯一的 50 级传说档，按橙装系数（1.95）计。 */
  const SET_BONUS_FAMILY_FLOOR = Object.freeze({ 狂战: 4 });
  /* 不随品质缩放的「结构值」与取整方式。 */
  const SET_BONUS_RAW_KEYS = Object.freeze(['openerRounds', 'lowHpAt']);
  const SET_BONUS_INT_KEYS = Object.freeze(['power', 'agility', 'speed', 'hp', 'openerRounds']);
  /* 以「百分点」计数的键（暴击率 / 暴击伤害 / 闪避率）保留 1 位小数就够；
   * 其余的键是**比例**（0.06 = 6%），必须留到 3 位小数 —— 否则 0.06 会被取整成 0.1（显示成 10%）。 */
  const SET_BONUS_POINT_KEYS = Object.freeze(['critBonus', 'critDmgBonus', 'dodgeBonus']);
  const SET_BONUS_ATTR_KEYS = Object.freeze(['power', 'agility', 'speed', 'hp']);
  const SET_BONUS = Object.freeze({
    /* —— 白装档（10 级入门，玩家很快就换掉，只给一点点起步优势；白装不属于「蓝套及以上」，
     *     所以它的生命不吃 ×2） —— */
    斗斗: { 2: { hp: 10 }, 4: { hp: 16, power: 2, agility: 2 } },
    挑斗: { 2: { power: 3 }, 4: { power: 3, dmgMul: 0.03 } },
    /* —— 绿/蓝/紫三档都在的中期家族 —— */
    格斗: { 2: { power: 3 }, 4: { power: 5, hp: 10 } },
    拳斗: { 2: { critBonus: 3 }, 4: { critBonus: 5, critDmgBonus: 25 } },
    忍者: { 2: { dodgeBonus: 2 }, 4: { dodgeBonus: 3, speed: 1 } },
    骑士: { 2: { takenMul: -0.03 }, 4: { hp: 8, takenMul: -0.04 } },
    维京: { 2: { power: 3 }, 4: { power: 5, dmgMul: 0.04 } },
    /* —— 蓝/紫两档的后期家族（各自一个明确特征） —— */
    螳螂: { 2: { power: 4 }, 4: { lowHpAt: 0.5, lowHpPowerMul: 0.20, lowHpSpeedMul: 0.10 } },
    仙鹤: { 2: { agility: 5, power: 3 }, 4: { openerPowerMul: 0.35, openerRounds: 4 } },
    熊猫: { 2: { hp: 8 }, 4: { hp: 6, regenPct: 0.008 } },
    浣熊: { 2: { lifestealPct: 0.03 }, 4: { hp: 10, lifestealPct: 0.05 } },
    犀牛: { 2: { hp: 8 }, 4: { hp: 8, shellPct: 0.035 } },
    幕府: { 2: { takenMul: -0.03 }, 4: { lowHpAt: 0.35, lowHpTakenMul: -0.15 } },
    勇者: { 2: { power: 3, agility: 3 }, 4: { power: 3, agility: 3, hp: 8 } },
    诅咒: { 2: { dmgMul: 0.06, takenMul: 0.04 }, 4: { dmgMul: 0.09, critDmgBonus: 15, takenMul: 0.06 } },
    /* —— 唯一的 50 级传说档（天梯商店 / 紫装融合变异），按橙档系数 1.95 计 ——
     * 吸血这里写 0.05：× 1.95 = 9.75% ≈ 10%（用户口径「狂战吸血削到 10%」）。 */
    狂战: { 2: { power: 3, critBonus: 2 }, 4: { lowHpAt: 0.4, lowHpFinalMul: 0.10, lowHpPowerMul: 0.08, lowHpLifestealPct: 0.05 } },
  });
  /** 某家族在某个品质下的收益系数（品质系数 × 全局强度系数；狂战有下限）。 */
  function setBonusTierMul(family, quality) {
    const q = Math.max(0, Math.min(SET_BONUS_TIER_MUL.length - 1, Number(quality) || 0));
    const floor = SET_BONUS_FAMILY_FLOOR[family];
    return SET_BONUS_TIER_MUL[Math.max(q, floor == null ? 0 : floor)] * SET_BONUS_GLOBAL_MUL;
  }
  /** 把基础值按系数展开成实际数值：属性与 openerRounds 取整，其余保留小数（见上面的取整口径）。
   *  `hp` 额外再吃一次 SET_BONUS_HP_MUL（「蓝套及以上的生命上限」那一条；白装家族不在内）。 */
  function setBonusScale(family, quality, base) {
    const mul = setBonusTierMul(family, quality);
    const hpMul = SET_BONUS_HP_EXEMPT.includes(family) ? 1 : SET_BONUS_HP_MUL;
    const out = {};
    for (const [k, v] of Object.entries(base || {})) {
      const n = Number(v) || 0;
      if (!n) continue;
      if (SET_BONUS_RAW_KEYS.includes(k)) { out[k] = n; continue; }
      const scaled = n * mul * (k === 'hp' ? hpMul : 1);
      if (SET_BONUS_INT_KEYS.includes(k)) { out[k] = Math.max(1, Math.round(scaled)); continue; }
      const digits = SET_BONUS_POINT_KEYS.includes(k) ? 10 : 1000;
      const r = Math.round(scaled * digits) / digits;
      out[k] = r === 0 ? 0 : r;   // 把 -0 归一成 0（-0 是 falsy，会让收益在界面上凭空消失）
    }
    return out;
  }
  const setBonusTable = (family) => SET_BONUS[family] || null;
  /** 收益数值 → 可直接显示的多行文案（界面与帮助共用，避免文案和数值走偏）。 */
  function setBonusText(eff) {
    eff = eff || {};
    const num = (v) => String(Math.round(Number(v) * 10) / 10);
    const pct = (v) => num(Math.abs(Number(v)) * 100);
    const out = [];
    for (const k of ['power', 'agility', 'speed', 'hp']) {
      if (eff[k]) out.push({ power: '力量', agility: '敏捷', speed: '速度', hp: '生命' }[k] + ' +' + num(eff[k]));
    }
    if (eff.dmgMul) out.push('造成伤害 +' + pct(eff.dmgMul) + '%');
    if (eff.critBonus) out.push('暴击率 +' + num(eff.critBonus) + '%');
    if (eff.critDmgBonus) out.push('暴击伤害 +' + num(eff.critDmgBonus) + '%');
    if (eff.dodgeBonus) out.push('闪避率 +' + num(eff.dodgeBonus) + '%');
    if (eff.takenMul) out.push((eff.takenMul < 0 ? '受到伤害 −' : '受到伤害 +') + pct(eff.takenMul) + '%');
    if (eff.lifestealPct) out.push('吸血 ' + pct(eff.lifestealPct) + '%');
    if (eff.thornsPct) out.push('反伤 ' + pct(eff.thornsPct) + '%');
    if (eff.shellPct) out.push('开局护盾 ' + pct(eff.shellPct) + '% 最大生命');
    if (eff.regenPct) out.push('每回合回复 ' + pct(eff.regenPct) + '% 生命');
    if (eff.openerPowerMul) out.push('开场 ' + (eff.openerRounds || 3) + ' 次出手攻击 +' + pct(eff.openerPowerMul) + '%');
    const low = [];
    if (eff.lowHpFinalMul) low.push('造成伤害 +' + pct(eff.lowHpFinalMul) + '%');
    if (eff.lowHpPowerMul) low.push('力量 +' + pct(eff.lowHpPowerMul) + '%');
    if (eff.lowHpSpeedMul) low.push('速度 +' + pct(eff.lowHpSpeedMul) + '%');
    if (eff.lowHpTakenMul) low.push('受到伤害 −' + pct(eff.lowHpTakenMul) + '%');
    if (eff.lowHpLifestealPct) low.push('吸血 ' + pct(eff.lowHpLifestealPct) + '%');
    if (low.length) out.push('生命低于 ' + Math.round((Number(eff.lowHpAt) || 0.5) * 100) + '% 时：' + low.join('、'));
    return out;
  }

  /* ============================================================
   * 【GD4】导出 window.GData
   * ============================================================ */
  window.GData = { EXP_TABLE, nextExp, WS_LEVELS, ATTRIBUTE_BOOK_LEVELS, wsLimit, canLearn, passiveBonus, initialStats, STAGE_TYPES, stageTypeOf, stageStar, stageEnemyCount, isSuperStage, STAGE_NPC_HP, STAGE_NPC_EXP, STAGE_DIFFICULTY, STAGE_HP_MUL, STAGE_NPC_STAT_FIX, STAGE_REWARD_MULT, STAGE_GOLD_MULT,
    STAGE_USE_LEVEL_MODEL, STAGE_LEVEL_BAND, STAGE_ROLE_STAT, STAGE_ROLE_HP, STAGE_REGULAR_MUL, SUPER_HP_MUL, SUPER_TYPE_SCALE, STAGE_TYPE_SCALE, STAGE_PLAYER_CURVE,
    trueLevel, trueSkillValue, trueSkillStep, trueSkillRow, TRUE_SKILL_TABLE, TRUE_SKILL_5, TRUE_SKILL_MAX, TRUE_WEAPON_BONUS, trueWeaponBonus,
    stageTargetLevel, stagePlayerStat, stagePlayerHp, stageTypeScale, CHALLENGE_DAILY_STAT_STEP, challengeDailyMul, challengeDailyScale, stageFoe, STAGE_FRAGMENT, STAGE_FRAGMENT_MUL, stageFragmentChance, stageChallengeFragmentChance, stageFragmentCount, BLUE_SHARD_DROP_MUL, stageNpcHp, stageNpcExp, stageNpcStats, AI_NAMES, NEW_PLAYER, ARENA_TITLES, GEAR_BASE, GEAR_BASE_ATTR, BLACK_GEAR_SETS, BLACK_SHARD_SET, BLACK_CARD_ID, BLACK_BOX_ID, registerBlackGear, applyPropRemarkFixes, CONVERT_SHARD_ID, CONVERT_SHARD_NAME, CONVERT_SHARD_COST, CONVERT_FRUIT_ID, CONVERT_PILLS, registerLadderShard, EXTRA_RANK_GOODS, registerRankGoods, LEVEL_GIFT_SMALL, LEVEL_GIFT_BIG, LEVEL_GIFT_RARE, levelGift, GIFT_PACK_BOOST, giftPackPrize,
    PETS, PET_SKILLS, PET_SKILL_RULES, petSkillValue, petSkillTrigger, petSkillInfo, PET_GRADE_EXP, PET_GRADE_COST,
    SET_BONUS, SET_BONUS_TIER_MUL, SET_BONUS_GLOBAL_MUL, SET_BONUS_HP_MUL, SET_BONUS_FAMILY_FLOOR,
    SET_BONUS_RAW_KEYS, SET_BONUS_ATTR_KEYS, setBonusTable, setBonusTierMul, setBonusScale, setBonusText };
})();
