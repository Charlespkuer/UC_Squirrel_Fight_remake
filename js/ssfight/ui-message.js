// Classic message page (page-root symbol 7819, single frame): renders original export
// data via SfRender; State supplies battle history, Main / UI.classic supply modals/fights.
(function () {
  'use strict';

  // 公共交互件（测热区 / 动效壳 / 钉帧 / 写文本）在 ui-main.js 实现并导出。
  const T = () => (window.SfUiMain && window.SfUiMain.toolkit) || null;
  const clipOf = (host, name) => (host && host.byName ? host.byName(name) : null);
  const toast = (msg) => { try { if (window.UI && UI.toast) UI.toast(msg); } catch (e) {} };
  // 异步失败要留痕：window.__errs 是回归探针唯一能看见“点了没反应”的地方。
  const pushErr = (what, e) => { if (window.__errs) window.__errs.push(what + ': ' + (e && e.message)); };

  // 页根 7819 只有 1 帧：所有换页都是给子元件拨帧，页根自己不动。
  // TRAP: 原版 AS 写 message.msgTab.gotoAndStop(tab_wz)，但导出数据的具名列表里没有 msgTab，
  // 四颗 tab 直接挂在页根上；照 AS 取 msgTab 只会拿到 null，整页 tab 变死键。
  const TABS = [['tab', 'messages'], ['tab1', 'ranklog'], ['tab2', 'revenge'], ['tab3', 'chat']];
  // tab 代号 ↔ 原版 tab_wz：1 消息 / 2 天梯赛 / 3 复仇 / 4 留言。
  const TAB_NUM = { messages: 1, ranklog: 2, revenge: 3, chat: 4 };
  // 原版 onePage_Count1 = 2（initMeaageView）：一页两条记录。
  const ONE_PAGE = 2;

  // win1/win2(3407, 8 帧)：1 胜 / 2 败 / 3 未知 / 4 天梯 / 5 留言 / 8 空档；
  // 原版先 gotoAndStop(_totalframes) 清空，再按 isWin 拨 1/2/3。
  // a1/a2(4833)：1 收徒 / 2 复仇 / 3 加好友 / 4 空档；b1/b2(4821)：1 录像 / 2 回复 / 3 拒绝 / 4 空档。
  // back1/back2(3393)：1 常态 / 2·3 高亮，无功能键时整块底当兜底；内部 a/b 3 帧：1 常态 / 2 光标 / 3 空。
  const WIN_FRAME = { win: 1, lose: 2, unknown: 3, rank: 4, leave: 5 };
  const WIN_FRAME_EMPTY = 8;
  const KEY_FRAME_EMPTY = 4;
  const REVENGE_FRAME = 2;
  const REPLAY_FRAME = 1;
  const REPLY_FRAME = 2;

  // 与 js/classic-ui.js 的 DOM 版 openMessages 同一张表。
  // State.recordBattle 缺 kind 时写的是中文 '挑战'（js/state.js）；表里两种都要有，否则显示“挑战 · 挑战”。
  const KIND_LABEL = {
    challenge: '挑战', '挑战': '挑战', stage: '关卡', tower: '挑战塔', endless: '无尽塔',
    arena: '竞技场', rank: '天梯赛', friend: '切磋', master: '师徒', revenge: '复仇', leave: '留言',
  };
  // 与 js/classic-ui.js 的 REVENGE_EXCLUDED_KINDS 一致。
  const REVENGE_EXCLUDED_KINDS = ['tower', 'endless', 'stage'];
  function canRevenge(r) {
    // 原版复仇只来自“被抢方当天收到的战报”；单机没有被动战报，主动挑战失败不产生复仇。
    return false;
  }

  // 本地没有服务端：留言页按 doShowLeaveMsg 的排版写一句说明，不留一页空白。
  const CHAT_NOTICE_BODY = '本地怀旧版暂不连接公共聊天与留言服务，这里保留原版留言页的排版。';
  const CHAT_NOTICE_HEAD = '本地怀旧版';
  // 列表为空时给一句人话（原版这里就是两条空记录，看着像界面坏了）。
  const EMPTY_HINT = {
    messages: '暂时没有战斗消息。去打一场挑战，战报就会记在这里。',
    ranklog: '还没有天梯赛记录。到竞技场参加天梯赛，胜负都会记在这里。',
    revenge: '单机版没有被动战报；主动挑战失败不产生复仇。',
  };

  // 让元件停在某一帧（不自己播）。换帧会重建子树，调用方之后要重接内部按钮。
  function stopAt(clip, n) {
    if (!clip || !clip.gotoAndStop) return;
    try { clip.gotoAndStop(n); } catch (e) {}
  }
  // 原版是 mc.left._visible = false，不是切禁用帧，照抄成 CSS visibility。
  // 点击路由会把 visibility:hidden 的元件判成“谁都没命中”，藏起来的箭头不会截住点击。
  function setVisible(clip, on) {
    if (clip && clip.g) clip.g.style.visibility = on ? '' : 'hidden';
  }
  function setTextByName(host, name, str) {
    const t = T();
    const n = clipOf(host, name);
    if (n && t) t.setText(n, str == null ? '' : String(str));
    return n;
  }
  // 换帧会把 <g> 的子节点整个重建，动效壳与点击区一起没掉，所以每次 goTo 后重包一遍。
  function refreshShell(clip) {
    const t = T();
    if (!t || !clip || !clip.g) return;
    t.popWrap(clip);
    const shell = clip.g.querySelector(':scope > g.uc-pop');
    if (shell) t.wirePopPress(shell);
  }
  // 与状态页、挑战页同一套写法。hover:0 = 这一档没有“光标停在上面”的画稿，
  // 反馈交给 .sf-hover 光晕（例：翻页箭头）。
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
    // 监听器只挂一次：重画时同一颗实例会被重新接线（新的 idle / onFire），不能重复 addEventListener。
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
  // 明确拨到某一档并停住；不用 __pinFrame，那是“每一拍强制拨回”，会和界面自己的 gotoAndStop 打架。
  function setPinned(clip, frame) {
    if (!clip || !clip.gotoAndStop) return;
    const want = Math.max(1, Math.round(Number(frame) || 1));
    clip.__pinFrame = null;
    if (clip.frame !== want - 1) { try { clip.gotoAndStop(want); } catch (e) {} }
    clip.playing = false;
  }
  function pinIdle(clip) {
    if (!clip || !clip.__msgIdle) return;
    setPinned(clip, clip.__msgIdle());
  }

  // render.js 的文本容器只按框宽横向裁、纵向放开：正文格 233 宽 / 12 号字最多 3 行，
  // 第 4 行会压到下一条记录上。全角步进按已画出的那行实测，量不到退回字号。
  // 真值用 __textBox.meta.bd（textfields.json），不查 textfields-index.json 的 charsPerLine。
  const wrapCache = new WeakMap();
  function wrapToField(clip, text, maxLines) {
    const src = String(text == null ? '' : text);
    if (!clip || !clip.__textBox) return src;
    const tb = clip.__textBox;
    if (!tb.meta || !tb.meta.bd) return src;
    const W = tb.meta.bd[1] - tb.meta.bd[0] - (tb.meta.lm || 0) - (tb.meta.rm || 0);
    if (!(W > 8)) return src;
    // 文本容器的 DOM 就是那个 <g type="text"> 本身（__textBox 挂在它上面），不是 MovieClip。
    const el = clip.g || clip;
    const svg = el.ownerSVGElement || (el.ownerDocument && el.ownerDocument.querySelector('#ui svg')) || null;
    const vb = svg ? String(svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number) : null;
    const rect = svg && svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    const k = (rect && rect.width && vb && vb[2]) ? rect.width / vb[2] : 0;
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
        const adv = ch.charCodeAt(0) < 0x2E80 ? 0.55 : 1;
        if (wid + adv > per && line) { out.push(line); line = ''; wid = 0; }
        line += ch; wid += adv;
      }
      out.push(line);
    }
    // 正文格放不下第 4 行：宁可截断，也不要冲进下一条记录。
    if (maxLines && out.length > maxLines) {
      out.length = maxLines;
      out[maxLines - 1] = out[maxLines - 1].slice(0, Math.max(1, per - 1)) + '…';
    }
    return out.join('\n');
  }
  function writeField(node, text, maxLines) {
    const t = T();
    if (!node || !t) return;
    t.setText(node, wrapToField(node, text, maxLines));
  }

  // 四个 tab 的数据：原版是服务端接口（getMessages / getRankMessage / getLeaveMessages），
  // 复刻唯一的真值是 State.battleHistory()；留言 tab 走本地说明。
  // 消息 = 普通战斗消息（不含天梯赛）；天梯赛 = kind==='rank'；复仇 = 败绩且可复仇。
  function listOf(tab, all) {
    if (tab === 'ranklog') return all.filter((r) => r && r.kind === 'rank');
    if (tab === 'revenge') return all.filter(canRevenge);
    if (tab === 'chat') return [{ notice: true }];
    return all.filter((r) => r && r.kind !== 'rank');
  }
  // 与 DOM 版 openMessages 的 MM-DD HH:MM 格式化一致（月/日补零）。
  function timeText(ts) {
    const d = new Date(Number(ts) || 0);
    if (!Number.isFinite(d.getTime()) || !d.getTime()) return '';
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // 与 DOM 版 openMessages 的文案口径一致。
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
  // 原版 msg.combatId > 0 才可播录像；本地每条战斗记录都带 result.rounds。
  function replayable(r) {
    return !!(r && r.result && Array.isArray(r.result.rounds) && r.result.rounds.length);
  }

  // 原版 doShowNormalMsg / doShowRankMsg / doShowLeaveMsg 的档位：
  // 普通消息 a 只在 prenticeId>0 时收徒（本地无此字段 → 空档）、b 只在 combatId>0 时录像；
  // 天梯 / 复仇 win 固定第 4 帧；留言 win 第 5 帧、b 回复留言。
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
    // 「复仇 / 再次挑战」用 a 第 2 帧（原版 revengeId>0）；本地没有服务端字段，
    // 判据用本地这条败绩能不能复仇（与 DOM 版 canRevenge 同一份规则）。
    const rev = rankTab && canRevenge(r);
    const rec = replayable(r);
    return {
      win: win,
      a: rev ? REVENGE_FRAME : KEY_FRAME_EMPTY,
      b: rec ? REPLAY_FRAME : KEY_FRAME_EMPTY,
      body: body, time: time,
      // 没有功能键时，原版把 back（整块底）当兜底按钮登记，点击什么都不做。
      fallback: !rev && !rec,
      onA: rev ? () => startRevenge(r) : null,
      onB: rec ? () => playReplay(r) : null,
    };
  }

  // 查看录像 / 复仇都会把玩家带离本页（Main 先清 #ui，结束时 showHome），回来时是重开不是重画：
  // 落点记进 pending，再走 UI.runAction('messages')（带 screen = 'message' 与宿主标记）。
  let pending = null;             // { tab, page, at } —— 回来时的落点（open() 取走即清）
  // 落点只对“刚打完一场、马上回本页”有效；过期不候，否则回调没跑成会把玩家
  // 留到下一次进页面，丢到别的 tab / 页码上。
  const PENDING_MS = 15000;
  function reopen(spot) {
    pending = spot ? { tab: spot.tab, page: spot.page, at: Date.now() } : null;
    if (window.UI && UI.runAction) { UI.runAction('messages'); return; }
    guard(open(null, spot && spot.tab, spot && spot.page));
  }
  function playReplay(record) {
    const spot = current ? { tab: current.tab, page: current.page } : null;
    if (!(window.Main && Main.replayBattle)) { toast('录像回放暂不可用'); return; }
    // 回调在 showHome() 之后才跑（js/main.js:824-828），那时本页已经被 renderHome 收掉了。
    Main.replayBattle(record, () => reopen(spot));
  }
  // 复仇：拿录像里的对手快照再打一场（不消耗体力、不掉飘物，避免变成刷资源入口）；
  // 胜利后 State.revengeReward 发少量经验与金松果，并把记录标成已复仇。
  // UI.classic 没有导出 revengeFight，这里按 js/classic-ui.js 的逻辑最小实现，接口与文案保持一致。
  function startRevenge(record) {
    if (!record || !(window.Main && Main.startBattle)) { toast('战斗模块未加载'); return; }
    if (record.revenged) { toast('这条败绩已经复仇过了。'); return; }
    const info = State.revengeInfo ? State.revengeInfo(record.id) : { cost: 20, cups: 0, cupsMin: 0, ladder: false, count: 0 };
    // 只有天梯赛败绩的复仇才抢金杯（0~1 个）；确认与结算共用同一次掷点，
    // 避免文案和实际结果对不上。
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
    // 原版 alertRevenge（MainMovie.as:14526）：先二次确认费用与金杯，确认后才扣费开打。
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

  let current = null;
  let seq = 0;             // 挂载代次（异步挂载完成后核对；见 open()）
  let openTrace = '';

  function activeTab() { return current ? current.tab : 'messages'; }

  // 悬停 = 原版“键盘光标停在 tab 那一行”（第 3 帧），选中第 2 帧，离开回第 1 帧；
  // 与 ui-status.js 的 wireTabs() 一致（导出数据：1 常态 / 2 选中 / 3 悬停）。
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
  // 底栏三颗 + 左右翻页箭头挂在页根唯一那一帧上，实例不随翻页重建，接一次即可。
  function wireChrome() {
    const view = current && current.view;
    if (!view) return;
    // back(3362, 3 帧：1 常态 / 2·3 高亮)：原版 mc.back.onFire → _root.gotoAndStop("main")。
    wireClickable(clipOf(view, 'back'), {
      hover: 2,
      onFire: () => { destroy(); if (window.UI && UI.runAction) UI.runAction('home'); },
    });
    // button1(7813) 论坛 / button2(7816) 验证消息：原版要开 WAP 或拉服务端，这里没有，
    // 按“未接入”给 toast；不要留死键（死键看起来像界面坏了）。
    wireClickable(clipOf(view, 'button1'), {
      hover: 2,
      onFire: () => toast('论坛未接入：本地怀旧版没有服务端，论坛与排行都打不开。'),
    });
    wireClickable(clipOf(view, 'button2'), {
      hover: 2,
      onFire: () => toast('验证消息未接入：本地怀旧版没有加好友请求这类服务端消息。'),
    });
    // 翻页箭头 3156 是 4 帧：1 箭头 / 2 空帧 / 3·4 高亮；悬停不能拨第 2 帧，否则箭头消失。
    // 照 ui-challenge.js 的 ARROW_SPEC：hover:0、press:0、idle:1，反馈交给 .sf-hover。
    // 位置沿用导出里的放置矩阵（left 11.1,92.2；right 带 -1 水平镜像）。
    const ARROW = (onFire) => ({ hover: 0, press: 0, idle: 1, onFire: onFire });
    wireClickable(clipOf(view, 'left'), ARROW(() => goPage(-1)));
    wireClickable(clipOf(view, 'right'), ARROW(() => goPage(1)));
  }

  // 切 tab 时页码归位第一页（原版每个 show*Msg 都 pageNum1 = 1）。
  function setTab(key) {
    if (!current || current.tab === key) return;
    current.tab = key;
    current.page = 1;
    paint();
  }
  // 原版 showPreMsg / showNextMsg 都先判边界：越界时什么都不做。
  function goPage(delta) {
    if (!current) return;
    const want = (current.page || 1) + delta;
    if (want < 1 || want > (current.pages || 1)) return;
    current.page = want;
    paint();
  }

  // 顺序要紧：先给外层 a1/b1 拨帧（换帧会重建里面的 a/b），再取里面那颗按钮接线；
  // 反过来会接到一颗马上被摘掉的旧实例。
  function paintRow(slot, rec, hint) {
    const view = current.view;
    const n = slot + 1;
    const win = clipOf(view, 'win' + n);
    const aBox = clipOf(view, 'a' + n);
    const bBox = clipOf(view, 'b' + n);
    const back = clipOf(view, 'back' + n);
    const body = clipOf(view, 'text' + n);
    const time = clipOf(view, 'text' + n + n);
    const plan = planOf(rec, current.tab);
    const text = rec ? plan.body : (hint || '');
    writeField(body, text, 3);
    writeField(time, rec ? plan.time : '', 1);
    stopAt(win, plan.win);
    stopAt(aBox, plan.a);
    stopAt(bBox, plan.b);
    stopAt(back, 1);
    // 里面那颗真按钮：常态 1 / 光标在这一行 2 / 空档 3（showButton 的语义）。
    const inner = (box, name, onFire) => {
      const clip = box && box.byName ? box.byName(name) : null;
      if (clip && onFire) wireClickable(clip, { hover: 2, press: 0, idle: 1, onFire: onFire });
      return clip;
    };
    const aBtn = inner(aBox, 'a', plan.onA);
    const bBtn = inner(bBox, 'b', plan.onB);
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

  // 鼠标在整条消息上时给该条底图拨高亮帧（第 2 帧）。只有 back 是兜底按钮时
  // wireClickable 才挂 mouseenter；有功能键的条目原版只给按钮做悬停。
  // 这里按两条 back 的屏幕矩形命中，只改底图帧，不注册热区、不拦截按钮点击。
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

  function paint() {
    const c = current;
    if (!c) return;
    const view = c.view;
    const list = listOf(c.tab, c.all);
    const pages = Math.max(1, Math.ceil(list.length / ONE_PAGE));
    const page = Math.max(1, Math.min(pages, c.page || 1));
    c.page = page; c.pages = pages; c.list = list;
    // 原版 showMessage 的空槽：清文字、a/b 停空档、win 停末帧；清单全空时第 1 格给一句人话。
    const hint = list.length ? '' : (EMPTY_HINT[c.tab] || '');
    c.rows = [];
    for (let i = 0; i < ONE_PAGE; i++) {
      const rec = list[(page - 1) * ONE_PAGE + i] || null;
      c.rows.push(paintRow(i, rec, i === 0 ? hint : ''));
    }
    setTextByName(view, 'page', page + '/' + pages);
    // 原版 showMessage 末尾：left._visible = num > 1、right._visible = num < pageCount。
    setVisible(clipOf(view, 'left'), page > 1);
    setVisible(clipOf(view, 'right'), page < pages);
    // 三个 new 红点（原版 showNewMessage1：有新的 → 1，否则 → 2）。没有服务端推送，
    // 只有「复仇」能用本地真值算；留言 / 验证消息没有数据来源，恒熄灭。
    stopAt(clipOf(view, 'revengeNew'), c.fresh && c.fresh.revenge ? 1 : 2);
    stopAt(clipOf(view, 'leaveNew'), 2);
    stopAt(clipOf(view, 'qualifyNew'), 2);
    wireTabs();
    wireRowHover();
  }

  // 「复仇」红点：可复仇记录里有没有比 State.msgSeenAt() 更新的。
  // 必须在 markMessagesSeen() 之前算，那一步会把“看到哪了”推到最新（红点随即熄灭）。
  function freshDots(all) {
    const seen = (window.State && State.msgSeenAt) ? (Number(State.msgSeenAt()) || 0) : 0;
    return { revenge: all.filter(canRevenge).some((r) => (Number(r.createdAt) || 0) > seen) };
  }

  // tab 入参容错：'messages'|'ranklog'|'revenge'|'chat'，也收原版的 1~4。
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
    // 作废在途挂载：先领号再拆树（destroyView 只拆树、不动 seq，递增统一在这里）。
    // 下面每个 await 后都要核对代次：过期视图直接销毁，绝不能盖掉后来进入的页面。
    const mine = ++seq;
    destroyView();
    // 从录像/复仇回来时带回落点（取走即清），它优先于传进来的 tab/page：
    // 回来走 UI.runAction('messages') → openMessages()，实参缺省会填 'messages' 和第 1 页，
    // 不优先取 pending 就会被丢回「消息」第 1 页。
    const spot = (pending && Date.now() - (Number(pending.at) || 0) < PENDING_MS) ? pending : null;
    pending = null;
    const key = tabKeyOf(spot && spot.tab ? spot.tab : tab);
    const wantPage = Math.max(1, Math.round(Number(spot && spot.page != null ? spot.page : page) || 1));
    openTrace = 'destroyed mine=' + mine;
    await SfRender.loadExtra('tags-message.json');
    if (mine !== seq || host.isConnected === false) { openTrace = 'stale mine=' + mine; return false; }
    // blank：素材里的占位串（正文 / 时间 / 页码）出生就清空，真值由本页写，
    // 免得挂载到填值之间闪一下假数据。
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
    // 常量挂好再让 main.js 量一次布局（经典整页 320×196，#ui 高度在 716.625 / 690 之间切）。
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    // 静态页交给统一策略：整棵子树出生即冻结，换帧重建出来的新实例自动适用，
    // 所以每次 gotoAndStop 后都不需要重扫。原版这一页没有该播的装饰动画。
    t.freezeDescendants(view);
    // 看过就把「消息」红点熄掉（原版每个 show*Msg 都把服务端的 hasNew* 置 false）。
    try { if (window.SfUiMain.markMessagesSeen) SfUiMain.markMessagesSeen(); } catch (e) {}
    try { wireChrome(); } catch (e) { pushErr('SfMessage wire', e); }
    try { paint(); } catch (e) { pushErr('SfMessage paint', e); }
    openTrace = 'done';
    return true;
  }

  // 只拆自己这棵树（不动 seq）：open() 每次重挂前调它，UI 侧也拿它当“关掉这一页”。
  function destroyView() {
    if (current && window.SfChallenge && SfChallenge.closeOriginalDialog) SfChallenge.closeOriginalDialog(current.host);
    if (current && current.view) { try { current.view.destroy(); } catch (e) {} }
    current = null;
  }
  // 作废所有在途 open()（它们看到 seq 变了就自己放弃），然后拆树。
  function destroy() {
    seq++; pending = null; destroyView();
    if (window.SfRender && SfRender.releaseExtra) SfRender.releaseExtra('tags-message.json');
  }

  window.SfMessage = Object.freeze({
    open: open,
    destroy: destroy,
    view: () => (current ? current.view : null),
    current: () => (current
      ? { tab: current.tab, tabNum: TAB_NUM[current.tab] || 1, page: current.page, pages: current.pages || 1 }
      : null),
    // 最近一次 open() 停在哪一步（调试 / 探针）
    trace: () => openTrace,
    // 快照（调试 / 回归探针）：这一刻四个 tab 里画的是哪两条、各元件停在哪一档。
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
