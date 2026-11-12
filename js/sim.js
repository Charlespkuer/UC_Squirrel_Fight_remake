// sim.js — 战斗模拟器：输出回合事件流（battle.js 播放）；武器/技能规则见 gamedata.js。
// fighter.mech：tower.js 注入的 NPC 机制 id（berserk/rhythmCrit/regen/thorns/poison/freeze/wolf/
//   lifesteal/shell/devour 与题面 trialCore/trialMoss/trialDry/trialFrost/trialMirror/trialBloodfang/trialErode）。
// fighter.mods / fighter.setFx：塔 buff 与套装收益的战斗修正包（setFx 装备派生，脱光时失效）；
//   键与数值见 tower-data.js 与 State.applySetBonuses；普通战斗不带这些字段。

(function () {
  'use strict';

  function R(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function chance(pct) { return Math.random() * 100 < pct; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // 联机版同组「首次投掷后可再投一次」的武器：只有它们有 2 次使用额度（见 weaponWeight）。
  const DOUBLE_THROW_IDS = new Set([5, 6, 8, 9, 13, 14]);
  // 客户端拿不到服务端的触发阈值；RULES 是按原版描述重建的口径。
  const RULES = Object.freeze({
    // 师父驾到：生命 ≤50% 才尝试救场，每场至多一次。
    masterHpRatio: 0.50, masterChance: 35,
    /* 两层池子：本场没用过的武器/技能优先，用过的按 repeatWeapon/repeatSkill 权重回池；
     * 额度用尽（普通武器/技能 1 次，六种投掷武器 2 次）后权重 0、退出候选池（对齐联机版）。 */
    repeatWeapon: 8,
    repeatSkill: 5,
    repeatSpecialFirst: 5, repeatSpecialAgain: 5,
    // 徒手与武器/技能的候选权重同池竞争；minCommonShare 只是份额保底（见 commonWeightFor）。
    commonAttackWeight: 100,
    minCommonShare: 0.05,
    npcSkillChance: 30,
    /* 绝对防御(16)/龟甲术(7) 是受击自动触发、不进出手池的被动：概率表按原版成长取。
     * 投掷类攻击完全不触发绝对防御（见 jueDuiDecide / dmgReduce）。 */
    jueDuiFirstBase: 20, jueDuiFirstStep: 0.5, jueDuiRepeat: 0.5,
    jueDuiTrueFirst: 24.5, jueDuiTrueSecond: 5, jueDuiTrueSecondStep: 5, jueDuiTrueSecondMax: 24, jueDuiTrueRepeat: 0.5,
    shellFirstBase: 20, shellFirstStep: 0.5, shellRepeat: 1,
    shellTrueFirst: 24.5,
    xhSpeedShare: 0.35,
    skillCooldown: 2,
    // 熔核·炽壳：每过一回合叠一层减伤（+10%/层），第 8 回合起封顶 70%；层数上限 7。
    coreReducePerRound: 0.10, coreReduceCap: 0.70,
    // 蚀骨的单层上限：代码与 NPC 题面文案共用这一份。
    erodeMax: 15,
    // 同一方最多连续行动 5 次，第 6 次强制轮到另一方（防高速无限先手）。
    maxConsecutiveActions: 5,
    // 闪避率掷骰与面板显示共用这个上限（藏品可叠出更高展示值）。
    dodgeCap: 55,
    // 暴击率上限；溢出的百分点按 1:1 加进暴击伤害（隐藏结算口径，不写进卡面）。
    critCap: 70,
  });
  // sim 只实现这 7 个主动技：出招池只从这张表挑，数据里抄错的 id 会被跳过、不会空过一回合。
  const ACTIVE_SKILLS = [8, 12, 14, 15, 17, 18, 23];
  // 幻兽：原版 petsInfo/petsSkills 只负责播服务端下发的片段，触发与数值在服务端（MainMovie.as:19146）。
  // 这里按 GData.PETS / PET_SKILL_RULES 重建：行动时 1/6/7/8/9/10/11，装死后 2/4，
  // 常驻被动 3（低血增伤）/5（闪避回血）；maxTimes=1 即一场一次。
  // 触发后发 action:'pet' 且 isRound:0，回放层按 attacks 第 29+petId 帧播原版动画，不占 60 手上限。
  const PET_INFO_BY_ID = (() => {
    const map = new Map();
    const list = (window.GData && Array.isArray(GData.PETS)) ? GData.PETS : [];
    for (const p of list) map.set(Number(p.id), p);
    return map;
  })();
  const petRule = (skillId) => {
    const rules = window.GData && GData.PET_SKILL_RULES;
    return (rules && rules[Number(skillId)]) || null;
  };
  const petValue = (skillId, level) => {
    if (window.GData && GData.petSkillValue) return GData.petSkillValue(skillId, level);
    const r = petRule(skillId);
    return r ? r.base + r.step * (Math.max(1, Number(level) || 1) - 1) : 0;
  };
  const petTrigger = (skillId, level) => {
    if (window.GData && GData.petSkillTrigger) return GData.petSkillTrigger(skillId, level);
    const r = petRule(skillId);
    return r ? (r.trigger == null ? petValue(skillId, level) : r.trigger) : 0;
  };
  function normalizePetTeam(list) {
    const out = [];
    for (let i = 0; i < (Array.isArray(list) ? list.length : 0) && out.length < 3; i++) {
      const p = list[i];
      if (!p || typeof p !== 'object') continue;
      const info = PET_INFO_BY_ID.get(Number(p.id)) || {};
      const skillId = Number(p.skillId) || Number(info.skillId) || 0;
      if (!skillId) continue;
      out.push({
        slot: out.length, id: Number(p.id) || Number(info.id) || 0,
        name: String(p.name || info.name || '幻兽'),
        grade: Math.max(1, Number(p.grade) || Number(info.grade) || 1),
        level: Math.max(1, Number(p.level) || 1),
        skillId,
      });
    }
    return out;
  }

  // 调试开关「无敌模式」：只对玩家侧（side 0）生效。
  function godSave(def) {
    try { return !!(def && def.side === 0 && window.Debug && window.Debug.enabled('godMode')); } catch (e) { return false; }
  }
  /* 无敌必须名副其实：60 手超时按血量比例判负，所以玩家 hp 只增不减（任何更小的赋值直接丢弃），
   * 否则吸血/持续伤害/自伤/反伤等旁路都能把血打低、超时反而判负。WeakSet 记已装过的战斗体。 */
  const godHpGuarded = new WeakSet();
  function guardGodHp(def) {
    if (!def || def.side !== 0 || godHpGuarded.has(def)) return def;
    godHpGuarded.add(def);
    let hp = Math.max(1, Math.round(Number(def.hp) || 1));
    Object.defineProperty(def, 'hp', {
      configurable: true, enumerable: true,
      get() { return hp; },
      set(value) {
        const next = Math.max(0, Math.round(Number(value) || 0));
        if (next < hp && godSave(def)) return;    // 掉血一律吃掉（开关中途打开也立刻生效）
        hp = next;
      },
    });
    return def;
  }

  // fighter 输入：{name, level, power, agility, speed, hp, maxHp?, weapons[], skills[],
  //   baseStats?, masterLevel?, npcType?, mech?, mods?, setFx?, pets?, pattern?}（塔字段见调用方）。
  // mods 副本：只深拷 sim 会 shift() 的 deathSaves，其余浅拷贝，避免吃掉调用方的复活次数。
  function cloneModsForBattle(mods) {
    const out = Object.assign({}, mods);
    if (Array.isArray(mods.deathSaves)) {
      out.deathSaves = mods.deathSaves.map((sv) => (sv && typeof sv === 'object') ? Object.assign({}, sv) : sv);
    }
    return out;
  }
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
      if (lo == null) { // NPC/AI 只给 id:level 时按原版 harm 区间与成长重算。
        const [bLo, bHi] = base.harm.split('-').map(Number);
        let add = 0;
        if (w.level <= 10) add = parseInt(base.harmAdd) * (w.level - 1);
        else { add = parseInt(base.harmAdd) * 9; const ex = base.harmAdd1.split('|').map(Number); for (let i = 0; i < w.level - 10 && i < ex.length; i++) add += ex[i]; }
        lo = bLo + add; hi = bHi + add;
      }
      return { id: w.id, level: w.level, name: base.name, type: base.type, lo, hi };
    }).filter(Boolean);
    // 关卡连战会带入场血量：hp 是当前血量、maxHp 是上限；缺 maxHp（AI/NPC/旧录像）时按满血。
    const fullHp = stat(f.maxHp != null ? f.maxHp : f.hp, 1);
    const mech = Array.isArray(f.mech) ? f.mech.slice() : (f.mech ? [f.mech] : []);
    /* mods.deathSaves 必须拷一份：sim 会 shift() 掉条目，共享引用等于吃掉调用方数据
     * （同一敌人第二次模拟一条命不剩、玩家与魔王的复活也互相消耗）。只深拷这一处。 */
    const mods = f.mods && typeof f.mods === 'object' ? cloneModsForBattle(f.mods) : null;
    /* 幻兽：面板加成已由 State.applyPetBonuses 落到力/敏/速/血上，这里只接技能；
     * 3/5 是常驻被动，先折成只读数值，其余技能由主循环按回合触发。 */
    const pets = normalizePetTeam(f.pets);
    let petRagePct = 0, petDodgeHeal = 0;
    for (const p of pets) {
      const rule = petRule(p.skillId);
      if (!rule) continue;
      if (rule.kind === 'rage') petRagePct = Math.max(petRagePct, petValue(p.skillId, p.level));
      else if (rule.kind === 'dodgeHeal') petDodgeHeal += petValue(p.skillId, p.level);
    }
    return {
      side, name: f.name, level: stat(f.level, 1), npcType: f.npcType || null,
      // 只有无尽塔 buildFoe 会写 xhSkillMul/xhEarlyMul（tower-data endlessXhTune）；缺省技能 1×、前期 1.3×。
      xhSkillMul: Number.isFinite(Number(f.xhSkillMul)) ? Math.max(0.1, Math.min(1.5, Number(f.xhSkillMul))) : 1,
      xhEarlyMul: Number.isFinite(Number(f.xhEarlyMul)) ? Math.max(1, Math.min(1.3, Number(f.xhEarlyMul))) : null,
      power: stat(f.power, 1), agility: stat(f.agility, 1), speed: stat(f.speed, 1),
      maxHp: fullHp, hp: Math.max(1, Math.min(stat(f.hp, 1), fullHp)),
      weapons, skills, usedWeapons: {}, weaponUseCount: {}, usedSkills: {},
      skillUseCount: {}, lastWeaponId: null, lastWeaponTurn: 0, lastSkillId: null,
      /* skills 是「id→等级」的对象、不是数组（按下标取会永远取空）；skillOrder 只保留 sim 实现的技能，
       * 一个都不剩时用 ACTIVE_SKILLS 兜底，避免出现完全不会放技能的敌人。 */
      skillOrder: (function () {
        const own = Array.isArray(f.castable) ? f.castable.map(Number) : Object.keys(skills).map(Number);
        const usable = own.filter((id) => ACTIVE_SKILLS.includes(id) && skills[id]);
        return (usable.length ? usable : ACTIVE_SKILLS.filter((id) => skills[id] || usable.length === 0)).sort((a, b) => a - b);
      })(),
      patternSkillIdx: 0,
      // turnId 变化 = 换回合；turnSkills 是「本回合已用过」的锚点，跨回合必须清空。
      turnId: 0, lastTurnId: -1, turnSkills: {},
      // 技能冷却（id → 还要等几次出手）；只对固定循环的敌人生效（见 RULES.skillCooldown）。
      skillCd: {},
      effects: f.effects || {}, masterLevel: Math.max(0, Number(f.masterLevel) || 0),
      heroTrueBase: !!f.heroTrueBase,
      // baseStats 是**不含装备/技能/丹药**的成长裸属性，被真·色诱脱光时属性回落到这里；
      // 旧录像的 fighter 没有该字段，退回记录的 power/agility/speed。
      baseStats: Object.fromEntries(['power', 'agility', 'speed'].map((key) => [key, stat(f.baseStats?.[key], stat(f[key], 1))])),
      ap: 0, restNext: false, pendingWeapon: null, stun: 0, silence: 0, disarm: 0, shellCharges: 0,
      mustHitNext: !!(mods && mods.mustHitFirst), stripTurns: 0, usedFakeDie: false, usedMaster: false, shellCount: 0, usedCosmos: false, jueDuiCount: 0,
      /* 治疗量倍率：塔侧赛前写入（涌泉烙印按层 +10%/层），0 = 完全封疗；
       * 所有治疗都走 healOf()，所以读进这里就全生效。 */
      healMul: Number.isFinite(Number(f.healMul)) && Number(f.healMul) >= 0 ? Number(f.healMul) : 1,
      /* petUsed 按队伍槽位记「一场一次」；petSeal* 是对手整蛊专家封住的武器/技能；
       * petWeakPct 是自身虚弱，petDotPlus/petHealCut/petNextCrit 是张牙舞爪等持续标记。 */
      pets, petRagePct, petDodgeHeal, petUsed: {},
      /* 濒死幻兽技能按**技能 id** 记「一场一次」（原版 maxTimes=1），
       * 所以带 3 只回光术只结算一次，不同技能各触发一次。 */
      petSkillUsed: {},
      petWeakPct: 0, petDotPlus: false, petHealCut: false, petNextCrit: false,
      petSealWeapons: {}, petSealSkills: {},
      // 装死后待补发的协战（逆向推倒/回光术），在下一轮循环开头结算。
      petAfterFakeDie: false,
      healMulBase: Number.isFinite(Number(f.healMul)) && Number(f.healMul) >= 0 ? Number(f.healMul) : 1,
      // 秘技通神的「该技能触发概率 +N%」专用通道；与 effects 编号空间分开，避免串味。
      skillBoost: f.skillBoost && typeof f.skillBoost === 'object' ? Object.assign({}, f.skillBoost) : {},
      usedUlt: false, acted: false, usedFreeSkill: false,
      swordDodge: 0, meteorDodge: 0, debuffs: { power: 0, agility: 0, speed: 0 },
      dot: null, // {dmg, rounds} 或 {pct, rounds}（按当前生命比例扣血）
      buffFlat: { power: 0, agility: 0, speed: 0 },
      mech, mods,
      /* 练功木桩：生命不会耗尽，打完 practiceRounds 次出手收尾；
       * 原版 Stakes 重写 reduceBlood 但不调 checkDead，所以木桩不会死。 */
      practice: !!f.practice,
      practiceRounds: Math.max(0, Math.floor(Number(f.practiceRounds) || 0)),
      // 上一拍掉的血在下一拍开头回满；回放层用它飘绿字。
      practiceHealPending: 0,
      // 套装收益（装备派生，独立通道；见 gamedata.js 与 State.applySetBonuses）。
      setFx: f.setFx && typeof f.setFx === 'object' ? Object.assign({}, f.setFx) : null,
      // 机制可调数值（tower-data.js 定义）：题面文本与判定共用一份。
      mechParams: f.mechParams && typeof f.mechParams === 'object' ? f.mechParams : null,
      // 松鼠对手的固定出招循环（tower-data.js 定义）：['common'|'weapon'|'skill', …]。
      pattern: Array.isArray(f.pattern) && f.pattern.length ? f.pattern.slice() : null,
      patternStep: 0,
      mechState: { basePower: stat(f.power, 1), berserk: false, core: false, coreStack: 0, bfStep: 0, erode: 0 },
      shell: Math.round(fullHp * ((mech.includes('shell') ? 0.30 : 0) + (mods && mods.shellPct || 0)
        + (f.setFx && Number(f.setFx.shellPct) || 0))),
      pendingNote: null,
    };
  }

  // 任何扣血途径致死的兜底：涅槃/金蝉脱壳/无敌模式——所有致死路径都必须走这里。
  // 反噬豁免：免疫一切反伤（荆棘/镜鳞/绝对防御）；判据在被打的一方（att）。
  // 「闪亮登场」强化期内的武器也免疫反伤：一次性标记挂在出手方，由武器分支设置。
  function reflectImmune(c) {
    if (!c) return false;
    if (c.weaponBoostImmune) return true;
    return !!(c.mods && Number(c.mods.reflectImmune) > 0);
  }
  /* 免死条目（涅槃/涅槃plus/金蝉脱壳）的唯一结算点：tryDeathSave 与 applyDamage 共用，
   * 顺序 = 抬上限 → 按 healPct 回血 → 减伤并进 mods.takenMul → 加本场力/敏/速；
   * 两处各写一份会让「被打死」与「被毒死」效果不一致。 */
  function consumeDeathSave(def, sv, r) {
    const plusMax = Math.max(0, Number(sv.maxHpMul) || 0);
    if (plusMax > 0) def.maxHp = Math.max(1, Math.round((Number(def.maxHp) || 1) * (1 + plusMax)));
    const plusTaken = Number(sv.takenMul) || 0;
    if (plusTaken) {
      // 减伤按倍率相乘，不能相加（否则 60%+60% 会变成 100% 免疫）。
      const oldTaken = Number(def.mods.takenMul) || 0;
      def.mods.takenMul = Math.max(-0.95, (1 + oldTaken) * (1 + plusTaken) - 1);
      if (r) r.reviveTakenMul = def.mods.takenMul;
    }
    def.hp = sv.healPct ? Math.max(1, Math.round(def.maxHp * sv.healPct)) : 1;
    // 复活后的力/敏/速加成累加到 buffFlat，只影响本场（combatant 每场新建）。
    const mul = Math.max(0, Number(sv.statMul) || 0);
    if (mul > 0) {
      for (const key of ['power', 'agility', 'speed']) {
        def.buffFlat[key] = (def.buffFlat[key] || 0) + Math.max(1, Math.round((Number(def[key]) || 0) * mul));
      }
    }
    if (!r) return;
    r.deathSave = true;
    r.reviveStatMul = mul > 0 ? mul : undefined;
    // r.revive 只标复活甲：塔按它数「涅槃用掉几次」（C14 叠层时每层有次数）。
    r.revive = sv.revive ? 1 : undefined;
    r.noteText = (r.noteText ? r.noteText + '·' : '') + (sv.name || (sv.healPct ? '涅槃' : '金蝉脱壳'));
    r.noteSide = def.side;
  }
  function tryDeathSave(def, r) {
    if (!def || def.hp > 0) return false;
    if (def.mods && Array.isArray(def.mods.deathSaves) && def.mods.deathSaves.length) {
      consumeDeathSave(def, def.mods.deathSaves.shift(), r);
      return true;
    }
    if (godSave(def)) { def.hp = 1; if (r) r.godSave = true; return true; }
    return false;
  }

  // fakeDieSide 必须带到外层回合，否则回放把「装死」画在挨打的那位（见 battle.js）。
  function inheritFakeDie(r, rr) {
    r.fakeDie = true;
    if (rr.fakeDieSide != null) r.fakeDieSide = rr.fakeDieSide;
    if (rr.fakeDieReflect) r.fakeDieReflect = true;
  }
  // 真·色诱之术：脱光期间装备属性与附加能力全部失效（回到裸属性）。
  function stripped(c) { return Number(c.stripTurns) > 0; }
  function statOf(c, key) { return stripped(c) ? c.baseStats[key] : c[key]; }
  function healOf(c, amount) { return Math.max(0, Math.round(Number(amount) * (c.healMul == null ? 1 : c.healMul))); }
  function effPower(c) {
    let p = statOf(c, 'power') * (1 - c.debuffs.power / 100) + c.buffFlat.power;
    // 狂怒：低血加攻只在该战斗体作为进攻方结算，所以放在 effPower 里。
    const rage = c.mods && Number(c.mods.lowHpPowerMul) || 0;
    if (rage > 0 && lowHpActive(c)) p *= 1 + rage;
    // 套装低血加攻用自己的阈值单独判（setLowHpActive），不被塔 buff 的 lowHpAt 覆盖。
    if (setLowHpActive(c)) p *= 1 + setFx(c, 'lowHpPowerMul');
    // 开局狂热：前 openerRounds 次出手 ×(1+openerPowerMul)，之后 ×(1−fatiguePowerMul)。
    if (c.mods) {
      const boost = Number(c.mods.openerPowerMul) || 0;
      const fatigue = Number(c.mods.fatiguePowerMul) || 0;
      if (boost || fatigue) {
        const rounds = Math.max(1, Number(c.mods.openerRounds) || 5);
        p *= (Number(c.acts) || 1) <= rounds ? 1 + boost : 1 - fatigue;
      }
      // 闪亮登场：前 N 次用武器时另加攻击，之后 (1−weaponBoostFatigueMul)；判据是武器次数，不是出手次数。
      const wFatigue = Number(c.mods.weaponBoostFatigueMul) || 0;
      const wCap = Number(c.mods.weaponBoostUses) || 0;
      if (wFatigue > 0 && wCap > 0 && (Number(c.weaponUses) || 0) > wCap) p *= 1 - wFatigue;
    }
    // 套装「开场强攻」：开场前 N 次出手加攻，没有疲劳段。
    const setOpener = setFx(c, 'openerPowerMul');
    if (setOpener > 0) {
      const rounds = Math.max(1, Number(c.setFx && c.setFx.openerRounds) || 3);
      if ((Number(c.acts) || 1) <= rounds) p *= 1 + setOpener;
    }
    return Math.max(1, Math.round(p));
  }
  // 低血门槛判定：塔 buff 的攻/敏/速加成都共用它。
  function lowHpActive(c) {
    const th = c.mods && Number(c.mods.lowHpAt);
    return !!(th > 0 && c.maxHp > 0 && c.hp <= c.maxHp * th);
  }
  /* 回合开始类增益（塔 buff）：roundStatPct 越战越勇累加力/敏/速；catchUpPct 后发制人补差距
   * 并把对手同项压回同样的量；roundMaxHpMul 玉石俱焚乘双方上限。
   * 都写在 buffFlat/maxHp 上，每个 combatant 每场新建 → 战斗结束自动清零。 */
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
        const gain = Math.max(1, Math.round(best.gap * catchPct));
        actor.buffFlat[best.key] = (actor.buffFlat[best.key] || 0) + gain;
        /* 镜像削弱：我方补多少，对手那一项就掉多少（写 foe.buffFlat 负数）；
         * gain ≤ 差距，所以对手最多被压到与我方持平，eff 出口另有 Math.max(1, …) 兜底。 */
        if (foe && foe.buffFlat) foe.buffFlat[best.key] = (foe.buffFlat[best.key] || 0) - gain;
        if (push) push({ attacker: actor.side, action: 'buff', noteText: '后发制人', noteSide: actor.side,
          aura: { key: best.key, gain: gain, drain: gain, drainSide: foe ? foe.side : null } });
      }
    }
    const hpMul = Number(m.roundMaxHpMul) || 0;
    if (hpMul > 0 && hpMul < 1) {
      for (const c of [actor, foe]) {
        if (!c || c.hp <= 0) continue;
        c.maxHp = Math.max(1, Math.floor(c.maxHp * hpMul));
        if (c.hp > c.maxHp) c.hp = c.maxHp;
      }
      // 上限/血量变化要写进这一回合事件，回放据此更新血条。
      const bySide = (pick) => (actor.side === 0 ? [pick(actor), pick(foe)] : [pick(foe), pick(actor)]);
      if (push) push({ attacker: actor.side, action: 'buff', noteText: '玉石俱焚', noteSide: actor.side,
        maxHp: bySide((c) => c.maxHp), hp: bySide((c) => c.hp) });
    }
  }
  /* 低血减伤：把一次伤害按 lowHpAt 阈值线切两段，阈值以上全额、越线部分 ×(1+mul)。
   * 已低于阈值时整段吃减伤；多段攻击由调用方逐段传当前血量，第二段自然整段吃。 */
  function lowHpTakenDamage(def, dmg, mul, at) {
    const d = Math.max(0, Number(dmg) || 0);
    const cut = Math.max(0, 1 + (Number(mul) || 0)); // 减伤后的倍率（0~1）
    // 阈值默认取塔 buff 的 lowHpAt；套装（幕府）传自己的 lowHpAt 进来。
    const th = Number(at != null ? at : (def.mods && def.mods.lowHpAt)) || 0;
    const maxHp = Math.max(0, Number(def.maxHp) || 0);
    const hp = Math.max(0, Number(def.hp) || 0);
    if (!(th > 0) || !(maxHp > 0)) return Math.round(d * cut); // 没阈值：整段减伤
    // 不做 cut<=0 的提前返回：减伤 100% 也要先把阈值以上那段打完，else 会变成一击归零。
    const line = maxHp * th; // 阈值线（绝对血量）
    const above = Math.max(0, hp - line); // 打到线之前的那一段
    if (d <= above) return d; // 这一击打不到线 → 全额
    const below = d - above; // 越过线的那一段
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
    if (setLowHpActive(c)) v *= 1 + setFx(c, 'lowHpSpeedMul'); // 套装低血加速
    return Math.max(1, Math.round(v));
  }
  function effect(c, id) { return stripped(c) ? 0 : Math.max(0, Number(c.effects[id]) || 0); }
  /* 套装收益走独立通道 c.setFx（装备派生）：被真·色诱脱光时整包失效，
   * 也不与塔 buff 的 lowHpAt/openerRounds 互相污染；单位与同名 mods 键一致
   *（比例 0.06、百分点 6）。 */
  function setFx(c, key) {
    if (!c || !c.setFx || stripped(c)) return 0;
    const v = Number(c.setFx[key]);
    return Number.isFinite(v) ? v : 0;
  }
  // 套装自己的低血阈值，与塔 buff 的 lowHpAt 各判各的。
  function setLowHpActive(c) {
    if (!c || !c.setFx || stripped(c)) return false;
    const th = Number(c.setFx.lowHpAt);
    return !!(th > 0 && c.maxHp > 0 && c.hp <= c.maxHp * th);
  }
  const trueVal = (id, level) => (window.GData && GData.trueSkillValue ? GData.trueSkillValue(id, level) : 0);
  const trueW = (w, key) => (window.GData && GData.trueWeaponBonus ? GData.trueWeaponBonus(w, key) : 0);
  // 勇者专属：武技真化后的白值乘数（真1~4 ×1.5，真5 ×2）。
  const trueBaseMul = (level) => {
    const lv = Math.max(1, Math.min(15, Math.floor(Number(level) || 1)));
    return lv >= 15 ? 2 : lv >= 11 ? 1.5 : 1;
  };
  const heroBaseMul = (att, level) => att && att.heroTrueBase ? trueBaseMul(level) : 1;
  // 沉默之斧保留四项基础属性技，抑制其余主动、被动及防御技能。
  function skill(c, id) { return c.silence > 0 && id > 4 ? 0 : c.skills[id] || 0; }
  /** 武器基础效果：1~10 级按每级增长；真化追加由 trueW() 固定叠加一次（不能再按真级重复计入）。 */
  function weaponEffect(w, base, perLevel) {
    return base + perLevel * (Math.min(w.level, 10) - 1);
  }
  /** 暴击率原始值（未钳制）：基础 5 + 暴击技能 + 塔/套装；暴击技能 1~10 级成长，之后只加真·4 倍几率。 */
  function rawCritChance(att) {
    let c = 5;
    if (skill(att, 9)) c += 2 * Math.min(10, skill(att, 9));
    if (att.mods && att.mods.critBonus) c += Number(att.mods.critBonus);
    c += setFx(att, 'critBonus');
    return c;
  }
  // 溢出暴击率 1:1 转暴击伤害（隐藏口径）。
  function critOverflow(att) {
    return Math.max(0, rawCritChance(att) - RULES.critCap);
  }
  /** 最终暴击率 = 基础 − 真·皮糙肉厚的百分点压制，再钳到 critCap（真1~5 = 0.5/1/2/3/5 个百分点）。 */
  function critChanceAgainst(att, def) {
    const antiCrit = def && def.skills ? trueVal(10, def.skills[10]) : 0;
    return clamp(Math.max(0, critChance(att) - antiCrit), 0, RULES.critCap);
  }
  function critDmgBonus(att) {
    const base = ((att.mods && Number(att.mods.critDmgBonus) || 0) + setFx(att, 'critDmgBonus')) / 100;
    return base + critOverflow(att) / 100;
  }

  function pickOne(list) { return list[Math.floor(Math.random() * list.length)]; }
  // 「本场没用过」的基准权重；用过的按各自的二次使用权重降权。
  const UNUSED_WEIGHT = 100;

  function pickWeighted(list, weightOf) {
    let total = 0;
    for (const x of list) total += weightOf(x);
    if (!(total > 0)) return pickOne(list);
    let roll = Math.random() * total;
    for (const x of list) { roll -= weightOf(x); if (roll <= 0) return x; }
    return list[list.length - 1];
  }

  // 二次使用权重：本场没用过用 UNUSED_WEIGHT（100）；用过的按 repeatWeapon/repeatSkill 回池，
  // 额度用尽则 0（见 weaponWeight / skillWeight）。绝对防御、龟甲术不进这个池。
  function repeatRateOf(id, count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (Number(id) === 17) return 1;
    if (id !== 12) return RULES.repeatSkill;
    return n <= 1 ? RULES.repeatSpecialFirst : RULES.repeatSpecialAgain;
  }
  /** 某个技能本场已经用过几次（玩家与敌人都记在各自的 skillUseCount 上）。 */
  function skillUseCountOf(att, id) {
    if (!att || !att.skillUseCount) return 0;
    return Math.max(0, Math.floor(Number(att.skillUseCount[id]) || 0));
  }
  function skillWeight(att, id) {
    // 对齐联机版：技能用过 1 次后权重 0、退出候选池（可多次的特殊机制另走分支）。
    if (skillUseCountOf(att, id) >= 1) return 0;
    let w = att.usedSkills[id] ? repeatRateOf(id, skillUseCountOf(att, id)) : UNUSED_WEIGHT;
    // 秘技通神：该技能权重 ×(1+skillBoost[id])，只走独立通道，不读 effects。
    const boost = Number(att.skillBoost && att.skillBoost[id]) || 0;
    if (boost > 0) w *= 1 + boost;
    return w;
  }
  /* 武器权重：首次 100；六种可再投的投掷武器第二次仍 100，其余用过即 repeatWeapon；真化不额外给额度。
   * 流星锤(10)/橡皮擦(7) 第二次起按近战口径；流星锤三连击只算一次使用。w 可传对象或 id。 */
  function weaponWeight(att, w) {
    const id = w && typeof w === 'object' ? w.id : w;
    const weapon = w && typeof w === 'object'
      ? w
      : ((att.weapons || []).find((x) => Number(x.id) === Number(id)) || null);
    const used = !!(att.usedWeapons && att.usedWeapons[id]);
    const count = att.weaponUseCount && att.weaponUseCount[id] != null
      ? Math.max(0, Math.floor(Number(att.weaponUseCount[id]) || 0))
      : (used ? 1 : 0);
    // 额度用尽后返回 0，由 usableWeapons 剔出候选池（普通 1 次 / 投掷 2 次）。
    const maxUses = DOUBLE_THROW_IDS.has(Number(id)) ? 2 : 1;
    if (count >= maxUses) return 0;
    const specialThrowRepeat = Number(id) === 7 || Number(id) === 10;
    if (weapon && weapon.type === '投掷' && !specialThrowRepeat) {
      return count < 2 ? UNUSED_WEIGHT : RULES.repeatWeapon;
    }
    return used ? RULES.repeatWeapon : UNUSED_WEIGHT;
  }

  // 技能选择：按 skillWeight 加权抽取（没用过的优先）。
  // 出手类型按「候选池实际权重之和 vs 徒手权重」抽一次：武技越多徒手越少，
  // 全部用过一遍后徒手占比自然抬高。抽签只消耗一次 Math.random()，随机序列长度不变。
  // 徒手保底权重：份额 = w/(w+tool) ≥ minCommonShare ⟺ w ≥ tool × r/(1−r)。
  function commonWeightFor(toolWeight) {
    const r = Math.max(0, Math.min(0.9, Number(RULES.minCommonShare) || 0));
    const floor = r > 0 ? (Number(toolWeight) || 0) * (r / (1 - r)) : 0;
    return Math.max(RULES.commonAttackWeight, floor);
  }
  function pickKind(att, weapons, actives) {
    let weaponSum = 0;
    for (const w of weapons || []) weaponSum += weaponWeight(att, w);
    let skillSum = 0;
    for (const id of actives || []) skillSum += skillWeight(att, id);
    const commonWeight = commonWeightFor(weaponSum + skillSum);
    const total = weaponSum + skillSum + commonWeight;
    const roll = Math.random() * total;
    if (roll < weaponSum) return 'weapon';
    if (roll < weaponSum + skillSum) return 'skill';
    return 'common';
  }
  // 纯 NPC（三侠）没有武器池，用固定档位 30% 技能 / 70% 普攻。
  function pickNpcKind() {
    return Math.random() * 100 < RULES.npcSkillChance ? 'skill' : 'common';
  }

  /** 出手类型的三份权重与占比（测试直接核对徒手份额下限用）。 */
  function kindWeights(att, weapons, actives) {
    let weapon = 0;
    for (const w of weapons || []) weapon += weaponWeight(att, w);
    let skill = 0;
    for (const id of actives || []) skill += skillWeight(att, id);
    const common = commonWeightFor(weapon + skill);
    const total = weapon + skill + common;
    return { weapon, skill, common, total, weaponShare: weapon / total, skillShare: skill / total, commonShare: common / total };
  }

  // 固定循环：按 skillOrder 轮转，缺的顺延到下一个可用；skillOrder 固定不变，循环可背板。
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
  // 武器选择：只在自己「上一手就是武器且紧挨着」时排除上一把，避免同一把连打两下。
  function pickWeapon(att, pool) {
    const list = (pool && pool.length ? pool : att.weapons) || [];
    const lastId = Number(att.lastWeaponId) || 0;
    const consecutive = lastId > 0 && Number(att.lastWeaponTurn) > 0
      && Number(att.turnId) - Number(att.lastWeaponTurn) === 1;
    const alt = consecutive ? list.filter((w) => Number(w && w.id) !== lastId) : list;
    return pickWeighted(alt.length ? alt : list, (w) => weaponWeight(att, w));
  }

  function dodgeChance(att, def) {
    /* 木桩不闪避（原版 Stakes 没有闪避分支）：从唯一闪避出口挡住，
     * 武器/技能/幻兽的所有闪避判定一起生效。 */
    if (def && (def.practice || def.npcType === 'wood')) return 0;
    if (att.mods && (att.mods.mustHitAll || att.mods.firstStrikeAll)) return 0; // 塔 buff 必中
    const wMust = att.mustHitNext;
    if (wMust) return 0;
    let d = 6 + 26 * effAgility(def) / (effAgility(def) + effAgility(att) * 1.2 + 40);
    const shift = skill(def, 11)
      ? (5 + 2 * (Math.min(skill(def, 11), 10) - 1) + trueVal(11, skill(def, 11))) * (1 + effect(def, 35) / 100)
      : 0;
    d *= 1 + (shift + def.swordDodge + def.meteorDodge) / 100;
    if (def.mods && def.mods.dodgeBonus) d += Number(def.mods.dodgeBonus);
    if (def.mods && def.mods.dodgeMul) d *= 1 + Number(def.mods.dodgeMul);
    d += setFx(def, 'dodgeBonus');
    return clamp(d, 0, RULES.dodgeCap);
  }

  function critChance(att) {
    return clamp(rawCritChance(att), 0, RULES.critCap);
  }

  /* 秘技通神的被动加成值：只认 skillBoost['技能ID']（不读 effects——键位属于装备词条/武器槽）。
   * 绝对防御/龟甲术不进出手池，所以触发判定处必须在这里单独乘一次；
   * C33 抽中小宇宙爆发不走这里（见 mods.cosmosFirst）。 */
  function passiveSkillBoost(f, id) {
    if (!f) return 0;
    const v = Number(f.skillBoost && f.skillBoost[id]);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  }
  const BOOSTED_AGAIN_CAP = 45;
  const BOOSTED_FIRST_CAP = 90;
  // 熔核减伤层数上限 = 封顶 / 每层。
  function coreMaxStacks() {
    const per = Math.max(0.01, Number(RULES.coreReducePerRound) || 0.10);
    return Math.max(1, Math.round((Number(RULES.coreReduceCap) || 0.70) / per));
  }
  // 熔核减伤 = min(回合数 × 10%, 70%)，纯函数供测试核对曲线。
  function coreReduceOf(count) {
    const per = Math.max(0, Number(RULES.coreReducePerRound) || 0);
    const cap = Math.max(0, Number(RULES.coreReduceCap) || 0);
    const n = Math.max(0, Math.min(coreMaxStacks(), Math.floor(Number(count) || 0)));
    return Math.round(Math.min(cap, n * per) * 100) / 100;
  }
  /* 绝对防御触发概率按原表：1~10 级首次 20+0.5×(级−1)、之后 0.5；
   * 11~15 级首次 24.5，第二次 5/10/15/20/24，第三次起 0.5。 */
  function jueDuiChanceOf(def, count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const lv = Math.max(1, Math.floor(Number(def && def.skills && def.skills[16]) || 1));
    let base;
    if (lv <= 10) {
      base = n === 0 ? RULES.jueDuiFirstBase + RULES.jueDuiFirstStep * (lv - 1) : RULES.jueDuiRepeat;
    } else {
      const t = Math.max(1, Math.min(5, lv - 10));
      base = n === 0 ? RULES.jueDuiTrueFirst
        : n === 1 ? Math.min(RULES.jueDuiTrueSecondMax, RULES.jueDuiTrueSecond + RULES.jueDuiTrueSecondStep * (t - 1))
          : RULES.jueDuiTrueRepeat;
    }
    const boost = passiveSkillBoost(def, 16);
    const out = base * (1 + boost);
    if (!boost) return out;
    // C33 封顶只压「加成带来的溢出」，不能把本来更高的基础值压回去。
    return Math.max(base, Math.min(out, n === 0 ? BOOSTED_FIRST_CAP : BOOSTED_AGAIN_CAP));
  }
  /** 龟甲术触发概率：1~10 级首次 20+0.5/级、之后 1；真化后按原表 20/40/60/80/100 判多次使用。 */
  function shellChanceOf(def, count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const lv = Math.max(1, Math.floor(Number(def && def.skills && def.skills[7]) || 1));
    let base;
    if (lv <= 10) {
      base = n === 0 ? RULES.shellFirstBase + RULES.shellFirstStep * (lv - 1) : RULES.shellRepeat;
    } else {
      base = n === 0 ? RULES.shellTrueFirst : trueVal(7, lv);
    }
    const boost = passiveSkillBoost(def, 7);
    const out = base * (1 + boost);
    if (!boost) return out;
    return Math.max(base, Math.min(out, n === 0 ? BOOSTED_FIRST_CAP : BOOSTED_AGAIN_CAP));
  }
  /* 绝对防御一次出手只判一次：多段攻击（西瓜刀/螳螂双击/镰刀舞）整段挡或整段不挡，
   * 由出手方在循环外判好、经 opts.jueDuiLock 传给每一段。返回 'block'|'miss'|null，
   * 整段挡下 jueDuiCount 只 +1；投掷类不适用（见下）。 */
  function jueDuiDecide(def, weaponType) {
    if (!def || !def.skills || !def.skills[16]) return null;
    if (Number(def.silence) > 0) return null;
    // 投掷类攻击完全不触发绝对防御：不挡、不反弹、也不推高降权计数。
    if (weaponType === '投掷') return null;
    if (!chance(jueDuiChanceOf(def, def.jueDuiCount || 0))) return 'miss';
    def.jueDuiCount = Math.max(0, Math.floor(Number(def.jueDuiCount) || 0)) + 1;
    return 'block';
  }
  /** 挡下：伤害归零，按 40%+4%/级+真化加成+词条 47 反弹给出击方。 */
  function jueDuiBlock(def, dmg, out) {
    const pct = 40 + 4 * (Math.min(def.skills[16], 10) - 1) + trueVal(16, def.skills[16]) +
      Math.max(0, Number(effect(def, 47)) || 0);
    out.jueDui = dmg;
    out.rebound = Math.round(dmg * pct / 100);
    out.dmg = 0;
    return out;
  }
  function dmgReduce(def, dmg, opts) {
    opts = opts || {};
    let out = { dmg, guiJia: 0, jueDui: 0, rebound: 0 };
    const gearReduction = opts.action === 'weapon' ? effect(def, opts.weaponType === '投掷' ? 10 : 9) : opts.action === 'skill' ? effect(def, 11) : 0;
    out.dmg = Math.round(out.dmg * (1 - clamp(gearReduction, 0, 80) / 100));
    /* jueDuiCount 记「挡过几次」：每挡一次，下一次触发率按 jueDuiChanceOf 曲线下降。
     * opts.jueDuiLock = 本次出手的判定结果（多段由出手方判一次）；undefined 才在这里自己判。
     * opts.counter（反击）不判绝对防御，反击必须落到出手方。 */
    const jueDui = opts.counter ? 'miss' : (opts.jueDuiLock === undefined ? jueDuiDecide(def, opts.weaponType) : opts.jueDuiLock);
    if (jueDui === 'block') return jueDuiBlock(def, out.dmg, out);
    if (def.skills[7] && def.silence <= 0) {
      const shellCount = Math.max(0, Math.floor(Number(def.shellCount) || 0));
      const canTrigger = def.shellCharges > 0
        || chance(shellChanceOf(def, shellCount));
      if (canTrigger) {
        if (def.shellCharges > 0) def.shellCharges--;
        else def.shellCount = shellCount + 1;
        // 龟甲术吸收率只到 10 级，真化只加「多次使用」几率。
        const pct = clamp(20 + 5 * (Math.min(def.skills[7], 10) - 1), 0, 100);
        out.guiJia = Math.round(out.dmg * pct / 100);
        out.dmg -= out.guiJia;
      }
    }
    if (skill(def, 10)) {
      // 皮糙肉厚：减伤 1~10 级成长，真化只减对手暴击率。
      const pct = clamp((5 + (Math.min(skill(def, 10), 10) - 1)) * (1 + effect(def, 34) / 100), 0, 80);
      out.dmg = Math.round(out.dmg * (100 - pct) / 100);
    }
    if (def.mods && def.mods.takenMul) out.dmg = Math.round(out.dmg * (1 + Number(def.mods.takenMul)));
    const setTaken = setFx(def, 'takenMul');
    if (setTaken) out.dmg = Math.round(out.dmg * (1 + setTaken));
    if (def.mods && Number(def.mods.lowHpTakenMul)) {
      out.dmg = lowHpTakenDamage(def, out.dmg, Number(def.mods.lowHpTakenMul));
    }
    // 套装低血减伤：沿用同一套分段算法，阈值单独传。
    const setLowTaken = setFx(def, 'lowHpTakenMul');
    if (setLowTaken) out.dmg = lowHpTakenDamage(def, out.dmg, setLowTaken, Number(def.setFx && def.setFx.lowHpAt) || 0);
    if (def.mech.includes('trialCore')) {
      // 熔核：每过一回合叠一层减伤（见 coreReduceOf）。
      const dr = coreReduceOf(def.mechState.coreStack || 0);
      if (dr > 0) out.dmg = Math.round(out.dmg * (1 - dr));
    }
    out.dmg = Math.max(1, out.dmg);
    return out;
  }

  /** 主模拟：返回 {rounds, winner(0|1), maxHp:[a,b]}。 */
  function simulate(f0, f1, options) {
    options = options || {};
    const rules = {
      masterHpRatio: Number.isFinite(options.masterHpRatio) ? clamp(options.masterHpRatio, 0, 1) : RULES.masterHpRatio,
      masterChance: Number.isFinite(options.masterChance) ? clamp(options.masterChance, 0, 100) : RULES.masterChance,
    };
    const A = makeCombatant(f0, 0), B = makeCombatant(f1, 1);
    // 无敌模式：开战顶满血并装只增不减的 hp 访问器（见 guardGodHp）。
    if (godSave(A)) { A.hp = A.maxHp; guardGodHp(A); }
    // 枯泉封疗从开战就生效（不等它出手），否则先手玩家在它行动前的吸血/回血会漏过去。
    // 机制清单以 tower-data 的 mechSealsHeal 为准，塔外没有 TowerData 时退回硬编码清单。
    (function sealHealingAtStart() {
      const TD = window.TowerData;
      const seals = (mechs) => (TD && typeof TD.mechSealsHeal === 'function'
        ? TD.mechSealsHeal(mechs)
        : (mechs || []).indexOf('trialDry') >= 0);
      if (seals(B.mech)) A.healMul = 0;
      if (seals(A.mech)) B.healMul = 0;
    })();
    // 开战护盾要能立刻画出来，不能等第一次挨打。
    const startShell = [Math.max(0, A.shell || 0), Math.max(0, B.shell || 0)];
    const rounds = [];
    // 原版上限 60 手（combat maxRounds=60）；这里的 rounds 是「一次出手」，与原版日志一条记录同口径。
    const MAX_ACTIONS = 60;
    /* 训练木桩：固定 N 次出手（经典/现代两套播放器都共用这一条），到点就收尾；
     * 木桩本身不会死，见 applyDamage 的 practice 分支。 */
    const practice = A.practice ? A : (B.practice ? B : null);
    const actionCap = practice && practice.practiceRounds > 0
      ? Math.min(MAX_ACTIONS, practice.practiceRounds) : MAX_ACTIONS;
    let actions = 0;

    function pushRound(r) {
      if (A.hp <= 0 && godSave(A)) A.hp = 1;
      if (B.hp <= 0 && godSave(B)) B.hp = 1;
      if (r && r.attacker != null) {
        const c = r.attacker === 0 ? A : B;
        if (c.pendingNote) { r.noteText = (r.noteText ? r.noteText + '·' : '') + c.pendingNote; c.pendingNote = null; }
      }
      r.hpAfter = [Math.max(0, A.hp), Math.max(0, B.hp)];
      // 只有调用方要 collectStats 才落三维快照，取这一拍结算后的有效值（回放调试层读它）。
      if (options.collectStats) {
        r.effStats = [
          { power: effPower(A), agility: effAgility(A), speed: effSpeed(A) },
          { power: effPower(B), agility: effAgility(B), speed: effSpeed(B) },
        ];
      }
      r.shellAfter = [Math.max(0, A.shell || 0), Math.max(0, B.shell || 0)];
      // stripLeft 给回放决定装备视觉：>0 要卸装，0 = 正常穿着。
      r.stripLeft = [Math.max(0, Number(A.stripTurns) || 0), Math.max(0, Number(B.stripTurns) || 0)];
      if (A.practiceHealPending) { r.practiceHeal = (Number(r.practiceHeal) || 0) + A.practiceHealPending; A.practiceHealPending = 0; }
      if (B.practiceHealPending) { r.practiceHeal = (Number(r.practiceHeal) || 0) + B.practiceHealPending; B.practiceHealPending = 0; }
      rounds.push(r);
    }

    /* 反伤/反噬打到出手方：与普通伤害同一条致死链（装死 → 涅槃/金蝉脱壳 → 调试图腾）。
     * fakeDieSide 记「谁装的死」，回放据此把飘字画在正确的人（被反伤时是出手方）。 */
    function reflectHurt(target, amount, r) {
      const dmg = Math.max(0, Math.round(Number(amount) || 0));
      if (!target || dmg <= 0 || target.hp <= 0) return 0;
      if (target.hp - dmg <= 0 && target.skills && target.skills[6] && target.silence <= 0 && !target.usedFakeDie) {
        target.usedFakeDie = true;
        target.hp = 1;
        target.stun = 0;
        r.fakeDie = true;
        r.fakeDieSide = target.side;
        r.fakeDieReflect = true;
        queueFakeDiePets(target);
        if (!immediate) immediate = { actor: target, reason: 'fakeDie' };
        return dmg;
      }
      target.hp -= dmg;
      tryDeathSave(target, r);
      return dmg;
    }
    /** 木桩只锁生命：伤害数值完整上报，血条最低 1，下一拍只补回实际失去的血。 */
    function practiceHurt(def, dmg) {
      if (!def || !def.practice) return dmg;
      def.hp = Math.max(1, def.hp - dmg);
      return dmg;
    }
    function applyDamage(att, def, rawDmg, r, opts) {
      opts = opts || {};
      // 词条 46 只在这下确实是暴击时生效。
      if (r.crit) {
        const cut = clamp(Number(effect(def, 46)) || 0, 0, 80);
        if (cut > 0) { rawDmg = Math.round(rawDmg * (1 - cut / 100)); r.critCut = cut; }
      }
      const action = opts.action || r.action;
      // 勇者武技真化只放大技能基础伤害，不进入三维（武器白值已在 TowerHero.fighter 乘过）。
      if (att.heroTrueBase && action === 'skill') {
        rawDmg = Math.round(rawDmg * heroBaseMul(att, att.skills[Number(r.id)]));
      }
      if (att.mods && att.mods.dmgMul) rawDmg = Math.round(rawDmg * Number(att.mods.dmgMul)); // 塔 buff 伤害乘区
      const setDmgMul = 1 + setFx(att, 'dmgMul'); // 套装伤害乘区
      if (setDmgMul !== 1) rawDmg = Math.round(rawDmg * setDmgMul);
      // 幻兽·狂暴的门槛是固定 200 血，不是比例。
      if (petRageActive(att) && rawDmg > 0) {
        rawDmg = Math.round(rawDmg * (1 + att.petRagePct / 100));
        r.petRage = att.petRagePct;
      }
      if (action === 'weapon' && def.petWeakPct > 0 && rawDmg > 0) {
        rawDmg = Math.round(rawDmg * (1 + def.petWeakPct / 100));
        r.petWeak = def.petWeakPct;
      }
      if (action === 'skill') {
        rawDmg = Math.round(rawDmg * (1 + effect(att, 8) / 100));
        const cc = critChanceAgainst(att, def);
        // 打兴奋剂：给下一次攻击必暴，技能这一支也吃。
        if (att.petNextCrit) {
          att.petNextCrit = false;
          r.crit = true; r.petCrit = true;
          rawDmg = Math.round(rawDmg * (2 + effect(att, 45) / 100 + effect(att, 4) / 100 + critDmgBonus(att)));
        } else if (chance(cc)) {
          const quad = trueVal(9, att.skills[9]);
          const mul = (quad > 0 && chance(quad)) ? 4 : 2;
          if (mul === 4) r.crit4 = true;
          rawDmg = Math.round(rawDmg * (mul + effect(att, 45) / 100 + effect(att, 4) / 100 + critDmgBonus(att)));
          r.crit = true;
        }
      }
      // opts.counter = 反击：必中，连绝对防御也不判（回放没有「绝对防御」飘字会像被闪避）。
      const red = dmgReduce(def, rawDmg, { action, weaponType: opts.weaponType, jueDuiLock: opts.jueDuiLock, counter: !!opts.counter });
      let dmg = red.dmg;
      // 塔 buff 狂怒是终乘：在加成与减伤之后直接乘最终伤害，不被其它乘区稀释。
      if (dmg > 0 && att.mods && Number(att.mods.lowHpFinalMul) > 0 && lowHpActive(att)) {
        dmg = Math.round(dmg * (1 + Number(att.mods.lowHpFinalMul)));
        r.rageFinalMul = Number(att.mods.lowHpFinalMul);
      }
      // 套装低血终乘：与狂怒同位置，但用 setLowHpActive 自己的阈值，互不干扰。
      if (dmg > 0 && setLowHpActive(att)) {
        const setFinal = setFx(att, 'lowHpFinalMul');
        if (setFinal > 0) { dmg = Math.round(dmg * (1 + setFinal)); r.setLowHpFinalMul = setFinal; }
      }
      /* 先机预判：敌方第一次攻击必定闪避（在伤害算完处归零，常规闪避判定在更前面，
       * 天然逃掉的不消耗这个额度）。opts.noDodge 给反击用，不能被它吃掉。 */
      if (!opts.noDodge && dmg > 0 && def.mods && Number(def.mods.firstDodge) > 0 && !def.mods.firstDodgeUsed) {
        def.mods.firstDodgeUsed = true;
        dmg = 0;
        markDodge(r, def);
        r.firstDodge = true;
        r.noteText = (r.noteText ? r.noteText + '·' : '') + (def.mods.firstDodgeName || '先机预判'); r.noteSide = def.side;
        // 额外行动走 immediate 路径，不经过行动条 → 真·不消耗回合。
        if (def.mods.firstDodgeFreeTurn && def.hp > 0) {
          r.firstDodgeFreeTurn = true;
          if (!immediate) immediate = { actor: def, reason: 'firstDodge' };
        }
      }
      if (!opts.noDodge && dmg > 0 && def.mods && def.mods.firstHitZero && !def.mods.firstHitZeroUsed) {
        def.mods.firstHitZeroUsed = true;
        dmg = 0;
        r.firstHitZero = true;
        r.noteText = (r.noteText ? r.noteText + '·' : '') + (def.mods.firstHitZeroName || '先机预判'); r.noteSide = def.side;
        /* 兼容旧字段：若还有带 `firstHitZeroFreeTurn` 的来源，仍然给额外行动。 */
        if (def.mods.firstHitZeroFreeTurn && def.hp > 0) {
          r.firstHitZeroFreeTurn = true;
          if (!immediate) immediate = { actor: def, reason: 'firstHitZero' };
        }
      }
      if (red.jueDui) { r.jueDui = true; r.rebound = red.rebound; }
      if (red.guiJia) r.guiJia = red.guiJia;
      // 护盾先于血量消耗（开局护盾由界面直接读，见 simulate 的 startShell）。
      if (def.shell > 0 && dmg > 0) {
        const absorbed = Math.min(def.shell, dmg);
        def.shell -= absorbed; dmg -= absorbed;
        r.shellAbsorb = absorbed;
      }
      if (def.practice) {
        dmg = practiceHurt(def, dmg);
      } else if (def.hp - dmg <= 0 && def.skills[6] && def.silence <= 0 && !def.usedFakeDie && !opts.ignoreFakeDie) {
        def.usedFakeDie = true;
        dmg = Math.max(0, def.hp - 1);
        def.hp = 1;
        r.fakeDie = true;
        r.fakeDieSide = def.side;
        def.stun = 0;
        queueFakeDiePets(def);
        immediate = { actor: def, reason: 'fakeDie' };
      } else if (def.hp - dmg <= 0 && def.mods && Array.isArray(def.mods.deathSaves) && def.mods.deathSaves.length) {
        /* 与 tryDeathSave 共用同一份触发逻辑（含涅槃plus 的抬上限 / 减伤）。 */
        consumeDeathSave(def, def.mods.deathSaves.shift(), r);
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
        // 反击（noReflect）：只记「被挡住」，不再让原出手方的绝对防御/荆棘弹回反击者。
        if (opts.noReflect) {
          r.reflectBlocked = (r.reflectBlocked || 0) + red.rebound;
        } else if (reflectImmune(att)) {
          // 反噬豁免只免反伤，不免「被挡下」这件事本身。
          r.reflectBlocked = (r.reflectBlocked || 0) + red.rebound;
          r.noteText = (r.noteText ? r.noteText + '·' : '') + '反噬豁免'; r.noteSide = att.side;
        } else {
          r.reboundHurt = red.rebound;
          // 绝对防御的反伤同样过装死（与普通伤害同一条致死链）。
          reflectHurt(att, red.rebound, r);
        }
      }
      if (dmg > 0) {
        const noReflect = !!opts.noReflect || reflectImmune(att);
        if (def.mech.includes('thorns') && att.hp > 0 && !noReflect) {   // 荆棘铁壁：反弹 15%
          const reflect = Math.max(1, Math.round(dmg * 0.15));
          r.thornsDmg = (r.thornsDmg || 0) + reflect;
          reflectHurt(att, reflect, r);
        }
        // 塔 buff「荆棘之甲」与套装反伤合并在同一乘区。
        const modThorns = def.mods && Number(def.mods.thornsPct) || 0;
        const thornsPct = modThorns + setFx(def, 'thornsPct');
        if (thornsPct > 0 && att.hp > 0 && !noReflect) {
          const reflect = Math.max(1, Math.round(dmg * thornsPct));
          r.thornsDmg = (r.thornsDmg || 0) + reflect;
          /* 只有塔 buff 那一份才打「荆棘之甲」的飘字 —— 光靠套装反伤不该顶着 buff 的名字。 */
          if (modThorns > 0) { r.noteText = (r.noteText ? r.noteText + '·' : '') + '荆棘之甲'; r.noteSide = def.side; }
          reflectHurt(att, reflect, r);
        }
        // 镜鳞：单次伤害 ≥ 阈值时按比例反弹（缺省 15% 最大生命 / 60%），逼玩家压低单次或走多段。
        const mp = (def.mechParams && def.mechParams.trialMirror) || null;
        const threshold = (mp && Number(mp.threshold)) || 0.15;
        const reflectPct = (mp && Number(mp.reflect)) || 0.6;
        if (def.mech.includes('trialMirror') && att.hp > 0 && !noReflect && dmg >= def.maxHp * threshold) {
          const reflect = Math.max(1, Math.round(dmg * reflectPct));
          r.thornsDmg = (r.thornsDmg || 0) + reflect;
          r.noteText = (r.noteText ? r.noteText + '·' : '') + '镜鳞·反噬'; r.noteSide = def.side;
          reflectHurt(att, reflect, r);
        }
        /* 沉默之壁：单次伤害超阈值（缺省 25% 最大生命）时只反弹超出部分；
         * 与镜鳞（整次 × 百分比）不同，压着阈值打可以规避。reflectImmune 照常生效。 */
        const ov = (def.mechParams && def.mechParams.trialOverflow) || null;
        const ovThreshold = (ov && Number(ov.threshold)) || 0.25;
        if (def.mech.includes('trialOverflow') && att.hp > 0 && !noReflect && dmg > def.maxHp * ovThreshold) {
          const excess = Math.max(1, Math.round(dmg - def.maxHp * ovThreshold));
          r.thornsDmg = (r.thornsDmg || 0) + excess;
          r.noteText = (r.noteText ? r.noteText + '·' : '') + '沉默之壁·溢出反弹'; r.noteSide = def.side;
          reflectHurt(att, excess, r);
        }
        if (def.mech.includes('poison') && !att.dot && chance(30)) {  // 毒藤缠绕：30% 中毒
          att.dot = { pct: 0.03, rounds: 3 };
          r.poisonApplied = true;
          r.noteText = (r.noteText ? r.noteText + '·' : '') + '毒藤缠绕'; r.noteSide = def.side;
        }
        let lsPct = (att.mech.includes('lifesteal') ? 0.30 : 0) + (att.mods && Number(att.mods.lifestealPct) || 0) + setFx(att, 'lifestealPct');
        // 低血吸血：塔 buff 与套装各读各的阈值，按攻击方当前血量判定。
        if (att.mods && att.mods.lowHpLifestealPct && lowHpActive(att)) lsPct += Number(att.mods.lowHpLifestealPct) || 0;
        if (setLowHpActive(att)) lsPct += setFx(att, 'lowHpLifestealPct');
        if (lsPct > 0 && att.hp > 0) {
          const heal = Math.min(att.maxHp - att.hp, healOf(att, dmg * lsPct));
          if (heal > 0) { att.hp += heal; r.lifesteal = (r.lifesteal || 0) + heal; }
        }
      }
      return dmg;
    }

    /* 幻兽协战：回放层认 action:'pet' + petId，按 attacks 第 29+petId 帧播原版动作；
     * isRound:0 表示不占 60 手行动上限。 */
    /** 狂暴门槛是固定 200 血（原版描述），不是比例。 */
    function petRageActive(c) {
      return !!(c && Number(c.petRagePct) > 0 && c.hp > 0 && c.hp < 200);
    }
    // 装死后要补发的协战（技能 2/4），只在还能出手时排队。
    function queueFakeDiePets(c) {
      if (!c || c.hp <= 0 || c.petAfterFakeDie) return;
      for (const p of c.pets || []) {
        if (c.petUsed[p.slot]) continue;
        const rule = petRule(p.skillId);
        if (rule && rule.onFakeDie) { c.petAfterFakeDie = true; return; }
      }
    }
    function petSkillName(id) {
      const info = window.GData && GData.PET_SKILLS && GData.PET_SKILLS[Number(id)];
      return (info && info.name) || '幻兽技能';
    }
    function petSealCandidates(target) {
      const out = [];
      for (const w of target.weapons || []) {
        if (!w || target.petSealWeapons[w.id]) continue;
        out.push({ kind: 'weapon', id: Number(w.id), name: String(w.name || ('武器' + w.id)) });
      }
      /* 优先只封「这个战斗体真的会拿出来用」的技能：玩家的 skillOrder 已经筛过主动技，
       * 避免整蛊专家随机封到力王附体这类被动、看起来完全没生效。 */
      const usableSkills = new Set((target.skillOrder || []).map(Number));
      for (const id of Object.keys(target.skills || {})) {
        const sid = Number(id);
        if (!sid || target.petSealSkills[sid]) continue;
        if (usableSkills.size && !usableSkills.has(sid)) continue;
        let name = '技能' + sid;
        try { const d = skillsMap.getValue(sid); if (d && d.name) name = d.name; } catch (e) {}
        out.push({ kind: 'skill', id: sid, name });
      }
      return out;
    }
    /** 幻兽的「直接减血」：不吃减伤/护盾/暴击，但仍走装死与复活甲同一条致死保护链。 */
    function petDirectDamage(att, def, amount, r) {
      let dmg = Math.max(0, Math.round(Number(amount) || 0));
      if (!def || def.hp <= 0 || dmg <= 0) { r.dmg = 0; return 0; }
      if (def.practice) {
        dmg = practiceHurt(def, dmg);
      } else if (def.hp - dmg <= 0 && def.skills && def.skills[6] && def.silence <= 0 && !def.usedFakeDie) {
        def.usedFakeDie = true;
        dmg = Math.max(0, def.hp - 1);
        def.hp = 1;
        def.stun = 0;
        r.fakeDie = true;
        r.fakeDieSide = def.side;
        queueFakeDiePets(def);
        if (!immediate) immediate = { actor: def, reason: 'fakeDie' };
      } else {
        def.hp = Math.max(0, def.hp - dmg);
        if (def.hp <= 0) tryDeathSave(def, r);
      }
      r.dmg = (r.dmg || 0) + dmg;
      return dmg;
    }
    function petHeal(att, amount, r) {
      if (!att || att.hp <= 0) return 0;
      const heal = Math.min(att.maxHp - att.hp, healOf(att, amount));
      if (heal > 0) att.hp += heal;
      r.healSelf = (r.healSelf || 0) + heal;
      return heal;
    }
    /** 幻兽·凌波微步：每次闪避回 X 点血（可叠加多只）。 */
    function petOnDodge(def, r) {
      if (!def || !(def.petDodgeHeal > 0) || def.hp <= 0 || def.hp >= def.maxHp) return 0;
      const heal = Math.min(def.maxHp - def.hp, healOf(def, def.petDodgeHeal));
      if (heal > 0) {
        def.hp += heal;
        r.dodgeHeal = (r.dodgeHeal || 0) + heal;
        r.dodgeHealPet = '凌波微步';
      }
      return heal;
    }
    /** 所有「闪避」分支统一在这里落标记 + 幻兽回血，别在各处只写 `r.dodge = true`。 */
    function markDodge(r, def) {
      r.dodge = true;
      petOnDodge(def, r);
    }
    /** 幻兽·油光满面：移除自身所有可清除的负面状态。 */
    function petCleanse(c, r) {
      if (!c) return false;
      const had = !!(c.debuffs.power || c.debuffs.agility || c.debuffs.speed || c.dot ||
        c.stun > 0 || c.silence > 0 || c.disarm > 0 || c.stripTurns > 0 ||
        c.petWeakPct > 0 || c.petDotPlus || c.petHealCut ||
        Object.keys(c.petSealWeapons || {}).length || Object.keys(c.petSealSkills || {}).length);
      c.debuffs.power = 0; c.debuffs.agility = 0; c.debuffs.speed = 0;
      c.dot = null; c.stun = 0; c.silence = 0; c.disarm = 0; c.stripTurns = 0;
      c.petWeakPct = 0; c.petDotPlus = false;
      c.petSealWeapons = {}; c.petSealSkills = {};
      if (c.petHealCut) { c.healMul = Math.min(c.healMulBase, c.healMul * 2); c.petHealCut = false; }
      if (had) r.petCleanse = true;
      return had;
    }
    /** 幻兽·张牙舞爪：对手新中的**持续伤害 / 持续负面**（中毒、沉默、缴械、脱装）+1 回合。
     *  ⚠ **眩晕不在此列**：板砖 / 色诱 / 熊掌震地都是「跳过一回合」的控制，
     *  一旦被延长就是「一砖晕两回合」，玩家会看到我方连续两拍不能出手、敌方连着多打两拍
     *  （2026-11 随机挑战录屏反馈）。所以眩晕一律 `Math.max(def.stun, 1)`，不走这个函数。 */
    function petDotRounds(target, rounds) {
      return Math.max(1, Number(rounds) || 1) + (target && target.petDotPlus ? 1 : 0);
    }
    function petRoundBase(actor, pet, rule) {
      return {
        attacker: actor.side, action: 'pet', isRound: 0,
        petId: pet.id, petSlot: pet.slot, petName: pet.name, petGrade: pet.grade, petLevel: pet.level,
        petSkillId: pet.skillId, petSkillName: petSkillName(pet.skillId), petKind: rule.kind,
        noteText: pet.name + '·' + petSkillName(pet.skillId), noteSide: actor.side,
        attackPetIds: String(pet.id),
      };
    }
    /** 行动时的协战：每回合最多一只幻兽出手。
     *  先把所有满足条件的幻兽各掷一次（概率互不影响），再从成功者里随机挑一只 ——
     *  这样队伍里靠后的幻兽不会被前一只的低概率技能长期“卡住”。 */
    function petAssist(actor, target, pushRound) {
      if (!actor || !target || !actor.pets.length || actor.hp <= 0 || target.hp <= 0) return false;
      const ready = [];
      for (const pet of actor.pets) {
        if (actor.petUsed[pet.slot]) continue;
        const rule = petRule(pet.skillId);
        if (!rule || !rule.onAction) continue;
        if (rule.hpBelow && actor.hp >= actor.maxHp * rule.hpBelow) continue;
        const value = petValue(pet.skillId, pet.level);
        if (rule.kind === 'healCut' && (target.petHealCut || target.healMul <= 0)) continue;
        if (rule.kind === 'weak' && target.petWeakPct >= value) continue;
        if (rule.kind === 'seal' && !petSealCandidates(target).length) continue;
        if (rule.kind === 'nextCrit' && actor.petNextCrit) continue;
        if (rule.kind === 'dotPlus' && target.petDotPlus) continue;
        if (rule.kind === 'cleanse' && !(actor.debuffs.power || actor.debuffs.agility || actor.debuffs.speed ||
          actor.dot || actor.stun > 0 || actor.silence > 0 || actor.disarm > 0 || actor.stripTurns > 0 ||
          actor.petWeakPct > 0 || actor.petDotPlus || actor.petHealCut ||
          Object.keys(actor.petSealWeapons || {}).length || Object.keys(actor.petSealSkills || {}).length)) continue;
        if (!chance(petTrigger(pet.skillId, pet.level))) continue;
        ready.push({ pet, rule, value });
      }
      if (!ready.length) return false;
      const chosen = ready.length === 1 ? ready[0] : ready[Math.floor(Math.random() * ready.length)];
      const { pet, rule, value } = chosen;
      actor.petUsed[pet.slot] = true;
      const r = petRoundBase(actor, pet, rule);
      if (rule.kind === 'damage') {
        petDirectDamage(actor, target, value, r);
      } else if (rule.kind === 'healCut') {
        target.petHealCut = true;
        target.healMul = Math.max(0, target.healMul * 0.5);
        r.petHealCut = 1;
      } else if (rule.kind === 'weak') {
        target.petWeakPct = Math.max(target.petWeakPct, value);
        r.petWeakPct = target.petWeakPct;
      } else if (rule.kind === 'seal') {
        const pick = pickOne(petSealCandidates(target));
        if (pick.kind === 'weapon') {
          target.petSealWeapons[pick.id] = true;
          if (target.pendingWeapon && Number(target.pendingWeapon.id) === pick.id) target.pendingWeapon = null;
        } else {
          target.petSealSkills[pick.id] = true;
        }
        r.petSeal = pick;
      } else if (rule.kind === 'nextCrit') {
        actor.petNextCrit = true;
        r.petNextCrit = true;
      } else if (rule.kind === 'cleanse') {
        petCleanse(actor, r);
      } else if (rule.kind === 'dotPlus') {
        target.petDotPlus = true;
        r.petDotPlus = true;
        if (target.dot) target.dot.rounds = Math.max(target.dot.rounds, petDotRounds(target, target.dot.rounds));
        /* 已生效的持续时间类效果一并补 1 回合；**眩晕不补** —— 见 `petDotRounds` 的注释。 */
        if (target.silence > 0) target.silence += 1;
        if (target.disarm > 0) target.disarm += 1;
        if (target.stripTurns > 0) target.stripTurns += 1;
      }
      pushRound(r);
      /* 这一下把对手打进装死时，先让对手的逆向推倒/回光术结算完，再走本回合的主行动；
       * 否则主行动可能直接把 1 血的对手补刀，那两只「装死后发动」的幻兽永远轮不到。 */
      if (target.petAfterFakeDie) flushPetReactions(target, actor, pushRound);
      return true;
    }
    /** 装死之后补发逆向推倒 / 回光术；**同一技能一场只结算一次**。
     *  原版 `petsSkills` 里 maxTimes=1 是按技能记的，所以带 3 只回光术不会回 3 次；
     *  不同技能（例如一只逆向推倒 + 一只回光术）仍然各触发一次。
     *  取队伍顺序里第一只满足条件的（与原版“上阵顺序优先”一致）。 */
    function flushPetReactions(owner, foe, pushRound) {
      if (!owner || !owner.petAfterFakeDie || owner.hp <= 0) return false;
      owner.petAfterFakeDie = false;
      for (const pet of owner.pets) {
        if (owner.petUsed[pet.slot]) continue;
        const rule = petRule(pet.skillId);
        if (!rule || !rule.onFakeDie) continue;
        if (owner.petSkillUsed[pet.skillId]) continue;
        owner.petUsed[pet.slot] = true;
        owner.petSkillUsed[pet.skillId] = true;
        const r = petRoundBase(owner, pet, rule);
        const value = petValue(pet.skillId, pet.level);
        if (rule.kind === 'damage') petDirectDamage(owner, foe, value, r);
        else if (rule.kind === 'healPct') petHeal(owner, owner.maxHp * value / 100, r);
        pushRound(r);
        if (owner.hp <= 0 || foe.hp <= 0) return true;
      }
      return false;
    }

    /** NPC 大招（每场一次）：螳螂低血乱舞、仙鹤开场展翅、熊猫低血震地。 */
    // NPC 大招每场一次：仙鹤开场展翅、螳螂低血乱舞、熊猫低血震地。
    function npcUlt(att, def) {
      const r = { attacker: att.side, action: 'skill', npcSkill: true, ult: true };
      if (att.npcType === 'tl') {
        r.ultName = '疾风镰刀舞'; r.multiHit = 4;
        if (chance(dodgeChance(att, def))) { markDodge(r, def); pushRound(r); return; }
        /* 绝对防御一次出手只判一次：四连击要么整段挡下、要么整段不挡（见 jueDuiDecide）。 */
        const jueDuiLock = jueDuiDecide(def, undefined);
        let total = 0;
        for (let i = 0; i < 4; i++) {
          const rr = { dmg: 0 };
          applyDamage(att, def, Math.round(effPower(att) * 0.36), rr, { action: 'skill', jueDuiLock: jueDuiLock });
          total += rr.dmg;
          if (rr.jueDui) r.jueDui = true;
          if (rr.reboundHurt) { r.reboundHurt = (r.reboundHurt || 0) + rr.reboundHurt; r.jueDui = true; }
          if (rr.fakeDie) inheritFakeDie(r, rr);
          if (rr.fakeDie || def.hp <= 0 || att.hp <= 0) break;
        }
        r.dmg = total; pushRound(r); return;
      }
      if (att.npcType === 'xh') {
        // 仙鹤展翅：开场第一次行动的重击，契合“前期凶猛”
        r.ultName = '仙鹤展翅';
        // 只吃速度的 xhSpeedShare：敌人速度约是力量的 2.3 倍，直接加全额等于白送。
        const raw = Math.round((effPower(att) + effSpeed(att) * RULES.xhSpeedShare) * 1.35);
        if (chance(dodgeChance(att, def))) { markDodge(r, def); pushRound(r); return; }
        applyDamage(att, def, raw, r, { action: 'skill' });
        pushRound(r); return;
      }
      // 熊掌震地：生命低于40%时的重击，震晕对手一回合
      r.ultName = '熊掌震地';
      const raw = Math.round(effPower(att) * 2.2);
      if (chance(dodgeChance(att, def))) { markDodge(r, def); pushRound(r); return; }
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
      // 题面文本写「第 N 回合」，这里统一按 att.npcActs（出手次数）。
      const acts = att.npcActs || 0;
      // 熔核：每过一回合叠一层减伤；第 7 次行动起力/敏/速 +50%（熔核成型）。
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
      // 血牙：每掉 25% 生命，攻击 +20%（越打越猛）—— 逼一波带走
      if (att.mech.includes('trialBloodfang') && att.maxHp > 0) {
        const step = Math.floor((1 - att.hp / att.maxHp) / 0.25);
        if (step > att.mechState.bfStep) {
          const add = step - att.mechState.bfStep;
          att.mechState.bfStep = step;
          att.buffFlat.power += Math.max(1, Math.round(att.mechState.basePower * 0.20)) * add;
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
        def.healMul = 0;                       // 兜底：每回合再压一次（防被别的加成顶回来）
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
      att.npcActs = (att.npcActs || 0) + 1;   // 前 3 次行动 ×1.3；无尽塔由 xhEarlyMul 逐层收回
      const xhEarly = att.npcType === 'xh' && att.npcActs <= 3
        ? (att.xhEarlyMul != null ? att.xhEarlyMul : 1.3) : 1;
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
      const skillIds = Object.keys(att.skills).map(Number).filter((id) => id && !att.petSealSkills[id]);
      const useSkill = skillIds.length > 0 && pickNpcKind() === 'skill';
      const r = { attacker: att.side, action: 'common', npcSkill: false };
      if (useSkill) {
        r.action = 'skill'; r.npcSkill = true;
        const sid = skillIds[0];
        const lv = att.skills[sid];
        let raw;
        if (att.npcType === 'tl') { raw = Math.round(effPower(att) * (0.6 + Math.random() * 0.3)); r.multiHit = 2; } // 螳螂双击
        else if (att.npcType === 'xh') {
          raw = Math.round((effPower(att) + effSpeed(att) * RULES.xhSpeedShare) * (0.9 + lv * 0.1));
          // 只压这一条技能，不改普攻/大招/其它模式；倍率由 endlessXhTune 按绝对层数给。
          if (att.xhSkillMul != null) raw = Math.round(raw * att.xhSkillMul);
        }
        else { raw = Math.round(effPower(att) * (1.3 + lv * 0.1)); } // 熊猫重击
        if (xhEarly !== 1) raw = Math.round(raw * xhEarly); // 仙鹤前期凶猛（无尽塔后期会降到 1）
        if (att.petNextCrit) { att.petNextCrit = false; raw = Math.round(raw * 2.5); r.crit = true; r.petCrit = true; }
        else if (rhythm) { raw = Math.round(raw * 2.5); r.crit = true; }
        // 命中
        if (chance(dodgeChance(att, def))) { markDodge(r, def); pushRound(r); return; }
        /* 绝对防御一次出手只判一次：螳螂双击要么整段挡下、要么整段不挡（见 jueDuiDecide）。 */
        const jueDuiLock = jueDuiDecide(def, undefined);
        let total = 0;
        const hits = r.multiHit || 1;
        for (let i = 0; i < hits; i++) {
          const rr = { dmg: 0 };
          applyDamage(att, def, raw, rr, { action: 'skill', jueDuiLock: jueDuiLock });
          total += rr.dmg;
          if (rr.jueDui) r.jueDui = true;
          if (rr.reboundHurt) { r.reboundHurt = (r.reboundHurt || 0) + rr.reboundHurt; r.jueDui = true; }
          if (rr.thornsDmg) r.thornsDmg = (r.thornsDmg || 0) + rr.thornsDmg;
          if (rr.shellAbsorb) r.shellAbsorb = (r.shellAbsorb || 0) + rr.shellAbsorb;
          if (rr.lifesteal) r.lifesteal = (r.lifesteal || 0) + rr.lifesteal;
          if (rr.guiJia) r.guiJia = rr.guiJia;
          if (rr.fakeDie) inheritFakeDie(r, rr);
          if (rr.deathSave) {
            r.deathSave = true; r.noteText = rr.noteText; r.noteSide = rr.noteSide;
            /* 涅槃的属性加成标记也要一起带上来，否则界面上看不到「复活后变强」这条提示。 */
            if (rr.reviveStatMul) r.reviveStatMul = rr.reviveStatMul;
            /* 涅槃plus 的减伤标记同理（战斗日志要看得见「复活后更抗打」）。 */
            if (rr.reviveTakenMul) r.reviveTakenMul = rr.reviveTakenMul;
          }
          if (rr.crit) r.crit = true;
          if (rr.fakeDie || def.hp <= 0 || att.hp <= 0) break;
        }
        r.dmg = total;
        maybeCounter(att, def, r, 'skill'); // 技能不触发反击
        pushRound(r);
        return;
      }
      // 普攻
      if (chance(dodgeChance(att, def))) { markDodge(r, def); pushRound(r); return; }
      let raw = Math.round(effPower(att) * (0.8 + Math.random() * 0.4));
      if (xhEarly !== 1) raw = Math.round(raw * xhEarly); // 仙鹤前期凶猛（无尽塔后期会降到 1）
      if (att.npcType === 'tl' && att.hp < att.maxHp * 0.25) raw = Math.round(raw * 1.3); // 螳螂低血爆发
      if (att.petNextCrit) { att.petNextCrit = false; raw = Math.round(raw * 2.5); r.crit = true; r.petCrit = true; }
      else if (rhythm) { raw = Math.round(raw * 2.5); r.crit = true; }
      applyDamage(att, def, raw, r, {});
      maybeCounter(att, def, r, 'common');     // NPC 的普攻可以被反击
      pushRound(r);
    }

    /* 反击口径：只有近战武器（'melee'）与普攻（'common'）触发；远程、技能（含防御反击型）都不触发。
     * 这一手已经反伤过（荆棘/绝对防御真打出伤害）也不再反击。trigger 就是这四个字符串。 */
    function maybeCounter(att, def, r, trigger) {
      if (trigger !== 'melee' && trigger !== 'common') return;
      /* 练功木桩不还手：原版 `Stakes.attackBack()` 也是空函数，不能凭空反击。 */
      if (def.practice) return;
      // 被打方用普攻反击；必中近战也能被反击，只有大榔头(2)写明「不会被反击」。
      if (r.fakeDie || def.hp <= 0 || att.hp <= 0) return;
      // 被闪避/被归零的一手没打中，不能触发反击（否则回放先飘闪避再演反击）。
      if (r.dodge || r.firstDodge || r.firstHitZero) return;
      // 荆棘已回应过这一手就不再反击；绝对防御挡下仍按 25%（熊猫 45%）反击。
      if (r.thornsDmg || (r.reboundHurt && !r.jueDui)) return;
      /* 49「基础反击率效果提升N%」按原版「反击几率加 N%」的加点口径叠加（25/45 基线 + N 个百分点）。 */
      let chanceBase = 25 + Math.max(0, Number(effect(def, 49)) || 0);
      if (def.npcType === 'xm') chanceBase = 45 + Math.max(0, Number(effect(def, 49)) || 0);
      if (!chance(clamp(chanceBase, 0, 100))) return;
      let raw = Math.round(effPower(def) * (0.6 + Math.random() * 0.4) * (1 + effect(def, 5) / 100));
      if (skill(def, 24)) raw = Math.round(raw * (1 + 0.5 + 0.06 * (Math.min(skill(def, 24), 10) - 1) + trueVal(24, skill(def, 24)) / 100)); // 致命反击
      /* 反击不可闪避、不吃先机预判/风影身法（noDodge），也不被绝对防御/荆棘弹回反击者（noReflect）；
       * 反击无视装死（直接打到 0 血），涅槃/金蝉脱壳仍照常判定。 */
      const counter = { action: 'common' };
      applyDamage(def, att, raw, counter, { noDodge: true, noReflect: true, counter: true, ignoreFakeDie: true });
      r.counterDmg = counter.dmg;
      // 反击伤害 = 掉血 + 被护盾吸收，回放按这个总和飘红字。
      if (counter.shellAbsorb) r.counterAbsorb = counter.shellAbsorb;
      // 只有整下 0 伤害才算「被挡下」；龟甲只减一部分时仍按正常反击飘字。
      if (!(counter.dmg > 0)) {
        if (counter.jueDui || counter.guiJia) {
          r.counterBlocked = counter.jueDui ? '绝对防御' : '龟甲术';
        } else if (counter.shellAbsorb) {
          r.counterBlocked = '护盾';
        }
      }
      if (counter.fakeDie) {
        r.counterFakeDie = true;
        /* 反击里也可能出装死（反击伤害本身把出手方打到装死）—— 小回合也要记清是谁装的死。 */
        if (counter.fakeDieSide != null) r.counterFakeDieSide = counter.fakeDieSide;
      }
      if (counter.deathSave) {
        /* 反击触发涅槃 / 金蝉脱壳时，塔的死亡统计也要看得到（与普通回合同一口径）。 */
        r.counterDeathSave = true;
        if (counter.revive) r.counterRevive = true;
        if (counter.noteText) { r.noteText = (r.noteText ? r.noteText + '·' : '') + counter.noteText; r.noteSide = counter.noteSide; }
      }
      if (counter.reboundHurt) r.counterRebound = counter.reboundHurt;
      if (counter.thornsDmg) r.counterThorns = counter.thornsDmg;
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
      // 整蛊专家封住的武器/技能整场不可用；后面的选取只看过滤后的池子。
      const usableWeapons = att.weapons.filter((w) => w && !att.petSealWeapons[w.id] &&
        (weaponWeight(att, w) > 0 || (att.pendingWeapon && att.pendingWeapon.id === w.id)));
      const canWeapon = usableWeapons.length > 0 && att.disarm <= 0;
      /* 可用技能从 fighter 实际拥有的技能筛（att.skillOrder），不能用玩家硬编码表（会漏 5/20）；
       * 排除：小宇宙每场一次、来点松果满血不放、本回合已用过的不能再用。 */
      const actives = (att.skillOrder || ACTIVE_SKILLS).filter((id) => att.skills[id] &&
        !att.petSealSkills[id] &&
        !(id === 14 && att.usedCosmos) && !(id === 17 && att.hp >= att.maxHp) &&
        !(att.pattern && att.skillCd && att.skillCd[id] > 0) &&        // 冷却中（只对固定循环的敌人生效）
        !att.turnSkills[id] && skillWeight(att, id) > 0);
      const canSkill = actives.length > 0 && att.silence <= 0;
      const forceCosmos = !!(att.mods && att.mods.cosmosFirst) && !att.usedCosmos && canSkill &&
        actives.some((id) => Number(id) === 14);
      let kind;
      if (forceCosmos) {
        kind = 'skill';
      } else if (att.pattern) {
        // 固定循环：这一步用不了就顺延到下一个能用的，不会因缴械/沉默卡住。
        const want = att.pattern[att.patternStep % att.pattern.length];
        att.patternStep++;
        if (want === 'weapon' && !canWeapon) kind = canSkill ? 'skill' : 'common';
        else if (want === 'skill' && !canSkill) kind = canWeapon ? 'weapon' : 'common';
        else kind = (want === 'weapon' || want === 'skill') ? want : 'common';
      } else {
        kind = pickKind(att, canWeapon ? usableWeapons : [], canSkill ? actives : []);
      }
      if (att.pendingWeapon && canWeapon && !att.petSealWeapons[att.pendingWeapon.id]) kind = 'weapon';

      if (kind === 'weapon') {
        const prepared = att.pendingWeapon && !att.petSealWeapons[att.pendingWeapon.id] ? att.pendingWeapon : null;
        // 选武器：普通武器用过 repeatWeapon；投掷前两次 100、第三次起 repeatWeapon。
        let w;
        if (prepared) w = prepared;
        else if (usableWeapons.length > 1 && !att.pattern) w = pickWeapon(att, usableWeapons);
        else w = usableWeapons[0];
        att.usedWeapons[w.id] = true;
        att.weaponUseCount = att.weaponUseCount || {};
        att.weaponUseCount[w.id] = Math.max(0, Math.floor(Number(att.weaponUseCount[w.id]) || 0)) + 1;
        att.lastWeaponId = w.id;
        att.lastWeaponTurn = Number(att.turnId) || 0;
        att.pendingWeapon = null;
        if (w.id === 1 && !prepared) {
          att.pendingWeapon = w;
          pushRound({ attacker: att.side, action: 'rest', preparingWeapon: w.id });
          return;
        }
        r.action = 'weapon'; r.id = w.id; r.level = w.level; r.wtype = w.type;
        /* 塔 buff 的「按武器次数」两个口径（蓄力那回合上面已 return，不算使用）：
       * weaponFreeUses 前 N 次不消耗回合；weaponBoostUses 前 N 次加成+必中+免反伤，之后衰减。 */
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
        raw = Math.round(raw * (1 + effPower(att) / 120));
        // 武器好手是额外固定伤害，不随被菜刀削弱的力量一起下降。
        if (skill(att, 5)) raw += (GData.passiveBonus(5, skill(att, 5)) * heroBaseMul(att, skill(att, 5))) * (1 + effect(att, 31) / 100);
        /* 武器专属词条：1~15 号按 id+11 取 12~26；16 沉默之斧 = 42、17 双刃剑 = 43。 */
        const specificId = w.id <= 15 ? w.id + 11 : (w.id === 16 ? 42 : w.id === 17 ? 43 : 0);
        raw = Math.round(raw * (1 + (effect(att, w.type === '投掷' ? 7 : 6) + (specificId ? effect(att, specificId) : 0)) / 100));
        // 闪亮登场：强化期内的那几次武器，攻击再 +N%
        if (boosted) {
          raw = Math.round(raw * (1 + (Number(att.mods.weaponBoostPowerMul) || 0)));
          // 面板看不出这次吃没吃到强化，测试与战报靠这个标记判断。
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
          markDodge(r, def);
          grantFreeTurn();
          pushRound(r);
          att.weaponBoostImmune = false;
          if (r.actAgain && att.hp > 0 && def.hp > 0 && !immediate) immediate = { actor: att, reason: 'freeAction' };
          return;
        }
        // 暴击（真·皮糙肉厚同样按「减少 N 个百分点」压制武器暴击率）
        let cc = critChanceAgainst(att, def);
        if (w.id === 11) cc += weaponEffect(w, 20, 2, 3) + trueW(w, 'crit');   // 激光剑（真级每级 +3% 暴击）
        cc = clamp(cc, 0, RULES.critCap);
        if (att.petNextCrit) {
          att.petNextCrit = false;
          let mult = 2 + (Math.random() < 0.5 ? 0 : 1) + effect(att, 45) / 100 + effect(att, w.type === '投掷' ? 3 : 2) / 100 + critDmgBonus(att);
          raw = Math.round(raw * mult); r.crit = true; r.petCrit = true;
        } else if (chance(cc)) {
          /* 原版暴击：2~3 倍；真·暴击再按 2/5/9/14/20% 判一次 4 倍。 */
          let mult = 2 + (Math.random() < 0.5 ? 0 : 1) + effect(att, 45) / 100 + effect(att, w.type === '投掷' ? 3 : 2) / 100 + critDmgBonus(att);
          const quad = trueVal(9, att.skills[9]);
          if (quad > 0 && chance(quad)) { mult = 4 + effect(att, 45) / 100 + effect(att, w.type === '投掷' ? 3 : 2) / 100 + critDmgBonus(att); r.crit4 = true; }
          raw = Math.round(raw * mult); r.crit = true;
        }
        // 连击/三扔
        let hits = 1;
        if (w.id === 4 && chance(weaponEffect(w, 10, 2, 5) + trueW(w, 'combo'))) hits = 2;   // 西瓜刀（真级 +5% 连击）
        if (w.id === 10 && chance(weaponEffect(w, 2, 2) + trueW(w, 'triple'))) hits = 3;   // 流星锤（2% + 2%/级；真级 +3% 三扔）
        r.hits = hits;
        /* 绝对防御一次出手只判一次：连击 / 三扔整段挡下（投掷类本来就不触发，判出来是 null）。
         * 以前每段各判一次 —— 第 1 段被挡、第 2 段照打，玩家看到「绝对防御」却仍然掉血。 */
        const jueDuiLock = jueDuiDecide(def, w.type);
        let total = 0, landedHits = 0, dodgedHits = 0;
        for (let i = 0; i < hits; i++) {
          const rr = { dmg: 0, crit: r.crit, crit4: r.crit4 };
          applyDamage(att, def, raw, rr, { ignoreFakeDie: w.id === 7 || trueW(w, 'ignoreFakeDie') > 0, action: 'weapon', weaponType: w.type, jueDuiLock: jueDuiLock });
          total += rr.dmg;
          if (rr.dmg > 0) landedHits++;
          if (rr.dodge) dodgedHits++;
          /* r.jueDui 必须独立于 reboundHurt 传播：投掷类被挡下时刻意不反弹，
         * 但动画（battle.js 的 skill_16）与塔统计都靠它判断这次被挡下。 */
          if (rr.jueDui) r.jueDui = true;
          if (rr.reboundHurt) r.reboundHurt = (r.reboundHurt || 0) + rr.reboundHurt;
          if (rr.thornsDmg) r.thornsDmg = (r.thornsDmg || 0) + rr.thornsDmg;
          if (rr.shellAbsorb) r.shellAbsorb = (r.shellAbsorb || 0) + rr.shellAbsorb;
          if (rr.lifesteal) r.lifesteal = (r.lifesteal || 0) + rr.lifesteal;
          if (rr.guiJia) r.guiJia = rr.guiJia;
          if (rr.fakeDie) inheritFakeDie(r, rr);
          if (rr.deathSave) {
            r.deathSave = true; r.noteText = rr.noteText; r.noteSide = rr.noteSide;
            /* 涅槃的属性加成标记也要一起带上来，否则界面上看不到「复活后变强」这条提示。 */
            if (rr.reviveStatMul) r.reviveStatMul = rr.reviveStatMul;
            /* 涅槃plus 的减伤标记同理（战斗日志要看得见「复活后更抗打」）。 */
            if (rr.reviveTakenMul) r.reviveTakenMul = rr.reviveTakenMul;
          }
          if (rr.fakeDie || def.hp <= 0 || att.hp <= 0) break;
        }
        r.dmg = total;
        /* 每一段都被归零才算闪避（回放播闪避、也不触发对方反击）；
         * 只要有一段真的打中就不算。 */
        if (!landedHits && dodgedHits) r.dodge = true;
        // 武器特效
        if (w.id === 3 && att.hp > 0) { att.swordDodge = Math.max(att.swordDodge, weaponEffect(w, 3, 3)); r.dodgeBuff = att.swordDodge; }
        // 词条 44：龟甲术真挡下时，吉祥三宝的降属性按 N% 削减。
        const shellAntiDrop = r.guiJia > 0 && skill(def, 7) && def.silence <= 0
          ? clamp(Number(effect(def, 44)) || 0, 0, 100) / 100 : 0;
        const dropMul = 1 - shellAntiDrop;
        if (shellAntiDrop > 0) r.debuffCut = Math.round(shellAntiDrop * 100);
        if (def.hp > 0 && !r.fakeDie) {
          /* debuffStat 给战斗动画用（debuffText 是中文）：经典战斗靠它飘原版状态图标，
         * 中文串匹配太脆，所以显式带出降的是哪一项。 */
          if (w.id === 5) { def.debuffs.agility = Math.max(def.debuffs.agility, weaponEffect(w, 10, 2) * dropMul); r.debuffText = '敏捷降低！'; r.debuffStat = 'agility'; }
          if (w.id === 6) { def.debuffs.speed = Math.max(def.debuffs.speed, weaponEffect(w, 10, 2) * dropMul); r.debuffText = '速度降低！'; r.debuffStat = 'speed'; }
          if (w.id === 8) { def.debuffs.power = Math.max(def.debuffs.power, weaponEffect(w, 10, 1) * dropMul); r.debuffText = '力量降低！'; r.debuffStat = 'power'; }
          if (w.id === 12 && chance(35)) { def.dot = { dmg: weaponEffect(w, 4, 3, 6) + trueW(w, 'dot'), rounds: petDotRounds(def, 4) }; r.dotApplied = true; }
          if (w.id === 13 && chance(weaponEffect(w, 10, 3, 3) + trueW(w, 'stun'))) { def.stun = Math.max(def.stun, 1); r.stunApplied = true; }
          if (w.id === 16 && chance(weaponEffect(w, 10, 4, 4) + trueW(w, 'silence'))) { def.silence = Math.max(def.silence, petDotRounds(def, 4)); r.silenceApplied = true; }
        }
        /* 忍者镖吸血按**减伤前**的武器伤害算（抓包 42/34%≈124，按最终值只会回更少），
         * 只在真的打中（total > 0）时触发。 */
        if (w.id === 14 && att.hp > 0 && total > 0) {
          const pct = weaponEffect(w, 10, 4) + trueW(w, 'lifesteal');
          const heal = Math.min(att.maxHp - att.hp, healOf(att, raw * pct / 100));
          att.hp += heal;
          r.lifesteal = (r.lifesteal || 0) + heal;
        }
        if (w.id === 17 && att.hp > 0) { const self = Math.round(att.hp * 0.1); att.hp -= self; r.selfBurn = self; tryDeathSave(att, r); }
        // 反击（只有大榔头 2 的说明写“不会被反击”；死神镰刀 15 只是必中，仍可被反击）
        maybeCounter(att, def, r, (w.type === '近战' && w.id !== 2) ? 'melee' : 'ranged');
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
            /* 原表「10 级每级增加伤害 N 点」：伤害只到 10 级，真化只加脱装几率。 */
            const raw = Math.round((R(15, 25) + 7 * (Math.min(lv, 10) - 1)) * (1 + effect(att, 33) / 100));
            if (chance(dodgeChance(att, def))) { att.mustHitNext = false; markDodge(r, def); break; }
            applyDamage(att, def, raw, r, {});
            /* ⚠ 「先机预判」这类**在 applyDamage 里才落 r.dodge** 的闪避，上面的
             * `dodgeChance` 预判是抓不到的（那一次已经算命中并进了伤害链）。
             * 二次判定必须再看一次 r.dodge —— 否则动画显示闪避，眩晕 / 脱装却照样挂上：
             * 用户实测「妖狐魅惑被闪避后仍然被卸甲」就是这一条。 */
            if (def.hp > 0 && !r.fakeDie && !r.dodge) {
              def.stun = Math.max(def.stun, 1); r.stunApplied = true;
              /* 原表：真1~真5 = 8/16/28/40/56（%）。trueVal 已经是百分数，不能再 ×100。 */
              const stripPct = trueVal(8, lv);
              if (stripPct > 0 && chance(stripPct)) {
                def.stripTurns = petDotRounds(def, 4);
                r.stripApplied = Math.round(stripPct);
                r.specialEffect = 1;          // 原版日志字段：中了脱装备特效
              }
            }
            break;
          }
          case 12: { // 野球拳（真级：有几率再打一次）
            /* 原表「10 级每级伤害提高 N%」：倍率只到 10 级，真化只加「再打一次」几率。 */
            const raw = Math.round((effPower(att) + effSpeed(att)) * (1.2 + 0.15 * (Math.min(lv, 10) - 1)));
            if (chance(dodgeChance(att, def) * 0.7)) { att.mustHitNext = false; markDodge(r, def); break; }
            applyDamage(att, def, raw, r, {});
            const doublePct = trueVal(12, lv);
            if (doublePct > 0 && def.hp > 0 && att.hp > 0 && chance(doublePct)) { r.actAgain = true; r.doubleHit = true; }
            break;
          }
          case 14: { // 小宇宙爆发
            att.usedCosmos = true;
            const cosmosPct = ((Math.min(lv, 10) + trueVal(14, lv)) / 100) * heroBaseMul(att, lv);
            for (const [key, id] of [['power', 36], ['agility', 37], ['speed', 38]]) {
              att.buffFlat[key] = Math.max(1, att.baseStats[key] * cosmosPct) + effect(att, id);
            }
            r.buffUp = true; r.noDmg = true; r.actAgain = true;
            r.statBonus = { ...att.buffFlat };
            break;
          }
          case 15: { // 通灵召唤
            const raw = Math.round(def.hp * (35 + 2 * (Math.min(lv, 10) - 1)) / 100) + 7 + effect(att, 39) + trueVal(15, lv);
            if (chance(dodgeChance(att, def))) { att.mustHitNext = false; markDodge(r, def); break; }
            applyDamage(att, def, raw, r, { ignoreFakeDie: false });
            break;
          }
          case 17: { // 来点松果：满血时不会进候选池；二次及以后权重 1
            const healBase = (20 + 2 * (Math.min(lv, 10) - 1) + trueVal(17, lv)) * Math.max(1, effect(att, 40));
            const heal = Math.min(att.maxHp - att.hp, healOf(att, healBase * heroBaseMul(att, lv)));
            att.hp += heal;
            r.healSelf = heal; r.noDmg = true; r.actAgain = true;
            break;
          }
          case 18: { // 吸铁大法
            /* 原版 `skillsArray` 18 号「吸铁大法」没有“必中”：这里必须先走 `dodgeChance`。
             * 只有师父驾到（13）给的下一次攻击必中 / 塔 buff 的 `mustHitNext` 才会让这一下必中；
             * 13 的“下次攻击必中”是技能 13 的效果，不是吸铁本身。 */
            const raw = Math.round((R(5, 20) + 4 * (Math.min(lv, 10) - 1)) * (1 + effect(att, 41) / 100));
            if (chance(dodgeChance(att, def))) { att.mustHitNext = false; markDodge(r, def); break; }
            /* 用户 2026-10-29 口径：吸铁大法伤害无视装死；技能介绍不写。 */
            applyDamage(att, def, raw, r, { ignoreFakeDie: true });
            const disarmPct = 10 + 4 * (Math.min(lv, 10) - 1) + trueVal(18, lv);
            if (chance(disarmPct)) {
              def.disarm = Math.max(def.disarm, petDotRounds(def, 4));
              r.disarmApplied = true;
              r.specialEffect = 1;          // 原版日志字段：中了缴械特效
            }
            break;
          }
          case 23: { // 幸运一击
            const mult = R(1, 6);
            const raw = (15 + 8 * (Math.min(lv, 10) - 1) + trueVal(23, lv) + Math.max(0, Number(effect(att, 48)) || 0)) * mult;
            r.multiple = mult;
            /* 原版协议第 15 字段 `boomCount` = 这一拍分裂成几个球（`MainMovie.as:17983`
             * `_loc1.boomCount = _loc2[15]`，`sprite6122` 第 31 帧 `_root.boom(ball, count)`）。
             * 幸运一击的伤害就是"打 mult 下"，所以球数 = mult；经典战斗层按它做多球分裂演出。 */
            r.boomCount = mult;
            applyDamage(att, def, raw, r, {});
            break;
          }
        }
        if (freeSkill) { att.usedFreeSkill = true; r.actAgain = true; }
          // 技能一律不触发反击（含防御反击型技能）。
        maybeCounter(att, def, r, 'skill');
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
      if (dodge) { markDodge(r, def); pushRound(r); return; }
      let raw = Math.round(effPower(att) * (0.8 + Math.random() * 0.4) * (1 + effect(att, 5) / 100));
      if (att.petNextCrit) {
        att.petNextCrit = false;
        raw = Math.round(raw * (2 + Math.random() + effect(att, 45) / 100 + effect(att, 1) / 100 + critDmgBonus(att)));
        r.crit = true; r.petCrit = true;
      } else if (chance(critChance(att))) {
        raw = Math.round(raw * (2 + effect(att, 45) / 100 + effect(att, 1) / 100 + critDmgBonus(att))); r.crit = true;
      }
      applyDamage(att, def, raw, r, {});
      maybeCounter(att, def, r, 'common');     // 普攻可以被反击
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

    /* E17「假如我直接赢」：开战把敌方血量清零，不走免死，主循环之前执行 → winner 直接判我方胜。
     * 例外只有魔王 bossLife 的涅槃plus（照常吃一条命），普通敌人的装死/涅槃无效。 */
    if (A.mods && A.mods.openKill && B.hp > 0) {
      const dmg = Math.max(1, Math.round(B.hp));
      const saves = (B.mods && Array.isArray(B.mods.deathSaves)) ? B.mods.deathSaves : [];
      const bossLife = saves.findIndex((sv) => sv && sv.bossLife);
      B.hp = 0;
      /* E17 不是普通伤害：敌方护盾也作废，否则 HUD 会留盾；魔王还能复活则保留玩家护盾，
       * 真的结束战斗时玩家护盾也归零。 */
      B.shell = 0;
      B.shellCharges = 0;
      const rr = { attacker: 0, action: 'dot', dmg: dmg, noteText: '假如我直接赢', noteSide: 0 };
      if (bossLife >= 0) consumeDeathSave(B, saves.splice(bossLife, 1)[0], rr);
      if (B.hp <= 0 && !godSave(B)) { A.shell = 0; A.shellCharges = 0; }
      pushRound(rr);
    }

    // ---- 主循环：速度行动条 ----
    let immediate = null;
    /* 只统计**行动条正常选出的出手**（不含小宇宙 / 装死这种 immediate 追加行动）：
     * 同一方连续 5 次后，第 6 次强制推进给另一方。 */
    let lastApActor = null, apRun = 0;
    /* 60 手打满按血量比例判负，但整场没掉到 0 血 → 免死条目一次都不会触发；
     * 所以玩家侧被判负且还有 deathSaves 时消耗一条（同 consumeDeathSave）、重开 60 手窗口。
     * 只对玩家（A）生效，敌人 bossLife 与木桩战不参与。 */
    function tryTimeoutRevive() {
      if (practice) return false;
      if (A.hp <= 0 || B.hp <= 0) return false;
      if (A.hp / A.maxHp >= B.hp / B.maxHp) return false;          // 只有被判负的玩家侧才需要救
      const saves = A.mods && Array.isArray(A.mods.deathSaves) ? A.mods.deathSaves : null;
      if (!saves || !saves.length) return false;
      // 走 regen 事件（两套播放器都会 applyHp 飘绿字）；isRound:0 不占剩余回合。
      const rr = { attacker: A.side, action: 'regen', isRound: 0, timeoutRevive: 1 };
      const before = A.hp;
      consumeDeathSave(A, saves.shift(), rr);
      rr.heal = Math.max(0, A.hp - before);
      pushRound(rr);
      return true;
    }
    while (A.hp > 0 && B.hp > 0) {
      // 一个窗口 60 手；打满先补装死协战（可能改血量比例），再试涅槃加时，成功就手数归零。
      if (actions >= actionCap) {
        flushPetReactions(A, B, pushRound);
        flushPetReactions(B, A, pushRound);
        if (A.hp <= 0 || B.hp <= 0) break;
        if (!tryTimeoutRevive()) break;
        actions = 0;
      }
      const followup = immediate;
      let actor = followup && followup.actor;
      immediate = null;
      if (!actor) {
        // 木桩不还手：直接让非木桩一方出手，固定回合数就是玩家出手次数。
        if (practice) {
          actor = practice === A ? B : A;
        } else {
          // 先结清已满的行动条，避免高速度玩家无限抢占对方行动。
          if (A.ap < 100 && B.ap < 100) {
            const elapsed = Math.min((100 - A.ap) / effSpeed(A), (100 - B.ap) / effSpeed(B));
            A.ap += elapsed * effSpeed(A); B.ap += elapsed * effSpeed(B);
          }
          let pick = A.ap >= B.ap ? A : B;
          /* 连续第 5 次后把时间推进到「另一方满 100」并确保它出手；先手方压在 99，
           * 避免下一拍又立刻抢回去。 */
          if (pick === lastApActor && apRun >= RULES.maxConsecutiveActions) {
            const other = pick === A ? B : A;
            const gap = Math.max(0, 100 - other.ap);
            if (gap > 0) {
              const elapsed = gap / effSpeed(other);
              other.ap += elapsed * effSpeed(other);
              pick.ap += elapsed * effSpeed(pick);
            }
            other.ap = Math.max(other.ap, 100);
            if (pick.ap >= 100) pick.ap = 99;
            pick = other;
          }
          actor = pick;
          actor.ap -= 100;
          if (actor === lastApActor) apRun++;
          else { lastApActor = actor; apRun = 1; }
        }
      }
      actions++;
      actor.turnId = Number(actor.turnId || 0) + 1;
      actor.acts = Number(actor.acts || 0) + 1;      // 出手次数（塔 buff「开局狂热」按它分档）
      actor.turnSkills = {};
      for (const cdId of Object.keys(actor.skillCd || {})) if (actor.skillCd[cdId] > 0) actor.skillCd[cdId]--;
      const def = actor === A ? B : A;
      // 木桩上一拍掉的血在下一拍开头回满，回放用 practiceHeal 飘字。
      if (def.practice && def.hp < def.maxHp) {
        const heal = Math.max(0, def.maxHp - def.hp);
        def.hp = def.maxHp;
        def.practiceHealPending = (Number(def.practiceHealPending) || 0) + heal;
      }
      // 装死触发的协战先补发再走本回合行动；它们不占行动次数、不改变出手者。
      flushPetReactions(A, B, pushRound);
      flushPetReactions(B, A, pushRound);
      if (A.hp <= 0 || B.hp <= 0) break;
      /* 回合开始类增益（越战越勇 / 后发制人 / 玉石俱焚）：每场战斗结束自动清零。 */
      applyRoundAuras(actor, def, pushRound);
      // 血蚀印记：每回合按敌人**当前生命** N% 扣血（越打越少），走 dot 事件。
      const drainPct = Math.max(0, Number(actor.mods && actor.mods.enemyHpDrainPct) || 0);
      if (drainPct > 0 && def.hp > 0) {
        const drainDmg = Math.max(1, Math.round(def.hp * Math.min(1, drainPct)));
        def.hp = Math.max(0, def.hp - drainDmg);
        const drainRound = { attacker: actor.side, action: 'dot', dmg: drainDmg,
          noteText: (actor.mods && actor.mods.enemyHpDrainNote) || '血蚀' };
        tryDeathSave(def, drainRound);
        pushRound(drainRound);
        if (def.hp <= 0) { if (godSave(def)) def.hp = 1; else break; }
      }
      // 回合开始回复（药师「百草回春」/ 塔 buff「活血丹」「回春术」）
      const regenPct = (actor.mech.includes('regen') ? 0.03 : 0) + (actor.mods && Number(actor.mods.regenPct) || 0) + setFx(actor, 'regenPct');
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
      // 持续伤害按中招者的出手计数（含小宇宙追加行动），共 4 次。
      if (actor.dot) {
        const dotDmg = actor.dot.pct ? Math.max(1, Math.round(actor.hp * actor.dot.pct)) : actor.dot.dmg;
        actor.hp -= dotDmg;
        const dotRound = { attacker: actor.side, action: 'dot', dmg: dotDmg, selfDot: true };
        tryDeathSave(actor, dotRound); // 中毒致死也过复活甲
        pushRound(dotRound);
        actor.dot.rounds--;
        if (actor.dot.rounds <= 0) actor.dot = null;
        if (actor.hp <= 0) break;
      }
      if (actor.restNext) { actor.restNext = false; pushRound({ attacker: actor.side, action: 'rest' }); if (!followup) tickRestrictions(actor); continue; }
      if (actor.stun > 0) { actor.stun--; pushRound({ attacker: actor.side, action: 'stunned' }); if (!followup) tickRestrictions(actor); continue; }

      // 幻兽协战：每回合最多一只、不占行动次数，之后照常走本回合出手。
      if (petAssist(actor, def, pushRound)) {
        if (A.hp <= 0 || B.hp <= 0) {
          if (A.hp <= 0 && godSave(A)) A.hp = 1;
          if (B.hp <= 0 && godSave(B)) B.hp = 1;
          if (A.hp <= 0 || B.hp <= 0) break;
        }
      }

      if (actor.npcType) { npcAction(actor, def); npcMechAfter(actor, def); }
      else {
        // 题面对手是玩家式 AI（无 npcType）：出手前先数 npcActs 再挂机制（玩家 mech 为空）。
        if (actor.mech.length) { actor.npcActs = (actor.npcActs || 0) + 1; npcMechTurnStart(actor, def); }
        playerLikeAction(actor, def);
        if (actor.mech.length) npcMechAfter(actor, def);
        // 蚀骨：玩家每次出手叠 1 层攻击 −3%，层数记在对手 mechState.erode。
        if (def.mech.includes('trialErode') && actor.hp > 0) {
          const stacks = Math.min(RULES.erodeMax, def.mechState.erode + 1);
          if (stacks > def.mechState.erode) {
            def.mechState.erode = stacks;
            actor.buffFlat.power -= Math.max(1, Math.round(actor.mechState.basePower * 0.03));
          }
        }
      }
      if (!followup) tickRestrictions(actor);
      // 无敌兜底：吸血/自伤/反伤等旁路也不会把玩家打死。
      if (A.hp <= 0 && godSave(A)) A.hp = 1;
      if (B.hp <= 0 && godSave(B)) B.hp = 1;
    }

    // 60 手卡在装死那一拍时，装死触发的协战仍要补发（可能改变胜负）。
    flushPetReactions(A, B, pushRound);
    flushPetReactions(B, A, pushRound);

    let winner;
    if (A.hp <= 0 && B.hp <= 0) winner = 0;
    else if (B.hp <= 0) winner = 0;
    else if (A.hp <= 0) winner = 1;
    // 超时按血量比例判负（涅槃加时窗口已在上面用完）。
    else winner = A.hp / A.maxHp >= B.hp / B.maxHp ? 0 : 1;

    return { rounds, winner, maxHp: [A.maxHp, B.maxHp], startShell: startShell, names: [A.name, B.name] };
  }

  window.Sim = {
    simulate, rules: RULES,
    // 幻兽数值/触发概率的唯一出口（State 牧场详情读 GData 同一份）。
    petSkillValueOf: petValue, petSkillTriggerOf: petTrigger,
    // 出手权重（供 tools/test-combat-rules.cjs 直接校验）。
    actionWeights: { skill: skillWeight, weapon: weaponWeight },
    // 有效属性唯一出口（测试核对终乘加成乘在哪一层）。
    effStatsOf: (c) => ({ power: effPower(c), agility: effAgility(c), speed: effSpeed(c) }),
    // 回合开始增益的纯函数版（测试核对后发制人的镜像削弱）。
    _applyRoundAuras: applyRoundAuras,
    // 各技能「二次及以后」的出手概率（%）。
    repeatRateOf, skillUseCountOf,
    // 出手类型的三份权重与占比（测试核对徒手份额下限）。
    kindWeights,
    // 武器选择纯函数。
    pickWeapon,
    // 熔核减伤曲线（纯函数）。
    coreReduceOf, coreMaxStacks,
    // 防御被动的触发概率与被动加成读取（测试确定性核对）。
    jueDuiChanceOf, shellChanceOf, passiveSkillBoost,
    // 减伤链即时结算（纯函数），测试据此确定性命中/反弹。
    dmgReduce,
    // 闪避率唯一出口（att 攻击方 / def 挨打方）。
    dodgeChanceOf: (att, def) => dodgeChance(att, def),
    // 暴击率/暴击伤害唯一出口（70% 上限 + 1:1 溢出）。
    critChanceOf: (att) => critChance(att),
    // 对某个对手的最终暴击率（含真·皮糙肉厚压制）。
    critChanceVs: critChanceAgainst,
    critDmgBonusOf: (att) => critDmgBonus(att),
    critCap: RULES.critCap,
    // 低血减伤即时结算（纯函数）。
    lowHpTakenDamage,
    defenseCaps: { again: BOOSTED_AGAIN_CAP, first: BOOSTED_FIRST_CAP },
  };
})();
