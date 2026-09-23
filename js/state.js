/* ============================================================
 * state.js — 玩家状态、存档、养成系统（武器/技能/装备/道具/关卡）
 * 数值规则复刻自原版 player.js 与 GameDict.js
 * ============================================================ */
(function () {
  'use strict';

  const testMode = typeof location !== 'undefined' && /(?:^|[?&])(?:test=[12]|qa=1)(?:&|$)/.test(location.search || '');
  const SAVE_KEY = testMode ? 'ssdz_test_save_v1' : 'ssdz_save_v1';
  const ENERGY_INTERVAL = 5 * 60 * 1000;
  let S = null; // 玩家状态
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const integer = (value, fallback, min) => Number.isFinite(Number(value)) && value !== null
    ? Math.max(min == null ? 0 : min, Math.floor(Number(value))) : fallback;

  function normalizeItems(items, map) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).map((item) => {
      const parts = String(item).split(/[:,]/);
      const id = Number(parts[0]);
      if (!map.getValue(id) || seen.has(id)) return null;
      seen.add(id);
      return id + ':' + Math.min(15, integer(parts[1], 1, 1));
    }).filter(Boolean);
  }

  // 旧版存档缺字段时补全独立副本；不重置已有等级、资源和关卡。
  function normalizeSave(raw) {
    const next = Object.assign(clone(GData.NEW_PLAYER), raw);
    for (const key of ['level', 'power', 'agility', 'speed', 'maxHp', 'maxEnergy']) {
      next[key] = integer(next[key], GData.NEW_PLAYER[key], 1);
    }
    for (const key of ['exp', 'energy', 'goldPoint', 'goldCup', 'dailyWins', 'allWins', 'dailyFails', 'allFails', 'reborn', 'joinRankCount', 'lotteryFree', 'woodRecord']) {
      next[key] = integer(next[key], GData.NEW_PLAYER[key]);
    }
    next.energy = Math.min(next.maxEnergy, next.energy);
    next.integral = next.integral == null ? null : integer(next.integral, 0);
    next.name = typeof next.name === 'string' && next.name.trim() ? next.name : '小松鼠';
    next.lastEnergyTs = Number(next.lastEnergyTs) > 0 ? Math.min(Date.now(), integer(next.lastEnergyTs, Date.now(), 1)) : Date.now();
    next.weapons = normalizeItems(next.weapons, weaponsMap);
    next.skills = normalizeItems(next.skills, skillsMap);
    for (const key of ['props', 'propsStates']) {
      const source = object(next[key]) ? next[key] : {};
      next[key] = {};
      for (const id of Object.keys(source)) {
        const count = integer(source[id], 0);
        if (propMap.getValue(id) && count > 0) next[key][id] = count;
      }
    }
    const usedSlots = new Set(), gearKeys = new Set();
    next.gears = (Array.isArray(next.gears) ? next.gears : []).filter((g) => object(g) && gearMap.getValue(g.id)).map((g, index) => {
      const info = gearInst(g.id);
      let key = typeof g.key === 'string' && g.key ? g.key : 'legacy_' + index;
      if (gearKeys.has(key)) key += '_' + index;
      gearKeys.add(key);
      const used = g.used === true && info.useLevel <= next.level && !usedSlots.has(info.type);
      if (used) usedSlots.add(info.type);
      return { id: info.id, key, used, ext: normalizeExt(g.ext) };
    });
    next.stages = object(next.stages) ? next.stages : {};
    const savedRuns = object(next.stageRuns) ? next.stageRuns : {};
    next.stageRuns = {};
    for (const id of Object.keys(savedRuns)) {
      const run = savedRuns[id];
      if (!npcOf(Number(id), 1) || !object(run)) continue;
      // A page reload interrupts playback, but never charges the entry/revival twice.
      next.stageRuns[id] = { npcIndex: Math.min(3, integer(run.npcIndex, 1, 1)), revives: Math.min(2, integer(run.revives, 0)), needsRevive: run.needsRevive === true };
    }
    for (const id of Object.keys(next.stages)) {
      const progress = next.stages[id];
      if (!npcOf(Number(id), 1) || !object(progress)) { delete next.stages[id]; continue; }
      // Older saves recorded only the next NPC. Preserve that already-paid run.
      if (!next.stageRuns[id] && (progress.keep === true || (!object(raw.stageRuns) && progress.passed !== true && Number(progress.npcIndex) > 1))) {
        next.stageRuns[id] = { npcIndex: Math.min(3, integer(progress.npcIndex, 1, 1)), revives: Math.min(2, integer(progress.revives, 0)), needsRevive: progress.revive === true };
      }
      next.stages[id] = { npcIndex: Math.min(3, integer(progress.npcIndex, 1, 1)), passed: progress.passed === true };
      if (next.stages[id].passed) next.stages[id].npcIndex = 3;
    }
    next.wears = object(next.wears) ? next.wears : {};
    // 师徒：旧存档只有 {name, level}，补齐属性/武器技能/日贡字段
    next.master = object(next.master) && typeof next.master.name === 'string' ? {
      name: next.master.name.slice(0, 20),
      level: integer(next.master.level, 1, 1),
      power: Number.isFinite(Number(next.master.power)) ? Number(next.master.power) : null,
      agility: Number.isFinite(Number(next.master.agility)) ? Number(next.master.agility) : null,
      speed: Number.isFinite(Number(next.master.speed)) ? Number(next.master.speed) : null,
      hp: Number.isFinite(Number(next.master.hp)) ? Number(next.master.hp) : null,
      weapons: Array.isArray(next.master.weapons) ? next.master.weapons.slice(0, 20) : [],
      skills: Array.isArray(next.master.skills) ? next.master.skills.slice(0, 20) : [],
    } : null;
    next.prentices = (Array.isArray(next.prentices) ? next.prentices : [])
      .filter((p) => object(p) && typeof p.name === 'string')
      .slice(0, 3)
      .map((p) => ({
        name: p.name.slice(0, 20),
        level: integer(p.level, 1, 1),
        power: integer(p.power, 0, 0), agility: integer(p.agility, 0, 0),
        speed: integer(p.speed, 0, 0), hp: integer(p.hp, 0, 0),
        weapons: Array.isArray(p.weapons) ? p.weapons.slice(0, 20) : [],
        skills: Array.isArray(p.skills) ? p.skills.slice(0, 20) : [],
        since: typeof p.since === 'string' ? p.since : '',
        lastExpDate: typeof p.lastExpDate === 'string' ? p.lastExpDate : '',
      }));
    next.masterKickDate = typeof next.masterKickDate === 'string' ? next.masterKickDate : '';
    next.battles = (Array.isArray(next.battles) ? next.battles : []).filter(validBattle).slice(0, 50);
    next.dailyClaimDate = typeof next.dailyClaimDate === 'string' ? next.dailyClaimDate : '';
    next.dailyStatsDate = typeof next.dailyStatsDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(next.dailyStatsDate) ? next.dailyStatsDate : '';
    next.shopPurchaseDate = typeof next.shopPurchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(next.shopPurchaseDate) ? next.shopPurchaseDate : '';
    next.shopPurchases = {};
    if (object(raw.shopPurchases)) for (const id of Object.keys(raw.shopPurchases)) {
      if (propMap.getValue(id)) next.shopPurchases[id] = integer(raw.shopPurchases[id], 0);
    }
    return next;
  }

  // ---------- 调试开关（js/debug.js 未加载时全部为关闭） ----------
  function debugOn(key) {
    try { return !!(window.Debug && window.Debug.enabled && window.Debug.enabled(key)); } catch (e) { return false; }
  }

  // ---------- 师徒系统 ----------
  // 收徒上限随师父等级变化：10 级前 1 个，10-19 级 2 个，20 级以上 3 个
  function apprenticeCap(level) {
    const lv = Number.isFinite(Number(level)) ? Number(level) : (S ? S.level : 1);
    return lv >= 20 ? 3 : lv >= 10 ? 2 : 1;
  }
  /** 拜师成功后自动学会的师父技能（原版技能 13＝师父驾到）。 */
  const MASTER_SKILL_ID = 13;
  const MASTER_SKILL_NAME = '师父驾到';
  /** 学习技能：已有则升级，返回本次结果（供界面提示）。
   *  拜师赠送的「师父驾到」不受武器/技能总数上限限制（剧情赠予）。 */
  function learnSkill(id, level) {
    id = Number(id);
    const base = skillsMap.getValue(id);
    if (!base) return { ok: false, msg: '没有这个技能' };
    const lv = Math.max(1, Math.min(15, Number(level) || 1));
    const entry = S.skills.find((s) => Number(String(s).split(':')[0]) === id);
    if (entry) {
      const cur = Number(String(entry).split(':')[1]) || 1;
      if (cur >= lv) return { ok: false, msg: '已经掌握【' + base.name + '】', name: base.name, level: cur, upgraded: false };
      S.skills[S.skills.indexOf(entry)] = id + ':' + lv;
      save();
      return { ok: true, msg: '【' + base.name + '】升到 ' + lv + ' 级', name: base.name, level: lv, upgraded: true };
    }
    S.skills.push(id + ':' + lv);
    save();
    return { ok: true, msg: '学会【' + base.name + '】', name: base.name, level: lv, upgraded: false };
  }
  /** 拜师：记录师父（含等级、属性快照）并自动学会师父驾到。 */
  function setMaster(master) {
    if (!master || !master.name) return { ok: false, msg: '师父信息无效' };
    S.master = {
      name: String(master.name).slice(0, 20),
      level: integer(master.level, 1, 1),
      power: Number.isFinite(Number(master.power)) ? Number(master.power) : null,
      agility: Number.isFinite(Number(master.agility)) ? Number(master.agility) : null,
      speed: Number.isFinite(Number(master.speed)) ? Number(master.speed) : null,
      hp: Number.isFinite(Number(master.hp)) ? Number(master.hp) : null,
      weapons: Array.isArray(master.weapons) ? master.weapons.slice() : [],
      skills: Array.isArray(master.skills) ? master.skills.slice() : [],
    };
    const learned = learnSkill(MASTER_SKILL_ID, 1);
    save();
    return { ok: true, master: S.master, learned };
  }
  /** 出师：解除与师父的关系（花费用由界面负责扣除）。 */
  function clearMaster() { S.master = null; save(); return true; }
  /** 收徒：把对手的三围/武器技能一并记下来，便于查看徒弟数据。 */
  function addPrentice(foe) {
    if (!foe || !foe.name) return { ok: false, msg: '徒弟信息无效' };
    if (S.prentices.length >= apprenticeCap(S.level)) return { ok: false, msg: '收徒名额已满' };
    if (S.prentices.some((p) => p.name === foe.name)) return { ok: false, msg: '已经收过这个徒弟了' };
    const row = {
      name: String(foe.name).slice(0, 20),
      level: integer(foe.level, 1, 1),
      power: integer(foe.power, 0, 0), agility: integer(foe.agility, 0, 0),
      speed: integer(foe.speed, 0, 0), hp: integer(foe.hp, 0, 0),
      weapons: Array.isArray(foe.weapons) ? foe.weapons.slice() : [],
      skills: Array.isArray(foe.skills) ? foe.skills.slice() : [],
      since: localDate(),
    };
    S.prentices.push(row);
    save();
    return { ok: true, apprentice: row };
  }
  function removePrentice(name) {
    const i = S.prentices.findIndex((p) => p.name === name);
    if (i < 0) return false;
    S.prentices.splice(i, 1);
    save();
    return true;
  }
  /** 单机模式的「日贡」：按徒弟等级算出一个固定经验量（徒弟自身不损失）。 */
  function apprenticeDailyExp(level) {
    const lv = integer(level, 1, 1);
    return Math.max(5, Math.round(lv * 3 + 5));
  }
  /** 徒弟当天为师父产出的经验合计。 */
  function apprenticeDailyTotal() {
    return (S.prentices || []).reduce((sum, p) => sum + apprenticeDailyExp(p.level), 0);
  }
  /** 领取徒弟日贡：每个徒弟每天一次，经验最终加到师父身上。 */
  function claimApprenticeExp() {
    const today = localDate();
    let total = 0, count = 0;
    for (const p of (S.prentices || [])) {
      if (p.lastExpDate === today) continue;
      p.lastExpDate = today;
      total += apprenticeDailyExp(p.level);
      count++;
    }
    if (!count) return { ok: false, msg: '今天的徒弟日贡已经领过了' };
    const ups = gainExp(total);
    save();
    return { ok: true, total, count, ups, msg: count + ' 个徒弟今天贡献了 ' + total + ' 经验' };
  }
  /** 师父每天可踢出 1 个徒弟。 */
  function canKickToday() {
    return (S.masterKickDate || '') !== localDate();
  }
  function kickPrentice(name) {
    if (!canKickToday()) return { ok: false, msg: '今天已经踢过一个徒弟了，明天再来' };
    const i = S.prentices.findIndex((p) => p.name === name);
    if (i < 0) return { ok: false, msg: '没有这个徒弟' };
    S.prentices.splice(i, 1);
    S.masterKickDate = localDate();
    save();
    return { ok: true, msg: '已让【' + name + '】离开师门' };
  }

  // ---------- 存档 ----------
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); return true; } catch (e) { return false; } }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!object(parsed)) return false;
        S = normalizeSave(parsed);
        syncDailyStats();
        return true;
      }
    } catch (e) {}
    return false;
  }
  /** 普通新建账号无武技；调试重置的 opts.weaponId / weaponLevel 可指定开局武器。 */
  function newGame(name, opts) {
    S = clone(GData.NEW_PLAYER);
    Object.assign(S, GData.initialStats());
    S.stageRuns = {};
    S.name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 20) : '小松鼠';
    S.lastEnergyTs = Date.now();
    S.dailyStatsDate = localDate();
    S.props = { 1: 3, 2: 2, 28: 1 }; // 送1级礼包
    const weaponId = opts && Number(opts.weaponId);
    if (Number.isSafeInteger(weaponId) && weaponsMap.getValue(weaponId)) {
      const level = Math.min(15, Math.max(1, integer(opts.weaponLevel, 1, 1)));
      S.weapons = [weaponId + ':' + level];
    }
    save();
  }
  function state() { return S; }

  // ---------- 体力（5分钟回1点，上限120） ----------
  function tickEnergy() {
    syncDailyStats();
    const now = Date.now();
    if (debugOn('infiniteEnergy')) { S.energy = S.maxEnergy; S.lastEnergyTs = now; return; }
    if (!Number.isFinite(S.lastEnergyTs) || S.lastEnergyTs <= 0 || S.lastEnergyTs > now) S.lastEnergyTs = now;
    if (S.energy >= S.maxEnergy) { S.lastEnergyTs = now; return; }
    const gain = Math.floor((now - S.lastEnergyTs) / ENERGY_INTERVAL);
    if (gain > 0) {
      S.energy = Math.min(S.maxEnergy, S.energy + gain);
      S.lastEnergyTs = S.energy === S.maxEnergy ? now : S.lastEnergyTs + gain * ENERGY_INTERVAL;
      save();
    }
  }
  function energyCountdown() {
    tickEnergy();
    if (S.energy >= S.maxEnergy) return '';
    const remain = Math.max(0, ENERGY_INTERVAL - (Date.now() - S.lastEnergyTs));
    const m = Math.floor(remain / 60000), s = Math.floor((remain % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------- 武器/技能实例（含等级换算，同原版 addWeapons） ----------
  /** 原版武器表里的全部武器（按编号排序），供调试面板选择开局武器。 */
  function weaponList() {
    const out = [];
    weaponsMap.each((id, v) => { if (v && +id > 0) out.push({ id: +id, name: v.name, harm: v.harm, type: v.type }); });
    return out.sort((a, b) => a.id - b.id);
  }
  function weaponInst(str) {
    const [id, rawLevel] = String(str).split(/[:,]/).map(Number);
    const level = Math.min(15, integer(rawLevel, 1, 1));
    const base = weaponsMap.getValue(id);
    if (!base) return null;
    const w = { id, level, name: base.name, type: base.type, remark: base.remark };
    const [lo, hi] = base.harm.split('-').map(Number);
    let add = 0;
    if (level <= 10) add = parseInt(base.harmAdd) * (level - 1);
    else {
      add = parseInt(base.harmAdd) * 9;
      const extra = base.harmAdd1.split('|').map(Number);
      for (let i = 0; i < level - 10 && i < extra.length; i++) add += extra[i];
    }
    w.harmLo = lo + add; w.harmHi = hi + add;
    return w;
  }
  function skillInst(str) {
    const [id, rawLevel] = String(str).split(/[:,]/).map(Number);
    const level = Math.min(15, integer(rawLevel, 1, 1));
    const base = skillsMap.getValue(id);
    if (!base) return null;
    return { id, level, name: base.name, type: base.type, remark: base.remark };
  }
  function myWeapons() { return S.weapons.map(weaponInst).filter(Boolean); }
  function mySkills() { return S.skills.map(skillInst).filter(Boolean); }

  // 武技位置随固定领悟等级开放；拜师赠送技能13不占随机领悟位置。
  function wsLimit() { return GData.wsLimit(S.level); }
  function ownedWSCount() { return S.weapons.length + S.skills.filter(s => Number(String(s).split(':')[0]) !== MASTER_SKILL_ID).length; }

  // ---------- 升级武器/技能（upgradeMap: 成功率/费用/卷轴/玩家等级限制） ----------
  function upgradeInfo(kind, id) {
    if (kind !== 'weapon' && kind !== 'skill') return null;
    id = Number(id);
    const list = kind === 'weapon' ? myWeapons() : mySkills();
    const it = list.find((x) => x.id === id);
    if (!it) return null;
    if (kind === 'skill' && [6, 13].includes(id)) return { max: true, fixed: true, item: it, msg: '该技能不能升级' };
    if (kind === 'skill' && it.level >= 10) return { max: true, item: it, msg: '技能已达到10级上限' };
    const row = upgradeMap.getValue(it.level); // 当前等级对应升级行
    if (!row) return { max: true };
    return {
      max: false, item: it, rate: parseInt(row.rate), coin: parseInt(row.coin),
      book: parseInt(row.book), levelLimit: parseInt(row.levelLimit),
      bookId: kind === 'weapon' ? 22 : 21,
    };
  }
  function doUpgrade(kind, id) {
    id = Number(id);
    const info = upgradeInfo(kind, id);
    if (!info || info.max) return { ok: false, msg: info && info.msg || '已经是最高等级了！' };
    if (!debugOn('freeUpgrade')) {
      if (S.level < info.levelLimit) return { ok: false, msg: `需要玩家等级达到${info.levelLimit}级` };
      if (S.goldPoint < info.coin) return { ok: false, msg: '金松果不足！' };
      if ((S.props[info.bookId] || 0) < info.book) return { ok: false, msg: (kind === 'weapon' ? '武器' : '技能') + '卷轴不足！' };
      S.goldPoint -= info.coin;
      if (info.book > 0) S.props[info.bookId] -= info.book;
    }
    const ok = debugOn('noUpgradeFail') ? true : Math.random() * 100 < info.rate;
    if (ok) {
      const arr = kind === 'weapon' ? S.weapons : S.skills;
      for (let i = 0; i < arr.length; i++) {
        const [wid, lv] = arr[i].split(':').map(Number);
        if (wid === id) { arr[i] = wid + ':' + (lv + 1); break; }
      }
    }
    save();
    return { ok, msg: ok ? '升级成功！' : '升级失败……再接再厉！', rate: info.rate };
  }

  // ---------- 装备 ----------
  let gearKeySeq = 1;
  function normalizeExt(ext) {
    return (Array.isArray(ext) ? ext : []).filter((e) => object(e) && attachmentMap.getValue(e.id)).map((e) => ({
      id: Number(e.id), level: Math.min(3, integer(e.level, 1, 1)),
    }));
  }
  function gearInst(id, ext) {
    const g = gearMap.getValue(id);
    if (!g) return null;
    const set = gearSetMap.getValue(g.setId);
    const type = parseInt(g.type); // 0头巾(敏捷) 1手套(力量) 2衣服(生命) 3鞋(速度)
    const abilityVal = parseInt(g.abilities.split(',')[type]);
    const attrName = ['敏捷', '力量', '生命', '速度'][type];
    const quality = parseInt(set ? set.quality : 0); // 0白1绿2蓝3紫
    return {
      id: parseInt(id), name: g.name, type, attrName, abilityVal, quality,
      useLevel: parseInt(set ? set.level : 1), price: parseInt(set ? set.price : 10),
      setId: parseInt(g.setId), ext: normalizeExt(ext),
    };
  }
  function myGears() {
    return S.gears.map((g) => Object.assign(gearInst(g.id, g.ext) || {}, { used: g.used, key: g.key })).filter((g) => g.name);
  }
  // 穿戴位: 0头巾 1手套 2衣服 3鞋
  function wear(gearKey) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g) return false;
    const gi = gearInst(g.id);
    if (!gi || S.level < gi.useLevel) return false;
    for (const o of S.gears) if (o.used && gearInst(o.id) && gearInst(o.id).type === gi.type) o.used = false;
    g.used = true; save(); return true;
  }
  function unwear(gearKey) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (g) { g.used = false; save(); }
  }
  function sellGear(gearKey) {
    const i = S.gears.findIndex((x) => x.key === gearKey);
    if (i < 0) return 0;
    const g = gearInst(S.gears[i].id);
    S.gears.splice(i, 1);
    S.goldPoint += g.price; save();
    return g.price;
  }
  // 碎片合成: 24白/25绿/26蓝 ×10 + 50金松果 → 随机装备
  function composeGear(propId) {
    propId = Number(propId);
    if (![24, 25, 26].includes(propId)) return { ok: false, msg: '请选择装备碎片' };
    if ((S.props[propId] || 0) < 10) return { ok: false, msg: '碎片不足10个！' };
    if (S.goldPoint < 50) return { ok: false, msg: '金松果不足50！' };
    const quality = { 24: 0, 25: 1, 26: 2 }[propId];
    const candidates = [];
    gearSetMap.each((k, v) => { if (parseInt(v.quality) === quality) candidates.push(parseInt(v.id)); });
    const setId = candidates[Math.floor(Math.random() * candidates.length)];
    const gearsOfSet = [];
    gearMap.each((k, v) => { if (parseInt(v.setId) === setId) gearsOfSet.push(parseInt(v.id)); });
    const gid = gearsOfSet[Math.floor(Math.random() * gearsOfSet.length)];
    S.props[propId] -= 10; S.goldPoint -= 50;
    const g = addGear(gid, quality >= 2 ? randomExt(1) : []);
    save();
    return { ok: true, gear: g };
  }
  // 融合: 3件同名同品质 → 高一级品质（简化：3件蓝→随机紫）
  function mergeGears(keys) {
    if (!Array.isArray(keys) || keys.length !== 3 || new Set(keys).size !== 3) return { ok: false, msg: '请选择三件不同的装备' };
    const gs = keys.map((k) => S.gears.find((x) => x.key === k)).filter(Boolean);
    if (gs.length !== 3) return { ok: false, msg: '装备不存在' };
    if (gs.some((g) => g.used)) return { ok: false, msg: '不能融合已穿戴的装备' };
    if (S.goldPoint < 50) return { ok: false, msg: '融合费用不足（50金松果）' };
    const setIds = gs.map((g) => parseInt(gearMap.getValue(g.id).setId));
    if (new Set(gs.map((g) => g.id)).size !== 1) return { ok: false, msg: '需要三件同名同品质的装备' };
    const set = gearSetMap.getValue(setIds[0]);
    const q = parseInt(set.quality);
    if (q >= 3) return { ok: false, msg: '已是最高品质，无法融合' };
    const candidates = [];
    gearSetMap.each((k, v) => { if (parseInt(v.quality) === q + 1) candidates.push(parseInt(v.id)); });
    const newSet = candidates[Math.floor(Math.random() * candidates.length)];
    const gearsOfSet = [];
    gearMap.each((k, v) => { if (parseInt(v.setId) === newSet) gearsOfSet.push(parseInt(v.id)); });
    S.goldPoint -= 50;
    S.gears = S.gears.filter((g) => !keys.includes(g.key));
    const g = addGear(gearsOfSet[Math.floor(Math.random() * gearsOfSet.length)], q + 1 >= 2 ? randomExt(q >= 2 ? 2 : 1) : []);
    save();
    return { ok: true, gear: g };
  }
  function randomExt(n) {
    const ext = [];
    const ids = attachmentMap.keys.slice();
    for (let i = 0; i < n; i++) {
      const aid = parseInt(ids[Math.floor(Math.random() * ids.length)]);
      ext.push({ id: aid, level: 1 + Math.floor(Math.random() * 3) });
    }
    return ext;
  }
  function extText(ext) {
    return (ext || []).map((e) => {
      const a = attachmentMap.getValue(e.id);
      if (!a) return '';
      const v = a.ability.split(',')[Math.min(e.level - 1, a.ability.split(',').length - 1)];
      return a.name.replace('N', v);
    }).filter(Boolean);
  }
  function addGear(id, ext) {
    const info = gearInst(id, ext);
    if (!info) return null;
    let key;
    do { key = 'g' + Date.now() + '_' + (gearKeySeq++); } while (S.gears.some((g) => g.key === key));
    S.gears.push({ id: info.id, used: false, key, ext: info.ext });
    save();
    return Object.assign(info, { key, used: false });
  }

  // 原装备界面规则：同种附加能力不叠加，只取最高一条。
  function equipmentEffects() {
    const effects = {};
    for (const gear of S.gears) {
      if (!gear.used) continue;
      const info = gearInst(gear.id);
      if (!info || S.level < info.useLevel) continue;
      for (const ext of normalizeExt(gear.ext)) {
        const values = attachmentMap.getValue(ext.id).ability.split(',').map(Number);
        effects[ext.id] = Math.max(effects[ext.id] || 0, values[ext.level - 1]);
      }
    }
    return effects;
  }

  // ---------- 属性合计（基础+装备+药剂状态） ----------
  function totalStats(opts) {
    opts = opts || {};
    let power = S.power, agility = S.agility, speed = S.speed, hp = S.maxHp;
    for (const g of S.gears) {
      if (!g.used) continue;
      const gi = gearInst(g.id);
      if (!gi || S.level < gi.useLevel) continue;
      if (gi.type === 0) agility += gi.abilityVal;
      else if (gi.type === 1) power += gi.abilityVal;
      else if (gi.type === 2) hp += gi.abilityVal;
      else speed += gi.abilityVal;
    }
    // 被动技能
    const sk = mySkills();
    const has = (id) => sk.find((x) => x.id === id);
    const effects = equipmentEffects();
    let t;
    if ((t = has(1))) power += GData.passiveBonus(1, t.level) * (1 + (effects[27] || 0) / 100);
    if ((t = has(2))) agility += GData.passiveBonus(2, t.level) * (1 + (effects[28] || 0) / 100);
    if ((t = has(3))) speed += GData.passiveBonus(3, t.level) * (1 + (effects[29] || 0) / 100);
    if ((t = has(4))) hp += GData.passiveBonus(4, t.level) * (1 + (effects[30] || 0) / 100);
    // 药剂状态（挑战类战斗生效，关卡/竞技无效）
    if (opts.useProps !== false) {
      const st = S.propsStates || {};
      if (st[3] > 0) power = Math.max(power + Math.ceil(power * 0.2), power + 5);
      if (st[4] > 0) agility = Math.max(agility + Math.ceil(agility * 0.2), agility + 5);
      if (st[5] > 0) speed = Math.max(speed + Math.ceil(speed * 0.2), speed + 5);
      if (st[41] > 0) power += Math.max(Math.ceil(power * 0.4), 10);
      if (st[42] > 0) agility += Math.max(Math.ceil(agility * 0.4), 10);
      if (st[43] > 0) speed += Math.max(Math.ceil(speed * 0.4), 10);
    }
    return { power: Math.round(power), agility: Math.round(agility), speed: Math.round(speed), hp: Math.round(hp) };
  }

  // ---------- 道具 ----------
  function shopLimit(id) {
    const prop = propMap.getValue(Number(id));
    if (!prop) return 0;
    return [13, 16, 17, 18, 19, 37, 38, 47, 48].includes(Number(id)) || /宝箱|魔法袋|礼包|永久/.test(prop.name) ? 1 : 5;
  }
  function syncShopPurchases() {
    const date = localDate();
    if (S.shopPurchaseDate === date && object(S.shopPurchases)) return;
    if ((S.shopPurchaseDate && S.shopPurchaseDate !== date) || !object(S.shopPurchases)) S.shopPurchases = {};
    S.shopPurchaseDate = date;
    save();
  }
  function purchaseStatus(id) {
    id = Number(id);
    syncShopPurchases();
    const prop = propMap.getValue(id), limit = shopLimit(id), bought = integer(S.shopPurchases[id], 0);
    const buyable = !!prop && prop.buy === 'true';
    return { date: S.shopPurchaseDate, limit, bought, remaining: buyable ? Math.max(0, limit - bought) : 0, buyable };
  }
  function buyProp(id, count) {
    id = Number(id);
    const p = propMap.getValue(id);
    if (!p || p.buy !== 'true') return { ok: false, msg: '该物品不出售' };
    count = count == null ? 1 : Number(count);
    if (!Number.isSafeInteger(count) || count <= 0) return { ok: false, msg: '购买数量必须是正整数' };
    const status = purchaseStatus(id);
    if (count > status.remaining) return { ok: false, limited: true, msg: status.remaining ? `今日还可购买${status.remaining}个${p.name}` : `${p.name}今日已达限购${status.limit}个`, ...status };
    const cost = parseInt(p.price) * count;
    if (!Number.isSafeInteger(cost) || cost < 0) return { ok: false, msg: '商品价格无效' };
    if (!debugOn('freeShop')) {
      if (S.goldPoint < cost) return { ok: false, msg: '金松果不足！' };
      S.goldPoint -= cost;
    }
    S.props[id] = (S.props[id] || 0) + count;
    S.shopPurchases[id] = status.bought + count;
    save();
    return { ok: true, msg: `购买了${p.name}x${count}`, ...purchaseStatus(id) };
  }
  function useProp(id, param) {
    id = parseInt(id);
    if ((S.props[id] || 0) <= 0) return { ok: false, msg: '没有该道具' };
    const p = propMap.getValue(id);
    if (!p) return { ok: false, msg: '没有该道具' };
    let msg = '使用成功';
    switch (id) {
      case 1: case 2: {
        tickEnergy();
        if (S.energy >= S.maxEnergy) return { ok: false, msg: '体力已满，无需使用药剂' };
        const restored = Math.min(id === 1 ? 10 : 30, S.maxEnergy - S.energy);
        S.energy += restored;
        if (S.energy === S.maxEnergy) S.lastEnergyTs = Date.now();
        msg = '恢复体力' + restored + '点';
        break;
      }
      case 3: case 4: case 5: case 7: case 41: case 42: case 43: case 44:
        S.propsStates[id] = 20; msg = p.name + '生效，持续20次战斗'; break;
      case 10: case 11: case 12: { // 转化丸
        const from = id === 10 ? 'power' : id === 11 ? 'agility' : 'speed';
        const total = S.power + S.agility + S.speed;
        if (S[from] < total * 0.25) return { ok: false, msg: '该属性占比过低，不能使用' };
        const to = param === 'power' || param === 'agility' || param === 'speed' ? param : (['power', 'agility', 'speed'].filter((x) => x !== from))[Math.floor(Math.random() * 2)];
        if (to === from) return { ok: false, msg: '请选择另一种属性' };
        S[from]--;
        S[to]++;
        msg = '属性转换成功';
        break;
      }
      case 13: { // 转生果
        if (S.level >= 50) return { ok: false, msg: '达到50级后不能转生' };
        S.level = 1; S.exp = 0; Object.assign(S, GData.initialStats());
        S.weapons = []; S.skills = []; S.reborn++;
        for (const gear of S.gears) gear.used = false;
        msg = '转生成功！回到1级，装备保留';
        break;
      }
      case 16: S.power++; msg = '力量永久+1'; break;
      case 17: S.agility++; msg = '敏捷永久+1'; break;
      case 18: S.speed++; msg = '速度永久+1'; break;
      case 19: S.maxHp += 5; msg = '生命永久+5'; break;
      case 37: { // 属性书：8点自由分配，不替玩家自动选择。
        const attrs = ['power', 'agility', 'speed'];
        if (!object(param) || attrs.some(attr => !Number.isSafeInteger(param[attr]) || param[attr] < 0) || attrs.reduce((sum, attr) => sum + param[attr], 0) !== 8) {
          return { ok: false, needsAllocation: true, msg: '请将8点属性分配到力量、敏捷和速度' };
        }
        for (const attr of attrs) S[attr] += param[attr];
        msg = `力量+${param.power} 敏捷+${param.agility} 速度+${param.speed}`;
        break;
      }
      case 38: { const g = 20 + Math.floor(Math.random() * 80); S.goldPoint += g; msg = `打开红包，获得${g}金松果！`; break; }
      case 47: { // 天使果实
        const r = gainRandomWS();
        if (!r) return { ok: false, msg: '获得失败：可能已达上限或运气不佳' };
        msg = '获得了 ' + r.name + '！';
        break;
      }
      case 48: { // 恶魔果实
        const all = [...S.weapons.map((w) => 'w' + w), ...S.skills.map((s) => 's' + s)];
        if (all.length <= 1) return { ok: false, msg: '没有可以遗忘的武器或技能' };
        const pick = all[Math.floor(Math.random() * all.length)];
        if (pick[0] === 'w') S.weapons.splice(S.weapons.indexOf(pick.slice(1)), 1);
        else S.skills.splice(S.skills.indexOf(pick.slice(1)), 1);
        msg = '遗忘成功';
        break;
      }
      case 28: case 29: case 30: case 31: case 32: case 49: { // 礼包
        const gift = giftMap.getValue(id);
        if (!gift) return { ok: false, msg: '礼包数据缺失' };
        if (S.level < parseInt(gift.level)) return { ok: false, msg: `需要${gift.level}级才能打开` };
        const got = [];
        for (const item of gift.prize.split('|')) {
          const [pid, num] = item.split(':').map(Number);
          if (pid === 8) { S.goldPoint += num; got.push(`金松果x${num}`); }
          else { S.props[pid] = (S.props[pid] || 0) + num; const pp = propMap.getValue(pid); got.push((pp ? pp.name : pid) + 'x' + num); }
        }
        msg = '获得：' + got.join('、');
        break;
      }
      default:
        return { ok: false, msg: '该道具不能直接使用' };
    }
    S.props[id]--;
    if (S.props[id] <= 0) delete S.props[id];
    save();
    return { ok: true, msg };
  }
  // 天使果实/升级：随机获得新武器或技能
  function gainRandomWS() {
    const ownedW = S.weapons.map((w) => parseInt(w.split(':')[0]));
    const ownedS = S.skills.map((s) => parseInt(s.split(':')[0]));
    if (ownedWSCount() >= wsLimit()) return null;
    const pool = [];
    weaponsMap.each((k, v) => { if (!ownedW.includes(parseInt(v.id)) && GData.canLearn('weapon', v.id, S.level)) pool.push('w' + v.id); });
    skillsMap.each((k, v) => { if (!ownedS.includes(parseInt(v.id)) && GData.canLearn('skill', v.id, S.level)) pool.push('s' + v.id); });
    if (!pool.length) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick[0] === 'w') {
      const id = Number(pick.slice(1));
      S.weapons.push(id + ':1');
      return { name: weaponsMap.getValue(id).name, id, kind: 'weapon' };
    }
    const id = Number(pick.slice(1));
    S.skills.push(id + ':1');
    return { name: skillsMap.getValue(id).name, id, kind: 'skill' };
  }

  // ---------- 经验 / 升级 ----------
  // 返回升级信息数组（可能连升）
  function gainExp(amount) {
    const ups = [];
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= 0) return ups;
    S.exp += Math.round(amount);
    while (S.exp >= GData.nextExp(S.level)) {
      S.exp -= GData.nextExp(S.level);
      S.level++;
      const bookLevel = GData.ATTRIBUTE_BOOK_LEVELS.includes(S.level);
      const growth = { power: 0, agility: 0, speed: 0, hp: bookLevel ? 0 : 5 };
      if (bookLevel) S.props[37] = (S.props[37] || 0) + 1;
      else for (let point = 0; point < 3; point++) {
        const attr = ['power', 'agility', 'speed', 'hp'][Math.floor(Math.random() * 4)];
        growth[attr] += attr === 'hp' ? 5 : 1;
      }
      const { power: pw, agility: ag, speed: sp, hp } = growth;
      S.power += pw; S.agility += ag; S.speed += sp; S.maxHp += hp;
      // 升级奖励：概率获得新武器/技能（reward 为 {name,id,kind} 或 null）
      const gained = GData.WS_LEVELS.includes(S.level) ? gainRandomWS() : null;
      if (S.level === 5 && !S.reborn) S.goldPoint += 50;
      ups.push({
        level: S.level, power: pw, agility: ag, speed: sp, hp,
        reward: gained ? gained.name : null,
        rewardId: gained ? gained.id : null,
        rewardKind: gained ? gained.kind : null,
        attributeBook: bookLevel,
      });
    }
    save();
    return ups;
  }

  // ---------- 战斗后结算（挑战玩家） ----------
  function consumeEnergy(n) {
    n = Number(n);
    if (!Number.isSafeInteger(n) || n < 0) return false;
    tickEnergy();
    if (debugOn('infiniteEnergy')) return true;
    if (S.energy < n) return false;
    S.energy -= n;
    save();
    return true;
  }
  function tickPropStates() {
    for (const k of Object.keys(S.propsStates)) {
      if (S.propsStates[k] > 0) S.propsStates[k]--;
    }
  }
  // 战斗奖励（挑战/竞技胜利）
  function fightReward(win, opts) {
    opts = opts || {};
    const expBase = win ? 10 + Math.floor(Math.random() * 10) : 4 + Math.floor(Math.random() * 4);
    let expMul = 1;
    if (opts.useProps !== false && S.propsStates[7] > 0) expMul += 0.4;
    if (opts.useProps !== false && S.propsStates[44] > 0) expMul += 0.6;
    const gold = win ? 3 + Math.floor(Math.random() * 5) : (Math.random() < 0.3 ? 1 : 0);
    S.goldPoint += gold;
    const ups = gainExp(expBase * expMul);
    if (opts.useProps !== false) tickPropStates();
    save();
    return { exp: Math.round(expBase * expMul), gold, ups };
  }

  // ---------- AI 玩家生成 ----------
  /** AI 名字池：固定昵称池 + 前缀后缀组合，组合空间远大于固定名单。 */
  const AI_PREFIX = ['松果', '橡果', '坚果', '瓜子', '松针', '尾巴', '树梢', '森林', '飞天', '闪电', '暴躁', '萌萌',
    '快乐', '无敌', '狂战', '吃瓜', '鼠胆', '大尾', '老', '小', '铁齿', '铜牙', '旋风', '疾风'];
  const AI_CORE = ['小弟', '小鼠', '大侠', '无双', '王者', '姐姐', '妹妹', '群众', '英雄', '达人', '杀手', '猎手',
    '终结者', '收藏家', '舞者', '王子', '公主', '一霸', '战神', '掌门', '小旋风', '大魔王', '掌门人', '小队长'];
  const AI_NICK = ['吱吱喳喳', '鼠你最棒', '鼠不尽的快乐', '鼠来运转', '松鼠妹妹', '啃果群众', '尾巴翘翘', '闪电鼠',
    '吃瓜小鼠', '鼠胆英雄', '森林一霸', '松果收藏家', '暴躁小鼠', '快乐松鼠', '鼠大王', '松涛依旧', '坚果猎人',
    '瓜子杀手', '老松鼠', '鼠门弄斧', '松间明月', '大尾巴狼', '树梢舞者', '松针小王子', '橡果终结者'];

  const AI_TITLE = ['', '', '', '', '的师傅', '的师兄', '的宿敌', '二世'];

  /** 随机生成一个对手名字：固定昵称池或「前缀+核心词」，少数带称号。 */
  function randomAIName(rng) {
    const r = typeof rng === 'function' ? rng : Math.random;
    // 固定昵称（已经朗朗上口，不加称号）
    if (r() < 0.3) return AI_NICK[Math.floor(r() * AI_NICK.length)];
    const name = AI_PREFIX[Math.floor(r() * AI_PREFIX.length)] + AI_CORE[Math.floor(r() * AI_CORE.length)];
    // 称号只加在组合名上，且不超过 12 字
    const title = AI_TITLE[Math.floor(r() * AI_TITLE.length)];
    return (name + title).slice(0, 12);
  }

  /**
   * 生成一个对手。
   * opts.levelJitter：在 level 上下浮动的等级范围（默认 ±2）
   * opts.gear：是否按等级随机穿戴装备（默认按玩家等级判断）
   * opts.gearSelfLevel：按对手自身等级装备（默认 false，用玩家等级判断解锁）
   * opts.name：直接指定名字
   */
  function genAI(level, nameSuffix, opts) {
    opts = opts || {};
    level = integer(level, 1, 1);
    const jitter = Number.isFinite(opts.levelJitter) ? Math.max(0, Math.floor(opts.levelJitter)) : 2;
    const rolled = jitter ? integer(level + Math.floor(Math.random() * (2 * jitter + 1)) - jitter, 1, 1) : level;
    const finalLevel = Math.max(1, rolled);
    const name = (opts.name ? String(opts.name) : randomAIName()) + (nameSuffix || '');
    // 三围围绕等级浮动，幅度略放大让同級对手也有差异
    const base = (x) => Math.round(6 + finalLevel * 2 * (0.72 + Math.random() * 0.62) + x);
    const wsPool = [];
    weaponsMap.each((k, v) => { if (GData.canLearn('weapon', v.id, finalLevel)) wsPool.push(parseInt(v.id)); });
    const skPool = [];
    skillsMap.each((k, v) => { if (GData.canLearn('skill', v.id, finalLevel)) skPool.push(parseInt(v.id)); });
    const nWS = Math.min(GData.wsLimit(finalLevel), 7);
    const weapons = [], skills = [];
    for (let i = 0; i < nWS; i++) {
      const isWeapon = Math.random() < 0.55;
      const pool = isWeapon ? wsPool : skPool;
      if (!pool.length) break;
      const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      // 等级越高，武器/技能等级也跟着水涨船高（上限 15）
      const hi = Math.min(15, 1 + Math.floor(finalLevel / 3));
      (isWeapon ? weapons : skills).push(id + ':' + (1 + Math.floor(Math.random() * hi)));
    }
    const foe = {
      name, level: finalLevel, power: base(0), agility: base(-2), speed: base(-2),
      hp: 50 + finalLevel * 8 + Math.floor(Math.random() * finalLevel * 3), weapons, skills, isAI: true,
    };
    // 装备：等级越高穿得越多、品质越好，并随机带附加属性
    const playerLevel = S && Number.isFinite(S.level) ? S.level : 1;
    const gearLevel = opts.gearSelfLevel ? finalLevel : Math.max(playerLevel, 1);
    if (opts.gear !== false) foe.gears = randomAIGears(finalLevel, gearLevel);
    for (const value of skills) {
      const skill = skillInst(value);
      const stat = { 1: 'power', 2: 'agility', 3: 'speed', 4: 'hp' }[skill.id];
      if (stat) foe[stat] += GData.passiveBonus(skill.id, skill.level);
    }
    return foe;
  }

  /** 按等级随机穿装备：品质随等级放宽，件数随机，附加属性也随机。 */
  function randomAIGears(foeLevel, refLevel) {
    const level = Math.max(1, Math.floor(refLevel || foeLevel || 1));
    const sets = [];
    gearSetMap.each((id, set) => {
      if (set && Number(set.level) <= level) sets.push({ id: Number(id), level: Number(set.level), quality: parseInt(set.quality) || 0 });
    });
    if (!sets.length) return [];
    // 等级越高穿得越全
    const wearChance = Math.min(0.95, 0.35 + level / 60);
    const out = [];
    const usedType = new Set();
    for (const set of sets) {
      if (Math.random() > wearChance) continue;
      const gearsOfSet = [];
      gearMap.each((k, v) => { if (parseInt(v.setId) === set.id) gearsOfSet.push(parseInt(v.id)); });
      if (!gearsOfSet.length) continue;
      const gid = gearsOfSet[Math.floor(Math.random() * gearsOfSet.length)];
      const info = gearInst(gid);
      if (!info || usedType.has(info.type)) continue;   // 同部位不重复穿
      usedType.add(info.type);
      // 附加属性：白装没有，绿/蓝装越到后面越常见
      let ext = [];
      const roll = Math.random();
      if (level >= 8 && roll < 0.28) ext = randomExt(1);
      else if (level >= 20 && roll < 0.42) ext = randomExt(1 + (Math.random() < 0.35 ? 1 : 0));
      out.push({ id: gid, used: true, ext });
      if (usedType.size >= 4) break;
    }
    return out;
  }

  // ---------- 关卡 ----------
  function stageProgress(stageId) {
    return clone(S.stages[stageId] || { npcIndex: 1, passed: false });
  }
  function setStageProgress(stageId, prog) {
    stageId = Number(stageId);
    if (!npcOf(stageId, 1) || !object(prog)) return false;
    const previous = stageProgress(stageId);
    const passed = previous.passed || prog.passed === true;
    S.stages[stageId] = { npcIndex: passed ? 3 : Math.min(3, Math.max(previous.npcIndex, integer(prog.npcIndex, 1, 1))), passed };
    save();
    return true;
  }
  function npcOf(stageId, npcIndex) {
    stageId = Number(stageId); npcIndex = Number(npcIndex);
    let found = null;
    npcsMap.each((k, v) => {
      // Recovered dictionary typo: #127 is 4-star crane (stage 10), not stage 4.
      const actualStage = Number(v.id) === 127 ? 10 : Number(v.stageId);
      if (actualStage === stageId && Number(v.npcIndex) === npcIndex) found = actualStage === Number(v.stageId) ? v : Object.assign({}, v, { stageId: String(actualStage) });
    });
    return found;
  }

  // Original Mission: level 10, six sequential difficulties per master, one
  // challenge book per three-NPC run; one extra book per revival (maximum two).
  function highestStageId() {
    let highest = 1;
    for (const id of Object.keys(S.stages)) if (S.stages[id].passed) highest = Math.max(highest, Number(id) + 1);
    return highest;
  }
  function stageRun(stageId) { return S.stageRuns && S.stageRuns[stageId] ? clone(S.stageRuns[stageId]) : null; }
  function stageAccess(stageId) {
    stageId = Number(stageId);
    if (!Number.isInteger(stageId) || !npcOf(stageId, 1)) return { ok: false, msg: '没有这个关卡。' };
    if (S.level < 10) return { ok: false, msg: '没有10级，不能挑战我们盖世五侠哦，加油哦！' };
    // A migrated old run remains resumable even if the old client let it bypass a lock.
    if (stageId > highestStageId() && !stageRun(stageId)) return { ok: false, msg: '请先通过前面关卡。' };
    return { ok: true };
  }
  function stageReward(stageId) {
    return { exp: 19 + (Number(stageId) - 1) * 3, gold: 25 };
  }
  let stageAttemptSeq = 0;
  function beginStageBattle(stageId) {
    stageId = Number(stageId);
    const access = stageAccess(stageId);
    if (!access.ok) return access;
    S.stageRuns = S.stageRuns || {};
    let run = S.stageRuns[stageId];
    if (run && run.attempt) return { ok: false, msg: '这场战斗尚未结束。' };
    if (run && run.needsRevive && run.revives >= 2) return { ok: false, msg: '本轮已用完2次复活机会，请结束本轮后重新挑战。' };
    const costsBook = !run || run.needsRevive;
    if (costsBook && !debugOn('noStageCost')) {
      if (!(S.props[23] > 0)) return { ok: false, needsBook: true, msg: '挑战书不足，快去商店中购买吧！' };
      S.props[23]--;
    }
    if (!run) run = S.stageRuns[stageId] = { npcIndex: 1, revives: 0, needsRevive: false };
    else if (run.needsRevive) { run.revives++; run.needsRevive = false; }
    run.attempt = 'stage_' + Date.now() + '_' + (++stageAttemptSeq);
    save();
    return { ok: true, npcIndex: run.npcIndex, token: run.attempt };
  }
  function interruptStageBattle(stageId, token) {
    const run = S.stageRuns && S.stageRuns[stageId];
    if (!run || run.attempt !== token) return false;
    delete run.attempt;
    save();
    return true;
  }
  function finishStageBattle(stageId, token, win) {
    stageId = Number(stageId);
    const run = S.stageRuns && S.stageRuns[stageId];
    if (!run || run.attempt !== token) return { ok: false };
    delete run.attempt;
    if (!win) {
      run.needsRevive = true;
      save();
      return { ok: true, win: false, complete: false, exp: 0, gold: 0, ups: [], run: stageRun(stageId) };
    }
    const complete = run.npcIndex === 3;
    const old = stageProgress(stageId);
    const nextNpc = Math.min(3, run.npcIndex + 1);
    S.stages[stageId] = { npcIndex: Math.max(old.npcIndex, nextNpc), passed: old.passed || complete };
    if (complete) delete S.stageRuns[stageId];
    else run.npcIndex = nextNpc;
    // 攻略确认末位NPC结算、每次0–6片、螳螂/仙鹤/熊猫以白/绿/蓝为主。
    // 原服务器概率未留存，沿用离线掉落概率，仅还原能够确认的时点、数量与类别。
    const star = GData.stageStar(stageId);
    let drop = null;
    if (complete && Math.random() < 0.25 + star * 0.05) {
      const id = 24 + Math.floor((stageId - 1) / 6), count = 1 + Math.floor(Math.random() * 6);
      S.props[id] = (S.props[id] || 0) + count;
      drop = { id, count, name: propMap.getValue(id).name };
    }
    const reward = complete ? stageReward(stageId) : { exp: 0, gold: 0 };
    S.goldPoint += reward.gold;
    const ups = complete ? gainExp(reward.exp) : [];
    save();
    return Object.assign({ ok: true, win: true, complete, drop, ups, run: stageRun(stageId) }, reward);
  }
  function abandonStageRun(stageId) {
    if (!S.stageRuns || !S.stageRuns[stageId] || S.stageRuns[stageId].attempt) return false;
    delete S.stageRuns[stageId];
    save();
    return true;
  }

  // 本地日历日期，避免 UTC 日期造成午夜前后重复领取或晚八小时刷新。
  function localDate() {
    const now = new Date(Date.now());
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  function syncDailyStats() {
    const date = localDate();
    if (S.dailyStatsDate === date) return;
    // 旧档没有日期时先标记今天，保留已累计的当日数据。
    if (S.dailyStatsDate) {
      S.dailyWins = 0;
      S.dailyFails = 0;
      S.joinRankCount = 0;
    }
    S.dailyStatsDate = date;
    save();
  }
  function dailyStatus() {
    const date = localDate();
    return { date, claimed: S.dailyClaimDate === date, gold: 150, challengeBooks: 1 };
  }
  function claimDaily() {
    const daily = dailyStatus();
    if (daily.claimed) return { ok: false, msg: '今天的奖励已经领取，明天再来吧！', date: daily.date };
    S.goldPoint += daily.gold;
    S.props[23] = (S.props[23] || 0) + daily.challengeBooks;
    S.dailyClaimDate = daily.date;
    save();
    return { ok: true, msg: '领取成功：金松果 +150，挑战书 +1', gold: daily.gold, challengeBooks: daily.challengeBooks, date: daily.date };
  }

  function validBattle(entry) {
    return object(entry) && object(entry.me) && object(entry.foe) && object(entry.result)
      && Array.isArray(entry.result.rounds) && entry.result.rounds.length > 0 && entry.result.rounds.length <= 240
      && Array.isArray(entry.result.maxHp) && entry.result.maxHp.length === 2 && entry.result.maxHp.every((hp) => Number.isFinite(hp) && hp > 0)
      && entry.result.rounds.every((round) => object(round) && (round.attacker === 0 || round.attacker === 1)
        && Array.isArray(round.hpAfter) && round.hpAfter.length === 2 && round.hpAfter.every((hp) => Number.isFinite(hp) && hp >= 0))
      && (entry.result.winner === 0 || entry.result.winner === 1);
  }
  let battleKeySeq = 1;
  function recordBattle(entry) {
    if (!validBattle(entry)) return null;
    let snapshot;
    try { snapshot = clone(entry); } catch (e) { return null; }
    do { snapshot.id = 'b' + Date.now() + '_' + battleKeySeq++; } while ((S.battles || []).some((battle) => battle.id === snapshot.id));
    snapshot.createdAt = Date.now();
    snapshot.kind = typeof snapshot.kind === 'string' ? snapshot.kind : '挑战';
    snapshot.region = integer(snapshot.region, 0);
    snapshot.winner = snapshot.result.winner;
    S.battles = [snapshot].concat(S.battles || []).slice(0, 50);
    save();
    return clone(snapshot);
  }
  function battleHistory() { return clone(S.battles || []); }

  window.State = {
    saveKey: SAVE_KEY,
    save, load, newGame, state, tickEnergy, energyCountdown,
    weaponInst, skillInst, myWeapons, mySkills, wsLimit,
    upgradeInfo, doUpgrade,
    weaponList,
    gearInst, myGears, wear, unwear, sellGear, composeGear, mergeGears, addGear, extText, randomExt,
    totalStats, equipmentEffects, shopLimit, purchaseStatus, buyProp, useProp, gainRandomWS,
    gainExp, consumeEnergy, tickPropStates, fightReward,
    // 师徒
    apprenticeCap, learnSkill, setMaster, clearMaster, addPrentice, removePrentice,
    apprenticeDailyExp, apprenticeDailyTotal, claimApprenticeExp, canKickToday, kickPrentice,
    MASTER_SKILL_ID, MASTER_SKILL_NAME,
    genAI, stageProgress, setStageProgress, npcOf, highestStageId, stageRun, stageAccess, stageReward,
    beginStageBattle, finishStageBattle, interruptStageBattle, abandonStageRun,
    localDate, dailyStatus, claimDaily, recordBattle, battleHistory,
  };
})();
