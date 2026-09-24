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
      { art: 28, name: '\u7ecf\u9a8c\u7ade\u6280\u573a', text: '11\u7ea7\u5f00\u542f\uff0c\u51a0\u519b150\uff0f\u4e9a\u519b75\uff0f\u5b63\u519b25\u7ecf\u9a8c', action: 'arena-exp' },
      { art: 29, name: '\u788e\u7247\u7ade\u6280\u573a', text: '20\u7ea7\u5f00\u542f\uff0c\u56db\u540d\u4f9d\u6b21\u83b7\u5f978\uff0f6\uff0f4\uff0f3\u84dd\u8272\u788e\u7247', action: 'arena-fragment' },
      { art: 30, name: '\u5929\u68af\u8d5b', text: '30\u7ea7\u5f00\u542f\uff0c\u8d62\u79ef\u5206\u3001\u4e89\u91d1\u676f', action: 'arena-rank' },
    ];
    const resume = run ? '<div class="extra-resume">\u4f60\u5df2\u62a5\u540d\uff0c\u65e0\u9700\u518d\u6b21\u6d88\u8017\u4f53\u529b\u3002' + button(run.phase === 'final' ? '\u7ee7\u7eed\u51b3\u8d5b' : run.phase === 'third' ? '\u7ee7\u7eed\u5b63\u519b\u8d5b' : '\u7ee7\u7eed\u6bd4\u8d5b', 'arena-resume', 'tiny gold') + '</div>' : '';
    const p = C().page('challenge', 'arena', '<div class="extra-arena-cards">' + cards.map(card => '<article>' + sprite(card.art) + '<h2>' + card.name + '</h2><p>' + card.text + '</p>' + button(card.action === 'arena-rank' ? '\u8fdb\u5165\u5929\u68af' : '\u53c2\u52a0\u6bd4\u8d5b', card.action, 'small gold') + '</article>').join('') + '</div><div class="extra-arena-cost">4\u4eba\u4e24\u8f6e\u6bd4\u8d5b\uff1a\u534a\u51b3\u8d5b\u80dc\u8005\u4e89\u51a0\u519b\uff0c\u8d25\u8005\u4e89\u5b63\u519b\u3002<br>\u62a5\u540d\u6d88\u801730\u4f53\u529b\uff0c\u4f53\u529b\u4e0d\u8db3\u53ef\u4f7f\u7528\u82f1\u96c4\u5e16\u6216\u52c7\u6c14\u5fbd\u7ae0\u3002<br>\u4f53\u529b ' + s.energy + '/' + s.maxEnergy + '\u3000\u82f1\u96c4\u5e16 ' + (s.props[36] || 0) + '\u3000\u52c7\u6c14\u5fbd\u7ae0 ' + (s.props[39] || 0) + '</div>' + resume, { cls: 'extra-board arena-extra-board' });
    on(p, 'arena-exp', () => confirmArena(0));
    on(p, 'arena-fragment', () => confirmArena(1));
    on(p, 'arena-rank', rank);
    on(p, 'arena-resume', () => fightArena(activeArenaRun()));
  }
  function arenaAccess(kind) {
    const level = kind ? 20 : 11;
    if (State.state().level >= level) return true;
    alert((kind ? '\u788e\u7247\u7ade\u6280\u573a' : '\u7ecf\u9a8c\u7ade\u6280\u573a') + '\u9700\u8981\u8fbe\u5230' + level + '\u7ea7\u3002'); return false;
  }
  function confirmArena(kind) {
    const existing = activeArenaRun();
    if (existing) { fightArena(existing); return; }
    if (!arenaAccess(kind)) return;
    const owner = State.state();
    C().modal('\u7ade\u6280\u573a\u62a5\u540d', '<p>' + (kind ? '\u788e\u7247\u7ade\u6280\u573a' : '\u7ecf\u9a8c\u7ade\u6280\u573a') + '\uff1a\u534a\u51b3\u8d5b\u80dc\u8005\u8fdb\u5165\u51b3\u8d5b\uff0c\u8d25\u8005\u8fdb\u884c\u5b63\u519b\u8d5b\u3002</p><p>\u62a5\u540d\u4e00\u6b21\u6d88\u801730\u4f53\u529b\uff0c\u7b2c\u4e8c\u6218\u4e0d\u518d\u6263\u9664\u3002\u4f53\u529b\u4e0d\u8db3\u65f6\u4f7f\u75281\u5f20\u82f1\u96c4\u5e16\u6216\u52c7\u6c14\u5fbd\u7ae0\u3002</p>' + note('\u79bb\u7ebf\u5bf9\u624b\u7531\u672c\u5730\u751f\u6210\u3002\u7ade\u6280\u573a\u4e0d\u4f7f\u7528\u6311\u6218\u836f\u5242\u6548\u679c\u3002'), [{ label: '\u62a5\u540d\u53c2\u8d5b', run: () => {
      if (State.state() !== owner || activeArenaRun() || !arenaAccess(kind)) return;
      const s = owner; State.tickEnergy();
      if (s.energy >= 30) { if (!State.consumeEnergy(30)) return; }
      else {
        const preferred = kind ? 39 : 36, alternate = kind ? 36 : 39;
        const ticket = s.props[preferred] > 0 ? preferred : s.props[alternate] > 0 ? alternate : 0;
        if (!ticket) { alert('\u4f53\u529b\u4e0d\u8db330\u70b9\uff0c\u4e5f\u6ca1\u6709\u82f1\u96c4\u5e16\u6216\u52c7\u6c14\u5fbd\u7ae0\u3002'); return; }
        s.props[ticket]--; State.save();
      }
      const foes = [State.genAI(s.level), State.genAI(s.level), State.genAI(s.level)];
      const other = Sim.simulate(foes[1], foes[2]);
      arenaRun = { owner: s, kind, phase: 'semi', foe: foes[0], finalist: foes[other.winner === 0 ? 1 : 2], consolation: foes[other.winner === 0 ? 2 : 1], busy: false, settled: false };
      saveArenaRun(arenaRun); fightArena(arenaRun);
    } }, { label: '\u8fd4\u56de', cls: 'muted' }], { small: true });
  }
  function fightArena(run) {
    if (!run || run.busy || run.settled || run.owner !== State.state()) return;
    run.busy = true;
    const phase = run.phase, foe = phase === 'final' ? run.finalist : phase === 'third' ? run.consolation : run.foe;
    let finished = false;
    const interrupted = () => {
      if (finished || run.settled || run.owner !== State.state()) return;
      finished = true; run.busy = false;
      C().toast('\u6bd4\u8d5b\u6682\u65f6\u4e2d\u65ad\uff0c\u672c\u8f6e\u5df2\u4fdd\u5b58\uff0c\u53ef\u56de\u7ade\u6280\u573a\u7ee7\u7eed\u3002');
    };
    Main.startBattle(foe, { cost: 0, kind: 'arena', useProps: false, region: 0, onError: interrupted, onEnd: winner => {
      if (finished || run.settled || run.owner !== State.state()) return;
      finished = true; run.busy = false;
      if (phase === 'semi') {
        const won = winner === 0;
        run.phase = won ? 'final' : 'third'; saveArenaRun(run);
        const gem = won ? State.rollGemDrop(15) : null;   // 45\u7ea7\u8d77\u7ade\u6280\u573a\u83b7\u80dc\u6709\u51e0\u7387\u5f97\u5b9d\u77f3
        if (gem) State.save();
        const opponent = won ? run.finalist : run.consolation, title = won ? '\u664b\u7ea7\u51b3\u8d5b' : '\u4e89\u593a\u5b63\u519b';
        arena();   // \u534a\u51b3\u8d5b\u540e\u56de\u5230\u7ade\u6280\u573a\u9875\u505a\u80cc\u666f\uff08\u73a9\u5bb6\u521a\u4ece\u8fd9\u91cc\u62a5\u540d\uff09
        C().modal(title, '<div class="extra-finalist">' + image('images/classic/squirrel-classic.png', '\u4e0b\u4e00\u573a\u5bf9\u624b') + '<div><h3>' + (won ? '\u534a\u51b3\u8d5b\u83b7\u80dc\uff01' : '\u8fd8\u6709\u5b63\u519b\u8d5b\uff0c\u7ee7\u7eed\u52a0\u6cb9\uff01') + '</h3><p>\u4e0b\u4e00\u573a\u5bf9\u624b\uff1a' + esc(opponent.name) + '<br>\u7b49\u7ea7 ' + opponent.level + '</p></div></div>' + (gem ? note('\u83b7\u5f97 ' + gem.name + ' \u00d71\uff01') : '') + note('\u7b2c\u4e8c\u6218\u65e0\u9700\u518d\u6d88\u8017\u4f53\u529b\uff0c\u5173\u95ed\u9875\u9762\u540e\u4ecd\u53ef\u7ee7\u7eed\u672c\u8f6e\u3002'), [{ label: won ? '\u5f00\u59cb\u51b3\u8d5b' : '\u5f00\u59cb\u5b63\u519b\u8d5b', run: () => fightArena(run) }, { label: '\u7a0d\u540e\u7ee7\u7eed', cls: 'muted', run: arena }]);
        return;
      }
      run.settled = true; arenaRun = null;
      const position = phase === 'final' ? (winner === 0 ? 0 : 1) : (winner === 0 ? 2 : 3);
      // \u7ecf\u9a8c\u573a\u5403\u7ecf\u9a8c\u4e38\u52a0\u6210\uff08\u7ecf\u9a8c\u4e38 +40% / \u8d85\u7ea7\u7ecf\u9a8c\u4e38 +60%\uff09\uff1b\u788e\u7247\u573a\u7ed9\u788e\u7247\u4e0d\u7ed9\u7ecf\u9a8c
      const baseExp = run.kind ? 0 : [150, 75, 25, 0][position];
      // \u52a0\u6210\u767e\u5206\u6bd4\u8981\u5728 tickPropStates \u6d88\u8017\u672c\u573a\u7528\u91cf\u4e4b\u524d\u8bfb\uff0c\u5426\u5219\u7ed3\u7b97\u6587\u6848\u4f1a\u663e\u793a\u6210 0%
      const boostPct = baseExp ? State.expBoostPct() : 0;
      const boosted = baseExp ? State.gainExpWithBoost(baseExp) : { exp: 0, ups: [] };
      const exp = boosted.exp;
      const shards = run.kind ? [8, 6, 4, 3][position] : 0;
      if (shards) addProp(26, shards);
      const gem = winner === 0 ? State.rollGemDrop(15) : null;   // 45\u7ea7\u8d77\u7ade\u6280\u573a\u83b7\u80dc\u6709\u51e0\u7387\u5f97\u5b9d\u77f3
      const ups = boosted.ups;
      if (baseExp) State.tickPropStates();   // \u7ecf\u9a8c\u4e38\u6309\u573a\u6b21\u6d88\u8017
      const boostNote = boostPct ? '\uff08\u542b\u7ecf\u9a8c\u4e38 +' + boostPct + '%\uff09' : '';
      saveArenaRun(null);
      arena();   // \u6218\u679c\u5f39\u7a97\u653e\u56de\u7ade\u6280\u573a\u4e0a\uff0c\u522b\u98d8\u5728\u4e3b\u754c\u9762\u4e0a
      outcome(winner === 0, { exp, gold: 0, ups }, '\u83b7\u5f97' + ['\u51a0\u519b', '\u4e9a\u519b', '\u5b63\u519b', '\u7b2c\u56db\u540d'][position] + '\uff01' + (shards ? '\u84dd\u8272\u788e\u7247 \u00d7' + shards + ' \u5df2\u653e\u5165\u80cc\u5305\u3002' : '\u5956\u52b1' + exp + '\u7ecf\u9a8c' + boostNote + '\u3002') + (gem ? '\u83b7\u5f97 ' + gem.name + ' \u00d71\uff01' : ''), arena, '\u8fd4\u56de\u7ade\u6280\u573a');
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
      C().modal('\u5929\u68af\u8d5b', '<div class="extra-finalist">' + sprite(30) + '<div><h3>30\u7ea7\u5f00\u542f\u5929\u68af\u8d5b</h3><p>\u5f53\u524d\u7b49\u7ea7\uff1a' + s.level + '<br>\u5148\u53bb\u6311\u6218\u79ef\u7d2f\u7ecf\u9a8c\u5427\uff01</p></div></div>', [{ label: '\u53bb\u6311\u6218', run: () => UI.runAction('challenge') }, { label: '\u8fd4\u56de\u7ade\u6280\u573a', cls: 'muted', run: arena }]); return;
    }
    if (s.integral == null) { s.integral = 1500; State.save(); }
    refreshRankWeek();
    const entries = [0, 1, 2, 3, 4, 5].map((n) => ({ name: GData.AI_NAMES[n * 4], points: 1350 + n * 83 }));
    entries.push({ name: s.name, points: s.integral, mine: true }); entries.sort((a, b) => b.points - a.points);
    const p = C().page('challenge', 'arena', '<div class="extra-rank-layout"><div class="extra-rank-self">' + sprite(30) + '<h2>\u5929\u68af\u8d5b</h2><div class="extra-score">\u79ef\u5206 <b>' + s.integral + '</b></div><div class="extra-score">\u91d1\u676f <b>' + s.goldCup + '</b></div><p>\u4eca\u65e5\u5df2\u53c2\u8d5b ' + s.joinRankCount + ' / 20 \u573a<br>' + (rankSunday() ? '\u5468\u65e5\u4f11\u8d5b\uff0c\u91d1\u676f\u5546\u5e97\u5f00\u653e' : s.joinRankCount >= 20 ? '\u4eca\u65e5\u53c2\u8d5b\u6b21\u6570\u5df2\u7528\u5b8c' : s.joinRankCount < 10 ? '\u672c\u6b21\u514d\u8d39\uff0c\u524d10\u573a\u514d\u8d39' : '\u672c\u6b21\u6d88\u80175\u91d1\u677e\u679c') + '</p>' + button('\u5f00\u59cb\u5339\u914d', 'rank-fight', 'small gold') + button('\u91d1\u676f\u5546\u5e97', 'rank-shop', 'small') + '</div><div class="extra-rank-list"><h3>\u672c\u5730\u6a21\u62df\u6392\u884c\u699c</h3>' + entries.map((entry, i) => '<div class="extra-rank-row ' + (entry.mine ? 'mine' : '') + '"><span>' + (i + 1) + '</span><b>' + esc(entry.name) + (entry.mine ? '\uff08\u4f60\uff09' : '') + '</b><strong>' + entry.points + '</strong></div>').join('') + note('\u5468\u4e00\u81f3\u5468\u516d\u6bd4\u8d5b\uff0c\u5468\u65e5\u5151\u6362\u3002\u6bcf\u65e5\u6700\u591a20\u573a\uff0c\u524d10\u573a\u514d\u8d39\uff0c\u5176\u540e\u6bcf\u573a5\u91d1\u677e\u679c\u3002\u80dc\u5229\u5f973\u676f\uff0c\u843d\u8d25\u5f971\u676f\u3002\u79ef\u5206\u4e0e\u593a\u676f\u4e3a\u79bb\u7ebf\u6a21\u62df\uff1b\u83b7\u80dc\u670925%\u673a\u4f1a\u989d\u5916\u593a\u5f973\u676f\u3002') + '</div></div>', { cls: 'extra-board rank-extra-board' });
    back(p, arena, '\u8fd4\u56de\u7ade\u6280\u573a');
    on(p, 'rank-shop', () => rankShop(0));
    const match = on(p, 'rank-fight', () => {
      if (!p.isConnected || State.state() !== s || rankAttempt) return;
      State.tickEnergy();
      if (s.level < 30) { alert('\u5929\u68af\u8d5b\u9700\u8981\u8fbe\u523030\u7ea7\u3002'); return; }
      if (rankSunday()) { alert('\u5468\u65e5\u5929\u68af\u4f11\u8d5b\uff0c\u8bf7\u5230\u91d1\u676f\u5546\u5e97\u5151\u6362\u5956\u52b1\u3002'); return; }
      if (s.joinRankCount >= 20) { alert('\u4eca\u5929\u5df2\u7ecf\u53c2\u52a020\u573a\uff0c\u660e\u5929\u518d\u6765\u5427\uff01'); return; }
      const fee = s.joinRankCount < 10 ? 0 : 5;
      if (s.goldPoint < fee) { alert('\u7b2c11\u81f320\u573a\u6bcf\u573a\u9700\u89815\u91d1\u677e\u679c\uff0c\u5f53\u524d\u91d1\u677e\u679c\u4e0d\u8db3\u3002'); return; }
      const attempt = { owner: s, date: State.localDate(), fee, settled: false };
      rankAttempt = attempt; s.joinRankCount++; s.goldPoint -= fee; State.save();
      const foe = State.genAI(Math.max(1, s.level + Math.floor(Math.random() * 6) - 3));
      const interrupted = () => {
        if (attempt.settled || rankAttempt !== attempt || State.state() !== s) return;
        attempt.settled = true; rankAttempt = null;
        State.tickEnergy();
        if (State.localDate() === attempt.date) s.joinRankCount = Math.max(0, s.joinRankCount - 1);
        s.goldPoint += attempt.fee; State.save();
        C().toast('\u6bd4\u8d5b\u4e2d\u65ad\uff0c\u672c\u6b21\u53c2\u8d5b\u6b21\u6570\u548c\u8d39\u7528\u5df2\u9000\u8fd8\u3002');
      };
      Main.startBattle(foe, { cost: 0, kind: 'rank', useProps: false, region: 2, onError: interrupted, onEnd: winner => {
        if (attempt.settled || rankAttempt !== attempt || State.state() !== s) return;
        attempt.settled = true; rankAttempt = null;
        const win = winner === 0, delta = win ? 20 + Math.floor(Math.random() * 15) : -(10 + Math.floor(Math.random() * 10));
        const robbed = win && Math.random() < 0.25 ? 3 : 0, cups = (win ? 3 : 1) + robbed;
        s.integral = Math.max(0, s.integral + delta); s.goldCup += cups; State.save();
        rank();   // \u6218\u679c\u5f39\u7a97\u653e\u56de\u5929\u68af\u8d5b\u9875\u4e0a
        outcome(win, { exp: 0, gold: 0, ups: [] }, '\u79ef\u5206 ' + (delta > 0 ? '+' : '') + delta + '\uff0c\u91d1\u676f +' + cups + (robbed ? '\uff08\u542b\u593a\u5f973\u676f\uff09' : '') + '\u3002\u5f53\u524d\u79ef\u5206 ' + s.integral + '\u3002', rank, '\u8fd4\u56de\u5929\u68af\u8d5b');
      } }).catch(interrupted);
    });
    match.disabled = rankSunday() || s.joinRankCount >= 20 || !!rankAttempt;
  }
  function rankShop(pg) {
    const s = State.state();
    if (s.level < 30) { alert('\u5929\u68af\u5546\u5e97\u9700\u8981\u8fbe\u523030\u7ea7\u3002'); return; }
    if (!rankSunday()) { alert('\u91d1\u676f\u5546\u5e97\u6bcf\u5468\u65e5\u5f00\u653e\uff0c\u5468\u4e00\u81f3\u5468\u516d\u53ef\u53c2\u52a0\u5929\u68af\u8d5b\u3002'); return; }
    refreshRankWeek();
    const goods = []; rankgoodsMap.each((id, item) => goods.push(item));
    const total = Math.ceil(goods.length / 6); pg = Math.max(0, Math.min(pg || 0, total - 1));
    const selected = goods.slice(pg * 6, pg * 6 + 6);
    const p = C().page('bag', 'shop', '<div class="extra-shop-balance">\u91d1\u676f ' + s.goldCup + '\u3000\u91d1\u677e\u679c ' + s.goldPoint + '\u3000\u79ef\u5206 ' + s.integral + '</div><div class="extra-shop-grid">' + selected.map(item => '<button class="extra-shop-item" data-goods="' + item.id + '">' + (item.type === '2' ? image('images/classic/icons/gear-' + item.goodsId + '.png', item.name) : C().icon('prop', +item.goodsId)) + '<b>' + esc(item.name) + '</b><span>' + item.cup + '\u91d1\u676f + ' + item.gold + '\u91d1\u677e\u679c</span><small>\u79ef\u5206\u9700 ' + item.integral + (Number(item.timesLimit) > 0 ? ' \u00b7 \u6bcf\u5468\u9650\u5151' + item.timesLimit + '\u6b21' + (s.rankPurchases[item.id] ? '\uff08\u672c\u5468\u5df2\u5151\uff09' : '') : '') + '</small></button>').join('') + '</div><div class="extra-pagination">' + button('\u4e0a\u4e00\u9875', 'rank-shop-prev', 'tiny muted') + '<span>' + (pg + 1) + '/' + total + '</span>' + button('\u4e0b\u4e00\u9875', 'rank-shop-next', 'tiny muted') + '</div>', { cls: 'extra-board extra-cup-shop' });
    back(p, rank, '\u8fd4\u56de\u5929\u68af\u8d5b');
    on(p, 'rank-shop-prev', () => rankShop(Math.max(0, pg - 1)));
    on(p, 'rank-shop-next', () => rankShop(Math.min(total - 1, pg + 1)));
    p.querySelectorAll('[data-goods]').forEach(element => element.onclick = () => {
      const item = rankgoodsMap.getValue(element.dataset.goods);
      let redeemed = false;
      C().modal('\u91d1\u676f\u5151\u6362', '<p>\u5151\u6362\u3010' + esc(item.name) + '\u3011</p><p>' + esc(item.remark) + '</p><p>\u9700\u8981\uff1a' + item.cup + '\u91d1\u676f\u3001' + item.gold + '\u91d1\u677e\u679c\uff0c\u79ef\u5206\u8fbe\u5230' + item.integral + '\u3002</p>', [{ label: '\u786e\u8ba4\u5151\u6362', run: () => {
        if (redeemed || State.state() !== s) return;
        if (!rankSunday()) { alert('\u91d1\u676f\u5546\u5e97\u5df2\u4f11\u606f\uff0c\u8bf7\u4e0b\u5468\u65e5\u518d\u6765\u3002'); return; }
        refreshRankWeek();
        if (s.integral < +item.integral) { alert('\u5929\u68af\u79ef\u5206\u5c1a\u672a\u8fbe\u5230\u5151\u6362\u8981\u6c42\u3002'); return; }
        if (s.goldCup < +item.cup || s.goldPoint < +item.gold) { alert('\u91d1\u676f\u6216\u91d1\u677e\u679c\u4e0d\u8db3\u3002'); return; }
        const bought = s.rankPurchases;
        if (+item.timesLimit > 0 && (bought[item.id] || 0) >= +item.timesLimit) { alert('\u8be5\u5956\u52b1\u672c\u5468\u7684\u5151\u6362\u6b21\u6570\u5df2\u7528\u5b8c\uff0c\u4e0b\u5468\u65e5\u53ef\u518d\u6b21\u5151\u6362\u3002'); return; }
        redeemed = true;
        s.goldCup -= +item.cup; s.goldPoint -= +item.gold;
        if (item.type === '2') State.addGear(+item.goodsId, State.randomExt(2)); else addProp(+item.goodsId, +item.count);
        bought[item.id] = (bought[item.id] || 0) + 1; State.save(); C().toast('\u5151\u6362\u6210\u529f\uff1a' + item.name); rankShop(pg);
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
  // \u6536\u5f92\u4e0a\u9650\u968f\u7b49\u7ea71/2/3\u4eba\uff1b\u6628\u65e5\u65e5\u8d21\u7531\u6301\u4e45\u5316\u7684\u6709\u9650\u79bb\u7ebf\u6218\u6597\u8d26\u76ee\u630910%/5%\u7ed3\u7b97\u3002
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
    const names = {challenge:'\u4e3b\u52a8\u6311\u6218',challenged:'\u88ab\u6311\u6218',stage:'\u5173\u5361',arena:'\u7ecf\u9a8c\u7ade\u6280',pickup:'\u6218\u6597\u62fe\u53d6',lottery:'\u62bd\u5956'};
    const ledger = daily.activities.map(a => {
      const rate = ['challenge','challenged','stage'].includes(a.kind) ? '10%' : a.kind==='arena'&&a.entry==='energy' ? '5%' : '\u4e0d\u8ba1\u65e5\u8d21';
      return '<span>'+names[a.kind]+(a.kind==='arena'?(a.entry==='energy'?'\uff08\u4f53\u529b\uff09':'\uff08\u82f1\u96c4\u5e16\uff09'):'')+' '+a.exp+'\u7ecf\u9a8c \u00b7 '+rate+'</span>';
    }).join('<br>');
    return '<div class="profile-panel">' +
      '<p class="profile-meta">\u5165\u95e8\uff1a'+esc(row.since)+' \u00b7 \u6628\u65e5\u65e5\u8d21\uff1a'+(daily.claimed?'<b class="done">\u5df2\u9886\u53d6</b>':'<b>'+daily.exp+'\u7ecf\u9a8c</b>')+'</p>'+
      '<details class="profile-meta"><summary>'+esc(daily.date)+' \u79bb\u7ebf\u6d3b\u52a8\u8d26\u76ee</summary>'+(ledger||'\u6628\u5929\u5c1a\u65e0\u5165\u95e8\u540e\u7684\u6218\u6597\u6d3b\u52a8\u3002')+'<br>\u6309\u4e24\u7c7b\u6bd4\u4f8b\u5408\u8ba1\u540e\u53d6\u6574\uff1b\u5f92\u5f1f\u7ecf\u9a8c\u4e0d\u51cf\u5c11\u3002</details>'+
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
      (unclaimed ? button('\u9886\u53d6\u6628\u65e5\u65e5\u8d21 +' + dailyTotal, 'master-claim', 'tiny gold') : '<span class="daily-done">\u6682\u65e0\u53ef\u9886\u6628\u65e5\u65e5\u8d21</span>') + '</div>' +
      '<p class="extra-master-tip">\u6628\u65e5\u666e\u901a\u4e0e\u5173\u5361\u7ecf\u9a8c\u768410%\uff0c\u4f53\u529b\u62a5\u540d\u7ecf\u9a8c\u7ade\u6280\u76845%\uff0c\u6b21\u65e5\u53ef\u9886\uff1b\u62fe\u53d6\u3001\u62bd\u5956\u3001\u82f1\u96c4\u5e16\u7ade\u6280\u4e0d\u8ba1\u3002\u6d3b\u52a8\u7531\u672c\u5730\u6709\u9650\u6a21\u62df\uff0c\u8be6\u60c5\u53ef\u5c55\u5f00\u67e5\u770b\u3002</p>' +
      '<div class="apprentice-row">' + (s.prentices.length
        ? s.prentices.map((a, i) => '<div class="candidate-card small' + (apprenticeSel === i ? ' active' : '') + '" data-prentice="' + i + '">' +
            '<b class="candidate-name">' + esc(a.name) + '</b><span class="candidate-level">\u7b49\u7ea7 ' + a.level + '</span>' +
            '<span class="candidate-hp">\u6628\u65e5\u65e5\u8d21 ' + State.apprenticeDailyExp(a) + '</span></div>').join('')
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
      (recruitCandidates[recruitSel] ? button('\u6536\u5f92\u6311\u6218\uff0810\u91d1\u677e\u679c\uff09', 'master-recruit', 'gold') : '') +
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
          if(s.goldPoint<cost){alert('\u91d1\u677e\u679c\u4e0d\u8db320\uff0c\u65e0\u6cd5\u51fa\u5e08\u3002');return;}
          left=true;s.goldPoint-=cost;State.clearMaster();State.save();C().toast('\u5df2\u79bb\u5f00\u5e08\u95e8');master();
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
        State.cancelRecruitChallenge(started.token);C().toast('\u6536\u5f92\u6311\u6218\u4e2d\u65ad\uff0c\u5df2\u9000\u8fd810\u91d1\u677e\u679c\u3002');
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
          master(masterTab);   // \u6218\u679c\u5f39\u7a97\u653e\u56de\u5e08\u5f92\u9875\u4e0a
          outcome(result.win, result, result.msg, () => master('apprentice'), '\u8fd4\u56de\u5e08\u5f92');
        },
      })).catch(interrupted); } catch(error){interrupted();}
    });
  }

  // ---------- \u6392\u884c\u699c\uff08\u539f\u7248 STATE.TOPLIST\uff1b\u5355\u673a\u7528\u56fa\u5b9a\u79cd\u5b50\u6a21\u62df\u699c\u5355\uff09 ----------
  /* \u539f\u7248 loadRankList / LoadRank \u7531\u670d\u52a1\u7aef\u4e0b\u53d1\u771f\u5b9e\u73a9\u5bb6\u699c\uff1b\u5355\u673a\u7248\u7528\u786e\u5b9a\u6027\u968f\u673a
   * \uff08\u6bcf\u5468\u4e00\u4e2a\u79cd\u5b50\uff09\u751f\u6210\u4e00\u6279\u79bb\u7ebf\u677e\u9f20\uff0c\u518d\u628a\u73a9\u5bb6\u63d2\u8fdb\u53bb\uff0c\u56e0\u6b64\u540c\u4e00\u5468\u5185\u699c\u5355\u7a33\u5b9a\u3002 */
  let toplistTab = 'level';
  const TOPLIST_TABS = [['level', '\u7b49\u7ea7'], ['cup', '\u91d1\u676f'], ['integral', '\u79ef\u5206']];
  const TOPLIST_TITLES = ['\u677e\u9f20\u5c0f\u9738', '\u68ee\u6797\u4e00\u9738', '\u98ce\u901f\u4f20\u5947', '\u575a\u679c\u5927\u738b',
    '\u677e\u9f20\u5c0f\u9738\u4e8c\u4e16', '\u68a6\u5e7b\u6a61\u5b50', '\u91d1\u677e\u679c\u5b88\u62a4\u8005', '\u6708\u5149\u98de\u9f20',
    '\u96fe\u6797\u730e\u624b', '\u96ea\u539f\u65c5\u4eba', '\u53e4\u6811\u5b88\u671b\u8005', '\u661f\u8fb0\u4e4b\u5f71'];
  // \u6ce8\u610f\uff1a\u539f\u7248 Map.min.js \u4f1a\u8986\u76d6\u5168\u5c40 Map\uff08window.Map\uff09\uff0c\u6240\u4ee5\u8fd9\u91cc\u4e0d\u80fd\u7528 new Map()\u3002
  let toplistCache = Object.create(null);
  function rankWeekSeed() {
    const d = new Date(Date.now());
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function toplistRows() {
    const s = State.state(), seed = rankWeekSeed(), key = seed + ':' + s.level + ':' + s.goldCup + ':' + (s.integral || 0);
    if (toplistCache[key]) return toplistCache[key];
    const rnd = mulberry(seed);
    const rows = [];
    for (let i = 0; i < 14; i++) {
      const lv = Math.max(5, Math.min(70, Math.round(s.level + (rnd() * 26 - 12))));
      rows.push({
        name: TOPLIST_TITLES[i % TOPLIST_TITLES.length],
        level: lv,
        cup: 2 + Math.floor(rnd() * Math.max(6, lv)),
        integral: 900 + Math.floor(rnd() * Math.max(400, lv * 70)),
        npc: true,
      });
    }
    rows.push({ name: s.name, level: s.level, cup: s.goldCup || 0, integral: s.integral || 0, npc: false });
    const sortKey = toplistTab === 'cup' ? 'cup' : toplistTab === 'integral' ? 'integral' : 'level';
    rows.sort((a, b) => (b[sortKey] - a[sortKey]) || a.name.localeCompare(b.name));
    toplistCache[key] = rows;
    return rows;
  }
  function toplist() {
    State.tickEnergy();
    const s = State.state();
    const key = toplistTab === 'cup' ? 'cup' : toplistTab === 'integral' ? 'integral' : 'level';
    const rows = toplistRows();
    const mine = rows.findIndex((r) => !r.npc) + 1;
    const header = '<div class="toplist-head"><span class="toplist-me">\u6211\u7684\u540d\u6b21\uff1a<b>' + mine + '</b> / ' + rows.length +
      '</span><span class="toplist-week">\u6bcf\u5468\u4e00\u91cd\u7f6e\u00b7\u79bb\u7ebf\u6a21\u62df</span></div>';
    const tabs = '<div class="master-tabs toplist-tabs">' + TOPLIST_TABS.map(([id, label]) =>
      '<button class="uc-tab ' + (id === toplistTab ? 'active' : '') + '" data-action="' + id + '" aria-current="' + (id === toplistTab ? 'page' : 'false') + '">' + label + '</button>').join('') + '</div>';
    const list = '<div class="toplist-rows">' + rows.slice(0, 15).map((r, i) => {
      const rank = i + 1, medal = rank <= 3 ? '\u2460\u2461\u2462'[rank - 1] : String(rank);
      return '<div class="toplist-row' + (r.npc ? '' : ' me') + '"><span class="toplist-rank">' + medal + '</span>' +
        '<span class="toplist-name">' + esc(r.name) + (r.npc ? '' : '\uff08\u6211\uff09') + '</span>' +
        '<span class="toplist-lv">Lv ' + r.level + '</span>' +
        '<span class="toplist-cup">' + r.cup + ' \u91d1\u676f</span>' +
        '<span class="toplist-score">' + r.integral + '</span></div>';
    }).join('') + '</div>';
    const foot = '<div class="extra-note">\u6392\u884c\u699c\u4e3a\u5355\u673a\u79bb\u7ebf\u6a21\u62df\uff1a\u5bf9\u624b\u540d\u5355\u6bcf\u5468\u56fa\u5b9a\uff0c\u4e0d\u8fde\u63a5\u771f\u5b9e\u73a9\u5bb6\u3002\u5f53\u524d\u6392\u5e8f\uff1a' +
      (key === 'cup' ? '\u91d1\u676f' : key === 'integral' ? '\u5929\u68af\u79ef\u5206' : '\u7b49\u7ea7') + '\u3002</div>';
    const p = C().page('message', 'toplist', header + tabs + list + foot, { cls: 'extra-board toplist-board' });
    on(p, 'level', () => { toplistTab = 'level'; toplistCache = Object.create(null); toplist(); });
    on(p, 'cup', () => { toplistTab = 'cup'; toplistCache = Object.create(null); toplist(); });
    on(p, 'integral', () => { toplistTab = 'integral'; toplistCache = Object.create(null); toplist(); });
  }

  // ---------- \u8d85\u7ea7\u677e\u9f20\uff08\u539f\u7248 VIP\uff1b\u6539\u6210\u91d1\u677e\u679c\u8d2d\u4e70\u7684\u5355\u673a\u7248\uff09 ----------
  /* \u7279\u6743\u6587\u6848\u4e0e\u7b49\u7ea7\u8868\u53d6\u81ea\u539f\u5ba2\u6237\u7aef js/ssdz-pkg2.js \u7684 VIP \u754c\u9762\u5185\u5d4c\u6587\u672c\uff0c
   * \u539f\u7248\u6309\u5929\u552e\u5356\uff08buyVIP.do\uff09\uff0c\u8fd9\u91cc\u6539\u6210\u91d1\u677e\u679c\u3002 */
  const VIP_PRIVILEGES = [
    '\u89d2\u8272\u7b49\u7ea710\u7ea7\u4ee5\u4e0a\u7684VIP\u53ef\u4ee5\u8df3\u8fc7\u6218\u6597\uff08\u53ef\u81ea\u52a8\u83b7\u5f97\u70b9\u51fb\u7c7b\u9053\u5177\uff09',
    '\u88ab\u52a8\u7ecf\u9a8c\u4e0a\u9650\u5927\u5e45\u63d0\u9ad8\uff0c\u6700\u9ad8\u53ef\u8fbe400\u7ecf\u9a8c/\u5929',
    '\u4f53\u529b\u6062\u590d\u901f\u5ea6\u5927\u5e45\u52a0\u5feb\uff0c\u6700\u5feb\u53ef\u8fbe1.5\u500d',
    '\u6635\u79f0\u4ee5\u5c0a\u8d35\u6807\u8bc6\u5c55\u793a\uff0c\u5f70\u663e\u8eab\u4efd',
    '\u9996\u6b21\u5f00\u901a\uff0c\u6c38\u4e45\u8d60\u90016\u4e2a\u88c5\u5907\u683c\u5b50',
    '\u5e08\u5085\u5982\u679c\u662fVIP\uff0c\u5f92\u5f1f\u6bcf\u5929\u767b\u9646\u5c06\u989d\u5916\u83b7\u5f975-15\u4e2a\u91d1\u677e\u679c',
    '\u4e3b\u52a8\u6311\u6218VIP\u73a9\u5bb6\u6240\u5f97\u7ecf\u9a8c\u4e0a\u6da830%',
    '\u4f53\u529b\u4e0a\u9650\u589e\u52a0\u5230180\u70b9',
  ];
  function vip() {
    State.tickEnergy();
    const s = State.state();
    const active = State.vipActive(), level = State.vipLevel();
    const days = State.vipDaysLeft(), mul = State.vipRegenMul();
    const need = active ? State.vipExpNeed() : 0;
    const status = active
      ? '<div class="vip-status on"><span class="vip-crown">\u2605</span><div><h2>\u8d85\u7ea7\u677e\u9f20 Lv ' + level + '</h2>' +
        '<p>\u5269\u4f59 ' + days + ' \u5929\u3000\u4f53\u529b\u6062\u590d ' + mul.toFixed(1) + ' \u500d\u3000\u4f53\u529b\u4e0a\u9650 ' + State.VIP_ENERGY_CAP + '\u3000\u88c5\u5907\u683c\u5b50 +' + State.VIP_GEAR_BONUS + '</p>' +
        '<p class="vip-exp">\u5347\u7ea7\u7ecf\u9a8c ' + s.vip.exp + ' / ' + need + '\uff08\u6bcf\u65e5\u9996\u6b21\u767b\u9646 +1\uff09</p></div></div>'
      : '<div class="vip-status off"><span class="vip-crown muted">\u2606</span><div><h2>\u5c1a\u672a\u5f00\u901a\u8d85\u7ea7\u677e\u9f20</h2>' +
        '<p>\u5f00\u901a\u540e\u7acb\u5373\u751f\u6548\uff0c\u5230\u671f\u540e\u7b49\u7ea7\u4e0e\u7ecf\u9a8c\u4fdd\u7559\uff0c\u518d\u6b21\u8d2d\u4e70\u5373\u53ef\u7ee7\u7eed\u4eab\u53d7\u3002</p></div></div>';
    const priv = '<div class="vip-priv"><h3>\u7279\u6743</h3><ol>' + VIP_PRIVILEGES.map((t) => '<li>' + t + '</li>').join('') + '</ol></div>';
    const table = '<div class="vip-table"><h3>\u6210\u957f\u4f53\u7cfb</h3><table><thead><tr><th>\u7b49\u7ea7</th><th>\u88ab\u52a8\u7ecf\u9a8c\u4e0a\u9650</th><th>\u4f53\u529b\u6062\u590d</th></tr></thead><tbody>' +
      State.VIP_LEVELS.map(([lv, cap, m], i) => '<tr class="' + (active && i + 1 === level ? 'me' : '') + '"><td>' + lv + '</td><td>' + cap + '</td><td>' + Number(m).toFixed(1) + ' \u500d</td></tr>').join('') +
      '</tbody></table><p class="small-label">\u6210\u4e3a\u8d85\u7ea7\u677e\u9f20\u540e\uff0c\u6bcf\u65e5\u9996\u6b21\u767b\u9646\u5373\u53ef\u83b7\u5f971\u70b9\u7ecf\u9a8c\uff0c\u7d2f\u79ef\u7ecf\u9a8c\u81ea\u52a8\u63d0\u5347\u7b49\u7ea7\u3002</p></div>';
    const plans = '<div class="vip-plans">' + State.VIP_PLANS.map((p) =>
      '<button class="vip-plan" data-action="buy' + p.days + '"><b>' + p.days + ' \u5929</b><span>' + p.gold + ' \u91d1\u677e\u679c</span></button>').join('') +
      '</div><div class="extra-note">\u539f\u7248\u6309\u5929\u552e\u5356\uff08buyVIP.do\uff09\uff1b\u5355\u673a\u7248\u6539\u4e3a\u91d1\u677e\u679c\u8d2d\u4e70\uff0c\u4ef7\u683c\u4e3a\u672c\u9879\u76ee\u7ecf\u6d4e\u7684\u5e73\u8861\u503c\u3002\u73b0\u6709\u91d1\u677e\u679c ' + s.goldPoint + ' \u4e2a\u3002</div>';
    const p = C().page('system', 'vip', status + plans + priv + table, { cls: 'extra-board vip-board' });
    for (const plan of State.VIP_PLANS) {
      on(p, 'buy' + plan.days, () => {
        const r = State.buyVip(plan.days);
        C().toast(r.msg);
        if (r.ok) vip();
      });
    }
  }

  window.ClassicExtras = { arena, rank, rankShop: () => rankShop(0), lottery, master, toplist, vip, lotteryPrizes: prizes };
})();
