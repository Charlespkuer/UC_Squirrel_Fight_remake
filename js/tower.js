/* ============================================================
 * tower.js — 无尽挑战塔 · 主塔 + 无尽模式状态机
 * 状态机 + 结算 + 商店 + 界面数据出口；改动请同步 tools/test-fixes-round.cjs 的对应需求用例。
 *
 * 目录（Ctrl+F 搜「【T编号】」直达；全部是一个 IIFE 里的函数/常量声明，
 * 函数声明提升 + 运行期才取值，因此分节顺序不影响运行）：
 *   【T1】存档与对局归一化      【T8】战斗调度            【T15】增益的获得/失去/即时生效
 *   【T2】解锁条件              【T9】战斗结算            【T16】选取型强化：武器/技能/虚空铭文
 *   【T3】层结构与敌人预告      【T10】计分与隐藏成就     【T17】无尽：试炼币商店 + T17b 铸币商店
 *   【T4】增益聚合与效果汇总    【T11】环境词缀（无尽塔） 【T18】无尽：结算点与永久牺牲
 *   【T5】对局状态口径          【T12】层通关与推进       【T19】放弃与认输
 *   【T6】敌人构建              【T13】场间抉择：4 选 1   【T20】界面展示信息
 *   【T7】开局：发起对局        【T14】易碎烙印           【T21】模块导出 window.Tower
 *
 * 存档字段（normalizeSave 浅校验，这里深校验）：
 *   S.tower   = { maxLayer, run|null }
 *   S.endless = { best, weekBest, weekKey, bestLayer, shieldDate, run|null }
 *
 * run 通用形状：
 *   { layer, plan:[entry], idx, carry, battleBuffs:[{id,stacks}],
 *     choices:null|[...], attempt:null|token, pot(tower) }
 *   无尽追加：{ buffs(run 跨层), layerBuffs, coins, score, bestLayer,
 *     killPower, winMaxHp, bonusPower, shop|null, phase:null|'shop'|'checkpoint',
 *     mintGroup(-1|连续三层组号：这一组已经刷过铸币商店) }
 *   run.shop 两种：试炼商店（试炼币）与铸币商店（`mint:true`，铸币 / 免费交换）
 * plan entry：{kind:'hero',anim:'tl'|'xh'|'xm'}
 *             {kind:'npc', id}  {kind:'elite', id, mechs:[a,b]}
 *
 * buff 结算顺序锁定（见文档 6.5）：基础 → 叠层累积 → C15 全局乘区。
 * ============================================================ */
(function () {
  'use strict';

  const S = () => State.state();
  const D = () => window.TowerData;
  const save = () => State.save();
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  let attemptSeq = 0;

  const HEROES = ['tl', 'xh', 'xm'];
  const HERO_NAME = { tl: '螳螂大侠', xh: '仙鹤大侠', xm: '熊猫大侠' };
  const HERO_SKILL = { tl: 19, xh: 20, xm: 22 };          // 三侠招牌技能（疾风镰刀舞/仙鹤展翅/熊掌震地）
  const HERO_REGION = { tl: 3, xh: 4, xm: 1 };            // 与关卡战一致
  const UNLOCK_LEVEL = 30, UNLOCK_STAGES = 18;
  const TICKET_PROP = 50, BOOK_PROP = 23;
  /* 即时削弱「敌人生命上限 −N%」的唯一上限（E07 挫锐 / E08 卸甲）。
   * 以前登记时夹 0.8、进战斗时夹 0.6，介于两者之间的部分被静默浪费；
   * 现在三处（读档规范化 / 获得登记 / 进战斗取值）共用这一个值。 */
  const ENEMY_MAXHP_DOWN_CAP = 0.6;

  function debug(flag) { return typeof debugOn === 'function' && debugOn(flag); }

  /* ============================================================
   * 【T1】存档与对局归一化 —— S.tower / S.endless / normalizeRun
   * ============================================================ */

  function tower() {
    const s = S();
    if (!s.tower || typeof s.tower !== 'object') s.tower = { maxLayer: 0, run: null };
    s.tower.maxLayer = Math.max(0, Math.floor(Number(s.tower.maxLayer) || 0));
    if (s.tower.run) s.tower.run = normalizeRun(s.tower.run, 'tower');
    return s.tower;
  }
  function endless() {
    const s = S();
    if (!s.endless || typeof s.endless !== 'object') s.endless = { best: 0, weekBest: 0, weekKey: '', bestLayer: 0, shieldDate: '', run: null };
    const e = s.endless;
    e.best = Math.max(0, Math.floor(Number(e.best) || 0));
    e.weekBest = Math.max(0, Math.floor(Number(e.weekBest) || 0));
    e.bestLayer = Math.max(0, Math.floor(Number(e.bestLayer) || 0));
    if (typeof e.weekKey !== 'string') e.weekKey = '';
    if (typeof e.shieldDate !== 'string') e.shieldDate = '';
    /* 剧情（【U18】2026-10）：{ 剧情 id: true } = 「这段只播一次的剧情已经播过了」。
     * 界面靠它决定「进店前那段商人剧情」还要不要走。 */
    if (!e.storySeen || typeof e.storySeen !== 'object' || Array.isArray(e.storySeen)) e.storySeen = {};
    // 本周最高分：周一重置（与每日统计同一节奏）
    const mon = mondayKey();
    if (e.weekKey !== mon) { e.weekKey = mon; e.weekBest = 0; }
    if (e.run) e.run = normalizeRun(e.run, 'endless');
    return e;
  }
  /* ============================================================
   * 【T13】剧情状态（2026-10 用户口径）—— 只做两件事：
   *   · 给某一局挂一段「待播放的剧情 id」（`run.story`，随存档走，重载也还在）；
   *   · 记录「只播一次」的剧情已经播过（`endless().storySeen`）。
   * 文本、逐字显示与「继续」按钮都在界面侧（js/tower-ui.js 的【U18】）——
   * 这里只保证状态能存、能查、能清，剧情不掺进 reportBattle 的战斗逻辑。
   * ============================================================ */
  /** 给某一局挂一段待播剧情（界面点「开始攀登」，或判断出该播哪段时调）。 */
  function setRunStory(mode, id) {
    const box = mode === 'tower' ? tower() : endless();
    if (!box.run || !id) return null;
    box.run.story = String(id);
    save();
    return box.run.story;
  }
  /** 剧情播完：把待播标记清掉。 */
  function clearRunStory(mode) {
    const box = mode === 'tower' ? tower() : endless();
    if (!box.run || !box.run.story) return false;
    delete box.run.story;
    save();
    return true;
  }
  /** 这段「只播一次」的剧情播过了吗。 */
  function storySeen(id) { return !!(endless().storySeen || {})[id]; }
  /** 记下「这段只播一次的剧情已经播完」。 */
  function markStorySeen(id) {
    if (!id) return false;
    const e = endless();
    e.storySeen = Object.assign({}, e.storySeen, { [String(id)]: true });
    save();
    return true;
  }
  /** 剧情模式开着吗（无尽首页左下角那颗按钮；**挑战模式 = 关**）。
   *  存档里存的是 `endless().storyOn`，默认 true（剧情模式）。 */
  function storyEnabled() { return endless().storyOn !== false; }
  /** 切换剧情 / 挑战模式，返回切换后的状态（true = 剧情模式）。 */
  function setStoryEnabled(on) {
    const e = endless();
    e.storyOn = !!on;
    save();
    return storyEnabled();
  }
  /** 【U18】「每次开店都播」的那类剧情（立即进货的铃声段）：给**这家店**记一笔「已经播过」，
   *  免得剧情一播完、条件还成立（phase 仍是 shop）又被重播，卡在原地出不来。
   *  下一家店是新对象，所以照旧会播。 */
  function markShopStoryShown(mode) {
    const box = mode === 'tower' ? tower() : endless();
    if (!box.run || !box.run.shop) return false;
    box.run.shop.storyShown = true;
    save();
    return true;
  }
  function mondayKey() {
    const d = new Date();
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /* ============================================================
   * 【T1.5】同名增益「逐条」身份（uid）与逐栏成长/破碎状态
   *
   * 同名增益可以并排占多个背包栏位，于是「同名」≠「同一条」：
   *   · 每条栏位有一个自增 `uid`（暗中标记，界面不显示）；
   *   · 「附魔免占位」记在行上（`row.slotFree`）；
   *   · **成长进度**记在行上（`row.grow`），run 上的旧字段只是「各栏求和」的镜像；
   *   · **破碎随机数**记在行上（`row.fragileSeed`），同名的每一条、每一份都各摇各的。
   * 所有「针对某一条」的操作（附魔 / 卖出 / 交换 / 移除 / 替换 / 取消）都必须传 uid。
   * ============================================================ */
  const GROW_FIELDS = ['killPower', 'winMaxHp', 'winHpFlat', 'winStatPower', 'winStatAgility', 'winStatSpeed', 'winTakenMul', 'sellBonus'];
  const GROW_SPEND_FIELDS = ['power', 'agility', 'speed', 'hp'];
  /** 逐栏成长对象：只保留已知字段与正数（坏档兜底）。 */
  function cleanGrowObj(g) {
    if (!g || typeof g !== 'object') return null;
    const out = {};
    for (const k of GROW_FIELDS) { const v = Math.max(0, Number(g[k]) || 0); if (v > 0) out[k] = v; }
    if (g.spend && typeof g.spend === 'object') {
      const sp = {};
      for (const k of GROW_SPEND_FIELDS) { const v = Math.max(0, Number(g.spend[k]) || 0); if (v > 0) sp[k] = v; }
      if (GROW_SPEND_FIELDS.some((k) => sp[k] > 0)) out.spend = sp;
    }
    return Object.keys(out).length ? out : null;
  }
  function growAdd(row, key, val) {
    const v = Number(val) || 0;
    if (!row || !(v > 0) || GROW_FIELDS.indexOf(key) < 0) return;
    row.grow = row.grow || {};
    row.grow[key] = Math.max(0, Number(row.grow[key]) || 0) + v;
  }
  /** 逐栏成长读值（没有该栏的 grow 时为 0）。 */
  function growOf(row, key) { return Math.max(0, Number(row && row.grow && row.grow[key]) || 0); }
  /** 【同名逐条】把成长同时记进**这一栏的账本**与 run 级合计（run 级仍是读取口径）。
   *  这样：① 旧调用方直接读写 run 字段仍然有效；② 卖出 / 交换某一栏时能精确扣掉它那一份。 */
  function addGrow(run, row, key, val) {
    const v = Number(val) || 0;
    if (!(v > 0) || GROW_FIELDS.indexOf(key) < 0) return;
    growAdd(row, key, v);
    if (run) run[key] = Math.max(0, Number(run[key]) || 0) + v;
  }
  /** 【同名逐条】从 run 合计里扣掉**这一栏自己的**成长账（返回扣掉的量）。 */
  function subGrow(run, row, key) {
    const v = growOf(row, key);
    if (!(v > 0) || !run) return v;
    run[key] = Math.max(0, (Number(run[key]) || 0) - v);
    return v;
  }
  /** 深校验一份读档出来的 run：坏档直接作废（不收费、不掉层）。 */
  function normalizeRun(run, mode) {
    if (!run || typeof run !== 'object') return null;
    /* 旧档里存着 E01 的 run.postBattleShop 缓存：这套缓存已经废弃
     *（改成按「当前开着的立即进货」现算），读到就清掉。 */
    if ('postBattleShop' in run) delete run.postBattleShop;
    const layer = Math.floor(Number(run.layer));
    if (!Number.isFinite(layer) || layer < 1 || !Array.isArray(run.plan) || !run.plan.length) return null;
    /* 旧档 id 迁移：G/T 两组重排过序号（见 tower-data.js 的 LEGACY_BUFF_IDS）。
     * 只按 buffVer 判断**一次**：旧档没有这个字段才搬，搬完打上新版本号。
     * 新档（buffVer 已是最新）绝不走这张表 —— 否则新代码里合法的 T04（见血封喉）
     * 会被误当成「旧 T04」搬成 T03（锁定打击），表现为「加的 buff 效果不对」。
     * 被删掉的增益（旧 G03/G04/G05、旧 T03/T06/T08/T09、C08）不在此表，按未知 id 丢弃。 */
    const legacyIds = run.buffVer !== D().BUFF_VER;
    const remapId = (id) => ((legacyIds && D().LEGACY_BUFF_IDS[id]) || id);
    run.buffVer = D().BUFF_VER;
    const buffDef = (b) => ((b && typeof b === 'object') ? D().BUFF_BY_ID[remapId(b.id)] : null);
    const buffOk = (b) => !!buffDef(b);
    const clampStacks = (def, v) => Math.max(1, Math.min(D().stackCap(def), Math.floor(Number(v) || 1)));
    /* 归一化只保留「有效字段」：注意 `at`（获得顺序号）必须留着 ——
     * 商店的出售 / 交换列表按它正序排，抹掉再补号会把顺序按「永久表在前、限次表在后」重排，
     * 最新拿到的反而被排到中间（见 需求92）。 */
    const cleanBuffs = (list) => (Array.isArray(list) ? list.filter(buffOk)
      .map((b) => {
        const def = buffDef(b);
        const out = { id: def.id, stacks: clampStacks(def, b.stacks) };
        const at = Math.max(0, Math.floor(Number(b && b.at) || 0));
        if (at > 0) out.at = at;
        /* 【2026-10 关键修复】栏位上的**消费进度**必须留在白名单里：
         * C36 用 `spend/procs`、C58 用 `limitedSpend`（见 addShopSpend 的「每栏各记一份」）。
         * 原来这里只保留 id/stacks/at → 每次归一化都把进度抹成 0 →
         * 多个「豪掷千金 / 挥金如土」永远只触发一次（用户报的 bug 的另一半）。 */
        if (b && b.spend != null) out.spend = Math.max(0, Number(b.spend) || 0);
        if (b && b.procs != null) out.procs = Math.max(0, Math.floor(Number(b.procs) || 0));
        if (b && b.limitedSpend != null) out.limitedSpend = Math.max(0, Number(b.limitedSpend) || 0);
        /* 【2026-10 同名逐条】每栏自己的成长进度与破碎随机数种子必须留在白名单里。 */
        const grow = cleanGrowObj(b && b.grow);
        if (grow) out.grow = grow;
        const fseed = Math.max(0, Math.floor(Number(b && b.fragileSeed) || 0));
        if (fseed > 0) out.fragileSeed = fseed;
        /* 【任务2】栏位身份与「附魔免占位」都是**逐条**的，必须留在白名单里。 */
        const uid = Math.max(0, Math.floor(Number(b && b.uid) || 0));
        if (uid > 0) out.uid = uid;
        if (b && b.slotFree === true) out.slotFree = true;
        /* 【铭文 2026-10】铭文记账也必须是**逐条**的，这里是行字段的**唯一白名单** ——
         * 漏了这两行，每次归一化（normalizeRun 会在每次 endless() 时跑）都会把
         * 增幅铭文的 ×1.5 和「这张铭文已附过」的记录抹掉：效果看起来像没生效，
         * 而且同一张铭文还能反复附在同一条上。 */
        const ench = (b && Array.isArray(b.enchants)) ? b.enchants.filter((v, i, a) => v && a.indexOf(v) === i) : [];
        if (ench.length) out.enchants = ench.map(String);
        const emul = Number(b && b.enchMul);
        if (Number.isFinite(emul) && emul > 0 && emul !== 1) out.enchMul = emul;
        return out;
      }) : []);
    run.layer = layer;
    run.idx = Math.max(0, Math.min(run.plan.length - 1, Math.floor(Number(run.idx) || 0)));
    run.carry = Math.max(0.01, clamp01(run.carry == null ? 1 : run.carry));
    if (!Array.isArray(run.permanent) || !Array.isArray(run.limited)) {
      const oldBattle = cleanBuffs(run.battleBuffs), oldLayer = cleanBuffs(run.layerBuffs), oldRun = cleanBuffs(run.buffs);
      run.permanent = oldRun.filter((b) => D().BUFF_BY_ID[b.id] && D().BUFF_BY_ID[b.id].kind === 'permanent')
        .concat(oldLayer.filter((b) => D().BUFF_BY_ID[b.id] && D().BUFF_BY_ID[b.id].kind === 'permanent'));
      run.limited = oldBattle.concat(oldLayer).filter((b) => D().BUFF_BY_ID[b.id] && D().BUFF_BY_ID[b.id].kind === 'limited')
        .map((b) => ({ id: b.id, stacks: b.stacks, uses: Number(b.uses) || D().BUFF_BY_ID[b.id].uses || 1, on: b.on !== false }));
    }    /* 段位机制已并入环境词缀：run.mechs 只作历史兼容，永远为空。 */
    run.mechs = [];
    if (run.pillSlots) delete run.pillSlots;
    /* 即时削弱的累计值（E07/E08 生命上限、E11 攻击力）：夹在 0~上限，坏值不许把敌人打成 0。 */
    run.enemyMaxHpDown = Math.max(0, Math.min(ENEMY_MAXHP_DOWN_CAP, Number(run.enemyMaxHpDown) || 0));
    /* 传奇保底计数（B 方案）：跨场 / 跨层保留，换局从 0 开始。 */
    run.legendPity = Math.max(0, Math.floor(Number(run.legendPity) || 0));
    /* 挥金如土（C36）的「已提升次数」：分段涨价的口径，坏值不许为负。
     * 【2026-10】进度已改成「每栏各记一份」，这里把旧档的单计数器迁进第一栏；
     * 之后镜像字段由 syncSpendMirrors 维护（读旧字段的界面 / 探针不受影响）。 */
    run.shopSpendProcs = Math.max(0, Math.floor(Number(run.shopSpendProcs) || 0));
    /* 选取型增益的累计次数（虚空铭文的降权依据）：坏值不许为负。 */
    if (run.pickGot && typeof run.pickGot === 'object') {
      const cleanGot = {};
      for (const k of Object.keys(run.pickGot)) {
        const v = Math.max(0, Math.floor(Number(run.pickGot[k]) || 0));
        if (v > 0) cleanGot[k] = v;
      }
      run.pickGot = cleanGot;
    }
    (function migrateSpendProgress() {
      const legacy = Math.max(0, Number(run.shopSpend) || 0);
      const legacyProcs = Math.max(0, Math.floor(Number(run.shopSpendProcs) || 0));
      const legacy58 = Math.max(0, Number(run.shopSpendLimited) || 0);
      const row36 = (run.permanent || []).find((b) => b && b.id === 'C36');
      const row58 = (run.permanent || []).find((b) => b && b.id === 'C58');
      if (row36) {
        if (row36.spend == null && row36.procs == null && (legacy > 0 || legacyProcs > 0)) {
          row36.spend = legacy; row36.procs = legacyProcs;
        }
        row36.spend = Math.max(0, Number(row36.spend) || 0);
        row36.procs = Math.max(0, Math.floor(Number(row36.procs) || 0));
      }
      if (row58) {
        if (row58.limitedSpend == null && legacy58 > 0) row58.limitedSpend = legacy58;
        row58.limitedSpend = Math.max(0, Number(row58.limitedSpend) || 0);
      }
      /* 顺带把镜像字段同步成「各栏求和」（卖 / 替换掉一栏之后镜像不会残留旧值）。 */
      syncSpendMirrors(run);
    })();
    run.enemyPowerDown = Math.max(0, Math.min(0.8, Number(run.enemyPowerDown) || 0));
    /* 槽位相关字段的**防御性规范化**（当前存档已经会带上它们，这里是第二道闸）：
     * permSlotIds 是权威记录、permSlots 由它派生、两者取最大值兼容旧档 ——
     * 只要有一份字段缺失（旧档 / 同步来的残缺档），下面那行
     * `slice(0, permSlots(run))` 就会把超出的永久增益**静默截掉**，
     * 所以宁可多算一点名额，也不能把玩家已有的增益丢掉。 */
    const cleanIds = (v) => (Array.isArray(v) ? v.filter((id) => typeof id === 'string' && id) : []);
    run.permSlotIds = cleanIds(run.permSlotIds);
    const slotFromIds = run.permSlotIds.reduce((sum, id) => {
      const def = D().BUFF_BY_ID[id];
      return sum + Math.max(0, Number(def && def.mods && def.mods.permSlot) || 0);
    }, 0);
    run.permSlots = Math.max(slotFromIds, Math.max(0, Number(run.permSlots) || 0));
    /* slotFreeIds 现在是**镜像**（被附魔行的 id 去重）；权威标记在各行自己的 slotFree 上。
     * 旧档只存了 id 列表 → 把每个 id 迁到**第一条**同名栏位（多栏同名是任务3 之后才有的）。 */
    run.slotFreeIds = cleanIds(run.slotFreeIds);
    (function migrateSlotFree() {
      const legacy = run.slotFreeIds.slice();
      for (const id of legacy) {
        const rows = (run.permanent || []).filter((b) => b && b.id === id);
        if (!rows.length || rows.some((b) => rowFreeOf(b))) continue;
        rows[0].slotFree = true;
      }
      syncSlotFree(run);
    })();
    /* 栏位身份：老档没有 uid → 按顺序补一个，并保证唯一。 */
    (function ensureUids() {
      run.rowUidSeq = Math.max(0, Math.floor(Number(run.rowUidSeq) || 0));
      const seen = Object.create(null);
      for (const row of (run.permanent || []).concat(run.limited || [])) {
        let uid = Math.max(0, Math.floor(Number(row && row.uid) || 0));
        if (!uid || seen[uid]) uid = run.rowUidSeq + 1;
        seen[uid] = true;
        row.uid = uid;
        if (uid > run.rowUidSeq) run.rowUidSeq = uid;
      }
    })();
    /* 铭文记账：`enchants`（吃过的铭文 id，去重）与 `enchMul`（增幅铭文累计倍率）。
     * 老档没有 → 补成空数组 / 1；虚空铭文那条老口径（slotFree）不在这里迁，
     * 它由上面的 migrateSlotFree 负责，两者互不影响。 */
    (function ensureInscriptions() {
      for (const row of (run.permanent || []).concat(run.limited || [])) {
        if (!row) continue;
        row.enchants = rowEnchantsOf(row).filter((v, i, a) => v && a.indexOf(v) === i);
        const m = Number(row.enchMul);
        row.enchMul = (Number.isFinite(m) && m > 0) ? m : 1;
      }
    })();
    run.pickBuffIds = cleanIds(run.pickBuffIds);
    /* **绝不在这里丢弃永久增益**。
     * 原来这里写的是 `slice(0, permSlots(run))` —— 按数组长度一刀切，
     * 而 addBuff 的满格判断用的是 permUsed（已扣掉虚空铭文免占位的那些）。
     * 两个口径不一致时就会把**刚拿到的新增益**无差别切掉：
     *   上限 8、占用 7/8（其中 1 个免占位 → 数组长度 8），
     *   addBuff 认为没满、正常推入 → 长度 9 → 这里 slice(0,8) → 新增益消失。
     * 上限的维护收口在 addBuff（按「加入后占用是否超上限」判定、超了就要求替换），
     * 所以这里只做校验与告警：真超了说明别处口径又错了，但**不能拿玩家的增益买单**。 */
    run.permanent = cleanBuffs(run.permanent);
    run.permanent = repairPermanentSlots(run, run.permanent);
    run.limited = (Array.isArray(run.limited) ? run.limited : [])
      .filter((b) => { const d = buffDef(b); return !!d && d.kind === 'limited'; })
      .map((b) => {
        const def = buffDef(b);
        const out = { id: def.id, stacks: clampStacks(def, b.stacks),
          uses: Math.max(0, Math.floor(Number(b.uses) || 0)), on: b.on !== false };
        if (b && b.spend != null) out.spend = Math.max(0, Number(b.spend) || 0);
        if (b && b.procs != null) out.procs = Math.max(0, Math.floor(Number(b.procs) || 0));
        if (b && b.limitedSpend != null) out.limitedSpend = Math.max(0, Number(b.limitedSpend) || 0);
        /* 【2026-10 同名逐条】逐栏成长与破碎种子。 */
        const grow2 = cleanGrowObj(b && b.grow);
        if (grow2) out.grow = grow2;
        const fseed2 = Math.max(0, Math.floor(Number(b && b.fragileSeed) || 0));
        if (fseed2 > 0) out.fragileSeed = fseed2;
        const uid = Math.max(0, Math.floor(Number(b && b.uid) || 0));
        if (uid > 0) out.uid = uid;
        if (b && b.slotFree === true) out.slotFree = true;
        const at = Math.max(0, Math.floor(Number(b && b.at) || 0));    // 同上：获得顺序号要留着
        if (at > 0) out.at = at;
        return out;
      })
      .filter((b) => b.uses > 0);
    if (run.mode === 'tower') run.limited = run.limited.map((b) => Object.assign(b, { uses: 1, on: true }));
    if (!Array.isArray(run.buffs)) run.buffs = [];
    /* 【2026-10 同名逐条】老档的成长值是 run 级的（各同名栏共用），一次性抄进
     * 「第一条同名栏位」的 `row.grow` 账本 —— run 级字段保持不动（仍是读取口径），
     * 以后卖出 / 交换某一栏时只扣**那一栏账本里**的量。 */
    if (!run.growByRow) {
      const allRows = (run.permanent || []).concat(run.limited || []);
      const firstRowOf = (id) => allRows.find((b) => b && b.id === id) || null;
      const hand = (id, key, val) => {
        const v = Math.max(0, Number(val) || 0);
        const row = firstRowOf(id);
        if (row && v > 0) growAdd(row, key, v);
      };
      hand('C06', 'killPower', run.killPower);
      hand('C07', 'winMaxHp', run.winMaxHp);
      hand('C11', 'winHpFlat', run.winHpFlat);
      if (run.winStatPower > 0 || run.winStatAgility > 0 || run.winStatSpeed > 0) {
        const row = firstRowOf('C12');
        if (row) {
          growAdd(row, 'winStatPower', run.winStatPower);
          growAdd(row, 'winStatAgility', run.winStatAgility);
          growAdd(row, 'winStatSpeed', run.winStatSpeed);
        }
      }
      hand('C25', 'sellBonus', run.sellBonus);
      hand('C48', 'winTakenMul', run.winTakenMul);
      run.growByRow = 1;
    }
    // 注意：attempt/choices 的作废只在读档时做（state.js normalizeSave），
    // 这里是每次访问都会跑的深校验，不能动进行中的战斗令牌。
    if (mode === 'tower') run.pot = Math.max(0, Math.floor(Number(run.pot) || 0));
    else {
      run.coins = Math.max(0, Math.floor(Number(run.coins) || 0));
      run.score = Math.max(0, Math.floor(Number(run.score) || 0));
      run.bestLayer = Math.max(0, Math.floor(Number(run.bestLayer) || 0));
      run.killPower = Math.max(0, Number(run.killPower) || 0);
      run.winMaxHp = Math.max(0, Number(run.winMaxHp) || 0);
      run.fragileBase = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBase || {});
      run.fragileBurned = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBurned || {});
      /* 2026-10 语义迁移：`fragileBase` 原来存的是「名义值、按半效生效」（8% 名义 → 实际 4%），
       * 现在存「存在时的全额值」。老档（没有 fragileAliveFull 标记）把力/敏/速的 base 减半，
       * 免得升级后凭空变强。 */
      if (!run.fragileAliveFull) {
        for (const k of ['power', 'agility', 'speed']) {
          run.fragileBase[k] = Math.max(0, Number(run.fragileBase[k]) || 0) / 2;
        }
        run.fragileAliveFull = 1;
      }
      run.fragileGot = Object.assign({}, run.fragileGot || {});
      /* 淘金烙印（C53）：未破碎份数 + 已破碎的明细（与 run.fragileHealBurned 同一套形状）。 */
      run.fragileCoinBase = Math.max(0, Math.floor(Number(run.fragileCoinBase) || 0));
      run.fragileCoinBurned = Array.isArray(run.fragileCoinBurned)
        ? run.fragileCoinBurned.map((v) => Math.max(0, Number(v) || 0)).filter((v) => v > 0) : [];
      run.fragileHealBurned = Array.isArray(run.fragileHealBurned)
        ? run.fragileHealBurned.map((v) => Math.max(0, Number(v) || 0)).filter((v) => v > 0) : [];
      /* 治疗烙印（C52）：未破碎份数独立记账（与淘金烙印同一套形状）。
       * 老存档没有这个字段，而且历史上它和 C49 的 fragileMulBase 混在一起 —— 这里做一次性迁移：
       * 把「当前持有的 C52 层数」从 fragileMulBase 里摘出来，还给 fragileHealBase。 */
      if (run.fragileHealBase === undefined) {
        const c52 = (run.limited || []).reduce((n, b) => n + (b && b.id === 'C52' ? Math.max(0, Math.floor(Number(b.stacks) || 1)) : 0), 0);
        run.fragileHealBase = c52;
        if (c52 > 0) run.fragileMulBase = Math.max(0, Math.floor(Number(run.fragileMulBase) || 0) - c52);
      }
      run.fragileHealBase = Math.max(0, Math.floor(Number(run.fragileHealBase) || 0));
      run.brokenMarks = Array.isArray(run.brokenMarks)
        ? run.brokenMarks.filter((m) => m && typeof m.kind === 'string')
          .map((m) => ({
            kind: m.kind,
            legacy: m.legacy === true,
            stat: typeof m.stat === 'string' ? m.stat : undefined,
            pct: Math.max(0, Number(m.pct) || 0),
            alive: Math.max(0, Number(m.alive) || 0),
            burned: Math.max(0, Number(m.burned) || 0),
          })) : [];
      /* 终乘烙印（C49）：独立于「加算烙印」的两段层数，最后做幂乘。 */
      run.fragileMulBase = Math.max(0, Math.floor(Number(run.fragileMulBase) || 0));
      run.fragileMulBurned = Math.max(0, Math.floor(Number(run.fragileMulBurned) || 0));
      if (run.fragileMulBurned > 0 &&
          !run.brokenMarks.some((m) => m.kind === 'final')) {
        run.brokenMarks.push({ kind: 'final', alive: 0.25, burned: 0.5, legacy: true });
      }
      for (const k of ['power', 'agility', 'speed']) {
        run.fragileBase[k] = Math.max(0, Number(run.fragileBase[k]) || 0);
        run.fragileBurned[k] = Math.max(0, Number(run.fragileBurned[k]) || 0);
        /* 旧档：有合计但没有对应明细 → 补一条不可移除的 legacy 明细。 */
        if (run.fragileBurned[k] > 0 &&
            !run.brokenMarks.some((m) => m.kind === 'stat' && m.stat === k)) {
          run.brokenMarks.push({ kind: 'stat', stat: k, pct: run.fragileBurned[k], legacy: true });
        }
      }
      if (run.stickyStat) {
        for (const k of ['power', 'agility', 'speed']) {
          const oldv = Math.max(0, Number(run.stickyStat[k]) || 0);
          if (oldv > run.fragileBurned[k]) run.fragileBurned[k] = oldv;
        }
        delete run.stickyStat;
      }
      run.fragileSeeds = Object.assign({}, run.fragileSeeds || {});
      /* 计分扩展：成就 / 加成峰值 / 复活计数 / 本局加分流水。 */
      run.achievements = Array.isArray(run.achievements) ? run.achievements.slice(0, 40) : [];
      run.scoreLog = Array.isArray(run.scoreLog) ? run.scoreLog.slice(-60) : [];
      run.statPeaks = Object.assign({}, run.statPeaks || {});
      run.pendingToasts = Array.isArray(run.pendingToasts) ? run.pendingToasts.slice(0, 12) : [];
      run.deathSaves = Math.max(0, Math.floor(Number(run.deathSaves) || 0));
      run.reviveCount = Math.max(0, Math.floor(Number(run.reviveCount) || 0));
      run.reviveTierPaid = Math.max(0, Number(run.reviveTierPaid) || 0);
      run.bonusPower = Math.max(0, Number(run.bonusPower) || 0);
      run.winStatPower = Math.max(0, Number(run.winStatPower) || 0);
      run.winStatAgility = Math.max(0, Number(run.winStatAgility) || 0);
      run.winStatSpeed = Math.max(0, Number(run.winStatSpeed) || 0);
      run.winTakenMul = Math.max(0, Number(run.winTakenMul) || 0);
      run.rarityBoost = Math.max(0, Math.floor(Number(run.rarityBoost) || 0));
      run.lostMarks = Array.isArray(run.lostMarks) ? run.lostMarks.slice(-20) : [];
      run.noEnvRoll = run.noEnvRoll === true;
      run.noEnvGain = run.noEnvGain === true;
      run.lastSacrifice = run.lastSacrifice && typeof run.lastSacrifice === 'object' ? run.lastSacrifice : null;
      run.instantIds = Array.isArray(run.instantIds)
        ? run.instantIds.filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id, count: Math.max(1, Math.floor(Number(x.count) || 1)) }))
        : [];
      /* 血量绝对值口径：剩余血量与「最近一次已知上限」（回血/裁血的基准）。 */
      run.hpAbs = Math.max(0, Math.round(Number(run.hpAbs) || 0));
      run.repeatAt = Number(run.repeatAt) >= 0 ? Number(run.repeatAt) : -1;
      run.refMaxHp = Math.max(0, Math.round(Number(run.refMaxHp) || 0));
      /* 铸币商店：最近一次刷出的「连续三层组号」（-1 = 本局还没刷过）。
       * 老存档没有这个字段 → 视为没刷过，本组还能刷一次。 */
      run.mintGroup = Number.isFinite(Number(run.mintGroup)) && Number(run.mintGroup) >= 0
        ? Math.floor(Number(run.mintGroup)) : -1;
      /* 讨价还价（E14）：攒着还没兑现的「对折份数」——下一次进店（试炼商店或铸币商店）
       * 在那一页里兑掉，每份一件随机商品、且不重复打同一件。 */
      run.shopHalfPending = Math.max(0, Math.floor(Number(run.shopHalfPending) || 0));
      if (run.shop && typeof run.shop === 'object' && !Array.isArray(run.shop.slots)) run.shop = null;
      /* 讨价还价：这家店「每页几件对折」（刷新货架会按它重打一遍）—— 老档没有就按 0。 */
      if (run.shop) run.shop.halfPerPage = Math.max(0, Math.floor(Number(run.shop.halfPerPage) || 0));
      /* 铸币商店的账本字段防御性归一化（老档 / 手改档都不该让界面崩）。 */
      if (run.shop && run.shop.mint) {
        run.shop.mint = true;
        run.shop.rerollCount = Math.max(0, Math.floor(Number(run.shop.rerollCount) || 0));
        run.shop.rerollFree = (Number(run.shop.rerollCount) || 0) === 0;
        run.shop.swapped = run.shop.swapped === true;
        run.shop.layer = Math.max(1, Math.floor(Number(run.shop.layer) || Number(run.layer) || 1));
      }
      /* 合法的「等待玩家操作」阶段：出商店 / 结算点 / 20 起每 10 层的放弃永久增益。 */
      /* 【软锁防线】存档里遗留的 `pendingPick` 如果**已经没有可选目标**（目标被卖掉 / 碎掉 /
     * 版本变更），就地转成「留着等目标」（deferredPicks）—— 否则界面会一直弹一个 0 候选的空弹窗，
     * 玩家点不掉也走不了（用户实测的卡死就是这么来的）。 */
    parkStalePendingPick(run);
    /* 合法的「等着玩家处理」阶段白名单（2026-10 第六十五批）：巡逻的收缴/丢弃也是合法阶段 ——
     * 漏登记会让 run.phase 在**每次归一化**时被清成 null，界面就再也弹不出收缴面板
     *（用户实测：100 层魔王战输了直接走失败结算）。 */
    if (['shop', 'checkpoint', 'sacrifice', 'patrolToll', 'patrolDiscard'].indexOf(run.phase) < 0) run.phase = null;
      if (!Array.isArray(run.debuffs)) run.debuffs = [];
      /* 获得顺序号（`at`）：商店的出售 / 交换列表按它**倒序**排（最新的在最上）。
       * 老档没有这个字段 → 按当前表内顺序补号（永久表在前、限次表在后，与旧版显示顺序一致），
       * 并把 acqSeq 抬到已有最大值之后，新拿到的增益继续往上排。 */
      {
        let seq = Math.max(0, Math.floor(Number(run.acqSeq) || 0));
        for (const list of [run.permanent, run.limited]) {
          for (const e of list || []) {
            if (!e || typeof e !== 'object') continue;
            const at = Math.max(0, Math.floor(Number(e.at) || 0));
            if (at > 0) { seq = Math.max(seq, at); continue; }
            e.at = ++seq;
          }
        }
        run.acqSeq = seq;
      }
      /* 削弱条目只要求是对象（老档 / 手改存档兜底）。
       * **不要再按来源去重**：2026-10 起三侠削弱是「每次大招命中各落一条、各有本层上限」，
       * 同一位大侠在一层里本来就可能有多条（幻影回响 / 时间回廊会让同一场再打一次）。
       * 跨层残留交给 advanceLayer 清空（见那里的注释）。 */
      if (run.debuffs.some((d) => !d || typeof d !== 'object')) {
        run.debuffs = run.debuffs.filter((d) => d && typeof d === 'object');
      }
    }
    return run;
  }

  /* ============================================================
   * 【T2】解锁条件 —— unlocked
   * ============================================================ */

  function unlocked() {
    const s = S();
    if (s.level < UNLOCK_LEVEL) return { ok: false, msg: '达到 30 级后解锁挑战塔。' };
    for (let id = 1; id <= UNLOCK_STAGES; id++) {
      if (!State.stageProgress(id).passed) return { ok: false, msg: '通关挑战模式全部 18 关后解锁挑战塔。' };
    }
    return { ok: true };
  }

  /* ============================================================
   * 【T3】层结构与敌人预告 —— buildPlan / preview / planInfo
   * ============================================================ */

  function bossEntry(layer, salt, squirrelsOnly) { return D().bossFor(layer, salt, squirrelsOnly); }
  /** 某个「松鼠系」对手在某一层**实际穿的套装**（`wearsOf` 的键）—— 预告与实战共用这一份。
   *  · 10 的整数层：守关首领就是狂战套（塔顶的标志性外观），x10 的非首领保留自己那套；
   *  · 非 10 的整数层：**一律**按该层的普通套装档位（`gearKeyForLayer`）。
   *    狂战套用的是 4 号档，`gearKeyForLayer` 会从「≤ 该层档位上限」的普通套装里按层哈希挑一套，
   *    所以**非整数层绝不会出现狂战套**（无尽塔第 4 场抽到狂战松鼠时也不允许 —— 用户口径）。 */
  function gearKeyOf(layer, sq) {
    const L = Math.max(1, Number(layer) || 1);
    const key = (sq && sq.gear) ? sq.gear : 'ninja1';
    if (L % 10 === 0) return key;
    return D().gearKeyForLayer ? D().gearKeyForLayer(L, key) : key;
  }
  /** 「精英」判定 —— 预告与实战共用这一份（原来只在 buildFoe / reportBattle 各写一次
   *  `entry.kind === 'warlord'`，所以 x5 层完全没有可感知的强度台阶）：
   *  · 10 的整数层第 5 场：守关首领（狂战松鼠）；
   *  · **每 5 层（非 x10）的本层最后一战**：逢五的精英台阶（三围 ×1.2 + 精英掉落/计分 +
   *    C13 精英杀手生效）。x10 排除，避免一层里叠两个精英台阶。 */
  function isEliteEntry(entry, layer, isLast) {
    if (entry && entry.kind === 'warlord') return true;
    /* 「巡逻」魔王：**同时算精英 + boss**（用户口径）—— 精英收益与 boss 类 buff 都要吃。 */
    if (entry && entry.kind === 'patrol') return true;
    const L = Number(layer) || 0;
    return !!isLast && L > 0 && L % 5 === 0 && L % 10 !== 0;
  }
  /** 某个 entry 是不是「boss 位」（巡逻也算：它被定性为精英 + boss 战斗）。 */
  function isBossEntry(entry) {
    return !!(entry && (entry.kind === 'warlord' || entry.kind === 'patrol' ||
      entry.kind === 'squirrel' || entry.kind === 'trial'));
  }
  /** 造一层的战斗计划。
   *  `mode`：'endless' 时**整百层**（第 100 / 200 / 300… 层）走「**觐见魔王**」三连战结构，
   *  'tower' / 省略时保持原样（挑战塔的层结构是另一套，不能动）。 */
  function buildPlan(layer, salt, squirrelsOnly, mode) {
    const endlessMode = mode !== 'tower';
    /* **整百层**（100 / 200 / 300…）：**三连战 · 觐见魔王**（用户口径）——
     *   第 1、2 场：随机 x10 层首领（狂战松鼠变体）=「魔王近卫」，**没有战斗前后的 buff 奖励**；
     *   第 3 场：巡逻魔王本体，并**额外持有玩家此前上交过的所有增益**（见 applyPatrolTollToFoe）。
     * 叙事上：爬到整百层的玩家，走过两名近卫，最终站到魔王面前。
     * ⚠ 普通的 x0 层（10/20/30…）**不触发**这套结构 —— 那些层照旧是「三侠 ×3 + 首领 + 守关」。 */
    if (endlessMode && Math.floor(Number(layer) || 0) % 100 === 0 && Number(layer) > 0 && D().PATROL) {
      const g1 = D().warlordFor(layer, salt);
      /* 两名近卫必须是**不同**的变体（同一位站两道门太敷衍）—— 撞了就换盐重取。 */
      let salt2 = (Number(salt) || 0) + 4177, g2 = D().warlordFor(layer, salt2);
      for (let i = 0; i < 6 && g1 && g2 && g1.name === g2.name; i++) {
        salt2 += 977;
        g2 = D().warlordFor(layer, salt2);
      }
      return [
        { kind: 'warlord', id: 'warlord', _layer: layer, _salt: salt, audience: 'guard', guardNo: 1, noReward: true,
          guardName: (g1 && g1.name) || '魔王近卫' },
        { kind: 'warlord', id: 'warlord', _layer: layer, _salt: salt2, audience: 'guard', guardNo: 2, noReward: true,
          guardName: (g2 && g2.name) || '魔王近卫' },
        { kind: 'patrol', id: 'patrol', _layer: layer, _salt: salt, x00: true, audience: 'king', replacedIndex: 2,
          replacedKind: 'boss' },
      ];
    }
    /* 三侠顺序按层数随机（`heroOrder`，与日期无关）：同层固定 → 预告 = 实战、重试不变。
     * 削弱跟着「哪一位大侠」走（HERO_DEBUFF[anim]），所以顺序一变，本层要吃的削弱顺序也变，
     * 但三种削弱的组合固定，玩家看预告里的头像就知道等一下会被套上什么。 */
    const plan = D().heroOrder(layer, salt).map((anim) => ({ kind: 'hero', anim }));
    // 第 4 场 = 随机 boss（挑战塔 27 选 1；无尽塔 18 选 1，含「狂战松鼠」精英）
    const boss = bossEntry(layer, salt, squirrelsOnly);
    /* 池子里抽到狂战松鼠时，把本层的 layer/salt 挂在 entry 上：
     * 变体（无双/铁壁/血怒/霜狱/无常）由 warlordFor(layer, salt) 决定，
     * entryInfo / regionOf 都读 entry._layer / _salt —— 不挂就会退回第一只，
     * 于是「预告」与「实战」不是同一只（见 planInfo 的一致性要求）。 */
    if (boss && boss.kind === 'warlord') { boss._layer = layer; boss._salt = salt; }
    plan.push(boss);
    // x10 层第 5 场 = 固定狂战松鼠（松鼠形态 + 全身狂战套 + 精英）
    if (layer % 10 === 0) plan.push({ kind: 'warlord', id: 'warlord', _layer: layer, _salt: salt });
    /* 「巡逻」替换（2026-10 第六十二批）：40 层之后、每个 10 层区块挑一层（x0/x5 除外），
     * 把那一层的**一场三侠/精英位**换成魔王战 —— 被替换的那一场就不再出现。
     * 选中的位置固定取区块内的第一个「可替换位」（预告与实战同口径）。 */
    if (D().isPatrolLayer(layer, salt)) {
      /* 「巡逻」**随机替换掉本层的任意一场**（2026-10 第六十三批用户口径）：
       *   · 用 (层号, salt) 定一个下标 → 同层固定、换局换点，**进层看预告就知道哪一场被换了**；
       *   · 三侠位、精英/首领位都可能被换（无尽塔的 4 场里随机挑一场）；
       *   · 被换掉的那一场**不再出现**（战斗场数不变 —— 这就是「替换」而不是「新加」）。 */
      const seed = (Math.max(1, Math.floor(Number(layer) || 1)) * 6151 + Math.abs(Math.floor(Number(salt) || 0)) * 3571) % 100003;
      const at = Math.abs(seed) % plan.length;
      const victim = plan[at];
      plan[at] = { kind: 'patrol', id: 'patrol', _layer: layer, _salt: salt,
        replacedIndex: at, replacedKind: victim && victim.kind, replacedAnim: victim && victim.anim,
        replacedId: victim && victim.id };
    }
    return plan;
  }
  function entryInfo(entry, layer, isLast) {
    const elite = isEliteEntry(entry, layer != null ? layer : entry._layer, isLast);
    if (entry.kind === 'hero') return { name: HERO_NAME[entry.anim], anim: entry.anim, type: '三侠位', mechDesc: '', elite: false };
    if (entry.kind === 'warlord') {
      /* 预告必须显示**这一层实际会遇到的**那只变体与**实际穿的套装**（同层固定 → 预告 = 实战）：
       * 非 10 的整数层抽到的狂战松鼠穿的是普通套装，预告里也不能画成狂战套。 */
      const w = D().warlordFor(entry._layer, entry._salt);
      /* x0 层的两位是「魔王近卫」（觐见魔王的第一、二关，没有 buff 奖励）。 */
      if (entry.audience === 'guard') {
        return { name: w.name, squirrel: true, gear: gearKeyOf(entry._layer, w), elite: true,
          type: '魔王近卫 · 第 ' + (Number(entry.guardNo) || 1) + ' 关', guard: entry.guardNo,
          mechDesc: '觐见魔王的第一道门 —— 近卫' + (Number(entry.guardNo) || 1) + '：' + (w.mechDesc || '') +
            '；这一场**没有**战斗前后的增益奖励',
          patternDesc: w.patternDesc, mechs: w.mech.slice() };
      }
      return { name: w.name, squirrel: true, gear: gearKeyOf(entry._layer, w), elite: true, type: w.type,
        mechDesc: w.mechDesc, patternDesc: w.patternDesc, mechs: w.mech.slice() };
    }
    /* 「巡逻」魔王：预告里也要认它 —— 固定名字、精英+boss 双属性、穿全套橙色狂战甲、
     * 开战定格玩家面板、全武器全技能真5、输了要上交一个最高稀有度增益。 */
    if (entry.kind === 'patrol') {
      /* x00 层那一场是「觐见魔王」（三连战的终点）；其余层是路上偶遇的「巡逻」。
       * 【2026-10 第七十八批用户口径】不再用「替换第 N 场」黄标说明它从哪来 ——
       * 那一场就是它自己（**精英 首领**），靠列表里的**淡红色背景**（`.tower-plan li.patrol`）
       * 标识特殊性；`replacedIndex / replacedKind…` 仍留在 entry 上只作内部记账。 */
      const isKing = entry.audience === 'king' || entry.x00;
      /* entryInfo 拿不到 run，用当前对局的实时状态算「它身上挂了几件你交出去的东西」。 */
      const liveRun = (typeof endless === 'function') ? endless().run : null;
      const held = (liveRun && Array.isArray(liveRun.patrolTolls)) ? liveRun.patrolTolls.length : 0;
      return { name: D().PATROL.name, squirrel: true, patrol: entry, outfit: D().PATROL.outfit.slice(),
        elite: true, boss: true, type: isKing ? '魔王 · 觐见' : '精英 首领',
        audience: isKing ? 'king' : null,
        mechDesc: (isKing
          ? '觐见魔王 —— 走过两名近卫，你终于站到了它面前。'
          : '开战时定格你进场那一刻的面板；持有全部武器与技能（真5）；' +
            '战斗失败时，上交一个本局当前还在生效的最高稀有度增益'),
        patternDesc: '全部武器 + 全部技能（真5）', mechs: [] };
    }
    if (entry.kind === 'npc') {
      const npc = D().NPC_BY_ID[entry.id];
      return { name: npc.name, anim: npc.anim, elite: elite, type: npc.type, mechDesc: npc.mechDesc, mechs: [npc.mech] };
    }
    const sq = entry.kind === 'trial' ? D().TRIAL_BY_ID[entry.id] : D().SQUIRREL_BY_ID[entry.id];
    return { name: sq.name, squirrel: true, gear: sq.gear, elite: elite, type: sq.type,
      mechDesc: sq.mechDesc || '', patternDesc: sq.patternDesc || '', mechs: (sq.mech || []).slice() };
  }
  function bossPool() {
    const TD = D();
    const layersOf = Object.create(null);
    for (let layer = 1; layer <= 30; layer++) {
      const e = TD.bossFor(layer);
      const key = e.kind + ':' + e.id;
      (layersOf[key] = layersOf[key] || []).push(layer);
    }
    return (TD.BOSS_POOL || []).map((pick) => {
      const entry = { kind: pick.kind, id: pick.id };
      return Object.assign({ kind: pick.kind }, entryInfo(entry), { layers: layersOf[pick.kind + ':' + pick.id] || [] });
    });
  }
  /** 入口页预告：当前层的全部对手（与 buildPlan 同源，所以预告 = 实战）。
   *  `mode` 缺省按无尽塔（x0 层的「觐见魔王」三连战只在无尽塔成立）。 */
  function preview(layer, salt, squirrelsOnly, mode) {
    const plan = buildPlan(layer, salt, squirrelsOnly, mode);
    return plan.map((entry, i) => Object.assign({ kind: entry.kind }, entryInfo(entry, layer, i === plan.length - 1)));
  }
  /* ============================================================
   * 对局中界面的权威敌人清单
   *
   * run.plan 才是「实战真正会打的那一串」；界面以前是另算一遍 preview(layer, salt)，
   * 只要两边的参数有任何一个对不上（例如某处重建 plan 时漏传 salt / squirrelsOnly），
   * 界面显示的第 4 场 boss 就会和实战不是同一只 —— 这就是「介绍的敌人与实际不符」。
   * 现在界面统一走这里：有对局就读 run.plan，绝不另算。
   * ============================================================ */
  function planInfo(mode) {
    const run = (mode === 'tower' ? tower() : endless()).run;
    if (!run || !Array.isArray(run.plan) || !run.plan.length) return [];
    return run.plan.map((entry, i) => Object.assign({ kind: entry.kind }, entryInfo(entry, run.layer, i === run.plan.length - 1)));
  }

  /* ============================================================
   * 【T4】增益聚合与效果汇总 —— aggregate / buffEffectLines
   * 结算顺序锁定（见文档 6.5）：基础 → 叠层累积 → C15 全局乘区。
   * ============================================================ */

  /** 【2026-10 同名逐条】按「栏位引用」找一条：**数字 = uid**（精确到那一条），
   *  否则按 id 找**最后一条**（与商店出售列表的倒序 / LIFO 口径一致）。
   *  返回 { row, list }；找不到返回 null。 */
  function findRowRef(run, ref) {
    if (!run) return null;
    const lists = [run.permanent || [], run.limited || []];
    const n = Math.floor(Number(ref) || 0);
    if (n > 0) {
      for (const L of lists) {
        const row = (L || []).find((b) => b && Number(b.uid) === n);
        if (row) return { row: row, list: L };
      }
    }
    for (const L of lists) {
      for (let i = (L || []).length - 1; i >= 0; i--) {
        if (L[i] && L[i].id === ref) return { row: L[i], list: L };
      }
    }
    return null;
  }
  function ownedEntry(run, id) {
    const hit = findRowRef(run, id);
    return hit ? hit.row : null;
  }
  /** 【任务3】同名增益可能占**多个背包栏位**（叠满后开新栏位），所以层数要跨栏位求和 ——
   *  聚合、封顶、成长计算全都依赖这个「总层数」口径。 */
  function stacksOf(run, id) {
    if (!run) return 0;
    let n = 0;
    for (const list of [run.permanent || [], run.limited || []]) {
      for (const b of list) {
        if (b && b.id === id) n += Math.max(1, Math.floor(Number(b.stacks) || 1));
      }
    }
    return n;
  }
  /** 【任务3】永久增益是否「可无限同名拾取」——叠满后另开一个背包栏位继续叠加。
   *  排除两类：
   *   · oncePerRun（一局一次：挥金如土 / 登顶者 / 以战养战…）——
   *     必须保持「一局只拿一次」，否则会绕过刚做的削弱；
   *   · 不占槽的选取型 / 扩容型（仓库钥匙 / 抉择扩充…）—— 重复获得没有意义，
   *     而且 addBuff 里本来就有「一局一次」的硬闸。 */
  function permanentRestackable(buff) {
    if (!buff || buff.kind !== 'permanent') return false;
    if (D().hasTag(buff, 'oncePerRun')) return false;
    /* noRestack（任务4）：涅槃 / 后发制人 / 挥金如土这一组**拿满上限后移出可获得池**，
     * 不走「叠满开新栏位」的通用规则。 */
    if (D().hasTag(buff, 'noRestack')) return false;
    /* 【任务2】`unique`（纯开关类：天象之眼 / 风影身法 / 先机预判 / 逢五强化 / 生命源泉）：
     * 多份没有意义 → **身上有就不再出现**，而不是并排占一堆格子。 */
    if (D().hasTag(buff, 'unique')) return false;
    return occupiesPermSlot(buff);
  }
  function globalMul(run) {
    const st = stacksOf(run, 'C15');
    return st ? Math.pow(D().BUFF_BY_ID.C15.mods.globalMul, st) : 1;
  }
  /** 生效中的 buff：永久全部生效；限次只在「开关打开且还有次数」时生效。 */
  function eachBuff(run, fn) {
    for (const b of run.permanent || []) fn(D().BUFF_BY_ID[b.id], b.stacks, b);
    for (const b of run.limited || []) { if (b.on === false || !(b.uses > 0)) continue; fn(D().BUFF_BY_ID[b.id], b.stacks, b); }
  }
  /** 一次生效类增益「到底给了什么」——调试台要把效果写清楚，不能只显示个名字。 */
  function instantDetail(buff) {
    const m = (buff && buff.mods) || {};
    const parts = [];
    if (m.instantCoins) parts.push('试炼币 +' + m.instantCoins);
    if (m.enemyMaxHpDown) parts.push('本局敌人生命上限 −' + Math.round(m.enemyMaxHpDown * 100) + '%');
    if (m.shopDiscount) parts.push('下一家商店 ' + shopDiscountLabel(m.shopDiscount));
    if (m.postBattleShop) parts.push('下一场战斗后开一次商店');
    if (m.postBattleMintShop) parts.push('下一场战斗后开一次铸币商店（顶掉普通商店）');
    if (m.instantRetry) parts.push('铸币 +' + m.instantRetry);
    if (m.shopHalf) parts.push('下次进店 ' + m.shopHalf + ' 件随机商品对折');
    if (m.rerollTiltMul) parts.push('商店刷新稀有线提速 ×' + m.rerollTiltMul);
    return parts.join('、') || (buff && buff.desc) || '立即生效';
  }

  /* ============================================================
   * 增益获取/消失记录（调试台用）
   *
   * 原来只有「当前还挂着的」增益能看见：一次生效类（立即进货 / 立即得试炼币 /
   * 即时削弱）用完就没了，限次类扣完次数自动消失，易碎烙印还会 5% 损毁 ——
   * 这些在调试台里全部查不到。这里按事件记一份流水，只保留最近 100 条。
   * 事件：get 获得 / stack 叠加 / instant 立即生效 / expire 用尽 / break 损毁 / lose 主动失去
   * ============================================================ */
  const BUFF_LOG_MAX = 100;
  function logBuff(run, id, event, extra) {
    if (!run || !id) return;
    const list = Array.isArray(run.buffLog) ? run.buffLog : (run.buffLog = []);
    list.push(Object.assign({ id: String(id), event: String(event), layer: Math.max(1, Number(run.layer) || 1) }, extra || {}));
    if (list.length > BUFF_LOG_MAX) list.splice(0, list.length - BUFF_LOG_MAX);
  }
  /** E01「立即进货」当前实际生效的折扣比例（0 = 没有生效的）。
   *  **必须按「条目现在是不是开着」现算**：原来拿到时把效果写进 run.postBattleShop /
   *  run.shopDiscount 缓存，玩家把 E01 关掉之后缓存还在 —— 于是关掉了照样每场结束进商店。
   *  口径：开着的（on !== false）且没用完（uses > 0）的立即进货才作数。 */
  function activeShopCredit(run) {
    let pct = 0;
    for (const e of run.limited || []) {
      if (e.on === false || !(e.uses > 0)) continue;
      const def = D().BUFF_BY_ID[e.id];
      const m = def && def.mods;
      if (m && m.postBattleShop) pct = Math.max(pct, Number(m.postBattleShopDiscount) || D().SHOP_DISCOUNT_E01);
    }
    return pct;
  }
  /** E16「铸币商队」：这一场打完是否**必开一家铸币商店**（限次 1）。
   *  与 activeShopCredit 同一口径：必须按「条目现在开不开着」现算，而且要在
   *  `consumeLimited` **之前**取（扣完次数条目就被移除了）。
   *  两家店同时挂着时以铸币商店优先 —— 用户口径：「若该场战斗后本应生成普通商店则顶掉」。 */
  function activePostBattleMintShop(run) {
    for (const e of run.limited || []) {
      if (e.on === false || !(e.uses > 0)) continue;
      const m = (D().BUFF_BY_ID[e.id] || {}).mods;
      if (m && m.postBattleMintShop) return true;
    }
    return false;
  }
  function consumeLimited(run) {
    for (const b of run.limited || []) {
      if (b.on === false || !(b.uses > 0)) continue;
      b.uses--;
      if (b.uses <= 0) logBuff(run, b.id, 'expire', { stacks: b.stacks || 1 });   // 扣完 → 自动消失
    }
    run.limited = (run.limited || []).filter((b) => b.uses > 0);
  }
  /**
   * 聚合当前生效的 buff 为本场战斗的修正。
   * foeCtx = {hero, poolNpc, elite}，用于「特定 NPC 触发」类乘区。
   */
  /** 某个 mod 在本局的合计值（不参与 adjustMe 的「场外」结算用，例如每胜利上限
   *  winMaxHpFlat / 商店消费成长）——带叠层与增幅水晶乘区。
   *  注意：「开战回血」类（补给 N08 / 战斗续航 C16·C17）不在这里，它们走 aggregate
   *  的 startHealPct，必须在 adjustMe 里按**本场真实上限**结算。 */
  function runModTotal(run, key) {
    const g = globalMul(run);
    let sum = 0;
    eachBuff(run, (buff, stacks, row) => { const m = buff.mods; if (m && m[key]) sum += m[key] * stacks * g * rowEnchMulOf(row); });
    return sum;
  }
  function aggregate(run, foeCtx) {
    const g = globalMul(run);
    const agg = { powerMul: 0, agilityMul: 0, maxHpMul: 0, critBonus: 0, critDmgBonus: 0, dodgeBonus: 0, takenMul: 0,
      regenPct: 0, lifestealPct: 0, shellPct: 0, openStrikePct: 0, enemyPowerDown: 0, startHealPct: 0,
      mustHitFirst: 0, firstSkillFree: 0, deathSaves: [], dmgMul: 1, revivePct: 0, reviveStatMul: 0, reviveMax: 0,
      speedMul: 0, thornsPct: 0, lowHpPowerMul: 0, lowHpAt: 0,
      lowHpAgilityMul: 0, lowHpSpeedMul: 0,
      emptyMaxHpMul: 0, lowHpTakenMul: 0, lowHpLifestealPct: 0, lowHpRegenPct: 0, lowHpRegenAt: 0,
      reflectImmune: 0, winTakenMulPct: 0, winTakenMulCap: 0,
      winStatAfter10: 0,
      weaponFreeUses: 0, weaponBoostUses: 0, weaponBoostPowerMul: 0, weaponBoostMustHit: 0,
      weaponBoostReflectImmune: 0, weaponBoostFatigueMul: 0, lowHpFinalMul: 0,
      openerPowerMul: 0, openerRounds: 0, fatiguePowerMul: 0, dodgeMul: 0,
      roundStatPct: 0, catchUpPct: 0, roundMaxHpMul: 0, firstDodge: 0,
      /* 2026-10 新增（N16 战意沸腾 / N17 血蚀印记 / E17 假如我直接赢）：
       *   startStatFlat    战斗开始时固定 力/敏/速 +N
       *   startMaxHpFlat   战斗开始时生命上限 +N（固定值）
       *   enemyHpDrainPct  每回合开始时对敌人造成其**当前生命** N% 的伤害
       *   openKill         开战即把敌方生命清零（本场直接判胜；不触发敌方死亡豁免） */
      startStatFlat: 0, startMaxHpFlat: 0, enemyHpDrainPct: 0, openKill: 0 };
    eachBuff(run, (buff, stacks, row) => {
      /* `k` = 这一条的总倍率：层数 × 增幅水晶的全局倍率 × **本条的铭文倍率**。
       * 铭文倍率来自「增幅铭文 C60」（`row.enchMul`，可叠乘多张不同铭文）——
       * 与增幅水晶同一套「乘在效果上」的逻辑，只是作用域是单条而不是全局。 */
      const m = buff.mods, k = stacks * g * rowEnchMulOf(row);
      if (m.powerMul) agg.powerMul += m.powerMul * k;
      if (m.powerPerEmptySlot) agg.powerMul += m.powerPerEmptySlot * Math.max(0, permSlots(run) - permUsed(run)) * k;
      if (m.powerPerPermBuff) {
        /* 【2026-10 用户口径】被虚空铭文附魔的永久件按 `powerPerPermBuffEnchantedWeight`
         * （默认 0.2 → 只给 2% 而不是 10%）计入，普通件按 1 计。
         * 份数可能是小数（附魔件 0.2 的累加），浮点求和会出现 3.4000000000000004 这种值 ——
         * 统一**保留一位小数**再参与计算与显示。 */
        const w = m.powerPerPermBuffEnchantedWeight != null
          ? Math.max(0, Number(m.powerPerPermBuffEnchantedWeight))
          : 1;
        const rows = run.permanent || [];
        let count = 0;
        for (const row of rows) count += rowFreeOf(row) ? w : 1;
        count = Math.round(count * 10) / 10;
        agg.powerMul += m.powerPerPermBuff * count * k;
      }
      if (m.winStatAfter10) agg.winStatAfter10 += 1;
      if (m.maxHpMul) { if (buff.kind === 'limited') agg.maxHpMul += m.maxHpMul * k; }
      if (m.critBonus) agg.critBonus += m.critBonus * k;
      if (m.critDmgBonus) agg.critDmgBonus += m.critDmgBonus * k;
      if (m.dodgeBonus) agg.dodgeBonus += m.dodgeBonus * k;
      if (m.takenMul) agg.takenMul += m.takenMul * k;
      if (m.regenPct) agg.regenPct += m.regenPct * k;
      if (m.lifestealPct) agg.lifestealPct += m.lifestealPct * k;
      if (m.shellPct) agg.shellPct += m.shellPct * k;
      if (m.startHealPct) agg.startHealPct += m.startHealPct * k;
      if (m.enemyPowerDown) agg.enemyPowerDown += m.enemyPowerDown * k;
      if (m.openStrikePct) agg.openStrikePct = Math.max(agg.openStrikePct, m.openStrikePct * k);
      if (m.speedMul) agg.speedMul += m.speedMul * k;
      if (m.agilityMul) agg.agilityMul += m.agilityMul * k;
      /* 挑战塔专属：开局狂热（按出手次数分档的攻击）与烟幕（闪避率乘算）。 */
      if (m.openerPowerMul) agg.openerPowerMul += m.openerPowerMul * k;
      if (m.fatiguePowerMul) agg.fatiguePowerMul += m.fatiguePowerMul * k;
      if (m.openerRounds) agg.openerRounds = Math.max(agg.openerRounds, Number(m.openerRounds) || 5);
      if (m.dodgeMul) agg.dodgeMul += m.dodgeMul * k;

      if (m.thornsPct) agg.thornsPct += m.thornsPct * k;                         // 荆棘之甲
      if (m.mustHitAll) agg.mustHitAll = 1;
      if (m.firstHitZero) agg.firstHitZero = 1;
      /* 先机预判（C38）本轮加强：挡下第一次伤害之后，我方还要**立刻**多行动一次（不消耗回合）。 */
      if (m.firstHitZeroFreeTurn) agg.firstHitZeroFreeTurn = 1;
      /* 本轮新增（战斗中每回合结算的那几条）：比例按「层数 × 全局倍率」累加，
       * 布尔型只置 1，乘区型（玉石俱焚）取所有来源里最强的一档。 */
      if (m.roundStatPct) agg.roundStatPct += m.roundStatPct * k;
      if (m.catchUpPct) agg.catchUpPct = Math.max(agg.catchUpPct, m.catchUpPct * k);
      if (m.roundMaxHpMul) agg.roundMaxHpMul = agg.roundMaxHpMul > 0
        ? Math.min(agg.roundMaxHpMul, Number(m.roundMaxHpMul)) : Number(m.roundMaxHpMul);
      if (m.firstDodge) agg.firstDodge = 1;
      /* 2026-10 新增限次类：战意沸腾（固定力/敏/速与血上限）与血蚀印记（按敌人当前血抽血）。 */
      if (m.startStatFlat) agg.startStatFlat += m.startStatFlat * k;
      if (m.startMaxHpFlat) agg.startMaxHpFlat += m.startMaxHpFlat * k;
      if (m.enemyHpDrainPct) agg.enemyHpDrainPct += m.enemyHpDrainPct * k;
      /* E17「假如我直接赢」：纯开关（叠多少份都是「开战即胜」），不参与增幅水晶乘区。 */
      if (m.openKill) agg.openKill = 1;
      /* 狂怒：低血时攻/敏/速同时提升；阈值取所有来源里的最高值（同一套 lowHpAt）。 */
      /* 反噬豁免：免疫一切反伤（限次类，战斗内生效）。 */
      if (m.reflectImmune) agg.reflectImmune = Math.max(agg.reflectImmune, Number(m.reflectImmune) || 0);
      /* 减伤成长（铜墙铁壁）：累计值记在 run.winTakenMul 上，这里只登记上限口径。 */
      if (m.winTakenMulPct) {
        agg.winTakenMulPct += m.winTakenMulPct * k;
        agg.winTakenMulCap = Math.max(agg.winTakenMulCap, (Number(m.winTakenMulCap) || 0) * stacks);
      }
      /* 空血上限：只抬高上限、不回血（与 maxHpMul 那条「回复等量」的语义相反）。 */
      if (m.emptyMaxHpMul) agg.emptyMaxHpMul += m.emptyMaxHpMul * k;
      /* 低血 combo 的减伤 / 吸血 / 每回合回血（都读同一个 lowHpAt 阈值）。 */
      if (m.lowHpTakenMul) agg.lowHpTakenMul += m.lowHpTakenMul * k;
      if (m.lowHpLifestealPct) agg.lowHpLifestealPct += m.lowHpLifestealPct * k;
      if (m.lowHpRegenPct) {
        agg.lowHpRegenPct += m.lowHpRegenPct * k;
        agg.lowHpRegenAt = Math.max(agg.lowHpRegenAt, Number(m.lowHpRegenAt) || Number(m.lowHpAt) || 0.5);
      }
      if (m.lowHpPowerMul || m.lowHpAgilityMul || m.lowHpSpeedMul) {
        if (m.lowHpPowerMul) agg.lowHpPowerMul += m.lowHpPowerMul * k;
        if (m.lowHpAgilityMul) agg.lowHpAgilityMul += m.lowHpAgilityMul * k;
        if (m.lowHpSpeedMul) agg.lowHpSpeedMul += m.lowHpSpeedMul * k;
        agg.lowHpAt = Math.max(agg.lowHpAt, Number(m.lowHpAt) || 0.35);
      }
      if (m.mustHitFirst) agg.mustHitFirst = 1;
      if (m.firstSkillFree) agg.firstSkillFree = 1;
      /* 金蝉脱壳（N04）：首次致死不再是「保留 1 血」，而是按比例复活并报出自己的名字。 */
      if (m.deathSave) agg.deathSaves.push({ name: buff.name });
      if (m.reviveFirstPct) {
        agg.deathSaves.push({ healPct: Math.min(0.9, m.reviveFirstPct * g), name: buff.name });
      }
      /* 生命源泉（C04）：只在**每层第一场**战斗开战时回血（run.idx===0）。 */
      if (m.layerFirstHealPct && run.idx === 0) agg.startHealPct += m.layerFirstHealPct * k;
      /* 按「使用武器次数」结算的两条：前 N 次不耗回合 / 前 N 次强化、之后衰减。 */
      if (m.weaponFreeUses) agg.weaponFreeUses = Math.max(agg.weaponFreeUses, Math.floor(m.weaponFreeUses));
      if (m.weaponBoostUses) {
        agg.weaponBoostUses = Math.max(agg.weaponBoostUses, Math.floor(m.weaponBoostUses));
        if (m.weaponBoostPowerMul) agg.weaponBoostPowerMul += m.weaponBoostPowerMul * k;
        if (m.weaponBoostMustHit) agg.weaponBoostMustHit = 1;
        if (m.weaponBoostReflectImmune) agg.weaponBoostReflectImmune = 1;
        agg.weaponBoostFatigueMul += Number(m.weaponBoostFatigueMul || 0) * k;
      }
      if (m.lowHpFinalMul) { agg.lowHpFinalMul += m.lowHpFinalMul * k; agg.lowHpAt = Math.max(agg.lowHpAt, Number(m.lowHpAt) || 0.5); }
      if (m.revivePct) {
        agg.revivePct = Math.max(agg.revivePct || 0, Math.min(0.9, m.revivePct * g));
        agg.reviveStatMul = Math.max(agg.reviveStatMul || 0, Number(m.reviveStatMul) || 0);
        agg.reviveMax = Math.max(agg.reviveMax || 0, Math.max(1, Math.floor(stacks)));
      }
      if (foeCtx.hero && m.dmgMulType) agg.dmgMul *= 1 + m.dmgMulType * k;       // 猎侠者
      if (foeCtx.poolNpc && m.dmgMulMech) agg.dmgMul *= 1 + m.dmgMulMech * k;    // 机制破解
      if (foeCtx.elite && m.dmgMulElite) agg.dmgMul *= 1 + m.dmgMulElite * k;    // 精英杀手
    });
    for (const [k, field] of [['power', 'powerMul'], ['agility', 'agilityMul'], ['speed', 'speedMul']]) {
      const v = fragileBonus(run, k).value * g;      // 同样吃「增幅水晶」的全局倍率
      if (v) agg[field] += v;
    }
    // 叠层累积（击杀/层数成长，运行态数值）
    if (run.killPower) agg.powerMul += run.killPower;
    /* 注意：这里原来有一行 `if (run.killMaxHp) agg.maxHpMul += run.killMaxHp;` ——
     * killMaxHp 是「击杀成长·生命上限」的历史字段，现已**没有任何地方写它**
     * （C07 吞噬成长走 run.winMaxHp），留着只会让人以为它还生效，已删除。 */
    if (run.bonusPower) agg.powerMul += run.bonusPower;
    // 逢十强化：仅 x10 层生效
    if (stacksOf(run, 'C09') && run.layer % 5 === 0) {
      const boost = (D().BUFF_BY_ID.C09.mods.x10Boost || 0.30) * g;
      agg.powerMul += boost; agg.maxHpMul += boost;
    }
    return agg;
  }

  /* ============================================================
   * 调试台用：把聚合后的修正翻成「对玩家的实际提升」一行行文字
   *
   * aggregate() 出来的是给战斗用的数字（乘区、百分比、开关），调试台要的是
   * 「攻击 +46%、暴击 +33%、每回合回血 8%」这种一眼能看懂的效果清单。
   * 只列真正 >0 / 为真的项，没生效的不占位置。
   * ============================================================ */
  function buffEffectLines(run, foeCtx) {
    if (!run) return [];
    const a = aggregate(run, foeCtx || {});
    const pct = (v) => (v >= 0 ? '+' : '') + (Math.round(v * 1000) / 10) + '%';
    const num = (v) => (v >= 0 ? '+' : '') + (Math.round(v * 10) / 10);
    const lines = [];
    if (a.powerMul) lines.push(['攻击', pct(a.powerMul)]);
    if (a.agilityMul) lines.push(['敏捷', pct(a.agilityMul)]);
    if (a.speedMul) lines.push(['速度', pct(a.speedMul)]);
    /* 永久类的生命上限加成不进聚合乘区（拿到时就折算进 run.hpBonus，卖掉也不回落），
     * 所以这里要把两条并起来算，否则「磐石之躯 +20%」在报告里会整条消失。 */
    const hpTotal = (a.maxHpMul || 0) + (run.hpBonus || 0) + winMaxHpOf(run);
    if (hpTotal) {
      lines.push(['生命上限', pct(hpTotal) +
        (run.hpBonus ? '（含已冻结 ' + pct(run.hpBonus) + '）' : '') +
        (winMaxHpOf(run) ? '（含成长 ' + pct(winMaxHpOf(run)) + '）' : '')]);
    }

    if (a.critBonus) lines.push(['暴击率', num(a.critBonus) + '%']);
    if (a.critDmgBonus) lines.push(['暴击伤害', pct(a.critDmgBonus)]);
    if (a.dodgeBonus) lines.push(['闪避', num(a.dodgeBonus) + '%']);
    if (a.takenMul) lines.push(['受到伤害', pct(a.takenMul)]);
    if (a.regenPct) lines.push(['每回合回血', pct(a.regenPct) + ' 最大生命']);
    if (a.lifestealPct) lines.push(['攻击吸血', pct(a.lifestealPct)]);
    if (a.thornsPct) lines.push(['荆棘反伤', pct(a.thornsPct)]);
    if (a.shellPct) lines.push(['护盾', pct(a.shellPct)]);
    /* 「开战回血」= 补给 N08 与战斗续航 C16·C17 共用的那一条：每场战斗第一回合
     * 按本场真实上限（含空血上限）回复，所以这里只报比例，不报「按上一场上限」的绝对值。 */
    if (a.startHealPct) lines.push(['开战回血', pct(a.startHealPct) + ' 最大生命']);
    if (a.reflectImmune) lines.push(['反噬豁免', '免疫一切反伤']);
    { const wt = winTakenMulOf(run); if (wt > 0) lines.push(['减伤成长（每胜利 −1%）', pct(wt)]); }
    if (a.openStrikePct) lines.push(['开局打击', pct(a.openStrikePct) + ' 敌最大生命']);
    /* 2026-10 新增：N16 战意沸腾（固定力/敏/速与血上限）、N17 血蚀印记（每回合按敌人当前血抽血）。 */
    if (a.startStatFlat) lines.push(['战意沸腾', '力/敏/速 +' + Math.round(a.startStatFlat)]);
    if (a.startMaxHpFlat) lines.push(['战意沸腾', '生命上限 +' + Math.round(a.startMaxHpFlat)]);
    if (a.enemyHpDrainPct) lines.push(['血蚀印记', '每回合抽 ' + pct(Math.min(1, a.enemyHpDrainPct)) + ' 当前生命']);
    if (a.openKill) lines.push(['假如我直接赢', '开战即让敌方生命归零（本场直接判胜）']);
    if (a.enemyPowerDown) lines.push(['敌人攻击', pct(-a.enemyPowerDown)]);
    /* 空血上限是乘法叠加的，清单里显示**合并后的真实比例**：
     * 空的部分 / 最终上限，这样玩家看到的数字与战斗里的实际占比一致。 */
    if (a.emptyMaxHpMul) lines.push(['空生命上限（不回血）', pct(a.emptyMaxHpMul / (1 + a.emptyMaxHpMul))]);
    /* 低血系（狂怒 + combo）：同一套阈值，清单里统一标出来源。 */
    const lowGate = '低血（≤' + Math.round(Math.max(a.lowHpAt, a.lowHpRegenAt) * 100) + '%）';
    /* 狂怒的三项都写在**最终值**上（终乘），所以统一按 ×N 展示，而不是 +N%（+N% 会被误读成
     * 「并进攻击/敏捷/速度面板」）。 */
    if (a.lowHpFinalMul) lines.push([lowGate + '最终伤害', '×' + (1 + a.lowHpFinalMul).toFixed(2)]);
    if (a.lowHpPowerMul) lines.push([lowGate + '攻击', pct(a.lowHpPowerMul)]);
    if (a.lowHpAgilityMul) lines.push([lowGate + '最终敏捷', '×' + (1 + a.lowHpAgilityMul).toFixed(2) + '（终乘）']);
    if (a.lowHpSpeedMul) lines.push([lowGate + '最终速度', '×' + (1 + a.lowHpSpeedMul).toFixed(2) + '（终乘）']);
    if (a.lowHpTakenMul) lines.push([lowGate + '减伤', pct(-a.lowHpTakenMul)]);
    if (a.lowHpLifestealPct) lines.push([lowGate + '吸血', pct(a.lowHpLifestealPct)]);
    if (a.lowHpRegenPct) lines.push(['低血（≤' + Math.round(a.lowHpRegenAt * 100) + '%）每回合回血',
      pct(a.lowHpRegenPct) + '，最多回到 ' + Math.round(a.lowHpRegenAt * 100) + '%']);
    if (a.dmgMul && a.dmgMul !== 1) lines.push(['对本场敌人伤害', pct(a.dmgMul - 1)]);
    if (a.revivePct) {
      const perLayer = Math.max(1, Math.floor(a.reviveMax || 1));
      const usedNow = (run.reviveLayer || 0) === run.layer ? Math.max(0, Math.floor(Number(run.reviveUsed) || 0)) : 0;
      lines.push(['复活（每层 ' + perLayer + ' 次）', pct(a.revivePct) + ' 生命' +
        (a.reviveStatMul ? '，复活后本场力/敏/速 +' + pct(a.reviveStatMul) : '') +
        (perLayer > 1 ? '（本层已用 ' + usedNow + '/' + perLayer + '）' : '')]);
    }
    /* 淘金烙印（C53）：战斗代币加成（存在 +15% / 损毁 +30%）。 */
    { const cn = fragileCoinBonus(run); if (cn > 0) lines.push(['试炼币获取（每场胜利）', pct(cn)]); }
    if (a.deathSaves && a.deathSaves.length) {
      const named = a.deathSaves.filter((s) => s.name).map((s) => s.name);
      const label = named.length ? named.join('/') : '免死';
      lines.push([label, a.deathSaves.length + ' 次' +
        (a.deathSaves.some((s) => s.healPct) ? '（按比例复活）' : '（保留 1 血）')]);
    }
    if (a.weaponFreeUses) lines.push(['前 ' + a.weaponFreeUses + ' 次使用武器', '不消耗回合']);
    if (a.weaponBoostUses) {
      lines.push(['前 ' + a.weaponBoostUses + ' 次使用武器',
        pct(a.weaponBoostPowerMul) + (a.weaponBoostMustHit ? '、必中' : '') +
        (a.weaponBoostReflectImmune ? '、免疫反伤' : '') +
        (a.weaponBoostFatigueMul ? '；之后攻击 ' + pct(-a.weaponBoostFatigueMul) : '')]);
    }
    if (a.mustHitFirst) lines.push(['必中', '首次攻击']);
    if (a.mustHitAll) lines.push(['必中', '全部攻击']);
    if (a.firstHitZero) lines.push(['首次受击', '伤害归零' + (a.firstHitZeroFreeTurn ? ' · 我方立刻行动一次' : '')]);
    if (a.firstSkillFree) lines.push(['首技能', '不消耗回合']);
    if (run.winStatPower || run.winStatAgility || run.winStatSpeed) {
      lines.push(['登顶成长（第 10 层起每胜）', '力 +' + Math.round(Number(run.winStatPower) || 0) +
        '、敏 +' + Math.round(Number(run.winStatAgility) || 0) + '、速 +' + Math.round(Number(run.winStatSpeed) || 0)]);
    }
    /* 运行态成长（不在 aggregate 的 mods 里，但确实是 buff 带来的提升） */
    if (run.killPower) lines.push(['击杀成长（攻击）', pct(run.killPower)]);
    if (run.bonusPower) lines.push(['加成累积（攻击）', pct(run.bonusPower)]);
    for (const [k, name] of [['power', '攻击'], ['agility', '敏捷'], ['speed', '速度']]) {
      const fb = fragileBonus(run, k);
      if (fb.value) lines.push(['烙印·' + name + (fb.burned ? '（已损毁·永久保留）' : '（存在）'), pct(fb.value)]);
    }
    if (run.spendGain && (run.spendGain.power || run.spendGain.agility || run.spendGain.speed || run.spendGain.hp)) {
      const g = run.spendGain;
      lines.push(['挥金如土', '攻击 +' + g.power + ' / 敏捷 +' + g.agility + ' / 速度 +' + g.speed + ' / 生命 +' + g.hp]);
    }
    if (run.enemyMaxHpDown) lines.push(['敌人生命上限（本局）', pct(-run.enemyMaxHpDown)]);
    if (run.shopDiscount) lines.push(['下一家商店', shopDiscountLabel(run.shopDiscountPct || 0.5)]);
    /* 逢五强化（C09）只在 5 的倍数层生效，单独标出来 */
    if (stacksOf(run, 'C09') && run.layer % 5 === 0) lines.push(['逢五强化（本层）', '已生效']);
    return lines;
  }

  /* ============================================================
   * 【T5】对局状态口径：血量 · 槽位 · 计数
   * 血量是绝对值口径（hpAbs），槽位按「实际占用」计（permUsed），
   * 「累计获得过几份」与「现在还剩几份」是两个口径（obtainedCountOf vs buffCountOf）。
   * ============================================================ */
  /** 折扣比例 → 中文折数标签（0.3 → 7 折、0.5 → 5 折、0.65 → 3.5 折）。 */
  function shopDiscountLabel(pct) {
    const v = Math.max(0, Number(pct) || 0);
    const zhe = Math.round((1 - v) * 100) / 10;
    return (Number.isInteger(zhe) ? zhe : zhe.toFixed(1)) + ' 折';
  }
  /** 永久增益槽位数：基础 5 + 扩容类 buff 给的名额。 */
  function permSlots(run) { return (D().PERMANENT_SLOTS || 5) + Math.max(0, Number(run && run.permSlots) || 0); }
  /* ============================================================
   * 血量：**绝对值口径**（血量继承按绝对值而不是百分比）
   *
   *   run.hpAbs —— **全局实际血量计数器**：战斗结束时把剩余血量写进去，
   *                并且在写入时就按「局外口径的上限」裁掉超出部分（真裁，不是显示时裁）。
   *                下一场把它放进「非战斗期间算出的上限」，所以进场血量不会高于局外上限。
   *                旧档只有百分比 run.carry，这里按当时的上限折算一次。
   *
   * 「按最大生命百分比回血」在绝对值模型下等于「加一个固定的绝对量」，所以需要一个
   * 参考上限：战斗中用本场实际 maxHp；换层等「还没有下一场」的时机用上一场记下的
   * run.lastMaxHp（就是玩家看到的那条血上限）。
   * ============================================================ */
  function hpAbsOf(run, fallbackMaxHp) {
    if (!run) return Math.max(1, Math.round(Number(fallbackMaxHp) || 1));
    const v = Number(run.hpAbs);
    if (Number.isFinite(v) && v > 0) return Math.max(1, Math.round(v));
    const ref = Math.max(1, Math.round(Number(run.refMaxHp) || Number(run.lastMaxHp) || Number(fallbackMaxHp) || 0));
    return Math.max(1, Math.round(ref * clamp01(run.carry == null ? 1 : run.carry)));
  }
  /** 「涌泉烙印」（C52）的治疗加成倍率：**增益/技能造成的治疗**都要乘上它。
   *  注意不作用于「规则回血」（层间结算回血、自动回血、药丸）——那些不是增益给的。 */
  function healBonusMul(run) { return 1 + fragileHealBonus(run); }
  /** 非战斗期间按「最大生命的百分比」回血：换算成绝对值后累加（自动受上限约束）。 */
  function healAbs(run, pct, refMaxHp) {
    const p = Math.max(0, Number(pct) || 0);
    if (!p) return 0;
    const ref = Math.max(1, Math.round(Number(refMaxHp) || Number(run && run.refMaxHp) || Number(run && run.lastMaxHp) || 0));
    const gain = Math.max(1, Math.round(ref * p));
    run.hpAbs = hpAbsOf(run) + gain;
    return gain;
  }
  function occupiesPermSlot(buff) {
    if (!buff || buff.kind !== 'permanent') return false;
    const m = buff.mods || {};
    if (m.pickWeaponPct || m.pickSkillPct || m.pickPermanentFree || m.pickPermanentMul || m.pickBrandBreak || m.pickLimitedUses || m.permSlot) return false;
    return true;
  }
  /** C48 铜墙铁壁的减伤累计（含上限封顶口径）。 */
  function winTakenMulOf(run) {
    if (!run) return 0;
    const c48 = stacksOf(run, 'C48');
    if (!c48) return 0;
    const cap = (Number(D().BUFF_BY_ID.C48.mods.winTakenMulCap) || 0.25) * c48;
    return Math.min(cap, Math.max(0, Number(run.winTakenMul) || 0));
  }
  /** C07 吞噬成长的百分比累计（含上限封顶口径，与 adjustMe 保持一致）。 */
  function winMaxHpOf(run) {
    if (!run) return 0;
    const c07 = stacksOf(run, 'C07');
    const cap = c07 ? (D().BUFF_BY_ID.C07.mods.winMaxHpCap || 0.30) * c07 * globalMul(run) : 0;
    return Math.min(cap, Math.max(0, Number(run.winMaxHp) || 0));
  }
  /** 记一次「即时类已获得」（用于重复获得概率递减）。 */
  function bumpInstant(run, id) {
    if (!run || !id) return;
    run.instantIds = Array.isArray(run.instantIds) ? run.instantIds : [];
    const row = run.instantIds.find((x) => x && x.id === id);
    if (row) row.count = Math.max(1, Math.floor(Number(row.count) || 1)) + 1;
    else run.instantIds.push({ id: id, count: 1 });
  }
  /** 本局某条增益的**总层数**（permanent 与 limited 都要数）——
   *  烙印类（C49 / C52）记在 run.limited 上，只查 permanent 会永远数到 0。 */
  function buffCountOf(run, id) {
    if (!run) return 0;
    let n = 0;
    for (const row of run.permanent || []) if (row && row.id === id) n += Math.max(1, Math.floor(Number(row.stacks) || 1));
    for (const row of run.limited || []) if (row && row.id === id) n += Math.max(1, Math.floor(Number(row.stacks) || 1));
    return n;
  }
  /* ============================================================
   * 「本局累计获得过几份」—— 与「现在还剩几份」分开的两个口径。
   *
   * 易碎烙印（C49 终焉烙印 / C39~C44 属性烙印 / C52 涌泉烙印）碎掉之后，
   * rollFragileBuffs 会把那一行**从 run.limited 里删掉**（加成转进 fragileBurned）。
   * 碎掉的烙印也要计入累计（否则层数上限与重复降权会因碎掉而回退，
   * 可以靠「等它碎」反复刷同一条），所以单独记一份只增不减的流水。
   * ============================================================ */
  /** 选取型增益（虚空铭文 C37 / 神兵淬炼 C32 / 秘技通神 C33 …）的**累计获得次数**。
   *  【2026-10 修复】它们不进 permanent/limited（不占栏位、不叠层，见 addBuff 的早退分支），
   *  所以 `buffCountOf` 永远是 0 → C37 的 `repeatWeight: 0.88` **从来没生效过**，
   *  而终焉烙印（C49）有栏位、份数一涨就降权 → 于是「虚空铭文越刷越多、终焉烙印越来越少」。
   *  这里单独记一份只增不减的流水，并接进 obtainedCountOf。 */
  function pickGotOf(run, id) {
    const t = run && run.pickGot;
    return Math.max(0, Math.floor(Number(t && t[id]) || 0));
  }
  function notePickGot(run, id) {
    if (!run || !id) return 0;
    const n = pickGotOf(run, id) + 1;
    run.pickGot = Object.assign({}, run.pickGot || {}, { [id]: n });
    return n;
  }
  /** 本局累计获得过的份数（只增不减；目前只对易碎烙印记账）。 */
  function fragileGotOf(run, id) {
    const t = run && run.fragileGot;
    return Math.max(0, Math.floor(Number(t && t[id]) || 0));
  }
  /** 层数上限 / 可获得性 / 重复降权统一用这个口径：在册份数 与 累计获得份数 取大。 */
  function obtainedCountOf(run, id) {
    return Math.max(buffCountOf(run, id), fragileGotOf(run, id), pickGotOf(run, id));
  }
  /** 某个**即时类**增益本局已获得的次数（即时类不进 permanent/limited，另记在 instantIds 上）。 */
  function instantOwnedCount(run, id) {
    if (!run) return 0;
    let n = 0;
    for (const row of run.instantIds || []) if (row && row.id === id) n += Math.max(1, Math.floor(Number(row.count) || 1));
    return n;
  }
  function permUsed(run) {
    const list = (run && run.permanent) || [];
    /* 【2026-10 任务2】逐条数：只有**被附魔的那一条**免占位，
     * 同名的另一条照样占位（原来按 id 一刀切，会让同名件全部免占位）。 */
    let used = 0;
    for (const row of list) if (!rowFreeOf(row)) used++;
    return Math.max(0, used);
  }
  function repairPermanentSlots(run, list) {
    const cap = permSlots(run);
    const used = permUsed(run);
    if (used > cap && typeof console !== 'undefined' && console.warn) {
      console.warn('[tower] 永久增益占用槽位超过上限：' + used + '/' + cap +
        '（列表 ' + list.length + ' 项，含免占位 ' + (list.length - used) + ' 项）—— 保留不丢弃，请检查 addBuff 的满格判定');
    }
    return list;
  }
  function currentMaxHp(run) {
    const base = Number(run && run.baseMaxHp) || 0;
    if (!(base > 0)) return 0;
    const stickyHp = Math.max(0, Number(run.hpBonus) || 0);
    const winMaxHp = winMaxHpOf(run);
    const flat = Math.max(0, Number(run.winHpFlat) || 0) +
      (run.spendGain ? Math.max(0, Number(run.spendGain.hp) || 0) : 0);
    return Math.max(1, Math.round(base * (1 + stickyHp + winMaxHp)) + flat);
  }
  /** 当前血量（绝对口径）：hpAbs 裁到当前上限。 */
  function currentHp(run) {
    /* run.hpAbs 是**全局实际血量计数器**（已在 reportBattle 里按局外上限裁过），
     * 所以这里通常只做防御性裁剪（上限因卖增益/吃 debuff 变小时才会真的裁到）。
     * 展示口径的优先级：
     *  · 战斗**进行中**时 run.lastMaxHp 就是本场真实上限（含空血上限等临时加成），
     *    此时 currentMaxHp() 只反映长期加成 —— 所以直接用 lastMaxHp 更准。
     *  · 战斗之间（拿到新永久增益、还没打下一场）用 currentMaxHp()，
     *    这样「刚买的增益」能立刻在血条上看到。
     * 另外：临时上限只在战斗中有效，战斗一结束就应当消失（见 currentMaxHp 的说明）。 */
    const longCap = currentMaxHp(run);
    const battleCap = Math.max(0, Math.round(Number(run && run.lastMaxHp) || 0));
    const live = !!(run && run.attempt);          // 战斗进行中
    const cap = live && battleCap > 0 ? battleCap : (longCap > 0 ? longCap : battleCap);
    const hp = hpAbsOf(run, cap);
    /* **同步全局计数器**：局外上限如果比计数器低（卖掉/失去永久上限增益、
     * 吃跨层 debuff…），被压下来的那部分要真正写回 run.hpAbs ——
     * 否则局外显示虽然按上限裁过，计数器里却还留着「多出来的血」，
     * 下次上限一变高它又会冒出来。
     * 只向**下**同步：计数器不会因为上限变大而自动补血。 */
    if (cap > 0 && Number(run.hpAbs) > cap) run.hpAbs = cap;
    return { hp: cap > 0 ? Math.min(hp, cap) : hp, maxHp: cap };
  }
  /* ============================================================
   * 【T6】敌人构建 —— buildFoe / regionOf
   * ============================================================ */

  function buildFoe(mode, layer, entry, salt, isLast) {
    const TD = D();
    const LT = mode === 'tower' ? TD.towerLevel(layer) : TD.endlessLevel(layer);
    const M = mode === 'tower' ? TD.towerMult(layer) : TD.endlessMult(layer);
    /* 30 层之后的深度曲线（见 tower-data.js 的 endlessDepthMul）：
     * 血量与属性一起放大，让「过了 30 层」真的越来越吃练度与对策。
     * ≤30 层时恒为 1，既有平衡不受影响。 */
    const KM = mode === 'tower' ? 1
      : (TD.endlessDepthMul ? TD.endlessDepthMul(layer) : 1);
    const statBase = GData.stagePlayerStat(LT), hpBase = GData.stagePlayerHp(LT);
    // 无尽段机制叠加：所有怪物按固定顺序追加机制
    const extra = [];
    const elite = isEliteEntry(entry, layer, isLast);       // x10 第 5 场首领 / 每 5 层的最后一战（×1.2）
    let name, bias, npcType, skills = [], weapons = [], pattern = null, mech;
    let mechParams = null, wears = null, castable = undefined;
    if (entry.kind === 'hero') {
      const scale = (GData.STAGE_TYPE_SCALE && GData.STAGE_TYPE_SCALE[entry.anim]) || 1;
      bias = { power: scale, agility: scale, speed: scale, hp: 1 };
      name = HERO_NAME[entry.anim]; npcType = entry.anim;
      skills = [{ id: HERO_SKILL[entry.anim], level: Math.max(1, Math.min(15, Math.round(LT / 5))) }];
      mech = extra.slice();
    } else if (entry.kind === 'squirrel' || entry.kind === 'trial' || entry.kind === 'warlord' || entry.kind === 'patrol') {
      // 松鼠形态的 boss：同族贴图（**不给 npcType** → 战斗里就用玩家那套松鼠图集并镜像朝左，
      // 走 sim 的 playerLikeAction 分支，所以武器/技能都真的生效，机制在 sim 的
      // 「玩家式 AI」分支里补挂）。每个 boss 都有固定装备（wears）→ 玩家看图就能认人。
      /* 塔顶 boss 从**独立变体池**里按 (salt, 层数) 取：同层固定、换层变化。
       * 池里每只都是狂战套，但武器/技能/技能等级/机制倾向各不相同。 */
      const sq = entry.kind === 'patrol'
        ? { name: TD.PATROL.name, bias: { power: 1, agility: 1, speed: 1, hp: 1 }, weapons: [], skills: [],
          pattern: [], mech: [], mechParams: null, wears: TD.PATROL.outfit.slice(), castable: undefined }
        : entry.kind === 'warlord' ? TD.warlordFor(layer, salt)
          : entry.kind === 'trial' ? TD.TRIAL_BY_ID[entry.id] : TD.SQUIRREL_BY_ID[entry.id];
      bias = sq.bias; name = sq.name; npcType = null;
      // 武技等级随目标等级小幅上调，免得高层还在用 8 级菜刀
      const up = Math.max(0, Math.floor((LT - 28) / 12));
      weapons = sq.weapons.map((w) => ({ id: w.id, level: Math.max(1, Math.min(15, w.level + up)) }));
      skills = sq.skills.map((k) => ({ id: k.id, level: Math.max(1, Math.min(15, k.level + up)) }));
      pattern = sq.pattern.slice();
      /* 套装随层升级；**狂战套只属于 10 的整数层的守关首领**（见 gearKeyOf）——
       * 无尽塔第 4 场抽到狂战松鼠（非整数层）时按普通档位换装。 */
      wears = TD.wearsOf(gearKeyOf(layer, sq));
      mech = extra.slice();
      // 自己的机制永远在（无尽的段位机制只做叠加）
      for (const m of sq.mech || []) if (!mech.includes(m)) mech.push(m);
      mechParams = sq.mechParams || null;
      /* castable：这个敌人固定循环里会用的**主动技**（塔顶 boss 变体用它表达倾向）。
       * 没有就交给 sim 退回「所有已实现技能」。 */
      castable = Array.isArray(sq.castable) ? sq.castable.slice() : undefined;
    } else {
      const npc = TD.NPC_BY_ID[entry.id];
      bias = npc.bias; name = npc.name; npcType = 'tw_' + npc.id;
      mech = [npc.mech];
      for (const m of extra) if (!mech.includes(m)) mech.push(m);
    }
    const eliteMul = elite ? 1.2 : 1;   // 精英加成（x10 狂战）：作用在力量/敏捷/速度上
    // 敌方数值：高血低攻（系数都在 tower-data.js 里，带注释，方便复调）
    // 力量单独用更低的系数，敏捷/速度维持原基准；血量抬高。
    const stat = (b, mul) => Math.max(1, Math.round(statBase * (mul || TD.FOE_STAT_MUL) * M * KM * b * eliteMul));
    const hero = entry.kind === 'hero';
    const warlord = entry.kind === 'warlord';           // x10 第 5 场
    const powMul = hero ? TD.FOE_HERO_POWER_MUL : warlord ? TD.FOE_WARLORD_POWER_MUL : TD.FOE_TRIAL_POWER_MUL;
    /* 「金松果还在增长期」（挑战塔第 26 层之前）敌人血量 ×0.9：那几层收益低，难度也放低一档。
     * 无尽塔不吃这条（towerEarlyHpMul 内部按 mode 分流）。 */
    const earlyHp = TD.towerEarlyHpMul(layer, mode);
    const heroHp = hpBase * TD.FOE_HP_MUL * TD.FOE_HERO_HP_MUL * M * KM * bias.hp * earlyHp;
    const hpRatio = hero ? 1 : warlord ? TD.WARLORD_HP_RATIO : TD.bossHpRatio(bias.hp, layer);
    const foe = {
      name, level: LT, npcType,
      power: stat(bias.power, TD.FOE_POWER_MUL * powMul),
      agility: stat(bias.agility), speed: stat(bias.speed),
      hp: Math.max(1, Math.round(heroHp * hpRatio)),
      weapons, skills, mech, pattern, mechParams, wears,
      castable,
    };
    // poolNpc = 带专属机制的对手（「机制破解」类 buff 只对它生效）；平庸松鼠没有机制，不算
    const poolNpc = entry.kind === 'npc' || entry.kind === 'warlord' || (entry.kind === 'trial');
    /* 「巡逻」魔王：数值不按层曲线算 —— **开战时复制玩家**（见 nextBattle 里 adjustMe 的收尾），
     * 这里先按层给一套托底值（战斗没走到复制时也不至于 0 血），穿全套橙色狂战甲。
     * 它持有的**全部武器 / 全部技能都是真5（15 级）**。 */
    if (entry.kind === 'patrol') {
      const tools = [];
      const each = (map) => { if (map && map.each) map.each((id) => tools.push(Number(id))); };
      each(typeof weaponsMap !== 'undefined' ? weaponsMap : (typeof window !== 'undefined' ? window.weaponsMap : null));
      const wAll = tools.slice();
      const sAll = [];
      const smap = (typeof skillsMap !== 'undefined' ? skillsMap : (typeof window !== 'undefined' ? window.skillsMap : null));
      if (smap && smap.each) smap.each((id) => sAll.push(Number(id)));
      const lv = Math.max(1, Math.floor(Number(TD.PATROL.toolLevel) || 15));
      foe.weapons = (wAll.length ? wAll : [1]).map((id) => ({ id, level: lv }));
      foe.skills = sAll.map((id) => ({ id, level: lv }));
      foe.wears = (TD.PATROL.outfit || []).slice();
      foe.patrol = true;
      foe.name = TD.PATROL.name;
      /* 【2026-10 第七十四批】身上这套橙色狂战甲**真的给性能** —— 不是只有外观。
       * 这里先落一份（战斗没走到 adjustMe 的复制分支时也成立）；
       * adjustMe 复制完玩家面板后会再落一次（那一步会把 power 整个覆盖掉，所以必须重落）。 */
      applyPatrolSet(foe, LT);
    }
    return { foe, elite, poolNpc };
  }
  function regionOf(entry) {
    if (entry.kind === 'squirrel' || entry.kind === 'trial' || entry.kind === 'warlord') {
      const sq = entry.kind === 'warlord' ? D().warlordFor(entry._layer, entry._salt)
        : entry.kind === 'trial' ? D().TRIAL_BY_ID[entry.id] : D().SQUIRREL_BY_ID[entry.id];
      return sq && sq.region != null ? sq.region : 0;
    }
    /* 「巡逻」魔王不是 NPC 表里的条目（它按玩家面板现造）—— 别去查 NPC_BY_ID，按层给一个区域。 */
    if (entry.kind === 'patrol') return HERO_REGION[D().heroOrder(entry._layer || 1, entry._salt || 0)[0]] != null
      ? HERO_REGION[D().heroOrder(entry._layer || 1, entry._salt || 0)[0]] : 0;
    const anim = entry.kind === 'hero' ? entry.anim : D().NPC_BY_ID[entry.id].anim;
    return HERO_REGION[anim] != null ? HERO_REGION[anim] : 0;
  }

  /* ============================================================
   * 【T7】开局：发起对局 —— startTowerRun / startEndlessRun
   * ============================================================ */

  function startTowerRun() {
    const lock = unlocked();
    if (!lock.ok) return lock;
    const t = tower();
    if (t.run) return { ok: false, msg: '本层挑战尚未结束。' };
    const s = S();
    if (!debug('noTowerCost')) {
      if (!(s.props[BOOK_PROP] > 0)) return { ok: false, needsBook: true, msg: '挑战书不足，快去商店中购买吧！' };
      s.props[BOOK_PROP]--;
      if (s.props[BOOK_PROP] <= 0) delete s.props[BOOK_PROP];
    }
    const layer = t.maxLayer + 1;
    /* buffVer 必须**建局时就写上**：否则第一次 normalizeRun 会把新加的 T04 当成旧档 T04 搬走。 */
    t.run = { mode: 'tower', layer, plan: buildPlan(layer, undefined, false, 'tower'), idx: 0, carry: 1, buffVer: D().BUFF_VER,
      permanent: [], limited: [], buffs: [], debuffs: [], pot: 0, choices: null };
    save();
    return { ok: true, layer };
  }
  function startEndlessRun() {
    const lock = unlocked();
    if (!lock.ok) return lock;
    const e = endless();
    if (e.run) return { ok: false, msg: '本局无尽挑战尚未结束。' };
    const salt = (Date.now() % 1000000) + ':' + Math.floor(Math.random() * 1e6);
    const run = { layer: 1, plan: buildPlan(1, salt, true), idx: 0, carry: 1, salt, buffVer: D().BUFF_VER,
      mode: 'endless', permanent: [], limited: [], coins: 0, score: 0, bestLayer: 0,
      /* 即时削弱累计（E07/E08 生命上限、E11 攻击力）：拿到就记在这里，之后每场都生效。 */
      enemyMaxHpDown: 0, enemyPowerDown: 0,
      killPower: 0, bonusPower: 0, shop: null, phase: null, choices: null, debuffs: [],
      retryToken: 0, retrySnap: null,
      achievements: [], scoreLog: [], statPeaks: {}, pendingToasts: [],
      deathSaves: 0, reviveCount: 0, reviveTierPaid: 0,
      /* 新口径标记：fragileBase 存「存在时的全额值」（见 normalizeRun 的语义迁移）。 */
      fragileAliveFull: 1 };
    if (debug('endlessCoin')) run.coins = 9999;
    /* 【2026-10 用户口径】第一场**之前**也要能正常显示血量。
     * run.baseMaxHp 原本只在第一场的 adjustMe 里才写（那是唯一知道玩家面板的地方），
     * 于是开局那一屏（剧情模式之后的主界面）血条只能显示「—」。
     * 这里先用**与开战时同一份** State.totalStats 落一份基准；
     * 第一场的 adjustMe 会用同一口径再写一次（值相同，血条不会跳）。
     * ⚠️ 只写基准、**不写 `run.hpAbs`**：绝对血量计数器在「没写过」时按当前上限算满血
     * （见 hpAbsOf 的回退），写死一个数反而会把第一场的进场血量钉在旧值上。 */
    run.baseMaxHp = Math.max(1, Math.round(Number(State.totalStats({ useProps: true }).hp) || 0));
    e.run = run;
    save();
    return { ok: true, layer: 1 };
  }
  /** 进入新一层的回血（无尽）：基础层间回复 20%。C08「五层回响」已删除，这里不再有额外一段。 */
  function layerStartHeal(run, mode) {
    const ref = Math.max(1, Number(run.lastMaxHp) || 0);
    if (mode === 'endless') healAbs(run, D().ENDLESS_LAYER_HEAL_PCT, ref);
  }

  /* ============================================================
   * 【T8】战斗调度 —— nextBattle / retryBattle / interruptBattle
   * ============================================================ */

  /** 深拷贝一份对局状态（优先用 structuredClone，退回 JSON —— 用 Object.assign 会被 __proto__ 坑到）。 */
  function cloneRun(run) {
    if (typeof structuredClone === 'function') { try { return structuredClone(run); } catch (e) { /* 落到 JSON */ } }
    return JSON.parse(JSON.stringify(run));
  }
  function snapshotBattle(run) {
    if (!run || run.mode !== 'endless') return null;
    const snap = cloneRun(run);
    delete snap.retrySnap;
    delete snap.attempt;          // 令牌不能带回来，否则回滚后就「这场还没结束」了
    run.retrySnap = snap;
    return snap;
  }
  /** 取下一场战斗；返回可直接交给 Main.startBattle 的 foe / hpRatio / adjustMe。 */
  function nextBattle(mode) {
    const run = mode === 'tower' ? tower().run : endless().run;
    if (!run) return { ok: false, msg: '没有进行中的挑战。' };
    if (run.attempt) return { ok: false, msg: '这场战斗尚未结束。' };
    if (run.choices) return { ok: false, msg: '请先完成场间选择。' };
    if (run.phase) return { ok: false, msg: '请先完成商店与结算。' };
    const entry = run.plan[run.idx];
    const isLastBattle = run.idx === run.plan.length - 1;      // 本层最后一战（x5 的精英台阶在这里）
    const built = buildFoe(mode, run.layer, entry, run.salt, isLastBattle);
    const foeCtx = { hero: entry.kind === 'hero', poolNpc: built.poolNpc, elite: built.elite };
    const agg = aggregate(run, foeCtx);
    /* 隐藏成就「超凡入圣」：本场聚合出来的 buff 加成（不含装备/等级）跨过阈值就记一次。 */
    checkStatAchievements(run, agg);
    /* M01 威慑（本场 buff 的聚合值）+ 即时削弱 E11「挫锋」（记录在 run.enemyPowerDown 上）：
     * 两者相加后一起压敌人力量，上限 80%（别把敌人打成 0 攻击）。 */
    const foePowerDown = Math.max(0, Math.min(0.8,
      Math.max(0, Number(run.enemyPowerDown) || 0) + Math.max(0, Number(agg.enemyPowerDown) || 0)));
    if (foePowerDown > 0) built.foe.power = Math.max(1, Math.round(built.foe.power * (1 - foePowerDown)));
    const foeHpDown = Math.max(0, Math.min(ENEMY_MAXHP_DOWN_CAP, Number(run.enemyMaxHpDown) || 0));
    if (foeHpDown > 0) built.foe.hp = Math.max(1, Math.round(built.foe.hp * (1 - foeHpDown)));
    const maxHpMul = agg.maxHpMul, powerMul = agg.powerMul;
    /* 「开局回血」类（补给 N08 等）放在 adjustMe **内部**执行 ——
     * 它要按「本场实际的最大生命」回血，而那个值只有在 adjustMe 里算完才有
     *（run.baseMaxHp 也是在那里写的）。详见下面的 pendingStartHealPct。 */
    const adjustMe = (me) => {
      run.baseMaxHp = Math.max(1, Number(me.maxHp) || 0);
      // 本层削弱（三侠大招留下的）：生命上限 / 属性 / 锁武技
      const debuffs = Array.isArray(run.debuffs) ? run.debuffs : [];
      const dMaxHp = debuffs.filter((d) => d.kind === 'maxHp').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const dPower = debuffs.filter((d) => d.kind === 'stat' && d.stat === 'power').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const dAgi = debuffs.filter((d) => d.kind === 'stat' && d.stat === 'agility').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const dSpd = debuffs.filter((d) => d.kind === 'stat' && d.stat === 'speed').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const stickyHp = Math.max(0, Number(run.hpBonus) || 0);
      const winMaxHp = Math.max(0, Number(run.winMaxHp) || 0);
      const spendHp = run.spendGain ? Math.max(0, Number(run.spendGain.hp) || 0) : 0;
      /* ============================================================
       * 「空血上限」（emptyMaxHpMul）
       *
       * 语义（需求已经点明）：**空的那部分 = 当前最大生命 × 该比例**，
       * 而「当前最大生命」是**这一场算出来的上限**（会随层数、成长、其它增益变化），
       * 不是一个固定的「获得时的基准」。
       *
       * 所以每条「空血上限 +E」定义成「把空出来的那份放大 (1+E) 倍」——
       * 多条同时生效时按 (1+E1)(1+E2)… 连乘，空出来的那份直接跟随最终上限走：
       *     P = me.maxHp × (1 + maxHpMul + stickyHp + winMaxHp) × dMaxHp + flatHp
       *     空的部分 = P × ((1+E1)(1+E2)… − 1)
       *     maxHp    = P + 空的部分
       * 于是「空的部分 / maxHp」= 1 − 1/∏(1+Ek)，正好等于写出来的那个百分比，
       * 而且每场都会按当时的上限重算（层数变高、成长变多，空的部分也跟着变）。
       *
       * 另外：当前血量始终按**不含空血上限**的基数折算（baseMaxHp），
       * 所以空出来的那部分永远是真的空的。
       * ============================================================ */
      const emptyPct = Math.max(0, Number(agg.emptyMaxHpMul) || 0);
      const flatHp = Math.max(0, Number(run.winHpFlat) || 0) + spendHp + Math.max(0, Number(agg.startMaxHpFlat) || 0);
      const baseMaxHp = Math.max(1, Math.round(me.maxHp * (1 + maxHpMul + stickyHp + winMaxHp) * dMaxHp) + flatHp);
      const emptyPart = Math.max(0, Math.round(baseMaxHp * emptyPct));
      const maxHp = baseMaxHp + emptyPart;
      /* 选取型强化：指定武器出战时伤害 +pct（等价于力量翻倍），指定技能的触发档位 ×(1+pct) 且至少 +25 */
      const wBoost = run.weaponBoost || {};
      let weaponMul = 1;
      for (const key of Object.keys(wBoost)) {
        const inst = (State.myWeapons ? State.myWeapons() : []).find((w) => Number(w.id) === Number(key));
        if (inst) weaponMul = Math.max(weaponMul, 1 + Number(wBoost[key] || 0));
      }
      const sBoost = run.skillBoost || {};
      /* 小宇宙爆发（14）是「开战第一招必放」的开关，不是加成。 */
      const cosmosFirst = Number(sBoost[PICKABLE_COSMOS] || 0) > 0 ? 1 : 0;
      /* 秘技通神（C33）的技能加成走**独立通道** `me.skillBoost`（技能id → 比例）。
       * 旧写法把它写进 `me.effects[key]`，而 effects 的键位同时属于装备词条与武器效果槽
       * （effects['12'] = 方天画戟伤害 +N%、effects['7'] = 投掷武器伤害 +N%…），
       * 于是「野球拳触发概率 +60%」实际变成了「方天画戟伤害 +25%」。
       * 现在：主动技由 sim 的 skillWeight ×(1+比例) 生效；
       *       绝对防御/龟甲术由 sim 的 passiveSkillBoost 读同一字段。 */
      const sb = {};
      for (const key of Object.keys(sBoost)) {
        if (Number(key) === PICKABLE_COSMOS) continue;
        const v = Number(sBoost[key]) || 0;
        if (v > 0) sb[Number(key)] = v;
      }
      if (Object.keys(sb).length) me.skillBoost = Object.assign({}, me.skillBoost, sb);
      /* 环境词缀（敌人侧）：数值来自实例上摇好的随机值（见 envValues / applyEnvToFoe）。 */
      applyEnvToFoe(run, built.foe);
      me.power = Math.max(1, Math.round(me.power * (1 + powerMul) * dPower * weaponMul));
      me.agility = Math.max(1, Math.round(me.agility * dAgi * (1 + agg.agilityMul)));
      me.speed = Math.max(1, Math.round(me.speed * dSpd * (1 + agg.speedMul)));
      if (run.spendGain) {
        for (const k of ['power', 'agility', 'speed']) me[k] += Math.max(0, Number(run.spendGain[k]) || 0);
      }
      /* 登顶者：第 10 层起每胜一场累计的固定力/敏/速（同口径，直接加到面板属性）。 */
      me.power += Math.max(0, Number(run.winStatPower) || 0);
      me.agility += Math.max(0, Number(run.winStatAgility) || 0);
      me.speed += Math.max(0, Number(run.winStatSpeed) || 0);
      /* 战意沸腾（N16）：每场战斗开始时固定 力/敏/速 +N（不吃百分比乘区，与「登顶者」同口径）。 */
      const startFlatStat = Math.max(0, Number(agg.startStatFlat) || 0);
      if (startFlatStat) { me.power += startFlatStat; me.agility += startFlatStat; me.speed += startFlatStat; }
      for (const d of debuffs) {
        if (d.kind !== 'lock') continue;
        if (d.what === 'weapon') me.weapons = (me.weapons || []).filter((w) => Number(w.id) !== Number(d.id));
        /* me.skills 是 {id, level} 对象数组（main.js 的 mySkills().map(...)），
         * 原来对它做 String(s2).split(':')[0] 会得到 "[object Object]" → NaN，
         * 于是「锁技能」永远删不掉（只有武器锁生效）。这里把对象与旧的 "id:lv" 字符串都兼容。 */
        else me.skills = (me.skills || []).filter((s2) => {
          const sid = Number(s2 && typeof s2 === 'object' ? s2.id : String(s2).split(':')[0]);
          return sid !== Number(d.id);
        });
      }
      applyEnvToMe(run, me);
      const envModsMine = Object.assign({}, me.mods || {});
      /* ============================================================
       * 终乘烙印（C49「终焉烙印」）：**所有加算 / 成长都算完之后**再乘一遍。
       *   力/敏/速/生命上限 ×(1 + 0.25×存在层 + 0.5×损毁层)
       * 之所以放在这里：它要的是「最终 1.25 倍 / 1.5 倍」，而不是参与前面的加法堆叠；
       * 是**按层加算**（线性），不是 1.5^n —— 见 fragileFinalMul。
       * 注意 maxHp 与当前血量一起放大，保持「当前血量占上限的比例」不变。
       * ============================================================ */
      /* 治疗烙印：跳绿字的回血量 +% —— sim 的 healOf() 读 mods.healMul。 */
      const healBonus = fragileHealBonus(run);
      const finalMul = fragileFinalMul(run);
      const scaledMaxHp = finalMul === 1 ? maxHp : Math.max(1, Math.round(maxHp * finalMul));
      if (finalMul !== 1) {
        me.power = Math.max(1, Math.round(me.power * finalMul));
        me.agility = Math.max(1, Math.round(me.agility * finalMul));
        me.speed = Math.max(1, Math.round(me.speed * finalMul));
        me.hp = Math.max(1, Math.min(scaledMaxHp, Math.round(me.hp * finalMul)));
      } else {
        me.hp = Math.max(1, Math.min(scaledMaxHp, me.hp));
      }

      // maxHpMul 的「回复等量生命」= 按比例继承到新上限（正增益不亏比例、负增益同步缩血）
      me.maxHp = scaledMaxHp;
      const initHp = Math.max(1, Math.min(baseMaxHp, hpAbsOf(run, baseMaxHp)));
      me.hp = Math.max(1, Math.min(maxHp, initHp));
      if (!(Number(run.hpAbs) > 0)) run.hpAbs = me.hp;      // 建立计数器 */
      /* ============================================================
       * 「开战回血」类（补给 N08 / 战斗续航 C16·C17）：**本场第一回合**回复 X% 最大生命。
       * 「最大生命」用本场算出的 me.maxHp 作基准（含局内上限加成、固定值成长与空血上限）。
       * 位置很关键：必须放在「按 baseMaxHp 裁进场血」**之后**，否则回血会被再裁一次、
       * 空血上限那部分永远填不进去；放在其后则只受 me.maxHp 封顶（不超过本场血条）。
       * ============================================================ */
      /* 枯泉·涸井（trialDry）「封死对手的一切治疗」：**开战回血也要封**。
       * 这段发生在战斗准备阶段，早于 sim 把 def.healMul 归零，所以必须在这里拦一道 ——
       * 否则 C04/C16/C17 的开战回血会绕过封疗（用户报「枯泉没生效」的主因之一）。 */
      const foeSealsHeal = !!(D().mechSealsHeal && D().mechSealsHeal(built && built.foe && built.foe.mech));
      if (agg.startHealPct > 0 && me.maxHp > 0 && !foeSealsHeal) {
        const beforeHeal = me.hp;
        /* 开战回血（补给 N08 / 战斗续航 C16·C17）也算治疗：涌泉烙印照常加成。 */
        const gain = Math.max(1, Math.round(me.maxHp * agg.startHealPct * healBonusMul(run)));
        me.hp = Math.min(me.maxHp, me.hp + gain);
        run.hpAbs = me.hp;
        agg.startHealGain = me.hp - beforeHeal;      // 实际回血量（可能被本场上限截断）
        agg.startHealRef = me.maxHp;
      }

      run.lastMaxHp = scaledMaxHp;
      run.lastHp = Math.min(me.hp, scaledMaxHp);
      /* 记下本场真正的上限，供「非战斗期间」的绝对回血与裁血使用
       *（尤其是第一场：那时还没有任何历史血量，必须以本场上限为基准）。 */
      run.refMaxHp = maxHp;
      const mods = {};
      if (agg.critBonus) mods.critBonus = agg.critBonus;
      if (agg.critDmgBonus) mods.critDmgBonus = agg.critDmgBonus;
      if (agg.dodgeBonus) mods.dodgeBonus = agg.dodgeBonus;
      if (agg.takenMul) mods.takenMul = agg.takenMul;
      /* 挑战塔专属字段必须显式带过去（mods 是逐字段挑的，漏一个 buff 就静默失效）。 */
      if (agg.openerPowerMul) mods.openerPowerMul = agg.openerPowerMul;
      if (agg.fatiguePowerMul) mods.fatiguePowerMul = agg.fatiguePowerMul;
      if (agg.openerRounds) mods.openerRounds = agg.openerRounds;
      if (agg.dodgeMul) mods.dodgeMul = agg.dodgeMul;
      if (agg.regenPct) mods.regenPct = agg.regenPct;
      if (agg.lifestealPct) mods.lifestealPct = agg.lifestealPct;
      if (agg.shellPct) mods.shellPct = agg.shellPct;
      if (agg.openStrikePct) mods.openStrikePct = agg.openStrikePct;
      if (agg.mustHitFirst) mods.mustHitFirst = 1;
      if (agg.firstSkillFree) mods.firstSkillFree = 1;
      /* 秘技通神（C33）抽中小宇宙爆发：开战第一招必定放它（sim 里强制出招）。 */
      if (cosmosFirst) mods.cosmosFirst = 1;
      if (agg.dmgMul !== 1) mods.dmgMul = agg.dmgMul;
      if (agg.thornsPct) mods.thornsPct = Math.min(0.6, agg.thornsPct);          // 荆棘之甲（sim 里结算）
      if (agg.mustHitAll) mods.mustHitAll = 1;
      if (agg.firstHitZero) mods.firstHitZero = 1;
      if (agg.firstHitZeroFreeTurn) mods.firstHitZeroFreeTurn = 1;
      /* 减伤成长：与本场其它减伤一起并进 takenMul（负值 = 减伤）。 */
      const grownTaken = winTakenMulOf(run);
      if (grownTaken > 0) mods.takenMul = (Number(mods.takenMul) || 0) - Math.min(agg.winTakenMulCap || grownTaken, grownTaken);
      if (agg.reflectImmune) mods.reflectImmune = agg.reflectImmune;
      /* 治疗烙印：sim 的 healOf() 读的是 fighter 顶层的 **healMul**（不是 me.mods 里的字段），
       * 所以这里要把面板字段一起写上。 */
      if (healBonus > 0) me.healMul = 1 + healBonus;
      if (agg.emptyMaxHpMul) mods.emptyMaxHpMul = agg.emptyMaxHpMul;
      /* 回合开始类（越战越勇 / 后发制人 / 玉石俱焚 / 风影身法）—— sim 侧按这些字段结算。 */
      if (agg.roundStatPct) mods.roundStatPct = agg.roundStatPct;
      if (agg.catchUpPct) mods.catchUpPct = agg.catchUpPct;
      if (agg.roundMaxHpMul > 0 && agg.roundMaxHpMul < 1) mods.roundMaxHpMul = agg.roundMaxHpMul;
      if (agg.firstDodge) mods.firstDodge = agg.firstDodge;
      /* 血蚀印记（N17）：每回合开始时对敌人造成其当前生命 N% 的伤害（封顶 100%，避免多份叠成秒杀）。 */
      if (agg.enemyHpDrainPct) {
        mods.enemyHpDrainPct = Math.min(1, Math.max(0, Number(agg.enemyHpDrainPct) || 0));
        mods.enemyHpDrainNote = '血蚀印记';
      }
      /* 假如我直接赢（E17）：开战即让敌方生命归零（sim 的开局段结算）。 */
      if (agg.openKill) mods.openKill = 1;
      /* 按武器次数结算的两条（疾风先手 / 先发制人 / 闪亮登场）。 */
      if (agg.weaponFreeUses) mods.weaponFreeUses = agg.weaponFreeUses;
      if (agg.weaponBoostUses) {
        mods.weaponBoostUses = agg.weaponBoostUses;
        mods.weaponBoostPowerMul = agg.weaponBoostPowerMul || 0;
        mods.weaponBoostMustHit = agg.weaponBoostMustHit || 0;
        mods.weaponBoostReflectImmune = agg.weaponBoostReflectImmune || 0;
        mods.weaponBoostFatigueMul = agg.weaponBoostFatigueMul || 0;
      }
      if (agg.lowHpPowerMul || agg.lowHpAgilityMul || agg.lowHpSpeedMul || agg.lowHpFinalMul ||
          agg.lowHpTakenMul || agg.lowHpLifestealPct || agg.lowHpRegenPct) {
        if (agg.lowHpPowerMul) mods.lowHpPowerMul = agg.lowHpPowerMul;
        if (agg.lowHpFinalMul) mods.lowHpFinalMul = agg.lowHpFinalMul;
        if (agg.lowHpAgilityMul) mods.lowHpAgilityMul = agg.lowHpAgilityMul;
        if (agg.lowHpSpeedMul) mods.lowHpSpeedMul = agg.lowHpSpeedMul;
        if (agg.lowHpTakenMul) mods.lowHpTakenMul = Math.max(-0.9, agg.lowHpTakenMul);
        if (agg.lowHpLifestealPct) mods.lowHpLifestealPct = agg.lowHpLifestealPct;
        if (agg.lowHpRegenPct) { mods.lowHpRegenPct = agg.lowHpRegenPct; mods.lowHpRegenAt = agg.lowHpRegenAt || 0.5; }
        /* 统一阈值：所有低血效果共用一个 lowHpAt（没有显式值的来源按 0.35 兜底）。 */
        mods.lowHpAt = agg.lowHpAt || agg.lowHpRegenAt || 0.5;
      }
      /* 涅槃按「每层 N 次」发放：N = 涅槃层数（1 层 1 次、2 层 2 次）。
       * 本层已经用掉的次数记在 run.reviveUsed 上（换层自动从 0 重算）——
       * 所以叠到 2 层、这一层已经复活过一次时，这里只会再补 1 份。 */
      if (agg.revivePct) {
        const perLayer = Math.max(1, Math.floor(agg.reviveMax || 1));
        const used = (run.reviveLayer || 0) === run.layer ? Math.max(0, Math.floor(Number(run.reviveUsed) || 0)) : 0;
        const left = Math.max(0, perLayer - used);
        for (let i = 0; i < left; i++) {
          mods.deathSaves = (mods.deathSaves || []).concat([{ healPct: agg.revivePct, statMul: agg.reviveStatMul || 0, revive: 1 }]);
        }
      }
      if (agg.deathSaves.length) mods.deathSaves = (mods.deathSaves || []).concat(agg.deathSaves);
      for (const [k, v] of Object.entries(envModsMine || {})) if (v) mods[k] = (Number(mods[k]) || 0) + v;
      me.mods = mods;
      /* ============================================================
       * 「巡逻」魔王：**开战时照抄玩家的面板**（2026-10 第六十二批 + 第七十七批用户口径）。
       * 放在 adjustMe 的**最后一步** —— 这时 me 已经把装备、增益、烙印、环境、削弱全算完，
       * 复制到的就是玩家第一回合开始时的状态。
       *
       * 【第七十七批 用户口径】魔王**不实际拥有玩家的增益** —— 只把「进场那一刻的面板定格」：
       *   · 力 / 敏 / 速 / 血：直接照抄。**各种乘区已经在里面了**（adjustMe 把力量乘区、敏捷乘区、
       *     速度乘区、生命乘区、终乘烙印、环境加成…全都乘进了 me.power / me.agility / me.speed / me.maxHp），
       *     所以「复制乘区」不需要再单独做什么 —— 再抄一遍 mods 反而会重复计算；
       *   · 裸属性 baseStats：一起照抄（真·色诱之术脱光装备后要用它回到裸面板）；
       *   · 装备词条 effects / 师父等级 masterLevel：属于面板与账号进度，照抄；
       *   · **不给它 `mods` 包，也不抄 healMul / skillBoost** —— 那三样都是**局内增益**派生的
       *     （涅槃的 deathSaves、后发制人的 catchUpPct、越战越勇的 roundStatPct、治疗烙印的 healMul、
       *     秘技通神的 skillBoost…），用户明确要求这些**不在魔王身上生效**。
       *     （第七十四批原来是把整套 mods 深拷贝过去 = 完全镜像，现已按新口径收回。）
       *   · 魔王自己那套**橙色狂战甲**照旧走 setFx 独立通道（`applyPatrolSet`）—— 那是它的装备收益。
       * 行为本身天然一致：魔王没有 npcType、也没有固定出招循环（pattern 为空），
       * sim 走的就是 `playerLikeAction` —— 与玩家同一套选招逻辑（武器 45% / 技能 35% / 普攻 20%）。
       * x0 层那一场（entry.x00，即「觐见魔王」）**额外**吃「玩家此前上交过的增益」的快照加成
       * （见 applyPatrolTollToFoe）—— 用户口径：只有魔王的 boss 战才加这一份。
       * ============================================================ */
      if (built.foe && built.foe.patrol) {
        const foe = built.foe;
        foe.power = Math.max(1, Math.round(Number(me.power) || 1));
        foe.agility = Math.max(1, Math.round(Number(me.agility) || 1));
        foe.speed = Math.max(1, Math.round(Number(me.speed) || 1));
        foe.hp = Math.max(1, Math.round(Number(me.hp) || 1));
        foe.maxHp = Math.max(1, Math.round(Number(me.maxHp) || foe.hp));
        if (me.baseStats) foe.baseStats = Object.assign({}, me.baseStats);
        if (me.effects) foe.effects = Object.assign({}, me.effects);
        foe.masterLevel = Math.max(0, Number(me.masterLevel) || 0);
        /* 魔王的**增益包**要从零开始：它不持有玩家的 buff（第七十七批用户口径），
         * 只拿自己的那一份 —— 见下面的 applyDemonLordLives（x00 的两件涅槃plus + 两件破碎终焉烙印）。 */
        delete foe.mods;
        delete foe.healMul;
        delete foe.skillBoost;
        /* 狂战甲的属性部分会被上面那次照抄覆盖掉，所以复制完再落一次（幂等：setFx 是覆盖写）。
         * 等级用 foe.level（buildFoe 按层算出来的敌人等级）—— 狂战套是 50 级档，
         * 而「巡逻」只在第 41 层起出现，那时 endlessLevel 已经封顶 70，天然满足。 */
        applyPatrolSet(foe, foe.level);
        foe.copiedFromPlayer = { power: foe.power, agility: foe.agility,
          speed: foe.speed, hp: foe.hp, maxHp: foe.maxHp };
        if (entry.x00) {
          applyPatrolTollToFoe(run, foe);
          /* x00「最后的魔王」的固定持有（两件涅槃plus + 两件破碎终焉烙印）放在**最后**：
           * 终乘要把前面「面板复制 + 上交增益」的结果一起放大。 */
          applyDemonLordLives(foe);
        }
      }
    };
    run.attempt = mode + '_' + Date.now() + '_' + (++attemptSeq);
    snapshotBattle(run);
    save();
    const toasts = takeAchievementToasts(run);   // 例如「超凡入圣」是在这之前算出来的
    return { ok: true, token: run.attempt, entry, info: entryInfo(entry, run.layer, isLastBattle), foe: built.foe,
      elite: built.elite, region: regionOf(entry), hpRatio: run.carry, adjustMe,
      effMaxHp: () => Math.max(1, Number(run.lastMaxHp) || Math.max(1, Number(built.foe && built.foe.hp) || 1)),
      debuffs: (run.debuffs || []).slice(), achievements: toasts,
      battleNo: run.idx + 1, battleCount: run.plan.length, layer: run.layer };
  }
  /** 战斗播放是否允许「跳过」（纯函数，UI 与测试共用）。
   *  无尽塔 20 层起（用户口径 2026-10：由 30 层下调）—— 到这一阶段一场要打很久。
   *  跳过不影响胜负与收益：回合流本来就由 Sim.simulate 一次算完，跳过只是不播动画；
   *  塔内战斗也关了飘物（collectDrops:false），不会因为跳过丢掉落。 */
  function skipPlaybackAllowed(mode, layer) {
    if (mode !== 'endless') return false;
    const from = Math.max(1, Math.floor(Number(D().ENDLESS_SKIP_LAYER) || 20));
    return Math.max(1, Math.floor(Number(layer) || 1)) >= from;
  }

  /** 手上有没有铸币（以及有没有可用的快照）。 */
  function canRetry(run) {
    return !!(run && run.mode === 'endless' && Number(run.retryToken) > 0 && run.retrySnap);
  }
  function retryBattle() {
    const e = endless(), run = e.run;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    if (!(Number(run.retryToken) > 0)) return { ok: false, msg: '没有铸币（可在试炼商店购买）。' };
    if (!run.retrySnap) return { ok: false, msg: '没有可回滚的战斗记录。' };
    const snap = cloneRun(run.retrySnap);
    snap.retryToken = Number(run.retryToken) - 1;     // 消耗 1 枚
    snap.retrySnap = null;                           // 回滚后旧快照作废，下一场会重新拍
    delete snap.attempt;
    e.run = snap;
    save();
    return { ok: true, layer: snap.layer, left: snap.retryToken };
  }
  /** 播放中断：令牌作废，进度保留（不重复扣书、不掉层）。 */
  function interruptBattle(mode, token) {
    const run = mode === 'tower' ? tower().run : endless().run;
    if (!run || run.attempt !== token) return false;
    delete run.attempt;
    save();
    return true;
  }

  /* ============================================================
   * 【T9】战斗结算 —— reportBattle / 失败与弃权结算
   * ============================================================ */

  /**
   * 三侠的招牌技给玩家留削弱：扫一遍这场战斗的事件，只有大招真的放出来了才生效。
   * 打得够快 / 打断它，就能整层规避 —— 这是本层的第一层对策。
   */
  /* 削弱要「一眼看出是谁给的」：把来源大侠的名字与颜色一起写进 debuff，
   * 战斗 HUD 的胶囊和选 buff 页的削弱卡片都用这套数据渲染。 */
  const HERO_SOURCE = Object.freeze({
    tl: { hero: '螳螂大侠', short: '螳螂', color: '#2f7a52' },
    xh: { hero: '仙鹤大侠', short: '仙鹤', color: '#2f5f9e' },
    xm: { hero: '熊猫大侠', short: '熊猫', color: '#8a5a20' },
  });
  /** 这一场报告里，某位大侠的特色大招**实际打到玩家**的次数（用户口径，2026-10）。
   *  只认同时满足下面几条的那几次：
   *    · `ultName` 对上这位大侠的大招；· 没被**闪避**（r.dodge）；
   *    · 没被**弹反**（r.jueDui / r.reboundHurt：绝对防御这类把伤害弹回去的）；
   *    · 没被**装死**混过去（r.fakeDie）；· 真的造成了伤害（`dmg > 0`）——
   *      护盾全吸收 / 格挡到 0 的那次 dmg 是 0，自然也进不来。 */
  function ultHitsOf(result, def) {
    if (!result || !Array.isArray(result.rounds) || !def) return 0;
    let n = 0;
    for (const r of result.rounds) {
      if (!r || r.ultName !== def.ult) continue;
      if (r.dodge || r.jueDui || r.reboundHurt || r.fakeDie) continue;
      if (!(Number(r.dmg) > 0)) continue;
      n++;
    }
    return n;
  }
  /** 三侠大招留下的「本层削弱」：**按实际命中次数逐次累加**，数值随机浮动并各有本层上限。
   *
   *  · 螳螂「重伤」：每次 −pctRange 的生命上限，本层累计最多 −capPct（多层相乘后不超过这个总量）；
   *  · 仙鹤「战吼」：每次随机削一项属性（力/敏/速各摇一次），本层最多 maxTimes 次；
   *  · 熊猫「压制」：每次随机锁一把武器 / 一个技能（**不与已锁的重复**），本层最多 maxTimes 个。
   *  入参 `result` 是这一场的战斗报告（界面 onEnd 已经把它传进来），
   *  所以「被闪避/弹反/格挡掉的大招不算」这件事是**按真实战斗过程**判定的。 */
  function applyHeroDebuff(run, entry, result) {
    if (!entry || entry.kind !== 'hero') return null;
    const def = D().HERO_DEBUFF[entry.anim];
    if (!def) return null;
    const hits = ultHitsOf(result, def);
    if (hits <= 0) return null;
    if (!Array.isArray(run.debuffs)) run.debuffs = [];
    const src = HERO_SOURCE[entry.anim] || { hero: '大侠', short: '大侠', color: '#7a4a18' };
    const layer = Math.max(1, Math.floor(Number(run.layer) || 1));
    const mine = run.debuffs.filter((d) => d && d.from === entry.anim);
    const range = Array.isArray(def.pctRange) && def.pctRange.length === 2
      ? [Math.max(0, Number(def.pctRange[0]) || 0), Math.max(0, Number(def.pctRange[1]) || 0)]
      : [Math.max(0, Number(def.pct) || 0), Math.max(0, Number(def.pct) || 0)];
    const rollPct = () => range[0] + Math.random() * Math.max(0, range[1] - range[0]);
    const maxTimes = Math.max(1, Math.floor(Number(def.maxTimes) || 1));
    const added = [];
    for (let i = 0; i < hits; i++) {
      const soFar = mine.length + added.length;
      let d = null;
      if (def.kind === 'stat') {
        if (soFar >= maxTimes) break;                       // 本层最多削 maxTimes 次
        const stat = ['power', 'agility', 'speed'][Math.floor(Math.random() * 3)];
        const label = { power: '力量', agility: '敏捷', speed: '速度' }[stat];
        const pct = rollPct();
        d = { from: entry.anim, hero: src.hero, short: src.short, color: src.color,
          kind: 'stat', stat, pct, name: def.name, times: soFar + 1,
          text: label + ' −' + Math.round(pct * 100) + '%' };
      } else if (def.kind === 'lock') {
        if (soFar >= maxTimes) break;                       // 本层最多锁 maxTimes 个
        /* 随机锁一个武技：按玩家当前拥有的武技合计里抽（师父驾到 13 不占位，排除），
         * 且**跳过已经被这套削弱锁住的那些**（同一件锁两次没有意义）。 */
        const locked = mine.concat(added).map((x) => x && x.what + ':' + x.id);
        const st = S(), pool = [];
        const nameOf = (map, id) => { const dd = map && map.getValue(id); return dd ? dd.name : ('#' + id); };
        for (const raw of st.weapons || []) {
          const id = Number(String(raw).split(':')[0]);
          if (locked.indexOf('weapon:' + id) >= 0) continue;
          pool.push({ what: 'weapon', id, name: nameOf(weaponsMap, id) });
        }
        for (const raw of st.skills || []) {
          const id = Number(String(raw).split(':')[0]);
          if (id === 13) continue;                          // 师父驾到不占位
          if (locked.indexOf('skill:' + id) >= 0) continue;
          pool.push({ what: 'skill', id, name: nameOf(skillsMap, id) });
        }
        if (!pool.length) break;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        d = { from: entry.anim, hero: src.hero, short: src.short, color: src.color,
          kind: 'lock', what: pick.what, id: pick.id, name: def.name, times: soFar + 1,
          text: '锁住' + (pick.what === 'weapon' ? '武器' : '技能') + '「' + pick.name + '」' };
      } else {
        /* 生命上限：按**累计削减总量**封顶（多层是相乘的，所以要按 1−Π(1−p) 算）。
         * 余量不足 1 个百分点就不再落新条目了 —— 否则会堆出一串 0.3% / 0.04% 的废条目。 */
        const cap = Math.max(0, Number(def.capPct) || 0);
        const used = 1 - mine.concat(added).reduce((a, x) => a * (1 - (Number(x.pct) || 0)), 1);
        const left = cap - used;
        if (left < 0.01) break;                             // 本层已经削到上限（或只差不到 1%）
        const pct = Math.min(left, rollPct());
        d = { from: entry.anim, hero: src.hero, short: src.short, color: src.color,
          kind: 'maxHp', pct, name: def.name, times: soFar + 1,
          text: '生命上限 −' + Math.round(pct * 100) + '%' };
      }
      if (!d) break;
      /* 记下是哪一层吃的削弱（正常流程里进新层就会被 advanceLayer 清掉；
       * 这个字段主要用于存档校对与调试台观察）。 */
      d.layer = layer;
      run.debuffs.push(d);
      added.push(d);
    }
    /* 返回**这一场新落下的最后一条**（界面拿它飘字 / 存档）；一条都没落下就返回 null。 */
    return added.length ? added[added.length - 1] : null;
  }

  function reportBattle(mode, token, win, hpAbs, effMaxHp, result) {
    const box = mode === 'tower' ? tower() : endless();
    const run = box.run;
    if (!run || run.attempt !== token) return { ok: false };
    delete run.attempt;
    /* 「上一场战斗赚了多少试炼币」：每场先清零 —— 输掉的那一场自然是 0，
     * 赢了再由下面的战利品结算写回真实增量（主界面右上角就标这个数）。 */
    run.lastCoinsGained = 0;
    const entry = run.plan[run.idx];
    const isElite = isEliteEntry(entry, run.layer, run.idx === run.plan.length - 1);   // x10 塔顶 / 每 5 层最后一战
    if (!win) {
      /* 「巡逻」失败（2026-10 用户口径）：**不走失败结算** ——
       * 不扣体力/不算失败、血量继承上一场结束后的血量（run.hpAbs 原样保留）、
       * 本场也不计叠层与试炼币收益；改为进入「收缴」阶段：玩家必须交出一个
       * **本局最高稀有度**的增益（见 patrolTollCandidates / payPatrolToll）。
       *
       * ⚠ **x00 层的「觐见魔王」是例外**（用户口径 2026-10 第六十六批）：那一场输了**照常结算失败** ——
       * 它是爬塔的终点仪式，不是路上偶遇的巡逻；`entry.x00 === true`（audience === 'king'）时
       * 直接走到下面的正常失败结算，不给收缴这条路。 */
      if (entry && entry.kind === 'patrol' && !entry.x00) {
        run.phase = 'patrolToll';
        run.patrolTollAt = { layer: run.layer, idx: run.idx };
        logBuff(run, 'patrol', 'lose', { detail: '巡逻失败：需要上交一个最高稀有度的增益' });
        save();
        return { ok: true, win: false, patrol: true, phase: 'patrolToll', entryKind: entry.kind,
          msg: '巡逻失败：交出一个最高稀有度的增益即可继续（血量与增益层数都保留）' };
      }
      const fail = mode === 'tower' ? towerFail(run) : endlessFail(run);
      if (fail && fail.retryable) { fail.battleNo = run.idx + 1; fail.battleCount = run.plan.length; }
      return fail;
    }
    const rawHp = Math.max(1, Math.round(Number(hpAbs) || 0));
    const endCap = Math.max(1, Math.round(Number(effMaxHp) || 0));
    /* ============================================================
     * 全局实际血量计数器：**被上限压下来的部分要真正写进去**。
     *
     * 战斗中的上限可能因为「空血上限」（浴血重生 / 濒死觉悟 / 血之契约）等临时加成
     * 远高于局外上限。如果直接把战斗内的剩余血量原样记进计数器，那份「多出来的血」
     * 就会跟着进场 —— 虽然局外显示按上限裁过，但下一场又被放出来。
     * 这里按**局外口径的上限**裁剪后再写入，计数器就与局外所见完全一致。
     *
     * 注意：这只影响「战斗结束时剩下的血」。战斗**之中/开战**由其它 buff 回复的血
     * （开战回血 / 跨层回血 / 精英回血 / 每回合回血）是**另外累加**到计数器上的，
     * 不受这里影响。
     * ============================================================ */
    const outCap = currentMaxHp(run);            // 局外口径上限（不含战斗内临时加成）
    const endHp = (outCap > 0) ? Math.min(rawHp, outCap) : rawHp;
    run.hpAbs = endHp;
    run.carry = clamp01(endHp / endCap);
    /* 本场参考上限：本场结束时记下的真实 maxHp（「回 X% 最大生命」都按它换算）。 */
    const refMax = Math.max(1, Number(run.refMaxHp) || Number(run.lastMaxHp) || endCap);
    const battleLayer = Math.max(1, Math.floor(Number(run.layer) || 1));
    /* 同理记下**本场的层内序号** —— run.idx++ 之后它已经指向下一场了。 */
    const battleIdx = Math.max(0, Math.floor(Number(run.idx) || 0));
    const out = { ok: true, win: true, elite: isElite, entryKind: entry.kind };
    if (stacksOf(run, 'C14') && result && Array.isArray(result.rounds)) {
      const revives = result.rounds.filter((r) => r.deathSave && r.revive).length;
      if (revives > 0) {
        if ((run.reviveLayer || 0) !== run.layer) { run.reviveLayer = run.layer; run.reviveUsed = 0; }
        run.reviveUsed = Math.max(0, Math.floor(Number(run.reviveUsed) || 0)) + revives;
      }
    }
    /* 隐藏成就「死而复生」：统计本场触发了几次免死/复活（不死鸟、金蝉脱壳都算），
     * 累计到档位就加分 —— 分档递增、12 次封顶（防「故意挨打刷分」）。 */
    if (mode === 'endless' && result && Array.isArray(result.rounds)) {
      const saves = result.rounds.filter((r) => r.deathSave).length;
      if (saves > 0) {
        run.deathSaves = Math.max(0, Math.floor(Number(run.deathSaves) || 0)) + saves;
        const tier = D().reviveScoreAt(run.deathSaves);
        /* 用 `>` 比较：只补发「比已发过的更高档」的那部分，跳档也不会重复发放。 */
        if (tier > (Number(run.reviveTierPaid) || 0)) {
          const gained = tier - (Number(run.reviveTierPaid) || 0);
          run.reviveTierPaid = tier;
          run.reviveCount = (Number(run.reviveCount) || 0) + 1;
          addScore(run, gained, '隐藏成就·死而复生（累计 ' + run.deathSaves + ' 次）');
          /* 成就上标「这一档总共值多少」（不是本次边际增量），这样展示在结算页
           * 可以直接相加得到成就总收益：30 + 45 + 60 + 90 = 225。 */
          const item = markAchievement(run, 'revive:' + run.reviveCount,
            '死而复生 · 累计 ' + run.deathSaves + ' 次', tier);
          out.achievement = item || null;
          out.reviveScore = gained;
        }
      }
    }
    const debuff = applyHeroDebuff(run, entry, result);
    if (debuff) { out.debuff = debuff; save(); }
    if (mode === 'tower') {
      healAbs(run, D().AUTO_HEAL_PCT, refMax);
      const shares = D().towerGoldShares(run.layer, run.plan.length);
      run.pot += shares[run.idx];
      out.potGold = run.pot;
    } else {
      const g = globalMul(run);
      addScore(run, D().SCORE.battle, '战斗胜利');
      /* 试炼币的三个乘区**分开算**（界面提示要逐个写出来）：战利品（E05/E06/E07）/
       * 淘金烙印（C53，含损毁档）/ 贪婪裂隙（环境，按实例摇出来的值）。 */
      const coinBoostPct = Math.max(0, runModTotal(run, 'coinBoostPct') || 0);
      const coinFragilePct = fragileCoinBonus(run);
      let coinGreedPct = 0;
      /* 贪婪裂隙：我方试炼币按实例上摇出来的比例加成（被反弹/被剥夺时就不给）。
       * 以前这里写死 +50%，与实例数值无关。 */
      {
        const fx = envEffective(run);
        if (fx.mine.includes('greed')) coinGreedPct = Math.max(0, envModTotal(run, 'coinBonus', { mineOnly: true }));
      }
      const coinMul = 1 + coinBoostPct + coinFragilePct + coinGreedPct;
      /* ============================================================
       * 【2026-10 同名逐条】成长进度**同时**记进两处：
       *   · `row.grow` —— 这一栏自己的账本（卖出 / 交换时精确扣它那一份）；
       *   · run 级字段 —— 各栏求和的读取口径（聚合 / 界面 / 探针不受影响）。
       * ============================================================ */
      const eachRow = (fn) => {
        for (const row of (run.permanent || [])) {
          const def = row && D().BUFF_BY_ID[row.id];
          if (def) fn(row, def, Math.max(1, Math.floor(Number(row.stacks) || 1)));
        }
      };
      eachRow((row, def, st) => {
        const m = def.mods || {};
        if (m.sellGrowthPerWin) addGrow(run, row, 'sellBonus', m.sellGrowthPerWin * st * g);
        if (m.winMaxHpFlat) addGrow(run, row, 'winHpFlat', m.winMaxHpFlat * st * g);
        /* 铜墙铁壁（减伤成长）：每胜利一场累计，封顶见 winTakenMulCap（按该栏层数）。 */
        if (m.winTakenMulPct) {
          const cap = (Number(m.winTakenMulCap) || 0.25) * st;
          const cur = growOf(row, 'winTakenMul');
          const next = Math.min(cap, cur + (Number(m.winTakenMulPct) || 0.01) * st);
          addGrow(run, row, 'winTakenMul', next - cur);
        }
        /* 登顶者（可叠层）：第 10 层起每胜一场，本局固定 +1 力/敏/速 × 层数。 */
        if (m.winStatAfter10 && battleLayer >= 10) {
          const per = Math.max(0, Number(m.winStatAfter10) || 1) * st;
          addGrow(run, row, 'winStatPower', per);
          addGrow(run, row, 'winStatAgility', per);
          addGrow(run, row, 'winStatSpeed', per);
        }
        /* 猎杀时刻（C06）：每杀一个敌人攻击 +2%，上限 +30% × 层数。 */
        if (m.killPowerPct) {
          const cap = (m.killPowerCap || 0.40) * st * g;
          const cur = growOf(row, 'killPower');
          const next = Math.min(cap, cur + (m.killPowerPct || 0.02) * st * g);
          addGrow(run, row, 'killPower', next - cur);
        }
        /* 吞噬成长（C07）：每胜一场生命上限 +2%，上限 +30% × 层数。 */
        if (m.winMaxHpPct) {
          const cap = (m.winMaxHpCap || 0.30) * st * g;
          const cur = growOf(row, 'winMaxHp');
          const next = Math.min(cap, cur + (m.winMaxHpPct || 0.02) * st * g);
          addGrow(run, row, 'winMaxHp', next - cur);
        }
      });
      /* 「本场战斗赚了多少试炼币」——无尽塔主界面右上角要显示这个增量。
       * 先记下战前余额，等这一场的所有进账（基础 + 精英）都算完再取差值。
       * 基础按**本场所在层**分段（1-5 → 5、6-10 → 6、11-15 → 7、16 起 → 8）；
       * 精英从「固定 +N」改成**倍率**，与上面那些乘区相乘。 */
      const coinsBeforeBattle = Math.max(0, Number(run.coins) || 0);
      const coinBase = D().coinBattleBase(battleLayer);
      const eliteMul = isElite ? Math.max(1, Number(D().COINS.eliteMul) || 3) : 1;
      /* 「巡逻」胜利的试炼币再 ×winCoinMul（默认 5）。 */
      const patrolMul = (entry.kind === 'patrol') ? Math.max(1, Number(D().PATROL.winCoinMul) || 1) : 1;
      run.coins += Math.round(coinBase * coinMul * eliteMul * patrolMul);
      /* 界面提示（试炼币那一格的悬停）要写「基础 x × 每个乘区」，所以把本场的账留一份在 run 上。 */
      run.lastCoinBreak = {
        base: coinBase, layer: battleLayer, band: D().coinBattleTierLabel(battleLayer),
        elite: !!isElite, eliteMul,
        boosts: [
          { name: '战利品', pct: coinBoostPct },
          { name: '淘金烙印', pct: coinFragilePct },
          { name: '贪婪裂隙', pct: coinGreedPct },
        ].filter((b) => b.pct > 0),
      };
      const c11 = stacksOf(run, 'C11');
      if (c11) healAbs(run, 0.03 * c11 * g * healBonusMul(run), refMax);
      if (isElite) {
        addScore(run, D().SCORE.elite, '击败精英');
        const c13 = stacksOf(run, 'C13');
        if (c13) {
          healAbs(run, D().BUFF_BY_ID.C13.mods.eliteHealAfter * g * healBonusMul(run), refMax);
          /* 2026-10 增强（任务5）：击败精英**再 +10% 生命上限**（粘性，与其它永久生命加成同口径）。 */
          const addHp = Number(D().BUFF_BY_ID.C13.mods.eliteMaxHpAfter) || 0;
          if (addHp > 0) run.hpBonus = Math.max(0, Number(run.hpBonus) || 0) + addHp * c13 * g;
        }
      }
    /* 本场战斗的试炼币增量（界面右上角标在「试炼币」旁边；下一场会被刷新）。 */
    run.lastCoinsGained = Math.max(0, Math.round((Number(run.coins) || 0) - coinsBeforeBattle));
    out.coinsGained = run.lastCoinsGained;
    out.score = run.score; out.coins = run.coins;
    }
    /* 幻影回响（三侠战）：胜利后按概率**立刻再战同一场**。
     * 做法是把层内序号回退一格 —— 这样：
     *   · 下一场取到的还是同一个 entry（三侠由 heroOrder(layer, salt) 固定，所以是同一场）
     *   · 猎杀时刻 / 吞噬成长 / 以战养战 / 登顶者 / 战斗续航（开战回血）等**战斗叠层**增益
     *     天然把这一场也算进去（不用逐个特殊处理）
     *   · 层号不变，所以不会触发跨层回血，也不会提前进下一层 */
    const echoP = (entry.kind === 'hero') ? echoRepeatChance(run) : 0;
    run.idx++;
    /* E01 立即进货 / E16 铸币商队 / E15 时间回廊：要在**扣限次之前**取一次 —— 它们的限次
     * 就消耗在这一场，扣完条目会被移除，之后就算不出「本该开一次店 / 本该重开本层」了。 */
    const shopCreditPct = activeShopCredit(run);
    const mintCredit = activePostBattleMintShop(run);
    const layerRestart = hasActiveLayerRestart(run);
    consumeLimited(run);
    const brokenFragile = rollFragileBuffs(run);
    if (brokenFragile.length) out.fragileBroken = brokenFragile;
    /* 环境词缀的「剩余场数」与「战后补抽」必须**每场都推进** ——
     * 包括整层最后一场（原来这行在后面，整层最后一场会提前 return 跳过推进，
     * 于是环境的剩余场数会少算一场）。放在回响判定**之前**，重复的那一场
     * 也会照常消耗环境场数。 */
    rollEnvAfterBattle(run);
    /* 时间回廊（E15）：这一场打完就从**本层第 1 场**重新开始（「夹层」）。
     * 放在回响判定**之前**：重开本层比「再打一遍同一场」大，不该被回响吃掉这一场；
     * 也**不经过 layerClear** —— 「那一场是本层最后一场也照样回到本层开头」（用户口径），
     * 所以层通关奖励、里程碑、每 5 层的结算商店这一场都不会发。 */
    if (layerRestart) {
      const restartAt = restartLayer(run);
      out.layerRestart = { layer: restartAt, battleNo: battleIdx + 1, battleCount: run.plan.length };
      /* 同一场如果还挂着 E01「立即进货」/ E16「铸币商队」：店**照开**（限次已经扣掉了，
       * 不开就等于白扣）—— 关掉店之后正好从本层第 1 场继续。铸币商店优先（顶掉试炼商店）。
       * 【100 层循环】整百层不开店：这一层连「白扣一次限次」都不成立 —— 限次压根没被用掉。 */
      if (!D().layerNoShop(run.layer)) {
        if (mintCredit) {
          openMintShop(run, battleLayer, { noGroup: true, byBuff: true });
          out.phase = 'shop';
          out.mintShop = true;
        } else if (shopCreditPct > 0) {
          run.shop = makeShop(run, shopCreditPct);
          if (run.shop) {
            run.shop.postBattle = true;
            run.shop.byBuff = true;      // E01「立即进货」开的店（剧情用，见【U18】restock）
            run.phase = 'shop';
            out.phase = 'shop';
            out.postBattleShop = true;
          }
        }
      }
      save();
      return out;
    }
    /* 回响判定放在限次扣数 / 环境推进 / 烙印判定**之后**：重复的那一场
     * 应当照常消耗一次限次（不然「限次 10 场」会因为回响白打）。
     * 它只在**未通关本层**时才可能发生。 */
    /* 「这一场」用层内序号标识：回响再战时 idx 会被回退成同一个值，
     * 所以同一个 idx 就是同一场 —— 一场战斗至多触发一次。
     * （用递增的「战斗实例号」是不行的：再战也要经过 nextBattle，实例号会跟着涨。） */
    const echoBattleKey = battleLayer * 1000 + battleIdx;
    if (echoP > 0 && run.idx < run.plan.length &&
        Number(run.repeatAt) !== echoBattleKey &&        // 本场还没触发过
        Math.random() < echoP) {
      run.idx--;                                  // 回退一格 → 下一场还是这一场
      run.repeatAt = echoBattleKey;               // 记下「这一场已经触发过」
      out.repeat = { chance: echoP, name: (echoDef() || {}).name || '幻影回响', layer: run.layer, battleNo: run.idx + 1 };
      run.repeatCount = Math.max(0, Number(run.repeatCount) || 0) + 1;
      save();
      return out;
    }
    /* 铸币商店（5 层之后的 x2/x3/x4 与 x7/x8/x9 层）：每场战斗结束后 5% 概率刷出。
     * 判定放在回响之后 —— 回响会把同一场再打一遍并提前 return，不该为同一场摇两次；
     * 这一场如果已经由 E01「立即进货」/ E16「铸币商队」开了店就顺延（一次战斗不开两家店），
     * 而且**不记组号** → 这一组里后面那几场还有机会刷出来。 */
    const mintRoll = (mode === 'endless' && shopCreditPct <= 0 && !mintCredit && !noMintShop) && rollMintShop(run, battleLayer);
    if (run.idx >= run.plan.length) {
      /* E16「铸币商队」：本场本该开出的普通商店统统由铸币商店顶上 ——
       * x5 层的结算商店交给 layerClear 直接开成「结算去向」的铸币商店（boundary），
       * 非 x5 层则和自然刷出的铸币商店一样，在层推进之后补上。 */
      const cleared = layerClear(mode, run, out, shopCreditPct, mintCredit);
      if (mintCredit && !run.shop) {
        openMintShop(run, battleLayer, { noGroup: true, byBuff: true });
        out.phase = 'shop';
        out.mintShop = true;
        save();
      } else if (mintRoll && !run.shop) {
        /* 整层最后一场同样参与判定：layerClear 已经把层推进（x5 层还会开结算商店），
         * 所以铸币商店在它之后挂上；已经有别的店就让位。 */
        openMintShop(run, battleLayer);
        out.phase = 'shop';
        out.mintShop = true;
        save();
      }
      /* E01「立即进货」在**整层最后一场**也必须开出来。
       * 修 bug：原来这一支直接 `return cleared`，把「立即开店」整个跳过了 ——
       * 限次已经在这一场扣掉（`consumeLimited`），店却没开，等于白扣一次。
       * 现在的口径：
       *   · 非 x5 层：layerClear 只推进层号、不开店 → 这里按「战后临时小店」开出来
       *     （`postBattle: true`，关掉后回到新层的战斗流程）。
       *   · x5 层：layerClear 已经开了**结算商店**，并且已经吃到了 E01 的折扣
       *     （`makeShop(run, shopCreditPct)`）→ 不再叠开第二家店，E01 的价值以折扣兑现。
       *   · 同场挂着 E16 时：铸币商店已经顶上，E01 的那家不再叠开（一次战斗只开一家店）。 */
      if (mode === 'endless' && shopCreditPct > 0 && !mintCredit && !run.shop) {
        run.shop = makeShop(run, shopCreditPct);
        run.shop.postBattle = true;
        run.shop.byBuff = true;          // E01「立即进货」开的店
        run.phase = 'shop';
        out.phase = 'shop';
        out.postBattleShop = true;
        save();
      }
      return cleared;
    }
    /* 战后临时小店（层还没打完）：E16「铸币商队」优先 —— 它顶掉 E01 的试炼商店；
     * 没有 E16 时才轮到 E01「立即进货」，最后才是自然刷出的铸币商店。
     * 【100 层循环】整百层（觐见魔王）**一次店都不开**：这一整段直接跳过 ——
     * 既不挂 phase（否则界面会停在「进入商店」而店里什么都没有），也不折腾限次。 */
    if (mode === 'endless' && !D().layerNoShop(run.layer)) {
      if (mintCredit) {
        openMintShop(run, battleLayer, { noGroup: true, byBuff: true });
        out.phase = 'shop';
        out.mintShop = true;
      } else if (shopCreditPct > 0) {
        run.shop = makeShop(run, shopCreditPct);
        /* 标记「这家店是打完这一场临时开的」——关店后要**回去继续打**，
         * 而不是去结算点（那是「每 5 层」的商店才有的下一步）。 */
        if (run.shop) {
          run.shop.postBattle = true;
          run.shop.byBuff = true;        // E01「立即进货」开的店
          run.phase = 'shop';
          out.phase = 'shop';
          out.postBattleShop = true;
        }
      } else if (mintRoll) {
        /* 铸币商店也是「战后临时小店」，关掉后回去继续打这一层（与 E01 同一去向）。 */
        openMintShop(run, battleLayer);
        out.phase = 'shop';
        out.mintShop = true;
      }
    }
    const won = run.idx, len = run.plan.length;
    const choiceAfter = 3;
    const extraChoice = len === 5;
    /* 「巡逻」胜利（2026-10 第六十二批用户口径）：立刻给一次**传奇增益**奖励
     *（默认三选一，吃抉择扩充；可获得的传奇不够时给几张算几张）。 */
    if (entry.kind === 'patrol') {
      const n = grantPatrolLegendary(run);
      out.patrolReward = { legendaries: n, coinMul: Math.max(1, Number(D().PATROL.winCoinMul) || 1) };
    }
    if (won === choiceAfter || (extraChoice && won === 4)) run.choices = rollChoices(mode, run);
    out.achievements = takeAchievementToasts(run);
    out.choices = run.choices;
    out.permanent = (run.permanent || []).length;
    out.limited = (run.limited || []).map((b) => ({ id: b.id, uses: b.uses, on: b.on }));
    save();
    return out;
  }
  function towerFail(run) {
    const layer = run.layer, pot = run.pot;
    run.failedAt = run.idx;
    // 挂在「第 4 场（题面）前」的那次选择：重试前可以重新选一张
    if (run.idx === 3 || (run.idx === 4 && run.plan.length === 5)) {
      run.limited = [];
      run.choices = rollChoices('tower', run);
    }
    tower().retry = { layer, date: State.localDate() };
    save();
    return { ok: true, win: false, layer, potGold: pot, retry: true,
      battleNo: run.idx + 1, battleCount: run.plan.length, choices: run.choices };
  }
  /** 结束本层：把已累积的 30% 当安慰奖发掉并清空本层。 */
  function giveUp(mode) {
    if (mode !== 'tower') return abandon(mode);
    const run = tower().run;
    if (!run || run.attempt) return { ok: false };
    const consolation = Math.floor(run.pot * D().TOWER_FAIL_CONSOLATION);
    if (consolation > 0) State.addGold(consolation);
    const out = { ok: true, layer: run.layer, potGold: run.pot, consolation };
    tower().run = null;
    tower().retry = null;
    save();
    return out;
  }
  /** 本层通关 / 放弃后清掉「免费重试」标记。 */
  function clearRetry() { if (tower().retry) { tower().retry = null; save(); } }
  function endlessFail(run) {
    if (canRetry(run)) {
      return { ok: true, win: false, retryable: true, layer: run.layer, battleNo: run.idx + 1,
        battleCount: run.plan.length, retryLeft: Number(run.retryToken) || 0, settled: false };
    }
    const out = { ok: true, win: false, layer: run.layer, score: run.score, bestLayer: run.bestLayer };
    return doFail(run, out);
  }
  /** 真正的失败结算（抽奖卷 + 分数 + 保底）。 */
  function doFail(run, out) {
    const e = endless();
    out = out || { ok: true, win: false, layer: run.layer, score: run.score, bestLayer: run.bestLayer };
    out.win = false;
    settleRunTickets(run, out);
    out.shield = false;
    out.settled = true;
    settleScore(run, out);
    // 保底：本局到达 ≥15 层后失败，送 1 次免费抽奖（每日限 1 次）
    const today = State.localDate();
    if (run.bestLayer >= D().ENDLESS_CONSOLATION_LAYER && e.shieldDate !== today) {
      e.shieldDate = today;
      S().lotteryFree = (S().lotteryFree || 0) + 1;
      out.shield = true;
    }
    e.run = null;
    save();
    return out;
  }
  /* ============================================================
   * 【T9b】结算预览 —— previewSettleTickets
   *
   * 「放弃本局」的弹窗要在**动手之前**把这次结算算给玩家看（用户口径 2026-10：
   * 「抽奖卷在玩家想要结算的时候，在放弃本局的弹出页面中计算」）。
   * 口径与真正发奖的 settleRunTickets **必须完全一致**，否则弹窗承诺的数字和到手的对不上 ——
   * 所以两边共用这一个纯函数：它只算不改状态，settleRunTickets 照它的结果记账发奖。
   * ============================================================ */
  function previewSettleTickets(run) {
    const layerTickets = Math.max(0, Math.floor(Number(D().endlessTickets(run && run.layer)) || 0));
    const mint = Math.max(0, Math.floor(Number(run && run.retryToken) || 0));
    /* 铸币 → 抽奖卷有上限（默认 10）：超出部分**不再转化**，随本局作废。 */
    const cap = Math.max(0, Math.floor(Number(D().TICKET_FROM_MINT_CAP) || 0));
    const mintConverted = Math.min(cap, mint);
    return {
      layer: Math.max(1, Math.floor(Number(run && run.layer) || 1)),
      layerTickets: layerTickets,
      mint: mint,
      mintCap: cap,
      mintConverted: mintConverted,
      mintForfeited: Math.max(0, mint - mintConverted),
      coins: Math.max(0, Math.floor(Number(run && run.coins) || 0)),   // 试炼币不折现，只报个数
      total: layerTickets + mintConverted,
    };
  }
  function settleRunTickets(run, out) {
    out = out || {};
    /* 计算与发奖共用同一份口径（见 previewSettleTickets）—— 别再各写一遍。 */
    const pv = previewSettleTickets(run);
    const layerTickets = pv.layerTickets, coins = pv.coins, mintCap = pv.mintCap;
    const retryTokens = pv.mint, retryConverted = pv.mintConverted, retryForfeited = pv.mintForfeited;
    const gain = pv.total;
    if (gain > 0) S().props[TICKET_PROP] = (S().props[TICKET_PROP] || 0) + gain;
    run.coins = 0;              // 试炼币随本局作废（不折现，只报个数给界面提示）
    run.retryToken = 0;
    run.retrySnap = null;
    out.layerTickets = layerTickets;
    out.retryLeft = retryTokens;
    out.forfeitCoins = coins;
    out.tickets = gain;
    out.ticketsTotal = S().props[TICKET_PROP] || 0;
    out.retryConverted = retryConverted;
    out.retryForfeited = retryForfeited;
    out.mintTicketCap = mintCap;
    if (retryConverted > 0) {
      out.retryMsg = retryConverted + ' 枚铸币已 1:1 兑换为 ' + retryConverted + ' 张抽奖卷'
        + (retryForfeited > 0 ? ('（兑换上限 ' + mintCap + ' 枚，超出 ' + retryForfeited + ' 枚不再转化）') : '');
    }
    return out;
  }
  /** 玩家在有铸币的情况下选择「放弃本局」→ 现在才真正结算失败。 */
  function declineRetry() {
    const e = endless(), run = e.run;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    const out = { ok: true, win: false, layer: run.layer, score: run.score, bestLayer: run.bestLayer };
    return doFail(run, out);
  }
  function settleScore(run, out) {
    const e = endless();
    e.best = Math.max(e.best, run.score);
    e.weekBest = Math.max(e.weekBest, run.score);
    e.bestLayer = Math.max(e.bestLayer, run.bestLayer);
    out.best = e.best; out.weekBest = e.weekBest;
  }

  /* ============================================================
   * 【T10】计分与隐藏成就 —— addScore / markAchievement / checkStatAchievements
   * 所有加分都走这里，顺带记录「本局成就」流水（供界面飘提示与结算展示）。
   * ============================================================ */
  function addScore(run, points, tag) {
    const pts = Math.max(0, Math.round(Number(points) || 0));
    if (!run || !pts) return 0;
    run.score = Math.max(0, Math.floor(Number(run.score) || 0)) + pts;
    if (tag) {
      run.scoreLog = Array.isArray(run.scoreLog) ? run.scoreLog : (run.scoreLog = []);
      run.scoreLog.push({ tag: tag, points: pts, layer: Math.max(1, Number(run.layer) || 1) });
      if (run.scoreLog.length > 60) run.scoreLog.splice(0, run.scoreLog.length - 60);
    }
    return pts;
  }
  /**
   * 记录一条隐藏成就。**同一 key 只记一次**，所以「可重复」是靠调用方给递增的 key
   * （死而复生用 revive:1 / revive:2…）实现的 —— 这样成就列表不会出现重复条目，
   * 同时每次触发都能得分。
   * 顺带推进「待界面显示」的队列（成就提示在 explore 的所有路径上统一取出）。
   */
  function markAchievement(run, key, name, points) {
    if (!run) return null;
    run.achievements = Array.isArray(run.achievements) ? run.achievements : (run.achievements = []);
    if (run.achievements.some((a) => a.key === key)) return null;
    const item = { key: key, name: name, points: Math.max(0, Math.round(Number(points) || 0)),
      layer: Math.max(1, Number(run.layer) || 1) };
    run.achievements.push(item);
    if (run.achievements.length > 40) run.achievements.splice(0, run.achievements.length - 40);
    run.pendingToasts = Array.isArray(run.pendingToasts) ? run.pendingToasts : (run.pendingToasts = []);
    run.pendingToasts.push(item);
    if (run.pendingToasts.length > 12) run.pendingToasts.splice(0, run.pendingToasts.length - 12);
    return item;
  }
  /** 取出所有待显示的成就提示（并清空队列）。界面在每次操作后调它。 */
  function takeAchievementToasts(run) {
    if (!run) return [];
    const list = Array.isArray(run.pendingToasts) ? run.pendingToasts.slice() : [];
    run.pendingToasts = [];
    return list;
  }
  /** 获取增益 → 计分（场间选择与商店购买都走这里）。 */
  function scoreBuffAcquire(run, buff) {
    if (!run || run.mode !== 'endless' || !buff) return 0;
    return addScore(run, D().buffScore(buff.rarity), '获得增益·' + buff.name);
  }
  function checkStatAchievements(run, agg) {
    if (!run || run.mode !== 'endless' || !agg) return [];
    const got = [];
    const peaks = run.statPeaks = Object.assign({}, run.statPeaks || {});
    const NAMES = { powerMul: '攻击', agilityMul: '敏捷', speedMul: '速度', maxHpMul: '生命上限' };
    for (const [field, label] of Object.entries(NAMES)) {
      const before = Math.max(0, Number(peaks[field]) || 0);
      const pct = Math.max(0, Number(agg[field]) || 0);
      if (pct > before) peaks[field] = pct;
      const after = Number(peaks[field]) || 0;
      for (const m of D().SCORE.statMilestones) {
        if (!(before < m.at && after >= m.at)) continue;
        const key = 'stat:' + field + ':' + Math.round(m.at * 100);
        const item = markAchievement(run, key, '超凡入圣 · ' + label + ' +' + Math.round(m.at * 100) + '%', m.points);
        if (item) { addScore(run, m.points, '隐藏成就·' + item.name); got.push(item); }
      }
    }
    return got;
  }
  /* ============================================================
   * 【T11】环境词缀（无尽塔） —— rollEnvAfterBattle / applyEnvTo
   * ============================================================ */

  function envList(run) { return Array.isArray(run.env) ? run.env : (run.env = []); }
  /** 「幻影回响」：**只**在三侠战生效的「胜利后立刻再战同一场」概率。
   *  多条同时生效时按 1-(1-p1)(1-p2) 合并；没有生效则返回 0。
   *  用 envEffective() 是为了让「无视环境」类 buff 也能正确地屏蔽它。 */
  function echoRepeatChance(run) {
    const TD = D(), fx = envEffective(run);
    /* fx.mine 已经按 maxStacks 去重过，所以这里天然只取「生效的那一份」。 */
    let miss = 1;
    for (const e of envList(run)) {
      if (fx.mine.indexOf(e.id) < 0) continue;
      const def = TD.ENDLESS_ENV_BY_ID[e.id];
      if (!def || !def.repeatOnly) continue;
      const p = Math.max(0, Math.min(1, Number(envValues(run, e).repeatChance) || 0));
      if (p > 0) miss *= (1 - p);
    }
    return 1 - miss;
  }
  /** 回响定义（供界面显示名字）。 */
  function echoDef() { return D().ENDLESS_ENV_BY_ID.echo; }
  function rollEnvAfterBattle(run) {
    const TD = D(), list = envList(run);
    /* 调试/测试开关：关掉环境抽取（有些断言只关心「层内计划」，不希望被
     * 「幻影回响」随机追加的那一场干扰）。同时清空当前环境。 */
    if (run.noEnvRoll === true) { list.length = 0; return; }
    /* 【100 层循环】环境词缀的适用场景只有 1~100 层：第 101 层起重来一轮，
     * 情况与第 1 层一样 —— **不再抽新的，手上的也一并清掉**。
     * 清理必须放在「扣剩余场数」之前，否则旧档里挂着的一条会继续掉场数、继续生效。 */
    if (!TD.envAllowed(run.layer)) { list.length = 0; return; }
    if (run.noEnvGain === true) { if (list.length) return; }
    for (let i = list.length - 1; i >= 0; i--) { list[i].left -= 1; if (list[i].left <= 0) list.splice(i, 1); }
    /* 【100 层循环】门槛一律比**轮内层号**（`canHaveEnv` 内部就是 `cycleLayer >= ENV_START_LAYER`）——
     * 第 101~104 层与第 1~4 层一样不给环境、105 层照旧抽。
     * ⚠ 别再写成 `run.layer < TD.ENV_START_LAYER`（绝对层号）：那样 101 层会被当成「早过了第 5 层」，
     * 而且 `envChance(101)` 会直接顶到 80% 封顶。 */
    if (!TD.canHaveEnv(run.layer)) return;
    const cap = Math.max(1, Number(TD.ENV_MAX) || 2);
    /* 兜底：旧档 / 调试注入可能已经超过上限，先裁到上限（保留剩余场数多的那几条）。 */
    if (list.length > cap) {
      list.sort((a, b) => (Number(b.left) || 0) - (Number(a.left) || 0));
      list.splice(cap);
    }
    const room = cap - list.length;
    if (room <= 0) return;
    /* 「每场强制补满 2 条」同样是**轮内**门槛（第 15 层起）。 */
    const forced = TD.cycleLayer(run.layer) >= TD.ENV_TWO_LAYER ? 2 : 0;
    const want = Math.max(0, Math.min(room, forced || (Math.random() < TD.envChance(run.layer) ? 1 : 0)));
    /* 挑战塔没有试炼币经济：环境池用 envPoolFor('tower')，只对无尽塔成立的收益类环境
     *（贪婪裂隙那种「给试炼币换敌人变强」的）在那边会退化成纯负面条目，所以池子按模式取；
     * 摇出来的数值也只摇那个模式下真正生效的键。 */
    const envMode = run.mode === 'tower' ? 'tower' : 'endless';
    for (let k = 0; k < want; k++) {
      const pool = TD.envPoolFor(envMode).filter((e) => !list.some((x) => x.id === e.id));
      if (!pool.length) break;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const dur = TD.ENV_DUR[0] + Math.floor(Math.random() * (TD.ENV_DUR[1] - TD.ENV_DUR[0] + 1));
      /* 数值在区间内随机摇一次并固定在实例上：同一条环境每次出现强度略有不同。 */
      list.push({ id: pick.id, left: dur, values: TD.rollEnvMods(pick, envMode) });
    }
  }
  /** 某条环境在本局的**实际数值**（旧档没有 values 时就地补摇一次）。
   *  buff 的倍率（例如「环境强化」类）在这里统一乘上去。 */
  function envValues(run, entry) {
    const TD = D();
    const def = TD.ENDLESS_ENV_BY_ID[entry && entry.id];
    if (!def) return {};
    const envMode = run && run.mode === 'tower' ? 'tower' : 'endless';
    if (!entry.values || typeof entry.values !== 'object') entry.values = TD.rollEnvMods(def, envMode);
    const mul = 1 + Math.max(0, runModTotal(run, 'envPowerMul'));
    const out = {};
    for (const [k, v] of Object.entries(entry.values)) {
      /* 挑战塔里「只在无尽塔成立」的收益键直接不给（旧档可能带着它）。 */
      if (envMode === 'tower' && TD.ENDLESS_REWARD_MOD_KEYS.includes(k)) continue;
      out[k] = Number(v) * mul;
    }
    return out;
  }
  /** 本局所有生效环境里，某个键的合计（已含环境强化倍率）。 */
  /** 环境数值求和。
   *  opts.mineOnly：只算「本场真正生效」的那一份（见 envEffective 的 fx.mine）——
   *  这样天象之眼剥夺过的环境不会再从这里漏出来。 */
  function envModTotal(run, key, opts) {
    const mineOnly = !!(opts && opts.mineOnly);
    const fx = mineOnly ? envEffective(run) : null;
    let sum = 0;
    for (const e of envList(run)) {
      if (mineOnly && fx.mine.indexOf(e.id) < 0) continue;
      const def = D().ENDLESS_ENV_BY_ID[e.id];
      if (!def || !def.mods || def.mods[key] === undefined) continue;
      sum += Number(envValues(run, e)[key]) || 0;
    }
    return sum;
  }
  /* 这些键交给 sim 的 mods 直接结算（每个 fighter 自己身上的 mods 生效）：
   * thornsPct = 荆棘之甲、regenPct = 每回合回血、lifestealPct = 攻击吸血、
   * shellPct = 开局护盾、takenMul = 受伤倍率、dodgeBonus = 闪避点数。 */
  /* ============================================================
   * 环境数值 → 乘区（按朝向分派）
   *
   * 每条环境可能同时影响「敌方」和「我方」，所以这里按朝向分三档：
   *   'foe'  只作用敌人     'me' 只作用我方     'both' 双方都吃
   * 每个 map 项 = 环境键 → [sim 里的乘区键, 朝向]。
   *
   * 以前是散在函数体里的一串 if，血色黄昏（bothLifestealPct）只写了条件判断、
   * 忘了真正写进我方 mods，于是「双方吸血」只有敌人回血、玩家不回血。
   * 现在统一走这张表，两边都用同一份声明，不会再出现「只生效一半」。
   * ============================================================ */
  const ENV_MOD_MAP = {
    /* —— 原段位机制并入的 5 条：数值是「敌人变强」，所以作用在敌人身上 —— */
    thornsPct: ['thornsPct', 'foe'],
    regenPct: ['regenPct', 'foe'],
    lifestealPct: ['lifestealPct', 'foe'],
    shellPct: ['shellPct', 'foe'],
    devourPct: ['devourPct', 'foe'],
    /* —— 原有环境词缀 —— */
    enemyCritBonus: ['critBonus', 'foe'],
    enemyMaxHpMul: ['maxHpMul', 'foe'],
    selfSpeedMul: ['speedMul', 'me'],
    enemySpeedMul: ['speedMul', 'foe'],
    bothLifestealPct: ['lifestealPct', 'both'],
    selfCritBonus: ['critBonus', 'me'],
  };
  /** 某条环境对当前这一方是否生效。 */
  function envAppliesTo(key, side) {
    const spec = ENV_MOD_MAP[key];
    if (!spec) return false;
    return spec[1] === 'both' || spec[1] === side;
  }
  /**
   * 把环境效果落到一个 fighter 上。
   *   · 负面环境（fx.mine）由我方承受 —— 但它们的**数值**本来就是「敌人变强」，
   *     所以对自己生效的那部分（selfXxx）写在玩家身上、其余写在敌人身上；
   *   · 被「反弹」的环境（fx.enemy）额外再算一遍到敌人身上；
   *   · 正向环境（血色黄昏）双方都吃。
   * 「无视 / 反弹 / 剥夺正向」三档 buff 依旧有效。
   */
  function applyEnvTo(run, fighter, side) {
    const TD = D(), fx = envEffective(run);
    const isFoe = side != null ? side === 1 : fighter.side === 1;
    const key = isFoe ? 'foe' : 'me';
    const eff = { mods: {} };
    const add = (k, key2, v) => { if (v) eff.mods[k] = (Number(eff.mods[k]) || 0) + v; };
    /** 把一条环境实例的数值按「朝向 + 当前这一方」写进 eff。 */
    const consume = (entry) => {
      const def = TD.ENDLESS_ENV_BY_ID[entry.id];
      if (!def || !def.mods) return;
      const values = envValues(run, entry);
      const goodEnv = !def.bad;
      if (isFoe && goodEnv && fx.sh.denyGood) return;
      for (const [mk, spec] of Object.entries(ENV_MOD_MAP)) {
        if (def.mods[mk] === undefined) continue;
        if (spec[1] !== 'both' && spec[1] !== key) continue;
        add(spec[0], mk, Number(values[mk]) || 0);
      }
    };
    const done = new Set();
    const once = (e) => { if (e && !done.has(e.id)) { done.add(e.id); consume(e); } };
    /* 生效中的环境（含正向）：fx.mine 就是「本场真正生效的那一份」 */
    for (const e of envList(run)) if (fx.mine.includes(e.id)) once(e);
    /* 被反弹给敌人的那一份（正常情况下不在 mine 里） */
    if (isFoe) for (const e of envList(run)) if (fx.enemy.includes(e.id)) once(e);

    const mods = fighter.mods || (fighter.mods = {});
    for (const [k, v] of Object.entries(eff.mods)) if (v) mods[k] = (Number(mods[k]) || 0) + v;
    /* 暴击与速度：sim 对玩家面板的 crit / speed 只认面板值，
     * 所以除了写 mods，还要把面板值一起调过去。 */
    if (eff.mods.critBonus) fighter.crit = Math.max(Number(fighter.crit) || 0, 0) + eff.mods.critBonus;
    if (eff.mods.maxHpMul) fighter.hp = Math.max(1, Math.round(fighter.hp * (1 + eff.mods.maxHpMul)));
    if (eff.mods.speedMul) fighter.speed = Math.max(1, Math.round(fighter.speed * (1 + eff.mods.speedMul)));
    /* 血色黄昏是「双方向」的吸血：sim 只看 mods.lifestealPct，所以这里要把
     * 面板字段也补上（否则玩家侧只是 mods 里有个值、面板不显示、老代码读面板时看不到）。 */
    if (eff.mods.lifestealPct) fighter.lifestealPct = Math.max(Number(fighter.lifestealPct) || 0, eff.mods.lifestealPct);
    /* 贪婪裂隙：我方试炼币加成（记在 run 上，结算奖励时用） */
    const coin = fx.mine.includes('greed') ? envModTotal(run, 'coinBonus', { mineOnly: true }) : 0;
    run.envCoinMul = 1 + Math.max(0, coin);
    return fighter;
  }
  function applyEnvToFoe(run, foe) { return applyEnvTo(run, foe, 1); }   // 1 = 敌人
  function applyEnvToMe(run, me) { return applyEnvTo(run, me, 0); }       // 0 = 玩家
  /** 来自三档 buff 的环境护盾：无视 / 反弹 / 剥夺正向。 */
  function envShield(run) {
    return { ignore: runModTotal(run, 'envIgnore') > 0, reflect: runModTotal(run, 'envReflect') > 0,
      denyGood: runModTotal(run, 'envDenyGood') > 0 };
  }
  /** 本场实际生效的环境（区分「我方承受」与「反弹给对手」）。 */
  function envEffective(run) {
    const TD = D(), sh = envShield(run), mine = [], enemy = [];
    const used = {};
    const allow = (def) => {
      const cap = Math.max(1, Math.floor(Number(def.maxStacks) || 1));
      const n = used[def.id] || 0;
      if (n >= cap) return false;
      used[def.id] = n + 1;
      return true;
    };
    for (const e of envList(run)) {
      const def = TD.ENDLESS_ENV_BY_ID[e.id];
      if (!def) continue;
      if (def.bad) {
        if (sh.ignore) { if (def.noReflect || !sh.reflect) continue; }
        if (sh.reflect && !def.noReflect) { if (allow(def)) enemy.push(e.id); }
        else if (allow(def)) mine.push(e.id);
      }
      /* 正向环境：我方**始终**吃得到（`fx.mine` 就是「本场真正生效的那一份」）。
       *   · 「无视环境」（envIgnore）**只针对负面环境** —— 它原来是
       *     「无视负面环境词缀」，不该把正向环境一起无视掉。
       *     天象之眼（C45）同时带 envIgnore 与 envDenyGood，早期写法让 `sh.ignore`
       *     把正向的血色黄昏也跳过了，于是我方自己那份吸血也丢了。
       *   · envDenyGood（剥夺正向）只阻止**敌人**吃到，由 applyEnvTo 里的
       *     `if (isFoe && goodEnv && sh.denyGood) return;` 挡住敌人那一侧。 */
      else if (allow(def)) mine.push(e.id);
    }
    return { mine, enemy, sh };
  }

  /* ============================================================
   * 【T12】层通关与推进 —— layerClear / advanceLayer
   * ============================================================ */

  function layerClear(mode, run, out, shopPct, mintShop) {
    out.layerComplete = true;
    out.layer = run.layer;
    // 本层已全清：留一份快照，主界面在商店/结算点阶段仍能看到「最后一个敌人 已战胜」
    if (mode === 'endless') run.finished = { layer: run.layer, count: run.plan.length, at: Date.now() };
    if (mode === 'tower') {
      const gold = run.pot;
      State.addGold(gold);
      tower().maxLayer = run.layer;
      tower().retry = null;
      /* 挑战塔过关的蓝色碎片也吃「除碎片竞技场外一律小幅降期望」的系数（2026-10 用户口径）。 */
      if (Math.random() < GData.stageFragmentChance(6) * Number(GData.BLUE_SHARD_DROP_MUL)) {
        const count = GData.stageFragmentCount();
        const id = 26;                                  // 蓝色碎片
        S().props[id] = (S().props[id] || 0) + count;
        out.drop = { id, count, name: propMap.getValue(id).name };
      }
      out.prizes = settlePrizes();
      out.gold = gold;
      tower().run = null;
      save();
      return out;
    }
    // —— 无尽 ——
    const g = globalMul(run);
    addScore(run, D().SCORE.layer, '通过第 ' + run.layer + ' 层');
    run.coins += D().COINS.layer;
    run.bestLayer = Math.max(run.bestLayer, run.layer);
    /* 生命源泉（C04）改成「每层第一场战斗开战回满」——由 aggregate 的 layerFirstHealPct
     * 在战斗准备阶段结算（见 adjustMe 的 startHealPct），这里不再按层回血。 */
    if (run.layer % D().MILESTONE_EVERY === 0) {
      const rollLucky = () => {
        const cands = [D().rollMilestone(), D().rollMilestone(), D().rollMilestone()].filter(Boolean);
        const rank = (r) => (r.kind === 'pill' ? 2 : r.kind === 'skill' ? 1 : 0);   // 药丸 > 技能卷轴 > 武器卷轴
        return cands.sort((a, b) => rank(b) - rank(a))[0] || null;
      };
      const FALLBACK = { kind: 'skill', propId: 21, count: 10, name: '技能卷轴' };
      const reward = (run.layer % 10 === 0 ? rollLucky() : D().rollMilestone()) || FALLBACK;
      S().props[reward.propId] = (S().props[reward.propId] || 0) + reward.count;
      const def = propMap.getValue(reward.propId);
      reward.name = def ? def.name : (reward.name || '奖励');
      out.milestone = reward;
    }
    out.score = run.score; out.coins = run.coins;
    if (run.layer % 5 === 0) {                           // 每 5 层：商店 → 结算点
      /* 【100 层循环】整百层（100 / 200 / 300…）**不开商店**（用户口径）：直接推进到下一层，
       * 于是这一层只有「觐见魔王」三连战，中途不插店。走 advanceLayer 而不是干等 ——
       * 否则整局会卡在「本层已清空、却没有下一步」。 */
      if (D().layerNoShop(run.layer)) {
        advanceLayer(run, 'endless');
        save();
        return out;
      }
      /* E16「铸币商队」：顶掉这次的结算商店 —— 位置与去向都不变（`boundary` 一样要打），
       * 只是货架换成铸币商店（关店后仍按结算商店的去向推进，见 closeMintShop / leaveMintShop）。 */
      if (mintShop) {
        openMintShop(run, run.layer, { noGroup: true, byBuff: true, boundary: true });
        out.mintShop = true;
      } else {
        run.shop = makeShop(run, shopPct);
        if (run.shop) run.shop.boundary = true;            // 只有这家店关掉之后去结算点
      }
      run.phase = 'shop';
      out.phase = 'shop';
    } else {
      advanceLayer(run, 'endless');
    }
    save();
    return out;
  }
  /** 每层结算补发的「悬浮奖品」：3 场 × 3 个飘物（同一个掉落池）。 */
  function settlePrizes() {
    const Drops = window.BattleDrops;
    if (!Drops || typeof Drops.plan !== 'function') return { items: [], ups: [] };
    const battles = Math.max(0, Number(D().SETTLE_DROP_BATTLES) || 3);
    const list = [];
    for (let i = 0; i < battles; i++) list.push(...Drops.plan());
    return Drops.grant(list);
  }
  function advanceLayer(run, mode) {
    run.layer++;
    run.plan = buildPlan(run.layer, run.salt, true, mode);
    run.idx = 0;
    run.choices = null;
    run.restShopUsed = false;
    /* 三侠大招留下的削弱是「**贯穿本层**」的（见 TowerData.HERO_DEBUFF、界面上的
     * 「本层已被削弱（贯穿本层）」）：进新的一层必须清掉。
     * 以前这里没清 → 削弱会一路叠到结算（每层三位大侠各留一条，越走越残），与描述不符。
     * 注意清理放在 layerStartHeal **之前**：新层的回血不该按被压低的上限算。
     * E15 时间回廊重开的是**同一层**，走 restartLayer，那边**不清**（同层继续吃这套削弱）。 */
    run.debuffs = [];
    layerStartHeal(run, mode);
    const lost = applyBrokenMarkLoss(run);
    if (lost) run.pendingToasts = (run.pendingToasts || []).concat(['碎掉的烙印失效：' + lost.label]).slice(-12);
    /* 【100 层循环】跨轮进层（第 101 / 201 / 301… 层 = 新一轮第 1 层）：环境词缀换一轮、
     * 手上的残留就地清掉 —— 与「进新的一层」时清三侠削弱同一个道理（给新一轮一个干净的起点）。
     * 注意**判据是「轮次切换」而不是「不吃环境」**：环境本身从 ENV_START_LAYER（第 5 层）起
     * 照旧会抽，101 层只是新一轮的起点、不是终点（用户实测报过「100 层之后环境一直没有」）。
     * 「每 10 层丢一个无尽增益」不需要清状态：它只在清完层的那一刻判一次（见 needPermSacrifice）。
     * 整百层（x00）本来就轮不到商店，顺手把可能还挂着的店收掉。 */
    if (mode === 'endless' && run.layer > D().LAYER_CYCLE && D().layerCycle(run.layer) === 1) {
      if (Array.isArray(run.env) && run.env.length) run.env = [];
      if (run.phase === 'sacrifice') run.phase = null;
      run.pendingToasts = (run.pendingToasts || []).concat([
        '第 ' + run.layer + ' 层：新一轮开始 —— 商店件数 / 战斗选项 / 环境词缀 / 每 10 层放弃增益' +
        '都回到与第 1 层相同的节奏（敌人的数值继续从上一轮接着长）。']).slice(-12);
    }
    if (mode === 'endless' && D().layerNoShop(run.layer) && run.shop) {
      run.shop = null;
      if (run.phase === 'shop') run.phase = null;
    }
    /* 整百层（觐见魔王）：进层给一句叙事，让「爬到这里」这件事被说出来（用户口径的叙事味）。 */
    if (mode === 'endless' && run.layer > 0 && run.layer % D().LAYER_CYCLE === 0) {
      const held = Array.isArray(run.patrolTolls) ? run.patrolTolls.length : 0;
      const line = '第 ' + run.layer + ' 层 · 觐见魔王：两名近卫把门，门后是照着你的样子站起来的那一位' +
        (held ? '（它身上挂着你交出去的 ' + held + ' 件东西）' : '') +
        '。这一层不开商店。';
      run.pendingToasts = (run.pendingToasts || []).concat([line]).slice(-12);
    }
  }
  /** 手上有没有「开着的」时间回廊（E15，限次 1）—— 必须在 consumeLimited 之前取。 */
  function hasActiveLayerRestart(run) {
    for (const b of run.limited || []) {
      if (b.on === false || !(b.uses > 0)) continue;
      const m = (D().BUFF_BY_ID[b.id] || {}).mods || {};
      if (m.layerRestart) return true;
    }
    return false;
  }
  /** 时间回廊（E15）：**从本层第 1 场重新开始**（用户口径的「夹层」）。
   *
   *  · 我方状态一律**不回退**：buff / 试炼币 / 铸币 / 分数 / 血量（hpAbs）/ 已攒的成长都原样保留 ——
   *    这里只动「层内进度」，什么都不扣；
   *  · 敌方数值**不提升**：层号没变，plan 用与 advanceLayer 同一套参数（salt + squirrelsOnly）
   *    重建 → 同一批敌人、同一份缩放；
   *  · 本层最后一场打完也回到本层开头：调用点在 layerClear **之前**，所以层通关奖励（分数/试炼币）、
   *    里程碑、每 5 层的结算商店都不会发，层数也不推进；
   *  · 层间回血（`ENDLESS_LAYER_HEAL_PCT`）**不发** —— 那属于「进入新的一层」，这里没有进新层
   *   （但「每层第一场开战回血」类增益 C04 会在重开后的第 1 场照常触发，因为 idx 回到了 0）。
   *
   *  只清层内进度：idx / choices / finished / restShopUsed / 回响的「本场已触发」标记
   *（后者按「层号×1000 + 层内序号」记账，重开同一层会撞上旧 key，必须清）。 */
  function restartLayer(run) {
    const layer = Math.max(1, Math.floor(Number(run.layer) || 1));
    run.plan = buildPlan(layer, run.salt, true, 'endless');
    run.idx = 0;
    run.choices = null;
    run.finished = null;
    run.restShopUsed = false;
    run.repeatAt = -1;
    return layer;
  }

  /* ============================================================
   * 【T13】场间抉择：增益 4 选 1 —— rollChoices / pickChoice
   * ============================================================ */

  function poolFilter(run, buff) {
    const cap = D().stackCap(buff);
    /* 【2026-10 第六十一批】「烙印升华」（E20）带 `brandGate`：
     * **未破碎的烙印份数超过门槛**才允许出现（未达标时整条出池，商店与任何抽取口子都看不到它）。 */
    if (buff && buff.mods && buff.mods.brandGate != null &&
      unbrokenBrandCount(run) <= Math.max(0, Math.floor(Number(buff.mods.brandGate) || 0))) return false;
    /* 【任务3】永久增益永远留在池子里（叠满也能再拿，见 addBuff 的开新栏位分支）。 */
    if (permanentRestackable(buff)) return true;
    /* 【任务4】noRestack（涅槃 / 后发制人 / 挥金如土这一组）：**拿满上限后出池**。
     * 有 maxStacks 的按上限判；没有的（后发制人）按「同名唯一」判。 */
    if (D().hasTag(buff, 'noRestack')) {
      if (buff.maxStacks) return obtainedCountOf(run, buff.id) < Math.max(1, Math.floor(buff.maxStacks));
      return !(run.permanent || []).some((b) => b.id === buff.id);
    }
    /* 层数口径用「累计获得过几份」（含碎掉的烙印），否则碎一条就能再刷一条。 */
    if (D().hasTag(buff, 'stackable') && obtainedCountOf(run, buff.id) >= cap) return false;
    /* maxUses：**限次类**的「本局最多获得 N 次」上限（例：终焉烙印最多 3 次）。
     * 用 maxStacks 当阈值，但判据是总数而不是可叠层标记 —— 烙印不进 permanent，
     * 所以不能只靠上面那条 stackable 判断。 */
    if (!D().hasTag(buff, 'stackable') && buff.maxStacks) {
      /* 即时类不进 permanent / limited，另记在 instantIds 上；两者一起数。 */
      const got = obtainedCountOf(run, buff.id) + instantOwnedCount(run, buff.id);
      if (got >= Math.max(1, Math.floor(buff.maxStacks))) return false;
    }
    if (D().hasTag(buff, 'repeatable')) return true;
    if (!D().hasTag(buff, 'unique')) return true;
    if ((run.pickBuffIds || []).includes(buff.id)) return false;
    if ((run.permSlotIds || []).includes(buff.id)) return false;
    if (run.pendingPick && run.pendingPick.buffId === buff.id) return false;
    /* 天命所归由「即时」改「永久」后，老档里它可能还记在 instantIds 上 —— 同样视为已拥有。 */
    if (instantOwnedCount(run, buff.id) > 0) return false;
    return !(run.permanent || []).some((b) => b.id === buff.id);
  }
  const CHOICE_TILT_PAID = 10;
  /* 调试/测试开关：把「会改变层内流程」的增益从**场间选择**里排除
   *（E01 立即进货 = 战后开店、E15 时间回廊 = 重开本层）。
   * 只有 tools/ 里那些「要数场次、要看商店节奏」的流程类用例会打开它 ——
   * 真随机抽到这两张牌时，它们的场次计数必然散掉（实测偶发红）。
   * 模块级、不进存档；正式玩法永远为 false。 */
  let noFlowBuffs = false;
  /* 调试/测试开关 2：**关掉「铸币商店」的自动刷出**（模块级、不进存档）。
   * 它同样会打断「一场接一场」的假设（层中突然弹一家店），流程类用例一起打开；
   * 注意只掐**自动那一次掷骰**（reportBattle 里的调用），`mintRollOf`（测试/探针读概率）
   * 与 `_debugSpawnMintShop`（调试台手开一家）都不受影响。 */
  let noMintShop = false;
  const FLOW_BUFF_MODS = ['postBattleShop', 'postBattleMintShop', 'layerRestart'];
  function isFlowBuff(b) {
    const m = (b && b.mods) || {};
    return FLOW_BUFF_MODS.some((k) => m[k]);
  }
  /** 【2026-10 第八十一批 用户口径】「同名再获得 = **直接叠加场次**」的限次件。
   *  判据 = 普通限次增益（没写任何叠层/限量规则的），排除三类：
   *   · 烙印 / 限量件（unlimitedStacks / maxStacks）：它们的强度靠**层数**算，走各自的老口径；
   *   · `unique`（一局一次，例：N04 金蝉脱壳、E17 假如我直接赢）：多份没有意义，或会让局势崩掉；
   *   · **流程类**（isFlowBuff：立即进货 / 铸币商队 / 时间回廊）：再拿一份就是再开一家店 / 再重开一层，
   *     层内节奏会被打乱 —— 与「延续铭文不能延长立即进货」是同一条用户口径。
   *  `ownable`（能不能继续刷出来）与 `addBuff`（再获得怎么算）共用这一个判据，别各写一份。 */
  function usesStackable(b) {
    if (!b || b.kind !== 'limited') return false;
    if (b.unlimitedStacks || b.maxStacks) return false;
    if (D().hasTag(b, 'unique')) return false;
    if (isFlowBuff(b)) return false;
    return true;
  }
  /** 战斗获得的选项目数：基础 3，由「抉择扩充」(C50) 每层 +1，上限 6。
   *  可叠 3 层 → 三选一 / 四选一 / 五选一 / 六选一。
   *  【100 层循环】再按层**扣**一档（【D2b】）：21-40 层 −1、41-100 层 −2，
   *  第 101 层回到 1 层那一档（不扣）。扣完仍留 1 项 —— 一个选项都不给等于吞掉一次奖励，
   *  那不是「选项变少」而是「奖励消失」。 */
  function choiceSlotsOf(run) {
    const base = 3, cap = 6;
    const extra = Math.max(0, Math.floor(runModTotal(run, 'choiceCount') || 0));
    const cut = D().choiceCut(run && run.layer);
    return Math.max(1, Math.min(cap, base + extra - cut));
  }
  function rollChoices(mode, run) {
    const TD = D();
    /* 挑战塔只用 towerPool（限次类、无 endlessOnly、无 towerOnly 之外的杂项）。 */
    const rawPool = mode === 'tower' ? TD.towerPool : TD.endlessPool;
    const pool = noFlowBuffs ? rawPool.filter((b) => !isFlowBuff(b)) : rawPool;
    const picked = [];
    const taken = new Set();
    const limitedLeft = () => pool.filter((b) => b.kind === 'limited' && b.id !== 'N08' &&
      !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));
    /* 档位预算每抽一格重算一次：已经进过本页的候选被 taken 排除，
     * 它的份额立刻按动态权重重分给别的档（旧版是「空档顺延到邻近档」，会把概率整块塞给邻居）。 */
    const baseTier = TD.rawTierWeights(TD.rerollTilt(CHOICE_TILT_PAID), run);
    const slots = choiceSlotsOf(run);
    let pitySlot = -1;                       // 保底给出的那一格：不许被下面的「至少一件限次」顶掉
    for (let slot = 0; slot < slots; slot++) {
      const candidates = pool.filter((b) => !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));
      if (!candidates.length) break;
      const got = rollOneCandidate(run, candidates, baseTier);   // 含传奇保底
      const buff = got.buff;
      if (!buff) break;
      if (got.pity) pitySlot = picked.length;
      taken.add(buff.id);
      picked.push({ type: 'buff', id: buff.id });
    }
    // 三张里一张限次都没有 → 用一张限次顶掉最后一张（池子里确实没有才算）
    const hasLimited = picked.some((c) => { const b = TD.BUFF_BY_ID[c.id]; return b && b.kind === 'limited' && b.id !== 'N08'; });
    if (picked.length && !hasLimited) {
      const list = limitedLeft();
      const at = (pitySlot >= 0 && picked.length - 1 === pitySlot) ? pitySlot - 1 : picked.length - 1;
      if (list.length && at >= 0) {
        const buff = pickByShopWeight(list, run);
        taken.delete(picked[at].id);
        picked[at] = { type: 'buff', id: buff.id };
        taken.add(buff.id);
      }
    }
    return picked;
  }
  /** 「巡逻」胜利的奖励：**传奇增益**的（默认三选一，吃抉择扩充）——
   *  用户口径：当前可获得的传奇不够时就有几张给几张（不硬凑）。
   *  返回结构与 rollChoices 一致（`[{type:'buff', id}]`），界面与 pickChoice 无需分支。 */
  function rollLegendaryChoices(run) {
    const TD = D();
    const slots = choiceSlotsOf(run);
    /* 与 rollChoices 同口径：测试用的 noFlowBuffs 开关（E01 立即进货 / E15 时间回廊这类
     * 「会改变层内流程」的牌）必须一起排除，否则巡逻奖励会把它们放回来。 */
    const pool = TD.endlessPool.filter((b) => b.rarity === 3 && ownable(run, b) && poolFilter(run, b) &&
      !(noFlowBuffs && isFlowBuff(b)));
    const picked = [], taken = new Set();
    for (let i = 0; i < slots; i++) {
      const cands = pool.filter((b) => !taken.has(b.id));
      if (!cands.length) break;
      /* 权重口径与商店一致：个体权重 × 稀有度档位权重（传奇之间再按自降权区分）。 */
      const weights = cands.map((b) => Math.max(0.0001, buffWeightOf(run, b)));
      const sum = weights.reduce((a, v) => a + v, 0);
      let roll = Math.random() * sum, hit = cands[0];
      for (let k = 0; k < cands.length; k++) { roll -= weights[k]; if (roll <= 0) { hit = cands[k]; break; } }
      taken.add(hit.id);
      picked.push({ type: 'buff', id: hit.id });
    }
    return picked;
  }
  /** 巡逻胜利结算：给传奇三选一（写进 run.choices）。 */
  function grantPatrolLegendary(run) {
    if (!run) return 0;
    const picked = rollLegendaryChoices(run);
    if (!picked.length) return 0;
    run.choices = picked;
    run.choicesKind = 'patrolLegendary';
    return picked.length;
  }
  /** 这次「选取型」铭文**现在有没有可选目标** —— 只看数量，**绝不洗牌**
   *（`pickCandidates` 会 `Math.random()` 洗牌，那会白白消耗随机流，口径见那边的注释）。 */
  function hasPickTargets(run, kind, inscriptionIdArg) {
    if (!run) return false;
    if (kind === 'brandBuff' || kind === 'limitedBuff') {
      const wantBrand = kind === 'brandBuff';
      return (run.limited || []).some((row) => {
        const def = D().BUFF_BY_ID[row && row.id];
        if (!row || !def || Math.max(0, Math.floor(Number(row.stacks) || 0)) <= 0) return false;
        return isBrandBuff(def) === wantBrand;
      });
    }
    if (kind === 'permBuff') {
      /* 铭文身份：调用方**显式传进来的**优先 —— 发牌那一刻 run.pendingPick 还没挂上，
       * 只靠待选推断会误判成虚空铭文（C37），于是「同一张铭文不能重复附」这类规则会被绕过。
       * 没传就退回共用出口（见 activeInscriptionId），保证与候选、界面标记同一口径。 */
      const inscriptionId = inscriptionIdArg || activeInscriptionId('permBuff', run) || 'C37';
      return (run.permanent || []).some((row) => {
        const def = D().BUFF_BY_ID[row && row.id];
        if (!row || !def || D().hasTag(def, 'hidden')) return false;
        return inscriptionEligible(row, run, inscriptionId);
      });
    }
    return false;
  }
  /** 【软锁修复 2026-10】选取型铭文发到手、但**当前一个可选目标都没有**时：
   *  以前照样挂 `run.pendingPick` —— 界面于是每次都弹同一个空弹窗（候选 0 个），
   *  玩家点不掉、也走不了，永久卡死在这一屏（用户实测：没有烙印时拿到碎裂铭文就卡死）。
   *  现在改成**不挂 pendingPick**，记进 `run.deferredPicks` 先替你留着，
   *  之后拿到符合条件的目标时自动接上（见 resolveDeferredPicks）。 */
  function deferPick(run, buff, kind) {
    const label = kind === 'brandBuff' ? '烙印' : kind === 'limitedBuff' ? '限次增益' : '永久增益';
    const entry = { kind: kind, buffId: buff.id };
    if (buff.mods && buff.mods.pickLimitedUses) entry.addUses = Math.max(1, Math.floor(Number(buff.mods.pickLimitedUses) || 1));
    if (buff.mods && buff.mods.pickPermanentMul) entry.mul = Number(buff.mods.pickPermanentMul) || 0;
    run.deferredPicks = (Array.isArray(run.deferredPicks) ? run.deferredPicks : [])
      .filter((x) => !(x && x.buffId === buff.id)).concat([entry]);
    save();
    return { ok: true, deferred: true, icon: 'warn',
      msg: buff.name + '：现在还没有可以挑的目标，先替你留着 —— 之后拿到' + label + '时会自动弹出。' };
  }
  /** 拿到新增益后（或回到主界面时）再看一眼：之前「留着」的铭文现在有目标了吗？有就接上 pendingPick。 */
  function resolveDeferredPicks(runArg) {
    const run = runArg || endless().run;
    if (!run || run.pendingPick) return null;
    const list = Array.isArray(run.deferredPicks) ? run.deferredPicks : [];
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || !it.kind) continue;
      /* `hasPickTargets` 判 permBuff 时要读「这次附的是哪张铭文」，所以先把虚拟待选挂上再判。 */
      if (it.kind === 'permBuff') run.pendingPick = { kind: 'permBuff', buffId: it.buffId, mul: it.mul };
      if (!hasPickTargets(run, it.kind)) {
        if (it.kind === 'permBuff') run.pendingPick = null;
        continue;
      }
      if (it.kind === 'permBuff') {
        run.pendingPick = { kind: 'permBuff', buffId: it.buffId };
        if (it.mul) run.pendingPick.mul = it.mul;
      } else if (it.kind === 'brandBuff') {
        run.pendingPick = { kind: 'brandBuff', buffId: it.buffId };
      } else {
        run.pendingPick = { kind: 'limitedBuff', buffId: it.buffId, addUses: Math.max(1, Math.floor(Number(it.addUses) || 1)) };
      }
      run.deferredPicks = list.filter((x, k) => k !== i);
      save();
      return run.pendingPick;
    }
    return null;
  }
  /** 把「已经没有可选目标」的 pendingPick 收进 deferredPicks（**软锁第二道防线**）：
   *  normalizeRun 每次归一化都会清一遍，界面在候选为 0 时也会再叫一次。
   *  返回是否真的收走了（界面据此决定要不要提示「先留着」）。 */
  function parkStalePendingPick(runArg) {
    const run = runArg || endless().run;
    if (!run || !run.pendingPick || !run.pendingPick.kind) return false;
    const kind = run.pendingPick.kind;
    if (['permBuff', 'brandBuff', 'limitedBuff'].indexOf(kind) < 0) return false;
    if (hasPickTargets(run, kind)) return false;
    const def = D().BUFF_BY_ID[run.pendingPick.buffId];
    if (def) {
      const entry = { kind: kind, buffId: run.pendingPick.buffId };
      if (run.pendingPick.mul) entry.mul = run.pendingPick.mul;
      if (run.pendingPick.addUses) entry.addUses = run.pendingPick.addUses;
      run.deferredPicks = (Array.isArray(run.deferredPicks) ? run.deferredPicks : [])
        .filter((x) => !(x && x.buffId === entry.buffId)).concat([entry]);
    }
    run.pendingPick = null;
    save();
    return true;
  }
  function ownable(run, buff) {
    /* 即时类不进 permanent / limited，ownedEntry 永远查不到 —— 必须先单独判上限，
     * 否则会在第一行被 `if (!owned) return true` 直接放行
     *（E07 挫锐 / E08 卸甲「一局只能生效一次」就是这么漏的）。 */
    if (buff.kind === 'instant' && buff.maxStacks) {
      const got = instantOwnedCount(run, buff.id);
      return got < Math.max(1, Math.floor(buff.maxStacks));
    }
    /* 【任务3】永久增益不再「拿满就出池」：永远可以再拿（叠满 → 由 addBuff 开新栏位）。 */
    if (permanentRestackable(buff)) return true;
    if (buff.maxStacks && obtainedCountOf(run, buff.id) >= Math.max(1, Math.floor(buff.maxStacks))) return false;
    /* 带 repeatable 标签的**不适用「同名唯一」**：它们的数量由 maxStacks（上面的早返回）
     * 或个体自惩罚（repeatWeight / weightDivBy）控制。poolFilter 里本来就有这条规则，
     * 但三个抽取口子都要求 `ownable && poolFilter`，缺了这一句就等于「获得一次后再也刷不到」——
     * 实测 E14 讨价还价 / C52 涌泉烙印 / C36 挥金如土 / C37 虚空铭文 全被误杀，
     * C37 的「每附魔一个再出现概率低一档」因此永远触发不到第二次。 */
    if (D().hasTag(buff, 'repeatable')) return true;
    const owned = ownedEntry(run, buff.id);
    if (!owned) return true;
    /* 【2026-10 第八十一批 用户口径】限次类也要「持有还能再拿」：
     * 再获得 = **直接叠加场次**（见 addBuff 的同名分支），所以这里不能因为「已经有一条」就
     * 把它踢出池子 —— 否则商店 / 场间三选一 里再也刷不到它，「持有时还能刷新」就成了空话。
     * 判据统一走 usesStackable()（排除烙印/限量件、unique、流程类）。 */
    if (usesStackable(buff)) return true;
    /* 可叠层类的上限：优先用该增益自己的 maxStacks（例如 C50 只到 3 层），
     * 没写就用全局 STACK_MAX。叠满即视为「不可再获得」。 */
    if (!D().hasTag(buff, 'stackable')) {
      /* 既没有 stackable 也没有 maxStacks 的才是「同名唯一」；
       * 带 maxStacks 的烙印类（C49 等）可以叠到上限 —— 上限在前置判断里已把过关。 */
      if (!buff.maxStacks) return false;
      return obtainedCountOf(run, buff.id) < Math.max(1, Math.floor(buff.maxStacks));
    }
    const cap = D().stackCap(buff);
    return obtainedCountOf(run, buff.id) < cap;
  }
  /** 摇一个稀有度。默认用自然掉率权重；刷新时传入倾斜后的权重。 */
  function rollRarity(weights) {
    const w = (weights && weights.length) ? weights : D().RARITY_WEIGHTS;
    const total = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < w.length; i++) { if (r < w[i]) return i; r -= w[i]; }
    return 0;
  }
  function pickChoice(mode, index, replaceId) {
    const run = mode === 'tower' ? tower().run : endless().run;
    if (!run || !run.choices) return { ok: false };
    const choice = run.choices[index];
    if (!choice) return { ok: false };
    const res = addBuff(run, choice.id, replaceId);
    if (!res.ok) return res;                     // 永久格子满了：保留 choices，让界面去选替换
    const gained = res.buff || D().BUFF_BY_ID[choice.id];
    const pts = scoreBuffAcquire(run, gained);
    run.choices = null;
    save();
    return Object.assign({}, res, pts ? { score: pts } : null,
      { achievements: takeAchievementToasts(run) });
  }
  /* ============================================================
   * 【T14】易碎烙印：生效 · 损毁 · 作废 —— fragileBonus / rollFragileBuffs / loseRandomBrokenMark
   * ============================================================ */
  /** 易碎属性烙印的当前加成（2026-10 削弱后的口径）。
   *  「破碎前后」是两个确切数值：
   *    · base   = 未破碎（存在）的加成，取 `mods.fragilePct`；
   *    · burned = 已损毁的加成，取 `mods.fragileBurnedPct`（破碎时从 base 挪过来）。
   *  两者直接相加就是当前总加成（**不再有「半效」**）。 */
  function fragileBonus(run, key) {
    const base = Math.max(0, Number((run.fragileBase || {})[key]) || 0);
    const burned = Math.max(0, Number((run.fragileBurned || {})[key]) || 0);
    return { base: base, burned: burned, value: base + burned };
  }
  /**
   * 终乘烙印（C49「终焉烙印」）的最终倍率。
   *   存在时 +25%/层、损毁后 +50%/层，**按层加算**（1 + 0.25×base + 0.5×burned，线性增长），
   *   而不是常见的加法叠加。调用点在 adjustMe 的最末尾（所有加算 / 成长都算完之后）。
   */
  function fragileFinalMul(run) {
    const b = Math.max(0, Math.floor(Number(run && run.fragileMulBase) || 0));
    const k = Math.max(0, Math.floor(Number(run && run.fragileMulBurned) || 0));
    if (!b && !k) return 1;
    const mA = D().BUFF_BY_ID.C49.mods;
    const alive = Number(mA.fragileAddAlive) || 0.25;
    const burned = Number(mA.fragileAddBurned) || 0.5;
    return 1 + alive * b + burned * k;
  }
  /** 治疗烙印（C52「涌泉烙印」）的最终治疗加成：按层加算（存在 +10%/层、损毁 +20%/层）。 */
  function fragileHealBonus(run) {
    /* 只数「涌泉烙印」自己的层数：C49 的层数不再顺带加治疗。 */
    const b = Math.max(0, Math.floor(Number(run && run.fragileHealBase) || 0));
    const list = Array.isArray(run && run.fragileHealBurned) ? run.fragileHealBurned : [];
    if (!b && !list.length) return 0;
    const m = D().BUFF_BY_ID.C52.mods;
    let sum = (Number(m.fragileHealAddAlive) || 0.10) * b;
    for (const v of list) sum += Math.max(0, Number(v) || 0);
    return sum;
  }
  /** 淘金烙印（C53「淘金烙印」）的战斗代币加成：按层加算（存在 +15%/层、损毁 +30%/层）。
   *  注意它**不复用** run.fragileMulBase —— 那个字段是「终乘烙印」的倍率层数
   *（C49 与 C52 都带 fragileFinalMul 标记，两件事历史上被挂在同一份计数上），
   *  淘金烙印不属于终乘类，所以单独记 `run.fragileCoinBase` + `run.fragileCoinBurned`。 */
  function fragileCoinBonus(run) {
    const base = Math.max(0, Math.floor(Number(run && run.fragileCoinBase) || 0));
    const list = Array.isArray(run && run.fragileCoinBurned) ? run.fragileCoinBurned : [];
    if (!base && !list.length) return 0;
    const m = D().BUFF_BY_ID.C53.mods;
    let sum = (Number(m.fragileCoinAddAlive) || 0.15) * base;
    for (const v of list) sum += Math.max(0, Number(v) || 0);
    return sum;
  }
  /** 把明细重新汇总成「合计值」（移除明细后必须重算）。 */
  function rebuildFragileTotals(run) {
    if (!run) return;
    run.fragileBurned = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBurned || {});
    run.fragileBurned.power = 0; run.fragileBurned.agility = 0; run.fragileBurned.speed = 0;
    run.fragileHealBurned = [];
    run.fragileCoinBurned = [];
    for (const m of run.brokenMarks || []) {
      if (m.kind === 'stat' && m.stat) {
        if (run.fragileBurned[m.stat] === undefined) run.fragileBurned[m.stat] = 0;
        run.fragileBurned[m.stat] += Math.max(0, Number(m.pct) || 0);
      } else if (m.kind === 'heal') {
        run.fragileHealBurned.push(Math.max(0, Number(m.burned) || 0));
      } else if (m.kind === 'coin') {
        run.fragileCoinBurned.push(Math.max(0, Number(m.burned) || 0));
      }
    }
  }
  function loseRandomBrokenMark(run) {
    const pool = (run.brokenMarks || []).filter((m) => !m.legacy);
    if (!pool.length) return null;
    const idx = Math.floor(Math.random() * pool.length);
    const m = pool[idx];
    run.brokenMarks.splice((run.brokenMarks || []).indexOf(m), 1);
    let label = '碎裂烙印';
    if (m.kind === 'stat') {
      const statName = { power: '力量', agility: '敏捷', speed: '速度' }[m.stat] || m.stat;
      label = statName + '烙印（已损毁 +' + Math.round((Number(m.pct) || 0) * 100) + '%）';
    } else if (m.kind === 'heal') {
      label = '涌泉烙印（已损毁 +' + Math.round((Number(m.burned) || 0) * 100) + '% 治疗）';
    } else if (m.kind === 'coin') {
      /* 淘金烙印的已损毁份数是**明细数组**，rebuildFragileTotals 会重算 ——
       * 这里只给个可读的名字（未破碎份数 run.fragileCoinBase 与它无关，不动）。 */
      label = '淘金烙印（已损毁 +' + Math.round((Number(m.burned) || 0) * 100) + '% 试炼币）';
    } else if (m.kind === 'final') {
      label = '终焉烙印（已损毁 +' + Math.round((Number(m.burned) || 0) * 100) + '%）';
      run.fragileMulBurned = Math.max(0, Math.floor(Number(run.fragileMulBurned) || 0) - 1);
    }
    rebuildFragileTotals(run);
    return { label: label, kind: m.kind, stat: m.stat };
  }
  /** 逐栏（逐条）的破碎随机数：种子存在**行上**（`row.fragileSeed`），
   *  同名的每一条、叠加的每一份都各摇各的，不再共用 `run.fragileSeeds[id]`。
   *  向后兼容：老档 / 测试仍可用 `run.fragileSeeds[id]` 注入「下一步必碎」的初始状态 ——
   *  第一次为某条行取种子时优先用它（**用完即删**，免得同名其它栏共用同一条序列）。 */
  function fragileRoll(run, row, pct) {
    if (!row) return false;
    run.fragileSeeds = Object.assign({}, run.fragileSeeds || {});
    const id = row.id;
    let st = Math.max(0, Math.floor(Number(row.fragileSeed) || 0));
    if (!st) {
      const legacy = run.fragileSeeds[id];
      if (Number.isFinite(legacy)) {
        st = (Math.floor(legacy) >>> 0);
        delete run.fragileSeeds[id];             // 只用一次
      }
    }
    if (!st) {
      /* 种子来源：本局 salt + 当前层 + 增益 id + **栏位 uid**（同名各栏互不相同）。 */
      const key = String(run.salt == null ? 'run' : run.salt) + '#' + (Number(run.layer) || 0)
        + '#' + id + '#' + Math.max(0, Math.floor(Number(row.uid) || 0));
      let h = 0x811c9dc5;
      for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      h ^= (Date.now() & 0xffff) << 13;              // 每次开局再抖一次，避免跨局完全一致
      st = h >>> 0 || 1;
    }
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    row.fragileSeed = st;
    return (st / 4294967296) * 100 < pct;
  }
  /** 结算一条「碎裂烙印」的一份：把存在值转成损毁值（明细 / 合计 / 层数一起更新）。
   *  【2026-10 同名逐条】每**一份**各摇各的：一份碎了只掉那一份（层数 −1），全碎才移除整栏。 */
  function breakOneFragileCopy(run, def, row) {
    if (def.mods.fragileStat) {
      /* 属性烙印：破碎 = 把这一份从「存在值」换成「损毁值」——
       * 存在那份（fragilePct）从 base 里收回，损毁那份（fragileBurnedPct）记进 burned。 */
      const alive = Math.max(0, Number(def.mods.fragilePct) || 0);
      const burnedPct = Math.max(0, Number(def.mods.fragileBurnedPct != null
        ? def.mods.fragileBurnedPct : alive) || 0);
      run.fragileBase = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBase || {});
      run.fragileBurned = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBurned || {});
      run.fragileBase[def.mods.fragileStat] = Math.max(0, (Number(run.fragileBase[def.mods.fragileStat]) || 0) - alive);
      run.fragileBurned[def.mods.fragileStat] = Math.max(0, Number(run.fragileBurned[def.mods.fragileStat]) || 0) + burnedPct;
    }
    /* 终乘烙印：损毁把一份「存在」层转成「损毁」层（加算口径下 = 多一份的倍率）。 */
    if (def.mods.fragileFinalMul) {
      run.fragileMulBase = Math.max(0, Math.floor(Number(run.fragileMulBase) || 0) - 1);
      run.fragileMulBurned = Math.max(0, Math.floor(Number(run.fragileMulBurned) || 0)) + 1;
    }
    /* 淘金烙印：损毁把一份「存在」层转成「损毁」层（+15% → +30%）。 */
    if (def.mods.fragileCoinAddAlive !== undefined) {
      run.fragileCoinBase = Math.max(0, Math.floor(Number(run.fragileCoinBase) || 0) - 1);
      run.fragileCoinBurned = (Array.isArray(run.fragileCoinBurned) ? run.fragileCoinBurned : [])
        .concat([Math.max(0, Number(def.mods.fragileCoinAddBurned) || 0)]);
    }
    if (def.mods.fragileHealAddAlive !== undefined) {
      run.fragileHealBase = Math.max(0, Math.floor(Number(run.fragileHealBase) || 0) - 1);
      run.fragileHealBurned = (Array.isArray(run.fragileHealBurned) ? run.fragileHealBurned : [])
        .concat([Math.max(0, Number(def.mods.fragileHealAddBurned) || 0)]);
    }
    /* 明细：碎掉的每一份都登记一条，供「30 层后每 2 层作废一条」抽取。 */
    run.brokenMarks = Array.isArray(run.brokenMarks) ? run.brokenMarks : [];
    if (def.mods.fragileStat) {
      /* 明细里记的是**损毁后的那份值**（重建 burned 合计时按它累加）。 */
      run.brokenMarks.push({ kind: 'stat', stat: def.mods.fragileStat,
        pct: Math.max(0, Number(def.mods.fragileBurnedPct != null
          ? def.mods.fragileBurnedPct : def.mods.fragilePct) || 0) });
    } else if (def.mods.fragileHealAddAlive !== undefined) {
      run.brokenMarks.push({ kind: 'heal',
        alive: Math.max(0, Number(def.mods.fragileHealAddAlive) || 0),
        burned: Math.max(0, Number(def.mods.fragileHealAddBurned) || 0) });
    } else if (def.mods.fragileCoinAddAlive !== undefined) {
      run.brokenMarks.push({ kind: 'coin',
        alive: Math.max(0, Number(def.mods.fragileCoinAddAlive) || 0),
        burned: Math.max(0, Number(def.mods.fragileCoinAddBurned) || 0) });
    } else if (def.mods.fragileFinalMul) {
      run.brokenMarks.push({ kind: 'final',
        alive: Math.max(0, Number(def.mods.fragileAddAlive) || 0),
        burned: Math.max(0, Number(def.mods.fragileAddBurned) || 0) });
    }
  }
  /** 烙印判据与「未破碎份数」—— 碎裂铭文（C61）/ 烙印升华（E20）都要用，
   *  商店门槛（E20 只在未破碎烙印超过 N 份时上架）也读同一个数。
   *  【2026-10 用户口径】「拥有」只看**还有几份没碎**，**不看开关状态**：
   *  玩家把一条烙印关掉只是「这场先不用」，它仍然是持有中的未破碎烙印。 */
  function isBrandBuff(def) { return !!(def && def.mods && def.mods.fragileBreakPct); }
  function unbrokenBrandCount(run) {
    let n = 0;
    for (const row of (run && run.limited) || []) {
      const def = D().BUFF_BY_ID[row && row.id];
      if (row && isBrandBuff(def)) n += Math.max(0, Math.floor(Number(row.stacks) || 0));
    }
    return n;
  }
  /** 让**这一栏**的烙印立刻全部破碎（确定性，不摇概率）—— 碎裂铭文用它。
   *  与 rollFragileBuffs 的差别只有「不掷骰」：每份都碎，碎完把整栏移除。 */
  function breakBrandRow(run, row) {
    const def = D().BUFF_BY_ID[row && row.id];
    if (!run || !row || !isBrandBuff(def)) return 0;
    const copies = Math.max(0, Math.floor(Number(row.stacks) || 0));
    for (let i = 0; i < copies; i++) {
      breakOneFragileCopy(run, def, row);
      logBuff(run, row.id, 'break', { uid: row.uid, detail: '碎裂铭文：立刻破碎（升级为全额并永久保留）' });
    }
    row.stacks = 0;
    return copies;
  }
  /* ---------- 巡逻收缴（2026-10 第六十二批） ----------
   * 巡逻失败不结算失败，而是让玩家**交出一个本局最高稀有度的增益**：
   *   · 候选 = 当前持有的（永久 + 限次、非隐藏）里，**稀有度等于「持有的最高档」**的那些；
   *   · 交出 = 那一栏 **-1 层**（涅槃有两层只掉一层；终焉烙印只掉一份计数）；
   *   · 交出虚空铭文（附魔类）：随机让一个**被附魔过的**增益恢复未附魔，
   *     由此导致的永久位溢出再让玩家丢一个（phase = 'patrolDiscard'）。
   * 交接记录留在 `run.patrolTolls`（x0 层的魔王会按快照吃这些加成）。 */
  /* ---------- 巡逻收缴的候选池（2026-10 第七十七批用户口径） ----------
   * 候选 = **本局中当前在身上可生效的**东西，不止「背包里的 permanent / limited」：
   *   · 背包里的永久 / 限次增益（含**未破碎**的烙印）；
   *   · **破碎过的烙印** —— 行已经不在 run.limited 里了，但加成还挂着（明细见 run.brokenMarks）；
   *   · **已经附魔成功的铭文**（虚空 C37 / 水晶 C60）—— 它们不占栏位、不在那两张表里。
   * 用户举的三个例子（虚空铭文 / 已破碎的终焉烙印 / 已破碎的淘金烙印）因此都能进候选。 */

  /** 某个烙印 def → 它「损毁明细」的规格：{ kind, stat, per }。
   *  kind/stat 用来在 run.brokenMarks 里认出属于它的明细；per = 一份明细值多少（旧档 legacy 折算用）。 */
  function markSpecOf(def) {
    const m = (def && def.mods) || {};
    if (m.fragileStat) return { kind: 'stat', stat: m.fragileStat,
      per: Math.max(0, Number(m.fragileBurnedPct != null ? m.fragileBurnedPct : m.fragilePct) || 0) };
    if (m.fragileFinalMul) return { kind: 'final', stat: null, per: Math.max(0, Number(m.fragileAddBurned) || 0.5) };
    if (m.fragileHealAddAlive !== undefined) return { kind: 'heal', stat: null, per: Math.max(0, Number(m.fragileHealAddBurned) || 0) };
    if (m.fragileCoinAddAlive !== undefined) return { kind: 'coin', stat: null, per: Math.max(0, Number(m.fragileCoinAddBurned) || 0) };
    return null;
  }
  /** 明细 → 它属于哪个烙印（用于「行已经不在了，但加成还挂着」的那一批）。 */
  function brandDefOfMark(mark) {
    if (!mark || !mark.kind) return null;
    for (const b of (D().BUFFS || [])) {
      const spec = markSpecOf(b);
      if (!spec || spec.kind !== mark.kind) continue;
      if (mark.kind === 'stat' && spec.stat !== mark.stat) continue;
      return b;
    }
    return null;
  }
  /** 某个烙印现在挂着几层**已损毁**：普通明细一条算一份；旧档 legacy 那条按 per 折算。 */
  function brokenCopiesOf(run, def) {
    const spec = markSpecOf(def);
    if (!spec || !run) return 0;
    let n = 0;
    for (const m of (run.brokenMarks || [])) {
      if (!m || m.kind !== spec.kind) continue;
      if (spec.kind === 'stat' && m.stat !== spec.stat) continue;
      if (!m.legacy) { n += 1; continue; }
      const v = Number(spec.kind === 'stat' ? m.pct : m.burned) || 0;
      n += spec.per > 0 ? Math.round(v / spec.per) : (v > 0 ? 1 : 0);
    }
    return n;
  }
  /** 收回**一层已损毁**（巡逻收缴：把这个烙印交出去）—— 与 loseRandomBrokenMark 同一套记账：
   *  摘掉一条明细 →（终焉烙印另记一份 `fragileMulBurned`）→ rebuildFragileTotals 重算合计。
   *  ⚠ 合计是**从明细重算**出来的：只改 run.fragileBurned 而不动明细，下一次重建就会把收回的那层加回来。 */
  function loseOneBrokenCopy(run, def) {
    const spec = markSpecOf(def);
    if (!spec || !run) return false;
    const marks = Array.isArray(run.brokenMarks) ? run.brokenMarks : (run.brokenMarks = []);
    const hit = (m) => m && m.kind === spec.kind && (spec.kind !== 'stat' || m.stat === spec.stat);
    let idx = marks.findIndex((m) => hit(m) && !m.legacy);
    if (idx >= 0) {
      marks.splice(idx, 1);
    } else {
      /* 旧档：只剩一条「不可移除」的 legacy 明细 → 按一份折算，减到 0 才摘掉。 */
      idx = marks.findIndex(hit);
      if (idx < 0) return false;
      const m = marks[idx];
      const cur = Number(spec.kind === 'stat' ? m.pct : m.burned) || 0;
      const left = Math.max(0, cur - spec.per);
      if (left <= 1e-9) marks.splice(idx, 1);
      else if (spec.kind === 'stat') m.pct = left;
      else m.burned = left;
    }
    if (spec.kind === 'final') run.fragileMulBurned = Math.max(0, Math.floor(Number(run.fragileMulBurned) || 0) - 1);
    rebuildFragileTotals(run);
    return true;
  }
  /** 把一条增益**退回 buff 池**（用户口径：交出淘金烙印之后它要能再刷出来）。
   *  可获得性看 `obtainedCountOf = max(在册, fragileGot, pickGot)`，而烙印「本局获得过几份」
   *  记在只增不减的 `run.fragileGot` 上 —— 所以这里按 1 份退回去。 */
  function returnBuffToPool(run, id) {
    if (!run || !id) return false;
    let changed = false;
    const refund = (key) => {
      const t = run[key];
      const cur = Math.max(0, Math.floor(Number(t && t[id]) || 0));
      if (cur <= 0) return;
      run[key] = Object.assign({}, t);
      if (cur - 1 > 0) run[key][id] = cur - 1; else delete run[key][id];
      changed = true;
    };
    refund('fragileGot');
    refund('pickGot');
    return changed;
  }
  /** 收缴候选的**原始列表**：本局当前在生效的全部条目（还没按稀有度过滤）。
   *  每条：{ ref, id, name, rarity, cat: 'row'|'brand'|'insc', def, row, alive, broken, stacks, … }
   *  · 'row'   = 背包里还有行（alive 层）；'brand' = 行没了、只剩已损毁的加成；'insc' = 已附魔成功的铭文。 */
  function patrolTollRows(run) {
    if (!run) return [];
    const agg = Object.create(null);
    const touch = (id, def) => (agg[id] || (agg[id] = { id: id, def: def, row: null, alive: 0, broken: 0 }));
    /* ① 背包里的永久 / 限次（未破碎的烙印也在这里）。 */
    for (const row of (run.permanent || []).concat(run.limited || [])) {
      const def = D().BUFF_BY_ID[row && row.id];
      if (!row || !def) continue;
      if (D().hasTag(def, 'hidden') || def.kind === 'instant') continue;
      const stacks = Math.max(0, Math.floor(Number(row.stacks) || 0));
      if (stacks <= 0) continue;
      const a = touch(row.id, def);
      if (!a.row) a.row = row;
      a.alive += stacks;
    }
    /* ② 已损毁的烙印：行已经不在 limited 里了，但加成还挂着（用明细认领，顺带处理旧档 legacy 明细）。 */
    for (const m of (run.brokenMarks || [])) {
      const def = brandDefOfMark(m);
      if (!def || D().hasTag(def, 'hidden')) continue;
      touch(def.id, def).broken = brokenCopiesOf(run, def);      // 同一条的多份明细只算一次
    }
    const out = [];
    for (const id of Object.keys(agg)) {
      const a = agg[id];
      const stacks = a.alive + a.broken;
      if (stacks <= 0) continue;
      out.push({ ref: (a.row && a.row.uid != null) ? a.row.uid : ('brand:' + id), id: id,
        name: a.def.name, rarity: Number(a.def.rarity) || 0, cat: a.alive > 0 ? 'row' : 'brand',
        def: a.def, row: a.row, alive: a.alive, broken: a.broken, stacks: stacks,
        slotFree: a.row ? rowFreeOf(a.row) : false, enchMul: a.row ? rowEnchMulOf(a.row) : 1 });
    }
    /* ③ 已经附魔成功的铭文：本身不占栏位，所以上面两张表里都没有它。 */
    const insc = Object.create(null);
    for (const row of (run.permanent || [])) {
      if (!row) continue;
      if (rowFreeOf(row)) insc.C37 = (insc.C37 || 0) + 1;
      for (const eid of rowEnchantsOf(row)) insc[eid] = (insc[eid] || 0) + 1;
    }
    for (const id of Object.keys(insc)) {
      const def = D().BUFF_BY_ID[id];
      /* ⚠ 铭文一律可交：它们本来就带 `hidden` 标签（那只是「不进本局构筑面板、不可出售」的意思），
       * 不能照抄上面那条 hasTag(hidden) 过滤 —— 否则用户要的「交出虚空铭文」根本进不了候选。 */
      if (!def || def.kind !== 'inscription') continue;
      out.push({ ref: 'insc:' + id, id: id, name: def.name, rarity: Number(def.rarity) || 0, cat: 'insc',
        def: def, row: null, alive: insc[id], broken: 0, stacks: insc[id], slotFree: false, enchMul: 1 });
    }
    return out;
  }
  /** 收缴候选：只给「最高稀有度」那一档（上下翻页由界面负责）。
   *  参数可省 —— 界面就是不带参数调的（默认取当前无尽塔对局）。 */
  function patrolTollCandidates(runArg) {
    const run = runArg || endless().run;
    if (!run) return { top: -1, list: [] };
    const rows = patrolTollRows(run);
    if (!rows.length) return { top: -1, list: [] };
    const top = rows.reduce((a, x) => Math.max(a, x.rarity), 0);
    const list = rows.filter((x) => x.rarity === top).map((x) => ({
      ref: x.ref, id: x.id, name: x.name, rarity: x.rarity, kind: x.def.kind, cat: x.cat,
      stacks: Math.max(1, x.stacks), alive: x.alive, broken: x.broken,
      /* 【2026-10 第七十四批】附魔状态也逐条给界面：收缴是「挑一条交出去」的场景，
       * 玩家得看得出哪一条被铭文强化过（水晶 ×1.5 / 虚空 不占位），别把加成高的那条交掉。 */
      slotFree: x.slotFree === true, enchMul: x.enchMul,
    }));
    return { top: top, list: list };
  }
  /** 交出 `ref`（uid 优先）那一栏 —— 只掉一层。
   *  参数灵活：`payPatrolToll(ref)`（界面口径，默认当前对局）或 `payPatrolToll(run, ref)`。
   *  `ref` 取候选里的 `ref`：栏位 uid / `brand:<id>`（只剩已损毁层的烙印）/ `insc:<id>`（已附魔的铭文）。 */
  function payPatrolToll(a, b) {
    const byRun = !!(a && typeof a === 'object');
    const run = byRun ? a : endless().run;
    const ref = byRun ? b : a;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    const all = patrolTollRows(run);
    const cand = all.find((x) => String(x.ref) === String(ref)) || all.find((x) => x.id === ref);
    if (!cand) return { ok: false, msg: '找不到这个增益。' };
    const def = cand.def || {};
    const stacks = Math.max(1, Math.floor(Number(cand.stacks) || 1));
    const note = () => {
      run.patrolTolls = (Array.isArray(run.patrolTolls) ? run.patrolTolls : [])
        .concat([{ id: cand.id, name: def.name || cand.id, stacks: stacks, rarity: Number(def.rarity) || 0, layer: run.layer }]);
    };
    /* ① 铭文（不占栏位）：不按层数掉，改为「随机取消一份附魔」。 */
    if (cand.cat === 'insc') {
      note();
      const free = !!(def.mods && def.mods.pickPermanentFree);
      let undone = null;
      if (free) {
        const enchanted = (run.permanent || []).filter((b) => b && rowFreeOf(b));
        if (enchanted.length) {
          undone = enchanted[Math.floor(Math.random() * enchanted.length)];
          undone.slotFree = false;
          syncSlotFree(run);
        }
      } else {
        /* 倍率铭文（水晶 C60）：撤掉随机一条上的这张铭文，并把倍率按剩下的铭文重算。 */
        const marked = (run.permanent || []).filter((b) => b && rowEnchantsOf(b).indexOf(cand.id) >= 0);
        if (marked.length) {
          undone = marked[Math.floor(Math.random() * marked.length)];
          undone.enchants = rowEnchantsOf(undone).filter((x) => x !== cand.id);
          let mul = 1;
          for (const eid of undone.enchants) {
            const ed = D().BUFF_BY_ID[eid] || {};
            mul *= Math.max(1, Number(ed.mods && ed.mods.pickPermanentMul) || 1);
          }
          undone.enchMul = mul;
        }
      }
      logBuff(run, cand.id, 'lose', { detail: '巡逻收缴：随机取消一份附魔（' +
        (undone ? (D().BUFF_BY_ID[undone.id] || {}).name : '无') + '）' });
      save();
      /* 取消「不占位」会让永久位重新占满 —— 溢出时让玩家再丢一个。倍率铭文不影响占位。 */
      const over = free && permUsed(run) > permSlots(run);
      if (over) run.phase = 'patrolDiscard';
      return { ok: true, id: cand.id, name: def.name, undone: undone ? undone.id : null, needDiscard: over };
    }
    /* ② 烙印的**已损毁层**优先收回（用户口径：交出终焉烙印 = 层数 -1；交出淘金烙印 = 失去增幅 + 退回池子）。 */
    if (cand.broken > 0) {
      note();
      const done = loseOneBrokenCopy(run, def);
      if (!done) return { ok: false, msg: '这一份已损毁的烙印已经找不到了。' };
      /* 「拾取一次即出池」那类（淘金烙印 C53）要能再刷出来：它已经被池子挡住了才退。 */
      const back = !poolFilter(run, def) ? returnBuffToPool(run, cand.id) : false;
      logBuff(run, cand.id, 'lose', { detail: '巡逻收缴：已损毁层 -1' + (back ? '（已退回 buff 池）' : '') });
      save();
      return { ok: true, id: cand.id, name: def.name, broken: true, backToPool: back,
        left: Math.max(0, stacks - 1) };
    }
    /* ③ 背包里那一栏：只掉一层；掉光了整栏移除（成长按这一栏回收）。 */
    const row = cand.row;
    const hit = findRowRef(run, row && row.uid != null ? row.uid : cand.id);
    if (!row || !hit || !hit.row) return { ok: false, msg: '找不到这个增益。' };
    note();
    row.stacks = stacks - 1;
    let removed = false;
    if (row.stacks <= 0) {
      hit.list.splice(hit.list.indexOf(row), 1);
      removed = true;
      syncSlotFree(run);
      resetGrowth(run, row.id, stacks, row);
      /* 失去之后如果它已经出池了，就让它回到池子里（与已损毁那条同一口径）。 */
      if (!poolFilter(run, def)) returnBuffToPool(run, cand.id);
    }
    logBuff(run, row.id, 'lose', { detail: '巡逻收缴 -1 层' + (removed ? '（已交出整栏）' : '') });
    save();
    return { ok: true, id: row.id, name: def.name, left: Math.max(0, row.stacks || 0), removed: removed };
  }
  /** 收缴结束（界面点「继续」）：清掉阶段，**并推进到下一场**。
   * 【2026-10 第七十八批修 bug】这里原来只清 `phase` / `patrolTollAt`，**层内序号没动** ——
   * 于是下一次 `nextBattle` 取到的还是**同一场巡逻**，玩家交完 buff 又被扔回这场战斗的开头，
   * 永远过不去（用户实测「失败献出 buff 后回到巡逻战斗开始」）。
   * 现在与胜利路径同一套推进：`run.idx + 1`；本层打完就 `layerClear()` —— 它自己会按
   * x5（开结算商店，走 continueFromShop → advanceLayer）还是非 x5（直接 advanceLayer）处理。
   * 刻意**不**做胜利路径的另外几件事：不扣限次（输了不给收益，也就不存在「白扣一次」）、
   * 不摇 6% 烙印磨损、不推进环境场数 —— 这一场是输的，只赔一个增益；血量照旧（run.hpAbs 不动）。 */
  function finishPatrolToll() {
    const run = endless().run;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    /* 两种收缴阶段都算数：patrolToll（刚输）/ patrolDiscard（交出虚空铭文后永久位溢出，接着丢）。 */
    const wasToll = run.phase === 'patrolToll' || run.phase === 'patrolDiscard';
    run.phase = null;
    run.patrolTollAt = null;
    if (!wasToll) { save(); return { ok: true }; }
    run.idx = Math.max(0, Math.floor(Number(run.idx) || 0)) + 1;
    const out = { ok: true, patrol: true, advanced: true, battleNo: run.idx + 1 };
    if (run.idx >= run.plan.length) return layerClear('endless', run, out, 0, false);
    save();
    return out;
  }
  /** 「巡逻」魔王身上那套**橙色狂战甲**的套装收益（2026-10 第七十四批用户口径）：
   *  「不只是外壳，要实际拥有狂战套的性能」→ 走**玩家吃套装收益的同一条通道**：
   *   · 属性部分（力量…）直接加到面板；
   *   · 战斗修正（暴击率 / 低血终乘 / 低血加攻 / 低血吸血 / 阈值）写进 `foe.setFx`，
   *     由 sim 的 `setFx()` 读 —— 与玩家穿齐这套时**同一个函数、同一份数值表**，
   *     所以「魔王吃到的增益和玩家一致」在套装这一路上是结构上成立的，不是抄了一份数字。
   *  装备 id 取 `GEAR[PATROL.setKey]`（= 玩家能拿到的 50 级传说档狂战套），
   *  家族「狂战」在 `SET_BONUS_FAMILY_FLOOR` 里有品质下限 4 → 本来就按**橙档**系数算。
   *  幂等：重复调用只会把同一份修正再写一遍（属性会重复加，所以只在两处「重置面板之后」调）。 */
  function applyPatrolSet(foe, level) {
    if (!foe) return null;
    const ids = (D().wearsOf && D().PATROL && D().PATROL.setKey) ? D().wearsOf(D().PATROL.setKey) : [];
    if (!ids.length || !State.setBonusEffects) return null;
    const eff = State.setBonusEffects(ids.map((w) => ({ id: w.id, used: true })), level);
    const st = eff.stats || {};
    for (const k of ['power', 'agility', 'speed']) {
      if (st[k]) foe[k] = Math.max(1, Math.round((Number(foe[k]) || 0) + Number(st[k])));
    }
    if (st.hp) {
      /* 生命上限跟在当前血后面一起抬（与 applyFoeSetBonuses 的加法同口径）。 */
      const add = Math.max(0, Math.round(Number(st.hp)));
      foe.hp = Math.max(1, Math.round((Number(foe.hp) || 0) + add));
      foe.maxHp = Math.max(Number(foe.maxHp) || 0, foe.hp);
    }
    const fx = eff.fx || {};
    if (Object.keys(fx).length) foe.setFx = Object.assign({}, foe.setFx, fx);
    foe.patrolSet = { family: (D().PATROL && D().PATROL.setKey) || '', stats: st, fx: fx };
    return eff;
  }
  /** x0 层的魔王：额外持有玩家**此前上交过的所有增益**（按上交时的快照生效）。
   *  · **纯运营类**（试炼币 / 商店 / 出售 / 铸币这些对「一对一面板」没意义的）→ **不生效**（用户口径）；
   *  · 属性类 → 直接乘到魔王的力/敏/速/生命上；
   *  · **挥金如土（C36）→ 生效**：玩家此后每在试炼商店消费，魔王按同一套分段吃成长
   *   （用户口径：「按照离开玩家时候的增益进行生效」→ 用上交时的分段快照，记进 run.patrolShopGift）。 */
  function applyPatrolTollToFoe(run, foe) {
    const list = Array.isArray(run && run.patrolTolls) ? run.patrolTolls : [];
    if (!foe || !list.length) return 0;
    let n = 0;
    const names = [];
    for (const it of list) {
      const def = D().BUFF_BY_ID[it.id];
      const m = (def && def.mods) || null;
      if (!def || !m) continue;
      const k = Math.max(1, Math.floor(Number(it.stacks) || 1));
      if (isPureOpsBuff(def)) { names.push(def.name + '（运营类·不生效）'); continue; }
      /* 挥金如土：登记分段，之后玩家消费就给魔王加属性。 */
      if (m.shopSpendStep) {
        run.patrolShopGift = { step: Number(m.shopSpendStep) || 5, stat: Number(m.shopSpendStat) || 1,
          hp: Number(m.shopSpendHp) || 5 };
        names.push(def.name + '（生效：你在商店每消费 ' + (Number(m.shopSpendStep) || 5) + ' 试炼币，魔王就长一点）');
        n++;
        continue;
      }
      if (m.powerMul) foe.power = Math.max(1, Math.round(foe.power * (1 + m.powerMul * k)));
      if (m.agilityMul) foe.agility = Math.max(1, Math.round(foe.agility * (1 + m.agilityMul * k)));
      if (m.speedMul) foe.speed = Math.max(1, Math.round(foe.speed * (1 + m.speedMul * k)));
      if (m.maxHpMul) { foe.hp = Math.max(1, Math.round(foe.hp * (1 + m.maxHpMul * k))); foe.maxHp = foe.hp; }
      /* ⚠ 暴击 / 减伤这类**只能从 mods 读**（见 sim 的 critChance 与 applyDamage），
       * 写成 foe.critBonus / foe.takenMul 这种裸字段**根本没人读** —— 2026-10 第八十二批顺手修掉：
       * 以前玩家把「鹰眼 / 坚守」这类交给魔王，魔王其实一点没吃到。 */
      foe.mods = foe.mods || {};
      if (m.critBonus) foe.mods.critBonus = Math.max(0, Number(foe.mods.critBonus) || 0) + m.critBonus * k;
      if (m.takenMul) foe.mods.takenMul = Math.max(-0.8, Number(foe.mods.takenMul) || 0) + m.takenMul * k;
      names.push(def.name);
      n++;
    }
    /* 挥金如土在玩家消费时累积的那一份（见 addShopSpend）。 */
    const gain = run.patrolFoeGain;
    if (gain) {
      foe.power = Math.max(1, Math.round(foe.power + (Number(gain.power) || 0)));
      foe.agility = Math.max(1, Math.round(foe.agility + (Number(gain.agility) || 0)));
      foe.speed = Math.max(1, Math.round(foe.speed + (Number(gain.speed) || 0)));
      if (Number(gain.hp) > 0) { foe.hp = Math.max(1, Math.round(foe.hp + Number(gain.hp))); foe.maxHp = foe.hp; }
      names.push('商店消费成长 +' + [gain.power, gain.agility, gain.speed, gain.hp].map((v) => Number(v) || 0).join('/'));
    }
    foe.tollBuffs = names;
    return n;
  }
  /** x00「最后的魔王」额外固定持有的两件**涅槃plus** + 两件**已破碎的终焉烙印**
   *（2026-10 第八十二批用户口径；只给 x00，寻常巡逻层那只不额外持有）。
   *
   *  · 涅槃plus：`deathSaves` 里两条带 `bossLife: true` 的条目 —— 死亡时回满血（100% 生命上限），
   *    并**当场**生命上限 +20%、受到伤害 −15%；第二件触发时这两项叠加（上限 +40%、减伤 30%）。
   *    触发逻辑在 sim 的 `consumeDeathSave`（先抬上限、再按 healPct 回血、减伤并进 mods.takenMul）。
   *    `bossLife` 还有一层作用：**「假如我直接赢」（E17）只吃掉一条命**（见 sim 的 openKill 分支）——
   *    普通敌人的装死 / 涅槃照旧被 E17 无视，只有魔王的命算数。
   *    于是它一共 **3 条命**（本体 + 两件涅槃plus）。
   *  · 两件破碎的终焉烙印：终乘 ×(1 + 0.30×2) = **×1.6** 乘进力/敏/速/生命上限，
   *    与玩家侧 `fragileFinalMul` 同一套口径（存在 +20%/层、损毁 +30%/层，按层加算）。
   *    放在**最后**乘：前面的面板复制与「玩家上交过的增益」都算完之后再终乘。 */
  function applyDemonLordLives(foe) {
    if (!foe) return null;
    const P = D().PATROL || {};
    const lives = Math.max(0, Math.floor(Number(P.bossLives) || 0));
    const brands = Math.max(0, Math.floor(Number(P.bossBrokenBrands) || 0));
    const perBrand = Math.max(0, Number(P.bossBrokenFinal) || 0);
    foe.mods = Object.assign({}, foe.mods || {});
    /* 命数**直接摆回设计值**（不是无脑追加）：
     *   · 保证幂等 —— adjustMe 被调两次不会变 4 条命；
     *   · 也是自愈 —— 万一上一次模拟/别的路径把命吃掉了几条，下一次 adjustMe 会把两条命摆回来；
     *   · 只保留非 bossLife 的免死条目（例如上交增益带来的），别把别人的命删了。 */
    if (lives > 0) {
      const one = () => ({
        healPct: Math.max(0, Number(P.bossLifeHealPct) || 1),
        maxHpMul: Math.max(0, Number(P.bossLifeMaxHpMul) || 0),
        takenMul: Number(P.bossLifeTakenMul) || 0,
        revive: true, bossLife: true, name: '涅槃+',
      });
      const list = [];
      for (let i = 0; i < lives; i++) list.push(one());
      const keep = (Array.isArray(foe.mods.deathSaves) ? foe.mods.deathSaves : []).filter((sv) => !(sv && sv.bossLife));
      foe.mods.deathSaves = list.concat(keep);
    }
    const mul = 1 + perBrand * brands;
    if (mul > 1) {
      const beforeMax = Math.max(1, Number(foe.maxHp) || 1);
      const ratio = Math.max(0, Math.min(1, (Number(foe.hp) || 1) / beforeMax));
      for (const k of ['power', 'agility', 'speed']) foe[k] = Math.max(1, Math.round((Number(foe[k]) || 1) * mul));
      foe.maxHp = Math.max(1, Math.round(beforeMax * mul));
      foe.hp = Math.max(1, Math.round(foe.maxHp * ratio));
      foe.brokenBrandFinalMul = mul;
    }
    foe.demonLives = lives + 1;              // 本体 + N 条涅槃plus（界面 / 调试用）
    return foe;
  }
  /** 「纯运营类」增益判据（巡逻魔王持有它们时不生效，用户口径 2026-10 第六十三批）：
   *  效果**只**落在试炼币 / 商店 / 出售 / 铸币这些「一对一面板」上，对一场战斗没有意义。 */
  const PATROL_PURE_OPS_MODS = ['instantCoins', 'coinBoostPct', 'shopDiscount', 'sellValue',
    'sellGrowthPerWin', 'shopEnterCoins', 'instantRetry', 'rerollTiltMul', 'shopHalf',
    'postBattleShop', 'postBattleMintShop', 'postBattleShopDiscount', 'shopSpendLimited',
    'limitedDefaultRerollPaid', 'layerRestart', 'coinFragilePct'];
  function isPureOpsBuff(def) {
    const keys = Object.keys((def && def.mods) || {});
    if (!keys.length) return false;
    return keys.every((k) => PATROL_PURE_OPS_MODS.indexOf(k) >= 0);
  }
  /** 让**所有**烙印立刻破碎（烙印升华 E20）；返回碎掉的份数与名字。 */  function breakAllBrands(run) {
    const names = [];
    let total = 0;
    for (const row of (run && run.limited) || []) {
      if (!isBrandBuff(D().BUFF_BY_ID[row && row.id]) || row.on === false) continue;
      const n = breakBrandRow(run, row);
      if (n > 0) { names.push(D().BUFF_BY_ID[row.id].name + '×' + n); total += n; }
    }
    if (run && run.limited) run.limited = run.limited.filter((b) => Math.max(0, Math.floor(Number(b.stacks) || 0)) > 0);
    return { copies: total, names: names };
  }
  function rollFragileBuffs(run) {    const broken = [];
    run.limited = (run.limited || []).filter((b) => {
      const def = D().BUFF_BY_ID[b.id];
      const pct = def && def.mods && def.mods.fragileBreakPct;
      if (!pct || b.on === false) return true;
      /* 每一份各摇各的：同时碎几份就掉几份；一份不剩才移除整栏。 */
      const copies = Math.max(1, Math.floor(Number(b.stacks) || 1));
      for (let i = 0; i < copies; i++) {
        if (!fragileRoll(run, b, Number(pct))) continue;
        broken.push(def.name);
        breakOneFragileCopy(run, def, b);
        b.stacks = Math.max(0, Math.floor(Number(b.stacks) || 1) - 1);
        logBuff(run, b.id, 'break', { uid: b.uid, detail: '易碎损毁（这一份升级为全额并永久保留）' });
      }
      return (Math.floor(Number(b.stacks) || 0)) > 0;
    });
    return broken;
  }
  /** 选取型强化（C32 神兵淬炼 / C33 秘技通神）被移除时，把它们的加成一起清掉。
   *  所有「失去这条增益」的路径都必须经过这里 —— 否则会出现
   *  「加成还在、增益已经没了」，而它们 unique、再也刷不到第二次。
   *  （resetGrowth 里也调一次，卖出 / 替换 / 铸币交换都覆盖得到。） */
  function dropPickBoost(run, id) {
    if (!run) return false;
    if (id === 'C32') { run.weaponBoost = {}; return true; }
    if (id === 'C33') { run.skillBoost = {}; return true; }
    return false;
  }
  /** 失去一条增益时的成长回收（卖出 / 交换 / 替换 / 调试移除）。
   *  【2026-10 同名逐条】`row` 是**被移除的那一条**（已经从表里摘掉）：
   *    · 只扣**这一栏账本里**的成长（`row.grow`），同名其它栏不受影响；
   *    · C07 / C11 是「粘性」的 —— 把这一条攒到的量折算进 run.hpBonus；
   *    · C48 按老口径**保留**累计减伤，不扣。
   *  不传 `row` 时退回旧口径（老调用点 / 测试兜底）：按 id 清掉 run 级字段。 */
  function resetGrowth(run, id, stacks, row) {
    if (!run) return false;
    const n = Math.max(1, Math.floor(Number(stacks) || 1));      // 卖出/失去的是**整条**（含所有层数）
    /* 【同名逐条】这条行**有没有自己的账本**：
     *   · 有 → 只扣它那一份（同名其它栏不受影响）；
     *   · 没有（老档 / 外部直接塞进表里的行）→ 按老口径把它当成「整份 run 级累计」处理。 */
    const hasLedger = !!(row && row.grow && Object.keys(row.grow).length);
    const perRow = !!row && hasLedger;
    const rowGrow = (key) => (perRow ? growOf(row, key) : 0);
    if (id === 'C06') {
      if (perRow) subGrow(run, row, 'killPower'); else run.killPower = 0;
    }
    else if (id === 'C07') {
      const v = perRow ? rowGrow('winMaxHp') : Math.max(0, Number(run.winMaxHp) || 0);
      run.hpBonus = Math.max(0, Number(run.hpBonus) || 0) + v;
      if (perRow) subGrow(run, row, 'winMaxHp'); else run.winMaxHp = 0;
    }
    else if (id === 'C11') {
      const flat = perRow ? rowGrow('winHpFlat') : Math.max(0, Number(run.winHpFlat) || 0);
      const base = Math.max(1, Number(run.baseMaxHp) || 0);
      run.hpBonus = Math.max(0, Number(run.hpBonus) || 0) + (base > 0 ? flat / base : 0);
      if (perRow) subGrow(run, row, 'winHpFlat'); else run.winHpFlat = 0;
    }
    else if (id === 'C12') {
      if (perRow) { subGrow(run, row, 'winStatPower'); subGrow(run, row, 'winStatAgility'); subGrow(run, row, 'winStatSpeed'); }
      else { run.winStatPower = 0; run.winStatAgility = 0; run.winStatSpeed = 0; }
    }
    /* 选取型强化（C32 神兵淬炼 / C33 秘技通神）：加成是绑在这条增益身上的，
     * 卖出/被替换时必须一起清掉，否则「加成还在、增益已经没了」——
     * 而且它们 unique，再也刷不到第二次。 */
    else if (id === 'C32' || id === 'C33') dropPickBoost(run, id);
    /* C48 铜墙铁壁：它的「已累计减伤」同样是本局攒出来的收益，替换/卖出后**保留**
     *（与 C07/C11 一致），所以这里不清零、也不扣账本。 */
    else if (id === 'C25') { if (perRow) subGrow(run, row, 'sellBonus'); else run.sellBonus = 0; }
    /* 天命所归（C51）：永久件被卖出/替换，稀有度加成也要一起收回（否则「加成还在、增益没了」）。 */
    else if (id === 'C51') run.rarityBoost = Math.max(0, Math.floor(Number(run.rarityBoost) || 0) - n);
    else if (id === 'C36') {
      if (!perRow) {
        run.spendGain = { power: 0, agility: 0, speed: 0, hp: 0 };
        run.shopSpend = 0; run.shopSpendProcs = 0;
        clearSpendProgress(run, 'C36');            // 【2026-10】各栏自己的进度也要清
      }
    }
    else {
      const def = D().BUFF_BY_ID[id];
      if (def && def.mods && def.mods.fragileStat) {
        /* 主动卖出/被换掉：基础那份按层数收回（损毁得到的永久份保留 —— 那是 6% 判定给的奖励）。 */
        const key = def.mods.fragileStat;
        const pct = Math.max(0, Number(def.mods.fragilePct) || 0);
        run.fragileBase = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBase || {});
        run.fragileBase[key] = Math.max(0, run.fragileBase[key] - pct * n);
        return true;
      }
      /* 终乘（C49）/ 治疗（C52）/ 淘金（C53）烙印：主动失去时把**未破碎的那一份**按层数收回 ——
       * 损毁得到的永久份保留（与属性烙印同一口径）。
       * 注意 run.fragileGot（「一局获得过几份」）不回退：那是层数上限与重复降权的口径，
       * 与「现在还持有几份」无关（否则卖掉再买回来就能绕开层数上限）。 */
      if (def && def.mods && def.mods.fragileFinalMul) {
        run.fragileMulBase = Math.max(0, Math.floor(Number(run.fragileMulBase) || 0) - n);
        return true;
      }
      if (def && def.mods && def.mods.fragileHealAddAlive !== undefined) {
        /* 涌泉烙印被卖掉/换掉：未破碎的那一份按层数收回（损毁得到的永久份保留）。 */
        run.fragileHealBase = Math.max(0, Math.floor(Number(run.fragileHealBase) || 0) - n);
        return true;
      }
      if (def && def.mods && def.mods.fragileCoinAddAlive !== undefined) {
        run.fragileCoinBase = Math.max(0, Math.floor(Number(run.fragileCoinBase) || 0) - n);
        return true;
      }
      return false;
    }
    return true;
  }
  /* ============================================================
   * 【T15】增益的获得 / 失去 / 即时生效 —— addBuff / applyInstant / toggleLimited
   * ============================================================ */
  /** 「获得这个增益时」立刻要结算的东西（新增与叠加两条路径都要走）。
   *  · 易碎烙印：登记存在时的加成（`fragilePct`）；损毁后换成 `fragileBurnedPct` 并本局永久保留
   *  · 生命上限增益：按字面「回复等量生命」—— 新上限比旧上限多出来的部分补进当前血量
   *    （原来只保持百分比，玩家看到血条没动就以为没生效）。比例推一下与上限无关：
   *      carry' = (carry + m) / (1 + m)   （m 为 maxHpMul，负值则同步缩血） */
  function applyBuffOnAcquire(run, buff) {
    /* 天命所归（C51）：2026-10 起由**即时**改为**永久**，而 permanent 不经过 applyInstant ——
     * 所以稀有度加成必须在「获得时」写进 run.rarityBoost（数量就是本局的加成层数）。 */
    if (buff.mods && buff.mods.rarityBoost) {
      run.rarityBoost = Math.max(0, Math.floor(Number(run.rarityBoost) || 0)) + 1;
    }
    /* 永久增益的生命上限加成是**粘性**的（拿到就折算进 run.hpBonus，卖掉不回落），
     * 所以每一次「获得」都要折算一次 —— 任务3 之后同栏位叠层也要算，
     * 否则第 2/3 层会白拿（只有开新栏位那条路才会加）。 */
    if (buff.kind === 'permanent' && buff.mods && buff.mods.maxHpMul) {
      run.hpBonus = Math.max(0, Number(run.hpBonus) || 0) + Number(buff.mods.maxHpMul);
    }
    /* 终乘烙印：每获得一份就 +1 层（没有次数上限，重复获得按层加算）。 */
    if (buff.mods && buff.mods.fragileFinalMul) {
      run.fragileMulBase = Math.max(0, Math.floor(Number(run.fragileMulBase) || 0)) + 1;
    }
    if (buff.mods && buff.mods.fragileHealAddAlive !== undefined) {
      run.fragileHealBase = Math.max(0, Math.floor(Number(run.fragileHealBase) || 0)) + 1;
    }
    if (buff.mods && buff.mods.fragileStat) {
      const key = buff.mods.fragileStat;
      run.fragileBase = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBase || {});
      run.fragileBurned = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBurned || {});
      run.fragileBase[key] += Math.max(0, Number(buff.mods.fragilePct) || 0);
    }
    if (buff.mods && buff.mods.fragileBreakPct) {
      run.fragileGot = Object.assign({}, run.fragileGot || {});
      run.fragileGot[buff.id] = Math.max(0, Math.floor(Number(run.fragileGot[buff.id]) || 0)) + 1;
      /* 淘金烙印（C53）：登记「未破碎份数」，损毁时再转进 run.fragileCoinBurned。 */
      if (buff.mods.fragileCoinAddAlive !== undefined) {
        run.fragileCoinBase = Math.max(0, Math.floor(Number(run.fragileCoinBase) || 0)) + 1;
      }
      run.fragileSeeds = Object.assign({}, run.fragileSeeds || {});
      /* 计分扩展：成就 / 加成峰值 / 复活计数 / 本局加分流水。 */
      run.achievements = Array.isArray(run.achievements) ? run.achievements.slice(0, 40) : [];
      run.scoreLog = Array.isArray(run.scoreLog) ? run.scoreLog.slice(-60) : [];
      run.statPeaks = Object.assign({}, run.statPeaks || {});
      run.pendingToasts = Array.isArray(run.pendingToasts) ? run.pendingToasts.slice(0, 12) : [];
      run.deathSaves = Math.max(0, Math.floor(Number(run.deathSaves) || 0));
      run.reviveCount = Math.max(0, Math.floor(Number(run.reviveCount) || 0));
      run.reviveTierPaid = Math.max(0, Number(run.reviveTierPaid) || 0);
    }
    if (buff.mods && buff.mods.shopDiscount) {
      run.shopDiscount = Math.max(0, Math.floor(Number(run.shopDiscount) || 0)) + 1;
      run.shopDiscountPct = Math.max(Number(run.shopDiscountPct) || 0, Number(buff.mods.shopDiscount) || 0);
    }
    /* E01「立即进货」**不再往 run 上写缓存**：它的效果（战后开店 + 5 折）由
     * activeShopCredit(run) 在「这一场打完之后」按条目当时是否开着现算 ——
     * 玩家把它关掉就该立刻不生效（原来写死的 run.postBattleShop 关掉也照样开店）。
     * 与 steam大促（−30%）的合并也挪到 makeShop 里（谁先拿都不影响结果）。 */
    /* C01「磐石之躯」：获得时立刻按当前（局外口径）生命上限回血。 */
    if (buff.mods && buff.mods.healOnGainPct) {
      healAbs(run, Number(buff.mods.healOnGainPct) * globalMul(run) * healBonusMul(run), currentMaxHp(run));
    }
  }
  /** 获得顺序号：商店的「出售增益 / 免费交换」列表要按**获得先后倒序**排，
   *  最新拿到的排在最上（点开就能卖刚拿到的那条）。permanent / limited 两张表各自有序，
   *  但合起来不知道谁先谁后，所以每条在**第一次拿到**时盖一个自增序号 `at`
   *  （叠层 / 关开关 / 卖出买回都不会改它，只有真的新增一条才递增）。老档的补号在 normalizeRun 里做。 */
  function nextAcqSeq(run) {
    run.acqSeq = Math.max(0, Math.floor(Number(run.acqSeq) || 0)) + 1;
    return run.acqSeq;
  }
  /* ---------------------------------------------------------------------------
   * 【2026-10 任务2】栏位身份（uid）与「附魔免占位」的**逐条**标记
   *
   * 同名增益可以并排占多个背包栏位（任务3 起），于是「同名」不再等于「同一条」：
   *   · 不同叠层类的同名件各有各的层数，不能互相借用；
   *   · 虚空铭文附魔**只作用于被点的那一条**，不能把同名的另一条也标成「已附魔（不占位）」。
   * 做法：每条栏位盖一个自增 `uid`（暗中标记，界面不显示），附魔改记在**行上**（`row.slotFree`）；
   * `run.slotFreeIds` 降级为**镜像**（被附魔行的 id 去重），旧档 / 探针 / 统计继续能读。
   * ------------------------------------------------------------------------- */
  function nextUid(run) {
    run.rowUidSeq = Math.max(0, Math.floor(Number(run.rowUidSeq) || 0)) + 1;
    return run.rowUidSeq;
  }
  function rowFreeOf(row) { return !!(row && row.slotFree === true); }
  /* ---------- 铭文附魔（2026-10：铭文独立成 `kind: 'inscription'`） ----------
   * 一条永久增益可以吃**多个不同**铭文，但**同一张铭文不能重复附在同一条上**：
   *   · 虚空铭文 C37（`pickPermanentFree`）→ 该条不占永久槽位（沿用旧的 slotFree 字段）；
   *   · 增幅铭文 C60（`pickPermanentMul: 1.5`）→ 该条的效果 × 倍率（可叠乘）。
   * 记账统一放 `row.enchants`（铭文 id 数组，去重）与 `row.enchMul`（倍率乘积，缺省 1）。 */
  function rowEnchantsOf(row) { return (row && Array.isArray(row.enchants)) ? row.enchants : []; }
  function rowEnchMulOf(row) { const m = Number(row && row.enchMul); return Number.isFinite(m) && m > 0 ? m : 1; }
  /** 某张铭文能不能附在这一条上（同一条上同一张铭文只能附一次）。 */
  function rowInscriptionFree(row, inscriptionId) {
    if (!row) return false;
    if (!inscriptionId) return true;
    return rowEnchantsOf(row).indexOf(inscriptionId) < 0;
  }
  /** 给一条永久增益附上增幅铭文：记 id、乘倍率。返回被处理的行。 */
  function markRowInscription(run, row, inscriptionId, mul) {
    if (!run || !row) return null;
    const id = String(inscriptionId || '');
    if (!rowInscriptionFree(row, id)) return null;
    row.enchants = rowEnchantsOf(row).concat([id]);
    const m = Number(mul);
    if (Number.isFinite(m) && m > 0) row.enchMul = rowEnchMulOf(row) * m;
    return row;
  }
  /** 把镜像字段同步成「被附魔行的 id 去重」。
   *  【2026-10 同名逐条】镜像**只**由行上的 `slotFree` 派生 —— 不再保留「名下还没有栏位」的
   *  旧 id 登记：那一套会让「失去被附魔的增益」之后 id 仍留在镜像里，玩家再拿到同名件时
   *  又被 migrateSlotFree 标成已附魔（用户报的「新拿到的同名件显示成已附魔」的根因之一）。
   *  老档的 id 登记只在 normalizeRun 的 migrateSlotFree 里一次性迁到**已存在的**栏位上。 */
  function syncSlotFree(run) {
    if (!run) return;
    const ids = [];
    for (const row of (run.permanent || [])) {
      if (rowFreeOf(row) && ids.indexOf(row.id) < 0) ids.push(row.id);
    }
    run.slotFreeIds = ids;
  }
  /** 按 uid 找栏位（找不到再退回「按 id 找第一条」）。 */
  function findRow(run, ref) {
    const list = (run && run.permanent) || [];
    const n = Math.floor(Number(ref) || 0);
    if (n > 0) { const byUid = list.find((b) => b && Number(b.uid) === n); if (byUid) return byUid; }
    return list.find((b) => b && b.id === ref) || null;
  }
  /** 虚空铭文（C37）的**合法附魔目标**（2026-10 用户口径，用来压掉「大量同名件逐个附魔」）：
   *   · 这一条**已经被附魔** → 仍然可选（但再选一次没有额外收益，界面会标出来）；
   *   · 这一条没被附魔，**但同名的另一条已经被附魔** → **不可选**（挡住同名多栏刷免占位）；
   *   · 其余情况 → 可选。
   *  也就是「同名件里最多只有一条能被虚空铭文附魔」。 */
  function enchantEligible(row, run) {
    if (!row) return false;
    if (rowFreeOf(row)) return true;
    return !(run.permanent || []).some((b) => b && b.id === row.id && rowFreeOf(b));
  }
  /** 一次附魔选取（pendingPick.kind === 'permBuff'）的合法候选判据 —— 按**铭文种类**分派：
   *   · 虚空铭文（免占位）：沿用 enchantEligible —— 同名件里只允许一条被它附魔；
   *     已经被它附过的那一条**仍然可选**（再选一次是空操作，界面会标「已附魔」）→ 老口径不变；
   *   · 增幅铭文（效果倍率）：同一张铭文不能重复附在同一条上（否则倍率会叠乘），
   *     同名**别的**栏位不受影响（各吃各的）。 */
  function inscriptionEligible(row, run, inscriptionId) {
    const buff = D().BUFF_BY_ID[inscriptionId];
    const free = !!(buff && buff.mods && buff.mods.pickPermanentFree);
    if (free) return enchantEligible(row, run);
    return rowInscriptionFree(row, inscriptionId);
  }
  /** 附魔（虚空铭文）：**只标记这一条**。返回被标记的行。 */
  function markRowFree(run, row) {
    if (!run || !row) return null;
    row.slotFree = true;
    syncSlotFree(run);
    return row;
  }
  /** 铭文附魔的落地：C37 免占位、C60 效果 ×倍率。返回给界面用的摘要。
   *  · 虚空铭文：只标 `slotFree`（老口径 —— 重复选同一条是空操作，不记 enchants）；
   *  · 增幅铭文：记 `enchants` + 乘倍率，同一张铭文不能重复附在同一条上。 */
  function applyInscription(run, row, inscriptionId, mul) {
    const buff = D().BUFF_BY_ID[inscriptionId];
    if (buff && buff.mods && buff.mods.pickPermanentFree) {
      markRowFree(run, row);                     // **只标记这一条**（同名另一条不受影响）
      return { slotFree: true, enchMul: rowEnchMulOf(row) };
    }
    const m = mul != null ? mul : (buff && buff.mods && buff.mods.pickPermanentMul) || 0;
    if (!markRowInscription(run, row, inscriptionId, m)) return null;
    return { slotFree: rowFreeOf(row), enchMul: rowEnchMulOf(row), enchants: rowEnchantsOf(row).slice() };
  }
  /** 加一个 buff。永久类要过 5 格上限（满则返回 needsReplace，由界面选一个替换）。 */
  function addBuff(run, id, replaceId) {
    const buff = D().BUFF_BY_ID[id];
    if (!buff) return { ok: false, msg: '没有这个增益' };
    if (buff.kind === 'instant') {
      /* 即时类不进 permanent / limited，所以「已获得几次」要单独记账 ——
       * 这是 E07 挫锐 / E08 卸甲「一局只能生效一次」以及「天命所归」
       * 重复获得降权的判据来源（见 poolFilter 的 maxStacks 与 pickByShopWeight）。 */
      if (buff.maxStacks && instantOwnedCount(run, id) >= Math.max(1, Math.floor(buff.maxStacks))) {
        return { ok: false, msg: '【' + buff.name + '】一局只能获得一次。' };
      }
      bumpInstant(run, id);
      const r = applyInstant(run, buff);
      logBuff(run, id, 'instant', { detail: instantDetail(buff) });
      return r;
    }
    /* 选取型（武器/技能强化）同样不占槽、不触发替换：立即登记，等界面做三选一。 */
    if (buff.mods && (buff.mods.pickWeaponPct || buff.mods.pickSkillPct)) {
      if (!D().hasTag(buff, 'repeatable') && (run.pickBuffIds || []).includes(buff.id)) {
        return { ok: false, msg: '这类选取增益一局只能获得一次。' };
      }
      run.pickBuffIds = (run.pickBuffIds || []).concat([buff.id]);
      notePickGot(run, buff.id);
      run.pendingPick = buff.mods.pickWeaponPct
        ? { kind: 'weapon', buffId: buff.id, pct: buff.mods.pickWeaponPct }
        : { kind: 'skill', buffId: buff.id, pct: buff.mods.pickSkillPct };
      logBuff(run, id, 'get', { detail: '选取型（待选目标）' });
      save();
      return { ok: true, pendingPick: run.pendingPick };
    }
    /* 铭文类（kind: 'inscription'）：**不占栏位**，只登记「待选一条永久增益」。
     * 两种铭文共用这一条路径，差别在落地时（见 applyInscription）：
     *   · C37 虚空铭文（pickPermanentFree）→ 选中的那条不占永久槽位；
     *   · C60 增幅铭文（pickPermanentMul: 1.5）→ 选中的那条效果 ×1.5。
     * 两者都要 `notePickGot`：重复获得时按 0.88^n 降权（与终焉烙印同一口径）。 */
    if (buff.mods && (buff.mods.pickPermanentFree || buff.mods.pickPermanentMul)) {
      if (!D().hasTag(buff, 'repeatable') && (run.pickBuffIds || []).includes(buff.id)) {
        return { ok: false, msg: '这类选取增益一局只能获得一次。' };
      }
      run.pickBuffIds = (run.pickBuffIds || []).concat([buff.id]).filter((v, i, a) => a.indexOf(v) === i);
      notePickGot(run, buff.id);          // 铭文：每次都记一份，降权才有依据（见 pickGotOf）
      logBuff(run, id, 'get', { detail: buff.name + '（待选永久增益）' });
      save();
      /* 没有可选目标（一条永久增益都没有）→ **不要挂 pendingPick**：挂了界面每次都弹同一个
       * 空弹窗，玩家永远选不出来 = 卡死。改成「挂着等目标出现」（见 deferPickIfNoTargets）。 */
      if (!hasPickTargets(run, 'permBuff', buff.id)) return deferPick(run, buff, 'permBuff');
      run.pendingPick = { kind: 'permBuff', buffId: buff.id };
      if (buff.mods.pickPermanentMul) run.pendingPick.mul = Number(buff.mods.pickPermanentMul) || 0;
      return { ok: true, pendingPick: run.pendingPick };
    }
    /* 另外两种铭文（2026-10 第六十一批）：都是由玩家三选一挑一条**已有**增益来操作 ——
     *   · 碎裂铭文 C61（pickBrandBreak）→ 挑一条烙印，让它立刻全部破碎；
     *   · 延续铭文 C62（pickLimitedUses: N）→ 挑一条限次增益（烙印除外），剩余场次 +N。 */
    if (buff.mods && (buff.mods.pickBrandBreak || buff.mods.pickLimitedUses)) {
      if (!D().hasTag(buff, 'repeatable') && (run.pickBuffIds || []).includes(buff.id)) {
        return { ok: false, msg: '这类选取增益一局只能获得一次。' };
      }
      run.pickBuffIds = (run.pickBuffIds || []).concat([buff.id]).filter((v, i, a) => a.indexOf(v) === i);
      notePickGot(run, buff.id);
      const pickKind = buff.mods.pickBrandBreak ? 'brandBuff' : 'limitedBuff';
      logBuff(run, id, 'get', { detail: buff.name + '（待选目标）' });
      save();
      /* 同上：没有可选的烙印 / 限次增益时**不挂 pendingPick**（否则弹窗永远关不掉）。 */
      if (!hasPickTargets(run, pickKind, buff.id)) return deferPick(run, buff, pickKind);
      run.pendingPick = pickKind === 'brandBuff'
        ? { kind: 'brandBuff', buffId: buff.id }
        : { kind: 'limitedBuff', buffId: buff.id, addUses: Math.max(1, Math.floor(Number(buff.mods.pickLimitedUses) || 1)) };
      save();
      return { ok: true, pendingPick: run.pendingPick };
    }
    /* 扩容类（+1/+2 槽位）要先于「永久栏已满」判断处理：它不占槽、也不会触发替换。 */
    if (buff.mods && buff.mods.permSlot) {
      if ((run.permSlotIds || []).includes(buff.id)) return { ok: false, msg: '这类扩容增益一局只能获得一次。' };
      run.permSlots = Math.max(0, Number(run.permSlots) || 0) + Number(buff.mods.permSlot);
      run.permSlotIds = (run.permSlotIds || []).concat([buff.id]);
      logBuff(run, id, 'get', { detail: '永久槽位 +' + Number(buff.mods.permSlot) });
      return { ok: true, granted: buff.mods.permSlot };
    }
    const listKey = buff.kind === 'permanent' ? 'permanent' : 'limited';
    const list = run[listKey] || (run[listKey] = []);
    /* 【任务3 修正】同名可能占多个背包栏位，这里取**最后一个**（最新开的那一栏）：
     * 它没满就往里叠，满了才另开一栏。原来用 `find`（第一个匹配）→ 第一栏满了之后
     * **每一份都新开一栏、每栏永远停在 1 层**（实测 9 栏只能拿到 11 层，而设计上应当是
     * 9 栏 × 3 层 = 27 层）。取最后一栏才能让「叠满后使用另一个背包栏位**继续叠加**」成立。 */
    let owned = null;
    for (const b of list) { if (b && b.id === id) owned = b; }
    /* 本栏位是否已叠满（叠满的永久增益要另开一个背包栏位 —— 任务3）。 */
    let restackSlot = false;
    if (owned) {
      /* 叠层上限：该增益自己的 maxStacks（可叠层的），否则全局 STACK_MAX。 */
      const cap = D().stackCap(buff);
      restackSlot = owned.stacks >= cap;
      /* 【2026-10 第八十一批 用户口径】限次类：**同名再获得 = 直接把份数加到场次上**。
       * 玩家实测：手里有一条限次增益之后，商店 / 场间三选一里还会照常刷出它（池子口径没问题），
       * 但一买就被这里拒掉「已经叠满了（上限 1 层）」—— 于是「持有时还能刷新」等于白刷。
       * 判据见 usesStackable()（普通限次件；烙印/限量件、unique、流程类都不走这条路）。
       * 这条路**只加 uses、不加 stacks、也不开新栏位**，正是用户说的「不需要单独计数」。 */
      const usesOnly = usesStackable(buff);
      if (usesOnly && restackSlot) {
        const addUses = Math.max(1, Math.floor(Number(buff.uses) || 1));
        owned.uses = Math.max(0, Math.floor(Number(owned.uses) || 0)) + addUses;
        owned.on = true;
        applyBuffOnAcquire(run, buff);
        logBuff(run, id, 'stack', { stacks: owned.stacks, detail: '场次 +' + addUses + '（共 ' + owned.uses + '）' });
        save();
        return { ok: true, buff: buff, stacks: owned.stacks, uses: owned.uses, addedUses: addUses };
      }
      /* 限次类（烙印等）叠满即拒绝，保持老口径。 */
      if (restackSlot && !permanentRestackable(buff)) {
        return { ok: false, msg: '【' + buff.name + '】已经叠满了（上限 ' + cap + ' 层）。' };
      }
      if (!restackSlot) {
      owned.stacks = Math.min(cap, owned.stacks + 1);
      /* 塔内限次增益不累加次数（就是「下一场」这一份），但可以叠层提高强度。 */
      if (buff.kind === 'limited') { if (run.mode !== 'tower') owned.uses += buff.uses || 1; owned.on = true; }
      applyBuffOnAcquire(run, buff);
      logBuff(run, id, 'stack', { stacks: owned.stacks, detail: '叠到 ×' + owned.stacks });
      return { ok: true, buff, stacks: owned.stacks };
      }
      /* 叠满的永久增益继续往下走：满格判定 → （必要时）替换 → push 一条新栏位。 */
    }
    /* 满格判定按**加入后的占用**：占位类增益会 +1，所以只要 permUsed + 1 > 上限就得替换。
     * 免占位的（虚空铭文附魔过的）不占位，不受此限。 */
    /* 满格判定同样只针对**真的占槽**的增益：不占槽的选取类 / 扩容类在上面已经提前
     * return 了，这里再统一用 occupiesPermSlot 收口（两道闸，防止将来新增不占槽类型时漏改）。 */
    if (occupiesPermSlot(buff) && permUsed(run) + 1 > permSlots(run)) {
      if (!replaceId) return { ok: false, needsReplace: true, buff, msg: '永久增益已满，先选一个替换掉' };
      /* 【2026-10 同名逐条】`replaceId` 优先当 uid（精确替换被点的那一条）；否则按 id 取最后一条。 */
      const rn = Math.floor(Number(replaceId) || 0);
      let at = -1;
      if (rn > 0) at = list.findIndex((b) => b && Number(b.uid) === rn);
      if (at < 0) at = list.findIndex((b) => b && b.id === replaceId);
      if (at < 0) return { ok: false, needsReplace: true, buff, msg: '要替换的增益不存在' };
      const replacedRow = list[at];
      const replacedId = replacedRow.id;
      const replacedStacks = Math.max(1, Math.floor(Number(replacedRow && replacedRow.stacks) || 1));
      /* 换掉一个**免占位**的不会腾出槽位（它本来就不占），所以换它没有意义 —— 明确拒绝，
       * 免得玩家点了「替换」却发现还是买不了。 */
      if (rowFreeOf(replacedRow)) {
        return { ok: false, needsReplace: true, buff, msg: '【' + replacedId + '】已被虚空铭文附魔、不占槽位，换它腾不出位置' };
      }
      list.splice(at, 1);
      resetGrowth(run, replacedId, replacedStacks, replacedRow);
      /* 只移除被替换的那一条：**不要去清同名的其它栏位**的附魔标记。 */
      syncSlotFree(run);
      logBuff(run, replacedId, 'lose', { detail: '被【' + buff.name + '】替换掉' });
    }
    applyBuffOnAcquire(run, buff);   // 含永久 maxHpMul 的粘性折算（见该函数）
    /* 塔内一切限次增益都只服务下一场战斗。 */
    const towerLimitedUses = run.mode === 'tower' ? 1 : (buff.uses || 1);
    list.push(buff.kind === 'limited'
      ? { id, stacks: 1, uses: towerLimitedUses, on: true, at: nextAcqSeq(run), uid: nextUid(run) }
      : { id, stacks: 1, at: nextAcqSeq(run), uid: nextUid(run) });
    /* 自检：加入后占用不应超过上限（前面已按「加入后占用」判定过，正常不会触发）。 */
    if (buff.kind === 'permanent' && permUsed(run) > permSlots(run)
        && typeof console !== 'undefined' && console.warn) {
      console.warn('[tower] 永久增益占用槽位超上限：' + permUsed(run) + '/' + permSlots(run) + '（id=' + id + '）');
    }
    logBuff(run, id, 'get', { detail: restackSlot
      ? '新栏位（原栏位已叠满，继续叠加）'
      : (buff.kind === 'permanent' ? '永久' : (run.mode === 'tower' ? '下一场战斗' : ('限次 ' + towerLimitedUses + ' 场'))) });
    /* 刚拿到一条新增益 —— 之前因为「没有可选目标」而留着的选取型铭文，现在也许能接上了。 */
    const resumed = resolveDeferredPicks(run);
    if (resumed) save();
    return { ok: true, buff, resumedPick: resumed || undefined };
  }
  /** 瞬时经济 buff（立即进货 / 立即得试炼币 / 全场五折）。 */
  function applyInstant(run, buff) {
    /* 「天命所归」：即时类，但效果要留在 run 上（本局后续的稀有度分布）——
     * 所以即时结算里显式累加层数，而不是只当一次性的数值结算。 */
    if (buff.mods && buff.mods.rarityBoost) {
      run.rarityBoost = Math.max(0, Math.floor(Number(run.rarityBoost) || 0)) + 1;
      return { ok: true, msg: '本局稀有度提升已生效（' + run.rarityBoost + ' 层）', rarityBoost: run.rarityBoost };
    }
    const m = buff.mods || {};
    const out = { ok: true, buff, instant: true };
    if (m.instantCoins) { run.coins = Math.max(0, (run.coins || 0) + m.instantCoins); out.coins = m.instantCoins; }
    /* 即时削弱 —— 累加到本局全局，下一场 buildFoe 起对所有敌人生效。
     * E07/E08 削生命上限（enemyMaxHpDown）、E11「挫锋」削攻击力（enemyPowerDown）。 */
    if (m.enemyMaxHpDown) {
      run.enemyMaxHpDown = Math.min(ENEMY_MAXHP_DOWN_CAP, Math.max(0, Number(run.enemyMaxHpDown) || 0) + Number(m.enemyMaxHpDown));
      out.enemyMaxHpDown = run.enemyMaxHpDown;
    }
    if (m.enemyPowerDown) {
      run.enemyPowerDown = Math.min(0.8, Math.max(0, Number(run.enemyPowerDown) || 0) + Number(m.enemyPowerDown));
      out.enemyPowerDown = run.enemyPowerDown;
    }
    if (m.instantRetry) {
      run.retryToken = Math.max(0, Number(run.retryToken) || 0) + Number(m.instantRetry);
      out.retryToken = run.retryToken;
    }
    /* 讨价还价（E14）：即时类，但效果留到**下一次进店**才兑现 —— 份数记在 run 上（可叠加）。
     * 兑现点在 makeShop / makeMintShop 的「进店那一刻」（见 applyShopHalf）。 */
    if (m.shopHalf) {
      const add = Math.max(1, Math.floor(Number(m.shopHalf) || 1));
      run.shopHalfPending = Math.max(0, Math.floor(Number(run.shopHalfPending) || 0)) + add;
      out.shopHalfPending = run.shopHalfPending;
    }
    /* 「烙印升华」E20（2026-10 第六十一批）：立刻把持有的所有烙印破碎
     *（破碎 = 升级为全额并永久保留）。上架门槛由 poolFilter 的 brandGate 管。 */
    if (m.breakAllBrands) {
      const r = breakAllBrands(run);
      out.brokenBrands = r.copies;
      out.brokenNames = r.names;
      out.msg = r.copies > 0
        ? '所有烙印立刻破碎：' + r.names.join('、') + '（共 ' + r.copies + ' 份，已升级为全额并永久保留）'
        : '当前没有可破碎的烙印。';
    }
    if (m.shopDiscount) {
      /* 即时类（E04 steam大促）走这条分支，**不经过 applyBuffOnAcquire** ——
       * 所以折扣比例必须在这里也记一份，否则 makeShop 只能退回默认的 5 折。 */
      run.shopDiscount = Math.max(0, Math.floor(Number(run.shopDiscount) || 0)) + 1;
      run.shopDiscountPct = Math.max(Number(run.shopDiscountPct) || 0, Number(m.shopDiscount) || 0);
      out.discount = m.shopDiscount;
    }
    if (m.openShop) {
      // 立刻开一次商店：不动 5 层一次的结算点节奏（phase 用完即恢复）
      // 【100 层循环】整百层不开店：makeShop 会返回 null，这里必须判空再挂标记。
      run.shop = makeShop(run);
      if (run.shop) {
        run.shop.postBattle = true;
        run.phase = 'shop';
        out.shop = true;
      }
    }
    save();
    return out;
  }
  /** 限次增益的开关。`ref` 优先当 uid（精确切那一条），否则按 id 取第一条。 */
  function toggleLimited(ref, on) {
    const run = endless().run;
    if (!run) return { ok: false };
    const n = Math.floor(Number(ref) || 0);
    const list = run.limited || [];
    const b = (n > 0 ? list.find((x) => x && Number(x.uid) === n) : null)
      || list.find((x) => x.id === ref);
    if (!b) return { ok: false };
    b.on = on === undefined ? b.on === false : !!on;
    save();
    return { ok: true, id: b.id, uid: b.uid, on: b.on };
  }
  /* ============================================================
   * 【T16】选取型强化：武器 / 技能 / 虚空铭文 —— pickCandidates / applyPickBuff
   * ============================================================ */
  /* ============================================================
   * 秘技通神（C33）能抽中的「特殊技能」—— 玩家没学也会进候选，选中即领悟。
   *
   * ① 防御类：绝对防御(16) 与 龟甲术(7)。
   *    它们不进出手池（是「受击自动触发」的被动），所以「提升触发概率」只能靠
   *    sim 的 passiveSkillBoost（读 fighter.effects[id]）单独乘一次。
   * ② 小宇宙爆发(14)：虽然是主动技，但每场只能放一次、本身也不造成伤害，
   *    「触发概率」对它毫无意义 —— 定为**开战第一招必定放它**
   *    （tower 写 mods.cosmosFirst，sim 在选招时强制）。
   * ============================================================ */
  const PICKABLE_DEFENSE = [16, 7];
  const isPickableDefense = (id) => PICKABLE_DEFENSE.indexOf(Number(id)) >= 0;
  const PICKABLE_COSMOS = 14;
  const isPickableCosmos = (id) => Number(id) === PICKABLE_COSMOS;
  /** run.skillBoost[14] 只当「已抽中小宇宙」的开关用（不参与 effects 加成）。 */
  const COSMOS_PICK_BOOST = 1;
  const DEFENSE_PICK_BOOST = 2.0;
  const JUE_DUI_PICK_BOOST = 1.5;
  const defensePickBoostOf = (id) => (Number(id) === 16 ? JUE_DUI_PICK_BOOST : DEFENSE_PICK_BOOST);
  /** 候选按钮上的「抽中后会怎样」提示（界面用它替代 Lv 显示）。 */
  const PICK_NOTE = { 14: '开战第一招必放', 16: '触发概率提升', 7: '触发概率提升' };
  /** 玩家当前是否已拥有某技能。
   *  【Bug 修复】S().skills 是 "id:lv" 字符串数组（不是 {id, level} 对象），
   *  旧写法 `(S().skills).some((sk) => Number(sk.id) === id)` 里 sk.id 恒为 undefined
   *  → NaN，判断永远为 false，于是下面 applyPickBuff 会对**已学会**的绝对防御/龟甲术/
   *  小宇宙爆发调用 setWS('skill', id, 1)，把已有等级直接冲成 1 级。 */
  const ownsSkill = (id) => (S().skills || [])
    .some((sk) => Number(String(sk).split(':')[0]) === Number(id));
  /** 选取型 buff 的三选一候选：从玩家已有的武器/技能里随机挑最多 3 个。 */
  /** 这一次「附魔三选一」到底是**哪张铭文**触发的 —— 候选、可行性与界面标记共用这一个出口。
   *  三处曾经各写各的（`hasPickTargets` / `pickCandidates` / 界面的「已附魔」标记），
   *  一旦哪一处口径不同，「同一张铭文不能重复附在同一条」这类规则或标记就会错位。
   *  · 优先当前待选（`run.pendingPick`，发牌那一刻写的 buffId；界面可以直接把它传进来）；
   *  · 没有待选时（「当前没有可选目标」被收进 deferredPicks 了）退回那张**留着等目标**的铭文；
   *  · 老档 / 老测试什么都没写 → permBuff 按虚空铭文（C37）兜底。
   *  ⚠ **不要在这里调 `endless()`**：`endless()` 会走 normalizeRun → parkStalePendingPick →
   *  `hasPickTargets()`，而那一处又要回调本函数 —— 直接无限递归（实测栈溢出）。run 由调用方传。 */
  function activeInscriptionId(kind, run, pending) {
    const pend = pending || (run && run.pendingPick) || null;
    if (pend && pend.kind === kind && pend.buffId) return pend.buffId;
    const def = (run && Array.isArray(run.deferredPicks) ? run.deferredPicks : [])
      .find((x) => x && x.kind === kind);
    if (def && def.buffId) return def.buffId;
    return kind === 'permBuff' ? 'C37' : null;
  }
  function pickCandidates(kind) {
    const run = endless().run;
    if (!run) return [];
    if (kind === 'permBuff') {
      /* 这一次要附的是哪张铭文 —— 与可行性检查、界面标记共用同一个出口（见 activeInscriptionId）。 */
      const inscriptionId = activeInscriptionId('permBuff', run) || 'C37';
      const pool = (run.permanent || [])
        .map((b) => ({ id: b.id, uid: b.uid, buff: D().BUFF_BY_ID[b.id], stacks: b.stacks || 1, free: rowFreeOf(b),
          enchMul: rowEnchMulOf(b), enchants: rowEnchantsOf(b).slice() }))
        .filter((x) => x.buff && !D().hasTag(x.buff, 'hidden'))
        /* 合法附魔目标按**铭文种类**判：虚空铭文守「同名件只附魔一条」，增幅铭文只挡「同一张铭文重复附」。
         * 【用户口径 2026-10】同名的另一条已被附魔 → 这一条（未附魔的）不进候选（虚空铭文口径）。 */
        .filter((x) => inscriptionEligible((run.permanent || []).find((r) => r && Number(r.uid) === Number(x.uid)), run, inscriptionId));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      /* 候选按**栏位**给出（同名多栏各占一个候选），带上 uid 让界面能精确指到那一条；
       * `slotFree` / `enchMul` 也逐条给：同名件里只有被附魔的那一条才算「已附魔」。 */
      return pool.slice(0, 3).map((x) => ({ id: x.id, uid: x.uid, name: x.buff.name, rarity: x.buff.rarity,
        stacks: x.stacks, slotFree: x.free, enchMul: x.enchMul, enchants: x.enchants }));
    }
    /* 碎裂铭文（C61）：候选 = 当前**未破碎的烙印**（每栏一个候选）。
     * 延续铭文（C62）：候选 = 当前**限次增益**（烙印除外，最多 3 个，随机挑）。 */
    /* 延续 / 碎裂铭文的候选：**只看「还在手里」**（有未用尽的份数），
     * **不看开关状态**（用户口径 2026-10：「假如我直接赢」被玩家关掉之后，
     * 延续铭文也必须能选到它 —— 关掉只是「这场先不用」，不代表这条增益不存在）。
     * 以前这里抄了「生效判定」的 `row.on !== false`，于是被关掉的限次 buff 直接从候选里消失。 */
    if (kind === 'brandBuff' || kind === 'limitedBuff') {
      const wantBrand = kind === 'brandBuff';
      const list = (run.limited || [])
        .filter((row) => row && Math.max(0, Math.floor(Number(row.stacks) || 0)) > 0)
        /* 【2026-10 第八十批 用户口径】`noExtend` 的增益**不进延续铭文的候选**（特殊设定）：
         * 目前只有 E01 立即进货 —— 它是流程类增益（下一场战斗后开店），+5 场等于连开 5 家店。
         * 碎裂铭文（brandBuff）那一支不受影响（烙印都不带这个标志）。 */
        .filter((row) => !(D().BUFF_BY_ID[row.id] || {}).noExtend)
        .filter((row) => {
          const def = D().BUFF_BY_ID[row.id];
          if (!def) return false;
          return wantBrand ? isBrandBuff(def) : !isBrandBuff(def);
        })
        .map((row) => ({ uid: row.uid, id: row.id, name: (D().BUFF_BY_ID[row.id] || {}).name || row.id,
          rarity: (D().BUFF_BY_ID[row.id] || {}).rarity || 0, stacks: Math.max(1, Math.floor(Number(row.stacks) || 1)),
          uses: Math.max(0, Math.floor(Number(row.uses) || 0)), off: row.on === false }));
      const pool = list.slice();
      for (let i = pool.length - 1; i > 0; i--) {           // 洗牌
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      return pool.slice(0, 3);
    }
    /* 秘技通神（C33）：只抽**主动技能**，外加两条特殊技能 —— 防御被动（绝对防御/龟甲术）
     * 与小宇宙爆发（14）。前者不进出手池、「提升触发概率」走 sim 的 passiveSkillBoost；
     * 后者的收益是「开战第一招必定放它」（见 applyPickBuff / adjustMe / sim 的 cosmosFirst）。
     * 其余被动/防御类技能（力王附体 / 风驰电掣 / 武器好手 / 装死 / 皮糙肉厚…）
     * 抽到等于白拿一整份传奇增益，所以一律不进候选。
     * 技能表里的 type 字段是权威口径（'主动' / '被动' / '防御'）。 */
    const isActiveSkill = (id) => {
      const map = (typeof skillsMap !== 'undefined' && skillsMap) ? skillsMap : (window.skillsMap || null);
      const it = map && map.getValue ? map.getValue(Number(id)) : null;
      const t = it && it.type ? String(it.type) : '';
      return t === '主动';
    };
    const pickableSkill = (id) => isActiveSkill(id) || isPickableDefense(id) || isPickableCosmos(id);
    let list;
    if (kind === 'skill') {
      list = (State.mySkills ? State.mySkills() : []).filter((sk) => sk && pickableSkill(sk.id));
      /* 候选里补齐「玩家还没学的特殊技能」——防御技 16/7 与小宇宙爆发 14。
       * 它们按 id 造一层占位，选中后由 applyPickBuff 真正写进技能表。 */
      const have = new Set(list.map((sk) => Number(sk.id)));
      const map = (typeof skillsMap !== 'undefined' && skillsMap) ? skillsMap : (window.skillsMap || null);
      for (const id of PICKABLE_DEFENSE.concat([PICKABLE_COSMOS])) {
        if (have.has(id)) continue;
        const it = map && map.getValue ? map.getValue(id) : null;
        if (it) list = list.concat([{ id: id, level: 1, name: it.name, type: it.type }]);
      }
      /* 特殊技能在界面上不是「Lv 越高越好」，所以给它们挂一句提示。 */
      list = list.map((sk) => {
        const note = PICK_NOTE[Number(sk.id)];
        return note ? Object.assign({}, sk, { note: note }) : sk;
      });
    } else {
      list = (State.myWeapons ? State.myWeapons() : []);
    }
    const pool = list.slice();
    for (let i = pool.length - 1; i > 0; i--) {           // 洗牌
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, 3);
  }
  /** 落地选取：武器记 weaponBoost[id]，技能记 skillBoost[id]（本局有效）。 */
  function applyPickBuff(kind, id) {
    const run = endless().run;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    /* `pendingPick` 为空时，允许退回「留着等目标」的那一条（deferredPicks）——
     * 那种情况下候选与拒绝理由仍然要按**那张铭文**的规则算（否则「同一张铭文不能重复附」
     * 会被当成「没有待选」而不是被明确拒绝）。 */
    let pend = run.pendingPick;
    if ((!pend || pend.kind !== kind) && ['permBuff', 'brandBuff', 'limitedBuff'].indexOf(kind) >= 0) {
      const def = (Array.isArray(run.deferredPicks) ? run.deferredPicks : []).find((x) => x && x.kind === kind);
      if (def) pend = def;
    }
    if (!pend || pend.kind !== kind) return { ok: false, msg: '现在没有待选取的强化。' };
    if (kind === 'permBuff') {
      /* `id` 现在既可以是 uid（界面走这条）也可以是增益 id（老调用 / 测试兜底）。 */
      const row = findRow(run, id);
      if (!row) return { ok: false, msg: '你还没有这个永久增益。' };
      const inscriptionId = pend.buffId || 'C37';
      if (!inscriptionEligible(row, run, inscriptionId)) {
        const isFree = !!(D().BUFF_BY_ID[inscriptionId] || {}).mods && !!(D().BUFF_BY_ID[inscriptionId] || {}).mods.pickPermanentFree;
        return { ok: false, msg: isFree
          ? '【' + (D().BUFF_BY_ID[row.id] || {}).name + '】已经有一条被虚空铭文附魔了 —— 同名件里只能附魔一条，这一条不行。'
          : '【' + (D().BUFF_BY_ID[row.id] || {}).name + '】这一条已经吃过这张铭文了 —— 同一张铭文不能重复附在同一条上。' };
      }
      const r = applyInscription(run, row, inscriptionId, pend.mul);   // 只作用于这一条
      run.pickBuffIds = (run.pickBuffIds || []).concat([inscriptionId]).filter((v, i, a) => a.indexOf(v) === i);
      run.pendingPick = null;
      save();
      return { ok: true, kind, id: row.id, uid: row.uid, slotFree: rowFreeOf(row), enchMul: rowEnchMulOf(row),
        inscription: inscriptionId, enchants: (r && r.enchants) || rowEnchantsOf(row) };
    }
    /* 碎裂铭文（C61）：把选中的那条烙印**立刻全部破碎**；
     * 延续铭文（C62）：把选中的那条限次增益的剩余场次 +N（烙印不可选，见 pickCandidates）。 */
    if (kind === 'brandBuff' || kind === 'limitedBuff') {
      const row = (run.limited || []).find((b) => b && Number(b.uid) === Number(id)) ||
        (run.limited || []).find((b) => b && b.id === id);
      if (!row) return { ok: false, msg: '你还没有这个增益。' };
      const def = D().BUFF_BY_ID[row.id] || {};
      if (kind === 'brandBuff') {
        if (!isBrandBuff(def)) return { ok: false, msg: '只能对烙印使用。' };
        const n = breakBrandRow(run, row);
        run.limited = (run.limited || []).filter((b) => Math.max(0, Math.floor(Number(b.stacks) || 0)) > 0);
        run.pickBuffIds = (run.pickBuffIds || []).concat([pend.buffId || 'C61']).filter((v, i, a) => a.indexOf(v) === i);
        run.pendingPick = null;
        save();
        return { ok: true, kind, id: row.id, uid: row.uid, broken: n, name: def.name };
      }
      if (isBrandBuff(def)) return { ok: false, msg: '烙印类限次增益不能用延续铭文。' };
      /* 【2026-10 第八十批 用户口径】特殊设定：延续铭文不能取「立即进货」这类流程类增益
       *（`noExtend`）—— 候选那边已经过滤掉了，这里再挡一道（老存档 / 直接调 API）。 */
      if (def.noExtend) return { ok: false, msg: '【' + (def.name || row.id) + '】是流程类增益，延续铭文不能延长它。' };
      const add = Math.max(1, Math.floor(Number(pend.addUses) || 1));
      row.uses = Math.max(0, Math.floor(Number(row.uses) || 0)) + add;
      run.pickBuffIds = (run.pickBuffIds || []).concat([pend.buffId || 'C62']).filter((v, i, a) => a.indexOf(v) === i);
      run.pendingPick = null;
      save();
      return { ok: true, kind, id: row.id, uid: row.uid, addUses: add, uses: row.uses, name: def.name };
    }
    const key = kind === 'skill' ? 'skillBoost' : 'weaponBoost';
    run[key] = run[key] || {};
    let pct = pend.pct;
    if (kind === 'skill' && isPickableCosmos(id)) {
      /* 小宇宙爆发（14）：与防御技同样是「没学也直接给」，但收益不是触发概率 ——
       * 而是**开战第一招必定放它**（adjustMe 把它翻成 me.mods.cosmosFirst，
       * sim 选招时强制）。run.skillBoost[14] 只当开关用。 */
      if (!ownsSkill(id)) {
        State.setWS('skill', Number(id), 1);
      }
      run[key][Number(id)] = COSMOS_PICK_BOOST;
      pct = COSMOS_PICK_BOOST;
    } else if (kind === 'skill' && isPickableDefense(id)) {
      /* 绝对防御 / 龟甲术是「受击自动触发」的防御被动，不给它们叠加技能等级，
       * 而是把触发概率**大幅**提升（详见下方 defensePickBoostOf 的说明）。 */
      if (!ownsSkill(id)) {
        State.setWS('skill', Number(id), 1);
      }
      const before = Number(run[key][Number(id)]) || 0;
      run[key][Number(id)] = before + defensePickBoostOf(id);
      pct = run[key][Number(id)];
    } else {
      run[key][Number(id)] = Math.max(Number(run[key][Number(id)]) || 0, pct);
    }
    if (pend.buffId) run.pickBuffIds = (run.pickBuffIds || []).concat([pend.buffId]).filter((v, i, a) => a.indexOf(v) === i);
    run.pendingPick = null;
    save();
    return { ok: true, kind, id: Number(id), pct: pct };
  }
  /* ============================================================
   * 【T17】无尽：试炼币商店 —— makeShop / buyShopSlot / sellBuff / rerollShop
   * ============================================================ */

  /** C59「门庭若市」：**每进一次商店**立刻给 `shopEnterCoins × 层数` 试炼币。
   *  试炼商店（5 层结算点 / 立即进货 / 休整商店 / 立即开店）与**铸币商店**都算
   *（用户口径：铸币商店也要触发它）—— 两条进店路径共用这一份，别各写一遍。
   *  返回值挂到店铺对象的 `enterCoins` 上，界面用 claimShopEnterCoins 领一次飘字。 */
  function grantShopEnterCoins(run) {
    const enterStacks = stacksOf(run, 'C59');
    if (!(enterStacks > 0)) return 0;
    const enterCoins = Math.max(0, Math.round(Number(D().BUFF_BY_ID.C59.mods.shopEnterCoins) || 100) * enterStacks);
    if (enterCoins > 0) run.coins = Math.max(0, Number(run.coins) || 0) + enterCoins;
    return enterCoins;
  }
  /** 开一次商店。
   *  `e01Pct` = 本次「立即进货」带来的折扣（由调用方在扣限次前现算，见 activeShopCredit）。
   *  折扣比例由「哪几张折扣券在生效」决定：即时券走 run.shopDiscount/run.shopDiscountPct
   *  （E04 steam大促 −30% 等），E01 也是 −30%（2026-10 由 −50% 削弱）；两者同时生效
   *  按用户口径合并成 −65%（3.5 折），不做简单相加。
   *
   *  【2026-10 修复】以前只要 `stacks > 0` 就无条件取 `instantPct || 0.5`，并在扣完份数后
   *  把 `run.shopDiscountPct` **清成 0**。可是「这一家店」未必是 E04 该服务的那一家：
   *  休整商店（openRestShop）/ 立即开店都是独立入口，它们会**先**把 E04 的份数吃掉。
   *  于是「立即进货（E01）＋ steam大促（E04）」实际只按 E01 的 −30% 结算（7 折），
   *  用户报的「没有 3.5 折」就是这么来的（完整分析见 openRestShop）。
   *  现在改成：
   *    ① 合并判定把「这一份即时券的比例」也算进去（`pendingInstantPct`）；
   *    ② 只有**没走合并分支**时才当场扣掉即时券的份数；
   *       走了合并分支就把它留到收摊（closeShop 按店上的 `combinedCoupon` 清），
   *       这样休整商店（openRestShop）先开、E01 的店后开也不会把 E04 白白吃掉。
   *  另外 openRestShop 也必须把 activeShopCredit 传进来 —— 它和「打完这场再开的店」
   *  是同一个折扣口径，只是入口不同。 */
  function makeShop(run, e01Pct) {
    /* 【100 层循环】整百层（100 / 200 / 300…）**不开任何商店**（用户口径）：
     * 那三层是「觐见魔王」三连战，中途插一家店很别扭；x5 层照旧开。
     * 覆盖所有入口：每 5 层的结算商店、休整商店、E01 立即进货、调试台手开 ——
     * 一律在这里拦掉，免得某条支路漏判后在 x00 层开出一家店。 */
    if (D().layerNoShop(run && run.layer)) return null;
    /* 兜底：上一家「合并折扣店」如果没走 closeShop 就被顶掉（极少数路径，例如同场又开了
     * 铸币商店），这里补一次收尾，避免那段高于 −30% 的折扣漏给下一家店。 */
    if (run.shop && run.shop.combinedCoupon === true && run.shop.mint !== true) {
      run.shopDiscount = Math.max(0, Math.floor(Number(run.shopDiscount) || 0) - 1);
      if (run.shopDiscount <= 0) run.shopDiscountPct = 0;
    }
    const enterCoins = grantShopEnterCoins(run);
    const stacks = Math.max(0, Math.floor(Number(run.shopDiscount) || 0));
    const instantPct = Math.max(0, Number(run.shopDiscountPct) || 0);
    const own = Math.max(0, Number(e01Pct) || 0);
    /* 这一份即时折扣券的比例：优先用它自身记着的 `shopDiscountPct`，
     * 旧档 / 手改档没有这个字段时才退回「当前生效的那张券」或数据表的 −30%。 */
    const pendingInstantPct = stacks > 0
      ? Math.max(instantPct, own || instantPct || D().SHOP_DISCOUNT_E04)
      : 0;
    /* 两张券同时生效 → 取「合并值」（0.65）与两张券里更强的那张中较大者。
     * 之所以要带上 max(instantPct, own)：将来若出现比 0.65 更强的单张券，也不该被合并值压下去。 */
    const merged = own > 0 && stacks > 0;
    let discountPct = 0;
    if (merged) discountPct = Math.max(D().SHOP_DISCOUNT_BOTH, instantPct, own);
    else if (own > 0) discountPct = own;
    else if (stacks > 0) discountPct = pendingInstantPct;
    const discount = discountPct > 0;
    if (merged) {
      /* 合并成立 → **不在这里吃掉 E04**：把它的份数与比例都留着，
       * 收摊时由 closeShop 按 `thisShop.combinedCoupon` 统一清
       *（否则这段高于 −30% 的折扣会漏给下一家店）。 */
    } else if (own > 0) {
      /* E01 单独生效：只吃 E01 自己的限次，不动即时券。 */
    } else if (stacks > 0) {
      run.shopDiscount = stacks - 1;                  // 消耗 1 份即时折扣券
      if (run.shopDiscount <= 0) run.shopDiscountPct = 0;
    }
    /* 讨价还价（E14）：进店那一刻把攒下的份数兑现在货架上（试炼商店同样会被触发），
     * 并把「本店每页几件对折」记在店上 —— 之后每次刷新货架都按同一个数重打一遍。 */
    const slots = rollShopSlots(run);
    const shop = { layer: run.layer, slots: slots, retrySold: false, rerollFree: true,
      discount, discountPct, rerollCount: 0, rerollPaid: 0,
      /* 这是一家「合并折扣店」（E04 + E01 同时生效）→ 收摊时要把 E04 那一份券清掉，
       * 见 closeShop。标记写在店上而不是靠比例反推，避免将来出现更强的单张券时误判。 */
      combinedCoupon: merged || undefined,
      enterCoins: enterCoins || undefined };
    applyShopHalf(run, slots, shop);
    return shop;
  }
  /** 从一个候选里抽一件，按 buff.shopWeight 加权（默认 1）—— 用来压低个别 overpowered
   * 增益在商店出现的概率（例如不死鸟）。权重只影响「谁被抽中」，不影响稀有度倾斜。 */
  /** 静态设计权重：数据表里的 shopWeight（默认 1）。 */
  function buffStaticWeightOf(b) {
    return Math.max(0, Number(b && b.shopWeight) || 1);
  }
  /** 动态惩罚（随本局状态变化，恒 ≤1；1 = 没有惩罚）。拆出来是因为「动态档位权重」
   *  只吃这一部分（见 dynamicTierWeights）：静态 shopWeight 不该让整档永久缩水。
   *  两项来源：
   *   · repeatWeight —— 每多持有一份，再出现概率 ×rw（C52 涌泉烙印 0.3）；
   *   · weightDivBy   —— 降权的**计数口径**（配 weightDecay 用，weight ×= decay^n）：
   *       'enchanted'   被**虚空铭文**附魔过（= 免占位）的永久条数 —— 只有 C37 用；
   *       'enchantedBy' 被**这张铭文自己**附魔过的永久条数（`row.enchants` 里有它的 id）
   *                     —— C60 水晶铭文用（2026-10 第八十批修 bug）；
   *       'owned'       本局已获得的份数，含碎掉的烙印（C49 终焉烙印 / 直接生效的铭文）。
   *
   * 【2026-10 第八十批修 bug】`weightDivBy: 'enchanted'` 数的是 `rowFreeOf(row)`（**虚空铭文**的不占位标记），
   * 但 C60 水晶铭文、C61 碎裂铭文、C62 延续铭文也照着抄了这一行 —— 于是：
   *   · 水晶铭文附魔了 N 条，它自己的 n 仍然是「被虚空附魔过的条数」（多半是 0）→ **0.88^n 从来没生效过**；
   *   · 碎裂 / 延续铭文压根不给谁附魔，`n` 永远跟它们自己没关系。
   * 现在按「谁的账算在谁头上」拆成上面三种口径（计数口径只影响降权，不改效果）。 */
  function buffDynamicPenaltyOf(run, b) {
    if (!run || !b || !b.mods) return 1;
    let m = 1;
    const rw = Number(b.mods.repeatWeight);
    if (rw > 0 && rw < 1) {
      const owned = b.kind === 'instant'
        ? instantOwnedCount(run, b.id)
        : Math.max(0, obtainedCountOf(run, b.id) - 1);
      if (owned > 0) m *= Math.pow(rw, owned);
    }
    const divBy = b.mods.weightDivBy;
    if (divBy === 'enchanted' || divBy === 'enchantedBy' || divBy === 'owned') {
      const rows = run.permanent || [];
      const n = divBy === 'enchanted'
        ? rows.filter((row) => rowFreeOf(row)).length
        : divBy === 'enchantedBy'
          ? rows.filter((row) => rowEnchantsOf(row).indexOf(b.id) >= 0).length
          : obtainedCountOf(run, b.id);
      /* weightDecay（0 < v < 1）= **指数降权**：weight ×= v^n —— 与 repeatWeight 同一口径，
       * 只是计数口径由 weightDivBy 决定（'enchanted' = 虚空附魔数，'enchantedBy' = 自己附魔数，
       * 'owned' = 已获得份数）。C37 虚空铭文用它（2026-10 用户口径「与终焉烙印类似，0.88^n，n 为附魔数」）：
       * n=1 → 0.88、n=3 → 0.68，比原来的 ÷(n+1)（0.5 / 0.25）平缓得多。 */
      const decay = Number(b.mods.weightDecay);
      if (decay > 0 && decay < 1) m *= Math.pow(decay, n);
      else {
        /* 老口径（除法）：weightDivOffset = 0 时是「÷n」（0~1 份不降权，C49 早期的口径）；
         * = 1 时是「÷(n+1)」—— 0 份 → ÷1（不降），1 份 → ÷2，2 份 → ÷3。 */
        const div = n + Math.max(0, Number(b.mods.weightDivOffset) || 0);
        if (div > 1) m /= div;
      }
    }
    return m;
  }
  function buffWeightOf(run, b) {
    return buffStaticWeightOf(b) * buffDynamicPenaltyOf(run, b);
  }
  /* ============================================================
   * 动态档位权重 —— 把「先摇档、再档内抽」合成一次全局加权抽取
   *
   *   档 r 的预算 = baseTier[r] × (Σ_{b∈可用(r)} m_b) / |可用(r)|
   *
   * m_b 取 shopWeight×动态惩罚（TIER_AVG_INCLUDES_STATIC = true）或只取动态惩罚（false）。
   * 某个 buff 降权 → 整档预算缩水 → 省下来的概率按比例分给别的档；
   * 档内没有可用件时预算为 0（旧版要顺延到邻近档，这里天然不会摇到空档）。
   * 与旧的「两步式」在 m_b 全为 1 时**完全等价**。
   * ============================================================ */
  /** 动态档位权重的通用实现：`weightOfFn(run, b)` 决定「个体倍率」。
   *  `dynamicTierWeights` 是它的默认口径（静态 shopWeight + 动态惩罚）；
   *  传自定义 `weightOfFn` 可换一套个体倍率（「豪掷千金」现在直接用整池权重表，
   *  见 limitedGrantWeights，不再需要这个自定义口子，但保留给测试/其它池子用）。 */
  function dynamicTierWeightsBy(baseTier, run, list, weightOfFn) {
    const base = Array.isArray(baseTier) && baseTier.length ? baseTier : D().RARITY_WEIGHTS;
    if (D().TIER_DYNAMIC_WEIGHTS === false) return base.slice();
    const includeStatic = D().TIER_AVG_INCLUDES_STATIC === true;
    const fn = typeof weightOfFn === 'function' ? weightOfFn
      : (includeStatic ? buffWeightOf : buffDynamicPenaltyOf);
    const sum = [0, 0, 0, 0], n = [0, 0, 0, 0];
    for (const b of list || []) {
      const r = Math.max(0, Math.min(3, Math.floor(Number(b && b.rarity) || 0)));
      const m = fn(run, b);
      sum[r] += Math.max(0, Number(m) || 0); n[r] += 1;
    }
    return base.map((v, r) => (n[r] > 0 ? Math.max(0, Number(v) || 0) * (sum[r] / n[r]) : 0));
  }
  function dynamicTierWeights(baseTier, run, list) {
    return dynamicTierWeightsBy(baseTier, run, list, null);
  }
  /** 摇档用的兜底：全部预算都是 0（例如整池都没有动态惩罚之外的可选项）时退回 baseTier。 */
  function rollableTierWeights(weights, fallback) {
    const total = (weights || []).reduce((a, b) => a + b, 0);
    return total > 0 ? weights : (fallback || weights);
  }
  /* ============================================================
   * 传奇保底（B 方案，配置见 TowerData.LEGEND_PITY）
   *   · 每掷一格 +1；掷到传奇（自然或保底）清零；传奇池为空时不累加（避免空转）。
   *   · 累计到 slots → 下一格**强制传奇档**，档内按 mods.pityWeight × **个体降权** 挑。
   *     2026-10 用户口径：以前这里**完全不吃** repeatWeight / weightDecay，于是「终焉烙印拿了
   *     十几份」时保底仍按满权重把它发出来（玩家实测「第 10 次之后还是很高」的主因之一）。
   *     现在与自然路径同口径：拿得越多，越不容易被保底抽中；pityWeight 仍决定「谁有资格进池」的相对偏好。
   * ============================================================ */
  function legendPityNeed() {
    const n = Math.floor(Number((D().LEGEND_PITY || {}).slots));
    return Number.isFinite(n) && n >= 1 ? n : 120;
  }
  function legendPityOf(run) { return Math.max(0, Math.floor(Number(run && run.legendPity) || 0)); }
  /** 保底触发了吗（需要「这一格的候选里有传奇」才可能触发）。 */
  function legendPityReady(run, candidates) {
    if (!(candidates || []).some((b) => b.rarity === 3)) return false;
    return legendPityOf(run) >= legendPityNeed();
  }
  /** 保底池里的加权抽取：mods.pityWeight（缺省 1，0 = 不进池）× **个体降权**
   *（repeatWeight / weightDecay），但不吃静态 shopWeight —— 静态权重只管「自然抽取」那一侧。 */
  function pickByPityWeight(list, run) {
    const pool = (list || []).filter((b) => pityWeightOf(b, run) > 0);
    if (!pool.length) return pickByShopWeight(list, run);      // 保底池空了就退回自然权重
    let total = 0;
    for (const b of pool) total += pityWeightOf(b, run);
    let roll = Math.random() * total;
    for (const b of pool) { roll -= pityWeightOf(b, run); if (roll < 0) return b; }
    return pool[pool.length - 1];
  }
  /** 保底池里的个体权重：pityWeight（缺省 1、0 = 不进池）× 个体降权（repeatWeight / weightDecay）。
   *  传 run 才吃降权；不传（旧调用点/探针）就只按 pityWeight，等价于 2026-10 之前的旧口径。 */
  function pityWeightOf(b, run) {
    const v = Number(b && b.mods && b.mods.pityWeight);
    const base = Number.isFinite(v) && v > 0 ? v : (b && b.mods && b.mods.pityWeight === 0 ? 0 : 1);
    if (base <= 0) return 0;
    return run ? base * buffDynamicPenaltyOf(run, b) : base;
  }
  /** 记一笔：掷到传奇清零，否则 +1；传奇池为空时不累加。 */
  function notePityRoll(run, buff, hasLegendCandidate) {
    if (!run) return;
    if (buff && buff.rarity === 3) { run.legendPity = 0; return; }
    if (!hasLegendCandidate) return;
    run.legendPity = legendPityOf(run) + 1;
  }
  /** 一格抽取：返回 { buff, pity }（保底时 pity=true）。baseTier 由调用方给（两处倾斜不同）。 */
  function rollOneCandidate(run, candidates, baseTier) {
    const pity = legendPityReady(run, candidates);
    let want;
    if (pity) want = 3;
    else {
      const tierW = rollableTierWeights(dynamicTierWeights(baseTier, run, candidates), baseTier);
      want = rollRarity(tierW);
    }
    let list = candidates.filter((b) => b.rarity === want);
    if (!list.length) list = candidates;
    const buff = pity ? pickByPityWeight(list, run) : pickByShopWeight(list, run);
    notePityRoll(run, buff, candidates.some((b) => b.rarity === 3));
    return { buff, pity };
  }
  /** 按权重抽一件（权重 = buffWeightOf，可选再乘一个额外倍率 `extraOf`）。
   *  「豪掷千金」现在走自己的 limitedGrantWeights（把档位动态权重摊到每件上直接抽签）。 */
  function pickByShopWeight(list, run, extraOf) {
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    const weightOf = (b) => {
      const extra = extraOf ? Math.max(0, Number(extraOf(b)) || 0) : 1;
      return buffWeightOf(run, b) * extra;
    };
    let total = 0;
    for (const b of list) total += weightOf(b);
    if (!(total > 0)) return list[Math.floor(Math.random() * list.length)];
    let roll = Math.random() * total;
    for (const b of list) { roll -= weightOf(b); if (roll < 0) return b; }
    return list[list.length - 1];
  }
  function rollShopSlots(run, paid) {
    const pool = D().shopPool || D().endlessPool, slots = [], taken = new Set();
    /* 传 run：把「时来运转」（E12）的刷新加速算进这一页的稀有度倾斜里。 */
    const baseTier = D().rawTierWeights(D().rerollTilt(paid || 0, run), run);
    /* 货架件数**按层分档**（【D2b】100 层循环）：1-20 层 5 件 → 21-40 层 4 件 →
     * 41-100 层 3 件 → 第 101 层回到 5 件。挑战塔不走这里（它没有商店）。
     * 以前这里恒读 D().SHOP.slots（5），所以分档只有改在这里才真正生效。 */
    const shelf = Math.max(1, Math.floor(Number(D().endlessShopSlots(run && run.layer)) || D().SHOP.slots || 5));
    let pitySlot = -1;
    for (let i = 0; i < shelf; i++) {
      const candidates = pool.filter((b) => !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));
      if (!candidates.length) break;
      /* 一格抽取：动态档位权重（个体降权缩小整档预算）+ 传奇保底。 */
      const got = rollOneCandidate(run, candidates, baseTier);
      const buff = got.buff;
      if (!buff) break;
      if (got.pity) pitySlot = slots.length;
      taken.add(buff.id);
      slots.push({ id: buff.id, sold: false, price: D().rollShopPrice(D().shopPrice(buff)) });
    }
    const isLimited = (bid) => { const b = D().BUFF_BY_ID[bid]; return !!b && b.kind === 'limited' && b.id !== 'N08'; };
    if (slots.length && !slots.some((sl) => isLimited(sl.id))) {
      const cand = pool.filter((b) => b.kind === 'limited' && b.id !== 'N08' && !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));
      const at = (pitySlot >= 0 && slots.length - 1 === pitySlot) ? pitySlot - 1 : slots.length - 1;
      if (cand.length && at >= 0) {
        const buff = pickByShopWeight(cand, run);
        taken.delete(slots[at].id);
        slots[at] = { id: buff.id, sold: false, price: D().rollShopPrice(D().shopPrice(buff)) };
        taken.add(buff.id);
      }
    }
    /* 传奇保底计数与「玩家最终看到的这一页」保持一致：
     * 上面「保证至少一件限次」的换格发生在逐格 notePityRoll 之后，被换掉的那一格
     * 可能正好是传奇（或被换上的正是传奇）—— 不重算就会让 run.legendPity 与页面口径对不上
     * （测试/探针按页面逐格复算时会出现 0 vs 2 这种差异）。 */
    if (pool.some((b) => b.rarity === 3 && ownable(run, b) && poolFilter(run, b))) {
      let pity = 0;
      for (const s of slots) {
        const b = D().BUFF_BY_ID[s.id];
        if (b && b.rarity === 3) pity = 0; else pity++;
      }
      run.legendPity = pity;
    }
    return slots;
  }
  /** 领取「门庭若市」（C59）这家店进门时给的试炼币（领一次就清零，界面飘字用）。 */
  function claimShopEnterCoins() {
    const run = endless().run;
    if (!run || !run.shop) return 0;
    const gain = Math.max(0, Math.round(Number(run.shop.enterCoins) || 0));
    if (gain > 0) { run.shop.enterCoins = 0; save(); }
    return gain;
  }
  function shopState() {
    const run = endless().run;
    if (!run || !run.shop) return null;
    /* 【100 层循环】整百层（x00）不该有任何店：老档 / 极端路径上如果还挂着一家，
     * 这里直接当没有 —— 界面就不会画出卖不掉的货架。 */
    if (D().layerNoShop(run.layer)) return null;
    /* 铸币商店（run.shop.mint）与试炼商店共用这一份快照，界面按 `mint` 分流：
     *   · 铸币商店：`slots[].price` 的单位是**铸币**（按稀有度固定，不吃折扣），另有 swapAllowed；
     *   · 试炼商店：`slots[].price` 的单位是试炼币（含 E01/E04 折扣）。
     * 两边都用 sold / rerollFree / rerollCount，界面可以复用货架渲染。 */
    const mint = !!run.shop.mint;
    return { coins: run.coins, layer: run.shop.layer, mint: mint,
      /* 这家店是怎么开的：界面据此决定「离开」按钮回哪里，别让它自己猜。 */
      rest: !!run.shop.rest, postBattle: !!run.shop.postBattle, boundary: !!run.shop.boundary,
      /* 是不是限次增益（E16 铸币商队）触发的那一家 —— 界面用来写清来由。 */
      byBuff: !!run.shop.byBuff,
      enterCoins: Math.max(0, Math.round(Number(run.shop.enterCoins) || 0)),
      rerollFree: !!run.shop.rerollFree,
      rerollCount: Number(run.shop.rerollCount) || 0,
      rerollNextPrice: D().rerollPriceAt(Number(run.shop.rerollCount) || 0),
      rerollCapped: D().rerollPriceCapped(Number(run.shop.rerollCount) || 0),
      rerollLastPaid: Number(run.shop.rerollPaid) || 0,
      retrySold: !!run.shop.retrySold, retryPrice: D().SHOP.retryPrice,
      retryToken: Math.max(0, Number(run.retryToken) || 0),
      rerollPrice: D().SHOP.rerollPrice,
      /* 铸币商店专属：免费交换还开着吗 / 三档固定售价（铸币）。 */
      swapAllowed: mint ? swapAllowedOf(run) : false,
      swapUsed: mint ? (run.shop.swapped === true) : false,
      mintPrices: D().MINT_SHOP.price.slice(),
      /* 讨价还价（E14）：这一页有几件被打过折（进店那一刻兑的），以及**本店每页几件**
       *（刷新货架会按它重打一遍），界面用来提示。 */
      halfCount: run.shop.slots.filter((s) => s && s.half).length,
      halfPerPage: Math.max(0, Math.floor(Number(run.shop.halfPerPage) || 0)),
      slots: run.shop.slots.map((s) => { const b = D().BUFF_BY_ID[s.id];
        /* 【2026-10 同名逐条】「已有 ×N」要跨同名多栏**求和**，不是只看第一栏。 */
        const listPrice = mint ? D().mintPrice(b) : Math.max(0, Math.round(Number(s.price) || 0));
        return { id: s.id, sold: s.sold, name: b.name, desc: D().descOf(b, 'endless'), rarity: b.rarity, kind: b.kind,
          price: mint ? (s.half ? Math.floor(listPrice / 2) : listPrice) : shopPriceOf(b, s),
          /* 讨价还价对折过的格子：界面显示「对折 · 原价 X」。 */
          half: !!s.half, listPrice: listPrice,
          ops: D().hasTag(b, 'ops'),
          ownedStacks: stacksOf(run, s.id), canStack: D().hasTag(b, 'stackable') }; }) };
  }
  /** 「豪掷千金」（C58）抽随机限次增益：**基准刷新档**（默认 10 试炼币）。
   *  用户口径 2026-10：把默认权重从「30 币刷新」下调到「10 币刷新」。 */
  function limitedRerollPaid() {
    const m = (D().BUFF_BY_ID.C58 && D().BUFF_BY_ID.C58.mods) || {};
    const raw = m.limitedDefaultRerollPaid != null ? m.limitedDefaultRerollPaid : 10;
    return Math.max(0, Number(raw) || 0);
  }
  /** 限次池里每件的**动态权重**（商店在「花 limitedRerollPaid 币刷新」那一刻的口径）：
   *
   *    档位预算 tier[r] = dynamicTierWeights(rawTierWeights(rerollTilt(paid)), run, pool)[r]
   *                       —— 基准档位权重 × 档内平均动态惩罚；
   *    件权重   w_b     = tier[rarity_b] × buffWeightOf(b) / Σ_{同档} buffWeightOf
   *                       —— 把档位预算按**档内个体权重占比**摊到每一件上。
   *
   *  这就是「商店花 10 币刷新时，每件限次增益被抽中的动态权重」。用户口径：**不直接套用**
   *  刷新后的档位分布（那会变成「先摇档、再档内抽」），而是把这些权重和 buff 混在一起
   *  **直接抽签**（见 grantRandomLimited）。
   *  返回 [{ buff, weight }]，池子为空时返回 []。 */
  function limitedGrantWeights(run) {
    const pool = D().endlessPool.filter((b) => b.kind === 'limited' && ownable(run, b) && poolFilter(run, b));
    if (!pool.length) return [];
    const rar = (b) => Math.max(0, Math.min(3, Math.floor(Number(b && b.rarity) || 0)));
    const baseTier = D().rawTierWeights(D().rerollTilt(limitedRerollPaid()), run);
    const tier = dynamicTierWeights(baseTier, run, pool);
    const sum = [0, 0, 0, 0];
    for (const b of pool) sum[rar(b)] += Math.max(0, buffWeightOf(run, b));
    return pool.map((b) => {
      const r = rar(b);
      const mw = Math.max(0, buffWeightOf(run, b));
      return { buff: b, weight: sum[r] > 0 ? Math.max(0, Number(tier[r]) || 0) * (mw / sum[r]) : 0 };
    });
  }
  /** 单件限次增益在「豪掷千金」里的动态权重（测试/调试用；内部按整池现算）。 */
  function limitedGrantWeightOf(run, b) {
    if (!b) return 0;
    const hit = limitedGrantWeights(run).find((x) => x.buff.id === b.id);
    return hit ? hit.weight : 0;
  }
  /** C58「豪掷千金」：从**无尽塔**的限次池里随机抽一个「还能拿」的，立刻获得。
   *  抽不到（池子空了 / 都拿满了）就返回 null（不消耗这一档进度）。 */
  function grantRandomLimited(run) {
    const list = limitedGrantWeights(run);
    if (!list.length) return null;
    const total = list.reduce((a, x) => a + Math.max(0, x.weight), 0);
    let pick = list[list.length - 1].buff;
    if (total > 0) {
      let roll = Math.random() * total;
      for (const x of list) { roll -= Math.max(0, x.weight); if (roll < 0) { pick = x.buff; break; } }
    } else {
      pick = list[Math.floor(Math.random() * list.length)].buff;
    }
    const got = addBuff(run, pick.id);
    return got && got.ok ? pick.id : null;
  }
  /** 在试炼商店消费后的两类收益（各自独立累计）：
   *   · C36 挥金如土：每 N 币 → 随机一项固定属性
   *   · C58 豪掷千金：每 100 币 → 立刻获得一个随机限次增益 */
  /** 挥金如土（C36）第 procs 次属性提升需要花多少试炼币（分段涨价）。
   *  数据：mods.shopSpendTiers = [5,10,15]、mods.shopSpendTierSize = 20
   *  → 前 20 次每次 5 币、第 21~40 次每次 10 币、第 41 次起每次 15 币。
   *  没配 tiers 时退回单一 shopSpendStep（旧档 / 别的增益复用本函数时也安全）。 */
  function shopSpendStepFor(buff, procs) {
    const m = (buff && buff.mods) || {};
    const tiers = Array.isArray(m.shopSpendTiers) ? m.shopSpendTiers.filter((v) => Number(v) > 0) : null;
    if (!tiers || !tiers.length) return Math.max(1, Number(m.shopSpendStep) || 20);
    const size = Math.max(1, Math.floor(Number(m.shopSpendTierSize) || 20));
    const idx = Math.min(tiers.length - 1, Math.floor(Math.max(0, procs) / size));
    return Math.max(1, Number(tiers[idx]) || 1);
  }
  /* ---- 消费类增益的进度记账（2026-10 改版：**每一栏各记一份**）----------------
   * 用户报的 bug：多个「豪掷千金 / 挥金如土」只会触发一个。根因是进度记在 `run` 上的
   * **单一计数器**里，多份时只是把这段共享进度推快一点，而不是「每份各自累计」。
   * 现在把计数器搬到**每个背包栏位自己身上**：
   *   · C36 挥金如土：`row.spend` / `row.procs` —— 分段涨价（5/10/15）也按**该份自己的次数**算，
   *     所以 2 份各提 20 次（合计 40）而不是共享计数器提前跳档（那样只有 30）。
   *   · C58 豪掷千金：`row.limitedSpend` —— 每满 100 币，**这一份**给一个随机限次增益。
   * 旧的 `run.shopSpend / run.shopSpendProcs / run.shopSpendLimited` 保留为**镜像**（各栏求和），
   * 界面 / 存档 / 探针继续读它们即可。
   * ------------------------------------------------------------------------- */
  /** 把某个 id 的所有栏位的进度计数清零（C36 重置分段时用）。 */
  function clearSpendProgress(run, id) {
    const key = id === 'C58' ? 'limitedSpend' : 'spend';
    for (const row of (run.permanent || [])) {
      if (row && row.id === id) { row[key] = 0; if (id === 'C36') row.procs = 0; }
    }
  }
  /** 把各栏进度汇总回镜像字段（界面只读这几个）。 */
  function syncSpendMirrors(run) {
    const sum = (id, key) => (run.permanent || []).reduce((n, b) =>
      n + (b && b.id === id ? Math.max(0, Number(b[key]) || 0) : 0), 0);
    run.shopSpend = sum('C36', 'spend');
    run.shopSpendProcs = sum('C36', 'procs');
    run.shopSpendLimited = sum('C58', 'limitedSpend');
  }
  function addShopSpend(run, amount, flags) {
    const spend = Math.max(0, Number(amount) || 0);
    if (!(spend > 0)) return null;
    /* 【巡逻·收缴加成】玩家此前把「挥金如土」交给过巡逻魔王 → 玩家在试炼商店消费时，
     * **魔王**按同一套分段吃成长（用户口径：按离开玩家时的增益生效）。
     * 记在 run.patrolFoeGain 上，x0 层那只魔王在复制玩家面板之后再叠这一份。 */
    if (run && run.patrolShopGift && Number(run.patrolShopGift.step) > 0) {
      const gift = run.patrolShopGift;
      run.patrolShopSpend = Math.max(0, Number(run.patrolShopSpend) || 0) + spend;
      run.patrolFoeGain = Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, run.patrolFoeGain || {});
      const opts = ['power', 'agility', 'speed', 'hp'];
      let guard = 0;
      while (run.patrolShopSpend >= Math.max(1, Number(gift.step) || 5) && guard++ < 100000) {
        run.patrolShopSpend -= Math.max(1, Number(gift.step) || 5);
        const key = opts[Math.floor(Math.random() * opts.length)];
        run.patrolFoeGain[key] += key === 'hp'
          ? Math.max(0, Number(gift.hp) || 5)
          : Math.max(0, Number(gift.stat) || 1);
      }
    }
    /* 兼容旧调用口径：`assumeOwned` = 「这一笔也要算给 C36」（买 C36 本身时）。 */
    const c36Rows = (run.permanent || []).filter((b) => b && b.id === 'C36');
    const c58Rows = (run.permanent || []).filter((b) => b && b.id === 'C58');
    if (!c36Rows.length && !c58Rows.length && !(flags && flags.assumeOwned)) return null;
    const gained = [];
    const mm36 = D().BUFF_BY_ID.C36.mods;
    const opts = ['power', 'agility', 'speed', 'hp'];
    const grantOnce = () => {
      const key = opts[Math.floor(Math.random() * opts.length)];
      run.spendGain = Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, run.spendGain || {});
      run.spendGain[key] += key === 'hp'
        ? Math.max(0, Number(mm36.shopSpendHp) || 5)
        : Math.max(0, Number(mm36.shopSpendStat) || 1);
      gained.push(key);
    };
    /* 兜底：调用方说「算给 C36」但栏位还没建出来（理论上不会）→ 记在镜像字段上。 */
    if (!c36Rows.length && !c58Rows.length) {
      run.shopSpend = Math.max(0, Number(run.shopSpend) || 0) + spend;
      run.shopSpendProcs = Math.max(0, Math.floor(Number(run.shopSpendProcs) || 0));
      let guard = 0;
      while (run.shopSpend >= shopSpendStepFor(D().BUFF_BY_ID.C36, run.shopSpendProcs) && guard++ < 100000) {
        run.shopSpend -= shopSpendStepFor(D().BUFF_BY_ID.C36, run.shopSpendProcs);
        run.shopSpendProcs += 1;
        grantOnce();
      }
      if (!gained.length) return null;
      return { gained: gained, limited: [], spendGain: Object.assign({}, run.spendGain || {}) };
    }
    /* C36：每一栏各自累计 + 各自分段（该份自己的 procs 决定步长）。 */
    for (const row of c36Rows) {
      row.spend = Math.max(0, Number(row.spend) || 0) + spend;
      row.procs = Math.max(0, Math.floor(Number(row.procs) || 0));
      let guard = 0;
      while (row.spend >= shopSpendStepFor(D().BUFF_BY_ID.C36, row.procs) && guard++ < 100000) {
        row.spend -= shopSpendStepFor(D().BUFF_BY_ID.C36, row.procs);
        row.procs += 1;
        grantOnce();
      }
    }
    /* C58：每一栏各自攒 100 币 → 各自给一个随机限次增益。 */
    const step58 = Math.max(1, Number(D().BUFF_BY_ID.C58.mods.shopSpendLimited) || 100);
    const limited = [];
    for (const row of c58Rows) {
      row.limitedSpend = Math.max(0, Number(row.limitedSpend) || 0) + spend;
      let guard = 0;
      while (row.limitedSpend >= step58 && guard++ < 1000) {
        const id = grantRandomLimited(run);
        if (!id) break;
        row.limitedSpend -= step58;
        limited.push(id);
      }
    }
    syncSpendMirrors(run);
    if (!gained.length && !limited.length) return null;
    return { gained: gained, limited: limited, spendGain: Object.assign({}, run.spendGain || {}) };
  }
  /** 试炼商店专用操作（买 / 刷新 / 卖 / 买铸币）的守门：
   *  铸币商店是**另一套规则**（铸币结账 + 免费交换、固定价、不发消费钩子），
   *  两套 API 不能互相调用 —— 否则会出现「用试炼币买走铸币货架上的东西」这种串味。 */
  function trialShopGuard(run) {
    if (run && run.shop && run.shop.mint) {
      return { ok: false, msg: '这里是铸币商店：请用铸币购买、或者用免费交换。' };
    }
    return null;
  }
  function buyShopSlot(index, replaceId) {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false };
    const guard = trialShopGuard(run);
    if (guard) return guard;
    const slot = run.shop.slots[index];
    if (!slot || slot.sold) return { ok: false };
    const buff = D().BUFF_BY_ID[slot.id];
    const permanentFull = occupiesPermSlot(buff) && permUsed(run) >= permSlots(run) &&
      !(run.permanent || []).some((b) => b.id === buff.id);
    if (permanentFull && !replaceId) {
      return { ok: false, needsReplace: true, buff, msg: '永久增益已满 5 个，请选择要替换掉的增益。' };
    }
    const price = shopPriceOf(buff, slot);
    if (run.coins < price) return { ok: false, msg: '试炼币不足。' };
    run.coins -= price;
    slot.sold = true;
    const res = addBuff(run, slot.id, replaceId);
    if (!res || !res.ok) {
      run.coins += price;
      save();
      return { ok: false, msg: (res && res.msg) || '这件增益现在买不了。' };
    }
    /* 挥金如土：按**最终是否拥有** C36 记账，于是买它本身的那笔也算进去。 */
    /* addBuff 已经把这一件记进栏位了 → 这里读到的是**买完之后的真实份数**：
     * 买 C36 本身时那笔消费照样算进新栏位（老口径不变）。 */
    const c36After = stacksOf(run, 'C36');
    const spend = addShopSpend(run, price, { assumeOwned: c36After > 0 });
    const pts = scoreBuffAcquire(run, buff);
    save();
    return { ok: true, buff, price, instant: !!res.instant, score: pts,
      shopSpend: spend || undefined };
  }
  /* 兼容旧调用名：以前这里卖「治疗泉水」，现在同一位置是铸币，
   * 语义仍然是「每次商店限购 1 份」，所以旧的 buyShopHeal 直接指向新实现
   * （tools/ 里的历史探针脚本还在用它）。 */
  function buyShopHeal() { return buyRetryToken(); }
  function buyRetryToken() {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false, msg: '商店还没开张。' };
    const guard = trialShopGuard(run);
    if (guard) return guard;
    if (run.shop.retrySold) return { ok: false, msg: '这家店已经买过了。' };
    const price = D().SHOP.retryPrice;
    if (run.coins < price) return { ok: false, msg: '试炼币不足。' };
    run.coins -= price;
    /* 挥金如土（C36）/ 豪掷千金（C58）：买铸币同样是「在试炼商店消费」，要把结果交回界面提示
     *（2026-10 第八十一批：机制一直在算，但界面从没说过，玩家实测「买铸币好像不触发」）。 */
    const spend = addShopSpend(run, price);
    run.shop.retrySold = true;
    run.retryToken = Math.max(0, Number(run.retryToken) || 0) + 1;
    save();
    return { ok: true, left: run.retryToken, price: price, shopSpend: spend };
  }
  function rerollShop() {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false, msg: '商店还没开张。' };
    const guard = trialShopGuard(run);
    if (guard) return guard;
    const shop = run.shop;
    const free = !!shop.rerollFree;
    const raw = D().rerollPriceAt(Number(shop.rerollCount) || 0);
    const price = free ? 0 : shopDiscountApply(run, raw);
    let spend = null;
    if (!free) {
      if (run.coins < price) return { ok: false, msg: '试炼币不足（本次刷新需要 ' + price + ' 币）。' };
      run.coins -= price;
      spend = addShopSpend(run, price);                     // 刷新也是「在试炼商店消费」
    }
    shop.rerollFree = false;
    shop.rerollCount = (Number(shop.rerollCount) || 0) + 1;
    shop.rerollPaid = price;
    shop.slots = rollShopSlots(run, price);
    /* 讨价还价（E14）：**每一页都重新触发** —— 按这家店记下的 halfPerPage 给新货架再打一遍。 */
    applyShopHalfCount(shop.slots, shop.halfPerPage);
    save();
    /* 期望值按**这一页真实件数**算（第 41 层起货架只有 3 件，不能再按 5 报）。 */
    return { ok: true, paid: price, expect: D().rerollExpectation(price, run, shop.slots.length),
      nextPrice: D().rerollPriceAt(shop.rerollCount), shopSpend: spend };
  }
  /** 某一格的实际价格（试炼币）：进店时摇出的原价 → 讨价还价对折（向下取整）→ 店铺折扣。
   *  `slot.half` 由 applyShopHalf 在**进店那一刻**打上，界面据此显示「对折（原价 X）」。 */
  function shopPriceOf(buff, slot) {
    const run = endless().run;
    const base = slot && Number.isFinite(Number(slot.price)) ? Number(slot.price) : D().shopPrice(buff);
    const priced = slot && slot.half ? Math.floor(Math.max(0, base) / 2) : base;
    return shopDiscountApply(run, priced);
  }
  /** 把当前这家店的折扣比例套到价格上（E04 −30% / E01 −50% / 两者 −65%）。 */
  function shopDiscountApply(run, base) {
    const shop = run && run.shop;
    if (!shop || !shop.discount) return base;
    const pct = Math.max(0, Number(shop.discountPct) || 0.5);
    return Math.max(1, Math.round(base * (1 - pct)));
  }
  function debugGrantBuff(id) {
    const run = endless().run;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    const buff = D().BUFF_BY_ID[id];
    if (!buff) return { ok: false, msg: '没有这个增益。' };
    const res = addBuff(run, id);
    save();
    return { ok: !!(res && res.ok), buff, res };
  }
  /** 调试台：失去一条增益。`ref` 优先当 uid（精确移除那一条），否则按 id 取**最后一条**。 */
  function debugLoseBuff(ref) {
    const run = endless().run;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    if (run.pendingPick && run.pendingPick.buffId === ref) {
      run.pendingPick = null;
      run.pickBuffIds = (run.pickBuffIds || []).filter((x) => x !== ref);
      dropPickBoost(run, ref);
      logBuff(run, ref, 'lose', { detail: '调试台取消待选取' });
      save();
      return { ok: true, id: ref, cancelledPick: true };
    }
    /* 1) 先按「栏位引用」精确移除（uid 或 id-LIFO）。 */
    const hit = findRowRef(run, ref);
    if (hit) {
      const row = hit.row, list = hit.list, id = row.id;
      const removedStacks = Math.max(1, Math.floor(Number(row.stacks) || 1));
      list.splice(list.indexOf(row), 1);
      resetGrowth(run, id, removedStacks, row);
      syncSlotFree(run);
      run.pickBuffIds = (run.pickBuffIds || []).filter((x) => x !== id);
      run.permSlotIds = (run.permSlotIds || []).filter((x) => x !== id);
      dropPickBoost(run, id);
      if (run.pendingPick && run.pendingPick.buffId === id) run.pendingPick = null;
      logBuff(run, id, 'lose', { detail: '调试台失去' });
      save();
      return { ok: true, id, uid: row.uid };
    }
    /* 2) 再处理字符串名单（扩容类 / 选取型的登记）。 */
    for (const list of [run.permSlotIds || [], run.pickBuffIds || []]) {
      const i = (list || []).findIndex((b) => (typeof b === 'string' ? b === ref : b.id === ref));
      if (i >= 0) {
        const removed = list[i];
        const id = typeof removed === 'string' ? removed : removed.id;
        list.splice(i, 1);
        resetGrowth(run, id, 1);
        syncSlotFree(run);
        run.pickBuffIds = (run.pickBuffIds || []).filter((x) => x !== id);
        run.permSlotIds = (run.permSlotIds || []).filter((x) => x !== id);
        // 选取型被移除时，连带清掉它强化过的武器/技能与待选取状态
        dropPickBoost(run, id);
        if (run.pendingPick && run.pendingPick.buffId === id) run.pendingPick = null;
        logBuff(run, id, 'lose', { detail: '调试台失去' });
        save();
        return { ok: true, id };
      }
    }
    return { ok: false, msg: '本局没有这个增益。' };
  }
  /** 卖出价：默认按「全部栏位的总层数」算；传入 stacks 时按**单个栏位**算。
   *  【2026-10 同名逐条】传入 `row` 时，C25 的累计加价只算**这一栏自己的** `row.grow.sellBonus`。
   *  【2026-10 用户口径】回收乘数按**类型**分：限次件 30%（`SHOP.sellBackLimited`），
   *  永久件维持 40%（`SHOP.sellBack`）—— 限次件是临时收益，按永久件的价回收偏便宜。 */
  function sellPriceOf(run, buff, stacks, row) {
    const sellBack = buff.kind === 'limited'
      ? (D().SHOP.sellBackLimited != null ? D().SHOP.sellBackLimited : D().SHOP.sellBack)
      : D().SHOP.sellBack;
    const base = buff.mods && buff.mods.sellValue
      ? Number(buff.mods.sellValue)
      : Math.max(1, Math.round(D().shopPrice(buff) * sellBack));
    const n = Math.max(1, Math.floor(Number(stacks != null ? stacks : stacksOf(run, buff.id)) || 1));
    const bonus = (row && growOf(row, 'sellBonus') > 0) ? growOf(row, 'sellBonus') : Math.max(0, Number(run.sellBonus) || 0);
    const unit = (buff.id === 'C25' && (row ? true : stacksOf(run, 'C25') > 0))
      ? base + Math.max(0, Math.floor(bonus))
      : base;
    return unit * n;
  }
  /** 卖出：`ref` 优先当 uid（精确卖那一条），否则按 id 卖**最后拿到的那一栏**（LIFO）。 */
  function sellBuff(ref) {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false };
    const guard = trialShopGuard(run);
    if (guard) return guard;
    const hit = findRowRef(run, ref);
    if (!hit) return { ok: false };
    const row = hit.row, list = hit.list, id = row.id;
    const buff = D().BUFF_BY_ID[id];
    if (!buff || buff.kind === 'instant' || D().hasTag(buff, 'hidden')) return { ok: false };   // 隐藏型不可出售
    const stacks = Math.max(1, Math.floor(Number(row.stacks) || 1));
    const gain = sellPriceOf(run, buff, stacks, row);   // 只算这一栏的层数（含这一栏自己的累计加价）
    list.splice(list.indexOf(row), 1);
    resetGrowth(run, id, stacks, row);
    syncSlotFree(run);
    run.coins += gain;
    logBuff(run, id, 'lose', { detail: '商店卖出 ' + (stacks > 1 ? ('×' + stacks + ' 层 ') : '') + '+' + gain + ' 试炼币' });
    save();
    return { ok: true, gain, id, uid: row.uid };
  }
  /** 商店逛完：进入结算点（每 5 层的固定流程 商店 → 结算）。 */
  function openRestShop() {
    const run = endless().run;
    if (!run || !run.choices) return { ok: false, msg: '只有休整点（每层第 3 场后）能开休整商店。' };
    if (run.restShopUsed) return { ok: false, msg: '本层的休整商店已经用过了。' };
    /* 【100 层循环】整百层不开任何商店（见 makeShop 的守卫）——
     * 判在**扣 restShopUsed 之前**：店没开成就不该把这一层的名额吃掉。 */
    if (D().layerNoShop(run.layer)) return { ok: false, msg: '整百层（觐见魔王）不开商店。' };
    run.restShopUsed = true;
    /* 【2026-10 修复】休整商店同样要把「当前开着的立即进货（E01）」的折扣算进去 ——
     * 它与「打完这场再开的那家店」是**同一个折扣口径**，只是入口不同。
     * 以前这里不传 e01Pct：于是手上同时有 E04 steam大促 与 E01 时，
     * 休整商店会先按 E04 的 −30% 结算，**并且把 E04 的份数与比例一起清零**
     *（makeShop 的 `stacks > 0` 分支）→ 之后 E01 真正开出来的那家店只剩 −30%（7 折），
     * 用户在「立即进货 ＋ steam大促」下永远看不到 3.5 折。
     * 传了 e01Pct 之后，这里就会走合并分支（−65%），并且 E04 的份数**不会被这里吃掉**，
     * 收摊时由 closeShop 统一清。 */
    run.shop = makeShop(run, activeShopCredit(run));
    run.shop.rest = true;
    run.phase = 'shop';
    save();
    return { ok: true };
  }
  function closeShop() {
    /* 关店只结束「这家店的折扣」，不该把**还没用掉的份数**一起清掉
     * （那是玩家花钱买的，下一家店还要用）。 */
    { const r = endless().run; if (r && r.shop) r.shop.discount = false; }
    /* 【2026-10 修复】E04 的份数在「合并店」里故意留到最后，这里收摊时必须清干净：
     * 合并店已经按 −65% 结算过了，再留着就会把这段高折扣漏给下一家店。
     * 判据用店上的 `combinedCoupon` 标记（别靠 discountPct 反推，将来可能出现更强的单张券）。 */
    { const r = endless().run;
      if (r && r.shop && r.shop.combinedCoupon === true) {
        r.shopDiscount = Math.max(0, Math.floor(Number(r.shopDiscount) || 0) - 1);
        if (r.shopDiscount <= 0) r.shopDiscountPct = 0;
      } }
    const run = endless().run;
    if (!run || run.phase !== 'shop') return { ok: false };
    /* 去向按**这家店是怎么开的**决定，而不是按层数：
     *   · 休整商店（rest）/ 战后立即进货（postBattle）/ 立即开店 —— 关掉后回去继续打
     *   · 每 5 层的结算商店（boundary）—— 关掉后去结算点
     * 原来只判 rest，于是「第 10 层第 1 场打完用立即进货开的店」关掉后被当成结算商店，
     * 一走 continueEndless 就把整层直接推进到下一层 —— 本层剩下的场次与**层通商店**
     * 全都被跳过（用户报的「后面的商店消失了」）。 */
    const shop = run.shop || {};
    /* 铸币商店没有「结算点」这一步：关掉就是继续打（它可能出现在层中，也可能在层末）。 */
    if (shop.mint) return leaveMintShop();
    run.phase = (!shop.rest && !shop.postBattle) ? 'checkpoint' : null;
    /* 店本身也要收掉：只归位 phase 的话，`shopState()` 仍然拿得到一家店，
     * 界面「离开」按钮就是踩在这个坑上（没关店 → 首页按钮还是「进入试炼商店」→ 出不去）。 */
    run.shop = null;
    save();
    return { ok: true };
  }

  /* ============================================================
   * 【T17c】讨价还价（E14）：每一页货架都给随机商品对折
   *   applyShopHalf      —— 进店那一刻：把 run.shopHalfPending 兑现到**这一页**，
   *                         并把「本店每页几件」记在 shop.halfPerPage 上；
   *   applyShopHalfCount —— 按给定件数给一页打标记（刷新货架时按 halfPerPage 重打一遍）。
   *   用户口径：**商店每一页刷新都重新触发**（试炼商店与铸币商店都一样），
   *   所以刷新走的是「同一个 halfPerPage 再打一遍」，不再消耗玩家攒下的份数。
   * ============================================================ */

  /** 给这一页货架兑掉 N 份「对折」：每份挑一件还没被打过折的商品，打上 `half` 标记。
   *  价格本身不改（展示要看到原价），折扣在 shopPriceOf / buyMintSlot 里按标记结算。 */
  function applyShopHalfCount(slots, count) {
    let left = Math.max(0, Math.floor(Number(count) || 0));
    if (!left || !Array.isArray(slots) || !slots.length) return 0;
    let marks = 0;
    while (left > 0) {
      const cand = slots.filter((s) => s && !s.half);
      if (!cand.length) break;                                 // 这一页都打过了 → 剩下的留到下一家店
      cand[Math.floor(Math.random() * cand.length)].half = true;
      left--; marks++;
    }
    return marks;
  }
  /** 进店那一刻：把「攒下的份数」兑现在这一页上，并记下**本店每页几件对折**。
   *  一页装不下时剩下的份数留到下一家店（`run.shopHalfPending` 记差额）。 */
  function applyShopHalf(run, slots, shop) {
    const want = Math.max(0, Math.floor(Number(run && run.shopHalfPending) || 0));
    const applied = applyShopHalfCount(slots, want);
    if (shop) shop.halfPerPage = applied;
    if (run) run.shopHalfPending = Math.max(0, want - applied);
    return applied;
  }

  /* ============================================================
   * 【T17b】无尽：铸币商店（战后 5% 随机小店）
   *   rollMintShop / openMintShop / makeMintShop / rollMintSlots / mintCandidates
   *   buyMintSlot / swapMintBuff / rerollMintShop / leaveMintShop / closeMintShop
   *
   * 与试炼商店共用 `run.shop`，靠 `mint` 标记区分两套规则：
   *   · 试炼商店：试炼币交易、吃 E01/E04 折扣、可卖增益、有 C36/C58 消费钩子与 C59 进门币；
   *   · 铸币商店：**铸币**交易（售价按稀有度固定，不吃任何折扣）、免费交换一件、
   *     免费刷新一次；不做「试炼商店消费」记账（花的不是试炼币），也不发 C59 的进门币。
   * 刷出时机与「同一组连续三层只出一次」的判定都在 reportBattle 里（见那里的注释）。
   * ============================================================ */

  /** 这一场打完之后要不要刷出铸币商店（只判定，不动任何状态）。
   *  条件：层数在区间内（5 层之后的 x2/x3/x4、x7/x8/x9）+ 这一组连续三层还没刷过
   *  + 概率（**随深度增长**：5% 起步、每 5 层 +0.5%、10% 封顶，见 TowerData.mintChance）。 */
  function rollMintShop(run, layer) {
    const L = Math.max(1, Math.floor(Number(layer) || 1));
    if (!D().mintLayerOk(L)) return false;
    if (Number(run.mintGroup) === D().mintGroupOf(L)) return false;   // 这一组已经出过一次
    return Math.random() < clamp01(D().mintChance(L));
  }
  /** 铸币商店的候选：某稀有度 + （只要运营类时）带 ops 标签 + 还没拿满。
   *  可获得性直接用 pickChoice / 试炼商店那一套（ownable + poolFilter），口径完全一致。 */
  function mintCandidates(run, rarity, opsOnly, taken) {
    return D().mintPool.filter((b) => b.rarity === rarity
      && (!opsOnly || D().hasTag(b, 'ops'))
      && !(taken && taken.has(b.id))
      && ownable(run, b) && poolFilter(run, b));
  }
  /** 摇一页铸币商店货架：5 件；稀有度按「试炼商店花 40 币刷新」的排布（普通档再压一档，
   *  见 TowerData.mintWeights）。非传奇档「大概率」给运营类，传奇档不设这个限制。 */
  function rollMintSlots(run) {
    const S = D().MINT_SHOP;
    const slots = [], taken = new Set();
    const opsChance = clamp01(S.opsChance);
    const shelf = Math.max(1, Math.floor(Number(S.shelf) || 5));
    const baseTier = D().mintWeights(run);
    for (let i = 0; i < shelf; i++) {
      /* 动态档位权重：铸币商店也吃「个体降权 → 整档缩水」这一套。
       * 档内保留原来的「大概率运营类」子池偏向（它只影响档内挑谁，不影响档位预算）。 */
      const allCands = [];
      for (let r = 0; r < 4; r++) allCands.push(...mintCandidates(run, r, false, taken));
      if (!allCands.length) break;                      // 整池都空了（极其罕见）
      const tierW = rollableTierWeights(dynamicTierWeights(baseTier, run, allCands), baseTier);
      const want = rollRarity(tierW);
      let rarity = -1, pool = null;
      for (const r of [want, want + 1, want + 2, want + 3, want - 1, want - 2, want - 3]) {
        if (r < 0 || r > 3) continue;
        const list = mintCandidates(run, r, false, taken);
        if (list.length) { rarity = r; pool = list; break; }
      }
      if (rarity < 0) break;
      /* 「大概率运营类」：抽中就只在运营子池里挑，没抽中就在非运营子池里挑；
       * 想要的子池空了就退回整档 —— 「有货可卖」优先于「是不是运营」。 */
      let target = pool;
      if (rarity !== 3) {
        const wantOps = Math.random() < opsChance;
        const sub = pool.filter((b) => D().hasTag(b, 'ops') === wantOps);
        if (sub.length) target = sub;
      }
      const buff = pickByShopWeight(target, run);
      if (!buff) break;
      taken.add(buff.id);
      /* price 的单位是**铸币**（试炼商店那边是试炼币）—— 固定价，不吃折扣。 */
      slots.push({ id: buff.id, sold: false, price: D().mintPrice(buff) });
    }
    return slots;
  }
  function makeMintShop(run, layer) {
    const slots = rollMintSlots(run);
    /* 门庭若市（C59）**对铸币商店也生效**（用户口径）：进店照样发试炼币。 */
    const enterCoins = grantShopEnterCoins(run);
    const shop = {
      mint: true,
      layer: Math.max(1, Math.floor(Number(layer) || Number(run.layer) || 1)),
      slots: slots,
      rerollFree: true,          // 可免费刷新一次
      rerollCount: 0,
      swapped: false,            // 是否用掉了「免费交换」
      enterCoins: enterCoins || undefined,
    };
    /* 讨价还价（E14）**对铸币商店也生效**（用户口径）：铸币固定价同样对折、向下取整，
     * 于是 1 铸币的稀有件会变成 0、3 铸币的传奇件变成 1；免费刷新后的新一页也照样触发。 */
    applyShopHalf(run, slots, shop);
    return shop;
  }
  /** 开一家铸币商店：默认记账「这一组连续三层已经出过」并把 phase 切到商店。
   *  opts.debug    调试台手开：**不记组号** —— 手开一家不该把这一组自然刷出的机会吃掉；
   *  opts.noGroup  限次增益（E16 铸币商队）触发：同样不记组号 —— 它是额外送的一家店，
   *                这一组后面几场照样可以自然刷出；
   *  opts.byBuff   标记「这家店是限次增益触发的」（界面据此写清来由）；
   *  opts.boundary 标记「它顶掉了每 5 层的结算商店」—— 收摊后按结算商店的去向推进
   *                （见 closeMintShop / leaveMintShop）。 */
  function openMintShop(run, layer, opts) {
    const o = opts || {};
    /* 【100 层循环】整百层不开任何商店 —— 铸币商店同样让位（debug 手开的也拦住：
     * 「这一层不开店」在调试台里也该成立，免得测出来的节奏与实战不一致）。 */
    if (D().layerNoShop(run && run.layer)) return null;
    if (!o.debug && !o.noGroup) run.mintGroup = D().mintGroupOf(layer);
    run.shop = makeMintShop(run, layer);
    if (o.byBuff) run.shop.byBuff = true;
    if (o.boundary) run.shop.boundary = true;
    run.phase = 'shop';
    return run.shop;
  }
  /** 铸币商店里「免费交换」还开着吗：没换过、也没刷过货架。 */
  function swapAllowedOf(run) {
    const shop = run && run.shop;
    return !!(shop && shop.mint && shop.swapped !== true && !(Number(shop.rerollCount) > 0));
  }
  /** 收摊：买 / 换完成、或玩家直接走人 —— 这家店立刻消失（不会再来）。
   *  若这家店顶掉了「每 5 层的结算商店」（boundary），收摊后照旧走结算商店的去向：
   * 20/30… 层先放弃一个永久增益，否则直接推进到下一层 —— 否则整局会卡在
   * 「本层已清空、却没有下一步」的死状态里。 */
  function closeMintShop(run) {
    run = run || endless().run;
    if (!run || !run.shop) return false;
    const boundary = run.shop.mint === true && run.shop.boundary === true;
    run.shop = null;
    if (boundary) { advancePastBoundaryShop(run); return true; }
    run.phase = null;
    return true;
  }
  /** 花铸币买走货架上一件（买完立刻收摊）。 */
  function buyMintSlot(index, replaceId) {
    const run = endless().run;
    if (!run || !run.shop || !run.shop.mint) return { ok: false, msg: '现在不在铸币商店里。' };
    const slot = run.shop.slots[index];
    if (!slot || slot.sold) return { ok: false, msg: '这件已经卖掉了。' };
    const buff = D().BUFF_BY_ID[slot.id];
    if (!buff) return { ok: false, msg: '没有这件增益。' };
    const base = D().mintPrice(buff);                      // 固定价（普通 0 / 稀有 1 / 史诗 2 / 传奇 3）
    /* 讨价还价（E14）：这一格在进店时被抽中对折 —— 向下取整（1 铸币 → 0）。 */
    const price = slot.half ? Math.floor(base / 2) : base;
    const tokens = Math.max(0, Math.floor(Number(run.retryToken) || 0));
    if (tokens < price) return { ok: false, msg: '铸币不足（需要 ' + price + ' 枚，现有 ' + tokens + ' 枚）。' };
    const permanentFull = occupiesPermSlot(buff) && permUsed(run) >= permSlots(run) &&
      !(run.permanent || []).some((b) => b.id === buff.id);
    if (permanentFull && !replaceId) {
      return { ok: false, needsReplace: true, buff, msg: '永久增益已满，请选择要替换掉的增益。' };
    }
    run.retryToken = tokens - price;
    slot.sold = true;
    const res = addBuff(run, slot.id, replaceId);
    if (!res || !res.ok) {                                  // 买不了就原样退钱、货还在架上
      run.retryToken = tokens;
      slot.sold = false;
      save();
      return { ok: false, msg: (res && res.msg) || '这件增益现在买不了。' };
    }
    const pts = scoreBuffAcquire(run, buff);
    /* 「获得增益」的流水由 addBuff 记；这里只把店收掉（买一件 = 店立刻消失）。 */
    closeMintShop(run);
    save();
    return { ok: true, buff, price, left: run.retryToken, instant: !!res.instant,
      score: pts, pendingPick: res.pendingPick || null };
  }
  /** 收走一件已有增益（交换的「取走」那一半）：增益本体 + 槽位 / 附魔 / 成长登记一起回收。 */
  function takeOwnedBuff(run, ref) {
    /* 【2026-10 同名逐条】`ref` 优先当 uid（精确到那一条），否则按 id 取最后一条。 */
    const hit = findRowRef(run, ref);
    if (!hit) return null;
    const row = hit.row, list = hit.list;
    const id = row.id;
    const stacks = Math.max(1, Math.floor(Number(row.stacks) || 1));
    const snapshot = Object.assign({}, row);
    list.splice(list.indexOf(row), 1);
    const m = (D().BUFF_BY_ID[id] || {}).mods || {};
    /* 扩容类：把名额还回去（addBuff 的「替换」路径不管这一条，会留下幽灵槽位）。 */
    if (m.permSlot) {
      run.permSlots = Math.max(0, (Number(run.permSlots) || 0) - (Number(m.permSlot) || 0));
      run.permSlotIds = (run.permSlotIds || []).filter((x) => x !== id);
    }
    /* 选取型（隐藏型已被 swapMintBuff 挡下，这里只是兜底）：清掉附魔登记与待选状态。 */
    if (m.pickWeaponPct || m.pickSkillPct || m.pickPermanentFree || m.pickPermanentMul || m.pickBrandBreak || m.pickLimitedUses) {
      run.pickBuffIds = (run.pickBuffIds || []).filter((x) => x !== id);
      dropPickBoost(run, id);
      if (run.pendingPick && run.pendingPick.buffId === id) run.pendingPick = null;
    }
    syncSlotFree(run);                                       // 行已摘掉 → 镜像跟着重算
    resetGrowth(run, id, stacks, snapshot);                  // 只回收**这一栏**的成长
    logBuff(run, id, 'lose', { detail: '铸币商店交换' });
    return { row: snapshot, stacks: stacks };
  }
  /** 免费交换的目标：按用户口径摇一件「换给你的」增益。
   *   · 大概率（swapOpsChance）→ **同稀有度的运营类**；其中普通件另有 50% 升成稀有件，
   *     其它稀有度必定同档；
   *   · 小概率 → 同稀有度的非运营类。
   *  某一支抽空（拿满了 / unique 已拥有）时逐级退回，最后放宽到任意档 —— 绝不空手。 */
  function rollSwapTarget(run, srcBuff) {
    const S = D().MINT_SHOP;
    const isOps = (b) => D().hasTag(b, 'ops');
    const rarity = Math.max(0, Math.min(3, Math.floor(Number(srcBuff && srcBuff.rarity) || 0)));
    /* 不把玩家刚拿走的那一条再塞回来（可叠层的 C26~C29 本来就在池子里，
     * 不排掉的话会出现「拿 2 层蛮力换回 1 层蛮力」这种纯亏的交换）。 */
    const srcId = srcBuff && srcBuff.id;
    const at = (r, ops) => D().mintPool.filter((b) => b.rarity === r && b.id !== srcId
      && (ops === null || isOps(b) === ops) && ownable(run, b) && poolFilter(run, b));
    const wantOps = Math.random() < clamp01(S.swapOpsChance);
    let r = rarity;
    if (wantOps && rarity === 0 && Math.random() < clamp01(S.swapCommonUp)) {
      r = Math.max(0, Math.min(3, Math.floor(Number(S.swapCommonUpRarity) || 1)));
    }
    const tries = wantOps
      ? [[r, true], [rarity, true], [rarity, false], [rarity, null]]
      : [[rarity, false], [rarity, true], [rarity, null]];
    for (const pair of tries) {
      const list = at(pair[0], pair[1]);
      if (list.length) return pickByShopWeight(list, run) || list[0];
    }
    const anyList = D().mintPool.filter((b) => b.id !== srcId && ownable(run, b) && poolFilter(run, b));
    return anyList.length ? (pickByShopWeight(anyList, run) || anyList[0]) : null;
  }
  /** 免费交换：拿自己的一件永久 / 限次增益，换一件新的（不花铸币）；做成就收摊。
   *  【2026-10 同名逐条】`ref` 优先当 uid（交换指定的那一条），否则按 id 取最后一条。 */
  function swapMintBuff(ref) {
    const run = endless().run;
    if (!run || !run.shop || !run.shop.mint) return { ok: false, msg: '现在不在铸币商店里。' };
    if (!swapAllowedOf(run)) return { ok: false, msg: '刷新过货架之后就不能再免费交换了。' };
    const hit = findRowRef(run, ref);
    if (!hit) return { ok: false, msg: '这件增益不在本局身上。' };
    const row = hit.row;
    const id = row.id;
    const buff = D().BUFF_BY_ID[id];
    if (!buff) return { ok: false, msg: '没有这件增益。' };
    if (buff.kind === 'instant' || D().hasTag(buff, 'hidden')) return { ok: false, msg: '只有永久 / 限次增益能拿去交换。' };
    /* 免占位的（虚空铭文附魔过）换掉腾不出格子：提前说清楚，别先收走再失败。 */
    const target = rollSwapTarget(run, buff);
    if (!target) return { ok: false, msg: '现在没有能换给你的增益（池子里的都被你拿满了）。' };
    if (rowFreeOf(row) && occupiesPermSlot(target)
        && permUsed(run) >= permSlots(run)) {
      return { ok: false, msg: '【' + buff.name + '】已被虚空铭文附魔、不占槽位；永久增益栏已满，换它腾不出位置。' };
    }
    const taken = takeOwnedBuff(run, Number(row.uid) > 0 ? Number(row.uid) : id);
    const res = addBuff(run, target.id);
    if (!res || !res.ok) {
      /* 兜底（正常走不到）：把源增益原样放回去，不让玩家白掉一条。 */
      const L = buff.kind === 'permanent' ? (run.permanent || (run.permanent = [])) : (run.limited || (run.limited = []));
      if (taken) L.push(taken.row);
      applyBuffOnAcquire(run, buff);   // 含永久 maxHpMul 的粘性折算（见该函数）
      if (taken && taken.row && taken.row.slotFree) markRowFree(run, taken.row);
      save();
      return { ok: false, msg: (res && res.msg) || '交换失败。' };
    }
    run.shop.swapped = true;                                 // 交换用完 → 店立刻消失
    const pts = scoreBuffAcquire(run, target);
    closeMintShop(run);
    save();
    return { ok: true, from: id, fromUid: row.uid, fromName: buff.name, fromRarity: buff.rarity,
      buff: target, score: pts, pendingPick: res.pendingPick || null };
  }
  /** 免费刷新货架（一次）。刷新之后就不能再用「免费交换」了。 */
  function rerollMintShop() {
    const run = endless().run;
    if (!run || !run.shop || !run.shop.mint) return { ok: false, msg: '现在不在铸币商店里。' };
    if (!run.shop.rerollFree) return { ok: false, msg: '铸币商店只免费刷新一次。' };
    run.shop.rerollFree = false;
    run.shop.rerollCount = (Number(run.shop.rerollCount) || 0) + 1;
    run.shop.slots = rollMintSlots(run);
    /* 讨价还价（E14）：刷新出的新一页**重新触发**（与试炼商店同一条口径）。 */
    applyShopHalfCount(run.shop.slots, run.shop.halfPerPage);
    save();
    return { ok: true, slots: run.shop.slots.length };
  }
  /** 直接走人：不买不换也一样收摊（这家店不会再来）。只对铸币商店有效。
   *  顶掉结算商店的那一家（boundary）按结算商店的去向推进 —— 与买 / 换后的收摊同一口径。 */
  function leaveMintShop() {
    const run = endless().run;
    if (!run || !run.shop || !run.shop.mint) return { ok: false, msg: '现在不是铸币商店。' };
    if (run.shop.boundary === true) {
      run.shop = null;
      return advancePastBoundaryShop(run);
    }
    closeMintShop(run);
    save();
    return { ok: true, layer: run.layer };
  }

  /* ============================================================
   * 【T18】无尽：结算点与永久牺牲 —— checkpointInfo / sacrificePerm
   * ============================================================ */

  function checkpointInfo() {
    const run = endless().run;
    if (!run) return null;
    const s = D().endlessSegment(run.layer);
    const coins = Math.max(0, Math.floor(Number(run.coins) || 0));
    const tokens = Math.max(0, Math.floor(Number(run.retryToken) || 0));
    const now = D().endlessTickets(run.layer);
    return { layer: run.layer, score: run.score, coins, retryToken: tokens,
      ticketsNow: now,
      /* 「立刻能领多少」= 本层应得 + 铸币折现（试炼币不折现、只作废；
       * 与界面上的「离场可得」、放弃本局、失败结算完全一致） */
      ticketsNowTotal: now + tokens,
      ticketsNext: D().endlessTickets((s + 1) * 5),       // 下一结算点（再撑 5 层）的升档面值
      nextCheckpoint: (s + 1) * 5 };
  }
  /** 结算离场：抽奖卷入包（含剩余试炼币 1:1 折现），分数入账，本局结束。 */
  function settleEndless() {
    const e = endless(), run = e.run;
    if (!run || run.phase !== 'checkpoint') return { ok: false };
    const out = { ok: true, score: run.score, layer: run.layer };
    settleRunTickets(run, out);          // 与放弃本局 / 失败结算同一条结算
    settleScore(run, out);
    e.run = null;
    save();
    return out;
  }
  /** 结算商店（每 5 层）关掉之后的去向：20/30… 层先放弃一个永久增益，否则推进到下一层。
   *  试炼商店（continueFromShop）与「顶掉它的铸币商店」（closeMintShop / leaveMintShop）
   *  共用这一份，免得哪一条路把整局的推进弄丢。 */
  function advancePastBoundaryShop(run) {
    if (needPermSacrifice(run.layer) && (run.permanent || []).length) {
      run.phase = 'sacrifice';
      save();
      return { ok: true, phase: 'sacrifice', layer: run.layer };
    }
    run.phase = null;
    advanceLayer(run, 'endless');
    save();
    return { ok: true, layer: run.layer };
  }
  function continueFromShop() {
    const run = endless().run;
    if (!run || run.phase !== 'shop') return { ok: false };
    run.shop = null;
    return advancePastBoundaryShop(run);
  }
  /** 是否需要在「刚清完这一层」时放弃一个永久增益（**轮内第 20 层起、每 10 层一次**）。
   *  【100 层循环】门槛一律比**轮内层号**（`cycleLayer`）：第 1 轮 20/30/…/100 层要交，
   *  第 2 轮则是 120/130/…/200 层（不是 110）；第 3 轮 220/230/… 同理。
   *  ⚠ `n >= 20` 若不换成轮内层号，第 110 / 210 层（轮内第 10 层）会被误判成「要交增益」——
   *  这与第 10 层不一致，破坏「层号 → 机制」每轮严格对应的口径（回归用例会抓到）。
   *  ⚠ 另一个坑：块注释里别写「两个星号 + 加粗 + 紧跟一个斜杠」那种写法 ——
   *  星号斜杠会**提前关闭注释**，剩下的文字变成代码 → 整份文件语法错误（本行注释踩过一次）。 */
  function needPermSacrifice(layer) {
    const n = Math.max(0, Math.floor(Number(layer) || 0));
    return D().cycleLayer(n) >= 20 && n % 10 === 0 && D().sacrificeAllowed(n);
  }
  /** 本局可被放弃的永久增益（隐藏型本来就不占槽，不算）。 */
  function sacrificeCandidates(run) {
    return (run.permanent || [])
      .map((b) => ({ id: b.id, uid: b.uid, slotFree: rowFreeOf(b), stacks: Math.max(1, Math.floor(Number(b.stacks) || 1)),
        buff: D().BUFF_BY_ID[b.id] }))
      .filter((x) => x.buff && !D().hasTag(x.buff, 'hidden'));
  }
  /** 放弃一个永久增益（20 起每 10 层的必经步骤）。`ref` 优先当 uid（精确到那一条）。放弃后继续推进到下一层。 */
  function sacrificePerm(ref) {
    const run = endless().run;
    if (!run || run.phase !== 'sacrifice') return { ok: false, msg: '现在不是放弃永久增益的时机。' };
    const hit = findRowRef(run, ref);
    const row = hit && hit.list === run.permanent ? hit.row : null;
    if (!row) return { ok: false, msg: '只能放弃你已有的永久增益。' };
    const id = row.id;
    const pick = { id: id, buff: D().BUFF_BY_ID[id] };
    if (!pick.buff) return { ok: false, msg: '只能放弃你已有的永久增益。' };
    /* 从永久列表里摘掉（叠层的一次只掉一层，掉光才移出）。 */
    row.stacks = Math.max(0, Math.floor(Number(row.stacks) || 1) - 1);
    if (row.stacks <= 0) {
      /* 老口径：放弃**不回收**成长 —— run 级字段保持不动，只把这一条从永久表移除。 */
      run.permanent = run.permanent.filter((b) => b !== row);
    }
    /* 虚空铭文的免占位要一并清掉（那条增益已经不在本局了）。 */
    syncSlotFree(run);
    /* 成长类已经冻结进 run 的收益**不回收**（与「卖出/替换后保留」的既有口径一致），
     * 但治愈类/烙印类的即时登记要按份数退回：这里只处理「获得时写进 run 的一次性登记」。 */
    const mods = pick.buff.mods || {};
    if (mods.permSlot) run.permSlots = Math.max(0, (Number(run.permSlots) || 0) - mods.permSlot);
    /* 兜底：选取型强化（C32/C33）目前带 hidden、不会出现在放弃候选里；
     * 万一将来去掉 hidden，这里保证加成与待选取状态一起清掉。 */
    if (id === 'C32' || id === 'C33') { dropPickBoost(run, id); run.pickBuffIds = (run.pickBuffIds || []).filter((x) => x !== id); }
    const log = { id: id, name: pick.buff.name, stacks: row.stacks };
    run.lastSacrifice = { id: id, name: pick.buff.name, layer: run.layer };
    run.phase = null;
    advanceLayer(run, 'endless');
    const lost = applyBrokenMarkLoss(run);
    save();
    return { ok: true, sacrificed: log, lostMark: lost, layer: run.layer };
  }
  function applyBrokenMarkLoss(run) {
    /* 【100 层循环】「30 层之后每 2 层随机丢掉一条烙印」按**轮内层号**判（用户口径 2026-10：
     * 「随机丢烙印也到原来的层数 +100 层再开始随机丢」）——
     * 第 1 轮：32 / 34 / … / 100 层；第 2 轮：**132** 起（101~131 层不丢），以此类推。
     * ⚠ 别再写成绝对层号 `layer > 30 && layer % 2 === 0`：那样 102 / 104… 层就会开始丢，
     * 与第 1 轮的映射对不上。判据统一走 TowerData.canBrandLoss。 */
    if (!D().canBrandLoss(run && run.layer)) return null;
    const layer = Math.max(0, Math.floor(Number(run && run.layer) || 0));
    const lost = loseRandomBrokenMark(run);
    if (!lost) return null;
    run.lostMarks = (run.lostMarks || []).concat([{ layer: layer, label: lost.label }]).slice(-20);
    return lost;
  }
  /** 商店里的「结算」：等于结算点离场（抽奖卷入包、分数入账）。 */
  function settleFromShop() {
    const run = endless().run;
    if (!run || run.phase !== 'shop') return { ok: false };
    /* 铸币商店不给「结算离场」（它是层中偶遇的小店，不是在结算点上）——
     * 除了「顶掉每 5 层结算商店」的那一家（boundary）：它本来就站在结算点上，
     * 不给离场等于把这一段的结算机会吞掉。 */
    if (run.shop && run.shop.mint && run.shop.boundary !== true) {
      return { ok: false, msg: '铸币商店不能结算离场。' };
    }
    run.phase = 'checkpoint';
    return settleEndless();
  }
  /** 继续挑战：卷不领取，进入下一段（失败则全部作废）。 */
  function continueEndless() {
    const run = endless().run;
    if (!run || run.phase !== 'checkpoint') return { ok: false };
    run.phase = null;
    advanceLayer(run, 'endless');
    save();
    return { ok: true, layer: run.layer };
  }

  /* ============================================================
   * 【T19】放弃与认输 —— abandon
   * ============================================================ */

  function abandon(mode) {
    if (mode === 'tower') {
      const run = tower().run;
      if (!run || run.attempt) return { ok: false };
      const layer = run.layer;
      tower().run = null;
      tower().retry = null;
      save();
      return { ok: true, layer };
    }
    const run = endless().run;
    if (!run || run.attempt) return { ok: false };
    const out = { ok: true, score: run.score, layer: run.layer };
    settleScore(run, out);
    settleRunTickets(run, out);
    endless().run = null;
    save();
    return out;
  }

  /* ============================================================
   * 【T20】界面展示信息 —— towerInfo / endlessInfo / ownedBuffs
   * ============================================================ */

  function towerInfo() {
    const t = tower(), s = S();
    const layer = t.maxLayer + 1;
    return { maxLayer: t.maxLayer, nextLayer: layer, books: s.props[BOOK_PROP] || 0,
      gold: D().towerGold(layer), battles: layer % 10 === 0 ? 5 : 4,
      level: D().towerLevel(layer), mult: D().towerMult(layer),
      retry: t.retry || null,
      run: t.run ? { layer: t.run.layer, battleNo: t.run.idx + 1, battleCount: t.run.plan.length, carry: t.run.carry,
        curMaxHp: currentMaxHp(t.run), curHp: currentHp(t.run).hp, hpAbs: hpAbsOf(t.run), pot: t.run.pot, failedAt: t.run.failedAt == null ? null : t.run.failedAt,
        choices: t.run.choices ? t.run.choices.slice() : null,
        debuffs: (t.run.debuffs || []).slice(),
        /* 环境词缀：挑战塔与无尽塔共用同一套环境（第 5 层起层内可能出现），
         * 主界面要把它画出来（与无尽塔同一个 envPanelHtml），所以这里必须一起给出，
         * 并且带上「本层摇到的实际数值」与渲染好的文案。
         * 挑战塔按 'tower' 口径渲染：贪婪裂隙那边显示成「厚甲裂隙」，不带试炼币那一档。 */
        env: (t.run.env || []).map((x) => {
          const raw = D().ENDLESS_ENV_BY_ID[x.id] || { id: x.id, name: x.id, desc: '' };
          const def = D().envDefFor(raw, 'tower');
          const values = envValues(t.run, x);
          const text = D().envText(raw, values, 'tower');
          return Object.assign({}, def, {
            left: x.left, values: values, text: text.text,
            rangeText: D().envRangeText(raw, 'tower'), mech: !!def.mech,
          });
        }),
        lastMaxHp: Math.max(0, Number(t.run.lastMaxHp) || 0),
        lastHp: Math.max(0, Number(t.run.lastHp) || 0),
        curMaxHp: currentMaxHp(t.run),
        // 下一场是谁 + 它的机制（选 buff 页要展示「你接下来要打的那个 boss 是什么」）
        next: t.run.plan[t.run.idx] ? Object.assign({ kind: t.run.plan[t.run.idx].kind }, entryInfo(t.run.plan[t.run.idx], t.run.layer, t.run.idx === t.run.plan.length - 1)) : null } : null,
      preview: preview(layer) };
  }
  function endlessInfo() {
    const e = endless();
    return { best: e.best, weekBest: e.weekBest, bestLayer: e.bestLayer,
      tickets: S().props[TICKET_PROP] || 0,
      run: e.run ? { layer: e.run.layer, score: e.run.score, coins: e.run.coins, carry: e.run.carry,
        /* 【U18】待播剧情 id（没有就是 null）—— 界面据此决定要不要进剧情展示模式。 */
        story: e.run.story || null,
        /* 上一场战斗赚到的试炼币（主界面右上角标在「试炼币」旁边）+ 那一场的乘区明细。 */
        lastCoinsGained: Math.max(0, Math.floor(Number(e.run.lastCoinsGained) || 0)),
        lastCoinBreak: e.run.lastCoinBreak ? Object.assign({}, e.run.lastCoinBreak,
          { boosts: (e.run.lastCoinBreak.boosts || []).map((b) => Object.assign({}, b)) }) : null,
        /* 下一场（本层）的战斗基础试炼币，界面提示要用。 */
        coinBase: D().coinBattleBase(e.run.layer),
        coinBand: D().coinBattleTierLabel(e.run.layer),
        battleNo: e.run.idx + 1, battleCount: e.run.plan.length, phase: e.run.phase,
      debuffs: (e.run.debuffs || []).slice(),
        choices: e.run.choices ? e.run.choices.slice() : null,
        next: e.run.plan[e.run.idx] ? Object.assign({ kind: e.run.plan[e.run.idx].kind }, entryInfo(e.run.plan[e.run.idx], e.run.layer, e.run.idx === e.run.plan.length - 1)) : null,
        bestLayer: e.run.bestLayer, segment: D().endlessSegment(e.run.layer),
        plan: (e.run.plan || []).map((entry, i) => Object.assign({ kind: entry.kind }, entryInfo(entry, e.run.layer, i === e.run.plan.length - 1))),
        /* 计分扩展：成就列表 + 本局加分流水（界面用它做提示与结算展示）。 */
        achievements: (e.run.achievements || []).slice(),
        scoreLog: (e.run.scoreLog || []).slice(-12),
        deathSaves: Math.max(0, Number(e.run.deathSaves) || 0),
        /* 段位机制已并入环境词缀：这里恒为空（界面统一显示环境）。 */
        mechs: [],
        restShopUsed: !!e.run.restShopUsed,
        /* 当前这一家在店里等着的店是不是铸币商店（首页的按钮文案要分开写）。 */
        mintShop: !!(e.run.shop && e.run.shop.mint),
        /* 【U18】这家店是不是「立即进货 / 铸币商队」这类增益开的（剧情要用：铃声那段），
         * 以及这家店的剧情是不是已经播过（同一家店不再重复打断）。 */
        shopByBuff: !!(e.run.shop && e.run.shop.byBuff),
        shopStoryShown: !!(e.run.shop && e.run.shop.storyShown),
        /* 讨价还价（E14）：攒着还没兑现的「对折份数」（下一家店每份一件随机商品对折）。 */
        shopHalfPending: Math.max(0, Math.floor(Number(e.run.shopHalfPending) || 0)),
        pendingPick: e.run.pendingPick || null,
        /* 环境词缀：带上「本局摇出来的实际数值」与渲染好的文案，界面直接显示即可。
         * 段位机制已并入环境，所以 mech 类就是以前「本段所有敌人附带」的那些。 */
        env: (e.run.env || []).map((x) => {
          const def = D().ENDLESS_ENV_BY_ID[x.id] || { id: x.id, name: x.id, desc: '' };
          const values = envValues(e.run, x);
          const t = D().envText(def, values);
          return Object.assign({}, def, {
            left: x.left, values: values, text: t.text,
            rangeText: D().envRangeText(def), mech: !!def.mech,
          });
        }),
        permSlots: Math.max(0, Number(e.run.permSlots) || 0),
        slotFreeIds: (e.run.slotFreeIds || []).slice(),
        permUsed: permUsed(e.run),
        lastMaxHp: Math.max(0, Number(e.run.lastMaxHp) || 0),
        lastHp: Math.max(0, Number(e.run.lastHp) || 0),
        curMaxHp: currentMaxHp(e.run),
        curHp: currentHp(e.run).hp,
        hpAbs: hpAbsOf(e.run),
        fragileBase: Object.assign({ power: 0, agility: 0, speed: 0 }, e.run.fragileBase || {}),
        fragileBurned: Object.assign({ power: 0, agility: 0, speed: 0 }, e.run.fragileBurned || {}),
        enemyMaxHpDown: Math.max(0, Math.min(ENEMY_MAXHP_DOWN_CAP, Number(e.run.enemyMaxHpDown) || 0)),
        enemyPowerDown: Math.max(0, Number(e.run.enemyPowerDown) || 0),
        shopSpend: Math.max(0, Number(e.run.shopSpend) || 0),
        spendGain: Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, e.run.spendGain || {}),
        permCap: permSlots(e.run),
        finished: e.run.finished || null,
        /* 无尽主界面右上角显示用的三个数（口径与 settleRunTickets 完全一致）：
         *   · ticketsIfSettle —— 只算「本层应得」那一份（5 层一个档位）
         *   · retryToken      —— 手上的**铸币**（游戏内文案叫「铸币」，字段名沿用 retryToken
         *                        以免旧档迁移；失败后回滚本场再打一次；结算时 1:1 折券）
         *   · ticketsOnExit   —— 现在退出**实际到手**的总额 = 本层应得 + 铸币折现
         *                        （剩余试炼币不折现，随本局作废） */
        retryToken: Math.max(0, Math.floor(Number(e.run.retryToken) || 0)),
        ticketsIfSettle: D().endlessTickets(e.run.layer),
        ticketsOnExit: D().endlessTickets(e.run.layer)
          + Math.max(0, Math.floor(Number(e.run.retryToken) || 0)),
        /* 【D2b】当前这一层敌人的**成长倍率**（用户口径 2026-10：要看得见才调得动）：
         * 段位倍率 × 深度倍率 + 目标等级，三个数各自给出来（界面拼成一行）。
         * 与 buildFoe 用的是同一批函数，不另立一套口径。 */
        scale: D().endlessScaleParts(e.run.layer),
        /* 注：曾有一个 `modsOn`（「这一层还吃不吃环境 / 丢烙印 / 放弃增益」）字段。
         * 第八十六批起这三条按 100 层一轮走、**恒为成立**，该字段再无判别力，
         * 已删掉（免得下一个人以为「101 层起不合格」）。 */
        /* 商店每页件数 / 战斗选项扣减（界面写「本层商店 3 件」这类文案要用）。 */
        shopSlots: D().endlessShopSlots(e.run.layer),
        choiceCut: D().choiceCut(e.run.layer),
        choicesPerBattle: choiceSlotsOf(e.run),
        noShop: !!D().layerNoShop(e.run.layer) } : null };
  }
  function progressOf(run, id, row) {
    const g = globalMul(run);
    const pct = (v) => Math.round((Number(v) || 0) * 100);
    /* 【2026-10 同名逐条】传了 `row` 就显示**这一栏自己的**成长进度，不再各栏显示同一个合计；
     * 这一栏还没有账本（老档 / 外部直接写了 run 级字段）时退回 run 级合计。 */
    const rowStacks = (fallbackId) => (row ? Math.max(1, Math.floor(Number(row.stacks) || 1)) : Math.max(1, stacksOf(run, fallbackId)));
    const rowVal = (key, fallback) => {
      const v = row ? growOf(row, key) : 0;
      return v > 0 ? v : Math.max(0, Number(fallback) || 0);
    };
    if (id === 'C06') {
      const cap = D().BUFF_BY_ID.C06.mods.killPowerCap * rowStacks('C06') * g;
      return '已累计 攻击 +' + pct(rowVal('killPower', run.killPower)) + '%（上限 +' + pct(cap) + '%）';
    }
    /* C07 吞噬成长：累计值在 run.winMaxHp、上限字段是 mods.winMaxHpCap。
     * 原来这里读的是运行态里的「击杀成长」历史字段，以及一个**根本不存在的上限字段**
     * （旧名是 kill 前缀、现已统一成 win 前缀）—— 两个都取不到值：
     *   · C07 从不写那个 kill 前缀字段（它是给「击杀成长」用的历史字段），累计恒为 0
     *   · 上限字段名不存在 → 上限也恒为 0
     * 于是面板永远显示「生命上限 +0%（上限 +0%）」，看起来就像这条增益完全没生效
     * （效果本身其实是好的，只是显示错了）。 */
    if (id === 'C07') {
      const cap = D().BUFF_BY_ID.C07.mods.winMaxHpCap * rowStacks('C07') * g;
      return '已累计 生命上限 +' + pct(rowVal('winMaxHp', run.winMaxHp)) + '%（上限 +' + pct(cap) + '%）';
    }
    if (id === 'C11') return '已累计 生命上限 +' + Math.round(rowVal('winHpFlat', run.winHpFlat));
    if (id === 'C34' || id === 'C35') {
      const def34 = D().BUFF_BY_ID[id];
      const stacks34 = stacksOf(run, id) || 1;
      const per = (def34.mods.powerPerEmptySlot != null ? def34.mods.powerPerEmptySlot : def34.mods.powerPerPermBuff) * g;
      let n = id === 'C34'
        ? Math.max(0, permSlots(run) - permUsed(run))
        : (function () {
            /* C35 厚积薄发：附魔件按 enchantedWeight（0.2）折算，与 aggregate 同口径。
             * 累加出来的是浮点数 —— **计算与显示都保留一位小数**（用户口径 2026-10），
             * 否则面板会出现「3.4000000000000004 个永久增益」。 */
            const w = def34.mods.powerPerPermBuffEnchantedWeight != null
              ? Math.max(0, Number(def34.mods.powerPerPermBuffEnchantedWeight)) : 1;
            let c = 0;
            for (const row of (run.permanent || [])) c += rowFreeOf(row) ? w : 1;
            return c;
          })();
      n = Math.round(n * 10) / 10;
      /* total 用**已保留一位小数的份数**算，避免 0.2 累加带来的浮点尾巴。 */
      const total = Math.round(per * n * stacks34 * 1000) / 1000;
      const unit = id === 'C34' ? '空槽' : '永久增益';
      /* 份数：轻装上阵（C34）是整数空槽，原样显示；厚积薄发（C35）固定一位小数。
       * 百分比保留一位小数并按需去掉多余的 .0（10.0% → 10%）。 */
      const countText = id === 'C34' ? String(n) : n.toFixed(1);
      const pctText = (v) => { const s = (v * 100).toFixed(1); return s.replace(/\.0$/, ''); };
      return '当前 ' + countText + ' 个' + unit + ' × ' + Math.round(per * 100) + '%' +
        (stacks34 > 1 ? ' × ' + stacks34 + ' 层' : '') + ' = 攻击 +' + pctText(total) + '%' +
        '（永久位 ' + permUsed(run) + '/' + permSlots(run) + '）';
    }
    if (id === 'C12') {
      return '第 10 层起已累计 力 +' + Math.round(rowVal('winStatPower', run.winStatPower)) +
        ' / 敏 +' + Math.round(rowVal('winStatAgility', run.winStatAgility)) +
        ' / 速 +' + Math.round(rowVal('winStatSpeed', run.winStatSpeed));
    }
    if (id === 'C20') {
      /* 三项都是「终乘」：写在最终值上，而不是并进攻击/敏捷/速度面板（否则会被别的乘区稀释）。
       * 注意**不能用 lowHpPowerMul 当攻击那一份** —— C20 用的是 lowHpFinalMul，
       * 早先这里读错字段，面板一直显示「攻击 +0%」。 */
      const m20 = D().BUFF_BY_ID.C20.mods;
      return '生命 ≤' + Math.round((m20.lowHpAt || 0.5) * 100) + '% 时：最终伤害 ×' +
        (1 + (m20.lowHpFinalMul || 0)).toFixed(2) + '、最终敏捷 ×' + (1 + (m20.lowHpAgilityMul || 0)).toFixed(2) +
        '、最终速度 ×' + (1 + (m20.lowHpSpeedMul || 0)).toFixed(2) + '（终乘）';
    }
    if (id === 'N13' || id === 'C46' || id === 'C47') {
      const def = D().BUFF_BY_ID[id], mm = def.mods;
      const bits = ['空生命上限 +' + pct(mm.emptyMaxHpMul)];
      if (mm.lowHpRegenPct) bits.push('低血每回合回 ' + pct(mm.lowHpRegenPct) + '（最多到 ' + pct(mm.lowHpRegenAt) + '）');
      if (mm.lowHpTakenMul) bits.push('低血减伤 ' + pct(-mm.lowHpTakenMul));
      if (mm.lowHpLifestealPct) bits.push('低血吸血 ' + pct(mm.lowHpLifestealPct));
      return '每场开始：' + bits.join('、');
    }
    if (id === 'N14') return '生命 ≤' + pct(D().BUFF_BY_ID.N14.mods.lowHpAt) + '% 时减伤 ' + pct(-D().BUFF_BY_ID.N14.mods.lowHpTakenMul);
    if (id === 'C48') {
      const cap = (D().BUFF_BY_ID.C48.mods.winTakenMulCap || 0.25) * rowStacks('C48');
      const v = row ? growOf(row, 'winTakenMul') : winTakenMulOf(run);
      return '已累计 受到伤害 −' + pct(v) + '（上限 −' + pct(cap) + '）';
    }
    if (id === 'N15') return '接下来免疫一切反伤（荆棘 / 镜鳞 / 绝对防御）';
    if (id === 'C25') return '这一本已累计 卖价 +' + Math.round(rowVal('sellBonus', run.sellBonus)) + ' 试炼币（只加自己）';
    const def = D().BUFF_BY_ID[id];
    if (def && def.mods && def.mods.fragileStat) {
      const key = def.mods.fragileStat;
      const names = { power: '力量', agility: '敏捷', speed: '速度' };
      const fb = fragileBonus(run, key);
      const now = Math.round(fb.value * 100);
      if (fb.burned) return (names[key] || key) + ' +' + now + '%（已损毁：全额并本局永久保留）';
      /* 「损毁后」的预览必须和 fragileBonus 同一口径：破碎把这一份从「存在值」
       * （fragilePct）换成「损毁值」（fragileBurnedPct），base 这份被收回。 */
      const alive = Math.max(0, Number(def.mods.fragilePct) || 0);
      const burnedNext = Math.max(0, Number(def.mods.fragileBurnedPct != null
        ? def.mods.fragileBurnedPct : alive) || 0);
      const after = Math.round((fb.base - alive + fb.burned + burnedNext) * 100);
      return (names[key] || key) + ' +' + now + '%（烙印存在；损毁后升为 ' +
        after + '% 并本局永久保留）';
    }
    if (id === 'C36') {
      const sg = Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, run.spendGain || {});
      /* 各栏各自记进度：总次数求和，「距下次」取**最快满的那一栏**（玩家最关心的数）。 */
      const rows36 = (run.permanent || []).filter((b) => b && b.id === 'C36');
      const procs = rows36.length
        ? rows36.reduce((n, b) => n + Math.max(0, Math.floor(Number(b.procs) || 0)), 0)
        : Math.max(0, Math.floor(Number(run.shopSpendProcs) || 0));
      const copies = Math.max(1, rows36.length || stacksOf(run, 'C36'));
      let best = null;
      for (const row of rows36) {
        const p = Math.max(0, Math.floor(Number(row.procs) || 0));
        const st = shopSpendStepFor(D().BUFF_BY_ID.C36, p);
        const have = Math.max(0, Number(row.spend) || 0);
        const left = Math.max(0, st - have);
        if (!best || left < best.left) best = { left: left, step: st, have: have };
      }
      const step = best ? best.step : shopSpendStepFor(D().BUFF_BY_ID.C36, procs);
      const have = best ? best.have : Math.floor(Number(run.shopSpend) || 0);
      return '已累计 力 +' + sg.power + ' / 敏 +' + sg.agility + ' / 速 +' + sg.speed + ' / 生命 +' + sg.hp +
        '（已提升 ' + procs + ' 次' + (copies > 1 ? ' · ×' + copies + ' 份' : '') +
        ' · 距下次 ' + have + '/' + step + ' 试炼币）';
    }
    return null;
  }
  /** 当前 run 已拥有 buff 列表（构筑展示 / 商店出售页用）。 */
  /** 某个增益在挑战塔里是否属于「下一场战斗」语义（卡面不显示限次）。 */
  function isTowerBattleBuff(id) {
    const def = D().BUFF_BY_ID[id];
    return !!(def && D().hasTag(def, 'nextBattle'));
  }
  function ownedBuffs(mode) {
    /* 直接遍历本局的两张表（permanent / limited），不要用 eachBuff ——
     * eachBuff 只聚合「生效中」的限次增益，导致关掉开关的限次 buff 直接消失。
     * 关掉只是 on=false（界面变灰），仍然要列出来、还能再点回来。 */
    const run = mode === 'tower' ? tower().run : endless().run;
    if (!run) return [];
    const scopeName = { limited: '限次', permanent: '永久', instant: '即时' };
    const out = [];
    const add = (entry) => {
      const buff = entry && D().BUFF_BY_ID[entry.id];
      /* 查不到定义的条目进不来：normalizeRun 的 cleanBuffs 已经先过滤过一遍
       * （只有 BUFF_BY_ID 里存在的 id 才会留在 permanent / limited 里）。 */
      if (!buff || D().hasTag(buff, 'hidden')) return;   // 隐藏型（背包/选取类）不进增益面板
      out.push({ id: buff.id, name: buff.name, desc: D().descOf(buff, mode), rarity: buff.rarity, kind: buff.kind,        scopeName: scopeName[buff.kind], stacks: entry.stacks || 1,
        progress: progressOf(run, buff.id, entry),
        uses: buff.kind === 'limited' ? entry.uses : undefined,
        nextBattle: D().hasTag(buff, 'nextBattle'),   // 挑战塔里 = 「下一场战斗」，卡面不显示限次
        on: buff.kind === 'limited' ? entry.on !== false : true,
        /* 获得顺序（越早拿到的越小）与「是否被虚空铭文附魔过（不占位）」——
         * 商店的出售 / 交换列表按这两个字段排（见 sortForSell）。 */
        at: Math.max(0, Math.floor(Number(entry.at) || 0)),
        /* 【任务2】逐条判断：同名件里只有被附魔的那一条显示「不占位」。 */
        slotFree: rowFreeOf(entry), uid: entry.uid,
        /* 【2026-10 第七十三批】附魔详情也带给界面：水晶铭文（enchMul > 1 → 红色外框）与
         * 虚空铭文（slotFree → 青色外框）要能分别画、也能同时画（一半红一半蓝）。 */
        enchMul: rowEnchMulOf(entry), enchants: rowEnchantsOf(entry).slice(),
        sellable: !!run.shop && buff.kind !== 'instant' && !D().hasTag(buff, 'hidden'),
        sellPrice: sellPriceOf(run, buff, entry.stacks || 1, entry) });
    };
    (run.permanent || []).forEach(add);
    (run.limited || []).forEach(add);
    return out;
  }

  /**
   * 商店里「动自己的增益」那几个列表的排序（用户口径）：
   *   ① **按获得的先后倒序**：**最新拿到的排在最上** —— 打开商店就能直接卖掉刚买/刚拿到的那条，
   *      不用把列表拖到底（跨永久 / 限次混排，不再按「永久一坨、限次一坨」分组）；
   *   ② **被虚空铭文附魔过（不占位）的一律排到最后**：它们不占槽、通常也不急着卖。
   * 入参是 ownedBuffs() 的数组（带 `at` / `slotFree`），返回排好序的副本（不改原数组）。
   * `at` 相同（老档没补上号）时保持原顺序 —— 排序稳定。
   */
  function sortForSell(list) {
    return (list || []).map((b, i) => ({ b: b, i: i })).sort((x, y) => {
      const fx = x.b && x.b.slotFree ? 1 : 0;
      const fy = y.b && y.b.slotFree ? 1 : 0;
      if (fx !== fy) return fx - fy;
      const ax = Math.max(0, Math.floor(Number(x.b && x.b.at) || 0));
      const ay = Math.max(0, Math.floor(Number(y.b && y.b.at) || 0));
      if (ax !== ay) return ay - ax;             // 号大的（后拿到的）排前面
      return x.i - y.i;
    }).map((x) => x.b);
  }
  /** 商店「出售增益 / 免费交换」那一列要用的列表：本局手上的永久 + 限次，按上面的口径排好
   *  （最新拿到的在最上，虚空铭文附魔的沉到最后）。 */
  function sellListOf(mode) {
    return sortForSell(ownedBuffs(mode === 'tower' ? 'tower' : 'endless').filter((b) => b.kind !== 'instant'));
  }

  /* ============================================================
   * 【T20b】调试台专属：把无尽对局直接挪到第 n 层
   *   （`_debugSetEndlessLayer` / `_debugShiftEndlessLayer` 共用这一份）
   * ============================================================ */
  /** 把无尽对局挪到第 n 层（没有对局就先开一局）。plan 用与 advanceLayer 同一组参数重建，
   *  保证界面上预告的第 4 场 boss 和实战是同一只。 */
  function debugSetEndlessLayer(n) {
    const layer = Math.max(1, Math.floor(Number(n) || 1));
    const e = endless();
    if (!e.run) { const r = startEndlessRun(); if (!r.ok) return r; }
    e.run.layer = layer;
    /* 必须和 advanceLayer 用同一组参数（salt + squirrelsOnly=true）重建，
     * 否则第 4 场的 boss 会和界面预告的不是同一只。 */
    e.run.plan = buildPlan(layer, e.run.salt, true);
    e.run.idx = 0;
    e.run.choices = null;
    e.run.phase = null;
    e.run.finished = null;
    /* 挪层 = 换层：三侠削弱是「贯穿本层」的，跟着一起清（与 advanceLayer 同一口径）。 */
    e.run.debuffs = [];
    save();
    return { ok: true, layer };
  }

  /* ============================================================
   * 【T21】模块导出 —— window.Tower（界面与测试的入口面）
   * ============================================================ */
  window.Tower = {
    unlocked, towerInfo, endlessInfo, preview, planInfo, ownedBuffs, bossPool, debugGrantBuff, debugLoseBuff, pickCandidates, applyPickBuff,
    /* 【U18】剧情状态：挂待播 / 清待播 / 查「只播一次」是否播过 / 记已播 / 剧情模式开关。 */
    setRunStory, clearRunStory, storySeen, markStorySeen, storyEnabled, setStoryEnabled, markShopStoryShown,
    /* 【100 层循环】「这一层吃不吃某条按层机制」的唯一判据出口（界面 / 调试 / 回归共用，别再各写一份）：
     * 全部按**轮内层号**判，于是「层号 → 机制开关」的映射每轮严格一致。 */
    canHaveEnvOf: (layer) => D().canHaveEnv(layer),
    canBrandLossOf: (layer) => D().canBrandLoss(layer),
    layerModsOnOf: (layer) => D().layerModsOn(layer),
    /* 烙印 / 铭文相关的只读查询（界面与回归都要用；poolFilter 已由 poolFilterOf 暴露过一份）。 */
    isBrandBuff, unbrokenBrandCount, breakAllBrands,
    /* 这一次附魔三选一是**哪张铭文**触发的（界面据此只标注「被这张附魔过」的增益）。 */
    activeInscriptionId,
    /* 巡逻（魔王战）：收缴流程 + 只读查询（界面与回归共用）。 */
    patrolTollCandidates, payPatrolToll, finishPatrolToll, patrolTollRows,
    /* 回归/调试用：直接造一只敌人、判断精英位（巡逻要用它验魔王本体）。 */
    buildFoeOf: (mode, layer, entry, salt, isLast) => buildFoe(mode, layer, entry, salt, isLast),
    isEliteEntryOf: (entry, layer, isLast) => isEliteEntry(entry, layer, isLast),
    /* 巡逻收缴的判据与落点（回归用：「纯运营类不生效 / 挥金如土生效」）。 */
    isPureOpsBuffOf: (def) => isPureOpsBuff(def),
    /* 选取型铭文的软锁防线（界面在候选为 0 时叫它）+ 回归用。 */
    deferPendingPick: () => parkStalePendingPick(),
    hasPickTargetsOf: (run, kind) => hasPickTargets(run || endless().run, kind),
    resolveDeferredPicksOf: (run) => resolveDeferredPicks(run),
    applyPatrolTollToFoeOf: (run, foe) => applyPatrolTollToFoe(run, foe),
    addShopSpendOf: (run, amount) => addShopSpend(run, amount),
    /* 商店出售 / 交换列表的排序（正序获得 + 附魔不占位的排最后）与排好序的列表。 */
    sortForSell, sellListOf,
    startTowerRun, startEndlessRun, nextBattle, reportBattle, interruptBattle, abandon,
    /* 结算预览（只算不改）：放弃本局 / 结算离场的弹窗用它把这一局的账摊开给玩家看。
     * ⚠ 界面是**不带参数**调的，所以这里必须补上「默认取当前无尽塔对局」——
     * 直接导出裸函数的话，无参调用会拿到一个空 run（layer 1 / 0 张），弹窗就全错了。 */
    previewSettleTickets: (run) => previewSettleTickets(run || endless().run),
    pickChoice, toggleLimited, addBuff, applyInstant, openRestShop,
    shopState, buyShopSlot, buyRetryToken, buyShopHeal, rerollShop, sellBuff, closeShop, giveUp, claimShopEnterCoins,
    /* 铸币商店（战后 5% 随机小店）：买一件 / 免费交换一件 / 免费刷新一次 / 直接走人。 */
    buyMintSlot, swapMintBuff, rerollMintShop, leaveMintShop,
    mintRollOf: (run, layer) => rollMintShop(run || endless().run, layer == null ? (run || endless().run || {}).layer : layer),
    mintSlotsOf: (run) => rollMintSlots(run || endless().run),
    mintSwapAllowedOf: (run) => swapAllowedOf(run || endless().run),
    mintSwapTargetOf: (run, id) => {
      const r = run || endless().run;
      const b = D().BUFF_BY_ID[id];
      return (r && b) ? rollSwapTarget(r, b) : null;
    },
    canRetry, retryBattle, declineRetry, isTowerBattleBuff, takeAchievementToasts,
    /* 只读：摇一页商店货架（不改状态）。测试用它统计各增益的上架概率
     *（例如不死鸟 shopWeight 的效果），界面也可以拿来做「货架预览」。 */
    rollShopSlotsOf: (run, paid) => rollShopSlots(run || endless().run, paid),
    /* 只读/回归：跑一次「战后环境推进」（不改其它状态），用来核「每 100 层一轮」那条规则 ——
     * **按层号**跑，不依赖当前对局（101 层 = 新一轮第 1 层不该抽、105 层起照旧抽）。
     * ⚠ 早期版本写成 `rollEnvAfterBattle(run || endless().run)`：那些调用点传的是普通对象，
     * 而 endless().run 仍是第 1 层，于是「按层验」永远验不准（实测踩过）。
     * 传 run 时仍以它为准（兼容旧调用）。 */
    rollEnvOf: (arg) => {
      const run = (arg && typeof arg === 'object') ? arg : { layer: Number(arg) || 1 };
      if (!Array.isArray(run.env)) run.env = [];
      rollEnvAfterBattle(run);
      return run.env;
    },
    /* 只读：某条增益现在还能不能进池（unique / repeatable / maxStacks 口径）。 */
    poolFilterOf: (run, buff) => poolFilter(run || endless().run, buff),
    /* 只读：本条增益当前还能不能获得（叠层上限口径）。 */
    ownableOf: (run, buff) => ownable(run || endless().run, buff),
    /* 只读（测试/文档）：这件永久增益「叠满后能不能另开一个背包栏位继续叠」。
     * false = 拿满即出池（oncePerRun / noRestack / 不占槽的选取型）。 */
    permanentRestackableOf: (buff) => permanentRestackable(buff),
    /* 只读（测试/探针）：永久增益**逐条**统计的占位数量（被附魔的那些不占位）。 */
    permUsedOf: (run) => permUsed(run || endless().run),
    permSlotsOf: (run) => permSlots(run || endless().run),
    stacksOf: (run, id) => stacksOf(run || endless().run, id),
    /* 只读：一条增益当前的抽中权重（shopWeight × 重复获得惩罚，含碎掉的烙印份数）。
     * 测试用；界面也可以拿它显示「重复获得概率」。 */
    buffWeightOf: (run, idOrBuff) => {
      const r = run || endless().run;
      const b = (idOrBuff && typeof idOrBuff === 'object') ? idOrBuff : D().BUFF_BY_ID[idOrBuff];
      return buffWeightOf(r, b);
    },
    /* 只读：一条增益的**动态惩罚**（随本局状态变化，恒 ≤1）—— 豪掷千金/测试用。 */
    buffDynamicPenaltyOf: (run, idOrBuff) => {
      const r = run || endless().run;
      const b = (idOrBuff && typeof idOrBuff === 'object') ? idOrBuff : D().BUFF_BY_ID[idOrBuff];
      return buffDynamicPenaltyOf(r, b);
    },
    /* 只读：「豪掷千金」抽限次增益时的权重。测试用。
     *   limitedRerollPaidOf  ：基准刷新档（默认 10 试炼币）；
     *   limitedGrantWeightsOf：整池 [{buff, weight}]（商店该档下的动态权重，直接抽签）；
     *   limitedGrantWeightOf ：单件权重（内部按整池现算）。 */
    limitedRerollPaidOf: () => limitedRerollPaid(),
    limitedGrantWeightsOf: (run) => limitedGrantWeights(run || endless().run)
      .map((x) => ({ id: x.buff.id, weight: x.weight })),
    limitedGrantWeightOf: (run, id) => limitedGrantWeightOf(run || endless().run, D().BUFF_BY_ID[id]),
    /* 只读（测试/调试）：按当前对局状态算「动态档位权重」。
     * 传 pool（可选，默认无尽池）与 baseTier（可选，默认未归一化档位权重）。 */
    dynamicTierWeightsOf: (run, pool, baseTier) => {
      const r = run || (endless().run || tower().run || {});
      return dynamicTierWeights(baseTier || D().rawTierWeights(1, r), r, pool || D().endlessPool);
    },
    /* 只读：讨价还价（E14）还攒着几份「对折」（下一次进店时兑现成 N 件随机商品对折）。 */
    shopHalfPendingOf: (run) => Math.max(0, Math.floor(Number((run || endless().run || {}).shopHalfPending) || 0)),
    /* 只读：手上有没有「开着的」时间回廊（E15）—— 下一场打完会重开本层。 */
    layerRestartPendingOf: (run) => hasActiveLayerRestart(run || endless().run),
    /* 调试/测试：保底计数推进（纯状态操作，不走随机）。
     * buff 传 null 表示「这一格抽到的是非传奇」；hasLegendCandidate 为 false 时不累加。 */
    _debugNotePityRoll: (run, buff, hasLegendCandidate) => {
      const r = run || endless().run;
      notePityRoll(r, buff, hasLegendCandidate !== false);
      return legendPityOf(r);
    },
    /* 调试/测试：直接摇一页试炼商店货架 / 一组战斗奖励选项（走真实抽取路径，含传奇保底）。 */
    _debugRollShopSlots: (run, paid) => rollShopSlots(run || endless().run, paid || 0),
    _debugRollChoices: (mode, run) => rollChoices(mode || 'endless', run || endless().run),
    /* 调试/测试：走真实的「豪掷千金随机限次增益」抽取路径，返回抽到的 id（池空则 null）。 */
    _debugGrantRandomLimited: (run) => grantRandomLimited(run || endless().run),
    /* 调试/测试：对某一条栏位单独摇一次破碎判定（pct=0 时只推进/记录它自己的随机数种子）。
     * 用来验证「逐条（uid）各自持有破碎随机数」。 */
    _debugFragileRollOf: (run, ref, pct) => {
      const r = run || endless().run;
      const hit = findRowRef(r, ref);
      if (!hit) return null;
      const broke = fragileRoll(r, hit.row, Math.max(0, Number(pct) || 0));
      return { id: hit.row.id, uid: hit.row.uid, seed: hit.row.fragileSeed, broke: broke };
    },
    /* 只读：某一条栏位自己的成长账本（同名逐条口径）。 */
    rowGrowOf: (run, ref) => {
      const hit = findRowRef(run || endless().run, ref);
      return hit ? cleanGrowObj(hit.row.grow) : null;
    },
    /* 只读：某一条栏位自己的引用（uid 优先）。 */
    rowRefOf: (run, ref) => {
      const hit = findRowRef(run || endless().run, ref);
      return hit ? { id: hit.row.id, uid: hit.row.uid, key: Number(hit.row.uid) > 0 ? String(hit.row.uid) : String(hit.row.id) } : null;
    },
    /* 只读（测试/UI）：终焉烙印（C49）的最终乘区 —— 按层加算（1 + 0.25×存在 + 0.5×损毁）。 */
    fragileFinalMulOf: (run) => fragileFinalMul(run || endless().run),
    /* 只读（测试/UI）：传奇保底的当前计数与阈值（B 方案）。 */
    legendPityOf: (run) => legendPityOf(run || endless().run),
    legendPityNeed,
    /* 只读（测试/UI）：这一场战斗能不能显示「跳过」键（无尽塔 30 层起）。 */
    skipPlaybackAllowed: (mode, layer) => skipPlaybackAllowed(
      mode, layer == null ? ((mode === 'endless' ? endless().run : tower().run) || {}).layer : layer),
    /* 只读：某条增益本局「累计获得过几份」（含已碎掉的烙印）。 */
    obtainedCountOf: (run, id) => obtainedCountOf(run || endless().run, id),
    /* 只读：当前战斗奖励的选项目数（基础 3 + 抉择扩充层数，上限 6）。 */
    choiceSlotsOf: (run) => choiceSlotsOf(run || endless().run),
    /* 只读：选取型 buff 的候选（测试用；skill 会过滤掉被动/防御类）。 */
    pickCandidatesOf: (kind) => pickCandidates(kind),
    /* 只读：20 起每 10 层是否要放弃永久增益 / 可放弃的候选 / 已流失的碎烙印。 */
    /* 调试/测试：关闭环境抽取（noEnvRoll 连当前环境一起清）。 */
    _debugSetNoEnv: (on) => {
      const e = endless();
      if (!e.run) return { ok: false };
      e.run.noEnvRoll = on !== false;
      if (e.run.noEnvRoll) e.run.env = [];
      return { ok: true, noEnvRoll: e.run.noEnvRoll };
    },
    /* 调试/测试：把 E01（战后开店）/ E15（重开本层）从场间选择里排除（模块级开关，不进存档）。
     * 流程类用例用它来保证「场次计数与商店节奏」不被这两张牌打散。 */
    _debugSetNoFlowBuffs: (on) => { noFlowBuffs = on !== false; return { ok: true, noFlowBuffs: noFlowBuffs }; },
    _debugNoFlowBuffs: () => noFlowBuffs,
    /* 调试/测试：关掉铸币商店的**自动**刷出（手开的 _debugSpawnMintShop 与读概率的
     * mintRollOf 都不受影响）。流程类用例打开它，免得层中突然弹店打断场次计数。 */
    _debugSetNoMintShop: (on) => { noMintShop = on !== false; return { ok: true, noMintShop: noMintShop }; },
    _debugNoMintShop: () => noMintShop,
    needPermSacrifice: (layer) => needPermSacrifice(layer),
    sacrificeCandidatesOf: (run) => sacrificeCandidates(run || endless().run),
    /* 20 起每 10 层的「放弃一个永久增益」。 */
    sacrificePerm: (id) => sacrificePerm(id),
    /* 一次性取走本局待提示（含「碎掉的烙印失效」）。 */
    takeRunToasts: () => {
      const run = endless().run;
      if (!run || !Array.isArray(run.pendingToasts) || !run.pendingToasts.length) return [];
      const out = run.pendingToasts.slice();
      run.pendingToasts = [];
      return out;
    },
    brokenMarksOf: (run) => (run || endless().run || {}).brokenMarks || [],
    /* 只读：本局「天命所归」累计提供的稀有度系数。 */
    rarityBoostOf: (run) => D().rarityBoostOf(run || endless().run),
    /* 只读：某个即时类增益本局已获得的次数（重复获得概率递减用）。 */
    instantOwnedCountOf: (run, id) => instantOwnedCount(run || endless().run, id),
    /* 只读：本局全局倍率（增幅水晶 C15 的 globalMul^层数）。
     * 成长类增益的增量与上限都要乘它，暴露出来便于界面/测试用同一口径核算。 */
    globalMulOf: (run) => globalMul(run || endless().run),
    checkpointInfo, settleEndless, continueEndless, continueFromShop, settleFromShop,
    /* 调试台：一次拿到「收集到的全部增益 + 获取/消失流水 + 当前实际提升」。
     * collected 含一次生效类与已损毁/用尽/失去的（从流水里回捞）。 */
    debugBuffReport(mode) {
      const m = mode === 'endless' ? 'endless' : 'tower';
      const run = (m === 'endless' ? endless() : tower()).run;
      if (!run) return { ok: false, msg: '当前没有' + (m === 'endless' ? '无尽塔' : '挑战塔') + '对局。' };
      const seen = new Set();
      const collected = [];
      const add = (id, tag, detail) => {
        if (!id) return;
        const def = D().BUFF_BY_ID[id];
        if (!def) return;
        const key = id + '|' + tag;
        if (seen.has(key)) return;
        seen.add(key);
        collected.push({ id, name: def.name, rarity: def.rarity, kind: def.kind, tag, detail: detail || '' });
      };
      for (const b of run.permanent || []) add(b.id, b.stacks > 1 ? '永久 ×' + b.stacks : '永久');
      for (const b of run.limited || []) {
        const def = D().BUFF_BY_ID[b.id] || {};
        const fragile = def.mods && def.mods.fragileBreakPct;
        add(b.id, b.on === false ? '限次（已关闭）' : (fragile ? '限次 · 易碎' : '限次 剩' + b.uses + ' 场'),
          b.stacks > 1 ? '叠 ×' + b.stacks : '');
      }
      for (const id of run.permSlotIds || []) add(id, '槽位扩容（已生效）');
      for (const id of run.pickBuffIds || []) add(id, '选取型（已生效）');
      /* 流水里的事件各自成一条（用「已获得 / 已用尽 / 已损毁 / 已失去」区分，
       * 这样同一个增益的「获得」和「损毁」两条都能看到，而不是合成一条）。 */
      for (const e of run.buffLog || []) {
        add(e.id, { get: '已获得', stack: '已叠加', instant: '已立即生效', expire: '已用尽消失', break: '已损毁', lose: '已失去' }[e.event] || e.event, e.detail || '');
      }
      return {
        ok: true, mode: m, layer: run.layer,
        collected,
        history: (run.buffLog || []).slice(),
        effects: buffEffectLines(run, {}),
        fragile: { base: run.fragileBase || null, burned: run.fragileBurned || null },
        slots: { used: permUsed(run), cap: permSlots(run) },
      };
    },
    // 调试
    _debugSetLayer(n) { tower().maxLayer = Math.max(0, Math.floor(Number(n) || 0)); save(); },
    /* 调试/探针用：endlessInfo/towerInfo 返回的是**子集**，看不到 killPower、sellBonus、
     * limited 的 uses 这些运行态字段。诊断叠层/限次问题时需要拿到原始 run。 */
    _debugRun(mode) { return (mode === 'endless' ? endless() : tower()).run; },
    _debugSetStatPeak(field, value) {
      const run = endless().run;
      if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
      run.statPeaks = Object.assign({}, run.statPeaks || {});
      run.statPeaks[field] = Math.max(0, Number(value) || 0);
      save();
      return { ok: true, peaks: run.statPeaks };
    },
    /* 调试/探针用：把无尽对局直接挪到第 n 层（plan 一并重建，界面能正确显示
     * 「当前遭遇的机制」，例如第 6 层的荆棘反伤）。 */
    /* 只读推进一层（测试用）：走真实 advanceLayer，因此会触发「30 层后每 2 层碎烙印失效」。 */
    _debugAdvanceLayer: () => {
      const e = endless();
      if (!e.run) return { ok: false };
      advanceLayer(e.run, 'endless');
      save();
      return { ok: true, layer: e.run.layer, toasts: (e.run.pendingToasts || []).slice() };
    },
    /* 调试台专属：**立刻开一家铸币商店**（跳过概率与层区间判定）。
     * 走的是正式开店路径（掷货架 / 兑现讨价还价对折 / 发 C59 进门币 / 剥掉一家旧店），
     * 唯一区别是 `debug:true` → **不记「本组已刷过」**，这一组自然刷出的机会照旧留着。 */
    _debugSpawnMintShop: () => {
      const e = endless();
      if (!e.run) return { ok: false, msg: '当前没有无尽塔对局（先开始一局）。' };
      const layer = Math.max(1, Math.floor(Number(e.run.layer) || 1));
      openMintShop(e.run, layer, { debug: true });
      save();
      return { ok: true, layer, slots: (e.run.shop && e.run.shop.slots.length) || 0 };
    },
    /* 调试台专属：**立刻开一家普通（试炼）商店**（跳过每 5 层 / 概率判定）。
     * 走正式开店路径（掷货架 / E04 折扣 / E14 对折 / C59 进门币），标记成「战后临时小店」——
     * 「离开」收摊后回去继续打，不会顺带把整局推进到结算点。 */
    _debugSpawnShop: () => {
      const e = endless();
      if (!e.run) return { ok: false, msg: '当前没有无尽塔对局（先开始一局）。' };
      const layer = Math.max(1, Math.floor(Number(e.run.layer) || 1));
      e.run.shop = makeShop(e.run, 0);
      /* 【100 层循环】整百层不开店：makeShop 返回 null，这里要判空（否则直接抛异常）。 */
      if (!e.run.shop) return { ok: false, msg: '第 ' + layer + ' 层是整百层（觐见魔王），这一层不开商店。', layer, slots: 0 };
      e.run.shop.postBattle = true;
      e.run.phase = 'shop';
      save();
      return { ok: true, layer, slots: (e.run.shop && e.run.shop.slots.length) || 0 };
    },
    _debugSetEndlessLayer(n) { return debugSetEndlessLayer(n); },
    /* 调试台专属：无尽塔层数 ±1（快速爬塔）。没有对局时先开一局（落在第 1 层）；
     * 最低夹在第 1 层，挪层口径与 _debugSetEndlessLayer 完全一致。 */
    _debugShiftEndlessLayer(delta) {
      const e = endless();
      const d = Math.round(Number(delta) || 0);
      if (!e.run) return debugSetEndlessLayer(1);
      return debugSetEndlessLayer(Math.max(1, (Math.floor(Number(e.run.layer) || 1)) + d));
    },
    /* 调试台专属：**直接发试炼币**（无尽塔的局内货币之一）。
     *  与 E02/E03「试炼补贴 / 财源滚滚」的即时试炼币同一条口径（纯加法，不进任何乘区），
     *  只是数量由调试台指定；没有对局时**不开新局**，直接报错（避免误点凭空开一局）。
     *  数量夹在 1 ~ 1000000，空输入按 1 处理（与调试台「快速获取物品 / 武技」一致）。 */
    _debugGrantCoins: (n) => {
      const e = endless();
      if (!e.run) return { ok: false, msg: '当前没有无尽塔对局（先开始一局）。' };
      const amount = Math.max(1, Math.min(1000000, Math.round(Number(n) || 0)));
      e.run.coins = Math.max(0, Number(e.run.coins) || 0) + amount;
      save();
      return { ok: true, amount, total: e.run.coins, layer: e.run.layer };
    },
    /* 调试台专属：**直接发铸币**（内部字段就是 `run.retryToken`；试炼商店 50 币换 1 枚那种）。
     *  与 E09/E10 的即时铸币同一口径；数量夹在 1 ~ 100000。 */
    _debugGrantMint: (n) => {
      const e = endless();
      if (!e.run) return { ok: false, msg: '当前没有无尽塔对局（先开始一局）。' };
      const amount = Math.max(1, Math.min(100000, Math.round(Number(n) || 0)));
      e.run.retryToken = Math.max(0, Number(e.run.retryToken) || 0) + amount;
      save();
      return { ok: true, amount, total: e.run.retryToken, layer: e.run.layer };
    },
  };
})();
