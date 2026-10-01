/* 无尽塔 buff 修复验证（逐项 PASS/FAIL）。
 *
 * 覆盖本轮 9 项需求里可自动化的部分：
 *   任务2 出率      任务3 即时削弱敌方生命上限   任务5 限次 buff 跨层保留
 *   任务6 空槽/永久数换攻击                       任务7 成长与账本
 *   任务8 选牌必有一张限次                        任务9 挥金如土
 *
 * 用法：node tools/tower-buff-verify.cjs [采样局数]
 */
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const SAMPLE = Math.max(20, Number(process.argv[2]) || 60);

const store = new Map();
class CD extends Date { static now() { return new Date(2026, 8, 26, 12).getTime(); } }
const c = { Date: CD, location: { search: '?qa=1' }, console, localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) } };
c.window = c; vm.createContext(c);
const load = (f) => fs.readFileSync(path.join(root, f), 'utf8');
for (const f of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
  vm.runInContext(load(f), c, { filename: f });
}
const { State, Sim, Tower, TowerData } = c;
State.newGame('verify');
const S = State.state();
S.level = 70;
for (let i = 1; i <= 18; i++) S.stages[i] = { npcIndex: 3, passed: true };

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
}
function hr(t) { console.log('\n=== ' + t + ' ==='); }
/* 开一局新的：如果上一段测试留下了「进行中/战斗未结束」的对局，先把它收干净
 * （abandon 在有未结束的战斗时是拒绝的，所以要先随便报掉那场）。 */
function freshRun() {
  Tower._debugSetLayer(9);
  let st = Tower.startEndlessRun();
  for (let guard = 0; !st.ok && guard < 5; guard++) {
    const run = Tower._debugRun('endless');
    if (run && run.attempt) { try { Tower.reportBattle('endless', run.attempt, false, 0); } catch (e) { } }
    try { Tower.abandon('endless'); } catch (e) { }
    st = Tower.startEndlessRun();
  }
  return st;
}
function win(mode, ratio) {
  const nx = Tower.nextBattle(mode);
  if (!nx || !nx.foe) return null;
  Tower.reportBattle(mode, nx.token, true, ratio == null ? 1 : ratio);
  return nx;
}
function clearPhase() {
  const info = Tower.endlessInfo();
  const run = Tower._debugRun('endless');
  if (!run) return;
  if (info.run && info.run.choices) Tower.pickChoice('endless', 0);
  const r2 = Tower._debugRun('endless');
  if (r2 && r2.phase === 'shop') { try { Tower.continueFromShop(); } catch (e) { try { Tower.closeShop(); } catch (e2) { } } }
  const r3 = Tower._debugRun('endless');
  if (r3 && r3.phase === 'checkpoint') { try { Tower.continueEndless(); } catch (e) { } }
}

// ---------- 任务 2：出率 ----------
hr('任务 2：稀有度出率');
{
  const w = TowerData.RARITY_WEIGHTS, sum = w.reduce((a, b) => a + b, 0);
  check('权重数组是 4 档且合计 100', w.length === 4 && sum === 100, '[' + w.join(', ') + '] 合计 ' + sum);
  // 实测：反复开局走到选择点，统计三张牌的稀有度
  const cnt = [0, 0, 0, 0]; let sets = 0, limitedSets = 0;
  for (let i = 0; i < SAMPLE && sets < 200; i++) {
    freshRun();
    let guard = 0, got = 0;
    while (got < 2 && guard++ < 40) {
      const before = Tower._debugRun('endless');
      win('endless', 1);
      const run = Tower._debugRun('endless');
      if (run && run.choices) {
        got++;
        sets++;
        let hasLimited = false;
        for (const ch of run.choices) {
          if (ch.type !== 'buff') continue;
          const b = TowerData.BUFF_BY_ID[ch.id];
          if (!b) continue;
          cnt[b.rarity]++;
          if (b.kind === 'limited' && b.id !== 'N08') hasLimited = true;
        }
        if (hasLimited) limitedSets++;
        Tower.pickChoice('endless', 0);
      }
      if (!Tower._debugRun('endless')) break;
      clearPhase();
      if (!Tower._debugRun('endless')) break;
    }
    Tower.abandon('endless');
  }
  const tot = cnt.reduce((a, b) => a + b, 0) || 1;
  const pct = cnt.map((v) => (v / tot * 100).toFixed(1));
  check('普通占比明显高于其它档', cnt[0] / tot > 0.45, '实测 ' + pct.join('% / ') + '%（' + sets + ' 组）');
  check('传奇占比处于低位', cnt[3] / tot < 0.12, '传奇 ' + pct[3] + '%');
}

// ---------- 任务 8：选牌必有一张限次 ----------
hr('任务 8：每次多选一必有一张限次增益（不含补给 N08）');
{
  let sets = 0, withLimited = 0;
  for (let i = 0; i < SAMPLE && sets < 120; i++) {
    freshRun();
    let guard = 0, got = 0;
    while (got < 2 && guard++ < 40) {
      win('endless', 1);
      const run = Tower._debugRun('endless');
      if (run && run.choices) {
        got++; sets++;
        const lim = run.choices.filter((ch) => ch.type === 'buff').map((ch) => TowerData.BUFF_BY_ID[ch.id])
          .filter((b) => b && b.kind === 'limited' && b.id !== 'N08');
        if (lim.length) withLimited++;
        Tower.pickChoice('endless', 0);
      }
      if (!Tower._debugRun('endless')) break;
      clearPhase();
      if (!Tower._debugRun('endless')) break;
    }
    Tower.abandon('endless');
  }
  check('每一组都至少有一张限次', sets > 0 && withLimited === sets, withLimited + '/' + sets);
}

// ---------- 任务 5：限次 buff 跨层保留 ----------
hr('任务 5：限次 buff 按场次消耗、跨层不被清空');
{
  freshRun();
  Tower.debugGrantBuff('E06');   // 接下来 10 场 +120% 试炼币
  const run0 = Tower._debugRun('endless');
  const u0 = (run0.limited || []).find((b) => b.id === 'E06');
  check('拿到时 uses=10', u0 && u0.uses === 10, u0 ? 'uses=' + u0.uses : '没拿到');
  const layers = new Set();
  let last = null;
  for (let i = 0; i < 12; i++) {
    win('endless', 1);
    const run = Tower._debugRun('endless');
    if (!run) break;
    layers.add(run.layer);
    const e = (run.limited || []).find((b) => b.id === 'E06');
    last = { layer: run.layer, uses: e ? e.uses : 0, idx: run.idx };
    clearPhase();
    if (!Tower._debugRun('endless')) break;
  }
  const panel = Tower.ownedBuffs('endless').find((b) => b.id === 'E06');
  check('跨过至少 2 层后仍在（且次数连续递减）', last && layers.size >= 2 && last.uses > 0 && last.uses < 10,
    last ? ('最后一层=' + last.layer + ' 剩 ' + last.uses + ' 场；走过层数=' + layers.size) : '中途消失');
  Tower.abandon('endless');
}

// ---------- 任务 7：成长数值 + 面板进度 + 账本 ----------
hr('任务 7：成长类数值与账本');
{
  freshRun();
  Tower.debugGrantBuff('C07');   // 吞噬成长：每击杀 +3%，上限 +45%
  for (let i = 0; i < 10; i++) { win('endless', 1); clearPhase(); if (!Tower._debugRun('endless')) break; }
  const run = Tower._debugRun('endless');
  const growth = run ? (run.killMaxHp || 0) : 0;
  check('吞噬成长按 +3%/场 累计（10 场 ≈ +30%）', growth > 0.28 && growth < 0.33, 'killMaxHp=' + growth.toFixed(3));
  const ob = Tower.ownedBuffs('endless').find((b) => b.id === 'C07');
  check('面板带上真实进度（不再是 ×1）', !!(ob && ob.progress), ob ? ob.progress : '没有 progress');
  Tower.abandon('endless');

  freshRun();
  Tower.debugGrantBuff('C25');   // 战利品账本
  Tower.debugGrantBuff('C02');   // 磨砺（另一个永久 buff，卖价不该被账本抬高）
  const priceOf = (id) => { const b = Tower.ownedBuffs('endless').find((x) => x.id === id); return b ? b.sellPrice : null; };
  const p0 = { c25: priceOf('C25'), c02: priceOf('C02') };
  for (let i = 0; i < 6; i++) { win('endless', 1); clearPhase(); if (!Tower._debugRun('endless')) break; }
  const p1 = { c25: priceOf('C25'), c02: priceOf('C02') };
  check('账本自己的卖价随胜利上涨', p1.c25 > p0.c25, p0.c25 + ' → ' + p1.c25);
  check('别的 buff 卖价不被账本抬高', p1.c02 === p0.c02, p0.c02 + ' → ' + p1.c02);
  Tower.debugLoseBuff('C25');
  const after = priceOf('C02');
  check('账本失去后不再影响任何卖价', after === p0.c02, 'C02 卖价 ' + after);
  Tower.abandon('endless');
}

// ---------- 任务 3：即时削弱敌方生命上限 ----------
hr('任务 3：即时削弱敌方生命上限');
{
  // 同一 salt、同一层，比较拿 buff 前后第一场敌人的生命上限
  freshRun();
  const base = win('endless', 1);
  const baseHp = base ? base.foe.hp : 0;
  const salt = Tower._debugRun('endless').salt;
  Tower.abandon('endless');

  freshRun();
  Tower._debugRun('endless').salt = salt;                    // 对齐随机盐 → 同一个对手
  Tower.debugGrantBuff('E07');                               // 普通：−10%
  const hit = win('endless', 1);
  const hitHp = hit ? hit.foe.hp : 0;
  const ratio = baseHp ? hitHp / baseHp : 0;
  check('挫锐（−10%）确实扣了敌人生命上限', ratio > 0.85 && ratio < 0.95,
    baseHp + ' → ' + hitHp + '（×' + ratio.toFixed(3) + '）');
  Tower.abandon('endless');

  freshRun();
  Tower._debugRun('endless').salt = salt;
  Tower.debugGrantBuff('E07');
  Tower.debugGrantBuff('E08');                               // 再叠稀有：−15% → 共 −25%
  const hit2 = win('endless', 1);
  const ratio2 = baseHp && hit2 ? hit2.foe.hp / baseHp : 0;
  check('挫锐 + 卸甲 叠加（约 −25%）', ratio2 > 0.70 && ratio2 < 0.80, baseHp + ' → ' + (hit2 ? hit2.foe.hp : 0) + '（×' + ratio2.toFixed(3) + '）');
  Tower.abandon('endless');
}

// ---------- 任务 6：空槽 / 永久数量换攻击 ----------
hr('任务 6：轻装上阵（空槽 +20%）与厚积薄发（每个永久 +10%）');
{
  /* 注意测量方式：State.genAI 每次的属性带随机（装备品质），所以不能跨局比较绝对值。
   * 做法是在**同一局**里，用同一个基准对象克隆两份：先量没有增益的那一场，
   * 再加增益量下一场，两者的差别就只剩增益本身。 */
  const measure = (grant) => {
    freshRun();
    const base = State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    const nx1 = Tower.nextBattle('endless');
    const me1 = Object.assign({}, base); nx1.adjustMe(me1);
    Tower.reportBattle('endless', nx1.token, true, 1);
    const run = Tower._debugRun('endless');
    if (run && run.choices) Tower.pickChoice('endless', 0);
    grant();
    const nx2 = Tower.nextBattle('endless');
    const me2 = Object.assign({}, base); nx2.adjustMe(me2);
    Tower.abandon('endless');
    return { p0: me1.power, p1: me2.power };
  };
  const a = measure(() => { });
  check('无增益时前后一致（测量本身可信）', a.p0 === a.p1, '攻击 ' + a.p0 + ' → ' + a.p1);
  const b = measure(() => Tower.debugGrantBuff('C34'));
  check('轻装上阵 +80%（5 格里有 1 格被自己占掉 → 4 个空槽 ×20%）',
    b.p1 / b.p0 > 1.78 && b.p1 / b.p0 < 1.82, '攻击 ' + b.p0 + ' → ' + b.p1 + '（×' + (b.p1 / b.p0).toFixed(3) + '）');
  const d = measure(() => Tower.debugGrantBuff('C35'));
  check('厚积薄发 +10%（当前只有它自己 1 个永久）',
    d.p1 / d.p0 > 1.08 && d.p1 / d.p0 < 1.12, '攻击 ' + d.p0 + ' → ' + d.p1 + '（×' + (d.p1 / d.p0).toFixed(3) + '）');
  // 再叠一个永久：C35 应该从 +10% 变成 +20%
  /* 叠第二个永久时要挑**本身不加攻击**的（C21 暴击精通），否则会把它的
   * powerMul 一起量进去（第一版就踩了这个坑：用 C02 磨砺，它自己 +10%）。 */
  const e = measure(() => { Tower.debugGrantBuff('C35'); Tower.debugGrantBuff('C21'); });
  check('再多一个永久后厚积薄发 ×1.20（2 个永久）',
    e.p1 / e.p0 > 1.18 && e.p1 / e.p0 < 1.22, '攻击 ' + e.p0 + ' → ' + e.p1 + '（×' + (e.p1 / e.p0).toFixed(3) + '）');
}

// ---------- 任务 9：挥金如土 ----------
hr('任务 9：挥金如土（每消费 20 试炼币 → 随机 +1 力/敏/速 并 +5 生命）');
{
  freshRun();
  // 推进到第 5 层通关后的商店阶段（每 5 层一次结算点）
  let guard = 0;
  while (guard++ < 60) {
    const run = Tower._debugRun('endless');
    if (!run) break;
    if (run.phase === 'shop' && run.shop) break;
    if (run.choices) { Tower.pickChoice('endless', 0); continue; }
    const nx = Tower.nextBattle('endless');
    if (!nx || !nx.foe) break;
    Tower.reportBattle('endless', nx.token, true, 1);
  }
  const run0 = Tower._debugRun('endless');
  if (!run0 || !run0.shop) {
    check('能走到试炼商店', false, '没到商店阶段');
  } else {
    check('能走到试炼商店', true, '第 ' + run0.layer + ' 层');
    run0.coins = 500;
    Tower.debugGrantBuff('C36');
    const g0 = Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, Tower._debugRun('endless').spendGain || {});
    let spent = 0;
    for (let i = 0; i < 40; i++) {
      const before = Tower._debugRun('endless').coins;
      const r = Tower.buyShopHeal();
      if (!r.ok) Tower.rerollShop();
      const after = Tower._debugRun('endless').coins;
      spent += Math.max(0, before - after);
      if (Tower._debugRun('endless').coins < 10) { Tower._debugRun('endless').coins = 500; }
    }
    const r1 = Tower._debugRun('endless');
    const g1 = Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, r1.spendGain || {});
    const statSum = (g1.power - g0.power) + (g1.agility - g0.agility) + (g1.speed - g0.speed);
    check('消费累计换成属性点', statSum > 0, '消费 ' + spent + ' 币 → 力+' + (g1.power - g0.power) +
      ' 敏+' + (g1.agility - g0.agility) + ' 速+' + (g1.speed - g0.speed));
    check('每 1 点属性同时 +5 生命上限', (g1.hp - g0.hp) === statSum * 5, '属性共 +' + statSum + '，生命 +' + (g1.hp - g0.hp));
    check('累计点数量与消费额一致（每 20 币 1 点）', Math.abs(statSum - Math.floor((spent + Number(r1.shopSpend || 0)) / 20)) <= 1,
      '消费 ' + spent + '，剩余进度 ' + r1.shopSpend + '，得点 ' + statSum);
    const ob = Tower.ownedBuffs('endless').find((b) => b.id === 'C36');
    check('面板显示累计量与距下次进度', !!(ob && ob.progress), ob ? ob.progress : '没有 progress');
  }
  Tower.abandon('endless');
}

console.log('\n================ 合计 ' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
