/* ============================================================
 * sim.js — 战斗模拟器
 * 输出回合事件流（供 battle.js 播放）。武器/技能效果按原版
 * GameDict 描述与百科资料实现。
 *
 * 挑战塔扩展（tower.js 注入，普通战斗不带这些字段，行为与旧版一致）：
 *   fighter.mech: NPC 专属机制 id 数组（berserk/rhythmCrit/regen/thorns/
 *                 poison/freeze/wolf/lifesteal/shell/devour）
 *                 题面（最终位对手，玩家式 AI 也生效）：
 *                 trialCore（每过一回合 +10% 减伤、第 8 回合起封顶 70%；第 7 次行动起力敏速 +50%）
 *                 trialMoss（每回合回 6% 最大生命，配 thorns 反弹 15%）
 *                 trialDry（封死玩家治疗，每 3 次行动吸取玩家 10% 当前生命）
 *                 trialFrost（第 1/4/7… 次行动冻结玩家）
 *                 trialMirror（单次伤害 ≥20% 最大生命时反弹 45%）
 *                 trialBloodfang（每掉 20% 生命，攻击 +35%）
 *                 trialErode（玩家每次出手叠 1 层攻击 −3%，最多 RULES.erodeMax 层）
 *   fighter.mods: 玩家侧塔 buff 数值包 {dmgMul, critBonus, critDmgBonus,
 *                 dodgeBonus, dodgeMul, takenMul, regenPct, lifestealPct, shellPct,
 *                 openerPowerMul/openerRounds/fatiguePowerMul,
 *                 mustHitFirst, firstSkillFree, openStrikePct,
 *                 cosmosFirst（秘技通神抽中小宇宙爆发：第一招必定放它）,
 *                 roundStatPct, catchUpPct, roundMaxHpMul, firstDodge,
 *                 emptyMaxHpMul, lowHpTakenMul, lowHpLifestealPct, lowHpRegenPct/lowHpRegenAt,
 *                 lowHpPowerMul/lowHpAgilityMul/lowHpSpeedMul/lowHpAt}
 * ============================================================ */

/* ------------------------------------------------------------
 * 目录：战斗模拟器（回合事件流）
 * Ctrl+F 搜节号（如「【SM1】」）直达对应代码块。
 *
 *  【SM1】随机小件与规则表 RULES  【SM2】参战者构建  【SM3】状态修正与属性工具
 *  【SM4】出手权重与武器/技能选取  【SM5】闪避 / 暴击 / 被动加成  【SM6】减伤链
 *  【SM7】主模拟循环 simulate  【SM8】导出 window.Sim
 * ------------------------------------------------------------ */
(function () {
  'use strict';

  /* ============================================================
   * 【SM1】随机小件与规则表 RULES
   * ============================================================ */
  function R(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function chance(pct) { return Math.random() * 100 < pct; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // The client receives server-generated battles; no original trigger threshold
  // survives in its dictionary. Keep these reconstruction choices explicit.
  const RULES = Object.freeze({
    // 师父驾到：生命不高于 50% 时开始尝试救场（原 35%），每场至多一次
    masterHpRatio: 0.50, masterChance: 35,
    /* 出手时的「二次使用」权重（%）。做法是两层池子：本场没用过的武器/技能优先，
     * 只有这个权重才回头用旧的那把/那个，所以「用过的」实际出场率被明显压低。
     * 2026-10 用户口径，简化为三档（不再按技能逐个分档）：
     *   · 武器：用过之后一律 repeatWeapon（30）；
     *   · 来点松果（17）/ 野球拳（12）：第 1 次用过后 repeatSpecialFirst（15），
     *     第 2 次及以后 repeatSpecialAgain（5，到底不再下降）；
     *   · 其余技能：用过之后一律 repeatSkill（20）。
     * 「刚用过的那一个再 ×LAST_PENALTY(0.3)」对以上三档都生效。 */
    repeatWeapon: 30,
    repeatSkill: 20,
    repeatSpecialFirst: 15, repeatSpecialAgain: 5,
    /* 徒手攻击的基准权重：与武器/技能的候选权重放进同一个池子竞争（不再是固定百分比）。
     *   · 持有的武器/技能越多 → 工具权重总和越大 → 徒手占比越低；
     *   · 全部用过一遍之后工具权重整体掉到 5~30 → 徒手占比自动抬高；
     *   · 只有一个主动技、且已经用过时，它的权重降到二次使用概率，
     *     不会再出现「类型抽中技能 → 只能放它」的强制复用。
     * 30 ≈ 「1 武器 + 1 技能（各 100 权重）」时徒手约 13%，与旧的固定 12% 接近。 */
    commonAttackWeight: 30,
    /* 三侠等纯 NPC 分支（没有武器池）的固定档位：30% 技能 / 70% 普攻。 */
    npcSkillChance: 30,
    jueDuiChance: 22, jueDuiAgain: 13,
    jueDuiDecay: 0.7, jueDuiMin: 2,
    shellFirst: 35, shellAgain: 20,
    xhSpeedShare: 0.35,
    skillCooldown: 2,
    /* 题面·熔核·炽壳：**每过一回合**叠一层减伤（+10%/层），第 8 回合起封顶 70%。
     * 层数上限 = 0.70 / 0.10 = 7（coreReduceOf 与 mechDesc 共用同一份数字）。 */
    coreReducePerRound: 0.10, coreReduceCap: 0.70,
    /* 题面·蚀骨：玩家每次出手叠 1 层「攻击 −3%」，这个上限同时被代码与 NPC 文案使用 ——
     * 抽成常量，免得一边改、另一边忘（此前 10 层写在两处）。 */
    erodeMax: 15,
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
  /* ============================================================
   * 【SM2】参战者构建（含塔机制注入字段）
   * ============================================================ */
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
      weapons, skills, usedWeapons: {}, usedSkills: {}, /* 每个技能「本场用过几次」——野球拳（12）的快速衰减要用它。 */
      skillUseCount: {}, lastWeaponId: null, lastSkillId: null,
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
      /* 技能冷却（id → 还要等几次出手；见 RULES.skillCooldown）。 */
      skillCd: {},
      effects: f.effects || {}, masterLevel: Math.max(0, Number(f.masterLevel) || 0),
      // 攻略.md 的裸属性解释与 PPT 的含装备解释冲突。本版采用前者，
      // callers provide growth stats excluding equipment, skills and pills.
      // Older fighter snapshots lack this field, so retain their recorded stats.
      baseStats: Object.fromEntries(['power', 'agility', 'speed'].map((key) => [key, stat(f.baseStats?.[key], stat(f[key], 1))])),
      // 战斗内状态
      ap: 0, restNext: false, pendingWeapon: null, stun: 0, silence: 0, disarm: 0, shellCharges: 0,
      mustHitNext: !!(mods && mods.mustHitFirst), stripTurns: 0, usedFakeDie: false, usedMaster: false, usedShell: false, usedCosmos: false, usedSnack: false, jueDuiCount: 0,
      // 题面·枯泉：治疗量倍率（0 = 完全封疗）
      /* 治疗量倍率（塔侧赛前写入：涌泉烙印 C52 按层给 +10%/层，损毁层 +20%）。
       * 战斗中被「枯泉」这类机制清零 = 完全封疗。所有治疗都走 healOf()，所以只要这里读进来就全生效。 */
      healMul: Number.isFinite(Number(f.healMul)) && Number(f.healMul) >= 0 ? Number(f.healMul) : 1,
      /* 秘技通神（C33）的「该技能触发概率 +N%」专用通道：{ 技能id: 比例 }。
       * 与 effects 分开，避免和装备词条/武器效果槽的编号撞车。 */
      skillBoost: f.skillBoost && typeof f.skillBoost === 'object' ? Object.assign({}, f.skillBoost) : {},
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
      mechState: { basePower: stat(f.power, 1), berserk: false, core: false, coreStack: 0, bfStep: 0, erode: 0 },
      shell: Math.round(fullHp * ((mech.includes('shell') ? 0.30 : 0) + (mods && mods.shellPct || 0))),
      pendingNote: null,
    };
  }

  /** 任何扣血途径致死时的兜底：涅槃（复活 + 本场力/敏/速提升）/ 金蝉脱壳（保留 1 血）/ 无敌模式。
   *  原来只有 applyDamage 里判，中毒、荆棘反弹、双刃剑自伤、枯泉吸血把人打死时
   *  复活甲不会触发 —— 玩家会以为「buff 没生效」。 */
  /** 塔 buff「反噬豁免」：免疫**一切**反伤（荆棘铁壁 / 荆棘之甲 / 镜鳞反噬 / 绝对防御反伤）。
   *  判据放在被反伤的那一方（att）身上 —— 也就是「我方出手时不会被弹」。 */
  /* ============================================================
   * 【SM3】状态修正与属性工具
   * ============================================================ */
  /* 「闪亮登场」强化期内的那几次武器也免疫反伤 —— 用一次性标记挂在出手方身上，
   * 由武器分支在出手前设置（见 weaponBoostReflectImmune）。 */
  function reflectImmune(c) {
    if (!c) return false;
    if (c.weaponBoostImmune) return true;
    return !!(c.mods && Number(c.mods.reflectImmune) > 0);
  }
  function tryDeathSave(def, r) {
    if (!def || def.hp > 0) return false;
    if (def.mods && Array.isArray(def.mods.deathSaves) && def.mods.deathSaves.length) {
      const sv = def.mods.deathSaves.shift();
      def.hp = sv.healPct ? Math.max(1, Math.round(def.maxHp * sv.healPct)) : 1;
      /* 涅槃（原不死鸟）：复活后**本场战斗**力/敏/速提升 —— 直接加到 buffFlat 上，
       * 与「血性狂暴」等临时加成同一口径（每场战斗的 combatant 是新建的，所以只影响本场）。 */
      const mul = Math.max(0, Number(sv.statMul) || 0);
      if (mul > 0) {
        for (const key of ['power', 'agility', 'speed']) {
          def.buffFlat[key] = (def.buffFlat[key] || 0) + Math.max(1, Math.round((Number(def[key]) || 0) * mul));
        }
      }
      if (r) {
        r.deathSave = true;
        r.reviveStatMul = mul > 0 ? mul : undefined;
        /* 涅槃（复活甲）与金蝉脱壳都是 deathSave，但塔里需要分开数「涅槃用掉几次」
         *（C14 叠 2 层时每层有 2 次机会）—— 所以复活甲那一条打上显式标记。 */
        r.revive = sv.revive ? 1 : undefined;
        r.noteText = (r.noteText ? r.noteText + '·' : '') + (sv.name || (sv.healPct ? '涅槃' : '金蝉脱壳'));
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
      /* 塔 buff「闪亮登场」：前 N 次**使用武器**时攻击 +50%（那几次单独在武器分支里加成），
       * 次数用完之后我方所有攻击 −20%。判据是本场已用武器次数，不是出手次数。 */
      const wFatigue = Number(c.mods.weaponBoostFatigueMul) || 0;
      const wCap = Number(c.mods.weaponBoostUses) || 0;
      if (wFatigue > 0 && wCap > 0 && (Number(c.weaponUses) || 0) > wCap) p *= 1 - wFatigue;
    }
    return Math.max(1, Math.round(p));
  }
  /** 低血门槛是否成立（塔 buff「狂怒」共用一套判定：攻/敏/速同时生效）。 */
  function lowHpActive(c) {
    const th = c.mods && Number(c.mods.lowHpAt);
    return !!(th > 0 && c.maxHp > 0 && c.hp <= c.maxHp * th);
  }
  /* ============================================================
   * 回合开始类增益（塔 buff，每场战斗重置）
   *
   *   roundStatPct   越战越勇：力/敏/速各按「基础值 × 比例」逐回合累加（可叠层，比例里已含层数）
   *   catchUpPct     后发制人：有一项落后对手时，把差距最大的那项补上「差距 × 比例」
   *   roundMaxHpMul  玉石俱焚：双方生命上限各乘一次（向下取整），当前血量跟着裁
   *
   * 三者都写在 **buffFlat / maxHp** 上，而每个战斗体是 simulate() 里新建的
   *（makeCombatant 每次都重置 buffFlat），所以「每场战斗结束时加成消失」天然成立。
   * ============================================================ */
  function applyRoundAuras(actor, foe, push) {
    const m = actor.mods || {};
    const statPct = Number(m.roundStatPct) || 0;
    if (statPct > 0) {
      for (const key of ['power', 'agility', 'speed']) {
        const base = Number(statOf(actor, key)) || 0;
        actor.buffFlat[key] = (actor.buffFlat[key] || 0) + Math.max(1, Math.round(base * statPct));
      }
      if (push) push({ attacker: actor.side, action: 'buff', noteText: '越战越勇', noteSide: actor.side });
    }
    const catchPct = Number(m.catchUpPct) || 0;
    if (catchPct > 0 && foe && foe.hp > 0) {
      const eff = { power: effPower, agility: effAgility, speed: effSpeed };
      let best = null;
      for (const key of ['power', 'agility', 'speed']) {
        const gap = eff[key](foe) - eff[key](actor);
        if (gap > 0 && (!best || gap > best.gap)) best = { key: key, gap: gap };
      }
      if (best) {
        actor.buffFlat[best.key] = (actor.buffFlat[best.key] || 0) + Math.max(1, Math.round(best.gap * catchPct));
        if (push) push({ attacker: actor.side, action: 'buff', noteText: '后发制人', noteSide: actor.side });
      }
    }
    const hpMul = Number(m.roundMaxHpMul) || 0;
    if (hpMul > 0 && hpMul < 1) {
      for (const c of [actor, foe]) {
        if (!c || c.hp <= 0) continue;
        c.maxHp = Math.max(1, Math.floor(c.maxHp * hpMul));
        if (c.hp > c.maxHp) c.hp = c.maxHp;
      }
      /* 把两边的新上限/当前血量一起写进这一回合：战斗回放要据此更新血条，
       * 否则玩家在战斗里只看得到飘字、看不到「血量上限变化」。 */
      const bySide = (pick) => (actor.side === 0 ? [pick(actor), pick(foe)] : [pick(foe), pick(actor)]);
      if (push) push({ attacker: actor.side, action: 'buff', noteText: '玉石俱焚', noteSide: actor.side,
        maxHp: bySide((c) => c.maxHp), hp: bySide((c) => c.hp) });
    }
  }
  /**
   * **低血减伤的即时结算**：把一次伤害按「越过 lowHpAt 阈值线」切成两段。
   *
   *   · 把血量打到阈值线为止的那一段（阈值以上）→ 全额；
   *   · 越过阈值线之后的那一段 → 乘 (1 + mul)（mul 为负，例如 −0.5 = 减伤 50%）。
   *
   * 已经低于阈值时（整段都在阈下）退化成「全额减伤」，与旧行为一致；
   * 这一击打不到阈值线时整段全额（原来也是这样）。多次伤害/多段武器逐段结算，
   * 因为调用方每段都会传入「当前血量」，第二段自然就整段吃减伤了。
   */
  function lowHpTakenDamage(def, dmg, mul) {
    const d = Math.max(0, Number(dmg) || 0);
    const cut = Math.max(0, 1 + (Number(mul) || 0));            // 减伤后的倍率（0~1）
    const th = Number(def.mods && def.mods.lowHpAt) || 0;
    const maxHp = Math.max(0, Number(def.maxHp) || 0);
    const hp = Math.max(0, Number(def.hp) || 0);
    if (!(th > 0) || !(maxHp > 0)) return Math.round(d * cut);  // 没阈值：整段减伤（旧口径）
    /* 注意：这里**不做 cut<=0 的提前返回** —— 减伤 100% 时也应该先把阈值以上那一段打完
     *（否则「一击直接归零」，与分段口径矛盾）。cut 最小 0，越线那一段乘 0 即为 0。 */
    const line = maxHp * th;                                    // 阈值线（绝对血量）
    const above = Math.max(0, hp - line);                       // 打到线之前的那一段
    if (d <= above) return d;                                   // 这一击打不到线 → 全额
    const below = d - above;                                    // 越过线的那一段
    return Math.round(above + below * cut);
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
  /* ============================================================
   * 【SM4】出手权重与武器/技能选取
   * ============================================================ */
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
   *   - 已经用过   → 它的「二次使用权重」（见下面的三档口径）；
   *   - 上一回合刚用过的那一个再乘 LAST_PENALTY，避免连着重复同一把/同一个。
   */
  /** 某个技能「已经用过 count 次之后，下一次再放」的权重（%）。2026-10 三档口径：
   *   · 来点松果（17）/ 野球拳（12）：第 1 次用过后 15，第 2 次及以后 5（到底，不再下降）；
   *   · 其余技能：一律 20。
   *  count = 本场**已经用过**的次数（0 表示还没用过 —— 那时调用方直接用 UNUSED_WEIGHT，不走这里）。
   *  绝对防御是另一套（jueDuiChanceOf：22/13/9/6/4/3/2 的 ×0.7 慢衰减），不进出手池。 */
  function repeatRateOf(id, count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (id !== 12 && id !== 17) return RULES.repeatSkill;
    return n <= 1 ? RULES.repeatSpecialFirst : RULES.repeatSpecialAgain;
  }
  /** 某个技能本场已经用过几次（玩家与敌人都记在各自的 skillUseCount 上）。 */
  function skillUseCountOf(att, id) {
    if (!att || !att.skillUseCount) return 0;
    return Math.max(0, Math.floor(Number(att.skillUseCount[id]) || 0));
  }
  function skillWeight(att, id) {
    let w = att.usedSkills[id] ? repeatRateOf(id, skillUseCountOf(att, id)) : UNUSED_WEIGHT;
    if (att.lastSkillId === id) w *= LAST_PENALTY;
    /* 秘技通神（C33）：该技能的触发概率 ×(1+加成)。走独立的 skillBoost 通道，
     * 不再借用 effects（那是装备词条/武器效果槽的编号空间，会造成串味）。 */
    const boost = Number(att.skillBoost && att.skillBoost[id]) || 0;
    if (boost > 0) w *= 1 + boost;
    return w;
  }
  function weaponWeight(att, id) {
    let w = att.usedWeapons[id] ? RULES.repeatWeapon : UNUSED_WEIGHT;
    if (att.lastWeaponId === id) w *= LAST_PENALTY;
    return w;
  }

  /** 技能选择：按 skillWeight 加权 → 没用过的优先、二次使用被压掉、来点松果最低。 */
  /* ---------- 出手类型：武器 / 技能 / 徒手（权重竞争，不再是固定百分比） ----------
   * 把两边的**实际候选权重**加总，再和「徒手」权重一起抽一次：
   *   · 候选越多 → 工具总权重越大 → 徒手越少（持有的武技数量直接决定普攻欲望）；
   *   · 全部用过一遍 → 每个候选的权重掉到二次使用概率（5~25）→ 徒手占比自然抬高；
   *   · 只剩一个主动技时，它用过之后的份额就是它的二次使用概率，
   *     不会因为「类型落在技能上」而被强行复用（修掉旧固定档位的那个副作用）。
   * 抽签仍然只消耗一次 Math.random()，所以既有的随机序列长度不变。 */
  function pickKind(att, weapons, actives) {
    let weaponSum = 0;
    for (const w of weapons || []) weaponSum += weaponWeight(att, w.id);
    let skillSum = 0;
    for (const id of actives || []) skillSum += skillWeight(att, id);
    const total = weaponSum + skillSum + RULES.commonAttackWeight;
    const roll = Math.random() * total;
    if (roll < weaponSum) return 'weapon';
    if (roll < weaponSum + skillSum) return 'skill';
    return 'common';
  }
  /** 纯 NPC（三侠）没有武器池，沿用固定档位 30% 技能 / 70% 普攻。 */
  function pickNpcKind() {
    return Math.random() * 100 < RULES.npcSkillChance ? 'skill' : 'common';
  }

  /** 出手类型的三份权重（供测试/调参直接核对，不用统计近似）。 */
  function kindWeights(att, weapons, actives) {
    let weapon = 0;
    for (const w of weapons || []) weapon += weaponWeight(att, w.id);
    let skill = 0;
    for (const id of actives || []) skill += skillWeight(att, id);
    const common = RULES.commonAttackWeight;
    const total = weapon + skill + common;
    return { weapon, skill, common, total, weaponShare: weapon / total, skillShare: skill / total, commonShare: common / total };
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
  /** 野球拳（12）的闸门：**每个战斗单位都遵循**（玩家、固定循环的敌人、玩家式 AI 全都一样）。
   *  第一次照放；从第二次起，每一次「本回合能不能放它」都按 repeatRateOf(12, 已用次数) 掷一次：
   *  没抽中就把它排除在可用技能之外 —— 于是有别的技能就让位给别的，没有就改普攻。
   *  （技能权重那条曲线同时也在 skillWeight 里生效，多技能时它被选中的份额本来就低。） */
  function yakyuGated(att) {
    if (!att) return false;
    const used = skillUseCountOf(att, 12);
    if (used <= 0) return false;
    return !chance(repeatRateOf(12, used));
  }
  /** 武器选择：同一套口径。 */
  function pickWeapon(att) {
    return pickWeighted(att.weapons, (w) => weaponWeight(att, w.id));
  }

  /* ============================================================
   * 【SM5】闪避 / 暴击 / 被动加成
   * ============================================================ */
  function dodgeChance(att, def) {
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

  /**
   * 「被动技能触发提升」—— 秘技通神（C33）选中绝对防御 / 龟甲术之后写进
   * `skillBoost['技能ID']` 的加成值（例如 skillBoost['16'] = 1.5 表示 +150%）。
   *
   * **专用通道**：以前这里读的是 `effects['技能ID']`，但 effects 的键位同时属于
   * 装备词条与武器效果槽（例如 effects['7'] = 投掷武器伤害 +N%、effects['16'] = 死老鼠伤害 +N%），
   * 于是 C33 会顺带强化某把武器、装备词条也会顺带提升龟甲术触发率。现在只认 skillBoost。
   *
   * 绝对防御与龟甲术都是**受击自动触发**、不进出手池的技能，
   * 所以它们不吃 skillWeight 那套权重，必须在这里单独乘一次。
   * （C33 抽中小宇宙爆发不走这里 —— 它的收益是「第一招必放」，见 playerLikeAction
   *   里的 forceCosmos / mods.cosmosFirst。） */
  function passiveSkillBoost(f, id) {
    if (!f) return 0;
    const v = Number(f.skillBoost && f.skillBoost[id]);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  }
  const BOOSTED_AGAIN_CAP = 45;
  const BOOSTED_FIRST_CAP = 90;
  /** 题面·熔核·炽壳的减伤层数上限（= 封顶 / 每层）。 */
  function coreMaxStacks() {
    const per = Math.max(0.01, Number(RULES.coreReducePerRound) || 0.10);
    return Math.max(1, Math.round((Number(RULES.coreReduceCap) || 0.70) / per));
  }
  /** 熔核·炽壳的减伤比例：**每过一回合** +10%，第 8 回合起封顶 70%。
   *  count = 本场已经过完的回合数（0 → 一层都没有）。纯函数，供测试直接核对曲线。 */
  function coreReduceOf(count) {
    const per = Math.max(0, Number(RULES.coreReducePerRound) || 0);
    const cap = Math.max(0, Number(RULES.coreReduceCap) || 0);
    const n = Math.max(0, Math.min(coreMaxStacks(), Math.floor(Number(count) || 0)));
    return Math.round(Math.min(cap, n * per) * 100) / 100;
  }
  function jueDuiChanceOf(def, count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const base = n === 0
      ? RULES.jueDuiChance
      : Math.max(RULES.jueDuiMin, Math.round(RULES.jueDuiAgain * Math.pow(RULES.jueDuiDecay, n - 1)));
    const boost = passiveSkillBoost(def, 16);
    const out = base * (1 + boost);
    if (!boost) return out;                                  // 没加成：原样
    return Math.min(out, n === 0 ? BOOSTED_FIRST_CAP : BOOSTED_AGAIN_CAP);
  }
  /** 龟甲术的单次触发概率（%）：首次 / 二次及以后（二次还带装备与技能等级加成）。 */
  function shellChanceOf(def, again) {
    const base = again
      ? RULES.shellAgain + effect(def, 32) + trueVal(7, def.skills[7]) * 100
      : RULES.shellFirst;
    const boost = passiveSkillBoost(def, 7);
    const out = base * (1 + boost);
    if (!boost) return out;                                  // 没加成：原样
    return Math.min(out, again ? BOOSTED_AGAIN_CAP : BOOSTED_FIRST_CAP);
  }
  /* ============================================================
   * 【SM6】减伤链（护盾/绝对防御/减伤）
   * ============================================================ */
  function dmgReduce(def, dmg, opts) {
    opts = opts || {};
    let out = { dmg, guiJia: 0, jueDui: 0, rebound: 0 };
    const gearReduction = opts.action === 'weapon' ? effect(def, opts.weaponType === '投掷' ? 10 : 9) : opts.action === 'skill' ? effect(def, 11) : 0;
    out.dmg = Math.round(out.dmg * (1 - clamp(gearReduction, 0, 80) / 100));
    /* 绝对防御是受击自动触发、不进出手池的技能，所以「挡过几次」单独记：
     * 同一场里每挡一次，下一次的触发率就按 jueDuiChanceOf 的曲线往下降
     *（22 / 13 / 9 / 6 / 4 / 3 / 2 …；对敌我都生效）。
     * 旧的布尔 `usedJueDui` 已被这个计数取代（它只够区分「首次/之后」两档）。 */
    if (def.skills[16] && def.silence <= 0
        && chance(jueDuiChanceOf(def, def.jueDuiCount || 0))) {
      def.jueDuiCount = Math.max(0, Math.floor(Number(def.jueDuiCount) || 0)) + 1;
      const pct = 40 + 4 * (def.skills[16] - 1);
      out.jueDui = out.dmg; out.rebound = Math.round(out.dmg * pct / 100); out.dmg = 0;
      return out;
    }
    if (def.skills[7] && def.silence <= 0) {
      const canTrigger = def.shellCharges > 0
        || (!def.usedShell && chance(shellChanceOf(def, false)))
        || (def.usedShell && chance(shellChanceOf(def, true)));
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
    if (def.mods && Number(def.mods.lowHpTakenMul)) {
      out.dmg = lowHpTakenDamage(def, out.dmg, Number(def.mods.lowHpTakenMul));
    }
    if (def.mech.includes('trialCore')) {
      /* 题面·熔核·炽壳：**每过一回合**再叠一层减伤（10%/层，第 8 回合起封顶 70%）——
       * 以前是「第 7 次行动突然 −70%」，现在是逐回合变硬，前期就该开始提速。 */
      const dr = coreReduceOf(def.mechState.coreStack || 0);
      if (dr > 0) out.dmg = Math.round(out.dmg * (1 - dr));
    }
    out.dmg = Math.max(1, out.dmg);
    return out;
  }

  /** 主模拟：返回 {rounds, winner(0|1), maxHp:[a,b]} */
  /* ============================================================
   * 【SM7】主模拟循环 simulate
   * ============================================================ */
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
      /* 塔 buff「狂怒」：低血时的加成是**终乘** —— 在加成与减伤都算完之后，直接乘最终伤害，
       * 所以不会被其它乘区稀释（见 tower-data.js 的 C20 注释）。 */
      if (dmg > 0 && att.mods && Number(att.mods.lowHpFinalMul) > 0 && lowHpActive(att)) {
        dmg = Math.round(dmg * (1 + Number(att.mods.lowHpFinalMul)));
        r.rageFinalMul = Number(att.mods.lowHpFinalMul);
      }
      /* 塔 buff「风影身法」：每场战斗**第一次受到攻击时必定闪避**。
       * 放在这里与「先机预判」（首次伤害为 0）同一处：已经把命中判完、伤害算出来了，
       * 直接把它归零并打上闪避标记 —— 武器分支的常规闪避判定在更前面，所以那一次
       * 天然逃掉的不消耗这个「必定闪避」额度。 */
      if (dmg > 0 && def.mods && Number(def.mods.firstDodge) > 0 && !def.mods.firstDodgeUsed) {
        def.mods.firstDodgeUsed = true;
        dmg = 0;
        r.dodge = true;
        r.noteText = (r.noteText ? r.noteText + '·' : '') + '风影身法'; r.noteSide = def.side;
      }
      if (dmg > 0 && def.mods && def.mods.firstHitZero && !def.mods.firstHitZeroUsed) {
        def.mods.firstHitZeroUsed = true;
        dmg = 0;
        r.firstHitZero = true;
        r.noteText = (r.noteText ? r.noteText + '·' : '') + '先机预判'; r.noteSide = def.side;
        /* 先机预判（C38）：挡下这一击之后，**我方立刻额外行动一次且不消耗回合**。
         * 与「装死」同一条路径 —— 把 immediate 指给受击方，主循环下一轮直接让它出手，
         * 不经过行动条（所以是真·不消耗回合，而不是加速）。 */
        if (def.mods.firstHitZeroFreeTurn && def.hp > 0) {
          r.firstHitZeroFreeTurn = true;
          if (!immediate) immediate = { actor: def, reason: 'firstHitZero' };
        }
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
        /* 同 tryDeathSave：涅槃复活后本场力/敏/速提升。 */
        const mul2 = Math.max(0, Number(sv.statMul) || 0);
        if (mul2 > 0) {
          for (const key of ['power', 'agility', 'speed']) {
            def.buffFlat[key] = (def.buffFlat[key] || 0) + Math.max(1, Math.round((Number(def[key]) || 0) * mul2));
          }
        }
        r.deathSave = true;
        r.reviveStatMul = mul2 > 0 ? mul2 : undefined;
        r.revive = sv.revive ? 1 : undefined;      // 同 tryDeathSave：区分涅槃与金蝉脱壳
        r.noteText = sv.name || (sv.healPct ? '涅槃' : '金蝉脱壳'); r.noteSide = def.side;
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
        /* 反噬豁免：免疫反伤（包括绝对防御的反伤），但**不免疫**被挡住这件事本身。 */
        if (reflectImmune(att)) {
          r.reflectBlocked = (r.reflectBlocked || 0) + red.rebound;
          r.noteText = (r.noteText ? r.noteText + '·' : '') + '反噬豁免'; r.noteSide = att.side;
        } else {
          att.hp -= red.rebound;
          r.reboundHurt = red.rebound;
          tryDeathSave(att, r);
        }
      }
      // —— 受击/命中方机制（挑战塔 NPC 池） ——
      if (dmg > 0) {
        /* 反噬豁免：本场免疫一切反伤 —— 直接把三种反伤一起跳过。 */
        const noReflect = reflectImmune(att);
        if (def.mech.includes('thorns') && att.hp > 0 && !noReflect) {   // 荆棘铁壁：反弹 15%
          const reflect = Math.max(1, Math.round(dmg * 0.15));
          att.hp -= reflect;
          r.thornsDmg = (r.thornsDmg || 0) + reflect;
          tryDeathSave(att, r);
        }
        // 塔 buff「荆棘之甲」：玩家侧反伤（跨层类）
        const thornsPct = def.mods && Number(def.mods.thornsPct) || 0;
        if (thornsPct > 0 && att.hp > 0 && !noReflect) {
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
        if (def.mech.includes('trialMirror') && att.hp > 0 && !noReflect && dmg >= def.maxHp * threshold) {
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
        /* 只有力量全额 + 速度的 xhSpeedShare（见 RULES 注释：敌人速度约是力量的 2.3 倍，
         * 直接 (力量+速度) 等于白送一整条速度）。 */
        const raw = Math.round((effPower(att) + effSpeed(att) * RULES.xhSpeedShare) * 1.35);
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
      /* 熔核·炽壳：每过一回合叠一层减伤（+10%，第 8 回合起封顶 70%）；
       * 第 7 次行动起的「熔核成型」（力/敏/速 +50%）保留 —— 它是这只 boss 的爆发窗口另一半。 */
      if (att.mech.includes('trialCore')) {
        const stack = Math.min(coreMaxStacks(), Math.max(0, Math.floor(Number(att.mechState.coreStack) || 0)) + 1);
        if (stack !== att.mechState.coreStack) {
          att.mechState.coreStack = stack;
          att.pendingNote = (att.pendingNote ? att.pendingNote + '·' : '') +
            '熔核·减伤 ' + Math.round(coreReduceOf(stack) * 100) + '%';
        }
      }
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
      // NPC：70% 普攻，30% 技能（三侠没有武器池，走它自己的固定档位）
      const useSkill = Object.keys(att.skills).length > 0 && pickNpcKind() === 'skill';
      const r = { attacker: att.side, action: 'common', npcSkill: false };
      if (useSkill) {
        r.action = 'skill'; r.npcSkill = true;
        const sid = parseInt(Object.keys(att.skills)[0]);
        const lv = att.skills[sid];
        let raw;
        if (att.npcType === 'tl') { raw = Math.round(effPower(att) * (0.6 + Math.random() * 0.3)); r.multiHit = 2; } // 螳螂双击
        else if (att.npcType === 'xh') { raw = Math.round((effPower(att) + effSpeed(att) * RULES.xhSpeedShare) * (0.9 + lv * 0.1)); }
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
          if (rr.deathSave) {
            r.deathSave = true; r.noteText = rr.noteText; r.noteSide = rr.noteSide;
            /* 涅槃的属性加成标记也要一起带上来，否则界面上看不到「复活后变强」这条提示。 */
            if (rr.reviveStatMul) r.reviveStatMul = rr.reviveStatMul;
          }
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
      /* 可用技能从「这个 fighter 实际拥有的技能」里筛（att.skillOrder），
       * 而不是原版玩家那份硬编码的 ACTIVE_SKILLS 表 ——
       * 松鼠/题面用的技能横跨 2~23（元素术鼠是 5/17/20），
       * 用玩家表去筛会把 5 和 20 直接漏掉，于是它一辈子只能放 17（来点松果）。
       * 排除规则：小宇宙爆发每场一次、来点松果每场一次且满血不放、本回合已用过的不能再用。 */
      const actives = (att.skillOrder || ACTIVE_SKILLS).filter((id) => att.skills[id] &&
        !(id === 14 && att.usedCosmos) && !(id === 17 && att.usedSnack) && !(id === 17 && att.hp >= att.maxHp) &&
        !(Number(id) === 12 && yakyuGated(att)) &&                    // 野球拳：越用越难（第 3 次到底）
        !(att.pattern && att.skillCd && att.skillCd[id] > 0) &&        // 冷却中（只对固定循环的敌人生效）
        !att.turnSkills[id]);
      const canSkill = actives.length > 0 && att.silence <= 0;
      const forceCosmos = !!(att.mods && att.mods.cosmosFirst) && !att.usedCosmos && canSkill &&
        actives.some((id) => Number(id) === 14);
      let kind;
      if (forceCosmos) {
        kind = 'skill';
      } else if (att.pattern) {
        // 挑战塔的松鼠对手：按固定循环出招（玩家可以背板）。
        // 这一步用不了就顺延到下一个能用的，不会因为缴械/沉默而卡住。
        const want = att.pattern[att.patternStep % att.pattern.length];
        att.patternStep++;
        if (want === 'weapon' && !canWeapon) kind = canSkill ? 'skill' : 'common';
        else if (want === 'skill' && !canSkill) kind = canWeapon ? 'weapon' : 'common';
        else kind = (want === 'weapon' || want === 'skill') ? want : 'common';
      } else {
        kind = pickKind(att, canWeapon ? att.weapons : [], canSkill ? actives : []);
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
        /* 塔 buff 的两个「按武器次数」口径（本次算第几次用武器）：
         *   weaponFreeUses   —— 前 N 次使用武器不消耗回合（疾风先手 / 先发制人）
         *   weaponBoostUses  —— 前 N 次使用武器时攻击加成+必中+免疫反伤，之后攻击衰减（闪亮登场）
         * 「蓄力」那一回合不算使用（w.id===1 在上面已经 return）。 */
        att.weaponUses = (Number(att.weaponUses) || 0) + 1;
        const wUse = att.weaponUses;
        const freeCap = Number(att.mods && att.mods.weaponFreeUses) || 0;
        const boostCap = Number(att.mods && att.mods.weaponBoostUses) || 0;
        const boosted = boostCap > 0 && wUse <= boostCap;
        att.weaponBoostImmune = boosted && Number(att.mods && att.mods.weaponBoostReflectImmune) > 0;
        const grantFreeTurn = () => {
          if (freeCap <= 0 || wUse > freeCap) return;
          att.usedFreeWeapon = wUse;
          r.actAgain = true;
          r.noteText = (r.noteText ? r.noteText + '·' : '') + '不消耗回合';
          r.noteSide = att.side;
        };
        let raw = R(w.lo, w.hi);
        raw = Math.round(raw * (1 + effPower(att) / 120));       // 力量加成
        // 武器好手是额外固定伤害，不随被菜刀削弱的力量一起下降。
        if (skill(att, 5)) raw += (10 + 2 * (skill(att, 5) - 1)) * (1 + effect(att, 31) / 100);
        raw = Math.round(raw * (1 + (effect(att, w.type === '投掷' ? 7 : 6) + (w.id <= 15 ? effect(att, w.id + 11) : 0)) / 100));
        // 闪亮登场：强化期内的那几次武器，攻击再 +N%
        if (boosted) {
          raw = Math.round(raw * (1 + (Number(att.mods.weaponBoostPowerMul) || 0)));
          /* 打上显式标记：面板上看不出「这一次到底吃没吃到强化」，
           * 测试与战报都靠它判断（见 test-fixes-round 的需求24）。 */
          r.weaponBoost = wUse;
        }
        // 命中
        const mustHit = [9, 15].includes(w.id) || att.mustHitNext ||
          (boosted && Number(att.mods.weaponBoostMustHit) > 0);
        att.mustHitNext = false;
        // 缺陷在使用时即生效，即使这一次被闪避仍持续至战斗结束。
        if (w.id === 10) def.meteorDodge = 20;
        let dodgePct = dodgeChance(att, def);
        if (!mustHit && chance(dodgePct)) {
          r.dodge = true;
          grantFreeTurn();
          pushRound(r);
          att.weaponBoostImmune = false;
          if (r.actAgain && att.hp > 0 && def.hp > 0 && !immediate) immediate = { actor: att, reason: 'freeAction' };
          return;
        }
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
          if (rr.deathSave) {
            r.deathSave = true; r.noteText = rr.noteText; r.noteSide = rr.noteSide;
            /* 涅槃的属性加成标记也要一起带上来，否则界面上看不到「复活后变强」这条提示。 */
            if (rr.reviveStatMul) r.reviveStatMul = rr.reviveStatMul;
          }
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
        grantFreeTurn();
        pushRound(r);
        att.weaponBoostImmune = false;
        if (r.actAgain && att.hp > 0 && def.hp > 0 && !immediate) immediate = { actor: att, reason: 'freeAction' };
        return;
      }

      if (kind === 'skill') {
        const sid = forceCosmos ? 14                                    // 秘技通神：第一招强制小宇宙爆发
          : (att.pattern
            ? nextPatternSkill(att, actives)                            // 固定循环：按技能表的轮转顺序出
            : pickSkill(att, actives));
        att.usedSkills[sid] = true;
        att.skillUseCount[sid] = skillUseCountOf(att, sid) + 1;      // 野球拳（12）的衰减要用「用过几次」
        att.turnSkills[sid] = true;
        att.lastSkillId = sid;
        /* 记冷却：+1 是因为「本次出手开始时已经自减过一格」，这样刚好挡掉接下来 N 次出手。
         * 只对**固定循环型**的敌人记 —— 玩家侧的技能选择有自己的二次使用权重体系，
         * 不该被这条 NPC 防刷规则顺手削弱。 */
        if (att.pattern) att.skillCd[sid] = Number(RULES.skillCooldown) + 1;
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
      actor.turnId = Number(actor.turnId || 0) + 1;
      actor.acts = Number(actor.acts || 0) + 1;      // 出手次数（塔 buff「开局狂热」按它分档）
      actor.turnSkills = {};
      for (const cdId of Object.keys(actor.skillCd || {})) if (actor.skillCd[cdId] > 0) actor.skillCd[cdId]--;
      const def = actor === A ? B : A;
      /* 回合开始类增益（越战越勇 / 后发制人 / 玉石俱焚）：每场战斗结束自动清零。 */
      applyRoundAuras(actor, def, pushRound);
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
          const stacks = Math.min(RULES.erodeMax, def.mechState.erode + 1);
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

  /* ============================================================
   * 【SM8】导出 window.Sim
   * ============================================================ */
  window.Sim = {
    simulate, rules: RULES,
    // 供 tools/test-combat-rules.cjs 直接校验出手权重（不用统计近似）
    actionWeights: { skill: skillWeight, weapon: weaponWeight },
    /* 三个「有效属性」的唯一出口（供测试/调参直接核对：终乘类加成到底乘在哪一层）。
     * 传一个战斗体（至少要 stat/baseStats、buffFlat、debuffs、mods、hp/maxHp）。 */
    effStatsOf: (c) => ({ power: effPower(c), agility: effAgility(c), speed: effSpeed(c) }),
    // 各技能「二次及以后」的出手概率（%），供测试与调参直接读
    repeatRateOf, skillUseCountOf,
    /* 出手类型的三份权重（武器/技能/徒手）与占比 —— 供测试直接核对
     * 「持有的武技越多 → 徒手越少」「全部用过一遍 → 徒手变多」。 */
    kindWeights,
    /* 题面·熔核·炽壳的减伤曲线（每回合 +10%、封顶 70%）—— 纯函数，供测试直接核对 */
    coreReduceOf, coreMaxStacks,
    /* 防御被动的单次触发概率（%）与被动加成读取 —— 供测试/调参直接核对，
     * 不用靠统计近似（绝对防御 16 / 龟甲术 7）。 */
    jueDuiChanceOf, shellChanceOf, passiveSkillBoost,
    /* 低血减伤的即时结算（纯函数）—— 供测试直接核对分段口径 */
    lowHpTakenDamage,
    defenseCaps: { again: BOOSTED_AGAIN_CAP, first: BOOSTED_FIRST_CAP },
  };
})();
