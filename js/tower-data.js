/* ============================================================
 * tower-data.js — 无尽挑战塔 · 数值与池子定义（纯数据）
 * 依据 docs/无尽挑战塔系统设计文档.md v2.0。
 * 公式与 gamedata.js 的关卡强度模型（STAGE_PLAYER_CURVE）对齐：
 *   主塔目标等级 LT(n) = min(70, round(28 + 1.4(n−1)))
 *   主塔强度系数 M(n)  = (1+0.03⌊(m−1)/5⌋)(1+0.04⌊(m−1)/10⌋), m=min(n,30)（tower-tune v6 实测值）
 *   主塔单层松果 G(n)  = 15/20/28/38 分段；21 层起 38+3(n−20)，封顶 68
 *   无尽段系数   B(s)  = min(10, 1.5^(s−1)), s=⌈n/5⌉
 *   抽奖卷       T(s)  = 2^(s−1)（s≤4）；8+3(s−4)（s≥5）——20 层后线性
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 主塔公式 ----------
  function towerLevel(n) { return Math.min(70, Math.round(28 + 1.4 * (n - 1))); }
  function towerMult(n) {
    const m = Math.min(Math.max(1, n), 30);
    // 实测调参（tools/tower-tune.cjs v6）：斜率放缓到 +3%/5层、+4%/10层，封顶 1.35→1.242
    return (1 + 0.03 * Math.floor((m - 1) / 5)) * (1 + 0.04 * Math.floor((m - 1) / 10));
  }
  function towerGold(n) {
    n = Math.max(1, n);
    /* 低层门槛上调：原来 1~10 层只发 15/20，比常驻挑战通关（3 场 = 25 金松果）还低，
     * 打完一整套连战反而亏。现在最低 25，与常驻挑战通关看齐，再往上按层数递增。 */
    if (n <= 5) return 25;
    if (n <= 10) return 30;
    if (n <= 15) return 38;
    if (n <= 20) return 48;
    return Math.min(88, 48 + 3 * (n - 20));
  }
  /** 层内逐场累积：前 battles-1 场各 floor(G/battles)，尾场补余数。 */
  function towerGoldShares(n, battles) {
    const g = towerGold(n), base = Math.floor(g / battles);
    return Array.from({ length: battles }, (_, i) => i === battles - 1 ? g - base * (battles - 1) : base);
  }
  const TOWER_FAIL_CONSOLATION = 0.3;   // 失败安慰奖：本局已累积的 30%（向下取整）

  // ---------- 无尽公式 ----------
  function endlessLevel(n) { return Math.min(70, Math.round(24 + 1.2 * (n - 1))); }
  const endlessSegment = (n) => Math.max(1, Math.ceil(n / 5));
  function endlessMult(n) { return Math.min(10, Math.pow(1.5, endlessSegment(n) - 1)); }
  function endlessMechStacks(n) { return Math.min(ENDLESS_MECH_MAX, endlessSegment(n) - 1); }
  /** 本层怪物带的机制（按段轮转取前 N 个）。 */
  function endlessMechs(n) {
    const seg = endlessSegment(n), count = endlessMechStacks(n);
    if (!count) return [];
    const off = (seg - 2 + ENDLESS_MECH_ORDER.length * 2) % ENDLESS_MECH_ORDER.length;
    const out = [];
    for (let i = 0; i < count; i++) out.push(ENDLESS_MECH_ORDER[(off + i) % ENDLESS_MECH_ORDER.length]);
    return out;
  }
  function endlessTickets(n) {
    const s = endlessSegment(n);
    return s <= 4 ? Math.pow(2, s - 1) : 8 + 3 * (s - 4);
  }
  /* 段间怪物机制叠加顺序（固定顺序，方便玩家预判）。
   * 第 1 项修正：原来 `slice(0, 段数-1)` 只增不减，于是从第 2 段（6 层）起
   * **每一场都带反伤**、再往下每段再加一个、永远不摘 —— 玩家读起来就是「打完一个反伤 boss
   * 之后所有战斗都在反伤」。现在改成「同屏最多 3 个 + 按段轮转」：
   * 段数越多带的机制越多（最多 3），但顺序整体轮转，所以反伤会来、也会走。 */
  const ENDLESS_MECH_ORDER = ['thorns', 'regen', 'lifesteal', 'shell', 'devour'];
  const ENDLESS_MECH_MAX = 3;
  /* 环境词缀：不常驻、按战斗随机触发，同时最多 2 条、持续 3~6 场（第 5 层起可能触发，15 层起固定两条）。 */
  const ENDLESS_ENV = Object.freeze([
    { id: 'sun', name: '烈日灼烧', bad: true, desc: '敌方暴击率 +25%' },
    { id: 'frost', name: '寒霜锁链', bad: true, desc: '我方速度 −15%' },
    { id: 'greed', name: '贪婪裂隙', bad: true, desc: '我方试炼币 +50%，但敌方生命上限 +15%' },
    { id: 'dusk', name: '血色黄昏', bad: false, desc: '双方吸血 +15%' },
  ]);
  const ENDLESS_ENV_BY_ID = Object.freeze(ENDLESS_ENV.reduce((m, e) => (m[e.id] = e, m), {}));
  const ENV_START_LAYER = 5, ENV_TWO_LAYER = 15, ENV_MAX = 2, ENV_DUR = [3, 6];
  /** 战斗后触发概率：5 层 ~20%，之后每层 +6%，40 层封顶 80%。 */
  function envChance(layer) {
    if (layer < ENV_START_LAYER) return 0;
    return Math.min(0.80, 0.14 + (layer - ENV_START_LAYER + 1) * 0.06);
  }
  const ENDLESS_CONSOLATION_LAYER = 15;  // 到达 15 层后失败送 1 次免费抽奖（每日限 1 次）

  // ---------- 计分 ----------
  const SCORE = Object.freeze({ battle: 25, layer: 100, elite: 50 });

  // ---------- 试炼币与商店（无尽局内经济，跨局不继承） ----------
  const COINS = Object.freeze({ battle: 8, layer: 20, elite: 15 });
  const SHOP = Object.freeze({
    slots: 5,
    price: [30, 60, 100],          // 普通/稀有/史诗
    crossLayerMul: 1.3,            // 跨层类 ×1.3 → 40/80/130
    sellBack: 0.4,                 // 回收 40%
    healPct: 0.4, healPrice: 35,   // 治疗泉水：回复 40% 最大生命
    rerollPrice: 15,               // 首次免费
  });
  function shopPrice(buff) {
    const p = SHOP.price[buff.rarity];
    return buff.scope === 'run' ? Math.round(p * SHOP.crossLayerMul / 10) * 10 : p;
  }

  // ---------- 敌方数值系数（v2.2：高血低攻） ----------
  /* 和玩家 build 拉开差异：玩家堆的是爆发/秒杀，敌方改成「血厚、打人不疼」的墙。
   * 总承伤大致不变（血量 ×1.25、力量 ×0.79），但每场更长、更吃续航而不是拼手速；
   * 也贴合「每层 4 场连战只继承血量、不自动回血」的压力设计。
   * 只压力量，不动敏捷/速度——后两者影响闪避与出手次数，属于手感维度，保持原样。 */
  const FOE_STAT_MUL = 0.66;    // 敏捷/速度基准（原值）
  /* 力量基准：0.66 × 0.79 ≈ 0.52，攻击更软。
   * v2.2 追加：出手改成「优先用本场没用过的武器/技能」之后玩家整体输出下降
   * （且绝对防御 30%→22%），主塔整层通关率掉到 10 层 12%（验收线 15%），
   * 所以再压到 0.47 做补偿——仍然远低于敏捷/速度，保持「血厚打人不疼」的定位。 */
  const FOE_POWER_MUL = 0.47;
  const FOE_HP_MUL = 1.06;      // 血量基准：0.85 × 1.25，血量更厚
  /* ---------- 血量：先算三侠，boss 只在三侠基础上乘一个小倍率 ----------
   * 第 2 项要求「最后一战的血量仅仅略高于前三场，不要大幅提升或衰减」，所以
   * boss 的血量不再是独立一套系数，而是**直接由三侠那套血量推出来**：
   *   heroHp  = hpBase × FOE_HP_MUL × FOE_HERO_HP_MUL × M × bias.hp      （三侠，bias.hp = 1）
   *   bossHp  = heroHp × bossHpRatio(bias.hp, layer)                     （1.04 ~ 1.22 倍）
   * 倍率里保留一点点 boss 之间的差别（苔龟/蚀骨/铁壁偏厚，熔核/霜缚偏薄）与层数缓升，
   * 但被夹在 1.04~1.22 之间 —— 血条看上去只比前三场厚一点点，既不会暴涨也不会反而更薄。 */
  const FOE_HERO_HP_MUL = 0.85;
  const BOSS_HP_MIN = 1.04;
  const BOSS_HP_MAX = 1.22;
  const WARLORD_HP_RATIO = 1.20;   // x10 第 5 场：同样是「略高于前三场」，取倍率带上沿
  function bossHpRatio(biasHp, layer) {
    const hp = Math.max(0.82, Math.min(1.28, Number(biasHp) || 1));
    const tank = (hp - 1) * 0.35;                                  // 模板偏厚/偏薄 → ±0.1
    const depth = Math.min(0.06, 0.03 + 0.004 * Math.max(1, Number(layer) || 1));  // 层数缓升，20 层封顶
    return Math.max(BOSS_HP_MIN, Math.min(BOSS_HP_MAX, 1.06 + tank + depth));
  }
  /* 三侠的「输出」压一档：三侠的攻击基准是 STAGE_TYPE_SCALE（螳螂 1.15／仙鹤 0.92／熊猫 1.02）
   * × FOE_POWER_MUL，本来就比 boss 高；现在血量和 boss 差不多，输出必须压下来，
   * 否则前三场又变成「把人打残的血墙」。boss 的输出高一大档（FOE_TRIAL_POWER_MUL），
   * 所以「最后一战最难」靠的是伤害与机制，不是血量堆。 */
  const FOE_HERO_POWER_MUL = 0.60;
  /* boss 的输出：血量只比三侠厚一点点（见 bossHpRatio），所以「最后一战最难」全靠伤害与机制 ——
   * 0.47 × 1.45 ≈ 0.68，约是三侠（0.47 × 0.60 × 0.92~1.15 ≈ 0.26~0.32）的 2~2.6 倍。 */
  const FOE_TRIAL_POWER_MUL = 1.45;
  /* x10 第 5 场的狂战松鼠：血量走 WARLORD_HP_RATIO，力量再压一点点（它还吃精英 ×1.2 的伤害）。 */
  const FOE_WARLORD_POWER_MUL = 0.85;

  // ---------- NPC 池（10 个，8 类机制） ----------
  // bias: 力/敏/速/血 四元乘数；anim 复用现有动画表（tl 螳螂 / xh 仙鹤 / xm 熊猫）。
  const NPCS = Object.freeze([
    { id: 'berserker', name: '狂战士·烈牙', mech: 'berserk', type: '高爆发型', anim: 'xm', bias: { power: 1.15, agility: 0.95, speed: 1.00, hp: 1.00 },
      mechDesc: '血性狂暴：生命首次低于 50% 时攻击力翻倍，直至战斗结束' },
    { id: 'assassin', name: '影刹·瞬', mech: 'rhythmCrit', type: '高爆发型', anim: 'tl', bias: { power: 1.00, agility: 1.10, speed: 1.15, hp: 0.90 },
      mechDesc: '瞬杀节奏：每第 4 次行动必定暴击，且该次暴击伤害 +50%' },
    { id: 'medic', name: '药师·百草', mech: 'regen', type: '回复型', anim: 'xh', bias: { power: 0.95, agility: 1.00, speed: 0.95, hp: 1.10 },
      mechDesc: '百草回春：每回合开始时回复 3% 最大生命' },
    { id: 'ironwall', name: '铁甲·岩盾', mech: 'thorns', type: '反击型', anim: 'xm', bias: { power: 1.00, agility: 0.90, speed: 0.90, hp: 1.25 },
      mechDesc: '荆棘铁壁：受到的任何伤害反弹 15% 给攻击者（真实伤害）' },
    { id: 'bramble', name: '荆棘·蔓萝', mech: 'poison', type: '反击型', anim: 'xh', bias: { power: 0.95, agility: 1.00, speed: 0.95, hp: 1.15 },
      mechDesc: '毒藤缠绕：受击 30% 概率使攻击者中毒，每回合损失 3% 当前生命，持续 3 回合' },
    { id: 'frostmage', name: '冰法师·寒晶', mech: 'freeze', type: '控制型', anim: 'xh', bias: { power: 0.90, agility: 1.00, speed: 1.10, hp: 0.95 },
      mechDesc: '寒冰禁锢：其每第 3 次行动前冻结玩家 1 回合' },
    { id: 'tamer', name: '驯兽师·铃音', mech: 'wolf', type: '召唤型', anim: 'tl', bias: { power: 0.90, agility: 0.95, speed: 1.00, hp: 1.05 },
      mechDesc: '唤狼协战：每 2 回合召唤小狼突袭，造成 0.5×力量的必中伤害（不占行动）' },
    { id: 'vampire', name: '吸血鬼·赤瞳', mech: 'lifesteal', type: '吸血型', anim: 'tl', bias: { power: 1.05, agility: 1.00, speed: 1.00, hp: 1.05 },
      mechDesc: '血之渴望：造成伤害的 30% 回复自身生命' },
    { id: 'golem', name: '石像鬼·磐岩', mech: 'shell', type: '护盾型', anim: 'xm', bias: { power: 1.00, agility: 0.85, speed: 0.85, hp: 1.20 },
      mechDesc: '磐岩之壳：开局获得 30% 最大生命的护盾，护盾先于血量消耗' },
    { id: 'devourer', name: '吞噬者·无底', mech: 'devour', type: '成长型', anim: 'xm', bias: { power: 1.00, agility: 1.00, speed: 1.00, hp: 1.10 },
      mechDesc: '无尽吞噬：每回合结束时攻击力永久 +2%（本场内可无限叠加）' },
  ]);
  const NPC_BY_ID = Object.fromEntries(NPCS.map((n) => [n.id, n]));

  // ---------- 三侠的「贯穿本层」削弱 ----------
  /* 前三场打的是三侠。他们的招牌技一旦真的放出来，就会给玩家留下一层
   * **打到本层结束**都一直在的削弱；进第 4 场前选 buff 时必须把这些削弱算进去。
   * 反过来说：打得够快、不让大招放出来，就可以完全规避 —— 这是本层的第一层对策。
   * 对应大招名见 sim.js 的 npcUlt（疾风镰刀舞 / 仙鹤展翅 / 熊掌震地）。 */
  const HERO_DEBUFF = Object.freeze({
    tl: { anim: 'tl', ult: '疾风镰刀舞', kind: 'maxHp', pct: 0.08,
      name: '重伤', desc: '生命上限 −8%' },
    xh: { anim: 'xh', ult: '仙鹤展翅', kind: 'stat', pct: 0.08,
      name: '战吼', desc: '随机一项属性 −8%（力/敏/速）' },
    xm: { anim: 'xm', ult: '熊掌震地', kind: 'lock',
      name: '压制', desc: '随机锁住一个武器或技能（本层无法使用）' },
  });

  // ---------- 松鼠形态的固定装备（视觉记忆） ----------
  /* 每个松鼠形态的 boss 都穿一套**固定且互不相同**的装备：玩家不用读文字，
   * 看到「犀牛头 + 犀牛服」就知道是苔龟、看到「诅咒套」就知道是蚀骨或枯泉。
   * 装备 id 取自 GameDict 的 gearMap（套装 4 件：头 / 手 / 身 / 脚），
   * engine.js 的 wearsFor() 会按「套装的 sprite index + 装备等级」换算成贴图，
   * 所以这里只要给对 id，战斗中就会真的画出来（tower.js 把 wears 传给 foe）。
   * 注意避开三侠同款的螳螂 / 仙鹤 / 熊猫头饰（index 9/10/11），免得和三侠混淆。 */
  const GEAR = Object.freeze({
    hero: [93, 94, 95, 96],        // 勇者套装（sprite index 17）
    rhino: [85, 86, 87, 88],       // 犀牛套装（15）
    curse: [97, 98, 99, 100],      // 诅咒套装（18）
    ninja3: [57, 58, 59, 60],      // 忍者套装·史诗（21）
    fist3: [53, 54, 55, 56],       // 拳斗套装·史诗（20）
    shogun: [89, 90, 91, 92],      // 幕府套装（16）
    curse3: [121, 122, 123, 124],  // 诅咒套装·史诗（31）
    ninja1: [17, 18, 19, 20],      // 忍者套装·普通（5）
    knight: [77, 78, 79, 80],      // 骑士套装（13）
    grappler3: [49, 50, 51, 52],   // 格斗套装·史诗（19）
    berserk: [201, 202, 203, 204], // 狂战套装（32，x10 专属）
  });
  /** 装备 id 列表 → engine.wearsFor 认识的 wears（等级 1 = 该套装的初始外观）。 */
  function wearsOf(key) { return (GEAR[key] || []).map((id) => ({ id })); }
  /* ---------- 第 C 项：套装分层 & 随层升级 ----------
   * tier 0 = 最低级（普通，<蓝装）；1 = 绿/蓝前；2 = 蓝；3 = 紫；4 = 狂战（仅 10 的倍数层）
   * 无尽塔越往上爬，松鼠敌人穿的装备越好；1~3 层只会出现 <蓝装。 */
  const GEAR_TIER = Object.freeze({ ninja1: 0, knight: 1, rhino: 1, curse: 1,
    shogun: 2, hero: 2, ninja3: 3, fist3: 3, grappler3: 3, curse3: 3, berserk: 4 });
  const GEAR_KEYS = Object.freeze(Object.keys(GEAR_TIER));
  /** 某层允许出现的套装档位上限（越深越好）。 */
  function gearTierCap(layer) {
    if (layer <= 3) return 1;      // 1~3 层：最低级 / 次一级（都 < 蓝装）
    if (layer <= 9) return 2;      // 4~9 层：开始出现蓝装
    if (layer <= 19) return 3;     // 10~19 层：蓝紫混搭
    return 3;                      // 20+ 层：以紫装为主（狂战仍然只给 10 的倍数层）
  }
  /** 按层决定实际穿戴的套装：10 的倍数层固定狂战，其它层永不出现狂战。 */
  function gearKeyForLayer(layer, baseKey) {
    if (layer % 10 === 0) return 'berserk';
    const cap = gearTierCap(layer);
    const baseTier = GEAR_TIER[baseKey];
    if (baseKey && baseTier != null && baseTier !== 4 && baseTier <= cap) return baseKey;
    const pool = GEAR_KEYS.filter((k) => GEAR_TIER[k] !== 4 && GEAR_TIER[k] <= cap);
    if (!pool.length) return baseKey || 'ninja1';
    const h = poolHash('gear#' + Math.max(1, layer));
    return pool[h % pool.length];
  }


  // ---------- 松鼠对手（随机 boss 池成员之一） ----------
  /* 和小松鼠同族：战斗里用玩家那套松鼠贴图（镜像朝左，tower.js 不给 npcType 即自动生效），
   * 武器与技能都取自松鼠本来的池子（GameDict 的 weaponsMap / skillsMap）。
   *
   * 出招是**固定循环**，不是随机 roll —— 玩家可以背板、可以针对配装：
   *   pattern 的每一项 = 一次行动的意图：'common' 普攻 / 'weapon' 用武器 / 'skill' 放技能；
   *   某一项这回合用不了（被缴械 / 沉默 / 没主动技能）就顺延到下一个能用的。
   * 每个模板只带 1 个主动技能，所以「放技能」这一步也是确定的。
   *
   * 这三只是「平庸款」：没有专属机制，靠数值与出招循环提供基础的随机 boss 体验，
   * 和 7 个带机制的 boss（TRIALS）、10 个机制 NPC 一起洗进 BOSS_POOL。
   * 想加/改模板只动这张表就行。 */
  const SQUIRRELS = Object.freeze([
    { id: 'scout', name: '斥候松鼠', type: '敏捷型', region: 3, gear: 'ninja1',
      bias: { power: 0.95, agility: 1.10, speed: 1.15, hp: 1.00 },
      weapons: [{ id: 8, level: 6 }], skills: [{ id: 2, level: 7 }, { id: 23, level: 7 }],
      pattern: ['common', 'weapon', 'common', 'skill'],
      patternDesc: '固定循环：普攻 → 菜刀 → 普攻 → 幸运一击',
      mechDesc: '出手最快、闪避最高，但血量与力量都偏低' },
    { id: 'guard', name: '铁壁松鼠', type: '防御型', region: 2, gear: 'knight',
      bias: { power: 0.92, agility: 0.90, speed: 0.90, hp: 1.28 },
      weapons: [{ id: 2, level: 6 }], skills: [{ id: 4, level: 7 }, { id: 10, level: 7 }],
      pattern: ['weapon', 'common', 'weapon', 'common'],
      patternDesc: '固定循环：大榔头 → 普攻（血最厚、出手最慢）',
      mechDesc: '血最厚、出手最慢，靠大榔头一下一下磨' },
    { id: 'frenzy', name: '狂暴松鼠', type: '爆发型', region: 1, gear: 'grappler3',
      bias: { power: 1.10, agility: 0.95, speed: 1.00, hp: 1.10 },
      weapons: [{ id: 12, level: 6 }], skills: [{ id: 5, level: 7 }, { id: 14, level: 7 }],
      pattern: ['common', 'weapon', 'skill', 'weapon'],
      patternDesc: '固定循环：普攻 → 狼牙棒 → 小宇宙爆发 → 狼牙棒',
      mechDesc: '攻击最高，会用「小宇宙爆发」自我强化，血量偏低' },
    /* 第 C 项新增：与既有松鼠有明确差分的六只（各自武器/技能树 + 专属套装） */
    { id: 'thrower', name: '投掷宗师·银镖', type: '投掷型', region: 4, gear: 'shogun',
      bias: { power: 1.00, agility: 1.05, speed: 1.05, hp: 1.05 },
      weapons: [{ id: 12, level: 10 }, { id: 14, level: 10 }],
      skills: [{ id: 3, level: 9 }, { id: 11, level: 9 }, { id: 22, level: 8 }],
      pattern: ['weapon', 'weapon', 'skill', 'common'],
      patternDesc: '固定循环：飞镖 → 飞镖 → 天女散花 → 普攻',
      mechDesc: '专精全部投掷类武器：远程压制，命中后持续流血' },
    { id: 'heavy', name: '巨力战槌·磐岩', type: '重击型', region: 4, gear: 'rhino',
      bias: { power: 1.30, agility: 0.82, speed: 0.78, hp: 1.22 },
      weapons: [{ id: 5, level: 12 }], skills: [{ id: 6, level: 8 }, { id: 13, level: 9 }],
      pattern: ['weapon', 'common', 'weapon', 'skill'],
      patternDesc: '固定循环：大槌 → 普攻 → 大槌 → 震地',
      mechDesc: '只用势大力沉的武器：出手慢但一击破盾，被击中会掉护甲' },
    { id: 'monk', name: '无械苦修·空明', type: '苦修型', region: 4, gear: 'curse3',
      bias: { power: 0.90, agility: 1.35, speed: 1.25, hp: 1.10 },
      weapons: [], skills: [{ id: 2, level: 12 }, { id: 7, level: 12 }, { id: 16, level: 12 }, { id: 23, level: 12 }],
      pattern: ['skill', 'skill', 'common', 'skill'],
      patternDesc: '固定循环：技能 → 技能 → 普攻 → 技能',
      mechDesc: '不带任何武器、全技能树：技能触发极频繁，闪避最高' },
    { id: 'twinblade', name: '双匕游侠·夜刃', type: '连击型', region: 4, gear: 'ninja3',
      bias: { power: 1.05, agility: 1.20, speed: 1.30, hp: 0.95 },
      weapons: [{ id: 9, level: 11 }], skills: [{ id: 9, level: 11 }, { id: 10, level: 11 }],
      pattern: ['weapon', 'weapon', 'weapon', 'skill'],
      patternDesc: '固定循环：匕首 ×3 → 影袭',
      mechDesc: '高速三连击，暴击叠层，血量偏低' },
    { id: 'bulwark', name: '铁盾守卫·铜墙', type: '守御型', region: 4, gear: 'knight',
      bias: { power: 0.92, agility: 0.85, speed: 0.85, hp: 1.40 },
      weapons: [{ id: 2, level: 11 }], skills: [{ id: 4, level: 11 }, { id: 16, level: 10 }],
      pattern: ['weapon', 'common', 'weapon', 'common'],
      patternDesc: '固定循环：盾击 → 普攻 → 盾击 → 普攻',
      mechDesc: '极高护盾与反伤，输出低但很难打死' },
    { id: 'elemental', name: '元素术鼠·霜火', type: '法系型', region: 4, gear: 'fist3',
      bias: { power: 1.10, agility: 1.00, speed: 1.00, hp: 1.00 },
      weapons: [{ id: 20, level: 11 }], skills: [{ id: 5, level: 12 }, { id: 17, level: 12 }, { id: 20, level: 12 }],
      pattern: ['skill', 'common', 'skill', 'skill'],
      patternDesc: '固定循环：冰霜 → 普攻 → 烈焰 → 雷击',
      mechDesc: '交替元素 DOT，抵抗吸血，越拖越痛' },
  ]);
  const SQUIRREL_BY_ID = Object.fromEntries(SQUIRRELS.map((n) => [n.id, n]));
  /** 第 4 场固定轮换：(n−1) mod 3 → 松鼠模板。 */
  function squirrelFor(layer) { return SQUIRRELS[(Math.max(1, layer) - 1) % SQUIRRELS.length]; }

  // ---------- 带机制的松鼠 boss（随机 boss 池的核心 7 个） ----------
  /* 设计约束（见 docs/挑战塔重构建议.md §3.2）：
   *   1. 可预告：mechDesc 要写清「第几次行动」「百分比」，进层前 / 选 buff 时就能读到；
   *   2. 改变节奏而不是加血：每个 boss 都有自己的「爆发窗口 / 该苟的窗口」；
   *   3. 机制文本按**普通 boss 简介**的口径写，不写「对策建议」（那是给策划看的，见文档）。
   * 数值上复用松鼠的系数与武技池（同族贴图、固定出招循环 → 可背板），
   * bias 随机制调整：血厚的（苔龟/镜鳞/蚀骨）攻击更低，反之亦然。
   * 机制实现全部在 sim.js（trial* 前缀），这里只写数据。 */
  /* 镜鳞的两个数值单独提出来：简介文本、sim 判定、以及调平衡都要用同一个数。
   * 阈值是实测定标出来的：玩家单次伤害大多落在敌人 10%~25% 生命区间（爆发招 30%+），
   * 阈值定 8% 时几乎每一下都反弹，玩家等于自杀（实测第 5 层整层通关率 29%）；
   * 逐步调到 15%/60% → 20%/50% → 20%/45% → 20%/40%：最后两步是为了
   * 「第 5 场队首 55%」与墙区 8% 两条验收线（镜鳞在随机池里是最硬的那个）。
   * 现在只有暴击·爆发越线，普攻安全。 */
  const MIRROR_THRESHOLD = 0.20;
  const MIRROR_REFLECT = 0.40;   // 反弹该次伤害的 40%
    const TRIALS = Object.freeze([
    { id: 'core', name: '熔核·炽壳', type: '爆发窗口型', region: 1, gear: 'hero',
      bias: { power: 1.00, agility: 0.90, speed: 0.90, hp: 0.82 },
      weapons: [{ id: 2, level: 6 }], skills: [{ id: 10, level: 7 }, { id: 4, level: 7 }],
      pattern: ['common', 'weapon', 'common', 'weapon'],
      patternDesc: '固定循环：普攻 → 大榔头（出手慢，前 4 回合是唯一的输出窗口）',
      mech: ['trialCore'],
      mechDesc: '第 5 次行动起进入熔核成型：受到伤害 −80%，力/敏/速 +50%' },
    { id: 'moss', name: '苔龟·磐甲', type: '回复型', region: 2, gear: 'rhino',
      bias: { power: 0.88, agility: 0.85, speed: 0.85, hp: 1.10 },
      weapons: [{ id: 2, level: 6 }], skills: [{ id: 7, level: 7 }, { id: 10, level: 7 }],
      pattern: ['weapon', 'common', 'common', 'weapon'],
      patternDesc: '固定循环：大榔头 → 普攻（血最厚、出手最慢）',
      mech: ['trialMoss', 'thorns'],
      mechDesc: '每回合回复 6% 最大生命；受到的任何伤害反弹 15% 给攻击者' },
    { id: 'dry', name: '枯泉·涸井', type: '压制型', region: 3, gear: 'curse',
      bias: { power: 0.95, agility: 1.00, speed: 0.95, hp: 1.06 },
      weapons: [{ id: 8, level: 6 }], skills: [{ id: 8, level: 7 }, { id: 15, level: 7 }],
      pattern: ['weapon', 'skill', 'common', 'common'],
      patternDesc: '固定循环：菜刀 → 色诱之术 → 普攻',
      mech: ['trialDry'],
      mechDesc: '封死对手的一切治疗；每 3 次行动吸取对手当前生命的 10%' },
    { id: 'frost', name: '霜缚·凝霜', type: '控制型', region: 4, gear: 'ninja3',
      bias: { power: 0.92, agility: 1.10, speed: 1.12, hp: 0.85 },
      weapons: [{ id: 8, level: 6 }], skills: [{ id: 23, level: 7 }, { id: 12, level: 7 }],
      pattern: ['weapon', 'common', 'skill', 'weapon'],
      patternDesc: '固定循环：菜刀 → 普攻 → 幸运一击',
      mech: ['trialFrost'],
      mechDesc: '第 1/4/7… 次行动前把对手冻结一回合（出手越快被冻得越多）' },
    { id: 'mirror', name: '镜鳞·折光', type: '反击型', region: 2, gear: 'fist3',
      bias: { power: 0.90, agility: 1.00, speed: 1.00, hp: 1.02 },
      weapons: [{ id: 2, level: 6 }], skills: [{ id: 7, level: 7 }, { id: 16, level: 7 }],
      pattern: ['common', 'weapon', 'weapon', 'common'],
      patternDesc: '固定循环：普攻 → 大榔头',
      mech: ['trialMirror'],
      mechParams: { trialMirror: { threshold: MIRROR_THRESHOLD, reflect: MIRROR_REFLECT } },
      mechDesc: '单次伤害达到它 ' + Math.round(MIRROR_THRESHOLD * 100) + '% 最大生命时，反弹该次伤害的 ' +
        Math.round(MIRROR_REFLECT * 100) + '%' },
    { id: 'bloodfang', name: '血牙·狂噬', type: '成长型', region: 1, gear: 'shogun',
      bias: { power: 1.08, agility: 1.00, speed: 1.05, hp: 0.94 },
      weapons: [{ id: 12, level: 6 }], skills: [{ id: 14, level: 7 }, { id: 5, level: 7 }],
      pattern: ['weapon', 'skill', 'weapon', 'common'],
      patternDesc: '固定循环：狼牙棒 → 小宇宙爆发 → 狼牙棒',
      mech: ['trialBloodfang'],
      mechDesc: '每损失 20% 生命，攻击力 +35%（越拖越猛）' },
    { id: 'erode', name: '蚀骨·腐毒', type: '消耗型', region: 3, gear: 'curse3',
      bias: { power: 0.86, agility: 0.95, speed: 0.95, hp: 1.28 },
      weapons: [{ id: 8, level: 6 }], skills: [{ id: 10, level: 7 }, { id: 8, level: 7 }],
      pattern: ['common', 'weapon', 'common', 'skill'],
      patternDesc: '固定循环：普攻 → 菜刀 → 普攻 → 色诱之术',
      mech: ['trialErode'],
      mechDesc: '对手每次出手叠 1 层「攻击 −3%」，最多 10 层（本场有效）' },
  ]);
  const TRIAL_BY_ID = Object.fromEntries(TRIALS.map((n) => [n.id, n]));
  /** 兼容别名：老的「按层固定轮换第 4 场题面」调用点（部分工具还在用）。 */
  function trialFor(layer) { return TRIALS[(Math.max(1, layer) - 1) % TRIALS.length]; }

  // ---------- x10 层最后一场：固定狂战松鼠 ----------
  /* 每 10 层的最后一个 boss 固定刷这一个：松鼠形态 + 全身狂战套 + 血性狂暴 + 精英 ×1.2。
   * 「狂战套」是玩家在天梯商店追求的那一套（GameDict set 51 / gear 201~204），
   * 让它穿在身上出现在塔顶，玩家一眼就知道「这是 10 层的大家伙」。 */
  const WARLORD = Object.freeze({
    id: 'warlord', name: '狂战松鼠·无双', type: '首领', region: 1, gear: 'berserk',
    bias: { power: 1.15, agility: 1.02, speed: 1.06, hp: 1.08 },
    weapons: [{ id: 12, level: 8 }], skills: [{ id: 14, level: 8 }, { id: 5, level: 8 }, { id: 10, level: 8 }],
    pattern: ['weapon', 'skill', 'weapon', 'common'],
    patternDesc: '固定循环：狼牙棒 → 小宇宙爆发 → 狼牙棒 → 普攻',
    mech: ['berserk'],
    mechDesc: '精英：生命首次低于 50% 时攻击力翻倍；一身狂战套，力量/敏捷/生命/速度全面强化' },
  );

  // ---------- 随机 boss 池（每层第 4 场） ----------
  /* 7 个带机制的松鼠 boss + 3 只平庸松鼠 + 10 个机制 NPC = 20 个候选，
   * 每层按 (日期 + 层数) 哈希抽一个。这样做的好处：
   *   · 同一层当天固定 → 进层前能预习、失败重试还是同一个 boss（配合「换 buff 再战」）；
   *   · 换一天 / 换一层就是新的组合 → 有重玩价值，也不会永远只见到那 7 个。
   * x10 层第 5 场不走这个池子，固定 WARLORD。 */
  /* 无尽塔第 4/5 场只要松鼠形态：NPC 机制怪只留在挑战塔。 */
  const ENDLESS_BOSS_POOL = Object.freeze([
    ...TRIALS.map((t) => ({ kind: 'trial', id: t.id })),
    ...SQUIRRELS.map((s) => ({ kind: 'squirrel', id: s.id })),
  ]);
  const BOSS_POOL = Object.freeze([
    ...TRIALS.map((t) => ({ kind: 'trial', id: t.id })),
    ...SQUIRRELS.map((s) => ({ kind: 'squirrel', id: s.id })),
    ...NPCS.map((n) => ({ kind: 'npc', id: n.id })),
  ]);
  /** FNV-1a：把「日期#层数」这种小字符串摊成一个稳定的下标。 */
  function poolHash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  /* 第 1 项：随机只跟**层数**有关，不再跟日期有关 ——
   * 同一层永远是同一个 boss / 同一套三侠顺序（今天打过、明天还是它），
   * 换层才换组合。预告 = 实战、重试不变。salt 只留给工具做「换一条池子」的抽样。 */
  function bossFor(layer, salt, squirrelsOnly) {
    const pool = squirrelsOnly ? ENDLESS_BOSS_POOL : BOSS_POOL;
    const pick = pool[poolHash(String(salt == null ? '' : salt) + '#' + Math.max(1, layer)) % pool.length];
    return { kind: pick.kind, id: pick.id };
  }
  /* 三侠的出场顺序也按层数随机（同样与日期无关）：同层的顺序固定，
   * 预告里看到的顺序就是实战顺序，失败重试还是这一套。
   * 自己带一支小 PRNG，不动全局 Math.random。 */
  function heroOrder(layer, salt) {
    const out = ['tl', 'xh', 'xm'];
    let s = poolHash(String(salt == null ? '' : salt) + '@heroes#' + Math.max(1, layer)) || 1;
    const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }
  // ---------- Buff 池 ----------
  // rarity: 0 普通 / 1 稀有 / 2 史诗；scope: battle 单场 / layer 本层 / run 跨层（仅无尽）。
  // mods 由 tower.js 解释（数值均为加池百分比或比例）：
  //   powerMul/maxHpMul(获得时等量回血) critBonus critDmgBonus dodgeBonus takenMul(负值)
  //   regenPct lifestealPct openStrikePct mustHitFirst deathSave revivePct firstSkillFree
  //   shellPct enemyPowerDown dmgMulType dmgMulMech dmgMulElite eliteHealAfter
  //   killPowerPct/killPowerCap killMaxHpPct/killMaxHpCap killHealPct layerHealPct
  //   layer5HealPct x10Boost perLayerPowerAfter20 globalMul
  /* 第 4 项数值加强（2026-09-28）：实测 buff 的「数值感」太弱 ——
   * 减伤 10%、生命上限 +10% 这种量级，放在一场要打 10~20 回合的连战里几乎感觉不到，
   * 玩家宁可每次都选回血。这一轮把「本层/跨层」的数值整体抬到能感知的量级
   * （减伤 10%→25%、生命上限 10%→20% 是需求里点名的两条），
   * 单场类（N/M）基本不动，避免一次选择直接决定整层。 */
  const BUFFS = Object.freeze([
    // —— 单场类（主塔+无尽通用） ——
    /* 第 4 项：单场类 buff 整体加强（原来是 25/20/5/20/30 一档，太温柔，
     * 玩家拿到也不觉得这一场变强），并补了暴击/减伤/速度三种手感明显的。 */
    { id: 'N01', name: '蓄力一击', rarity: 0, kind: 'limited', uses: 2, desc: '接下来 2 场攻击 +40%', mods: { powerMul: 0.40 } },
    /* 本轮第 1 项：从「首次攻击必中」改成「所有攻击必中」，场次 5 → 3。 */
    { id: 'N02', name: '百步穿杨', rarity: 0, kind: 'limited', uses: 3, desc: '接下来 3 场所有攻击必中', mods: { mustHitAll: 1 } },
    { id: 'M01', name: '威慑', rarity: 0, kind: 'limited', uses: 2, desc: '接下来 2 场敌人攻击力 −30%', mods: { enemyPowerDown: 0.30 } },
    { id: 'M02', name: '疾风先手', rarity: 0, kind: 'limited', uses: 3, desc: '接下来 3 场你的首次技能不消耗回合', mods: { firstSkillFree: 1 } },
    { id: 'N03', name: '活血丹', rarity: 1, kind: 'limited', uses: 3, desc: '接下来 3 场每回合开始回复 8% 生命', mods: { regenPct: 0.08 } },
    { id: 'N04', name: '金蝉脱壳', rarity: 1, kind: 'limited', uses: 3, desc: '接下来 3 场免疫一次致命伤害（保留 1 点生命）', mods: { deathSave: 1 } },
    { id: 'N07', name: '破军', rarity: 1, kind: 'limited', uses: 3, desc: '接下来 3 场暴击率 +25%', mods: { critBonus: 25 } },
    { id: 'M03', name: '坚守', rarity: 1, kind: 'limited', uses: 2, desc: '接下来 2 场受到伤害 −30%', mods: { takenMul: -0.30 } },
    { id: 'M04', name: '疾风步', rarity: 1, kind: 'limited', uses: 10, desc: '接下来 10 场速度 +30%', mods: { speedMul: 0.30 } },
    { id: 'N05', name: '先手制敌', rarity: 2, kind: 'limited', uses: 3, desc: '接下来 2 场开局对敌人造成其 30% 最大生命的伤害', mods: { openStrikePct: 0.30 } },
    { id: 'N08', name: '补给', rarity: 0, kind: 'limited', uses: 1,
      desc: '下一场战斗开始时立即回复 50% 生命（再拿一次会叠加次数）', mods: { startHealPct: 0.50 } },
    { id: 'N06', name: '血饮狂刀', rarity: 2, kind: 'limited', uses: 5, desc: '接下来 2 场攻击附带 45% 吸血', mods: { lifestealPct: 0.45 } },
    // —— 本层类（主塔=整局；无尽=当前层） ——
    { id: 'G01', name: '力量祝福', rarity: 0, kind: 'limited', uses: 10, desc: '本层攻击 +12%', mods: { powerMul: 0.12 } },
    { id: 'G02', name: '生命祝福', rarity: 0, kind: 'limited', uses: 5, desc: '本层生命上限 +20%，并回复等量生命', mods: { maxHpMul: 0.20 } },
    { id: 'G03', name: '鹰眼', rarity: 0, kind: 'limited', uses: 10, desc: '本层暴击率 +8%', mods: { critBonus: 8 } },
    { id: 'G04', name: '回春术', rarity: 1, kind: 'limited', uses: 10, desc: '本层每回合回复 2.5% 最大生命', mods: { regenPct: 0.025 } },
    { id: 'G05', name: '铁布衫', rarity: 1, kind: 'limited', uses: 5, desc: '本层受到伤害 −25%', mods: { takenMul: -0.25 } },
    { id: 'G06', name: '凌波微步', rarity: 1, kind: 'limited', uses: 10, desc: '本层闪避 +12%', mods: { dodgeBonus: 12 } },
    { id: 'G07', name: '破釜沉舟', rarity: 2, kind: 'limited', uses: 3, desc: '本层攻击 +50%，生命上限 −20%', mods: { powerMul: 0.50, maxHpMul: -0.20 } },
    // —— 跨层类（仅无尽，本局永久） ——
    { id: 'C01', name: '磐石之躯', rarity: 0, kind: 'permanent', desc: '生命上限 +20%，并回复等量生命', mods: { maxHpMul: 0.20 } },
    { id: 'C02', name: '磨砺', rarity: 0, kind: 'permanent', desc: '攻击 +10%', mods: { powerMul: 0.10 } },
    { id: 'C03', name: '猎侠者', rarity: 0, kind: 'permanent', desc: '对螳螂/仙鹤/熊猫伤害 +25%', mods: { dmgMulType: 0.25 } },
    { id: 'C04', name: '生命源泉', rarity: 1, kind: 'permanent', desc: '每通过一层回复 15% 最大生命', mods: { layerHealPct: 0.15 } },
    { id: 'C05', name: '坚韧壁垒', rarity: 1, kind: 'permanent', desc: '每场战斗开局获得 15% 最大生命的护盾', mods: { shellPct: 0.15 } },
    { id: 'C06', name: '猎杀时刻', rarity: 1, kind: 'permanent', stackable: true, desc: '每击杀 1 个敌人攻击 +2%（上限 +40%）', mods: { killPowerPct: 0.02, killPowerCap: 0.40 } },
    { id: 'C07', name: '吞噬成长', rarity: 1, kind: 'permanent', stackable: true, desc: '每击杀 1 个敌人生命上限 +3% 并回复等量生命（上限 +45%）', mods: { killMaxHpPct: 0.03, killMaxHpCap: 0.45 } },
    { id: 'C08', name: '五层回响', rarity: 1, kind: 'permanent', desc: '每到 5 的倍数层，该层第 1 场开局回复 50% 最大生命', mods: { layer5HealPct: 0.50 } },
    { id: 'C09', name: '逢五强化', rarity: 1, kind: 'permanent', desc: '在 5 的倍数层攻击 +30%、生命上限 +30%（仅该层）', mods: { x10Boost: 0.30 } },
    { id: 'C10', name: '机制破解', rarity: 1, kind: 'permanent', desc: '对带专属机制的敌人伤害 +25%', mods: { dmgMulMech: 0.25 } },
    /* 第 4 项新增的跨层类型：续航 / 反伤 / 低血狂怒 / 暴击 / 闪避 / 速度 ——
     * 让「本局永久」这一档不再只有纯数值放大，选到就能改变打法。 */
    { id: 'C16', name: '战后续航', rarity: 1, kind: 'permanent', stackable: true, desc: '每场战斗胜利后回复 5% 最大生命（可叠加）', mods: { winHealPct: 0.05 } },
    { id: 'C17', name: '战后续航·精', rarity: 2, kind: 'permanent', stackable: true, desc: '每场战斗胜利后回复 10% 最大生命（可叠加）', mods: { winHealPct: 0.10 } },
    { id: 'C18', name: '吸血精通', rarity: 1, kind: 'permanent', desc: '所有攻击附带 12% 吸血', mods: { lifestealPct: 0.12 } },
    { id: 'C19', name: '荆棘之甲', rarity: 1, kind: 'permanent', desc: '受到伤害时反弹 20% 给敌人', mods: { thornsPct: 0.20 } },
    { id: 'C20', name: '狂怒', rarity: 2, kind: 'permanent', desc: '生命低于 40% 时攻击 +50%', mods: { lowHpPowerMul: 0.50, lowHpAt: 0.40 } },
    { id: 'C21', name: '暴击精通', rarity: 0, kind: 'permanent', desc: '暴击率 +10%', mods: { critBonus: 10 } },
    { id: 'C22', name: '闪避精通', rarity: 0, kind: 'permanent', desc: '闪避 +8%', mods: { dodgeBonus: 8 } },
    { id: 'C23', name: '轻身术', rarity: 0, kind: 'permanent', desc: '速度 +15%', mods: { speedMul: 0.15 } },
    { id: 'C11', name: '以战养战', rarity: 2, kind: 'permanent', stackable: true, desc: '每获得一场胜利，生命上限 +10（不封顶）', mods: { winMaxHpFlat: 10 } },
    { id: 'C12', name: '登顶者', rarity: 2, kind: 'permanent', stackable: true, desc: '第 10 层起，每通过一场战斗攻击 +5%（不封顶）', mods: { winPowerAfter10: 0.05 } },
    { id: 'C13', name: '精英杀手', rarity: 2, kind: 'permanent', desc: '对精英伤害 +40%；击败精英后回复 20% 最大生命', mods: { dmgMulElite: 0.40, eliteHealAfter: 0.20 } },
    { id: 'C14', name: '不死鸟', rarity: 3, kind: 'permanent', desc: '每层拥有一次复活甲（回复 50% 生命）', mods: { revivePct: 0.50 } },
    /* —— 第 1 项新增：与经济系统挂钩的 buff（仅无尽；instant 的拿到就结算，不占永久 5 格） —— */
    { id: 'E01', name: '立即进货', rarity: 1, kind: 'instant', endlessOnly: true, desc: '立刻开一次试炼商店（不影响 5 层一次的结算点）', mods: { openShop: 1 } },
    { id: 'E02', name: '试炼补贴', rarity: 0, kind: 'instant', endlessOnly: true, desc: '立刻获得 60 试炼币', mods: { instantCoins: 60 } },
    { id: 'E03', name: '财源滚滚', rarity: 1, kind: 'instant', endlessOnly: true, desc: '立刻获得 120 试炼币', mods: { instantCoins: 120 } },
    { id: 'E04', name: '全场五折', rarity: 1, kind: 'permanent', endlessOnly: true, desc: '下一个试炼商店里全部商品 5 折（进店时消耗）', mods: { shopDiscount: 0.5 } },
    { id: 'E05', name: '战利品', rarity: 1, kind: 'limited', uses: 10, endlessOnly: true, desc: '接下来 10 场战斗的试炼币获取 +50%', mods: { coinBoostPct: 0.50 } },
    { id: 'E06', name: '战利品·精', rarity: 2, kind: 'limited', uses: 10, endlessOnly: true, desc: '接下来 10 场战斗的试炼币获取 +120%', mods: { coinBoostPct: 1.20 } },
    /* 第 1 项：名贵手表（稀有 / 永久）—— 商店里不出售，但卖掉能换 200 试炼币；
     * C25 账本：每战斗获胜一次，自己（以及手表）的卖出价就涨一档。 */
    /* 第 5 项补充：普通稀有度的永久小增益（直接加力/敏/速/生命，好上手） */
    { id: 'C26', name: '蛮力', rarity: 0, kind: 'permanent', desc: '攻击 +6%', mods: { powerMul: 0.06 } },
    { id: 'C27', name: '灵巧', rarity: 0, kind: 'permanent', desc: '敏捷 +8%', mods: { agilityMul: 0.08 } },
    { id: 'C28', name: '疾行', rarity: 0, kind: 'permanent', desc: '速度 +8%', mods: { speedMul: 0.08 } },
    { id: 'C29', name: '体质', rarity: 0, kind: 'permanent', desc: '生命上限 +10%（卖掉/替换后仍然保留）', mods: { maxHpMul: 0.10 } },
    /* 第 2 项新增：永久槽位 buff（一局各只能拿一次；史诗战斗+商店都能出，传奇只在战斗里出） */
    { id: 'C30', name: '扩容背包', rarity: 2, kind: 'permanent', unique: true, permSlot: 1,
      desc: '本局永久增益槽位 +1（立即生效，一局只能获得一次）', mods: { permSlot: 1 } },
    { id: 'C31', name: '仓库钥匙', rarity: 3, kind: 'permanent', unique: true, permSlot: 2, battleOnly: true,
      desc: '本局永久增益槽位 +2（立即生效，一局只能获得一次；只在战斗奖励里出现）', mods: { permSlot: 2 } },
    /* 隐藏型选取 buff：拿到后立即三选一（已有武器/技能），强化指定对象；不显示在增益面板、不可出售 */
    { id: 'C32', name: '神兵淬炼', rarity: 2, kind: 'permanent', unique: true, hidden: true,
      desc: '立即从你已有的武器里随机三选一，该武器伤害 +100%（本局有效，隐藏增益，不可出售）', mods: { pickWeaponPct: 1.00 } },
    { id: 'C33', name: '秘技通神', rarity: 2, kind: 'permanent', unique: true, hidden: true,
      desc: '立即从你已有的技能里随机三选一，该技能触发概率大幅提升（本局有效，隐藏增益，不可出售）', mods: { pickSkillPct: 0.60 } },
    /* 对抗环境词缀的三档 buff（普通/稀有/史诗） */
    { id: 'N09', name: '晴空护符', rarity: 0, kind: 'limited', uses: 5,
      desc: '接下来 5 场：无视环境词缀，并把负面环境词缀反弹给对手', mods: { envIgnore: 1, envReflect: 1 } },
    { id: 'N10', name: '避风斗篷', rarity: 1, kind: 'limited', uses: 10,
      desc: '接下来 10 场：无视环境词缀', mods: { envIgnore: 1 } },
    { id: 'C45', name: '天象之眼', rarity: 2, kind: 'permanent',
      desc: '永远无视负面环境词缀并反弹给对手；敌方吃不到正向环境词缀（贪婪裂隙的试炼币收益保留，敌方不再获得生命加成）',
      mods: { envIgnore: 1, envReflect: 1, envDenyGood: 1 } },
    { id: 'C24', name: '名贵手表', rarity: 1, kind: 'permanent', shopBanned: true,
      desc: '商店里买不到；在试炼商店卖出可得 200 试炼币', mods: { sellValue: 200 } },
    { id: 'C25', name: '战利品账本', rarity: 1, kind: 'permanent',
      desc: '每场战斗胜利后，自己的卖价 +10 试炼币（本局累计，卖掉/失去后清零）', mods: { sellGrowthPerWin: 10 } },
    { id: 'C15', name: '增幅水晶', rarity: 2, kind: 'permanent', desc: '本局内所有 buff 效果 +40%', mods: { globalMul: 1.40 } },
    /* —— 本轮第 3 项：即时削弱敌方生命上限（普通 / 稀有各一）——
     * kind: instant 表示「拿到就结算、不占永久 5 格」；效果是本局内的全局减益，
     * 立刻登记到 run.enemyMaxHpDown，之后每一场 buildFoe 出来的敌人都按比例扣血上限。 */
    { id: 'E07', name: '挫锐', rarity: 0, kind: 'instant', endlessOnly: true,
      desc: '立刻让本局所有敌人的生命上限 −10%（此后每场都生效，不占增益位）', mods: { enemyMaxHpDown: 0.10 } },
    { id: 'E08', name: '卸甲', rarity: 1, kind: 'instant', endlessOnly: true,
      desc: '立刻让本局所有敌人的生命上限 −15%（此后每场都生效，不占增益位）', mods: { enemyMaxHpDown: 0.15 } },
    /* —— 本轮第 6 项：和永久增益槽位互动的攻击 buff ——
     * C34 是「空槽越多越强」，C35 是「永久 buff 越多越强」，两者取向相反，
     * 放在一起才逼出「要不要占满 5 格」的真实取舍。 */
    { id: 'C34', name: '轻装上阵', rarity: 0, kind: 'permanent',
      desc: '每个空的永久增益位让攻击 +20%', mods: { powerPerEmptySlot: 0.20 } },
    { id: 'C35', name: '厚积薄发', rarity: 2, kind: 'permanent',
      desc: '每拥有 1 个永久增益，攻击 +10%（含它自己）', mods: { powerPerPermBuff: 0.10 } },
    /* —— 本轮第 9 项：传奇 · 商店消费成长 ——
     * 每消费 20 试炼币 → 力/敏/速 随机一项 +1、生命上限 +5，可无限累计；
     * 累计结果与「距下次还差几枚」都显示在增益面板上（progressOf）。 */
    { id: 'C36', name: '挥金如土', rarity: 3, kind: 'permanent',
      desc: '本局每在试炼商店消费 20 试炼币，随机获得「力+1 / 敏+1 / 速+1 / 生命上限+5」中的一项（可无限累计）',
      mods: { shopSpendStep: 20, shopSpendStat: 1, shopSpendHp: 5 } },
    /* —— 本轮第 1 项：两个新增益 ——
     * C37 虚空铭文（传奇·隐藏选取型）：给已有的一个永久增益附魔，让它不占永久位。
     *    可叠加的增益是一个条目带 stacks，所以「所有层一起免疫占位」是自动成立的。
     * C38 先机预判（史诗）：每场战斗敌方对我方的第一次**攻击**伤害归零。
     *    反伤/中毒这类非攻击伤害不走 applyDamage 的攻击路径，所以天然不会消耗它
     *    （需求里点名的「不会被反伤 debuff 破坏」）。 */
    { id: 'C37', name: '虚空铭文', rarity: 3, kind: 'permanent', unique: true, hidden: true,
      desc: '立即从你已有的永久增益里选一个附魔：它不再占用永久增益位（可叠加的增益则全部层数一起免疫占位；本局有效，隐藏增益，不可出售）',
      mods: { pickPermanentFree: 1 } },
    /* —— 本轮第 7 项：易碎的属性烙印（普通 / 稀有各三种）——
     * kind: limited + uses: 1000 = 实际上不会按场次耗尽，靠「每场 5% 损毁」结束。
     * 拿到时立刻把加成记进 run.stickyStat（本局永久保留的乘区），
     * 所以烙印损毁之后这份提升依然留着 —— 需求里点名的「永久保留」。
     * 损毁只发生在 5% 判定里；玩家主动「卖出/被换掉」才算真的失去（那时连加成一起清）。 */
    { id: 'C39', name: '力量烙印', rarity: 0, kind: 'limited', uses: 1000,
      desc: '力量 +8%（本局永久保留）。每打完一场有 5% 概率损毁；损毁后这份力量仍然保留',
      mods: { fragileStat: 'power', fragilePct: 0.08, fragileBreakPct: 5 } },
    { id: 'C40', name: '敏捷烙印', rarity: 0, kind: 'limited', uses: 1000,
      desc: '敏捷 +8%（本局永久保留）。每打完一场有 5% 概率损毁；损毁后这份敏捷仍然保留',
      mods: { fragileStat: 'agility', fragilePct: 0.08, fragileBreakPct: 5 } },
    { id: 'C41', name: '速度烙印', rarity: 0, kind: 'limited', uses: 1000,
      desc: '速度 +8%（本局永久保留）。每打完一场有 5% 概率损毁；损毁后这份速度仍然保留',
      mods: { fragileStat: 'speed', fragilePct: 0.08, fragileBreakPct: 5 } },
    { id: 'C42', name: '力量烙印·精', rarity: 1, kind: 'limited', uses: 1000,
      desc: '力量 +14%（本局永久保留）。每打完一场有 5% 概率损毁；损毁后这份力量仍然保留',
      mods: { fragileStat: 'power', fragilePct: 0.14, fragileBreakPct: 5 } },
    { id: 'C43', name: '敏捷烙印·精', rarity: 1, kind: 'limited', uses: 1000,
      desc: '敏捷 +14%（本局永久保留）。每打完一场有 5% 概率损毁；损毁后这份敏捷仍然保留',
      mods: { fragileStat: 'agility', fragilePct: 0.14, fragileBreakPct: 5 } },
    { id: 'C44', name: '速度烙印·精', rarity: 1, kind: 'limited', uses: 1000,
      desc: '速度 +14%（本局永久保留）。每打完一场有 5% 概率损毁；损毁后这份速度仍然保留',
      mods: { fragileStat: 'speed', fragilePct: 0.14, fragileBreakPct: 5 } },
    { id: 'C38', name: '先机预判', rarity: 2, kind: 'permanent',
      desc: '每场战斗敌方对我方造成的第一次伤害变为 0（反伤、中毒等非攻击伤害不会消耗它）',
      mods: { firstHitZero: 1 } },
  ]);
  const BUFF_BY_ID = Object.fromEntries(BUFFS.map((b) => [b.id, b]));
  /* 第 3 项：稀有度加一档「传奇」。越高稀有度权重越低，但不悬殊（普通 56 / 稀有 26 / 史诗 14 / 传奇 4）。 */
  const RARITY_NAME = ['普通', '稀有', '史诗', '传奇'];
  /* 本轮第 2 项：稀有/史诗/传奇出率整体下调（原 56/26/14/4）——
   * 实测史诗/传奇出现得太频繁，「抽到好东西」不再有感觉。现在换算成
   * 66% / 21% / 10% / 3%（三个随机槽独立 Roll，所以一屏出现史诗的概率仍不低）。 */
  const RARITY_WEIGHTS = [66, 21, 10, 3];        // 每个随机槽独立 Roll
  /* 第 4 项：场间只剩一次选择，所以那一次的大回血要够用。
   * 第 4 项需求：从 80% 下调到 50%（配合「每场自动回血」，整层续航仍够，
   * 但「回血 or 拿 buff」这次决策不再默认选回血）。 */
  const FIXED_HEAL_PCT = 0.5;
  /* 每场战斗后自动回复的固定比例（不需要决策）。
   * 第 3 项把场间选择从 3 次压到 1 次后，回血从「三次微决策」变成「稳定节奏」，
   * 这样既少操作，也不会因为一次选错就断崖式掉血。 */
  const AUTO_HEAL_PCT = 0.14;                    // 每场打完自动回复的比例
  /* 第 2 项：无尽塔跨层时固定回复 20% 生命（原来只有「五层回响」那 50%），
   * 冲分时的续航不再只能靠场间选择。 */
  const ENDLESS_LAYER_HEAL_PCT = 0.20;
  const STACK_MAX = 3;
  /* 每层通关结算时补发的「悬浮奖品」场数：塔内战斗关掉了飘物掉落（防免门票刷资源），
   * 所以按**一整个常驻挑战关 = 3 场**的掉落量补回来（每场 3 个飘物 → 共 9 个）。 */
  const SETTLE_DROP_BATTLES = 3;

  /* 第 3 项：无尽每爬 10 层，结算时随机发一次里程碑奖励（技能卷轴×10 / 武器卷轴×10 / 随机药丸）。
   * 药丸取「大力丸/敏捷丸/速度丸/经验丸」的普通版与超级版（超级版权重低一半）。 */
  const MILESTONE_EVERY = 10;
  const MILESTONE_BOOK_COUNT = 10;
  const MILESTONE_REWARDS = [
    { kind: 'skill', propId: 21, count: MILESTONE_BOOK_COUNT, name: '技能卷轴' },
    { kind: 'weapon', propId: 22, count: MILESTONE_BOOK_COUNT, name: '武器卷轴' },
    { kind: 'pill' },
  ];
  const MILESTONE_PILLS = [
    { id: 3, weight: 3 }, { id: 4, weight: 3 }, { id: 5, weight: 3 }, { id: 7, weight: 3 },
    { id: 41, weight: 1 }, { id: 42, weight: 1 }, { id: 43, weight: 1 }, { id: 44, weight: 1 },
  ];
  /** 抽一次里程碑奖励（不改状态，纯计算，方便测试）。 */
  function rollMilestone() {
    const pick = MILESTONE_REWARDS[Math.floor(Math.random() * MILESTONE_REWARDS.length)];
    if (pick.kind !== 'pill') return { kind: pick.kind, propId: pick.propId, count: pick.count, name: pick.name };
    const total = MILESTONE_PILLS.reduce((a, p) => a + p.weight, 0);
    let roll = Math.random() * total;
    for (const p of MILESTONE_PILLS) { roll -= p.weight; if (roll < 0) return { kind: 'pill', propId: p.id, count: 1 }; }
    const last = MILESTONE_PILLS[MILESTONE_PILLS.length - 1];
    return { kind: 'pill', propId: last.id, count: 1 };
  }
  /** 主塔池 = 单场 + 本层（15 个）；无尽池 = 全部 30 个。 */
  /* 第 4 项：池子用 tag 显式标注（谁进哪个池一眼能看出来）：
   *   'choice' 休整点/场间四选一能抽到
   *   'shop'   试炼商店货架能上架
   *   'tower'  挑战塔的场间四选一能抽到（限次 & 非无尽专属）
   * 名贵手表这类「只在别处出现」的靠 shopBanned 排除出 shop，但仍留在 choice。 */
  const POOLS = Object.freeze({
    choice: (b) => true,
    shop: (b) => !b.shopBanned && !b.battleOnly && b.kind !== 'instant',
    tower: (b) => b.kind === 'limited' && !b.endlessOnly,
  });
  const inPool = (tag, buff) => !!(POOLS[tag] && POOLS[tag](buff));
  /* 主塔池 = 限次类（不含无尽专属的经济 buff）；无尽池 = 全部。
   * 永久类只进无尽（主塔一层一结算，没有「本局永久」的位置）。 */
  const towerPool = BUFFS.filter((b) => inPool('tower', b));
  const endlessPool = BUFFS.slice();
  /** 商店货架池：去掉「商店里不卖」的（名贵手表）。 */
  const shopPool = BUFFS.filter((b) => inPool('shop', b));
  /** 永久增益的持有上限（第 1 项：无尽主界面最多 5 个，同名叠层仍算 1 格）。 */
  const PERMANENT_SLOTS = 5;
  /* 第 1 项：无尽塔的「三种属性药丸」槽位 —— 消耗背包里的药丸，塔内持续 20 场战斗。
   * 效果口径跟 State.totalStats 里的一致：普通丸 +20%（最少 5 点）、超级丸 +40%（最少 10 点）。 */
  const PILL_BATTLES = 20;
  const PILL_SLOTS = [
    { key: 'power', name: '力量', ids: [3, 41] },
    { key: 'agility', name: '敏捷', ids: [4, 42] },
    { key: 'speed', name: '速度', ids: [5, 43] },
  ];
  function pillEffect(id) {
    const n = Number(id);
    if (n === 3) return { stat: 'power', pct: 0.20, min: 5 };
    if (n === 4) return { stat: 'agility', pct: 0.20, min: 5 };
    if (n === 5) return { stat: 'speed', pct: 0.20, min: 5 };
    if (n === 41) return { stat: 'power', pct: 0.40, min: 10 };
    if (n === 42) return { stat: 'agility', pct: 0.40, min: 10 };
    if (n === 43) return { stat: 'speed', pct: 0.40, min: 10 };
    return null;
  }

  window.TowerData = {
    towerLevel, towerMult, towerGold, towerGoldShares, TOWER_FAIL_CONSOLATION,
    endlessLevel, endlessSegment, endlessMult, endlessMechStacks, endlessMechs, ENDLESS_MECH_MAX, endlessTickets,
    GEAR_TIER, gearKeyForLayer, gearTierCap, ENDLESS_BOSS_POOL,
    ENDLESS_ENV, ENDLESS_ENV_BY_ID, envChance, ENV_START_LAYER, ENV_TWO_LAYER, ENV_MAX, ENV_DUR,
    ENDLESS_MECH_ORDER, ENDLESS_CONSOLATION_LAYER, SCORE, COINS, SHOP, shopPrice,
    FOE_STAT_MUL, FOE_POWER_MUL, FOE_HP_MUL, FOE_HERO_HP_MUL, FOE_HERO_POWER_MUL,
    FOE_TRIAL_POWER_MUL, FOE_WARLORD_POWER_MUL, bossHpRatio, BOSS_HP_MIN, BOSS_HP_MAX, WARLORD_HP_RATIO,
    ENDLESS_LAYER_HEAL_PCT, MILESTONE_EVERY, MILESTONE_BOOK_COUNT, rollMilestone, PERMANENT_SLOTS,
    PILL_BATTLES, PILL_SLOTS, pillEffect, shopPool, POOLS, inPool, RARITY_NAME, RARITY_WEIGHTS,
    NPCS, NPC_BY_ID, HERO_DEBUFF,
    SQUIRRELS, SQUIRREL_BY_ID, squirrelFor,
    TRIALS, TRIAL_BY_ID, trialFor,
    GEAR, wearsOf, WARLORD, BOSS_POOL, bossFor, heroOrder,
    BUFFS, BUFF_BY_ID, RARITY_NAME, RARITY_WEIGHTS, FIXED_HEAL_PCT, AUTO_HEAL_PCT, STACK_MAX,
    SETTLE_DROP_BATTLES,
    towerPool, endlessPool,
  };
})();
