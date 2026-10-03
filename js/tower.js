/* ============================================================
 * tower.js — 无尽挑战塔 · 主塔 + 无尽模式状态机
 * 依据 docs/无尽挑战塔系统设计文档.md v2.0。
 *
 * 存档字段（normalizeSave 浅校验，这里深校验）：
 *   S.tower   = { maxLayer, run|null }
 *   S.endless = { best, weekBest, weekKey, bestLayer, shieldDate, run|null }
 *
 * run 通用形状：
 *   { layer, plan:[entry], idx, carry, battleBuffs:[{id,stacks}],
 *     choices:null|[...], attempt:null|token, pot(tower) }
 *   无尽追加：{ buffs(run 跨层), layerBuffs, coins, score, bestLayer,
 *     killPower, winMaxHp, bonusPower, shop|null, phase:null|'shop'|'checkpoint' }
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

  function debug(flag) { return typeof debugOn === 'function' && debugOn(flag); }

  // ---------- 存档 ----------
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
    // 本周最高分：周一重置（与每日统计同一节奏）
    const mon = mondayKey();
    if (e.weekKey !== mon) { e.weekKey = mon; e.weekBest = 0; }
    if (e.run) e.run = normalizeRun(e.run, 'endless');
    return e;
  }
  function mondayKey() {
    const d = new Date();
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** 深校验一份读档出来的 run：坏档直接作废（不收费、不掉层）。 */
  function normalizeRun(run, mode) {
    if (!run || typeof run !== 'object') return null;
    const layer = Math.floor(Number(run.layer));
    if (!Number.isFinite(layer) || layer < 1 || !Array.isArray(run.plan) || !run.plan.length) return null;
    const buffOk = (b) => b && typeof b === 'object' && D().BUFF_BY_ID[b.id];
    const cleanBuffs = (list) => (Array.isArray(list) ? list.filter(buffOk)
      .map((b) => ({ id: b.id, stacks: Math.max(1, Math.min(D().STACK_MAX, Math.floor(Number(b.stacks) || 1))) })) : []);
    run.layer = layer;
    run.idx = Math.max(0, Math.min(run.plan.length - 1, Math.floor(Number(run.idx) || 0)));
    run.carry = Math.max(0.01, clamp01(run.carry == null ? 1 : run.carry));
    /* 第 1 项新模型：permanent（永久，上限 5 格）/ limited（限次，带剩余次数与开关）。
     * 旧档只有 battleBuffs / layerBuffs / buffs：按旧 scope 迁移到新结构，坏值照旧丢弃。 */
    if (!Array.isArray(run.permanent) || !Array.isArray(run.limited)) {
      const oldBattle = cleanBuffs(run.battleBuffs), oldLayer = cleanBuffs(run.layerBuffs), oldRun = cleanBuffs(run.buffs);
      run.permanent = oldRun.filter((b) => D().BUFF_BY_ID[b.id] && D().BUFF_BY_ID[b.id].kind === 'permanent')
        .concat(oldLayer.filter((b) => D().BUFF_BY_ID[b.id] && D().BUFF_BY_ID[b.id].kind === 'permanent'));
      run.limited = oldBattle.concat(oldLayer).filter((b) => D().BUFF_BY_ID[b.id] && D().BUFF_BY_ID[b.id].kind === 'limited')
        .map((b) => ({ id: b.id, stacks: b.stacks, uses: Number(b.uses) || D().BUFF_BY_ID[b.id].uses || 1, on: b.on !== false }));
    }
    /* 段位机制已并入环境词缀：run.mechs 只作历史兼容，永远为空。 */
    run.mechs = [];
    /* 槽位相关字段的**防御性规范化**（当前存档已经会带上它们，这里是第二道闸）：
     * permSlotIds 是权威记录、permSlots 由它派生、两者取最大值兼容旧档 ——
     * 只要有一份字段缺失（旧档 / 同步来的残缺档），下面那行
     * `slice(0, permSlots(run))` 就会把超出的永久增益**静默截掉**，
     * 所以宁可多算一点名额，也不能把玩家已有的增益丢掉。 */
    /* 只做「是字符串且非空」的轻校验：**不要**在这里按 BUFF_BY_ID 过滤 ——
     * 过严的过滤会误删合法登记（实测把玩家的增益整批丢掉）。 */
    const cleanIds = (v) => (Array.isArray(v) ? v.filter((id) => typeof id === 'string' && id) : []);
    run.permSlotIds = cleanIds(run.permSlotIds);
    const slotFromIds = run.permSlotIds.reduce((sum, id) => {
      const def = D().BUFF_BY_ID[id];
      return sum + Math.max(0, Number(def && def.mods && def.mods.permSlot) || 0);
    }, 0);
    run.permSlots = Math.max(slotFromIds, Math.max(0, Number(run.permSlots) || 0));
    run.slotFreeIds = cleanIds(run.slotFreeIds);
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
    run.limited = (Array.isArray(run.limited) ? run.limited : []).filter((b) => b && D().BUFF_BY_ID[b.id] && D().BUFF_BY_ID[b.id].kind === 'limited')
      .map((b) => ({ id: b.id, stacks: Math.max(1, Math.min(D().STACK_MAX, Math.floor(Number(b.stacks) || 1))),
        uses: Math.max(0, Math.floor(Number(b.uses) || 0)), on: b.on !== false }))
      .filter((b) => b.uses > 0);
    /* 需求：挑战塔的限次增益一律是「**下一场战斗**」这一个单位 ——
     * 打完一场就消耗掉（consumeLimited 每场扣 1），不需要「接下来 N 场」的叠加计时。
     * 旧档里可能存着 99 次的塔内限次增益，这里统一压到 1。 */
    if (run.mode === 'tower') run.limited = run.limited.map((b) => Object.assign(b, { uses: 1, on: true }));
    if (!Array.isArray(run.buffs)) run.buffs = [];
    // 注意：attempt/choices 的作废只在读档时做（state.js normalizeSave），
    // 这里是每次访问都会跑的深校验，不能动进行中的战斗令牌。
    if (mode === 'tower') run.pot = Math.max(0, Math.floor(Number(run.pot) || 0));
    else {
      run.coins = Math.max(0, Math.floor(Number(run.coins) || 0));
      run.score = Math.max(0, Math.floor(Number(run.score) || 0));
      run.bestLayer = Math.max(0, Math.floor(Number(run.bestLayer) || 0));
      run.killPower = Math.max(0, Number(run.killPower) || 0);
      run.winMaxHp = Math.max(0, Number(run.winMaxHp) || 0);
      /* 需求 3：烙印两段加成 + 独立随机种子；旧档 stickyStat → fragileBurned。 */
      run.fragileBase = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBase || {});
      run.fragileBurned = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBurned || {});
      for (const k of ['power', 'agility', 'speed']) {
        run.fragileBase[k] = Math.max(0, Number(run.fragileBase[k]) || 0);
        run.fragileBurned[k] = Math.max(0, Number(run.fragileBurned[k]) || 0);
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
      if (run.shop && typeof run.shop === 'object' && !Array.isArray(run.shop.slots)) run.shop = null;
      if (run.phase !== 'shop' && run.phase !== 'checkpoint') run.phase = null;
    if (!Array.isArray(run.debuffs)) run.debuffs = [];
    }
    return run;
  }

  // ---------- 解锁 ----------
  function unlocked() {
    const s = S();
    if (s.level < UNLOCK_LEVEL) return { ok: false, msg: '达到 30 级后解锁挑战塔。' };
    for (let id = 1; id <= UNLOCK_STAGES; id++) {
      if (!State.stageProgress(id).passed) return { ok: false, msg: '通关挑战模式全部 18 关后解锁挑战塔。' };
    }
    return { ok: true };
  }

  // ---------- 层结构 ----------
  /** 第 4 场的随机 boss：只由层数决定（第 1 项：不按天随机）—— 同层固定，换层才换。 */
  function bossEntry(layer, salt, squirrelsOnly) { return D().bossFor(layer, salt, squirrelsOnly); }
  function buildPlan(layer, salt, squirrelsOnly) {   // 第 1 项：salt = 本局随机盐，让每局的 boss/三侠顺序都不同
    /* 三侠顺序按层数随机（`heroOrder`，与日期无关）：同层固定 → 预告 = 实战、重试不变。
     * 削弱跟着「哪一位大侠」走（HERO_DEBUFF[anim]），所以顺序一变，本层要吃的削弱顺序也变，
     * 但三种削弱的组合固定，玩家看预告里的头像就知道等一下会被套上什么。 */
    const plan = D().heroOrder(layer, salt).map((anim) => ({ kind: 'hero', anim }));
    // 第 4 场 = 随机 boss（20 选 1：7 个带机制的松鼠 + 3 只平庸松鼠 + 10 个机制 NPC）
    plan.push(bossEntry(layer, salt, squirrelsOnly));
    // x10 层第 5 场 = 固定狂战松鼠（松鼠形态 + 全身狂战套 + 精英）
    if (layer % 10 === 0) plan.push({ kind: 'warlord', id: D().WARLORD.id });
    return plan;
  }
  function entryInfo(entry) {
    if (entry.kind === 'hero') return { name: HERO_NAME[entry.anim], anim: entry.anim, type: '三侠位', mechDesc: '', elite: false };
    if (entry.kind === 'warlord') {
      const w = D().WARLORD;
      return { name: w.name, squirrel: true, gear: w.gear, elite: true, type: w.type,
        mechDesc: w.mechDesc, patternDesc: w.patternDesc, mechs: w.mech.slice() };
    }
    if (entry.kind === 'npc') {
      const npc = D().NPC_BY_ID[entry.id];
      return { name: npc.name, anim: npc.anim, elite: false, type: npc.type, mechDesc: npc.mechDesc, mechs: [npc.mech] };
    }
    const sq = entry.kind === 'trial' ? D().TRIAL_BY_ID[entry.id] : D().SQUIRREL_BY_ID[entry.id];
    return { name: sq.name, squirrel: true, gear: sq.gear, elite: false, type: sq.type,
      mechDesc: sq.mechDesc || '', patternDesc: sq.patternDesc || '', mechs: (sq.mech || []).slice() };
  }
  /** 第 1 项：boss 一览 —— 池子里每个 boss 的预告信息 + 它固定出现的层（池子只按层抽取，所以层是固定的）。 */
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
  /** 入口页预告：当前层的全部对手（与 buildPlan 同源，所以预告 = 实战）。 */
  function preview(layer, salt, squirrelsOnly) {
    return buildPlan(layer, salt, squirrelsOnly).map((entry) => Object.assign({ kind: entry.kind }, entryInfo(entry)));
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
    return run.plan.map((entry) => Object.assign({ kind: entry.kind }, entryInfo(entry)));
  }

  // ---------- buff 聚合 ----------
  function ownedEntry(run, id) {
    for (const list of [run.permanent || [], run.limited || []]) {
      const found = (list || []).find((b) => b.id === id);
      if (found) return found;
    }
    return null;
  }
  function stacksOf(run, id) { const b = ownedEntry(run, id); return b ? b.stacks : 0; }
  function globalMul(run) {
    const st = stacksOf(run, 'C15');
    return st ? Math.pow(D().BUFF_BY_ID.C15.mods.globalMul, st) : 1;
  }
  /** 生效中的 buff：永久全部生效；限次只在「开关打开且还有次数」时生效。 */
  function eachBuff(run, fn) {
    for (const b of run.permanent || []) fn(D().BUFF_BY_ID[b.id], b.stacks);
    for (const b of run.limited || []) { if (b.on === false || !(b.uses > 0)) continue; fn(D().BUFF_BY_ID[b.id], b.stacks); }
  }
  /** 一次生效类增益「到底给了什么」——调试台要把效果写清楚，不能只显示个名字。 */
  function instantDetail(buff) {
    const m = (buff && buff.mods) || {};
    const parts = [];
    if (m.instantCoins) parts.push('试炼币 +' + m.instantCoins);
    if (m.enemyMaxHpDown) parts.push('本局敌人生命上限 −' + Math.round(m.enemyMaxHpDown * 100) + '%');
    if (m.shopDiscount) parts.push('下一家商店五折');
    if (m.openShop) parts.push('立即开一次商店');
    if (m.instantRetry) parts.push('重新挑战币 +' + m.instantRetry);
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
  /** 限次 buff 打完一场扣 1 次，扣完自动消失（第 1 项）。 */
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
  /** 某个 mod 在本局的合计值（战斗外结算用，例如战后续航）——带叠层与增幅水晶乘区。 */
  function runModTotal(run, key) {
    const g = globalMul(run);
    let sum = 0;
    eachBuff(run, (buff, stacks) => { const m = buff.mods; if (m && m[key]) sum += m[key] * stacks * g; });
    return sum;
  }
  function aggregate(run, foeCtx) {
    const g = globalMul(run);
    const agg = { powerMul: 0, maxHpMul: 0, critBonus: 0, critDmgBonus: 0, dodgeBonus: 0, takenMul: 0,
      regenPct: 0, lifestealPct: 0, shellPct: 0, openStrikePct: 0, enemyPowerDown: 0, startHealPct: 0,
      mustHitFirst: 0, firstSkillFree: 0, deathSaves: [], dmgMul: 1, revivePct: 0,
      speedMul: 0, winHealPct: 0, thornsPct: 0, lowHpPowerMul: 0, lowHpAt: 0,
      openerPowerMul: 0, openerRounds: 0, fatiguePowerMul: 0, dodgeMul: 0 };
    eachBuff(run, (buff, stacks) => {
      const m = buff.mods, k = stacks * g;
      if (m.powerMul) agg.powerMul += m.powerMul * k;
      /* 本轮第 6 项：与永久槽位互动的两个攻击增益。
       * C34 轻装上阵 = 每个**空**槽 +20%（槽越空越强）；C35 厚积薄发 = 每拥有 1 个永久增益 +10%。
       * 都用「当前快照」计算：拿了/卖了/换了永久增益，下一场立刻反映。 */
      if (m.powerPerEmptySlot) agg.powerMul += m.powerPerEmptySlot * Math.max(0, permSlots(run) - permUsed(run)) * k;
      if (m.powerPerPermBuff) agg.powerMul += m.powerPerPermBuff * (run.permanent || []).length * k;
      /* C12 登顶者：第 10 层起每胜一场攻击 +5%（可叠层）。
       * 这里原来写的是 `* 0` —— 一个占位写法，等于把这条增益的加成**恒置为 0**，
       * 玩家叠到再多层也毫无效果（实测：层 10 起连胜 10 场，winPower 一直是 0）。 */
      if (m.winPowerAfter10) agg.powerMul += Math.max(0, Number(run.winPower) || 0);
      /* 第 1 项：永久类的生命上限加成记在 run.hpBonus 上（卖掉/替换也不会掉血上限）；
       * 限次类的仍然按场次生效，buff 消失时加成也一起消失。 */
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
      if (m.winPowerAfter10) agg.winPower += 1;
      if (m.winHealPct) agg.winHealPct += m.winHealPct * k;                       // 战后续航（可叠加）
      if (m.thornsPct) agg.thornsPct += m.thornsPct * k;                         // 荆棘之甲
      if (m.mustHitAll) agg.mustHitAll = 1;                                      // 第 1 项：百步穿杨
      if (m.firstHitZero) agg.firstHitZero = 1;                                  // 第 1 项：先机预判
      if (m.lowHpPowerMul) { agg.lowHpPowerMul += m.lowHpPowerMul * k; agg.lowHpAt = Math.max(agg.lowHpAt, Number(m.lowHpAt) || 0.35); }
      if (m.mustHitFirst) agg.mustHitFirst = 1;
      if (m.firstSkillFree) agg.firstSkillFree = 1;
      if (m.deathSave) agg.deathSaves.push({});                                  // 金蝉脱壳：保留 1 血
      if (m.revivePct) agg.revivePct = Math.max(agg.revivePct || 0, Math.min(0.9, m.revivePct * g));   // 不死鸟：每层一次
      if (foeCtx.hero && m.dmgMulType) agg.dmgMul *= 1 + m.dmgMulType * k;       // 猎侠者
      if (foeCtx.poolNpc && m.dmgMulMech) agg.dmgMul *= 1 + m.dmgMulMech * k;    // 机制破解
      if (foeCtx.elite && m.dmgMulElite) agg.dmgMul *= 1 + m.dmgMulElite * k;    // 精英杀手
    });
    /* 需求 3：易碎烙印加成 —— 存在时半效、损毁后全额并本局永久保留。 */
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
    // 第 2 项：C09 改成「逢五强化」——5 的倍数层生效，数值取 mods.x10Boost
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
    const hpTotal = (a.maxHpMul || 0) + (run.hpBonus || 0);
    if (hpTotal) lines.push(['生命上限', pct(hpTotal) + (run.hpBonus ? '（含永久累计 ' + pct(run.hpBonus) + '）' : '')]);
    if (a.critBonus) lines.push(['暴击率', num(a.critBonus) + '%']);
    if (a.critDmgBonus) lines.push(['暴击伤害', pct(a.critDmgBonus)]);
    if (a.dodgeBonus) lines.push(['闪避', num(a.dodgeBonus) + '%']);
    if (a.takenMul) lines.push(['受到伤害', pct(a.takenMul)]);
    if (a.regenPct) lines.push(['每回合回血', pct(a.regenPct) + ' 最大生命']);
    if (a.lifestealPct) lines.push(['攻击吸血', pct(a.lifestealPct)]);
    if (a.thornsPct) lines.push(['荆棘反伤', pct(a.thornsPct)]);
    if (a.shellPct) lines.push(['护盾', pct(a.shellPct)]);
    if (a.startHealPct) lines.push(['开战回血', pct(a.startHealPct) + ' 最大生命']);
    if (a.winHealPct) lines.push(['战斗胜利后回血', pct(a.winHealPct)]);
    if (a.openStrikePct) lines.push(['开局打击', pct(a.openStrikePct) + ' 敌最大生命']);
    if (a.enemyPowerDown) lines.push(['敌人攻击', pct(-a.enemyPowerDown)]);
    if (a.lowHpPowerMul) lines.push(['低血（≤' + Math.round(a.lowHpAt * 100) + '%）攻击', pct(a.lowHpPowerMul)]);
    if (a.dmgMul && a.dmgMul !== 1) lines.push(['对本场敌人伤害', pct(a.dmgMul - 1)]);
    if (a.revivePct) lines.push(['复活（每层一次）', pct(a.revivePct) + ' 生命']);
    if (a.deathSaves && a.deathSaves.length) lines.push(['免死', a.deathSaves.length + ' 次（保留 1 血）']);
    if (a.mustHitFirst) lines.push(['必中', '首次攻击']);
    if (a.mustHitAll) lines.push(['必中', '全部攻击']);
    if (a.firstHitZero) lines.push(['首次受击', '伤害归零']);
    if (a.firstSkillFree) lines.push(['首技能', '不消耗回合']);
    if (a.winPower) lines.push(['连胜成长', '已叠 ' + a.winPower + ' 层']);
    /* 运行态成长（不在 aggregate 的 mods 里，但确实是 buff 带来的提升） */
    if (run.killPower) lines.push(['击杀成长（攻击）', pct(run.killPower)]);
    if (run.bonusPower) lines.push(['加成累积（攻击）', pct(run.bonusPower)]);
    for (const [k, name] of [['power', '攻击'], ['agility', '敏捷'], ['speed', '速度']]) {
      const fb = fragileBonus(run, k);
      if (fb.value) lines.push(['烙印·' + name + (fb.burned ? '（已损毁·全额永久）' : '（存在·半效）'), pct(fb.value)]);
    }
    if (run.spendGain && (run.spendGain.power || run.spendGain.agility || run.spendGain.speed || run.spendGain.hp)) {
      const g = run.spendGain;
      lines.push(['挥金如土', '攻击 +' + g.power + ' / 敏捷 +' + g.agility + ' / 速度 +' + g.speed + ' / 生命 +' + g.hp]);
    }
    if (run.enemyMaxHpDown) lines.push(['敌人生命上限（本局）', pct(-run.enemyMaxHpDown)]);
    if (run.shopDiscount) lines.push(['下一家商店', '五折']);
    /* 逢五强化（C09）只在 5 的倍数层生效，单独标出来 */
    if (stacksOf(run, 'C09') && run.layer % 5 === 0) lines.push(['逢五强化（本层）', '已生效']);
    return lines;
  }

  // ---------- 敌人构建 ----------
  function buildFoe(mode, layer, entry) {
    const TD = D();
    const LT = mode === 'tower' ? TD.towerLevel(layer) : TD.endlessLevel(layer);
    const M = mode === 'tower' ? TD.towerMult(layer) : TD.endlessMult(layer);
    const statBase = GData.stagePlayerStat(LT), hpBase = GData.stagePlayerHp(LT);
    // 无尽段机制叠加：所有怪物按固定顺序追加机制
    /* 段位机制已经并入环境词缀：这里不再自动追加，敌人身上也不再挂机制标签。
     * 原先的 thorns/regen/lifesteal/shell/devour 现在通过环境效果加在本场的 mods 上。 */
    const extra = [];
    const elite = entry.kind === 'warlord';                 // x10 第 5 场：精英（×1.2）
    let name, bias, npcType, skills = [], weapons = [], pattern = null, mech;
    let mechParams = null, wears = null;
    if (entry.kind === 'hero') {
      const scale = (GData.STAGE_TYPE_SCALE && GData.STAGE_TYPE_SCALE[entry.anim]) || 1;
      bias = { power: scale, agility: scale, speed: scale, hp: 1 };
      name = HERO_NAME[entry.anim]; npcType = entry.anim;
      skills = [{ id: HERO_SKILL[entry.anim], level: Math.max(1, Math.min(15, Math.round(LT / 5))) }];
      mech = extra.slice();
    } else if (entry.kind === 'squirrel' || entry.kind === 'trial' || entry.kind === 'warlord') {
      // 松鼠形态的 boss：同族贴图（**不给 npcType** → 战斗里就用玩家那套松鼠图集并镜像朝左，
      // 走 sim 的 playerLikeAction 分支，所以武器/技能都真的生效，机制在 sim 的
      // 「玩家式 AI」分支里补挂）。每个 boss 都有固定装备（wears）→ 玩家看图就能认人。
      const sq = entry.kind === 'warlord' ? TD.WARLORD
        : entry.kind === 'trial' ? TD.TRIAL_BY_ID[entry.id] : TD.SQUIRREL_BY_ID[entry.id];
      bias = sq.bias; name = sq.name; npcType = null;
      // 武技等级随目标等级小幅上调，免得高层还在用 8 级菜刀
      const up = Math.max(0, Math.floor((LT - 28) / 12));
      weapons = sq.weapons.map((w) => ({ id: w.id, level: Math.max(1, Math.min(15, w.level + up)) }));
      skills = sq.skills.map((k) => ({ id: k.id, level: Math.max(1, Math.min(15, k.level + up)) }));
      pattern = sq.pattern.slice();
      /* 需求 5：狂战套**只给 x10 层最后一个敌人**。
       * 原来 gearKeyForLayer 无条件对 10 的倍数层返回 'berserk'，于是第 10 层的
       * 前 4 个敌人也一起穿上了狂战套 —— 需求里明确不要这样。
       * 狂战是「首领专属」：最后一个敌人本来就有 sq.gear === 'berserk'，用 4 号档解析；
       * 其它敌人一律按自己的套装键走普通档位（该层上限内）。 */
      const gearKey = sq.gear === 'berserk'
        ? 'berserk'                                                  // 首领本人：狂战套（4 号档）
        : (layer % 10 === 0
          ? sq.gear                                                  // x10 非首领：用自己那套，别蹭狂战
          : (TD.gearKeyForLayer ? TD.gearKeyForLayer(layer, sq.gear) : sq.gear));
      wears = TD.wearsOf(gearKey);   // C：套装随层升级
      mech = extra.slice();
      // 自己的机制永远在（无尽的段位机制只做叠加）
      for (const m of sq.mech || []) if (!mech.includes(m)) mech.push(m);
      mechParams = sq.mechParams || null;
    } else {
      const npc = TD.NPC_BY_ID[entry.id];
      bias = npc.bias; name = npc.name; npcType = 'tw_' + npc.id;
      mech = [npc.mech];
      for (const m of extra) if (!mech.includes(m)) mech.push(m);
    }
    const eliteMul = elite ? 1.2 : 1;   // 精英加成（x10 狂战）：作用在力量/敏捷/速度上
    // 敌方数值：高血低攻（系数在 tower-data.js 里，带注释，方便 tower-tune 复调）
    // 力量单独用更低的系数，敏捷/速度维持原基准；血量抬高。
    const stat = (b, mul) => Math.max(1, Math.round(statBase * (mul || TD.FOE_STAT_MUL) * M * b * eliteMul));
    const hero = entry.kind === 'hero';
    const warlord = entry.kind === 'warlord';           // x10 第 5 场
    const powMul = hero ? TD.FOE_HERO_POWER_MUL : warlord ? TD.FOE_WARLORD_POWER_MUL : TD.FOE_TRIAL_POWER_MUL;
    /* 第 2 项：血量先按三侠那一档算出来，boss / 狂战再乘一个 1.04~1.22 的小倍率 ——
     * 这样「最后一战的血条」永远只比前三场厚一点点，不会暴涨也不会反而更薄。
     * 精英 ×1.2 只加在输出上（血量已经通过 ratio 表达），免得 x10 又变成血量墙。 */
    const heroHp = hpBase * TD.FOE_HP_MUL * TD.FOE_HERO_HP_MUL * M * bias.hp;
    const hpRatio = hero ? 1 : warlord ? TD.WARLORD_HP_RATIO : TD.bossHpRatio(bias.hp, layer);
    const foe = {
      name, level: LT, npcType,
      power: stat(bias.power, TD.FOE_POWER_MUL * powMul),
      agility: stat(bias.agility), speed: stat(bias.speed),
      hp: Math.max(1, Math.round(heroHp * hpRatio)),
      weapons, skills, mech, pattern, mechParams, wears,
    };
    // poolNpc = 带专属机制的对手（「机制破解」类 buff 只对它生效）；平庸松鼠没有机制，不算
    const poolNpc = entry.kind === 'npc' || entry.kind === 'warlord' || (entry.kind === 'trial');
    return { foe, elite, poolNpc };
  }
  function regionOf(entry) {
    if (entry.kind === 'squirrel' || entry.kind === 'trial' || entry.kind === 'warlord') {
      const sq = entry.kind === 'warlord' ? D().WARLORD
        : entry.kind === 'trial' ? D().TRIAL_BY_ID[entry.id] : D().SQUIRREL_BY_ID[entry.id];
      return sq && sq.region != null ? sq.region : 0;
    }
    const anim = entry.kind === 'hero' ? entry.anim : D().NPC_BY_ID[entry.id].anim;
    return HERO_REGION[anim] != null ? HERO_REGION[anim] : 0;
  }

  // ---------- 开局 ----------
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
    t.run = { mode: 'tower', layer, plan: buildPlan(layer), idx: 0, carry: 1,
      permanent: [], limited: [], buffs: [], debuffs: [], pot: 0, choices: null };
    save();
    return { ok: true, layer };
  }
  function startEndlessRun() {
    const lock = unlocked();
    if (!lock.ok) return lock;
    const e = endless();
    if (e.run) return { ok: false, msg: '本局无尽挑战尚未结束。' };
    /* 第 1 项：本局随机盐 —— boss / 三侠顺序按 salt 抽，每局都不一样。 */
    const salt = (Date.now() % 1000000) + ':' + Math.floor(Math.random() * 1e6);
    const run = { layer: 1, plan: buildPlan(1, salt, true), idx: 0, carry: 1, salt,
      mode: 'endless', permanent: [], limited: [], coins: 0, score: 0, bestLayer: 0,
      pillSlots: { power: null, agility: null, speed: null },
      killPower: 0, bonusPower: 0, shop: null, phase: null, choices: null, debuffs: [],
      retryToken: 0, retrySnap: null,
      achievements: [], scoreLog: [], statPeaks: {}, pendingToasts: [],
      deathSaves: 0, reviveCount: 0, reviveTierPaid: 0 };
    if (debug('endlessCoin')) run.coins = 9999;
    e.run = run;
    save();
    return { ok: true, layer: 1 };
  }
  /** 五层回响：进入 5 的倍数层时回复 50%（无尽）。 */
  function layerStartHeal(run, mode) {
    // 第 2 项：无尽塔跨层固定回 20% 血
    if (mode === 'endless') run.carry = Math.min(1, run.carry + D().ENDLESS_LAYER_HEAL_PCT);
    if (run.layer % 5 === 0 && stacksOf(run, 'C08')) {
      run.carry = Math.min(1, run.carry + D().BUFF_BY_ID.C08.mods.layer5HealPct * globalMul(run));
    }
  }

  // ---------- 战斗调度 ----------
  /** 深拷贝一份对局状态（优先用 structuredClone，退回 JSON —— 用 Object.assign 会被 __proto__ 坑到）。 */
  function cloneRun(run) {
    if (typeof structuredClone === 'function') { try { return structuredClone(run); } catch (e) { /* 落到 JSON */ } }
    return JSON.parse(JSON.stringify(run));
  }
  /**
   * 需求 1（重新挑战币）：每开一场战斗前把「这一场开始前」的对局状态存一份快照。
   * 失败时若手上有重新挑战币，就用它回滚到这份快照再打一次 —— 等于这一场完全没发生过
   * （血量、试炼币、分数、增益次数、环境剩余场数全部回到战前）。
   * 快照存在 run 上，所以中途退出游戏也能续上。
   */
  function snapshotBattle(run) {
    if (!run || run.mode !== 'endless') return null;
    const snap = cloneRun(run);
    delete snap.retrySnap;        // 快照里不再嵌套快照，避免越滚越大
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
    const built = buildFoe(mode, run.layer, entry);
    const foeCtx = { hero: entry.kind === 'hero', poolNpc: built.poolNpc, elite: built.elite };
    const agg = aggregate(run, foeCtx);
    /* 隐藏成就「超凡入圣」：本场聚合出来的 buff 加成（不含装备/等级）跨过阈值就记一次。 */
    checkStatAchievements(run, agg);
    // M01 威慑：直接压敌人力量
    if (agg.enemyPowerDown > 0) built.foe.power = Math.max(1, Math.round(built.foe.power * (1 - agg.enemyPowerDown)));
    /* 本轮第 3 项：挫锐 / 卸甲 —— 本局所有敌人生命上限按累计比例下调。
     * 这是「即时」类增益，登记在 run.enemyMaxHpDown 上，之后每场都生效（不占增益位）。 */
    const foeHpDown = Math.max(0, Math.min(0.6, Number(run.enemyMaxHpDown) || 0));
    if (foeHpDown > 0) built.foe.hp = Math.max(1, Math.round(built.foe.hp * (1 - foeHpDown)));
    const maxHpMul = agg.maxHpMul, powerMul = agg.powerMul;
    /* 「补给」：下一场战斗开始时立即回复 50% 生命 —— 在取下一场的时候就把 carry 抬上去。 */
    if (agg.startHealPct > 0) run.carry = Math.min(1, run.carry + agg.startHealPct);
    const adjustMe = (me) => {
      /* 第 4 项：先记下「未加塔 buff」的基础上限，currentMaxHp() 靠它现算。 */
      run.baseMaxHp = Math.max(1, Number(me.maxHp) || 0);
      // 本层削弱（三侠大招留下的）：生命上限 / 属性 / 锁武技
      const debuffs = Array.isArray(run.debuffs) ? run.debuffs : [];
      const dMaxHp = debuffs.filter((d) => d.kind === 'maxHp').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const dPower = debuffs.filter((d) => d.kind === 'stat' && d.stat === 'power').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const dAgi = debuffs.filter((d) => d.kind === 'stat' && d.stat === 'agility').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const dSpd = debuffs.filter((d) => d.kind === 'stat' && d.stat === 'speed').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const stickyHp = Math.max(0, Number(run.hpBonus) || 0);   // 第 1 项：永久生命上限加成（卖/换后保留）
      /* 需求 4：吞噬成长的「胜利成长」按比例加到生命上限上（run.winMaxHp）。 */
      const winMaxHp = Math.max(0, Number(run.winMaxHp) || 0);
      /* 第 9 项：挥金如土累计的生命上限（固定值，和「以战养战」的 winHpFlat 同口径）。 */
      const spendHp = run.spendGain ? Math.max(0, Number(run.spendGain.hp) || 0) : 0;
      const maxHp = Math.max(1, Math.round(me.maxHp * (1 + maxHpMul + stickyHp + winMaxHp) * dMaxHp) + Math.max(0, Number(run.winHpFlat) || 0) + spendHp);
      /* 选取型强化：指定武器出战时伤害 +pct（等价于力量翻倍），指定技能的触发档位 ×(1+pct) 且至少 +25 */
      const wBoost = run.weaponBoost || {};
      let weaponMul = 1;
      for (const key of Object.keys(wBoost)) {
        const inst = (State.myWeapons ? State.myWeapons() : []).find((w) => Number(w.id) === Number(key));
        if (inst) weaponMul = Math.max(weaponMul, 1 + Number(wBoost[key] || 0));
      }
      const sBoost = run.skillBoost || {};
      if (me.effects) {
        for (const key of Object.keys(sBoost)) {
          const cur = Number(me.effects[key]) || 0;
          me.effects[key] = Math.max(cur * (1 + Number(sBoost[key] || 0)), cur + 25);
        }
      }
      /* 环境词缀（敌人侧）：数值来自实例上摇好的随机值（见 envValues / applyEnvToFoe）。 */
      applyEnvToFoe(run, built.foe);
      me.power = Math.max(1, Math.round(me.power * (1 + powerMul) * dPower * weaponMul));
      me.agility = Math.max(1, Math.round(me.agility * dAgi * (1 + agg.agilityMul)));
      me.speed = Math.max(1, Math.round(me.speed * dSpd * (1 + agg.speedMul)));
      // 第 1 项：属性药丸（塔内 20 场）—— 与 State.totalStats 的药剂口径一致
      for (const k of ['power', 'agility', 'speed']) {
        const slot = (run.pillSlots || {})[k];
        const eff = slot && D().pillEffect(slot.id);
        if (eff) me[k] += Math.max(Math.floor(me[k] * eff.pct), eff.min);
      }
      /* 第 9 项：挥金如土累计的力/敏/速（固定值，和药丸一样直接加到面板属性上）。 */
      if (run.spendGain) {
        for (const k of ['power', 'agility', 'speed']) me[k] += Math.max(0, Number(run.spendGain[k]) || 0);
      }
      for (const d of debuffs) {
        if (d.kind !== 'lock') continue;
        if (d.what === 'weapon') me.weapons = (me.weapons || []).filter((w) => Number(w.id) !== Number(d.id));
        else me.skills = (me.skills || []).filter((s2) => Number(String(s2).split(':')[0]) !== Number(d.id));
      }
      /* 环境词缀（我方侧，如寒霜锁链减速度）必须放在**属性都算完之后**，
       * 否则会被上面那几行「me.speed = …」覆盖掉（实测踩过）。
       * 同时把这次加到我方身上的 mods 记下来，稍后并进最终的 me.mods。 */
      applyEnvToMe(run, me);
      const envModsMine = Object.assign({}, me.mods || {});
      // maxHpMul 的「回复等量生命」= 按比例继承到新上限（正增益不亏比例、负增益同步缩血）
      me.maxHp = maxHp;
      me.hp = Math.max(1, Math.min(maxHp, Math.round(maxHp * run.carry)));
      /* 本轮第 4 项：记下基础上限（未加塔 buff 的那一份）与本场真实上限 / 当前血量。 */
      run.lastMaxHp = maxHp;
      run.lastHp = me.hp;
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
      if (agg.dmgMul !== 1) mods.dmgMul = agg.dmgMul;
      if (agg.thornsPct) mods.thornsPct = Math.min(0.6, agg.thornsPct);          // 荆棘之甲（sim 里结算）
      if (agg.mustHitAll) mods.mustHitAll = 1;                                  // 第 1 项：百步穿杨（整个一场必中）
      if (agg.firstHitZero) mods.firstHitZero = 1;                              // 第 1 项：先机预判（sim 里结算）
      if (agg.lowHpPowerMul) { mods.lowHpPowerMul = agg.lowHpPowerMul; mods.lowHpAt = agg.lowHpAt || 0.35; }
      // 第 2 项：不死鸟按「每层一次」发放（本层已经触发过就不再给）
      if (agg.revivePct && (run.reviveLayer || 0) !== run.layer) mods.deathSaves = (mods.deathSaves || []).concat([{ healPct: agg.revivePct }]);
      if (agg.deathSaves.length) mods.deathSaves = (mods.deathSaves || []).concat(agg.deathSaves);
      /* 环境词缀（我方侧）也要并进这一份最终 mods 里 ——
       * applyEnvToMe 是在上面算的，那时候 me.mods 还不是这个新对象，
       * 不合并的话「血色黄昏给我方吸血」「烈日给我方暴击」这些就丢了（实测踩过）。 */
      for (const [k, v] of Object.entries(envModsMine || {})) if (v) mods[k] = (Number(mods[k]) || 0) + v;
      me.mods = mods;
    };
    run.attempt = mode + '_' + Date.now() + '_' + (++attemptSeq);
    snapshotBattle(run);      // 需求 1：记下这一场开始前的状态，供失败后回滚
    save();
    const toasts = takeAchievementToasts(run);   // 例如「超凡入圣」是在这之前算出来的
    return { ok: true, token: run.attempt, entry, info: entryInfo(entry), foe: built.foe,
      elite: built.elite, region: regionOf(entry), hpRatio: run.carry, adjustMe,
      debuffs: (run.debuffs || []).slice(), achievements: toasts,
      battleNo: run.idx + 1, battleCount: run.plan.length, layer: run.layer };
  }
  /* ============================================================
   * 计分：所有加分都走这里，顺带记录「本局成就」流水（供界面飘提示与结算展示）
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
  /** 需求：某项 buff 加成跨过阈值 → 隐藏成就。在 buildFoe 里用本场的 aggregate 检查。 */
  function checkStatAchievements(run, agg) {
    if (!run || run.mode !== 'endless' || !agg) return [];
    const got = [];
    const peaks = run.statPeaks = Object.assign({}, run.statPeaks || {});
    const NAMES = { powerMul: '攻击', agilityMul: '敏捷', speedMul: '速度', maxHpMul: '生命上限' };
    for (const [field, label] of Object.entries(NAMES)) {
      const before = Math.max(0, Number(peaks[field]) || 0);
      const pct = Math.max(0, Number(agg[field]) || 0);
      /* 峰值只增不减：buff 掉了成就也已经拿到手（那才是「曾经达成」）。 */
      if (pct > before) peaks[field] = pct;
      const after = Number(peaks[field]) || 0;
      for (const m of D().SCORE.statMilestones) {
        /* 必须「本次这一下跨过」才触发：before < 阈值 ≤ after。
         * 只写 `after >= 阈值` 会把整档一次性全点亮（曾经写反过：峰值一到 100%
         * 就把 100/150/200/300 四条一起记，实测一场刷出 16 个成就 +3000 分）。 */
        if (!(before < m.at && after >= m.at)) continue;
        const key = 'stat:' + field + ':' + Math.round(m.at * 100);
        const item = markAchievement(run, key, '超凡入圣 · ' + label + ' +' + Math.round(m.at * 100) + '%', m.points);
        if (item) { addScore(run, m.points, '隐藏成就·' + item.name); got.push(item); }
      }
    }
    return got;
  }
  /** 手上有没有重新挑战币（以及有没有可用的快照）。 */
  function canRetry(run) {
    return !!(run && run.mode === 'endless' && Number(run.retryToken) > 0 && run.retrySnap);
  }
  /**
   * 需求 1：花 1 枚重新挑战币，回滚到本场战斗开始前。
   * 返回 true 表示回滚成功，调用方应当重新进入这一场。
   */
  function retryBattle() {
    const e = endless(), run = e.run;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    if (!(Number(run.retryToken) > 0)) return { ok: false, msg: '没有重新挑战币（可在试炼商店购买）。' };
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

  // ---------- 战斗结算 ----------
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
  function applyHeroDebuff(run, entry, result) {
    if (!entry || entry.kind !== 'hero') return null;
    const def = D().HERO_DEBUFF[entry.anim];
    if (!def) return null;
    const src = HERO_SOURCE[entry.anim] || { hero: '大侠', short: '大侠', color: '#7a4a18' };
    const fired = !!(result && Array.isArray(result.rounds)
      && result.rounds.some((r) => r && r.ultName === def.ult));
    if (!fired) return null;
    if (!Array.isArray(run.debuffs)) run.debuffs = [];
    if (run.debuffs.some((d) => d.from === entry.anim)) return null;   // 同一场只落一次
    let d;
    if (def.kind === 'stat') {
      const stat = ['power', 'agility', 'speed'][Math.floor(Math.random() * 3)];
      const label = { power: '力量', agility: '敏捷', speed: '速度' }[stat];
      d = { from: entry.anim, hero: src.hero, short: src.short, color: src.color,
        kind: 'stat', stat, pct: def.pct, name: def.name,
        text: label + ' −' + Math.round(def.pct * 100) + '%' };
    } else if (def.kind === 'lock') {
      // 随机锁一个武器或技能：按玩家当前拥有的武技合计里抽（师父驾到 13 不占位，排除）
      const st = S(), pool = [];
      const nameOf = (map, id) => { const d = map && map.getValue(id); return d ? d.name : ('#' + id); };
      for (const raw of st.weapons || []) {
        const id = Number(String(raw).split(':')[0]);
        pool.push({ what: 'weapon', id, name: nameOf(weaponsMap, id) });
      }
      for (const raw of st.skills || []) {
        const id = Number(String(raw).split(':')[0]);
        if (id === 13) continue;
        pool.push({ what: 'skill', id, name: nameOf(skillsMap, id) });
      }
      if (!pool.length) return null;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      d = { from: entry.anim, hero: src.hero, short: src.short, color: src.color,
        kind: 'lock', what: pick.what, id: pick.id, name: def.name,
        text: '锁住' + (pick.what === 'weapon' ? '武器' : '技能') + '「' + pick.name + '」' };
    } else {
      d = { from: entry.anim, hero: src.hero, short: src.short, color: src.color,
        kind: 'maxHp', pct: def.pct, name: def.name,
        text: '生命上限 −' + Math.round(def.pct * 100) + '%' };
    }
    run.debuffs.push(d);
    return d;
  }

  function reportBattle(mode, token, win, carryRatio, result) {
    const box = mode === 'tower' ? tower() : endless();
    const run = box.run;
    if (!run || run.attempt !== token) return { ok: false };
    delete run.attempt;
    const entry = run.plan[run.idx];
    const isElite = entry.kind === 'warlord';   // x10 第 5 场的狂战松鼠
    if (!win) {
      const fail = mode === 'tower' ? towerFail(run) : endlessFail(run);
      if (fail && fail.retryable) { fail.battleNo = run.idx + 1; fail.battleCount = run.plan.length; }
      return fail;
    }
    run.carry = Math.max(0.01, clamp01(carryRatio));
    const out = { ok: true, win: true, elite: isElite, entryKind: entry.kind };
    // 三侠的大招会给玩家留一层削弱（第 3 项）
    // 第 2 项：本场触发了复活甲 → 本层的不死鸟用掉
    if (stacksOf(run, 'C14') && result && Array.isArray(result.rounds) && result.rounds.some((r) => r.deathSave)) run.reviveLayer = run.layer;
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
      // 固定节奏回血：每打完一场自动回一点，续航不再依赖场间选择
      run.carry = Math.min(1, run.carry + D().AUTO_HEAL_PCT);
      const shares = D().towerGoldShares(run.layer, run.plan.length);
      run.pot += shares[run.idx];
      out.potGold = run.pot;
    } else {
      const g = globalMul(run);
      // 战后续航（C16/C17，可叠加）：每场胜利后回复 X% 最大生命
      const winHeal = runModTotal(run, 'winHealPct');
      if (winHeal > 0) {
        run.carry = Math.min(1, run.carry + winHeal);
        out.winHeal = winHeal;
      }
      addScore(run, D().SCORE.battle, '战斗胜利');
      /* 第 1 项：试炼币加成（战利品类限次 buff，remaining 次数在下面统一扣） */
      let coinMul = 1 + (runModTotal(run, 'coinBoostPct') || 0);
      /* 贪婪裂隙：我方试炼币按实例上摇出来的比例加成（被反弹/被剥夺时就不给）。
       * 以前这里写死 +50%，与实例数值无关。 */
      {
        const fx = envEffective(run);
        if (!fx.denyGood && (fx.mine.includes('greed') || fx.enemy.includes('greed'))) {
          coinMul += Math.max(0, envModTotal(run, 'coinBonus'));
        }
      }
      // 第 1 项：战利品账本 —— 每胜一场，卖出收益累计 +N
      run.sellBonus = (run.sellBonus || 0) + (runModTotal(run, 'sellGrowthPerWin') || 0);
      /* 第 2 项：以战养战（每胜一场生命上限 +10，不封顶）、登顶者（第 10 层起每胜一场攻击 +5%） */
      run.winHpFlat = (run.winHpFlat || 0) + (runModTotal(run, 'winMaxHpFlat') || 0);
      rollEnvAfterBattle(run);   // 每场战斗后推进环境词缀
      /* 登顶者（可叠层）：第 10 层起每胜一场 +5% × 层数 × 全局倍率。
       * 注意 **不要** 再乘一次 stacksOf —— runModTotal() 内部已经乘了 `stacks * g`，
       * 再乘一次会让层数被平方（实测 3 层变成 9 倍）。 */
      if (run.layer >= 10 && stacksOf(run, 'C12')) {
        run.winPower = (run.winPower || 0) + (runModTotal(run, 'winPowerAfter10') || 0);
      }
      run.coins += Math.round(D().COINS.battle * coinMul);
      // 击杀叠层类（基础 → 叠层 → C15）
      /* 猎杀时刻（可叠层）：增量与上限都要 × 层数 ——
       * 与 C07「吞噬成长」同一套写法（那条本来就乘了 c07）。原来这里只乘了全局倍率 g，
       * 于是拿到 3 层和 1 层完全一样（实测 ×1 与 ×3 都是 0.200）。 */
      const c06 = stacksOf(run, 'C06');
      if (c06) {
        const c06m = D().BUFF_BY_ID.C06.mods;
        run.killPower = Math.min((c06m.killPowerCap || 0.40) * c06 * g,
          run.killPower + (c06m.killPowerPct || 0.02) * c06 * g);
      }
      /* 需求 4：吞噬成长改成「每胜利一场生命上限 +2%，上限 +30%」——
       * 成长从「击杀」改成「胜利」，数值全部读 mods（文字改了数值就跟着改）。 */
      const c07 = stacksOf(run, 'C07');
      if (c07) {
        const c07m = D().BUFF_BY_ID.C07.mods;
        run.winMaxHp = Math.min((c07m.winMaxHpCap || 0.30) * c07 * g, (Number(run.winMaxHp) || 0) + (c07m.winMaxHpPct || 0.02) * c07 * g);
      }
      const c11 = stacksOf(run, 'C11');
      if (c11) run.carry = Math.min(1, run.carry + 0.03 * c11 * g);
      if (isElite) {
        addScore(run, D().SCORE.elite, '击败精英');
        run.coins += D().COINS.elite;
        const c13 = stacksOf(run, 'C13');
        if (c13) run.carry = Math.min(1, run.carry + D().BUFF_BY_ID.C13.mods.eliteHealAfter * g);
      }
    out.score = run.score; out.coins = run.coins;
    }
    run.idx++;
    /* 需求 6：限次 buff 的扣数**必须每场都执行**。
     * 原来这行在 `if (run.idx >= run.plan.length) return layerClear(...)` 之后，
     * 于是「整层最后一场」直接跳过了扣数 —— 玩家打完一层 4 场，
     * 限次只掉了 3 点（第 4 场白打）。这里先把该做的每场结算做完，再决定是否进层结算。 */
    consumeLimited(run);
    const brokenFragile = rollFragileBuffs(run);
    if (brokenFragile.length) out.fragileBroken = brokenFragile;
    if (run.idx >= run.plan.length) return layerClear(mode, run, out);
    // 场间选择：第 1/2/3 场后必给；x10 层第 4 场后再给一次
    const won = run.idx, len = run.plan.length;
    /* 第 3 项：场间选择从「每场都给」压成「只在第 4 场（题面）前给一次」，
     * x10 层（5 场）在第 5 场精英前再给一次。这样每层只有 1~2 个决策点，
     * 而且是在读过三侠的削弱之后才选，选项才有分量。 */
    // 第 1 项：属性药丸按战斗数递减（胜败都算一场）
    for (const k of ['power', 'agility', 'speed']) {
      const slot = (run.pillSlots || {})[k];
      if (slot && slot.battles > 0) { slot.battles--; if (slot.battles <= 0) run.pillSlots[k] = null; }
    }
    if (won === 3 || (won === 4 && len === 5)) run.choices = rollChoices(mode, run);
    out.achievements = takeAchievementToasts(run);
    out.choices = run.choices;
    out.permanent = (run.permanent || []).length;
    out.limited = (run.limited || []).map((b) => ({ id: b.id, uses: b.uses, on: b.on }));
    save();
    return out;
  }
  /**
   * 主塔失败（第 1 项 P0-2「卡层可解」）：
   * 不再清空本层 —— 保留层内进度（idx 停在倒下的那一场），玩家可以：
   *   · 「再战一次」：免费（本层的挑战书已经付过），并且**可以换一张 buff**；
   *   · 「结束本层」：走 giveUp()，拿已累积的 30% 安慰奖。
   * 策划意图：练度刚好差一点时，靠「看懂了题 → 换对策 → 过关」而不是「再烧一张门票」。
   */
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
  /**
   * 需求 1：无尽塔失败。手上有重新挑战币就先**不结算**，把「要不要回滚再打一次」交给界面；
   * 选择放弃时再走 doFail() 正常结算。这样回滚才真的等于「这一场没发生过」
   * （抽奖卷、分数、历史最高都没被这场失败改过）。
   */
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
    /* 第 3 项：失败不再把奖励归零 —— 直接按**当前层应得的抽奖卷**结算（和结算点离场同一个口径），
     * 分数也照常入账。这样「撑到更深」永远有意义，不会一次失败全打水漂。 */
    out = out || { ok: true, win: false, layer: run.layer, score: run.score, bestLayer: run.bestLayer };
    out.win = false;
    const tickets = D().endlessTickets(run.layer);
    if (tickets > 0) S().props[TICKET_PROP] = (S().props[TICKET_PROP] || 0) + tickets;
    out.tickets = tickets;
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
  /** 玩家在有重新挑战币的情况下选择「放弃本局」→ 现在才真正结算失败。 */
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

  // ---------- 环境词缀（无尽塔）----------
  function envList(run) { return Array.isArray(run.env) ? run.env : (run.env = []); }
  /**
   * 战斗后推进：先扣时长，再按层数概率触发。
   * 需求 7：**同时最多 ENV_MAX（2）条，这是硬上限**。
   * 原来「15 层起固定补 2 条」是无视当前的强行补，于是 3 条 + 补 2 条能叠到 4 条；
   * 现在 want 一律夹在 room（= ENV_MAX − 当前条数）之内，永远不会超过两层。
   */
  function rollEnvAfterBattle(run) {
    const TD = D(), list = envList(run);
    for (let i = list.length - 1; i >= 0; i--) { list[i].left -= 1; if (list[i].left <= 0) list.splice(i, 1); }
    if (run.layer < TD.ENV_START_LAYER) return;
    const cap = Math.max(1, Number(TD.ENV_MAX) || 2);
    /* 兜底：旧档 / 调试注入可能已经超过上限，先裁到上限（保留剩余场数多的那几条）。 */
    if (list.length > cap) {
      list.sort((a, b) => (Number(b.left) || 0) - (Number(a.left) || 0));
      list.splice(cap);
    }
    const room = cap - list.length;
    if (room <= 0) return;
    const forced = run.layer >= TD.ENV_TWO_LAYER ? 2 : 0;
    const want = Math.max(0, Math.min(room, forced || (Math.random() < TD.envChance(run.layer) ? 1 : 0)));
    for (let k = 0; k < want; k++) {
      const pool = TD.ENDLESS_ENV.filter((e) => !list.some((x) => x.id === e.id));
      if (!pool.length) break;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const dur = TD.ENV_DUR[0] + Math.floor(Math.random() * (TD.ENV_DUR[1] - TD.ENV_DUR[0] + 1));
      /* 数值在区间内随机摇一次并固定在实例上：同一条环境每次出现强度略有不同。 */
      list.push({ id: pick.id, left: dur, values: TD.rollEnvMods(pick) });
    }
  }
  /** 某条环境在本局的**实际数值**（旧档没有 values 时就地补摇一次）。
   *  buff 的倍率（例如「环境强化」类）在这里统一乘上去。 */
  function envValues(run, entry) {
    const TD = D();
    const def = TD.ENDLESS_ENV_BY_ID[entry && entry.id];
    if (!def) return {};
    if (!entry.values || typeof entry.values !== 'object') entry.values = TD.rollEnvMods(def);
    const mul = 1 + Math.max(0, runModTotal(run, 'envPowerMul'));
    const out = {};
    for (const [k, v] of Object.entries(entry.values)) out[k] = Number(v) * mul;
    return out;
  }
  /** 本局所有生效环境里，某个键的合计（已含环境强化倍率）。 */
  function envModTotal(run, key) {
    let sum = 0;
    for (const e of envList(run)) {
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
    /* 注意：敌人面板（buildFoe 的 foe）没有 `side` 字段，只有玩家面板有。
     * 所以不能只看 fighter.side，否则环境会被错误地发到玩家那一侧（实测踩过）。 */
    const isFoe = side != null ? side === 1 : fighter.side === 1;
    const key = isFoe ? 'foe' : 'me';
    const eff = { mods: {} };
    const add = (k, key2, v) => { if (v) eff.mods[k] = (Number(eff.mods[k]) || 0) + v; };
    /** 把一条环境实例的数值按「朝向 + 当前这一方」写进 eff。 */
    const consume = (entry) => {
      const def = TD.ENDLESS_ENV_BY_ID[entry.id];
      if (!def || !def.mods) return;
      const values = envValues(run, entry);
      for (const [mk, spec] of Object.entries(ENV_MOD_MAP)) {
        if (def.mods[mk] === undefined) continue;
        if (spec[1] !== 'both' && spec[1] !== key) continue;
        add(spec[0], mk, Number(values[mk]) || 0);
      }
    };
    /* 每条环境实例只算一次（envEffective 的 mine 里也可能含正向环境，
     * 早期版本因此把血色黄昏叠加了两次 —— 实测过）。 */
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
    const coin = fx.denyGood ? 0 : (fx.mine.includes('greed') || fx.enemy.includes('greed'))
      ? envModTotal(run, 'coinBonus') : 0;
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
    for (const e of envList(run)) {
      const def = TD.ENDLESS_ENV_BY_ID[e.id];
      if (!def) continue;
      if (def.bad) { if (sh.ignore && !sh.reflect) continue; if (sh.reflect) enemy.push(e.id); else mine.push(e.id); }
      else if (!sh.denyGood) mine.push(e.id);
    }
    return { mine, enemy, sh };
  }

  // ---------- 层通关 ----------
  function layerClear(mode, run, out) {
    out.layerComplete = true;
    out.layer = run.layer;
    // 本层已全清：留一份快照，主界面在商店/结算点阶段仍能看到「最后一个敌人 已战胜」
    if (mode === 'endless') run.finished = { layer: run.layer, count: run.plan.length, at: Date.now() };
    if (mode === 'tower') {
      const gold = run.pot;
      State.addGold(gold);
      tower().maxLayer = run.layer;
      tower().retry = null;
      /* 碎片判定压缩到最后一击：掉率/数量期望 = 挑战模式单场（★6 参数）。
       * 需求：挑战塔**只掉蓝色碎片**（id 26）—— 不再按概率分白/绿
       *（原来 72% 白、28% 蓝，白色占大头）。掉率与数量沿用 ★6 那一档，
       * 所以改的是「碎片成色」而不是掉率本身：每层期望从「白 ~1.5 + 蓝 ~0.6」
       * 变成「蓝 ~2.1」。 */
      if (Math.random() < GData.stageFragmentChance(6)) {
        const count = GData.stageFragmentCount();
        const id = 26;                                  // 蓝色碎片
        S().props[id] = (S().props[id] || 0) + count;
        out.drop = { id, count, name: propMap.getValue(id).name };
      }
      /* 第 2 项：塔内战斗关掉了飘物（防免门票刷资源），所以每层最后结算时
       * 按「一整个常驻挑战关 = 3 场」补发它的掉落（每场 3 个飘物 → 9 个）。 */
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
    /* 本轮第 5 项：**不要**在这里清空限次列表。
     * 无尽里限次 buff 全是按「场次」计时的（战利品 10 场、疾风步 10 场…），
     * consumeLimited 每打完一场扣 1、扣完自动消失。原来这句 run.limited = []
     * 会在每次换层把它们全部抹掉 —— 玩家只吃到本层剩下的 3~4 场，
     * 「接下来 10 场」形同虚设（第 1 层结束就消失）。
     * 主塔的「本层类」uses=99，而且整局在上面 tower 分支就已经结束了，不受影响。 */
    const c04 = stacksOf(run, 'C04');                    // 生命源泉：每过一层回血
    if (c04) run.carry = Math.min(1, run.carry + D().BUFF_BY_ID.C04.mods.layerHealPct * g);
    const c12 = stacksOf(run, 'C12');                    // 登顶者：20 层起每过一层攻击成长
    if (c12 && run.layer >= 10) run.bonusPower += D().BUFF_BY_ID.C12.mods.perLayerPowerAfter20 * c12 * g;   // 第 2 项：从 10 层起
    /* 第 3 项：每爬 10 层，结算时随机发一次里程碑奖励（技能卷轴×10 / 武器卷轴×10 / 随机药丸）。 */
    if (run.layer % D().MILESTONE_EVERY === 0) {
      /* 第 1 项：10 的倍数层（该层最后一场）里程碑奖励提高稀有度期望 —— 重掷 3 次取最好的一档 */
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
      run.shop = makeShop(run);
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
    run.plan = buildPlan(run.layer, run.salt, true);
    run.idx = 0;
    run.choices = null;
    run.restShopUsed = false;
    layerStartHeal(run, mode);
  }

  // ---------- 场间 4 选 1 ----------
  /** 第 2 项：unique（扩容类）buff 一局只能拿一次 —— 拿过就不再进任何池子。 */
  function poolFilter(run, buff) {
    if (!buff.unique) return true;
    if ((run.pickBuffIds || []).includes(buff.id)) return false;
    if ((run.permSlotIds || []).includes(buff.id)) return false;
    /* 本轮第 4 项：已经挂着「待选取」的同名增益也别再给（免得同时攒两份待选取）。 */
    if (run.pendingPick && run.pendingPick.buffId === buff.id) return false;
    return !(run.permanent || []).some((b) => b.id === buff.id);
  }
  function rollChoices(mode, run) {
    const TD = D();
    /* 挑战塔只用 towerPool（限次类、无 endlessOnly、无 towerOnly 之外的杂项）。 */
    const pool = mode === 'tower' ? TD.towerPool : TD.endlessPool;
    const picked = [];
    const taken = new Set();
    const available = (rarity) => pool.filter((b) => b.rarity === rarity && !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));
    /* 本轮第 8 项：每次多选一**必定**有一张限次增益（「接下来 N 场」那类），
     * 让每次选择都有「现在立刻变强」这个选项，而不是三张全是永久/即时。
     * 排除 N08「补给」—— 它是单场开局回血的一次性卡，不算真正的限次增益。 */
    const limitedLeft = () => pool.filter((b) => b.kind === 'limited' && b.id !== 'N08' &&
      !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));
    for (let slot = 0; slot < 3; slot++) {
      let rarity = rollRarity();
      let list = available(rarity);
      if (!list.length) list = pool.filter((b) => !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));   // 该稀有度抽空时放宽
      if (!list.length) break;
      const buff = list[Math.floor(Math.random() * list.length)];
      taken.add(buff.id);
      picked.push({ type: 'buff', id: buff.id });
    }
    // 三张里一张限次都没有 → 用一张限次顶掉最后一张（池子里确实没有才算）
    const hasLimited = picked.some((c) => { const b = TD.BUFF_BY_ID[c.id]; return b && b.kind === 'limited' && b.id !== 'N08'; });
    if (picked.length && !hasLimited) {
      const list = limitedLeft();
      if (list.length) {
        const buff = list[Math.floor(Math.random() * list.length)];
        taken.delete(picked[picked.length - 1].id);
        picked[picked.length - 1] = { type: 'buff', id: buff.id };
        taken.add(buff.id);
      }
    }
    /* 需求 1：去掉「紧急包扎」这张即时回血卡 —— 回血统一走「补给」(N08) 限次增益。
     * 原来这里固定塞一张 heal 卡，玩家在四个选项里必然看到一个「立即回 50% 血」的按钮；
     * 现在四个位置全是真正的增益，其中「补给」就是那个「下一场开局回 50%」的选择。 */
    return picked;
  }
  function ownable(run, buff) {
    const owned = ownedEntry(run, buff.id);
    if (!owned) return true;
    return buff.stackable === true && owned.stacks < D().STACK_MAX;   // 同名唯一，可叠层例外
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
    /* 需求：获取增益也算分（按稀有度）。 */
    const gained = res.buff || D().BUFF_BY_ID[choice.id];
    const pts = scoreBuffAcquire(run, gained);
    run.choices = null;
    save();
    return Object.assign({}, res, pts ? { score: pts } : null,
      { achievements: takeAchievementToasts(run) });
  }
  /** 需求 3：烙印加成的实际生效值 = 基础 × 0.5（未损毁）+ 已损毁的永久份。
   *  未损毁时半效；损毁时把「基础」整份转成永久（burned += base），于是变成 1.5×基础，
   *  相对半效状态正好翻三倍，且此后不再受烙印是否还在影响。 */
  function fragileBonus(run, key) {
    const base = Math.max(0, Number((run.fragileBase || {})[key]) || 0);
    const burned = Math.max(0, Number((run.fragileBurned || {})[key]) || 0);
    return { base: base, burned: burned, value: base * 0.5 + burned };
  }
  /** 需求 3：每条烙印一个独立的确定性 PRNG（由本局 salt + 烙印 id 派生）。
   *  原来所有烙印共用 Math.random()，同一次判定会把好几条一起打碎。 */
  function fragileRoll(run, id, pct) {
    run.fragileSeeds = Object.assign({}, run.fragileSeeds || {});
    let st = run.fragileSeeds[id];
    if (!Number.isFinite(st)) {
      /* 种子来源：本局 salt（无尽有、挑战塔没有）+ 当前层 + 烙印 id。
       * 挑战塔的 run 没有 salt，如果只用 id 派生，各烙印的初始状态会**完全相同** ——
       * 第一次判定就会「一碎全碎」。加上层数就能保证每层不同、每条烙印不同。 */
      const key = String(run.salt == null ? 'run' : run.salt) + '#' + (Number(run.layer) || 0) + '#' + id;
      let h = 0x811c9dc5;
      for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      h ^= (Date.now() & 0xffff) << 13;              // 每次开局再抖一次，避免跨局完全一致
      st = h >>> 0 || 1;
    }
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    run.fragileSeeds[id] = st;
    return (st / 4294967296) * 100 < pct;
  }
  /** 「获得这个增益时」立刻要结算的东西（新增与叠加两条路径都要走）。
   *  · 易碎烙印：登记基础加成（存在时半效、损毁后全额并本局永久保留）
   *  · 生命上限增益：按字面「回复等量生命」—— 新上限比旧上限多出来的部分补进当前血量
   *    （原来只保持百分比，玩家看到血条没动就以为没生效）。比例推一下与上限无关：
   *      carry' = (carry + m) / (1 + m)   （m 为 maxHpMul，负值则同步缩血） */
  function applyBuffOnAcquire(run, buff) {
    /* 需求 3：易碎烙印的加成分两段 —— 烙印**还在**时只吃一半；
     * **损毁后**升为全额并本局永久保留。这里只登记「基础加成」，实际值在 fragileBonus() 现算。 */
    if (buff.mods && buff.mods.fragileStat) {
      const key = buff.mods.fragileStat;
      run.fragileBase = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBase || {});
      run.fragileBurned = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBurned || {});
      run.fragileBase[key] += Math.max(0, Number(buff.mods.fragilePct) || 0);
    }
    /* 需求 3：每条烙印有自己的碎裂随机数种子（不再共用 Math.random）。 */
    if (buff.mods && buff.mods.fragileBreakPct) {
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
    /* 需求 2：全场五折按**份数**累计 —— 放在这里才能覆盖「新拿到」与「叠加再拿一次」
     * 两条路径（原来只写在 addBuff 的新增分支，第二次拿只是叠层，份数不会涨）。 */
    if (buff.mods && buff.mods.shopDiscount) {
      run.shopDiscount = Math.max(0, Math.floor(Number(run.shopDiscount) || 0)) + 1;
    }
    if (buff.mods && buff.mods.maxHpMul) {
      const m = Number(buff.mods.maxHpMul) || 0;
      if (m !== 0) run.carry = clamp01((clamp01(run.carry) + m) / (1 + m));
    }
  }
  /** 加一个 buff。永久类要过 5 格上限（满则返回 needsReplace，由界面选一个替换）。 */
  function addBuff(run, id, replaceId) {
    const buff = D().BUFF_BY_ID[id];
    if (!buff) return { ok: false, msg: '没有这个增益' };
    if (buff.kind === 'instant') { const r = applyInstant(run, buff); logBuff(run, id, 'instant', { detail: instantDetail(buff) }); return r; }
    /* 选取型（武器/技能强化）同样不占槽、不触发替换：立即登记，等界面做三选一。 */
    if (buff.mods && (buff.mods.pickWeaponPct || buff.mods.pickSkillPct)) {
      if ((run.pickBuffIds || []).includes(buff.id)) return { ok: false, msg: '这类选取增益一局只能获得一次。' };
      /* 第 4 项（两轮合并后的口径）：**拿到就登记** pickBuffIds —— 这样它不会在池子里被
       * 反复刷到（上一轮反馈「还是重复刷到神兵淬炼」）。
       * 同时保留 pendingPick：即使此刻没有武器/技能可选，这次强化也不会白拿 ——
       * 界面会提示「先留着」，之后拿到武器/技能时自动弹三选一。 */
      run.pickBuffIds = (run.pickBuffIds || []).concat([buff.id]);
      run.pendingPick = buff.mods.pickWeaponPct
        ? { kind: 'weapon', buffId: buff.id, pct: buff.mods.pickWeaponPct }
        : { kind: 'skill', buffId: buff.id, pct: buff.mods.pickSkillPct };
      logBuff(run, id, 'get', { detail: '选取型（待选目标）' });
      save();
      return { ok: true, pendingPick: run.pendingPick };
    }
    /* 本轮第 1 项：虚空铭文（传奇·隐藏选取型）—— 选已有的一个永久增益给它附魔免占位。
     * 与武器/技能选取同款：不占槽、不触发替换，立即登记 pendingPick 等界面选。 */
    if (buff.mods && buff.mods.pickPermanentFree) {
      if ((run.pickBuffIds || []).includes(buff.id)) return { ok: false, msg: '这类选取增益一局只能获得一次。' };
      run.pickBuffIds = (run.pickBuffIds || []).concat([buff.id]);   // 第 4 项：拿到即登记，不重复刷到
      run.pendingPick = { kind: 'permBuff', buffId: buff.id };
      logBuff(run, id, 'get', { detail: '虚空铭文（待选永久增益）' });
      save();
      return { ok: true, pendingPick: run.pendingPick };
    }
    /* 扩容类（+1/+2 槽位）要先于「永久栏已满」判断处理：它不占槽、也不会触发替换。 */
    /* 第 2 项：扩容类 buff（+1/+2 永久槽位）立即生效 —— 加名额、不占自己的槽、一局只能拿一次。 */
    if (buff.mods && buff.mods.permSlot) {
      if ((run.permSlotIds || []).includes(buff.id)) return { ok: false, msg: '这类扩容增益一局只能获得一次。' };
      run.permSlots = Math.max(0, Number(run.permSlots) || 0) + Number(buff.mods.permSlot);
      run.permSlotIds = (run.permSlotIds || []).concat([buff.id]);
      logBuff(run, id, 'get', { detail: '永久槽位 +' + Number(buff.mods.permSlot) });
      return { ok: true, granted: buff.mods.permSlot };
    }
    const listKey = buff.kind === 'permanent' ? 'permanent' : 'limited';
    const list = run[listKey] || (run[listKey] = []);
    const owned = list.find((b) => b.id === id);
    if (owned) {
      owned.stacks = Math.min(D().STACK_MAX, owned.stacks + 1);
      /* 塔内限次增益不累加次数（就是「下一场」这一份），但可以叠层提高强度。 */
      if (buff.kind === 'limited') { if (run.mode !== 'tower') owned.uses += buff.uses || 1; owned.on = true; }
      /* 本轮修复：重复获得同名增益（叠加）时也要执行「获得时结算」——
       * 原来这里直接 return，于是第二份易碎烙印不加属性、第二份生命上限增益不回血。 */
      applyBuffOnAcquire(run, buff);
      logBuff(run, id, 'stack', { stacks: owned.stacks, detail: '叠到 ×' + owned.stacks });
      return { ok: true, buff, stacks: owned.stacks };
    }
    /* 满格判定按**加入后的占用**：占位类增益会 +1，所以只要 permUsed + 1 > 上限就得替换。
     * 免占位的（虚空铭文附魔过的）不占位，不受此限。 */
    if (buff.kind === 'permanent' && permUsed(run) + 1 > permSlots(run)) {
      if (!replaceId) return { ok: false, needsReplace: true, buff, msg: '永久增益已满，先选一个替换掉' };
      const at = list.findIndex((b) => b.id === replaceId);
      if (at < 0) return { ok: false, needsReplace: true, buff, msg: '要替换的增益不存在' };
      /* 换掉一个**免占位**的不会腾出槽位（它本来就不占），所以换它没有意义 —— 明确拒绝，
       * 免得玩家点了「替换」却发现还是买不了。 */
      if ((run.slotFreeIds || []).indexOf(replaceId) >= 0) {
        return { ok: false, needsReplace: true, buff, msg: '【' + replaceId + '】已被虚空铭文附魔、不占槽位，换它腾不出位置' };
      }
      list.splice(at, 1);
      /* 第 3 项：被替换掉的成长类增益，把它的累计一起清掉。 */
      resetGrowth(run, replaceId);
      run.slotFreeIds = (run.slotFreeIds || []).filter((x) => x !== replaceId);
      logBuff(run, replaceId, 'lose', { detail: '被【' + buff.name + '】替换掉' });
    }
    /* 第 1 项修复：全场五折是 permanent 类，addBuff 原来只对 instant 走 applyInstant，
     * 所以标记一直没被点亮 —— 这里在加入时就把折扣标记打开。 */
    applyBuffOnAcquire(run, buff);   // 需求 2：折扣份数在 applyBuffOnAcquire 里累计（叠加路径也走）
    // 第 1 项：拿到永久生命上限增益时，把它折算成 run.hpBonus（之后卖掉也保留）
    if (buff.kind === 'permanent' && buff.mods && buff.mods.maxHpMul) {
      run.hpBonus = (run.hpBonus || 0) + buff.mods.maxHpMul;
    }
    /* 塔内一切限次增益都只服务下一场战斗。 */
    const towerLimitedUses = run.mode === 'tower' ? 1 : (buff.uses || 1);
    list.push(buff.kind === 'limited'
      ? { id, stacks: 1, uses: towerLimitedUses, on: true }
      : { id, stacks: 1 });
    /* 自检：加入后占用不应超过上限（前面已按「加入后占用」判定过，正常不会触发）。 */
    if (buff.kind === 'permanent' && permUsed(run) > permSlots(run)
        && typeof console !== 'undefined' && console.warn) {
      console.warn('[tower] 永久增益占用槽位超上限：' + permUsed(run) + '/' + permSlots(run) + '（id=' + id + '）');
    }
    logBuff(run, id, 'get', { detail: buff.kind === 'permanent' ? '永久' : (run.mode === 'tower' ? '下一场战斗' : ('限次 ' + towerLimitedUses + ' 场')) });
    return { ok: true, buff };
  }
  /** 瞬时经济 buff（立即进货 / 立即得试炼币 / 全场五折）。 */
  function applyInstant(run, buff) {
    const m = buff.mods || {};
    const out = { ok: true, buff, instant: true };
    if (m.instantCoins) { run.coins = Math.max(0, (run.coins || 0) + m.instantCoins); out.coins = m.instantCoins; }
    /* 本轮第 3 项：即时削弱 —— 累加到本局全局，下一场 buildFoe 起对所有敌人生效。 */
    if (m.enemyMaxHpDown) {
      run.enemyMaxHpDown = Math.min(0.6, Math.max(0, Number(run.enemyMaxHpDown) || 0) + Number(m.enemyMaxHpDown));
      out.enemyMaxHpDown = run.enemyMaxHpDown;
    }
    /* 需求 3：立即获得重新挑战币（普通 1 枚 / 史诗 5 枚）。 */
    if (m.instantRetry) {
      run.retryToken = Math.max(0, Number(run.retryToken) || 0) + Number(m.instantRetry);
      out.retryToken = run.retryToken;
    }
    if (m.shopDiscount) {
      run.shopDiscount = Math.max(0, Math.floor(Number(run.shopDiscount) || 0)) + 1;
      out.discount = m.shopDiscount;
    }
    if (m.openShop) {
      // 立刻开一次商店：不动 5 层一次的结算点节奏（phase 用完即恢复）
      run.shop = makeShop(run);
      run.phase = 'shop';
      out.shop = true;
    }
    save();
    return out;
  }
  /** 限次 buff 的开关（第 1 项）。关掉就不生效、也不消耗次数。 */
  function toggleLimited(id, on) {
    const run = endless().run;
    if (!run) return { ok: false };
    const b = (run.limited || []).find((x) => x.id === id);
    if (!b) return { ok: false };
    b.on = on === undefined ? b.on === false : !!on;
    save();
    return { ok: true, id, on: b.on };
  }
  // ---------- 无尽：试炼币商店 ----------
  function makeShop(run) {
    /* 需求 2：全场五折（E04）进店**必须被消耗掉**。
     *
     * 原来有两处会让它「消耗不掉」：
     *   a) 是从**货架**买到 E04 的时候 —— 那家店已经建好了（discount 早就定过），
     *      标记留到下一家店才算数，玩家看到的是「买了没反应」；
     *   b) 叠加获得（再拿一次 E04）时 shopDiscount 只是被再置一次 true，
     *      没有任何「份数」信息，两份也只打一次折。
     * 现在改成计数：run.shopDiscount 是**待使用的折扣份数**，
     * makeShop 一次消耗 1 份（多份可以覆盖多家店），而且货架价与刷新价都吃折扣。 */
    const stacks = Math.max(0, Math.floor(Number(run.shopDiscount) || 0));
    const discount = stacks > 0;
    if (discount) run.shopDiscount = stacks - 1;      // 消耗 1 份
    return { layer: run.layer, slots: rollShopSlots(run), retrySold: false, rerollFree: true, discount,
      rerollCount: 0, rerollPaid: 0 };
  }
  /* 需求：刷新**不设保底货品**，只把稀有度期望往上推。
   * 做法见 tower-data.js 的 tiltWeights()：把稀有度权重按 w_i × p^i 重新归一化，
   * p 由这次刷新实际付掉的钱决定（每 10 币 ×1.25）。整架货一起变好，不出现结构突变。 */
  function rollShopSlots(run, paid) {
    const pool = D().shopPool || D().endlessPool, slots = [], taken = new Set();
    /* 这次货架的稀有度权重：paid 越大，权重越往高稀有度倾斜（无保底）。 */
    const weights = D().tiltWeights(D().rerollTilt(paid || 0));
    for (let i = 0; i < D().SHOP.slots; i++) {
      /* 本轮第 5 项：商店也要过 poolFilter —— 原来只过 ownable，于是
       * 「一局只能获得一次」的扩容类（扩容背包/仓库钥匙）会被反复刷上货架，
       * 买第二次时 addBuff 拒绝、币却照扣（静默吞币）。 */
      const want = rollRarity(weights);
      const avail = (r) => pool.filter((b) => b.rarity === r && !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));
      /* 回退顺序：想要的稀有度 → 高稀有度 → 低稀有度 → 任意。
       * 原来直接回退到「任意一件」，而最不缺的就是普通货，于是摇到的高稀有度
       * 大量被普通货稀释（实测史诗期望只有理论值的 6 成），倾斜形同虚设。 */
      let list = avail(want);
      for (const r of [want + 1, want + 2, want + 3, want - 1, want - 2, want - 3]) {
        if (list.length) break;
        if (r < 0 || r > 3) continue;
        list = avail(r);
      }
      if (!list.length) list = pool.filter((b) => !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));
      if (!list.length) break;
      const buff = list[Math.floor(Math.random() * list.length)];
      taken.add(buff.id);
      /* 需求 2：价格在开店时摇一次并固定到槽位上 —— 界面显示的就是实际扣费的价。 */
      slots.push({ id: buff.id, sold: false, price: D().rollShopPrice(D().shopPrice(buff)) });
    }
    /* 本轮第 5 项：商店 5 格也保证至少有一张限次增益（与场间三选一同一个口径：
     * 「接下来 N 场」那类，排除一次性开局的补给 N08）。 */
    const isLimited = (bid) => { const b = D().BUFF_BY_ID[bid]; return !!b && b.kind === 'limited' && b.id !== 'N08'; };
    if (slots.length && !slots.some((sl) => isLimited(sl.id))) {
      const cand = pool.filter((b) => b.kind === 'limited' && b.id !== 'N08' && !taken.has(b.id) && ownable(run, b) && poolFilter(run, b));
      if (cand.length) {
        const buff = cand[Math.floor(Math.random() * cand.length)];
        taken.delete(slots[slots.length - 1].id);
        slots[slots.length - 1] = { id: buff.id, sold: false, price: D().rollShopPrice(D().shopPrice(buff)) };
        taken.add(buff.id);
      }
    }
    return slots;
  }
  function shopState() {
    const run = endless().run;
    if (!run || !run.shop) return null;
    return { coins: run.coins, layer: run.shop.layer, rerollFree: run.shop.rerollFree,
      rerollCount: Number(run.shop.rerollCount) || 0,
      rerollNextPrice: D().rerollPriceAt(Number(run.shop.rerollCount) || 0),
      rerollLastPaid: Number(run.shop.rerollPaid) || 0,
      retrySold: !!run.shop.retrySold, retryPrice: D().SHOP.retryPrice,
      retryToken: Math.max(0, Number(run.retryToken) || 0),
      rerollPrice: D().SHOP.rerollPrice,
      slots: run.shop.slots.map((s) => { const b = D().BUFF_BY_ID[s.id];
        /* 本轮第 2 项：已经拥有的**可叠加**增益，界面上要能高光提示「再买一份能叠层」。 */
        const mine = (run.permanent || []).find((x) => x.id === s.id) || (run.limited || []).find((x) => x.id === s.id);
        return { id: s.id, sold: s.sold, name: b.name, desc: b.desc, rarity: b.rarity, kind: b.kind, price: shopPriceOf(b, s),
          ownedStacks: mine ? (mine.stacks || 1) : 0, stackable: b.stackable === true }; }) };
  }
  /* 本轮第 9 项：挥金如土（C36）—— 每消费 step 试炼币，随机 +1 力/敏/速 并 +5 生命上限。
   * 消费点有三处（买增益 / 买回血 / 刷新），统一从这里过。 */
  function addShopSpend(run, amount, flags) {
    const spend = Math.max(0, Number(amount) || 0);
    if (!(spend > 0)) return null;
    /* flags.assumeOwned：本次花费**本身**就把挥金如土买到手了（买 C36 那一笔），
     * 所以即使此刻还没入账也要累计 —— 这是需求「购买该 buff 的价格会吃到其加成」。 */
    const assumeOwned = !!(flags && flags.assumeOwned);
    if (!assumeOwned && !stacksOf(run, 'C36')) return null;   // 没这个增益就不累计
    const mm = D().BUFF_BY_ID.C36.mods, step = Math.max(1, Number(mm.shopSpendStep) || 20);
    run.shopSpend = Math.max(0, Number(run.shopSpend) || 0) + spend;
    /* 本轮第 2 项：改成「力+1 / 敏+1 / 速+1 / 生命上限+5」**四项里随机一项**，
     * 不再是「随机一项属性 + 每次都额外加 5 血」。 */
    const opts = ['power', 'agility', 'speed', 'hp'];
    const gained = [];
    while (run.shopSpend >= step) {
      run.shopSpend -= step;
      const key = opts[Math.floor(Math.random() * opts.length)];
      run.spendGain = Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, run.spendGain || {});
      run.spendGain[key] += key === 'hp'
        ? Math.max(0, Number(mm.shopSpendHp) || 5)
        : Math.max(0, Number(mm.shopSpendStat) || 1);
      gained.push(key);
    }
    return gained.length ? { gained, spendGain: Object.assign({}, run.spendGain) } : null;
  }
  function buyShopSlot(index, replaceId) {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false };
    const slot = run.shop.slots[index];
    if (!slot || slot.sold) return { ok: false };
    const buff = D().BUFF_BY_ID[slot.id];
    // 永久增益满 5 格时先让玩家去替换（商店里不弹替换面板，避免一次点出两层交互）
    const permanentFull = buff.kind === 'permanent' && permUsed(run) >= permSlots(run) &&
      !(run.permanent || []).some((b) => b.id === buff.id);
    if (permanentFull && !replaceId) {
      // 第 1 项：不再把玩家打发回主界面 —— 直接把替换目标的选择交给界面
      return { ok: false, needsReplace: true, buff, msg: '永久增益已满 5 个，请选择要替换掉的增益。' };
    }
    const price = shopPriceOf(buff, slot);
    if (run.coins < price) return { ok: false, msg: '试炼币不足。' };
    run.coins -= price;
    slot.sold = true;
    /* 需求：**购买挥金如土本身的花费也要吃到它自己的加成**。
     * 所以顺序必须是「先入账 → 再按最终是否拥有 C36 来记账」：
     *   · 原来在 addBuff 之前记账，买 C36 时此刻还没拥有 → 直接 return，这笔钱白花
     *   · 而且 addBuff(C36) 会把 run.shopSpend 清零（新持有的成长从 0 起算），
     *     先记的账也会被清掉 —— 两个原因叠加，之前买它自身的钱必然不计。 */
    const res = addBuff(run, slot.id, replaceId);
    if (!res || !res.ok) {
      /* 第 5 项：addBuff 拒绝（例如这类增益一局只能拿一次）时把钱退回去，
       * 并且把原因告诉玩家 —— 原来照扣币、什么都不给。 */
      run.coins += price;
      save();
      return { ok: false, msg: (res && res.msg) || '这件增益现在买不了。' };
    }
    /* 挥金如土：按**最终是否拥有** C36 记账，于是买它本身的那笔也算进去。 */
    const spend = addShopSpend(run, price, { assumeOwned: stacksOf(run, 'C36') > 0 });
    /* 需求：商店买到的增益也算分。 */
    const pts = scoreBuffAcquire(run, buff);
    save();
    return { ok: true, buff, price, instant: !!res.instant, score: pts,
      shopSpend: spend || undefined };
  }
  /* 兼容旧调用名：以前这里卖「治疗泉水」，现在同一位置是重新挑战币，
   * 语义仍然是「每次商店限购 1 份」，所以旧的 buyShopHeal 直接指向新实现
   * （tools/ 里的历史探针脚本还在用它）。 */
  function buyShopHeal() { return buyRetryToken(); }
  /** 需求 1：试炼商店左下角 —— 花 50 币买 1 枚重新挑战币（每次商店限购 1 枚，可累计）。 */
  function buyRetryToken() {
    const run = endless().run;
    if (!run || !run.shop || run.shop.retrySold) return { ok: false, msg: '这家店已经买过了。' };
    const price = D().SHOP.retryPrice;
    if (run.coins < price) return { ok: false, msg: '试炼币不足。' };
    run.coins -= price;
    addShopSpend(run, price);                               // 挥金如土：消费也算
    run.shop.retrySold = true;
    run.retryToken = Math.max(0, Number(run.retryToken) || 0) + 1;
    save();
    return { ok: true, left: run.retryToken, price };
  }
  /**
   * 需求 1：刷新货架。价格逐次递增（首次免费，之后 15/25/35/45…），
   * 且**这次实际付掉的钱越多，下一页的稀有度期望越高**（无保底，见 TowerData.tiltWeights）。
   */
  function rerollShop() {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false, msg: '商店还没开张。' };
    const shop = run.shop;
    const free = !!shop.rerollFree;
    /* 需求 2 连带修复：刷新价也要享受「全场五折」——
     * 原来只有货架价走 shopPriceOf()，刷新价是全价，同一家店里两套价格口径。 */
    const raw = D().rerollPriceAt(Number(shop.rerollCount) || 0);
    const price = free ? 0 : (shop.discount ? Math.max(1, Math.round(raw * 0.5)) : raw);
    if (!free) {
      if (run.coins < price) return { ok: false, msg: '试炼币不足（本次刷新需要 ' + price + ' 币）。' };
      run.coins -= price;
      addShopSpend(run, price);                             // 第 9 项：刷新也算消费
    }
    shop.rerollFree = false;
    shop.rerollCount = (Number(shop.rerollCount) || 0) + 1;
    shop.rerollPaid = price;                                // 记下这次付了多少 → 决定下一页质量
    shop.slots = rollShopSlots(run, price);
    save();
    return { ok: true, paid: price, expect: D().rerollExpectation(price), nextPrice: D().rerollPriceAt(shop.rerollCount) };
  }
  /** 卖出一个已拥有的本层/跨层 buff（回收价 = 买入价 40%）；击杀/层数成长累积值保留。 */
  /** 第 1 项：全场五折 —— 进店时把价格乘上折扣并消耗掉这个标记。 */
  function shopPriceOf(buff, slot) {
    const run = endless().run;
    /* 需求 2：价格优先取「开店时摇好的那一份」（slot.price）；
     * 没有（旧档 / 临时构造的槽位）就退回基准价。 */
    const base = slot && Number.isFinite(Number(slot.price)) ? Number(slot.price) : D().shopPrice(buff);
    const discounted = !!(run && run.shop && run.shop.discount);   // 只看当前这家店有没有折扣标记
    return discounted ? Math.max(1, Math.round(base * 0.5)) : base;
  }
  /** 第 3 项：调试用 —— 无尽塔专属的「立即获得 / 失去」任意一个增益（不消耗选择次数）。 */
  function debugGrantBuff(id) {
    const run = endless().run;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    const buff = D().BUFF_BY_ID[id];
    if (!buff) return { ok: false, msg: '没有这个增益。' };
    const res = addBuff(run, id);
    save();
    return { ok: !!(res && res.ok), buff, res };
  }
  function debugLoseBuff(id) {
    const run = endless().run;
    if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
    /* 本轮第 4 项：选取型在「落地前」只挂在 pendingPick 上（不在 pickBuffIds 里），
     * 所以失去它应当表现为「取消这次待选取」并返回成功。 */
    if (run.pendingPick && run.pendingPick.buffId === id) {
      run.pendingPick = null;
      /* 第 4 项：拿到时已登记过「一局一次」，取消待选取就要把它一起撤掉，
       * 否则这个增益既用不上、又永远刷不到了。 */
      run.pickBuffIds = (run.pickBuffIds || []).filter((x) => x !== id);
      if (id === 'C32') run.weaponBoost = null;
      if (id === 'C33') run.skillBoost = null;
      logBuff(run, id, 'lose', { detail: '调试台取消待选取' });
      save();
      return { ok: true, id, cancelledPick: true };
    }
    for (const list of [run.permanent || [], run.limited || [], run.permSlotIds || [], run.pickBuffIds || []]) {
      const i = (list || []).findIndex((b) => (typeof b === 'string' ? b === id : b.id === id));
      if (i >= 0) {
        const removed = list[i];
        list.splice(i, 1);
        resetGrowth(run, id);                                                      // 第 3 项：成长累计清零
        /* 第 1 / 4 项：任何情况下都把「附魔免占位」与「一局一次」的登记一起撤掉 ——
         * 原来只在命中 pickBuffIds 那条分支里撤，若在别的名单里先命中就会残留登记，
         * 于是「失去之后再也刷不到」。 */
        run.slotFreeIds = (run.slotFreeIds || []).filter((x) => x !== id);
        run.pickBuffIds = (run.pickBuffIds || []).filter((x) => x !== id);
        run.permSlotIds = (run.permSlotIds || []).filter((x) => x !== id);
        // 选取型被移除时，连带清掉它强化过的武器/技能与待选取状态
        if (id === 'C32') run.weaponBoost = null;
        if (id === 'C33') run.skillBoost = null;
        if (run.pendingPick && run.pendingPick.buffId === id) run.pendingPick = null;
        if (list === run.permanent && removed && removed.id === id) { /* 永久类移除后不回落生命上限（第 1 项规则） */ }
        logBuff(run, id, 'lose', { detail: '调试台失去' });
        save();
        return { ok: true, id };
      }
    }
    return { ok: false, msg: '本局没有这个增益。' };
  }
  /** 选取型 buff 的三选一候选：从玩家已有的武器/技能里随机挑最多 3 个。 */
  function pickCandidates(kind) {
    const run = endless().run;
    if (!run) return [];
    /* 本轮第 1 项：虚空铭文选的是「已有的永久增益」（隐藏型不参与，它们本就不占槽）。 */
    if (kind === 'permBuff') {
      const pool = (run.permanent || [])
        .map((b) => ({ id: b.id, buff: D().BUFF_BY_ID[b.id], stacks: b.stacks || 1 }))
        .filter((x) => x.buff && !x.buff.hidden);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      return pool.slice(0, 3).map((x) => ({ id: x.id, name: x.buff.name, rarity: x.buff.rarity, stacks: x.stacks }));
    }
    const list = kind === 'skill'
      ? (State.mySkills ? State.mySkills() : [])
      : (State.myWeapons ? State.myWeapons() : []);
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
    const pend = run.pendingPick;
    if (!pend || pend.kind !== kind) return { ok: false, msg: '现在没有待选取的强化。' };
    /* 本轮第 1 项：虚空铭文落地 —— 记进 slotFreeIds，permUsed() 之后就会把它排除。 */
    if (kind === 'permBuff') {
      if (!(run.permanent || []).some((b) => b.id === id)) return { ok: false, msg: '你还没有这个永久增益。' };
      run.slotFreeIds = (run.slotFreeIds || []).concat([id]).filter((v, i, a) => a.indexOf(v) === i);
      /* 第 4 项：落地才算用掉。这里也去重 —— 玩家存档里出现过 pickBuffIds 重复登记
       * （同一 id 出现两次），虽然逻辑上无害，但会让「一局一次」的名单越来越脏。 */
      run.pickBuffIds = (run.pickBuffIds || []).concat([pend.buffId || 'C37']).filter((v, i, a) => a.indexOf(v) === i);
      run.pendingPick = null;
      save();
      return { ok: true, kind, id, slotFree: true };
    }
    const key = kind === 'skill' ? 'skillBoost' : 'weaponBoost';
    run[key] = run[key] || {};
    run[key][Number(id)] = Math.max(Number(run[key][Number(id)]) || 0, pend.pct);
    /* 本轮第 4 项：真正选定了才算「一局一次」用掉（原来在拿到的时候就登记了）。 */
    if (pend.buffId) run.pickBuffIds = (run.pickBuffIds || []).concat([pend.buffId]).filter((v, i, a) => a.indexOf(v) === i);
    run.pendingPick = null;
    save();
    return { ok: true, kind, id: Number(id), pct: pend.pct };
  }
  /** 永久增益槽位数：基础 5 + 扩容类 buff 给的名额。 */
  function permSlots(run) { return (D().PERMANENT_SLOTS || 5) + Math.max(0, Number(run && run.permSlots) || 0); }
  /** 本轮第 1 项：**实际占用**的永久槽位数 = 拥有数 − 被「虚空铭文」附魔免占位的数量。
   *  槽位判断、面板计数、C34「空槽换攻击」全部走这里，避免三处各算一套。 */
  function permUsed(run) {
    const list = (run && run.permanent) || [];
    const free = ((run && run.slotFreeIds) || []).filter((id) => list.some((b) => b.id === id));
    return Math.max(0, list.length - free.length);
  }
  /**
   * 永久增益列表的**校验（不裁剪）** —— bug 修复。
   *
   * 原来 normalizeRun 用 `slice(0, permSlots)` 按**数组长度**裁剪，而 addBuff 的
   * 满格判断按 `permUsed`（已扣掉虚空铭文免占位的那些）。口径不一致就会丢东西：
   *   上限 8、占用 7/8、其中 1 个免占位（数组长度 8）→ addBuff 认为没满、正常推入
   *   → 长度 9 → slice(0,8) 把**最后一项（刚拿到的那份）**切掉
   *   → 玩家看到「拿到了又直接消失」（实测复刻到：C03 / C45 都这样没了）。
   *
   * 现在上限的维护**收口在 addBuff**（加入前按「加入后占用是否超上限」判定），
   * 这里只做校验：真超了就告警，但**绝不丢弃玩家已有的增益**。
   */
  function repairPermanentSlots(run, list) {
    const cap = permSlots(run);
    const used = permUsed(run);
    if (used > cap && typeof console !== 'undefined' && console.warn) {
      console.warn('[tower] 永久增益占用槽位超过上限：' + used + '/' + cap +
        '（列表 ' + list.length + ' 项，含免占位 ' + (list.length - used) + ' 项）—— 保留不丢弃，请检查 addBuff 的满格判定');
    }
    return list;
  }
  /** 本轮第 4 项：**当前**血量上限（血条悬停显示用）。
   * 不直接用「上一场开战时的 maxHp」，是因为两次战斗之间玩家可能刚拿了增益 ——
   * 那样悬停会显示过期数字。这里按 adjustMe 的同一个公式现算：
   *   基础上限 ×(1 + 增益 maxHpMul + 永久 hpBonus) ×本层削弱 + 固定加成（以战养战 / 挥金如土）。
   * 基础上限由 adjustMe 每场记到 run.baseMaxHp（是「未加塔 buff」的那一份）。 */
  function currentMaxHp(run) {
    const base = Number(run && run.baseMaxHp) || 0;
    if (!(base > 0)) return 0;
    const agg = aggregate(run, { hero: false, poolNpc: false, elite: false });
    const dMaxHp = ((run.debuffs || []).filter((d) => d.kind === 'maxHp'))
      .reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
    const stickyHp = Math.max(0, Number(run.hpBonus) || 0);
    const flat = Math.max(0, Number(run.winHpFlat) || 0) +
      (run.spendGain ? Math.max(0, Number(run.spendGain.hp) || 0) : 0);
    return Math.max(1, Math.round(base * (1 + agg.maxHpMul + stickyHp) * dMaxHp) + flat);
  }
  /** 需求 3：易碎烙印的损毁判定（每场战斗一次，默认 6%）。
   * 每条烙印有**自己的随机序列**（fragileRoll）；损毁后该烙印的基础加成整份转为
   * 本局永久保留（fragileBurned），所以「损毁」是升级而不是削弱。 */
  function rollFragileBuffs(run) {
    const broken = [];
    run.limited = (run.limited || []).filter((b) => {
      const def = D().BUFF_BY_ID[b.id];
      const pct = def && def.mods && def.mods.fragileBreakPct;
      if (!pct || b.on === false) return true;
      /* 需求 3：每条烙印用自己的随机序列，互不共用 Math.random。 */
      if (fragileRoll(run, b.id, Number(pct))) {
        broken.push(def.name);
        const key = def.mods.fragileStat;
        if (key) {
          run.fragileBurned = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBurned || {});
          run.fragileBurned[key] = Math.max(0, Number(run.fragileBurned[key]) || 0) +
            Math.max(0, Number(def.mods.fragilePct) || 0);
        }
        logBuff(run, b.id, 'break', { detail: '易碎损毁（升级为全额并永久保留）' });
        return false;
      }
      return true;
    });
    return broken;
  }
  /** 本轮第 3 项：卖出/失去**成长类**增益时，把它累计出来的运行态一并清零 ——
   *  再买回来是从 0 重新长，而不是接着上次的进度（吞噬成长就是典型）。
   *  （叠层数本身在重新获得时本来就是 1；过去漏掉的是这些「跑出来的数值」。） */
  function resetGrowth(run, id) {
    if (!run) return false;
    if (id === 'C06') run.killPower = 0;
    else if (id === 'C07') run.winMaxHp = 0;   // 原来清的是 killMaxHp（C07 用不到的字段），等于没清
    else if (id === 'C11') run.winHpFlat = 0;
    else if (id === 'C12') run.winPower = 0;
    else if (id === 'C25') run.sellBonus = 0;
    else if (id === 'C36') { run.spendGain = { power: 0, agility: 0, speed: 0, hp: 0 }; run.shopSpend = 0; }
    else {
      /* 第 7 项：烙印被**主动卖掉/换掉/失去**时，才把 sticky 加成收回去
       * （5% 损毁那条路径不走这里，所以损毁不掉加成）。 */
      const def = D().BUFF_BY_ID[id];
      if (def && def.mods && def.mods.fragileStat) {
        /* 主动卖出/被换掉：基础那份收回（损毁得到的永久份保留 —— 那是 6% 判定给的奖励）。 */
        const key = def.mods.fragileStat;
        const pct = Math.max(0, Number(def.mods.fragilePct) || 0);
        run.fragileBase = Object.assign({ power: 0, agility: 0, speed: 0 }, run.fragileBase || {});
        run.fragileBase[key] = Math.max(0, run.fragileBase[key] - pct);
        return true;
      }
      return false;
    }
    return true;
  }
  /** 卖出价：名贵手表这类有固定 sellValue 的按固定值，其它按商店价 40%。 */
  function sellPriceOf(run, buff) {
    const base = buff.mods && buff.mods.sellValue
      ? Number(buff.mods.sellValue)
      : Math.max(1, Math.round(D().shopPrice(buff) * D().SHOP.sellBack));
    /* 本轮第 7 项：战利品账本的累计加成**只加账本自己**。
     * 原来它无差别加到每一个 buff 的卖价上 —— 等于「卖什么都变贵」，
     * 既和文字（只讲自己卖得贵）不符，也让卖杂 buff 变成稳定刷币。
     * 改成只认 C25：账本卖掉/失去后，这个加成自然就不再被任何东西读到（效果随之消失）。 */
    if (buff.id === 'C25' && stacksOf(run, 'C25') > 0) return base + Math.max(0, Math.floor(Number(run.sellBonus) || 0));
    return base;
  }
  function sellBuff(id) {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false };
    const buff = D().BUFF_BY_ID[id];
    if (!buff || buff.kind === 'instant' || buff.hidden) return { ok: false };   // 隐藏型不可出售（只有即时类不留存、无从卖出）
    for (const list of [run.permanent || [], run.limited || []]) {
      const i = (list || []).findIndex((b) => b.id === id);
      if (i >= 0) {
        const gain = sellPriceOf(run, buff);
        list.splice(i, 1);
        resetGrowth(run, id);                                                      // 第 3 项：成长累计清零
        run.slotFreeIds = (run.slotFreeIds || []).filter((x) => x !== id);         // 第 1 项：附魔记录一并清掉
        run.coins += gain;
        logBuff(run, id, 'lose', { detail: '商店卖出 +' + gain + ' 试炼币' });
        save();
        return { ok: true, gain };
      }
    }
    return { ok: false };
  }
  /** 商店逛完：进入结算点（每 5 层的固定流程 商店 → 结算）。 */
  /* 第 4 项：休整点也能进店 —— 层内第 3 场后（5 场层第 4 场后）允许再开一次商店，
   * 货架当场刷新，每层限一次；关店直接回到「继续战斗」，不走 5 层一次的结算点。 */
  function openRestShop() {
    const run = endless().run;
    if (!run || !run.choices) return { ok: false, msg: '只有休整点（每层第 3 场后）能开休整商店。' };
    if (run.restShopUsed) return { ok: false, msg: '本层的休整商店已经用过了。' };
    run.restShopUsed = true;
    run.shop = makeShop(run);
    run.shop.rest = true;
    run.phase = 'shop';
    save();
    return { ok: true };
  }
  /** 第 1 项：往槽位里嵌一颗属性药丸（消耗背包道具，塔内持续 20 场战斗）。 */
  function usePillSlot(key, propId) {
    const run = endless().run;
    if (!run) return { ok: false, msg: '没有进行中的无尽局。' };
    const slotDef = (D().PILL_SLOTS || []).find((x) => x.key === key);
    const eff = D().pillEffect(propId);
    if (!slotDef || !eff || eff.stat !== key) return { ok: false, msg: '这颗药丸和槽位不匹配。' };
    if (!(S().props[propId] > 0)) return { ok: false, msg: '背包里没有这种药丸。' };
    S().props[propId]--;
    run.pillSlots = run.pillSlots || { power: null, agility: null, speed: null };
    run.pillSlots[key] = { id: Number(propId), battles: D().PILL_BATTLES || 20 };
    save();
    return { ok: true, id: Number(propId), battles: D().PILL_BATTLES || 20 };
  }
  function closeShop() {
    /* 关店只结束「这家店的折扣」，不该把**还没用掉的份数**一起清掉
     * （那是玩家花钱买的，下一家店还要用）。 */
    { const r = endless().run; if (r && r.shop) r.shop.discount = false; }
    const run = endless().run;
    if (!run || run.phase !== 'shop') return { ok: false };
    run.phase = run.shop && run.shop.rest ? null : 'checkpoint';   // 休整商店：回战斗；结算商店：去结算点
    save();
    return { ok: true };
  }

  // ---------- 无尽：结算点 ----------
  function checkpointInfo() {
    const run = endless().run;
    if (!run) return null;
    const s = D().endlessSegment(run.layer);
    return { layer: run.layer, score: run.score, coins: run.coins,
      ticketsNow: D().endlessTickets(run.layer),
      ticketsNext: D().endlessTickets((s + 1) * 5),       // 下一结算点（再撑 5 层）的升档面值
      nextCheckpoint: (s + 1) * 5 };
  }
  /** 结算离场：抽奖卷入包，分数入账，本局结束。 */
  function settleEndless() {
    const e = endless(), run = e.run;
    if (!run || run.phase !== 'checkpoint') return { ok: false };
    const tickets = D().endlessTickets(run.layer);
    S().props[TICKET_PROP] = (S().props[TICKET_PROP] || 0) + tickets;
    const out = { ok: true, tickets, score: run.score, layer: run.layer };
    settleScore(run, out);
    e.run = null;
    save();
    return out;
  }
  /** 商店里的「继续挑战」：直接进下一段，不再经过结算点弹窗。 */
  function continueFromShop() {
    const run = endless().run;
    if (!run || run.phase !== 'shop') return { ok: false };
    run.shop = null;
    run.phase = null;
    advanceLayer(run, 'endless');
    save();
    return { ok: true, layer: run.layer };
  }
  /** 商店里的「结算」：等于结算点离场（抽奖卷入包、分数入账）。 */
  function settleFromShop() {
    const run = endless().run;
    if (!run || run.phase !== 'shop') return { ok: false };
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

  // ---------- 放弃 ----------
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
    endless().run = null;
    save();
    return out;
  }

  // ---------- 展示用信息 ----------
  function towerInfo() {
    const t = tower(), s = S();
    const layer = t.maxLayer + 1;
    return { maxLayer: t.maxLayer, nextLayer: layer, books: s.props[BOOK_PROP] || 0,
      gold: D().towerGold(layer), battles: layer % 10 === 0 ? 5 : 4,
      level: D().towerLevel(layer), mult: D().towerMult(layer),
      retry: t.retry || null,
      run: t.run ? { layer: t.run.layer, battleNo: t.run.idx + 1, battleCount: t.run.plan.length, carry: t.run.carry, pot: t.run.pot, failedAt: t.run.failedAt == null ? null : t.run.failedAt,
        choices: t.run.choices ? t.run.choices.slice() : null,
        debuffs: (t.run.debuffs || []).slice(),
        // 第 4 项：挑战塔的血条悬停也显示真实上限
        lastMaxHp: Math.max(0, Number(t.run.lastMaxHp) || 0),
        lastHp: Math.max(0, Number(t.run.lastHp) || 0),
        curMaxHp: currentMaxHp(t.run),
        // 下一场是谁 + 它的机制（选 buff 页要展示「你接下来要打的那个 boss 是什么」）
        next: t.run.plan[t.run.idx] ? Object.assign({ kind: t.run.plan[t.run.idx].kind }, entryInfo(t.run.plan[t.run.idx])) : null } : null,
      preview: preview(layer) };
  }
  function endlessInfo() {
    const e = endless();
    return { best: e.best, weekBest: e.weekBest, bestLayer: e.bestLayer,
      tickets: S().props[TICKET_PROP] || 0,
      run: e.run ? { layer: e.run.layer, score: e.run.score, coins: e.run.coins, carry: e.run.carry,
        battleNo: e.run.idx + 1, battleCount: e.run.plan.length, phase: e.run.phase,
      debuffs: (e.run.debuffs || []).slice(),
        choices: e.run.choices ? e.run.choices.slice() : null,
        next: e.run.plan[e.run.idx] ? Object.assign({ kind: e.run.plan[e.run.idx].kind }, entryInfo(e.run.plan[e.run.idx])) : null,
        bestLayer: e.run.bestLayer, segment: D().endlessSegment(e.run.layer),
        // 第 3 项：无尽主界面也要能提前看到本层对手（和挑战塔同一份预告数据）
        plan: (e.run.plan || []).map((entry) => Object.assign({ kind: entry.kind }, entryInfo(entry))),
        /* 计分扩展：成就列表 + 本局加分流水（界面用它做提示与结算展示）。 */
        achievements: (e.run.achievements || []).slice(),
        scoreLog: (e.run.scoreLog || []).slice(-12),
        deathSaves: Math.max(0, Number(e.run.deathSaves) || 0),
        /* 段位机制已并入环境词缀：这里恒为空（界面统一显示环境）。 */
        mechs: [],
        restShopUsed: !!e.run.restShopUsed,
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
        // 本轮（上一轮第 1 项）虚空铭文：免占位的增益 id + 实际占用槽位数
        slotFreeIds: (e.run.slotFreeIds || []).slice(),
        permUsed: permUsed(e.run),
        // 本轮第 4 项：血条悬停要显示真实上限与当前血量（curMaxHp 是现算的）
        lastMaxHp: Math.max(0, Number(e.run.lastMaxHp) || 0),
        lastHp: Math.max(0, Number(e.run.lastHp) || 0),
        curMaxHp: currentMaxHp(e.run),
        // 本轮第 7 项：易碎烙印留下的「本局永久保留」属性加成
        fragileBase: Object.assign({ power: 0, agility: 0, speed: 0 }, e.run.fragileBase || {}),
        fragileBurned: Object.assign({ power: 0, agility: 0, speed: 0 }, e.run.fragileBurned || {}),
        // 本轮第 3 / 9 项：即时削弱累计 + 挥金如土的消费进度（界面要显示）
        enemyMaxHpDown: Math.max(0, Number(e.run.enemyMaxHpDown) || 0),
        shopSpend: Math.max(0, Number(e.run.shopSpend) || 0),
        spendGain: Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, e.run.spendGain || {}),
        permCap: permSlots(e.run),
        finished: e.run.finished || null,
        pillSlots: Object.assign({}, e.run.pillSlots || {}),
        ticketsIfSettle: D().endlessTickets(e.run.layer) } : null };
  }
  /** 本轮第 7 项：成长/累计类增益的**真实进度**（面板 + 悬停都用它）。
   * 原来面板只显示 entry.stacks（这个增益拿过几次），所以「吞噬成长」这类
   * 按击杀/胜利累计的增益看起来永远是「×1」，玩家会以为没生效 ——
   * 实际上 run.killPower / run.winMaxHp / run.sellBonus 一直在涨。 */
  function progressOf(run, id) {
    const g = globalMul(run);
    const pct = (v) => Math.round((Number(v) || 0) * 100);
    if (id === 'C06') {
      const cap = D().BUFF_BY_ID.C06.mods.killPowerCap * Math.max(1, stacksOf(run, 'C06')) * g;
      return '已累计 攻击 +' + pct(run.killPower) + '%（上限 +' + pct(cap) + '%）';
    }
    /* C07 吞噬成长：累计值在 run.winMaxHp、上限字段是 mods.winMaxHpCap。
     * 原来这里读的是运行态里的「击杀成长」历史字段，以及一个**根本不存在的上限字段**
     * （旧名是 kill 前缀、现已统一成 win 前缀）—— 两个都取不到值：
     *   · C07 从不写那个 kill 前缀字段（它是给「击杀成长」用的历史字段），累计恒为 0
     *   · 上限字段名不存在 → 上限也恒为 0
     * 于是面板永远显示「生命上限 +0%（上限 +0%）」，看起来就像这条增益完全没生效
     * （效果本身其实是好的，只是显示错了）。 */
    if (id === 'C07') {
      const cap = D().BUFF_BY_ID.C07.mods.winMaxHpCap * Math.max(1, stacksOf(run, 'C07')) * g;
      return '已累计 生命上限 +' + pct(run.winMaxHp) + '%（上限 +' + pct(cap) + '%）';
    }
    if (id === 'C11') return '已累计 生命上限 +' + Math.round(Number(run.winHpFlat) || 0);
    /* 需求 4：轻装上阵 / 厚积薄发的叠层在详情里没显示 —— 这两条的加成依赖「当前有几个
     * 空槽 / 几个永久增益」，是动态值，所以要把「现在实际加了多少」算出来写清楚。 */
    if (id === 'C34' || id === 'C35') {
      const def34 = D().BUFF_BY_ID[id];
      const stacks34 = stacksOf(run, id) || 1;
      const per = (def34.mods.powerPerEmptySlot != null ? def34.mods.powerPerEmptySlot : def34.mods.powerPerPermBuff) * g;
      const n = id === 'C34'
        ? Math.max(0, permSlots(run) - permUsed(run))
        : (run.permanent || []).length;
      const total = per * n * stacks34;
      const unit = id === 'C34' ? '空槽' : '永久增益';
      return '当前 ' + n + ' 个' + unit + ' × ' + Math.round(per * 100) + '%' +
        (stacks34 > 1 ? ' × ' + stacks34 + ' 层' : '') + ' = 攻击 +' + Math.round(total * 100) + '%' +
        '（永久位 ' + permUsed(run) + '/' + permSlots(run) + '）';
    }
    if (id === 'C12') return '已累计 攻击 +' + pct(run.winPower) + '%';
    if (id === 'C25') return '本局已累计 卖价 +' + Math.round(Number(run.sellBonus) || 0) + ' 试炼币（只加自己）';
    const def = D().BUFF_BY_ID[id];
    if (def && def.mods && def.mods.fragileStat) {
      const key = def.mods.fragileStat;
      const names = { power: '力量', agility: '敏捷', speed: '速度' };
      const fb = fragileBonus(run, key);
      const now = Math.round(fb.value * 100);
      if (fb.burned) return (names[key] || key) + ' +' + now + '%（已损毁：全额并本局永久保留）';
      return (names[key] || key) + ' +' + now + '%（烙印存在：半效；损毁后升为 ' +
        Math.round((fb.base + fb.burned) * 100) + '% 并本局永久保留）';
    }
    if (id === 'C36') {
      const sg = Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, run.spendGain || {});
      const step = Math.max(1, Number(D().BUFF_BY_ID.C36.mods.shopSpendStep) || 20);
      return '已累计 力 +' + sg.power + ' / 敏 +' + sg.agility + ' / 速 +' + sg.speed + ' / 生命 +' + sg.hp +
        '（距下次 ' + Math.floor(Number(run.shopSpend) || 0) + '/' + step + ' 试炼币）';
    }
    return null;
  }
  /** 当前 run 已拥有 buff 列表（构筑展示 / 商店出售页用）。 */
  /** 某个增益在挑战塔里是否属于「下一场战斗」语义（卡面不显示限次）。 */
  function isTowerBattleBuff(id) {
    const def = D().BUFF_BY_ID[id];
    return !!(def && def.towerBattle);
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
      if (!buff || buff.hidden) return;   // 隐藏型（背包/选取类）不进增益面板
      out.push({ id: buff.id, name: buff.name, desc: buff.desc, rarity: buff.rarity, kind: buff.kind,        scopeName: scopeName[buff.kind], stacks: entry.stacks || 1,
        progress: progressOf(run, buff.id),                 // 第 7 项：成长类的真实累计值
        uses: buff.kind === 'limited' ? entry.uses : undefined,
        towerBattle: !!buff.towerBattle,          // 挑战塔里 = 「下一场战斗」，卡面不显示限次
        on: buff.kind === 'limited' ? entry.on !== false : true,
        sellable: !!run.shop && buff.kind !== 'instant' && !buff.hidden, sellPrice: sellPriceOf(run, buff) });
    };
    (run.permanent || []).forEach(add);
    (run.limited || []).forEach(add);
    return out;
  }

  window.Tower = {
    unlocked, towerInfo, endlessInfo, preview, planInfo, ownedBuffs, bossPool, debugGrantBuff, debugLoseBuff, pickCandidates, applyPickBuff,
    startTowerRun, startEndlessRun, nextBattle, reportBattle, interruptBattle, abandon,
    pickChoice, toggleLimited, addBuff, applyInstant, openRestShop, usePillSlot,
    shopState, buyShopSlot, buyRetryToken, buyShopHeal, rerollShop, sellBuff, closeShop, giveUp,
    canRetry, retryBattle, declineRetry, isTowerBattleBuff, takeAchievementToasts,
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
    /* 调试/测试用：直接指定某项加成的「历史峰值」，用来验证「超凡入圣」的跨档逻辑
     * （真实数值下很难凑到 100% 以上；实测 0.10 次/局，这正是它稀有的原因）。 */
    _debugSetStatPeak(field, value) {
      const run = endless().run;
      if (!run) return { ok: false, msg: '当前没有无尽塔对局。' };
      run.statPeaks = Object.assign({}, run.statPeaks || {});
      run.statPeaks[field] = Math.max(0, Number(value) || 0);
      save();
      return { ok: true, peaks: run.statPeaks };
    },
    /* 调试/探针用：把无尽对局直接挪到第 n 层（plan 一并重建，界面能正确显示
     * 「当前遭遇的机制」，例如第 6 层的荆棘反伤）。截图页 tools/tower-ui-probe.html 用。 */
    _debugSetEndlessLayer(n) {
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
      save();
      return { ok: true, layer };
    },
  };
})();
