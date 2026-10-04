/* ============================================================
 * tower-data.js — 无尽挑战塔 · 数值与池子定义（纯数据）
 * 依据 docs/无尽挑战塔系统设计文档.md v2.0。
 *
 * 目录（Ctrl+F 搜「【D编号】」直达）：
 *   【D1】主塔公式        【D6】NPC 池            【D11】x10 层守关：狂战松鼠
 *   【D2】无尽公式        【D7】三侠贯穿削弱      【D12】随机 boss 池与三侠顺序
 *   【D3】计分            【D8】松鼠装备分层      【D13】Buff 池（全表）
 *   【D4】试炼币与商店    【D9】松鼠对手          【D14】Buff 索引与杂项常量
 *   【D5】敌方数值系数    【D10】机制松鼠 boss    【D15】增益池注册（含加载期断言）
 *                                                 【D16】模块导出 window.TowerData
 * 公式与 gamedata.js 的关卡强度模型（STAGE_PLAYER_CURVE）对齐：
 *   主塔目标等级 LT(n) = min(70, round(28 + 1.4(n−1)))
 *   主塔强度系数 M(n)  = (1+0.03⌊(m−1)/5⌋)(1+0.04⌊(m−1)/10⌋), m=min(n,30)
 *   主塔单层松果 G(n)  = 15/20/28/38 分段；21 层起 38+3(n−20)，封顶 68
 *   无尽段系数   B(s)  = min(10, 1.5^(s−1)), s=⌈n/5⌉
 *   抽奖卷       T(s)  = s（s≤2）；2+2(s−2)（s≥3）——10 层前每档 +1、之后每档 +2
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * 【D1】主塔公式 —— towerLevel / towerMult / towerGold
   * ============================================================ */

  function towerLevel(n) { return Math.min(70, Math.round(28 + 1.4 * (n - 1))); }
  function towerMult(n) {
    const m = Math.min(Math.max(1, n), 30);
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

  /* ============================================================
   * 【D2】无尽公式 —— endlessLevel / endlessMult / 深层曲线 / 环境词缀数值
   * ============================================================ */

  function endlessLevel(n) { return Math.min(70, Math.round(24 + 1.2 * (n - 1))); }
  const endlessSegment = (n) => Math.max(1, Math.ceil(n / 5));
  function endlessMult(n) { return Math.min(10, Math.pow(1.5, endlessSegment(n) - 1)); }
  /* ============================================================
   * 30 层之后的「深度曲线」
   *
   * 原来敌人只有两条成长轴，各自都会**提前封顶**：
   *   · endlessLevel：第 40 层起封顶 70 级（属性基数的成长归零）
   *   · endlessMult ：第 31 层起封顶 ×10（段位倍率归零）
   * 两者一封顶，第 31 层往后敌人的血量/攻击就**完全不变**了 —— 所以体感是平的。
   *
   * 这条曲线**独立于那两条封顶**，只在 30 层之后叠加：
   *   30 层：×1.00（30 层及以前一点不影响，老平衡原样保留）
   *   40 层：×1.40      50 层：×2.18
   *   60 层：×3.87      70 层：×5.69
   * 50 层起额外加速（rate2 3.5%/层），避免「每层固定 +6%」在后期也显得不够。
   * ============================================================ */
  const ENDLESS_DEEP_LAYER = 30;
  const ENDLESS_DEEP_RATE1 = 0.07;
  const ENDLESS_DEEP_RATE2 = 0.09;
  const ENDLESS_DEEP_SPLIT = 20;      // 30 + 20 = 第 50 层开始切换速率
  /**
   * 30 层之后的敌方深度倍率（≤30 层恒为 1，不影响既有平衡）。
   *   · 30 层 ×1.00    40 层 ×1.97    50 层 ×3.87
   *   · 60 层 ×9.20    70 层 ×21.68   80 层 ×51.30   100 层 ×287.7
   * 对应「5 层环比」：50 层前 ×1.40，50 层后 ×1.54 且随深度缓慢变陡。
   */
  function endlessDepthMul(n) {
    const layer = Math.max(0, Number(n) || 0);
    const d = Math.max(0, layer - ENDLESS_DEEP_LAYER);
    const seg1 = Math.min(d, ENDLESS_DEEP_SPLIT);
    const seg2 = Math.max(0, d - ENDLESS_DEEP_SPLIT);
    return Math.pow(1 + ENDLESS_DEEP_RATE1, seg1) * Math.pow(1 + ENDLESS_DEEP_RATE2, seg2);
  }
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
    return s <= 2 ? s : 2 + 2 * (s - 2);
  }
  const ENDLESS_MECH_ORDER = ['thorns', 'regen', 'lifesteal', 'shell', 'devour'];
  const ENDLESS_MECH_MAX = 3;
  /* ============================================================
   * 环境词缀（无尽塔唯一的常驻负面机制）
   *
   * 以前有两套并行的「负面机制」：段位机制（thorns/regen/lifesteal/shell/devour，
   * 按段轮转、同屏最多 3 个、挂在本层所有敌人身上）与环境词缀（按战斗随机触发）。
   * 现在**全部合并到环境词缀**：环境是唯一的常驻负面来源，机制不再自动出现。
   *
   * 每条环境的数值都写成「区间」（如 [0.10, 0.16]），抽取时在区间内随机取值，
   * 所以同一条环境每次出现强度略有不同。`mods` 里的数字是区间上沿，
   * 实际生效值 = 区间随机值 ×（该 buff 的倍率）。
   * ============================================================ */
  /* 区间写法：'pct' = 比例（渲染成百分数）、'num' = 裸数值（渲染成点数）。
   * 例：[0.10, 0.16, 'pct'] → 显示 +13%；[18, 32, 'num'] → 显示 +24。 */
  const ENDLESS_ENV = Object.freeze([
    /* —— 原段位机制并入（这几个都是「敌人变强」类，bad=true）—— */
    { id: 'thorns', name: '荆棘反伤', bad: true, noReflect: true, mech: true, mods: { thornsPct: [0.10, 0.16, 'pct'] },
      desc: '敌人受到伤害时反弹 %thornsPct%' },
    { id: 'regen', name: '自愈回复', bad: true, noReflect: true, mech: true, mods: { regenPct: [0.02, 0.04, 'pct'] },
      desc: '敌人每回合回复 %regenPct% 最大生命' },
    { id: 'lifesteal', name: '吸血', bad: true, noReflect: true, mech: true, mods: { lifestealPct: [0.20, 0.32, 'pct'] },
      desc: '敌人造成伤害时回复其 %lifestealPct%' },
    { id: 'shell', name: '护盾', bad: true, noReflect: true, mech: true, mods: { shellPct: [0.18, 0.28, 'pct'] },
      desc: '敌人开局自带 %shellPct% 最大生命的护盾' },
    { id: 'devour', name: '吞噬成长', bad: true, noReflect: true, mech: true, mods: { devourPct: [0.015, 0.028, 'pct'] },
      desc: '敌人每回合攻击永久 %devourPct%（按入场力量，可无限叠加）' },
    /* —— 原有环境词缀 —— */
    { id: 'sun', name: '烈日灼烧', bad: true, noReflect: true, mods: { enemyCritBonus: [22, 28, 'num'], selfCritBonus: [8, 12, 'num'] },
      desc: '敌方暴击率 %enemyCritBonus%，我方暴击率 %selfCritBonus%' },
    /* 寒霜锁链：**敌方也降速**，但我方降得更多（敌方 -5%~-9%，我方 -11%~-19%）。
     * 两条数值各自在小区间内随机，但保持「我方降幅明显大于敌方」这个强度关系。 */
    { id: 'frost', name: '寒霜锁链', bad: true, noReflect: true,
      mods: { enemySpeedMul: [-0.09, -0.05, 'pct'], selfSpeedMul: [-0.19, -0.11, 'pct'] },
      desc: '敌方速度 %enemySpeedMul%，我方速度 %selfSpeedMul%' },
    { id: 'greed', name: '贪婪裂隙', bad: true, noReflect: true, mods: { coinBonus: [0.35, 0.6, 'pct'], enemyMaxHpMul: [0.10, 0.18, 'pct'] },
      desc: '我方试炼币 %coinBonus%，但敌方生命上限 %enemyMaxHpMul%' },
    { id: 'dusk', name: '血色黄昏', bad: false, mods: { bothLifestealPct: [0.10, 0.18, 'pct'] },
      desc: '双方吸血 %bothLifestealPct%' },
    /* —— 回响类：不改战斗数值，只改「打完这一场之后会发生什么」 ——
     * 幻影回响：**只**在三侠战生效，胜利后有 %repeatChance% 概率立刻再打同一场。
     * 数值随层数在 17%~23% 之间取值（见 repeatChanceInterval），
     * 目的是让「战斗叠层」类增益（猎杀时刻 / 吞噬成长 / 以战养战 / 登顶者 / 战斗续航）
     * 多一份弹性空间 —— 重复的那一场同样计入叠层（战斗续航也会再结算一次开战回血）。 */
    { id: 'echo', name: '幻影回响', bad: false, repeatOnly: true, maxStacks: 1,
      mods: { repeatChance: [0.17, 0.23, 'pct'] },
      desc: '三侠战胜利后有 %repeatChance% 概率立刻再战同一场（每场战斗至多触发一次；重复的战斗同样计入叠层）' },
  ]);
  const ENDLESS_ENV_BY_ID = Object.freeze(ENDLESS_ENV.reduce((m, e) => (m[e.id] = e, m), {}));
  /** 「幻影回响」在该层的概率区间：下沿固定 17%，上沿随层数从 17% 抬到 23%
   *  （第 1 层 17%，之后每层 +0.5%，第 13 层起封顶 23%）。
   *  这样「17~23%」这个区间本身就是**随层数展开**的，后期更容易触发。 */
  function repeatChanceInterval(layer) {
    const spec = (ENDLESS_ENV_BY_ID.echo.mods || {}).repeatChance;
    const lo = Array.isArray(spec) ? Number(spec[0]) : Number(spec);
    const hi = Array.isArray(spec) ? Number(spec[1]) : Number(spec);
    const t = Math.max(0, Math.min(1, (Math.max(1, Number(layer) || 1) - 1) / 12));
    return [lo, lo + (hi - lo) * t];
  }
  const ENV_START_LAYER = 5, ENV_TWO_LAYER = 15, ENV_MAX = 2, ENV_DUR = [4, 8];
  /** 区间 → [lo, hi] */
  function envRange(spec) {
    if (Array.isArray(spec)) return [Number(spec[0]), Number(spec[1])];
    return [Number(spec), Number(spec)];
  }
  /** 这条环境注明了哪些键是「比例」。 */
  function envPctKeys(def) {
    const out = {};
    for (const [key, spec] of Object.entries((def && def.mods) || {})) out[key] = Array.isArray(spec) && spec[2] === 'pct';
    return out;
  }
  /** 从一条环境的 mods 区间里取一组随机值 → { key: value }（每条环境自己摇一次）。 */
  function rollEnvMods(def) {
    const out = {};
    for (const [key, spec] of Object.entries((def && def.mods) || {})) {
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
  /** 把模板里的 %key% 用实际值渲染出来 → { text, values, keys }。 */
  function envText(def, values) {
    const v = values || rollEnvMods(def);
    /* 「幻影回响」的数值本身就是概率，直接按摇到的值渲染（不用「区间」写法），
     * 免得和别的环境一样显示成「+17%~+23%」。 */

    const keys = [];
    const text = String(def.desc || '').replace(/%([\w]+)%/g, (_, key) => {
      if (!keys.includes(key)) keys.push(key);
      return envValueText(def, key, v);
    });
    return { text: text, values: v, keys: keys };
  }
  /** 区间预览文字（悬停里说明「这条环境的数值范围」）。 */
  function envRangeText(def) {
    const pctKeys = envPctKeys(def);
    return Object.keys(def.mods || {}).map((key) => {
      const [lo, hi] = envRange(def.mods[key]);
      const fmt = pctKeys[key]
        ? (n) => Math.round(n * 100) + '%'
        : (n) => String(Math.round(n * 10) / 10);
      return fmt(lo) + ' ~ ' + fmt(hi);
    }).join('，');
  }
  /** 战斗后触发概率：5 层 ~20%，之后每层 +6%，40 层封顶 80%。 */
  function envChance(layer) {
    if (layer < ENV_START_LAYER) return 0;
    return Math.min(0.80, 0.14 + (layer - ENV_START_LAYER + 1) * 0.06);
  }
  const ENDLESS_CONSOLATION_LAYER = 15;  // 到达 15 层后失败送 1 次免费抽奖（每日限 1 次）

  /* ============================================================
   * 【D3】计分 —— SCORE / buffScore / reviveScoreAt
   * ============================================================ */

  /* ============================================================
   * 无尽塔计分
   *
   * 原来只有「战斗结果」计分（胜利 / 精英 / 通过一层）。现在补上三类：
   *   · 获取增益：按稀有度给分（场间选择 + 商店购买都算）
   *   · 隐藏成就 1「死而复生」：累计复活每 3 次触发一档，分档递增、12 次封顶
   *     （封顶是为了防刷）
   *   · 隐藏成就 2「超凡入圣」：某一项 **buff 加成**（不含装备/等级）首次超过
   *     100% / 150% / 200% / 300% 各触发一次，单局最多 4 次
   * ============================================================ */
  const SCORE = Object.freeze({
    battle: 25, layer: 100, elite: 50,
    /* 获取增益：按稀有度给分（普通/稀有/史诗/传奇）。 */
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
  /** 获取一个增益能拿多少分（按稀有度；未知稀有度按普通）。 */
  function buffScore(rarity) {
    const list = SCORE.buffByRarity;
    return list[Math.max(0, Math.min(list.length - 1, Math.floor(Number(rarity) || 0)))];
  }
  /** 累计复活次数 → 这一档该给多少分（0 = 还没到下一档）。 */
  function reviveScoreAt(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const hit = SCORE.reviveTiers.filter((t) => n >= t.at);
    return hit.length ? hit[hit.length - 1].points : 0;
  }

  /* ============================================================
   * 【D4】试炼币与商店（无尽局内经济，跨局不继承） —— SHOP / 刷新定价与倾斜
   * ============================================================ */

  const COINS = Object.freeze({ battle: 8, layer: 20, elite: 15 });
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
    sellBack: 0.4,                 // 回收 40%
    retryPrice: 50,                // 重新挑战币：失败后回滚到本场开始前
    rerollPrice: 10,               // 第一次付费刷新的价格（之后每次 +rerollGrowth）
    rerollGrowth: 10,              // 涨价步长：10 → 20 → 30 → 40 → 50
    rerollMax: 50,
    rerollTiltGrowth: 1.20,
  });
  function shopPrice(buff) {
    const p = SHOP.price[buff.rarity];
    return buff.scope === 'run' ? Math.round(p * SHOP.crossLayerMul / 10) * 10 : p;
  }

  function rerollPriceAt(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n <= 0) return 0;                                   // 首次免费
    const step = Math.max(0, Number(SHOP.rerollGrowth) || 10);
    const raw = SHOP.rerollPrice + step * (n - 1);
    const max = Math.max(0, Number(SHOP.rerollMax) || 0);
    return Math.round(max > 0 ? Math.min(raw, max) : raw);
  }
  /** 刷新价是否已经封顶（界面用它把「下次更贵」换成「已是最高价」）。 */
  function rerollPriceCapped(count) {
    const max = Math.max(0, Number(SHOP.rerollMax) || 0);
    if (!max) return false;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const step = Math.max(0, Number(SHOP.rerollGrowth) || 10);
    return SHOP.rerollPrice + step * Math.max(0, n - 1) >= max;
  }
  /* ============================================================
   * 刷新质量：**不设保底货品**，只抬高稀有度期望
   *
   * 做法是「稀有度倾斜」：把基础权重按 w_i × p^i 重新归一化。
   *   p = 1        → 自然掉率（w = 66/21/10/3）
   *   p 越大       → 权重被往高稀有度推得越多，期望平滑上升
   * 每花 10 币，p 乘一次 SHOP.rerollTiltGrowth（1.25），所以价格与期望严格单调挂钩。
   *
   * 为什么不用「保底某一件」：那是硬替换，货架会出现「1 件传奇 + 4 件普通」这种
   * 结构突变；倾斜是整架一起变好，体感更像「这家店真的更高级」。
   * ============================================================ */
  /** 倾斜系数：花了 paid 币之后的 p。 */
  function rerollTilt(paid) {
    const money = Math.max(0, Number(paid) || 0);
    const g = Math.max(1, Number(SHOP.rerollTiltGrowth) || 1.25);
    return Math.pow(g, money / 10);
  }
  /* ============================================================
   * 传奇权重两档下调：传奇的基础权重中幅下调；可重复获得的传奇，重复获得时概率
   * 继续降；当所有传奇都已获得时，整体获得传奇的概率进一步降低（压低传奇档的
   * 整体份额，不是只在传奇内部挪权重）。
   * 实现：稀有度权重第 3 档（传奇）乘一个只跟「本局已拥有传奇条数」有关的系数。
   * 商店（rollShopSlots）与场间三选一（rollChoices）共用同一份权重，口径一致。
   * ============================================================ */
  const LEGEND_BASE_WEIGHT = 2.2;
  const LEGEND_HOLD_PENALTY = 0.12;      // 每已拥有一条传奇，再乘 0.88
  const LEGEND_ALL_OWNED_PENALTY = 0.35; // 所有传奇都拿到手后，再乘 0.35
  /** 本局已拥有的传奇条数。 */
  function legendOwnedCount(run) {
    if (!run) return 0;
    const ids = new Set();
    for (const b of run.permanent || []) if (b && b.id) ids.add(b.id);
    for (const b of run.limited || []) if (b && b.id) ids.add(b.id);
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
    /* 即时类（「天命所归」）不进 permanent/limited，单独记在 instantIds 上。 */
    for (const row of run.instantIds || []) if (row && row.id) own.add(row.id);
    const need = BUFFS.filter((b) => b.rarity === 3 && b.repeatable);
    return need.length > 0 && need.every((b) => own.has(b.id));
  }
  /** 传奇那一档的权重系数（1 = 没拿过任何传奇）。 */
  function legendWeightFactor(run) {
    const owned = legendOwnedCount(run);
    let f = Math.pow(1 - LEGEND_HOLD_PENALTY, owned);
    if (allRepeatableLegendsOwned(run)) f *= LEGEND_ALL_OWNED_PENALTY;
    return f;
  }
  /** 「天命所归」(C51) 累计提供的稀有度加成：普通 ×commonMul^n、史诗/传奇 ×epicMul^n。 */
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
  function tiltWeights(tilt, run) {
    const p = Math.max(0, Number(tilt) || 1);
    const boost = rarityBoostOf(run);
    const legendMul = (LEGEND_BASE_WEIGHT / RARITY_WEIGHTS[3]) * legendWeightFactor(run) * boost.legend;
    const slotMul = (i) => (i === 0 ? boost.common : i === 2 ? boost.epic : 1);
    const w = RARITY_WEIGHTS.map((v, i) => (i === 3 ? v * legendMul : v * slotMul(i)) * Math.pow(p, i));
    const total = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((v) => v / total);
  }
  /** 这一次刷新「本来」与「倾斜后」的期望稀有度 / 史诗件数（界面与测试都用它）。 */
  function rerollExpectation(paid, run) {
    const slots = Math.max(1, (SHOP && SHOP.slots) || 5);
    const mean = (w) => w.reduce((a, v, i) => a + v * i, 0);
    /* run 可选：传入后按「已拥有传奇数」再压传奇那一档，与商店实际抽取同口径。 */
    const base = tiltWeights(1, run), tilted = tiltWeights(rerollTilt(paid), run);
    const epics = (w) => w.reduce((a, v, i) => a + v * (i >= 2 ? 1 : 0), 0) * slots;
    return {
      paid: Math.max(0, Number(paid) || 0),
      tilt: +rerollTilt(paid).toFixed(4),
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

  /* ============================================================
   * 【D5】敌方数值系数（v2.2：高血低攻） —— FOE_* / bossHpRatio
   * ============================================================ */

  const FOE_STAT_MUL = 0.66;    // 敏捷/速度基准（原值）
  const FOE_POWER_MUL = 0.47;
  const FOE_HP_MUL = 1.06;      // 血量基准：0.85 × 1.25，血量更厚
  /* ---------- 血量：先算三侠，boss 只在三侠基础上乘一个小倍率 ----------
   * 最后一战的血量仅略高于前三场（不大幅提升也不衰减），所以
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

  /* ============================================================
   * 【D6】NPC 池（10 个，8 类机制） —— NPCS / NPC_BY_ID
   * ============================================================ */

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

  /* ============================================================
   * 【D7】三侠的「贯穿本层」削弱 —— HERO_DEBUFF
   * ============================================================ */

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

  /* ============================================================
   * 【D8】松鼠装备与套装分层 —— GEAR / GEAR_TIER / gearKeyForLayer
   * ============================================================ */

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

  /* ============================================================
   * 【D9】松鼠对手（随机 boss 池成员之一） —— SQUIRRELS
   * ============================================================ */

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
  ]);
  const SQUIRREL_BY_ID = Object.fromEntries(SQUIRRELS.map((n) => [n.id, n]));
  /** 第 4 场固定轮换：(n−1) mod 3 → 松鼠模板。 */
  function squirrelFor(layer) { return SQUIRRELS[(Math.max(1, layer) - 1) % SQUIRRELS.length]; }

  /* ============================================================
   * 【D10】带机制的松鼠 boss（随机 boss 池的核心 7 个） —— TRIALS
   * ============================================================ */

  /* 设计约束（见 docs/挑战塔重构建议.md §3.2）：
   *   1. 可预告：mechDesc 要写清「第几次行动」「百分比」，进层前 / 选 buff 时就能读到；
   *   2. 改变节奏而不是加血：每个 boss 都有自己的「爆发窗口 / 该苟的窗口」；
   *   3. 机制文本按**普通 boss 简介**的口径写，不写「对策建议」（那是给策划看的，见文档）。
   * 数值上复用松鼠的系数与武技池（同族贴图、固定出招循环 → 可背板），
   * bias 随机制调整：血厚的（苔龟/镜鳞/蚀骨）攻击更低，反之亦然。
   * 机制实现全部在 sim.js（trial* 前缀），这里只写数据。 */
  const MIRROR_THRESHOLD = 0.20;
  const MIRROR_REFLECT = 0.40;   // 反弹该次伤害的 40%
    const TRIALS = Object.freeze([
    { id: 'core', name: '熔核·炽壳', type: '爆发窗口型', region: 1, gear: 'hero',
      bias: { power: 1.00, agility: 0.90, speed: 0.90, hp: 0.82 },
      weapons: [{ id: 2, level: 6 }], skills: [{ id: 10, level: 7 }, { id: 4, level: 7 }],
      pattern: ['common', 'weapon', 'common', 'weapon'],
      patternDesc: '固定循环：普攻 → 大榔头（出手慢，前 4 回合是唯一的输出窗口）',
      mech: ['trialCore'],
      mechDesc: '第 7 次行动起进入熔核成型：受到伤害 −70%，力/敏/速 +50%' },
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
      mechDesc: '对手每次出手叠 1 层「攻击 −3%」，最多 15 层（本场有效）' },
  ]);
  const TRIAL_BY_ID = Object.fromEntries(TRIALS.map((n) => [n.id, n]));
  /** 兼容别名：老的「按层固定轮换第 4 场题面」调用点（部分工具还在用）。 */
  function trialFor(layer) { return TRIALS[(Math.max(1, layer) - 1) % TRIALS.length]; }

  /* ============================================================
   * 【D11】x10 层守关：固定狂战松鼠 —— WARLORD_POOL / warlordFor
   * ============================================================ */

  /* 每 10 层的最后一个 boss 固定刷这一个：松鼠形态 + 全身狂战套 + 血性狂暴 + 精英 ×1.2。
   * 「狂战套」是玩家在天梯商店追求的那一套（GameDict set 51 / gear 201~204），
   * 让它穿在身上出现在塔顶，玩家一眼就知道「这是 10 层的大家伙」。 */
  /* ============================================================
   * 10 整层的最终 boss：**独立随机池**（不再是固定那一只）
   *
   * 装备固定为狂战套（gear: 'berserk'，玩家一眼认得出），但每一只的
   * 武器 / 技能 / 技能等级 / 机制倾向都不同 —— 于是「塔顶那一战」有变化：
   *   · 技能等级有高有低（不是全 8 级），形成「某几招特别狠」的压迫感；
   *   · 武技搭配决定倾向：双武器＝靠普攻硬砸，双主动＝技能密集，
   *     被动多的（皮糙肉厚/装死）＝特别耐打；
   *   · 每只都**固定带绝对防御**（技能 16）—— 受击自动触发、不进出手池的被动
   *     （首次 22% / 再次 13% 概率完全免伤，并把伤害反弹回去）。
   *
   * 变体按 (salt + 层数) 哈希抽取：**同一层固定同一只**（进层前能预习、
   * 失败重试还是它），换一层就是新的组合。
   * ============================================================ */
  /* 所有变体共享的「首领底子」：狂战套 + 略微高于三侠的三围。 */
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
      bias: { power: 1.18, agility: 1.08, speed: 1.12, hp: 1.04 },
      weapons: [{ id: 11, level: 12 }],
      skills: [{ id: 14, level: 12 }, { id: 16, level: 12 }, { id: 6, level: 10 }, { id: 10, level: 10 }],
      castable: [14], pattern: ['weapon', 'skill', 'common', 'weapon'],
      patternDesc: '固定循环：武士刀 → 小宇宙爆发 → 普攻 → 武士刀',
      mechDesc: '精英：小宇宙爆发 12 级（频繁追加行动），会冻结与吸血；' +
        '自带绝对防御 12 级，节奏极快' },
  ]);
  /** 取某一层对应的塔顶 boss 变体：同层固定，换层变化。 */
  function warlordFor(layer, salt) {
    const key = String(salt == null ? '' : salt) + '&warlord#' + Math.max(1, Number(layer) || 1);
    return WARLORD_POOL[poolHash(key) % WARLORD_POOL.length];
  }
  /* 兼容旧调用点：默认（不带层数）就是第一只。 */
  const WARLORD = WARLORD_POOL[0];

  /* ============================================================
   * 【D12】随机 boss 池与三侠顺序 —— bossFor / heroOrder
   * ============================================================ */

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
  /* ============================================================
   * 【D13】Buff 池 —— BUFFS 全表（稀有度 / 叠层 / mods 都在这里定义）
   * ============================================================ */

  // rarity: 0 普通 / 1 稀有 / 2 史诗；scope: battle 单场 / layer 本层 / run 跨层（仅无尽）。
  // mods 由 tower.js 解释（数值均为加池百分比或比例）：
  //   powerMul/agilityMul/speedMul maxHpMul(获得时等量回血) critBonus critDmgBonus dodgeBonus
  //   takenMul(负值) regenPct lifestealPct openStrikePct mustHitFirst mustHitAll deathSave revivePct
  //   reviveFirstPct(首次致死改为按比例复活) healOnGainPct(获得时立刻回血)
  //   layerFirstHealPct(每层首战开战回血) startHealPct(每场开战回血) shellPct enemyPowerDown
  //   weaponFreeUses(前 N 次武器不耗回合) weaponBoostUses/weaponBoostPowerMul/weaponBoostMustHit/
  //   weaponBoostReflectImmune/weaponBoostFatigueMul（前 N 次武器强化、之后攻击衰减）
  //   dmgMulType dmgMulMech dmgMulElite eliteHealAfter
  //   killPowerPct/killPowerCap killMaxHpPct/killMaxHpCap killHealPct
  //   layer5HealPct x10Boost perLayerPowerAfter20 globalMul
  //   lowHpFinalMul(低血终乘) lowHpAgilityMul lowHpSpeedMul lowHpAt
  //   shopDiscount(折扣比例) postBattleShop/postBattleShopDiscount(战后开店)
  const BUFFS = Object.freeze([
    // —— 单场类（主塔+无尽通用） ——
    { id: 'N01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '蓄力一击', rarity: 0, kind: 'limited', uses: 2, towerOnly: true, nextBattle: true, desc: '下一场战斗攻击 +40%', mods: { powerMul: 0.40 } },
    { id: 'N02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '百步穿杨', rarity: 0, kind: 'limited', uses: 3, towerOnly: true, nextBattle: true, desc: '下一场战斗所有攻击必中', mods: { mustHitAll: 1 } },
    { id: 'M01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '威慑', rarity: 0, kind: 'limited', uses: 2, towerOnly: true, nextBattle: true, desc: '下一场战斗敌人攻击力 −30%', mods: { enemyPowerDown: 0.30 } },
    { id: 'M02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '疾风先手', rarity: 0, kind: 'limited', uses: 3, towerOnly: true, nextBattle: true, desc: '下一场战斗前 3 次使用武器不消耗回合', mods: { weaponFreeUses: 3 } },
    { id: 'N03', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '活血丹', rarity: 1, kind: 'limited', uses: 3, towerOnly: true, nextBattle: true, desc: '下一场战斗每回合开始回复 7% 生命', mods: { regenPct: 0.07 } },
    { id: 'N04', tags: ['tower', 'battle', 'limited', 'unique', 'nextBattle'], name: '金蝉脱壳', rarity: 1, kind: 'limited', uses: 10, towerOnly: true, nextBattle: true, unique: true,
      desc: '下一场战斗第一次死亡时复活，并回复 30% 生命上限', mods: { reviveFirstPct: 0.30 } },
    { id: 'N07', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '破军', rarity: 1, kind: 'limited', uses: 3, towerOnly: true, nextBattle: true, desc: '下一场战斗暴击率 +20%，暴击伤害 +30%', mods: { critBonus: 20, critDmgBonus: 0.30 } },
    { id: 'M03', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '坚守', rarity: 1, kind: 'limited', uses: 2, towerOnly: true, nextBattle: true, desc: '下一场战斗受到伤害 −30%', mods: { takenMul: -0.30 } },
    { id: 'M04', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '疾风步', rarity: 1, kind: 'limited', uses: 10, towerOnly: true, nextBattle: true, desc: '下一场战斗速度 +30%', mods: { speedMul: 0.30 } },
    { id: 'N05', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '先手制敌', rarity: 2, kind: 'limited', uses: 3, towerOnly: true, nextBattle: true, desc: '下一场战斗开局对敌人造成其 30% 最大生命的伤害', mods: { openStrikePct: 0.30 } },
    { id: 'N08', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '补给', rarity: 0, kind: 'limited', uses: 1, towerOnly: true, nextBattle: true,
      desc: '下一场战斗开始时立即回复 50% 生命', mods: { startHealPct: 0.50 } },
    { id: 'N06', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '血饮狂刀', rarity: 2, kind: 'limited', uses: 5, towerOnly: true, nextBattle: true, desc: '下一场战斗攻击附带 45% 吸血', mods: { lifestealPct: 0.45 } },
    // —— 本层类（主塔=整局；无尽=当前层） ——
    { id: 'G01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '力量祝福', rarity: 0, kind: 'limited', uses: 10, towerOnly: true, nextBattle: true, desc: '下一场战斗力量、敏捷、速度各 +20%', mods: { powerMul: 0.20, agilityMul: 0.20, speedMul: 0.20 } },
    { id: 'G02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '生命祝福', rarity: 0, kind: 'limited', uses: 5, towerOnly: true, nextBattle: true, desc: '下一场战斗生命上限 +20%，并在开战第一回合回复 40% 生命上限', mods: { maxHpMul: 0.20, startHealPct: 0.40 } },
    { id: 'G03', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '凌波微步', rarity: 1, kind: 'limited', uses: 10, towerOnly: true, nextBattle: true, desc: '下一场战斗我方闪避率 +15%', mods: { dodgeBonus: 15 } },
    { id: 'G04', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '破釜沉舟', rarity: 2, kind: 'limited', uses: 3, towerOnly: true, nextBattle: true, desc: '下一场战斗攻击 +70%，生命上限 −20%', mods: { powerMul: 0.70, maxHpMul: -0.20 } },
    /* ============================================================
     * 挑战塔专属「下一场战斗」增益（towerOnly + nextBattle）
     *
     * 挑战塔是一层四场连战、打完结算，所以它的增益天然只服务**下一场**：
     * 不搞「接下来 N 场」那种叠加计时，卡面直接写「下一场战斗」。
     * 这些条目不会进无尽池（endlessPool 过滤 towerOnly）。
     * ============================================================ */
    { id: 'T01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '闪亮登场', rarity: 2, kind: 'limited', uses: 1, towerOnly: true, nextBattle: true,
      desc: '下一场战斗：前 3 次使用武器时攻击 +50% 且必中，同时免疫反伤；之后我方攻击 −20%',
      mods: { weaponBoostUses: 3, weaponBoostPowerMul: 0.50, weaponBoostMustHit: 1, weaponBoostReflectImmune: 1, weaponBoostFatigueMul: 0.20 } },
    { id: 'T02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '烟幕', rarity: 1, kind: 'limited', uses: 1, towerOnly: true, nextBattle: true,
      desc: '下一场战斗：我方闪避率 ×1.5',
      mods: { dodgeMul: 0.50 } },
    { id: 'T03', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '锁定打击', rarity: 1, kind: 'limited', uses: 1, towerOnly: true, nextBattle: true,
      desc: '下一场战斗：所有攻击必中', mods: { mustHitAll: 1 } },
    { id: 'T04', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '见血封喉', rarity: 2, kind: 'limited', uses: 1, towerOnly: true, nextBattle: true,
      desc: '下一场战斗：暴击率 +30%，暴击伤害 +50%',
      mods: { critBonus: 30, critDmgBonus: 0.50 } },
    { id: 'T05', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '以血换血', rarity: 2, kind: 'limited', uses: 1, towerOnly: true, nextBattle: true,
      desc: '下一场战斗：反弹 50% 受到的伤害给敌人', mods: { thornsPct: 0.50 } },
    { id: 'T06', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '背水一战', rarity: 3, kind: 'limited', uses: 1, towerOnly: true, nextBattle: true,
      desc: '下一场战斗：攻击 +35%，速度 +20%，受到伤害 −20%',
      mods: { powerMul: 0.35, speedMul: 0.20, takenMul: -0.20 } },
    { id: 'T07', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '不动如山', rarity: 3, kind: 'limited', uses: 1, towerOnly: true, nextBattle: true,
      desc: '下一场战斗：生命上限 +35%，开战回满生命，之后每回合再回复 5% 生命',
      mods: { maxHpMul: 0.35, startHealPct: 1.00, regenPct: 0.05 } },
    { id: 'T08', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '先发制人', rarity: 0, kind: 'limited', uses: 1, towerOnly: true, nextBattle: true,
      desc: '下一场战斗：首次使用武器不消耗回合，敌方对我方的第一次伤害为 0',
      mods: { weaponFreeUses: 1, firstHitZero: 1 } },
    // —— 跨层类（仅无尽，本局永久） ——
    /* 语义：生命上限 +20%（永久，拿到就折算进 run.hpBonus），并回复等量生命。
     * 注意它与「获得时回血」类（healOnGainPct）不是一回事 —— 后者只回血、不抬上限。 */
    { id: 'C01', tags: ['tower', 'endless', 'battle', 'shop'], name: '磐石之躯', rarity: 1, kind: 'permanent', desc: '生命上限 +20%，并回复等量生命', mods: { maxHpMul: 0.20 } },
    { id: 'C02', tags: ['tower', 'endless', 'battle', 'shop'], name: '磨砺', rarity: 0, kind: 'permanent', desc: '攻击 +10%', mods: { powerMul: 0.10 } },
    { id: 'C03', tags: ['endless', 'battle', 'shop', 'stackable'], name: '猎侠者', rarity: 0, kind: 'permanent', endlessOnly: true, stackable: true, maxStacks: 3, desc: '对螳螂/仙鹤/熊猫伤害 +25%', mods: { dmgMulType: 0.25 } },
    { id: 'C04', tags: ['tower', 'endless', 'battle', 'shop'], name: '生命源泉', rarity: 1, kind: 'permanent', desc: '每进入新的一层，该层第一场战斗开战时回复 100% 生命', mods: { layerFirstHealPct: 1.00 } },
    { id: 'C05', tags: ['tower', 'endless', 'battle', 'shop'], name: '坚韧壁垒', rarity: 1, kind: 'permanent', desc: '每场战斗开局获得 15% 最大生命的护盾', mods: { shellPct: 0.15 } },
    { id: 'C06', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '猎杀时刻', rarity: 1, kind: 'permanent', stackable: true, desc: '每击杀 1 个敌人攻击 +2%，最多 +30%', mods: { killPowerPct: 0.02, killPowerCap: 0.30 } },
    { id: 'C07', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '吞噬成长', rarity: 1, kind: 'permanent', stackable: true,
      desc: '每胜利一场生命上限 +2%，最多 +30%', mods: { winMaxHpPct: 0.02, winMaxHpCap: 0.30 } },
    { id: 'C09', tags: ['tower', 'endless', 'battle', 'shop'], name: '逢五强化', rarity: 1, kind: 'permanent', desc: '每到 5 的倍数层，攻击与生命上限各 +50%', mods: { x10Boost: 0.50 } },
    { id: 'C10', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '机制破解', rarity: 1, kind: 'permanent', stackable: true, maxStacks: 3, desc: '对带专属机制的敌人伤害 +25%', mods: { dmgMulMech: 0.25 } },
    { id: 'C16', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '战斗续航', rarity: 1, kind: 'permanent', stackable: true, maxStacks: 2,
      desc: '每场战斗开始时回复 5% 生命上限', mods: { startHealPct: 0.05 } },
    { id: 'C17', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '战斗续航·精', rarity: 2, kind: 'permanent', stackable: true, maxStacks: 2,
      desc: '每场战斗开始时回复 10% 生命上限', mods: { startHealPct: 0.10 } },
    { id: 'C18', tags: ['tower', 'endless', 'battle', 'shop'], name: '吸血精通', rarity: 1, kind: 'permanent', desc: '所有攻击附带 15% 吸血', mods: { lifestealPct: 0.15 } },
    { id: 'C19', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '荆棘之甲', rarity: 1, kind: 'permanent', stackable: true, maxStacks: 3, desc: '受到伤害时反弹 20% 给敌人', mods: { thornsPct: 0.20 } },
    /* 狂怒：低血时同时强化攻/敏/速（阈值 50%）。
     * 三项都用同一套「当前血量 ≤ 上限 × lowHpAt」判定，见 sim.js 的 effPower/effAgility/effSpeed。
     * **攻击那一份是终乘**（lowHpFinalMul）：不走力量面板，而是在最终伤害上直接乘，
     * 这样它不会被其它乘区稀释 —— 低血才触发的门槛配得上这个待遇。 */
    { id: 'C20', tags: ['tower', 'endless', 'battle', 'shop'], name: '狂怒', rarity: 2, kind: 'permanent',
      desc: '生命低于一半时，最终伤害 ×1.5；敏捷与速度 +20%',
      mods: { lowHpFinalMul: 0.50, lowHpAgilityMul: 0.20, lowHpSpeedMul: 0.20, lowHpAt: 0.50 } },
    /* ============================================================
     * 与「狂怒」成套的低血 combo（空血上限 = 只抬高上限、不回血，
     * 于是当前血量占比被压低，直接把血线推进狂怒的触发区间）。
     *   emptyMaxHpMul   只加上限、不补血（每场开战时按新上限重算，空的那部分仍是空的）
     *   lowHpRegenPct   低血时每回合回血，但**不超过 lowHpRegenAt 这条线**
     *   lowHpTakenMul   低血时减伤
     *   lowHpLifestealPct 低血时吸血
     * 四项低血效果共用同一个 lowHpAt 阈值（与狂怒一致，便于玩家理解）。
     * ============================================================ */
    { id: 'C46', tags: ['tower', 'endless', 'battle', 'shop'], name: '浴血重生', rarity: 1, kind: 'permanent',
      desc: '每场战斗开始时获得 30% 的空生命上限；生命低于 50% 时每回合回复 2% 生命，最多回到 50%',
      mods: { emptyMaxHpMul: 0.30, lowHpRegenPct: 0.02, lowHpRegenAt: 0.50, lowHpAt: 0.50 } },
    { id: 'C47', tags: ['tower', 'endless', 'battle', 'shop'], name: '濒死觉悟', rarity: 2, kind: 'permanent',
      desc: '每场战斗开始时获得 50% 的空生命上限；生命低于 50% 时获得 15% 减伤与 15% 吸血',
      mods: { emptyMaxHpMul: 0.50, lowHpTakenMul: -0.15, lowHpLifestealPct: 0.15, lowHpAt: 0.50 } },
    /* 抉择扩充：战斗获得的三选一变四选一，可叠 3 层（最高 6 选 1）。
     * maxStacks 与 stackable 配套：叠满 3 层后 `poolFilter` 直接把它排除，
     * 商店与战斗都不会再刷到它。 */
    { id: 'C50', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '抉择扩充', rarity: 1, kind: 'permanent', stackable: true, maxStacks: 3,
      desc: '战斗获得的选择项 +1',
      mods: { choiceCount: 1 } },
    /* 减伤成长：每胜利一场，本局受到伤害再 −1%（上限 −25%）。
     * 与 C07（生命成长）/ C11（生命固定成长）/ C12（力敏速成长）同一族的「成长型」，
     * 但作用在减伤上 —— 无尽塔后期最缺的就是续航。 */
    { id: 'C48', tags: ['tower', 'endless', 'battle', 'shop'], name: '铜墙铁壁', rarity: 2, kind: 'permanent',
      desc: '本局每胜利一场，受到的伤害额外 −1%，最多 −25%',
      mods: { winTakenMulPct: 0.01, winTakenMulCap: 0.25 } },
    { id: 'C21', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '暴击精通', rarity: 0, kind: 'permanent', stackable: true, maxStacks: 3, desc: '暴击率 +10%', mods: { critBonus: 10 } },
    { id: 'C22', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '闪避精通', rarity: 0, kind: 'permanent', stackable: true, maxStacks: 3, desc: '闪避率 +10%', mods: { dodgeBonus: 10 } },
    { id: 'C23', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '轻身术', rarity: 0, kind: 'permanent', stackable: true, maxStacks: 3, desc: '速度 +10%', mods: { speedMul: 0.10 } },
    { id: 'C11', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '以战养战', rarity: 2, kind: 'permanent', stackable: true, desc: '每胜利一场，生命上限 +5', mods: { winMaxHpFlat: 5 } },
    /* 登顶者：第 10 层起每胜利一场，本局固定 +1 力 / +1 敏 / +1 速（不封顶、可叠层）。 */
    { id: 'C12', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '登顶者', rarity: 2, kind: 'permanent', stackable: true,
      desc: '第 10 层起，每胜利一场，本局力量 +1、敏捷 +1、速度 +1',
      mods: { winStatAfter10: 1 } },
    { id: 'C13', tags: ['tower', 'endless', 'battle', 'shop'], name: '精英杀手', rarity: 2, kind: 'permanent', desc: '对精英伤害 +40%；击败精英后回复 20% 最大生命', mods: { dmgMulElite: 0.40, eliteHealAfter: 0.20 } },
    { id: 'C14', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '涅槃', rarity: 3, kind: 'permanent', shopWeight: 0.12, stackable: true, maxStacks: 2,
      desc: '每层战斗可复活一次；复活回复 50% 生命上限，本场力量、敏捷、速度 +50%',
      mods: { revivePct: 0.50, reviveStatMul: 0.50 } },
    /* ============================================================
     * 传奇·即时「天命所归」：获得时立刻生效，**本局永久**改变后续的稀有度分布。
     *   epicMul / legendMul = 2   → 史诗与传奇档权重 ×2
     *   commonMul = 0.5           → 普通档权重 ×0.5
     * 影响范围：战斗奖励的选项池（rollChoices）与试炼商店货架（rollShopSlots）。
     * **一局一次**（与 E07 挫锐 / E08 卸甲 同一口径）—— poolFilter / ownable
     * 用 instantOwnedCount 判上限，拿过一次之后就不再进任何池子。
     * 之所以继续保留 `repeatable: true`：传奇掉率里的「可重复传奇是否已全部拥有」
     * 仍要把它算作一份（见 allRepeatableLegendsOwned），语义是「它能重复出现在池子里」。
     * ============================================================ */
    { id: 'C51', tags: ['endless', 'battle', 'oncePerRun', 'repeatable'], name: '天命所归', rarity: 3, kind: 'instant', endlessOnly: true, repeatable: true, maxStacks: 1,
      desc: '立即生效：本局战斗奖励与商店的史诗/传奇出率 ×2、普通出率 ×0.5',
      mods: { rarityBoost: 1, epicMul: 2, legendMul: 2, commonMul: 0.5 } },
    { id: 'E01', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '立即进货', rarity: 1, kind: 'limited', uses: 1, endlessOnly: true, nextBattle: true,
      desc: '下一场战斗结束后立即开启一次试炼商店，全部商品 5 折；若同时持有「steam大促」，两档折扣叠加为 3.5 折',
      mods: { postBattleShop: 1, postBattleShopDiscount: 0.50 } },
    { id: 'E02', tags: ['endless', 'battle'], name: '试炼补贴', rarity: 0, kind: 'instant', endlessOnly: true, desc: '立刻获得 60 试炼币', mods: { instantCoins: 60 } },
    { id: 'E03', tags: ['endless', 'battle'], name: '财源滚滚', rarity: 1, kind: 'instant', endlessOnly: true, desc: '立刻获得 120 试炼币', mods: { instantCoins: 120 } },
    { id: 'E04', tags: ['endless', 'battle', 'oncePerRun'], name: 'steam大促', rarity: 1, kind: 'instant', endlessOnly: true, maxStacks: 1,
      desc: '下一个试炼商店全部商品 7 折', mods: { shopDiscount: 0.30 } },
    { id: 'E05', tags: ['endless', 'battle', 'shop', 'limited'], name: '战利品', rarity: 1, kind: 'limited', uses: 10, endlessOnly: true, desc: '接下来 10 场战斗的试炼币获取 ×1.6', mods: { coinBoostPct: 0.60 } },
    { id: 'E06', tags: ['endless', 'battle', 'shop', 'limited'], name: '战利品·精', rarity: 2, kind: 'limited', uses: 10, endlessOnly: true, desc: '接下来 10 场战斗的试炼币获取 ×2.4', mods: { coinBoostPct: 1.40 } },
    { id: 'C26', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '蛮力', rarity: 0, kind: 'permanent', stackable: true, unlimitedStacks: true, desc: '攻击 +6%', mods: { powerMul: 0.06 } },
    { id: 'C27', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '灵巧', rarity: 0, kind: 'permanent', stackable: true, unlimitedStacks: true, desc: '敏捷 +8%', mods: { agilityMul: 0.08 } },
    { id: 'C28', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '疾行', rarity: 0, kind: 'permanent', stackable: true, unlimitedStacks: true, desc: '速度 +8%', mods: { speedMul: 0.08 } },
    { id: 'C29', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '体质', rarity: 0, kind: 'permanent', stackable: true, unlimitedStacks: true, desc: '生命上限 +10%', mods: { maxHpMul: 0.10 } },
    { id: 'C30', tags: ['endless', 'battle', 'shop', 'unique'], name: '扩容背包', rarity: 2, kind: 'permanent', endlessOnly: true, unique: true, permSlot: 1,
      desc: '本局永久增益槽位 +1', mods: { permSlot: 1 } },
    { id: 'C31', tags: ['endless', 'battle', 'unique'], name: '仓库钥匙', rarity: 3, kind: 'permanent', endlessOnly: true, unique: true, permSlot: 2, battleOnly: true,
      desc: '本局永久增益槽位 +2', mods: { permSlot: 2 } },
    /* 隐藏型选取 buff：拿到后立即三选一（已有武器/技能），强化指定对象；不显示在增益面板、不可出售 */
    { id: 'C32', tags: ['endless', 'battle', 'shop', 'unique', 'hidden'], name: '神兵淬炼', rarity: 2, kind: 'permanent', endlessOnly: true, unique: true, hidden: true,
      desc: '立即从已有武器中随机三选一，该武器伤害 +100%', mods: { pickWeaponPct: 1.00 } },
    { id: 'C33', tags: ['endless', 'battle', 'shop', 'unique', 'hidden'], name: '秘技通神', rarity: 2, kind: 'permanent', endlessOnly: true, unique: true, hidden: true,
      desc: '立即从已有主动技能中随机三选一，该技能触发概率 +60%', mods: { pickSkillPct: 0.60 } },
    /* 对抗环境词缀的三档 buff（普通/稀有/史诗） */
    { id: 'N09', tags: ['endless', 'battle', 'shop', 'limited'], name: '晴空护符', rarity: 0, kind: 'limited', uses: 3, endlessOnly: true,
      desc: '接下来 3 场：无视环境词缀，并把负面环境词缀反弹给对手', mods: { envIgnore: 1, envReflect: 1 } },
    { id: 'N10', tags: ['endless', 'battle', 'shop', 'limited'], name: '避风斗篷', rarity: 1, kind: 'limited', uses: 10, endlessOnly: true,
      desc: '接下来 10 场：无视环境词缀', mods: { envIgnore: 1 } },
    /* 反噬豁免：限次 10 场，免疫**一切反伤**（荆棘铁壁 / 荆棘之甲 / 镜鳞反噬 /
     * 绝对防御反伤）。无尽塔后期到处都是反伤，这条是硬解。 */
    { id: 'N15', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '反噬豁免', rarity: 1, kind: 'limited', uses: 10, endlessOnly: true, nextBattle: true,
      desc: '每场战斗免疫一切反伤· 共 10 场',
      mods: { reflectImmune: 1 } },
    /* 低血 combo 的两条限次类（与狂怒成套；限次 10 场） */
    /* 这两条虽然也是「下一场战斗」生命周期（nextBattle），但在无尽塔里是
     * **10 场限次**（每场各生效一次、打完扣 1），所以文案按「每场」写，
     * 界面也会照常显示「剩 N 场」。 */
    { id: 'N13', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '血之契约', rarity: 0, kind: 'limited', uses: 10, endlessOnly: true, nextBattle: true,
      desc: '每场战斗开始时生命上限 +100%· 共 10 场',
      mods: { emptyMaxHpMul: 1.00 } },
    { id: 'N14', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '铁血护盾', rarity: 1, kind: 'limited', uses: 10, endlessOnly: true, nextBattle: true,
      desc: '每场战斗中生命低于 50% 时获得 50% 减伤 · 共 10 场',
      mods: { lowHpTakenMul: -0.50, lowHpAt: 0.50 } },
    { id: 'C45', tags: ['endless', 'battle', 'shop'], name: '天象之眼', rarity: 2, kind: 'permanent', endlessOnly: true,
      desc: '无视负面环境词缀；把负面环境词缀反弹给对手；敌方无法获得环境词缀加成',
      mods: { envIgnore: 1, envReflect: 1, envDenyGood: 1 } },
    { id: 'C24', tags: ['endless', 'battle', 'stackable'], name: '名贵手表', rarity: 1, kind: 'permanent', endlessOnly: true, shopBanned: true, stackable: true, maxStacks: 2,
      desc: '售出可获得 200 试炼币', mods: { sellValue: 200 } },
    { id: 'C25', tags: ['endless', 'battle', 'shop'], name: '战利品账本', rarity: 1, kind: 'permanent', endlessOnly: true,
      desc: '售出可获得 50 试炼币；每胜利一场售价 +10',
      mods: { sellValue: 50, sellGrowthPerWin: 10 } },
    { id: 'C15', tags: ['tower', 'endless', 'battle', 'shop'], name: '增幅水晶', rarity: 2, kind: 'permanent', desc: '本局内所有 buff 的效果 ×1.4', mods: { globalMul: 1.40 } },
    { id: 'E09', tags: ['endless', 'battle'], name: '重整旗鼓', rarity: 0, kind: 'instant', endlessOnly: true,
      desc: '立即获得 1 枚重新挑战币', mods: { instantRetry: 1 } },
    { id: 'E10', tags: ['endless', 'battle'], name: '背水一战', rarity: 2, kind: 'instant', endlessOnly: true,
      desc: '立即获得 3 枚重新挑战币', mods: { instantRetry: 3 } },
    { id: 'E07', tags: ['endless', 'battle', 'oncePerRun', 'repeatable'], name: '挫锐', rarity: 0, kind: 'instant', endlessOnly: true, repeatable: true, maxStacks: 1,
      desc: '立刻让本局所有敌人的生命上限 −10%', mods: { enemyMaxHpDown: 0.10 } },
    { id: 'E08', tags: ['endless', 'battle', 'oncePerRun', 'repeatable'], name: '卸甲', rarity: 1, kind: 'instant', endlessOnly: true, repeatable: true, maxStacks: 1,
      desc: '立刻让本局所有敌人的生命上限 −15%', mods: { enemyMaxHpDown: 0.15 } },
    { id: 'E11', tags: ['endless', 'battle', 'oncePerRun', 'repeatable'], name: '挫锋', rarity: 2, kind: 'instant', endlessOnly: true, battleOnly: true,
      repeatable: true, maxStacks: 1,
      desc: '立刻让本局所有敌人的攻击力 −15%',
      mods: { enemyPowerDown: 0.15 } },
    { id: 'C34', tags: ['tower', 'endless', 'battle', 'shop'], name: '轻装上阵', rarity: 0, kind: 'permanent',
      desc: '每个空的永久增益位让攻击 +20%', mods: { powerPerEmptySlot: 0.20 } },
    { id: 'C35', tags: ['tower', 'endless', 'battle', 'shop'], name: '厚积薄发', rarity: 2, kind: 'permanent',
      desc: '每拥有 1 个永久增益，攻击 +10%', mods: { powerPerPermBuff: 0.10 } },
    /* —— 传奇 · 商店消费成长 ——
     * **每消费 5 试炼币** → 随机一项「力+1 / 敏+1 / 速+1 / 生命上限+5」，可无限累计。
     * 累计结果与「距下次还差几枚」都显示在增益面板上（progressOf）。
     * 注意：买到「挥金如土」本身的这笔花费也计入（见 buyShopSlot 的记账顺序）。 */
    { id: 'C36', tags: ['endless', 'battle', 'shop', 'repeatable'], name: '挥金如土', rarity: 3, kind: 'permanent', repeatable: true,
      desc: '每在试炼商店消费 5 试炼币，随机获得「力 +1 / 敏 +1 / 速 +1 / 生命上限 +5」中的一项',
      mods: { shopSpendStep: 5, shopSpendStat: 1, shopSpendHp: 5 } },
    { id: 'C37', tags: ['endless', 'battle', 'shop', 'repeatable', 'hidden'], name: '虚空铭文', rarity: 3, kind: 'permanent', endlessOnly: true, hidden: true, repeatable: true,
      desc: '从永久增益里选一个附赠铭文：它不再占用永久增益位',
      mods: { pickPermanentFree: 1 } },
    { id: 'C39', tags: ['endless', 'battle', 'shop', 'limited'], name: '力量烙印', rarity: 0, kind: 'limited', uses: 1000, endlessOnly: true,
      desc: '力量 +8%，损毁后 +16%；每打完一场小概率损毁（6%）',
      mods: { fragileStat: 'power', fragilePct: 0.08, fragileBreakPct: 6 } },
    { id: 'C40', tags: ['endless', 'battle', 'shop', 'limited'], name: '敏捷烙印', rarity: 0, kind: 'limited', uses: 1000, endlessOnly: true,
      desc: '敏捷 +8%，损毁后 +16%；每打完一场小概率损毁（6%）',
      mods: { fragileStat: 'agility', fragilePct: 0.08, fragileBreakPct: 6 } },
    { id: 'C41', tags: ['endless', 'battle', 'shop', 'limited'], name: '速度烙印', rarity: 0, kind: 'limited', uses: 1000, endlessOnly: true,
      desc: '速度 +8%，损毁后 +16%；每打完一场小概率损毁（6%）',
      mods: { fragileStat: 'speed', fragilePct: 0.08, fragileBreakPct: 6 } },
    { id: 'C42', tags: ['endless', 'battle', 'shop', 'limited'], name: '力量烙印·精', rarity: 1, kind: 'limited', uses: 1000, endlessOnly: true,
      desc: '力量 +14%，损毁后 +28%；每打完一场小概率损毁（6%）',
      mods: { fragileStat: 'power', fragilePct: 0.14, fragileBreakPct: 6 } },
    { id: 'C43', tags: ['endless', 'battle', 'shop', 'limited'], name: '敏捷烙印·精', rarity: 1, kind: 'limited', uses: 1000, endlessOnly: true,
      desc: '敏捷 +14%，损毁后 +28%；每打完一场小概率损毁（6%）',
      mods: { fragileStat: 'agility', fragilePct: 0.14, fragileBreakPct: 6 } },
    { id: 'C44', tags: ['endless', 'battle', 'shop', 'limited'], name: '速度烙印·精', rarity: 1, kind: 'limited', uses: 1000, endlessOnly: true,
      desc: '速度 +14%，损毁后 +28%；每打完一场小概率损毁（6%）',
      mods: { fragileStat: 'speed', fragilePct: 0.14, fragileBreakPct: 6 } },
    /* 传奇烙印「终焉烙印」：**终乘**类 —— 先把局内所有加算/成长算完，最后再乘。
     * 存在时 力/敏/速/生命上限 ×1.25；损毁后本局 ×1.5。
     * 可重复获得，每次独立相乘（多层 = 1.5^n，而不是 1+0.5n）。 */
    { id: 'C49', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '终焉烙印', rarity: 3, kind: 'limited', uses: 1000, endlessOnly: true, repeatable: true, maxStacks: 3,
      desc: '力/敏/速/生命上限 +25%（终乘），损毁后本局 +50%；每打完一场小概率损毁',
      mods: { fragileFinalMul: true, fragileAddAlive: 0.25, fragileAddBurned: 0.5, fragileBreakPct: 6, repeatWeight: 0.10 } },
    /* 稀有烙印「涌泉烙印」：跳绿字的回血量 +10%；损毁后本局 +20%（同样是加算层）。 */
    { id: 'C52', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '涌泉烙印', rarity: 1, kind: 'limited', uses: 1000, endlessOnly: true, repeatable: true,
      desc: '治疗量 +10%，损毁后本局 +20%',
      mods: { fragileFinalMul: true, fragileHealAddAlive: 0.10, fragileHealAddBurned: 0.20,
        fragileBreakPct: 6, repeatWeight: 0.3 } },
    /* 传奇烙印「淘金烙印」：**只在战斗奖励里掉落**（battleOnly → 不进商店货架），一局一次。
     * 每场战斗的试炼币获取 +15%；损毁后本局 +30%（同样是「存在/损毁」两段加算）。
     * 记账字段与前两条烙印同一套：run.fragileCoinBase（未破碎份数）+
     * run.fragileCoinBurned（已破碎份数的明细数组），见 tower.js 的 fragileCoinBonus。 */
    { id: 'C53', tags: ['endless', 'battle', 'limited', 'oncePerRun'], name: '淘金烙印', rarity: 3, kind: 'limited', uses: 1000, endlessOnly: true, battleOnly: true, maxStacks: 1,
      desc: '战斗获得试炼币 +15%，损毁后本局 +30%；每打完一场小概率损毁（6%）',
      mods: { fragileCoinAddAlive: 0.15, fragileCoinAddBurned: 0.30, fragileBreakPct: 6 } },
    { id: 'C38', tags: ['tower', 'endless', 'battle', 'shop'], name: '先机预判', rarity: 2, kind: 'permanent',
      desc: '每场战斗敌方对我方的第一次伤害为 0',
      mods: { firstHitZero: 1 } },
  ]);
  /* ============================================================
   * 【D14】Buff 索引与杂项常量 —— BUFF_BY_ID / 稀有度权重 / 回血比例 / 里程碑
   * ============================================================ */
  const BUFF_BY_ID = Object.fromEntries(BUFFS.map((b) => [b.id, b]));
  /* 「下一场战斗」语义的增益 id 集合（挑战塔里打完一场即消耗，卡面不显示限次）。 */
  const TOWER_BATTLE_IDS = BUFFS.filter((b) => b.nextBattle).map((b) => b.id);
  const RARITY_NAME = ['普通', '稀有', '史诗', '传奇'];
  const RARITY_WEIGHTS = [66, 21, 10, 3];        // 每个随机槽独立 Roll
  /* 试炼商店折扣口径：E04 steam大促 −30%；E01 立即进货的战后商店 −50%；
   * 两者同时生效时按用户指定合并为 −65%（3.5 折），而不是把两个折扣相加。 */
  const SHOP_DISCOUNT_E04 = 0.30;
  const SHOP_DISCOUNT_E01 = 0.50;
  const SHOP_DISCOUNT_BOTH = 0.65;
  const FIXED_HEAL_PCT = 0.5;
  const AUTO_HEAL_PCT = 0.14;                    // 每场打完自动回复的比例
  const ENDLESS_LAYER_HEAL_PCT = 0.20;
  const STACK_MAX = 3;
  /* 叠层上限的唯一判据（poolFilter / addBuff / normalizeRun 三处必须同一口径）。
   *   unlimitedStacks: true → 无上限（C26-C29 这类「可无限叠」的成长件）；
   *   显式 maxStacks     → 用它；
   *   都没写             → 全局 STACK_MAX。 */
  function stackCap(buff) {
    if (!buff) return STACK_MAX;
    if (buff.unlimitedStacks === true) return Infinity;
    const n = Math.floor(Number(buff.maxStacks));
    return n >= 1 ? n : STACK_MAX;
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
  /** 主塔池 = 单场 + 本层（15 个）；无尽池 = 全部 30 个。 */
  /* ============================================================
   * 【D15】增益池注册 —— 显式池子归属 / 加载期断言（挑战塔与无尽塔互斥）
   * ============================================================ */
  /* ============================================================
   * 增益池：**显式池子归属**（挑战塔与无尽塔是两个互斥的池子）
   *   1. `poolRoster(b)` 给每条增益算出它**允许出现**的池子集合；
   *   2. 各池子按这份名单取；
   *   3. 加载时**断言互斥**（塔专属不得出现在无尽池、无尽专属不得出现在塔池…），
   *      漏标直接抛错。
   *
   * 池子定义：
   *   T.choice  挑战塔场间选择   T.shop  挑战塔商店（塔目前没有商店，但保留概念）
   *   E.choice  无尽塔场间选择   E.shop  无尽塔试炼商店
   * ============================================================ */
  /* ============================================================
   * 标签词表（tag vocabulary）—— **池子归属的唯一判据**
   *
   * 每条增益在数据里都必须显式写 `tags: [...]`，池子/展示/掉落全部由标签推导：
   *
   *   场所标签（至少要有一个，决定它在哪里出现）
   *     'tower'    挑战塔：会进挑战塔的场间选择池
   *     'endless'  无尽塔：会进无尽塔的场间选择池 / 商店 / 增益集锦
   *     'shop'     商店：会上试炼商店货架（只有无尽塔有商店，所以它必须同时有 endless）
   *   来源标签
   *     'battle'   战斗掉落：会作为「打赢之后的奖励选项」出现
   *                （配合 tower / endless 决定掉在哪座塔；只有 battle 没有塔标签是非法的）
   *   获取/叠层行为标签
   *     'limited'     限次类（kind=limited）：效果只服务下一场战斗，条目带 uses 次数
   *     'nextBattle'  效果只服务下一场战斗（比 limited 更宽：用于文案/展示口径）
   *     'stackable'   可叠层：可重复获得并叠加（上限见 maxStacks / stackCap）
   *     'oncePerRun'  每局限次获得：一局只能拿到一次（maxStacks=1）
   *     'repeatable'  可重复获得（会反复出现在池子里，不是同名唯一）
   *     'unique'      同名唯一：拿到之后不再出现在任何池子
   *     'hidden'      不进「增益集锦」展示（彩蛋/特殊获取）
   *
   * 下面把旧字段（towerOnly / endlessOnly / battleOnly / shopBanned / stackable /
   * unique / repeatable / nextBattle / hidden）**从标签反推并写回对象**：
   * 标签是唯一真相，旧字段只是给历史调用点看的派生值，两边不一致会在加载期抛错。
   * ============================================================ */
  const BUFF_TAGS = Object.freeze({
    tower: '挑战塔：进挑战塔的场间选择池',
    endless: '无尽塔：进无尽塔的场间选择池 / 商店 / 增益集锦',
    shop: '商店：上试炼商店货架（需同时有 endless）',
    battle: '战斗掉落：作为打赢后的奖励选项出现',
    limited: '限次类：效果只服务下一场战斗',
    nextBattle: '效果只服务下一场战斗',
    stackable: '可叠层：可重复获得并叠加',
    oncePerRun: '每局限次获得：一局只能拿到一次',
    repeatable: '可重复获得（非同名唯一）',
    unique: '同名唯一：拿到后不再进池',
    hidden: '不进「增益集锦」展示',
  });
  /* 池子 ← 需要哪些标签：这里的定义就是「严格池子管理」的规则表。 */
  const POOL_TAGS = Object.freeze({
    'T.choice': ['tower', 'battle'],      // 挑战塔场间选择
    'T.shop': ['tower', 'shop'],           // 挑战塔商店（塔目前没有商店，保留概念）
    'E.choice': ['endless', 'battle'],     // 无尽塔场间选择（战斗奖励）
    'E.shop': ['shop'],                    // 无尽塔试炼商店
  });
  const tagSet = (b) => (b && Array.isArray(b.tags) ? b.tags : []);
  const hasTag = (b, t) => tagSet(b).indexOf(t) >= 0;
  const tagsOf = (b) => tagSet(b).slice();
  const buffsWithTag = (t) => BUFFS.filter((b) => hasTag(b, t));
  const poolsOf = (b) => Object.keys(POOL_TAGS).filter((pool) => POOL_TAGS[pool].every((t) => hasTag(b, t)));
  /* 无尽专属 mod：带这些效果的增益只在无尽塔成立（环境词缀 / 试炼币 / 商店 /
   * 重新挑战币 / 结算 / 商店消费相关）。挑战塔带这类标签/效果一律加载期报错。 */
  const ENDLESS_ONLY_MODS = [
    'envIgnore', 'envReflect', 'envDenyGood', 'instantCoins', 'coinBoostPct', 'shopDiscount',
    /* 注意 enemyPowerDown 不在这里：挑战塔的 M01「威慑」也用它（下一场敌人攻击力 −30%），
     * 它是通用的「下一场战斗」减益，不是无尽专属。 */
    'openShop', 'instantRetry', 'enemyMaxHpDown', 'permSlot', 'pickWeaponPct',
    'pickSkillPct', 'pickPermanentFree', 'sellValue', 'sellGrowthPerWin', 'postBattleShop',
    'postBattleShopDiscount', 'shopSpendStep', 'shopSpendStat', 'shopSpendHp',
  ];
  const hasEndlessOnlyMod = (b) => Object.keys(b.mods || {}).some((k) => ENDLESS_ONLY_MODS.indexOf(k) >= 0);
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
  const TOWER_POOLS = Object.keys(POOL_TAGS).filter((t) => t.indexOf('T.') === 0);
  const ENDLESS_POOLS = Object.keys(POOL_TAGS).filter((t) => t.indexOf('E.') === 0);
  /* ---- 加载期校验（严格池子管理）---- */
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
    /* hidden 只表示「不进增益集锦展示」—— C32/C33/C37 这类选取型强化仍然照卖。 */
    /* 挑战塔里不能出现「只有无尽塔才有」的机制 */
    if (hasTag(b, 'tower') && hasEndlessOnlyMod(b)) {
      const bad = Object.keys(b.mods || {}).filter((k) => ENDLESS_ONLY_MODS.indexOf(k) >= 0);
      throw new Error('挑战塔池不该包含无尽专属增益 ' + b.id + '（' + bad.join(',') + '）—— 请去掉 tower 标签');
    }
  }
  /* ---- 标签 ↔ 旧字段：**只做一致性校验，不写回** ----
   * 池子归属已经全部由标签推导，旧字段（towerOnly/endlessOnly/battleOnly/shopBanned/
   * stackable/unique/repeatable/nextBattle/hidden）只在数据里**显式写过**的地方存在
   * （其它地方是 undefined，等价于 false），历史调用点照旧读它们。
   * 写法与标签冲突时报错，避免出现「标签说 A、字段说 B」。 */
  const LEGACY_FLAGS = {
    towerOnly: (b) => hasTag(b, 'tower') && !hasTag(b, 'endless'),
    endlessOnly: (b) => hasTag(b, 'endless') && !hasTag(b, 'tower'),
    battleOnly: (b) => hasTag(b, 'battle') && !hasTag(b, 'shop'),
    shopBanned: (b) => !hasTag(b, 'shop'),
    stackable: (b) => hasTag(b, 'stackable'),
    unique: (b) => hasTag(b, 'unique'),
    repeatable: (b) => hasTag(b, 'repeatable'),
    nextBattle: (b) => hasTag(b, 'nextBattle'),
    hidden: (b) => hasTag(b, 'hidden'),
  };
  for (const b of BUFFS) {
    for (const k of Object.keys(LEGACY_FLAGS)) {
      if (!(k in b)) continue;
      const want = LEGACY_FLAGS[k](b);
      if (!!b[k] !== want) {
        throw new Error('增益 ' + b.id + ' 的字段 ' + k + '=' + b[k] + ' 与 tags 推导出的 ' + want + ' 不一致');
      }
    }
  }
  /* 主塔（挑战塔）池 = 挑战塔场间选择池；无尽池 = 无尽塔场间选择池；商店池 = 无尽塔商店。 */
  const towerPool = ROSTERS.filter((r) => r.pools.indexOf('T.choice') >= 0).map((r) => r.b);
  const endlessPool = ROSTERS.filter((r) => r.pools.indexOf('E.choice') >= 0).map((r) => r.b);
  const shopPool = ROSTERS.filter((r) => r.pools.indexOf('E.shop') >= 0).map((r) => r.b);
  const PERMANENT_SLOTS = 5;

  /* ============================================================
   * 【D16】模块导出 —— window.TowerData
   * ============================================================ */
  window.TowerData = {
    towerLevel, towerMult, towerGold, towerGoldShares, TOWER_FAIL_CONSOLATION,
    endlessLevel, endlessSegment, endlessMult, endlessMechStacks, endlessMechs, ENDLESS_MECH_MAX, endlessTickets,
    GEAR_TIER, gearKeyForLayer, gearTierCap, ENDLESS_BOSS_POOL,
    ENDLESS_ENV, ENDLESS_ENV_BY_ID, envChance, rollEnvMods, envText, envRange, envRangeText, envPctKeys,
    ENV_START_LAYER, ENV_TWO_LAYER, ENV_MAX, ENV_DUR, repeatChanceInterval,
    ENDLESS_MECH_ORDER, ENDLESS_CONSOLATION_LAYER, SCORE, COINS, SHOP, shopPrice,
    FOE_STAT_MUL, FOE_POWER_MUL, FOE_HP_MUL, FOE_HERO_HP_MUL, FOE_HERO_POWER_MUL,
    FOE_TRIAL_POWER_MUL, FOE_WARLORD_POWER_MUL, bossHpRatio, BOSS_HP_MIN, BOSS_HP_MAX, WARLORD_HP_RATIO,
    ENDLESS_LAYER_HEAL_PCT, MILESTONE_EVERY, MILESTONE_BOOK_COUNT, rollMilestone, PERMANENT_SLOTS,
    endlessDepthMul, ENDLESS_DEEP_LAYER,
    buffScore, reviveScoreAt,
    SHOP_PRICE_OFFSET, rollShopPrice,
    rerollPriceAt, rerollPriceCapped, rerollTilt, tiltWeights, rerollExpectation, RARITY_SCORE, shopQualityScore,
    shopPool, POOLS, inPool, RARITY_NAME, RARITY_WEIGHTS,
    BUFF_TAGS, POOL_TAGS, hasTag, tagsOf, buffsWithTag, poolsOf,
    legendWeightFactor, legendOwnedCount, allRepeatableLegendsOwned, LEGEND_BASE_WEIGHT, rarityBoostOf,
    NPCS, NPC_BY_ID, HERO_DEBUFF,
    SQUIRRELS, SQUIRREL_BY_ID, squirrelFor,
    TRIALS, TRIAL_BY_ID, trialFor,
    GEAR, wearsOf, WARLORD, WARLORD_POOL, warlordFor, BOSS_POOL, bossFor, heroOrder, ENDLESS_ONLY_MODS, poolRoster, ROSTERS,
    TOWER_BATTLE_IDS,
    BUFFS, BUFF_BY_ID, FIXED_HEAL_PCT, AUTO_HEAL_PCT, STACK_MAX, stackCap, LEGACY_BUFF_IDS, BUFF_VER,
    SHOP_DISCOUNT_E04, SHOP_DISCOUNT_E01, SHOP_DISCOUNT_BOTH,
    SETTLE_DROP_BATTLES,
    towerPool, endlessPool,
  };
})();
