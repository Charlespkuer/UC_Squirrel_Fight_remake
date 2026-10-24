/* ============================================================================
 * js/ssfight/ui-main.js —— 原版**村庄主界面（main 帧）界面代码**的等价 JS【SFR2】
 *
 * 逐句对着原版 `MainMovie.as` 的 `showMain()` 翻（行号写在每段注释里），
 * 显示层用 `js/ssfight/render.js`（原版数据渲染），素材来自 `images/ssfight/ui/`。
 * **不照截图重画**：这里每一条赋值都能在原版 `.as` 里找到出处。
 *
 * 用法：
 *   const page = await SfUiMain.mount(container);   // 渲染村庄页 + 绑定当前存档 + 接按钮
 *   page.refresh();                                 // 数值变了再刷一次
 *   page.destroy();
 * ========================================================================== */
(function () {
  'use strict';

  /** 属性值转义（状态格图标的 title/aria-label 会用到）。 */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** 建 SVG 元素（动效壳 `<g class="uc-pop">` 用）。 */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs) => {
    const n = document.createElementNS(SVGNS, name);
    if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  };

  /* ---------- showNumber：MainMovie_frame1.as:5951-6042 的等价实现 ---------- */
  /* 原版用 mc["num1"…"numN"] 这排数字精灵显示数值：
   *   · 左边 rightMove 位显示"空"（= 该精灵的最后一帧）
   *   · 数字位 gotoAndStop(digit + 1 + type*10)，type 用来选第二套字形
   * 原版最后一处 `clips[i]._totalframes` 用的是 `i` 而不是 `i + rightMove`，
   * 看着像反编译出来的下标笔误；这里按**能正确清空该位**的写法来（用 i + rightMove），
   * 两者观感差别只在"该位原本有数字且要变空"的瞬间。 */
  function showNumber(num, mc, type, showZero, rightMove, numCount) {
    if (!mc || !mc.byName) return;
    if ((num === 0 || num == null) && showZero === 0) showZero = 1;
    if (numCount == null) numCount = 4;
    const str = String(num == null ? 0 : num);
    const len = str.length;
    if (rightMove == null || rightMove === 'right') {
      rightMove = numCount - len;
      if (num > 0) rightMove -= showZero;
    } else if (rightMove === 'left') {
      rightMove = 0;
    } else if (rightMove === 'center') {
      rightMove = ((numCount + len) % 2 === 0)
        ? (numCount - len) / 2
        : (numCount - (len + 1)) / 2 + 1;
      if (num > 0) rightMove -= showZero;
    }
    if (rightMove < 0) rightMove = 0;

    let digits = str.split('');
    const pad = numCount - digits.length;
    for (let i = 0; i < pad; ++i) digits.splice(0, 0, '0');
    /* 去前导零：showZero 允许保留几位 */
    let started = 0;
    for (let i = 0; i < digits.length; ++i) {
      digits[i] = Number(digits[i]);
      if (digits[i] === 0) {
        if (started === 0 && i + 1 > showZero) started = 1;
        if (started === 1) { digits.splice(i, 1); --i; }
        continue;
      }
      started = 2;
    }

    const clips = [];
    for (let i = 0; i < numCount; ++i) clips.push(mc.byName('num' + (i + 1)));
    for (let i = 0; i < rightMove; ++i) setFrame(clips[i], null);
    for (let i = 0; i < clips.length - rightMove; ++i) {
      const clip = clips[i + rightMove];
      if (i < digits.length) { setFrame(clip, digits[i] + 1 + type * 10); continue; }
      setFrame(clip, null);
    }
  }

  /** 数字精灵的"空白"= 最后一帧（原版 `_totalframes`）；frame 为 null 表示清空 */
  function setFrame(clip, frame) {
    if (!clip) return;
    let n = frame;
    if (n == null) {
      if (typeof clip.frameCount === 'function') n = clip.frameCount();
      else return;
    }
    if (typeof clip.gotoAndStop === 'function') clip.gotoAndStop(n);
  }

  /** 原版的 setText(文本框, 字符串)：把文本占位换成真实内容（村庄页用它写昵称）。
   *  ⚠ 换行必须交给显示层（`SfRender.setText`）：SVG 的 `<text>` **不会**把 `\r`/`\n` 当断行，
   *  自己写 `textContent` 的话多行文案会连成一行冲出字段框（祭坛那三行双倍几率就是这么坏的）。
   *  显示层认出来了就结束；认不出来（不是文本容器）才退回原来的写法。 */
  function setText(node, str, opts) {
    if (!node) return;
    if (window.SfRender && SfRender.setText && SfRender.setText(node, str, opts)) return;
    /* 兜底：一个文本标签可能带**多个 `<text>` 子节点**（多个 rs 段），要全改 ——
     * 只改第一个的话，剩下的还在显示原版占位串（实测就是这样漏出"玩家名字在这里"）。 */
    const list = node.querySelectorAll ? node.querySelectorAll('text') : null;
    if (list && list.length) {
      for (const t of list) t.textContent = str == null ? '' : String(str);
      return;
    }
    if (node.textContent !== undefined) node.textContent = str == null ? '' : String(str);
  }

  /* ============================================================
   * 【主界面昵称描边】用户 2026-10 本批 ⑩："为主界面的昵称加上一点黑色描边。"
   * ------------------------------------------------------------
   * 昵称是 `main`（7039）里那个文本字段 `name`（7018，框宽 100.65 / 字号 14 / **居中**）。
   * 原版那一格是**白字压在浅色天空上**，边缘发虚；这里只加一圈黑描边、不改字色与落点。
   * ⚠ `paint-order:stroke fill` **必须**写：不写的话描边会画在填充**之上**，
   *  笔画细的中文字会被描边"吃"掉笔画（观感是字变糊、变细），这是 SVG 文本描边的经典坑。
   * ⚠ 描边宽度按**渲染后的实际字号**折算（原来是 14 个舞台单位，屏幕上是 14 × 缩放倍数），
   *  写死 px 的话窗口一大描边就变细。`STROKE_RATIO` 是"描边宽 / 字号"，
   *  0.16 ≈ 原版那种"一点黑边"的分量，想再粗/再细直接调它。
   * ========================================================== */
  const NAME_STROKE = { ratio: 0.16, min: 1.4, color: '#000000' };
  function paintNicknameStroke(clip) {
    const node = clip && (clip.g || clip);
    if (!node || !node.querySelectorAll) return 0;
    /* 字号从**这个字段自己**量：屏幕墨高 / 舞台→屏幕倍数 = 舞台字号。
     * 量不到（还没画出来）就退回槽位上的 14（`textfields.json` 里 `7039.name` 的 fontH）。 */
    const svg = node.ownerSVGElement;
    const rect = svg && svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    const vb = svg ? String(svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number) : null;
    const unit = (rect && rect.width && vb && vb[2]) ? rect.width / vb[2] : 0;   // 1 舞台单位 = 多少屏幕 px
    let n = 0;
    for (const t of node.querySelectorAll('text')) {
      let font = Number(t.getAttribute('font-size') || 0);
      if (!(font > 0)) {
        const box = t.getBoundingClientRect ? t.getBoundingClientRect() : null;
        font = (box && box.height && unit) ? (box.height / unit) : 14;
      }
      const w = Math.max(NAME_STROKE.min, font * NAME_STROKE.ratio);
      t.setAttribute('stroke', NAME_STROKE.color);
      t.setAttribute('stroke-width', w.toFixed(2));
      /* `paint-order` 要同时写 CSS 与属性：Chrome 两条都认，属性那条在导出成图片时也留得住。 */
      t.setAttribute('paint-order', 'stroke fill');
      t.style.paintOrder = 'stroke fill';
      t.style.strokeLinejoin = 'round';
      n++;
    }
    return n;
  }

  /* ---------- 按钮 → 复刻版动作（原版是键盘驱动，这里按"现代适配"接鼠标） ---------- */  const BUTTON_ACTIONS = {
    button1: 'bag',        // 道具
    button2: 'status',     // 状态
    button3: 'challenge',  // 开始挑战
    button4: 'messages',   // 消息
    button5: 'system',     // 系统
    homeButton: 'village', // 村庄门（20 级才出现）
  };

  /* 徒弟栏的"后退一层"处理。用户 2026-10 口径：**上一版做重了**（saturate .78 + opacity .86
   * 看着发灰发虚），这里回调成很轻的一档 —— 只压一点点饱和与亮度，**不再动透明度**
   * （半透明会让徒弟和背景混在一起，反而更脏）。数值集中在这里，一句话就能再调。 */
  const PRENTICE_FX = { filter: 'saturate(.9) brightness(.97)' };

  /* 原版自带、**本来就该一直播**的装饰动画（白名单，见 `freezeDescendants`）：
   *   3586 —— 9 帧的浮动小图标，同时出现在**主界面右上角的村庄门**（`homeButton`，7140 里的 7041）
   *          和**村庄页的「回家」键**（`mainButton`）里。用户 2026-10 口径：
   *          "村庄 ui 本身的动态效果要保留，不要取消" —— 之前"整棵子树静音"把它一起冻住了。
   * 判据是**元件号**而不是实例位置：同一份素材出现在两处，一处漏了另一处也会漏。 */
  const KEEP_ANIMATED = new Set(['3586']);

  /* ============================================================
   * 给主角穿装备 —— 原版 MainMovie.as:6737 chooseEquipLoader / :6785 getEquipBpData
   *  · 角色身上散布着**几百个"挂点"空壳精灵**，每个挂点自己的 frame 1 脚本跑
   *    `_root.getEquipBpData(this, type, which)`，声明"我这儿该长哪件装备"；
   *  · 该长什么由 `constructBpData`（:6608）算：拿穿戴中那件的 `frame`，
   *    `容器[type][which].gotoAndStop(frame)`（容器 = 头B/外拳套B·内拳套B/衣服B·手臂B/鞋子B）；
   *  · 复刻没有 AS，所以改由 `render.js` 的 `onClip` 在**挂点实例化那一刻**接管。
   * 三张表都是生成器从原版抠出来的：tags-gear.json（容器素材）/ gear-frames.json（id→帧号）/
   * gear-slots.json（挂点 id→部位）。
   * ========================================================== */
  const GEAR_BASE = 'images/ssfight/ui/';
  const MY_SELF_ID = '6988';        // 村庄主角 myself 的精灵 id
  let slotPlan = null;              // Map<挂点精灵id, {symbol, frame}>

  /* 默认穿戴；dress=0 / 本地调试开关可以暂时隐藏装备。 */
  const DRESS_ENABLED = (() => {
    try {
      if (/[?&]dress=0\b/.test(location.search)) return false;
      if (localStorage.getItem('ssdz_classic_dress') === '0') return false;
    } catch (e) {}
    return true;
  })();
  /* 原版 c 版穿戴链路：B 容器在装备帧上生成位图，持有者停在 frame + 1，
   * 挂点按位图左上角接图。这里保留 1:1、topleft 和原挂点矩阵。
   * 容器号由 SWF 导出名核对，不能用错位的旧 TSV，更不能把大护肩换成普通袖口。
   * window.__gear 仅供本机取证覆盖。 */
  function gearOpts() {
    const o = { scale: 1, anchor: 'topleft', mode: 'slot', odx: null, ody: 0 };
    try {
      const q = window.__gear || {};
      if (q.scale != null) o.scale = Number(q.scale);
      if (q.anchor != null) o.anchor = q.anchor;
      if (q.mode != null) o.mode = q.mode;
      if (q.odx != null) o.odx = Number(q.odx);
      if (q.ody != null) o.ody = Number(q.ody);
    } catch (e) {}
    return o;
  }
  /* 每个部位的「画稿自身偏移」（**局部单位**，不是舞台单位）：锚点定下来之后，
   * 个别装备仍可能有自己的偏移，只能实测标定。0 = 不补。
   * ⚠ 2026-10 结论：上一批那两条"按部位/按装备"的偏移（type0 = [40,6]、117 = [-33,6]）
   * **是在补偿挂点取错帧**（holder 少了 +1）。+1 补上之后这两条一起清空，实测浣熊头套（73）
   * 与勇者头盔（117）都直接落在头上，不需要再补。今后真要补，仍按 id 单点写在这里。
   * 标定方法：`?dress=1&gear=<id>&type=<t>&odx=<局部x>&ody=<局部y>` 单件渲染扫量级，再写回表里。 */
  const GEAR_OFFSET_BY_ID = {};
  const GEAR_OFFSET = { 0: [0, 0], 1: [0, 0], 2: [0, 0], 3: [0, 0] };
  function gearOffset(type, gearId, go) {
    if (go && go.odx != null) return [Number(go.odx), Number(go.ody || 0)];
    const byId = GEAR_OFFSET_BY_ID[Number(gearId)];
    if (byId) return byId;
    const o = GEAR_OFFSET[type] || [0, 0];
    return (o[0] || o[1]) ? o : null;
  }
  /** `mode: 'attach'` —— 把 6 个容器**直接挂到 myself 自己身上**（原版 chooseEquipLoader 的写法），
   * 每个部位一个子 clip，帧号照旧。挂完不动 `render.js` 的帧机制（手动挂的子节点不进 nodes 表）。 */
  function attachWears(mainView, plan, host) {
    const me = mainView && mainView.byName && mainView.byName('main');
    const target = host || (me && me.byName && me.byName('myself'));
    if (!target || !target.attachChild) return 0;
    target.detachAll();
    const go = gearOpts();
    let n = 0;
    for (const p of plan) {
      const c = target.attachChild(p.symbol, p.frame, p.symbol);
      if (!c) continue;
      if (go.scale && go.scale !== 1) c.setExtraTransform('scale(' + go.scale + ')');
      n++;
    }
    return n;
  }

  /** 读两张映射表 + 把容器素材并进渲染器的标签字典（后者 1.8 MB，只在真要穿时加载）。 */
  async function loadGearTables() {
    if (slotPlan) return slotPlan;
    await SfRender.loadExtra('tags-gear.json');
    const j = (f) => fetch(GEAR_BASE + f, { cache: 'force-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [frames, slots] = await Promise.all([j('gear-frames.json'), j('gear-slots.json')]);
    if (!frames || !slots) return null;              // 缺表就老实不穿，别把整页拖挂
    /* 容器 id 从 gear-slots.json 的 container 声明里取（生成器同时写了名字与数字 id） */
    const containerIds = {};
    for (const c of slots.container || []) containerIds[c.type] = c.ids;
    /* 橙装（实例级 quality 4）沿用原版 q4 画稿帧：同部位同名字的 q4 套
     *（狂战 q3 frame 71 / q4 frame 113）—— 紫稿不再硬当橙稿用。 */
    const keyOf = (g) => Number(g.type) + '|' + String(g.name || '');
    const q4 = new Map();
    for (const g of frames.gear) if (Number(g.quality) === 4) q4.set(keyOf(g), g.frame);
    const orangeFrameById = new Map();
    for (const g of frames.gear) {
      if (Number(g.quality) !== 3) continue;
      const f = q4.get(keyOf(g));
      if (f) orangeFrameById.set(Number(g.id), f);
    }
    slotPlan = {
      frameById: new Map(frames.gear.map((g) => [Number(g.id), g.frame])),
      orangeFrameById: orangeFrameById,
      slots: slots.slots, holders: slots.holders || [], containerIds: containerIds,
    };
    return slotPlan;
  }

  /** 按当前存档里"穿戴中"的装备，算出：① 每个挂点该贴哪个容器的第几帧（slot 模式用）；
   *  ② 每个部位一条 {type, symbol, frame}（attach 模式用）。 */
  function planWears(tables) {
    if (!tables || !(window.State && State.state && State.state() && State.myGears)) return null;
    const CONTAINER = [['gearHead'], ['gearFistOut', 'gearFistIn'], ['gearBody', 'gearArm'], ['gearShoe']];
    const byType = new Map();
    for (const g of State.myGears()) {
      if (!g || !g.used) continue;
      const ty = Number(g.type);
      if (!byType.has(ty)) byType.set(ty, g);
    }
    if (!byType.size) return null;
    const bySlot = new Map();
    const parts = [];
    const holders = new Map();
    /* 帧号 = 装备帧号 + **强化等级加成**：原版构造容器那段的
     * `_loc.frame += (max(addr1Lv, addr2Lv, addr3Lv) - 1)`（有强化才加）。 */
    const frameFor = (g) => {
      const base = tables.frameById.get(Number(g.id));
      if (!base) return 0;
      const orange = g.orange === true || Number(g.quality) > 3;
      const of = orange && tables.orangeFrameById ? tables.orangeFrameById.get(Number(g.id)) : 0;
      /* 强化档必须取 `ext` **数组里的最大 level**：原版 `constructBpData` 用的是
       * `max(addr1Lv, addr2Lv, addr3Lv)`，而旧代码写的是 `Number(g.ext)` —— 数组转数字
       * 得到 NaN，整段强化偏移被吃掉，主界面一直贴**基础帧**；「我的装备」卡按
       * `gearColorId` 的 lv 档取**预上色符号**，两边颜色自然对不上。
       * 另外卡片对衣服 / 鞋子**不看强化档**（配色表只有头/拳套带 addr 档），主界面也照此：
       * type 2/3 只用品质帧，避免滑到下一档配色。 */
      const raw = g.ext;
      let extMax = Array.isArray(raw)
        ? raw.reduce((m, e) => Math.max(m, Number(e && e.level) || 0), 0)
        : Math.max(0, Number(raw) || 0);
      extMax = Math.max(0, Math.min(3, extMax));
      const addr = (Number(g.type) === 0 || Number(g.type) === 1) && extMax > 0 ? extMax - 1 : 0;
      return (of || base) + addr;
    };
    for (const [ty, g] of byType) {
      const fr = frameFor(g);
      if (!fr) continue;
      for (const which of [0, 1]) {
        const sym = tables.containerIds[ty] && tables.containerIds[ty][which];
        if (!sym) continue;
        parts.push({ type: ty, which: which, symbol: String(sym), frame: fr, quality: Number(g.quality) || 0 });
      }
    }
    /* 持有者：每个部位一个 189 帧的精灵，帧号 = **装备帧号 + 1**，每帧放一个挂点。
     * ⚠ 这个 +1 是原版的写法，不是凑数：`chooseEquipLoader`（MainMovie.as:6767）里
     *   version "c" 走的是 `mc.gotoAndStop(_loc1[type][0].frameIndex + 1)`，而
     *   `frameIndex` 就是 `constructBpData`(:6617/6636) 算出来的**容器帧号**。
     *   实测导出数据也印证：持有者 5433 的**第 1 帧是空的**，第 2 帧才是第 1 件装备的挂点
     *   （frames[0] = {d:1} 无 id；frames[1] = {d:1,id:5271,ma:-83.05,-69.45}）。
     *   少了这个 +1 就会**放出上一件装备的挂点** —— 贴图落点全体错一格，正是"装备贴图对不上"。
     * 不把它钉住的话它会自己播，每帧换一个挂点 → 装备在角色身上乱跳（脚部抖动的根源）。 */
    for (const h of tables.holders || []) {
      const g = byType.get(Number(h.type));
      const fr = g ? frameFor(g) : 0;
      if (fr) holders.set(String(h.id), fr + 1);
    }
    for (const s of tables.slots) {
      const g = byType.get(Number(s.type));
      const fr = g ? frameFor(g) : 0;
      if (fr) bySlot.set(String(s.id), { symbol: String(s.containerId), frame: fr, type: Number(s.type), gearId: Number(g.id), quality: Number(g.quality) || 0 });
    }
    if (!bySlot.size && !parts.length) return null;
    return { bySlot: bySlot, parts: parts, holders: holders, hasSlots: bySlot.size > 0 };
  }

  /** 这个 clip 是不是挂在主角 `myself`（6988）下面。 */
  function inMyself(clip) {
    for (let c = clip; c; c = c.parent) if (c.tag && String(c.tag.id) === MY_SELF_ID) return true;
    return false;
  }
  /* ============================================================
   * 顶栏两处微调（用户 2026-10 口径）
   * 数值不是拍脑袋：全部由无头探针量出「舞台坐标包围盒」再解出来的（见 docs 更新记录）。
   * 用 setExtraTransform 而不是改 tags.json —— 原版矩阵由父级每帧重写，
   * 附加段单独存、合成时接在后面，所以换帧不会被冲掉，也不会污染原版数据。
   * ========================================================== */
  /* ① 经验百分比：**数字 + 小数点 + % 号**一起处理。
   *   实测（改造前）：经验条 expMc y 33.8..44.6（中线 39.2）；数字 expNum y 34.7..46.2
   *   （中线 40.45）—— 数字比条还高，且整体沉下去 1.25。
   *   做法：在**父坐标系**（= 舞台坐标）里定一个目标映射 q' = s·q + c
   *     c_x = 右边缘 × (1−s) − PCT_DX   （数字右边缘 106.4 起步，再整体左移 PCT_DX）
   *     c_y = 39.2 − s × 40.45          （把中线从 40.45 搬到条中线 39.2）
   *   每个子节点自己的 base 是 (σ, t)，它的**局部位移** d = ((s−1)·t + c) / σ。
   *   用户 2026-10 追加口径：**百分号要单独放大**、整个百分数字再往左一点。 */
  const PCT_S = 0.92;                       // 数字与小数点的缩放
  const PCT_DX = 8;                         // 整组再往左挪（舞台单位）
  const PCT_RIGHT = 106.4;                  // 数字原来的右边缘（舞台 x）
  const PCT_CX = PCT_RIGHT * (1 - PCT_S) - PCT_DX;
  const PCT_CY = 39.2 - PCT_S * 40.45;
  const pctExtra = (sigma, tx, ty) => 'translate(' +
    (((PCT_S - 1) * tx + PCT_CX) / sigma).toFixed(3) + ',' +
    (((PCT_S - 1) * ty + PCT_CY) / sigma).toFixed(3) + ') scale(' + PCT_S + ')';
  /* 百分号（depth 310，形状，base 是单位矩阵）：**单独放大** PCT_PCT_S 倍，
   * 并把它自己的左沿（原版舞台 x=108）重新贴到"数字缩放+左移之后的右边缘"上，
   * 纵向按原版中线 39.05 → 条中线 39.2 对齐。 */
  const PCT_PCT_S = 1.22;
  const PCT_GLYPH_L = 108, PCT_GLYPH_CY = 39.05;
  const pctPctExtra = 'translate(' +
    ((PCT_RIGHT - PCT_DX) - PCT_GLYPH_L * PCT_PCT_S).toFixed(3) + ',' +
    (39.2 - PCT_GLYPH_CY * PCT_PCT_S).toFixed(3) + ') scale(' + PCT_PCT_S + ')';
  /* expNum = 数字本体；d311 = point（小数点）；d310 = % 号（形状，base 是单位矩阵） */
  const PCT_NUM = { name: 'expNum', sigma: 0.68, tx: 81.75, ty: 35.05 };
  const PCT_DOT = { depth: 311, sigma: 0.84, tx: 98.5, ty: 44.95 };
  const PCT_PCT = { depth: 310 };
  /* ② 金松果数字（num1..num8 八个独立数字精灵）：**整体上移一点**（用户 2026-10 本批口径）。
   *   沿革（每批只动下面这一个数）：
   *     · 第一百四十七批：`-2.2`（相对原版上抬 2.2 个舞台单位）
   *     · 第一百四十八批：`+2.6`（下沉，用户当批说"稍微下移"）
   *     · 本批（第一百四十九批）：`-1.0` —— 比上一批**上移 3.6 个舞台单位**
   *       （≈ 1170 宽画布下 13px），回到原版位置上方一点点。
   *   ⚠ 符号别写反：SVG 的 +y 是**向下**，所以"往下"是**正数**、"上移"是**负数**。
   *   base 是 scale 0.53 的纯平移 → 局部位移 = 舞台位移 / 0.53。 */
  const GOLD_NUM_DY_STAGE = -1.0;           // 负 = 上移；相对原版上抬 1.0 个舞台单位
  const GOLD_NUM_DY = (GOLD_NUM_DY_STAGE / 0.53).toFixed(3);
  /* ③ 体力数字（`energy` / `maxEnergy` 两个数字精灵）：**整组往左一点**（用户 2026-10 口径）。
   *   两个精灵的 base 都是 scale 0.75 的纯平移（`0.75,0,0,0.75,x,11.4`）→ 局部位移 = 舞台位移 / 0.75。
   *   整组一起挪：只挪一半的话 "100/142" 会被拆开、中间那个 "/" 就错位了。 */
  const ENERGY_DX_STAGE = -1.5;             // 负 = 往左（舞台单位）
  const ENERGY_DX = (ENERGY_DX_STAGE / 0.75).toFixed(3);
  /* ④ 昵称：按**现代界面**那套文字格式美化（用户 2026-10 口径）。
   *   现代是"暖白粗体 + 深棕描边/柔影 + 字距"（见 css/classic.css 的 `.home-name`：
   *   `#fffdf0 / font-weight:700 / letter-spacing:2px / text-shadow:0 2px 3px #3a1c04`）。
   *   原版这块是 SVG 里一段 SimHei 文本 —— 只加样式，**不动排版与落点**（落点由原版数据决定）。
   *   数值都按"舞台单位"给（SVG 的 1 用户单位 = 1 舞台单位，再由外层等比放大）。 */
  const NAME_STYLE = [
    "font-family:'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif",
    'font-weight:700',
    'fill:#fffdf0',
    'stroke:#4a290d',
    'stroke-width:.42',
    'stroke-linejoin:round',
    'paint-order:stroke fill',
    'letter-spacing:.4px',
    'filter:drop-shadow(0 .5px .55px rgba(58,28,4,.85))',
  ].join(';');
  function styleName(main) {
    const box = main.byName('name');
    if (!box || !box.querySelectorAll) return;
    for (const t of box.querySelectorAll('text')) {
      if (t.getAttribute('data-name-style') === '1') continue;   // 幂等：同一节点只写一次
      t.setAttribute('style', (t.getAttribute('style') || '') + ';' + NAME_STYLE);
      t.setAttribute('data-name-style', '1');
    }
  }
  function applyHudTweaks(main) {
    const ex = main.byName('expNum');
    if (ex && ex.setExtraTransform) ex.setExtraTransform(pctExtra(PCT_NUM.sigma, PCT_NUM.tx, PCT_NUM.ty));
    if (main.setDepthExtra) {
      main.setDepthExtra(PCT_DOT.depth, pctExtra(PCT_DOT.sigma, PCT_DOT.tx, PCT_DOT.ty));
      main.setDepthExtra(PCT_PCT.depth, pctPctExtra);
    }
    for (let i = 1; i <= 8; i++) {
      const c = main.byName('num' + i);
      if (c && c.setExtraTransform) c.setExtraTransform('translate(0,' + GOLD_NUM_DY + ')');
    }
    for (const n of ['energy', 'maxEnergy']) {
      const c = main.byName(n);
      if (c && c.setExtraTransform) c.setExtraTransform('translate(' + ENERGY_DX + ',0)');
    }
    styleName(main);
  }

  /* ============================================================
   * 生效中的药丸 → 主界面右上角三个状态格（原版 showStates）
   * ------------------------------------------------------------
   * 原版 `MainMovie.as:9414-9417 / 15859 showStates(mcArray, 0.71)`：
   * 先把 c1/c2/c3 全 `gotoAndStop(2)`（**空帧 —— 槽自己不画任何东西**），
   * 再把**生效中**的药丸按顺序 `attachMovie("大力丸2"…)` 挂进槽里、逐个 `_width/_height *= 0.71`。
   * 药丸库元件（"大力丸2" 等）是**运行时按名挂的**，不在静态闭包里 ——
   * 所以复刻用「道具图标」在槽上盖一层 DOM。
   *
   * ⚠ 2026-10 用户口径（本批）：**格子长相全面照现代版界面那套药丸来画**，
   *   只把**位置**留在原版槽位。现代版主界面那颗就是 `css/classic.css` 的 `.home-buff`：
   *   奶油白圆角块 + 金棕描边 + 内高光 + 白底金棕描边的"剩余场次"小圆牌（`.home-buff i`），
   *   图标 48px 填在 58px 的块里。现在 `.ssfight-state`（见 css/classic-refine.css）
   *   就是**逐条照抄那一套**，尺寸与位置由 `positionStateIcons` 按原版槽位算出来。
   *   顺带把原版那三个**槽自己**藏起来：原版 `gotoAndStop(2)` 是空帧、槽本来就什么都不画，
   *   而帧 1 那条金渐变描边形状以前一直露在图标外面当"底板"，正是用户觉得"丑"的那一层。
   * ========================================================== */
  const STATE_PILLS = [
    { id: 3, label: '大力丸' },
    { id: 4, label: '敏捷丸' },
    { id: 5, label: '速度丸' },
    { id: 7, label: '经验丸' },
    { id: 41, label: '超级大力丸' },
    { id: 42, label: '超级敏捷丸' },
    { id: 43, label: '超级速度丸' },
    { id: 44, label: '超级经验丸' },
  ];
  /* 槽的画稿边长（用户单位）。原版 c1/c2/c3 都是 3414，画稿 42.3×42.3。
   * 空槽停在**第 2 帧（空帧）**，`getBoundingClientRect()` 量出来是 0×0 ——
   * 所以槽的位置与大小只能算，不能量（量出来是 0 就把图标缩没了）。 */
  const STATE_SLOT = 42.3;
  /* 药丸块占槽的比例：块比原版那个格子略小一点，居中盖在槽上。
   * （现代版是 58px 的块装 48px 的图标 → 图标/块 = 0.83，下面那档也照这个来。） */
  const STATE_CHIP_RATIO = 0.76;
  /* 图标占**药丸块**的比例 —— 与 `.home-buff img` 的 48/58 = 0.83 同一档。 */
  const STATE_ICON_RATIO = 0.83;
  /* 图标源：道具图集。不引 classic-ui 的 atlasIcon：那个函数在 IIFE 里没导出。 */
  const STATE_ICON_BASE = 'images/ui/icons/prop/prop-';
  /* 上一次真正写进宿主 DOM 的那个签名。
   * ⚠ 这**不能**当成"当前该显示什么"的缓存 —— 它必须跟着宿主 DOM 一起失效。
   * 第一百五十批修的正是这个：切到现代模式再切回来，`.ssfight-home` 是新的（空的），
   * 而 `stateSig` 还记着上一棵树的内容，于是 `sig === stateSig` 直接 return，宿主永远是空的
   * （用户报的"多次切换模式之后药丸不显示"）。现在 `destroy()` 会把它清掉，
   * `renderStateIcons()` 也改成**两者都对得上**才跳过。 */
  let stateSig = '';
  /** 给宿主盖一个"里面装的是哪一版"的戳，供上面那条判断用。 */
  const STATE_STAMP = 'stateStamp';
  /** 从 placement 矩阵（`a,b,c,d,e,f`）里读「局部坐标 → 父级坐标」的换算。 */
  function placementOf(clip) {
    const m = String((clip && clip.g && clip.g.__baseMa) || '').split(',').map(Number);
    if (m.length === 6 && m.every((v) => isFinite(v))) return m;
    return [1, 0, 0, 1, 0, 0];
  }
  /** 某个节点在**它自己那一层**的缩放（base 矩阵的行列式开方；只含缩放不含旋转）。 */
  function localScale(clip) {
    const m = placementOf(clip);
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  }
  /** svg 的「用户单位 → 屏幕像素」比例：按根 viewBox 宽与实测宽算。
   *  ⚠ 不逐层乘矩阵：`getScreenCTM` 的参考系在根时间轴那几层里对不上父级坐标系
   *  （实测同一处会给出 0.95 倍的偏差），量出来偏大偏小都踩过。 */
  function unitScale(view) {
    const svg = view && view.root;
    if (!svg) return 0;
    const r = svg.getBoundingClientRect();
    const vb = String(svg.getAttribute('viewBox') || '0 0 320 196').split(/\s+/).map(Number);
    return (vb[2] && r.width) ? r.width / vb[2] : 0;
  }
  /** SVG 用户坐标 → 屏幕坐标：用 SVG 的实测矩形 + clientWidth/Height + viewBox +
   *  preserveAspectRatio 两轴分别反算。
   *  ⚠ 不走 getScreenCTM：iOS 15 的 WebKit 209220 会漏掉祖先 `#ui` 的 CSS scale，
   *  算出来的药丸/角标位置会整体缩到左上角。
   *  ⚠ 也**不能假设 x/y 缩放相同**：全面屏下 `#ui` 的 `sx !== sy`，只用一个比例
   *  会让药丸/角标左右对、上下错。`svgScreenMap()` 是显示层的同一套换算。 */
  function userToClient(svg, x, y) {
    try {
      const map = (window.SfRender && SfRender.svgScreenMap) ? SfRender.svgScreenMap(svg) : null;
      if (map) return map.toClient(x, y);
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (!r || !vb || !r.width || !r.height || !vb.width || !vb.height) return null;
      const par = String(svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
      const scale = /\bslice\b/.test(par) ? Math.max(r.width / vb.width, r.height / vb.height)
        : Math.min(r.width / vb.width, r.height / vb.height);
      if (!(scale > 0)) return null;
      const ax = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5;
      const ay = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
      return {
        x: r.left + (r.width - vb.width * scale) * ax + (x - vb.x) * scale,
        y: r.top + (r.height - vb.height * scale) * ay + (y - vb.y) * scale,
      };
    } catch (e) { return null; }
  }
  function stateIconsHost(container) {
    if (!container) return null;
    let host = container.querySelector('.ssfight-states');
    if (!host) {
      host = document.createElement('div');
      host.className = 'ssfight-states';
      host.setAttribute('aria-live', 'polite');
      container.appendChild(host);
    }
    return host;
  }
  /** 当前生效的药丸（propsStates>0），按 STATE_PILLS 的顺序，最多 3 个（原版就是 3 个槽）。 */
  function activeStatePills() {
    let states = {};
    try { states = (State.state() || {}).propsStates || {}; } catch (e) { return []; }
    return STATE_PILLS.filter((p) => states[p.id] > 0)
      .map((p) => ({ id: p.id, label: p.label, count: states[p.id] }))
      .slice(0, 3);
  }
  function renderStateIcons(container, view) {
    const host = stateIconsHost(container);
    if (!host) return;
    const pills = activeStatePills();
    const sig = pills.map((p) => p.id + ':' + p.count).join(',');
    /* 重建的判据是**签名 + 宿主自己的戳**都对得上才跳过。
     * 只看 `stateSig` 是不够的：宿主可能是刚建出来的新节点（切模式 / 重挂首页都会），
     * 那时签名没变、DOM 却是空的 —— 药丸就再也不显示了（见 stateSig 的注释）。 */
    if (sig !== stateSig || host.getAttribute(STATE_STAMP) !== sig) {
      stateSig = sig;
      host.setAttribute(STATE_STAMP, sig);
      host.innerHTML = pills.map((p) => '<span class="ssfight-state" data-pill="' + p.id + '" role="img"' +
        ' aria-label="' + esc(p.label + '：剩余 ' + p.count + ' 场战斗') + '"' +
        ' title="' + esc(p.label + '（剩余 ' + p.count + ' 场战斗）') + '">' +
        '<img alt="" src="' + STATE_ICON_BASE + p.id + '.png">' +
        '<b>' + p.count + '</b></span>').join('');
    }
    positionStateIcons(host, view);
  }
  /** 把药丸块摆到原版槽位上（**块中心 = 槽中心**），大小按 svg 的实测缩放比换算。
   *  ⚠ 坐标系里有个坑：`.ssfight-states` 这层是**按设计尺寸 1170 排版**的，
   *  而它外面套着 `#ui` 的 `--uiscale`（窗口适配用的等比缩放）。于是写进 `style.left/top`
   *  的 CSS 像素值会**再被乘一次** uiscale —— 直接用屏幕坐标写会整体偏右下约 1.07 倍
   *  （实测第三个格子因此被顶出容器的 `overflow:hidden`）。所以这里统一做**线性修正**：
   *  写进去的值 = 目标屏幕坐标 × (设计像素 ÷ 屏幕像素)。 */
  function positionStateIcons(host, view) {
    const main = view && view.byName ? view.byName('main') : null;
    const boxEl = (view && view.el) || (host && host.parentNode);
    if (!main || !boxEl || !host) return;
    const hostRect = host.getBoundingClientRect();
    const k = unitScale(view);
    if (!k) return;
    /* 宿主自身有没有被缩放：量一个 100px 的探针就知道（比逐层找 transform 稳）。
     * 探针量不出来（隐藏 / 布局未完成）时退回 1：那时块会按设计像素摆，
     * 略大一点但位置与对齐关系都对，比"整块缩没"或"跳到角落"好。 */
    const probe = stateLayoutProbe(host);
    const hostScale = probe.scale || 1;
    const fix = (screenPx) => (hostScale ? screenPx / hostScale : screenPx);
    const slots = ['c1', 'c2', 'c3'];
    host.querySelectorAll('.ssfight-state').forEach((el, i) => {
      const clip = main.byName(slots[i]);
      if (!clip || !clip.g) { el.style.display = 'none'; return; }
      /* 空槽停在**第 2 帧（空帧）**，直接量它的包围盒是 0×0（这点踩了很久）。
       * 所以位置从矩阵推：本层原点 → 父级坐标（ma）→ 屏幕（父级 `<g>` 的 CTM）。
       * 边长 = 画稿边长 × 「本层坐标 → 屏幕」的比例 = k × 父级本层缩放 × 本层缩放。
       * ⚠ 别拿 `getScreenCTM` 的行列式当总比例：实测 `main`（7039）那层的 base 矩阵是**单位矩阵**，
       * 混着乘会把格子量成 61px 或 383px（两种都踩过）。 */
      const m = placementOf(clip);
      const sx = sx0(clip), sy = sy0(clip);                     // 画稿原点在本层坐标里（导出数据就是 0）
      const px = m[4] + m[0] * sx + m[2] * sy;                  // → 父级坐标
      const py = m[5] + m[1] * sx + m[3] * sy;
      /* c1/c2/c3 的父级是 `main`（base 矩阵是单位矩阵），px/py 就是舞台用户坐标；
       * 走 userToClient 避开 iOS 15 漏掉 #ui scale 的 getScreenCTM。 */
      const p = (clip.parent === main && userToClient(view.root, px, py)) || toScreen(clip.parent, px, py);
      /* k 已经是「SVG 用户单位 → 屏幕像素」，所以 slotSide 本身就是屏幕像素；
       * 不要再乘 hostScale（那是 CSS→屏幕的缩放）。多乘一次会让药丸再缩小 0.55 倍。 */
      const slotSide = STATE_SLOT * k * localScale(clip.parent) * localScale(clip);
      if (!(slotSide > 0)) { el.style.display = 'none'; return; }
      /* 药丸块比原版那个格子小一档，**居中**盖在槽上（原版 `attachMovie` 的落点也是槽的原点，
       * 只是原版药丸自带留白；这里按包围盒对齐，看起来更稳）。
       * 都在屏幕像素里换算，最后统一走 `fix()` 折回设计像素，与 `--uiscale` 抵消。 */
      const side = slotSide * STATE_CHIP_RATIO;
      /* `side` 是**屏幕像素**目标；写进 DOM 的 width/height/--icon/--u 都是 CSS px，
       * 还要再被宿主自身的 `--uiscale` 乘一次。以前只对 left/top 做了 fix，宽高没除，
       * 安卓上宿主缩放约 0.55 时药丸会被缩成约 17px（用户报的“药丸过小”）。
       * 这里把三档尺寸统一折回设计像素，桌面 hostScale=1 时结果不变。 */
      const sideCss = fix(side);
      const cx = p.x + slotSide / 2, cy = p.y + slotSide / 2;
      el.style.display = '';
      el.style.left = fix(cx - hostRect.left - side / 2) + 'px';
      el.style.top = fix(cy - hostRect.top - side / 2) + 'px';
      el.style.width = sideCss + 'px';
      el.style.height = sideCss + 'px';
      /* 图标按 STATE_ICON_RATIO 缩一档（＝现代版 `.home-buff` 的 48/58）。
       * 块本身走 DOM 而不去拨 SVG 的帧：`refreshValues` 每秒都把 c1/c2/c3 拨回空帧。
       * `--u` 是"现代版 58px 那块"的换算单位（= 块边长 / 58）：CSS 里所有尺寸都写在
       * `.home-buff` 的原值 × `--u`，于是换窗口尺寸时配方不变、观感一致。 */
      const icon = sideCss * STATE_ICON_RATIO;
      el.style.setProperty('--icon', icon.toFixed(3) + 'px');
      el.style.setProperty('--u', (sideCss / 58).toFixed(4) + 'px');
    });
  }
  /** 量宿主自身被缩放的倍数（挂一个 100px 的探针进去量，量完就摘）。
   *  用探针而不是逐层找 `transform`：`#ui` 与 `.ssfight-home` 都可能带缩放，
   *  而且窗口适配时值会变，直接量"1 CSS px 画出来是多少屏幕 px"最不容易走样。 */
  function stateLayoutProbe(host) {
    /* renderStateIcons() 重建 innerHTML 时会把探针一起清掉；只检查 `host.__probe` 是否存在
     * 会把「已经 detach 的旧探针」继续拿来量，宽度永远是 0 → hostScale 回退成 1，
     * 安卓上药丸又缩回 17px。必须确认它仍然挂在当前 host 下。 */
    if (!host.__probe || host.__probe.parentNode !== host) {
      const p = document.createElement('div');
      p.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:0;pointer-events:none;visibility:hidden';
      host.appendChild(p);
      host.__probe = p;
    }
    const w = host.__probe.getBoundingClientRect().width;
    return { scale: w ? w / 100 : 1 };
  }
  /* 槽画稿（3414）的原点：`put` 出来的形状在 (0,0)–(42.3,42.3)，但父级那层矩阵把原点放在
   * 挂点的 (0,0) —— 实测导出数据的 ma 就是"画稿左上角"，所以原点偏移为 0，留个出口方便标定。 */
  function sx0(clip) { return clip && clip.__stateOrigin ? clip.__stateOrigin[0] : 0; }
  function sy0(clip) { return clip && clip.__stateOrigin ? clip.__stateOrigin[1] : 0; }
  /** 父级坐标 `(lx,ly)` → 屏幕坐标（优先用 CTM；拿不到就退回 svg 的矩形按比例估）。 */
  function toScreen(node, lx, ly) {
    const g = node && node.g;
    const ctm = g && g.getScreenCTM && g.getScreenCTM();
    if (ctm) return { x: ctm.a * lx + ctm.c * ly + ctm.e, y: ctm.b * lx + ctm.d * ly + ctm.f };
    return { x: lx, y: ly };
  }

  /* ---------- MainMovie.as:9374-9413 `showMain()` 的等价实现 ---------- */
  function refreshValues(view) {
    const main = view && view.byName ? view.byName('main') : null;
    if (!main) return false;
    if (!(window.State && State.state && State.state())) return false;
    /* 经典主界面没有服务端推送，也没有现代首页的 `drawHomeHud` 轮询；
     * 这里必须主动跑体力结算，否则停在主界面时体力永远不涨（用户 2026-10 报的
     * "体力永远不恢复"）。1s 一次的定时器会调用本函数，tickEnergy 内部按 5 分钟
     * 的间隔结算，重复调用是幂等的。 */
    if (State.tickEnergy) { try { State.tickEnergy(); } catch (e) {} }
    const S = State.state();
    const nextExp = Math.max(1, (window.GData && GData.nextExp) ? GData.nextExp(S.level)
      : (S.nextExp || 1));

    setText(main.byName('name'), S.name);                                    // :9378
    /* 昵称加一点黑色描边（用户 2026-10 本批 ⑩，见 `paintNicknameStroke` 的注释）。 */
    paintNicknameStroke(main.byName('name'));
    setFrame(main.byName('expMc'), Math.ceil(S.exp * 100 / nextExp) + 1);    // :9379
    const pct = Math.floor(S.exp * 1000 / nextExp);                          // :9380（千分比）
    /* ⚠ 经验数字写进的是 **main.expNum**（原版 :9385/:9389/:9393/:9397 传的都是 main.expNum）。
     * 第一版我误传了 `main`，结果经验数字写进了金松果那 8 个位、而 expNum 保持默认帧 → 显示成 "0000"。 */
    const expMc = main.byName('expNum');
    setFrame(main.byName('point'), 1);                                       // :9381
    if (pct === 1000) {                                                      // :9382-9386
      setFrame(main.byName('point'), 2);
      showNumber(100, expMc, 0, 0, 'right');
    } else if (pct > 9) {                                                    // :9387-9390
      showNumber(pct, expMc, 0, 0, 'right');
    } else if (pct > 0) {                                                    // :9391-9394
      showNumber(pct, expMc, 0, 1, 'right');
    } else {                                                                  // :9395-9399
      showNumber(pct, expMc, 0, 1, 'center');
      setFrame(main.byName('point'), 2);
    }
    const ePct = Math.ceil(S.energy * 100 / Math.max(1, S.maxEnergy));       // :9400
    setFrame(main.byName('energyMc'), ePct + 1);                             // :9401
    showNumber(S.energy, main.byName('energy'), 0, 0, 'right');              // :9402
    showNumber(S.maxEnergy, main.byName('maxEnergy'), 0, 0, 'left');         // :9403
    // :9404 原版是 getMyPropById(8).count（8 号道具＝金松果），复刻里就是 goldPoint
    showNumber(Math.max(0, S.goldPoint | 0), main, 0, 0, 'left', 8);
    showNumber(S.level, main.byName('level'), 0, 0, 'left');                 // :9405
    const door = main.byName('homeButton');                                  // :9406-9413
    if (door && door.style) door.style.display = S.level > 19 ? '' : 'none';
    /* :9430-9436 徒弟栏：按徒弟数切帧 —— 第 1/2/3 帧分别摆 1/2/3 个徒弟；
     * 没有徒弟 → 最后一帧（空）。徒弟栏自己停在这一帧，但每个徒弟子元件
     * （6941/6961/6981，31/56/91 帧）仍在按自己的时间轴自动循环 —— 背景的徒弟是动的。
     * 复刻的徒弟上限就是 3（State.apprenticeCap），与原版帧正好对齐。 */
    const pr = main.byName('prentices');
    if (pr && pr.gotoAndStop) {
      const n = Math.min(3, ((S.prentices || []).length) | 0);
      pr.gotoAndStop(n > 0 ? n : pr.frameCount());
    }
    /* 徒弟栏**压低一点存在感**（用户 2026-10 口径）：原版徒弟与主角同样明亮、同样饱和，
     * 看上去像和主角站在同一层。这里只做观感处理，不动帧逻辑（几徒弟 = 第几帧）。
     * 用 CSS filter 而不是叠一层半透明遮罩：徒弟是矢量，filter 不会改变轮廓与描边。
     * 两个数集中在这里，嫌重/嫌轻直接调。 */
    if (pr && pr.g) {
      pr.g.style.filter = PRENTICE_FX.filter;
      pr.g.style.opacity = '';
    }
    /* :9440-9464 showNewMessage：原版默认 gotoAndStop(2)＝隐藏红点，服务器说有新消息才 gotoAndStop(1)。
     * 复刻没有服务器推送，就**按自己的战斗记录判断**：最新一条的时间戳比"上次看过消息页"的时间新
     * 就点亮红点（用户 2026-10 要求给经典模式的「消息」加 new 功能）。
     * 用 localStorage 记"看到哪了"：换机器同步存档时红点会重新亮一次 —— 这是可接受的（它只是提示），
     * 也避免为这一个标记去改存档结构。 */
    const nm = main.byName('newMessage');
    if (nm && nm.gotoAndStop) nm.gotoAndStop(hasNewMessages() ? 1 : 2);
    /* :9414-9428 showStates(c1..c3)：原版是"三个槽先清空、再把生效中的药丸
     * attachMovie 进槽里并缩到 0.71"。复刻的槽清理照旧停在空槽帧（第 2 帧），
     * 图标改由 DOM 层叠在槽上（见 renderStateIcons）—— 库元件"大力丸2"等
     * 是运行时按名挂的，静态闭包里没有。 */
    /* :15947-15966 之外，原版 c1/c2/c3 停在空帧（第 2 帧）时**槽自己什么都不画**，
     * 但帧 1 那条"金渐变描边"形状在复刻里一直露在图标外面当底板 —— 那是用户觉得丑的那一层。
     * 药丸块改由 DOM 画（见 `.ssfight-state`）之后，把这三个槽整块藏掉：长相完全由现代版那套接管。 */
    for (const cn of ['c1', 'c2', 'c3']) {
      const c = main.byName(cn);
      if (c && c.gotoAndStop) c.gotoAndStop(2);
      if (c && c.g && c.g.style) c.g.style.display = 'none';
    }
    /* 药丸图标只在**主菜单页**（有 c1 的那一页）上画；村庄页的 homeMc 里没有这三个槽。 */
    if (main.byName('c1')) renderStateIcons(view.el, view);
    /* :15947-15966 showViplevel：非 VIP → gotoAndStop(2)（隐藏态）。
     * 复刻免费版没有 VIP（State.vipLevel() 恒 0）→ 永远停在隐藏帧。 */
    const vip = main.byName('viplevel');
    if (vip && vip.gotoAndStop) vip.gotoAndStop(2);
    if (vip && vip.style && window.State.vipLevel) {
      vip.style.display = State.vipLevel() > 0 ? '' : 'none';
    }
    /* constructMainMenu（MainMovie.as:6992-7020）：底栏按等级解锁 ——
     * 1 级只有「开始挑战」；2 级加「消息 / 系统」；3 级起全开（原版 bitArray 原样）。 */
    const bits = S.level <= 1 ? [0, 0, 1, 0, 0] : S.level === 2 ? [0, 0, 1, 1, 1] : [1, 1, 1, 1, 1];
    ['button1', 'button2', 'button3', 'button4', 'button5'].forEach((bn, i) => {
      const bc = main.byName(bn);
      const bnode = bc && (bc.g || bc);
      if (bnode && bnode.style) bnode.style.display = bits[i] ? '' : 'none';
      /* ⚠ 每次重刷（1s 一次）都要把这五键重新"静默"一遍：换帧会重建子树，新出生的装饰默认会自己播。
       * 但**指针正停在上面的那一颗不能动** —— 它的装饰正在放"选中"那一遍动画，
       * 拨回第 1 帧就等于动画每秒被打断一次（表现就是"悬停上去什么都没发生"）。 */
      if (bc && bc.gotoAndStop && !hoveredButtons.has(bn)) { if (bc.frame !== 0) { try { bc.gotoAndStop(1); } catch (e) {} } settleButton(bc); }
    });
    applyHudTweaks(main);            // 经验百分比 / 金松果数字的微调（幂等，每秒重设无副作用）
    /* 礼包/活动图标的有奖动效要跟着可领取状态走：领完奖回到主界面就停，不能一直闪。 */
    syncGiftVisibility(view && (view.el || view.g));
    syncGiftAttention(view && (view.el || view.g));
    updateEnergyTip(view);
    return true;
  }

  /** 主界面体力条悬停提示：距下次自然恢复 1 点体力还有多久。
   *  - 热区是一块透明 DOM（SVG 里的体力条在 UI 路由下 pointer-events 被关掉）；
   *  - 位置用 `stateLayoutProbe` 折回设计像素，外层 `--uiscale` 不会把它放大两次；
   *  - 文案每秒随 refreshValues 刷新；体力满/超出上限时明确说“不恢复”。 */
  function updateEnergyTip(view) {
    const host = view && view.el;
    const main = view && view.byName ? view.byName('main') : null;
    if (!host || !main || !host.isConnected) return;
    let hit = host.querySelector('.ssfight-energy-hover');
    let tip = hit && hit.querySelector('.ssfight-energy-tip');
    if (!hit) {
      hit = document.createElement('div');
      hit.className = 'ssfight-energy-hover';
      tip = document.createElement('span');
      tip.className = 'ssfight-energy-tip';
      tip.setAttribute('role', 'status');
      hit.appendChild(tip);
      host.appendChild(hit);
    }
    const nodes = ['energyMc', 'energy', 'maxEnergy']
      .map((n) => { const c = main.byName(n); return c && (c.g || c); })
      .filter(Boolean);
    if (!nodes.length) { hit.style.display = 'none'; return; }
    const hr = host.getBoundingClientRect();
    const hs = (stateLayoutProbe(host).scale) || 1;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    hit.style.display = '';
    hit.style.left = (((x0 - hr.left) / hs) - 2) + 'px';
    hit.style.top = (((y0 - hr.top) / hs) - 2) + 'px';
    hit.style.width = (((x1 - x0) / hs) + 4) + 'px';
    hit.style.height = (((y1 - y0) / hs) + 4) + 'px';
    const s = State.state();
    let text;
    if (s.energy > s.maxEnergy) text = '体力已超过自然上限（' + s.energy + '/' + s.maxEnergy + '），不会自然恢复';
    else if (s.energy >= s.maxEnergy) text = '体力已满';
    else {
      const cd = State.energyCountdown ? State.energyCountdown() : '';
      text = cd ? ('距离恢复 1 点体力还有 ' + cd) : '正在恢复体力…';
    }
    if (tip.textContent !== text) tip.textContent = text;
  }

  /** 把按钮接上复刻版的动作 + **原版 showButton 的悬停选中态**（MainMovie.as:5804-5835：
   *  按钮永远停在某一帧 —— 常态第 1 帧、选中第 2 帧；原版是键盘选中，这里按"现代适配"
   *  映射成鼠标悬停。绝不能让**按钮元件自己**播放：那 2 帧来回切就是用户看到的"图标闪烁"。
   *  点击额外闪一下选中帧（见 `pressFlash`），所以玩家点得动、也看得见反馈。
   *
   *  ⚠ 2026-10 用户口径（第一百四十六批）：**选中帧里的装饰动画要照原样播**。
   *  上一批为了"默认静默"把整棵子树 `freezeDescendants` 钉死，顺手把原版自带的
   *  悬停动效也冻住了 —— 比如「开始挑战」选中帧上那条金色飘带（元件 7004，14 帧上下浮动）、
   *  其余四键选中帧上的小标（6992/6997/7009/7014，12~14 帧）。
   *  这几个就是原版**唯一**的悬停动效（按钮只有"常态/选中"两个静态帧，
   *  动的是选中帧里挂着的装饰精灵），所以这里改成"只钉按钮自己的帧、放装饰自己播"：
   *  装饰一出生 `playing` 就是 true，不碰它即可。
   *  `freezeDescendants` 保留给**村庄页**那条路径（那边要的是静止的状态帧）。 */
  function wireButtons(view) {
    const main = view.byName('main');
    if (!main) return;
    /* 换帧会重建子树，热区要重铺。**已经有动效壳的**才重包（`popWrap` 会顺带补热区）；
     * 底栏五键原本没有壳，重包等于给它多加一层 CSS 悬停动效 —— 那不是本批要改的观感，
     * 所以只把原版那块固定热区补回去。 */
    const rewrap = (c) => {
      if (c && c.g && c.g.querySelector('g.uc-pop')) popWrap(c, true);
      else addHitArea(c, true);
    };
    /* 底栏五键的**固定选择面积**先算好（量所有帧的并集，会临时拨帧）——
     * 必须排在下面所有 `gotoAndStop` / `addHitArea` 之前，否则量到的是"当时那一帧"。 */
    setupHomeBar(main);
    for (const name in BUTTON_ACTIONS) {
      const clip = main.byName(name);
      const node = clip && (clip.g || clip);
      if (!node || !node.style) continue;
      if (clip.gotoAndStop) clip.gotoAndStop(1);          // 常态帧，停住
      settleButton(clip);                                 // 子树里那几颗装饰也一律静默（见 settleButton 的注释）
      node.style.cursor = 'pointer';
      node.style.pointerEvents = 'auto';
      measureHitBox(clip);
      /* 热区按**所有帧的并集**铺：这五键的四个帧是"常态/选中/禁用/空"，
       * 选中帧比常态帧大，只按一帧铺就会"鼠标一移上去，靠上的那截又点不到了"（用户 2026-10 原话）。
       * `addHitArea` 内部有缓存（`__frameBoxes`），下面两次重铺不会重新量。
       * 并集之外还会再往外放一圈（见 HIT_PAD）—— 用户第一百五十批口径"可点击面积太小"。 */
      addHitArea(clip, true);
      /* ⚠ 每次换帧（悬停进/出）都会重建这个元件的子树，**补的那块点击矩形会被一起清掉** ——
       * 于是"鼠标一移上去，点击区就只剩笔画"。所以两处 gotoAndStop 之后都要把点击区补回去，
       * 并把新出生的装饰重新静默 / 放一遍。 */
      node.addEventListener('mouseenter', () => {
        hoveredButtons.add(name);
        if (clip.gotoAndStop) { clip.gotoAndStop(2); settleButton(clip); rewrap(clip); playButtonDeco(clip); }
      });
      node.addEventListener('mouseleave', () => {
        hoveredButtons.delete(name);
        if (clip.gotoAndStop) { clip.gotoAndStop(1); stopPlayDecos(clip); settleButton(clip); rewrap(clip); }
      });
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        pressFlash(clip, 1, null);                        // 点一下：闪一遍"按下"态，再回常态
        if (window.UI && UI.runAction) UI.runAction(BUTTON_ACTIONS[name]);
      });
    }
  }
  /* ============================================================
   * 「消息」红点（new）
   * ------------------------------------------------------------
   * 原版由服务器推送决定；复刻按**自己的战斗记录**判断：最新一条比"上次看过消息页"的时间新 → 亮红点。
   * 这个"看到哪了"记在**存档**里（`State.msgSeenAt`，见 js/state.js 的 normalizeSave）。
   *
   * ⚠ 2026-10 用户口径：**以前记在 localStorage，必须改掉**。
   *   桌面壳（Tauri）每次启动的 WebView 都是一个新数据目录，localStorage 不跨次启动保留，
   *   于是"每次打开游戏消息必有 new"。落进 save/progress.json 之后换机器同步也一致。
   * ========================================================== */
  function newestMessageAt() {
    try {
      const list = (window.State && State.battleHistory) ? State.battleHistory() : [];
      return list && list.length ? (Number(list[0].createdAt) || 0) : 0;
    } catch (e) { return 0; }
  }
  function hasNewMessages() {
    const t = newestMessageAt();
    if (!t) return false;
    const seen = (window.State && State.msgSeenAt) ? State.msgSeenAt() : 0;
    return t > seen;
  }
  /** 打开消息页时调一次：把"看到哪了"推到最新（红点随即熄灭，并写进存档）。 */
  function markMessagesSeen() {
    try { if (window.State && State.markMessagesSeen) State.markMessagesSeen(); } catch (e) {}
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** 量一次并记住（用**常态帧**的包围盒）：悬停帧可能更大，跟着变会让点击区忽大忽小、边缘发飘。
   *  ⚠ 这里存的是 `{x,y,w,h}`；`addHitArea` 必须按同一套键名读 —— 2026-10 之前两边一个读
   *  `width/height`、一个存 `w/h`，于是 `!b.width` 永远为真、**整块点击区一个都没铺上**
   *  （表现就是用户说的"点击区还是没做好、靠上的部分点不到"：只剩笔画自己那几个像素能点）。 */
  function measureArtwork(clip) {
    const host = clip.getContentHost ? clip.getContentHost() : clip.g;
    const hits = Array.from(host.querySelectorAll('rect[data-hit]'));
    const displays = hits.map((hit) => hit.style.display);
    // A previous padded hit rect must never become the next measurement's artwork.
    for (const hit of hits) hit.style.display = 'none';
    try { return host.getBBox(); }
    finally { hits.forEach((hit, i) => { hit.style.display = displays[i]; }); }
  }
  function measureHitBox(clip) {
    if (clip.__hitBox) return clip.__hitBox;
    try {
      const b = measureArtwork(clip);
      if (b && b.width && b.height) clip.__hitBox = { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch (e) {}
    return clip.__hitBox || null;
  }
  /* ============================================================
   * 点击区（用户 2026-10 第一百五十批口径）
   * ------------------------------------------------------------
   * 需求原文："增大主界面中下面的道具、状态、开始挑战、消息、系统按钮的可点击面积，
   * 当前可点击面积太小了，没有覆盖到其上半部分。"
   * 沿革：第一百四十二批起就在补这块热区，但一直是"按元件包围盒**正好**铺一块"——
   * `getBBox()` 量的是**矢量轮廓**，圆形胶囊的包围盒虽然量得到，但胶囊的圆头、
   * 描边（`stroke` 会往外扩 stroke-width/2）以及悬停帧上那颗抬起的小图标都在这条线附近；
   * 加上 SVG 的 `visiblePainted` 只认着色像素，玩家在"看着像按钮"的上沿点下去经常落空。
   * 现在给并集**再加一圈 `HIT_PAD`**（比例 + 最小像素），热区比画稿略大一档 —— 只影响
   * `rect[data-hit]` 这个透明矩形，不改任何布局、不改可见像素。 */
  const HIT_PAD = 0.1;          // 相对并集的 10%
  const HIT_PAD_MIN = 2.5;      // 至少往外 2.5 个舞台单位
  /* ============================================================
   * 底栏五键：**固定选择面积**（用户 2026-10 口径）
   * ------------------------------------------------------------
   * 需求原文："主界面下面 5 个按钮的可选择面积还是没有设置好，一个是在其面积外也能选中，
   * 一个是在靠上的位置选中时，图标会一直闪，解决这个问题，并分配好固定的选择面积。"
   *
   * 两件事分开治：
   *  ① **面积固定**：先量每一颗在**所有帧**里的内容并集（常态帧小、选中帧大），
   *     换算到父级（`main`）坐标系；五颗共用一个纵向 band，横向按**相邻两颗的中点**切开 ——
   *     于是得到五块**互不重叠、也没有缝**的固定矩形。指针落在哪一块就归哪一颗，
   *     不再靠 `HIT_PAD` 互相抢（"移到 A 上亮的是 B"就是抢出来的）。
   *     整排最左/最右只留 `HOME_BAR_PAD` 个舞台单位：再往外就是"面积外"，**不该**选中。
   *  ② **不随帧飘**：矩形只在挂载时算一次，写进 `clip.__fixedHit`（**本层局部坐标**）；
   *     `addHitArea` 见到它就照抄、不再叠 pad，`refreshValues` 每秒重刷也不会改。
   * ⚠ 量"所有帧的并集"必须**先**量、再包动效壳：拨帧会重建 `<g>` 的子节点。
   * ========================================================== */
  const HOME_BAR = ['button1', 'button2', 'button3', 'button4', 'button5'];
  const HOME_BAR_PAD = 3;                 // 整排最左 / 最右再往外放这么多（舞台单位）
  /** 元件**所有帧**内容包围盒的并集（局部坐标）。量完把播放头放回原处。 */
  function measureFrameUnion(clip) {
    let box = null;
    const absorb = (b) => { if (b && b.width && b.height) box = unionBox(box, { x: b.x, y: b.y, w: b.width, h: b.height }); };
    const keep = clip.frame;
    const n = clip.frames ? clip.frames.length : 1;
    for (let i = 0; i < n; i++) {
      clip.frame = i;
      try { clip.showFrame(); } catch (e) { continue; }
      try { absorb(measureArtwork(clip)); } catch (e) {}
    }
    if (clip.frame !== keep) { clip.frame = keep; try { clip.showFrame(); } catch (e) {} }
    return box;
  }
  /** 本层局部矩形 → 父级坐标（只认平移 + 缩放；带旋转的元件返回 null，退回旧行为）。 */
  function toParentBox(clip, box) {
    const m = placementOf(clip);
    if (Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6) return null;
    return { x: m[0] * box.x + m[4], y: m[3] * box.y + m[5], w: m[0] * box.w, h: m[3] * box.h };
  }
  /** 父级矩形 → 本层局部坐标（`toParentBox` 的逆）。 */
  function toLocalBox(clip, box) {
    const m = placementOf(clip);
    const a = m[0] || 1, d = m[3] || 1;
    return { x: (box.x - m[4]) / a, y: (box.y - m[5]) / d, w: box.w / a, h: box.h / d };
  }
  /** 给底栏五键铺**固定**的选择面积（见上面那段注释）。只调一次，结果留在 `__fixedHit` 上。 */
  function setupHomeBar(main) {
    try {
      const clips = [], boxes = [];
      for (const n of HOME_BAR) {
        const c = main.byName(n);
        if (!c || !c.g) return;
        clips.push(c);
        boxes.push(measureFrameUnion(c));
      }
      const par = [];
      for (let i = 0; i < clips.length; i++) {
        if (!boxes[i]) return;
        const b = toParentBox(clips[i], boxes[i]);
        if (!b) return;
        par.push(b);
      }
      let y0 = Infinity, y1 = -Infinity;
      for (const b of par) { y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.h); }
      for (let i = 0; i < clips.length; i++) {
        const left = i === 0 ? par[i].x - HOME_BAR_PAD : (par[i - 1].x + par[i - 1].w + par[i].x) / 2;
        const right = i === clips.length - 1 ? par[i].x + par[i].w + HOME_BAR_PAD
          : (par[i].x + par[i].w + par[i + 1].x) / 2;
        clips[i].__fixedHit = toLocalBox(clips[i], { x: left, y: y0, w: right - left, h: y1 - y0 });
      }
    } catch (e) { /* 量不到就退回原来的"并集 + pad" */ }
  }
  /**
   * 给经典按钮 / 立绘补一块**和它自己一样大**的点击区。
   * 为什么需要：SVG 的 `<g>` 默认只在**着色像素**上响应点击（`visiblePainted`），
   * 于是图标看着挺大、能点中的却只有笔画那几条 —— 用户 2026-10 报"图标的体积与点击体积不吻合"。
   * 做法是按元件自身的包围盒铺一块透明矩形。现代模式那套 canvas 命中区**不参与**经典界面，
   * 见 main.js 里把 `homeRegions` 清空的那段。
   *
   * 点击区取**常态帧 ∪ 当前帧 ∪ 整段动画**：
   *   · 常态帧 vs 当前帧 —— 悬停帧（胶囊第 2 帧）比常态帧大，只按常态帧铺的话
   *     "鼠标一移上去、图标变大，靠上的那截就又点不到了"（用户 2026-10 的原话）；
   *   · **整段动画**（`animate:true`，四处立绘用）—— 用户 2026-10 本批报"祭坛与征战的 ui 面积有问题"，
   *     根因就是立绘各帧的版面差很多（祭坛 mc1 第 1 帧只有一小块地基、第 6 帧是整座建筑；
   *     征战 mc5 第 1 帧是整块、第 3 帧是空）。只按"当时停在哪一帧"铺热区，面积就忽大忽小。
   *     所以立绘按**所有帧的并集**铺 —— 热区恒定，且与这片版面真正占的地方一致。
   * 量各帧要临时拨帧，量完拨回原帧（这段是瞬时的，节拍器不会插进来）。
   */
  function addHitArea(clip, animate) {
    try {
      let box = null;
      const merge = (b) => {
        if (!b || !b.width || !b.height) return;
        if (!box) { box = { x: b.x, y: b.y, w: b.width, h: b.height }; return; }
        const x = Math.min(box.x, b.x), y = Math.min(box.y, b.y);
        const x2 = Math.max(box.x + box.w, b.x + b.width), y2 = Math.max(box.y + box.h, b.y + b.height);
        box = { x: x, y: y, w: x2 - x, h: y2 - y };
      };
      /* **固定选择面积**优先：底栏五键由 `setupHomeBar()` 一次性算好（见那段注释），
       * 这里照抄即可 —— 不再叠 pad、也不随"当时停在哪一帧"变。 */
      const fixed = clip.__fixedHit;
      if (fixed) box = { x: fixed.x, y: fixed.y, w: fixed.w, h: fixed.h };
      else {
        const base = measureHitBox(clip);
        if (base) merge({ x: base.x, y: base.y, width: base.w, height: base.h });
        try { merge(measureArtwork(clip)); } catch (e) {}
        if (animate && clip.frames && clip.frames.length > 1) {
          const keep = clip.frame;
          const union = (clip.__frameBoxes) || (clip.__frameBoxes = measureFrameBoxes(clip));
          for (const b of union) merge(b);
          if (clip.frame !== keep) { clip.frame = keep; try { clip.showFrame(); } catch (e) {} }
        }
      }
      if (!box || !box.w || !box.h) return;
      /* 往外放一圈（见 HIT_PAD 的注释）：比例与最小量取**较大**的那个，
       * 这样小图标也至少多出 2.5 个舞台单位，大立绘不会被撑得太夸张。
       * 固定面积不再放 —— 它已经按"相邻中点"切到边界上了，再放就会跟邻居重叠。 */
      const padX = fixed ? 0 : Math.max(box.w * HIT_PAD, HIT_PAD_MIN);
      const padY = fixed ? 0 : Math.max(box.h * HIT_PAD, HIT_PAD_MIN);
      let r = clip.__hitArea;
      if (r && !r.parentNode) r = null;
      if (!r) {
        r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('fill', 'transparent');
        r.setAttribute('pointer-events', 'all');
        r.setAttribute('data-hit', '1');
        clip.__hitArea = r;
        clip.g.appendChild(r);
      }
      r.setAttribute('x', box.x - padX); r.setAttribute('y', box.y - padY);
      r.setAttribute('width', box.w + padX * 2); r.setAttribute('height', box.h + padY * 2);
      /* 铺完就把这颗元件登记进"点击路由"（见上面那一大段注释）：热区只当尺子，
       * 真正判定归属的是路由器 —— 否则相邻元件重叠的热区会互相抢，谁画得晚谁赢。 */
      registerHit(clip, animate);
    } catch (e) { /* 量不到就算了，退回原来的行为 */ }
  }
  /** 把一个多帧元件**每一帧**的包围盒量出来（只量一次，结果缓存在 `__frameBoxes` 上）。
   *  量完把播放头放回原来那一帧 —— 这个动作是同步的，节拍器不会在中间插进来。 */
  function measureFrameBoxes(clip) {
    const out = [];
    const keep = clip.frame;
    const n = clip.frames ? clip.frames.length : 0;
    for (let i = 0; i < n; i++) {
      clip.frame = i;
      try { clip.showFrame(); } catch (e) { continue; }
      let b = null;
      try { b = measureArtwork(clip); } catch (e) { b = null; }
      if (b && b.width && b.height) out.push({ x: b.x, y: b.y, width: b.width, height: b.height });
    }
    if (clip.frame !== keep) { clip.frame = keep; try { clip.showFrame(); } catch (e) {} }
    return out;
  }
  /* ============================================================
   * 【点击路由】一个视图一根监听器，自己判定"指针到底停在谁身上"
   * ------------------------------------------------------------
   * 为什么不能再让每个元件各铺一块透明矩形就完事：
   *   SVG 的命中测试是"谁画得晚谁赢"。底栏五键为了好点，热区都往外放了一圈
   *   （`HIT_PAD`），相邻两颗因此重叠 8~12 个舞台单位 —— 鼠标停在「道具」的右缘时，
   *   后画的「状态」那块透明矩形压在上面，**亮的是「状态」、点进去也进「状态」**。
   *   用户 2026-10 报的"移到对应 ui 上不触发它的特效，反而是另一个 ui 亮了 /
   *   点击进去的也不是该界面"就是这一条（实测：五键里四对相邻都有 8~12 单位的重叠）。
   * 现在的做法：热区照旧铺（**只当尺子用**：量出每个元件的包围盒），但把元件自己的
   * 指针事件关掉，改由挂在 `<svg>` 上的一根监听器统一判定归属：
   *   · 第一优先：指针落在元件的**真实内容包围盒**里的那几个，取**面积最小**的一个
   *     （小图标 vs 它背后的大立绘，小的一定是玩家瞄的那个）；
   *   · 都没有，才退到"热区（内容 + `HIT_PAD`）"，取内容框**中心离指针最近**的那个。
   * 判定完自己派发 `mouseenter` / `mouseleave` / `click` 给那个元件的 `<g>`，
   * 于是各处已经写好的接线（`wireButtons` / `wireClickable` / `wireVillage`）一行都不用改。
   * ⚠ 元件自己的指针事件关掉之后 CSS 的 `:hover` 不再触发，悬停观感改由
   *   `.uc-pop.sf-hover`（与 `:hover` 同款声明）承担；按下回弹仍由 `.pressed` 承担。
   * ========================================================== */
  const ROUTER_KEY = '__sfRouter';
  /** 触摸设备判定（只用于放行“没有 pointerdown 的原生 click”这一条 iOS 兜底）。
   *  桌面鼠标仍走原来的“按下/抬起必须落在同一个元件上”的校验，避免拖拽误触。 */
  function touchCapable() {
    try {
      return ('ontouchstart' in window) ||
        ((window.navigator && window.navigator.maxTouchPoints) || 0) > 0 ||
        !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    } catch (e) { return false; }
  }
  /** 两个包围盒求并集（`{x,y,w,h}`） */
  function unionBox(a, b) {
    if (!a) return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
    if (!b) return a;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.w, b.x + b.w), y2 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x, y: y, w: x2 - x, h: y2 - y };
  }
  /** 元件**内容**的包围盒（局部坐标）：多帧状态精灵取"所有帧的并集"，与 `addHitArea` 同一把尺子。 */
  function contentBox(clip, animate) {
    let b = null;
    if (animate && clip.__frameBoxes && clip.__frameBoxes.length) {
      for (const q of clip.__frameBoxes) b = unionBox(b, { x: q.x, y: q.y, w: q.width, h: q.height });
    }
    if (!b) { const m = measureHitBox(clip); if (m) b = { x: m.x, y: m.y, w: m.w, h: m.h }; }
    return b;
  }
  /** 局部包围盒 → **屏幕(client)坐标**的轴对齐包围盒。元件矩阵只有平移缩放/极小旋转，
   *  四个角都算一遍再取并集，旋转也不会估歪。 */
  function boxToClient(clip, box) {
    const m = clip.g.getScreenCTM && clip.g.getScreenCTM();
    if (!m || !box) return null;
    const pt = (lx, ly) => ({ x: m.a * lx + m.c * ly + m.e, y: m.b * lx + m.d * ly + m.f });
    const ps = [pt(box.x, box.y), pt(box.x + box.w, box.y), pt(box.x, box.y + box.h), pt(box.x + box.w, box.y + box.h)];
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of ps) { if (p.x < x1) x1 = p.x; if (p.y < y1) y1 = p.y; if (p.x > x2) x2 = p.x; if (p.y > y2) y2 = p.y; }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  const inBox = (b, x, y) => !!b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  /** 取/建某个 `<svg>` 上的路由器。一个视图只有一根，挂载新视图时会自己失效（svg 换了）。 */
  function routerOf(svg) {
    if (svg[ROUTER_KEY]) return svg[ROUTER_KEY];
    const list = [];
    const r = { svg: svg, list: list, hovered: null, downOn: null };
    /** 元件在**屏幕坐标**里的框：直接问浏览器，不再经 `getScreenCTM()` 换算。
     *  WebKit 209220（iOS 15.5/15.6 仍复现）：getScreenCTM 漏掉祖先 CSS transform 的
     *  scale，`#ui` 的缩放不会被算进去；热区一旦用 CTM 算，看着在按钮上、判定却在
     *  别处，表现就是“体力条（DOM）能点、开始挑战（SVG）点不动”。
     *  `useHit` = 量透明热区（底栏五键的固定选择面积）；否则先暂时藏掉热区，
     *  只量画稿本身，避免把上次铺的热区越量越大。 */
    const screenBox = (clip, useHit) => {
      try {
        const hit = clip.__hitArea;
        if (useHit && hit && hit.getBoundingClientRect) {
          const r = hit.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
        }
        const old = hit && hit.style ? hit.style.display : null;
        if (hit && hit.style) hit.style.display = 'none';
        let r = null;
        try { r = clip.g.getBoundingClientRect(); } finally {
          if (hit && hit.style) hit.style.display = old;
        }
        if (r && r.width > 0 && r.height > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
      } catch (e) {}
      return null;
    };
    /** 指针直接落在某个已登记元件的**画面像素**上：用浏览器的命中测试找归属。
     *  比“按包围盒猜”更准，也不依赖 CTM；透明热区/空白处再由下面的盒子逻辑兜底。 */
    const domPick = (cx, cy) => {
      if (typeof document === 'undefined' || !document.elementFromPoint) return null;
      let el = null;
      try { el = document.elementFromPoint(cx, cy); } catch (e) { return null; }
      if (!el || !(el === svg || svg.contains(el))) return null;
      for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
        for (const e of list) {
          if (e.clip && e.clip.g === n && e.clip.g.isConnected !== false) return e;
        }
        if (n === svg) break;
      }
      return null;
    };
    /** 按当前布局刷新每个元件的"内容框 / 热区"（屏幕坐标）。每次指针事件都刷 —— 元件数很少，
     *  而窗口缩放、翻页、换帧都会让旧的盒子失效，缓存反而容易出错。 */
    const refresh = () => {
      // Keep one list identity: pick(), registration and pruning share this array.
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (!e.clip.g || e.clip.g.isConnected === false) {
          if (r.hovered === e) r.hovered = null;
          if (r.downOn === e) r.downOn = null;
          list.splice(i, 1);
        }
      }
      for (const e of list) {
        let hidden = false;
        for (let n = e.clip.g; n && n !== svg; n = n.parentNode) {
          if ((n.style && (n.style.display === 'none' || n.style.visibility === 'hidden')) ||
              (n.getAttribute && n.getAttribute('visibility') === 'hidden')) { hidden = true; break; }
        }
        if (hidden) { e.content = e.pad = null; continue; }
        /* **固定选择面积**（底栏五键）：量那块透明热区本身；它已经按"相邻中点"切好，
         * 不用 pad，五块之间也没有重叠可以抢。 */
        if (e.clip.__fixedHit) {
          e.content = screenBox(e.clip, true);
          e.pad = null;
          continue;
        }
        const box = screenBox(e.clip, false);
        e.content = box;
        if (box) {
          const px = Math.max(box.w * HIT_PAD, HIT_PAD_MIN * 2), py = Math.max(box.h * HIT_PAD, HIT_PAD_MIN * 2);
          e.pad = { x: box.x - px, y: box.y - py, w: box.w + px * 2, h: box.h + py * 2 };
        } else e.pad = null;
      }
    };
    const pick = (cx, cy) => {
      /* 停用期间一律判定为"谁都没命中"：上层弹层开着的时候，底页不该对指针有反应。 */
      if (r.enabled === false) return null;
      refresh();
      /* **固定选择面积**（底栏五键）优先：它已经按"相邻中点"切好了边界，
       * 只要指针落在自己那一块里就一定归它 —— 不再和压在附近的别的东西比面积
       * （村庄门 `homeButton` 的包围盒会擦到「系统」按钮的上沿，装饰小图标同理）。 */
      for (const e of list) {
        if (!e.clip.g || e.clip.g.isConnected === false) continue;
        if (!e.clip.__fixedHit) continue;
        if (inBox(e.content, cx, cy)) return e;
      }
      /* 浏览器实际命中的画面像素优先：它不受 CTM 换算误差影响，也能正确处理
       * “大立绘后面藏着小按钮”这种遮挡关系。 */
      const dom = domPick(cx, cy);
      if (dom) return dom;
      let best = null, bestArea = Infinity;
      for (const e of list) {
        if (!e.clip.g || e.clip.g.isConnected === false) continue;
        if (!inBox(e.content, cx, cy)) continue;
        const area = e.content.w * e.content.h;
        if (area < bestArea) { bestArea = area; best = e; }
      }
      if (best) return best;
      let bestDist = Infinity;
      for (const e of list) {
        if (!e.clip.g || e.clip.g.isConnected === false) continue;
        if (!inBox(e.pad, cx, cy)) continue;
        const dx = cx - (e.content.x + e.content.w / 2), dy = cy - (e.content.y + e.content.h / 2);
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; best = e; }
      }
      return best;
    };
    const shellOf = (e) => (e && e.clip.g ? e.clip.g.querySelector(':scope > g.uc-pop') : null);
    const fire = (e, type, extra) => {
      if (!e || !e.clip.g || typeof MouseEvent !== 'function') return;
      const init = Object.assign({ bubbles: false, cancelable: true, view: window }, extra || {});
      try { e.clip.g.dispatchEvent(new MouseEvent(type, init)); } catch (err) {}
    };
    const enter = (e) => {
      const sh = shellOf(e);
      if (sh) sh.classList.add('sf-hover');
      fire(e, 'mouseenter', { clientX: r.lastX, clientY: r.lastY });
    };
    const leave = (e, toNode) => {
      const sh = shellOf(e);
      if (sh) { sh.classList.remove('sf-hover'); sh.classList.remove('pressed'); }
      fire(e, 'mouseleave', { clientX: r.lastX, clientY: r.lastY, relatedTarget: toNode || null });
    };
    r.move = (cx, cy) => {
      r.lastX = cx; r.lastY = cy;
      if (r.enabled === false) return;
      const win = pick(cx, cy);
      if (win === r.hovered) return;
      const prev = r.hovered;
      r.hovered = win;
      if (prev) leave(prev, win ? win.clip.g : null);
      if (win) enter(win);
    };
    r.clear = () => {
      if (r.hovered) { leave(r.hovered, null); r.hovered = null; }
      const sh = shellOf(r.downOn);
      if (sh) sh.classList.remove('pressed');
      r.downOn = null;
    };
    r.hit = (cx, cy) => pick(cx, cy);
    /* ============================================================
     * 【停用/恢复路由】上层弹层打开时把**底页**这根路由关掉
     * ------------------------------------------------------------
     * 为什么需要：二级页（对手动作菜单 / 关卡难度页…）是**另一层 `<section>`**，
     * 它自己那棵 `<svg>` 只铺满"舞台矩形"那块，四周的透明区域**不挡指针** ——
     * 指针落在弹层画稿之外时，事件照样打到下面那棵 svg 上，底页的
     * `pointermove` 于是继续切行帧、点亮底下的敌人行（用户 2026-10 口径：
     * "在这个页面下，上一级界面不会对鼠标的移动做出反馈"）。
     * 只关底页那一根：弹层自己那棵的路由不受影响。 */
    r.setEnabled = (on) => {
      const want = on !== false;
      if (r.enabled === want) return false;
      r.enabled = want;
      if (!want) r.clear();          // 关掉时先把当前悬停态收干净，否则会留一行亮着
      return true;
    };
    r.isEnabled = () => r.enabled !== false;

    svg.style.pointerEvents = 'auto';
    svg.addEventListener('pointermove', (ev) => r.move(ev.clientX, ev.clientY));
    svg.addEventListener('pointerleave', () => {
      // Touch can leave after pointerup but before its synthesized click.
      if (!r.releasedOn) r.cancelled = true;
      r.clear();
    });
    svg.addEventListener('pointercancel', () => { r.cancelled = true; r.releasedOn = null; r.clear(); });
    svg.addEventListener('pointerdown', (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      r.cancelled = false;
      r.releasedOn = null;
      r.move(ev.clientX, ev.clientY);
      r.downOn = r.hovered;
      const sh = shellOf(r.hovered);
      if (sh) { sh.classList.remove('pressed'); void sh.getBoundingClientRect(); sh.classList.add('pressed'); }
    });
    const release = (ev) => {
      r.move(ev.clientX, ev.clientY);
      const sh = shellOf(r.downOn);
      if (sh) sh.classList.remove('pressed');
      r.releasedOn = r.downOn === r.hovered ? r.downOn : null;
    };
    svg.addEventListener('pointerup', release);
    svg.addEventListener('click', (ev) => {
      /* touch-fallback 直接点在按钮 <g> 上时已经走过按钮自己的监听，别再来一次。 */
      if (ev.__sfSynth) return;
      r.move(ev.clientX, ev.clientY);
      const e = r.hovered;
      const down = r.releasedOn || r.downOn;
      r.downOn = null;
      r.releasedOn = null;
      if (!e) return;
      /* ⚠ iOS 15 的 WKWebView 有一类“只合成 click、不派发 pointerdown/up”的轻点
       * （Safari 在 SVG 上的既有行为，见 touch-fallback 的注释）。这时 down 为空，
       * 旧代码会把它当成“按下目标不一致”直接丢掉 —— 表现就是 DOM 按钮（标题页、
       * 体力条）正常，而经典界面的 SVG 按钮（开始挑战 / 道具 / 状态…）全都没反应。
       * 触点已经由上面的 `r.move()` 重新命中到 e，所以在触摸设备上按坐标放行；
       * 鼠标拖拽仍保留 down === e 的校验（down 非空且不一致时下面照样 return）。 */
      const touchClickWithoutDown = ev.detail > 0 && !down && !r.cancelled && touchCapable();
      if (ev.detail > 0 && !touchClickWithoutDown && (r.cancelled || down !== e)) return;
      fire(e, 'click', { clientX: ev.clientX, clientY: ev.clientY, button: 0, detail: 1 });
    });
    svg[ROUTER_KEY] = r;
    return r;
  }
  /**
   * 把一个铺好热区的元件登记进路由器（`addHitArea` 末尾自动调）。
   * 没挂到 `<svg>` 上（还在建树、或调用方只是在量尺寸）就直接返回 ——
   * 这时**不动**它的指针事件，退回"透明矩形自己吃事件"的老行为，绝不会更坏。
   */
  function registerHit(clip, animate) {
    const svg = (clip && clip.g && clip.g.ownerSVGElement) || null;
    if (!svg) return null;
    const r = routerOf(svg);
    // Re-registration follows page refreshes; never re-enable native hit testing.
    clip.g.style.pointerEvents = 'none';
    const hit = clip.__hitArea;
    if (hit) hit.setAttribute('pointer-events', 'none');
    const existing = r.list.find((e) => e.clip === clip);
    if (existing) { existing.animate = !!animate; return r; }
    /* ⚠ 已经登记过的元件的**子孙**不再单独登记。反过来的情况（先登记了子孙、再登记祖先）
     * 则把子孙摘掉，让祖先独占这一块。
     * 为什么必须这么做：`popWrap()` 会顺带给被包的元件量一次热区 —— 底栏五键**选中帧上那颗
     * 浮动小图标**就是这么被登记进路由表的。它比按钮小得多，"面积最小者胜"的判定必胜，
     * 于是指针一移到按钮**靠上的位置**（正好压在那颗装饰上）就被它抢走归属：
     * 按钮收到 `mouseleave` 回常态帧 → 装饰立刻停 → 指针还在原地、下一拍又进按钮 →
     * **无限闪**（用户 2026-10 报的"在靠上的位置选中时，图标会一直闪"）。 */
    const isAncestor = (a, b) => { for (let c = b; c; c = c.parent) if (c === a) return true; return false; };
    if (r.list.some((e) => e.clip && e.clip !== clip && isAncestor(e.clip, clip))) return r;
    for (let i = r.list.length - 1; i >= 0; i--) {
      const e = r.list[i];
      if (!e.clip || e.clip.g.isConnected === false || isAncestor(clip, e.clip)) {
        if (r.hovered === e) r.clear();
        r.list.splice(i, 1);
      }
    }
    r.list.push({ clip: clip, animate: !!animate, content: null, pad: null });
    /* 关掉元件自己的指针事件：留着它，它仍然会和邻居抢命中（这正是要修的那个 bug）。 */
    return r;
  }
  /** 元件被换掉/拆掉时把它从路由器里摘掉（避免指针落在已经不在树上的东西上）。 */
  function unregisterHit(clip) {
    const svg = (clip && clip.g && clip.g.ownerSVGElement) || null;
    const r = svg && svg[ROUTER_KEY];
    if (!r) return;
    const i = r.list.findIndex((e) => e.clip === clip);
    if (r.hovered && r.hovered.clip === clip) r.clear();
    if (r.downOn && r.downOn.clip === clip) r.downOn = null;
    if (i >= 0) r.list.splice(i, 1);
  }
  /* ============================================================
   * 点击反馈：**默认静默，点一下才播一遍"按下"那一帧**（用户 2026-10 口径）
   * ------------------------------------------------------------
   * 这些按钮元件的第 1/2/3/4 帧就是 Flash 按钮的四个状态：
   *   1 = 常态、2 = 选中（高亮）、3 = 禁用、4 = 空（hit 区不导出）。
   * 原版靠键盘选中（`setButtons`）切帧，复刻映射成鼠标：
   *   · 悬停 = 停在"选中帧"（**静止**，不是动画）；
   *   · 点击 = 闪一下选中帧 `PRESS_MS` 毫秒再回常态。
   * 关键是**绝不让元件自己播** —— 3~4 帧来回切就是用户看到的"胡乱播放动画"。
   * ========================================================== */
  const PRESS_MS = 170;
  /** `onFrame`（可选）：每拨到一帧就回调一次 —— 给"状态精灵"用，
   *  那边需要把闪的这一帧也**钉住**（否则节拍器下一拍就把它推走，见 ui-status.js 的注释）。 */
  function pressFlash(clip, idle, after, onFrame) {
    if (!clip || !clip.gotoAndStop) return;
    const back = (idle == null) ? 1 : idle;
    try { clip.gotoAndStop(2); } catch (e) {}
    if (onFrame) { try { onFrame(2); } catch (e) {} }
    addHitArea(clip);
    playButtonDeco(clip);                                // 按下那一档也照原版把装饰放一遍（没有就什么都不做）
    if (after) after();
    if (clip.__pressTimer) clearTimeout(clip.__pressTimer);
    clip.__pressTimer = setTimeout(() => {
      clip.__pressTimer = 0;
      try { clip.gotoAndStop(back); } catch (e) {}
      if (onFrame) { try { onFrame(back); } catch (e) {} }
      /* 回到常态：装饰一起静默（选中帧那颗是 15 帧动画，不钉住会被节拍器一直转）。
       * 回到"选中帧"（指针还停在上面）：保持它继续播。 */
      if (back === 1) { stopPlayDecos(clip); settleButton(clip); }
      else { settleButton(clip); playButtonDeco(clip); }
      addHitArea(clip);
      if (after) after();                                // 回常态又是一次换帧 → 子树要重新"静音"
    }, PRESS_MS);
  }
  /** 把元件"钉"在某一帧上（不自动播）：村庄页那些**状态帧**（立绘/数字）用这个。 */
  function pinFrame(clip, n) {
    if (!clip) return;
    try {
      if (clip.pinFrame) clip.pinFrame(n);
      else if (clip.gotoAndStop) { clip.playing = false; clip.gotoAndStop(n); }
    } catch (e) {}
  }
  /** 把一棵子树立成**静态页**：子树里所有多帧元件"出生即冻结"，而且**换帧重建出来的新实例
   *  也自动适用** —— 规则写在元件名 / 元件号上、随实例继承，见 `render.js` 的「静态页策略」。
   *
   *  ⚠ 这是"**UI 在自己所有可达帧之间乱跳**"的唯一正解。历史写法是"事后把当时的实例
   *    `pinFrame(1)` 扫一遍"，它有两个天生的洞（用户 2026-10 报的那两类"乱跳"正是它们）：
   *     · 只对**扫的那一刻存在**的实例生效：`showFrame()` 换帧会重建子树、新实例默认
   *       `playing = true`，任何一次 `gotoAndStop`（切 tab / 换页 / 翻页 / 换行）之后
   *       没有紧接着再扫一遍的元件就开始自播。实测：状态页从武器页切回状态帧后，
   *       立绘四个部位（188 帧）与装备挂点 `ikNode_9`（11 帧）全部开始循环。
   *     · 只走 `nodes`（换帧放置表），**扫不到 `attachChild()` 挂上去的库元件子树**。
   *       实测：武器 / 技能页 10 颗图标里那颗 4 帧装饰全在循环 = 十颗图标一起乱跳。
   *
   *  ⚠ 也**不再需要**"例外名单"（老的 `skip` / `protect` 两个参数已删除）：那时候要列例外，
   *    是因为老机制用 `pinFrame`（每一拍强制拨回第 1 帧），凡是"界面自己要拨帧的元件"
   *    （tab / 箭头 / 数字精灵 / 门卡）都得躲开它。现在冻结只写 `playing = false`
   *    —— 不自己往前走、不碰帧号，`gotoAndStop` / `showNumber` / `playOnce` 全部照常生效。
   *    所以规则只剩一条：**整页一律冻，除了原版自带的装饰动画**（`KEEP_ANIMATED`）。 */
  function freezeDescendants(clip) {
    if (!clip || !clip.setStaticPolicy) return;
    clip.setStaticPolicy({ keepIds: [...KEEP_ANIMATED] });
  }
  /** 收集某个元件**子树里**所有多帧子元件（不含它自己）。返回实例数组。
   *  底栏五键的"选中帧装饰"（6992/7004/6997/7009/7014）就是靠它找到的 —— 它们是
   *  **选中帧里的子元件**，实例要等那一帧出生，所以每次换帧都要重新收一遍。
   *  ⚠ `nodes` 里存的是 `{node, clip, wrap}`，只有 `clip` 才是可拨帧的元件；形状没有 `clip`。 */
  function multiFrameKids(clip, out) {
    const list = out || [];
    if (!clip || !clip.nodes) return list;
    for (const rec of clip.nodes.values()) {
      const c = rec.clip;
      if (!c) continue;
      if (c.frames && c.frames.length > 1) list.push(c);
      multiFrameKids(c, list);
    }
    return list;
  }
  /* ---------- 底栏五键：常态静默、悬停才放动画（用户 2026-10 第一百五十批口径）----------
   * 需求原文："村庄模式内，四种 ui 重设为静默状态……另其实际展现与 ssfight 相同即可。"
   *
   * 原版到底长什么样（`MainMovie.as` 逐条核过，别再猜）：
   *   · `myDraw()` :42-70 在 `state==0` 时调 `showButton(mainButtons, menuWz-1)`；
   *   · `showButton()` :5804-5835：**选中的那一颗 `gotoAndStop(2)`，其余 `gotoAndStop(1)`**；
   *   · 第 1 帧（常态）= 绿胶囊 + 白字，**没有任何会动的装饰**；
   *   · 第 2 帧（选中）= 金胶囊 + 奶油字 + 一颗**自带 15 帧上下浮动动画**的小图标
   *     （道具 6992 / 状态 6997 / 挑战 7004 / 消息 7009 / 系统 7014）。
   *   · **静止时原版只把某一颗停在选中帧上**（键盘选中态），其余四颗停常态帧。
   *
   * 所以"静默"= 四颗非主按钮**停在常态帧且子树里一个动画都不许转** —— 这正是原版常态的样子。
   * 复刻之前只把按钮**自己**钉住了（`gotoAndStop(1)`），但换帧/出生不会自动钉子树：
   * 一旦有颗按钮进过选中帧，那颗 15 帧的装饰就被节拍器一直转着，鼠标移开也不停。
   * 现在 `settleButton()` 每次换帧后把**除按钮自己以外**的多帧子元件一律钉回第 1 帧。
   * 悬停仍按"现代适配"切选中帧，并把那颗装饰**从头放一遍**（`playOnce`，72ms/帧 ≈ 原版 14fps），
   * 移开就拨回常态并重新静默 —— 观感就是原版选中那颗的动效，只是换成鼠标触发。 */
  function settleButton(clip, skip) {
    for (const c of multiFrameKids(clip)) {
      if (skip && skip.has(c)) continue;
      pinFrame(c, 1);
    }
  }
  /** 把这个按钮的那颗"选中帧装饰"从头放一遍（放完停在末帧，移开时由 `settleButton` 拨回第 1 帧）。
   *  没找到装饰（素材换了 / 不在选中帧）就什么都不做，退化成静态选中帧。
   *  ⚠ `playOnce` 内部会把这一颗的 `__pinFrame` 摘掉（它要自己推帧），所以"停"必须显式来一遍 ——
   *  见 `stopPlayDecos`。 */
  function playButtonDeco(clip) {
    for (const c of multiFrameKids(clip)) playOnce(c, { loop: true });
  }
  /** 停掉子树里所有装饰的"自己播"，交给 `settleButton` 钉回第 1 帧。 */
  function stopPlayDecos(clip) {
    for (const c of multiFrameKids(clip)) stopPlay(c);
  }

  /* ---------- 悬停中的底栏五键 ----------
   * `refreshValues()` 每秒重刷一次，会把五键重新"静默"（换帧会重建子树，新出生的装饰默认会自己播）。
   * 指针正停在上面那一颗的装饰正在放"选中"那一遍动画，不能被动 —— 所以记一份**名字**名单跳过它
   * （键用名字而不是实例：`refreshValues` 里是按名字遍历的，两份键类型不同就会永远判不中）。 */
  const hoveredButtons = new Set();

  /* ---------- 挂载 ---------- */
  let current = null;
  let timer = 0;
  let viewSeq = 0;

  async function mount(container) {
    if (!window.SfRender) throw new Error('SfRender 未加载');
    destroy();
    const mine = viewSeq;
    /* ⚠ 这一层是**村庄主页**，要打上 `ssfight-home-page` 标记：`classic.css` 有一条
     *   `#ui:has(.classic-page) .classic-home{visibility:hidden}` —— 进二级页（道具/状态/…）时
     *   把整屏的村庄页藏掉、把背景还给 canvas。那条规则以前按 `.classic-home` 匹配，
     *   于是**挑战页 / 状态页这些 `SfRender` 挂载的经典整页也一起被藏掉了**：
     *   竞技场打完一场回到赛事页时满屏墨绿、什么按钮都没有（用户 2026-10 报的"战斗结束后卡死"），
     *   以及状态页点开武器/技能详情再切回来时**整页"闪一下空白"**（用户报的"全屏数字变 9999999
     *   持续一秒"里那一秒的空白）——都是这条规则误伤。现在只藏村庄主页这一层。 */
    container.classList.add('ssfight-home-page');
    /* 装备表要在**建树之前**备好：挂点是在建树过程中实例化的，plan 必须那一刻就绪。
     * 任一步失败都只是"不穿装备"，不影响整页渲染。 */
    let plan = null;
    if (DRESS_ENABLED) {
      try { plan = planWears(await loadGearTables()); }
      catch (e) { if (window.__errs) window.__errs.push('装备表加载失败：' + (e && e.message)); }
    }
    if (mine !== viewSeq || container.isConnected === false) return null;
    const view = await SfRender.mount(container, {
      frame: 20,                                            // 帧 20 = main（村庄）
      onClip: (plan && gearOpts().mode === 'slot') ? (clip) => {
        /* ⚠ 只给**主角自己**穿。原版这两条链路都先判 `targetPath(mc).split(".")[2] == "myself"`
         * （chooseEquipLoader:6759 / getEquipBpData:6793）—— 徒弟用的是同一批库元件、
         * 身上有**同一批挂点 id**，不判就会连徒弟一起穿上玩家的装备。 */
        if (!inMyself(clip)) return;
        /* 持有者：把它**钉在装备帧号**上（只拨帧、不换符号）。钉住之后它才会放出
         * "这件装备该用的那个挂点"；让它自由播放就是脚部抖动的根源。 */
        const hf = plan.holders.get(String(clip.tag.id));
        if (hf != null) { clip.pinFrame(hf); return; }
        const p = plan.bySlot.get(String(clip.tag.id));
        if (p) {
          /* 留个记号：换了时间轴之后 tag.id 就变容器了，调试时得知道它原本是哪个挂点 */
          if (clip.g && clip.g.setAttribute) clip.g.setAttribute('slot', String(clip.tag.id));
          const go = gearOpts();
          const off = gearOffset(p.type, p.gearId, go);
          /* 锚点：`'none'` = 按"容器原点对齐挂点原点"落地（原版 attachBitmap 的语义，见 gearOpts），
           * 这时**不能**把 'none' 传进 anchorToBBox —— 它只认 center/bottom/topleft，
           * 传别的会掉进 topleft 分支。所以这里显式转成 null（= 不做包围盒平移）。 */
          const anchor = (!go.anchor || go.anchor === 'none') ? null : go.anchor;
          /* 偏移交给 setSymbol 一起拼（见 render.js 的 anchorToBBox 注释：在外面 append 会被重算抹掉） */
          const tail = off ? ('translate(' + off[0] + ',' + off[1] + ')') : '';
          clip.setSymbol(p.symbol, p.frame, go.scale, anchor, tail);
          /* 挂点留在原版骨骼的深度。骨头还带着裸臂/拳头，整体提升会改掉前后手顺序；
           * 换帧重建时再从旧实例集合提顶，还会让护肩在两种层序之间跳。 */
        }
      } : null,
    });
    if (mine !== viewSeq || container.isConnected === false) { view.destroy(); return null; }
    if (plan && gearOpts().mode === 'attach') { try { attachWears(view, plan.parts); } catch (e) {} }
    /* mode:'root' —— 挂到 SVG 根（恒等坐标）上：用来验证"容器画稿是不是按**舞台坐标**画的" */
    if (plan && gearOpts().mode === 'root') { try { attachWears(view, plan.parts, view); } catch (e) {} }
    view.el = container;
    refreshValues(view);
    wireButtons(view);
    syncGiftVisibility(container);
    /* 页面装好了再让 `main.js` 量一次布局：经典模式的整页是原版 320×196（= 716.625 高），
     * 而 `#ui` 的高度是按"当前页有没有 `.ssfight-home`"选 716.625 / 690 的。
     * 从复刻的 DOM 二级页（690）回到经典页时不再量一次，`#ui` 就还是 690 ——
     * SVG 只能按高度铺满，**屏幕上下两条边会失去填充**（用户 2026-10 报的
     * "多次返回状态栏时屏幕边缘会失去填充"）。`page()` 那一侧已经调了，这边补齐。 */
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    /* 数值会变（体力随时间回、经验/等级会涨），所以定时重绑 —— 原版靠服务器推送，
     * 复刻没有推送，就轮询；1s 一次足够且几乎不耗性能。
     * 药丸图标的落点也要跟着重算：窗口缩放、全面屏比例变化都会改 svg 的实际尺寸，
     * 而 DOM 叠层不像 SVG 那样自动等比缩放（见 positionStateIcons）。 */
    timer = setInterval(() => {
      if (view.root.isConnected === false) { if (current === view) destroy(); return; }
      try { refreshValues(view); } catch (e) { if (window.__errs) window.__errs.push('ui-main tick: ' + (e && e.message)); }
      try { if (view.el) renderStateIcons(view.el, view); } catch (e) { if (window.__errs) window.__errs.push('state icons: ' + (e && e.message)); }
    }, 1000);
    current = view;
    return {
      view,
      refresh: () => refreshValues(view),
      showNumber,
      destroy: () => { if (current === view) destroy(); else view.destroy(); },
      /** 按名字取原版元件（调试/自检用） */
      byName: (n) => view.byName(n),
    };
  }

  function destroy() {
    viewSeq++;
    if (timer) { clearInterval(timer); timer = 0; }
    /* 药丸那层 DOM 跟着宿主一起被摘掉了 —— 缓存也要一起失效，否则下次挂载会以为
     * 已经画过了（切模式来回一次药丸就再也不显示）。 */
    stateSig = '';
    /* 悬停名单里存的是**上一棵树**的按钮名；那一棵树已经被摘掉了，留着只会让新树的第一颗按钮
     * 被误判成"指针还停在上面"，于是它的装饰一直转（本批新加的静默就失效了）。 */
    hoveredButtons.clear();
    /* 立绘"播一遍"的定时器也要停：它们挂在**旧实例**上，继续跑只会推一棵已经摘掉的树。 */
    for (const t of playingTimers.values()) clearTimeout(t);
    playingTimers.clear();
    villagePlaying.clear();
    if (current) {
      try { if (current.destroy) current.destroy(); } catch (e) {}
      current = null;
    }
  }

  /**
   * 经典主界面左上角的「礼包 / 活动」入口（**上下居中**，用户 2026-10 口径）。
   * 原版这块是运行时 `attachMovie` 挂上去的库元件（静态闭包里没有），所以复刻用**自己的图标**
   * 补一个 DOM 按钮盖在 SVG 上：既不动原版显示列表，也能直接复用现成的 `daily` 动作。
   */
  /** 「活动」里还有没处理的奖励（每日礼包 / 每日任务 / 徒弟日供）—— 与
   *  `classic-ui.js` 的 `dailyAttention()` 同一口径；主界面礼包图标要跟着它闪烁。 */
  function giftAttention() {
    try {
      if (!State.dailyStatus().claimed) return true;
      if (State.questClaimable() > 0) return true;
      const t = (window.ClassicExtras && ClassicExtras.tributeStatus) ? ClassicExtras.tributeStatus() : null;
      return !!(t && t.claimable);
    } catch (e) { return false; }
  }
  /** 主界面礼包按原版底栏的解锁节奏：3 级起才出现。
   *  1~2 级露出会让玩家从「每日抽奖」提前进商店，用户 2026-11 口径。 */
  function giftUnlocked() {
    try { return Number(State.state().level) >= 3; } catch (e) { return false; }
  }
  function syncGiftAttention(container) {
    const b = container && container.querySelector ? container.querySelector('.ssfight-gift') : null;
    if (!b) return false;
    const att = giftAttention();
    b.classList.toggle('attention', att);
    b.setAttribute('aria-label', att ? '活动，有可领取的奖励' : '活动');
    return att;
  }
  function syncGiftVisibility(container) {
    if (!container) return false;
    let b = container.querySelector ? container.querySelector('.ssfight-gift') : null;
    if (!giftUnlocked()) {
      if (b) b.style.display = 'none';
      return false;
    }
    if (!b) { addGiftButton(container); b = container.querySelector ? container.querySelector('.ssfight-gift') : null; }
    if (b) b.style.display = '';
    return !!b;
  }
  function addGiftButton(container) {
    if (!container || !giftUnlocked() || container.querySelector('.ssfight-gift')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ssfight-gift';
    b.setAttribute('aria-label', '活动');
    b.innerHTML = '<img alt="" src="images/ui/home/activity.png">';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!giftUnlocked()) return;
      if (window.UI && UI.runAction) UI.runAction('daily');
    });
    container.appendChild(b);
    syncGiftAttention(container);
  }

  /* ============================================================
   * 真正的村庄页（根时间轴帧 30 / 根元件 `homeMc` 7140）
   * ------------------------------------------------------------
   * 注意别和**主菜单页**搞混：帧 20 的 `main`（7039）才是底栏五键那个主界面；
   * 帧 30 的 `homeLand`（7140）是原版点「村庄」进去的**村庄场景** —— 里面有四处地点
   * （祭坛 / 幻兽 / 神迹 / 征战，元件 mc1/mc3/mc4/mc5）和它自己的底栏四键，
   * 左上角 `mainButton` 是「回家」。
   * 素材单独成包（tags-home.json，1.41 MB）：只有真的进村庄才去拉。
   * ========================================================== */
  const VILLAGE_BUTTONS = {
    button6: 'village-altar',      // 祭坛（原版 x≈39）
    button8: 'village-beast',      // 幻兽（x≈118）
    button9: 'village-miracle',    // 神迹（x≈196）
    button10: 'village-war',       // 征战（x≈275）
  };
  const VILLAGE_LABEL = {
    'village-altar': '祭坛', 'village-beast': '幻兽牧场',
    'village-miracle': '神迹', 'village-war': '征战',
  };
  /* 四处地点的立绘（mc1/mc3/mc4/mc5）：原版 version "c" 的点击目标是**立绘里面那颗 button1**
   * （MainMovie.as:9537/9555/9578/9605/9628），也就是说**点怪物本身就该进地点**。
   * 复刻直接把立绘的包围盒铺成点击区（见下），省得去猜每一帧里 button1 在哪。
   * 对应关系照原版：mc1=祭坛 / mc4=幻兽 / mc3=神迹 / mc5=征战。 */
  const VILLAGE_MC_ACTIONS = { mc1: 'village-altar', mc4: 'village-beast', mc3: 'village-miracle', mc5: 'village-war' };
  /* 立绘 ↔ 它下面那颗"地点胶囊"的对应表（由 VILLAGE_BUTTONS 反查，保持单一来源）：
   * 用户口径（2026-10）：鼠标移到**村庄里的 ui**（不管是胶囊还是立绘）上，都要看到它切到
   * positive（选中/高亮）状态 —— 原版里立绘内嵌的 button1 和这颗胶囊本来就是同一个交互，
   * 高亮表现也都落在胶囊那一帧上（胶囊 3 帧：1 常态绿 / 2 选中金 / 3 禁用空）。 */
  const VILLAGE_PILL_OF = {};
  for (const [pill, act] of Object.entries(VILLAGE_BUTTONS)) VILLAGE_PILL_OF[act] = pill;
  /* 带 CSS 悬停/按下动效的村庄元件：四个地点胶囊 + 「回家」，以及四处立绘。
   * ⚠ 用途分两档（别混）：胶囊 / 「回家」那几颗的"常态/选中"两帧是**静态图**，
   *   CSS 那记微放大就是它们唯一的悬停动效；四处立绘则是**真有多帧动画**的（见下），
   *   悬停时放它自己的帧，**不再**叠 CSS 回弹。 */
  const VILLAGE_POP_TARGETS = {};
  for (const n of Object.keys(VILLAGE_BUTTONS)) VILLAGE_POP_TARGETS[n] = 1;
  for (const n of Object.keys(VILLAGE_MC_ACTIONS)) VILLAGE_POP_TARGETS[n] = 1;
  VILLAGE_POP_TARGETS.mainButton = 1;
  /* 这些立绘是**状态帧**（祭坛/幻兽/神迹的等级外观，征战的开/关），原版是
   * `showUpgrading()` / `showHomeLand()` 里 `gotoAndStop` 停住的 —— 让它自由播放就是
   * 用户报的"村庄里的 UI 胡乱播放动画"。
   * ⚠ 用户 2026-10 进一步澄清："鼠标移动到 ui 上的时候会播放连续的 ui 变化图像，但这个图像
   * 应当是**各个地点升级到不同等级**时候的不同表现，**不应该一股脑放到一块展示**。"
   * 所以现在**照原版 `showUpgrading()`（MainMovie.as:9680-9762）拨帧**：
   *   · 祭坛 mc1：`gotoAndStop(ceil(level/5))`，没建筑（level 0）→ 停 `_totalframes`（空）；
   *   · 神迹 mc3：同上；
   *   · 幻兽 mc4：同上；
   *   · 征战 mc5：`campaignOpen ? 1 : 2`（复刻按等级 35 与 `State.building('beast')` 同口径判断）。
   * 悬停**不再"从头播一遍"**（那正是用户说的"一股脑放一块"），改为只播**当前档位那一帧**
   * 的一记选中反馈（CSS）。等级变了才换帧 —— 于是"升级到不同等级"才看得到不同表现。 */
  const VILLAGE_STATE_FRAME = 1;
  /* ---------- 村庄 ui 的"选中动效壳"与"播一遍自带动画" ---------- */
  /** 正在**放自带动画**的村庄元件（= 立绘 mc1/mc3/mc4/mc5）。
   *  为什么要有这个集合：`settleVillage()` 每帧都把没被钉住的立绘拨回 `VILLAGE_STATE_FRAME`
   *  （那是"默认静默"的实现），而立绘的悬停动效正是"让它自己往下播" —— 不排除的话
   *  刚播到第 2 帧就被拨回第 1 帧，表现就是"一动不动"。
   *  ⚠ 用**实例**而不是名字做键：`popWrap` / 换帧都会重建 `<g>`，但 `MovieClip` 实例是稳定的。 */
  const villagePlaying = new Set();
  /** 立绘自带动画的播放节奏（毫秒/帧）。原版闭包的帧率是 14 fps（≈71ms），
   *  这里用 72ms：既"看得出在放动画"，又不会慢到让悬停像卡住。
   *  元件帧数见 `images/ssfight/ui/tags-home.json`：mc1=6 / mc3=7 / mc4=7 / mc5=2 帧。 */
  const VILLAGE_PLAY_MS = 72;
  /** 把元件**从头播一遍**（放完停在最后一帧；`loop` 为真则循环播，直到 `stopPlay` 叫停）。
   *  这是 Flash 里 `gotoAndPlay()` 的等价物 —— 复刻的节拍器也能推进它，
   *  但这里必须**自己走**：一是立绘要"放完停在最后一帧"（节拍器只管循环推进），
   *  二是要把节奏钉成 `VILLAGE_PLAY_MS`（原版闭包 14 fps ≈ 71ms），不受窗口尺寸影响。 */
  const playingTimers = new Map();
  function playOnce(clip, opts) {
    if (!clip || !clip.gotoAndStop) return false;
    const o = opts || {};
    const last = Math.max(1, clip.frameCount ? clip.frameCount() : 1);
    if (last < 2) return false;                       // 单帧元件没有"自带动画"可播
    const first = Math.max(1, Math.min(last, o.from || 1));
    stopPlay(clip);
    clip.playing = false;                             // 帧号由下面这串定时器推，节拍器别插手
    /* ⚠⚠ 这里**必须**把"钉帧"摘掉 —— 这是上一批"立绘一动不动"的真正原因。
     *  `settleVillage()` 为了让这些立绘默认静止，给它们调过 `pinFrame()`；
     *  `pinFrame` 只是设了 `__pinFrame`，**不会**在 `gotoAndStop` 时自动失效。
     *  而节拍器（render.js 的 ticker）对 `__pinFrame != null` 的实例是**最高优先级**：
     *   每一拍都 `frame = __pinFrame; showFrame()` —— 于是 `playOnce` 刚把帧推到第 2 帧，
     *   ~71ms 后就被拨回第 1 帧。表现就是"悬停上去什么都没发生"（实测：mc1/mc3/mc4/mc5
     *   hover 前后帧号全是 0）。摘掉之后本实例由 playOnce 的定时器独占，节拍器不再碰它。 */
    clip.__pinFrame = null;
    if (clip.holdAnim) clip.holdAnim(true);           // 接管期间静态页策略别冻它（见 render.js）
    villagePlaying.add(clip);                         // 先登记再拨帧：中途任何 settleVillage 都别把它拨回常态
    clip.gotoAndStop(first);
    keepWrapped(clip);
    let f = first;
    const step = () => {
      if (f >= last) {
        playingTimers.delete(clip);
        villagePlaying.delete(clip);
        if (o.loop) { f = first; clip.gotoAndStop(first); keepWrapped(clip); playingTimers.set(clip, setTimeout(step, VILLAGE_PLAY_MS)); }
        return;
      }
      f++;
      try { clip.gotoAndStop(f); } catch (e) {}
      keepWrapped(clip);                              // 换帧把动效壳/热区一起重建了，补回来
      playingTimers.set(clip, setTimeout(step, VILLAGE_PLAY_MS));
    };
    playingTimers.set(clip, setTimeout(step, VILLAGE_PLAY_MS));
    return true;
  }
  /** 停掉某个元件的"播一遍"定时器（并把它从"正在播"名单里摘掉）。 */
  function stopPlay(clip) {
    const t = playingTimers.get(clip);
    if (t) { clearTimeout(t); playingTimers.delete(clip); }
    villagePlaying.delete(clip);
    if (clip && clip.holdAnim) clip.holdAnim(false);   // 交回给静态页策略（它本来就是静态页）
  }
  /** Ensure the presentation shell and hit area exist after explicit frame selection. */
  function keepWrapped(clip) {
    if (!clip || !clip.g || !clip.g.isConnected) return;
    popWrap(clip, true);
    const shell = clip.g.querySelector(':scope > g.uc-pop');
    if (shell) wirePopPress(shell);
  }
  /** Keep feedback transforms separate from the original placement matrix. */
  function popWrap(clip, animate) {
    if (!clip || !clip.g) return false;
    let pop = clip.g.querySelector(':scope > g.uc-pop');
    if (!pop) {
      pop = el('g');
      pop.setAttribute('class', 'uc-pop');
      clip.g.appendChild(pop);
    }
    clip.setContentHost(pop);
    // First wrapping moves artwork only. The renderer retains this host thereafter.
    for (const n of Array.from(clip.g.childNodes)) {
      if (n === pop) continue;
      if (n.nodeType === 1 && n.tagName && String(n.tagName).toLowerCase() === 'defs') continue;
      pop.appendChild(n);
    }
    /* 点击区（`addHitArea` 铺的那块透明矩形）要在换帧后重铺 —— 连同它一起放进壳里，
     * 这样它就跟着缩放走，热区与看到的图标始终一致。
     * `animate` 要**一路传下去**：四处立绘的热区是"所有帧的并集"（见 addHitArea），
     * 换帧时若退回"常态帧 ∪ 当前帧"那档，热区就会跟着动画忽大忽小。 */
    addHitArea(clip, animate);
    const hit = clip.__hitArea;
    if (hit && hit.parentNode !== pop) pop.appendChild(hit);
    return true;
  }
  /** 选中的那一遍动效（`.picked`，见 css 的 `uc-pop-pick`）。
   *  加类 → 强制回流 → 动画播完自动摘掉，所以可以反复触发。
   *  用户 2026-10 口径："活用原本给到村庄内各个 ui 的动画，选中后就展示一遍动画"。 */
  function popPick(clip) {
    const shell = clip && clip.g && clip.g.querySelector(':scope > g.uc-pop');
    if (shell && window.SfUiFeedback) SfUiFeedback.pick(shell);
  }
  function wirePopPress(node) {
    if (node && window.SfUiFeedback) SfUiFeedback.bind(node, { hover: false });
  }
  async function mountVillage(container) {
    destroy();
    const mine = viewSeq;
    await SfRender.loadExtra('tags-home.json');
    if (mine !== viewSeq || container.isConnected === false) return null;
    const view = await SfRender.mount(container, { frame: 30 });
    if (mine !== viewSeq || container.isConnected === false) { view.destroy(); return null; }
    /* 与 mount() 同一条：村庄页是 320×196 整页，#ui 的高度必须按它重算。
     * 从塔页（690）返回村庄时如果不量，SVG 只按高度铺满，左右就会各空一条。 */
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    /* ⚠ 这里**不调** refreshValues：那是主菜单页（`main` 7039）的数值刷新，
     * 村庄页的根子元件叫 `homeMc`（7140），调了只会立刻 return false。 */
    current = view;                 // 村庄页也是一次"挂载中的视图"（调试/自检按 currentView 取）
    wireVillage(view);
    /* 建筑等级的结算放在**进村庄**这一刻（原版 `showHomeLand` → `checkUpgraded`，:9507）：
     * 升级完成、神迹发属性点、并把提示弹出来。结算完再重画一次立绘与倒计时。 */
    try { settleVillageBuildings(); } catch (e) { if (window.__errs) window.__errs.push('village buildings: ' + (e && e.message)); }
    /* 新手引导 f17/f19/f20/f26 都在村庄页（原版 HOME_LAND :9480-9670）。
     * ⚠ UI.currentScreen() 在村庄页仍是 'home'（openVillage 不改 screen），
     * 所以这里显式通知一次。 */
    if (window.SfGuide) { try { SfGuide.onPage('village'); } catch (e) {} }
    return view;
  }
  /** 进村庄时结算"升级完成"（原版 `checkUpgraded` :9763）并把结果告诉玩家。 */
  function settleVillageBuildings() {
    if (!(window.State && State.settleBuildings)) return;
    const done = State.settleBuildings() || [];
    if (!done.length) return;
    const names = { altar: '祭坛', miracle: '神迹', beast: '幻兽牧场' };
    const lines = done.map((d) => {
      if (d.key === 'altar') return '祭坛升级完成啦，特殊状态的触发几率提高了！';
      if (d.key === 'miracle') {
        const add = ['1点力量！', '1点敏捷！', '1点速度！', '5点生命！'][d.addType] || '1个属性点！';
        return '神迹升级完成啦，它为你提高了' + add;
      }
      return '幻兽牧场升级完成啦，松鼠的领导力增加了，并获得了1个存储格和200孵化点！';
    });
    lines.forEach((t) => { try { if (window.UI && UI.toast) UI.toast(t); } catch (e) {} });
    void names;
  }
  /** 重画村庄页的建筑相关显示（等级牌子 / 立绘档位 / 升级倒计时）。
   *  地点页里升级成功之后由 `SfVillage` 回过头来调（见 ui-village.js 的 finishUpgrade）。 */
  function refreshVillageBuildings() {
    const view = current;
    if (!view || !view.setStaticPolicy) return false;
    /* 重新挂一次是最稳的：换帧会重建子树，而"哪些帧该显示什么"全写在策略里。 */
    try {
      const home = view.byName ? view.byName('homeMc') : null;
      if (!home) return false;
      wireVillage(view);
      return true;
    } catch (e) { return false; }
  }
  function wireVillage(view) {
    /* ⚠ 这个函数**会被再调一次**（地点页里升级成功 → `refreshVillageBuildings()` 重画）。
     * 所以：① 立绘/胶囊那套监听只接一次（`__villageWired` 幂等）；
     *       ② 每次都要跑的只有"按等级重算帧 + 重写等级牌子 + 倒计时"。 */
    const already = !!view.__villageWired;
    view.__villageWired = true;
    /* 根时间轴帧 30 的子元件就叫 `homeMc`（= 7140），按钮都在它下面。
     * ⚠ 别用 `byNameDeep`：它内部按 `instanceof MovieClip` 递归，而 `names` 表里存的是**节点**，
     * 递归根本下不去（实测一个按钮都找不到）。直接用 homeMc 自己的 `byName`。 */
    const home = (view.byName && view.byName('homeMc')) || view;
    const rel = (name) => (home && home.byName ? home.byName(name) : null);
    /* ① 村庄页也走**静态页策略**（与状态页 / 挑战页 / 地点弹窗页同一套机制，见 render.js）：
     *   · 立绘这一层（mc1/mc3/mc4/mc5）是**状态帧**（建筑等级外观 / 征战开关），
     *     原版由 `showUpgrading()` 按建筑等级 `gotoAndStop`，复刻没有等级数据 → 停在**基础外观帧**；
     *   · 牌子上的**位图数字精灵**原版是 `showNumber(建筑等级, …)`，没有数据 → 停在**空白档**
     *     （`blankNames`：数字精灵第 1 帧是"0"、末帧才是空白，冻在第 1 帧会显示成一排 0）；
     *   · 白名单里只放 `KEEP_ANIMATED`（3586 那颗上下浮动的图标）—— 用户 2026-10 明确要求
     *     "村庄 ui 本身的动态效果要保留"。
     *  ⚠ 建筑等级牌子（mc1/mc3/mc4 里的 `num` → `num1`/`num2`）**不能进 `blankNames`**：
     *    进了就等于每拍把它们拨回"空白档"，而 `showNumber()` 刚写进去的等级数字会被
     *    当场擦掉 —— 表现是牌子只剩 "Lv"、数字不见了（本批实测）。那一对精灵的自由度
     *    由 `playing = false`（静态页策略默认）就够，不需要额外钉帧。
     *  ⚠ 为什么不再用"事后扫一遍再 pinFrame"：`measureFrameBoxes()`（量热区时会临时把元件
     *    逐帧拨一遍）与 `popWrap()` 都会重建子树，重建出来的新数字精灵当场丢掉钉帧、开始
     *    0~9 循环 —— 表现就是"村庄里建筑等级牌子上的数字乱跳"。规则写在策略里之后，
     *    新实例**出生就自动复位**，不用再管是谁把它们重建了。 */
    if (view.setStaticPolicy) {
      /* `blankNames` 只列**位图数字精灵**（`num` → 里面那对 `num1`/`num2`）：
       * 它们第 1 帧画的是"0"、**末帧才是空白档**（实测 4780 有 12 帧，f1 一个点、f12 空）。
       * 不把这一档写进策略的话：mc3 / mc4 的牌子在第 1 帧出生就显示成两个 "0"。
       * ⚠ 建筑等级**不写进牌子**是有意的 —— 实测原版 mc1 只在**第 1 帧**里放了 `num`，
       *   2~6 档的建筑画稿自己就带等级牌，`MainMovie.as` 里 `showUpdating()` 也只给
       *   mc3/mc4 写 `showNumber(_loc2.level, homeMc.mc3.num, …)`（mc1 写的是 homeMc.num1，
       *   那是**顶栏**的金松果数字），所以这里保持原版的"该空就空"。 */
      view.setStaticPolicy({ keepIds: [...KEEP_ANIMATED], blankNames: [] });
    }
    /* 换帧会重建子树 → 每次换帧后重新"安定"一遍：立绘外框（幂等，已钉住就不动，
     * 免得重建把里面的装饰动画重启）。
     * 2026-10（第一百四十六批）追加：**动效壳与点击区也在这里补回来** ——
     * 换帧把 `<g>` 的子节点整个换掉，壳（`.uc-pop`）会跟着没，所以安定的时候一并重包。 */
    const settleVillage = () => {
      /* 立绘：按**建筑等级**拨帧（原版 `showUpgrading()` 的 `ceil(level/5)`），
       * 正在播升级动画（`villagePlaying`）的那一颗除外 —— 见 `playOnce` 的注释。 */
      for (const name in VILLAGE_MC_ACTIONS) {
        const c = rel(name);
        if (!c || villagePlaying.has(c)) continue;
        pinFrame(c, villageFrameOf(name));
      }
      for (const name in VILLAGE_POP_TARGETS) {
        const c = rel(name);
        if (c) popWrap(c, !!VILLAGE_MC_ACTIONS[name]);     // 立绘：热区按所有帧的并集铺
      }
    };
    /** 建筑等级 → 立绘该停哪一帧（原版 `showUpgrading`，见 VILLAGE_STATE_FRAME 的注释）。
     *  `mc1` 祭坛 / `mc3` 神迹 / `mc4` 幻兽 都是 `ceil(level/5)`；`mc5` 征战是开/关两档。 */
    const buildingOf = (name) => {
      if (!(window.State && State.building)) return null;
      const key = name === 'mc1' ? 'altar' : name === 'mc3' ? 'miracle' : name === 'mc4' ? 'beast' : null;
      return key ? State.building(key) : null;
    };
    /** 当前等级还没解锁时返回提示；空串 = 已解锁。 */
    const lockOf = (action) => {
      if (!(window.State && State.state)) return '';
      const lv = Math.max(1, Number(State.state().level) || 1);
      if (action === 'village-war') {
        const need = Number(State.WAR_UNLOCK_LEVEL) || 35;
        if (lv < need) return 'Lv' + need + ' 解锁';
        if (window.Tower && Tower.unlocked) {
          const u = Tower.unlocked();
          return u.ok ? '' : (u.msg || '通关前 18 关后解锁');
        }
        const passed = State.state().stages || {};
        for (let id = 1; id <= 18; id++) if (!passed[id] || passed[id].passed !== true) return '通关前 18 关解锁';
        return '';
      }
      const key = action === 'village-altar' ? 'altar' : action === 'village-miracle' ? 'miracle' : action === 'village-beast' ? 'beast' : '';
      if (!key || !State.buildingUnlocked) return '';
      return State.buildingUnlocked(key) ? '' : 'Lv' + (State.buildingUnlockLevel(key) || 0) + ' 解锁';
    };
    const villageFrameOf = (name) => {
      const c = rel(name);
      const last = c && c.frameCount ? c.frameCount() : 1;
      /* 未解锁：原版 `showUpgrading()` 对 level 0 是 `gotoAndStop(_totalframes)`，
       * 末帧就是那块“坟墓/空档”外观；不要再停在基础建筑帧上。 */
      if (name === 'mc5') return lockOf('village-war') ? last : 1;
      const key = name === 'mc1' ? 'altar' : name === 'mc3' ? 'miracle' : name === 'mc4' ? 'beast' : null;
      if (!key || lockOf('village-' + key)) return last;
      const b = buildingOf(name);
      if (!b) return last;
      const tier = (State.buildingTier ? State.buildingTier(b.level) : Math.ceil(b.level / 5));
      return Math.max(1, Math.min(last, tier));
    };
    /** 等级牌子上的位图数字（原版 `showNumber(level, mc.num, 0, 0, "left", 2)`）。
     *  ⚠ 只在**牌子真的存在**的那一档写：mc1 的 `num` 只在第 1 帧里（其余 5 档的建筑画稿
     *  自带等级牌），mc3/mc4 每帧都有。牌子不在（或只剩空白档）时**保持空白**，
     *  别把素材里的占位 0 露出来 —— 见 `setStaticPolicy` 的 `blankNames` 注释。 */
    const removeHomeLevelBadge = (v, key) => {
      const host = v && (v.el || (v.root && v.root.parentNode) || (v.g && v.g.parentNode));
      const badge = host && host.querySelector('.ssfight-home-level[data-building="' + key + '"]');
      if (badge) badge.remove();
    };
    const paintBuildingNumbers = () => {
      if (!(window.State && State.building)) return;
      /* 祭坛的等级数字在 homeMc.num1（不是 mc1 里）—— 原版 showUpgrading() 就是
       * `showNumber(building.level, homeMc.num1, ...)`；以前只扫 mc1/mc3/mc4，
       * 所以祭坛牌子永远只剩一个 "Lv"。 */
      const altar = State.building('altar');
      const altarNum = rel('num1');
      if (altarNum) {
        if (altar) showNumber(String(altar.level), altarNum, 0, 0, 'left', 2);
        else blankDigits(altarNum);
      }
      const pairs = [['mc1', 'altar'], ['mc3', 'miracle'], ['mc4', 'beast']];
      for (const [mc, key] of pairs) {
        const c = rel(mc);
        let numClip = null;
        for (const rec of (c && c.nodes ? c.nodes.values() : [])) if (rec.na === 'num' && rec.clip) numClip = rec.clip;
        const b = State.building(key);
        removeHomeLevelBadge(view, key);
        if (!numClip) {
          /* 高等级画稿里 num 图层被导出丢了（mc3/mc4 只有第 1 帧有 num）。
           * ⚠ 不要再补一个 DOM 数字：`getBoundingClientRect()` 返回的是屏幕坐标，
           *   但 CSS 的 left/top 写在 #ui 的设计坐标里；iOS / 全面屏缩放后会把
           *   「1」/「15」飘到神迹或祭坛图标上方（用户 2026-10 反馈）。
           *   原版画稿的牌子本身带等级，这里保持空白即可。 */
          continue;
        }
        if (!b) { blankDigits(numClip); continue; }
        /* 有牌子的那一档才写真实等级。 */
        if (mc === 'mc1' && (State.buildingTier ? State.buildingTier(b.level) : 1) !== 1) { blankDigits(numClip); continue; }
        showNumber(String(b.level), numClip, 0, 0, 'left', 2);
      }
    };
    /** 把一对位图数字留在**末帧（空白档）**（第 1 帧是数字 0，不能留）。 */
    const blankDigits = (numClip) => {
      for (const n of ['num1', 'num2']) {
        const c = numClip && numClip.byName ? numClip.byName(n) : null;
        if (c && c.gotoAndStop) c.gotoAndStop(c.frameCount ? c.frameCount() : 1);
      }
    };
    /** 三处升级倒计时（原版 `getShowTime(remainTime)`）。 */
    const paintBuildTimers = () => {
      if (!(window.State && State.building)) return;
      const show = (mins) => (mins > 0 ? (Math.floor(mins / 60) + '时' + (mins % 60) + '分') : '');
      const a = State.building('altar'), m = State.building('miracle'), b = State.building('beast');
      setText(rel('time1'), a && a.upgrading ? show(a.remainTime) : '');
      setText(rel('time3'), m && m.upgrading ? show(m.remainTime) : '');
      setText(rel('time4'), b && b.upgrading ? show(b.remainTime) : '');
    };
    settleVillage();
    paintBuildingNumbers();
    paintBuildTimers();
    /* 初次装树时 3957 的 num 子精灵可能刚被静态策略重建，紧接着的 paint 会被
     * 后一帧的默认帧覆盖（表现：祭坛有数字，神迹/幻兽只剩 00）。补一拍重画，
     * 和用户手动点一次刷新等价；只重画数字/倒计时，不重挂监听。 */
    if (view.__villagePaintTimer) clearTimeout(view.__villagePaintTimer);
    view.__villagePaintTimer = setTimeout(() => {
      if (current !== view) return;
      try { paintBuildingNumbers(); paintBuildTimers(); } catch (e) {}
    }, 80);
    /* ② 回家 / ③ 地点胶囊 / ④ 立绘那三套监听**只接一次**：本函数会被
     * `refreshVillageBuildings()`（地点页升级成功后重画）再调一次，
     * 再走一遍就会把每颗按钮挂上第二套监听（点一下触发两次）。 */
    if (already) return;
    /* ② 回家（7136）：3 帧里 1 常态 / 2 高亮 / 3 禁用空；里面那颗 9 帧的浮动图标**照原样播**。
     *   悬停/按下额外挂一层 CSS 动效壳（`.uc-pop`），见 popWrap 的注释。 */
    try {
      const back = rel('mainButton');
      if (back && back.g) {
        back.gotoAndStop(1);
        back.g.style.cursor = 'pointer';
        back.g.style.pointerEvents = 'auto';
        measureHitBox(back); popWrap(back);
        const shell = back.g.querySelector(':scope > g.uc-pop');
        if (shell) wirePopPress(shell);
        settleVillage();
        back.g.addEventListener('mouseenter', () => { back.gotoAndStop(2); settleVillage(); });
        back.g.addEventListener('mouseleave', () => { back.gotoAndStop(1); settleVillage(); });
        back.g.addEventListener('click', (e) => {
          e.stopPropagation();
          pressFlash(back, 1, settleVillage);
          if (window.UI && UI.runAction) UI.runAction('home');
        });
      }
    } catch (e) {}
    /* 胶囊与对应建筑共用轻悬停，幅度沿用状态页按钮。只切按钮状态帧，
     * 不播建筑等级帧、不另加picked回弹。relatedTarget仍在组内时不退场；
     * 正在进行的建筑动画由settleVillage保留，不被悬停打断。 */
    const GROUP_ACTIVE = {};
    const mcNameOf = (key) => {
      for (const n in VILLAGE_MC_ACTIONS) if (VILLAGE_MC_ACTIONS[n] === key) return n;
      return null;
    };
    const groupNodes = (key) => {
      const mcName = mcNameOf(key);
      const pill = rel(VILLAGE_PILL_OF[key]);
      const mc = mcName ? rel(mcName) : null;
      const nodes = [];
      if (pill && pill.g) nodes.push(pill.g);
      if (mc && mc.g) nodes.push(mc.g);
      return { pill: pill, mc: mc, nodes: nodes };
    };
    const nodeIn = (nodes, node) => !!node && nodes.some((n) => n === node || (n.contains && n.contains(node)));
    const groupEnter = (key) => {
      const g = groupNodes(key);
      if (g.pill && g.pill.gotoAndStop) g.pill.gotoAndStop(2);
      settleVillage();                       // 胶囊换帧会重建子树：动效壳与热区要补回来
      GROUP_ACTIVE[key] = true;
      for (const clip of [g.pill, g.mc]) {
        const shell = clip && clip.g.querySelector(':scope > g.uc-pop');
        if (shell) shell.classList.add('sf-hover');
      }
    };
    /** `to` = `mouseleave` 的 `relatedTarget`（指针移到了哪个元素上）。 */
    const groupLeave = (key, to) => {
      const g = groupNodes(key);
      if (nodeIn(g.nodes, to)) return;       // 指针还在这一组的另一个元素上
      if (!GROUP_ACTIVE[key]) return;
      GROUP_ACTIVE[key] = false;
      for (const clip of [g.pill, g.mc]) {
        const shell = clip && clip.g.querySelector(':scope > g.uc-pop');
        if (shell && window.SfUiFeedback) SfUiFeedback.clear(shell);
      }
      if (g.pill && g.pill.gotoAndStop) g.pill.gotoAndStop(1);
      settleVillage();
    };
    /** 点击反馈闪完该回哪一帧：指针还停在这一组里就回"选中帧"，否则回常态。 */
    const idleFrameOf = (key) => (GROUP_ACTIVE[key] ? 2 : 1);
    /* ③ 四处地点的胶囊（button6/8/9/10）：常态第 1 帧，**鼠标移上去切 positive（第 2 帧，金色）**，
     *   移开回常态；点一下闪一遍再回常态。
     *   用户 2026-10 口径：悬停就要看到切到 positive，而不是一直静默。
     *   ⚠ 胶囊 3 帧是**三个状态**不是动画（第 3 帧是"禁用/空"），所以悬停只能 `gotoAndStop(2)`；
     *     用 `play()` 会顺着播到第 3 帧变成整块消失。 */
    for (const name of Object.keys(VILLAGE_BUTTONS)) {
      try {
        const clip = rel(name);
        if (!clip || !clip.g) continue;
        clip.gotoAndStop(1);
        clip.g.style.cursor = 'pointer';
        clip.g.style.pointerEvents = 'auto';
        measureHitBox(clip); popWrap(clip);
        const shell = clip.g.querySelector(':scope > g.uc-pop');
        if (shell) wirePopPress(shell);
        const key = VILLAGE_BUTTONS[name];
        /* 悬停只切positive与轻高亮；滑到对应立绘仍算在同组内。 */
        clip.g.addEventListener('mouseenter', () => groupEnter(key));
        clip.g.addEventListener('mouseleave', (e) => groupLeave(key, e.relatedTarget));
        clip.g.addEventListener('click', (e) => {
          e.stopPropagation();
          pressFlash(clip, idleFrameOf(key), settleVillage);
          const lock = lockOf(key);
          if (lock) { if (window.UI && UI.toast) UI.toast((VILLAGE_LABEL[key] || '这里') + '：' + lock); return; }
          if (window.UI && UI.runAction) UI.runAction(key);
        });
      } catch (e) {}
    }
    /* ④ 建筑也可点击，与胶囊共用悬停组。多帧表示建筑等级/征战开关，
     * 不拿来轮播；真实装饰与升级动画保留各自生命周期。
     * 热区仍取所有状态帧的并集。measureFrameBoxes必须在popWrap前执行，
     * 因为量尺寸会临时换帧、重建子节点。 */
    for (const name in VILLAGE_MC_ACTIONS) {
      try {
        const clip = rel(name);
        if (!clip || !clip.g) continue;
        clip.g.style.cursor = 'pointer';
        clip.g.style.pointerEvents = 'auto';
        measureHitBox(clip);
        /* 拨帧量"所有帧的并集"必须在 `popWrap()` **之前**：它每拨一帧都会重建 `<g>` 的子节点，
         * 会把动效壳与已经铺好的热区一起清掉。量完结果缓存在 `__frameBoxes` 上，后面重铺不再重量。 */
        measureFrameBoxes(clip);
        popWrap(clip);
        addHitArea(clip, true);
        const shell = clip.g.querySelector(':scope > g.uc-pop');
        if (shell) wirePopPress(shell);
        const key = VILLAGE_MC_ACTIONS[name];
        clip.g.addEventListener('mouseenter', () => groupEnter(key));
        clip.g.addEventListener('mouseleave', (e) => groupLeave(key, e.relatedTarget));
        clip.g.addEventListener('click', (e) => {
          e.stopPropagation();
          const pill = rel(VILLAGE_PILL_OF[key]);
          if (pill) pressFlash(pill, idleFrameOf(key), settleVillage);
          const lock = lockOf(key);
          if (lock) { if (window.UI && UI.toast) UI.toast((VILLAGE_LABEL[key] || '这里') + '：' + lock); return; }
          if (window.UI && UI.runAction) UI.runAction(key);
        });
      } catch (e) {}
    }
    /* ⚠ 关键：上面每一步 `measureFrameBoxes()` / `popWrap()` / 悬停切帧都会重建立绘子树，
     * 连带把 num 数字精灵拨回出厂占位（神迹/幻兽看起来闪成 00/100）。所有会换帧的接线
     * 做完后再同步重画一次，浏览器这一帧画出来就是正确等级，不再靠 80ms 后补。 */
    try { paintBuildingNumbers(); paintBuildTimers(); } catch (e) {}
  }

  window.SfUiMain = { mount, mountVillage, destroy, refreshValues, showNumber, setText, BUTTON_ACTIONS,
    markMessagesSeen, hasNewMessages,
    /** 地点页里升级成功之后重画村庄页（等级牌子 / 立绘档位 / 升级倒计时）。 */
    refreshVillageBuildings,
    /** 进村庄时结算"升级完成"并把结果告诉玩家（原版 `checkUpgraded`）。 */
    settleVillageBuildings,
    /* 药丸状态格：给自检/调试直接调（也方便探针单独验证"用了药丸主界面会不会出图标"） */
    renderStateIcons, activeStatePills, positionStateIcons,
    /** 当前挂载中的视图（调试与自检用；没挂载时返回 null） */
    currentView: () => current,
    /* ---------- 给 `js/ssfight/ui-village.js`（村庄四个地点的场景页）复用的工具 ----------
     * 那些场景页也是**同一套编译出来的元件**（按钮是 3~4 帧的状态精灵、"可点区域"要自己铺），
     * 所以把这一小组 DOM 侧的通用件导出，别在第二个文件里再抄一遍。
     * ⚠ 只导出"与具体页面无关"的通用件：页面逻辑一律留在各自的文件里。 */
    toolkit: {
      /** 量包围盒（缓存到 `__hitBox`；用常态帧，免得悬停时热区忽大忽小） */
      measureHitBox,
      /** 按包围盒铺一块透明点击区；`animate` = 按**所有帧的并集**铺（多帧状态精灵用）。
       *  ⚠ 铺完会把这颗元件登记进"点击路由"（见 ui-main.js 里那段注释）：热区只是尺子，
       *  真正判定"指针在谁身上"的是挂在 `<svg>` 上的那一根监听器。 */
      addHitArea,
      /** 把元件登记进点击路由（`addHitArea` 已自动调；换帧重建后要手动补的场合用） */
      registerHit,
      /** 注销（元件被换掉/拆掉时用） */
      unregisterHit,
      /** 取某个 `<svg>` 上的点击路由（调试/探针：`r.hit(x,y)` 直接问"这个点归谁"） */
      routerOf,
      /** 把一个多帧元件每一帧的包围盒量出来（结果缓存在 `__frameBoxes`） */
      measureFrameBoxes,
      /** 把元件的可见内容包进 `<g class="uc-pop">`（CSS 悬停/按下动效壳；换帧后要重包） */
      popWrap,
      /** 选中回弹（`.picked`，播完自动摘类） */
      popPick,
      /** 给动效壳挂按下反馈的指针事件 */
      wirePopPress,
      /** 点一下闪一遍"选中帧"再回常态 */
      pressFlash,
      /** 把元件钉在某一帧（不让它自己播） */
      pinFrame,
      /** 把元件**子树里**所有多帧元件钉在第 1 帧（`skip` 里的实例除外） */
      freezeDescendants,
      /** 把元件里的真实文本换掉（一个文本标签可能带多个 `<text>`，会全改） */
      setText,
      /** 原版 `showNumber`：把数值写进 `num1..numN` 那排位图数字精灵（状态页四维用它） */
      showNumber,
      /** 原版 `setFrame`：把数字精灵拨到某一帧（`null` = 空帧） */
      setFrame,
    } };
})();
