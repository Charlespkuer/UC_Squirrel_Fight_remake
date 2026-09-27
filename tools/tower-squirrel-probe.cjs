/* 挑战塔诊断探针：走真实 Tower.nextBattle / buildFoe 路径，实测第 4 场（松鼠）单场强度。
 *
 *   node tools/tower-squirrel-probe.cjs [每层采样数]         # 1~8 层第 4 场强度表
 *   node tools/tower-squirrel-probe.cjs 300 --foe=12/5       # 指定玩家 build 复核
 *
 * 验收口径（tools/tower-balance.cjs 是集成关口，这里只看单场手感）：
 *   第 4 场「胜时剩余血量」应与改版前的机制 NPC 同档（≈75~80%），
 *   否则每层 4 场连战的血量继承压力会明显变重。
 * 注意玩家等级固定、层数递增，所以表里胜率逐层下滑是预期的，不是回归。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const N = Math.max(50, Number(process.argv[2]) || 300);
const foeArg = (process.argv.find((a) => a.startsWith('--foe=')) || '').slice(6);

const store = new Map();
class ClockDate extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
const c = { Date: ClockDate, location: { search: '?qa=1' }, console,
  localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } };
c.window = c;
vm.createContext(c);
for (const f of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), c, { filename: f });
}
const { State, Sim, Tower } = c;

State.newGame('松鼠探针');
const S = State.state();
S.level = 35;
for (let id = 1; id <= 18; id++) S.stages[id] = { npcIndex: 3, passed: true };
S.props[23] = 50;

/** 打到第 idx 场（0-based）并取出该场的 foe，然后中断+放弃本层。 */
function pick(layer, idx) {
  Tower._debugSetLayer(layer - 1);
  const started = Tower.startTowerRun();
  if (!started.ok) throw new Error(layer + ' 层开局失败：' + started.msg);
  for (let i = 0; i < idx; i++) {
    const nx = Tower.nextBattle('tower');
    if (!nx.ok) throw new Error('第 ' + (i + 1) + ' 场取场失败：' + nx.msg);
    const me = State.genAI(nx.foe.level, '', { levelJitter: 0, gearSelfLevel: true });
    me.maxHp = me.hp; nx.adjustMe(me);
    // 暖身战一律按胜利结算：本探针只关心第 4 场，输掉暖身战会让整层提前结束
    Tower.reportBattle('tower', nx.token, true, 1);
    const run = Tower.towerInfo().run;
    if (run && run.choices) Tower.pickChoice('tower', Math.max(0, run.choices.findIndex((x) => x.type === 'heal')));
  }
  const nx = Tower.nextBattle('tower');
  if (!nx.ok) { Tower.abandon('tower'); return { error: nx.msg }; }
  const out = { info: nx.info, foe: JSON.parse(JSON.stringify(nx.foe)) };
  Tower.interruptBattle('tower', nx.token); // 清掉 run.attempt，abandon 才肯放手
  Tower.abandon('tower');
  return out;
}

/** 同一 foe 的 N 次采样：胜率 / 胜时剩余血 / 平均回合。 */
function sample(foe, level, gear) {
  let win = 0, left = 0, rd = 0;
  for (let i = 0; i < N; i++) {
    const me = State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
    if (gear) { me.weapons = gear.weapons; me.skills = gear.skills; }
    me.maxHp = me.hp;
    const res = Sim.simulate(me, JSON.parse(JSON.stringify(foe)));
    const last = [...res.rounds].reverse().find((x) => Array.isArray(x.hpAfter));
    if (res.winner === 0) { win++; left += Math.max(0, last.hpAfter[0]) / me.maxHp; }
    rd += res.rounds.length;
  }
  return '胜率' + (win / N * 100).toFixed(0).padStart(3) + '%  剩余血' + (win ? (left / win * 100).toFixed(0) : '0').padStart(3) + '%  回合' + (rd / N).toFixed(1).padStart(4);
}

const playerLevel = 28;
const gear = foeArg ? { weapons: [{ id: Number(foeArg.split('/')[0]), level: Number(foeArg.split('/')[1] || 5) }],
  skills: [{ id: Number(foeArg.split('/')[0]), level: Number(foeArg.split('/')[1] || 5) }] } : null;
console.log('真实 buildFoe 路径 · 第 4 场单场强度（' + playerLevel + ' 级' + (gear ? '固定 build ' + foeArg : '随机配装') + '玩家，每层 ' + N + ' 场）');
for (let layer = 1; layer <= 8; layer++) {
  const nx = pick(layer, 3);
  if (nx.error) { console.log('  层' + layer + ' 取场失败：' + nx.error); continue; }
  console.log('  层' + String(layer).padStart(2) + ' ' + String(nx.info.name).padEnd(6) + ' ' + sample(nx.foe, playerLevel, gear) +
    '  武Lv' + nx.foe.weapons.map((w) => w.level).join('/') + '  技Lv' + nx.foe.skills.map((w) => w.level).join('/'));
}
