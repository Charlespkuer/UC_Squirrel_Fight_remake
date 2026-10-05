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

test('绝对防御：首次 22%，之后逐次递减（22/13/9/6/4/3/2…，对敌我都生效）', () => {
  const c = game();
  const rules = c.Sim.rules;
  assert.equal(rules.jueDuiChance, 22);
  assert.equal(rules.jueDuiAgain, 13);
  assert.ok(rules.jueDuiChance < 30, '首次概率必须低于原来的 30%');
  assert.ok(rules.jueDuiAgain < rules.jueDuiChance, '第二次必须比首次更低');
  assert.ok(rules.jueDuiDecay > 0 && rules.jueDuiDecay < 1, '应当有一个小于 1 的衰减系数：' + rules.jueDuiDecay);
  assert.ok(rules.jueDuiMin > 0, '递减要有下限（不能变成 0 = 技能彻底失效）：' + rules.jueDuiMin);
  /* 曲线本身：严格递减到下限为止（需求点名的「第二次 < 第一次、第三次 < 第二次…」） */
  const mkDef = () => ({ name: 'd', level: 60, power: 100, agility: 100, speed: 100, hp: 1000, maxHp: 1000,
    weapons: [], skills: { 16: 1 }, effects: {}, baseStats: { power: 100, agility: 100, speed: 100 } });
  const curve = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => c.Sim.jueDuiChanceOf(mkDef(), n));
  assert.deepEqual(curve.slice(0, 3), [22, 13, 9], '曲线应当是 22 / 13 / 9：' + curve.join('/'));
  for (let i = 1; i < 6; i++) {
    assert.ok(curve[i] < curve[i - 1], '第 ' + (i + 1) + ' 次必须低于第 ' + i + ' 次：' + curve.join('/'));
  }
  assert.ok(curve[7] >= rules.jueDuiMin, '到下限后不再下降：' + curve.join('/'));
  /* 兼容旧的布尔口径：false = 首次、true = 第二次 */
  assert.equal(c.Sim.jueDuiChanceOf(mkDef(), false), 22);
  assert.equal(c.Sim.jueDuiChanceOf(mkDef(), true), 13);
  /* 对敌我都生效：sim 里两侧都会走 dmgReduce，同一场里各自记「已经挡过几次」。
   * 注意不能按「本场第 n 次受击」统计 —— 第一次没挡下来时计数仍然是 0，
   * 第二次受击还是 22% 那一档（实测按受击序号算是 21%，会误判）。
   * 正确做法是**按当前已触发次数分桶**：count=0 / 1 / 2 / 3+。 */
  const byCount = {};
  for (let i = 0; i < 800; i++) {
    const ev = rounds(randomGame(), { power: 30, weapons: ['6:1'], hp: 100000 },
      { skills: ['16:1'], hp: 100000 });
    let count = 0;                                  // 本场已经挡过几次（= sim 里的 jueDuiCount）
    for (const r of ev) {
      if (r.attacker !== 0 || r.dodge || r.action === 'rest') continue;
      const key = Math.min(3, count);
      byCount[key] = byCount[key] || { hits: 0, blocks: 0 };
      byCount[key].hits++;
      if (r.jueDui) { byCount[key].blocks++; count++; }
    }
  }
  const rateAt = (k) => (byCount[k] && byCount[k].hits >= 50 ? byCount[k].blocks / byCount[k].hits : NaN);
  const rate0 = rateAt(0), rate1 = rateAt(1), rate2 = rateAt(2);
  assert.ok(Number.isFinite(rate0) && Number.isFinite(rate1) && Number.isFinite(rate2),
    '三个桶都要有足够样本：' + JSON.stringify(byCount));
  assert.ok(Math.abs(rate0 - 0.22) < 0.06, '未挡过时实测 ' + (rate0 * 100).toFixed(1) + '% 应接近 22%');
  assert.ok(rate1 < rate0, '挡过 1 次之后应当更低：' + (rate0 * 100).toFixed(1) + '% vs ' + (rate1 * 100).toFixed(1) + '%');
  assert.ok(rate2 < rate1, '挡过 2 次之后应当再低：' + (rate1 * 100).toFixed(1) + '% vs ' + (rate2 * 100).toFixed(1) + '%');
  assert.ok(rate1 < 0.19 && rate2 < 0.14, '实测档位应贴近 13% / 9%：' +
    (rate1 * 100).toFixed(1) + '% / ' + (rate2 * 100).toFixed(1) + '%');
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
  /* 小幅档：通灵召唤（15）与幸运一击（23）。幸运一击本次**再单独下调**一档
   * （10%，低于小幅档），因为它「必中 + 1~6 倍伤害」，重复触发时方差极大。 */
  assert.ok(rate(15) < rules.repeatSkill, '技能 15 的二次概率应该被小幅下调');
  assert.ok(rate(15) >= rules.repeatSkillMedium && rate(15) <= rules.repeatSkillSmall,
    '技能 15 应该落在小幅档');
  assert.ok(rate(23) < rate(15), '幸运一击应当低于同档的通灵召唤：' + rate(23) + ' vs ' + rate(15));
  assert.ok(rate(23) > rules.repeatSnack, '但仍应高于最低档的来点松果');
  assert.equal(rate(14), rules.repeatSkill, '没点名的技能（小宇宙爆发）保持基准');
  assert.equal(rate(18), rules.repeatSkill, '没点名的技能（吸铁大法）保持基准');
  assert.ok(rate(17) < rate(8) && rate(17) < rate(15), '来点松果仍是最低档');
  // 绝对防御是受击自动触发，不进出手池，但同样要「越挡越难再挡」
  assert.ok(rules.jueDuiAgain < rules.jueDuiChance, '绝对防御第二次触发概率要低于首次');
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

test('题面·蚀骨：玩家每次出手叠 1 层攻击 −3%，最多 15 层', () => {
  const g = game(0.99);
  const events = rounds(g, fighter({ power: 100, hp: 100000, agility: 1, speed: 1 }),
    trialFoe(['trialErode'], { power: 1, hp: 100000 }));
  const dmg = hitSeq(events);
  assert.ok(dmg.length >= 17, '需要足够多的出手采样（要能打到 15 层封顶）');
  /* 15 层 × 3% = 45%，所以最终伤害约为初始的 55%。 */
  assert.ok(dmg[dmg.length - 1] < dmg[0] * 0.65, '第 15 层时攻击应掉到六成以下（' +
    dmg[0] + ' → ' + dmg[dmg.length - 1] + '）');
  // 15 层封顶：第 16 次出手以后不再继续掉
  const tail = dmg.slice(16);
  assert.ok(tail.length >= 1, '需要封顶之后的采样');
  assert.ok(Math.max(...tail) - Math.min(...tail) <= Math.max(2, tail[0] * 0.08), '层数应当封顶在 15 层');
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

test('低血减伤是**即时结算**的：按「越过阈值」把这一击切成两段', () => {
  const g = game();
  const Sim = g.Sim;
  const def = (hp, mul, th) => ({ name: 'p', level: 20, power: 10, agility: 10, speed: 10,
    hp, maxHp: 100, weapons: [], skills: [], mods: { lowHpAt: th === undefined ? 0.5 : th, lowHpTakenMul: mul } });
  const mul = -0.5;                       // 阈值 50% 以下减伤 50%
  /* 用户给的口径：上限 100、当前 60（60%）、挨 20 点 → 只掉 15 → 剩 45（旧算法是剩 40） */
  assert.equal(Sim.lowHpTakenDamage(def(60, mul), 20, mul), 15, '60% 挨 20 应当只吃 15');
  assert.equal(60 - Sim.lowHpTakenDamage(def(60, mul), 20, mul), 45, '最终血量应当是 45');
  /* 边界：正好打到阈值线 → 整段全额；够不到阈值线 → 全额 */
  assert.equal(Sim.lowHpTakenDamage(def(60, mul), 10, mul), 10, '正好打到线：全额');
  assert.equal(Sim.lowHpTakenDamage(def(60, mul), 5, mul), 5, '够不到线：全额');
  /* 已经低于阈值：整段减伤（与旧行为一致） */
  assert.equal(Sim.lowHpTakenDamage(def(40, mul), 20, mul), 10, '整段在阈下：全额减伤');
  assert.equal(Sim.lowHpTakenDamage(def(50, mul), 20, mul), 10, '正好在线上：整段减伤');
  /* 多档：减伤 25% / 阈值 40%（100 的 40% = 线在 40；当前 50 → 越线前 10 全额 + 后 10×0.75） */
  assert.equal(Sim.lowHpTakenDamage(def(50, -0.25, 0.4), 20, -0.25), Math.round(10 + 10 * 0.75), '25% 减伤的分段');
  /* 没有阈值（旧数据）→ 整段减伤，不能因为缺字段就变成全额 */
  assert.equal(Sim.lowHpTakenDamage({ hp: 60, maxHp: 100, mods: { lowHpTakenMul: mul } }, 20, mul), 10, '没有阈值时按整段减伤');
  /* 减伤 100%（mul = −1）→ 越过的部分归零，但仍然会被打到阈值线 */
  assert.equal(Sim.lowHpTakenDamage(def(60, -1), 20, -1), 10, '减伤 100% 时只掉到阈值线');
});

test('低血减伤在真实战斗里生效（打不到线上的那一段不吃减伤）', () => {
  const g = game();
  /* 防守方满血 200、带 50% 低血减伤；攻击方每次固定 60 点（力量 60、无暴击技能）。
   * 第一次挨打：200 → 140（还在 50% 线上，全额）
   * 第二次：140 → 80（仍然全额，因为 140→80 越过了 100 这条线？80 < 100 → 分段：
   *   140−100=40 全额 + 越过 100 的 20×0.5=10 → 共 50 → 140−50=90） */
  const me = fighter({ hp: 200, maxHp: 200, power: 1, agility: 1, speed: 1,
    mods: { lowHpAt: 0.5, lowHpTakenMul: -0.5 } });
  const foe = fighter({ hp: 100000, power: 60, agility: 1, speed: 200 });
  const res = g.Sim.simulate(foe, me, {});
  const hits = (res.rounds || []).filter((r) => r.attacker === 0 && r.dmg > 0);
  assert.ok(hits.length >= 2, '至少要有两次受击：' + hits.length);
  const first = hits[0].dmg, second = hits[1].dmg, third = hits.length > 2 ? hits[2].dmg : null;
  assert.equal(first, 60, '第一击（200→140，全程在阈值线上）应当全额：' + first);
  /* 第二击 140→90：140−100=40 全额 + 越过 100 的 20 减半（10）→ 50 */
  assert.equal(second, 50, '第二击应当按分段结算（40 + 20×0.5 = 50）：' + second);
  /* 第三击整段都在阈值线下（90 < 100）→ 全额减伤 30 */
  assert.ok(third === null || third === 30, '第三击应当整段减伤（60×0.5 = 30）：' + third);
});

test('固定循环的敌人不会把同一招连着放（技能冷却按出手次数算）', () => {
  /* 起因：无械苦修·空明 的技能表是「3 个被动 + 1 个主动」，循环只认主动技，
   * 于是整套循环塌缩成「幸运一击 ×N」（实测 74% 的出手都是它）。
   * 现在同一招用掉后至少要隔 RULES.skillCooldown 次出手才能再用。 */
  const g = randomGame();
  assert.ok(g.Sim.rules.skillCooldown >= 1, '冷却至少 1 次出手：' + g.Sim.rules.skillCooldown);
  /* 只带一个主动技（23 幸运一击）的固定循环敌人 */
  const oneTrick = () => fighter({ name: '苦修', skills: [{ id: 23, level: 8 }], pattern: ['skill', 'skill', 'common', 'skill'],
    power: 20, speed: 20, hp: 100000, weapons: [] });
  const sim = g.Sim.simulate(oneTrick(), fighter({ hp: 100000, power: 1, agility: 1, speed: 1 }));
  const mine = sim.rounds.filter((x) => x.attacker === 0 && (x.action === 'skill' || x.action === 'common'));
  const kinds = mine.map((x) => (x.action === 'skill' ? 'S' : 'C'));
  assert.ok(kinds.length >= 4, '出手次数太少：' + kinds.join(''));
  /* 冷却生效：序列里不该出现「相邻两次都是技能」 */
  for (let i = 1; i < kinds.length; i++) {
    assert.ok(!(kinds[i] === 'S' && kinds[i - 1] === 'S'),
      '同一招不能连着放（冷却 ' + g.Sim.rules.skillCooldown + ' 次出手）：' + kinds.join(''));
  }
  /* 而且它并没有被彻底废掉：整场至少放出来一次 */
  assert.ok(kinds.includes('S'), '技能还是要能放出来：' + kinds.join(''));

  /* 反过来：多个主动技的正常轮转不受影响（元素术鼠 12/17 那种） */
  const twoSkills = () => fighter({ name: '轮转', skills: [{ id: 12, level: 8 }, { id: 23, level: 8 }], pattern: ['skill', 'skill', 'skill', 'common'],
    power: 20, speed: 20, hp: 100000, weapons: [] });
  const sim2 = g.Sim.simulate(twoSkills(), fighter({ hp: 100000, power: 1, agility: 1, speed: 1 }));
  const ids = sim2.rounds.filter((x) => x.attacker === 0 && x.action === 'skill').map((x) => Number(x.id));
  assert.ok(ids.length >= 3, '轮转型敌人应当持续放技能：' + ids.join(','));
  for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i], ids[i - 1], '同一招仍然不能连着放：' + ids.join(','));
  assert.ok(ids.includes(12) && ids.includes(23), '两招都要用到（不是只放一招）：' + ids.join(','));
});

/* ============================================================
 * 本轮新增的 4 个「战斗中」增益（塔 buff）
 *   C54 越战越勇 / C55 后发制人 / C56 风影身法 / C57 玉石俱焚
 * 用 game(0.5) 钉住 Math.random，暴击/闪避噪声消失，断言可以写死。
 * ============================================================ */
const auraFighter = (extra = {}) => fighter(Object.assign({
  power: 100, agility: 100, speed: 100, hp: 100000, maxHp: 100000,
  baseStats: { power: 100, agility: 100, speed: 100 } }, extra));
const actOf = (rounds, side) => rounds.filter((r) => r.attacker === side && ['weapon', 'skill', 'common'].includes(r.action));
const auraRows = (rounds, side, note) => rounds.filter((r) => r.attacker === side && r.action === 'buff' && r.noteText === note);

test('越战越勇（C54）：每回合开始力/敏/速各 +1.5%，只在本次战斗里累加', () => {
  const g = game(0.5);
  const res = g.Sim.simulate(auraFighter({ mods: { roundStatPct: 0.015 } }), auraFighter());
  const mine = actOf(res.rounds, 0);
  assert.equal(auraRows(res.rounds, 0, '越战越勇').length, mine.length,
    '每次我方出手都应当结算一次「越战越勇」，实测 ' + auraRows(res.rounds, 0, '越战越勇').length + ' / ' + mine.length);
  /* 效果确实在涨：最后几次出手的伤害明显高于最开始几次（+1.5%/次、每次都累加） */
  const dmg = mine.map((r) => Number(r.dmg) || 0);
  assert.ok(dmg.length >= 6, '样本太少：' + dmg.length);
  const head = dmg.slice(0, 3).reduce((a, b) => a + b, 0);
  const tail = dmg.slice(-3).reduce((a, b) => a + b, 0);
  assert.ok(tail > head * 1.05, '伤害应当随回合上升：前 3 次 ' + head + ' vs 后 3 次 ' + tail);
  /* 不带这个 mod 时不该出现该结算行 */
  const plain = g.Sim.simulate(auraFighter(), auraFighter());
  assert.equal(auraRows(plain.rounds, 0, '越战越勇').length, 0, '没有该增益就不该有结算行');
});

test('后发制人（C55）：把落后最多的一项补上差距的 10%', () => {
  const g = game(0.5);
  const weak = auraFighter({ power: 20, agility: 20, speed: 20, baseStats: { power: 20, agility: 20, speed: 20 }, mods: { catchUpPct: 0.10 } });
  const strong = auraFighter({ power: 200, agility: 200, speed: 200, baseStats: { power: 200, agility: 200, speed: 200 } });
  const res = g.Sim.simulate(weak, strong);
  const rows = auraRows(res.rounds, 0, '后发制人');
  assert.ok(rows.length > 0, '三项都落后时每回合都应当补一次');
  assert.equal(rows.length, actOf(res.rounds, 0).length, '每次我方出手都补一次');
  /* 效果：伤害随回合抬升（差距被逐步补上） */
  const dmg = actOf(res.rounds, 0).map((r) => Number(r.dmg) || 0);
  assert.ok(dmg.length >= 6, '样本太少：' + dmg.length);
  assert.ok(dmg.slice(-3).reduce((a, b) => a + b, 0) > dmg.slice(0, 3).reduce((a, b) => a + b, 0),
    '落后时伤害应当逐回合抬升');
  /* 三项都不落后 → 不补 */
  const even = g.Sim.simulate(auraFighter({ mods: { catchUpPct: 0.10 } }), auraFighter());
  assert.equal(auraRows(even.rounds, 0, '后发制人').length, 0, '不落后就不该补');
});

test('风影身法（C56）：每场第一次被攻击必定闪避', () => {
  const g = game(0.5);
  const res = g.Sim.simulate(auraFighter({ mods: { firstDodge: 1 } }), auraFighter());
  const firstEnemyHit = res.rounds.find((r) => r.attacker === 1 && (Number(r.dmg) > 0 || r.dodge));
  assert.ok(firstEnemyHit, '应当有敌方攻击');
  assert.equal(firstEnemyHit.dodge, true, '第一次被打中必定闪避');
  assert.match(String(firstEnemyHit.noteText || ''), /风影身法/, '闪避要标明来源：' + firstEnemyHit.noteText);
  assert.equal(res.rounds.filter((r) => r.attacker === 0 && r.dodge).length, 0, '它只管我方挨打那一次');
  /* 不带这个 mod 的同一场对局：第一击不该必定闪避 */
  const plain = game(0.5).Sim.simulate(auraFighter(), auraFighter());
  const plainFirst = plain.rounds.find((r) => r.attacker === 1 && (Number(r.dmg) > 0 || r.dodge));
  assert.ok(!plainFirst || plainFirst.dodge !== true, '没有该增益时第一击不该必定闪避');
});

test('玉石俱焚（C57）：每回合双方生命上限各 ×90%（向下取整），当前血量跟着裁', () => {
  const g = game(0.5);
  const res = g.Sim.simulate(auraFighter({ mods: { roundMaxHpMul: 0.9 } }), auraFighter());
  const rows = auraRows(res.rounds, 0, '玉石俱焚');
  assert.ok(rows.length > 0, '每回合都该结算一次');
  const start = 100000;
  assert.ok(res.maxHp[0] < start && res.maxHp[1] < start,
    '双方上限都该变小：' + res.maxHp.join(' / '));
  assert.equal(res.maxHp[0], res.maxHp[1], '双方起点相同，压缩次数也相同 → 最终上限应当一致');
  /* 0.9^k 的量级（每步都 floor，所以只会更小一点点） */
  const k = rows.length;
  const upper = Math.floor(start * Math.pow(0.9, k)) + 1;
  assert.ok(res.maxHp[0] <= upper, '压缩量应当与回合数吻合：' + res.maxHp[0] + ' > ' + upper);
  assert.ok(res.maxHp[0] > Math.floor(start * Math.pow(0.9, k + 2)), '压缩不该过头');
  const plain = game(0.5).Sim.simulate(auraFighter(), auraFighter());
  assert.equal(plain.maxHp[0], plain.maxHp[1], '没有该增益时双方上限不变');
  /* 回合payload要带上两边的新上限与当前血量：战斗回放靠它更新血条
   *（否则玩家在战斗里只看到飘字、看不到血量上限变化 —— 这就是用户报的问题）。 */
  assert.ok(Array.isArray(rows[0].maxHp) && rows[0].maxHp.length === 2,
    '玉石俱焚的回合要带 maxHp[2]：' + JSON.stringify(rows[0].maxHp));
  assert.equal(rows[0].maxHp[0], Math.floor(start * 0.9), '第 1 次结算后我方上限 = floor(初始 ×0.9)');
  assert.equal(rows[0].maxHp[1], Math.floor(start * 0.9), '敌方同理');
  assert.ok(Array.isArray(rows[0].hp) && rows[0].hp.every((v) => v <= start), '还要带当前血量');
  assert.ok(rows[1].maxHp[0] < rows[0].maxHp[0], '每结算一次都继续压低');
});

/* ============================================================
 * 涌泉烙印（C52）：治疗量倍率 healMul
 *   塔侧赛前写 f.healMul（+10%/层），sim 的 healOf() 统一读它。
 *   这里锁住：师父驾到（技能 13）等**所有**治疗点都吃这个倍率，
 *   而「枯泉」把它清零 = 完全封疗。
 * ============================================================ */
test('C52 治疗量倍率：师父驾到（技能 13）按 healMul 放大，枯泉清零则封疗', () => {
  const heal13 = (mul) => {
    const g = game(0.01);                     // 钉住随机：师父驾到的判定必过、且不闪避
    const res = g.Sim.simulate(
      fighter({ power: 5, agility: 50, speed: 50, hp: 1000, maxHp: 10000, masterLevel: 4,
        skills: ['13:1'], healMul: mul }),
      fighter({ power: 1, agility: 1, speed: 1, hp: 100000, maxHp: 100000 }));
    const row = (res.rounds || []).find((r) => r.action === 'skill' && Number(r.id) === 13);
    return row ? row.healSelf : null;
  };
  assert.equal(heal13(1), 16, '师父等级 4 → 基础治疗 16');
  assert.equal(heal13(1.1), 18, '×1.1 → 18（涌泉烙印 1 层）');
  assert.equal(heal13(1.2), 19, '×1.2 → 19（2 层）');
  assert.equal(heal13(1.5), 24, '×1.5 → 24');
  assert.equal(heal13(0), 0, '枯泉封疗：healMul=0 时一点都回不了');
  /* 其它治疗点也吃同一个倍率：吸血（lifesteal）与回合回血（regen） */
  const ls = (mul) => {
    const g = game(0.5);
    const res = g.Sim.simulate(
      fighter({ power: 100, agility: 100, speed: 100, hp: 5000, maxHp: 1000000, mods: { lifestealPct: 0.5 }, healMul: mul }),
      fighter({ power: 1, agility: 1, speed: 1, hp: 100000, maxHp: 100000 }));
    const row = res.rounds.find((r) => r.lifesteal);      // 只看第一次（后面会被「回到满血」截断）
    return row ? row.lifesteal : 0;
  };
  assert.equal(ls(1.2), Math.round(ls(1) * 1.2), '吸血也要被放大：×1 = ' + ls(1) + ' / ×1.2 = ' + ls(1.2));
  const rg = (mul) => {
    const g = game(0.5);
    const res = g.Sim.simulate(
      fighter({ power: 1, agility: 1, speed: 1, hp: 5000, maxHp: 1000000, mods: { regenPct: 0.05 }, healMul: mul }),
      fighter({ power: 1, agility: 1, speed: 1, hp: 100000, maxHp: 100000 }));
    const row = res.rounds.find((r) => r.action === 'regen' && (r.heal || 0) > 0);   // 同理只看第一次
    return row ? row.heal : 0;
  };
  assert.equal(rg(1.2), Math.round(rg(1) * 1.2), '回合回血也要被放大：×1 = ' + rg(1) + ' / ×1.2 = ' + rg(1.2));
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name, error); }
}
console.log((tests.length - failed) + '/' + tests.length + ' combat rule checks passed');
if (failed) process.exitCode = 1;
