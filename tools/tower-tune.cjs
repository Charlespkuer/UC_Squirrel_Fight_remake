/* 塔难度调参器：在沙箱里改写 tower-data.js/tower.js 的系数文本，快速试出达标组合。
 * 用法：node tools/tower-tune.cjs <statCoef> <hpCoef> <m5> <m10> <eliteMul> [runs] */
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const [statC, hpC, m5, m10, eliteM] = [Number(process.argv[2]) || 0.72, Number(process.argv[3]) || 0.95,
  Number(process.argv[4]) || 0.05, Number(process.argv[5]) || 0.08, Number(process.argv[6]) || 1.25];
const RUNS = Math.max(50, Number(process.argv[7]) || 200);

const store = new Map();
class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) } };
c.window = c; vm.createContext(c);
const load = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let towerData = load('js/tower-data.js');
towerData = towerData
  .replace('1 + 0.08 * Math.floor', '1 + ' + m5 + ' * Math.floor')
  .replace('1 + 0.15 * Math.floor', '1 + ' + m10 + ' * Math.floor');
let tower = load('js/tower.js');
tower = tower.replace('statBase * 0.78 * M', 'statBase * ' + statC + ' * M')
  .replace('hpBase * 1.05 * M', 'hpBase * ' + hpC + ' * M')
  .replace('elite ? 1.35 : 1', 'elite ? ' + eliteM + ' : 1');
for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js']) vm.runInContext(load(f), c, { filename: f });
vm.runInContext(towerData, c, { filename: 'tower-data(patched)' });
for (const f of ['js/state.js', 'js/sim.js']) vm.runInContext(load(f), c, { filename: f });
vm.runInContext(tower, c, { filename: 'tower(patched)' });
const { State, Sim, Tower, TowerData } = c;
State.newGame('t'); const S = State.state(); S.level = 70; for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true }; S.props[23] = 9e6;

function single(layer, slot, level) {
  let win = 0;
  for (let i = 0; i < RUNS; i++) {
    Tower._debugSetLayer(layer - 1); Tower.startTowerRun();
    for (let k = 0; k < slot; k++) {
      const nx0 = Tower.nextBattle('tower'); Tower.reportBattle('tower', nx0.token, true, 1);
      const ti = Tower.towerInfo(); if (ti.run && ti.run.choices) Tower.pickChoice('tower', 0);
    }
    const nx = Tower.nextBattle('tower');
    const me = State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true }); me.maxHp = me.hp; nx.adjustMe(me);
    if (Sim.simulate(me, nx.foe).winner === 0) win++;
    Tower.reportBattle('tower', nx.token, false, 0);
  }
  return win / RUNS;
}
function layerClear(layer, level) {
  let ok = 0;
  for (let i = 0; i < RUNS; i++) {
    Tower._debugSetLayer(layer - 1); Tower.startTowerRun();
    let alive = true, guard = 0;
    while (alive && guard++ < 20) {
      const ti = Tower.towerInfo();
      if (!ti.run) break;
      if (ti.run.choices) {
        // 模拟真人策略：血量低于 55% 优先选回血，否则随机拿 buff
        const ch = ti.run.choices;
        const healIdx = ch.findIndex((x) => x.type === 'heal');
        Tower.pickChoice('tower', ti.run.carry < 0.75 && healIdx >= 0 ? healIdx : 1 + Math.floor(Math.random() * (ch.length - 1)));
        continue;
      }
      const nx = Tower.nextBattle('tower');
      const me = State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true }); me.maxHp = me.hp; nx.adjustMe(me);
      const res = Sim.simulate(me, nx.foe);
      const win = res.winner === 0;
      const last = [...res.rounds].reverse().find((r) => Array.isArray(r.hpAfter));
      const ratio = win && last ? Math.max(0, Math.min(1, last.hpAfter[0] / me.maxHp)) : 0;
      const rw = Tower.reportBattle('tower', nx.token, win, ratio);
      if (!win) alive = false; else if (rw.layerComplete) { ok++; break; }
    }
    if (Tower.towerInfo().run) Tower.abandon('tower');
  }
  return ok / RUNS;
}

console.log('系数: stat=' + statC + ' hp=' + hpC + ' M=+5%' + (m5 * 100) + '/+10%' + (m10 * 100) + ' 精英×' + eliteM + '  采样 ' + RUNS);
console.log('层    LT   单场:英雄/NPC/精英   整层(随机选)');
for (const layer of [1, 5, 10, 15, 20, 25, 30]) {
  const LT = TowerData.towerLevel(layer);
  const hero = single(layer, 0, LT), npc = single(layer, 3, LT);
  const elite = layer % 10 === 0 ? single(layer, 4, LT) : null;
  const clear = layerClear(layer, LT);
  console.log(String(layer).padStart(2) + '  ' + String(LT).padStart(3) + '   ' +
    (hero * 100).toFixed(0).padStart(3) + '%  ' + (npc * 100).toFixed(0).padStart(3) + '%  ' +
    (elite == null ? '  —' : (elite * 100).toFixed(0).padStart(3) + '%') + '      ' + (clear * 100).toFixed(0) + '%');
}
