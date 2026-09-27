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
    run.battleBuffs = cleanBuffs(run.battleBuffs);
    run.buffs = cleanBuffs(run.buffs);
    run.layerBuffs = cleanBuffs(run.layerBuffs);
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
  function buildPlan(layer) {
    const heroes = HEROES.slice();
    for (let i = heroes.length - 1; i > 0; i--) {           // 三侠随机序
      const j = Math.floor(Math.random() * (i + 1));
      [heroes[i], heroes[j]] = [heroes[j], heroes[i]];
    }
    const plan = heroes.map((anim) => ({ kind: 'hero', anim }));
    // 第 4 场 = 松鼠对手（同族、用松鼠自己的武技、固定出招循环）；
    // 原来那 10 个机制 NPC 退到 x10 层的精英场（第 5 场），设计不浪费。
    plan.push({ kind: 'squirrel', id: D().squirrelFor(layer).id });
    if (layer % 10 === 0) {
      const e = D().eliteFor(layer);
      plan.push({ kind: 'elite', id: e.main.id, mechs: e.mechs });
    }
    return plan;
  }
  function entryInfo(entry) {
    if (entry.kind === 'hero') return { name: HERO_NAME[entry.anim], anim: entry.anim, mechDesc: '', elite: false };
    if (entry.kind === 'squirrel') {
      const sq = D().SQUIRREL_BY_ID[entry.id];
      return { name: sq.name, squirrel: true, elite: false, mechDesc: sq.patternDesc, mechs: [] };
    }
    const npc = D().NPC_BY_ID[entry.id];
    if (entry.kind === 'elite') {
      return { name: npc.name, anim: npc.anim, elite: true, mechDesc: npc.mechDesc, mechs: entry.mechs };
    }
    return { name: npc.name, anim: npc.anim, elite: false, mechDesc: npc.mechDesc, mechs: [npc.mech] };
  }
  /** 入口页预告：当前层的全部对手。 */
  function preview(layer) {
    return buildPlanPreview(layer).map((entry) => Object.assign({ kind: entry.kind }, entryInfo(entry)));
  }
  /** 预告与实战共用同一份「确定性部分」（三侠顺序预告里也随机一次即可）。 */
  function buildPlanPreview(layer) {
    const plan = HEROES.map((anim) => ({ kind: 'hero', anim }));
    plan.push({ kind: 'squirrel', id: D().squirrelFor(layer).id });
    if (layer % 10 === 0) { const e = D().eliteFor(layer); plan.push({ kind: 'elite', id: e.main.id, mechs: e.mechs }); }
    return plan;
  }

  // ---------- buff 聚合 ----------
  function ownedEntry(run, id) {
    for (const list of [run.battleBuffs, run.layerBuffs, run.buffs]) {
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
  function eachBuff(run, fn) {
    for (const list of [run.battleBuffs, run.layerBuffs, run.buffs]) {
      for (const b of list || []) fn(D().BUFF_BY_ID[b.id], b.stacks);
    }
  }
  /**
   * 聚合当前生效的 buff 为本场战斗的修正。
   * foeCtx = {hero, poolNpc, elite}，用于「特定 NPC 触发」类乘区。
   */
  function aggregate(run, foeCtx) {
    const g = globalMul(run);
    const agg = { powerMul: 0, maxHpMul: 0, critBonus: 0, critDmgBonus: 0, dodgeBonus: 0, takenMul: 0,
      regenPct: 0, lifestealPct: 0, shellPct: 0, openStrikePct: 0, enemyPowerDown: 0,
      mustHitFirst: 0, firstSkillFree: 0, deathSaves: [], dmgMul: 1 };
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
    const extra = mode === 'endless' ? TD.ENDLESS_MECH_ORDER.slice(0, TD.endlessMechStacks(layer)) : [];
    let name, bias, npcType, skills = [], weapons = [], pattern = null, mech, elite = entry.kind === 'elite';
    if (entry.kind === 'hero') {
      const scale = (GData.STAGE_TYPE_SCALE && GData.STAGE_TYPE_SCALE[entry.anim]) || 1;
      bias = { power: scale, agility: scale, speed: scale, hp: 1 };
      name = HERO_NAME[entry.anim]; npcType = entry.anim;
      skills = [{ id: HERO_SKILL[entry.anim], level: Math.max(1, Math.min(15, Math.round(LT / 5))) }];
      mech = extra.slice();
    } else if (entry.kind === 'squirrel') {
      // 松鼠对手：同族贴图（**不给 npcType** → 战斗里就用玩家那套松鼠图集并镜像朝左，
      // 走 sim 的 playerLikeAction 分支，所以武器/技能都真的生效）。
      const sq = TD.SQUIRREL_BY_ID[entry.id];
      bias = sq.bias; name = sq.name; npcType = null;
      // 武技等级随目标等级小幅上调，免得高层还在用 8 级菜刀
      const up = Math.max(0, Math.floor((LT - 28) / 12));
      weapons = sq.weapons.map((w) => ({ id: w.id, level: Math.max(1, Math.min(15, w.level + up)) }));
      skills = sq.skills.map((k) => ({ id: k.id, level: Math.max(1, Math.min(15, k.level + up)) }));
      pattern = sq.pattern.slice();
      mech = extra.slice();
    } else {
      const npc = TD.NPC_BY_ID[entry.id];
      bias = npc.bias; name = npc.name; npcType = 'tw_' + npc.id;
      mech = elite ? entry.mechs.slice() : [npc.mech];
      for (const m of extra) if (!mech.includes(m)) mech.push(m);
    }
    const eliteMul = elite ? 1.2 : 1;
    // 敌方数值：高血低攻（系数在 tower-data.js 里，带注释，方便 tower-tune 复调）
    // 力量单独用更低的系数，敏捷/速度维持原基准；血量抬高。
    const stat = (b, mul) => Math.max(1, Math.round(statBase * (mul || TD.FOE_STAT_MUL) * M * b * eliteMul));
    const foe = {
      name, level: LT, npcType,
      power: stat(bias.power, TD.FOE_POWER_MUL * (entry.kind === 'squirrel' ? TD.FOE_SQUIRREL_POWER_MUL : 1)),
      agility: stat(bias.agility), speed: stat(bias.speed),
      hp: Math.max(1, Math.round(hpBase * TD.FOE_HP_MUL * (entry.kind === 'squirrel' ? TD.FOE_SQUIRREL_HP_MUL : 1) * M * bias.hp * eliteMul)),
      weapons, skills, mech, pattern,
    };
    // poolNpc = 带专属机制的 NPC（「机制破解」类 buff 只对它生效）；松鼠不算
    return { foe, elite, poolNpc: entry.kind === 'npc' || entry.kind === 'elite' };
  }
  function regionOf(entry) {
    if (entry.kind === 'squirrel') {
      const sq = D().SQUIRREL_BY_ID[entry.id];
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
    t.run = { layer, plan: buildPlan(layer), idx: 0, carry: 1, buffs: [], battleBuffs: [], pot: 0, choices: null };
    save();
    return { ok: true, layer };
  }
  function startEndlessRun() {
    const lock = unlocked();
    if (!lock.ok) return lock;
    const e = endless();
    if (e.run) return { ok: false, msg: '本局无尽挑战尚未结束。' };
    const run = { layer: 1, plan: buildPlan(1), idx: 0, carry: 1,
      buffs: [], layerBuffs: [], battleBuffs: [], coins: 0, score: 0, bestLayer: 0,
      killPower: 0, killMaxHp: 0, bonusPower: 0, shop: null, phase: null, choices: null };
    if (debug('endlessCoin')) run.coins = 9999;
    e.run = run;
    layerStartHeal(run);
    save();
    return { ok: true, layer: 1 };
  }
  /** 五层回响：进入 5 的倍数层时回复 50%（无尽）。 */
  function layerStartHeal(run) {
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
      const maxHp = Math.max(1, Math.round(me.maxHp * (1 + maxHpMul)));
      me.power = Math.max(1, Math.round(me.power * (1 + powerMul)));
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
      if (agg.deathSaves.length) mods.deathSaves = agg.deathSaves;
      me.mods = mods;
    };
    run.attempt = mode + '_' + Date.now() + '_' + (++attemptSeq);
    save();
    return { ok: true, token: run.attempt, entry, info: entryInfo(entry), foe: built.foe,
      elite: built.elite, region: regionOf(entry), hpRatio: run.carry, adjustMe,
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
  function reportBattle(mode, token, win, carryRatio) {
    const box = mode === 'tower' ? tower() : endless();
    const run = box.run;
    if (!run || run.attempt !== token) return { ok: false };
    delete run.attempt;
    const entry = run.plan[run.idx];
    const isElite = entry.kind === 'elite';
    if (!win) return mode === 'tower' ? towerFail(run) : endlessFail(run);
    run.carry = Math.max(0.01, clamp01(carryRatio));
    run.battleBuffs = [];                                // 单场类 buff 打完即消耗
    const out = { ok: true, win: true, elite: isElite, entryKind: entry.kind };
    if (mode === 'tower') {
      const shares = D().towerGoldShares(run.layer, run.plan.length);
      run.pot += shares[run.idx];
      out.potGold = run.pot;
    } else {
      const g = globalMul(run);
      run.score += D().SCORE.battle;
      run.coins += D().COINS.battle;
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
    if (won < len && (won <= 3 || (won === 4 && len === 5))) run.choices = rollChoices(mode, run);
    out.choices = run.choices;
    save();
    return out;
  }
  function towerFail(run) {
    const consolation = Math.floor(run.pot * D().TOWER_FAIL_CONSOLATION);
    if (consolation > 0) S().goldPoint += consolation;
    const layer = run.layer, pot = run.pot;
    tower().run = null;
    save();
    return { ok: true, win: false, layer, potGold: pot, consolation };
  }
  function endlessFail(run) {
    const e = endless();
    const out = { ok: true, win: false, layer: run.layer, score: run.score, bestLayer: run.bestLayer,
      tickets: 0, shield: false };
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
    if (mode === 'tower') {
      const gold = run.pot;
      S().goldPoint += gold;
      tower().maxLayer = run.layer;
      // 碎片判定压缩到最后一击：掉率/数量期望 = 挑战模式单场（★6 参数，蓝色封顶）
      if (Math.random() < GData.stageFragmentChance(6)) {
        const frag = GData.STAGE_FRAGMENT;
        const count = GData.stageFragmentCount();
        const id = Math.random() >= frag.tierUp ? 26 : 24;
        S().props[id] = (S().props[id] || 0) + count;
        out.drop = { id, count, name: propMap.getValue(id).name };
      }
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
    run.layerBuffs = [];                                 // 本层类 buff 过层清空
    const c04 = stacksOf(run, 'C04');                    // 生命源泉：每过一层回血
    if (c04) run.carry = Math.min(1, run.carry + D().BUFF_BY_ID.C04.mods.layerHealPct * g);
    const c12 = stacksOf(run, 'C12');                    // 登顶者：20 层起每过一层攻击成长
    if (c12 && run.layer >= 20) run.bonusPower += D().BUFF_BY_ID.C12.mods.perLayerPowerAfter20 * c12 * g;
    out.score = run.score; out.coins = run.coins;
    if (run.layer % 5 === 0) {                           // 每 5 层：商店 → 结算点
      run.shop = makeShop(run);
      run.phase = 'shop';
      out.phase = 'shop';
    } else {
      advanceLayer(run);
    }
    save();
    return out;
  }
  function advanceLayer(run) {
    run.layer++;
    run.plan = buildPlan(run.layer);
    run.idx = 0;
    run.choices = null;
    layerStartHeal(run);
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
  function pickChoice(mode, index) {
    const run = mode === 'tower' ? tower().run : endless().run;
    if (!run || !run.choices) return { ok: false };
    const choice = run.choices[index];
    if (!choice) return { ok: false };
    run.choices = null;
    if (choice.type === 'heal') {
      run.carry = Math.min(1, run.carry + D().FIXED_HEAL_PCT);
      save();
      return { ok: true, heal: D().FIXED_HEAL_PCT };
    }
    addBuff(run, choice.id);
    save();
    return { ok: true, buff: D().BUFF_BY_ID[choice.id] };
  }
  function addBuff(run, id) {
    const buff = D().BUFF_BY_ID[id];
    if (!buff) return;
    const owned = ownedEntry(run, id);
    if (owned) { owned.stacks = Math.min(D().STACK_MAX, owned.stacks + 1); return; }
    const entry = { id, stacks: 1 };
    if (buff.scope === 'battle') run.battleBuffs.push(entry);
    else if (buff.scope === 'layer') (run.layerBuffs || run.buffs).push(entry);   // 主塔：本层=整局，存 buffs
    else run.buffs.push(entry);
  }

  // ---------- 无尽：试炼币商店 ----------
  function makeShop(run) {
    return { layer: run.layer, slots: rollShopSlots(run), healSold: false, rerollFree: true };
  }
  function rollShopSlots(run) {
    const pool = D().endlessPool, slots = [], taken = new Set();
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
        return { id: s.id, sold: s.sold, name: b.name, desc: b.desc, rarity: b.rarity, scope: b.scope, price: D().shopPrice(b) }; }) };
  }
  function buyShopSlot(index) {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false };
    const slot = run.shop.slots[index];
    if (!slot || slot.sold) return { ok: false };
    const buff = D().BUFF_BY_ID[slot.id];
    const price = D().shopPrice(buff);
    if (run.coins < price) return { ok: false, msg: '试炼币不足。' };
    run.coins -= price;
    slot.sold = true;
    addBuff(run, slot.id);
    save();
    return { ok: true, buff, price };
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
  function sellBuff(id) {
    const run = endless().run;
    if (!run || !run.shop) return { ok: false };
    const buff = D().BUFF_BY_ID[id];
    if (!buff || buff.scope === 'battle') return { ok: false };
    for (const list of [run.layerBuffs, run.buffs]) {
      const i = (list || []).findIndex((b) => b.id === id);
      if (i >= 0) {
        list.splice(i, 1);
        const gain = Math.max(1, Math.round(D().shopPrice(buff) * D().SHOP.sellBack));
        run.coins += gain;
        save();
        return { ok: true, gain };
      }
    }
    return { ok: false };
  }
  /** 商店逛完：进入结算点（每 5 层的固定流程 商店 → 结算）。 */
  function closeShop() {
    const run = endless().run;
    if (!run || run.phase !== 'shop') return { ok: false };
    run.phase = 'checkpoint';
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
    advanceLayer(run);
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
      run: t.run ? { layer: t.run.layer, battleNo: t.run.idx + 1, battleCount: t.run.plan.length, carry: t.run.carry, pot: t.run.pot,
        choices: t.run.choices ? t.run.choices.slice() : null } : null,
      preview: preview(layer) };
  }
  function endlessInfo() {
    const e = endless();
    return { best: e.best, weekBest: e.weekBest, bestLayer: e.bestLayer,
      tickets: S().props[TICKET_PROP] || 0,
      run: e.run ? { layer: e.run.layer, score: e.run.score, coins: e.run.coins, carry: e.run.carry,
        battleNo: e.run.idx + 1, battleCount: e.run.plan.length, phase: e.run.phase,
        choices: e.run.choices ? e.run.choices.slice() : null,
        bestLayer: e.run.bestLayer, segment: D().endlessSegment(e.run.layer),
        ticketsIfSettle: D().endlessTickets(e.run.layer) } : null };
  }
  /** 当前 run 已拥有 buff 列表（构筑展示 / 商店出售页用）。 */
  function ownedBuffs(mode) {
    const run = mode === 'tower' ? tower().run : endless().run;
    if (!run) return [];
    const scopeName = { battle: '单场', layer: '本层', run: '跨层' };
    const list = [];
    eachBuff(run, (buff, stacks) => list.push({ id: buff.id, name: buff.name, desc: buff.desc, rarity: buff.rarity,
      scope: buff.scope, scopeName: scopeName[buff.scope], stacks,
      sellable: buff.scope !== 'battle' && !!run.shop, sellPrice: Math.max(1, Math.round(D().shopPrice(buff) * D().SHOP.sellBack)) }));
    return list;
  }

  window.Tower = {
    unlocked, towerInfo, endlessInfo, preview, ownedBuffs,
    startTowerRun, startEndlessRun, nextBattle, reportBattle, interruptBattle, abandon,
    pickChoice,
    shopState, buyShopSlot, buyShopHeal, rerollShop, sellBuff, closeShop,
    checkpointInfo, settleEndless, continueEndless,
    // 调试
    _debugSetLayer(n) { tower().maxLayer = Math.max(0, Math.floor(Number(n) || 0)); save(); },
  };
})();
