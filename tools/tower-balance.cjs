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
  for (const file of ['js/orig/Map.min.js', 'js/orig/GameDict.js', 'js/gamedata.js', 'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/battle-drops.js', 'js/tower.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, { filename: file });
  }
  // 整层胜率贴着验收线（层 10-15 ≥15%、层 20-25 ≥8%）跑，用真随机会偶发抖动；
  // 固定种子的 LCG 让每次结果一致，验收才有意义。
  let seed = 20260927;
  vm.runInContext('Math', c).random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  if (!keepSave) c.State.newGame('塔测试');
  return c;
}

/* ---------- A. 逻辑测试 ---------- */
/* 测试脚本自己也要掷骰子（场间选哪个 buff、无尽结算点去留），
 * 这部分跑在 Node 宿主里，不受 setup() 里那个 vm 的 Math.random 影响，
 * 所以单独给一支固定种子的流，保证整次验收可复现。 */
let hostSeed = 20260927;
const hostRandom = () => { hostSeed = (Math.imul(hostSeed, 1664525) + 1013904223) >>> 0; return hostSeed / 4294967296; };

let passed = 0, failed = 0;
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
  const { State, Tower, TowerData } = ctx;
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
  t('第 10 层 5 场、最后一场是狂战松鼠', Tower.preview(10).length === 5 &&
    Tower.preview(10)[4].elite === true && Tower.preview(10)[4].name === '狂战松鼠·无双' && Tower.preview(10)[4].gear === true);
  {
    // 池子必须覆盖：7 个带机制的松鼠 + 3 只平庸松鼠 + 10 个机制 NPC（都不浪费）
    const kinds = {};
    for (const b of TowerData.BOSS_POOL) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
    t('随机 boss 池 = 7 机制松鼠 + 3 平庸松鼠 + 10 机制 NPC',
      TowerData.BOSS_POOL.length === 20 && kinds.trial === 7 && kinds.squirrel === 3 && kinds.npc === 10);
    const seen = new Set();
    for (let day = 1; day <= 40; day++) {
      for (let n = 1; n <= 20; n++) seen.add(TowerData.bossFor(n, 'day-' + day).kind + ':' + TowerData.bossFor(n, 'day-' + day).id);
    }
    t('换日期能把池子抽满（20 个 boss 都出得来）', seen.size === TowerData.BOSS_POOL.length);
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
  t('固定项回血 50%（60%→封顶 1.00）', pick.ok && Math.abs(Tower.towerInfo().run.carry - 1) < 1e-9);

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
  t('商店：通关 5 层赚了试炼币（4×5 场×8 + 5 层×20 = 260）', erun5.coins === 260);
  const buyable = shop.slots.findIndex((s) => !s.sold && s.price <= erun5.coins);
  const buy = Tower.buyShopSlot(buyable);
  t('商店：买 buff 扣币并入构筑', buy.ok && Tower.ownedBuffs('endless').some((b) => b.id === buy.buff.id));
  /* 回收测试要盯「确实拥有且可回收」的那张，而不是写死 C01 ——
   * 叠层类跨层 buff 会随随机选项流被提前拿到，写死 id 会随机红。 */
  t('商店：单场类 buff 不可回收', buy.buff.scope !== 'battle' || Tower.sellBuff(buy.buff.id).ok === false);
  const sellable = Tower.ownedBuffs('endless').find((b) => b.scope !== 'battle');
  t('商店：卖出回收 40%', !sellable || (() => {
    const before = Tower.endlessInfo().run.coins;
    const out = Tower.sellBuff(sellable.id);
    const want = Math.max(1, Math.round(TowerData.shopPrice(TowerData.BUFF_BY_ID[sellable.id]) * TowerData.SHOP.sellBack));
    return out.ok && out.gain === want && Tower.endlessInfo().run.coins === before + want;
  })());
  const heal = Tower.buyShopHeal();
  t('商店：治疗泉水限购 1 份', heal.ok && !Tower.buyShopHeal().ok);
  t('商店：首次刷新免费', Tower.rerollShop().ok && Tower.shopState().rerollFree === false);

  t('离开商店进结算点', Tower.closeShop().ok && Tower.endlessInfo().run.phase === 'checkpoint');
  const cp = Tower.checkpointInfo();
  t('结算点：5 层离场 1 张卷、继续到 10 层 2 张', cp.ticketsNow === 1 && cp.ticketsNext === 2 && cp.nextCheckpoint === 10);
  const tickets0 = S.props[50] || 0;
  const settled = Tower.settleEndless();
  t('结算离场：1 张抽奖卷入包、分数入账', settled.ok && settled.tickets === 1 && (S.props[50] || 0) === tickets0 + 1 && Tower.endlessInfo().best > 0);

  // 抽奖卷曲线：T(1..7 段) = 1/2/4/8/11/14/17（20 层后线性 +3/段）
  t('抽奖卷曲线 20 层后线性', [5, 10, 15, 20, 25, 30, 35].map((n) => TowerData.endlessTickets(n)).join(',') === '1,2,4,8,11,14,17');

  // —— 无尽失败：卷作废 + 15 层保底 ——
  Tower.startEndlessRun();
  const erun = ctx.State.state().endless.run;
  erun.bestLayer = 16;                       // 模拟到达过 16 层
  const free0 = S.lotteryFree;
  nx = Tower.nextBattle('endless');
  rw = Tower.reportBattle('endless', nx.token, false, 0);
  t('失败：卷作废（tickets=0）', !rw.win && rw.tickets === 0);
  t('保底：≥15 层失败送 1 次免费抽奖', rw.shield === true && S.lotteryFree === free0 + 1);
  // 每日限 1 次
  Tower.startEndlessRun();
  ctx.State.state().endless.run.bestLayer = 18;
  nx = Tower.nextBattle('endless');
  rw = Tower.reportBattle('endless', nx.token, false, 0);
  t('保底：同日不重复送', rw.shield === false && S.lotteryFree === free0 + 1);

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
  const { State, Tower, TowerData } = ctx;
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
