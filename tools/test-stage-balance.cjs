/* ============================================================
 * 关卡难度回归：用「推荐等级的随机玩家」跑三星连战，检查难度没有跑偏。
 *   node tools/test-stage-balance.cjs
 *
 * 断言：
 *   1) 推荐等级下每档通关率落在 35%~95%（原来 0%~23%，明显打不过）
 *   2) 低 4 级明显更难（比推荐等级低 15 个百分点以上）
 *   3) 高 2 级明显更轻松（比低 4 级高 20 个百分点以上、且不低于 55%）
 *   4) 每场（学徒/拳师/大侠）在推荐等级下都有胜机（>25%）
 * ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
const CHAINS = 60;
const SAMPLE = [1, 6, 7, 12, 13, 18];

function setup() {
  const storage = new Map();
  class ClockDate extends Date { static now() { return new Date(2026, 8, 24, 12).getTime(); } }
  const c = { Date: ClockDate, location: { search: '?qa=1' }, console, localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) } };
  c.window = c;
  vm.createContext(c);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js', 'js/sim.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  }
  c.State.newGame('难度回归');
  return c;
}
const ctx = setup();
const { State, Sim, GData } = ctx;

function makeFoe(stageId, npcIndex) {
  const npc = State.npcOf(stageId, npcIndex);
  const type = GData.stageTypeOf(stageId);
  const s = GData.stageNpcStats(npc);
  return {
    name: npc.name, level: 10 + stageId * 2, power: s.power, agility: s.agility, speed: s.speed, hp: +npc.hp,
    weapons: [], npcType: type.anim,
    skills: String(npc.skills || '').split('|').filter(Boolean).map((x) => { const p = x.split(':'); return { id: +p[0], level: +(p[1] || 1) }; }),
  };
}

function measure(stageId, level, runs) {
  let cleared = 0;
  const perFight = [0, 0, 0];
  for (let i = 0; i < runs; i++) {
    const me = State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
    const maxHp = me.hp;
    let ratio = 1, ok = true;
    for (let idx = 1; idx <= 3 && ok; idx++) {
      const res = Sim.simulate(Object.assign({}, me, { hp: Math.max(1, Math.round(maxHp * ratio)), maxHp }), makeFoe(stageId, idx));
      const win = res.winner === 0;
      if (win) perFight[idx - 1]++;
      if (!win) { ok = false; break; }
      const left = Array.isArray(res.hpAfter) ? res.hpAfter[0] : res.rounds.at(-1).hpAfter[0];
      ratio = Math.min(1, Math.max(0, left / maxHp) + 0.25);
    }
    if (ok) cleared++;
  }
  return { cleared: cleared / runs, perFight: perFight.map((n) => n / runs) };
}

const pct = (v) => (v * 100).toFixed(0) + '%';
for (const stageId of SAMPLE) {
  const target = GData.stageTargetLevel(stageId);
  const label = GData.stageTypeOf(stageId).name + '★' + GData.stageStar(stageId);
  const low = measure(stageId, target - 4, CHAINS);
  const at = measure(stageId, target, CHAINS);
  const high = measure(stageId, target + 2, CHAINS);
  const info = label + ' 推荐' + target + '级：低4 ' + pct(low.cleared) + ' / 目标 ' + pct(at.cleared) + ' / 高2 ' + pct(high.cleared) +
    '　三场 ' + at.perFight.map(pct).join('/');
  assert.ok(at.cleared >= 0.35 && at.cleared <= 0.95, '推荐等级通关率应在 35%~95%：' + info);
  assert.ok(low.cleared <= at.cleared - 0.15, '低 4 级应明显更难：' + info);
  assert.ok(high.cleared >= low.cleared + 0.2 && high.cleared >= 0.55, '高 2 级应明显更轻松：' + info);
  at.perFight.forEach((p, i) => assert.ok(p > 0.25, '第' + (i + 1) + '场在推荐等级下要有胜机：' + info));
  console.log('PASS ' + info);
}
console.log('关卡难度回归通过：' + SAMPLE.length + ' 档 × 每档 ' + CHAINS + ' 轮三星连战。');
