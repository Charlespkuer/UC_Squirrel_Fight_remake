/* ============================================================
 * tower-data.js — 无尽挑战塔 · 数值与池子定义（纯数据）
 * 数值与池子集中在数据表里（改动请同步 tools/test-fixes-round.cjs 的对应需求用例）。
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
  /** 无尽塔「战斗可跳过播放」的起始层（用户口径 2026-10：由 30 层下调到 20 层）。
   *  与 ENDLESS_DEEP_LAYER 无关 —— 那个是敌人深度曲线，不要混用。 */
  const ENDLESS_SKIP_LAYER = 20;
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
  /* 环境词缀的触发曲线：第 5 层 20%（= 0.14 + 1×0.06），之后每层 +6%，
   * 第 15 层到 80% 封顶（0.14 + 11×0.06 = 0.80）。三个数字抽成常量，调平衡只动这里。
   * 注意 15 层同时也是 ENV_TWO_LAYER（每场强制补满 2 条）——两件事同层发生，
   * 看起来像「15 层断崖」，实际是两个独立机制叠加。 */
  const ENV_CHANCE_START = 0.14;
  const ENV_CHANCE_STEP = 0.06;
  const ENV_CHANCE_CAP = 0.80;
  /** 战斗后触发概率：5 层 ~20%，之后每层 +6%，第 15 层起封顶 80%。 */
  function envChance(layer) {
    if (layer < ENV_START_LAYER) return 0;
    /* 三位小数取整：0.14 + 11×0.06 是 0.7999999999999999，不取整就会「差一点点」到不了封顶。 */
    const v = ENV_CHANCE_START + (layer - ENV_START_LAYER + 1) * ENV_CHANCE_STEP;
    return Math.min(ENV_CHANCE_CAP, Math.round(v * 1000) / 1000);
  }
  /** 触发概率在第几层封顶（= 15；供界面/测试显示，避免再出现「40 层封顶」的误会）。
   *  用 Math.round 而不是 ceil：浮点算 (0.80−0.14)/0.06 会得到 11.000000000000002。 */
  const ENV_CHANCE_CAP_LAYER = ENV_START_LAYER - 1 + Math.round((ENV_CHANCE_CAP - ENV_CHANCE_START) / ENV_CHANCE_STEP);
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
  /* 结算离场时「铸币 → 抽奖卷」的兑换上限（用户口径 2026-10）：
   * 最多 10 枚铸币按 1:1 换成抽奖卷，**超出的部分不再转化**（铸币本身随本局作废）。 */
  const TICKET_FROM_MINT_CAP = 10;
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
    retryPrice: 50,                // 铸币（内部字段 retryToken / retryPrice）：失败后回滚到本场开始前
    rerollPrice: 10,               // 第一次付费刷新的价格（之后每次 +rerollGrowth）
    rerollGrowth: 10,              // 涨价步长：10 → 20 → 30 → 40 → 50 → 60 → 70
    rerollMax: 70,                 // 第一段封顶价（爬到这里之后进入「档位」节奏）
    /* 2026-10 用户口径：**越过 70 之后不再封顶** —— 70 档刷新 10 次 → 80，80 档 10 次 → 90，以此类推。
     * 也就是「每 plateau 次涨价一个 growth」。质量（稀有度倾斜）仍在 rerollTiltCap=50 那档封顶。 */
    rerollPlateau: 10,
    /* 稀有度倾斜的封顶档（2026-10 新增）：**付超过 50 币也不会再提高下一页的稀有度** ——
     * 价格能一路涨到 70，但「质量」的收益在 50 那一档到顶（见 rerollTilt）。
     * 时来运转（E12）的提速同样受这条限制：它让钱更值钱，但买不到超过 50 的那一档。 */
    rerollTiltCap: 50,
    rerollTiltGrowth: 1.20,
  });
  function shopPrice(buff) {
    const p = SHOP.price[buff.rarity];
    return buff.scope === 'run' ? Math.round(p * SHOP.crossLayerMul / 10) * 10 : p;
  }
  /* ============================================================
   * 【D4b】铸币商店（无尽塔 · 战后随机小店）
   *
   * 只在「5 层之后的 x2/x3/x4 与 x7/x8/x9 层」出现：每场战斗结束后 5% 概率刷出；
   * 同一组连续三层（x2~x4 或 x7~x9）最多刷出一次（组号见 mintGroupOf，由 run.mintGroup 记账）。
   * 店里可以花**铸币**买走 1 件增益，或者免费拿自己已有的 1 件增益去换 1 件；
   * 二者任一做成就立刻消失（也可以直接走人，不买不换）。
   * 货架可免费刷新一次，刷新之后就不能再用「免费交换」。
   *
   * 售价**固定按稀有度**（不吃 E01/E04 任何折扣）：
   *   普通 0（赠品）/ 稀有 1 / 史诗 2 / 传奇 3 铸币。
   * 货架稀有度 ≈「试炼商店花 40 试炼币刷新一次」的排布，但普通档权重再压一档：
   *   实测（无天命所归、无传奇）≈ 普通 17% / 稀有 29% / 史诗 28% / 传奇 13%。
   * ============================================================ */
  const MINT_SHOP = Object.freeze({
    chance: 0.05,            // 每场战斗结束后的刷出概率（基准）
    /* 概率随深度增长：**每 5 层（每一段）+0.5 个百分点**，最高 10%（见 mintChance）。
     * 段号用 endlessSegment（⌈n/5⌉）：第 1 段（1~5 层）不加成，
     * 第 2 段（6~10 层）5.5% → …… → 第 11 段（51 层起）触及 10% 封顶。 */
    chanceStep: 0.005,
    chanceMax: 0.10,
    minLayer: 6,             // 「5 层之后」→ 第 6 层起
    shelf: 5,                // 货架件数
    price: [0, 1, 2, 3],     // 普通/稀有/史诗/传奇 → 铸币
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
  /** 这一层是否在铸币商店的刷出区间：5 层之后、尾数为 2/3/4/7/8/9 的层。 */
  function mintLayerOk(layer) {
    const n = Math.floor(Number(layer) || 0);
    if (n < MINT_SHOP.minLayer) return false;
    const mod = n % 5;
    return mod === 2 || mod === 3 || mod === 4;      // x2/x3/x4 与 x7/x8/x9
  }
  /** 连续三层的组号（x2~x4 = 1 组、x7~x9 = 1 组）：同一组里只允许刷出一次。 */
  function mintGroupOf(layer) {
    const n = Math.max(1, Math.floor(Number(layer) || 1));
    return Math.floor((n - 2) / 5);
  }
  /** 铸币售价（按稀有度固定；普通件 0 铸币）。 */
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
   *   · 前 7 次：10 → 20 → … → 70（每次 +rerollGrowth，老口径不变）
   *   · 到 70 之后进入**档位节奏**：70 用 plateau(10) 次 → 80 用 10 次 → 90 用 10 次 → …（无上限）
   * 例（growth=10 / max=70 / plateau=10）：第 7~16 次都是 70，第 17~26 次 80，第 27~36 次 90。
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
    /* 爬到 max 的那一次（base + step×(k-1) === max）算「70 档的第 1 次」。 */
    const firstMaxed = Math.max(1, Math.round((max - base) / step) + 1);
    const over = n - firstMaxed;                            // 0 起：70 档里的第 over+1 次
    return Math.round(max + step * Math.floor(over / plateau));
  }
  /** 【任务3 后】价格**永不封顶** → 恒为 false（保留函数是为了让界面代码不用改调用点）。
   *  「收益封顶」改看 rerollQualityCapped：稀有度倾斜在 rerollTiltCap(50) 那一档到顶。 */
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
   *  传 run 时把「时来运转」的加速算进去（等价于同样的钱多花了一倍）。
   *  **有效金额在 SHOP.rerollTiltCap 封顶**（默认为 50）：价格可以涨到 70，但稀有度只到 50 那一档。 */
  function rerollTilt(paid, run) {
    const cap = Math.max(0, Number(SHOP.rerollTiltCap) || 0);
    const raw = Math.max(0, Number(paid) || 0) * tiltRateMul(run);
    const money = cap > 0 ? Math.min(cap, raw) : raw;
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
    const need = BUFFS.filter((b) => b.rarity === 3 && hasTag(b, 'repeatable'));
    return need.length > 0 && need.every((b) => own.has(b.id));
  }
  /** 传奇那一档的权重系数（1 = 没拿过任何传奇）。 */
  /* 2026-10 用户口径（任务3）：**去掉传奇档的档位级降权**
   *（原来 = 0.88^已拥有传奇数 ×（全部可重复传奇到手 ? 0.35 : 1））。
   * 保留函数与口径，只用一个开关关掉 —— 想恢复把这里改回 true 即可。
   * 现在传奇的稀有度只由**个体**规律决定（repeatWeight / shopWeight），整个传奇档不再跟着缩水。 */
  const LEGEND_TIER_DECAY = false;
  function legendWeightFactor(run) {
    if (!LEGEND_TIER_DECAY) return 1;
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
  /** 档位**原始**权重（未归一化）：基础表 ×（传奇两档下调 / 天命所归）× 刷新倾斜 p^i。
   *  归一化只是显示口径；真正抽取时会在「动态档位权重」里再缩放并按全局归一化，
   *  所以这里保留原值，便于直接看出每一档的预算。 */
  function rawTierWeights(tilt, run) {
    const p = Math.max(0, Number(tilt) || 1);
    const boost = rarityBoostOf(run);
    const legendMul = (LEGEND_BASE_WEIGHT / RARITY_WEIGHTS[3]) * legendWeightFactor(run) * boost.legend;
    const slotMul = (i) => (i === 0 ? boost.common : i === 2 ? boost.epic : 1);
    return RARITY_WEIGHTS.map((v, i) => (i === 3 ? v * legendMul : v * slotMul(i)) * Math.pow(p, i));
  }
  function tiltWeights(tilt, run) {
    const w = rawTierWeights(tilt, run);
    const total = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((v) => v / total);
  }
  /* ============================================================
   * 动态稀有度权重（2026-10 用户口径）
   *
   * 旧做法是**两步**：先按 [66,21,10,2.2] 摇一个稀有度档，再在档内按个体权重抽一件。
   * 问题：某个 buff 的个体权重被调低时，省下来的份额只在**同一档内**分给别的 buff，
   * 档位总概率一点不变（极端情况：该档只剩它一件时，`list.length===1` 直接返回，
   * 个体权重被完全忽略）。于是「把虚空铭文的权重 ÷N」在体感上几乎没用。
   *
   * 现在把两步合成一次**全局**加权抽取：
   *     档 r 的实际权重 = base[r] × Σ_{b∈可用(r)} m_b / |可用(r)|        （档内平均倍率）
   *     单件 b 的权重   = base[r] × m_b / |可用(r)|
   * 两者等价，且「m_b 下降 → 整档预算一起缩水 → 省下的概率按比例分给其它档」，
   * 正是用户要的动态分配（等价于把 α,β,γ,δ 重算一遍再归一化，但不需要真的重算）。
   *
   * m_b 由 buff.shopWeight（静态设计权重）与 run 状态惩罚（repeatWeight / weightDivBy）组成；
   * TIER_AVG_INCLUDES_STATIC = false 时，只有**随状态变化**的那部分参与档位缩放 ——
   * 这样新开一局的稀有度分布与旧版逐位一致，只有「拿了之后越来越难看到」才生效。
   * ============================================================ */
  const TIER_DYNAMIC_WEIGHTS = true;
  const TIER_AVG_INCLUDES_STATIC = false;
  /* ============================================================
   * 传奇保底（B 方案：计数硬保底）
   *
   * 每一次「掷稀有度」都算一格（试炼商店的每一格货架 + 战斗奖励的每一个选项，铸币商店不算）。
   * 连续 slots 格没掷到传奇 → 下一格**强制走传奇档**，并在档内按 `mods.pityWeight` 挑：
   *   · pityWeight = 0 → 不进保底池（例如 C36 挥金如土，运营向）；
   *   · 缺省 = 1；C37 虚空铭文 = 1、C49 终焉烙印 = 2。
   * 于是「传奇全部拿完、只剩这两条」时，保底给出的分布**恰好是 1/3 C37 + 2/3 C49**。
   *
   * 保底**只决定「是哪一档」与「档内挑谁」**，不改变自然出率：自然掷到传奇同样会清零计数。
   * slots 调大 = 更少干预（早期几乎无感），调小 = 更强的地板。 */
  const LEGEND_PITY = Object.freeze({ slots: 120 });
  /** 这一次刷新「本来」与「倾斜后」的期望稀有度 / 史诗件数（界面与测试都用它）。 */
  function rerollExpectation(paid, run) {
    const slots = Math.max(1, (SHOP && SHOP.slots) || 5);
    const mean = (w) => w.reduce((a, v, i) => a + v * i, 0);
    /* run 可选：传入后按「已拥有传奇数」再压传奇那一档，与商店实际抽取同口径。 */
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

  /* 前三场打的是三侠。他们的招牌技一旦**真的打到玩家**（被闪避 / 弹反 / 装死挡掉、
   * 或被护盾全吸收的那次不算），就会给玩家留下一层**打到本层结束**都一直在的削弱；
   * 进第 4 场前选 buff 时必须把这些削弱算进去。
   * 反过来说：打得够快、不让大招放出来，就可以完全规避 —— 这是本层的第一层对策。
   * 对应大招名见 sim.js 的 npcUlt（疾风镰刀舞 / 仙鹤展翅 / 熊掌震地）。
   *
   * 2026-10 调整（用户口径）：**削弱按「实际命中的大招次数」累加，且数值带随机浮动、各有本层上限**：
   *   · 螳螂「重伤」：每次命中随机 −pctRange 的生命上限，本层累计最多 −capPct；
   *   · 仙鹤「战吼」：每次命中随机削一项属性，本层最多 maxTimes 次；
   *   · 熊猫「压制」：每次命中随机锁一把武器 / 一个技能，本层最多 maxTimes 个。
   * （大招每场只放一次，所以同一位大侠在一层里命中几次，取决于幻影回响 / 时间回廊这类「再打一场」。） */
  const HERO_DEBUFF = Object.freeze({
    tl: { anim: 'tl', ult: '疾风镰刀舞', kind: 'maxHp', name: '重伤',
      pctRange: [0.03, 0.06], capPct: 0.15,
      desc: '大招命中：生命上限 −3%~6%（本层累计最多 −15%）' },
    xh: { anim: 'xh', ult: '仙鹤展翅', kind: 'stat', name: '战吼',
      pctRange: [0.05, 0.10], maxTimes: 3,
      desc: '大招命中：随机一项属性 −5%~10%（本层最多 3 次）' },
    xm: { anim: 'xm', ult: '熊掌震地', kind: 'lock', name: '压制', maxTimes: 2,
      desc: '大招命中：随机锁住一个武器或技能（本层最多 2 个）' },
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

  /* 设计约束：
   *   1. 可预告：mechDesc 要写清「第几次行动」「百分比」，进层前 / 选 buff 时就能读到；
   *   2. 改变节奏而不是加血：每个 boss 都有自己的「爆发窗口 / 该苟的窗口」；
   *   3. 机制文本按**普通 boss 简介**的口径写，不写「对策建议」（那是给策划看的，见文档）。
   * 数值上复用松鼠的系数与武技池（同族贴图、固定出招循环 → 可背板），
   * bias 随机制调整：血厚的（苔龟/镜鳞/蚀骨）攻击更低，反之亦然。
   * 机制实现全部在 sim.js（trial* 前缀），这里只写数据。 */
  const MIRROR_THRESHOLD = 0.20;
  const MIRROR_REFLECT = 0.40;   // 反弹该次伤害的 40%
  /* 「沉默之壁」的溢出反弹阈值：单次**受到**的伤害超过自身生命上限的这个比例时，
   * **超出的那一截**全额反弹给出手方（不是按整次伤害的百分比）。
   * 与镜鳞的区别：镜鳞是「按整次伤害的 40% 反弹」，这里是「只反超出 25% 的那一截」——
   * 所以「压着阈值多段打」是被鼓励的解法，玩家会主动控制单次爆发。 */
  const OVERFLOW_THRESHOLD = 0.25;
  /* 会「封死对手的一切治疗」的机制 id。
   * sim 用它把对手的 healMul 在**战斗开始**就归零；战斗准备（tower.js 的 adjustMe）
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
      /* 封疗是很强的压制（回血流直接作废），所以生命乘数从 1.06 下调到 0.96 作为补偿 ——
       * 它不该同时又是最厚的那一档。 */
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
     * 玩家不被逼着爆发，可以压着 25% 阈值慢慢磨 —— 机制在，但很难真正咬到人。
     * 数值意图：hp 1.42（阈值 = 0.25×血量，基础血量越高越难被单次打穿）、
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
      /* 2026-10 第十四批（用户口径）：挑战塔 20 层的最终首领**超模**，模拟实测
       *（推荐等级 55 的随机练度玩家、单场 400 次）：
       *   无双 13.0% / 铁壁 7.8% / 血怒 9.0% / 霜狱 3.5% / **无常 3.0%** ← 全场最难。
       * 削弱按用户给的两条路一起做：
       *   · **降低武器等级**：激光剑 12 → 8（层 20 实际 14 → 10）；
       *   · **削弱频繁追加行动**：小宇宙爆发 12 → 8、敏捷 1.08 → 1.00、速度 1.12 → 1.02 —— 
       *     它的「出手比玩家多」（实测敌出手 6.1 次 / 玩家 ~4 次）主要来自速度与宇宙爆发的属性提升。
       * 实测削弱后同一场：3.0% → **10.3%**（与无双 13% / 血怒 9% 同档，仍是硬骨头）。
       * 旧描述里写的「会冻结与吸血」与它实际的武技（激光剑=暴击、绝对防御、装死、皮糙肉厚）不符，一并改正。 */
      bias: { power: 1.10, agility: 1.00, speed: 1.02, hp: 1.04 },
      weapons: [{ id: 11, level: 8 }],
      skills: [{ id: 14, level: 8 }, { id: 16, level: 12 }, { id: 6, level: 10 }, { id: 10, level: 10 }],
      castable: [14], pattern: ['weapon', 'skill', 'common', 'weapon'],
      patternDesc: '固定循环：激光剑 → 小宇宙爆发 → 普攻 → 激光剑',
      mechDesc: '精英：小宇宙爆发 8 级（开场追加一次行动 + 属性提升）、激光剑高暴击；' +
        '自带绝对防御 12 级与皮糙肉厚 10 级，濒死时装死保命 —— 出手快、爆发高' },
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
  /* 无尽塔第 4/5 场只要松鼠形态：NPC 机制怪只留在挑战塔。
   * 2026-10 第十四批（用户口径）：把「狂战松鼠」这一族**也开放给无尽塔的精英/boss 池**
   *   —— 它本来就是松鼠形态 + 狂战套，进第 4 场时按 `entry.kind === 'warlord'` 记为精英
   *   （×1.2 三围 + 精英掉落/计分），变体仍按 (salt, 层数) 哈希取，预告 = 实战。
   *   注意 x10 层的第 5 场已经是固定狂战松鼠 → 第 4 场由 bossFor 排除它，避免一层两只。 */
  const ENDLESS_BOSS_POOL = Object.freeze([
    ...TRIALS.map((t) => ({ kind: 'trial', id: t.id })),
    ...SQUIRRELS.map((s) => ({ kind: 'squirrel', id: s.id })),
    { kind: 'warlord', id: 'warlord' },
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
    let pool = squirrelsOnly ? ENDLESS_BOSS_POOL : BOSS_POOL;
    /* x10 层的第 5 场已经是固定狂战松鼠 → 第 4 场不再抽到狂战，避免一层里打两只。
     * （只影响无尽塔：挑战塔的池子里本来就没有狂战。） */
    if (Math.max(1, Number(layer) || 1) % 10 === 0) {
      const noWarlord = pool.filter((p) => p.kind !== 'warlord');
      if (noWarlord.length) pool = noWarlord;
    }
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
  //   postBattleMintShop(战后必开铸币商店，顶掉本场的普通商店)
  const BUFFS = Object.freeze([
    // —— 单场类（主塔+无尽通用） ——
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
    { id: 'N08', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '补给', rarity: 0, kind: 'limited', uses: 1,
      desc: '下一场战斗开始时立即回复 50% 生命', mods: { startHealPct: 0.50 } },
    { id: 'N06', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '血饮狂刀', rarity: 2, kind: 'limited', uses: 5, desc: '下一场战斗攻击附带 45% 吸血', mods: { lifestealPct: 0.45 } },
    // —— 本层类（主塔=整局；无尽=当前层） ——
    { id: 'G01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '力量祝福', rarity: 0, kind: 'limited', uses: 10, desc: '下一场战斗力量、敏捷、速度各 +20%', mods: { powerMul: 0.20, agilityMul: 0.20, speedMul: 0.20 } },
    { id: 'G02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '生命祝福', rarity: 0, kind: 'limited', uses: 5, desc: '下一场战斗生命上限 +20%，并在开战第一回合回复 40% 生命上限', mods: { maxHpMul: 0.20, startHealPct: 0.40 } },
    { id: 'G03', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '凌波微步', rarity: 1, kind: 'limited', uses: 10, desc: '下一场战斗我方闪避率 +15%', mods: { dodgeBonus: 15 } },
    { id: 'G04', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '破釜沉舟', rarity: 2, kind: 'limited', uses: 3, desc: '下一场战斗攻击 +70%，生命上限 −20%', mods: { powerMul: 0.70, maxHpMul: -0.20 } },
    /* ============================================================
     * 挑战塔专属「下一场战斗」增益（towerOnly + nextBattle）
     *
     * 挑战塔是一层四场连战、打完结算，所以它的增益天然只服务**下一场**：
     * 不搞「接下来 N 场」那种叠加计时，卡面直接写「下一场战斗」。
     * 这些条目不会进无尽池（endlessPool 过滤 towerOnly）。
     * ============================================================ */
    { id: 'T01', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '闪亮登场', rarity: 2, kind: 'limited', uses: 1,
      desc: '下一场战斗：前 3 次使用武器时攻击 +50% 且必中，同时免疫反伤；之后我方攻击 −20%',
      mods: { weaponBoostUses: 3, weaponBoostPowerMul: 0.50, weaponBoostMustHit: 1, weaponBoostReflectImmune: 1, weaponBoostFatigueMul: 0.20 } },
    { id: 'T02', tags: ['tower', 'battle', 'limited', 'nextBattle'], name: '烟幕', rarity: 1, kind: 'limited', uses: 1,
      desc: '下一场战斗：我方闪避率 ×1.5',
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
    // —— 跨层类（仅无尽，本局永久） ——
    /* 语义：生命上限 +20%（永久，拿到就折算进 run.hpBonus），并回复等量生命。
     * 注意它与「获得时回血」类（healOnGainPct）不是一回事 —— 后者只回血、不抬上限。 */
    { id: 'C01', tags: ['tower', 'endless', 'shop'], name: '磐石之躯', rarity: 1, kind: 'permanent', desc: '生命上限 +20%，并回复等量生命', mods: { maxHpMul: 0.20 } },
    { id: 'C02', tags: ['tower', 'endless', 'battle', 'shop'], name: '磨砺', rarity: 0, kind: 'permanent', desc: '攻击 +30%', mods: { powerMul: 0.30 } },
    { id: 'C03', tags: ['endless', 'battle', 'shop', 'stackable'], name: '猎侠者', rarity: 0, kind: 'permanent', maxStacks: 3, desc: '对螳螂/仙鹤/熊猫伤害 +25%', mods: { dmgMulType: 0.25 } },
    /* unique：**多份没有意义**（100% 回血已经顶满）→ 身上有就不再出现（用户口径 2026-10）。 */
    { id: 'C04', tags: ['endless', 'shop', 'unique'], name: '生命源泉', rarity: 1, kind: 'permanent', desc: '每进入新的一层，该层第一场战斗开战时回复 100% 生命', mods: { layerFirstHealPct: 1.00 } },
    { id: 'C05', tags: ['tower', 'endless', 'battle', 'shop'], name: '坚韧壁垒', rarity: 1, kind: 'permanent', desc: '每场战斗开局获得 15% 最大生命的护盾', mods: { shellPct: 0.15 } },
    { id: 'C06', tags: ['endless', 'battle', 'shop', 'stackable'], name: '猎杀时刻', rarity: 1, kind: 'permanent', desc: '每击杀 1 个敌人攻击 +2%，最多 +30%', mods: { killPowerPct: 0.02, killPowerCap: 0.30 } },
    { id: 'C07', tags: ['endless', 'battle', 'shop', 'stackable'], name: '吞噬成长', rarity: 1, kind: 'permanent',
      desc: '每胜利一场生命上限 +2%，最多 +30%', mods: { winMaxHpPct: 0.02, winMaxHpCap: 0.30 } },
    /* unique：效果只在「5 的倍数层」当开关用（不在聚合里按层数相加）→ 多份无意义。 */
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
     *   · 敏捷/速度那两份同样是终乘（lowHpAgilityMul / lowHpSpeedMul）——
     *     在「基础值 ×(1−削弱) + buffFlat（越战越勇 / 后发制人这类回合成长）」全部算完之后
     *     再 ×1.2，也就是引擎真正使用的最终敏捷/速度（sim.js 的 effAgility / effSpeed 是唯一出口：
     *     命中率、闪避率、出手频率、野球拳/仙鹤的（力+速）伤害都读它）。
     * 所以三项都不会被其它乘区稀释 —— 低血才触发的门槛配得上这个待遇。 */
    { id: 'C20', tags: ['tower', 'endless', 'battle', 'shop'], name: '狂怒', rarity: 2, kind: 'permanent',
      desc: '生命低于一半时：最终伤害 ×1.5、最终敏捷 ×1.2、最终速度 ×1.2（三项都是终乘，在其它加成与削弱全部算完之后再乘）',
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
     * 2026-10 用户口径：**背包里攒到 3 个之后就不再生成** —— 加 `noRestack`
     * （拿满 maxStacks 即出池，也不会再走「叠满开新栏位」的通用规则）。 */
    { id: 'C50', tags: ['endless', 'battle', 'shop', 'stackable', 'noRestack'], name: '抉择扩充', rarity: 1, kind: 'permanent', maxStacks: 3,
      desc: '战斗获得的选择项 +1（最多 3 层）',
      mods: { choiceCount: 1 } },
    /* 减伤成长：每胜利一场，本局受到伤害再 −1%（上限 −25%）。
     * 与 C07（生命成长）/ C11（生命固定成长）/ C12（力敏速成长）同一族的「成长型」，
     * 但作用在减伤上 —— 无尽塔后期最缺的就是续航。 */
    /* 2026-10 用户口径：**不可重复获得**（多份太超模）→ `unique`：拿过一次就不再进池。 */
    { id: 'C48', tags: ['endless', 'battle', 'shop', 'unique'], name: '铜墙铁壁', rarity: 2, kind: 'permanent',
      desc: '本局每胜利一场，受到的伤害额外 −1%，最多 −25%',
      mods: { winTakenMulPct: 0.01, winTakenMulCap: 0.25 } },
    { id: 'C21', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '暴击精通', rarity: 0, kind: 'permanent', maxStacks: 3, desc: '暴击率 +15%', mods: { critBonus: 15 } },
    { id: 'C22', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '闪避精通', rarity: 0, kind: 'permanent', maxStacks: 3, desc: '闪避率 +20%', mods: { dodgeBonus: 20 } },
    { id: 'C23', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '轻身术', rarity: 0, kind: 'permanent', maxStacks: 3, desc: '速度 +20%', mods: { speedMul: 0.20 } },
    /* 以战养战：**不能再叠加**（用户口径 2026-10）。去掉 stackable 并锁定 1 份：
     * 既不会同格叠层，也不会按「叠满开新栏位」的通用规则再占一格（见 addBuff 的 permanent 分支）。 */
    { id: 'C11', tags: ['endless', 'battle', 'shop', 'oncePerRun'], name: '以战养战', rarity: 2, kind: 'permanent', maxStacks: 1, desc: '每胜利一场，生命上限 +5', mods: { winMaxHpFlat: 5 } },
    /* 登顶者：第 10 层起每胜利一场，本局固定 +1 力 / +1 敏 / +1 速。
     * 2026-10 用户口径：**强度削弱为原来的 1/3** —— 原来可叠 3 层（每场最多 +3/项），
     * 现在锁定 1 份（+1/项 × 1 层）＝ 原来的 1/3，文案也按用户给的写法收敛。 */
    { id: 'C12', tags: ['endless', 'battle', 'shop', 'oncePerRun'], name: '登顶者', rarity: 2, kind: 'permanent', maxStacks: 1,
      desc: '第 10 层起，每胜利一场，本局力&敏&速 +1',
      mods: { winStatAfter10: 1 } },
    { id: 'C13', tags: ['tower', 'endless', 'battle', 'shop'], name: '精英杀手', rarity: 2, kind: 'permanent',
      desc: '对精英伤害 +40%；击败精英后回复 20% 最大生命并增加 10% 最大生命',
      mods: { dmgMulElite: 0.40, eliteHealAfter: 0.20, eliteMaxHpAfter: 0.10 } },
    { id: 'C14', tags: ['tower', 'endless', 'battle', 'shop', 'stackable', 'noRestack'], name: '涅槃', rarity: 3, kind: 'permanent', shopWeight: 0.5, maxStacks: 2,
      desc: '每层战斗可复活一次；复活回复 50% 生命上限，本场力量、敏捷、速度 +50%',
      mods: { revivePct: 0.50, reviveStatMul: 0.50 } },
    { id: 'C51', tags: ['endless', 'battle', 'unique'], name: '天命所归', rarity: 3, kind: 'permanent', maxStacks: 1,
      desc: '本局战斗奖励与商店的史诗/传奇出率 ×2、普通出率 ×0.5（不可叠加，拥有后本局不再出现）',
      mods: { rarityBoost: 1, epicMul: 2, legendMul: 2, commonMul: 0.5 } },
    { id: 'E01', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle', 'ops'], name: '立即进货', rarity: 2, kind: 'limited', uses: 1,
      desc: '下一场战斗结束后立即开启一次试炼商店，全部商品 7 折；若同时持有「steam大促」，两档折扣叠加为 3.5 折',
      mods: { postBattleShop: 1, postBattleShopDiscount: 0.30 } },
    /* E16「铸币商队」= E01「立即进货」的铸币版：下一场战斗后**必开一家铸币商店**（限次 1）。
     * 与 E01 同场生效时由它**顶掉**那家试炼商店（用户口径：一次战斗只开一家店，铸币优先）；
     * 那一场如果是每 5 层的最后一战，也顶掉结算商店 —— 但「关店后推进到下一层 / 先放弃一个
     * 永久增益」的去向照旧保留（见 tower.js 的 openMintShop({boundary}) 与 closeMintShop）。 */
    { id: 'E16', tags: ['endless', 'battle', 'shop', 'limited', 'nextBattle', 'ops'], name: '铸币商队', rarity: 1, kind: 'limited', uses: 1,
      desc: '下一场战斗结束后立即生成 1 家铸币商店（若本场本该开出普通商店，则由它顶掉）',
      mods: { postBattleMintShop: 1 } },
    { id: 'E02', tags: ['endless', 'battle', 'ops'], name: '试炼补贴', rarity: 0, kind: 'instant', desc: '立刻获得 60 试炼币', mods: { instantCoins: 60 } },
    { id: 'E03', tags: ['endless', 'battle', 'ops'], name: '财源滚滚', rarity: 1, kind: 'instant', desc: '立刻获得 120 试炼币', mods: { instantCoins: 120 } },
    { id: 'E04', tags: ['endless', 'battle', 'oncePerRun', 'ops'], name: 'steam大促', rarity: 1, kind: 'instant', maxStacks: 1,
      desc: '下一个试炼商店全部商品 7 折', mods: { shopDiscount: 0.30 } },
    { id: 'E05', tags: ['endless', 'battle', 'shop', 'limited', 'ops'], name: '战利品', rarity: 1, kind: 'limited', uses: 10, desc: '接下来 10 场战斗的试炼币获取 ×1.8', mods: { coinBoostPct: 0.80 } },
    { id: 'E06', tags: ['endless', 'battle', 'shop', 'limited', 'ops'], name: '战利品·精', rarity: 2, kind: 'limited', uses: 10, desc: '接下来 10 场战斗的试炼币获取 ×2.4', mods: { coinBoostPct: 1.40 } },
    /* 战利品三档里的**普通**那一档（本轮新增）：×1.4 —— 让「试炼币运营」这条线从普通档就起步，
     * 上位是 E05 战利品（稀有 ×1.8）/ E06 战利品·精（史诗 ×2.4）。 */
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
    { id: 'C32', tags: ['endless', 'battle', 'shop', 'unique', 'hidden'], name: '神兵淬炼', rarity: 2, kind: 'permanent',
      desc: '立即从已有武器中随机三选一，该武器伤害 +100%', mods: { pickWeaponPct: 1.00 } },
    { id: 'C33', tags: ['endless', 'battle', 'shop', 'unique', 'hidden'], name: '秘技通神', rarity: 2, kind: 'permanent',
      desc: '立即从已有主动技能中随机三选一，该技能触发概率 +60%', mods: { pickSkillPct: 0.60 } },
    /* 对抗环境词缀的三档 buff（普通/稀有/史诗） */
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
    /* unique：`envIgnore/envReflect/envDenyGood` 都是布尔开关（`runModTotal(...) > 0`）→ 多份无意义。 */
    { id: 'C45', tags: ['endless', 'battle', 'shop', 'unique'], name: '天象之眼', rarity: 2, kind: 'permanent',
      desc: '无视负面环境词缀；敌方无法获得环境词缀加成',
      mods: { envIgnore: 1, envReflect: 1, envDenyGood: 1 } },
    { id: 'C24', tags: ['endless', 'battle', 'stackable', 'ops'], name: '名贵手表', rarity: 1, kind: 'permanent', maxStacks: 2,
      desc: '售出可获得 200 试炼币', mods: { sellValue: 200 } },
    { id: 'C25', tags: ['endless', 'battle', 'shop', 'ops'], name: '战利品账本', rarity: 1, kind: 'permanent',
      desc: '售出可获得 50 试炼币；每胜利一场售价 +10',
      mods: { sellValue: 50, sellGrowthPerWin: 10 } },
    { id: 'C15', tags: ['endless', 'battle', 'shop'], name: '增幅水晶', rarity: 2, kind: 'permanent', desc: '本局内所有 buff 的效果 ×1.4', mods: { globalMul: 1.40 } },
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
      desc: '下一场战斗结束后，立即从本层第 1 场重新开始：手上的增益、试炼币、分数与血量都不回退，敌人数值也不会提升；' +
        '即使那一场是本层最后一场，也照样回到本层开头',
      mods: { layerRestart: 1 } },
    { id: 'E07', tags: ['endless', 'battle', 'oncePerRun', 'repeatable'], name: '挫锐', rarity: 0, kind: 'instant', maxStacks: 1,
      desc: '立刻让本局所有敌人的生命上限 −10%', mods: { enemyMaxHpDown: 0.10 } },
    { id: 'E08', tags: ['endless', 'battle', 'oncePerRun', 'repeatable'], name: '卸甲', rarity: 1, kind: 'instant', maxStacks: 1,
      desc: '立刻让本局所有敌人的生命上限 −15%', mods: { enemyMaxHpDown: 0.15 } },
    { id: 'E11', tags: ['endless', 'battle', 'oncePerRun', 'repeatable'], name: '挫锋', rarity: 2, kind: 'instant', maxStacks: 1,
      desc: '立刻让本局所有敌人的攻击力 −15%',
      mods: { enemyPowerDown: 0.15 } },
    { id: 'C34', tags: ['tower', 'endless', 'battle', 'shop'], name: '轻装上阵', rarity: 0, kind: 'permanent',
      desc: '每个空的永久增益位让攻击 +20%', mods: { powerPerEmptySlot: 0.20 } },
    { id: 'C35', tags: ['endless', 'battle', 'shop'], name: '厚积薄发', rarity: 2, kind: 'permanent',
      desc: '每拥有 1 个永久增益，攻击 +10%；被虚空铭文附魔的增益只算 2%',
      mods: { powerPerPermBuff: 0.10, powerPerPermBuffEnchantedWeight: 0.20 } },
    { id: 'C36', tags: ['endless', 'battle', 'shop', 'oncePerRun', 'ops'], name: '挥金如土', rarity: 3, kind: 'permanent', maxStacks: 1,
      desc: '每在试炼商店消费5&10&15试炼币，随机获得「力 +1 / 敏 +1 / 速 +1 / 生命上限 +5」中的一项',
      mods: { shopSpendStep: 5, shopSpendTiers: [5, 10, 15], shopSpendTierSize: 20,
        shopSpendStat: 1, shopSpendHp: 5, pityWeight: 0 } },
    { id: 'C37', tags: ['endless', 'battle', 'shop', 'repeatable', 'hidden', 'ops'], name: '虚空铭文', rarity: 3, kind: 'permanent',
      desc: '从永久增益里选一个附赠铭文：它不再占用永久增益位（本局每多附魔一个，这张铭文与整个传奇档的出现概率都会再低一档）',
      mods: { pickPermanentFree: 1, weightDivBy: 'enchanted', weightDivOffset: 1, pityWeight: 1 } },
    { id: 'C39', tags: ['endless', 'battle', 'shop', 'limited'], name: '力量烙印', rarity: 0, kind: 'limited', uses: 1000,
      desc: '力量 +5%，损毁后 +8% 并本局永久保留；每胜利一场6%概率损毁',
      mods: { fragileStat: 'power', fragilePct: 0.05, fragileBurnedPct: 0.08, fragileBreakPct: 6 } },
    { id: 'C40', tags: ['endless', 'battle', 'shop', 'limited'], name: '敏捷烙印', rarity: 0, kind: 'limited', uses: 1000,
      desc: '敏捷 +5%，损毁后 +8% 并本局永久保留；每胜利一场6%概率损毁',
      mods: { fragileStat: 'agility', fragilePct: 0.05, fragileBurnedPct: 0.08, fragileBreakPct: 6 } },
    { id: 'C41', tags: ['endless', 'battle', 'shop', 'limited'], name: '速度烙印', rarity: 0, kind: 'limited', uses: 1000,
      desc: '速度 +5%，损毁后 +8% 并本局永久保留；每胜利一场6%概率损毁',
      mods: { fragileStat: 'speed', fragilePct: 0.05, fragileBurnedPct: 0.08, fragileBreakPct: 6 } },
    { id: 'C42', tags: ['endless', 'battle', 'shop', 'limited'], name: '力量烙印·精', rarity: 1, kind: 'limited', uses: 1000,
      desc: '力量 +12%，损毁后 +16% 并本局永久保留；每胜利一场6%概率损毁',
      mods: { fragileStat: 'power', fragilePct: 0.12, fragileBurnedPct: 0.16, fragileBreakPct: 6 } },
    { id: 'C43', tags: ['endless', 'battle', 'shop', 'limited'], name: '敏捷烙印·精', rarity: 1, kind: 'limited', uses: 1000,
      desc: '敏捷 +12%，损毁后 +16% 并本局永久保留；每胜利一场6%概率损毁',
      mods: { fragileStat: 'agility', fragilePct: 0.12, fragileBurnedPct: 0.16, fragileBreakPct: 6 } },
    { id: 'C44', tags: ['endless', 'battle', 'shop', 'limited'], name: '速度烙印·精', rarity: 1, kind: 'limited', uses: 1000,
      desc: '速度 +12%，损毁后 +16% 并本局永久保留；每胜利一场6%概率损毁',
      mods: { fragileStat: 'speed', fragilePct: 0.12, fragileBurnedPct: 0.16, fragileBreakPct: 6 } },
    { id: 'C49', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '终焉烙印', rarity: 3, kind: 'limited', uses: 1000,
      desc: '力/敏/速/生命上限 +20%（终乘），损毁后本局 +30%；每胜利一场6%概率损毁',
      mods: { fragileFinalMul: true, fragileAddAlive: 0.20, fragileAddBurned: 0.30, fragileBreakPct: 6,
        repeatWeight: 0.88, pityWeight: 1 },
      unlimitedStacks: true },
    { id: 'C52', tags: ['endless', 'battle', 'shop', 'limited', 'repeatable'], name: '涌泉烙印', rarity: 1, kind: 'limited', uses: 1000,
      desc: '治疗量 +10%，损毁后本局 +20%',
      unlimitedStacks: true,
      mods: { fragileHealAddAlive: 0.10, fragileHealAddBurned: 0.20,
        fragileBreakPct: 6 } },
    { id: 'C53', tags: ['endless', 'battle', 'limited', 'oncePerRun', 'ops'], name: '淘金烙印', rarity: 3, kind: 'limited', uses: 1000, maxStacks: 1,
      desc: '战斗获得试炼币 +15%，损毁后本局 +30%；每胜利一场6%概率损毁',
      mods: { fragileCoinAddAlive: 0.15, fragileCoinAddBurned: 0.30, fragileBreakPct: 6 } },
    { id: 'C54', tags: ['tower', 'endless', 'battle', 'shop', 'stackable'], name: '越战越勇', rarity: 2, kind: 'permanent', maxStacks: 2,
      desc: '战斗中每回合开始时，力量、敏捷、速度各 +1.5%（可叠 2 层）；每场战斗结束时清零',
      mods: { roundStatPct: 0.015 } },
    /* noRestack（任务4）：同名唯一，拿到一次后移出本局可获得池。 */
    { id: 'C55', tags: ['endless', 'battle', 'shop', 'noRestack'], name: '后发制人', rarity: 3, kind: 'permanent',
      desc: '战斗中每回合开始时，若力/敏/速有一项低于对手，将差距最大的一项补上10%；每场战斗结束时清零',
      mods: { catchUpPct: 0.10 } },
    /* unique：`firstDodge` 是布尔开关（每场第一次受击必闪）→ 多份无意义。 */
    { id: 'C56', tags: ['endless', 'battle', 'shop', 'unique'], name: '风影身法', rarity: 1, kind: 'permanent',
      desc: '每场战斗中，我方第一次受到攻击时必定闪避',
      mods: { firstDodge: 1 } },
    { id: 'C57', tags: ['tower', 'endless', 'battle', 'shop', 'limited', 'nextBattle'], name: '玉石俱焚', rarity: 2, kind: 'limited', uses: 10,
      desc: '下一场战斗每回合开始时，我方与敌方的生命上限各 ×90%（向下取整）',
      descEndless: '限次 10 场：每回合开始时我方与敌方的生命上限各 ×90%（向下取整）',
      mods: { roundMaxHpMul: 0.90 } },
    { id: 'C58', tags: ['endless', 'battle', 'shop', 'noRestack', 'ops'], name: '豪掷千金', rarity: 2, kind: 'permanent', maxStacks: 1,
      desc: '每在试炼商店消费 120 试炼币，立即获得 1 个随机限次增益（按商店刷新权重：越稀有越难出）',
      mods: { shopSpendLimited: 120, limitedDefaultRerollPaid: 10 } },
    { id: 'C59', tags: ['endless', 'battle', 'shop', 'stackable', 'noRestack', 'ops'], name: '门庭若市', rarity: 2, kind: 'permanent', maxStacks: 3,
      desc: '每进入一次试炼商店，立即获得 80 试炼币（可叠 3 层）',
      mods: { shopEnterCoins: 80 } },
    { id: 'C38', tags: ['tower', 'endless', 'battle', 'shop', 'unique'], name: '先机预判', rarity: 2, kind: 'permanent',
      desc: '每场战斗敌方对我方的第一次伤害为 0，且我方立刻额外行动一次',
      mods: { firstHitZero: 1, firstHitZeroFreeTurn: 1 } },
  ]);
  /* ============================================================
   * 【D14】Buff 索引与杂项常量 —— BUFF_BY_ID / 稀有度权重 / 回血比例 / 里程碑
   * ============================================================ */
  const BUFF_BY_ID = Object.fromEntries(BUFFS.map((b) => [b.id, b]));
  /* 「下一场战斗」语义的增益 id 集合（挑战塔里打完一场即消耗，卡面不显示限次）。 */
  const TOWER_BATTLE_IDS = BUFFS.filter((b) => hasTag(b, 'nextBattle')).map((b) => b.id);
  const RARITY_NAME = ['普通', '稀有', '史诗', '传奇'];
  const RARITY_WEIGHTS = [66, 21, 10, 3];        // 每个随机槽独立 Roll
  /* 试炼商店折扣口径：E04 steam大促 −30%（7 折）；E01 立即进货同样 −30%（7 折，2026-10 由 −50% 削弱）；
   * 两者同时生效时按用户指定合并为 −65%（3.5 折），而不是把两个折扣相加。 */
  const SHOP_DISCOUNT_E04 = 0.30;
  const SHOP_DISCOUNT_E01 = 0.30;
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
    if (n >= 1) return n;
    /* 【2026-10 修正】**没有 `stackable` 标签的一律「同名不同栏」**：
     * 每个背包栏位只放 1 层，再拿一份就并排占**下一个**栏位 ——
     * 不再吃 `STACK_MAX = 3` 的兜底（那会让「同名唯一」的件在同一栏里悄悄叠到 3 层，
     * 玩家以为只是"又拿到一份"，实际是同一格变强）。
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
    noRestack: '拿满上限后移出本局可获得池（不参与「叠满开新栏位」的通用规则）',
    repeatable: '可重复获得（非同名唯一）',
    unique: '同名唯一：拿到后不再进池',
    hidden: '不进「增益集锦」展示',
    ops: '运营类：经济/运营向（试炼币、商店、铸币、出售、商店消费、永久槽位扩容）',
  });
  /* 池子 ← 需要哪些标签：这里的定义就是「严格池子管理」的规则表。 */
  const POOL_TAGS = Object.freeze({
    'T.choice': ['tower', 'battle'],      // 挑战塔场间选择
    'T.shop': ['tower', 'shop'],           // 挑战塔商店（塔目前没有商店，保留概念）
    'E.choice': ['endless', 'battle'],     // 无尽塔场间选择（战斗奖励）
    'E.shop': ['shop'],                    // 无尽塔试炼商店
  });
  /* 这几个写成 function 声明（会提升）：文件前面的表（TOWER_BATTLE_IDS 等）
   * 也要按标签筛，不能等到这里才可用。 */
  function tagSet(b) { return b && Array.isArray(b.tags) ? b.tags : []; }
  function hasTag(b, t) { return tagSet(b).indexOf(t) >= 0; }
  function tagsOf(b) { return tagSet(b).slice(); }
  function buffsWithTag(t) { return BUFFS.filter((b) => hasTag(b, t)); }
  function poolsOf(b) { return Object.keys(POOL_TAGS).filter((pool) => POOL_TAGS[pool].every((t) => hasTag(b, t))); }
  /** 增益说明：**按所在塔取不同文案**。
   *  只有需要两套说法的条目才写 descEndless（例：C57 玉石俱焚 —— 挑战塔写「下一场战斗」，
   *  无尽塔是 10 次限次，要写清「限次 10 场」并让界面显示剩余次数）。 */
  function descOf(buff, mode) {
    if (!buff) return '';
    if (mode === 'endless' && buff.descEndless) return buff.descEndless;
    return buff.desc;
  }
  /* 无尽专属 mod：带这些效果的增益只在无尽塔成立（环境词缀 / 试炼币 / 商店 /
   * 铸币 / 结算 / 商店消费相关）。挑战塔带这类标签/效果一律加载期报错。 */
  const ENDLESS_ONLY_MODS = [
    'envIgnore', 'envReflect', 'envDenyGood', 'instantCoins', 'coinBoostPct', 'shopDiscount',
    /* 注意 enemyPowerDown 不在这里：挑战塔的 M01「威慑」也用它（下一场敌人攻击力 −30%），
     * 它是通用的「下一场战斗」减益，不是无尽专属。 */
    'openShop', 'instantRetry', 'enemyMaxHpDown', 'permSlot', 'pickWeaponPct',
    'pickSkillPct', 'pickPermanentFree', 'sellValue', 'sellGrowthPerWin', 'postBattleShop',
    'postBattleShopDiscount', 'postBattleMintShop', 'shopSpendStep', 'shopSpendStat', 'shopSpendHp',
    'shopSpendLimited', 'shopEnterCoins', 'rerollTiltMul', 'shopHalf', 'layerRestart',
    /* 「份数越多、再出现概率越低」（weight = 初始 ÷ n）与「豪掷千金」的默认权重（按稀有度）—— 都是无尽商店专属。 */
    'weightDivBy', 'weightDivOffset', 'limitedDefaultRerollPaid', 'pityWeight',
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
  /* ---- 冗余守门：**旧字段一律不许再写** ----
   * 池子归属、可叠层、同名唯一、限次生命周期……全都由 `tags` 表达，
   * 数据里再出现 towerOnly / endlessOnly / battleOnly / shopBanned / stackable /
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

  /* 主塔（挑战塔）池 = 挑战塔场间选择池；无尽池 = 无尽塔场间选择池；商店池 = 无尽塔商店。 */
  const towerPool = ROSTERS.filter((r) => r.pools.indexOf('T.choice') >= 0).map((r) => r.b);
  const endlessPool = ROSTERS.filter((r) => r.pools.indexOf('E.choice') >= 0).map((r) => r.b);
  const shopPool = ROSTERS.filter((r) => r.pools.indexOf('E.shop') >= 0).map((r) => r.b);
  /* ---- 铸币商店的两个池子 ----
   * 上架范围 = 无尽塔的全部增益（E.choice ∪ E.shop：时来运转这种「只在商店卖」的也算）。
   * 排除两类：
   *   · **铸币类**（instantRetry）—— 用铸币买铸币会出现套利（E10「背水一战」花 2 铸币买到 3 枚）；
   *   · **明确「不上商店」的**（layerRestart = 时间回廊）—— 用户口径：它只能在战斗奖励里拿到，
   *     所以铸币商店的货架与「免费交换」都不给它（试炼商店那边靠没有 shop 标签天然排除）。
   * ops 子池 = 带 `ops` 标签的运营类；传奇档不设「优先运营」限制（见 tower.js 的 rollMintSlots）。 */
  const MINT_EXCLUDE_MODS = ['instantRetry', 'layerRestart'];
  const mintPool = BUFFS.filter((b) => hasTag(b, 'endless')
    && !MINT_EXCLUDE_MODS.some((k) => Object.prototype.hasOwnProperty.call(b.mods || {}, k)));
  const opsPool = BUFFS.filter((b) => hasTag(b, 'ops'));
  /* ---- 铸币商店的守门 ----
   *   · ops 只能挂在无尽塔增益上（试炼币 / 商店 / 铸币都是无尽塔的局内经济）；
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

  /* ============================================================
   * 【D16】模块导出 —— window.TowerData
   * ============================================================ */
  window.TowerData = {
    towerLevel, towerMult, towerGold, towerGoldShares, TOWER_FAIL_CONSOLATION,
    endlessLevel, endlessSegment, endlessMult, endlessMechStacks, endlessMechs, ENDLESS_MECH_MAX, endlessTickets,
    GEAR_TIER, gearKeyForLayer, gearTierCap, ENDLESS_BOSS_POOL,
    ENDLESS_ENV, ENDLESS_ENV_BY_ID, envChance, rollEnvMods, envText, envRange, envRangeText, envPctKeys,
    ENV_START_LAYER, ENV_TWO_LAYER, ENV_MAX, ENV_DUR, repeatChanceInterval,
    ENV_CHANCE_START, ENV_CHANCE_STEP, ENV_CHANCE_CAP, ENV_CHANCE_CAP_LAYER,
    ENDLESS_MECH_ORDER, ENDLESS_CONSOLATION_LAYER, SCORE, COINS, SHOP, shopPrice,
    FOE_STAT_MUL, FOE_POWER_MUL, FOE_HP_MUL, FOE_HERO_HP_MUL, FOE_HERO_POWER_MUL,
    FOE_TRIAL_POWER_MUL, FOE_WARLORD_POWER_MUL, bossHpRatio, BOSS_HP_MIN, BOSS_HP_MAX, WARLORD_HP_RATIO,
    ENDLESS_LAYER_HEAL_PCT, MILESTONE_EVERY, MILESTONE_BOOK_COUNT, rollMilestone, PERMANENT_SLOTS,
    endlessDepthMul, ENDLESS_DEEP_LAYER, ENDLESS_SKIP_LAYER,
    buffScore, reviveScoreAt,
    SHOP_PRICE_OFFSET, rollShopPrice,
    rerollPriceAt, rerollPriceCapped, rerollQualityCapped, mechSealsHeal, HEAL_SEAL_MECHS, rerollTilt, tiltRateMul, rawTierWeights, tiltWeights, rerollExpectation, RARITY_SCORE, shopQualityScore,
    TIER_DYNAMIC_WEIGHTS, TIER_AVG_INCLUDES_STATIC, LEGEND_PITY, TICKET_FROM_MINT_CAP,
    shopPool, POOLS, inPool, RARITY_NAME, RARITY_WEIGHTS,
    MINT_SHOP, mintLayerOk, mintGroupOf, mintPrice, mintWeights, rollMintRarity, mintChance,
    mintPool, opsPool, MINT_EXCLUDE_MODS,
    BUFF_TAGS, POOL_TAGS, hasTag, tagsOf, buffsWithTag, poolsOf, descOf,
    legendWeightFactor, legendOwnedCount, allRepeatableLegendsOwned, LEGEND_BASE_WEIGHT, LEGEND_TIER_DECAY, rarityBoostOf,
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
