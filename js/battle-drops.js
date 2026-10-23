/* Original pickup system, read from the shipped client's js/ssdz-pkg2.js
 * (class FightScene / Quark.FightProps — NOT js/FightStats.js, which is only the
 * FightSet_1..5 battle-scene parallax data):
 *     this.fightingTimes++;
 *     this.fightingTimes == 30  + this.counter -> reward[0]
 *     this.fightingTimes == 180 + this.counter -> reward[1]
 *     this.fightingTimes == 340 + this.counter -> reward[2]
 *   with `this.counter = Math.round(Math.random() * 130)` set per battle, at 15fps.
 *   The original FightProps whitelist is ids {1,2,8,15,21,22,45,50}; the fragment
 *   ids 24/25/26 are NOT in it and are an explicit offline addition.
 *   Reward odds came from the unavailable
 *   server; this small pool is an explicit offline balance, separate from battle
 *   damage and stage loot. */ 

/* ------------------------------------------------------------
 * 目录：战斗掉落拾取（原版 FightProps 复刻）
 * Ctrl+F 搜节号（如「【BD1】」）直达对应代码块。
 *
 *  【BD1】规则与掉落池  【BD2】掉落计划  【BD3】拾取动画与发放
 * ------------------------------------------------------------ */
(function () {
  'use strict';
  /* ============================================================
   * 【BD1】规则与掉落池
   * ============================================================ */
  const RULES = Object.freeze({ fps: 15, frames: [30, 180, 340], jitter: 130, lifetime: 31 / 15 * 1000 });
  /* 蓝色碎片（26）按 GData.BLUE_SHARD_DROP_MUL 小幅降期望（2026-10 用户口径）：
   * **除了碎片竞技场的名次奖励**（那是它专属的产出表，不在拾取池里），所有掉落都吃这个系数。
   * 白/绿碎片与其它掉落不动；调系数只改 js/gamedata.js 里那一个常量。 */
  const BLUE_MUL = (typeof GData !== 'undefined' && Number(GData.BLUE_SHARD_DROP_MUL)) || 1;
  const POOL = [
    { id: 15, name: '经验', count: 5, weight: 30 },
    { id: 8, name: '金松果', count: 2, weight: 25 },
    { id: 21, name: '技能卷轴', count: 1, weight: 12 },
    { id: 22, name: '武器卷轴', count: 1, weight: 12 },
    /* 体力药剂（2026-10 用户口径）：在上一版的基础上**再砍一半** —— 小 5 → 2.5、大 1 → 0.5。
     * 权重可以是小数：`plan()` 只按权重和摇号，不要求整数（改这里就够了，别处不用同步）。 */
    { id: 1, name: '小体力药剂', count: 1, weight: 2.5 },
    { id: 2, name: '大体力药剂', count: 1, weight: 0.5 },
    { id: 45, name: '天使果实种子', count: 1, weight: 2 },
    { id: 46, name: '恶魔果实种子', count: 1, weight: 1 },
    { id: 24, name: '白色碎片', count: 1, weight: 5 },
    { id: 25, name: '绿色碎片', count: 1, weight: 3 },
    { id: 26, name: '蓝色碎片', count: 1, weight: 1 * BLUE_MUL },
  ];
  /* 天梯赛专属：飘出来的是原版「属性碎片」（黄色三角 + ?），恶魔果实种子多给一些。
   * 依据 references/new/微信图片_20260924010916_259_2.jpg：天梯战里飘的是黄色三角碎片，
   * 卡片文案是「请点确定」而不是普通战斗的「请点击」。 */
  const LADDER_POOL = [
    { id: 51, name: '属性碎片', count: 1, weight: 34 },
    { id: 46, name: '恶魔果实种子', count: 1, weight: 10 },
    { id: 15, name: '经验', count: 5, weight: 22 },
    { id: 8, name: '金松果', count: 2, weight: 18 },
    { id: 21, name: '技能卷轴', count: 1, weight: 8 },
    { id: 22, name: '武器卷轴', count: 1, weight: 8 },
    { id: 26, name: '蓝色碎片', count: 1, weight: 6 * BLUE_MUL },
  ];
  const poolFor = (kind) => (kind === 'rank' ? LADDER_POOL : POOL);
  /* ============================================================
   * 【BD2】掉落计划（按帧数摇号）
   * ============================================================ */
  function plan(random, kind) {
    random = random || Math.random;
    const pool = poolFor(kind);
    const offset = Math.round(random() * RULES.jitter), total = pool.reduce((n, p) => n + p.weight, 0);
    return RULES.frames.map((frame, index) => {
      let value = random() * total, reward = pool[pool.length - 1];
      for (const item of pool) { value -= item.weight; if (value < 0) { reward = item; break; } }
      return { ...reward, index, at: (frame + offset) / RULES.fps * 1000 };
    });
  }
  /* ============================================================
   * 【BD2b】「跳过键」的代价（2026-10 用户口径）
   *
   *  用跳过键跳过战斗播放时**整场最多收 2/3 的战斗中悬浮奖励** ——
   *  一包掉落固定 3 项（见 RULES.frames）。已经手动捡过的先算数，跳过时只从
   *  **还没捡的**里补到 2 件，再随机丢掉 1 件；所以「捡 1 再跳过」= 2 件，
   *  不会把已捡的再算一遍、也不会补成 3 件。丢哪一项由随机流决定（与掉落同一个来源，
   *  所以 QA 固定随机流时结果也固定、可复现）。
   *  ⚠ 只有**玩家按了跳过键**才吃这个代价；战斗自然打完（还有飘物没来得及捡）
   *    照旧按原版口径处理（见 create 的 skip / summary）。
   * ============================================================ */
  function trimOne(list, random) {
    const arr = (list || []).slice();
    if (arr.length < 2) return { list: arr, lost: null };
    const rnd = random || Math.random;
    const at = Math.max(0, Math.min(arr.length - 1, Math.floor(rnd() * arr.length)));
    const lost = arr.splice(at, 1)[0];
    return { list: arr, lost: lost || null };
  }
  /* ============================================================
   * 【BD3】拾取动画与发放
   * ============================================================ */
  function create(options) {
    const opts = options || {}, drops = plan(opts.random, opts.kind), collected = [], upgrades = [], awarded = new Set();
    const owner = State.state();
    let elapsed = 0, next = 0, active = null, closed = false, button = null, notice = null, noticeUntil = 0;
    const root = opts.root;
    function removeButton() { if (button) button.remove(); button = null; active = null; }
    // 拾取卡图标：有独立道具图的走 icons/prop/prop-N，其余用原版 draw 图集
    // （经验 id=15 也在 draw 图集里 —— 就是那枚经典「Exp」字，与其它掉落同源）；
    // icons/drop-exp-classic.png 只留给奖励行 / 奖励卡那些固定尺寸的槽位。
    const ICON_PROPS = [24, 25, 26, 51];
    const iconSrc = (id) => ICON_PROPS.includes(id) ? 'icons/prop/prop-' + id + '.png'
      : 'sprites/draw-' + id + '.png';
    function show(reward) {
      removeButton(); active = reward;
      if (!root) return;
      const ladder = opts.kind === 'rank';
      button = document.createElement('button'); button.type = 'button';
      button.className = 'battle-pickup' + (ladder ? ' rank' : '');
      button.setAttribute('aria-label', '拾取' + reward.name + ' ×' + reward.count);
      button.innerHTML = '<span class="pickup-card"><img alt="" src="images/ui/' + iconSrc(reward.id) + '"></span><span class="pickup-prompt">' + (ladder ? '请点确定' : '请点击') + '</span>';
      button.onclick = () => collect(reward.index);
      root.appendChild(button);
    }
    function collect(index) {
      if (closed || !active || active.index !== index || State.state() !== owner || elapsed >= active.at + RULES.lifetime) return false;
      const reward = active; removeButton(); // Retire the click before awarding anything.
      return award(reward, true);
    }
    function award(reward, showNotice) {
      if (awarded.has(reward.index) || State.state() !== owner) return false;
      awarded.add(reward.index);
      if (reward.id === 15) upgrades.push(...State.gainExp(reward.count));
      else if (reward.id === 8) State.addGold(reward.count);
      else owner.props[reward.id] = (owner.props[reward.id] || 0) + reward.count;
      if (State.bumpDaily) State.bumpDaily('pickup', 1, true);   // 每日任务：拾取 N 次战斗掉落（外层统一 save）
      State.save(); collected.push({ id: reward.id, name: reward.name, count: reward.count });
      if (root && showNotice) {
        if (notice) notice.remove(); notice = document.createElement('div');
        notice.className = 'battle-pickup-notice'; notice.setAttribute('role', 'status');
        notice.textContent = '获得' + reward.name + ' ×' + reward.count; root.appendChild(notice); noticeUntil = elapsed + 1700;
      }
      return true;
    }
    // Original skip() submits all three planned rewards, including missed cards.
    /* 2026-10 用户口径：`penalize`（玩家按了跳过键）时整场只收 2/3，且只从还没捡的里补。
     * 不传 / 传 false（程序化收尾、录像回放）时保持原版口径：三份全发。
     * `trimOne` 仍是塔的「每场跳过随机抹一包」的公共件，不要删。 */
    let lostReward = null;
    /* 跳过结算（2026-10 用户口径）：
     *  - 这一场的 3 件漂浮奖励在 `create()` 时已经固定好，跳过后**不重新摇**；
     *  - 玩家已经手动捡过的先记账；跳过时只从**还没捡的**里补，整场最多收 2 件；
     *    → 捡了 1 件再跳过只补 1 件（不会把已捡的再算一次，也不会变成 3 件）；
     *    → 直接跳过（0 件）补 2 件、随机丢 1 件；
     *    → 捡了 2 件再跳过不再补，只把剩下那件丢掉；
     *  - 不传 `penalize`（程序化收尾 / 录像）仍是原版口径：剩下几件全发。 */
    function skip(penalize) {
      if (closed) return;
      const remaining = drops.filter((drop) => !awarded.has(drop.index));
      if (!penalize) {
        for (const drop of remaining) award(drop, false);
        close();
        return;
      }
      /* 已收件数 + 本次补发件数不超过 2（3 件里的 2/3）。
       * 只从「还没捡的」里随机挑**一项丢掉**，其余按原顺序补发 —— 这样不会打乱
       * 战果页的拾取顺序，也只消耗一个随机数（与旧测试的固定随机流兼容）。 */
      const target = Math.max(0, Math.min(remaining.length, 2 - collected.length));
      const dropIndex = remaining.length > target
        ? Math.floor((opts.random ? opts.random() : Math.random()) * remaining.length)
        : -1;
      lostReward = dropIndex >= 0 ? remaining[Math.min(dropIndex, remaining.length - 1)] : null;
      for (const drop of remaining) if (drop !== lostReward) award(drop, false);
      close();
    }
    function tick(dt) {
      if (closed) return;
      elapsed += Math.max(0, Math.min(100, Number(dt) || 0));
      if (active && elapsed >= active.at + RULES.lifetime) removeButton();
      if (notice && elapsed >= noticeUntil) { notice.remove(); notice = null; }
      if (next < drops.length && elapsed >= drops[next].at) { const drop = drops[next++]; if (elapsed < drop.at + RULES.lifetime) show(drop); }
    }
    function close() { closed = true; removeButton(); if (notice) notice.remove(); notice = null; }
    /** 结算用：收下的东西 + （按跳过键时）随机抹掉的那一项，界面据此提示玩家少收了什么。 */
    function summary() {
      return { items: collected.map(item => ({ ...item })), ups: upgrades.slice(),
        lost: lostReward ? { id: lostReward.id, name: lostReward.name, count: lostReward.count } : null };
    }
    return { tick, collect, close, skip, summary };
  }
  /** 一次性发一批掉落（塔的每层结算用）：同一个池、同一套入账规则，但不算「拾取」。
   *  返回 { items, ups }，形状与 create().summary() 一致，可以直接交给 UI.pickupResult。 */
  function grant(list) {
    const owner = State.state(), items = [], ups = [];
    let picks = 0;
    for (const reward of list || []) {
      if (!reward || !reward.count) continue;
      picks++;
      if (reward.id === 15) ups.push(...State.gainExp(reward.count));
      else if (reward.id === 8) State.addGold(reward.count);
      else owner.props[reward.id] = (owner.props[reward.id] || 0) + reward.count;
      const hit = items.find((x) => x.id === reward.id);
      if (hit) hit.count += reward.count;
      else items.push({ id: reward.id, name: reward.name, count: reward.count });
    }
    State.save();
    return { items, ups, picks };
  }
  window.BattleDrops = { create, plan, trimOne, grant, rules: RULES, pool: POOL, ladderPool: LADDER_POOL, poolFor };
})();
