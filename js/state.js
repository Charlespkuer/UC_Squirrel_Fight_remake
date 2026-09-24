/* ============================================================
 * state.js — 玩家状态、存档、养成系统（武器/技能/装备/道具/关卡）
 * 数值规则复刻自原版 player.js 与 GameDict.js
 * ============================================================ */
(function () {
  'use strict';

  const testMode = typeof location !== 'undefined' && /(?:^|[?&])(?:test=[12]|qa=1)(?:&|$)/.test(location.search || '');
  const SAVE_KEY = testMode ? 'ssdz_test_save_v1' : 'ssdz_save_v1';
  const ENERGY_INTERVAL = 5 * 60 * 1000;
  /* 使用药剂可以把体力顶到上限之上，最高 999；超过上限的部分只是不再自然回复，
   * 不会被清掉。maxEnergy 仍然是自然回复/每日回复的目标上限。 */
  const ENERGY_HARD_CAP = 999;
  /* 单个道具的数量上限：任何来源（掉落、礼包、任务、商店、调试）都不会超过它。
   * 收口放在 save()/normalizeSave 里，这样新增道具的地方不用各自记一遍。 */
  const PROP_HARD_CAP = 9999;
  /* 满级 70 级（原版也是到 70 级封顶）。
   * 体力上限由等级决定：1 级 90 点，2~3 级每级 +3、4~20 级每级 +2、21~70 级每级 +1，
   * 合计 +6+34+50 = 90 → 69 级正好 179、满级 70 级 180
   * （低等级段从原来的 +3/+2 降下来，成长更多地摊到 21 级以后）。 */
  const MAX_PLAYER_LEVEL = 70;
  function energyCapForLevel(level) {
    const lv = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.round(Number(level) || 1)));
    let cap = GData.NEW_PLAYER.maxEnergy;
    for (let i = 2; i <= lv; i++) cap += i <= 3 ? 3 : i <= 20 ? 2 : 1;
    return cap;
  }
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
    next.level = Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(next.level, GData.NEW_PLAYER.level, 1)));
    for (const key of ['power', 'agility', 'speed', 'maxHp']) {
      next[key] = integer(next[key], GData.NEW_PLAYER[key], 1);
    }
    for (const key of ['exp', 'energy', 'goldPoint', 'goldCup', 'dailyWins', 'allWins', 'dailyFails', 'allFails', 'reborn', 'joinRankCount', 'lotteryFree', 'woodRecord']) {
      next[key] = integer(next[key], GData.NEW_PLAYER[key]);
    }
    // 体力上限由等级直接决定（满级 180），再叠上超级松鼠的增量；旧档的旧曲线超额值在这里被收回。
    {
      const v = object(raw.vip) ? raw.vip : {};
      const vipBonus = v.capApplied === true ? Math.max(0, integer(v.capAdded, 0)) : 0;
      next.maxEnergy = energyCapForLevel(next.level) + vipBonus;
    }
    next.energy = Math.min(ENERGY_HARD_CAP, next.energy);
    next.integral = next.integral == null ? null : integer(next.integral, 0);
    next.name = typeof next.name === 'string' && next.name.trim() ? next.name : '小松鼠';
    next.lastEnergyTs = Number(next.lastEnergyTs) > 0 ? Math.min(Date.now(), integer(next.lastEnergyTs, Date.now(), 1)) : Date.now();
    next.weapons = normalizeItems(next.weapons, weaponsMap);
    next.skills = normalizeItems(next.skills, skillsMap);
    for (const key of ['props', 'propsStates']) {
      const source = object(next[key]) ? next[key] : {};
      next[key] = {};
      for (const id of Object.keys(source)) {
        const count = Math.min(PROP_HARD_CAP, integer(source[id], 0));
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
      const entry = { id: info.id, key, used, ext: normalizeExt(g.ext) };
      if (g.orange === true) entry.orange = true;
      const gemLv = g.gem && gemLevel(g.gem.id);
      if (gemLv) entry.gem = { id: 100 + gemLv, ext: Math.max(1, Math.min(99, integer(g.gem.ext, 1, 1))) };
      return entry;
    });
    next.stages = object(next.stages) ? next.stages : {};
    const savedRuns = object(next.stageRuns) ? next.stageRuns : {};
    next.stageRuns = {};
    for (const id of Object.keys(savedRuns)) {
      const run = savedRuns[id];
      if (!npcOf(Number(id), 1) || !object(run)) continue;
      // A page reload interrupts playback, but never charges the entry/revival twice.
      next.stageRuns[id] = { npcIndex: Math.min(3, integer(run.npcIndex, 1, 1)), revives: Math.min(2, integer(run.revives, 0)), needsRevive: run.needsRevive === true };
      if (Number.isFinite(Number(run.carryHp))) next.stageRuns[id].carryHp = Math.max(0, Math.min(1, Number(run.carryHp)));
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
        exp: integer(p.exp, 0),
        power: integer(p.power, 0, 0), agility: integer(p.agility, 0, 0),
        speed: integer(p.speed, 0, 0), hp: integer(p.hp, 0, 0),
        weapons: Array.isArray(p.weapons) ? p.weapons.slice(0, 20) : [],
        skills: Array.isArray(p.skills) ? p.skills.slice(0, 20) : [],
        since: validLocalDate(p.since) ? p.since : localDate(),
        joinedAt: Number(p.joinedAt) > 0 ? Number(p.joinedAt) : localDateTime(validLocalDate(p.since) ? p.since : localDate(), 0, 0),
        lastExpDate: typeof p.lastExpDate === 'string' ? p.lastExpDate : '',
        tributeClaimedDate: validLocalDate(p.tributeClaimedDate) ? p.tributeClaimedDate : '',
        tributeLedger: normalizeTributeLedger(p.tributeLedger),
      }));
    // Reload cancels an unfinished local recruitment and returns its entry fee.
    if (object(next.recruitChallenge) && next.recruitChallenge.fee === 10 && typeof next.recruitChallenge.token === 'string') next.goldPoint += 10;
    next.recruitChallenge = null;
    next.masterKickDate = typeof next.masterKickDate === 'string' ? next.masterKickDate : '';
    // 超级松鼠（原版 VIP）：旧档没有这个字段，补一份未开通的默认值。
    {
      const v = object(raw.vip) ? raw.vip : {};
      next.vip = {
        level: Math.max(1, Math.min(VIP_MAX_LEVEL, integer(v.level, 1) || 1)),
        exp: Math.max(0, integer(v.exp, 0)),
        until: Math.max(0, integer(v.until, 0)),
        capAdded: Math.max(0, integer(v.capAdded, 0)),
        capApplied: v.capApplied === true,
        lastDaily: typeof v.lastDaily === 'string' ? v.lastDaily : '',
      };
    }
    next.battles = (Array.isArray(next.battles) ? next.battles : []).filter(validBattle).slice(0, 50);
    // 好友：只保留名字合法的条目，等级夹在 1~满级，最多 20 位
    next.friends = (Array.isArray(raw.friends) ? raw.friends : []).filter((f) => object(f) && typeof f.name === 'string' && f.name.trim())
      .slice(0, FRIEND_LIMIT).map((f) => ({
        name: String(f.name).trim().slice(0, 20),
        level: Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(f.level, 1, 1))),
        power: integer(f.power, GData.NEW_PLAYER.power, 1),
        agility: integer(f.agility, GData.NEW_PLAYER.agility, 1),
        speed: integer(f.speed, GData.NEW_PLAYER.speed, 1),
        hp: integer(f.hp, GData.NEW_PLAYER.maxHp, 1),
        note: typeof f.note === 'string' ? f.note.slice(0, 12) : '',
        since: validLocalDate(f.since) ? f.since : localDate(),
      }));
    next.dailyClaimDate = typeof next.dailyClaimDate === 'string' ? next.dailyClaimDate : '';
    // 每日任务：旧档没有就留空，首次打开「活动」时按当天补上
    next.quests = object(raw.quests) && Array.isArray(raw.quests.list) && typeof raw.quests.date === 'string' ? raw.quests : null;
    next.dailyCounters = object(raw.dailyCounters) && typeof raw.dailyCounters.date === 'string' ? raw.dailyCounters : null;
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
      exp: integer(foe.exp, 0),
      power: integer(foe.power, 0, 0), agility: integer(foe.agility, 0, 0),
      speed: integer(foe.speed, 0, 0), hp: integer(foe.hp, 0, 0),
      weapons: Array.isArray(foe.weapons) ? foe.weapons.slice() : [],
      skills: Array.isArray(foe.skills) ? foe.skills.slice() : [],
      since: localDate(),
      joinedAt: Date.now(), tributeClaimedDate: '', tributeLedger: [],
    };
    if (!row.skills.some(skill => Number(String(skill).split(':')[0]) === MASTER_SKILL_ID)) row.skills.push(MASTER_SKILL_ID + ':1');
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
  function validLocalDate(date) { return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date); }
  function localDateTime(date, hour, minute) { const [y,m,d] = date.split('-').map(Number); return new Date(y,m-1,d,hour,minute).getTime(); }
  function yesterdayDate() {
    const date = new Date(Date.now()); date.setDate(date.getDate()-1);
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  }
  const TRIBUTE_KINDS = ['challenge', 'challenged', 'stage', 'arena', 'pickup', 'lottery'];
  function normalizeTributeLedger(ledger) {
    return (Array.isArray(ledger) ? ledger : []).filter(day => object(day) && validLocalDate(day.date) && Array.isArray(day.activities)).slice(-7).map(day => ({
      date: day.date, simulated: day.simulated === true,
      activities: day.activities.filter(a => object(a) && TRIBUTE_KINDS.includes(a.kind)).slice(0,64).map(a => ({
        kind: a.kind, exp: integer(a.exp,0), entry: a.entry === 'energy' ? 'energy' : a.entry === 'ticket' ? 'ticket' : '',
        at: integer(a.at,0),
      })),
    }));
  }
  /** Original ratios: challenge/passive challenge/stage 10%, energy-entry XP arena 5%.
   * Pickup, lottery and ticket-entry arena XP are deliberately excluded. */
  function apprenticeTribute(activities) {
    let tenths = 0, twentieths = 0;
    for (const a of Array.isArray(activities) ? activities : []) {
      const exp = integer(a.exp,0);
      if (['challenge','challenged','stage'].includes(a.kind)) tenths += exp;
      else if (a.kind === 'arena' && a.entry === 'energy') twentieths += exp;
    }
    return Math.floor((tenths * 2 + twentieths) / 20);
  }
  function simulateApprenticeDay(p, date) {
    let seed = 2166136261;
    for (const ch of p.name+'|'+p.since+'|'+date) seed = Math.imul(seed ^ ch.charCodeAt(0),16777619) >>> 0;
    const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed / 4294967296; };
    const joinedAt = Number(p.joinedAt) || localDateTime(p.since,0,0), activities = [];
    const add = (kind,exp,hour,minute,entry) => { const at = localDateTime(date,hour,minute); if (at >= joinedAt) activities.push({kind,exp,at,entry:entry||''}); };
    // A finite offline timetable, not a claim about original server activity volumes.
    add('challenge',10+Math.floor(random()*10),9,10);
    add('challenge',10+Math.floor(random()*10),12,30);
    add('challenged',4+Math.floor(random()*4),15,10);
    add('challenge',10+Math.floor(random()*10),18,40);
    if (p.level >= 11) add('arena',random()<0.5?75:150,19,20,random()<0.75?'energy':'ticket');
    if (p.level >= 10) add('stage',stageReward(Math.min(18,Math.max(1,Math.floor((p.level-7)/3)))).exp,20,10);
    add('pickup',5,21,0);
    if (random()<0.5) add('lottery',50,22,0);
    return {date,simulated:true,activities};
  }
  function apprenticeDailyStatus(apprentice) {
    const p = object(apprentice) ? apprentice : null, today = localDate(), date = yesterdayDate();
    if (!p) return {date,exp:0,claimable:false,claimed:false,activities:[],simulated:true};
    if (!validLocalDate(p.since)) { p.since=today; p.joinedAt=Date.now(); save(); }
    const claimed = p.lastExpDate===today || p.tributeClaimedDate===date;
    if (p.since>date) return {date,exp:0,claimable:false,claimed,activities:[],simulated:true,newApprentice:true};
    p.tributeLedger = normalizeTributeLedger(p.tributeLedger);
    let day = p.tributeLedger.find(day=>day.date===date);
    if (!day) {
      day=simulateApprenticeDay(p,date);p.tributeLedger.push(day);p.tributeLedger=p.tributeLedger.slice(-7);save();
    }
    const exp=apprenticeTribute(day.activities);
    return {date,exp,claimable:!claimed&&exp>0,claimed,activities:clone(day.activities),simulated:day.simulated};
  }
  function apprenticeDailyExp(apprentice) { return apprenticeDailyStatus(apprentice).exp; }
  function apprenticeDailyTotal() {
    return (S.prentices||[]).reduce((sum,p)=>{const daily=apprenticeDailyStatus(p);return sum+(daily.claimable?daily.exp:0);},0);
  }
  function claimApprenticeExp() {
    const today=localDate();let total=0,count=0;
    for (const p of S.prentices||[]) {
      const daily=apprenticeDailyStatus(p);if(!daily.claimable)continue;
      p.lastExpDate=today;p.tributeClaimedDate=daily.date;total+=daily.exp;count++;
    }
    if (!count) return {ok:false,msg:'暂无可领取的昨日日贡，新收徒需等待次日结算。'};
    const ups=gainExp(total);save();
    return {ok:true,total,count,ups,msg:count+'个徒弟昨日战斗贡献了'+total+'经验'};
  }
  let recruitSequence=0;
  function beginRecruitChallenge(candidate) {
    if (!object(candidate)||!candidate.name) return {ok:false,msg:'请选择收徒对象'};
    if (S.recruitChallenge) return {ok:false,msg:'收徒挑战尚未结束'};
    if (S.prentices.length>=apprenticeCap(S.level)) return {ok:false,msg:'收徒名额已满'};
    if (S.prentices.some(p=>p.name===String(candidate.name).slice(0,20))) return {ok:false,msg:'已经收过这个徒弟了'};
    if (S.goldPoint<10) return {ok:false,msg:'收徒挑战需要10金松果'};
    const token='recruit_'+Date.now()+'_'+(++recruitSequence);
    S.goldPoint-=10;S.recruitChallenge={token,fee:10,candidate:clone(candidate)};save();
    return {ok:true,token,foe:clone(object(candidate.master)&&candidate.master.name?candidate.master:candidate)};
  }
  function cancelRecruitChallenge(token) {
    if (!S.recruitChallenge||S.recruitChallenge.token!==token)return false;
    S.goldPoint+=S.recruitChallenge.fee;S.recruitChallenge=null;save();return true;
  }
  function finishRecruitChallenge(token,win) {
    const run=S.recruitChallenge;if(!run||run.token!==token)return {ok:false};
    S.recruitChallenge=null;
    const added=win?addPrentice(run.candidate):null;
    tickPropStates();const exp=win?20:0,ups=gainExp(exp);save();
    return {ok:true,win,exp,gold:0,ups,recruited:added&&added.ok?added.apprentice:null,
      msg:win?(added.ok?'收【'+run.candidate.name+'】为徒！':added.msg):'收徒挑战失败，提升实力后再来。'};
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
  /** 把 S.props 里超过上限的数量收口（save 前统一调用）。 */
  function clampProps() {
    if (!S || !object(S.props)) return;
    for (const id of Object.keys(S.props)) {
      const count = Number(S.props[id]);
      if (!Number.isFinite(count)) { delete S.props[id]; continue; }
      if (count > PROP_HARD_CAP) S.props[id] = PROP_HARD_CAP;
      else if (count < 0) delete S.props[id];
    }
  }
  function save() { try { clampProps(); localStorage.setItem(SAVE_KEY, JSON.stringify(S)); return true; } catch (e) { return false; } }
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
    S.friends = [];
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

  // ---------- 体力（5分钟回1点，初始上限90，升级提升上限） ----------
  function tickEnergy() {
    syncDailyStats();
    const now = Date.now();
    if (debugOn('infiniteEnergy')) { S.energy = S.maxEnergy; S.lastEnergyTs = now; return; }
    syncVipEnergyCap();
    tickVipDaily();
    // 超级松鼠特权 3：体力恢复速度 1.1~1.5 倍
    const interval = ENERGY_INTERVAL / vipRegenMul();
    if (!Number.isFinite(S.lastEnergyTs) || S.lastEnergyTs <= 0 || S.lastEnergyTs > now) S.lastEnergyTs = now;
    if (S.energy >= S.maxEnergy) { S.lastEnergyTs = now; return; }
    const gain = Math.floor((now - S.lastEnergyTs) / interval);
    if (gain > 0) {
      S.energy = Math.min(S.maxEnergy, S.energy + gain);
      S.lastEnergyTs = S.energy === S.maxEnergy ? now : S.lastEnergyTs + gain * interval;
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

  /** 批量使用道具（目前只对药剂有意义）：一次用 count 个，返回合并结果。
   *  count 传 'all' 就用背包里全部（受硬上限 999 限制）。 */
  function usePropMany(id, count) {
    id = parseInt(id);
    const held = S.props[id] || 0;
    if (held <= 0) return { ok: false, msg: '没有该道具', used: 0 };
    let want = count === 'all' ? held : Math.max(1, Math.floor(Number(count) || 1));
    want = Math.min(want, held);
    if (id !== 1 && id !== 2) {
      // 其它道具没有「批量」概念，退化成单个使用
      const one = useProp(id);
      return { ok: one.ok, used: one.ok ? 1 : 0, msg: one.msg };
    }
    let used = 0, stopMsg = '';
    for (let i = 0; i < want; i++) {
      const r = useProp(id);
      if (!r.ok) { stopMsg = r.msg; break; }
      used++;
    }
    const name = (propMap.getValue(id) || {}).name || '药剂';
    return {
      ok: used > 0, used,
      msg: used ? '使用 ' + name + ' ×' + used + '　体力 ' + S.energy + '/' + S.maxEnergy + '（上限 ' + ENERGY_HARD_CAP + '）'
        : (stopMsg || '无法使用'),
    };
  }
  function energyHardCap() { return ENERGY_HARD_CAP; }

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

  /** 原版技能表里的全部技能（按编号排序），供调试面板快速获得/遗忘。 */
  function skillList() {
    const out = [];
    skillsMap.each((id, v) => { if (v && +id > 0) out.push({ id: +id, name: v.name, type: v.type }); });
    return out.sort((a, b) => a.id - b.id);
  }
  /** 调试/工具用：直接获得（或改等级）指定武器/技能；已有就替换等级（可以调低）。 */
  function setWS(kind, id, level) {
    const map = kind === 'skill' ? skillsMap : weaponsMap;
    const def = map.getValue(Number(id));
    if (!def) return { ok: false, msg: '没有这个' + (kind === 'skill' ? '技能' : '武器') };
    const lv = Math.min(15, integer(level, 1, 1));
    const arr = kind === 'skill' ? S.skills : S.weapons;
    const at = arr.findIndex((x) => Number(String(x).split(':')[0]) === Number(id));
    const entry = Number(id) + ':' + lv;
    if (at >= 0) arr[at] = entry; else arr.push(entry);
    save();
    return { ok: true, kind, id: Number(id), level: lv, name: def.name, replaced: at >= 0, total: ownedWSCount(), limit: wsLimit() };
  }
  /** 调试/工具用：遗忘指定武器/技能。 */
  function forgetWS(kind, id) {
    const arr = kind === 'skill' ? S.skills : S.weapons;
    const at = arr.findIndex((x) => Number(String(x).split(':')[0]) === Number(id));
    if (at < 0) return { ok: false, msg: '还没有这个' + (kind === 'skill' ? '技能' : '武器') };
    const def = (kind === 'skill' ? skillsMap : weaponsMap).getValue(Number(id));
    arr.splice(at, 1);
    save();
    return { ok: true, kind, id: Number(id), name: def ? def.name : String(id), total: ownedWSCount(), limit: wsLimit() };
  }
  const setWeapon = (id, level) => setWS('weapon', id, level);
  const setSkill = (id, level) => setWS('skill', id, level);
  const forgetWeapon = (id) => forgetWS('weapon', id);
  const forgetSkill = (id) => forgetWS('skill', id);

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
      bumpDaily('upgrade', 1);
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
    return S.gears.map((g) => {
      const info = gearInst(g.id, g.ext);
      if (!info) return null;
      const out = Object.assign(info, { used: g.used, key: g.key });
      if (g.orange === true) { out.orange = true; out.quality = 4; }   // 传说（橙）为实例级品质
      if (g.gem && gemLevel(g.gem.id)) out.gem = { id: Number(g.gem.id), ext: g.gem.ext };
      return out;
    }).filter(Boolean);
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
  /* 背包里可以直接卖的道具（装备走 sellGear）：天使果实 100 金松果一个。
   * 表放在这里，以后要加别的可卖道具只改这一处。 */
  const SELLABLE_PROPS = { 47: 100 };
  const propSellPrice = (id) => SELLABLE_PROPS[Number(id)] || 0;
  const sellableProps = () => Object.keys(SELLABLE_PROPS).map(Number);
  /** 卖出背包道具（最多持有数量），返回获得的金松果。 */
  function sellProp(id, count) {
    id = Number(id);
    const price = propSellPrice(id);
    if (!price) return { ok: false, msg: '这个道具不能卖' };
    const held = S.props[id] || 0;
    if (held < 1) return { ok: false, msg: '背包里没有这个道具' };
    const n = Math.max(1, Math.min(held, Math.round(Number(count) || 1)));
    S.props[id] = held - n;
    if (S.props[id] <= 0) delete S.props[id];
    const gold = price * n;
    S.goldPoint += gold;
    save();
    const item = propMap.getValue(id);
    return { ok: true, sold: n, gold, price, msg: '卖出 ' + (item ? item.name : '道具') + ' ×' + n + '，获得 ' + gold + ' 金松果' };
  }
  // ---------- 宝石（45级开启） ----------
  function gemLevel(id) { id = Number(id); return id >= 101 && id <= 107 ? id - 100 : 0; }
  // 合成成功率：1→2 为 60%，逐级 -10%，6→7 仅 10%
  const GEM_MERGE_RATES = [0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
  /** 45级起，关卡通关与竞技场获胜有几率获得1级（75%）或2级（25%）宝石。 */
  function rollGemDrop(chancePct) {
    if (S.level < 45 || Math.random() * 100 >= chancePct) return null;
    const id = Math.random() < 0.25 ? 102 : 101;
    S.props[id] = (S.props[id] || 0) + 1;
    return { id, name: propMap.getValue(id).name };
  }
  /** 3个同级宝石 + 10金松果 → 有几率合成高一级；失败照扣费用，50%几率一颗材料降1级（1级碎裂）。 */
  function mergeGems(id) {
    id = Number(id);
    const lv = gemLevel(id);
    if (!lv) return { ok: false, msg: '请选择宝石' };
    if (lv >= 7) return { ok: false, msg: '七级宝石已是最高等级' };
    if ((S.props[id] || 0) < 3) return { ok: false, msg: '需要 3 个同级宝石' };
    if (S.goldPoint < 10) return { ok: false, msg: '金松果不足 10 个' };
    S.props[id] -= 3; S.goldPoint -= 10;
    if (Math.random() < GEM_MERGE_RATES[lv - 1]) {
      S.props[id + 1] = (S.props[id + 1] || 0) + 1;
      save();
      return { ok: true, success: true, msg: '合成成功：' + propMap.getValue(id + 1).name + ' ×1' };
    }
    if (Math.random() < 0.5) {
      if (lv > 1) S.props[id - 1] = (S.props[id - 1] || 0) + 1;   // 退回一个降1级的
      save();
      return { ok: true, success: false, msg: lv > 1 ? '合成失败！一颗宝石降为 ' + propMap.getValue(id - 1).name : '合成失败！一颗宝石碎裂了' };
    }
    save();
    return { ok: true, success: false, msg: '合成失败，宝石没有变化' };
  }
  /** 镶嵌免费；每件橙装限1颗；附加属性提升幅度随机，拆卸后重新镶嵌可重随。 */
  function socketGem(gearKey, gemId) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g) return { ok: false, msg: '装备不存在' };
    if (g.orange !== true) return { ok: false, msg: '只有橙色（传说）装备可以镶嵌宝石' };
    if (g.gem) return { ok: false, msg: '每件装备最多镶嵌 1 颗宝石，请先拆卸原有宝石' };
    const lv = gemLevel(gemId);
    if (!lv || !(S.props[gemId] > 0)) return { ok: false, msg: '没有该宝石' };
    S.props[gemId]--;
    g.gem = { id: Number(gemId), ext: lv * (2 + Math.floor(Math.random() * 3)) };
    save();
    return { ok: true, msg: propMap.getValue(gemId).name + ' 镶嵌成功：主属性 +' + lv * 4 + '%，附加属性效果 +' + g.gem.ext + '%' };
  }
  function unsocketGem(gearKey) {
    const g = S.gears.find((x) => x.key === gearKey);
    if (!g || !g.gem) return { ok: false, msg: '该装备没有镶嵌宝石' };
    if (S.goldPoint < 5) return { ok: false, msg: '拆卸需要 5 金松果' };
    S.goldPoint -= 5;
    S.props[g.gem.id] = (S.props[g.gem.id] || 0) + 1;
    delete g.gem;
    save();
    return { ok: true, msg: '拆卸成功，宝石已放回背包' };
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
    const g = addGear(gid, quality >= 2 ? randomExt(1, 2) : []);
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
    if (gs.some((g) => g.orange)) return { ok: false, msg: '传说装备已是最高品质' };
    if (q >= 3) {
      // 3件相同紫装 → 同名橙装（传说），继承三件材料中各词条的最高星级
      S.goldPoint -= 50;
      S.gears = S.gears.filter((g) => !keys.includes(g.key));
      const best = {};
      for (const g of gs) for (const e of normalizeExt(g.ext)) best[e.id] = Math.max(best[e.id] || 0, e.level);
      const ext = Object.keys(best).slice(0, 3).map((id) => ({ id: Number(id), level: best[id] }));
      const made = addGear(gs[0].id, ext);
      const inst = made && S.gears.find((x) => x.key === made.key);
      if (inst) { inst.orange = true; save(); }
      return { ok: true, gear: Object.assign(made || {}, { orange: true, quality: 4 }) };
    }
    const candidates = [];
    gearSetMap.each((k, v) => { if (parseInt(v.quality) === q + 1) candidates.push(parseInt(v.id)); });
    const newSet = candidates[Math.floor(Math.random() * candidates.length)];
    const gearsOfSet = [];
    gearMap.each((k, v) => { if (parseInt(v.setId) === newSet) gearsOfSet.push(parseInt(v.id)); });
    S.goldPoint -= 50;
    S.gears = S.gears.filter((g) => !keys.includes(g.key));
    const g = addGear(gearsOfSet[Math.floor(Math.random() * gearsOfSet.length)], q + 1 >= 2 ? randomExt(q >= 2 ? 2 : 1, q >= 2 ? 3 : 2) : []);
    save();
    return { ok: true, gear: g };
  }
  function randomExt(n, maxLevel) {
    maxLevel = Math.max(1, Math.min(3, Number(maxLevel) || 3));
    const ext = [];
    const ids = attachmentMap.keys.slice();
    for (let i = 0; i < n; i++) {
      const aid = parseInt(ids[Math.floor(Math.random() * ids.length)]);
      ext.push({ id: aid, level: 1 + Math.floor(Math.random() * maxLevel) });
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
        const boost = gear.gem ? 1 + gear.gem.ext / 100 : 1;   // 橙装宝石提升附加属性效果
        effects[ext.id] = Math.max(effects[ext.id] || 0, Math.round(values[ext.level - 1] * boost));
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
      let val = gi.abilityVal;
      if (g.gem) val = Math.round(val * (1 + gemLevel(g.gem.id) * 4 / 100));   // 橙装宝石提升主属性
      if (gi.type === 0) agility += val;
      else if (gi.type === 1) power += val;
      else if (gi.type === 2) hp += val;
      else speed += val;
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
      if (st[3] > 0) power += Math.max(Math.floor(power * 0.2), 5);
      if (st[4] > 0) agility += Math.max(Math.floor(agility * 0.2), 5);
      if (st[5] > 0) speed += Math.max(Math.floor(speed * 0.2), 5);
      if (st[41] > 0) power += Math.max(Math.floor(power * 0.4), 10);
      if (st[42] > 0) agility += Math.max(Math.floor(agility * 0.4), 10);
      if (st[43] > 0) speed += Math.max(Math.floor(speed * 0.4), 10);
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
        if (S.energy >= ENERGY_HARD_CAP) return { ok: false, msg: '体力已达上限 ' + ENERGY_HARD_CAP + ' 点' };
        // 药剂可以把体力顶到自然上限之上，只是不再自然回复
        const per = id === 1 ? 10 : 30;
        const restored = Math.min(per, ENERGY_HARD_CAP - S.energy);
        S.energy += restored;
        if (S.energy >= S.maxEnergy) S.lastEnergyTs = Date.now();
        msg = '恢复体力' + restored + '点（' + S.energy + '/' + S.maxEnergy + '）';
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
        // 1/5/10/15/20 级礼包用 GData 里的加强清单，其它礼包仍按原表
        const boosted = GData.giftPackPrize ? GData.giftPackPrize(id) : null;
        const prizes = boosted || gift.prize.split('|').map((item) => {
          const [pid, num] = item.split(':').map(Number);
          return { id: pid, count: num };
        });
        const got = [];
        for (const { id: pid, count: num } of prizes) {
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
    // 满级 70 级封顶：到了 70 级就不再升级（经验继续累积，等以后开放等级）
    while (S.level < MAX_PLAYER_LEVEL && S.exp >= GData.nextExp(S.level)) {
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
      // 体力上限按等级重算（2~3 级每级 +3、4~20 每级 +2、21~70 每级 +1，69 级 179、满级 180）
      S.maxEnergy = Math.max(S.maxEnergy, energyCapForLevel(S.level));
      // 升级奖励：概率获得新武器/技能（reward 为 {name,id,kind} 或 null）
      const gained = GData.WS_LEVELS.includes(S.level) ? gainRandomWS() : null;
      if (S.level === 5 && !S.reborn) S.goldPoint += 50;
      // 升级礼包：卷轴 / 药剂 / 丹药，逢 5 级与属性书等级再加一份大礼包
      const gifts = (GData.levelGift ? GData.levelGift(S.level) : []).map((g) => {
        const item = propMap.getValue(g.id);
        S.props[g.id] = (S.props[g.id] || 0) + g.count;
        return { id: g.id, count: g.count, name: item ? item.name : '道具' };
      });
      ups.push({
        level: S.level, power: pw, agility: ag, speed: sp, hp,
        reward: gained ? gained.name : null,
        rewardId: gained ? gained.id : null,
        rewardKind: gained ? gained.kind : null,
        attributeBook: bookLevel,
        gifts,
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
    bumpDaily('energy', n);
    save();
    return true;
  }
  function tickPropStates() {
    for (const k of Object.keys(S.propsStates)) {
      if (S.propsStates[k] > 0) S.propsStates[k]--;
    }
  }
  const EXP_PILL = { 7: 0.4, 44: 0.6 };   // 经验丸 40% / 超级经验丸 60%  /** 当前生效的经验加成百分比（经验丸 + 超级经验丸，可叠加）。 */
  function expBoostPct() {
    let pct = 0;
    for (const id of Object.keys(EXP_PILL)) if (S.propsStates[id] > 0) pct += EXP_PILL[id] * 100;
    return pct;
  }
  /** 给一段经验套上经验丸加成并结算（竞技场等也能吃到）。 */
  function gainExpWithBoost(amount) {
    const boosted = Math.round(Number(amount || 0) * (1 + expBoostPct() / 100));
    return { exp: boosted, ups: gainExp(boosted) };
  }

  /** 天梯碎片合成：10 个天梯碎片 + 50 金松果 → 随机一个力量/敏捷/速度转化丸。
   *  依据 references/new/微信图片_20260924010916_259_2.jpg：天梯战飘出的碎片就是这个用途。 */
  function composeConvertPill() {
    const need = GData.CONVERT_SHARD_COST, id = GData.CONVERT_SHARD_ID;
    if ((S.props[id] || 0) < need) return { ok: false, msg: '需要 ' + need + ' 个' + GData.CONVERT_SHARD_NAME };
    if (S.goldPoint < 50) return { ok: false, msg: '合成需要 50 金松果' };
    S.props[id] -= need;
    S.goldPoint -= 50;
    const pills = GData.CONVERT_PILLS;
    const got = pills[Math.floor(Math.random() * pills.length)];
    S.props[got] = (S.props[got] || 0) + 1;
    save();
    const item = propMap.getValue(got);
    return { ok: true, msg: '合成成功：' + (item ? item.name : '转化丸'), prop: got, name: item ? item.name : '转化丸' };
  }

  // ---------- 超级松鼠（原版 VIP） ----------
  /* 特权与等级表直接取自原客户端 js/ssdz-pkg2.js 的 VIP 界面内嵌文案：
   *   1、角色等级10级以上的VIP可以跳过战斗；2、被动经验上限最高400/天；
   *   3、体力恢复速度最快1.5倍；4、昵称以尊贵标识展示；
   *   5、首次开通永久赠送6个装备格子；6、师父是VIP时徒弟每日额外获得金松果；
   *   7、主动挑战VIP玩家所得经验上涨30%；8、体力上限增加到180点。
   * 原版按天售卖（buyVIP.do）；离线版改成金松果购买，价格是按本项目经济定的平衡值。
   * 「跳过战斗」在本项目对所有10级以上玩家开放（原版也是 VIP 或 等级>9），因此不作为VIP独占。 */
  const VIP_LEVELS = [   // [等级, 被动经验上限/天, 体力恢复倍率]
    [1, 150, 1.1], [2, 150, 1.2], [3, 200, 1.2], [4, 200, 1.3], [5, 250, 1.3],
    [6, 300, 1.4], [7, 300, 1.4], [8, 350, 1.5], [9, 350, 1.5], [10, 400, 1.5],
  ];
  const VIP_LEVEL_EXP = [3, 5, 15, 30, 60, 60, 60, 60, 100];   // 升到下一级所需
  const VIP_MAX_LEVEL = 10;
  const VIP_ENERGY_CAP = 180;    // 特权 8
  const VIP_GEAR_BONUS = 6;      // 特权 5
  const VIP_PLANS = [Object.freeze({ days: 7, gold: 300 }), Object.freeze({ days: 30, gold: 1000 })];
  const GEAR_CAPACITY = 100;

  function vipState() {
    if (!S.vip || typeof S.vip !== 'object') S.vip = { level: 1, exp: 0, until: 0, capAdded: 0, capApplied: false, lastDaily: '' };
    return S.vip;
  }
  function vipUntil() { return Math.max(0, Number(vipState().until) || 0); }
  function vipActive() { return vipUntil() > Date.now(); }
  function vipLevel() { return vipActive() ? Math.max(1, Math.min(VIP_MAX_LEVEL, Math.floor(Number(vipState().level) || 1))) : 0; }
  function vipRow(level) { return VIP_LEVELS[Math.max(1, Math.min(VIP_MAX_LEVEL, level)) - 1]; }
  function vipRegenMul() { const lv = vipLevel(); return lv ? vipRow(lv)[2] : 1; }
  function vipPassiveExpCap() { const lv = vipLevel(); return lv ? vipRow(lv)[1] : 0; }
  function vipExpNeed() { const lv = vipLevel() || 1; return VIP_LEVEL_EXP[Math.min(lv, VIP_MAX_LEVEL) - 1]; }
  function vipDaysLeft() { return Math.max(0, Math.ceil((vipUntil() - Date.now()) / 86400000)); }
  /** 装备容量：原版特权 5 首次开通永久 +6 格。 */
  function gearCapacity() { return GEAR_CAPACITY + (vipState().capApplied ? VIP_GEAR_BONUS : 0); }
  /** 特权 8：VIP 期间体力上限抬到 180。用增量记录，到期可原样退回。 */
  function syncVipEnergyCap() {
    const v = vipState(), on = vipActive();
    if (on && !v.capApplied) {
      v.capAdded = Math.max(0, VIP_ENERGY_CAP - S.maxEnergy);
      S.maxEnergy += v.capAdded; v.capApplied = true;
    } else if (!on && v.capApplied) {
      S.maxEnergy = Math.max(1, S.maxEnergy - (Number(v.capAdded) || 0));
      v.capAdded = 0; v.capApplied = false;
    } else if (on && v.capApplied) {
      // 期间升级涨了上限也要保住 180 的下限
      const need = Math.max(0, VIP_ENERGY_CAP - S.maxEnergy);
      if (need > 0) { S.maxEnergy += need; v.capAdded += need; }
    }
    // 只按硬上限收口：药剂顶上去的超出部分要保住，不能因为上限变化被清掉
    if (S.energy > ENERGY_HARD_CAP) S.energy = ENERGY_HARD_CAP;
    return S.maxEnergy;
  }
  /** 特权：每日首次登陆 +1 超级松鼠经验，累积自动升级。 */
  function tickVipDaily() {
    const v = vipState();
    if (!vipActive()) return { gained: false };
    const today = localDate();
    if (v.lastDaily === today) return { gained: false };
    v.lastDaily = today;
    v.exp = (Number(v.exp) || 0) + 1;
    let leveled = 0;
    while (v.level < VIP_MAX_LEVEL && v.exp >= VIP_EXP_NEED(v.level)) { v.exp -= VIP_EXP_NEED(v.level); v.level++; leveled++; }
    if (v.level >= VIP_MAX_LEVEL) v.exp = 0;
    save();
    return { gained: true, level: v.level, leveled: leveled };
  }
  function VIP_EXP_NEED(level) { return VIP_LEVEL_EXP[Math.max(1, Math.min(VIP_MAX_LEVEL, Math.floor(Number(level) || 1))) - 1]; }
  /** 购买/续期超级松鼠。days 必须命中 VIP_PLANS。 */
  function buyVip(days) {
    const plan = VIP_PLANS.find((p) => p.days === Number(days));
    if (!plan) return { ok: false, msg: '没有这个档位' };
    if (S.goldPoint < plan.gold) return { ok: false, msg: '金松果不足，需要 ' + plan.gold + ' 个' };
    S.goldPoint -= plan.gold;
    const v = vipState();
    const base = Math.max(Date.now(), vipUntil());
    v.until = base + plan.days * 86400000;
    if (!v.level) v.level = 1;
    syncVipEnergyCap();
    save();
    return { ok: true, msg: '已成为超级松鼠 ' + plan.days + ' 天', until: v.until, level: v.level };
  }
  /** 调试/验证用。 */
  function grantVip(days, level) {
    const v = vipState();
    v.until = Math.max(Date.now(), vipUntil()) + Math.max(1, Number(days) || 1) * 86400000;
    if (level) v.level = Math.max(1, Math.min(VIP_MAX_LEVEL, Number(level)));
    if (!v.level) v.level = 1;
    syncVipEnergyCap(); save();
    return { until: v.until, level: v.level };
  }

  // ---------- 好友（离线版：随机 NPC 也能加） ----------
  /* 好友只是本地保存的一份对手快照（名字 + 等级 + 三维），可以切磋，不连接真实玩家。 */
  const FRIEND_LIMIT = 20;
  const friendLimit = () => FRIEND_LIMIT;
  function friendList() { if (!Array.isArray(S.friends)) S.friends = []; return S.friends; }
  function friendOf(name) { return S.friends.find((f) => f.name === name) || null; }
  /** 把一位对手（随机 NPC、师父、天梯对手都行）加为好友。 */
  function addFriend(foe) {
    const name = foe && foe.name ? String(foe.name).trim().slice(0, 20) : '';
    if (!name) return { ok: false, msg: '好友信息无效' };
    if (friendOf(name)) return { ok: false, msg: '【' + name + '】已经是好友了' };
    if (S.friends.length >= FRIEND_LIMIT) return { ok: false, msg: '好友已满（' + FRIEND_LIMIT + ' 位），先删掉几位吧' };
    S.friends.push({
      name,
      level: Math.max(1, Math.min(MAX_PLAYER_LEVEL, integer(foe.level, 1, 1))),
      power: integer(foe.power, 1, 1), agility: integer(foe.agility, 1, 1), speed: integer(foe.speed, 1, 1),
      hp: integer(foe.hp != null ? foe.hp : foe.maxHp, 1, 1),
      note: typeof foe.note === 'string' ? foe.note.slice(0, 12) : '',
      since: localDate(),
    });
    save();
    return { ok: true, msg: '已把【' + name + '】加为好友', friend: friendOf(name), count: S.friends.length };
  }
  function removeFriend(name) {
    const at = S.friends.findIndex((f) => f.name === name);
    if (at < 0) return { ok: false, msg: '没有这位好友' };
    const [gone] = S.friends.splice(at, 1);
    save();
    return { ok: true, msg: '已把【' + gone.name + '】移出好友', count: S.friends.length };
  }
  /** 把好友快照还原成可以战斗的对手对象（切磋用）。 */
  function friendFoe(friend) {
    if (!friend) return null;
    return {
      name: friend.name, level: friend.level, power: friend.power, agility: friend.agility, speed: friend.speed,
      hp: friend.hp, maxHp: friend.hp, baseStats: { power: friend.power, agility: friend.agility, speed: friend.speed, hp: friend.hp },
      weapons: [], skills: [], isAI: true, effects: {}, friend: true,
    };
  }
  /** 推荐好友：玩家等级附近的随机 NPC（不超过满级）。 */
  function rollFriendCandidates(count) {
    const n = Math.max(1, Math.min(8, Math.round(Number(count) || 3)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const level = Math.max(1, Math.min(MAX_PLAYER_LEVEL, S.level + Math.floor(Math.random() * 7) - 2));
      out.push(genAI(level, '', { levelJitter: 1, gearSelfLevel: true }));
    }
    return out;
  }

  // 战斗奖励（挑战/竞技胜利）；胜利经验在基准值上下浮动，期望值随对手等级提升
  /* 主动挑战的经验：只看「自己的等级」和「与对手的等级差」。
   *   基准 = BASE + min(自己等级, 20) × PER_LEVEL   ← 20 级封顶，增长比以前慢
   *   倍率 = 1 + 等级差 × STEP（对手比自己高才多给，低了就少给）
   * 封顶后同级一场 33 点、最大等级差（+3）约 47 点，也就是 4.7 点体力，
   * 略低于经验竞技场的 150/30 = 5.0（竞技场仍是最快的经验来源）。
   * nextExp 每级涨得比这里快，所以每升一级需要的场次仍然越来越多。 */
  const CHALLENGE_EXP_BASE = 20;
  const CHALLENGE_EXP_PER_LEVEL = 0.65;
  /* 等级成长到 20 级封顶：之后单场经验不再随等级上涨。这样上限就是
   * 20 级时的 33 点，最大等级差（+3）下约 47 点/场，也就是 4.7 点体力，
   * 略低于经验竞技场的 150/30 = 5.0。 */
  const CHALLENGE_EXP_CAP_LEVEL = 20;
  const EXP_DIFF_STEP = 0.14;           // 每高 1 级 +14%
  const EXP_DIFF_FLOOR = 0.3;           // 对手低很多时的最低倍率
  const EXP_DIFF_CAP = 2.2;
  const ARENA_CHAMPION_EXP = 150;
  const ARENA_ENERGY_COST = 30;
  const ARENA_EXP_PER_ENERGY = ARENA_CHAMPION_EXP / ARENA_ENERGY_COST;   // 5.0
  /** 一次主动挑战胜利的经验期望（不含随机浮动与经验丸）。 */
  function challengeExp(foeLevel, myLevel) {
    const mine = Math.max(1, Math.round(Number(myLevel) || (S && S.level) || 1));
    const diff = Math.max(-15, Math.min(15, Math.round(Number(foeLevel) || mine) - mine));
    const base = CHALLENGE_EXP_BASE + Math.min(mine, CHALLENGE_EXP_CAP_LEVEL) * CHALLENGE_EXP_PER_LEVEL;
    const mult = Math.max(EXP_DIFF_FLOOR, Math.min(EXP_DIFF_CAP, 1 + diff * EXP_DIFF_STEP));
    return Math.round(base * mult);
  }
  /** 随机挑战实际会遇到的等级差范围（classic-ui 的 genOpponents：level-1 ~ level+3）。 */
  const CHALLENGE_DIFF_RANGE = [-1, 3];
  /** 通关一级需要的挑战场次（用同级对手估算），用于核对「越来越难」。 */
  function challengeFightsPerLevel(level) {
    const gain = challengeExp(level, level);
    return gain > 0 ? GData.nextExp(level) / gain : Infinity;
  }
  function fightReward(win, opts) {
    opts = opts || {};
    const foeLevel = Math.max(1, Math.floor(Number(opts.foeLevel) || (S && S.level) || 1));
    const expBase = win
      ? Math.round(challengeExp(foeLevel, S.level) * (0.9 + Math.random() * 0.2))
      : Math.max(4, Math.round(challengeExp(foeLevel, S.level) * 0.08));
    const useProps = opts.useProps !== false;
    const expMul = 1 + (useProps ? expBoostPct() : 0) / 100;
    const gold = win ? 3 + Math.floor(Math.random() * 5) : (Math.random() < 0.3 ? 1 : 0);
    S.goldPoint += gold;
    const ups = gainExp(expBase * expMul);
    if (useProps) tickPropStates();
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
   * opts.minLevel：对手等级的下限（默认 1）
   * opts.gear：是否按等级随机穿戴装备（默认按玩家等级判断）
   * opts.gearSelfLevel：按对手自身等级装备（默认 false，用玩家等级判断解锁）
   * opts.name：直接指定名字
   */
  function genAI(level, nameSuffix, opts) {
    opts = opts || {};
    level = integer(level, 1, 1);
    const jitter = Number.isFinite(opts.levelJitter) ? Math.max(0, Math.floor(opts.levelJitter)) : 2;
    const rolled = jitter ? integer(level + Math.floor(Math.random() * (2 * jitter + 1)) - jitter, 1, 1) : level;
    const finalLevel = Math.max(integer(opts.minLevel, 1, 1), rolled);
    const name = (opts.name ? String(opts.name) : randomAIName()) + (nameSuffix || '');
    // 离线对手遵循相同的基础成长预算，避免用旧高成长公式压过新建玩家。
    const base = GData.initialStats();
    for (let lv = 2; lv <= finalLevel; lv++) {
      const bookLevel = GData.ATTRIBUTE_BOOK_LEVELS.includes(lv);
      if (!bookLevel) base.maxHp += 5;
      for (let point = 0; point < (bookLevel ? 8 : 3); point++) {
        const key = ['power', 'agility', 'speed', 'maxHp'][Math.floor(Math.random() * (bookLevel ? 3 : 4))];
        base[key] += key === 'maxHp' ? 5 : 1;
      }
    }
    const wsPool = [];
    weaponsMap.each((k, v) => { if (GData.canLearn('weapon', v.id, finalLevel)) wsPool.push(parseInt(v.id)); });
    const skPool = [];
    skillsMap.each((k, v) => { if (GData.canLearn('skill', v.id, finalLevel)) skPool.push(parseInt(v.id)); });
    const nWS = GData.wsLimit(finalLevel);
    const weapons = [], skills = [];
    for (let i = 0; i < nWS; i++) {
      const isWeapon = Math.random() < 0.55;
      const chooseWeapon = !skPool.length || isWeapon && wsPool.length;
      const pool = chooseWeapon ? wsPool : skPool;
      if (!pool.length) break;
      const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      let hi = 1;
      while (hi < (chooseWeapon ? 15 : 10) && Number(upgradeMap.getValue(hi).levelLimit) <= finalLevel) hi++;
      if (!chooseWeapon && [6, 13].includes(id)) hi = 1;
      (chooseWeapon ? weapons : skills).push(id + ':' + (1 + Math.floor(Math.random() * hi)));
    }
    const foe = {
      name, level: finalLevel, power: base.power, agility: base.agility, speed: base.speed,
      hp: base.maxHp, baseStats: { power: base.power, agility: base.agility, speed: base.speed, hp: base.maxHp },
      weapons, skills, isAI: true, effects: {},
    };
    // 装备：等级越高穿得越多、品质越好，并随机带附加属性
    const playerLevel = S && Number.isFinite(S.level) ? S.level : 1;
    const gearLevel = opts.gearSelfLevel ? finalLevel : Math.max(playerLevel, 1);
    if (opts.gear !== false) foe.gears = randomAIGears(finalLevel, gearLevel);
    for (const gear of foe.gears || []) {
      const info = gearInst(gear.id);
      foe[['agility', 'power', 'hp', 'speed'][info.type]] += info.abilityVal;
      for (const ext of gear.ext) {
        const values = attachmentMap.getValue(ext.id).ability.split(',').map(Number);
        foe.effects[ext.id] = Math.max(foe.effects[ext.id] || 0, values[ext.level - 1]);
      }
    }
    for (const value of skills) {
      const skill = skillInst(value);
      const stat = { 1: 'power', 2: 'agility', 3: 'speed', 4: 'hp' }[skill.id];
      if (stat) foe[stat] += Math.round(GData.passiveBonus(skill.id, skill.level) * (1 + (foe.effects[26 + skill.id] || 0) / 100));
    }
    return foe;
  }

  /** 按等级随机穿装备：优先穿当前等级能穿的最好套装（与正常玩家成长一致），偶尔穿低一档的旧装。 */
  function randomAIGears(foeLevel, refLevel) {
    const level = Math.max(1, Math.min(foeLevel, Math.floor(refLevel || foeLevel || 1)));
    const sets = [];
    gearSetMap.each((id, set) => {
      if (set && Number(set.level) <= level) sets.push({ id: Number(id), level: Number(set.level), quality: parseInt(set.quality) || 0 });
    });
    if (!sets.length) return [];
    // 正常玩家闯关到10级后基本穿满当前套装，对手的穿戴率不能差太多
    const wearChance = Math.min(0.95, 0.5 + level / 40);
    // 套装按等级从高到低分档；低等级套装的加成远小于高档，不能等概率随机
    const tiers = [];
    for (const set of sets.slice().sort((a, b) => b.level - a.level)) {
      const top = tiers[tiers.length - 1];
      if (top && top.level === set.level) top.sets.push(set);
      else tiers.push({ level: set.level, sets: [set] });
    }
    const out = [];
    const usedType = new Set();
    for (let slot = 0; slot < 4; slot++) {
      if (Math.random() > wearChance) continue;
      // 75% 穿最好一档，20% 次一档，5% 随机一档旧装；同部位冲突时重选
      for (let attempt = 0; attempt < 3; attempt++) {
        const roll = Math.random();
        const tier = roll < 0.75 ? tiers[0]
          : roll < 0.95 ? tiers[Math.min(1, tiers.length - 1)]
          : tiers[Math.floor(Math.random() * tiers.length)];
        const set = tier.sets[Math.floor(Math.random() * tier.sets.length)];
        const gearsOfSet = [];
        gearMap.each((k, v) => { if (parseInt(v.setId) === set.id) gearsOfSet.push(parseInt(v.id)); });
        if (!gearsOfSet.length) break;
        const gid = gearsOfSet[Math.floor(Math.random() * gearsOfSet.length)];
        const info = gearInst(gid);
        if (!info || usedType.has(info.type)) continue;   // 同部位不重复穿
        usedType.add(info.type);
        // 原版白绿无词条，蓝装1条且最多2星，紫装2条且最多3星。
        const ext = info.quality >= 3 ? randomExt(2) : info.quality === 2 ? randomExt(1, 2) : [];
        out.push({ id: gid, used: true, ext });
        break;
      }
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
    // 攻略数值为准：同星级同位置的NPC血量一致（三位师父只差攻击模式）
    const hp = found && GData.stageNpcHp(stageId, npcIndex);
    if (found && hp) found = Object.assign({}, found, { hp: String(hp) });
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
    // 整轮经验 = 三场逐场经验之和（逐场发放，此处仅用于界面展示与离线估算）
    const gold = 25 * (GData.STAGE_GOLD_MULT || 1);
    return { exp: [1, 2, 3].reduce((sum, i) => sum + GData.stageNpcExp(stageId, i), 0), gold };
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
  function finishStageBattle(stageId, token, win, carryRatio) {
    stageId = Number(stageId);
    const run = S.stageRuns && S.stageRuns[stageId];
    if (!run || run.attempt !== token) return { ok: false };
    delete run.attempt;
    if (!win) {
      run.needsRevive = true;
      delete run.carryHp;   // 复活再战回满血
      save();
      return { ok: true, win: false, complete: false, exp: 0, gold: 0, ups: [], run: stageRun(stageId) };
    }
    // 每场胜利按攻略表发放该NPC的经验
    const fightExp = GData.stageNpcExp(stageId, run.npcIndex);
    const complete = run.npcIndex === 3;
    const old = stageProgress(stageId);
    const nextNpc = Math.min(3, run.npcIndex + 1);
    S.stages[stageId] = { npcIndex: Math.max(old.npcIndex, nextNpc), passed: old.passed || complete };
    if (complete) delete S.stageRuns[stageId];
    else {
      run.npcIndex = nextNpc;
      // 连续挑战不回满血：下一场只继承本场剩余血量（进入时再回复25%）
      if (Number.isFinite(carryRatio)) run.carryHp = Math.max(0, Math.min(1, carryRatio));
    }
    // 关卡碎片掉落：本次击败的 NPC 就可能掉碎片（不必等到整轮通关）。
    // 掉率与数量区间由 GData.STAGE_FRAGMENT 统一控制（掉率调高、数量区间收窄）。
    //   螳螂(1-6) 白为主 / 仙鹤(7-12) 绿为主 / 熊猫(13-18) 蓝为主（蓝为上限）。
    //   攻略.md：3星螳螂「大多白、小概率绿」，6星「绿色几率提高」——故 ★3-4 越1级、★5-6 越2级。
    const star = GData.stageStar(stageId);
    const frag = GData.STAGE_FRAGMENT;
    let drop = null;
    if (Math.random() < GData.stageFragmentChance(star)) {
      const base = 24 + Math.floor((stageId - 1) / 6);          // 24 白 / 25 绿 / 26 蓝
      const up = star >= 5 ? 2 : star >= 3 ? 1 : 0;
      const step = Math.min(base + up, 26);                     // 蓝碎片封顶
      const id = up > 0 && Math.random() >= frag.tierUp ? step : base;
      const count = GData.stageFragmentCount();
      S.props[id] = (S.props[id] || 0) + count;
      drop = { id, count, name: propMap.getValue(id).name };
    }
    const gold = complete ? stageReward(stageId).gold : 0;
    S.goldPoint += gold;
    // 45级起通关有几率获得1-2级宝石
    const gem = complete ? rollGemDrop(20) : null;
    const ups = gainExp(fightExp);
    save();
    return { ok: true, win: true, complete, drop, gem, ups, run: stageRun(stageId), exp: fightExp, gold };
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
    if (S.quests && S.quests.date !== date) S.quests = null;
    if (S.dailyCounters && S.dailyCounters.date !== date) S.dailyCounters = null;
    save();
  }
  function dailyStatus() {
    const date = localDate();
    return { date, claimed: S.dailyClaimDate === date, gold: 150, challengeBooks: 1 };
  }

  // ---------- 每日任务 ----------
  /* 原版没有每日任务（「活动」由服务端下发），这是按需求的单机补充：
   * 每天用日期做种子从池子里抽 4 条，进度来自当天真实行为计数，刷新/重开当天不变。
   * 计数统一走 bumpDaily()，日期跟着 dailyStatsDate 一起重置。 */
  const QUEST_TYPES = [
    { key: 'win',     name: '赢下 {n} 场对战',        steps: [2, 3, 5], gold: [120, 180, 300] },
    { key: 'fight',   name: '进行 {n} 场战斗',        steps: [4, 6, 8], gold: [100, 150, 220] },
    { key: 'stage',   name: '通关 {n} 次关卡挑战',    steps: [2, 3, 5], gold: [140, 200, 320] },
    { key: 'arena',   name: '参加 {n} 次竞技场比赛',  steps: [1, 2, 3], gold: [160, 240, 360] },
    { key: 'lottery', name: '抽取 {n} 次每日幸运抽奖', steps: [1, 1, 2], gold: [80, 120, 200] },
    { key: 'merge',   name: '合成或融合 {n} 次装备',  steps: [1, 2, 3], gold: [150, 220, 340] },
    { key: 'upgrade', name: '升级武器或技能 {n} 次',  steps: [2, 4, 6], gold: [130, 190, 300] },
    { key: 'energy',  name: '消耗 {n} 点体力',        steps: [10, 20, 30], gold: [90, 140, 210] },
  ];
  const QUEST_COUNT = 4;
  const QUEST_KEYS = QUEST_TYPES.map((q) => q.key);
  /* 奖励池：金松果、经验与各种道具**一起加权乱抽**（金松果/经验不再是固定奖励），
   * 每条任务只抽 1~2 项。weight 是权重：越"高级"的东西权重越低
   * （超级经验丸只有 0.06，大约 1/14 的概率）。药丸数量固定 1 个。 */
  const QUEST_GOLD = { kind: 'gold', weight: 1.4, range: [10, 30] };
  const QUEST_EXP = { kind: 'exp', weight: 1.4, range: [50, 80] };
  const QUEST_EXTRA_POOL = [
    { id: 21, range: [3, 5], weight: 1.2 },   // 技能卷轴
    { id: 22, range: [3, 5], weight: 1.2 },   // 武器卷轴
    { id: 23, range: [1, 2], weight: 1.0 },   // 挑战书
    { id: 1, range: [1, 2], weight: 1.0 },    // 小体力药剂
    { id: 7, range: [1, 1], weight: 0.7, pill: true },    // 经验丸
    { id: 45, range: [1, 1], weight: 0.4 },   // 天使果实种子
    { id: 2, range: [1, 1], weight: 0.3 },    // 大体力药剂（高级）
    { id: 44, range: [1, 1], weight: 0.06, pill: true },  // 超级经验丸（高级药丸，概率大幅下调）
  ];

  function questSeed(date) {
    let h = 2166136261;
    for (const ch of String(date)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function questRng(seed) {
    let state = seed || 1;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  }
  const questRoll = (rnd, range) => range[0] + Math.floor(rnd() * (range[1] - range[0] + 1));

  function rollQuests() {
    const date = localDate();
    const rnd = questRng(questSeed(date));
    const pool = QUEST_KEYS.slice();
    // Fisher–Yates：同一天的抽取顺序固定，刷新页面不会换题
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, QUEST_COUNT).map((key) => {
      const type = QUEST_TYPES.find((q) => q.key === key);
      const tier = Math.floor(rnd() * type.steps.length);
      // 纯随机 1~2 项：金松果、经验、道具在同一个加权池里抽，抽到才给
      const bag = [QUEST_GOLD, QUEST_EXP].concat(QUEST_EXTRA_POOL.map((item) => ({
        kind: 'prop', id: item.id, weight: item.weight, range: item.range, pill: item.pill,
      })));
      const rewardCount = rnd() < 0.45 ? 1 : 2;
      const rewards = [];
      for (let i = 0; i < rewardCount && bag.length; i++) {
        const total = bag.reduce((sum, item) => sum + item.weight, 0);
        let roll = rnd() * total, pick = 0;
        for (let j = 0; j < bag.length; j++) { roll -= bag[j].weight; if (roll <= 0) { pick = j; break; } }
        const item = bag.splice(pick, 1)[0];
        rewards.push({
          kind: item.kind, id: item.id,
          count: item.pill ? 1 : questRoll(rnd, item.range),
        });
      }
      return { key, need: type.steps[tier], rewards, claimed: false };
    });
  }
  function questState() {
    const date = localDate();
    if (!S.quests || typeof S.quests !== 'object' || S.quests.date !== date || !Array.isArray(S.quests.list) || !S.quests.list.length) {
      S.quests = { date, list: rollQuests() };
      S.dailyCounters = { date, win: 0, fight: 0, stage: 0, arena: 0, lottery: 0, merge: 0, upgrade: 0, energy: 0 };
      save();
    }
    if (!S.dailyCounters || S.dailyCounters.date !== date) {
      S.dailyCounters = { date, win: 0, fight: 0, stage: 0, arena: 0, lottery: 0, merge: 0, upgrade: 0, energy: 0 };
      save();
    }
    return S.quests;
  }
  /** 记录一次当天行为，供每日任务计数。 */
  function bumpDaily(key, n) {
    if (!QUEST_KEYS.includes(key)) return 0;
    questState();
    S.dailyCounters[key] = Math.max(0, (Number(S.dailyCounters[key]) || 0) + (Number(n) || 1));
    save();
    return S.dailyCounters[key];
  }
  /** 战斗行为统一在这里记：一场算战斗，赢了再算胜场。 */
  function bumpBattleDaily(win, kind) {
    bumpDaily('fight', 1);
    if (win) bumpDaily('win', 1);
    if (kind === 'stage' && win) bumpDaily('stage', 1);
    if (kind === 'arena') bumpDaily('arena', 1);
  }
  /** 兼容旧档：老任务只有 gold/exp/extras，新任务直接存 rewards。 */
  function questRewards(q) {
    const nameOf = (id) => { const item = propMap.getValue(id); return item ? item.name : '道具'; };
    const out = [];
    if (Array.isArray(q.rewards) && q.rewards.length) {
      for (const r of q.rewards) {
        if (!r) continue;
        if (r.kind === 'gold') out.push({ kind: 'gold', id: 8, name: '金松果', count: Math.max(1, Number(r.count) || 1) });
        else if (r.kind === 'exp') out.push({ kind: 'exp', id: 15, name: '经验', count: Math.max(1, Number(r.count) || 1) });
        else if (r.id) out.push({ kind: 'prop', id: Number(r.id), name: nameOf(r.id), count: Math.max(1, Number(r.count) || 1) });
      }
      return out;
    }
    if (q.gold) out.push({ kind: 'gold', id: 8, name: '金松果', count: q.gold });
    if (q.exp) out.push({ kind: 'exp', id: 15, name: '经验', count: q.exp });
    for (const extra of Array.isArray(q.extras) ? q.extras : []) {
      if (extra && extra.id) out.push({ kind: 'prop', id: Number(extra.id), name: nameOf(extra.id), count: Math.max(1, Number(extra.count) || 1) });
    }
    return out;
  }
  function questStatus() {
    const quests = questState(), counters = S.dailyCounters;
    return quests.list.map((q, index) => {
      const type = QUEST_TYPES.find((t) => t.key === q.key) || { name: q.key };
      const progress = Math.min(q.need, Number(counters[q.key]) || 0);
      const rewards = questRewards(q);
      const pick = (kind) => { const r = rewards.find((x) => x.kind === kind); return r ? r.count : 0; };
      return {
        index, key: q.key, need: q.need,
        gold: pick('gold'), exp: pick('exp'),
        extras: rewards.filter((r) => r.kind === 'prop').map((r) => ({ id: r.id, count: r.count })),
        rewards,
        name: String(type.name).replace('{n}', q.need),
        progress, done: progress >= q.need, claimed: q.claimed === true,
        claimable: progress >= q.need && q.claimed !== true,
      };
    });
  }
  /** 有可领取的东西时给首页「活动」图标加提示动效。 */
  function questClaimable() { return questStatus().filter((q) => q.claimable).length; }
  function claimQuest(index) {
    const list = questStatus();
    const row = list[Number(index)];
    if (!row) return { ok: false, msg: '没有这个任务' };
    if (row.claimed) return { ok: false, msg: '这条任务已经领过了' };
    if (!row.done) return { ok: false, msg: '任务还没完成' };
    questState().list[row.index].claimed = true;
    const parts = [];
    for (const r of row.rewards) {
      if (r.kind === 'gold') { S.goldPoint += r.count; parts.push('金松果 +' + r.count); }
      else if (r.kind === 'exp') { gainExp(r.count); parts.push('经验 +' + r.count); }
      else { S.props[r.id] = (S.props[r.id] || 0) + r.count; parts.push(r.name + ' +' + r.count); }
    }
    save();
    return { ok: true, msg: '领取成功：' + parts.join('、'), gold: row.gold, exp: row.exp, extras: row.extras, rewards: row.rewards, ups: [] };
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
    bumpBattleDaily(snapshot.winner === 0, snapshot.kind);
    save();
    return clone(snapshot);
  }
  function battleHistory() { return clone(S.battles || []); }

  window.State = {
    saveKey: SAVE_KEY,
    save, load, newGame, state, tickEnergy, energyCountdown,
    vipActive, vipLevel, vipUntil, vipDaysLeft, vipRegenMul, vipPassiveExpCap, vipExpNeed,
    vipRow, buyVip, grantVip, tickVipDaily, gearCapacity, syncVipEnergyCap,
    VIP_LEVELS, VIP_LEVEL_EXP, VIP_MAX_LEVEL, VIP_PLANS, VIP_ENERGY_CAP, VIP_GEAR_BONUS, GEAR_CAPACITY,
    weaponInst, skillInst, myWeapons, mySkills, wsLimit,
    upgradeInfo, doUpgrade,
    weaponList,
    gearInst, myGears, wear, unwear, sellGear, composeGear, mergeGears, addGear, extText, randomExt,
    gemLevel, GEM_MERGE_RATES, rollGemDrop, mergeGems, socketGem, unsocketGem,
    totalStats, equipmentEffects, shopLimit, purchaseStatus, buyProp, useProp, gainRandomWS,
    gainExp, consumeEnergy, tickPropStates, fightReward, expBoostPct, gainExpWithBoost,
    // 师徒
    apprenticeCap, learnSkill, setMaster, clearMaster, addPrentice, removePrentice,
    apprenticeDailyExp, apprenticeDailyTotal, apprenticeDailyStatus, apprenticeTribute, claimApprenticeExp, canKickToday, kickPrentice,
    beginRecruitChallenge, finishRecruitChallenge, cancelRecruitChallenge,
    MASTER_SKILL_ID, MASTER_SKILL_NAME,
    genAI, stageProgress, setStageProgress, npcOf, highestStageId, stageRun, stageAccess, stageReward,
    beginStageBattle, finishStageBattle, interruptStageBattle, abandonStageRun,
    localDate, dailyStatus, claimDaily, recordBattle, battleHistory,
    questStatus, questClaimable, claimQuest, bumpDaily, QUEST_TYPES, QUEST_EXTRA_POOL, QUEST_GOLD, QUEST_EXP,
    sellProp, propSellPrice, sellableProps, SELLABLE_PROPS,
    friendLimit, friendList, friendOf, addFriend, removeFriend, friendFoe, rollFriendCandidates, FRIEND_LIMIT,
    weaponList, skillList, setWeapon, setSkill, forgetWeapon, forgetSkill, setWS, forgetWS,
    composeConvertPill, challengeExp, challengeFightsPerLevel, usePropMany, energyHardCap, ENERGY_HARD_CAP, PROP_HARD_CAP,
    MAX_PLAYER_LEVEL, energyCapForLevel,
    CHALLENGE_EXP_BASE, CHALLENGE_EXP_PER_LEVEL, CHALLENGE_EXP_CAP_LEVEL, CHALLENGE_DIFF_RANGE, ARENA_CHAMPION_EXP, ARENA_ENERGY_COST, ARENA_EXP_PER_ENERGY,
  };
})();
