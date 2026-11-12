/* tower-plot.js — 无尽塔剧情文本与播片机。加剧情只往 STORY_SCRIPTS 加数据，
 * 触发条件留在 tower.js 状态机；播完回主界面经 TowerUI（加载顺序见 scripts/index.html）。
 * 依赖 window.Tower / UI.classic / TowerUI，三者都由 index.html 的 script 顺序保证先加载。 */
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

  /* 剧情屏：整屏只渲染塔身 + 文字 + 「继续」，逐字打字；局内 UI 全部不渲染。数据格式
   * { id: { once, lines: [] } }；行内标记 **粗** / *斜* / {抖}…{/抖} / {红}…{/红}。
   * 字体在 css/tower.css 的 .tower-story-line（楷体族，跨平台回退）。 */
  const STORY_SCRIPTS = {
    /* 进塔开场：每次「开始攀登」都播（点「继续」可快速跳过）。 */
    intro: {
      once: false,
      lines: [
        '你推开无尽之塔{抖}厚重{/抖}的门扉，',
        '一行古老的文字刻在门楣上：',
        // 「献出自身」嵌套标记：{红}**…**{/红}，解析见 storySegments。
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
    // 「立即进货」类增益（E01 / 铸币版 E16）与其它层遇商人时从 merchantA~F 随机一段；
    // 同一家店只播一段（storyFinish 记 shop.storyShown），固定文案只有 merchant / merchant2。
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

    /* 主线剧情文本按层号 / 节点排；触发与记账在 tower.js 状态机
     * （entryStoryFor / reportBattle / patrol / 献祭），这里只放文本，别把条件写进数据。 */

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

    layer30: {
      once: true,
      lines: [
        '穿过石门后，你发现自己的皮肤上浮现出细小的**黑色纹路**。',
        '它们随着心跳缓缓**{抖}游动{/抖}**，随后消失不见。',
        '你感到某种力量正在苏醒。',
      ],
    },
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
    layer40: {
      once: true,
      lines: [
        '你发现塔壁上出现了新的纹章。',
        '王冠、魔眼，以及一面没有倒影的镜子。',
        '有人用剑在墙上留下了深深的**{抖}刻痕{/抖}**：',
        '「{红}**王**{/红}已经知道你来了。」',
      ],
    },

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
    /* 第 2 次起每次偶遇各播一段（duePatrol 按 run.patrolMeetNo 找下一段）。都是 once:false，
     * 段号只记在这一局上：一局内每段讲一次、下一局重讲；靠 storySeen 推进永远判出同一段。 */
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
    /* 第 100 层王庭 / 第一近卫等五段都是 once:false：每次到达整百层都讲一遍，
     * 判据是 run.x00PreNo / x00stage，不是 storySeen（否则第二次到达会看不到）。 */
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
    bladeGet: {
      once: true,
      lines: [
        '巡逻魔王的血没有落地，顺着剑脊被吸了进去。',
        '那柄断锋第一次亮起暗红，像在回应你掌心的脉搏。',
        '从此每场战斗之后，它都会向你索要一件祭品。',
        '喂养它，直到它记起自己原本的名字。',
      ],
    },
    bladeForce: {
      once: false,
      lines: [
        '你已经很久没有拔剑了。',
        '剑鞘深处传来饥饿的低鸣，暗红的光从缝隙里亮起。',
        '「别把我忘了。」',
        '这一次，它不会再让你合上剑鞘。',
      ],
    },
    bladeDead: {
      once: true,
      lines: [
        '第三次压制之后，剑身上的红光彻底熄灭。',
        '它不再饥饿，也不再回应你的呼唤。',
        '涸血之剑安静地躺在掌心，像一块再普通不过的冷铁。',
        '你听见自己松了一口气。',
      ],
    },
  };
  // 勇者剧本：键与 STORY_SCRIPTS 一一对应，once 沿用默认表（触发条件不动），只替换 lines；
  // ruleset === 'hero' 时 storyScript() 自动取这张表。
  const HERO_SCRIPTS = {
    intro: [
      '你在无尽塔的门槛上醒来。',
      '掌心没有剑，只有一道尚未结痂的剑茧。',
      '门楣上的旧字被镜面磨得只剩半句：',
      '「……欲见王者，先看清自己。」',
    ],
    merchant: [
      '拐角处支着一辆没有轮子的货车。',
      '蒙眼的商人坐在货箱上，指尖摩挲着一枚旧币。',
      '「勇者，我不卖力量。」',
      '「我只卖别人没能带上塔的东西。」',
      '「挑吧。价钱好说——只要你还记得自己叫什么。」',
    ],
    merchant2: [
      '第十层的灯比别处暗。',
      '商人把一只空剑鞘放在柜台上。',
      '「有人把它留在这里，说会回来取。」',
      '「你要不要替他保管？」',
      '「放心，我不收利息。只收一点记忆。」',
    ],
    merchantA: [
      '货车停在阶边，蒙眼商人正给一盏旧灯添油。',
      '「又见面了，勇者。」',
      '「灯还亮着，说明你还没把自己弄丢。」',
    ],
    merchantB: [
      '商人从镜背后面探出手，摆正一柄卷刃的短剑。',
      '「这塔里最不缺的就是半途而废的剑。」',
      '「你要买，还是只是看看？」',
    ],
    merchantC: [
      '你还没开口，商人已经推来一只小木盒。',
      '「里面是上一位勇者没写完的名字。」',
      '「别打开。除非你愿意替他走完。」',
    ],
    merchantD: [
      '货摊上摆着一排没有倒影的护符。',
      '「挑一个吧。」',
      '「戴上它，镜子里的人就不会替你回答。」',
    ],
    merchantE: [
      '商人在阶上煮一壶苦茶。',
      '「坐。」',
      '「塔不会等你，但一盏茶的时间，它还拿得走。」',
    ],
    merchantF: [
      '那辆货车又出现在拐角，像从墙里长出来。',
      '「老规矩，先看货。」',
      '「不过今天多一句：别买你拿不下的东西。」',
    ],
    gate20: [
      '石阶尽头立着一道没有门的门框。',
      '门内悬着一架倾斜的天平，和一顶空王冠。',
      '天平的一端压着一张旧地图，另一端空着。',
    ],
    gate20b: [
      '空王冠在镜中缓缓转向你。',
      '苍老的声音从门框背后传来：',
      '「献出一件你舍不得的东西。」',
      '「塔不收金子。塔只收你还想带走的。」',
    ],
    gate20c: [
      '藏品落进天平，发出很轻的一声。',
      '空王冠沉了下去，门框里亮起一条向上的路。',
      '你听见镜子里有人替你叹了口气。',
    ],
    offer1: ['「井口映着你的脸。塔在等你先松手。」'],
    offer2: ['「没有放下的东西，就没有拿得起的下一层。」'],
    offer3: ['「旧契还在。请把你还记得的，分一点给塔。」'],
    offer4: ['「你从塔里拿走了什么，塔就从你身上取回什么。」'],
    offer5: ['「你的行囊轻了。路却还没到尽头。」'],
    layer30: [
      '穿过门框，你手臂上浮出细密的黑线。',
      '它们顺着血管游动，像有人在你皮肤下临摹剑路。',
      '你握了握拳，黑线便安静下去。',
    ],
    layer31: [
      '一阵刺痛从胸口炸开。',
      '你佩在衣内的一枚旧徽记裂成两半，化作灰。',
      '你忽然想不起把它交给你的人长什么样。',
      '镜面深处传来极轻的笑声。',
      '你知道，塔开始收走你带来的东西了。',
    ],
    layer40: [
      '塔壁上多了一幅新刻的像。',
      '像中人握剑的姿势与你一模一样。',
      '刻痕底部留着一行小字：',
      '「{红}**他来过。他也留下过。**{/红}」',
    ],
    boss60: [
      '石廊深处传来爪子刮过镜面的声音。',
      '暗御狡兔从岔路里走出，甲胄上沾着别人的倒影。',
      '「追到这里的勇者，通常已经忘了自己为什么上来。」',
      '它抬起长耳，四周的镜面同时亮起。',
    ],
    boss70: [
      '狼嚎撞在塔壁上，碎成一圈圈回音。',
      '暗御狼王拖着锁链走出，锁链另一端空着。',
      '「你的剑很轻。」',
      '「希望你的骨头，比它重一点。」',
    ],
    boss80: [
      '狐火从台阶缝隙里浮起，照亮一地碎镜。',
      '妖狐倚着断栏，尾巴尖卷着一枚旧剑穗。',
      '「勇者，你心里那点东西，敢不敢让我看看？」',
      '她笑的时候，所有镜面都换成了你的脸。',
    ],
    boss90: [
      '巨斧砸在地上，整层塔的镜面同时一震。',
      '暗御猿将站在王庭最后的石柱前，身上缠着旧铁链。',
      '「王座就在上面。」',
      '「但从这里开始，我不再替谁试你。」',
    ],
    patrolGate: [
      '镜面里先一步走出一个人影。',
      '他穿着与你同样的旧甲，腰间也空着剑鞘。',
      '「第一次走到这里？」',
      '「让我看看，你的影子够不够格继续往上。」',
    ],
    patrolMeet: [
      '镜巡从阶下的暗处现身，剑尖点着地。',
      '「又见面了，勇者。」',
      '「你比上次更像你自己了。」',
    ],
    patrolMeet2: [
      '「你的脚步稳了。」',
      '「可镜子里那条路，还是你一个人走。」',
    ],
    patrolMeet3: [
      '「我数过你留下的剑痕。」',
      '「每一道都比上一道浅。」',
      '「是学会了收力，还是学会怕了？」',
    ],
    patrolMeet4: [
      '「你怀里那柄断锋，在响。」',
      '「它认你，还是只认你赢过的那些魔王？」',
    ],
    patrolMeet5: [
      '「你每上一层，就少一段来时的记忆。」',
      '「等到了王庭，你还记得自己为何拔剑吗？」',
    ],
    patrolMeet6: [
      '「再往上，镜巡不再留手。」',
      '「我也不再替你试剑。」',
    ],
    patrolMeet7: [
      '「钟声快响了。」',
      '「镜之魔王已经让人擦亮了王座。」',
    ],
    patrolMeet8: [
      '镜巡与你擦肩而过，没有拔剑。',
      '「这一次，我只看。」',
    ],
    patrolFailA: [
      '镜巡收剑，镜面里你的倒影单膝跪地。',
      '「你输的不是这一场。」',
      '「是你开始相信，塔会替你记住一切。」',
      '「留下一件藏品。换一条继续向上的路。」',
    ],
    patrolFailB: [
      '你交出的藏品沉进镜面，没有声音。',
      '镜巡替你把衣领理正。',
      '「我会替你收着。」',
      '「等你走到王庭，再来问我拿。」',
    ],
    patrolWin: [
      '镜巡的剑断成两截，倒影先一步碎开。',
      '他低头看着空空的剑柄，忽然笑了。',
      '「很好。影子输了，人还在。」',
      '他让开石阶，镜面后浮出一只漆黑的宝箱。',
      '「拿走吧。这是塔给还认得自己的人，留的奖赏。」',
    ],
    layer90: [
      '石壁开始裂开，裂缝里流动着暗红色的光。',
      '你伸手触碰，指尖却映出一顶被锁链缠住的王冠。',
      '整座塔像在缓慢呼吸。',
    ],
    layer95: [
      '壁画上画着七国联军攻塔的旧事。',
      '最后一格被人用剑刮花，只剩一座高塔、一面镜、一顶黑冠。',
      '镜中王冠下，站着一个与你同样握剑的人。',
    ],
    layer100: [
      '王庭在塔顶展开，地面光滑得像一面没有边的镜子。',
      '王座上坐着一个与你轮廓相同的人，脸却被王冠的阴影遮住。',
      '「你终于走到这里了。」',
      '「我等你很久——等一个还愿意照镜子的人。」',
    ],
    x00a: [
      '王座左侧的镜面裂开，重甲骑士踏出。',
      '他抬起巨剑，剑身映出你第一次登塔的样子。',
      '「第一近卫，守的是王座，也是每一个走上来的勇者。」',
      '「让我看看，你配不配走到王面前。」',
    ],
    x00b: [
      '右侧的黑暗里，祭袍身影翻开一本没有字的册子。',
      '无数姓名像灰一样从纸页间浮起。',
      '「第二近卫，守的是名字。」',
      '「勇者，你确定还要把自己的名字带上去吗？」',
    ],
    x00c: [
      '三道封印在王座后同时碎裂。',
      '黑色火焰升起，镜面里浮出你一路丢下的东西：旧徽记、断剑鞘、半张地图。',
      '「你交出的每一件，都成了我的王命。」',
      '镜之魔王从王座上站起。',
      '「来吧，勇者。」',
      '「让我看看，你走到这里，究竟还剩下什么。」',
    ],
    x00win: [
      '王冠裂开，镜面从中央向四周碎去。',
      '镜之魔王低头看着自己空空的双手。',
      '「我复制了你的剑、你的招式、你走过的每一步。」',
      '「却始终复制不出，你为何不肯回头。」',
      '他的身影化作灰烬，王庭里的火一盏盏熄灭。',
      '风从塔外吹进来。',
      '你听见很远的地方，有人在叫一个很久没人叫过的名字。',
    ],
    bladeGet: [
      '镜巡的血没有落地，顺着你的断锋被吸了进去。',
      '剑柄上那些旧名字一个个暗下去，只剩下你的掌心还在发烫。',
      '「它饿了。」守剑人的声音从很远的地方传来。',
      '「从今往后，每打完一仗，都得喂它一件东西。」',
    ],
    bladeForce: [
      '你已经很久没有拔剑了。',
      '断锋在鞘里自己震了一下，暗红的光沿着裂纹亮起。',
      '「别把我忘了。」',
      '「你不想用我，我就自己醒来。」',
    ],
    bladeDead: [
      '第三次压住它之后，剑上的红光彻底暗了。',
      '那些被它吞下去的名字不再低语。',
      '涸血之剑安静地躺在你手里，像一块普通的冷铁。',
      '你忽然听见自己的呼吸声，第一次这么清楚。',
    ],
  };
  // 只决定取哪张文本表，不改触发条件。
  function heroStoryNow() {
    try {
      if (Tower.heroRunActive) return !!Tower.heroRunActive();
      const info = Tower.endlessInfo ? Tower.endlessInfo() : null;
      return !!(info && info.run && info.run.ruleset === 'hero');
    } catch (e) { return false; }
  }
  const STORY_CHAR_MS = 42;
  // 剧情淡出时长；主界面淡入由 css/tower.css 的 .tower-fade-in 负责，改这里要同步。
  const STORY_FADE_MS = 150;
  let storyState = null;
  // 上次铺到 DOM 的行号：同一行只改 .now，不重解析前面已完成的行。
  let paintedStoryLine = -1;
  // 这一屏是否正在播剧情（openEndless 据此不弹献祭窗 / 过程提示）；每次重画按 pendingStory 置位。
  let storyShowing = false;
  // 刚播完剧情：下一次 openEndless 让整页淡入，不硬切。
  let storyFadeIn = false;
  function storyScript(id) {
    const s = STORY_SCRIPTS[id];
    if (!s || !Array.isArray(s.lines) || !s.lines.length) return null;
    const hero = HERO_SCRIPTS[id];
    if (hero && hero.length && heroStoryNow()) return { once: !!s.once, lines: hero };
    return s;
  }
  // 随机商人文案池（固定文案 merchant / merchant2 不走这里）；顺序即抽取顺序。
  const MERCHANT_IDLE_POOL = ['merchantA', 'merchantB', 'merchantC', 'merchantD', 'merchantE', 'merchantF'];
  /** 随机抽一段商人文案；第一次摇中就把段号记在 shop.storyPick（setShopStoryPick），
   *  否则每次重画重摇会把正在打字的段落换掉，打字机永远打不完。 */
  function merchantIdlePick(run) {
    const list = MERCHANT_IDLE_POOL.filter((id) => storyScript(id));
    if (!list.length) return null;
    const fixed = run && run.shopStoryPick;
    if (fixed && list.indexOf(fixed) >= 0) return fixed;
    const pick = list[Math.max(0, Math.min(list.length - 1, Math.floor(Math.random() * list.length)))];
    try { Tower.setShopStoryPick(pick); } catch (e) {}
    return pick;
  }
  /** 把一行拆成 [{text,bold,italic,shake,red,blue}]，标记本身不占可见字符，可嵌套；
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
  /** 这一屏该不该播剧情，优先级：run.story → pendingStoryId（延迟一步）→ 开店铃声 →
   *  首次商人 → 第 10 层商人；挑战模式一律 null。 */
  function pendingStory(run) {
    const id = pendingStoryOf(run);
    /* 每次重画都按本次判定重新置位 storyShowing：界面靠它决定能不能弹献祭窗 / 过程提示；
     * 漏置位会把「停留提示屏」当普通屏，弹窗叠上去、storySeen 也记不上。 */
    storyShowing = !!(id || (run && run.pendingStoryId && run.pendingStoryHold));
    return id;
  }
  // 纯判定，不许改 run：界面拿到的是 endlessInfo() 快照，改了传不回真状态。
  function pendingStoryOf(run) {
    if (!run) return null;
    if (!Tower.storyEnabled()) return null;
    // 延迟一步：提示屏停留期间返回 null，标记由界面「继续」经 clearRunStoryHold 清。
    if (run.pendingStoryId && run.pendingStoryHold) return null;
    if (run.pendingStoryId) {
      const pend = storyScript(run.pendingStoryId);
      /* 兜底：once 且已播过的待播槽不再交给界面 —— 残留槽优先级高于 run.story，
       * 会锁死在同一段上。 */
      if (pend && pend.once && Tower.storySeen(run.pendingStoryId)) return null;
      return pend ? run.pendingStoryId : null;
    }
    if (run.story) return storyScript(run.story) ? run.story : null;
    /* 商人两段只在商店阶段播；不要加层号门槛 —— 第 1 层开场商店也算「第一次」。
     * 靠 storySeen 各播一次，条件本身不按层号写。 */
    if (run.phase === 'shop') {
      // 这家店已经讲过了；once:false 的条件一直成立，不记会一段接一段播。
      if (run.shopStoryShown) return null;
      /* 「立即进货」（E01）/「铸币商队」（E16 铸币商店）开店那一刻：从随机池里来一段。 */
      if (run.shopByBuff) return merchantIdlePick(run);
      const seenFirst = Tower.storySeen('merchant');
      const seenSecond = Tower.storySeen('merchant2');
      if (!seenFirst && !seenSecond && storyScript('merchant')) return 'merchant';
      if (seenFirst && !seenSecond && (Number(run.layer) || 1) >= 10 && storyScript('merchant2')) return 'merchant2';
      /* ③ 其余遇商人 / 铸币商店：6 段随机。必须有店对象（run.hasShop，endlessInfo 投影）——
       * shop.storyShown 记在店上，没店记不上会无限重播。 */
      if (!run.hasShop) return null;
      return merchantIdlePick(run);
    }
    return null;
  }
  function storyStopTimer() {
    if (storyState && storyState.timer) { clearTimeout(storyState.timer); storyState.timer = null; }
  }
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
  /** 每次重画都带一次滚动：storyPaint() 整块重写 innerHTML 会把滚动归零，
   *  不重新带，长剧情末尾几行永远看不见；只往下带，夹在 0 ~ max 之间。 */
  function storyScrollToCursor(box) {
    if (!box || typeof box.scrollTop !== 'number') return;
    const now = typeof box.querySelector === 'function' ? box.querySelector('.tower-story-line.now') : null;
    if (!now) return;
    const bottom = Number(now.offsetTop || 0) + Number(now.offsetHeight || 0) + 8;   // 8 = 给光标留一点呼吸
    const max = Math.max(0, Number(box.scrollHeight || 0) - Number(box.clientHeight || 0));
    const want = Math.max(0, Math.min(bottom - Number(box.clientHeight || 0), max));
    if (box.scrollTop !== want) box.scrollTop = want;
  }
  function storyPaint() {
    const st = storyState;
    if (!st || typeof document === 'undefined' || !document || typeof document.querySelector !== 'function') return;
    const box = document.querySelector('[data-story-text]');
    if (!box) return;
    /* 同一行只更新当前 <p>，换行 / 跳行才重铺整段：每字重写 innerHTML 是 O(n²) 且丢滚动位置。 */
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
  function storyAdvance() {
    const st = storyState;
    if (!st) return;
    const cur = st.lines[st.line];
    storyStopTimer();
    if (cur && st.chars < cur.total) {
      st.chars = cur.total;
      storyPaint();
      return;
    }
    if (st.line + 1 < st.lines.length) {
      st.line += 1;
      st.chars = 0;
      storyPaint();
      st.timer = setTimeout(storyTick, STORY_CHAR_MS);
      return;
    }
    storyFinish();
  }
  /** 播完：记 once、清待播槽，然后淡出 → 淡入回主界面（~150ms / ~190ms，见 CSS）。
   *  整百层连播时先问下一段，有就直接接上，中间不回主界面。 */
  function storyFinish() {
    const st = storyState;
    storyStopTimer();
    storyState = null;
    paintedStoryLine = -1;
    if (st && st.once) { try { Tower.markStorySeen(st.id); } catch (e) {} }
    /* 店里文案要给这家店记「讲过了」（markShopStoryShown）：once:false 条件一直成立，
     * 不记会一段接一段；once:true 也要记，否则随机段会立刻接在固定段后面。 */
    if (st) { try { Tower.markShopStoryShown('endless'); } catch (e) {} }
    /* 必须先消费「延迟一步」待播槽：连播链不经过 clearRunStory，残留槽优先级更高，
     * 会反复重播同一段、卡死剧情屏（第 100 层失烙印 + 王庭连播踩过）。 */
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
  /** 「停留一下」的提示屏：与剧情屏同版式、无打字机；用于第一次失烙印。
   *  按钮已去掉，整屏点击推进（tower-ui 的 openEndless → TowerPlot.next）。 */
  function storyNoticeHtml(title, inner) {
    return '<div class="tower-story">' +
        '<div class="endless-title-row"><h2 class="tower-title">' + esc(title) + '</h2></div>' +
        '<div class="tower-story-text">' + inner + '</div></div>';
  }
  /** 剧情屏：保留标题，文字居中打字；行号与「继续」按钮已去掉，点屏幕任意位置继续。 */
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
  /** 由 tower-ui 在 page() 之后同步调用，补一次滚动：重画会换掉 [data-story-text]，
   *  已打完的屏没有下一次 tick。必须同步，插 setTimeout 会打乱打字机节奏。 */
  function storyAfterRender() {
    try {
      if (typeof document === 'undefined' || !document || typeof document.querySelector !== 'function') return;
      storyScrollToCursor(document.querySelector('[data-story-text]'));
    } catch (e) {}
  }

  /* 剧情 / 挑战模式开关（无尽首页左下角）：挑战模式跳过所有文字剧情；
   * 状态存 endless().storyOn（默认 true），读写走 Tower.storyEnabled。 */
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
  /* 「什么时候该播」：due() 主动触发（到层 / 巡视 / 段间），pending() 逐帧询问；
   * 判据与记账同源，挂上待播后同一条路再问必须返回 null。 */

  /** 这一层刚进就该播的（整百层也走这里）；只在 run.idx === 0 时算数：
   *  打过第 1 场后不许在商店 / 献祭 / 结算屏补播。 */
  function dueEntry(run) {
    if (!run) return null;
    if (Math.max(0, Math.floor(Number(run.idx) || 0)) !== 0) return null;
    const plan = Array.isArray(run.plan) ? run.plan : [];
    const first = plan[0];
    const id = first && first.entryStory;
    if (!id) return null;
    if (id !== 'x00stage') return Tower.storySeen(id) ? null : id;
    /* 整百层问状态机 x00BeforeFirstOf（唯一判据，别抄一份）；判据是 run.x00PreNo，不看 storySeen。 */
    try { return Tower.x00BeforeFirstOf ? Tower.x00BeforeFirstOf() : null; } catch (e) { return null; }
  }

  // 60/70/80/90 征战 boss 只在第 5 场开战前播一次（once:true 走 seen 表），不提前也不补播。
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

  /** 巡视开战前：首次 patrolGate，之后按 run.patrolMeetNo 取 patrolMeetN。
   *  只在 run.idx 指向巡视那场时返回；本层一次（patrolStoryAt）；段号记在 run 上而非
   *  storySeen —— once:false 不写 seen，靠 seen 永远判出同一段会卡死。段号 1..8 循环。 */
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
    /* 段号 1..PATROL_MEET_MAX 循环：讲完第 8 段从头再讲，保证每次偶遇都有剧情。 */
    const next = Math.max(0, Math.floor(Number(run.patrolMeetNo) || 0)) + 1;
    const n = ((next - 1) % PATROL_MEET_MAX) + 1;
    const id = n <= 1 ? 'patrolMeet' : ('patrolMeet' + n);
    return storyScript(id) ? id : null;      // ⚠ 这里必须调 storyScript：`script` 不是本文件的函数名
  }

  /** 主动触发：返回 id 时调用方落到 run.story 并重画。phase / 本层已清空两道闸必须保留，
   *  否则「第 1 场之前」的段会在商店 / 献祭 / 结算屏被补播。 */
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

  /* 剧情屏的「继续」：正在播就推进；停留提示屏则放行并清 hold。 */
  function next() {
    if (!storyState) {
      try { Tower.clearRunStoryHold ? Tower.clearRunStoryHold() : null; } catch (e) {}
      openMain();
      return;
    }
    storyAdvance();
  }

  function heroEventHtml(event) {
    const rawLines = (event && Array.isArray(event.lines) && event.lines.length)
      ? event.lines : String((event && event.text) || '').split(/\n+/);
    const body = rawLines.map((line) => {
      const segs = storySegments(String(line));
      const total = segs.reduce((n, x) => n + x.text.length, 0);
      return '<p class="tower-story-line done">' + storyHtml(segs, total || 9999) + '</p>';
    }).join('');
    const choices = ((event && event.choices) || []).map((choice) =>
      '<button type="button" class="hero-story-choice" data-hero-event-choice="' + esc(choice.id) + '">' +
        '<b>' + esc(choice.label) + '</b><span>' + esc(choice.desc || '') + '</span></button>').join('');
    return '<div class="tower-story hero-story">' +
      '<header class="hero-story-head"><span class="hero-demo-badge">勇者际遇</span>' +
        '<h2 class="hero-story-title">' + esc(event && event.title || '勇者际遇') + '</h2></header>' +
      '<div class="tower-story-text hero-story-text">' + body + '</div>' +
      '<div class="hero-story-choices">' + choices + '</div></div>';
  }

  window.TowerPlot = {
    SCRIPTS: STORY_SCRIPTS,
    HERO_SCRIPTS,
    script: storyScript,
    segments: storySegments,
    html: storyHtml,
    pending: pendingStory,
    due: due,
    showing: () => storyShowing,
    begin: storyBegin,
    advance: storyAdvance,
    next: next,
    state: () => storyState,
    // 取一次「刚播完剧情」的标记（取完即清）；主界面据此加淡入类，不要硬切。
    takeFadeIn: () => { const v = storyFadeIn; storyFadeIn = false; return v; },
    modeHtml: storyModeHtml,
    noticeHtml: storyNoticeHtml,
    eventHtml: heroEventHtml,
    modeButtonHtml: storyModeButtonHtml,
    afterRender: storyAfterRender,
    setMainOpener: setMainOpener,
    /* 回归/探针用：这一段有几行、每行多少字（不依赖 DOM）。 */
    lineCount: (id) => { const s = storyScript(id); return s ? s.lines.length : 0; },
  };
})();
