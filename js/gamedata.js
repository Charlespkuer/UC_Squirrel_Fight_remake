/* ============================================================
 * gamedata.js — 复刻版游戏常量
 * 经验表来自百度百科 UC松鼠大战词条；NPC/武器/技能/装备等
 * 数值直接读自原版 GameDict.js
 * ============================================================ */
(function () {
  'use strict';

  // references/new/reference.md 的逐级经验表。51级以后缺史料，沿用每级+250的离线补足。
  const EXP_TABLE = [0, 20, 60, 140, 220, 310, 400, 490, 580, 680, 850, 1020, 1140, 1270, 1400,
    1530, 1660, 1790, 1930, 2070, 2220, 2360, 2510, 2660, 2810, 2960, 3110, 3270, 3430, 3590,
    3750, 3910, 4080, 4240, 4410, 4580, 4750, 4920, 5100, 5270, 5450, 5630, 5810, 5990, 6170,
    6350, 6530, 6720, 6900, 7090, 7280];
  function nextExp(level) {
    if (level < EXP_TABLE.length) return EXP_TABLE[level];
    return EXP_TABLE[EXP_TABLE.length - 1] + (level - EXP_TABLE.length + 1) * 250;
  }
  const WS_LEVELS = [2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 56, 62, 68];
  const ATTRIBUTE_BOOK_LEVELS = [53, 59, 65];
  function wsLimit(level) { return WS_LEVELS.filter(lv => lv <= level).length; }
  function canLearn(kind, id, level) {
    id = Number(id);
    if (kind === 'skill' && id === 13) return false;
    return level >= 50 || !(kind === 'weapon' ? [16, 17] : [23, 24]).includes(id);
  }
  function passiveBonus(id, level) {
    const lv = Math.max(1, Math.min(15, Number(level) || 1));
    return id === 1 || id === 2 ? 2 * lv : id === 3 ? 2 + lv - 1 : id === 4 ? 5 + 8 * (lv - 1) : 0;
  }
  function initialStats() {
    // 资料确定总量与生命区间，随机分配权重未留存；采用等概率分配。
    const hpPoints = 6 + Math.floor(Math.random() * 5);
    const stats = { power: 3, agility: 3, speed: 3, maxHp: hpPoints * 5 };
    for (let i = 0; i < 22 - hpPoints - 9; i++) stats[['power', 'agility', 'speed'][Math.floor(Math.random() * 3)]]++;
    return stats;
  }

  // 关卡类型（stageId 1-6 螳螂, 7-12 仙鹤, 13-18 熊猫；每类 6 星）
  const STAGE_TYPES = [
    { name: '螳螂', desc: '身手敏捷，攻击速度快，当生命过低时会有惊人的爆发力', recommend: '建议10-15级玩家挑战', anim: 'tl', sheets: ['tl', 'tl_effect'] },
    { name: '仙鹤', desc: '动作优雅，柔中带刚，前期凶猛但不擅长持久战', recommend: '建议15-20级玩家挑战', anim: 'xh', sheets: ['xh1', 'xh2', 'xh_effect1', 'xh_effect2'] },
    { name: '熊猫', desc: '憨厚可爱，擅长在对手进攻时抓住破绽进行反击', recommend: '建议20-25级玩家挑战', anim: 'xm', sheets: ['xm1', 'xm2', 'xm_effect'] },
  ];
  function stageTypeOf(stageId) { return STAGE_TYPES[Math.floor((stageId - 1) / 6)]; }
  function stageStar(stageId) { return ((stageId - 1) % 6) + 1; }

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
  /* 关卡奖励倍率：上一轮按需求翻倍过，本轮按用户要求**换回原表数值**（系数保持 1）。
   * 保留这两个常量是为了以后调平衡时只改一处。 */
  const STAGE_REWARD_MULT = 1;
  const STAGE_GOLD_MULT = 1;
  /* 关卡碎片掉落：掉率换回最初的 0.42 + 星级×0.03（★1 45% ~ ★6 60%），
   * 也就是每场期望 = 掉率 × 3.5 ≈ 1.58 ~ 2.1 片，与最早的版本一致；
   * 但数量区间仍然收窄在 2~5（均值 3.5、标准差 1.12），方差不再回到 1~6 那种。
   * 越级仍然是 tierUp 概率掉高一档颜色，蓝碎片封顶。 */
  const STAGE_FRAGMENT = Object.freeze({ base: 0.42, perStar: 0.03, min: 2, max: 5, tierUp: 0.72 });
  function stageFragmentChance(star) { return Math.min(1, STAGE_FRAGMENT.base + star * STAGE_FRAGMENT.perStar); }
  /* 常驻挑战关卡再收一道（需求：碎片期望「略微调低」）。
   * 单独一个系数而不是改 STAGE_FRAGMENT，是为了不动挑战塔的产出——
   * 塔文档写明它的碎片期望「等同于挑战模式单场」，那条一致性由 stageFragmentChance 保持。
   * 0.88 → ★1 每场 1.39 片、★6 1.85 片（原 1.58 / 2.10）。 */
  const STAGE_FRAGMENT_MUL = 0.88;
  function stageChallengeFragmentChance(star) { return Math.min(1, stageFragmentChance(star) * STAGE_FRAGMENT_MUL); }
  function stageFragmentCount(random) {
    const span = Math.max(0, STAGE_FRAGMENT.max - STAGE_FRAGMENT.min);
    return STAGE_FRAGMENT.min + Math.floor((random ? random() : Math.random()) * (span + 1));
  }
  const stageScale = (value, factor) => Math.max(1, Math.round(Number(value) * factor));

  /* ===== 关卡强度模型：按「推荐等级」标定（本轮用 tools/stage-balance.cjs 实测调过） =====
   * 推荐等级 = [10,15,20][类型] + 星级 − 1 → 螳螂 ★1-6 ↔ 10-15、仙鹤 ↔ 15-20、熊猫 ↔ 20-25。
   * 实测推荐等级下随机玩家（同等级 AI：同等成长预算 + 该等级装备/武技）的均值：
   *   三围 ≈ 1.53×等级 − 2.23　生命 ≈ 13.58×等级 − 10.44
   *   （tools/player-curve.cjs 每级 2000 采样、10~25 级最小二乘；升级改成
   *    「2 点随机 + 1 点自选（力/敏/速/生命）」后重测，见 apk-alignment D42）
   * 关卡 NPC 的三维与血量直接按这个基准算：
   *   学徒/拳师/大侠 三围 = 玩家 × 0.70/0.78/0.72（再乘类型系数，见下）
   *   学徒/拳师/大侠 血量 = 玩家 × 0.90/1.05/1.20
   * 字典里的攻击三维只用来保留「同一关三人的相对形状」（螳螂偏敏捷、熊猫偏力量），
   * 攻略血量表 STAGE_NPC_HP 成为历史参考；想回到旧模型把 STAGE_USE_LEVEL_MODEL 设成 false。
   * 类型系数是用来抵消三种战斗风格的实际强度差（仙鹤开场展翅/前期 1.3 倍、熊猫 45% 反击、
   * 螳螂双击+低血爆发），数值同样由测量得出。 */
  const STAGE_USE_LEVEL_MODEL = true;
  const STAGE_LEVEL_BAND = Object.freeze([[10, 15], [15, 20], [20, 25]]);
  const STAGE_ROLE_STAT = Object.freeze([0.70, 0.78, 0.72]);
  const STAGE_ROLE_HP = Object.freeze([0.90, 1.05, 1.20]);
  const STAGE_TYPE_SCALE = Object.freeze({ tl: 1.15, xh: 0.92, xm: 1.02 });
  const STAGE_PLAYER_CURVE = Object.freeze({ statPer: 1.53, statBase: -2.23, hpPer: 13.58, hpBase: -10.44 });
  /* ---------- 真·武器 / 真·技能（终局线） ----------
   * 等级口径沿用原表：1~10 是普通，11~15 依次是真1~真5（upgradeMap 第 10~14 行
   * 的成功率 100/8/5/4/3% 正好对上「真1~真5」）。所以真等级 = 等级 − 10。
   *
   * 真技能的效果**只有真5的端点**有史料（references/new/攻略.md），真1~真4 用
   * 线性插值取整：真N ≈ 真5 × N / 5。下表每个条目标注了来源：
   *   [史料] = 攻略写了真5端点；[平衡] = 攻略没有，本项目按同类量级定的取值。
   * 改数值只动这一张表。 */
  const TRUE_SKILL_MAX = 5;
  const TRUE_SKILL_5 = Object.freeze({
    7:  { key: 'guiJia',     value: 1.00, src: '史料' },   // 龟甲术：100% 几率可多次使用（多层防御）
    8:  { key: 'stripGear',  value: 0.56, src: '史料' },   // 色诱之术：56% 几率脱光对手装备，持续 4 回合
    9:  { key: 'crit4',      value: 0.50, src: '平衡' },   // 暴击：暴击时有 N% 几率打出 4 倍伤害
    10: { key: 'antiCrit',   value: 0.50, src: '平衡' },   // 皮糙肉厚：额外压制对手 N% 暴击率
    12: { key: 'doubleHit',  value: 1.00, src: '史料' },   // 野球拳：100% 几率再打一次
    14: { key: 'cosmos',     value: 0.30, src: '史料' },   // 小宇宙爆发：基础属性 +30%
    15: { key: 'extraFlat',  value: 18,   src: '用户提供' }, // 通灵召唤：额外 +18 点固定伤害，真级再叠加
    18: { key: 'disarm',     value: 1.00, src: '史料' },   // 吸铁大法：100% 几率缴械
    23: { key: 'luckyBase',  value: 137,  src: '史料' },   // 幸运一击：基础伤害 137×N
  });
  /* 真·武器的额外效果：数值取自原词典 weaponsMap[id].remark1
   * （西瓜刀 +5% 连击、流星锤 +3% 扔 3 次、激光剑 +3% 暴击、狼牙棒 +6 持续伤害、
   *   板砖 +3% 打晕、忍者镖 +2% 吸血、沉默之斧 +4% 沉默）。
   * 只在武器等级 > 10（真形态）时生效——原词典把这几条写在 remark1，就是真武器说明。 */
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
  /** 真N 的效果值：真5端点 × N/5（线性插值）。ratio 类返回 0~真5，flat 类按同比例。 */
  function trueSkillValue(id, level) {
    const row = TRUE_SKILL_5[Number(id)];
    if (!row) return 0;
    return row.value * trueLevel(level) / TRUE_SKILL_MAX;
  }
  function trueSkillRow(id) { return TRUE_SKILL_5[Number(id)] || null; }

  function stageTargetLevel(stageId) {
    const type = Math.max(0, Math.min(2, Math.floor((Number(stageId) - 1) / 6)));
    return STAGE_LEVEL_BAND[type][0] + stageStar(stageId) - 1;
  }
  const stagePlayerStat = (level) => STAGE_PLAYER_CURVE.statPer * level + STAGE_PLAYER_CURVE.statBase;
  const stagePlayerHp = (level) => STAGE_PLAYER_CURVE.hpPer * level + STAGE_PLAYER_CURVE.hpBase;
  function stageTypeScale(stageId) {
    const type = STAGE_TYPES[Math.max(0, Math.min(2, Math.floor((Number(stageId) - 1) / 6)))];
    return (type && STAGE_TYPE_SCALE[type.anim]) || 1;
  }
  const stageRoleIndex = (npcIndex) => Math.max(1, Math.min(3, Math.round(Number(npcIndex) || 1))) - 1;

  /* 常驻挑战关卡血量整体上调（需求 15~20%，取 +18%）：三种敌人 × 6 难度共 18 关一起抬，
   * 攻击三维不动，所以是「更耐打」而不是「更疼」。想让关卡回到上调前把这里设成 1 即可。 */
  const STAGE_HP_MUL = 1.18;
  function stageNpcHp(stageId, npcIndex) {
    const role = stageRoleIndex(npcIndex);
    if (STAGE_USE_LEVEL_MODEL) {
      return Math.max(1, Math.round(stagePlayerHp(stageTargetLevel(stageId)) * STAGE_ROLE_HP[role] * STAGE_HP_MUL));
    }
    const row = STAGE_NPC_HP[stageStar(stageId) - 1];
    return row ? stageScale(row[role] || 0, STAGE_DIFFICULTY.hp * STAGE_HP_MUL) : 0;
  }
  function stageNpcExp(stageId, npcIndex) {
    const row = STAGE_NPC_EXP[stageStar(stageId) - 1];
    return row ? stageScale(row[npcIndex - 1] || 0, STAGE_REWARD_MULT) : 0;
  }
  /** 关卡 NPC 的攻击三维。新模型按推荐等级算；旧模型按字典数值 × STAGE_DIFFICULTY 打折。 */
  function stageNpcStats(npc) {
    const raw = npc || {};
    if (STAGE_USE_LEVEL_MODEL) {
      const stageId = Number(raw.stageId) || 1;
      const role = stageRoleIndex(raw.npcIndex);
      const power = Math.max(1, Math.round(stagePlayerStat(stageTargetLevel(stageId)) * STAGE_ROLE_STAT[role] * stageTypeScale(stageId)));
      // 用字典里（含熊猫 ★4-6 修正表）的比例保留同关三人的相对形状
      const shape = (key) => { const v = Number(raw[key]), p = Number(raw.power); return v > 0 && p > 0 ? v / p : 1; };
      return { power, agility: Math.max(1, Math.round(power * shape('agility'))), speed: Math.max(1, Math.round(power * shape('speed'))) };
    }
    // 字典里熊猫 ★4-6 的攻击三维异常膨胀（大侠 40 → 47 → 109 → 213，而血量/星级是平滑增长的，
    // 明显是原数据错误），这里按 ★1-3 的增长斜率修正；血量仍走攻略表。
    const fix = STAGE_NPC_STAT_FIX[Number(raw.stageId)] && STAGE_NPC_STAT_FIX[Number(raw.stageId)][Number(raw.npcIndex) - 1];
    const base = fix || raw;
    return {
      power: stageScale(base.power, STAGE_DIFFICULTY.power),
      agility: stageScale(base.agility, STAGE_DIFFICULTY.agility),
      speed: stageScale(base.speed, STAGE_DIFFICULTY.speed),
    };
  }

  // 随机玩家名字池（怀旧风）
  const AI_NAMES = ['松鼠小弟', '无敌鼠哥', '萌萌小鼠', '狂战无双', '松果大侠', '飞天小鼠', '松鼠妹妹', '啃果群众',
    '鼠来宝', '尾巴翘翘', '松针小王子', '橡果终结者', '闪电鼠', '吃瓜小鼠', '鼠胆英雄', '森林一霸', '松果收藏家',
    '暴躁小鼠', '快乐松鼠', '鼠大王', '松涛依旧', '坚果猎人', '鼠不尽的快乐', '树梢舞者', '瓜子杀手', '鼠你最棒',
    '老松鼠', '鼠门弄斧', '松间明月', '吱吱喳喳', '鼠来运转', '大尾巴狼', '松果搬运工', '夜行小鼠', '铁尾阿泰', '竹林隐士', '雪原飞狐', '三只松鼠', '爱啃瓜子', '老松树', '闪电小尾', '橡果收藏家', '暴走仓鼠', '月下鼠影', '坚果骑士', '爱笑小鼠', '松塔守卫', '疾风鼠宝', '独眼大鼠', '甜心鼠妹', '山核桃', '冬眠冠军', '铁爪老三', '尾巴打结', '松针刺客', '一口一个', '无敌小胖', '暴躁栗子', '采果小队', '林间跃者', '白肚皮', '鼠界传奇'];
  const AI_TITLES = ['', '', '', '的师傅', ''];

  // 新手初始
  const NEW_PLAYER = {
    name: '', level: 1, exp: 0, power: 5, agility: 5, speed: 4, maxHp: 40,
    energy: 90, maxEnergy: 90, goldPoint: 100, goldCup: 0, integral: null,
    weapons: [],              // 2级首次随机获得武器或技能
    skills: [],
    gears: [], wears: {},      // gears: [{id,used,key,ext:[{id,level}]}]
    props: { 1: 3, 2: 2 },     // 小体力药剂x3 大体力药剂x2
    freePoints: 0,             // 升级发下来、还没分配的自由属性点
    wsPicks: [],               // 升级发下来、还没选的武器/技能「三选一」组
    propsStates: {},           // 药剂生效场次 {propId: count}
    stages: {},                // stageId -> {npcIndex, passed}
    dailyWins: 0, allWins: 0, dailyFails: 0, allFails: 0,
    master: null, prentices: [],
    lastEnergyTs: 0, reborn: 0, joinRankCount: 0, lotteryDate: '', lotteryFree: 1,
    woodRecord: 0, dailyClaimDate: '', battles: [], shopPurchaseDate: '', shopPurchases: {},
    tower: { maxLayer: 0, run: null },                                    // 无尽挑战塔（主塔）
    endless: { best: 0, weekBest: 0, weekKey: '', bestLayer: 0, shieldDate: '', run: null },
  };

  // 竞技场 AI 名称前缀
  const ARENA_TITLES = ['经验场', '碎片场'];

  /* 升级礼包：以前只有属性成长 + 随机武技，逢 5 级多给一份卷轴/药剂。
   * 普通等级随机给 1~2 个消耗品，每逢 5 级和属性书等级再给一份大礼包。 */
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

  /* 1 / 5 / 10 / 15 / 20 级礼包（原表 giftMap 28~32）：
   * 金松果按用户要求**回到旧版数量**（50/50/100/150/200），20 级礼包只给 30 蓝色碎片；
   * 大小体力药剂都给但数量不多（小 ×3、大 ×2）；额外加卷轴与经验丸，让奖励种类丰富一些。
   * 原表逐字节保留在 GameDict.js 里，state.js 打开礼包时优先读这份清单。 */
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

  /* 天梯碎片（本项目新增，id 51）：原版数据里 51~100 是空号。
   * 依据 references/new/微信图片_20260924010916_259_2.jpg：天梯战里会飘出带「?」的金色碎片，
   * 攒够 10 个可以随机合成一个力量/敏捷/速度转化丸；恶魔果实种子也走同一条路。
   * 图标 images/classic/icons/prop-51.png 由白色碎片改色加「?」得来（tools/make-fragment-icon.cjs）。
   * 同样只在 gamedata 里补行，GameDict.js 保持与 APK 逐字节一致。 */
  const CONVERT_SHARD_ID = 51;
  const CONVERT_SHARD_NAME = '天梯碎片';
  const CONVERT_SHARD_COST = 10;
  const CONVERT_FRUIT_ID = 46;         // 恶魔果实种子：天梯同样能掉
  const CONVERT_PILLS = [10, 11, 12];  // 力量/敏捷/速度转化丸
  function registerLadderShard() {
    const map = window.propMap;
    if (!map || typeof map.put !== 'function' || map.getValue(CONVERT_SHARD_ID)) return false;
    map.put(String(CONVERT_SHARD_ID), [String(CONVERT_SHARD_ID), CONVERT_SHARD_NAME,
      CONVERT_SHARD_COST + '个' + CONVERT_SHARD_NAME + '可以随机合成1个力量/敏捷/速度转化丸。每次合成需要50个金松果。天梯赛里点飘出来的碎片可以获得。',
      '', 'false', '2']);
    return true;
  }
  registerLadderShard();

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

  window.GData = { EXP_TABLE, nextExp, WS_LEVELS, ATTRIBUTE_BOOK_LEVELS, wsLimit, canLearn, passiveBonus, initialStats, STAGE_TYPES, stageTypeOf, stageStar, STAGE_NPC_HP, STAGE_NPC_EXP, STAGE_DIFFICULTY, STAGE_HP_MUL, STAGE_NPC_STAT_FIX, STAGE_REWARD_MULT, STAGE_GOLD_MULT,
    STAGE_USE_LEVEL_MODEL, STAGE_LEVEL_BAND, STAGE_ROLE_STAT, STAGE_ROLE_HP, STAGE_TYPE_SCALE, STAGE_PLAYER_CURVE,
    trueLevel, trueSkillValue, trueSkillRow, TRUE_SKILL_5, TRUE_SKILL_MAX, TRUE_WEAPON_BONUS, trueWeaponBonus,
    stageTargetLevel, stagePlayerStat, stagePlayerHp, stageTypeScale, STAGE_FRAGMENT, STAGE_FRAGMENT_MUL, stageFragmentChance, stageChallengeFragmentChance, stageFragmentCount, stageNpcHp, stageNpcExp, stageNpcStats, AI_NAMES, NEW_PLAYER, ARENA_TITLES, applyPropRemarkFixes, CONVERT_SHARD_ID, CONVERT_SHARD_NAME, CONVERT_SHARD_COST, CONVERT_FRUIT_ID, CONVERT_PILLS, registerLadderShard, LEVEL_GIFT_SMALL, LEVEL_GIFT_BIG, LEVEL_GIFT_RARE, levelGift, GIFT_PACK_BOOST, giftPackPrize };
})();
