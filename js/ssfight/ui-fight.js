/* Classic in-battle presentation rendered from the original ssfight fight frame.
 *
 * Evidence (all from the committed asset library + the reference decompile):
 *   · `7772` is the root timeline's frame 70 ("fight"): f1 = `backGround`(7692) + `blood`(7703)
 *     + `winWords`(7717); f2/f3 = the result panel; f5 = `openChest`(7771) chest lottery.
 *   · The two fighters are two instances of `7689`, which the original root timeline places on
 *     frame 60 as `player1` / `player2` at depth 485 / 532 with matrix
 *     `±0.453003,0,0,0.452866,17.05|303.4,107.45`. Frame 1 = the squirrel body slot
 *     (`playerMc` = 7639, `statu` = 7658); frames 2..6 are the other bodies.
 *   · `松鼠` (6532) is attached at runtime by `setUp()` (MainMovie.as:6173/6245), so it is not
 *     in any static closure; its frames are the animation selectors:
 *     f1 `attacks`(6339) / f2 `defenses`(6427) / f3 `dodges`(6433) / f4 `defenseSkills`(6512) /
 *     f5 `attackbacks`(6517) / f6 `comeBacks`(6524) / f7 `winPoses`(6531).
 *   · Frame choices mirror `Squirrel.as`; round fields map from the sim event stream in
 *     `attackPlan` / `defensePlan` below.
 *   · Timing is **not** a controller: like the original, each action clip fires the next step
 *     from its own frame actions (`03-反编译源码/动作脚本/sprite<id>.as`): `useSkillDefense()` on
 *     the wind-up frame, `beAttack()` on the contact frame, `setAttackEnd()` / `stop()` on the
 *     last frame, `attackBack()` on the defender's own reaction frame, `die()` /
 *     `congratulate()` at the end of the death pose. See `ATTACK_ACTS` / `DEFENSE_ACTS` and
 *     `playClip` (a clip must **stop** on its last frame — the original writes `stop()` there,
 *     and a still-`playing` clip would loop the same move a second time).
 *   · Damage numbers are per-side templates (`fightSub.leftBlood` 4845 / `rightBlood` 4846)
 *     duplicated by `showBlood()` — see `floatNumber`.
 *   · Gear is worn exactly like the village page: the holders placed inside each animation frame
 *     (`ikNode_*`) are pinned to the equipment frame and their slot emits the container
 *     (gear-slots.json / gear-frames.json).
 *
 * Page API: SfFight.run(opts) → controller, mirroring Battle.run's contract.
 * Assets: images/ssfight/ui/tags-fight.json (tools/gen-ssfight-ui.cjs --fight).
 */
(function () {
  'use strict';

  const T = () => (window.SfUiMain && window.SfUiMain.toolkit) || null;
  const S = () => (window.State && State.state && State.state()) || null;
  /* 无头回归里没有 rAF；统一走这两个别名，别在业务代码里直接摸 window。 */
  const raf = (fn) => (window.requestAnimationFrame ? window.requestAnimationFrame(fn) : setTimeout(() => fn(Date.now()), 16));
  const caf = (id) => { try { (window.cancelAnimationFrame || clearTimeout)(id); } catch (e) {} };

  const SYM = {
    fight: '7772', fighter: '7689', hero: '6532', fightSub: '4847',
    skip: '4528', talk: '3704', gain: '3960',
  };
  /* 7772 的帧号：1 = 战斗场景 / 2 = 战果（玩家胜）/ 3 = 战果（玩家负）/ 4 = 伤害累计 / 5 = 开宝箱 / 6 = 空 */
  const F = { scene: 1, win: 2, lose: 3, harm: 4, chest: 5, blank: 6 };
  /* 原版根时间轴帧 60 把 `player1`/`player2` 摆成左右两侧（深度 485 / 532）。 */
  const SIDE_MATRIX = ['0.453003,0,0,0.452866,17.05,107.45', '-0.453003,0,0,0.452866,303.4,107.45'];
  const BG_FRAMES = 5;          // `random(backGround._totalframes - 1) + 1` → 1..5
  const HUD_FRAME = 8;          // `blood` 播到第 8 帧就 stop 并 showFightInfo
  const BLOOD_BAR_FRAMES = 101; // 7697 共 102 帧，第 N 帧 = 扣掉 N%
  const RANGED = new Set([5, 6, 7, 8, 9, 10, 13, 14]);
  /* `Player.specialEffect()` 的四档 → `statu.propty` 的第几帧。
   * 这 8 颗图标逐帧渲染核对过（2026-11，`propty` 7657 的 8 帧）：
   *   1 力↑ / 2 敏↑ / 3 速↑ / **4 力↓ / 5 敏↓ / 6 速↓** / 7 ↑速敏力（全属性提升）/ **8 晕击**。
   * 战斗里真正会用到的就是 4/5/6/8，与原版客户端逐条对得上：
   *   · `MainMovie.as:6357` 的 `specialEffectType` 1→statu 3（力↓）/ 2→statu 1（敏↓）/ 3→statu 2（速↓）；
   *   · `Squirrel.attack` 的投掷分支按武器 5/6/8 选 statu 1/2/3，而 sim 里正是 5=敏捷降低、6=速度降低、8=力量降低。 */
  const STATU_ICON = { 1: 5, 2: 6, 3: 4, 4: 8 };
  /** `propty` 里那 8 颗图标容器（它们各自的第 1 帧脚本是 `stop(); _root.showReverse(this, 1)`）。 */
  const STATU_ICON_SYMS = new Set([7640, 7641, 7642, 7645, 7647, 7649, 7653, 7656,
    /* 小宇宙爆发动画里那三颗「力/敏/速」字标（5940/5952/5956 各 2 帧，第 2 帧是镜像）：
     * 它们同样是挂在角色身上的状态字标，敌方整棵子树镜像后会反字；按状态图标同一条
     * 规则停在正字帧、敌方补一次自翻。 */
    5940, 5952, 5956]);
  /** 每颗图标的**正字帧**（两帧互为镜像，`showReverse` 就是按左右选一帧）。
   *  ⚠ 各颗的约定**并不一致**，逐帧独立渲染核对（2026-10-17 复核；2026-11 再核）：
   *    7640/7641/7642/7645/7647/7649（力↑敏↑速↑力↓敏↓速↓）→ 第 **1** 帧正写；
   *    7653（↑速敏力）→ 第 **1** 帧正写；
   *    7656（击晕）→ 第 **1** 帧才是正的（第 2 帧是镜像的"晕击"，旧版误记成 2，
   *    于是敌方头顶的「击晕」一直是反着写的两个字 —— 用户 2026-11 口径）。
   *  选帧之后由 `onClip` 给**敌方**（父级整棵子树 scaleX<0）再翻一次自己。 */
  const STATU_ICON_FRAME = { 7640: 1, 7641: 1, 7642: 1, 7645: 1, 7647: 1, 7649: 1, 7653: 1, 7656: 1,
    5940: 1, 5952: 1, 5956: 1 };

  /* ---------- 装备表（与村庄页同一份；只在真要穿时加载 tags-gear.json） ---------- */
  let gearTables = null;
  async function loadGearTables() {
    if (gearTables) return gearTables;
    await SfRender.loadExtra('tags-gear.json');
    const B = 'images/ssfight/ui/';
    const j = (f) => fetch(B + f, { cache: 'force-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [frames, slots] = await Promise.all([j('gear-frames.json'), j('gear-slots.json')]);
    if (!frames || !slots) return null;
    const containerIds = {};
    for (const c of slots.container || []) containerIds[c.type] = c.ids;
    /* 橙装按 q4 同部位同名字的橙稿帧（与状态页/纸娃娃同一条规则）。 */
    const keyOf = (g) => Number(g.type) + '|' + String(g.name || '');
    const q4 = new Map();
    for (const g of frames.gear) if (Number(g.quality) === 4) q4.set(keyOf(g), g.frame);
    const orangeFrameById = new Map();
    for (const g of frames.gear) {
      if (Number(g.quality) !== 3) continue;
      const f = q4.get(keyOf(g));
      if (f) orangeFrameById.set(Number(g.id), f);
    }
    gearTables = {
      frameById: new Map(frames.gear.map((g) => [Number(g.id), g.frame])),
      orangeFrameById: orangeFrameById,
      slots: slots.slots, holders: slots.holders || [], containerIds: containerIds,
    };
    return gearTables;
  }
  /** 一件装备的**部位号**（0 头 / 1 拳套 / 2 衣服 / 3 鞋）。
   *  ⚠ 对手身上那套（`State.genAI()` → `randomAIGears()`）只存 `{id, used, ext, attr}`，
   *  **没有 `type` 字段** —— 直接读 `g.type` 会得 `NaN`，`byType` 里就会出现一个 `NaN` 键、
   *  四个部位一个都对不上，结果 `planSide` 返回 null、对手**一件装备都不穿**
   *（2026-11 用户口径："玩家与对手的装备都没有正确穿戴，全都是无装备情形"）。
   *  这里按 id 回字典查类型兜底。 */
  function gearTypeOf(g) {
    const ty = Number(g && g.type);
    if (Number.isFinite(ty) && ty >= 0 && ty <= 3) return ty;
    try {
      if (window.State && State.gearPart) {
        const t2 = Number(State.gearPart(Number(g && g.id)));
        if (Number.isFinite(t2) && t2 >= 0 && t2 <= 3) return t2;
      }
    } catch (e) {}
    try {
      if (typeof gearMap !== 'undefined' && gearMap.getValue) {
        const d = gearMap.getValue(Number(g && g.id));
        if (d && d.type != null) return Number(d.type);
      }
    } catch (e) {}
    return NaN;
  }
  /** 一侧的穿搭计划：挂点 id → 容器 / 帧号，持有者 id → 该钉的帧（照 `planWears`）。 */
  function planSide(wears) {
    const t = gearTables;
    if (!t) return null;
    const byType = new Map();
    for (const g of wears || []) {
      if (!g) continue;
      const ty = gearTypeOf(g);
      if (!Number.isFinite(ty)) continue;
      if (!byType.has(ty)) byType.set(ty, g);
    }
    if (!byType.size) return null;
    const frameFor = (g) => {
      const base = t.frameById.get(Number(g.id));
      if (!base) return 0;
      const orange = g.orange === true || Number(g.quality) > 3;
      const of = orange && t.orangeFrameById ? t.orangeFrameById.get(Number(g.id)) : 0;
      /* **与主界面 planWears() 同一条帧号规则**：强化档取 `ext` 数组里最大 level
       * （旧代码 `Number(g.ext)` 对数组得到 NaN → 永远基础帧），且只有头/拳套
       * 吃强化配色档，衣服/鞋子只看品质帧。两边帧号一致，战斗里装备颜色才和
       * 村庄/状态页一致。这里只改配色帧，不动数值/贴图挂点。 */
      const raw = g.ext;
      let extMax = Array.isArray(raw)
        ? raw.reduce((m, e) => Math.max(m, Number(e && e.level) || 0), 0)
        : Math.max(0, Number(raw) || 0);
      extMax = Math.max(0, Math.min(3, extMax));
      /* 对手的装备只有 {id, ext}，没有 type；按 id 回查部位，别让头/拳套的强化配色档被吃掉。 */
      const gtype = Number.isFinite(Number(g.type)) ? Number(g.type) : gearTypeOf(g);
      const addr = (gtype === 0 || gtype === 1) && extMax > 0 ? extMax - 1 : 0;
      return (of || base) + addr;
    };
    const bySlot = new Map(), holders = new Map();
    for (const h of t.holders || []) {
      const g = byType.get(Number(h.type));
      const fr = g ? frameFor(g) : 0;
      if (fr) holders.set(String(h.id), fr + 1);     // 原版 `frameIndex + 1`，见 ui-main.js 的注释
    }
    for (const s of t.slots || []) {
      const g = byType.get(Number(s.type));
      const fr = g ? frameFor(g) : 0;
      if (fr) bySlot.set(String(s.id), { symbol: String(s.containerId), frame: fr, quality: Number(g.quality) || 0 });
    }
    if (!bySlot.size && !holders.size) return null;
    return { bySlot: bySlot, holders: holders };
  }

  /** 这一侧身上穿的装备（经典战斗穿的是**原版装备素材**，不是复刻图集那套）。
   *  显式 `gears`（空数组也算）属于参战者自己的外观；左侧未传时才读存档里"穿戴中"的。
   *  右侧读对手自带的 `gears`（好友/关卡数据里的原始字段）。
   *  ⚠ `Battle` 那条路的 `wears` 是 `Engine.wearsFor()` 产出的**图集片名**（`{src}`），
   *    与原版容器 id 完全无关 —— 这里按"有没有 `id`"过滤掉，绝不拿它去查容器表。 */
  function wearsOf(side, player) {
    if (side === 0 && !(player && Array.isArray(player.gears))) {
      try { return (State.myGears() || []).filter((g) => g && g.used); } catch (e) { return []; }
    }
    const list = player && (player.gears || player.wears);
    if (!Array.isArray(list)) return [];
    return list.filter((g) => g && typeof g === 'object' && g.id != null && g.src == null);
  }
  /* ---------- 三侠 / 木人：原版 `7689` 的第 2/3/4/5 帧就是现成的原版矢量模型 ----------
   * 原版 `loadPlayer`（MainMovie.as:17186）按 `chooseWz` 把 `player2` 拨到 2/3/4，再往
   * `player2.playerMc` 里 `attachMovie("螳螂"/"仙鹤"/"熊猫")`。那一颗外部 SWF 不在仓库的
   * 参考资料里（`viewer/game/FightGame/*.swf` 抓回来的是同一个占位文件），但**主 SWF 的
   * `7689` 第 2/3/4 帧里已经烤好了三侠的静态矢量稿**（7660=螳螂 / 7662=仙鹤 / 7685=熊猫，
   * 逐颗渲染核对过）；第 5 帧 7687 是木人。
   * 这里用它们当对手模型，再用 CSS 呼吸 + 简单的出招/受击位移补上"会动"的观感；
   * 三侠各自的战斗机制（螳螂双击、仙鹤前期凶猛、熊猫反击）本来就在 `Sim` 里按 `npcType` 算。 */
  const NPC_FRAME = { tl: 2, xh: 3, xm: 4, wood: 5 };
  const NPC_NAME = { tl: '螳螂', xh: '仙鹤', xm: '熊猫', wood: '木人' };
  /** 对手的 `npcType` → 三侠档；挑战塔的 `tw_*` 按体型映射（与 `battle.js` 同一张表）。 */
  function npcTypeOf(foe) {
    /* 征战动物 boss：`foe.campaign` 是 tower.js 给的 6833 形态描述；它不是三侠图集，
     * 也不走 makeStaticNpcFighter，SfFight 用专门的 buildFighter 分支挂 6833。 */
    if (foe && foe.campaign) return 'campaign';
    const raw = String((foe && foe.npcType) || '').toLowerCase();
    if (!raw) return null;
    if (NPC_FRAME[raw]) return raw;
    try {
      const T = window.TowerData;
      if (T && Array.isArray(T.NPCS)) {
        const hit = T.NPCS.find((n) => 'tw_' + n.id === raw);
        if (hit && NPC_FRAME[hit.anim]) return hit.anim;
      }
    } catch (e) {}
    const tower = {
      tw_berserker: 'xm', tw_assassin: 'tl', tw_medic: 'xh', tw_ironwall: 'xm', tw_bramble: 'xh',
      tw_frostmage: 'xh', tw_tamer: 'tl', tw_vampire: 'tl', tw_golem: 'xm', tw_devourer: 'xm',
    };
    return tower[raw] || null;
  }

  /** 这一侧的技能表（id → 等级）。真形态那一档（`attackerWeaponLevel` / `defenderWeaponLevel
   *  > 10`）就是从这里读的：原版是服务端在回合流水里带过来的，复刻的 `Sim` 只在
   *  **出手方**的回合事件上带 `level`（出手的那个技能/武器），防守方的技能等级没人带 ——
   *  所以防守方的真形态（真·龟甲术 / 真·绝对防御）只能回它自己的技能表查。
   *  优先用**传入的那位参战者自己的**技能表（录像回放要按当时那份，不能读现在的存档）。 */
  function skillsOf(side, player) {
    let list = (player && Array.isArray(player.skills)) ? player.skills : null;
    if (!list && side === 0) { try { list = State.mySkills() || []; } catch (e) { list = []; } }
    const out = {};
    for (const s of (Array.isArray(list) ? list : [])) {
      if (!s) continue;
      const p = typeof s === 'string' ? s.split(/[:,]/) : null;
      const id = Number(p ? p[0] : s.id);
      const lv = Number(p ? (p[1] || 1) : s.level);
      if (Number.isFinite(id)) out[id] = Number.isFinite(lv) && lv > 0 ? lv : 1;
    }
    return out;
  }

  /* ---------- 战利品图标（战果页 / 开宝箱那一格） ----------
   * 原版 `mc.c1.attachMovie(<道具名>, "mc", 100)`（战果页 :18804 / 开宝箱 :18691）——
   * 库元件名就是道具名，映射表由 `node tools/gen-ssfight-ui.cjs --fight` 一并产出
   * （`images/ssfight/ui/loot-icons.json`，名字来源是 `js/battle-drops.js` 的掉落池）。
   * 原版就是 `{_x:0, _y:0}` **不缩放**（图标画稿是按格子尺度画的），所以这里也不补变换。 */
  let lootIcons = null;
  async function loadLootIcons() {
    if (lootIcons) return lootIcons;
    try {
      const r = await fetch(SfRender.BASE + 'loot-icons.json', { cache: 'force-cache' });
      lootIcons = (r && r.ok) ? ((await r.json()).byId || {}) : {};
    } catch (e) { lootIcons = {}; }
    return lootIcons;
  }
  function attachLootIcon(target, item) {
    if (!target || !target.attachChild || !item || item.id == null) return null;
    const hit = lootIcons && lootIcons[Number(item.id)];
    if (!hit) return null;
    return target.attachChild(hit.id, 1, 'prize');
  }

  /* ---------- 战斗视图 ---------- */
  let live = null;      // 正在播的那一场
  let seq = 0;

  function stopAt(clip, n) {
    if (!clip || !clip.gotoAndStop) return;
    try { clip.gotoAndStop(n); } catch (e) {}
  }
  function play(clip, n) {
    if (!clip || !clip.gotoAndPlay) return;
    allowNestedAnim(clip);
    try { clip.gotoAndPlay(n || 2); } catch (e) {}
  }
  function setText(node, str, opts) {
    const t = T();
    if (t && node) { t.setText(node, str, opts); return; }
    if (node && node.textContent !== undefined) node.textContent = str == null ? '' : String(str);
  }
  function visible(clip, on) {
    const g = clip && (clip.g || clip);
    if (g && g.style) g.style.visibility = on ? '' : 'hidden';
  }
  /** 挂一次 rAF：到点先把自己从 `live.rafs` 里摘掉再执行 —— 一场战斗要挂几百次观察，
   *  只 push 不摘的话这个数组会长到几千项，`clean()` 时要逐个 cancel。 */
  function arm(fn) {
    const rec = live;
    if (!rec) return;
    const id = raf(() => {
      const i = rec.rafs.indexOf(id);
      if (i >= 0) rec.rafs.splice(i, 1);
      fn();
    });
    rec.rafs.push(id);
  }
  /** 播一条动作片断，**在帧脚本写的停止帧上停住**（`opts.stop` 缺省 = 末帧）。
   *
   *  ⚠⚠ 这一条是"动画会播两遍 / 胜利失败动作重复播放"的根因所在。
   *  渲染器的节拍器会让任何 `playing === true` 的实例**循环**推进；以前这里只 `resolve()`、
   *  不停帧，于是 await 一回来，同一个片断又从第 1 帧自己播第二遍（用户 2026-11 口径）。
   *  原版的每个动作元件末帧都写了 `stop()`（`动作脚本/sprite<元件号>.as` 逐条核过，括号里是
   *  渲染器数出来的帧数 —— **两者逐条相等**）：`5630`(17) 第 17 帧 stop、`5778`(22) 第 22 帧
   *  `setAttackEnd()`、`4844`(20) 第 20 帧 stop、`6366`(19) 第 19 帧 `_root.die()`、
   *  `6530`(32) 第 32 帧 `congratulation = 2`、`7703`(8) 第 8 帧 `showFightInfo()`。
   *  所以"播到末帧就停"与"照帧脚本停"是同一件事。
   *
   *  `onFrame(n)` 收到 **1 基**帧号（直接对着原版 `.as` 里的数字读），而且是"越过了就补触发"
   *  （节拍器是 14 fps、观察走 rAF，一步可能跨过两帧）。
   *
   *  ⚠⚠ 还有一条**必须**在这里做：**放行这条片断内部的"嵌套动画"**。
   *  原版每个动作元件里都嵌着若干多帧子元件，它们靠 Flash 的"嵌套 clip 自动播"在走：
   *   · `5616`（17 帧，`sprite5616.as` **没有脚本** → 一直循环）= 待机 / 呼吸姿势，
   *     每个动作的**第 1 帧与末帧**放的都是它 —— "待机时松鼠在呼吸"就是它；
   *   · `6347`（普通受击，10 帧）里嵌 `6346`（11 帧）= 挨打那一下的**表情 / 受击特效**；
   *   · `5630`（普攻）里嵌 `5625`（15 帧）= 挥拳的**动效**；
   *   · `5843`（色诱之术）里嵌 `5785`（11 帧）等一整串特效元件。
   *  复刻的静态页策略**出生即冻结**（`render.js` 的 `applyStatic`），于是这些嵌套动画全停在
   *  第一帧：待机**僵住**、攻击 / 技能 / 挨打**没有表情与动效**（用户 2026-11 口径：
   *  "321 go 倒计时的时候松鼠理应有呼吸动作而不是僵住的"、"来点松果、师傅驾到等技能会有表情上的
   *  动作，各种攻击也会有表情上的动作，诱惑等技能也有双方专属的表情动作……很多都没有实现"）。
   *  这里按 Flash 的语义放行：**凡是我们主动播的片断，它整棵子树都不再冻结**
   *  （`__keepAnim` 会随实例出生向下继承，见 `render.js` 的 `showFrame` / `walkStatic`）。
   *  钉住 / 显式停住的那些**照样有效**：装备持有者走 `pinFrame`（节拍器里优先于播放判定），
   *  贴好的装备容器走 `setSymbol` → `gotoAndStop`（停帧）。
   *
   *  ⚠ 哪些嵌套元件确实该"出生就在播"：`动作脚本/sprite<N>.as` 里**没有脚本**的那些
   *  （逐条核过：`5615`(20) / `5616`(17) / `5625`(15) / `6346`(11) / `3195` / `5189` /
   *  `4950` / `5116` / `5188` / `5262` / `5605` 都没有脚本 → 原版里一直自动播）。
   *  有 `stop()` 的（例：色诱之术的 `5785`、普通受击的 `6347`）由外面那条 `playClip` 的
   *  停帧逻辑管 —— 嵌套那一层这里只管"让它转"，不额外改它的帧。 */
  /** 递归放行一棵子树里的嵌套动画；`self` = 连这颗自己一起拨回第 1 帧开始播
   *  （待机呼吸要；`playClip` 外面马上会 `gotoAndPlay(2)`，所以它只要子树）。
   *  `inGear` / 自身是装备时**整支跳过** —— 挂点是 `pinFrame` 钉住的、容器是 `[slot]`
   *  显式停帧的，让它们自己转就等于"装备在角色身上乱跳"（2026-10 踩过）。
   *  ⚠ 只有 `self === true` 那一档才会"拨帧开始播"，子树一律**只放行不拨帧**：
   *  里面有的是**故意停住的**（例：状态图标容器 `7640…7656` 两帧是镜像档，
   *  `specialEffect` 已经 `gotoAndStop` 定住那一档，再让它自己播就会左右翻面闪；
   *  装备容器同理）。真正"该自己播"的嵌套元件会在**出生那一刻**继承 `__keepAnim`
   *  并保持 `playing = true`（`render.js` 的 `showFrame`），不需要这里动手。 */
  /* 动作片断里**显式 stop 在第 1 帧**的特效（5785 = 色诱之术那张脸/特效），
   * 只能按原版停在第一帧，不能被“重启动画”顺手放走。 */
  const EXPLICIT_STOP_IN_ACTION = new Set(['5785']);
  function startNestedAnim(clip, self, inGear, deep, force) {
    if (!clip) return;
    const g = clip.g;
    const tagId = clip.tag && String(clip.tag.id);
    if (tagId && EXPLICIT_STOP_IN_ACTION.has(tagId)) return;   // 整棵子树保持原版停帧
    const gear = !!inGear || clip.__pinFrame != null
      || !!(g && g.getAttribute && g.getAttribute('slot'));
    if (!gear) {
      clip.__keepAnim = true;
      if (self && clip.frames && clip.frames.length > 1 && !clip.__playLock
          && (force || !clip.playing)) {
        try { clip.gotoAndPlay(1); } catch (e) {}
      }
    }
    /* `deep`（待机呼吸那条路）连整棵子树一起转：`5616` 里的 `5615`（20 帧的头/脸那一层）
     * 也是"无脚本 = 原版自动播"，不一起转的话只有身子在呼吸、脑袋是僵的。
     * 其他情况只把 `self` 给这一颗，子树一律"只放行不拨帧"（见上面的注释）。 */
    const nextSelf = deep === true;
    for (const rec of clip.nodes ? clip.nodes.values() : []) {
      if (rec && rec.clip) startNestedAnim(rec.clip, nextSelf, gear, deep, force);
    }
    for (const c of clip.__attached || []) startNestedAnim(c, nextSelf, gear, deep, force);
  }
  /** `playClip` / `play` 用：只放行子树（外面自己会从第 2 帧开始播）。 */
  function allowNestedAnim(clip) { startNestedAnim(clip, false, false); }
  /** 角色动作播完后把嵌套表情/眼睛停在**最后一个有内容的帧**。
   *
   *  这些表情层在原版里多数没有脚本、会自己循环；`deep` 一开始把它们全部放行之后，
   *  父动作停在倒地/胜利的最后一帧，子表情却还在转。倒地后角色会留很久，
   *  最明显的就是「哭脸表情一帧一帧切换」，而且 Android 的低帧率/节拍会让它更显眼。
   *  这里只停**嵌套子件**（父件已经由 `playClip` 停在停止帧），装备/钉帧件照旧跳过；
   *  下一拍动作会重新 `startNestedAnim(deep)`，不会把后续动画冻死。 */
  function freezeNestedAnim(clip, inGear) {
    if (!clip) return;
    const g = clip.g;
    const tagId = clip.tag && String(clip.tag.id);
    if (tagId && EXPLICIT_STOP_IN_ACTION.has(tagId)) return;
    const gear = !!inGear || clip.__pinFrame != null
      || !!(g && g.getAttribute && g.getAttribute('slot'));
    const children = [];
    for (const rec of clip.nodes ? clip.nodes.values() : []) if (rec && rec.clip) children.push(rec.clip);
    for (const c of clip.__attached || []) if (c) children.push(c);
    for (const child of children) {
      const cg = child.g;
      const childGear = gear || child.__pinFrame != null
        || !!(cg && cg.getAttribute && cg.getAttribute('slot'));
      if (!childGear) {
        const end = lastContentFrame(child);
        if (end > 0) stopAt(child, end);
      }
      freezeNestedAnim(child, childGear);
    }
  }
  /* 脸部保留原版深度：5615 眼白必须低于头装；6062 思考眼睛由动态蒙版裁剪。
   * 原 SWF/Ruffle 逐帧对照 5843/6127 的睁眼、闭眼与侧脸后，确认不能按固定
   * depth 50/55 重排：那里会换成整张眼皮、眼影、眼线或爱心，重排会改变表情轮廓。
   * 蒙版与颜色变换的继承/撤销由显示层处理，不能通过把眼白抬到脸皮上方补偿。 */
  /** 一条时间轴里**最后一个有内容的帧**（1 基）。很多动作元件在收招后拖了几条空帧
   *  （实测：闪避 `6432` 第 8~11 帧、`6524` 末两帧），停在那几条空帧上等于**把角色画没了** ——
   *  表现就是"闪避 / 受击演完人消失一下再出现"（用户 2026-11 口径："敌方 UI 一直闪"）。 */
  function lastContentFrame(clip) {
    const frames = clip && clip.frames;
    if (!frames || !frames.length) return 0;
    for (let i = frames.length - 1; i >= 0; i--) {
      const fr = frames[i];
      if (!fr) continue;
      /* `render.js` 的 `buildFrames` 把每一帧存成 `Map<depth, 放置>`：size 为 0 就是空帧。 */
      const size = (typeof fr.size === 'number') ? fr.size : (fr.nodes ? fr.nodes.size : 0);
      if (size > 0) return i + 1;
    }
    return frames.length;
  }
  function playClip(clip, opts) {
    const o = opts || {};
    if (!clip || !clip.gotoAndPlay || !clip.frameCount || !live) return Promise.resolve();
    /* `deep`：这一条是**角色动作**（攻击 / 受击 / 闪避 / 归位 / 胜利姿势），
     * 片断里的表情、眼睛、身体嵌套层要按原版从第 1 帧重新播；否则它们可能停在上一拍
     * `playClip` 停住的帧上 —— 经典战斗里“思考方天画戟时眼睛没了”“多次色诱后脸部贴图
     * 叠着上一张”就是这一类。HUD / statu / 宝箱这些非角色动作不传 deep。 */
    if (o.deep) startNestedAnim(clip, true, false, true, true);
    else allowNestedAnim(clip);
    const last = clip.frameCount() - 1;
    /* 缺省停帧 = **最后一个有内容的帧**（见 `lastContentFrame`），显式 `stop` 优先。 */
    const endIdx = Math.max(0, Math.min(last, lastContentFrame(clip) - 1));
    const stopIdx = (o.stop != null) ? Math.max(0, Math.min(last, Number(o.stop) - 1)) : endIdx;
    const fire = (n) => { if (o.onFrame) { try { o.onFrame(n); } catch (e) {} } };
    /* `resume` = 这一条**已经在播**（`useSkillDefense()` 起手的那条防御技），别再从头拉一遍。 */
    let seen = o.resume ? clip.frame + 1 : 1;
    if (!o.resume) { play(clip, 2); fire(1); }
    return new Promise((resolve) => {
      const tick = () => {
        if (!live || live.stopped || !clip.g || clip.g.isConnected === false) { resolve(); return; }
        const n = clip.frame + 1;
        if (n !== seen && n > seen) { for (let k = seen + 1; k <= n; k++) fire(k); }
        seen = n;
        if (clip.frame >= stopIdx) {
          stopAt(clip, stopIdx + 1);
          if (o.deep) freezeNestedAnim(clip);
          resolve();
          return;
        }
        arm(tick);
      };
      arm(tick);
    });
  }

  /* ============================================================
   * 格斗者：`Player` / `Squirrel` / `Animals` 的等价物
   * ============================================================ */
  /** 把一侧的 `7689` 挂到战斗视图上并摆到原版位置。
   *  ⚠ 原版链路是 `player1.playerMc.attachMovie("松鼠","playerMc")` —— 也就是
   *  **挂在 7639 这颗"身体槽"里面**，而 7639 的第 2 帧会把第 1 帧那批 `ikNode_*` 摘掉
   *  （`gotoAndStop(2)`）。`attachChild` 不会写进 `byName` 表，所以主角本体**必须由这里回传**，
   *  不能回头再 `slot.byName('playerMc')` 取（那样永远是 null，动作全都不播 —— 2026-10 实拍发现的）。 */
  function buildFighter(view, side, wears, npcType, campaign, mutant) {
    const plan = planSide(wears);
    const holder = view.attachChild(SYM.fighter, 1, 'player' + (side + 1));
    if (!holder) return null;
    holder.setExtraTransform('matrix(' + SIDE_MATRIX[side] + ')');
    /* 征战（副本）动物 boss：`player2.gotoAndStop(6)` + `attachMovie("副本角色所有")`。
     * 原版是 6833 的 `mcFrame` 拨到动物形态，再取它的 `playerMc` 作为 action 宿主；
     * 这里同样把 6833 挂到 7689 的 playerMc 槽位，`makeFighter` 拿到的是里面的动物模型。 */
    if (campaign) {
      /* 原版 `player2.gotoAndStop(6)` 才是征战体型槽；frame1 是松鼠，直接挂 6833 会把
       * 动物按松鼠槽的局部坐标放大到两倍。 */
      stopAt(holder, 6);
      /* 7689 第 6 帧的 `playerMc` 槽是 **7688**（2 帧）：
       *   · 第 1 帧 = 一整套**拼好的静态动物**（19 颗零件，姿态就是狡兔）；
       *   · 第 2 帧 = 空帧（全部 remove）。
       * 原版 `MainMovie.as:6237` 挂完 6833 立刻 `player2.playerMc.gotoAndStop(2)` ——
       * 就是为了把这只静态动物收掉。复刻以前停在第 1 帧，于是那只**狡兔永远留在敌人位置**：
       * 狡兔战里和真模型叠成重影、狼王 / 妖狐 / 猿将战里多出一只狡兔
       * （用户 2026-10 口径："猿将战中敌人位置还有一个狡兔"）。 */
      const slot = holder.byName('playerMc');
      if (slot) {
        stopAt(slot, 2);
        /* 二次挂载（同一槽位重进）时兜底：先清掉上一次的运行时子件。 */
        if (slot.detachAll) { try { slot.detachAll(); } catch (e) {} }
        const set = slot.attachChild('6833', 1, 'playerMc');
        const frame = Math.max(1, Math.min(7, Number(campaign.mcFrame) || 1));
        if (set) {
          stopAt(set, frame);
          const model = set.byName('playerMc');
          if (model) {
            holder.__hero = model;
            holder.__campaign = campaign;
            live.plans[side] = null;
            holderPlan.set(holder, null);
            return holder;
          }
        }
      }
      /* 模型缺失时也停在这条分支：绝不能掉进下面的三侠分支，否则 campaign 会被当成
       * `npcType` 去查 NPC_FRAME，最后变成一只静态木人。 */
      return holder;
    }
    /* 三侠 / 木人：原版 `player2.gotoAndStop(2/3/4/5)` + 往 `playerMc` 挂模型。
     * 这里直接用 7689 对应帧里**已经烤好的原版矢量稿**（见 NPC_FRAME 的注释）。 */
    if (npcType) {
      const frame = NPC_FRAME[npcType] || 1;
      stopAt(holder, frame);
      const model = holder.byName('playerMc') || null;
      holder.__npc = npcType;
      holder.__mutant = !!mutant;
      holder.__hero = model || null;
      if (model) prepareNpcModel(model);
      live.plans[side] = null;
      holderPlan.set(holder, null);
      return holder;
    }
    /* ⚠ 装备的 plan 必须在**建树那一刻**就绪：挂点是在 `showFrame()` 里实例化的。 */
    const prev = building;
    building = plan;
    let hero = null;
    try {
      const slot = holder.byName('playerMc');
      if (slot) {
        stopAt(slot, 1);
        hero = slot.attachChild(SYM.hero, 1, 'playerMc');
        stopAt(slot, 2);
        const statu = holder.byName('statu');
        if (statu) stopAt(statu, statu.frameCount());
        if (hero) heroPlan.set(hero, plan);
      }
    } finally { building = prev; }
    live.plans[side] = plan;
    holderPlan.set(holder, plan);
    holder.__hero = hero || null;
    return holder;
  }
  let building = null;
  const holderPlan = new WeakMap();
  const heroPlan = new WeakMap();
  /** 那颗 clip 属于哪一位格斗者（`chooseWeapon*` / `showWeaponSize` 要知道"这一拍谁的武器"）。 */
  function fighterOf(clip) {
    for (let c = clip; c; c = c.parent) if (c.__fighter) return c.__fighter;
    return null;
  }
  /* 带字的特效元件（见 `onClip` 里那段说明）：三颗字型精灵**都是正字烘焙**
   * （2026-10-17 / 2026-11 逐颗独立挂载核对：6431「闪避」、5864「师父驾到」、6438「装死」
   * 脱离父级镜像单看都是正的；旧版把 6438 误当成反字烘焙，于是敌方装死被父级镜像翻反、
   * 我方又被自翻一次，两侧都不对）。屏幕朝向 = 烘焙朝向 ⊕ 父级镜像（敌方整棵子树
   * scaleX<0）⊕ 自翻；所以只要敌方补一次自翻即可。 */
  const TEXT_ART_SYMS = new Set([5864, 6431, 6438]);
  const TEXT_ART_BAKED_MIRROR = new Set();
  /** 把一颗实例**绕自己包围盒中心**左右翻（原地镜像，不挪位置）。
   *  实例刚出生时还没进文档，`getBBox()` 量不到 → 下一帧补一次（与 `anchorToBBox` 同一套路）。 */
  function mirrorInPlace(clip, retry) {
    if (!clip || !clip.g || !clip.setExtraTransform) return false;
    if (clip.__mirroredInPlace) return true;
    let b = null;
    try { b = clip.g.getBBox(); } catch (e) { b = null; }
    if (!b || !(b.width > 0)) {
      if (!retry && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { try { mirrorInPlace(clip, true); } catch (e) {} });
      }
      return false;
    }
    const cx = b.x + b.width / 2;
    clip.__mirroredInPlace = true;
    clip.setExtraTransform('translate(' + (2 * cx).toFixed(2) + ',0) scale(-1,1)');
    return true;
  }
  /** 有些带字元件是在 `holder.__fighter` 还没挂上时建出来的（例如装死 6440 里的 6438，
   *  是随角色本体一起预建的）。这时先等一帧再认人；确认属于哪位格斗者后再补朝向。 */
  function retryOrientation(clip, apply, tries) {
    const fighter = fighterOf(clip);
    if (fighter) { apply(clip, fighter); return; }
    if ((tries || 0) < 12 && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { try { retryOrientation(clip, apply, (tries || 0) + 1); } catch (e) {} });
    }
  }
  function orientStatu(clip, fighter) {
    if (clip.__oriented) return;
    clip.__oriented = true;
    stopAt(clip, STATU_ICON_FRAME[Number(clip.tag.id)] || 1);
    if (Number(fighter.side) !== 0 && clip.setExtraTransform) clip.setExtraTransform('scale(-1,1)');
  }
  function orientTextArt(clip, fighter) {
    /* 6431「闪避」有 2 帧（6429 正字 / 6430 镜像）；它挂在闪避动画里会自播，
     * 表现就是“闪避两个字左右来回闪”。和其它字标一样先钉在正字第 1 帧，
     * 敌方再补一次自翻。 */
    stopAt(clip, 1);
    const parentMirrored = Number(fighter.side) !== 0;
    const bakedMirrored = TEXT_ART_BAKED_MIRROR.has(Number(clip.tag.id));
    if (bakedMirrored !== parentMirrored) mirrorInPlace(clip);
  }
  /** 新建实例的接管点（`render.js` 的 `onClip`）：钉持有者 / 贴容器 / 拨手里的武器 / 状态图标朝向。 */
  function onClip(clip) {
    /* 手里的武器：原版是这些容器/美术**自己的第 1 帧脚本**在调 `_root.chooseWeaponGo(this)` /
     * `_root.chooseWeapon(this)` / `_root.showWeaponSize(this)`（`Squirrel.as:425/476/522`）。
     * 复刻里接到"实例化这一刻"，与装备那套同一个接管点。 */
    const fighter = fighterOf(clip);
    const art = fighter && fighter.weaponNow;
    if (art) {
      const cont = WEAPON_ART_CONTAINERS[Number(clip.tag.id)];
      if (cont) {
        const fr = cont.frames[art.id];
        if (fr) { stopAt(clip, fr); return; }
      } else if (WEAPON_ART_SYMS.has(Number(clip.tag.id))) {
        stopAt(clip, WEAPON_SIZE_FRAMES[art.level] || 1);
        return;
      }
    }
    /* 状态图标的**正字 / 朝向**：图标容器（7640…7656）自己的第 1 帧脚本是
     * `stop(); _root.showReverse(this, 1)` —— 两帧互为镜像（`showReverse`：左 1 / 右 2）。
     * ⚠⚠ 但**敌方那一侧整个 `7689` 本身就是镜像的**（原版就这么摆：面朝左），挂在它里面的
     * 状态图标会连字一起被翻过去 —— 力↓ 变成反着写的力、「晕击」变成反着写的两个字
     * （用户 2026-11 口径："敌方的信息提示镜像是错误的做法，镜像后是反过来的字，这就不对了"）。
     * 所以这里改成：**统一用"正字帧"，右边那位再把自己翻回来一次**（`scale(-1,1)` 只翻自己这一层，
     * 位置不动、箭头也照旧朝下），而不是去挑那颗"预先镜像好"的帧 —— 后者各颗约定不一致
     *（见 `STATU_ICON_FRAME`），挑错一颗就又是反字。 */
    if (STATU_ICON_SYMS.has(Number(clip.tag.id))) {
      if (fighter) orientStatu(clip, fighter);
      else retryOrientation(clip, orientStatu);
      return;
    }
    /* **带字的特效**（"闪避" / "师父驾到" / "装死" / "被击退" 里那几颗字）：
     * 屏幕朝向 = 烘焙朝向 ⊕ 父级镜像（敌方整棵子树 scaleX<0）⊕ 自翻。
     * 三颗字都是正字烘焙（见 `TEXT_ART_BAKED_MIRROR` 的注释），敌方补一次自翻即可。
     * 名单怎么来的：在 `tags-fight.json` 里按"黄橙渐变 + 棕描边"的字形样式扫出来的三颗字型元
     * 件（5862/5863→5864、6429/6430→6431、6436/6437→6438），宿主是
     * `5922`（师父驾到）/`6432`（闪避）/`6440`（装死）/`6523`（被击退）—— 都在角色身上。 */
    if (TEXT_ART_SYMS.has(Number(clip.tag.id))) {
      if (fighter) orientTextArt(clip, fighter);
      else retryOrientation(clip, orientTextArt);
      return;
    }
    let plan = null;
    for (let c = clip; c && !plan; c = c.parent) plan = holderPlan.get(c) || heroPlan.get(c) || plan;
    if (!plan) plan = building;
    if (!plan) return;
    if (clip.parent) holderPlan.set(clip, plan);
    const hf = plan.holders.get(String(clip.tag.id));
    if (hf != null) { try { clip.pinFrame(hf); } catch (e) {} return; }
    const p = plan.bySlot.get(String(clip.tag.id));
    if (p && clip.setSymbol) {
      if (clip.g && clip.g.setAttribute) clip.g.setAttribute('slot', String(clip.tag.id));
      clip.setSymbol(p.symbol, p.frame, 1, 'topleft');
      clip.__gearSlot = true;
      /* ⚠ 身体装备（`gearBody` / `gearArm`，type 2）**不能**在战斗层再 `mirrorInPlace` 一次。
       * 依据（2026-10 逐项核对）：
       *  · 容器画稿和角色**同向**：村庄 `myself` 穿的是同一套 B 容器、同一个 `topleft` 锚点，
       *    不翻转就合身；敌方那一侧整棵 `7689` 本来就是 `scaleX<0`，由父级统一镜像。
       *  · `mirrorInPlace` 是给"带字特效"做**绕包围盒中心**原地翻转的，它只写
       *    `translate(2cx) scale(-1,1)`，会把 `setSymbol(..., 'topleft')` 刚算好的
       *    `translate(-bbox.x,-bbox.y)` 整段覆盖掉 —— 贴图整体左上偏一个包围盒原点
       *    （身体服实测偏 28.8×22.4 个局部单位，约 63×49 屏幕像素），看起来"完全没合身"，
       *    偏上去的那截袖子/肩甲还像"身体旁边多了一段手臂"（用户 2026-10 口径）。
       * 所以这里保持 `setSymbol` 的 `topleft` 锚点，只让父级负责朝向。 */
      if (fighter && live && live.strip && live.strip[Number(fighter.side)]) setGearClipHidden(clip, true);
    }
  }

  /* ============================================================
   * 回合 → 动作帧：`Squirrel.as` 的选择逻辑
   * ------------------------------------------------------------
   * 原版 `currentRound` 由服务端给，字段是 `attackType` / `weaponSkillId` / `defenseType` /
   * `defenseSkillId`；复刻的 `Sim.simulate()` 给的是另一套（`action` / `id` / `dodge` / …），
   * 下面几张表就是**全部**映射规则，改动画只动这里。
   *
   * ⚠⚠ 四档 attackType 对应的是**四组完全不同的动画**（`Squirrel.as:8-149`）：
   *   1 = 普通攻击 → `attacks` 第 1 帧
   *   2 = 武器攻击 → 近战第 2 帧 / 投掷第 3 帧
   *   3 = **技能**   → 按 `weaponSkillId` 进 switch（**只有 8/12/13/14/15/17/18/23 这 8 个**）
   *   4 = **幻兽/召唤** → 第 `29 + id` 帧（`attacks.attack.allPets…`）
   * 第 4 档**只在 `action:'pet'` 时走**（见 `PET_ATTACK_ACTS`）；技能仍走第 3 档。
   * 2026-11 用户口径："战斗中我观察到我方大量使用了幻兽……说明你的武器和技能调用出了很大的问题"，
   * 当时就是把所有 `action == 'skill'` 都塞进了第 4 档（`29 + id`），于是每个技能都在放召唤动画。
   * ========================================================== */
  /* 技能 → `attacks` 选择帧 `[普通, 真形态(等级>10)]`（`Squirrel.as` 的 switch 逐条抄）。 */
  const SKILL_ATTACK_FRAME = {
    8: [4, 15], 12: [5, 16], 13: [6, 6], 14: [7, 17],
    15: [8, 18], 17: [9, 19], 18: [10, 20], 23: [12, 21],
  };
  /** 这个技能有没有"出手动画"（不在表里的都是被动/防御类：力王附体、暴击、装死……）。 */
  const hasAttackAnim = (id) => Object.prototype.hasOwnProperty.call(SKILL_ATTACK_FRAME, Number(id));
  function isTrueForm(r) {
    return r.trueForm === true || r.isTrue === true || Number(r.level) > 10;
  }
  /* ---------- 幻兽协战：原版 `attackType 4` ----------
   * `Squirrel.attack()` 对第 4 档只做一件事：`mc.attacks.gotoAndStop(29 + weaponSkillId)`
   * —— 帧号就是 **petsInfo 的幻兽 id**（30..61，共 32 只），每帧里烤好了这只幻兽自己的
   * 出招动画。`sprite<元件号>.as` 的第 N 帧 `_root.beAttack()` 就是命中帧，逐条抄在下面。 */
  const PET_ATTACK_ACTS = {
    1: { sym: 6203, hit: 22 }, 2: { sym: 6207, hit: 19 }, 3: { sym: 6210, hit: 18 }, 4: { sym: 6216, hit: 16 },
    5: { sym: 6223, hit: 18 }, 6: { sym: 6224, hit: 27 }, 7: { sym: 6225, hit: 23 }, 8: { sym: 6233, hit: 25 },
    9: { sym: 6236, hit: 22 }, 10: { sym: 6241, hit: 19 }, 11: { sym: 6256, hit: 23 }, 12: { sym: 6261, hit: 21 },
    13: { sym: 6262, hit: 19 }, 14: { sym: 6265, hit: 16 }, 15: { sym: 6284, hit: 15 }, 16: { sym: 6291, hit: 22 },
    17: { sym: 6296, hit: 30 }, 18: { sym: 6299, hit: 30 }, 19: { sym: 6302, hit: 17 }, 20: { sym: 6305, hit: 22 },
    21: { sym: 6312, hit: 22 }, 22: { sym: 6317, hit: 17 }, 23: { sym: 6318, hit: 22 }, 24: { sym: 6324, hit: 21 },
    25: { sym: 6325, hit: 16 }, 26: { sym: 6326, hit: 22 }, 27: { sym: 6327, hit: 22 }, 28: { sym: 6328, hit: 22 },
    29: { sym: 6330, hit: 22 }, 30: { sym: 6331, hit: 17 }, 31: { sym: 6332, hit: 22 }, 32: { sym: 6338, hit: 22 },
  };
  /** `squirrelAttackConfig` 的 attackType 4 段：幻兽 id → `defenses` 第几帧。
   *  -1 = 这一只的技能不造成直接命中（回血 / 诅咒 / 自身增益），原版
   * `MainMovie.as:6392` 会跳过受击方动作，但仍然应用 `attackerHeal`。 */
  const PET_DEFENSE_FRAME = {
    1: 11, 2: 12, 3: 13, 4: -1, 5: -1, 6: 16, 7: 17, 8: -1, 9: 18, 10: -1, 11: -1,
    12: 19, 13: 23, 14: 24, 15: 25, 16: -1, 17: -1, 18: 26, 19: 29, 20: 30,
    21: -1, 22: 32, 23: -1, 24: -1, 25: 35, 26: -1, 27: -1, 28: -1, 29: 39, 30: 40, 31: -1, 32: -1,
  };
  /* ---------- 手里的那把武器：`chooseWeapon` / `chooseWeaponGo` / `showWeaponSize` ----------
   * 原版出手动画里**真的握着这一拍用的那把武器**，靠的还是"帧脚本"：
   *   · 近战武器攻击（`5748`）在 `ikNode_98`/`ikNode_116` 上挂了容器 `5735` → 里面是 `5734`
   *     （9 帧，一帧一把近战武器），`5734` 第 1 帧调 `_root.chooseWeaponGo(this)`
   *     → `Squirrel.chooseWeaponGo` 按 `weaponSkillId` 拨帧；
   *   · 投掷攻击（`5778`）里是 `5776`（8 帧，一帧一把投掷武器），第 1 帧调 `_root.chooseWeapon(this)`
   *     → `Squirrel.chooseWeapon`；
   *   · 选中的那把武器美术（`5666`…`5775`）自己第 1 帧调 `_root.showWeaponSize(this)`
   *     → `Squirrel.showWeaponSize` 按 `attackerWeaponLevel` 再挑**型号**（8 级 → 第 2 帧 … 15 级 → 第 9 帧）。
   * 三张表合起来才是"拿出哪把武器、多大"。
   *
   * ⚠⚠ 复刻以前一条都没接，于是近战一律停在容器第 1 帧 = **方天画戟**、投掷一律第 1 帧 = **死老鼠**：
   *   玩家换了武器（或早把方天画戟卖了）战斗里照样握着它 —— 用户 2026-11 口径：
   *   "战斗中玩家会使用自己没有的技能&武器"。 */
  const MELEE_WEAPON_ART = { sym: 5734, frames: { 1: 1, 2: 2, 3: 3, 4: 4, 11: 5, 12: 6, 15: 7, 16: 8, 17: 9 } };
  const THROW_WEAPON_ART = { sym: 5776, frames: { 5: 1, 6: 2, 7: 3, 8: 4, 9: 5, 10: 6, 13: 7, 14: 8 } };
  /** 武器容器（`5734` / `5776`）→ 它自己那一套 id → 帧 的映射。 */
  const WEAPON_ART_CONTAINERS = { 5734: MELEE_WEAPON_ART, 5776: THROW_WEAPON_ART };
  /** 单把武器的美术（`showWeaponSize` 的接收者）→ 按等级挑型号帧。 */
  const WEAPON_SIZE_FRAMES = { 8: 2, 9: 3, 10: 4, 11: 5, 12: 6, 13: 7, 14: 8, 15: 9 };
  const WEAPON_ART_SYMS = new Set([5666, 5670, 5674, 5679, 5686, 5697, 5706, 5724, 5733,
    5753, 5757, 5760, 5763, 5766, 5769, 5772, 5775]);
  function attackPlan(r) {
    /* 幻兽协战：`attacks` 第 `29 + 幻兽 id` 帧（30..61）。 */
    if (r.action === 'pet') {
      const id = Math.max(1, Math.min(32, Number(r.petId) || 0));
      return { frame: 29 + id, petId: id };
    }
    if (r.action === 'weapon') return { frame: RANGED.has(Number(r.id)) ? 3 : 2 };
    if (r.action === 'skill') {
      const pair = SKILL_ATTACK_FRAME[Number(r.id)];
      if (!pair) return { frame: 1 };            // 被动技能：退回普通攻击那一帧，绝不放幻兽
      return { frame: isTrueForm(r) ? pair[1] : pair[0] };
    }
    /* `attackType 0` = "这一拍不出手"（`Squirrel.attack` 的第一支）：`attacks` 第 11 帧 = `6067`，
     * 30 帧的"站着准备"动作（第 1 帧 stop、第 2 帧 play、第 30 帧 setAttackEnd）。
     * 复刻的休息 / 眩晕回合以前**完全不播它**（只等 420ms），所以方天画戟的
     * "思考一回合"在画面上根本看不出来（用户 2026-11 口径）。 */
    if (r.action === 'rest' || r.action === 'stunned') return { frame: 11 };
    return { frame: 1 };
  }
  /* 防御技能（`useSkillDefense` / `Player.specialEffect` 的 `defenseSkillId`）。
   * ⚠ 龟甲术（7）与绝对防御（16）各有一档**真形态**：`Squirrel.useSkillDefense` 里按
   * `defenderWeaponLevel > 10` 分别走第 4 / 第 5 帧（`DEFENSE_SKILL_ACTS` 里那两条就是它）。
   * 以前这里恒返回基础档，真·龟甲术 / 真·绝对防御**永远播普通档** —— 也是"用了自己没有的技能"。 */
  const DEFENSE_SKILL_FRAME = { 6: 1, 7: 2, 16: 3 };
  const DEFENSE_SKILL_TRUE_FRAME = { 7: 4, 16: 5 };
  /** 这一回合该档防御技的帧号；`lvl` = 防守方**那个技能**的等级（>10 = 真形态）。 */
  function defenseSkillFrame(id, lvl) {
    const k = Number(id);
    if (Number(lvl) > 10 && DEFENSE_SKILL_TRUE_FRAME[k]) return DEFENSE_SKILL_TRUE_FRAME[k];
    return DEFENSE_SKILL_FRAME[k];
  }
  /** 这一回合要给受击方飘哪一颗状态图标 —— 返回 `Player.specialEffect()` 的 statu 档位。
   *
   *  复刻的事件流里没有原版那个 `specialEffectType`，所以按**真实的中招效果**映回原版那四档
   *  （`STATU_ICON`：statu 1→图标 5 / 2→6 / 3→4 / 4→8）：
   *    · **眩晕**（色诱之术 / 板砖的 `stunApplied`）→ statu 4 → 第 8 帧「晕击」；
   *    · **力/敏/速下降**（投掷武器 8 / 5 / 6，sim 的 `debuffStat`）→ statu 3 / 1 / 2 → 第 4 / 5 / 6 帧。
   *  ⚠⚠ 2026-11 用户口径："给敌人施加 debuff 的时候飘的 debuff ui 是错误的 ui"。原因就是这里
   *  以前把三档 statu 当成了"中毒/沉默/缴械"用（stun→statu 3 = **力量下降**、中毒→statu 1 = 敏捷下降…），
   *  而 statu 3 在原版的意思恰恰是**力量下降** —— 于是眩晕飘出"力↓"、吃毒飘出"敏↓"。
   *  原版对**中毒 / 沉默 / 缴械根本没有图标**（中毒只飘伤害数字、冻结走冻结横幅），所以一律返回 0
   *  —— 现代播放器同样只给 `debuffText` 飘字、不给这些效果图标。 */
  function effectStatu(r) {
    if (r.stunApplied || r.freezeApplied) return 4;
    const stat = r.debuffStat || (/力量/.test(r.debuffText || '') ? 'power'
      : /敏捷/.test(r.debuffText || '') ? 'agility'
        : /速度/.test(r.debuffText || '') ? 'speed' : '');
    if (stat === 'power') return 3;
    if (stat === 'agility') return 1;
    if (stat === 'speed') return 2;
    return 0;
  }
  /* **被技能打中**时的专属受击帧（`Squirrel.beAttack`，键是出手方那个技能的 id）：
   * `[普通, 中了特效]`；23（幸运一击）那一档是"原地防御再播一次 defense"。 */
  const SKILL_DEFENSE_FRAME = { 8: [7, 9], 12: [2, 2], 15: [6, 6], 18: [8, 3], 23: [1, 1] };
  /** 这一拍受击方该播哪一段。`side` = **正在演出的这一侧**（0/1）：
   *  ⚠ `r.fakeDie` 说的是"**有人**装了死"，装死的是 `r.fakeDieSide`（普通受击 = 挨打那位；
   *  被反伤打死 = **出手那位**，见 sim 的 `reflectHurt`）。以前这里不看这一位，
   *  于是"出手方被反伤打出装死"时**挨打方**会莫名其妙演一段装死 —— 玩家没这个技能也照演
   *  （用户 2026-11："战斗中玩家会使用自己没有的技能"）。现代播放器从一开始就分这一位
   *  （`battle.js` 的 reaction：`r.fakeDieSide == null || Number(r.fakeDieSide) === Number(side)`）。 */
  function defensePlan(r, hasEquip, lvl, side) {
    /* 装死优先于幻兽受击帧：幻兽的直接伤害也能把松鼠打到装死，
     * 这一拍该演的是「装死」而不是幻兽的普通受击。 */
    const fakeSide = r.fakeDieSide == null ? r.attacker : Number(r.fakeDieSide);
    if (r.fakeDie && (side == null || Number(side) === Number(fakeSide))) {
      return { kind: 'skill', frame: defenseSkillFrame(6, lvl) };
    }
    /* 幻兽协战：受击帧由 `squirrelAttackConfig` 的 attackType 4 段决定。
     * -1（回血 / 诅咒 / 自身增益）在原版里不播受击动作，也不扣血 —— 只留一个空档，
     * 让回放层照常应用 `attackerHeal`。 */
    if (r.action === 'pet') {
      const pf = PET_DEFENSE_FRAME[Number(r.petId)];
      return pf > 0 ? { kind: 'hit', frame: pf, pet: true } : { kind: 'none', pet: true };
    }
    if (r.dodge) return { kind: 'dodge' };
    if (r.guiJia) return { kind: 'skill', frame: defenseSkillFrame(7, lvl) };
    if (r.jueDui) return { kind: 'skill', frame: defenseSkillFrame(16, lvl) };
    if (r.action === 'skill') {
      const pair = SKILL_DEFENSE_FRAME[Number(r.id)];
      if (pair) {
        /* 8（色诱之术）中了特效还要**身上有装备**才走第 9 帧（原版 `hasEquip()`）。 */
        const special = Number(r.specialEffect) === 1;
        const frame = (special && (Number(r.id) !== 8 || hasEquip !== false)) ? pair[1] : pair[0];
        return { kind: 'hit', frame: frame, replay: Number(r.id) === 23 };
      }
    }
    return { kind: 'hit' };
  }

  /* ============================================================
   * 【帧脚本】原版每个动作元件**自己**的帧动作表
   * ------------------------------------------------------------
   * 原版没有"时间轴控制器"：整套战斗演出是**动画片断自己的帧动作**在关键帧上回调 `_root`
   * （反编译源码 `03-反编译源码/动作脚本/sprite<元件号>.as` 逐条可查）：
   *   · `_root.useSkillDefense()` —— 防御技起手（`Squirrel.useSkillDefense`，只有
   *     `defenseType == 2` 才有动作）。注意它在 **`beAttack` 之前好几帧**：原版是先在
   *     出手动画放到第 3~25 帧时把盾举起来，再在第 9~31 帧挨打。
   *   · `_root.beAttack()` —— 命中：受击方起手 + 扣血 + 飘字（`Player.reduceBlood`）。
   *   · `_root.setAttackEnd()` / `_root.boom()` —— 这一拍结束，`myLogic` 才发下一拍。
   *   · `_root.attackBack()` —— **受击动画自己**放到这一帧才反击 / 归位。
   *   · `_root.die()` / `_root.congratulate()` —— 倒地播到最后一帧才算"死"，胜利方随即起手。
   *
   * 复刻以前用"出手后固定等一拍（71ms）就当打中了"，招式还在起手、对面先倒了 ——
   * 观感就是"我方攻击动画与敌方受击动画对不上"（用户 2026-11 口径，本批最严重的一条）。
   * 下面三张表就是**全部**帧号；键 = 对应选择器的帧号（`attackPlan` / `defensePlan` 的返回值）。
   * ========================================================== */
  /** `attacks`(6339) 选择帧 → 该动画元件在**第几帧**干什么。
   *  ⚠ `guard`（原版帧脚本里提前调 `_root.useSkillDefense()` 的那一帧）**现在只留作取证**：
   *  照用户 2026-11 口径"绝对防御与龟甲术的动画触发实际太早了，参考现代版的做法"，
   *  防御技改在**命中那一刻**起手（见 `playRound` 的 `impact`），与 `battle.js` 一致。 */
  const ATTACK_ACTS = {
    1: { sym: 5630, guard: 3, hit: 9 },          // 普通攻击
    2: { sym: 5748, guard: 3, hit: 9 },          // 武器 · 近战
    3: { sym: 5778, guard: 8, hit: 14 },         // 武器 · 投掷
    4: { sym: 5843, guard: 8, hit: 14 },         // 8 色诱之术
    5: { sym: 5855, guard: 3, hit: 9 },          // 12 野球拳
    6: { sym: 5922, heal: 37 },                  // 13 师父驾到（只加血，**不打人**）
    7: { sym: 5957 },                            // 14 小宇宙爆发（只加属性，**不打人**）
    8: { sym: 5991, guard: 16, hit: 22 },        // 15 通灵召唤
    9: { sym: 6026, heal: 37 },                  // 17 来点松果（只加血，**不打人**）
    10: { sym: 6057, guard: 12, hit: 18 },       // 18 吸铁大法
    11: { sym: 6067 },                           // attackType 0（"这一拍不出手"）
    12: { sym: 6122, guard: 25, hit: 31 },       // 23 幸运一击（`boom` 连击收尾）
    15: { sym: 6127, guard: 8, hit: 14 },        // 8 色诱之术 · 真形态
    16: { sym: 6129, guard: 3, hit: 9 },         // 12 野球拳 · 真形态
    17: { sym: 6134 },                           // 14 小宇宙爆发 · 真形态
    18: { sym: 6145, guard: 16, hit: 22 },       // 15 通灵召唤 · 真形态
    19: { sym: 6169, heal: 37 },                 // 17 来点松果 · 真形态
    20: { sym: 6175, guard: 12, hit: 18 },       // 18 吸铁大法 · 真形态
    21: { sym: 6185, guard: 25, hit: 31 },       // 23 幸运一击 · 真形态
  };
  /* 幻兽帧 30..61 并进同一张表：`attack()` 只读 `hit` / `heal` 两个钩子，
   * 这样不用在回放主路径里再分一次「这一拍是不是幻兽」。 */
  for (const [id, acts] of Object.entries(PET_ATTACK_ACTS)) ATTACK_ACTS[29 + Number(id)] = acts;
  /** `defenses`(6427) 选择帧 → 受击动画；`back` = 它自己在第几帧调 `_root.attackBack()`。 */
  const DEFENSE_ACTS = {
    1: { sym: 6347, back: 10 },                  // 普通受击
    2: { sym: 6350 },                            // 12 野球拳
    3: { sym: 6354 },                            // 18 吸铁大法（中特效）
    4: { sym: 6366 },                            // 倒地（`dead(distance)` → 4 / 5）
    5: { sym: 6366 },
    6: { sym: 6379 },                            // 15 通灵召唤
    7: { sym: 6393 },                            // 8 色诱之术
    8: { sym: 6395 },                            // 18 吸铁大法
    9: { sym: 6415 },                            // 8 色诱之术（中特效且身上有装备）
    /* 幻兽协战的受击帧（`squirrelAttackConfig` attackType 4 段；11..40）。
     * 这些帧里有几帧的子件没有实例名（例如 19 帧是 6424），`beAttack` 会用
     * `onlyChildClip()` 兜底，不能因为 `byName('defense')` 为空就整段跳过。 */
    11: { sym: 6416 }, 12: { sym: 6418 }, 13: { sym: 6347 }, 16: { sym: 6421 },
    17: { sym: 6421 }, 18: { sym: 6347 }, 19: { sym: 6424 }, 22: { sym: 6421 },
    23: { sym: 6421 }, 24: { sym: 6421 }, 25: { sym: 6347 }, 26: { sym: 6347 },
    28: { sym: 6421 }, 29: { sym: 6347 }, 30: { sym: 6421 }, 32: { sym: 6425 },
    35: { sym: 6425 }, 39: { sym: 6421 }, 40: { sym: 6421 },
  };
  /** `defenseSkills`(6512) 选择帧 → 防御技动画（`back` 同上）。 */
  const DEFENSE_SKILL_ACTS = {
    1: { sym: 6440, back: 36 },                  // 6 装死
    2: { sym: 6464, back: 31 },                  // 7 龟甲术
    3: { sym: 6497, back: 31 },                  // 16 绝对防御（`doSkillDefense` 在第 8 帧）
    4: { sym: 6504, back: 31 },                  // 7 龟甲术 · 真形态
    5: { sym: 6511, back: 31 },                  // 16 绝对防御 · 真形态
    6: { sym: 6511, back: 31 },
  };
  const DODGE_ACTS = { sym: 6432, back: 10 };                 // 闪避（`dodges` 6433 第 1 帧）
  /* 反击（`attackbacks` 6517 第 1 帧）：第 5 帧 `beBttackBack()`（结算反伤 + 出手方归位）、
   * 第 15 帧 `congratulate()`（本文件把它交给收尾那一步，见 `perform`）。 */
  const ATTACKBACK_ACTS = { sym: 6516, hit: 5 };
  /** `comeBack(type)`：`type` 0/1/2 → `comeBacks`(6524) 第 1/2/3 帧 → 下面这三个元件。 */
  const COMEBACK_ACTS = { 1: { sym: 6521 }, 2: { sym: 6522 }, 3: { sym: 6523 } };
  const HUD_STOP = 8;                          // `7703` 血条：第 8 帧 `stop(); showFightInfo(this)`
  /** 相邻两拍之间的呼吸（现代播放器 `battle.js` 每回合收尾 `await wait(170)`）。 */
  const ROUND_GAP = 170;
  /** 帧脚本里 `back` 的通用接线：`acts` 有 `back` 且放到那一帧了就回调。 */
  const backHook = (acts, hooks, key) => {
    const at = acts && acts.back;
    if (!at || !hooks || !hooks[key || 'back']) return undefined;
    return (n) => { if (n >= at) hooks[key || 'back'](); };
  };

  /** 一个"格斗者"：包住 `7689` 实例，暴露 `Squirrel.as` 的那几个动作。 */
  /* ---------- 三侠 / 木人的静态矢量模型：呼吸 + 出招 / 受击 / 倒地 ----------
   * 原版外部 SWF（`FightGame/Mantis3.swf` 等）没有进仓库的参考资料，但 7689 的
   * 第 2/3/4/5 帧已经把三侠与木人的**静态矢量稿**烤在主 SWF 里；这里把画稿包进一个
   * 呼吸壳（CSS 只动壳），动作位移写到外面的 `mc` 上，两者互不影响。 */
  const NPC_NS = 'http://www.w3.org/2000/svg';
  function prepareNpcModel(model) {
    if (!model || !model.g || model.__npcBob) return model;
    const bob = document.createElementNS(NPC_NS, 'g');
    bob.setAttribute('class', 'sf-npc-bob');
    for (const n of Array.from(model.g.childNodes)) {
      if (n.nodeType === 1 && String(n.tagName).toLowerCase() === 'defs') continue;
      bob.appendChild(n);
    }
    model.g.appendChild(bob);
    model.__npcBob = bob;
    return model;
  }
  function npcPose(api, o) {
    const mc = api && api.mc;
    if (!mc || !mc.setExtraTransform || !mc.g) return;
    const opt = o || {};
    if (!api.__npcBox) {
      try { const b = mc.g.getBBox(); if (b && b.width) api.__npcBox = { x: b.x, y: b.y, w: b.width, h: b.height }; }
      catch (e) { api.__npcBox = null; }
    }
    const b = api.__npcBox;
    const cx = b ? b.x + b.w / 2 : 0, cy = b ? b.y + b.h / 2 : 0;
    const parts = [];
    if (opt.dx || opt.dy) parts.push('translate(' + (Number(opt.dx) || 0).toFixed(2) + ',' + (Number(opt.dy) || 0).toFixed(2) + ')');
    if (cx || cy) parts.push('translate(' + cx.toFixed(2) + ',' + cy.toFixed(2) + ')');
    if (opt.scale && opt.scale !== 1) parts.push('scale(' + Number(opt.scale).toFixed(3) + ')');
    if (opt.rotate) parts.push('rotate(' + Number(opt.rotate).toFixed(2) + ')');
    if (cx || cy) parts.push('translate(' + (-cx).toFixed(2) + ',' + (-cy).toFixed(2) + ')');
    mc.setExtraTransform(parts.join(' '));
    if (opt.opacity != null) mc.g.style.opacity = String(opt.opacity);
  }
  function npcPause(api) {
    if (!api) return;
    if (api.mc && api.mc.__npcBob) api.mc.__npcBob.style.animation = 'none';
    npcPose(api, {});
  }
  function npcResume(api) {
    if (!api) return;
    if (api.mc && api.mc.__npcBob) api.mc.__npcBob.style.animation = '';
    npcPose(api, {});
    if (api.mc && api.mc.g) api.mc.g.style.opacity = '';
  }
  /** ============================================================
   * 三侠 / 木人：经典战斗里的**现代战斗素材填充**
   * ------------------------------------------------------------
   * 用户口径（2026-11）：保留已找到的 ssfight 熊猫动作文件，但经典战斗先用
   * **现代播放器同一套 `AnimationStr` 图集**把熊猫 / 螳螂 / 仙鹤补齐。
   * 松鼠本体仍走原来的 `7689` 矢量动画；这里只替换 NPC 那一侧。
   *
   * 实现：把现代 1170×690 动画画进一层透明 canvas，再把它与经典 320×196 舞台
   * **同区域叠放**（HTML canvas，见下方 WebKit foreignObject 说明）。
   * 动作名、命中帧、特效与 `battle.js` 对齐：
   *   · 待机 `_rest` / 普攻 `_common_attack` / 技能 `_skill_attack`
   *   · 受击 `_hitMe` / 闪避 `_runAround` / 反击 `_beatBack`
   *   · 归位 `_runBack` / 倒地 `_die` / 胜利 `_win`
   * 图集没加载到时才退回 7689 的静态稿（旧实现，保留兜底）。
   * ============================================================ */
  const NPC_SHEETS = { tl: ['tl'], xh: ['xh1', 'xh2'], xm: ['xm1', 'xm2'], wood: ['woodman1', 'woodman2'] };
  const NPC_EFFECT_SHEETS = { tl: ['tl_effect'], xh: ['xh_effect1', 'xh_effect2'], xm: ['xm_effect'], wood: ['woodman_effect'] };
  const NPC_ACTION = {
    idle: 'rest', common: 'common_attack', skill: 'skill_attack', hit: 'hitMe',
    dodge: 'runAround', back: 'runBack', die: 'die', win: 'win', counter: 'beatBack',
  };
  /** 现代播放器 `HIT_FRAME` 里三侠那几条：出手动画的命中帧（1 基）。 */
  const NPC_HIT_FRAME = {
    tl_common_attack: 6, tl_skill_attack: 10,
    xh_common_attack: 6, xh_skill_attack: 10,
    xm_common_attack: 6, xm_skill_attack: 8,
  };
  const NPC_FRAME_MS = 1000 / 20;      // 现代播放器 FPS = 20

  function npcAnimName(npc, action) {
    if (npc === 'wood') return action === 'hit' ? 'wood_hitMe' : 'wood_rest';
    return npc + '_' + (NPC_ACTION[action] || action);
  }
  function npcEffectName(npc, key) {
    if (!npc || npc === 'wood') return null;
    return npc + '_effect_' + key;
  }
  function npcAtlasReady(npc) {
    if (!npc || npc === 'wood' || !window.Engine || !Engine.hasAnim || !Engine.has) return false;
    const sheets = NPC_SHEETS[npc];
    if (!sheets || !sheets.length) return false;
    if (!sheets.some((id) => Engine.has(id))) return false;
    return Engine.hasAnim(npcAnimName(npc, 'idle')) && Engine.hasAnim(npcAnimName(npc, 'common'));
  }

  /** 把一层 HTML/SVG 覆盖物铺到经典舞台 SVG 的显示区域上（两者都在 `#ui` 的设计坐标里）。
   *
   *  **优先按设计坐标定位**：`offsetLeft/offsetTop` + `clientWidth/clientHeight` 都是
   *  `#ui` 缩放前的值，`SfRender.svgScreenMap()` 给出的 `content` 也是设计单位。
   *  这样完全不需要把屏幕矩形除回来，也不会被 iOS 15 的 `getScreenCTM` 209220 或
   *  「全面屏」下 `sx !== sy` 的非等比 `#ui` 缩放带偏。
   *
   *  以前这里用 `host.clientWidth / hostRect.width` 一个比例折回设计坐标：等比缩放时
   *  恰好正确，**全面屏时 x/y 比例不同**，三侠图集 canvas 的高度会被算成
   *  `stageHeight * sy / sx`（iPhone 横屏约 75%），并被顶到舞台顶部 —— 用户看到的
   *  「三侠定位与缩放大幅改变」。现在直接取舞台内容的设计高度，不再换算。
   *
   *  返回舞台内容在设计坐标里的尺寸；量不到（隐藏 / 还没布局）时返回 null。 */
  function layoutStageOverlay(el, root, host) {
    if (!el || !root || !host) return null;
    const svg = root.ownerSVGElement || root;
    const vb = svg && svg.viewBox && svg.viewBox.baseVal;
    if (!svg || !vb || !(vb.width > 0) || !(vb.height > 0) || !svg.getBoundingClientRect) return null;
    const hr = host.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    if (!(hr.width > 0) || !(hr.height > 0) || !(sr.width > 0) || !(sr.height > 0)) return null;
    /* 屏幕 → 设计单位：x、y 分别用宿主自己的布局尺寸折算。`host` 是普通 div，
     * clientWidth/Height 在 WKWebView 上可靠；不能再用一个 k 同时除两轴
     *（全面屏时 sx !== sy，三侠层会纵向缩成 75% 并顶到舞台顶部）。 */
    if (!(host.clientWidth > 0) || !(host.clientHeight > 0)) return null;
    const kx = host.clientWidth / hr.width;
    const ky = host.clientHeight / hr.height;
    const dw = sr.width * kx;                 // SVG 在设计坐标里的宽
    const dh = sr.height * ky;                // SVG 在设计坐标里的高
    const par = String(svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
    const ax = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5;
    const ay = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
    let offX = 0, offY = 0, contentW, contentH;
    if (/\bnone\b/.test(par)) {
      contentW = dw; contentH = dh;
    } else {
      const s = /\bslice\b/.test(par) ? Math.max(dw / vb.width, dh / vb.height)
        : Math.min(dw / vb.width, dh / vb.height);
      contentW = vb.width * s; contentH = vb.height * s;
      offX = (dw - contentW) * ax;
      offY = (dh - contentH) * ay;
    }
    const left = (sr.left - hr.left) * kx + offX;
    const top = (sr.top - hr.top) * ky + offY;
    const width = contentW, height = contentH;
    const sig = [left, top, width, height].map((n) => Math.round(n * 100) / 100).join('|');
    if (el.__sfStageSig !== sig) {
      el.__sfStageSig = sig;
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.width = width + 'px';
      el.style.height = height + 'px';
    }
    return { left: left, top: top, width: width, height: height };
  }

  /** 战斗最上层的一层空 SVG：目前只放「跳过」按钮。
   *  三侠的现代图集画布是 HTML canvas（见 `makeAtlasNpcFighter`），按 DOM 顺序会盖住
   *  原本后挂的 SVG「跳过」按钮。把跳过键移到这层 SVG 里，既保留原版按钮的矢量画稿、
   *  悬停/按下反馈和点击热区，又让它继续压在 NPC 上面。 */
  function makeBattleTopLayer(rec, root) {
    if (!rec || !rec.host || !root || !window.document || !document.createElementNS) return null;
    const NS = 'http://www.w3.org/2000/svg';
    const main = root.ownerSVGElement || root;
    const top = document.createElementNS(NS, 'svg');
    top.setAttribute('viewBox', (main && main.getAttribute && main.getAttribute('viewBox')) || '0 0 320 196');
    top.setAttribute('preserveAspectRatio', (main && main.getAttribute && main.getAttribute('preserveAspectRatio')) || 'xMidYMid meet');
    top.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;' +
      'z-index:3;overflow:visible;';
    rec.host.appendChild(top);
    const relayout = () => layoutStageOverlay(top, root, rec.host);
    relayout();
    if (window.addEventListener) window.addEventListener('resize', relayout);
    let ro = null;
    if (window.ResizeObserver) {
      try { ro = new ResizeObserver(relayout); ro.observe(main); ro.observe(rec.host); } catch (e) { ro = null; }
    }
    rec.topLayer = top;
    rec.topLayerRelayout = relayout;
    rec.topLayerRO = ro;
    return top;
  }

  /** 战斗底色层：把原版 `backGround` 从主 SVG 挪到 canvas **下面**。
   *
   *  三侠图集是普通 HTML canvas，天然压在主 SVG 之上；不拆层时，NPC 身上的伤害数字、
   *  状态图标、技能特效全在主 SVG 里，会被整块 canvas 挡住。现在层序是：
   *    底图 SVG（z-index 0） < NPC canvas（z-index 1） < 主 SVG（z-index 2，角色/特效/HUD）
   *     < 顶部覆盖 SVG（z-index 3，跳过键）
   *  主 SVG 里的 SVG 特效因此重新压在 NPC 上面；NPC 的静态身体只隐藏 `holder.__hero`，
   *  `statu` 等 SVG 状态图标仍留在主 SVG 里正常显示。 */
  function makeBattleBackLayer(rec, root) {
    if (!rec || !rec.host || !root || !window.document || !document.createElementNS) return null;
    if (rec.bgLayer) return rec.bgLayer;
    const view = rec.view;
    const bg = view && view.byName ? view.byName('backGround') : null;
    const node = bg && (bg.g || bg);
    const main = root.ownerSVGElement || root;
    if (!node || !main) return null;
    const NS = 'http://www.w3.org/2000/svg';
    const layer = document.createElementNS(NS, 'svg');
    layer.setAttribute('class', 'sf-battle-bg-layer');
    layer.setAttribute('viewBox', (main && main.getAttribute && main.getAttribute('viewBox')) || '0 0 320 196');
    layer.setAttribute('preserveAspectRatio', (main && main.getAttribute && main.getAttribute('preserveAspectRatio')) || 'xMidYMid meet');
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;' +
      'z-index:0;overflow:visible;';
    if (main.parentNode) main.parentNode.insertBefore(layer, main);
    else rec.host.appendChild(layer);
    /* 主 SVG 必须压回 canvas 上面；只把底图挪走，角色、状态图标、飘字和特效都留在主 SVG。 */
    main.style.position = 'relative';
    main.style.zIndex = '2';
    layer.appendChild(node);
    const relayout = () => layoutStageOverlay(layer, root, rec.host);
    relayout();
    if (window.addEventListener) window.addEventListener('resize', relayout);
    let ro = null;
    if (window.ResizeObserver) {
      try { ro = new ResizeObserver(relayout); ro.observe(main); ro.observe(rec.host); } catch (e) { ro = null; }
    }
    rec.bgLayer = layer;
    rec.bgLayerRelayout = relayout;
    rec.bgLayerRO = ro;
    return layer;
  }

  /** 现代图集版：透明 canvas 铺在**底图与主 SVG 之间**，按现代 1170×690 坐标画三侠。
   *  层序由 `makeBattleBackLayer()` 拆开：底图 < canvas < 主 SVG（状态/飘字/特效）< 顶部覆盖。
   *
   *  ⚠ **不要把 canvas 放进 `<foreignObject>`**。WebKit / iOS 有一条 17 年未修的
   *  合成层 bug（bugs.webkit.org 23113，原 83189「Canvas inside SVG(foreignObject)
   *  positioning error」）：canvas 一旦因为尺寸或祖先 transform 进入独立合成层，
   *  foreignObject 的缩放/位移就**不再作用到 canvas 内容**上 —— 画面里表现为
   *  「三侠位置和大小突然变了」（用户 2026-10 的 iOS 经典模式反馈）。
   *  现代模式的主战斗画布是普通 `<canvas>`，不走 foreignObject，所以没有这个问题；
   *  这里改成把 canvas 直接挂在经典战斗的 HTML 宿主上、与舞台 SVG 同尺寸叠放。
   *  普通 HTML canvas 的 CSS 缩放 iOS 支持得很好，也不会触发那条 foreignObject bug。
   *  坐标仍按现代 1170×690 画，绘制前把 canvas 的变换设成「舞台显示尺寸 / 1170×690」。
   */
  function makeAtlasNpcFighter(side, holder, info, npcType, mutant) {
    const battle = live;
    const view = live && live.view;
    const root = view && (view.g || view);
    const host = live && live.host;
    if (!root || !host || !window.document || !document.createElement) return null;
    /* 先把底图拆到 canvas 下方；主 SVG 留在 canvas 上方，特效/状态图标/飘字才不会被 NPC 挡住。 */
    makeBattleBackLayer(battle, root);
    const canvas = document.createElement('canvas');
    canvas.className = 'sf-npc-atlas-layer';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = 1170; canvas.height = 690;
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;display:block;' +
      'pointer-events:none;z-index:1;';
    host.appendChild(canvas);
    if (holder) holder.__npcLayer = canvas;
    const ctx = canvas.getContext('2d');
    /* 只收掉原版 7689 的**静态身体**：`holder` 里的 `statu`（状态图标）等 SVG 必须留着，
     * 否则它们会跟着整棵 holder 一起被隐藏，NPC 头顶的眩晕/减益图标就永远不出现。 */
    if (holder) {
      const staticBody = holder.__hero;
      if (staticBody && staticBody.g) staticBody.g.style.visibility = 'hidden';
      else if (holder.g) holder.g.style.visibility = 'hidden';
    }
    let isDead = false;
    let anim = null;
    let rafId = 0;
    let disposed = false;
    let layoutDirty = true, layoutReady = false, layoutRetryAt = 0, nextLayoutCheck = 0;
    let paintDirty = true, paintedFrame = null;
    let resizeObserver = null, layoutObserver = null;
    const effects = [];
    /* 变异三侠：换色图集已就绪时用它；没有就退回普通图集（原版 *_boss.swf 不在参考资料里）。 */
    const bodySheets = mutant && Engine.mutantSheets ? (Engine.mutantSheets(npcType) || NPC_SHEETS[npcType]) : NPC_SHEETS[npcType];
    const now = () => (window.performance && performance.now ? performance.now() : Date.now());

    function layoutCanvas(stamp) {
      const rec = battle;
      if (disposed || live !== rec || !rec || !rec.host || !canvas.parentNode) return false;
      /* 舞台没有逐 rAF 移动；尺寸/布局变化时再量。旧 WebView 无 ResizeObserver 时
       * 每 250ms 兜底一次，隐藏后初次布局失败也会重试，不能把零尺寸永久缓存。 */
      if (!layoutDirty && (resizeObserver || stamp < nextLayoutCheck)) return layoutReady;
      if (stamp < layoutRetryAt) return layoutReady;
      const box = layoutStageOverlay(canvas, root, rec.host);
      if (!box) {
        layoutReady = false;
        layoutRetryAt = stamp + 100;
        return false;
      }
      layoutDirty = false; layoutReady = true; layoutRetryAt = 0;
      nextLayoutCheck = stamp + 250;
      const bw = Math.max(1, Math.round(box.width)), bh = Math.max(1, Math.round(box.height));
      if (canvas.width !== bw) { canvas.width = bw; paintDirty = true; }
      if (canvas.height !== bh) { canvas.height = bh; paintDirty = true; }
      return true;
    }
    function invalidateLayout() {
      layoutDirty = true; layoutRetryAt = 0;
      schedule();
    }
    function schedule() {
      const rec = battle;
      if (disposed || live !== rec || !rec || rafId) return;
      const id = raf((stamp) => {
        const at = rec.rafs.indexOf(id);
        if (at >= 0) rec.rafs.splice(at, 1);
        if (rafId === id) rafId = 0;
        tick(stamp);
      });
      rafId = id;
      rec.rafs.push(id);
    }
    function stopRaf() { if (rafId) { caf(rafId); if (live) { const i = live.rafs.indexOf(rafId); if (i >= 0) live.rafs.splice(i, 1); } rafId = 0; } }
    function clear() {
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } catch (e) {}
    }
    function draw(stamp) {
      const t = stamp == null ? now() : stamp;
      if (!layoutCanvas(t)) return;
      const frame = anim && anim.frames && anim.frames[anim.idx];
      if (frame !== paintedFrame) paintDirty = true;
      /* 保留 rAF 节拍和命中回调，只省掉相同 20fps 素材帧的清屏/重画。
       * 特效有独立的帧和寿命；即使角色帧不变，特效切帧/结束也必须刷新。 */
      for (let i = effects.length - 1; i >= 0; i--) {
        const eff = effects[i];
        const idx = Math.floor((t - eff.start) * Math.max(1, battle.speed || 1) / NPC_FRAME_MS);
        if (idx >= eff.frames.length) { effects.splice(i, 1); paintDirty = true; }
        else if (idx !== eff.idx) { eff.idx = idx; paintDirty = true; }
      }
      if (!paintDirty) return;
      clear();
      /* 现代 1170×690 → 这块舞台画布。x/y 各自按实际显示尺寸缩放，与之前
       * foreignObject 里 canvas 的拉伸比例一致（经典舞台是 320×196）。 */
      ctx.setTransform(canvas.width / 1170, 0, 0, canvas.height / 690, 0, 0);
      if (frame) { try { Engine.drawFrame(ctx, frame, { sheets: bodySheets }); } catch (e) {} }
      for (let i = effects.length - 1; i >= 0; i--) {
        const eff = effects[i];
        try { Engine.drawFrame(ctx, eff.frames[eff.idx], { sheets: eff.sheets }); } catch (e) {}
      }
      paintedFrame = frame; paintDirty = false;
    }
    function finishAnim() {
      const a = anim;
      anim = null;
      if (a && a.finish) a.finish();
    }
    function tick(stamp) {
      if (disposed || live !== battle || !live || live.stopped) { finishAnim(); return; }
      const a = anim;
      if (!a) { draw(stamp); if (effects.length || !layoutReady) schedule(); return; }
      const at = (stamp - a.start) * Math.max(1, live.speed || 1);
      const raw = Math.floor(at / NPC_FRAME_MS);
      let idx = Math.min(a.frames.length - 1, Math.max(0, raw));
      if (a.loop) idx = ((raw % a.frames.length) + a.frames.length) % a.frames.length;
      if (idx !== a.idx) {
        a.idx = idx;
        if (a.onFrame) { try { a.onFrame(idx + 1); } catch (e) {} }
      }
      draw(stamp);
      if (!a.loop && raw >= a.frames.length) { finishAnim(); return; }
      schedule();
    }
    function play(name, opts) {
      const o = opts || {};
      if (disposed || live !== battle || !live || live.stopped) return Promise.resolve();
      const frames = window.Engine && Engine.anim ? Engine.anim(name) : null;
      if (!frames || !frames.length) return Promise.resolve();
      if (rafId) stopRaf();
      if (anim && anim.finish) anim.finish();
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (anim && anim.finish === finish) anim = null;
          resolve();
        };
        anim = { name: name, frames: frames, start: now(), idx: -1, loop: !!o.loop, onFrame: o.onFrame, finish: finish };
        draw();
        schedule();
      });
    }
    function effect(key) {
      const name = npcEffectName(npcType, key);
      const frames = name && window.Engine && Engine.anim ? Engine.anim(name) : null;
      if (!frames || !frames.length) return;
      effects.push({ frames: frames, start: now(), sheets: NPC_EFFECT_SHEETS[npcType] || [] });
    }
    if (window.addEventListener) window.addEventListener('resize', invalidateLayout);
    if (window.ResizeObserver) {
      try {
        resizeObserver = new ResizeObserver(invalidateLayout);
        resizeObserver.observe(root.ownerSVGElement || root);
        resizeObserver.observe(host);
      } catch (e) { if (resizeObserver) resizeObserver.disconnect(); resizeObserver = null; }
    }
    if (window.MutationObserver) {
      try {
        layoutObserver = new MutationObserver(invalidateLayout);
        layoutObserver.observe(root.ownerSVGElement || root, {
          attributes: true, attributeFilter: ['viewBox', 'preserveAspectRatio', 'width', 'height', 'style', 'class'],
        });
        for (const el of [host, host.parentNode]) if (el) layoutObserver.observe(el, {
          attributes: true, attributeFilter: ['style', 'class'],
        });
      } catch (e) { if (layoutObserver) layoutObserver.disconnect(); layoutObserver = null; }
    }
    function disposeLayout() {
      disposed = true;
      if (window.removeEventListener) window.removeEventListener('resize', invalidateLayout);
      if (resizeObserver) resizeObserver.disconnect();
      if (layoutObserver) layoutObserver.disconnect();
      if (battle.atlasCleanups) battle.atlasCleanups.delete(disposeLayout);
    }
    if (!battle.atlasCleanups) battle.atlasCleanups = new Set();
    battle.atlasCleanups.add(disposeLayout);
    const api = {
      side: side, holder: holder, mc: holder && holder.__hero, statu: null, info: info, npc: npcType,
      blood: { totalBlood: 1, leftBlood: 1, finalBlood: 1 },
      statuCode: 0, weaponNow: null,
      skills: (info && info.skills) || {},
      skillLevel(id) { return Number(api.skills[Number(id)]) || 0; },
      defenseSkillLevel() { return 0; },
      dress() {}, setStatu() {}, specialEffect() {},
      attacks: () => null, defenses: () => null, playSub: () => null,
      async attack(r, hooks) {
        const h = hooks || {};
        const skill = !!(r && r.action === 'skill');
        const name = npcAnimName(npcType, skill ? 'skill' : 'common');
        api.lastAttack = { frame: 0, action: String(r && r.action || ''), id: Number(r && r.id) || 0 };
        effect(skill ? 'skillAttack' : 'commonAttack');
        let hit = false;
        const frames = Engine.anim(name) || [];
        const at = NPC_HIT_FRAME[name] || Math.max(1, Math.floor(frames.length * 0.55));
        await play(name, { onFrame: (n) => { if (!hit && n >= at) { hit = true; if (h.hit) h.hit(); } } });
        if (!hit && h.hit && live && !live.skipped) h.hit();
        api.lastAttack.frame = frames.length;
      },
      async beAttack(r, hooks) {
        const h = hooks || {};
        const dodge = !!(r && r.dodge);
        const name = npcAnimName(npcType, dodge ? 'dodge' : 'hit');
        effect(dodge ? 'runAround' : 'hitMe');
        let backed = false;
        const frames = Engine.anim(name) || [];
        const backAt = Math.max(1, frames.length - 1);
        await play(name, { onFrame: (n) => { if (!backed && n >= backAt) { backed = true; if (h.back) h.back(); } } });
        if (!backed && h.back && live && !live.skipped) h.back();
      },
      async attackBack(hooks) {
        effect('beatBack');
        const h = hooks || {};
        let hit = false;
        await play(npcAnimName(npcType, 'counter'), { onFrame: (n) => { if (!hit && n >= 4) { hit = true; if (h.hit) h.hit(); } } });
        if (!hit && h.hit && live && !live.skipped) h.hit();
      },
      async comeBack() {
        const name = npcAnimName(npcType, 'back');
        if (!Engine.hasAnim(name) || isDead) { api.idle(); return; }
        effect('runBack');
        await play(name);
      },
      async dead() { isDead = true; effect('die'); await play(npcAnimName(npcType, 'die')); },
      async congratulate() { effect('win'); await play(npcAnimName(npcType, 'win')); },
      isDead: () => isDead,
      idle() {
        if (isDead) return;
        if (anim && anim.loop && anim.name === npcAnimName(npcType, 'idle')) return;
        play(npcAnimName(npcType, 'idle'), { loop: true });
      },
      useSkillDefense() { return false; },
      hide() {
        disposeLayout();
        stopRaf();
        if (anim && anim.finish) anim.finish();
        anim = null;
        clear();
        if (holder) holder.__npcLayer = null;
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      },
      debug: () => ({
        hasMc: true, hasAttacks: false, npc: npcType,
        anim: anim ? anim.name : null, frame: anim ? anim.idx + 1 : null,
        frames: anim ? anim.frames.length : 0,
        atk: null, def: null, lastAttack: api.lastAttack || null,
      }),
    };
    if (holder) holder.__fighter = api;
    if (api.mc) api.mc.__fighter = api;
    api.idle();
    return api;
  }

  /** 旧版静态矢量稿：图集没加载出来时兜底，保证战斗能继续。 */
  function makeStaticNpcFighter(side, holder, info, npcType) {
    const mc = holder && holder.__hero;
    let isDead = false;
    const api = {
      side: side, holder: holder, mc: mc, statu: null, info: info, npc: npcType,
      blood: { totalBlood: 1, leftBlood: 1, finalBlood: 1 },
      statuCode: 0, weaponNow: null,
      skills: (info && info.skills) || {},
      skillLevel(id) { return Number(api.skills[Number(id)]) || 0; },
      defenseSkillLevel() { return 0; },
      dress() {}, setStatu() {}, specialEffect() {},
      attacks: () => null, defenses: () => null, playSub: () => null,
      async attack(r, hooks) {
        const h = hooks || {};
        api.lastAttack = { frame: 0, action: String(r && r.action || ''), id: Number(r && r.id) || 0 };
        npcPause(api);
        const skill = !!(r && r.action === 'skill');
        npcPose(api, { dx: 12, dy: -4, scale: skill ? 1.05 : 1.02, rotate: skill ? -3 : -1.5 });
        await wait(skill ? 170 : 120);
        if (h.hit) h.hit();
        if (h.heal) h.heal();
        await wait(skill ? 240 : 130);
        npcResume(api);
      },
      async beAttack(r, hooks) {
        const h = hooks || {};
        npcPause(api);
        if (r && r.dodge) {
          npcPose(api, { dx: -24, dy: 0, rotate: -5 });
          await wait(110);
          npcPose(api, { dx: -34, dy: 0, rotate: -7 });
          await wait(120);
        } else {
          for (let i = 0; i < 4; i++) {
            npcPose(api, { dx: i % 2 ? 5 : -5, dy: i % 2 ? 1 : -1, rotate: i % 2 ? 2 : -2 });
            await wait(45);
          }
          if (h.back) h.back();
          await wait(70);
        }
        npcResume(api);
      },
      async attackBack(hooks) {
        npcPause(api);
        npcPose(api, { dx: 10, dy: -3, scale: 1.02, rotate: -2 });
        await wait(150);
        if (hooks && hooks.hit) hooks.hit();
        await wait(130);
        npcResume(api);
      },
      async comeBack() { npcResume(api); },
      async dead() {
        isDead = true;
        npcPause(api);
        npcPose(api, { dx: -10, dy: 14, scale: 0.96, rotate: -14, opacity: 0.55 });
        await wait(320);
      },
      async congratulate() {
        npcPause(api);
        npcPose(api, { dy: -6, scale: 1.04, rotate: 2 });
        await wait(160);
        npcPose(api, { dy: 0, scale: 1, rotate: 0 });
        await wait(120);
        npcResume(api);
      },
      isDead: () => isDead,
      idle() { npcResume(api); },
      useSkillDefense() { return false; },
      hide() {},
      debug: () => ({
        hasMc: !!mc, hasAttacks: false, npc: npcType,
        frame: mc ? mc.frame : null, frames: mc && mc.frameCount ? mc.frameCount() : 0,
        atk: null, def: null, lastAttack: api.lastAttack || null,
      }),
    };
    if (holder) holder.__fighter = api;
    if (mc) mc.__fighter = api;
    api.idle();
    return api;
  }

  function makeNpcFighter(side, holder, info, npcType, mutant) {
    if (npcAtlasReady(npcType)) {
      try {
        const atlas = makeAtlasNpcFighter(side, holder, info, npcType, mutant);
        if (atlas) return atlas;
      } catch (e) {
        if (window.__errs) window.__errs.push('[SfFight] npc atlas: ' + (e && e.message));
        if (holder && holder.__npcLayer) {
          try { holder.__npcLayer.parentNode && holder.__npcLayer.parentNode.removeChild(holder.__npcLayer); } catch (e2) {}
          holder.__npcLayer = null;
        }
        if (holder && holder.g) holder.g.style.visibility = '';
      }
    }
    return makeStaticNpcFighter(side, holder, info, npcType);
  }
  function makeFighter(side, holder, info) {
    if (holder && holder.__npc) return makeNpcFighter(side, holder, info, holder.__npc, !!holder.__mutant);
    const slot = holder && holder.byName('playerMc');
    /* 主角本体是 `buildFighter` 当场挂上去并回传的（`attachChild` 不进 `byName` 表，
     * 而 7639 第 2 帧已经把第 1 帧那批挂点摘掉了 —— 见 `buildFighter` 的注释）。 */
    const mc = (holder && holder.__hero) || (slot && slot.byName('playerMc')) || null;
    const statu = holder && holder.byName('statu');
    /* ⚠ "倒过了没有"必须放在**闭包变量**里：`api` 的字面量里曾经同时有 `dead: false`
     * 和 `async dead(distance){}` —— 后者覆盖前者，于是 `api.dead` 是那个方法；
     * 而 `dead()` 里再写 `api.dead = true` 会把方法本身换成 `true`（第二次调用直接 TypeError）。
     * 对外仍然暴露 `isDead()`。 */
    let isDead = false;
    const campaign = !!(holder && holder.__campaign);
    const api = {
      side: side, holder: holder, mc: mc, statu: statu, info: info,
      campaign: campaign,
      blood: { totalBlood: 1, leftBlood: 1, finalBlood: 1 },
      statuCode: 0,
      /** 这一拍手里握着的那把武器（`{id, level}`）：出手动画里的武器容器靠它拨帧
       *  （见 `onClip` 与 `MELEE_WEAPON_ART`）。没出手 / 空手时为 null。 */
      weaponNow: null,
      /** 这位参战者自己的技能等级（id → 等级）；真形态那一档要读它。 */
      skills: (info && info.skills) || {},
      skillLevel(id) { return Number(api.skills[Number(id)]) || 0; },
      /** 这一拍防守技（装死 6 / 龟甲术 7 / 绝对防御 16）该用哪个等级挑档。 */
      defenseSkillLevel(r) {
        if (r && r.fakeDie) return api.skillLevel(6);
        if (r && r.guiJia) return api.skillLevel(7);
        if (r && r.jueDui) return api.skillLevel(16);
        return 0;
      },
      /** 每次换帧后重贴一遍装备的兜底入口（正常路径由 `onClip` 在建树那一刻接管）。 */
      dress() { if (mc) dressTree(mc, side); },
      setStatu(code) { api.statuCode = code; },
      /** `Player.specialEffect()`：把这一拍中的状态图标从**自己头顶**升起来。
       *  原版逐条（`Player.as:205` + `sprite7658.as` / `sprite7657.as` / `sprite7640.as`）：
       *    `statuMc.gotoAndPlay(2); statuMc.propty.gotoAndStop(_loc2);`
       *  · `statu`(7658) 是 20 帧的"图标升起"动画，**第 1 帧与第 20 帧都是 `stop()`**
       *    （第 20 帧还 remove 掉 `propty`）—— 所以它**播一次就停**。
       *    ⚠⚠ 复刻以前是裸 `play(statu, 2)`：渲染器的节拍器会一直循环它，图标升上去又从头来，
       *    表现就是"战斗后期双方头顶**一直闪烁**同一个标识"（用户 2026-11 口径）。
       *  · `propty`(7657) 第 1 帧 `stop()`：选中的那颗图标定住不自己换帧。
       *  · 图标容器（7640…7656）第 1 帧 `stop(); _root.showReverse(this, 1)` —— 按**飘在谁头上**
       *    选左右朝向（见 `showReverse`：左边那位第 1 帧、右边第 2 帧；两帧是镜像）。
       *    这一步由 `onClip` 在图标实例出生时接管（见 `STATU_ICON_SYMS`）。 */
      specialEffect() {
        const icon = STATU_ICON[api.statuCode];
        api.statuCode = 0;
        if (!icon || !statu) return;
        stopAt(statu, 1);                       // 从第 1 帧起（图标还没升起）
        const prop = statu.byName('propty');
        if (prop) stopAt(prop, icon);           // 换成这一拍该飘的那颗
        playClip(statu, { stop: statu.frameCount ? statu.frameCount() : 20 });
      },
      attacks: () => mc && mc.byName('attacks'),
      defenses: () => mc && mc.byName('defenses'),
      playSub(name, inner, frame) {
        const sel = mc && mc.byName(name);
        if (!sel) return null;
        stopAt(sel, frame);
        const child = sel.byName(inner);
        return child || null;
      },
      /** `attack()`：拨动作选择帧 → 播里面那条 `attack`。
       *  **命中帧照原版帧脚本**（`ATTACK_ACTS`）：`hooks.hit` = "这下打到了"，
       *  `hooks.heal` = 那一档的加血时刻（13 师父驾到 / 17 来点松果第 37 帧）。
       *  `hooks.guard`（原版"提前举盾"的那一帧）**不再接线** —— 见 `ATTACK_ACTS` 的注释。 */
      async attack(r, hooks) {
        const sel = mc && mc.byName('attacks');
        if (!sel) return;
        visible(sel, true);
        /* 原版 `Animals.as:13-35` 的出手选择只有 1/2/3 三档，逐条抄：
         *   attackType 1（普攻）→ `attacks` 第 1 帧
         *   attackType 2（武器）→ **也是第 1 帧**（普攻/武器共用一条动作，以前这里错拨到第 2 帧）
         *   attackType 3（技能）→ 第 2 帧
         *   attackType 4（幻兽）→ 第 3 帧
         * 不是松鼠那套几十帧的技能表；命中帧也没有逐技能帧脚本，
         * 按动作条的一半触发 hooks.hit 即可（Sim 的伤害早已单独结算）。 */
        if (campaign) {
          if (api.stopBreath) api.stopBreath();
          const h = hooks || {};
          const frame = (r && r.action === 'skill') ? 2
            : (r && r.action === 'pet') ? 3 : 1;
          stopAt(sel, frame);
          api.weaponNow = null;
          api.lastAttack = { frame: frame, action: String(r && r.action), id: Number(r && r.id) || 0,
            petId: Number(r && r.petId) || 0, petSkillId: Number(r && r.petSkillId) || 0 };
          const inner = sel.byName('attack') || onlyChildClip(sel);
          if (!inner) return;
          const total = inner.frameCount ? inner.frameCount() : 10;
          const hitAt = Math.max(1, Math.floor(total * 0.45));
          await playClip(inner, { deep: true, onFrame: (n) => { if (n >= hitAt && h.hit) h.hit(); } });
          return;
        }
        const plan = attackPlan(r);
        /* 出手前先记下"这一拍用的是哪把武器"：武器容器是在**拨帧那一刻**建出来的
         * （`stopAt` → `showFrame()` → 建子件 → `onClip`），所以必须写在它前面。 */
        api.weaponNow = (r && r.action === 'weapon')
          ? { id: Number(r.id) || 0, level: Number(r.level) || 1 } : null;
        stopAt(sel, plan.frame);
        /* 记下这一次真正拨到的是哪一帧（回归据此钉住"技能走的是 4~21 那一档，
         * 不是幻兽的 29+id"）。 */
        api.lastAttack = { frame: plan.frame, action: String(r.action), id: Number(r.id) || 0,
          petId: Number(r.petId) || 0, petSkillId: Number(r.petSkillId) || 0 };
        const acts = ATTACK_ACTS[plan.frame] || {};
        const h = hooks || {};
        /* `attacks` 选择器换帧后，子件有时不是具名 `attack`（导出里少数帧只有一颗
         * 未命名的动作 child）。以前这里拿到 null 就直接静默返回 —— 表现正是“玩家原地
         * 站着、没有跑过去攻击”。退回当前帧唯一子件，保证普攻/武器至少播一条动作。 */
        const inner = sel.byName('attack') || onlyChildClip(sel);
        if (!inner) return;
        await playClip(inner, {
          deep: true, onFrame: (n) => {
            if (acts.guard && n >= acts.guard && h.guard) h.guard();
            if (acts.heal && n >= acts.heal && h.heal) h.heal();
            if (acts.hit && n >= acts.hit && h.hit) h.hit();
          },
        });
      },
      /** 这一侧的动作到底有没有真的跑起来（调试 / 回归用）。
       *  `atk` / `def` = 此刻**出手动画**（`attacks.attack`）与**受击动画**（`defenses.defense` /
       *  `dodges.dodge` / `defenseSkills.deSkill`）里那一条播到第几帧（1 基）——
       *  "命中帧 → 受击起手差了几帧"这类时序问题只靠它能量出来。 */
      debug: () => {
        const innerOf = (selName, kid) => {
          const sel = mc && mc.byName(selName);
          const inner = sel && sel.byName ? sel.byName(kid) : null;
          return inner ? { frame: inner.frame + 1, frames: inner.frameCount ? inner.frameCount() : 0 } : null;
        };
        let box = null, atkBox = null;
        try {
          const b = mc && mc.g ? mc.g.getBBox() : null;
          if (b) box = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
          const a = mc && mc.byName('attacks');
          const ab = a && a.g ? a.g.getBBox() : null;
          if (ab) atkBox = { x: Math.round(ab.x), y: Math.round(ab.y), w: Math.round(ab.width), h: Math.round(ab.height) };
        } catch (e) {}
        return { hasMc: !!mc, hasAttacks: !!(mc && mc.byName('attacks')),
          frame: mc ? mc.frame : null, frames: mc && mc.frameCount ? mc.frameCount() : 0,
          atk: innerOf('attacks', 'attack'),
          def: innerOf('defenses', 'defense') || innerOf('dodges', 'dodge') || innerOf('defenseSkills', 'deSkill'),
          box, atkBox, lastAttack: api.lastAttack || null };
      },
      /** `useSkillDefense()`：防御技起手（`Squirrel.useSkillDefense`）。
       *  原版是**出手动画**在第 3~25 帧回调的，所以挨打之前盾就举起来了。
       *  返回 false = 这一拍不是防御技（`defenseType != 2`），什么都没做。
       *  ⚠ 征战动物 boss 走 `Animals.useSkillDefense()` —— **空函数**（`Animals.as:56`），
       *  而且动物模型第 4 帧是空帧（没有 `defenseSkills` 层）。这里必须先返回 false，
       *  不能先 `stopAt(mc, 4)`：那一下会把整只动物画没（只剩背景），下一拍 `idle()` 才回来。 */
      useSkillDefense(r) {
        if (campaign) return false;
        const d = defensePlan(r, !!(live && live.plans[side]), api.defenseSkillLevel(r), side);
        if (d.kind !== 'skill') return false;
        stopAt(mc, 4);
        const sel = mc && mc.byName('defenseSkills');
        if (!sel) return false;
        stopAt(sel, d.frame || 1);
        const inner = sel.byName('deSkill');
        if (inner) play(inner, 2);
        return true;
      },
      /** `beAttack()`：受击 / 闪避 / 技能防御。
       *  ⚠ 顺序必须照原版：**先把身体拨到那一档、再在里面找子动作**。
       *  以前闪避与技能防御写反了（先 `byName` 后拨帧），而 `byName()` 只反映**当前帧** ——
       *  那时身体还停在 `attacks` 那一档上，`byName('dodges')` / `byName('defenseSkills')`
       *  恒为 null，于是这两种反应**一次都没播出来**，只把姿势切成定格的第 1 帧。
       *  `hooks.guarded` = 防御技已经由 `useSkillDefense()` 起手过（不要再从头播一遍）。 */
      async beAttack(r, hooks) {
        if (api.stopBreath) api.stopBreath();
        const h = hooks || {};
        const d = defensePlan(r, !!(live && live.plans[side]), api.defenseSkillLevel(r), side);
        const frame = d.frame || 1;
        /* 真·色诱命中：原版 `dropEquipPlayer` 会把这一侧的装备从身体上摘掉
         *（`chooseEquipLoader` 在 `checkPlayerWear` 报“脱光”时不再贴装备）。
         * 这里在命中帧真正卸下视觉；`syncStrip` 负责 4 回合到期后穿回。 */
        if (r && r.stripApplied && Number(r.specialEffect) === 1) setGearStripped(side, true);
        /* 幻兽的非伤害技能：原版 `getBeAttackFrame(4, id) == -1` 时直接 return，
         * 受击方连身体帧都不换。 */
        if (d.kind === 'none') return;
        if (d.kind === 'dodge') {
          stopAt(mc, 3);
          const sel = mc && mc.byName('dodges');
          if (sel) {
            stopAt(sel, 1);
            await playClip(sel.byName('dodge'), { deep: true, onFrame: backHook(DODGE_ACTS, h) });
          }
          return;
        }
        if (d.kind === 'skill') {
          /* 征战动物没有 `defenseSkills` 层（见 `useSkillDefense` 的注释）：照松鼠那套拨到
           * 第 4 帧 = 空帧，敌人整只消失。改播普通受击（`defenses` 第 1 帧）——
           * 绝对防御 / 龟甲术 / 装死 挡下的伤害本来就已经是 0，观感上是"硬吃了一下"。 */
          if (campaign) {
            stopAt(mc, 2);
            const hitSel = mc && mc.byName('defenses');
            if (hitSel) {
              stopAt(hitSel, 1);
              const inner = hitSel.byName('defense') || onlyChildClip(hitSel);
              if (inner) await playClip(inner, { deep: true, onFrame: backHook(DEFENSE_ACTS[1], h) });
            }
            return;
          }
          if (h.guarded) {
            /* 已经起手了：动画**不重播**，只把"反击 / 归位"那一帧接上，并等它演完
             * （原版 `defenseEnd` 也是等到那一条 `attackBack()` 才放行的）。 */
            const cur = mc && mc.byName('defenseSkills');
            const inner = cur && cur.byName('deSkill');
            if (inner) await playClip(inner, { resume: true, onFrame: backHook(DEFENSE_SKILL_ACTS[frame], h) });
            return;
          }
          stopAt(mc, 4);
          const sel = mc && mc.byName('defenseSkills');
          if (sel) {
            stopAt(sel, frame);
            await playClip(sel.byName('deSkill'), { deep: true, onFrame: backHook(DEFENSE_SKILL_ACTS[frame], h) });
          }
          return;
        }
        stopAt(mc, 2);
        const sel = mc && mc.byName('defenses');
        if (sel) {
          /* 动物模型的 `defenses` **只有 2 帧**（f1 正常受击 / f2 倒地），而松鼠那张表里
           * 幻兽受击是 11~40、技能受击是 2~9 —— 照抄过去会被钳到第 2 帧 = **倒地姿势**
           *（普攻/技能/幻兽打中动物 boss 时它突然"躺下"）。`Animals.beAttack` 对
           * defenseType 0 恒 `defenses.gotoAndStop(1)`，这里按同一口径。 */
          const hitFrame = campaign ? 1 : frame;
          stopAt(sel, hitFrame);
          /* 幻兽受击帧里有些子件没有 `defense` 这个实例名（例如第 19 帧的 6424），
           * 原版仍然会把它显示出来并自动播；这里取当前帧的第一颗子 clip 兜底。 */
          const inner = sel.byName('defense') || onlyChildClip(sel);
          if (inner) await playClip(inner, { deep: true, onFrame: backHook(DEFENSE_ACTS[hitFrame], h) });
          else await wait(320);
        }
      },
      /** `attackBack()`：反击。原版 `6516` 第 5 帧 `_root.beBttackBack()`（结算反伤 + 让出手方
       *  归位）、第 15 帧 `_root.congratulate()`。 */
      async attackBack(hooks) {
        const h = hooks || {};
        const back = () => { if (h.hit) h.hit(); };
        stopAt(mc, 5);
        const sel = mc && mc.byName('attackbacks');
        if (!sel) { back(); return; }
        stopAt(sel, 1);
        const inner = sel.byName('attackback');
        if (!inner) { back(); return; }
        await playClip(inner, { deep: true, onFrame: (n) => { if (n >= ATTACKBACK_ACTS.hit) back(); } });
      },
      /** `comeBack(type)`：被反击击退之后归位（`type` 决定播哪一档，见 `COMEBACK_ACTS`）。
       *  ⚠ 原版 `Animals.comeBack`（`Animals.as:101-122`）第一句就是
       *  `getWeaponSkillType()`，而 `Player.getWeaponSkillType`（:184-202）对
       *  **暗御狡兔（174/179/181）与暗御妖狐（180）恒返回 0** → 直接 return，
       *  **根本不换身体帧**。它们的模型第 6 帧本来就是空帧（没有 `comeBacks` 层）——
       *  照松鼠那套 `mc.gotoAndStop(6)` 就会把敌人当场画没，下一拍 `idle()` 才回来
       *  （实拍：狡兔每次普攻后消失约 0.8s）。狼王 / 猿将 第 6 帧有 `comeBacks`，照旧演。 */
      async comeBack(type) {
        const f = Math.max(1, Math.min(3, (Number(type) || 0) + 1));
        if (!COMEBACK_ACTS[f]) return;
        if (campaign && !campaignHasLayer(mc, 'comeBacks')) return;
        stopAt(mc, 6);
        const sel = mc && mc.byName('comeBacks');
        if (sel) {
          stopAt(sel, f);
          await playClip(sel.byName('comeBack'), { deep: true });
        }
      },
      /** `dead(distance)`：倒地。原版 `6366` 播到第 19 帧 `stop(); _root.die()` ——
       *  `die()` 才是"死"，它随即让胜利方起手（见 `perform` 的收尾）。 */
      async dead(distance) {
        isDead = true;
        if (api.stopBreath) api.stopBreath();
        stopAt(mc, 2);
        const sel = mc && mc.byName('defenses');
        if (!sel) return;
        /* 动物 boss 的受击/倒地帧按 `Animals.as`：受击 `defenses` 第 1 帧，
         * 倒地第 2/3 帧（distance==1 时第 3 帧），没有松鼠那套 4/5 帧。 */
        if (campaign) {
          stopAt(sel, distance === 1 ? 3 : 2);
          const inner = sel.byName('defense') || onlyChildClip(sel);
          if (inner) await playClip(inner, { deep: true });
          return;
        }
        stopAt(sel, distance === 1 ? 5 : 4);
        await playClip(sel.byName('defense'), { deep: true });
      },
      /** `congratulate()`：胜利姿势（`6530` 第 32 帧 `congratulation = 2` → 切战果页）。 */
      async congratulate() {
        stopAt(mc, 7);
        const sel = mc && mc.byName('winPoses');
        if (sel) { stopAt(sel, 1); await playClip(sel.byName('winPose'), { deep: true }); }
      },
      isDead: () => isDead,
      /** 归位到待机姿势：`mc.gotoAndStop(1)` + **让待机呼吸动画转起来**（见 `startIdlePose`）。
       *  征战动物走自己那颗原版待机片断（见 `startCampaignIdle`）：321GO 与每拍之间都在呼吸。 */
      idle() {
        stopAt(mc, 1);
        /* 色诱之术 5843 的末段带着「道场」场景，它挂在 `attacks` 选择器里；
         * 只把身体拨回第 1 帧并不会把 `attacks` 的当前子件清掉，于是技能播完后
         * 场景可能残留在下一拍下面（多次色诱后尤其明显）。
         *
         * ⚠⚠ 这里**不能**把 `attacks` 整层 `visibility:hidden` —— 战斗身体第 1 帧
         * （`6532` → `attacks` `6339` → `5630`）里画的就是待机松鼠本人：
         * 隐藏出手层 = 把角色整个画没（用户 2026-10 报的"我方与敌方都会时不时消失身影"）。
         * 正确做法是**把出手层复位到干净的第 1 帧**：`6339` 第 1 帧 = 普攻 `5630`，
         * `5630` 第 1 帧 = 待机姿势 `5616`，复位后 `startIdlePose` 再让呼吸转起来。 */
        const atk = mc && mc.byName('attacks');
        if (atk) {
          stopAt(atk, 1);
          const inner = atk.byName('attack');
          if (inner) stopAt(inner, 1);
        }
        startIdlePose(mc);
        /* 动物模型里没有 5616：第 1 帧那颗 `attack` 的 depth 1 子片断才是它的呼吸。 */
        if (campaign) startCampaignIdle(api);
      },
    };
    /* 实例 → 格斗者：`onClip` 靠这条链认"这一拍是谁在出手"（手里的武器）。
     * 挂在**持有者与主角本体**上：两处都会成为新建子件的祖先。 */
    if (holder) holder.__fighter = api;
    if (mc) mc.__fighter = api;
    return api;
  }
  /** 兜底穿搭：把子树里还没贴过的挂点/持有者补一遍（正常路径由 `onClip` 在建树那一刻接管）。 */
  function dressTree(clip, side) {
    const plan = live && live.plans[side];
    if (!plan || !clip || !clip.nodes) return;
    for (const rec of clip.nodes.values()) {
      if (!rec.clip) continue;
      const hf = plan.holders.get(String(rec.clip.tag.id));
      if (hf != null && rec.clip.__pinFrame == null) { try { rec.clip.pinFrame(hf); } catch (e) {} }
      const p = plan.bySlot.get(String(rec.clip.tag.id));
      if (p && !rec.clip.__dressed) {
        rec.clip.__dressed = true;
        try {
          rec.clip.setSymbol(p.symbol, p.frame, 1, 'topleft');
          rec.clip.__gearSlot = true;
          if (live && live.strip && live.strip[side]) setGearClipHidden(rec.clip, true);
        } catch (e) {}
      }
      dressTree(rec.clip, side);
    }
  }
  /** 真·色诱：把一格装备视觉藏起来 / 放回来（只动 `plan.bySlot` 贴出来的装备容器）。 */
  function setGearClipHidden(clip, on) {
    const node = clip && (clip.g || clip);
    if (node && node.style) node.style.display = on ? 'none' : '';
  }
  function walkClips(clip, fn) {
    if (!clip) return;
    fn(clip);
    if (!clip.nodes) return;
    for (const rec of clip.nodes.values()) if (rec.clip) walkClips(rec.clip, fn);
  }
  /** 把某一侧的全部装备视觉同步成“穿着 / 被脱光”。 */
  function setGearStripped(side, on) {
    if (!live || !live.strip) return;
    live.strip[side] = !!on;
    const f = live.fighters[side];
    if (!f || !f.mc) return;
    walkClips(f.mc, (clip) => { if (clip.__gearSlot) setGearClipHidden(clip, on); });
  }
  /** 每一拍开头按 `stripLeft` 同步一次；本拍刚命中脱装备时留给 `beAttack` 在命中帧卸。 */
  function syncStrip(rec, r) {
    if (!r || !Array.isArray(r.stripLeft)) return;
    for (let i = 0; i < 2; i++) {
      const on = Number(r.stripLeft[i]) > 0;
      if (!!rec.strip[i] !== on) setGearStripped(i, on);
    }
  }

  /** 待机姿势元件：`5616`（`静止姿势`，17 帧）。
   *  **原版每个动作的第 1 帧与末帧放的都是它**，而 `sprite5616.as` 里**一条脚本都没有**
   *  —— 也就是 Flash 里它一出生就一直循环，那正是"松鼠站着时在呼吸"（帧间包围盒会走 ±8 单位，
   *  逐帧渲染核对过：第 1/4/8/12/16/17 帧的姿势与眼神都在动）。
   *  复刻的静态页策略把它冻在第 1 帧 → 倒计时 / 两拍之间是**僵住**的（用户 2026-11 口径：
   *  "321 go 倒计时的时候松鼠理应有呼吸动作而不是僵住的，修复该问题"）。
   *  这里显式让它转起来（`gotoAndPlay` = 节拍器自己回卷 = 无限循环）；
   *  换帧重建时这个实例会被换掉，不用手动收，`idle()` 每拍开头再叫一次。 */
  const IDLE_POSE_SYM = '5616';
  /* ---------- 征战动物 boss 的"层"与待机呼吸 ----------
   * 动物模型（6833 那一帧里挂的 `playerMc`）是 7 帧的角色本体，层名与松鼠那套不完全一样：
   *   f1 `attacks` / f2 `defenses` / f3 `dodges` / f4 **空帧** /
   *   f5 `attackbacks` / f6 `comeBacks`（**只有狼王 6635、猿将 6709 有**）/ f7 `winPoses`
   * —— 与 `Animals.as` 的 `mc.gotoAndStop(2|3|5|6|7)` 逐条对得上（狡兔 6598 / 妖狐 6684
   * 的第 6 帧是空的，对应 `getWeaponSkillType()==0`，见 `comeBack` 的注释）。 */
  /** 这只模型**有没有**某一层（例：`comeBacks`）。
   *  ⚠ 不能用 `mc.byName(name)` 判断：`byName` 只反映**当前帧**，而"这一层存不存在"要在
   *  别的帧上问（`comeBack` 就是在第 1 帧问第 6 帧的事）。 */
  function campaignHasLayer(mc, name) {
    if (!mc || !mc.frames) return false;
    for (const fr of mc.frames) {
      for (const p of fr.values()) if (p && p.na === name) return true;
    }
    return false;
  }
  /** 待机呼吸片断（原版无脚本 → 一直循环）：`6533` 狡兔 / `6603` 狼王 / `6636` 妖狐 / `6685` 猿将。
   *  它们嵌在**每只动物出手动画的第 1 帧**里（6540/6604/6639/6686 的第 1 帧唯一那颗 depth 1
   *  子 clip，`sprite6533.as` 等四颗脚本都不存在，逐颗核过）。`idle()` 复位到第 1 帧之后，
   *  从 `attacks.attack` 的 depth 1 取到的就是它。 */
  function campaignIdleClip(f) {
    const mc = f && f.mc;
    const sel = mc && mc.byName ? mc.byName('attacks') : null;
    const atk = sel && sel.byName ? sel.byName('attack') : null;
    const rec = atk && atk.nodes ? atk.nodes.get(1) : null;
    const clip = rec && rec.clip;
    return (clip && clip.frames && clip.frames.length > 1) ? clip : null;
  }
  /** 让动物待机呼吸转起来（`playClip` 的 `deep` 那条路：连子树一起放行）。
   *  出手 / 受击 / 倒地会换掉 `attacks` 那一层，呼吸片断随之销毁，不用手动收。 */
  function startCampaignIdle(f) {
    const clip = campaignIdleClip(f);
    if (!clip) return false;
    startNestedAnim(clip, true, false, true);
    return true;
  }
  /** 兜底用的"假呼吸"：模型缺待机片断时（素材包不全）才用。
   *  ⚠ 幅度只有舞台宽的 1/300，肉眼几乎看不出来 —— 321GO 期间"敌人是纯静态"就是因为它
   *  以前被当成主表现（用户 2026-10 口径）。正常情况走 `startCampaignIdle` 的原版片断。 */
  function startCampaignBreath(rec, f) {
    if (!rec || !f || !f.campaign || !f.mc || !f.mc.setExtraTransform) return null;
    if (campaignIdleClip(f)) return null;
    let tick = 0, stopped = false;
    const apply = () => {
      if (stopped || rec.stopped || !f.mc || !f.mc.g || f.mc.g.isConnected === false) return;
      const dy = Math.sin(tick) * 1.1;
      tick += 0.45;
      try { f.mc.setExtraTransform('translate(0,' + dy.toFixed(2) + ')'); } catch (e) {}
    };
    apply();
    const timer = setInterval(apply, 90);
    rec.timers.push(timer);
    f.stopBreath = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try { f.mc.setExtraTransform(''); } catch (e) {}
    };
    return f.stopBreath;
  }

  function startIdlePose(mc) {
    if (!mc) return false;
    if (String(mc.tag && mc.tag.id) === IDLE_POSE_SYM) {
      /* 连它自己带整棵子树一起拨：`5616` 是 17 帧的呼吸循环，里面的 `5615`（20 帧，头/脸那一层）
       * 也是"无脚本 = 自动播"，一并转起来（装备那两支照旧跳过）。 */
      startNestedAnim(mc, true, false, true);
      return true;
    }
    for (const rec of mc.nodes ? mc.nodes.values() : []) {
      if (rec && rec.clip && startIdlePose(rec.clip)) return true;
    }
    for (const c of mc.__attached || []) if (startIdlePose(c)) return true;
    return false;
  }

  /* ============================================================
   * HUD（`showFightInfo` / `showBlood` / `Player.reduceBlood`）
   * ============================================================ */
  /** 这一场的幻兽队伍（最多 3 只，保持编队顺序）。 */
  function hudPetList(f) {
    return (Array.isArray(f && f.pets) ? f.pets : []).filter((p) => p && Number(p.id) > 0).slice(0, 3)
      .map((p) => ({ id: Number(p.id), name: String(p.name || '幻兽'), grade: Number(p.grade) || 1,
        level: Number(p.level) || 1, skillId: Number(p.skillId) || 0 }));
  }
  /** `showBringPets()`：把原版「全身」4280 的第 `pet.id` 帧缩进 3414 幻兽格（42×42）。
   * 原版是 `attachMovie(summons.name, "summonsImgMc", 100)` —— 每只幻兽一个导出符号；
   * 复刻的素材库里等价的整身图就是 4280 的第 id 帧（牧场卡片也用同一颗）。 */
  function mountPetSlot(slot, pet) {
    if (!slot || !slot.attachChild) return;
    /* 同一格重复挂载时先清掉上一张裁剪壳（例如 HUD 被重新 hydrate）。 */
    try {
      const old = slot.g && slot.g.querySelectorAll ? slot.g.querySelectorAll('svg[data-pet-art="1"]') : [];
      for (const n of old) if (n.parentNode) n.parentNode.removeChild(n);
    } catch (e) {}
    try { if (slot.detachAll) slot.detachAll(); } catch (e) {}
    let clip = null;
    try { clip = slot.attachChild('4280', Math.max(1, Number(pet.id) || 1), 'summonsImgMc'); } catch (e) { clip = null; }
    if (!clip || !clip.g) { visible(slot, false); return; }
    clip.playing = false;
    let box = null;
    try { box = clip.g.getBBox(); } catch (e) { box = null; }
    if (!box || !(box.width > 0) || !(box.height > 0)) { visible(slot, false); return; }
    const pad = Math.max(0.8, Math.min(2, Math.max(box.width, box.height) * 0.02));
    const host = clip.g.parentNode;
    if (!host || !document.createElementNS) { visible(slot, false); return; }
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('x', '0'); svg.setAttribute('y', '0');
    svg.setAttribute('width', '42'); svg.setAttribute('height', '42');
    svg.setAttribute('viewBox', (box.x - pad) + ' ' + (box.y - pad) + ' ' + (box.width + pad * 2) + ' ' + (box.height + pad * 2));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('overflow', 'hidden');
    svg.setAttribute('data-pet-art', '1');
    host.insertBefore(svg, clip.g);
    svg.appendChild(clip.g);
  }
  function showFightInfo(hud, names) {
    const t = T();
    stopAt(hud, HUD_FRAME);
    setText(hud.byName('name1'), names[0]);
    setText(hud.byName('name2'), names[1]);
    /* 状态格 `c1..c3`（3414）由 `showStates` 管药丸；这一场还没接药丸，照旧收掉。
     * 幻兽格 `attackerS1..3` / `defenderS1..3` 按 `showBringPets` 填：
     * 左侧 1→2→3，右侧 3→2→1（原版对右方传入的顺序就是反的）。 */
    for (let i = 0; i < 3; i++) visible(hud.byName('c' + (i + 1)), false);
    const teams = (live && live.petTeams) || [[], []];
    for (const side of [0, 1]) {
      const slots = side === 0 ? ['attackerS1', 'attackerS2', 'attackerS3'] : ['defenderS3', 'defenderS2', 'defenderS1'];
      const pets = teams[side] || [];
      for (let i = 0; i < 3; i++) {
        const slot = hud.byName(slots[i]);
        if (!slot) continue;
        if (!pets[i]) { visible(slot, false); continue; }
        visible(slot, true);
        stopAt(slot, 2);                 // 原版先 `gotoAndStop(2)` 清空槽位
        mountPetSlot(slot, pets[i]);
      }
    }
    refreshBlood(hud);
    void t;
  }
  /** 护盾值挂在血条上方：经典 HUD 的 `bloodbar` 本身没有护盾图层，
   *  挑战塔「坚韧壁垒 / 石像鬼磐岩」的 `shellAfter` 以前只在内部记账，玩家看到的
   *  是“打中了却没掉血”。这里补一颗蓝色「护盾 N」小牌，盾归零自动隐藏。 */
  function refreshShieldBadge(rec, side, bar) {
    if (!rec || !rec.host) return;
    if (!rec.shieldBadges) rec.shieldBadges = [null, null];
    let badge = rec.shieldBadges[side];
    if (!badge || !badge.isConnected) {
      badge = document.createElement('div');
      badge.className = 'sf-shield-badge';
      badge.setAttribute('aria-live', 'polite');
      rec.host.appendChild(badge);
      rec.shieldBadges[side] = badge;
    }
    const value = Math.max(0, Math.round(Number(rec.shields && rec.shields[side]) || 0));
    const node = bar && (bar.g || bar);
    if (!value || !node || !node.getBoundingClientRect) { badge.style.display = 'none'; return; }
    const r = node.getBoundingClientRect(), h = rec.host.getBoundingClientRect();
    if (!r.width && !r.height) { badge.style.display = 'none'; return; }
    badge.textContent = '盾 ' + value;
    /* 贴在血条数字正下方：不盖名字、不盖血量数字、也不和中间的回合数抢位置。 */
    badge.style.left = (r.left - h.left + r.width / 2) + 'px';
    badge.style.top = (r.bottom - h.top + 1) + 'px';
    badge.style.transform = 'translate(-50%,0)';
    badge.style.display = 'block';
  }
  function refreshBlood(hud) {
    const t = T();
    if (!live || !hud) return;
    for (let i = 0; i < 2; i++) {
      const f = live.fighters[i];
      if (!f) continue;
      const total = Math.max(1, f.blood.totalBlood || 1);
      const left = Math.max(0, Math.min(total, f.blood.leftBlood));
      const bar = hud.byName('bloodbar' + (i + 1));
      stopAt(bar, Math.max(1, Math.min(BLOOD_BAR_FRAMES, Math.floor((total - left) * 100 / total) || 1)));
      const txt = hud.byName('bloodtext' + (i + 1));
      /* 血量数字不按原版 59 单位字段框裁切：高层/高 buff 的生命会超过六位，
       * 裁掉后看起来像“数字被血条边界挡住”。只放开这两条字段。 */
      if (txt) setText(txt, left + '/' + total + ' ', { noClip: true });
      /* 用血条上的数字框当锚点：`bloodbar` 那两个元件在素材里是整条轨道，
       * 直接取中心会落到屏幕中间（实测护盾牌会压到回合数旁边）。 */
      refreshShieldBadge(live, i, txt || bar);
    }
    if (t) t.showNumber(Math.max(0, live.roundsLeft), hud, 0, 0, 'right', 2);
  }
  /** `showBlood()`（`MainMovie.as:15756`）：把**那一侧**的伤害数字模板复制一份再播。
   *
   * 原版链路（逐条抄）：
   *   · 模板 = 各自那一侧的 `blood.mc`（`MainMovie.as:6165`：`blood1.mc = fightSub.leftBlood`
   *     左侧/我方、`blood2.mc = fightSub.rightBlood` 右侧/对手）——**按"飘在哪一边"选**，
   *     **不是**按加血/扣血选。以前写成了 `heal ? 4846 : 4845`：扣血恒定拿 4845、
   *     加血恒定拿 4846，治疗数字会跑到对面那一侧去。
   *   · 它们挂在 `fightSub`(4847) 第 1 帧的 `1.05,0,0,1.05, 56.25|244.25, 62.7` 上 ——
   *     这就是**飘字落点**（装备包之外唯一一处能拿到它的地方，`run()` 里量一次存进
   *     `live.bloodBase`）。
   *   · `mc.gotoAndStop(type == 0 ? 1 : 2)`：第 1 帧 = 常规落点 / 第 2 帧 = 反伤·自伤那一档
   *     （整串数字右移 ~111；对手侧在素材里就是镜像的 -124）。以前恒定 `stopAt(clip, 1)`。
   *   · `mc._x += random(30) * ±1`、`mc._y += index * 20`（同一侧连续飘字往下叠）。
   *     ⚠ **没有纵向随机抖动** —— `±(random(50)+10)` / `±random(60)` 那是 `duplicateMc()`
   *     （`boom` 分次扣血用的）的规则；以前混进来之后数字会散开 ±60，观感就是"飘得哪儿都是"。
   *   · `mc.bloodMc.num.gotoAndStop(blood > 20 ? 3 : blood > 10 ? 2 : 1)` —— 数字**三档大小**
   *     （4843 的三帧把位图数字缩到 0.93 / 1.53 / 1.89）。
   *   · `addOrReduce.gotoAndStop(symbol)` + 字形档 `showNumber(blood, …, font, 0, 0)`，
   *     两处都由 **symbol** 决定（`Player.reduceBlood` :83 / `addBlood` :125）：
   *       · symbol **1** = 扣血（`human`/`skill`/`dot` 都是它）→ addOrReduce 第 1 帧（减）、字形 **2**
   *       · symbol **2** = 回血 → 第 2 帧（加）、字形 **3**
   *       · symbol **3** = 狂暴反击那一路 → 第 3 帧、字形 **4**
   *   · `bloodMc.gotoAndPlay(2)` → 21 帧的"弹出 → 上飘 → 淡出"（第 12 帧起透明度逐帧降到 0），
   *     末帧 `stop()`。 */
  const FLOAT_KIND = {
    hit: { frame: 1, symbol: 1, font: 2 },
    dot: { frame: 1, symbol: 1, font: 2 },
    heal: { frame: 1, symbol: 2, font: 3 },
    /* 反伤 / 反击 / 自伤走 `reduceBlood(…, 4|5)` 那一档 → 模板第 2 帧、仍是"减"的字形。 */
    back: { frame: 2, symbol: 1, font: 2 },
    /* 暴击（原版 `Player.reduceBlood` 的 `currentRound.isBerserk == 1`）：
     * `addOrReduce` 第 3 帧就是「暴击」字样（4842 第 3 帧 / 形状 4841），数字用 font 4。 */
    berserk: { frame: 1, symbol: 3, font: 4 },
  };
  function floatNumber(side, value, kind) {
    const view = live && live.view;
    if (!view || !view.attachChild) return;
    const mag = Math.max(0, Math.round(Math.abs(Number(value) || 0)));
    if (!mag) return;
    const spec = FLOAT_KIND[kind] || FLOAT_KIND.hit;
    const base = (live && live.bloodBase && live.bloodBase[side]) || (side === 0 ? [1.05, 56.25, 62.7] : [1.05, 244.25, 62.7]);
    const clip = view.attachChild(side === 0 ? '4845' : '4846', spec.frame, 'float');
    if (!clip) return;
    /* 复制点的抖动 + 同一侧往下叠（原版 `showBlood` 的 `index` 逻辑）。 */
    const jx = (Math.random() < 0.5 ? -1 : 1) * Math.floor(Math.random() * 30);
    const stack = (live.floats[side] = (live.floats[side] || 0) + 1);
    clip.setExtraTransform('matrix(' + base[0] + ',0,0,' + base[0] + ',' + (base[1] + jx) + ',' + (base[2] + stack * 20) + ')');
    const bloodMc = clip.byName('bloodMc');
    if (bloodMc) {
      const t = T();
      /* 每次都从 `bloodMc` 的**当前帧**重取 `num` / `addOrReduce`。
       * `playClip` 从第 2 帧起播，途中 `bloodMc` 会重建/复用 `num`；只在创建时
       * 写一次，换帧后数字精灵可能回到默认的「0000」（用户 2026-11 报的
       * "伤害贴图错误"）。前 3 帧各补写一次，之后数字已经稳定。 */
      const applyNumber = () => {
        const bm = clip.byName('bloodMc');
        const num = bm && bm.byName('num');
        if (!num) return;
        stopAt(num, mag > 20 ? 3 : mag > 10 ? 2 : 1);
        stopAt(num.byName('addOrReduce'), spec.symbol);
        const digits = num.byName('num');
        if (t && digits) t.showNumber(mag, digits, spec.font, 0, 0);
      };
      applyNumber();
      /* 播完（末帧透明度已经是 0）把这一颗收掉，并让同侧的叠层计数落回去。 */
      playClip(bloodMc, { onFrame: (n) => { if (n <= 3) applyNumber(); } }).then(() => {
        if (clip.destroy) clip.destroy();
        else if (clip.g && clip.g.parentNode) clip.g.parentNode.removeChild(clip.g);
        if (live) live.floats[side] = Math.max(0, (live.floats[side] || 1) - 1);
      });
    }
  }

  /** `boom(mc, num)`（`MainMovie.as:15710`）：幸运一击的**多球分裂**。
   *
   *  原版链路（`sprite6122` / `sprite6185` 第 31 帧脚本 → `_root.beAttack(); _root.boom(ball, count)`）：
   *    · `count = currentRound.boomCount`（协议第 15 字段；`sprite7850` 的 `mc.attacks.attack.count`）；
   *    · 总伤害先扣**余数**：`floor(harm/num)*(num-1)` 个球各分一份，第一个数字拿 `harm - 份额*(num-1)`；
   *    · 其余 `num-1` 个球是**复制出来的球元件**：`duplicateMc` 每次随机 `_x ±(10..59)`、`_y ±(0..59)`，
   *      出生时隐藏；之后**每 100ms** 亮一个、`gotoAndPlay(2)`、并扣它那一份血；
   *    · 队列空了才 `attackEnd = true`（这一拍结束）。
   *  复刻这边总伤害已经在 `applyHp()` 里一次性结算（同一份数值），这里只补**演出与分段飘字**：
   *  第一下按余数飘、剩下每 100ms 亮一个球 + 飘一份，观感与原版一致。
   *  ⚠ 原来这里根本不做分裂：伤害一次飘完、也没有多出来的球（第 257 批自标的「功能缺口」）。 */
  /* 多球分裂的抖动范围（原版 `duplicateMc`：`_x ± (random(50)+10)`、`_y ± random(60)`）。 */
  const BOOM_BALL_JITTER = { xMin: 10, xSpan: 50, ySpan: 60 };
  function boomSplit(rec, attacker, r, side, acts, aborted) {
    const view = rec && rec.view;
    const total = Math.max(0, Math.round(Math.abs(Number(r.dmg) || 0)));
    const n = Math.max(2, Math.min(8, Math.round(Number(r.boomCount) || 0)));
    if (!total) return false;
    const share = Math.floor(total / n);
    const first = total - share * (n - 1);
    /* 第一下就是"已经打到身上的那一次"：数字换成余数（原版 `defender.reduceBlood(_loc7, 1)`）。 */
    floatNumber(side, first, r.crit ? 'berserk' : 'hit');
    const sel = attacker && attacker.attacks ? attacker.attacks() : null;
    const ball = sel && sel.byName ? sel.byName('attack') : null;
    if (!view || !sel || !sel.attachChild) return true;
    const symId = acts && acts.sym ? String(acts.sym) : '';
    const base = (ball && ball.g && ball.g.__baseMa) ? String(ball.g.__baseMa) : '';
    const balls = [];
    for (let i = 1; i < n; i++) {
      const timer = setTimeout(() => {
        if (aborted()) return;
        const dx = (Math.random() < 0.5 ? -1 : 1) * (BOOM_BALL_JITTER.xMin + Math.floor(Math.random() * BOOM_BALL_JITTER.xSpan));
        const dy = (Math.random() < 0.5 ? -1 : 1) * Math.floor(Math.random() * BOOM_BALL_JITTER.ySpan);
        let clip = null;
        if (symId) clip = sel.attachChild(symId, 1, 'boom');
        if (!clip) clip = ball;                        // 兜底：拿不到球元件就不画额外球，只飘数字
        if (clip && clip !== ball) {
          clip.setExtraTransform((base ? 'matrix(' + base + ') ' : '') + 'translate(' + dx + ',' + dy + ')');
          visible(clip, false);
          if (clip.g) clip.g.style.visibility = 'hidden';
          balls.push(clip);
          visible(clip, true);
          play(clip, 2);
        }
        if (share > 0) floatNumber(side, share, r.crit ? 'berserk' : 'hit');
      }, i * 100);
      if (rec.timers) rec.timers.push(timer);
    }
    /* 分裂完把复制出来的球收掉（原版它们随父容器一起被下一拍清掉）。 */
    const cleanup = setTimeout(() => {
      for (const c of balls) { try { if (c.destroy) c.destroy(); } catch (e) {} }
    }, n * 100 + 600);
    if (rec.timers) rec.timers.push(cleanup);
    return true;
  }

  /* ============================================================
   * 主流程
   * ============================================================ */
  function clean() {
    const rec = live;
    if (!rec) return;
    for (const id of rec.timers) clearTimeout(id);
    for (const id of rec.rafs) caf(id);
    if (rec.atlasCleanups) for (const dispose of [...rec.atlasCleanups]) dispose();
    for (const wake of [...rec.sleepers]) wake();
    rec.sleepers.clear();
    if (rec.pickups) { try { rec.pickups.close(); } catch (e) {} }
    if (rec.topLayerRelayout && window.removeEventListener) window.removeEventListener('resize', rec.topLayerRelayout);
    if (rec.topLayerRO) { try { rec.topLayerRO.disconnect(); } catch (e) {} }
    if (rec.bgLayerRelayout && window.removeEventListener) window.removeEventListener('resize', rec.bgLayerRelayout);
    if (rec.bgLayerRO) { try { rec.bgLayerRO.disconnect(); } catch (e) {} }
    if (rec.skipButton) rec.skipButton.remove();
    if (rec.speedButton) rec.speedButton.remove();
    if (rec.host && rec.host.parentNode) rec.host.parentNode.removeChild(rec.host);
    if (rec.view) { try { rec.view.destroy(); } catch (e) {} }
    if (live === rec) live = null;
  }
  function wait(ms) {
    const rec = live;
    if (!rec || rec.stopped) return Promise.resolve();
    const scaled = rec.speed > 1 ? ms / rec.speed : ms;
    return new Promise((resolve) => {
      const wake = () => { clearTimeout(timer); rec.sleepers.delete(wake); resolve(); };
      const timer = setTimeout(wake, scaled);
      rec.sleepers.add(wake);
    });
  }

  async function run(opts) {
    const o = opts || {};
    const s = S();
    if (!s || !window.SfRender) throw new Error('SfFight 需要 State 与 SfRender');
    if (live && live.controller) live.controller.cancel();
    clean();
    const mine = ++seq;
    const ui = document.getElementById('ui');
    if (!ui) throw new Error('SfFight 找不到 #ui');
    ui.innerHTML = '';
    const host = document.createElement('section');
    host.className = 'classic-home ssfight-home';
    host.setAttribute('aria-label', '战斗');
    ui.appendChild(host);

    const rec = {
      host: host, view: null, fighters: [null, null], plans: [null, null], speeds: 1,
      /* 真·色诱：这一侧当前是否处于“被脱光装备”的视觉状态。 */
      strip: [false, false],
      rounds: [], index: 0, round: 0, roundsLeft: 0, floats: [0, 0], hps: [1, 1], maxHp: [1, 1],
      shields: [0, 0], speed: 1, stopped: false, skipped: false, ended: false,
      /* 双方出战幻兽（HUD 3414 格子与 `showBringPets` 用；空数组 = 这一场不显示）。 */
      petTeams: [hudPetList(o.me), hudPetList(o.foe)],
      timers: [], rafs: [], sleepers: new Set(), settling: false,
      /* 「跳过」的即时信号：开打前奏（血条滑入 / 3-2-1-GO）不是回合演出，玩家按跳过时
       * 不能等它自己播完 —— `perform` 在每段前奏上都和这个 Promise 赛跑（见 `controller.skip`）。 */
      skipSignal: null, wakeSkip: null,
      /* 这一场的入参（开宝箱要按 `kind` 选掉落池、按 `dropRandom` 保持可复现）。 */
      o: o,
    };
    live = rec;
    rec.skipSignal = new Promise((resolve) => { rec.wakeSkip = resolve; });
    /* 战斗中悬浮奖励（与复刻其它战斗同一份机制、同一份掉落规则）：
     * 它有自己的 DOM 层与 rAF 节拍，`collectDrops === false`（挑战塔 / 无尽塔）时不建。
     * ⚠ 真正的创建放到 `Sim.simulate()` **之后**（见下方 RNG 顺序说明）：这里先占位，
     *   让 `skip()` / `clean()` 在加载素材期间被调用时也能安全拿到 null。 */
    let pickups = null;

    await SfRender.loadExtra('tags-fight.json');
    /* 征战动物 boss 的 6833 模型单独成包：只有这一场真的遇到 campaign 才加载，
     * 普通随机战 / 塔战不多付这 3 MB。 */
    if (o.foe && o.foe.campaign) {
      try { await SfRender.loadExtra('tags-campaign-boss.json'); }
      catch (e) { /* 缺包就退回松鼠外观，战斗逻辑照走 */ }
    }
    /* 幻兽格用的是「全身」4280（`tags-summons.json`，牧场卡片同一颗）。
     * 只有这一场真的有幻兽才加载，没有幻兽的普通战斗不多付这一份素材。 */
    if (rec.petTeams.some((list) => list.length)) {
      try { await SfRender.loadExtra('tags-summons.json'); } catch (e) { /* 缺包就没有立绘，逻辑照走 */ }
    }
    /* 三侠的现代动作图集（与 `battle.js` 同一份 AnimationStr / atlas）：
     * 只加载这一场真的会出场的体型；最多等 1.2s，没等到就退回 7689 静态稿。 */
    if (window.Engine && Engine.loadSheets) {
      const kinds = new Set();
      for (const src of [o.me, o.foe]) {
        const kind = npcTypeOf(src);
        if (kind && kind !== 'wood' && NPC_SHEETS[kind]) kinds.add(kind);
      }
      if (kinds.size) {
        const ids = [];
        for (const kind of kinds) ids.push(...NPC_SHEETS[kind], ...NPC_EFFECT_SHEETS[kind]);
        try {
          await Promise.race([
            Engine.loadSheets([...new Set(ids)]),
            new Promise((resolve) => setTimeout(resolve, 1200)),
          ]);
        } catch (e) { /* 图集没到就退回静态稿 */ }
        /* 变异三侠的换色图集在普通图集之后生成；失败时 makeAtlasNpcFighter 会退回普通版。 */
        for (const src of [o.me, o.foe]) {
          if (!src || !src.mutant) continue;
          const kind = npcTypeOf(src);
          if (kind && NPC_SHEETS[kind]) { try { await Engine.ensureMutantSheets(kind); } catch (e) {} }
        }
      }
    }
    try { await loadGearTables(); } catch (e) { /* 没表就不穿装备 */ }
    try { await loadLootIcons(); } catch (e) { /* 没表就不画战利品图标 */ }
    if (mine !== seq || rec.stopped) return null;
    const view = await SfRender.mountSymbol(host, SYM.fight, {
      frame: F.scene, label: '战斗', policy: {}, onClip: onClip,
    });
    if (mine !== seq || rec.stopped) { view.destroy(); return null; }
    rec.view = view;
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    const t = T();
    if (t) t.freezeDescendants(view);

    const result = o.result || (window.Sim && Sim.simulate ? Sim.simulate(o.me, o.foe) : null);
    if (!result) throw new Error('SfFight 需要战斗结果');
    rec.result = result;

    /* 悬浮掉落必须在 `Sim.simulate()` **之后**创建（与现代 `Battle.run` 同一顺序）。
     * `BattleDrops.create()` 会立刻调用 `plan()` 抽 4 次 `Math.random()`（1 次时间偏移 +
     * 3 件掉落）。以前这里在模拟之前建它，于是同一组输入下，经典战斗的出手抽签
     * 随机流整体后移 4 个随机数 —— 选武器/选技能/普攻的权重明明共用 `Sim`，
     * 实际抽出来的回合却和现代战斗对不上（QA 固定随机流时尤其明显）。
     * `dropRandom`（QA 夹具）只替掉落那一包随机，不会替 Sim 的随机，所以顺序必须一致。 */
    pickups = (o.collectDrops !== false && !o.result && window.BattleDrops)
      ? BattleDrops.create({ root: ui, random: o.dropRandom, kind: o.kind }) : null;
    rec.pickups = pickups;

    /* 场景：原版 `fight.backGround.gotoAndStop(random(_totalframes - 1) + 1)`。
     * 复刻的普通战斗已经按 region 选好了场景，所以 region 给定时就用它（0..4 → 帧 1..5）。 */
    const bg = view.byName('backGround');
    const bgFrame = (o.region != null && Number(o.region) >= 0 && Number(o.region) < BG_FRAMES)
      ? Number(o.region) + 1 : (1 + Math.floor(Math.random() * BG_FRAMES));
    stopAt(bg, bgFrame);

    /* `fightSub`(4847) = 原版 `loadMcs([["战斗1","fightSub",currentFrame]])`（MainMovie.as:24110）：
     * 第 1 帧放着**左右两颗伤害数字模板**（`leftBlood` 4845 / `rightBlood` 4846）与
     * 「继续挑战」对话框 `keepFight`(4839)。模板在 `setUp()` 里被 `gotoAndStop(_totalframes)` 收掉，
     * 只在 `showBlood()` 里被 `duplicateMovieClip` 出来用 —— 复刻这边用 `attachChild` 现挂，
     * 落点直接读模板自己的放置矩阵（**飘字位置全靠它**，不要再拍脑袋写坐标）。 */
    const sub = view.attachChild(SYM.fightSub, 1, 'fightSub');
    if (sub) {
      const kl = sub.byName('keepFight');
      if (kl) visible(kl, false);        // 关卡连战才用，普通战斗收掉
      rec.bloodBase = [0, 1].map((i) => {
        const c = sub.byName(i === 0 ? 'leftBlood' : 'rightBlood');
        const m = String((c && c.g && c.g.__baseMa) || '').split(',').map(Number);
        if (m.length === 6 && m.every((v) => isFinite(v))) return [m[0], m[4], m[5]];
        return i === 0 ? [1.05, 56.25, 62.7] : [1.05, 244.25, 62.7];
      });
      for (const n of ['leftBlood', 'rightBlood']) {
        const c = sub.byName(n);
        if (c && c.frameCount) stopAt(c, c.frameCount());
        /* 模板只用来读落点矩阵；真正的飘字是 `floatNumber` 现挂的副本。
         * 模板本身必须藏掉：它停在空档帧只是"看不见"，一旦因为换帧/节拍把它
         * 重新实例化到第 1 帧，就会露出默认的「- 0000」（用户 2026-11 报的
         * "伤害贴图错误"）。`visible(false)` 是显式兜底，不再赌帧号。 */
        if (c) visible(c, false);
      }
      rec.fightSub = sub;
    }

    const sources = [o.me, o.foe];
    const names = sources.map((f, i) => String((f && f.name) || (i ? '对手' : '小松鼠')));
    const hpOf = (f) => Math.max(1, Math.round(Number(f && f.hp) || 1));
    for (let i = 0; i < 2; i++) {
      rec.maxHp[i] = Math.max(hpOf(sources[i]), Math.round(Number(sources[i] && sources[i].maxHp) || 0) || 0);
      rec.hps[i] = Math.min(hpOf(sources[i]), rec.maxHp[i]);
    }
    if (Array.isArray(result.startShell) && result.startShell.length === 2) rec.shields = result.startShell.map((v) => Math.max(0, Math.round(Number(v) || 0)));
    rec.rounds = Array.isArray(result.rounds) ? result.rounds : [];
    /* 原版 `maxRounds = 60`，每打完一个"整回合"（`round.isRound == 1`）就 `--leftRounds`，
     * HUD 右上角显示的是**剩余回合**。训练木桩传自己的固定回合（`DUMMY.rounds`），
     * 其余战斗不传时仍按原版 60。 */
    rec.roundsLeft = Math.max(1, Math.floor(Number(o.maxRounds) || 60));

    /* HUD + 两个格斗者 */
    const hud = view.byName('blood');
    const winWords = view.byName('winWords');
    stopAt(winWords, winWords && winWords.frameCount ? winWords.frameCount() : 6);
    for (let i = 0; i < 2; i++) {
      const npc = npcTypeOf(sources[i]);
      const campaign = sources[i] && sources[i].campaign ? sources[i].campaign : null;
      rec.fighters[i] = makeFighter(i, buildFighter(view, i, wearsOf(i, sources[i]), npc, campaign, !!(sources[i] && sources[i].mutant)), {
        name: names[i], maxHp: rec.maxHp[i], skills: skillsOf(i, sources[i]),
      });
      const f = rec.fighters[i];
      if (f) { f.blood.totalBlood = rec.maxHp[i]; f.blood.leftBlood = rec.hps[i]; f.blood.finalBlood = rec.hps[i]; }
      /* 开打倒计时那几秒里，两个人就该在**待机呼吸**（原版 `5616` 是一直循环的），
       * 不能像木头一样杵着 —— 见 `startIdlePose`。NPC 的呼吸由图集动画自己起。
       * 征战动物没有 5616：它的待机片断嵌在出手动画第 1 帧里（见 `startCampaignIdle`），
       * 建树那一刻就已经在第 1 帧上，这里直接让它转起来；素材缺帧才退回假浮动。 */
      if (f && f.mc && !f.npc && !f.campaign) startIdlePose(f.mc);
      if (f && f.campaign && !startCampaignIdle(f)) startCampaignBreath(rec, f);
    }
    if (hud) {
      /* 原版是 `fightPrelude()` → `fight.blood.gotoAndPlay(2)`；血条元件自己的帧脚本
       * （`sprite7703.as`）在第 8 帧 `stop(); _root.showFightInfo(this)` ——
       * 也就是"血条滑进来之后名字/数字才出现"。以前这里按**猜的时间**补了 460ms，
       * 现在直接照那一帧接。
       * 这个 Promise 交给 `perform` —— 原版开打倒计时（3/2/1/GO）就是接在它后面的。 */
      rec.hudReady = playClip(hud, {
        stop: HUD_STOP,
        onFrame: (n) => { if (n >= HUD_STOP && live === rec) showFightInfo(hud, names); },
      });
    }
    rec.hud = hud; rec.names = names;

    /* 右下角操作键：**「跳过」用原版那颗贴图**（`跳过` 4528，原版 `showSkip()` 是
     * `_root.attachMovie("跳过","skipmc",100,{_x:0,_y:0})`，画稿自带原版位置——
     * 舞台右下角）；倍速是复刻自己加的功能，原版没有，所以放到**左下角**不挡那颗跳过。 */
    addSpeedKey(rec, o);
    /* 跳过键显示：系统页 `showSkip` 关闭时 `State.skipButtonEnabled()` 为 false；
     * 老测试桩没有这个入口时退回 `unlockedSkip()`。 */
    const skipEnabled = !window.State || !State.unlockedSkip
      || (State.skipButtonEnabled ? State.skipButtonEnabled() : State.unlockedSkip());
    if (o.allowSkip !== false && skipEnabled) {
      /* 图集层是 HTML canvas，会盖住主 SVG 里后挂的跳过键；把跳过键移到战斗最上层
       * 的 SVG 覆盖层里（见 `makeBattleTopLayer`），保持原版层序。 */
      const topLayer = makeBattleTopLayer(rec, view.g || view);
      const sk = view.attachChild(SYM.skip, 1, 'skip');
      if (sk && sk.g) {
        /* 原版 `showSkip()` 是 `attachMovie("跳过","skipmc",100,{_x:0,_y:0})`（不缩放），
         * 但那一颗在导出的 h 版里比"c 版原版截图"里那颗**宽约 11%**
         *（2026-11 用户口径："跳过键太大了"；把两张图的右下角裁出来等比对齐量过：
         * 原版占舞台宽 21.9%，复刻 24.4%，高度两边都是 16%）。
         * 这里按**自己的中心**缩 0.8（不是按原点缩，否则整颗会往左上跑）。 */
        sk.setExtraTransform('translate(271.5,172.5) scale(0.8) translate(-271.5,-172.5)');
        /* 反馈壳与经典界面其它按钮同一套（`.sf-feedback`：悬停暖色光晕 + 1.035 缩放、
         * 按下回弹）。⚠ 壳**只包画稿**：`sk.g` 上的 transform 是原版落点，给 g 加
         * CSS transform 会把定位矩阵顶掉、整颗键从右下角跑掉。 */
        const NS = 'http://www.w3.org/2000/svg';
        const shell = document.createElementNS(NS, 'g');
        shell.setAttribute('class', 'sf-feedback');
        shell.style.transformBox = 'fill-box';
        shell.style.transformOrigin = 'center';
        const box = t && t.measureHitBox ? t.measureHitBox(sk) : null;
        for (const child of Array.from(sk.g.childNodes)) {
          if (child.nodeType === 1 && String(child.tagName).toLowerCase() === 'defs') continue;
          shell.appendChild(child);
        }
        sk.g.appendChild(shell);
        /* 热区**不能**走 `popWrap` / 点击路由：路由会把 `sk.g` 的 pointer-events 关掉，
         * 而跳过键正压在会呼吸的对手身上 —— 按下/松开之间鼠标底下是底层动画节点，
         * 换帧一重建浏览器就不发 click（实测 321GO 期间时灵时不灵）。键本身是静止的，
         * 自己铺一块透明矩形最稳，也仍保留经典界面"整块可点"的手感。 */
        if (box && box.w && box.h) {
          const pad = Math.max(Math.min(box.w, box.h) * 0.04, 2);
          const hit = document.createElementNS(NS, 'rect');
          hit.setAttribute('x', String(box.x - pad));
          hit.setAttribute('y', String(box.y - pad));
          hit.setAttribute('width', String(box.w + pad * 2));
          hit.setAttribute('height', String(box.h + pad * 2));
          hit.setAttribute('fill', 'transparent');
          hit.setAttribute('pointer-events', 'all');
          /* 与工具件的热区同一记号：以后若再量画稿包围盒，这块透明矩形不算"画稿"。 */
          hit.setAttribute('data-hit', '1');
          sk.g.appendChild(hit);
        }
        sk.g.style.pointerEvents = 'auto';
        sk.g.style.cursor = 'pointer';
        /* Chrome 会把按到的 SVG `<g>` 设为 activeElement 并画一圈 UA 蓝色焦点框
         * （实测：按下跳过时整颗键外面多一个蓝矩形）。这只键是鼠标操作、没有键盘焦点态，
         * 关掉默认焦点框，改由 `.sf-feedback` 的悬停 / 按下动效承担反馈。 */
        sk.g.style.outline = 'none';
        sk.g.setAttribute('aria-label', '跳过战斗');
        const fireSkip = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const runSkip = () => { if (rec.controller) rec.controller.skip(true); };
          if (window.SfUiFeedback) SfUiFeedback.tap(sk.g, runSkip, { delay: 0, press: false });
          else runSkip();
        };
        sk.g.addEventListener('click', fireSkip);
        if (window.SfUiFeedback) SfUiFeedback.bind(sk.g, { shell: shell });
        /* 移到最上层覆盖 SVG：图集 canvas 是 HTML 层，按 DOM 顺序会盖住主 SVG 里的跳过键。
         * 跳过键的画稿/transform/defs 都是自带的，换 SVG 后仍按同一套舞台坐标渲染。 */
        if (topLayer) topLayer.appendChild(sk.g);
        rec.skipSprite = sk;
      }
    }

    const controller = {
      result: result,
      cancel() { rec.stopped = true; clean(); },
      skip(byButton) {
        if (rec.settling || rec.skipped || rec.stopped) return;
        rec.skipped = true;
        rec.skippedByButton = !!byButton;
        /* 开打前奏里按跳过也要**当场**收尾：血条滑入 / 3-2-1-GO 都在 `perform` 里 await，
         * 以前只置 `skipped`，倒计时那颗 `3750` 仍会播完（约 2.1s），玩家看到的就是
         * "321GO 播完之前按跳过没反应"。这里把倒计时停住，并用 `wakeSkip` 打断前奏的等待。 */
        if (rec.countdown) {
          const cd = rec.countdown;
          rec.countdown = null;
          try { if (cd.stop) cd.stop(); } catch (e) {}
        }
        if (rec.wakeSkip) { const wake = rec.wakeSkip; rec.wakeSkip = null; wake(); }
        /* 按「跳过」键跳过 → 战斗中的悬浮奖励只收 2/3（与复刻其它战斗同一条口径）。 */
        if (pickups) pickups.skip(!!byButton);
        for (const wake of [...rec.sleepers]) wake();
      },
    };
    rec.controller = controller;
    /* 悬浮奖励自己的节拍（与 `Battle.run` 同一套：只在这一场还没播完时 tick）。 */
    if (pickups) {
      let last = (window.performance && performance.now) ? performance.now() : Date.now();
      const pump = (now) => {
        if (rec.stopped) return;
        const dt = Math.min(100, Math.max(0, now - last)) * rec.speed;
        last = now;
        if (!rec.settling && !rec.skipped && !document.hidden) { try { pickups.tick(dt); } catch (e) {} }
        rec.rafs.push(raf(pump));
      };
      rec.rafs.push(raf(pump));
    }
    perform(rec, o, result, controller).catch((error) => {
      /* 与其它页面同一条口径：异常也进 `window.__errs`（自检页与探针都读它）。
       * 只 `console.error` 的话，出问题时在页面上什么也看不到。 */
      if (window.__errs) window.__errs.push('[SfFight] ' + (error && (error.stack || error.message)));
      controller.cancel();
      console.error('[sf-fight]', error);
      if (o.onError) o.onError(error);
    });
    return controller;
  }

  /** 倍速键（复刻自己加的功能，原版没有）：放到**左下角**，避开原版那颗「跳过」贴图。 */
  function addSpeedKey(rec, o) {
    if (o.speedToggle === false) return;
    if (window.State && State.unlockedSpeed && !State.unlockedSpeed()) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', '切换战斗速度（当前 ' + rec.speed + '×）');
    b.textContent = rec.speed + '×';
    b.style.cssText = 'position:absolute;left:16px;bottom:15px;width:150px;height:64px;padding:0;' +
      'border:0;background:transparent;color:transparent;cursor:pointer;pointer-events:auto;z-index:20;';
    rec.host.appendChild(b);
    rec.speedButton = b;
    b.onclick = () => {
      const max = Math.max(1, Math.min(3, Math.floor(Number(o.speedMax) || 2)));
      rec.speed = rec.speed >= max ? 1 : rec.speed + 1;
      b.textContent = rec.speed + '×';
      b.setAttribute('aria-label', '切换战斗速度（当前 ' + rec.speed + '×）');
    };
  }

  /* ---------- 演出 ---------- */
  /** 收掉"跳过 / 倍速"两颗键（原版 `congratulate()` / `clearFrames()` 里的
   *  `_root.skipmc.removeMovieClip()`）。幂等：多次调用只摘一次。 */
  function hideFightKeys(rec) {
    if (rec.skipSprite) {
      const g = rec.skipSprite.g || rec.skipSprite;
      if (g && g.parentNode) g.parentNode.removeChild(g);
      rec.skipSprite = null;
    }
    if (rec.speedButton) { try { rec.speedButton.remove(); } catch (e) {} rec.speedButton = null; }
  }
  /* ============================================================
   * 开打倒计时「3 → 2 → 1 → GO」—— **原版那颗 `3750`**，不是另造的过场
   * ------------------------------------------------------------
   * 原版开打时的 3/2/1/GO **不是**运行时另挂的元件，而是血条 HUD（`7703`）**第 8 帧**
   * 里的一颗子元件 `3750`（42 帧，逐帧表见 `MainMovie.as` 的 `sprite3750`）：
   *   f1-6 = 3 / f7-12 = 2 / f13-19 = 1 / f19-29 = GO（每档 1.5 → 1.25 → 1 → 空 → 0.88 → 0.75
   *   的弹入弹出版）；f30-41 是**空帧**，f41 `stop()`；f29 那一拍还写了
   *   `_root.canFight = true / attackEnd = true`（＝"可以出手了"）。
   * 血条元件自己的第 8 帧脚本是 `stop(); _root.showFightInfo(this)`，所以这颗倒计时天然
   * 接在"血条滑进来之后、第一拍之前"——与 `playRound` 的顺序天然一致。
   * ⚠⚠ 复刻以前**另造了一颗 `gocd`**（按 H5 客户端 `assets.js` 的 go 图集裁 4 帧）挂在场景中央，
   *   于是同一场战斗里出现**两版 321GO**：`gocd` 播一次，原版 `3750` 又开始播；
   *   更糟的是渲染器节拍器会把"还在播"的实例**循环推进**，`3750` 于是整场战斗一直在
   *   3/2/1/GO 里打转（用户 2026-11 口径："有两个版本的 321go，其中一个会在战斗中一直循环"）。
   *   现在**只保留原版这一颗**（与 ssfight 对齐），由这里显式播一次、停在 GO 之后的空帧上；
   *   停住之后 `playing = false`，节拍器不会再把它从头循环。
   * ============================================================ */
  const COUNTDOWN_TAG = '3750';    // 血条 HUD 第 8 帧里的 3/2/1/GO
  const COUNTDOWN_END = 30;        // 29 = GO 的最后一帧；30 起是空帧（原版 f41 stop）
  /** 在一棵 clip 子树里按**元件号**找一颗实例（`byName` 只认具名元件，这颗没有实例名）。 */
  function clipByTag(clip, id, depth) {
    if (!clip || depth > 12) return null;
    if (clip.tag && String(clip.tag.id) === String(id)) return clip;
    for (const rec of clip.nodes ? clip.nodes.values() : []) {
      const hit = rec && rec.clip ? clipByTag(rec.clip, id, depth + 1) : null;
      if (hit) return hit;
    }
    for (const c of clip.__attached || []) {
      const hit = clipByTag(c, id, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  async function playHudCountdown(rec, aborted) {
    if (!rec.hud) return;
    const clip = clipByTag(rec.hud, COUNTDOWN_TAG, 0);
    if (!clip || !clip.gotoAndPlay) return;
    rec.countdown = clip;
    /* `playClip` 一路把它推到 `stop` 指定的那一帧再停住（`stopAt` + `playing = false`）——
     * 这就是"只播一次"的落点。 */
    await playClip(clip, { stop: COUNTDOWN_END });
    if (rec.countdown === clip) rec.countdown = null;
    void aborted;
  }

  /** 取一个"每帧换一个子实例"的容器里那颗子 clip —— 导出里这些子件**没有实例名**
   *  （`byName` 找不到），只能按深度取：`statu.propty` 里的状态图标、`winWords` 里的胜负字。 */
  function onlyChildClip(clip) {
    if (!clip || !clip.nodes) return null;
    for (const rec of clip.nodes.values()) if (rec && rec.clip) return rec.clip;
    return null;
  }
  /** `fight.winWords.gotoAndStop(1|2)` —— **并把里面那段字播出来**。
   *  `7717`（winWords）的每一帧都是一个"字滑进来"的动画容器（胜负字 `7708` / 失败字 `7711`，
   *  各 6 帧、第 6 帧 `stop()`），而它自己的第 1 帧是**两半字分别停在屏幕外**
   *  （`7704` 在 x=-260.75、`7705` 在 x=+484.3）。原版是 `gotoAndStop` 之后**子元件自己**
   *  从第 1 帧开始播（Flash 嵌套 clip 自动播），复刻里所有 clip 都被冻结、必须显式播 ——
   *  以前只 `stopAt(ww, 1|2)`，于是"胜利 / 失败"停在滑进来的第一帧：两半几乎全在屏幕外
   *  （用户 2026-11 口径："战斗结束后还在庆祝时的胜利&失败字样几乎超出屏幕了，位置完全不对"）。 */
  function showWinWords(ww, winner) {
    if (!ww) return;
    stopAt(ww, winner === 0 ? 1 : 2);
    const inner = onlyChildClip(ww);
    if (inner) playClip(inner);            // 6 帧滑入 → 末帧自己停住
  }

  async function perform(rec, o, result, controller) {
    const aborted = () => rec.stopped || rec.skipped;
    /* 开打倒计时（3 → 2 → 1 → GO）：原版那一颗就在血条 HUD 第 8 帧里（见 `playHudCountdown`），
     * 血条滑进来（`rec.hudReady` = 停在第 8 帧）那一刻它才出生，所以这里紧跟着播它一次。
     * ⚠ 两段前奏都和 `rec.skipSignal` 赛跑：玩家按跳过时倒计时/血条不等它们播完，
     *   立刻落到下面的结算（见 `controller.skip`）。 */
    if (rec.hudReady) {
      try { await Promise.race([rec.hudReady, rec.skipSignal]); } catch (e) {}
    }
    if (!aborted()) await Promise.race([playHudCountdown(rec, aborted), rec.skipSignal]);
    for (let i = 0; i < rec.rounds.length && !aborted(); i++) {
      rec.round = Math.max(0, 99 - i);
      /* 幻兽协战（`isRound:0`）不占原版 60 手回合数，HUD 的剩余回合不往下掉。 */
      if (!rec.rounds[i] || Number(rec.rounds[i].isRound) !== 0) rec.roundsLeft = Math.max(0, rec.roundsLeft - 1);
      if (rec.hud) refreshBlood(rec.hud);
      await playRound(rec, rec.rounds[i], aborted);
    }
    if (rec.stopped) return;
    /* 收尾：跳过时不播倒地/胜利，与原版 `skipGame()` 一致（`looser.dead(0); congratulate();`）。
     * 无论如何都要给结算方"结束时的剩余血量"（关卡连战按比例继承）。 */
    const last = [...rec.rounds].reverse().find((r) => r && Array.isArray(r.hpAfter) && r.hpAfter.length === 2);
    result.hpAfter = last ? [Math.max(0, last.hpAfter[0]), Math.max(0, last.hpAfter[1])] : null;
    const winner = Number(result.winner) === 1 ? 1 : 0;
    /* ⚠ 原版 `congratulate()`（:6468）与 `clearFrames()`（:15626）都有一句
     * `_root.skipmc.removeMovieClip()` —— **胜负一定就不再给"跳过"了**。
     * 复刻这边以前把跳过键一直留在画面上，于是战果 CG / 开宝箱那两页右上角还挂着一颗
     * "跳过"（用户口径："结算时跳过键并没有消失"）。复刻自加的倍速键一起收掉。 */
    hideFightKeys(rec);
    if (!rec.skipped) {
      const loser = 1 - winner;
      const loserF = rec.fighters[loser], winnerF = rec.fighters[winner];
      /* 两个格斗者没建出来（素材包缺件 / 挂载失败）时**不能**卡在这里 —— 直接进战果页，
       * 让结算照常走完（宁可少一段演出，也不能让玩家打完一场却拿不到结算）。 */
      rec.phase = 'ending';       // 胜负演出（倒地 + 胜利姿势 + `winWords`）
      /* 倒地多半已经在本回合"血见底"那一刻起过了（见 `playRound` 的 `impact`）——
       * 这里只补没起过的。⚠ `dead()` 是方法、恒为真，判"演过没有"要问 `isDead()`。 */
      if (loserF && !loserF.isDead()) await loserF.dead(0);
      /* 原版 `congratulate()`（`MainMovie.as:6464`）是倒地动画第 19 帧 `_root.die()` 调的：
       * 胜利姿势与 `fight.winWords` **同一刻**出现（字自己滑进来那 6 帧与姿势并行播）。 */
      showWinWords(rec.view && rec.view.byName('winWords'), winner);
      if (winnerF) await winnerF.congratulate();
      await wait(700);
    }
    if (rec.stopped) return;
    rec.settling = true;
    rec.phase = 'result';
    /* 这一场的收获：与复刻其它战斗同一份（`BattleDrops.summary()`），
     * 战果面板与开宝箱都只是它的**展示**，奖励本身早已在那套规则里发过。 */
    const loot = rec.pickups ? rec.pickups.summary() : { items: [], ups: [] };
    result.skipped = !!rec.skippedByButton;
    if (loot.items && loot.items.length) result.pickups = loot.items;
    /* 结算方可以在战果页出现**之前**把这一场的经验 / 金松果算出来（`rewardFor`），
     * 这样第一张战果页就能写全"经验 + 金松果 + 悬浮物品"，不用等开完宝箱再弹第三张。
     * 挑战页传的就是 `State.fightReward`；算过一次后调用方自己缓存，`onEnd` 不会重复扣/发。 */
    let reward = null;
    if (typeof o.rewardFor === 'function') {
      try { reward = o.rewardFor(winner); } catch (e) {
        if (window.__errs) window.__errs.push('SfFight rewardFor: ' + (e && (e.stack || e.message) || e));
      }
    }
    /* 战果面板（原版 `fight.gotoSton(2|3)`）：这一页就是"战斗结束后的 CG"，
     * 之后再按收获开宝箱（`fight.gotoAndStop(5)` → `openChest`）。 */
    /* 经典塔：胜利后不要原版战果 CG 停一下，直接交给塔的结算/下一场；
     * 失败仍保留败北面板（用户只要求去掉“战斗胜利后的 CG”）。 */
    const hideVictoryCg = !!(o.hideVictoryCg && winner === 0);
    if (!hideVictoryCg) showResultPanel(rec, o, result, winner, loot, reward);
    /* 战果页要**停一下**再进开宝箱：原版 `myLogic` 的 `state == 1` 那一支是等 60 拍
     * （14 fps ≈ 4.3 s，按 fire 可以提前结束）才 `setState(4)` → `fight.gotoAndStop(5)`。
     * 复刻这边压到 1.5 s —— 够看清战果，也不至于干等。
     * 调用方还会自己摆同一张战果页（结算 + 续战键）时传 `skipResultPanel`：这里只切帧，
     * 不等待也不让玩家先看到一遍，避免同一份经验/金松果在开宝箱前后闪两次。 */
    if (!hideVictoryCg && !o.skipResultPanel) await wait(1500);
    /* 开宝箱（原版 `fight.gotoAndStop(5)`）：**这一场有掉落机制就开**，与"收了几件"无关 ——
     * 宝箱那四件是原版 `lottery.do` 的另一包奖励（见 `openChest` 里那段说明），
     * 一件都没接到也该有四格可挑；塔战（`collectDrops:false`，没有 `pickups`）照旧不开。 */
    if (rec.pickups && !rec.o.skipChest) await openChest(rec, loot);
    if (rec.stopped) return;
    rec.stopped = true;
    clean();
    if (o.onEnd) o.onEnd(winner, result, loot, reward);
  }

  async function playRound(rec, r, aborted) {
    if (!r) return;
    rec.curRound = r;
    /* 先按上一拍的“剩余脱光回合”把装备视觉同步回来；本拍如果是命中脱装备，
     * 不在这里提前卸，留给 `beAttack` 的命中帧。 */
    if (!r.stripApplied) syncStrip(rec, r);
    const att = Number(r.attacker) === 1 ? 1 : 0, def = 1 - att;
    /* `attack(round)` 开头会把**两侧都归位**（`attacker.gotoAndStop(1)` / `defender.gotoAndStop(1)`，
     * `MainMovie.as:6353`）—— 归位是"下一拍的开头"，不是"上一拍的结尾"：
     *   · 主动作那一支（普通 / 武器 / 技能）以前只在分支里归位；
     *   · 而 `dot/buff/regen/rest/stunned` 这支**完全没归位**，于是上一拍停在 `comeBacks`(6) /
     *     `attackbacks`(5) 的身体会一直保留 —— 身体不在第 1 帧时 `mc.byName('attacks')` 是
     *     **null**，`attack()` 直接返回，画面上什么都不播。
     * ⚠ 这正是"方天画戟没有准备的前摇回合"的根因：Sim 明明推了一拍
     *   `{action:'rest', preparingWeapon:1}`（`sim.js:1236-1239`），`playRound` 也照原版去播
     *   `attackType 0` 的 `6067`（思考气泡），但身体还停在上一拍的归位帧上 → 这一拍静默跳过。
     * 归位放在**最前面**（所有分支共用）才与 `attack()` 的语义一致。 */
    for (const side of [att, def]) {
      const f = rec.fighters[side];
      if (f) f.idle();
    }
    /* 练功木桩：上一拍扣掉的血在**下一拍开头**回满。Sim 把这次回血记在
     * `r.practiceHeal`，这里先补血条再演这一拍，所以玩家看得到“先扣、下回合加回来”。 */
    if (r.practiceHeal > 0) {
      const f = rec.fighters[def];
      if (f) {
        const total = Math.max(1, f.blood.totalBlood || rec.maxHp[def] || 1);
        const left = Math.min(total, Math.max(0, Number(f.blood.leftBlood) || 0) + Number(r.practiceHeal));
        f.blood.leftBlood = left;
        rec.hps[def] = left;
        floatNumber(def, r.practiceHeal, 'heal');
        if (rec.hud) refreshBlood(rec.hud);
        await wait(260);
        if (aborted()) return;
      }
    }
    if (r.action === 'dot' || r.action === 'buff' || r.action === 'regen' || r.action === 'rest' || r.action === 'stunned') {
      applyHp(rec, r);
      if (r.dmg) floatNumber(r.selfDot ? att : def, r.dmg, 'dot');
      if (r.heal) floatNumber(att, r.heal, 'heal');
      if (rec.hud) refreshBlood(rec.hud);
      /* ---- 这几拍都没有"出手动画"，但**不能一眨眼就过去** ----
       * 2026-11 用户口径："在一些情况下两次攻击之间的间隔还是有问题"。查下来有一条就是这里：
       * 上一批把这一支的收尾统一成了 `ROUND_GAP`（170ms），于是"中毒 / 回复 / 休息 / 眩晕"
       * 这些没有动作的拍子几乎瞬间跳过 —— 连着两次出手看起来就是"前后脚"。
       * 现在按**现代播放器**的同一组节拍（`battle.js`：dot 400 / buff 320 / regen 420 /
       * rest·stunned 500）： */
      let beat = r.action === 'dot' ? 400 : r.action === 'buff' ? 320 : r.action === 'regen' ? 420 : 0;
      if (r.action === 'rest' && Number(r.preparingWeapon) > 0) {
        /* 方天画戟「攻击前需要休息一回合」的**思考一回合**：`attackType 0` → `attacks` 第 11 帧
         * = `6067`（30 帧，≈2.1s）。`6067` 里那颗 `6062` 就是"想着一把方天画戟"的思考气泡，
         * 所以**只有蓄力那一拍**才播它（现代播放器同口径：`r.preparingWeapon === 1` 才走
         * `commonThink` + 思考气泡）。这一段的长度由动画自己给，不再额外补节拍。 */
        const who = rec.fighters[att];
        if (who) {
          await who.attack(r, {});
          if (aborted()) return;
        }
        beat = 0;
      } else if (r.action === 'stunned') {
        /* 眩晕：**不播 6067** —— 那一段的气泡画的是"在想一把方天画戟"，
         * 给眩晕的角色看等于又在演"自己没有的东西"。改用原版自己那颗「晕击」状态图标
         * （`statu` 第 4 档 = `propty` 第 8 帧，逐帧渲染核对过），配现代播放器那一拍（~700ms）。
         * 原版客户端对 attackType 0 只认 6067 一段，但它那套里根本没有眩晕的图形 ——
         * 现代播放器也是"飘一行『眩晕』+ 等 500ms"，这里只是把提示换成原版素材。 */
        const who = rec.fighters[att];
        if (who) { who.setStatu(4); who.specialEffect(); }
        beat = 700;
      }
      await wait(beat || ROUND_GAP);
      return;
    }
    const attacker = rec.fighters[att];
    const defender = rec.fighters[def];
    if (!attacker || !defender) { applyHp(rec, r); await wait(300); return; }
    /* 归位已经在函数开头（所有分支共用）做过了 —— 见上面那段注释。 */
    /* ⚠ 出手这一拍原版**只按 `currentRound.specialEffectType` 给受击方拨状态图标**
     * （`MainMovie.as:6357`：1→statu 3 / 2→statu 1 / 3→statu 2），闪避与技能防御**不走这里** ——
     * 那两种改的是**身体帧**（`mc.gotoAndStop(3|4)`，由 `beAttack` 负责）。 */
    defender.setStatu(effectStatu(r));

    const acts = ATTACK_ACTS[attackPlan(r).frame] || {};
    let hit = false, guarded = false, healed = false;
    let defend = null, back = null;
    /* 归位 / 反击：原版是**受击动画自己**在 `_root.attackBack()` 那一帧起手的
     * （`DEFENSE_ACTS` 的 `back`，普通受击是第 10 帧）。`MainMovie.as:6418` 那一支只做两件事：
     *   · `attackBack == "true"`（这一拍真被打回来了，即 `harmToSelf > 0`）→ 受击方反击；
     *   · 否则 `canBeAttackBack == "true"` → **出手方播归位动画 `comeBack(0)`**。
     * `canBeAttackBack` 由 `parseFightLog`（:17944）现算：**普通攻击恒 true、近战武器 true**，
     * 投掷 / 技能 / 幻兽 false。
     * ⚠⚠ `Sim` 给普通攻击的动作名是 **`'common'`**（`sim.js` 的 `r.action = 'common'`），
     * 这里以前写的是 `r.action === 'attack'` —— 一个**永远不会成立**的判断，于是
     * **徒手/普攻之后出手方根本不走回来**：攻击动画末帧明明停在对面身边（`5630` 第 17 帧
     * 把静止姿势摆在 x=+231.8），下一拍开头 `idle()` 一拨就**瞬移**回原位，
     * 而且这一拍比原版少了走回来那 ~0.7s —— 用户 2026-11 口径：
     * "在一些情况下两次攻击之间的间隔还是有问题"（普攻那一拍的间隔明显偏短、且会跳帧）。
     * 现代播放器那边用的是**动画名**（`battle.js`：`name === 'fightCommonAttack' || …`），
     * 一直是正确归位的。 */
    const normalAttack = r.action === 'common' || r.action === 'attack';
    const canBack = normalAttack || (r.action === 'weapon' && !RANGED.has(Number(r.id)));
    const startBack = () => {
      if (back || aborted()) return;
      if (r.counterDmg || r.counterFakeDie || r.counterRebound) {
        back = runCounter(rec, r, att, def, attacker, defender, aborted);
        return;
      }
      /* ⚠ 出手动画的末帧是**留在对面身边**的（`5630` 第 17 帧把静止姿势 `5616` 摆在
       * x=+231.8、`5748` 同款），"走回来"靠的就是这条 `comeBack(0)`（`6521`：第 2 帧
       * x=289 → 第 5 帧回到 113 → 第 10 帧站回原位，末帧 `setAttackEnd()`）。
       * 以前完全没播它，所以"玩家攻击后不返回原位"。 */
      if (canBack) back = attacker.comeBack(0);
    };
    /* 命中那一拍（`_root.beAttack()`）：扣血 + 飘字 + 血条，并让受击方起手。
     * `via` 只做取证：`'hook'` = 出手动画放到命中帧（正常路径，及时）；
     * `'fallback'` = 那条动画压根没有命中帧（挂错了元件）→ 只能等它播完再补，观感是受击慢半拍。 */
    const impact = (via) => {
      if (hit || aborted()) return;
      hit = true;
      rec.impactVia = via || 'hook';
      /* 防御技（绝对防御 16 / 龟甲术 7）的起手：**照现代播放器，落在挨打那一刻**
       * （`battle.js` 的 `impact` 里就是 `defending = reaction(def, r)`，盾与挨打同一拍）。
       * 原版客户端是**出手动画第 3~25 帧的帧脚本提前调** `_root.useSkillDefense()`（`ATTACK_ACTS.guard`），
       * 复刻照抄过一版 —— 用户 2026-11 口径："绝对防御与龟甲术的动画触发实际太早了，
       * 参考现代版的做法，进行修正"，于是这一拍改成**命中时才举盾**。 */
      if (!guarded) guarded = defender.useSkillDefense(r);
      applyHp(rec, r);
      /* 闪开了就没有伤害数字（`Squirrel.beAttack` 的 `defenseType == 1` 那一支只改身体帧）。 */
      if (r.dmg && !r.dodge) {
        /* 幸运一击：`boomCount > 1` 走原版 `boom()` 的多球分裂（分段飘字 + 复制球）。 */
        if (!(Number(r.boomCount) > 1 && boomSplit(rec, attacker, r, def, acts, aborted))) {
          floatNumber(def, r.dmg, r.crit ? 'berserk' : 'hit');
        }
      }
      if (r.healSelf) floatNumber(att, r.healSelf, 'heal');
      /* 幻兽·凌波微步：闪避时给**挨打的那一方**回血（`r.dodgeHeal` 由 sim 落在这一拍上）。 */
      if (r.dodgeHeal) floatNumber(def, r.dodgeHeal, 'heal');
      if (r.lifesteal) floatNumber(att, r.lifesteal, 'heal');
      if (r.reboundHurt) floatNumber(att, r.reboundHurt, 'back');
      if (r.selfBurn) floatNumber(att, r.selfBurn, 'back');
      if (rec.hud) refreshBlood(rec.hud);
      /* 血见底就**当场**起倒地动画：原版 `Player.reduceBlood` 里紧接着就 `checkDead()` →
       * `looser.dead(distance)`，倒地与这一拍的收招是并行的，不是等整套动作演完再倒。
       * 装死 / 绝对防御挡下来的那些不算死（`defensePlan` 会走 defenseSkills）。 */
      if (rec.hps[def] <= 0 && !r.fakeDie && !defender.isDead()) {
        defend = defender.dead(0);
        /* 倒地之后出手方也要走回去：原版 `Squirrel.dead()`（:388）里 `canBeAttackBack == "true"`
         * 时起一个 500ms 的定时器 `enemy.comeBack(0)`（`congratulation == 0` 才播，
         * 也就是赶在胜利姿势之前回到原位）。 */
        if (canBack) back = wait(500).then(() => (aborted() || attacker.isDead() ? null : attacker.comeBack(0)));
      } else {
        defend = defender.beAttack(r, { guarded: guarded, back: startBack });
      }
      defender.specialEffect();
    };
    /* 13 师父驾到 / 17 来点松果：帧脚本在第 37 帧调 `_root.attacker.addBlood(...)`。 */
    const onHeal = () => {
      if (healed || aborted()) return;
      healed = true;
      applyHp(rec, r);
      if (r.healSelf) floatNumber(att, r.healSelf, 'heal');
      if (rec.hud) refreshBlood(rec.hud);
    };

    await attacker.attack(r, { heal: onHeal, hit: () => impact('hook') });
    /* 帧脚本里没有 `beAttack` 的那几档（13 师父驾到 / 14 小宇宙爆发 / 17 来点松果 /
     * attackType 0）本来就不打人：只把血量静默结算，绝不硬塞一段受击演出。 */
    if (!hit && !aborted()) {
      if (acts.hit) impact('fallback');
      else { applyHp(rec, r); if (rec.hud) refreshBlood(rec.hud); }
    }
    if (defend) await defend;
    /* 装死落在**出手方**身上（被反伤打死，`fakeDieSide` = 出手方）时，受击方那条路已经不演了
     * （见 `defensePlan`）——照现代播放器补一段给出手方自己（`battle.js` 的 reflectFakeDie）。 */
    if (!aborted() && r.fakeDie && Number(r.fakeDieSide == null ? def : r.fakeDieSide) === att
      && rec.hps[att] > 0 && !attacker.isDead()) {
      await attacker.beAttack({ fakeDie: true, fakeDieSide: att });
    }
    if (back) await back;
    if (aborted()) return;
    applyHp(rec, r);
    /* 收招后先把还活着的人拨回待机呼吸，再走那 170ms 空档 —— 照现代播放器
     * `battle.js` 每回合收尾的 `returnHome + idle(def)`。装死的那一位保持姿势
     * （它这一拍的戏就是装死），等下一拍再起身。 */
    const fakeSide = r.fakeDie ? Number(r.fakeDieSide == null ? def : r.fakeDieSide) : -1;
    if (!attacker.isDead() && att !== fakeSide) attacker.idle();
    if (!defender.isDead() && def !== fakeSide) defender.idle();
    /* 两拍之间的空档：原版只隔 1 拍（14 fps ≈ 71ms），连着看就是"刚收招又出手"。
     * 按现代播放器的口径补一段呼吸（`battle.js` 每个回合收尾 `await wait(170)`）。 */
    await wait(ROUND_GAP);
  }

  /** `attackBack()` + `beBttackBack()`：反击那一路（`Squirrel.as:369` / `MainMovie.as:6418`）。
   *  原版顺序：受击方的 `attackback`(6516) 放到**第 5 帧** → 出手方 `reduceBlood(harmToSelf, 5)`
   *  并 `comeBack(1|2)` 归位；被反伤打出装死时改播装死那一段。 */
  async function runCounter(rec, r, att, def, attacker, defender, aborted) {
    let done = false, reaction = null, reactionStarted = false;
    /** 反击命中的**同一刻**就让出手方起受击/击退反应；以前要等 defender 的
     *  attackback 整段播完才 `comeBack`，观感就是"我方挨打慢半拍"（用户 2026-11）。 */
    const startReaction = () => {
      if (reactionStarted || aborted()) return;
      reactionStarted = true;
      if (r.counterFakeDie) {
        const who = r.counterFakeDieSide == null ? att : Number(r.counterFakeDieSide);
        if (who === att) {
          const f = rec.fighters[who];
          if (f && !f.isDead()) reaction = f.beAttack({ fakeDie: true, fakeDieSide: who });
        }
        return;
      }
      if (rec.hps[att] <= 0 && !attacker.isDead()) { reaction = attacker.dead(0); return; }
      if (!attacker.isDead()) reaction = attacker.comeBack(r.counterDmg ? 1 : 2);
    };
    const settle = () => {
      if (done || aborted()) return;
      done = true;
      applyHp(rec, r);
      if (r.counterDmg) floatNumber(att, r.counterDmg, 'back');
      if (r.counterRebound) floatNumber(def, r.counterRebound, 'back');
      if (rec.hud) refreshBlood(rec.hud);
      startReaction();
    };
    await defender.attackBack({ hit: settle });
    settle();
    if (reaction) await reaction;
    if (aborted()) return;
    if (r.counterFakeDie) {
      const who = r.counterFakeDieSide == null ? att : Number(r.counterFakeDieSide);
      if (who === att) return;                    // 已在 settle 那一刻起手
      const f = rec.fighters[who];
      if (f && !f.isDead()) await f.beAttack({ fakeDie: true, fakeDieSide: who });
      return;
    }
    /* 反伤把出手方打死了：原版 `reduceBlood` 里那一下 `checkDead()` 会直接用倒地顶掉归位。 */
    if (rec.hps[att] <= 0 && !attacker.isDead()) { await attacker.dead(0); return; }
  }

  function applyHp(rec, r) {
    if (Array.isArray(r.shellAfter) && r.shellAfter.length === 2) {
      for (let i = 0; i < 2; i++) rec.shields[i] = Math.max(0, Math.round(Number(r.shellAfter[i]) || 0));
    }
    if (Array.isArray(r.maxHp) && r.maxHp.length === 2) {
      for (let i = 0; i < 2; i++) {
        const next = Math.max(1, Math.round(Number(r.maxHp[i]) || rec.maxHp[i]));
        if (next < rec.maxHp[i]) { rec.maxHp[i] = next; if (rec.fighters[i]) rec.fighters[i].blood.totalBlood = next; }
      }
    }
    if (Array.isArray(r.hpAfter) && r.hpAfter.length === 2) {
      for (let i = 0; i < 2; i++) {
        const v = Math.max(0, Math.min(rec.maxHp[i], Number(r.hpAfter[i]) || 0));
        rec.hps[i] = v;
        if (rec.fighters[i]) rec.fighters[i].blood.leftBlood = v;
      }
    }
  }

  /* ---------- 战果面板（`showFightResult`） ----------
   * 逐条照 `MainMovie.as:18703-18848`。帧里的具名元件（导出实测）：
   *   `backgd`(7722) CG 底 / `prizeBackg`(7725) 奖励板 / `maxlevel`(7730) 横幅
   *   （**每帧一条烤在里面的文案**：f1 =「闯关成功，本关经验已在上次掉线前获得。」/
   *    f2 =「您的等级已达上限，无法获得经验。」/ f3 = 增益提示 / **f4 = 不带文案**）
   *   / `shoutu`(7736) 收益栏 / `getExp`(7739, f1 里 `exp` 是数字精灵 4315)
   *   三格奖励 = `c1/c2/c3`(3414) + `num/num1/num3`(4843)。
   * ⚠ 数字要写进 **`num.num`**（4315 才是那排位图数字）而不是 `num`（4843 是它的外壳）：
   *   写错层级不会报错，只是那一格永远停在素材里的占位串 —— 实拍就是两排「-0000」。 */
  function showResultPanel(rec, o, result, winner, loot, reward) {
    const view = rec.view;
    if (!view) return;
    /* `clearFrames()`：原版在出战果之前把两个格斗者收掉（`player1.gotoAndStop(_totalframes)`）。 */
    for (const f of rec.fighters) {
      if (!f || !f.holder) continue;
      /* 图集层一起收掉：战果页 / 宝箱页不该还压着战斗中的模型。 */
      if (f.hide) { try { f.hide(); } catch (e) {} }
      const last = f.holder.frameCount ? f.holder.frameCount() : 8;
      stopAt(f.holder, last);
    }
    for (let i = 0; i < 2; i++) {
      const f = rec.fighters[i];
      if (f) f.blood.finalBlood = rec.hps[i];
    }
    stopAt(view, winner === 0 ? F.win : F.lose);
    const backgd = view.byName('backgd'); if (backgd) stopAt(backgd, winner === 0 ? 1 : 2);
    const prizeBackg = view.byName('prizeBackg');
    const getExp = view.byName('getExp');
    const maxlevel = view.byName('maxlevel');
    const shoutu = view.byName('shoutu');
    const t = T();
    /* 结算方在战果页出现前算好的经验优先（挑战页的 `rewardFor`）；没有时沿用旧的
     * `expGain` / `result.exp`。 */
    const rewardExp = reward && reward.exp != null ? reward.exp : null;
    const expKnown = rewardExp != null || o.expGain != null || result.exp != null;
    const exp = Math.max(0, Math.round(Number(rewardExp != null ? rewardExp
      : (o.expGain != null ? o.expGain : (result.exp || 0))) || 0));
    let gained = 0;
    if (getExp) {
      if (exp > 0) {
        stopAt(getExp, 1);
        /* `exp` 才是那排位图数字（4315），`getExp` 自己只是外壳（照 `showFightResult`）。 */
        const digits = getExp.byName ? getExp.byName('exp') : null;
        if (t && digits) t.showNumber(exp, digits, 0, 0, 0);
        gained++;
      } else stopAt(getExp, 3);
    }
    /* `maxlevel` 的每一帧都烤着一条**具体**文案（f1 说的是"本关经验已在上次掉线前获得"）——
     * 只有真的知道"这一场经验是 0"时才敢用 f1/f2，否则一律走 **f4（不带文案）**，
     * 免得给玩家看一句和这一场无关的话。 */
    if (maxlevel) stopAt(maxlevel, exp > 0 || !expKnown ? 4 : 1);
    if (shoutu) stopAt(shoutu, 3);
    /* 奖励格：金松果（结算 + 战斗中飘到的合并）+ 本场悬浮物品。
     * 负场（frame 3）没有 `c2/num1`，按当前帧真的存在的格子依次摆，不能因为缺一格
     * 就把后面的物品吞掉。 */
    const items = (loot && loot.items) || [];
    let gold = Math.max(0, Math.round(Number(reward && reward.gold) || 0));
    const picks = [];
    for (const item of items) {
      if (!item || item.id == null) continue;
      const count = Math.max(1, Math.round(Number(item.count) || 1));
      if (Number(item.id) === 8) { gold += count; continue; }
      picks.push({ id: item.id, name: item.name, count });
    }
    const rewards = [];
    if (gold > 0) rewards.push({ id: 8, name: '金松果', count: gold });
    rewards.push(...picks);
    const cells = [['c1', 'num'], ['c2', 'num1'], ['c3', 'num3']];
    const slots = cells.map(([cellName, numName]) => ({ cell: view.byName(cellName), num: view.byName(numName) }))
      .filter((slot) => slot.cell);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i], it = rewards[i];
      if (slot.cell) stopAt(slot.cell, it ? 1 : 2);     // 2 = 空槽（原版 `mc.c1.gotoAndStop(2)`）
      if (slot.num) visible(slot.num, !!it);            // 空槽时把「-0000」整条收掉
      if (it && slot.num) {
        const digits = slot.num.byName ? slot.num.byName('num') : null;
        const sign = slot.num.byName ? slot.num.byName('addOrReduce') : null;
        if (sign) stopAt(sign, 2);                      // 2 = "加"（原版 `addOrReduce.gotoAndStop(2)`）
        if (t && digits) t.showNumber(Math.max(1, Math.round(Number(it.count) || 1)), digits, 0, 0, 0);
      }
      /* 格子里的道具图（原版 `attachMovie(<道具名>, "mc", 100)`）。 */
      if (it && slot.cell && slot.cell.detachAll) { slot.cell.detachAll(); attachLootIcon(slot.cell, it); }
      if (it) gained++;
    }
    if (prizeBackg && gained === 0) stopAt(prizeBackg, 2);
  }

  /* ---------- 开宝箱：`showLottery1` / `showLottery2` / `showPrize` ----------
   * 逐条照 `MainMovie.as:18595-18702`，元件结构照导出实测：
   *   · `fight.gotoAndStop(5)` → `openChest`(7771) 第 1 帧：四格 `k1..k4`(7767) + 四块
   *     `b1..b4`(7769) + 提示文本 `text0`(7770，素材自带"选择一个宝箱作为奖励 !")。
   *   · **选择阶段（state 4）**：`myDraw()` 每拍 `showButton(rewardButtons, jiantou_WZ_X1-1)`
   *     → 四格 `gotoAndStop(选中 ? 2 : 1)`。`7767` 的两帧是**两套完全不同的元件**：
   *     第 1 帧 `k`=7751（普通箱子）+ `count`=7752；第 2 帧 `k`=7765（箱子 + 三个"?"的问号
   *     提示）+ `count`=7766 —— 这就是原版的"选中高亮"，不是变色。
   *   · **开箱（`showLottery1`）**：四块 `b` 一起 `gotoAndPlay(2)`（7769 的箱子缩放动画，
   *     第 5 帧 `stop()`），四格的 `k` 子元件也一起 `gotoAndPlay(2)`：`7751`/`7765` 都是
   *     10 帧，**第 10 帧才摆出 `c1`(3414) 这个奖品槽**并 `stop()`；选中的那颗是 `7765`，
   *     它的第 10 帧帧脚本就是 `_root.showLottery2()` —— 所以"开箱"这一下是**动画自己**收尾的。
   *   · **揭晓（`showLottery2`）**：`openChest.gotoAndStop(2)`（多出确定键 `3152` + `4659`）、
   *     `text0 = "恭喜你获得"`，然后逐格 `showPrize(格子的 k, 格子的 count, 奖品, 是否选中)`：
   *     `mc.c1.attachMovie(<奖品名>, "mc", 0, {0,0})` + `textMc.text = "X" + count` +
   *     `mc.c1.gotoAndStop(2)`（第 2 帧是空帧，把占位图 `2443` 收掉、只留挂上去的奖品图）。
   *     奖品分配照原版：**先 `lotArray.shift()` 取第一件给选中的那一格**，其余按格子顺序
   *     依次取剩下的 —— 所以"选哪一格"只决定谁拿第一件，不会选空。
   *   · **收尾（state 5）**：按一下 fire → `setState(2)`（复刻这边等价于点任意位置 / 超时）。 */
  /** 宝箱四选一的**稳定热区层**（2026-10 修复 iOS 点第二个及以后箱子没反应）。
   *
   * 原实现把 `mouseenter` / `click` 直接挂在四颗 `k`(7767) 的 `<g>` 上。iOS 的轻点会先合成
   * `mouseenter`（相当于一次悬停），而那个回调里 `paint()` 会立刻 `gotoAndStop` 重建这颗
   * `k` 的子元件 —— 触点下的 DOM 在事件派发中途被换掉，WKWebView 有时就不再补发 click：
   * 画面停在“选择一个宝箱”，看起来就是卡死。左数第一个箱子本来就是选中帧（`paint()` 是
   * 空操作、不重建 DOM），所以只有它不是第一个时才触发。
   *
   * 现在把热区画在一层**不随宝箱换帧重建**的透明 `<rect>` 上（挂在视图 `<svg>` 根、压在
   * 所有画稿之上），悬停/按下/抬起/click 都只和这层打交道；`pointerup` 与 `touchend` 都
   * 能直接提交选择，不再依赖 iOS 是否补发 click。热区坐标用 `SfRender.svgScreenMap()` 从
   * 屏幕坐标折回 viewBox（它已经处理了全面屏 x/y 缩放不一致，不能用 `getScreenCTM`）。
   * 选完（或视图销毁）整层移除，不会挡住后面的“确定”键。 */
  function mountChestHitLayer(view, keys, handlers) {
    const svg = view && (view.g || view.el);
    if (!svg || !svg.ownerDocument || typeof svg.appendChild !== 'function') return null;
    const NS = 'http://www.w3.org/2000/svg';
    let map = null;
    try { map = window.SfRender && SfRender.svgScreenMap ? SfRender.svgScreenMap(svg) : null; } catch (e) { map = null; }
    let box = null;
    try { box = svg.viewBox && svg.viewBox.baseVal; } catch (e) { box = null; }
    if (!box || !(box.width > 0) || !(box.height > 0)) box = { x: 0, y: 0, width: 320, height: 196 };
    const toUser = (cx, cy) => {
      if (map && map.toUser) return map.toUser(cx, cy);
      const r = svg.getBoundingClientRect();
      const s = Math.min(r.width / box.width, r.height / box.height) || 1;
      const ox = r.left + (r.width - box.width * s) / 2;
      const oy = r.top + (r.height - box.height * s) / 2;
      return { x: box.x + (cx - ox) / s, y: box.y + (cy - oy) / s };
    };
    const layer = document.createElementNS(NS, 'g');
    layer.setAttribute('class', 'sf-chest-hits');
    /* `getBoundingClientRect()` 在个别 iOS 首帧还没布局时会返回 0；这里按 7771 第 1 帧
     * 四颗 k 的固定放置矩阵（x = 160 + [-98.3,-32.4,33.4,99.25]，0.49 缩放）留一张
     * 兜底表。它只在量不到的时候用，不改变正常布局。 */
    const FALLBACK = [
      { x: 28.85, y: 75.78, w: 65.69, h: 87.87 },
      { x: 94.75, y: 75.78, w: 65.69, h: 75.10 },
      { x: 160.55, y: 75.78, w: 65.69, h: 75.10 },
      { x: 226.40, y: 75.78, w: 65.69, h: 75.10 },
    ];
    const hits = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!k || !k.g) continue;
      let r = null;
      try { r = k.g.getBoundingClientRect(); } catch (e) { r = null; }
      let x = 0, y = 0, w = 0, h = 0;
      if (r && r.width > 0 && r.height > 0) {
        const a = toUser(r.left, r.top), b = toUser(r.right, r.bottom);
        x = Math.min(a.x, b.x) - 3; y = Math.min(a.y, b.y) - 3;
        w = Math.abs(b.x - a.x) + 6; h = Math.abs(b.y - a.y) + 6;
      }
      if (w <= 2 || h <= 2) {
        const f = FALLBACK[i];
        x = f.x; y = f.y; w = f.w; h = f.h;
      }
      const hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', x.toFixed(2));
      hit.setAttribute('y', y.toFixed(2));
      hit.setAttribute('width', w.toFixed(2));
      hit.setAttribute('height', h.toFixed(2));
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('pointer-events', 'all');
      hit.setAttribute('role', 'button');
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('aria-label', '选择第' + (i + 1) + '个宝箱');
      hit.style.cursor = 'pointer';
      hit.style.outline = 'none';
      hit.style.webkitTapHighlightColor = 'transparent';
      layer.appendChild(hit);
      hits.push({ hit: hit, index: i });
    }
    if (!hits.length) return null;
    svg.appendChild(layer);
    let down = null, touch = null;
    const pick = (i, event) => {
      if (event) {
        if (event.stopPropagation) event.stopPropagation();
        if (event.cancelable && event.type !== 'keydown') { try { event.preventDefault(); } catch (e) {} }
      }
      if (handlers && typeof handlers.pick === 'function') handlers.pick(i);
    };
    for (const { hit, index } of hits) {
      hit.addEventListener('pointerenter', () => {
        if (handlers && typeof handlers.hover === 'function') handlers.hover(index);
      });
      hit.addEventListener('pointerdown', (event) => {
        if (event.button != null && event.button !== 0) return;
        down = { id: event.pointerId, x: event.clientX, y: event.clientY, t: Date.now() };
      });
      hit.addEventListener('pointerup', (event) => {
        if (!down) return;
        if (down.id != null && event.pointerId != null && down.id !== event.pointerId) return;
        const dx = event.clientX - down.x, dy = event.clientY - down.y;
        const moved = Math.sqrt(dx * dx + dy * dy), dt = Date.now() - down.t;
        down = null;
        if (moved <= 14 && dt <= 900) pick(index, event);
      });
      hit.addEventListener('pointercancel', () => { down = null; });
      hit.addEventListener('touchstart', (event) => {
        const t = event.changedTouches && event.changedTouches[0];
        if (t) touch = { x: t.clientX, y: t.clientY, t: Date.now() };
      }, { passive: true });
      hit.addEventListener('touchend', (event) => {
        const t = event.changedTouches && event.changedTouches[0];
        if (!t || !touch) return;
        const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
        const moved = Math.sqrt(dx * dx + dy * dy), dt = Date.now() - touch.t;
        touch = null;
        if (moved <= 14 && dt <= 900) pick(index, event);
      }, { passive: false });
      hit.addEventListener('touchcancel', () => { touch = null; });
      hit.addEventListener('click', (event) => pick(index, event));
      hit.addEventListener('keydown', (event) => {
        if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); pick(index, event); }
      });
    }
    return {
      remove: () => { if (layer.parentNode) layer.parentNode.removeChild(layer); },
    };
  }

  async function openChest(rec, loot) {
    const view = rec.view;
    if (!view) return;
    const winner = Number(rec.result && rec.result.winner) === 1 ? 1 : 0;
    stopAt(view, F.chest);
    const chest = view.byName('openChest');
    if (!chest) return;
    /* 7771 第 1 帧的背景是 7748_0.jpg（欢庆胜利那张）；负场还沿用就会在开宝箱页
     * 看到胜利 CG。原版负场战果用的是 7741（垂头丧气），这里把宝箱页的背景位图
     * 换成同一张 7741_0.hd.jpg。只改背景 pattern，不动宝箱/按钮。 */
    if (winner === 1) {
      try {
        const root = view.g || view.el;
        const imgs = root && root.querySelectorAll ? root.querySelectorAll('image') : [];
        for (const img of imgs) {
          const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
          if (href.indexOf('7748_0') < 0) continue;
          img.setAttribute('href', 'images/ssfight/ui/bitmap/7741_0.hd.jpg');
          img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'images/ssfight/ui/bitmap/7741_0.hd.jpg');
        }
      } catch (e) {
        if (window.__errs) window.__errs.push('chest defeat bg: ' + (e && (e.stack || e.message) || e));
      }
    }
    const keys = [1, 2, 3, 4].map((i) => chest.byName('k' + i));
    const boards = [1, 2, 3, 4].map((i) => chest.byName('b' + i));
    const text0 = chest.byName('text0');
    /* `showButton(rewardButtons, idx)`：选中的那一格拨到第 2 帧，其余第 1 帧。 */
    let sel = 0;
    const paint = () => keys.forEach((k, i) => { if (k) stopAt(k, i === sel ? 2 : 1); });
    paint();
    await wait(260);
    if (rec.stopped) return;
    /* `phase = 'chest'` 要在**箱子可点之后**才置位：`pickChest` 靠 `rec.chestPick` 生效，
     * 提前置位会让探针在"还不能点"的那 260ms 里点到空气（第一次跑就是这么挂的）。 */
    rec.phase = 'chest';
    const picked = await new Promise((resolve) => {
      let done = false, layer = null;
      const finish = (i) => {
        if (done) return;
        done = true;
        if (layer) layer.remove();
        resolve(Math.max(0, Math.min(3, Number(i) || 0)));
      };
      /* 热区挂在不随 k1..k4 换帧重建的独立层上（见 mountChestHitLayer 的注释）。
       * 悬停只挪选中帧；真正提交同时接 pointerup / touchend / click，任何一条先到都算数。 */
      layer = mountChestHitLayer(view, keys, {
        hover: (i) => { if (!done && i !== sel) { sel = i; paint(); } },
        pick: (i) => finish(i),
      });
      rec.chestPick = finish;
    });
    if (rec.stopped) return;

    /* ---- `showLottery1(wz)`：四块 `b` + 四格 `k` 一起播 ----
     * 每一条都要**各自停在自己的末帧**（导出里没有帧动作，`stop()` 得由这里补）：
     * `7769`(b) 末帧 = 第 **5** 帧、`7751`/`7765`(k) 末帧 = 第 **10** 帧（`c1` 奖品槽就在这一帧）。
     * ⚠ `7769` 的第 5/6 帧是**空帧**：`playClip` 的缺省停帧会按 `lastContentFrame` 停到第 4 帧，
     *   而第 4 帧正好是箱体炸开的两条棕色碎片 —— 四格翻奖时它们会一直插在奖品图标上
     *   （用户 2026-11 口径："宝箱图标没有完全消失，留了一部分在上面"）。这里必须显式停第 5 帧。 */
    for (const b of boards) if (b) playClip(b, { stop: 5 });
    const opening = [];
    const inners = keys.map((k, i) => {
      if (!k) return null;
      stopAt(k, i === picked ? 2 : 1);
      const inner = k.byName('k');
      if (inner) opening.push(playClip(inner, { stop: 10 }));
      return inner;
    });
    /* 选中的那颗 `7765` 停在第 10 帧时，帧脚本就是 `_root.showLottery2()` —— 四颗一样长，
     * 所以等它们全部停住即可。
     * ⚠ 兜底：`playClip` 靠 rAF 观察帧号；iOS WKWebView 在触摸/合成层切换时可能长时间
     *   不派发 rAF，`Promise.all` 就永远不 resolve（玩家看到的是选完箱子后停住）。这里给它
     *   一个 2.5s 上限，超时后显式把四颗 k 停到第 10 帧（奖品槽那一帧），照常揭晓。 */
    let opened = true;
    if (opening.length) {
      opened = await Promise.race([
        Promise.all(opening).then(() => true),
        wait(2500).then(() => false),
      ]);
    } else {
      await wait(900);
    }
    if (rec.stopped) return;
    if (!opened) {
      for (let i = 0; i < keys.length; i++) {
        const inner = keys[i] && keys[i].byName ? keys[i].byName('k') : null;
        if (inner && inner.frameCount) stopAt(inner, Math.min(10, inner.frameCount()));
      }
    }

    /* ---- `showLottery2()`：翻奖 ----
     * ⚠ 原版这四格的内容是服务端 `flash/lottery.do` 下发的 `fightResult.lotArray`
     *（`lottery()` :3575-3607 解析成 `{id, count, lotteryed}`，**永远是 4 件**），
     * 与战斗中飘出来的 `prop` 是**两份东西**：飘的是即时掉落（`doGetProp`），
     * 宝箱这一份是"四选一"，只有选中的那件会 `addProp` 进背包（`showPrize` 的 `isPrize` 分支）。
     * 复刻以前直接把"战斗中收下的掉落"塞进这四格 —— 掉落最多 3 件、玩家没接住的更少，
     * 于是**每次都会有一格空着**（用户 2026-11 口径："总会有一些奖品没有正常显示，贴图有问题"）。
     * 现在照原版重新抽一包 4 件（同一个掉落池、同一套权重，见 `BattleDrops.poolFor`），
     * 四格都有奖品；玩家选中的那件按原版口径**入账**（另外三件只是展示）。 */
    stopAt(chest, 2);
    const items = planChestPrizes(rec.o ? rec.o.kind : 'challenge', rec.o ? rec.o.dropRandom : null, loot.items);
    const first = items[0] || null;
    let rest = items.slice(1);
    let label = '';
    if (text0) setText(text0, '恭喜你获得');
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!k) continue;
      const isPrize = i === picked;
      /* 选中的那一格拿第一件；其余按顺序取剩下的（照 `showLottery2` 的 `lotArray.shift()`）。 */
      const it = isPrize ? first : rest.shift();
      if (!it) continue;
      const inner = inners[i] || k.byName('k');
      const slot = inner && inner.byName ? inner.byName('c1') : null;
      const n = Math.max(1, Math.round(Number(it.count) || 1));
      if (slot) {
        if (slot.detachAll) slot.detachAll();
        attachLootIcon(slot, it);
        stopAt(slot, 2);
      }
      const cnt = k.byName ? k.byName('count') : null;
      if (cnt) setText(cnt, 'X' + n);
      if (isPrize) {
        label = ' ' + (it.name || it.label || '奖励') + '×' + n;
        grantChestPrize(rec, it, loot);
      }
    }
    if (text0 && label) setText(text0, '恭喜你获得' + label);

    /* 翻奖之后要**等玩家点一下**才继续（原版 `state == 5` 按 fire → `setState(2)`）。
     * 那一页的「确定」是画在帧里的形状、没有实例名（3152 底 + 4659 字），所以这里给它
     * 补一块真正的热区 + 经典界面通用的悬停/按下反馈；否则点上去毫无反应。
     * ⚠ 用户 2026-11 口径："开宝箱后的界面不许自动回退到随机挑战页" —— 不再挂 3.2s 兜底
     * 定时器，必须由玩家点「确定」或点这一层其它位置才继续。 */
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      const g = (chest.g || chest);
      if (g && g.addEventListener) g.addEventListener('click', (event) => {
        /* 点在「确定」那颗反馈壳里时交给它自己处理（它有 120ms 按下动画）；
         * 其余位置照旧"点哪都继续"。 */
        if (event && event.target && event.target.closest && event.target.closest('.sf-chest-confirm')) return;
        finish();
      });
      try { mountChestConfirm(chest, finish); } catch (e) { if (window.__errs) window.__errs.push('chest confirm: ' + (e && e.message)); }
      rec.confirmChest = finish;
    });
  }
  /** 宝箱页的「确定」是 7771 第 2 帧里的两块**形状**（3152 底 / 4659 字），没有实例名。
   *  把它们挪进一个反馈壳，按原版按钮的位置补一块透明热区；点下去走 `SfUiFeedback.tap`，
   *  120ms 的按下动画后 resolve —— 与经典界面其它键同款反馈（没有自动超时，必须玩家点）。 */
  function mountChestConfirm(chest, finish) {
    if (!chest || !chest.nodes) return null;
    const NS = 'http://www.w3.org/2000/svg';
    const picked = [];
    for (const [depth, rec] of chest.nodes) {
      if (rec && ['3152', '4659'].includes(String(rec.id))) picked.push({ depth, rec });
    }
    if (!picked.length) return null;
    picked.sort((a, b) => a.depth - b.depth);
    const host = chest.getContentHost ? chest.getContentHost() : chest.g;
    if (!host) return null;
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', 'sf-feedback sf-chest-confirm');
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', '确定');
    /* CSS 的 transform-origin:center 对 SVG 默认按 view-box 算；改成 fill-box 才会绕
     * 这颗按钮自己的包围盒中心缩放（否则整颗会从屏幕中心甩出去）。 */
    group.style.transformBox = 'fill-box';
    group.style.transformOrigin = 'center';
    /* 鼠标点这颗 SVG 按钮时 Chrome 会把它设为 activeElement 并画一圈 UA 蓝框
     * （用户 2026-11 口径："确定键点击后蒙上一层蓝色框"）。这颗键的点击反馈由
     * `.sf-feedback` 的按下 / 回弹承担，不要 UA 焦点框。 */
    group.style.outline = 'none';
    host.appendChild(group);
    for (const { rec } of picked) {
      const node = rec.wrap || rec.node;
      if (node) group.appendChild(node);
    }
    /* 3152 的路径包围盒约 -62..62 × -22..23，放置矩阵 0.47 + (-0.75,64.5) → 舞台
     * x≈-30..29、y≈54..75。热区比它略大一点，避免圆角边缘点不中。 */
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', '-31'); hit.setAttribute('y', '53');
    hit.setAttribute('width', '62'); hit.setAttribute('height', '23');
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('pointer-events', 'all');
    hit.setAttribute('data-hit', '1');
    group.appendChild(hit);
    if (window.SfUiFeedback) SfUiFeedback.bind(hit, { shell: group });
    const fire = (event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      if (window.SfUiFeedback) SfUiFeedback.tap(hit, finish, { delay: 120, press: true, pick: true });
      else finish();
    };
    hit.addEventListener('click', fire);
    group.addEventListener('keydown', (event) => {
      if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); fire(event); }
    });
    return group;
  }

  /** 宝箱那一包 4 件奖品（原版 `flash/lottery.do` 下发的 `fightResult.lotArray` 的等价物）：
   *  同一个掉落池、同一套权重（`BattleDrops.poolFor`），抽 4 次 —— 四格**永远都有奖品**，
   *  不会再有"某一格空着 / 贴图不对"（见 `openChest` 里那段说明）。
   *  没有掉落池（老包 / 塔战 `collectDrops:false`）时退回"这一场收下的掉落"，至少不白屏。 */
  function planChestPrizes(kind, random, fallback) {
    const pool = (window.BattleDrops && BattleDrops.poolFor) ? BattleDrops.poolFor(kind || 'challenge') : null;
    const rnd = typeof random === 'function' ? random : Math.random;
    const given = (fallback || []).slice(0, 4);
    if (!pool || !pool.length) return given;
    const total = pool.reduce((n, p) => n + Number(p.weight || 0), 0);
    if (!(total > 0)) return given;
    const out = [];
    const take = () => {
      let value = rnd() * total, hit = pool[pool.length - 1];
      for (const p of pool) { value -= Number(p.weight || 0); if (value < 0) { hit = p; break; } }
      return hit;
    };
    for (let i = 0; i < 4; i++) {
      /* 抽到重复的就再摇一次（最多 3 次）：四格摆出来三张 "经验" 很怪。
       * 池子小 / 权重集中时允许重复，不会死循环。 */
      let hit = take();
      for (let k = 0; k < 2 && out.some((x) => x.id === hit.id); k++) hit = take();
      out.push({ id: hit.id, name: hit.name, count: hit.count });
    }
    return out;
  }
  /** 把玩家选中的那一件按原版口径入账 —— `showPrize()` 只在 `isPrize` 那一支里 `addProp`/加经验，
   *  另外三件纯展示。入账走 `BattleDrops.grant`（与悬浮掉落同一套规则、同一份存档写入）。 */
  function grantChestPrize(rec, prize, loot) {
    if (!prize || rec.chestPrize) return;
    rec.chestPrize = { id: prize.id, name: prize.name, count: prize.count };
    if (window.BattleDrops && BattleDrops.grant) {
      try { BattleDrops.grant([rec.chestPrize]); } catch (e) {}
    }
    /* 战果 / 录像里也要看得到这一件（`result.pickups` 与 `loot.items` 是同一个数组）。 */
    if (loot && Array.isArray(loot.items)) loot.items.push({ ...rec.chestPrize });
  }

  /** 数一棵子树里"已经贴上装备的挂点"（`onClip` 会给贴上容器的实例盖一个 `slot` 记号）。 */
  function countDressed(clip, seen) {
    if (!clip || !clip.nodes) return 0;
    const mark = seen || new Set();
    if (mark.has(clip)) return 0;
    mark.add(clip);
    let n = 0;
    for (const rec of clip.nodes.values()) {
      if (!rec.clip) continue;
      if (rec.clip.g && rec.clip.g.getAttribute && rec.clip.g.getAttribute('slot')) n++;
      n += countDressed(rec.clip, mark);
    }
    for (const c of clip.__attached || []) {
      if (c.g && c.g.getAttribute && c.g.getAttribute('slot')) n++;
      n += countDressed(c, mark);
    }
    return n;
  }

  window.SfFight = Object.freeze({
    run,
    /** 正在播的那一场（调试 / 回归用）。`phase`：fight = 回合演出中 / result = 战果页 / chest = 开宝箱。 */
    active: () => (live ? { speed: live.speed, round: live.round, stopped: live.stopped,
      phase: live.phase || 'fight', chest: !!live.chestPick, names: live.names,
      /* `countdown` = 现在正打在开打倒计时（血条帧 8 里那颗 `3750` 的 3/2/1/GO）第几帧、
       * `weapon` = 两侧"这一拍手里那把武器"（`{id, level}`，null = 没在出手）。这两项是
       * "开打有没有 321GO" 与 "手里拿的是不是自己那把武器" 的第一手证据。 */
      countdown: live.countdown ? live.countdown.frame + 1 : 0,
      /* 当前这一拍是什么（`{action, id, attacker}`）；间隔 / 卡顿类问题的第一手证据。
       * `impact` = 这一拍的命中是走**出手动画的命中帧**（`hook`）还是播完之后补的（`fallback`）。 */
      cur: live.curRound ? { action: String(live.curRound.action || ''), id: Number(live.curRound.id) || 0, attacker: Number(live.curRound.attacker) || 0 } : null,
      impact: live.impactVia || null,
      weapon: live.fighters.map((f) => (f && f.weaponNow) ? { id: f.weaponNow.id, level: f.weaponNow.level } : null),
      /* `plans` / `dressed`：穿搭计划有没有建出来、格斗者身上到底贴上了几个挂点。
       * 这两项是"装备没穿上"这类问题的第一手证据（2026-11 用户口径：战斗中双方都是无装备）。 */
      shields: live.shields.slice(),
      plans: live.plans.map((p) => (p ? { slots: p.bySlot.size, holders: p.holders.size } : null)),
      dressed: live.fighters.map((f) => (f && f.mc ? countDressed(f.mc) : 0)),
      fighters: live.fighters.map((f) => (f ? Object.assign({ hp: f.blood.leftBlood }, f.debug()) : null)) } : null),
    /** 开宝箱那一步是**等玩家点**的（原版 `jiantou_WZ_X1` 选一个箱子再按 Fire）。
     *  这个入口给回归用例与探针用：等价于"玩家点了第 i 个宝箱"（0 基）。 */
    pickChest: (i) => { if (live && live.chestPick) { live.chestPick(Math.max(0, Math.min(3, Number(i) || 0))); return true; } return false; },
    /** 翻奖之后那一下"确定"（等价于玩家点了宝箱页任意位置）。 */
    confirmChest: () => { if (live && live.confirmChest) { live.confirmChest(); return true; } return false; },
    /** `run` 的同步骨架是否可用（调用方先探测再决定走不走经典战斗）。 */
    ready: () => !!(window.SfRender && window.State),
    SYM, FRAME: F, SIDE_MATRIX,
    /* 三侠动作表 / 图集（回归与探针用） */
    NPC_SHEETS: Object.freeze(NPC_SHEETS), NPC_ACTION: Object.freeze(NPC_ACTION), NPC_HIT_FRAME: Object.freeze(NPC_HIT_FRAME),
    _npcAnim: (npc, action) => npcAnimName(String(npc || ''), action),
    /* 纯函数（供 tools/*.cjs 直接核对映射规则） */
    _attackFrame: (r) => attackPlan(r).frame,
    /* 幻兽帧：`29 + petId` 与原版 `squirrelAttackConfig` 的 attackType 4 段。 */
    _petAttackFrame: (petId) => 29 + Math.max(1, Math.min(32, Number(petId) || 1)),
    _petDefenseFrame: (petId) => PET_DEFENSE_FRAME[Number(petId)] || -1,
    _defenseKind: (r, hasEquip, lvl, side) => defensePlan(r, hasEquip, lvl, side).kind,
    /* 手里的那把武器（`Squirrel.chooseWeapon` / `chooseWeaponGo` / `showWeaponSize` 三张表）：
     * `_weaponArt` = 这一拍的武器 id 该拨武器容器的第几帧（近战 / 投掷各一套），
     * `_weaponSize` = 那把武器自己按等级该拨第几帧。 */
    _weaponArt: (ranged, id) => {
      const t = ranged ? THROW_WEAPON_ART : MELEE_WEAPON_ART;
      return t.frames[Number(id)] || 0;
    },
    _weaponSize: (level) => WEAPON_SIZE_FRAMES[Number(level)] || 1,
    _defenseSkillFrame: (id, lvl) => defenseSkillFrame(id, lvl) || 0,
    /* 帧脚本表（同上；键 = 选择器帧号）。`_attackActs` 给"命中帧/防御技起手帧"，
     * `_floatKind` 给"这一档飘字用哪一帧模板 / 哪套字形"。 */
    _attackActs: (r) => ATTACK_ACTS[attackPlan(r).frame] || null,
    _floatKind: (kind) => FLOAT_KIND[kind] || FLOAT_KIND.hit,
    /* 这一拍受击方头顶该飘哪一颗状态图标（`Player.specialEffect` 的 statu 档位）。 */
    _effectStatu: (r) => effectStatu(r),
    WEAPON_ART: Object.freeze({ melee: MELEE_WEAPON_ART, ranged: THROW_WEAPON_ART, size: WEAPON_SIZE_FRAMES }),
    /* 幻兽协战的全部帧号（回归 / 探针用）：攻击帧 30..61 与受击帧 11..40。 */
    PET_FRAMES: Object.freeze({
      attack: PET_ATTACK_ACTS, defense: PET_DEFENSE_FRAME, art: '4280', slot: '3414',
    }),
    /* 开打倒计时 = 血条 HUD 第 8 帧里那颗原版 `3750`（不是自造元件，见 `playHudCountdown`）。 */
    COUNTDOWN: Object.freeze({ tag: COUNTDOWN_TAG, holder: '7703', holderFrame: HUD_STOP,
      frames: 41, endFrame: COUNTDOWN_END }),
    ACTS: Object.freeze({
      attack: ATTACK_ACTS, defense: DEFENSE_ACTS, defenseSkill: DEFENSE_SKILL_ACTS,
      dodge: DODGE_ACTS, attackBack: ATTACKBACK_ACTS, comeBack: COMEBACK_ACTS, hudStop: HUD_STOP,
    }),
  });
})();
