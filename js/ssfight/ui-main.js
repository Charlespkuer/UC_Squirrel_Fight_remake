// 村庄主界面（main 帧）接线：原版 MainMovie.as 的 showMain 等价实现，素材走 images/ssfight/ui/。
// 显示层 API 见 render.js；数值全部来自 State，不另存一套。
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SVGNS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs) => {
    const n = document.createElementNS(SVGNS, name);
    if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  };

  /* showNumber：数字精灵 num1..numN，空白 = 最后一帧；数字位 = digit + 1 + type*10。
   * 原版最后一处 `_totalframes` 下标看着像反编译笔误，这里按能正确清空该位的 i+rightMove 写。 */
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

  /** 数字精灵的空白 = 最后一帧；frame 为 null 表示清空。 */
  function setFrame(clip, frame) {
    if (!clip) return;
    let n = frame;
    if (n == null) {
      if (typeof clip.frameCount === 'function') n = clip.frameCount();
      else return;
    }
    if (typeof clip.gotoAndStop === 'function') clip.gotoAndStop(n);
  }

  /* Lv 等级标微调：只动 7032 第 1 帧的 d18（"Lv" 字形 7031）与 d19（数字精灵 4780）。
   * 坐标按舞台单位：d18 是单位阵，d19 base 缩放 0.61 → 局部位移 = 舞台位移 / 0.61。
   * 用 setDepthExtra 附加段，原版矩阵换帧重写也不会冲掉。 */
  const VIP_TEXT_DX = 2.5;      // 正 = 右
  const VIP_TEXT_DY = -1.8;     // 负 = 上（SVG 的 +y 向下）
  const VIP_NUM_SIGMA = 0.61;   // d19 数字精灵原版矩阵的缩放
  const VIP_LV_DEPTH = 18;      // 7032 f1 里 "Lv" 字形的深度
  const VIP_NUM_DEPTH = 19;     // 7032 f1 里 `num` 数字精灵的深度

  /** 超级松鼠等级标：生效停第 1 帧、等级写进子精灵 num（帧号=等级+1）；未生效/到期停第 2 帧（空）。
   *  vipType 第 1 帧 = 新版、第 2 帧 = 旧版 UC VIP。抽出来供 test-ssfight-render 用假 clip 钉帧。 */
  function syncVipBadge(main) {
    const vip = main && main.byName ? main.byName('viplevel') : null;
    if (!vip || !vip.gotoAndStop) return false;
    const level = (window.State && State.vipLevel) ? Math.max(0, Number(State.vipLevel()) || 0) : 0;
    if (level > 0) {
      vip.gotoAndStop(1);
      const num = vip.byName('num');
      if (num && num.gotoAndStop) num.gotoAndStop(Math.min(num.frameCount(), level + 1));
      const type = vip.byName('vipType');
      if (type && type.gotoAndStop) type.gotoAndStop(1);
      /* 每次刷新都重设一遍：换帧 / 重新挂载会重建这两个子节点，附加段跟着节点走。 */
      if (vip.setDepthExtra) {
        vip.setDepthExtra(VIP_LV_DEPTH, 'translate(' + VIP_TEXT_DX + ',' + VIP_TEXT_DY + ')');
        vip.setDepthExtra(VIP_NUM_DEPTH, 'translate(' +
          (VIP_TEXT_DX / VIP_NUM_SIGMA).toFixed(3) + ',' +
          (VIP_TEXT_DY / VIP_NUM_SIGMA).toFixed(3) + ')');
      }
    } else {
      vip.gotoAndStop(2);
    }
    return true;
  }

  /** 写文本：换行必须交给 SfRender.setText（SVG <text> 不认 \r\n）。
   *  兜底要改全部 <text> 子节点，只改第一个会漏出原版占位串。 */
  function setText(node, str, opts) {
    if (!node) return;
    if (window.SfRender && SfRender.setText && SfRender.setText(node, str, opts)) return;
    const list = node.querySelectorAll ? node.querySelectorAll('text') : null;
    if (list && list.length) {
      for (const t of list) t.textContent = str == null ? '' : String(str);
      return;
    }
    if (node.textContent !== undefined) node.textContent = str == null ? '' : String(str);
  }

  /* 昵称描边：paint-order:stroke fill 必须写，否则描边画在填充上会把汉字笔画吃掉。
   * 描边宽度按渲染后的实际字号折算（ratio ≈ 0.16）；写死 px 时窗口一大就变细。 */
  const NAME_STROKE = { ratio: 0.16, min: 1.4, color: '#000000' };
  function paintNicknameStroke(clip) {
    const node = clip && (clip.g || clip);
    if (!node || !node.querySelectorAll) return 0;
    // 字号从字段自己量：屏幕墨高 / 舞台→屏幕倍数；量不到退回 14（textfields.json 的 7039.name）。
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
      // paint-order 同时写 CSS 与属性：Chrome 都认，属性导出成图片也留得住。
      t.setAttribute('paint-order', 'stroke fill');
      t.style.paintOrder = 'stroke fill';
      t.style.strokeLinejoin = 'round';
      n++;
    }
    return n;
  }

  const BUTTON_ACTIONS = {
    button1: 'bag',        // 道具
    button2: 'status',     // 状态
    button3: 'challenge',  // 开始挑战
    button4: 'messages',   // 消息
    button5: 'system',     // 系统
    homeButton: 'village', // 村庄门（20 级才出现）
  };

  /* 徒弟栏压一点存在感：只压饱和/亮度，不动透明度（半透明会和背景混脏）。 */
  const PRENTICE_FX = { filter: 'saturate(.9) brightness(.97)' };

  /* 原版自带、该一直播的装饰动画白名单（元件号 3586：9 帧浮动小图标，村庄门/回家键共用）。 */
  const KEEP_ANIMATED = new Set(['3586']);

  /* 穿装备：原版角色身上几百个挂点空壳在 frame 1 调 getEquipBpData 声明该长哪件；
   * 复刻由 render.js 的 onClip 在挂点实例化时接管。三张表由生成器从原版抠出：
   * tags-gear.json（容器素材）/ gear-frames.json（id→帧号）/ gear-slots.json（挂点→部位）。 */
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
  /* 原版 c 版穿戴：B 容器生成位图，持有者停在 frame + 1，挂点按位图左上角接图。
   * 容器号由 SWF 导出名核对，不能用错位的旧 TSV；window.__gear 仅供本机取证覆盖。 */
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
  /* 每个部位的画稿自身偏移（局部单位，不是舞台单位），只能按装备 id 实测标定；0 = 不补。
   * 标定：?dress=1&gear=<id>&type=<t>&odx=<局部x>&ody=<局部y> 单件渲染后写回表。 */
  const GEAR_OFFSET_BY_ID = {};
  const GEAR_OFFSET = { 0: [0, 0], 1: [0, 0], 2: [0, 0], 3: [0, 0] };
  function gearOffset(type, gearId, go) {
    if (go && go.odx != null) return [Number(go.odx), Number(go.ody || 0)];
    const byId = GEAR_OFFSET_BY_ID[Number(gearId)];
    if (byId) return byId;
    const o = GEAR_OFFSET[type] || [0, 0];
    return (o[0] || o[1]) ? o : null;
  }
  /** mode:attach —— 6 个容器直接挂到 myself 上（原版 chooseEquipLoader 写法）；
   *  手动挂的子节点不进 render.js 的 nodes 表，换帧清扫不会动它。 */
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
    const j = (f) => SfRender.loadTable(f).catch(() => null);
    const [frames, slots] = await Promise.all([j('gear-frames.json'), j('gear-slots.json')]);
    if (!frames || !slots) return null;              // 缺表就老实不穿，别把整页拖挂
    /* 容器 id 从 gear-slots.json 的 container 声明里取（生成器同时写了名字与数字 id） */
    const containerIds = {};
    for (const c of slots.container || []) containerIds[c.type] = c.ids;
    // 橙装（quality 4）沿用原版 q4 画稿帧：同部位同名字匹配，紫稿不再硬当橙稿用。
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

  /** 按当前穿戴算出：① 挂点→容器帧（slot 模式）；② 每部位 {type, symbol, frame}（attach 模式）。 */
  function planWears(tables) {
    if (!tables || !(window.State && State.state && State.state() && State.myGears)) return null;
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
    /* 帧号 = 装备帧号 + 强化等级加成：原版 constructBpData 的 _loc.frame += max(addr1..3Lv)-1。 */
    const frameFor = (g) => {
      const base = tables.frameById.get(Number(g.id));
      if (!base) return 0;
      const orange = g.orange === true || Number(g.quality) > 3;
      const of = orange && tables.orangeFrameById ? tables.orangeFrameById.get(Number(g.id)) : 0;
      /* 强化档必须取 ext 数组里的最大 level：Number(数组) 是 NaN，会吃掉强化偏移导致一直贴基础帧。
       * 卡片对衣服/鞋子不看强化档（配色表只有头/拳套带 addr 档），这里也只用品质量帧。 */
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
    /* 持有者：每个部位一个 189 帧精灵，帧号 = 装备帧号 + 1（原版 chooseEquipLoader:6767）。
     * 第 1 帧是空的、第 2 帧才是第 1 件装备的挂点；少 +1 会放出上一件装备的挂点，全体错位。 */
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

  function inMyself(clip) {
    for (let c = clip; c; c = c.parent) if (c.tag && String(c.tag.id) === MY_SELF_ID) return true;
    return false;
  }
  /* 顶栏数值微调：都用 setExtraTransform 附加段，不改 tags.json（原版矩阵每帧重写）。 */
  /* 经验百分比：在舞台坐标里做 q' = s·q + c，把数字中线搬到经验条中线 39.2、右边缘左移。
   * 每个子节点 base 是 (σ,t)，局部位移 d = ((s−1)·t + c)/σ；% 号单独放大并对齐右边缘。 */
  const PCT_S = 0.92;                       // 数字与小数点的缩放
  const PCT_DX = 8;                         // 整组再往左挪（舞台单位）
  const PCT_RIGHT = 106.4;                  // 数字原来的右边缘（舞台 x）
  const PCT_CX = PCT_RIGHT * (1 - PCT_S) - PCT_DX;
  const PCT_CY = 39.2 - PCT_S * 40.45;
  const pctExtra = (sigma, tx, ty) => 'translate(' +
    (((PCT_S - 1) * tx + PCT_CX) / sigma).toFixed(3) + ',' +
    (((PCT_S - 1) * ty + PCT_CY) / sigma).toFixed(3) + ') scale(' + PCT_S + ')';
  /* % 号（depth 310）单独放大，左沿贴到数字缩放+左移后的右边缘，纵向对齐条中线 39.2。 */
  const PCT_PCT_S = 1.22;
  const PCT_GLYPH_L = 108, PCT_GLYPH_CY = 39.05;
  const pctPctExtra = 'translate(' +
    ((PCT_RIGHT - PCT_DX) - PCT_GLYPH_L * PCT_PCT_S).toFixed(3) + ',' +
    (39.2 - PCT_GLYPH_CY * PCT_PCT_S).toFixed(3) + ') scale(' + PCT_PCT_S + ')';
  /* expNum = 数字本体；d311 = point（小数点）；d310 = % 号（形状，base 是单位矩阵） */
  const PCT_NUM = { name: 'expNum', sigma: 0.68, tx: 81.75, ty: 35.05 };
  const PCT_DOT = { depth: 311, sigma: 0.84, tx: 98.5, ty: 44.95 };
  const PCT_PCT = { depth: 310 };
  /* 金松果数字 num1..num8 整体上移：GOLD_NUM_DY_STAGE 是舞台位移（负=上移），
   * 子节点 base 是 scale 0.53 → 局部位移 = 舞台位移 / 0.53。 */
  const GOLD_NUM_DY_STAGE = -1.0;           // 负 = 上移；相对原版上抬 1.0 个舞台单位
  const GOLD_NUM_DY = (GOLD_NUM_DY_STAGE / 0.53).toFixed(3);
  /* 体力数字 energy/maxEnergy 整组左移：两者 base 都是 scale 0.75 → 局部位移 = 舞台位移 / 0.75。
   * 必须整组一起挪，只挪一半会把 "100/142" 拆开、"/" 错位。 */
  const ENERGY_DX_STAGE = -1.5;             // 负 = 往左（舞台单位）
  const ENERGY_DX = (ENERGY_DX_STAGE / 0.75).toFixed(3);
  /* 昵称只加样式、不动排版：暖白粗体 + 深棕描边/柔影。
   * ⚠ 不要用 filter:drop-shadow()：Android 16 / WebView 133 回前台重排会沿用旧 filter 区域，
   * 把最左边一个字裁掉；柔影改用 text-shadow。 */
  const NAME_STYLE = [
    "font-family:'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif",
    'font-weight:700',
    'fill:#fffdf0',
    'stroke:#4a290d',
    'stroke-width:.42',
    'stroke-linejoin:round',
    'paint-order:stroke fill',
    'letter-spacing:.4px',
    'text-shadow:0 .5px .55px rgba(58,28,4,.85)',
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

  /* 生效药丸 → 右上角三个状态格：原版 showStates 先让 c1..c3 停空帧，再把药丸 attachMovie 进槽。
   * 药丸库元件是运行时按名挂的，静态闭包没有，复刻用道具图标 DOM 盖在槽上；
   * 槽停空帧时自己什么都不画，帧 1 的金边会露出来，所以整块隐藏。 */
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
  /* 槽画稿 3414 是 42.3×42.3；空槽停第 2 帧（空帧），getBoundingClientRect() 量出来 0×0，
   * 所以位置与大小只能算，不能量。 */
  const STATE_SLOT = 42.3;
  /* 药丸图标盒子 = 槽边长 × 1.5：道具矢量四周留白，可见药丸只占 viewBox 的 ~0.67，
   * 放大后可见直径才等于槽边长；盒子比槽大是透明留白，中心仍对齐槽中心。 */
  const STATE_ICON_SCALE = 1.5;
  /* 道具矢量在 viewBox 里不完全居中（速度丸偏下最明显），按 467px 栅格化后可见包围盒实测值
   * 平移回盒子中心；单位是图标盒子边长的比例，PNG 图集本身居中不套。 */
  const STATE_ICON_NUDGE = {
    3: [0.0075, -0.0161],
    4: [0.0021, 0.0064],
    5: [-0.0075, -0.0343],
    7: [-0.0021, -0.0032],
    41: [0, 0],
    42: [0, 0],
    43: [0, 0],
    44: [0, -0.001],
  };
  const STATE_ICON_BASE = 'images/ui/icons/prop/prop-';
  function stateIconSrc(id) {
    const n = Number(id);
    const classic = window.UI && window.UI.classic;
    if (classic && typeof classic.propIconSrc === 'function') return classic.propIconSrc(n);
    return STATE_ICON_BASE + n + '.png';
  }
  /* 上次写进宿主 DOM 的签名。⚠ 它不是"当前该显示什么"的缓存，必须跟宿主 DOM 一起失效：
   * 切模式后新宿主是空的，只比 stateSig 会直接 return（药丸不显示）；判断要签名+宿主戳都对上。 */
  let stateSig = '';
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
  /** svg 用户单位 → 屏幕像素：按根 viewBox 宽与实测宽算。不要逐层乘矩阵：
   *  getScreenCTM 在根时间轴那几层参考系对不上父级（实测 0.95 倍偏差）。 */
  function unitScale(view) {
    const svg = view && view.root;
    if (!svg) return 0;
    const r = svg.getBoundingClientRect();
    const vb = String(svg.getAttribute('viewBox') || '0 0 320 196').split(/\s+/).map(Number);
    return (vb[2] && r.width) ? r.width / vb[2] : 0;
  }
  /** SVG 用户坐标 → 屏幕坐标。不走 getScreenCTM：iOS 15 WebKit 209220 会漏掉祖先 #ui 的 CSS scale。
   *  也不能假设 x/y 缩放相同：全面屏下 #ui 的 sx!==sy；优先复用 SfRender.svgScreenMap。 */
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
  /** 当前生效的药丸（propsStates>0），按 STATE_PILLS 顺序全部返回：
   *  原版只有 c1..c3 三个槽，但四颗药丸可以同时吃满，第 4 颗不能被吞掉。
   *  位置与让位规则交给 positionStateIcons。 */
  function activeStatePills() {
    let states = {};
    try { states = (State.state() || {}).propsStates || {}; } catch (e) { return []; }
    return STATE_PILLS.filter((p) => states[p.id] > 0)
      .map((p) => ({ id: p.id, label: p.label, count: states[p.id] }));
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
        '<img alt="" src="' + stateIconSrc(p.id) + '">' +
        '<b>' + p.count + '</b></span>').join('');
    }
    positionStateIcons(host, view);
  }
  /** 药丸块中心 = 槽中心。坐标坑：.ssfight-states 按设计尺寸 1170 排版，外面还套 #ui 的
   *  --uiscale，写进 left/top 的 CSS px 会被再乘一次；统一用设计像素÷屏幕像素折回。 */
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
    /* 三个槽 c1/c2/c3 的屏幕中心与边长（showStates 固定落点）：空槽停第 2 帧、量包围盒是 0×0，
     * 位置从 ma 推、边长 = 画稿边长 × k × 父级本层缩放 × 本层缩放。
     * ⚠ 别拿 getScreenCTM 行列式当总比例（main 是单位矩阵，混乘会量成 61/383px）。 */
    const slots = ['c1', 'c2', 'c3'].map((name) => {
      const clip = main.byName(name);
      if (!clip || !clip.g) return null;
      const m = placementOf(clip);
      const px = m[4] + m[0] * sx0(clip) + m[2] * sy0(clip);
      const py = m[5] + m[1] * sx0(clip) + m[3] * sy0(clip);
      const p = (clip.parent === main && userToClient(view.root, px, py)) || toScreen(clip.parent, px, py);
      /* k 已经是「SVG 用户单位 → 屏幕像素」，所以 slotSide 本身就是屏幕像素；
       * 不要再乘 hostScale（那是 CSS→屏幕的缩放）。多乘一次会让药丸再缩小 0.55 倍。 */
      const slotSide = STATE_SLOT * k * localScale(clip.parent) * localScale(clip);
      if (!(slotSide > 0)) return null;
      return { cx: p.x + slotSide / 2, cy: p.y + slotSide / 2, side: slotSide };
    }).filter(Boolean);
    /* 槽一个都量不到（还没挂好 / 不是经典 SVG）：把药丸收起来，别让它们堆在左上角
     * 默认位置。旧实现是逐个 `display:none`，这里保留同一兜底。 */
    if (!slots.length) {
      host.querySelectorAll('.ssfight-state').forEach((el) => { el.style.display = 'none'; });
      return;
    }
    const base = slots[0];
    const nodes = host.querySelectorAll('.ssfight-state');
    const n = nodes.length;
    /* 间距沿用 c1→c3 的两个间隔；槽不够 3 个时退回格子边长。 */
    const dx = slots.length >= 3 ? (slots[2].cx - slots[0].cx) / 2 : base.side;
    const dy = slots.length >= 3 ? (slots[2].cy - slots[0].cy) / 2 : 0;
    /* 超过原版 3 个槽时（力/敏/速/经验四颗全吃）：整行向**左**让位，最右一颗仍钉在 c3、
     * 顺序不变 —— 第 4 颗不会被吞掉，也不会把格子顶出右边界。 */
    const overflow = Math.max(0, n - slots.length);
    nodes.forEach((el, i) => {
      const slot = slots[Math.min(i, slots.length - 1)] || base;
      const center = overflow > 0
        ? { cx: base.cx + dx * (i - overflow), cy: base.cy + dy * (i - overflow), side: base.side }
        : slot;
      /* 可见药丸 = 槽边长、中心对齐槽中心；贴图盒子放大 1.5 倍（矢量自带留白），
       * 右下角剩余场次角标才能贴着药丸边缘放。 */
      const pillSide = center.side;
      /* pillSide 是屏幕像素；写进 DOM 的 width/height 是 CSS px，还要被宿主 --uiscale 乘一次。
       * 只 fix left/top 不 fix 宽高时，安卓宿主缩放约 0.55 会把药丸缩成约 17px。 */
      const sideCss = fix(pillSide);
      const iconCss = sideCss * STATE_ICON_SCALE;
      el.style.display = '';
      el.style.left = fix(center.cx - hostRect.left - pillSide / 2) + 'px';
      el.style.top = fix(center.cy - hostRect.top - pillSide / 2) + 'px';
      el.style.width = sideCss + 'px';
      el.style.height = sideCss + 'px';
      el.style.setProperty('--icon', iconCss.toFixed(3) + 'px');
      // 角标按药丸直径缩放（26/80 ≈ 1/3），两个数字的胶囊不会压到隔壁。
      el.style.setProperty('--u', (sideCss / 80).toFixed(4) + 'px');
      /* 矢量可见药丸不完全居中，按实测值平移回中心；药丸走 DOM 而不拨 SVG 帧：
       * refreshValues 每秒都把 c1/c2/c3 拨回空帧。旧 Android 的 PNG 回退与 SVG 同 viewBox，
       * 仍需这条实测校正。 */
      const nudge = STATE_ICON_NUDGE[Number(el.getAttribute('data-pill'))] || [0, 0];
      el.style.setProperty('--nx', (iconCss * nudge[0]).toFixed(2) + 'px');
      el.style.setProperty('--ny', (iconCss * nudge[1]).toFixed(2) + 'px');
    });
  }
  /** 量宿主自身被缩放的倍数（挂 100px 探针）。逐层找 transform 不稳：
   *  #ui 与 .ssfight-home 都可能带缩放，窗口适配时值还会变。 */
  function stateLayoutProbe(host) {
    /* renderStateIcons() 重建 innerHTML 会把探针一起清掉；必须确认它仍在当前 host 下，
     * 否则量到已 detach 的旧探针宽度 0 → hostScale 回退 1，安卓药丸又缩回 17px。 */
    if (!host.__probe || host.__probe.parentNode !== host) {
      const p = document.createElement('div');
      p.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:0;pointer-events:none;visibility:hidden';
      host.appendChild(p);
      host.__probe = p;
    }
    const w = host.__probe.getBoundingClientRect().width;
    return { scale: w ? w / 100 : 1 };
  }
  /* 槽画稿 3414 的原点就是画稿左上角（ma 实测），原点偏移为 0；__stateOrigin 留作标定出口。 */
  function sx0(clip) { return clip && clip.__stateOrigin ? clip.__stateOrigin[0] : 0; }
  function sy0(clip) { return clip && clip.__stateOrigin ? clip.__stateOrigin[1] : 0; }
  /** 父级坐标 `(lx,ly)` → 屏幕坐标（优先用 CTM；拿不到就退回 svg 的矩形按比例估）。 */
  function toScreen(node, lx, ly) {
    const g = node && node.g;
    const ctm = g && g.getScreenCTM && g.getScreenCTM();
    if (ctm) return { x: ctm.a * lx + ctm.c * ly + ctm.e, y: ctm.b * lx + ctm.d * ly + ctm.f };
    return { x: lx, y: ly };
  }

  function refreshValues(view) {
    const main = view && view.byName ? view.byName('main') : null;
    if (!main) return false;
    if (!(window.State && State.state && State.state())) return false;
    /* 经典主界面没有服务端推送/轮询，必须主动跑体力结算，否则停在主界面体力永远不涨。
     * 1s 定时器会重复调用；tickEnergy 内部按 5 分钟间隔结算，是幂等的。 */
    if (State.tickEnergy) { try { State.tickEnergy(); } catch (e) {} }
    const S = State.state();
    const nextExp = Math.max(1, (window.GData && GData.nextExp) ? GData.nextExp(S.level)
      : (S.nextExp || 1));

    const nameClip = main.byName('name');
    setText(nameClip, S.name);                                               // :9378
    /* 昵称字段框 100.65 宽、14 号字，7 个汉字 + 字距已贴边；先套样式再按框宽缩字号，
     * 最后描边（描边宽度跟最终字号走）。 */
    styleName(main);
    if (window.SfRender && SfRender.fitTextWidth) {
      SfRender.fitTextWidth(nameClip, { ascii: 0.72, spacing: 0.4, min: 6 });
    }
    paintNicknameStroke(nameClip);
    setFrame(main.byName('expMc'), Math.ceil(S.exp * 100 / nextExp) + 1);    // :9379
    const pct = Math.floor(S.exp * 1000 / nextExp);                          // :9380（千分比）
    /* ⚠ 经验数字写的是 main.expNum（原版 :9385-:9397 传的都是它）；
     * 写进 main 会跑到金松果 8 个位、expNum 停在默认帧显示 "0000"。 */
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
    /* 徒弟栏按徒弟数切帧（1/2/3 个；没有 → 最后一帧空）；子元件 6941/6961/6981
     * 各自仍在循环，所以背景的徒弟是动的。复刻上限 3（State.apprenticeCap）与原版对齐。 */
    const pr = main.byName('prentices');
    if (pr && pr.gotoAndStop) {
      const n = Math.min(3, ((S.prentices || []).length) | 0);
      pr.gotoAndStop(n > 0 ? n : pr.frameCount());
    }
    if (pr && pr.g) {
      pr.g.style.filter = PRENTICE_FX.filter;
      pr.g.style.opacity = '';
    }
    /* showNewMessage：默认停第 2 帧（隐藏）；没有服务器推送，按战斗记录判断 —
     * 最新一条比"上次看过消息页"新就停第 1 帧（红点）。seen 时间存在存档里（State.msgSeenAt）。 */
    const nm = main.byName('newMessage');
    /* newMessage 是独立红点，不受 button4 的 display 控制；消息键 2 级才解锁，
     * 所以 level>=2 才允许点亮，否则红点会悬在隐藏的按键位置。 */
    const canSeeMessages = Number(S.level) >= 2;
    if (nm && nm.gotoAndStop) nm.gotoAndStop(canSeeMessages && hasNewMessages() ? 1 : 2);
    // c1..c3 停空帧；槽帧 1 的金边会露出来，整块藏掉，长相交给 DOM 药丸。
    for (const cn of ['c1', 'c2', 'c3']) {
      const c = main.byName(cn);
      if (c && c.gotoAndStop) c.gotoAndStop(2);
      if (c && c.g && c.g.style) c.g.style.display = 'none';
    }
    /* 药丸图标只在**主菜单页**（有 c1 的那一页）上画；村庄页的 homeMc 里没有这三个槽。 */
    if (main.byName('c1')) renderStateIcons(view.el, view);
    /* :15947-15966 showViplevel：超级松鼠（VIP）生效 → 等级标；未开通/到期 → 空帧。 */
    syncVipBadge(main);
    // constructMainMenu：1 级只有挑战；2 级加消息/系统；3 级起全开（原版 bitArray）。
    const bits = S.level <= 1 ? [0, 0, 1, 0, 0] : S.level === 2 ? [0, 0, 1, 1, 1] : [1, 1, 1, 1, 1];
    ['button1', 'button2', 'button3', 'button4', 'button5'].forEach((bn, i) => {
      const bc = main.byName(bn);
      const bnode = bc && (bc.g || bc);
      if (bnode && bnode.style) bnode.style.display = bits[i] ? '' : 'none';
      /* 每次重刷都要把五键重新静默一遍（换帧会重建子树、新装饰默认自播）；
       * 但指针正停在上面的那颗不能动，否则选中动画每秒被打断。 */
      if (bc && bc.gotoAndStop && !hoveredButtons.has(bn)) { if (bc.frame !== 0) { try { bc.gotoAndStop(1); } catch (e) {} } settleButton(bc); }
    });
    applyHudTweaks(main);            // 经验百分比 / 金松果数字的微调（幂等，每秒重设无副作用）
    /* 礼包/活动图标的有奖动效要跟着可领取状态走：领完奖回到主界面就停，不能一直闪。 */
    syncGiftVisibility(view && (view.el || view.g));
    syncGiftAttention(view && (view.el || view.g));
    updateEnergyTip(view);
    return true;
  }

  /** 体力条悬停提示：距下次自然恢复还有多久。热区是透明 DOM（SVG 体力条在 UI 路由下 pointer-events 关闭），
   *  位置用 stateLayoutProbe 折回设计像素，文案随 refreshValues 每秒刷新。 */
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

  /** 按钮接动作 + 原版 showButton 的悬停选中态：按钮自己只停常态/选中两个静态帧，
   * 选中帧里的装饰动画照原样播（7004 金飘带、6992/6997/7009/7014 小标）；
   * 不能冻整棵子树，否则悬停动效也被冻住。 */
  function wireButtons(view) {
    const main = view.byName('main');
    if (!main) return;
    /* 换帧会重建子树，热区要重铺；只有已有动效壳的才重包，避免给底栏五键多加 CSS 悬停。 */
    const rewrap = (c) => {
      if (c && c.g && c.g.querySelector('g.uc-pop')) popWrap(c, true);
      else addHitArea(c, true);
    };
    /* 五键固定选择面积先量（会临时拨帧），必须排在后面的 gotoAndStop/addHitArea 之前。 */
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
      /* 热区按所有帧的并集铺（选中帧比常态帧大，只按一帧会"移上去后上方点不到"）；
       * addHitArea 内部缓存 __frameBoxes，并集外还再放一圈 HIT_PAD。 */
      addHitArea(clip, true);
      // 换帧会重建子树、补的点击矩形一起被清掉；两处 gotoAndStop 后都要补回。
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
  /* 「消息」红点：最新战斗记录比"上次看过消息页"新就亮。seen 时间存在存档里（State.msgSeenAt）——
   * 桌面壳 Tauri 每次启动 WebView 都是新数据目录，localStorage 不跨次保留，会每次都有 new。 */
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
  /** 量常态帧包围盒并记住（悬停帧更大，跟着变会让点击区忽大忽小）。
   *  ⚠ 存的是 {x,y,w,h}，addHitArea 必须按同一套键名读；键名错会让整块点击区一个都没铺上。 */
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
    /* 同帧量过就直接用：一次 addHitArea 会问两次包围盒，getBBox 在移动端是强制同步布局。
     * 换帧（__shownFrame 变了）才重新量。 */
    if (clip.__hitBox && clip.__hitBoxFrame === clip.__shownFrame) return clip.__hitBox;
    try {
      const b = measureArtwork(clip);
      if (b && b.width && b.height) {
        clip.__hitBox = { x: b.x, y: b.y, w: b.width, h: b.height };
        clip.__hitBoxFrame = clip.__shownFrame;
      }
    } catch (e) {}
    return clip.__hitBox || null;
  }
  /* 点击区在包围盒并集外再加一圈 HIT_PAD：getBBox 只量矢量轮廓，描边/圆头/悬停小图标都在边界附近，
   * visiblePainted 又只认着色像素，看着像按钮的上沿常点不中。只加 rect[data-hit]，不改布局。 */
  const HIT_PAD = 0.1;          // 相对并集的 10%
  const HIT_PAD_MIN = 2.5;      // 至少往外 2.5 个舞台单位
  /* 底栏五键固定选择面积：先量每颗所有帧的并集（常态小、选中大），换算到父级坐标系；
   * 五颗共用纵向 band，横向按相邻中点切，得到互不重叠也无缝的矩形 -> __fixedHit。
   * 量并集必须先量再包动效壳（拨帧会重建 <g> 子节点）；矩形只在挂载时算一次。 */
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
  /** 给底栏五键铺固定选择面积（见上），只调一次，结果留在 __fixedHit。 */
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
    } catch (e) { /* 量不到就退回"并集 + pad" */ }
  }
  /** 给按钮/立绘补一块和元件内容一样大的透明点击区：SVG <g> 默认只响应着色像素，
   *  否则图标看着大、能点的只有笔画。点击区取「常态帧 ∪ 当前帧 ∪ 整段动画」的并集 ——
   *  悬停帧更大，立绘各帧版面差很多，只按一帧会忽大忽小。量各帧要临时拨帧，量完拨回。 */
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
      // 固定选择面积优先（setupHomeBar 一次算好），照抄，不再叠 pad。
      const fixed = clip.__fixedHit;
      if (fixed) box = { x: fixed.x, y: fixed.y, w: fixed.w, h: fixed.h };
      else {
        const base = measureHitBox(clip);
        if (base) merge({ x: base.x, y: base.y, width: base.w, height: base.h });
        // 本帧没量过才再量一次画稿；measureHitBox 已排除旧热区，重复 getBBox 只会白等重排。
        else { try { merge(measureArtwork(clip)); } catch (e) {} }
        if (animate && clip.frames && clip.frames.length > 1) {
          const keep = clip.frame;
          const union = (clip.__frameBoxes) || (clip.__frameBoxes = measureFrameBoxes(clip));
          for (const b of union) merge(b);
          if (clip.frame !== keep) { clip.frame = keep; try { clip.showFrame(); } catch (e) {} }
        }
      }
      if (!box || !box.w || !box.h) return;
      /* 往外放一圈：比例与最小量取较大者，小图标至少多 2.5 单位，大立绘不被撑太夸张。
       * 固定面积不再放 —— 已按相邻中点切到边界，再放会跟邻居重叠。 */
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
      // 铺完登记进点击路由：热区只当尺子，判定归属由路由器做，否则相邻热区互相抢。
      registerHit(clip, animate);
    } catch (e) { /* 量不到就退回透明矩形自己吃事件 */ }
  }
  /** 量一个多帧元件每一帧的包围盒，缓存在 __frameBoxes；量完把播放头放回原帧。 */
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
  /* 点击路由：一个视图一根监听器。SVG 命中是"谁画得晚谁赢"，底栏热区外扩后相邻重叠
   * 8~12 单位，会亮错/点错；所以热区只当尺子，元件自身 pointer-events 关掉，
   * 由路由器按「真实内容框取面积最小 → 热区取中心最近」判定并派发事件。 */
  const ROUTER_KEY = '__sfRouter';
  /** 触摸设备判定：只用于放行 iOS"没有 pointerdown 的原生 click"；桌面仍校验按下/抬起同一元件。 */
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
  const inBox = (b, x, y) => !!b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  /** 取/建某个 `<svg>` 上的路由器。一个视图只有一根，挂载新视图时会自己失效（svg 换了）。 */
  function routerOf(svg) {
    if (svg[ROUTER_KEY]) return svg[ROUTER_KEY];
    const list = [];
    const r = { svg: svg, list: list, hovered: null, downOn: null };
    /** 元件屏幕框：直接问浏览器，不经 getScreenCTM 换算（WebKit 209220 在 iOS 15.5/15.6 漏掉祖先
     *  CSS transform 的 scale，热区会算到别处）。useHit = 量透明热区；否则先藏热区只量画稿。 */
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
    /** 指针直接落在某个已登记元件的画面像素上：用浏览器命中测试找归属，不依赖 CTM。 */
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
    /** 每次指针事件刷新每个元件的内容框/热区（屏幕坐标）：窗口缩放、翻页、换帧都会让旧盒子失效。 */
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
        // 固定选择面积（底栏五键）：量那块透明热区本身，已按相邻中点切好，不需要 pad。
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
      /* 停用期间判定为未命中（上层弹层打开时底页不响应）。
       * 固定选择面积优先：已按相邻中点切好边界，只按自己块判定，不与附近元件比面积。 */
      if (r.enabled === false) return null;
      refresh();
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
    /* 停用/恢复路由：二级页是另一层 <section>，它的 svg 只铺舞台矩形，四周不挡指针；
     * 底页 pointermove 会继续切行帧，所以弹层打开时只关底页这根路由。 */
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
      /* ⚠ iOS 15 WKWebView 有一类只合成 click、不派发 pointerdown/up 的轻点（Safari SVG 行为）。
       * down 为空时旧代码当"目标不一致"丢掉，表现是 DOM 按钮正常、SVG 按钮全没反应。
       * 触点已由 r.move() 重新命中到 e，触摸设备按坐标放行；鼠标拖拽仍校验 down===e。 */
      const touchClickWithoutDown = ev.detail > 0 && !down && !r.cancelled && touchCapable();
      if (ev.detail > 0 && !touchClickWithoutDown && (r.cancelled || down !== e)) return;
      fire(e, 'click', { clientX: ev.clientX, clientY: ev.clientY, button: 0, detail: 1 });
    });
    svg[ROUTER_KEY] = r;
    return r;
  }
  /** 把一个铺好热区的元件登记进路由器（addHitArea 末尾自动调）。没挂到 <svg> 上
   *  （还在建树/只在量尺寸）就直接返回，不动指针事件，退回透明矩形自己吃事件。 */
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
    /* 已登记元件的子孙不再单独登记；反过来（先子孙后祖先）把子孙摘掉。
     * popWrap 会顺带量热区，选中帧上的浮动小图标会被登记；它更小，"面积最小者胜"必胜，
     * 指针停在按钮靠上位置就被抢归属 → 按钮 mouseleave/enter 无限闪。 */
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
    // 关掉元件自己的指针事件：留着它仍会和邻居抢命中。
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
  /* 点击反馈：按钮四态帧 1=常态/2=选中/3=禁用/4=空；悬停停选中帧（静止），
   * 点击闪一下选中帧 PRESS_MS 再回常态。绝不让元件自己播，3~4 帧来回切就是"乱跳"。 */
  const PRESS_MS = 170;
  /** onFrame（可选）：每拨到一帧回调一次 —— 状态精灵要把闪的这一帧也钉住。 */
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
      // 回常态：装饰一起静默；回选中帧（指针还停着）则保持继续播。
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
  /** 把子树立成静态页：规则按元件名/元件号匹配并随实例继承（见 render.js 静态页策略），
   *  换帧重建的新实例也自动冻结。冻结只写 playing=false，不碰帧号，
   *  gotoAndStop/showNumber/playOnce 照常生效；例外只有原版自带装饰（KEEP_ANIMATED）。 */
  function freezeDescendants(clip) {
    if (!clip || !clip.setStaticPolicy) return;
    clip.setStaticPolicy({ keepIds: [...KEEP_ANIMATED] });
  }
  /** 收集子树里所有多帧子元件（不含自己）。选中帧装饰每次换帧都要重新收；
   *  nodes 里只有 rec.clip 可拨帧，形状没有 clip。 */
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
  /* 底栏五键：原版常态帧没有动画，选中帧才有一颗 15 帧浮动小图标（6992/6997/7004/7009/7014）。
   * 静默 = 停常态帧且子树一个动画都不转；settleButton 每次换帧把除按钮外的多帧子元件钉回第 1 帧。
   * 悬停切选中帧并用 playOnce 从头放装饰（72ms/帧 ≈ 原版 14fps），移开拨回并重新静默。 */
  function settleButton(clip, skip) {
    for (const c of multiFrameKids(clip)) {
      if (skip && skip.has(c)) continue;
      pinFrame(c, 1);
    }
  }
  /** 把选中帧装饰从头放一遍（放完停末帧，移开由 settleButton 拨回）。
   *  ⚠ playOnce 内部会摘 __pinFrame，所以"停"要显式走 stopPlayDecos。 */
  function playButtonDeco(clip) {
    for (const c of multiFrameKids(clip)) playOnce(c, { loop: true });
  }
  /** 停掉子树里所有装饰的"自己播"，交给 `settleButton` 钉回第 1 帧。 */
  function stopPlayDecos(clip) {
    for (const c of multiFrameKids(clip)) stopPlay(c);
  }

  /* 说话板子（库元件 3704）：myself 88 帧一圈，第 1 帧 clearWords、第 40 帧 showWords，
   * 气泡落在 main 内 (107,24)，文案取内置 wordsArray（服务端 config.xml 同款，单机无下发）。
   * 气泡第 1 帧帧尾的 stop() 是动作、导出时被裁掉，所以必须显式 pinFrame(1)，否则推到第 2 帧就消失。 */
  const TALK_BOARD = '3704';
  /** `version == "h"` 的落点（MainMovie.as:15844-15852 的三档里 h 那档）。 */
  const TALK_AT = { x: 107, y: 24 };
  /** 出现在走路圈的第几帧（1-based，与 `sprite6988_frame40.as` 的帧号一致）。 */
  const TALK_FRAME = 40;
  /** wordsArray 原文（顺序、标点照抄）+ 末尾 1 条本复刻加的文案。 */
  const WALK_WORDS = [
    '武器和技能可以升级,升级后会变得更强。',
    '体力是随时间恢复的哦~',
    '招收徒弟可以给你带来额外的收获。',
    '吃药可以补充体力,提升各种属性。',
    '升级武器需要金松果和武器卷轴。',
    '升级技能需要金松果和技能卷轴。',
    '闲着真无聊,快去挑战吧！',
    '带着徒弟去打关卡要轻松得多哦~',
    '关卡的星级代表难度,星星越多越困难哦~',
    '10级就可以去挑战关卡了！',
    '我每天都想见到你,记得来看我哦~',
    '关卡通过后有经验和金松果的奖励。',
    '关卡通过以后，还有几率获得装备碎片哦！',
    '装备可以增加基本属性，让你变得更强大！',
    '20级就可以融合装备啦，神兵利器亲手打造！',
    '30级以上的松鼠可以参加天梯赛！',
    '我要当超级松鼠，享受特权~',
    '想要极品装备和超强道具，就去参加天梯赛！',
    '带我去挑战木头人，看看我有多强！',
    /* 下面这条不是原版 wordsArray（原版 19 条到上一条为止）；两个仓库共用这一份，别再加第二份文案表。 */
    '本复刻版本的作者在github上人称Charlespkuer哦',
  ];

  /** squirrelTalk 的复刻：把 3704 停在气泡帧先藏起来，只挂一次，之后只切显示 + 换文案。
   *  ⚠ 气泡单独挂一层 SVG（.ssfight-talk，z-index 高于 DOM 药丸），否则药丸会压住第一行字；
   *  落点用偏移 viewBox 表达，不在元素上写 transform（老 WebView 对根 svg transform 支持不一）。 */
  async function initTalkBoard(view, container) {
    const main = view && view.byName ? view.byName('main') : null;
    const me = main && main.byName ? main.byName('myself') : null;
    if (!main || !me || typeof me.frameCount !== 'function') return null;
    /* 素材换了 / 帧数不够时宁可不显示，也不要在错误帧上闪一下。 */
    if (me.frameCount() < TALK_FRAME) return null;
    if (!container || !window.SfRender || !SfRender.mountSymbol) return null;
    const host = document.createElement('div');
    host.className = 'ssfight-talk';
    host.setAttribute('aria-hidden', 'true');
    container.appendChild(host);
    /* 落点 = 把 viewBox 左上角挪到 (−107,−24)：与 translate(107,24) 等价，且不用给根 <svg>
     * 写 transform（老 WebView 对根 svg transform 支持不一）。 */
    const tl = (SfRender.timeline && SfRender.timeline()) || {};
    const w = Number(tl.Fw) || 320, h = Number(tl.Fh) || 196;
    const xi = ((tl.Ft && Number(tl.Ft.xi)) || 0) - TALK_AT.x;
    const yi = ((tl.Ft && Number(tl.Ft.yi)) || 0) - TALK_AT.y;
    let board = null;
    try {
      board = await SfRender.mountSymbol(host, TALK_BOARD, { viewBox: xi + ' ' + yi + ' ' + w + ' ' + h });
    } catch (e) {
      if (window.__errs) window.__errs.push('talk board: ' + (e && e.message));
      if (host.parentNode) host.parentNode.removeChild(host);
      return null;
    }
    if (!board) { if (host.parentNode) host.parentNode.removeChild(host); return null; }
    pinFrame(board, 1);                      // 原版帧尾的 stop()
    if (board.root) board.root.classList.add('sf-talk-board');
    return { me: me, board: board, host: host, shown: false };
  }

  /** 走路圈第 40 帧说话 / 第 1 帧收起：用视图节拍钩子读 myself 当前帧，与帧号一一对应，
   *  改帧率也不掉拍。每圈第一次露脸时随机换文案。 */
  function tickTalkBoard(talk) {
    if (!talk || !talk.board || !talk.host) return;
    if (!talk.host.isConnected) return;
    const show = talk.me.frame >= TALK_FRAME - 1;
    if (show === talk.shown) return;
    talk.shown = show;
    if (show) {
      const words = WALK_WORDS[Math.floor(Math.random() * WALK_WORDS.length)];
      setText(talk.board.byName('words'), words, { wrap: true });
    }
    talk.host.classList.toggle('on', show);
    talk.host.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
  /** 收起整层（离开主界面 / 重新挂载时）：视图要 `destroy()`，否则它会留在播放注册表里空转。 */
  function destroyTalkBoard(talk) {
    if (!talk) return;
    if (talk.board && typeof talk.board.destroy === 'function') { try { talk.board.destroy(); } catch (e) {} }
    if (talk.host && talk.host.parentNode) talk.host.parentNode.removeChild(talk.host);
  }

  /* 悬停中的底栏五键（按名字记；refreshValues 按名字遍历，用实例会永远判不中）。 */
  const hoveredButtons = new Set();

  let current = null;
  let timer = 0;
  let viewSeq = 0;
  /** 说话板子那一层的句柄（独立视图 + 宿主 div），`destroy()` 里要显式收。 */
  let talkOverlay = null;

  async function mount(container) {
    if (!window.SfRender) throw new Error('SfRender 未加载');
    destroy();
    const mine = viewSeq;
    /* ⚠ 这一层是村庄主页，要打 ssfight-home-page 标记：classic.css 进二级页时只藏这一层，
     *  不能按 .classic-home 匹配 —— 那会把挑战/状态等 SfRender 整页一起藏掉（战斗后墨绿、
     *  详情切回闪空白）。 */
    container.classList.add('ssfight-home-page');
    /* 装备表必须在建树之前备好：挂点在建树过程中实例化，plan 那一刻就要就绪；
     * 任一步失败只是不穿装备，不影响整页渲染。 */
    let plan = null;
    if (DRESS_ENABLED) {
      try { plan = planWears(await loadGearTables()); }
      catch (e) { if (window.__errs) window.__errs.push('装备表加载失败：' + (e && e.message)); }
    }
    if (mine !== viewSeq || container.isConnected === false) return null;
    const view = await SfRender.mount(container, {
      frame: 20,                                            // 帧 20 = main（村庄）
      onClip: (plan && gearOpts().mode === 'slot') ? (clip) => {
        /* ⚠ 只给主角自己穿：徒弟用同一批库元件、同一批挂点 id，
         * 原版 chooseEquipLoader:6759 / getEquipBpData:6793 都先判 myself。 */
        if (!inMyself(clip)) return;
        /* 持有者钉在装备帧号上（只拨帧、不换符号），才会放出这件装备该用的挂点；
         * 自由播放就是脚部抖动的根源。 */
        const hf = plan.holders.get(String(clip.tag.id));
        if (hf != null) { clip.pinFrame(hf); return; }
        const p = plan.bySlot.get(String(clip.tag.id));
        if (p) {
          /* 留个记号：换了时间轴之后 tag.id 就变容器了，调试时得知道它原本是哪个挂点 */
          if (clip.g && clip.g.setAttribute) clip.g.setAttribute('slot', String(clip.tag.id));
          const go = gearOpts();
          const off = gearOffset(p.type, p.gearId, go);
          /* anchor='none' = 容器原点对齐挂点原点（原版 attachBitmap 语义）；不能把 'none' 传进
           * anchorToBBox（只认 center/bottom/topleft），这里显式转成 null。 */
          const anchor = (!go.anchor || go.anchor === 'none') ? null : go.anchor;
          /* 偏移交给 setSymbol 一起拼（见 render.js 的 anchorToBBox 注释：在外面 append 会被重算抹掉） */
          const tail = off ? ('translate(' + off[0] + ',' + off[1] + ')') : '';
          clip.setSymbol(p.symbol, p.frame, go.scale, anchor, tail);
          /* 挂点留在原版骨骼深度：整体提升会改前后手顺序；换帧重提还会让护肩在两种层序间跳。 */
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
    const talk = await initTalkBoard(view, container);
    if (mine !== viewSeq || container.isConnected === false) {
      destroyTalkBoard(talk);
      view.destroy();
      return null;
    }
    talkOverlay = talk;
    if (talk) {
      const prevTick = view.onTick;
      view.onTick = () => {
        if (typeof prevTick === 'function') { try { prevTick(); } catch (e) {} }
        try { tickTalkBoard(talk); } catch (e) { if (window.__errs) window.__errs.push('talk board: ' + (e && e.message)); }
      };
    }
    /* 页面装好后再让 main.js 量一次布局：经典整页是 320×196（716.625 高），而 #ui 高度按
     * "当前页有没有 .ssfight-home"选 716.625/690；不重量一次，从 DOM 二级页(690)回来时
     * 上下两条边会失去填充。 */
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    /* 数值会变（体力回复、经验/等级），1s 轮询一次重绑；药丸落点也要跟着重算 ——
     * 窗口缩放/全面屏会改 svg 实际尺寸，DOM 叠层不像 SVG 自动等比缩放。 */
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
    /* 药丸那层 DOM 跟着宿主一起被摘掉，缓存也要失效，否则下次挂载会以为已经画过
     * （切模式来回一次药丸就再也不显示）。 */
    stateSig = '';
    /* 悬停名单存的是上一棵树的按钮名；不清掉会让新树第一颗按钮被误判为仍悬停、装饰一直转。 */
    hoveredButtons.clear();
    /* 立绘"播一遍"的定时器也要停：它们挂在**旧实例**上，继续跑只会推一棵已经摘掉的树。 */
    for (const t of playingTimers.values()) clearTimeout(t);
    playingTimers.clear();
    villagePlaying.clear();
    /* 气泡是独立视图（在自己的播放注册表里），挂在 container 上，
     * 不会跟主视图 svg 一起被摘掉，必须显式 destroy。 */
    destroyTalkBoard(talkOverlay);
    talkOverlay = null;
    if (current) {
      try { if (current.destroy) current.destroy(); } catch (e) {}
      current = null;
    }
  }

  /** 左上角礼包/活动入口：原版运行时 attachMovie 的库元件，复刻用 DOM 按钮盖在 SVG 上。 */
  /** 「活动」里还有没处理的奖励，与 classic-ui.js 的 dailyAttention() 同一口径。 */
  function giftAttention() {
    try {
      if (!State.dailyStatus().claimed) return true;
      if (State.questClaimable() > 0) return true;
      const t = (window.ClassicExtras && ClassicExtras.tributeStatus) ? ClassicExtras.tributeStatus() : null;
      return !!(t && t.claimable);
    } catch (e) { return false; }
  }
  /** 3 级起才出现（原版底栏节奏）；1~2 级露出会让玩家提前进商店。 */
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

  /* 村庄页（根帧 30 / homeMc 7140）：与帧 20 的 main 主菜单页不是同一个页面 —— 含四处地点
   * （祭坛/幻兽/神迹/征战，mc1/mc3/mc4/mc5）与底栏四键，左上 mainButton 回家。
   * 素材单独成包 tags-home.json（1.41MB），只有真进村庄才拉。 */
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
  /* 四处地点立绘：原版点击目标就是立绘里那颗 button1，点怪物本身即进地点；
   * 复刻直接把立绘包围盒铺成点击区。mc1=祭坛 / mc4=幻兽 / mc3=神迹 / mc5=征战。 */
  const VILLAGE_MC_ACTIONS = { mc1: 'village-altar', mc4: 'village-beast', mc3: 'village-miracle', mc5: 'village-war' };
  /* 立绘 ↔ 地点胶囊对应表（由 VILLAGE_BUTTONS 反查，单一来源）；悬停立绘或胶囊都高亮胶囊：
   * 原版立绘内嵌 button1 与胶囊是同一交互，胶囊 3 帧 = 常态绿/选中金/禁用空。 */
  const VILLAGE_PILL_OF = {};
  for (const [pill, act] of Object.entries(VILLAGE_BUTTONS)) VILLAGE_PILL_OF[act] = pill;
  /* 带 CSS 悬停/按下动效的村庄元件：四个胶囊 + 回家 + 四处立绘。
   * 胶囊/回家的两帧是静态图，CSS 微放大是唯一悬停动效；立绘有真动画，悬停时放帧不叠 CSS。 */
  const VILLAGE_POP_TARGETS = {};
  for (const n of Object.keys(VILLAGE_BUTTONS)) VILLAGE_POP_TARGETS[n] = 1;
  for (const n of Object.keys(VILLAGE_MC_ACTIONS)) VILLAGE_POP_TARGETS[n] = 1;
  VILLAGE_POP_TARGETS.mainButton = 1;
  /* 立绘是状态帧（建筑等级外观 / 征战开关），原版由 showUpgrading() 按等级 gotoAndStop：
   * mc1/mc3/mc4 = ceil(level/5)（level 0 → 最后一帧空）；mc5 = campaignOpen ? 1 : 2。
   * 不要让它自由播（村庄 UI 乱跳），也不要悬停从头播（那是把所有等级表现一股脑放一遍）。 */
  const VILLAGE_STATE_FRAME = 1;
  /** 正在放自带动画的立绘（mc1/mc3/mc4/mc5）。settleVillage 每帧把没被钉住的立绘拨回
   *  状态帧，不排除它们的话刚播到第 2 帧就被拨回。用实例做键（MovieClip 实例稳定）。 */
  const villagePlaying = new Set();
  /** 立绘自带动画节奏 72ms/帧（原版 14fps ≈71ms）：看得出在播，又不会慢到像卡住。
   *  帧数见 tags-home.json：mc1=6 / mc3=7 / mc4=7 / mc5=2。 */
  const VILLAGE_PLAY_MS = 72;
  /* 建筑升级中的「松鼠修房子」动画：原版 showUpgrading() 在升级中把库元件 5614 attach 到
   * 那一栋建筑容器，挂载参数（x/y/scale，version h）见 REPAIR_AT；祭坛是镜像的。
   * 5614 不在 tags-home 静态闭包里，单独成包 tags-repair.json，真有升级时才 loadExtra。 */
  const REPAIR_SYMBOL = '5614';
  const REPAIR_BUNDLE = 'tags-repair.json';
  const REPAIR_AT = {
    mc1: { x: 450, y: 250, scale: 1 },
    mc3: { x: 190, y: 120, scale: 0.7 },
    mc4: { x: 400, y: 100, scale: 1 },
  };
  let repairBundle = 0;               // 0 未加载 / 1 加载中 / 2 可用 / -1 加载失败
  let repairBundlePromise = null;
  function ensureRepairBundle() {
    if (repairBundle === 2) return Promise.resolve(true);
    if (repairBundlePromise) return repairBundlePromise;
    repairBundle = 1;
    repairBundlePromise = SfRender.loadExtra(REPAIR_BUNDLE).then(() => {
      repairBundle = 2; repairBundlePromise = null; return true;
    }, () => {
      repairBundle = -1; repairBundlePromise = null; return false;
    });
    return repairBundlePromise;
  }
  /** 把元件从头播一遍（放完停末帧；loop=true 循环到 stopPlay）。这是 gotoAndPlay 等价物，
   *  但必须自己走：要"放完停在末帧"，且节奏钉成 VILLAGE_PLAY_MS，不受窗口尺寸影响。 */
  const playingTimers = new Map();
  function playOnce(clip, opts) {
    if (!clip || !clip.gotoAndStop) return false;
    const o = opts || {};
    const last = Math.max(1, clip.frameCount ? clip.frameCount() : 1);
    if (last < 2) return false;                       // 单帧元件没有"自带动画"可播
    const first = Math.max(1, Math.min(last, o.from || 1));
    stopPlay(clip);
    clip.playing = false;                             // 帧号由下面这串定时器推，节拍器别插手
    /* ⚠ 必须摘掉 __pinFrame：settleVillage 给立绘调过 pinFrame()，而节拍器对 __pinFrame 实例
     * 最高优先级，每拍强制拨回 —— playOnce 刚推到第 2 帧就被拨回第 1 帧，表现是"悬停没反应"。
     * 摘掉后本实例由 playOnce 的定时器独占。 */
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
    /* 点击区要在换帧后重铺，并放进壳里跟着缩放走；animate 必须一路传下去 ——
     * 立绘热区是"所有帧的并集"，退回单帧那档会随动画忽大忽小。 */
    addHitArea(clip, animate);
    const hit = clip.__hitArea;
    if (hit && hit.parentNode !== pop) pop.appendChild(hit);
    return true;
  }
  /** 选中那遍动效（.picked）：加类→强制回流→动画播完自动摘掉，可反复触发。 */
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
    /* 同 mount()：村庄页是 320×196 整页，#ui 高度必须按它重算；
     * 从塔页(690)返回时不量，SVG 只按高度铺满，左右各空一条。 */
    try { if (window.Main && Main.resizeLayout) Main.resizeLayout(); } catch (e) {}
    /* ⚠ 这里不调 refreshValues：那是主菜单页 main(7039) 的数值刷新，
     * 村庄页根子元件叫 homeMc(7140)，调了只会立刻 return false。 */
    current = view;                 // 村庄页也是一次"挂载中的视图"（调试/自检按 currentView 取）
    wireVillage(view);
    /* 建筑等级结算放在进村庄这一刻（原版 showHomeLand → checkUpgraded:9507）：
     * 升级完成、神迹发属性点、提示弹出；结算完再重画立绘与倒计时。 */
    let settled = [];
    try { settled = settleVillageBuildings() || []; } catch (e) { if (window.__errs) window.__errs.push('village buildings: ' + (e && e.message)); }
    /* wireVillage 已按结算前的 upgrading 挂过「松鼠修房子」并写倒计时；
     * 真完成升级时立刻重画，否则建筑停在旧档、松鼠还在敲。 */
    if (settled.length) { try { refreshVillageBuildings(); } catch (e) {} }
    /* 新手引导 f17/f19/f20/f26 都在村庄页；UI.currentScreen() 在村庄仍是 'home'，
     * 所以这里显式通知一次。 */
    if (window.SfGuide) { try { SfGuide.onPage('village'); } catch (e) {} }
    return view;
  }
  /** 进村庄时结算"升级完成"（原版 checkUpgraded:9763）并把结果 toast 给玩家。 */
  function settleVillageBuildings() {
    if (!(window.State && State.settleBuildings)) return [];
    const done = State.settleBuildings() || [];
    if (!done.length) return [];
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
    return done;
  }
  /** 重画村庄页的建筑相关显示（等级牌子/立绘档位/倒计时）；地点页升级成功后由
   *  SfVillage 回过头来调（见 ui-village.js 的 finishUpgrade）。 */
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
    /* 会被再调一次（地点页升级成功 → refreshVillageBuildings 重画）：
     * 立绘/胶囊监听只接一次（__villageWired 幂等）；每次都跑的是按等级重算帧 + 牌子 + 倒计时。 */
    const already = !!view.__villageWired;
    view.__villageWired = true;
    /* 根帧 30 的子元件叫 homeMc（7140），按钮都在它下面。⚠ 别用 byNameDeep：
     * 它按 instanceof MovieClip 递归，而 names 表里存的是节点，递归下不去。 */
    const home = (view.byName && view.byName('homeMc')) || view;
    const rel = (name) => (home && home.byName ? home.byName(name) : null);
    /* 村庄静态策略：立绘 mc1/mc3/mc4/mc5 停状态帧（按建筑等级，见 VILLAGE_STATE_FRAME）；
     * 白名单只放 KEEP_ANIMATED（3586 浮动图标）；blankNames 为空 —— 建筑等级牌子不能进
     * 空名单，否则 showNumber 刚写的数字会被当场擦掉。规则写进策略，重建的新实例自动复位。 */
    if (view.setStaticPolicy) {
      /* blankNames 留空：位图数字精灵第 1 帧画 "0"、末帧才是空白，但建筑等级牌子不能进
       * 这个名单 —— 进了等于每拍把 showNumber 刚写的等级擦掉，牌子只剩 "Lv"。
       * 那一对精灵有静态策略的 playing=false 就够。 */
      view.setStaticPolicy({ keepIds: [...KEEP_ANIMATED], blankNames: [] });
    }
    /* 换帧会重建子树 → 每次换帧后重新安定：立绘按等级拨帧（已钉住不动，避免重启动画），
     * 并补回动效壳与点击区。 */
    const settleVillage = () => {
      // 立绘按建筑等级拨帧；正在播升级动画的那颗除外（见 playOnce）。
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
    /** 建筑等级 → 立绘帧：mc1/mc3/mc4 = ceil(level/5)；mc5 = 开/关两档。 */
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
        /* 单机版不再要求「先通前 18 关」（用户 2026-11 口径）：塔入口只看等级。 */
        return '';
      }
      const key = action === 'village-altar' ? 'altar' : action === 'village-miracle' ? 'miracle' : action === 'village-beast' ? 'beast' : '';
      if (!key || !State.buildingUnlocked) return '';
      return State.buildingUnlocked(key) ? '' : 'Lv' + (State.buildingUnlockLevel(key) || 0) + ' 解锁';
    };
    const villageFrameOf = (name) => {
      const c = rel(name);
      const last = c && c.frameCount ? c.frameCount() : 1;
      /* 未解锁：原版 showUpgrading() 对 level 0 是 gotoAndStop(_totalframes)，
       * 末帧就是那块“坟墓/空档”外观；不要再停在基础建筑帧上。 */
      if (name === 'mc5') return lockOf('village-war') ? last : 1;
      const key = name === 'mc1' ? 'altar' : name === 'mc3' ? 'miracle' : name === 'mc4' ? 'beast' : null;
      if (!key || lockOf('village-' + key)) return last;
      const b = buildingOf(name);
      if (!b) return last;
      const tier = (State.buildingTier ? State.buildingTier(b.level) : Math.ceil(b.level / 5));
      return Math.max(1, Math.min(last, tier));
    };
    /** 等级牌子上的位图数字（原版 showNumber(level, mc.num, 0, 0, "left", 2)）。
     *  只在牌子真的存在的那一档写；mc1 的 num 只在第 1 帧里，其余档画稿自带等级牌。 */
    const removeHomeLevelBadge = (v, key) => {
      const host = v && (v.el || (v.root && v.root.parentNode) || (v.g && v.g.parentNode));
      const badge = host && host.querySelector('.ssfight-home-level[data-building="' + key + '"]');
      if (badge) badge.remove();
    };
    const paintBuildingNumbers = () => {
      if (!(window.State && State.building)) return;
      /* 祭坛等级数字在 homeMc.num1（不是 mc1 里）：原版 showUpgrading() 就是
       * showNumber(level, homeMc.num1, ...)；只扫 mc1/mc3/mc4 会让祭坛牌子只剩 "Lv"。 */
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
           * 不要再补 DOM 数字：getBoundingClientRect() 是屏幕坐标，而 CSS left/top 写的是
           * #ui 设计坐标，iOS/全面屏缩放后数字会飘到别的图标上；原版画稿自带等级牌。 */
          continue;
        }
        if (!b) { blankDigits(numClip); continue; }
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
    /* 松鼠修房子：原版只对 upgrading 的建筑 attachMovie，完成后 removeMovieClip。
     * 复刻同状态走：升级 → attachChild('5614') 交给节拍器循环；不在升级 → detachAll 注销。 */
    const repairClips = view.__repairClips || (view.__repairClips = new Map());
    const detachRepair = (name) => {
      const c = repairClips.get(name);
      if (!c) return;
      repairClips.delete(name);
      c.playing = false;
      if (view.live) view.live.delete(c);      // 摘下来的这一颗自己不会再被节拍器回收
      const host = rel(name);
      if (host && host.g) {
        host.g.classList.remove('sf-repairing-host');
        const shell = host.g.querySelector(':scope > g.uc-pop');
        if (shell) shell.classList.remove('sf-repairing');
      }
      if (host && host.detachAll) host.detachAll();
      else if (c.g && c.g.parentNode) c.g.parentNode.removeChild(c.g);
    };
    const repairWanted = () => Object.keys(REPAIR_AT).filter((name) => {
      const b = buildingOf(name);
      return !!(b && b.upgrading && rel(name));
    });
    const attachRepair = () => {
      if (current !== view) return;
      const want = repairWanted();
      for (const name of [...repairClips.keys()]) if (want.indexOf(name) < 0) detachRepair(name);
      for (const name of want) {
        if (repairClips.has(name)) continue;
        const host = rel(name);
        const at = REPAIR_AT[name];
        let clip = null;
        try { clip = host.attachChild(REPAIR_SYMBOL, 1, 'repair'); } catch (e) { clip = null; }
        if (!clip) continue;
        /* 原版 _xscale=-100; _yscale=100; _x+=450; _y+=250 —— 镜像 + 平移；
         * _x/_y 是元件局部坐标，不受 _xscale 影响，所以平移量原样写。 */
        clip.setExtraTransform('matrix(' + (-at.scale) + ',0,0,' + at.scale + ',' + at.x + ',' + at.y + ')');
        clip.holdAnim(true);           // 静态页策略别再把它冻回第 1 帧
        clip.play();                   // 交给渲染层的 14 fps 节拍器循环（原版同样 14 fps）
        /* ⚠ 建筑壳在动画期间禁止 CSS filter/transform：逐帧变化的子树会让 Android WebView /
         * 部分 Chromium 复用旧滤镜区域，背景出现矩形色块（规则见 .uc-pop.sf-repairing）。 */
        if (host.g) {
          const shell = host.g.querySelector(':scope > g.uc-pop');
          if (shell) shell.classList.add('sf-repairing');
          /* 祭坛 mc1 的 cx 会生成 feComponentTransfer 滤镜，区域按 bbox 每帧变；
           * 用 CSS 类压掉宿主 filter（CSS 优先于 presentation attribute），摘掉即恢复。 */
          host.g.classList.add('sf-repairing-host');
        }
        repairClips.set(name, clip);
      }
    };
    const syncRepair = () => {
      const want = repairWanted();
      for (const name of [...repairClips.keys()]) if (want.indexOf(name) < 0) detachRepair(name);
      if (!want.length) return;
      if (repairBundle === 2) attachRepair();
      else ensureRepairBundle().then((ok) => { if (ok) attachRepair(); });
    };
    settleVillage();
    paintBuildingNumbers();
    paintBuildTimers();
    /* 初次装树时 num 子精灵可能刚被静态策略重建，紧接着的 paint 会被后一帧默认帧覆盖
     * （祭坛有数字、神迹/幻兽只剩 00）；补一拍重画，只重画数字/倒计时。 */
    if (view.__villagePaintTimer) clearTimeout(view.__villagePaintTimer);
    view.__villagePaintTimer = setTimeout(() => {
      if (current !== view) return;
      try { paintBuildingNumbers(); paintBuildTimers(); } catch (e) {}
    }, 80);
    /* 回家/胶囊/立绘三套监听只接一次：refreshVillageBuildings 会再调本函数，
     * 再走一遍会给每颗按钮挂第二套监听（点一下触发两次）；修房子状态仍要重算。 */
    if (already) { syncRepair(); return; }
    /* 回家（7136）：3 帧 = 常态/高亮/禁用空；里面那颗 9 帧浮动图标照原样播。
     * 悬停/按下额外挂 CSS 动效壳（.uc-pop），见 popWrap。 */
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
    /* 胶囊与对应建筑共用轻悬停：只切胶囊状态帧，不播等级帧、不加 picked 回弹；
     * relatedTarget 仍在组内时不退场；正在播的建筑动画由 settleVillage 保留。 */
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
    /* 四处地点胶囊：常态第 1 帧，悬停切 positive（第 2 帧金色），移开回常态，点击闪一遍。
     * ⚠ 3 帧是三个状态（第 3 帧禁用/空），悬停只能 gotoAndStop(2)；play() 会播到第 3 帧整块消失。 */
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
    /* 建筑也可点击，与胶囊共用悬停组。多帧表示等级/开关，不轮播；热区取所有状态帧并集。
     * measureFrameBoxes 必须在 popWrap 前执行（量尺寸会临时换帧、重建子节点）。 */
    for (const name in VILLAGE_MC_ACTIONS) {
      try {
        const clip = rel(name);
        if (!clip || !clip.g) continue;
        clip.g.style.cursor = 'pointer';
        clip.g.style.pointerEvents = 'auto';
        measureHitBox(clip);
        /* 拨帧量并集必须在 popWrap 之前：每拨一帧都会重建 <g> 子节点，清掉动效壳与热区。
         * 结果缓存在 __frameBoxes，后面重铺不再重量。 */
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
    /* ⚠ 上面每一步 measureFrameBoxes/popWrap/悬停切帧都会重建立绘子树，把 num 拨回占位
     * （神迹/幻兽闪成 00）；所有会换帧的接线做完后再同步重画一次。 */
    try { paintBuildingNumbers(); paintBuildTimers(); } catch (e) {}
    /* 初次接线放在所有量热区/包壳之后：addHitArea 按包围盒铺，先挂动画会撑大热区。 */
    try { syncRepair(); } catch (e) {}
  }

  window.SfUiMain = { mount, mountVillage, destroy, refreshValues, showNumber, setText, syncVipBadge, BUTTON_ACTIONS,
    markMessagesSeen, hasNewMessages,
    /** 地点页里升级成功之后重画村庄页（等级牌子 / 立绘档位 / 升级倒计时）。 */
    refreshVillageBuildings,
    /** 进村庄时结算"升级完成"并把结果告诉玩家（原版 `checkUpgraded`）。 */
    settleVillageBuildings,
    /* 药丸状态格：给自检/调试直接调（也方便探针单独验证"用了药丸主界面会不会出图标"） */
    renderStateIcons, activeStatePills, positionStateIcons,
    /** 当前挂载中的视图（调试与自检用；没挂载时返回 null） */
    currentView: () => current,
  // 供 ui-village.js 复用的通用件：只导出与具体页面无关的 DOM 工具，页面逻辑留在各自文件。
    toolkit: {
      /** 量包围盒（缓存到 `__hitBox`；用常态帧，免得悬停时热区忽大忽小） */
      measureHitBox,
      /** 按包围盒铺透明点击区；animate = 按所有帧并集铺（多帧状态精灵）。
       *  铺完会登记进点击路由（见 ui-main 里的路由注释）：热区只是尺子，判定由监听器做。 */
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
      /** 把元件子树立成静态页（规则随实例继承；见 render.js 静态页策略）。 */
      freezeDescendants,
      /** 把元件里的真实文本换掉（一个文本标签可能带多个 `<text>`，会全改） */
      setText,
      /** 原版 `showNumber`：把数值写进 `num1..numN` 那排位图数字精灵（状态页四维用它） */
      showNumber,
      /** 原版 `setFrame`：把数字精灵拨到某一帧（`null` = 空帧） */
      setFrame,
    } };
})();
