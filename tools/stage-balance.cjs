/* ============================================================
 * 关卡难度平衡测量 + 调参：用「推荐等级的随机玩家」跑三星连战。
 *
 *   node tools/stage-balance.cjs [每档场次] [关卡范围] [调参JSON]
 *
 * 调参 JSON 会在 GData 的 STAGE_DIFFICULTY 之上再叠一层（方便先试再落表）：
 *   {"hp":0.6,"power":0.8,"agility":0.95,"speed":0.95,
 *    "roleHp":[1,1,1],"rolePower":[1,1,1],"starHp":[1,1,1,1,1,1]}
 *
 * 目标：
 *   推荐等级通关率 50%~85%、低 4 级 ≤30%、高 2 级 ≥65%，且每个位置单场胜率 >35%。
 * ============================================================ */
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
const RUNS = Math.max(20, Number(process.argv[2]) || 150);
const rangeArg = process.argv[3] || '1-18';
const TUNE = Object.assign({
  hp: 1, power: 1, agility: 1, speed: 1,
  roleHp: [1, 1, 1], rolePower: [1, 1, 1], starHp: [1, 1, 1, 1, 1, 1],
  typeScale: { tl: 1, xh: 1, xm: 1 },
  alloc: null,
}, parseTune(process.argv[4]));
/** 支持 JSON，也支持 "hp=0.55,power=0.7,roleHp=1|1|1" 这种免引号写法（PowerShell 里好敲）。 */
function parseTune(arg) {
  if (!arg) return {};
  if (arg.trim().startsWith('{')) return JSON.parse(arg);
  const out = {};
  for (const part of String(arg).split(',')) {
    const [key, raw] = part.split('=');
    if (!key || raw == null) continue;
    const values = raw.split('|').map((v) => (v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v.trim()));
    out[key.trim()] = values.length > 1 ? values : values[0];
  }
  return out;
}
const TARGET = { min: 0.50, max: 0.85, lowMax: 0.30, highMin: 0.65 };
// 允许用 tl/xh/xm 直接覆盖每类敌人的强度系数
for (const key of ['tl', 'xh', 'xm']) if (TUNE[key] != null) TUNE.typeScale[key] = TUNE[key];

function setup() {
  const storage = new Map();
  class ClockDate extends Date { static now() { return new Date(2026, 8, 24, 12).getTime(); } }
  const c = { Date: ClockDate, location: { search: '?qa=1' }, console, localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) } };
  c.window = c;
  vm.createContext(c);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js', 'js/sim.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  }
  c.State.newGame('平衡测试');
  return c;
}
const ctx = setup();
const { State, Sim, GData } = ctx;

function targetLevel(stageId) {
  const type = Math.floor((stageId - 1) / 6);
  const star = ((stageId - 1) % 6) + 1;
  return [10, 15, 20][type] + star - 1;
}

/* 实测的「推荐等级下随机玩家均值」线性近似（每档 400 个 genAI 采样）：
 *   三围 ≈ 1.48×等级 − 1.2　生命 ≈ 13.9×等级 − 10
 * formula 模式用它把 NPC 归一到推荐等级上，字典数值只保留同关三人的相对形状。 */
const FORMULA = Object.assign({ stat: GData.STAGE_ROLE_STAT.slice(), hp: GData.STAGE_ROLE_HP.slice(), a: GData.STAGE_PLAYER_CURVE.statPer, b: GData.STAGE_PLAYER_CURVE.statBase, hpA: GData.STAGE_PLAYER_CURVE.hpPer, hpB: GData.STAGE_PLAYER_CURVE.hpBase }, TUNE.formula || {});
if (TUNE.rstat) FORMULA.stat = TUNE.rstat;
if (TUNE.rhp) FORMULA.hp = TUNE.rhp;
if (TUNE.sa != null) FORMULA.a = TUNE.sa;
if (TUNE.sb != null) FORMULA.b = TUNE.sb;
if (TUNE.ha != null) FORMULA.hpA = TUNE.ha;
if (TUNE.hb != null) FORMULA.hpB = TUNE.hb;
const playerStat = (lv) => FORMULA.a * lv + FORMULA.b;
const playerHp = (lv) => FORMULA.hpA * lv + FORMULA.hpB;

function makeFoe(stageId, npcIndex) {
  const npc = State.npcOf(stageId, npcIndex);
  if (!npc) return null;
  const type = GData.stageTypeOf(stageId);
  const s = GData.stageNpcStats(npc);
  const role = npcIndex - 1;
  const star = GData.stageStar(stageId);
  const ts = TUNE.typeScale[type.anim] || 1;
  if (TUNE.formula) {
    const lv = targetLevel(stageId);
    const power = Math.max(1, Math.round(playerStat(lv) * FORMULA.stat[role] * ts));
    const shapeA = Number(npc.agility) / Number(npc.power);
    const shapeS = Number(npc.speed) / Number(npc.power);
    return {
      name: npc.name, level: 10 + stageId * 2, npcType: type.anim,
      power, agility: Math.max(1, Math.round(power * shapeA)), speed: Math.max(1, Math.round(power * shapeS)),
      hp: Math.max(1, Math.round(playerHp(lv) * FORMULA.hp[role])),
      weapons: [],
      skills: String(npc.skills || '').split('|').filter(Boolean).map((x) => { const p = x.split(':'); return { id: +p[0], level: +(p[1] || 1) }; }),
    };
  }
  return {
    name: npc.name, level: 10 + stageId * 2,
    power: Math.max(1, Math.round(s.power * TUNE.power * TUNE.rolePower[role] * ts)),
    agility: Math.max(1, Math.round(s.agility * TUNE.agility * ts)),
    speed: Math.max(1, Math.round(s.speed * TUNE.speed * ts)),
    hp: Math.max(1, Math.round(+npc.hp * TUNE.hp * TUNE.roleHp[role] * TUNE.starHp[star - 1])),
    weapons: [], npcType: type.anim,
    skills: String(npc.skills || '').split('|').filter(Boolean).map((x) => { const p = x.split(':'); return { id: +p[0], level: +(p[1] || 1) }; }),
  };
}

function runStage(stageId, level) {
  const me = State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true, freePointBias: TUNE.alloc });
  const maxHp = me.hp;
  let ratio = 1;
  const fightWins = [];
  let rounds = 0;
  for (let idx = 1; idx <= 3; idx++) {
    const res = Sim.simulate(Object.assign({}, me, { hp: Math.max(1, Math.round(maxHp * ratio)), maxHp }), makeFoe(stageId, idx));
    rounds += res.rounds.length;
    const win = res.winner === 0;
    fightWins.push(win);
    if (!win) return { cleared: false, fightWins, rounds };
    const left = Array.isArray(res.hpAfter) ? res.hpAfter[0] : res.rounds.at(-1).hpAfter[0];
    ratio = Math.min(1, Math.max(0, left / maxHp) + 0.25);
  }
  return { cleared: true, fightWins, rounds };
}

function measure(stageId, level) {
  let cleared = 0, rounds = 0;
  const perFight = [0, 0, 0];
  for (let i = 0; i < RUNS; i++) {
    const r = runStage(stageId, level);
    if (r.cleared) cleared++;
    rounds += r.rounds;
    r.fightWins.forEach((w, i) => { if (w) perFight[i]++; });
  }
  return { cleared: cleared / RUNS, perFight: perFight.map((n) => n / RUNS), rounds: rounds / RUNS };
}

const pct = (v) => (v * 100).toFixed(0).padStart(3) + '%';
const [lo, hi] = rangeArg.split('-').map(Number);
const fails = [];
console.log('每档 ' + RUNS + ' 场  调参 ' + JSON.stringify(TUNE) + '\n');
console.log('关卡       目标   低4          低2          目标         高2          回合  三场胜率(目标等级)');
for (let stageId = lo; stageId <= (hi || lo); stageId++) {
  const target = targetLevel(stageId);
  const type = GData.stageTypeOf(stageId).name;
  const star = GData.stageStar(stageId);
  const levels = [target - 4, target - 2, target, target + 2];
  const res = levels.map((lv) => measure(stageId, lv));
  const at = res[2];
  const label = type + '★' + star;
  const ok = at.cleared >= TARGET.min && at.cleared <= TARGET.max
    && res[0].cleared <= TARGET.lowMax && res[3].cleared >= TARGET.highMin
    && at.perFight.every((p) => p > 0.35);
  if (!ok) fails.push(label + '(' + pct(at.cleared) + ' 低4:' + pct(res[0].cleared) + ' 高2:' + pct(res[3].cleared) + ')');
  console.log(
    label.padEnd(8) + String(target).padStart(4) + '  ' +
    res.map((m) => pct(m.cleared)).join('         ') + '  ' +
    at.rounds.toFixed(1).padStart(5) + '  ' + at.perFight.map(pct).join('/') + (ok ? '' : '  ← 不达标')
  );
}
console.log('\n不达标：' + (fails.length ? fails.join('  ') : '无'));
