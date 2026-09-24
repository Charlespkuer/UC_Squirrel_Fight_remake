/* Additional classic UC screens. All progression stays in the current State save. */
(function () {
  'use strict';
  const C = () => UI.classic;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const find = (root, selector) => root.querySelector(selector);
  const image = (src, alt, cls) => '<img class="' + (cls || '') + '" src="' + src + '" alt="' + esc(alt) + '">';
  const sprite = (id) => image('images/classic/sprites/resource_6-' + id + '.png', '', 'extra-arena-picture');
  const button = (label, action, cls) => C().btn(label, action, cls || 'small');
  const note = (text) => '<p class="extra-note">' + esc(text) + '</p>';
  function on(root, action, handler) {
    const element = find(root, '[data-action="' + action + '"]');
    if (element) element.onclick = handler;
    return element;
  }
  function back(root, handler, label) {
    const element = on(root, 'home', handler);
    if (element) element.textContent = label || '\u8fd4\u56de';
  }
  function alert(text) { C().modal('\u63d0\u793a', '<p>' + esc(text) + '</p>', [{ label: '\u77e5\u9053\u4e86' }], { small: true }); }
  function addProp(id, count) { const s = State.state(); s.props[id] = (s.props[id] || 0) + count; }
  function outcome(win, reward, text, again, label) {
    C().modal('\u6218\u6597\u7ed3\u679c', '<div class="extra-result"><strong class="cartoon">' + (win ? '\u80dc\u5229\uff01' : '\u518d\u63a5\u518d\u5389') + '</strong><p>' + esc(text) + '</p><div>\u7ecf\u9a8c +' + reward.exp + '\u3000\u91d1\u677e\u679c +' + (reward.gold || 0) + '</div>' + C().upsHtml(reward.ups) + '</div>', [{ label: label || '\u8fd4\u56de', run: again }, { label: '\u67e5\u770b\u5f55\u50cf', cls: 'gold', run: () => UI.runAction('messages') }]);
  }

  let arenaRun = null;
  function saveArenaRun(run) {
    const s = State.state();
    s.classicArenaRun = run ? { kind: run.kind, phase: run.phase, foe: run.foe, finalist: run.finalist, consolation: run.consolation } : null;
    State.save();
  }
  function activeArenaRun() {
    const s = State.state();
    if (arenaRun && arenaRun.owner !== s) arenaRun = null;
    if (!arenaRun && s.classicArenaRun) {
      const saved = s.classicArenaRun;
      if ([0, 1].includes(saved.kind) && ['semi', 'final', 'third'].includes(saved.phase) && saved.foe && saved.finalist && saved.consolation) {
        arenaRun = Object.assign({}, saved, { owner: s, busy: false, settled: false });
      } else { s.classicArenaRun = null; State.save(); }
    }
    return arenaRun;
  }
  function arena() {
    State.tickEnergy();
    const s = State.state(), run = activeArenaRun();
    const cards = [
      { art: 28, name: '经验竞技场', text: '11级开启，冠军150／亚军75／季军25经验', action: 'arena-exp' },
      { art: 29, name: '碎片竞技场', text: '20级开启，四名依次获得8／6／4／3蓝色碎片', action: 'arena-fragment' },
      { art: 30, name: '天梯赛', text: '30级开启，赢积分、争金杯', action: 'arena-rank' },
    ];
    const resume = run ? '<div class="extra-resume">你已报名，无需再次消耗体力。' + button(run.phase === 'final' ? '继续决赛' : run.phase === 'third' ? '继续季军赛' : '继续比赛', 'arena-resume', 'tiny gold') + '</div>' : '';
    const p = C().page('challenge', 'arena', '<div class="extra-arena-cards">' + cards.map(card => '<article>' + sprite(card.art) + '<h2>' + card.name + '</h2><p>' + card.text + '</p>' + button(card.action === 'arena-rank' ? '进入天梯' : '参加比赛', card.action, 'small gold') + '</article>').join('') + '</div><div class="extra-arena-cost">4人两轮比赛：半决赛胜者争冠军，败者争季军。<br>报名消耗30体力，体力不足可使用英雄帖或勇气徽章。<br>体力 ' + s.energy + '/' + s.maxEnergy + '　英雄帖 ' + (s.props[36] || 0) + '　勇气徽章 ' + (s.props[39] || 0) + '</div>' + resume, { cls: 'extra-board arena-extra-board' });
    on(p, 'arena-exp', () => confirmArena(0));
    on(p, 'arena-fragment', () => confirmArena(1));
    on(p, 'arena-rank', rank);
    on(p, 'arena-resume', () => fightArena(activeArenaRun()));
  }
  function arenaAccess(kind) {
    const level = kind ? 20 : 11;
    if (State.state().level >= level) return true;
    alert((kind ? '碎片竞技场' : '经验竞技场') + '需要达到' + level + '级。'); return false;
  }
  function confirmArena(kind) {
    const existing = activeArenaRun();
    if (existing) { fightArena(existing); return; }
    if (!arenaAccess(kind)) return;
    const owner = State.state();
    C().modal('竞技场报名', '<p>' + (kind ? '碎片竞技场' : '经验竞技场') + '：半决赛胜者进入决赛，败者进行季军赛。</p><p>报名一次消耗30体力，第二战不再扣除。体力不足时使用1张英雄帖或勇气徽章。</p>' + note('离线对手由本地生成。竞技场不使用挑战药剂效果。'), [{ label: '报名参赛', run: () => {
      if (State.state() !== owner || activeArenaRun() || !arenaAccess(kind)) return;
      const s = owner; State.tickEnergy();
      if (s.energy >= 30) { if (!State.consumeEnergy(30)) return; }
      else {
        const preferred = kind ? 39 : 36, alternate = kind ? 36 : 39;
        const ticket = s.props[preferred] > 0 ? preferred : s.props[alternate] > 0 ? alternate : 0;
        if (!ticket) { alert('体力不足30点，也没有英雄帖或勇气徽章。'); return; }
        s.props[ticket]--; State.save();
      }
      const foes = [State.genAI(s.level), State.genAI(s.level), State.genAI(s.level)];
      const other = Sim.simulate(foes[1], foes[2]);
      arenaRun = { owner: s, kind, phase: 'semi', foe: foes[0], finalist: foes[other.winner === 0 ? 1 : 2], consolation: foes[other.winner === 0 ? 2 : 1], busy: false, settled: false };
      saveArenaRun(arenaRun); fightArena(arenaRun);
    } }, { label: '返回', cls: 'muted' }], { small: true });
  }
  function fightArena(run) {
    if (!run || run.busy || run.settled || run.owner !== State.state()) return;
    run.busy = true;
    const phase = run.phase, foe = phase === 'final' ? run.finalist : phase === 'third' ? run.consolation : run.foe;
    let finished = false;
    const interrupted = () => {
      if (finished || run.settled || run.owner !== State.state()) return;
      finished = true; run.busy = false;
      C().toast('比赛暂时中断，本轮已保存，可回竞技场继续。');
    };
    Main.startBattle(foe, { cost: 0, kind: 'arena', useProps: false, region: 0, onError: interrupted, onEnd: winner => {
      if (finished || run.settled || run.owner !== State.state()) return;
      finished = true; run.busy = false;
      if (phase === 'semi') {
        const won = winner === 0;
        run.phase = won ? 'final' : 'third'; saveArenaRun(run);
        const gem = won ? State.rollGemDrop(15) : null;   // 45级起竞技场获胜有几率得宝石
        if (gem) State.save();
        const opponent = won ? run.finalist : run.consolation, title = won ? '晋级决赛' : '争夺季军';
        arena();   // 半决赛后回到竞技场页做背景（玩家刚从这里报名）
        C().modal(title, '<div class="extra-finalist">' + image('images/classic/squirrel-classic.png', '下一场对手') + '<div><h3>' + (won ? '半决赛获胜！' : '还有季军赛，继续加油！') + '</h3><p>下一场对手：' + esc(opponent.name) + '<br>等级 ' + opponent.level + '</p></div></div>' + (gem ? note('获得 ' + gem.name + ' ×1！') : '') + note('第二战无需再消耗体力，关闭页面后仍可继续本轮。'), [{ label: won ? '开始决赛' : '开始季军赛', run: () => fightArena(run) }, { label: '稍后继续', cls: 'muted', run: arena }]);
        return;
      }
      run.settled = true; arenaRun = null;
      const position = phase === 'final' ? (winner === 0 ? 0 : 1) : (winner === 0 ? 2 : 3);
      // 经验场吃经验丸加成（经验丸 +40% / 超级经验丸 +60%）；碎片场给碎片不给经验
      const baseExp = run.kind ? 0 : [150, 75, 25, 0][position];
      // 加成百分比要在 tickPropStates 消耗本场用量之前读，否则结算文案会显示成 0%
      const boostPct = baseExp ? State.expBoostPct() : 0;
      const boosted = baseExp ? State.gainExpWithBoost(baseExp) : { exp: 0, ups: [] };
      const exp = boosted.exp;
      const shards = run.kind ? [8, 6, 4, 3][position] : 0;
      if (shards) addProp(26, shards);
      const gem = winner === 0 ? State.rollGemDrop(15) : null;   // 45级起竞技场获胜有几率得宝石
      const ups = boosted.ups;
      if (baseExp) State.tickPropStates();   // 经验丸按场次消耗
      const boostNote = boostPct ? '（含经验丸 +' + boostPct + '%）' : '';
      saveArenaRun(null);
      arena();   // 战果弹窗放回竞技场上，别飘在主界面上
      outcome(winner === 0, { exp, gold: 0, ups }, '获得' + ['冠军', '亚军', '季军', '第四名'][position] + '！' + (shards ? '蓝色碎片 ×' + shards + ' 已放入背包。' : '奖励' + exp + '经验' + boostNote + '。') + (gem ? '获得 ' + gem.name + ' ×1！' : ''), arena, '返回竞技场');
    } }).catch(interrupted);
  }

  let rankAttempt = null;
  const rankSunday = () => new Date(Date.now()).getDay() === 0;
  function rankWeek() {
    const date = new Date(Date.now());
    date.setDate(date.getDate() - (date.getDay() + 6) % 7);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function refreshRankWeek() {
    const s = State.state(), week = rankWeek();
    if (s.rankPurchaseWeek === week && s.rankPurchases && typeof s.rankPurchases === 'object' && !Array.isArray(s.rankPurchases)) return;
    // A legacy undated purchase remains used in this week, then resets next week.
    if (s.rankPurchaseWeek && s.rankPurchaseWeek !== week || !s.rankPurchases || typeof s.rankPurchases !== 'object' || Array.isArray(s.rankPurchases)) s.rankPurchases = {};
    s.rankPurchaseWeek = week; State.save();
  }
  function rank() {
    const s = State.state(); State.tickEnergy();
    if (rankAttempt && rankAttempt.owner !== s) rankAttempt = null;
    if (s.level < 30) {
      C().modal('天梯赛', '<div class="extra-finalist">' + sprite(30) + '<div><h3>30级开启天梯赛</h3><p>当前等级：' + s.level + '<br>先去挑战积累经验吧！</p></div></div>', [{ label: '去挑战', run: () => UI.runAction('challenge') }, { label: '返回竞技场', cls: 'muted', run: arena }]); return;
    }
    if (s.integral == null) { s.integral = 1500; State.save(); }
    refreshRankWeek();
    const entries = [0, 1, 2, 3, 4, 5].map((n) => ({ name: GData.AI_NAMES[n * 4], points: 1350 + n * 83 }));
    entries.push({ name: s.name, points: s.integral, mine: true }); entries.sort((a, b) => b.points - a.points);
    const p = C().page('challenge', 'arena', '<div class="extra-rank-layout"><div class="extra-rank-self">' + sprite(30) + '<h2>天梯赛</h2><div class="extra-score">积分 <b>' + s.integral + '</b></div><div class="extra-score">金杯 <b>' + s.goldCup + '</b></div><p>今日已参赛 ' + s.joinRankCount + ' / 20 场<br>' + (rankSunday() ? '周日休赛，金杯商店开放' : s.joinRankCount >= 20 ? '今日参赛次数已用完' : s.joinRankCount < 10 ? '本次免费，前10场免费' : '本次消耗5金松果') + '</p>' + button('开始匹配', 'rank-fight', 'small gold') + button('金杯商店', 'rank-shop', 'small') + '</div><div class="extra-rank-list"><h3>本地模拟排行榜</h3>' + entries.map((entry, i) => '<div class="extra-rank-row ' + (entry.mine ? 'mine' : '') + '"><span>' + (i + 1) + '</span><b>' + esc(entry.name) + (entry.mine ? '（你）' : '') + '</b><strong>' + entry.points + '</strong></div>').join('') + note('周一至周六比赛，周日兑换。每日最多20场，前10场免费，其后每场5金松果。胜利得3杯，落败得1杯。积分与夺杯为离线模拟；获胜有25%机会额外夺得3杯。') + '</div></div>', { cls: 'extra-board rank-extra-board' });
    back(p, arena, '返回竞技场');
    on(p, 'rank-shop', () => rankShop(0));
    const match = on(p, 'rank-fight', () => {
      if (!p.isConnected || State.state() !== s || rankAttempt) return;
      State.tickEnergy();
      if (s.level < 30) { alert('天梯赛需要达到30级。'); return; }
      if (rankSunday()) { alert('周日天梯休赛，请到金杯商店兑换奖励。'); return; }
      if (s.joinRankCount >= 20) { alert('今天已经参加20场，明天再来吧！'); return; }
      const fee = s.joinRankCount < 10 ? 0 : 5;
      if (s.goldPoint < fee) { alert('第11至20场每场需要5金松果，当前金松果不足。'); return; }
      const attempt = { owner: s, date: State.localDate(), fee, settled: false };
      rankAttempt = attempt; s.joinRankCount++; s.goldPoint -= fee; State.save();
      const foe = State.genAI(Math.max(1, s.level + Math.floor(Math.random() * 6) - 3));
      const interrupted = () => {
        if (attempt.settled || rankAttempt !== attempt || State.state() !== s) return;
        attempt.settled = true; rankAttempt = null;
        State.tickEnergy();
        if (State.localDate() === attempt.date) s.joinRankCount = Math.max(0, s.joinRankCount - 1);
        s.goldPoint += attempt.fee; State.save();
        C().toast('比赛中断，本次参赛次数和费用已退还。');
      };
      Main.startBattle(foe, { cost: 0, kind: 'rank', useProps: false, region: 2, onError: interrupted, onEnd: winner => {
        if (attempt.settled || rankAttempt !== attempt || State.state() !== s) return;
        attempt.settled = true; rankAttempt = null;
        const win = winner === 0, delta = win ? 20 + Math.floor(Math.random() * 15) : -(10 + Math.floor(Math.random() * 10));
        const robbed = win && Math.random() < 0.25 ? 3 : 0, cups = (win ? 3 : 1) + robbed;
        s.integral = Math.max(0, s.integral + delta); s.goldCup += cups; State.save();
        rank();   // 战果弹窗放回天梯赛页上
        outcome(win, { exp: 0, gold: 0, ups: [] }, '积分 ' + (delta > 0 ? '+' : '') + delta + '，金杯 +' + cups + (robbed ? '（含夺得3杯）' : '') + '。当前积分 ' + s.integral + '。', rank, '返回天梯赛');
      } }).catch(interrupted);
    });
    match.disabled = rankSunday() || s.joinRankCount >= 20 || !!rankAttempt;
  }
  function rankShop(pg) {
    const s = State.state();
    if (s.level < 30) { alert('天梯商店需要达到30级。'); return; }
    if (!rankSunday()) { alert('金杯商店每周日开放，周一至周六可参加天梯赛。'); return; }
    refreshRankWeek();
    const goods = []; rankgoodsMap.each((id, item) => goods.push(item));
    const total = Math.ceil(goods.length / 6); pg = Math.max(0, Math.min(pg || 0, total - 1));
    const selected = goods.slice(pg * 6, pg * 6 + 6);
    const p = C().page('bag', 'shop', '<div class="extra-shop-balance">金杯 ' + s.goldCup + '　金松果 ' + s.goldPoint + '　积分 ' + s.integral + '</div><div class="extra-shop-grid">' + selected.map(item => '<button class="extra-shop-item" data-goods="' + item.id + '">' + (item.type === '2' ? image('images/classic/icons/gear-' + item.goodsId + '.png', item.name) : C().icon('prop', +item.goodsId)) + '<b>' + esc(item.name) + '</b><span>' + item.cup + '金杯 + ' + item.gold + '金松果</span><small>积分需 ' + item.integral + (Number(item.timesLimit) > 0 ? ' · 每周限兑' + item.timesLimit + '次' + (s.rankPurchases[item.id] ? '（本周已兑）' : '') : '') + '</small></button>').join('') + '</div><div class="extra-pagination">' + button('上一页', 'rank-shop-prev', 'tiny muted') + '<span>' + (pg + 1) + '/' + total + '</span>' + button('下一页', 'rank-shop-next', 'tiny muted') + '</div>', { cls: 'extra-board extra-cup-shop' });
    back(p, rank, '返回天梯赛');
    on(p, 'rank-shop-prev', () => rankShop(Math.max(0, pg - 1)));
    on(p, 'rank-shop-next', () => rankShop(Math.min(total - 1, pg + 1)));
    p.querySelectorAll('[data-goods]').forEach(element => element.onclick = () => {
      const item = rankgoodsMap.getValue(element.dataset.goods);
      let redeemed = false;
      C().modal('金杯兑换', '<p>兑换【' + esc(item.name) + '】</p><p>' + esc(item.remark) + '</p><p>需要：' + item.cup + '金杯、' + item.gold + '金松果，积分达到' + item.integral + '。</p>', [{ label: '确认兑换', run: () => {
        if (redeemed || State.state() !== s) return;
        if (!rankSunday()) { alert('金杯商店已休息，请下周日再来。'); return; }
        refreshRankWeek();
        if (s.integral < +item.integral) { alert('天梯积分尚未达到兑换要求。'); return; }
        if (s.goldCup < +item.cup || s.goldPoint < +item.gold) { alert('金杯或金松果不足。'); return; }
        const bought = s.rankPurchases;
        if (+item.timesLimit > 0 && (bought[item.id] || 0) >= +item.timesLimit) { alert('该奖励本周的兑换次数已用完，下周日可再次兑换。'); return; }
        redeemed = true;
        s.goldCup -= +item.cup; s.goldPoint -= +item.gold;
        if (item.type === '2') State.addGear(+item.goodsId, State.randomExt(2)); else addProp(+item.goodsId, +item.count);
        bought[item.id] = (bought[item.id] || 0) + 1; State.save(); C().toast('兑换成功：' + item.name); rankShop(pg);
      } }, { label: '返回', cls: 'muted' }], { small: true });
    });
  }


  const prizes = [
    { id: 22, count: 10, label: '\u6b66\u5668\u5377\u8f74 \u00d710' }, { id: 21, count: 10, label: '\u6280\u80fd\u5377\u8f74 \u00d710' },
    { id: 26, count: 3, label: '\u84dd\u8272\u788e\u7247 \u00d73' }, { id: 15, exp: 50, label: '\u7ecf\u9a8c +50' },
    { id: 15, exp: 100, label: '\u7ecf\u9a8c +100' }, { id: 8, gold: 30, label: '\u91d1\u677e\u679c +30' },
    { id: 23, count: 2, label: '\u6311\u6218\u4e66 \u00d72' }, { id: 2, count: 2, label: '\u5927\u4f53\u529b\u836f\u5242 \u00d72' },
    { id: 45, count: 2, label: '\u5929\u4f7f\u679c\u5b9e\u79cd\u5b50 \u00d72' }, { id: 36, count: 2, label: '\u82f1\u96c4\u5e16 \u00d72' },
  ];
  let spinning = false, lotteryVersion = 0;
  function refreshLotteryDay() {
    const s = State.state(), today = State.localDate(), legacyToday = new Date(Date.now()).toDateString();
    if (s.lotteryDate === today) return;
    if (s.lotteryDate !== legacyToday) s.lotteryFree = 1;
    s.lotteryDate = today; State.save();
  }
  function lottery() {
    // Rewards are already settled before the animation. Reopening the page may
    // dismiss that animation; its pending timer must not lock the new controls.
    const version = ++lotteryVersion;
    spinning = false;
    refreshLotteryDay();
    const s = State.state();
    const p = C().page('bag', 'bag', '<h2 class="extra-lottery-heading cartoon">\u6bcf\u65e5\u5e78\u8fd0\u62bd\u5956</h2><div class="extra-lottery-prizes">' + prizes.map((prize, i) => '<div class="extra-prize" data-prize="' + i + '">' + C().icon('prop', prize.id) + '<span>' + prize.label + '</span></div>').join('') + '</div><div class="extra-lottery-footer"><div><b data-lottery-status>\u4eca\u65e5\u514d\u8d39 ' + s.lotteryFree + ' \u6b21</b><span>\u6bcf\u5929\u514d\u8d391\u6b21\uff0c\u4e4b\u540e\u6bcf\u6b2120\u91d1\u677e\u679c<br>\u5f53\u524d\u91d1\u677e\u679c\uff1a<strong data-lottery-gold>' + s.goldPoint + '</strong></span></div>' + button(spinning ? '\u62bd\u5956\u4e2d\u2026' : s.lotteryFree > 0 ? '\u514d\u8d39\u62bd\u5956' : '\u518d\u62bd\u4e00\u6b21', 'lottery-spin', 'gold') + '</div>', { cls: 'extra-board lottery-extra-board' });
    back(p, () => UI.runAction('bag'), '\u8fd4\u56de\u9053\u5177');
    const spin = on(p, 'lottery-spin', () => {
      if (version !== lotteryVersion || !p.isConnected || spinning) return;
      refreshLotteryDay();
      if (s.lotteryFree < 1 && s.goldPoint < 20) { alert('\u91d1\u677e\u679c\u4e0d\u8db320\uff0c\u660e\u5929\u8fd8\u6709\u4e00\u6b21\u514d\u8d39\u673a\u4f1a\u3002'); return; }
      spinning = true; spin.disabled = true; spin.textContent = '\u62bd\u5956\u4e2d\u2026';
      if (s.lotteryFree > 0) s.lotteryFree--; else s.goldPoint -= 20;
      // \u4e00\u6b21\u70b9\u51fb\u7acb\u5373\u3001\u539f\u5b50\u5730\u7ed3\u7b97\u3002\u79bb\u5f00\u52a8\u753b\u9875\u6216\u5237\u65b0\u9875\u9762\u4e0d\u4f1a\u6f0f\u5956\u6216\u591a\u53d1\u5956\u52b1\u3002
      const selected = Math.floor(Math.random() * prizes.length), prize = prizes[selected];
      if (prize.gold) s.goldPoint += prize.gold;
      if (prize.count) addProp(prize.id, prize.count);
      const ups = prize.exp ? State.gainExp(prize.exp) : [];
      State.save();
      let step = 0;
      const steps = 20 + selected;
      function animate() {
        if (version !== lotteryVersion) return;
        if (!p.isConnected) { spinning = false; return; }
        p.querySelectorAll('[data-prize]').forEach(cell => cell.classList.toggle('lit', +cell.dataset.prize === step % 10));
        if (step++ < steps) { setTimeout(animate, step > 17 ? 125 : 65); return; }
        spinning = false; spin.disabled = false; spin.textContent = '\u518d\u62bd\u4e00\u6b21';
        find(p, '[data-lottery-status]').textContent = '\u4eca\u65e5\u514d\u8d39 ' + s.lotteryFree + ' \u6b21';
        find(p, '[data-lottery-gold]').textContent = s.goldPoint;
        C().modal('\u83b7\u5f97\u5956\u52b1', '<div class="extra-lottery-win">' + C().icon('prop', prize.id) + '<strong>' + prize.label + '</strong></div>' + C().upsHtml(ups), [{ label: '\u786e\u5b9a' }], { small: true });
      }
      animate();
    });
    spin.disabled = spinning;
  }
  // ==================== \u5e08\u5f92\u7cfb\u7edf ====================
  // \u53c2\u8003\u8bbe\u5b9a\uff1a\u62dc\u5e08\u540e\u81ea\u52a8\u5b66\u4f1a\u300c\u5e08\u7236\u9a7e\u5230\u300d\uff1b\u6536\u5f92\u9700\u5148\u6253\u8d25\u5bf9\u65b9\uff08\u5bf9\u65b9\u5df2\u6709\u5e08\u7236\u5219\u6253\u4ed6\u5e08\u7236\uff09\uff1b
  // 收徒上限随等级1/2/3人；昨日日贡由持久化的有限离线战斗账目按10%/5%结算。
  // \u5e08\u7236\u6bcf\u5929\u53ef\u8e22 1 \u4e2a\u5f92\u5f1f\uff1b\u5f92\u5f1f\u4e3b\u52a8\u9000\u5e08\u95e8\u82b1 20 \u91d1\u677e\u679c\u3002
  const MASTER_CANDIDATE_COUNT = 3;
  const RECRUIT_CANDIDATE_COUNT = 3;

  /** \u5e08\u7236\u5019\u9009\u4eba\uff1a\u7b49\u7ea7\u5728\u73a9\u5bb6\u7b49\u7ea7\u4e0a\u65b9\u6709\u8f83\u5927\u968f\u673a\u8303\u56f4\uff0c\u5e76\u5e26\u5b8c\u6574\u5c5e\u6027/\u6b66\u5668/\u6280\u80fd\u3002 */
  function rollMasterCandidates() {
    const s = State.state();
    const base = Math.max(3, s.level);
    return Array.from({ length: MASTER_CANDIDATE_COUNT }, () => {
      // \u5e08\u7236\u901a\u5e38\u6bd4\u5f92\u5f1f\u5f3a\uff1a+2 ~ +12 \u7ea7
      const level = Math.max(2, base + 2 + Math.floor(Math.random() * 11));
      return State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
    });
  }
  /** \u53ef\u6536\u670d\u5f92\u5f1f\u5019\u9009\u4eba\uff1a\u7b49\u7ea7\u63a5\u8fd1\u73a9\u5bb6\uff0c\u5e26\u5b8c\u6574\u5c5e\u6027\u4fbf\u4e8e\u67e5\u770b\u540e\u518d\u51b3\u5b9a\u3002 */
  function rollRecruitCandidates() {
    const s = State.state();
    return Array.from({ length: RECRUIT_CANDIDATE_COUNT }, () => {
      const base = Math.max(1, s.level + (Math.random() < 0.5 ? -2 : 0));
      const foe = State.genAI(base, '', { levelJitter: 2, gearSelfLevel: true });
      // \u5f92\u5f1f\u4e0d\u4f1a\u6bd4\u5e08\u7236\u5f3a\u592a\u591a
      foe.level = Math.min(foe.level, Math.max(1, s.level + 1));
      return foe;
    });
  }
  /** \u5c5e\u6027\u8ff7\u4f60\u6761 + \u6b66\u5668/\u6280\u80fd\u6e05\u5355\uff0c\u5e08\u7236\u4e0e\u5f92\u5f1f\u8be6\u60c5\u5171\u7528\u3002 */
  function profileStats(row) {
    const pills = [['\u529b', row.power], ['\u654f', row.agility], ['\u901f', row.speed], ['\u547d', row.hp]]
      .map(([k, v]) => '<div class="stat-pill"><b>' + k + '</b>' + esc(v == null ? '-' : v) + '</div>').join('');
    return '<div class="mini-stats">' + pills + '</div>';
  }
  function profileGear(row) {
    const w = (row.weapons || []).map((x) => {
      const inst = State.weaponInst(x);
      return inst ? esc(inst.name) + ' Lv' + inst.level : null;
    }).filter(Boolean);
    const sk = (row.skills || []).map((x) => {
      const inst = State.skillInst(x);
      return inst ? esc(inst.name) + ' Lv' + inst.level : null;
    }).filter(Boolean);
    return '<div class="profile-gear"><span class="profile-gear-label">\u6b66\u5668</span><div>' + (w.length ? w.join('\u3001') : '<em>\u7a7a\u624b</em>') + '</div>' +
      '<span class="profile-gear-label">\u6280\u80fd</span><div>' + (sk.length ? sk.join('\u3001') : '<em>\u65e0</em>') + '</div></div>';
  }
  function masterProfile(row) {
    if (!row) return '\u9009\u62e9\u4e00\u4f4d\u67e5\u770b\u5c5e\u6027';
    return '<div class="profile-panel">' + profileStats(row) + profileGear(row) + '</div>';
  }
  function apprenticeProfile(row) {
    const daily = State.apprenticeDailyStatus(row);
    const names = {challenge:'主动挑战',challenged:'被挑战',stage:'关卡',arena:'经验竞技',pickup:'战斗拾取',lottery:'抽奖'};
    const ledger = daily.activities.map(a => {
      const rate = ['challenge','challenged','stage'].includes(a.kind) ? '10%' : a.kind==='arena'&&a.entry==='energy' ? '5%' : '不计日贡';
      return '<span>'+names[a.kind]+(a.kind==='arena'?(a.entry==='energy'?'（体力）':'（英雄帖）'):'')+' '+a.exp+'经验 · '+rate+'</span>';
    }).join('<br>');
    return '<div class="profile-panel">' +
      '<p class="profile-meta">入门：'+esc(row.since)+' · 昨日日贡：'+(daily.claimed?'<b class="done">已领取</b>':'<b>'+daily.exp+'经验</b>')+'</p>'+
      '<details class="profile-meta"><summary>'+esc(daily.date)+' 离线活动账目</summary>'+(ledger||'昨天尚无入门后的战斗活动。')+'<br>按两类比例合计后取整；徒弟经验不减少。</details>'+
      profileStats(row) + profileGear(row) + '</div>';
  }

  let masterCandidates = [], recruitCandidates = [];
  let masterSel = 0, recruitSel = 0, apprenticeSel = 0, recruitBusy = false, recruitOwner = null;
  let masterTab = 'master';
  function master(tab) {
    if(recruitOwner !== State.state()){recruitBusy=false;recruitOwner=State.state();masterCandidates=[];recruitCandidates=[];}
    if (tab === 'master' || tab === 'apprentice') masterTab = tab;
    const s = State.state();
    if (!masterCandidates.length) masterCandidates = rollMasterCandidates();
    if (!recruitCandidates.length) recruitCandidates = rollRecruitCandidates();
    const cap = State.apprenticeCap(s.level);
    const hasMasterSkill = s.skills.some((x) => Number(String(x).split(':')[0]) === State.MASTER_SKILL_ID);

    // ---- \u6211\u7684\u5e08\u7236 / \u62dc\u5e08 ----
    const masterBlock = s.master
      ? '<h2>\u6211\u7684\u5e08\u7236</h2><div class="extra-master-current"><div class="master-head"><b>' + esc(s.master.name) + '</b>' +
        '<span>\u7b49\u7ea7 ' + esc(s.master.level) + '</span></div>' +
        masterProfile(s.master) +
        '<div class="master-actions">' + button('\u51fa\u5e08\uff0820\u91d1\u677e\u679c\uff09', 'master-leave', 'tiny muted') + '</div></div>' +
        '<p class="extra-master-tip">\u5df2\u5b66\u4f1a\u300c\u5e08\u7236\u9a7e\u5230\u300d\uff1a\u53d1\u52a8\u65f6\u6062\u590d\u5e08\u7236\u7b49\u7ea7 \u00d74 \u7684\u751f\u547d\uff0c\u4e14\u4e0b\u4e00\u6b21\u653b\u51fb\u5fc5\u4e2d\u3002' +
        (hasMasterSkill ? '' : ' <b>\uff08\u6280\u80fd\u7f3a\u5931\uff0c\u91cd\u65b0\u62dc\u5e08\u53ef\u8865\u56de\uff09</b>') + '</p>'
      : '<h2>\u62dc\u5e08\u5b66\u827a</h2>' +
        '<p class="extra-master-tip">\u62dc\u5e08\u6210\u529f\u540e\u81ea\u52a8\u5b66\u4f1a\u300c\u5e08\u7236\u9a7e\u5230\u300d\u3002\u70b9\u5217\u8868\u91cc\u7684\u5e08\u7236\u53ef\u67e5\u770b\u4ed6\u7684\u5c5e\u6027\u4e0e\u6b66\u5668\u6280\u80fd\u3002</p>' +
        '<div class="candidate-row">' + masterCandidates.map((c, i) =>
          '<div class="candidate-card' + (masterSel === i ? ' active' : '') + '" data-master="' + i + '">' +
          '<b class="candidate-name">' + esc(c.name) + '</b>' +
          '<span class="candidate-level">\u7b49\u7ea7 ' + c.level + '</span>' +
          '<span class="candidate-hp">\u751f\u547d ' + c.hp + '</span>' +
          '<span class="candidate-hp">\u88c5\u5907 ' + (c.gears || []).length + '</span></div>').join('') + '</div>' +
        '<div class="candidate-detail">' + masterProfile(masterCandidates[masterSel]) + '</div>' +
        '<div class="master-actions">' + button('\u5237\u65b0\u5e08\u7236', 'master-refresh') +
        (masterCandidates[masterSel] ? button('\u62dc\u4ed6\u4e3a\u5e08', 'master-join', 'gold') : '') + '</div>';

    // ---- \u6211\u7684\u5f92\u5f1f / \u6536\u5f92 ----
    const dailyTotal = State.apprenticeDailyTotal();
    const unclaimed = dailyTotal > 0;
    const apprenticeBlock =
      '<div class="extra-apprentice-title"><h3>\u6211\u7684\u5f92\u5f1f\uff08' + s.prentices.length + '/' + cap + '\uff09</h3>' +
      (unclaimed ? button('领取昨日日贡 +' + dailyTotal, 'master-claim', 'tiny gold') : '<span class="daily-done">暂无可领昨日日贡</span>') + '</div>' +
      '<p class="extra-master-tip">昨日普通与关卡经验的10%，体力报名经验竞技的5%，次日可领；拾取、抽奖、英雄帖竞技不计。活动由本地有限模拟，详情可展开查看。</p>' +
      '<div class="apprentice-row">' + (s.prentices.length
        ? s.prentices.map((a, i) => '<div class="candidate-card small' + (apprenticeSel === i ? ' active' : '') + '" data-prentice="' + i + '">' +
            '<b class="candidate-name">' + esc(a.name) + '</b><span class="candidate-level">\u7b49\u7ea7 ' + a.level + '</span>' +
            '<span class="candidate-hp">昨日日贡 ' + State.apprenticeDailyExp(a) + '</span></div>').join('')
        : '<p class="empty-hint">\u8fd8\u6ca1\u6709\u5f92\u5f1f\uff0c\u5148\u5728\u4e0b\u65b9\u5bf9\u53ef\u6536\u670d\u7684\u5f92\u5f1f\u53d1\u8d77\u6536\u5f92\u6311\u6218\u3002</p>') + '</div>' +
      (s.prentices[apprenticeSel] ? '<div class="candidate-detail">' + apprenticeProfile(s.prentices[apprenticeSel]) + '</div>' : '') +
      (s.prentices[apprenticeSel] ? '<div class="master-actions">' + button('\u8ba9\u4ed6\u79bb\u5f00\u5e08\u95e8', 'prentice-leave', 'tiny muted') + '</div>' : '') +
      '<div class="extra-apprentice-title"><h3>\u53ef\u6536\u670d\u7684\u5f92\u5f1f</h3>' + button('\u5237\u65b0\u5f92\u5f1f', 'recruit-refresh', 'tiny') + '</div>' +
      '<div class="candidate-row">' + recruitCandidates.map((c, i) =>
        '<div class="candidate-card' + (recruitSel === i ? ' active' : '') + '" data-recruit="' + i + '">' +
        '<b class="candidate-name">' + esc(c.name) + '</b>' +
        '<span class="candidate-level">\u7b49\u7ea7 ' + c.level + '</span>' +
        '<span class="candidate-hp">\u751f\u547d ' + c.hp + '</span>' +
        '<span class="candidate-hp">\u88c5\u5907 ' + (c.gears || []).length + '</span></div>').join('') + '</div>' +
      '<div class="candidate-detail">' + masterProfile(recruitCandidates[recruitSel]) + '</div>' +
      '<div class="master-actions">' +
      (recruitCandidates[recruitSel] ? button('收徒挑战（10金松果）', 'master-recruit', 'gold') : '') +
      (s.prentices.length >= cap ? '<span class="daily-done">\u6536\u5f92\u540d\u989d\u5df2\u6ee1\uff08' + cap + '\uff09</span>' : '') +
      '</div>';

    const p = C().page('system', 'village', '<div class="extra-master-layout">' +
      image('images/classic/characters/master-classic.png', '\u5e08\u7236', 'extra-master-portrait') +
      '<div class="extra-master-main">' +
      '<div class="master-tabs">' +
        '<button type="button" class="uc-tab' + (masterTab === 'master' ? ' active' : '') + '" data-mtab="master">\u6211\u7684\u5e08\u7236</button>' +
        '<button type="button" class="uc-tab' + (masterTab === 'apprentice' ? ' active' : '') + '" data-mtab="apprentice">\u6211\u7684\u5f92\u5f1f\uff08' + s.prentices.length + '/' + cap + '\uff09</button>' +
      '</div>' +
      '<div class="master-panel">' + (masterTab === 'apprentice' ? apprenticeBlock : masterBlock) + '</div>' +
      note('\u5e08\u5f92\u5173\u7cfb\u4fdd\u5b58\u4e8e\u672c\u5730\uff1b\u5e08\u7236\u4e0e\u5f92\u5f1f\u5747\u7531\u672c\u5730\u968f\u673a\u751f\u6210\u3002') + '</div></div>',
      { cls: 'extra-board master-extra-board' });
    back(p, () => UI.runAction('village'), '\u8fd4\u56de\u6751\u5e84');

    // ---- \u4ea4\u4e92 ----
    p.querySelectorAll('[data-mtab]').forEach((el) => el.onclick = () => { masterTab = el.dataset.mtab; master(); });
    p.querySelectorAll('[data-master]').forEach((el) => el.onclick = () => { masterSel = Number(el.dataset.master); master(); });
    p.querySelectorAll('[data-recruit]').forEach((el) => el.onclick = () => { recruitSel = Number(el.dataset.recruit); master(); });
    p.querySelectorAll('[data-prentice]').forEach((el) => el.onclick = () => { apprenticeSel = Number(el.dataset.prentice); master(); });
    on(p, 'master-refresh', () => { masterCandidates = rollMasterCandidates(); masterSel = 0; C().toast('\u5df2\u5237\u65b0\u5e08\u7236\u5217\u8868'); master(); });
    on(p, 'recruit-refresh', () => { recruitCandidates = rollRecruitCandidates(); recruitSel = 0; C().toast('\u5df2\u5237\u65b0\u53ef\u6536\u670d\u5f92\u5f1f'); master(); });
    on(p, 'master-join', () => {
      const cand = masterCandidates[masterSel];
      if (!cand || s.master) return;
      const r = State.setMaster(cand);
      if (!r.ok) { alert(r.msg); return; }
      masterCandidates = [];
      C().modal('\u62dc\u5e08\u6210\u529f', '<div class="extra-finalist">' + image('images/classic/characters/master-classic.png', '\u5e08\u7236') +
        '<div><h3>\u5e08\u7236\uff1a' + esc(cand.name) + '\uff08' + cand.level + '\u7ea7\uff09</h3>' +
        '<p>' + esc((r.learned && r.learned.msg) || '\u5df2\u5b66\u4f1a\u3010\u5e08\u7236\u9a7e\u5230\u3011') + '</p>' +
        '<p class="extra-master-tip">\u53d1\u52a8\u300c\u5e08\u7236\u9a7e\u5230\u300d\u53ef\u6062\u590d\u5e08\u7236\u7b49\u7ea7 \u00d74 \u7684\u751f\u547d\uff0c\u4e14\u4e0b\u4e00\u6b21\u653b\u51fb\u5fc5\u4e2d\u3002</p></div></div>',
        [{ label: '\u53bb\u770b\u770b\u5e08\u7236', run: () => master('master') }, { label: '\u8fd4\u56de', cls: 'muted', run: () => master('master') }]);
    });
    on(p, 'master-leave', () => {
      if(!p.isConnected || State.state()!==s || !s.master)return;
      const cost = 20;
      const leavingMaster=s.master;
      let left=false;
      if (s.goldPoint < cost) { alert('\u9000\u5e08\u95e8\u9700\u8981 ' + cost + ' \u91d1\u677e\u679c\uff0c\u73b0\u5728\u53ea\u6709 ' + s.goldPoint + '\u3002'); return; }
      C().modal('\u51fa\u5e08', '<p>\u786e\u5b9a\u79bb\u5f00\u3010' + esc(s.master.name) + '\u3011\u7684\u5e08\u95e8\u5417\uff1f\u9700\u8981\u82b1\u8d39 ' + cost + ' \u91d1\u677e\u679c\uff0c\u4e4b\u540e\u53ef\u4ee5\u91cd\u65b0\u62dc\u5e08\u3002</p>',
        [{ label: '\u786e\u8ba4\u51fa\u5e08\uff08-' + cost + '\uff09', run: () => {
          if(left || State.state()!==s || s.master!==leavingMaster)return;
          if(s.goldPoint<cost){alert('金松果不足20，无法出师。');return;}
          left=true;s.goldPoint-=cost;State.clearMaster();State.save();C().toast('已离开师门');master();
        } },
         { label: '\u8fd4\u56de', cls: 'muted' }], { small: true });
    });
    on(p, 'master-claim', () => {
      const r = State.claimApprenticeExp();
      if (!r.ok) { C().toast(r.msg); master(); return; }
      C().modal('\u5f92\u5f1f\u65e5\u8d21', '<div class="extra-result"><strong class="cartoon">+' + r.total + ' \u7ecf\u9a8c</strong><p>' + esc(r.msg) + '</p>' +
        '<p class="extra-master-tip">\u5f92\u5f1f\u81ea\u5df1\u7684\u7ecf\u9a8c\u4e0d\u4f1a\u51cf\u5c11\uff0c\u8fd9\u4efd\u7ecf\u9a8c\u662f\u989d\u5916\u4ea7\u51fa\u7684\u3002</p></div>' + C().upsHtml(r.ups),
        [{ label: '\u786e\u5b9a', run: () => master('apprentice') }], { small: true });
    });
    on(p, 'prentice-leave', () => {
      const a = s.prentices[apprenticeSel];
      if (!a) return;
      const canKick = State.canKickToday();
      C().modal('\u8ba9\u5f92\u5f1f\u79bb\u5f00', '<p>\u8ba9\u3010' + esc(a.name) + '\u3011\u79bb\u5f00\u5e08\u95e8\uff0c\u7a7a\u51fa\u4e00\u4e2a\u6536\u5f92\u4f4d\u7f6e\uff1f</p>' +
        (canKick ? '' : '<p class="extra-master-tip">\u4eca\u5929\u5df2\u7ecf\u8e22\u8fc7\u4e00\u4e2a\u5f92\u5f1f\u4e86\uff0c\u8981\u7b49\u660e\u5929\u3002</p>'),
        canKick
          ? [{ label: '\u786e\u8ba4', run: () => { const r = State.kickPrentice(a.name); C().toast(r.msg); apprenticeSel = 0; master('apprentice'); } },
             { label: '\u8fd4\u56de', cls: 'muted' }]
          : [{ label: '\u77e5\u9053\u4e86', cls: 'muted' }], { small: true });
    });
    on(p, 'master-recruit', () => {
      if (recruitBusy || !p.isConnected || State.state()!==s) return;
      const started=State.beginRecruitChallenge(recruitCandidates[recruitSel]);
      if(!started.ok){alert(started.msg);return;}
      recruitBusy = true;
      let settled = false;
      const interrupted=()=>{
        if(settled)return;settled=true;recruitBusy=false;
        if(State.state()!==s)return;
        State.cancelRecruitChallenge(started.token);C().toast('收徒挑战中断，已退还10金松果。');
      };
      try { Promise.resolve(Main.startBattle(started.foe, {
        kind: 'master', useProps: true, region: 0,
        onError:interrupted,
        onEnd: (winner) => {
          if (settled) return; settled = true; recruitBusy = false;
          if(State.state()!==s)return;
          const result=State.finishRecruitChallenge(started.token,winner===0);
          if(!result.ok)return;
          if (result.recruited) { recruitCandidates = rollRecruitCandidates(); recruitSel = 0; apprenticeSel = s.prentices.length - 1; masterTab = 'apprentice'; }
          master(masterTab);   // 战果弹窗放回师徒页上
          outcome(result.win, result, result.msg, () => master('apprentice'), '返回师徒');
        },
      })).catch(interrupted); } catch(error){interrupted();}
    });
  }

  window.ClassicExtras = { arena, rank, rankShop: () => rankShop(0), lottery, master, lotteryPrizes: prizes };
})();
