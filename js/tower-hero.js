/* Hero-mode profile and weapon/skill progression. No account writes, currency or save calls.
 * Upgrade rows come from upgradeMap: current levels 1..14 use
 * 100/100/100/70/60/40/25/15/10/100/8/5/4/3 percent.
 * Ordinary levels 1..9 gain +3 percentage points per failure, cleared on success.
 * Current level 10 and above use the fixed row rate; 11..15 are true levels 1..5.
 */
(function () {
  'use strict';

  const CONFIG = Object.freeze({
    initialCount: 3, startLevel: 5, normalLimit: GData.wsLimit(90),
    /* 每一层最后一场胜利的领悟概率由「已掌握武技数」决定，见 learnChanceForCount。
     * 第一层最后一场固定 100%。 */
    lastBattleLearn: true,
    /* 2026-10-24 用户口径：勇者初始生命 800，力 / 敏 / 速同为 65。 */
    base: Object.freeze({ power: 65, agility: 65, speed: 65, maxHp: 800 }),
  });
  /* 勇者武技普通级（1~9）的失败保底：每次失败 +3 个百分点，成功后清零。
   * 账号武技仍是 State.UPGRADE_FAIL_BONUS=2；用户 2026-11 只要求勇者模式 +3。 */
  const HERO_FAIL_BONUS_PCT = 3;
  /* ---------- 初始四维的重新分配（2026-10-24 用户口径） ----------
   * 生命固定 800，力 / 敏 / 速三项在**总点数不变**的前提下由玩家上下调整。
   * 「20% 下限」沿用玩家自由属性点那条口径：生命按 5 点折算 1 点属性，
   * 四项占比任何一项低于 20% 就是越界。初始 65/65/65/800 的账：
   *   生命 80 + 力 65 + 敏 65 + 速 65 = 275 点预算；
   *   下限 = ceil(275 × 20%) = 55，单项上限 = 275 - 80 - 55×2 = 85。
   * 力 / 敏 / 速初始合计 195 点；从某项扣下的点先进入「可分配池」，
   * 再加到另一项上，所以三项合计 + 池始终 = 195。 */
  const HP_PER_STAT = 10;
  const STAT_SHARE_MIN = 0.20;
  const STAT_KEYS = ['power', 'agility', 'speed'];
  const STAT_NAMES = { power: '力量', agility: '敏捷', speed: '速度' };
  const STAT_TOTAL = CONFIG.base.power + CONFIG.base.agility + CONFIG.base.speed;
  const STAT_BUDGET = CONFIG.base.maxHp / HP_PER_STAT + STAT_TOTAL;
  const STAT_FLOOR = Math.ceil(STAT_BUDGET * STAT_SHARE_MIN);
  const STAT_CAP = STAT_BUDGET - CONFIG.base.maxHp / HP_PER_STAT - STAT_FLOOR * 2;
  const STAT_RULES = Object.freeze({
    hpPerStat: HP_PER_STAT, shareMin: STAT_SHARE_MIN, budget: STAT_BUDGET,
    floor: STAT_FLOOR, cap: STAT_CAP, total: STAT_TOTAL,
    poolMax: STAT_TOTAL - STAT_FLOOR * 3,
    initial: Object.freeze({ power: CONFIG.base.power, agility: CONFIG.base.agility, speed: CONFIG.base.speed }),
  });
  const integer = (v, fallback, min, max) => {
    const n = Math.floor(Number(v));
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
  };
  function initialStats() {
    return { power: STAT_RULES.initial.power, agility: STAT_RULES.initial.agility, speed: STAT_RULES.initial.speed };
  }
  /** 校验一份力/敏/速分配：三项都必须在 [下限, 上限] 且合计正好 195；
   *  不合法（含旧档 80/65/60）一律回初始 65/65/65。 */
  function cleanStats(raw) {
    const src = object(raw) ? raw : {};
    const out = {};
    let sum = 0;
    for (const key of STAT_KEYS) {
      const value = integer(src[key], STAT_RULES.initial[key], STAT_FLOOR, STAT_CAP);
      out[key] = value;
      sum += value;
    }
    return sum === STAT_TOTAL ? out : initialStats();
  }
  /** 塔内每 5 层的勇者成长（独立于开局四维分配）。
   *  不能直接改 base：normalize 的 cleanStats 要求三项合计正好 195，改完会被回滚成 65/65/65。
   *  这里单存一份附加成长，fighter() 再叠到白值上。 */
  function cleanTowerBonus(raw) {
    if (!object(raw)) return null;
    const out = {
      power: integer(raw.power, 0, 0, 9999),
      agility: integer(raw.agility, 0, 0, 9999),
      speed: integer(raw.speed, 0, 0, 9999),
      maxHp: integer(raw.maxHp, 0, 0, 999999),
    };
    return (out.power || out.agility || out.speed || out.maxHp) ? out : null;
  }
  /** 上 / 下调整一项：下键扣点进池、上键从池里加点；池空 / 满额 / 20% 下限都会拒绝。 */
  function adjustStat(rawValues, rawPool, key, dir) {
    if (!STAT_KEYS.includes(key)) return error('只能调整力量、敏捷和速度。');
    const values = {};
    for (const k of STAT_KEYS) values[k] = integer(rawValues && rawValues[k], STAT_RULES.initial[k], STAT_FLOOR, STAT_CAP);
    let sum = values.power + values.agility + values.speed;
    let pool = integer(rawPool, STAT_TOTAL - sum, 0, STAT_RULES.poolMax);
    if (sum + pool !== STAT_TOTAL) pool = Math.max(0, Math.min(STAT_RULES.poolMax, STAT_TOTAL - sum));
    if (dir === 'down') {
      if (values[key] <= STAT_FLOOR) return error(STAT_NAMES[key] + '已到 20% 下限。');
      values[key] -= 1;
      pool += 1;
      return { ok: true, values, pool, msg: STAT_NAMES[key] + ' −1，可分配 ' + pool + ' 点。' };
    }
    if (dir === 'up') {
      if (pool <= 0) return error('没有可分配点。');
      if (values[key] >= STAT_CAP) return error(STAT_NAMES[key] + '已满额（' + STAT_CAP + '）。');
      values[key] += 1;
      pool -= 1;
      return { ok: true, values, pool, msg: STAT_NAMES[key] + ' +1，可分配 ' + pool + ' 点。' };
    }
    return error('方向无效。');
  }
  const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const mapOf = (kind) => kind === 'weapon' ? weaponsMap : skillsMap;
  const prefix = (kind) => kind === 'weapon' ? 'w' : 's';
  const listOf = (hero, kind) => hero[kind === 'weapon' ? 'weapons' : 'skills'];
  const failKey = (kind, id) => prefix(kind) + Number(id);
  const refOf = (kind, id) => prefix(kind) + ':' + Number(id);
  const levelLabel = (level) => level > 10 ? '真' + (level - 10) : level + '级';
  const error = (msg) => ({ ok: false, msg, label: msg });
  function roll(rng) {
    const n = Number((typeof rng === 'function' ? rng : Math.random)());
    return Number.isFinite(n) ? Math.max(0, Math.min(1 - Number.EPSILON, n)) : 0;
  }
  const pick = (pool, rng) => pool.length ? pool[Math.floor(roll(rng) * pool.length)] : null;
  /* 每层最后一战的领悟概率（0~1），按**已掌握武技总数**反比衰减。
   * 拟合曲线精确穿过用户给的三点：4→80%、10→50%、20→30%。
   *   pct(n) = 8000 / (9n + 60) − 10/3
   * 例如 4=80、10=50、20=30、24≈25.7、40≈15.7。 */
  function learnChanceForCount(ownedCount) {
    const n = Math.max(0, Math.floor(Number(ownedCount) || 0));
    const pct = 8000 / (9 * n + 60) - 10 / 3;
    return Math.round(Math.max(0, Math.min(1, pct / 100)) * 10000) / 10000;
  }

  function catalog() {
    const out = [];
    for (const kind of ['weapon', 'skill']) {
      mapOf(kind).each((key, def) => {
        const id = Number(def && def.id || key);
        if (!(id > 0) || !def || !GData.canLearn(kind, id, 90)) return;
        out.push({ kind, id, name: String(def.name || ''), desc: String(def.remark || '') });
      });
    }
    return out;
  }
  function infoOf(kind, id) {
    if (kind !== 'weapon' && kind !== 'skill') return null;
    return catalog().find((it) => it.kind === kind && it.id === Number(id)) || null;
  }
  function parseRef(ref) {
    const hit = /^([ws]):(\d+)$/.exec(String(ref || ''));
    if (!hit) return null;
    const kind = hit[1] === 'w' ? 'weapon' : 'skill', id = Number(hit[2]);
    const info = infoOf(kind, id);
    return info ? Object.assign({ ref: refOf(kind, id) }, info) : null;
  }
  function owned(hero) {
    const out = [];
    for (const kind of ['weapon', 'skill']) for (const raw of listOf(hero, kind) || []) {
      const pair = String(raw).split(':').map(Number), info = infoOf(kind, pair[0]);
      if (info) out.push(Object.assign({ level: pair[1], ref: refOf(kind, pair[0]) }, info));
    }
    return out;
  }
  const owns = (hero, it) => listOf(hero, it.kind).some((raw) => Number(String(raw).split(':')[0]) === it.id);
  const count = (hero) => hero.weapons.length + hero.skills.length;
  /* 24 项普通上限的计数口径：**只数占上限的武技**。
   * HS04「禁书残页」学会的武技带 `uncapped` 标记（ref 数组），
   * 即使还没到 24 项也不占计数；普通学习达到 24 后仍可继续被 HS04 扩充。
   * UI 上仍用 count() 显示「已掌握」，另外单独提示其中几项不占上限。 */
  const uncappedRefs = (hero) => Array.isArray(hero && hero.uncapped) ? hero.uncapped : [];
  const isUncapped = (hero, ref) => uncappedRefs(hero).includes(String(ref));
  function markUncapped(hero, ref) {
    if (!hero || !ref) return false;
    const list = uncappedRefs(hero).filter((x) => x !== String(ref));
    list.push(String(ref));
    hero.uncapped = list;
    return true;
  }
  function clearUncapped(hero, ref) {
    if (!hero) return false;
    const list = uncappedRefs(hero).filter((x) => x !== String(ref));
    const had = list.length !== uncappedRefs(hero).length;
    hero.uncapped = list;
    return had;
  }
  function cappedCount(hero) {
    return owned(hero).filter((it) => !isUncapped(hero, it.ref)).length;
  }
  function setLevel(hero, it, level) {
    const arr = listOf(hero, it.kind), at = arr.findIndex((raw) => Number(String(raw).split(':')[0]) === it.id);
    if (at >= 0) arr[at] = it.id + ':' + level;
  }
  /** 当前是不是现代界面（只影响「外观能不能画出来」这一层，不碰数值）。 */
  function modernUi() {
    try { return !!(window.State && State.settings && State.settings().uiMode === 'modern'); }
    catch (e) { return false; }
  }
  /** 外观件 → 现代图集套装序号（`Head_<index>_<tier>`）。没有这套数据时返回 NaN。 */
  function outfitIndexOf(setId) {
    const id = Number(setId);
    if (!(id > 0)) return NaN;
    try {
      const set = window.gearSetMap && gearSetMap.getValue(String(id));
      return set ? Number(set.index) : NaN;
    } catch (e) { return NaN; }
  }
  function cleanAppearance(raw) {
    const out = [], parts = new Set();
    for (const value of Array.isArray(raw) ? raw : []) {
      const item = object(value) ? value : { id: value }, id = Number(item.id);
      const def = gearMap.getValue(id);
      /* 外观数据源接受 GData.GEAR_BASE 的原始 288 个 id（外观页展示时合并重复黑装后为 280 件）；
       * 其中 q5 黑装上位（213~264）与深海 / 机器猫 q3（189~196）不在 APK 的 gearMap 里 ——
       * 只做外观时按 GEAR_BASE 行补出 type / setId / quality，不把这些 id 整件丢掉。 */
      let type, quality, setId = 0;
      if (def) {
        type = Number(def.type);
        setId = Number(def.setId) || 0;
        const set = gearSetMap.getValue(String(setId));
        quality = Number(set && set.quality) || 0;
      } else {
        const rows = (window.GData && Array.isArray(GData.GEAR_BASE)) ? GData.GEAR_BASE : null;
        const row = rows ? rows.find((r) => Number(r && r[0]) === id) : null;
        if (!row) continue;
        type = Number(row[3]);
        setId = Number(row[1]) || 0;
        quality = Math.max(0, Math.min(5, Number(row[2]) || 0));
      }
      if (type < 0 || type > 3 || parts.has(type)) continue;
      const ext = (Array.isArray(item.ext) ? item.ext : []).filter(object).map((e) => ({
        id: integer(e.id, 0, 0, 100000), level: integer(e.level, 1, 1, 3),
      })).filter((e) => e.id > 0).slice(0, 3);
      /* 【2026-11】外观差分（原版头 / 拳套的强化档画稿）：勇者外观件没有真词条，
       * 玩家在换装页挑的是 1~3 档里的哪一张画稿，这里原样存下来（绘制入口都读 tier）。 */
      let tier = integer(item.tier, 1, 1, 3);
      /* 现代模式：只保留 `images/battle/outfit/` 真的画得出来的套装；且**不做外观差分**，
       * 一套装备只有一张卡 / 一个造型，tier 统一为 1。否则详情页 / 战斗里那件（甚至整套）
       * 会直接消失，玩家看到的就是「没穿装备」。 */
      if (modernUi() && window.Engine && typeof Engine.hasModernOutfit === 'function') {
        const index = outfitIndexOf(setId);
        if (!Number.isFinite(index) || !Engine.hasModernOutfit(index)) continue;
        tier = 1;
      }
      const clean = { id, type, ext, tier, quality: quality, used: true };
      if (item.orange === true) { clean.orange = true; clean.quality = 4; }
      out.push(clean); parts.add(type);
    }
    return out;
  }
  function normalize(raw) {
    if (!object(raw)) return null;
    /* baseVer=1 才认玩家调过的四维；旧档（80/65/60/900）没有这个标记，回新的初始 65/65/65/800。 */
    const base = raw.baseVer === 1 ? cleanStats(raw.base) : initialStats();
    const towerBonus = cleanTowerBonus(raw.towerBonus);
    const hero = Object.assign({}, raw, { version: 1, baseVer: 1,
      base: Object.assign({}, CONFIG.base, base),
      weapons: [], skills: [], appearance: cleanAppearance(raw.appearance), upgradeFails: {}, uncapped: [],
      wins: integer(raw.wins, 0, 0, Number.MAX_SAFE_INTEGER),
      eliteWins: integer(raw.eliteWins, 0, 0, Number.MAX_SAFE_INTEGER),
      patrolWins: integer(raw.patrolWins, 0, 0, Number.MAX_SAFE_INTEGER),
      log: (Array.isArray(raw.log) ? raw.log : []).filter((s) => typeof s === 'string').slice(-20),
    });
    for (const kind of ['weapon', 'skill']) {
      const levels = new Map();
      for (const value of Array.isArray(listOf(raw, kind)) ? listOf(raw, kind) : []) {
        const hit = /^(\d+):(\d+)$/.exec(String(value));
        if (!hit) continue;
        const id = Number(hit[1]);
        if (!infoOf(kind, id)) continue;
        levels.set(id, Math.max(levels.get(id) || 1, integer(hit[2], 1, 1, 15)));
      }
      for (const [id, level] of levels) {
        listOf(hero, kind).push(id + ':' + level);
        const key = failKey(kind, id);
        if (level < 10 && !(kind === 'skill' && [6, 13].includes(id))) {
          const fails = integer(object(raw.upgradeFails) ? raw.upgradeFails[key] : 0, 0, 0, 999);
          if (fails > 0) hero.upgradeFails[key] = fails;
        }
      }
    }
    /* 只保留仍掌握着的「不占上限」标记：HS02 遗忘后旧标记不能在下次读档时复活。 */
    const ownedRefs = new Set(owned(hero).map((it) => it.ref));
    for (const rawRef of (Array.isArray(raw.uncapped) ? raw.uncapped : [])) {
      let ref = String(rawRef || '');
      if (/^\d+$/.test(ref)) ref = 'w:' + ref;             // 老/外部数据只写 id 时按武器处理
      if (ownedRefs.has(ref) && uncappedRefs(hero).indexOf(ref) < 0) hero.uncapped.push(ref);
    }
    /* 旧档兼容（2026-10 新口径）：以前 HS04 学会的武技没有 `uncapped` 标记，若总数已超过
     * 24，把第 25 项起的武技补成「不占上限」，否则读档后会被 24 上限反向锁死。
     * 旧 HS02 不改变总数、精英学习到 24 就停，超过 24 的来源只有 HS04，按末位补标记是安全的。 */
    const capped = owned(hero).filter((it) => !isUncapped(hero, it.ref));
    if (capped.length > CONFIG.normalLimit) {
      for (const it of capped.slice(CONFIG.normalLimit)) markUncapped(hero, it.ref);
    }
    if (towerBonus) hero.towerBonus = towerBonus;
    else delete hero.towerBonus;
    return count(hero) > 0 ? hero : null;
  }
  function repair(hero) {
    const clean = normalize(hero);
    if (!clean) return false;
    Object.assign(hero, clean);
    return true;
  }
  function create(options) {
    const opts = options || {}, picks = opts.picks;
    if (!Array.isArray(picks) || picks.length !== CONFIG.initialCount) return error('请选择恰好3个初始武器或技能。');
    const stats = cleanStats(opts.stats || opts.base);
    const hero = { version: 1, baseVer: 1, base: Object.assign({}, CONFIG.base, stats),
      weapons: [], skills: [], uncapped: [],
      appearance: cleanAppearance(opts.appearance), upgradeFails: {},
      wins: 0, eliteWins: 0, patrolWins: 0, log: [] };
    for (const value of picks) {
      const info = value && infoOf(value.kind, value.id);
      if (!info) return error('初始选择中包含不可学习的武器或技能。');
      if (owns(hero, info)) return error('初始武器或技能不能重复。');
      listOf(hero, info.kind).push(info.id + ':' + CONFIG.startLevel);
    }
    const label = '勇者已准备就绪：3个5级武技。';
    return { ok: true, hero, msg: label, label };
  }
  /** 勇者专属：武技真化后的白值乘数。真1~真4 ×1.5，真5 ×2；普通等级 ×1。 */
  function trueBaseMul(level) {
    const lv = Math.max(1, Math.min(15, Math.floor(Number(level) || 1)));
    return lv >= 15 ? 2 : lv >= 11 ? 1.5 : 1;
  }
  /** 勇者视角的武器白值：在 State.weaponInst 的基础上套真化白值乘数。 */
  function heroWeapon(raw) {
    const w = State.weaponInst(raw);
    if (!w) return null;
    const mul = trueBaseMul(w.level);
    return Object.assign(w, { harmLo: Math.round(w.harmLo * mul), harmHi: Math.round(w.harmHi * mul), trueBaseMul: mul });
  }
  function fighter(raw) {
    const hero = normalize(raw);
    if (!hero) return null;
    const bonus = hero.towerBonus || {};
    const baseMaxHp = hero.base.maxHp + (Number(bonus.maxHp) || 0);
    const me = { name: '勇者', level: 90,
      power: hero.base.power + (Number(bonus.power) || 0),
      agility: hero.base.agility + (Number(bonus.agility) || 0),
      speed: hero.base.speed + (Number(bonus.speed) || 0),
      hp: baseMaxHp, maxHp: baseMaxHp,
      weapons: hero.weapons.map((s) => heroWeapon(s)).filter(Boolean),
      skills: hero.skills.map((s) => State.skillInst(s)).filter(Boolean).map((s) =>
        Object.assign(s, { trueBaseMul: trueBaseMul(s.level) })),
      effects: {}, masterLevel: 0, pets: [], npcType: null, heroTrueBase: true,
      gears: hero.appearance.map((g) => Object.assign({}, g, { ext: g.ext.map((e) => Object.assign({}, e)) })),
    };
    for (const skill of me.skills) {
      const key = { 1: 'power', 2: 'agility', 3: 'speed', 4: 'maxHp' }[skill.id];
      if (key) me[key] += Math.round((Number(GData.passiveBonus(skill.id, skill.level)) || 0) * trueBaseMul(skill.level));
    }
    me.hp = me.maxHp;
    me.baseStats = { power: me.power, agility: me.agility, speed: me.speed };
    me.wears = Engine.wearsFor(me.gears);
    return me;
  }
  function upgrade(hero, ref, options) {
    if (!repair(hero)) return error('勇者数据无效。');
    const item = parseRef(ref), opts = options || {};
    if (!item || !owns(hero, item)) return error('勇者尚未掌握这个武技。');
    if (item.kind === 'skill' && [6, 13].includes(item.id)) return error('该技能不能升级。');
    const current = () => Number(listOf(hero, item.kind).find((s) => Number(s.split(':')[0]) === item.id).split(':')[1]);
    const before = current();
    if (before >= 15) return error(item.name + '已达到真5上限。');
    const wanted = integer(opts.attempts, 1, 1, 100), results = [];
    let successes = 0;
    for (let n = 0; n < wanted && current() < 15; n++) {
      const level = current(), row = upgradeMap.getValue(level);
      if (!row) break;
      const key = failKey(item.kind, item.id), isTrue = level >= 10;
      const fails = isTrue ? 0 : integer(hero.upgradeFails[key], 0, 0, 999);
      const rate = Math.min(100, Math.max(0, Number(row.rate) || 0) + (isTrue ? 0 : fails * HERO_FAIL_BONUS_PCT));
      const success = opts.guaranteed === true || roll(opts.rng) * 100 < rate;
      if (success) { setLevel(hero, item, level + 1); delete hero.upgradeFails[key]; successes++; }
      else if (!isTrue) hero.upgradeFails[key] = Math.min(999, fails + 1);
      else delete hero.upgradeFails[key];
      results.push({ level, rate, success, isTrue });
    }
    if (!results.length) return error('当前没有可用的升级规则。');
    const level = current(), last = results[results.length - 1];
    const label = successes > 0 ? item.name + '升级至' + levelLabel(level) +
      (results.length > 1 ? '（成功' + successes + '/' + results.length + '次）' : '')
      : item.name + '升级失败（成功率' + last.rate + '%）。';
    return { ok: true, ref: item.ref, name: item.name, before, level, successes,
      attempts: results.length, success: last.success, rate: last.rate, results, msg: label, label };
  }
  /** 只读的下一级信息（界面用）：当前等级、下一级成功率、失败保底次数、是否封顶/不可升级。
   *  与 `upgrade()` 用同一把尺子：普通 1~9 级的成功率吃「每次失败 +3%」，
   *  10 级及以上走真化固定行；技能 6 / 13 与 15 级封顶返回 `max: true`。 */
  function upgradeInfoOf(hero, ref) {
    if (!repair(hero)) return null;
    const item = parseRef(ref);
    if (!item || !owns(hero, item)) return null;
    const level = Number(String(listOf(hero, item.kind).find((s) => Number(s.split(':')[0]) === item.id)).split(':')[1]) || 1;
    const blocked = item.kind === 'skill' && [6, 13].includes(item.id);
    const max = blocked || level >= 15;
    if (max) {
      return { ref: item.ref, kind: item.kind, id: item.id, name: item.name, level,
        next: null, rate: null, fails: 0, max: true, blocked };
    }
    const row = upgradeMap.getValue(level);
    if (!row) return { ref: item.ref, kind: item.kind, id: item.id, name: item.name, level,
      next: null, rate: null, fails: 0, max: true, blocked };
    const isTrue = level >= 10;
    const fails = isTrue ? 0 : integer(hero.upgradeFails[failKey(item.kind, item.id)], 0, 0, 999);
    const rate = Math.min(100, Math.max(0, Number(row.rate) || 0) + (isTrue ? 0 : fails * HERO_FAIL_BONUS_PCT));
    return { ref: item.ref, kind: item.kind, id: item.id, name: item.name, level,
      next: level + 1, rate, fails, isTrue, max: false, blocked: false };
  }
  function learn(hero, options) {
    if (!repair(hero)) return error('勇者数据无效。');
    const opts = options || {}, atCap = cappedCount(hero) >= CONFIG.normalLimit;
    if (atCap && opts.special !== true) return Object.assign(error('已达到普通学习上限，仅特殊途径可以继续学习。'), { atCap: true });
    const pool = catalog().filter((it) => !owns(hero, it));
    /* 定向学习（HS02 自选、事件/测试也可以传）：`learnRef` 形如 `w:12` / `s:7`。 */
    const want = opts.learnRef ? parseRef(opts.learnRef) : null;
    const item = want || pick(pool, opts.rng);
    if (!item) return error('已经掌握所有可学习的武技。');
    if (owns(hero, item)) return error('已经掌握【' + item.name + '】。');
    /* 2026-10 用户口径：**所有新习得的武技都是 5 级**（精英领悟、授业事件、HS04 一致）。
     * 仍然允许显式传 level 给回归/调试，但缺省不再是 1 级。 */
    const level = integer(opts.level, CONFIG.startLevel, 1, 15);
    listOf(hero, item.kind).push(item.id + ':' + level);
    const ref = refOf(item.kind, item.id);
    if (opts.uncapped === true) markUncapped(hero, ref);
    const label = '领悟' + item.name + '（' + levelLabel(level) + '）' + (opts.uncapped ? '，不占24项上限' : '') + '。';
    return { ok: true, kind: item.kind, id: item.id, ref: ref, name: item.name,
      level, total: count(hero), capped: cappedCount(hero), uncapped: isUncapped(hero, ref),
      atCap: cappedCount(hero) >= CONFIG.normalLimit, special: opts.special === true,
      msg: label, label };
  }
  /* HS02：**自选**遗忘一个已学武技，再**自选**一个尚未掌握的武技；
   * 新武技继承被遗忘武技的等级（用户 2026-10 口径）。没有传 learnRef 时保留
   * 旧的随机替换行为，给调试/旧调用兜底；正常界面一定传自选目标。 */
  function replace(hero, ref, options) {
    if (!repair(hero)) return error('勇者数据无效。');
    const old = parseRef(ref), opts = options || {};
    if (!old || !owns(hero, old)) return error('勇者尚未掌握这个武技。');
    const pool = catalog().filter((it) => !owns(hero, it));
    const want = opts.learnRef ? parseRef(opts.learnRef) : null;
    if (opts.learnRef && !want) return error('要学习的武技不在可学习池里。');
    const next = want || pick(pool, opts.rng);
    if (!next) return error('没有尚未掌握的武技可以替换。');
    if (owns(hero, next)) return error('已经掌握【' + next.name + '】。');
    const level = Number(String(listOf(hero, old.kind).find((s) => Number(s.split(':')[0]) === old.id)).split(':')[1]) || 1;
    const wasUncapped = isUncapped(hero, old.ref);
    const arr = listOf(hero, old.kind), at = arr.findIndex((s) => Number(s.split(':')[0]) === old.id);
    arr.splice(at, 1);
    delete hero.upgradeFails[failKey(old.kind, old.id)];
    clearUncapped(hero, old.ref);
    const nextRef = refOf(next.kind, next.id);
    listOf(hero, next.kind).push(next.id + ':' + integer(level, 1, 1, 15));
    /* 遗忘的是 HS04 的免上限武技时，新武技继续免上限：否则「换招」会让
     * 24 项普通上限凭空多占 1 格。 */
    if (wasUncapped) markUncapped(hero, nextRef);
    const label = old.name + '已替换为' + next.name + '（继承' + levelLabel(integer(level, 1, 1, 15)) + '）' +
      (wasUncapped ? '，仍不占24项上限' : '') + '。';
    return { ok: true, removed: old.ref, removedLevel: level, kind: next.kind, id: next.id, ref: nextRef,
      name: next.name, level: integer(level, 1, 1, 15), uncapped: wasUncapped,
      total: count(hero), capped: cappedCount(hero), msg: label, label };
  }
  /* HS03：把一个选定武技直接升到满级（真5 = 15级）。 */
  function maxOut(hero, ref) {
    if (!repair(hero)) return error('勇者数据无效。');
    const item = parseRef(ref);
    if (!item || !owns(hero, item)) return error('勇者尚未掌握这个武技。');
    if (item.kind === 'skill' && [6, 13].includes(item.id)) return error('该技能不能升级。');
    const before = Number(String(listOf(hero, item.kind).find((s) => Number(s.split(':')[0]) === item.id)).split(':')[1]) || 1;
    if (before >= 15) return error(item.name + '已达到真5上限。');
    setLevel(hero, item, 15);
    delete hero.upgradeFails[failKey(item.kind, item.id)];
    const label = item.name + '直接升至真5（15级）。';
    return { ok: true, ref: item.ref, name: item.name, before, level: 15, msg: label, label };
  }
  /* 铸币修炼：非战斗期花 1 枚铸币，把选定武技随机提升 3~5 个小级（必定成功、封顶真5）。 */
  function addLevels(hero, ref, levels) {
    if (!repair(hero)) return error('勇者数据无效。');
    const item = parseRef(ref);
    if (!item || !owns(hero, item)) return error('勇者尚未掌握这个武技。');
    if (item.kind === 'skill' && [6, 13].includes(item.id)) return error('该技能不能升级。');
    const cur = () => Number(String(listOf(hero, item.kind).find((s) => Number(s.split(':')[0]) === item.id)).split(':')[1]) || 1;
    const before = cur();
    if (before >= 15) return error(item.name + '已达到真5上限。');
    const gain = integer(levels, 3, 1, 15);
    const after = Math.min(15, before + gain);
    setLevel(hero, item, after);
    delete hero.upgradeFails[failKey(item.kind, item.id)];
    const label = item.name + '从' + levelLabel(before) + '提升至' + levelLabel(after) + '（+' + (after - before) + '级）。';
    return { ok: true, ref: item.ref, name: item.name, before, level: after, gained: after - before,
      requested: gain, msg: label, label };
  }
  function grow(hero, options) {
    if (!repair(hero)) return error('勇者数据无效。');
    const opts = options || {}, candidates = owned(hero).filter((it) => it.level < 15 &&
      !(it.kind === 'skill' && [6, 13].includes(it.id)));
    hero.wins++;
    if (opts.elite) hero.eliteWins++;
    if (opts.patrol) hero.patrolWins++;
    const selected = pick(candidates, opts.rng);
    const upgraded = selected ? upgrade(hero, selected.ref, { rng: opts.rng }) : null;
    let learned = null, learnChance = 0;
    /* 每一层最后一场战斗都可能领悟新武技；第一层最后一战固定 100%。
     * 其余层按「当前已掌握武技总数」反比衰减（learnChanceForCount）。
     * 普通学习仍受 24 项上限限制；最后一战不再要求是精英战。 */
    if (opts.lastBattle === true && cappedCount(hero) < CONFIG.normalLimit) {
      learnChance = integer(opts.layer, 0, 0, Number.MAX_SAFE_INTEGER) === 1
        ? 1 : learnChanceForCount(count(hero));
      if (roll(opts.rng) < learnChance) learned = learn(hero, { rng: opts.rng });
    }
    const pieces = [upgraded && upgraded.label, learned && learned.label].filter(Boolean);
    const label = pieces.length ? pieces.join(' ') : '所有可升级武技均已满级。';
    const layer = integer(opts.layer, 0, 0, Number.MAX_SAFE_INTEGER);
    hero.log.push((layer > 0 ? '第' + layer + '层：' : '') + label);
    hero.log = hero.log.slice(-20);
    return { ok: true, upgrade: upgraded, learn: learned, learnChance: learnChance,
      atCap: cappedCount(hero) >= CONFIG.normalLimit, msg: label, label };
  }

  window.TowerHero = { CONFIG, catalog, create, normalize, fighter, grow, upgrade, upgradeInfoOf, replace, learn,
    maxOut, addLevels, cappedCount, uncappedCount: (hero) => uncappedRefs(hero).length,
    uncappedRefs, isUncapped, trueBaseMul, heroWeapon, learnChanceForCount, statRules: () => STAT_RULES, initialStats, adjustStat };
})();
