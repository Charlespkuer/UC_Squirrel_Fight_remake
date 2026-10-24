/* ============================================================
 * tower-plot.js — 无尽塔剧情（文本 + 播片机 + 「什么时候该播」）
 *
 * 从 js/tower-ui.js 的【U18】整块搬出来的（2026-10 用户口径：剧情单独一个文件）。
 * 这里只做三件事，**不碰任何战斗/商店逻辑**：
 *   ① STORY_SCRIPTS —— 全部剧情文本（加剧情 = 往这张表加一条，别的文件都不用动）；
 *   ② 逐行逐字播片机（storySegments / storyHtml / storyBegin / storyAdvance / storyNext …）
 *      与两种整屏渲染（storyModeHtml 剧情屏 / storyNoticeHtml 停留提示屏）；
 *   ③ 「什么时候该播」—— pending(run) 每帧问一次，due(run) 是**主动触发**用的。
 *
 * 依赖（都是 window 上的全局，加载顺序见 scripts/index.html）：
 *   · window.Tower       —— 剧情状态：storySeen / markStorySeen / clearRunStory / storyEnabled …
 *   · window.UI.classic  —— 按钮（C().btn）
 *   · window.TowerUI     —— 播完之后回主界面（openEndless），由本文件末尾回填
 *
 * ⚠ 它与 tower-ui.js 的分工：**tower-ui 负责画**（把 modeHtml() 塞进这一屏），
 *   本文件负责**决定播什么、播到第几个字、播完记什么账**。
 * ============================================================ */
(function () {
  'use strict';
  const C = () => UI.classic;
  /** 与 tower-ui.js 里那份同口径的转义（剧情正文要进 innerHTML）。 */
  const esc = (value) => String(value == null ? '' : value)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** 播完之后回主界面（tower-ui.js 末尾回填，避免两个文件互相 require）。 */
  let gotoMain = null;
  function setMainOpener(fn) { if (typeof fn === 'function') gotoMain = fn; }
  function openMain() { if (gotoMain) gotoMain(); }

  /* ============================================================
   * 【U18】剧情展示模式（2026-10 用户口径）
   *
   * 「讲一段话」专用的模式：**整屏只留塔身 + 文字 + 右下角「继续」** ——
   * 局内那一堆 UI（增益 / 减益 / 血量 / 环境 / 分数 / 铸币 / 试炼币 / 敌人预告）全都不渲染。
   * 文字在屏幕中间**逐行逐字**打出来（打字机），点「继续」：
   *   正在打字 → 立刻补完这一行；这一行打完了 → 下一行；最后一行 → 剧情结束回正常主界面。
   *
   * 加剧情**只加数据**（不用碰渲染）：往 STORY_SCRIPTS 里加一条即可
   *   { id: { once: true|false, lines: ['第一行', '第二行'] } }
   *   · once: true  一段只播一次（记在存档 `endless().storySeen` 里，例如第一次进店的商人）；
   *   · once: false 每次触发都播（例如每次攀登的开场），点几下「继续」就能跳过。
   * 行内标记（打字机按**可见字符**计数，标记本身不占字符）：
   *   **加粗**    *斜体*    {抖}这一段会抖{/抖}（也认 {shake}…{/shake}）
   *   {红}红色{/红}（也认 {red}）    {蓝}蓝色{/蓝}（也认 {blue}）
   * 字体在 css/tower.css 的 .tower-story-line 里（楷体族，跨平台回退）。
   * ============================================================ */
  const STORY_SCRIPTS = {
    /* 进塔开场：每次「开始攀登」都播（点「继续」可快速跳过）。 */
    intro: {
      once: false,
      lines: [
        '你推开无尽之塔{抖}厚重{/抖}的门扉，',
        '一行古老的文字刻在门楣上：',
        /* 「献出自身」：又加粗又染红（用户口径 2026-10）—— 嵌套写法见 storySegments。 */
        '「凡欲觐见王者，须先{红}**献出自身**{/红}。」',
        '但你无暇顾及于此，',
        '挑战在前方接踵而至。',
      ],
    },
    /* 第一次进商店前：只播一次（之后进店直接开店，不再打断节奏）。 */
    merchant: {
      once: true,
      lines: [
        '转过一处阴暗的拐角，',
        '你发现一名披着破旧斗篷的商人正坐在路边。',
        '他的面前摆满了各式各样的货物。',
        '「欢迎，勇敢的登塔者！」',
        '「只要价钱合适，这里总有你需要的东西。」',
      ],
    },
    /* 第 10 层「第二次遇到商人」：只播一次。 */
    merchant2: {
      once: true,
      lines: [
        '走廊深处，一盏孤灯微微摇曳。',
        '面容模糊的男人见你走近，缓缓打开身旁的木箱。',
        '低沉的嗓音开口道：',
        '「有些东西不该出现在这座塔里。」',
        '「不过，既然它们已经在这里了，总得有人卖出去，不是吗？」',
      ],
    },
    /* 用「立即进货」类增益开店的那一刻（E01 / 铸币版 E16）、以及**其它层**遇到商人 /
     * 触发铸币商店时：从下面这 6 段里**随机**播一段（用户口径 2026-10）。
     * 都是 `once: false`：每次遇到商人都随机来一段；同一家店只播一段
     *（`storyFinish` 会给这家店记 `shop.storyShown`，见 tower.js 的 markShopStoryShown）。
     * 固定文案只有两段：第一次遇到商人（`merchant`）与第 10 层（`merchant2`）。 */
    merchantA: {
      once: false,
      lines: [
        '前方的商人不知何时已经摆好了货摊。',
        '「哦，是你啊。」',
        '「想买些什么？今天的货还算不错。」',
      ],
    },
    merchantB: {
      once: false,
      lines: [
        '角落中现出了熟悉的手推车。',
        '商人正忙着清点货物。',
        '「别问我是怎么来到这里的，朋友。」',
        '「有些秘密，比黄金还要值钱。」',
      ],
    },
    merchantC: {
      once: false,
      lines: [
        '你刚转过拐角，便看见商人已经等在那里。',
        '「真巧，朋友。」',
        '他笑了笑，仿佛这场相遇早已在意料之中。',
      ],
    },
    merchantD: {
      once: false,
      lines: [
        '你看见商人正将一件古老的藏品放回货箱。',
        '「啊，贵客来了。」',
        '「今天想买些什么？我这里总有适合冒险者的好东西。」',
      ],
    },
    merchantE: {
      once: false,
      lines: [
        '昏暗的走廊里，一盏油灯散发着温暖的光芒。',
        '熟悉的商人坐在灯旁，向你举起酒杯。',
        '「歇歇脚吧，朋友。」',
        '「顺便看看我的货物。」',
      ],
    },
    merchantF: {
      once: false,
      lines: [
        '无论塔中的道路如何变化，你总能在某处遇见这辆熟悉的手推车。',
        '商人依旧挂着那副笑容。',
        '「欢迎光临，朋友。老规矩，先看货，再谈价。」',
      ],
    },

    /* ============================================================
     * 【U18c】无尽塔主线剧情（2026-10 用户口径，按层号/节点埋点）
     *
     * 埋点在状态机侧（js/tower.js 的 `entryStoryFor` 与 reportBattle）：
     *   · 进层（+ 该层第 1 场之前）→ `entryStoryFor(层号)`；
     *   · 整百层的第 1 / 2 / 3 场之间 → `x00stage` 记账（x00b / x00c）；
     *   · 「巡视」战斗 → 开战前 `patrolGate`（只一次）/ `patrolMeet`（重遇），
     *     胜利 `patrolWin`，失败 → 交纳之前 `patrolFailA`、交纳之后 `patrolFailB`；
     *   · 「永久献祭」→ 第一次 `sacrifice1`，之后每次从 `offerN` 里随机一段。
     * 这里**只放文本**；条件判断一律留在状态机，别把逻辑写进数据。
     * ============================================================ */

    /* —— 第 20 层：石门与天平 —— */
    gate20: {
      once: true,
      lines: [
        '前方不远处传来了沉重的机械声。{抖}机械声{/抖}',
        '一道古老的石门立于向上的去路，',
        '门上刻有「**天平与王冠**」的纹章。',
      ],
    },
    /* 第 20 层清完、离店之后、献祭**之前**（先播这段再弹献祭窗）。 */
    gate20b: {
      once: true,
      lines: [
        '古老的石门近在咫尺，',
        '石门上的天平缓缓{抖}倾斜{/抖}。',
        '一个苍老的声音从墙壁深处传来：',
        '「登塔者，献出一件{蓝}**珍宝**{/蓝}。」',
        '「这是继续向上的代价。」',
      ],
    },
    /* 第一次献祭完成、进第 21 层第 1 场之前。 */
    gate20c: {
      once: true,
      lines: [
        '藏品坠入深井，声音渐渐消失。',
        '天平恢复平衡，石门随之开启。',
      ],
    },
    /* 此后每 10 层的献供之前：从下面五段里**随机**播一段（由状态机抽签）。 */
    offer1: { once: false, lines: ['「贡井已经张开，等候新的供品。」'] },
    offer2: { once: false, lines: ['「没有馈赠，便没有通往王庭的道路。」'] },
    offer3: { once: false, lines: ['「古老的契约依然有效。请交付你的珍宝。」'] },
    offer4: { once: false, lines: ['「你带走了塔的财富。现在，塔将取回其中一部分。」'] },
    offer5: { once: false, lines: ['「你的藏品越来越少，石阶却仍向上延伸。」'] },

    /* —— 第 30 层：皮肤上的黑色纹路 —— */
    layer30: {
      once: true,
      lines: [
        '穿过石门后，你发现自己的皮肤上浮现出细小的**黑色纹路**。',
        '它们随着心跳缓缓**{抖}游动{/抖}**，随后消失不见。',
        '你感到某种力量正在苏醒。',
      ],
    },
    /* —— 第 31 层：第一次失去烙印（弹窗先停留久一点，再播这段）—— */
    layer31: {
      once: true,
      lines: [
        '一阵{抖}剧痛{/抖}突然传来。',
        '你身上的一道烙印逐渐暗淡，最终化为灰烬。',
        '仿佛有什么东西，正在将它从你的存在中抹去。',
        '黑暗中传来细若游丝的笑声，',
        '你知道这样的事情还会继续发生。',
      ],
    },
    /* —— 第 40 层：塔壁上的新纹章 —— */
    layer40: {
      once: true,
      lines: [
        '你发现塔壁上出现了新的纹章。',
        '王冠、魔眼，以及一面没有倒影的镜子。',
        '有人用剑在墙上留下了深深的**{抖}刻痕{/抖}**：',
        '「{红}**王**{/红}已经知道你来了。」',
      ],
    },

    /* —— 60/70/80/90 的征战动物 boss（挂在最后一战之前）—— */
    boss60: {
      once: true,
      lines: [
        '石门内传来细碎的抓挠声。',
        '一只披着暗色甲胄的兔影从石柱后探出头。',
        '「狡兔三窟……你以为追到这里，就算找到我了？」',
        '它的长耳轻轻一抖，四周的岔路同时亮起红光。',
      ],
    },
    boss70: {
      once: true,
      lines: [
        '一声狼嚎震得塔壁上的灰尘簌簌落下。',
        '铁链拖地，暗御狼王从阴影里走出。',
        '「能走到这里，你的骨头应该很硬。」',
        '它压低身形，獠牙间漏出白气。',
      ],
    },
    boss80: {
      once: true,
      lines: [
        '空气里浮起淡紫色的狐火。',
        '妖狐倚在断裂的栏杆上，尾巴轻轻扫过地面。',
        '「别紧张，我只是想看看……你的心是不是也这么硬。」',
        '狐火在她身后聚成一只巨大的眼睛。',
      ],
    },
    boss90: {
      once: true,
      lines: [
        '石柱尽头传来沉重的脚步声。',
        '暗御猿将把巨斧往地上一顿，整层塔都震了一下。',
        '「王座之前，只剩我这一关。」',
        '它抬起覆满旧伤的手臂，挡住了向上的路。',
      ],
    },

    /* —— 巡视（路上偶遇的魔王）—— */
    patrolGate: {
      once: true,
      lines: [
        '「又一位登塔者。」',
        '「很好，让我看看你已经走到了哪一步。」',
      ],
    },
    patrolMeet: {
      once: false,
      lines: [
        '「我们又见面了，登塔者。」',
        '「我想看看，你是否变得更加值得期待。」',
      ],
    },
    /* 第 2 次及以后每次偶遇各播一段（`duePatrol` 按 `run.patrolMeetNo` 找下一段）。
     * 都是 `once: false`：它们是「这一局讲完就翻篇」的，**不写进存档的「只播一次」表** ——
     * 段号记在**这一局**上（`run.patrolMeetNo`），所以一局之内每段只讲一次、
     * 下一局从头再讲一遍（旧版本靠 seen 编号来推进，而 once:false 永远记不上 seen，
     * 于是固定返回同一段 → 玩家怎么点都进不了战斗，用户报的那个死循环）。 */
    patrolMeet2: {
      once: false,
      lines: [
        '「你的步伐比上次更稳了。」',
        '「可惜，塔从不为谁放慢。」',
      ],
    },
    patrolMeet3: {
      once: false,
      lines: [
        '「我数过你留下的脚印。」',
        '「比大多数登塔者都深。」',
      ],
    },
    patrolMeet4: {
      once: false,
      lines: [
        '「你身上带着塔的碎片。」',
        '「很好 —— 继续往上带吧。」',
      ],
    },
    patrolMeet5: {
      once: false,
      lines: [
        '「每一次上来，你都少了一点什么。」',
        '「你自己发现了吗？」',
      ],
    },
    patrolMeet6: {
      once: false,
      lines: [
        '「再往上，就不再是试炼了。」',
        '「那时我也不会再留手。」',
      ],
    },
    patrolMeet7: {
      once: false,
      lines: [
        '「你听见王座的声音了吗。」',
        '「它已经在等你了。」',
      ],
    },
    patrolMeet8: {
      once: false,
      lines: [
        '魔王只是看着你，没有再多说什么。',
      ],
    },
    patrolFailA: {
      once: false,
      lines: [
        '魔王收起武器。',
        '你已经无力继续战斗，但他似乎并不打算取走你的性命。',
        '「尚且如此弱小，却敢觊觎我的王座。」',
        '「交出一件藏品。我准许你继续前进。」',
      ],
    },
    patrolFailB: {
      once: false,
      lines: [
        '魔王接过你的藏品，随手将其投入身后的黑暗之中。',
        '「我会替你保管它。」',
        '「若你真能抵达王庭，我们还会再见。」',
        '他的身影逐渐消失。',
        '通向下一场战斗的道路重新打开。',
      ],
    },
    patrolWin: {
      once: false,
      lines: [
        '魔王缓缓低下头，审视着自己破碎的倒影。',
        '片刻后，他发出低沉的笑声。',
        '「很好！胜者理应得到奖赏。」',
        '他挥手打开一道漆黑的宝库之门。',
        '「拿去吧。这是王的馈赠。」',
      ],
    },

    /* —— 临近王庭 —— */
    layer90: {
      once: true,
      lines: [
        '四周的石壁开始出现裂痕。',
        '你看到裂缝中流动着暗红色的光芒，仿佛整座塔都拥有自己的血脉。',
      ],
    },
    layer95: {
      once: true,
      lines: [
        '古老的壁画描绘着七国联军与魔王的战争。',
        '但最后一幅画已被破坏。',
        '残存的部分依稀可见一座高塔，以及被锁链束缚的**黑色王冠**。',
      ],
    },
    /* 第 100 层：王庭与第一近卫（第 1 场之前）。
     * ⚠ 下面这五段（layer100 / x00a / x00b / x00c / x00win）都是 `once: false`：
     * 整百层是「每 100 层重来一次」的循环事件（照影之境每轮叠一层），所以这一套
     * **每次到达整百层都讲一遍** —— 判据是 run 上的 `x00PreNo` / `x00stage`，
     * 不是存档的 seen 表（用 seen 判的话，第二次爬到 100 层、或从 101 层挪回 100 层，
     * 「王庭 / 第一近卫」就再也看不到了 —— 用户报的「被吞掉」）。 */
    layer100: {
      once: false,
      lines: [
        '巨大的王庭矗立在塔顶。',
        '漆黑的王座高悬于殿堂尽头，数百盏幽蓝色的火焰照亮了空旷的大殿。',
        '魔王端坐于王座之上，静静俯视着你。',
        '「你终于来了。」',
        '「不过，想要觐见真正的王，还需经过最后的试炼。」',
      ],
    },
    x00a: {
      once: false,
      lines: [
        '一名披覆重甲的骑士从王座左侧走出。',
        '他拔出巨剑，缓缓指向你。',
        '「吾乃王之第一近卫。」',
        '「奉王之命，终结你的旅途。」',
      ],
    },
    x00b: {
      once: false,
      lines: [
        '王座右侧的黑暗中，一名身披祭袍的身影缓缓现身。',
        '无数刻有陌生名字的石片，在它身旁浮动。',
        '「吾乃王之第二近卫。」',
        '「登塔者，将你的名字留在这里吧。」',
      ],
    },
    x00c: {
      once: false,
      lines: [
        '三道古老的封印在王座后方依次破碎。',
        '原本微弱的黑色火焰骤然升腾，照亮整个王庭。',
        '一道道黑色裂缝在空中张开。',
        '你曾经战败时交出的藏品，从中一件件浮现。',
        '「昔日的封印，如今已化为我的三重王命。」',
        '「来吧，勇者。」',
        '「让我看看，你是否有资格终结我的统治！」',
      ],
    },
    x00win: {
      once: false,
      lines: [
        '王冠碎裂，最后一枚宝石失去了光芒。',
        '魔王缓缓倒下。',
        '「原来如此……」',
        '「我能够夺取你的力量，却始终无法成为你。」',
        '「这便是……我的败因吗……」',
        '他的身躯逐渐化作黑色的灰烬。',
        '王庭中的火焰接连熄灭。',
        '在漫长的沉寂之后，你听见塔外传来了风声。',
        '那是无数年来，第一次有风吹进王庭。',
      ],
    },
  };
  /** 打字机速度（毫秒/字）。 */
  const STORY_CHAR_MS = 42;
  /** 剧情 → 主界面的淡出时长（毫秒）；主界面那半边的淡入由 CSS 的 .tower-fade-in 负责。 */
  const STORY_FADE_MS = 150;
  /** 当前正在播的那段剧情：{ id, once, line, chars, lines:[{segs,total}], timer }。 */
  let storyState = null;
  /** 上一次铺到 DOM 的行号：同一行打字时只改 `.now` 这一行，不重解析前面已完成的整段。 */
  let paintedStoryLine = -1;
  /** 这一屏是不是**正在播剧情**（openEndless 里判：剧情屏上不弹献祭窗、不飘过程提示）。
   *  每次重画 openEndless 都会按 `pendingStory` 重新置位。 */
  let storyShowing = false;
  /** 刚播完剧情：下一次 openEndless 让整页淡入（而不是硬切）。 */
  let storyFadeIn = false;
  function storyScript(id) {
    const s = STORY_SCRIPTS[id];
    return s && Array.isArray(s.lines) && s.lines.length ? s : null;
  }
  /** 「随机商人文案」的池子（2026-10 用户口径）：除了第一次遇商人（`merchant`）与第 10 层
   * （`merchant2`）那两段固定对话，**其它每一次**遇到商人 / 触发铸币商店都从这里随机来一段。
   * 顺序即数据里的书写顺序；`merchantIdlePick` 用 `Math.random()` 等概率抽（QA 固定随机流时同样可复现）。 */
  const MERCHANT_IDLE_POOL = ['merchantA', 'merchantB', 'merchantC', 'merchantD', 'merchantE', 'merchantF'];
  /** 随机抽一段商人文案；池子里一条都没有时返回 null（那时照旧不打断节奏）。
   *  ⚠ 【稳定性】`pendingStoryOf` 每次重画都会问一遍「这家店该播哪段」——
   *  每次都重摇的话，界面正在打字的那一段会被换成另一段（打字机永远打不完＝死循环，
   *  机器人实测过）。所以**第一次摇中就把段号记在这家店上**（`shop.storyPick`，见
   *  tower.js 的 setShopStoryPick），之后这一家店一直用它；换一家店才重摇。
   *  固定文案（第一次 / 第 10 层）本来就稳定，不走这里。 */
  function merchantIdlePick(run) {
    const list = MERCHANT_IDLE_POOL.filter((id) => storyScript(id));
    if (!list.length) return null;
    const fixed = run && run.shopStoryPick;
    if (fixed && list.indexOf(fixed) >= 0) return fixed;
    const pick = list[Math.max(0, Math.min(list.length - 1, Math.floor(Math.random() * list.length)))];
    try { Tower.setShopStoryPick(pick); } catch (e) {}
    return pick;
  }
  /** 把一行拆成 [{text, bold, italic, shake, red, blue}]（标记本身不进 text，打字机只数可见字符）。
   *  支持 **加粗** / *斜体* / {抖}抖动{/抖}（也认 {shake}）/ {红}红色{/红}（也认 {red}）/
   *  {蓝}蓝色{/蓝}（也认 {blue}），并且**可以嵌套**：
   *  例如 `{红}**献出自身**{/红}` = 又红又粗、`{蓝}**珍宝**{/蓝}` = 又蓝又粗。
   *  没写收尾标记的当普通文字。 */
  function storySegments(line) {
    const segs = [];
    const TAG_KEYS = { shake: 'shake', 抖: 'shake', 抖动: 'shake', red: 'red', 红: 'red', blue: 'blue', 蓝: 'blue' };
    const push = (text, tags) => { if (text) segs.push(Object.assign({ text: text }, tags)); };
    const walk = (text, style) => {
      const re = /\*\*|\*|\{([A-Za-z\u4e00-\u9fa5]+)\}/g;
      let m, last = 0;
      while ((m = re.exec(text))) {
        let inner = null, after = 0, key = null;
        if (m[0] === '**' || m[0] === '*') {
          const close = m[0];
          const end = text.indexOf(close, re.lastIndex);
          if (end < 0) continue;                       // 没有收尾 → 当普通文字
          inner = text.slice(re.lastIndex, end);
          after = end + close.length;
          key = m[0] === '**' ? 'bold' : 'italic';
        } else {
          key = TAG_KEYS[m[1]];
          const close = '{/' + m[1] + '}';
          const end = key ? text.indexOf(close, re.lastIndex) : -1;
          if (end < 0) continue;
          inner = text.slice(re.lastIndex, end);
          after = end + close.length;
        }
        push(text.slice(last, m.index), style);
        walk(inner, Object.assign({}, style, { [key]: true }));
        last = after;
        re.lastIndex = after;
      }
      push(text.slice(last), style);
    };
    walk(String(line == null ? '' : line), {});
    return segs;
  }
  /** 按「已打出的字符数」把一行渲染成 HTML（加粗 / 斜体 / 抖动 / 红色在这里落地）。 */
  function storyHtml(segs, chars) {
    let left = Math.max(0, chars), out = '';
    for (const seg of segs) {
      if (left <= 0) break;
      const text = seg.text.slice(0, left);
      left -= text.length;
      if (!text) continue;
      let html = esc(text);
      if (seg.italic) html = '<i>' + html + '</i>';
      if (seg.bold) html = '<b>' + html + '</b>';
      if (seg.red) html = '<span class="tower-story-red">' + html + '</span>';
      if (seg.blue) html = '<span class="tower-story-blue">' + html + '</span>';
      if (seg.shake) html = '<span class="tower-story-shake">' + html + '</span>';
      out += html;
    }
    return out;
  }
  /** 这一屏该不该走剧情。优先级：
   *   ① 状态机 / 点「开始攀登」时挂上的 `run.story`（含入场、巡视、献祭、整百层段间；
   *      献祭前那一段也走这里 —— 所以「一离开商店就弹献祭窗」不会抢在剧情前面）；
   *   ② `run.pendingStoryId`：**延迟一步**的那类（第一次失去烙印：先让提示窗停留，再播剧情）；
   *   ③ 用「立即进货」类增益开的店 → 铃声那段（每次开店都播）；
   *   ④ 第一次遇到商人（商店阶段 + 还没播过）；
   *   ⑤ 第 10 层第二次遇到商人（第一次已经播过、这段还没播过）。
   *  **挑战模式**（首页左下角那颗按钮）下一律返回 null —— 所有文字剧情都跳过。 */
  function pendingStory(run) {
    const id = pendingStoryOf(run);
    /* 【U18c】「这一屏是不是剧情屏」**每次重画都按这次的判定重新置位**：
     * 界面靠 `TowerPlot.showing()` 决定「这时候能不能弹献祭窗 / 飘过程提示」
     *（见 tower-ui 的 openEndless）。少了这一句，献祭弹窗会叠在剧情屏上、
     * 剧情被抢跑，`storySeen` 也记不上 —— 那几段于是每次走到这里都被当成「还没播过」。
     * 「停留提示屏」（第一次失烙印的「先提示、后剧情」）同样算剧情屏：它上面也不该叠弹窗。 */
    storyShowing = !!(id || (run && run.pendingStoryId && run.pendingStoryHold));
    return id;
  }
  /** 上面那层的**纯判定**（`storyShowing` 的置位单独拎在 pendingStory 里）。
   *  ⚠ 这里**不许改 run 上的任何东西**：界面拿到的是 `endlessInfo()` 的快照，
   *  改了也传不回真状态（历史上就因此把下面那个「停留提示屏」变成了永远走不到的死分支）。 */
  function pendingStoryOf(run) {
    if (!run) return null;
    if (!Tower.storyEnabled()) return null;
    /* ① 延迟一步的那类（第一次失去烙印）：先让「碎掉的烙印失效」那个提示屏**停留**，
     *    玩家点掉它（`TowerPlot.next` → `clearRunStoryHold`）之后，下一屏才播剧情。
     *    这里返回 null 就是「这一屏交给提示屏」，标记本身由界面那颗「继续」去清。 */
    if (run.pendingStoryId && run.pendingStoryHold) return null;
    if (run.pendingStoryId) {
      const pend = storyScript(run.pendingStoryId);
      /* ⚠ 兜底：只播一次的那一段已经播过了就别再交给界面 —— 待播槽万一残留（旧档 /
       * 历史上「连播时没清槽」那个 bug 存下来的存档），它会排在 `run.story` 前面，
       * 把剧情屏锁死在同一段上（用户报的「不停触发、卡死界面」）。 */
      if (pend && pend.once && Tower.storySeen(run.pendingStoryId)) return null;
      return pend ? run.pendingStoryId : null;
    }
    if (run.story) return storyScript(run.story) ? run.story : null;
    /* 商人那两段**只在商店阶段**播（用户实测过的坏味道：第 20 / 30 / 40 层反复冒出商人文案 ——
     * 根因不在条件写错，而是剧情被「战斗抢跑」打断、`storySeen` 一直没记上，
     * 于是每到商店阶段都当成「第一次」。修好开战顺序之后，它们各只播一次。
     * ⚠ 这里**不要**再加层号门槛：商店本来就可能出现在任何层（第 1 层的开场商店也算），
     * 加了门槛会把「第一次进店」也挡掉。 */
    if (run.phase === 'shop') {
      /* 这家店已经讲过了（`once:false` 的随机商人文案条件一直成立，不记就会一段接一段地播）。 */
      if (run.shopStoryShown) return null;
      /* 「立即进货」（E01）/「铸币商队」（E16 铸币商店）开店那一刻：从随机池里来一段。 */
      if (run.shopByBuff) return merchantIdlePick(run);
      const seenFirst = Tower.storySeen('merchant');
      const seenSecond = Tower.storySeen('merchant2');
      /* ① 第一次遇到商人：固定文案（只播一次）。 */
      if (!seenFirst && !seenSecond && storyScript('merchant')) return 'merchant';
      /* ② 第 10 层第二次遇商人：固定文案（只播一次）。 */
      if (seenFirst && !seenSecond && (Number(run.layer) || 1) >= 10 && storyScript('merchant2')) return 'merchant2';
      /* ③ 其余每一次「遇到商人 / 触发铸币商店」：6 段里**随机**来一段（用户口径 2026-10）。
       *    ⚠ 必须真的有**店对象**（`run.hasShop`，由 endlessInfo 投影过来）：
       *    `shop.storyShown` 是记在店上的，没有店就记不上，那样这家「店」会无限重播 ——
       *    历史上「一直触发剧情、进不了战斗」那类死循环就是这么来的。
       *    真实流程里 `phase === 'shop'` 一定伴着店对象（开店才会挂 phase），这条只是兜底。 */
      if (!run.hasShop) return null;
      return merchantIdlePick(run);
    }
    return null;
  }
  function storyStopTimer() {
    if (storyState && storyState.timer) { clearTimeout(storyState.timer); storyState.timer = null; }
  }
  /** 开始播某段（已经在播同一段就保持进度，不重头来）。 */
  function storyBegin(id) {
    const script = storyScript(id);
    if (!script) return null;
    if (storyState && storyState.id === id) return storyState;
    storyStopTimer();
    const lines = script.lines.map((raw) => {
      const segs = storySegments(String(raw));
      return { segs: segs, total: segs.reduce((n, s) => n + s.text.length, 0) };
    });
    storyState = { id: id, once: !!script.once, line: 0, chars: 0, lines: lines, timer: null };
    paintedStoryLine = -1;
    return storyState;
  }
  /** 已播出的文字（前面几行整行 + 当前行已打出的部分 + 光标）。 */
  function storyBodyHtml() {
    const st = storyState;
    if (!st) return '';
    const out = [];
    for (let i = 0; i < st.line; i++) {
      out.push('<p class="tower-story-line done">' + storyHtml(st.lines[i].segs, st.lines[i].total) + '</p>');
    }
    const cur = st.lines[st.line];
    out.push('<p class="tower-story-line now">' + storyHtml(cur.segs, st.chars) +
      '<span class="tower-story-caret" aria-hidden="true"></span></p>');
    return out.join('');
  }
  /** 让「正在打的那一行」始终完整露出来 —— 剧情页文字太长时自动往下带（用户口径 2026-10）。
   *
   *  为什么必须每次重画都带一次：`storyPaint()` 是**整块重写** `innerHTML`，
   *  浏览器会把滚动位置归零；不重新带一次，长剧情页的末尾几行就永远停在屏幕外
   *  （用户实测：最后一行打出来了，但看不见）。
   *
   *  只往下带、不动已经能看见的部分：算「当前行底部 + 一点余量」超出可视区多少就滚多少，
   *  并夹在 `0 ~ scrollHeight-clientHeight` 之间；文字装得下时目标 ≤ 0 → 回到顶部（居中排版由 CSS 负责）。 */
  function storyScrollToCursor(box) {
    if (!box || typeof box.scrollTop !== 'number') return;
    const now = typeof box.querySelector === 'function' ? box.querySelector('.tower-story-line.now') : null;
    if (!now) return;
    const bottom = Number(now.offsetTop || 0) + Number(now.offsetHeight || 0) + 8;   // 8 = 给光标留一点呼吸
    const max = Math.max(0, Number(box.scrollHeight || 0) - Number(box.clientHeight || 0));
    const want = Math.max(0, Math.min(bottom - Number(box.clientHeight || 0), max));
    if (box.scrollTop !== want) box.scrollTop = want;
  }
  /** 只重画文字节点（打字机每 tick 调它，不整页重画）。 */
  function storyPaint() {
    const st = storyState;
    if (!st || typeof document === 'undefined' || !document || typeof document.querySelector !== 'function') return;
    const box = document.querySelector('[data-story-text]');
    if (!box) return;
    /* 同一行只更新当前 `<p>`（打字机每 42ms 一次）；换行/跳行才重铺整段。
     * 以前每打一个字都 `innerHTML = storyBodyHtml()`，长剧情 O(n²) 且每 tick 丢滚动位置。 */
    if (paintedStoryLine !== st.line) {
      box.innerHTML = storyBodyHtml();
      paintedStoryLine = st.line;
    } else {
      const now = typeof box.querySelector === 'function' ? box.querySelector('.tower-story-line.now') : null;
      const cur = st.lines[st.line];
      if (now && cur) now.innerHTML = storyHtml(cur.segs, st.chars) +
        '<span class="tower-story-caret" aria-hidden="true"></span>';
      else { box.innerHTML = storyBodyHtml(); }
    }
    storyScrollToCursor(box);
  }
  /** 打字机：打出一个字，然后排下一个 tick。 */
  function storyTick() {
    const st = storyState;
    if (!st) return;
    const cur = st.lines[st.line];
    if (!cur) { storyFinish(); return; }
    st.timer = null;
    if (st.chars < cur.total) {
      st.chars += 1;
      storyPaint();
      if (st.chars < cur.total) st.timer = setTimeout(storyTick, STORY_CHAR_MS);
      return;
    }
  }
  /** 点「继续」：补完这一行 → 下一行 → 结束。 */
  function storyAdvance() {
    const st = storyState;
    if (!st) return;
    const cur = st.lines[st.line];
    storyStopTimer();
    if (cur && st.chars < cur.total) {           // ① 还在打字 → 立刻补完这一行
      st.chars = cur.total;
      storyPaint();
      return;
    }
    if (st.line + 1 < st.lines.length) {         // ② 下一行
      st.line += 1;
      st.chars = 0;
      storyPaint();
      st.timer = setTimeout(storyTick, STORY_CHAR_MS);
      return;
    }
    storyFinish();                              // ③ 最后一行 → 剧情结束
  }
  /** 剧情播完：记「只播一次」、清掉待播标记，然后**淡出→淡入**切回正常主界面。
   *  【2026-10 用户口径】不要硬切：文字先快速淡出（~150ms），主界面再淡入（~190ms，见 CSS）。
   *  【U18c】整百层「觐见魔王」是**连着好几段**（王庭 → 第一近卫 → 第二近卫 → 三重王命）——
   *  一段播完先问状态机「这一场还有下一段吗」，有就直接接上（中间不回主界面），
   *  否则才淡出回主界面。 */
  function storyFinish() {
    const st = storyState;
    storyStopTimer();
    storyState = null;
    paintedStoryLine = -1;
    if (st && st.once) { try { Tower.markStorySeen(st.id); } catch (e) {} }
    /* 【U20d】店里的商人文案：给**这家店**记一笔「已经讲过了」（`markShopStoryShown`）——
     *   · `once:false` 的随机商人文案（6 段）条件一直成立：不记就会在同一家店里
     *     一段接一段地播（就是「一直触发剧情」那类死循环）；
     *   · `once:true` 的固定商人文案（第一次 / 第 10 层）也要记：否则它刚播完，
     *     下面「随机商人文案」就会立刻接上，第一次遇商人会连播两段。
     *  不在商店阶段 / 没有店时 `markShopStoryShown` 自己返回 false，不影响别的剧情。 */
    if (st) { try { Tower.markShopStoryShown('endless'); } catch (e) {} }
    /* 【必须先做这一步】把「延迟一步」那个待播槽消费掉（`pendingStory` / `pendingStoryHold`）：
     * 它只负责「把某一段排到下一屏」，这一段都播完了，它就该空了 ——
     * ⚠ 漏掉这一步会在**连播**时死循环：整百层（第 100 / 200… 层）是「一段接一段」的，
     * 走下面 `next` 那一支时**不会**经过 `clearRunStory`，残留下来的待播槽会在
     * `pendingStoryOf` 里**永远排在 `run.story` 前面**（它的优先级更高）→
     * 同一段剧情反复重播、界面停在剧情屏上出不来。
     * 实测就是用户报的「第一次烙印破碎的文案不停触发、卡死界面」：第 100 层第一次失烙印
     * 时待播槽是 `layer31`、连播链是 `layer100 → x00a → …`，layer31 播完后槽还在，
     * 于是每次重画都重播 layer31，王庭那一段永远轮不到。 */
    try { Tower.clearRunStoryPending ? Tower.clearRunStoryPending('endless') : null; } catch (e) {}
    /* 多段剧情：把下一段接上（`nextEntryStory` 会按 storySeen 自动跳过已播的）。 */
    let next = null;
    try { next = Tower.nextEntryStoryOf ? Tower.nextEntryStoryOf() : null; } catch (e) { next = null; }
    if (next && storyScript(next)) {
      try { Tower.setRunStory('endless', next); } catch (e) {}
      if (typeof document !== 'undefined' && document && typeof document.querySelector === 'function') {
        const box = document.querySelector('[data-story-text]');
        if (box && box.classList) box.classList.add('tower-story-leaving');
      }
      setTimeout(() => { storyBegin(next); openMain(); }, STORY_FADE_MS);
      return;
    }
    try { Tower.clearRunStory('endless'); } catch (e) {}
    storyFadeIn = true;                 // 下一次重画主界面时整页淡入（见 tower-ui 的 fadeIn）
    if (typeof document !== 'undefined' && document && typeof document.querySelector === 'function') {
      const box = document.querySelector('[data-story-text]');
      if (box && box.classList) box.classList.add('tower-story-leaving');
    }
    setTimeout(() => { openMain(); }, STORY_FADE_MS);
  }
  /** 【U18c】「停留一下」的剧情式提示屏：与剧情屏同一套排版（楷体居中），
   *  但**没有打字机** —— 用于「第一次失去烙印」那一条
   *（用户口径：这个弹窗要停留得久一些，然后才播剧情）。
   *  【2026-10 用户口径】右下角那颗「继续」按钮**已经去掉**：点屏幕任意位置推进
   *  （整屏点击处理器挂在 tower-ui 的 `openEndless` 里，走的是同一个 `TowerPlot.next()`）。 */
  function storyNoticeHtml(title, inner) {
    return '<div class="tower-story">' +
        '<div class="endless-title-row"><h2 class="tower-title">' + esc(title) + '</h2></div>' +
        '<div class="tower-story-text">' + inner + '</div></div>';
  }
  /** 剧情模式的整屏内容：留着**标题**（无尽塔 · 第 x 层），文字**没有边框**地居中打字。
   *  左下标「第 m/n 行」按用户口径去掉（要沉浸感）；
   *  右下角那颗「继续」也按 2026-10 用户口径去掉 —— 点屏幕任意位置继续（见 storyNoticeHtml 的注释）。 */
  function storyModeHtml(st, layer) {
    if (!st) return '';
    const body = '<div class="tower-story">' +
        '<div class="endless-title-row"><h2 class="tower-title">无尽塔 · 第 ' +
          Math.max(1, Math.floor(Number(layer) || 1)) + ' 层</h2></div>' +
      '<div class="tower-story-text" data-story-text>' + storyBodyHtml() + '</div></div>';
    /* 页面每次重画都重新起一次打字机（已经在跑的不要重排）。 */
    storyStopTimer();
    const cur = st.lines[st.line];
    if (cur && st.chars < cur.total) st.timer = setTimeout(storyTick, STORY_CHAR_MS);
    else if (cur && st.chars === 0 && cur.total === 0) st.timer = setTimeout(storyTick, STORY_CHAR_MS);
    return body;
  }
  /** 整页画完之后补一次「让当前行露出来」——由 tower-ui 在 `C().page(...)` 之后**同步**调用。
   *  页面重画会把 `[data-story-text]` 整个换掉（滚动位置归零），而这一屏可能已经打完了
   *  （没有下一次 tick 来带滚动），所以需要这个入口。用同步调用而不是 setTimeout：
   *  测试里可以把定时器换成可控队列，多插一个定时器会打乱打字机的节奏。 */
  function storyAfterRender() {
    try {
      if (typeof document === 'undefined' || !document || typeof document.querySelector !== 'function') return;
      storyScrollToCursor(document.querySelector('[data-story-text]'));
    } catch (e) {}
  }

  /* ============================================================
   * 【U18b】剧情 / 挑战模式开关（无尽首页左下角那颗按钮，2026-10 用户口径）
   *   · 剧情模式：所有剧情节点照常播（进塔开场、遇商人的几段…）；
   *   · 挑战模式：**跳过所有文字剧情**，直接进战斗与商店。
   * 按钮上写的是**当前**模式（点一下切到另一个），悬停给这个模式的具体说明。
   * 状态存在存档 `endless().storyOn` 上（默认 true = 剧情模式），见 Tower.storyEnabled。
   * ============================================================ */
  const STORY_MODE_TIPS = {
    on: '剧情模式：\n· 进塔开场、第一次与第二次遇到商人、用「立即进货」开店…这些节点会先播剧情（点「继续」推进，正在打字时点一下会立刻补完这一行）\n· 点这颗按钮切到「挑战模式」，之后不再播任何文字剧情',
    off: '挑战模式：\n· 跳过所有文字剧情，直接进战斗与商店（进塔不再有开场，遇商人不打断节奏）\n· 已经看过的剧情不会被重新播放，但「立即进货」这类每次都播的剧情也会一并跳过\n· 点这颗按钮切回「剧情模式」',
  };
  function storyModeButtonHtml() {
    const on = !!(window.Tower && Tower.storyEnabled && Tower.storyEnabled());
    const tip = on ? STORY_MODE_TIPS.on : STORY_MODE_TIPS.off;
    return '<span class="endless-mode-toggle" data-tip="' + esc(tip) + '" title="' + esc(tip) + '" tabindex="0">' +
      C().btn(on ? '剧情模式' : '挑战模式', 'story-mode', 'gold') + '</span>';
  }
  /* ============================================================
   * 【P2】「什么时候该播」—— 主动触发（due）与逐帧询问（pending）
   *
   * 用户口径 2026-10：
   *   · 到特定层**直接触发**剧情，不需要先点一次「继续战斗」；
   *   · 「巡视」那一场之前同样直接触发；
   *   · 但**不能反复触发**到打不了架（旧版本在这里死循环过）。
   * 这两件事靠同一份判定 + 一组记账保证：due() 只在「该播且还没播过」时返回 id，
   * 播完/挂上待播之后同一条路再问就永远是 null。
   * ============================================================ */

  /** 这一层刚进去就该播的剧情（按层号；播过就不再返回）。整百层那一段也在这里。
   *  ⚠ 只在**本层第 1 场还没打**时算数（`run.idx === 0`）：它本来就是「第 1 场战斗之前」
   *  那一段。这一条同时管住两头 ——
   *    · 「到层直接播」：进层那一刻 idx 就是 0，判定立刻成立；
   *    · 「不许补播」：已经打过第 1 场的存档（旧档 / 剧情被打断过）不会在商店、献祭、
   *      结算点这些**战后那一屏**上突然冒出「石门 / 纹章」那几段。 */
  function dueEntry(run) {
    if (!run) return null;
    if (Math.max(0, Math.floor(Number(run.idx) || 0)) !== 0) return null;
    const plan = Array.isArray(run.plan) ? run.plan : [];
    const first = plan[0];
    const id = first && first.entryStory;
    if (!id) return null;
    if (id !== 'x00stage') return Tower.storySeen(id) ? null : id;
    /* 整百层：问状态机「这一层的王庭 / 第一近卫讲到哪里了」（唯一判据，别再抄一份）。
     * 判据是 `run.x00PreNo`（每次到达整百层都重讲一遍），**不看**存档的 `storySeen`——
     * 详见 tower.js 的 x00BeforeFirst 与本文件顶部的说明。 */
    try { return Tower.x00BeforeFirstOf ? Tower.x00BeforeFirstOf() : null; } catch (e) { return null; }
  }

  /** 60/70/80/90 的征战 boss：**只在轮到第 5 场时**播它的开场。
   *  这四段是 `once:true`，靠存档 seen 表各播一次；不会在进层那一刻抢在三侠前面，
   *  也不会在打完 boss / 清层之后补播。 */
  function dueCampaignBoss(run) {
    if (!run || !Tower.storyEnabled()) return null;
    const idx = Math.max(0, Math.floor(Number(run.idx) || 0));
    if (idx !== 4) return null;
    const plan = Array.isArray(run.plan) ? run.plan : [];
    const entry = plan[4];
    if (!entry || entry.kind !== 'campaign') return null;
    const layer = Math.max(1, Math.floor(Number(run.layer) || 1));
    const id = 'boss' + layer;
    if (Tower.storySeen(id)) return null;
    return storyScript(id) ? id : null;
  }

  /** 这一层里「巡视」那一场之前要播的（首次 `patrolGate`，之后每次偶遇一段 `patrolMeetN`）。
   *
   *  ⚠ 三条硬约束 —— 旧版本在这里踩出了用户报的「一直触发剧情、进不了战斗」：
   *   ① **只在轮到巡视那一场时才返回**：`run.idx` 指着的就是它（它常常不是本层第 1 场，
   *      所以必须等走到这一场，而不是进层就播）；
   *   ② **一次偶遇只讲一段**：本层已经给过巡视剧情就不再返回（记账 `run.patrolStoryAt`）——
   *      少了这一条，读完一段马上又判出下一段，界面永远停在剧情屏上，怎么点都开不了打；
   *   ③ **段号记在 run 上**（`run.patrolMeetNo`），**不靠** `Tower.storySeen`：
   *      `patrolMeet*` 属于「每次都播」的那一类（`once:false`），播完不会写进存档的 seen 表
   *      （`storyFinish` 只给 `once:true` 记账）→ 旧版本于是**永远判出同一段**，
   *      这正是死循环的真因。段号放在 run 上还顺带保证：一局之内每段只讲一次，
   *      下一局从头再讲一遍。
   *  段号在 1..PATROL_MEET_MAX 之间**循环**：讲完一轮从头再讲（见下面的 duePatrol）——
   *  以前「编号走到没有下一段就返回 null」，长局里就表现为「从某一层起巡视再也没有剧情」。 */
  const PATROL_MEET_MAX = 8;
  function duePatrol(run) {
    if (!run) return null;
    const plan = Array.isArray(run.plan) ? run.plan : [];
    const idx = Math.max(0, Math.floor(Number(run.idx) || 0));
    const entry = plan[idx];
    if (!entry || entry.kind !== 'patrol' || entry.x00) return null;
    const layer = Math.max(1, Math.floor(Number(run.layer) || 1));
    if (Math.floor(Number(run.patrolStoryAt) || 0) === layer) return null;   // 这一层已经讲过了
    if (!Tower.storySeen('patrolGate')) return 'patrolGate';
    /* 段号在 1..PATROL_MEET_MAX 之间**循环**：讲完第 8 段就从头再讲一段。
     * ⚠ 以前走到第 9 段就返回 null（「故事讲完了」）—— 短局看不出来，长局里就是
     * 「从某一层起巡视再也没有剧情」（机器人实测：第 163 层之后再没播过，用户报的
     * 「巡视被吞掉」正是这一类）。用户口径是**每次偶遇都要有剧情**，所以改成循环。 */
    const next = Math.max(0, Math.floor(Number(run.patrolMeetNo) || 0)) + 1;
    const n = ((next - 1) % PATROL_MEET_MAX) + 1;
    const id = n <= 1 ? 'patrolMeet' : ('patrolMeet' + n);
    return storyScript(id) ? id : null;      // ⚠ 这里必须调 storyScript：`script` 不是本文件的函数名
  }

  /** **主动触发**：现在有该播的剧情吗（进层 / 巡视 / 整百层段间）。
   *  返回 id 时调用方负责把它落到 run.story 并重画界面。
   *
   *  ⚠ 判据里那两条「不补播」的闸（`phase` / 本层已清空）是**必须**的：
   *  due() 现在会被界面每次重画都问一遍（到层就直接播，见 tower-ui 的 openEndless），
   *  没有它们的话，「第一场战斗之前」的那两段会在商店 / 献祭 / 结算点那一屏上被补播 ——
   *  而那时玩家手上根本没有「下一场战斗」。 */
  function due(run) {
    if (!run) return null;
    if (!Tower.storyEnabled()) return null;
    if (run.story || run.attempt || run.choices) return null;
    /* 正处在离店 / 结算 / 献祭这些**战后阶段**：这一层已经没有「战斗之前」了。 */
    if (run.phase) return null;
    /* 本层已经清空（快照 `finished` 指的就是这一层）：同上，别再补播入场剧情。 */
    if (run.finished && Math.floor(Number(run.finished.layer) || 0) === Math.floor(Number(run.layer) || 0)) return null;
    const entry = dueEntry(run);
    if (entry) return entry;
    const boss = dueCampaignBoss(run);
    if (boss) return boss;
    return duePatrol(run);
  }

  /* 剧情屏上那颗「继续」：正在播就推进；只是在「停留提示」屏上就放行（见 pending 的第 ② 步）。 */
  function next() {
    if (!storyState) {
      try { Tower.clearRunStoryHold ? Tower.clearRunStoryHold() : null; } catch (e) { /* 忽略 */ }
      openMain();
      return;
    }
    storyAdvance();
  }

  window.TowerPlot = {
    /* 文本与解析 */
    SCRIPTS: STORY_SCRIPTS,
    script: storyScript,
    segments: storySegments,
    html: storyHtml,
    /* 播片机 */
    pending: pendingStory,
    due: due,
    showing: () => storyShowing,
    begin: storyBegin,
    advance: storyAdvance,
    next: next,
    state: () => storyState,
    /** 取一次「刚播完剧情」的标记（取完即清）—— 主界面据此加淡入类（不要硬切）。 */
    takeFadeIn: () => { const v = storyFadeIn; storyFadeIn = false; return v; },
    /* 整屏渲染 */
    modeHtml: storyModeHtml,
    noticeHtml: storyNoticeHtml,
    modeButtonHtml: storyModeButtonHtml,
    /* 【2026-10】整页画完之后补一次滚动（剧情页长文自动下翻），由 tower-ui 在 page() 之后同步调用。 */
    afterRender: storyAfterRender,
    /* 与 tower-ui 的接线 */
    setMainOpener: setMainOpener,
    /* 回归/探针用：这一段有几行、每行多少字（不依赖 DOM）。 */
    lineCount: (id) => { const s = storyScript(id); return s ? s.lines.length : 0; },
  };
})();
