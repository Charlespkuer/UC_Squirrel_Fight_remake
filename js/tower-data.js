(function () {
  'use strict';

  /* D1 主塔公式：目标等级 45 层封顶 90，段位倍率 30 层封顶；金松果基础值 26 层封顶 50
   * 挑战塔 buildFoe 的深度曲线恒为 1（KM=1），套装档位第 20 层封顶 3，只有无尽塔吃 depth。 */

  const TOWER_LEVEL_CAP = 90;        // 目标等级上限（= 玩家满级 90）
  const TOWER_MULT_CAP_LAYER = 30;   // 段位倍率从这一层起不再增长
  /* 挑战塔单层金松果：1 层 25，每层 +1，第 26 层封顶 50；x5 ×1.5、x10 ×2（只取更高档），
   * 上限后倍率仍保留。26 层前敌人血量另有 ×0.9 补偿（towerEarlyHpMul，仅挑战塔）。 */
  const TOWER_GOLD_BASE = 25;        // 第 1 层的通关金松果
  const TOWER_GOLD_STEP = 1;         // 每层 +1
  const TOWER_GOLD_CAP = 50;         // **基础值**硬上限（第 26 层触及）
  const TOWER_GOLD_CAP_LAYER = 26;   // 到这一层基础值到顶
  const TOWER_GOLD_X5_MUL = 1.5;     // x5 层额外倍率
  const TOWER_GOLD_X10_MUL = 2;      // x10 层额外倍率（只取这一档）
  const TOWER_EARLY_HP_MUL = 0.9;    // 「增长上限之前」的敌人血量系数

  function towerLevel(n) { return Math.min(TOWER_LEVEL_CAP, Math.round(28 + 1.4 * (n - 1))); }
  function towerMult(n) {
    const m = Math.min(Math.max(1, n), TOWER_MULT_CAP_LAYER);
    return (1 + 0.03 * Math.floor((m - 1) / 5)) * (1 + 0.04 * Math.floor((m - 1) / 10));
  }
  /** 单层金松果的**基础值**（不含 x5 / x10 倍率）：1 层 25，每层 +1，第 26 层起硬上限 50。 */
  function towerGoldBase(n) {
    n = Math.max(1, Math.floor(n));
    return Math.min(TOWER_GOLD_CAP, TOWER_GOLD_BASE + TOWER_GOLD_STEP * (n - 1));
  }
  function towerGold(n) {
    n = Math.max(1, Math.floor(n));
    const mul = n % 10 === 0 ? TOWER_GOLD_X10_MUL : n % 5 === 0 ? TOWER_GOLD_X5_MUL : 1;
    return Math.round(towerGoldBase(n) * mul);
  }
  /** 「金松果还在增长期」的层（第 26 层之前）敌人血量 ×0.9：那几层收益低，难度也放低一点。
   *  无尽塔不吃这条（它有自己的 depth 曲线与层间回血），只有挑战塔用。 */
  function towerEarlyHpMul(layer, mode) {
    if (mode && mode !== 'tower') return 1;
    return Math.max(1, Math.floor(layer)) < TOWER_GOLD_CAP_LAYER ? TOWER_EARLY_HP_MUL : 1;
  }
  function towerGoldShares(n, battles) {
    const g = towerGold(n), base = Math.floor(g / battles);
    return Array.from({ length: battles }, (_, i) => i === battles - 1 ? g - base * (battles - 1) : base);
  }
  const TOWER_FAIL_CONSOLATION = 0.3;   // 失败安慰奖：本局已累积的 30%（向下取整）

  function endlessLevel(n) { return Math.min(90, Math.round(24 + 1.2 * (n - 1))); }
  const endlessSegment = (n) => Math.max(1, Math.ceil(n / 5));
  const ENDLESS_EARLY_BASE = 1.20;   // 第 1 层的段位倍率（原 ×1）
  const ENDLESS_EARLY_END = 1.40;    // 第 5 层的段位倍率（第 6 层仍是 ×1.5，见 endlessMult）
  const ENDLESS_RAMP_LAYER = 6;      // 从这一层起回到「段内恒定 ×1.5」
  function endlessMult(n) {
    const layer = Math.max(1, Math.floor(Number(n) || 1));
    const base = Math.min(10, Math.pow(1.5, endlessSegment(layer) - 1));
    if (layer >= ENDLESS_RAMP_LAYER) return base;
    const t = (layer - 1) / (ENDLESS_RAMP_LAYER - 2);
    return Math.min(10, ENDLESS_EARLY_BASE + (ENDLESS_EARLY_END - ENDLESS_EARLY_BASE) * t);
  }
  const ENDLESS_DEEP_LAYER = 30;
  const ENDLESS_DEEP_RATE1 = 0.07;
  const ENDLESS_DEEP_RATE2 = 0.0555;
  const ENDLESS_DEEP_SPLIT = 20;      // 30 + 20 = 第 50 层开始切换速率
  /** 无尽塔「战斗可跳过播放」的起始层（用户口径 2026-11：由 20 层下调到 10 层）。
   *  与 ENDLESS_DEEP_LAYER 无关 —— 那个是敌人深度曲线，不要混用。 */
  const ENDLESS_SKIP_LAYER = 10;
  /** 轮内 30 层后的深度倍率（轮内 ≤30 层恒为 1）；只表示轮内深度这一乘区，
   *  不能单独用它比较跨轮强弱。 */
  function endlessDepthMul(n) {
    const layer = cycleLayer(n);
    const d = Math.max(0, layer - ENDLESS_DEEP_LAYER);
    const seg1 = Math.min(d, ENDLESS_DEEP_SPLIT);
    const seg2 = Math.max(0, d - ENDLESS_DEEP_SPLIT);
    return Math.pow(1 + ENDLESS_DEEP_RATE1, seg1) * Math.pow(1 + ENDLESS_DEEP_RATE2, seg2);
  }
  function endlessMechStacks(n) { return Math.min(ENDLESS_MECH_MAX, endlessSegment(n) - 1); }
  function endlessMechs(n) {
    const seg = endlessSegment(n), count = endlessMechStacks(n);
    if (!count) return [];
    const off = (seg - 2 + ENDLESS_MECH_ORDER.length * 2) % ENDLESS_MECH_ORDER.length;
    const out = [];
    for (let i = 0; i < count; i++) out.push(ENDLESS_MECH_ORDER[(off + i) % ENDLESS_MECH_ORDER.length]);
    return out;
  }
  function endlessTickets(n) {
    /* 抽奖卷从爬到第 5 层才开始给：1~4 层为 0，第 5 层起按段位递增。 */
    const layer = Math.max(1, Math.floor(Number(n) || 1));
    if (layer < 5) return 0;
    const s = endlessSegment(layer);
    return s <= 2 ? s : 2 + 2 * (s - 2);
  }
  const ENDLESS_MECH_ORDER = ['thorns', 'regen', 'lifesteal', 'shell', 'devour'];
  const ENDLESS_MECH_MAX = 3;
  /* D2b 100 层循环：敌人每轮起点 = 上一轮末尾完整基础 × ENDLESS_CYCLE_DISCOUNT，之后重走
   * 整百层不开任何商店（x5 照旧开）；101 = 100 层完整基础 × 0.70，201 同理，不能只重置等级/段位。 */
  const LAYER_CYCLE = 100;
  const ENDLESS_CYCLE_DISCOUNT = 0.70;  // 新一轮首层 / 上一轮末层的完整基础；属性、生命统一可调
  const SHOP_SLOT_TIERS = Object.freeze([
    Object.freeze({ max: 20, slots: 5 }),
    Object.freeze({ max: 40, slots: 4 }),
    Object.freeze({ max: 100, slots: 3 }),
  ]);
  const CHOICE_CUT_TIERS = Object.freeze([
    Object.freeze({ max: 20, cut: 0 }),
    Object.freeze({ max: 40, cut: 1 }),
    Object.freeze({ max: 100, cut: 2 }),
  ]);
  function layerCycle(n) {
    const layer = Math.max(1, Math.floor(Number(n) || 1));
    return ((layer - 1) % LAYER_CYCLE) + 1;
  }
  /** 所有按层门槛统一用轮内层号：1~100 返回 1~100，第 101 层又返回 1。
   *  绝对层号写法（如 n > 30）会在第二轮错位。 */
  function cycleLayer(n) { return layerCycle(n); }
  const BRAND_LOSS_FROM = 30;
  function cycleTierOf(tiers, n) {
    const c = layerCycle(n);
    for (const t of tiers) if (c <= t.max) return t;
    return tiers[tiers.length - 1];
  }
  function endlessShopSlots(n) {
    const base = Math.max(1, Math.floor(Number(SHOP && SHOP.slots) || 5));
    return Math.max(1, base - shopSlotCut(n));
  }
  function shopSlotCut(n) {
    const base = Math.max(1, Math.floor(Number(SHOP && SHOP.slots) || 5));
    return Math.max(0, base - cycleTierOf(SHOP_SLOT_TIERS, n).slots);
  }
  function choiceCut(n) { return Math.max(0, Math.floor(Number(cycleTierOf(CHOICE_CUT_TIERS, n).cut) || 0)); }
  function layerNoShop(n) {
    const layer = Math.floor(Number(n) || 0);
    return layer > 0 && layer % LAYER_CYCLE === 0;
  }
  /** 整百层 = 觐见魔王层：打赢后固定掉照影之境，拾取并确认后才进下一层。
   *  判据与 layerNoShop 同源（整百层不开店），单独命名便于以后调层号。 */
  function isMirrorLayer(n) { return layerNoShop(n); }
  /** 照影之境：整百层剧情固定奖励那一件（id + 循环长度）。 */
  const MIRROR = Object.freeze({ id: 'C63', cycle: LAYER_CYCLE });
  /** 三条负面机制只在前 100 层生效，过了 100 层不再恢复（201 层也不恢复）；目前恒为开。
   *  若要按轮关闭，改这里走 cycleLayer，canHaveEnv / canBrandLoss / envChance 三处必须一起对齐。 */
  function layerModsOn(n) { return layerCycle(n) <= LAYER_CYCLE; }
  function envAllowed(n) { return layerModsOn(n); }
  function brandLossAllowed(n) { return layerModsOn(n); }
  function sacrificeAllowed(n) { return layerModsOn(n); }
  /** 纯展示用：轮内层号 ≥ ENV_START_LAYER 才可能抽到环境；101~104 层没有。
   *  真正的抽取判据在 tower.js 的 rollEnvAfterBattle，那边必须比同一个门槛。 */
  function canHaveEnv(n) { return envAllowed(n) && cycleLayer(n) >= ENV_START_LAYER; }
  /** 轮内层号 > 30 且为偶数才可能丢烙印（每 2 层一次）；第 2 轮从 132 起，不是 101。 */
  function canBrandLoss(n) {
    const c = cycleLayer(n);
    return brandLossAllowed(n) && c > BRAND_LOSS_FROM && c % 2 === 0;
  }
  const FOE_STAT_MUL_NOTE = '敏捷 / 速度档';   // 力量另有更低的系数（FOE_POWER_MUL / FOE_*_POWER_MUL）
  function endlessScaleParts(n) {
    const layer = Math.max(1, Math.floor(Number(n) || 1));
    const cycle = cycleLayer(layer), round = Math.floor((layer - 1) / LAYER_CYCLE);
    const level = endlessLevel(cycle), mult = endlessMult(cycle), depth = endlessDepthMul(cycle);
    const firstLevel = endlessLevel(1), lastLevel = endlessLevel(LAYER_CYCLE);
    const firstMult = endlessMult(1) * endlessDepthMul(1);
    const endMult = endlessMult(LAYER_CYCLE) * endlessDepthMul(LAYER_CYCLE);
    const carryStat = Math.pow(ENDLESS_CYCLE_DISCOUNT * GData.stagePlayerStat(lastLevel) * endMult /
      (GData.stagePlayerStat(firstLevel) * firstMult), round);
    const carryHp = Math.pow(ENDLESS_CYCLE_DISCOUNT * GData.stagePlayerHp(lastLevel) * endMult /
      (GData.stagePlayerHp(firstLevel) * firstMult), round);
    const statBase = GData.stagePlayerStat(level) * carryStat, hpBase = GData.stagePlayerHp(level) * carryHp;
    return { layer, cycle, round, level, mult, depth, carryStat, carryHp, statBase, hpBase,
      statCurve: statBase * mult * depth, hpCurve: hpBase * mult * depth,
      power: Math.max(1, Math.round(FOE_POWER_MUL * carryStat * mult * depth)),
      stats: Math.max(1, Math.round(FOE_STAT_MUL * carryStat * mult * depth)) };
  }
  /* 环境词缀是无尽塔唯一的常驻负面机制（原段位机制已并入）；每条数值写成区间，
   * 抽取时随机取值，mods 里的数字是区间上沿。 */
  /* 区间写法：'pct' = 比例（渲染成百分数）、'num' = 裸数值（渲染成点数）。
   * 例：[0.06, 0.12, 'pct'] → 显示 +9%；[18, 32, 'num'] → 显示 +24。 */
  const ENDLESS_ENV = Object.freeze([
    { id: 'thorns', name: '荆棘反伤', bad: true, noReflect: true, mech: true, mods: { thornsPct: [0.06, 0.12, 'pct'] },
      desc: '敌人受到伤害时反弹 %thornsPct%' },
    { id: 'regen', name: '自愈回复', bad: true, noReflect: true, mech: true, mods: { regenPct: [0.02, 0.04, 'pct'] },
      desc: '敌人每回合回复 %regenPct% 最大生命' },
    { id: 'lifesteal', name: '吸血', bad: true, noReflect: true, mech: true, mods: { lifestealPct: [0.20, 0.32, 'pct'] },
      desc: '敌人造成伤害时回复其 %lifestealPct%' },
    { id: 'shell', name: '护盾', bad: true, noReflect: true, mech: true, mods: { shellPct: [0.18, 0.28, 'pct'] },
      desc: '敌人开局自带 %shellPct% 最大生命的护盾' },
    { id: 'devour', name: '吞噬成长', bad: true, noReflect: true, mech: true, mods: { devourPct: [0.015, 0.028, 'pct'] },
      desc: '敌人每回合攻击永久 %devourPct%（按入场力量，可无限叠加）' },
    { id: 'sun', name: '烈日灼烧', bad: true, noReflect: true, mods: { enemyCritBonus: [22, 28, 'num'], selfCritBonus: [8, 12, 'num'] },
      desc: '敌方暴击率 %enemyCritBonus%，我方暴击率 %selfCritBonus%' },
    { id: 'frost', name: '寒霜锁链', bad: true, noReflect: true,
      mods: { enemySpeedMul: [-0.09, -0.05, 'pct'], selfSpeedMul: [-0.19, -0.11, 'pct'] },
      desc: '敌方速度 %enemySpeedMul%，我方速度 %selfSpeedMul%' },
    { id: 'greed', name: '贪婪裂隙', bad: true, noReflect: true,
      /* 挑战塔（mode === 'tower'）没有试炼币经济：那边显示成「厚甲裂隙」，只保留
       * 「敌方生命上限 +」这一档 —— 见 envDefFor() / envText(..., 'tower')。
       * 不改这里的数据：无尽塔照旧吃 %coinBonus%。 */
      towerName: '厚甲裂隙', towerDesc: '敌方生命上限 %enemyMaxHpMul%',
      mods: { coinBonus: [0.35, 0.6, 'pct'], enemyMaxHpMul: [0.10, 0.18, 'pct'] },
      desc: '我方试炼币 %coinBonus%，但敌方生命上限 %enemyMaxHpMul%' },
    { id: 'dusk', name: '血色黄昏', bad: false, mods: { bothLifestealPct: [0.10, 0.18, 'pct'] },
      desc: '双方吸血 %bothLifestealPct%' },
    /* —— 回响类：不改战斗数值，只改「打完这一场之后会发生什么」 ——
     * 幻影回响：**只**在三侠战生效，胜利后有 %repeatChance% 概率立刻再打同一场。
     * 多一份弹性空间 —— 重复的那一场同样计入叠层（战斗续航也会再结算一次开战回血）。 */
    { id: 'echo', name: '幻影回响', bad: false, repeatOnly: true, maxStacks: 1,
      mods: { repeatChance: [0.17, 0.23, 'pct'] },
      desc: '三侠战胜利后有 %repeatChance% 概率立刻再战同一场（每场战斗至多触发一次；重复的战斗同样计入叠层）' },
  ]);
  const ENDLESS_ENV_BY_ID = Object.freeze(ENDLESS_ENV.reduce((m, e) => (m[e.id] = e, m), {}));
  /* 挑战塔没有试炼币经济：收益类环境键在挑战塔一律剔除，词条被剔光的不进抽取池
   * （envPoolFor('tower')）；贪婪裂隙用 towerName/towerDesc 覆盖为厚甲裂隙。 */
  const ENDLESS_REWARD_MOD_KEYS = Object.freeze(['coinBonus']);
  /** 某个模式下这条环境的定义：挑战塔优先用 towerName / towerDesc 覆盖。 */
  function envDefFor(def, mode) {
    if (!def || mode !== 'tower') return def;
    if (!def.towerName && !def.towerDesc) return def;
    const out = Object.assign({}, def);
    if (def.towerName) out.name = def.towerName;
    if (def.towerDesc) out.desc = def.towerDesc;
    out.mods = {};
    for (const [k, v] of Object.entries(def.mods || {})) {
      if (ENDLESS_REWARD_MOD_KEYS.includes(k)) continue;
      out.mods[k] = v;
    }
    return out;
  }
  function envPoolFor(mode) {
    if (mode !== 'tower') return ENDLESS_ENV;
    return ENDLESS_ENV.filter((e) => Object.keys(e.mods || {}).some((k) => !ENDLESS_REWARD_MOD_KEYS.includes(k)));
  }
  /** 「幻影回响」在该层的概率区间：下沿固定 17%，上沿随层数从 17% 抬到 23%
   *  这样「17~23%」这个区间本身就是**随层数展开**的，后期更容易触发。 */
  function repeatChanceInterval(layer) {
    const spec = (ENDLESS_ENV_BY_ID.echo.mods || {}).repeatChance;
    const lo = Array.isArray(spec) ? Number(spec[0]) : Number(spec);
    const hi = Array.isArray(spec) ? Number(spec[1]) : Number(spec);
    const t = Math.max(0, Math.min(1, (Math.max(1, Number(layer) || 1) - 1) / 12));
    return [lo, lo + (hi - lo) * t];
  }
  const ENV_START_LAYER = 5, ENV_TWO_LAYER = 15, ENV_MAX = 2, ENV_DUR = [4, 8];
  function envRange(spec) {
    if (Array.isArray(spec)) return [Number(spec[0]), Number(spec[1])];
    return [Number(spec), Number(spec)];
  }
  function envPctKeys(def) {
    const out = {};
    for (const [key, spec] of Object.entries((def && def.mods) || {})) out[key] = Array.isArray(spec) && spec[2] === 'pct';
    return out;
  }
  function rollEnvMods(def, mode) {
    const d = envDefFor(def, mode);
    const out = {};
    for (const [key, spec] of Object.entries((d && d.mods) || {})) {
      const [lo, hi] = envRange(spec);
      out[key] = lo + Math.random() * (hi - lo);
    }
    return out;
  }
  /** 把一个键的值渲染成可读文本（比例 → 百分数；裸值 → 点数）。 */
  function envValueText(def, key, values) {
    const v = (values && values[key] != null) ? Number(values[key]) : rollEnvMods(def)[key];
    const isPct = envPctKeys(def)[key];
    if (isPct) return (v >= 0 ? '+' : '−') + Math.abs(Math.round(v * 100)) + '%';
    return (v >= 0 ? '+' : '−') + Math.abs(Math.round(v * 10) / 10);
  }
  /** 把模板里的 %key% 用实际值渲染出来 → { text, values, keys }。
   *  mode === 'tower' 时用挑战塔那套名字/说明（例如贪婪裂隙 → 厚甲裂隙，只写敌方生命上限）。 */
  function envText(def, values, mode) {
    const d = envDefFor(def, mode);
    const v = values || rollEnvMods(d);
    /* 「幻影回响」的数值本身就是概率，直接按摇到的值渲染（不用「区间」写法），
     * 免得和别的环境一样显示成「+17%~+23%」。 */

    const keys = [];
    const text = String((d && d.desc) || '').replace(/%([\w]+)%/g, (_, key) => {
      if (!keys.includes(key)) keys.push(key);
      return envValueText(d, key, v);
    });
    return { text: text, values: v, keys: keys };
  }
  /** 区间预览文字（悬停里说明「这条环境的数值范围」）。mode 决定列哪几档（见 envDefFor）。 */
  function envRangeText(def, mode) {
    const d = envDefFor(def, mode);
    const pctKeys = envPctKeys(d);
    return Object.keys((d && d.mods) || {}).map((key) => {
      const [lo, hi] = envRange(d.mods[key]);
      const fmt = pctKeys[key]
        ? (n) => Math.round(n * 100) + '%'
        : (n) => String(Math.round(n * 10) / 10);
      return fmt(lo) + ' ~ ' + fmt(hi);
    }).join('，');
  }
  function envPreviewText(def, mode) {
    const d = envDefFor(def, mode);
    const pctKeys = envPctKeys(d);
    return String((d && d.desc) || '').replace(/%([\w]+)%/g, (_, key) => {
      const spec = (d.mods || {})[key];
      if (!spec) return '';
      const [lo, hi] = envRange(spec);
      const fmt = pctKeys[key]
        ? (n) => Math.round(n * 100) + '%'
        : (n) => String(Math.round(n * 10) / 10);
      return fmt(lo) + '~' + fmt(hi);
    });
  }
  /* 环境词缀的触发曲线：**轮内**第 5 层 20%（= 0.14 + 1×0.06），之后每层 +6%，
   * **轮内**第 15 层到 80% 封顶（0.14 + 11×0.06 = 0.80）。三个数字抽成常量，调平衡只动这里。
   * 注意 15 层同时也是 ENV_TWO_LAYER（每场强制补满 2 条）——两件事同层发生，
   * ⚠ 判据必须是 **轮内层号**（`cycleLayer`）：用绝对层号会让第 101 层直接顶到 80% 封顶
   *（101 − 5 + 1 = 97 层步进），而它在第二轮里其实只是「第 5 层」该拿 20%。 */
  const ENV_CHANCE_START = 0.14;
  const ENV_CHANCE_STEP = 0.06;
  const ENV_CHANCE_CAP = 0.80;
  /** 战斗后触发概率：轮内 5 层 ~20%，之后每层 +6%，轮内第 15 层起封顶 80%。 */
  function envChance(layer) {
    const c = cycleLayer(layer);
    if (c < ENV_START_LAYER) return 0;
    const v = ENV_CHANCE_START + (c - ENV_START_LAYER + 1) * ENV_CHANCE_STEP;
    return Math.min(ENV_CHANCE_CAP, Math.round(v * 1000) / 1000);
  }
  /** 触发概率在第几层封顶（= 15；供界面/测试显示，避免再出现「40 层封顶」的误会）。
   *  用 Math.round 而不是 ceil：浮点算 (0.80−0.14)/0.06 会得到 11.000000000000002。 */
  const ENV_CHANCE_CAP_LAYER = ENV_START_LAYER - 1 + Math.round((ENV_CHANCE_CAP - ENV_CHANCE_START) / ENV_CHANCE_STEP);
  const ENDLESS_CONSOLATION_LAYER = 15;  // 到达 15 层后失败送 1 次免费抽奖（每日限 1 次）

  /* 计分：战斗结果 + 获取增益（按稀有度）+ 隐藏成就（死而复生 / 超凡入圣）。 */
  const SCORE = Object.freeze({
    battle: 25, layer: 100, elite: 50,
    buffByRarity: [5, 10, 20, 40],
    reviveTiers: [
      { at: 3, points: 30 },
      { at: 6, points: 45 },
      { at: 9, points: 60 },
      { at: 12, points: 90 },
    ],
    /* 隐藏成就「超凡入圣」：某项 buff 加成首次跨过这些阈值时各给一次分。 */
    statMilestones: [
      { at: 1.00, points: 100 },
      { at: 1.50, points: 150 },
      { at: 2.00, points: 220 },
      { at: 3.00, points: 300 },
    ],
  });
  function buffScore(rarity) {
    const list = SCORE.buffByRarity;
    return list[Math.max(0, Math.min(list.length - 1, Math.floor(Number(rarity) || 0)))];
  }
  function reviveScoreAt(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const hit = SCORE.reviveTiers.filter((t) => n >= t.at);
    return hit.length ? hit[hit.length - 1].points : 0;
  }

  const COIN_BATTLE_TIERS = Object.freeze([
    Object.freeze({ min: 1, max: 5, base: 5 }),
    Object.freeze({ min: 6, max: 10, base: 6 }),
    Object.freeze({ min: 11, max: 15, base: 7 }),
    Object.freeze({ min: 16, max: Infinity, base: 8 }),
  ]);
  function coinBattleTier(layer) {
    const n = Math.max(1, Math.floor(Number(layer) || 1));
    const hit = COIN_BATTLE_TIERS.filter((t) => n >= t.min && n <= t.max)[0];
    return hit || COIN_BATTLE_TIERS[COIN_BATTLE_TIERS.length - 1];
  }
  function coinBattleBase(layer) { return coinBattleTier(layer).base; }
  function coinBattleTierLabel(layer) {
    const t = coinBattleTier(layer);
    return t.max === Infinity ? ('第 ' + t.min + ' 层起') : ('第 ' + t.min + '-' + t.max + ' 层');
  }
  function coinBattleTableText() {
    return COIN_BATTLE_TIERS.map((t) => ((t.max === Infinity ? (t.min + ' 层起') : (t.min + '-' + t.max + ' 层')) + ' ' + t.base)).join(' / ');
  }
  const COINS = Object.freeze({ battle: 8, layer: 20, eliteMul: 2.5 });
  /* 巡逻：41 层起每 10 层区块恰好一场（x0 三连战、x5 精英台阶，均跳过），替换该场并算精英 + boss；
   * 区块内哪层出由 (区块, salt) 决定，同层固定 → 预告 = 实战。敌人复制玩家面板与全部武器/技能；
   * 输不走失败结算，改为上交一件藏品；赢则传奇三选一 + 试炼币 ×winCoinMul。 */
  /* 现代引擎的「橘色狂战甲」：手导素材（原版穿戴图层 113 → images/battle/outfit/<部位>_113_1.png），
   * ⚠ 这里的顺序是 **engine 的槽位顺序** [Head, HandO, Body, Foot, HandI, Arm]，
   * 不是部位中文名的顺序 —— `wearsFor()` 对 `{src,label}` 形态是**按下标落槽**的
   * 必须是 `{src,label}` 对象：裸字符串会被 `wearsFor` 当成装备 id 去查 gearMap（`Number('Head_113_1')` = NaN），
   * 结果整条被丢掉 —— 之前魔王就是因此**一件都没穿上**。 */
  const PATROL_OUTFIT = Object.freeze([
    { src: 'Head_113_1', label: '0' },      // 槽 0 ← 动画标签 '-1'
    { src: 'HandO_113_1', label: '0' },     // 槽 1 ← '4'
    { src: 'Body_113_1', label: '0' },      // 槽 2 ← '5'
    { src: 'Foot_113_1', label: '0' },      // 槽 3 ← '1'
    { src: 'HandI_113_1', label: '0' },     // 槽 4 ← '3'
    { src: 'Arm_113_1', label: '0' },       // 槽 5 ← '6'
  ]);
  const PATROL = Object.freeze({
    fromLayer: 41,            // 40 层之后才可能出现
    every: 10,                // 每 10 层必出一场
    skipMods: [0, 5],         // x0 / x5 层不触发
    name: '镜',         // 固定名字（与三侠/精英的命名风格区分开；2026-10 第七十八批由「魔王·蚀影」改名）
    /* 整百层（100/200/300…）那一场是「**觐见魔王**」三连战的终点 —— 那一战里他的名字带前缀
     * （用户口径 2026-10：100 层及 100 的整数倍层显示「魔王·镜」），**其它地方一律不变**
     *（路上偶遇的巡逻照样只叫「镜」）。取名统一走 patrolName，别在各处拼字符串。 */
    kingPrefix: '魔王·',
    outfit: PATROL_OUTFIT,
    /* **经典界面**的魔王穿的是「黑色狂战套」—— 60 级狂战四件（容器帧 119，黑甲/黑盔），
     * 和上面 outfit 的橘色 113 图层是两套素材：113 只有 Engine 图集，
     * ⚠ 181~184 不在原版客户端 gearMap 里（State.gearPart 返回 -1），所以 type 必须显式带上；
     * 预告卡与经典战斗共用它（战斗里当 `foe.gears` 贴到 4846 的挂点上）。 */
    classicGear: Object.freeze([
      { id: 181, type: 0 },   // 黑狂战头盔（容器帧 119）
      { id: 182, type: 1 },   // 黑狂战拳甲
      { id: 183, type: 2 },   // 黑狂战铠甲
      { id: 184, type: 3 },   // 黑狂战短靴
    ]),
    /* 魔王身上那套狂战甲的**套装收益**按哪个家族算（`State.setBonusEffects` 的入口）。
     * 家族在 SET_BONUS_FAMILY_FLOOR 里有品质下限 4（橙档系数），
     * 所以黑/橘狂战在数值上都按橙装算，与外观无关。 */
    setKey: 'berserk',
    toolLevel: 15,            // 全部武器 / 技能：真5（15 级）
    winCoinMul: 5,            // 胜利：试炼币 ×5
    x00Battles: 3,            // x0 层固定三连战（两场 x10 boss + 一场魔王）
    /* x00 那只「最后的魔王」额外固定持有：
     *   · **两件涅槃plus**：一条命 = 死亡时回复 100% 生命上限，并**当场**生命上限 +20%、受到伤害 −15%；
     *     第二件触发时这两项**叠加**（上限 +40%、减伤 30%）。
     *   · **两件已破碎的终焉烙印**：终乘 ×(1 + 0.30×2) = **×1.6**（力/敏/速/生命上限），
     * 只作用于 x00（寻常巡逻层那只不额外持有）。 */
    bossLives: 2,             // 涅槃plus 件数（x00 最后的魔王）
    bossLifeHealPct: 1.00,    // 每条命触发时回复的生命上限比例（100%）
    bossLifeMaxHpMul: 0.20,   // 每条命触发时生命上限 +20%（可叠加）
    bossLifeTakenMul: -0.15,  // 每条命触发时受到伤害 −15%（可叠加）
    /* 【2026-10】寻常「巡视」层那只魔王也加强为两条命：
     * 本体 + 1 条命；第二条命只回 75% 生命上限，不叠 x00 的 +20% 上限 / 减伤。 */
    patrolLives: 1,
    patrolLifeHealPct: 0.75,
    bossBrokenBrands: 2,      // 已破碎的终焉烙印件数（只给 x00）
    bossBrokenFinal: 0.30,    // 每件的终乘（两件 → ×1.6）
  });
  const BLADE = Object.freeze({
    ids: Object.freeze(['HB01', 'HB02', 'HB03', 'HB04', 'HB05']),
    stages: Object.freeze(['HB01', 'HB02', 'HB03']),
    initialId: 'HB01',
    finalId: 'HB04',
    deadId: 'HB05',
    idleLimit: 20,           // 闲置多少场后强制苏醒
    enhanceUses: 3,          // 增强活性一次消耗几场使用次数
    starveUses: 1,           // 没有合格祭品时，剑自动吞噬几场使用次数（不再弹窗卡住）
    eventStart: 51,          // 第一次活性事件的层号
    eventEvery: 10,          // 之后每 10 层必定一次
    maxStacks: 5,            // 献祭成长上限
    sacrificeRarity: 2,      // 限次祭品的最低稀有度（史诗）
    finalUses: -1,           // -1 = 永续（不再扣次数 / 不需要献祭）
    mirrorPowerCut: 0.15,    // 王者之剑对镜之魔王：×1 层的力量削减
    mirrorPowerCutMax: 0.20, // ×5 层（满成长）的力量削减，中间层线性
    mirrorHpCut: 0.20,       // 王者之剑对镜之魔王：×1 层的生命上限削减
    mirrorHpCutMax: 0.30,    // ×5 层（满成长）的生命上限削减，中间层线性
  });
  function isBladeId(id) { return BLADE.ids.indexOf(String(id)) >= 0; }
  function isBladeBuff(b) { return !!(b && isBladeId(b.id)); }
  function bladeStageOf(id) {
    const at = BLADE.ids.indexOf(String(id));
    return at < 0 ? 0 : at + 1;
  }
  /** 某一阶段的下一个 id；没有下一阶段（王者 / 涸血）返回 null。 */
  function bladeNextId(id) {
    const at = BLADE.stages.indexOf(String(id));
    return at >= 0 && at + 1 < BLADE.stages.length ? BLADE.stages[at + 1] : BLADE.finalId;
  }
  function bladeEventLayer(layer) {
    const n = Math.floor(Number(layer) || 0);
    return n >= BLADE.eventStart && (n - BLADE.eventStart) % BLADE.eventEvery === 0;
  }
  /** 「巡逻 / 觐见魔王」的显示名：**整百层**（100/200/300…）带「魔王·」前缀，其余层不变。
   *  免得「预告是一个名字、打起来是另一个名字」。 */
  function patrolName(layer) {
    const n = Math.floor(Number(layer) || 0);
    const base = PATROL.name;
    return (n > 0 && n % LAYER_CYCLE === 0) ? ((PATROL.kingPrefix || '') + base) : base;
  }
  function patrolLayerInBlock(block, salt) {
    const mods = [1, 2, 3, 4, 6, 7, 8, 9];       // 第 block*10 + mod 层（跳过 x0 / x5）
    const b = Math.floor(Number(block) || 0);
    const seed = (b * 7919 + Math.floor(Number(salt) || 0) * 104729) % 1000003;
    return b * 10 + mods[Math.abs(seed) % mods.length];
  }
  function isPatrolLayer(layer, salt) {
    const L = cycleLayer(layer);
    if (L < PATROL.fromLayer) return false;
    if (L % 10 === 0) return false;
    if (PATROL.skipMods.indexOf(L % 10) >= 0) return false;
    return L === patrolLayerInBlock(Math.floor(L / 10), salt);
  }
  /* 结算离场时「铸币 → 抽奖卷」的兑换上限：
   * 最多 10 枚铸币按 1:1 换成抽奖卷，**超出的部分不再转化**（铸币本身随本局作废）。 */
  const TICKET_FROM_MINT_CAP = 10;
  const ENDLESS_X00_BONUS_TICKETS = 10;
  const SHOP_PRICE_OFFSET = 3;
  function rollShopPrice(base) {
    const b = Math.max(1, Number(base) || 1);
    const k = Math.floor(Math.random() * (SHOP_PRICE_OFFSET * 2 + 1)) - SHOP_PRICE_OFFSET;   // -3..+3
    return Math.max(1, b + k);
  }
  const SHOP = Object.freeze({
    slots: 5,
    price: [30, 60, 100, 160],     // 普通/稀有/史诗/传奇
    crossLayerMul: 1.3,            // 跨层类 ×1.3 → 40/80/130
    sellBack: 0.4,                 // 永久件回收 40%
    permanentPriceMul: 1.1,
    sellBackLimited: 0.3,
    retryPrice: 50,                // 铸币（内部字段 retryToken / retryPrice）：失败后回滚到本场开始前
    rerollPrice: 10,               // 第一次付费刷新的价格（之后每次 +rerollGrowth）
    rerollGrowth: 10,              // 涨价步长：10 → 20 → 30 → 40 → 50 → 60 → 70
    rerollMax: 70,                 // 第一段封顶价（爬到这里之后进入「档位」节奏）
    /* 2026-10 用户口径：**越过 70 之后不再封顶** —— 70 档刷新 10 次 → 80，80 档 10 次 → 90，以此类推。
     * 也就是「每 plateau 次涨价一个 growth」。质量（稀有度倾斜）仍在 rerollTiltCap=50 那档封顶。 */
    rerollPlateau: 10,
    /* 稀有度倾斜的封顶档（2026-10 新增）：**付超过 50 币也不会再提高下一页的稀有度** ——
     * 时来运转（E12）的提速同样受这条限制：它让钱更值钱，但买不到超过 50 的那一档。 */
    rerollTiltCap: 50,
    rerollTiltGrowth: 1.20,
  });
  function shopPrice(buff) {
    const p = SHOP.price[buff.rarity];
    return buff.scope === 'run' ? Math.round(p * SHOP.crossLayerMul / 10) * 10 : p;
  }
  function shopBuyPrice(buff) {
    const base = shopPrice(buff);
    if (!buff || buff.kind !== 'permanent') return base;
    return Math.max(1, Math.round(base * SHOP.permanentPriceMul));
  }
  /* 铸币商店：5 层后 x2~x4 / x7~x9 层每场战后 5% 刷出，同一连续三层组最多一次。
   * 首格固定 0 铸币「等价交换」，免费刷新一次后按 swapChance 洗入；成交后立刻消失。
   * 售价固定按稀有度（0/1/2/3 铸币），不吃 E01/E04 折扣。 */
  const MINT_SHOP = Object.freeze({
    chance: 0.05,            // 每场战斗结束后的刷出概率（基准）
    /* 概率随深度增长：**每 5 层（每一段）+0.5 个百分点**，最高 10%（见 mintChance）。
     * 第 2 段（6~10 层）5.5% → …… → 第 11 段（51 层起）触及 10% 封顶。 */
    chanceStep: 0.005,
    chanceMax: 0.10,
    minLayer: 6,             // 「5 层之后」→ 第 6 层起
    shelf: 5,                // 货架件数
    price: [0, 1, 2, 3],     // 普通/稀有/史诗/传奇 → 铸币
    /* 「等价交换」只出现在铸币商店：初始进店固定第一格；免费刷新后按这个概率
     * 随机替换其中一格（位置随机，不再固定首位），货架件数仍是 shelf。 */
    swapChance: 0.25,
    tiltPaid: 40,            // 稀有度基数：等价于试炼商店刷了 40 试炼币的倾斜
    commonWeightMul: 0.4,    // 普通档权重再下调一档
    opsChance: 0.8,          // 「大概率」上架运营类（传奇不受此限）
    swapOpsChance: 0.8,      // 免费交换：「大概率」换成同稀有度运营类
    swapCommonUp: 0.5,       // 普通件交换时有 50% 升成稀有件
    swapCommonUpRarity: 1,
  });
  /** 铸币商店在**这一层**的刷出概率：5% 起步，每 5 层 +0.5%，10% 封顶。
   *  纯函数（供界面提示与测试直接核对曲线）。 */
  function mintChance(layer) {
    const steps = Math.max(0, endlessSegment(layer) - 1);
    const base = Math.max(0, Number(MINT_SHOP.chance) || 0);
    const step = Math.max(0, Number(MINT_SHOP.chanceStep) || 0);
    const max = Math.max(base, Number(MINT_SHOP.chanceMax) || base);
    /* 归一到千分位：0.05 + 2×0.005 这种浮点累加会得到 0.060000000000000005，
     * 概率本身无所谓，但界面文案与测试都希望拿到干净的 0.06。 */
    return Math.round(Math.min(max, base + steps * step) * 1000) / 1000;
  }
  function mintLayerOk(layer) {
    const n = Math.floor(Number(layer) || 0);
    if (n < MINT_SHOP.minLayer) return false;
    const mod = n % 5;
    return mod === 2 || mod === 3 || mod === 4;      // x2/x3/x4 与 x7/x8/x9
  }
  function mintGroupOf(layer) {
    const n = Math.max(1, Math.floor(Number(layer) || 1));
    return Math.floor((n - 2) / 5);
  }
  function mintPrice(buff) {
    const last = MINT_SHOP.price.length - 1;
    const r = Math.max(0, Math.min(last, Math.floor(Number(buff && buff.rarity) || 0)));
    return MINT_SHOP.price[r];
  }
  /** 铸币商店货架的稀有度权重：试炼商店「花 40 币刷新」的排布，再把普通档压一档。
   *  这里**不乘**时来运转（E12）的加速 —— 那是试炼商店刷新的机制，铸币商店不花试炼币。 */
  function mintWeights(run) {
    const w = tiltWeights(rerollTilt(MINT_SHOP.tiltPaid), run).slice();
    w[0] *= Math.max(0, Number(MINT_SHOP.commonWeightMul) || 0);
    const total = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((v) => v / total);
  }
  /** 摇一个货架稀有度（权重见 mintWeights）。
   *  ⚠️ 已不是铸币商店的实际抽取路径：`rollMintSlots` 现在用 `mintWeights` 作为基准，
   *  再叠 `dynamicTierWeights`（个体降权会缩小整档预算）。这里仅保留导出给界面/测试做预览。 */
  function rollMintRarity(run) {
    const w = mintWeights(run);
    const total = w.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * total;
    for (let i = 0; i < w.length; i++) { if (r < w[i]) return i; r -= w[i]; }
    return 0;
  }

  /**
   * 第 count 次付（含免费那次）的刷新价：
   *   · 到 70 之后进入**档位节奏**：70 用 plateau(10) 次 → 80 用 10 次 → 90 用 10 次 → …（无上限）
   */
  function rerollPriceAt(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n <= 0) return 0;                                   // 首次免费
    const step = Math.max(0, Number(SHOP.rerollGrowth) || 10);
    const base = Math.max(0, Number(SHOP.rerollPrice) || 10);
    const max = Math.max(0, Number(SHOP.rerollMax) || 0);
    const raw = base + step * (n - 1);
    if (!max || raw <= max) return Math.round(raw);         // 还没爬到第一段封顶
    const plateau = Math.max(1, Math.floor(Number(SHOP.rerollPlateau) || 10));
    const firstMaxed = Math.max(1, Math.round((max - base) / step) + 1);
    const over = n - firstMaxed;                            // 0 起：70 档里的第 over+1 次
    return Math.round(max + step * Math.floor(over / plateau));
  }
  function rerollPriceCapped(count) {
    void count;
    return false;
  }
  /** 刷新**收益**（稀有度倾斜）是否已经封顶：付到 rerollTiltCap 那一档之后期望不再变好。 */
  function rerollQualityCapped(count) {
    const cap = Math.max(0, Number(SHOP.rerollTiltCap) || 0);
    if (!cap) return false;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const paid = Math.max(0, n - 1) * Math.max(0, Number(SHOP.rerollGrowth) || 10);
    return paid >= cap;
  }
  /* 刷新质量只做稀有度倾斜：权重按 w_i × p^i 归一化，每 10 币 p ×1.25；
   * 不做保底替换，避免货架结构突变。 */
  /** 即时类增益本局已获得几次（即时类不进 permanent/limited，另记在 run.instantIds 上）。
   *  与 tower.js 的 instantOwnedCount 同一口径（这里自己读一份，避免模块反向依赖）。 */
  function instantOwned(run, id) {
    if (!run) return 0;
    let n = 0;
    for (const row of run.instantIds || []) if (row && row.id === id) n += Math.max(1, Math.floor(Number(row.count) || 1));
    return n;
  }
  /** 「每 10 试炼币」的倾斜速度倍率：时来运转（E12）每持有一层就把这个速度 ×mods.rerollTiltMul。
   *  只作用于**商店刷新**（rollShopSlots / rerollExpectation）；场间三选一的倾斜不受影响。 */
  function tiltRateMul(run) {
    const n = instantOwned(run, 'E12');
    if (!n) return 1;
    const mul = Math.max(1, Number((BUFF_BY_ID.E12.mods || {}).rerollTiltMul) || 2);
    return 1 + (mul - 1) * n;
  }
  /** 倾斜系数：花了 paid 币之后的 p。
   *  **有效金额在 SHOP.rerollTiltCap 封顶**（默认为 50）：价格可以涨到 70，但稀有度只到 50 那一档。 */
  function rerollTilt(paid, run) {
    const cap = Math.max(0, Number(SHOP.rerollTiltCap) || 0);
    const raw = Math.max(0, Number(paid) || 0) * tiltRateMul(run);
    const money = cap > 0 ? Math.min(cap, raw) : raw;
    const g = Math.max(1, Number(SHOP.rerollTiltGrowth) || 1.25);
    return Math.pow(g, money / 10);
  }
  /* 传奇基础权重：战斗掉落池 2.0（自然约 2%/格），试炼/铸币商店仍 2.2；
   * 两池共用 rollOneCandidate 与传奇保底，只有档位预算基准不同。 */
  const LEGEND_BASE_WEIGHT = 2.2;
  const LEGEND_BATTLE_WEIGHT = 2.0;
  const LEGEND_HOLD_PENALTY = 0.12;      // 每已拥有一条传奇，再乘 0.88
  const LEGEND_ALL_OWNED_PENALTY = 0.35; // 所有传奇都拿到手后，再乘 0.35
  function legendOwnedCount(run) {
    if (!run) return 0;
    const ids = new Set();
    /* 剧情件（照影之境）不是构筑的一部分，不能因为它 rarity=3 就把商店传奇权重压下去：
     * 第 101/201… 层的货架权重必须与第 1 层一致。 */
    const story = (id) => { const def = BUFF_BY_ID[id]; return !!(def && hasTag(def, 'story')); };
    for (const b of run.permanent || []) if (b && b.id && !story(b.id)) ids.add(b.id);
    for (const b of run.limited || []) if (b && b.id && !story(b.id)) ids.add(b.id);
    for (const id of run.permSlotIds || []) ids.add(id);
    for (const id of run.pickBuffIds || []) ids.add(id);
    for (const row of run.instantIds || []) if (row && row.id) ids.add(row.id);
    let n = 0;
    for (const id of ids) { const def = BUFF_BY_ID[id]; if (def && def.rarity === 3) n++; }
    return n;
  }
  function allRepeatableLegendsOwned(run) {
    if (!run) return false;
    const own = new Set();
    for (const b of run.permanent || []) if (b && b.id) own.add(b.id);
    for (const b of run.limited || []) if (b && b.id) own.add(b.id);
    for (const id of run.permSlotIds || []) own.add(id);
    for (const row of run.instantIds || []) if (row && row.id) own.add(row.id);
    const need = BUFFS.filter((b) => b.rarity === 3 && hasTag(b, 'repeatable'));
    return need.length > 0 && need.every((b) => own.has(b.id));
  }
  const LEGEND_TIER_DECAY = false;
  function legendWeightFactor(run) {
    if (!LEGEND_TIER_DECAY) return 1;
    const owned = legendOwnedCount(run);
    let f = Math.pow(1 - LEGEND_HOLD_PENALTY, owned);
    if (allRepeatableLegendsOwned(run)) f *= LEGEND_ALL_OWNED_PENALTY;
    return f;
  }
  function rarityBoostOf(run) {
    const n = Math.max(0, Math.floor(Number(run && run.rarityBoost) || 0));
    if (!n) return { common: 1, epic: 1, legend: 1 };
    const m = BUFF_BY_ID.C51.mods;
    return {
      common: Math.pow(Number(m.commonMul) || 0.5, n),
      epic: Math.pow(Number(m.epicMul) || 2, n),
      legend: Math.pow(Number(m.legendMul) || 2, n),
    };
  }
  /** 档位**原始**权重（未归一化）：基础表 ×（传奇两档下调 / 天命所归）× 刷新倾斜 p^i。
   *  归一化只是显示口径；真正抽取时会在「动态档位权重」里再缩放并按全局归一化，
   *  所以这里保留原值，便于直接看出每一档的预算。 */
  function rawTierWeights(tilt, run, options) {
    const p = Math.max(0, Number(tilt) || 1);
    const boost = rarityBoostOf(run);
    const legendBase = Math.max(0, Number(options && options.legendBase) || LEGEND_BASE_WEIGHT);
    const legendMul = (legendBase / RARITY_WEIGHTS[3]) * legendWeightFactor(run) * boost.legend;
    const slotMul = (i) => (i === 0 ? boost.common : i === 2 ? boost.epic : 1);
    return RARITY_WEIGHTS.map((v, i) => (i === 3 ? v * legendMul : v * slotMul(i)) * Math.pow(p, i));
  }
  /** 战斗奖励三选一的档位预算：与商店同构，传奇基础权重为 2.0（约 2% 出率）。 */
  function battleTierWeights(tilt, run) {
    return rawTierWeights(tilt, run, { legendBase: LEGEND_BATTLE_WEIGHT });
  }
  function tiltWeights(tilt, run) {
    const w = rawTierWeights(tilt, run);
    const total = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((v) => v / total);
  }
  /* 稀有度与个体权重合并为一次全局加权抽取：单件权重 = base[r] × m_b / |可用(r)|，
   * TIER_AVG_INCLUDES_STATIC=false 时只有随状态变化的权重参与档位缩放（新局分布与旧版一致）。 */
  const TIER_DYNAMIC_WEIGHTS = true;
  const TIER_AVG_INCLUDES_STATIC = false;
  const LEGEND_PITY = Object.freeze({ slots: 120 });
  /** 这一次刷新「本来」与「倾斜后」的期望稀有度 / 史诗件数（界面与测试都用它）。
   *  `slots` 可省：省略时按基础货架件数（SHOP.slots）算。**第 41 层起货架只有 3 件**，
   *  否则「本次期望史诗 N 件」会比货架本身还大。 */
  function rerollExpectation(paid, run, slotsArg) {
    const slots = Math.max(1, Math.floor(Number(slotsArg) || (SHOP && SHOP.slots) || 5));
    const mean = (w) => w.reduce((a, v, i) => a + v * i, 0);
    const base = tiltWeights(1, run), tilted = tiltWeights(rerollTilt(paid, run), run);
    const epics = (w) => w.reduce((a, v, i) => a + v * (i >= 2 ? 1 : 0), 0) * slots;
    return {
      paid: Math.max(0, Number(paid) || 0),
      tilt: +rerollTilt(paid, run).toFixed(4),
      tiltRateMul: +tiltRateMul(run).toFixed(2),
      weights: tilted.map((v) => +v.toFixed(4)),
      meanRarity: +mean(tilted).toFixed(4),
      baseMeanRarity: +mean(base).toFixed(4),
      epics: +epics(tilted).toFixed(3),
      baseEpics: +epics(base).toFixed(3),
      extraEpics: +(epics(tilted) - epics(base)).toFixed(3),
    };
  }
  /* 货架质量分：传奇权重加倍。
   * 不能直接用「平均稀有度」—— 那会把「1 传奇(=3)」和「1.5 史诗(=3)」算成等值，
   * 但传奇的自然掉率只有 3%、史诗 10%，1 件传奇远比同点数的史诗珍贵。
   * 权重 [0,1,2,4] 更贴近玩家的实际感受，也用来做「越贵越好」的验收口径。 */
  const RARITY_SCORE = [0, 1, 2, 4];
  function shopQualityScore(slots) {
    const list = Array.isArray(slots) ? slots : [];
    if (!list.length) return 0;
    return list.reduce((a, s) => {
      const r = s && s.rarity != null ? Number(s.rarity) : Number((BUFF_BY_ID[s && s.id] || {}).rarity) || 0;
      return a + (RARITY_SCORE[r] || 0);
    }, 0) / list.length;
  }



  const FOE_STAT_MUL = 0.66;    // 敏捷/速度基准（原值）
  const FOE_POWER_MUL = 0.47;
  const FOE_HP_MUL = 1.06;      // 血量基准：0.85 × 1.25，血量更厚
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
  function endlessBossHpRatio(biasHp, n) {
    const layer = Math.max(1, Math.floor(Number(n) || 1));
    const round = Math.floor((layer - 1) / LAYER_CYCLE);
    const carry = Math.pow(bossHpRatio(biasHp, LAYER_CYCLE) / bossHpRatio(biasHp, 1), round);
    return bossHpRatio(biasHp, cycleLayer(layer)) * carry;
  }
  /* 三侠的「输出」压一档：三侠的攻击基准是 STAGE_TYPE_SCALE（螳螂 1.15／仙鹤 0.92／熊猫 1.02）
   * × FOE_POWER_MUL，本来就比 boss 高；现在血量和 boss 差不多，输出必须压下来，
   * 否则前三场又变成「把人打残的血墙」。boss 的输出高一大档（FOE_TRIAL_POWER_MUL），
   * 所以「最后一战最难」靠的是伤害与机制，不是血量堆。 */
  const FOE_HERO_POWER_MUL = 0.60;
  /* 仙鹤后期收敛：只作用于无尽塔的三侠仙鹤，挑战塔/关卡仍走原公式。
   * 轮内 31~50 层把技能倍率/前期凶猛线性降到 50 层与熊猫持平，50~100 保持；101 层起按
   * 该层实际技能等级重新解 F。不要换成 layerCycle —— 101/201 会回到 1 再次超模。 */
  const XH_ENDLESS_TUNE = Object.freeze({
    from: 30, to: 50, earlyFrom: 1.3, early: 1.0,
  });
  /** 按技能等级解出“仙鹤期望 DPA = 熊猫”的技能伤害倍率（不含开场 1.3）。 */
  function xhEndlessParityFactor(skillLevel) {
    const lv = Math.max(1, Math.min(15, Number(skillLevel) || 1));
    const xhScale = Number(GData.STAGE_TYPE_SCALE.xh) || 0.92;
    const xmScale = Number(GData.STAGE_TYPE_SCALE.xm) || 1.02;
    const normalRatio = xhScale / xmScale;                 // XH 普攻 / XM 普攻
    const speedPerPower = FOE_STAT_MUL / (FOE_POWER_MUL * FOE_HERO_POWER_MUL);
    const xhSkill = normalRatio * (1 + 0.35 * speedPerPower) * (0.9 + 0.1 * lv);
    const xmSkill = 1.3 + 0.1 * lv;
    const target = 0.7 + 0.3 * xmSkill;
    const base = 0.7 * normalRatio;
    return Math.max(0, Math.min(1, (target - base) / (0.3 * xhSkill)));
  }
  /** 返回无尽塔仙鹤在这一绝对层的 { skill, early } 倍率；非无尽模式不调用。 */
  function endlessXhTune(layer) {
    const n = Math.max(1, Math.floor(Number(layer) || 1));
    if (n <= XH_ENDLESS_TUNE.from) return { skill: 1, early: XH_ENDLESS_TUNE.earlyFrom };
    const endSkill = xhEndlessParityFactor(15);             // 50~100 层技能都是 15 级
    if (n < XH_ENDLESS_TUNE.to) {
      const t = (n - XH_ENDLESS_TUNE.from) / (XH_ENDLESS_TUNE.to - XH_ENDLESS_TUNE.from);
      return {
        skill: 1 + (endSkill - 1) * t,
        early: XH_ENDLESS_TUNE.earlyFrom + (XH_ENDLESS_TUNE.early - XH_ENDLESS_TUNE.earlyFrom) * t,
      };
    }
    if (n <= 100) return { skill: endSkill, early: XH_ENDLESS_TUNE.early };
    const lv = Math.max(1, Math.min(15, Math.round((endlessScaleParts(n).level || 1) / 5)));
    return { skill: xhEndlessParityFactor(lv), early: XH_ENDLESS_TUNE.early };
  }

  /* boss 的输出：血量只比三侠厚一点点（见 bossHpRatio），所以「最后一战最难」全靠伤害与机制 ——
   * 0.47 × 1.45 ≈ 0.68，约是三侠（0.47 × 0.60 × 0.92~1.15 ≈ 0.26~0.32）的 2~2.6 倍。 */
  const FOE_TRIAL_POWER_MUL = 1.45;
  /* x10 第 5 场的狂战松鼠：血量走 WARLORD_HP_RATIO，力量再压一点点（它还吃精英 ×1.2 的伤害）。 */
  const FOE_WARLORD_POWER_MUL = 0.85;
  /* x0 的征战动物 boss：它是 x0 最后一战，必须**明确强于倒数第二战的随机狂战松鼠**。
   * 打起来更短、更痛——按用户口径「降血、提攻」，不再做拖时间的血墙。 */
  const FOE_CAMPAIGN_POWER_MUL = 1.45;
  const CAMPAIGN_HP_RATIO = 1.10;



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



  /* 前三场打的是三侠。他们的招牌技一旦**真的打到玩家**（被闪避 / 弹反 / 装死挡掉、
   * 或被护盾全吸收的那次不算），就会给玩家留下一层**打到本层结束**都一直在的削弱；
   * 进第 4 场前选 buff 时必须把这些削弱算进去。
   * 2026-10 调整：**削弱按「实际命中的大招次数」累加，且数值带随机浮动、各有本层上限**：
   * （大招每场只放一次，所以同一位大侠在一层里命中几次，取决于幻影回响 / 时间回廊这类「再打一场」。） */
  const HERO_DEBUFF = Object.freeze({
    tl: { anim: 'tl', hero: '螳螂', ult: '疾风镰刀舞', kind: 'maxHp', name: '重伤',
      pctRange: [0.03, 0.06], capPct: 0.15,
      desc: '大招命中：生命上限 −3%~6%（本层累计最多 −15%）' },
    xh: { anim: 'xh', hero: '仙鹤', ult: '仙鹤展翅', kind: 'stat', name: '战吼',
      pctRange: [0.05, 0.10], maxTimes: 3,
      desc: '大招命中：随机一项属性 −5%~10%（本层最多 3 次）' },
    xm: { anim: 'xm', hero: '熊猫', ult: '熊掌震地', kind: 'lock', name: '压制', maxTimes: 2,
      desc: '大招命中：随机锁住一个武器或技能（本层最多 2 个）' },
  });



  /* 每个松鼠形态的 boss 都穿一套**固定且互不相同**的装备：玩家不用读文字，
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
  function wearsOf(key) { return (GEAR[key] || []).map((id) => ({ id })); }
  /* ---------- 第 C 项：套装分层 & 随层升级 ----------
   * 无尽塔按轮内层数加权抽 boss：低层更常出低档，高档 boss 仍可能以低概率出现（保留随机性）；
   * 正常 boss 保留自己的套装，让图鉴上的「装备稀有度」与实战外观一致。 */
  const GEAR_TIER = Object.freeze({ ninja1: 0, knight: 1, rhino: 1, curse: 1,
    shogun: 2, hero: 2, ninja3: 3, fist3: 3, grappler3: 3, curse3: 3, berserk: 4 });
  const GEAR_KEYS = Object.freeze(Object.keys(GEAR_TIER));
  /** 某层允许出现的**兜底**套装档位上限（越深越好）。只在 boss 自带套装是狂战/未知、
   *  按**轮内层号**算，所以第 101 层又回到第 1 层的低档位。 */
  function gearTierCap(layer) {
    const c = cycleLayer(layer);
    if (c <= 3) return 1;      // 1~3 层：最低级 / 次一级（都 < 蓝装）
    if (c <= 9) return 2;      // 4~9 层：开始出现蓝装
    if (c <= 19) return 3;     // 10~19 层：蓝紫混搭
    return 3;                  // 20+ 层：以紫装为主（狂战仍然只给 10 的倍数层）
  }
  /** 按层决定实际穿戴的套装：10 的倍数层固定狂战，其它层永不出现狂战。
   *  正常 boss 保留自己的套装（稀有度要能看见）；只有狂战/未知才按轮内层号另挑，
   *  且**轮内第 51 层起不再挑最低档**（与 boss 池的稀有度门槛一致）。 */
  function gearKeyForLayer(layer, baseKey) {
    const L = Math.max(1, Math.floor(Number(layer) || 1));
    if (L % 10 === 0) return 'berserk';
    const c = cycleLayer(L);
    const minTier = c > 50 ? 1 : 0;
    const baseTier = GEAR_TIER[baseKey];
    if (baseKey && baseTier != null && baseTier !== 4 && baseTier >= minTier) return baseKey;
    const cap = gearTierCap(L);
    const pool = GEAR_KEYS.filter((k) => {
      const t = GEAR_TIER[k];
      return t !== 4 && t <= cap && t >= minTier;
    });
    if (!pool.length) return baseKey || 'ninja1';
    const h = poolHash('gear#' + L);
    return pool[h % pool.length];
  }



  /* 和小松鼠同族：战斗里用玩家那套松鼠贴图（镜像朝左，tower.js 不给 npcType 即自动生效），
   * 武器与技能都取自松鼠本来的池子（GameDict 的 weaponsMap / skillsMap）。
   *   pattern 的每一项 = 一次行动的意图：'common' 普攻 / 'weapon' 用武器 / 'skill' 放技能；
   *   某一项这回合用不了（被缴械 / 沉默 / 没主动技能）就顺延到下一个能用的。
   * 每个模板只带 1 个主动技能，所以「放技能」这一步也是确定的。
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
      weapons: [{ id: 10, level: 10 }, { id: 14, level: 10 }],
      skills: [{ id: 3, level: 9 }, { id: 11, level: 9 }, { id: 22, level: 8 }],
      pattern: ['weapon', 'weapon', 'skill', 'common'],
      patternDesc: '固定循环：流星锤 → 忍者镖 → 天女散花 → 普攻',
      mechDesc: '专精全部投掷类武器：远程压制，命中后持续流血' },
    { id: 'heavy', name: '巨力战槌·磐岩', type: '重击型', region: 4, gear: 'rhino',
      bias: { power: 1.30, agility: 0.82, speed: 0.78, hp: 1.22 },
      weapons: [{ id: 5, level: 12 }], skills: [{ id: 6, level: 8 }, { id: 13, level: 9 }],
      pattern: ['weapon', 'common', 'weapon', 'skill'],
      patternDesc: '固定循环：大槌 → 普攻 → 大槌 → 震地',
      mechDesc: '只用势大力沉的武器：出手慢但一击破盾，被击中会掉护甲' },
    { id: 'monk', name: '无械苦修·空明', type: '苦修型', region: 4, gear: 'curse3',
      bias: { power: 0.66, agility: 1.06, speed: 1.00, hp: 0.96 },
      weapons: [],
      skills: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 24].map((id) => ({ id, level: 2 })),
      castable: [8, 12, 14, 15, 17, 18, 23],
      pattern: ['skill', 'skill', 'common', 'skill'],
      patternDesc: '固定循环：技能 → 技能 → 普攻 → 技能',
      mechDesc: '不带任何武器、全技能树（20 个技能全都会，但等级很低）：技能频繁且招式不重复，闪避高、会装死与反击' },
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
      bias: { power: 0.95, agility: 1.00, speed: 1.00, hp: 1.00 },
      weapons: [{ id: 20, level: 11 }], skills: [{ id: 12, level: 9 }, { id: 17, level: 12 }],
      castable: [12, 17],
      pattern: ['skill', 'common', 'skill', 'skill'],
      patternDesc: '固定循环：野球拳 → 普攻 → 野球拳 → 来点松果（松果每场一次）',
      mechDesc: '法系爆发 + 自我续航，越拖越难打死' },
    /* D9b 新增松鼠：普通装 3 只（轮内 1~10 正常、11~20 小权重、21 起归零）；
   * 传说装 4 只只在轮内 50~99 层按 10%→25% 独立概率抽。两组只进无尽池（tags:['endless']），
   * 不进挑战塔 BOSS_POOL；池子判据与增益同源，页面一律走 hasTag()。 */
    { id: 'brute', name: '莽撞松鼠', type: '力量型', region: 1, gear: 'ninja1', tags: ['endless'],
      bias: { power: 1.12, agility: 0.86, speed: 0.90, hp: 1.16 },
      weapons: [{ id: 2, level: 5 }], skills: [{ id: 4, level: 6 }, { id: 10, level: 6 }],
      pattern: ['common', 'weapon', 'common', 'weapon'],
      patternDesc: '固定循环：普攻 → 大榔头 → 普攻 → 大榔头',
      mechDesc: '普通装里最莽的一只：血厚、出手慢，伤害直来直去' },
    { id: 'dancer', name: '灵巧松鼠', type: '敏捷型', region: 3, gear: 'ninja1', tags: ['endless'],
      bias: { power: 0.88, agility: 1.18, speed: 1.14, hp: 0.90 },
      weapons: [{ id: 8, level: 5 }], skills: [{ id: 2, level: 6 }, { id: 23, level: 6 }],
      pattern: ['weapon', 'common', 'skill', 'common'],
      patternDesc: '固定循环：菜刀 → 普攻 → 幸运一击 → 普攻',
      mechDesc: '普通装里最快的一只：闪避高、血量低，靠速度抢出手' },
    { id: 'ninjaLegend', name: '忍者宗师·影', type: '传说·忍者', region: 3, gear: 'ninja3',
      tags: ['endless'], legendary: true,
      bias: { power: 1.06, agility: 1.18, speed: 1.16, hp: 1.00 },
      weapons: [{ id: 8, level: 7 }], skills: [{ id: 23, level: 8 }, { id: 2, level: 8 }],
      pattern: ['weapon', 'skill', 'common', 'weapon'],
      patternDesc: '固定循环：菜刀 → 幸运一击 → 普攻 → 菜刀',
      mechDesc: '一身忍者史诗套：速度与闪避都高，传说档的随机对手' },
    { id: 'fistLegend', name: '拳斗宗师·铁拳', type: '传说·拳斗', region: 1, gear: 'fist3',
      tags: ['endless'], legendary: true,
      bias: { power: 1.16, agility: 1.06, speed: 1.02, hp: 1.10 },
      weapons: [{ id: 12, level: 7 }], skills: [{ id: 5, level: 8 }, { id: 14, level: 8 }],
      pattern: ['common', 'weapon', 'skill', 'weapon'],
      patternDesc: '固定循环：普攻 → 狼牙棒 → 小宇宙爆发 → 狼牙棒',
      mechDesc: '一身拳斗史诗套：正面硬砸，力量与生命最高' },
    { id: 'grapplerLegend', name: '格斗宗师·裂岩', type: '传说·格斗', region: 4, gear: 'grappler3',
      tags: ['endless'], legendary: true,
      bias: { power: 1.12, agility: 1.00, speed: 0.98, hp: 1.20 },
      weapons: [{ id: 2, level: 7 }], skills: [{ id: 4, level: 8 }, { id: 10, level: 8 }],
      pattern: ['weapon', 'common', 'weapon', 'common'],
      patternDesc: '固定循环：大榔头 → 普攻 → 大榔头 → 普攻',
      mechDesc: '一身格斗史诗套：血最厚、出手最慢，靠大榔头一下一下磨' },
    { id: 'curseLegend', name: '诅咒领主·蚀魂', type: '传说·诅咒', region: 3, gear: 'curse3',
      tags: ['endless'], legendary: true,
      bias: { power: 1.04, agility: 1.02, speed: 1.04, hp: 1.08 },
      weapons: [{ id: 8, level: 7 }], skills: [{ id: 8, level: 8 }, { id: 15, level: 8 }],
      pattern: ['weapon', 'skill', 'common', 'common'],
      patternDesc: '固定循环：菜刀 → 色诱之术 → 普攻 → 普攻',
      mechDesc: '一身诅咒史诗套：属性均衡，靠色诱与毒慢慢消耗' },
  ]);
  const SQUIRREL_BY_ID = Object.fromEntries(SQUIRRELS.map((n) => [n.id, n]));
  function squirrelFor(layer) { return SQUIRRELS[(Math.max(1, layer) - 1) % SQUIRRELS.length]; }



  /* 设计约束：
   *   3. 机制文本按**普通 boss 简介**的口径写，不写「对策建议」（那是给策划看的，见文档）。
   * 机制实现全部在 sim.js（trial* 前缀），这里只写数据。 */
  const MIRROR_THRESHOLD = 0.20;
  const MIRROR_REFLECT = 0.40;   // 反弹该次伤害的 40%
  /* 「沉默之壁」的溢出反弹阈值：单次**受到**的伤害超过自身生命上限的这个比例时，
   * **超出的那一截**全额反弹给出手方（不是按整次伤害的百分比）。
   * 与镜鳞的区别：镜鳞是「按整次伤害的 40% 反弹」，这里是「只反超出 25% 的那一截」——
   * 所以「压着阈值多段打」是被鼓励的解法，玩家会主动控制单次爆发。 */
  const OVERFLOW_THRESHOLD = 0.25;
  /* 会「封死对手的一切治疗」的机制 id。
   * 也用它拦掉「开战回血」—— 否则 C04/C16/C17 那些开战回血会绕过封疗（用户报的 bug）。 */
  const HEAL_SEAL_MECHS = ['trialDry'];
  function mechSealsHeal(mechs) {
    if (!mechs || !mechs.length) return false;
    for (const m of mechs) if (HEAL_SEAL_MECHS.indexOf(m) >= 0) return true;
    return false;
  }
    const TRIALS = Object.freeze([
    { id: 'core', name: '熔核·炽壳', type: '爆发窗口型', region: 1, gear: 'hero',
      bias: { power: 1.00, agility: 0.90, speed: 0.90, hp: 0.82 },
      weapons: [{ id: 2, level: 6 }], skills: [{ id: 10, level: 7 }, { id: 4, level: 7 }],
      pattern: ['common', 'weapon', 'common', 'weapon'],
      patternDesc: '固定循环：普攻 → 大榔头（出手慢，前 4 回合是唯一的输出窗口）',
      mech: ['trialCore'],
      mechDesc: '开始战斗后每过一回合获得 10% 减伤（第 8 回合起封顶 70%）；第 7 次行动起力/敏/速 +50%' },
    { id: 'moss', name: '苔龟·磐甲', type: '回复型', region: 2, gear: 'rhino',
      bias: { power: 0.88, agility: 0.85, speed: 0.85, hp: 1.10 },
      weapons: [{ id: 2, level: 6 }], skills: [{ id: 7, level: 7 }, { id: 10, level: 7 }],
      pattern: ['weapon', 'common', 'common', 'weapon'],
      patternDesc: '固定循环：大榔头 → 普攻（血最厚、出手最慢）',
      mech: ['trialMoss', 'thorns'],
      mechDesc: '每回合回复 6% 最大生命；受到的任何伤害反弹 15% 给攻击者' },
    { id: 'dry', name: '枯泉·涸井', type: '压制型', region: 3, gear: 'curse',
      bias: { power: 0.95, agility: 1.00, speed: 0.95, hp: 0.96 },
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
    /* 沉默之壁·镇岳（2026-10 新增）：重装沉默型。
     * 机制 = 溢出反弹（单次受到伤害超过自身生命上限 25% 时，超出部分全额反弹）。
     * 克制手段：血量最厚 + 攻速最慢 + 主打**沉默之斧**（武器 16，5~20 的低伤近战）。
     * 「斧头当主武器」本身就是对它自己的削弱（见 mechDesc 的说明）：它出手又慢又轻，
     *          power 0.78 / speed 0.76（慢速低攻，给玩家控伤的空间）。 */
    { id: 'bulwark', name: '沉默之壁·镇岳', type: '重装沉默型', region: 3, gear: 'knight',
      bias: { power: 0.78, agility: 0.84, speed: 0.76, hp: 1.42 },
      weapons: [{ id: 16, level: 8 }], skills: [{ id: 4, level: 8 }, { id: 10, level: 8 }],
      pattern: ['weapon', 'weapon', 'common', 'weapon'],
      patternDesc: '固定循环：沉默之斧 → 沉默之斧 → 普攻 → 沉默之斧（主武器就是那把斧头）',
      mech: ['trialOverflow'],
      mechParams: { trialOverflow: { threshold: OVERFLOW_THRESHOLD } },
      mechDesc: '单次受到伤害超过它 ' + Math.round(OVERFLOW_THRESHOLD * 100) +
        '% 最大生命时，超出的部分全额反弹' },
    { id: 'bloodfang', name: '血牙·狂噬', type: '成长型', region: 1, gear: 'shogun',
      bias: { power: 1.08, agility: 1.00, speed: 1.05, hp: 0.94 },
      weapons: [{ id: 12, level: 6 }], skills: [{ id: 14, level: 7 }, { id: 5, level: 7 }, { id: 6, level: 1 }],
      pattern: ['weapon', 'skill', 'weapon', 'common'],
      patternDesc: '固定循环：狼牙棒 → 小宇宙爆发 → 狼牙棒',
      mech: ['trialBloodfang'],
      mechDesc: '每损失 25% 生命，攻击力 +20%（越拖越猛）；带装死，濒死时保留 1 点生命' },
    { id: 'erode', name: '蚀骨·腐毒', type: '消耗型', region: 3, gear: 'curse3',
      bias: { power: 0.86, agility: 0.95, speed: 0.95, hp: 1.28 },
      weapons: [{ id: 8, level: 6 }], skills: [{ id: 10, level: 7 }, { id: 8, level: 7 }],
      pattern: ['common', 'weapon', 'common', 'skill'],
      patternDesc: '固定循环：普攻 → 菜刀 → 普攻 → 色诱之术',
      mech: ['trialErode'],
      mechDesc: '对手每次出手叠 1 层「攻击 −3%」，最多 15 层（本场有效）' },
  ]);
  const TRIAL_BY_ID = Object.fromEntries(TRIALS.map((n) => [n.id, n]));
  /** 兼容别名：老的「按层固定轮换第 4 场题面」调用点（部分工具还在用）。 */
  function trialFor(layer) { return TRIALS[(Math.max(1, layer) - 1) % TRIALS.length]; }



  /* x10 层最终 boss 从独立变体池按 (salt + 层数) 取：同层固定、换层变化；
   * 装备固定狂战套，武器 / 技能 / 等级 / 机制倾向各不相同，每只都带绝对防御。 */
  const WARLORD_BASE = { type: '首领', region: 1, gear: 'berserk', mech: ['berserk'] };
  const WARLORD_POOL = Object.freeze([
    { ...WARLORD_BASE, id: 'warlord', name: '狂战松鼠·无双',
      bias: { power: 1.15, agility: 1.02, speed: 1.06, hp: 1.08 },
      weapons: [{ id: 12, level: 8 }],
      skills: [{ id: 14, level: 10 }, { id: 5, level: 9 }, { id: 10, level: 8 }, { id: 16, level: 8 }],
      castable: [14, 5], pattern: ['weapon', 'skill', 'weapon', 'common'],
      patternDesc: '固定循环：狼牙棒 → 小宇宙爆发 → 狼牙棒 → 普攻',
      mechDesc: '精英：生命首次低于 50% 时攻击力翻倍；一身狂战套，力/敏/速/生命全面强化；' +
        '自带绝对防御（受击时按概率完全免伤）' },
    { ...WARLORD_BASE, id: 'warlord', name: '狂战松鼠·铁壁',
      bias: { power: 1.05, agility: 0.94, speed: 0.96, hp: 1.22 },
      weapons: [{ id: 9, level: 12 }],
      skills: [{ id: 16, level: 14 }, { id: 10, level: 14 }, { id: 6, level: 12 }, { id: 14, level: 8 }],
      castable: [14], pattern: ['weapon', 'weapon', 'common', 'skill'],
      patternDesc: '固定循环：斩马刀 → 斩马刀 → 普攻 → 小宇宙爆发',
      mechDesc: '精英：血量与减伤拉满（皮糙肉厚 14 级 + 绝对防御 14 级），' +
        '出手慢但极难打死；装死 12 级让它在濒死时多撑一段' },
    { ...WARLORD_BASE, id: 'warlord', name: '狂战松鼠·血怒',
      bias: { power: 1.20, agility: 1.04, speed: 1.04, hp: 1.06 },
      weapons: [{ id: 12, level: 10 }, { id: 8, level: 10 }],
      skills: [{ id: 23, level: 12 }, { id: 16, level: 10 }, { id: 5, level: 10 }, { id: 14, level: 8 }],
      castable: [23, 14], pattern: ['weapon', 'skill', 'weapon', 'skill'],
      patternDesc: '固定循环：狼牙棒 → 幸运一击 → 菜刀 → 小宇宙爆发',
      mechDesc: '精英：幸运一击 12 级（1~6 倍伤害，方差极大）；攻击时吸血；' +
        '自带绝对防御 —— 打它要扛得住爆发' },
    { ...WARLORD_BASE, id: 'warlord', name: '狂战松鼠·霜狱',
      bias: { power: 1.12, agility: 1.06, speed: 1.10, hp: 1.10 },
      weapons: [{ id: 7, level: 11 }],
      skills: [{ id: 15, level: 13 }, { id: 16, level: 12 }, { id: 10, level: 10 }, { id: 14, level: 8 }],
      castable: [15, 14], pattern: ['skill', 'weapon', 'skill', 'common'],
      patternDesc: '固定循环：通灵召唤 → 毒龙胆 → 通灵召唤 → 普攻',
      mechDesc: '精英：通灵召唤 13 级（召唤物压制）+ 毒藤缠绕；自带绝对防御 12 级' },
    { ...WARLORD_BASE, id: 'warlord', name: '狂战松鼠·无常',
      /* 2026-10 第十四批：挑战塔 20 层的最终首领**超模**，模拟实测
       *   · **降低武器等级**：激光剑 12 → 8（层 20 实际 14 → 10）；
       * 旧描述里写的「会冻结与吸血」与它实际的武技（激光剑=暴击、绝对防御、装死、皮糙肉厚）不符，一并改正。 */
      bias: { power: 1.10, agility: 1.00, speed: 1.02, hp: 1.04 },
      weapons: [{ id: 11, level: 8 }],
      skills: [{ id: 14, level: 8 }, { id: 16, level: 12 }, { id: 6, level: 10 }, { id: 10, level: 10 }],
      castable: [14], pattern: ['weapon', 'skill', 'common', 'weapon'],
      patternDesc: '固定循环：激光剑 → 小宇宙爆发 → 普攻 → 激光剑',
      mechDesc: '精英：小宇宙爆发 8 级（开场追加一次行动 + 属性提升）、激光剑高暴击；' +
        '自带绝对防御 12 级与皮糙肉厚 10 级，濒死时装死保命 —— 出手快、爆发高' },
  ]);
  function warlordFor(layer, salt) {
    const key = String(salt == null ? '' : salt) + '&warlord#' + Math.max(1, Number(layer) || 1);
    return WARLORD_POOL[poolHash(key) % WARLORD_POOL.length];
  }
  /* 兼容旧调用点：默认（不带层数）就是第一只。 */
  const WARLORD = WARLORD_POOL[0];

  /* 征战动物 boss 只接原版 bossConfig（MainMovie.as:19152）里已开放的四只：
   * 离线塔战没有服务端 combats，出招交给玩家式 Sim，数值压在倒数第二战狂战松鼠之上。 */
  const CAMPAIGN_BOSSES = Object.freeze([
    { id: 'campaign_hare', bossId: 1, mcFrame: 1, name: '暗御狡兔', bigName: '狡兔', level: 35,
      type: '征战首领 · 狡兔', region: 0,
      bias: { power: 1.20, agility: 1.12, speed: 1.18, hp: 1.20 },
      weapons: [{ id: 8, level: 10 }],
      skills: [{ id: 2, level: 10 }, { id: 11, level: 10 }, { id: 23, level: 10 }],
      castable: [23], pattern: ['weapon', 'skill', 'weapon', 'common'], mech: ['berserk', 'freeze'],
      patternDesc: '狡兔三窟：菜刀 → 幸运一击 → 菜刀 → 普攻（高速、高闪避）',
      mechDesc: '原版征战副本首领「暗御狡兔」：敏捷与速度极高，靠闪避与幸运一击打爆发；' +
        '塔内追加狂战血性与寒冰禁锢（每第 3 次行动前冻结玩家 1 回合）。' },
    { id: 'campaign_wolf', bossId: 2, mcFrame: 2, name: '暗御狼王', bigName: '狼王', level: 40,
      type: '征战首领 · 狼王', region: 0,
      bias: { power: 3.00, agility: 1.00, speed: 1.00, hp: 1.30 },
      weapons: [{ id: 12, level: 11 }],
      skills: [{ id: 9, level: 11 }, { id: 10, level: 11 }, { id: 24, level: 11 }, { id: 14, level: 10 }],
      castable: [14], pattern: ['weapon', 'skill', 'weapon', 'common'], mech: ['berserk', 'freeze'],
      patternDesc: '狼王扑杀：狼牙棒 → 小宇宙爆发 → 狼牙棒 → 普攻（高力量）',
      mechDesc: '原版征战副本首领「暗御狼王」：力量最高，暴击与反击都很硬；' +
        '塔内追加狂战血性与寒冰禁锢（每第 3 次行动前冻结玩家 1 回合）。' },
    { id: 'campaign_fox', bossId: 3, mcFrame: 3, name: '暗御妖狐', bigName: '妖狐', level: 50,
      type: '征战首领 · 妖狐', region: 0,
      bias: { power: 1.20, agility: 1.05, speed: 1.05, hp: 0.65 },
      weapons: [{ id: 7, level: 12 }],
      skills: [{ id: 8, level: 12 }, { id: 15, level: 12 }, { id: 6, level: 10 }, { id: 16, level: 10 }],
      castable: [8, 15], pattern: ['skill', 'weapon', 'skill', 'common'], mech: ['berserk'],
      patternDesc: '妖狐魅影：色诱之术 → 毒龙胆 → 通灵召唤 → 普攻（控制与消耗）',
      mechDesc: '原版征战副本首领「暗御妖狐」：色诱与通灵交替，擅长拖慢并消耗对手；' +
        '塔内追加狂战血性（生命首次低于 50% 时攻击力翻倍）。' },
    { id: 'campaign_ape', bossId: 4, mcFrame: 4, name: '暗御猿将', bigName: '猿将', level: 60,
      type: '征战首领 · 猿将', region: 0,
      bias: { power: 0.90, agility: 1.00, speed: 1.00, hp: 0.80 },
      weapons: [{ id: 2, level: 12 }],
      skills: [{ id: 14, level: 12 }, { id: 16, level: 10 }, { id: 5, level: 10 }, { id: 10, level: 10 }],
      castable: [14], pattern: ['weapon', 'skill', 'common', 'skill'], mech: ['berserk'],
      patternDesc: '猿将重击：狼牙棒 → 小宇宙爆发 → 普攻 → 小宇宙爆发（高生命、高减伤）',
      mechDesc: '原版征战副本首领「暗御猿将」：四只已开放首领中最厚、最重的一只；' +
        '塔内追加狂战血性（生命首次低于 50% 时攻击力翻倍）。' },
  ]);
  const CAMPAIGN_BOSS_BY_ID = Object.fromEntries(CAMPAIGN_BOSSES.map((b) => [b.id, b]));
  /* 只有 60/70/80/90 这四层接入；10~50 保持原来的「随机 boss + 塔顶狂战松鼠」结构。
   * 90 猿将 → 80 妖狐 → 70 狼王 → 60 狡兔，正好按原版等级从高到低排。 */
  const CAMPAIGN_BOSS_ORDER = ['campaign_ape', 'campaign_fox', 'campaign_wolf', 'campaign_hare'];
  function campaignBossFor(layer) {
    const L = Math.max(1, Math.floor(Number(layer) || 1));
    if (L !== 60 && L !== 70 && L !== 80 && L !== 90) return null;
    const idx = Math.floor((90 - L) / 10);
    return CAMPAIGN_BOSS_BY_ID[CAMPAIGN_BOSS_ORDER[idx]] || null;
  }



  /* 挑战塔：带机制的松鼠 boss + 平庸松鼠 + 机制 NPC，均匀抽一个；
   *   · 第 1~50 层：低档权重更高，高档低概率露脸；
   * 同一层同一局固定（用 salt + 层数哈希）→ 预告 = 实战、失败重试还是同一个 boss。 */
  /* 无尽塔第 4/5 场只要松鼠形态：NPC 机制怪只留在挑战塔。
   *   （×1.2 三围 + 精英掉落/计分），变体仍按 (salt, 层数) 哈希取，预告 = 实战。
   *   注意 x10 层的第 5 场已经是固定狂战松鼠 → 第 4 场由 bossFor 排除它，避免一层两只。 */
  const ENDLESS_BOSS_POOL = Object.freeze([
    ...TRIALS.map((t) => ({ kind: 'trial', id: t.id })),
    ...SQUIRRELS.map((s) => ({ kind: 'squirrel', id: s.id })),
    { kind: 'warlord', id: 'warlord' },
  ]);
  const BOSS_POOL = Object.freeze([
    ...TRIALS.map((t) => ({ kind: 'trial', id: t.id })),
    ...SQUIRRELS.filter((s) => !hasTag(s, 'endless')).map((s) => ({ kind: 'squirrel', id: s.id })),
    ...NPCS.map((n) => ({ kind: 'npc', id: n.id })),
  ]);
  const BOSS_GEAR_RARITY = Object.freeze(['普通', '优秀', '杰出', '卓越', '传说']);
  /** 一个 boss 候选**自带**的装备档位（0 最低 … 4 狂战）。
   *  这样「稀有度」是 boss 的身份，按层加权时不会被装备兜底逻辑搅乱。 */
  function bossGearTier(pick) {
    if (!pick) return 2;
    if (pick.kind === 'warlord') return 4;
    const def = pick.kind === 'trial' ? TRIAL_BY_ID[pick.id]
      : pick.kind === 'squirrel' ? SQUIRREL_BY_ID[pick.id] : null;
    if (def && def.legendary) return 4;   // 传说档：复用非狂战高阶套装的战斗外观
    const tier = def ? GEAR_TIER[def.gear] : null;
    return tier == null ? 2 : tier;
  }
  function endlessBossWeights(layer) {
    const c = cycleLayer(layer);
    const t = (c - 1) / (LAYER_CYCLE - 1);
    const w0 = c <= 10 ? 1 : c <= 20 ? 0.15 : 0;
    return [
      w0,
      Math.max(0.15, 1.2 - t * 0.8),
      1,
      0.3 + t * 1.2,
      0.05 + t * 0.6,
    ];
  }
  /** 传说装松鼠：只进无尽塔池，只在轮内 50~99 层按独立概率出现。 */
  function bossIsLegendary(pick) {
    if (!pick || pick.kind !== 'squirrel') return false;
    const def = SQUIRREL_BY_ID[pick.id];
    return !!(def && def.legendary);
  }
  function legendaryChance(layer) {
    const c = cycleLayer(layer);
    if (c < 50 || c > 99) return 0;
    return 0.10 + ((c - 50) / 49) * 0.15;
  }
  function poolHash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function bossFor(layer, salt, squirrelsOnly) {
    let pool = squirrelsOnly ? ENDLESS_BOSS_POOL : BOSS_POOL;
    const L = Math.max(1, Math.floor(Number(layer) || 1));
    /* x10 层的第 5 场已经是固定狂战松鼠 → 第 4 场不再抽到狂战，避免一层里打两只。
     * （只影响无尽塔：挑战塔的池子里本来就没有狂战。） */
    if (L % 10 === 0) {
      const noWarlord = pool.filter((p) => p.kind !== 'warlord');
      if (noWarlord.length) pool = noWarlord;
    }
    if (!squirrelsOnly) {
      const pick = pool[poolHash(String(salt == null ? '' : salt) + '#' + L) % pool.length];
      return { kind: pick.kind, id: pick.id };
    }
    const cycle = cycleLayer(L);
    /* 传说装松鼠：50~99 层独立概率，命中后在这几只里等概率抽。 */
    const legendary = pool.filter(bossIsLegendary);
    const lChance = legendaryChance(L);
    if (lChance > 0 && legendary.length) {
      const lroll = (poolHash(String(salt == null ? '' : salt) + '#boss-legendary#' + L) % 1000000) / 1000000;
      if (lroll < lChance) {
        const pick = legendary[poolHash(String(salt == null ? '' : salt) + '#boss-legendary-pick#' + L) % legendary.length];
        return { kind: pick.kind, id: pick.id };
      }
    }
    /* 没有命中传说时，普通池里排除传说装（否则会与上面的独立概率重复）。 */
    const weights = endlessBossWeights(L);
    const candidates = pool.filter((p) => !bossIsLegendary(p))
      .map((p) => ({ pick: p, tier: bossGearTier(p) }))
      .filter((x) => weights[x.tier] > 0 && !(cycle > 20 && x.tier === 0));
    if (!candidates.length) {
      const pick = pool[0];
      return { kind: pick.kind, id: pick.id };
    }
    /* 权重是**每个档位**的总权重，不是每个候选的权重：同档候选先平分，
     * 否则「候选多的档位」会天然压过候选少的档位，低层最低档就出不来了。 */
    const tierCounts = Object.create(null);
    candidates.forEach((x) => { tierCounts[x.tier] = (tierCounts[x.tier] || 0) + 1; });
    const weightOf = (tier) => weights[tier] / (tierCounts[tier] || 1);
    const total = candidates.reduce((sum, x) => sum + weightOf(x.tier), 0);
    const roll = (poolHash(String(salt == null ? '' : salt) + '#boss-rarity#' + L) % 1000000) / 1000000;
    let r = roll * total;
    for (const x of candidates) {
      r -= weightOf(x.tier);
      if (r < 0) return { kind: x.pick.kind, id: x.pick.id };
    }
    const last = candidates[candidates.length - 1].pick;
    return { kind: last.kind, id: last.id };
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


  //   weaponFreeUses(前 N 次武器不耗回合) weaponBoostUses/weaponBoostPowerMul/weaponBoostMustHit/
  //   weaponBoostReflectImmune/weaponBoostFatigueMul（前 N 次武器强化、之后攻击衰减）
  const BUFFS = Object.freeze([
    { id: 'N01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '蓄力一击', rarity: 0, kind: 'limited', uses: 2, desc: '下一场战斗攻击 +40%', mods: { powerMul: 0.40 } },
    { id: 'N02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '百步穿杨', rarity: 0, kind: 'limited', uses: 3, desc: '下一场战斗所有攻击必中', mods: { mustHitAll: 1 } },
    { id: 'M01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '威慑', rarity: 0, kind: 'limited', uses: 2, desc: '下一场战斗敌人攻击力 −30%', mods: { enemyPowerDown: 0.30 } },
    { id: 'M02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '疾风先手', rarity: 0, kind: 'limited', uses: 3, desc: '下一场战斗前 3 次使用武器不消耗回合', mods: { weaponFreeUses: 3 } },
    { id: 'N03', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '活血丹', rarity: 1, kind: 'limited', uses: 3, desc: '下一场战斗每回合开始回复 7% 生命', mods: { regenPct: 0.07 } },
    { id: 'N04', tags: ['tower', 'battle', 'limited', 'unique', 'nextBattle'], name: '金蝉脱壳', rarity: 1, kind: 'limited', uses: 10,
      desc: '下一场战斗第一次死亡时复活，并回复 30% 生命上限', mods: { reviveFirstPct: 0.30 } },
    { id: 'N07', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '破军', rarity: 1, kind: 'limited', uses: 3, desc: '下一场战斗暴击率 +20%，暴击伤害 +30%', mods: { critBonus: 20, critDmgBonus: 0.30 } },
    { id: 'M03', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '坚守', rarity: 1, kind: 'limited', uses: 2, desc: '下一场战斗受到伤害 −30%', mods: { takenMul: -0.30 } },
    { id: 'M04', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '疾风步', rarity: 1, kind: 'limited', uses: 10, desc: '下一场战斗速度 +30%', mods: { speedMul: 0.30 } },
    { id: 'N05', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '先手制敌', rarity: 2, kind: 'limited', uses: 3, desc: '下一场战斗开局对敌人造成其 30% 最大生命的伤害', mods: { openStrikePct: 0.30 } },
    /* 补给要**能反复刷出、次数无限叠加** ——
     * 拿到之后照样留在池子里（`stackable` + `unlimitedStacks`：stackCap 返回 Infinity，
     * poolFilter 那条「stackable 且到上限就出池」永远不会命中）。
     * 这正是「无限叠加次数」的字面结果。 */
    { id: 'N08', tags: ['tower', 'endless', 'battle', 'limited', 'nextBattle', 'stackable', 'repeatable'],
      name: '补给', rarity: 0, kind: 'limited', uses: 1, unlimitedStacks: true,
      desc: '下一场战斗开始时立即回复 50% 生命（可以反复拿到，次数无限叠加）', mods: { startHealPct: 0.50 } },
    { id: 'N06', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '血饮狂刀', rarity: 2, kind: 'limited', uses: 5, desc: '下一场战斗攻击附带 45% 吸血', mods: { lifestealPct: 0.45 } },
    { id: 'G01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '力量祝福', rarity: 0, kind: 'limited', uses: 10, desc: '下一场战斗力量、敏捷、速度各 +20%', mods: { powerMul: 0.20, agilityMul: 0.20, speedMul: 0.20 } },
    { id: 'G02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '生命祝福', rarity: 0, kind: 'limited', uses: 5, desc: '下一场战斗生命上限 +20%，并在开战第一回合回复 40% 生命上限', mods: { maxHpMul: 0.20, startHealPct: 0.40 } },
    { id: 'G03', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '凌波微步', rarity: 1, kind: 'limited', uses: 10, desc: '下一场战斗我方闪避率 +15%（所有闪避来源合计上限 55%）', mods: { dodgeBonus: 15 } },
    { id: 'G04', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '破釜沉舟', rarity: 2, kind: 'limited', uses: 3, desc: '下一场战斗攻击 +70%，生命上限 −20%', mods: { powerMul: 0.70, maxHpMul: -0.20 } },
    /* 挑战塔增益只服务下一场（一层四场连战、打完结算），卡面直接写「下一场战斗」；
     * 不会进无尽池（endlessPool 过滤 towerOnly）。 */
    { id: 'T01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '闪亮登场', rarity: 2, kind: 'limited', uses: 1,
      desc: '下一场战斗：前 3 次使用武器时攻击 +50% 且必中，同时免疫反伤；之后我方攻击 −20%',
      mods: { weaponBoostUses: 3, weaponBoostPowerMul: 0.50, weaponBoostMustHit: 1, weaponBoostReflectImmune: 1, weaponBoostFatigueMul: 0.20 } },
    { id: 'T02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '烟幕', rarity: 1, kind: 'limited', uses: 1,
      desc: '下一场战斗：我方闪避率 ×1.5（最终不超过 55%）',
      mods: { dodgeMul: 0.50 } },
    { id: 'T03', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '锁定打击', rarity: 1, kind: 'limited', uses: 1,
      desc: '下一场战斗：所有攻击必中', mods: { mustHitAll: 1 } },
    { id: 'T04', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '见血封喉', rarity: 2, kind: 'limited', uses: 1,
      desc: '下一场战斗：暴击率 +30%，暴击伤害 +50%',
      mods: { critBonus: 30, critDmgBonus: 0.50 } },
    { id: 'T05', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '以血换血', rarity: 2, kind: 'limited', uses: 1,
      desc: '下一场战斗：反弹 50% 受到的伤害给敌人', mods: { thornsPct: 0.50 } },
    { id: 'T06', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '背水一战', rarity: 3, kind: 'limited', uses: 1,
      desc: '下一场战斗：攻击 +35%，速度 +20%，受到伤害 −20%',
      mods: { powerMul: 0.35, speedMul: 0.20, takenMul: -0.20 } },
    { id: 'T07', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '不动如山', rarity: 3, kind: 'limited', uses: 1,
      desc: '下一场战斗：生命上限 +35%，开战回满生命，之后每回合再回复 5% 生命',
      mods: { maxHpMul: 0.35, startHealPct: 1.00, regenPct: 0.05 } },
    { id: 'T08', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '先发制人', rarity: 0, kind: 'limited', uses: 1,
      desc: '下一场战斗：首次使用武器不消耗回合，敌方对我方的第一次伤害为 0',
      mods: { weaponFreeUses: 1, firstHitZero: 1 } },
    /* 语义：生命上限 +20%（永久，拿到就折算进 run.hpBonus），并回复等量生命。
     * 注意它与「获得时回血」类（healOnGainPct）不是一回事 —— 后者只回血、不抬上限。 */
    { id: 'C01', tags: ['tower', 'endless', 'shop'], name: '磐石之躯', rarity: 1, kind: 'permanent', desc: '生命上限 +20%，并回复等量生命', mods: { maxHpMul: 0.20 } },
    { id: 'C02', tags: ['tower', 'endless', 'battle', 'shop'], name: '磨砺', rarity: 0, kind: 'permanent', desc: '攻击 +30%', mods: { powerMul: 0.30 } },
    { id: 'C03', tags: ['endless', 'battle', 'shop', 'stackable'], name: '猎侠者', rarity: 0, kind: 'permanent', maxStacks: 3, desc: '对螳螂/仙鹤/熊猫伤害 +25%', mods: { dmgMulType: 0.25 } },
    { id: 'C04', tags: ['endless', 'shop', 'unique'], name: '生命源泉', rarity: 1, kind: 'permanent', desc: '每进入新的一层，该层第一场战斗开战时回复 100% 生命', mods: { layerFirstHealPct: 1.00 } },
    { id: 'C05', tags: ['tower', 'endless', 'battle', 'shop'], name: '坚韧壁垒', rarity: 1, kind: 'permanent', desc: '每场战斗开局获得 15% 最大生命的护盾', mods: { shellPct: 0.15 } },
    { id: 'C06', tags: ['endless', 'battle', 'shop', 'stackable'], name: '猎杀时刻', rarity: 1, kind: 'permanent', desc: '每击杀 1 个敌人攻击 +2%，最多 +30%', mods: { killPowerPct: 0.02, killPowerCap: 0.30 } },
    { id: 'C07', tags: ['endless', 'battle', 'shop', 'stackable'], name: '吞噬成长', rarity: 1, kind: 'permanent',
      desc: '每胜利一场生命上限 +2%，最多 +30%', mods: { winMaxHpPct: 0.02, winMaxHpCap: 0.30 } },
    { id: 'C09', tags: ['endless', 'battle', 'shop', 'unique'], name: '逢五强化', rarity: 1, kind: 'permanent', desc: '每到 5 的倍数层，攻击与生命上限各 +50%', mods: { x10Boost: 0.50 } },
    { id: 'C10', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '机制破解', rarity: 1, kind: 'permanent', maxStacks: 3, desc: '对带专属机制的敌人伤害 +25%', mods: { dmgMulMech: 0.25 } },
    { id: 'C16', tags: ['endless', 'battle', 'shop', 'stackable'], name: '战斗续航', rarity: 1, kind: 'permanent', maxStacks: 2,
      desc: '每场战斗开始时回复 5% 生命上限', mods: { startHealPct: 0.05 } },
    { id: 'C17', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '战斗续航·精', rarity: 2, kind: 'permanent', maxStacks: 2,
      desc: '每场战斗开始时回复 10% 生命上限', mods: { startHealPct: 0.10 } },
    { id: 'C18', tags: ['tower', 'endless', 'battle', 'shop'], name: '吸血精通', rarity: 1, kind: 'permanent', desc: '所有攻击附带 15% 吸血', mods: { lifestealPct: 0.15 } },
    { id: 'C19', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '荆棘之甲', rarity: 1, kind: 'permanent', maxStacks: 3, desc: '受到伤害时反弹 20% 给敌人', mods: { thornsPct: 0.20 } },
    /* 狂怒：低血时同时强化攻/敏/速（阈值 50%）。
     * 三项都用同一套「当前血量 ≤ 上限 × lowHpAt」判定，但**结算位置都在最后一步**：
     *   · 攻击那一份是终乘（lowHpFinalMul）—— 不走力量面板，而是在最终伤害上直接乘；
     *     在「基础值 ×(1−削弱) + buffFlat（越战越勇 / 后发制人这类回合成长）」全部算完之后
     *     再 ×1.2，也就是引擎真正使用的最终敏捷/速度（sim.js 的 effAgility / effSpeed 是唯一出口：
     * 所以三项都不会被其它乘区稀释 —— 低血才触发的门槛配得上这个待遇。 */
    { id: 'C20', tags: ['tower', 'endless', 'battle', 'shop'], name: '狂怒', rarity: 2, kind: 'permanent',
      desc: '生命低于一半时：最终伤害 ×1.5、最终敏捷 ×1.2、最终速度 ×1.2',
      mods: { lowHpFinalMul: 0.50, lowHpAgilityMul: 0.20, lowHpSpeedMul: 0.20, lowHpAt: 0.50 } },
    /* 低血 combo：空血上限只加上限不回血，压低当前血量占比以推进狂怒触发区间；
     * 四项低血效果共用 lowHpAt 阈值（与狂怒一致）。 */
    { id: 'C46', tags: ['tower', 'endless', 'battle', 'shop'], name: '浴血重生', rarity: 1, kind: 'permanent',
      desc: '每场战斗开始时获得 30% 的空生命上限；生命低于 50% 时每回合回复 2% 生命，最多回到 50%',
      mods: { emptyMaxHpMul: 0.30, lowHpRegenPct: 0.02, lowHpRegenAt: 0.50, lowHpAt: 0.50 } },
    { id: 'C47', tags: ['tower', 'endless', 'battle', 'shop', 'noRestack'], name: '濒死觉悟', rarity: 2, kind: 'permanent',
      /* `noRestack`：**身上有一条就不再出现**（拿到它之后三选一 / 商店都刷不到），
       * 直到它真的被放弃（每 10 层交增益、卖掉等）才会重新进池 —— 见 tower.js 的 poolFilter。 */
      desc: '每场战斗开始时获得 50% 的空生命上限；生命低于 50% 时获得 15% 减伤与 15% 吸血',
      mods: { emptyMaxHpMul: 0.50, lowHpTakenMul: -0.15, lowHpLifestealPct: 0.15, lowHpAt: 0.50 } },
    /* 抉择扩充：战斗获得的三选一变四选一，最多叠 2 层（最高 5 选 1）。
     * （拿满 maxStacks 即出池，也不会再走「叠满开新栏位」的通用规则）。 */
    { id: 'C50', tags: ['endless', 'battle', 'shop', 'stackable', 'noRestack'], name: '抉择扩充', rarity: 2, kind: 'permanent', maxStacks: 2,
      desc: '战斗获得的选择项 +1',
      mods: { choiceCount: 1 } },
    /* 减伤成长：每胜利一场，本局受到伤害再 −1%（上限 −25%）。
     * 但作用在减伤上 —— 无尽塔后期最缺的就是续航。 */
    { id: 'C48', tags: ['endless', 'battle', 'shop', 'unique'], name: '铜墙铁壁', rarity: 2, kind: 'permanent',
      desc: '本局每胜利一场，受到的伤害额外 −1%，最多 −25%',
      mods: { winTakenMulPct: 0.01, winTakenMulCap: 0.25 } },
    { id: 'C64', tags: ['endless', 'shop', 'stackable'], name: '巨力重拳', rarity: 0, kind: 'permanent', unlimitedStacks: true,
      desc: '暴击伤害 +10%', mods: { critDmgBonus: 10 } },
    { id: 'C21', tags: ['tower', 'endless', 'battle', 'shop', 'quietStack'], name: '暴击精通', rarity: 0, kind: 'permanent', desc: '暴击率 +15%', mods: { critBonus: 15 } },
    { id: 'C22', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '闪避精通', rarity: 0, kind: 'permanent', maxStacks: 3, desc: '闪避率 +20%（所有闪避来源合计上限 55%）', mods: { dodgeBonus: 20 } },
    { id: 'C23', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '轻身术', rarity: 0, kind: 'permanent', maxStacks: 3, desc: '速度 +20%', mods: { speedMul: 0.20 } },
    /* 以战养战：**不能再叠加**。去掉 stackable 并锁定 1 份：
     * 既不会同格叠层，也不会按「叠满开新栏位」的通用规则再占一格（见 addBuff 的 permanent 分支）。 */
    { id: 'C11', tags: ['endless', 'battle', 'shop', 'oncePerRun'], name: '以战养战', rarity: 2, kind: 'permanent', maxStacks: 1, desc: '每胜利一场，生命上限 +5', mods: { winMaxHpFlat: 5 } },
    { id: 'C12', tags: ['endless', 'battle', 'shop', 'oncePerRun'], name: '登顶者', rarity: 2, kind: 'permanent', maxStacks: 1,
      desc: '第 10 层起，每胜利一场，本局力&敏&速 +1',
      mods: { winStatAfter10: 1 } },
    { id: 'C13', tags: ['tower', 'endless', 'battle', 'shop'], name: '精英杀手', rarity: 2, kind: 'permanent',
      desc: '对精英伤害 +40%；击败精英后回复 20% 最大生命并增加 5% 最大生命',
      mods: { dmgMulElite: 0.40, eliteHealAfter: 0.20, eliteMaxHpAfter: 0.05 } },
    { id: 'C14', tags: ['tower', 'endless', 'battle', 'shop', 'stackable', 'noRestack'], name: '涅槃', rarity: 3, kind: 'permanent', shopWeight: 0.5, maxStacks: 2,
      desc: '每层战斗可复活一次；复活回复 50% 生命上限，本场力量、敏捷、速度 +50%',
      mods: { revivePct: 0.50, reviveStatMul: 0.50 } },
    { id: 'C51', tags: ['endless', 'battle', 'unique'], name: '天命所归', rarity: 3, kind: 'permanent', maxStacks: 1,
      desc: '本局战斗奖励与商店的史诗/传奇出率 ×2、普通出率 ×0.5',
      mods: { rarityBoost: 1, epicMul: 2, legendMul: 2, commonMul: 0.5 } },
    /* E01「立即进货」的商店权重 **0.5**：它本身的功能就是「开一家店」，
     * 注意 shopWeight 是**商店货架与场间三选一共用**的那份权重（见 tower.js buffStaticWeightOf），
     * 静态权重只在档内分配时起作用，省下的份额按比例分给同档其它史诗）。 */
    { id: 'E01', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle', 'ops'], name: '立即进货', rarity: 2, kind: 'limited', uses: 1, shopWeight: 0.5,
      /* 【2026-10 第八十批 用户口径】`noExtend: true` = **延续铭文（C62）不能拿它当目标**（特殊设定）：
       * 同一口径也应用在 E15 时间回廊 / E16 铸币商队（都是流程类）。 */
      noExtend: true,
      desc: '下一场战斗后立即开店一次，全部商品 7 折',
      mods: { postBattleShop: 1, postBattleShopDiscount: 0.30 } },
    /* E16「铸币商队」= E01「立即进货」的铸币版：下一场战斗后**必开一家铸币商店**（限次 1）。
     * 与 E01 同场生效时由它**顶掉**那家试炼商店（用户口径：一次战斗只开一家店，铸币优先）；
     * 那一场如果是每 5 层的最后一战，也顶掉结算商店 —— 但「关店后推进到下一层 / 先放弃一个
     * 永久增益」的去向照旧保留（见 tower.js 的 openMintShop({boundary}) 与 closeMintShop）。 */
    { id: 'E16', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle', 'ops'], name: '铸币商队', rarity: 1, kind: 'limited', uses: 1, shopWeight: 0.5,
      /* 流程类（下一场战斗后开铸币商店）：与 E01 / E15 同口径，延续铭文不能延长它。 */
      noExtend: true,
      desc: '下一场战斗结束后立即生成 1 家铸币商店（若本场本该开出普通商店，则由它顶掉）',
      mods: { postBattleMintShop: 1 } },
    /* `unique`（2026-10 第八十一批补）：它是「一局只能有一份」的限次件 —— 手里有时不再刷出，
     * 特意把它排除在外：这一条是**直接判胜**，叠起来（2→4→6 场）会把爬塔变成按按钮。
     * 想让它也能叠，去掉这个标签即可。 */
    { id: 'E17', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle', 'unique'], name: '假如我直接赢', rarity: 3, kind: 'limited', uses: 2,
      desc: '下一场战斗开始时，敌方生命立即归零（本场直接判胜）· 共 2 场',
      mods: { openKill: 1 } },
    { id: 'E02', tags: ['endless', 'battle', 'ops'], name: '试炼补贴', rarity: 0, kind: 'instant', desc: '立刻获得 60 试炼币', mods: { instantCoins: 60 } },
    { id: 'E03', tags: ['endless', 'battle', 'ops'], name: '财源滚滚', rarity: 1, kind: 'instant', desc: '立刻获得 120 试炼币', mods: { instantCoins: 120 } },
    /* 试炼补贴 / 财源滚滚 的**上位**（本轮新增，用户口径）：只作为**无尽塔战斗掉落**出现 ——
     * 标签里没有 `shop`（不上货架）也没有 `ops`（不算运营类，商店那条「大概率上架运营类」
     * 的规则因此不会把它们捞进货架），只有 `endless + battle`，即 E.choice 战斗奖励池。
     * 数值按用户口径：史诗 180、传奇 300。 */
    { id: 'E18', tags: ['endless', 'battle'], name: '丰饶之角', rarity: 2, kind: 'instant', desc: '立刻获得 180 试炼币', mods: { instantCoins: 180 } },
    /* 用户口径 2026-10（第七十二批）：传奇 +300 试炼币这条**战斗后掉率压低一半**。
     * 它只带 `battle` 标签 → 唯一出现口子就是战斗奖励/场间选择，所以 shopWeight 就是那个「权重」。 */
    { id: 'E19', tags: ['endless', 'battle'], name: '点石成金', rarity: 3, kind: 'instant', desc: '立刻获得 300 试炼币',
      shopWeight: 0.5, mods: { instantCoins: 300 } },
  /* 「烙印升华」E20：**只在试炼商店生成**（无 battle 标签），
   * 且仅在「未破碎的烙印超过 brandGate 份」时才会出现（条件收在 tower.js 的 poolFilter 里）。
   * 效果 = 让持有的所有烙印立刻破碎（破碎本身就是升级：每份变成全额并永久保留）。 */
  { id: 'E20', tags: ['endless', 'shop', 'ops'], name: '烙印升华', rarity: 1, kind: 'instant',
    desc: '立即使你持有的所有烙印破碎（每份都升级为全额并永久保留）',
    mods: { breakAllBrands: 1, brandGate: 3 } },
    { id: 'E04', tags: ['endless', 'battle', 'oncePerRun', 'ops'], name: 'steam大促', rarity: 1, kind: 'instant', maxStacks: 1,
      desc: '下一个试炼商店全部商品 7 折', mods: { shopDiscount: 0.30 } },
    { id: 'E05', tags: ['endless', 'battle', 'shop', 'limited', 'ops'], name: '战利品', rarity: 1, kind: 'limited', uses: 10, desc: '接下来 10 场战斗的试炼币获取 ×1.8', mods: { coinBoostPct: 0.80 } },
    { id: 'E06', tags: ['endless', 'battle', 'shop', 'limited', 'ops'], name: '战利品·精', rarity: 2, kind: 'limited', uses: 10, desc: '接下来 10 场战斗的试炼币获取 ×2.4', mods: { coinBoostPct: 1.40 } },
    { id: 'E13', tags: ['endless', 'battle', 'shop', 'limited', 'ops'], name: '战利品·小', rarity: 0, kind: 'limited', uses: 10,
      desc: '接下来 10 场战斗的试炼币获取 ×1.4', mods: { coinBoostPct: 0.40 } },
    { id: 'C26', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '蛮力', rarity: 0, kind: 'permanent', unlimitedStacks: true, desc: '攻击 +20%', mods: { powerMul: 0.20 } },
    { id: 'C27', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '灵巧', rarity: 0, kind: 'permanent', unlimitedStacks: true, desc: '敏捷 +20%', mods: { agilityMul: 0.20 } },
    { id: 'C28', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '疾行', rarity: 0, kind: 'permanent', unlimitedStacks: true, desc: '速度 +20%', mods: { speedMul: 0.20 } },
    { id: 'C29', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '体质', rarity: 0, kind: 'permanent', unlimitedStacks: true, desc: '生命上限 +10%', mods: { maxHpMul: 0.10 } },
    { id: 'C30', tags: ['endless', 'battle', 'shop', 'unique', 'ops'], name: '扩容背包', rarity: 2, kind: 'permanent', permSlot: 1,
      desc: '本局永久增益槽位 +1', mods: { permSlot: 1 } },
    { id: 'C31', tags: ['endless', 'battle', 'unique', 'ops'], name: '仓库钥匙', rarity: 3, kind: 'permanent', permSlot: 2,
      desc: '本局永久增益槽位 +2', mods: { permSlot: 2 } },
    /* 隐藏型选取 buff：拿到后立即三选一（已有武器/技能），强化指定对象；不显示在增益面板、不可出售 */
    { id: 'C32', tags: ['endless', 'battle', 'shop', 'unique', 'hidden', 'catalog'], name: '神兵淬炼', rarity: 2, kind: 'permanent',
      desc: '立即从已有武器中随机三选一，该武器伤害 +100%', mods: { pickWeaponPct: 1.00 } },
    { id: 'C33', tags: ['endless', 'battle', 'shop', 'unique', 'hidden', 'catalog'], name: '秘技通神', rarity: 2, kind: 'permanent',
      desc: '立即从已有主动技能中随机三选一，该技能触发概率 +60%', mods: { pickSkillPct: 0.60 } },
    { id: 'N09', tags: ['endless', 'battle', 'shop', 'limited'], name: '晴空护符', rarity: 0, kind: 'limited', uses: 3,
      desc: '接下来 3 场：无视负面环境词缀（正向环境照常生效）', mods: { envIgnore: 1, envReflect: 1 } },
    { id: 'N10', tags: ['endless', 'battle', 'shop', 'limited'], name: '避风斗篷', rarity: 1, kind: 'limited', uses: 10,
      desc: '接下来 10 场：无视环境词缀', mods: { envIgnore: 1 } },
    { id: 'N15', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '反噬豁免', rarity: 1, kind: 'limited', uses: 10,
      desc: '每场战斗免疫一切反伤· 共 10 场',
      mods: { reflectImmune: 1 } },
    { id: 'N13', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '血之契约', rarity: 0, kind: 'limited', uses: 10,
      desc: '每场战斗开始时生命上限 +100%· 共 10 场',
      mods: { emptyMaxHpMul: 1.00 } },
    { id: 'N14', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '铁血护盾', rarity: 2, kind: 'limited', uses: 10,
      desc: '每场战斗中生命低于 50% 时获得 60% 减伤 · 共 10 场',
      mods: { lowHpTakenMul: -0.60, lowHpAt: 0.50 } },
    { id: 'N16', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '战意沸腾', rarity: 2, kind: 'limited', uses: 10,
      desc: '每场战斗开始时力/敏/速 +50、生命上限 +500 · 共 10 场',
      mods: { startStatFlat: 50, startMaxHpFlat: 500 } },
    { id: 'N17', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '血蚀印记', rarity: 2, kind: 'limited', uses: 10,
      desc: '每场战斗中每回合开始时，对敌人造成其当前生命 10% 的伤害 · 共 10 场',
      mods: { enemyHpDrainPct: 0.10, enemyHpDrainNote: '血蚀印记' } },
    { id: 'C45', tags: ['endless', 'battle', 'shop', 'unique'], name: '天象之眼', rarity: 2, kind: 'permanent',
      desc: '无视负面环境词缀；敌方无法获得环境词缀加成',
      mods: { envIgnore: 1, envReflect: 1, envDenyGood: 1 } },
    { id: 'C24', tags: ['endless', 'battle', 'stackable', 'ops'], name: '名贵手表', rarity: 1, kind: 'permanent', maxStacks: 2,
      desc: '售出可获得 150 试炼币', mods: { sellValue: 150 } },
    { id: 'C25', tags: ['endless', 'battle', 'shop', 'ops'], name: '战利品账本', rarity: 1, kind: 'permanent',
      desc: '售出可获得 50 试炼币；每胜利一场售价 +10',
      mods: { sellValue: 50, sellGrowthPerWin: 10 } },
    { id: 'C15', tags: ['endless', 'battle', 'shop'], name: '增幅水晶', rarity: 2, kind: 'permanent',
      desc: '本局内所有 buff 的效果 ×1.3（多张加算，且与水晶铭文加算）', mods: { globalMul: 1.30 } },
    { id: 'E09', tags: ['endless', 'battle', 'ops'], name: '重整旗鼓', rarity: 0, kind: 'instant',
      desc: '立即获得 1 枚铸币', mods: { instantRetry: 1 } },
    { id: 'E12', tags: ['endless', 'shop', 'oncePerRun', 'ops'], name: '时来运转', rarity: 2, kind: 'instant', maxStacks: 1,
      desc: '本局商店刷新时，每花 10 试炼币带来的稀有度提翻倍',
      mods: { rerollTiltMul: 2 } },
    { id: 'E10', tags: ['endless', 'battle', 'ops'], name: '背水一战', rarity: 2, kind: 'instant',
      desc: '立即获得 3 枚铸币', mods: { instantRetry: 3 } },
    { id: 'E14', tags: ['endless', 'battle', 'shop', 'repeatable', 'ops'], name: '讨价还价', rarity: 0, kind: 'instant',
      desc: '立即生效：下一次进入商店时，那一页有 1 件随机商品价格减半（向下取整）',
      mods: { shopHalf: 1 } },
    { id: 'E15', tags: ['endless', 'battle', 'limited', 'nextBattle'], name: '时间回廊', rarity: 3, kind: 'limited', uses: 1,
      /* 流程类（下一场战斗后重开本层）：延续铭文不能延长它 —— 否则一次 +5 场会把整层反复重开。 */
      noExtend: true,
      desc: '下一场战斗结束后，立即从本层第 1 场重新开始：手上的增益、试炼币、分数与血量都不回退，敌人数值也不会提升；' +
        '即使那一场是本层最后一场，也照样回到本层开头',
      mods: { layerRestart: 1 } },
    /* 【2026-10 修正】E07/E08/E11 是**一局一次**的即时削弱：`oncePerRun` + `maxStacks: 1`
     * 去掉 `repeatable` 后，stackNote 对「即时 + 非 repeatable」返回空串，卡面只留效果本身。 */
    { id: 'E07', tags: ['endless', 'battle', 'oncePerRun'], name: '挫锐', rarity: 0, kind: 'instant', maxStacks: 1,
      desc: '立刻让本局所有敌人的生命上限 −10%', mods: { enemyMaxHpDown: 0.10 } },
    { id: 'E08', tags: ['endless', 'battle', 'oncePerRun'], name: '卸甲', rarity: 1, kind: 'instant', maxStacks: 1,
      desc: '立刻让本局所有敌人的生命上限 −15%', mods: { enemyMaxHpDown: 0.15 } },
    { id: 'E11', tags: ['endless', 'battle', 'oncePerRun'], name: '挫锋', rarity: 2, kind: 'instant', maxStacks: 1,
      desc: '立刻让本局所有敌人的攻击力 −15%',
      mods: { enemyPowerDown: 0.15 } },
    { id: 'C34', tags: ['tower', 'endless', 'battle', 'shop'], name: '轻装上阵', rarity: 0, kind: 'permanent',
      desc: '每个空的永久增益位让攻击 +20%', mods: { powerPerEmptySlot: 0.20 } },
    { id: 'C35', tags: ['endless', 'battle', 'shop'], name: '厚积薄发', rarity: 2, kind: 'permanent',
      desc: '每拥有 1 个永久增益，攻击 +10%；被虚空铭文附魔的增益只算 2%',
      mods: { powerPerPermBuff: 0.10, powerPerPermBuffEnchantedWeight: 0.20 } },
    { id: 'C36', tags: ['endless', 'battle', 'shop', 'oncePerRun', 'ops'], name: '挥金如土', rarity: 3, kind: 'permanent', maxStacks: 1,
      desc: '每在试炼商店消费 5/10/15 试炼币，随机获得力/敏/速 +1 或生命上限 +5 中的一项',
      mods: { shopSpendStep: 5, shopSpendTiers: [5, 10, 15], shopSpendTierSize: 20,
        shopSpendStat: 1, shopSpendHp: 5, pityWeight: 0 } },
    /* C37「虚空铭文」的自我降权：改成与终焉烙印（C49）同一口径的**指数降权**
     *   同一个增益可以吃**多个不同**铭文，但同一张铭文不能重复附在同一条上（不可同名叠加）。 */
    { id: 'C37', tags: ['endless', 'battle', 'shop', 'repeatable', 'hidden', 'ops'], name: '虚空铭文', rarity: 3, kind: 'inscription',
      desc: '从永久增益里三选一，给它附上虚空铭文：它不再占用永久增益位',
      mods: { pickPermanentFree: 1, weightDivBy: 'enchanted', weightDecay: 0.88, pityWeight: 1 } },
    /* 「水晶铭文」C60（史诗级铭文）：给**选中的那一条**永久增益附魔 ×1.5。
     * 降权口径与虚空铭文一致（`weightDecay 0.88^n`），但**计数必须用自己的**：
     * ⚠ 2026-10 第八十批修 bug：原来照抄 C37 的 `'enchanted'`（数的是**虚空**的不占位标记），
     * 于是水晶铭文附魔再多条，它自己的 n 也一直是「被虚空附魔过的条数」（多半是 0）→ 0.88^n 从未生效。 */
    { id: 'C60', tags: ['endless', 'battle', 'shop', 'repeatable', 'hidden', 'ops'], name: '水晶铭文', rarity: 2, kind: 'inscription',
      desc: '从永久增益里三选一，给它附上水晶铭文：这一条本局的效果 ×1.5',
      mods: { pickPermanentMul: 1.5, weightDivBy: 'enchantedBy', weightDecay: 0.88, pityWeight: 1 } },
    /* 铭文的另外两档：普通「碎裂铭文」、稀有「延续铭文」。
     *（`weightDivBy: 'owned'`，count = run.pickGot）—— 它们不给谁附魔，所以**不能用 'enchanted'**
     *（那是虚空铭文的不占位计数，与它们毫无关系；第八十批一并修正）。 */
    { id: 'C61', tags: ['endless', 'battle', 'shop', 'repeatable', 'hidden', 'ops'], name: '碎裂铭文', rarity: 0, kind: 'inscription',
      desc: '从已有的烙印增益里三选一，让它立刻破碎（同一烙印有多份则一起破碎）',
      mods: { pickBrandBreak: 1, weightDivBy: 'owned', weightDecay: 0.88, pityWeight: 1 } },
    { id: 'C62', tags: ['endless', 'battle', 'shop', 'repeatable', 'hidden', 'ops'], name: '延续铭文', rarity: 1, kind: 'inscription',
      desc: '从已有的限次增益里三选一（流程类除外），它的剩余场次 +5',
      mods: { pickLimitedUses: 5, weightDivBy: 'owned', weightDecay: 0.88, pityWeight: 1 } },
    /* 烙印系列全部可无限叠加：每获得一份登记一份，损毁也逐份摇；必须显式写
   * unlimitedStacks: true，否则 stackCap 兜底 1 会显示成「同名唯一」。
   * uses: 1000 只是限次壳子，不要改成 maxStacks（那会变成获得次数上限）。 */
    { id: 'C39', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '力量烙印', rarity: 0, kind: 'limited', uses: 1000,
      desc: '力量 +5%，损毁后 +8% 并本局永久保留；每胜利一场6%概率损毁',
      unlimitedStacks: true,
      mods: { fragileStat: 'power', fragilePct: 0.05, fragileBurnedPct: 0.08, fragileBreakPct: 6 } },
    { id: 'C40', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '敏捷烙印', rarity: 0, kind: 'limited', uses: 1000,
      desc: '敏捷 +5%，损毁后 +8% 并本局永久保留；每胜利一场6%概率损毁',
      unlimitedStacks: true,
      mods: { fragileStat: 'agility', fragilePct: 0.05, fragileBurnedPct: 0.08, fragileBreakPct: 6 } },
    { id: 'C41', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '速度烙印', rarity: 0, kind: 'limited', uses: 1000,
      desc: '速度 +5%，损毁后 +8% 并本局永久保留；每胜利一场6%概率损毁',
      unlimitedStacks: true,
      mods: { fragileStat: 'speed', fragilePct: 0.05, fragileBurnedPct: 0.08, fragileBreakPct: 6 } },
    { id: 'C42', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '力量烙印·精', rarity: 1, kind: 'limited', uses: 1000,
      desc: '力量 +12%，损毁后 +16% 并本局永久保留；每胜利一场6%概率损毁',
      unlimitedStacks: true,
      mods: { fragileStat: 'power', fragilePct: 0.12, fragileBurnedPct: 0.16, fragileBreakPct: 6 } },
    { id: 'C43', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '敏捷烙印·精', rarity: 1, kind: 'limited', uses: 1000,
      desc: '敏捷 +12%，损毁后 +16% 并本局永久保留；每胜利一场6%概率损毁',
      unlimitedStacks: true,
      mods: { fragileStat: 'agility', fragilePct: 0.12, fragileBurnedPct: 0.16, fragileBreakPct: 6 } },
    { id: 'C44', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '速度烙印·精', rarity: 1, kind: 'limited', uses: 1000,
      desc: '速度 +12%，损毁后 +16% 并本局永久保留；每胜利一场6%概率损毁',
      unlimitedStacks: true,
      mods: { fragileStat: 'speed', fragilePct: 0.12, fragileBurnedPct: 0.16, fragileBreakPct: 6 } },
    { id: 'C49', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '终焉烙印', rarity: 3, kind: 'limited', uses: 1000, shopWeight: 0.8,
      desc: '力/敏/速/生命上限 +20%（终乘），损毁后本局 +30%；每胜利一场6%概率损毁',
      mods: { fragileFinalMul: true, fragileAddAlive: 0.20, fragileAddBurned: 0.30, fragileBreakPct: 6,
        repeatWeight: 0.88, pityWeight: 1 },
      unlimitedStacks: true },
    { id: 'C52', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '涌泉烙印', rarity: 1, kind: 'limited', uses: 1000,
      desc: '治疗量 +10%，损毁后本局 +20%',
      unlimitedStacks: true,
      mods: { fragileHealAddAlive: 0.10, fragileHealAddBurned: 0.20,
        fragileBreakPct: 6 } },
    /* 淘金烙印 —— **烙印类里的特殊烙印**（2026-10 用户口径，第七十二批）：
     *   「目前只有该烙印在**拾取一次后立马移除出该场所有 buff 池**，与碎不碎裂无关。」
     *   「拾取一次之后，战斗掉落 / 场间选择 / 商店都不再出现它」—— 碎没碎、碎了几份都不影响。
     *   加成的逐份累计与损毁仍走烙印那套（applyBuffOnAcquire / resetGrowth / rollFragileBuffs）。 */
    { id: 'C53', tags: ['endless', 'battle', 'limited', 'repeatable', 'ops'], name: '淘金烙印', rarity: 3, kind: 'limited', uses: 1000,
      desc: '战斗获得试炼币 +15%，损毁后本局 +30%；每胜利一场6%概率损毁（拾取一次后本局不再出现）',
      maxStacks: 1,
      mods: { fragileCoinAddAlive: 0.15, fragileCoinAddBurned: 0.30, fragileBreakPct: 6 } },
    { id: 'C54', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '越战越勇', rarity: 2, kind: 'permanent', maxStacks: 2,
      desc: '战斗中每回合开始时，力量、敏捷、速度各 +1.5%；每场战斗结束时清零',
      mods: { roundStatPct: 0.015 } },
    /* noRestack（任务4）：同名唯一，拿到一次后移出本局可获得池。 */
    { id: 'C55', tags: ['endless', 'battle', 'shop', 'noRestack'], name: '后发制人', rarity: 3, kind: 'permanent',
      desc: '每回合开始时，若力/敏/速有低于对手的，把差距最大的一项补上 10%，对方同减；战斗结束清零',
      mods: { catchUpPct: 0.10 } },
    { id: 'C56', tags: ['endless', 'battle', 'shop', 'unique'], name: '风影身法', rarity: 1, kind: 'permanent',
      desc: '每场战斗中，我方第一次受到的伤害降低为 0',
      mods: { firstHitZero: 1, firstHitZeroName: '风影身法' } },
    { id: 'C57', tags: ['tower', 'endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '玉石俱焚', rarity: 2, kind: 'limited', uses: 10,
      desc: '下一场战斗每回合开始时，我方与敌方的生命上限各 ×90%（向下取整）',
      descEndless: '限次 10 场：每回合开始时我方与敌方的生命上限各 ×90%（向下取整）',
      mods: { roundMaxHpMul: 0.90 } },
    { id: 'C58', tags: ['endless', 'battle', 'shop', 'noRestack', 'ops'], name: '豪掷千金', rarity: 2, kind: 'permanent', maxStacks: 1,
      desc: '每在试炼商店买货或买铸币消费 100 试炼币，立即获得 1 个随机限次增益（刷新不算；越稀有越难出）',
      mods: { shopSpendLimited: 100, limitedDefaultRerollPaid: 10 } },
    { id: 'C59', tags: ['endless', 'battle', 'shop', 'stackable', 'noRestack', 'ops'], name: '门庭若市', rarity: 2, kind: 'permanent', maxStacks: 2,
      desc: '每进入一次商店，立即获得 80 试炼币',
      mods: { shopEnterCoins: 80 } },
    { id: 'C38', tags: ['tower', 'endless', 'battle', 'shop', 'unique'], name: '先机预判', rarity: 2, kind: 'permanent',
      desc: '每场战斗中，敌方对我方的第一次攻击必定闪避，且我方立刻额外行动一次',
      mods: { firstDodge: 1, firstDodgeFreeTurn: 1 } },

    { id: 'HS01', tags: ['endless', 'shop', 'hero', 'ops', 'repeatable'], name: '勇者修炼札', rarity: 1, kind: 'instant',
      desc: '随机选择一个未满级的局内武技，连续进行3次普通升级尝试；遵循原成功率与失败保底', mods: { heroTraining: 3 } },
    { id: 'HS02', tags: ['endless', 'shop', 'hero', 'ops', 'repeatable'], name: '遗忘与新生', rarity: 2, kind: 'instant',
      desc: '自选遗忘一个已学武技，再自选学习一个尚未掌握的武技；新武技继承被遗忘武技的等级', mods: { heroReplace: 1 } },
    { id: 'HS03', tags: ['endless', 'shop', 'hero', 'ops', 'repeatable'], name: '大师传承', rarity: 2, kind: 'instant',
      desc: '自选一个未满级的局内武技，直接升到真5满级', mods: { heroGuaranteedMax: 1 } },
    { id: 'HS04', tags: ['endless', 'shop', 'hero', 'ops', 'repeatable'], name: '禁书残页', rarity: 3, kind: 'instant',
      desc: '随机学会一个尚未掌握的5级武技；该武技不占普通24项上限，即使未满24项也不计数', mods: { heroSecret: 1, repeatWeight: 0.5 } },
    { id: 'HB01', tags: ['endless', 'story', 'catalog', 'blade'], name: '渴血之剑', rarity: 3, kind: 'limited', uses: 8, maxStacks: 5,
      desc: '战斗中：力量 +10%/层、攻击吸血 +3%/层、受到伤害 +3%/层。每场战斗后必须献祭一件史诗+限次或永久增益来喂养它（献祭使其成长 1 层；没有可献祭的增益时不会卡住，自动吞噬 1 次使用次数继续）。限次 8 场；用尽后进化为下一阶段。闲置 20 场会强制苏醒。',
      mods: { powerMul: 0.10, lifestealPct: 0.03, takenMul: 0.03 } },
    { id: 'HB02', tags: ['endless', 'story', 'catalog', 'blade'], name: '渴血之剑·饥', rarity: 3, kind: 'limited', uses: 8, maxStacks: 5,
      desc: '战斗中：力量 +13%/层、攻击吸血 +5%/层、受到伤害 +4%/层。每场战斗后仍要献祭（史诗+限次或永久；没有可献祭的增益时自动吞噬 1 次使用次数继续）；限次 8 场，用尽后进化为下一阶段。',
      mods: { powerMul: 0.13, lifestealPct: 0.05, takenMul: 0.04 } },
    { id: 'HB03', tags: ['endless', 'story', 'catalog', 'blade'], name: '渴血之剑·狂', rarity: 3, kind: 'limited', uses: 8, maxStacks: 5,
      desc: '战斗中：力量 +18%/层、攻击吸血 +8%/层、受到伤害 +5%/层。每场战斗后仍要献祭（没有可献祭的增益时自动吞噬 1 次使用次数继续）；限次 8 场，用尽后进化为王者之剑。',
      mods: { powerMul: 0.18, lifestealPct: 0.08, takenMul: 0.05 } },
    { id: 'HB04', tags: ['endless', 'story', 'catalog', 'blade'], name: '王者之剑', rarity: 3, kind: 'limited', uses: -1, maxStacks: 5,
      desc: '最终形态：力量 +30%/层、攻击吸血 +12%/层、暴击率 +7%/层、暴击伤害 +20%/层，受到伤害 +5%/层；对镜之魔王额外削减其力量与生命上限。永续，不再消耗次数、不再需要献祭。',
      mods: { powerMul: 0.30, lifestealPct: 0.12, takenMul: 0.05, critBonus: 7, critDmgBonus: 0.20, kingMirrorBlade: 1 } },
    { id: 'HB05', tags: ['endless', 'story', 'catalog', 'blade'], name: '涸血之剑', rarity: 3, kind: 'limited', uses: -1, maxStacks: 5,
      desc: '彻底失活：受到伤害 −6%/层、每回合回复 1%/层最大生命、生命上限 +4%/层、开局护盾 +3%/层。永续，不再需要献祭。',
      mods: { takenMul: -0.06, regenPct: 0.01, maxHpMul: 0.04, shellPct: 0.03 } },
    /* 照影之境：整百层固定奖励，进永久区最前；story/hidden 保证不进随机池、不可出售献祭。
   * 减伤按伤害倍率乘算；mods 留空以免重复叠加。效果 desc 写 ？？？，每过 100 层叠一层。 */
    { id: 'C63', tags: ['endless', 'story', 'hidden', 'catalog'], name: '照影之境', rarity: 3, kind: 'permanent',
      unlimitedStacks: true,
      flavor: '映出一具完美的躯壳',
      desc: '？？？',
      mods: {} },
  ]);

  const BUFF_BY_ID = Object.fromEntries(BUFFS.map((b) => [b.id, b]));
  /* 「下一场战斗」语义的增益 id 集合（挑战塔里打完一场即消耗，卡面不显示限次）。 */
  const TOWER_BATTLE_IDS = BUFFS.filter((b) => hasTag(b, 'nextBattle')).map((b) => b.id);
  const RARITY_NAME = ['普通', '稀有', '史诗', '传奇'];
  const RARITY_WEIGHTS = [66, 21, 10, 3];        // 每个随机槽独立 Roll；传奇实际基础权重走 LEGEND_BASE_WEIGHT
  const SHOP_DISCOUNT_E04 = 0.30;
  const SHOP_DISCOUNT_E01 = 0.30;
  const SHOP_DISCOUNT_BOTH = 0.60;
  const FIXED_HEAL_PCT = 0.5;
  const AUTO_HEAL_PCT = 0.10;                    // 每场打完自动回复的比例（2026-10 由 0.14 下调）
  const ENDLESS_LAYER_HEAL_PCT = 0.20;
  const STACK_MAX = 3;
  /* 叠层上限的唯一判据（poolFilter / addBuff / normalizeRun 三处必须同一口径）。
   *   unlimitedStacks: true → 无上限（C26-C29 这类「可无限叠」的成长件）；
   *   都没写             → 全局 STACK_MAX。 */
  function stackCap(buff) {
    if (!buff) return STACK_MAX;
    if (buff.unlimitedStacks === true) return Infinity;
    const n = Math.floor(Number(buff.maxStacks));
    if (n >= 1) return n;
    /* 【2026-10 修正】**没有 `stackable` 标签的一律「同名不同栏」**：
     * 不再吃 `STACK_MAX = 3` 的兜底（那会让「同名唯一」的件在同一栏里悄悄叠到 3 层，
     * 只有带 `stackable` 的（C06/C07 这类没写 maxStacks 的）才用 STACK_MAX 兜底。 */
    return hasTag(buff, 'stackable') ? STACK_MAX : 1;
  }
  /* 增益表口径版本：只用来判断「这份存档是不是重排序号**之前**存的」。
   * 旧档没有这个字段（读到 undefined）→ 需要迁移一次；新档一律等于 BUFF_VER。 */
  const BUFF_VER = 2;
  /* 旧存档的增益 id 迁移表：这次重排了 G/T 两组序号（删掉 G03-G05 与 T03/T06/T08/T09 之后
   * 其余前移）。存档里只存 id，只能按 BUFF_VER 判断一次 ——
   * **新档绝不走这张表**：否则新代码里合法的 T04（见血封喉）会被误当旧 T04 搬成 T03（锁定打击）。
   * 被删掉的那几个（旧 G03/G04/G05、旧 T03/T06/T08/T09、C08）不在此表，读档时按未知 id 丢弃。 */
  const LEGACY_BUFF_IDS = Object.freeze({
    G06: 'G03', G07: 'G04',                 // 凌波微步 / 破釜沉舟 前移
    T07: 'T05', T10: 'T06', T11: 'T07', T12: 'T08',   // 以血换血/背水一战/不动如山/先发制人 前移
    T04: 'T03', T05: 'T04',                 // 锁定打击 / 见血封喉 前移
  });
  /* 每层通关结算时补发的「悬浮奖品」场数：塔内战斗关掉了飘物掉落（防免门票刷资源），
   * 所以按**一整个常驻挑战关 = 3 场**的掉落量补回来（每场 3 个飘物 → 共 9 个）。 */
  const SETTLE_DROP_BATTLES = 3;

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

  /* 增益标签是池子 / 展示 / 掉落的唯一判据：场所（tower/endless/shop）、来源（battle）、
   * 旧字段由标签反推写回，不一致会在加载期抛错。 */
  const BUFF_TAGS = Object.freeze({
    hero: '勇者模式专属：只进入勇者对局的来源池',
    tower: '挑战塔：进挑战塔的场间选择池',
    endless: '无尽塔：进无尽塔的场间选择池 / 商店 / 增益集锦',
    shop: '商店：上试炼商店货架（需同时有 endless）',
    battle: '战斗掉落：作为打赢后的奖励选项出现',
    limited: '限次类：效果只服务下一场战斗',
    nextBattle: '效果只服务下一场战斗',
    stackable: '可叠层：可重复获得并叠加',
    quietStack: '不显示叠层说明：同名多份只按拾取逐条生效',
    oncePerRun: '每局限次获得：一局只能拿到一次',
    noRestack: '拿满上限后移出本局可获得池（不参与「叠满开新栏位」的通用规则）',
    repeatable: '可重复获得（非同名唯一）',
    unique: '同名唯一：拿到后不再进池',
    hidden: '不进「增益集锦」展示（彩蛋/特殊获取）',
    catalog: '即使带 hidden 也要进「增益集锦」展示（铭文、选取型强化这类玩家该知道的特殊获取）',
    story: '剧情固定获得：只由剧情节点（整百层「觐见魔王」）发放，不进任何随机池 / 商店货架',
    blade: '渴血之剑系列：剧情固定、限次区、不可出售 / 交换；状态机按阶段与献祭单独结算',
    ops: '运营类：经济/运营向（试炼币、商店、铸币、出售、商店消费、永久槽位扩容）',
  });
  /* 池子 ← 需要哪些标签：这里的定义就是「严格池子管理」的规则表。 */
  const POOL_TAGS = Object.freeze({
    'T.choice': ['tower', 'battle'],      // 挑战塔场间选择
    'T.shop': ['tower', 'shop'],           // 挑战塔商店（塔目前没有商店，保留概念）
    'E.choice': ['endless', 'battle'],     // 无尽塔场间选择（战斗奖励）
    'E.shop': ['shop'],                    // 无尽塔试炼商店
    /* 剧情固定获得（照影之境）：这个池子**不是抽取来源**，只是给「严格池子管理」一个归属 ——
     * 有它才能在加载期通过「推不出任何池子就抛错」那道闸，同时保证它不会被任何随机抽奖取到
     *（随机来源按 E.choice / E.shop 取，它两个都不满足）。 */
    'E.story': ['endless', 'story'],
  });
  /* 这几个写成 function 声明（会提升）：文件前面的表（TOWER_BATTLE_IDS 等）
   * 也要按标签筛，不能等到这里才可用。 */
  function tagSet(b) { return b && Array.isArray(b.tags) ? b.tags : []; }
  function hasTag(b, t) { return tagSet(b).indexOf(t) >= 0; }
  function tagsOf(b) { return tagSet(b).slice(); }
  function buffsWithTag(t) { return BUFFS.filter((b) => hasTag(b, t)); }
  function poolsOf(b) { return Object.keys(POOL_TAGS).filter((pool) => POOL_TAGS[pool].every((t) => hasTag(b, t))); }
  /** 叠层说明：写进 `descOf` 的尾巴，避免 100+ 条文案各写一遍、还容易跟数据脱节。
   *    · `unique`          → 同名唯一，拿到后本局不再出现（只有 1 层）
   *    · `noRestack`       → 可叠到上限，拿满后本局不再出现（cap=1 时就是「只有 1 层」）
   *    · 其余永久件        → 不叠层：每份占一个新栏位（同名可多拿，栏位满了才停）
   *  即时类不做叠层，也只对可重复获得的写一句。 */
  function stackNote(buff) {
    if (!buff || !hasTag(buff, 'endless')) return '';
    /* 铭文类（kind: 'inscription'）：不占栏位、也不能同名叠加 —— 用自己的说明，
     * 别走下面那套「每份占一个新栏位」的栏位口径（那对铭文是错的）。 */
    if (buff.kind === 'inscription') return '铭文类：不占永久栏位';
    const cap = stackCap(buff);
    if (buff.kind === 'instant') {
      return hasTag(buff, 'repeatable') ? '可重复获得，效果可累积' : '';
    }
    /* 隐藏叠层说明：暴击精通这类按「重复拾取各占一栏」走，不在卡面写叠层规则。 */
    if (hasTag(buff, 'quietStack')) return '';
    if (hasTag(buff, 'unique')) return '同名唯一，只有 1 层';
    if (hasTag(buff, 'oncePerRun')) return '同名最多 1 份，一局只可能拿到一次';
    if (cap === Infinity) return '可无限叠加';
    if (cap > 1) return hasTag(buff, 'noRestack') ? '最多叠 ' + cap + ' 层，拿满后本局不再出现' : '最多叠 ' + cap + ' 层';
    if (hasTag(buff, 'noRestack')) return '同名唯一，只有 1 层';
    if (buff.kind === 'limited') {
      const fragile = !!(buff.mods && buff.mods.fragileBreakPct);
      return fragile ? '同名唯一，用尽或损毁后才可能再获得' : '同名唯一，用尽后才可能再获得';
    }
    return '不叠层：每份占一个新栏位';
  }
  /** 增益说明：**按所在塔取不同文案**。
   *  只有需要两套说法的条目才写 descEndless（例：C57 玉石俱焚 —— 挑战塔写「下一场战斗」，
   *  无尽塔是 10 次限次，要写清「限次 10 场」并让界面显示剩余次数）。
   *  末尾统一补一句叠层上限（见 stackNote），所以界面上每条增益都能看到「最多几层」。 */
  function descOf(buff, mode) {
    if (!buff) return '';
    const base = (mode === 'endless' && buff.descEndless) ? buff.descEndless : buff.desc;
    /* 【U20】剧情件（照影之境）**不追加叠层说明**：它的介绍按用户口径就是 `？？？`，
     * 尾巴上挂一句「可无限叠加」等于剧透。叠了多少层在「永久增益」的卡面上照旧显示 `×N`。 */
    if (hasTag(buff, 'story')) return base;
    const note = stackNote(buff);
    return note ? base + '（' + note + '）' : base;
  }
  /** 商店卡面用的**短介绍**：
   *  · 不追加「同名唯一 / 用尽后才可能再获得 / 一局只可能拿到一次 / 拿满后本局不再出现」
   *    这类生命周期提示 —— 商店卡位窄，玩家要先看效果与叠层上限；
   *  · 保留真正的叠层上限（「最多叠 N 层」「可无限叠加」）与铭文「不占永久栏位」；
   *  · 完整文案仍走 `descOf`（集锦 / 悬停 / 弹窗）；商店卡面只展示短文案，
   *  硬上限 6 行由 css/tower.css 的 `.shop-desc` 负责，数据侧尽量写到 6 行以内。 */
  function shopDescOf(buff, mode) {
    if (!buff) return '';
    const base = (mode === 'endless' && buff.descEndless) ? buff.descEndless : buff.desc;
    if (hasTag(buff, 'story')) return base;
    if (buff.kind === 'inscription') return base + '（铭文类：不占永久栏位）';
    const cap = stackCap(buff);
    if (cap === Infinity) return base + '（可无限叠加）';
    if (cap > 1) return base + '（最多叠 ' + cap + ' 层）';
    return base;
  }
  /* 无尽专属 mod：带这些效果的增益只在无尽塔成立（环境词缀 / 试炼币 / 商店 /
   * 铸币 / 结算 / 商店消费相关）。挑战塔带这类标签/效果一律加载期报错。 */
  const ENDLESS_ONLY_MODS = [
    'envIgnore', 'envReflect', 'envDenyGood', 'instantCoins', 'coinBoostPct', 'shopDiscount',
    /* 注意 enemyPowerDown 不在这里：挑战塔的 M01「威慑」也用它（下一场敌人攻击力 −30%），
     * 它是通用的「下一场战斗」减益，不是无尽专属。 */
    'openShop', 'instantRetry', 'enemyMaxHpDown', 'permSlot', 'pickWeaponPct',
    'pickSkillPct', 'pickPermanentFree', 'pickPermanentMul', 'pickBrandBreak', 'pickLimitedUses',
    'breakAllBrands', 'brandGate', 'sellValue', 'sellGrowthPerWin', 'postBattleShop',
    'postBattleShopDiscount', 'postBattleMintShop', 'shopSpendStep', 'shopSpendStat', 'shopSpendHp',
    'shopSpendLimited', 'shopEnterCoins', 'rerollTiltMul', 'shopHalf', 'layerRestart',
    /* 「份数越多、再出现概率越低」（weight = 初始 ÷ n 或 ×0.88^n）与「豪掷千金」的默认权重（按稀有度）
     * —— 都是无尽商店专属。 */
    'weightDivBy', 'weightDivOffset', 'weightDecay', 'limitedDefaultRerollPaid', 'pityWeight',
  ];
  function hasEndlessOnlyMod(b) { return Object.keys(b.mods || {}).some((k) => ENDLESS_ONLY_MODS.indexOf(k) >= 0); }
  function poolRoster(b) {
    return poolsOf(b);
  }
  const ROSTERS = Object.freeze(BUFFS.map((b) => ({ b, pools: poolsOf(b) })));
  const inPool = (tag, buff) => {
    const row = ROSTERS.find((r) => r.b.id === buff.id);
    return !!(row && row.pools.indexOf(tag) >= 0);
  };
  /* 兼容旧调用点（POOLS.tower / POOLS.endless / POOLS.shop）。 */
  const POOLS = Object.freeze({
    tower: (b) => inPool('T.choice', b),
    endless: (b) => inPool('E.choice', b),
    shop: (b) => inPool('E.shop', b),
  });
  for (const b of BUFFS) {
    const tags = tagSet(b);
    if (!tags.length) throw new Error('增益 ' + b.id + '（' + b.name + '）没有 tags —— 池子归属必须显式声明');
    for (const t of tags) if (!BUFF_TAGS[t]) throw new Error('增益 ' + b.id + ' 用了未登记的标签：' + t);
    if (!tags.some((t) => ['tower', 'endless', 'shop'].indexOf(t) >= 0)) {
      throw new Error('增益 ' + b.id + '（' + b.name + '）没有场所标签（tower/endless/shop）—— 它不会出现在任何地方');
    }
    if (hasTag(b, 'battle') && !hasTag(b, 'tower') && !hasTag(b, 'endless')) {
      throw new Error('增益 ' + b.id + ' 标了 battle 却没标 tower/endless —— 不知道该掉在哪座塔');
    }
    if (hasTag(b, 'shop') && !hasTag(b, 'endless')) {
      throw new Error('增益 ' + b.id + ' 标了 shop 却没标 endless —— 只有无尽塔有商店');
    }
    if (!poolsOf(b).length) throw new Error('增益 ' + b.id + '（' + b.name + '）推不出任何池子');
    /* 行为标签必须与数据自洽 */
    if (hasTag(b, 'limited') && b.kind !== 'limited') throw new Error('增益 ' + b.id + ' 标了 limited 但 kind 不是 limited');
    if (hasTag(b, 'nextBattle') && b.kind !== 'limited') throw new Error('增益 ' + b.id + ' 标了 nextBattle 但 kind 不是 limited');
    if (hasTag(b, 'oncePerRun') && Number(b.maxStacks) !== 1) throw new Error('增益 ' + b.id + ' 标了 oncePerRun 但 maxStacks 不是 1');
    if (hasTag(b, 'unique') && hasTag(b, 'repeatable')) throw new Error('增益 ' + b.id + ' 不能同时 unique 与 repeatable');
    if (hasTag(b, 'catalog') && !hasTag(b, 'endless')) {
      throw new Error('增益 ' + b.id + ' 标了 catalog 却不是无尽塔增益 —— 集锦只列无尽塔条目');
    }
    /* 挑战塔里不能出现「只有无尽塔才有」的机制 */
    if (hasTag(b, 'tower') && hasEndlessOnlyMod(b)) {
      const bad = Object.keys(b.mods || {}).filter((k) => ENDLESS_ONLY_MODS.indexOf(k) >= 0);
      throw new Error('挑战塔池不该包含无尽专属增益 ' + b.id + '（' + bad.join(',') + '）—— 请去掉 tower 标签');
    }
  }
  /* ---- 冗余守门：**旧字段一律不许再写** ----
   * 池子归属、可叠层、同名唯一、限次生命周期……全都由 `tags` 表达，
   * repeatable / unique / nextBattle / hidden 这些布尔字段就是冗余，直接抛错。
   * （历史上这些字段是从一堆分支里反推池子的，漏标一次就会串池 —— 现在只留标签一条路。） */
  const FORBIDDEN_FIELDS = ['towerOnly', 'endlessOnly', 'battleOnly', 'shopBanned',
    'stackable', 'repeatable', 'unique', 'nextBattle', 'hidden'];
  for (const b of BUFFS) {
    const bad = FORBIDDEN_FIELDS.filter((k) => k in b);
    if (bad.length) {
      throw new Error('增益 ' + b.id + ' 还写着冗余字段 ' + bad.join(',') + ' —— 请改用 tags 表达');
    }
  }

  const towerPool = ROSTERS.filter((r) => r.pools.indexOf('T.choice') >= 0).map((r) => r.b);
  const endlessPool = ROSTERS.filter((r) => r.pools.indexOf('E.choice') >= 0).map((r) => r.b);
  const shopPool = ROSTERS.filter((r) => r.pools.indexOf('E.shop') >= 0).map((r) => r.b);
  /* ---- 铸币商店的两个池子 ----
   *   · **明确「不上商店」的**（layerRestart = 时间回廊）—— 用户口径：它只能在战斗奖励里拿到，
   * ops 子池 = 带 `ops` 标签的运营类；传奇档不设「优先运营」限制（见 tower.js 的 rollMintSlots）。 */
  const MINT_EXCLUDE_MODS = ['instantRetry', 'layerRestart'];
  const mintPool = BUFFS.filter((b) => hasTag(b, 'endless') && !hasTag(b, 'story')
    && !MINT_EXCLUDE_MODS.some((k) => Object.prototype.hasOwnProperty.call(b.mods || {}, k)));
  const opsPool = BUFFS.filter((b) => hasTag(b, 'ops'));
  /* ---- 铸币商店的守门 ----
   *   · 四档稀有度都要有能上架的商品，否则那一档的价格永远用不到。 */
  for (const b of opsPool) {
    if (!hasTag(b, 'endless')) {
      throw new Error('增益 ' + b.id + '（' + b.name + '）标了 ops 却不是无尽塔增益 —— 运营类机制只在无尽塔成立');
    }
  }
  for (let r = 0; r < RARITY_NAME.length; r++) {
    if (!mintPool.some((b) => b.rarity === r)) {
      throw new Error('铸币商店：' + RARITY_NAME[r] + ' 档没有任何可上架的商品（价格表会永远用不到）');
    }
  }
  const PERMANENT_SLOTS = 5;


  window.TowerData = {
    towerLevel, towerMult, towerGold, towerGoldShares, TOWER_FAIL_CONSOLATION,
    TOWER_LEVEL_CAP, TOWER_MULT_CAP_LAYER, TOWER_GOLD_CAP,
    TOWER_GOLD_BASE, TOWER_GOLD_STEP, TOWER_GOLD_CAP_LAYER, TOWER_GOLD_X5_MUL, TOWER_GOLD_X10_MUL,
    TOWER_EARLY_HP_MUL, towerGoldBase, towerEarlyHpMul,
    endlessLevel, endlessSegment, endlessMult, endlessMechStacks, endlessMechs, ENDLESS_MECH_MAX, endlessTickets,
    GEAR_TIER, gearKeyForLayer, gearTierCap, ENDLESS_BOSS_POOL, BOSS_GEAR_RARITY, bossGearTier, endlessBossWeights,
    bossIsLegendary, legendaryChance,
    ENDLESS_ENV, ENDLESS_ENV_BY_ID, envChance, rollEnvMods, envText, envRange, envRangeText, envPctKeys,
    envPoolFor, envDefFor, ENDLESS_REWARD_MOD_KEYS, envPreviewText,
    ENV_START_LAYER, ENV_TWO_LAYER, ENV_MAX, ENV_DUR, repeatChanceInterval,
    ENV_CHANCE_START, ENV_CHANCE_STEP, ENV_CHANCE_CAP, ENV_CHANCE_CAP_LAYER,
    ENDLESS_MECH_ORDER, ENDLESS_CONSOLATION_LAYER, SCORE, COINS, SHOP, shopPrice,
    COIN_BATTLE_TIERS, coinBattleTier, coinBattleBase, coinBattleTierLabel, coinBattleTableText,
    FOE_STAT_MUL, FOE_POWER_MUL, FOE_HP_MUL, FOE_HERO_HP_MUL, FOE_HERO_POWER_MUL,
    FOE_TRIAL_POWER_MUL, FOE_WARLORD_POWER_MUL, FOE_CAMPAIGN_POWER_MUL, CAMPAIGN_HP_RATIO,
    endlessXhTune, XH_ENDLESS_TUNE,
    bossHpRatio, endlessBossHpRatio, BOSS_HP_MIN, BOSS_HP_MAX, WARLORD_HP_RATIO,
    ENDLESS_LAYER_HEAL_PCT, MILESTONE_EVERY, MILESTONE_BOOK_COUNT, rollMilestone, PERMANENT_SLOTS,
    endlessDepthMul, ENDLESS_DEEP_LAYER, ENDLESS_SKIP_LAYER,
    /* 【D2b】100 层循环：「第 101 层回到像第 1 层一样」的那组规则 + 敌人成长倍率口径。 */
    LAYER_CYCLE, ENDLESS_CYCLE_DISCOUNT, layerCycle, cycleLayer, SHOP_SLOT_TIERS, CHOICE_CUT_TIERS, shopSlotCut, choiceCut,
    endlessShopSlots, layerNoShop, layerModsOn, envAllowed, brandLossAllowed, sacrificeAllowed,
    canHaveEnv, canBrandLoss, BRAND_LOSS_FROM,
    /* 【U20】整百层「镜中世界」：判据 + 照影之境（剧情固定奖励）的 id / 循环长度。 */
    isMirrorLayer, MIRROR,
    endlessScaleParts, FOE_STAT_MUL_NOTE,
    buffScore, reviveScoreAt,
    SHOP_PRICE_OFFSET, rollShopPrice,
    shopPrice, shopBuyPrice,
    rerollPriceAt, rerollPriceCapped, rerollQualityCapped, mechSealsHeal, HEAL_SEAL_MECHS, rerollTilt, tiltRateMul, rawTierWeights, battleTierWeights, tiltWeights, rerollExpectation, RARITY_SCORE, shopQualityScore,
    TIER_DYNAMIC_WEIGHTS, TIER_AVG_INCLUDES_STATIC, LEGEND_PITY, TICKET_FROM_MINT_CAP, ENDLESS_X00_BONUS_TICKETS,
    shopPool, POOLS, inPool, RARITY_NAME, RARITY_WEIGHTS,
    PATROL, patrolLayerInBlock, isPatrolLayer, patrolName,
    MINT_SHOP, mintLayerOk, mintGroupOf, mintPrice, mintWeights, rollMintRarity, mintChance,
    mintPool, opsPool, MINT_EXCLUDE_MODS,
    BLADE, isBladeId, isBladeBuff, bladeStageOf, bladeNextId, bladeEventLayer,
    BUFF_TAGS, POOL_TAGS, hasTag, tagsOf, buffsWithTag, poolsOf, descOf, shopDescOf, stackNote,
    legendWeightFactor, legendOwnedCount, allRepeatableLegendsOwned, LEGEND_BASE_WEIGHT, LEGEND_BATTLE_WEIGHT, LEGEND_TIER_DECAY, rarityBoostOf,
    NPCS, NPC_BY_ID, HERO_DEBUFF,
    SQUIRRELS, SQUIRREL_BY_ID, squirrelFor,
    TRIALS, TRIAL_BY_ID, trialFor,
    GEAR, wearsOf, WARLORD, WARLORD_POOL, warlordFor,
    CAMPAIGN_BOSSES, CAMPAIGN_BOSS_BY_ID, campaignBossFor,
    BOSS_POOL, bossFor, heroOrder, ENDLESS_ONLY_MODS, poolRoster, ROSTERS,
    TOWER_BATTLE_IDS,
    BUFFS, BUFF_BY_ID, FIXED_HEAL_PCT, AUTO_HEAL_PCT, STACK_MAX, stackCap, LEGACY_BUFF_IDS, BUFF_VER,
    SHOP_DISCOUNT_E04, SHOP_DISCOUNT_E01, SHOP_DISCOUNT_BOTH,
    SETTLE_DROP_BATTLES,
    towerPool, endlessPool,
  };
})();
