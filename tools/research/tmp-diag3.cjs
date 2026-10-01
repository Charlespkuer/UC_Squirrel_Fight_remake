/* 临时诊断：任务 4（选取型只出一次）/ 任务 5（扩容背包重复）/ 任务 6（右侧敌人对不上） */
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const store = new Map();
class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) } };
c.window = c; vm.createContext(c);
const load = (f) => fs.readFileSync(path.join(root, f), 'utf8');
for (const f of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
  vm.runInContext(load(f), c, { filename: f });
}
const { State, Tower, TowerData } = c;
State.newGame('diag');
const S = State.state();
S.level = 70;
for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };

function fresh() {
  Tower._debugSetLayer(9);
  let st = Tower.startEndlessRun();
  for (let g = 0; !st.ok && g < 5; g++) {
    const r = Tower._debugRun('endless');
    if (r && r.attempt) { try { Tower.reportBattle('endless', r.attempt, false, 0); } catch (e) { } }
    try { Tower.abandon('endless'); } catch (e) { }
    st = Tower.startEndlessRun();
  }
  return st;
}
function win() {
  const nx = Tower.nextBattle('endless');
  if (!nx || !nx.foe) return null;
  Tower.reportBattle('endless', nx.token, true, 0.9);
  return nx;
}
function clearPhase() {
  const info = Tower.endlessInfo();
  if (info.run && info.run.choices) Tower.pickChoice('endless', 0);
  const r = Tower._debugRun('endless');
  if (r && r.phase === 'shop') { try { Tower.continueFromShop(); } catch (e) { } }
  const r2 = Tower._debugRun('endless');
  if (r2 && r2.phase === 'checkpoint') { try { Tower.continueEndless(); } catch (e) { } }
}

console.log('=== 任务 6：右侧敌人列表（preview）vs 实际 plan（按正确的键比对）===');
{
  fresh();
  for (let i = 0; i < 3; i++) { win(); clearPhase(); }
  let bad = 0;
  for (let round = 0; round < 10; round++) {
    const run = Tower._debugRun('endless');
    if (!run) break;
    const prev = Tower.preview(run.layer, run.salt);
    const plan = run.plan || [];
    const key = (e) => (e.kind === 'hero' ? 'hero:' + e.anim : e.kind + ':' + e.id);
    const pk = prev.map(key).join('|');
    const lk = plan.map(key).join('|');
    if (pk !== lk) {
      bad++;
      console.log('  层 ' + run.layer + ' 键不一致：');
      console.log('    preview: ' + pk);
      console.log('    plan   : ' + lk);
    }
    // 预告里的名字 / 类型 vs 实战 nextBattle 报出来的名字 / 类型
    for (let i = 0; i < plan.length; i++) {
      const real = (function () {
        // 直接按计划项取实战信息（不等于真的打，但和 nextBattle 同源）
        return run.plan[i];
      })();
      void real;
    }
    let guard = 0;
    const fromLayer = run.layer;
    while (guard++ < 12 && Tower._debugRun('endless') && Tower._debugRun('endless').layer === fromLayer) {
      win(); clearPhase();
    }
  }
  console.log('  键不一致 ' + bad + ' 次');
  // 再把「预告名字 vs 实战名字」逐个对上（打一场核对一场）
  fresh();
  const plan0 = Tower._debugRun('endless').plan;
  const prev0 = Tower.preview(1, Tower._debugRun('endless').salt);
  console.log('  第 1 层预告: ' + prev0.map((e) => e.name + '(' + e.type + ')').join(' | '));
  for (let i = 0; i < plan0.length && i < 4; i++) {
    const nx = Tower.nextBattle('endless');
    if (!nx || !nx.ok) { console.log('    第 ' + (i + 1) + ' 场取不到：' + JSON.stringify(nx && nx.msg)); break; }
    console.log('    实战第 ' + (i + 1) + ' 场 = ' + nx.info.name + '（' + nx.info.type + '）kind=' + nx.entry.kind +
      '  预告 = ' + prev0[i].name + '（' + prev0[i].type + '）kind=' + prev0[i].kind);
    Tower.reportBattle('endless', nx.token, true, 0.9);
    clearPhase();
  }
  Tower.abandon('endless');
}

console.log('\n=== 任务 5：商店会不会重复给「扩容背包」C30 ===');
{
  fresh();
  let offered = 0, shops = 0;
  for (let i = 0; i < 200 && offered < 3; i++) {
    // 直接刷商店货架：用 openRestShop（需要 choices）
    win();
    const run = Tower._debugRun('endless');
    if (!run) break;
    if (run.choices) {
      const res = Tower.openRestShop();
      if (res && res.ok) {
        shops++;
        const st = Tower.shopState();
        for (const sl of st.slots) if (sl.id === 'C30' || sl.id === 'C31') offered++;
        // 买下它（如果出现），验证能否再被刷出来
        const slot = st.slots.findIndex((sl) => sl.id === 'C30');
        if (slot >= 0) {
          run.coins = 9999;
          const b = Tower.buyShopSlot(slot);
          console.log('  买到 C30：' + JSON.stringify(b && b.ok) + '；run.permSlots=' + run.permSlots + ' permSlotIds=' + JSON.stringify(run.permSlotIds));
        }
        Tower.pickChoice('endless', 0);
        clearPhase();
        continue;
      }
      Tower.pickChoice('endless', 0);
    }
    clearPhase();
  }
  console.log('  开了 ' + shops + ' 个商店，C30/C31 出现在货架上 ' + offered + ' 次');
  Tower.abandon('endless');
}

console.log('\n=== 任务 4：选取型（C32/C33）第二次获得的行为 ===');
{
  fresh();
  const g1 = Tower.debugGrantBuff('C32');
  console.log('  第一次拿 C32: ok=' + (g1 && g1.ok) + ' pendingPick=' + JSON.stringify(Tower._debugRun('endless').pendingPick));
  const cands = Tower.pickCandidates('weapon');
  console.log('  候选武器数=' + cands.length + ' 第一个=' + (cands[0] && cands[0].name));
  if (cands[0]) console.log('  落地: ' + JSON.stringify(Tower.applyPickBuff('weapon', cands[0].id)));
  const g2 = Tower.debugGrantBuff('C32');
  console.log('  第二次拿 C32: ok=' + (g2 && g2.ok) + ' msg=' + JSON.stringify(g2 && g2.res && g2.res.msg));
  const g3 = Tower.debugGrantBuff('C33');
  console.log('  拿 C33: ok=' + (g3 && g3.ok) + ' pendingPick=' + JSON.stringify(Tower._debugRun('endless').pendingPick));
  const r = Tower._debugRun('endless');
  console.log('  run.pickBuffIds=' + JSON.stringify(r.pickBuffIds) + ' weaponBoost=' + JSON.stringify(r.weaponBoost));
  Tower.abandon('endless');
}
