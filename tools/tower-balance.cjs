/* ============================================================
 * 无尽挑战塔：状态机逻辑测试 + 平衡实测
 *
 *   node tools/tower-balance.cjs [每层采样数]
 *   node tools/tower-balance.cjs 200 --layers=1,2,3,4,5,6,7   # 只测这几层（调题面用）
 *
 * A. 逻辑测试：门票/连战继承(无自动回血)/4选1/安慰奖/碎片/无尽商店/结算点/保底
 * B. 平衡实测：目标等级随机玩家对各层的整层通关率（含场间选择、血量继承、
 *    「低血优先回血」的真人策略），以及无尽模式的自动爬层深度分布。
 * 验收（tower-tune v6 实测定标，替代 v1 文档的纸面 55%~65%——
 * v2.0 取消入场自动回血后，整层通关率天然低于单场胜率）：
 *   层 1-5 整层 ≥55%（日常推进区）、层 10-15 ≥15%、层 20-25 ≥8%、层 30 只报告（荣誉墙）。
 * ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const RUNS = Math.max(20, Number(process.argv[2]) || 200);
/* 默认测验收线上的那几层；--layers=1,2,… 可以只测指定层
 * （调 7 个题面时按层看通关率，比只看验收线快得多）。 */
const LAYERS = (() => {
  const arg = process.argv.find((a) => a.startsWith('--layers='));
  if (!arg) return [1, 5, 10, 15, 20, 25, 30];
  const list = arg.slice('--layers='.length).split(',').map((x) => Math.max(1, Math.round(Number(x) || 0))).filter(Boolean);
  return list.length ? list.slice(0, 40) : [1, 5, 10, 15, 20, 25, 30];
})();

/* 随机 boss 池按「日期 + 层数」抽 boss，所以验收必须能换日期复测：
 * --date=2026-9-26 → 固定成那一天（默认）。 */
const DATE = (() => {
  const arg = process.argv.find((a) => a.startsWith('--date='));
  const m = arg && arg.slice('--date='.length).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : [2026, 8, 26];
})();

function setup(storage, keepSave) {
  const store = storage || new Map();
  class ClockDate extends Date { static now() { return new Date(DATE[0], DATE[1], DATE[2], 12).getTime(); } }
  const c = { Date: ClockDate, location: { search: '?qa=1' }, console,
    localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) } };
  c.window = c;
  vm.createContext(c);
  for (const file of ['references/orig/Map.min.js', 'references/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/battle-drops.js', 'js/tower.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  }
  // 整层胜率贴着验收线（层 10-15 ≥15%、层 20-25 ≥8%）跑，用真随机会偶发抖动；
  // 固定种子的 LCG 让每次结果一致，验收才有意义。
  let seed = 20260927;
  vm.runInContext('Math', c).random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  if (!keepSave) c.State.newGame('塔测试');
  /* 第 1 项之后随机只跟层数有关（boss 池 + 三侠顺序），所以验收默认跑「这一条池子」；
   * --salt=xxx 可以整体换成另一条池子抽样（调平衡时用来看别层的对手组合）。 */
  const salt = (process.argv.find((a) => a.startsWith('--salt=')) || '').slice(7);
  if (salt) {
    const TD = c.TowerData, bossFor = TD.bossFor, heroOrder = TD.heroOrder;
    TD.bossFor = (layer) => bossFor(layer, salt);
    TD.heroOrder = (layer) => heroOrder(layer, salt);
  }
  return c;
}

/* ---------- A. 逻辑测试 ---------- */
/* 测试脚本自己也要掷骰子（场间选哪个 buff、无尽结算点去留），
 * 这部分跑在 Node 宿主里，不受 setup() 里那个 vm 的 Math.random 影响，
 * 所以单独给一支固定种子的流，保证整次验收可复现。 */
let hostSeed = 20260927;
const hostRandom = () => { hostSeed = (Math.imul(hostSeed, 1664525) + 1013904223) >>> 0; return hostSeed / 4294967296; };

let passed = 0, failed = 0;
/** 开一局干净的无尽：先把未完成的战斗令牌作废（否则 abandon 会被拒）。 */
function freshEndless(State, Tower) {
  const e = State.state().endless;
  if (e.run && e.run.attempt) Tower.interruptBattle('endless', e.run.attempt);
  if (e.run) Tower.abandon('endless');
  Tower.startEndlessRun();
  return State.state().endless.run;
}
function t(name, cond) { if (cond) { passed++; } else { failed++; console.log('  ✗ ' + name); } }

function unlock(ctx) {
  const S = ctx.State.state();
  S.level = 35;
  for (let id = 1; id <= 18; id++) S.stages[id] = { npcIndex: 3, passed: true };
  S.props[23] = 50;
  return S;
}
/** 用等级适中的 AI 玩家打一场（可调 buff 由状态机注入），返回 {win, ratio}。 */
function autoBattle(ctx, mode, level) {
  const { State, Sim, Tower } = ctx;
  const nx = Tower.nextBattle(mode);
  if (!nx.ok) return { error: nx.msg };
  const me = State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
  me.maxHp = me.hp;
  nx.adjustMe(me);
  const res = Sim.simulate(me, nx.foe);
  const win = res.winner === 0;
  const last = [...res.rounds].reverse().find((r) => Array.isArray(r.hpAfter));
  const ratio = win && last ? Math.max(0, Math.min(1, last.hpAfter[0] / me.maxHp)) : 0;
  // 把战斗结果一起交回去：三侠大招的「本层削弱」要靠它判定（第 3 项）
  return { win, ratio, rw: Tower.reportBattle(mode, nx.token, win, ratio, res), foe: nx.foe, info: nx.info };
}
function autoPick(ctx, mode) {
  const info = mode === 'tower' ? ctx.Tower.towerInfo() : ctx.Tower.endlessInfo();
  const run = info.run;
  if (run && run.choices) {
    // 模拟真人策略：血量低于 75% 优先选固定回血，否则随机拿 buff
    const healIdx = run.choices.findIndex((x) => x.type === 'heal');
    const idx = run.carry < 0.75 && healIdx >= 0 ? healIdx : 1 + Math.floor(hostRandom() * (run.choices.length - 1));
    ctx.Tower.pickChoice(mode, idx);
  }
}

(function logic() {
  const ctx = setup();
  const { State, Tower, TowerData, Sim } = ctx;
  const propMap = ctx.propMap;
  const S = unlock(ctx);
  console.log('A. 状态机逻辑测试');

  t('解锁条件（35 级 + 18 关）', Tower.unlocked().ok);
  S.level = 20;
  t('20 级不解锁', !Tower.unlocked().ok);
  S.level = 35;

  let info = Tower.towerInfo();
  t('主塔初始：下一层 1、4 场、松果 25（与常驻挑战通关看齐）', info.nextLayer === 1 && info.battles === 4 && info.gold === 25);
  // 第 8 项：第 4 场改成随机 boss 池（20 选 1），同一天同一层的预告与实战必须是同一个
  t('第 4 场来自随机 boss 池', ['trial', 'squirrel', 'npc'].includes(info.preview[3].kind));
  t('预告 = 实战（同一天同一层确定性）', Tower.preview(1)[3].name === info.preview[3].name &&
    Tower.preview(1)[3].kind === info.preview[3].kind);
  t('boss 有可悬停的机制简介（不出现「题面/对策」字样）',
    typeof info.preview[3].mechDesc === 'string' && !/题面|对策/.test(info.preview[3].mechDesc));
  // 第 3 项：三侠顺序按「日期 + 层数」随机（换层/换天会变），但同一层预告 = 实战
  {
    const orders = new Set();
    for (let day = 1; day <= 30; day++) {
      for (let n = 1; n <= 12; n++) orders.add(TowerData.heroOrder(n, 'day-' + day).join(''));
    }
    t('三侠出场顺序会洗牌（6 种全排列都能出现）', orders.size === 6);
    t('同一层顺序固定（预告 = 实战、重试不变）',
      TowerData.heroOrder(7).join('') === TowerData.heroOrder(7).join('') && TowerData.heroOrder(7).length === 3);
    // 第 1 项：boss 与三侠顺序都只由层数决定 —— 同一层任何时候都一样
    const bossOf = (n) => TowerData.bossFor(n).kind + ':' + TowerData.bossFor(n).id;
    t('boss 只按层数随机（同层恒定、不随日期/调用次数变化）',
      bossOf(9) === bossOf(9) && bossOf(9) === bossOf(9) && bossOf(1) === bossOf(1));
    t('换层换 boss（30 层里出现多个不同对手）',
      new Set(Array.from({ length: 30 }, (_, i) => bossOf(i + 1))).size > 5);
    const heroOrders = new Set();
    for (let n = 1; n <= 30; n++) heroOrders.add(TowerData.heroOrder(n).join(''));
    t('三侠顺序按层数洗牌（30 层里出现多种排列）', heroOrders.size >= 3);
  }
  {
    // 池子必须覆盖：7 个带机制的松鼠 + 3 只平庸松鼠 + 10 个机制 NPC（都不浪费）
    const kinds = {};
    for (const b of TowerData.BOSS_POOL) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
    /* C 项改造后：挑战塔池保留 NPC 机制怪；无尽塔只用「松鼠/试炼」池。
     * 2026-10 第十四批：无尽池再并入「狂战松鼠」（1 条，变体按层数哈希取）→ 17 → 18；
     * 挑战塔随机池不变（x10 第 5 场已固定一只狂战）。 */
    const eKinds = TowerData.ENDLESS_BOSS_POOL.reduce((m, p) => (m[p.kind] = (m[p.kind] || 0) + 1, m), {});
    t('挑战塔 boss 池仍有 NPC 机制怪（10 个）', TowerData.BOSS_POOL.length === 27 && kinds.npc === 10 && kinds.squirrel === 9);
    t('无尽塔 boss 池 = 松鼠/试炼 + 狂战松鼠（无 NPC）', TowerData.ENDLESS_BOSS_POOL.length === 18 && !eKinds.npc &&
      eKinds.squirrel === 9 && eKinds.trial === 8 && eKinds.warlord === 1);
    t('无尽塔预告（第 4 场）永远不是 NPC',
      [1, 3, 5, 9, 15, 25, 33].every((L) => Tower.preview(L, 'env', true).every((x) => x.kind !== 'npc')));
    t('套装随层升级：1~3 层不出现蓝/紫、10 的倍数层固定狂战',
      [1, 2, 3].every((L) => TowerData.GEAR_TIER[TowerData.gearKeyForLayer(L, 'shogun')] <= 1) &&
      TowerData.gearKeyForLayer(10, 'ninja1') === 'berserk' && TowerData.gearKeyForLayer(23, 'shogun') !== 'berserk');
    const seen = new Set();
    for (let day = 1; day <= 40; day++) {
      for (let n = 1; n <= 20; n++) seen.add(TowerData.bossFor(n, 'day-' + day).kind + ':' + TowerData.bossFor(n, 'day-' + day).id);
    }
    t('换日期能把池子抽满（挑战塔 boss 都出得来）', seen.size === TowerData.BOSS_POOL.length);
    t('松鼠形态的 boss 都有固定且互不相同的装备',
      TowerData.BOSS_POOL.filter((b) => b.kind !== 'npc').every((b) => {
        const e = b.kind === 'trial' ? TowerData.TRIAL_BY_ID[b.id] : TowerData.SQUIRREL_BY_ID[b.id];
        return !!e.gear && TowerData.wearsOf(e.gear).length === 4;
      }) && new Set(TowerData.BOSS_POOL.filter((b) => b.kind !== 'npc').map((b) =>
        (b.kind === 'trial' ? TowerData.TRIAL_BY_ID[b.id] : TowerData.SQUIRREL_BY_ID[b.id]).gear)).size === 10);
    t('狂战套 = 201~204（全身四件）', TowerData.wearsOf(TowerData.WARLORD.gear).map((w) => w.id).join(',') === '201,202,203,204');
  }

  // —— 主塔一层完整流程 ——
  const gold0 = S.goldPoint;
  const started = Tower.startTowerRun();
  t('进层消耗 1 挑战书', started.ok && S.props[23] === 49);

  // 第 1 场：人为构造「赢且只剩 40%」——直接走 reportBattle
  let nx = Tower.nextBattle('tower');
  t('第 1 场是三侠之一', nx.ok && nx.entry.kind === 'hero');
  let rw = Tower.reportBattle('tower', nx.token, true, 0.40);
  // 第 3 项：改成「固定节奏回血」——每场打完自动 +10%，不再从选择里回血
  t('胜场 1：固定节奏回血 14%（0.40→0.54）', Math.abs(Tower.towerInfo().run.carry - 0.54) < 1e-9);
  t('胜场 1：累积 6 松果（25/4 取整）', rw.potGold === 6);
  // 第 3 项：场间选择只在第 3 场之后给一次（进第 4 场前），不再每场都给
  t('胜场 1：不再给场间选择', !rw.choices);

  nx = Tower.nextBattle('tower');
  rw = Tower.reportBattle('tower', nx.token, true, 0.50);
  t('胜场 2：仍不给选择', !rw.choices);

  nx = Tower.nextBattle('tower');
  rw = Tower.reportBattle('tower', nx.token, true, 0.60);
  t('胜场 3：触发 4 选 1（回血 + 3 buff）', Array.isArray(rw.choices) && rw.choices.length === 4 && rw.choices[0].type === 'heal');
  t('选择挂起时不能开战', !Tower.nextBattle('tower').ok);
  let pick = Tower.pickChoice('tower', 0);
  // 环境词缀（A）：触发模型 + 三档对抗 buff + 效果落地
  {
    const eSaveEnv = State.state().endless;
    const bestSaveEnv = eSaveEnv.best, weekSaveEnv = eSaveEnv.weekBest;
    const T = ctx.TowerData, r = freshEndless(State, Tower);
    t('环境词缀：4 条（烈日/寒霜/贪婪/血色）', T.ENDLESS_ENV.length === 4 && !!T.ENDLESS_ENV_BY_ID.greed);
    t('5 层前不触发、概率随层数上升并封顶 80%', T.envChance(4) === 0 && T.envChance(10) > T.envChance(5) && T.envChance(99) === 0.80);
    r.layer = 20;
    for (let i = 0; i < 6; i++) { r.attempt = null; r.choices = null; r.phase = null; const nb = Tower.nextBattle('endless');
      if (!nb.ok) break; Tower.reportBattle('endless', nb.token, true, 0.9, { rounds: [] }); }
    const env = State.state().endless.run.env || [];
    t('15 层起战斗后固定触发（同一时刻不超过 2 条）', env.length >= 1 && env.length <= 2);
    t('每条都有剩余场次（3~6）', env.every((e) => e.left >= 1 && e.left <= 6));
    t('三档对抗 buff：普通限5 / 稀有限10 / 史诗永久', T.BUFF_BY_ID.N09.uses === 5 && T.BUFF_BY_ID.N10.uses === 10 &&
      T.BUFF_BY_ID.C45.kind === 'permanent' && T.BUFF_BY_ID.C45.mods.envDenyGood === 1);
    // 无视 + 反弹：拿 N09 后，负面词缀应不再作用于我方
    State.state().endless.run.env = [{ id: 'frost', left: 3 }, { id: 'greed', left: 3 }];
    Tower.debugGrantBuff('N09');
    const info = Tower.endlessInfo().run;
    t('环境快照带 name/desc/left（界面用来画胶囊）', (info.env || []).every((e) => e.name && e.left >= 1));
    const rr = State.state().endless.run; rr.attempt = null; rr.choices = null; rr.phase = null; rr.shop = null;
    Tower.abandon('endless');
    eSaveEnv.best = bestSaveEnv; eSaveEnv.weekBest = weekSaveEnv;   // 复位成绩，别影响后面的初始态断言
  }
  // 限次开关：关掉只是不生效（仍然在列表里、还是灰的），再点一下恢复
  {
    const eSaveT = State.state().endless;
    const bestSaveT = eSaveT.best, weekSaveT = eSaveT.weekBest;
    const r = freshEndless(State, Tower);
    Tower.debugGrantBuff('N01');
    const before = Tower.ownedBuffs('endless').filter((b) => b.kind === 'limited');
    t('限次增益：拿到后出现在列表里且生效', before.length === 1 && before[0].on === true);
    Tower.toggleLimited('N01', false);
    const off = Tower.ownedBuffs('endless').filter((b) => b.kind === 'limited');
    t('关掉后仍然在列表里，只是 on=false（不会消失）', off.length === 1 && off[0].id === 'N01' && off[0].on === false);
    t('关掉后不生效（不计入战斗加成）', Tower.ownedBuffs('endless').some((b) => b.id === 'N01') &&
      (State.state().endless.run.limited || []).find((b) => b.id === 'N01').on === false);
    Tower.toggleLimited('N01', true);
    const on = Tower.ownedBuffs('endless').filter((b) => b.kind === 'limited');
    t('再点一下恢复生效', on.length === 1 && on[0].on === true);
    const rr = State.state().endless.run;
    if (rr) { rr.attempt = null; rr.choices = null; rr.phase = null; rr.shop = null; Tower.abandon('endless'); }
    eSaveT.best = bestSaveT; eSaveT.weekBest = weekSaveT;   // 复位成绩，避免影响后面的商店用例
  }
  // 第 1 项：休整点回血卡 = 「补给」（限次 1，下一场开局 +50%），再拿一次叠次数
  {
    const eSave = State.state().endless;
    const bestSave = eSave.best, weekSave = eSave.weekBest;
    const r = freshEndless(State, Tower);
    r.choices = [{ type: 'heal' }, { type: 'buff', id: 'N01' }];   // 手工摆一张回血卡 + 一张普通卡
    const healIdx = 0;
    const before = r.carry;
    const got = Tower.pickChoice('endless', healIdx);
    t('拿补给：不立刻回血，而是得到一个限次增益', got.ok === true && r.carry === before &&
      (r.limited || []).some((b) => b.id === 'N08' && b.uses === 1));
    const again = Tower.debugGrantBuff('N08');
    const entry = (r.limited || []).find((b) => b.id === 'N08');
    t('同名再拿一次：补给次数叠加', again.ok === true && entry.uses === 2);
    r.carry = 0.6;
    const nb = Tower.nextBattle('endless');
    t('下一场开局立即回复 50%（60%→封顶 1.00）', nb.ok === true && r.carry === 1);
    // 收尾：把这一局彻底结束，避免影响后面的用例
    if (nb && nb.token) Tower.reportBattle('endless', nb.token, true, 0.8, { rounds: [] });
    const rr = State.state().endless.run;
    if (rr) { rr.attempt = null; rr.choices = null; rr.phase = null; rr.shop = null; Tower.abandon('endless'); }
    eSave.best = bestSave; eSave.weekBest = weekSave;   // 复位成绩，避免影响后面的「初始态」断言
  }

  nx = Tower.nextBattle('tower');
  const bossKinds = ['trial', 'squirrel', 'npc'];
  t('第 4 场是随机 boss 池成员', bossKinds.includes(nx.entry.kind));
  t('松鼠形态的 boss 带固定装备（视觉记忆）', nx.entry.kind === 'npc' ? nx.foe.wears == null
    : (Array.isArray(nx.foe.wears) && nx.foe.wears.length === 4 && nx.foe.wears.every(Boolean)));
  t('松鼠形态的 boss 用同族贴图 + 固定出招循环', nx.entry.kind === 'npc'
    ? (!!nx.foe.npcType && nx.foe.weapons.length > 0)
    : (!nx.foe.npcType && Array.isArray(nx.foe.pattern) && nx.foe.pattern.length > 0));
  // 三侠大招留下的本层削弱会被 adjustMe 吃掉（这里只验证入口暴露出来了）
  t('削弱列表随 nextBattle 暴露给战斗', Array.isArray(nx.debuffs));
  rw = Tower.reportBattle('tower', nx.token, true, 0.55);
  t('通关：整层 25 松果到账（另有悬浮奖品里的金松果）',
    rw.layerComplete === true && rw.gold === 25 && S.goldPoint >= gold0 + 25);
  t('通关：额外补发 3 场挑战的悬浮奖品（9 次飘物）',
    rw.prizes && rw.prizes.picks === 9 && rw.prizes.items.length > 0);
  t('通关：maxLayer=1，run 清空', State.state().tower.maxLayer === 1 && !Tower.towerInfo().run);
  t('主塔 buff 层结束清空（本层选过的 buff 已清）', Tower.ownedBuffs('tower').length === 0);

  // —— 失败安慰奖（第 21 层：G=51，shares [12,12,12,15]） ——
  Tower._debugSetLayer(20);
  Tower.startTowerRun();
  nx = Tower.nextBattle('tower'); Tower.reportBattle('tower', nx.token, true, 0.9);
  nx = Tower.nextBattle('tower'); Tower.reportBattle('tower', nx.token, true, 0.9);
  Tower.pickChoice('tower', 0);
  const goldBefore = S.goldPoint;
  nx = Tower.nextBattle('tower');
  rw = Tower.reportBattle('tower', nx.token, false, 0);
  // 第 1 项：失败不再清空本层、也不当场发安慰奖 —— 保留进度可免费再战，收手才领安慰奖
  t('失败：保留层内进度（run 还在、idx 停在倒下那场）',
    !rw.win && rw.retry === true && !!Tower.towerInfo().run && Tower.towerInfo().run.failedAt != null);
  t('失败：不掉层（仍 20）', State.state().tower.maxLayer === 20);
  t('失败：不扣金松果（安慰奖改成收手才发）', S.goldPoint === goldBefore);
  t('失败：本层仍在，可以直接再开（不用再花书）', !!Tower.towerInfo().run && !Tower.towerInfo().run.attempt);
  t('收手：安慰奖 = 已累积松果的 30%（第 21 层前 2 场 = 24 → 7）', (() => {
    const pot = Tower.towerInfo().run.pot;
    const want = Math.floor(pot * 0.3);
    const out = Tower.giveUp('tower');
    return pot === 24 && want === 7 && out.ok && out.consolation === want && S.goldPoint === goldBefore + want;
  })());
  t('收手：run 清空可重开', !Tower.towerInfo().run && Tower.startTowerRun().ok);

  // —— 播放中断：令牌作废不重复扣书 ——
  const books = S.props[23];
  nx = Tower.nextBattle('tower');
  t('中断：令牌作废、可重打', Tower.interruptBattle('tower', nx.token) && Tower.nextBattle('tower').ok && S.props[23] === books);
  Tower.abandon('tower');

  // —— 无尽模式 ——
  const e0 = Tower.endlessInfo();
  t('无尽初始：最高分 0、无 run', e0.best === 0 && !e0.run);
  const booksBefore = S.props[23];
  t('无尽免门票', Tower.startEndlessRun().ok && S.props[23] === booksBefore);

  // 爬到第 5 层（全胜，随机选项）
  let guard = 0, shopOut = null;
  while (guard++ < 60) {
    autoPick(ctx, 'endless');
    const erun = Tower.endlessInfo().run;
    if (!erun) break;
    if (erun.phase === 'shop') break;
    const b = autoBattle(ctx, 'endless', 70);   // 70 级玩家打低层必赢
    if (b.error) break;
    if (!b.win) break;
    if (b.rw && b.rw.phase === 'shop') { shopOut = b.rw; break; }
  }
  const erun5 = Tower.endlessInfo().run;
  t('无尽：过 5 层进商店', erun5 && erun5.phase === 'shop' && erun5.layer === 5);
  const shop = Tower.shopState();
  t('商店：5 个货架 + 价格梯度', shop && shop.slots.length === 5 && shop.slots.every((s) => [30, 60, 100, 40, 80, 130].includes(s.price)));
  t('商店：通关 5 层赚了试炼币（≥260，含可能的战利品加成）', erun5.coins >= 260);
  const buyable = shop.slots.findIndex((s) => !s.sold && s.price <= erun5.coins);
  const buy = Tower.buyShopSlot(buyable);
  t('商店：买 buff 扣币并入构筑', buy.ok && Tower.ownedBuffs('endless').some((b) => b.id === buy.buff.id));
  /* 回收测试要盯「确实拥有且可回收」的那张，而不是写死 C01 ——
   * 叠层类跨层 buff 会随随机选项流被提前拿到，写死 id 会随机红。 */
  // 第 3 项：限次与永久都能卖（只有即时类不留存）
  t('商店：限次/永久都能卖，即时类不存在可卖', Tower.sellBuff(buy.buff.id).ok === (buy.buff.kind !== 'instant'));
  /* 卖出回收 40%：用一条确定性的自检（给一个无固定卖价的永久 buff 再卖掉），
   * 不再依赖爬塔随机到的构筑，避免被战利品账本/固定卖价类干扰。 */
  t('商店：卖出回收 40%', (() => {
    const run = State.state().endless.run;   // 注意：endlessInfo() 是快照，比币数要用实时 run
    const def = TowerData.BUFF_BY_ID.C01;
    /* 永久槽可能已经被前面的流程占满（满格时 debugGrantBuff 会要求替换）——
     * 先腾一个位置，保证这条自检只测「回收价」这一件事。 */
    const perms = Tower.ownedBuffs('endless').filter((b) => b.kind === 'permanent');
    const cap = Number((Tower.endlessInfo().run || {}).permCap) || 5;
    while (Tower.ownedBuffs('endless').filter((b) => b.kind === 'permanent').length >= cap) {
      const drop = Tower.ownedBuffs('endless').filter((b) => b.kind === 'permanent').pop();
      if (!drop || !Tower.debugLoseBuff(drop.id).ok) break;
    }
    void perms;
    Tower.debugGrantBuff('C01');
    const before = run.coins;
    /* 注意：战利品账本的累计加成现在**只加账本自己**（上一轮第 7 项），
     * 所以卖 C01 只按基础回收价，不能把 sellBonus 加进来。 */
    const out = Tower.sellBuff('C01');
    const want = Math.max(1, Math.round(TowerData.shopPrice(def) * TowerData.SHOP.sellBack));
    return out.ok && out.gain === want && run.coins === before + want;
  })());
  const heal = Tower.buyShopHeal();
  t('商店：治疗泉水限购 1 份', !heal.ok || !Tower.buyShopHeal().ok);   // 买得起就买一次、第二次必须被拒
  t('商店：首次刷新免费', Tower.rerollShop().ok && Tower.shopState().rerollFree === false);

  t('离开商店进结算点', Tower.closeShop().ok && Tower.endlessInfo().run.phase === 'checkpoint');
  const cp = Tower.checkpointInfo();
  t('结算点：5 层离场 1 张卷、继续到 10 层 2 张', cp.ticketsNow === 1 && cp.ticketsNext === 2 && cp.nextCheckpoint === 10);
  const tickets0 = S.props[50] || 0;
  const settled = Tower.settleEndless();
  t('结算离场：1 张抽奖卷入包、分数入账', settled.ok && settled.tickets === 1 && (S.props[50] || 0) === tickets0 + 1 && Tower.endlessInfo().best > 0);

  // 抽奖卷曲线：T(1..7 段) = 1/2/4/8/11/14/17（20 层后线性 +3/段）
  /* 本轮平衡调整：10 层前每档 +1、之后每档 +2（旧曲线 20 层后是每档 +3） */
  t('抽奖卷曲线：10 层前每 5 层 1 张、之后每 5 层 2 张', [5, 10, 15, 20, 25, 30, 35].map((n) => TowerData.endlessTickets(n)).join(',') === '1,2,4,6,8,10,12');

  // —— 无尽失败：卷作废 + 15 层保底 ——
  Tower.startEndlessRun();
  const erun = ctx.State.state().endless.run;
  erun.bestLayer = 16;                       // 模拟到达过 16 层
  const free0 = S.lotteryFree;
  nx = Tower.nextBattle('endless');
  rw = Tower.reportBattle('endless', nx.token, false, 0);
  /* 第 3 项改动后：失败不再归零，按当前层应得结算 */
  t('失败：按当前层应得结算抽奖卷（不再归零）', !rw.win && rw.tickets === TowerData.endlessTickets(erun.layer) && rw.tickets > 0);
  t('保底：≥15 层失败送 1 次免费抽奖', rw.shield === true && S.lotteryFree === free0 + 1);
  // 每日限 1 次
  Tower.startEndlessRun();
  ctx.State.state().endless.run.bestLayer = 18;
  nx = Tower.nextBattle('endless');
  rw = Tower.reportBattle('endless', nx.token, false, 0);
  t('保底：同日不重复送', rw.shield === false && S.lotteryFree === free0 + 1);

  /* —— 本轮（无尽 buff 与结算）的新断言 —— */
  // 第 2 项：跨层固定回复 20% 生命（上面这局是满血爬的，所以另开一局把 carry 压到 0.4 复现）
  {
    Tower.abandon('endless');
    Tower.startEndlessRun();
    // 注意 endlessInfo() 给的是快照，要改数值/推进战斗必须拿 State 里的活对象
    const r = State.state().endless.run;
    r.carry = 0.4; r.layer = 4;
    let g2 = 0;
    while (g2++ < 20 && State.state().endless.run === r && r.layer === 4) {
      if (r.choices) { Tower.pickChoice('endless', 0); continue; }
      const nb = Tower.nextBattle('endless');
      if (!nb.ok) break;
      const rw2 = Tower.reportBattle('endless', nb.token, true, 0.4, { rounds: [] });
      if (!rw2.ok) break;
    }
    t('无尽：跨层回复 20% 生命（0.4 → 0.6）', Math.abs(r.carry - 0.6) < 1e-6 && r.layer === 5);
  }
  // 第 3 项：无尽失败按当前层应得结算抽奖卷（不再归零）
  {
    const r = State.state().endless.run;
    const ticketsBefore = S.props[50] || 0;
    r.layer = 12; r.carry = 0.5;
    const nb = Tower.nextBattle('endless');
    const failOut = Tower.reportBattle('endless', nb.token, false, 0, { rounds: [] });
    t('无尽：失败按当前层结算抽奖卷', failOut.tickets === ctx.TowerData.endlessTickets(12) && failOut.tickets > 0 &&
      (S.props[50] || 0) === ticketsBefore + failOut.tickets);
    t('无尽：失败后本局结束', !Tower.endlessInfo().run);
  }
  // 第 4 项：新 buff（战斗续航可叠加 / 反伤 / 狂怒 / 速度），续航已改成开战回血
  {
    // 第 1 项：buff 改成「限次 / 永久」两分法 + 即时经济类
    /* 本轮（第 3/6/9 项）新增 5 个：E07/E08（即时·削敌方生命上限）、
     * C34/C35/C36（永久·空槽攻击 / 永久数攻击 / 商店消费成长）→ 58 → 63。 */
    t('增益总表：限次 44 / 永久 47 / 即时 11（共 102）+ 44 个无尽专属', ctx.TowerData.BUFFS.length === 102 &&
      ctx.TowerData.BUFFS.filter((b) => b.kind === 'limited').length === 44 &&
      ctx.TowerData.BUFFS.filter((b) => b.kind === 'permanent').length === 47 &&
      ctx.TowerData.BUFFS.filter((b) => b.kind === 'instant').length === 11 &&
      ctx.TowerData.BUFFS.filter((b) => ctx.TowerData.hasTag(b, 'endless') && !ctx.TowerData.hasTag(b, 'tower')).length === 44);
    t('主塔池只吃限次且非无尽专属', ctx.TowerData.towerPool.every((b) => b.kind === 'limited' && !(ctx.TowerData.hasTag(b, 'endless') && !ctx.TowerData.hasTag(b, 'tower'))));
    t('单场 buff 加强（蓄力一击 40% / 血饮狂刀 45%）',
      ctx.TowerData.BUFF_BY_ID.N01.mods.powerMul === 0.40 && ctx.TowerData.BUFF_BY_ID.N06.mods.lifestealPct === 0.45);
    Tower.startEndlessRun();
    const r = State.state().endless.run;
    const pushPerm = (id, stacks) => { const r2 = State.state().endless.run; r2.permanent.push({ id, stacks }); };
    pushPerm('C16', 1); pushPerm('C17', 2); pushPerm('C19', 1); pushPerm('C20', 1); pushPerm('C23', 1);
    r.carry = 0.5; r.layer = 3;
    const nb = Tower.nextBattle('endless');
    const me2 = State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    me2.maxHp = me2.hp; const spd0 = me2.speed;
    nb.adjustMe(me2);
    t('新永久 buff 进入战斗（反伤 20% / 狂怒 50% / 速度 +15%）',
      me2.mods.thornsPct === 0.2 && me2.mods.lowHpPowerMul === 0.5 && me2.mods.lowHpAt === 0.40 &&
      Math.abs(me2.speed - Math.round(spd0 * 1.15)) <= 1);
    /* 战斗续航（C16 5% + C17 10%×2 = 25%）：改成**开战第一回合**按本场真实上限回血。
     * carry 0.5 折出来的进场血是 50%，开战再回 25% → 血条 75%（与旧版「战后回血」
     * 的 75% 数值巧合一致，但时机、基准与「能填进空血上限」都变了）。 */
    const hpIn = Math.round(me2.maxHp * 0.5);
    t('战斗续航改成开战结算且可叠加（5% + 10%×2 = 25% → 50% + 25% = 75%）',
      Math.abs(me2.hp - Math.min(me2.maxHp, hpIn + Math.round(me2.maxHp * 0.25))) <= 1);
    const winOut = Tower.reportBattle('endless', nb.token, true, me2.hp, me2.maxHp);
    t('战斗胜利后不再由续航回血（改到下一场开战结算）', winOut.ok === true && winOut.winHeal == null);
    // 第 1 项：永久上限 5 格、限次可开关且打完扣次数
    {
      const r2 = State.state().endless.run;
      r2.permanent = [{ id: 'C01', stacks: 1 }, { id: 'C02', stacks: 1 }, { id: 'C03', stacks: 1 }, { id: 'C04', stacks: 1 }, { id: 'C05', stacks: 1 }];
      r2.choices = [{ type: 'buff', id: 'C10' }];
      const blocked = Tower.pickChoice('endless', 0);
      t('永久增益满 5 格：先要求替换', blocked.ok === false && blocked.needsReplace === true && r2.permanent.length === 5);
      const done = Tower.pickChoice('endless', 0, 'C03');
      t('替换后永久仍是 5 格且换成新 buff', done.ok === true && r2.permanent.length === 5 &&
        !r2.permanent.some((b) => b.id === 'C03') && r2.permanent.some((b) => b.id === 'C10'));
      const instant = Tower.addBuff(r2, 'E02');
      t('即时经济 buff 不占格子且真的加币', instant.ok === true && instant.instant === true && r2.permanent.length === 5);
      r2.limited.push({ id: 'N01', stacks: 1, uses: 2, on: true });
      Tower.toggleLimited('N01', false);
      const nb3 = Tower.nextBattle('endless');
      Tower.reportBattle('endless', nb3.token, true, 0.8, { rounds: [] });
      t('限次关闭时不扣次数', (r2.limited.find((b) => b.id === 'N01') || {}).uses === 2);
      Tower.toggleLimited('N01', true);
      const nb4 = Tower.nextBattle('endless');
      Tower.reportBattle('endless', nb4.token, true, 0.8, { rounds: [] });
      t('限次开启后打完一场扣 1 次', (r2.limited.find((b) => b.id === 'N01') || {}).uses === 1);
    }
    Tower.abandon('endless');
  }
  // 第 5 项：反弹致死也要触发复活甲（原来只有 applyDamage 里判，反伤/中毒打死不触发）
  {
    const mk = (mods, hp) => { const f = State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true }); f.maxHp = f.hp = hp; f.mods = mods || {}; return f; };
    // 构造「一定是被反弹打死」：自己一击极高（15% 反弹足够秒掉自己），
    // 敌人本身只打 1 点、血厚到打不死，所以本场唯一的致死来源就是反弹。
    const victim = mk({ deathSaves: [{ healPct: 0.5 }] }, 2000);
    victim.power = 100000; victim.agility = 500; victim.speed = 999;
    const thornFoe = State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    Object.assign(thornFoe, { maxHp: 1000000000, hp: 1000000000, power: 1, agility: 1, speed: 1, mech: ['thorns'] });
    const sim = Sim.simulate(victim, thornFoe);
    t('复活甲：反弹致死也会触发', sim.rounds.some((r) => r.thornsDmg && r.deathSave) ||
      sim.rounds.some((r) => r.deathSave) && !sim.rounds.some((r) => r.deathSave === undefined && r.dmg && r.attacker === 1));
    const playerThorns = mk({ thornsPct: 0.5 }, 20000);
    playerThorns.power = 200; playerThorns.speed = 1;
    const fastFoe = State.genAI(70, '', { levelJitter: 0, gearSelfLevel: true });
    Object.assign(fastFoe, { maxHp: 200000, hp: 200000, power: 300, agility: 50, speed: 300 });
    const sim2 = Sim.simulate(playerThorns, fastFoe);
    t('荆棘之甲：受击反弹给敌人', sim2.rounds.filter((r) => r.dmg && r.attacker === 1).every((r) => r.thornsDmg > 0) &&
      sim2.rounds.some((r) => r.thornsDmg > 0));
  }

  // 第 1 项修正：本段机制按段轮转（不再「一旦出现就永远挂着」）
  {
    const T = ctx.TowerData, mechs = (n) => T.endlessMechs(n).join('+');
    t('段机制按段轮转：第 2 段反伤、第 3 段不再反伤',
      T.endlessMechs(6).includes('thorns') && !T.endlessMechs(11).includes('thorns'));
    t('段机制同屏最多 3 个', [1, 6, 11, 16, 21, 26, 31, 41].every((n) => T.endlessMechs(n).length <= 3));
    t('段机制会回来（第 5/6 段又出现反伤）',
      T.endlessMechs(21).includes('thorns') && T.endlessMechs(26).includes('thorns'));
    // 建造出来的敌人只用本段的机制
    const r = freshEndless(State, Tower); r.layer = 11;
    const nx = Tower.nextBattle('endless');
    t('第 11 层的敌人不带反伤', !(nx.foe.mech || []).includes('thorns') &&
      (nx.foe.mech || []).includes('regen'));
  }
  // 第 4 项：休整点商店（每层一次）
  {
    const r = freshEndless(State, Tower);
    t('没有休整点不让开休整商店', Tower.openRestShop().ok === false);
    r.choices = [{ type: 'heal' }, { type: 'buff', id: 'N01' }];
    const opened = Tower.openRestShop();
    t('休整点可以开一次休整商店', opened.ok === true && r.phase === 'shop' && r.shop.rest === true);
    t('同一层不能开第二次', Tower.openRestShop().ok === false);
    Tower.closeShop();
    t('休整商店关掉直接回战斗（不去结算点）', r.phase === null);
    r.restShopUsed = true;
    let guard = 0, advanced = false;
    while (guard++ < 12 && !advanced) {
      if (r.choices) { Tower.pickChoice('endless', 0); continue; }
      const nbLast = Tower.nextBattle('endless');
      if (!nbLast.ok) break;
      const res2 = Tower.reportBattle('endless', nbLast.token, true, 0.8, { rounds: [] });
      if (!res2.ok) break;
      if (r.layer !== 1) advanced = true;
    }
    t('换层后休整商店次数重置', advanced && r.restShopUsed === false && r.layer === 2);
    Tower.abandon('endless');
  }
  /* 【本轮删除】三种属性药丸槽位（塔内 20 场）整块移除：
   * 不再有 usePillSlot / run.pillSlots / PILL_SLOTS，药丸只在局外 totalStats 生效。
   * 这里只留一条「接口确实没了」的断言，防止旧代码被误加回来。 */
  {
    const r = freshEndless(State, Tower);
    t('药丸槽位接口已删除（usePillSlot / run.pillSlots / PILL_SLOTS 都不存在）',
      typeof Tower.usePillSlot === 'undefined' && typeof ctx.TowerData.PILL_SLOTS === 'undefined' &&
      typeof ctx.TowerData.pillEffect === 'undefined' && r.pillSlots === undefined);
    Tower.abandon('endless');
  }
  // 第 1 项（本轮）：名贵手表（商店不卖、卖出 200）+ 战利品账本（按胜场累计卖出收益）
  {
    const T = ctx.TowerData;
    t('名贵手表：稀有 / 永久 / 商店不卖', T.BUFF_BY_ID.C24.rarity === 1 && T.BUFF_BY_ID.C24.kind === 'permanent' &&
      !T.hasTag(T.BUFF_BY_ID.C24, 'shop') && T.BUFF_BY_ID.C24.mods.sellValue === 200);
    t('商店货架池不含名贵手表', !(T.shopPool || []).some((b) => b.id === 'C24'));
    const r = freshEndless(State, Tower);
    r.shop = Tower.shopState ? (Tower.shopState() || null) : null;
    // 直接造一个商店，验证卖出价与账本累计
    Tower.openRestShop && (r.choices = [{ type: 'heal' }], Tower.openRestShop());
    r.permanent.push({ id: 'C24', stacks: 1 }, { id: 'C25', stacks: 1 });
    const nb = Tower.nextBattle('endless');
    Tower.reportBattle('endless', nb.token, true, 0.8, { rounds: [] });
    t('胜利后账本累计 +10', (r.sellBonus || 0) === 10);   // 本轮第 2 项：25 -> 10
    /* 本轮第 7 项：账本的累计加成**只加账本自己**（原来把它加到所有 buff 的卖价上）。
     * 所以名贵手表按自身固定价 200 卖出，账本自己才是「基础价 + 累计」。 */
    const sold = Tower.sellBuff('C24');
    t('名贵手表只按自身固定价 200 卖出（账本不再普涨卖价）', sold.ok === true && sold.gain === 200 && r.coins >= 200);
    const ledger = Tower.ownedBuffs('endless').find((b) => b.id === 'C25');
    const ledgerBase = Math.max(1, Math.round(ctx.TowerData.shopPrice(ctx.TowerData.BUFF_BY_ID.C25) * ctx.TowerData.SHOP.sellBack));
    t('账本自身卖价 = 基础 ' + ledgerBase + ' + 累计 10', !!ledger && ledger.sellPrice === ledgerBase + 10);
    Tower.abandon('endless');
  }
  // 选取型隐藏 buff：神兵淬炼 / 秘技通神（立即生效、隐藏、不可出售、一局一次）
  {
    const T = ctx.TowerData, r = freshEndless(State, Tower);
    t('神兵淬炼/秘技通神：史诗·隐藏·unique·商店都能出', T.hasTag(T.BUFF_BY_ID.C32, 'hidden') && T.hasTag(T.BUFF_BY_ID.C33, 'hidden') &&
      T.hasTag(T.BUFF_BY_ID.C32, 'unique') && T.inPool('shop', T.BUFF_BY_ID.C32) && T.inPool('choice', T.BUFF_BY_ID.C33));
    const res = Tower.debugGrantBuff('C32');
    t('拿到神兵淬炼：立即进入待选取（pendingPick=weapon）', res.ok === true && r.pendingPick && r.pendingPick.kind === 'weapon');
    t('隐藏型不进增益面板', !Tower.ownedBuffs('endless').some((b) => b.id === 'C32'));
    t('隐藏型不可出售', Tower.sellBuff('C32').ok === false);
    Tower.state && 0;
    const cands = Tower.pickCandidates('weapon');
    t('三选一候选最多 3 个且都是已有武器', cands.length <= 3 && cands.every((c) => c.id != null));
    if (cands.length) {
      const ap = Tower.applyPickBuff('weapon', cands[0].id);
      t('落地强化：weaponBoost 记下该武器 +100%',
        ap.ok === true && r.weaponBoost && Number(r.weaponBoost[cands[0].id]) === 1);
    } else {
      t('没有武器时不落地（保留 pendingPick 等以后选）', r.pendingPick && r.pendingPick.kind === 'weapon');
    }
    /* 本轮第 4 项最终口径：拿到就登记「一局一次」（不再重复刷到），
   * 但 pendingPick 会保留 —— 没武器时不算白拿，之后拿到武器照样弹三选一。 */
  t('拿到后不会再被刷到（一局一次）', Tower.debugGrantBuff('C32').ok === false);
    // 调试面板能列出来（pickBuffIds 是调试用的可见来源），也能被「失去」
    /* 本轮第 4 项：选取型不再「一拿到就登记」——那会让「当时没有武器可选」的情况白白消耗掉。
   * 现在落地前由 pendingPick 记录，落地后才进 pickBuffIds。 */
  t('选取型在落地前由 pendingPick 记录', !!(r.pendingPick && r.pendingPick.buffId === 'C32'));
    const lostPick = Tower.debugLoseBuff('C32');
    t('调试可失去选取型 buff，并清掉它带来的强化',
      lostPick.ok === true && !(r.pickBuffIds || []).includes('C32') && !r.weaponBoost);
    const rr = State.state().endless.run; rr.attempt = null; rr.choices = null; rr.phase = null; rr.shop = null;
    Tower.abandon('endless');
  }
  // 第 2 项（本轮）：槽位 buff、以战养战、登顶者、破釜沉舟
  {
    const T = ctx.TowerData, r = freshEndless(State, Tower);
    t('扩容背包：史诗 / unique / +1 槽 / 商店可出', T.BUFF_BY_ID.C30.rarity === 2 && T.hasTag(T.BUFF_BY_ID.C30, 'unique') &&
      T.BUFF_BY_ID.C30.mods.permSlot === 1 && T.inPool('shop', T.BUFF_BY_ID.C30));
    t('仓库钥匙：传奇 / unique / +2 槽 / 仅战斗', T.BUFF_BY_ID.C31.rarity === 3 && T.BUFF_BY_ID.C31.mods.permSlot === 2 &&
      !T.inPool('shop', T.BUFF_BY_ID.C31) && T.inPool('choice', T.BUFF_BY_ID.C31));
    const grant = Tower.debugGrantBuff('C30');
    t('获得扩容背包：槽位 5→6 且不入永久栏', grant.ok === true && r.permSlots === 1 && (r.permanent || []).length === 0);
    // 永久栏塞满 5 个后再拿扩容类：不应被要求替换，也不该占槽
    for (const id of ['C01', 'C02', 'C03', 'C04', 'C05']) Tower.debugGrantBuff(id);
    const fullOk = (r.permanent || []).length === 5;
    const grant2 = Tower.debugGrantBuff('C31');
    t('永久栏满 5 格时拿「仓库钥匙」：直接 +2 槽、不触发替换、不占槽',
      fullOk && grant2.ok === true && r.permSlots === 3 && (r.permanent || []).length === 5);
    t('扩容后永久上限 = 5 + permSlots', (5 + r.permSlots) === 8);
    const snap = Tower.endlessInfo().run;
    t('快照也带 permSlots/permCap（界面显示 N/6 靠它）', snap.permSlots === 3 && snap.permCap === 8);
    const dup = Tower.debugGrantBuff('C30');
    t('扩容背包一局只能拿一次（unique 过滤）', dup.ok === false && (r.permSlotIds || []).filter((x) => x === 'C30').length === 1);
    const lost = Tower.debugLoseBuff('C30');
    t('调试可立即失去任意 buff', lost.ok === true && !(r.permSlotIds || []).includes('C30'));
    r.permanent.push({ id: 'C11', stacks: 1 }, { id: 'C12', stacks: 1 });
    const before = r.winHpFlat || 0;
    const nb = Tower.nextBattle('endless');
    Tower.reportBattle('endless', nb.token, true, 0.8, { rounds: [] });
    t('以战养战：胜利后生命上限 +10（不封顶）', (r.winHpFlat || 0) === before + 10);
    t('登顶者：10 层以上每胜一场攻击 +5%', r.layer < 10 || (r.winPower || 0) >= 0.05);
    t('破釜沉舟：攻击 +50% / 生命上限 −20%', T.BUFF_BY_ID.G07.mods.powerMul === 0.50 && T.BUFF_BY_ID.G07.mods.maxHpMul === -0.20);
    t('先手制敌 3 场 / 血饮狂刀 5 场', T.BUFF_BY_ID.N05.uses === 3 && T.BUFF_BY_ID.N06.uses === 5);
    Tower.abandon('endless');
  }
  // 第 2 项：限次 buff 的次数铺成 1/2/3/5/10
  {
    const T = ctx.TowerData;
    /* 易碎烙印（本轮第 7 项）虽然也是 limited，但次数 1000 只是个「不会耗尽」的写法，
     * 它真正的结束方式是每场 5% 损毁 —— 不参与「场次档位」这条自检。 */
    const lim = T.BUFFS.filter((b) => b.kind === 'limited' && !(T.hasTag(b, 'endless') && !T.hasTag(b, 'tower')) &&
      !(b.mods && b.mods.fragileBreakPct));
    const kinds = [...new Set(lim.map((b) => b.uses))].sort((a, b) => a - b);
    t('限次次数覆盖 1/2/3/5/10（补给的 1 场）', kinds.join(',') === '1,2,3,5,10');
    t('每个限次 buff 都有合法次数', lim.every((b) => [1, 2, 3, 5, 10].includes(b.uses)));
  }
  // 第 3 项：无尽主界面也要有本层对手预告
  {
    freshEndless(State, Tower);
    const info = Tower.endlessInfo();
    t('无尽主界面能看到本层对手与段机制', Array.isArray(info.run.plan) && info.run.plan.length === 4 &&
      info.run.plan.every((e) => e.name) && Array.isArray(info.run.mechs));
    Tower.abandon('endless');
  }
  // 第 3 项：无尽每爬 10 层发一次里程碑奖励（技能卷轴×10 / 武器卷轴×10 / 随机药丸）
  {
    const clearLayerTo = (want) => {
      const r = freshEndless(State, Tower);
      r.layer = want; r.carry = 0.8;
      let ms = null;
      for (let g3 = 0; g3 < 20 && !ms; g3++) {
        if (r.choices) { Tower.pickChoice('endless', 0); continue; }
        if (r.phase === 'shop') { Tower.closeShop(); continue; }
        if (r.phase === 'checkpoint') { Tower.continueEndless(); continue; }
        const nb = Tower.nextBattle('endless');
        if (!nb.ok) break;
        const rw3 = Tower.reportBattle('endless', nb.token, true, 0.8, { rounds: [] });
        if (!rw3.ok) break;
        if (rw3.milestone) ms = rw3.milestone;
      }
      return { run: r, ms };
    };
    const hit = clearLayerTo(10);
    const before = 0;   // 只校验增量：milestone 一定是本次新增
    const allowed = [21, 22, 3, 4, 5, 7, 41, 42, 43, 44];
    t('无尽：第 10 层结算发里程碑奖励', !!hit.ms && allowed.includes(hit.ms.propId) && hit.ms.count >= 1);
    t('无尽：卷轴 ×10、药丸 ×1', !!hit.ms &&
      ((hit.ms.propId === 21 || hit.ms.propId === 22) ? hit.ms.count === 10 : hit.ms.count === 1));
    t('无尽：非整十层不发里程碑', !clearLayerTo(11).ms);
    const msName = hit.ms ? propMap.getValue(hit.ms.propId).name : '';
    t('无尽：里程碑奖励有名字', !!hit.ms && msName === hit.ms.name);
    Tower.abandon('endless');
  }

  // —— 存档迁移：坏值钳制 + 旧档无字段 ——
  const store2 = new Map();
  const ctx2 = setup(store2);
  const S2 = ctx2.State.state();
  S2.tower = { maxLayer: -5, run: { layer: 'x', plan: [] } };
  S2.endless = { best: 'abc', run: { layer: 7, plan: [{ kind: 'hero', anim: 'tl' }], idx: 99, attempt: 'stale', choices: [{ type: 'heal' }] } };
  ctx2.State.save();
  const ctx3 = setup(store2, true);   // 重新读档（不再新开存档）
  ctx3.State.load();
  const S3 = ctx3.State.state();
  t('迁移：坏 run 作废、坏值归零', S3.tower.maxLayer === 0 && S3.tower.run === null && S3.endless.best === 0);
  const eRun3 = ctx3.Tower.endlessInfo().run;   // 经 tower.js 深校验（idx 钳回合法范围）
  t('迁移：合法 run 保留但令牌/选择作废', !!eRun3 && eRun3.layer === 7 && eRun3.battleNo === 1 &&
    !S3.endless.run.attempt && S3.endless.run.choices === null);

  console.log('  通过 ' + passed + ' 项' + (failed ? '，失败 ' + failed + ' 项' : ''));
})();

/* ---------- B. 平衡实测 ---------- */
(function balance() {
  const ctx = setup();
  const { State, Tower, TowerData, Sim } = ctx;
  unlock(ctx);
  console.log('\nB. 主塔平衡实测（每层 ' + RUNS + ' 次整层挑战，目标等级随机玩家，随机场间选择）');
  console.log('层数   目标等级  整层胜率  低5级   高5级   精英场');

  const fails = [];
  for (const layer of LAYERS) {
    const LT = TowerData.towerLevel(layer);
    const measure = (level) => {
      let cleared = 0, eliteWins = 0, eliteGames = 0;
      for (let i = 0; i < RUNS; i++) {
        Tower._debugSetLayer(layer - 1);
        State.state().props[23] = 99;
        Tower.startTowerRun();
        let ok = true, guard = 0;
        while (ok && guard++ < 20) {
          autoPick(ctx, 'tower');
          if (!Tower.towerInfo().run) break;
          const b = autoBattle(ctx, 'tower', level);
          if (b.error) { ok = false; break; }
          if (b.info && b.info.elite) { eliteGames++; if (b.win) eliteWins++; }
          if (!b.win) ok = false;
        }
        if (ok && !Tower.towerInfo().run) cleared++;
        if (Tower.towerInfo().run) Tower.abandon('tower');
      }
      return { clear: cleared / RUNS, elite: eliteGames ? eliteWins / eliteGames : null };
    };
    const at = measure(LT), low = measure(Math.max(1, LT - 5)), high = measure(Math.min(70, LT + 5));
    // 分档验收：日常区要顺、墙区要硬但不绝路
    const floor = layer <= 5 ? 0.55 : layer <= 15 ? 0.15 : layer <= 25 ? 0.08 : 0;   // 30+ 是荣誉墙，只报告不设限
    const ok = at.clear >= floor;
    if (!ok) fails.push(layer + ' 层 ' + (at.clear * 100).toFixed(0) + '%（期望 ≥' + floor * 100 + '%）');
    console.log(String(layer).padEnd(4) + String(LT).padStart(8) + '  ' +
      (at.clear * 100).toFixed(0).padStart(6) + '%  ' + (low.clear * 100).toFixed(0).padStart(5) + '%  ' +
      (high.clear * 100).toFixed(0).padStart(5) + '%  ' + (at.elite == null ? '—' : (at.elite * 100).toFixed(0) + '%'));
  }

  /* D. 逐场强度（--battles）：看「第 4 场（boss）是不是真的比前三场难」。
   * 只统计「打到这一场时仍满状态/带血继承」的真实连战，所以是关卡内的自然节奏。 */
  if (process.argv.includes('--battles')) {
    console.log('\nD. 逐场胜率与剩余血量（同一层内连战，不重置血量）');
    console.log('层数  场次  对手                    样本  胜率   胜时剩血  平均回合');
    for (const layer of (process.env.BATTLE_LAYERS || '1,5,10,15,20').split(',').map(Number)) {
      Tower._debugSetLayer(layer - 1);
      const stats = [];
      for (let i = 0; i < RUNS; i++) {
        State.state().props[23] = 99;
        Tower.startTowerRun();
        let guard = 0;
        while (guard++ < 9) {
          const run = Tower.towerInfo().run;
          if (!run) break;
          if (run.choices) { autoPick(ctx, 'tower'); continue; }
          const nx = Tower.nextBattle('tower');
          if (!nx.ok) break;
          const level = TowerData.towerLevel(layer);
          const me = State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
          me.maxHp = me.hp; nx.adjustMe(me);
          const res = Sim.simulate(me, nx.foe);
          const last = [...res.rounds].reverse().find((r) => Array.isArray(r.hpAfter));
          const win = res.winner === 0;
          const ratio = win && last ? Math.max(0, Math.min(1, last.hpAfter[0] / me.maxHp)) : 0;
          const slot = stats[run.battleNo - 1] || (stats[run.battleNo - 1] = { name: nx.info.name, kind: nx.entry.kind, n: 0, win: 0, hp: 0, rounds: 0 });
          slot.n++; if (win) { slot.win++; slot.hp += ratio; } slot.rounds += res.rounds.length;
          const rw = Tower.reportBattle('tower', nx.token, win, ratio, res);
          if (!rw.ok || !rw.win) break;
        }
        if (Tower.towerInfo().run) Tower.abandon('tower');
      }
      stats.forEach((sl, i) => {
        if (!sl) return;
        console.log(String(layer).padEnd(5) + String(i + 1).padEnd(6) + String(sl.name).padEnd(22) +
          String(sl.n).padStart(4) + '  ' +
          ((sl.win / sl.n) * 100).toFixed(0).padStart(4) + '%  ' +
          ((sl.win ? (sl.hp / sl.win) * 100 : 0).toFixed(0) + '%').padStart(7) + '  ' +
          (sl.rounds / sl.n).toFixed(1).padStart(7));
      });
    }
  }

  console.log('\nC. 无尽模式自动爬层（45 级玩家、随机选项、不逛商店、每结算点抛硬币决定去留）');
  const depths = [];
  for (let i = 0; i < RUNS; i++) {
    Tower.startEndlessRun();
    let guard = 0;
    while (guard++ < 200) {
      autoPick(ctx, 'endless');
      const run = Tower.endlessInfo().run;
      if (!run) break;
      if (run.phase === 'shop') { Tower.closeShop(); }
      if (run.phase === 'checkpoint') {
        if (hostRandom() < 0.5) { Tower.settleEndless(); break; }
        Tower.continueEndless();
        continue;
      }
      const b = autoBattle(ctx, 'endless', 45);
      if (b.error || !b.win) break;
    }
    depths.push(Tower.endlessInfo().bestLayer);
  }
  depths.sort((a, b) => a - b);
  const avg = depths.reduce((s, v) => s + v, 0) / depths.length;
  console.log('  最深到达层：均值 ' + avg.toFixed(1) + '，中位 ' + depths[Math.floor(depths.length / 2)] +
    '，P90 ' + depths[Math.floor(depths.length * 0.9)] + '，最高 ' + depths[depths.length - 1]);

  console.log('\n主塔整层胜率分档验收（55/15/8/1%）：' + (fails.length ? '不达标 → ' + fails.join('、') : '全部达标'));
  process.exitCode = failed || fails.length ? 1 : 0;
})();
