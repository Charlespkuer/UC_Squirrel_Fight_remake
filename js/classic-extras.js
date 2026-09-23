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
  function arena() {
    State.tickEnergy();
    const s = State.state();
    if (arenaRun && arenaRun.owner !== s) arenaRun = null;
    // Returning to this page after an interrupted player may resume the paid round.
    if (arenaRun) arenaRun.busy = false;
    const cards = [
      { art: 28, name: '\u7ecf\u9a8c\u7ade\u6280\u573a', text: '\u51a0\u519b\u7ecf\u9a8c +150\uff0c\u91d1\u677e\u679c +10', action: 'arena-exp' },
      { art: 29, name: '\u788e\u7247\u7ade\u6280\u573a', text: '\u51a0\u519b\u84dd\u8272\u788e\u7247 \u00d78\uff0c\u7ecf\u9a8c +30', action: 'arena-fragment' },
      { art: 30, name: '\u5929\u68af\u8d5b', text: '30\u7ea7\u5f00\u542f\uff0c\u8d62\u79ef\u5206\u3001\u4e89\u91d1\u676f', action: 'arena-rank' },
    ];
    const p = C().page('challenge', 'arena', '<div class="extra-arena-cards">' + cards.map(card => '<article>' + sprite(card.art) + '<h2>' + card.name + '</h2><p>' + card.text + '</p>' + button(card.name === '\u5929\u68af\u8d5b' ? '\u8fdb\u5165\u5929\u68af' : '\u53c2\u52a0\u6bd4\u8d5b', card.action, 'small gold') + '</article>').join('') + '</div><div class="extra-arena-cost">4\u4eba\u6dd8\u6c70\u8d5b\uff0c\u6bcf\u6b21\u62a5\u540d\u6d88\u801730\u4f53\u529b\u3002\u82f1\u96c4\u5e16\u6216\u52c7\u6c14\u5fbd\u7ae0\u53ef\u62b5\u6263\u3002<br>\u4f53\u529b ' + s.energy + '/' + s.maxEnergy + '\u3000\u82f1\u96c4\u5e16 ' + (s.props[36] || 0) + '\u3000\u52c7\u6c14\u5fbd\u7ae0 ' + (s.props[39] || 0) + '</div>' + (arenaRun ? '<div class="extra-resume">\u4f60\u5df2\u62a5\u540d\uff0c\u65e0\u9700\u518d\u6b21\u6d88\u8017\u4f53\u529b\u3002' + button(arenaRun.phase === 'final' ? '\u7ee7\u7eed\u51b3\u8d5b' : '\u7ee7\u7eed\u6bd4\u8d5b', 'arena-resume', 'tiny gold') + '</div>' : ''), { cls: 'extra-board arena-extra-board' });
    on(p, 'arena-exp', () => confirmArena(0));
    on(p, 'arena-fragment', () => confirmArena(1));
    on(p, 'arena-rank', rank);
    on(p, 'arena-resume', () => fightArena(arenaRun));
  }
  function confirmArena(kind) {
    if (arenaRun && arenaRun.owner === State.state()) {
      fightArena(arenaRun); return;
    }
    C().modal('\u7ade\u6280\u573a\u62a5\u540d', '<p>' + (kind ? '\u788e\u7247\u7ade\u6280\u573a' : '\u7ecf\u9a8c\u7ade\u6280\u573a') + '\uff1a\u5148\u8d62\u534a\u51b3\u8d5b\uff0c\u518d\u4e89\u593a\u51a0\u519b\u3002</p><p>\u62a5\u540d\u4e00\u6b21\u6d88\u801730\u4f53\u529b\uff0c\u51b3\u8d5b\u4e0d\u518d\u6263\u9664\u3002\u4f53\u529b\u4e0d\u8db3\u65f6\u4f7f\u75281\u5f20\u82f1\u96c4\u5e16\u6216\u52c7\u6c14\u5fbd\u7ae0\u3002</p>' + note('\u79bb\u7ebf\u5bf9\u624b\u7531\u672c\u5730\u751f\u6210\u3002\u7ade\u6280\u573a\u4e0d\u4f7f\u7528\u6311\u6218\u836f\u5242\u6548\u679c\u3002'), [{ label: '\u62a5\u540d\u53c2\u8d5b', run: () => {
      if (arenaRun) return;
      const s = State.state(); State.tickEnergy();
      if (s.energy >= 30) { if (!State.consumeEnergy(30)) return; }
      else {
        const preferred = kind ? 39 : 36, alternate = kind ? 36 : 39;
        const ticket = s.props[preferred] > 0 ? preferred : s.props[alternate] > 0 ? alternate : 0;
        if (!ticket) { alert('\u4f53\u529b\u4e0d\u8db330\u70b9\uff0c\u4e5f\u6ca1\u6709\u82f1\u96c4\u5e16\u6216\u52c7\u6c14\u5fbd\u7ae0\u3002'); return; }
        s.props[ticket]--; State.save();
      }
      const foes = [State.genAI(s.level), State.genAI(s.level), State.genAI(s.level)];
      const other = Sim.simulate(foes[1], foes[2]);
      arenaRun = { owner: s, kind, phase: 'semi', foe: foes[0], finalist: foes[other.winner === 0 ? 1 : 2], busy: false, settled: false };
      fightArena(arenaRun);
    } }, { label: '\u8fd4\u56de', cls: 'muted' }], { small: true });
  }
  function fightArena(run) {
    if (!run || run.busy || run.settled || run.owner !== State.state()) return;
    run.busy = true;
    const final = run.phase === 'final', foe = final ? run.finalist : run.foe;
    let finished = false;
    Main.startBattle(foe, { cost: 0, kind: 'arena', useProps: false, region: 0, onEnd: winner => {
      if (finished || run.settled) return;
      finished = true; run.busy = false;
      if (!final && winner === 0) {
        run.phase = 'final';
        C().modal('\u664b\u7ea7\u51b3\u8d5b', '<div class="extra-finalist">' + image('images/classic/squirrel-classic.png', '\u51b3\u8d5b\u5bf9\u624b') + '<div><h3>\u534a\u51b3\u8d5b\u83b7\u80dc\uff01</h3><p>\u51b3\u8d5b\u5bf9\u624b\uff1a' + esc(run.finalist.name) + '<br>\u7b49\u7ea7 ' + run.finalist.level + '</p></div></div>' + note('\u672c\u6b21\u51b3\u8d5b\u65e0\u9700\u518d\u6d88\u8017\u4f53\u529b\u3002\u5173\u95ed\u540e\u53ef\u56de\u7ade\u6280\u573a\u7ee7\u7eed\u3002'), [{ label: '\u5f00\u59cb\u51b3\u8d5b', run: () => fightArena(run) }, { label: '\u7a0d\u540e\u7ee7\u7eed', cls: 'muted', run: arena }]);
        return;
      }
      run.settled = true; arenaRun = null;
      const s = State.state(), win = final && winner === 0;
      let exp = final ? win ? run.kind ? 30 : 150 : 75 : 10;
      const gold = win && !run.kind ? 10 : 0;
      // \u788e\u7247\u573a\uff1a\u7b2c 3 \u540d 4 \u4e2a\u3001\u7b2c 4 \u540d 3 \u4e2a\u788e\u7247\uff1b\u51a0\u519b 8 \u4e2a\uff08\u53c2\u8003 reference.md\uff09
      let shards = 0;
      if (run.kind) shards = win ? 8 : final ? 6 : (winner === 2 ? 4 : 3);
      if (shards) addProp(26, shards);
      s.goldPoint += gold;
      const ups = State.gainExp(exp); State.save();
      const shardText = shards ? '\u84dd\u8272\u788e\u7247 \u00d7' + shards + ' \u5df2\u653e\u5165\u80cc\u5305\u3002' : '';
      outcome(win, { exp, gold, ups }, (win ? (run.kind ? '\u83b7\u5f97\u51a0\u519b\uff01' : '\u83b7\u5f97\u51a0\u519b\uff01\u7ee7\u7eed\u5411\u66f4\u5f3a\u7684\u5bf9\u624b\u6311\u6218\u3002') : final ? '\u83b7\u5f97\u4e9a\u519b\uff0c\u5956\u52b175\u7ecf\u9a8c\u3002' : '\u6b62\u6b65\u534a\u51b3\u8d5b\uff0c\u83b7\u5f9710\u70b9\u53c2\u4e0e\u7ecf\u9a8c\u3002') + shardText, arena, '\u8fd4\u56de\u7ade\u6280\u573a');
    } }).catch(() => { run.busy = false; C().toast('\u6bd4\u8d5b\u6682\u65f6\u4e2d\u65ad\uff0c\u53ef\u56de\u7ade\u6280\u573a\u7ee7\u7eed\u3002'); });
  }

  let rankBusy = false;
  function rank() {
    rankBusy = false;
    const s = State.state(); State.tickEnergy();
    if (s.level < 30) {
      C().modal('\u5929\u68af\u8d5b', '<div class="extra-finalist">' + sprite(30) + '<div><h3>30\u7ea7\u5f00\u542f\u5929\u68af\u8d5b</h3><p>\u5f53\u524d\u7b49\u7ea7\uff1a' + s.level + '<br>\u5148\u53bb\u6311\u6218\u79ef\u7d2f\u7ecf\u9a8c\u5427\uff01</p></div></div>', [{ label: '\u53bb\u6311\u6218', run: () => UI.runAction('challenge') }, { label: '\u8fd4\u56de\u7ade\u6280\u573a', cls: 'muted', run: arena }]); return;
    }
    if (s.integral == null) { s.integral = 1500; State.save(); }
    const entries = [0, 1, 2, 3, 4, 5].map((n) => ({ name: GData.AI_NAMES[n * 4], points: 1350 + n * 83 }));
    entries.push({ name: s.name, points: s.integral, mine: true }); entries.sort((a, b) => b.points - a.points);
    const p = C().page('challenge', 'arena', '<div class="extra-rank-layout"><div class="extra-rank-self">' + sprite(30) + '<h2>\u5929\u68af\u8d5b</h2><div class="extra-score">\u79ef\u5206 <b>' + s.integral + '</b></div><div class="extra-score">\u91d1\u676f <b>' + s.goldCup + '</b></div><p>\u4eca\u65e5\u5df2\u53c2\u8d5b ' + s.joinRankCount + ' \u573a</p>' + button('\u5f00\u59cb\u5339\u914d', 'rank-fight', 'small gold') + button('\u91d1\u676f\u5546\u5e97', 'rank-shop', 'small') + '</div><div class="extra-rank-list"><h3>\u672c\u5730\u6a21\u62df\u6392\u884c\u699c</h3>' + entries.map((entry, i) => '<div class="extra-rank-row ' + (entry.mine ? 'mine' : '') + '"><span>' + (i + 1) + '</span><b>' + esc(entry.name) + (entry.mine ? '\uff08\u4f60\uff09' : '') + '</b><strong>' + entry.points + '</strong></div>').join('') + note('\u79bb\u7ebf\u6a21\u62df\u6bd4\u8d5b\u4e0e\u6392\u540d\uff0c\u4e0d\u8fde\u63a5\u539f\u7248\u670d\u52a1\u5668\u3002\u80dc\u5229\u5f975\u91d1\u676f\uff0c\u843d\u8d25\u5f971\u91d1\u676f\u3002') + '</div></div>', { cls: 'extra-board rank-extra-board' });
    back(p, arena, '\u8fd4\u56de\u7ade\u6280\u573a');
    on(p, 'rank-shop', () => rankShop(0));
    on(p, 'rank-fight', () => {
      if (rankBusy) return;
      rankBusy = true; s.joinRankCount++; State.save();
      const foe = State.genAI(Math.max(1, s.level + Math.floor(Math.random() * 6) - 3));
      let settled = false;
      Main.startBattle(foe, { cost: 0, kind: 'rank', useProps: false, region: 2, onEnd: winner => {
        if (settled) return; settled = true; rankBusy = false;
        const win = winner === 0, delta = win ? 20 + Math.floor(Math.random() * 15) : -(10 + Math.floor(Math.random() * 10));
        s.integral = Math.max(0, s.integral + delta); s.goldCup += win ? 5 : 1;
        const exp = win ? 30 : 10, ups = State.gainExp(exp); State.save();
        outcome(win, { exp, gold: 0, ups }, '\u79ef\u5206 ' + (delta > 0 ? '+' : '') + delta + '\uff0c\u91d1\u676f +' + (win ? 5 : 1) + '\u3002\u5f53\u524d\u79ef\u5206 ' + s.integral + '\u3002', rank, '\u8fd4\u56de\u5929\u68af\u8d5b');
      } }).catch(() => { rankBusy = false; C().toast('\u5339\u914d\u6682\u65f6\u4e2d\u65ad\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002'); });
    });
  }
  function rankShop(pg) {
    const s = State.state(), goods = []; rankgoodsMap.each((id, item) => goods.push(item));
    const total = Math.ceil(goods.length / 6); pg = Math.max(0, Math.min(pg || 0, total - 1));
    const selected = goods.slice(pg * 6, pg * 6 + 6);
    const p = C().page('bag', 'shop', '<div class="extra-shop-balance">\u91d1\u676f ' + s.goldCup + '\u3000\u91d1\u677e\u679c ' + s.goldPoint + '\u3000\u79ef\u5206 ' + s.integral + '</div><div class="extra-shop-grid">' + selected.map(item => '<button class="extra-shop-item" data-goods="' + item.id + '">' + (item.type === '2' ? image('images/classic/icons/gear-' + item.goodsId + '.png', item.name) : C().icon('prop', +item.goodsId)) + '<b>' + esc(item.name) + '</b><span>' + item.cup + '\u91d1\u676f + ' + item.gold + '\u91d1\u677e\u679c</span><small>\u79ef\u5206\u9700 ' + item.integral + (Number(item.timesLimit) > 0 ? ' \u00b7 \u9650\u51511\u6b21' : '') + '</small></button>').join('') + '</div><div class="extra-pagination">' + button('\u4e0a\u4e00\u9875', 'rank-shop-prev', 'tiny muted') + '<span>' + (pg + 1) + '/' + total + '</span>' + button('\u4e0b\u4e00\u9875', 'rank-shop-next', 'tiny muted') + '</div>', { cls: 'extra-board extra-cup-shop' });
    back(p, rank, '\u8fd4\u56de\u5929\u68af\u8d5b');
    on(p, 'rank-shop-prev', () => rankShop(Math.max(0, pg - 1)));
    on(p, 'rank-shop-next', () => rankShop(Math.min(total - 1, pg + 1)));
    p.querySelectorAll('[data-goods]').forEach(element => element.onclick = () => {
      const item = rankgoodsMap.getValue(element.dataset.goods);
      C().modal('\u91d1\u676f\u5151\u6362', '<p>\u5151\u6362\u3010' + esc(item.name) + '\u3011</p><p>' + esc(item.remark) + '</p><p>\u9700\u8981\uff1a' + item.cup + '\u91d1\u676f\u3001' + item.gold + '\u91d1\u677e\u679c\uff0c\u79ef\u5206\u8fbe\u5230' + item.integral + '\u3002</p>', [{ label: '\u786e\u8ba4\u5151\u6362', run: () => {
        if (s.integral < +item.integral) { alert('\u5929\u68af\u79ef\u5206\u5c1a\u672a\u8fbe\u5230\u5151\u6362\u8981\u6c42\u3002'); return; }
        if (s.goldCup < +item.cup || s.goldPoint < +item.gold) { alert('\u91d1\u676f\u6216\u91d1\u677e\u679c\u4e0d\u8db3\u3002'); return; }
        const bought = s.rankPurchases || {};
        if (+item.timesLimit > 0 && (bought[item.id] || 0) >= +item.timesLimit) { alert('\u8be5\u5956\u52b1\u5728\u5f53\u524d\u5b58\u6863\u4e2d\u7684\u5151\u6362\u6b21\u6570\u5df2\u7528\u5b8c\u3002'); return; }
        s.goldCup -= +item.cup; s.goldPoint -= +item.gold;
        if (item.type === '2') State.addGear(+item.goodsId, State.randomExt(2)); else addProp(+item.goodsId, +item.count);
        bought[item.id] = (bought[item.id] || 0) + 1; s.rankPurchases = bought; State.save(); C().toast('\u5151\u6362\u6210\u529f\uff1a' + item.name); rankShop(pg);
      } }, { label: '\u8fd4\u56de', cls: 'muted' }], { small: true });
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
  // \u6536\u5f92\u4e0a\u9650\u968f\u5e08\u7236\u7b49\u7ea7 1/2/3 \u4e2a\uff1b\u5f92\u5f1f\u6bcf\u5929\u4e3a\u5e08\u7236\u4ea7\u51fa\u56fa\u5b9a\u7ecf\u9a8c\uff08\u65e5\u8d21\uff0c\u5f92\u5f1f\u81ea\u8eab\u4e0d\u635f\u5931\uff09\uff1b
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
    const today = State.localDate();
    const done = row.lastExpDate === today;
    return '<div class="profile-panel">' +
      '<p class="profile-meta">\u5165\u95e8\u65e5\u671f\uff1a' + esc(row.since || '\u672a\u77e5') + '\u3000\u00b7\u3000\u4eca\u65e5\u65e5\u8d21\uff1a' +
      (done ? '<b class="done">\u5df2\u9886\u53d6</b>' : '<b>' + State.apprenticeDailyExp(row.level) + ' \u7ecf\u9a8c</b>') + '</p>' +
      profileStats(row) + profileGear(row) + '</div>';
  }

  let masterCandidates = [], recruitCandidates = [];
  let masterSel = 0, recruitSel = 0, apprenticeSel = 0, recruitBusy = false;
  let masterTab = 'master';
  function master(tab) {
    recruitBusy = false;
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
    const unclaimed = (s.prentices || []).filter((p) => p.lastExpDate !== State.localDate()).length;
    const apprenticeBlock =
      '<div class="extra-apprentice-title"><h3>\u6211\u7684\u5f92\u5f1f\uff08' + s.prentices.length + '/' + cap + '\uff09</h3>' +
      (unclaimed ? button('\u9886\u53d6\u65e5\u8d21 +' + dailyTotal, 'master-claim', 'tiny gold') : '<span class="daily-done">\u4eca\u65e5\u65e5\u8d21\u5df2\u9886</span>') + '</div>' +
      '<p class="extra-master-tip">\u5f92\u5f1f\u6bcf\u5929\u4e3a\u5e08\u7236\u4ea7\u51fa\u300c\u7b49\u7ea7 \u00d73 + 5\u300d\u70b9\u7ecf\u9a8c\uff08\u65e5\u8d21\uff09\uff0c\u5f92\u5f1f\u81ea\u5df1\u7684\u7ecf\u9a8c\u4e0d\u4f1a\u51cf\u5c11\u3002\u6536\u5f92\u4e0a\u9650\u968f\u5e08\u7236\u7b49\u7ea7\u63d0\u5347\uff1a10 \u7ea7\u524d 1 \u4e2a\uff0c10-19 \u7ea7 2 \u4e2a\uff0c20 \u7ea7\u4ee5\u4e0a 3 \u4e2a\u3002</p>' +
      '<div class="apprentice-row">' + (s.prentices.length
        ? s.prentices.map((a, i) => '<div class="candidate-card small' + (apprenticeSel === i ? ' active' : '') + '" data-prentice="' + i + '">' +
            '<b class="candidate-name">' + esc(a.name) + '</b><span class="candidate-level">\u7b49\u7ea7 ' + a.level + '</span>' +
            '<span class="candidate-hp">\u65e5\u8d21 ' + State.apprenticeDailyExp(a.level) + '</span></div>').join('')
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
      (recruitCandidates[recruitSel] ? button('\u6536\u5f92\u6311\u6218\uff0810\u4f53\u529b\uff09', 'master-recruit', 'gold') : '') +
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
      const cost = 20;
      if (s.goldPoint < cost) { alert('\u9000\u5e08\u95e8\u9700\u8981 ' + cost + ' \u91d1\u677e\u679c\uff0c\u73b0\u5728\u53ea\u6709 ' + s.goldPoint + '\u3002'); return; }
      C().modal('\u51fa\u5e08', '<p>\u786e\u5b9a\u79bb\u5f00\u3010' + esc(s.master.name) + '\u3011\u7684\u5e08\u95e8\u5417\uff1f\u9700\u8981\u82b1\u8d39 ' + cost + ' \u91d1\u677e\u679c\uff0c\u4e4b\u540e\u53ef\u4ee5\u91cd\u65b0\u62dc\u5e08\u3002</p>',
        [{ label: '\u786e\u8ba4\u51fa\u5e08\uff08-' + cost + '\uff09', run: () => { s.goldPoint -= cost; State.clearMaster(); State.save(); C().toast('\u5df2\u79bb\u5f00\u5e08\u95e8'); master(); } },
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
      if (recruitBusy) return;
      if (s.prentices.length >= State.apprenticeCap(s.level)) { alert('\u6536\u5f92\u540d\u989d\u5df2\u6ee1\uff0c\u5148\u8ba9\u4e00\u4f4d\u5f92\u5f1f\u51fa\u5e08\u5427\u3002'); return; }
      const foe = recruitCandidates[recruitSel];
      if (!foe) return;
      State.tickEnergy();
      if (s.energy < 10) { alert('\u6536\u5f92\u6311\u6218\u9700\u8981 10 \u4f53\u529b\uff0c\u5148\u6062\u590d\u4f53\u529b\u518d\u6765\u5427\u3002'); return; }
      recruitBusy = true;
      let settled = false;
      Main.startBattle(foe, {
        cost: 10, kind: 'master', useProps: true, region: 0,
        onEnd: (winner) => {
          if (settled) return; settled = true; recruitBusy = false;
          const win = winner === 0;
          let recruited = null, text;
          if (win) {
            const added = State.addPrentice(foe);
            recruited = added.ok ? added.apprentice : null;
            text = added.ok ? '\u6536\u3010' + foe.name + '\u3011\u4e3a\u5f92\uff01' : added.msg;
          } else {
            text = '\u6536\u5f92\u6311\u6218\u5931\u8d25\uff0c\u63d0\u5347\u5b9e\u529b\u540e\u518d\u6765\u3002';
          }
          State.tickPropStates();
          const exp = win ? 20 : 0, ups = State.gainExp(exp); State.save();
          if (recruited) { recruitCandidates = rollRecruitCandidates(); recruitSel = 0; apprenticeSel = s.prentices.length - 1; masterTab = 'apprentice'; }
          outcome(win, { exp, gold: 0, ups }, text, () => master('apprentice'), '\u8fd4\u56de\u5e08\u5f92');
        },
      }).catch(() => { recruitBusy = false; C().toast('\u6536\u5f92\u6311\u6218\u6682\u65f6\u4e2d\u65ad\u3002'); });
    });
  }

  window.ClassicExtras = { arena, rank, lottery, master };
})();
