/* 单场 + 连战的细粒度测量：打印玩家与 NPC 的裸属性/装备、单场胜率、平均回合与平均伤害。
 *   node tools/stage-balance-detail.cjs [每档场次] [关卡id] [玩家等级]
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const RUNS = Math.max(10, Number(process.argv[2]) || 200);
const STAGE = Number(process.argv[3]) || 1;
const LEVEL = Number(process.argv[4]) || 10;

function setup() {
  const storage = new Map();
  class ClockDate extends Date { static now() { return new Date(2026, 8, 24, 12).getTime(); } }
  const c = { Date: ClockDate, location: { search: '?qa=1' }, console, localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) } };
  c.window = c; vm.createContext(c);
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/state.js', 'js/sim.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  }
  c.State.newGame('细节测试');
  return c;
}
const ctx = setup();
const { State, Sim, GData } = ctx;

function foeOf(stageId, npcIndex) {
  const npc = State.npcOf(stageId, npcIndex);
  const type = GData.stageTypeOf(stageId);
  const s = GData.stageNpcStats(npc);
  return {
    name: npc.name, level: 10 + stageId * 2, power: s.power, agility: s.agility, speed: s.speed, hp: +npc.hp,
    weapons: [], npcType: type.anim,
    skills: String(npc.skills || '').split('|').filter(Boolean).map((x) => { const p = x.split(':'); return { id: +p[0], level: +(p[1] || 1) }; }),
  };
}

function avgPlayer(level, n) {
  const acc = { power: 0, agility: 0, speed: 0, hp: 0, bareHp: 0, weapons: 0, skills: 0, gears: 0 };
  for (let i = 0; i < n; i++) {
    const m = State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
    acc.power += m.power; acc.agility += m.agility; acc.speed += m.speed; acc.hp += m.hp; acc.bareHp += m.baseStats.hp;
    acc.weapons += m.weapons.length; acc.skills += m.skills.length; acc.gears += (m.gears || []).length;
  }
  for (const k of Object.keys(acc)) acc[k] = Math.round(acc[k] / n * 10) / 10;
  return acc;
}

console.log('关卡 ' + STAGE + '（' + GData.stageTypeOf(STAGE).name + '★' + GData.stageStar(STAGE) + '） 玩家等级 ' + LEVEL + '，每组 ' + RUNS + ' 场');
console.log('玩家平均（随机同等级 AI）：', JSON.stringify(avgPlayer(LEVEL, RUNS)));
console.log('\n位置  NPC         力/敏/速        血    单场胜率  平均回合  玩家剩余血量比');
for (let idx = 1; idx <= 3; idx++) {
  const foe = foeOf(STAGE, idx);
  let wins = 0, rounds = 0, hpLeft = 0;
  for (let i = 0; i < RUNS; i++) {
    const me = State.genAI(LEVEL, '', { levelJitter: 0, gearSelfLevel: true });
    const res = Sim.simulate(me, foe);
    rounds += res.rounds.length;
    const left = res.hpAfter ? res.hpAfter[0] : res.rounds.at(-1).hpAfter[0];
    const maxHp = me.hp;
    if (res.winner === 0) { wins++; hpLeft += left / maxHp; }
  }
  console.log(
    String(idx).padEnd(4) + '  ' + foe.name.padEnd(11) +
    String(foe.power + '/' + foe.agility + '/' + foe.speed).padEnd(14) +
    String(foe.hp).padStart(5) + '   ' +
    ((wins / RUNS * 100).toFixed(0) + '%').padStart(5) + '   ' +
    (rounds / RUNS).toFixed(1).padStart(6) + '   ' +
    (wins ? (hpLeft / wins * 100).toFixed(0) + '%' : '—').padStart(6)
  );
}

// 连战
let cleared = 0;
for (let i = 0; i < RUNS; i++) {
  const me = State.genAI(LEVEL, '', { levelJitter: 0, gearSelfLevel: true });
  const maxHp = me.hp;
  let ratio = 1, ok = true;
  for (let idx = 1; idx <= 3 && ok; idx++) {
    const res = Sim.simulate(Object.assign({}, me, { hp: Math.max(1, Math.round(maxHp * ratio)), maxHp }), foeOf(STAGE, idx));
    if (res.winner !== 0) { ok = false; break; }
    const left = res.hpAfter ? res.hpAfter[0] : res.rounds.at(-1).hpAfter[0];
    ratio = Math.min(1, Math.max(0, left / maxHp) + 0.25);
  }
  if (ok) cleared++;
}
console.log('\n整轮三星连战通关率：' + (cleared / RUNS * 100).toFixed(0) + '%');
