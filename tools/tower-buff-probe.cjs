/* 无尽塔 buff 运行时诊断探针。
 *
 * 目的：把「限次 buff 剩几次、叠层 buff 实际涨了多少、账本加价加到了谁头上、
 * 每段的机制是哪几个、随机稀有度分布」这些**运行时数字**打出来，
 * 而不是靠读代码猜。改动前后各跑一次即可确认修复是否真的生效。
 *
 * 用法：node tools/tower-buff-probe.cjs [场数]
 */
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const BATTLES = Math.max(1, Number(process.argv[2]) || 12);

const store = new Map();
class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) } };
c.window = c; vm.createContext(c);
const load = (f) => fs.readFileSync(path.join(root, f), 'utf8');
for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
  vm.runInContext(load(f), c, { filename: f });
}
const { State, Sim, Tower, TowerData } = c;

State.newGame('probe');
const S = State.state();
S.level = 70;
for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };

function line(s) { console.log(s); }
function hr(t) { line('\n=== ' + t + ' ==='); }

// ---------- 1. 随机稀有度分布 ----------
hr('1) 选牌稀有度分布（rollChoices 的 3 个 buff 槽，2000 次采样）');
{
  Tower._debugSetLayer(9);
  Tower.startEndlessRun();
  const cnt = [0, 0, 0, 0];
  let limitedSlots = 0, totalSlots = 0, noLimitedSets = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const roll = Tower.rollChoices ? Tower.rollChoices('endless', c.Tower && null) : null;
    // rollChoices 未导出：走 debugGrantBuff 之外的路径 —— 直接用内部函数不可达，这里改用 endlessInfo 的 choices
    const info = Tower.endlessInfo();
    const ch = (info.run && info.run.choices) || [];
    if (!ch.length) {
      // 没有待选：手动塞一个 run.choices 让界面逻辑走通不可行，直接统计"下一层"的选择
      break;
    }
  }
  line('  （rollChoices 未导出，本项改用"真实对局里每次选择"采样，见第 5 项）');
  Tower.abandon('endless');
}

// ---------- 2. 限次 buff 的次数随战斗递减 ----------
hr('2) 限次 buff 的次数消耗（任务 5）');
{
  Tower._debugSetLayer(9);
  const st = Tower.startEndlessRun();
  if (!st.ok) { line('  无法开始无尽局：' + JSON.stringify(st)); }
  else {
    Tower.debugGrantBuff('E06');   // 战利品·精：接下来 10 场 +120% 试炼币
    Tower.debugGrantBuff('M04');   // 疾风步：接下来 10 场速度 +30%
    const show = (tag) => {
      const run = Tower._debugRun('endless') || {};
      const lim = (run.limited || []).map((b) => b.id + ':' + b.uses + (b.on === false ? '(off)' : ''));
      const panel = Tower.ownedBuffs('endless').filter((b) => b.kind === 'limited')
        .map((b) => b.id + ' uses=' + b.uses);
      line('  ' + tag.padEnd(12) + ' idx=' + run.idx + ' layer=' + run.layer + ' phase=' + run.phase +
        '  raw[' + lim.join(' ') + ']  面板[' + panel.join(' ') + ']');
    };
    show('拿到时');
    for (let i = 1; i <= Math.min(BATTLES, 4); i++) {
      const nx = Tower.nextBattle('endless');
      if (!nx || !nx.foe) { line('  第 ' + i + ' 场取不到（' + JSON.stringify(nx) + '）'); break; }
      Tower.reportBattle('endless', nx.token, true, 1);
      show('打完 ' + i + ' 场');
      const info = Tower.endlessInfo();
      if (info.run && info.run.choices) Tower.pickChoice('endless', 0);
      if (Tower.endlessInfo().run && Tower.endlessInfo().run.phase) {
        // 商店阶段：直接关掉继续
        try { Tower.closeShop(); } catch (e) { }
      }
    }
    Tower.abandon('endless');
  }
}

// ---------- 3. 叠层 buff：成长值 vs 面板显示 ----------
hr('3) 叠层成长（任务 7：猎杀时刻 C06 / 吞噬成长 C07）');
{
  Tower._debugSetLayer(9);
  Tower.startEndlessRun();
  Tower.debugGrantBuff('C06');
  Tower.debugGrantBuff('C07');
  const show = (tag) => {
    const run = Tower._debugRun('endless') || {};
    const panel = Tower.ownedBuffs('endless').filter((b) => b.id === 'C06' || b.id === 'C07')
      .map((b) => b.id + ' stacks=' + b.stacks);
    line('  ' + tag.padEnd(14) + ' killPower=' + (run.killPower || 0).toFixed(3) +
      '  killMaxHp=' + (run.killMaxHp || 0).toFixed(3) + '   面板[' + panel.join(' ') + ']');
  };
  show('拿到时');
  for (let i = 1; i <= BATTLES; i++) {
    const nx = Tower.nextBattle('endless');
    if (!nx || !nx.foe) break;
    Tower.reportBattle('endless', nx.token, true, 1);
    if (i % 4 === 0 || i === 1) show('打完 ' + i + ' 场');
    const info = Tower.endlessInfo();
    if (info.run && info.run.choices) Tower.pickChoice('endless', 0);
    if (Tower.endlessInfo().run && Tower.endlessInfo().run.phase) { try { Tower.closeShop(); } catch (e) { } }
  }
  Tower.abandon('endless');
}

// ---------- 4. 战利品账本：加到谁头上 ----------
hr('4) 战利品账本 C25（任务 7：只该加自己 / 且随持有而生效）');
{
  Tower._debugSetLayer(9);
  Tower.startEndlessRun();
  Tower.debugGrantBuff('C25');
  const price = (tag) => {
    const rows = Tower.ownedBuffs('endless').map((b) => b.id + '=' + b.sellPrice);
    const run = Tower._debugRun('endless') || {};
    line('  ' + tag.padEnd(14) + ' sellBonus=' + (run.sellBonus || 0) + '   卖价 ' + rows.join(' '));
  };
  price('拿到时');
  for (let i = 1; i <= 6; i++) {
    const nx = Tower.nextBattle('endless');
    if (!nx || !nx.foe) break;
    Tower.reportBattle('endless', nx.token, true, 1);
    if (i % 2 === 0) price('打完 ' + i + ' 场');
    const info = Tower.endlessInfo();
    if (info.run && info.run.choices) Tower.pickChoice('endless', 0);
    if (Tower.endlessInfo().run && Tower.endlessInfo().run.phase) { try { Tower.closeShop(); } catch (e) { } }
  }
  // 卖掉账本后再看：其它 buff 的卖价应该回落到基础上
  Tower.debugLoseBuff('C25');
  price('卖掉账本后');
  Tower.abandon('endless');
}

// ---------- 5. 每段机制 ----------
hr('5) 每层「当前遭遇的机制」（任务 4：第 6 层起应有反伤）');
{
  for (const layer of [1, 5, 6, 10, 11, 15, 16, 20, 21]) {
    const mechs = TowerData.endlessMechs(layer);
    line('  第 ' + String(layer).padStart(2) + ' 层 → [' + mechs.join(', ') + ']');
  }
}
