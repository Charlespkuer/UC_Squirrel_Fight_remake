/* ============================================================
 * sim.js — 战斗模拟器
 * 输出回合事件流（供 battle.js 播放）。武器/技能效果按原版
 * GameDict 描述与百科资料实现。
 * ============================================================ */
(function () {
  'use strict';

  function R(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function chance(pct) { return Math.random() * 100 < pct; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // The client receives server-generated battles; no original trigger threshold
  // survives in its dictionary. Keep these reconstruction choices explicit.
  const RULES = Object.freeze({ masterHpRatio: 0.35, masterChance: 35 });
  const ACTIVE_SKILLS = [8, 12, 14, 15, 17, 18, 23];
  /** 调试开关「无敌模式」：玩家侧不会被击倒，最少保留 1 点血。 */
  function godSave(def) {
    try { return !!(def && def.side === 0 && window.Debug && window.Debug.enabled('godMode')); } catch (e) { return false; }
  }

  /**
   * fighter 输入: {name, level, power, agility, speed, hp,
   *   weapons:[{id,level,harmLo,harmHi,type}], skills:[{id,level,type}],
   *   baseStats?:{power,agility,speed}, masterLevel?:number,
   *   npcType: null|'tl'|'xh'|'xm'|'wood'}
   */
  function makeCombatant(f, side) {
    const stat = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(1, Number(value)) : fallback;
    const skills = {};
    for (let s of f.skills || []) {
      if (typeof s === 'string') { const p = s.split(/[:,]/); s = { id: +p[0], level: +(p[1] || 1) }; }
      if (s && Number.isFinite(Number(s.id))) skills[Number(s.id)] = clamp(stat(s.level, 1), 1, 15);
    }
    const weapons = (f.weapons || []).map((w) => {
      if (typeof w === 'string') { const p = w.split(/[:,]/); w = { id: +p[0], level: +(p[1] || 1) }; }
      const base = weaponsMap.getValue(w.id);
      if (!base) return null;
      w = Object.assign({}, w, { id: Number(w.id), level: clamp(stat(w.level, 1), 1, 15) });
      let lo = w.harmLo, hi = w.harmHi;
      if (lo == null) { // NPC/AI 直接给 id:level
        const [bLo, bHi] = base.harm.split('-').map(Number);
        let add = 0;
        if (w.level <= 10) add = parseInt(base.harmAdd) * (w.level - 1);
        else { add = parseInt(base.harmAdd) * 9; const ex = base.harmAdd1.split('|').map(Number); for (let i = 0; i < w.level - 10 && i < ex.length; i++) add += ex[i]; }
        lo = bLo + add; hi = bHi + add;
      }
      return { id: w.id, level: w.level, name: base.name, type: base.type, lo, hi };
    }).filter(Boolean);
    // 关卡连战会带一个「入场血量比例」进来：hp 是当前血量，maxHp 才是上限。
    // 缺少 maxHp（AI/NPC/旧录像）时，把 hp 当作满血，保持既有行为。
    const fullHp = stat(f.maxHp != null ? f.maxHp : f.hp, 1);
    return {
      side, name: f.name, level: stat(f.level, 1), npcType: f.npcType || null,
      power: stat(f.power, 1), agility: stat(f.agility, 1), speed: stat(f.speed, 1),
      maxHp: fullHp, hp: Math.max(1, Math.min(stat(f.hp, 1), fullHp)),
      weapons, skills, lastWeaponId: null,
      effects: f.effects || {}, masterLevel: Math.max(0, Number(f.masterLevel) || 0),
      // 攻略.md 的裸属性解释与 PPT 的含装备解释冲突。本版采用前者，
      // callers provide growth stats excluding equipment, skills and pills.
      // Older fighter snapshots lack this field, so retain their recorded stats.
      baseStats: Object.fromEntries(['power', 'agility', 'speed'].map((key) => [key, stat(f.baseStats?.[key], stat(f[key], 1))])),
      // 战斗内状态
      ap: 0, restNext: false, pendingWeapon: null, stun: 0, silence: 0, disarm: 0, shellCharges: 0,
      mustHitNext: false, usedFakeDie: false, usedMaster: false, usedShell: false, usedCosmos: false, usedSnack: false,
      usedUlt: false, acted: false,
      swordDodge: 0, meteorDodge: 0, debuffs: { power: 0, agility: 0, speed: 0 },
      dot: null, // {dmg, rounds}
      buffFlat: { power: 0, agility: 0, speed: 0 },
    };
  }

  function effPower(c) { return Math.max(1, Math.round(c.power * (1 - c.debuffs.power / 100) + c.buffFlat.power)); }
  function effAgility(c) { return Math.max(1, Math.round(c.agility * (1 - c.debuffs.agility / 100) + c.buffFlat.agility)); }
  function effSpeed(c) { return Math.max(1, Math.round(c.speed * (1 - c.debuffs.speed / 100) + c.buffFlat.speed)); }
  function effect(c, id) { return Math.max(0, Number(c.effects[id]) || 0); }
  // 沉默之斧保留四项基础属性技，抑制其余主动、被动及防御技能。
  function skill(c, id) { return c.silence > 0 && id > 4 ? 0 : c.skills[id] || 0; }
  function weaponEffect(w, base, perLevel, perTrueLevel) {
    return base + perLevel * (Math.min(w.level, 10) - 1) + (perTrueLevel || 0) * Math.max(0, w.level - 10);
  }

  function dodgeChance(att, def) {
    const wMust = att.mustHitNext;
    if (wMust) return 0;
    let d = 6 + 26 * effAgility(def) / (effAgility(def) + effAgility(att) * 1.2 + 40);
    const shift = skill(def, 11) ? (5 + 2 * (skill(def, 11) - 1)) * (1 + effect(def, 35) / 100) : 0;
    // PPT问答：木剑、移形、流星锤均相对提升天生闪避率。
    d *= 1 + (shift + def.swordDodge + def.meteorDodge) / 100;
    return clamp(d, 0, 55);
  }

  function critChance(att) {
    let c = 5;
    if (skill(att, 9)) c += 2 * skill(att, 9);                  // 暴击
    return c;
  }

  function dmgReduce(def, dmg, opts) {
    opts = opts || {};
    let out = { dmg, guiJia: 0, jueDui: 0, rebound: 0 };
    const gearReduction = opts.action === 'weapon' ? effect(def, opts.weaponType === '投掷' ? 10 : 9) : opts.action === 'skill' ? effect(def, 11) : 0;
    out.dmg = Math.round(out.dmg * (1 - clamp(gearReduction, 0, 80) / 100));
    if (def.skills[16] && def.silence <= 0 && chance(30)) {      // 绝对防御
      const pct = 40 + 4 * (def.skills[16] - 1);
      out.jueDui = out.dmg; out.rebound = Math.round(out.dmg * pct / 100); out.dmg = 0;
      return out;
    }
    if (def.skills[7] && def.silence <= 0 && (def.shellCharges > 0 || !def.usedShell && chance(35))) { // 龟甲术
      if (def.shellCharges > 0) def.shellCharges--;
      else { def.usedShell = true; if (effect(def, 32) && chance(effect(def, 32))) def.shellCharges = 1; }
      const pct = clamp(20 + 5 * (def.skills[7] - 1), 0, 80);
      out.guiJia = Math.round(out.dmg * pct / 100);
      out.dmg -= out.guiJia;
    }
    if (skill(def, 10)) {                                      // 皮糙肉厚
      const pct = clamp((5 + (skill(def, 10) - 1)) * (1 + effect(def, 34) / 100), 0, 80);
      out.dmg = Math.round(out.dmg * (100 - pct) / 100);
    }
    out.dmg = Math.max(1, out.dmg);
    return out;
  }

  /** 主模拟：返回 {rounds, winner(0|1), maxHp:[a,b]} */
  function simulate(f0, f1, options) {
    options = options || {};
    const rules = {
      masterHpRatio: Number.isFinite(options.masterHpRatio) ? clamp(options.masterHpRatio, 0, 1) : RULES.masterHpRatio,
      masterChance: Number.isFinite(options.masterChance) ? clamp(options.masterChance, 0, 100) : RULES.masterChance,
    };
    const A = makeCombatant(f0, 0), B = makeCombatant(f1, 1);
    const rounds = [];
    const MAX_ACTIONS = 120;
    let actions = 0;

    function pushRound(r) {
      // Preserve the user's Debug mode in the event snapshots as well as winner.
      if (A.hp <= 0 && godSave(A)) A.hp = 1;
      if (B.hp <= 0 && godSave(B)) B.hp = 1;
      r.hpAfter = [Math.max(0, A.hp), Math.max(0, B.hp)];
      rounds.push(r);
    }

    function applyDamage(att, def, rawDmg, r, opts) {
      opts = opts || {};
      const action = opts.action || r.action;
      if (action === 'skill') {
        rawDmg = Math.round(rawDmg * (1 + effect(att, 8) / 100));
        if (chance(critChance(att))) { rawDmg = Math.round(rawDmg * (2 + effect(att, 4) / 100)); r.crit = true; }
      }
      const red = dmgReduce(def, rawDmg, { action, weaponType: opts.weaponType });
      let dmg = red.dmg;
      if (red.jueDui) { r.jueDui = true; r.rebound = red.rebound; }
      if (red.guiJia) r.guiJia = red.guiJia;
      // 装死
      if (def.hp - dmg <= 0 && def.skills[6] && def.silence <= 0 && !def.usedFakeDie && !opts.ignoreFakeDie) {
        def.usedFakeDie = true;
        dmg = Math.max(0, def.hp - 1);
        def.hp = 1;
        r.fakeDie = true;
        def.stun = 0;
        immediate = { actor: def, reason: 'fakeDie' };
      } else if (def.hp - dmg <= 0 && godSave(def)) {
        dmg = Math.max(0, def.hp - 1);
        def.hp = 1;
        r.godSave = true;
      } else {
        def.hp -= dmg;
      }
      att.mustHitNext = false;
      r.dmg = (r.dmg || 0) + dmg;
      if (red.rebound) {
        att.hp -= red.rebound;
        r.reboundHurt = red.rebound;
      }
      return dmg;
    }

    /** NPC 大招（每场一次）：螳螂低血乱舞、仙鹤开场展翅、熊猫低血震地。 */
    function npcUlt(att, def) {
      const r = { attacker: att.side, action: 'skill', npcSkill: true, ult: true };
      if (att.npcType === 'tl') {
        // 疾风镰刀舞：生命低于35%时孤注一掷的四连击
        r.ultName = '疾风镰刀舞'; r.multiHit = 4;
        if (chance(dodgeChance(att, def))) { r.dodge = true; pushRound(r); return; }
        let total = 0;
        for (let i = 0; i < 4; i++) {
          const rr = { dmg: 0 };
          applyDamage(att, def, Math.round(effPower(att) * 0.55), rr, { action: 'skill' });
          total += rr.dmg;
          if (rr.reboundHurt) { r.reboundHurt = (r.reboundHurt || 0) + rr.reboundHurt; r.jueDui = true; }
          if (rr.fakeDie || def.hp <= 0 || att.hp <= 0) break;
        }
        r.dmg = total; pushRound(r); return;
      }
      if (att.npcType === 'xh') {
        // 仙鹤展翅：开场第一次行动的重击，契合“前期凶猛”
        r.ultName = '仙鹤展翅';
        const raw = Math.round((effPower(att) + effSpeed(att)) * 1.6);
        if (chance(dodgeChance(att, def))) { r.dodge = true; pushRound(r); return; }
        applyDamage(att, def, raw, r, { action: 'skill' });
        pushRound(r); return;
      }
      // 熊掌震地：生命低于40%时的重击，震晕对手一回合
      r.ultName = '熊掌震地';
      const raw = Math.round(effPower(att) * 2.2);
      if (chance(dodgeChance(att, def))) { r.dodge = true; pushRound(r); return; }
      applyDamage(att, def, raw, r, { action: 'skill' });
      if (def.hp > 0 && !r.fakeDie) { def.stun = Math.max(def.stun, 1); r.stunApplied = true; }
      pushRound(r);
    }

    function npcAction(att, def) {
      // 大招（每场一次）：仙鹤开场即放，螳螂/熊猫压低生命后触发
      const firstAction = !att.acted; att.acted = true;
      att.npcActs = (att.npcActs || 0) + 1;   // 仙鹤前期凶猛：前3次行动伤害+30%
      if (!att.usedUlt && (att.npcType === 'xh' ? firstAction
        : att.npcType === 'tl' ? att.hp < att.maxHp * 0.35
        : att.npcType === 'xm' ? att.hp < att.maxHp * 0.4 : false)) {
        att.usedUlt = true; npcUlt(att, def); return;
      }
      // NPC：70% 普攻，30% 技能
      const useSkill = Object.keys(att.skills).length > 0 && chance(30);
      const r = { attacker: att.side, action: 'common', npcSkill: false };
      if (useSkill) {
        r.action = 'skill'; r.npcSkill = true;
        const sid = parseInt(Object.keys(att.skills)[0]);
        const lv = att.skills[sid];
        let raw;
        if (att.npcType === 'tl') { raw = Math.round(effPower(att) * (0.6 + Math.random() * 0.3)); r.multiHit = 2; } // 螳螂双击
        else if (att.npcType === 'xh') { raw = Math.round((effPower(att) + effSpeed(att)) * (0.9 + lv * 0.1)); }
        else { raw = Math.round(effPower(att) * (1.3 + lv * 0.1)); } // 熊猫重击
        if (att.npcType === 'xh' && att.npcActs <= 3) raw = Math.round(raw * 1.3); // 仙鹤前期凶猛
        // 命中
        if (chance(dodgeChance(att, def))) { r.dodge = true; pushRound(r); return; }
        let total = 0;
        const hits = r.multiHit || 1;
        for (let i = 0; i < hits; i++) {
          const rr = { dmg: 0 };
          applyDamage(att, def, raw, rr, { action: 'skill' });
          total += rr.dmg;
          if (rr.reboundHurt) { r.reboundHurt = (r.reboundHurt || 0) + rr.reboundHurt; r.jueDui = true; }
          if (rr.guiJia) r.guiJia = rr.guiJia;
          if (rr.fakeDie) r.fakeDie = true;
          if (rr.crit) r.crit = true;
          if (rr.fakeDie || def.hp <= 0 || att.hp <= 0) break;
        }
        r.dmg = total;
        maybeCounter(att, def, r, true);
        pushRound(r);
        return;
      }
      // 普攻
      if (chance(dodgeChance(att, def))) { r.dodge = true; pushRound(r); return; }
      let raw = Math.round(effPower(att) * (0.8 + Math.random() * 0.4));
      if (att.npcType === 'xh' && att.npcActs <= 3) raw = Math.round(raw * 1.3); // 仙鹤前期凶猛
      if (att.npcType === 'tl' && att.hp < att.maxHp * 0.3) raw = Math.round(raw * 1.5); // 螳螂低血爆发
      applyDamage(att, def, raw, r, {});
      maybeCounter(att, def, r, true);
      pushRound(r);
    }

    function maybeCounter(att, def, r, canCounter) {
      // 反击：被打方用普攻反击（对近战/普攻；必中类武器也可被反击，大榔头/死神镰刀除外）
      if (!canCounter || r.fakeDie || def.hp <= 0 || att.hp <= 0) return;
      let chanceBase = 25;
      if (def.npcType === 'xm') chanceBase = 45;                 // 熊猫善反击
      if (!chance(chanceBase)) return;
      let raw = Math.round(effPower(def) * (0.6 + Math.random() * 0.4) * (1 + effect(def, 5) / 100));
      if (skill(def, 24)) raw = Math.round(raw * (1.5 + 0.06 * (skill(def, 24) - 1))); // 致命反击
      if (chance(dodgeChance(def, att) * 0.5)) { r.counterDodge = true; return; }
      const counter = { action: 'common' };
      applyDamage(def, att, raw, counter, {});
      r.counterDmg = counter.dmg;
      if (counter.fakeDie) r.counterFakeDie = true;
      if (counter.reboundHurt) r.counterRebound = counter.reboundHurt;
    }

    function playerLikeAction(att, def) {
      const r = { attacker: att.side };
      // 师父只在濒危时尝试救场，每场至多一次；无师父时不能凭空治疗。
      if (att.skills[13] && !att.usedMaster && att.masterLevel > 0 && att.silence <= 0 &&
          att.hp <= att.maxHp * rules.masterHpRatio && chance(rules.masterChance)) {
        att.usedMaster = true;
        const heal = Math.min(att.maxHp - att.hp, att.masterLevel * 4);
        att.hp += heal;
        att.mustHitNext = true;
        pushRound({ attacker: att.side, action: 'skill', id: 13, level: att.skills[13], healSelf: heal, noDmg: true });
        return;
      }
      // 行动选择：武器 45% / 技能 35% / 普攻 20%
      const canWeapon = att.weapons.length > 0 && att.disarm <= 0;
      const actives = ACTIVE_SKILLS.filter((id) => att.skills[id] && !(id === 14 && att.usedCosmos) && !(id === 17 && (att.usedSnack || att.hp >= att.maxHp)));
      const canSkill = actives.length > 0 && att.silence <= 0;
      let roll = Math.random() * 100;
      let kind;
      if (canWeapon && canSkill) kind = roll < 45 ? 'weapon' : roll < 80 ? 'skill' : 'common';
      else if (canWeapon) kind = roll < 70 ? 'weapon' : 'common';
      else if (canSkill) kind = roll < 60 ? 'skill' : 'common';
      else kind = 'common';
      if (att.pendingWeapon && canWeapon) kind = 'weapon';

      if (kind === 'weapon') {
        const prepared = att.pendingWeapon;
        // 选武器时给「上一回合刚用过的那把」降权（而不是直接禁掉），
        // 这样连续重复同一把武器的观感变少，但不会退化成机械式的交替。
        let w;
        if (prepared) w = prepared;
        else if (att.weapons.length > 1) {
          const fresh = att.weapons.filter((x) => x.id !== att.lastWeaponId);
          const repeatLast = fresh.length && Math.random() < 0.25;
          const from = repeatLast ? att.weapons : (fresh.length ? fresh : att.weapons);
          w = from[Math.floor(Math.random() * from.length)];
        } else w = att.weapons[0];
        att.lastWeaponId = w.id;
        att.pendingWeapon = null;
        if (w.id === 1 && !prepared) {
          att.pendingWeapon = w;
          pushRound({ attacker: att.side, action: 'rest', preparingWeapon: w.id });
          return;
        }
        r.action = 'weapon'; r.id = w.id; r.level = w.level; r.wtype = w.type;
        let raw = R(w.lo, w.hi);
        raw = Math.round(raw * (1 + effPower(att) / 120));       // 力量加成
        // 武器好手是额外固定伤害，不随被菜刀削弱的力量一起下降。
        if (skill(att, 5)) raw += (10 + 2 * (skill(att, 5) - 1)) * (1 + effect(att, 31) / 100);
        raw = Math.round(raw * (1 + (effect(att, w.type === '投掷' ? 7 : 6) + (w.id <= 15 ? effect(att, w.id + 11) : 0)) / 100));
        // 命中
        const mustHit = [9, 15].includes(w.id) || att.mustHitNext;
        att.mustHitNext = false;
        // 缺陷在使用时即生效，即使这一次被闪避仍持续至战斗结束。
        if (w.id === 10) def.meteorDodge = 20;
        let dodgePct = dodgeChance(att, def);
        if (!mustHit && chance(dodgePct)) { r.dodge = true; pushRound(r); return; }
        // 暴击
        let cc = critChance(att);
        if (w.id === 11) cc += weaponEffect(w, 20, 2, 3);         // 激光剑
        if (chance(cc)) { raw = Math.round(raw * (2 + effect(att, w.type === '投掷' ? 3 : 2) / 100)); r.crit = true; }
        // 连击/三扔
        let hits = 1;
        if (w.id === 4 && chance(weaponEffect(w, 10, 2, 5))) hits = 2;          // 西瓜刀
        if (w.id === 10 && chance(weaponEffect(w, 2, 2, 3))) hits = 3;          // 流星锤
        r.hits = hits;
        let total = 0;
        for (let i = 0; i < hits; i++) {
          const rr = { dmg: 0 };
          applyDamage(att, def, raw, rr, { ignoreFakeDie: w.id === 7, action: 'weapon', weaponType: w.type });
          total += rr.dmg;
          if (rr.reboundHurt) { r.reboundHurt = (r.reboundHurt || 0) + rr.reboundHurt; r.jueDui = true; }
          if (rr.guiJia) r.guiJia = rr.guiJia;
          if (rr.fakeDie) r.fakeDie = true;
          if (rr.fakeDie || def.hp <= 0 || att.hp <= 0) break;
        }
        r.dmg = total;
        // 武器特效
        if (w.id === 3 && att.hp > 0) { att.swordDodge = Math.max(att.swordDodge, weaponEffect(w, 3, 3)); r.dodgeBuff = att.swordDodge; }
        if (def.hp > 0 && !r.fakeDie) {
          if (w.id === 5) { def.debuffs.agility = Math.max(def.debuffs.agility, weaponEffect(w, 10, 2)); r.debuffText = '敏捷降低！'; }
          if (w.id === 6) { def.debuffs.speed = Math.max(def.debuffs.speed, weaponEffect(w, 10, 2)); r.debuffText = '速度降低！'; }
          if (w.id === 8) { def.debuffs.power = Math.max(def.debuffs.power, weaponEffect(w, 10, 1)); r.debuffText = '力量降低！'; }
          if (w.id === 12 && chance(35)) { def.dot = { dmg: weaponEffect(w, 4, 3, 6), rounds: 4 }; r.dotApplied = true; }
          if (w.id === 13 && chance(weaponEffect(w, 10, 3, 3))) { def.stun = Math.max(def.stun, 1); r.stunApplied = true; }
          if (w.id === 16 && chance(weaponEffect(w, 10, 4, 4))) { def.silence = Math.max(def.silence, 4); r.silenceApplied = true; }
        }
        if (w.id === 14 && att.hp > 0) { const heal = Math.min(att.maxHp - att.hp, Math.round(total * weaponEffect(w, 10, 4, 2) / 100)); att.hp += heal; r.lifesteal = heal; }
        if (w.id === 17 && att.hp > 0) { const self = Math.round(att.hp * 0.1); att.hp -= self; r.selfBurn = self; }
        // 反击（大榔头2、死神镰刀15 不可反击）
        maybeCounter(att, def, r, w.type === '近战' && ![2, 15].includes(w.id));
        pushRound(r);
        return;
      }

      if (kind === 'skill') {
        const sid = parseInt(actives[Math.floor(Math.random() * actives.length)]);
        const lv = att.skills[sid];
        r.action = 'skill'; r.id = sid; r.level = lv;
        switch (sid) {
          case 8: { // 色诱之术
            const raw = Math.round((R(15, 25) + 7 * (lv - 1)) * (1 + effect(att, 33) / 100));
            if (chance(dodgeChance(att, def))) { att.mustHitNext = false; r.dodge = true; break; }
            applyDamage(att, def, raw, r, {});
            if (def.hp > 0 && !r.fakeDie) { def.stun = Math.max(def.stun, 1); r.stunApplied = true; }
            break;
          }
          case 12: { // 野球拳
            const raw = Math.round((effPower(att) + effSpeed(att)) * (1.2 + 0.15 * (lv - 1)));
            if (chance(dodgeChance(att, def) * 0.7)) { att.mustHitNext = false; r.dodge = true; break; }
            applyDamage(att, def, raw, r, {});
            break;
          }
          case 14: { // 小宇宙爆发
            att.usedCosmos = true;
            for (const [key, id] of [['power', 36], ['agility', 37], ['speed', 38]]) {
              att.buffFlat[key] = Math.max(1, att.baseStats[key] * lv / 100) + effect(att, id);
            }
            r.buffUp = true; r.noDmg = true; r.actAgain = true;
            r.statBonus = { ...att.buffFlat };
            break;
          }
          case 15: { // 通灵召唤
            const raw = Math.round(def.hp * (35 + 2 * (lv - 1)) / 100) + 7 + effect(att, 39);
            if (chance(dodgeChance(att, def))) { att.mustHitNext = false; r.dodge = true; break; }
            applyDamage(att, def, raw, r, { ignoreFakeDie: false });
            break;
          }
          case 17: { // 来点松果：每场战斗限用一次
            att.usedSnack = true;
            const heal = Math.min(att.maxHp - att.hp, (20 + 2 * (lv - 1)) * Math.max(1, effect(att, 40)));
            att.hp += heal;
            r.healSelf = heal; r.noDmg = true; r.actAgain = true;
            break;
          }
          case 18: { // 吸铁大法
            const raw = Math.round((R(5, 20) + 4 * (lv - 1)) * (1 + effect(att, 41) / 100));
            if (chance(dodgeChance(att, def))) { att.mustHitNext = false; r.dodge = true; break; }
            applyDamage(att, def, raw, r, { ignoreFakeDie: true });
            if (chance(10 + 4 * (lv - 1))) { def.disarm = Math.max(def.disarm, 4); r.disarmApplied = true; }
            break;
          }
          case 23: { // 幸运一击
            const mult = R(1, 6);
            const raw = (15 + 8 * (lv - 1)) * mult;
            r.multiple = mult;
            applyDamage(att, def, raw, r, {});
            break;
          }
        }
        maybeCounter(att, def, r, !r.noDmg && !r.dodge);
        pushRound(r);
        if (r.actAgain && att.hp > 0 && def.hp > 0) {
          if (!immediate) immediate = { actor: att, reason: 'freeAction' };
        }
        return;
      }

      // 普通攻击
      r.action = 'common';
      const dodge = chance(dodgeChance(att, def));
      att.mustHitNext = false;
      if (dodge) { r.dodge = true; pushRound(r); return; }
      let raw = Math.round(effPower(att) * (0.8 + Math.random() * 0.4) * (1 + effect(att, 5) / 100));
      if (chance(critChance(att))) { raw = Math.round(raw * (2 + effect(att, 1) / 100)); r.crit = true; }
      applyDamage(att, def, raw, r, {});
      maybeCounter(att, def, r, true);
      pushRound(r);
    }

    function tickRestrictions(actor) {
      if (actor.silence > 0) actor.silence--;
      if (actor.disarm > 0) actor.disarm--;
    }

    // ---- 主循环：速度行动条 ----
    let immediate = null;
    while (A.hp > 0 && B.hp > 0 && actions < MAX_ACTIONS) {
      const followup = immediate;
      let actor = followup && followup.actor;
      immediate = null;
      if (!actor) {
        // 先结清已满的行动条，避免高速度玩家无限抢占对方行动。
        if (A.ap < 100 && B.ap < 100) {
          const elapsed = Math.min((100 - A.ap) / effSpeed(A), (100 - B.ap) / effSpeed(B));
          A.ap += elapsed * effSpeed(A); B.ap += elapsed * effSpeed(B);
        }
        actor = A.ap >= B.ap ? A : B;
        actor.ap -= 100;
      }
      actions++;
      const def = actor === A ? B : A;
      // 持续伤害
      // 原攻略按中招者的四次出手计数，包括小宇宙后的追加行动。
      if (actor.dot) {
        actor.hp -= actor.dot.dmg;
        if (actor.hp <= 0 && godSave(actor)) actor.hp = 1;
        pushRound({ attacker: actor.side, action: 'dot', dmg: actor.dot.dmg, selfDot: true });
        actor.dot.rounds--;
        if (actor.dot.rounds <= 0) actor.dot = null;
        if (actor.hp <= 0) break;
      }
      if (actor.restNext) { actor.restNext = false; pushRound({ attacker: actor.side, action: 'rest' }); if (!followup) tickRestrictions(actor); continue; }
      if (actor.stun > 0) { actor.stun--; pushRound({ attacker: actor.side, action: 'stunned' }); if (!followup) tickRestrictions(actor); continue; }

      if (actor.npcType) npcAction(actor, def);
      else playerLikeAction(actor, def);
      if (!followup) tickRestrictions(actor);
      // 无敌模式兜底：吸血、自伤、反伤等旁路都不会把玩家打死
      if (A.hp <= 0 && godSave(A)) A.hp = 1;
      if (B.hp <= 0 && godSave(B)) B.hp = 1;
    }

    let winner;
    if (A.hp <= 0 && B.hp <= 0) winner = 0;
    else if (B.hp <= 0) winner = 0;
    else if (A.hp <= 0) winner = 1;
    else winner = A.hp / A.maxHp >= B.hp / B.maxHp ? 0 : 1; // 超时按血量比例

    return { rounds, winner, maxHp: [A.maxHp, B.maxHp], names: [A.name, B.name] };
  }

  window.Sim = { simulate, rules: RULES };
})();
