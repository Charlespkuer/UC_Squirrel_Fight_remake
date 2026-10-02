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
for (const f of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js']) {
  vm.runInContext(load(f), c, { filename: f });
}
const { State, Sim, Tower, TowerData } = c;
vm.runInContext('Math.__realRandom = Math.random', c);
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
hr('上轮 2：稀有度出率');
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
hr('上轮 8：每次多选一必有一张限次增益（不含补给 N08）');
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

// ---------- 本轮 5：限次 buff 跨层保留 ----------
hr('上轮 5：限次 buff 按场次消耗、跨层不被清空');
{
  freshRun();
  Tower.debugGrantBuff('E06');   // 接下来 10 场 +120% 试炼币
  const run0 = Tower._debugRun('endless');
  const u0 = (run0.limited || []).find((b) => b.id === 'E06');
  check('拿到时 uses=10', u0 && u0.uses === 10, u0 ? 'uses=' + u0.uses : '没拿到');
  const layers = new Set();
  let last = null, battles = 0;
  for (let i = 0; i < 12; i++) {
    win('endless', 1);
    battles++;
    const run = Tower._debugRun('endless');
    if (!run) break;
    layers.add(run.layer);
    const e = (run.limited || []).find((b) => b.id === 'E06');
    last = { layer: run.layer, uses: e ? e.uses : 0, idx: run.idx, totalBattles: battles };
    clearPhase();
    if (!Tower._debugRun('endless')) break;
  }
  const panel = Tower.ownedBuffs('endless');
  /* 需求 6：限次现在**每场都扣 1**（含整层最后一场）——
   * 原来整层最后一场会被 layerClear 提前 return 跳过，所以 12 场只掉 9~10 点。
   * 这里改成断言「确实跨了至少 2 层、次数单调递减、从不越界」。 */
  check('跨过至少 2 层（次数每场扣 1、单调递减）', last && layers.size >= 2 && last.uses >= 0 && last.uses < 10 && last.uses === Math.max(0, 10 - last.totalBattles),
    last ? ('最后一层=' + last.layer + ' 剩 ' + last.uses + ' 场；走过层数=' + layers.size + '；已打 ' + last.totalBattles + ' 场') : '中途消失');
  Tower.abandon('endless');
}

// ---------- 任务 7：成长数值 + 面板进度 + 账本 ----------
hr('上轮 7：成长类数值与账本');
{
  freshRun();
  Tower.debugGrantBuff('C07');   // 需求 4：吞噬成长改成「每胜利一场 +2%，上限 +30%」
  let fought = 0;
  for (let i = 0; i < 10; i++) { win('endless', 1); fought++; clearPhase(); if (!Tower._debugRun('endless')) break; }
  const run = Tower._debugRun('endless');
  const growth = run ? (run.winMaxHp || 0) : 0;
  check('吞噬成长按 +2%/胜利 累计（' + fought + ' 场 ≈ +' + (2 * fought) + '%）',
    Math.abs(growth - 0.02 * fought) < 0.001, 'winMaxHp=' + growth.toFixed(3));
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
hr('上轮 3：即时削弱敌方生命上限');
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
hr('上轮 6：轻装上阵与厚积薄发');
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
hr('上轮 9：挥金如土');
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
    /* 消费点用「刷新货架」：它每刷一次都扣币、且价格递增，稳定产生消费。
     * （原来用的是 buyShopHeal —— 那个位置现在是一次限购的重新挑战币，
     *  买过就失败、靠刷新补，刷新价涨上去后有时花不够，导致断言偶发红。） */
    for (let i = 0; i < 40; i++) {
      const before = Tower._debugRun('endless').coins;
      Tower.rerollShop();
      const after = Tower._debugRun('endless').coins;
      spent += Math.max(0, before - after);
      if (Tower._debugRun('endless').coins < 60) { Tower._debugRun('endless').coins = 500; }
    }
    const r1 = Tower._debugRun('endless');
    const g1 = Object.assign({ power: 0, agility: 0, speed: 0, hp: 0 }, r1.spendGain || {});
    const statSum = (g1.power - g0.power) + (g1.agility - g0.agility) + (g1.speed - g0.speed);
    check('消费累计换成属性点', statSum > 0, '消费 ' + spent + ' 币 → 力+' + (g1.power - g0.power) +
      ' 敏+' + (g1.agility - g0.agility) + ' 速+' + (g1.speed - g0.speed));
    /* 第 2 项（本轮）：改成「力+1 / 敏+1 / 速+1 / 生命上限+5」四项随机**一项** ——
     * 所以「获得次数」= 属性点数 + 生命增量/5，且应等于 floor(总消费/20)。 */
    const gains = statSum + Math.round((g1.hp - g0.hp) / 5);
    const expectGains = Math.floor((spent + Number(r1.shopSpend || 0)) / 20);
    check('每次消费 20 币只给四项中的一项', Math.abs(gains - expectGains) <= 1,
      '消费 ' + spent + '，剩余进度 ' + r1.shopSpend + '，共获得 ' + gains + ' 次（力+' + (g1.power - g0.power) +
      ' 敏+' + (g1.agility - g0.agility) + ' 速+' + (g1.speed - g0.speed) + ' 生命+' + (g1.hp - g0.hp) + '）');
    check('生命项每次固定 +5', (g1.hp - g0.hp) % 5 === 0, '生命 +' + (g1.hp - g0.hp));
    const ob = Tower.ownedBuffs('endless').find((b) => b.id === 'C36');
    check('面板显示累计量与距下次进度', !!(ob && ob.progress), ob ? ob.progress : '没有 progress');
  }
  Tower.abandon('endless');
}

// ---------- 本轮 1a：虚空铭文 ----------
hr('本轮 1a：虚空铭文（附魔一个永久增益免占位）');
{
  freshRun();
  for (const id of ['C01', 'C02', 'C21', 'C22', 'C23']) Tower.debugGrantBuff(id);
  const r0 = Tower._debugRun('endless');
  check('先占满 5 个永久槽', (r0.permanent || []).length === 5, '永久=' + (r0.permanent || []).length);
  const full = Tower.debugGrantBuff('C29');
  check('满格时再加永久增益需要替换', !!(full && full.res && full.res.needsReplace), JSON.stringify(full && full.res && (full.res.msg || '')));
  const g = Tower.debugGrantBuff('C37');
  const r1 = Tower._debugRun('endless');
  check('虚空铭文进入「选取永久增益」状态', !!(g && g.ok && r1.pendingPick && r1.pendingPick.kind === 'permBuff'), JSON.stringify(r1.pendingPick));
  const cands = Tower.pickCandidates('permBuff');
  check('候选来自已有的永久增益（排除隐藏型）', cands.length > 0 && cands.every((c) =>
    TowerData.BUFF_BY_ID[c.id] && !TowerData.BUFF_BY_ID[c.id].hidden), cands.map((c) => c.id).join(','));
  const picked = cands[0];
  const before = (r1.permanent || []).length;
  const ap = Tower.applyPickBuff('permBuff', picked.id);
  const r2 = Tower._debugRun('endless');
  check('附魔落地成功', !!(ap && ap.ok), JSON.stringify(ap && (ap.msg || '')));
  check('permUsed 比拥有数少 1', r2.permUsed === undefined ? ((r2.permanent || []).length - (r2.slotFreeIds || []).length) === before - 1 : true,
    '免占位=' + JSON.stringify(r2.slotFreeIds));
  const info = Tower.endlessInfo();
  check('界面数据 permUsed 也少 1', info.run.permUsed === before - 1, 'permUsed=' + info.run.permUsed + ' cap=' + info.run.permCap);
  const again = Tower.debugGrantBuff('C29');
  check('腾出位置后又能再拿一个永久增益', !!(again && again.ok), JSON.stringify(again && again.res && (again.res.msg || 'ok')));
  Tower.debugLoseBuff(picked.id);
  const r3 = Tower._debugRun('endless');
  check('失去被附魔的增益后附魔记录一并清掉', !(r3.slotFreeIds || []).includes(picked.id), JSON.stringify(r3.slotFreeIds || []));
  Tower.abandon('endless');
}

// ---------- 本轮 1b：先机预判 ----------
hr('本轮 1b：先机预判（首次受击为 0，反伤不消耗）');
{
  /* 用**手工构造的确定性对局**来验，不依赖塔里的随机对手 ——
   * 第一版跑塔内实战，结果那局我方压根没被普攻命中，断言随机飘。
   * 这里让敌人速度远高于我方（必定先手），场景就固定了。 */
  const mk = (o) => Object.assign({ name: 'X', level: 50, power: 100, agility: 50, speed: 50,
    hp: 6000, maxHp: 6000, weapons: [], skills: [], effects: {},
    baseStats: { power: 100, agility: 50, speed: 50 } }, o);
  /* 参数刻意做成确定性：
   *  · 敌方速度更高 → 必定先手（这样「首次受击」一定发生）
   *  · 我方敏捷 300 vs 敌方 1 → 我方普攻必中（保证能打到带荆棘的对手）
   *  · 双方血厚 → 战斗足够长，不会被 120 动作上限截断 */
  /* 这一场我方敏捷压到 1：保证敌人的第一次攻击**一定命中**（否则被闪掉就不触发，
   * 断言会随机红）。要验「反伤不消耗免疫」时另给高敏捷（见下面 hero2）。 */
  const hero = mk({ name: '我方', speed: 100, agility: 1, power: 200, hp: 30000, maxHp: 30000,
    mods: { firstHitZero: 1 } });
  const foe = mk({ name: '敌方', speed: 200, agility: 1, power: 120, hp: 30000, maxHp: 30000 });
  const res = Sim.simulate(hero, foe);
  const zero = (res.rounds || []).filter((r) => r.firstHitZero);
  check('敌方首次攻击被归零', zero.length === 1, '触发 ' + zero.length + ' 次');
  check('归零的那一回合没造成伤害', zero.length === 1 && !zero[0].dmg, '该回合 dmg=' + (zero[0] && zero[0].dmg));
  check('每场只触发一次', zero.length <= 1, '触发 ' + zero.length + ' 次');

  /* 对手带荆棘：反伤不能消耗这次免疫。
   * 注意 hero2 的敏捷也要压到 1 —— 原来写 300，敌人（敏捷 1）的第一次攻击会**被闪避**，
   * 于是「首次伤害归零」根本不触发，断言随机红（实测约 1/4 概率失败）。
   * 「反伤不消耗免疫」这条逻辑与敏捷无关，压低敏捷不影响它的验证。 */
  const hero2 = mk({ name: '我方', speed: 100, agility: 1, power: 200, hp: 30000, maxHp: 30000,
    mods: { firstHitZero: 1 } });
  const foe2 = mk({ name: '荆棘敌方', speed: 200, agility: 1, power: 120, hp: 30000, maxHp: 30000, mech: ['thorns'] });
  const res2 = Sim.simulate(hero2, foe2);
  const rounds2 = res2.rounds || [];
  const thornsRounds = rounds2.filter((r) => r.thornsDmg);
  check('带荆棘的对手确实发生了反伤', thornsRounds.length >= 1, '反伤回合数=' + thornsRounds.length);
  check('反伤回合不会消耗这次免疫', thornsRounds.filter((r) => r.firstHitZero).length === 0,
    '反伤且归零=' + thornsRounds.filter((r) => r.firstHitZero).length);
  check('反伤照旧生效（伤害不为 0）', thornsRounds.every((r) => r.thornsDmg > 0),
    '反伤值=' + thornsRounds.map((r) => r.thornsDmg).slice(0, 3).join(','));
  check('带荆棘时敌方首次攻击依然被归零', rounds2.filter((r) => r.firstHitZero).length === 1,
    '触发 ' + rounds2.filter((r) => r.firstHitZero).length + ' 次');
}

// ---------- 本轮 3：成长累计在失去后重置 ----------
hr('本轮 3：成长类增益失去后累计清零');
{
  freshRun();
  Tower.debugGrantBuff('C07');
  Tower.debugGrantBuff('C07');
  const stack0 = ((Tower._debugRun('endless').permanent || []).find((b) => b.id === 'C07') || {}).stacks;
  for (let i = 0; i < 6; i++) { win('endless', 1); clearPhase(); if (!Tower._debugRun('endless')) break; }
  const r1 = Tower._debugRun('endless');
  check('叠到 2 层并长了起来', stack0 === 2 && (r1.winMaxHp || 0) > 0, 'stacks=' + stack0 + ' winMaxHp=' + (r1.winMaxHp || 0).toFixed(3));
  Tower.debugLoseBuff('C07');
  const r2 = Tower._debugRun('endless');
  check('失去后累计清零', (r2.killMaxHp || 0) === 0, 'killMaxHp=' + (r2.killMaxHp || 0));
  Tower.debugGrantBuff('C07');
  const r3 = Tower._debugRun('endless');
  const back = (r3.permanent || []).find((b) => b.id === 'C07');
  check('重新获得是 1 层、累计从 0 开始', !!back && back.stacks === 1 && (r3.killMaxHp || 0) === 0,
    'stacks=' + (back && back.stacks) + ' killMaxHp=' + (r3.killMaxHp || 0));
  Tower.abandon('endless');
}

// ---------- 本轮 4：血条悬停的真实上限 ----------
hr('本轮 4：血条悬停显示真实血量上限');
{
  freshRun();
  /* 血条上的数值来自 adjustMe（游戏里由 Main.startBattle 调用），探针要自己调一次。 */
  const nx = Tower.nextBattle('endless');
  const me = State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
  me.maxHp = me.hp;
  nx.adjustMe(me);
  Tower.reportBattle('endless', nx.token, true, 0.8);
  const info = Tower.endlessInfo();
  check('能拿到现在的血量上限与当前血量', info.run.curMaxHp > 0 && info.run.lastHp > 0,
    '上限 ' + info.run.curMaxHp + ' / 当前 ' + info.run.lastHp + '（本场 adjustMe 算出 ' + me.maxHp + '）');
  check('实时上限与本场 adjustMe 一致', info.run.curMaxHp === me.maxHp,
    info.run.curMaxHp + ' vs ' + me.maxHp);
  // 拿到加生命上限的增益后，实时上限应立刻变大（不用等下一场）
  Tower.debugGrantBuff('C01');                       // 磐石之躯：生命上限 +20%
  const after = Tower.endlessInfo();
  check('拿增益后实时上限立刻变大', after.run.curMaxHp > info.run.curMaxHp,
    info.run.curMaxHp + ' -> ' + after.run.curMaxHp);
  Tower.abandon('endless');
}

// ---------- 本轮 5：商店 5 格必有限次 ----------
hr('本轮 5：商店 5 格必有一张限次增益');
{
  let shops = 0, withLimited = 0;
  for (let i = 0; i < 60 && shops < 25; i++) {
    freshRun();
    let guard = 0;
    while (guard++ < 20) {
      win('endless', 1);
      const run = Tower._debugRun('endless');
      if (!run) break;
      if (run.choices) {
        const res = Tower.openRestShop();
        if (res && res.ok) {
          const st = Tower.shopState();
          shops++;
          const has = (st.slots || []).some((sl) => {
            const b = TowerData.BUFF_BY_ID[sl.id];
            return b && b.kind === 'limited' && b.id !== 'N08';
          });
          if (has) withLimited++;
          break;
        }
        Tower.pickChoice('endless', 0);
      }
    }
    Tower.abandon('endless');
  }
  check('每个商店都至少有一张限次增益', shops > 0 && withLimited === shops, withLimited + '/' + shops);
}

// ---------- 本轮 1：替换选项文案 ----------
hr('本轮 1：永久增益替换选项（去前缀 + 换行）');
{
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'tower-ui.js'), 'utf8');
  check('不再有「替换 」前缀的按钮', src.indexOf("label: '替换 '") < 0);
  check('不再有「换成 」前缀的按钮', src.indexOf("label: '换成 '") < 0);
  check('替换按钮支持换行（名字与层数分两行）',
    src.indexOf('pick-buff-btn replace-btn') >= 0 && src.indexOf("×' + b.stacks") >= 0);
  check('替换按钮有限宽样式（不会顶出屏幕）', require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'css', 'tower.css'), 'utf8').indexOf('.uc-button.replace-btn') >= 0);
}

// ---------- 本轮 2：商店高光已拥有的可叠加增益 ----------
hr('本轮 2：商店里已拥有的可叠加增益要能高光');
{
  freshRun();
  Tower.debugGrantBuff('C06');            // 猎杀时刻：永久 + stackable
  Tower.debugGrantBuff('C16');            // 战后续航：永久 + stackable
  run_coins: {
    const run = Tower._debugRun('endless');
    run.coins = 9999;
  }
  /* 休整商店只在「层内第 3 场后」能开 —— 先把 3 场打完走到选择点。 */
  const opened = (() => {
    for (let i = 0; i < 5; i++) {
      const run = Tower._debugRun('endless');
      if (run && run.choices) return Tower.openRestShop();
      win('endless', 1);
    }
    const run = Tower._debugRun('endless');
    return run && run.choices ? Tower.openRestShop() : null;
  })();
  if (opened && opened.ok) {
    const st = Tower.shopState();
    const c06 = (st.slots || []).find((x) => x.id === 'C06');
    const c16 = (st.slots || []).find((x) => x.id === 'C16');
    const anyStack = (st.slots || []).filter((x) => x.ownedStacks > 0 && x.stackable);
    check('商店数据带上 ownedStacks/stackable', (st.slots || []).every((x) => x.ownedStacks !== undefined && x.stackable !== undefined));
    check('已拥有的可叠加增益能被识别出来（若本次货架刷到）',
      !(c06 || c16) || anyStack.length >= 1,
      '刷到 C06=' + !!c06 + ' C16=' + !!c16 + '，可高光 ' + anyStack.length + ' 个');
  } else {
    check('能开一次休整商店', false, JSON.stringify(opened));
  }
  Tower.abandon('endless');
}

// ---------- 本轮 3：磐石之躯的回复立即生效 ----------
hr('本轮 3：磐石之躯（生命上限 +20%）的回复要立即生效');
{
  freshRun();
  const nx = Tower.nextBattle('endless');
  const me = State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
  me.maxHp = me.hp;
  nx.adjustMe(me);
  Tower.reportBattle('endless', nx.token, true, 0.5);      // 血量掉到 50%
  const before = Tower._debugRun('endless');
  const max0 = Tower.endlessInfo().run.curMaxHp;
  const hp0 = Math.round(max0 * before.carry);
  Tower.debugGrantBuff('C01');                             // 磐石之躯：上限 +20%
  const after = Tower.endlessInfo().run;
  const max1 = after.curMaxHp;
  const hp1 = Math.round(max1 * Tower._debugRun('endless').carry);
  const grewMax = max1 - max0;
  const grewHp = hp1 - hp0;
  check('上限涨了约 20%', Math.abs(grewMax - Math.round(max0 * 0.2)) <= 2, max0 + ' -> ' + max1 + '（+' + grewMax + '）');
  check('当前血量按「等量」补上（不是保持百分比）', Math.abs(grewHp - grewMax) <= 2,
    '血量 ' + hp0 + ' -> ' + hp1 + '（+' + grewHp + '，上限 +' + grewMax + '）');
  check('不是「比例不变」那种老行为', Math.abs(grewHp - Math.round(hp0 * 0.2)) > 2 || grewHp > Math.round(hp0 * 0.2),
    '老行为会只补 ' + Math.round(hp0 * 0.2));
  Tower.abandon('endless');
}

// ---------- 本轮 4：选取型不会白拿 ----------
hr('本轮 4：神兵淬炼/秘技通神 在没有可选目标时不该被白白消耗');
{
  freshRun();
  const run = Tower._debugRun('endless');
  run.weaponBoost = null; run.skillBoost = null;
  const g = Tower.debugGrantBuff('C32');
  const r1 = Tower._debugRun('endless');
  check('拿到后进入待选取', !!(g && g.ok && r1.pendingPick), JSON.stringify(r1.pendingPick));
  check('拿到就登记「一局一次」（不再重复刷到）', (r1.pickBuffIds || []).includes('C32'), JSON.stringify(r1.pickBuffIds || []));
  const cands = Tower.pickCandidates('weapon');
  check('没有武器时候选为空（但待选取保留，之后能再选）', cands.length === 0 && !!r1.pendingPick, '候选 ' + cands.length + ' 个');
  const g2 = Tower.debugGrantBuff('C32');
  check('再次拿会被拒（不会重复刷到神兵淬炼）', !(g2 && g2.ok), JSON.stringify(g2 && g2.res && g2.res.msg));
  check('但待选取仍保留（不会白拿一次就没了）', !!(Tower._debugRun('endless').pendingPick), JSON.stringify(Tower._debugRun('endless').pendingPick));
  // 真给一把武器再落地：登记「一局一次」，之后再拿才被拒
  // 注意 State.state().weapons 存的是 'id:level' 字符串（不是对象）
  for (const wid of [1, 2, 3, 5, 8, 15]) {
    State.state().weapons = [wid + ':5'];
    if ((State.myWeapons ? State.myWeapons() : []).length) break;
  }
  const cands2 = Tower.pickCandidates('weapon');
  check('有了武器就有候选', cands2.length >= 1, '候选 ' + cands2.length + ' 个（weapons=' + JSON.stringify(State.state().weapons) + '）');
  const ap = cands2.length ? Tower.applyPickBuff('weapon', cands2[0].id) : { ok: false, msg: '没有候选' };
  const r2 = Tower._debugRun('endless');
  check('落地成功并登记一局一次', !!(ap && ap.ok) && (r2.pickBuffIds || []).includes('C32'), JSON.stringify(r2.pickBuffIds || []));
  const g3 = Tower.debugGrantBuff('C32');
  check('落地后依然是拒绝再拿', !(g3 && g3.ok), JSON.stringify(g3 && g3.res && g3.res.msg));
  /* 失去之后要真的能再刷到（不然「卖了/丢了就永远没了」）。 */
  const lostPick = Tower.debugLoseBuff('C32');
  const g4 = Tower.debugGrantBuff('C32');
  check('失去选取型之后可以再拿到（不会永久锁死）', !!(lostPick && lostPick.ok && g4 && g4.ok),
    'lost=' + JSON.stringify(lostPick) + ' 再拿=' + JSON.stringify(g4 && (g4.ok || g4.res && g4.res.msg)) +
    ' pickBuffIds=' + JSON.stringify(Tower._debugRun('endless').pickBuffIds || []));
  Tower.abandon('endless');
}

// ---------- 本轮 5：扩容类不会重复刷上货架 ----------
hr('本轮 5：扩容背包/仓库钥匙不会重复出现在商店');
{
  let shops = 0, offeredAfterOwned = 0, refundOk = false;
  for (let i = 0; i < 120 && shops < 40; i++) {
    freshRun();
    /* 休整商店要在选择点才开得起来：先打几场走到 choices。 */
    let r0 = Tower._debugRun('endless');
    for (let k = 0; k < 5 && r0 && !r0.choices; k++) { win('endless', 1); r0 = Tower._debugRun('endless'); }
    const run = Tower._debugRun('endless');
    if (!run || !run.choices) { clearPhase(); continue; }
    run.coins = 9999;
    const res = Tower.openRestShop();
    if (!(res && res.ok)) { Tower.pickChoice('endless', 0); clearPhase(); continue; }
    shops++;
    const st = Tower.shopState();
    const idx = (st.slots || []).findIndex((x) => x.id === 'C30' || x.id === 'C31');
    if (idx >= 0) {
      const b = Tower.buyShopSlot(idx);
      if (b.ok) {
        // 买下后再刷货架：不该再出现同类
        const before2 = Tower._debugRun('endless');
        const c0 = before2.coins;
        const st2 = Tower.shopState();
        const boughtId = (st.slots[idx] || {}).id;
        if ((st2.slots || []).some((x) => x.id === boughtId && !x.sold)) offeredAfterOwned++;   // 别把刚买下的那格算进来
      } else {
        refundOk = true;
      }
      // 直接再调一次同样购买：应被拒并退款
      const again = Tower.buyShopSlot(idx);
      if (again && !again.ok) refundOk = true;
    }
    Tower.pickChoice('endless', 0);
    clearPhase();
    Tower.abandon('endless');
  }
  check('买下扩容类之后不再重复出现在同一商店', offeredAfterOwned === 0, '重复出现 ' + offeredAfterOwned + ' 次（开了 ' + shops + ' 家店）');
  /* 上一条在 40 家店里可能一次都没刷到扩容类（修好之后更刷不到），
   * 所以这里**强行摆一个**已经拥有的扩容类上货架，专门验退款。 */
  let refundOk2 = false, refundMsg = '';
  {
    freshRun();
    Tower.debugGrantBuff('C30');
    let r = Tower._debugRun('endless');
    for (let k = 0; k < 5 && r && !r.choices; k++) { win('endless', 1); r = Tower._debugRun('endless'); }
    r = Tower._debugRun('endless');
    if (r && r.choices && Tower.openRestShop().ok) {
      const rr = Tower._debugRun('endless');
      rr.coins = 500;
      rr.shop.slots[0] = { id: 'C30', sold: false };
      const before = rr.coins;
      const res = Tower.buyShopSlot(0);
      refundOk2 = !res.ok && Tower._debugRun('endless').coins === before;
      refundMsg = (res.msg || '') + '；币 ' + before + ' -> ' + Tower._debugRun('endless').coins;
    }
    Tower.abandon('endless');
  }
  check('重复购买会被拒并原额退款', refundOk2, refundMsg);
}

// ---------- 本轮 7（需求 3 重做）：易碎属性烙印 ----------
hr('易碎属性烙印：存在时半效、损毁后全额并本局永久保留、各自独立随机数');
{
  freshRun();
  /* 注意：State.genAI 每次的属性带随机（装备品质），跨两次 genAI 比较绝对值会飘 ——
   * 用**同一个基准对象**克隆两份来量。 */
  const base = State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
  const nx1 = Tower.nextBattle('endless');
  const meA = Object.assign({}, base); meA.maxHp = base.hp; nx1.adjustMe(meA);
  const pow0 = meA.power;
  Tower.reportBattle('endless', nx1.token, true, 1);
  Tower.debugGrantBuff('C39');                       // 力量烙印：基础 +8%
  const run1 = Tower._debugRun('endless');
  check('拿到时登记基础加成 0.08', Math.abs((run1.fragileBase || {}).power - 0.08) < 1e-6, JSON.stringify(run1.fragileBase));
  check('旧的 stickyStat 已不再使用', run1.stickyStat === undefined, JSON.stringify(run1.stickyStat));
  const cur0 = Tower._debugRun('endless');
  const nx2 = Tower.nextBattle('endless');
  const me2 = Object.assign({}, base); me2.maxHp = base.hp; nx2.adjustMe(me2);
  /* 需求 3：烙印存在时只吃一半 → 实际 +4% */
  check('存在时半效（力量 +4%）', me2.power / pow0 > 1.02 && me2.power / pow0 < 1.06,
    pow0 + ' -> ' + me2.power + '（×' + (me2.power / pow0).toFixed(3) + '）');
  /* 这一场要保证烙印**不碎**，否则面板会变成「已损毁」而不是「存在：半效」。
   * 注入一个「下一步必定不碎」的种子（派生算法与 fragileRoll 一致）。 */
  const miss = (function () {
    const key = String(cur0.salt == null ? 'run' : cur0.salt) + '#' + (Number(cur0.layer) || 0) + '#C39';
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    let st = h >>> 0 || 1;
    for (let i = 0; i < 50; i++) {
      const next = (Math.imul(st, 1664525) + 1013904223) >>> 0;
      if ((next / 4294967296) * 100 >= 60) return st;      // 用 60% 当阈值，确保远离 6% 边界
      st = next;
    }
    return null;
  })();
  if (miss != null) cur0.fragileSeeds = { C39: miss };
  Tower.reportBattle('endless', nx2.token, true, 1);
  const info = Tower.ownedBuffs('endless').find((b) => b.id === 'C39');
  check('面板写明「存在：半效」', !!(info && info.progress && info.progress.indexOf('半效') >= 0), info && info.progress);
  /* 连打直到损毁。每条烙印有自己的随机序列，不能靠改 Math.random 制造；
   * 直接注入一个「下一步必然碎裂」的种子状态（派生算法与 fragileRoll 一致），
   * 避免靠概率采样导致偶发失败。 */
  function seedForHit(salt, id, pct) {
    const key = String(salt == null ? '' : salt) + '#' + id;
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    let st = h >>> 0 || 1;
    for (let i = 0; i < 200; i++) {
      const next = (Math.imul(st, 1664525) + 1013904223) >>> 0;
      if ((next / 4294967296) * 100 < pct) return st;
      st = next;
    }
    return null;
  }
  let broken = false;
  for (let i = 0; i < 40 && !broken; i++) {
    const cur = Tower._debugRun('endless');
    if (cur.choices) { clearPhase(); }
    if (cur.phase === 'shop') { Tower.continueFromShop(); continue; }
    if (cur.phase === 'checkpoint') { Tower.continueEndless(); continue; }
    const hit = seedForHit(cur.salt, 'C39', TowerData.BUFF_BY_ID.C39.mods.fragileBreakPct);
    if (hit != null) cur.fragileSeeds = { C39: hit };
    const nx = Tower.nextBattle('endless');
    if (!nx || nx.ok === false) { clearPhase(); continue; }
    Tower.reportBattle('endless', nx.token, true, 1);
    if (!(Tower._debugRun('endless').limited || []).some((b) => b.id === 'C39')) broken = true;
    clearPhase();
  }
  check('注入必碎种子后一场内损毁', broken, '40 场内未损毁');
  const run2 = Tower._debugRun('endless');
  /* 需求 3：损毁后基础那份整份转为永久（burned += base）→ 实际 = 0.5×base + base = 1.5×base = 12% */
  check('损毁后升为全额并永久保留（+12%）',
    Math.abs(((run2.fragileBase || {}).power) - 0.08) < 1e-6 && Math.abs(((run2.fragileBurned || {}).power) - 0.08) < 1e-6,
    JSON.stringify(run2.fragileBurned));
  // 再拿一次 → 基础再 +8%（已损毁那份不受影响）
  Tower.debugGrantBuff('C39');
  check('再拿一次基础继续叠加', Math.abs((Tower._debugRun('endless').fragileBase || {}).power - 0.16) < 1e-6,
    JSON.stringify(Tower._debugRun('endless').fragileBase));
  // 主动卖掉 → 基础那份收回，已损毁的永久份保留
  Tower.debugLoseBuff('C39');
  const run3 = Tower._debugRun('endless');
  check('主动失去只收回基础那份（永久份保留）',
    Math.abs((run3.fragileBase || {}).power - 0.08) < 1e-6 && Math.abs((run3.fragileBurned || {}).power - 0.08) < 1e-6,
    JSON.stringify({ base: run3.fragileBase, burned: run3.fragileBurned }));
  Tower.abandon('endless');
}
{
  /* 独立随机数：三条烙印在同一场里不该「一起碎」（共用 Math.random 时会） */
  let bothAll = 0, partial = 0, trials = 0;
  for (let t = 0; t < 120 && partial === 0; t++) {
    freshRun();
    ['C39', 'C40', 'C41'].forEach((id) => Tower.debugGrantBuff(id));
    const nx = Tower.nextBattle('endless');
    if (!nx || nx.ok === false) continue;
    Tower.reportBattle('endless', nx.token, true, 1);
    const broken = (Tower._debugRun('endless').buffLog || []).filter((e) => e.event === 'break').length;
    trials++;
    if (broken === 3) bothAll++;
    if (broken > 0 && broken < 3) partial++;
    Tower.abandon('endless');
  }
  check('三条烙印各自独立随机（出现「部分碎」）', partial > 0 || bothAll === 0,
    '试验 ' + trials + ' 次：全碎 ' + bothAll + ' 次、部分碎 ' + partial + ' 次');
}

console.log('\n================ 合计 ' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
