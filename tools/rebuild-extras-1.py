"""Rebuild js/classic-extras.js after an encoding accident.

The module's Chinese string literals were destroyed by mojibake. This script
rewrites the whole file from the surviving JS structure. Every Chinese
character is emitted as a \\uXXXX escape and the file is written as UTF-8
bytes, so no shell/console codepage can corrupt it again.
"""
import io

CHUNKS = []          # 每项是一段 JS 源码（可含中文，写文件时自动转义）

def add(src):
    CHUNKS.append(src)

def _esc(src):
    """把非 ASCII 字符转成 \\uXXXX 转义，保证输出文件是纯 ASCII 源码。"""
    out = []
    for ch in src:
        out.append('\\u%04x' % ord(ch) if ord(ch) > 127 else ch)
    return ''.join(out)

# ---------------------------------------------------------------- 头部与工具
add(r"""/* Additional classic UC screens. All progression stays in the current State save. */
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
    if (element) element.textContent = label || '返回';
  }
  function alert(text) { C().modal('提示', '<p>' + esc(text) + '</p>', [{ label: '知道了' }], { small: true }); }
  function addProp(id, count) { const s = State.state(); s.props[id] = (s.props[id] || 0) + count; }
  function outcome(win, reward, text, again, label) {
    C().modal('战斗结果', '<div class="extra-result"><strong class="cartoon">' + (win ? '胜利！' : '再接再厉') + '</strong><p>' + esc(text) + '</p><div>经验 +' + reward.exp + '　金松果 +' + (reward.gold || 0) + '</div>' + C().upsHtml(reward.ups) + '</div>', [{ label: label || '返回', run: again }, { label: '查看录像', cls: 'gold', run: () => UI.runAction('messages') }]);
  }
""")

# ---------------------------------------------------------------- 竞技场
add(r"""
  let arenaRun = null;
  function arena() {
    State.tickEnergy();
    const s = State.state();
    if (arenaRun && arenaRun.owner !== s) arenaRun = null;
    // Returning to this page after an interrupted player may resume the paid round.
    if (arenaRun) arenaRun.busy = false;
    const cards = [
      { art: 28, name: '经验竞技场', text: '冠军经验 +150，金松果 +10', action: 'arena-exp' },
      { art: 29, name: '碎片竞技场', text: '冠军蓝色碎片 ×8，经验 +30', action: 'arena-fragment' },
      { art: 30, name: '天梯赛', text: '30级开启，赢积分、争金杯', action: 'arena-rank' },
    ];
    const p = C().page('challenge', 'arena', '<div class="extra-arena-cards">' + cards.map(card => '<article>' + sprite(card.art) + '<h2>' + card.name + '</h2><p>' + card.text + '</p>' + button(card.name === '天梯赛' ? '进入天梯' : '参加比赛', card.action, 'small gold') + '</article>').join('') + '</div><div class="extra-arena-cost">4人淘汰赛，每次报名消耗30体力。英雄帖或勇气徽章可抵扣。<br>体力 ' + s.energy + '/' + s.maxEnergy + '　英雄帖 ' + (s.props[36] || 0) + '　勇气徽章 ' + (s.props[39] || 0) + '</div>' + (arenaRun ? '<div class="extra-resume">你已报名，无需再次消耗体力。' + button(arenaRun.phase === 'final' ? '继续决赛' : '继续比赛', 'arena-resume', 'tiny gold') + '</div>' : ''), { cls: 'extra-board arena-extra-board' });
    on(p, 'arena-exp', () => confirmArena(0));
    on(p, 'arena-fragment', () => confirmArena(1));
    on(p, 'arena-rank', rank);
    on(p, 'arena-resume', () => fightArena(arenaRun));
  }
  function confirmArena(kind) {
    if (arenaRun && arenaRun.owner === State.state()) {
      fightArena(arenaRun); return;
    }
    C().modal('竞技场报名', '<p>' + (kind ? '碎片竞技场' : '经验竞技场') + '：先赢半决赛，再争夺冠军。</p><p>报名一次消耗30体力，决赛不再扣除。体力不足时使用1张英雄帖或勇气徽章。</p>' + note('离线对手由本地生成。竞技场不使用挑战药剂效果。'), [{ label: '报名参赛', run: () => {
      if (arenaRun) return;
      const s = State.state(); State.tickEnergy();
      if (s.energy >= 30) { if (!State.consumeEnergy(30)) return; }
      else {
        const preferred = kind ? 39 : 36, alternate = kind ? 36 : 39;
        const ticket = s.props[preferred] > 0 ? preferred : s.props[alternate] > 0 ? alternate : 0;
        if (!ticket) { alert('体力不足30点，也没有英雄帖或勇气徽章。'); return; }
        s.props[ticket]--; State.save();
      }
      const foes = [State.genAI(s.level), State.genAI(s.level), State.genAI(s.level)];
      const other = Sim.simulate(foes[1], foes[2]);
      arenaRun = { owner: s, kind, phase: 'semi', foe: foes[0], finalist: foes[other.winner === 0 ? 1 : 2], busy: false, settled: false };
      fightArena(arenaRun);
    } }, { label: '返回', cls: 'muted' }], { small: true });
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
        C().modal('晋级决赛', '<div class="extra-finalist">' + image('images/classic/squirrel-classic.png', '决赛对手') + '<div><h3>半决赛获胜！</h3><p>决赛对手：' + esc(run.finalist.name) + '<br>等级 ' + run.finalist.level + '</p></div></div>' + note('本次决赛无需再消耗体力。关闭后可回竞技场继续。'), [{ label: '开始决赛', run: () => fightArena(run) }, { label: '稍后继续', cls: 'muted', run: arena }]);
        return;
      }
      run.settled = true; arenaRun = null;
      const s = State.state(), win = final && winner === 0;
      let exp = final ? win ? run.kind ? 30 : 150 : 75 : 10;
      const gold = win && !run.kind ? 10 : 0;
      // 碎片场：第 3 名 4 个、第 4 名 3 个碎片；冠军 8 个（参考 reference.md）
      let shards = 0;
      if (run.kind) shards = win ? 8 : final ? 6 : (winner === 2 ? 4 : 3);
      if (shards) addProp(26, shards);
      s.goldPoint += gold;
      const ups = State.gainExp(exp); State.save();
      const shardText = shards ? '蓝色碎片 ×' + shards + ' 已放入背包。' : '';
      outcome(win, { exp, gold, ups }, (win ? (run.kind ? '获得冠军！' : '获得冠军！继续向更强的对手挑战。') : final ? '获得亚军，奖励75经验。' : '止步半决赛，获得10点参与经验。') + shardText, arena, '返回竞技场');
    } }).catch(() => { run.busy = false; C().toast('比赛暂时中断，可回竞技场继续。'); });
  }
""")

# ---------------------------------------------------------------- 天梯
add(r"""
  let rankBusy = false;
  function rank() {
    rankBusy = false;
    const s = State.state(); State.tickEnergy();
    if (s.level < 30) {
      C().modal('天梯赛', '<div class="extra-finalist">' + sprite(30) + '<div><h3>30级开启天梯赛</h3><p>当前等级：' + s.level + '<br>先去挑战积累经验吧！</p></div></div>', [{ label: '去挑战', run: () => UI.runAction('challenge') }, { label: '返回竞技场', cls: 'muted', run: arena }]); return;
    }
    if (s.integral == null) { s.integral = 1500; State.save(); }
    const entries = [0, 1, 2, 3, 4, 5].map((n) => ({ name: GData.AI_NAMES[n * 4], points: 1350 + n * 83 }));
    entries.push({ name: s.name, points: s.integral, mine: true }); entries.sort((a, b) => b.points - a.points);
    const p = C().page('challenge', 'arena', '<div class="extra-rank-layout"><div class="extra-rank-self">' + sprite(30) + '<h2>天梯赛</h2><div class="extra-score">积分 <b>' + s.integral + '</b></div><div class="extra-score">金杯 <b>' + s.goldCup + '</b></div><p>今日已参赛 ' + s.joinRankCount + ' 场</p>' + button('开始匹配', 'rank-fight', 'small gold') + button('金杯商店', 'rank-shop', 'small') + '</div><div class="extra-rank-list"><h3>本地模拟排行榜</h3>' + entries.map((entry, i) => '<div class="extra-rank-row ' + (entry.mine ? 'mine' : '') + '"><span>' + (i + 1) + '</span><b>' + esc(entry.name) + (entry.mine ? '（你）' : '') + '</b><strong>' + entry.points + '</strong></div>').join('') + note('离线模拟比赛与排名，不连接原版服务器。胜利得5金杯，落败得1金杯。') + '</div></div>', { cls: 'extra-board rank-extra-board' });
    back(p, arena, '返回竞技场');
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
        outcome(win, { exp, gold: 0, ups }, '积分 ' + (delta > 0 ? '+' : '') + delta + '，金杯 +' + (win ? 5 : 1) + '。当前积分 ' + s.integral + '。', rank, '返回天梯赛');
      } }).catch(() => { rankBusy = false; C().toast('匹配暂时中断，请稍后重试。'); });
    });
  }
  function rankShop(pg) {
    const s = State.state(), goods = []; rankgoodsMap.each((id, item) => goods.push(item));
    const total = Math.ceil(goods.length / 6); pg = Math.max(0, Math.min(pg || 0, total - 1));
    const selected = goods.slice(pg * 6, pg * 6 + 6);
    const p = C().page('bag', 'shop', '<div class="extra-shop-balance">金杯 ' + s.goldCup + '　金松果 ' + s.goldPoint + '　积分 ' + s.integral + '</div><div class="extra-shop-grid">' + selected.map(item => '<button class="extra-shop-item" data-goods="' + item.id + '">' + (item.type === '2' ? image('images/classic/icons/gear-' + item.goodsId + '.png', item.name) : C().icon('prop', +item.goodsId)) + '<b>' + esc(item.name) + '</b><span>' + item.cup + '金杯 + ' + item.gold + '金松果</span><small>积分需 ' + item.integral + (Number(item.timesLimit) > 0 ? ' · 限兑1次' : '') + '</small></button>').join('') + '</div><div class="extra-pagination">' + button('上一页', 'rank-shop-prev', 'tiny muted') + '<span>' + (pg + 1) + '/' + total + '</span>' + button('下一页', 'rank-shop-next', 'tiny muted') + '</div>', { cls: 'extra-board extra-cup-shop' });
    back(p, rank, '返回天梯赛');
    on(p, 'rank-shop-prev', () => rankShop(Math.max(0, pg - 1)));
    on(p, 'rank-shop-next', () => rankShop(Math.min(total - 1, pg + 1)));
    p.querySelectorAll('[data-goods]').forEach(element => element.onclick = () => {
      const item = rankgoodsMap.getValue(element.dataset.goods);
      C().modal('金杯兑换', '<p>兑换【' + esc(item.name) + '】</p><p>' + esc(item.remark) + '</p><p>需要：' + item.cup + '金杯、' + item.gold + '金松果，积分达到' + item.integral + '。</p>', [{ label: '确认兑换', run: () => {
        if (s.integral < +item.integral) { alert('天梯积分尚未达到兑换要求。'); return; }
        if (s.goldCup < +item.cup || s.goldPoint < +item.gold) { alert('金杯或金松果不足。'); return; }
        const bought = s.rankPurchases || {};
        if (+item.timesLimit > 0 && (bought[item.id] || 0) >= +item.timesLimit) { alert('该奖励在当前存档中的兑换次数已用完。'); return; }
        s.goldCup -= +item.cup; s.goldPoint -= +item.gold;
        if (item.type === '2') State.addGear(+item.goodsId, State.randomExt(2)); else addProp(+item.goodsId, +item.count);
        bought[item.id] = (bought[item.id] || 0) + 1; s.rankPurchases = bought; State.save(); C().toast('兑换成功：' + item.name); rankShop(pg);
      } }, { label: '返回', cls: 'muted' }], { small: true });
    });
  }
""")

# ---------------------------------------------------------------- 抽奖
add(r"""
  const prizes = [
    { id: 22, count: 10, label: '武器卷轴 ×10' }, { id: 21, count: 10, label: '技能卷轴 ×10' },
    { id: 26, count: 3, label: '蓝色碎片 ×3' }, { id: 15, exp: 50, label: '经验 +50' },
    { id: 15, exp: 100, label: '经验 +100' }, { id: 8, gold: 30, label: '金松果 +30' },
    { id: 23, count: 2, label: '挑战书 ×2' }, { id: 2, count: 2, label: '大体力药剂 ×2' },
    { id: 45, count: 2, label: '天使果实种子 ×2' }, { id: 36, count: 2, label: '英雄帖 ×2' },
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
    const p = C().page('bag', 'bag', '<h2 class="extra-lottery-heading cartoon">每日幸运抽奖</h2><div class="extra-lottery-prizes">' + prizes.map((prize, i) => '<div class="extra-prize" data-prize="' + i + '">' + C().icon('prop', prize.id) + '<span>' + prize.label + '</span></div>').join('') + '</div><div class="extra-lottery-footer"><div><b data-lottery-status>今日免费 ' + s.lotteryFree + ' 次</b><span>每天免费1次，之后每次20金松果<br>当前金松果：<strong data-lottery-gold>' + s.goldPoint + '</strong></span></div>' + button(spinning ? '抽奖中…' : s.lotteryFree > 0 ? '免费抽奖' : '再抽一次', 'lottery-spin', 'gold') + '</div>', { cls: 'extra-board lottery-extra-board' });
    back(p, () => UI.runAction('bag'), '返回道具');
    const spin = on(p, 'lottery-spin', () => {
      if (version !== lotteryVersion || !p.isConnected || spinning) return;
      refreshLotteryDay();
      if (s.lotteryFree < 1 && s.goldPoint < 20) { alert('金松果不足20，明天还有一次免费机会。'); return; }
      spinning = true; spin.disabled = true; spin.textContent = '抽奖中…';
      if (s.lotteryFree > 0) s.lotteryFree--; else s.goldPoint -= 20;
      // 一次点击立即、原子地结算。离开动画页或刷新页面不会漏奖或多发奖励。
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
        spinning = false; spin.disabled = false; spin.textContent = '再抽一次';
        find(p, '[data-lottery-status]').textContent = '今日免费 ' + s.lotteryFree + ' 次';
        find(p, '[data-lottery-gold]').textContent = s.goldPoint;
        C().modal('获得奖励', '<div class="extra-lottery-win">' + C().icon('prop', prize.id) + '<strong>' + prize.label + '</strong></div>' + C().upsHtml(ups), [{ label: '确定' }], { small: true });
      }
      animate();
    });
    spin.disabled = spinning;
  }
""")

with io.open('js/classic-extras.js', 'w', encoding='utf-8', newline='\n') as f:
    f.write(_esc(''.join(CHUNKS)))
print('part 1 written; bytes:', len(_esc(''.join(CHUNKS))))
