/* ============================================================
 * 生成 docs/出手权重平衡表.md —— 出手权重（武器 / 技能 / 徒手）实测数值表
 *
 *   node tools/gen-weight-sheet.cjs > docs/出手权重平衡表.md
 *
 * 所有数字都由 js/sim.js 的导出函数现算（kindWeights / actionWeights / repeatRateOf / rules），
 * 所以调完 RULES 或 repeatRateOf 的曲线之后重新生成一次，文档就与代码同步，不会手抄走样。
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const c = { console };
c.window = c;
vm.createContext(c);
for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/sim.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), c, { filename: f });
}
const S = c.Sim, R = S.rules;
const W = (id) => ({ id, level: 1 });
const att = (extra) => Object.assign({ usedWeapons: {}, usedSkills: {}, skillUseCount: {}, lastWeaponId: null, lastSkillId: null }, extra || {});
const pct = (v) => (v * 100).toFixed(2) + '%';
const num = (v) => (Math.round(v * 10) / 10).toString();
const skillName = (id) => { const it = c.skillsMap.getValue(id); return it ? it.name : String(id); };
const ACTIVE = [8, 12, 14, 15, 17, 18, 23];          // 真正进出手池的主动技
const SPECIAL = [12, 17];                            // 两段式（15 → 5）的两个技能
const out = [];
const p = (line) => out.push(line === undefined ? '' : line);
const toolTotal = (a, ws, sk) => { const k = S.kindWeights(a, ws, sk); return k.weapon + k.skill; };

p('# 出手权重平衡表（武器 / 技能 / 徒手）');
p();
p('> **本文件由 `node tools/gen-weight-sheet.cjs` 自动生成**，所有数字都从 [`js/sim.js`](js/sim.js) 现算，');
p('> 改完 `RULES` / `repeatRateOf` 之后重新生成一次即可，不会手抄走样。');
p('>');
p('> 模型说明见 [战斗系统数值手册.md](战斗系统数值手册.md) §3；本文只放数值与调参入口。');
p();
p(`> **当前参数**：\`repeatWeapon = ${R.repeatWeapon}\`、\`repeatSkill = ${R.repeatSkill}\`、`);
p(`> \`repeatSpecialFirst = ${R.repeatSpecialFirst}\`（17/12 用过 1 次后）、\`repeatSpecialAgain = ${R.repeatSpecialAgain}\`（17/12 用过 2 次及以后）、`);
p(`> \`commonAttackWeight = ${R.commonAttackWeight}\`、\`npcSkillChance = ${R.npcSkillChance}\`、\`LAST_PENALTY = 0.3\`、\`UNUSED_WEIGHT = 100\`。`);
p();
p('---');
p();
p('## 1. 模型一句话');
p();
p('三个池子放进**同一次加权抽取**：');
p();
p('```');
p(`武器权重 = (本场用过 ? repeatWeapon(${R.repeatWeapon}) : 100) × (上一招是它 ? 0.3 : 1)`);
p(`技能权重 = (本场用过 ? 该技能的二次档位 : 100) × (上一招是它 ? 0.3 : 1) × (1 + skillBoost)`);
p(`徒手权重 = RULES.commonAttackWeight(${R.commonAttackWeight})                  ← 常数`);
p();
p('P(某一项) = 它的权重 / (Σ武器权重 + Σ技能权重 + 徒手权重)');
p('```');
p();
p('- 「没用过 100」是**同一个池子里的相对基准**，不是百分比。');
p('- 只有**当前可用**的候选参与求和：缴械时武器池清空、沉默/冷却/本回合已用/满血不放（来点松果）的技能不进池。');
p('- 技能的二档只分两类：**来点松果(17) / 野球拳(12)** 两段式，**其余技能**一律 `repeatSkill`。');
p();
p('---');
p();
p('## 2. 单件权重表（状态 → 权重）');
p();
p(`所有武器共用同一行（**当前没有按武器区分的权重字段**）；技能按 §2.1 的两类分档。`);
p();
const wFresh = S.actionWeights.weapon(att(), 6);
const wUsed = S.actionWeights.weapon(att({ usedWeapons: { 6: true } }), 6);
const wLast = S.actionWeights.weapon(att({ usedWeapons: { 6: true }, lastWeaponId: 6 }), 6);
const sFresh = S.actionWeights.skill(att(), 8);
const skUsed = (id, n) => S.actionWeights.skill(att({ usedSkills: { [id]: true }, skillUseCount: { [id]: n } }), id);
const skLast = (id, n) => S.actionWeights.skill(att({ usedSkills: { [id]: true }, skillUseCount: { [id]: n }, lastSkillId: id }), id);
p(`| 状态 | 武器 | 技能（其余） | 技能 ${SPECIAL.join(' / ')} |`);
p('| --- | --- | --- | --- |');
p(`| 本场没用过 | **${num(wFresh)}** | **${num(sFresh)}** | **${num(sFresh)}** |`);
p(`| 用过 1 次 | ${num(wUsed)} | ${num(skUsed(8, 1))} | ${num(skUsed(12, 1))} |`);
p(`| 用过 2 次 | ${num(wUsed)} | ${num(skUsed(8, 2))} | ${num(skUsed(12, 2))} |`);
p(`| 用过 3 次及以后 | ${num(wUsed)} | ${num(skUsed(8, 3))} | ${num(skUsed(12, 3))} |`);
p(`| 用过且是**上一招**（×0.3） | ${num(wLast)} | ${num(skLast(8, 1))} | ${num(skLast(12, 1))} |`);
p();
p(`### 2.1 逐技能明细（只有这 ${ACTIVE.length} 个会进出手池）`);
p();
p('| id | 名称 | 未用 | 用 1 次 | 用 2 次 | 用 3 次 | 上一招 ×0.3 | 附加限制 |');
p('| --- | --- | --- | --- | --- | --- | --- | --- |');
const LIMIT = { 8: '可被闪避', 12: '第 2 次起每次出手前先过「能不能放」的判定', 14: '**每场 1 次**，用后出池（后面几行仅供对照）', 15: '可被闪避', 17: '**每场 1 次**且**满血不放**', 18: '无视装死', 23: '必中' };
for (const id of ACTIVE) {
  const r = (n) => num(skUsed(id, n));
  p(`| ${id} | ${skillName(id)} | 100 | ${r(1)} | ${r(2)} | ${r(3)} | ${num(skLast(id, 1))} | ${LIMIT[id] || ''} |`);
}
p();
p('其余技能（1~7、9~11、13、16、24）是**被动 / 防御 / 受击触发**，**永远不进权重池**：');
p('触发率见手册 §5.1（7 龟甲术、16 绝对防御、6 装死、13 师父驾到、9/10/11/24 常驻被动）。');
p();
p('---');
p();
p('## 3. 徒手权重对比：持有数量 × 是否轮过一遍');
p();
p(`徒手权重固定为 ${R.commonAttackWeight}；工具总权重随件数与使用状态变化。`);
p();
const SETS = [[1, 0], [0, 1], [1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 4], [6, 6], [0, 7], [7, 0]];
p('| 武器数 | 技能数 | 全新：工具权重 | 全新 武器/技能/徒手 | 全用过：工具权重 | 全用过 武器/技能/徒手 |');
p('| --- | --- | --- | --- | --- | --- |');
for (const [nw, ns] of SETS) {
  const ws = Array.from({ length: nw }, (_, i) => W(i + 1));
  const sk = ACTIVE.slice(0, ns);
  const a1 = att(), a2 = att();
  ws.forEach((w) => { a2.usedWeapons[w.id] = true; });
  sk.forEach((id) => { a2.usedSkills[id] = true; a2.skillUseCount[id] = 1; });
  const k1 = S.kindWeights(a1, ws, sk), k2 = S.kindWeights(a2, ws, sk);
  p(`| ${nw} | ${ns} | ${num(k1.weapon + k1.skill)} | ${pct(k1.weaponShare)} / ${pct(k1.skillShare)} / **${pct(k1.commonShare)}** | ` +
    `${num(k2.weapon + k2.skill)} | ${pct(k2.weaponShare)} / ${pct(k2.skillShare)} / **${pct(k2.commonShare)}** |`);
}
p();
p('> 「全用过」按各技能用 1 次计（17/12 → 15，其余 → 20）。');
p();
p('### 3.1 徒手份额曲线（只有武器）');
p();
p('| 工具总数 | 全新徒手 | 全用过徒手 | 工具总数 | 全新徒手 | 全用过徒手 |');
p('| --- | --- | --- | --- | --- | --- |');
const curve = [];
for (let n = 1; n <= 12; n++) {
  const ws = Array.from({ length: n }, (_, i) => W(i + 1));
  const a1 = att(), a2 = att();
  ws.forEach((w) => { a2.usedWeapons[w.id] = true; });
  curve.push([n, S.kindWeights(a1, ws, []).commonShare, S.kindWeights(a2, ws, []).commonShare]);
}
for (let i = 0; i < 6; i++) {
  const l = curve[i], r2 = curve[i + 6];
  p(`| ${l[0]} | ${pct(l[1])} | ${pct(l[2])} | ${r2[0]} | ${pct(r2[1])} | ${pct(r2[2])} |`);
}
p();
p('---');
p();
p('## 4. 单件份额示例：3 武器（6/8/13）＋ 3 技能（12/18/23）');
p();
const ws3 = [W(6), W(8), W(13)], sk3 = [12, 18, 23];
function example(title, a) {
  const k = S.kindWeights(a, ws3, sk3);
  p(`### ${title}`);
  p();
  p(`总权重 ${num(k.total)}（武器 ${num(k.weapon)} / 技能 ${num(k.skill)} / 徒手 ${num(k.common)}）`);
  p();
  p('| 项 | 权重 | 占全部出手 | 占工具出手 |');
  p('| --- | --- | --- | --- |');
  for (const w of ws3) {
    const ww = S.actionWeights.weapon(a, w.id);
    p(`| 武器 ${w.id} | ${num(ww)} | ${pct(ww / k.total)} | ${pct(ww / (k.weapon + k.skill))} |`);
  }
  for (const id of sk3) {
    const sw = S.actionWeights.skill(a, id);
    p(`| 技能 ${id} ${skillName(id)} | ${num(sw)} | ${pct(sw / k.total)} | ${pct(sw / (k.weapon + k.skill))} |`);
  }
  p(`| **徒手** | ${num(k.common)} | **${pct(k.commonShare)}** | — |`);
  p();
}
example('4.1 全部全新', att());
const mid = att({ usedWeapons: { 6: true }, usedSkills: { 12: true }, skillUseCount: { 12: 1 } });
example('4.2 各用过一次（技能 12 已用 1 次）', mid);
const last = att({ usedWeapons: { 6: true, 8: true }, usedSkills: { 12: true }, skillUseCount: { 12: 1 }, lastWeaponId: 8, lastSkillId: 12 });
example('4.3 刚用过「武器 8 + 技能 12」（再 ×0.3）', last);
const boost = att({ skillBoost: { 12: 0.6 } });
const kb = S.kindWeights(boost, ws3, sk3), k0 = S.kindWeights(att(), ws3, sk3);
p('### 4.4 C33「秘技通神」+60% 的效果（以技能 12 为例）');
p();
p('| 情形 | 技能 12 权重 | 技能档份额 |');
p('| --- | --- | --- |');
p(`| 全新 | ${num(S.actionWeights.skill(att(), 12))} | ${pct(k0.skillShare)} |`);
p(`| 抽中 C33（×1.6） | ${num(S.actionWeights.skill(boost, 12))} | ${pct(kb.skillShare)} |`);
p(`| 用过 1 次 + C33 | ${num(skUsed(12, 1) * 1.6)} | — |`);
p(`| 用过 2 次 + C33 | ${num(skUsed(12, 2) * 1.6)} | — |`);
p();
p('---');
p();
p(`## 5. \`commonAttackWeight\` 敏感度（调徒手最直接的旋钮）`);
p();
p('列：1 武器+1 技能全新 / 3+3 全新 / 6+6 全新（工具总权重 = 该配置的固定值）。');
p();
const sens = [[1, 1], [3, 3], [6, 6]].map(([nw, ns]) => {
  const ws = Array.from({ length: nw }, (_, i) => W(i + 1));
  return toolTotal(att(), ws, ACTIVE.slice(0, ns));
});
p('| commonAttackWeight | 1+1（工具 ' + num(sens[0]) + '） | 3+3（工具 ' + num(sens[1]) + '） | 6+6（工具 ' + num(sens[2]) + '） |');
p('| --- | --- | --- | --- |');
for (const cw of [10, 15, 20, 30, 40, 60, 80, 100]) {
  p(`| ${cw === R.commonAttackWeight ? '**' + cw + '（当前）**' : cw} | ${sens.map((t) => pct(cw / (t + cw))).join(' | ')} |`);
}
p();
p('反查：想让「3 武器 + 3 技能**全用过**」（工具权重见 §3 对应行）的徒手占比达到目标值：');
p();
const usedTools = toolTotal((() => { const a = att(); ws3.forEach((w) => { a.usedWeapons[w.id] = true; }); sk3.forEach((id) => { a.usedSkills[id] = true; a.skillUseCount[id] = 1; }); return a; })(), ws3, sk3);
p('| 目标徒手 | 需要的 commonAttackWeight |');
p('| --- | --- |');
for (const t of [0.05, 0.10, 0.15, 0.20, 0.25, 0.30]) p(`| ${pct(t)} | ≈ ${num(t / (1 - t) * usedTools)} |`);
p();
p('---');
p();
p('## 6. 旧口径对照（2026-10 改版前 vs 现在）');
p();
p('| 场景 | 旧（固定档位 48/40/12 等） | 现在 |');
p('| --- | --- | --- |');
const one1f = S.kindWeights(att(), [W(6)], [12]), one1u = S.kindWeights(att({ usedWeapons: { 6: true }, usedSkills: { 12: true }, skillUseCount: { 12: 1 } }), [W(6)], [12]);
const oneWf = S.kindWeights(att(), [W(6)], []), oneWu = S.kindWeights(att({ usedWeapons: { 6: true } }), [W(6)], []);
const oneSf = S.kindWeights(att(), [], [12]), oneSu = S.kindWeights(att({ usedSkills: { 12: true }, skillUseCount: { 12: 1 } }), [], [12]);
const row = (label, oldTxt, k) => p(`| ${label} | ${oldTxt} | ${pct(k.weaponShare)} / ${pct(k.skillShare)} / ${pct(k.commonShare)} |`);
row('1 武器 + 1 技能，全新', '武器 48% / 技能 40% / 徒手 12%', one1f);
row('1 武器 + 1 技能，全用过', '武器 70% / 技能 18% / 徒手 12%', one1u);
row('只有 1 武器，全新', '78% / — / 22%', oneWf);
row('只有 1 武器，用过', '78% / — / 22%', oneWu);
row('只有 1 技能，全新', '— / 70% / 30%', oneSf);
row('只有 1 技能，用过', '— / 70% / 30%', oneSu);
p();
p('要点：**「全用过之后徒手变多」和「只有 1 技能用过后不再被强制复用」都是改版后才有**（旧版恒定 12% / 恒定 70%）。');
p();
p('---');
p();
p('## 7. 不走权重抽签的分支（读表前必须知道的例外）');
p();
p('| 分支 | 行为 | 位置 |');
p('| --- | --- | --- |');
p('| 固定循环敌人（挑战塔松鼠 boss、题面 boss） | 完全按 `pattern` 数组出招，**不看权重** | `sim.js` 的 `att.pattern` 分支 |');
p('| C33 抽中小宇宙（`mods.cosmosFirst`） | 开战第一招**强制**放技能 14 | `forceCosmos` |');
p('| 方天画戟（武器 1）已蓄力（`pendingWeapon`） | 下一次出手**强制**用武器 | `sim.js` |');
p('| 缴械 / 沉默 | 对应池子直接清空（只影响权重分母，不影响规则） | `canWeapon` / `canSkill` |');
p('| 三侠等纯 NPC（`npcType`） | 独立固定档位：`npcSkillChance = ' + R.npcSkillChance + '`（技能 / 普攻） | `pickNpcKind` |');
p('| 玩家式 AI（挑战 / 竞技 / 天梯 / 师徒对手） | **与玩家同一套权重**（对称） | `playerLikeAction` |');
p();
p('---');
p();
p('## 8. 目前**无法**通过数据表调整的东西（需要改代码）');
p();
p('1. **单件武器的权重差异**：所有武器完全对称，没有「某把武器更少见」的字段。');
p('   ⇒ 副作用：**低等级 / 低伤害的旧武器与神装的出现频率完全一样**（只要还在背包里）。');
p('   想区分的话，最小改动是在 `weaponWeight()` 里加一张 `WEAPON_WEIGHT[id]` 表（默认 1），');
p('   或者按 `w.level` / 基础伤害给一个「越强越常出」的系数。');
p(`2. **徒手权重随持有数量变化**：\`commonAttackWeight\` 是常数（${R.commonAttackWeight}），`);
p('   「高持有玩家少普攻」靠的是**工具总权重随件数增长**的边际效应（见 §3.1 曲线），不是显式函数。');
p('3. **每场战斗内的权重漂移**：只有「用过 / 刚用过」两档状态，没有「随回合数递减」之类的函数。');
p(`4. **技能 14 / 17 的重复档位**：它们每场 1 次、用后出池，所以表中「用 2 次及以后」的行只是理论值。`);
p();
p('---');
p();
p('## 9. 复算方式（改完自己验）');
p();
p('```js');
p('// 照 tools/test-combat-rules.cjs 的 game() 加载 gamedata.js + sim.js 之后：');
p('const S = c.Sim;');
p('const att = { usedWeapons: {}, usedSkills: {}, skillUseCount: {}, lastWeaponId: null, lastSkillId: null };');
p('S.kindWeights(att, [{ id: 6 }], [12]);   // → { weapon, skill, common, total, weaponShare, skillShare, commonShare }');
p('S.actionWeights.weapon(att, 6);          // → 单件武器权重（没用过 = 100）');
p('S.actionWeights.skill(att, 12);          // → 单件技能权重');
p('S.repeatRateOf(12, 2);                   // → 用过 2 次之后的档位');
p('S.rules;                                 // → 全部 RULES 常量');
p('```');
p();
p('| 想改什么 | 位置 |');
p('| --- | --- |');
p(`| 徒手权重（全局） | \`RULES.commonAttackWeight\`（${R.commonAttackWeight}） |`);
p(`| 武器二次权重 | \`RULES.repeatWeapon\`（${R.repeatWeapon}） |`);
p(`| 其余技能的二次权重 | \`RULES.repeatSkill\`（${R.repeatSkill}） |`);
p(`| 来点松果 / 野球拳的二次权重 | \`RULES.repeatSpecialFirst\`（${R.repeatSpecialFirst}）/ \`repeatSpecialAgain\`（${R.repeatSpecialAgain}） |`);
p(`| 受这份曲线影响的技能 id | \`js/sim.js\` \`repeatRateOf()\` 里判定 \`id !== 12 && id !== 17\` 的那一行 |`);
p(`| 「没用过」的基准权重 | \`js/sim.js\` \`UNUSED_WEIGHT\`（100） |`);
p(`| 「上一招」惩罚 | \`js/sim.js\` \`LAST_PENALTY\`（0.3） |`);
p(`| C33 的技能加成 | \`js/tower-data.js\` C33 的 \`pickSkillPct\`（0.60）与 \`tower.js\` 的 \`DEFENSE_PICK_BOOST/JUE_DUI_PICK_BOOST\` |`);
p(`| 纯 NPC 档位 | \`RULES.npcSkillChance\`（${R.npcSkillChance}） |`);
p();
p('> 改完至少跑：`node tools/test-combat-rules.cjs`（45 项，含出手模型三条性质与三档口径）、`node tools/test-fixes-round.cjs`（107 项）。');
p('> 重新生成本文：`node tools/gen-weight-sheet.cjs > docs/出手权重平衡表.md`。');
p();

process.stdout.write(out.join('\n'));
