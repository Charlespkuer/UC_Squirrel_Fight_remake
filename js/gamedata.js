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
    { name: '熊猫', desc: '憨厚可爱，擅长在对手进攻时抓住破绽进行反击', recommend: '建议20级以上玩家挑战', anim: 'xm', sheets: ['xm1', 'xm2', 'xm_effect'] },
  ];
  function stageTypeOf(stageId) { return STAGE_TYPES[Math.floor((stageId - 1) / 6)]; }
  function stageStar(stageId) { return ((stageId - 1) % 6) + 1; }

  // 攻略记载的关卡NPC血量与经验：同星级同位置三者一致，差异只在攻击模式。
  // 字典里熊猫4-6星的血量/属性异常膨胀（疑为原数据错误），以此表为准。
  const STAGE_NPC_HP = [[243, 292, 438], [262, 314, 471], [280, 336, 504], [335, 402, 603], [400, 479, 719], [501, 601, 901]];
  const STAGE_NPC_EXP = [[3, 4, 18], [3, 4, 19], [3, 4, 20], [3, 4, 21], [3, 4, 22], [3, 4, 23]];
  function stageNpcHp(stageId, npcIndex) { const row = STAGE_NPC_HP[stageStar(stageId) - 1]; return row ? row[npcIndex - 1] || 0 : 0; }
  function stageNpcExp(stageId, npcIndex) { const row = STAGE_NPC_EXP[stageStar(stageId) - 1]; return row ? row[npcIndex - 1] || 0 : 0; }

  // 随机玩家名字池（怀旧风）
  const AI_NAMES = ['松鼠小弟', '无敌鼠哥', '萌萌小鼠', '狂战无双', '松果大侠', '飞天小鼠', '松鼠妹妹', '啃果群众',
    '鼠来宝', '尾巴翘翘', '松针小王子', '橡果终结者', '闪电鼠', '吃瓜小鼠', '鼠胆英雄', '森林一霸', '松果收藏家',
    '暴躁小鼠', '快乐松鼠', '鼠大王', '松涛依旧', '坚果猎人', '鼠不尽的快乐', '树梢舞者', '瓜子杀手', '鼠你最棒',
    '老松鼠', '鼠门弄斧', '松间明月', '吱吱喳喳', '鼠来运转', '大尾巴狼'];
  const AI_TITLES = ['', '', '', '的师傅', ''];

  // 新手初始
  const NEW_PLAYER = {
    name: '', level: 1, exp: 0, power: 5, agility: 5, speed: 4, maxHp: 40,
    energy: 90, maxEnergy: 90, goldPoint: 100, goldCup: 0, integral: null,
    weapons: [],              // 2级首次随机获得武器或技能
    skills: [],
    gears: [], wears: {},      // gears: [{id,used,key,ext:[{id,level}]}]
    props: { 1: 3, 2: 2 },     // 小体力药剂x3 大体力药剂x2
    propsStates: {},           // 药剂生效场次 {propId: count}
    stages: {},                // stageId -> {npcIndex, passed}
    dailyWins: 0, allWins: 0, dailyFails: 0, allFails: 0,
    master: null, prentices: [],
    lastEnergyTs: 0, reborn: 0, joinRankCount: 0, lotteryDate: '', lotteryFree: 1,
    woodRecord: 0, dailyClaimDate: '', battles: [], shopPurchaseDate: '', shopPurchases: {},
  };

  // 竞技场 AI 名称前缀
  const ARENA_TITLES = ['经验场', '碎片场'];

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

  window.GData = { EXP_TABLE, nextExp, WS_LEVELS, ATTRIBUTE_BOOK_LEVELS, wsLimit, canLearn, passiveBonus, initialStats, STAGE_TYPES, stageTypeOf, stageStar, STAGE_NPC_HP, STAGE_NPC_EXP, stageNpcHp, stageNpcExp, AI_NAMES, NEW_PLAYER, ARENA_TITLES, applyPropRemarkFixes };
})();
