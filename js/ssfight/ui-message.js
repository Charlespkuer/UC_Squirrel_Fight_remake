/* Classic message page (message frame / page-root symbol 7819, one frame only).
 * Renders the original export data via SfRender; State supplies the battle history
 * and the modals/fights come from Main / UI.classic (no server in this port).
 * Page API: SfMessage.open / destroy / current / debug.
 * Lifecycle, frame conventions and shared interaction live in ui-status.js style:
 * see js/ssfight/AGENTS.md and the same-named page modules.
 */
(function () {
  'use strict';

  /** 复刻侧公共交互件（测热区 / 动效壳 / 钉帧 / 写文本）在 `ui-main.js` 里实现并导出。 */
  const T = () => (window.SfUiMain && window.SfUiMain.toolkit) || null;
  const clipOf = (host, name) => (host && host.byName ? host.byName(name) : null);
  const toast = (msg) => { try { if (window.UI && UI.toast) UI.toast(msg); } catch (e) {} };
  /** 异步失败要留痕：`window.__errs` 是回归探针唯一能看见"点了没反应"的地方。 */
  const pushErr = (what, e) => { if (window.__errs) window.__errs.push(what + ': ' + (e && e.message)); };

  /* ============================================================
   * 这一页的原版出处：`MainMovie_frame100.as`（帧 100 的键盘逻辑）
   * + `MainMovie.as` 的 initMeaageView / showMessageTab / showMessage。
   * ------------------------------------------------------------
   * 页根元件 **7819 只有 1 帧**、28 个具名子元件：所有"换页"都是给子元件拨帧，
   * 页根自己从不动 —— 所以接线一次到位、每次重画只拨子元件的帧。
   *
   * ⚠ 原版 AS 里写的是 `message.msgTab.gotoAndStop(tab_wz)`，但导出数据实测这一帧的
   *   具名列表里**没有 `msgTab`**，四颗 tab 是直接挂在页根上的。照 AS 去取 `msgTab`
   *   只会拿到 null（复刻的"没有 AS 自动兜底"会把整页 tab 变成死键）——所以这里的
   *   四颗 tab 各自 `gotoAndStop`，**不碰 msgTab**。
   * ========================================================== */
  const TABS = [['tab', 'messages'], ['tab1', 'ranklog'], ['tab2', 'revenge'], ['tab3', 'chat']];
  /** tab 代号 ↔ 原版 `tab_wz`：1 消息 / 2 天梯赛 / 3 复仇 / 4 留言。 */
  const TAB_NUM = { messages: 1, ranklog: 2, revenge: 3, chat: 4 };
  /** 原版 `onePage_Count1 = 2`（`initMeaageView`）：一页两条记录。 */
  const ONE_PAGE = 2;

  /* ---------- 拨帧表（帧号全部来自导出数据实测 + AS 里的 gotoAndStop）----------
   * · `win1`/`win2`（3407，**8 帧**）：1 胜 / 2 败 / 3 未知 / 4 天梯赛 / 5 留言 /
   *   6·7 备用（导出里有画稿）/ **8 = 空档**。`doShowNormalMsg` 的规矩是
   *   **先 `gotoAndStop(_totalframes)` 清空**，再按 `msg.isWin` 拨 1/2/3；
   *   天梯赛与复仇走 `doShowRankMsg` → 固定第 4 帧；留言走 `doShowLeaveMsg` → 第 5 帧。
   * · `a1`/`a2`（4833，4 帧）：1 收徒 / 2 复仇（再次挑战）/ 3 同意加好友 / 4 空档。
   * · `b1`/`b2`（4821，4 帧）：1 查看录像 / 2 回复留言 / 3 拒绝 / 4 空档。
   * · `back1`/`back2`（3393，3 帧）：1 常态 / 2·3 高亮（后两帧画稿相同）。
   *   AS 从**不给它拨帧**，只在"这一条没有任何功能键"时把它当兜底按钮登记
   *   （`backMc.onFire = function () {}`）—— 所以它恒停第 1 帧，有功能键的那一条完全不接线。
   * · 里面那颗真按钮名是 `a` / `b`（44833 → 4828/4830/4832，4821 → 4815/4818/4820）：
   *   每颗 **3 帧**，第 1 帧常态、**第 2 帧 = 键盘光标停在这一行**、第 3 帧空档
   *   （`showButton(array, b_num)` 给选中的那颗 `gotoAndStop(2)`、其余 `gotoAndStop(1)`）。
   *   所以"鼠标悬停"照原版语义拨第 2 帧，而不是只给一层 CSS 光晕。 */
  const WIN_FRAME = { win: 1, lose: 2, unknown: 3, rank: 4, leave: 5 };
  const WIN_FRAME_EMPTY = 8;
  const KEY_FRAME_EMPTY = 4;
  const REVENGE_FRAME = 2;
  const REPLAY_FRAME = 1;
  const REPLY_FRAME = 2;

  /* 记录 kind → 人话（与 `js/classic-ui.js` 的 DOM 版 openMessages 同一张表、同一口径）。
   * ⚠ `State.recordBattle` 在缺 kind 时写的是**中文 '挑战'**（js/state.js:3488），
   *   所以这张表里必须同时有 'challenge' 与 '挑战'，否则那种记录会显示成"挑战 · 挑战"。 */
  const KIND_LABEL = {
    challenge: '挑战', '挑战': '挑战', stage: '关卡', tower: '挑战塔', endless: '无尽塔',
    arena: '竞技场', rank: '天梯赛', friend: '切磋', master: '师徒', revenge: '复仇', leave: '留言',
  };
  /** 复仇排除名单（与 `js/classic-ui.js` 的 REVENGE_EXCLUDED_KINDS 一致）。 */
  const REVENGE_EXCLUDED_KINDS = ['tower', 'endless', 'stage'];
  /** 这条记录能不能复仇：败绩 + 不是复仇自己 + 不在排除名单里。 */
  function canRevenge(r) {
    return !!r && r.winner !== 0 && r.kind !== 'revenge' && REVENGE_EXCLUDED_KINDS.indexOf(r.kind) < 0;
  }

  /* 本地没有服务端：留言页（tab 4）按 `doShowLeaveMsg` 的**排版**写一句说明，
   * 而不是留一页空白（原版这一档的正文是服务端下发的 leaveMessages）。 */
  const CHAT_NOTICE_BODY = '本地怀旧版暂不连接公共聊天与留言服务，这里保留原版留言页的排版。';
  const CHAT_NOTICE_HEAD = '本地怀旧版';
  /** 列表为空时给一句人话（原版这里是两条空记录，看着像坏了）。 */
  const EMPTY_HINT = {
    messages: '暂时没有战斗消息。去打一场挑战，战报就会记在这里。',
    ranklog: '还没有天梯赛记录。到竞技场参加天梯赛，胜负都会记在这里。',
    revenge: '还没有可以复仇的败绩。塔与关卡里的失败不计入复仇。',
  };

  /* ---------- 通用小件（与 ui-status.js 同一套写法） ---------- */
  /** 让元件**停在**某一帧（不自己播）。换帧会重建子树，所以调用方之后要重接内部按钮。 */
  function stopAt(clip, n) {
    if (!clip || !clip.gotoAndStop) return;
    try { clip.gotoAndStop(n); } catch (e) {}
  }
  /** 原版的 `mc.left._visible = false`（不是切禁用帧）—— 照抄成 CSS `visibility`。
   *  ⚠ 点击路由会把 `visibility:hidden` 的元件判成"谁都没命中"（见 ui-main.js 的 refresh），
   *    所以藏起来的箭头不会截住点击。 */
  function setVisible(clip, on) {
    if (clip && clip.g) clip.g.style.visibility = on ? '' : 'hidden';
  }
  function setTextByName(host, name, str) {
    const t = T();
    const n = clipOf(host, name);
    if (n && t) t.setText(n, str == null ? '' : String(str));
    return n;
  }
  /** 换帧会把 `<g>` 的子节点整个重建 —— 动效壳与点击区会一起没掉，所以每次 goTo 后重包一遍。 */
  function refreshShell(clip) {
    const t = T();
    if (!t || !clip || !clip.g) return;
    t.popWrap(clip);
    const shell = clip.g.querySelector(':scope > g.uc-pop');
    if (shell) t.wirePopPress(shell);
  }
  /** 把元件接成"可点"（常态帧 / 悬停帧 / 点击回调）。与状态页、挑战页同一套写法。
   *  `hover: 0` = 这一档没有"光标停在上面"的画稿（例：翻页箭头），反馈交给 `.sf-hover` 光晕。 */
  function wireClickable(clip, spec) {
    const t = T();
    if (!t || !clip || !clip.g) return;
    spec = spec || {};
    const idleOf = () => (typeof spec.idle === 'function' ? spec.idle() : (spec.idle == null ? 1 : spec.idle));
    clip.__pinFrame = null;
    clip.__msgFire = spec.onFire || null;
    clip.__msgIdle = idleOf;
    clip.__msgHover = Number(spec.hover) || 0;
    clip.__msgPress = Number(spec.press) || 0;
    /* 监听器只挂一次：重画时同一颗实例会被重新接线（新的 idle / onFire），不能重复 addEventListener。 */
    if (!clip.__msgListeners) {
      clip.__msgListeners = true;
      clip.g.addEventListener('mouseenter', () => {
        if (!clip.__msgHover) return;
        setPinned(clip, clip.__msgHover);
        refreshShell(clip);
      });
      clip.g.addEventListener('mouseleave', () => { pinIdle(clip); refreshShell(clip); });
      clip.g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (clip.__msgPress) {
          t.pressFlash(clip, idleOf(), () => { pinIdle(clip); refreshShell(clip); }, (f) => setPinned(clip, f));
        }
        if (clip.__msgFire) clip.__msgFire();
      });
    }
    pinIdle(clip);
    clip.g.style.cursor = 'pointer';
    clip.g.style.pointerEvents = 'auto';
    t.measureHitBox(clip);
    t.popWrap(clip);
    const shell = clip.g.querySelector(':scope > g.uc-pop');
    if (shell) t.wirePopPress(shell);
  }
  /** 明确拨到某一档并停住（不用 `__pinFrame`：那是"每一拍强制拨回"，会和界面自己的 gotoAndStop 打架）。 */
  function setPinned(clip, frame) {
    if (!clip || !clip.gotoAndStop) return;
    const want = Math.max(1, Math.round(Number(frame) || 1));
    clip.__pinFrame = null;
    if (clip.frame !== want - 1) { try { clip.gotoAndStop(want); } catch (e) {} }
    clip.playing = false;
  }
  /** 回到当前该停的那一档（选中 / 常态）。 */
  function pinIdle(clip) {
    if (!clip || !clip.__msgIdle) return;
    setPinned(clip, clip.__msgIdle());
  }

  /* ---------- 按字段框断行 ----------
   * `render.js` 的文本容器**只按框宽横向裁**、纵向放开：一整句塞进去会被切掉右半截，
   * 而正文那一格（`text1` 7818 / `text2` 7810）只有 233 宽、12 号字 —— 一行 19 个全角字，
   * 框高 44/52 → **最多 3 行**（行距 1.15em = 13.8），第 4 行会压到下一条记录上。
   * 全角字的步进用**这个字段已经画出来的那一行**实测；量不到（`blank` 把占位串清掉了，
   * 或者行是空的）就退回字号 —— 中文全角 ≈ 1em，与实测一致。
   * ⚠ 不查 `textfields-index.json` 的 `charsPerLine`：那份索引是生成期快照，目前**还没把
   *   消息页收进去**；运行时真值是 `__textBox.meta.bd`（就是 textfields.json 那一份），用它最稳。 */
  const wrapCache = new WeakMap();
  function wrapToField(clip, text, maxLines) {
    const src = String(text == null ? '' : text);
    if (!clip || !clip.__textBox) return src;
    const tb = clip.__textBox;
    if (!tb.meta || !tb.meta.bd) return src;
    const W = tb.meta.bd[1] - tb.meta.bd[0] - (tb.meta.lm || 0) - (tb.meta.rm || 0);
    if (!(W > 8)) return src;
    /* ⚠ 文本容器的 DOM 就是那个 `<g type="text">` 本身（`__textBox` 挂在它上面），不是 MovieClip。 */
    const el = clip.g || clip;
    const svg = el.ownerSVGElement || (el.ownerDocument && el.ownerDocument.querySelector('#ui svg')) || null;
    const vb = svg ? String(svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number) : null;
    const rect = svg && svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    const k = (rect && rect.width && vb && vb[2]) ? rect.width / vb[2] : 0;   // 屏幕像素 → 舞台单位
    let unit = wrapCache.get(clip);
    if (!unit) {
      unit = 0;
      try {
        const node = el.querySelector && el.querySelector('text');
        const r = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
        const n = node && node.textContent ? node.textContent.length : 0;
        if (k && r && r.width > 1 && n > 0) unit = (r.width / k) / n;
      } catch (e) { unit = 0; }
      if (!(unit > 0.2 && unit < 8)) {
        const h = parseFloat(tb.meta.fh) || 12;
        unit = h > 0 ? h : 12;
      }
      wrapCache.set(clip, unit);
    }
    const per = Math.max(3, Math.floor(W / unit));
    const out = [];
    for (const para of src.split('\n')) {
      let line = '', wid = 0;
      for (const ch of para) {
        const adv = ch.charCodeAt(0) < 0x2E80 ? 0.55 : 1;   // 半角按 0.55 折算
        if (wid + adv > per && line) { out.push(line); line = ''; wid = 0; }
        line += ch; wid += adv;
      }
      out.push(line);
    }
    /* 行数上限：正文那格放不下第 4 行，宁可截断也不要冲进下一条记录。 */
    if (maxLines && out.length > maxLines) {
      out.length = maxLines;
      out[maxLines - 1] = out[maxLines - 1].slice(0, Math.max(1, per - 1)) + '…';
    }
    return out.join('\n');
  }
  /** 写正文（`text1`/`text2`）与时间（`text11`/`text22`）都用它：先断行，再交给显示层。 */
  function writeField(node, text, maxLines) {
    const t = T();
    if (!node || !t) return;
    t.setText(node, wrapToField(node, text, maxLines));
  }

  /* ============================================================
   * 数据：四个 tab 各自的清单（`showMessageTab` 的四档）
   * ------------------------------------------------------------
   * ①消息 = 普通战斗消息（**不是**天梯赛的那些）；
   * ②天梯赛 = `kind === 'rank'`；③复仇 = 败绩且可复仇；④留言 = 本地说明（没有服务端）。
   * 原版这四份数据是服务端接口（getMessages / getRankMessage / getLeaveMessages），
   * 复刻全部落在 `State.battleHistory()` 这一份真值上。
   * ========================================================== */
  function listOf(tab, all) {
    if (tab === 'ranklog') return all.filter((r) => r && r.kind === 'rank');
    if (tab === 'revenge') return all.filter(canRevenge);
    if (tab === 'chat') return [{ notice: true }];
    return all.filter((r) => r && r.kind !== 'rank');
  }
  /** `MM-DD HH:MM`（照 DOM 版 openMessages 的格式化，月/日补零）。 */
  function timeText(ts) {
    const d = new Date(Number(ts) || 0);
    if (!Number.isFinite(d.getTime()) || !d.getTime()) return '';
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  /** 一条记录的正文（沿用 DOM 版 openMessages 的文案口径）。 */
  function bodyOf(r) {
    if (!r) return '';
    if (r.notice) return CHAT_NOTICE_BODY;
    const label = KIND_LABEL[r.kind] || String(r.kind || '挑战');
    const foe = (r.foe && r.foe.name) ? String(r.foe.name) : '对手';
    return label + ' · 你挑战了【' + foe + '】，' + (r.winner === 0 ? '获得胜利！' : '遗憾落败。');
  }
  function timeOf(r) {
    if (!r) return '';
    if (r.notice) return CHAT_NOTICE_HEAD;
    return timeText(r.createdAt);
  }
  /** 这一条能不能播录像（原版 `msg.combatId > 0`）。本地每条战斗记录都带 `result.rounds`。 */
  function replayable(r) {
    return !!(r && r.result && Array.isArray(r.result.rounds) && r.result.rounds.length);
  }

  /* ============================================================
   * 一条记录 → 各元件的档位 / 动作
   * ------------------------------------------------------------
   * `doShowNormalMsg`（tab 1）：`win` 按 isWin 拨 1/2/3，`a` 只有 `prenticeId > 0` 才是
   *   收徒（复刻没有这份服务端字段 → 恒停空档），`b` 只有 `combatId > 0` 才是查看录像。
   * `doShowRankMsg`（tab 2/3）：`win` 固定第 4 帧，`a` 是"复仇"（`revengeId > 0`），
   *   `b` 还是查看录像。
   * `doShowLeaveMsg`（tab 4）：`win` 第 5 帧、`a` 空档、`b` 第 2 帧（回复留言）。
   * ========================================================== */
  function planOf(r, tab) {
    if (!r) {
      return { win: WIN_FRAME_EMPTY, a: KEY_FRAME_EMPTY, b: KEY_FRAME_EMPTY,
        onA: null, onB: null, fallback: true, body: '', time: '' };
    }
    const body = bodyOf(r), time = timeOf(r);
    if (tab === 'chat') {
      return { win: WIN_FRAME.leave, a: KEY_FRAME_EMPTY, b: REPLY_FRAME, body, time,
        fallback: false, onB: () => toast('本地怀旧版暂不连接公共聊天与留言服务，无法回复留言。') };
    }
    const rankTab = tab === 'ranklog' || tab === 'revenge';
    const win = rankTab ? WIN_FRAME.rank : (r.winner === 0 ? WIN_FRAME.win : r.winner === 1 ? WIN_FRAME.lose : WIN_FRAME.unknown);
    /* 「复仇 / 再次挑战」：天梯赛与复仇页那一档是 `a` 的第 2 帧（原版 `revengeId > 0`）。
     * 复刻没有服务端字段，判据就用**本地那条败绩能不能复仇**（与 DOM 版 canRevenge 同一份规则）。 */
    const rev = rankTab && canRevenge(r);
    const rec = replayable(r);
    return {
      win: win,
      a: rev ? REVENGE_FRAME : KEY_FRAME_EMPTY,
      b: rec ? REPLAY_FRAME : KEY_FRAME_EMPTY,
      body: body, time: time,
      /* 没有任何功能键 → 原版把 `back`（那条记录整块底）当兜底按钮登记，点击**什么都不做**。 */
      fallback: !rev && !rec,
      onA: rev ? () => startRevenge(r) : null,
      onB: rec ? () => playReplay(r) : null,
    };
  }

  /* ============================================================
   * 交互：查看录像 / 再次挑战（复仇）
   * ------------------------------------------------------------
   * ⚠ 这两件事都会把玩家带离本页（`main.js` 的 replayBattle / startBattle 会先清空 `#ui`
   *   并在结束时 `showHome()`），所以回来时不是"重画"而是**重开**：把落点记进 `pending`，
   *   再走 `UI.runAction('messages')`（它带 `screen = 'message'` 与正确的宿主标记）。
   * ========================================================== */
  let pending = null;             // { tab, page, at } —— 从录像 / 复仇回来时的落点（open() 取走即清）
  /** 落点的有效期：它是"刚打完一场、马上回本页"用的，过期不候 ——
   *  否则某次回调没跑成（战斗被中断）会把它留到下一次进页面，把玩家丢到别的 tab / 页码上。 */
  const PENDING_MS = 15000;
  /** 回来时重开消息页（保持 tab 与页码）。 */
  function reopen(spot) {
    pending = spot ? { tab: spot.tab, page: spot.page, at: Date.now() } : null;
    if (window.UI && UI.runAction) { UI.runAction('messages'); return; }
    guard(open(null, spot && spot.tab, spot && spot.page));
  }
  function playReplay(record) {
    const spot = current ? { tab: current.tab, page: current.page } : null;
    if (!(window.Main && Main.replayBattle)) { toast('录像回放暂不可用'); return; }
    /* 回调在 `showHome()` **之后**才跑（js/main.js:824-828），那时本页已经被 renderHome 收掉了。 */
    Main.replayBattle(record, () => reopen(spot));
  }
  /** 复仇：拿录像里记下的对手快照再打一场（不消耗体力、不掉飘物，避免变成刷资源入口）。
   *  胜利 → `State.revengeReward` 发少量经验与金松果，并把这条记录标成「已复仇」。
   *  ⚠ `js/classic-ui.js` 的 `revengeFight` **没有**导出到 `UI.classic` 上（2026-10 实测），
   *    所以这里按它那份逻辑写一份最小实现，用的是同一批 `State` / `Main` 接口与同一套文案。 */
  function startRevenge(record) {
    if (!record || !(window.Main && Main.startBattle)) { toast('战斗模块未加载'); return; }
    if (record.revenged) { toast('这条败绩已经复仇过了。'); return; }
    const info = State.revengeInfo ? State.revengeInfo(record.id) : { cost: 20, cups: 0, cupsMin: 0, ladder: false, count: 0 };
    /* 只有天梯赛败绩的复仇才抢金杯，且为 0~1 个；普通挑战/竞技场复仇不参与金杯结算。
     * 确认与结算共用同一次掷点，避免文案和实际结果对不上。 */
    const ladder = !!(info.ladder || record.kind === 'rank');
    const cupRoll = ladder && Math.random() < 0.5 ? 1 : 0;
    const modal = (window.UI && UI.classic && UI.classic.modal) || null;
    const resultModal = (window.UI && UI.classic && UI.classic.resultModal) || null;
    const S = State.state();
    if (S.goldPoint < info.cost) {
      if (modal) modal('金松果不足', '<div class="result-box"><p>复仇需要 <b>' + info.cost + '</b> 个金松果，当前只有 <b>' + S.goldPoint + '</b> 个。<br>先去攒够金松果再来吧。</p></div>', [{ label: '知道了' }]);
      return;
    }
    const go = () => {
      if (State.state() !== S) return;
      if (S.goldPoint < info.cost) { toast('金松果不足，复仇取消。'); return; }
      State.addGold(-info.cost);
      State.noteRevenge(record.id);                      // 第 n 次复仇 → n 已经 +1
      const cups = cupRoll;
      const spot = current ? { tab: current.tab, page: current.page } : null;
      const foe = Object.assign({}, record.foe || {});
      Main.startBattle(foe, {
        region: record.region || 0, kind: 'revenge', useProps: false, collectDrops: false, skipResultPanel: true,
        onEnd: (winner) => {
          reopen(spot);
          if (winner !== 0) {
            if (modal) modal('复仇失败', '<div class="result-box"><div class="result-title lose">又输了</div><p>复仇消耗了 ' + info.cost + ' 个金松果，失败没有额外补偿。</p></div>', [{ label: '返回' }]);
            return;
          }
          if (!(window.State && State.markRevenged && State.markRevenged(record.id))) {
            if (modal) modal('复仇成功', '<div class="result-box"><div class="result-title win">胜 利！</div><p>这条败绩之前已经复仇过了，本次不再重复发补偿。</p></div>', [{ label: '返回' }]);
            return;
          }
          if (cups > 0) S.goldCup = Math.max(0, Number(S.goldCup) || 0) + cups;
          const rw = State.revengeReward(foe.level);
          State.save();
          const cupText = ladder
            ? (cups > 0 ? '，抢夺 ' + cups + ' 个金杯' : '，本次没有抢到金杯')
            : '';
          if (resultModal) resultModal(true, rw, '复仇成功：' + (foe.name || '对手') + ' 已被击败' + cupText + '，补回少量经验与金松果。', () => {});
        },
      });
    };
    /* 原版 `alertRevenge`（MainMovie.as:14526）：先弹「二次确认」，写清费用与金杯，
     * 确认后才扣金松果并开打。以前复刻直接开战：不确认、不扣费、不抢金杯。 */
    if (modal) {
      const reward = ladder
        ? '，胜利后抢夺 <b>0~1</b> 个金杯（本场随机：<b>' + cupRoll + '</b> 个）'
        : '，胜利后补回少量经验与金松果';
      const wallet = ladder
        ? '当前金松果：' + S.goldPoint + '　金杯：' + (S.goldCup || 0)
        : '当前金松果：' + S.goldPoint;
      if (window.SfChallenge && SfChallenge.openOriginalConfirm && current) {
        const plainReward = ladder ? '，胜利后抢夺0~1个金杯' : '，胜利后补回少量经验与金松果';
        SfChallenge.openOriginalConfirm({ owner: current.host, label: '复仇确认',
          text: '复仇需要' + info.cost + '个金松果' + plainReward + '，确定复仇吗？\n' + wallet,
          accept: go }).catch(e => { toast('确认界面加载失败，请重试。'); if (window.__errs) window.__errs.push(String(e)); });
      } else {
        modal('复仇确认', '<div class="result-box"><p>复仇需要 <b>' + info.cost + '</b> 个金松果' + reward + '，确定复仇吗？</p><p class="small-label">' + wallet + '</p></div>',
          [{ label: '确定复仇', cls: 'gold', run: go }, { label: '取消', cls: 'muted' }]);
      }
    } else {
      go();
    }
  }

  /* ============================================================
   * 画：顶栏 4 颗 tab + 一页 2 条记录 + 页码 + 左右箭头 + 红点
   * ========================================================== */
  let current = null;      // { view, host, tab, page, pages, all, rows, fresh }
  let seq = 0;             // 挂载代次（异步挂载完成后核对；见 open()）
  let openTrace = '';      // 最近一次 open() 停在哪一步（调试 / 探针）

  function activeTab() { return current ? current.tab : 'messages'; }

  /** 顶栏 4 颗 tab：**悬停 = 原版"键盘光标停在 tab 那一行"**（第 3 帧），
   *  选中 = 第 2 帧，离开回常态第 1 帧（自己就是当前页时留在选中态）。
   *  口径与 `ui-status.js` 的 wireTabs() 完全一致（导出数据实测：1 常态 / 2 选中 / 3 悬停）。 */
  function wireTabs() {
    const view = current && current.view;
    if (!view) return;
    for (const row of TABS) {
      wireClickable(clipOf(view, row[0]), {
        hover: 3,
        idle: () => (row[1] === activeTab() ? 2 : 1),
        press: 0,
        onFire: () => setTab(row[1]),
      });
    }
  }
  /** 底栏三颗 + 左右翻页箭头。它们挂在页根唯一那一帧上，实例不会随翻页重建，接一次即可。 */
  function wireChrome() {
    const view = current && current.view;
    if (!view) return;
    /* `back`（3362，3 帧：1 常态 / 2·3 高亮）：原版 `mc.back.onFire → _root.gotoAndStop("main")`。 */
    wireClickable(clipOf(view, 'back'), {
      hover: 2,
      onFire: () => { destroy(); if (window.UI && UI.runAction) UI.runAction('home'); },
    });
    /* `button1`(7813) = 论坛 / `button2`(7816) = 验证消息：原版都要开 WAP 或拉服务端
     * （openWap(gameBBs) / getQualifyMessages）。复刻没有服务端 —— 按"未接入"处理：
     * 接了线、给一句 toast，**不做成死键**（死键看起来像界面坏了）。 */
    wireClickable(clipOf(view, 'button1'), {
      hover: 2,
      onFire: () => toast('论坛未接入：本地怀旧版没有服务端，论坛与排行都打不开。'),
    });
    wireClickable(clipOf(view, 'button2'), {
      hover: 2,
      onFire: () => toast('验证消息未接入：本地怀旧版没有加好友请求这类服务端消息。'),
    });
    /* 翻页箭头（3156）。**悬停不改帧**：导出实测这一颗是 4 帧 —— 1 = 箭头画稿、
     * **2 = 空帧**、3·4 = 高亮版；原版从不往第 2 帧拨（它是键盘操作、箭头只有常态），
     * 复刻若拿第 2 帧当 hover 就会"鼠标一移上去箭头就消失"。照 `ui-challenge.js`
     * 的 ARROW_SPEC：`hover: 0, press: 0, idle: 1`，反馈交给点击路由的 `.sf-hover`。
     * 落点**沿用导出里的放置矩阵**（left 11.1,92.2；right 带 `-1` 的水平镜像），
     * 这一页不像挑战页那样需要重摆 —— 原版本来的位置就是对的。 */
    const ARROW = (onFire) => ({ hover: 0, press: 0, idle: 1, onFire: onFire });
    wireClickable(clipOf(view, 'left'), ARROW(() => goPage(-1)));
    wireClickable(clipOf(view, 'right'), ARROW(() => goPage(1)));
  }

  /** 切 tab：页码归位第一页（原版每个 show*Msg 都 `pageNum1 = 1`）。 */
  function setTab(key) {
    if (!current || current.tab === key) return;
    current.tab = key;
    current.page = 1;
    paint();
  }
  /** 翻页：原版 `showPreMsg` / `showNextMsg` 都先判边界（越界时**什么都不做**）。 */
  function goPage(delta) {
    if (!current) return;
    const want = (current.page || 1) + delta;
    if (want < 1 || want > (current.pages || 1)) return;
    current.page = want;
    paint();
  }

  /** 画一条记录（`slot` = 0/1；`rec` 为 null = 空槽位）。
   *  ⚠ 顺序要紧：**先给外层拨帧**（`a1`/`b1` 换帧会把里面那颗 `a`/`b` 整个重建），
   *    再取里面那颗按钮接线 —— 反过来的话接的是一颗马上被摘掉的旧实例。 */
  function paintRow(slot, rec, hint) {
    const view = current.view;
    const n = slot + 1;
    const win = clipOf(view, 'win' + n);
    const aBox = clipOf(view, 'a' + n);
    const bBox = clipOf(view, 'b' + n);
    const back = clipOf(view, 'back' + n);
    const body = clipOf(view, 'text' + n);
    const time = clipOf(view, 'text' + n + n);          // text11 / text22
    const plan = planOf(rec, current.tab);
    const text = rec ? plan.body : (hint || '');
    writeField(body, text, 3);
    writeField(time, rec ? plan.time : '', 1);
    stopAt(win, plan.win);
    stopAt(aBox, plan.a);
    stopAt(bBox, plan.b);
    stopAt(back, 1);
    /* 里面那颗真按钮：常态 1 / "光标在这一行" 2 / 空档 3（`showButton` 的语义）。 */
    const inner = (box, name, onFire) => {
      const clip = box && box.byName ? box.byName(name) : null;
      if (clip && onFire) wireClickable(clip, { hover: 2, press: 0, idle: 1, onFire: onFire });
      return clip;
    };
    const aBtn = inner(aBox, 'a', plan.onA);
    const bBtn = inner(bBox, 'b', plan.onB);
    /* 没有任何功能键的那一条：原版把整块底当兜底按钮登记（`backMc.onFire = function(){}`）。 */
    if (plan.fallback) wireClickable(back, { hover: 2, press: 0, idle: 1, onFire: () => {} });
    return {
      slot: slot, empty: !rec, notice: !!(rec && rec.notice),
      id: rec ? rec.id || null : null, kind: rec ? rec.kind || null : null,
      win: rec ? (rec.notice ? 'leave' : (rec.winner === 0 ? 'win' : 'lose')) : 'empty',
      frames: { win: plan.win, a: plan.a, b: plan.b, back: 1 },
      buttons: { a: !!aBtn, b: !!bBtn, fallback: !!plan.fallback },
      text: text, time: rec ? plan.time : '',
    };
  }

  /** 鼠标在**整条消息**上时给该条底图拨高亮帧（第 2 帧）。
   *  ⚠ 只有 `back` 是兜底按钮（这一条没有任何功能键）时才由 `wireClickable(back)` 挂
   *  mouseenter；有「查看录像 / 再次挑战」的条目原版只给按钮做悬停，整条正文区域没有反馈。
   *  用户口径是"鼠标移到上层消息也要有 ui 反馈"——这里在页根上按两条 `back` 的屏幕
   *  矩形做命中，只改底图帧，不注册热区、不拦截按钮点击。 */
  function wireRowHover() {
    const view = current && current.view;
    if (!view || !view.g) return;
    const svg = view.g.ownerSVGElement
      || (view.g.tagName && String(view.g.tagName).toLowerCase() === 'svg' ? view.g : null)
      || (view.g.ownerDocument && view.g.ownerDocument.querySelector('#ui svg'));
    if (!svg || svg.__msgRowHover) return;
    svg.__msgRowHover = true;
    const setRow = (n, hot) => {
      const back = clipOf(view, 'back' + n);
      if (!back || !back.g) return;
      const want = hot ? 2 : 1;
      if (back.frame !== want - 1) setPinned(back, want);
    };
    const move = (ev) => {
      if (!current || current.view !== view) return;
      const x = ev.clientX, y = ev.clientY;
      for (let n = 1; n <= 2; n++) {
        const back = clipOf(view, 'back' + n);
        if (!back || !back.g) { setRow(n, false); continue; }
        const r = back.g.getBoundingClientRect();
        const inside = r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        setRow(n, inside);
      }
    };
    const leave = () => { setRow(1, false); setRow(2, false); };
    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', leave);
  }

  /** 重画整页（数据 / 页码 / 箭头可见性 / 红点 / tab 档位）。 */
  function paint() {
    const c = current;
    if (!c) return;
    const view = c.view;
    const list = listOf(c.tab, c.all);
    const pages = Math.max(1, Math.ceil(list.length / ONE_PAGE));
    const page = Math.max(1, Math.min(pages, c.page || 1));
    c.page = page; c.pages = pages; c.list = list;
    /* 原版 `showMessage`：空槽位清文字、`a`/`b` 停空档、`win` 停末帧（空档）。
     * 整份清单为空时（原版就是两条空记录）第 1 格给一句人话，免得看着像界面坏了。 */
    const hint = list.length ? '' : (EMPTY_HINT[c.tab] || '');
    c.rows = [];
    for (let i = 0; i < ONE_PAGE; i++) {
      const rec = list[(page - 1) * ONE_PAGE + i] || null;
      c.rows.push(paintRow(i, rec, i === 0 ? hint : ''));
    }
    setTextByName(view, 'page', page + '/' + pages);
    /* 原版 `showMessage` 末尾：`left._visible = num > 1`、`right._visible = num < pageCount`。 */
    setVisible(clipOf(view, 'left'), page > 1);
    setVisible(clipOf(view, 'right'), page < pages);
    /* 三个 new 红点（原版 `showNewMessage1`：有新的 → 1，否则 → 2）。
     * 复刻没有服务端推送：只有「复仇」这一档能用本地真值算（有可复仇的败绩、
     * 且它比"上次看过消息页"更新）；留言 / 验证消息没有数据来源 → 恒熄灭。 */
    stopAt(clipOf(view, 'revengeNew'), c.fresh && c.fresh.revenge ? 1 : 2);
    stopAt(clipOf(view, 'leaveNew'), 2);
    stopAt(clipOf(view, 'qualifyNew'), 2);
    wireTabs();
    wireRowHover();
  }

  /** 「复仇」红点：可复仇的记录里有没有比 `State.msgSeenAt()` 更新的。
   *  ⚠ 必须在 `markMessagesSeen()` **之前**算 —— 那一步会把"看到哪了"推到最新（红点随即熄灭）。 */
  function freshDots(all) {
    const seen = (window.State && State.msgSeenAt) ? (Number(State.msgSeenAt()) || 0) : 0;
    return { revenge: all.filter(canRevenge).some((r) => (Number(r.createdAt) || 0) > seen) };
  }

  /* ---------- 挂载与生命周期 ---------- */
  /** tab 入参容错：`'messages'|'ranklog'|'revenge'|'chat'`，也收原版的 1~4。 */
  function tabKeyOf(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const at = Math.max(1, Math.min(TABS.length, Math.round(v)));
      return TABS[at - 1][1];
    }
    const k = String(v == null ? '' : v);
    if (TAB_NUM[k]) return k;
    if (k === 'leave' || k === 'chatlog') return 'chat';
    return 'messages';
  }
  function guard(promise) {
    if (promise && typeof promise.catch === 'function') promise.catch((e) => pushErr('SfMessage', e));
  }

  async function open(container, tab, page) {
    openTrace = 'start';
    if (!window.SfRender || !SfRender.mountSymbol) throw new Error('SfRender 未加载（缺 js/ssfight/render.js）');
    const t = T();
    if (!t) throw new Error('SfUiMain.toolkit 不在（缺 js/ssfight/ui-main.js）');
    let host = container || (current && current.host);
    if (!host) {
      const ui = document.getElementById('ui');
      if (ui) {
        ui.innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠消息"></section>';
        host = ui.querySelector('.ssfight-home');
      }
    }
    if (!host) { openTrace = 'no-host'; return false; }
    /* 作废在途挂载：**先领号再拆树**（`destroy()` 只拆树、不动 `seq`，递增统一在这里）。
     * 下面每一处 `await` 之后都要核对代次 —— 过期视图直接销毁，绝不能盖掉后来进入的页面。 */
    const mine = ++seq;
    destroyView();
    /* 从录像 / 复仇回来时带回来的落点（取走即清）。⚠ 它**优先于传进来的 tab / page**：
     * 回来那条路走的是 `UI.runAction('messages')` → `openMessages()`，而 `openMessages()`
     * 在实参缺省时会填上 `'messages'` 与第 1 页（js/classic-ui.js 的那段路由）——
     * 不优先取 pending 的话，看完录像会被丢回「消息」第 1 页，而不是原来那一页。 */
    const spot = (pending && Date.now() - (Number(pending.at) || 0) < PENDING_MS) ? pending : null;
    pending = null;
    const key = tabKeyOf(spot && spot.tab ? spot.tab : tab);
    const wantPage = Math.max(1, Math.round(Number(spot && spot.page != null ? spot.page : page) || 1));
    openTrace = 'destroyed mine=' + mine;
    await SfRender.loadExtra('tags-message.json');
    if (mine !== seq || host.isConnected === false) { openTrace = 'stale mine=' + mine; return false; }
    /* `blank`：素材里那几格写着作者的占位串（正文"被XXX（用户名）挑战…"、时间"12/01 12:30"、
     * 页码"1/4"），真值由本页写进去 —— 出生就清空，免得挂载到填值之间闪一下假数据。 */
    const view = await SfRender.mountSymbol(host, '7819', {
      frame: 1, label: '消息',
      blank: ['text1', 'text2', 'text11', 'text22', 'page'],
    });
    if (mine !== seq || host.isConnected === false) {
      try { view.destroy(); } catch (e) {}
      openTrace = 'stale-after-mount mine=' + mine;
      return false;
    }
    openTrace = 'mounted';
    const all = (window.State && State.battleHistory) ? (State.battleHistory() || []) : [];
    current = { view: view, host: host, tab: key, page: wantPage, pages: 1, all: all, list: [], rows: [], fresh: freshDots(all) };
    /* 常量挂好了再让 `main.js` 量一次布局（经典整页 320×196，`#ui` 高度在 716.625 / 690 之间切）。 */
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    /* 这一页是**静态页**（原版靠键盘选中才拨某一档）：交给统一的「静态页策略」——
     * 整棵子树出生即冻结，而且**换帧重建出来的新实例自动适用**（翻页 / 切 tab / 重画按钮
     * 全都不用再管）。所以下面每次 `gotoAndStop` 之后都不需要"重扫一遍"。
     * 原版这一页自带、本来就该播的装饰动画：没有 —— 三颗红点与 tab 都是状态帧。 */
    t.freezeDescendants(view);
    /* 看过就把「消息」红点熄掉（原版每个 show*Msg 都把服务端的 hasNew* 置 false）。 */
    try { if (window.SfUiMain.markMessagesSeen) SfUiMain.markMessagesSeen(); } catch (e) {}
    try { wireChrome(); } catch (e) { pushErr('SfMessage wire', e); }
    try { paint(); } catch (e) { pushErr('SfMessage paint', e); }
    openTrace = 'done';
    return true;
  }

  /** 只拆自己这棵树（**不动 `seq`**）：`open()` 每次重挂前调它，UI 侧也拿它当"关掉这一页"。 */
  function destroyView() {
    if (current && window.SfChallenge && SfChallenge.closeOriginalDialog) SfChallenge.closeOriginalDialog(current.host);
    if (current && current.view) { try { current.view.destroy(); } catch (e) {} }
    current = null;
  }
  /** 作废所有在途的 `open()`（它们看到 `seq` 变了就自己放弃），然后拆树。 */
  function destroy() { seq++; pending = null; destroyView(); }

  window.SfMessage = Object.freeze({
    open: open,
    destroy: destroy,
    view: () => (current ? current.view : null),
    current: () => (current
      ? { tab: current.tab, tabNum: TAB_NUM[current.tab] || 1, page: current.page, pages: current.pages || 1 }
      : null),
    /** 最近一次 open() 停在哪一步（调试 / 探针） */
    trace: () => openTrace,
    /** 快照（调试 / 回归探针）：这一刻四个 tab 里画的是哪两条、各元件停在哪一档。 */
    debug: () => {
      if (!current) return null;
      const c = current;
      return {
        tab: c.tab, tabNum: TAB_NUM[c.tab] || 1, page: c.page, pages: c.pages,
        total: c.all.length, filtered: (c.list || []).length,
        rows: (c.rows || []).map((r) => Object.assign({}, r)),
      };
    },
  });
})();
