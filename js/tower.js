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
 *     killPower, killMaxHp, bonusPower, shop|null, phase:null|'shop'|'checkpoint' }
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
    run.permanent = cleanBuffs(run.permanent).slice(0, D().PERMANENT_SLOTS || 5);
    run.limited = (Array.isArray(run.limited) ? run.limited : []).filter((b) => b && D().BUFF_BY_ID[b.id] && D().BUFF_BY_ID[b.id].kind === 'limited')
      .map((b) => ({ id: b.id, stacks: Math.max(1, Math.min(D().STACK_MAX, Math.floor(Number(b.stacks) || 1))),
        uses: Math.max(0, Math.floor(Number(b.uses) || 0)), on: b.on !== false }))
      .filter((b) => b.uses > 0);
    // 主塔：本层类按整层算（不给它扣光的可能），单场类仍是 1 次
    if (run.mode === 'tower') run.limited = run.limited.map((b) => Object.assign(b, { uses: (D().BUFF_BY_ID[b.id].uses || 1) > 1 ? 99 : 1, on: true }));
    if (!Array.isArray(run.buffs)) run.buffs = [];
    // 注意：attempt/choices 的作废只在读档时做（state.js normalizeSave），
    // 这里是每次访问都会跑的深校验，不能动进行中的战斗令牌。
    if (mode === 'tower') run.pot = Math.max(0, Math.floor(Number(run.pot) || 0));
    else {
      run.coins = Math.max(0, Math.floor(Number(run.coins) || 0));
      run.score = Math.max(0, Math.floor(Number(run.score) || 0));
      run.bestLayer = Math.max(0, Math.floor(Number(run.bestLayer) || 0));
      run.killPower = Math.max(0, Number(run.killPower) || 0);
      run.killMaxHp = Math.max(0, Number(run.killMaxHp) || 0);
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
  function bossEntry(layer) { return D().bossFor(layer); }
  function buildPlan(layer) {
    /* 三侠顺序按层数随机（`heroOrder`，与日期无关）：同层固定 → 预告 = 实战、重试不变。
     * 削弱跟着「哪一位大侠」走（HERO_DEBUFF[anim]），所以顺序一变，本层要吃的削弱顺序也变，
     * 但三种削弱的组合固定，玩家看预告里的头像就知道等一下会被套上什么。 */
    const plan = D().heroOrder(layer).map((anim) => ({ kind: 'hero', anim }));
    // 第 4 场 = 随机 boss（20 选 1：7 个带机制的松鼠 + 3 只平庸松鼠 + 10 个机制 NPC）
    plan.push(bossEntry(layer));
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
  /** 入口页预告：当前层的全部对手（与 buildPlan 同源，所以预告 = 实战）。 */
  function preview(layer) {
    return buildPlan(layer).map((entry) => Object.assign({ kind: entry.kind }, entryInfo(entry)));
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
  /** 限次 buff 打完一场扣 1 次，扣完自动消失（第 1 项）。 */
  function consumeLimited(run) {
    for (const b of run.limited || []) { if (b.on !== false && b.uses > 0) b.uses--; }
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
      regenPct: 0, lifestealPct: 0, shellPct: 0, openStrikePct: 0, enemyPowerDown: 0,
      mustHitFirst: 0, firstSkillFree: 0, deathSaves: [], dmgMul: 1,
      speedMul: 0, winHealPct: 0, thornsPct: 0, lowHpPowerMul: 0, lowHpAt: 0 };
    eachBuff(run, (buff, stacks) => {
      const m = buff.mods, k = stacks * g;
      if (m.powerMul) agg.powerMul += m.powerMul * k;
      if (m.maxHpMul) agg.maxHpMul += m.maxHpMul * k;
      if (m.critBonus) agg.critBonus += m.critBonus * k;
      if (m.critDmgBonus) agg.critDmgBonus += m.critDmgBonus * k;
      if (m.dodgeBonus) agg.dodgeBonus += m.dodgeBonus * k;
      if (m.takenMul) agg.takenMul += m.takenMul * k;
      if (m.regenPct) agg.regenPct += m.regenPct * k;
      if (m.lifestealPct) agg.lifestealPct += m.lifestealPct * k;
      if (m.shellPct) agg.shellPct += m.shellPct * k;
      if (m.enemyPowerDown) agg.enemyPowerDown += m.enemyPowerDown * k;
      if (m.openStrikePct) agg.openStrikePct = Math.max(agg.openStrikePct, m.openStrikePct * k);
      if (m.speedMul) agg.speedMul += m.speedMul * k;
      if (m.winHealPct) agg.winHealPct += m.winHealPct * k;                       // 战后续航（可叠加）
      if (m.thornsPct) agg.thornsPct += m.thornsPct * k;                         // 荆棘之甲
      if (m.lowHpPowerMul) { agg.lowHpPowerMul += m.lowHpPowerMul * k; agg.lowHpAt = Math.max(agg.lowHpAt, Number(m.lowHpAt) || 0.35); }
      if (m.mustHitFirst) agg.mustHitFirst = 1;
      if (m.firstSkillFree) agg.firstSkillFree = 1;
      if (m.deathSave) agg.deathSaves.push({});                                  // 金蝉脱壳：保留 1 血
      if (m.revivePct) agg.deathSaves = [{ healPct: Math.min(0.9, m.revivePct * g) }]; // 不死鸟：每场一次复活
      if (foeCtx.hero && m.dmgMulType) agg.dmgMul *= 1 + m.dmgMulType * k;       // 猎侠者
      if (foeCtx.poolNpc && m.dmgMulMech) agg.dmgMul *= 1 + m.dmgMulMech * k;    // 机制破解
      if (foeCtx.elite && m.dmgMulElite) agg.dmgMul *= 1 + m.dmgMulElite * k;    // 精英杀手
    });
    // 叠层累积（击杀/层数成长，运行态数值）
    if (run.killPower) agg.powerMul += run.killPower;
    if (run.killMaxHp) agg.maxHpMul += run.killMaxHp;
    if (run.bonusPower) agg.powerMul += run.bonusPower;
    // 逢十强化：仅 x10 层生效
    if (stacksOf(run, 'C09') && run.layer % 10 === 0) { agg.powerMul += 0.20 * g; agg.maxHpMul += 0.20 * g; }
    return agg;
  }

  // ---------- 敌人构建 ----------
  function buildFoe(mode, layer, entry) {
    const TD = D();
    const LT = mode === 'tower' ? TD.towerLevel(layer) : TD.endlessLevel(layer);
    const M = mode === 'tower' ? TD.towerMult(layer) : TD.endlessMult(layer);
    const statBase = GData.stagePlayerStat(LT), hpBase = GData.stagePlayerHp(LT);
    // 无尽段机制叠加：所有怪物按固定顺序追加机制
    const extra = mode === 'endless' ? TD.endlessMechs(layer) : [];   // 第 1 项：按段轮转、同屏最多 3 个
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
      wears = TD.wearsOf(sq.gear);
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
    const run = { layer: 1, plan: buildPlan(1), idx: 0, carry: 1,
      mode: 'endless', permanent: [], limited: [], coins: 0, score: 0, bestLayer: 0,
      pillSlots: { power: null, agility: null, speed: null },
      killPower: 0, killMaxHp: 0, bonusPower: 0, shop: null, phase: null, choices: null, debuffs: [] };
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
    // M01 威慑：直接压敌人力量
    if (agg.enemyPowerDown > 0) built.foe.power = Math.max(1, Math.round(built.foe.power * (1 - agg.enemyPowerDown)));
    const maxHpMul = agg.maxHpMul, powerMul = agg.powerMul;
    const adjustMe = (me) => {
      // 本层削弱（三侠大招留下的）：生命上限 / 属性 / 锁武技
      const debuffs = Array.isArray(run.debuffs) ? run.debuffs : [];
      const dMaxHp = debuffs.filter((d) => d.kind === 'maxHp').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const dPower = debuffs.filter((d) => d.kind === 'stat' && d.stat === 'power').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const dAgi = debuffs.filter((d) => d.kind === 'stat' && d.stat === 'agility').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const dSpd = debuffs.filter((d) => d.kind === 'stat' && d.stat === 'speed').reduce((a, d) => a * (1 - (Number(d.pct) || 0)), 1);
      const maxHp = Math.max(1, Math.round(me.maxHp * (1 + maxHpMul) * dMaxHp));
      me.power = Math.max(1, Math.round(me.power * (1 + powerMul) * dPower));
      me.agility = Math.max(1, Math.round(me.agility * dAgi));
      me.speed = Math.max(1, Math.round(me.speed * dSpd * (1 + agg.speedMul)));
      // 第 1 项：属性药丸（塔内 20 场）—— 与 State.totalStats 的药剂口径一致
      for (const k of ['power', 'agility', 'speed']) {
        const slot = (run.pillSlots || {})[k];
        const eff = slot && D().pillEffect(slot.id);
        if (eff) me[k] += Math.max(Math.floor(me[k] * eff.pct), eff.min);
      }
      for (const d of debuffs) {
        if (d.kind !== 'lock') continue;
        if (d.what === 'weapon') me.weapons = (me.weapons || []).filter((w) => Number(w.id) !== Number(d.id));
        else me.skills = (me.skills || []).filter((s2) => Number(String(s2).split(':')[0]) !== Number(d.id));
      }
      // maxHpMul 的「回复等量生命」= 按比例继承到新上限（正增益不亏比例、负增益同步缩血）
      me.maxHp = maxHp;
      me.hp = Math.max(1, Math.min(maxHp, Math.round(maxHp * run.carry)));
      const mods = {};
      if (agg.critBonus) mods.critBonus = agg.critBonus;
      if (agg.critDmgBonus) mods.critDmgBonus = agg.critDmgBonus;
      if (agg.dodgeBonus) mods.dodgeBonus = agg.dodgeBonus;
      if (agg.takenMul) mods.takenMul = agg.takenMul;
      if (agg.regenPct) mods.regenPct = agg.regenPct;
      if (agg.lifestealPct) mods.lifestealPct = agg.lifestealPct;
      if (agg.shellPct) mods.shellPct = agg.shellPct;
      if (agg.openStrikePct) mods.openStrikePct = agg.openStrikePct;
      if (agg.mustHitFirst) mods.mustHitFirst = 1;
      if (agg.firstSkillFree) mods.firstSkillFree = 1;
      if (agg.dmgMul !== 1) mods.dmgMul = agg.dmgMul;
      if (agg.thornsPct) mods.thornsPct = Math.min(0.6, agg.thornsPct);          // 荆棘之甲（sim 里结算）
      if (agg.lowHpPowerMul) { mods.lowHpPowerMul = agg.lowHpPowerMul; mods.lowHpAt = agg.lowHpAt || 0.35; }
      if (agg.deathSaves.length) mods.deathSaves = agg.deathSaves;
      me.mods = mods;
    };
    run.attempt = mode + '_' + Date.now() + '_' + (++attemptSeq);
    save();
    return { ok: true, token: run.attempt, entry, info: entryInfo(entry), foe: built.foe,
      elite: built.elite, region: regionOf(entry), hpRatio: run.carry, adjustMe,
      debuffs: (run.debuffs || []).slice(),
      battleNo: run.idx + 1, battleCount: run.plan.length, layer: run.layer };
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
    if (!win) return mode === 'tower' ? towerFail(run) : endlessFail(run);
    run.carry = Math.max(0.01, clamp01(carryRatio));
    const out = { ok: true, win: true, elite: isElite, entryKind: entry.kind };
    // 三侠的大招会给玩家留一层削弱（第 3 项）
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
      run.score += D().SCORE.battle;
      /* 第 1 项：试炼币加成（战利品类限次 buff，remaining 次数在下面统一扣） */
      const coinMul = 1 + (runModTotal(run, 'coinBoostPct') || 0);
      // 第 1 项：战利品账本 —— 每胜一场，卖出收益累计 +N
      run.sellBonus = (run.sellBonus || 0) + (runModTotal(run, 'sellGrowthPerWin') || 0);
      run.coins += Math.round(D().COINS.battle * coinMul);
      // 击杀叠层类（基础 → 叠层 → C15）
      const c06 = stacksOf(run, 'C06');
      if (c06) run.killPower = Math.min(0.20 * c06 * g, run.killPower + 0.01 * c06 * g);
      const c07 = stacksOf(run, 'C07');
      if (c07) run.killMaxHp = Math.min(0.30 * c07 * g, run.killMaxHp + 0.02 * c07 * g);
      const c11 = stacksOf(run, 'C11');
      if (c11) run.carry = Math.min(1, run.carry + 0.03 * c11 * g);
      if (isElite) {
        run.score += D().SCORE.elite;
        run.coins += D().COINS.elite;
        const c13 = stacksOf(run, 'C13');
        if (c13) run.carry = Math.min(1, run.carry + D().BUFF_BY_ID.C13.mods.eliteHealAfter * g);
      }
    out.score = run.score; out.coins = run.coins;
    }
    run.idx++;
    if (run.idx >= run.plan.length) return layerClear(mode, run, out);
    // 场间选择：第 1/2/3 场后必给；x10 层第 4 场后再给一次
    const won = run.idx, len = run.plan.length;
    /* 第 3 项：场间选择从「每场都给」压成「只在第 4 场（题面）前给一次」，
     * x10 层（5 场）在第 5 场精英前再给一次。这样每层只有 1~2 个决策点，
     * 而且是在读过三侠的削弱之后才选，选项才有分量。 */
    /* 第 1 项：限次 buff 打完一场扣 1 次，扣完自动消失（无尽；主塔的「本层类」按整层算）。
     * 顺序：先按本场生效的数值结算，再扣次数。 */
    consumeLimited(run);   // 主塔的单场类（1 次）打完即消耗，本层类 99 次不会耗尽；无尽按各自的次数扣
    // 第 1 项：属性药丸按战斗数递减（胜败都算一场）
    for (const k of ['power', 'agility', 'speed']) {
      const slot = (run.pillSlots || {})[k];
      if (slot && slot.battles > 0) { slot.battles--; if (slot.battles <= 0) run.pillSlots[k] = null; }
    }
    if (won === 3 || (won === 4 && len === 5)) run.choices = rollChoices(mode, run);
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
  function endlessFail(run) {
    const e = endless();
    /* 第 3 项：失败不再把奖励归零 —— 直接按**当前层应得的抽奖卷**结算（和结算点离场同一个口径），
     * 分数也照常入账。这样「撑到更深」永远有意义，不会一次失败全打水漂。 */
    const tickets = D().endlessTickets(run.layer);
    if (tickets > 0) S().props[TICKET_PROP] = (S().props[TICKET_PROP] || 0) + tickets;
    const out = { ok: true, win: false, layer: run.layer, score: run.score, bestLayer: run.bestLayer,
      tickets, shield: false, settled: true };
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
  function settleScore(run, out) {
    const e = endless();
    e.best = Math.max(e.best, run.score);
    e.weekBest = Math.max(e.weekBest, run.score);
    e.bestLayer = Math.max(e.bestLayer, run.bestLayer);
    out.best = e.best; out.weekBest = e.weekBest;
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
      // 碎片判定压缩到最后一击：掉率/数量期望 = 挑战模式单场（★6 参数，蓝色封顶）
      if (Math.random() < GData.stageFragmentChance(6)) {
        const frag = GData.STAGE_FRAGMENT;
        const count = GData.stageFragmentCount();
        const id = Math.random() >= frag.tierUp ? 26 : 24;
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
    run.score += D().SCORE.layer;
    run.coins += D().COINS.layer;
    run.bestLayer = Math.max(run.bestLayer, run.layer);
    run.limited = [];                                   // 本层类 buff 过层清空（第 1 项：限次列表）
    const c04 = stacksOf(run, 'C04');                    // 生命源泉：每过一层回血
    if (c04) run.carry = Math.min(1, run.carry + D().BUFF_BY_ID.C04.mods.layerHealPct * g);
    const c12 = stacksOf(run, 'C12');                    // 登顶者：20 层起每过一层攻击成长
    if (c12 && run.layer >= 20) run.bonusPower += D().BUFF_BY_ID.C12.mods.perLayerPowerAfter20 * c12 * g;
    /* 第 3 项：每爬 10 层，结算时随机发一次里程碑奖励（技能卷轴×10 / 武器卷轴×10 / 随机药丸）。 */
    if (run.layer % D().MILESTONE_EVERY === 0) {
      const reward = D().rollMilestone();
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
    run.plan = buildPlan(run.layer);
    run.idx = 0;
    run.choices = null;
    run.restShopUsed = false;
    layerStartHeal(run, mode);
  }

  // ---------- 场间 4 选 1 ----------
  function rollChoices(mode, run) {
    const TD = D();
    const pool = mode === 'tower' ? TD.towerPool : TD.endlessPool;
    const picked = [];
    const taken = new Set();
    const available = (rarity) => pool.filter((b) => b.rarity === rarity && !taken.has(b.id) && ownable(run, b));
    for (let slot = 0; slot < 3; slot++) {
      let rarity = rollRarity();
      let list = available(rarity);
      if (!list.length) list = pool.filter((b) => !taken.has(b.id) && ownable(run, b));   // 该稀有度抽空时放宽
      if (!list.length) break;
      const buff = list[Math.floor(Math.random() * list.length)];
      taken.add(buff.id);
      picked.push({ type: 'buff', id: buff.id });
    }
    return [{ type: 'heal' }, ...picked];
  }
  function ownable(run, buff) {
    const owned = ownedEntry(run, buff.id);
    if (!owned) return true;
    return buff.stackable === true && owned.stacks < D().STACK_MAX;   // 同名唯一，可叠层例外
  }
  function rollRarity() {
    const w = D().RARITY_WEIGHTS, total = w[0] + w[1] + w[2];
    let r = Math.random() * total;
    for (let i = 0; i < w.length; i++) { if (r < w[i]) return i; r -= w[i]; }
    return 0;
  }
  function pickChoice(mode, index, replaceId) {
    const run = mode === 'tower' ? tower().run : endless().run;
    if (!run || !run.choices) return { ok: false };
    const choice = run.choices[index];
    if (!choice) return { ok: false };
    if (choice.type === 'heal') {
      run.choices = null;
      run.carry = Math.min(1, run.carry + D().FIXED_HEAL_PCT);
      save();
      return { ok: true, heal: D().FIXED_HEAL_PCT };
    }
    const res = addBuff(run, choice.id, replaceId);
    if (!res.ok) return res;                     // 永久格子满了：保留 choices，让界面去选替换
    run.choices = null;
    save();
    return res;
  }
  /** 加一个 buff。永久类要过 5 格上限（满则返回 needsReplace，由界面选一个替换）。 */
  function addBuff(run, id, replaceId) {
    const buff = D().BUFF_BY_ID[id];
    if (!buff) return { ok: false, msg: '没有这个增益' };
    if (buff.kind === 'instant') return applyInstant(run, buff);
    const listKey = buff.kind === 'permanent' ? 'permanent' : 'limited';
    const list = run[listKey] || (run[listKey] = []);
    const owned = list.find((b) => b.id === id);
    if (owned) {
      owned.stacks = Math.min(D().STACK_MAX, owned.stacks + 1);
      if (buff.kind === 'limited') { owned.uses += buff.uses || 1; owned.on = true; }
      return { ok: true, buff, stacks: owned.stacks };
    }
    if (buff.kind === 'permanent' && list.length >= (D().PERMANENT_SLOTS || 5)) {
      if (!replaceId) return { ok: false, needsReplace: true, buff, msg: '永久增益已满 5 个，先选一个替换掉' };
      const at = list.findIndex((b) => b.id === replaceId);
      if (at < 0) return { ok: false, needsReplace: true, buff, msg: '要替换的增益不存在' };
      list.splice(at, 1);
    }
    const towerLimitedUses = run.mode === 'tower' && (buff.uses || 1) > 1 ? 99 : (buff.uses || 1);
    list.push(buff.kind === 'limited'
      ? { id, stacks: 1, uses: towerLimitedUses, on: true }
      : { id, stacks: 1 });
    return { ok: true, buff };
  }
  /** 瞬时经济 buff（立即进货 / 立即得试炼币 / 全场五折）。 */
  function applyInstant(run, buff) {
    const m = buff.mods || {};
    const out = { ok: true, buff, instant: true };
    if (m.instantCoins) { run.coins = Math.max(0, (run.coins || 0) + m.instantCoins); out.coins = m.instantCoins; }
    if (m.shopDiscount) { run.shopDiscount = true; out.discount = m.shopDiscount; }
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
    /* 第 1 项：「全场五折」在开店那一刻生效一次（价格在 shopState 里按 run.shopDiscount 打折），
     * 然后用掉标记 —— 所以「立即进货」开的临时店也会吃到折扣。 */
    const shop = { layer: run.layer, slots: rollShopSlots(run), healSold: false, rerollFree: true,
      discount: !!run.shopDiscount };
    return shop;
  }
  function rollShopSlots(run) {
    const pool = D().shopPool || D().endlessPool, slots = [], taken = new Set();
    for (let i = 0; i < D().SHOP.slots; i++) {
      let list = pool.filter((b) => b.rarity === rollRarity() && !taken.has(b.id) && ownable(run, b));
      if (!list.length) list = pool.filter((b) => !taken.has(b.id) && ownable(run, b));
      if (!list.length) break;
      const buff = list[Math.floor(Math.random() * list.length)];
      taken.add(buff.id);
      slots.push({ id: buff.id, sold: false });
    }
    return slots;
  }
  function shopState() {
    const run = endless().run;
    if (!run || !run.shop) return null;
    return { coins: run.coins, layer: run.shop.layer, healSold: run.shop.healSold, rerollFree: run.shop.rerollFree,
      rerollPrice: D().SHOP.rerollPrice, healPrice: D().SHOP.healPrice, healPct: D().SHOP.healPct,
      slots: run.shop.slots.map((s) => { const b = D().BUFF_BY_ID[s.id];
        return { id: s.id, sold: s.sold, name: b.name, desc: b.desc, rarity: b.rarity, kind: b.kind, price: shopPriceOf(b) }; }) };
  }
  function buyShopSlot(index, replaceId) {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false };
    const slot = run.shop.slots[index];
    if (!slot || slot.sold) return { ok: false };
    const buff = D().BUFF_BY_ID[slot.id];
    // 永久增益满 5 格时先让玩家去替换（商店里不弹替换面板，避免一次点出两层交互）
    const permanentFull = buff.kind === 'permanent' && (run.permanent || []).length >= (D().PERMANENT_SLOTS || 5) &&
      !(run.permanent || []).some((b) => b.id === buff.id);
    if (permanentFull && !replaceId) {
      // 第 1 项：不再把玩家打发回主界面 —— 直接把替换目标的选择交给界面
      return { ok: false, needsReplace: true, buff, msg: '永久增益已满 5 个，请选择要替换掉的增益。' };
    }
    const price = shopPriceOf(buff);
    if (run.coins < price) return { ok: false, msg: '试炼币不足。' };
    run.coins -= price;
    slot.sold = true;
    const res = addBuff(run, slot.id, replaceId);
    save();
    return { ok: true, buff, price, instant: !!(res && res.instant) };
  }
  function buyShopHeal() {
    const run = endless().run;
    if (!run || !run.shop || run.shop.healSold) return { ok: false };
    if (run.coins < D().SHOP.healPrice) return { ok: false, msg: '试炼币不足。' };
    run.coins -= D().SHOP.healPrice;
    run.shop.healSold = true;
    run.carry = Math.min(1, run.carry + D().SHOP.healPct);
    save();
    return { ok: true };
  }
  function rerollShop() {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false };
    if (run.shop.rerollFree) run.shop.rerollFree = false;
    else {
      if (run.coins < D().SHOP.rerollPrice) return { ok: false, msg: '试炼币不足。' };
      run.coins -= D().SHOP.rerollPrice;
    }
    run.shop.slots = rollShopSlots(run);
    save();
    return { ok: true };
  }
  /** 卖出一个已拥有的本层/跨层 buff（回收价 = 买入价 40%）；击杀/层数成长累积值保留。 */
  /** 第 1 项：全场五折 —— 进店时把价格乘上折扣并消耗掉这个标记。 */
  function shopPriceOf(buff) {
    const run = endless().run;
    const base = D().shopPrice(buff);
    return run && run.shopDiscount ? Math.max(1, Math.round(base * 0.5)) : base;
  }
  /** 卖出价：名贵手表这类有固定 sellValue 的按固定值，其它按商店价 40%，再叠「战利品账本」的累计加成。 */
  function sellPriceOf(run, buff) {
    const base = buff.mods && buff.mods.sellValue
      ? Number(buff.mods.sellValue)
      : Math.max(1, Math.round(D().shopPrice(buff) * D().SHOP.sellBack));
    return base + Math.max(0, Math.floor(Number(run.sellBonus) || 0));
  }
  function sellBuff(id) {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false };
    const buff = D().BUFF_BY_ID[id];
    if (!buff || buff.kind === 'instant') return { ok: false };   // 第 3 项：限次也能卖（只有即时类不留存、无从卖出）
    for (const list of [run.permanent || [], run.limited || []]) {
      const i = (list || []).findIndex((b) => b.id === id);
      if (i >= 0) {
        const gain = sellPriceOf(run, buff);
        list.splice(i, 1);
        run.coins += gain;
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
    { const r = endless().run; if (r && r.shop && r.shop.discount) { r.shopDiscount = false; r.shop.discount = false; } }
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
        // 第 1 项：本段怪物带的机制（按段轮转，最多 3 个）
        mechs: D().endlessMechs(e.run.layer).slice(),
        restShopUsed: !!e.run.restShopUsed,
        finished: e.run.finished || null,
        pillSlots: Object.assign({}, e.run.pillSlots || {}),
        ticketsIfSettle: D().endlessTickets(e.run.layer) } : null };
  }
  /** 当前 run 已拥有 buff 列表（构筑展示 / 商店出售页用）。 */
  function ownedBuffs(mode) {
    const run = mode === 'tower' ? tower().run : endless().run;
    if (!run) return [];
    const scopeName = { limited: '限次', permanent: '永久', instant: '即时' };
    const list = [];
    eachBuff(run, (buff, stacks) => list.push({ id: buff.id, name: buff.name, desc: buff.desc, rarity: buff.rarity,
      kind: buff.kind, scopeName: scopeName[buff.kind], stacks,
      uses: buff.kind === 'limited' ? (ownedEntry(run, buff.id) || {}).uses : undefined,
      on: buff.kind === 'limited' ? (ownedEntry(run, buff.id) || {}).on !== false : true,
      sellable: !!run.shop && buff.kind !== 'instant', sellPrice: sellPriceOf(run, buff) }));
    return list;
  }

  window.Tower = {
    unlocked, towerInfo, endlessInfo, preview, ownedBuffs,
    startTowerRun, startEndlessRun, nextBattle, reportBattle, interruptBattle, abandon,
    pickChoice, toggleLimited, addBuff, applyInstant, openRestShop, usePillSlot,
    shopState, buyShopSlot, buyShopHeal, rerollShop, sellBuff, closeShop, giveUp,
    checkpointInfo, settleEndless, continueEndless,
    // 调试
    _debugSetLayer(n) { tower().maxLayer = Math.max(0, Math.floor(Number(n) || 0)); save(); },
  };
})();
