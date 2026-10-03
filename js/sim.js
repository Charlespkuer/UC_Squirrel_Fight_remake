/* ============================================================
 * sim.js — 战斗模拟器
 * 输出回合事件流（供 battle.js 播放）。武器/技能效果按原版
 * GameDict 描述与百科资料实现。
 *
 * 挑战塔扩展（tower.js 注入，普通战斗不带这些字段，行为与旧版一致）：
 *   fighter.mech: NPC 专属机制 id 数组（berserk/rhythmCrit/regen/thorns/
 *                 poison/freeze/wolf/lifesteal/shell/devour）
 *                 题面（最终位对手，玩家式 AI 也生效）：
 *                 trialCore（第 7 次行动起受伤 −70%、力敏速 +50%）
 *                 trialMoss（每回合回 6% 最大生命，配 thorns 反弹 15%）
 *                 trialDry（封死玩家治疗，每 3 次行动吸取玩家 10% 当前生命）
 *                 trialFrost（第 1/4/7… 次行动冻结玩家）
 *                 trialMirror（单次伤害 ≥20% 最大生命时反弹 45%）
 *                 trialBloodfang（每掉 20% 生命，攻击 +35%）
 *                 trialErode（玩家每次出手叠 1 层攻击 −3%，最多 10 层）
 *   fighter.mods: 玩家侧塔 buff 数值包 {dmgMul, critBonus, critDmgBonus,
 *                 dodgeBonus, dodgeMul, takenMul, regenPct, lifestealPct, shellPct,
 *                 openerPowerMul/openerRounds/fatiguePowerMul,
 *                 mustHitFirst, firstSkillFree, openStrikePct,
 *                 emptyMaxHpMul, lowHpTakenMul, lowHpLifestealPct, lowHpRegenPct/lowHpRegenAt,
 *                 lowHpPowerMul/lowHpAgilityMul/lowHpSpeedMul/lowHpAt}
 * ============================================================ */
(function () {
  'use strict';

  function R(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function chance(pct) { return Math.random() * 100 < pct; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // The client receives server-generated battles; no original trigger threshold
  // survives in its dictionary. Keep these reconstruction choices explicit.
  const RULES = Object.freeze({
    // 师父驾到：生命不高于 50% 时开始尝试救场（原 35%），每场至多一次
    masterHpRatio: 0.50, masterChance: 35,
    /* 出手时的「二次使用」概率（%）。做法是两层池子：本场没用过的武器/技能优先，
     * 只有这个概率才回头用旧的那把/那个，所以「用过的」实际出场率被明显压低。
     * 现在按技能分档（见 repeatBySkill）：越强的技能，二次及以后越难被再放一次。
     * 来点松果（17）单独取最低档 repeatSnack，必须严格低于其它武器与技能
     * （tools/test-combat-rules.cjs 有断言锁住这一点）。 */
    repeatWeapon: 25, repeatSkill: 20, repeatSnack: 5,
    /* 二次及以后使用概率（%）。基准 20 = repeatSkill。
     *   · medium：本来最常见、影响最大的三个（色诱/野球拳/来点松果）中幅下调；
     *   · small ：通灵召唤 / 幸运一击；以及「二次概率本来就低」的绝对防御，小幅下调。
     * 这两个档位都必须低于 repeatSkill，且 repeatSnack 仍是最低。 */
    repeatSkillMedium: 13, repeatSkillSmall: 17,
    repeatBySkill: { 8: 13, 12: 13, 15: 17, 23: 17 },
    /* 绝对防御是**受击自动触发**的技能（不进出手池），所以它不按 repeatBySkill 走，
     * 而是「首次 22% / 二次及以后 13%」——和龟甲术首次 35 / 再次 20 一样的口径。
     * 13/22 比上面那三档的降幅还大一点，因为它是「每次都白挡一下」的强被动。 */
    jueDuiChance: 22, jueDuiAgain: 13,
    shellFirst: 35, shellAgain: 20,
  });
  /* ============================================================
   * sim 真正实现了战斗效果的主动技能。
   *
   * 原版技能表里 2~11、13、16、19~22 大多是**被动**（力王附体/身手敏捷/龟甲术/
   * 皮糙肉厚/绝对防御…）或空 id（原版字典里 19~22 没有名字）。
   * 玩家只会领悟下面这 7 个主动技，但敌人模板历史上抄了一批没实现的 id ——
   * 放出来就是「空过一回合」（元素术鼠的 5「武器好手」其实是被动、20 是空 id）。
   * 所以出招时只从这张表里挑：数据写错的技能会被自动跳过，不会再空过。
   * ============================================================ */
  const ACTIVE_SKILLS = [8, 12, 14, 15, 17, 18, 23];
  /** 调试开关「无敌模式」：玩家侧不会被击倒，最少保留 1 点血。 */
  function godSave(def) {
    try { return !!(def && def.side === 0 && window.Debug && window.Debug.enabled('godMode')); } catch (e) { return false; }
  }

  /**
   * fighter 输入: {name, level, power, agility, speed, hp,
   *   weapons:[{id,level,harmLo,harmHi,type}], skills:[{id,level,type}],
   *   baseStats?:{power,agility,speed}, masterLevel?:number,
   *   npcType: null|'tl'|'xh'|'xm'|'wood',
   *   mech?: string[], mods?: object}   ← 挑战塔扩展
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
    const mech = Array.isArray(f.mech) ? f.mech.slice() : (f.mech ? [f.mech] : []);
    const mods = f.mods && typeof f.mods === 'object' ? f.mods : null;
    return {
      side, name: f.name, level: stat(f.level, 1), npcType: f.npcType || null,
      power: stat(f.power, 1), agility: stat(f.agility, 1), speed: stat(f.speed, 1),
      maxHp: fullHp, hp: Math.max(1, Math.min(stat(f.hp, 1), fullHp)),
      weapons, skills, usedWeapons: {}, usedSkills: {}, lastWeaponId: null, lastSkillId: null,
      /* 固定循环出招用：完整技能表（顺序稳定，不受「本场已用」过滤影响）+ 循环下标。
       * 以前按 actives.sort()[0] 取最小 id，结果 5/17/20 里永远只放 17（来点松果）——
       * 元素术鼠 200 场里吃了 7326 次松果，就是这个 bug。 */
      /* 完整技能表的稳定顺序（skills 是「id → 等级」的对象，不是数组！）。
       * 原版这里写的是 skills[id] 下标访问，永远取不到东西 —— 所以固定循环的技能
       * 只能退化成「取 actives 里最小的 id」，元素术鼠因此整场都在放来点松果。 */
      /* 只保留 sim 真正实现的技能（数据里抄错的 id 会被丢弃，不会空过一回合）。
       * 若一个都不剩，就用 ACTIVE_SKILLS 兜底，避免出现「完全不会放技能」的敌人。 */
      skillOrder: (function () {
        const own = Array.isArray(f.castable) ? f.castable.map(Number) : Object.keys(skills).map(Number);
        const usable = own.filter((id) => ACTIVE_SKILLS.includes(id) && skills[id]);
        return (usable.length ? usable : ACTIVE_SKILLS.filter((id) => skills[id] || usable.length === 0)).sort((a, b) => a - b);
      })(),
      patternSkillIdx: 0,
      /* 「同一回合内只能用一次」的锚点：turnId 变化 = 换了一个回合。 */
      turnId: 0, lastTurnId: -1, turnSkills: {},
      effects: f.effects || {}, masterLevel: Math.max(0, Number(f.masterLevel) || 0),
      // 攻略.md 的裸属性解释与 PPT 的含装备解释冲突。本版采用前者，
      // callers provide growth stats excluding equipment, skills and pills.
      // Older fighter snapshots lack this field, so retain their recorded stats.
      baseStats: Object.fromEntries(['power', 'agility', 'speed'].map((key) => [key, stat(f.baseStats?.[key], stat(f[key], 1))])),
      // 战斗内状态
      ap: 0, restNext: false, pendingWeapon: null, stun: 0, silence: 0, disarm: 0, shellCharges: 0,
      mustHitNext: !!(mods && mods.mustHitFirst), stripTurns: 0, usedFakeDie: false, usedMaster: false, usedShell: false, usedCosmos: false, usedSnack: false, usedJueDui: false,
      // 题面·枯泉：治疗量倍率（0 = 完全封疗）
      healMul: 1,
      usedUlt: false, acted: false, usedFreeSkill: false,
      swordDodge: 0, meteorDodge: 0, debuffs: { power: 0, agility: 0, speed: 0 },
      dot: null, // {dmg, rounds} 或 {pct, rounds}（按当前生命比例扣血）
      buffFlat: { power: 0, agility: 0, speed: 0 },
      // —— 挑战塔扩展状态 ——
      mech, mods,
      // 机制的可调数值（tower-data.js 里定，题面文本与判定共用一份，避免文案/数值走偏）
      mechParams: f.mechParams && typeof f.mechParams === 'object' ? f.mechParams : null,
      // 松鼠对手的固定出招循环（tower-data.js 定义）：['common'|'weapon'|'skill', …]
      pattern: Array.isArray(f.pattern) && f.pattern.length ? f.pattern.slice() : null,
      patternStep: 0,
      mechState: { basePower: stat(f.power, 1), berserk: false, core: false, bfStep: 0, erode: 0 },
      shell: Math.round(fullHp * ((mech.includes('shell') ? 0.30 : 0) + (mods && mods.shellPct || 0))),
      pendingNote: null,
    };
  }

  /** 任何扣血途径致死时的兜底：不死鸟（复活）/ 金蝉脱壳（保留 1 血）/ 无敌模式。
   *  原来只有 applyDamage 里判，中毒、荆棘反弹、双刃剑自伤、枯泉吸血把人打死时
   *  复活甲不会触发 —— 玩家会以为「buff 没生效」。 */
  function tryDeathSave(def, r) {
    if (!def || def.hp > 0) return false;
    if (def.mods && Array.isArray(def.mods.deathSaves) && def.mods.deathSaves.length) {
      const sv = def.mods.deathSaves.shift();
      def.hp = sv.healPct ? Math.max(1, Math.round(def.maxHp * sv.healPct)) : 1;
      if (r) {
        r.deathSave = true;
        r.noteText = (r.noteText ? r.noteText + '·' : '') + (sv.healPct ? '不死鸟' : '金蝉脱壳');
        r.noteSide = def.side;
      }
      return true;
    }
    if (godSave(def)) { def.hp = 1; if (r) r.godSave = true; return true; }
    return false;
  }

  /** 真·色诱之术：被脱光装备期间，装备提供的属性与附加能力全部失效（回到裸属性）。 */
  function stripped(c) { return Number(c.stripTurns) > 0; }
  function statOf(c, key) { return stripped(c) ? c.baseStats[key] : c[key]; }
  /** 题面·枯泉：治疗量被压制时按倍率结算（0 层完全封疗）。 */
  function healOf(c, amount) { return Math.max(0, Math.round(Number(amount) * (c.healMul == null ? 1 : c.healMul))); }
  function effPower(c) {
    let p = statOf(c, 'power') * (1 - c.debuffs.power / 100) + c.buffFlat.power;
    // 塔 buff「狂怒」：自己血量低于阈值时攻击提升（只有进攻方结算，所以放在这里）
    const rage = c.mods && Number(c.mods.lowHpPowerMul) || 0;
    if (rage > 0 && lowHpActive(c)) p *= 1 + rage;
    /* 塔 buff「开局狂热」：按**本次战斗的出手次数**分档 ——
     * 前 openerRounds 次出手 ×(1+openerPowerMul)，之后 ×(1-fatiguePowerMul)。
     * 玩家与敌人共用这段逻辑，但只有拿到该 buff 的一方 mods 里才有这两个字段。 */
    if (c.mods) {
      const boost = Number(c.mods.openerPowerMul) || 0;
      const fatigue = Number(c.mods.fatiguePowerMul) || 0;
      if (boost || fatigue) {
        const rounds = Math.max(1, Number(c.mods.openerRounds) || 5);
        p *= (Number(c.acts) || 1) <= rounds ? 1 + boost : 1 - fatigue;
      }
    }
    return Math.max(1, Math.round(p));
  }
  /** 低血门槛是否成立（塔 buff「狂怒」共用一套判定：攻/敏/速同时生效）。 */
  function lowHpActive(c) {
    const th = c.mods && Number(c.mods.lowHpAt);
    return !!(th > 0 && c.maxHp > 0 && c.hp <= c.maxHp * th);
  }
  function effAgility(c) {
    let a = statOf(c, 'agility') * (1 - c.debuffs.agility / 100) + c.buffFlat.agility;
    const m = c.mods && Number(c.mods.lowHpAgilityMul) || 0;
    if (m > 0 && lowHpActive(c)) a *= 1 + m;
    return Math.max(1, Math.round(a));
  }
  function effSpeed(c) {
    let v = statOf(c, 'speed') * (1 - c.debuffs.speed / 100) + c.buffFlat.speed;
    const m = c.mods && Number(c.mods.lowHpSpeedMul) || 0;
    if (m > 0 && lowHpActive(c)) v *= 1 + m;
    return Math.max(1, Math.round(v));
  }
  function effect(c, id) { return stripped(c) ? 0 : Math.max(0, Number(c.effects[id]) || 0); }
  /** 真级工具：等级 11~15 = 真1~真5。 */
  const trueLvOf = (level) => (window.GData && GData.trueLevel ? GData.trueLevel(level) : Math.max(0, Math.min(5, (Number(level) || 0) - 10)));
  const trueVal = (id, level) => (window.GData && GData.trueSkillValue ? GData.trueSkillValue(id, level) : 0);
  const trueW = (w, key) => (window.GData && GData.trueWeaponBonus ? GData.trueWeaponBonus(w, key) : 0);
  // 沉默之斧保留四项基础属性技，抑制其余主动、被动及防御技能。
  function skill(c, id) { return c.silence > 0 && id > 4 ? 0 : c.skills[id] || 0; }
  function weaponEffect(w, base, perLevel, perTrueLevel) {
    return base + perLevel * (Math.min(w.level, 10) - 1) + (perTrueLevel || 0) * Math.max(0, w.level - 10);
  }
  /** 塔 buff 的暴击伤害加成（比例）。 */
  function critDmgBonus(att) { return (att.mods && Number(att.mods.critDmgBonus) || 0) / 100; }

  function pickOne(list) { return list[Math.floor(Math.random() * list.length)]; }
  /** 「本场没用过」的基准权重；用过的按各自的二次使用概率降权，所以一用再用会被明显压掉。 */
  const UNUSED_WEIGHT = 100;
  /** 刚刚用过的那一个再额外打折，避免连着两回合是同一把/同一个。 */
  const LAST_PENALTY = 0.3;

  function pickWeighted(list, weightOf) {
    let total = 0;
    for (const x of list) total += weightOf(x);
    if (!(total > 0)) return pickOne(list);
    let roll = Math.random() * total;
    for (const x of list) { roll -= weightOf(x); if (roll <= 0) return x; }
    return list[list.length - 1];
  }

  /**
   * 出手权重（武器/技能共用口径，并导出给测试直接校验）：
   *   - 本场没用过 → UNUSED_WEIGHT（远高于用过的，所以优先，但不是绝对优先）；
   *   - 已经用过   → 它的「二次使用概率」；来点松果（17）取最低档 repeatSnack；
   *   - 上一回合刚用过的那一个再乘 LAST_PENALTY，避免连着重复同一把/同一个。
   * 「所有技能的二次使用概率被调低」和「来点松果最低」两条都落在这里。
   */
  /** 某个技能「二次及以后」的使用概率（%）。未列出的用基准 repeatSkill。 */
  function repeatRateOf(id) {
    if (id === 17) return RULES.repeatSnack;                 // 来点松果：最低档，不许被别档追平
    const tier = RULES.repeatBySkill[id];
    return Number.isFinite(tier) ? tier : RULES.repeatSkill;
  }
  function skillWeight(att, id) {
    let w = att.usedSkills[id] ? repeatRateOf(id) : UNUSED_WEIGHT;
    if (att.lastSkillId === id) w *= LAST_PENALTY;
    return w;
  }
  function weaponWeight(att, id) {
    let w = att.usedWeapons[id] ? RULES.repeatWeapon : UNUSED_WEIGHT;
    if (att.lastWeaponId === id) w *= LAST_PENALTY;
    return w;
  }

  /** 技能选择：按 skillWeight 加权 → 没用过的优先、二次使用被压掉、来点松果最低。 */
  /* ---------- 出手类型概率（百分比；武器 / 技能 / 普攻 划分） ----------
   * 默认：武器 48 / 技能 40 / 普攻 12（普攻意愿比原来更低一档）。
   * 武器与技能**都至少用过一遍**之后：武器 70 / 技能 18 / 普攻 12 ——
   *   技能比武器强力，用过一轮之后不该再被反复放，所以把权重挪给武器。
   * 只有武器 / 只有技能时是 78/22、70/30；
   * 三侠 NPC（npcAction）没有武器池，用它自己那一行 70/30，行为与本项改动前一致。 */
  const KIND_BOTH = [48, 88];
  const KIND_BOTH_ALL_USED = [70, 88];
  const KIND_WEAPON_ONLY = [78, 100];
  const KIND_SKILL_ONLY = [70, 100];
  const KIND_NPC_SKILL_ONLY = [30, 100];
  /** 一次 Math.random() 决定出手类型（和原来 chance() 的消耗一致，不影响既有随机序列）。 */
  function pickKind(canWeapon, canSkill, allUsed, npcSkillOnly) {
    const roll = Math.random() * 100;
    if (canWeapon && canSkill) {
      const t = allUsed ? KIND_BOTH_ALL_USED : KIND_BOTH;
      return roll < t[0] ? 'weapon' : roll < t[1] ? 'skill' : 'common';
    }
    if (canWeapon) return roll < KIND_WEAPON_ONLY[0] ? 'weapon' : 'common';
    if (canSkill) return roll < (npcSkillOnly ? KIND_NPC_SKILL_ONLY[0] : KIND_SKILL_ONLY[0]) ? 'skill' : 'common';
    return 'common';
  }
  /** 本场的武器与「当前可用的主动技能」是否都已经至少用过一次。 */
  function allToolsUsed(att, actives) {
    if (!att.weapons.length || !actives.length) return false;
    return att.weapons.every((w) => att.usedWeapons[w.id]) && actives.every((id) => att.usedSkills[id]);
  }

  /** 固定循环出招：按「技能表的轮转顺序」依次放技能，缺一个就顺延到下一个能用的。
   *  原来这里取 actives 里最小的 id，于是 5/17/20 永远只放 17（来点松果）——
   *  元素术鼠因此整场都在吃松果，循环描述（冰霜 → 普攻 → 烈焰 → 雷击）也从来没成立过。
   *  现在 skillOrder 固定不变（不受本场已用过滤影响），循环因此稳定可预告。 */
  function nextPatternSkill(att, actives) {
    const order = (att.skillOrder && att.skillOrder.length) ? att.skillOrder : actives.slice().sort((a, b) => a - b);
    const n = order.length;
    for (let i = 0; i < n; i++) {
      const id = order[(att.patternSkillIdx + i) % n];
      const sid = Number(id);
      if (actives.includes(sid)) { att.patternSkillIdx = (att.patternSkillIdx + i + 1) % n; return sid; }
    }
    return Number(actives[0]);
  }
  function pickSkill(att, actives) {
    return pickWeighted(actives, (id) => skillWeight(att, id));
  }
  /** 武器选择：同一套口径。 */
  function pickWeapon(att) {
    return pickWeighted(att.weapons, (w) => weaponWeight(att, w.id));
  }

  function dodgeChance(att, def) {
    /* 本轮第 1 项：百步穿杨（mustHitAll）—— 接下来 3 场「所有攻击必中」，
     * 所以这里直接返回 0 闪避率（普攻/武器/技能/反击全都覆盖）。
     * 原来的 mustHitFirst 是「下一次攻击必中」，由 mustHitNext 单次标记实现。 */
    if (att.mods && (att.mods.mustHitAll || att.mods.firstStrikeAll)) return 0;   // 「必中」类：塔 buff 百步穿杨 / 必中
    const wMust = att.mustHitNext;
    if (wMust) return 0;
    let d = 6 + 26 * effAgility(def) / (effAgility(def) + effAgility(att) * 1.2 + 40);
    const shift = skill(def, 11) ? (5 + 2 * (skill(def, 11) - 1)) * (1 + effect(def, 35) / 100) : 0;
    // PPT问答：木剑、移形、流星锤均相对提升天生闪避率。
    d *= 1 + (shift + def.swordDodge + def.meteorDodge) / 100;
    if (def.mods && def.mods.dodgeBonus) d += Number(def.mods.dodgeBonus);   // 塔 buff「凌波微步」（加算）
    if (def.mods && def.mods.dodgeMul) d *= 1 + Number(def.mods.dodgeMul);   // 塔 buff「烟幕」：闪避率 ×(1+n)
    return clamp(d, 0, 55);
  }

  function critChance(att) {
    let c = 5;
    if (skill(att, 9)) c += 2 * skill(att, 9);                  // 暴击
    if (att.mods && att.mods.critBonus) c += Number(att.mods.critBonus);   // 塔 buff「鹰眼」
    return c;
  }

  function dmgReduce(def, dmg, opts) {
    opts = opts || {};
    let out = { dmg, guiJia: 0, jueDui: 0, rebound: 0 };
    const gearReduction = opts.action === 'weapon' ? effect(def, opts.weaponType === '投掷' ? 10 : 9) : opts.action === 'skill' ? effect(def, 11) : 0;
    out.dmg = Math.round(out.dmg * (1 - clamp(gearReduction, 0, 80) / 100));
    /* 绝对防御是受击自动触发、不进出手池的技能，所以「二次及以后」用单独的档：
     * 首次 jueDuiChance%，之后再挨打只有 jueDuiAgain% 再挡一次（口径同龟甲术）。 */
    if (def.skills[16] && def.silence <= 0
        && chance(def.usedJueDui ? RULES.jueDuiAgain : RULES.jueDuiChance)) {
      def.usedJueDui = true;
      const pct = 40 + 4 * (def.skills[16] - 1);
      out.jueDui = out.dmg; out.rebound = Math.round(out.dmg * pct / 100); out.dmg = 0;
      return out;
    }
    /* 龟甲术：首次受击 35%；触发过一次之后不再是一次性的，每次受击仍有
     * shellAgain% + 装备附加能力「龟甲术N%几率抵挡2次」的概率再挡一次。
     * 它只在绝对防御**没触发**时才会判定（绝对防御在前且直接 return），
     * 所以多带一个龟甲术只会让受伤期望更低，不可能挤占绝对防御。 */
    if (def.skills[7] && def.silence <= 0) {
      const canTrigger = def.shellCharges > 0
        || (!def.usedShell && chance(RULES.shellFirst))
        || (def.usedShell && chance(RULES.shellAgain + effect(def, 32) + trueVal(7, def.skills[7]) * 100));
      if (canTrigger) {
        if (def.shellCharges > 0) def.shellCharges--;
        else def.usedShell = true;
        const pct = clamp(20 + 5 * (def.skills[7] - 1), 0, 80);
        out.guiJia = Math.round(out.dmg * pct / 100);
        out.dmg -= out.guiJia;
      }
    }
    if (skill(def, 10)) {                                      // 皮糙肉厚
      const pct = clamp((5 + (skill(def, 10) - 1)) * (1 + effect(def, 34) / 100), 0, 80);
      out.dmg = Math.round(out.dmg * (100 - pct) / 100);
    }
    if (def.mods && def.mods.takenMul) out.dmg = Math.round(out.dmg * (1 + Number(def.mods.takenMul)));   // 塔 buff「铁布衫」
    /* 塔 buff「铁血护盾 / 濒死觉悟」：**低血时**才减伤（与狂怒共用 lowHpAt 阈值）。 */
    if (def.mods && def.mods.lowHpTakenMul && lowHpActive(def)) {
      out.dmg = Math.round(out.dmg * (1 + Number(def.mods.lowHpTakenMul)));
    }
    if (def.mech.includes('trialCore') && def.mechState.core) out.dmg = Math.round(out.dmg * 0.3);        // 题面·熔核：成型后受伤 −70%
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
    /* 开局护盾值（石像鬼机制 / 塔 buff「坚韧壁垒」）：给界面用 ——
     * 战斗一开始就要能把护盾画出来，不能等第一次挨打。 */
    const startShell = [Math.max(0, A.shell || 0), Math.max(0, B.shell || 0)];
    const rounds = [];
    const MAX_ACTIONS = 120;
    let actions = 0;

    function pushRound(r) {
      // Preserve the user's Debug mode in the event snapshots as well as winner.
      if (A.hp <= 0 && godSave(A)) A.hp = 1;
      if (B.hp <= 0 && godSave(B)) B.hp = 1;
      // 机制提示挂到行动方的回合事件上（血性狂暴/寒冰禁锢/吞噬成长等）
      if (r && r.attacker != null) {
        const c = r.attacker === 0 ? A : B;
        if (c.pendingNote) { r.noteText = (r.noteText ? r.noteText + '·' : '') + c.pendingNote; c.pendingNote = null; }
      }
      r.hpAfter = [Math.max(0, A.hp), Math.max(0, B.hp)];
      /* 需求：护盾要能在局内**直观看到**（存在 + 剩余量）。
       * 把两边的剩余护盾一并记进事件快照 —— 界面的战斗详情/血条靠它显示，
       * 录像回放也能看到「这回合被护盾吃掉了多少」。 */
      r.shellAfter = [Math.max(0, A.shell || 0), Math.max(0, B.shell || 0)];
      rounds.push(r);
    }

    function applyDamage(att, def, rawDmg, r, opts) {
      opts = opts || {};
      const action = opts.action || r.action;
      if (att.mods && att.mods.dmgMul) rawDmg = Math.round(rawDmg * Number(att.mods.dmgMul));   // 塔 buff 伤害乘区（猎侠者/机制破解/精英杀手等，tower.js 按对手预算好）
      if (action === 'skill') {
        rawDmg = Math.round(rawDmg * (1 + effect(att, 8) / 100));
        /* 真·皮糙肉厚：额外压制对手的暴击率（真5 压 50%）。
         * 真·暴击：暴击发生时有机会把倍率从 2 倍抬到 4 倍（真5 50%）。 */
        const antiCrit = trueVal(10, def.skills[10]);
        const cc = critChance(att) * (1 - antiCrit);
        if (chance(cc)) {
          const quad = trueVal(9, att.skills[9]) * 100;
          const mul = (quad > 0 && chance(quad)) ? 4 : 2;
          if (mul === 4) r.crit4 = true;
          rawDmg = Math.round(rawDmg * (mul + effect(att, 4) / 100 + critDmgBonus(att)));
          r.crit = true;
        }
      }
      const red = dmgReduce(def, rawDmg, { action, weaponType: opts.weaponType });
      let dmg = red.dmg;
      /* 本轮第 1 项：史诗增益「先机预判」—— 每场战斗敌方对我方的**第一次攻击**伤害归零。
       * 放在这里而不是别处，是因为反伤（荆棘铁壁 / 荆棘之甲 / 镜鳞）和中毒都是直接
       * `hp -= x` 结算的，根本不走 applyDamage 的攻击路径 —— 所以它们天然不会消耗这次免疫，
       * 正好满足「该 buff 不会被反伤 debuff 破坏」。mods 是每场战斗新建的对象，
       * 用它自己当「本场用过了吗」的标记即可。 */
      if (dmg > 0 && def.mods && def.mods.firstHitZero && !def.mods.firstHitZeroUsed) {
        def.mods.firstHitZeroUsed = true;
        dmg = 0;
        r.firstHitZero = true;
        r.noteText = (r.noteText ? r.noteText + '·' : '') + '先机预判'; r.noteSide = def.side;
      }
      if (red.jueDui) { r.jueDui = true; r.rebound = red.rebound; }
      if (red.guiJia) r.guiJia = red.guiJia;
      // 开局护盾（石像鬼机制 / 塔 buff「坚韧壁垒」）：先于血量消耗
      if (def.shell > 0 && dmg > 0) {
        const absorbed = Math.min(def.shell, dmg);
        def.shell -= absorbed; dmg -= absorbed;
        r.shellAbsorb = absorbed;
      }
      // 装死
      if (def.hp - dmg <= 0 && def.skills[6] && def.silence <= 0 && !def.usedFakeDie && !opts.ignoreFakeDie) {
        def.usedFakeDie = true;
        dmg = Math.max(0, def.hp - 1);
        def.hp = 1;
        r.fakeDie = true;
        def.stun = 0;
        immediate = { actor: def, reason: 'fakeDie' };
      } else if (def.hp - dmg <= 0 && def.mods && Array.isArray(def.mods.deathSaves) && def.mods.deathSaves.length) {
        const sv = def.mods.deathSaves.shift();
        def.hp = sv.healPct ? Math.max(1, Math.round(def.maxHp * sv.healPct)) : 1;
        r.deathSave = true;
        r.noteText = sv.healPct ? '不死鸟' : '金蝉脱壳'; r.noteSide = def.side;
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
        tryDeathSave(att, r);
      }
      // —— 受击/命中方机制（挑战塔 NPC 池） ——
      if (dmg > 0) {
        if (def.mech.includes('thorns') && att.hp > 0) {          // 荆棘铁壁：反弹 15%
          const reflect = Math.max(1, Math.round(dmg * 0.15));
          att.hp -= reflect;
          r.thornsDmg = (r.thornsDmg || 0) + reflect;
          tryDeathSave(att, r);
        }
        // 塔 buff「荆棘之甲」：玩家侧反伤（跨层类）
        const thornsPct = def.mods && Number(def.mods.thornsPct) || 0;
        if (thornsPct > 0 && att.hp > 0) {
          const reflect = Math.max(1, Math.round(dmg * thornsPct));
          att.hp -= reflect;
          r.thornsDmg = (r.thornsDmg || 0) + reflect;
          r.noteText = (r.noteText ? r.noteText + '·' : '') + '荆棘之甲'; r.noteSide = def.side;
          tryDeathSave(att, r);
        }
        // 题面·镜鳞：单次伤害超过阈值（默认 20% 最大生命）时，反弹该次伤害的 45%
        // （逼玩家压低单次伤害 / 走多段；阈值与反弹比例由 tower-data.js 注入，方便调平衡）
        const mp = (def.mechParams && def.mechParams.trialMirror) || null;
        const threshold = (mp && Number(mp.threshold)) || 0.15;
        const reflectPct = (mp && Number(mp.reflect)) || 0.6;
        if (def.mech.includes('trialMirror') && att.hp > 0 && dmg >= def.maxHp * threshold) {
          const reflect = Math.max(1, Math.round(dmg * reflectPct));
          att.hp -= reflect;
          r.thornsDmg = (r.thornsDmg || 0) + reflect;
          r.noteText = (r.noteText ? r.noteText + '·' : '') + '镜鳞·反噬'; r.noteSide = def.side;
        }
        if (def.mech.includes('poison') && !att.dot && chance(30)) {  // 毒藤缠绕：30% 中毒
          att.dot = { pct: 0.03, rounds: 3 };
          r.poisonApplied = true;
          r.noteText = (r.noteText ? r.noteText + '·' : '') + '毒藤缠绕'; r.noteSide = def.side;
        }
        let lsPct = (att.mech.includes('lifesteal') ? 0.30 : 0) + (att.mods && Number(att.mods.lifestealPct) || 0);
        /* 低血吸血（濒死觉悟）：同样读 lowHpAt，按**攻击方当前血量**判定。 */
        if (att.mods && att.mods.lowHpLifestealPct && lowHpActive(att)) lsPct += Number(att.mods.lowHpLifestealPct) || 0;
        if (lsPct > 0 && att.hp > 0) {                              // 血之渴望 / 血饮狂刀
          const heal = Math.min(att.maxHp - att.hp, healOf(att, dmg * lsPct));
          if (heal > 0) { att.hp += heal; r.lifesteal = (r.lifesteal || 0) + heal; }
        }
      }
      return dmg;
    }

    /** NPC 大招（每场一次）：螳螂低血乱舞、仙鹤开场展翅、熊猫低血震地。 */
    function npcUlt(att, def) {
      const r = { attacker: att.side, action: 'skill', npcSkill: true, ult: true };
      if (att.npcType === 'tl') {
        // 疾风镰刀舞：生命低于20%时孤注一掷的四连击（门槛与伤害都下调过：
        // 原版 35% / 每击 0.55 倍，实战里几乎每场都放且总伤达 2.2 倍力量）
        r.ultName = '疾风镰刀舞'; r.multiHit = 4;
        if (chance(dodgeChance(att, def))) { r.dodge = true; pushRound(r); return; }
        let total = 0;
        for (let i = 0; i < 4; i++) {
          const rr = { dmg: 0 };
          applyDamage(att, def, Math.round(effPower(att) * 0.36), rr, { action: 'skill' });
          total += rr.dmg;
          if (rr.reboundHurt) { r.reboundHurt = (r.reboundHurt || 0) + rr.reboundHurt; r.jueDui = true; }
          if (rr.fakeDie || def.hp <= 0 || att.hp <= 0) break;
        }
        r.dmg = total; pushRound(r); return;
      }
      if (att.npcType === 'xh') {
        // 仙鹤展翅：开场第一次行动的重击，契合“前期凶猛”
        r.ultName = '仙鹤展翅';
        const raw = Math.round((effPower(att) + effSpeed(att)) * 1.35);
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

    /** 回合开始时的 NPC 机制触发（狂暴/冻结）；返回附加提示。 */
    function npcMechTurnStart(att, def) {
      if (att.mech.includes('berserk') && !att.mechState.berserk && att.hp > 0 && att.hp < att.maxHp * 0.5) {
        att.mechState.berserk = true;
        att.buffFlat.power += att.power;                 // 血性狂暴：攻击力翻倍
        att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') + '血性狂暴';
      }
      if (att.mech.includes('freeze') && (att.npcActs || 0) % 3 === 0) {
        def.stun = Math.max(def.stun, 1);                // 寒冰禁锢：每第 3 次行动冻结玩家
        att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') + '寒冰禁锢';
      }
      /* ---------------- 挑战塔题面（最终位对手） ----------------
       * 题面文本写的是「第 N 回合」；这里统一把 att.npcActs 当作它的出手次数。 */
      const acts = att.npcActs || 0;
      // 熔核：第 5 次行动起硬度暴涨（受伤 −80%、力敏速 +50%）—— 强制前 4 回合速杀
      /* 需求 5：成型时点从「第 5 次行动」推到「第 7 次行动」，减伤从 80% 降到 70%。
       * 玩家的输出窗口因此多两回合，成型后也没那么硬。 */
      if (att.mech.includes('trialCore') && !att.mechState.core && acts >= 7) {
        att.mechState.core = true;
        for (const key of ['power', 'agility', 'speed']) att.buffFlat[key] += Math.max(1, Math.round(att[key] * 0.5));
        att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') + '熔核成型';
      }
      // 血牙：每掉 20% 生命，攻击 +35%（越打越猛）—— 逼一波带走
      if (att.mech.includes('trialBloodfang') && att.maxHp > 0) {
        const step = Math.floor((1 - att.hp / att.maxHp) / 0.2);
        if (step > att.mechState.bfStep) {
          const add = step - att.mechState.bfStep;
          att.mechState.bfStep = step;
          att.buffFlat.power += Math.max(1, Math.round(att.mechState.basePower * 0.35)) * add;
          att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') + '血牙·狂怒';
        }
      }
      // 霜缚：第 1/4/7... 次行动前冻结玩家一次
      if (att.mech.includes('trialFrost') && (acts - 1) % 3 === 0) {
        def.stun = Math.max(def.stun, 1);
        att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') + '霜缚';
      }
      // 枯泉：封死玩家治疗，并且每 3 次行动吸取玩家 10% 当前生命
      if (att.mech.includes('trialDry')) {
        def.healMul = 0;
        if (acts % 3 === 0 && def.hp > 0) {
          const drain = Math.max(1, Math.round(def.hp * 0.1));
          def.hp = Math.max(0, def.hp - drain);
          att.hp = Math.min(att.maxHp, att.hp + drain);
          att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') + '枯泉·吸血';
        }
      }
      // 苔龟：每回合回复 6% 最大生命（受击反弹 15% 走 thorns）
      if (att.mech.includes('trialMoss') && att.hp > 0 && att.hp < att.maxHp) {
        att.hp = Math.min(att.maxHp, att.hp + Math.max(1, Math.round(att.maxHp * 0.06)));
        att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') + '苔甲再生';
      }
    }

    /** NPC 行动结束后的机制（唤狼协战 / 无尽吞噬），在主循环里调用。 */
    function npcMechAfter(att, def) {
      if (att.hp <= 0 || def.hp <= 0) return;
      if (att.mech.includes('wolf') && (att.npcActs || 0) % 2 === 0) {
        // 唤狼协战：0.5×力量的必中突袭（不占行动，不可反击）
        const wr = { attacker: att.side, action: 'skill', npcSkill: true, wolf: true, ultName: '唤狼协战' };
        applyDamage(att, def, Math.round(effPower(att) * 0.5), wr, {});
        pushRound(wr);
      }
      /* 吞噬成长：每回合结束按「入场力量」永久 +N%，可无限叠加。
       * 既支持原来的机制标签（固定 2%），也支持带数值的 mods.devourPct（环境词缀用）。 */
      const devourPct = (att.mech.includes('devour') ? 0.02 : 0) + (att.mods && Number(att.mods.devourPct) || 0);
      if (devourPct > 0) {
        att.buffFlat.power += Math.max(1, Math.round(att.mechState.basePower * devourPct));
        att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') + '无尽吞噬';
      }
    }

    function npcAction(att, def) {
      // 大招（每场一次）：仙鹤开场即放，螳螂/熊猫压低生命后触发
      const firstAction = !att.acted; att.acted = true;
      att.npcActs = (att.npcActs || 0) + 1;   // 仙鹤前期凶猛：前3次行动伤害+30%
      npcMechTurnStart(att, def);
      // 瞬杀节奏：每第 4 次行动必定暴击，暴击伤害 +50%
      const rhythm = att.mech.includes('rhythmCrit') && att.npcActs % 4 === 0;
      if (rhythm) att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') + '瞬杀节奏';
      if (!att.usedUlt && (att.npcType === 'xh' ? firstAction
        : att.npcType === 'tl' ? att.hp < att.maxHp * 0.2
        : att.npcType === 'xm' ? att.hp < att.maxHp * 0.4 : false)) {
        att.usedUlt = true; npcUlt(att, def); return;
      }
      // NPC：70% 普攻，30% 技能
      // 与玩家共用 pickKind；三侠没有武器池，走它自己的 70/30 分支
      const useSkill = Object.keys(att.skills).length > 0 && pickKind(false, true, false, true) === 'skill';
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
        if (rhythm) { raw = Math.round(raw * 2.5); r.crit = true; }
        // 命中
        if (chance(dodgeChance(att, def))) { r.dodge = true; pushRound(r); return; }
        let total = 0;
        const hits = r.multiHit || 1;
        for (let i = 0; i < hits; i++) {
          const rr = { dmg: 0 };
          applyDamage(att, def, raw, rr, { action: 'skill' });
          total += rr.dmg;
          if (rr.reboundHurt) { r.reboundHurt = (r.reboundHurt || 0) + rr.reboundHurt; r.jueDui = true; }
          if (rr.thornsDmg) r.thornsDmg = (r.thornsDmg || 0) + rr.thornsDmg;
          if (rr.shellAbsorb) r.shellAbsorb = (r.shellAbsorb || 0) + rr.shellAbsorb;
          if (rr.lifesteal) r.lifesteal = (r.lifesteal || 0) + rr.lifesteal;
          if (rr.guiJia) r.guiJia = rr.guiJia;
          if (rr.fakeDie) r.fakeDie = true;
          if (rr.deathSave) { r.deathSave = true; r.noteText = rr.noteText; r.noteSide = rr.noteSide; }
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
      if (att.npcType === 'tl' && att.hp < att.maxHp * 0.25) raw = Math.round(raw * 1.3); // 螳螂低血爆发
      if (rhythm) { raw = Math.round(raw * 2.5); r.crit = true; }
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
      if (counter.thornsDmg) r.counterThorns = counter.thornsDmg;
      /* 反击同样走 applyDamage：如果这一击被「先机预判」归零了（反击也算敌方对我方的
       * 一次攻击，见需求确认），必须把标记一起带上来 —— 否则免疫**被悄悄消耗**、
       * 战斗详情里既看不到这次归零，后面的普攻也不再触发，玩家只会觉得「这 buff 没生效」。 */
      if (counter.firstHitZero) {
        r.firstHitZero = true;
        r.noteText = (r.noteText ? r.noteText + '·' : '') + '先机预判';
        r.noteSide = counter.noteSide;
      }
    }

    function playerLikeAction(att, def) {
      const r = { attacker: att.side };
      // 师父只在濒危时尝试救场，每场至多一次；无师父时不能凭空治疗。
      if (att.skills[13] && !att.usedMaster && att.masterLevel > 0 && att.silence <= 0 &&
          att.hp <= att.maxHp * rules.masterHpRatio && chance(rules.masterChance)) {
        att.usedMaster = true;
        const heal = Math.min(att.maxHp - att.hp, healOf(att, att.masterLevel * 4));
        att.hp += heal;
        att.mustHitNext = true;
        pushRound({ attacker: att.side, action: 'skill', id: 13, level: att.skills[13], healSelf: heal, noDmg: true });
        return;
      }
      // 行动选择：武器 45% / 技能 35% / 普攻 20%
      const canWeapon = att.weapons.length > 0 && att.disarm <= 0;
      // 来点松果解除「每场一次」：还能用，但下面的选法会把它压到最低的二次使用概率
      /* 「来点松果」(17) 是每场一次（att.usedSkills 已经在 skillWeight 里压到最低档，
       * 这里再显式排除）；**同一回合内**任何技能都不能再次出手 —— 否则 17 自带 actAgain，
       * 会在同一回合连着触发 （需求 3 点名的「不允许同一回合内多次触发」）。 */
      /* 可用技能从「这个 fighter 实际拥有的技能」里筛（att.skillOrder），
       * 而不是原版玩家那份硬编码的 ACTIVE_SKILLS 表 ——
       * 松鼠/题面用的技能横跨 2~23（元素术鼠是 5/17/20），
       * 用玩家表去筛会把 5 和 20 直接漏掉，于是它一辈子只能放 17（来点松果）。
       * 排除规则：小宇宙爆发每场一次、来点松果每场一次且满血不放、本回合已用过的不能再用。 */
      const actives = (att.skillOrder || ACTIVE_SKILLS).filter((id) => att.skills[id] &&
        !(id === 14 && att.usedCosmos) && !(id === 17 && att.usedSnack) && !(id === 17 && att.hp >= att.maxHp) &&
        !att.turnSkills[id]);
      const canSkill = actives.length > 0 && att.silence <= 0;
      let kind;
      if (att.pattern) {
        // 挑战塔的松鼠对手：按固定循环出招（玩家可以背板）。
        // 这一步用不了就顺延到下一个能用的，不会因为缴械/沉默而卡住。
        const want = att.pattern[att.patternStep % att.pattern.length];
        att.patternStep++;
        if (want === 'weapon' && !canWeapon) kind = canSkill ? 'skill' : 'common';
        else if (want === 'skill' && !canSkill) kind = canWeapon ? 'weapon' : 'common';
        else kind = (want === 'weapon' || want === 'skill') ? want : 'common';
      } else {
        kind = pickKind(canWeapon, canSkill, allToolsUsed(att, actives), false);
      }
      if (att.pendingWeapon && canWeapon) kind = 'weapon';

      if (kind === 'weapon') {
        const prepared = att.pendingWeapon;
        // 选武器：本场没用过的优先（并非一定），只有 repeatWeapon% 才回头用旧的那把。
        let w;
        if (prepared) w = prepared;
        else if (att.weapons.length > 1 && !att.pattern) w = pickWeapon(att);
        else w = att.weapons[0];
        att.usedWeapons[w.id] = true;
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
        if (w.id === 11) cc += weaponEffect(w, 20, 2, 3) + trueW(w, 'crit');   // 激光剑（真级 +3% 暴击）
        if (chance(cc)) { raw = Math.round(raw * (2 + effect(att, w.type === '投掷' ? 3 : 2) / 100 + critDmgBonus(att))); r.crit = true; }
        // 连击/三扔
        let hits = 1;
        if (w.id === 4 && chance(weaponEffect(w, 10, 2, 5) + trueW(w, 'combo'))) hits = 2;   // 西瓜刀（真级 +5% 连击）
        if (w.id === 10 && chance(weaponEffect(w, 2, 2, 3) + trueW(w, 'triple'))) hits = 3;   // 流星锤（真级 +3% 三扔）
        r.hits = hits;
        let total = 0;
        for (let i = 0; i < hits; i++) {
          const rr = { dmg: 0 };
          applyDamage(att, def, raw, rr, { ignoreFakeDie: w.id === 7, action: 'weapon', weaponType: w.type });
          total += rr.dmg;
          if (rr.reboundHurt) { r.reboundHurt = (r.reboundHurt || 0) + rr.reboundHurt; r.jueDui = true; }
          if (rr.thornsDmg) r.thornsDmg = (r.thornsDmg || 0) + rr.thornsDmg;
          if (rr.shellAbsorb) r.shellAbsorb = (r.shellAbsorb || 0) + rr.shellAbsorb;
          if (rr.lifesteal) r.lifesteal = (r.lifesteal || 0) + rr.lifesteal;
          if (rr.guiJia) r.guiJia = rr.guiJia;
          if (rr.fakeDie) r.fakeDie = true;
          if (rr.deathSave) { r.deathSave = true; r.noteText = rr.noteText; r.noteSide = rr.noteSide; }
          if (rr.fakeDie || def.hp <= 0 || att.hp <= 0) break;
        }
        r.dmg = total;
        // 武器特效
        if (w.id === 3 && att.hp > 0) { att.swordDodge = Math.max(att.swordDodge, weaponEffect(w, 3, 3)); r.dodgeBuff = att.swordDodge; }
        if (def.hp > 0 && !r.fakeDie) {
          if (w.id === 5) { def.debuffs.agility = Math.max(def.debuffs.agility, weaponEffect(w, 10, 2)); r.debuffText = '敏捷降低！'; }
          if (w.id === 6) { def.debuffs.speed = Math.max(def.debuffs.speed, weaponEffect(w, 10, 2)); r.debuffText = '速度降低！'; }
          if (w.id === 8) { def.debuffs.power = Math.max(def.debuffs.power, weaponEffect(w, 10, 1)); r.debuffText = '力量降低！'; }
          if (w.id === 12 && chance(35)) { def.dot = { dmg: weaponEffect(w, 4, 3, 6) + trueW(w, 'dot'), rounds: 4 }; r.dotApplied = true; }
          if (w.id === 13 && chance(weaponEffect(w, 10, 3, 3) + trueW(w, 'stun'))) { def.stun = Math.max(def.stun, 1); r.stunApplied = true; }
          if (w.id === 16 && chance(weaponEffect(w, 10, 4, 4) + trueW(w, 'silence'))) { def.silence = Math.max(def.silence, 4); r.silenceApplied = true; }
        }
        if (w.id === 14 && att.hp > 0) { const heal = Math.min(att.maxHp - att.hp, healOf(att, total * (weaponEffect(w, 10, 4, 2) + trueW(w, 'lifesteal')) / 100)); att.hp += heal; r.lifesteal = (r.lifesteal || 0) + heal; }
        if (w.id === 17 && att.hp > 0) { const self = Math.round(att.hp * 0.1); att.hp -= self; r.selfBurn = self; tryDeathSave(att, r); }
        // 反击（大榔头2、死神镰刀15 不可反击）
        maybeCounter(att, def, r, w.type === '近战' && ![2, 15].includes(w.id));
        pushRound(r);
        return;
      }

      if (kind === 'skill') {
        const sid = att.pattern
          ? nextPatternSkill(att, actives)                              // 固定循环：按技能表的轮转顺序出
          : pickSkill(att, actives);
        att.usedSkills[sid] = true;
        att.turnSkills[sid] = true;
        att.lastSkillId = sid;
        const lv = att.skills[sid];
        r.action = 'skill'; r.id = sid; r.level = lv;
        // 塔 buff「疾风先手」：本局首次技能不消耗回合
        const freeSkill = att.mods && att.mods.firstSkillFree && !att.usedFreeSkill;
        switch (sid) {
          case 8: { // 色诱之术（真级：有机会脱光对手装备，持续 4 回合）
            const raw = Math.round((R(15, 25) + 7 * (lv - 1)) * (1 + effect(att, 33) / 100));
            if (chance(dodgeChance(att, def))) { att.mustHitNext = false; r.dodge = true; break; }
            applyDamage(att, def, raw, r, {});
            if (def.hp > 0 && !r.fakeDie) {
              def.stun = Math.max(def.stun, 1); r.stunApplied = true;
              const stripPct = trueVal(8, lv) * 100;
              if (stripPct > 0 && chance(stripPct)) { def.stripTurns = 4; r.stripApplied = Math.round(stripPct); }
            }
            break;
          }
          case 12: { // 野球拳（真级：有几率再打一次）
            const raw = Math.round((effPower(att) + effSpeed(att)) * (1.2 + 0.15 * (lv - 1)));
            if (chance(dodgeChance(att, def) * 0.7)) { att.mustHitNext = false; r.dodge = true; break; }
            applyDamage(att, def, raw, r, {});
            const doublePct = trueVal(12, lv) * 100;
            if (doublePct > 0 && def.hp > 0 && att.hp > 0 && chance(doublePct)) { r.actAgain = true; r.doubleHit = true; }
            break;
          }
          case 14: { // 小宇宙爆发
            att.usedCosmos = true;
            for (const [key, id] of [['power', 36], ['agility', 37], ['speed', 38]]) {
              att.buffFlat[key] = Math.max(1, att.baseStats[key] * Math.max(lv / 100, trueVal(14, lv))) + effect(att, id);
            }
            r.buffUp = true; r.noDmg = true; r.actAgain = true;
            r.statBonus = { ...att.buffFlat };
            break;
          }
          case 15: { // 通灵召唤
            const raw = Math.round(def.hp * (35 + 2 * (lv - 1)) / 100) + 7 + effect(att, 39) + trueVal(15, lv);
            if (chance(dodgeChance(att, def))) { att.mustHitNext = false; r.dodge = true; break; }
            applyDamage(att, def, raw, r, { ignoreFakeDie: false });
            break;
          }
          case 17: { // 来点松果：每场战斗限用一次
            att.usedSnack = true;
            const heal = Math.min(att.maxHp - att.hp, healOf(att, (20 + 2 * (lv - 1)) * Math.max(1, effect(att, 40))));
            att.hp += heal;
            r.healSelf = heal; r.noDmg = true; r.actAgain = true;
            break;
          }
          case 18: { // 吸铁大法
            const raw = Math.round((R(5, 20) + 4 * (lv - 1)) * (1 + effect(att, 41) / 100));
            if (chance(dodgeChance(att, def))) { att.mustHitNext = false; r.dodge = true; break; }
            applyDamage(att, def, raw, r, { ignoreFakeDie: true });
            if (chance(Math.max(10 + 4 * (lv - 1), trueVal(18, lv) * 100))) { def.disarm = Math.max(def.disarm, 4); r.disarmApplied = true; }
            break;
          }
          case 23: { // 幸运一击
            const mult = R(1, 6);
            const raw = Math.max(15 + 8 * (lv - 1), trueVal(23, lv)) * mult;
            r.multiple = mult;
            applyDamage(att, def, raw, r, {});
            break;
          }
        }
        if (freeSkill) { att.usedFreeSkill = true; r.actAgain = true; }
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
      if (chance(critChance(att))) { raw = Math.round(raw * (2 + effect(att, 1) / 100 + critDmgBonus(att))); r.crit = true; }
      applyDamage(att, def, raw, r, {});
      maybeCounter(att, def, r, true);
      pushRound(r);
    }

    function tickRestrictions(actor) {
      if (actor.silence > 0) actor.silence--;
      if (actor.disarm > 0) actor.disarm--;
      if (actor.stripTurns > 0) actor.stripTurns--;   // 真·色诱之术：脱光装备的剩余回合
    }

    // 塔 buff「先手制敌」：开局对敌人造成其最大生命比例的伤害（不致死）
    if (A.mods && A.mods.openStrikePct && B.hp > 1) {
      const dmg = Math.max(1, Math.round(B.maxHp * Number(A.mods.openStrikePct)));
      B.hp = Math.max(1, B.hp - dmg);
      pushRound({ attacker: 0, action: 'dot', dmg, noteText: '先手制敌' });
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
      /* 需求 3：回合边界。同一个 actor 因 actAgain 追加的行动属于**同一回合**，
       * 所以这里的 turnId 只跟着主循环的「换人」推进，供「同回合只能用一次」判定。 */
      actor.turnId = Number(actor.turnId || 0) + 1;
      actor.acts = Number(actor.acts || 0) + 1;      // 出手次数（塔 buff「开局狂热」按它分档）
      actor.turnSkills = {};
      const def = actor === A ? B : A;
      // 回合开始回复（药师「百草回春」/ 塔 buff「活血丹」「回春术」）
      const regenPct = (actor.mech.includes('regen') ? 0.03 : 0) + (actor.mods && Number(actor.mods.regenPct) || 0);
      /* 塔 buff「浴血重生」：低血时每回合回血，但**最多回到 lowHpRegenAt 这条线**
       *（把血线顶回阈值就停，不会靠回血脱出低血区）。 */
      const lrPct = (actor.mods && Number(actor.mods.lowHpRegenPct) || 0);
      if (lrPct > 0 && actor.hp > 0) {
        const gate = Number(actor.mods.lowHpRegenAt) || 0.5;
        if (actor.hp <= actor.maxHp * gate) {
          const ceil = Math.max(1, Math.round(actor.maxHp * gate));
          const room = Math.max(0, Math.min(actor.maxHp, ceil) - actor.hp);
          if (room > 0) {
            const heal = Math.min(room, healOf(actor, Math.max(1, Math.round(actor.maxHp * lrPct))));
            if (heal > 0) {
              actor.hp = Math.min(actor.maxHp, actor.hp + heal);
              pushRound({ attacker: actor.side, action: 'regen', heal: heal, lowHpRegen: true,
                noteText: '浴血重生', noteSide: actor.side });
              if (B.hp <= 0 || A.hp <= 0) break;
            }
          }
        }
      }
      if (regenPct > 0 && actor.hp > 0 && actor.hp < actor.maxHp) {
        const heal = Math.min(actor.maxHp - actor.hp, healOf(actor, Math.max(1, Math.round(actor.maxHp * regenPct))));
        actor.hp += heal;
        pushRound({ attacker: actor.side, action: 'regen', heal, noteText: actor.mech.includes('regen') ? '百草回春' : '回复' });
        if (B.hp <= 0 || A.hp <= 0) break;
      }
      // 持续伤害
      // 原攻略按中招者的四次出手计数，包括小宇宙后的追加行动。
      if (actor.dot) {
        const dotDmg = actor.dot.pct ? Math.max(1, Math.round(actor.hp * actor.dot.pct)) : actor.dot.dmg;
        actor.hp -= dotDmg;
        const dotRound = { attacker: actor.side, action: 'dot', dmg: dotDmg, selfDot: true };
        tryDeathSave(actor, dotRound);            // 中毒致死也要过复活甲
        pushRound(dotRound);
        actor.dot.rounds--;
        if (actor.dot.rounds <= 0) actor.dot = null;
        if (actor.hp <= 0) break;
      }
      if (actor.restNext) { actor.restNext = false; pushRound({ attacker: actor.side, action: 'rest' }); if (!followup) tickRestrictions(actor); continue; }
      if (actor.stun > 0) { actor.stun--; pushRound({ attacker: actor.side, action: 'stunned' }); if (!followup) tickRestrictions(actor); continue; }

      if (actor.npcType) { npcAction(actor, def); npcMechAfter(actor, def); }
      else {
        // 挑战塔的题面对手也是「玩家式」AI（无 npcType），机制要在这里补挂：
        // 出手前先数它这一次行动，再走玩家式出招。玩家的 mech 为空数组，不受影响。
        if (actor.mech.length) { actor.npcActs = (actor.npcActs || 0) + 1; npcMechTurnStart(actor, def); }
        playerLikeAction(actor, def);
        if (actor.mech.length) npcMechAfter(actor, def);
        // 题面·蚀骨：玩家每次出手后叠 1 层「攻击 −3%」（层数记在对手身上，debuff 落在出手方身上）
        if (def.mech.includes('trialErode') && actor.hp > 0) {
          const stacks = Math.min(10, def.mechState.erode + 1);
          if (stacks > def.mechState.erode) {
            def.mechState.erode = stacks;
            actor.buffFlat.power -= Math.max(1, Math.round(actor.mechState.basePower * 0.03));
          }
        }
      }
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

    return { rounds, winner, maxHp: [A.maxHp, B.maxHp], startShell: startShell, names: [A.name, B.name] };
  }

  window.Sim = {
    simulate, rules: RULES,
    // 供 tools/test-combat-rules.cjs 直接校验出手权重（不用统计近似）
    actionWeights: { skill: skillWeight, weapon: weaponWeight },
    // 各技能「二次及以后」的出手概率（%），供测试与调参直接读
    repeatRateOf,
  };
})();
