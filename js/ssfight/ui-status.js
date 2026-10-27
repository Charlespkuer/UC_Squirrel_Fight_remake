/* Classic status, weapon and skill tabs (symbol 7218, frames 1/2/3).
 * Uses SfUiMain.toolkit and extracted original assets; State supplies live values.
 * Frame transitions hydrate bitmap digits synchronously before the next paint.
 * Page API: SfStatus.open / openFriend / openHero / destroy / refresh.
 * Shared navigation and asset lookup: js/ssfight/AGENTS.md.
 */
(function () {
  'use strict';

  /** 复刻侧通用件（测热区 / 动效壳 / 按下闪一遍 / 钉帧 / 数字精灵 …），在 `ui-main.js` 里实现并导出。 */
  const T = () => (window.SfUiMain && window.SfUiMain.toolkit) || null;
  const S = () => (window.State && State.state && State.state()) || null;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* 原版四维的名字与显示顺序（第 1 帧里四个 4315 数字精灵的实例名，导出数据实测）：
   * `power`(53.85,143.15) / `agility`(124.15,143.2) / `speed`(194.7,143.15) / `hp`(265.3,143.15)。
   * ⚠ 第 4 格画的是「命」（生命值）。原版那一行是
   *   `showNumber(playerInfo.player.maxHp, zhuangtai.hp, 0, 0, "left")`（MainMovie.as:13991），
   *   而复刻 `State.totalStats()` 返回的四个字段就叫 `power/agility/speed/hp`
   *   （`hp` 就是最大生命，见 js/state.js:1786）—— 所以这里必须取 **`hp`**。
   *   2026-10 之前写的是 `maxHp`：`totalStats()` 根本没有这个键，取到 `undefined` → 那格恒为 0。 */
  const STATS = [
    ['power', 'power'],
    ['agility', 'agility'],
    ['speed', 'speed'],
    ['hp', 'hp'],
  ];

  /* 装备部位 ↔ 状态页立绘的"部位容器"（原版 `showFace()`，MainMovie.as:6554）。
   * 原版这一页穿装备走的是 `showFace(zhuangtai, getMyWearList())`（:2272 / :13884 / :13930），
   * 不是 `showWears()`（那是库元件「状态1」的"我的装备"页用的，还额外把部位压到 85%）。
   * `showFace` 的四元组是：
   *   [mc_head] / [mc_fistL, mc_fistR] / [mc_body, mc_handL, mc_handR] / [mc_footL, mc_footR]
   * 对应的容器名是 头 / 外拳套·内拳套 / 衣服·手臂·手臂 / 鞋子·鞋子 ——
   * **复刻之前把拳套贴在 mc_handL/R（那是手臂）上、容器也每种只用一个**，
   * 所以"装备与角色外观没有贴合"（用户 2026-10 报的）。这里逐条照 `showFace` 改回来：
   * 贴到正确部位、**不缩放**（`showWears` 那 85% 不适用于这一页）。 */
  const FACE_PARTS = [
    { type: 0, cells: [['mc_head', 0]] },
    { type: 1, cells: [['mc_fistL', 0], ['mc_fistR', 1]] },
    { type: 2, cells: [['mc_body', 0], ['mc_handL', 1], ['mc_handR', 1]] },
    { type: 3, cells: [['mc_footL', 0], ['mc_footR', 0]] },
  ];
  /* showFace 直接 attachMovie 非 B 容器；主页/战斗的 B 容器先转成位图，原点不同。
   * 两组都从 gear-slots.json 读，卡片回退画稿继续使用 B 表。 */
  let containerIds = null;
  let portraitContainerIds = null;

  /* ---------- 经验数字的落点微调（用户 2026-10 口径："exp 中的数字偏下了，稍微往上一点"）----------
   * `expNum`（7182）是文本字段，落点由 render.js 的字段框公式算；这里在它自己的局部坐标里
   * 再上移 `EXP_DY` 个舞台单位（局部 = 舞台，这个字段的放置矩阵是 1:1 的平移）。
   * 负 = 上移（SVG 的 +y 向下）。数值只有一个，改这里就能回调。 */
  const EXP_DY = -1.6;
  function nudgeExp(view) {
    const c = clipOf(view, 'expNum');
    const g = c && (c.g || c);
    if (!g || !g.querySelectorAll) return;
    for (const t of g.querySelectorAll('text')) {
      if (t.__expBaseY == null) t.__expBaseY = Number(t.getAttribute('y') || 0);
      t.setAttribute('y', t.__expBaseY + EXP_DY);
    }
  }

  let current = null;      // { view, container, tab, friend }
  /* ============================================================
   * 「查看别人的状态页」—— 原版就是**同一页**（`MainMovie.as` 的 `isViewfriend` 分支）
   * ------------------------------------------------------------
   * 用户 2026-10 口径："其中的查看功能在 ssfight 版本中是前往一个与玩家状态栏几乎一样的
   * 页面进行查看属性与武器技能，查看 ssfight 中实现方式并进行对齐。"
   * 原版的实现（读 AS 得到，逐条对得上）：
   *   · `doAction(3)` → `getPlayInfo(wz)`（:17326）把 `isViewfriend = true` 之后
   *     **`gotoAndStop("zhuangtai")`** —— 就是玩家自己那一页（:964-984）；
   *   · `showMainInfo()`（:13860）只换数据源：`playerInfo = isViewfriend ? friendInfo : oldMyInfo`，
   *     立绘走同一个 `showFace(zhuangtai, playerInfo.player.wearsList)`；
   *   · 查看别人时**两颗功能键换档**：`b_change.gotoAndStop(4|5)`、`b_fusion.gotoAndStop(3)`
   *     （:13881-13926）—— 第 4/5 帧上写着「查看装备」，`b_fusion` 那颗隐藏；
   *   · 武器 / 技能两页共用（`showWeaponSkills` :22022 同样按 `isViewfriend` 换数据源），
   *     只是**点开的详情窗口整体被 `if (!isViewfriend)` 包住**（`showWeaponSkillWin` :16658-16790）
   *     —— 看别人时不给升级/升阶，所以复刻这里也只做"看"；
   *   · `back` → `leavePage()`（:13800）：看完回**挑战页**（`pubSeeFrined` 那一路才回村庄）。
   * ========================================================== */
  const friendView = () => !!(current && current.friend);
  const Friend = () => (current && current.friend) || null;
  /* ============================================================
   * 勇者模式：同一颗状态页 7218，换一份数据源
   * ------------------------------------------------------------
   * 用户 2026-10-24 口径：勇者模式的准备界面直接复用随机挑战「查看敌人」这张状态页
   * （状态 / 武器 / 技能三个页签 + 查看/更换装备），不要另造一套 DOM。
   *   · `mode: 'setup'` = 开局准备：武器/技能两页列出**全部可学习武技**，点亮 3 个；
   *   · `mode: 'run'` = 爬塔中点头像：只读（武技已随本局成长固定），外观装备仍可换。
   * 数据、回调都由 `js/tower-ui.js` 通过 `openHero()` 传进来；本文件只负责画与接线。 */
  const HERO_PICK_LIMIT = 3;
  const heroView = () => !!(current && current.hero);
  const Hero = () => (current && current.hero) || null;
  const heroPickKey = (kind, id) => String(kind) + ':' + Number(id);
  function heroPickSet() {
    const set = new Set();
    for (const it of ((heroView() && Hero().picks) || [])) {
      if (it && it.kind && Number(it.id) > 0) set.add(heroPickKey(it.kind, it.id));
    }
    return set;
  }
  function heroPickCount() { return heroPickSet().size; }
  function heroStartEnabled() {
    const hero = Hero();
    return !!(hero && hero.mode === 'setup' && heroPickSet().size >= HERO_PICK_LIMIT);
  }
  /** 看完别人 → 回**挑战页**（原版 `leavePage()` :13800 的 `gotoAndStop("tiaozhan")`）。 */
  function leaveFriendView() {
    const back = (current && current.backTo) || null;
    destroy();
    if (typeof back === 'function') { back(); return; }
    if (window.UI && UI.runAction) UI.runAction('challenge');
  }
  /** 「查看装备」：原版 `friendEquipsInfo()`（:13821）= 库元件「状态1」的第 7 帧。
   *  那一颗**还没提取**（`状态1` = 4673，见状态页文件头的"素材还没提取"说明），
   *  所以走下面那段 `openFriendGearsOverlay()`：在**当前这一页上盖一层**复刻自己的说明面板
   *  （数据是真的，版式是复刻的）。⚠ 定义在这里（文件后段）而不是紧挨着调用点 ——
   *  `openFriendGearsOverlay` 是函数声明、靠"就近"容易看漏它与 `detailHost` 的依赖。 */
  function openFriendGears() {
    if (!Friend()) return;
    try { openFriendGearsOverlay(); } catch (e) { if (window.__errs) window.__errs.push('friendGears: ' + (e && e.message)); }
  }

  /* ---------- 通用小件 ---------- */
  const clipOf = (host, name) => (host && host.byName ? host.byName(name) : null);
  /** 让元件**停在**某一帧（不自己播）。状态页的按钮/格子都是"状态精灵"，只能停帧不能 play。 */
  function stopAt(clip, n) {
    if (!clip || !clip.gotoAndStop) return;
    try { clip.gotoAndStop(n); } catch (e) {}
  }
  function setTextByName(host, name, str) {
    const t = T();
    const n = clipOf(host, name);
    if (t && n) t.setText(n, str);
    return n;
  }
  /** 换帧会把 `<g>` 的子节点整个重建 —— 动效壳与点击区会一起没掉，所以每次 goTo 后重包一遍。 */
  function refreshShell(clip) {
    const t = T();
    if (!t || !clip || !clip.g) return;
    t.popWrap(clip);
    const shell = clip.g.querySelector(':scope > g.uc-pop');
    if (shell) t.wirePopPress(shell);
    t.freezeDescendants(clip);
  }
  /** Bind a stateful button once; refresh current handlers and its stable feedback shell. */
  function wireClickable(clip, spec) {
    const t = T();
    if (!t || !clip || !clip.g) return;
    spec = spec || {};
    const idleOf = () => (typeof spec.idle === 'function' ? spec.idle() : (spec.idle == null ? 1 : spec.idle));
    clip.__pinFrame = null;
    if (clip.__statusWired) {
      clip.__statusFire = spec.onFire;
      clip.__statusIdle = idleOf;
      pinIdle(clip);
      refreshShell(clip);
      return;
    }
    clip.__statusWired = true;
    clip.__statusFire = spec.onFire;
    clip.__statusIdle = idleOf;
    pinIdle(clip);
    clip.g.style.cursor = 'pointer';
    clip.g.style.pointerEvents = 'auto';
    t.measureHitBox(clip);
    t.popWrap(clip);
    const shell = clip.g.querySelector(':scope > g.uc-pop');
    if (shell) t.wirePopPress(shell);
    clip.g.addEventListener('mouseenter', () => {
      if (!spec.hover) return;                 // 0 = 这一档没有"悬停帧"，只给 CSS 光晕
      setPinned(clip, spec.hover);             // 悬停那一档同样要钉住（见上面注释）
      refreshShell(clip);
    });
    clip.g.addEventListener('mouseleave', () => { pinIdle(clip); refreshShell(clip); });
    clip.g.addEventListener('click', (e) => {
      e.stopPropagation();
      /* 按下闪一下：闪的那一帧也要钉住，闪完回常态档（`pressFlash` 的 after 里重钉）。 */
      if (spec.press) t.pressFlash(clip, idleOf(), () => { pinIdle(clip); refreshShell(clip); },
        (f) => setPinned(clip, f));
      if (clip.__statusFire) clip.__statusFire();
    });
  }
  /** Explicit state selection stops autoplay without a ticker-enforced frame pin. */
  function setPinned(clip, frame) {
    if (!clip || !clip.gotoAndStop) return;
    const want = Math.max(1, Math.round(Number(frame) || 1));
    clip.__pinFrame = null;
    if (clip.frame !== want - 1) { try { clip.gotoAndStop(want); } catch (e) {} }
    clip.playing = false;
  }
  /** Restore the current idle/selected state. */
  function pinIdle(clip) {
    if (!clip || !clip.__statusIdle) return;
    setPinned(clip, clip.__statusIdle());
  }
  /** Re-evaluate level-dependent button states. */
  function settleStatusButton(clip) {
    if (!clip || !clip.__statusIdle) return;
    if (clip.frame !== clip.__statusIdle() - 1) refreshShell(clip);
    pinIdle(clip);
  }
  /** 原版的 `mc.left._visible = false`（不是切禁用帧）—— 照抄成 CSS `visibility`。 */
  function setVisible(clip, on) {
    if (clip && clip.g) clip.g.style.visibility = on ? '' : 'hidden';
  }

  /* ============================================================
   * 立绘：把玩家**穿在身上的装备**贴到部位容器上（原版 `showFace` 的等价物）
   * ========================================================== */
  function dressParts(view, byType) {
    if (!view || !portraitContainerIds) return 0;
    let n = 0;
    for (const row of FACE_PARTS) {
      const gear = byType[row.type];
      const info = gear ? wearInfo(gear) : null;
      for (const pair of row.cells) {
        const clip = clipOf(view, pair[0]);
        if (!clip || !clip.detachAll) continue;
        clip.detachAll();
        if (!info) continue;
        const sym = portraitContainerIds[row.type] && portraitContainerIds[row.type][pair[1]];
        if (!sym) continue;
        if (clip.attachChild(sym, info.frame, 'wear')) n++;
      }
    }
    return n;
  }
  /** 读 `gear-frames.json`（id→帧号）与 `gear-slots.json`（部位→容器符号）两张表。
   *  `showFace` 只做 `attachMovie(容器) + gotoAndStop(frame)`，**不动缩放** —— 照抄。 */
  let frameTable = null;
  /** 橙装（q4 id 或旧实例 orange）对应的**原版 q4 画稿帧**：同部位同名字的 q4 套。
   *  `狂战头盔` q3 = frame 71（紫）、q4 = frame 113（橙）—— 直接沿用原版橙稿，
   *  不再拿紫稿硬填成"橙装也是紫的"（用户 2026-11 口径）。 */
  let orangeFrameTable = null;
  function gearToneKey(type, name) { return Number(type) + '|' + String(name || ''); }
  function wearInfo(gear) {
    if (!frameTable) return null;
    const base = frameTable.get(Number(gear.id));
    if (!base) return null;
    /* 强化等级加成：原版 `_loc5 += (max(addr1Lv,addr2Lv,addr3Lv) - 1)`（有强化才加）。
     * ⚠ `gear.ext` 是**附加属性数组**（`[{id, level}]`），对它做 `Number()` 得 `NaN` ——
     * 老写法 `Math.max(0, Number(ext) - 1)` 于是把帧号算成 NaN，`gotoAndStop(NaN)` 一路夹到
     * **容器第 1 帧**（那是"全身稿"那一帧，画出来是一大坨盖住整页）。
     * 与 `ui-main.js` 的 `planWears.frameFor` 取齐：`NaN || 0` → 无加成。 */
    const orange = gear.orange === true || Number(gear.quality) > 3;
    const orangeFrame = orange && orangeFrameTable ? orangeFrameTable.get(Number(gear.id)) : 0;
    /* 与 `ui-main.js` / `gearColorId` 同一口径：强化档取 ext 数组的最大 level；
     * 衣服 / 鞋子不加强化帧（「我的装备」卡的配色表只有头 / 拳套带 addr 档）。 */
    const raw = gear.ext;
    let extMax = Array.isArray(raw)
      ? raw.reduce((m, e) => Math.max(m, Number(e && e.level) || 0), 0)
      : Math.max(0, Number(raw) || 0);
    extMax = Math.max(0, Math.min(3, extMax));
    const addr = (Number(gear.type) === 0 || Number(gear.type) === 1) && extMax > 0 ? extMax - 1 : 0;
    const frame = (orangeFrame || base) + addr;
    return { frame: frame, orange: !!orange };
  }
  async function loadFrameTable() {
    if (frameTable && containerIds && portraitContainerIds) return frameTable;
    const B = 'images/ssfight/ui/';
    const j = (f) => fetch(B + f, { cache: 'force-cache' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const [r, slots] = await Promise.all([j('gear-frames.json'), j('gear-slots.json')]);
    if (r && !frameTable) {
      frameTable = new Map(r.gear.map((g) => [Number(g.id), g.frame]));
      /* q4 与 q3 的套名/部位一致，按这个键把橙稿帧挂到 q3 的 id 上。 */
      const q4 = new Map();
      for (const g of r.gear) if (Number(g.quality) === 4) q4.set(gearToneKey(g.type, g.name), g.frame);
      orangeFrameTable = new Map();
      for (const g of r.gear) {
        if (Number(g.quality) !== 3) continue;
        const f = q4.get(gearToneKey(g.type, g.name));
        if (f) orangeFrameTable.set(Number(g.id), f);
      }
    }
    if (slots && !containerIds) {
      containerIds = {};
      for (const c of slots.container || []) containerIds[c.type] = c.ids;
    }
    if (slots && !portraitContainerIds) {
      portraitContainerIds = {};
      for (const c of slots.portraitContainer || []) portraitContainerIds[c.type] = c.ids;
    }
    return frameTable;
  }

  /* ============================================================
   * 填值：`MainMovie_frame50.as` 里那一组 `setText` / `gotoAndStop`
   * ========================================================== */
  /** 原版 `showbigNumber()`（MainMovie.as:5896-5950）：把"战斗场次"这类可能上万的大数
   *  拆成**两个 4 位数字精灵**（`fightTimes1` 高位 / `fightTimes2` 低位）。
   *  复刻原来是把总数当**文本**写进 `fightTimes1`、把 `fightTimes2` 清空 —— 但这两个是
   *  **位图数字精灵**（4315），没有 `<text>`，`setText` 会把它整棵子树换成一个文本节点，
   *  于是屏幕上只剩一排"0000"。这里照原版拆位。 */
  function showBigNumber(num, mc1, mc2) {
    const t = T();
    if (!t) return;
    const n = Math.max(0, Math.round(Number(num) || 0));
    if (n < 10000) {
      if (mc1) t.showNumber(n, mc1, 0, 0, 'left');
      setVisible(mc2, false);
      return;
    }
    setVisible(mc2, true);
    /* 高位占几位（原版按数量级选 1~4） */
    const highDigits = n > 9999999 ? 4 : n > 999999 ? 3 : n > 99999 ? 2 : 1;
    const p = Math.pow(10, highDigits);
    const low = n % p, hi = Math.floor(n / p);
    if (mc1) t.showNumber(hi, mc1, 0, 0, 'right');
    /* 低位补几个前导 0（原版 `showZero = highDigits - lowDigits`），否则 10005 会显示成 "1  5" */
    const lowDigits = low > 999 ? 4 : low > 99 ? 3 : low > 9 ? 2 : low > 0 ? 1 : 0;
    if (mc2) t.showNumber(low, mc2, 0, Math.max(0, highDigits - lowDigits), 'left');
  }

  function fillValues(view) {
    const s = S();
    const t = T();
    if (!s || !t) return;
    /* 数据源：自己的话读存档；**查看别人**时整份换成对手那一套
     * （原版 `playerInfo = isViewfriend ? friendInfo : oldMyInfo`，MainMovie.as:13880-13884）；
     * 勇者模式同理，只是换成这一局/这一份草稿的四维与外观。 */
    const foe = Friend();
    const hero = Hero();
    const other = foe || hero;
    /* 准备页的四维会随点亮/点暗的被动技能即时变化，所以 `hero.stats` 允许传函数。 */
    const hs = hero ? ((typeof hero.stats === 'function' ? hero.stats() : hero.stats) || {}) : null;
    const src = foe ? {
      name: foe.name, level: Math.max(1, Math.round(Number(foe.level) || 1)),
      exp: 0, nextExp: 0, dailyWins: 0, dailyFails: 0, allWins: 0, allFails: 0,
      power: Number(foe.power) || 0, agility: Number(foe.agility) || 0,
      speed: Number(foe.speed) || 0, hp: Number(foe.hp) || 0,
    } : hero ? {
      name: '勇者', level: 1, exp: 0, nextExp: 0,
      /* 准备页还没有战绩；爬塔中回看时把本局胜场写成「战斗场次」。
       * 今日胜率沿用原版"没有败场时给 100%"的口径，不做假数据。 */
      dailyWins: Math.max(0, Number(hero.wins) || 0), dailyFails: 0,
      allWins: Math.max(0, Number(hero.wins) || 0), allFails: 0,
      power: Number(hs && hs.power) || 0,
      agility: Number(hs && hs.agility) || 0,
      speed: Number(hs && hs.speed) || 0,
      hp: Number(hs && (hs.maxHp || hs.hp)) || 0,
    } : s;
    const main = clipOf(view, 'main_mc') || view;
    const nextExp = other ? 0 : Math.max(1, (window.GData && GData.nextExp) ? GData.nextExp(s.level) : (s.nextExp || 1));

    /* 经验条 `expMc`：101 帧（第 N 帧 = 蒙版右移 N×0.95），照村庄页 `refreshValues` 同一条公式。
     * 看别人时原版也没有他的经验数据（服务端有 `exp`，这里的对手对象没有）→ 条收空、数字清空。 */
    const ePct = other ? 0 : Math.ceil(s.exp * 100 / nextExp);
    stopAt(main.byName ? main.byName('expMc') : null, Math.max(1, Math.min(101, ePct + 1)));
    /* `expNum` 是原版那行 "999999/999999" 占位文本（素材里写死的），写真实值。 */
    setTextByName(view, 'expNum', other ? '' : (s.exp + '/' + nextExp));

    /* 今日胜率 / 战斗场次：原版 `MainMovie.as:13995-14003` ——
     * 胜率用 `showNumber`（**位图数字**，没有场次时原版给 100），
     * 场次用 `showbigNumber` 拆成两颗。复刻之前用 `setText` 写字符串，
     * 把位图数字精灵整棵子树换掉，表现就是"所有数字都不显示"。 */
    const wins = Number(src.dailyWins) || 0, fails = Number(src.dailyFails) || 0;
    const fights = wins + fails;
    const rate = fights > 0 ? Math.ceil(wins * 100 / fights) : 100;
    const rateClip = clipOf(view, 'winRate');
    if (rateClip) t.showNumber(rate, rateClip, 0, 0, 'right');
    const allFights = (Number(src.allWins) || 0) + (Number(src.allFails) || 0);
    showBigNumber(allFights, clipOf(view, 'fightTimes1'), clipOf(view, 'fightTimes2'));

    /* 四维：用原版那套数字精灵（`showNumber`），和村庄页顶栏同一套写法。 */
    const stats = other
      ? { power: src.power, agility: src.agility, speed: src.speed, hp: src.hp }
      : ((State.totalStats && State.totalStats()) || {});
    for (const row of STATS) {
      const c = clipOf(view, row[0]);
      if (c && window.SfUiMain && SfUiMain.showNumber) {
        SfUiMain.showNumber(Math.max(0, Math.round(Number(stats[row[1]]) || 0)), c, 0, 0, 'left', 4);
      }
    }

    /* 两颗状态键的帧跟着等级走（原版 `MainMovie.as:13931-13974`：>4 级才有"更换装备"、
     * >19 级才有"装备融合"，不够级就停在灰底那一档）。查看别人时第 4/5 帧 = 「查看装备」、
     * `b_fusion` 停第 3 帧（原版 :13881-13926），由 `settleStatusButton` 统一处理。 */
    settleStatusButton(clipOf(view, 'b_change'));
    settleStatusButton(clipOf(view, 'b_fusion'));

    /* 立绘：穿在身上的装备贴到部位容器上（`showFace`）。
     * 看别人时贴的是**他自己的** `wearsList`（原版 :13884）。 */
    let worn = [];
    if (foe) worn = Array.isArray(foe.gears) ? foe.gears : [];
    else if (hero) {
      /* 准备页传进来的是四格 id（`[0,0,0,0]`），爬塔中传的是 run.hero.appearance。
       * 两种都归一成 `{id,type,ext}`，`dressParts` 只认这一种。 */
      worn = (Array.isArray(hero.appearance) ? hero.appearance : []).map((raw) => {
        const item = (raw && typeof raw === 'object') ? raw : { id: Number(raw) };
        const id = Number(item.id);
        if (!(id > 0)) return null;
        const type = Number(item.type != null ? item.type : (State.gearPart ? State.gearPart(id) : NaN));
        if (!Number.isFinite(type)) return null;
        return { id: id, type: type, ext: Array.isArray(item.ext) ? item.ext : [] };
      }).filter(Boolean);
    } else { try { worn = (State.myGears ? State.myGears() : []).filter((g) => g && g.used); } catch (e) { worn = []; } }
    const byType = [];
    for (const g of worn) {
      const ty = Number(g.type != null ? g.type : (State.gearPart ? State.gearPart(g.id) : NaN));
      if (!Number.isFinite(ty)) continue;
      if (byType[ty] === undefined) byType[ty] = g.type == null ? Object.assign({}, g, { type: ty }) : g;
    }
    dressParts(view, byType);
    /* 经验数字整体上移一点（见 EXP_DY 的注释）。 */
    nudgeExp(view);
  }

  /* ⚠ 历史上这里有一个 `valueClips()`，作用是"把数值精灵连子树一起排除在钉帧之外"。
   * 那条例外**只对老机制（`pinFrame`：每一拍强制拨回第 1 帧）成立** —— 现在静态页策略
   * 只写 `playing = false`（不自己往前走、不碰帧号），`showNumber` 逐位 `gotoAndStop`
   * 完全不受影响，所以数字精灵照冻不误，这个"保护名单"没有了存在理由（已删除）。 */

  /* ============================================================
   * 武器 / 技能栏（原版页元件 7218 的第 2、3 帧）
   * ------------------------------------------------------------
   * 用户 2026-10 口径："状态页面中武器栏技能栏没有和状态栏同步 ui…将武器与技能页面与 ssfight 对齐"，
   * 后续追加："武器与技能的贴图大小和位置不对，进行靠齐；贴图不要再使用旧素材，
   * 去 ssfight 版本中捞出矢量图素材进行替换。"
   *
   * 原版这三页是**同一个页元件的三个帧**（1 = 状态 / 2 = 武器 / 3 = 技能）：顶栏三个 tab、
   * 米色面板、"返回菜单"、页码 `1/2` 与左右翻页箭头都是**同一套 ui**。
   * 格子里那 10 个图标原版是运行时 `attachMovie(weaponSkill.name, "mc", 100)` 挂的**库元件**
   * （`MainMovie.as:16637 loadWeaponSkill`，元件名就是武器/技能名）——
   * 所以复刻也照这条走：`tools/gen-ssfight-ui.cjs` 的 `swfSymbolIds()` 按名字把那些元件
   * 从 SWF 里查出来、从整片导出里抠成 `tags-wsicon.json`（**37 颗，一个不缺**），
   * 这里把它们**挂进原版的格子元件**（`cell.attachChild(符号)`），
   * 于是图标的长相 / 大小 / 落点全部由原版素材与格位决定，不再自己画一层 DOM。
   * ⚠ 名字→元件 id 必须走 `swfSymbolIds()`（读 SWF 自己配对）；那张
   * `01-swf-符号表/导出符号表.tsv` 整体错位一格，用它会出现"贴图全串位"（见生成器注释）。
   *
   * 原版格位（导出数据实测，格元件 3636 的画稿 41.25×41.25）：
   *   左上角 (34.1, 38.65)，列距 53.3、行距 62.7，10 格 = 5 列 × 2 行；行 2 的 y = 101.35。
   * 每个格元件 **3 帧**：1 = 空（无内容）/ 2 = 内容帧（`zhuangtai.c{i}` 停在 2 才显示挂进来的图标）
   * / 3 = 空。没获得的那一档原版挂"名字 + 1"的另一个元件 —— 复刻用**同一颗矢量图标 + 灰阶**
   * （`.locked`），因为那一批在导出里连形状都没做出来。
   * ========================================================== */
  const PAGE_FRAME = { status: 1, weapons: 2, skills: 3 };
  const GRID_CELLS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'];
  /* 图标元件统一停第 1 帧：第 2 帧是"真化"那一档（多一枚红色「真」印章），
   * 但它同时带着**导出时烤进画稿的名字 + "Lv99" 占位**；卡片以下那一条我们已经切掉了，
   * 而印章只在卡片右下角一小块 —— 为它留一整条文字不如自己画一枚（`.sf-true`）。 */
  /** 当前停在哪个 tab（1s 重刷与接线闭包都读它）。 */
  function activeTab() { return current ? current.tab : 'status'; }
  function gridKind() { return activeTab() === 'skills' ? 'skill' : 'weapon'; }
  function gridInfo() {
    const C = window.UI && UI.classic;
    if (!C || !C.catalogInfo || !current) return null;
    /* 查看别人时格子画的是**他的**武器 / 技能（原版 `showWeaponSkills` :22022
     * 同样是 `isViewfriend ? friendInfo : oldMyInfo`，只是把"有没有"换成他的清单）。 */
    const foe = Friend();
    if (foe) return friendGridInfo(foe, gridKind(), current.gridPage || 0);
    if (heroView()) return heroGridInfo(gridKind(), current.gridPage || 0);
    return C.catalogInfo(gridKind(), current.gridPage || 0);
  }
  /** 把对手那一串 `["id:level", …]` 摊成状态页格子要的 `{items, page, pages}`。
   *  ⚠ 图标必须**自己补**：`UI.classic.catalogItems()` 只给字典条目（id / 名字），
   *  图标那一步在 `catalogInfo()` 里（`wsIconOf(kind, id)`）—— 这里走的是"另做一个数据源"
   *  那条路，所以要照 `catalogInfo` 的做法补一次，否则格子是空的（本批实测踩过）。 */
  function friendGridInfo(foe, kind, pg) {
    const C = window.UI && UI.classic;
    if (!C || !C.catalogItems) return null;
    const base = C.catalogItems(kind) || [];
    const own = (kind === 'skill' ? (foe.skills || []) : (foe.weapons || [])).map((w) => {
      const parts = String(w).split(/[:,]/);
      return { id: Number(parts[0]), level: Math.max(1, Number(parts[1]) || 1) };
    });
    const items = base.map((it) => {
      const has = own.find((x) => x.id === it.id) || null;
      return {
        id: it.id, name: it.name, has: !!has,
        level: has ? has.level : 0,
        trueForm: !!has && Number(has.level) > 10,
        selected: false,
        label: '',
        icon: C.wsIconOf ? C.wsIconOf(kind, it.id) : null,
        /* 没获得的那一档也挂原版「名字 + 1」那颗灰卡元件；只给 icon 不给 lockedIcon 时
         * `paintCell` 会当成空槽（`it.has ? it.icon : it.lockedIcon` 取到 null）→ 整格空着。 */
        lockedIcon: C.wsIconOf ? C.wsIconOf(kind, it.id, true) : null,
      };
    });
    const pages = Math.max(1, Math.ceil(items.length / 10));
    const page = Math.max(0, Math.min(pages - 1, pg | 0));
    return { items: items.slice(page * 10, page * 10 + 10), page: page, pages: pages };
  }
  /** 勇者模式的武器 / 技能格：清单来自 `TowerHero.catalog()`（与准备页的可选范围同一份），
   *  准备时点亮 = 已获得（绿卡 + 名字），爬塔中只读 = 已学（带真实等级）。
   *  ⚠ 未点亮的项也要给 `lockedIcon`：`paintCell` 只认 `it.has ? it.icon : it.lockedIcon`，
   *    漏了它整格就是空槽，玩家会以为「这一页什么都没有」。 */
  function heroGridInfo(kind, pg) {
    const C = window.UI && UI.classic;
    if (!current || !C || !C.wsIconOf || !window.TowerHero || typeof TowerHero.catalog !== 'function') return null;
    const hero = Hero();
    const base = TowerHero.catalog().filter((it) => it.kind === kind);
    const startLevel = Math.max(1, Number(window.TowerHero && TowerHero.CONFIG && TowerHero.CONFIG.startLevel) || 5);
    const picked = heroPickSet();
    const levels = new Map();
    for (const raw of ((kind === 'weapon' ? hero.weapons : hero.skills) || [])) {
      const parts = String(raw).split(/[:,]/);
      const id = Number(parts[0]);
      if (id > 0) levels.set(id, Math.max(levels.get(id) || 1, Number(parts[1]) || 1));
    }
    const items = base.map((it) => {
      const id = Number(it.id);
      const has = hero.mode === 'setup' ? picked.has(heroPickKey(kind, id)) : levels.has(id);
      const level = hero.mode === 'setup' ? (has ? startLevel : 0) : (levels.get(id) || 0);
      return {
        id: id, name: it.name || '', has: has, level: level,
        trueForm: hero.mode !== 'setup' && level > 10,
        selected: hero.mode === 'setup' && has,
        label: '',
        icon: C.wsIconOf(kind, id),
        lockedIcon: C.wsIconOf(kind, id, true),
      };
    });
    const pages = Math.max(1, Math.ceil(items.length / 10));
    const page = Math.max(0, Math.min(pages - 1, pg | 0));
    return { items: items.slice(page * 10, page * 10 + 10), page: page, pages: pages };
  }
  /** 切一格武技：点亮 / 点暗。准备页最多 3 个；爬塔中只读。 */
  function heroTogglePick(kind, id) {
    const hero = Hero();
    if (!hero || hero.mode !== 'setup') return { ok: false };
    const key = heroPickKey(kind, id);
    const list = (Array.isArray(hero.picks) ? hero.picks : []).map((it) => ({ kind: it.kind, id: Number(it.id) }));
    const at = list.findIndex((it) => heroPickKey(it.kind, it.id) === key);
    if (at >= 0) list.splice(at, 1);
    else if (list.length >= HERO_PICK_LIMIT) {
      return { ok: false, msg: '最多点亮 ' + HERO_PICK_LIMIT + ' 个武技；先点暗一个再换。' };
    } else list.push({ kind: kind, id: Number(id) });
    hero.picks = list;
    if (typeof hero.onPicks === 'function') hero.onPicks(list.map((it) => Object.assign({}, it)));
    if (list.length === HERO_PICK_LIMIT && window.UI && UI.toast) {
      UI.toast('已点亮 ' + HERO_PICK_LIMIT + ' 个武技；回「状态」页点「开始挑战」出发。');
    }
    /* 武技页点亮时四维/被动也在变；重写一遍数值，再重画格子。 */
    try { if (current && current.view) fillValues(current.view); } catch (e) {}
    try { applyTab(); } catch (e) { if (window.__errs) window.__errs.push('hero pick: ' + (e && e.message)); }
    refreshHeroChrome();
    return { ok: true };
  }
  /** 单元格子上要显示的东西。
   *  ⚠ 顺序必须是 **先摆帧、再挂内容**：`showFrame()` 在帧号真的变了的时候会
   *  **重建 `<g>` 的全部子节点**（把上一步挂进去的图标一起清掉），所以 `stopAt` 之后才挂。
   *
   *  原版这一格的四档外观**全在导出素材里**（对着 `references/screen/屏幕截图 …162315.png` 实测）：
   *   · 图标元件（如 2139）**2 帧**：1 = 常态卡片（形状 2028，米白 + 黄爆芒）；
   *     2 = **选中卡片**（形状 2037，绿底 + 绿框）；
   *   · 卡片下方那条（元件名 `wname1`/`wname`，符号 **2138**）**4 帧**：
   *     1 = 名字（矢量画稿 2137，深绿）/ 2 = 名字 +「真」印章 / 3 = 只有「真」印章 / 4 = 空；
   *     「真」印章是那颗 tp39 精灵 2034，摆在自己坐标 (39.25, −34.5)（= 卡片右下角、压出格）。
   *   · 等级文字是**真的文本字段**（占位串 "Lv99"），原版由 `loadWeaponSkill` 的
   *     `setText(_loc1.level, "LV"+n)` 写值 —— 复刻照写。
   *
   *  于是四档就是"拨两层帧"：
   *   | 选中 | 真化 | 图标帧 | 名字层帧 |
   *   |---|---|---|---|
   *   | ✗ | ✗ | 1 | 4（空） |
   *   | ✗ | ✓ | 1 | 3（只有印章） |
   *   | ✓ | ✗ | 2 | 1（只有名字） |
   *   | ✓ | ✓ | 2 | 2（名字 + 印章） |
   *
   *  ⚠ **没获得的那一档**原版是另一颗 `武器名+"1"` 的库元件（导出符号表里 spriteId 全是 `None`，
   *   拿不到素材），复刻只能用**同一颗矢量图标 + `.locked` 灰阶**近似 —— 见 css。 */
  const ICON_LABEL_Y = 43;        // 卡片与"名字/印章那一条"的分界（舞台单位，实测 44.5~47.2 起）
  function localY(ma) {
    if (!ma) return 0;
    const a = String(ma).split(',');
    return a.length >= 6 ? (Number(a[5]) || 0) : 0;
  }
  function paintCell(cell, kind, it) {
    if (!cell || !cell.detachAll) return;
    /* 原版 `showWeaponSkills`：有内容的格子 `gotoAndStop(2)`（内容帧），空槽 `gotoAndStop(1)`。
     * ⚠ 实测 `tags-status.json` 里格子元件 **3636 只有 2 帧**（f1 = 卡片画稿 3635 / **f2 = 空**），
     *  所以复刻把方向反过来用：**有内容停第 1 帧（卡片可见）、空槽停末帧（空）**。
     *  写反了会整栏只剩一圈光晕、卡片一张都看不见 —— 查看别人那一页实测踩过。 */
    stopAt(cell, it ? 1 : (cell.frameCount ? cell.frameCount() : 2));
    /* ⚠ 内容没变就**别重挂**：`fillValues()` 每秒会调一次 `applyTab()`，而每挂一颗图标都要
     * 新建一棵实例树（`attachChild`）。1 秒白白重建 10 棵，既扔 GC 又平白多一次闪烁风险。 */
    const sel = !!(it && it.has && it.selected), tru = !!(it && it.trueForm);
    const sig = it ? [it.id, it.has ? 1 : 0, it.level, it.has ? it.icon : it.lockedIcon, tru ? 1 : 0, sel ? 1 : 0].join(':') : '';
    if (cell.__artSig === sig) return;
    cell.__artSig = sig;
    cell.detachAll();
    if (!it || !(it.has ? it.icon : it.lockedIcon)) return;
    /* ⚠ **没获得的那一档是另一颗库元件**（`it.lockedIcon` = 原版的名字 + "1"）：
     *   `showWeaponSkills`（MainMovie.as:22050-22057）就是 `has ? attachMovie(名字) :
     *   attachMovie(名字 + "1")`。那颗自己带**灰底卡片 + 灰色的名字层**，第 2 帧才把名字显出来
     *   （第 1 帧只有灰卡片）—— 所以"悬停未获得的格子显示灰名字"走的是**和已获得完全同一套**
     *   选帧机制，不需要另做一条 DOM 名字条。以前这里两档都挂已获得那颗、再用 CSS
     *   `filter:grayscale` 压成灰的，名字层根本没有灰版，只能靠 DOM 硬贴（用户 2026-10 口径）。 */
    const clip = cell.attachChild(it.has ? it.icon : it.lockedIcon, sel ? 2 : 1, 'icon');
    if (!clip || !clip.g) return;
    /* 兜底：素材表还是老版（没有 `locked` 那一档 → `wsIconOf(…,true)` 回落到同一颗）时，
     * 用 CSS 灰阶把已获得那颗压成灰色，至少不会把没拿到的武器画成彩色的。 */
    if (!it.has && it.lockedIcon === it.icon) clip.g.classList.add('locked');
    if (it.has) dressIcon(clip, it, sel);
    else { paintIconLabel(clip, false, false); writeIconLevel(clip, it, false); }
  }
  /** 把 `attachChild` 挂上去的子元件挪到宿主 `<g>` 的末尾（= 画在最上层）。
   *  `popWrap()` 会把可见内容搬进一层 `<g class="uc-pop">` 壳里，所以两级都要看一眼。 */
  function raiseAttached(host) {
    if (!host || !host.__attached || !host.__attached.length) return;
    const shell = host.g.querySelector(':scope > g.uc-pop') || host.g;
    for (const c of host.__attached) if (c.g && c.g.parentNode === shell) shell.appendChild(c.g);
  }
  /** 取格子里那颗挂上去的图标元件（`attachChild(…, 'icon')` 出来的那一颗）。 */
  function cellIconClip(cell) {
    for (const c of (cell && cell.__attached) || []) {
      if (c.g && c.g.getAttribute && c.g.getAttribute('attach-name') === 'icon') return c;
    }
    return null;
  }
  /** 把一颗图标摆到"选中 / 常态"那一档：图标帧 + 名字/印章层帧 + 等级文字，一次到位。
   *  ⚠ **选中时等级文字要让位**：原版那张矢量名字（2137 那一类）压在卡片下方、和 `level`
   *  字段同一行（实测原版截图里选中那一格只有名字、没有 "LV1"）。 */
  function dressIcon(clip, it, sel) {
    if (!clip || !it) return;
    stopAt(clip, sel ? 2 : 1);
    paintIconLabel(clip, sel, !!it.trueForm);
    writeIconLevel(clip, it, sel);
  }
  /** 把格子的外观切到"选中 / 悬停"那一档（**只拨帧，不重建实例**）。
   *  原版没有鼠标：它靠键盘光标选中某一项（`showButton(weaponskillLoadArray, i, 1)` →
   *  `mc.gotoAndStop(2)`），选中的那一格才显示名字、卡片才变绿。
   *  复刻把**悬停**当成那个光标位置 —— 见 `wireCell`。
   *  ⚠ **未获得的那一档同样走这条路**（用户 2026-10 口径："悬停未解锁的也显示名称，
   *    方案与已解锁一致，只是字体是同色灰色"）：原版没获得挂的是"名字 + 1"那颗元件，
   *    它的第 2 帧 = 灰卡片 + **灰名字**，所以拨帧这一下就够了，两档共用一套。 */
  function setCellLook(cell, it, hovered) {
    if (!cell || !it) return false;
    const clip = cellIconClip(cell);
    if (!clip) return false;
    dressIcon(clip, it, !!it.selected || !!hovered);
    return true;
  }
  /** 拨"卡片下方那一条"（名字 / 「真」印章）的帧，见 `paintCell` 的四档表。
   *  ⚠ 判据用**放置自己的局部 y**（写在 `__baseMa` 里），不要用"实测包围盒占整体的比例"：
   *  实测那 37 颗图标里名字层的落点是 **44.5~47.2**、等级文本是 45.7~45.9、
   *  卡片里的图形最高只到 **28.75**，中间有一大段空白可切；而按包围盒比例切会因为
   *  每颗名字长短不同、上下留白不同而**有的切掉有的切不掉**（用户看到的"十个格子里
   *  有八个还挂着名字"就是这么来的）。`level` 那个文本字段留着不动（`writeIconLevel` 要写它）。 */
  function paintIconLabel(clip, selected, trueForm) {
    if (!clip || !clip.nodes) return;
    const frame = (selected ? (trueForm ? 2 : 1) : (trueForm ? 3 : 4));
    for (const rec of clip.nodes.values()) {
      if (/^level$/i.test(rec.na || '')) continue;
      if (localY(rec.node && rec.node.__baseMa) < ICON_LABEL_Y) continue;
      if (!rec.clip) continue;
      stopAt(rec.clip, frame);
    }
  }
  /** 把图标元件里的等级文字写成原版那一套（`loadWeaponSkill`：>10 级显示 level-10）。
   *  `hide` = 这一格正显示矢量名字（选中 / 悬停）—— 名字和等级文字在同一行，
   *  原版选中那一格只看得到名字（见 `dressIcon` 的注释），所以这时把等级文字清空。 */
  function writeIconLevel(clip, it, hide) {
    const g = clip && clip.g;
    if (!g || !g.querySelectorAll) return;
    const lv = Number(it.level) || 0;
    const text = (hide || !it.has || lv <= 0) ? '' : ('LV' + (lv > 10 ? lv - 10 : lv));
    for (const t of g.querySelectorAll('text')) t.textContent = text;
  }
  /** 隐藏/显示网格这一套（格子 / 页码 / 翻页箭头）。原版第 1 帧里根本没有这些名字，
   *  所以"藏"就是把它们从路由与显示里摘出去。 */
  function showGridParts(on) {
    const view = current && current.view;
    if (!view) return;
    for (const n of GRID_CELLS.concat(['left', 'right', 'page'])) {
      const c = clipOf(view, n);
      const g = c && (c.g || c);
      if (g && g.style) g.style.visibility = on ? '' : 'hidden';
      if (g && g.style) g.style.display = on ? '' : 'none';
    }
  }
  /* ============================================================
   * 勇者模式的按钮层 —— 把「装备融合」那一位换成「开始挑战」
   * ------------------------------------------------------------
   * 原版自己的状态页第 1 帧里就有两颗并排的键：更换装备（`b_change`）与装备融合
   * （`b_fusion`，实测舞台 x 222.5..300.1 / y 92.9..136）。随机挑战查看敌人时
   * `b_fusion` 被整颗藏掉，所以那一块是空的。
   * 勇者准备页正好把 `b_fusion` 藏掉、在原位挂一颗 **3911 金胶囊**（也就是「返回」那颗），
   * 把「返回」字形层藏掉、自己写「开始挑战」四个字 —— 于是两颗键的版式与原版一致，
   * 又不用另画一套现代 DOM 按钮。
   * ⚠ 状态页只有第 1 帧有这两颗键；武器 / 技能页要 `display:none`，否则会压在卡片上。
   * ========================================================== */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  /* 开始挑战沿用原版 3911 的皮，只把宽度收窄一点（sx < sy）。 */
  const HERO_START_AT = { x: 268, y: 112.8, s: 0.7, sx: 0.64 };
  /* ============================================================
   * 准备页「出发准备」卡（2026-10 用户口径：参考现代状态页的排布大幅美化）
   * ------------------------------------------------------------
   * 原版 7218 的右上角有一块空白（立绘右沿 x≈130、两颗键上沿 y≈98、
   * 页签下沿 y≈31）。这里用原版奶油底 + 金边画一张小卡：
   *   标题 / 三块事实（武技 / 四维 / 外观）/ 进度条 / 待办提示。
   * 仍用 SVG 原生物件（不挂 DOM），所以会跟着 320×196 舞台等比缩放。
   * ============================================================ */
  const HERO_TODO_BOX = { x: 148, y: 36, w: 150, h: 60, r: 7 };
  const HERO_TODO_FACTS = [
    { key: 'picks', x: 153, w: 43, label: '武技' },
    { key: 'stats', x: 199, w: 43, label: '四维' },
    { key: 'gears', x: 245, w: 43, label: '外观' },
  ];
  /** 准备页的小字：统一字体，省得每处重复。 */
  function heroChromeText(x, y, size, fill, weight, anchor) {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(x)); text.setAttribute('y', String(y));
    text.setAttribute('font-size', String(size)); text.setAttribute('fill', fill);
    text.setAttribute('font-weight', weight || '700');
    text.setAttribute('text-anchor', anchor || 'start');
    text.setAttribute('font-family', '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif');
    text.setAttribute('stroke', '#fff6df');
    text.setAttribute('stroke-width', '1.6');
    text.setAttribute('stroke-linejoin', 'round');
    text.setAttribute('paint-order', 'stroke');
    return text;
  }
  function heroSvgRect(x, y, w, h, r, fill, stroke, strokeWidth) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(w)); rect.setAttribute('height', String(h));
    rect.setAttribute('rx', String(r == null ? 6 : r));
    rect.setAttribute('fill', fill); rect.setAttribute('stroke', stroke || 'none');
    if (strokeWidth) rect.setAttribute('stroke-width', String(strokeWidth));
    return rect;
  }
  /** 右上角「出发准备」卡：标题 + 三块事实 + 进度条 + 待办提示。 */
  function heroTodoEnsure(view) {
    let g = view.__heroTodo;
    if (g && g.isConnected) return g;
    g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('pointer-events', 'none');
    g.setAttribute('class', 'sf-hero-todo');
    const box = HERO_TODO_BOX;
    g.appendChild(heroSvgRect(box.x, box.y, box.w, box.h, box.r, '#fff9e9', '#d8bd86', 1.6));
    g.appendChild(heroSvgRect(box.x + 3, box.y + 3, box.w - 6, box.h - 6, box.r - 2, 'none', '#fffdf7', 1));
    const title = heroChromeText(box.x + 9, box.y + 12, 8.4, '#3d654e', '800', 'start');
    title.textContent = '出发准备';
    const badge = heroChromeText(box.x + box.w - 8, box.y + 11.6, 5.2, '#a37735', '700', 'end');
    badge.textContent = '勇者剧本';
    g.appendChild(badge);
    const facts = [];
    for (const f of HERO_TODO_FACTS) {
      g.appendChild(heroSvgRect(f.x, box.y + 16, f.w, 18, 4, '#fffdf6', '#e6d4ac', 1));
      const label = heroChromeText(f.x + 4, box.y + 21.5, 4.6, '#9a7b4e', '700', 'start');
      label.textContent = f.label;
      const value = heroChromeText(f.x + 4, box.y + 30.5, 6.8, '#3d654e', '800', 'start');
      value.textContent = '—';
      g.appendChild(label); g.appendChild(value);
      facts.push({ key: f.key, value: value });
    }
    /* 进度条：底槽 + 绿色填充。 */
    g.appendChild(heroSvgRect(box.x + 9, box.y + 38, box.w - 18, 3.6, 2, '#eadfc6', '#dccbaa', 0.6));
    const meter = heroSvgRect(box.x + 9, box.y + 38, 0, 3.6, 2, '#7fb84d', 'none', 0);
    g.appendChild(meter);
    const footer = heroChromeText(box.x + box.w / 2, box.y + 51, 5.6, '#b06b1f', '700', 'middle');
    footer.textContent = '';
    g.appendChild(footer);
    g.appendChild(title);
    g.__facts = facts; g.__meter = meter; g.__footer = footer;
    view.g.appendChild(g);
    view.__heroTodo = g;
    return g;
  }
  function heroTodoRefresh(view) {
    const hero = Hero();
    let g = view.__heroTodo;
    /* 出发准备只属于「状态」页；切到武器 / 技能必须消失。 */
    if (!hero || hero.mode !== 'setup' || activeTab() !== 'status') { if (g) g.style.display = 'none'; return; }
    g = heroTodoEnsure(view);
    g.style.display = '';
    const picks = heroPickCount();
    const state = heroStatState();
    const pool = state ? Math.max(0, Number(state.pool) || 0) : 0;
    const gears = heroGearSlots().filter((id) => Number(id) > 0).length;
    const ready = picks >= HERO_PICK_LIMIT && pool === 0;
    const values = {
      picks: picks + ' / ' + HERO_PICK_LIMIT,
      stats: pool > 0 ? ('待分 ' + pool) : '已分配',
      gears: gears + ' / 4',
    };
    for (const fact of (g.__facts || [])) {
      if (!fact.value) continue;
      fact.value.textContent = values[fact.key] || '—';
      fact.value.setAttribute('fill', fact.key === 'picks' && picks >= HERO_PICK_LIMIT ? '#2f7a4f'
        : fact.key === 'stats' && pool === 0 ? '#2f7a4f' : '#3d654e');
    }
    if (g.__meter) {
      const width = (HERO_TODO_BOX.w - 18) * Math.max(0, Math.min(1, picks / HERO_PICK_LIMIT));
      g.__meter.setAttribute('width', width.toFixed(2));
      g.__meter.setAttribute('fill', ready ? '#5ca33a' : '#8fc35d');
    }
    if (g.__footer) {
      g.__footer.textContent = picks < HERO_PICK_LIMIT
        ? ('还差 ' + (HERO_PICK_LIMIT - picks) + ' 个武技')
        : (pool > 0 ? ('还有 ' + pool + ' 点可分配') : '准备就绪，可以出发');
      g.__footer.setAttribute('fill', ready ? '#2f7a4f' : '#b06b1f');
    }
  }
  /* 爬塔回看：右上角空白画一张「渴血之剑」小卡（准备页那一块在这里变成剑的阶段 / 成长 / 献祭）。
   * 没有剑时也显示「尚未持剑」，告诉玩家第一次巡视胜利后必定获得。 */
  const HERO_BLADE_BOX = { x: 164, y: 38, w: 134, h: 54, r: 7 };
  function heroBladeCardEnsure(view) {
    let g = view.__heroBladeCard;
    if (g && g.isConnected) return g;
    g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('pointer-events', 'none');
    g.setAttribute('class', 'sf-hero-blade-card');
    const box = HERO_BLADE_BOX;
    g.appendChild(heroSvgRect(box.x, box.y, box.w, box.h, box.r, '#fff9e9', '#d8bd86', 1.6));
    g.appendChild(heroSvgRect(box.x + 3, box.y + 3, box.w - 6, box.h - 6, box.r - 2, 'none', '#fffdf7', 1));
    const title = heroChromeText(box.x + 9, box.y + 13, 7.6, '#3d654e', '800', 'start');
    title.textContent = '渴血之剑';
    const state = heroChromeText(box.x + box.w - 8, box.y + 12.4, 6.2, '#a37735', '700', 'end');
    state.textContent = '尚未持剑';
    const line1 = heroChromeText(box.x + 9, box.y + 27, 6.4, '#6b4a25', '700', 'start');
    line1.textContent = '';
    const line2 = heroChromeText(box.x + 9, box.y + 37, 5.2, '#6b4a25', '600', 'start');
    line2.textContent = '';
    const line3 = heroChromeText(box.x + 9, box.y + 46, 5.0, '#9a7b4e', '600', 'start');
    line3.textContent = '';
    g.appendChild(title); g.appendChild(state); g.appendChild(line1); g.appendChild(line2); g.appendChild(line3);
    g.__state = state; g.__line1 = line1; g.__line2 = line2; g.__line3 = line3;
    view.g.appendChild(g);
    view.__heroBladeCard = g;
    return g;
  }
  function heroBladeCardRefresh(view) {
    const hero = Hero();
    let g = view.__heroBladeCard;
    if (!hero || hero.mode !== 'run' || activeTab() !== 'status') { if (g) g.style.display = 'none'; return; }
    g = heroBladeCardEnsure(view);
    g.style.display = '';
    const blade = hero.blade || null;
    if (g.__state) {
      g.__state.textContent = blade ? (blade.unlimited ? '永续' : ('剩 ' + blade.uses + ' 场')) : '尚未持剑';
      g.__state.setAttribute('fill', blade ? '#2f7a4f' : '#a37735');
    }
    if (g.__line1) g.__line1.textContent = blade
      ? (blade.name + (blade.final ? ' · 最终' : blade.dead ? ' · 失活' : ' · 第' + blade.stage + '阶段'))
      : '第一次巡视胜利';
    if (g.__line2) g.__line2.textContent = blade
      ? ('献祭成长 ×' + blade.stacks + ' / 5')
      : '固定获得 · 不可跳过';
    if (g.__line3) g.__line3.textContent = blade
      ? (blade.final
        ? ('克镜：力量 −' + Math.round(blade.powerCut * 100) + '% · 生命 −' + Math.round(blade.hpCut * 100) + '%')
        : (blade.dead ? '失活 · 偏生存 · 无需献祭' : '战斗后需献祭一件祭品'))
      : '跨百层保留 · 会进化';
  }

  /** 盖在 3911 胶囊上的「开始挑战」四个字（独立一层，切帧不会把它重建掉）。 */
  function heroStartLabelEnsure(view) {
    let g = view.__heroStartLabel;
    if (!g || g.isConnected === false) {
      g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('pointer-events', 'none');
      g.setAttribute('transform', 'matrix(' + HERO_START_AT.s + ',0,0,' + HERO_START_AT.s + ',' + HERO_START_AT.x + ',' + HERO_START_AT.y + ')');
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', '-1'); text.setAttribute('y', '8');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '16');
      text.setAttribute('font-family', '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif');
      text.setAttribute('font-weight', '900');
      text.setAttribute('fill', '#fffdf1');
      text.setAttribute('stroke', '#542201');
      text.setAttribute('stroke-width', '3');
      text.setAttribute('stroke-linejoin', 'round');
      text.setAttribute('paint-order', 'stroke');
      text.textContent = '开始挑战';
      g.appendChild(text);
      view.g.appendChild(g);
      view.__heroStartLabel = g;
    }
    return g;
  }
  function heroStartEnsure(view) {
    let start = view.__heroStart;
    if (start && start.g && start.g.isConnected) return start;
    try { start = view.attachChild('3911', 1, 'hero-start'); } catch (e) { start = null; }
    if (!start || !start.g) return null;
    view.__heroStart = start;
    start.g.classList.add('sf-hero-start');
    start.g.setAttribute('transform', 'matrix(' + HERO_START_AT.sx + ',0,0,' + HERO_START_AT.s + ',' + HERO_START_AT.x + ',' + HERO_START_AT.y + ')');
    /* 3911 自带的「返回」白字是 depth 4 那一层；CSS `.sf-hero-start` 负责在所有帧里把它藏掉。 */
    const hit = start.g.querySelector('[data-hit="1"]');
    if (hit) {
      hit.setAttribute('x', '-55'); hit.setAttribute('y', '-11');
      hit.setAttribute('width', '108'); hit.setAttribute('height', '30');
    }
    return start;
  }
  /** 爬塔中的「铸币修炼」：与「开始挑战」共用 3911 金胶囊，只是文字与回调不同。
   *  准备页用开始键；回看页（mode: 'run'）把同一位置换成修炼键。 */
  function heroTrainEnsure(view) {
    let btn = view.__heroTrain;
    if (btn && btn.g && btn.g.isConnected) return btn;
    try { btn = view.attachChild('3911', 1, 'hero-train'); } catch (e) { btn = null; }
    if (!btn || !btn.g) return null;
    view.__heroTrain = btn;
    btn.g.classList.add('sf-hero-train');
    btn.g.setAttribute('transform', 'matrix(' + HERO_START_AT.sx + ',0,0,' + HERO_START_AT.s + ',' + HERO_START_AT.x + ',' + HERO_START_AT.y + ')');
    const hit = btn.g.querySelector('[data-hit="1"]');
    if (hit) {
      hit.setAttribute('x', '-55'); hit.setAttribute('y', '-11');
      hit.setAttribute('width', '108'); hit.setAttribute('height', '30');
    }
    return btn;
  }
  function heroTrainLabelEnsure(view) {
    let g = view.__heroTrainLabel;
    if (!g || g.isConnected === false) {
      g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('pointer-events', 'none');
      g.setAttribute('transform', 'matrix(' + HERO_START_AT.s + ',0,0,' + HERO_START_AT.s + ',' + HERO_START_AT.x + ',' + HERO_START_AT.y + ')');
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', '-1'); text.setAttribute('y', '8');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '16');
      text.setAttribute('font-family', '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif');
      text.setAttribute('font-weight', '900');
      text.setAttribute('fill', '#fffdf1');
      text.setAttribute('stroke', '#542201');
      text.setAttribute('stroke-width', '3');
      text.setAttribute('stroke-linejoin', 'round');
      text.setAttribute('paint-order', 'stroke');
      text.textContent = '铸币修炼';
      g.appendChild(text);
      view.g.appendChild(g);
      view.__heroTrainLabel = g;
    }
    return g;
  }
  /** 勇者可修炼武技（与 TowerHero 同一套可升级判据：未满 15、技能 6/13 不可升）。 */
  function heroTrainCandidates(hero) {
    const out = [];
    for (const kind of ['weapon', 'skill']) {
      for (const raw of ((kind === 'weapon' ? hero.weapons : hero.skills) || [])) {
        const hit = /^(\d+):(\d+)$/.exec(String(raw));
        if (!hit) continue;
        const id = Number(hit[1]), level = Math.max(1, Number(hit[2]) || 1);
        if (level >= 15 || (kind === 'skill' && [6, 13].includes(id))) continue;
        const inst = kind === 'weapon' ? State.weaponInst(id) : State.skillInst(id);
        out.push({ kind, id, level, ref: (kind === 'weapon' ? 'w:' : 's:') + id,
          name: (inst && inst.name) || ((kind === 'weapon' ? '武器 ' : '技能 ') + id) });
      }
    }
    return out;
  }
  function heroTrainLevelText(level) { return level > 10 ? '真' + (level - 10) : 'Lv.' + level; }
  /** 点「铸币修炼」：在原版页上盖一层 DOM 选择层（与换装层同一做法，只拆自己）。 */
  function openHeroCoinTrain(hero, view) {
    if (!hero || typeof hero.onCoinTrain !== 'function') { if (window.UI && UI.toast) UI.toast('铸币修炼暂不可用。'); return; }
    if (Math.max(0, Number(hero.coins) || 0) <= 0) { if (window.UI && UI.toast) UI.toast('铸币不足（需要 1 枚）。'); return; }
    const all = heroTrainCandidates(hero);
    if (!all.length) { if (window.UI && UI.toast) UI.toast('没有可修炼的武技。'); return; }
    const modal = window.UI && UI.classic && UI.classic.modal;
    if (!modal) return;
    const rows = all.map((it) => '<button type="button" class="hero-coin-train-row" data-hero-train-ref="' + esc(it.ref) + '">' +
      '<b>' + esc(it.name) + '</b><span>' + esc(heroTrainLevelText(it.level)) + ' · 随机 +3~5 级</span><em>1 铸币</em></button>').join('');
    const m = modal('铸币修炼', '<div class="hero-coin-train-panel"><p>选择一门武技，必定提升 <b>3~5</b> 个小级（封顶真5）。' +
      '当前铸币 <b class="gold-text">' + Math.max(0, Number(hero.coins) || 0) + '</b> 枚。</p>' +
      '<div class="hero-coin-train-list">' + rows + '</div></div>', [{ label: '返回', cls: 'muted' }], { small: true });
    if (!m || !m.element) return;
    m.element.classList.add('hero-coin-train-modal');
    m.element.querySelectorAll('[data-hero-train-ref]').forEach((b) => {
      b.onclick = () => {
        const out = hero.onCoinTrain(b.dataset.heroTrainRef);
        m.close();
        if (!out || !out.ok) {
          modal('铸币修炼', '<p>' + esc((out && out.msg) || '修炼失败。') + '</p>',
            [{ label: '返回', cls: 'muted', run: () => { if (window.SfStatus && SfStatus.refresh) SfStatus.refresh(); } }], { small: true });
          return;
        }
        if (typeof out.left === 'number') hero.coins = Math.max(0, out.left);
        if (window.SfStatus && SfStatus.refresh) SfStatus.refresh();
        modal('修炼完成', '<div class="result-box"><div class="result-title win">武技精进</div><p>' + esc(out.msg) + '</p>' +
          '<p class="dim">消耗 1 枚铸币，剩余 ' + Math.max(0, Number(out.left) || 0) + ' 枚。</p></div>',
          [{ label: '继续修炼', cls: 'gold', run: () => openHeroCoinTrain(hero, view) },
           { label: '返回', cls: 'muted', run: () => { if (window.SfStatus && SfStatus.refresh) SfStatus.refresh(); } }], { small: true });
      };
    });
  }
  /* ---------- 力 / 敏 / 速的小上下键（勇者准备页） ----------
   * 用户 2026-10-24 口径：四维可在开始界面调整，遵循 20% 下限；
   * 力/敏/速各加一对小上下键，满额或没有可分配点时上键变灰。
   * 具体规则（预算 275 / 下限 55 / 上限 85）在 TowerHero；这里只画键与读 `hero.statState()`。 */
  const HERO_STAT_KEYS = ['power', 'agility', 'speed'];
  const HERO_STAT_NAMES = { power: '力量', agility: '敏捷', speed: '速度' };
  const HERO_STAT_CELL_RIGHT = { power: 84, agility: 153, speed: 222 };
  const HERO_STAT_ARROW_AT = { power: 66, agility: 136, speed: 207 };
  function heroStatState() {
    const hero = Hero();
    try { return (hero && typeof hero.statState === 'function') ? hero.statState() : null; } catch (e) { return null; }
  }
  /** 把一颗小箭头切到可用 / 灰色。 */
  function setHeroStatArrow(group, dir, enabled) {
    const btn = group && group.querySelector('[data-dir="' + dir + '"]');
    if (!btn) return;
    const rect = btn.__rect, path = btn.__path;
    btn.style.pointerEvents = enabled ? 'auto' : 'none';
    btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    btn.style.opacity = enabled ? '1' : '.55';
    if (rect) {
      rect.setAttribute('fill', enabled ? '#fffaf0' : '#f0ece3');
      rect.setAttribute('stroke', enabled ? '#d6bd8c' : '#d8d2c6');
    }
    if (path) path.setAttribute('fill', enabled ? '#3b7255' : '#b7b0a4');
  }
  function heroStatArrowEnsure(view, stat) {
    const cache = view.__heroStatArrows || (view.__heroStatArrows = {});
    let group = cache[stat];
    if (group && group.isConnected) return group;
    group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'sf-hero-stat-arrow');
    group.setAttribute('data-stat', stat);
    group.setAttribute('transform', 'translate(' + HERO_STAT_ARROW_AT[stat] + ',142.5)');
    const make = (dir) => {
      const btn = document.createElementNS(SVG_NS, 'g');
      btn.setAttribute('data-dir', dir);
      btn.setAttribute('class', 'sf-hero-stat-step');
      btn.style.pointerEvents = 'auto';
      btn.style.cursor = 'pointer';
      const y = dir === 'up' ? 0 : 9;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', '0'); rect.setAttribute('y', String(y));
      rect.setAttribute('width', '10'); rect.setAttribute('height', '8');
      rect.setAttribute('rx', '2'); rect.setAttribute('fill', '#fffaf0');
      rect.setAttribute('stroke', '#d6bd8c'); rect.setAttribute('stroke-width', '0.9');
      const path = document.createElementNS(SVG_NS, 'path');
      if (dir === 'up') {
        path.setAttribute('d', 'M5 1.5 L1.4 6.4 L8.6 6.4 Z');
      } else {
        /* 下键的矩形在 y=9..17，三角形也要跟着下移，否则会画到上键上。 */
        path.setAttribute('d', 'M5 6.5 L1.4 1.6 L8.6 1.6 Z');
        path.setAttribute('transform', 'translate(0,9)');
      }
      path.setAttribute('fill', '#3b7255');
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = HERO_STAT_NAMES[stat] + (dir === 'up' ? ' +1' : ' −1');
      btn.appendChild(rect); btn.appendChild(path); btn.appendChild(title);
      btn.__rect = rect; btn.__path = path;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const hero = Hero();
        if (!hero || hero.mode !== 'setup' || typeof hero.adjustStat !== 'function') return;
        const out = hero.adjustStat(stat, dir);
        if (!out || !out.ok) return;
        try { if (current && current.view) fillValues(current.view); } catch (e) {}
        refreshHeroChrome();
      });
      return btn;
    };
    group.appendChild(make('up'));
    group.appendChild(make('down'));
    view.g.appendChild(group);
    cache[stat] = group;
    return group;
  }
  function wireHeroStatControls(view) {
    const hero = Hero();
    if (!hero || hero.mode !== 'setup' || !heroStatState()) return;
    for (const stat of HERO_STAT_KEYS) heroStatArrowEnsure(view, stat);
  }
  /** 页面元素 → 舞台（320×196）坐标：处理 svg 等比缩放与上下/左右留白。 */
  function stageRectOf(view, el) {
    const svg = view && view.root;
    if (!svg || !el || !el.getBoundingClientRect || !svg.getBoundingClientRect) return null;
    const sr = svg.getBoundingClientRect();
    const vb = svg.viewBox && svg.viewBox.baseVal;
    if (!sr.width || !sr.height || !vb || !vb.width || !vb.height) return null;
    const par = String(svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
    const scale = /slice/.test(par) ? Math.max(sr.width / vb.width, sr.height / vb.height)
      : Math.min(sr.width / vb.width, sr.height / vb.height);
    if (!scale) return null;
    const ax = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5;
    const ay = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
    const x0 = sr.left + (sr.width - vb.width * scale) * ax - vb.x * scale;
    const y0 = sr.top + (sr.height - vb.height * scale) * ay - vb.y * scale;
    const r = el.getBoundingClientRect();
    return { x: (r.left - x0) / scale, y: (r.top - y0) / scale, w: r.width / scale, h: r.height / scale };
  }
  /** 按当前力/敏/速值、可分配池与 20% 上下限刷新三对箭头的位置 / 灰态。 */
  function refreshHeroStatControls() {
    const hero = Hero();
    const state = heroStatState();
    const view = current && current.view;
    if (!view || !view.__heroStatArrows) return;
    const show = !!(hero && hero.mode === 'setup' && state && activeTab() === 'status');
    for (const stat of HERO_STAT_KEYS) {
      const group = view.__heroStatArrows[stat];
      if (!group) continue;
      group.style.display = show ? '' : 'none';
      if (!show) continue;
      /* 数值宽度会随被动 / 两位数变三位数变化，箭头跟在实际数字右边；
       * 再夹在本格范围内，避免压到下一格。 */
      const clip = clipOf(view, stat);
      const box = stageRectOf(view, clip && clip.g);
      let x = box ? (box.x + box.w + 1) : HERO_STAT_ARROW_AT[stat];
      let y = box ? (box.y + box.h / 2 - 8.5) : 142.5;
      x = Math.max(54, Math.min(HERO_STAT_CELL_RIGHT[stat] - 10, x));
      y = Math.max(140.5, Math.min(145, y));
      group.setAttribute('transform', 'translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')');
      const value = Number(state.values && state.values[stat]) || 0;
      const rules = state.rules || {};
      setHeroStatArrow(group, 'up', state.pool > 0 && value < Number(rules.cap || 0));
      setHeroStatArrow(group, 'down', value > Number(rules.floor || 0));
    }
  }

  /** 只刷新「开始挑战 / 计数条 / 返回 / 力敏速箭头」的显示状态，不重新挂载。 */
  /** 准备页把右上角经验条 / 今日胜率 / 战斗场次这块**元素本身**收掉，
   *  不放白色补丁；文字直接落在奶油底上。返回 / 爬塔页会恢复。 */
  /** 状态页立绘（松鼠本体 + 装备挂点）在第 1 帧里的**顶层深度从 129 起**
   *  （129 影子 / 130 脚 / 133 手 / 136 尾巴 / 138 身体 / 141·172 拳套 / 144 脚 /
   *    147 头 / 169 手；见导出数据）。准备页的「隐藏战绩区」是按**矩形**扫元素的，
   *  立绘的右半边（右眼 / 右耳 / 右腮红 / 嘴）恰好落在右上角那块矩形里 ——
   *  2026-10-24 用户报的「松鼠的左眼和左耳缺失」就是它们被当成战绩文字藏掉了。
   *  这里按**顶层深度**把立绘整棵子树排除，只藏真正的战绩元素。 */
  function inStatusPortrait(el, root) {
    let at = el;
    while (at && at.parentNode && at.parentNode !== root) at = at.parentNode;
    const d = Number(at && at.getAttribute && at.getAttribute('depth'));
    return Number.isFinite(d) && d >= 129;
  }
  /** 勇者页（准备 / 爬塔回看）把原版「Exp / 今日胜率 / 战斗场次」三块收掉。
   *  2026-10-24 用户口径：爬塔中点头像查看**也一样**去掉这三块（原先只处理了准备页）。 */
  function hideHeroStatusFields(view, hide) {
    if (!view) return;
    const old = view.__heroFieldHidden;
    if (old) {
      for (const rec of old) { try { rec.el.style.display = rec.prev; } catch (e) {} }
      view.__heroFieldHidden = null;
    }
    if (!hide) return;
    if (!view.g || typeof view.g.querySelectorAll !== 'function') return;
    const region = { x: 106, y: 28, w: 208, h: 74 };
    const custom = [
      view.__heroTodo,
      view.__heroStart && view.__heroStart.g,
      view.__heroStartLabel,
      view.__heroTrain && view.__heroTrain.g,
      view.__heroTrainLabel,
      view.__heroBladeCard,
      ...Object.values(view.__heroStatArrows || {}),
    ].filter(Boolean);
    const hidden = [], seen = new Set();
    const hideOne = (el) => {
      if (!el || seen.has(el) || el.style.display === 'none') return;
      seen.add(el);
      hidden.push({ el: el, prev: el.style.display });
      el.style.display = 'none';
    };
    for (const el of view.g.querySelectorAll('*')) {
      if (custom.some((node) => node === el || (node.contains && node.contains(el)))) continue;
      /* 立绘整棵子树不参与矩形隐藏 —— 见上面的注释。 */
      if (inStatusPortrait(el, view.g)) continue;
      const r = stageRectOf(view, el);
      if (!r || !r.w || !r.h) continue;
      if (r.x < region.x || r.y < region.y || r.x + r.w > region.x + region.w || r.y + r.h > region.y + region.h) continue;
      if (el.tagName === 'g' && el.children.length > 2) continue;
      hideOne(el);
    }
    /* 数值组整组藏掉：1s 一次的 fillValues 会重建组内数字精灵，
     * 只藏叶子的话数字会重新长出来。 */
    for (const name of ['expMc', 'expNum', 'winRate', 'fightTimes1', 'fightTimes2']) {
      const c = clipOf(view, name);
      if (c && c.g) hideOne(c.g);
    }
    view.__heroFieldHidden = hidden;
  }
  function refreshHeroChrome() {
    if (!heroView() || !current || !current.view) return;
    const hero = Hero(), view = current.view;
    const onStatus = activeTab() === 'status';
    const full = heroStartEnabled();
    const setup = hero.mode === 'setup';
    const statState = heroStatState();
    const pool = statState ? Math.max(0, Number(statState.pool) || 0) : 0;
    /* 未就绪时整颗按钮转灰（不是黄色再蒙一层灰）；武技齐且点数分配完才恢复黄色。 */
    const ready = full && pool === 0;
    const startFilter = ready ? '' : 'grayscale(1) brightness(.94)';
    /* 准备页与爬塔回看页都收掉 Exp / 今日胜率 / 战斗场次（用户 2026-10-24 口径：
     * 爬塔里点头像查看时也不要这三块，那一页只留立绘、四维与装备入口）。 */
    hideHeroStatusFields(view, onStatus);
    const start = view.__heroStart, label = view.__heroStartLabel;
    if (start && start.g) {
      start.g.style.display = setup && onStatus ? '' : 'none';
      start.g.style.opacity = '1';
      start.g.style.filter = startFilter;
      start.g.style.cursor = ready ? 'pointer' : 'not-allowed';
    }
    if (label) {
      label.style.display = setup && onStatus ? '' : 'none';
      label.style.opacity = '1';
      label.style.filter = startFilter;
    }
    /* 爬塔回看：同一位置把「开始挑战」换成「铸币修炼」。没有铸币时转灰。 */
    const train = view.__heroTrain, trainLabel = view.__heroTrainLabel;
    const canTrain = Math.max(0, Number(hero.coins) || 0) > 0;
    const trainFilter = canTrain ? '' : 'grayscale(1) brightness(.94)';
    if (train && train.g) {
      train.g.style.display = !setup && onStatus ? '' : 'none';
      train.g.style.opacity = '1';
      train.g.style.filter = trainFilter;
      train.g.style.cursor = canTrain ? 'pointer' : 'not-allowed';
    }
    if (trainLabel) {
      trainLabel.style.display = !setup && onStatus ? '' : 'none';
      trainLabel.style.opacity = '1';
      trainLabel.style.filter = trainFilter;
    }
    const bladeCard = view.__heroBladeCard;
    if (bladeCard) bladeCard.style.display = (!setup && onStatus) ? '' : 'none';
    heroTodoRefresh(view);
    heroBladeCardRefresh(view);
    refreshHeroStatControls();
  }
  /** 状态页各帧都需要的几层：返回 / 开始挑战 / 出发清单 / 力敏速上下键。 */
  function wireHeroChrome() {
    if (!heroView() || !current || !current.view) return;
    const hero = Hero(), view = current.view;
    /* 原版 3362「返回菜单」藏掉，换成随机挑战查看敌人那颗 3911「返回」。
     * 3911 不在包里时退回 3362 —— 否则整页没有返回键，玩家会被困在准备页。
     * 准备页和爬塔回看页都保留底部这颗「返回」（2026-10-24 口径：右上角小 × 去掉）。 */
    const oldBack = clipOf(view, 'back');
    const back = useStageBack(view, '3911', 1, 160.3, 175.5, 1, 'hero-back', '__heroBack');
    if (back) {
      wireClickable(back, { hover: 2, press: 2, idle: 1, onFire: () => { if (hero.onBack) hero.onBack(); } });
      if (oldBack && oldBack.g) oldBack.g.style.display = 'none';
    } else if (oldBack) {
      wireClickable(oldBack, { hover: 2, onFire: () => { if (hero.onBack) hero.onBack(); } });
    }
    if (hero.mode === 'setup') {
      const start = heroStartEnsure(view);
      if (start) {
        heroStartLabelEnsure(view);
        wireClickable(start, {
          hover: 2, press: 2, idle: 1,
          onFire: () => {
            if (!heroStartEnabled()) {
              if (window.UI && UI.toast) UI.toast('还需点亮 ' + Math.max(0, HERO_PICK_LIMIT - heroPickCount()) + ' 个武技。');
              return;
            }
            if (hero.onStart) hero.onStart();
          },
        });
      }
      heroTodoEnsure(view);
    } else {
      const train = heroTrainEnsure(view);
      if (train) {
        heroTrainLabelEnsure(view);
        wireClickable(train, {
          hover: 2, press: 2, idle: 1,
          onFire: () => openHeroCoinTrain(hero, view),
        });
      }
      heroBladeCardEnsure(view);
    }
    wireHeroStatControls(view);
    /* 根帧切页会重建内容；把这几层重新挪到末尾，保证始终画在 7218 页面内容之上。 */
    const arrows = view.__heroStatArrows || {};
    for (const node of [view.__heroTodo, view.__heroBladeCard, view.__heroStart && view.__heroStart.g,
      view.__heroStartLabel, view.__heroTrain && view.__heroTrain.g,
      view.__heroTrainLabel, arrows.power, arrows.agility, arrows.speed]) {
      if (node && node.parentNode === view.g) view.g.appendChild(node);
    }
    refreshHeroChrome();
  }

  /** 画（或重画）武器 / 技能栏的格子；`status` 页则收掉它。 */
  function applyTab() {
    if (!current || !current.view) return;
    const view = current.view;
    const grid = activeTab() !== 'status';
    showGridParts(grid);
    if (!grid) { if (heroView()) refreshHeroChrome(); return; }
    const info = gridInfo();
    if (info && current) current.gridPage = info.page;
    const kind = gridKind();
    for (let i = 0; i < GRID_CELLS.length; i++) {
      const cell = clipOf(view, GRID_CELLS[i]);
      if (!cell) continue;
      cell.__cellName = GRID_CELLS[i];
      const it = info && info.items[i];
      paintCell(cell, kind, it || null);
      wireCell(cell, kind, it || null, i);
    }
    setTextByName(view, 'page', info ? ((info.page + 1) + '/' + info.pages) : '1/1');
    const canPrev = !!info && info.page > 0, canNext = !!info && info.page < info.pages - 1;
    stopAt(clipOf(view, 'left'), canPrev ? 1 : 2);      // 3156：1 = 箭头 / 2 = 空帧
    stopAt(clipOf(view, 'right'), canNext ? 1 : 2);
    setVisible(clipOf(view, 'left'), canPrev);
    setVisible(clipOf(view, 'right'), canNext);
    wireClickable(clipOf(view, 'left'), {
      hover: 0, press: 0, idle: () => { const i = gridInfo(); return (i && i.page > 0) ? 1 : 2; },
      onFire: () => { const i = gridInfo(); if (i && i.page > 0) { current.gridPage = i.page - 1; applyTab(); } },
    });
    wireClickable(clipOf(view, 'right'), {
      hover: 0, press: 0, idle: () => { const i = gridInfo(); return (i && i.page < i.pages - 1) ? 1 : 2; },
      onFire: () => { const i = gridInfo(); if (i && i.page < i.pages - 1) { current.gridPage = i.page + 1; applyTab(); } },
    });
    if (heroView()) refreshHeroChrome();
  }
  /* ============================================================
   * 二级页：武器 / 技能详情
   * ------------------------------------------------------------
   * 用户 2026-10 口径："武器技能的详情页面中，对齐 需要 / 已有 / 金松果 / 成功率等 ui 素材，
   * 以及背景贴图排布等。"
   *
   * 原版怎么开这一页（`MainMovie.as`）：
   *   · `showWeaponSkillWin()` 选中某一项 → `showWeaponSkill3(weaponSkill, type)`；
   *   · `showWeaponSkill3` 里 `loadMcs([["武器升阶", "subFrame", currentFrame]])`
   *     —— 这一页**不是页根 7218 里的东西**，是一颗运行时挂上去的库元件；
   *   · 右侧"需要 / 已有 / 成功率"那块是 `subFrame.requirement`（**3670**，
   *     `showLeveupInfo` 往 need1/current1/need2/current2/rate 写值）。
   *
   * ⚠ 为什么改成**整页 DOM 画**（原来借库元件 4886 的第 5 帧当底板）：
   *   4886 是**道具页**复用的那颗元件，它的 f5 自带一堆占位文本（`cost` 写的是宝石合成的串），
   *   而真正要的 `requirement`（3670）根本不在它的闭包里 —— 于是搭出来的页面
   *   "底板是道具页的、字段靠 DOM 硬贴"，实测与参考截图（`references/screen`）差得远：
   *   图标位是个空黄框、需要/已有两列挤在一起。
   *   现在按原版截图**逐块量出舞台坐标**（下面 `DETAIL`），底板、面板、按钮全部 DOM 画，
   *   只有格子里那颗图标仍然挂**原版矢量元件**（`mountSymbol` + 只框住卡片的 viewBox）。
   * ========================================================== */
  /** 详情页落点（舞台坐标；对着原版截图逐块量出来的，见上面那段注释）。 */
  const DETAIL = {
    panel: { x: 25, y: 8, w: 270, h: 172 },
    tab: { x: 46, y: 9, w: 86, h: 20 },
    name: { x: 33, y: 34, w: 122, h: 13 },
    icon: { x: 28, y: 46, w: 50, h: 50 },
    stat: { x: 80, y: 48, w: 96, h: 47 },
    desc: { x: 33, y: 100, w: 142, h: 42 },
    req: { x: 189, y: 38, w: 100, h: 78 },
    btn: { y: 146, h: 20, back: { x: 134, w: 46 }, ok: { x: 214, w: 64 } },
  };
  /** 详情页的宿主（与挑战页的三级页同一套：另开一层 `<section class="ssfight-home ssfight-sub">`）。 */
  function detailHost() {
    if (current && current.detail && current.detail.host && current.detail.host.isConnected) return current.detail.host;
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const el = document.createElement('section');
    el.className = 'classic-home ssfight-home ssfight-sub ssfight-view';
    el.setAttribute('aria-label', '武器技能详情');
    ui.appendChild(el);
    if (current.container) current.container.classList.add('sf-detail-open');
    current.detail = { host: el, view: null, dom: null, kind: null, id: 0 };
    return el;
  }
  /** 舞台坐标 → 设计像素（宿主自己可能带缩放，见 `layoutScale`）。 */
  function stageMapper(view, container) {
    const svg = view && view.root;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const vb = String(svg.getAttribute('viewBox') || '0 0 320 196').split(/\s+/).map(Number);
    const k = (vb[2] && r.width) ? r.width / vb[2] : 0;
    if (!k) return null;
    const box = container.getBoundingClientRect();
    const hs = layoutScale(container) || 1;
    return {
      k: k,
      x: (sx) => (r.left - box.left + (sx - vb[0]) * k) / hs,
      y: (sy) => (r.top - box.top + (sy - vb[1]) * k) / hs,
      s: (n) => (n * k) / hs,
    };
  }
  function esc2(v) { return esc(v); }
  /** 勇者本局已掌握的武技（`id:level`）→ `{id, level, ref}`；没掌握返回 null。 */
  function heroOwnedItem(kind, id) {
    const hero = Hero();
    if (!hero) return null;
    const list = (kind === 'weapon' ? hero.weapons : hero.skills) || [];
    for (const raw of list) {
      const parts = String(raw).split(/[:,]/), sid = Number(parts[0]);
      if (sid !== Number(id)) continue;
      return { id: sid, level: Math.max(1, Number(parts[1]) || 1), ref: (kind === 'weapon' ? 'w:' : 's:') + sid };
    }
    return null;
  }
  /** 勇者武技详情只读的「下一级」信息（等级 / 成功率 / 失败保底 / 满级）。 */
  function heroReadonlyUp(kind, id) {
    if (!window.TowerHero || typeof TowerHero.upgradeInfoOf !== 'function') return null;
    try { return TowerHero.upgradeInfoOf(Hero(), (kind === 'weapon' ? 'w:' : 's:') + Number(id)); }
    catch (e) { return null; }
  }
  /** 打开某一项的详情页。`kind` = 'weapon' / 'skill'，`id` = 字典 id。 */
  function openItemDetail(kind, id) {
    const C = window.UI && UI.classic;
    const map = kind === 'weapon' ? window.weaponsMap : window.skillsMap;
    if (!current || !map) return;
    const host = detailHost();
    if (!host) return;
    const base = map.getValue ? map.getValue(id) : null;
    const hero = heroView() ? Hero() : null;
    let own = null, up = null, row = null;
    if (hero) {
      const item = heroOwnedItem(kind, id);
      if (!item) {
        /* 未掌握：仍走“尚未获得”的详情，但绝不能用账号里的同名武技。 */
        const info = gridInfo();
        row = info ? info.items.filter((x) => x.id === Number(id))[0] : null;
        detailView(host, kind, id, base, null, null, row);
        return;
      }
      own = item;
      if (kind === 'weapon' && window.TowerHero && TowerHero.heroWeapon) {
        /* `heroWeapon` 读的是 `id:level`（不是升级 API 的 `w:id` ref）。 */
        const w = TowerHero.heroWeapon(Number(id) + ':' + item.level);
        if (w) own = Object.assign({}, w, { level: item.level });
      }
      up = heroReadonlyUp(kind, id);
      const info = gridInfo();
      row = info ? info.items.filter((x) => x.id === Number(id))[0] : null;
    } else {
      own = (kind === 'weapon' ? State.myWeapons() : State.mySkills()).find((x) => x.id === Number(id)) || null;
      up = own && State.upgradeInfo ? State.upgradeInfo(kind, Number(id)) : null;
      const info = (C && C.catalogInfo) ? C.catalogInfo(kind, current.gridPage || 0) : null;
      row = info ? info.items.filter((x) => x.id === Number(id))[0] : null;
    }
    detailView(host, kind, id, base, own, up, row);
  }
  /** 画详情页（整页 DOM；只有图标那一小块挂原版矢量元件）。 */
  async function detailView(host, kind, id, base, own, up, row) {
    const t = T();
    if (!t || !current || !current.detail) return;
    if (!SfRender.loaded || !SfRender.tags || !SfRender.tags().length) return;
    try { await SfRender.loadExtra('tags-wsicon.json'); } catch (e) {}
    if (current.detail.host !== host) return;
    current.detail.kind = kind;
    current.detail.id = id;
    /* ⑥ 主路径：**原版那一页**（库元件「状态1」= 4673 的第 1 帧）。
     * 挂不上（素材缺失 / 老缓存）就退回下面那套 DOM 面板，不会白屏。 */
    try {
      if (await buildDetailAsset(host, kind, id, base, own, up, row)) return;
    } catch (e) {
      if (window.__errs) window.__errs.push('detail asset: ' + (e && e.message));
    }
    buildDetailDom(host, kind, id, base, own, up, row);
  }
  /* ============================================================
   * 「武器 / 技能详情」= **原版那一页**（4673 的第 1 帧）
   * ------------------------------------------------------------
   * 原版 `showWeaponSkillWin`（MainMovie.as:16658-16790，`if (!isViewfriend)` 整段）：
   *   `loadMcs([["状态1","subFrame",currentFrame]]); subFrame.gotoAndStop(1)`
   *   然后写 `subFrame.name / levelText / harm / type / des`，
   *   图标位 `subFrame.c1`，两颗键 `subFrame.buttonsMc.button1 / button2`；
   *   满 10 级走 `showWeaponSkill3`（`gotoAndStop(3)` + 右侧 `requirement`）。
   * 那一帧的具名子元件（导出实测，逐条对上）：`c1` / `buttonsMc`（3 帧：1 升级+返回 /
   *   2 只返回 / 3 灰）/ `des` / `name` / `harm` / `levelText` / `type` / `requirement`。
   * `requirement`（**3670**）自己 7 帧：f1 = 需要 / 已有 / 成功率 那一块
   *   （`need1` / `current1` / `need2` / `current2` / `rate` / `level`），
   *   f2..f5 = 别的用途（星级之类），这里只用 f1。
   * ⚠ 用户 2026-10 口径⑥："武器与技能详情页与ssfight版本差距甚远" —— 以前整页是复刻自绘的
   *   DOM 面板（`.sf-detail`），现在改成挂原版帧 + 写字段。 */
  /** 武器特殊效果：原表 `remark` 是「特殊效果,每级增加…」一整句；这里只取特殊效果，
   *  成长部分由详情页的「升至下一阶…」那行负责，避免同一句写两遍。 */
  function weaponSpecialText(base) {
    if (!base || !base.remark) return '';
    return String(base.remark).replace(/\s*[,，]?\s*(每级|升级)[\s\S]*$/, '').trim();
  }
  async function buildDetailAsset(host, kind, id, base, own, up, row) {
    const t = T();
    const isW = kind === 'weapon';
    const weaponSpecial = isW ? weaponSpecialText(base) : '';
    /* ⚠ 武器页与技能页是**同一个元件的两帧**（原版 `showWeaponSkillWin`：
     *   `subFrame.gotoAndStop(1)` 武器 / `gotoAndStop(2)` 技能，MainMovie.as:16678 / 16731）。
     *   两帧各自的标题（`武器详情` / `技能详情`）、图标位（`c1` = **3636** 武器 / **4547** 技能）
     *   与两颗键（`buttonsMc` = **4539** 武器 / **4553** 技能）都是各画一套的：
     *   4539 的 `button2` 写的是「升级武器」、4553 写的是「升级技能」。
     *   复刻以前**恒挂第 1 帧**，于是技能页顶着"武器详情"标题、右边那颗键也是「升级武器」
     *   （用户 2026-10 报的"技能页面也显示升级武器而不是升级技能"就是这个）。 */
    const view = await SfRender.mountSymbol(host, '4673', {
      frame: isW ? 1 : 2, label: '武器技能详情',
      /* `requirement`（3670）里的 `need1`/`current1`/`need2`/`current2` 在素材里是
       * 占位串（"900000" 之类），真值由下面几行 `setReq` 写 —— 出生先清空，
       * 免得未获得的武器那一帧闪一个 900000。 */
      blank: ['need1', 'current1', 'need2', 'current2'],
    });
    if (!view || !current || current.detail.host !== host) {
      if (view) { try { view.destroy(); } catch (e) {} }
      return false;
    }
    /* 必须真的有那一帧的具名元件，否则说明素材版本不对 → 让调用方退回 DOM 面板。 */
    if (!view.byName || !view.byName('name')) {
      try { view.destroy(); } catch (e) {}
      return false;
    }
    if (current.detail) current.detail.assetView = view;
    try { t.freezeDescendants(view); } catch (e) {}
    const locked = !own;
    const maxed = !!(up && up.max);
    const heroDetail = heroView();
    const s = (S() || {});
    const set = (name, str) => { const c = view.byName(name); if (c && t) t.setText(c, str == null ? '' : String(str)); };
    /* ---------- 排布微调（用户 2026-10 本批 ⑨）----------
     * 口径原文："将等级&伤害&类型那一列后面的介绍稍微右移一点，将需要的金松果 卷轴那一列数字
     * 稍微往右移动一点。去掉该页面中武器或技能下方显示的等级，同时稍微下调武器或技能的贴图，
     * 当前贴图最上边超出了显示边界，没有正常显示出来。将红色的武器&道具名字改为黑色并加粗，
     * 且往左移动一点。"
     * 这一页的坐标全在导出素材里（`name` / `levelText` / `harm` / `type` 都是**文本字段**，
     * 落点由 `textfields.json` 的字段框公式算出来），改素材不现实，所以在**渲染后**对节点做
     * 平移/换色 —— 与挑战页 `alignRowText` 同一套做法（改完不写回素材，每次挂载重算一次）。
     * 常量集中在这里，改这一处就能回调。
     * ⚠ 图标那一档（原来的 `iconScale` / `iconDrop`）**已经删掉**：用户 2026-10 下一轮口径
     *   "武器与技能的显示 ui 过分偏下、贴图缺了上部"。原因是这两个值叠在**反例**上 ——
     *   `transform-box:fill-box` 的原点是整棵图标 `<g>` 的包围盒中心，而那个包围盒**含卡片
     *   下方那层名字/「真」印章**，中心比卡片中心低十几个舞台单位；再乘 0.82 的缩放，
     *   卡片被**推下去约 18 个舞台单位**、同时缩掉一圈 —— 参照截图里卡片在 y≈52.7，
     *   复刻实测在 y≈72（原版 4673 f1 把 `c1` 放在 `(28.8, 54.5)`，缩放 1.07）。
     *   现在**一个像素都不动**：素材里 `c1` 的落点就是原版 `attachMovie(name,"mc",100,{_x:0,_y:0})`
     *   的落点，缩放也照 `c1` 自己的矩阵走。 */
    const DETAIL_SHIFT = {
      statsX: 3.2,      // 「等级 / 伤害 / 类型」那一列的值整体右移（舞台单位）
      /* `requirement`（3670）f1 里右侧那两行"需要"的数字（`need1` 金松果 / `need2` 卷轴）。
       * 这两个字段是**右对齐**的，所以右移 = `text-anchor:end` 的墨迹往右贴一格。 */
      needX: 3.0,
      nameX: -2.6,      // 名字往左挪一点（用户：名字"往左移动一点"）
    };
    /** 把一个文本字段的所有 `<text>` 沿基线下标平移（幂等：基准值只记一次）。 */
    const shiftText = (clip, dx, dy) => {
      const node = clip && (clip.g || clip);
      if (!node || !node.querySelectorAll) return 0;
      let n = 0;
      for (const el of node.querySelectorAll('text')) {
        if (el.__dx0 == null) el.__dx0 = Number(el.getAttribute('x') || 0);
        if (el.__dy0 == null) el.__dy0 = Number(el.getAttribute('y') || 0);
        el.setAttribute('x', el.__dx0 + (Number(dx) || 0));
        if (dy) el.setAttribute('y', el.__dy0 + (Number(dy) || 0));
        n++;
      }
      return n;
    };
    const ownLv = own ? (Number(own.level) || 0) : 0;
    const trueOwn = ownLv > 10;
    /* 原版真化详情页把名字写成「真.名字」（showWeaponSkill3 的 setText(name,"真."+name)）。 */
    const shownName = base ? ((trueOwn ? '真.' : '') + base.name) : '';
    /* 等级：原版 `setText(subFrame.levelText, level)`（MainMovie.as:16681 / 16735）——
     * 就是左列「等级」那一格的值。复刻上一批误把它当成"贴图下面那行等级"清空了，
     * 于是整页一个等级都不显示（用户 2026-10 口径："该界面所有的等级都没有正常显示"）。
     * 真形态（11~15 级 = 真1~真5）按 `level - 10` 写，与格子里那行 `LV n`
     * （`writeIconLevel`）**同一把尺子** —— 两处显示同一个数，不会一个写 11 一个写 1。 */
    set('levelText', String(ownLv > 10 ? ownLv - 10 : ownLv));
    set('type', base && base.type ? base.type : (isW ? '近战' : '被动'));
    /* 伤害那一格三条口径（照原版逐字抄，别自己编）：
     *   · 武器：`convertHarm()` = `harmLo-harmHi`（没获得就用字典里的基准串）；
     *   · **技能：原版写死的是「技能」两个字**（`setText(subFrame.harm, "技能")`，:16736）——
     *     不是技能说明！复刻以前把 `remark`（"提高力量点数,每级提高2点"）写进这一格，
     *     比字段框（`harm`=4543 宽 52.5、一行 4 个全角字）长得多，横向顶出格子、
     *     还压住下面那行「类型」（用户 2026-10 报的"技能的伤害与类型介绍全部文本错误"）。 */
    const harm = isW
      ? (own ? (own.harmLo + '-' + own.harmHi) : (base && base.harm ? base.harm : ''))
      : '技能';
    setWrapped(view.byName('harm'), harm);
    /* 介绍：普通档写原表 `des`；真化档按原版 `getDescription` / `getDesSkill`
     * 写**下一阶**的真化说明（`remark1Value` / `harmAdd1` 逐个取值，不是复刻自编的
     * 每级 +harmAdd）。到真5 写最高阶段；6/13 这种不可升级技能保持基础说明。 */
    let desText = base && base.remark ? base.remark : '';
    if (own && !(up && up.fixed)) {
      const nextLv = Math.min(15, ownLv + 1);
      if (ownLv >= 15) {
        desText = isW ? ('神器已达最高阶段！' + (weaponSpecial ? '\n特殊效果：' + weaponSpecial : '')) : '神技已达最高阶段！';
      } else if (nextLv > 10) {
        const idx = nextLv - 11;
        if (isW) {
          const add = String((base && base.harmAdd1) || '').split('|')[idx] || '';
          desText = base && base.remark1
            ? ('升至下一阶将额外' + base.remark1 + '和' + add + '点基本伤害')
            : ('升至下一阶将额外提升' + add + '点基本伤害');
          if (weaponSpecial) desText += '\n特殊效果：' + weaponSpecial;
        } else {
          const row = window.GData && GData.trueSkillRow ? GData.trueSkillRow(id) : null;
          if (row && row.text) {
            const n = window.GData && GData.trueSkillStep ? GData.trueSkillStep(id, nextLv) : '';
            desText = '升至下一阶' + String(row.text).replace('N', n);
          }
        }
      }
    }
    const desClip = setWrapped(view.byName('des'), desText);
    shrinkDetailDesc(desClip, 0.9);
    /* 名字固定单行（真化名字见 `setDetailName` 的注释），不能按 5 字容量硬断行。 */
    setDetailName(view.byName('name'), shownName);
    /* 图标位：挂原版矢量元件（与格子里那 10 颗同一套素材）。
     * ⚠ 原版这里是 `subFrame.c1.attachMovie(名字, "mc", 100, {_x:0,_y:0})`
     *   ——**图标元件自己第 1 帧就带名字层 + 等级位**（卡片 42×42 在左上角），
     *   位置与缩放**一律照素材**（`c1` 自己 1.07 的矩阵），复刻不再另加缩放/下移
     *   （见 `DETAIL_SHIFT` 那段注释：那正是"过分偏下 + 缺了上部"的来源）。 */
    const iconBox = view.byName('c1');
    if (iconBox && row && row.icon) mountDetailIconClip(iconBox, row);
    /* 右侧那一块 `requirement`（3670）—— 原版**按局面选帧**，不是永远 f1
     * （`MainMovie.as:16686-16778`；六帧的画稿见素材，逐帧读过）：
     *   · 还没拿到   → f4「还未获得该武器」/ f5「还未获得该技能」
     *   · 技能 6 / 13（装死 / 师父驾到）→ f3「该技能不能升级」
     *   · 已经到顶   → f6「已达顶级」
     *   · 其余       → f1「需要 / 已有 / 成功率」（值由 `showLeveupInfo` 写）
     * ⚠ f1 里还有一格 `level`，素材占位串写的是「需要松鼠10级」——原版 `showLeveupInfo`
     *   把它清空（`:16600`），等级不够时改在点升级时给提示。复刻同样清空。 */
    const req = view.byName('requirement');
    if (req) {
      const noSkillUp = !isW && [6, 13].indexOf(Number(id)) >= 0;
      const reqFrame = locked ? (isW ? 4 : 5)
        : ((noSkillUp || (up && up.blocked)) ? 3 : (maxed ? 6 : 1));
      stopAt(req, reqFrame);
      const setReq = (n, v) => { const c = clipOf(req, n); if (c && t) t.setText(c, v == null ? '' : String(v)); };
      if (reqFrame === 1 && up) {
        if (heroDetail) {
          /* 勇者武技：只展示**当前等级 + 下一级成功率**，不消耗账号金松果/卷轴，
           * 也不提供直接升级（升级仍走本局成长 / 铸币修炼）。 */
          setReq('need1', '—');
          setReq('current1', '—');
          setReq('need2', '—');
          setReq('current2', '—');
          setReq('rate', (up.rate != null ? up.rate + '%' : '—'));
          setReq('level', '勇者 · 只读');
        } else {
          setReq('need1', up.coin);
          setReq('current1', s.goldPoint | 0);
          setReq('need2', up.book);
          setReq('current2', ((s.props || {})[up.bookId] | 0));
          setReq('rate', (up.rate != null ? up.rate + '%' : '100%'));
          setReq('level', '');
          /* 「需要」那一列的数字（`need1` 金松果 / `need2` 卷轴）右移一点（用户口径见 `DETAIL_SHIFT`）。 */
          shiftNeedValues(req, DETAIL_SHIFT.needX);
        }
      }
    }
    /* 左列「等级 / 伤害 / 类型」三个值一起右移一点（用户口径见 `DETAIL_SHIFT`）。 */
    shiftText(view.byName('levelText'), DETAIL_SHIFT.statsX);
    shiftText(view.byName('harm'), DETAIL_SHIFT.statsX);
    shiftText(view.byName('type'), DETAIL_SHIFT.statsX);
    /* 名字：红色 → **黑色 + 加粗**，并往左挪一点（用户口径见 `DETAIL_SHIFT`）。 */
    paintDetailName(view.byName('name'), base ? base.name : '', DETAIL_SHIFT.nameX);
    /* 两颗键：`buttonsMc` 在**武器页是 4539、技能页是 4553**（各 3 帧，结构一样）：
     *   f1 = `button1`(3644 返回) + `button2`(4537 / 4551 升级…)；f2 = 只有返回；
     *   f3 = 返回(绿) + 升级(深灰)。
     * 而两颗子键自己各是 3 帧：**1 = 米白（常态）/ 2 = 绿（可用）/ 3 = 深灰（不可用）**。
     * 2026-10-19 用户口径：「返回」和「升级武器 / 升级技能」**默认是灰的（常态帧），
     *   鼠标悬停在上面才显示绿色** —— 与状态页格子 / 首页按钮同一套操：`wireClickable`
     *   的 `idle/hover` 拨子键帧，悬停缩放与按下回弹由 `.uc-pop` 壳（`refreshShell`）负责。
     * 不可升级 / 满级那一档维持 f3 深灰、不可点（悬停也不拨帧）。
     * ⚠ 父帧**必须停 f1**：只有 f1 里才有具名的 `button1` / `button2`（f2/f3 是匿名画稿），
     *   换到那两帧就再也取不到这两颗键、点击接线全断。 */
    const bm = view.byName('buttonsMc');
    if (bm) stopAt(bm, 1);
    const backBtn = bm && clipOf(bm, 'button1');
    const okBtn = bm && clipOf(bm, 'button2');
    wireClickable(backBtn, {
      idle: 1, hover: 2,
      onFire: () => { if (current && current.detail) closeItemDetail(); },
    });
    /* ⚠ 每一处都要判 `current && current.detail`：详情页是异步挂的，玩家可能在
     *   挂载/setText 的间隙就点了「升级」，这时 `current.detail` 已经没了 ——
     *   不判就会抛在 `onFire` 里，把点击变成静默失败（实测"点升级/返回没反应"）。 */
    if (okBtn && !locked && !maxed && !heroDetail) {
      wireClickable(okBtn, {
        idle: 1, hover: 2,
        onFire: () => {
          if (!current || !current.detail) return;
          const r = State.doUpgrade(kind, Number(id));
          if (window.UI && UI.toast) UI.toast(r.msg);
          /* 成功 / 失败都要重画：等级或成功率档位会变。 */
          destroyItemDetailOnly();
          openItemDetail(kind, id);
          refreshGridSoon();
        },
      });
    }
    /* 锁定 / 满级 / 勇者只读那一档只有"返回"（`button1`）：别留一颗点了没反应的灰键在路由里。 */
    if (okBtn && (locked || maxed || heroDetail)) {
      stopAt(okBtn, 3);
      okBtn.g.style.cursor = 'default';
      okBtn.g.style.pointerEvents = 'none';
    }
    return true;
  }
  /** `requirement`（3670）f1 里"需要"那一列的两个数字右移一点。
   *  这两个字段（`need1` / `need2`）在导出里是**右对齐**的，平移 `<text>` 的基线 x 即可。 */
  function shiftNeedValues(req, dx) {
    if (!req || !dx) return 0;
    let n = 0;
    for (const name of ['need1', 'need2']) {
      const c = clipOf(req, name);
      const node = c && (c.g || c);
      if (!node || !node.querySelectorAll) continue;
      for (const el of node.querySelectorAll('text')) {
        if (el.__needX0 == null) {
          el.__needX0 = Number(el.getAttribute('x') || 0);
          /* 右对齐靠的是 `text-anchor:end`；端点往右挪就是墨迹往右挪。 */
        }
        el.setAttribute('x', el.__needX0 + Number(dx));
        n++;
      }
    }
    return n;
  }
  /** 详情页的名字那一格：红色 → 黑色加粗，并整体左移（用户 2026-10 本批 ⑨）。
   *  素材里 `name`（4542）的 `rs[].c` 是 `rgb(255,51,0)`（正红），所以这里逐 `<text>` 覆盖
   *  `fill` + `font-weight`；底色描边（`paint-order` 那套）不动。 */
  function paintDetailName(clip, text, dx) {
    const node = clip && (clip.g || clip);
    if (!node || !node.querySelectorAll) return 0;
    let n = 0;
    for (const el of node.querySelectorAll('text')) {
      el.setAttribute('fill', '#000000');
      el.setAttribute('font-weight', 'bold');
      if (el.__nameX0 == null) el.__nameX0 = Number(el.getAttribute('x') || 0);
      el.setAttribute('x', el.__nameX0 + (Number(dx) || 0));
      n++;
    }
    void text;
    return n;
  }
  /** 详情页图标位（原版 `c1` 那个格子）里挂图标元件。
   *  ⚠ 原版 `c1` 是个**空格子**（`attachMovie(名字,"mc",100,{_x:0,_y:0})`），
   *  图标元件自己第 1 帧就画在 `(0,0)` 起、卡片 42×42，名字层在下方 ——
   *  所以这里**不要**再传 `viewBox` 去裁切：留着元件自己的坐标系，
   *  让它在 `c1` 里面按原尺寸落位（传 viewBox 会把卡片缩放撑满整块面板、盖住两颗键，实测踩过）。 */
  async function mountDetailIconClip(clip, row) {
    try {
      /* ⚠ **没获得的那一档挂的是另一颗库元件**（原版 `showWeaponSkillWin` 的
       *  `subFrame.c1.attachMovie(名字 + "1", "mc", 100)`，:16697 / :16750）——
       *  灰底卡片 + 灰名字那一版，和格子里用的是同一对元件。 */
      const sym = row.has ? row.icon : (row.lockedIcon || row.icon);
      /* 图标元件的画稿从 y≈-1.7 起笔（卡片上沿的白色星芒/高光在 0 以上）。`mountSymbol`
       * 默认用根时间轴 `0 0 320 196`，那 1.7 个舞台单位会被 SVG 视口**平切掉** ——
       * 详情页放大后就是"图标 UI 上部缺了一块"（用户 2026-11 口径）。给视口留 2 单位上边距，
       * 其余尺寸不变（198 对 196 的 1% 缩放肉眼不可见），卡片和两颗键都不动。 */
      const v = await SfRender.mountSymbol(clip.g, sym, {
        frame: 1, label: '武器图标', viewBox: '0 -2 320 198',
      });
      if (!clip.g.isConnected) { try { v.destroy(); } catch (e) {} return; }
      if (current && current.detail) current.detail.view = v;
      if (v.setStaticPolicy) v.setStaticPolicy({});
      paintIconLabel(v, false, false);
      /* ⚠ 详情页这一格是**空盒子**，图标元件按自己的坐标系落进来 ——
       *  ① 等级：这一格里那行 "LV2" 是 `level`（2136）文本，落在自己坐标 y≈45.75（卡片下方）；
       *     原版详情页的卡片下面**没有**这行（参照截图 `references/screen` 的技能详情页），
       *     而它正好压在下面那块说明文字上 —— 直接清空（`hide=true` 那一档）。
       *  ② 落点/缩放：**一律照素材**。`c1` 的放置矩阵就是原版
       *     `subFrame.c1.attachMovie(名字, "mc", 100, {_x:0,_y:0})` 的落点，
       *     图标元件自己第 1 帧就画在 (0,0) 起、卡片 42×42。
       *  ⚠ 上一批在这里加过 `scale(0.82) + translateY(...)`，反而把卡片推低约 18 个舞台单位、
       *    还缩掉一圈（包围盒含卡片下方那层名字/「真」印章，`transform-origin:center` 因此偏低）。
       *    用户 2026-10 口径："显示 ui 过分偏下、贴图缺了上部" —— 现在整段删掉，不做任何 transform。 */
      writeIconLevel(v, row, true);
    } catch (e) { if (window.__errs) window.__errs.push('detail icon clip: ' + (e && e.message)); }
  }
  /* ---------- 按字段框宽断行（原版那几段说明是服务端断好行下发的）----------
   * `render.js` 的文本容器**只按框宽横向裁**，纵向是放开的 ——
   * 所以一整句塞进去会横向被切掉（详情页的说明实测只显示到一半）或者纵向冲出面板。
   * 原版那些字段的框宽在 `textfields.json` 里（例：`des`=4541 宽 150、字号 12
   * → 一行 12 个全角字），这里按同一把尺子断。 */
  const wrapCache = new WeakMap();
  /** 把一个文本容器当尺子，把 `text` 断到它的框宽里（**保留已有的 `\n`**）。
   *  ⚠ **别用 canvas 量**（踩过）：`measureText('国').width / fontSize` 在无头 Chrome 里
   *  量到的 SimHei 回退字体远窄于实际渲染的字形，`per` 会被算成 100 多、等于没断。
   *  这里改成拿**这个字段已经画出来的那一行**当尺子：它的屏幕宽度 / 字符数
   *   就是"一个全角字在这个框里占多少舞台单位"，与渲染完全一致。 */
  function wrapToField(clip, text) {
    const src = String(text == null ? '' : text);
    if (!clip || !clip.__textBox) return src;
    const tb = clip.__textBox;
    if (!tb.meta || !tb.meta.bd) return src;
    const W = tb.meta.bd[1] - tb.meta.bd[0] - (tb.meta.lm || 0) - (tb.meta.rm || 0);
    if (!(W > 8)) return src;
    /* ⚠ 文本容器的 DOM 就是那个 `<g type="text">` **本身**（`__textBox` 挂在它上面），
     * 不是 MovieClip —— 所以要按 DOM 元素取 `ownerSVGElement` / `querySelector`，
     * 不能按 `clip.g.…` 取（踩过：`clip.g` 为 undefined，函数直接原样返回、等于没断行）。 */
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
      /* 画出来的行是空的（占位串被清掉）时退回"字号 × 1.0"这个中文经验值。 */
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
    return out.join('\n');
  }
  /** `setText` + 按框宽断行（详情页那几段说明专用）。
   *  ⚠ 传进来的 `clip` 是 `byName()` 拿到的那个具名子元件，它自己**不是**文本容器
   *  （`__textBox` 在它内部的文本节点上），所以先往下找一层拿到真正的文本容器。 */
  function setWrapped(clip, str) {
    const t = T();
    if (!clip || !t) return null;
    const node = textBoxOf(clip);
    const wrapped = node ? wrapToField(node, str) : String(str == null ? '' : str);
    t.setText(node || clip, wrapped);
    return clip;
  }
  /** 详情页的黑色说明文字缩一号（用户 2026-11：真·狼牙棒这类长说明会压到下方按钮）。
   *  `setText` 已经把行断好；这里只把每个 `<text>` 的字号与行距一起压到 `factor`。
   *  以第一行的 y 为锚点向下压缩，块顶不动、块底缩短，不会整体上移。 */
  function shrinkDetailDesc(clip, factor) {
    const box = textBoxOf(clip);
    const node = box && (box.g || box);
    if (!node || !node.querySelectorAll) return 0;
    const f = Math.max(0.5, Math.min(1, Number(factor) || 0.9));
    const list = [...node.querySelectorAll('text')];
    if (!list.length) return 0;
    const y0 = parseFloat(list[0].getAttribute('y'));
    const anchorY = Number.isFinite(y0) ? y0 : 0;
    let n = 0;
    for (const el of list) {
      if (el.__descShrunk) continue;
      const fs0 = parseFloat(el.getAttribute('font-size')) || 12;
      el.setAttribute('font-size', (fs0 * f).toFixed(2));
      const y = parseFloat(el.getAttribute('y'));
      if (Number.isFinite(y)) el.setAttribute('y', (anchorY + (y - anchorY) * f).toFixed(2));
      el.__descShrunk = true;
      n++;
    }
    return n;
  }
  /** 详情页名字固定单行。
   *  `name`=4542 框宽 75.6、13 号字，`wrapToField` 按 `floor(75.6/13)=5` 算容量；
   *  真化名字是「真.」+ 4 个全角字 = 5.55 字宽（实际 72.15），明明放得下，
   *  却被硬断成「真.死神镰 / 刀」两行（用户 2026-10 报的「真·死神镰刀最后一个字换行」）。
   *  这里单行写；只有真的超过框宽才按字宽缩一点字号，不裁字、不换行。 */
  function setDetailName(clip, text) {
    const t = T();
    const tb = textBoxOf(clip);
    if (!tb || !t) return null;
    const src = String(text == null ? '' : text);
    t.setText(tb, src);
    const meta = tb.__textBox && tb.__textBox.meta;
    const bd = meta && meta.bd;
    if (!bd) return clip;
    const W = bd[1] - bd[0] - (Number(meta.lm) || 0) - (Number(meta.rm) || 0);
    const units = [...src].reduce((n, ch) => n + (ch.charCodeAt(0) < 0x2E80 ? 0.55 : 1), 0);
    const fh = Number(meta.fh) || 13;
    if (W > 8 && units > 0 && units * fh > W * 0.98) {
      const size = Math.max(9, Math.floor((W * 0.98 / units) * 10) / 10);
      for (const el of (tb.g || tb).querySelectorAll('text')) el.setAttribute('font-size', size);
    }
    return clip;
  }
  /** 在一个（可能是壳的）元件里找到真正的文本容器：自己有 `__textBox` 就用自己，
   *  否则往下（广度优先）找第一个有的。 */
  function textBoxOf(clip, depth) {
    if (!clip) return null;
    if (clip.__textBox) return clip;
    const d = depth || 0;
    if (d > 3) return null;
    /* ① 子元素里直接有 `<text type="text">` 的 `<g>`（render.js 把 `__textBox` 挂在它上面）。 */
    if (clip.g && clip.g.querySelectorAll) {
      for (const g of clip.g.querySelectorAll('g[type="text"]')) {
        if (g.__textBox) return g;
      }
    }
    /* ② 再往下走一层子元件。 */
    if (clip.names) {
      for (const v of clip.names.values()) {
        if (v && v !== clip && v.__textBox) return v;
        const hit = textBoxOf(v, d + 1);
        if (hit) return hit;
      }
    }
    return null;
  }
  /** 详情页的 DOM：名字 / 阶段-伤害-类型 / 说明 / "需要·已有"面板 / 两颗按钮 / 图标。 */
  function buildDetailDom(host, kind, id, base, own, up, row) {
    let dom = host.querySelector('.sf-detail');
    if (!dom) {
      dom = document.createElement('div');
      dom.className = 'sf-detail';
      host.appendChild(dom);
    }
    current.detail.dom = dom;
    const m = detailMapper(host);
    if (!m) return;
    /* 字号统一用 `--u`（一个舞台单位 = 多少设计像素），见 css：面板里的字全部写成
     * `calc(var(--u) * N)`，这样窗口一变、宿主一缩放，字号跟着原版一起缩。 */
    dom.style.setProperty('--u', m.s(1).toFixed(3) + 'px');
    const s = (S() || {});
    const isW = kind === 'weapon';
    const weaponSpecial = isW ? weaponSpecialText(base) : '';
    const locked = !own;
    const maxed = !!(up && up.max);
    const heroDetail = heroView();
    const ownLv = own ? (Number(own.level) || 0) : 0;
    const trueOwn = ownLv > 10;
    const shownName = base ? ((trueOwn ? '真.' : '') + base.name) : '';
    const lvText = own ? String(trueOwn ? ownLv - 10 : ownLv) : '0';
    const harm = own && isW ? (own.harmLo + '-' + own.harmHi)
      : (isW ? (base && base.harm ? base.harm : '') : '技能');
    /* 说明：普通档原表 des；真化档按 `getDescription` / `getDesSkill` 写下一阶。 */
    let descText = locked ? (heroDetail ? '尚未掌握——在塔内学习新的武技'
      : '尚未获得——升级、开启礼包有机会获得')
      : (base && base.remark ? base.remark : '');
    if (own && !(up && up.fixed)) {
      if (ownLv >= 15) descText = isW ? ('神器已达最高阶段！' + (weaponSpecial ? '\n特殊效果：' + weaponSpecial : '')) : '神技已达最高阶段！';
      else if (ownLv + 1 > 10) {
        const nextLv = ownLv + 1;
        if (isW) {
          const add = String((base && base.harmAdd1) || '').split('|')[nextLv - 11] || '';
          descText = base && base.remark1
            ? ('升至下一阶将额外' + base.remark1 + '和' + add + '点基本伤害')
            : ('升至下一阶将额外提升' + add + '点基本伤害');
          if (weaponSpecial) descText += '\n特殊效果：' + weaponSpecial;
        } else {
          const row = window.GData && GData.trueSkillRow ? GData.trueSkillRow(id) : null;
          if (row && row.text) {
            const n = window.GData && GData.trueSkillStep ? GData.trueSkillStep(id, nextLv) : '';
            descText = '升至下一阶' + String(row.text).replace('N', n);
          }
        }
      }
    }
    const rows = [];
    if (!locked && !maxed && up && !heroDetail) {
      rows.push({ label: '金松果', need: up.coin, have: s.goldPoint | 0 });
      rows.push({ label: isW ? '卷轴' : '技能卷轴', need: up.book, have: ((s.props || {})[up.bookId] | 0) });
    }
    const pct = up && !maxed ? up.rate : null;
    const pos = (b) => 'left:' + m.x(b.x).toFixed(2) + 'px;top:' + m.y(b.y).toFixed(2) + 'px;width:' + m.s(b.w).toFixed(2) + 'px;' +
      (b.h ? 'height:' + m.s(b.h).toFixed(2) + 'px;' : '');
    const heroReq = heroDetail
      ? '<div class="sf-d-req" style="' + pos(DETAIL.req) + '">' +
          (pct != null ? '<div class="sf-d-req-rate"><b>下一级成功率</b><i>' + esc2(pct) + '%</i></div>' : '') +
          '<div class="small-label" style="margin-top:4px">本局勇者武技 · 无法直接升级</div>' +
        '</div>'
      : '';
    dom.innerHTML =
      '<div class="sf-d-panel" style="' + pos(DETAIL.panel) + '"></div>' +
      '<div class="sf-d-tab" style="' + pos(DETAIL.tab) + '">' + (isW ? '武器详情' : '技能详情') + '</div>' +
      '<div class="sf-d-name' + (locked ? ' locked' : '') + '" style="' + pos(DETAIL.name) + '">' + esc2(shownName) + '</div>' +
      '<div class="sf-d-icon' + (locked ? ' locked' : '') + '" style="' + pos(DETAIL.icon) + '"></div>' +
      '<div class="sf-d-stats" style="' + pos(DETAIL.stat) + '">' +
        statRow('阶段', lvText, m) + statRow(isW ? '伤害' : '等级', harm, m) + statRow('类型', base && base.type ? base.type : '被动', m) +
      '</div>' +
      '<div class="sf-d-desc" style="' + pos(DETAIL.desc) + '">' + esc2(descText) + '</div>' +
      (locked
        ? '<div class="sf-d-locked" style="' + pos(DETAIL.req) + '">' + (heroDetail ? '尚未掌握<br>该' : '尚未获得<br>该') + (isW ? '武器' : '技能') + '</div>'
        : (heroDetail
          ? heroReq
          : (rows.length || pct != null
            ? '<div class="sf-d-req" style="' + pos(DETAIL.req) + '">' +
                '<div class="sf-d-req-head"><span>需要</span><span>已有</span></div>' +
                rows.map((r) => '<div class="sf-d-req-row"><b>' + esc2(r.label) + '</b><i class="need">' + esc2(r.need) + '</i><i class="have">' + esc2(r.have) + '</i></div>').join('') +
                (pct != null ? '<div class="sf-d-req-rate"><b>成功率</b><i>' + esc2(pct) + '%</i></div>' : '') +
              '</div>'
            : ''))) +
      '<button class="sf-d-ok' + ((locked || maxed || heroDetail) ? ' off' : '') + '" style="' + pos({ x: DETAIL.btn.ok.x, y: DETAIL.btn.y, w: DETAIL.btn.ok.w, h: DETAIL.btn.h }) + '">' +
        (maxed ? (heroDetail ? '无法升级' : '已满级') : (heroDetail ? '勇者 · 只读' : (isW ? '升级武器' : '升级技能'))) + '</button>' +
      '<button class="sf-d-back" style="' + pos({ x: DETAIL.btn.back.x, y: DETAIL.btn.y, w: DETAIL.btn.back.w, h: DETAIL.btn.h }) + '">返回</button>';
    mountDetailIcon(dom.querySelector('.sf-d-icon'), row);
    const ok = dom.querySelector('.sf-d-ok');
    if (ok && !maxed && !locked && !heroDetail) ok.addEventListener('click', () => {
      const r = State.doUpgrade(kind, Number(id));
      if (window.UI && UI.toast) UI.toast(r.msg);
      /* 成功 / 失败都要重画：等级或成功率档位会变。 */
      openItemDetail(kind, id);
      refreshGridSoon();
    });
    const bk = dom.querySelector('.sf-d-back');
    if (bk) bk.addEventListener('click', () => closeItemDetail());
  }
  /** 详情页的图标位：挂**原版矢量元件**，viewBox 只框住卡片那一块（名字/等级那一条不要）。 */
  async function mountDetailIcon(box, row) {
    if (!box || !row || !row.icon) return;
    try {
      const v = await SfRender.mountSymbol(box, row.icon, {
        frame: 1, label: '武器图标', viewBox: '-2 -3 50 50',
      });
      if (!box.isConnected) { try { v.destroy(); } catch (e) {} return; }
      /* 记下这个子视图，收起详情页时按视图销毁它（**不碰**下面那一页的播放表，
       * 见 `destroyItemDetailOnly`）。 */
      if (current && current.detail) current.detail.view = v;
      /* 图标也是"静态页"：它里面那颗 4 帧装饰别自己播 —— 与格子里那 10 颗同一条规则。 */
      if (v.setStaticPolicy) v.setStaticPolicy({});
      if (!row.has && v.g) v.g.classList.add('locked');
      /* 详情页的图标位只框住卡片（viewBox 已切到卡片），名字 / 印章那一条落在框外，
       * 但为了不让它自己播（它是 4 帧精灵），照样按"未选中"那一档拨到空帧。 */
      paintIconLabel(v, false, false);
      writeIconLevel(v, row, false);
    } catch (e) { if (window.__errs) window.__errs.push('detail icon: ' + (e && e.message)); }
  }
  /** 详情页的坐标换算：整页 DOM 用的是**设计像素**（宿主被 `--uiscale` 缩放的倍数要除掉）。 */
  function detailMapper(host) {
    const view = current && current.view;
    const p = stageMapper(view, host);
    if (p) return p;
    /* 主页面还没量出来（换页那一瞬间）时退回"整块按 320×196 铺满宿主"。 */
    const box = host.getBoundingClientRect();
    const hs = layoutScale(host) || 1;
    const k = box.width ? box.width / 320 : 0;
    if (!k) return null;
    return { k: k, x: (sx) => (sx * k) / hs, y: (sy) => (sy * k) / hs, s: (n) => (n * k) / hs };
  }
  function statRow(label, value, m) {
    return '<span class="sf-d-stat"><b>' + esc2(label) + '</b><i>' + esc2(value) + '</i></span>';
  }
  /** 只收详情页那一层（回状态页，格子还在）。
   *  ⚠ 底层那一页**一直在播**：`render.js` 的播放注册表是**按视图分开**的，
   *  挂详情子页不会动到底层的表。所以这里只管把子视图拆掉，**不要**像以前那样
   *  "关详情就把整页重挂一次"（那会让整屏闪一下、tab 与页码归位 —— 用户报的"乱跳"之一）。 */
  function destroyItemDetailOnly() {
    if (!current || !current.detail) return;
    /* ⚠ 详情页现在是**原版整页**（`SfRender.mountSymbol('4673', …)`，4673 的宿主就是 `host` 这个
     * `<section>`）：`assetView.destroy()` 会把整棵 SVG 拆掉，所以下面那句 `host.remove()` 仍然要跑
     * ——否则留下一个空壳 `<section>` 压着状态页（点哪都没反应）。 */
    if (current.detail.view) { try { current.detail.view.destroy(); } catch (e) {} }
    if (current.detail.assetView && current.detail.assetView !== current.detail.view) {
      try { current.detail.assetView.destroy(); } catch (e) {}
    }
    if (current.detail.host && current.detail.host.parentNode) current.detail.host.parentNode.removeChild(current.detail.host);
    current.detail = null;
    if (current.container) current.container.classList.remove('sf-detail-open');
    /* 宿主高度回到"经典整页 320×196"，所以重量一次布局。 */
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
  }
  function closeItemDetail() {
    destroyItemDetailOnly();
    /* 底层那一页没被停过，重画一遍格子就够（等级可能刚升过、真化印章要跟着走）。 */
    try { applyTab(); } catch (e) { if (window.__errs) window.__errs.push('detail close: ' + (e && e.message)); }
  }
  function refreshGridSoon() {
    const page = current;
    setTimeout(() => { if (current === page) { try { applyTab(); } catch (e) {} } }, 30);
  }
  /** 「武器 / 技能」两页在挂载时要额外拉一份图标包（见文件头那段注释）。 */
  async function loadIconTable() {
    try { await SfRender.loadExtra('tags-wsicon.json'); } catch (e) { if (window.__errs) window.__errs.push('wsicon: ' + (e && e.message)); }
  }

  /* ---------- 格子的可点 / 悬停（打光 + 果冻缩放 + 名字）----------
   * 用户 2026-10 口径："鼠标悬停在特定武器或技能上面时，进行一个打光与果冻缩放效果，
   * 同时显示该武器的名称"。
   *  · 果冻缩放 + 打光：复用复刻已有那套 `.uc-pop` 壳（`popWrap`：悬停缩放 +
   *    drop-shadow 暖色光晕），另外给格子加 `.sf-cell` 让它**更明显一点**（见 css）；
   *  · 名字：**两档共用原版那一套**（图标元件自己的名字层，见 `dressIcon`）——
   *    已获得的是绿色名字（选中/悬停时显形），未获得的是"名字 + 1"那颗元件里的**灰色名字**。
   *    ⚠ 复刻曾经给"未获得"单独补过一条 DOM 名字条（`.sf-cellname`），2026-10 用户口径
   *    "显示方案要与已解锁一致、只是字体是同色灰色，ssfight 里已经实现了" → 那条整条删掉，
   *    改回原版的第二颗元件。 */
  /* ---------- 「真」印章与名字条 ----------
   * ⚠ 这两样**都是原版矢量元件自带的**，不需要 DOM 补：
   *   图标元件（如 2139）第 1 帧 = 常态卡片（2028）/ 第 2 帧 = **选中卡片**（2037，绿底绿框）；
   *   卡片下方那一层（元件名 `wname1`/`wname`、符号 2138）是个 **4 帧**精灵：
   *     1 = 名字（矢量画稿 2137，深绿） / 2 = 名字 + 「真」印章 / 3 = 只有印章 / 4 = 空。
   *   所以"哪一格显示什么"完全由**拨这两层帧**决定，见 `paintCell`。
   *   （复刻 2026-10 之前是"CSS 切掉名字层 + DOM 盖一枚小圆牌当印章"，
   *    实测与 `references/screen` 的原版截图差得很远：原版印章是**压出卡片右下角的大红印**、
   *    选中那格卡片是绿底，而且只有选中那一格才显示名字。） */

  /** 宿主自身被缩放的倍数（量一个 100px 探针；写进去的 CSS 像素会被 `--uiscale` 再乘一次）。 */
  function layoutScale(host) {
    if (!host.__probe) {
      const p = document.createElement('div');
      p.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:0;pointer-events:none;visibility:hidden';
      host.appendChild(p);
      host.__probe = p;
    }
    const w = host.__probe.getBoundingClientRect().width;
    return w ? w / 100 : 1;
  }
  /** 把一个格子接成"可点 + 悬停有反馈"。`it` 为 null（空槽）时只是不可点。 */
  function wireCell(cell, kind, it, i) {
    const t = T();
    if (!t || !cell || !cell.g) return;
    cell.__pinFrame = null;
    cell.__cellItem = it || null;
    cell.__cellIndex = i;
    cell.__cellKind = kind;
    if (!cell.__cellWired) {
      cell.__cellWired = true;
      cell.g.classList.add('sf-cell');
      cell.g.addEventListener('mouseenter', () => {
        const it0 = cell.__cellItem;
        if (!it0) return;
        /* 悬停 = 原版键盘光标停在那一项上（`showButton(weaponskillLoadArray, i, 1)` →
         * `mc.gotoAndStop(2)`）：**已获得与未获得都走这一下**——
         * 已获得那颗的第 2 帧是绿卡片 + 绿色矢量名字，未获得那颗（名字 + "1"）的第 2 帧是
         * 灰卡片 + **灰色**矢量名字。两档的显示方案完全一致，只有配色不同。 */
        setCellLook(cell, it0, true);
        cell.g.classList.add('lit');
      });
      cell.g.addEventListener('mouseleave', () => {
        setCellLook(cell, cell.__cellItem, false);
        cell.g.classList.remove('lit');
      });
      cell.g.addEventListener('click', (e) => {
        e.stopPropagation();
        const it2 = cell.__cellItem;
        if (!it2) return;
        /* 勇者准备：点一下点亮、再点一下变暗；爬塔中回看：
         *   · 已掌握的武技 → 打开**只读详情**（当前等级 / 下一级成功率，不能直接升级）；
         *   · 未掌握的空格 → 什么都不做（不让它开出“别人的”升级页）。 */
        if (heroView()) {
          const hero = Hero();
          if (!hero) return;
          if (hero.mode === 'setup') {
            const out = heroTogglePick(cell.__cellKind, it2.id);
            if (out && out.ok === false && out.msg && window.UI && UI.toast) UI.toast(out.msg);
            return;
          }
          if (!it2.has) return;
          openItemDetail(cell.__cellKind, it2.id);
          return;
        }
        /* ⚠ **查看别人时不许开详情**：原版 `showWeaponSkillWin`（:16658-16790）整段被
         * `if (!isViewfriend)` 包住 —— 看别人的武器/技能只给看，不给升级/升阶。
         * 不拦这一下的话，点对手的武器会开出"我的"升级页，数据与权限都是错的。 */
        if (friendView()) return;
        /* 原版：`jiantou_WZ_X1` 选中后按 Fire → `showWeaponSkillWin(chooseWz)` 开详情页。 */
        openItemDetail(cell.__cellKind, it2.id);
      });
    }
    /* ⚠ 换帧会重建格子元件 → 新实例没有接线。这里每次都补上（与 tab 同一个道理）。 */
    cell.g.style.cursor = it ? 'pointer' : 'default';
    cell.g.style.pointerEvents = it ? 'auto' : 'none';
    if (!it) { t.unregisterHit(cell); cell.g.classList.remove('lit'); return; }
    t.measureHitBox(cell);
    if (it) {
      t.popWrap(cell);
      const shell = cell.g.querySelector(':scope > g.uc-pop');
      if (shell) t.wirePopPress(shell);
      /* ⚠ **画序**：格子元件（3636）自己的那一帧画稿（`g[type=shape]`，卡片底 + 白色投影）
       * 与 `attachChild` 挂进来的图标在 DOM 里是兄弟，而 SVG 是"后来者画在上面" ——
       * 图标排在前面时会被卡片底**完全盖住**（实测：十个格子全是空卡；把卡片那层
       * `display:none` 之后图标完整可见）。
       * Flash 的语义正好相反：元件自己的帧画稿在 depth 1、`attachMovie(...,100)` 在 depth 100，
       * **图标画在卡片上面**。所以这里把挂上来的子元件挪到末尾。
       * ⚠ 必须在 `popWrap()` **之后**做：`popWrap` 会把 `<g>` 的子节点整个搬进 `.uc-pop` 壳，
       * 顺序会被重排一次（踩过一次：写完 `paintCell` 里挪、结果被 `popWrap` 又挪回去了）。 */
      raiseAttached(cell);
    }
  }

  /** 切到某个 tab：换页元件帧 + 重画/收掉 DOM 格子。 */
  function setTab(which) {
    if (!current) return;
    /* 新手引导 f15：切到别的页签才算完成（原版 tab1/tab2.onFire 要 tab_wz != 2/3
     * 并且 nowPage==15 才 doMission+showStatusTab，再推进到 22）。 */
    if (which !== current.tab && window.SfGuide && SfGuide.onStatusTab) {
      try { SfGuide.onStatusTab(which); } catch (e) {}
    }
    current.tab = which;
    current.gridPage = 0;
    // Switch the root first: some instances survive, others are newly created.
    stopAt(current.view, PAGE_FRAME[which] || 1);
    wireTabs();
    // Hydrate new bitmap digits in the same task as the root frame change.
    if (which === 'status') fillValues(current.view);
    applyTab();
  }
  /** Gold idle / green selected / cream hover are static states, not animation. */
  function wireTabs() {
    const view = current && current.view;
    if (!view) return;
    for (const [nm, key] of [['tab', 'status'], ['tab1', 'weapons'], ['tab2', 'skills']]) {
      wireClickable(clipOf(view, nm), {
        /* 悬停 = 原版"键盘光标停在 tab 那一行"：那一档原版停在**第 3 帧（浅奶油底）**，
         * 不是第 2 帧。原版 `myDraw()`（MainMovie.as:21113-21151）：三颗先 `gotoAndStop(1)`，
         * 选中的那一颗在 `jiantou_WZ_Y1 == -1`（光标不在 tab 行）时 `gotoAndStop(2)`（绿底），
         * 否则 `gotoAndStop(3)`（奶油底）。`references/screen/…161800.png`（状态页，光标不在
         * tab 行 → 状态=绿）与 `…162315.png`（武器页，光标在 tab 行 → 武器=奶油）正好各拍到一档。 */
        hover: 3,
        idle: () => (key === activeTab() ? 2 : 1),  // 离开回常态；但**自己就是当前页**时留在选中态
        press: 0,                                   // 按下交给 CSS（第 3 帧是"光标在 tab 行"，不能闪它）
        onFire: () => setTab(key),
      });
    }
    wireFrameButtons();
  }
  /** 状态帧（第 1 帧）特有的三颗键：更换装备 / 装备融合 / 返回菜单。
   *  它们**只存在于状态帧**；换帧重建之后实例是新的，所以每次换帧都重接一遍。
   *  `back`（3362）在三个帧里都在，动作各帧相同，重接也无副作用。 */
  /** 查看别人时底栏那颗原版按钮的**贴图里烤死了「返回菜单」**（3362 的第 6 层是四字矢量），
   *  这里把那一层藏掉、补一个「返回」文本 —— 只改文字层，按钮的胶囊/高光/热区都不动。
   *  页签切换会把 `back` 重建，所以每次 `wireFrameButtons` 都要补一遍。 */
  function markFriendBackLabel(view) {
    const back = clipOf(view, 'back');
    if (!back || !back.g) return;
    const host = back.getContentHost ? back.getContentHost() : back.g;
    if (!host || !host.querySelectorAll) return;
    for (const n of host.querySelectorAll(':scope > [depth="6"]')) n.style.display = 'none';
    if (host.querySelector(':scope > text.sf-friend-back-label')) return;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'sf-friend-back-label');
    label.setAttribute('x', '0');
    label.setAttribute('y', '8.6');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '13.5');
    label.setAttribute('font-weight', '700');
    label.setAttribute('font-family', '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif');
    label.setAttribute('fill', '#fff8e0');
    label.setAttribute('stroke', '#5a2a12');
    label.setAttribute('stroke-width', '0.9');
    label.setAttribute('paint-order', 'stroke fill');
    label.setAttribute('pointer-events', 'none');
    label.textContent = '返回';
    host.appendChild(label);
  }
  /** 关卡「挑战」页（4756 f5）那颗**原版 3911「返回」**。
   *  查看别人的状态页直接复用它（用户 2026-11 口径）：位置/尺寸照关卡页的
   *  `matrix(1,0,0,1,160.3,175.5)` 原样使用 —— 比 3644 更宽、略高，落在底部中间偏左。
   *  ⚠ 3911 有 2 帧：第 1 帧是**黄色**（`3171` 黄/橙渐变），第 2 帧是**绿色**
   *  （`3173` 绿渐变）。交互由调用方 `wireClickable({hover:2, idle:1})` 接：
   *  默认黄、悬停/按下绿。若挑战包没加载到，调用方退回原 `back` + 自绘文字。 */
  function useStageBack(view, symbol, frame, x, y, scale, name, cacheKey) {
    if (!view || !view.attachChild) return null;
    let btn = cacheKey && view[cacheKey] && view[cacheKey].g && view[cacheKey].g.isConnected ? view[cacheKey] : null;
    if (!btn) {
      const made = view.attachChild(symbol, frame, name);
      if (!made || !made.g) return null;
      btn = view[cacheKey] = made;
      const sc = Number(scale) > 0 ? Number(scale) : 1;
      btn.g.setAttribute('transform', 'matrix(' + sc + ',0,0,' + sc + ',' + x + ',' + y + ')');
      btn.g.style.cursor = 'pointer';
      btn.g.style.pointerEvents = 'auto';
    }
    return btn;
  }
  /** 查看好友 → 左下「删除好友」：原版 `showRemoveFriend()` 是二次确认 + `removeFriendById`。
   *  这里走 `State.removeFriend`（同一份好友存档），确认后回挑战页并刷新好友名单。 */
  function removeFriendFromView() {
    const f = Friend();
    if (!f || !window.State || !State.removeFriend) return;
    const C = window.UI && UI.classic;
    const doRemove = () => {
      const r = State.removeFriend(f.name);
      if (window.UI && UI.toast) UI.toast(r.msg || (r.ok ? '删除好友成功。' : '删除失败'));
      if (!r.ok) return;
      leaveFriendView();
      try { if (window.SfChallenge && SfChallenge.showTab) SfChallenge.showTab('friends'); } catch (e) {}
    };
    if (C && C.modal) {
      C.modal('删除好友', '<p>确定要删除好友【' + esc(f.name) + '】吗？</p>', [
        { label: '删除', cls: 'muted', run: doRemove },
        { label: '取消', cls: 'gold' },
      ], { small: true });
      return;
    }
    if (typeof window.confirm === 'function' && !window.confirm('确定要删除好友【' + f.name + '】吗？')) return;
    doRemove();
  }
  /** 查看好友 → 右下「留言」：原版是 `openWap(leaveMsgUrl + playerId)` 的外链留言板；
   *  离线版落进存档（`State.friendMessages` / `leaveFriendMessage`），这里用经典弹窗补全界面。 */
  function openFriendMessage() {
    const f = Friend();
    if (!f) return;
    const C = window.UI && UI.classic;
    if (!C || !C.modal || !State.friendMessages || !State.leaveFriendMessage) {
      if (window.UI && UI.toast) UI.toast('本地怀旧版暂不支持留言。');
      return;
    }
    const list = State.friendMessages(f.name) || [];
    const rows = list.length
      ? list.map((m) => '<li style="display:flex;gap:8px;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #e2c68f">' +
          '<span>' + esc(m.text) + '</span><time style="flex:none;color:#9a7a4a;font-size:12px">' + esc(new Date(m.at).toLocaleString()) + '</time></li>').join('')
      : '<li style="padding:6px 0;color:#9a7a4a">还没有留言，写一句吧。</li>';
    const html = '<div style="max-height:150px;overflow:auto;margin:0 0 10px;padding:8px 10px;border:2px solid #c9a25a;border-radius:12px;background:#fffaf0;color:#5a3a1a">' +
      '<ul style="margin:0;padding:0;list-style:none">' + rows + '</ul></div>' +
      '<textarea data-friend-msg maxlength="80" placeholder="写一句留言…（最多 80 字）" style="width:100%;min-height:64px;box-sizing:border-box;padding:8px;border:2px solid #c9a25a;border-radius:12px;font:inherit;color:#5a3a1a;background:#fffdf1"></textarea>' +
      '<p class="small-label" style="margin:8px 0 0">留言只保存在本机存档，不会上传到服务器。</p>';
    let m = null;
    const send = () => {
      const ta = m && m.element && m.element.querySelector('[data-friend-msg]');
      const r = State.leaveFriendMessage(f.name, ta ? ta.value : '');
      if (window.UI && UI.toast) UI.toast(r.msg || (r.ok ? '留言已保存' : '留言失败'));
      if (!r.ok) return;
      if (m) m.close();
      openFriendMessage();
    };
    m = C.modal('给【' + f.name + '】留言', html, [
      { label: '发送', cls: 'gold', close: false, run: send },
      { label: '返回', cls: 'muted' },
    ], { small: true });
  }
  function wireFrameButtons() {
    const view = current && current.view;
    if (!view) return;
    /* 原版按**等级**决定停哪一帧（`MainMovie.as:13931-13974`）：
     *   · `b_change`(7199)：`level >= 5`  → 第 1 帧（已开启）；否则第 2 帧（灰底 + "5级开启"）
     *   · `b_fusion`(7207)：`level > 19` → 第 1 帧（已开启）；否则第 2 帧（灰底 + "20级开启"）
     * **第 2 帧不是悬停高亮，而是"还没开启"那一档** —— 复刻原来把它当 hover 帧用，
     * 于是鼠标一移上去就切出那层灰底（用户 2026-10 报的"会触发另一层 x 级开启的灰色 ui 层，
     * 而且这一层跟等级检测没同步"）。现在：状态帧按等级选、悬停只给 CSS 光晕，
     * 未开启时点它照原版 `showTips` 的**原文**给一句提示、不进页面。 */
    const lv = () => Math.max(1, Math.round(Number((S() || {}).level) || 1));
    /* ---------- 勇者模式：同一帧里的两颗键 ----------
     * 第 1 帧原版就有「更换装备 / 装备融合」两颗并排键（实测 b_change 158..223、
     * b_fusion 222.5..300.1）。勇者页把 b_fusion 整颗藏掉、原位挂「开始挑战」，
     * 所以这里只留 b_change 的「更换装备」接线。 */
    if (heroView()) {
      const hero = Hero();
      const outer = clipOf(view, 'b_change');
      if (outer) stopAt(outer, 1);
      const fusion = clipOf(view, 'b_fusion');
      if (fusion && fusion.g) fusion.g.style.display = 'none';
      /* 与自己的状态页完全同一套：外层 `b_change` 在第 1 帧就是「更换装备」按钮本身，
       * 它自己的量盒/接线路子已经验证过；不要再往子键里找（子键可能是零尺寸的空壳）。 */
      if (outer && outer.g) {
        wireClickable(outer, { hover: 0, press: 0, idle: () => 1, onFire: () => {
          /* 主路径：玩家自己的「更换装备」原版页（4673 第 3 帧），只是换成全部装备 / 0 加成。
           * 原版页挂不上（素材缺失等）才退回 tower-ui 的 DOM 装备层。 */
          const p = openGearsPage();
          if (p && typeof p.then === 'function') {
            p.then((ok) => { if (!ok && hero.onGears) hero.onGears(); }).catch((e) => {
              if (window.__errs) window.__errs.push('hero gears: ' + (e && e.message));
              if (hero.onGears) hero.onGears();
            });
          }
        } });
      }
      wireHeroChrome();
      return;
    }
    /* ---------- 查看别人时这两颗换档（原版 `showMainInfo` 的 `isViewfriend` 分支）----------
     * `b_change`(7199)：原版 `gotoAndStop(5)`（已是好友）/ `gotoAndStop(4)`（陌生人），
     *   第 4/5 帧上写的是「查看装备」；`b_fusion`(7207)：`gotoAndStop(3)`（整颗隐藏）。
     * 复刻这两档的文案已经烤在素材里（`b_change` 第 4/5 帧），所以**只拨帧不接线**；
     * `b_fusion` 第 3 帧是空档，拨过去就看不见了。 */
    if (friendView()) {
      /* 原版 `showMainInfo()` 的 isViewfriend 分支：`b_change` 在第 5 帧（好友）/ 第 4 帧
       * （陌生人）里放出**三颗子按钮**：`b_change` = 查看装备、`del_friend` = 删除好友、
       * `leaveMsg` = 留言。以前只接了外层的 `b_change`，三颗子键的点击都被外层吃掉 →
       * 点删除 / 留言全进了「查看装备」。现在逐颗接线。 */
      const outer = clipOf(view, 'b_change');
      const isFriend = !!(Friend() && Friend().kind === 'friend');
      if (outer) stopAt(outer, isFriend ? 5 : 4);
      const changeBtn = outer && outer.byName ? outer.byName('b_change') : null;
      const delBtn = outer && outer.byName ? outer.byName('del_friend') : null;
      const leaveBtn = outer && outer.byName ? outer.byName('leaveMsg') : null;
      if (changeBtn) wireClickable(changeBtn, { hover: 2, press: 0, idle: 1, onFire: openFriendGears });
      if (delBtn) wireClickable(delBtn, { hover: 2, press: 0, idle: 1, onFire: removeFriendFromView });
      if (leaveBtn) wireClickable(leaveBtn, { hover: 2, press: 0, idle: 1, onFire: openFriendMessage });
      /* 素材/帧异常时至少保留「查看装备」的旧入口，不能让整页点不动。 */
      if (!changeBtn) wireClickable(outer, { hover: 0, press: 0, idle: () => (isFriend ? 5 : 4), onFire: openFriendGears });
      wireClickable(clipOf(view, 'b_fusion'), { hover: 0, press: 0, idle: () => 3, onFire: () => {} });
      /* 返回：直接用**关卡「挑战」页那颗原版 3911**：默认黄色，悬停/按下变绿色；
       * 位置与尺寸照关卡页 `matrix(1,0,0,1,160.3,175.5)`。3911 不可用时退回原 back。 */
      const oldBack = clipOf(view, 'back');
      const stageBack = useStageBack(view, '3911', 1, 160.3, 175.5, 1, 'friend-view-back', '__friendViewBack');
      if (stageBack) {
        wireClickable(stageBack, { hover: 2, press: 2, idle: 1, onFire: leaveFriendView });
        if (oldBack && oldBack.g) oldBack.g.style.display = 'none';
      } else {
        wireClickable(oldBack, { hover: 0, press: 0, onFire: leaveFriendView });
        markFriendBackLabel(view);
      }
      return;
    }
    /* ⚠ 「更换装备」走**原版那一页**（库元件「状态1」= 4673 的第 3 帧，`showEquipsWin()`）：
     * 它是盖在**本页之上**的一层，页根 7218 不动 —— 所以这里**不 `destroy()`**、也不走
     * `UI.runAction('gears')`（那是现代模式的 DOM 弹窗）。退出那一层时本页原样还在。
     * 「装备融合」暂时仍走复刻的 DOM 二级页，所以那一颗保持"先收掉本页"的老写法。 */
    wireClickable(clipOf(view, 'b_change'), {
      hover: 0, press: 0,
      idle: () => (lv() >= 5 ? 1 : 2),
      onFire: () => {
        if (lv() >= 5) {
          const p = openGearsPage();
          if (p && typeof p.catch === 'function') p.catch((e) => { if (window.__errs) window.__errs.push('gears page: ' + (e && e.message)); });
          return;
        }
        if (window.UI && UI.toast) UI.toast('你还没有达到5级，不能使用装备哦。多多挑战，多多使用道具，努力升级吧！');
      },
    });
    wireClickable(clipOf(view, 'b_fusion'), {
      hover: 0, press: 0,
      idle: () => (lv() > 19 ? 1 : 2),
      onFire: () => {
        if (lv() > 19) {
          /* 原版是 `showFusionWin()` → `loadMcs([["状态1","subFrame4",…]]); subFrame4.gotoAndStop(8)`，
           * 也就是**盖在状态页上的一层**（与「更换装备」同一套机制），不是另起一个现代页面。 */
          const p = openFusionPage();
          if (p && typeof p.catch === 'function') p.catch((e) => { if (window.__errs) window.__errs.push('fusion page: ' + (e && e.message)); });
          return;
        }
        if (window.UI && UI.toast) UI.toast('20级就可以进行装备融合啦！高级装备任你做，亲手打造出极品！');
      },
    });
    /* 返回（3362：1 常态 / 2 高亮）。 */
    wireClickable(clipOf(view, 'back'), {
      hover: 2,
      onFire: () => { destroy(); if (window.UI && UI.runAction) UI.runAction('home'); },
    });
  }
  /* ============================================================
   * 接线：三个 tab + 翻页箭头 + 两颗功能键 + 返回
   * ------------------------------------------------------------
   * ⚠ 这一页**没有"只接一次线"这回事**：三颗 tab、两颗功能键、返回菜单分别挂在页元件
   * 7218 的**不同帧**里，而 `setTab()` 切帧会把整棵子树重建 —— 重建出来的全是新实例
   * （旧的随帧被摘掉、从播放表里注销）。所以接线一律走 `wireTabs()` /
   * `wireFrameButtons()`，**每次换帧后重来一遍**。
   * 只接一次的话，从武器 / 技能切回状态之后那几颗就是"没接过线"的新实例：
   * 既不响应鼠标、也没被钉帧，于是各自在 3~4 帧之间循环播自己的状态帧
   * （金底 / 绿底 / 浅底 / 空），屏幕上一排 tab 忽金忽绿、内容互相错位叠着闪，
   * 整页看起来就是花屏 —— 用户 2026-10 报的"切到武器和技能再切回状态会全屏乱码"。
   *
   * 原版 `myDraw()`（MainMovie.as:21113-21151）：三颗 tab 先 `gotoAndStop(1)`（常态）；
   * 选中的那一颗，`jiantou_WZ_Y1 == -1`（光标不在 tab 那一行）时 `gotoAndStop(2)`，
   * 否则 `gotoAndStop(3)`。导出数据实测（`tags-status.json` 的 7210/7212/7215，各 4 帧）：
   *   **第 1 帧 = 金底常态 / 第 2 帧 = 绿底选中 / 第 3 帧 = 浅奶油底（禁用那一档）**。
   * 所以"选中"只能停第 2 帧 —— 复刻之前把选中写成了第 3 帧（浅色），
   * 又拿第 2 帧当悬停帧，两档正好反了。
   * ========================================================== */

  /* ---------- 挂载与生命周期 ---------- */
  let seq = 0;
  /* 调试/探针用：记录最近一次 `open()` 停在哪一步（`?ssdzdbg=1` 或探针里直接读）。
   * 出问题时报出"哪一步之后没了"，比反复猜快得多。 */
  let openTrace = '';
  async function open(container, opts) {
    openTrace = 'start';
    if (!window.SfRender || !window.SfRender.mountSymbol) throw new Error('SfRender 未加载（缺 js/ssfight/render.js）');
    const t = T();
    if (!t) throw new Error('SfUiMain.toolkit 不在（缺 js/ssfight/ui-main.js）');
    const o = opts || {};
    let host = container || (current && current.container);
    if (!host) {
      const ui = document.getElementById('ui');
      if (ui) {
        ui.innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠状态"></section>';
        host = ui.querySelector('.ssfight-home');
      }
    }
    if (!host) { openTrace = 'no-host'; return false; }
    /* ⚠ 作废在途挂载用的是 `++seq`；这里必须**领号再作废旧号**：
     * `destroy()` 只负责拆树、不动 `seq`（它会被 UI 侧当"关掉这一页"调），
     * 递增统一走 `invalidate()` —— 否则 `mine !== seq` 恒成立、函数直接返回 false，
     * 状态页就会一直空白（第一次写就是这么错的）。 */
    const mine = ++seq;
    destroyView();
    openTrace = 'destroyed mine=' + mine + ' seq=' + seq;
    await SfRender.loadExtra('tags-status.json');
    openTrace = 'bundle-status mine=' + mine + ' seq=' + seq;
    /* 武器 / 技能栏那 34 颗图标元件单独成包（`tags-wsicon.json`，见 `iconRoots()`）。
     * 拉不到就只是"那几颗走 PNG 兜底"，不影响整页。 */
    await loadIconTable();
    /* 立绘要贴装备 —— 容器素材在 `tags-gear.json`（1.8 MB），只有真进状态页才拉。 */
    try { await SfRender.loadExtra('tags-gear.json'); } catch (e) {}
    /* 查看别人 / 勇者模式时底栏要挂**关卡三级页那颗原版 3911「返回」**（用户口径 2026-11：
     * 不要自己给 3362 补字，直接用关卡「挑战它」那一页的返回键）。3911 在挑战包里。 */
    if (o.friend || o.hero) { try { await SfRender.loadExtra('tags-challenge.json'); } catch (e) {} }
    await loadFrameTable();
    if (mine !== seq) { openTrace = 'stale mine=' + mine + ' seq=' + seq; return false; }
    const view = await SfRender.mountSymbol(host, '7218', {
      frame: 1, label: '状态',
      // Suppress the exported placeholder until real values are filled below.
      blank: ['expNum'],
    });
    if (mine !== seq || host.isConnected === false) { view.destroy(); return false; }
    openTrace = 'mounted';
    const initialTab = (o.tab === 'weapons' || o.tab === 'skills') ? o.tab : 'status';
    current = { view: view, container: host, tab: initialTab, gridPage: 0,
      /* 查看别人：整页数据源换成他（原版 `isViewfriend`），返回键也换成"回挑战页"。
       * `hero`：勇者准备 / 爬塔中回看，同一颗页元件、另一份数据源与按钮层。
       * `overlay` = 盖在挑战页上的一层（不拆底页，返回时不重开挑战页 / 不刷新敌人）。 */
      friend: o.friend || null, hero: o.hero || null, backTo: o.backTo || null, overlay: !!o.overlay };
    if (o.friend) setTextByName(view, 'playerName', String(o.friend.name || ''));
    /* 页面装好了再让 `main.js` 量一次布局（见 ui-main.js 里同一处的注释：
     * 经典整页是 320×196，`#ui` 的高度在 716.625 / 690 之间切，不重量就会"屏幕边缘失去填充"）。 */
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    /* 这一页是**静态页**（原版靠键盘选中才切某一项的帧）：交给统一的「静态页策略」
     * —— 子树里所有多帧元件**出生即冻结**，而且**换帧重建出来的新实例自动适用**
     * （切 tab / 换页 / `applyTab` 重画格子 / `dressParts` 重贴装备都不再需要人管）。
     * ⚠ 老写法要在这里列一份"马上要接线的元件不许钉"的例外名单 —— 那是 `pinFrame` 时代
     * 的补丁（冻结每一拍强制拨帧、会和 `gotoAndStop` 打架）。现在冻结只写
     * `playing = false`（不自己走、不碰帧号），`gotoAndStop` / `showNumber` 全部照常生效，
     * 所以**一个例外都不需要**。 */
    t.freezeDescendants(view);
    try { fillValues(view); } catch (e) { if (window.__errs) window.__errs.push('status values: ' + e.message); }
    try { wireTabs(); } catch (e) { if (window.__errs) window.__errs.push('status wire: ' + (e && e.message)); }
    /* 入口可以指定初始页签：勇者头像 → 直接进「技能」页；普通状态页仍是「状态」。 */
    try {
      if (initialTab !== 'status') setTab(initialTab);
      else applyTab();
    } catch (e) { if (window.__errs) window.__errs.push('status initial tab: ' + (e && e.message)); }
    /* 数值会变（经验/胜率/穿了装备），1s 一次重刷；与村庄页同一套节拍。 */
    current.timer = setInterval(() => {
      if (!current || current.view !== view || current.tab !== 'status') return;
      try { fillValues(view); } catch (e) {}
    }, 1000);
    openTrace = 'done';
    return true;
  }
  /** 只拆当前这棵树（**不动 `seq`**）：`open()` 每次重挂前调它，UI 侧也拿它当"关掉这一页"。 */
  function destroyView() {
    /* 「更换装备」/「装备融合」这两层都是盖在本页上的（原版 `loadMcs(subFrame)`），
     * 拆本页时一并收掉 —— 不收的话它们会留在一块已经不在页面上的宿主里，下次进状态页时变成孤儿层。 */
    destroyGearPage();
    destroyFusionPage();
    const overlayHost = current && current.overlay ? current.container : null;
    if (current) {
      if (current.timer) clearInterval(current.timer);
      if (current.detail) destroyItemDetailOnly();
      if (current.view) { try { current.view.destroy(); } catch (e) {} }
    }
    current = null;
    /* 查看别人的状态页是**盖在挑战页上**的一层：拆完必须把这层空 section 也摘掉，
     * 否则挑战页还在下面但被一块不透明的空白层永远盖住。 */
    if (overlayHost && overlayHost.parentNode) {
      try { overlayHost.parentNode.removeChild(overlayHost); } catch (e) {}
    }
  }
  /** 作废所有在途的 `open()`（它们看到 `seq` 变了就自己放弃），然后拆树。 */
  function destroy() { seq++; destroyView(); }

  /* ============================================================
   * 「查看装备」—— 原版 `friendEquipsInfo()`（:13821）= 库元件「状态1」第 7 帧
   * ------------------------------------------------------------
   * 那一颗**还没提取**（`状态1` = 4673 在导出符号表里查不到 spriteId，见
   * `docs/经典模式-可行性.md` 第 628 行那张表），所以这一页照复刻既有那套画一层 DOM：
   * **他穿了什么**（四件，带部位 + 强化等级）＋ 四维 + 战斗力，返回回他自己的状态页。
   * ⚠ 以前这里根本走不通：`openFriendGears()` 先把状态页 `destroy()`、再调
   *   `SfChallenge.showFriendGears`（**那个函数当时不存在**）→ 兜底 `UI.runAction('challenge')`，
   *   于是点「查看装备」= 状态页没了、回到随机页，装备一件看不到 ——
   *   用户 2026-10 报的"点开查看装备时会闪退，完善这个页面"就是这一条。
   *   现在**不拆状态页**，只盖一层（与武器技能详情页同一套：`detailHost()` + `.sf-detail`）。
   * ⚠ 版式用**四行**（每行一件：图标 / 名字 / 部位 / 强化）而不是"横着排四个"：
   *   面板宽 272 个舞台单位，四件横排每件只有 62 个单位，`sf-fd-list li` 的 `width:31%`
   *   会折成两行、名字和部位叠在一起（第一版就是那样）。一列四行最稳，也更好读。
   * ========================================================== */
  const GEAR_PART_NAME = { 0: '头部', 1: '拳套', 2: '衣服', 3: '鞋子' };
  const FRIEND_GEAR_BOX = { x: 24, y: 18, w: 272, h: 158 };
  /* ============================================================
   * 「查看装备」= **原版那一页**（库元件「状态1」= **4673** 的第 7 帧）
   * ------------------------------------------------------------
   * 原版 `friendEquipsInfo()`（MainMovie.as:13821-13827）：
   *   `setState(18); loadMcs([["状态1","subFrame5",currentFrame]]);`
   *   `subFrame5.gotoAndStop(7); showFriendInfoWin(subFrame5, friendInfo.player.wearsList);`
   * 而 `showFriendInfoWin`（:19037-19091）读的是**四个格子**：
   *   `mc_tab1..4`，每格 `{ c1(图标位), t_base(主属性：敏捷+/力量+/生命+/速度+), t_name(装备名),
   *                          t_addr(附加说明), stone(宝石名) }`，
   *   `mc_tab{i}.gotoAndStop(1)` = 有装备 / `(2)` = 空位。
   * 这四个名字**确实在 4673 的第 7 帧里**（`tools/gen-ssfight-ui.cjs` 的 `STATUS_SUB` 把它
   * 提进了 `tags-status.json`）。所以这一页从"复刻自研的 DOM 面板"换成**挂原版帧 + 写字段**：
   * 与②的口径一致（"对齐 ssfight 版本，当前版本的实现不是我想要的"）。
   * ⚠ 用户 2026-10 之前这里只能用 DOM 画 —— 那时 4673 还没进素材库；
   *   现在若素材缺失（老缓存 / 包没更新）仍退回 DOM 面板，不会白屏。 */
  function openFriendGearsAsset() {
    const host = detailHost();
    if (!host) return null;
    if (current.detail && current.detail.assetView) {
      const v = current.detail.assetView;
      if (v.g && v.g.isConnected) return v;
    }
    current.detail = current.detail || {};
    const p = SfRender.mountSymbol(host, '4673', { frame: 7, label: '查看装备' });
    return p;
  }
  /** 把一个好友的装备写进 `mc_tab1..4`（逐条照 `showFriendInfoWin`，MainMovie.as:19037-19091）。
   *
   *  原版每一格做四件事，这里逐条对上：
   *   ① `mc_tab{i}.gotoAndStop(1|2)` = 有装备 / 空位（`id == 0 || name == undefined`）；
   *   ② `t_base` = **主属性**（"敏捷+25" 这种；按 `type` 落到对应那一格 —— 见下面的换算）；
   *   ③ `t_addr` = **附加属性说明**（`getEquipAttachmentDes`：三条附加逐条拼成多行，空 = "无"），
   *      ⚠ 复刻以前这里写的是**部位名**（头部/拳套…），和原版那一格对不上；
   *   ④ `c1.attachMovie(convertLink(equip), "mc", 100)` = **装备画稿** + `setEquipTextColor(t_name)`
   *      按品质给名字上色 + `stone` = 宝石名。
   *      ⚠ 图标位以前**完全没填**：四格里只有字没有装备图（用户 2026-11 口径："查看装备页面的
   *      格式与贴图要和 ssfight 对齐"）。现在优先挂 `gearColorId` 查到的**原版预上色整卡符号**
   *      （与「我的装备」那六格同一套 `convertLink` 口径；`tags-gear-color.json` 在打开这一层前
   *      已加载）；查不到符号（老包 / 好友装备缺 type/quality）才退回容器画稿 + `fitArtwork`。 */
  function fillFriendGearTabs(view, foe) {
    const t = T();
    if (!view || !foe) return false;
    const byType = [];
    /* 每一件的**部位号**单独记一份：对手数据里 `type` 经常没有（只有 id），
     * 图标位要按同一个部位号去挑容器（`containerIds`）—— 到用的时候再 `Number(g.type)` 会得 NaN、
     * `containerIds[NaN]` 取不到，四格就**只有字没有装备图**（真对手实测踩到）。 */
    const partOf = new Map();
    for (const g of (foe.gears || [])) {
      const ty = Number(g && g.type != null ? g.type : (State.gearPart ? State.gearPart(g.id) : NaN));
      if (!Number.isFinite(ty)) continue;
      if (byType[ty] === undefined) { byType[ty] = g; partOf.set(g, ty); }
    }
    const C = window.UI && UI.classic;
    const gearName = (g) => (g && C && C.gearName ? C.gearName(Number(g.id)) : ('装备' + (g ? g.id : '')));
    /* 主属性**标签**：原版 `showFriendInfoWin` 按 `_loc2.type` 选"敏捷+/力量+/生命+/速度+"
     * 的四个分支，并把文案写进 `_loc4[type]` —— 也就是**部位号同时就是那四个标签的下标**
     * （0 头巾=敏捷 / 1 手套=力量 / 2 衣服=生命 / 3 鞋=速度，见 `State.gearInst` 的 attrName）。
     * 数值优先读 `g.attr`（实例上 roll 过 ±5% 的主属性），再退字典基准值。 */
    const GEAR_STAT_LABEL = ['敏捷', '力量', '生命', '速度'];
    const baseText = (ty, g) => {
      if (!g) return '';
      const label = GEAR_STAT_LABEL[ty] || '敏捷';
      let amount = 0;
      if (Number.isFinite(Number(g.attr)) && Number(g.attr) > 0) amount = Number(g.attr);
      if (!amount) { try { amount = Number(State.gearBaseAttr ? State.gearBaseAttr(Number(g.id)) : 0) || 0; } catch (e) { amount = 0; } }
      if (!amount) amount = Math.max(1, Number(g.ext) || 1);
      return label + '+' + amount;
    };
    /* `t_addr`：原版 `getEquipAttachmentDes` 的等价物 —— `State.extText` 已经把每条附加属性
     * 的说明算好（`基础反击率效果提升-10%` 这种），逐条换行拼起来；一条都没有时照原版写"无"。 */
    const addrText = (g) => {
      if (!g) return '';
      let lines = [];
      try { lines = State.extText ? State.extText(g.ext || []) : []; } catch (e) { lines = []; }
      lines = (lines || []).filter(Boolean);
      return lines.length ? lines.join('\n') : '无';
    };
    const gemText = (g) => {
      const gem = g && g.gem;
      const id = Number(gem && gem.id);
      if (!id) return '';
      try {
        const p = window.propMap && propMap.getValue(id);
        return p ? String(p.name || '') : '';
      } catch (e) { return ''; }
    };
    const qualityOf = (g) => {
      try { return State.gearQuality ? State.gearQuality(g) : (Number(g && g.quality) || 0); } catch (e) { return 0; }
    };
    let any = false;
    for (let i = 0; i < 4; i++) {
      const tab = clipOf(view, 'mc_tab' + (i + 1));
      if (!tab) continue;
      any = true;
      const g = byType[i];
      /* 1 = 有装备 / 2 = 空位（`showFriendInfoWin` 的 gotoAndStop(1|2)） */
      stopAt(tab, g ? 1 : 2);
      const set = (name, str) => { const c = clipOf(tab, name); if (c && t) t.setText(c, str == null ? '' : String(str)); };
      set('t_name', g ? gearName(g) : '');
      set('t_base', baseText(i, g));
      set('t_addr', addrText(g));
      set('stone', gemText(g));
      /* 名字按品质上色（`setEquipTextColor`）—— 必须排在 `setText` 之后（见 `setGearTextColor`）。 */
      if (g) setGearTextColor(clipOf(tab, 't_name'), qualityOf(g));
      /* 图标位 `c1`：贴原版装备画稿（容器 + 该件的帧号），等比缩到卡片里居中。 */
      const slot = clipOf(tab, 'c1');
      if (slot && slot.detachAll) {
        slot.detachAll();
        /* 卡片的包围盒要**在贴之前**量（`getBBox()` 会把贴上去的画稿也算进来，越量越大），
         * 而且量的是**卡片自己坐标系**里的盒子 —— `c1` 自己的放置矩阵带 0.8 缩放，
         * 用父级坐标系的盒子去算会把小件算大、大件算出界。 */
        let card = null;
        try { card = slot.g && slot.g.getBBox ? slot.g.getBBox() : null; } catch (e) { card = null; }
        if (g) {
          const part = partOf.has(g) ? partOf.get(g) : Number(g.type);
          /* 原版这里也是 `attachMovie(convertLink(equip))`：符号是**整张卡**，
           * 按 1:1 挂在格子 `(0,0)` 上。查不到预上色符号（老包 / 好友装备没 type）
           * 才退回容器画稿 + fitArtwork。 */
          const cg = Object.assign({}, g, { type: part, quality: qualityOf(g) });
          const sid = gearColorId(cg);
          if (sid && slot.attachChild) {
            slot.attachChild(String(sid), 1, 'gear');
          } else {
            const info = wearInfo(g);
            const sym = containerIds && containerIds[part] && containerIds[part][0];
            if (info && sym && slot.attachChild) {
              const child = slot.attachChild(sym, info.frame, 'wear');
              if (child) {
                if (card && card.width > 0 && card.height > 0) {
                  fitArtwork(child, 0.85 * Math.min(card.width, card.height),
                    card.x + card.width / 2, card.y + card.height / 2);
                } else {
                  fitArtwork(child, GEAR_CARD_ART, GEAR_CARD_MID, GEAR_CARD_MID);
                }
              }
            }
          }
        }
      }
      if (slot && slot.setExtraTransform) {
        slot.setExtraTransform('translate(' + FRIEND_GEAR_ICON_DX + ',0)');
      }
      tuneFriendGearText(tab);
    }
    /* 没有 `mc_tab` 就说明素材对不上，让调用方退回 DOM 面板。 */
    return any;
  }
  /* 「查看装备」四格里的文本位置是导出素材里定死的：名字 13 / 主属性 12 / 附加属性 11 /
   * 宝石 11，而行距只有 11.65 —— 对手的装备名和附加属性比原版占位串长，三行会压在一起，
   * 宝石右对齐的那一格还会探到右边那一格。这里只重排文本（不动卡片 / 图标 / 热区）：
   *   · 字号收小：名字 11 / 主属性 10.2 / 附加属性 8.2 / 宝石 9.5；
   *   · 附加属性整体右移 15、下移 12，行距从 11.65 拉到 13.4；
   *   · 宝石右对齐点左收 6，避免压到右边那一格。
   * 数值都是**舞台单位**，随整页缩放；改这一处就能继续回调。 */
  const FRIEND_GEAR_TEXT = {
    name: { size: 11 },
    base: { size: 10.2 },
    addr: { size: 8.2, dx: 15, dy: 12, step: 13.4 },
    stone: { size: 9.5, dx: -6 },
  };
  /* 「查看装备」四格里的装备图标块：原版 `c1` 的放置矩阵是 `0.8` 缩放、x=-2.5；
   * 用户口径「装备图像 ui 稍微往右移动一点」——只给 c1 加一段局部平移，卡片和里面的
   * 画稿一起走，文字列不动。`translate` 在 0.8 缩放之前，2.4 舞台单位约 8px（1280 宽）。 */
  const FRIEND_GEAR_ICON_DX = 2.4;
  function tuneFriendGearText(tab) {
    if (!tab) return;
    const tune = (field, spec) => {
      const clip = clipOf(tab, field);
      /* 文本字段由 renderer 直接存成 `<g type="text">` 元素（没有 `.g`），
       * 精灵 clip 才有 `.g` —— 两种都要接住，否则这里的 nodes 永远是 0。 */
      const g = clip && (clip.g || clip);
      if (!g || !g.querySelectorAll) return;
      const nodes = [...g.querySelectorAll('text')];
      const box = clip.__textBox || g.__textBox;
      nodes.forEach((n, i) => {
        if (spec.size) n.setAttribute('font-size', String(spec.size));
        if (spec.dx) {
          const base = n.__sfBaseX != null ? n.__sfBaseX : (n.__sfBaseX = Number(n.getAttribute('x')) || 0);
          n.setAttribute('x', String(base + spec.dx));
        }
        if (spec.dy || spec.step != null) {
          const base = (box && Number.isFinite(box.base)) ? box.base : (Number(n.getAttribute('y')) || 0);
          const step = spec.step != null ? spec.step : ((box && box.step) || 0);
          n.setAttribute('y', String(base + (spec.dy || 0) + i * step));
        }
      });
    };
    tune('t_name', FRIEND_GEAR_TEXT.name);
    tune('t_base', FRIEND_GEAR_TEXT.base);
    tune('t_addr', FRIEND_GEAR_TEXT.addr);
    tune('stone', FRIEND_GEAR_TEXT.stone);
  }
  function openFriendGearsOverlay() {
    const foe = Friend();
    if (!foe || !current) return;
    const go = () => {
      if (!current || Friend() !== foe) return;
      /* 主路径：原版那一页（4673 f7）。挂载是异步的，挂好之后回填四个格子。 */
      const p = openFriendGearsAsset();
      if (!p) { openFriendGearsDom(); return; }
      if (typeof p.then !== 'function') {                       // 已经有现成的视图
        try {
          T().freezeDescendants(p);
          if (!fillFriendGearTabs(p, foe)) openFriendGearsDom();
          wireFriendGearsBack(p);
        } catch (e) { openFriendGearsDom(); }
        return;
      }
      p.then((view) => {
        if (!view) { openFriendGearsDom(); return; }
        if (current.detail) current.detail.assetView = view;
        try {
          T().freezeDescendants(view);
          if (!fillFriendGearTabs(view, foe)) openFriendGearsDom();
        } catch (e) {
          if (window.__errs) window.__errs.push('friendGears fill: ' + (e && e.message));
          openFriendGearsDom();
        }
        wireFriendGearsBack(view);
      }).catch((e) => {
        if (window.__errs) window.__errs.push('friendGears asset: ' + (e && e.message));
        openFriendGearsDom();
      });
    };
    /* 返回键换成关卡二级页（4756 f5）的原版 `back`（3911）：它和 4673 不在同一个
     * 素材包（tags-challenge），先确保那份包在，再由 wireFriendGearsBack attach。
     * 四格里的装备要走原版 `convertLink` 的预上色符号（整张卡），所以配色表也先拉好；
     * 拉不到时 `fillFriendGearTabs` 仍退回容器画稿，不会空着。 */
    if (window.SfRender && SfRender.loadExtra) {
      Promise.all([
        SfRender.loadExtra('tags-challenge.json').catch(() => {}),
        loadGearColorTable().catch(() => {}),
      ]).then(() => { try { go(); } catch (e) { if (window.__errs) window.__errs.push('friendGears go: ' + (e && e.message)); } });
    } else {
      go();
    }
  }
  /** 「返回」= 回**他的状态页**（`showMainInfo`）：只拆这一层，不拆状态页。 */
  function closeFriendGearPage() {
    destroyItemDetailOnly();
    try { applyTab(); } catch (e) {}
  }
  /** 把 4673 f7 自带那颗**绿色、无名、无点击脚本**的返回键换掉。
   *  它其实是两颗形状（胶囊 3152@d7 + 文字 4599@d9）；这里藏掉它们，改挂关卡二级页
   *  （4756 f5）那颗原版 `back` = **3911**（金胶囊 + 「返回」），并接回上一页。
   *  `3911` 的舞台落点照 4756 f5 的放置矩阵：`(160.3, 175.5)`。 */
  function wireFriendGearsBack(view) {
    if (!view || !view.byName || !view.g) return;
    const oldParts = ['7', '9'].map((d) => view.g.querySelector(':scope > [depth="' + d + '"]')).filter(Boolean);
    let btn = view.__friendBackBtn && view.__friendBackBtn.g ? view.__friendBackBtn : null;
    if (!btn && view.attachChild) {
      const made = view.attachChild('3911', 1, 'friend-back');
      if (made && made.g) {
        btn = view.__friendBackBtn = made;
        btn.g.setAttribute('transform', 'matrix(1,0,0,1,160.3,175.5)');
        btn.g.style.cursor = 'pointer';
        btn.g.style.pointerEvents = 'auto';
        const t = T();
        if (t) {
          try { t.measureHitBox(btn); t.popWrap(btn); } catch (e) {}
          const shell = btn.g.querySelector(':scope > g.uc-pop');
          if (shell) t.wirePopPress(shell);
        }
        btn.g.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeFriendGearPage();
        });
      }
    }
    if (btn) {
      for (const n of oldParts) n.style.display = 'none';
      return;
    }
    /* 兜底：3911 没进包时，绿按钮本身也要能返回上一页（不能点穿到底下状态页的返回键）。 */
    for (const n of oldParts) {
      n.style.display = '';
      n.style.cursor = 'pointer';
      n.style.pointerEvents = 'auto';
      if (n.__fgBack) continue;
      n.__fgBack = true;
      n.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeFriendGearPage(); });
    }
    for (const name of ['button1', 'back']) {
      const c = view.byName(name);
      if (!c || !c.g) continue;
      c.g.style.cursor = 'pointer';
      c.g.style.pointerEvents = 'auto';
      if (c.__fgBack) break;
      c.__fgBack = true;
      c.g.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeFriendGearPage(); });
      break;
    }
  }
  /** 兜底：复刻自研的 DOM 面板（素材对不上 / 挂载失败时用，保证不白屏）。 */
  function openFriendGearsDom() {
    const foe = Friend();
    if (!foe || !current) return;
    const host = detailHost();
    if (!host) return;
    const m = detailMapper(host);
    if (!m) return;
    const b = FRIEND_GEAR_BOX;
    const pos = (r) => 'position:absolute;left:' + m.x(r.x).toFixed(2) + 'px;top:' + m.y(r.y).toFixed(2) + 'px;width:' + m.s(r.w).toFixed(2) + 'px;' +
      (r.h ? 'height:' + m.s(r.h).toFixed(2) + 'px;' : '');
    let dom = host.querySelector('.sf-detail');
    if (!dom) { dom = document.createElement('div'); dom.className = 'sf-detail'; host.appendChild(dom); }
    current.detail = current.detail || {};
    current.detail.dom = dom;
    dom.style.setProperty('--u', m.s(1).toFixed(3) + 'px');
    const byType = [];
    for (const g of (foe.gears || [])) {
      const ty = Number(g && g.type != null ? g.type : (State.gearPart ? State.gearPart(g.id) : NaN));
      if (!Number.isFinite(ty)) continue;
      if (byType[ty] === undefined) byType[ty] = g;
    }
    const C = window.UI && UI.classic;
    const gearName = (g) => (g && C && C.gearName ? C.gearName(Number(g.id)) : ('装备' + (g ? g.id : '')));
    const rows = [0, 1, 2, 3].map((ty) => {
      const g = byType[ty];
      const lv = g ? Math.max(1, Number(g.ext) || 1) : 0;
      return '<li class="' + (g ? '' : 'none') + '">' +
        '<span class="sf-fd-icon gear" data-img="' + (g ? ('images/ui/icons/gear/gear-' + Number(g.id) + '.png') : '') + '"></span>' +
        '<b>' + esc2(g ? gearName(g) : '（未穿戴）') + '</b>' +
        '<i>' + esc2(GEAR_PART_NAME[ty] || '') + (g ? ('　+' + lv) : '') + '</i></li>';
    }).join('');
    const stats = ['力|power', '敏|agility', '速|speed', '命|hp'].map((pair) => {
      const kv = pair.split('|');
      return statRow(kv[0], Math.max(0, Math.round(Number(foe[kv[1]]) || 0)), m);
    }).join('') + statRow('战斗力', totalHarmOf(foe), m);
    dom.innerHTML =
      '<div class="sf-d-panel" style="' + pos(b) + '"></div>' +
      '<div class="sf-fg-head" style="' + pos({ x: b.x + 8, y: b.y + 6, w: b.w - 16, h: 24 }) + '">' +
        '<b>' + esc2(foe.name || '') + '</b><span>Lv' + esc2(foe.level || 1) + '　查看装备</span></div>' +
      '<div class="sf-fg-stats" style="' + pos({ x: b.x + 10, y: b.y + 34, w: b.w - 20, h: 20 }) + '">' + stats + '</div>' +
      '<div class="sf-fg-label" style="' + pos({ x: b.x + 12, y: b.y + 58, w: 60, h: 14 }) + '">身上穿的</div>' +
      '<ul class="sf-fg-list" style="' + pos({ x: b.x + 10, y: b.y + 74, w: b.w - 20, h: 60 }) + '">' + rows + '</ul>' +
      '<button class="sf-d-back" style="' + pos({ x: b.x + (b.w - 76) / 2, y: b.y + b.h - 24, w: 76, h: 18 }) + '">返回</button>';
    for (const box of dom.querySelectorAll('.sf-fd-icon')) {
      const img = box.getAttribute('data-img');
      if (img) box.innerHTML = '<img alt="" src="' + img + '">';
    }
    const bk = dom.querySelector('.sf-d-back');
    if (bk) bk.addEventListener('click', () => { destroyItemDetailOnly(); try { applyTab(); } catch (e) {} });
  }
  /** 对手的战斗力（原版 `user.totalharm`）：所有武器伤害上限之和 —— 与挑战页同一份算法。 */
  function totalHarmOf(foe) {
    let sum = 0;
    for (const w of (foe && foe.weapons) || []) {
      try { const inst = State.weaponInst(w); if (inst) sum += Number(inst.harmHi) || 0; } catch (e) {}
    }
    return sum;
  }

  /* ============================================================
   * 「更换装备」= 原版那一页（库元件「状态1」= 4673 的第 3 帧）
   * ------------------------------------------------------------
   * 原版 `showEquipsWin()`（MainMovie.as:22088-22094）：
   *   `loadMcs([["状态1","subFrame",currentFrame]]); subFrame.gotoAndStop(3);
   *    showEquips(pageNum1); showWears();`
   * 它是**盖在状态页上面的一层** —— 页根 7218 不动，退出走 `clearCurrentWin()` 只拆这一层
   * （`state == 4` 时按返回键 → `setState(zhuangtai.originalState); clearCurrentWin()`）。
   * 所以复刻不复用 `js/classic-ui.js` 的 `openGears()`（那是现代模式那套 DOM 弹窗），
   * 而是在这里按同一套覆盖层机制挂**原版帧**。
   *
   * 第 3 帧的具名元件（`node out/frame-raw.cjs 4673 3` 实测）：
   *   `t_count`(4556) 容量 / `mc_body`·`mc_head`·`mc_hand`·`mc_foot` 四个部位 /
   *   `c1`..`c6`(4547) 六个格子 / `left`·`right`(3156) 翻页 / `back`(3644) /
   *   `icon1`..`icon6`(4563) 已穿戴的小勾 / `t_1`..`t_6`(4564-4569) 装备名。
   *   ⚠ **`c1` 这个名字在导出里丢了**：深度 33 那条放置没有 `na`，其余 5 格都有 ——
   *     所以第 1 格按**深度**认（`GEAR_CELL_DEPTHS`），`byName('c1')` 是取不到的。
   * 逐条照 `showEquips(num)` / `showWears()`：
   *   · 每格挂 `convertLink(装备)` 的容器（复刻这边 = `containerIds[type][0]` + `wearInfo` 的帧号）；
   *   · `t_{i}` 写装备名、并**按品质改字色**（`setEquipTextColor` 的 6 档原值）；
   *   · `icon{i}`：`gotoAndStop(1)` = 已穿戴 / `(2)` = 未穿戴（那颗 3 帧，1 是小勾、2/3 是空）；
   *   · `t_count` = "容量N/M"；
   *   · 四个部位**压到 85%**（`showWears()` 的 `_xscale = _yscale = 85`，与状态页 `showFace` 不同）；
   *   · `left`/`right`：`num > 1` / `num < pageCount1` 才 `_visible = true`。
   * ⚠ `t_1`..`t_6` 的框只有 54~57 个单位宽、字号 12 → **一行只放得下 4 个全角字**
   *   （`textfields-index.json` 实测 `charsPerLine: 4`）。`SfRender.setText` 只按 `\n` 断行、
   *   不管框宽，所以超过 4 个字的名字必须**自己折行**，否则会被横向裁掉。
   * ========================================================== */
  const GEAR_FRAME_LIST = 3, GEAR_FRAME_DETAIL = 4;
  const GEAR_PAGE_SIZE = 6;
  const GEAR_CELL_DEPTHS = [33, 35, 37, 39, 41, 43];
  /* `showWears()`（:22095）的部位表：`[mc_head, mc_hand, mc_body, mc_foot]` ← 类型 0/1/2/3。
   * 画稿缩放**不照抄**那一句 `_xscale = _yscale = 85`：原版真正的落地走
   * `convertMcToBp` 位图化（见 `fitArtwork` 的注释），照抄 0.85 会让装备盖住整页。 */
  const GEAR_DOLL_PARTS = [['mc_head', 0], ['mc_hand', 1], ['mc_body', 2], ['mc_foot', 3]];
  /* `setEquipTextColor`（:16087-16113）的 6 档原值（十进制 → 十六进制）。 */
  const GEAR_QUALITY_COLOR = ['#542201', '#65a844', '#2365c9', '#6544a8', '#ff9900', '#000000'];
  /* `doShowEquipInfo`（:7926-7945）的部位文案 —— 注意这里叫「手部」，与状态页的 `GEAR_PART_NAME` 不同。 */
  const GEAR_DETAIL_PART = ['头部', '手部', '身体', '脚部'];
  /* `t_1..t_6` 一行放得下几个全角字（见上面那段说明）。 */
  const GEAR_NAME_COLS = 4;
  let gearPage = null;      // { host, view, page, detail }

  /* ---- 勇者模式：经典「更换装备」页的数据源 ----
   * 用户 2026-10-24 口径：勇者的换装页就是**玩家自己的更换装备页**（4673 第 3 帧），
   * 装备也用经典装备 UI；区别只有两点：
   *   ① 列表是**全部 288 件**，按稀有度 → 套装 → 部位排，不是玩家的背包；
   *   ② 所有装备的主属性 / 附加属性 / 宝石一律 0 加成，只改变外观。
   * 这里把 `hero.gearList`（tower-ui 的 `heroGearCatalog()` 摊平结果）补成 `State.gearInst`
   * 那种完整对象，并把数值字段清零；列表 / 详情 / 纸娃娃都复用玩家页的绘制函数。 */
  function heroGearSlots() {
    const hero = Hero();
    const slots = [0, 0, 0, 0];
    for (const raw of ((hero && hero.appearance) || [])) {
      const item = (raw && typeof raw === 'object') ? raw : { id: Number(raw) };
      const id = Number(item.id);
      if (!(id > 0)) continue;
      let type = Number.isFinite(Number(item.type)) ? Number(item.type) : NaN;
      if (!Number.isInteger(type) && window.State && State.gearPart) type = Number(State.gearPart(id));
      if (Number.isInteger(type) && type >= 0 && type <= 3 && !slots[type]) slots[type] = id;
    }
    return slots;
  }
  function heroGearRows() {
    const hero = Hero();
    if (!hero) return [];
    const slots = heroGearSlots();
    const sig = slots.join(',');
    if (hero.__gearRowsSig === sig && Array.isArray(hero.__gearRows)) return hero.__gearRows;
    const worn = new Set(slots.filter((id) => id > 0).map(Number));
    const base = Array.isArray(hero.gearList) ? hero.gearList : [];
    const rows = base.map((it) => {
      const id = Number(it && it.id);
      let inst = null;
      try { inst = (id > 0 && State.gearInst) ? State.gearInst(id) : null; } catch (e) { inst = null; }
      const g = Object.assign({}, inst || {}, it || {});
      g.key = 'hero:' + id;
      g.id = id;
      g.type = Number(it && it.type != null ? it.type : g.type);
      if (!Number.isFinite(g.type) && State.gearPart) g.type = Number(State.gearPart(id));
      g.quality = Math.max(0, Math.min(5, Number(it && it.quality != null ? it.quality : g.quality) || 0));
      g.setId = Number(it && it.setId != null ? it.setId : g.setId) || 0;
      g.name = String((it && it.name) || g.name || '');
      g.attrName = String((inst && inst.attrName) || g.attrName || '');
      g.useLevel = Math.max(1, Number((inst && inst.useLevel) || g.useLevel) || 1);
      /* 勇者模式的外观件：主属性 / 附加属性 / 宝石全部 0。 */
      g.abilityVal = 0;
      g.ext = [];
      g.gem = null;
      g.used = worn.has(id);
      return g;
    }).filter((g) => Number(g.id) > 0 && Number.isInteger(Number(g.type)));
    hero.__gearRows = rows;
    hero.__gearRowsSig = sig;
    return rows;
  }
  /** 在勇者装备页里穿 / 脱一件外观；回调把最终外观交回 tower-ui（本局草稿或 run.hero）。 */
  function heroGearEquip(id, equip) {
    const hero = Hero();
    if (!hero) return false;
    const gearId = Number(id);
    const rows = heroGearRows();
    const target = rows.find((g) => Number(g.id) === gearId);
    if (!target) return false;
    const slots = heroGearSlots();
    const type = Number(target.type);
    if (!Number.isInteger(type) || type < 0 || type > 3) return false;
    if (equip) slots[type] = gearId;
    else if (Number(slots[type]) === gearId) slots[type] = 0;
    const next = [];
    for (const slotId of slots) {
      if (!(slotId > 0)) continue;
      const g = rows.find((x) => Number(x.id) === Number(slotId));
      if (g) next.push({ id: g.id, type: g.type, quality: g.quality, ext: [] });
    }
    const out = typeof hero.onEquip === 'function' ? hero.onEquip(next) : next;
    if (Array.isArray(out)) hero.appearance = out;
    /* 换装层是盖在状态页上的，底页一直开着：立绘（`fillValues`）和右上角
     * 「出发准备」卡里的**外观 X / 4**（`refreshHeroChrome`）都要当场重算。
     * 以前这里只调 `fillValues`，外观那一格要等切页 / `SfStatus.refresh()` 才更新，
     * 玩家看到的就是"刚穿上装备，外观还是 0 / 4"。 */
    try {
      if (current && current.view) {
        fillValues(current.view);
        refreshHeroChrome();
      }
    } catch (e) {}
    return true;
  }
  function gearListOf() {
    if (heroView()) return heroGearRows();
    try { return State.gearsInDisplayOrder ? State.gearsInDisplayOrder() : State.myGears() || []; } catch (e) { return []; }
  }
  /** 身上穿的（原版 `getMyWearList()`：按类型取第一件 `isWear == "true"` 的）。 */
  function gearWornOf() {
    const out = [null, null, null, null];
    if (heroView()) {
      const rows = heroGearRows();
      heroGearSlots().forEach((id, type) => {
        if (!(id > 0)) return;
        out[type] = rows.find((g) => Number(g.id) === Number(id)) ||
          { id: Number(id), type: type, quality: 0, ext: [] };
      });
      return out;
    }
    try {
      for (const g of (State.myGears() || [])) {
        const ty = Number(g.type);
        if (g.used && ty >= 0 && ty < 4 && !out[ty]) out[ty] = g;
      }
    } catch (e) {}
    return out;
  }
  function gearNameText(g) {
    const C = window.UI && UI.classic;
    let fallback = '';
    try {
      if (C && C.gearName) {
        const name = C.gearName(Number(g.id));
        /* hero 外观池里 q5 黑装上位 / 深海·机器猫 q3 不在 gearMap，
         * 经典 `gearName` 会退回「装备<id>」；这时优先用 heroGearRows 带进来的真名，
         * 真名也没有（字典缺条目）才保留原来的「装备N」兜底。 */
        if (name && !/^装备\s*\d+$/.test(String(name))) return name;
        fallback = String(name || '');
      }
    } catch (e) {}
    return String((g && g.name) || '') || fallback;
  }
  /** 装备名折行：`t_1..t_6` 一行 4 个字，最多两行（框高 28 ≈ 两行 12 号字）。 */
  function gearNameLines(name) {
    const s = String(name == null ? '' : name);
    if (s.length <= GEAR_NAME_COLS) return s;
    const lines = [];
    for (let i = 0; i < s.length && lines.length < 2; i += GEAR_NAME_COLS) lines.push(s.slice(i, i + GEAR_NAME_COLS));
    return lines.join('\n');
  }
  /** 改一个文本字段的字色（`setEquipTextColor`）。必须在 `setText` **之后**调 ——
   *  `setText` 会重建 `<text>` 子节点，颜色会跟着回到导出里的原值。 */
  function setGearTextColor(node, quality) {
    const g = node && (node.g || node);
    if (!g || !g.querySelectorAll) return;
    const color = GEAR_QUALITY_COLOR[Math.max(0, Math.min(5, Number(quality) || 0))];
    for (const t of g.querySelectorAll('text')) t.setAttribute('fill', color);
  }
  /* ============================================================
   * **容器画稿**的兜底落地：等比缩放到格子里、居中
   * ------------------------------------------------------------
   * 预上色整卡符号不走这里（原版 1:1 挂；见 `gearArtIn`）。这里只处理
   * `gearColorId` 查不到符号时退回的通用容器画稿。原版这一页/这一格的观感是
   * "每格里那件装备一样大、居中，下面压着卡片自带的阴影"
   * （对照 `references/screen/屏幕截图 2026-09-23 161816.png` 与 `…162302.png` 两张原版截图：
   *  六个格子与四个部位格里，靴子/拳套/头盔/铠甲都恰好装进卡片、居中）。
   * 原版的机制是 `constructBpData` → `convertMcToBp(容器)` 渲染成**位图** → `attachBitmap`
   * （MainMovie.as:6643-6646 / :6790），而 `convertMcToBp` 在反编译出的 4551 个 `.as` 里
   * **没有定义**（只在 :6646 与 :6790 被调用）—— 位图的锚点与缩放比无法从源码还原，
   * 只能按原版截图反推。直接 `attachMovie(容器)` 是不行的：容器画稿是**按角色尺度**画的
   *（头部容器局部包围盒约 120×76，还偏在原点左上方），贴进 34~41 个单位的卡片里会糊掉整页
   *（2026-10 实拍：一件头饰盖住六个格子）。
   * 做法：量出容器的**局部**包围盒，按"装进 `box` 见方"的比例缩放，再把包围盒中心平移到
   * 卡片中心 `(cx, cy)`。`translate(c - s*m) scale(s)` —— 局部包围盒中心 `m` 正好落到 `c`。
   * 量不到包围盒（还没进文档）时下一帧重试一次，与 `render.js` 的 `anchorToBBox` 同一套路。
   * ========================================================== */
  function fitArtwork(clip, box, cx, cy, retry) {
    if (!clip || !clip.setExtraTransform || !clip.g) return false;
    clip.setExtraTransform('');
    let b = null;
    try { b = clip.g.getBBox(); } catch (e) { b = null; }
    if (!b || !(b.width > 0) || !(b.height > 0)) {
      if (!retry && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { try { fitArtwork(clip, box, cx, cy, true); } catch (e) {} });
      }
      return false;
    }
    const s = Math.min(box / b.width, box / b.height);
    const mx = b.x + b.width / 2, my = b.y + b.height / 2;
    clip.setExtraTransform('translate(' + (cx - s * mx).toFixed(2) + ',' + (cy - s * my).toFixed(2) +
      ') scale(' + s.toFixed(4) + ')');
    return true;
  }
  /* 卡片自己有多大（导出实测：格子 `4547`/`3636` 都是 41.3 见方、部位格 `4559`~`4562` 是 34.1 见方，
   * 原点都在卡片左上角）—— 所以"卡片中心"是 20.65 / 17.05。
   * 这两个数只给**容器画稿兜底**用（见 `fitArtwork`）：预上色符号自带卡面，不需要再缩。 */
  const GEAR_CARD = 41.3, GEAR_CARD_ART = 34;
  const GEAR_SLOT_CARD = 34.1, GEAR_SLOT_ART = 29;
  const GEAR_CARD_MID = GEAR_CARD / 2, GEAR_SLOT_MID = GEAR_SLOT_CARD / 2;
  /* 装备卡里的画稿 = **原版按品质预上色的库元件**（`convertLink(equip)`，MainMovie.as:16114）。
   * 原版 `showEquips` / `showWears` / 详情 `c1` 都是 `attachMovie(convertLink(gear))` ——
   * 颜色**画在元件里**，不是拿通用容器再叠染色。复刻以前贴现代界面正面 PNG（紫/橙靠滤镜），
   * 用户 2026-11 口径："不要用现代版 UI，经典版统一调用经典版矢量图"。
   * ⚠ 这些符号是**整张卡**，不是单纯一件装备的画稿：第一层就是 41×41 见方的卡面
   * （浅色底 + 金边 + 斜光），里面才是阴影和预上色装备。原版 `showEquips` / 详情 `c1`
   * 都按 1:1 挂在 `(0,0)` 上，正好盖住格子自己的卡面；`showWears` 只把**部位容器**
   * 缩到 85%（所以那颗图标实际是 41×0.85≈35）。复刻 2026-11 把符号当成"装备画稿"
   * 又 `fitArtwork` 缩到 34 / 29，等于在格子卡面上再贴一张小卡（双层卡、装备变小）。
   * `gear-colors.json` 是生成器按原版规则算好的 `byGear[id][品质][强化档] → 元件号`，
   * 这里只查表；查不到（老包 / 缺符号）才退回原来的通用容器画稿。 */
  const GEAR_COLOR_FILE = 'images/ssfight/ui/gear-colors.json';
  let gearColorTable = null;
  let gearColorLoading = null;
  async function loadGearColorTable() {
    if (gearColorTable !== null) return gearColorTable;
    /* 两处同时打开（列表 + 详情快速切换）时共用同一次加载，别让后一次看到空表。 */
    if (gearColorLoading) return gearColorLoading;
    gearColorLoading = (async () => {
      const table = {};
      try {
        await SfRender.loadExtra('tags-gear-color.json');
        const r = await fetch(GEAR_COLOR_FILE, { cache: 'force-cache' });
        if (r && r.ok) {
          const j = await r.json();
          if (j && j.byGear) return j;
        }
      } catch (e) { /* 素材没生成时退回通用容器 */ }
      return table;
    })();
    try { gearColorTable = await gearColorLoading; }
    finally { gearColorLoading = null; }
    return gearColorTable;
  }
  /** 装备实例的强化档：原版取 `max(addr1Lv,addr2Lv,addr3Lv)`（没强化按 1）。 */
  function gearExtMaxLevel(gear) {
    let max = 0;
    for (const e of (Array.isArray(gear && gear.ext) ? gear.ext : [])) {
      max = Math.max(max, Number(e && e.level) || 0);
    }
    return Math.max(0, Math.min(3, max));
  }
  function gearColorId(gear) {
    if (!gear || !gearColorTable || !gearColorTable.byGear) return null;
    const table = gearColorTable.byGear[String(gear.id)];
    if (!table) return null;
    /* 橙装是实例级 quality 4；黑套装（46/47/67~72）的 quality 是 5。 */
    const q = gear.orange === true ? 4 : Math.max(0, Math.min(5, Number(gear.quality) || 0));
    const levels = table[String(q)];
    if (!levels) return null;
    /* 头 / 手套的强化档：黑套（q5）里 46/47/67~72 只有无数字的 `<名字>黑`，
     * 其余黑套（格斗…诅咒）和紫 / 橙一样有 `<名字>黑1~3`；缺档时下面统一回退到 '0'。 */
    const lv = ((Number(gear.type) === 0 || Number(gear.type) === 1) && q > 1)
      ? gearExtMaxLevel(gear) : 0;
    return levels[String(lv)] || levels['0'] || levels['1'] || levels['2'] || levels['3'] || null;
  }
  /** 把一件装备的**预上色整卡**直接挂到某个格子上（1:1，不 fit）。
   *  融合结果页（4402 f44 的 `c1`）与「我的装备」是同一颗 `convertLink` 符号；
   *  供 `ui-compose.js` 复用，查不到符号（老包 / 缺品质）时返回 false 让调用方退回 PNG。 */
  function paintGearCard(cell, gear) {
    try {
      if (!cell || !cell.attachChild || !gear) return false;
      const g = Object.assign({}, gear);
      if (g.type == null) g.type = State.gearPart ? State.gearPart(Number(g.id)) : NaN;
      if (g.quality == null) g.quality = State.gearQuality ? State.gearQuality(gear) : 0;
      const sid = gearColorId(g);
      if (!sid) return false;
      if (cell.detachAll) cell.detachAll();
      return !!cell.attachChild(String(sid), 1, 'gear');
    } catch (e) { return false; }
  }
  /** 查不到预上色符号时的容器画稿兜底（见 `fitArtwork`）。 */
  function gearFallbackArt(cell, gear, box, cx, cy) {
    const info = wearInfo(gear);
    const sym = containerIds && containerIds[Number(gear.type)] && containerIds[Number(gear.type)][0];
    if (!info || !sym || !cell || !cell.attachChild) return null;
    const child = cell.attachChild(sym, info.frame, 'wear');
    if (child) fitArtwork(child, box, cx, cy);
    return child;
  }
  /** 把一件装备的画稿放进卡片 / 部位格：优先原版预上色符号，缺符号才退回容器。
   *  预上色符号是**整张卡**，按原版挂法 1:1 挂在 `(0,0)`（`showWears` 的四个格再乘 85%）；
   *  只有兜底的容器画稿才走 `fitArtwork` 缩进卡片。 */
  function gearArtIn(cell, gear, box, cx, cy, iconScale) {
    if (!cell || !cell.attachChild || !gear) return null;
    const sid = gearColorId(gear);
    if (sid) {
      const clip = cell.attachChild(String(sid), 1, 'gear');
      if (clip) {
        const s = Number(iconScale);
        if (Number.isFinite(s) && s > 0 && s !== 1) clip.setExtraTransform('scale(' + s + ')');
        return clip;
      }
    }
    return gearFallbackArt(cell, gear, box, cx, cy);
  }
  /** 一个元件在**父级坐标系**里的包围盒。
   *  `getBBox()` 量的是元素自己的用户空间，要乘上它自己的放置矩阵（`__baseMa`）才换算到父级。 */
  function boxInParent(clip) {
    if (!clip || !clip.g || !clip.g.getBBox) return null;
    let b = null;
    try { b = clip.g.getBBox(); } catch (e) { return null; }
    if (!b || !b.width || !b.height) return null;
    const m = String(clip.g.__baseMa || '').split(',').map(Number);
    const k = (m.length === 6 && isFinite(m[0]) && m[0]) ? Math.abs(m[0]) : 1;
    return { x: b.x * k, y: b.y * k, w: b.width * k, h: b.height * k };
  }
  /** 把一件装备的容器画稿按"卡片多大"等比缩放并居中（见 `fitArtwork` 的注释：
   *  原版这一步走 `convertMcToBp` 位图化，而那个函数在反编译源码里没有定义，只能按卡片尺寸反推）。
   *  `boxClip` 给的是卡片本身的元件（格子 / 空格底），量不到就退回给定尺寸。 */
  function fitIntoCard(card, child, boxClip, ratio, fallback) {
    if (!card || !child) return;
    const b = boxInParent(boxClip);
    const w = (b && b.w) ? b.w : (fallback || GEAR_CARD);
    const h = (b && b.h) ? b.h : (fallback || GEAR_CARD);
    const cx = b ? b.x + b.w / 2 : w / 2;
    const cy = b ? b.y + b.h / 2 : h / 2;
    fitArtwork(child, ratio * Math.min(w, h), cx, cy);
  }
  /** 第 i 格（0 基）。第 1 格没有实例名，按深度取（见上面那段注释）。 */
  function gearCell(i) {
    const view = gearPage && gearPage.view;
    if (!view) return null;
    const named = clipOf(view, 'c' + (i + 1));
    if (named) return named;
    const rec = view.nodes && view.nodes.get(GEAR_CELL_DEPTHS[i]);
    return (rec && rec.clip) || null;
  }
  /* 「刚拿到的装备」焦点：融合产物是**追加**到 S.gears 末尾的，而这一页按
   * 「穿着中 > 获得顺序」排、每页只有 6 格、每次打开都从第 1 页开始 ——
   * 于是玩家融合完再从状态页进「更换装备」时，新装备其实躺在**最后一页**，
   * 屏幕上根本看不到，反馈就是「融合完找不到装备了」。
   * 这里记一个待聚焦的 key：下次打开这一页直接翻到它所在的那一页并高亮那一格。 */
  let pendingGearFocus = null;

  function gearPageHost() {
    if (gearPage && gearPage.host && gearPage.host.isConnected) return gearPage.host;
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const el = document.createElement('section');
    el.className = 'classic-home ssfight-home ssfight-sub ssfight-view';
    el.setAttribute('aria-label', '我的装备');
    ui.appendChild(el);
    return el;
  }
  /** 拆掉「更换装备」这一层（不动底下的状态页，也不重画它）。 */
  function destroyGearPage() {
    const rec = gearPage;
    gearPage = null;
    /* 高亮只服务「刚打开这一页」的那一眼，关掉就清掉（待聚焦标记也一并清）。 */
    pendingGearFocus = null;
    if (!rec) return;
    if (rec.view) { try { rec.view.destroy(); } catch (e) {} }
    if (rec.host && rec.host.parentNode) rec.host.parentNode.removeChild(rec.host);
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
  }
  /** 回状态页（原版 `clearCurrentWin()` + `setState(zhuangtai.originalState)`）。 */
  function closeGearPage() {
    destroyGearPage();
    try {
      const v = current && current.view;
      if (v && v.setStaticPolicy) T().setStaticPolicy(v, {});
      if (current && current.view) fillValues(current.view);
      if (heroView()) refreshHeroChrome();
    } catch (e) {}
  }
  /** 挂第 3 帧（列表）或第 4 帧（详情）。两页共用同一个宿主，来回切就是"换一层"。 */
  async function mountGearFrame(frame) {
    /* 预上色装备符号包按需加载：只有真进「更换装备 / 详情」才拉（1.7 MB）。 */
    try { await loadGearColorTable(); } catch (e) {}
    const host = gearPageHost();
    if (!host) return null;
    if (!gearPage) gearPage = { host: host, view: null, page: 0 };
    else gearPage.host = host;
    if (gearPage.view) { try { gearPage.view.destroy(); } catch (e) {} gearPage.view = null; }
    while (host.firstChild) host.removeChild(host.firstChild);
    const view = await SfRender.mountSymbol(host, '4673', {
      frame: frame, label: frame === GEAR_FRAME_DETAIL ? '装备详情' : '我的装备',
    });
    if (!gearPage || gearPage.host !== host || host.isConnected === false) { view.destroy(); return null; }
    /* 这一页是**静态页**：多帧元件出生即冻结，按钮的帧由下面 `wireClickable` 自己拨。 */
    T().freezeDescendants(view);
    gearPage.view = view;
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    return view;
  }
  /** 把当前页的 6 格 + 纸娃娃 + 容量 + 翻页箭头填好（逐条照 `showEquips` / `showWears`）。 */
  function fillGearPage(view) {
    if (!view || !gearPage) return;
    const t = T();
    const list = gearListOf();
    const pages = Math.max(1, Math.ceil(list.length / GEAR_PAGE_SIZE));
    gearPage.page = Math.max(0, Math.min(Math.max(0, gearPage.page), pages - 1));
    const page = gearPage.page;
    let shown = 0;
    for (let i = 0; i < GEAR_PAGE_SIZE; i++) {
      const g = list[page * GEAR_PAGE_SIZE + i] || null;
      const cell = gearCell(i);
      const label = clipOf(view, 't_' + (i + 1));
      const icon = clipOf(view, 'icon' + (i + 1));
      /* 刚融合出来的那一格：金色呼吸描边（CSS `.sf-gear-new`），一眼能找到。 */
      if (cell && cell.g && cell.g.classList) {
        cell.g.classList.toggle('sf-gear-new', !!(gearPage.highlight && g && String(g.key) === String(gearPage.highlight)));
      }
      /* `icon{i}`：第 1 帧 = 已穿戴的小勾 / 第 2 帧 = 空（`showEquips` 先把 6 格全拨到 2）。 */
      stopAt(icon, g && g.used ? 1 : 2);
      if (t && label) t.setText(label, g ? gearNameLines(gearNameText(g)) : '');
      if (label) setGearTextColor(label, g ? g.quality : 0);
      if (cell) cell.__gearKey = g ? String(g.key) : null;
      if (g) shown++;
      /* 格子本体保持第 1 帧（卡片），有装备时把原版预上色符号挂上去
       * （= 原版 `attachMovie(convertLink(...))`）。 */
      if (!cell || !cell.detachAll) continue;
      cell.detachAll();
      /* 热区按**卡片自己**量（挂上容器之后量会把装备轮廓算进去，
       * 相邻两格的装备图一大就互相抢命中 —— 原版选中的是格子，不是格子里的图）。 */
      delete cell.__hitBox;
      if (t && t.measureHitBox) t.measureHitBox(cell);
      if (!g) continue;
      gearArtIn(cell, g, GEAR_CARD_ART, GEAR_CARD_MID, GEAR_CARD_MID);
    }
    /* 纸娃娃：`showWears()` 把四件"穿着中"的**预上色符号**挂到四个部位上
     * （原版同样是 `attachMovie(convertLink(装备))`，不是通用容器）。
     * ⚠ 部位格自己只有**一帧**（`buildFrames` 只切出 1 帧：`4558` + `tp:1` + 尾部的 remove），
     * 卡面与「头部/手部/身体/脚部」那几个字都是**同一张 34.1 见方的画稿**烤进去的 ——
     * 所以"穿上之后不显示部位名"只能靠**画稿盖住**（原版也是这个效果：那四格只有装备、
     * 看不到部位名）。原版 `showWears` 把部位容器 `_xscale = _yscale = 85`，符号随之是
     * 41×0.85≈35——比 34.1 的格子略大，正好盖住卡面；这里给符号乘同一个 0.85。 */
    const worn = gearWornOf();
    for (const pair of GEAR_DOLL_PARTS) {
      const clip = clipOf(view, pair[0]);
      if (!clip || !clip.detachAll) continue;
      clip.detachAll();
      const g = worn[pair[1]];
      if (!g) continue;
      gearArtIn(clip, g, GEAR_SLOT_ART, GEAR_SLOT_MID, GEAR_SLOT_MID, 0.85);
    }
    setTextByName(view, 't_count', heroView()
      ? ('外观' + list.length + '件')
      : ('容量' + list.length + '/' + State.gearCapacity()));
    /* 顶部那句提示（4673 f3 深度 85，没有实例名）：玩家页保留原版「附加属性不叠加」，
     * 勇者页改成「只改变造型、全部 0 加成」—— 装备数值在这里被清零，不能再让玩家误会。
     * 这颗文本字段没有 `na`、也不在 `view.nodes` 的具名表里，直接按 SVG 文本内容改。 */
    if (heroView() && view.root && view.root.querySelectorAll) {
      for (const node of view.root.querySelectorAll('text')) {
        if (String(node.textContent || '').indexOf('附加属性效果不叠加') >= 0) {
          node.textContent = '外观装备只改变造型，全部属性 0 加成！';
        }
      }
    }
    /* `left`/`right`：不可翻时原版是 `_visible = false`（不是切禁用帧）。 */
    const canPrev = page > 0, canNext = page < pages - 1;
    stopAt(clipOf(view, 'left'), canPrev ? 1 : 2);
    stopAt(clipOf(view, 'right'), canNext ? 1 : 2);
    setVisible(clipOf(view, 'left'), canPrev);
    setVisible(clipOf(view, 'right'), canNext);
    void shown;
  }
  /** 接线：6 个格子（点开详情）+ 翻页 + 返回。换帧重建后要重接，所以每次都走一遍。 */
  function wireGearPage(view) {
    const t = T();
    if (!t || !view || !gearPage) return;
    for (let i = 0; i < GEAR_PAGE_SIZE; i++) {
      const cell = gearCell(i);
      if (!cell || !cell.g) continue;
      const key = cell.__gearKey;
      if (!key) {
        t.unregisterHit(cell);
        cell.g.style.cursor = 'default';
        cell.g.style.pointerEvents = 'none';
        continue;
      }
      if (!cell.__gearWired) {
        cell.__gearWired = true;
        cell.g.addEventListener('click', (e) => {
          e.stopPropagation();
          if (cell.__gearKey) openGearDetail(cell.__gearKey);
        });
      }
      t.measureHitBox(cell);
      t.popWrap(cell);
      const shell = cell.g.querySelector(':scope > g.uc-pop');
      if (shell) t.wirePopPress(shell);
      /* ⚠ 光标与 `pointer-events` 必须排在 `popWrap()` **之后**：`popWrap` 把内容搬进
       * `g.uc-pop` 壳里时会把这颗 `g` 的 `pointer-events` 覆写成别的值，先设等于没设 ——
       * 表现就是"格子看得见、鼠标放上去有样式，但真机点不动"。走 `dispatchEvent` 的回归用例
       * 绕过命中测试，抓不到这一类问题（2026-11 在融合材料卡上实测到同一条）。 */
      cell.g.style.cursor = 'pointer';
      cell.g.style.pointerEvents = 'auto';
      raiseAttached(cell);
    }
    wireClickable(clipOf(view, 'left'), {
      hover: 0, press: 0, idle: () => (gearPage && gearPage.page > 0 ? 1 : 2),
      onFire: () => { if (gearPage && gearPage.page > 0) { gearPage.page--; renderGearPage(); } },
    });
    wireClickable(clipOf(view, 'right'), {
      hover: 0, press: 0,
      idle: () => {
        const pages = Math.max(1, Math.ceil(gearListOf().length / GEAR_PAGE_SIZE));
        return (gearPage && gearPage.page < pages - 1) ? 1 : 2;
      },
      onFire: () => {
        const pages = Math.max(1, Math.ceil(gearListOf().length / GEAR_PAGE_SIZE));
        if (gearPage && gearPage.page < pages - 1) { gearPage.page++; renderGearPage(); }
      },
    });
    wireClickable(clipOf(view, 'back'), { hover: 2, onFire: closeGearPage });
  }
  function renderGearPage() {
    if (!gearPage || !gearPage.view) return;
    fillGearPage(gearPage.view);
    wireGearPage(gearPage.view);
  }
  /* ---------- 装备详情 = 4673 的第 4 帧（`showEquipInfoWin` / `doShowEquipInfo`）----------
   * 原版把详情挂成**第二颗**库元件（`subFrame1`，:7890），盖在列表那一页上面；
   * 复刻这边两页都只占满整屏，所以直接**换这一层的时间轴**，返回时再挂回第 3 帧 —— 观感一致，
   * 也省掉"两层各自维护播放表"的复杂度。 */
  const GEAR_GEM_COST_NOTE = '宝石：镶嵌 / 卸下各 5 金松果';
  /** 橙装 / 黑装都可镶嵌；旧的最小 State 桩没有 canSocketGem 时退回 quality>3。 */
  const canSocketGear = (gear) => (State.canSocketGem ? State.canSocketGem(gear) : Number(gear && gear.quality) > 3);
  function currentGearByKey(key) {
    if (heroView()) return heroGearRows().find((g) => String(g.key) === String(key)) || null;
    try { return (State.myGears() || []).find((g) => String(g.key) === String(key)) || null; } catch (e) { return null; }
  }
  async function openGearDetail(key) {
    const g = currentGearByKey(key);
    if (!g) return;
    const view = await mountGearFrame(GEAR_FRAME_DETAIL);
    if (!view) return;
    if (gearPage) gearPage.detail = String(key);
    fillGearDetail(view, g);
    wireGearDetail(view, String(key));
  }
  /** 逐条照 `doShowEquipInfo()`（:7895-7972）。 */
  function fillGearDetail(view, g) {
    const t = T();
    const hero = Hero();
    const ty = Math.max(0, Math.min(3, Number(g.type) || 0));
    /* `b_on`：`isWear == "true"` → 第 2 帧（已穿 → 按下去是"卸下"），否则第 1 帧。 */
    stopAt(clipOf(view, 'b_on'), g.used ? 2 : 1);
    /* `b1`：橙装 / 黑装（quality > 3）才有宝石键 —— 有宝石停第 2 帧（= 已镶嵌）、没有停第 1 帧（= 镶嵌）；
     * 非橙装停第 3 帧（原版 `showStone = false`，那一档是灰的）。
     * ⚠ 外层 `b1`（4590）的第 2 帧只是**换成另一颗带「已镶嵌」字样的按钮**（内层 4589），
     * 绿色高亮档在内层按钮自己的第 2 帧（3152 绿底）；只拨外层会得到一张灰/米色的
     * 「已镶嵌」——用户 2026-10 口径："已镶嵌那个位置选中后要变绿"。
     * 勇者模式没有宝石 / 出售：两颗键整颗藏掉，只留「装备 / 卸下」与「返回」。 */
    const b1 = clipOf(view, 'b1');
    const sell = clipOf(view, 'b_sell');
    if (b1 && b1.g) b1.g.style.display = hero ? 'none' : '';
    if (sell && sell.g) sell.g.style.display = hero ? 'none' : '';
    if (!hero) {
      const canGem = canSocketGear(g);
      stopAt(b1, canGem ? (g.gem ? 2 : 1) : 3);
      if (canGem && b1 && b1.byName) {
        const inner = b1.byName('b1');
        if (inner) stopAt(inner, g.gem ? 2 : 1);
      }
    }
    const name = clipOf(view, 't_name');
    if (t && name) t.setText(name, gearNameText(g));
    setGearTextColor(name, g.quality);
    setTextByName(view, 'type', GEAR_DETAIL_PART[ty]);
    setTextByName(view, 'level', hero ? '不限' : Math.max(1, Math.round(Number(g.useLevel) || 1)));
    setTextByName(view, 'base', hero ? '0 加成'
      : (String(g.attrName || '') + '+' + Math.max(0, Math.round(Number(g.abilityVal) || 0))));
    if (hero) {
      setTextByName(view, 'baseExtra', '');
      setTextByName(view, 'baseOther', '');
      setTextByName(view, 'baseOtherExtra', '');
    } else {
      /* `baseExtra`：宝石加成（原版 `if (stoneId > 100) " +N%"`）。 */
      let gemText = '';
      if (g.gem) {
        let lv = 0;
        try { lv = State.gemLevel ? State.gemLevel(g.gem.id) : 0; } catch (e) { lv = 0; }
        if (lv > 0) gemText = ' +' + State.gemPercent(lv) + '%';
      }
      setTextByName(view, 'baseExtra', gemText);
      /* 附加属性两列（原版 `getAttachmentDesList`）：说明一列有数据，`extraStr` 那列复刻的字典里没有，
       * 所以**留空**（素材自带作者占位串，必须写空，不能留着）。 */
      let des = [];
      try { des = State.extText(g.ext) || []; } catch (e) { des = []; }
      setTextByName(view, 'baseOther', des.join('\n'));
      setTextByName(view, 'baseOtherExtra', '');
    }
    /* 图标位：`subFrame1.c1.attachMovie(convertLink(装备)).gotoAndStop(1)`。 */
    const cell = clipOf(view, 'c1');
    if (cell && cell.detachAll) {
      cell.detachAll();
      gearArtIn(cell, g, GEAR_CARD_ART, GEAR_CARD_MID, GEAR_CARD_MID);
    }
  }
  function wireGearDetail(view, key) {
    const t = T();
    if (!t || !view) return;
    const hero = Hero();
    const backToList = () => { if (gearPage) gearPage.detail = null; void mountGearFrame(GEAR_FRAME_LIST).then(() => renderGearPage()); };
    /* 装 / 卸：原版 `changeEquip(chooseWz)` —— 走 `State` 那一套规则，不在这里另算数值。
     * 勇者模式：同一颗「装备 / 卸下」键，改的是本局外观（tower-ui 的 onEquip 落盘）。 */
    const onClip = clipOf(view, 'b_on');
    wireClickable(onClip, {
      hover: 0, press: 0,
      idle: () => { const g = currentGearByKey(key); return g && g.used ? 2 : 1; },
      onFire: () => {
        const g = currentGearByKey(key);
        if (!g) { backToList(); return; }
        if (hero) {
          if (!heroGearEquip(g.id, !g.used)) {
            if (window.UI && UI.toast) UI.toast('这件外观暂时不能更换。');
            return;
          }
          /* 用户 2026-10-24 口径：确认穿戴 / 卸下后回到上一界面（装备列表），
           * 不要停在详情页。列表重填后小勾 / 纸娃娃会立刻反映新外观。 */
          backToList();
          return;
        }
        if (g.used) { State.unwear(key); }
        else if (State.wear(key) === false) { if (window.UI && UI.toast) UI.toast('等级不足，暂时无法装备'); return; }
        /* 原版 `showEquips(pageNum1); showWears(); showFace(zhuangtai, …)` 之后仍停在详情页。 */
        if (gearPage && gearPage.view) { fillGearDetail(gearPage.view, currentGearByKey(key) || g); wireGearDetail(gearPage.view, key); }
      },
    });
    /* 「装备 / 卸下」外层 `b_on` 的第 2 帧是**另一颗按钮**（装备 ⇄ 卸下），不能拿来做 hover；
     * 但外层当前子元件（4575「装备」/ 4577「卸下」）自己的第 2 帧就是原版绿皮高亮档，
     * 且会保留第 1 帧的文字。所以悬停/按下只切内层帧，外层仍停在 idle 的 1/2 帧。
     * 装/卸后同一颗 `onClip` 会重新接线，所以监听只挂一次；每次事件都现取当前子元件。 */
    if (onClip && onClip.g && !onClip.__greenHoverWired) {
      onClip.__greenHoverWired = true;
      const setGreen = (on) => {
        const rec = onClip.nodes && onClip.nodes.get(1);
        if (rec && rec.clip) rec.clip.gotoAndStop(on ? 2 : 1);
      };
      onClip.g.addEventListener('mouseenter', () => setGreen(true));
      onClip.g.addEventListener('mouseleave', () => setGreen(false));
    }
    if (!hero) {
      /* 出售：原版先弹「二次确认」（第 6 帧的 `price` + 两颗键）。复刻的确认框沿用同一套 DOM 弹窗。 */
      wireClickable(clipOf(view, 'b_sell'), {
        hover: 2, press: 2, idle: 1,
        onFire: () => askSellEquipFromDetail(key, backToList),
      });
      /* 宝石：原版 `showStoneWin()` → 有宝石走拆卸、没有走镶嵌。
       * 外层 `b1` 只负责「镶嵌 / 已镶嵌 / 灰」三档；绿色反馈与点击都挂**当前内层按钮**
       * （镶嵌 4586 / 已镶嵌 4589），内层第 2 帧才是原版绿底。已镶嵌时 idle 也取第 2 帧，
       * 所以镶上后那颗键保持绿色（选中态），不是只在鼠标悬停时才绿。 */
      const b1Outer = clipOf(view, 'b1');
      const b1Inner = b1Outer && b1Outer.byName ? (b1Outer.byName('b1') || b1Outer) : b1Outer;
      wireClickable(b1Inner, {
        hover: 2, press: 2,
        idle: () => {
          const g = currentGearByKey(key);
          if (!g || Number(g.quality) <= 3) return 3;
          return g.gem ? 2 : 1;
        },
        onFire: () => { askGemFromDetail(key); },
      });
    }
    wireClickable(clipOf(view, 'b_back'), { hover: 2, onFire: backToList });
  }
  /** 详情页的出售确认（文案照原版 `showSellWin` 的 `price` 字段："出售该装备可获得N个金松果，确定要继续么？"）。 */
  function askSellEquipFromDetail(key, backToList) {
    const C = window.UI && UI.classic;
    const g = currentGearByKey(key);
    if (!g) { backToList(); return; }
    const range = State.gearSellRange(Number(g.quality) || 0);
    const after = () => { void mountGearFrame(GEAR_FRAME_LIST).then(() => renderGearPage()); };
    if (!C || !C.modal) { State.sellGear(key); after(); return; }
    C.modal('出售装备', '<p>出售该装备可获得 ' + range[0] + '~' + range[1] + ' 个金松果，确定要继续么？</p>' +
      (g.used ? '<p class="small-label">这件装备正穿戴在身上。</p>' : ''),
      [{ label: '出售', cls: 'gold', run: () => {
          const got = State.sellGear(key);
          if (window.UI && UI.toast) UI.toast('卖出【' + gearNameText(g) + '】，获得 ' + got + ' 金松果');
          after();
        } }, { label: '返回', cls: 'muted' }], { small: true });
  }
  /** 宝石键：有宝石 → 卸下；没有 → 列背包里的宝石供选择（与 `State.socketGem/unsocketGem` 同一套规则）。 */
  function askGemFromDetail(key) {
    const C = window.UI && UI.classic;
    const g = currentGearByKey(key);
    if (!g) return;
    const refresh = () => { if (gearPage && gearPage.view) { fillGearDetail(gearPage.view, currentGearByKey(key) || g); wireGearDetail(gearPage.view, key); } };
    if (!canSocketGear(g)) {
      if (window.UI && UI.toast) UI.toast('只有传说（橙色）或黑色装备才能镶嵌宝石。');
      return;
    }
    if (g.gem) {
      const r = State.unsocketGem(key);
      if (window.UI && UI.toast) UI.toast(r.msg);
      refresh();
      return;
    }
    /* ⚠ 不能写 `const S = S() || {}`：局部 `S` 会遮住模块里的 `S()`，
     * 初始化时右侧的 `S()` 落进 TDZ，直接 `ReferenceError: Cannot access 'S' before initialization`
     * —— 宝石键的点击回调在这里中断，弹窗永远不会出现（2026-10 用户报「镶嵌不上去」）。
     * 换一个名字；下面的属性读取也跟着改。 */
    const save = S() || {};
    const gems = [101, 102, 103, 104, 105, 106, 107].filter((id) => (save.props && save.props[id] > 0));
    if (!gems.length) {
      if (window.UI && UI.toast) UI.toast('背包里没有宝石。45级后通关关卡或在竞技场获胜有几率获得。');
      return;
    }
    if (!C || !C.modal) return;
    const m = C.modal('选择宝石', '<p class="small-label">' + GEAR_GEM_COST_NOTE + '</p><div class="gem-pick">' +
      gems.map((id) => {
        const item = window.propMap && propMap.getValue ? propMap.getValue(id) : null;
        return '<button type="button" class="help-item" data-gem="' + id + '"><span class="item-icon">' +
          (window.UI && UI.propIcon ? UI.propIcon(id, 64) : '') + '</span><span>' + esc(item ? item.name : ('宝石' + id)) +
          ' ×' + save.props[id] + '</span></button>';
      }).join('') + '</div>', [{ label: '返回', cls: 'muted' }], { small: true });
    const host = m && m.element;
    if (!host) return;
    for (const b of host.querySelectorAll('[data-gem]')) {
      b.onclick = () => {
        const r = State.socketGem(key, Number(b.dataset.gem));
        if (window.UI && UI.toast) UI.toast(r.msg);
        if (r.ok && m.close) m.close();
        refresh();
      };
    }
  }
  /** 打开「更换装备」这一页（原版 `showEquipsWin()`）。 */
  async function openGearsPage() {
    if (!current || !current.view) return false;
    /* 勇者模式：同一页原版换装，只是列表 / 纸娃娃 / 详情换成勇者外观；不跑新手换装引导。 */
    if (!heroView()) {
      /* 5 级换装：先把随机白装发进背包，再挂页；教程沿用原版 13→14→15→22，不另盖层。 */
      if (window.SfGuide && SfGuide.onGears) { try { SfGuide.onGears(); } catch (e) { if (window.__errs) window.__errs.push('guide gears: ' + (e && e.message)); } }
    }
    /* 先收掉可能开着的武器 / 技能详情层，避免两层叠在一起。 */
    if (current.detail) destroyItemDetailOnly();
    if (!gearPage) gearPage = { host: null, view: null, page: 0, detail: null };
    gearPage.page = 0;
    gearPage.highlight = null;
    /* 有「刚拿到的装备」就直接翻到它所在页 + 高亮：融合产物追加在背包末尾，
     * 每次从第 1 页打开的话玩家在屏幕上根本看不到它（「融合完找不到装备」）。
     * 勇者换装没有背包焦点，从第 1 页（黑装第一套）开始。 */
    if (!heroView() && pendingGearFocus) {
      const list = gearListOf();
      const at = list.findIndex((g) => String(g.key) === String(pendingGearFocus));
      if (at >= 0) {
        gearPage.page = Math.floor(at / GEAR_PAGE_SIZE);
        gearPage.highlight = String(pendingGearFocus);
      }
      pendingGearFocus = null;
    }
    const view = await mountGearFrame(GEAR_FRAME_LIST);
    if (!view) return false;
    const host = gearPageHost();
    if (host) host.setAttribute('aria-label', heroView() ? '更换装备' : '我的装备');
    renderGearPage();
    return true;
  }
  /** 记下「刚拿到的装备」，下一次打开「更换装备」直接落到它那一页并高亮。
   *  返回 { page, pages }（页号从 1 开始，给提示文案用）；找不到返回 null。 */
  function focusGear(key) {
    if (heroView()) return null;
    if (key == null || key === '') return null;
    const list = gearListOf();
    const at = list.findIndex((g) => String(g.key) === String(key));
    if (at < 0) return null;
    pendingGearFocus = String(key);
    const pages = Math.max(1, Math.ceil(list.length / GEAR_PAGE_SIZE));
    const page = Math.floor(at / GEAR_PAGE_SIZE) + 1;
    /* 这一页已经开着（例如在详情里又合了一件）：当场翻过去，不用等下次打开。 */
    if (gearPage && gearPage.view) {
      gearPage.page = page - 1;
      gearPage.highlight = String(key);
      renderGearPage();
    }
    return { page: page, pages: pages };
  }

  /* ============================================================
   * 「装备融合」= 原版 4673 的第 8 / 9 / 13 帧
   * ------------------------------------------------------------
   * 原版链路：状态页那颗「装备融合」键（>19 级）→ `selectComposeType()` 选类型 →
   *   `showFusionWin()`（:8135）：`loadMcs([["状态1","subFrame4",…]]); subFrame4.gotoAndStop(8)`
   *   —— **工作台**（三个材料格 + 费用 + 提示 + 选择/帮助/融合/返回）；
   *   `b_choose` → `showFusion(num)`（:8388）= 同一颗元件的**第 9 帧**：材料选择页
   *     （一页 2 件、左右翻页、`cs` 勾、`mc_x` 选中档）；选第 4 件时 `selectFusionById`（:22177）会拦；
   *   `b_fusion` → `doFusion()`（:22222）→ **第 13 帧**：二次确认（`t_tips` + `goal` + 确定/返回）。
   * 版式逐条照 `updataFusionMain()`（:8517）：
   *   · 三个 `c{i}`(4630) 挂 `convertLink(装备)` 的容器、并 **`_xscale = _yscale = 120`**；
   *   · `cBack{i}` 只在**一件材料都没有**时可见（它是空格底）；
   *   · `mc_tips`：0 件 → 按类型 1/4/5；1~2 件 → 2；满 3 件 → 3。
   * ⚠ 复刻的融合规则与原件不同（原件按 composeType 分蓝/紫/橙三档、材料页每页 2 件；
   *   复刻经典页是"任意 3 件**同品质** → 升一档（不要求同部位）"，费用与校验都在 `State.mergeGears`）——
   *   所以这里**版式照原版、规则与文案走 `State`**，件数上限仍是 3 件。
   * ========================================================== */
  const FUSION_FRAME = { work: 8, pick: 9, confirm: 13 };
  const FUSION_QUALITY_NAMES = ['普通', '优秀', '杰出', '卓越', '传说', '黑色'];
  const FUSION_PICK_PER_PAGE = 2;
  let fusionPage = null;    // { host, view, frame, sel: [key], page }
  function fusionCostOf(q) {
    try { return Number(State.gearCostOf(q)) || 0; } catch (e) { return 0; }
  }
  function fusionCardOf(view, i) {
    return clipOf(view, 'c' + (i + 1));
  }
  function fusionHost() {
    if (fusionPage && fusionPage.host && fusionPage.host.isConnected) return fusionPage.host;
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const el = document.createElement('section');
    el.className = 'classic-home ssfight-home ssfight-sub ssfight-view';
    el.setAttribute('aria-label', '装备融合');
    ui.appendChild(el);
    return el;
  }
  function destroyFusionPage() {
    const rec = fusionPage;
    fusionPage = null;
    destroyFusionOverlay();
    if (!rec) return;
    if (rec.view) { try { rec.view.destroy(); } catch (e) {} }
    if (rec.host && rec.host.parentNode) rec.host.parentNode.removeChild(rec.host);
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
  }
  /* ---------- 融合页上面的浮层（帮助 3157）----------
   * 原版帮助是**另挂一层**（`loadMcs([["装备融合帮助","subFrame6"]])`），不是换掉融合页本身。
   * 融合过场已改走 4402「合成中」（与道具合成同一颗），不再用 3763「融合中」。 */
  let fusionOver = null;
  let fusionExtraLoaded = false;
  async function loadFusionExtra() {
    if (fusionExtraLoaded) return true;
    try { await SfRender.loadExtra('tags-fusion.json'); fusionExtraLoaded = true; } catch (e) { return false; }
    return true;
  }
  function fusionOverlayHost() {
    if (!fusionPage) return null;
    if (fusionOver && fusionOver.host && fusionOver.host.isConnected) return fusionOver.host;
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const el = document.createElement('section');
    el.className = 'classic-home ssfight-home ssfight-sub ssfight-view';
    el.setAttribute('aria-label', '装备融合浮层');
    ui.appendChild(el);
    fusionOver = { host: el, view: null };
    return el;
  }
  async function mountFusionOverlay(host, sym, label) {
    await loadFusionExtra();
    if (!fusionOver || fusionOver.host !== host || host.isConnected === false) return null;
    if (fusionOver.view) { try { fusionOver.view.destroy(); } catch (e) {} fusionOver.view = null; }
    const view = await SfRender.mountSymbol(host, sym, { frame: 1, label: label });
    if (!fusionOver || fusionOver.host !== host) { view.destroy(); return null; }
    T().freezeDescendants(view);
    fusionOver.view = view;
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    return view;
  }
  function destroyFusionOverlay() {
    const rec = fusionOver;
    fusionOver = null;
    if (!rec) return;
    if (rec.view) { try { rec.view.destroy(); } catch (e) {} }
    if (rec.host && rec.host.parentNode) rec.host.parentNode.removeChild(rec.host);
  }
  function closeFusionPage() {
    destroyFusionPage();
    try { if (current && current.view) fillValues(current.view); } catch (e) {}
  }
  async function mountFusionFrame(frame) {
    const host = fusionHost();
    if (!host) return null;
    /* 融合页的格子和「我的装备」一样挂原版 `convertLink` 预上色符号（整张卡），
     * 先确保配色表在；拉不到就退回容器画稿。 */
    try { await loadGearColorTable(); } catch (e) {}
    if (!fusionPage) fusionPage = { host: host, view: null, frame: frame, sel: [], page: 0 };
    else fusionPage.host = host;
    if (fusionPage.view) { try { fusionPage.view.destroy(); } catch (e) {} fusionPage.view = null; }
    while (host.firstChild) host.removeChild(host.firstChild);
    const view = await SfRender.mountSymbol(host, '4673', {
      frame: frame, label: frame === FUSION_FRAME.pick ? '选择融合材料' : '装备融合',
    });
    if (!fusionPage || fusionPage.host !== host || host.isConnected === false) { view.destroy(); return null; }
    T().freezeDescendants(view);
    fusionPage.view = view;
    fusionPage.frame = frame;
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    return view;
  }
  /** 材料清单：未穿戴即可（经典模式没有星标；橙装也可以继续融合成黑装）。
   *  品质高的排前面（黑/橙优先），同品质内仍按获得顺序；否则 50 多件橙装会被
   *  每页 2 件的翻页埋到最后，玩家根本找不到。 */
  function fusionMaterials() {
    try {
      return State.gearsInDisplayOrder()
        .filter((g) => !g.used)
        .sort((a, b) => Number(b.quality) - Number(a.quality));
    } catch (e) { return []; }
  }
  function fusionSelected() {
    if (!fusionPage) return [];
    const all = fusionMaterials();
    fusionPage.sel = fusionPage.sel.filter((k) => all.some((g) => g.key === k));
    return fusionPage.sel;
  }
  /* ---------- 工作台（第 8 帧，`updataFusionMain`） ---------- */
  /* 4673 f8 的「请先放入3件蓝色的装备」是拆成逐字 <text> 的画稿。
   * 融合规则早已放开到任意同品质（橙装还能合黑），把这一行改成通用提示。 */
  function rewriteFusionPrompt(view, text) {
    const root = view && (view.g || view);
    if (!root || !root.querySelectorAll) return;
    /* 第一次按原画稿文字找；改过之后原文字已经不在了，用自己打的标记认。
     * 否则第二次调用（换材料 / 同套提示切换）会找不到这一组、提示永远停在第一句。
     * ⚠ 找过一次就把节点记在视图上：`textContent` 会把整棵子树拼成字符串，
     *  对每个 `<g>` 都调一遍是 O(n²)，移动端换一次材料就要几十毫秒。 */
    let prompt = view.__fusionPrompt;
    if (!prompt || prompt.isConnected === false || !root.contains(prompt)) {
      prompt = root.querySelector('g[data-fusion-prompt="1"]');
      if (!prompt) {
        for (const g of root.querySelectorAll('g')) {
          const txt = String(g.textContent || '').replace(/\s+/g, '');
          if (txt.indexOf('请先放入') >= 0 && txt.indexOf('装备') >= 0) { prompt = g; break; }
        }
      }
      view.__fusionPrompt = prompt || null;
    }
    if (!prompt) return;
    prompt.setAttribute('data-fusion-prompt', '1');
    const glyphs = [...prompt.querySelectorAll('text')];
    if (!glyphs.length) return;
    const first = glyphs[0];
    const keep = {};
    for (const a of ['font-family', 'font-size', 'font-weight', 'fill', 'letter-spacing', 'text-anchor']) {
      const v = first.getAttribute(a);
      if (v != null) keep[a] = v;
    }
    for (const g of glyphs) g.remove();
    const n = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    n.setAttribute('x', '0');
    n.setAttribute('y', '14');
    for (const [a, v] of Object.entries(keep)) n.setAttribute(a, v);
    n.textContent = text || '请先放入3件同品质装备';
    prompt.appendChild(n);
  }

  function fillFusionWork(view) {
    if (!view || !fusionPage) return;
    const all = fusionMaterials();
    const sel = fusionSelected();
    const picked = sel.map((k) => all.find((g) => g.key === k)).filter(Boolean);
    /* 三件同套且该套有下一品质档时，工作台直接写“同套必得：狂战/怒战…”。 */
    const sameSet = picked.length === 3 && State.fusionFamilyInfo ? State.fusionFamilyInfo(picked) : null;
    rewriteFusionPrompt(view, sameSet ? '同套必得：' + sameSet.family : '');
    for (let i = 0; i < 3; i++) {
      const cell = clipOf(view, 'c' + (i + 1));
      const back = clipOf(view, 'cBack' + (i + 1));
      const g = picked[i];
      if (cell && cell.detachAll) {
        cell.detachAll();
        if (g) {
          /* 原版 `updataFusionMain()`：`attachMovie(convertLink(装备))` 后把 **c{i} 自己**
           * 设成 146%（MainMovie.as:8535-8551）。符号是整张卡，所以直接 1:1 挂上再乘 1.46；
           * 查不到预上色符号才退回容器画稿按格子大小缩放。 */
          const sid = gearColorId(g);
          const icon = sid ? cell.attachChild(String(sid), 1, 'gear') : null;
          if (icon) {
            icon.setExtraTransform('scale(1.46)');
          } else {
            const info = wearInfo(g);
            const sym = containerIds && containerIds[Number(g.type)] && containerIds[Number(g.type)][0];
            if (info && sym && cell.attachChild) {
              /* ⚠ 不能照抄原版的 `c{i}._xscale = 120`：原版 `convertLink()` 给的是**位图化**的
               * 装备图，而这边挂的是按角色尺度画的**容器画稿**（照抄就是一颗占满全屏的球，
               * 2026-11 实拍过）。按格子实际尺寸等比缩放并居中。 */
              fitIntoCard(cell, cell.attachChild(sym, info.frame, 'wear'), back || cell, 0.85, 67);
            }
          }
        }
      }
      /* `cBack{i}._visible = false`：只要有一件材料，三个空格底一起收掉（照原版）。 */
      setVisible(back, picked.length === 0);
    }
    const tips = clipOf(view, 'mc_tips');
    if (tips) {
      if (!picked.length) {
        const q = 0;
        void q;
        stopAt(tips, 1);
      } else if (picked.length < 3) stopAt(tips, 2);
      else stopAt(tips, 3);
    }
    const cost = clipOf(view, 'mergeCost');
    if (cost) {
      stopAt(cost, 1);
      const q = picked.length ? Number(picked[0].quality) : 0;
      const line = picked.length ? (fusionCostOf(q) + '金松果') : '';
      const field = cost.byName ? cost.byName('cost') : null;
      if (field) setTextByName(cost, 'cost', line);
    }
  }
  function wireFusionWork(view) {
    const t = T();
    if (!t || !view || !fusionPage) return;
    wireClickable(clipOf(view, 'b_choose'), {
      hover: 2, onFire: () => { void openFusionPick(); },
    });
    wireClickable(clipOf(view, 'b_fusion'), {
      hover: 2,
      onFire: () => {
        const sel = fusionSelected();
        if (sel.length !== 3) {
          if (window.UI && UI.toast) UI.toast('请在下列装备中选定 3 件（当前 ' + sel.length + ' 件）');
          void openFusionPick();
          return;
        }
        void openFusionConfirm();
      },
    });
    wireClickable(clipOf(view, 'b_help'), { hover: 2, onFire: fusionHelp });
    wireClickable(clipOf(view, 'b_back'), { hover: 2, onFire: closeFusionPage });
  }
  /** 「帮助」：原件是 `showFusionHelp()`（`MainMovie.as:8269`）→
   *  `loadMcs([["装备融合帮助","subFrame6"]])`，我们把它拉进了 `tags-fusion.json`。
   *  原件里那一页有 `text1`(文本) + `left`/`right`(翻页) + `button1`(关闭)，分页由
   *  `showEquipMergeHelpPage` / `showPreHelpPage` / `showNextHelpPage` 驱动；
   *  文案 `helpWords` 是服务端下发的（本地源码里没有内容），所以这里用**复刻自己的融合规则**写。 */
  /** 帮助页 `text1` 框只有 270 单位宽（字号 12），不手动断行会横向出框；
   *  按 20 个全角字一行处理，保留原文里的手工换行。 */
  function wrapFusionHelp(text) {
    const out = [];
    for (const para of String(text == null ? '' : text).split('\n')) {
      if (!para) { out.push(''); continue; }
      for (let i = 0; i < para.length; i += 21) out.push(para.slice(i, i + 21));
    }
    return out.join('\n');
  }
  let fusionHelpPage = 0;
  async function fusionHelp() {
    try {
      return await fusionHelpOpen();
    } catch (e) {
      if (window.__errs) window.__errs.push('fusion help: ' + (e && e.message));
      return false;
    }
  }
  async function fusionHelpOpen() {
    const host = fusionOverlayHost();
    if (!host) return false;
    const view = await mountFusionOverlay(host, '3157', '装备融合帮助');
    if (!view) return;
    const C = window.UI && UI.classic;
    const extInherit = Math.round((Number(State.FUSION_EXT_INHERIT_RATE) || 0) * 100);
    const extUpgrade = Math.round((Number(State.FUSION_EXT_UPGRADE_RATE) || 0) * 100);
    const words = [
      '选 3 件同品质的未穿戴装备，融合成 1 件更高品质的装备。',
      '费用按材料品质：白 ' + fusionCostOf(0) + ' / 绿 ' + fusionCostOf(1) + ' / 蓝 ' + fusionCostOf(2) +
        ' / 紫 ' + fusionCostOf(3) + ' / 橙 ' + fusionCostOf(4) + ' 金松果。',
      '已穿戴的装备不能作为材料；部位和名字可以完全不同。',
      '3 件同品质的紫装可以融成一件传说装备；3 件橙色装备可以融成一件黑色装备；融合成功率 100%。',
      '三件材料同属一套（如狂战头盔/拳甲/铠甲）且该套有下一品质档时，产物必定是同套装的下一品质、首件材料部位；该套没有下一品质档（早期白/绿套）或材料跨套时按随机规则。品质 5 的黑装已是最高档，三件黑装仍按同部位洗练。',
      '部位和名字可以完全不同。产物的每个词条都有 ' + extInherit + '% 概率从三件材料的词条里继承；' +
        '继承到的词条取材料里的最高星级，另有 ' + extUpgrade + '% 概率再升 1 星（最高 3 星）。',
    ];
    fusionHelpPage = 0;
    const pager = (list) => {
      const page = Math.max(0, Math.min(fusionHelpPage, list.length - 1));
      fusionHelpPage = page;
      setTextByName(view, 'text1', wrapFusionHelp(list[page]));
      const l = clipOf(view, 'left'), r = clipOf(view, 'right');
      setVisible(l, page > 0);
      setVisible(r, page < list.length - 1);
      return { page: page, total: list.length };
    };
    pager(words);
    const turn = (dir) => {
      const next = fusionHelpPage + dir;
      if (next < 0 || next >= words.length) return;
      fusionHelpPage = next;
      pager(words);
    };
    for (const [name, dir] of [['left', -1], ['right', 1]]) {
      const clip = clipOf(view, name);
      if (!clip || !clip.g) continue;
      clip.g.style.cursor = 'pointer';
      clip.g.style.pointerEvents = 'auto';
      clip.g.addEventListener('click', (e) => { if (e && e.stopPropagation) e.stopPropagation(); turn(dir); });
    }
    const close = clipOf(view, 'button1');
    wireClickable(close, { hover: 2, press: 2, idle: 1, onFire: () => destroyFusionOverlay() });
    void C;
    return true;
  }
  /* ---------- 选材料（第 9 帧，`showFusion`） ---------- */
  function fillFusionPick(view) {
    if (!view || !fusionPage) return;
    const all = fusionMaterials();
    const pages = Math.max(1, Math.ceil(all.length / FUSION_PICK_PER_PAGE));
    fusionPage.page = Math.max(0, Math.min(fusionPage.page, pages - 1));
    const sel = fusionSelected();
    for (let i = 0; i < FUSION_PICK_PER_PAGE; i++) {
      const g = all[fusionPage.page * FUSION_PICK_PER_PAGE + i];
      const card = clipOf(view, 'c' + (i + 1));
      const tick = clipOf(view, 'cs' + (i + 1));
      const mark = clipOf(view, 'mc_' + (i + 1));
      const chosen = !!(g && sel.indexOf(g.key) >= 0);
      if (mark) {
        stopAt(mark, g ? (chosen ? 2 : 1) : 3);      // 3 = 空（照 `showFusion`）
        /* 外层 `mc_i` 只切到「取消」/「选定」那一档；里面的按钮精灵再切到第 2 帧才变绿。 */
        const inner = mark.byName ? mark.byName('mc_1') : null;
        if (inner) stopAt(inner, g ? (chosen ? 2 : 1) : 1);
      }
      if (tick) stopAt(tick, chosen ? 1 : 2);
      setTextByName(view, 't_name' + (i + 1), g ? gearNameText(g) : '');
      const label = clipOf(view, 't_name' + (i + 1));
      if (label) setGearTextColor(label, g ? g.quality : 0);
      setTextByName(view, 't_base' + (i + 1), g ? (String(g.attrName || '') + '+' + Math.max(0, Math.round(Number(g.abilityVal) || 0))) : '');
      let addr = [];
      try { addr = (g && State.extText(g.ext)) || []; } catch (e) { addr = []; }
      setTextByName(view, 't_addr' + (i + 1), addr.join('\n'));
      if (card) {
        card.__gearKey = g ? String(g.key) : null;
        if (card.detachAll) {
          card.detachAll();
          if (g) {
            /* 原版 `showFusion()`：`c{i}.attachMovie(convertLink(装备))`，1:1 挂在格子里。 */
            const sid = gearColorId(g);
            const icon = sid ? card.attachChild(String(sid), 1, 'gear') : null;
            if (!icon) {
              const info = wearInfo(g);
              const sym = containerIds && containerIds[Number(g.type)] && containerIds[Number(g.type)][0];
              if (info && sym && card.attachChild) {
                fitIntoCard(card, card.attachChild(sym, info.frame, 'wear'), null, 0.87, GEAR_CARD);
              }
            }
          }
        }
      }
    }
    setTextByName(view, 'require', '请在下列装备中选定3件。已选 ' + sel.length + '/3');
    const canPrev = fusionPage.page > 0, canNext = fusionPage.page < pages - 1;
    stopAt(clipOf(view, 'left'), canPrev ? 1 : 2);
    stopAt(clipOf(view, 'right'), canNext ? 1 : 2);
    setVisible(clipOf(view, 'left'), canPrev);
    setVisible(clipOf(view, 'right'), canNext);
  }
  function wireFusionPick(view) {
    if (!view || !fusionPage) return;
    const back = () => { void mountFusionFrame(FUSION_FRAME.work).then(() => { fillFusionWork(fusionPage && fusionPage.view); wireFusionWork(fusionPage && fusionPage.view); }); };
    for (let i = 0; i < FUSION_PICK_PER_PAGE; i++) {
      const card = clipOf(view, 'c' + (i + 1));
      if (!card || !card.g) continue;
      if (!card.__fusionWired) {
        card.__fusionWired = true;
        card.g.addEventListener('click', (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const key = card.__gearKey;
          if (!key || !fusionPage) return;
          const at = fusionPage.sel.indexOf(key);
          if (at >= 0) fusionPage.sel.splice(at, 1);
          else if (fusionPage.sel.length >= 3) {
            if (window.UI && UI.toast) UI.toast('每次融合最多只能选择3个装备哦！');
            return;
          } else fusionPage.sel.push(key);
          fillFusionPick(fusionPage.view);
        });
      }
      /* ⚠ 光标与 `pointer-events` 必须在**工具件之后**设：`popWrap()` 会把内容搬进
       * `g.uc-pop` 壳里，搬完这颗 `g` 的 `pointer-events` 已经不是我们设的那个值了 ——
       * 先设后被覆盖的话，画面上看着能点、真机点上去毫无反应（走 `dispatchEvent` 的
       * 回归用例**发现不了**这一类问题：它绕过了命中测试）。2026-11 实测过一次。 */
      const t = T();
      if (t) { t.measureHitBox(card); t.popWrap(card); const shell = card.g.querySelector(':scope > g.uc-pop'); if (shell) t.wirePopPress(shell); }
      card.g.style.cursor = card.__gearKey ? 'pointer' : 'default';
      card.g.style.pointerEvents = card.__gearKey ? 'auto' : 'none';
      const mark = clipOf(view, 'mc_' + (i + 1));
      if (mark && mark.g) {
        mark.g.style.cursor = 'pointer';
        mark.g.style.pointerEvents = 'auto';
        if (!mark.__fusionWired) {
          mark.__fusionWired = true;
          mark.g.addEventListener('mouseenter', () => {
            if (!card.__gearKey) return;
            const chosen = !!(fusionPage && fusionPage.sel.indexOf(card.__gearKey) >= 0);
            /* 未选中的「选定」只把内层按钮切绿，外层保持「选定」文案；
             * 已选中的外层已经是「取消」，保持外层 2 + 内层 2。 */
            if (chosen) stopAt(mark, 2);
            const inner = mark.byName ? mark.byName('mc_1') : null;
            if (inner) stopAt(inner, 2);
          });
          mark.g.addEventListener('mouseleave', () => {
            if (!card.__gearKey) { stopAt(mark, 3); return; }
            const chosen = !!(fusionPage && fusionPage.sel.indexOf(card.__gearKey) >= 0);
            stopAt(mark, chosen ? 2 : 1);
            const inner = mark.byName ? mark.byName('mc_1') : null;
            if (inner) stopAt(inner, chosen ? 2 : 1);
          });
          mark.g.addEventListener('click', (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            card.g.dispatchEvent(new MouseEvent('click', { bubbles: false }));
          });
        }
      }
    }
    const t2 = T();
    if (t2) {
      for (const [name, dir] of [['left', -1], ['right', 1]]) {
        const clip = clipOf(view, name);
        if (!clip || !clip.g) continue;
        if (!clip.__fusionWired) {
          clip.__fusionWired = true;
          clip.g.addEventListener('click', (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            if (!fusionPage || !fusionPage.view) return;
            const pages = Math.max(1, Math.ceil(fusionMaterials().length / FUSION_PICK_PER_PAGE));
            const next = fusionPage.page + dir;
            if (next < 0 || next > pages - 1) return;
            fusionPage.page = next;
            fillFusionPick(fusionPage.view);
          });
        }
        /* 翻页键原版就是"不可用时不显示"（`_visible = false`），所以这里不靠热区禁用。 */
        clip.g.style.cursor = clip.g.style.visibility === 'hidden' ? 'default' : 'pointer';
        clip.g.style.pointerEvents = 'auto';
      }
    }
    wireClickable(clipOf(view, 'b_back'), { hover: 2, onFire: back });
  }
  async function openFusionPick() {
    const view = await mountFusionFrame(FUSION_FRAME.pick);
    if (!view) return false;
    fillFusionPick(view);
    wireFusionPick(view);
    return true;
  }
  /* ---------- 二次确认（第 13 帧，`doFusionWin`） ---------- */
  async function openFusionConfirm() {
    const sel = fusionSelected();
    if (sel.length !== 3) return false;
    const view = await mountFusionFrame(FUSION_FRAME.confirm);
    if (!view) return false;
    const all = fusionMaterials();
    const picked = sel.map((k) => all.find((g) => g.key === k)).filter(Boolean);
    const q = picked.length ? Number(picked[0].quality) : 0;
    const cost = fusionCostOf(q);
    setTextByName(view, 't_tips', '融合即将开始，\n本次需要' + cost + '个金松果。');
    const sameSet = picked.length === 3 && State.fusionFamilyInfo ? State.fusionFamilyInfo(picked) : null;
    const exact = sameSet && State.gearInst ? State.gearInst(sameSet.id) : null;
    setTextByName(view, 'goal', sameSet
      ? (FUSION_QUALITY_NAMES[Math.min(5, sameSet.quality)] || '') + (exact && exact.name ? exact.name : sameSet.family) + '　'
      : (FUSION_QUALITY_NAMES[Math.min(5, q + 1)] || '') + '装备　');
    const back = () => { void mountFusionFrame(FUSION_FRAME.work).then(() => { fillFusionWork(fusionPage && fusionPage.view); wireFusionWork(fusionPage && fusionPage.view); }); };
    wireClickable(clipOf(view, 'b_back'), { hover: 2, onFire: back });
    wireClickable(clipOf(view, 'b_ok'), {
      hover: 2, press: 2,
      onFire: () => {
        const keys = fusionSelected().slice();
        /* 结算规则走 `State`（费用、同品质、穿戴都在那边；经典页不再要求同部位，
         * 也没有星标；橙装可以继续融合成黑装）。 */
        const r = State.mergeGears(keys, { allowMixedParts: true });
        if (r.ok) {
          /* 不叠加 3763「融合中」：直接播 4402「合成中」整段 CG（与道具合成同一颗），
           * 播完停在 f44 结果页展示合出的装备，确认后回融合工作台。 */
          destroyFusionOverlay();
          if (fusionPage) fusionPage.sel = [];
          const backToWork = () => mountFusionFrame(FUSION_FRAME.work).then(() => {
            fillFusionWork(fusionPage && fusionPage.view);
            wireFusionWork(fusionPage && fusionPage.view);
          });
          /* 关掉结果页时再提示「装备去哪了」：产物追加在背包末尾，而「更换装备」每页只有
           * 6 格、每次从第 1 页打开 —— 只回工作台不给去处，玩家就会以为装备没了。
           * 这里顺手记下焦点：下次打开「更换装备」会直接翻到它那一页并高亮。 */
          const afterResult = () => {
            const focus = focusGear(r.gear && r.gear.key);
            if (focus && window.UI && UI.toast) {
              UI.toast('【' + gearNameText(r.gear) + '】已放入装备背包（更换装备 第 ' + focus.page + '/' + focus.pages + ' 页）');
            }
            return backToWork();
          };
          if (window.SfCompose && SfCompose.showGearResult) {
            return SfCompose.showGearResult(r.gear, { onClose: afterResult, playCg: true }).then((ok) => {
              if (!ok) return afterResult();
            });
          }
          return afterResult();
        }
        if (window.UI && UI.toast) UI.toast(r.msg);
        back();
      },
    });
    return true;
  }
  /** 打开「装备融合」这一页（原版 `showFusionWin()`）。 */
  async function openFusionPage() {
    if (!current || !current.view) return false;
    if (current.detail) destroyItemDetailOnly();
    if (!fusionPage) fusionPage = { host: null, view: null, frame: FUSION_FRAME.work, sel: [], page: 0 };
    fusionPage.sel = [];
    fusionPage.page = 0;
    const view = await mountFusionFrame(FUSION_FRAME.work);
    if (!view) return false;
    fillFusionWork(view);
    wireFusionWork(view);
    return true;
  }

  window.SfStatus = Object.freeze({
    open: open,
    /** 查看别人的状态页：与 `open()` 同一页，只是把数据源换成对手
     *  （原版 `getPlayInfo` → `gotoAndStop("zhuangtai")`，见文件头那一段）。
     *  **盖在挑战页上**（`overlay:true`）：返回时只拆这一层，底下的好友名单 / 选中行原样保留，
     *  不会重新洗牌敌人；挑战页不在场时才退回整页挂载。 */
    openFriend: (foe, backTo) => {
      const ui = document.getElementById('ui');
      let host = null;
      if (ui) {
        host = document.createElement('section');
        host.className = 'classic-home ssfight-home sf-friend-view';
        host.setAttribute('aria-label', '松鼠状态');
        ui.appendChild(host);
      }
      const p = open(host, { friend: foe, backTo: backTo, overlay: true });
      if (p && typeof p.then === 'function') {
        return p.then((ok) => {
          if (!ok && host && host.parentNode) host.parentNode.removeChild(host);
          return ok;
        }, (err) => {
          if (host && host.parentNode) host.parentNode.removeChild(host);
          throw err;
        });
      }
      return p;
    },
    /** 勇者模式的状态页（准备 / 爬塔中回看）：
     *  与 `openFriend()` 同一颗页元件 7218，数据源换成 `hero.stats / appearance / picks`。
     *  `opts.overlay === false` = 直接从 `#ui` 另起一页（准备页）；true = 盖在当前塔页上。
     *  `hero` 里的回调：`onPicks(list)` / `onGears()` / `onStart()` / `onBack()`。 */
    openHero: (hero, opts) => {
      const o = opts || {}, ui = document.getElementById('ui');
      if (!ui) return Promise.resolve(false);
      if (!o.overlay) ui.innerHTML = '';
      const host = document.createElement('section');
      /* `ssfight-view`：盖在塔页（`.classic-page`）上时，classic.css 的
       * `#ui:has(.classic-page) .classic-home:not(.ssfight-view){display:none}` 才不会把这层藏掉。 */
      host.className = 'classic-home ssfight-home sf-friend-view sf-hero-view ssfight-view';
      host.setAttribute('aria-label', o.label || '勇者');
      ui.appendChild(host);
      const p = open(host, { hero: hero, overlay: true, tab: o.tab });
      if (p && typeof p.then === 'function') {
        return p.then((ok) => {
          if (!ok && host && host.parentNode) host.parentNode.removeChild(host);
          return ok;
        }, (err) => {
          if (host && host.parentNode) host.parentNode.removeChild(host);
          throw err;
        });
      }
      return p;
    },
    /** 当前状态页的宿主（调试 / 外部入口用）。 */
    container: () => (current ? current.container : null),
    /** 「更换装备」这一层的视图（调试 / 探针用；没开时为 null）。 */
    gearView: () => (gearPage ? gearPage.view : null),
    /** 「查看装备」（原版 `friendEquipsInfo()`）：在**当前这一页上盖一层**，
     *  不拆状态页 —— 返回就回他的状态页。挑战页的 `SfChallenge.showFriendGears` 走这里。 */
    showFriendGears: () => { try { openFriendGearsOverlay(); return true; } catch (e) { if (window.__errs) window.__errs.push('friendGears: ' + (e && e.message)); return false; } },
    /** 「更换装备」（原版 `showEquipsWin()`）= 库元件「状态1」第 3 帧，**盖在状态页上**的一层。
     *  状态页那颗 `b_change` 走这里；退出只拆这一层，底下的状态页不重建。 */
    openGears: () => { try { return openGearsPage(); } catch (e) {
      if (window.__errs) window.__errs.push('gears page: ' + (e && e.message)); return false; } },
    /** 融合结果页（`ui-compose.js`）也走 `convertLink` 整卡：先等配色表，
     *  再按 1:1 画；查不到符号返回 false，调用方退回原来的 PNG。 */
    ensureGearColors: () => loadGearColorTable(),
    paintGearCard: (cell, gear) => paintGearCard(cell, gear),
    /** 关掉「更换装备」那一层（调试 / 探针用）。 */
    closeGears: () => { destroyGearPage(); },
    /** 「刚拿到的装备」：下一次打开「更换装备」直接翻到它那一页并高亮（融合产物用）。
     *  返回 { page, pages }（页号从 1 开始）或 null。 */
    focusGear: (key) => { try { return focusGear(key); } catch (e) { return null; } },
    /** 「装备融合」= 原版 4673 第 8/9/13 帧（工作台 / 选材料 / 二次确认），盖在状态页上的一层。 */
    openFusion: () => { try { return openFusionPage(); } catch (e) {
      if (window.__errs) window.__errs.push('fusion page: ' + (e && e.message)); return false; } },
    closeFusion: () => { destroyFusionPage(); },
    /** 融合页的状态快照（回归探针：看的是"这一刻停在哪一帧、选了几件、页号多少"）。 */
    fusionDebug: () => {
      if (!fusionPage || !fusionPage.view) return null;
      const texts = {};
      for (const n of ['require', 't_name1', 't_name2', 't_base1', 't_base2', 't_tips', 'goal']) {
        const c = clipOf(fusionPage.view, n);
        if (c) texts[n] = String(c.textContent == null ? '' : c.textContent);
      }
      const costClip = clipOf(fusionPage.view, 'mergeCost');
      const costField = costClip && costClip.byName ? costClip.byName('cost') : null;
      const sel = fusionSelected();
      return { frame: fusionPage.frame, page: fusionPage.page, sel: sel.slice(),
        cost: costField ? String(costField.textContent || '') : '',
        marks: [1, 2, 3].map((i) => { const c = clipOf(fusionPage.view, 'mc_' + i) || clipOf(fusionPage.view, 'c' + i); return c ? c.frame : null; }),
        texts: texts };
    },
    /** 「更换装备」那一层的状态快照（回归探针：看的是"这一刻画的是哪 6 件、停在第几页"）。 */
    gearsDebug: () => {
      if (!gearPage || !gearPage.view) return null;
      const list = gearListOf();
      const pages = Math.max(1, Math.ceil(list.length / GEAR_PAGE_SIZE));
      const page = gearPage.page;
      const cells = [];
      for (let i = 0; i < GEAR_PAGE_SIZE; i++) {
        const g = list[page * GEAR_PAGE_SIZE + i] || null;
        cells.push({ key: g ? String(g.key) : null, name: g ? gearNameText(g) : '', used: !!(g && g.used),
          iconFrame: (clipOf(gearPage.view, 'icon' + (i + 1)) || {}).frame });
      }
      const doll = {};
      for (const pair of GEAR_DOLL_PARTS) {
        const clip = clipOf(gearPage.view, pair[0]);
        doll[pair[0]] = clip && clip.__attached ? clip.__attached.length : 0;
      }
      /* 页面上的真实文案（文本字段节点自己带 `textContent`）——回归套件据此核对"写了什么"。 */
      const texts = {};
      for (const n of ['t_count', 't_1', 't_2', 't_3', 't_4', 't_5', 't_6',
        't_name', 'type', 'level', 'base', 'baseExtra', 'baseOther', 'baseOtherExtra']) {
        const c = clipOf(gearPage.view, n);
        if (c) texts[n] = String(c.textContent == null ? '' : c.textContent);
      }
      return { page: page, pages: pages, cells: cells, doll: doll, texts: texts,
        highlight: gearPage.highlight || null,
        detail: gearPage.detail, frame: (gearPage.view.frame | 0) + 1 };
    },
    destroy: destroy,
    refresh: () => { if (current) { fillValues(current.view); if (current.tab !== 'status') applyTab(); else if (heroView()) refreshHeroChrome(); } },
    view: () => (current ? current.view : null),
    current: () => (current ? { tab: current.tab, friend: current.friend ? { name: current.friend.name, level: current.friend.level } : null } : null),
    /** 最近一次 open() 停在哪一步（调试 / 探针） */
    trace: () => openTrace,
    /** 格子数据源快照（调试 / 回归探针）：看的是"这一刻要画哪 10 格"。 */
    debug: () => {
      if (!current) return null;
      const info = gridInfo();
      return {
        tab: current.tab, friend: current.friend ? current.friend.name : null,
        gridPage: current.gridPage || 0,
        pages: info ? info.pages : null, page: info ? info.page : null,
        items: info ? info.items.map((x) => (x ? (x.id + (x.has ? ':' + x.level : ':-') + (x.icon ? '#' + x.icon : '')) : null)) : null,
      };
    },
  });
})();
