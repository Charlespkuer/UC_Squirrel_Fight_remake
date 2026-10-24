/* Additional classic UC screens. All progression stays in the current State save. */

/* ------------------------------------------------------------
 * 目录：经典 UC 扩展界面（竞技场/天梯/抽奖/师徒/排行/VIP）
 * Ctrl+F 搜节号（如「【EX1】」）直达对应代码块。
 *
 *  【EX1】竞技场  【EX2】天梯赛  【EX3】抽奖
 *  【EX4】师徒系统  【EX5】排行榜  【EX6】超级松鼠
 *  【EX7】导出 window.ClassicExtras
 * ------------------------------------------------------------ */
(function () {
  'use strict';
  const C = () => UI.classic;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const find = (root, selector) => root.querySelector(selector);
  const image = (src, alt, cls) => '<img class="' + (cls || '') + '" src="' + src + '" alt="' + esc(alt) + '">';
  const sprite = (id) => image('images/ui/sprites/resource_6-' + id + '.png', '', 'extra-arena-picture');
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
  function alert(text) { C().modal('\u63d0\u793a', '<p>' + esc(text) + '</p>', [{ label: '\u786e\u5b9a' }], { small: true }); }

  /* ============================================================
   * 【EX0】村庄「征战」→ 挑战塔 / 无尽塔 二选一
   * ------------------------------------------------------------
   * ⚠ 这一页（`campaign()`，整页现代外壳）**已经撤掉**：用户 2026-10 口径
   *   "点开村庄的征战界面时，单独做一个挑战塔与无尽塔的界面，不要套用现代 ui 的背景等，
   *    就做一个小的弹出界面即可，两个模式的 ui 就用现代版的 ui 即可。"
   * 现在是 `js/classic-ui.js` 的 `villageWar()` 在**经典村庄页上盖一个小弹窗**
   * （复刻经典 UI 的 `.classic-modal`），两颗键直接调 `TowerUI.openTower()` /
   * `openEndless()` —— 就是现代版关卡页那两颗入口进去的界面。
   * 原版的「征战」本身是**四人组队 + 服务端开房**的玩法（`joinCopy.do` / `rollDatas` 掷骰分赃，
   * 见 docs/更新记录.md 第一百五十六批的取证结论）：界面元件「征战」在导出里没有 spriteId、
   * "四人同时在线"在离线单机里也没有对应物，所以那一套不做（也不该占着这个入口）。
   * ============================================================ */
  // \u56db\u540d\u5956\u52b1\uff08\u51a0/\u4e9a/\u5b63/\u7b2c\u56db\uff09\u3002\u788e\u7247\u573a\u53ea\u7ed9\u788e\u7247\uff0c\u4e0d\u53d1\u7ecf\u9a8c\u3002
  /* ============================================================
   * 【EX1】竞技场（门票/战斗/结算）
   * ============================================================ */
  const ARENA_EXP = [150, 100, 50, 30];
  /* 幻兽竞技场（原版 arenaType==2）：名次奖励是孵化点 40/35/30/25，
   * 入场券是召唤证（82），15 级开放。 */
  const ARENA_HATCH = [40, 35, 30, 25];
  /* 碎片竞技场的名次奖励（冠/亚/季/第四，按 4 人两轮结算）——**专属产出，不受
   * GData.BLUE_SHARD_DROP_MUL 影响**（2026-10 用户口径：除碎片竞技场外所有蓝色碎片掉落才降期望）。
   * 它没动，由 tools/test-extras.cjs 的「四名依次 8/6/4/3」用例守着。 */
  const ARENA_FRAGMENT_SHARDS = [8, 6, 4, 3];
  function addProp(id, count) { const s = State.state(); s.props[id] = (s.props[id] || 0) + count; }
  function originalResult(spec) {
    if (!window.SfFightResult || !UI.currentUiMode || UI.currentUiMode() !== 'classic') return false;
    SfFightResult.open(spec).catch(error => { if (C().toast) C().toast('战果界面加载失败：' + error.message); });
    return true;
  }
  function outcome(win, reward, text, again, label, extra, display) {
    const buttons = (extra || []).concat([
      { label: '\u67e5\u770b\u5f55\u50cf', muted: true, run: () => UI.runAction('messages') },
      { label: label || '\u8fd4\u56de', primary: true, run: again },
    ]);
    if (originalResult({ kind: display && display.kind || 'result', title: display && display.title || '战斗结果', win,
      exp: reward.exp, gold: reward.gold || 0, ups: reward.ups, note: text,
      text: text + '\n经验 +' + reward.exp + '　金松果 +' + (reward.gold || 0) + '\n' + C().upsHtml(reward.ups), actions: buttons })) return;
    C().modal('\u6218\u6597\u7ed3\u679c', '<div class="extra-result"><strong class="cartoon">' + (win ? '\u80dc\u5229\uff01' : '\u518d\u63a5\u518d\u5389') + '</strong><p>' + esc(text) + '</p><div>\u7ecf\u9a8c +' + reward.exp + '\u3000\u91d1\u677e\u679c +' + (reward.gold || 0) + '</div>' + C().upsHtml(reward.ups) + '</div>', buttons);
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
      if ([0, 1, 2].includes(saved.kind) && ['semi', 'final', 'third'].includes(saved.phase) && saved.foe && saved.finalist && saved.consolation) {
        arenaRun = Object.assign({}, saved, { owner: s, busy: false, settled: false });
      } else { s.classicArenaRun = null; State.save(); }
    }
    return arenaRun;
  }
  /** 把"打了一半"的 `busy` 抹掉。`ui-challenge` 回到赛事页时调它 —— 否则刷新 / 关掉页面之后
   *  存档里一直留着 `busy: true`，挑战页那一层永远被判成"战斗中"，再也画不出来（满屏墨绿）。 */
  function clearArenaBusy() {
    if (arenaRun && arenaRun.busy) arenaRun.busy = false;
    return !!arenaRun;
  }
  /** 体力药提示：优先用游戏内全局 toast（和别处一致），拿不到就退回弹窗，保证一定看得见。 */
  function showHint(msg) {
    try {
      if (typeof toast === 'function') { toast(msg); return; }
      if (typeof window !== 'undefined' && window.C && C().toast) C().toast(msg);
    } catch (_) {}
  }
  /** 原版 `gainRankCup()`：天梯榜「领取奖励」直接发 50 个金杯（前100名），
   * 服务器按赛季判定；本地按「本周」记一次，防止重复领取。 */
  function claimRankCup() {
    const s = State.state();
    if (s.integral == null) s.integral = 1500;
    const cap = State.MAX_PLAYER_LEVEL || 90;
    const mine = Math.max(0, Math.round(Number(s.integral) || 0));
    const entries = [];
    for (let n = 0; n < 4; n++) {
      const name = (window.GData && GData.AI_NAMES && GData.AI_NAMES[n * 4]) || ('鼠王' + (n + 1));
      entries.push({ name, points: 1350 + n * 83, level: Math.min(cap, 34 + n * 6) });
    }
    entries.push({ name: s.name || '我', points: mine, level: Math.round(Number(s.level) || 1), mine: true });
    entries.sort((a, b) => b.points - a.points);
    const rank = entries.findIndex((e) => e.mine) + 1;
    const week = rankWeekKey();
    if (s.rankCupClaimWeek === week) {
      return { ok: false, already: true, rank, cups: 0, goldCup: s.goldCup, msg: '本周的天梯奖励已经领取过了。' };
    }
    if (!(rank > 0 && rank <= 100)) {
      return { ok: false, already: false, rank, cups: 0, goldCup: s.goldCup, msg: '本赛季没有进入前100名，暂时没有金杯奖励。' };
    }
    s.goldCup = Math.max(0, Number(s.goldCup) || 0) + 50;
    s.rankCupClaimWeek = week;
    State.save();
    return { ok: true, already: false, rank, cups: 50, goldCup: s.goldCup, msg: '恭喜进入前100名，成功获得50个金杯奖励！' };
  }

  /** 竞技场战果落点：挑战页 7638 第 4 帧（有「开始竞技」的那一页），不是第 6 帧首屏。
   *  用户 2026-10 口径：竞技胜利后要回到有开始竞技的页面，而不是竞技场主界面。 */
  function arenaRules() {
    /* 只有经典界面才把这一页交回原版挑战页；现代界面的竞技场是下面这套 DOM 页，
     * 以前无条件走 SfChallenge 会把玩家带到「挑战」页（用户 2026-10 报的“竞技打不开”）。 */
    if (UI.currentUiMode && UI.currentUiMode() === 'classic' && window.SfChallenge && SfChallenge.goArenaPage) {
      SfChallenge.goArenaPage('rules'); return;
    }
    arena();
  }
  /** 「报名参赛」——经典模式竞技场那一页的「开始比赛」走的就是它（见 ui-challenge 的
   *  `showArenaRules`）。原版那一下是 `joinArena.do` 开房 → 服务端回 `showRacing2` 落赛事页；
   * 复刻没有服务端，所以在这里**本地抽三个对手 + 定赛事局面**，再交给 `fightArena` 打第一场。
   * ⚠ 一定要把这一颗暴露出去：规则页的键以前接的是 `arena()`（= 回竞技场首屏），
   *   于是"点开始竞技就退回上一页"（用户 2026-10 报的）。 */
  function startArenaCompete(kind) {
    const existing = activeArenaRun();
    if (existing) { resumeArena(existing); return; }
    confirmArena(kind || 0);
  }
  /** 竞技场选择弹窗的关闭键：用背包道具详情里那颗原版「取消」键（4419）。
   *  4419 是原版按钮自己的自然比例，米色常态 / 第 2 帧绿色悬停，文字也足够大，
   *  不需要再把 3911 拉成窄高比例。挂载失败才退回金色文字键（仅兜底）。 */
  function mountArenaCancel(m, onCancel) {
    const footer = find(m.element, '.modal-buttons');
    if (!footer) return;
    const host = document.createElement('div');
    host.className = 'arena-original-back';
    host.style.visibility = 'hidden';
    footer.appendChild(host);
    const fallback = () => {
      if (!footer.isConnected) return;
      if (host.parentNode) host.remove();
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'uc-button gold'; b.textContent = '取消';
      b.onclick = onCancel; footer.appendChild(b);
    };
    const mount = () => {
      if (!window.SfRender || !SfRender.mountSymbol) { fallback(); return; }
      SfRender.mountSymbol(host, '4419', { frame: 1, label: '取消' }).then((view) => {
        if (!footer.isConnected || !view || !view.g) {
          if (view) { try { view.destroy(); } catch (e) {} }
          fallback();
          return;
        }
        let box = null;
        try { box = view.g.getBBox(); } catch (e) { box = null; }
        if (!box || !(box.width > 0) || !(box.height > 0)) {
          try { view.destroy(); } catch (e) {}
          fallback();
          return;
        }
        view.g.setAttribute('viewBox', box.x + ' ' + box.y + ' ' + box.width + ' ' + box.height);
        view.g.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        view.g.style.width = '100%'; view.g.style.height = '100%';
        view.g.style.pointerEvents = 'auto'; view.g.style.cursor = 'pointer';
        view.g.style.outline = 'none';
        view.g.setAttribute('role', 'button');
        view.g.setAttribute('tabindex', '0');
        view.g.setAttribute('aria-label', '取消');
        /* 取消键按自身 bbox 的自然比例定高：宽 200，高按原画算，避免再出现横向拉伸。 */
        host.style.width = '200px';
        host.style.height = Math.max(58, Math.round(200 * box.height / box.width * 100) / 100) + 'px';
        host.style.visibility = '';
        const hover = (on) => {
          try { view.gotoAndStop(on ? 2 : 1); } catch (e) {}
        };
        const pressed = (on) => host.classList.toggle('pressed', !!on);
        view.g.addEventListener('pointerenter', () => hover(true));
        view.g.addEventListener('pointerleave', () => { hover(false); pressed(false); });
        view.g.addEventListener('pointerdown', (e) => {
          if (e.button != null && e.button !== 0) return;
          pressed(true);
          try { view.g.setPointerCapture(e.pointerId); } catch (err) {}
        });
        view.g.addEventListener('pointerup', () => pressed(false));
        view.g.addEventListener('pointercancel', () => pressed(false));
        const fire = (e) => {
          if (e) { e.preventDefault(); e.stopPropagation(); }
          pressed(false);
          onCancel();
        };
        view.g.addEventListener('click', fire);
        view.g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fire(e); });
      }).catch(fallback);
    };
    if (window.SfRender && SfRender.loadExtra) {
      SfRender.loadExtra('tags-social-dialog.json').catch(() => {}).then(mount);
    } else {
      mount();
    }
  }
  /** 「开始竞技」后的小选择弹窗：左英雄帖（经验场）/ 右勇气徽章（碎片场）。
   *  两张图都是游戏内道具图集，弹窗壳走经典 `.classic-modal`，不另造现代页面。
   *  原版素材里没有独立的「经验竞技场 / 碎片竞技场」文字元件（只有祭坛说明里连写），
   *  所以按用户口径**只放图标**，点图标直接进场；`aria-label` 留给读屏 / 探针。 */
  function chooseArena() {
    const C = () => UI.classic;
    const s = State.state();
    const icon = (id) => (C().icon ? C().icon('prop', id) : '');
    const count = (id) => Math.max(0, Number(s.props[id]) || 0);
    const html = '<div class="arena-pick">' +
      '<button type="button" class="arena-pick-btn" data-arena-kind="0" aria-label="经验竞技场">' +
        '<span class="item-icon">' + icon(36) + '<span class="item-count">×' + count(36) + '</span></span>' +
      '</button>' +
      '<button type="button" class="arena-pick-btn" data-arena-kind="1" aria-label="碎片竞技场">' +
        '<span class="item-icon">' + icon(39) + '<span class="item-count">×' + count(39) + '</span></span>' +
      '</button>' +
      '<button type="button" class="arena-pick-btn" data-arena-kind="2" aria-label="幻兽竞技场">' +
        '<span class="item-icon">' + icon(82) + '<span class="item-count">×' + count(82) + '</span></span>' +
      '</button>' +
      '</div>';
    const m = C().modal('竞技场', html + '<p class="small-label" style="text-align:center;margin-top:10px">召唤证：道具商店 10 金松果/个，或开启魔法袋获得；体力不足 30 时自动使用。</p>', [], { small: true });
    m.element.classList.add('arena-pick-dialog');
    mountArenaCancel(m, m.close);
    m.element.querySelectorAll('[data-arena-kind]').forEach((btn) => {
      btn.onclick = () => {
        if (!btn.isConnected) return;
        m.close();
        startArenaCompete(Number(btn.dataset.arenaKind) || 0);
      };
    });
  }
  function arena() {
    /* 【经典模式】这一页由**原版竞技场帧**渲染（挑战页 7638 的第 6 帧 + `compete` 两颗键），
     * 所以这里只把界面交回给挑战页 —— 用户 2026-10 口径："竞技场开始竞技会跳回现代界面，
     * 经典模式下完全是经典模式。" 报名/开打的流程仍走本文件（原版那套要服务端）。 */
    if (UI.currentUiMode && UI.currentUiMode() === 'classic' && window.SfChallenge && SfChallenge.goArenaPage) {
      SfChallenge.goArenaPage('home'); return;
    }
    State.tickEnergy();
    const s = State.state(), run = activeArenaRun();
    /* 现代竞技页只保留一排三种：经验场 / 碎片场 / 天梯。
     * 幻兽竞技场和螳螂大侠等场外立绘不再出现；三张卡各自保留原版金杯/宝石杯/天梯 UI 图片。 */
    const cards = [
      { art: 28, name: '\u7ecf\u9a8c\u7ade\u6280\u573a', text: '10\u7ea7\u5f00\u542f\uff0c\u51a0\u519b150\uff0f\u4e9a\u519b100\uff0f\u5b63\u519b50\uff0f\u6bbf\u519b30\u7ecf\u9a8c', action: 'arena-exp' },
      { art: 29, name: '\u788e\u7247\u7ade\u6280\u573a', text: '15\u7ea7\u5f00\u542f\uff0c\u56db\u540d\u4f9d\u6b21\u83b7\u5f978\uff0f6\uff0f4\uff0f3\u84dd\u8272\u788e\u7247', action: 'arena-fragment' },
      { art: 30, name: '\u5929\u68af\u8d5b', text: '30\u7ea7\u5f00\u542f\uff0c\u8d62\u79ef\u5206\u3001\u4e89\u91d1\u676f', action: 'arena-rank' },
    ];
    const resume = run ? '<div class="extra-resume">\u4f60\u5df2\u62a5\u540d\uff0c\u65e0\u9700\u518d\u6b21\u6d88\u8017\u4f53\u529b\u3002' + button(run.phase === 'final' ? '\u7ee7\u7eed\u51b3\u8d5b' : run.phase === 'third' ? '\u7ee7\u7eed\u5b63\u519b\u8d5b' : '\u7ee7\u7eed\u6bd4\u8d5b', 'arena-resume', 'tiny gold') + '</div>' : '';
    let potionHint = '';
    if (s.energy < 30) {
      const deficit = 30 - s.energy;
      const small = s.props[1] || 0, big = s.props[2] || 0;
      const useId = (deficit <= 10 && small) ? 1 : (big ? 2 : (small ? 1 : 0));
      potionHint = useId
        ? '<div class="extra-arena-hint">' + esc('体力不足 30：报名时会自动使用「') + propMap.getValue(useId).name + esc('」补足体力（不需要手动操作）。') + '</div>'
        : '<div class="extra-arena-hint warn">' + esc('体力不足 30：先用本场入场券（经验场英雄帖 / 碎片场勇气徽章，缺了用另一张），最后才喝体力药。') + '</div>';
    }
    const p = C().page('challenge', 'arena', '<div class="extra-arena-cards">' + cards.map(card => '<article>' + sprite(card.art) + '<h2>' + card.name + '</h2><p>' + card.text + '</p>' + button(card.action === 'arena-rank' ? '\u8fdb\u5165\u5929\u68af' : '\u53c2\u52a0\u6bd4\u8d5b', card.action, 'small gold') + '</article>').join('') + '</div><div class="extra-arena-cost">经验场 / 碎片场：4\u4eba\u4e24\u8f6e\u6bd4\u8d5b\uff0c\u534a\u51b3\u8d5b\u80dc\u8005\u4e89\u51a0\u519b\u3001\u8d25\u8005\u4e89\u5b63\u519b\u3002<br>\u62a5\u540d\u6d88\u801730\u4f53\u529b\uff0c\u4f53\u529b\u4e0d\u8db3\u53ef\u4f7f\u7528\u82f1\u96c4\u5e16\u6216\u52c7\u6c14\u5fbd\u7ae0\u3002<br>\u4f53\u529b ' + s.energy + '/' + s.maxEnergy + '\u3000\u82f1\u96c4\u5e16 ' + (s.props[36] || 0) + '\u3000\u52c7\u6c14\u5fbd\u7ae0 ' + (s.props[39] || 0) + '</div>' + resume, { cls: 'extra-board arena-extra-board' });
    on(p, 'arena-exp', () => confirmArena(0));
    on(p, 'arena-fragment', () => confirmArena(1));
    on(p, 'arena-rank', rank);
    on(p, 'arena-resume', () => resumeArena(activeArenaRun()));
  }
  function arenaAccess(kind) {
    /* 原版门槛：经验场 10 级（AS:15132），碎片场 / 幻兽场 15 级（AS:22662）。
     * 以前经验场写成 11、碎片场写成 20，入口却按 10 级放行 —— 10 级能进页却报不了名。 */
    const level = kind === 0 ? 10 : 15;
    if (State.state().level >= level) return true;
    const name = kind === 0 ? '\u7ecf\u9a8c\u7ade\u6280\u573a' : kind === 1 ? '\u788e\u7247\u7ade\u6280\u573a' : '\u5e7b\u517d\u7ade\u6280\u573a';
    alert(name + '\u9700\u8981\u8fbe\u5230' + level + '\u7ea7\u3002'); return false;
  }
  function payArenaEntry(s, kind) {
    const NEED = 30;
    const admission = kind === 0 ? 36 : kind === 1 ? 39 : 82;   // 经验/碎片/幻兽
    const other = kind === 0 ? 39 : 36;
    const freeEnergyDebug = () => !!(typeof window !== 'undefined' && window.Debug && window.Debug.enabled('infiniteEnergy'));
    /* 与现代版 `joinArena` 的扣费顺序对齐：
     *   ① 体力够 30 → 扣体力；
     *   ② 体力不够 → 先扣本场对应入场券（经验场英雄帖 / 碎片场勇气徽章）；
     *   ③ 对应券没有 → 现代版会兜底用另一张券；这里照样先于体力药；
     *   ④ 两张券都没有 → 自动喝体力药补到 30，再扣体力；
     *   ⑤ 都不够 → 拒绝。
     * 「先记后扣 + 精确核对」保留：每次只允许扣一种资源，扣不动就不放行。 */
    const takeItem = (id) => {
      const before = Number(s.props[id]) || 0;
      if (!(before > 0)) return false;
      s.props[id] = before - 1;
      if (Number(s.props[id]) !== before - 1) return false;
      State.save();
      return true;
    };
    const payEnergy = () => {
      const before = Number(s.energy) || 0;
      if (!State.consumeEnergy(NEED)) return false;
      const after = Number(s.energy) || 0;
      return after <= before - NEED || freeEnergyDebug();
    };
    if (s.energy >= NEED) {
      if (!payEnergy()) return { ok: false, reason: 'energy-not-deducted' };
      return { ok: true, by: 'energy' };
    }
    if (takeItem(admission)) return { ok: true, by: 'item', itemId: admission };
    if (takeItem(other)) return { ok: true, by: 'item', itemId: other, fallback: true };
    const deficit = NEED - Math.max(0, Number(s.energy) || 0);
    const order = deficit <= 10 ? [1, 2] : [2, 1];
    const per = { 1: 10, 2: 30 };
    let useId = 0;
    for (const id of order) {
      if (!(Number(s.props[id]) > 0)) continue;
      if (s.energy + per[id] >= NEED) { useId = id; break; }
    }
    if (!useId) return { ok: false, reason: 'no-energy-no-item' };
    const potion = State.autoEnergyPotion ? State.autoEnergyPotion(NEED) : { ok: false };
    if (!(potion.ok && s.energy >= NEED)) return { ok: false, reason: 'no-energy-no-item' };
    if (!payEnergy()) return { ok: false, reason: 'energy-not-deducted' };
    return { ok: true, by: 'energy', potionUsed: potion.used || useId };
  }
  function confirmArena(kind) {
    const existing = activeArenaRun();
    if (existing) { fightArena(existing); return; }
    if (!arenaAccess(kind)) return;
    const owner = State.state();
    // Original showJoinCheckWin uses the confirmation library symbol; payment
    // and opponent selection still run through the existing actions below.
    const showConfirm = (title, html, actions, options) => {
      if (UI.currentUiMode && UI.currentUiMode() === 'classic' && window.SfChallenge && SfChallenge.openOriginalConfirm) {
        const ticket = kind === 0 ? '英雄帖' : kind === 1 ? '勇气徽章' : '召唤证';
        const text = (kind === 0 ? '经验竞技场' : kind === 1 ? '碎片竞技场' : '幻兽竞技场') + '\n' +
          '报名消耗30体力，两轮比赛只扣一次。体力不足时使用入场券（' + ticket + '），最后自动补充体力药。\n是否报名参赛？';
        /* 2026-10 用户口径：竞技场报名确认的「确定 / 取消」左右对调，两键悬停变绿，
         * 并把两键的间距再拉开一点。只对这条报名确认传 swapButtons / extraGap，
         * 好友/收徒等其他 4421 确认框保持原版键位与间距。 */
        SfChallenge.openOriginalConfirm({ label: title, text, accept: actions[0].run, swapButtons: true, extraGap: 20 })
          .catch(() => showHint('报名确认界面加载失败，请重试。'));
        return;
      }
      return C().modal(title, html, actions, options);
    };
    showConfirm('\u7ade\u6280\u573a\u62a5\u540d', '<p>' + (kind === 0 ? '\u7ecf\u9a8c\u7ade\u6280\u573a' : kind === 1 ? '\u788e\u7247\u7ade\u6280\u573a' : '\u5e7b\u517d\u7ade\u6280\u573a') + '\uff1a\u534a\u51b3\u8d5b\u80dc\u8005\u8fdb\u5165\u51b3\u8d5b\uff0c\u8d25\u8005\u8fdb\u884c\u5b63\u519b\u8d5b\u3002</p><p>\u62a5\u540d\u4e00\u6b21\u6d88\u801730\u4f53\u529b\uff0c\u7b2c\u4e8c\u6218\u4e0d\u518d\u6263\u9664\u3002\u4f53\u529b\u4e0d\u8db3\u65f6\u4f7f\u75281\u5f20\u82f1\u96c4\u5e16/\u52c7\u6c14\u5fbd\u7ae0/\u53ec\u5524\u8bc1\u3002</p>' + note('\u79bb\u7ebf\u5bf9\u624b\u7531\u672c\u5730\u751f\u6210\u3002\u7ade\u6280\u573a\u4e0d\u4f7f\u7528\u6311\u6218\u836f\u5242\u6548\u679c\u3002'), [{ label: '\u62a5\u540d\u53c2\u8d5b', run: () => {
      if (State.state() !== owner || activeArenaRun() || !arenaAccess(kind)) return;
      const s = owner;
      State.tickEnergy();
      /* 报名费用：体力 30，或（体力不足时）1 张准入道具 ——
       *   经验竞技场 → 英雄帖(36)；碎片竞技场 → 勇气徽章(39)；对应券没有时按现代版兜底用另一张券，最后才喝体力药。
       * 重构成「先判定 payArenaEntry、再一次性扣」：原写法是
       *   `if (s.energy < 30) { ...道具... }` + `if (s.energy >= 30) { consumeEnergy }`，
       * 两段都可能被绕过（体力量不足时道具没扣、consumeEnergy 又失败就直接往下走），
       * 现在只要判定通过就一定扣掉，判定不通过就一定 return。 */
      const pay = payArenaEntry(s, kind);
      if (!pay.ok) {
        if (pay.reason === 'no-energy-no-item') {
          alert('\u4f53\u529b\u4e0d\u8db330\u70b9\uff0c\u4e5f\u6ca1\u6709\u672c\u573a\u5165\u573a\u5238\uff08\u82f1\u96c4\u5e16/\u52c7\u6c14\u5fbd\u7ae0/\u53ec\u5524\u8bc1\uff09\u3002');
        } else {
          alert('\u7ade\u6280\u573a\u62a5\u540d\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002');   // 扣费未生效：不放行
        }
        return;
      }
      if (pay.potionUsed) {
        const usedName = propMap.getValue(pay.potionUsed).name;
        showHint('\u4f53\u529b\u4e0d\u8db3\uff0c\u5df2\u81ea\u52a8\u4f7f\u7528 ' + usedName + '\uff08\u4f53\u529b ' + s.energy + '/' + s.maxEnergy + '\uff09\uff0c\u7ee7\u7eed\u53c2\u8d5b');
      }
      const foes = [State.genAI(s.level, '', { statScale: State.RANDOM_FOE_SCALE || 1.08 }), State.genAI(s.level, '', { statScale: State.RANDOM_FOE_SCALE || 1.08 }), State.genAI(s.level, '', { statScale: State.RANDOM_FOE_SCALE || 1.08 })];
      const other = Sim.simulate(foes[1], foes[2]);
      /* 报名后先看「随机匹配」页：经典模式复用挑战页 7638 的竞技赛事帧，
       * 四个席位就是刚抽出来的三名对手；玩家点「开始半决赛」才真正进战斗。 */
      arenaRun = { owner: s, kind, phase: 'semi', foe: foes[0], finalist: foes[other.winner === 0 ? 1 : 2], consolation: foes[other.winner === 0 ? 2 : 1], busy: false, settled: false, matching: true };
      saveArenaRun(arenaRun);
      if (!resumeArena(arenaRun)) fightArena(arenaRun);
    } }, { label: '\u8fd4\u56de', cls: 'muted' }], { small: true });
  }
  function arenaMatchPage() {
    if (window.SfChallenge && SfChallenge.goArenaPage) { SfChallenge.goArenaPage('match'); return true; }
    return false;
  }
  /** 经典竞技：报名/中断恢复后先停在「赛事页」——半决赛显示随机匹配结果，
   *  决赛/季军赛显示下一场对手；页面由 `SfChallenge` 展示 3 秒后自动开打。
   *  没有经典赛事页（现代模式）时退回直接开打。 */
  function resumeArena(run) {
    if (!run) return false;
    const classic = !!(window.UI && UI.currentUiMode && UI.currentUiMode() === 'classic');
    if (classic && !run.busy && !run.settled && arenaMatchPage()) return true;
    fightArena(run);
    return false;
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
      arenaMatchPage();
    };
    Main.startBattle(foe, { cost: 0, kind: 'arena', useProps: false, region: 0, skipChest: true, onError: interrupted,
      /* 【经典模式】打完**直接回原版竞技场页**（原版是回"temp"帧再回 `tiaozhan`）：
       * 不传这个开关的话 `startBattle` 会先 `showHome()`，而首页会把挑战页拆掉，
       * 下面的 `arena()` 就回不去了（用户 2026-10 报的"竞技场开始竞技会跳回现代界面"）。 */
      keepScreen: !!(window.SfChallenge && SfChallenge.goArenaPage),
      onEnd: winner => {
      if (finished || run.settled || run.owner !== State.state()) return;
      finished = true; run.busy = false;
      if (phase === 'semi') {
        const won = winner === 0;
        run.phase = won ? 'final' : 'third'; saveArenaRun(run);
        const gem = won ? State.rollGemDrop(15) : null;   // 45\u7ea7\u8d77\u7ade\u6280\u573a\u83b7\u80dc\u6709\u51e0\u7387\u5f97\u5b9d\u77f3
        if (gem) State.save();
        const opponent = won ? run.finalist : run.consolation, title = won ? '\u664b\u7ea7\u51b3\u8d5b' : '\u4e89\u593a\u5b63\u519b';
        arena();   // \u534a\u51b3\u8d5b\u540e\u56de\u5230\u7ade\u6280\u573a\u9875\u505a\u80cc\u666f\uff08\u73a9\u5bb6\u521a\u4ece\u8fd9\u91cc\u62a5\u540d\uff09
        arenaMatchPage();
        /* \u26a0 `C().modal(...)` \u5728\u8fd9\u91cc\u5fc5\u987b**\u5305\u4e00\u5c42 try**\uff1a\u5b83\u4e0b\u9762\u8c03\u7684
         *   `arenaMatchPage()` \u4f1a\u91cd\u753b\u7ade\u6280\u573a\u9875\uff0c\u4e00\u65e6\u90a3\u4e00\u6b65\u629b\u5f02\u5e38\uff0c
         *   \u8fd9\u91cc\u4e5f\u8ddf\u7740\u6302\u6389 \u2014\u2014 \u73a9\u5bb6\u770b\u5230\u7684\u5c31\u662f"\u6218\u6597\u7ed3\u675f\u540e\u5361\u6b7b"\uff08
         *   2026-10 \u771f\u5b9e\u8e29\u8fc7\uff1a`arenaMatchHtml` \u5bf9\u5355\u4e2a `consolation` \u8c03 `.map`\uff09\u3002
         *   \u5f39\u7a97\u662f\u552f\u4e00\u80fd\u544a\u8bc9\u73a9\u5bb6"\u4e0b\u4e00\u6b65\u600e\u4e48\u529e"\u7684\u4e1c\u897f\uff0c\u4e0d\u80fd\u8ddf\u7740\u4e00\u8d77\u6ca1\u3002 */
        try {
          if (originalResult({ kind: 'arena', title, win: won, player: State.state(), foe: opponent,
            text: (gem ? '获得 ' + gem.name + ' ×1。\n' : '') + '第二战无需再消耗体力，本轮进度已保留。',
            actions: [{ label: won ? '开始决赛' : '开始季军赛', run: () => fightArena(run) }, { label: '稍后继续', run: arena }] })) return;
          C().modal(title, '<div class="extra-finalist">' + image('images/ui/characters/squirrel-classic.png', '\u4e0b\u4e00\u573a\u5bf9\u624b') + '<div><h3>' + (won ? '\u534a\u51b3\u8d5b\u83b7\u80dc\uff01' : '\u8fd8\u6709\u5b63\u519b\u8d5b\uff0c\u7ee7\u7eed\u52a0\u6cb9\uff01') + '</h3><p>\u4e0b\u4e00\u573a\u5bf9\u624b\uff1a' + esc(opponent.name) + '<br>\u7b49\u7ea7 ' + opponent.level + '</p></div></div>' + (gem ? note('\u83b7\u5f97 ' + gem.name + ' \u00d71\uff01') : '') + note('\u7b2c\u4e8c\u6218\u65e0\u9700\u518d\u6d88\u8017\u4f53\u529b\uff0c\u5173\u95ed\u9875\u9762\u540e\u4ecd\u53ef\u7ee7\u7eed\u672c\u8f6e\u3002'), [{ label: won ? '\u5f00\u59cb\u51b3\u8d5b' : '\u5f00\u59cb\u5b63\u519b\u8d5b', run: () => fightArena(run) }, { label: '\u7a0d\u540e\u7ee7\u7eed', cls: 'muted', run: arena }]);
        } catch (e) { if (window.__errs) window.__errs.push('arena modal: ' + (e && e.message)); }
        return;
      }
      run.settled = true; arenaRun = null;
      const position = phase === 'final' ? (winner === 0 ? 0 : 1) : (winner === 0 ? 2 : 3);
      // \u7ecf\u9a8c\u573a\u5403\u7ecf\u9a8c\u4e38\u52a0\u6210\uff08\u7ecf\u9a8c\u4e38 +40% / \u8d85\u7ea7\u7ecf\u9a8c\u4e38 +60%\uff09\uff1b\u788e\u7247\u573a\u53ea\u7ed9\u788e\u7247\u3001\u4e0d\u7ed9\u7ecf\u9a8c\uff08\u4e5f\u5c31\u4e0d\u6d88\u8017\u7ecf\u9a8c\u4e38\uff09\u3002
      const kind = Number(run.kind) || 0;
      let baseExp = kind === 0 ? ARENA_EXP[position] : 0;
      let shards = kind === 1 ? ARENA_FRAGMENT_SHARDS[position] : 0;
      const hatch = kind === 2 ? ARENA_HATCH[position] : 0;
      /* 【祭坛当日状态】原版 `getBufRewarTips`（MainMovie.as:4330）：
       * 领到经验/碎片双倍状态之后，**参加竞技场时有几率双倍**（几率 = 祭坛当前等级那一档，
       * 见 `buildingUpInfo`）。这里就是"参加时"那一下 —— 结算时按几率掷一次。
       * ⚠ 翻倍必须发生在**入账之前**：
       *   · 经验入账在 `State.gainExpWithBoost(baseExp)` 内部（它还会回传升级结果 `ups`），
       *     所以乘的是 `baseExp`，不能等 `boosted.exp` 出来再乘（那样升级结算就对不上了）；
       *   · 碎片入账在 `addProp(26, shards)`，乘在读它之前。
       * 这样界面文案（同一个变量）与账上永远是同一个数。 */
      let buffNote = '';
      if (baseExp && State.activeBuildingBuff && State.activeBuildingBuff('arenaExp')) {
        const rate = State.buildingDoubleRate('altar', 'arenaExp');
        if (rate > 0 && Math.random() * 100 < rate) { baseExp *= 2; buffNote = '祭坛发出神秘的光芒，恭喜你获得了双倍经验奖励！'; }
      }
      if (shards && State.activeBuildingBuff && State.activeBuildingBuff('arenaProp')) {
        const rate = State.buildingDoubleRate('altar', 'arenaProp');
        if (rate > 0 && Math.random() * 100 < rate) { shards *= 2; buffNote = '祭坛发出神秘的光芒，恭喜你获得了双倍碎片奖励！'; }
      }
      // \u52a0\u6210\u767e\u5206\u6bd4\u8981\u5728 tickPropStates \u6d88\u8017\u672c\u573a\u7528\u91cf\u4e4b\u524d\u8bfb\uff0c\u5426\u5219\u7ed3\u7b97\u6587\u6848\u4f1a\u663e\u793a\u6210 0%
      const boostPct = baseExp ? State.expBoostPct() : 0;
      const boosted = baseExp ? State.gainExpWithBoost(baseExp) : { exp: 0, ups: [] };
      const exp = boosted.exp;
      if (shards) addProp(26, shards);
      if (hatch) { const st = State.state(); st.hatchPoint = Math.max(0, (Number(st.hatchPoint) || 0) + hatch); }
      const gem = winner === 0 ? State.rollGemDrop(15) : null;   // 45\u7ea7\u8d77\u7ade\u6280\u573a\u83b7\u80dc\u6709\u51e0\u7387\u5f97\u5b9d\u77f3
      const ups = boosted.ups;
      if (baseExp) State.tickPropStates();   // \u7ecf\u9a8c\u4e38\u6309\u573a\u6b21\u6d88\u8017
      const boostNote = boostPct ? '\uff08\u542b\u7ecf\u9a8c\u4e38 +' + boostPct + '%\uff09' : '';
      /* ⚠ `exp` 已经在上面按祭坛状态翻过倍了，这里**只负责显示**，不能再加一次。
       * 文案拼在 `outcome` 的最后一段（原版那句"祭坛发出神秘的光芒…"）。 */
      const buffTail = buffNote ? '\uff01' + buffNote.replace(/！/g, '') : '';
      saveArenaRun(null);
      /* 【经典模式】整场竞技打完（决赛 / 季军赛）→ **直接回"开始竞技"那一页**（挑战页 7638 的第 6 帧，
       * `compete` 两颗键那一屏），并只弹一个写清本场奖励的弹窗 —— 这是用户 2026-10 本批 ⑧ 的口径：
       * "当前竞技场的竞技结束后会停留在一个很诡异的界面，再点击一下才能返回竞技主界面，
       *  我希望竞技结束后就直接回到开始竞技的界面，显示一个弹窗显示该场竞技的奖励即可。"
       * 那个"很诡异的界面"就是原来的赛事页（第 5 帧那四个空席位，`paintArenaSeats` 已经没有对手可画）。
       * 现在：`arena()`（= `SfChallenge.goArenaPage('home')`）先把背板画好，弹窗再压上去；
       * `outcome()` 的"返回 / 继续"两键也都落到首屏。
       * ⚠ `arenaMatchPage()` **不要再调**：它是"回赛事页"，正是要避开的那一屏。 */
      arenaRules();   // 战果弹窗放回**有「开始竞技」的规则页**（7638 第 4 帧），不回竞技场首屏
      const backHome = () => arenaRules();
      outcome(winner === 0, { exp, gold: 0, ups, hatch }, '获得' + ['冠军', '亚军', '季军', '第四名'][position] + '！' + (hatch ? '孵化点 ×' + hatch + '。' : (shards ? '蓝色碎片 ×' + shards + (exp ? '、经验 ' + exp + boostNote : '') + '。' : '奖励' + exp + '经验' + boostNote + '。')) + (gem ? '获得 ' + gem.name + ' ×1！' : '') + buffTail, backHome, '返回竞技场');
    } }).catch(interrupted);
  }

  let rankAttempt = null;
  /* ============================================================
   * 【EX2】天梯赛（匹配/积分/商店）
   * ============================================================ */
  const RANK_LEVEL_BASE = 30, RANK_INTEGRAL_BASE = 1500, RANK_INTEGRAL_PER_LEVEL = 25, RANK_LEVEL_SPREAD = 4;
  function rankFoeLevel(integral, cap) {
    const top = Math.max(1, Math.min(State.MAX_PLAYER_LEVEL || 90, Number(cap) || 90));
    const expect = RANK_LEVEL_BASE + Math.max(0, (Number(integral) || 0) - RANK_INTEGRAL_BASE) / RANK_INTEGRAL_PER_LEVEL;
    const jitter = (Math.random() * 2 - 1) * RANK_LEVEL_SPREAD;
    return Math.max(1, Math.min(top, Math.round(expect + jitter)));
  }
  /** 只算期望值（给界面提示/测试用，不带随机）。 */
  function rankFoeExpectLevel(integral, cap) {
    const top = Math.max(1, Math.min(State.MAX_PLAYER_LEVEL || 90, Number(cap) || 90));
    return Math.max(1, Math.min(top, Math.round(
      RANK_LEVEL_BASE + Math.max(0, (Number(integral) || 0) - RANK_INTEGRAL_BASE) / RANK_INTEGRAL_PER_LEVEL)));
  }
  function rankWeekKey() {
    const d = new Date(Date.now());
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);      // 周一为一周起点
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function refreshRankShopDay() {
    const s = State.state(), week = rankWeekKey();
    if (!s.rankPurchaseTotals || typeof s.rankPurchaseTotals !== 'object' || Array.isArray(s.rankPurchaseTotals)) s.rankPurchaseTotals = {};
    /* 旧档没有账号累计账：把本周已经买过的永久属性丸搬进累计账，至少不会因为改版
     * 让已经买过的人再白拿一个（更早的周次没有记录，无法回溯）。 */
    for (const id of RANK_ACCOUNT_LIMIT_GOODS) {
      const old = Math.max(0, Math.floor(Number(s.rankPurchases && s.rankPurchases[id]) || 0));
      if (old > 0) s.rankPurchaseTotals[id] = Math.max(old, Math.floor(Number(s.rankPurchaseTotals[id]) || 0));
    }
    if (s.rankPurchaseWeek === week && s.rankPurchases && typeof s.rankPurchases === 'object' && !Array.isArray(s.rankPurchases)) return;
    // 旧档只有按天标记（rankPurchaseDay）：换成按周后第一次打开清空即可
    s.rankPurchases = {};
    s.rankPurchaseWeek = week;
    if (s.rankPurchaseDay !== undefined) delete s.rankPurchaseDay;
    State.save();
  }
  /* 力/敏/速/血永久丸（goods id 7~10）：原版 `timesLimit` 是 **1**，且是账号级限购；
   * 复刻以前把所有 timesLimit 都当“每周限兑”，于是每周都能再买一个，属性会无限叠。
   * 这四件改用 `rankPurchaseTotals`（不随周重置），上限就是字典里的 timesLimit（1）。
   * 魔法袋（goods id 19）同样是账号限 1：原版天梯商店卖它，离线版补回这一行
   * （见 gamedata 的 EXTRA_RANK_GOODS），也走同一本账号累计账。 */
  const RANK_ACCOUNT_LIMIT_GOODS = Object.freeze([7, 8, 9, 10, 19]);
  function rankLimitInfo(goods) {
    const item = goods || {};
    const s = State.state() || {};
    const id = String(item.id);
    const account = RANK_ACCOUNT_LIMIT_GOODS.includes(Number(item.id));
    const limit = Math.max(0, Math.floor(Number(item.timesLimit) || 0));
    const bag = account ? (s.rankPurchaseTotals || {}) : (s.rankPurchases || {});
    const bought = Math.max(0, Math.floor(Number(bag[id]) || 0));
    return { account, limit, bought, remaining: limit > 0 ? Math.max(0, limit - bought) : Infinity };
  }
  function rank() {
    /* 经典模式的天梯页由挑战页原版帧负责，不再落回复刻自研的 DOM 天梯页。 */
    if (window.UI && UI.currentUiMode && UI.currentUiMode() === 'classic' && window.SfChallenge && SfChallenge.goArenaPage) {
      SfChallenge.goArenaPage('ladder');
      return;
    }
    const s = State.state(); State.tickEnergy();
    if (rankAttempt && rankAttempt.owner !== s) rankAttempt = null;
    if (s.level < 30) {
      C().modal('\u5929\u68af\u8d5b', '<div class="extra-finalist">' + sprite(30) + '<div><h3>30\u7ea7\u5f00\u542f\u5929\u68af\u8d5b</h3><p>\u5f53\u524d\u7b49\u7ea7\uff1a' + s.level + '<br>\u5148\u53bb\u6311\u6218\u79ef\u7d2f\u7ecf\u9a8c\u5427\uff01</p></div></div>', [{ label: '\u53bb\u6311\u6218', run: () => UI.runAction('challenge') }, { label: '\u8fd4\u56de', cls: 'muted', run: arena }]); return;
    }
    if (s.integral == null) { s.integral = 1500; State.save(); }
    refreshRankShopDay();
    // 天梯赛 30 级才开，榜上对手也都是够级的（顺带显示等级，免得看起来像「不满 30 级也有积分」）
    const cap = State.MAX_PLAYER_LEVEL || 90;
    const entries = [0, 1, 2, 3, 4, 5].map((n) => ({
      name: GData.AI_NAMES[n * 4], points: 1350 + n * 83, level: Math.min(cap, 34 + n * 6),
    }));
    entries.push({ name: s.name, points: s.integral, level: s.level, mine: true }); entries.sort((a, b) => b.points - a.points);
    const p = C().page('challenge', 'arena', '<div class="extra-rank-layout"><div class="extra-rank-self">' + sprite(30) + '<h2>\u5929\u68af\u8d5b</h2><div class="extra-score">\u79ef\u5206 <b>' + s.integral + '</b></div><div class="extra-score">\u91d1\u676f <b>' + s.goldCup + '</b></div><div class="extra-score">\u5339\u914d\u6863\u4f4d <b>Lv' + rankFoeExpectLevel(s.integral) + '</b></div><p>\u4eca\u65e5\u5df2\u53c2\u8d5b ' + s.joinRankCount + ' / 20 \u573a<br>' + (s.joinRankCount >= 20 ? '\u4eca\u65e5\u53c2\u8d5b\u6b21\u6570\u5df2\u7528\u5b8c' : s.joinRankCount < 10 ? '\u672c\u6b21\u514d\u8d39\uff0c\u524d10\u573a\u514d\u8d39' : '\u672c\u6b21\u6d88\u80175\u91d1\u677e\u679c') + '</p>' + button('\u5f00\u59cb\u5339\u914d', 'rank-fight', 'small gold') + button('\u91d1\u676f\u5546\u5e97', 'rank-shop', 'small') + '</div><div class="extra-rank-list"><h3>\u672c\u5730\u6a21\u62df\u6392\u884c\u699c</h3>' + entries.map((entry, i) => '<div class="extra-rank-row ' + (entry.mine ? 'mine' : '') + '"><span>' + (i + 1) + '</span><b>' + esc(entry.name) + (entry.mine ? '\uff08\u4f60\uff09' : '') + ' Lv' + (entry.level || 1) + '</b><strong>' + entry.points + '</strong></div>').join('') + note('\u5929\u68af\u8d5b\u6bcf\u5929\u90fd\u53ef\u4ee5\u8fdb\u884c\uff1b\u91d1\u676f\u5546\u5e97\u6bcf\u5929\u5f00\u653e\u3002\u6bcf\u65e5\u6700\u591a20\u573a\uff0c\u524d10\u573a\u514d\u8d39\uff0c\u5176\u540e\u6bcf\u573a5\u91d1\u677e\u679c\u3002\u80dc\u5229\u5f973\u676f\uff0c\u843d\u8d25\u5f971\u676f\u3002\u79ef\u5206\u4e0e\u593a\u676f\u4e3a\u79bb\u7ebf\u6a21\u62df\uff1b\u83b7\u80dc\u670925%\u673a\u4f1a\u989d\u5916\u593a\u5f973\u676f\u3002\u5339\u914d\u5bf9\u624b\u7684\u7b49\u7ea7\u53ea\u8ddf\u79ef\u5206\u6302\u94a9\uff081500 \u5206\u5bf9\u5e94 30 \u7ea7\u6863\u3001\u6bcf +25 \u5206 +1 \u7ea7\u3001\u4e0a\u9650 70 \u7ea7\uff09\uff0c\u79ef\u5206\u4e0d\u4f1a\u88ab\u82b1\u6389\uff0c\u6240\u4ee5\u6863\u4f4d\u53ea\u4f1a\u8ddf\u7740\u6218\u7ee9\u8d70\u3002') + '</div></div>', { cls: 'extra-board rank-extra-board' });
    back(p, arena, '\u8fd4\u56de');
    on(p, 'rank-shop', () => rankShop(0));
    const match = on(p, 'rank-fight', () => {
      if (!p.isConnected || State.state() !== s || rankAttempt) return;
      rankMatch();
    });
    match.disabled = s.joinRankCount >= 20 || !!rankAttempt;
  }
  /** 天梯赛报名费（复刻上限 20 场；与 `rankMatch` 同一口径）。 */
  function rankFeeNow(s) { return s.joinRankCount < 10 ? 0 : 5; }
  let rankPrepPending = false;
  /** 【经典天梯流程】对齐原版 `alertRank`（:23720）+ `beforeRank`（:18149）：
   *   点「开始比赛」→ 首次 / 免费场用完时先弹经典二次确认（原版 `makeSure`）；
   *   确认后先摆「战斗准备中」原版 3464（双方名字 / 积分 / VS）3 秒，再进战斗。
   *   `rankMatch` 保留原样给现代 DOM 页与回归用例直接开打；经典页只走这里。 */
  function startRankFlow(after, opts) {
    const back = (typeof after === 'function') ? after : rank;
    const o = opts || {};
    const s = State.state();
    if (rankAttempt || rankPrepPending) return;
    State.tickEnergy();
    if (s.level < 30) { alert('天梯赛需要达到30级。'); return; }
    if (s.joinRankCount >= 20) { alert('今天已经参加20场，明天再来吧！'); return; }
    const fee = rankFeeNow(s);
    if (s.goldPoint < fee) { alert('第11至20场每场需要5金松果，当前金松果不足。'); return; }
    if (!o.confirmed && (s.joinRankCount === 0 || s.joinRankCount > 9)) {
      const text = s.joinRankCount === 0
        ? '每天前10场免费；第11-20场每场扣除5金松果。\n今日已赛 0/20。'
        : '本日免费场已打完，本场将扣除5金松果。\n今日已赛 ' + s.joinRankCount + '/20。';
      C().modal('天梯赛', '<p>' + text.replace(/\n/g, '<br>') + '</p>', [
        { label: '开始比赛', cls: 'gold', run: begin },
        { label: '返回', cls: 'muted' },
      ], { small: true });
      return;
    }
    begin();
    function begin() {
      if (rankAttempt || rankPrepPending || State.state() !== s) return;
      rankPrepPending = true;
      const foe = State.genAI(rankFoeLevel(s.integral), '', { statScale: State.RANDOM_FOE_SCALE || 1.08 });
      showRankPrep(s, foe).then(() => {
        rankPrepPending = false;
        if (rankAttempt || State.state() !== s) return;
        rankMatch(back, { foe: foe });
      }).catch(() => {
        rankPrepPending = false;
        if (!rankAttempt && State.state() === s) rankMatch(back, { foe: foe });
      });
    }
  }
  /** 原版 `rankInfoMc`（「战斗准备中」）—— `3464` 在后来的战斗素材包里，
   *  这里按 320×196 舞台居中挂 3 秒；素材没到时只等一小会儿就开打，不挡流程。 */
  async function showRankPrep(s, foe) {
    const ui = document.getElementById('ui');
    if (!ui || !window.SfRender || !SfRender.mountSymbol) { await new Promise((r) => setTimeout(r, 300)); return; }
    const host = document.createElement('section');
    host.className = 'sf-rank-prep ssfight-view';
    host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', '战斗准备中');
    ui.appendChild(host);
    let view = null;
    try {
      try { await SfRender.loadExtra('tags-fight.json'); } catch (e) { /* 没素材就不摆 */ }
      if (!host.isConnected || State.state() !== s) return;
      view = await SfRender.mountSymbol(host, '3464', {
        frame: 1, label: '战斗准备中',
        viewBox: '-20 -35 360 250',
        blank: ['name1', 'rank1', 'inte1', 'name2', 'rank2', 'inte2'],
      });
      const set = (name, value) => { const c = view.byName(name); if (c) SfRender.setText(c, String(value == null ? '' : value)); };
      set('name1', s.name || '我'); set('rank1', '—'); set('inte1', s.integral == null ? '—' : s.integral);
      set('name2', foe && foe.name ? foe.name : '对手'); set('rank2', '—'); set('inte2', '—');
      const title = view.byName('title'); if (title && title.gotoAndStop) title.gotoAndStop(1);
    } catch (e) {
      if (window.__errs) window.__errs.push('rank prep: ' + (e && e.message));
    }
    await new Promise((r) => setTimeout(r, 3000));
    if (view) { try { view.destroy(); } catch (e) {} }
    if (host.parentNode) host.parentNode.removeChild(host);
  }
  function rankMatch(after, options) {
    /* `after` = 打完这一场回哪一页（不给就回复刻自研的天梯页 `rank`）。
     * 经典模式下由 `js/ssfight/ui-challenge.js` 传"回原版那一页"进来 —— 见那边的注释。 */
    const back = (typeof after === 'function') ? after : rank;
    const opts = options || {};
    {
      const s = State.state();
      if (rankAttempt) return;
      State.tickEnergy();
      if (s.level < 30) { alert('\u5929\u68af\u8d5b\u9700\u8981\u8fbe\u523030\u7ea7\u3002'); return; }
      if (s.joinRankCount >= 20) { alert('\u4eca\u5929\u5df2\u7ecf\u53c2\u52a020\u573a\uff0c\u660e\u5929\u518d\u6765\u5427\uff01'); return; }
      const fee = s.joinRankCount < 10 ? 0 : 5;
      if (s.goldPoint < fee) { alert('\u7b2c11\u81f320\u573a\u6bcf\u573a\u9700\u89815\u91d1\u677e\u679c\uff0c\u5f53\u524d\u91d1\u677e\u679c\u4e0d\u8db3\u3002'); return; }
      const classicFlow = !!(window.UI && UI.currentUiMode && UI.currentUiMode() === 'classic' &&
        window.SfChallenge && SfChallenge.goArenaPage);
      const attempt = { owner: s, date: State.localDate(), fee, settled: false };
      rankAttempt = attempt; s.joinRankCount++; s.goldPoint -= fee; State.save();
      const foe = opts.foe || State.genAI(rankFoeLevel(s.integral), '', { statScale: State.RANDOM_FOE_SCALE || 1.08 });
      const interrupted = () => {
        if (attempt.settled || rankAttempt !== attempt || State.state() !== s) return;
        attempt.settled = true; rankAttempt = null;
        State.tickEnergy();
        if (State.localDate() === attempt.date) s.joinRankCount = Math.max(0, s.joinRankCount - 1);
        State.addGold(attempt.fee, { count: false });   // 退还报名费，不算收益
        State.save();
        C().toast('\u6bd4\u8d5b\u4e2d\u65ad\uff0c\u672c\u6b21\u53c2\u8d5b\u6b21\u6570\u548c\u8d39\u7528\u5df2\u9000\u8fd8\u3002');
      };
      Main.startBattle(foe, { cost: 0, kind: 'rank', useProps: false, region: 2, skipChest: true, onError: interrupted,
        /* 【经典模式】打完**直接回原版天梯赛那一页**（与竞技场的 `keepScreen` 同一条口径）：
         * 不传这个开关的话 `startBattle` 会先 `showHome()`，而首页的 `renderHome()` 会
         * `SfChallenge.destroy()` 把挑战页整棵拆掉 —— 战果弹窗于是压在主界面（首页）上。
         * 用户 2026-10 口径（本批 ③）："天梯赛的战斗后的页面弹出来的战斗结果与选择是否继续战斗的页面时，
         * 其背景会退回到主界面，我不希望这样，我希望背景仍然是天梯赛的开始比赛界面。"
         * `keepScreen` 时不换页，由下面 `back()` 把"天梯赛菜单"那一帧恢复好，弹窗才落在它上面。
         * ⚠ `keepScreen` 分支里 `startBattle` 会把 `mode` 拨回 `home`（见 main.js 那段注释），
         * 所以「继续挑战」再打一场不会因为 `mode === 'battle'` 被静默挡掉。 */
        keepScreen: !!(window.SfChallenge && SfChallenge.goArenaPage),
        onEnd: async winner => {
        if (attempt.settled || rankAttempt !== attempt || State.state() !== s) return;
        attempt.settled = true; rankAttempt = null;
        const win = winner === 0, delta = win ? 20 + Math.floor(Math.random() * 15) : -(10 + Math.floor(Math.random() * 10));
        const robbed = win && Math.random() < 0.25 ? 3 : 0, cups = (win ? 3 : 1) + robbed;
        s.integral = Math.max(0, s.integral + delta); s.goldCup += cups; State.save();
        try { await back(); } catch (e) {}
        outcome(win, { exp: 0, gold: 0, ups: [] }, '\u79ef\u5206 ' + (delta > 0 ? '+' : '') + delta + '\uff0c\u91d1\u676f +' + cups + (robbed ? '\uff08\u542b\u593a\u5f973\u676f\uff09' : '') + '\u3002\u5f53\u524d\u79ef\u5206 ' + s.integral + '\u3002', back, '\u8fd4\u56de\u5929\u68af\u8d5b',
          [{ label: '\u7ee7\u7eed\u6311\u6218', cls: 'gold', run: () => (classicFlow ? startRankFlow(back, { confirmed: true }) : rankMatch(back)) }], { kind: 'rank', title: win ? '天梯赛胜利' : '天梯赛失利' });
      } }).catch(interrupted);
    }
  }
  /** 经典金杯商店的数据出口：先把"按周"限兑刷新一次，再返回全部商品。
   *  版面交给 `ui-challenge.js` 的原版 7638 第 9 帧（3 件/页，照 `showGoodsShop`），
   *  这里不再画页、也不复制价格/积分/周限。 */
  function rankGoodsList() {
    refreshRankShopDay();
    const goods = [];
    rankgoodsMap.each((id, item) => goods.push(item));
    return goods;
  }
  /** 经典金杯商店的兑换确认：原版 `buyGoodsWin` 的等价物（经典弹窗 + 扣金杯/金松果）。
   *  成功后回调 `onDone`，让商店页重画余额与"本周已兑"状态。 */
  function rankBuy(goodsId, onDone) {
    const s = State.state();
    if (!s) return;
    if (s.level < 30) { alert('天梯商店需要达到30级。'); return; }
    refreshRankShopDay();
    const item = rankgoodsMap.getValue(String(goodsId)) || rankgoodsMap.getValue(Number(goodsId));
    if (!item) return;
    const needCup = Number(item.cup) || 0, needGold = Number(item.gold) || 0, needIntegral = Number(item.integral) || 0;
    const lim = rankLimitInfo(item);
    if (Number(s.integral) < needIntegral) { alert('天梯积分尚未达到兑换要求。'); return; }
    if (Number(s.goldCup) < needCup || Number(s.goldPoint) < needGold) { alert('金杯或金松果不足。'); return; }
    if (lim.limit > 0 && lim.bought >= lim.limit) {
      alert(lim.account
        ? '该奖励每个账号累计只能兑换 ' + lim.limit + ' 次，已经兑换完了。'
        : '该奖励本周的兑换次数已用完，下周一重置后可再兑换。');
      return;
    }
    const icon = item.type === '2' ? C().icon('gear', +item.goodsId) : C().icon('prop', +item.goodsId);
    let redeemed = false;
    C().modal('金杯兑换',
      '<div class="classic-rank-buy"><span class="item-icon">' + icon + '</span><div>' +
        '<p><b>' + esc(item.name) + '</b></p>' +
        '<p>' + esc(item.remark || '') + '</p>' +
        '<p>需要：<span class="rank-price rank-price-detail"><span class="rank-price-part"><b>' + needCup + '</b>' + C().icon('prop', 40) + '</span><span class="rank-price-part"><b>' + needGold + '</b>' + C().goldIcon() + '</span></span></p>' +
        '<p class="small-label">积分要求 ' + needIntegral +
          (lim.limit > 0 ? ' · ' + (lim.account ? '账号限购 ' : '每周限兑 ') + lim.limit + ' 次（已购 ' + lim.bought + '）' : '') + '</p>' +
      '</div></div>',
      [{ label: '返回', cls: 'muted' }, { label: '确认兑换', cls: 'gold', run: () => {
        if (redeemed || State.state() !== s) return;
        refreshRankShopDay();
        const lim2 = rankLimitInfo(item);
        if (lim2.limit > 0 && lim2.bought >= lim2.limit) {
          alert(lim2.account ? '该奖励每个账号累计只能兑换 ' + lim2.limit + ' 次，已经兑换完了。' : '该奖励本周的兑换次数已用完。');
          return;
        }
        if (Number(s.goldCup) < needCup || Number(s.goldPoint) < needGold) { alert('金杯或金松果不足。'); return; }
        redeemed = true;
        s.goldCup -= needCup; s.goldPoint -= needGold;
        if (item.type === '2') State.addGear(+item.goodsId, State.randomExt(2));
        else addProp(+item.goodsId, +item.count);
        const bag = lim2.account ? s.rankPurchaseTotals : s.rankPurchases;
        bag[item.id] = (bag[item.id] || 0) + 1;
        State.save();
        C().toast('兑换成功：' + item.name);
        if (typeof onDone === 'function') onDone();
      } }], { small: true });
  }
  function rankShop(pg, origin) {
    /* 经典模式：直接复用道具页「商店」的版面（6 格/页、右侧说明、翻页、悬停变绿），
     * 只把商品源/售价换成金杯+金松果。`origin` 决定退出回哪一页：
     *   'shop'   = 从道具商店底栏进来 → 回商店；
     *   'ladder' = 从天梯菜单进来 → 回天梯菜单（缺省）。 */
    if (window.UI && UI.currentUiMode && UI.currentUiMode() === 'classic'
        && UI.classic && UI.classic.openRankShop) {
      UI.classic.openRankShop(pg || 0, origin || 'ladder');
      return;
    }
    const s = State.state();
    if (s.level < 30) { alert('\u5929\u68af\u5546\u5e97\u9700\u8981\u8fbe\u523030\u7ea7\u3002'); return; }
    refreshRankShopDay();
    const goods = []; rankgoodsMap.each((id, item) => goods.push(item));
    const total = Math.ceil(goods.length / 6); pg = Math.max(0, Math.min(pg || 0, total - 1));
    const selected = goods.slice(pg * 6, pg * 6 + 6);
    const limitOf = (item) => {
      const lim = rankLimitInfo(item);
      return lim.limit > 0 ? (lim.account ? '账号限购 ' : '每周限兑 ') + lim.limit + ' 次（已' + (lim.account ? '购 ' : '兑 ') + lim.bought + '）' : '';
    };
    const p = C().page('bag', 'shop', '<div class="extra-shop-balance">\u91d1\u676f ' + s.goldCup + '\u3000\u91d1\u677e\u679c ' + s.goldPoint + '\u3000\u79ef\u5206 ' + s.integral + '</div><div class="extra-shop-grid">' + selected.map(item => '<button class="extra-shop-item" data-goods="' + item.id + '">' + (item.type === '2' ? image('images/ui/icons/gear/gear-' + item.goodsId + '.png', item.name) : C().icon('prop', +item.goodsId)) + '<b>' + esc(item.name) + '</b><span>' + item.cup + '\u91d1\u676f + ' + item.gold + '\u91d1\u677e\u679c</span><small>\u79ef\u5206\u9700 ' + item.integral + (limitOf(item) ? ' \u00b7 ' + limitOf(item) : '') + '</small></button>').join('') + '</div><div class="extra-pagination">' + button('\u4e0a\u4e00\u9875', 'rank-shop-prev', 'tiny muted') + '<span>' + (pg + 1) + '/' + total + '</span>' + button('\u4e0b\u4e00\u9875', 'rank-shop-next', 'tiny muted') + '</div>', { cls: 'extra-board extra-cup-shop' });
    back(p, rank, '\u8fd4\u56de\u5929\u68af\u8d5b');
    on(p, 'rank-shop-prev', () => rankShop(Math.max(0, pg - 1)));
    on(p, 'rank-shop-next', () => rankShop(Math.min(total - 1, pg + 1)));
    p.querySelectorAll('[data-goods]').forEach(element => element.onclick = () => {
      const item = rankgoodsMap.getValue(element.dataset.goods);
      let redeemed = false;
      C().modal('\u91d1\u676f\u5151\u6362', '<p>\u5151\u6362\u3010' + esc(item.name) + '\u3011</p><p>' + esc(item.remark) + '</p><p>\u9700\u8981\uff1a' + item.cup + '\u91d1\u676f\u3001' + item.gold + '\u91d1\u677e\u679c\uff0c\u79ef\u5206\u8fbe\u5230' + item.integral + '\u3002</p>', [{ label: '\u786e\u8ba4\u5151\u6362', run: () => {
        if (redeemed || State.state() !== s) return;
        refreshRankShopDay();
        if (s.integral < +item.integral) { alert('\u5929\u68af\u79ef\u5206\u5c1a\u672a\u8fbe\u5230\u5151\u6362\u8981\u6c42\u3002'); return; }
        if (s.goldCup < +item.cup || s.goldPoint < +item.gold) { alert('\u91d1\u676f\u6216\u91d1\u677e\u679c\u4e0d\u8db3\u3002'); return; }
        const lim = rankLimitInfo(item);
        if (lim.limit > 0 && lim.bought >= lim.limit) {
          alert(lim.account ? '\u8be5\u5956\u52b1\u6bcf\u4e2a\u8d26\u53f7\u7d2f\u8ba1\u53ea\u80fd\u5151\u6362 ' + lim.limit + ' \u6b21\uff0c\u5df2\u7ecf\u5151\u6362\u5b8c\u4e86\u3002' : '\u8be5\u5956\u52b1\u672c\u5468\u7684\u5151\u6362\u6b21\u6570\u5df2\u7528\u5b8c\uff0c\u4e0b\u5468\u4e00\u91cd\u7f6e\u540e\u53ef\u518d\u5151\u6362\u3002');
          return;
        }
        redeemed = true;
        s.goldCup -= +item.cup; s.goldPoint -= +item.gold;
        if (item.type === '2') State.addGear(+item.goodsId, State.randomExt(2)); else addProp(+item.goodsId, +item.count);
        const bag = lim.account ? s.rankPurchaseTotals : s.rankPurchases;
        bag[item.id] = (bag[item.id] || 0) + 1; State.save(); C().toast('\u5151\u6362\u6210\u529f\uff1a' + item.name); rankShop(pg);
      } }, { label: '\u8fd4\u56de', cls: 'muted' }], { small: true });
    });
  }

  // \u666e\u901a\u836f\u4e38\uff08\u5927\u529b/\u654f\u6377/\u901f\u5ea6/\u7ecf\u9a8c\u4e38\uff09\uff1a\u62bd\u5956\u91cc\u7684\u300c\u968f\u673a\u666e\u901a\u836f\u4e38\u00d72\u300d\u4ece\u8fd9\u56db\u79cd\u91cc\u62bd
  /* ============================================================
   * 【EX3】抽奖
   * ============================================================ */
  const NORMAL_PILLS = [3, 4, 5, 7];
  /* 高级药丸（2026-10 用户口径）：抽奖里的「随机药丸」有 5% 概率升格成这一档 ——
   * 与普通药丸一一对应（超级大力/敏捷/速度/经验丸，见 gamedict 41~44）。 */
  const SUPER_PILLS = [41, 42, 43, 44];
  const SUPER_PILL_CHANCE = 0.05;
  const prizes = [
    { id: 22, count: 10, label: '\u6b66\u5668\u5377\u8f74 \u00d710' }, { id: 21, count: 10, label: '\u6280\u80fd\u5377\u8f74 \u00d710' },
    { id: 26, count: 3, label: '\u84dd\u8272\u788e\u7247 \u00d73' }, { id: 15, exp: 50, label: '\u7ecf\u9a8c +50' },
    { id: 15, exp: 100, label: '\u7ecf\u9a8c +100' }, { id: 8, gold: 40, label: '\u91d1\u677e\u679c +40' },
    /* 大体力药剂（2026-10 用户口径）：×4 → ×3（第十六批）→ **×2（本轮回调）**。 */
    { id: 23, count: 2, label: '\u6311\u6218\u4e66 \u00d72' }, { id: 2, count: 2, label: '\u5927\u4f53\u529b\u836f\u5242 \u00d72' },
    /* 随机药丸（2026-10 用户口径）：从「随机两枚普通药丸」削弱成**随机一枚**，
     * 其中 5% 概率抽到**高级药丸**（SUPER_PILL_CHANCE）。
     * 概率**不写在奖池格子上**（用户口径 2026-10：格子上那句「（5% 高级）」去掉）——
     * 抽中时结算弹窗会写明拿到了哪一枚（高级那档带「（高级！）」后缀）。 */
    { id: 7, pills: 1, superChance: SUPER_PILL_CHANCE, label: '\u968f\u673a\u836f\u4e38 \u00d71' }, { id: 36, count: 2, label: '\u82f1\u96c4\u5e16 \u00d72' },
  ];
  let spinning = false, lotteryVersion = 0, lotteryBackPage = null;
  /** 经典抽奖统一图标：金松果（8）用经典道具页那颗金松果，不再用现代 prop-8。 */
  const lotteryIcon = (id) => (Number(id) === 8 && C().goldIcon) ? C().goldIcon() : C().icon('prop', id);
  function refreshLotteryDay() {
    const s = State.state(), today = State.localDate(), legacyToday = new Date(Date.now()).toDateString();
    if (s.lotteryDate === today) return;
    if (s.lotteryDate !== legacyToday) s.lotteryFree = 1;
    s.lotteryDate = today; State.save();
  }
  function refreshTickets() {
    const s = State.state(); if (!s) return;
    const n = s.props[50] || 0;
    /* 注意：`$$` 是 classic-ui.js 内部的局部函数、**不是全局**，所以这里自己查 DOM。
     * 没有真实 DOM 时（单测的沙箱）静默跳过 —— 刷新展示失败不该中断存档流程。 */
    const paint = (sel) => {
      const root = (typeof document !== 'undefined' && document) ? document : null;
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll(sel).forEach((el) => { el.textContent = n; });
    };
    paint('[data-lottery-ticket]');
    paint('[data-live-ticket]');
    if (window.UI && UI.refreshHeader) { try { UI.refreshHeader(); } catch (e) { /* 顶栏刷新失败不影响抽奖卷 */ } }
  }
  function lottery() {
    // Rewards are already settled before the animation. Reopening the page may
    // dismiss that animation; its pending timer must not lock the new controls.
    const version = ++lotteryVersion;
    spinning = false;
    /* 上次打开时挂在页面上的原版 3911 返回键视图：重开前先收掉，别让它在播放表里空转。 */
    if (lotteryBackPage && C().destroyClassicBack) {
      try { C().destroyClassicBack(lotteryBackPage); } catch (e) {}
    }
    lotteryBackPage = null;
    refreshLotteryDay();
    const s = State.state();
    const TICKET = 50;

    /** 当前手上的抽奖资源：每日免费次数 + 仓库抽奖卷 + 金松果（每次 20）。 */
    const affordable = (n) => Math.max(0, s.lotteryFree || 0) + Math.max(0, s.props[TICKET] || 0)
      + Math.floor(Math.max(0, s.goldPoint) / 20) >= n;
    const spinLabel = () => (s.lotteryFree > 0 ? '免费抽奖'
      : (s.props[TICKET] || 0) > 0 ? '用抽奖卷抽奖' : '20 金松果抽奖');
    /** 一次抽奖的**立即结算**（扣费顺序：每日免费 → 抽奖卷 → 20 金松果）。
     *  一次点击立即结算，离开动画页或刷新页面不会漏奖或多发奖励。 */
    const settleOne = () => {
      if (s.lotteryFree > 0) s.lotteryFree--;
      else if (s.props[TICKET] > 0) { s.props[TICKET]--; if (s.props[TICKET] <= 0) delete s.props[TICKET]; }
      else s.goldPoint -= 20;
      const selected = Math.floor(Math.random() * prizes.length), prize = prizes[selected];
      // 「随机药丸 ×1」：当场抽一枚普通药丸；5% 概率升格成高级药丸（超级大力/敏捷/速度/经验丸）。
      let label = prize.label, icon = prize.id, superPill = false;
      if (prize.pills) {
        superPill = Math.random() < (Number(prize.superChance) || 0);
        const table = superPill ? SUPER_PILLS : NORMAL_PILLS;
        const pid = table[Math.floor(Math.random() * table.length)];
        addProp(pid, prize.pills);
        label = (propMap.getValue(pid) || { name: pid }).name + ' \u00d7' + prize.pills +
          (superPill ? '\uff08\u9ad8\u7ea7\uff01\uff09' : '');
        icon = pid;
      }
      if (prize.gold) State.addGold(prize.gold);
      if (prize.count) addProp(prize.id, prize.count);
      const ups = prize.exp ? State.gainExp(prize.exp) : [];
      // 每日任务「抽取 {n} 次每日幸运抽奖」：一抽算一次（奖励当场结算，离开动画页也照样计数）
      if (State.bumpDaily) State.bumpDaily('lottery', 1);
      return { label, icon, selected, ups, superPill };
    };

    const content = '<h2 class="extra-lottery-heading cartoon">\u6bcf\u65e5\u5e78\u8fd0\u62bd\u5956</h2>' +
      '<div class="lottery-ticket-corner">\u62bd\u5956\u5377 <b data-lottery-ticket>' + (s.props[TICKET] || 0) + '</b> \u5f20</div>' +
      '<div class="extra-lottery-prizes">' +
      prizes.map((prize, i) => '<div class="extra-prize" data-prize="' + i + '">' + lotteryIcon(prize.id) + '<span>' + prize.label + '</span></div>').join('') +
      '</div>' +
      '<div class="extra-lottery-footer"><div><b data-lottery-status>\u4eca\u65e5\u514d\u8d39 ' + s.lotteryFree + ' \u6b21</b></div>' +
      '<div class="lottery-buttons">' +
      button(spinLabel(), 'lottery-spin', 'gold') + button('\u8fde\u62bd 10 \u6b21', 'lottery-spin10', 'gold') + '</div></div>';
    /* 顶部「背包 / 商店 / 兑换」用道具页同一套原版页签矢量；底部不再自建手绘底栏，
     * 改挂「随机挑战 → 查看」那一页的原版 3911 返回键（与金杯商店共用同一份实现）。 */
    const p = C().page('bag', 'bag', content, { cls: 'extra-board lottery-extra-board', noFooter: true });
    lotteryBackPage = p;
    if (C().installBagTabVectors) C().installBagTabVectors(p);
    if (C().wirePopTaps) C().wirePopTaps(p, { tabs: true });
    const leaveLottery = () => {
      if (C().destroyClassicBack) { try { C().destroyClassicBack(p); } catch (e) {} }
      lotteryBackPage = null;
      UI.runAction('bag');
    };
    if (C().mountClassicBack) C().mountClassicBack(p, leaveLottery);
    /* 从顶部页签切走时也收掉 3911 的视图（否则旧页面被移除后它还在播放表里）。 */
    if (p.addEventListener) {
      p.addEventListener('click', (ev) => {
        const hit = ev.target && ev.target.closest ? ev.target.closest('.classic-tabs .uc-tab') : null;
        if (!hit) return;
        if (C().destroyClassicBack) { try { C().destroyClassicBack(p); } catch (e) {} }
        lotteryBackPage = null;
      }, true);
    }

    /* 抽奖动画：依次点亮奖品格；结束后回调（单抽 / 连抽共用）。 */
    const animateThen = (steps, done) => {
      let step = 0;
      const walk = () => {
        if (version !== lotteryVersion) return;
        if (!p.isConnected) { spinning = false; return; }
        p.querySelectorAll('[data-prize]').forEach((cell) => cell.classList.toggle('lit', +cell.dataset.prize === step % prizes.length));
        if (step++ < steps) { setTimeout(walk, step > steps - 5 ? 125 : 55); return; }
        done();
      };
      walk();
    };
    const setBusy = (busy) => {
      p.querySelectorAll('.lottery-buttons .uc-button').forEach((b) => { b.disabled = busy; });
      const one = find(p, '[data-action="lottery-spin"]');
      if (one) one.textContent = busy ? '\u62bd\u5956\u4e2d\u2026' : spinLabel();
      const ten = find(p, '[data-action="lottery-spin10"]');
      if (ten) ten.textContent = busy ? '\u62bd\u5956\u4e2d\u2026' : '\u8fde\u62bd 10 \u6b21';
    };
    /** 抽完之后统一收尾：刷新免费次数 / 抽奖卷 / 顶栏金松果。 */
    const afterDraw = () => {
      spinning = false; setBusy(false);
      const st = find(p, '[data-lottery-status]');
      if (st) st.textContent = '\u4eca\u65e5\u514d\u8d39 ' + s.lotteryFree + ' \u6b21';
      refreshTickets();
      if (UI.refreshHeader) UI.refreshHeader();
    };

    const spin = on(p, 'lottery-spin', () => {
      if (version !== lotteryVersion || !p.isConnected || spinning) return;
      refreshLotteryDay();
      if (!affordable(1)) { alert('\u91d1\u677e\u679c\u4e0d\u8db320\u4e14\u6ca1\u6709\u62bd\u5956\u5377\uff0c\u660e\u5929\u8fd8\u6709\u4e00\u6b21\u514d\u8d39\u673a\u4f1a\u3002'); return; }
      spinning = true; setBusy(true);
      const got = settleOne();
      State.save();
      animateThen(20 + got.selected, () => {
        afterDraw();
        C().modal('\u83b7\u5f97\u5956\u52b1', '<div class="extra-lottery-win">' + lotteryIcon(got.icon) + '<strong>' + got.label + '</strong></div>' + C().upsHtml(got.ups), [{ label: '\u786e\u5b9a' }], { small: true });
      });
    });
    spin.disabled = spinning;

    const spin10 = on(p, 'lottery-spin10', () => {
      if (version !== lotteryVersion || !p.isConnected || spinning) return;
      refreshLotteryDay();
      if (!affordable(10)) {
        alert('\u8fde\u62bd 10 \u6b21\u9700\u8981 10 \u6b21\u7684\u8d44\u6e90\uff1a\u4eca\u65e5\u514d\u8d39 ' + Math.max(0, s.lotteryFree || 0) +
          ' \u6b21 + \u62bd\u5956\u5377 ' + Math.max(0, s.props[TICKET] || 0) + ' \u5f20 + \u91d1\u677e\u679c ' +
          Math.max(0, s.goldPoint) + '\uff08\u6bcf\u6b21 20\uff09\u3002');
        return;
      }
      spinning = true; setBusy(true);
      const got = [];
      for (let i = 0; i < 10; i++) got.push(settleOne());
      State.save();
      animateThen(24, () => {
        afterDraw();
        const cells = got.map((g) => '<div class="extra-prize won">' + lotteryIcon(g.icon) +
          '<span>' + g.label + '</span></div>').join('');
        const ups = [];
        for (const g of got) if (g.ups && g.ups.length) ups.push.apply(ups, g.ups);
        C().modal('\u8fde\u62bd 10 \u6b21', '<div class="extra-lottery-win grid"><div class="lottery-result-grid">' +
          cells + '</div></div>' + C().upsHtml(ups), [{ label: '\u786e\u5b9a' }], { small: true });
      });
    });
    spin10.disabled = spinning;
  }
  /* ============================================================
   * 【EX4】师徒系统
   * ============================================================ */
  // ==================== \u5e08\u5f92\u7cfb\u7edf ====================
  // \u53c2\u8003\u8bbe\u5b9a\uff1a\u62dc\u5e08\u540e\u81ea\u52a8\u5b66\u4f1a\u300c\u5e08\u7236\u9a7e\u5230\u300d\uff1b\u6536\u5f92\u9700\u5148\u6253\u8d25\u5bf9\u65b9\uff08\u5bf9\u65b9\u5df2\u6709\u5e08\u7236\u5219\u6253\u4ed6\u5e08\u7236\uff09\uff1b
  // \u6536\u5f92\u4e0a\u9650\u968f\u7b49\u7ea71/2/3\u4eba\uff1b\u6628\u65e5\u65e5\u8d21\u7531\u6301\u4e45\u5316\u7684\u6709\u9650\u79bb\u7ebf\u6218\u6597\u8d26\u76ee\u630910%/5%\u7ed3\u7b97\u3002
  // \u5e08\u7236\u6bcf\u5929\u53ef\u8e22 1 \u4e2a\u5f92\u5f1f\uff1b\u5f92\u5f1f\u4e3b\u52a8\u9000\u5e08\u95e8\u82b1 20 \u91d1\u677e\u679c\u3002
  const MASTER_CANDIDATE_COUNT = 3;
  const RECRUIT_CANDIDATE_COUNT = 3;

  /** \u5e08\u7236\u5019\u9009\u4eba\uff1a\u7b49\u7ea7\u5728\u73a9\u5bb6\u7b49\u7ea7\u4e0a\u65b9\u6709\u8f83\u5927\u968f\u673a\u8303\u56f4\uff08\u4e0d\u8d85\u8fc7\u6ee1\u7ea7\uff09\uff0c\u5e76\u5e26\u5b8c\u6574\u5c5e\u6027/\u6b66\u5668/\u6280\u80fd\u3002 */
  function rollMasterCandidates() {
    const s = State.state();
    const cap = State.MAX_PLAYER_LEVEL || 90;
    const base = Math.max(3, Math.min(s.level, cap));
    return Array.from({ length: MASTER_CANDIDATE_COUNT }, () => {
      // \u5e08\u7236\u901a\u5e38\u6bd4\u5f92\u5f1f\u5f3a\uff1a+2 ~ +12 \u7ea7\uff0c\u4f46\u4e0d\u4f1a\u8d85\u8fc7\u6ee1\u7ea7
      const level = Math.min(cap, Math.max(2, base + 2 + Math.floor(Math.random() * 11)));
      return State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
    });
  }
  /** \u53ef\u6536\u670d\u5f92\u5f1f\u5019\u9009\u4eba\uff1a\u7b49\u7ea7\u63a5\u8fd1\u73a9\u5bb6\uff08\u4e0d\u8d85\u8fc7\u6ee1\u7ea7\uff09\uff0c\u5e26\u5b8c\u6574\u5c5e\u6027\u4fbf\u4e8e\u67e5\u770b\u540e\u518d\u51b3\u5b9a\u3002 */
  function rollRecruitCandidates() {
    const s = State.state();
    const cap = State.MAX_PLAYER_LEVEL || 90;
    return Array.from({ length: RECRUIT_CANDIDATE_COUNT }, () => {
      const base = Math.max(1, s.level + (Math.random() < 0.5 ? -2 : 0));
      const foe = State.genAI(base, '', { levelJitter: 2, gearSelfLevel: true });
      // \u5f92\u5f1f\u4e0d\u4f1a\u6bd4\u5e08\u7236\u5f3a\u592a\u591a\uff0c\u4e5f\u4e0d\u4f1a\u8d85\u8fc7\u6ee1\u7ea7
      foe.level = Math.max(1, Math.min(cap, Math.min(foe.level, s.level + 1)));
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
    const sum = State.apprenticeLevelSum(State.state().prentices);
    const pct = (v) => (Math.round(v * 1000) / 10) + '%';
    return '<div class="profile-panel">' +
      '<p class="profile-meta">入门：' + esc(row.since) + '</p>' +
      /* 经验与金松果的日供系数是两条线性插值（各自区间不同），分别显示。 */
      '<p class="profile-meta">徒弟等级之和 <b>' + sum + '</b> → 日供系数：经验 <b>' +
        pct(daily.expRatio != null ? daily.expRatio : daily.ratio) + '</b> · 金松果 <b>' +
        pct(daily.goldRatio != null ? daily.goldRatio : daily.ratio) + '</b>' +
        '（线性插值：经验 5%~15%、金松果 5%~25%，三个满级徒弟封顶）</p>' +
      '<p class="profile-meta">我 ' + esc(daily.date) + ' 赚到：经验 ' + daily.mine.exp + ' · 金松果 ' + daily.mine.gold + '</p>' +
      '<p class="profile-meta">这个徒弟的份额 ' + pct(daily.weight) + ' → 昨日日贡：' +
        (daily.claimed ? '<b class="done">已领取</b>' : '<b>经验 ' + daily.exp + ' · 金松果 ' + daily.gold + '</b>') +
        (daily.newApprentice ? '（今日新收，次日才开始结算）' : '') + '</p>' +
      profileStats(row) + profileGear(row) + '</div>';
  }

  let masterCandidates = [], recruitCandidates = [];
  let masterSel = 0, recruitSel = 0, apprenticeSel = 0, recruitBusy = false, recruitOwner = null;
  let masterTab = 'master';

  /* ============================================================
   * 【EX1b】徒弟日供：领取入口与结算弹窗
   * 活动页（每日礼包那一屏）与师徒页共用这一条路径 —— 两边按钮都调 claimTribute()，
   * 所以「领一次」的判定只有 State 一处，界面不会各写一套。
   * ============================================================ */
  /** 每个徒弟今天还能领的日供（领取前调用，用来做「这份是谁供的」明细）。 */
  function tributeRows() {
    return (State.state().prentices || []).map((p) => {
      const d = State.apprenticeDailyStatus(p);
      return { name: p.name, level: p.level, exp: d.exp, gold: d.gold, claimable: d.claimable, claimed: d.claimed };
    });
  }
  /** 活动页那张日供卡要显示的状态：能不能领 / 领过了 / 还没徒弟。 */
  function tributeStatus() {
    const rows = tributeRows(), total = State.apprenticeDailyTotal();
    const claimable = (total.exp > 0 || total.gold > 0);
    return {
      rows, exp: total.exp, gold: total.gold, count: rows.length, claimable,
      claimed: rows.length > 0 && !claimable && rows.every((r) => r.claimed),
    };
  }
  /** 领日供 + 结算弹窗。`after` 在玩家确认后回调（活动页用它重画弹窗，师徒页用它回页）。 */
  function claimTribute(after) {
    const done = () => { if (after) after(); };
    const rows = tributeRows().filter((r) => r.claimable);
    const r = State.claimApprenticeExp();
    if (!r.ok) { C().toast(r.msg); done(); return r; }
    /* 结算面板走升级奖励那一套 reward-card（图标 + 数值），比原来一行大字更好认；
     * 下面再列一条明细，说明这一份日供分别是哪个徒弟供的。 */
    const card = (cls, art, label, value) => value > 0
      ? '<div class="reward-card ' + cls + '"><span class="reward-icon">' + art + '</span>' +
        '<span class="reward-text">' + label + ' +' + esc(value) + '</span></div>' : '';
    const cards = card('green', '<img alt="" class="reward-icon-img" src="images/ui/icons/drop-exp-classic.png">', '经验', r.total) +
      card('gift', C().goldIcon ? C().goldIcon() : C().icon('prop', 8), '金松果', r.gold);
    const detail = rows.length
      ? '<div class="tribute-rows">' + rows.map((x) =>
          '<div class="tribute-row"><b class="tribute-name">' + esc(x.name) + '</b>' +
          '<span class="tribute-level">Lv' + esc(x.level) + '</span>' +
          '<span class="tribute-gain">经验 +' + esc(x.exp) + '　金松果 +' + esc(x.gold) + '</span></div>').join('') +
        '<p class="tribute-foot">共 ' + rows.length + ' 位徒弟的昨日日供</p></div>'
      : '';
    C().modal('徒弟日供', '<div class="tribute-claim">' +
        '<div class="reward-panel"><div class="reward-row">' + (cards || '<span class="tribute-none">昨日没有可结算的收益</span>') + '</div></div>' +
        detail +
      '</div>' + C().upsHtml(r.ups),
      [{ label: '确定', run: done }], { small: true });
    return r;
  }
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
    const unclaimed = dailyTotal.exp > 0 || dailyTotal.gold > 0;
    const apprenticeBlock =
      '<div class="extra-apprentice-title"><h3>\u6211\u7684\u5f92\u5f1f\uff08' + s.prentices.length + '/' + cap + '\uff09</h3>' +
      (unclaimed ? button('\u9886\u53d6\u6628\u65e5\u65e5\u8d21 +' + dailyTotal.exp + '\u7ecf\u9a8c +' + dailyTotal.gold + '\u91d1\u677e\u679c', 'master-claim', 'tiny gold') : '<span class="daily-done">\u6682\u65e0\u53ef\u9886\u6628\u65e5\u65e5\u8d21</span>') + '</div>' +
      '<p class="extra-master-tip">\u65e5\u4f9b = \u5f92\u5f1f\u7b49\u7ea7\u4e4b\u548c\u51b3\u5b9a\u7684\u7cfb\u6570 \u00d7 \u6211\u81ea\u5df1\u6628\u65e5\u8d5a\u5230\u7684\u603b\u7ecf\u9a8c\u4e0e\u91d1\u677e\u679c\uff0c\u6b21\u65e5\u9886\u53d6\uff1a\u4fdd\u5e95 10%\uff0c\u5f92\u5f1f\u7b49\u7ea7\u4e4b\u548c 210\uff08\u4e09\u4e2a\u6ee1\u7ea7\uff09\u5c01\u9876 50%\uff0c\u4e2d\u95f4\u7ebf\u6027\u9012\u589e\u3002</p>' +
      '<div class="apprentice-row">' + (s.prentices.length
        ? s.prentices.map((a, i) => '<div class="candidate-card small' + (apprenticeSel === i ? ' active' : '') + '" data-prentice="' + i + '">' +
            '<b class="candidate-name">' + esc(a.name) + '</b><span class="candidate-level">\u7b49\u7ea7 ' + a.level + '</span>' +
            '<span class="candidate-hp">\u6628\u65e5 \u7ecf\u9a8c+' + State.apprenticeDailyExp(a) + ' \u91d1\u677e\u679c+' + State.apprenticeDailyGold(a) + '</span></div>').join('')
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
      image('images/ui/characters/master-classic.png', '\u5e08\u7236', 'extra-master-portrait') +
      '<div class="extra-master-main">' +
      '<div class="master-tabs">' +
        '<button type="button" class="uc-tab' + (masterTab === 'master' ? ' active' : '') + '" data-mtab="master">\u5e08\u7236</button>' +
        '<button type="button" class="uc-tab' + (masterTab === 'apprentice' ? ' active' : '') + '" data-mtab="apprentice">\u5f92\u5f1f</button>' +
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
      C().modal('\u62dc\u5e08\u6210\u529f', '<div class="extra-finalist">' + image('images/ui/characters/master-classic.png', '\u5e08\u7236') +
        '<div><h3>\u5e08\u7236\uff1a' + esc(cand.name) + '\uff08' + cand.level + '\u7ea7\uff09</h3>' +
        '<p>' + esc((r.learned && r.learned.msg) || '\u5df2\u5b66\u4f1a\u3010\u5e08\u7236\u9a7e\u5230\u3011') + '</p>' +
        '<p class="extra-master-tip">\u53d1\u52a8\u300c\u5e08\u7236\u9a7e\u5230\u300d\u53ef\u6062\u590d\u5e08\u7236\u7b49\u7ea7 \u00d74 \u7684\u751f\u547d\uff0c\u4e14\u4e0b\u4e00\u6b21\u653b\u51fb\u5fc5\u4e2d\u3002</p></div></div>',
        [{ label: '\u770b\u5e08\u7236', run: () => master('master') }, { label: '\u8fd4\u56de', cls: 'muted', run: () => master('master') }]);
    });
    on(p, 'master-leave', () => {
      if(!p.isConnected || State.state()!==s || !s.master)return;
      const cost = 20;
      const leavingMaster=s.master;
      let left=false;
      if (s.goldPoint < cost) { alert('\u9000\u5e08\u95e8\u9700\u8981 ' + cost + ' \u91d1\u677e\u679c\uff0c\u73b0\u5728\u53ea\u6709 ' + s.goldPoint + '\u3002'); return; }
      C().modal('\u51fa\u5e08', '<p>\u786e\u5b9a\u79bb\u5f00\u3010' + esc(s.master.name) + '\u3011\u7684\u5e08\u95e8\u5417\uff1f\u9700\u8981\u82b1\u8d39 ' + cost + ' \u91d1\u677e\u679c\uff0c\u4e4b\u540e\u53ef\u4ee5\u91cd\u65b0\u62dc\u5e08\u3002</p>',
        [{ label: '\u786e\u8ba4\u51fa\u5e08', run: () => {
          if(left || State.state()!==s || s.master!==leavingMaster)return;
          if(s.goldPoint<cost){alert('\u91d1\u677e\u679c\u4e0d\u8db320\uff0c\u65e0\u6cd5\u51fa\u5e08\u3002');return;}
          left=true;s.goldPoint-=cost;State.clearMaster();State.save();C().toast('\u5df2\u79bb\u5f00\u5e08\u95e8');master();
        } },
         { label: '\u8fd4\u56de', cls: 'muted' }], { small: true });
    });
    on(p, 'master-claim', () => claimTribute(() => master('apprentice')));
    on(p, 'prentice-leave', () => {
      const a = s.prentices[apprenticeSel];
      if (!a) return;
      const canKick = State.canKickToday();
      C().modal('\u8ba9\u5f92\u5f1f\u79bb\u5f00', '<p>\u8ba9\u3010' + esc(a.name) + '\u3011\u79bb\u5f00\u5e08\u95e8\uff0c\u7a7a\u51fa\u4e00\u4e2a\u6536\u5f92\u4f4d\u7f6e\uff1f</p>' +
        (canKick ? '' : '<p class="extra-master-tip">\u4eca\u5929\u5df2\u7ecf\u8e22\u8fc7\u4e00\u4e2a\u5f92\u5f1f\u4e86\uff0c\u8981\u7b49\u660e\u5929\u3002</p>'),
        canKick
          ? [{ label: '\u786e\u8ba4', run: () => { const r = State.kickPrentice(a.name); C().toast(r.msg); apprenticeSel = 0; master('apprentice'); } },
             { label: '\u8fd4\u56de', cls: 'muted' }]
          : [{ label: '\u786e\u5b9a', cls: 'muted' }], { small: true });
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
  /* ============================================================
   * 【EX5】排行榜（固定种子模拟榜）
   * ============================================================ */
  const RANK_LEVEL = 30;   // 原版天梯赛 30 级开启
  const TOPLIST_TABS = [['level', '\u7b49\u7ea7'], ['cup', '\u91d1\u676f'], ['integral', '\u79ef\u5206']];
  const TOPLIST_TITLES = ['\u677e\u9f20\u5c0f\u9738', '\u68ee\u6797\u4e00\u9738', '\u98ce\u901f\u4f20\u5947', '\u575a\u679c\u5927\u738b',
    '\u677e\u9f20\u5c0f\u9738\u4e8c\u4e16', '\u68a6\u5e7b\u6a61\u5b50', '\u91d1\u677e\u679c\u5b88\u62a4\u8005', '\u6708\u5149\u98de\u9f20',
    '\u96fe\u6797\u730e\u624b', '\u96ea\u539f\u65c5\u4eba', '\u53e4\u6811\u5b88\u671b\u8005', '\u661f\u8fb0\u4e4b\u5f71'];
  // 说明：以前原版的 Map.min.js 会覆盖全局 Map（window.Map），所以这里只能用手写对象缓存；
  // 现在数据走 js/gamedict.js（自带独立实现、不碰全局 Map），下面继续用手写对象也完全没问题。
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
    const ladderTab = toplistTab !== 'level';
    const cap = State.MAX_PLAYER_LEVEL || 90;
    const rows = [];
    for (let i = 0; i < 14; i++) {
      // 天梯榜上只会有够级的松鼠，所以看金杯/积分时对手一律按 30 级起算
      const base = Math.max(5, Math.min(cap, Math.round(s.level + (rnd() * 26 - 12))));
      const lv = ladderTab ? Math.max(RANK_LEVEL, base) : base;
      // 不满 30 级不算参赛：没有金杯也没有积分，等级榜里这两列按「—」显示
      const inLadder = lv >= RANK_LEVEL;
      rows.push({
        name: TOPLIST_TITLES[i % TOPLIST_TITLES.length],
        level: lv,
        cup: inLadder ? 2 + Math.floor(rnd() * Math.max(6, lv)) : 0,
        integral: inLadder ? 900 + Math.floor(rnd() * Math.max(400, lv * 70)) : 0,
        inLadder: inLadder,
        npc: true,
      });
    }
    // 天梯赛 30 级才开启：不够级就没有金杯与积分，也不进天梯榜
    const qualified = s.level >= RANK_LEVEL;
    rows.push({
      name: s.name, level: s.level,
      cup: qualified ? (s.goldCup || 0) : 0,
      integral: qualified ? (s.integral || 0) : 0,
      inLadder: qualified, npc: false,
    });
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
    const ladderTab = key === 'cup' || key === 'integral';
    const qualified = s.level >= RANK_LEVEL;
    const mineRow = rows.find((r) => !r.npc);
    // 不够 30 级就不进天梯榜：名次按等级榜算，金杯/积分显示为「—」
    const mine = ladderTab && !qualified ? null : rows.findIndex((r) => !r.npc) + 1;
    const rankText = mine ? '<b>' + mine + '</b> / ' + rows.length
      : '<span class="toplist-locked">\u672a\u53c2\u8d5b</span>';
    const header = '<div class="toplist-head"><span class="toplist-me">\u6211\u7684\u540d\u6b21\uff1a' + rankText +
      '</span><span class="toplist-week">' + (ladderTab ? '\u5929\u68af\u8d5b ' + RANK_LEVEL + ' \u7ea7\u5f00\u542f' : '\u6bcf\u5468\u4e00\u91cd\u7f6e') + '\u00b7\u79bb\u7ebf\u6a21\u62df</span></div>';
    const locked = ladderTab && !qualified
      ? '<div class="toplist-locked-note">\u5929\u68af\u8d5b\u9700\u8981 ' + RANK_LEVEL + ' \u7ea7\u624d\u80fd\u53c2\u52a0\uff0c\u4f60\u73b0\u5728 ' + s.level +
        ' \u7ea7\uff0c\u8fbe\u5230\u540e\u624d\u4f1a\u62e5\u6709\u91d1\u676f\u4e0e\u5929\u68af\u79ef\u5206\u3002</div>'
      : '';
    const tabs = '<div class="master-tabs toplist-tabs">' + TOPLIST_TABS.map(([id, label]) =>
      '<button class="uc-tab ' + (id === toplistTab ? 'active' : '') + '" data-action="' + id + '" aria-current="' + (id === toplistTab ? 'page' : 'false') + '">' + label + '</button>').join('') + '</div>';
    const list = '<div class="toplist-rows">' + rows.slice(0, 15).map((r, i) => {
      const rank = i + 1, medal = rank <= 3 ? '\u2460\u2461\u2462'[rank - 1] : String(rank);
      const shown = r.inLadder !== false;
      const cupText = ladderTab && r.npc === false && !qualified ? '\u2014' : (shown ? r.cup + ' \u91d1\u676f' : '\u2014');
      const scoreText = ladderTab && r.npc === false && !qualified ? '\u2014' : (shown ? String(r.integral) : '\u2014');
      return '<div class="toplist-row' + (r.npc ? '' : ' me') + (shown ? '' : ' unranked') + '"><span class="toplist-rank">' + medal + '</span>' +
        '<span class="toplist-name">' + esc(r.name) + (r.npc ? '' : '\uff08\u6211\uff09') + '</span>' +
        '<span class="toplist-lv">Lv ' + r.level + '</span>' +
        '<span class="toplist-cup">' + cupText + '</span>' +
        '<span class="toplist-score">' + scoreText + '</span></div>';
    }).join('') + '</div>';
    const foot = '<div class="extra-note">\u6392\u884c\u699c\u4e3a\u5355\u673a\u79bb\u7ebf\u6a21\u62df\uff1a\u5bf9\u624b\u540d\u5355\u6bcf\u5468\u56fa\u5b9a\uff0c\u4e0d\u8fde\u63a5\u771f\u5b9e\u73a9\u5bb6\u3002\u5f53\u524d\u6392\u5e8f\uff1a' +
      (key === 'cup' ? '\u91d1\u676f' : key === 'integral' ? '\u5929\u68af\u79ef\u5206' : '\u7b49\u7ea7') +
      (ladderTab && !qualified ? '\uff08\u4f60\u672a\u53c2\u8d5b\uff09' : '') + '\u3002</div>';
    const p = C().page('message', 'toplist', header + locked + tabs + list + foot, { cls: 'extra-board toplist-board' });
    on(p, 'level', () => { toplistTab = 'level'; toplistCache = Object.create(null); toplist(); });
    on(p, 'cup', () => { toplistTab = 'cup'; toplistCache = Object.create(null); toplist(); });
    on(p, 'integral', () => { toplistTab = 'integral'; toplistCache = Object.create(null); toplist(); });
  }

  // ---------- \u8d85\u7ea7\u677e\u9f20\uff08\u539f\u7248 VIP\uff1b\u6539\u6210\u91d1\u677e\u679c\u8d2d\u4e70\u7684\u5355\u673a\u7248\uff09 ----------
  /* \u7279\u6743\u6587\u6848\u4e0e\u7b49\u7ea7\u8868\u53d6\u81ea\u539f\u5ba2\u6237\u7aef js/ssdz-pkg2.js \u7684 VIP \u754c\u9762\u5185\u5d4c\u6587\u672c\uff0c
   * \u539f\u7248\u6309\u5929\u552e\u5356\uff08buyVIP.do\uff09\uff0c\u8fd9\u91cc\u6539\u6210\u91d1\u677e\u679c\u3002 */
  /* ============================================================
   * 【EX6】超级松鼠（VIP）
   * ============================================================ */
  const VIP_PRIVILEGES = [
    '\u89d2\u8272\u7b49\u7ea710\u7ea7\u4ee5\u4e0a\u7684VIP\u53ef\u4ee5\u8df3\u8fc7\u6218\u6597\uff08\u53ef\u81ea\u52a8\u83b7\u5f97\u70b9\u51fb\u7c7b\u9053\u5177\uff09',
    '\u88ab\u52a8\u7ecf\u9a8c\u4e0a\u9650\u5927\u5e45\u63d0\u9ad8\uff0c\u6700\u9ad8\u53ef\u8fbe400\u7ecf\u9a8c/\u5929',
    '\u4f53\u529b\u6062\u590d\u901f\u5ea6\u5927\u5e45\u52a0\u5feb\uff0c\u6700\u5feb\u53ef\u8fbe1.5\u500d',
    '\u6635\u79f0\u4ee5\u5c0a\u8d35\u6807\u8bc6\u5c55\u793a\uff0c\u5f70\u663e\u8eab\u4efd',
    '\u9996\u6b21\u5f00\u901a\uff0c\u6c38\u4e45\u8d60\u90016\u4e2a\u88c5\u5907\u683c\u5b50',
    '\u5e08\u5085\u5982\u679c\u662fVIP\uff0c\u5f92\u5f1f\u6bcf\u5929\u767b\u9646\u5c06\u989d\u5916\u83b7\u5f975-15\u4e2a\u91d1\u677e\u679c',
    '\u4e3b\u52a8\u6311\u6218VIP\u73a9\u5bb6\u6240\u5f97\u7ecf\u9a8c\u4e0a\u6da830%',
    '\u4f53\u529b\u4e0a\u9650 +60\uff08\u5f53\u524d\u7b49\u7ea7\u4e0a\u9650\u4e4b\u4e0a\uff09',
  ];
  function vip() {
    State.tickEnergy();
    const s = State.state();
    const active = State.vipActive(), level = State.vipLevel();
    const days = State.vipDaysLeft(), mul = State.vipRegenMul();
    const need = active ? State.vipExpNeed() : 0;
    const status = active
      ? '<div class="vip-status on"><span class="vip-crown">\u2605</span><div><h2>\u8d85\u7ea7\u677e\u9f20 Lv ' + level + '</h2>' +
        '<p>\u5269\u4f59 ' + days + ' \u5929\u3000\u4f53\u529b\u6062\u590d ' + mul.toFixed(1) + ' \u500d\u3000\u4f53\u529b\u4e0a\u9650 +' + State.VIP_ENERGY_BONUS + '\u3000\u88c5\u5907\u683c\u5b50 +' + State.VIP_GEAR_BONUS + '</p>' +
        '<p class="vip-exp">\u5347\u7ea7\u7ecf\u9a8c ' + s.vip.exp + ' / ' + need + '\uff08\u6bcf\u65e5\u9996\u6b21\u767b\u9646 +1\uff09</p></div></div>'
      : '<div class="vip-status off"><span class="vip-crown muted">\u2606</span><div><h2>\u5c1a\u672a\u5f00\u901a\u8d85\u7ea7\u677e\u9f20</h2>' +
        '<p>' + (Number(s.vip && s.vip.level) > 1 ? '\u4e0a\u6b21\u7b49\u7ea7 Lv ' + Number(s.vip.level) + '\uff0c\u7eed\u8d39\u540e\u4ece\u8fd9\u4e00\u7ea7\u7ee7\u7eed\u3002' : '') + '\u5f00\u901a\u540e\u7acb\u5373\u751f\u6548\uff0c\u5230\u671f\u540e\u7b49\u7ea7\u4e0e\u7ecf\u9a8c\u4fdd\u7559\uff08\u4e0d\u4f1a\u91cd\u7f6e\uff09\uff0c\u518d\u6b21\u8d2d\u4e70\u5373\u53ef\u7ee7\u7eed\u4eab\u53d7\u3002</p></div></div>';
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
    /* 与系统 / 帮助页同一套悬停、按下与点击回弹；老测试的 classic 桩没有这个函数时跳过。 */
    if (C().wireSystemFeedback) C().wireSystemFeedback(p);
  }

  /* ============================================================
   * 【EX7】导出 window.ClassicExtras
   * ============================================================ */
  window.ClassicExtras = {
    payArenaEntry, arena, startArenaCompete, chooseArena, startRankFlow, rank, rankShop: (pg, origin) => rankShop(pg || 0, origin), rankGoodsList, rankBuy, rankLimitInfo, rankMatch, lottery, refreshTickets, master, toplist, vip, lotteryPrizes: prizes,
    claimTribute, tributeStatus,
    /* 竞技场赛事页（`js/ssfight/ui-challenge.js` 的 `match` 子页）要用这两个：
     * 当前这轮的赛事快照，以及"打下一场"的入口。 */
    arenaRun: () => activeArenaRun(), saveArenaRun, fightArena: (run) => fightArena(run || activeArenaRun()),
    /* 回到赛事页时抹掉"打了一半"的 `busy`（见 `clearArenaBusy` 的注释）。 */
    clearArenaBusy,
    rankFoeLevel, rankFoeExpectLevel, claimRankCup };
})();
