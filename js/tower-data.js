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
    if (n <= 5) return 15;
    if (n <= 10) return 20;
    if (n <= 15) return 28;
    if (n <= 20) return 38;
    return Math.min(68, 38 + 3 * (n - 20));
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
  function endlessMechStacks(n) { return Math.min(5, endlessSegment(n) - 1); }
  function endlessTickets(n) {
    const s = endlessSegment(n);
    return s <= 4 ? Math.pow(2, s - 1) : 8 + 3 * (s - 4);
  }
  /** 段间怪物机制叠加顺序（固定，方便玩家预判）。 */
  const ENDLESS_MECH_ORDER = ['thorns', 'regen', 'lifesteal', 'shell', 'devour'];
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
  /* 松鼠对手额外修正：机制 NPC 只会用属性打人，松鼠是真的会拿武器、放技能，
   * 输出天然高一档，血量也不该跟着「血厚」基准一起膨胀（血厚 → 回合变长 → 玩家承伤反而更多）。
   * 两个系数乘在这里而不是改各模板的 bias，方便统一调（tools/tower-balance.cjs 实测）。
   * 这组值让单场「胜时剩余血量」约 77%，和第 4 场原机制 NPC 的 80% 基本对齐，
   * 这样每层 4 场连战的血量继承压力和改版前一致。 */
  const FOE_SQUIRREL_POWER_MUL = 0.50;
  const FOE_SQUIRREL_HP_MUL = 0.70;

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

  // ---------- 松鼠对手（每层最后一场 / 第 4 场） ----------
  /* 和小松鼠同族：战斗里用玩家那套松鼠贴图（镜像朝左，tower.js 不给 npcType 即自动生效），
   * 武器与技能都取自松鼠本来的池子（GameDict 的 weaponsMap / skillsMap）。
   *
   * 出招是**固定循环**，不是随机 roll —— 玩家可以背板、可以针对配装：
   *   pattern 的每一项 = 一次行动的意图：'common' 普攻 / 'weapon' 用武器 / 'skill' 放技能；
   *   某一项这回合用不了（被缴械 / 沉默 / 没主动技能）就顺延到下一个能用的。
   *   每个模板只带 1 个主动技能，所以「放技能」这一步也是确定的。
   *
   * 三套模板按层数固定轮换（(n−1) mod 3，见 squirrelFor），数值仍按 1.4 的难度模型缩放；
   * 武器/技能等级会随目标等级小幅上调，避免高层还在用 8 级菜刀。
   * 想加/改模板只动这张表就行。 */
  const SQUIRRELS = Object.freeze([
    { id: 'scout', name: '斥候松鼠', type: '敏捷型', region: 3,
      bias: { power: 0.95, agility: 1.10, speed: 1.15, hp: 1.00 },
      weapons: [{ id: 8, level: 6 }], skills: [{ id: 2, level: 7 }, { id: 23, level: 7 }],
      pattern: ['common', 'weapon', 'common', 'skill'],
      patternDesc: '固定循环：普攻 → 菜刀 → 普攻 → 幸运一击' },
    { id: 'guard', name: '铁壁松鼠', type: '防御型', region: 2,
      bias: { power: 0.92, agility: 0.90, speed: 0.90, hp: 1.28 },
      weapons: [{ id: 2, level: 6 }], skills: [{ id: 4, level: 7 }, { id: 10, level: 7 }],
      pattern: ['weapon', 'common', 'weapon', 'common'],
      patternDesc: '固定循环：大榔头 → 普攻（血最厚、出手最慢）' },
    { id: 'frenzy', name: '狂暴松鼠', type: '爆发型', region: 1,
      bias: { power: 1.10, agility: 0.95, speed: 1.00, hp: 1.10 },
      weapons: [{ id: 12, level: 6 }], skills: [{ id: 5, level: 7 }, { id: 14, level: 7 }],
      pattern: ['common', 'weapon', 'skill', 'weapon'],
      patternDesc: '固定循环：普攻 → 狼牙棒 → 小宇宙爆发 → 狼牙棒' },
  ]);
  const SQUIRREL_BY_ID = Object.fromEntries(SQUIRRELS.map((n) => [n.id, n]));
  /** 第 4 场固定轮换：(n−1) mod 3 → 松鼠模板。 */
  function squirrelFor(layer) { return SQUIRRELS[(Math.max(1, layer) - 1) % SQUIRRELS.length]; }

  /** 第 4 场固定轮换：(n−1) mod 10 → NPC。 */
  /** 精英场（x10 层第 5 场）固定轮换：主体 + 第二机制（取循环下一位的机制）。
   * v2.2 起第 4 场改成松鼠，机制 NPC 只剩这一个出场口，所以轮换必须覆盖全部 10 个，
   * 否则后排几个 NPC 永远打不到。前 6 位是 v2.0 的既有顺序（10~60 层精英不变），后 4 位是补进来的。 */
  const ELITE_ROTATION = Object.freeze(['ironwall', 'devourer', 'berserker', 'golem', 'assassin', 'vampire', 'medic', 'tamer', 'bramble', 'frostmage']);
  function eliteFor(layer) {
    const idx = (Math.floor(layer / 10) - 1 + ELITE_ROTATION.length * 100) % ELITE_ROTATION.length;
    const main = NPC_BY_ID[ELITE_ROTATION[idx]];
    const second = NPC_BY_ID[ELITE_ROTATION[(idx + 1) % ELITE_ROTATION.length]];
    return { main, mechs: [main.mech, second.mech] };
  }

  // ---------- Buff 池 ----------
  // rarity: 0 普通 / 1 稀有 / 2 史诗；scope: battle 单场 / layer 本层 / run 跨层（仅无尽）。
  // mods 由 tower.js 解释（数值均为加池百分比或比例）：
  //   powerMul/maxHpMul(获得时等量回血) critBonus critDmgBonus dodgeBonus takenMul(负值)
  //   regenPct lifestealPct openStrikePct mustHitFirst deathSave revivePct firstSkillFree
  //   shellPct enemyPowerDown dmgMulType dmgMulMech dmgMulElite eliteHealAfter
  //   killPowerPct/killPowerCap killMaxHpPct/killMaxHpCap killHealPct layerHealPct
  //   layer5HealPct x10Boost perLayerPowerAfter20 globalMul
  const BUFFS = Object.freeze([
    // —— 单场类（主塔+无尽通用） ——
    { id: 'N01', name: '蓄力一击', rarity: 0, scope: 'battle', desc: '下一场攻击 +25%', mods: { powerMul: 0.25 } },
    { id: 'N02', name: '百步穿杨', rarity: 0, scope: 'battle', desc: '下一场首次攻击必中', mods: { mustHitFirst: 1 } },
    { id: 'M01', name: '威慑', rarity: 0, scope: 'battle', desc: '下一场敌人攻击力 −15%', mods: { enemyPowerDown: 0.15 } },
    { id: 'M02', name: '疾风先手', rarity: 0, scope: 'battle', desc: '下一场你的首次技能不消耗回合', mods: { firstSkillFree: 1 } },
    { id: 'N03', name: '活血丹', rarity: 1, scope: 'battle', desc: '下一场每回合开始回复 5% 生命', mods: { regenPct: 0.05 } },
    { id: 'N04', name: '金蝉脱壳', rarity: 1, scope: 'battle', desc: '下一场免疫一次致命伤害（保留 1 点生命）', mods: { deathSave: 1 } },
    { id: 'N05', name: '先手制敌', rarity: 2, scope: 'battle', desc: '下一场开局对敌人造成其 20% 最大生命的伤害', mods: { openStrikePct: 0.20 } },
    { id: 'N06', name: '血饮狂刀', rarity: 2, scope: 'battle', desc: '下一场攻击附带 30% 吸血', mods: { lifestealPct: 0.30 } },
    // —— 本层类（主塔=整局；无尽=当前层） ——
    { id: 'G01', name: '力量祝福', rarity: 0, scope: 'layer', desc: '本层攻击 +8%', mods: { powerMul: 0.08 } },
    { id: 'G02', name: '生命祝福', rarity: 0, scope: 'layer', desc: '本层生命上限 +10%，并回复等量生命', mods: { maxHpMul: 0.10 } },
    { id: 'G03', name: '鹰眼', rarity: 0, scope: 'layer', desc: '本层暴击率 +5%', mods: { critBonus: 5 } },
    { id: 'G04', name: '回春术', rarity: 1, scope: 'layer', desc: '本层每回合回复 1.5% 最大生命', mods: { regenPct: 0.015 } },
    { id: 'G05', name: '铁布衫', rarity: 1, scope: 'layer', desc: '本层受到伤害 −10%', mods: { takenMul: -0.10 } },
    { id: 'G06', name: '凌波微步', rarity: 1, scope: 'layer', desc: '本层闪避 +8%', mods: { dodgeBonus: 8 } },
    { id: 'G07', name: '破釜沉舟', rarity: 2, scope: 'layer', desc: '本层攻击 +15%，生命上限 −10%', mods: { powerMul: 0.15, maxHpMul: -0.10 } },
    // —— 跨层类（仅无尽，本局永久） ——
    { id: 'C01', name: '磐石之躯', rarity: 0, scope: 'run', desc: '生命上限 +12%，并回复等量生命', mods: { maxHpMul: 0.12 } },
    { id: 'C02', name: '磨砺', rarity: 0, scope: 'run', desc: '攻击 +6%', mods: { powerMul: 0.06 } },
    { id: 'C03', name: '猎侠者', rarity: 0, scope: 'run', desc: '对螳螂/仙鹤/熊猫伤害 +15%', mods: { dmgMulType: 0.15 } },
    { id: 'C04', name: '生命源泉', rarity: 1, scope: 'run', desc: '每通过一层回复 10% 最大生命', mods: { layerHealPct: 0.10 } },
    { id: 'C05', name: '坚韧壁垒', rarity: 1, scope: 'run', desc: '每场战斗开局获得 10% 最大生命的护盾', mods: { shellPct: 0.10 } },
    { id: 'C06', name: '猎杀时刻', rarity: 1, scope: 'run', stackable: true, desc: '每击杀 1 个敌人攻击 +1%（上限 +20%）；重复选取提升速率与上限', mods: { killPowerPct: 0.01, killPowerCap: 0.20 } },
    { id: 'C07', name: '吞噬成长', rarity: 1, scope: 'run', stackable: true, desc: '每击杀 1 个敌人生命上限 +2% 并回复等量生命（上限 +30%）', mods: { killMaxHpPct: 0.02, killMaxHpCap: 0.30 } },
    { id: 'C08', name: '五层回响', rarity: 1, scope: 'run', desc: '每到 5 的倍数层，该层第 1 场开局回复 50% 最大生命', mods: { layer5HealPct: 0.50 } },
    { id: 'C09', name: '逢十强化', rarity: 1, scope: 'run', desc: '在 10 的倍数层攻击 +20%、生命上限 +20%（仅该层）', mods: { x10Boost: 0.20 } },
    { id: 'C10', name: '机制破解', rarity: 1, scope: 'run', desc: '对带专属机制的 NPC 伤害 +20%', mods: { dmgMulMech: 0.20 } },
    { id: 'C11', name: '以战养战', rarity: 2, scope: 'run', stackable: true, desc: '每击杀 1 个敌人回复 3% 最大生命', mods: { killHealPct: 0.03 } },
    { id: 'C12', name: '登顶者', rarity: 2, scope: 'run', stackable: true, desc: '从 20 层起，每通过一层攻击永久 +3%', mods: { perLayerPowerAfter20: 0.03 } },
    { id: 'C13', name: '精英杀手', rarity: 2, scope: 'run', desc: '对精英 NPC 伤害 +30%；击败精英后回复 15% 最大生命', mods: { dmgMulElite: 0.30, eliteHealAfter: 0.15 } },
    { id: 'C14', name: '不死鸟', rarity: 2, scope: 'run', desc: '每场战斗可复活一次（回复 30% 生命）', mods: { revivePct: 0.30 } },
    { id: 'C15', name: '增幅水晶', rarity: 2, scope: 'run', desc: '本局内所有 buff 效果 +40%', mods: { globalMul: 1.40 } },
  ]);
  const BUFF_BY_ID = Object.fromEntries(BUFFS.map((b) => [b.id, b]));
  const RARITY_NAME = ['普通', '稀有', '史诗'];
  const RARITY_WEIGHTS = [62, 28, 10];           // 每个随机槽独立 Roll
  const FIXED_HEAL_PCT = 0.30;                    // 固定选项：回复 30% 最大生命
  const STACK_MAX = 3;

  /** 主塔池 = 单场 + 本层（15 个）；无尽池 = 全部 30 个。 */
  const towerPool = BUFFS.filter((b) => b.scope !== 'run');
  const endlessPool = BUFFS.slice();

  window.TowerData = {
    towerLevel, towerMult, towerGold, towerGoldShares, TOWER_FAIL_CONSOLATION,
    endlessLevel, endlessSegment, endlessMult, endlessMechStacks, endlessTickets,
    ENDLESS_MECH_ORDER, ENDLESS_CONSOLATION_LAYER, SCORE, COINS, SHOP, shopPrice,
    FOE_STAT_MUL, FOE_POWER_MUL, FOE_HP_MUL, FOE_SQUIRREL_POWER_MUL, FOE_SQUIRREL_HP_MUL,
    NPCS, NPC_BY_ID, ELITE_ROTATION, eliteFor,
    SQUIRRELS, SQUIRREL_BY_ID, squirrelFor,
    BUFFS, BUFF_BY_ID, RARITY_NAME, RARITY_WEIGHTS, FIXED_HEAL_PCT, STACK_MAX,
    towerPool, endlessPool,
  };
})();
