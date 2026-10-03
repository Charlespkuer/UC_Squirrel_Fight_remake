/* Run: node tools/test-combat-rules.cjs (Node built-ins only).
 * Evidence: references/new/reference.md and 攻略.md; original GameDict.
 * Deterministic random streams verify event ordering and resource-independent
 * combat rules. Server-only probabilities remain explicit Sim.rules defaults.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
/** 项目根：从脚本所在目录往上找含 index.html 的那一层（tools/ 放哪都能用）。 */
function findRoot(start) {
  const fsx = require('node:fs'), px = require('node:path');
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fsx.existsSync(px.join(d, 'index.html'))) return d;
    const up = px.dirname(d);
    if (up === d) break;
    d = up;
  }
  return px.resolve(start, '..');
}

const root = findRoot(__dirname);
function game(fallback = 0.5, sequence = []) {
  const c = { console }; c.window = c;
  vm.createContext(c);
  // 真·武器/真·技能的表在 gamedata.js 里（sim.js 通过 window.GData 读它）
  for (const file of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/sim.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  }
  const math = vm.runInContext('Math', c);
  math.random = () => sequence.length ? sequence.shift() : fallback;
  return c;
}
const fighter = (extra = {}) => ({ name: '测试松鼠', level: 20, power: 10, agility: 10, speed: 10, hp: 10000, weapons: [], skills: [], ...extra });
/** 统计类用例要真随机：game() 会把 Math.random 钉成常数（用来验证事件顺序），
 *  概率类断言在常数下会退化成「永远成立」或「永远不成立」。 */
function randomGame() { const c = game(); vm.runInContext('Math', c).random = Math.random; return c; }
const rounds = (g, a = {}, b = {}, options) => g.Sim.simulate(fighter(a), fighter(b), options).rounds;
const tests = [];
const test = (name, run) => tests.push([name, run]);

test('师父在生命不高于 50% 时才尝试救场，每场仅一次，使用真实师父等级', () => {
  const g = game();
  g.Debug = { enabled: (key) => key === 'godMode' };
  assert.equal(g.Sim.rules.masterHpRatio, 0.50, '阈值已上调到 50%');
  const events = rounds(g, { hp: 100, power: 1, skills: ['13:1'], masterLevel: 7 }, { power: 35, speed: 11 }, { masterChance: 100 });
  const index = events.findIndex((r) => r.id === 13);
  assert.ok(index > 0);
  assert.ok(events[index - 1].hpAfter[0] <= 50, '只在 50% 线以下救场：' + events[index - 1].hpAfter[0]);
  assert.equal(events[index].healSelf, 28);
  assert.equal(events.filter((r) => r.id === 13).length, 1);
  assert.ok(events.length > index + 10, '长战斗中反复进入低血，仍不会再次呼叫');
});

test('高血量、无师父或未通过概率判定时，不会呼叫师父', () => {
  for (const masterLevel of [0, undefined]) {
    const g = game();
    const events = rounds(g, { hp: 100, power: 1, skills: ['13:1'], masterLevel }, { power: 35, speed: 11 }, { masterChance: 100 });
    assert.equal(events.some((r) => r.id === 13), false);
  }
  assert.equal(rounds(game(), { skills: ['13:1'], masterLevel: 100 }, { power: 1 }, { masterChance: 100 }).some((r) => r.id === 13), false);
  assert.equal(rounds(game(), { hp: 100, skills: ['13:1'], masterLevel: 20 }, { power: 35, speed: 11 }, { masterChance: 0 }).some((r) => r.id === 13), false);
});

test('师父血线包含35%边界，治疗不超过最大生命', () => {
  const events = rounds(game(), { hp: 100, power: 1, skills: ['13:1'], masterLevel: 100 }, { power: 65, speed: 11 }, { masterChance: 100 });
  assert.equal(events[0].hpAfter[0], 35);
  assert.equal(events[1].id, 13);
  assert.equal(events[1].healSelf, 65);
  assert.equal(events[1].hpAfter[0], 100);
});

test('师父之后的下一击必中，不会被中途对手行动消耗', () => {
  const ordinary = [0.9, 0.9, 0.5, 0.9, 0.9];
  const g = game(0.9, [...ordinary, ...ordinary, ...ordinary, 0.1, ...ordinary, 0.9, 0, 0.5, 0.9, 0.9]);
  const events = rounds(g, { hp: 100, power: 1, skills: ['13:1'], masterLevel: 7 }, { power: 35, speed: 11 });
  const my = events.filter((r) => r.attacker === 0), index = my.findIndex((r) => r.id === 13);
  assert.ok(index >= 0);
  assert.equal(my[index + 1].action, 'common');
  assert.equal(my[index + 1].dodge, undefined);
  assert.ok(my[index + 1].dmg > 0);
});

test('木剑持有时不加闪避，击中后加闪避，闪避增益不反复叠加', () => {
  const events = rounds(game(0.11), { weapons: ['3:10'] }, { speed: 11 });
  assert.equal(events[0].attacker, 1);
  assert.equal(events[0].dodge, undefined);
  assert.equal(events[1].id, 3);
  assert.equal(events[1].dodgeBuff, 30);
  assert.equal(events[2].dodge, true);
  assert.ok(events.filter((r) => r.dodgeBuff).every((r) => r.dodgeBuff === 30));
  const miss = rounds(game(0.9, [0.5, 0.5, 0]), { weapons: ['3:10'] });
  assert.equal(miss[0].dodge, true);
  assert.equal(miss[0].dodgeBuff, undefined);
  const relative = rounds(game(0.2), { weapons: ['3:10'] }, { speed: 11 });
  assert.equal(relative[2].dodge, undefined, '加成后的约13%闪避仍低于20%，不是加30个百分点');
});

test('移形换位按原有闪避率增幅计算，不直接增加百分点', () => {
  // 同敏捷时基础闪避约10%，十级移形为其增加23%，低于20%。
  const events = rounds(game(0.2), {}, { skills: ['11:10'] });
  assert.equal(events[0].dodge, undefined);
  assert.ok(events[0].dmg > 0);
  // 11%随机值位于基础闪避与增益后的闪避之间。
  const dodged = rounds(game(0.9, [0.9, 0.11]), {}, { skills: ['11:10'] });
  assert.equal(dodged[0].dodge, true);
});

test('野球拳十级为力量加速度的255%', () => {
  const events = rounds(game(), { power: 10, speed: 10, skills: ['12:10'] });
  assert.equal(events[0].id, 12);
  assert.equal(events[0].dmg, 51);
});

test('小宇宙使用裸属性，最低一点，装备附加单独增加并马上行动', () => {
  const events = rounds(game(), {
    power: 100, agility: 100, speed: 100, baseStats: { power: 20, agility: 5, speed: 20 },
    skills: ['14:10'], effects: { 36: 30 },
  }, { speed: 100 });
  assert.equal(events[0].id, 14);
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].statBonus)), { power: 32, agility: 1, speed: 2 });
  assert.equal(events[0].noDmg, true);
  assert.equal(events[0].dmg, undefined);
  assert.equal(events[1].attacker, 0);
  assert.equal(events[1].action, 'common');
  assert.equal(events[1].dmg, 132);
  assert.equal(events.filter((r) => r.id === 14).length, 1);
});

test('装死后立刻行动，即使对方速度远高于自己', () => {
  const events = rounds(game(), { power: 100, speed: 100 }, { hp: 10, power: 1, skills: ['6:1'] });
  assert.equal(events[0].fakeDie, true);
  assert.equal(events[0].hpAfter[1], 1);
  assert.equal(events[0].counterDmg, undefined);
  assert.equal(events[1].attacker, 1);
  assert.equal(events.filter((r) => r.fakeDie).length, 1);
});

test('装死打断武器连击，获得行动机会', () => {
  const events = rounds(game(0.2), { weapons: ['4:10'], speed: 100 }, { hp: 10, power: 1, skills: ['6:1'] });
  assert.equal(events[0].hits, 2);
  assert.equal(events[0].fakeDie, true);
  assert.equal(events[0].hpAfter[1], 1);
  assert.equal(events[1].attacker, 1);
});

test('橡皮擦和吸铁大法均可无视装死', () => {
  for (const attacker of [{ weapons: ['7:1'] }, { skills: ['18:1'] }]) {
    const events = rounds(game(), attacker, { hp: 1, skills: ['6:1'] });
    assert.equal(events[0].fakeDie, undefined);
    assert.equal(events[0].hpAfter[1], 0);
    assert.equal(events.length, 1);
  }
});

test('色诱和通灵可以闪避，幸运一击始终必中', () => {
  for (const skill of [8, 15]) {
    // 技能选择、抽选、可选伤害随机值均为0，从而命中闪避判定。
    const events = rounds(game(0), { skills: [skill + ':1'] });
    assert.equal(events[0].id, skill);
    assert.equal(events[0].dodge, true);
    assert.equal(events[0].stunApplied, undefined);
  }
  const lucky = rounds(game(0), { skills: ['23:1'] }, { agility: 1000 });
  assert.equal(lucky[0].dodge, undefined);
  assert.ok(lucky[0].dmg > 0);
});

test('龟甲术首次触发后仍可二次触发（不再是一次性）', () => {
  const turtle = (g, effects) => rounds(g, { power: 40, weapons: ['6:1'] }, { skills: ['7:10'], hp: 100000, effects });
  // 附加能力「龟甲术N%几率抵挡2次」=100 时，首次触发之后每次受击都必定再挡
  const full = turtle(randomGame(), { 32: 100 });
  const blocks = full.filter((r) => r.guiJia).length;
  assert.ok(blocks > 1, '首次之后应当继续二次触发，实测 ' + blocks + ' 次');
  const lastHit = [...full].reverse().find((r) => r.attacker === 0 && !r.dodge && r.action !== 'rest');
  assert.ok(lastHit && lastHit.guiJia !== undefined, '必定二次触发时最后一次受击也该被挡');
  // 不带任何附加能力：首次 35%，之后每次仍有 shellAgain% 的二次触发概率
  let several = 0;
  for (let i = 0; i < 200; i++) if (rounds(randomGame(), { power: 40, weapons: ['6:1'] }, { skills: ['7:10'], hp: 100000 }).filter((r) => r.guiJia).length >= 2) several++;
  assert.ok(several > 0, '没有装备附加能力时也应当能二次触发，实测 ' + several + '/200 场出现');
});

test('绝对防御：首次 22%，二次及以后 13%（都低于原来的 30%）', () => {
  const c = game();
  const rules = c.Sim.rules;
  assert.equal(rules.jueDuiChance, 22);
  assert.ok(rules.jueDuiChance < 30, '首次概率必须低于原来的 30%');
  assert.ok(rules.jueDuiAgain < rules.jueDuiChance, '二次及以后必须比首次更低');
  // 单次受击（只打一下）：触发率应贴着首次的 22%
  let firstHits = 0, firstBlocks = 0, manyHits = 0, manyBlocks = 0;
  /* 样本量：400 次里只有约 1/3 是「单次受击」，比例的标准差 ≈ 3.6%，
   * 而容差是 ±5%（约 1.4σ）→ 约 16% 的概率误报。加到 1500 次，
   * 单次受击样本约 500，标准差降到 ≈1.9%，容差变成约 2.7σ，才真正稳。 */
  for (let i = 0; i < 1500; i++) {
    const ev = rounds(randomGame(), { power: 30, weapons: ['6:1'], hp: 100000 }, { skills: ['16:1'], hp: 100000 });
    let n = 0;
    for (const r of ev) {
      if (r.attacker !== 0 || r.dodge || r.action === 'rest') continue;
      n++;
      manyHits++; if (r.jueDui) manyBlocks++;
      if (n === 1) { firstHits++; if (r.jueDui) firstBlocks++; }
    }
  }
  const firstRate = firstBlocks / firstHits;
  assert.ok(Math.abs(firstRate - 0.22) < 0.05, '首次受击实测 ' + (firstRate * 100).toFixed(1) + '% 应接近 22%');
  // 整场累计：首次 22% + 之后 13%，长期应明显低于 22% 但高于 13%
  const longRate = manyBlocks / manyHits;
  assert.ok(longRate < 0.20, '整场累计触发率 ' + (longRate * 100).toFixed(1) + '% 应明显低于首次的 22%（二次档 13% 在压）');
  assert.ok(longRate > 0.10, '整场累计触发率 ' + (longRate * 100).toFixed(1) + '% 不该低于二次档太多');
});

test('同时有龟甲术与绝对防御时，每次受击的受伤期望更低（不会被挤占）', () => {
  const measure = (skills) => {
    let taken = 0, hits = 0;
    for (let i = 0; i < 400; i++) {
      const ev = rounds(randomGame(), { power: 30, weapons: ['6:1'], hp: 100000 }, { skills, hp: 100000 });
      for (const r of ev) {
        if (r.attacker !== 0 || r.dodge || r.action === 'rest') continue;
        hits++; taken += Number(r.dmg) || 0;
      }
    }
    return taken / hits;
  };
  const onlyJueDui = measure(['16:1']);
  const both = measure(['16:1', '7:10']);
  assert.ok(both < onlyJueDui, '龟甲+绝对防御 ' + both.toFixed(1) + ' 应小于仅绝对防御 ' + onlyJueDui.toFixed(1));
});

test('来点松果不在满血时浪费，恢复后不占下一次行动', () => {
  const events = rounds(game(), { hp: 100, skills: ['17:1'] }, { power: 30, speed: 11 });
  const index = events.findIndex((r) => r.id === 17);
  assert.ok(index > 0);
  assert.equal(events[index].healSelf, 20);
  assert.equal(events[index].actAgain, true);
  assert.equal(events[index + 1].attacker, 0);
});

test('武器好手的固定加成不随力量倍率增长', () => {
  for (const power of [1, 100]) {
    const plain = rounds(game(), { power, weapons: ['2:1'] })[0].dmg;
    const specialist = rounds(game(), { power, weapons: ['2:1'], skills: ['5:10'] })[0].dmg;
    assert.equal(specialist - plain, 28);
  }
});

test('用户Debug无敌模式保留，反弹后的血量快照仍至少为1', () => {
  const g = game(0.2);
  g.Debug = { enabled: (key) => key === 'godMode' };
  const events = rounds(g, { hp: 1, power: 1000 }, { skills: ['16:10'], hp: 100000 });
  assert.ok(events.some((r) => r.reboundHurt));
  assert.ok(events.every((r) => r.hpAfter[0] >= 1));
});

test('流星锤即使未命中也给对手整场相对20%闪避增益', () => {
  const events = rounds(game(0.9, [0.5, 0.5, 0, 0.9, 0.9, 0.5, 0.9, 0.9, 0.9, 0.11]), { weapons: ['10:1'] });
  assert.equal(events[0].id, 10);
  assert.equal(events[0].dodge, true);
  assert.equal(events[2].action, 'common');
  assert.equal(events[2].dodge, true, '之后的普通攻击也受到流星锤闪避增益影响');
  const relative = rounds(game(0.2), { weapons: ['10:1'] });
  assert.equal(relative[0].dodge, undefined, '相对+20%约为12%，不增加20个百分点');
});

test('狼牙棒中毒在中招者四次出手掉血，包含不占回合的追加行动', () => {
  const events = rounds(game(0.8, [0.5, 0.5, 0.5, 0.5, 0.1, 0.9, 0.5, 0]), { weapons: ['12:1'] }, { skills: ['14:1'] });
  assert.equal(events[0].dotApplied, true);
  const poison = events.filter((r) => r.action === 'dot');
  assert.equal(poison.length, 4);
  assert.ok(poison.every((r) => r.attacker === 1 && r.dmg === 4));
  const cosmos = events.findIndex((r) => r.id === 14);
  assert.ok(cosmos > 0);
  assert.equal(events[cosmos + 1].action, 'dot');
  assert.equal(events[cosmos + 2].attacker, 1);
});

test('沉默之斧同时抑制武器好手等被动技能', () => {
  const attacker = { weapons: ['16:10'] }, defender = { weapons: ['2:1'], skills: ['5:10'] };
  const events = rounds(game(0.3), attacker, defender);
  assert.equal(events[0].silenceApplied, true);
  const muted = events.find((r) => r.attacker === 1 && r.action === 'weapon');
  const withoutSkill = rounds(game(0.3), attacker, { weapons: ['2:1'] }).find((r) => r.attacker === 1 && r.action === 'weapon');
  assert.equal(muted.dmg, withoutSkill.dmg);
});

test('来点松果可以二次触发，但概率是所有武器/技能里最低的', () => {
  const rules = game().Sim.rules;
  assert.ok(rules.repeatSnack < rules.repeatSkill, '来点松果二次概率要低于其它技能');
  assert.ok(rules.repeatSnack < rules.repeatWeapon, '来点松果二次概率要低于武器');
  assert.ok(rules.repeatSkill < 50, '所有技能的二次使用概率都该被调低');
  /* 分档下调（本次需求）：中幅 = 色诱之术/野球拳/来点松果，
   * 小幅 = 通灵召唤/幸运一击；没点名的技能保持基准不变。 */
  const Sim = game().Sim;
  const rate = (id) => Sim.repeatRateOf(id);
  for (const id of [8, 12, 17]) {
    assert.ok(rate(id) < rules.repeatSkill, '技能 ' + id + ' 的二次概率应该比基准更低（中幅下调）');
    assert.ok(rate(id) <= rules.repeatSkillMedium, '技能 ' + id + ' 应该落在中幅档（≤' + rules.repeatSkillMedium + '%）');
  }
  for (const id of [15, 23]) {
    assert.ok(rate(id) < rules.repeatSkill, '技能 ' + id + ' 的二次概率应该被小幅下调');
    assert.ok(rate(id) >= rules.repeatSkillMedium && rate(id) <= rules.repeatSkillSmall,
      '技能 ' + id + ' 应该落在小幅档');
  }
  assert.equal(rate(14), rules.repeatSkill, '没点名的技能（小宇宙爆发）保持基准');
  assert.equal(rate(18), rules.repeatSkill, '没点名的技能（吸铁大法）保持基准');
  assert.ok(rate(17) < rate(8) && rate(17) < rate(15), '来点松果仍是最低档');
  // 绝对防御是受击自动触发，不进出手池，但同样要「二次及以后更难触发」
  assert.ok(rules.jueDuiAgain < rules.jueDuiChance, '绝对防御二次触发概率要低于首次');
  assert.ok(rules.jueDuiAgain <= rules.repeatSkillMedium, '绝对防御的二次档要和中幅下调一个量级');
  /* 需求 3：来点松果**不允许在同一回合内多次触发**（它自带追加行动，
   * 早期实现会在同一回合里连着放两次）。同一场可以有多次，但两次之间
   * 必须夹着对手的行动 —— 也就是不能背靠背。 */
  let backToBack = 0, multiPerFight = 0, total = 0;
  for (let i = 0; i < 400; i++) {
    const ev = rounds(randomGame(), { skills: ['17:5'], power: 1 }, { power: 50, hp: 100000 });
    const mine = ev.filter((r) => r.attacker === 0);
    let last = -2;
    for (let k = 0; k < mine.length; k++) {
      if (mine[k].id === 17) { if (k === last + 1) backToBack++; last = k; total++; }
    }
    if (mine.filter((r) => r.id === 17).length >= 2) multiPerFight++;
  }
  assert.equal(backToBack, 0, '来点松果不该在同一回合内背靠背触发，实测 ' + backToBack + ' 次');
  assert.ok(total > 0, '400 场里来点松果应当至少放出来过（实测 ' + total + ' 次）');
  /* 「二次使用概率最低」直接用导出权重校验：来点松果自身是 actAgain 技能（不占回合），
   * 用「场均使用次数」比较会被这个特性干扰，量不出概率差。 */
  const w = game().Sim.actionWeights.skill;
  const spent = { usedSkills: { 17: true, 12: true, 23: true }, lastSkillId: null };
  const snack = w(spent, 17);
  for (const id of [12, 23]) assert.ok(snack < w(spent, id), '来点松果二次权重 ' + snack + ' 应低于技能 ' + id + ' 的 ' + w(spent, id));
  assert.ok(snack < game().Sim.actionWeights.weapon({ usedWeapons: { 6: true }, lastWeaponId: null }, 6), '也应低于武器');
});

test('出手时优先用本场没用过的武器与技能（并非绝对）', () => {
  let repeats = 0, weapons = 0;
  for (let i = 0; i < 200; i++) {
    const ev = rounds(randomGame(), { power: 30, skills: ['12:1', '18:1', '23:1'], weapons: ['6:1', '8:1', '13:1'], hp: 100000 }, { power: 5, hp: 100000 });
    let last = null;
    for (const r of ev) {
      if (r.attacker !== 0) continue;
      if (r.action === 'weapon') { weapons++; if (r.id === last) repeats++; last = r.id; }
      else if (r.action === 'skill') { if (r.id === last) repeats++; last = r.id; }
    }
  }
  assert.ok(weapons > 200, '样本量足够：实测武器出手 ' + weapons + ' 次');
  // 均匀随机下「连续两次同一把/同一个」约 1/3；优先没用过的之后应当远低于此
  const rate = repeats / weapons;
  assert.ok(rate < 0.15, '连续重复率 ' + (rate * 100).toFixed(1) + '% 应远低于均匀随机的 ~33%');
  // 权重口径（确定性，不依赖采样）：没用过的 > 用过的；刚用过的再降一档
  const W = game().Sim.actionWeights;
  const fresh = { usedWeapons: {}, lastWeaponId: null };
  const spentW = { usedWeapons: { 6: true }, lastWeaponId: null };
  const justW = { usedWeapons: { 6: true }, lastWeaponId: 6 };
  assert.ok(W.weapon(fresh, 6) > W.weapon(spentW, 6), '没用过的武器权重必须高于用过的（优先但非绝对）');
  assert.ok(W.weapon(spentW, 6) > W.weapon(justW, 6), '刚用过的武器该再降一档');
  assert.ok(W.weapon(fresh, 6) > 0 && W.weapon(justW, 6) > 0, '只是降权，不是禁用');
  const W2 = game().Sim.actionWeights.skill;
  assert.ok(W2({ usedSkills: {}, lastSkillId: null }, 12) > W2({ usedSkills: { 12: true }, lastSkillId: null }, 12), '没用过的技能权重更高');
  assert.ok(W2({ usedSkills: { 12: true }, lastSkillId: null }, 12) > W2({ usedSkills: { 12: true }, lastSkillId: 12 }, 12), '刚用过的技能该再降一档');
});

test('真·技能：真5端点与线性插值生效（龟甲必多次、幸运一击基础137、通灵额外+18）', () => {
  const G = game();
  assert.equal(G.GData.trueLevel(15), 5);
  assert.equal(G.GData.trueLevel(10), 0);
  assert.ok(Math.abs(G.GData.trueSkillValue(8, 15) - 0.56) < 1e-9, '真5色诱 56%');
  assert.ok(Math.abs(G.GData.trueSkillValue(8, 13) - 0.336) < 1e-9, '真3色诱 = 56%×3/5');
  /* 真5 龟甲：首次仍是 35%（原规则），但一旦触发过，之后每次受击都必定再挡
   * （20% + 真5 的 100%）。所以断言「第一次挡住之后不再漏」。 */
  let battles = 0, leaked = 0, firstBlocks = 0;
  for (let i = 0; i < 40; i++) {
    const ev = rounds(randomGame(), { power: 30, weapons: ['6:1'], hp: 100000 }, { skills: ['7:15'], hp: 100000 });
    const incoming = ev.filter((r) => r.attacker === 0 && !r.dodge && r.action !== 'rest');
    const first = incoming.findIndex((r) => r.guiJia);
    if (first < 0) continue;
    battles++; firstBlocks++;
    if (incoming.slice(first + 1).some((r) => !r.guiJia)) leaked++;
  }
  assert.ok(battles > 20, '样本足够：' + battles);
  assert.equal(leaked, 0, '真5龟甲触发过之后不该再漏（漏了 ' + leaked + '/' + battles + ' 场）');
  // 真5 幸运一击：基础伤害 137×倍率（必中，不吃闪避）
  const lucky = rounds(game(0.5), { power: 10, skills: ['23:15'], hp: 100000, agility: 1000 }, { power: 1, hp: 100000, agility: 1 });
  const hitsLucky = lucky.filter((r) => r.id === 23);
  assert.ok(hitsLucky.length > 0, '要能打出幸运一击');
  assert.ok(hitsLucky.every((r) => r.dmg === 137 * r.multiple), '真5 基础 137：' + JSON.stringify(hitsLucky.slice(0, 3)));
  /* 通灵召唤的伤害里有一项是「对手当前生命的 35%」，两次独立模拟的当前生命不同，
   * 直接比伤害没有意义。它的真值走的是同一套插值，这里直接校验数值管线：
   * 真5 额外 +18（用户提供），真4 = 18×4/5 = 14.4，真0 = 0。 */
  assert.equal(G.GData.trueSkillValue(15, 15), 18, '真5 通灵额外 +18');
  assert.ok(Math.abs(G.GData.trueSkillValue(15, 14) - 14.4) < 1e-9, '真4 = 14.4');
  assert.equal(G.GData.trueSkillValue(15, 10), 0, '普通 10 级没有真加成');
  // 真武器加成只在真形态生效（西瓜刀真级 +5% 连击）
  assert.equal(G.GData.trueWeaponBonus({ id: 4, level: 10 }, 'combo'), 0, '普通形态没有真加成');
  assert.equal(G.GData.trueWeaponBonus({ id: 4, level: 11 }, 'combo'), 5, '真形态 +5% 连击');
  assert.equal(G.GData.trueWeaponBonus({ id: 12, level: 15 }, 'dot'), 6, '真狼牙棒 +6 持续伤害');
});

test('武技都使用过一遍之后，出手更偏向武器（压低技能重复率）', () => {
  const WEAPONS = ['6:1', '8:1', '13:1'], SKILLS = ['12:1', '18:1', '23:1'];
  const wIds = WEAPONS.map((x) => x.split(':')[0]), sIds = SKILLS.map((x) => x.split(':')[0]);
  let beforeW = 0, beforeS = 0, afterW = 0, afterS = 0, runs = 0;
  for (let i = 0; i < 120; i++) {
    const ev = rounds(randomGame(),
      { power: 30, weapons: WEAPONS, skills: SKILLS, hp: 100000 },
      { power: 5, hp: 100000 });
    // 找到「六件武技都至少用过一次」的那一回合
    const usedW = new Set(), usedS = new Set();
    let cut = -1;
    ev.forEach((r, idx) => {
      if (r.attacker !== 0) return;
      if (r.action === 'weapon') usedW.add(String(r.id));
      if (r.action === 'skill') usedS.add(String(r.id));
      if (cut < 0 && wIds.every((x) => usedW.has(x)) && sIds.every((x) => usedS.has(x))) cut = idx;
    });
    if (cut < 0) continue;
    runs++;
    ev.forEach((r, idx) => {
      if (r.attacker !== 0) return;
      if (r.action === 'weapon') { if (idx < cut) beforeW++; else afterW++; }
      else if (r.action === 'skill') { if (idx < cut) beforeS++; else afterS++; }
    });
  }
  assert.ok(runs > 40, '样本足够：' + runs);
  const shareBefore = beforeW / (beforeW + beforeS), shareAfter = afterW / (afterW + afterS);
  assert.ok(shareAfter > shareBefore + 0.1,
    '用过一遍之后应当更偏向武器：之前 ' + (shareBefore * 100).toFixed(0) + '% → 之后 ' + (shareAfter * 100).toFixed(0) + '%');
  assert.ok(shareAfter > 0.7, '之后武器占比应明显过半：' + (shareAfter * 100).toFixed(0) + '%');
});

test('仙鹤大招「仙鹤展翅」是其首次行动且每场仅一次', () => {
  const events = rounds(game(0.9), { hp: 100000, power: 1, speed: 100 }, { npcType: 'xh', power: 30, hp: 8000, speed: 10 });
  const ults = events.filter((r) => r.ultName === '仙鹤展翅');
  assert.equal(ults.length, 1);
  assert.equal(events[events.findIndex((r) => r.attacker === 1)], ults[0]);
});

test('螳螂生命低于20%才放「疾风镰刀舞」四连击，每场仅一次且高血量不放', () => {
  const events = rounds(game(0.9), { power: 50, hp: 100000 }, { npcType: 'tl', power: 5, hp: 1000 });
  const ults = events.filter((r) => r.ultName === '疾风镰刀舞');
  assert.equal(ults.length, 1);
  assert.equal(ults[0].multiHit, 4);
  assert.ok(ults[0].dmg > 0);
  // 触发那一帧螳螂血量必须已经低于 20%（削弱前是 35%，几乎每场都放）
  let hp = 1000;
  let frac = null;
  for (const r of events) {
    if (r.ultName === '疾风镰刀舞') { frac = hp / 1000; break; }
    if (Array.isArray(r.hpAfter)) hp = r.hpAfter[1];
  }
  assert.ok(frac != null && frac < 0.25, '触发时血量比例应明显偏低，实际 ' + frac);
  // 血量一直很高时一次都不该放：给一个打不死的对手
  const tanky = rounds(game(0.9), { power: 1, hp: 100000 }, { npcType: 'tl', power: 1, hp: 100000 });
  assert.equal(tanky.some((r) => r.ultName === '疾风镰刀舞'), false, '高血量不放四连击');
});

test('熊猫生命低于40%放「熊掌震地」并震晕对手一回合，每场仅一次', () => {
  const events = rounds(game(0.9), { power: 50, hp: 100000 }, { npcType: 'xm', power: 5, hp: 1000 });
  const ults = events.filter((r) => r.ultName === '熊掌震地');
  assert.equal(ults.length, 1);
  assert.equal(ults[0].stunApplied, true);
  assert.ok(events.some((r) => r.attacker === 0 && r.action === 'stunned'));
});

/* ---------- 挑战塔题面（第 4 场最终位对手）----------
 * 题面是「玩家式 AI」（没有 npcType、走 playerLikeAction），机制要自己挂上，
 * 所以这组用例同时守住两件事：机制数值对，以及玩家式 AI 也能吃到机制。 */
const trialFoe = (mech, extra = {}) => fighter({ name: '题面', mech, pattern: ['common'], agility: 1, speed: 1, ...extra });
/** 玩家每次出手打掉的血量（按顺序）。 */
const hitSeq = (events) => Array.from(events).filter((r) => r.attacker === 0 && r.dmg > 0).map((r) => r.dmg);

test('题面·熔核：第 5 次行动成型（受伤 −80%、力敏速 +50%），逼前 4 回合速杀', () => {
  // 高血对手 + 弱玩家：成型前每次普攻都能打出伤害，成型后骤降
  const make = () => {
    const g = game(0.99);
    return rounds(g, fighter({ power: 40, hp: 100000 }), trialFoe(['trialCore'], { power: 1, hp: 4000 }));
  };
  const events = make();
  const mark = events.findIndex((r) => /熔核成型/.test(r.noteText || ''));
  assert.ok(mark > 0, '第 5 次行动应打出「熔核成型」');
  const dmg = hitSeq(events);
  const before = dmg.slice(0, 4);
  const after = dmg.slice(dmg.length - 3);
  assert.ok(before.length >= 3 && after.length >= 3, '成型前后都应有足够的采样');
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(after) < avg(before) * 0.35, '成型后受伤应低于成型前的 35%（实测 ' +
    avg(before).toFixed(1) + ' → ' + avg(after).toFixed(1) + '）');
  // 成型时会给自己加力敏速：玩家挨的伤害随之变高
  assert.ok(events.some((r) => r.attacker === 1 && r.dmg > 0), '对手要能造成伤害');
});

test('题面·苔龟：每回合回复 6% 最大生命，并且反弹 15% 伤害', () => {
  const g = game(0.99);
  // 玩家很弱（每回合只打掉一点点），对手靠回复应当把血量拉起来
  const events = rounds(g, fighter({ power: 3, hp: 100000 }), trialFoe(['trialMoss', 'thorns'], { power: 1, hp: 1000 }));
  const foeHp = Array.from(events).filter((r) => Array.isArray(r.hpAfter)).map((r) => r.hpAfter[1]);
  assert.ok(foeHp.length > 12, '需要足够长的战斗');
  assert.ok(Math.max(...foeHp) > Math.min(...foeHp), '苔龟的回复应当把血量拉回来');
  assert.ok(Array.from(events).some((r) => (r.thornsDmg || 0) > 0), '荆棘反弹应生效');
  assert.ok(Array.from(events).some((r) => /苔甲再生/.test(r.noteText || '')), '回复要挂提示');
});

test('题面·枯泉：封死玩家治疗，并且每 3 次行动吸取玩家 10% 当前生命', () => {
  // 师父驾到本来回 7×4 = 28 点，被枯泉封掉后 healSelf 必须是 0
  const g = game(0.99);
  const events = rounds(g, fighter({ hp: 100, power: 1, skills: ['13:1'], masterLevel: 7, agility: 1, speed: 1 }),
    trialFoe(['trialDry'], { power: 1, hp: 100000 }), { masterChance: 100 });
  const master = Array.from(events).find((r) => r.id === 13);
  assert.ok(master, '师父应当出场');
  assert.equal(master.healSelf, 0, '枯泉在场时治疗量必须为 0');
  const drains = Array.from(events).filter((r) => /枯泉·吸血/.test(r.noteText || ''));
  assert.ok(drains.length >= 2, '每 3 次行动吸一次，长战斗里应出现多次');
  // 没被枯泉盯上的对照组：同样的师父能正常回血
  const plain = Array.from(rounds(game(0.99), fighter({ hp: 100, power: 1, skills: ['13:1'], masterLevel: 7, agility: 1, speed: 1 }),
    fighter({ power: 1, hp: 100000, agility: 1, speed: 1 }), { masterChance: 100 })).find((r) => r.id === 13);
  assert.equal(plain.healSelf, 28, '没有枯泉时师父回血照旧');
});

test('题面·霜缚：第 1/4/7… 次行动前冻结玩家', () => {
  const g = game(0.99);
  const events = rounds(g, fighter({ power: 1, hp: 100000, agility: 1, speed: 1 }),
    trialFoe(['trialFrost'], { power: 1, hp: 100000 }));
  const freezes = Array.from(events).filter((r) => r.attacker === 0 && r.action === 'stunned').length;
  assert.ok(freezes >= 3, '长战斗里至少冻结 3 次，实际 ' + freezes);
  assert.ok(Array.from(events).filter((r) => /霜缚/.test(r.noteText || '')).length >= 3);
  // 对照组：不带霜缚的同一场战斗不会被冻
  const plain = rounds(game(0.99), fighter({ power: 1, hp: 100000, agility: 1, speed: 1 }),
    trialFoe([], { power: 1, hp: 100000 }));
  assert.equal(Array.from(plain).some((r) => r.attacker === 0 && r.action === 'stunned'), false);
});

test('题面·镜鳞：单次伤害越过阈值才反弹，阈值以下安全', () => {
  const params = { trialMirror: { threshold: 0.05, reflect: 0.5 } };
  // 弱玩家（单次 < 5% 生命）：一次都不该被反弹
  const weak = rounds(game(0.99), fighter({ power: 2, hp: 100000, agility: 1, speed: 1 }),
    trialFoe(['trialMirror'], { power: 1, hp: 100000, mechParams: params }));
  assert.equal(Array.from(weak).some((r) => (r.thornsDmg || 0) > 0), false, '阈值以下不该反弹');
  // 强玩家（单次 > 5% 生命）：每次越线都要吃反弹
  const strong = rounds(game(0.99), fighter({ power: 60, hp: 100000, agility: 1, speed: 1 }),
    trialFoe(['trialMirror'], { power: 1, hp: 400, mechParams: params }));
  const reflected = Array.from(strong).filter((r) => (r.thornsDmg || 0) > 0);
  assert.ok(reflected.length > 0, '越线伤害应被反弹');
  assert.ok(reflected.some((r) => /镜鳞·反噬/.test(r.noteText || '')));
  // 反弹量 = 该次伤害 × 50%
  assert.equal(reflected[0].thornsDmg, Math.max(1, Math.round(reflected[0].dmg * 0.5)));
});

test('题面·血牙：每损失 20% 生命，攻击 +35%', () => {
  const g = game(0.99);
  // 玩家血厚、打得不快，让血牙有机会分段掉血
  const events = rounds(g, fighter({ power: 12, hp: 100000, agility: 1, speed: 1 }),
    trialFoe(['trialBloodfang'], { power: 30, hp: 900 }));
  const notes = Array.from(events).filter((r) => /血牙·狂怒/.test(r.noteText || ''));
  assert.ok(notes.length >= 2, '掉 40% 生命后至少叠 2 次，实际 ' + notes.length);
  const hurt = Array.from(events).filter((r) => r.attacker === 1 && r.dmg > 0).map((r) => r.dmg);
  assert.ok(hurt.length >= 6, '需要足够的挨打采样');
  const early = hurt.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
  const late = hurt.slice(-2).reduce((a, b) => a + b, 0) / 2;
  assert.ok(late > early * 1.3, '残血后攻击应明显更高（' + early.toFixed(1) + ' → ' + late.toFixed(1) + '）');
});

test('题面·蚀骨：玩家每次出手叠 1 层攻击 −3%，最多 10 层', () => {
  const g = game(0.99);
  const events = rounds(g, fighter({ power: 100, hp: 100000, agility: 1, speed: 1 }),
    trialFoe(['trialErode'], { power: 1, hp: 100000 }));
  const dmg = hitSeq(events);
  assert.ok(dmg.length >= 12, '需要足够多的出手采样');
  assert.ok(dmg[dmg.length - 1] < dmg[0] * 0.78, '第 10 层时攻击应掉到七成左右（' +
    dmg[0] + ' → ' + dmg[dmg.length - 1] + '）');
  // 10 层封顶：第 11 次出手以后不再继续掉
  const tail = dmg.slice(11);
  assert.ok(Math.max(...tail) - Math.min(...tail) <= Math.max(2, tail[0] * 0.08), '层数应当封顶在 10 层');
  // 对照组：没有蚀骨时伤害不衰减
  const plain = hitSeq(rounds(game(0.99), fighter({ power: 100, hp: 100000, agility: 1, speed: 1 }),
    trialFoe([], { power: 1, hp: 100000 })));
  assert.ok(plain[plain.length - 1] >= plain[0] * 0.9, '没有蚀骨时伤害不应衰减');
});

test('关卡连战入场：当前血量按比例继承，但生命上限保持不变', () => {
  const g = game();
  // 满血入场：上限与血量都由 hp 推出，行为不变。
  const full = g.Sim.simulate(fighter({ hp: 400 }), fighter({ hp: 400 }));
  assert.deepEqual(Array.from(full.maxHp), [400, 400]);
  // 残血入场（25%）：hp 是当前血量，maxHp 仍是不变的上限。
  // 修复前 maxHp 会被写成 100，血条显示成满血且上限被压低。
  const hurt = g.Sim.simulate(fighter({ hp: 100, maxHp: 400 }), fighter({ hp: 400 }));
  assert.deepEqual(Array.from(hurt.maxHp), [400, 400]);
  assert.ok(hurt.rounds.every((r) => r.hpAfter[0] <= 400));
  // 上限更高的那一方不会因为入场残血就被判定为「血量比例更高」而拖到超时判胜。
  const short = g.Sim.simulate(fighter({ hp: 10, maxHp: 400, power: 1, weapons: [] }), fighter({ hp: 400, power: 60 }));
  assert.equal(short.winner, 1, '残血一方应当战败，而不是按 10/10 满血拖到判定');
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name, error); }
}
console.log((tests.length - failed) + '/' + tests.length + ' combat rule checks passed');
if (failed) process.exitCode = 1;
