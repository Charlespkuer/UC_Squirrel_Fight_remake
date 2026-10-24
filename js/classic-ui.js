/* Classic UC screens reconstructed from references. Gameplay remains in State / Sim. */

/* ------------------------------------------------------------
 * 目录：经典 UC 界面（主界面/背包/装备/挑战/关卡/同步）
 * Ctrl+F 搜节号（如「【UC1】」）直达对应代码块。
 *
 *  【UC1】基础小件  【UC2】位图数字  【UC3】图标与属性 HTML
 *  【UC4】页面骨架  【UC5】存档列表弹窗  【UC6】主界面首页
 *  【UC7】状态页与图鉴  【UC8】挑战  【UC9】关卡
 *  【UC10】背包与道具  【UC11】果实三选一 / 属性分配 / 升级选择  【UC12】装备
 *  【UC13】消息 / 复仇 / 好友 / 聊天  【UC14】每日  【UC15】存档导入
 *  【UC16】云同步  【UC17】系统设置 / 村庄 / 攻略  【UC18】兜底分发与导出 UI.classic
 * ------------------------------------------------------------ */
(function () {
  'use strict';
  const legacy = window.UI;
  const W = 1170, H = 690;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  /** 原版特权 4：超级松鼠的昵称带尊贵标识。 */
  const vipBadge = () => { try { return State.vipActive() ? '<span class="vip-badge" title="超级松鼠">\u2605</span>' : ''; } catch (e) { return ''; } };
  /** 「活动」里还有东西没领（每日礼包 / 徒弟日供 / 每日任务）时给图标加提示动效。 */
  const dailyAttention = () => {
    try {
      if (!State.dailyStatus().claimed) return true;
      if (State.questClaimable() > 0) return true;
      const t = (window.ClassicExtras && ClassicExtras.tributeStatus) ? ClassicExtras.tributeStatus() : null;
      return !!(t && t.claimable);
    } catch (e) { return false; }
  };
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => [...(root || document).querySelectorAll(s)];
  /** 滑动条的「已选 / 未选」两段配色：把百分比写进 --fill，CSS 用它切分
   *  左（金色已选）右（浅色未选）。目前只有音乐音量在用。 */
  const fillRange = (el) => {
    if (!el) return;
    const min = Number(el.min) || 0, max = Number(el.max);
    const v = Number(el.value) || 0;
    const pct = Number.isFinite(max) && max > min ? ((v - min) / (max - min)) * 100 : 100;
    const clamped = Math.max(0, Math.min(100, pct));
    el.style.setProperty('--fill', clamped.toFixed(2) + '%');
    /* 【2026-10 用户口径】填充区要按**滑块半径**内缩：滑条本身有体积（圆钮直径 36px），
     * 0% 应当对齐到「轨道左端 + 半个圆钮」，100% 对齐到「轨道右端 − 半个圆钮」。
     * 所以除了百分比，再写一个**无单位**的 0~1 值给 CSS 做 calc（见 .setting-slider 的轨道规则）。 */
    el.style.setProperty('--fillN', (clamped / 100).toFixed(4));
  };
  /* 少数按钮在原版里是整张切图。art 开关只给**页面页脚**那一处用：
   * 弹窗里的按钮必须和「继续闯关」「稍后继续」这些手搓按钮同一套样式 ——
   * 同一个弹窗里一个贴图、一个手搓，美术会不一致。 */
  const buttonArt = { '返回菜单':'return-menu', '更换装备':'change-equipment' };
  /* 翻页箭头不用字体字形（Arial/Georgia 的 ‹ › 墨迹中心天生偏离圆心，且 Windows/macOS
   * 字体回退不同，padding 补偿在一台机器上量好、换台机器又歪）；改用 CSS 边框画的
   * 人字形（.chev），几何对称、跨平台一致。字形保留在视觉隐藏 span 里供读屏。 */
  const btn = (label, action, cls, art) => '<button type="button" class="uc-button ' + (cls || '') + '" data-action="' + esc(action) + '">' + ((art && buttonArt[label]) ? '<span class="reference-button-label">'+esc(label)+'</span><img alt="" class="classic-button-art" src="images/ui/buttons/'+buttonArt[label]+'.png">' : (label === '‹' || label === '›') ? '<span class="reference-button-label">' + label + '</span><i class="chev ' + (label === '‹' ? 'chev-l' : 'chev-r') + '" aria-hidden="true"></i>' : esc(label)) + '</button>';
  const spriteCache = Object.create(null);
  let screen = 'home', timer = 0, activePortrait = null, lastRefresh = 0;
  let catalogPage = 0, bagPage = 0, gearPage = 0;
  let selectedProp = 0;
  let selectedRankGood = 0;
  /* 图集图标的一级子目录：images/ui/icons/<dir>/<kind>-<id>.png（与磁盘结构一一对应）。 */
  const ICON_DIRS = { gear: 'gear', weapon: 'weapon', skill: 'skill', prop: 'prop' };
  const selectedItems = {weapon:0,skill:0};
  let opponents = [], selectedOpponent = null;
  let heroWears = [], wearSignature = '', wearRequest = '';
  // 主页限时药丸角标：id → 效果简述（与 State.useProp/totalStats 的生效口径一致）
  /* ============================================================
   * 【UC1】基础小件：esc / VIP 徽标 / 事件绑定 / 贴图
   * ============================================================ */
  const BUFF_PROPS = [[3, '力量+20%'], [4, '敏捷+20%'], [5, '速度+20%'], [7, '挑战经验+40%'], [41, '力量+40%'], [42, '敏捷+40%'], [43, '速度+40%'], [44, '挑战经验+60%']];
  let buffSignature = '';
  const classicPortrait = new Image(); classicPortrait.src = 'images/ui/characters/squirrel-classic.png';
  const berserkerPortrait = new Image(); berserkerPortrait.src = 'images/ui/characters/squirrel-berserker-classic.png';
  const ninjaPortrait = new Image(); ninjaPortrait.src = 'images/ui/characters/squirrel-green-outfit.png';

  /** 分页签那一排的键名（点它们 = 换页，动效要**播完再换**，否则玩家看不到反馈）。 */
  const TAB_KEYS = ['bag', 'shop', 'exchange', 'status', 'weapons', 'skills', 'challenge', 'friends',
    'arena', 'stages', 'messages', 'chat', 'ranklog', 'revenge', 'toplist', 'system', 'help', 'village', 'vip'];
  function bind(root, actions) {
    $$('[data-action]', root).forEach(b => {
      b.onclick = () => {
        const f = actions[b.dataset.action];
        if (!f) return;
        /* ⑩ 点击缩放动效（见 `popTap` 的注释）：页签这类"点完就换页"的键，
         * 要等这一遍缩放播完再换，否则反馈一闪都没看见。 */
        if (b.classList && (b.classList.contains('uc-tab') || b.classList.contains('sf-feedback'))) popTap(b, () => f(b));
        else f(b);
      };
    });
  }
  function frameUrl(sheet, label) {
    return 'images/ui/sprites/' + sheet + '-' + label + '.png';
  }
  function spr(sheet, label, cls) {
    const url = frameUrl(sheet, label);
    return url ? '<img alt="" class="' + (cls || '') + '" src="' + url + '">' : '';
  }
  /* 金松果图标（**主界面之外统一用这一颗**，用户 2026-10 口径）：
   * 来自原版**道具页**右上角那颗"橡果 + 一堆金币"，从无头渲染图里按轮廓抠成透明 PNG。
   * 注意与主界面那颗不是同一套画稿 —— 主界面（非 ssflight 的经典首页）用的是资源图集
   * `resource_1` 第 18 帧的单颗橡果，那是原版首页自己的样式，别混用。 */
  const GOLD_ICON = 'images/ui/icons/gold-acorn.png';
  function goldIcon(cls) { return '<img alt="" class="' + (cls || '') + '" src="' + GOLD_ICON + '">'; }
  /** 礼包/奖励里的道具图标：金松果（id 8）统一用**经典**那张金松果，
   *  其余走经典道具图。现代 330×330 的 prop-8 只留给现代界面。 */
  function giftIcon(id) { return Number(id) === 8 ? goldIcon() : icon('prop', id); }
  /** 价格 = **金松果贴图 + 数字**（用户 2026-10 第一百五十批口径）。
   *  商店里原本写的是「30 金松果」这种**文字**，与复刻其它地方（顶栏 / 融合页 / 塔）用的
   *  "图标 + 数字"不是一套；现在统一成后者。`title` 保留一句可读文案给读屏与悬停提示，
   *  见 `css/classic-refine.css` 的 `.gold-price`。 */
  function goldPrice(n, title) {
    const num = Math.max(0, Number(n) || 0);
    return '<span class="gold-price"' + (title ? ' title="' + esc(title) + '"' : '') +
      ' role="img" aria-label="' + esc((title ? title + '：' : '') + num + ' 金松果') + '">' +
      goldIcon('gold-price-art') + '<b>' + num + '</b></span>';
  }
  /** 原版贴图标签（只用于显示，点击沿用外层 data-action 元素）。 */  function sprLabel(sheet, label, w, h, title) {
    return '<span class="spr-label' + (title ? ' has-title' : '') + '" style="--sbw:' + w + 'px;--sbh:' + h + 'px"' +
      (title ? ' title="' + esc(title) + '" aria-label="' + esc(title) + '"' : '') + '>' + spr(sheet, label, 'spr-label-art') + '</span>';
  }
  /** 原版贴图按钮：贴图自带中文（背包/商店/兑换…），用于菜单与道具页。
   *  贴图比例未必一致，用占位宽高 + object-fit:contain 保证不变形。 */
  function sprBtn(sheet, label, action, opts) {
    const o = opts || {};
    const w = o.w || 170, h = o.h || 62;
    return '<button type="button" class="spr-button ' + (o.cls || '') + '" data-action="' + esc(action) + '"' +
      (o.title ? ' title="' + esc(o.title) + '" aria-label="' + esc(o.title) + '"' : '') +
      ' style="--sbw:' + w + 'px;--sbh:' + h + 'px">' + spr(sheet, label, 'spr-button-art') + '</button>';
  }
  // 原版位图数字 num_28：26×23 一格，含 0-9 % ×。参考图里首页的等级、
  // 体力、Exp 与金松果都用它，比系统数字字体更贴近截图。
  // 用 canvas 按设计尺寸 1:1 绘制再交给 --uiscale 缩放，所以任何窗口
  // 尺寸下边缘都干净（纯 CSS 百分背景在 Chrome 上切不出正确的字）。
  // --st 是横向拉伸：图集里的数字比参考图窄，拉宽后更接近截图观感。
  /* ============================================================
   * 【UC2】位图数字（原版数字贴图渲染）
   * ============================================================ */
  const NUM_SHEET = 'images/ui/numbers/num_28.png', NUM_W = 26, NUM_H = 23;
  const NUM_KEYS = '0123456789%×';
  const numImage = new Image(); numImage.src = NUM_SHEET;
  const numeral = (n) => String(n == null ? '' : n).replace(/[^0-9%×/.,:+-]/g, '');
  const numStretch = () => (window.Debug && Debug.numberStretch ? Debug.numberStretch() : 1.25);
  // 字距：字形宽度保持不变（沿用上面的横向拉伸），只把推进距离收紧。
  // 图集里每个数字左右各有 2~7px 空白，收到 0.86 仍然留得住间隙。
  const NUM_ADVANCE = 0.86;

  function renderNumbers(root) {
    if (!numImage.complete || !numImage.naturalWidth) return;
    const stretch = numStretch();
    const blocks = root?.matches?.('.num[data-text]') ? [root] : $$('.num[data-text]', root || document);
    for (const block of blocks) {
      const canvas = $('canvas', block), height = block.clientHeight;
      if (!canvas || !height) continue;
      const text = block.dataset.text;
      // canvas 的像素尺寸=设计尺寸；外框宽度由 --n/--st 决定，#ui 的
      // --uiscale 统一缩放。这里绝不能写 canvas 的显示尺寸，否则会二次缩放。
      const k = height / NUM_H;
      const glyph = NUM_W * k * stretch;            // 单个数字的绘制宽度
      const adv = glyph * NUM_ADVANCE;              // 数字之间的推进距离
      const width = Math.max(1, Math.round(Math.max(0, text.length - 1) * adv + glyph));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const cx = canvas.getContext('2d');
      cx.clearRect(0, 0, width, height);
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      for (let i = 0; i < text.length; i++) {
        const at = NUM_KEYS.indexOf(text[i]);
        if (at >= 0) {
          cx.drawImage(numImage, at * NUM_W, 0, NUM_W, NUM_H, i * adv, 0, glyph, height);
        } else {
          // 位图里没有的符号（如 "/"）用文字补齐，字号与数字同高。
          cx.font = 'bold ' + Math.round(height * 0.86) + 'px "Microsoft YaHei",sans-serif';
          cx.textAlign = 'center';
          cx.textBaseline = 'middle';
          cx.lineWidth = Math.max(1.5, height * 0.09);
          cx.strokeStyle = 'rgba(94,100,106,.95)';
          cx.fillStyle = '#fdfdfa';
          cx.strokeText(text[i], i * adv + glyph / 2, height * 0.55);
          cx.fillText(text[i], i * adv + glyph / 2, height * 0.55);
        }
      }
      const emWidth = ((Math.max(0, text.length - 1) * adv + glyph) / height).toFixed(4);
      block.style.setProperty('--w', emWidth + 'em');
    }
  }
  function bindNumImage() {
    if (numImage.complete && numImage.naturalWidth) renderNumbers();
    else numImage.addEventListener('load', () => renderNumbers(), { once: true });
  }
  bindNumImage();

  function num(value, plain) {
    const text = numeral(value);
    // plain=true 时用系统字体直接排字：位图数字的原图只有 23px 高，
    // 首页 HUD 要放到 30~32px，等于把 23px 的图放大 1.4 倍，怎么调都发虚。
    if (plain) return '<span class="num plain" data-text="' + esc(text) + '" style="--n:' + text.length + '" role="img" aria-label="' + esc(text) + '"><u>' + esc(text) + '</u></span>';
    // <u> 是位图加载前的占位文字（加载失败时也不会空白），位图画好后由 CSS 隐藏。
    return '<span class="num" data-text="' + esc(text) + '" style="--n:' + text.length + '" role="img" aria-label="' + esc(text) + '"><canvas></canvas><u>' + esc(text) + '</u></span>';
  }
  /** 数字内容变了才重画；没变就不动，避免每帧重复绘制。 */
  function setNum(host, value) {
    if (!host) return;
    const text = numeral(value);
    if (host.dataset.text === text) return;
    host.dataset.text = text;
    host.style.setProperty('--n', text.length);
    if (host.classList.contains('plain')) {
      const u = $('u', host);
      if (u) u.textContent = text;
      return;
    }
    renderNumbers(host);
  }
  // Original atlases alternate a colour row and a grey row. Item IDs retain gaps.
  /* ============================================================
   * 【UC3】图标与属性 HTML
   * ============================================================ */
  function atlasIcon(kind, id, locked, trueForm) {
    /* 图标按类型分了目录（images/ui/icons/<类型>/<类型>-<id>.png），而 kind 是运行时变量，
     * 所以查 ICON_DIRS 表 —— 不能再拼死路径（漏改这里会让背包/融合的图标全裂）。 */
    const dir = ICON_DIRS[kind] || 'misc';
    // 真·武器用的是素材库里的另一套图：images/ui/icons/weapon/weapon-true-<id>.png
    if (kind === 'weapon' && trueForm) return 'images/ui/icons/weapon/weapon-true-' + id + (locked ? '-locked' : '') + '.png';
    if(kind==='weapon' && +id===1 && !locked)return 'images/ui/icons/weapon/weapon-1-classic.png';
    /* 原版 Flash 有、H5 图集里没有的三件道具：82 从符号 2419 导出；
     * 79/90 用同风格手绘 SVG 占位（原版没有导出对应的物品图标）。 */
    if (kind === 'prop' && [79, 82, 90].includes(+id)) return 'images/ui/icons/prop/prop-' + (+id) + '.svg';
    return 'images/ui/icons/' + dir + '/' + kind + '-' + id + (locked ? '-locked' : '') + '.png';
  }
  /** 等级 11~15 = 真1~真5；显示成「真N」，10 级及以下显示 LVn。 */
  const levelLabel = (level, withPrefix) => {
    const t = (window.GData && GData.trueLevel) ? GData.trueLevel(level) : 0;
    if (t > 0) return '真' + t;
    return withPrefix === false ? String(level) : 'LV' + level;
  };
  const isTrueGear = (item) => !!item && (window.GData && GData.trueLevel ? GData.trueLevel(item.level) > 0 : Number(item.level) > 10);
  /* 真形态专属卡面（带「真」字红章的方卡）：images/ui/cards/true/<kind>-<id>.png。
   * 那个目录里其实混着**两套**图：灰色版（未解锁时显示，见下面 icon() 里的 grey 名单）
   * 与真·版（本名单）。真·版只覆盖一部分 id —— weapon 1/5/6/8、
   * skill 1/2/4/5/6/10/11/12/13/16/17/24（与素材目录逐一对过，改素材时要同步这张表）。
   * 其余真武器继续走 icons/weapon-true-<id>.png；真技能没有别的素材，就到此为止。 */
  const TRUE_CARD_IDS = { weapon: [1, 5, 6, 8], skill: [1, 2, 4, 5, 6, 10, 11, 12, 13, 16, 17, 24] };
  function icon(kind, id, locked, selected, trueForm) {
    /* 真形态优先走专属贴图 —— **必须放最前面**：下面「参考卡」那几条会提前 return，
     * 而方天画戟(1)/死老鼠(5)/橡皮擦(7)/菜刀(8)/可口可乐(9)/死神镰刀(15) 都在
     * reference.weapon.learned 里，导致真化武器在未选中时显示普通卡面，
     * 点一下（selected=true）才变真形态。
     * 2026-10 用户反馈：真化武技在武器&技能界面不直接展示特殊贴图（技能此前根本没有）。 */
    if (trueForm && TRUE_CARD_IDS[kind] && TRUE_CARD_IDS[kind].includes(+id)) {
      return '<img alt="" class="reference-art" src="images/ui/cards/true/' + kind + '-' + id + '.png">';
    }
    if (kind === 'weapon' && trueForm) return '<img alt="" src="' + atlasIcon('weapon', id, locked, true) + '">';
    /* 道具图标统一走图集切图（atlasIcon → images/ui/icons/prop/prop-<id>.png）。
     * 以前是「未选中走参考截图 new-reference/props（带底板的截图卡片）、选中走图集切图」，
     * 同一件东西点一下就换成画风与尺寸都不同的另一张图（用户 2026-10 反馈「差异很大」）。
     * 现在两态同一张图：选中与否由格子的边框/高亮表达 ——
     * 图集图不带 .reference-art 类，所以 .item-icon 会拿回经典方框底色，
     * 选中态就是 .catalog-cell.selected 的绿框，跟武器/技能/装备一个口径。 */
    const reference = {
      weapon: { learned: [1,5,7,8,9,15], locked: [2,3,4,6,10,12,13,14] },
      skill: { learned: [2,3,4,7,9,13,15,18], locked: [1,5,6,8,10,11,12,14,17] }
    };
    const state = locked ? 'locked' : 'learned';
    if (reference[kind]?.[state].includes(+id) && !selected || kind==='skill' && +id===16 && !locked && selected) {
      return '<img alt="" class="reference-art" src="images/ui/cards/state/'+kind+'-'+id+'-'+state+'.png">';
    }
    const grey={weapon:[2,3,4,7,9,10],skill:[3,7,8,9,14,15,18,23]};
    const fromReference=(locked && grey[kind]?.includes(+id)) || (!locked && kind==='skill' && [6,13].includes(+id));
    return '<img alt="" '+(fromReference?'class="reference-art" ':'')+'src="'+(fromReference?'images/ui/cards/true/'+kind+'-'+id+'.png':atlasIcon(kind,id,locked))+'">';
  }
  function statsHtml(stats, cls) {
    // 数字单独包一层 .stat-value：状态页的四项数字要能单独往上微调，不带着圆形字徽一起动
    return '<div class="' + (cls || 'stat-strip') + '">' + [['力','power'],['敏','agility'],['速','speed'],['命','hp']].map(([s,k]) => '<div class="stat-pill"><b>' + s + '</b><span class="stat-value">' + esc(stats[k]) + '</span></div>').join('') + '</div>';
  }
  // 升级奖励面板用的属性图标：直接复用已按颜色分好的道具图标（3 力 / 4 敏 / 5 速 / 7 经验）。
  // 原版没有单独的「生命」图标，用同风格的圆形字徽补上。
  const STAT_ICON = { power: 3, agility: 4, speed: 5 };
  const STAT_CHAR = { power: '力', agility: '敏', speed: '速', hp: '命' };
  /** 系统代选卡片用的图标：力/敏/速沿用彩色道具图标，生命没有贴图，退回「命」字徽。 */
  const pointArt = (key) => {
    const id = STAT_ICON[key];
    return id ? '<img alt="" class="reward-icon-img" src="' + atlasIcon('prop', id) + '">' : '<b class="reward-badge">' + STAT_CHAR[key] + '</b>';
  };
  /** 升级奖励面板，参考 references/new/13401b861367adab44aede056.webp：
   *  顶部「升级奖励」贴图牌 + 一排属性卡片（图标 + 属性名增量的说明）。 */
  function upgradeReward(ups) {
    const list = (ups || []).filter(Boolean);
    if (!list.length) return '';
    return list.map((u) => {
      const stats = [
        ['power', '力量', u.power, 'red'],
        ['agility', '敏捷', u.agility, 'blue'],
        ['speed', '速度', u.speed, 'green'],
        ['hp', '生命', u.hp, 'pink'],
      ].filter(([, , v]) => Number(v) > 0);
      const cards = stats.map(([key, label, value, cls]) => {
        const id = STAT_ICON[key];
        const art = id
          ? '<img alt="" class="reward-icon-img" src="' + atlasIcon('prop', id) + '">'
          : '<b class="reward-badge">' + STAT_CHAR[key] + '</b>';
        return '<div class="reward-card ' + cls + '"><span class="reward-icon">' + art + '</span>' +
          '<span class="reward-text">' + label + '+' + esc(value) + '</span></div>';
      });
      const bonus = u.attributeBook ? '<div class="reward-card skill"><span class="reward-icon">'+icon('prop',37)+'</span><span class="reward-text">属性书 ×1</span></div>' : u.reward
        ? '<div class="reward-card skill"><span class="reward-icon">' + icon(u.rewardKind === 'weapon' ? 'weapon' : 'skill', u.rewardId) + '</span>' +
          '<span class="reward-text">' + esc(u.reward) + '</span></div>'
        : '';
      // 系统代选的那一点：已经进属性了，顺手在面板上说明原因。
      // （玩家自选的点走升级弹窗，点数不在界面常驻显示。）
      const point = u.autoPoint
        ? '<div class="reward-card point"><span class="reward-icon">' + pointArt(u.autoPoint) + '</span>' +
          '<span class="reward-text" title="' + STAT_CHAR[u.autoPoint] + '占比低于门槛，系统直接代选">' + STAT_CHAR[u.autoPoint] + '+' + State.STAT_GAIN[u.autoPoint] + '<span class="point-tag">系统代选</span></span></div>'
        : '';
      // 武器/技能三选一：卡片只做提示，真正的选择在弹窗里
      const wsPick = u.wsChoice
        ? '<div class="reward-card skill"><span class="reward-icon"><b class="reward-badge ws-badge">选</b></span>' +
          '<span class="reward-text">武器/技能 三选一</span></div>'
        : '';
      /* 71~90 级每级 1 个金宝箱（原版 `showReward` 的 `propId` 那一格）。 */
      const chestCard = u.chest
        ? '<div class="reward-card gift"><span class="reward-icon">' + icon('prop', 90) + '</span>' +
          '<span class="reward-text">金宝箱 ×' + esc(u.chest) + '</span></div>'
        : '';
      const giftCards = (u.gifts || []).map((g) =>
        '<div class="reward-card gift"><span class="reward-icon">' + giftIcon(g.id) + '</span>' +
        '<span class="reward-text">' + esc(g.name) + ' ×' + esc(g.count) + '</span></div>').join('');
      return '<div class="reward-panel">' +
        '<div class="reward-title"><img alt="升级奖励" src="' + frameUrl('resource_10', 3) + '"></div>' +
        '<div class="reward-row">' + cards.join('') + point + wsPick + bonus + chestCard + giftCards + '</div>' +
        '<div class="reward-level">升到 ' + esc(u.level) + ' 级</div></div>';
    }).join('');
  }
  /** 战斗结算里显示升级奖励；没有升级时返回空串。 */
  function upsHtml(ups) {
    const list = (ups || []).filter(Boolean);
    return list.length ? '<div class="reward-stack">' + upgradeReward(list) + '</div>' : '';
  }
  /** 现代模式的战后收益弹窗。
   *
   *  `reward` = 结算方（随机挑战的 `State.fightReward`）算出的本场经验/金松果/升级，
   *  `loot`   = 战斗中随机飘出来、玩家点到的拾取物（含其中的经验/金松果）。
   *  两者是**两包独立的收益**：以前这里只看 `loot`，所以弹窗只列了「战斗拾取」，
   *  经验、金松果和结算带来的升级全被吞掉了（用户 2026-10 口径）。
   *  现在先写「战斗奖励」，再写「战斗拾取」，最后合并两边的升级奖励。
   *
   *  ⚠ 经典模式不会走这里：原版战果页自己就写经验/金松果/战利品（见 main.js 的
   *  `classicFight` 判断）。本函数只服务现代界面与塔的层结算。
   *  `winner` = 0 玩家胜 / 1 玩家负；有值时在弹窗最上面写「胜 利！」/「战 败…」。 */
  function pickupResult(loot, reward, winner) {
    loot = loot || {};
    const items = Array.isArray(loot.items) ? loot.items : [];
    const ups = [...(Array.isArray(loot.ups) ? loot.ups : []),
      ...((reward && Array.isArray(reward.ups)) ? reward.ups : [])];
    const exp = Math.max(0, Math.round(Number(reward && reward.exp) || 0));
    const gold = Math.max(0, Math.round(Number(reward && reward.gold) || 0));
    /* 没有任何收益时**不弹空窗**：以前这里只挡了「无收益且没有胜负」，
     * 于是塔战这种 `collectDrops:false`、又没有 `rewardFor` 的战斗会留下一个只有
     * 「胜 利！」和「确定」的「战斗拾取」（用户 2026-10 截图）。胜负大字是收益弹窗的
     * 抬头，不是弹窗存在的理由；真正需要单独报胜负的地方各自有专门的弹窗。 */
    if (!items.length && !ups.length && !reward) return;
    const grouped = Object.create(null);
    items.forEach(item => { if(grouped[item.id])grouped[item.id].count+=item.count;else grouped[item.id]={...item}; });
    /* 「跳过键」的代价（2026-10 用户口径）：这一场只收 2/3 —— 随机抹掉的那一项在这里说清楚，
     * 免得玩家以为掉落莫名其妙少了一份（普通战斗的口径见 battle-drops 的 skip）。
     * 塔的层结算是**一包一包**抹的（仍用 trimOne），所以 `lost` 可能是数组。 */
    const lostList = Array.isArray(loot.lost) ? loot.lost : (loot.lost ? [loot.lost] : []);
    const lost = lostList.length ? '<div class="battle-loot-summary lost">跳过战斗：随机少收了 ' +
      lostList.map(x => esc(x.name) + ' ×' + x.count).join('　') + '</div>' : '';
    /* 没有 `reward` 时（塔的层结算 / 旧调用）保持原来的「战斗拾取」标题与版式。 */
    const rewardLine = reward
      ? '<div class="battle-loot-summary reward">战斗奖励：经验 +' + exp + '　金松果 +' + gold + '</div>'
      : '';
    const lootLine = items.length
      ? '<div class="battle-loot-summary">战斗拾取：' +
        Object.values(grouped).map(item => esc(item.name) + ' ×' + item.count).join('　') + '</div>'
      : '';
    /* 「胜利 / 失败」大字：与经典结果页同一套 `.result-title` 颜色语义，只是字号再放大一档。 */
    const outcome = (winner === 0 || winner === 1)
      ? '<div class="result-title battle-outcome ' + (winner === 0 ? 'win' : 'lose') + '">' +
        (winner === 0 ? '胜 利！' : '战 败…') + '</div>'
      : '';
    const html = rewardLine + lootLine + lost + upsHtml(ups);
    const title = reward ? '战斗结算' : '战斗拾取';
    const bodies=$$('.classic-modal-overlay .modal-body');
    if (bodies.length) {
      const body = bodies[bodies.length-1];
      /* 已经开着升级奖励 / 三选一弹窗时：胜负大字放在最上面，收益接在最下面，
       * 不另叠一层弹窗（否则玩家要连关两次）。
       * ⚠ 但**关卡战果**弹窗自己已经有「胜 利！」大字了（`stageResult` 的
       * `.result-title.battle-outcome`）。这里再插一条就会出现两个「胜 利！」——
       * 用户 2026-10 报的「关卡奖励弹窗两个胜利大字」。已有标题时只补收益。 */
      if (outcome && !body.querySelector('.result-title')) body.insertAdjacentHTML('afterbegin', outcome);
      body.insertAdjacentHTML('beforeend', html);
    } else {
      modal(title, outcome + html, [{label:'确定'}], {small:true});
    }
  }
  /* ============================================================
   * 【UC4】页面骨架：tabs / page / modal / notice / toast
   * ============================================================ */
  function closeOriginalResult() { if (window.SfFightResult) SfFightResult.destroy(); }
  function home() { Main.showHome(); }
  /* 道具和状态页一样：按下反馈由pointerdown负责，click直接更新，不再重播。 */
  function popTap(el, run, now) {
    const f = window.SfUiFeedback;
    if (!f) { if (run) run(); return; }
    const page = el && el.closest && el.closest('.classic-page');
    const bag = page && /^(bag|shop|exchange)$/.test(page.dataset.screen);
    f.tap(el, run, { delay: bag || now ? 0 : 160, exit: !bag && !now, press: !bag });
  }
  /** 把一页里所有该有动效的键接上（分页签 / 物品格 / 底栏键）。只在道具相关页调。 */
  function wirePopTaps(root, opts) {
    opts = opts || {};
    const nodes = [];
    if (opts.tabs) nodes.push(...$$('.classic-tabs .uc-tab', root));
    if (opts.cells) nodes.push(...$$('.catalog-cell:not(.empty-slot)', root));
    if (opts.footer) nodes.push(...$$('.page-footer .uc-button', root));
    if (opts.arrows) nodes.push(...$$('.page-arrow .uc-button', root));
    const f = window.SfUiFeedback;
    if (!f) return;
    for (const n of nodes) {
      f.bind(n, { selected: () => n.classList.contains('selected') || n.classList.contains('active') });
    }
  }
  /** 系统分组（系统 / 帮助 / 超级松鼠）的公共反馈。
   *  经典状态页那三颗原版 tab 是「未选中金皮 / 选中绿皮 + 悬停果冻光晕 + 点击回弹」，
   *  系统页这套是 DOM 画的，所以把同一套交互补在这里：所有可点件都走 SfUiFeedback，
   *  点击再补一遍 `pick` 回弹（页签本身仍由 popTap 延迟换页，回弹能看见一帧）。
   *  ⚠ 只在系统分组页调：分页签 / 设置键 / 帮助物品格 / 超级松鼠档位都覆盖，
   *    但不要把它接到道具页那张已经自己 wirePopTaps 的根上，避免重复挂。 */
  function wireSystemFeedback(root) {
    const f = window.SfUiFeedback;
    if (!f || !root || !root.querySelectorAll) return root;
    root.classList.add('sf-system-ui');
    for (const n of $$('.uc-tab, .uc-button, .music-toggle, .help-item, .vip-plan', root)) {
      f.bind(n, {
        selected: () => n.classList.contains('active') || n.classList.contains('on') ||
          !!(n.closest && n.closest('.music-setting.on')),
      });
    }
    if (!root.__sfPickWired) {
      root.__sfPickWired = true;
      root.addEventListener('click', (ev) => {
        /* 滑条自己负责拖动/点轨道，不参与“点一下回弹”，否则拖一半会闪一下。 */
        if (ev.target && ev.target.closest && ev.target.closest('input')) return;
        const t = ev.target && ev.target.closest
          ? ev.target.closest('.uc-tab, .uc-button, .music-toggle, .help-item, .vip-plan') : null;
        if (!t || !root.contains(t) || t.disabled) return;
        f.pick(t);
      }, true);
    }
    return root;
  }
  function tabs(group, active) {
    const sets = {
      status: [['status','状态'],['weapons','武器'],['skills','技能']],
      challenge: [['challenge','随机'],['friends','好友'],['arena','竞技'],['stages','关卡']],
      message: [['messages','消息'],['chat','聊天'],['ranklog','天梯赛'],['revenge','复仇'],['toplist','排行榜']],
      bag: [['bag','背包'],['shop','商店'],['exchange','兑换']],
      system: [['system','系统'],['help','帮助'],['vip','超级松鼠']]
    };
    const labels=sets[group].map(([id,t])=>{
      const art=group==='status'?'<span class="reference-button-label">'+t+'</span><img alt="" class="classic-button-art" src="images/ui/buttons/'+({status:'status',weapons:'weapon',skills:'skill'}[id])+'-'+(id===active?'active':'normal')+'.png">':t;
      /* 道具页三颗页签：文字仍留给读屏；原版矢量图由 `installBagTabVectors()` 在页面挂上后塞进这个壳。
       * 在矢量包到达前，按钮走 `.classic-tabs .uc-tab` 的金/绿药丸兜底，不再依赖 tab-*.png。 */
      const vector=group==='bag'?'<span class="bag-tab-art" aria-hidden="true"></span>':'';
      return '<button class="uc-tab '+(id===active?'active':'')+'" data-action="'+id+'" aria-current="'+(id===active?'page':'false')+'">'+art+vector+'</button>';
    }).join('');
    return '<nav class="classic-tabs ' + (sets[group].length > 3 ? 'four' : group==='bag'?'bag-tabs':'') + '" data-group="' + group + '" aria-label="游戏分页">' + labels + (group === 'challenge' ? '<span class="tab-energy">体力 ' + State.state().energy + '/' + State.state().maxEnergy + '</span>' : group==='bag'?'<span class="bag-coins">'+goldIcon()+'<b>'+State.state().goldPoint+'</b></span>':'') + '</nav>';
  }
  /** 页内改过金松果之后刷新顶部标签条右上角的数量（抽奖/道具/任务/每日礼包等原地结算的场景）。 */
  function refreshHeader() {
    const S = State.state(); if (!S) return;
    $$('.bag-coins b').forEach((el) => { el.textContent = S.goldPoint; });
    $$('[data-live-gold]').forEach((el) => { el.textContent = S.goldPoint; });
    const home = $('.home-money .num u'); if (home) setNum($('.home-money .num'), S.goldPoint);
  }
  function page(group, active, content, opts) {
    closeOriginalResult();
    opts = opts || {}; screen = active; activePortrait = null;
    /* 重画**同一页**时别把人弹回页首：先记住旧滚动容器的位置，新页面挂上去后再放回去。
     * 「把存档送过去 / 检查更新」这类原地动作会多次重画系统页 ——
     * 内容比底板高（`.classic-board` 是 overflow-y:auto），不记住就会跳回顶部。
     * 换页（home → system 之类）时旧 board 的 data-screen 不匹配，天然从 0 开始。 */
    const oldBoard = (typeof document !== 'undefined')
      ? document.querySelector('#ui .classic-page[data-screen="' + active + '"] > .classic-board') : null;
    const keepTop = oldBoard ? oldBoard.scrollTop : 0;
    const keepLeft = oldBoard ? oldBoard.scrollLeft : 0;
    const old = $('#ui .classic-page'); if (old) old.remove();
    /* ⚠ 主页那一层（`.classic-home`；ssflight 经典模式下的村庄页也是它）是**整屏**的，
       而且带不透明底色 —— 进二级页时如果只摘掉 `.classic-page`、把它留在 `#ui` 里，
       它就会整片盖住 canvas 上画的村庄背景，看起来就是"进二级界面背景黑了一块"
       （用户 2026-10 反馈）。这里把它一起摘掉，背景就还给 canvas 了。 */
    $$('#ui .classic-home').forEach(e => e.remove());
    $$('.classic-modal-overlay').forEach(e => e.remove());
    const p = document.createElement('section'); p.className = 'classic-page' + (opts.pageClass ? ' ' + opts.pageClass : ''); p.dataset.screen = active;
    /* 经典二级页自己带底图：不依赖 canvas 是否已经画过首页背景（首次进游戏时 canvas 可能还是黑的）。
     * 这里用当前模式显式加类，避免 data-ui-mode 在极早期还没落到 <html> 时背景漏黑。 */
    if (currentUiMode() === 'classic') p.classList.add('classic-bg');
    /* 经典塔页：不要现代顶部分页横条、不要底部「返回菜单」；由 TowerUI 自己塞一条
     * 「返回征战」的经典标题栏（`opts.noTabs/noFooter/above`）。 */
    const head = opts.noTabs ? '' : tabs(group, active);
    const foot = opts.noFooter ? '' : '<footer class="page-footer">' + (opts.left || '') + btn(opts.homeLabel || '返回菜单','home','gold',true) + (opts.right || '') + '</footer>';
    p.innerHTML = head + (opts.above || '') + '<div class="classic-board ' + (opts.cls || '') + '">' + content + '</div>' + foot + (opts.counter ? '<span class="page-counter' + (opts.counterPlace === 'board' ? ' in-board' : '') + '">' + opts.counter + '</span>' : '');
    $('#ui').appendChild(p);
    bind(p, Object.assign({}, actions, {home}));
    if(window.Main?.resizeLayout)Main.resizeLayout();
    if (keepTop || keepLeft) {
      const nb = Array.prototype.find.call(p.children, (el) => el && el.classList && el.classList.contains('classic-board'));
      if (nb) { nb.scrollTop = keepTop; nb.scrollLeft = keepLeft; }
    }
    if (window.SfGuide) { try { SfGuide.onPage(active); } catch (e) {} }
    promptLevelUpChoices();
    return p;
  }
  function modal(title, content, buttons, opts) {
    opts = opts || {};
    const wrap = document.createElement('div'); wrap.className = 'classic-modal-overlay';
    // locked=true 时没有关闭叉：用于「必须选完才能继续」的自由属性点分配。
    /* 显式角色优先（可预测）：primary/muted 标记 > cls 里的 gold/muted > 标签语义。
     * gold = 主操作（最右），muted = 取消/返回（最左），其余居中。
     * 只按「角色」排序、同级保持原顺序，所以顺序完全由 cls 决定，好维护。 */
    const btnRank = (b, i) => {
      /* 取消/返回类最左 —— cls 里的 muted 是最可靠的信号。 */
      if (b.muted === true) return -2;
      const cls = String(b.cls || '').toLowerCase();
      if (cls.indexOf('muted') >= 0) return -2;
      const label = String(b.label || '');
      /* 取消/返回类最左。 */
      if (/返回|取消|关闭|放弃/.test(label)) return -2;
      /* 延后/结束类居中偏左：注意它们里含有「继续」（如「稍后继续」），
       * 必须先于主操作规则判断，否则会被误当主操作排到最右。 */
      if (/稍后|暂不|待会|结束/.test(label)) return -1;
      if (/开始|继续|确定|确认|闯关|挑战|再战|知道了/.test(label)) return 2;
      if (b.primary === true) return 2;
      return 0;
    };
    /* 排序会打乱顺序，所以仍然按**原索引**生成 data-action，保证 bind(map) 的映射不变。 */
    const orderedIdx = buttons.map((b, i) => ({ b, i }))
      .sort((x, y) => btnRank(x.b, x.i) - btnRank(y.b, y.i) || x.i - y.i)
      .map((x) => x.i);
    wrap.innerHTML = '<section class="classic-modal ' + (opts.small ? 'small-modal' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2 class="modal-title cartoon">' + esc(title) + '</h2>' + (opts.locked ? '' : '<button class="modal-close" aria-label="关闭">×</button>') + '<div class="modal-body">' + content + '</div><div class="modal-buttons">' + orderedIdx.map((i) => btn(buttons[i].label, String(i), buttons[i].cls || '')).join('') + '</div></section>';
    $('#ui').appendChild(wrap);
    const previousFocus = document.activeElement;
    const close = () => { wrap.remove(); if (previousFocus && previousFocus.isConnected) previousFocus.focus({preventScroll:true}); };
    const closeBtn = $('.modal-close',wrap);
    if (closeBtn) closeBtn.onclick = close;
    const map = {};
    buttons.forEach((b,i) => { map[i] = () => { if (b.close !== false) close(); if (b.run) b.run(); }; });
    bind(wrap,map);
    $('.modal-buttons button',wrap)?.focus({preventScroll:true});
    // 有升级奖励（武器/技能三选一、自由属性点）没处理时，任何新弹窗之上都要先处理完
    if (!opts.locked) promptLevelUpChoices();
    return {close,element:wrap};
  }
  function notice(msg, buttons) { return modal('提示', '<p>' + esc(msg) + '</p>', buttons || [{label:'确定'}], {small:true}); }
  function toast(msg) { legacy.toast(msg); }

  /* ============================================================
   * 存档列表弹窗（saveListDialog）
   *
   * 以前的写法是把每份存档塞成一个按钮、横着排 12 个：一个按钮上既写等级、又写角色名、
   * 还带全角日期（2026/10/2 15:20:09），在 755px 的弹窗里必然溢出屏幕。
   * 一列紧凑的可滚动行：等级徽章 + 名字 + 简短时间 + 一个「载入」按钮。
   * ============================================================ */
  /* ============================================================
   * 【UC5】存档列表弹窗
   * ============================================================ */
  function ssdzSizeText(n) {
    const v = Number(n) || 0;
    return v >= 1048576 ? (v / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(v / 1024)) + ' KB';
  }
  function ssdzWhenText(ms, now) {
    const d = new Date(Number(ms) || 0);
    if (!Number.isFinite(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    const hm = p(d.getHours()) + ':' + p(d.getMinutes());
    const ref = new Date(now);
    const sameDay = d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
    const md = p(d.getMonth() + 1) + '-' + p(d.getDate());
    return sameDay ? ('今天 ' + hm) : (md + ' ' + hm);
  }
  /** 一行：等级徽章、名字、时间、大小、载入按钮 */
  function saveListRow(it, index) {
    const kind = it.kind || (String(it.rel).indexOf('backup') >= 0 ? 'backup' : 'backup');
    const sub = ssdzWhenText(it.at, Date.now()) + ' · ' + ssdzSizeText(it.size) +
      (it.file ? ' · ' + it.file : '');
    return '<div class="save-row' + (kind === 'current' ? ' current' : '') + '">' +
      '<span class="save-level">' + Math.max(0, Number(it.level) || 0) + '<i>级</i></span>' +
      '<span class="save-name">' + esc(String(it.name || '（无名）')) +
      (kind === 'current' ? '<em>当前</em>' : '') + '</span>' +
      '<span class="save-sub" title="' + esc(sub) + '">' + esc(sub) + '</span>' +
      '<button type="button" class="uc-button small" data-save-row="' + index + '">载入</button>' +
      '</div>';
  }
  /** 存档列表弹窗：返回 { close, element }，data-save-row 用 saveRowIndex 里的下标取回对应存档。 */
  function saveListDialog(list, onPick, tip) {
    const rows = list.map((it, i) => saveListRow(it, i)).join('');
    const total = list.length;
    const body = '<div class="save-list" role="list">' + rows + '</div>' +
      '<p class="save-list-tip">' + esc(tip || ('共 ' + total + ' 份（含 save/backup/ 快照）。' +
        '载入会先把当前进度备份到 save/backup/，再整档换过去。')) + '</p>';
    const m = modal('存档列表', body, [{ label: '返回', cls: 'muted' }]);   // 大弹窗：列表要占满高度
    m.element.classList.add('save-list-dialog');
    const buttons = m.element.querySelectorAll('[data-save-row]');
    for (const btn of buttons) {
      btn.onclick = () => {
        const i = Number(btn.getAttribute('data-save-row'));
        const it = list[i];
        if (!it) return;
        m.close();
        onPick(it);
      };
    }
    return m;
  }

  /* ============================================================
   * 【UC6】主界面首页（canvas 渲染 + 松鼠画像）
   * ============================================================ */
  function renderHome() {
    closeOriginalResult();
    screen = 'home'; activePortrait = null;
    const S = State.state();
    /* 【SFR2】经典模式：村庄页**整页由原版导出数据渲染**（js/ssfight/render.js + ui-main.js）。
     * 原版页面自带顶栏（昵称/等级/体力）、Exp 条、底栏五键与全部图标，
     * 所以这里不再拼复刻的 DOM 版；canvas 那边也同步不再画背景与 HUD（见 main.js 的 ssfightHomeActive）。 */
    if (currentUiMode() === 'classic' && window.SfUiMain) {
      /* 回主界面 = 把上一棵原版页面收干净。`SfUiMain.mount()` 自己会拆自己那一棵，
       * 但状态页 / 挑战页是**并列**的两棵树（各自带 1s 重刷），必须在这里一起收掉 ——
       * 不然从二级页回主界面时它们会挂在一棵已经不在页面上的树上继续跑。 */
      if (window.SfStatus && SfStatus.destroy) { try { SfStatus.destroy(); } catch (e) {} }
      if (window.SfChallenge && SfChallenge.destroy) { try { SfChallenge.destroy(); } catch (e) {} }
      if (window.SfVillage && SfVillage.destroy) { try { SfVillage.destroy(); } catch (e) {} }
      if (window.SfMessage && SfMessage.destroy) { try { SfMessage.destroy(); } catch (e) {} }
      $('#ui').innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠大战主页"></section>';
      const box = $('#ui .ssfight-home');
      if (box) window.SfUiMain.mount(box).catch((e) => { if (window.__errs) window.__errs.push('SfUiMain: ' + e.message); });
      /* 进主界面就预热道具页三颗页签的矢量包（188 KB）：等玩家点「道具」时多半已就绪，
       * 首屏会直接走矢量页签，不经过 CSS 药丸兜底。不阻塞主界面挂载。 */
      void preloadBagTabVectors();
      return;
    }
    $('#ui').innerHTML = '<section class="classic-home" aria-label="松鼠大战主页"><div class="home-status"><span class="home-name">' + vipBadge() + esc(S.name) + '</span><span class="home-level">' + num(S.level, true) + '</span><span class="energy-label cartoon">体力</span><div class="uc-meter home-energy"><i></i><span class="home-energy-val">' + num(S.energy + '/' + S.maxEnergy, true) + '</span></div></div><div class="home-subbar"><span class="home-exp-label" role="img" aria-label="经验" title="经验">' + spr('draw', 15, 'home-exp-art') + '</span><div class="exp-meter"><i></i><span class="home-exp-val">' + num(S.exp + '/' + GData.nextExp(S.level), true) + '</span></div><div class="home-money">' + icon('prop',1) + '<button data-action="shop" aria-label="金松果商店">' + num(S.goldPoint, true) + '</button></div></div><div class="home-buffs" aria-label="生效中的限时用品"></div><div class="home-side"><button class="picture-button' + (dailyAttention() ? ' attention' : '') + '" data-action="daily" aria-label="活动' + (dailyAttention() ? '，有可领取的奖励' : '') + '">' + '<img alt="活动" src="images/ui/home/activity.png">' + '</button></div><button class="village-door" data-action="village" aria-label="村庄"><img alt="" src="images/ui/home/village.png"></button><nav class="home-menu" aria-label="主菜单">' + btn('道具','bag') + btn('状态','status') + btn('开始挑战','challenge','gold') + btn('消息','messages') + btn('系统','system') + '</nav></section>';
    bind($('.classic-home'),actions);buffSignature='';
    refreshHome();
    renderNumbers();
    promptLevelUpChoices();
  }
  function refreshHome() {
    const S = State.state(); if (!S) return;
    const h = $('.classic-home'); if (!h) return;
    /* 经典模式（ssfight 原版渲染）的 `.classic-home` 里**没有** DOM 版那套
     * `.home-name` / `.home-level` / 体力槽节点，页面由 `SfUiMain` 自己每秒刷。
     * 这里必须提前返回：以前会在这里 `$('.home-name',h).textContent = ...` 抛
     * “Cannot set properties of null”，调用方（尤其调试面板的「遗忘 / 获得武技」）
     * 在调完 `State` 之后、`renderOwned()` / 提示之前就中断了 —— 表现为点 ×
     * 状态其实删了，但面板上的条目和提示都不更新，看起来像没删掉。 */
    if (h.classList && h.classList.contains('ssfight-home')) return;
    State.tickEnergy();
    $('.home-name',h).textContent = S.name;
    setNum($('.home-level .num',h), S.level);
    // 体力槽：亮金色填充从左侧开始（0 在左），宽度 = 体力比；右侧剩余为深棕。
    // 药剂可以把体力顶到自然上限之上，这时按上限封顶显示并加个 over 标记。
    const over = S.energy > S.maxEnergy;
    $('.home-energy>i',h).style.width = Math.min(100, 100*S.energy/S.maxEnergy)+'%';
    $('.home-energy',h).classList.toggle('over', over);
    setNum($('.home-energy-val .num',h), S.energy + '/' + S.maxEnergy);
    $('.home-energy',h).title = over
      ? '体力已超过自然上限（' + S.energy + '/' + S.maxEnergy + '），不会自然回复'
      : '每5分钟恢复1点体力' + (State.energyCountdown() ? '，下一点 '+State.energyCountdown() : '');
    const needExp = GData.nextExp(S.level);
    const pct = Math.min(100,100*S.exp/needExp);
    $('.home-subbar .exp-meter>i',h).style.width = pct+'%';
    setNum($('.home-exp-val .num',h), S.exp + '/' + needExp);
    setNum($('.home-money .num',h), S.goldPoint);
    const gold = frameUrl('resource_1',18); if (gold) $('.home-money img',h).src = gold;
    // 「活动」图标的提示动效要跟着可领取状态走：领完奖回到主界面就停下，
    // 而不是一直缩放（以前只有重建主界面时才会重新判断）。
    const act = $('.home-side [data-action="daily"]', h);
    if (act) {
      const att = dailyAttention();
      if (act.classList.contains('attention') !== att) {
        act.classList.toggle('attention', att);
        act.setAttribute('aria-label', att ? '活动，有可领取的奖励' : '活动');
      }
    }
    // 生效中的限时药丸：图标 + 剩余战斗场次
    const buffBox = $('.home-buffs',h);
    if (buffBox) {
      const states = S.propsStates || {};
      const sig = BUFF_PROPS.map(([id]) => states[id] > 0 ? id + ':' + states[id] : '').join();
      if (sig !== buffSignature) {
        buffSignature = sig;
        buffBox.innerHTML = BUFF_PROPS.filter(([id]) => states[id] > 0).map(([id, desc]) => {
          const prop = propMap.getValue(id);
          return '<span class="home-buff" title="' + esc((prop ? prop.name : '') + '：' + desc + '，剩余 ' + states[id] + ' 场战斗') + '">' + icon('prop', id) + '<i>' + states[id] + '</i></span>';
        }).join('');
      }
    }
  }
  function drawActor(ctx, box, options) {
    options = options || {};
    const wears = options.wears || [];
    // 列表与弹窗里的小像素画保持静态首帧，避免缩略图抖动；
    // 首页由 drawHomeHud 传入 main.js 的动画播放器，走原版 mainWalk 循环跑动。
    const player = options.player;
    const animate = !!options.anim;
    // 经典截图提供原版无装备肖像；已穿装备的角色改用恢复出来的原版分层
    // 动画，这样套装和实际装备一致。随机挑战里的敌人强制走分层，
    // 避免狂战套又去用那张固定肖像（用户口径：要穿什么就画什么）。
    const forceLayers = options.forceLayers === true;
    const silhouetteFilter = options.silhouetteBlur ? 'grayscale(1) brightness(1.65) blur(7px)' : 'brightness(0)';
    const silhouetteAlpha = options.silhouetteBlur ? 0.18 : 0.23;
    const referenceOutfit = ['Head_5_1','HandO_4_1','Body_5','Foot_5'].every((src,i)=>wears[i]?.src===src);
    const classicImage = animate || forceLayers ? null : referenceOutfit ? ninjaPortrait : [0,1,2,3].every(i=>wears[i] && /_32(?:_|$)/.test(wears[i].src)) ? berserkerPortrait : !wears.some(Boolean) ? classicPortrait : null;
    if (classicImage && classicImage.complete && classicImage.naturalWidth) {
      const k = Math.min(box.w/classicImage.width,box.h/classicImage.height);
      const w = classicImage.width*k,h=classicImage.height*k;
      const bob = options.still ? 0 : Math.sin(timer/370)*2;
      ctx.save();
      if(options.silhouette){ctx.filter=silhouetteFilter;ctx.globalAlpha=silhouetteAlpha;}
      ctx.drawImage(classicImage,box.x+(box.w-w)/2,box.y+box.h-h+bob,w,h);
      ctx.restore(); return;
    }
    const name = options.npc ? ({tl:'tl_rest',xh:'xh_rest',xm:'xm_rest'}[options.npc] || 'standby') : (animate ? options.anim : 'standby');
    const frames = Engine.anim(name); if(!frames)return;
    const sheets = options.npc ? ({tl:['tl'],xh:['xh1','xh2'],xm:['xm1','xm2']}[options.npc]) : (animate ? (options.sheets || ['SQ_01','SQ_02']) : ['SQ_01','SQ_02']);
    const frame = frames[options.still || !animate ? 0 : Math.floor(timer/90)%frames.length];
    /* 量包围盒时要排掉「影子/地面效果」这类贴地元素：`54` 是 210×54、位置在脚下方
     * （y 573~627，而身体只到 571），留着它会把包围盒往下拽 ~56px，
     * 于是 contain-fit 按高度算出来的缩放白白小一圈（实测角色只有 301 宽而非 ~360）。
     * `battle.js:302` 对同一批元素用的就是 `['54','75','91']`，这里保持一致。
     * 只影响「量尺寸」，不影响绘制 —— 下面 drawFrame 没有传 exclude，影子照画。 */
    let bounds = Engine.frameBounds ? Engine.frameBounds(frames[0],{sheets,exclude:['54','75','20001'],wears:options.uniformScale ? null : wears}) : {x:60,y:320,w:410,h:340};
    /* 随机挑战的对手预览：用**裸角色**包围盒定统一缩放，避免不同装备把角色越撑越小；
     * 但装备本身有外扩，再留一圈固定 padding，否则狂战披风/翅膀会顶出画布。 */
    if (bounds && options.uniformScale) {
      const pad = 0.19;
      bounds = { x: bounds.x - bounds.w * pad, y: bounds.y - bounds.h * pad,
        w: bounds.w * (1 + pad * 2), h: bounds.h * (1 + pad * 2) };
    }
    if(!bounds || !bounds.w)return;
    const k=Math.min(box.w/bounds.w,box.h/bounds.h);
    const origin={x:(box.x+(box.w-bounds.w*k)/2)/k-bounds.x,y:(box.y+(box.h-bounds.h*k)/2)/k-bounds.y};
    ctx.save();
    if(options.silhouette){ctx.filter=silhouetteFilter;ctx.globalAlpha=silhouetteAlpha;}
    if(player && player.list.length){
      // 复用 main.js 的播放器：每帧的位移、缩放缓动都按原版数据来。
      for(const inst of player.list.slice().sort((a,b)=>a.layer-b.layer)){
        Engine.drawFrame(ctx,inst.frames[inst.frame],Object.assign({},inst,{wears:wears,scale:k,x:origin.x,y:origin.y}));
      }
    }else{
      Engine.drawFrame(ctx,frame,{sheets,wears,scale:k,x:origin.x,y:origin.y});
    }
    ctx.restore();
  }
  // 首页主角动作：原版 mainWalk1 是 88 帧的循环跑动（含翻滚、甩尾与
  // 拖影）。mainWalk2 是睡觉、mainWalk3 位移达 -491~1893 会跑出画面，
  // 所以只用 mainWalk1，帧推进交给 main.js 的播放器。
  function heroWalk() {
    const name = (Engine.hasAnim && Engine.hasAnim('mainWalk1')) ? 'mainWalk1' : 'standby';
    return { name: name, sheets: ['SQ_01','SQ_02'] };
  }
  function heroPlayer() {
    return Main.homePlayer ? Main.homePlayer() : null;
  }
  function drawHomeHud(ctx) {
    timer = performance.now();
    if(timer-lastRefresh>700){refreshHome();lastRefresh=timer;}
    const worn=State.myGears().filter(g=>g.used);
    const sig=worn.map(g=>g.key).join('|');
    if(sig!==wearSignature && sig!==wearRequest){wearRequest=sig;Engine.loadWears(worn).then(w=>{heroWears=w;wearSignature=sig;wearRequest='';});}
    if(!sig){heroWears=[];wearSignature='';}
    if(screen==='home'){
      const walk=heroWalk();
      drawActor(ctx,{x:224,y:239,w:490,h:307},{anim:walk.name,sheets:walk.sheets,wears:heroWears,player:heroPlayer()});
    }
    if(activePortrait && activePortrait.canvas.isConnected){
      const c=activePortrait.canvas,cx=c.getContext('2d');cx.clearRect(0,0,c.width,c.height);
      drawActor(cx,{x:10,y:6,w:c.width-20,h:c.height-12},activePortrait.options.useHeroWears ? {...activePortrait.options,wears:heroWears} : activePortrait.options);
    }
    return [{id:'bag',x:22,y:559,w:200,h:114},{id:'status',x:237,y:559,w:200,h:114},{id:'challenge',x:453,y:559,w:276,h:114},{id:'messages',x:746,y:559,w:200,h:114},{id:'system',x:961,y:559,w:200,h:114}];
  }
  function portrait(c,options){activePortrait={canvas:c,options:options||{useHeroWears:true}};}
  /* ============================================================
   * 【UC7】状态页与图鉴
   * ============================================================ */
  function openStatus() {
    /* 【SFR4】经典模式：状态页**整页由原版导出数据渲染**（js/ssfight/ui-status.js，
     * 页根元件 = zhuangtai 帧的 7218）。原版这一页自带主角落绘（四个部位精灵 + 玩家
     * 穿在身上的装备）、Exp 条、今日胜率、战斗场次、力敏速命四维、更换装备 / 装备融合
     * 与三个 tab —— 与用户在 2026-10 第一百五十批点名的"对齐经典模式的状态界面"逐项对应。
     * 下面那套 DOM 版留给现代模式（也作为经典模式渲染失败时的兜底）。 */
    if (currentUiMode() === 'classic' && window.SfStatus && SfStatus.open) {
      screen = 'status'; activePortrait = null;
      $('#ui').innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠状态"></section>';
      const box = $('#ui .ssfight-home');
      if (box) {
        SfStatus.open(box).then(() => {
          /* 新手引导 f14→f15：状态页挂好了才通知（f15 的两个金环要贴页签）。 */
          if (window.SfGuide) { try { SfGuide.onPage('status'); } catch (e) {} }
        }).catch((e) => {
          if (window.__errs) window.__errs.push('SfStatus: ' + (e && e.message));
          openStatusDom();
        });
        return;
      }
    }
    openStatusDom();
  }
  function openStatusDom() {
    const S=State.state(),st=State.totalStats(),fights=S.dailyWins+S.dailyFails;
    const p=page('status','status','<canvas class="status-character" width="497" height="341" aria-label="我的松鼠"></canvas><div class="status-right"><div class="status-exp"><span class="home-exp-label">Exp</span><div class="exp-meter"><i style="width:'+Math.min(100,100*S.exp/GData.nextExp(S.level))+'%"></i><span>'+S.exp+'/'+GData.nextExp(S.level)+'</span></div></div><dl class="status-lines"><dt>今日胜率：</dt><dd>'+(fights?Math.round(S.dailyWins/fights*100):0)+'%</dd><dt>战斗场次：</dt><dd>'+(S.allWins+S.allFails)+'</dd></dl><div class="status-buttons">'+btn('更换装备','gears','gold',true)+btn('装备融合','merge','gold')+'</div></div>'+statsHtml(st));
    portrait($('.status-character',p));
    $('.page-footer',p).insertAdjacentHTML('beforeend',
      '<button class="status-sell-link" data-action="gear-sell" aria-label="装备出售：按品质回收背包里的装备"><span class="status-sell-icon" aria-hidden="true"><i class="status-sell-glyph">$</i></span><span class="status-sell-text">装备出售</span></button>' +
      '<button class="status-fusion-link" data-action="merge" aria-label="装备融合：三件同品质装备合成更高品质"><span class="status-fusion-icon" aria-hidden="true"><i class="status-fusion-glyph">⚒</i></span><span class="status-fusion-text">装备融合</span></button>');
    bind(p,{...actions,merge:openMerge,home});
  }
  function allItems(kind) {
    const a=[];(kind==='weapon'?weaponsMap:skillsMap).each((id,v)=>{if(v&&+id>0)a.push({...v,id:+id});});
    return a.sort((a,b)=>a.id-b.id);
  }
  /** 【SFR4】给经典模式状态页的武器 / 技能栏用：一页 10 格的清单（不含渲染）。
   *  返回 `{ items, pages }`，`items` 里每一项都带"有没有 / 几级 / 是否真形态"。 */
  function catalogInfo(kind, pg) {
    const own = kind === 'weapon' ? State.myWeapons() : State.mySkills();
    const items = allItems(kind);
    const pages = Math.max(1, Math.ceil(items.length / 10));
    const page = Math.max(0, Math.min(Math.max(0, (pg | 0)), pages - 1));
    const slice = items.slice(page * 10, page * 10 + 10).map((it) => {
      const has = own.find((x) => x.id === it.id) || null;
      return {
        id: it.id, name: it.name, has: !!has,
        level: has ? has.level : 0,
        trueForm: !!has && isTrueGear(has),
        /* 原版那一格是不是"当前选中的那一项"：**选中**决定卡片用绿底那一帧、
         * 也决定卡片下方要不要显示名字（见 js/ssfight/ui-status.js 的 paintCell 四档表）。 */
        selected: !!has && selectedItems[kind] === it.id,
        label: has ? levelLabel(has.level) : '',
        /* 【SFR4】原版图标 = 库元件（元件名就是武器/技能名，见 tools/gen-ssfight-ui.cjs 的
         * `iconRoots()`）。这张表由生成器产出、运行时只读。
         * ⚠ `locked` 是**另一颗库元件**（名字 + "1"）：原版 `showWeaponSkills`
         * （MainMovie.as:22050-22057）按 `has` 二选一挂 —— 灰底卡片 + **灰色的名字层**，
         * 所以"悬停未获得的格子显示灰名字"是原版**自己的第 2 帧**，不是复刻另做的一套。
         * 缺项（表里 missing 的那几颗）返回 null，调用方退回 PNG 图标。 */
        icon: wsIconOf(kind, it.id),
        lockedIcon: wsIconOf(kind, it.id, true),
      };
    });
    return { items: slice, page, pages };
  }
  /** 武器 / 技能图标的库元件表（`images/ssfight/ui/weapon-skill-icons.json`）。
   *  `locked` = 取"未获得"那一档（原版 `<名字>1`，灰卡片 + 灰名字）。 */
  let wsIcons = null, wsIconsTried = false;
  function wsIconOf(kind, id, locked) {
    if (!wsIconsTried) {
      wsIconsTried = true;
      /* 同步 XHR：这张表只有几 KB，而且 `catalogInfo` 是同步接口（调用方在渲染循环里）。
       * 拿不到就返回 null，全部退回 PNG 图标，不影响页面。 */
      try {
        const x = new XMLHttpRequest();
        x.open('GET', 'images/ssfight/ui/weapon-skill-icons.json', false);
        x.send();
        if (x.status === 200 || x.status === 0) wsIcons = JSON.parse(x.responseText);
      } catch (e) { wsIcons = null; }
    }
    const row = wsIcons && wsIcons[kind] && wsIcons[kind][id];
    if (!row) return null;
    if (locked) return row.locked ? String(row.locked) : String(row.id);
    return String(row.id);
  }
  function openCatalog(kind,pg) {
    catalogPage=pg||0;
    const own=kind==='weapon'?State.myWeapons():State.mySkills();
    const items=allItems(kind),total=Math.ceil(items.length/10),key=kind==='weapon'?'weapons':'skills';
    catalogPage=Math.min(catalogPage,total-1);
    const shown=items.slice(catalogPage*10,catalogPage*10+10);
    const cells=shown.map(it=>{
      const has=own.find(x=>x.id===it.id);
      const selected=has && selectedItems[kind]===it.id;
      /* 真形态：武器与技能都算（2026-10 之前只判断武器，技能的真化贴图因此一直不显示）。 */
      const trueForm = !!has && isTrueGear(has);
      /* 2026-10 用户口径：选中之后格子下方的说明**仍然显示等级**（LV/真N），
       * 不再换成该武器 / 技能的名字（名字在详情弹窗里看）。 */
      return '<button class="catalog-cell '+(!has?'locked':selected?'selected':'')+(trueForm?' true-form':'')+'" data-item="'+it.id+'" aria-label="'+esc(it.name)+(has?' '+levelLabel(has.level):' 尚未获得')+'"><span class="item-icon">'+icon(kind,it.id,!has,selected,trueForm)+'</span><span class="item-caption">'+(has?levelLabel(has.level):'')+'</span></button>';
    }).join('')+Array.from({length:10-shown.length},()=>'<div class="catalog-cell empty-slot" aria-hidden="true"><span class="item-icon"></span></div>').join('');
    const p=page('status',key,'<div class="catalog-grid">'+cells+'</div>'+(catalogPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(catalogPage<total-1?'<div class="page-arrow">'+btn('›','next','arrow')+'</div>':''),{counter:(catalogPage+1)+'/'+total,cls:'collection-board'});
    $$('[data-item]',p).forEach(b=>b.onclick=()=>{selectedItems[kind]=+b.dataset.item;openCatalog(kind,catalogPage);openItem(kind,+b.dataset.item);});
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openCatalog(kind,catalogPage-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openCatalog(kind,catalogPage+1));
  }
  function openItem(kind,id) {
    const isW=kind==='weapon',S=State.state(),base=(isW?weaponsMap:skillsMap).getValue(id);
    const it=(isW?State.myWeapons():State.mySkills()).find(x=>x.id===id);
    const up=it?State.upgradeInfo(kind,id):null;
    const skillDescriptions={6:'危机时刻装死避开攻击，成功后立即获得行动机会。装死不能升级。',7:'每场抵挡一次伤害，1级抵消20%，每级增加5%。装备附加能力可增加抵挡次数。',11:'增加原有闪避率5%，每级增加2%；按原有闪避率的比例计算。',13:'生命不高于50%时，每次出手有35%概率召唤师傅，每场最多一次。恢复师傅等级×4生命，下次攻击必中。',14:'按裸力量、敏捷、速度各增加1%，最少1点，每级增加1%；每场一次，随后立即行动。'};
    const description=(!isW&&skillDescriptions[id])||base.remark||'';
    const locked=!it;
    const unupgradeable=!isW && (base.type==='被动' && up?.max || id===13);
    const extra=isW?'伤害 '+(it?it.harmLo+'-'+it.harmHi:base.harm):'类别 '+esc(base.type);
    const right=locked?'<div class="locked-message">尚未获得<br><span class="small-label">升级、开启礼包有机会获得</span></div>':up?.max||unupgradeable?'<div class="locked-message">该'+(isW?'武器':'技能')+'<br>不能升级</div>':'<h3>需要　<span class="muted-text">已有</span></h3><div><span>金松果 '+up.coin+'</span><b>'+S.goldPoint+'</b></div><div><span>卷轴 '+up.book+'</span><b>'+(S.props[up.bookId]||0)+'</b></div><span class="upgrade-rate">成功率 '+up.rate+'%'+(up.fails?'<i class="upgrade-pity">（失败 '+up.fails+' 次，已加 '+up.fails*State.UPGRADE_FAIL_BONUS+'%）</i>':'')+'</span>'+(up.isTrue?'<span class="upgrade-true-tip">真化第 '+up.trueAttempt+' 次（当日 24:00 次数与费用清零，真化不吃失败保底）</span>':'')+'<span class="small-label">需要角色 '+up.levelLimit+' 级</span>';
    const content='<div class="item-detail"><div><h3 class="detail-name">'+esc(base.name)+'</h3><div class="detail-summary"><span class="item-icon">'+icon(kind,id,locked,false,isTrueGear(it))+'</span><div class="detail-rows"><span class="detail-row">'+(isW?'阶段':'等级')+' '+(it?levelLabel(it.level,false):1)+(it&&isTrueGear(it)?'（真形态）':'')+'</span><span class="detail-row">'+extra+'</span><span class="detail-row">类型 '+esc(base.type)+'</span></div></div><div class="detail-description">'+esc(description)+(isW&&it?'<br>升至下一阶段额外提升'+esc(base.harmAdd)+'点基础伤害！':'')+'</div></div><div class="detail-upgrade">'+right+'</div></div>';
    // 按钮顺序统一成「动作在前、返回在最后」，与其它弹窗一致
    modal(isW?'武器详情':'技能详情',content,[{label:locked?'尚未获得':up?.max||unupgradeable?'不能升级':'立即升级',cls:locked||up?.max||unupgradeable?'muted':'gold',run:()=>{
      if(locked||up?.max||unupgradeable)return;
      const r=State.doUpgrade(kind,id);toast(r.msg);openCatalog(kind,catalogPage);openItem(kind,id);
    }},{label:'返回',cls:'muted'}]);
  }
  /* ============================================================
   * 【UC8】挑战（PVP vs AI）
   * ============================================================ */
  function genOpponents() {
    const S=State.state();
    // 三个对手在玩家等级附近浮动，并带随机装备；等级差与名字都随机
    const spread=[-1,0,1];
    opponents=spread.map(i=>State.genAI(Math.max(1,S.level+i),'',{levelJitter:2,minLevel:Math.max(1,S.level-1),statScale:State.RANDOM_FOE_SCALE||1.08}));
    selectedOpponent=null;
  }
  // 随机对手也是好友来源：好友页与推荐列表共用这一份候选
  let friendCandidates = [];
  // 刷新对手：不做金松果收费，改为 10 次上限；进行随机挑战或超过 10 分钟重置。
  const CHALLENGE_REFRESH_LIMIT = 10;
  const CHALLENGE_REFRESH_WINDOW = 10 * 60 * 1000;
  let challengeRefreshTimer = 0;
  function challengeRefreshState() {
    const S = State.state(), now = Date.now();
    let rf = S.challengeRefresh;
    if (!rf || !Number.isFinite(rf.count) || !Number.isFinite(rf.ts) || now - rf.ts > CHALLENGE_REFRESH_WINDOW) {
      rf = S.challengeRefresh = { count: 0, ts: now };
    }
    rf.count = Math.max(0, Math.min(CHALLENGE_REFRESH_LIMIT, Number(rf.count) || 0));
    return rf;
  }
  function challengeRefreshRemaining(rf) {
    return Math.max(0, CHALLENGE_REFRESH_LIMIT - Math.max(0, Number(rf && rf.count) || 0));
  }
  function openChallenge(refresh) {
    /* 【SFR5】经典模式：挑战页**整页由原版导出数据渲染**（js/ssfight/ui-challenge.js，
     * 页根元件 = tiaozhan 帧的 7638）。原版这一页自带顶栏 4 个 tab（随机 / 我的好友 /
     * 竞技场 / 关卡）、左列对手行 + 右列拳套卡、右面板力敏速命、关卡的门卡与难度页
     * （库元件「挑战1」= 4756）—— 与用户 2026-10 点名的"对齐开始挑战内的界面 ui，
     * 包括上面四个 tab 及其内部 2 级、3 级界面"逐项对应。
     * 下面那套 DOM 版留给现代模式（也作为经典模式渲染失败时的兜底）。 */
    if (currentUiMode() === 'classic' && window.SfChallenge && SfChallenge.open) {
      if (refresh === true && SfChallenge.resetRoster) SfChallenge.resetRoster();
      screen = 'challenge'; activePortrait = null;
      $('#ui').innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠挑战"></section>';
      const box = $('#ui .ssfight-home');
      if (box) {
        SfChallenge.open(box).then(() => {
          if (screen === 'challenge' && window.SfGuide) { try { SfGuide.onPage('challenge'); } catch (e) {} }
        }).catch((e) => {
          if (window.__errs) window.__errs.push('SfChallenge: ' + (e && e.message));
          openChallengeDom(refresh);
        });
        return;
      }
    }
    openChallengeDom(refresh);
  }
  /** 现代随机挑战的「查看」：武技等级、装备主属性/附加词条/宝石/套装。 */
  function foeDetailHtml(foe) {
    const d = State.foeLoadout ? State.foeLoadout(foe) : null;
    if (!d) return '<p class="panel-desc">对手数据还没准备好。</p>';
    const stat = d.stats || {};
    const lv = (n) => '<span class="fd-lv">Lv.' + (Number(n) || 1) + '</span>';
    const empty = (text) => '<div class="fd-empty">' + esc(text) + '</div>';
    const qualityName = (g) => {
      if (g.orange || Number(g.quality) === 4) return '橙';
      return ['白', '绿', '蓝', '紫', '黑'][Number(g.quality) || 0] || '装';
    };
    const weapons = d.weapons.length
      ? d.weapons.map((w) => '<div class="fd-item"><div class="fd-item-main"><b>' + esc(w.name) + '</b>' +
        (w.type ? '<span class="fd-tag">' + esc(w.type) + '</span>' : '') + '</div>' + lv(w.level) + '</div>').join('')
      : empty('没有武器');
    const skills = d.skills.length
      ? d.skills.map((s) => '<div class="fd-item"><div class="fd-item-main"><b>' + esc(s.name) + '</b></div>' + lv(s.level) + '</div>').join('')
      : empty('没有技能');
    const gears = d.gears.length
      ? d.gears.map((g) => {
        const chips = [];
        if (g.setName) chips.push('<span class="fd-chip">' + esc(g.setName) + '</span>');
        for (const x of (g.ext || [])) chips.push('<span class="fd-chip">' + esc(x) + '</span>');
        if (g.gem) chips.push('<span class="fd-chip fd-gem">宝石 Lv.' + g.gem.level + '　+' + g.gem.percent + '%</span>');
        return '<div class="fd-gear"><div class="fd-gear-head"><b>' + esc(g.part + '·' + g.name) + '</b>' +
          '<span class="fd-quality q' + (Number(g.quality) || 0) + '">' + qualityName(g) + '</span>' +
          '<span class="fd-attr">' + esc(g.attrName) + ' +' + Number(g.abilityVal || 0) + '</span></div>' +
          (chips.length ? '<div class="fd-chips">' + chips.join('') + '</div>' : '') + '</div>';
      }).join('')
      : empty('没有装备');
    const pets = d.pets && d.pets.length
      ? '<div class="fd-pets"><span class="fd-pets-label">幻兽</span><div class="fd-chips">' +
        d.pets.map((p) => '<span class="fd-chip">' + esc((p.name || '幻兽') + ' Lv.' + (p.level || 1)) + '</span>').join('') + '</div></div>'
      : '';
    const statCell = (label, value) => '<div class="fd-stat"><span>' + label + '</span><b>' + value + '</b></div>';
    return '<div class="foe-detail">' +
      '<div class="fd-hero"><div class="fd-hero-main"><span class="fd-kicker">随机对手</span>' +
        '<h3 class="fd-name">' + esc(d.name || '对手') + '</h3></div>' +
        '<span class="fd-level">Lv.' + d.level + '</span></div>' +
      '<div class="fd-stats">' + statCell('力量', stat.power || 0) + statCell('敏捷', stat.agility || 0) +
        statCell('速度', stat.speed || 0) + statCell('生命', (stat.hp || 0) + '/' + (stat.maxHp || stat.hp || 0)) + '</div>' +
      '<div class="fd-cols">' +
        '<section class="fd-section"><h4><span>武器</span><i>' + d.weapons.length + '</i></h4><div class="fd-list">' + weapons + '</div></section>' +
        '<section class="fd-section"><h4><span>技能</span><i>' + d.skills.length + '</i></h4><div class="fd-list">' + skills + '</div></section>' +
      '</div>' +
      '<section class="fd-section fd-gear-section"><h4><span>装备加成</span><i>' + d.gears.length + '</i></h4><div class="fd-gear-list">' + gears + '</div></section>' +
      pets + '</div>';
  }
  /** 随机挑战右侧立绘：把对手自己的四件装备按部位塞进 `Engine.wearsFor`，
   *  和状态页/战斗立绘同一条换装表；不传就会画成裸装松鼠。 */
  function foeWears(foe) {
    const slots = [null, null, null, null, null, null];
    for (const g of (foe && foe.gears) || []) {
      const type = Number(State.gearPart ? State.gearPart(g.id) : -1);
      if (type >= 0 && type <= 3 && !slots[type]) slots[type] = g;
    }
    try { return Engine.wearsFor(slots); } catch (e) { return []; }
  }
  function openChallengeDom(refresh) {
    if(refresh===true||!opponents.length)genOpponents();
    if (challengeRefreshTimer) { clearTimeout(challengeRefreshTimer); challengeRefreshTimer = 0; }
    const rf=challengeRefreshState();
    const remaining=challengeRefreshRemaining(rf);
    const exhausted=remaining<=0;
    const refreshLabel='刷新玩家';
    const actionCls = 'small challenge-action';
    const content='<div class="challenge-list">'+opponents.map((f,i)=>'<button class="challenger '+(selectedOpponent===i?'active':'')+'" data-foe="'+i+'"><span class="foe-level">'+f.level+'</span><span class="foe-name">'+esc(f.name)+'</span>'+spr('resource_16',3)+'</button>').join('')+'</div><div class="challenge-preview"><canvas width="390" height="292" aria-label="对手预览"></canvas>'+(selectedOpponent!=null?statsHtml(opponents[selectedOpponent],'mini-stats'):'')+'</div><div class="challenge-note challenge-footer"><div class="challenge-refresh"><span class="challenge-hint">点击刷新<br>下一轮玩家…</span>'+btn(refreshLabel,'refresh',exhausted?'small muted refresh-btn is-exhausted':'small gold refresh-btn challenge-action')+'</div><div class="challenge-actions">'+(selectedOpponent!=null?btn('加好友','add-foe',actionCls+' muted')+btn('查看','foe-detail',actionCls+' muted')+btn('挑战他','fight',actionCls+' gold'):'')+'</div></div>';
    const p=page('challenge','challenge',content,{counter:'1/1'});
    const foe = selectedOpponent != null ? opponents[selectedOpponent] : null;
    const wears = foe ? foeWears(foe) : [];
    if (wears.some(Boolean) && Engine.loadWears) {
      try { Engine.loadWears(wears).catch(() => {}); } catch (e) {}
    }
    portrait($('.challenge-preview canvas',p),{silhouette:selectedOpponent==null,wears:wears,useHeroWears:false,forceLayers:true,uniformScale:true,silhouetteBlur:true});
    $$('[data-foe]',p).forEach(b=>b.onclick=()=>{selectedOpponent=+b.dataset.foe;openChallenge();});
    const refreshBtn=$('[data-action="refresh"]',p);
    if(refreshBtn){
      refreshBtn.title = exhausted ? '刷新次数已用完：挑战一个随机敌人或等待10分钟后再刷新' : '剩余 '+remaining+' 次刷新机会';
      if(exhausted){ refreshBtn.setAttribute('aria-disabled','true'); refreshBtn.classList.add('is-exhausted'); }
      refreshBtn.onclick=()=>{
        const S=State.state(),rf2=challengeRefreshState();
        if(challengeRefreshRemaining(rf2)<=0){toast('刷新次数已用完：挑战一个随机敌人或等待10分钟后再刷新');return;}
        rf2.count++;rf2.ts=Date.now();State.save();
        openChallenge(true);
      };
    }
    /* 次数用完时不必让玩家手动重进页面：到 10 分钟窗口结束后自动重绘一次，刷新键恢复。 */
    if(exhausted){
      const wait=Math.max(1000,CHALLENGE_REFRESH_WINDOW-(Date.now()-rf.ts)+50);
      challengeRefreshTimer=setTimeout(()=>{
        challengeRefreshTimer=0;
        if(screen==='challenge') openChallenge();
      },wait);
    }
    $('[data-action="add-foe"]',p)?.addEventListener('click',()=>{
      const foe=opponents[selectedOpponent];
      if(!foe)return;
      const r=State.addFriend(foe);
      toast(r.msg);
    });
    $('[data-action="foe-detail"]',p)?.addEventListener('click',()=>{
      const foe=opponents[selectedOpponent];
      if(!foe)return;
      const m = modal('对手详情', foeDetailHtml(foe), [{label:'关闭',cls:'muted'}], {small:true});
      m.element.classList.add('foe-detail-overlay');
      const panel = m.element.querySelector('.classic-modal');
      if (panel) panel.classList.add('foe-detail-modal');
    });
    $('[data-action="fight"]',p)?.addEventListener('click',()=>{
      const foe=opponents[selectedOpponent],S=State.state();
      const beginChallenge = async () => {
        if (challengeRefreshTimer) { clearTimeout(challengeRefreshTimer); challengeRefreshTimer = 0; }
        S.challengeRefresh={count:0,ts:Date.now()};State.save();   // 进行挑战后重置刷新次数
        /* 经验/金松果在**第一张战果页出现前**算好：战果页直接写"经验 + 金松果 + 悬浮物品"，
         * 开完宝箱就回随机挑战页，不再弹第三张结算。`settle` 自己缓存，SfFight 与 onEnd
         * 各调一次也只发一次奖励。 */
        let reward = null;
        const settle = (winner) => {
          if (reward) return reward;
          const win = winner === 0;
          if (win) { S.dailyWins++; S.allWins++; } else { S.dailyFails++; S.allFails++; }
          reward = State.fightReward(win, { foeLevel: foe.level });
          return reward;
        };
        try {
          await Main.startBattle(foe,{cost:10,kind:'challenge',useProps:true,keepScreen:true,rewardFor:settle,onEnd:(winner)=>{
            settle(winner);               // canvas 回退时 SfFight 没机会调 rewardFor
            opponents=[];                 // 回到随机挑战页时换一批新对手
            openChallenge(true);
            if (UI.classic && UI.classic.promptLevelUpChoices) UI.classic.promptLevelUpChoices();
          }});
        } catch (e) {
          /* startBattle 是 async：它内部抛错时不会走 onEnd，战果弹窗也就不会出现。
           * 不兜住的话这里会变成未处理的 Promise 拒绝（页面看起来卡在战斗画面）。 */
          if (typeof console !== 'undefined' && console.warn) console.warn('[challenge] 战斗启动失败：' + ((e && e.message) || e));
          openChallenge();
        }
      };
      if(S.energy<10){
        const deficit = 10 - S.energy;
        const small = S.props[1] || 0, big = S.props[2] || 0;
        const useId = (deficit <= 10 && small) ? 1 : (big ? 2 : (small ? 1 : 0));
        if(!useId){
          notice('体力不足！每5分钟恢复1点，也可以使用体力药剂。',[{label:'使用药剂',run:()=>openBag()},{label:'返回',cls:'gold'}]);return;
        }
        const potionName = (propMap.getValue(useId) || {}).name || '体力药剂';
        notice('体力不足（当前 ' + S.energy + '/' + S.maxEnergy + '）：自动使用「' + potionName + '」补足体力并挑战？',
          [{label:'使用挑战',cls:'gold',run:()=>{
            const potion = State.autoEnergyPotion ? State.autoEnergyPotion(10) : { ok:false };
            if(!(potion.ok && S.energy>=10)){
              notice('药剂没能补足体力，请稍后再试。',[{label:'返回',cls:'gold'}]);return;
            }
            beginChallenge();
          }},{label:'取消',cls:'muted'}]);
        return;
      }
      beginChallenge();
    });
  }
  function originalFightResult(spec) {
    if (currentUiMode() !== 'classic' || !window.SfFightResult) return false;
    SfFightResult.open(spec).catch(error => toast('战果界面加载失败：' + error.message));
    return true;
  }
  /** 普通战果：有经验/金松果/战利品时 `SfFightResult` 挂原版 `fight` 战果页；
   *  `text` 只作素材缺失时退回 4692 提示框的兜底。 */
  function resultModal(win,rw,extra,onOk,loot) {
    if (originalFightResult({ kind: 'result', title: win ? '战斗胜利' : '再接再厉', win,
      exp: rw.exp, gold: rw.gold || 0, ups: rw.ups, note: extra || '',
      items: (loot && loot.items) || [],
      text: '经验 +' + rw.exp + '　金松果 +' + (rw.gold || 0) + '\n' + (extra || '') + '\n' + upsHtml(rw.ups),
      actions: [{label:'确定',dismiss:true,run:onOk||home},{label:'查看录像',run:()=>openMessages()}] })) return;
    modal('战斗结果','<div class="result-box"><div class="result-title '+(win?'win':'lose')+'">'+(win?'胜 利！':'再接再厉')+'</div><div class="result-lines">经验 +'+rw.exp+'　金松果 +'+(rw.gold||0)+'</div>'+ (extra?'<p>'+esc(extra)+'</p>':'')+upsHtml(rw.ups)+'</div>',[{label:'确定',run:onOk||home},{label:'查看录像',cls:'gold',run:()=>openMessages()}]);
  }
  const NPC_FILE={tl:'mantis',xh:'crane',xm:'panda'};
  /** 关卡结算里的升级奖励：与首页共用的 upgradeReward 同款样式，
   *  但这里自带一份最小实现，方便测试只注入本段代码时也能跑。 */
  /* ============================================================
   * 【UC9】关卡（含挑战塔/无尽塔入口）
   * ============================================================ */
  function stageUpsHtml(ups) {
    if (!ups || !ups.length) return '';
    return '<div class="reward-stack">' + ups.map(function (u) {
      const gifts = (u.gifts || []).map(function (g) {
        return '<div class="reward-card gift"><span class="reward-icon">' + giftIcon(g.id) + '</span>' +
          '<span class="reward-text">' + esc(g.name) + ' ×' + esc(g.count) + '</span></div>';
      }).join('');
      const rows = (u.reward ? '<div class="reward-card skill"><span class="reward-text">' + esc(u.reward) + '</span></div>' : '')
        + (u.wsChoice ? '<div class="reward-card skill"><span class="reward-icon"><b class="reward-badge ws-badge">选</b></span><span class="reward-text">武器/技能 三选一</span></div>' : '')
        + (u.autoPoint ? '<div class="reward-card point"><span class="reward-icon">' + pointArt(u.autoPoint) + '</span><span class="reward-text">' + STAT_CHAR[u.autoPoint] + '+' + State.STAT_GAIN[u.autoPoint] + '<span class="point-tag">系统代选</span></span></div>' : '')
        + (u.chest ? '<div class="reward-card gift"><span class="reward-icon">' + icon('prop', 90) + '</span><span class="reward-text">金宝箱 ×' + esc(u.chest) + '</span></div>' : '')
        + gifts;
      return '<div class="reward-panel"><div class="reward-level">升到 ' + esc(u.level) + ' 级</div>' +
        (rows ? '<div class="reward-row">' + rows + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  /** 关卡里三侠的立绘卡：普通门用 `-classic-card`，**超级（精英）门用 `-elite-card`**。
   *  精英三侠（超级螳螂/仙鹤/熊猫）在经典模式里本来就是另一套贴图（深色/红蓝配色），
   *  以前现代这边两排共用普通版立绘，看起来像"精英和普通长得一样"。PNG 由经典素材
   *  导出的 `style`（4738 第 4~6 帧）渲染而来，见 docs/更新记录.md 本批。 */
  function npcImage(type, elite) {
    const file = NPC_FILE[type.anim];
    return '<img alt="' + esc(type.name) + '" src="images/ui/characters/' + file + (elite ? '-elite-card' : '-classic-card') + '.png">';
  }
  function openStages() {
    /* 六扇门（3 普通 + 3 超级）分两行，每行 3 张：一行 6 张会溢出 1170 的版心。
     * 第二排（from=3）是超级大关，立绘用**精英版**（`*-elite-card.png`）。 */
    const row = (from) => '<div class="npc-select">' + GData.STAGE_TYPES.slice(from, from + 3).map((t, i) => {
      const idx = from + i;
      return (i ? '<span class="npc-arrow">➜</span>' : '') + '<div class="npc-card">' + npcImage(t, !!t.super) + btn('挑战他', 'type' + idx, stageTypeAvailable(idx) ? 'gold small' : 'muted small') + '</div>';
    }).join('') + '</div>';
    const content = row(0) + row(3) + '<div class="npc-description">10级可挑战盖世五侠。依次通过六种难度，才能挑战下一位高手。每轮连续击败3名敌人，收集装备碎片！<br>后三扇门是超级大关：每关只有 1 个敌人，推荐 30 级以上。</div>' + towerEntryHtml();
    const p=page('challenge','stages',content,{cls:'stages-scroll-board'});
    GData.STAGE_TYPES.forEach((_,i)=>{ const b=$('[data-action="type'+i+'"]',p); if(b) b.onclick=()=>openDifficulty(i); });
    $('[data-action="tower-entry"]',p)?.addEventListener('click',()=>openTowerEntry('tower'));
    $('[data-action="endless-entry"]',p)?.addEventListener('click',()=>openTowerEntry('endless'));
  }
  /* 无尽挑战塔入口（关卡页下滑可见）：通关前 18 关解锁（与村庄「征战」同一门槛）。 */
  function towerEntryHtml() {
    const lock=window.Tower?Tower.unlocked():{ok:false,msg:'数据加载中…'};
    if(!lock.ok)return '<div class="tower-entries"><div class="tower-entry locked"><b>无尽挑战塔</b><span>'+esc(lock.msg)+'</span></div></div>';
    const t=Tower.towerInfo(),e=Tower.endlessInfo();
    return '<div class="tower-entries">'+
      '<button class="tower-entry" data-action="tower-entry"><b>挑战塔</b><span>已通关 '+t.maxLayer+' 层 · 下一层 '+t.nextLayer+'</span><span class="tower-entry-meta">挑战书×1 → 金松果 '+t.gold+'</span></button>'+
      '<button class="tower-entry endless" data-action="endless-entry"><b>无尽模式</b><span>最高分 '+e.best+' · 最深 '+e.bestLayer+' 层</span><span class="tower-entry-meta">免门票 · 赢抽奖卷（现有 '+e.tickets+' 张）</span></button>'+
      '</div>';
  }
  function openTowerEntry(mode) {
    if(!window.Tower||!window.TowerUI)return;
    const lock=Tower.unlocked();
    if(!lock.ok){notice(lock.msg);return;}
    if(mode==='tower')TowerUI.openTower({from:'stages'});else TowerUI.openEndless({from:'stages'});
  }
  function stageTypeAvailable(t) {
    return [1,2,3,4,5,6].some(st=>State.stageAccess(t*6+st).ok);
  }
  /* 回「关卡」这一层 —— **经典模式下必须回原版渲染的那一页**。
   * 用户 2026-10 口径："尽量让经典模式的关卡界面中始终遵循经典界面的逻辑，
   * 不要在挑战途中背景会切换为现代界面，一切优先向 ssfight 看齐。"
   * 打一场、回一次难度页，以前走的都是复刻自研的 DOM 关卡页（`openDifficulty`），
   * 于是整块背景从原版 ui 换成现代 ui。这里统一改走 `SfChallenge` 的关卡 tab
   * （它是原版页元件 7638 的第 3 帧 + 库元件「挑战1」的 5/4 帧），
   * 只有现代模式（或 ssfight 渲染不可用）才退回 DOM 版。 */
  function backToStages(t) {
    if (currentUiMode() === 'classic' && window.SfChallenge && SfChallenge.openAt) {
      /* 页面还在树上就**直接拨 tab**，不要再 `openChallenge()` 重建整页 ——
       * 重建会先清空 `#ui`、再异步挂一棵新 SVG，观感就是用户报的"关卡页闪一下"。
       * 战斗前 `holdPageForBattle()` 摘下来的那一棵由 `onEnd` 原样挂回，走到这里时
       * `root.isConnected` 已经是 true，直接拨到关卡页即可。 */
      const live = SfChallenge.view && SfChallenge.view();
      if (live && live.root && live.root.isConnected) {
        try {
          if (Number.isFinite(t)) SfChallenge.openGateAt(t);
          else SfChallenge.showTab('gates');
        } catch (e) {}
        return;
      }
      SfChallenge.openAt('gates');
      UI.runAction('challenge');
      /* ⚠ `openChallenge()` 会先把 `#ui` 换成新的 `.ssfight-home` —— 战斗期间
       * `#ui` 是被 `startBattle` 清空的，所以这一步等于"把原版关卡页装回来"。
       * 之前这一页是**先回首页再回来**（`showHome` 里 `renderHome` 会
       * `SfChallenge.destroy()`），观感就是"连战间隙闪一下现代界面"。 */
      if (!classicSsflight()) return;
      if (Number.isFinite(t)) {
        /* 直接落到某一扇门的难度页：挂载是异步的，等它挂完再点进去。 */
        let tries = 0;
        const tick = () => {
          if (window.SfChallenge && SfChallenge.view && SfChallenge.view()) {
            try { SfChallenge.openGateAt(t); } catch (e) {}
            return;
          }
          if (tries++ < 60) setTimeout(tick, 60);
        };
        setTimeout(tick, 60);
      }
      return;
    }
    if (Number.isFinite(t)) openDifficulty(t); else openStages();
  }
  function openDifficulty(t) {
    const type=GData.STAGE_TYPES[t];
    if(!type)return;
    if(!stageTypeAvailable(t)){notice(State.stageAccess(t*6+1).msg);return;}
    const content='<img class="difficulty-portrait" alt="'+type.name+'" src="images/ui/characters/'+NPC_FILE[type.anim]+(type.super?'-elite-card':'-classic-card')+'.png"><h2 class="difficulty-title">请选择难度</h2><div class="difficulty-grid">'+[1,2,3,4,5,6].map(st=>{const id=t*6+st,passed=State.stageProgress(id).passed,run=State.stageRun(id);return '<div class="star-challenge"><div>★ '+st+(passed?'　✓':'')+'</div>'+btn(run?'继续挑战':'挑战他','star'+st,State.stageAccess(id).ok?'small':'small muted')+'</div>';}).join('')+'</div>';
    const p=page('challenge','stages',content);
    $('[data-action="home"]',p).textContent='返回';$('[data-action="home"]',p).onclick=openStages;
    [1,2,3,4,5,6].forEach(st=>$('[data-action="star'+st+'"]',p).onclick=()=>stageConfirm(t*6+st));
  }
  function stageConfirm(stageId) {
    const access=State.stageAccess(stageId);
    if(!access.ok){notice(access.msg);return;}
    const S=State.state(),type=GData.stageTypeOf(stageId),run=State.stageRun(stageId),idx=run?run.npcIndex:1,npc=State.npcOf(stageId,idx),reward=State.stageReward(stageId);
    const exhausted=run&&run.needsRevive&&run.revives>=2;
    const cost=exhausted?'复活机会已用完':run?(run.needsRevive?'复活需1个挑战书':'不消耗挑战书'):'每轮1个挑战书';
    /* 常驻挑战的「当日重复惩罚」提示：今天已进行几次、当前敌方加成多少。 */
    const dailyCount=State.challengeDailyCount?State.challengeDailyCount():0;
    const dailyPct=Math.round((GData.challengeDailyMul(dailyCount)-1)*100);
    const dailyHint='<br><span class="small-label">今日已通关 '+dailyCount+' 次常驻挑战：敌人全属性（力/敏/速/血）+'+
      (dailyPct>0?('+'+dailyPct+'%'):'+0%')+'（每通关一整次再 +5%，每日 0/12 点重置）</span>';
    const stagePrentice = !(run && (run.masterOnly || run.needsRevive)) ? State.stagePrentice() : null;
    const prenticeHint = stagePrentice
      ? '<br><span class="small-label">出战：徒弟「' + esc(stagePrentice.name) + '」先上阵；徒弟失败后师父再上阵（不消耗挑战书，也不占用复活次数）。</span>'
      : (run && run.masterOnly ? '<br><span class="small-label">本轮由师父上阵（徒弟已败下阵）。</span>' : '');
    const text='<div class="mission-guide"><img alt="向导" src="images/ui/characters/master-classic.png"><div>【消耗】：'+cost+'<br>【奖励】：每场经验 '+Array.from({length:GData.stageEnemyCount(stageId)},(_,k)=>GData.stageNpcExp(stageId,k+1)).join('/')+'<br>通关得金松果'+reward.gold+'，每场胜利有几率得碎片<br><span class="small-label">现有挑战书 '+(S.props[23]||0)+' 个</span></div></div><p class="mission-description">'+(GData.isSuperStage(stageId)?'超级大关：本关只有 1 个敌人。':'连续击败3名敌人，后两场战斗不回满血（继承剩余血量并回复25%）。')+'<br>当前对手：'+esc(npc.name)+'（'+idx+'/'+GData.stageEnemyCount(stageId)+'）<br>'+(run?'本轮已复活 '+run.revives+'/2 次。':type.recommend+'。')+prenticeHint+dailyHint+'</p>';
    const buttons=exhausted?[{label:'结束本轮',run:()=>stageAbandon(stageId)}]:[{label:run?(run.needsRevive?'复活再战':'继续战斗'):'开始战斗',run:()=>stageFight(stageId)}];
    buttons.push({label:run?'稍后继续':'返回',cls:'muted'});
    if (typeof originalFightResult === 'function' && originalFightResult({ kind: 'stage', title: '关卡挑战', win: true, text, actions: buttons })) return;
    modal('关卡挑战',text,buttons,{small:true});
  }
  function stageAbandon(stageId) {
    if (typeof originalFightResult === 'function' && originalFightResult({ kind: 'stage', title: '结束本轮',
      text: '结束本轮后，下次需1个挑战书从第一名对手重新开始。已通关的记录会保留。',
      actions: [{label:'结束本轮',run:()=>{State.abandonStageRun(stageId);backToStages(Math.floor((stageId-1)/6));}},
        {label:'继续本轮',dismiss:true,run:()=>stageConfirm(stageId)}] })) return;
    notice('结束本轮后，下次需1个挑战书从第一名对手重新开始。已通关的记录会保留。',[
      {label:'结束本轮',run:()=>{State.abandonStageRun(stageId);backToStages(Math.floor((stageId-1)/6));}},
      {label:'继续本轮',cls:'gold',run:()=>stageConfirm(stageId)}
    ]);
  }
  /** 「现在这一屏是原版渲染的经典页吗」：经典模式 + ssfight 渲染层在场。
   *  战斗起止"要不要换页"全靠它判断（见 `stageFight` 的 `keepScreen`）。 */
  function classicSsflight() {
    return !!(currentUiMode() === 'classic' && window.SfChallenge);
  }
  function stageFight(stageId) {
    const started=State.beginStageBattle(stageId);    if(!started.ok){notice(started.msg,started.needsBook?[{label:'购买',run:()=>openProp(23,true)},{label:'返回',cls:'gold',run:()=>stageConfirm(stageId)}]:undefined);return;}
    const npc=State.npcOf(stageId,started.npcIndex),type=GData.stageTypeOf(stageId);
    /* 原版 `fightType == 6` 的关卡战斗：徒弟先上阵；徒弟失败后 state 7 再让师父接手。
     * 这里把徒弟快照作为 `fighter` 交给 Main.startBattle，战败时不结算、不扣复活。 */
    const prenticeFighter = started.role === 'prentice' ? State.stagePrenticeFighter() : null;
    const prenticeRole = !!(started.role === 'prentice' && prenticeFighter);
    // 连续挑战不回满血：后两场继承上一场剩余血量，并回复25%
    const prevRun=State.stageRun(stageId),carryHp=prevRun&&Number.isFinite(prevRun.carryHp)?Math.min(1,prevRun.carryHp+0.25):undefined;
    /* 对手：三维走关卡难度系数（GData.stageNpcStats），血量已在 npcOf 里按攻略表算好；
     * 再统一套「常驻挑战当日重复惩罚」（GData.stageFoe → 今天每多赢一场，敌全属性 +5%）。
     * 只影响关卡模式；挑战塔 / 无尽塔走各自的敌人构建（tower.js 的 buildFoe），不受影响。 */
    const dailyCount=State.challengeDailyCount?State.challengeDailyCount():0;
    const foe=GData.stageFoe(npc,stageId,type.anim,dailyCount);
    const gateType=Math.floor((stageId-1)/6);
    const backToStage=()=>backToStages(gateType);
    /* 战斗前把原版关卡页从 `#ui` 摘下来（`Main.startBattle` 会整片清空 `#ui`），
     * 打完原样挂回同一棵 SVG —— 不再 `destroy()` + 重新挂载，那一步就是"闪一下"的来源。
     * 页面不在场 / 非经典模式时 `holdPageForBattle()` 返回 null，走原来的重挂路径。 */
    let heldPage=null;
    try { if (classicSsflight() && window.SfChallenge && SfChallenge.holdPageForBattle) heldPage=SfChallenge.holdPageForBattle(); } catch(e) {}
    const restoreStage=()=>{
      if (heldPage && window.SfChallenge && SfChallenge.resumePageAfterBattle) {
        /* 三级页（难度页 / 出战确认）也一起挂回：`keepSub` 时不走 showTab，
         * 只用 `refreshGateAt()` 更新星标/文案，避免重新 mount 4756 那一下卡顿。 */
        const keepSub=!!(heldPage.sub&&heldPage.sub.host);
        try {
          if (SfChallenge.resumePageAfterBattle(heldPage,'gates',{keepSub})) {
            try {
              if (keepSub && SfChallenge.refreshGateAt) SfChallenge.refreshGateAt(gateType);
              else SfChallenge.openGateAt(gateType);
            } catch (e) {}
            return true;
          }
        } catch (e) {}
      }
      backToStage();
      return false;
    };
    const interrupted=()=>{State.interruptStageBattle(stageId,started.token);restoreStage();notice('战斗播放中断，本轮进度已保留。重新进入关卡即可继续。');};
    try { Promise.resolve(Main.startBattle(foe,{region:type.anim==='tl'?3:type.anim==='xh'?4:1,kind:'stage',useProps:false,hpRatio:carryHp,skipChest:true,fighter:prenticeFighter||undefined,
      /* 经典模式下**连战间隙不许回首页**（用户 2026-10 口径："经典模式下完全是经典模式"）：
       * 打完先回原版关卡页，再弹战果。所以这里让 `startBattle` 跳过它默认那次
       * `showHome()`，由 `onEnd` 自己把背景恢复成原版关卡页。 */
      keepScreen: classicSsflight(),
      onError:()=>State.interruptStageBattle(stageId,started.token),
      onEnd:(w,r)=>{
        // 战斗结束后把关卡页放回背景（同一棵 SVG），别让战果弹窗飘在主界面上
        restoreStage();
        /* 徒弟战败：原版 showFightStatus → state 7 → doFight，师父免费接手同一名对手。
         * 不调用 finishStageBattle（那会给本轮记一次复活），只清 attempt + masterOnly。 */
        if (prenticeRole && w !== 0) {
          const ok = State.stagePrenticeLost(stageId, started.token);
          if (ok) stagePrenticeDefeat(stageId, npc, started.npcIndex, started.prentice);
          return;
        }
        // 连战按剩余血量比例继承；缺字段时退化为 0，绝不能在这里抛错，
        // 否则异常会冒到 Battle 的 onError，把玩家直接丢回主界面且丢掉战果。
        const hp=r&&Array.isArray(r.hpAfter)?r.hpAfter[0]:null,cap=r&&Array.isArray(r.maxHp)?r.maxHp[0]:0;
        const ratio=w===0&&Number.isFinite(hp)&&cap>0?Math.max(0,Math.min(1,hp/cap)):0;
        const rw=State.finishStageBattle(stageId,started.token,w===0,ratio);
        // rw.ok 为 false 只会是「token 已作废」——重复/迟到的回调，静默忽略即可。
        if(!rw.ok)return;
        stageResult(stageId,npc,started.npcIndex,rw);
      }
    })).catch(interrupted); } catch(error) { interrupted(); }
  }
  /** 徒弟战败弹窗：台词照原版 `showFightStatus`（MainMovie.as:15688），
   *  「师父上阵」走原版 state 7 → doFight：同一名对手、免费、不占复活次数。 */
  function stagePrenticeDefeat(stageId, npc, idx, prenticeName) {
    const back = () => backToStages(Math.floor((stageId - 1) / 6));
    const buttons = [
      { label: '师父上阵', cls: 'gold', run: () => stageFight(stageId) },
      { label: '稍后继续', run: back },
    ];
    const text = '<b>徒弟无能，打不过它！该师父您亲自上阵了！</b>' +
      '<br><span class="small-label">徒弟「' + esc(prenticeName || (State.stagePrentice() || {}).name || '徒弟') +
      '」已败下阵；师父接手同一名对手，不消耗挑战书，也不占用本轮复活次数。</span>';
    if (typeof originalFightResult === 'function' && originalFightResult({
      kind: 'stage', title: '徒弟战败', win: false, text, actions: buttons,
    })) return;
    modal('徒弟战败', '<div class="result-box"><div class="result-title battle-outcome lose">徒弟战败</div><p>' + text + '</p></div>', buttons);
  }
  function stageResult(stageId,npc,idx,rw) {
    const back=()=>backToStages(Math.floor((stageId-1)/6));
    const reward='<div class="result-lines">经验 +'+rw.exp+(rw.complete?'　通关金松果 +'+rw.gold:'')+(rw.chest?'　金宝箱 ×1':'')+'</div>';
    /* 祭坛「关卡金松果双倍」中了就写一句（原版那套"祭坛发出神秘的光芒"的说法）。 */
    const goldBuffNote=rw.goldBuff?'<p class="small-label">祭坛神秘光芒加成：本次金松果翻倍（+'+rw.goldBase+'）</p>':'';
    let message,buttons;
    if(rw.complete){
      message=GData.isSuperStage(stageId)?'恭喜通关！超级大关的强敌已被击败。':'恭喜通关！三名对手全部击败。';
      buttons=[{label:'继续闯关',run:back},{label:'返回菜单',cls:'muted',run:home}];
    }else if(rw.win){
      /* 用户 2026-10 口径："优化挑战界面中『继续挑战』的介绍中的文字排布" ——
       * 以前是一整段挤在一行里自动折行（长句折在"（继承剩余血量并回复25%）。"中间很难读），
       * 现在按语义断成三行：战果 / 继续挑战的代价 / 下一场的血量规则。 */
      message='已击败 '+esc(npc.name)+'（'+idx+'/'+GData.stageEnemyCount(stageId)+'）<br>继续挑战<b>不再消耗挑战书</b><br>下一场不回满血：继承剩余血量并回复 25%';
      // 连战本来就不消耗挑战书，没有必要再确认一次（确认弹窗仍保留在难度页进入时）。
      buttons=[{label:'继续挑战',run:()=>stageFight(stageId)},{label:'稍后继续',cls:'gold',run:back},{label:'结束本轮',cls:'muted',run:()=>stageAbandon(stageId)}];
    }else{
      const canRevive=rw.run.revives<2;
      message=canRevive?'挑战失败，可花1个挑战书复活自己，继续本轮挑战。剩余复活次数：'+(2-rw.run.revives)+'。':'本轮2次复活机会已用完。结束本轮后可以重新挑战。';
      buttons=canRevive?[{label:'复活再战',run:()=>stageConfirm(stageId)},{label:'稍后继续',cls:'gold',run:back}]:[];
      buttons.push({label:'结束本轮',cls:'muted',run:()=>stageAbandon(stageId)});
    }
    const drop=rw.drop?'<p>获得'+esc(rw.drop.name)+' ×'+rw.drop.count+'</p>':'';
    const gemDrop=rw.gem?'<p>获得'+esc(rw.gem.name)+' ×1</p>':'';
    /* 有升级：经典战果先挂 7795 升级页，原版页脚那条 stageUpsHtml 不再重复写。 */
    const levelUpUi = !!(window.SfLevelUp && rw.ups && rw.ups.length);
    if (typeof originalFightResult === 'function' && originalFightResult({ kind: 'stage', title: rw.win ? '关卡胜利' : '关卡失利', win: rw.win,
      ups: rw.ups,
      text: '经验 +' + rw.exp + (rw.complete ? '　通关金松果 +' + rw.gold : '') + '\n' + message + '\n' + drop + gemDrop + goldBuffNote + (levelUpUi ? '' : stageUpsHtml(rw.ups)), actions: buttons })) return;
    modal('关卡战果','<div class="result-box"><div class="result-title battle-outcome '+(rw.win?'win':'lose')+'">'+(rw.win?'胜 利！':'再接再厉')+'</div>'+reward+'<p>'+message+'</p>'+drop+gemDrop+goldBuffNote+stageUpsHtml(rw.ups)+'</div>',buttons);
  }
  /* ============================================================
   * 【UC10】背包/商店/兑换（点击物品开二级窗；卖出入口已移除）
   * ============================================================ */
  /* 道具页三颗页签的原版矢量图
   * ------------------------------------------------------------
   * 原版道具页 7180 里三颗页签是**矢量精灵**（不是位图）：
   *   tab = 7150（背包）/ tab1 = 7152（商店）/ tab2 = 7156（兑换）。
   * 每颗 4 帧：f1 金皮常态、f2 绿色高亮、f3 另一档奶油（原版光标离开页签时用）。
   * 经典道具页按用户口径「选中要绿」：f1 金皮 / f2 绿皮，选中与悬停都用 f2。
   * 这里把三颗页签按 f1/f2 各渲染一次，克隆成静态 SVG 模板缓存起来，
   * 页面挂上后塞进按钮里的 `.bag-tab-art`。克隆不注册 SfRender 视图，所以切页/销毁不用额外收尾。
   * viewBox = 各页签自己内容包围盒（从原版 mount 后 getBBox 量的，约 63×20.7）；
   * 三颗按钮是 233×77，与原版 320×196 页面的页签比例一致，直接铺满即可对齐。
   * 兜底：矢量包还没到时按钮仍走 `.classic-tabs .uc-tab` 的 CSS 金/绿药丸（DOM 文本），
   * 不再使用 tab-*.png 位图。 */
  const BAG_TAB_VECTOR = [
    { key: 'bag', id: '7150', viewBox: '-32.6 -1.2 63.2 20.9' },
    { key: 'shop', id: '7152', viewBox: '-58.7 -2.1 63.2 20.9' },
    { key: 'exchange', id: '7156', viewBox: '-32.6 -10.6 63.2 20.9' },
  ];
  let bagTabVectorPromise = null;
  async function buildBagTabVectors() {
    if (!window.SfRender || !SfRender.loadExtra || !SfRender.mountSymbol) return null;
    await SfRender.loadExtra('tags-daoju.json');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:196px;overflow:hidden;pointer-events:none';
    document.body.appendChild(host);
    try {
      const out = {};
      for (const spec of BAG_TAB_VECTOR) {
        out[spec.key] = {};
        for (const frame of [1, 2]) {
          const cell = document.createElement('div');
          host.appendChild(cell);
          const view = await SfRender.mountSymbol(cell, spec.id, {
            frame, viewBox: spec.viewBox, label: '道具页签',
          });
          const svg = view.g.cloneNode(true);
          svg.setAttribute('class', 'bag-tab-svg');
          svg.setAttribute('aria-hidden', 'true');
          out[spec.key][frame] = svg;
          try { view.destroy(); } catch (e) {}
          cell.remove();
        }
      }
      return out;
    } finally { host.remove(); }
  }
  function preloadBagTabVectors() {
    if (!bagTabVectorPromise) {
      bagTabVectorPromise = buildBagTabVectors().catch((e) => {
        if (window.__errs) window.__errs.push('bag tab vector: ' + (e && e.message));
        return null;
      });
    }
    return bagTabVectorPromise;
  }
  /** 把缓存的矢量模板装进当前道具页的三颗页签；页面被换掉时旧 SVG 跟着 DOM 一起回收。 */
  function installBagTabVectors(p) {
    const nav = p && p.querySelector('.bag-tabs');
    if (!nav) return;
    const buttons = [...nav.querySelectorAll('.uc-tab')];
    if (!buttons.length) return;
    preloadBagTabVectors().then((art) => {
      if (!art || !p.isConnected || !nav.isConnected) return;
      buttons.forEach((btn, i) => {
        const spec = BAG_TAB_VECTOR[i];
        const frames = spec && art[spec.key];
        const host = btn.querySelector('.bag-tab-art');
        if (!frames || !host) return;
        const idleFrame = () => (btn.classList.contains('active') ? 2 : 1);
        const setFrame = (frame) => {
          const node = frames[frame];
          /* 不用 `replaceChildren`（Chrome 86+）：安卓旧 WebView 上没有它，会直接抛错整页白掉。 */
          if (node) {
            while (host.firstChild) host.removeChild(host.firstChild);
            host.appendChild(node.cloneNode(true));
          }
        };
        setFrame(idleFrame());
        btn.style.backgroundImage = 'none';
        btn.classList.add('has-vector-tab');
        if (!btn.__bagTabVectorWired) {
          btn.__bagTabVectorWired = true;
          btn.addEventListener('pointerenter', () => setFrame(2));
          btn.addEventListener('pointerleave', () => setFrame(idleFrame()));
        }
      });
    });
  }

  function openBag(shop,pg) {
    const exchange=shop==='exchange',mode=shop;shop=shop===true;bagPage=pg||0;
    const S=State.state(),items=[];
    /* 背包（非商店/兑换页）里额外列出**货币类显示项**（金杯 40）：它的持有量在 `S.goldCup` 上，
     * 不是 `S.props`，所以这里用 `State.bagCountOf` 读同一个真值来源（2026-10 用户口径）。 */
    const bagCount=(id)=>State.bagCountOf?State.bagCountOf(id):(S.props[id]||0);
    const bagHas=(id)=>bagCount(id)>0;
    /* 兑换页：第 1 页原有兑换物，第 2 页宝石合成，第 3 页黑凤凰/黑圣熊碎片合成。
     * 第 3 页只在经典界面出现（现代界面按 2026-10 口径已整体删除黑装内容）。 */
    const EXCHANGE_IDS = [24, 25, 26, 45, 46, 51];
    const EXCHANGE_GEMS = [101, 102, 103, 104, 105, 106];
    const EXCHANGE_BLACK_SHARDS = State.blackGearEnabled() ? [77, 78] : [];
    if (exchange) {
      bagPage = Math.max(0, Number(bagPage) || 0);
      for (const id of EXCHANGE_IDS.concat(EXCHANGE_GEMS, EXCHANGE_BLACK_SHARDS)) {
        const v = propMap.getValue(id);
        if (v) items.push({ ...v, id: +id });
      }
    } else {
      propMap.each((id,v)=>{
        if(!State.blackGearEnabled() && State.BLACK_PROP_IDS.includes(+id))return;
        if(shop?v.buy==='true':(bagHas(+id)))items.push({...v,id:+id});
      });
      /* 金宝箱已经开出、结果还没领取时，箱子本身已经消耗掉（数量 0）；这里仍把它列进背包，
       * 点进去就是「待领取」的结果，避免玩家离开弹窗后找不到入口（读档也会自动结算）。 */
      if (!shop && State.chestState && State.chestState() && !items.some((it) => it.id === 90)) {
        const v = propMap.getValue(90);
        if (v) items.push({ ...v, id: 90 });
      }
      items.sort((a,b)=>a.id-b.id);
    }
    const total=Math.max(1,Math.ceil(items.length/6));bagPage=Math.min(bagPage,total-1);
    const shown=items.slice(bagPage*6,bagPage*6+6);
    if(!shown.some(it=>it.id===selectedProp))selectedProp=shown[0]?.id||0;
    function detailMarkup(it) {
      if (!it) return '<h3>背包</h3><div class="bag-description">背包空空的，去商店看看吧！</div>';
      const status=shop?State.purchaseStatus(it.id):null;
      const meta=shop
        ? '售价 '+goldPrice(it.price)+'<br>今日剩余 '+status.remaining+'/'+status.limit
        : '拥有 '+bagCount(it.id)+' 个'+(State.isBagCurrencyProp&&State.isBagCurrencyProp(it.id)?'（货币，天梯赛获得；不能卖也不能使用）':'');
      /* 现代模式保留背包售卖；经典模式仍走原版 4886 f1 弹窗（不显示这颗键）。
       * 一次卖 1 个，避免手滑清仓；卖完重绘背包。 */
      const sellPrice = !shop && !exchange && currentUiMode() !== 'classic' && State.propSellPrice
        ? State.propSellPrice(it.id) : 0;
      const sell = sellPrice > 0 && bagCount(it.id) > 0
        ? '<button type="button" class="uc-button small gold" data-sell-prop="' + it.id + '">卖出 +' + sellPrice + '</button>'
        : '';
      return '<h3>'+esc(it.name)+'</h3><div class="bag-description">'+esc(it.remark||'')+'</div><div class="bag-item-meta">'+meta+'</div>'+sell;
    }
    const info=detailMarkup(shown.find(it=>it.id===selectedProp));
    const content='<div class="bag-layout"><div class="catalog-grid bag-grid">'+shown.map(it=>'<button class="catalog-cell '+(it.id===selectedProp?'selected':'')+'" data-prop="'+it.id+'" aria-label="'+esc(it.name)+(shop?'，'+it.price+'金松果':'，拥有'+bagCount(it.id)+'个')+'" aria-pressed="'+(it.id===selectedProp)+'"><span class="item-icon">'+icon('prop',it.id,false,it.id===selectedProp)+'</span><span class="item-caption">'+(shop?goldPrice(it.price,esc(it.name)):bagCount(it.id))+'</span></button>').join('')+Array.from({length:6-shown.length},()=>'<div class="catalog-cell empty-slot" aria-hidden="true"><span class="item-icon"></span></div>').join('')+'</div><aside class="bag-detail" aria-live="polite">'+info+'</aside></div>'+(bagPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(bagPage<total-1?'<div class="page-arrow bag-next">'+btn('›','next','arrow')+'</div>':'');
    const bagFooter=shop?{left:btn('每日抽奖','lottery','gold entry-pill'),right:btn('金杯商店','rank-shop','gold entry-pill')}:{};
    const p=page('bag',exchange?'exchange':shop?'shop':'bag',content,Object.assign({cls:'classic-bag-board'+(shop?' shop-board':''),counter:(bagPage+1)+'/'+total},bagFooter));
    wirePopTaps(p, { tabs: true, cells: true, footer: true, arrows: true });
    installBagTabVectors(p);
    /** 经典合成入口：碎片 / 种子 / 转化丸 / 宝石点「合成」直接进原版 4886 f5，
     *  不再先弹现代版道具详情弹窗；现代模式仍走 openProp。 */
    function openPropEntry(id) {
      const classic = !!(UI.currentUiMode && UI.currentUiMode() === 'classic');
      if (!shop && classic && window.SfCompose && SfCompose.isComposeProp(id)) {
        SfCompose.open(id, { onClose: () => openBag(mode, bagPage) });
        return;
      }
      openProp(id, mode);
    }
    function wireDetail() {
      wirePopTaps(p, {});
      const sell = $('[data-sell-prop]', p);
      if (sell) {
        sell.onclick = () => {
          const id = Number(sell.dataset.sellProp);
          const r = State.sellProp(id, 1);
          toast(r.msg);
          if (r.ok) openBag(mode, bagPage);
        };
      }
    }
    function selectProp(id) {
      if (!p.isConnected || !shown.some(it=>it.id===id)) return;
      selectedProp=id;
      for (const cell of $$('[data-prop]',p)) {
        const on=+cell.dataset.prop===id;
        cell.classList.toggle('selected',on);
        cell.setAttribute('aria-pressed',String(on));
        $('.item-icon',cell).innerHTML=icon('prop',+cell.dataset.prop,false,on);
        if(window.SfUiFeedback)SfUiFeedback.bind(cell,{selected:on});
      }
      $('.bag-detail',p).innerHTML=detailMarkup(shown.find(it=>it.id===id));
      wireDetail();
    }
    $$('[data-prop]',p).forEach(b=>{
      /* 经典背包/商店/兑换：鼠标移到哪一格，哪一格立刻变绿并同步右侧说明；
       * 单击就直接打开二级窗口（不再需要“第一下选中、第二下打开”）。 */
      b.addEventListener('pointerenter',()=>selectProp(+b.dataset.prop));
      b.onclick=()=>{
        const id=+b.dataset.prop;
        const choose=()=>{ selectProp(id); openPropEntry(id); };
        if(window.SfUiFeedback)SfUiFeedback.tap(b,choose,{delay:0,press:false});
        else choose();
      };
    });
    wireDetail();
    $('[data-action="rank-shop"]',p)?.addEventListener('click',()=>ClassicExtras.rankShop(0,'shop'));
    $('[data-action="prev"]',p)?.addEventListener('click',(e)=>popTap(e.currentTarget,()=>openBag(mode,bagPage-1)));
    $('[data-action="next"]',p)?.addEventListener('click',(e)=>popTap(e.currentTarget,()=>openBag(mode,bagPage+1)));
    /* 背包页的 f7 必须在整页 DOM 都挂好后再挂引导（page() 里那一次会被后面的重绘吞掉）。 */
    if (window.SfGuide) { try { SfGuide.onPage('bag'); } catch (e) {} }
  }
  /** 金宝箱 / 魔法袋：原版是「打开金宝箱」(65) → 开奖(66) → 领取(68) 三段弹窗。
   *  离线版把三段收成一个说明 + 开奖两个弹窗（文案与权重见 State.openChestProp）。 */
  /** 收掉金杯商店那一颗原版 3911 的视图（翻页/重绘/返回时调用）。 */
  function destroyRankShopBack(page) {
    const view = page && page.__rankBackView;
    if (page) page.__rankBackView = null;
    if (view) { try { view.destroy(); } catch (e) {} }
  }
  /** 金杯商店的返回键：直接挂「随机挑战 → 查看」那一页用的原版 `3911`
   *  （4756 f5 的 `back`：金胶囊 + 「返回」，第 1 帧黄 / 第 2 帧绿）。
   *  位置照原版舞台 `(160.3, 175.5)`；挂载失败才退回普通底栏按钮。 */
  function mountRankShopBack(page, onBack) {
    const host = document.createElement('div');
    host.className = 'rank-shop-back';
    host.style.visibility = 'hidden';
    page.appendChild(host);
    const fallback = () => {
      if (!page.isConnected || $('.rank-shop-fallback-footer', page)) return;
      if (host.parentNode) host.remove();
      const foot = document.createElement('footer');
      foot.className = 'page-footer rank-shop-fallback-footer';
      foot.innerHTML = btn('返回', 'rank-shop-fallback', 'gold', true);
      page.appendChild(foot);
      const b = $('[data-action="rank-shop-fallback"]', foot);
      if (b) b.onclick = onBack;
    };
    const mount = () => {
      if (!window.SfRender || !SfRender.mountSymbol) { fallback(); return; }
      SfRender.mountSymbol(host, '3911', { frame: 1, label: '返回' }).then((view) => {
        if (!page.isConnected || !view || !view.g) { if (view) { try { view.destroy(); } catch (e) {} } fallback(); return; }
        let box = null;
        try { box = view.g.getBBox(); } catch (e) { box = null; }
        if (!box || !(box.width > 0) || !(box.height > 0)) {
          try { view.destroy(); } catch (e) {}
          fallback();
          return;
        }
        /* 3911 的本地画稿不以 (0,0) 为左上角（实测 bbox 约 -54.8,-9.95,107.4×29.45）。
         * 原版是在 4756 f5 上用 `matrix(1,0,0,1,160.3,175.5)` 挂它 —— 也就是说
         * **符号原点**落在 (160.3,175.5)，不是包围盒左上角。把 viewBox 收成 bbox 后，
         * 宿主位置要把 bbox 的负偏移补回去，否则整颗键会往右下跑、还被舞台裁掉。 */
        view.g.setAttribute('viewBox', box.x + ' ' + box.y + ' ' + box.width + ' ' + box.height);
        host.style.left = ((160.3 + box.x) / 320 * 100).toFixed(4) + '%';
        host.style.top = ((175.5 + box.y) / 196 * 100).toFixed(4) + '%';
        host.style.width = (box.width / 320 * 100).toFixed(4) + '%';
        host.style.height = (box.height / 196 * 100).toFixed(4) + '%';
        host.style.visibility = '';
        page.__rankBackView = view;
        view.g.style.pointerEvents = 'auto';
        view.g.style.cursor = 'pointer';
        view.g.setAttribute('role', 'button');
        view.g.setAttribute('tabindex', '0');
        view.g.setAttribute('aria-label', '返回');
        view.g.style.outline = 'none';
        const hover = (on) => { try { view.gotoAndStop(on ? 2 : 1); } catch (e) {} };
        view.g.addEventListener('pointerenter', () => hover(true));
        view.g.addEventListener('pointerleave', () => hover(false));
        const fire = (e) => { if (e) { e.preventDefault(); e.stopPropagation(); } onBack(); };
        view.g.addEventListener('click', fire);
        view.g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fire(e); });
      }).catch(() => fallback());
    };
    if (window.SfRender && SfRender.loadExtra) {
      SfRender.loadExtra('tags-challenge.json').catch(() => {}).then(mount);
    } else {
      mount();
    }
  }
  /** 金杯商店：**直接复用道具页「商店」的版面与鼠标反馈**（6 格/页、右侧说明、
   *  左右翻页；格子悬停变绿、点击回弹）。只换商品源与售价（金杯+金松果），
   *  兑换确认走 `ClassicExtras.rankBuy()`。返回键用原版 3911，`origin` 决定回商店还是天梯菜单。 */
  function openRankShop(pg, origin) {
    const CE = window.ClassicExtras;
    /* 从道具商店底栏进来 → 退出回商店；从天梯菜单进来 → 退出回天梯赛菜单。 */
    const backTo = origin === 'shop' ? 'shop' : 'ladder';
    /* 翻页/兑换后重绘会换掉整页 DOM；先收掉上一页的 3911 视图，别让它在播放表里空转。 */
    destroyRankShopBack(document.querySelector('.rank-shop-page'));
    if (!CE || !CE.rankGoodsList) { toast('金杯商店数据未就绪'); return; }
    const goods = CE.rankGoodsList();
    const total = Math.max(1, Math.ceil(goods.length / 6));
    const pgNo = Math.max(0, Math.min(Number(pg) || 0, total - 1));
    const shown = goods.slice(pgNo * 6, pgNo * 6 + 6);
    if (!shown.some((g) => String(g.id) === String(selectedRankGood))) selectedRankGood = shown[0] ? shown[0].id : 0;
    const S = State.state();
    const iconOf = (g, selected) => icon(g.type === '2' ? 'gear' : 'prop', g.goodsId, false, selected);
    /* 售价按用户口径：数字 + 金杯图 + 数字 + 金松果图，中间不再写「杯/果」或「/」。
     * 金杯沿用道具 40 的经典图，金松果沿用商店同一颗 `gold-acorn.png`。 */
    const CUP_ICON = atlasIcon('prop', 40);
    const priceMarkup = (g, detail) => {
      const cup = Math.max(0, Number(g.cup) || 0), gold = Math.max(0, Number(g.gold) || 0);
      const cls = detail ? 'rank-price rank-price-detail' : 'item-caption rank-caption rank-price';
      return '<span class="' + cls + '" role="img" aria-label="售价 ' + cup + ' 金杯、' + gold + ' 金松果">' +
        '<span class="rank-price-part"><b>' + cup + '</b><img class="rank-price-art" src="' + CUP_ICON + '" alt=""></span>' +
        '<span class="rank-price-part"><b>' + gold + '</b><img class="rank-price-art" src="' + GOLD_ICON + '" alt=""></span>' +
        '</span>';
    };
    const limitText = (g) => {
      const lim = CE.rankLimitInfo ? CE.rankLimitInfo(g) : { account: false, limit: Number(g.timesLimit) || 0, bought: Number((S.rankPurchases || {})[g.id]) || 0 };
      if (!(lim.limit > 0)) return '不限兑换次数';
      return (lim.account ? '账号限购 ' : '本周限兑 ') + lim.limit + ' 次（已' + (lim.account ? '购 ' : '兑 ') + lim.bought + '）';
    };
    const detailMarkup = (g) => {
      if (!g) return '<h3>金杯商店</h3><div class="bag-description">本周还没有可兑换的奖励。</div>';
      return '<h3>' + esc(g.name) + '</h3>' +
        '<div class="bag-description">' + esc(g.remark || '') + '</div>' +
        '<div class="bag-item-meta">售价 ' + priceMarkup(g, true) + '<br>' +
          '积分要求 ' + (Number(g.integral) || 0) + '<br>' +
          limitText(g) + '</div>' +
        '<div class="rank-wallet">当前：金杯 ' + (Number(S.goldCup) || 0) + '　金松果 ' + (Number(S.goldPoint) || 0) +
          '　积分 ' + (Number(S.integral) || 0) + '</div>';
    };
    const cells = shown.map((g) => {
      const on = String(g.id) === String(selectedRankGood);
      return '<button class="catalog-cell' + (on ? ' selected' : '') + '" data-rank-good="' + g.id + '" aria-label="' +
        esc(g.name) + '，' + (Number(g.cup) || 0) + ' 金杯 + ' + (Number(g.gold) || 0) + ' 金松果" aria-pressed="' + on + '">' +
        '<span class="item-icon">' + iconOf(g, on) + '</span>' + priceMarkup(g, false) + '</button>';
    }).join('') + Array.from({ length: 6 - shown.length }, () =>
      '<div class="catalog-cell empty-slot" aria-hidden="true"><span class="item-icon"></span></div>').join('');
    const content = '<div class="bag-layout"><div class="catalog-grid bag-grid">' + cells +
      '</div><aside class="bag-detail" aria-live="polite">' +
      detailMarkup(shown.find((g) => String(g.id) === String(selectedRankGood)) || shown[0]) + '</aside></div>' +
      (pgNo ? '<div class="page-arrow prev">' + btn('‹', 'rank-prev', 'arrow') + '</div>' : '') +
      (pgNo < total - 1 ? '<div class="page-arrow bag-next">' + btn('›', 'rank-next', 'arrow') + '</div>' : '');
    const p = page('bag', 'shop', content, {
      cls: 'classic-bag-board shop-board rank-shop-board',
      pageClass: 'rank-shop-page',
      counter: (pgNo + 1) + '/' + total,
      /* 返回键不用自建底栏：套用「随机挑战 → 查看」那一页的原版 3911（金胶囊 + 返回）。 */
      noFooter: true,
    });
    wirePopTaps(p, { tabs: true, cells: true, arrows: true });
    installBagTabVectors(p);
    const leave = () => {
      destroyRankShopBack(p);
      if (backTo === 'shop') {
        try { UI.runAction('shop'); } catch (e) { home(); }
      } else if (window.SfChallenge && SfChallenge.goArenaPage) {
        SfChallenge.goArenaPage('menu');
      } else {
        home();
      }
    };
    mountRankShopBack(p, leave);
    const select = (id) => {
      selectedRankGood = id;
      const g = shown.find((x) => String(x.id) === String(id));
      for (const cell of $$('[data-rank-good]', p)) {
        const on = String(cell.dataset.rankGood) === String(id);
        /* ⚠ 每一格用**自己的**商品图标；以前这里用了当前选中的 `g`，鼠标扫过一格
         *  会把整页六格图标都刷成那一件（用户会看到一页全是同一个图标）。 */
        const own = shown.find((x) => String(x.id) === String(cell.dataset.rankGood));
        cell.classList.toggle('selected', on);
        cell.setAttribute('aria-pressed', String(on));
        $('.item-icon', cell).innerHTML = own ? iconOf(own, on) : '';
        if (window.SfUiFeedback) SfUiFeedback.bind(cell, { selected: on });
      }
      $('.bag-detail', p).innerHTML = detailMarkup(g);
    };
    $$('[data-rank-good]', p).forEach((b) => {
      /* 与商店页同一套：移到哪一格哪一格变绿并同步右侧说明；单击打开兑换确认。 */
      b.addEventListener('pointerenter', () => select(String(b.dataset.rankGood)));
      b.onclick = () => {
        const id = b.dataset.rankGood;
        const choose = () => {
          select(String(id));
          const g = shown.find((x) => String(x.id) === String(id));
          if (g && CE.rankBuy) CE.rankBuy(g.id, () => { try { openRankShop(pgNo, backTo); } catch (e) {} });
        };
        if (window.SfUiFeedback) SfUiFeedback.tap(b, choose, { delay: 0, press: false });
        else choose();
      };
    });
    wirePopTaps(p, {});
    $('[data-action="rank-prev"]', p)?.addEventListener('click', (e) => popTap(e.currentTarget, () => openRankShop(pgNo - 1, backTo)));
    $('[data-action="rank-next"]', p)?.addEventListener('click', (e) => popTap(e.currentTarget, () => openRankShop(pgNo + 1, backTo)));
    return p;
  }
  function openChestDetail(id, shop) {
    const pet = id === 79;
    const name = pet ? '魔法袋' : '金宝箱';
    /* 概率与 State.rollChestReward 一一对应；改权重时两处一起改。 */
    const magicOdds = [
      '6 级宝石：3%（1 颗）',
      '5 级宝石：15%（1 颗）',
      '蓝色碎片：15%（5~10 个）',
      '召唤证：17%（1~2 个）',
      '金松果：25%（300 / 350 / 400 / 450 / 500）',
      '孵化点：25%（100 点）',
    ];
    const goldOdds = State.blackGearEnabled()
      ? [
        '6 级宝石：4%（1 颗）',
        '5 级宝石：22%（10% 开出 2 颗，12% 开出 1 颗）',
        '基础属性点：49%（6 点 24%、8 点 14%、10 点 8%、12 点 4%）',
        '金松果：15%（500 / 750 / 1000）',
        '黑色卡片：8%（1 张）',
        '完整黑装：2%（仅首开；凤凰/圣熊 10%、黑狂战 30%、黑怒战 60%）',
      ]
      : [
        '6 级宝石：4%（1 颗）',
        '5 级宝石：22%（10% 开出 2 颗，12% 开出 1 颗）',
        '基础属性点：49%（6 点 24%、8 点 14%、10 点 8%、12 点 4%）',
        '金松果：25%（500 / 750 / 1000）',
      ];
    const oddsHtml = (rows) => '<p class="small-label">打开后随机获得其中一种：</p><p class="small-label">' +
      rows.map((row) => '· ' + row).join('<br>') + '</p>';
    const rewardIcon = (reward) => reward.kind === 'prop' ? icon('prop', reward.id)
      : reward.kind === 'gear' ? icon('gear', reward.id)
        : reward.kind === 'gold' ? goldIcon()
          : reward.kind === 'points' ? '<b class="reward-badge">点</b>'
            : '<b class="reward-badge">蛋</b>';
    const rewardHtml = (reward) => '<div class="detail-summary"><span class="item-icon">' + rewardIcon(reward) + '</span><div>' +
      '<h3 class="detail-name">' + esc(reward.name) + ' ×' + esc(reward.count) + '</h3>' +
      '<div class="detail-description">' + (reward.kind === 'points'
        ? '点「确定领取」后会进入待分配属性点，可在升级弹窗里分到力/敏/速/生命。'
        : reward.kind === 'gear' ? '点「确定领取」后放入装备栏，可到状态页查看。'
          : '点「确定领取」后入账。') + '</div></div></div>';
    if (pet) {
      const m = modal(name, '<div class="detail-summary"><span class="item-icon">' + icon('prop', id) + '</span><div><h3 class="detail-name">' + name + '</h3>' +
        '<div class="detail-description">使用后有一定几率获得稀有道具：召唤证、5/6 级宝石、蓝色碎片、孵化点或金松果' +
        (State.blackGearEnabled() ? '；<b>额外获得黑色卡片 ×1</b>' : '') + '。</div></div></div>' +
        oddsHtml(magicOdds), [
        { label: '打开', cls: 'gold', run: () => {
          const r = State.openChestProp(id);
          m.close();
          if (!r.ok) { toast(r.msg); return; }
          notice(r.msg, [{ label: '确定', run: () => { openBag(!!shop, bagPage); } }]);
          refreshHeader();
        } },
        { label: '取消', cls: 'muted' },
      ], { small: true });
      return;
    }
    /* 金宝箱：开 → 看结果 →（可重开 500 次）→ 确定领取。
     * 结果先挂 `State.chestState()`，关掉游戏再进会自动入账（见 settlePendingChest）。 */
    const show = () => {
      const state = State.state();
      const pending = State.chestState ? State.chestState() : null;
      if (!pending) {
        const count = Number(state.props[90] || 0);
        const actions = count > 0
          ? [{ label: '打开', cls: 'gold', run: () => {
            const r = State.beginChest(90);
            if (!r.ok) { toast(r.msg); return; }
            show();
          } }, { label: '取消', cls: 'muted' }]
          : [{ label: '确定', cls: 'gold' }];
        modal(name, '<div class="detail-summary"><span class="item-icon">' + icon('prop', 90) + '</span><div><h3 class="detail-name">' + name + '</h3>' +
          '<div class="detail-description">' + (State.blackGearEnabled()
            ? '内含基础属性点与高级宝石；原版的黑凤凰/黑圣熊装备在本版未开放，用金松果替代。'
            : '内含基础属性点与高级宝石。') + '</div></div></div>' +
          oddsHtml(goldOdds) + '<p class="small-label">当前拥有 <b>' + count + '</b> 个；71~90 级每升 1 级获得 1 个。</p>',
        actions, { small: true });
        return;
      }
      const max = Number(State.CHEST_REOPEN_MAX) || 500;
      const reopened = pending.lotteryCount >= max;
      const cost = State.chestReopenCost(pending.lotteryCount);
      const actions = [{ label: '确定领取', cls: 'gold', run: () => {
        const r = State.confirmChest();
        if (!r.ok) { toast(r.msg); return; }
        notice(r.msg, [{ label: '确定', run: () => { openBag(!!shop, bagPage); } }]);
        refreshHeader();
      } }];
      if (!reopened) actions.push({ label: '重开', run: () => {
        const r = State.reopenChest();
        if (!r.ok) { toast(r.msg); return; }
        show();
      } });
      modal(name, rewardHtml(pending.reward) +
        '<p class="small-label">已重开 <b>' + pending.lotteryCount + '</b> / ' + max + ' 次' +
        (reopened ? '（已达上限）' : '　下次重开需要 <b>' + cost + '</b> 金松果（当前 ' + state.goldPoint + '）') + '</p>' +
        oddsHtml(goldOdds), actions, { small: true, locked: true });
    };
    show();
  }
  /** 经典背包「使用」：原版 4886 f1 弹窗，业务仍走 State.useProp / SfGuide / openBag。
   *  · 「使用」在右、「取消」在左（与 ssfight 原版相反，用户 2026-10 口径）；
   *  · 素材挂载失败时回退到原来那套 DOM 详情弹窗，不能因为 UI 包缺失就打不开道具；
   *  · 大小体力药剂成功后可继续点（原版 stayOpen 口径），其余成功关闭并回背包。 */
  function openClassicUseProp(id, base, mode, backMode) {
    let handle = null;
    let using = false;
    let stale = false;
    /** 素材失败时才回退 DOM；用户已经离开背包 / 又被另一个道具弹窗替代时不要回退，
     *  否则异步回来会把 DOM 弹窗盖到后来进入的页面上（经典页生命周期的老坑）。 */
    const canFallback = () => {
      const page = document.querySelector('.classic-page[data-screen="bag"]');
      return !!(!stale && page && page.isConnected && !(window.SfPropUse && SfPropUse.active())
        && UI.currentUiMode && UI.currentUiMode() === 'classic');
    };
    const fallback = () => { if (canFallback()) openProp(id, mode, { forceDom: true }); };
    const useOne = () => {
      if (using || !handle) return;
      using = true;
      let r = null;
      try { r = State.useProp(id); }
      catch (e) {
        using = false;
        if (window.__errs) window.__errs.push('prop use: ' + (e && e.message));
        toast('使用失败');
        return;
      }
      using = false;
      if (!r) return;
      if (!r.ok && r.needsFruitChoice) { handle.close(); fruitChoiceDialog(r); return; }
      if (!r.ok && r.needsBlackChoice) { handle.close(); blackCardDialog(r); return; }
      if (!r.ok && r.needsBlackGearChoice) { handle.close(); blackGearBoxDialog(r); return; }
      /* 属性书不是普通「使用」：State.useProp(37) 需要 8 点分配参数，直接调用只会得到
       * needsAllocation。经典背包的 4886 使用窗必须把玩家接到分配弹窗，否则点了没反应。 */
      if (!r.ok && r.needsAllocation) { handle.close(); allocateAttributes(); return; }
      /* 新手引导 f8→f9：成功提示由引导接管（关详情 → 弹「提示」→ 页 9）。 */
      if (window.SfGuide && SfGuide.onPropUsed && SfGuide.onPropUsed(id, base.name, r, handle)) return;
      if (!r.ok) { toast(r.msg || '使用失败'); return; }
      toast(r.msg || (r.gear ? '使用成功：' + r.gear.name : '使用成功'));
      if (id === 1 || id === 2) {
        try { handle.sync(); } catch (e) {}
        try { refreshHeader(); } catch (e) {}
        return;
      }
      handle.close();
      openBag(backMode, bagPage);
    };
    SfPropUse.open(id, {
      onUse: useOne,
      onCancel: () => openBag(backMode, bagPage),
      onStale: () => { stale = true; },
    }).then((h) => {
      if (!h) { fallback(); return; }
      handle = h;
      /* 原版 doMission(7) 的 seeProp：详情一开出来就告诉引导。 */
      if (window.SfGuide && SfGuide.onPropDetail) {
        try { SfGuide.onPropDetail(id, mode); } catch (e) {}
      }
    }).catch((e) => {
      if (window.__errs) window.__errs.push('prop use open: ' + (e && e.message));
      fallback();
    });
  }
  /** 经典商店购买窗（4886 f2）。素材失败时回退到原来的 DOM 详情，不能让商品点不开。 */
  function openClassicBuyProp(id, base, mode, backMode) {
    const pageAtOpen = document.querySelector('.classic-page[data-screen="shop"]');
    const status = State.purchaseStatus(id);
    let stale = false;
    SfPropUse.openBuy(id, {
      desc: base.remark || '',
      stock: status.remaining,
      max: Math.max(1, Math.min(50, status.remaining || 1)),
      onBuy: (qty, h) => {
        const r = State.buyProp(id, qty);
        if (!r.ok) {
          toast(r.msg);
          if (h && h.setReason) h.setReason(r.msg);
          return false;
        }
        toast(r.msg);
        refreshHeader();
        /* 用户 2026-10 口径：每日可买多件的商品，买一件后**留在购买窗**继续买；
         * 只有点「取消」才回商店。限购 1 件的商品仍按原逻辑买完关窗。 */
        const next = State.purchaseStatus(id);
        if (h && h.sync) h.sync({ stock: next.remaining });
        if (next.remaining <= 0 && h && h.setReason) h.setReason('今日已经卖完了，明天再来。');
        return status.limit <= 1;
      },
      onClose: () => {
        if (!stale && pageAtOpen && pageAtOpen.isConnected && pageAtOpen.dataset.screen === 'shop') openBag(true, bagPage);
      },
      onStale: () => { stale = true; },
    }).then((h) => {
      if (h) {
        if (window.SfGuide && SfGuide.onPropDetail) {
          try { SfGuide.onPropDetail(id, mode); } catch (e) {}
        }
        return;
      }
      /* 素材没挂出来，或玩家已经离开商店：只有还停在原商店页时才回退 DOM。 */
      if (!stale && pageAtOpen && pageAtOpen.isConnected && pageAtOpen.dataset.screen === 'shop') {
        openProp(id, mode, { forceDom: true });
      }
    }).catch((e) => {
      if (window.__errs) window.__errs.push('shop buy window: ' + (e && e.message));
      if (!stale && pageAtOpen && pageAtOpen.isConnected && pageAtOpen.dataset.screen === 'shop') {
        openProp(id, mode, { forceDom: true });
      }
    });
  }
  /** 不可使用道具的详情（卷轴/挑战书/英雄帖/勇气徽章/抽奖卷等）：4886 f1 原版窗 + 矢量图标。 */
  function openClassicInfoProp(id, base, mode, backMode) {
    const pageAtOpen = document.querySelector('.classic-page');
    let stale = false;
    SfPropUse.openInfo(id, {
      onClose: () => {
        if (!stale && pageAtOpen && pageAtOpen.isConnected) openBag(backMode, bagPage);
      },
    }).then((h) => {
      if (!h && !stale && pageAtOpen && pageAtOpen.isConnected) openProp(id, mode, { forceDom: true });
    }).catch((e) => {
      if (window.__errs) window.__errs.push('prop info window: ' + (e && e.message));
      if (!stale && pageAtOpen && pageAtOpen.isConnected) openProp(id, mode, { forceDom: true });
    });
  }
  /** mode：true=商店（购买）/'exchange'=兑换页/其它=背包（使用·合成）。 */
  function openProp(id,mode,opts) {
    opts=opts||{};
    const shop=mode===true,exchange=mode==='exchange';
    const backMode=shop?true:exchange?'exchange':false;   // 返回时回到来的那一页
    const base=propMap.getValue(id),S=State.state();
    if(!base)return;
    /* 经典商店：原版 `showBuyPropWin` 挂的是「道具1」4886 第 2 帧（购买窗），
     * 不是复刻自绘的 DOM 详情。购买数量由箭头调整，购买/取消走原版两颗键。
     * 金宝箱/魔法袋在商店里也走这个购买窗；它们在背包里才走开箱说明。 */
    if(shop && !opts.forceDom && window.SfPropUse && SfPropUse.openBuy
        && UI.currentUiMode && UI.currentUiMode()==='classic') {
      openClassicBuyProp(id, base, mode, backMode);
      return;
    }
    if(id===79||id===90){ openChestDetail(id,shop); return; }
    const isFragment=[24,25,26].includes(id),isConvertShard=id===GData.CONVERT_SHARD_ID,isSeed=[45,46].includes(id),isGem=State.gemLevel(id)>0,canUse=base.useType==='1';
    /* 经典背包的 useType 1 道具：改用原版「道具1」4886 f1 的 SVG 弹窗，
     * 不再画手搓 DOM 详情（商店 / 兑换页保持原样）。素材挂载失败时
     * `openClassicUseProp` 会以 forceDom 回退到下面这套 DOM 弹窗。 */
    if (!shop && !exchange && canUse && !opts.forceDom && window.SfPropUse
        && UI.currentUiMode && UI.currentUiMode() === 'classic') {
      openClassicUseProp(id, base, mode, backMode);
      return;
    }
    /* 不可使用、也不可合成/镶嵌的道具：原版详情窗（4886 f1）而不是复刻自绘面板。 */
    const infoOnly = !shop && !canUse && !isFragment && !isSeed && !isConvertShard && !isGem && id !== 37;
    if (infoOnly && !opts.forceDom && window.SfPropUse && SfPropUse.openInfo
        && UI.currentUiMode && UI.currentUiMode() === 'classic') {
      openClassicInfoProp(id, base, mode, backMode);
      return;
    }
    const status=shop?State.purchaseStatus(id):null;
    // 天使/恶魔果实种子：只提示武技是否已满，不阻止合成 ——
    // 已满时合成的天使果实仍然可以留着，等有空位再用。
    // 注意：用 State.ownedWSCount()（它把「师父驾到」排除在外）——那是拜师剧情赠送的技能，
    // 不占武器/技能上限位；旧写法直接加 S.skills.length 会在学了师父驾到后提前显示「已满」。
    const wsNow=State.ownedWSCount?State.ownedWSCount():S.weapons.length+S.skills.length,wsMax=State.wsLimit(),wsFull=wsNow>=wsMax;
    const seedNote=isSeed?('<p class="small-label">武器/技能：<b class="'+(wsFull?'ws-full':'ws-ok')+'">'+wsNow+'/'+wsMax+(wsFull?'（已满，果实仍可合成，等有空位时再使用）':'（未满，可继续获得）')+'</b></p>'):'';
    const shardNote=isConvertShard?('<p class="small-label">当前 <b>'+(S.props[id]||0)+'</b>/'+GData.CONVERT_SHARD_COST+' 个　天梯赛战斗里点飘出来的三角碎片获得</p>'):'';
    // 碎片、果实种子、属性碎片与宝石：每次合成消耗固定材料与金松果。
    // 所有道具都只有「使用/合成」一次一个动作：点完不关弹窗、不换界面，可以继续点。
    const isPotion=!shop&&(id===1||id===2);
    const held=S.props[id]||0,cap=State.energyHardCap();
    const perPotion=id===1?10:30;
    const batchCost=isGem?3:10;                    // 每次合成消耗的材料个数
    const batchGold=isGem?10:50;                   // 每次合成消耗的金松果
    const fruitId=id===45?47:48;
    const batchName=isFragment?'装备':isSeed?propMap.getValue(fruitId).name:isConvertShard?'转化丸（随机）':'更高一级宝石';
    // 每种道具当前能不能再来一次（材料/金币/体力上限），用来说明按钮为什么变灰
    const blockReason=()=>{
      if(shop){
        if(!status.remaining)return '今日已经卖完了，明天再来。';
        if(id===47 && Number(State.state().level) < 30) return '需要达到30级后才可购买此道具！';
        return '';
      }
      const now=(State.state().props[id]||0);
      if(isPotion)return State.state().energy>=cap?'体力已经满了，无法继续使用。':(now<1?'背包里没有体力药剂了。':'');
      if(isFragment||isSeed||isConvertShard){
        if(now<batchCost)return '材料不足：还需要 '+(batchCost-now)+' 个'+base.name+'。';
        if(S.goldPoint<batchGold)return '金松果不足：每次合成需要 '+batchGold+' 个。';
        return '';
      }
      if(isGem){
        if(State.gemLevel(id)>=7)return '七级宝石已是最高等级。';
        if(now<3)return '需要 3 个同级宝石。';
        if(S.goldPoint<10)return '金松果不足 10 个。';
        return '';
      }
      if(canUse)return now<1?'背包里没有这个道具了。':'';
      return '';
    };
    const liveOwn=()=>String(State.state().props[id]||0);
    const potionNote=isPotion?('<p class="small-label">体力：<b data-live="potion" class="'+((S.energy>S.maxEnergy)?'ws-full':'ws-ok')+'">'+S.energy+'/'+S.maxEnergy+'</b>'+
      (S.energy>S.maxEnergy?'（超出部分不自然回复，仍可用于挑战）':'')+'</p>'):'';
    const batchNote=(isFragment||isSeed||isConvertShard||isGem)?('<p class="small-label">每次合成：'+base.name+' ×'+batchCost+' + 金松果 ×'+batchGold+'　→　'+batchName+'</p>'):'';
    const content='<div class="detail-summary"><span class="item-icon">'+icon('prop',id)+'</span><div><h3 class="detail-name">'+esc(base.name)+'</h3><div class="detail-description">'+esc(base.remark||'')+'</div>'+
      '<div class="small-label">拥有 <b data-live="own">'+(State.bagCountOf?State.bagCountOf(id):(S.props[id]||0))+'</b> 个'+(shop?'　售价 '+goldPrice(base.price)+'<br>每日限购 '+status.limit+' 件，今日剩余 <b data-live="stock">'+status.remaining+'</b> 件':'')+'</div></div></div>'+
      seedNote+shardNote+potionNote+batchNote+
      (isGem?'<p class="small-label">3 个同级宝石 + 10 金松果合成高一级，成功率 '+Math.round(State.gemMergeRate(State.gemLevel(id))*100)+'%（0.88 的材料等级次方）；失败有 50% 几率一颗材料降 1 级（1级则碎裂）。</p>':'')+
      '<p class="small-label use-preview" data-live="hint" role="status"></p>';
    // 主按钮只在真的有动作时才给；否则会出现「返回」和尾部的「返回」两个按钮
    const label=shop?(status.remaining?'购买':'今日售罄'):isFragment?'合成装备':isConvertShard?'合成转化丸':isSeed?'合成果实':isGem?'合成宝石':id===37?'分配属性':canUse?'使用':'';
    // 天使/恶魔果实种子：10 个种子 + 50 金松果 → 1 个果实（规则在 State.composeSeed）
    // 只有「大小体力药剂」和「碎片合成」需要连着点，弹窗保持打开；
    // 商店里「非每日限购 1 件」的商品也保持打开（买完原地刷新，可以接着买）。
    const stayOpen=!shop&&(isPotion||isFragment);
    const keepOpen=stayOpen||(shop&&status&&status.limit!==1);
    const useOne=()=>{
      if(!shop&&!canUse&&!isFragment&&!isConvertShard&&!isSeed&&!isGem)return;
      if(!shop&&id===37){allocateAttributes();return;}
      /* 经典模式：碎片 / 种子 / 转化丸 / 宝石统一走原版 4886 f5 + 4402 的
       * 「合成页 → 合成中过场 → 结果页」；现代模式仍走下面的 DOM 弹窗。 */
      if(!shop&&window.SfCompose&&UI.currentUiMode&&UI.currentUiMode()==='classic'
          &&(isFragment||isSeed||isConvertShard||isGem)){
        m.close();
        SfCompose.open(id,{onClose:()=>openBag(backMode,bagPage)});
        return;
      }
      // 注意顺序：宝石要先判断 isGem，否则「使用」类道具（礼包、果实、转生果…）会被当成宝石合成
      const r=shop?State.buyProp(id,1)
        :isPotion?State.useProp(id)
        :isFragment?State.composeGear(id)
        :isSeed?State.composeSeed(id)
        :isConvertShard?State.composeConvertPill()
        :isGem?State.mergeGems(id)
        :State.useProp(id);
      if(!r.ok&&r.needsFruitChoice){m.close();fruitChoiceDialog(r);return;}
      if(!r.ok&&r.needsBlackChoice){m.close();blackCardDialog(r);return;}
      if(!r.ok&&r.needsBlackGearChoice){m.close();blackGearBoxDialog(r);return;}
      /* 新手引导 f8→f9：原版 useProp 成功会 `showTips(4,0,"使用X成功。")+viewNextMission()`
       *（:1519），教程期间由引导接管这条提示（f9 的金环贴提示窗的「确定」）。 */
      if(!shop&&window.SfGuide&&SfGuide.onPropUsed&&SfGuide.onPropUsed(id,base.name,r,m))return;
      toast(r.msg||(r.gear?'合成成功：'+r.gear.name:'操作完成'));
      if(!r.ok)return;
      if(keepOpen){syncLive();return;}
      // 其它道具：关掉详情、退回上一级页面（背包/商店/兑换）
      m.close();
      openBag(backMode,bagPage);
    };
    const buttons=[];
    // 需要连点的（药剂/碎片/商店非限购品）设 close:false，点完不关弹窗。
    if(label)buttons.push({label,close:!keepOpen,run:useOne});
    buttons.push({label:'返回',cls:'muted',run:()=>openBag(backMode,bagPage)});
    const m=modal(shop?'道具商店':'道具详情',content,buttons,{small:true});
    /* 新手引导 f8：详情弹窗一开出来就告诉引导（原版 doMission(7) 的 seeProp）；
     * 商店 / 兑换页的详情不参与教程。 */
    if (window.SfGuide && SfGuide.onPropDetail) { try { SfGuide.onPropDetail(id, mode); } catch (e) {} }
    /** 只更新弹窗里的实时数字与按钮状态（不重建弹窗，避免界面跳动）。 */
    function syncLive(){
      const now=State.state();
      const set=(key,value)=>{const el=$('[data-live="'+key+'"]',m.element);if(el)el.textContent=value;};
      set('own',liveOwn()); set('gold',now.goldPoint);
      if(shop){const st=State.purchaseStatus(id);set('stock',st.remaining);status.remaining=st.remaining;}
      const potion=$('[data-live="potion"]',m.element);
      if(potion){
        potion.textContent=now.energy+'/'+now.maxEnergy;
        potion.className=now.energy>now.maxEnergy?'ws-full':'ws-ok';
        const note=$('[data-live="potion"]',m.element).parentElement;
        const extra=now.energy>now.maxEnergy?'（超出部分不自然回复，仍可用于挑战）':'';
        if(note)note.innerHTML='体力：<b data-live="potion" class="'+(now.energy>now.maxEnergy?'ws-full':'ws-ok')+'">'+now.energy+'/'+now.maxEnergy+'</b>'+extra;
      }
      const reason=blockReason();
      const hint=$('[data-live="hint"]',m.element);
      if(hint){hint.textContent=reason;hint.classList.toggle('full',!!reason);}
      const main=$('[data-action="0"]',m.element);
      if(main){main.disabled=!!reason;if(label)main.textContent=label;}
      if(shop&&!status.remaining)main.disabled=true;
      refreshHeader();
    }
    syncLive();
  }
  /* 天使果实 / 恶魔果实：随机三选一（天使=学会一个，恶魔=遗忘一个）。
   * 候选由 State.fruitOptions 抽好，这里只负责展示与回传选择。 */
  /* ============================================================
   * 【UC11】果实三选一 / 属性分配 / 升级选择
   * ============================================================ */
  function fruitChoiceDialog(r) {
    const isGain = r.mode === 'gain';
    const card = (c, i) => '<button type="button" class="ws-choice" data-fruit-pick="' + i + '">' +
      '<span class="item-icon">' + icon(c.kind, c.id) + '</span>' +
      '<b class="ws-choice-name">' + esc(c.name) + '</b>' +
      '<span class="ws-choice-kind">' + (c.kind === 'weapon' ? '武器' : '技能') + (c.type ? ' · ' + esc(c.type) : '') + '</span>' +
      '<span class="ws-choice-desc">' + esc(c.remark || '—') + '</span></button>';
    const body = '<div class="ws-choice-box"><p class="free-point-tip">' +
      (isGain ? '天使果实：从下面 ' + r.options.length + ' 个里选一个学会。'
              : '恶魔果实：从下面 ' + r.options.length + ' 个里选一个遗忘（不可撤销）。') +
      '</p><div class="ws-choice-row' + (r.options.length < 3 ? ' few' : '') + '">' +
      r.options.map(card).join('') + '</div></div>';
    const m = modal(isGain ? '天使果实 · 三选一' : '恶魔果实 · 三选一', body,
      [{ label: isGain ? '先不用' : '放弃使用', cls: 'muted' }], { small: true, locked: true });
    m.element.classList.add('ws-choice-dialog');
    $$('[data-fruit-pick]', m.element).forEach(b => b.addEventListener('click', () => {
      const c = r.options[Number(b.dataset.fruitPick)];
      if (!c) return;
      const res = State.applyFruitChoice(r.fruit, c.kind, c.id);
      toast(res.msg);
      if (res.ok) { m.close(); openBag(false, bagPage); }
    }));
  }
  /** 黑色卡片：选凤凰/圣熊，选完才消耗卡片。 */
  function blackCardDialog(r) {
    const opts = (r && r.options) || [];
    const body = '<div class="ws-choice-box"><p class="free-point-tip">打开黑色卡片：选择凤凰或圣熊，获得对应碎片 1~2 个，并额外获得 100/200/400 金松果。</p>' +
      '<div class="ws-choice-row' + (opts.length < 3 ? ' few' : '') + '">' +
      opts.map((o) => '<button type="button" class="ws-choice" data-black-set="' + o.setId + '">' +
        '<span class="item-icon">' + icon('prop', o.shardId) + '</span>' +
        '<b class="ws-choice-name">' + esc(o.name) + '</b>' +
        '<span class="ws-choice-kind">黑装碎片</span>' +
        '<span class="ws-choice-desc">已有 ' + (State.state().props[o.shardId] || 0) + ' 个</span></button>').join('') +
      '</div></div>';
    const m = modal('黑色卡片', body, [{ label: '稍后', cls: 'muted' }], { small: true });
    m.element.classList.add('ws-choice-dialog');
    $$('[data-black-set]', m.element).forEach((b) => b.addEventListener('click', () => {
      const res = State.useProp(80, b.dataset.blackSet);
      toast(res.msg);
      if (res.ok) { m.close(); openBag(false, bagPage); }
    }));
  }
  /** 黑装自选箱：凤凰/圣熊 × 4 部位。 */
  function blackGearBoxDialog(r) {
    const opts = (r && r.options) || [];
    const body = '<div class="ws-choice-box"><p class="free-point-tip">打开黑装自选箱：任选 1 件黑色凤凰/圣熊装备（使用等级 60）。</p>' +
      '<div class="ws-choice-row' + (opts.length < 3 ? ' few' : '') + '">' +
      opts.map((o) => '<button type="button" class="ws-choice" data-black-gear="' + o.id + '">' +
        '<span class="item-icon">' + icon('gear', o.id) + '</span>' +
        '<b class="ws-choice-name">' + esc(o.name) + '</b>' +
        '<span class="ws-choice-kind">' + (o.setId === 71 ? '凤凰' : '圣熊') + '</span>' +
        '<span class="ws-choice-desc">' + ['头部', '手部', '身体', '脚部'][o.type] + '</span></button>').join('') +
      '</div></div>';
    const m = modal('黑装自选箱', body, [{ label: '稍后', cls: 'muted' }], { small: true });
    m.element.classList.add('ws-choice-dialog');
    $$('[data-black-gear]', m.element).forEach((b) => b.addEventListener('click', () => {
      const res = State.useProp(89, b.dataset.blackGear);
      toast(res.msg);
      if (res.ok) { m.close(); openBag(false, bagPage); }
    }));
  }
  function allocateAttributes() {
    const keys=[['power','力量'],['agility','敏捷'],['speed','速度']];
    const m=modal('分配属性','<p>将属性书的8点潜力分配给力量、敏捷和速度。</p><div class="attribute-allocation">'+keys.map(([key,name])=>'<label>'+name+'<input type="number" min="0" max="8" step="1" value="0" data-stat="'+key+'" aria-label="分配'+name+'点数"></label>').join('')+'</div><p class="allocation-remaining" role="status">剩余 8 点</p>',[{label:'确定分配',close:false,run:()=>{
      const allocation=Object.fromEntries(keys.map(([key])=>[key,Number($('[data-stat="'+key+'"]',m.element).value)]));
      const r=State.useProp(37,allocation);toast(r.msg);if(r.ok){m.close();openBag(false,bagPage);}
    }},{label:'取消',cls:'muted'}],{small:true});
    const refresh=()=>{const values=$$('input',m.element).map(e=>Number(e.value));const remaining=8-values.reduce((sum,n)=>sum+n,0);$('.allocation-remaining',m.element).textContent='剩余 '+remaining+' 点';$('[data-action="0"]',m.element).disabled=remaining!==0||values.some(n=>!Number.isInteger(n)||n<0||n>8);};
    $$('input',m.element).forEach(e=>e.oninput=refresh);refresh();
  }
  /* ---------- 升级「三选一」：武器 / 技能 ----------
   * 到 WS_LEVELS 的等级时发一组候选（最多 3 个），必须在弹窗里选一个才继续。
   * 和自由属性点一样是 locked 弹窗；一组选完自动接到下一组，最后再轮到加点弹窗。 */
  function wsChoiceDialog() {
    if (typeof State.pendingWS !== 'function' || State.pendingWS() <= 0) return null;
    if ($$('.classic-modal-overlay').some(o => o.querySelector('.ws-choice-box'))) return null;
    const list = State.currentWSChoices();
    if (!list.length) { State.chooseWSRandom(); return null; }
    const card = (c, i) => '<button type="button" class="ws-choice" data-ws-pick="' + i + '">' +
      '<span class="item-icon">' + icon(c.kind, c.id) + '</span>' +
      '<b class="ws-choice-name">' + esc(c.name) + '</b>' +
      '<span class="ws-choice-kind">' + (c.kind === 'weapon' ? '武器' : '技能') + (c.type ? ' · ' + esc(c.type) : '') + '</span>' +
      '<span class="ws-choice-desc">' + esc(c.remark || '—') + '</span></button>';
    const body = '<div class="ws-choice-box"><p class="free-point-tip">升级奖励：从下面' + list.length + ' 个里选一个学会（' +
      (State.pendingWS() > 1 ? '还有 ' + (State.pendingWS() - 1) + ' 组在后面等着' : '只有这一组') + '）。</p>' +
      '<div class="ws-choice-row' + (list.length < 3 ? ' few' : '') + '">' + list.map(card).join('') + '</div></div>';
    const m = modal('选择武器或技能', body, [
      { label: State.pendingWS() > 1 ? '全部随机' : '随便来一个', cls: 'muted', close: false, run: () => { State.chooseWSRandom(); refresh(); } },
    ], { small: true, locked: true });
    m.element.classList.add('ws-choice-dialog');
    const refresh = () => {
      if (State.pendingWS() > 0 && State.currentWSChoices().length) {
        const next = State.currentWSChoices();
        m.element.querySelector('.modal-body').innerHTML = '<div class="ws-choice-box"><p class="free-point-tip">升级奖励：从下面' + next.length + ' 个里选一个学会（' +
          (State.pendingWS() > 1 ? '还有 ' + (State.pendingWS() - 1) + ' 组在后面等着' : '最后一组') + '）。</p>' +
          '<div class="ws-choice-row' + (next.length < 3 ? ' few' : '') + '">' + next.map(card).join('') + '</div></div>';
        bindPicks();
        return;
      }
      m.close();
      promptLevelUpChoices();     // 这一组选完了，接着弹加点弹窗（如果还有）
    };
    function bindPicks() {
      $$('[data-ws-pick]', m.element).forEach(b => b.addEventListener('click', () => {
        const c = State.currentWSChoices()[Number(b.dataset.wsPick)];
        if (!c) return;
        const r = State.chooseWS(c.kind, c.id);
        if (r.ok) toast('学会了【' + r.name + '】');
        else toast(r.msg || '选择失败');
        refresh();
      }));
    }
    bindPicks();
    return m;
  }
  /* ---------- 自由属性点（升级当场自选，四项平衡，占比过低系统代选） ----------
   * 规则在 State：allocatePoint 会在某一项占比低于门槛时直接代选（redirected=true），
   * 所以界面即使被绕过也守得住。这里只负责把「升级时就得选掉」变成一个没有关闭叉的弹窗，
   * 点数不进背包、不在界面任何地方常驻显示。 */
  const STAT_LABEL={power:'力量',agility:'敏捷',speed:'速度',hp:'生命'};
  const statField=(key)=>key==='hp'?'maxHp':key;
  function freePointDialog() {
    if(typeof State.pendingPoints!=='function'||State.pendingPoints()<=0)return null;
    if($$('.classic-modal-overlay').some(o=>o.querySelector('.free-point-box')))return null;
    const rows=State.STAT_KEYS.map(key=>'<div class="free-point-row" data-row="'+key+'"><span class="fp-name">'+STAT_LABEL[key]+'</span>'+
      '<b class="fp-value" data-value="'+key+'">0</b><span class="fp-share" data-share="'+key+'">0%</span>'+
      '<button type="button" class="uc-button small" data-point="'+key+'">+'+State.STAT_GAIN[key]+'</button></div>').join('');
    const minPct=Math.round(State.STAT_SHARE_MIN*100);
    const body='<div class="free-point-box"><p class="free-point-tip">升级留了一点属性给你自己加：力量／敏捷／速度各 +1，生命 +5。四项占比（生命按 10 点折算 1 点）任意一项低于 '+minPct+'% 时必须先补它，系统会直接替你选择。</p>'+
      '<div class="free-point-rows">'+rows+'</div>'+
      '<p class="free-point-note" data-live="point-note" role="status"></p>'+
      '<p class="allocation-remaining" data-live="point-left" role="status">剩余 0 点</p></div>';
    const m=modal('分配自由属性点',body,[
      {label:'平均分配',cls:'muted',close:false,run:()=>{State.allocateEvenly();refresh();}},
      {label:'撤回',cls:'muted',close:false,run:()=>{const r=State.undoPoint();if(r.ok)toast(r.msg);refresh();}},
      {label:'确定',cls:'gold',close:false,run:()=>{if(State.pendingPoints()<=0)m.close();}},
    ],{small:true,locked:true});
    m.element.classList.add('point-dialog');
    const refresh=()=>{
      const S=State.state(),shares=State.statShares(),force=State.forcedStat(),left=State.pendingPoints();
      for(const key of State.STAT_KEYS){
        $('[data-value="'+key+'"]',m.element).textContent=S[statField(key)];
        $('[data-share="'+key+'"]',m.element).textContent=Math.round(shares[key]*100)+'%';
        $('[data-row="'+key+'"]',m.element).classList.toggle('forced',force===key);
        $('[data-point="'+key+'"]',m.element).disabled=left<=0;
      }
      $('[data-live="point-left"]',m.element).textContent='剩余 '+left+' 点';
      $('[data-live="point-note"]',m.element).textContent=force
        ?STAT_LABEL[force]+'占比 '+Math.round(shares[force]*100)+'%，低于 '+minPct+'%，接下来必须加到'+STAT_LABEL[force]+'（系统代选）'
        :'四项占比都达标，可以自由选择。';
      $('[data-action="0"]',m.element).disabled=left<=0;                 // 平均分配
      $('[data-action="1"]',m.element).disabled=State.undoDepth()<=0;      // 撤回上一次
      $('[data-action="2"]',m.element).disabled=left>0;                    // 确定
    };
    $$('[data-point]',m.element).forEach(b=>b.addEventListener('click',()=>{
      const r=State.allocatePoint(b.dataset.point);
      if(r.ok&&r.redirected)toast(r.msg);
      refresh();
    }));
    refresh();
    return m;
  }
  /** 有未分配的自由属性点时立刻弹出（首页、页面切换、弹窗出现时都会检查）。 */
  function promptFreePoints() {
    if(typeof State.pendingPoints!=='function'||State.pendingPoints()<=0)return null;
    if($('.point-dialog'))return null;
    return freePointDialog();
  }
  /** 升级奖励的统一入口：先处理 30 级支持作者提示，再选「三选一」的武器/技能，
   *  最后分配自由属性点。支持提示只取一次；关掉它之后再继续后面的升级选择。 */
  function promptLevelUpChoices() {
    if($('.ws-choice-dialog'))return null;
    /* 任何别的经典弹窗还开着都不要叠新的升级弹窗；关掉后 `modal()` 会再调一次。 */
    if($('.classic-modal-overlay'))return null;
    if (State.supportPromptPending && State.supportPromptPending() && maybeSupportPrompt()) {
      /* 支持作者弹窗是独立的一次性提示：等玩家关掉它，再把升级三选一/加点接上。 */
      const tick = () => {
        if ($('.classic-modal-overlay')) { setTimeout(tick, 120); return; }
        promptLevelUpChoices();
      };
      setTimeout(tick, 150);
      return null;
    }
    if(typeof State.pendingWS==='function'&&State.pendingWS()>0)return wsChoiceDialog();
    const r = promptFreePoints();
    if (r) return r;
    /* 升级流程全部处理完了：这时才是「到 30 级 → 自愿支持作者」的最佳时机，
     * 不会插在三选一 / 属性点前面（见 maybeSupportPrompt，取提示权是一次性的）。 */
    maybeSupportPrompt();
    return null;
  }
  /* ============================================================
   * 【UC12】装备：列表/详情/出售/镶嵌/融合入口
   * ============================================================ */
  function gearImg(g) {
    /* 缺图标（黑装还有一部分 id 没有导出 PNG）时隐藏破图标记，卡片底色与名字仍可见。 */
    return '<img alt="" src="images/ui/icons/gear/gear-'+g.id+'.png" onerror="this.style.visibility=\'hidden\'">';
  }
  /** 装备详情里的「套装收益」小节：套装名 + 已穿件数 + 两档阈值，**逐档标出哪一条已经生效**。
   *  家族按**装备名去掉部位后缀**算（忍者护额/拳套/服/鞋 = 忍者一套），同名跨品质都算同一套；
   *  数值按所穿该家族装备里**最低**的品质算（整套成色按最差的一件算）。
   *  用户口径 2026-10：装备页上那条常驻的「套装收益」介绍已删掉，**只剩这里**（点开具体装备才说）。 */
  function setBonusBlock(g){
    const info=State.setBonusForGear(g.id,g.quality);
    if(!info)return '';
    const label=['普通','优秀','杰出','卓越','传说','黑色'][info.quality]||'普通';
    const rows=info.tiers.map(t=>'<span class="set-tier'+(t.on?' on':'')+'">'+(t.on?'✓':'○')+' '+t.need+' 件：'+esc(t.text.join('、'))+'</span>').join('');
    const head='套装：<b class="set-name">'+esc(info.family)+'</b>　已穿 '+info.count+'/4 件'+(info.count?'（整套按最低品质「'+label+'」计）':'');
    const hint=info.count<2?'<span class="small-label">再凑到 2 件同名'+esc(info.family)+'装备即可生效</span>':'';
    return '<br>'+head+hint+'<div class="set-bonus">'+rows+'</div>';
  }
  function openGears(pg) {
    const S = State.state();
    if (!S || Number(S.level) < 5) { notice('5级后才能使用装备。多多挑战，升级后再来吧！'); return; }
    /* 【SFR7】经典模式：「更换装备」= **原版那一页**（库元件「状态1」= 4673 的第 3 帧）。
     * 原版 `showEquipsWin()`（MainMovie.as:22088）是 `loadMcs([["状态1","subFrame",…]])` ——
     * **盖在状态页上面的一层**，不是复刻这套 DOM 弹窗。所以这里先确保状态页挂上，
     * 再把原版那一层开出来（退出只拆那一层，状态页原样还在）。
     * 下面那套 DOM 版留给现代模式，也作为经典模式渲染失败时的兜底。 */
    if (currentUiMode() === 'classic' && window.SfStatus && SfStatus.openGears) {
      screen = 'status'; activePortrait = null;
      const ui = $('#ui');
      if (ui) {
        ui.innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠状态"></section>';
        const box = $('#ui .ssfight-home');
        if (box) {
          SfStatus.open(box).then(() => SfStatus.openGears()).catch((e) => {
            if (window.__errs) window.__errs.push('SfStatus gears: ' + (e && e.message));
            openGearsDom(pg);
          });
          return;
        }
      }
    }
    openGearsDom(pg);
  }
  function openGearsDom(pg) {
    gearPage=typeof pg==='number'?pg:0;
    openStatus();
    /* 列表顺序：穿着中 > 获得顺序（规则在 state.js 的 gearsInDisplayOrder）。
     * 仍然是**每页 6 件 + 翻页**、格子固定尺寸（用户口径 2026-10：不要自适应格子大小）。 */
    const gears=State.gearsInDisplayOrder(),total=Math.max(1,Math.ceil(gears.length/6));gearPage=Math.min(gearPage,total-1);
    /* 空的部位格写部位名（原版那一页空格子里也是"头部/身体/手部/脚部"），
     * 装上之后就换成**装备名 + 品质色**（原版 `setEquipTextColor` 按 quality 改字色）。 */
    const slots=['头部','手部','身体','脚部'];
    const slotLabel=(g,fallback)=>g?'<span class="gear-slot-name q'+g.quality+'">'+esc(g.name)+'</span>':'<span class="gear-empty">'+fallback+'</span>';
    /* 落绘预览：原版这一页左侧是**玩家自己**（`mc_body`/`mc_head`/`mc_hand`/`mc_foot` 四个部位精灵
     * + 穿在身上的装备），见 `MainMovie_frame50.as:989 showWears()`。
     * ⚠ 复刻这边**不挂 canvas**：`portrait()` 画的那张落绘是由 `drawHomeHud` 在主界面循环里推的，
     * 进弹窗后主界面循环已经停了 —— 挂上去只会是一块**空白画布**（实测）。
     * 所以左侧只保留四个部位格（原版那一页的四格是"穿着中装备的缩略图 + 装备名"）。 */
    const content='<p class="gear-note">相同的附加属性效果不叠加，最高的1条生效！</p><div class="gear-layout"><div class="gear-slots">'+slots.map((name,i)=>{const g=gears.find(x=>x.used&&x.type===i);return '<button class="catalog-cell" '+(g?'data-gear="'+esc(g.key)+'"':'disabled')+'><span class="item-icon">'+(g?gearImg(g):'')+'</span>'+slotLabel(g,name)+'</button>';}).join('')+'</div><div class="gear-list">'+gears.slice(gearPage*6,gearPage*6+6).map(g=>'<button class="catalog-cell '+(g.used?'selected':'')+'" data-gear="'+esc(g.key)+'"><span class="item-icon">'+gearImg(g)+(g.used?'<span class="equipped-check">✓</span>':'')+'</span><span class="item-caption q'+g.quality+'">'+esc(g.name)+'</span></button>').join('')+(gears.length?'':'<div class="empty-state">还没有装备<br><span class="small-label">挑战关卡获得碎片<br>10个碎片可合成一件装备</span><br>'+btn('去闯关','stages','small gold')+'</div>')+'</div></div>'+(gearPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(gearPage<total-1?'<div class="page-arrow">'+btn('›','next','arrow')+'</div>':'');
    /* 用户口径 2026-10：**去掉装备页上的「套装收益」介绍行** ——
     * 那一段常驻文字既占地方又容易和实际穿着脱节；套装效果改成**点开具体装备**时才说明
     *（见 setBonusBlock，那里会逐档标出哪些已经生效）。 */
    const m=modal('我的装备',content+'<span class="gear-capacity">容量 '+gears.length+'/'+State.gearCapacity()+'　'+(gearPage+1)+'/'+total+'</span>',[{label:'返回',cls:'gold'}]);
    const p=m.element;p.classList.add('gear-overlay');$('.classic-modal',p).classList.add('gear-modal');
    const list=$('.gear-list',p),n=gears.slice(gearPage*6,gearPage*6+6).length;
    if(n)list.insertAdjacentHTML('beforeend',Array.from({length:6-n},()=>'<div class="catalog-cell empty-slot" aria-hidden="true"><span class="item-icon"></span></div>').join(''));
    /* 左侧落绘由主界面循环推，弹窗里推不动（见上面那段注释），所以这里不再挂 canvas。 */
    $$('.gear-slots button',p).forEach((b,i)=>{const g=gears.find(x=>x.used&&x.type===i);b.setAttribute('aria-label',slots[i]+(g?'：'+g.name:'：未装备'));});
    $$('[data-gear]',p).forEach(b=>b.onclick=()=>openGear(b.dataset.gear));
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openGears(gearPage-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openGears(gearPage+1));
  }
  let gearSellPage = 0;
  const GEAR_SELL_PER = 6;   // 3 行 × 2 列，正好铺满板面，不用滚动
  const QUALITY_LABEL = ['普通', '优秀', '杰出', '卓越', '传说', '黑色'];
  function openGearSell(pg) {
    gearSellPage = Math.max(0, typeof pg === 'number' ? pg : 0);
    const gears = State.myGears().slice().reverse(), S = State.state();
    const total = Math.max(1, Math.ceil(gears.length / GEAR_SELL_PER));
    gearSellPage = Math.min(gearSellPage, total - 1);
    const shown = gears.slice(gearSellPage * GEAR_SELL_PER, gearSellPage * GEAR_SELL_PER + GEAR_SELL_PER);
    const card = (g) => {
      const r = State.gearSellRange(g.quality);
      return '<button class="gear-sell-card q' + g.quality + '" data-sell="' + esc(g.key) +
        '" aria-label="出售' + esc(g.name) + '">' +
        '<span class="item-icon">' + gearImg(g) + (g.used ? '<span class="equipped-check">✓</span>' : '') + '</span>' +
        '<span class="gear-sell-info"><b class="q' + g.quality + '">' + esc(g.name) + '</b>' +
        '<span class="gear-sell-price">' + r[0] + '~' + r[1] + ' 金松果</span>' +
        '<span class="gear-sell-meta">' + QUALITY_LABEL[g.quality] + (g.used ? ' · 已装备' : '') + '</span></span></button>';
    };
    const head = '<div class="gear-sell-head">' +
      '<span>背包里共 <b>' + gears.length + '</b> 件装备（容量 ' + gears.length + '/' + State.gearCapacity() + '）</span>' +
      '<span>当前金松果 <b class="gold-text">' + S.goldPoint + '</b></span>' +
      '<span class="gear-sell-legend">回收价：白 55-60 · 绿 60-65 · 蓝 65-70 · 紫 90-110 · 橙 180-220</span></div>';
    const body = gears.length
      ? '<div class="gear-sell-grid">' + shown.map(card).join('') + '</div>'
      : '<div class="empty-state">还没有装备<br><span class="small-label">挑战关卡获得碎片，10 个碎片可以合成一件装备</span></div>';
    const content = head + body +
      (gearSellPage ? '<div class="page-arrow prev">' + btn('‹', 'prev', 'arrow') + '</div>' : '') +
      (gearSellPage < total - 1 ? '<div class="page-arrow">' + btn('›', 'next', 'arrow') + '</div>' : '');
    const p = page('status', 'gear-sell', content, { cls: 'gear-sell-board', counter: (gearSellPage + 1) + '/' + total });
    $('[data-action="home"]', p).textContent = '返回';
    $('[data-action="home"]', p).onclick = openStatus;
    $$('[data-sell]', p).forEach((b) => { b.onclick = () => askSellGear(b.dataset.sell); });
    $('[data-action="prev"]', p)?.addEventListener('click', () => openGearSell(gearSellPage - 1));
    $('[data-action="next"]', p)?.addEventListener('click', () => openGearSell(gearSellPage + 1));
  }
  /** 点一件装备 → 确认 → 按品质区间随机成交（和「更换装备」里的出售是同一套逻辑）。 */
  function askSellGear(key) {
    const g = State.myGears().find((x) => x.key === key);
    if (!g) { openGearSell(gearSellPage); return; }
    const r = State.gearSellRange(g.quality);
    modal('出售装备', '<p>确定以 <b>' + r[0] + '~' + r[1] + '</b> 金松果出售【' + esc(g.name) + '】吗？</p>' +
      (g.used ? '<p class="small-label">这件装备正穿戴在身上。</p>' : ''),
      [{ label: '出售', cls: 'gold', run: () => {
          const got = State.sellGear(key);
          toast('卖出【' + g.name + '】，获得 ' + got + ' 金松果');
          openGearSell(gearSellPage);
        } }, { label: '返回', cls: 'muted' }], { small: true });
  }
  function openGear(key) {
    const g=State.myGears().find(x=>x.key===key);if(!g)return;
    const socketable=State.canSocketGem(g);
    const gemInfo=g.gem?'<br>镶嵌宝石：'+esc(propMap.getValue(g.gem.id).name)+'（主属性 +'+State.gemPercent(g.gem.id-100)+'%，附加 +'+(g.gem.ext)+'%）':'';
    /* 宝石键的文案不带「（5金）」了（用户口径 2026-10：四个键要排在一行，标签越短越好排），
     * 费用改在这行小字里说明，免得玩家不知道要花金松果。 */
    const gemCost=socketable?'<br><span class="small-label">宝石：镶嵌 / 卸下各 5 金松果</span>':'';
    const content='<div class="gear-detail"><div class="catalog-cell"><h3 class="detail-name q'+g.quality+'">'+esc(g.name)+'</h3><span class="item-icon">'+gearImg(g)+'</span><span class="small-label">'+['普通','优秀','杰出','卓越','传说','黑色'][g.quality]+'</span></div><div>装备类别：'+['头部','手部','身体','脚部'][g.type]+'　使用等级：'+g.useLevel+'<br>基本属性：'+esc(g.attrName)+' +'+g.abilityVal+(g.attrBase&&g.attrBase!==g.abilityVal?'（基准 '+g.attrBase+'，本件有浮动）':'')+'<br>附加属性：<br>'+State.extText(g.ext).map(esc).join('<br>')+gemInfo+gemCost+setBonusBlock(g)+'</div></div>';
    /* 装 / 卸之后列表会重排（穿着 > 获得顺序），所以**跟着这一件翻到它新位置所在的那一页**，
     * 否则在后面的页上点「装备」，东西会当场跳到第一页、看不见了。 */
    const buttons=[{label:g.used?'卸下':'装备',run:()=>{const ok=g.used?State.unwear(key):State.wear(key);if(ok===false)toast('等级不足，暂时无法装备');
      const idx=State.gearsInDisplayOrder().findIndex(x=>x.key===key);
      openGears(idx<0?gearPage:Math.floor(idx/6));}}];
    /* 宝石：装上 / 卸下都要 5 金松果（2026-10 用户口径）。只要身上有宝石就一定给「卸下」，
     * 不再依赖 orange 标记（橙色与黑色装备都可镶嵌，这里只是把它做得更稳、更好找）。
     * 按钮文案**不带「（5金）」**（用户口径 2026-10：四个键要排在一行里，标签越短越好排）；
     * 费用写在详情正文的那行小字与镶嵌弹窗里，花多少钱照样一眼能看到。 */
    if(g.gem)buttons.push({label:'卸下宝石',run:()=>{const r=State.unsocketGem(key);toast(r.msg);openGear(key);}});
    else if(socketable)buttons.push({label:'镶嵌宝石',cls:'gold',run:()=>socketGemDialog(key)});
    buttons.push({label:'出售',cls:'muted',run:()=>notice('确定以 '+(State.gearSellRange(State.gearQuality(g))[0])+'~'+(State.gearSellRange(State.gearQuality(g))[1])+' 金松果出售【'+g.name+'】吗？',[{label:'出售',run:()=>{const got=State.sellGear(key);toast('卖出【'+g.name+'】，获得 '+got+' 金松果');openGears(gearPage);}},{label:'返回',cls:'muted'}])});
    buttons.push({label:'返回',cls:'muted'});
    const md=modal('我的装备', content, buttons);
    /* 橙装带宝石时这一行最多 4 个按钮（卸下 / 出售 / 返回…），
     * 200px 最小宽 + 28px 间距会超出弹窗宽度 → 让它换行，别把「返回」挤出可视区。 */
    md.element.classList.add('gear-detail-overlay');
  }
  // 镶嵌宝石：列出背包里各级宝石供选择（装上 5 金松果，与卸下同价）
  function socketGemDialog(key) {
    const S=State.state();
    const gems=[101,102,103,104,105,106,107].filter(id=>(S.props[id]||0)>0);
    if(!gems.length){notice('背包里没有宝石。45级后通关关卡或在竞技场获胜有几率获得。',[{label:'返回'}]);return;}
    modal('选择宝石','<div class="gem-pick">'+gems.map(id=>'<button type="button" class="help-item" data-gem="'+id+'"><span class="item-icon">'+icon('prop',id)+'</span><span>'+esc(propMap.getValue(id).name)+' ×'+S.props[id]+'</span></button>').join('')+'</div><p class="small-label">镶嵌 5 金松果（卸下同样 5 金）；附加属性提升幅度随机，可先卸下再镶嵌来重随。</p>',[{label:'返回',cls:'muted'}],{small:true});
    const overlays=$$('.classic-modal-overlay'),m=overlays[overlays.length-1];
    $$('[data-gem]',m).forEach(b=>b.onclick=()=>{const r=State.socketGem(key,+b.dataset.gem);toast(r.msg);if(r.ok){m.remove();openGear(key);}});
  }
  function openMerge() {
    if (window.ClassicFusion) window.ClassicFusion.open();
    else legacy.runAction('gears');
  }
  const REVENGE_EXCLUDED_KINDS = ['tower', 'endless', 'stage'];
  /** 这条记录能不能复仇（败绩 + 不在排除名单里，复仇再失败也不算新的败绩）。 */
  /* ============================================================
   * 【UC13】消息 / 复仇 / 好友 / 聊天
   * ============================================================ */
  function canRevenge(r) {
    return !!r && r.winner !== 0 && r.kind !== 'revenge' && REVENGE_EXCLUDED_KINDS.indexOf(r.kind) < 0;
  }
  function openMessages(tab,pg) {
    tab=typeof tab==='string'?tab:'messages';pg=pg||0;
    /* 【SFR6】经典模式：消息页**整页由原版导出数据渲染**（js/ssfight/ui-message.js，
     * 页根元件 = message 帧的 7819）。原版这一页自带顶栏 4 个 tab（消息 / 天梯赛 /
     * 复仇 / 留言）、一页 2 条记录（胜败印章 + 时间 + 正文 + 查看录像 / 再次挑战）、
     * 左右翻页与底栏「返回菜单」—— 下面那套 DOM 版留给现代模式（也作为经典模式
     * 渲染失败时的兜底）。`tab` 透传：'messages' / 'ranklog' / 'revenge' → 原版 1/2/3。
     * ⚠ `pg` 是 **0 基**（DOM 版口径），原版页码是 1 基 —— 这里 +1 再交给页面。 */
    if (currentUiMode() === 'classic' && window.SfMessage && SfMessage.open) {
      screen = 'message'; activePortrait = null;
      $('#ui').innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠消息"></section>';
      const box = $('#ui .ssfight-home');
      if (box) {
        SfMessage.open(box, tab, pg + 1).then(() => {
          if (screen === 'message' && window.SfGuide) { try { SfGuide.onPage('message'); } catch (e) {} }
        }).catch((e) => {
          if (window.__errs) window.__errs.push('SfMessage: ' + (e && e.message));
          openMessagesDom(tab,pg);
        });
        return;
      }
    }
    openMessagesDom(tab,pg);
  }
  function openMessagesDom(tab,pg) {
    tab=typeof tab==='string'?tab:'messages';pg=pg||0;
    /* 看过消息页就把经典主界面「消息」上的红点熄掉（SfUiMain 里按战斗记录算出来的）。 */
    if(window.SfUiMain&&SfUiMain.markMessagesSeen)SfUiMain.markMessagesSeen();
    let list=State.battleHistory?State.battleHistory():[];
    if(tab==='ranklog')list=list.filter(r=>r.kind==='rank');
    if(tab==='revenge')list=list.filter(canRevenge);
    const total=Math.max(1,Math.ceil(list.length/2));pg=Math.min(pg,total-1);
    const html=list.slice(pg*2,pg*2+2).map(r=>{
      const d=new Date(r.createdAt),time=(d.getMonth()+1)+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
      // 赢了给少量经验与金松果（补一点上次失败少拿的），每条记录只能成功复仇一次。
      const rev=tab==='revenge'&&canRevenge(r);
      const revengeBtn=!rev?'':(r.revenged
        ?'<button class="uc-button tiny muted" data-revenged="1" disabled>已复仇</button>'
        :'<button class="uc-button tiny gold" data-revenge="'+esc(r.id)+'">再次挑战</button>');
      const KIND_LABEL={challenge:'挑战',stage:'关卡',tower:'挑战塔',endless:'无尽塔',arena:'竞技场',rank:'天梯赛',friend:'切磋',master:'师徒',revenge:'复仇'};
      const kindTag=(KIND_LABEL[r.kind]||'挑战')+' · ';
      return '<article class="message-card"><span class="message-stamp '+(r.winner?'loss':'')+'">'+(r.winner?'败':'胜')+'</span>'+kindTag+'你挑战了【'+esc(r.foe.name)+'】，'+(r.winner?'遗憾落败。':'获得胜利！')+'<time>'+time+'</time>'+
        '<span class="message-actions">'+revengeBtn+'<button class="uc-button tiny muted" data-replay="'+esc(r.id)+'">查看录像</button></span></article>';
    }).join('');
    const p=page('message',tab,'<div class="message-list">'+(html||'<div class="empty-state">暂时没有'+(tab==='revenge'?'落败记录':'战斗消息')+'<br><span class="small-label">'+(tab==='revenge'?'普通挑战的败绩会留在这里，之后可以点「再次挑战」找回场子（塔与关卡不计入）。':'开始一场挑战，精彩战斗会保存在这里。')+'</span></div>')+'</div>'+(pg?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(pg<total-1?'<div class="page-arrow">'+btn('›','next','arrow')+'</div>':''),{counter:(pg+1)+'/'+total,counterPlace:'board'});
    $$('[data-replay]',p).forEach(b=>b.onclick=()=>{const r=list.find(x=>x.id===b.dataset.replay);Main.replayBattle(r,()=>openMessagesDom(tab,pg));});
    $$('[data-revenge]',p).forEach(b=>b.onclick=()=>{const r=list.find(x=>x.id===b.dataset.revenge);if(r)revengeFight(r,()=>openMessagesDom(tab,pg));});
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openMessagesDom(tab,pg-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openMessagesDom(tab,pg+1));
  }
  /** 复仇：拿录像里记下的对手快照再打一场（不消耗体力、不掉飘物，避免变成刷资源入口）。
   *  胜利 → State.revengeReward 发少量经验与金松果，并把这条记录标成「已复仇」。 */
  function revengeFight(record, back) {
    const foe=Object.assign({},record.foe);
    /* 只有天梯赛败绩的复仇才抢金杯（0~1 个）；普通挑战复仇只补经验与金松果。 */
    const ladder=record.kind==='rank';
    const cups=ladder&&Math.random()<0.5?1:0;
    Main.startBattle(foe,{region:record.region||0,kind:'revenge',useProps:false,collectDrops:false,skipResultPanel:true,onEnd:(winner)=>{
      back();
      const win=winner===0;
      if(!win){modal('复仇失败','<div class="result-box"><div class="result-title lose">又输了</div><p>再来一次吧 —— 复仇不消耗体力，失败也没有额外损失。</p></div>',[{label:'返回',run:back}]);return;}
      if(!State.markRevenged(record.id)){
        modal('复仇成功','<div class="result-box"><div class="result-title win">胜 利！</div><p>这条败绩之前已经复仇过了，本次不再重复发补偿。</p></div>',[{label:'返回',run:back}]);
        return;
      }
      const rw=State.revengeReward(foe.level);
      const S=State.state();
      if(cups>0) S.goldCup=Math.max(0,Number(S.goldCup)||0)+cups;
      State.save();
      const cupText=ladder?(cups>0?'，抢夺 '+cups+' 个金杯':'，本次没有抢到金杯'):'';
      resultModal(true,rw,'复仇成功：'+esc(foe.name)+' 已被击败'+cupText+'，补回少量经验与金松果。',back);
    }});
  }
  function openFriends(refresh) {
    const S=State.state();
    if(refresh===true||!friendCandidates.length)friendCandidates=State.rollFriendCandidates(3);
    const list=State.friendList();
    const rowOf=(f,i,recommend)=>'<div class="friend-row'+(recommend?' recommend':'')+'">'+
      '<span class="friend-level">Lv '+f.level+'</span><b class="friend-name">'+esc(f.name)+'</b>'+
      '<span class="friend-stats"><i>力 '+f.power+'</i><i>敏 '+f.agility+'</i><i>速 '+f.speed+'</i><i>血 '+f.hp+'</i></span>'+
      (recommend?'<span class="friend-since">推荐</span>':'<span class="friend-since" title="加为好友的日期">'+esc(f.since)+'</span>')+
      '<span class="friend-actions">'+(recommend
        ?(State.friendOf(f.name)
          ?'<button class="uc-button small muted" disabled>已是好友</button>'
          :'<button class="uc-button small gold" data-friend-action="add" data-friend-i="'+i+'">加好友</button>')
        :'<button class="uc-button small" data-friend-action="spar" data-friend-i="'+i+'">切磋</button>'+
         '<button class="uc-button small muted" data-friend-action="drop" data-friend-i="'+i+'">删除</button>')+'</span></div>';
    const mine=list.map((f,i)=>rowOf(f,i,false)).join('')||'<div class="empty-state">还没有好友<br><span class="small-label">从下面的推荐里加一位，或者在「随机」页选中对手后点「加好友」。</span></div>';
    const recs=friendCandidates.map((c,i)=>rowOf(c,i,true)).join('');
    const content='<div class="friend-scroll">'+
      '<div class="friend-panel"><div class="friend-head"><h3>我的好友</h3>'+
      '<span class="small-label">'+list.length+' / '+State.friendLimit()+'　切磋不消耗体力、不结算奖励</span></div>'+
      '<div class="friend-list">'+mine+'</div></div>'+
      '<div class="friend-panel"><div class="friend-head"><h3>推荐好友</h3>'+
      '<span class="small-label">等级和你接近的随机松鼠，加为好友后可以随时切磋</span>'+
      '<button class="uc-button tiny muted" data-friend-action="refresh">换一批</button></div>'+
      '<div class="friend-list">'+recs+'</div></div>'+
      (S.master?'<p class="friend-note">师父：'+esc(S.master.name)+'　'+S.master.level+' 级</p>':'<p class="friend-note">还没有师父，可以去「师徒」拜一位。</p>')+'</div>';
    const p=page('challenge','friends',content,{cls:'friends-board',left:'<span class="footer-left">'+btn('师徒','master','gold')+'</span>'});
    $$('[data-friend-action]',p).forEach(b=>b.onclick=()=>{
      const act=b.dataset.friendAction,i=Number(b.dataset.friendI);
      if(act==='refresh'){friendCandidates=State.rollFriendCandidates(3);toast('已换一批推荐好友');openFriends();return;}
      if(act==='add'){const r=State.addFriend(friendCandidates[i]);toast(r.msg);if(r.ok)openFriends();return;}
      if(act==='drop'){const r=State.removeFriend(list[i].name);toast(r.msg);openFriends();return;}
      if(act==='spar')spar(list[i]);
    });
  }
  /** 好友切磋：不消耗体力、不结算经验与金松果，纯粹打一场。 */
  function spar(friend){
    const foe=State.friendFoe(friend);
    if(!foe)return;
    Main.startBattle(foe,{cost:0,kind:'friend',useProps:false,collectDrops:false,skipChest:true,region:0,skipResultPanel:true,
      onError:()=>{openFriends();toast('切磋中断，稍后再来。');},
      onEnd:(winner)=>{
        openFriends();
        modal('切磋结果','<div class="result-box"><div class="result-title '+(winner===0?'win':'lose')+'">'+(winner===0?'切磋胜利！':'再接再厉')+'</div>'+
          '<div class="result-lines">和【'+esc(friend.name)+'】的切磋结束。</div>'+
          '<p class="small-label">切磋不消耗体力、不结算经验与金松果；想赚奖励请去「随机」或「关卡」。</p></div>',
          [{label:'确定',run:home},{label:'再来一场',cls:'gold',run:()=>spar(friend)}]);
      }});
  }
  /** 旧的留言板入口保留成别名，统一走合并后的聊天页。 */
  function openBoard() { openChat(); }
  function openChat() {
    page('message','chat','<div class="empty-state">好友聊天 · 留言板<br><span class="small-label">这里会显示你和好友的聊天消息，留言板也已并入这一页。<br>本地怀旧版暂不连接公共聊天与留言服务，敬请期待。<br>好友间的切磋与战绩可在「好友」里查看，战斗录像在「消息」中。</span></div>');
  }
  /* ============================================================
   * 【UC14】每日（礼包/任务）与存档面板
   * ============================================================ */
  function openDaily() {
    const d = State.dailyStatus();
    const quests = State.questStatus();
    /* 领取区（2026-10 用户口径）：每日礼包与**徒弟日供**并排两张卡 —— 日供以前只能在
     * 村庄 → 师徒页里领，现在活动页也能领（两边共用 ClassicExtras.claimTribute 一条路径）。
     * 两张卡都用「卡头（标题 + 领取按钮）+ 一行说明」的结构，高度可控，整个弹窗
     * （两张卡 + 4 条每日任务 + 底部按钮）一次放得下，不需要滚动/翻页。 */
    const tribute = (window.ClassicExtras && ClassicExtras.tributeStatus)
      ? ClassicExtras.tributeStatus()
      : { rows: [], exp: 0, gold: 0, count: 0, claimable: false, claimed: false };
    const tributeLabel = !tribute.count ? '去收徒' : tribute.claimable ? '领取' : tribute.claimed ? '今日已领取' : '明日结算';
    const tributeText = !tribute.count ? '去村庄 →「师徒」收个徒弟（次日开始结算）'
      : '经验 +' + tribute.exp + ' · 金松果 +' + tribute.gold + ' · ' + tribute.count + ' 个徒弟';
    const claimRow = '<div class="daily-claim-row">' +
      '<div class="daily-card"><div class="daily-card-head"><h3>每日礼包</h3>' +
        btn(d.claimed ? '今日已领取' : '领取', 'claim-gift', 'small ' + (d.claimed ? 'muted' : 'gold')) + '</div>' +
        '<p class="daily-gift-preview">连续登录 ' + (d.streak || 1) + ' 天' +
          '<span class="daily-reward">' + goldIcon() + '<b>×' + d.gold + '</b></span>' +
          (d.extra ? '<span class="daily-reward">' + giftIcon(d.extra.id) + '<b>' + esc(d.extra.name) + ' ×' + d.extra.count + '</b></span>' : '') +
        '</p></div>' +
      '<div class="daily-card tribute"><div class="daily-card-head"><h3>徒弟日供</h3>' +
        btn(tributeLabel, 'claim-tribute', 'small ' + (tribute.claimable ? 'gold' : 'muted')) + '</div>' +
        '<p>' + esc(tributeText) + '</p></div></div>';
    const rewardIcon = (r) => r.kind === 'gold' ? goldIcon()
      : r.kind === 'exp' ? '<img alt="" src="images/ui/icons/drop-exp-classic.png">'
        : icon('prop', r.id);
    const rows = quests.map((q) => {
      const pct = Math.round(100 * q.progress / q.need);
      const chips = q.rewards.map((r) => '<span class="quest-chip ' + r.kind + '" title="' + esc(r.name + ' ×' + r.count) + '">' +
        '<span class="chip-icon">' + rewardIcon(r) + '</span><span class="chip-name">' + esc(r.name) + '</span><b>×' + r.count + '</b></span>').join('');
      return '<div class="quest-row' + (q.claimed ? ' claimed' : q.done ? ' done' : '') + '">' +
        '<span class="quest-name">' + esc(q.name) + '</span>' +
        '<span class="quest-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="quest-progress">' + q.progress + '/' + q.need + '</span>' +
        '<span class="quest-reward">' + chips + '</span>' +
        (q.claimed ? '<span class="quest-state">已领取</span>'
          : q.done ? btn('领取', 'quest' + q.index, 'small gold')
            : '<span class="quest-state muted">进行中</span>') +
        '</div>';
    }).join('');
    const list = '<div class="daily-quests"><h3>每日任务<span class="quest-date">' + esc(State.localDate()) + ' · ' +
      (window.Debug && Debug.enabled('shortDay') ? '调试：12 小时一天，0 点与 12 点刷新' : '每天 0 点刷新') + '</span></h3>' + rows + '</div>';
    // 活动页直接给一个「每日抽奖」入口（关掉活动弹窗再进抽奖页）
    const m = modal('活动', claimRow + list, [
      { label: '每日抽奖', cls: 'gold', run: () => { if (window.ClassicExtras && ClassicExtras.lottery) ClassicExtras.lottery(); } },
      { label: '返回', cls: 'muted' },
    ]);
    const rerender = () => { m.close(); openDaily(); refreshHome(); refreshHeader(); };
    $('[data-action="claim-gift"]', m.element)?.addEventListener('click', () => { toast(State.claimDaily().msg); rerender(); });
    /* 日供按钮：没徒弟时它是「去收徒」（直接进师徒页），否则走与师徒页同一条领取路径，
     * 结算弹窗由 ClassicExtras 渲染（reward-card 面板 + 每个徒弟的份额明细）。 */
    $('[data-action="claim-tribute"]', m.element)?.addEventListener('click', () => {
      if (!tribute.count) { m.close(); runAction('master'); return; }
      if (window.ClassicExtras && ClassicExtras.claimTribute) ClassicExtras.claimTribute(rerender);
    });
    quests.forEach((q) => {
      const b = $('[data-action="quest' + q.index + '"]', m.element);
      if (b) b.addEventListener('click', () => { toast(State.claimQuest(q.index).msg); rerender(); });
    });
  }
  /** 系统页里的「存档位置」一块：显示进度到底存在哪儿，并提供手动写入/载入。 */
  function saveFilePanel() {
    const info = State.fileInfo ? State.fileInfo() : { mode: 'local', available: false, checked: false };
    const webMode = !!window.__SSDZ_WEB_MODE__;
    if (!webMode && !info.checked) { void State.fileProbe().then(() => { if (screen === 'system') openSystem(); }); }
    let state;
    if (webMode) {
      /* 网页版/PWA：localStorage 就是正式存档，不是“没连上服务器”的兜底。
       * Safari 标签页和主屏幕 Web App 的存储还是两个容器，所以文案要提醒导出备份。 */
      state = '<b class="sync-on">浏览器 localStorage（网页版）</b><span class="small-label">' +
        '进度保存在当前浏览器/主屏幕应用里；换浏览器、清缓存或换网址会丢。' +
        '建议定期用上面的「存档导出」备份到「文件」/iCloud。</span>';
    } else if (info.mode !== 'file') {
      state = '<b class="sync-off">浏览器里（兜底）</b><span class="small-label">' +
        esc(info.reason || '没有本地服务器，进度暂存在这个浏览器的 localStorage。') +
        '<br>用启动器或 <code>node serve.js</code> 打开游戏，进度就会写进 <code>save/progress.json</code>。</span>';
    } else if (info.conflict) {
      state = '<b class="sync-warn">文件里的进度更新（' + State.syncFormatTime(info.fileAt) + '）</b><span class="small-label">点「载入存档」把它取过来（不会静默覆盖）</span>';
    } else {
      state = '<b class="sync-on">' + esc(info.path || 'save/progress.json') + '</b><span class="small-label">最后写入 ' + State.syncFormatTime(info.lastWrite) +
        '　最后载入 ' + State.syncFormatTime(info.lastLoad) + (info.dirty ? '　（有改动正在写入…）' : '') + '</span>';
    }
    const useFile = info.mode === 'file';
    const actions = webMode ? '' :
      '<div class="sync-actions">' + btn('写入存档', 'save-write', 'small' + (useFile ? '' : ' muted')) +
      btn('载入存档', 'save-load', 'small' + (useFile ? '' : ' muted')) +
      btn('存档列表', 'save-import-list', 'small') + '</div>';
    /* 用户 2026-10 口径：这一栏不要缩写成「写入 / 载入 / 列表」，
     * 固定用完整标签「写入存档 / 载入存档 / 存档列表」。`.sync-actions` 是 flex-wrap，
     * 窄屏会自然换行。 */
    return '<div class="sync-panel"><h3 class="classic-section-title">存档位置</h3><div class="sync-head">' + state + '</div>' +
      actions + '</div>';
  }
  /** 选一个本地 .json 文件；返回 Promise<File|null>（null = 用户取消）。
   *  macOS 的 WKWebView / Safari（原生轻壳、安装包模式）只认**已经挂在文档里**的
   *  input[type=file]：游离节点上的 .click() 会静默无反应，看起来就是
   *  「载入存档文件点不动、选不了文件」。所以这里把 input 放进 body 再点，
   *  并且复用同一个节点（避免反复插入）。 */
  /* ============================================================
   * 【UC15】存档导入（JSON 文件）
   * ============================================================ */
  function pickJsonFile() {
    return new Promise((resolve) => {
      let input = $('#ssdz-file-picker');
      if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'ssdz-file-picker';
        /* 安卓各家文件管理器 / 微信、QQ 的“用其他应用打开”经常把 `.json` 标成
         * `application/octet-stream` 或 `text/plain`；只写 `.json,application/json`
         * 时这些来源的文件在选择器里会**直接不显示**，玩家看到的就是“导出成功但导入选不到文件”。
         * 这里放宽 MIME 白名单，真正的合法性仍由 saveDataError / JSON.parse 兜底。
         * （2026-10 安卓导入反馈；原始导出文件名不变。） */
        input.accept = '.json,application/json,text/plain,application/octet-stream';
        input.setAttribute('aria-hidden', 'true');
        input.tabIndex = -1;
        input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
        document.body.appendChild(input);
      }
      let done = false;
      const finish = (file) => {
        if (done) return; done = true;
        input.removeEventListener('change', onChange);
        input.removeEventListener('cancel', onCancel);
        input.value = '';
        resolve(file || null);
      };
      const onChange = () => finish(input.files && input.files[0]);
      const onCancel = () => finish(null);
      input.addEventListener('change', onChange);
      input.addEventListener('cancel', onCancel);
      input.value = '';
      try { input.click(); } catch (e) { finish(null); }
    });
  }
  /** 读文本：优先 File.text()，老 WebKit 没有就退回 FileReader。 */
  function readFileText(file) {
    if (file && typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result == null ? '' : fr.result));
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsText(file);
    });
  }
  /** 系统页「载入存档文件」：可选服务器存档文件，也可从磁盘挑一个 json。 */
  function loadSaveDialog() {
    const info = State.fileInfo ? State.fileInfo() : {};
    const useFile = info.mode === 'file';
    const buttons = [];
    if (useFile) {
      buttons.push({ label: '覆盖', run: async () => {
        const r = await State.fileLoad();
        toast(r ? '已载入存档文件' : '载入失败');
        if (r) { refreshHome(); openSystem(); }
      } });
    }
    buttons.push({ label: '选文件', cls: useFile ? 'muted' : '', run: () => importSave() });
    buttons.push({ label: '取消', cls: 'muted' });
    const msg = useFile
      ? '用文件里的存档覆盖本机进度？本机当前等级 ' + State.state().level + ' 级，文件里的存档时间 ' +
        (State.syncFormatTime ? State.syncFormatTime(info.fileAt) : '—') + '。'
      : '当前没有连上本地服务器（' + (info.reason || '存档文件不可用') + '），只能从磁盘上挑一个导出的 .json 存档导入。';
    notice(msg, buttons);
  }

  /* ============================================================
   * 导入存档（v2）
   *
   * 旧版只有一个 localStorage 分支：在「文件存档模式」下点「导入存档」，
   * 它把 JSON 塞进 localStorage，然后**报成功**——但真正的存档是
   * save/progress.json，界面等级一点没变，刷新回去还是旧档。
   * 现在两种情况分开走，而且成功后界面与文件必然一致：
   *   · 文件模式：先让服务器把当前档备份到 save/backup/，再 ?force=1 写回，
   *     然后 fileLoad() 重载、刷新整个界面；
   *   · 兜底模式：仍是 localStorage（这里没有文件可写）。
   * ============================================================ */
  /** 校验一份「存档」JSON 是不是能用（导入的所有入口共用，避免脏数据写进正式存档）。 */
  function saveDataError(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '这不是一个存档对象';
    if (typeof data.name !== 'string' || !data.name.trim()) return '存档里没有角色名';
    if (!Number.isFinite(Number(data.level))) return '存档里没有等级';
    if (!Array.isArray(data.weapons) || !Array.isArray(data.skills)) return '存档缺少武器/技能字段';
    if (!data.props || typeof data.props !== 'object' || Array.isArray(data.props)) return '存档缺少道具字段';
    return '';
  }
  /** 导入完成后统一刷新界面：整页重建主界面（等级/名字/背包全换掉），再按需回到系统页。 */
  function afterSaveImport(name, level, backup) {
    const wasSystem = screen === 'system';
    home();                       // Main.showHome() → UI.renderHome()，按新档整页重画
    refreshHeader();
    if (wasSystem) openSystem();
    toast('已导入【' + name + '】' + level + ' 级' + (backup ? '，旧档备份在 ' + backup : ''));
  }
  /** 当前页面是不是跑在 Tauri 安装壳里（桌面安装版 / 安卓 / iOS）。
   *  这些环境没有 `/__save` HTTP 接口，存档只能走原生命令；页面若因为桥接晚到
   *  退回了 localStorage，导入绝不能跟着写 localStorage —— 那会「提示成功」，
   *  下次启动却仍读磁盘上的旧档。 */
  function inTauriShell() {
    try {
      const host = String((location && location.hostname) || '').toLowerCase();
      const proto = String((location && location.protocol) || '');
      return host === 'tauri.localhost' || proto === 'tauri:' || !!window.__SSDZ_TAURI_APP__;
    } catch (e) { return false; }
  }
  /** 导入失败时把内存与落盘都恢复成导入前的样子。返回是否恢复成功。 */
  async function restoreImportedSave(raw, info) {
    if (!raw) return false;
    /* 先把内存恢复掉：即使后面的落盘回滚失败，界面也不会停在「导入了半份」的新档上。 */
    try { if (State.restorePayload) State.restorePayload(raw); } catch (e) {}
    try {
      if (State.hasFileTransport && State.hasFileTransport()) {
        const w = await State.importFileRaw(raw);
        if (!w.ok) return false;
        return await State.fileLoad();
      }
      if (info && info.mode === 'file') {
        const w = await fetch('/__save?force=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
        const wj = await w.json().catch(() => ({}));
        if (!w.ok || wj.ok === false) return false;
        return await State.fileLoad();
      }
      localStorage.setItem(State.saveKey, raw);
      return State.load();
    } catch (e) {
      try { State.restorePayload && State.restorePayload(raw); } catch (e2) {}
      return false;
    }
  }
  /** 把一份存档 JSON 写进正式存档：文件模式先备份再强制写回，兜底模式写 localStorage。
   *
   *  ⚠ 成功提示必须建立在「写进去 → 重新读回来 → 当前槽位确实换了」三步都成功之上。
   *  旧实现先 `fetch('/__save?force=1')`：iOS/安卓安装包里页面在 `tauri.localhost`，
   *  这个地址没有 `/__save` 接口，fetch 往往拿回 `index.html`（HTTP 200），`w.json()` 失败后
   *  `wj` 变成空对象，`w.ok` 仍是 true —— 于是提示「已导入」，实际文件一点没动。
   *  现在：原生存档通道优先；写后必须用 `State.verifyImport` 核对真正载入的槽位；
   *  任何一步失败都回滚旧档并抛错，绝不显示成功。 */
  async function applyImportedSave(raw, data) {
    const beforeRaw = State.exportPayload ? State.exportPayload() : '';
    const prepared = State.prepareImport ? State.prepareImport(raw) : null;
    if (!prepared || !prepared.ok) throw new Error((prepared && prepared.msg) || '存档格式不对');
    let info = State.fileInfo ? State.fileInfo() : {};
    const fail = async (message) => {
      await restoreImportedSave(beforeRaw, info);
      throw new Error(message);
    };
    if (!window.__SSDZ_WEB_MODE__ && info.mode !== 'file' && State.fileProbe) {
      try {
        if (await State.fileProbe()) info = State.fileInfo ? State.fileInfo() : info;
      } catch (e) { /* 探针失败就照旧走兜底模式 */ }
    }
    /* 原生壳里桥接可能晚一拍才装好：再等最多 1 秒，避免把导入写进浏览器兜底档。 */
    if (inTauriShell() && !(State.hasFileTransport && State.hasFileTransport())) {
      for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        try { await State.fileProbe(); } catch (e) {}
        if (State.hasFileTransport && State.hasFileTransport()) break;
      }
      info = State.fileInfo ? State.fileInfo() : info;
    }
    if (State.storageMode && State.storageMode() === 'file') info = Object.assign({}, info, { mode: 'file' });
    const native = !!(State.hasFileTransport && State.hasFileTransport());
    if (info.mode === 'file' || native) {
      /* Tauri 安装版 / 安卓 / iOS：必须走原生 save_read/save_write 通道；
       * 没有通道时宁可报错也不能静默写 localStorage。 */
      if (native) {
        let backup = '';
        let oldRaw = '';
        try { oldRaw = (await State.readFileRaw()) || ''; } catch (e) {}
        try {
          if (oldRaw) {
            const name = '松鼠大战存档-导入前备份-' + Date.now() + '.json';
            const b = bridgeSave(name, oldRaw);
            if (b.status === 'ok') backup = b.path;
            else {
              const nb = await nativeSave(name, oldRaw);
              if (nb.status === 'ok') backup = nb.display || nb.path;
            }
          }
        } catch (e) { /* 备份失败不拦导入 */ }
        const w = await State.importFileRaw(prepared.payload);
        if (!w.ok) await fail(w.msg || '写回存档文件失败');
        const ok = await State.fileLoad();
        if (!ok) await fail('存档文件写进去了，但重新读取失败 —— 刷新一下页面就能看到导入的档');
        if (State.verifyImport && !State.verifyImport(prepared)) {
          await fail('写入后核对失败：读回来的不是刚导入的存档，已恢复旧档');
        }
        const now = State.state() || {};
        afterSaveImport(now.name || prepared.name, now.level || prepared.level, backup);
        return true;
      }
      if (inTauriShell()) {
        await fail('原生存档通道还没就绪，请重开游戏后再导入（已保留原进度）');
      }
      // 轻壳 / 本地服务器：先留快照，再带 force=1 写规范化后的正文
      let backup = '';
      try {
        const b = await fetch('/__save/backup', { method: 'POST', cache: 'no-store' });
        const bj = await b.json();
        if (bj && bj.ok && bj.backup) backup = bj.backup;
      } catch (e) { /* 备份失败也允许继续，下面会提示 */ }
      const w = await fetch('/__save?force=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: prepared.payload });
      const wj = await w.json().catch(() => ({}));
      if (!w.ok || wj.ok === false) await fail(wj.msg || ('写回存档文件失败（HTTP ' + w.status + '）'));
      const ok = await State.fileLoad();
      if (!ok) await fail('存档文件写进去了，但重新读取失败 —— 刷新一下页面就能看到导入的档');
      if (State.verifyImport && !State.verifyImport(prepared)) {
        await fail('写入后核对失败：读回来的不是刚导入的存档，已恢复旧档');
      }
      const now = State.state() || {};
      afterSaveImport(now.name || prepared.name, now.level || prepared.level, backup);
      return true;
    }
    if (inTauriShell()) {
      await fail('原生存档通道不可用，已保留原进度；请重开游戏后再导入');
    }
    const old = localStorage.getItem(State.saveKey);
    try {
      if (old) localStorage.setItem(State.saveKey + '_backup', old);
      localStorage.setItem(State.saveKey, prepared.payload);
      if (!State.load()) throw new Error('读取存档失败');
      if (State.verifyImport && !State.verifyImport(prepared)) throw new Error('写入后核对失败：读回来的不是刚导入的存档');
      State.save();
      const now = State.state() || {};
      afterSaveImport(now.name || prepared.name, now.level || prepared.level, '');
      return true;
    } catch (e) {
      if (old) localStorage.setItem(State.saveKey, old);
      State.load();
      throw e;
    }
  }

  /* ============================================================
   * 跨设备同步（Mac ↔ Windows，走 ZeroTier）
   *
   * 页面上只能读 save/progress.json，读不到整个游戏目录；真正干活的
   * 是本机的同步服务 scripts/sync/sync.js（默认监听 127.0.0.1:18788；旧默认是 8788，
   * 但它在 Windows 上落进了系统保留段，非管理员绑不上；sync.js 现在还会**自愈**到
   * 18788 之后第一个能绑的端口）。
   * 所以这里只是它的一个遥控器：/local/status 看状态，/local/save/{push,pull}
   * 与 /local/files/{push,pull} 让它去和对端说话。服务没开就只提示，不报错。
   *
   * ⚠ 端口不能写死（2026-10 修）：`SYNC_PORTS` 以前只被拿来取 `[0]`，等于只认 18788，
   *   配置里是别的端口时面板永远说"服务没启动"。现在按顺序探测：
   *   ① 先读 `scripts/sync/sync.config.json`（同源静态文件，最准；桌面壳里没有 → 跳过）
   *   ② 再按候选表逐个试（127.0.0.1 上没人听的端口是立刻 ECONNREFUSED，不是等超时）
   *   ③ 最后以服务自己 `/local/status` 报回来的 `port` 为准。
   * ============================================================ */
  const SYNC_PORTS = [18788, 8788];              // 新默认 + 旧默认
  for (let i = 1; i <= 9; i++) SYNC_PORTS.push(18788 + i);   // 自愈可能往后挪几位
  let syncApiBase = 'http://127.0.0.1:' + SYNC_PORTS[0];
  let syncPortNow = SYNC_PORTS[0];               // 当前正在用的端口（面板上会显示）
  /** 从同源的 `scripts/sync/sync.config.json` 读端口（最准；读不到返回 0）。
   *  ⚠ 桌面壳（src-tauri/web）里没有这个文件，那时返回 0，走候选表探测。 */
  async function syncConfigPort() {
    try {
      const r = await fetch('scripts/sync/sync.config.json', { cache: 'no-store' });
      if (!r.ok) return 0;
      const j = await r.json();
      const p = Number(j && j.port);
      return (p > 0 && p < 65536) ? p : 0;
    } catch (e) { return 0; }
  }
  /** 依次探测候选端口，返回第一个答话的 `/local/status`；一个都不行就抛出最后一个错。 */
  async function syncProbeAny() {
    const cands = [];
    const cfgPort = await syncConfigPort();
    if (cfgPort) cands.push(cfgPort);
    for (const p of SYNC_PORTS) if (!cands.includes(p)) cands.push(p);
    let lastErr = null;
    for (const port of cands) {
      syncApiBase = 'http://127.0.0.1:' + port;
      try {
        const info = await syncFetch('/local/status', { timeout: 2500 });
        syncPortNow = port;
        /* 服务自己报的端口最权威：用户把它改到别处时跟过去（连不上就还用刚探到的）。 */
        const real = Number(info && info.port);
        if (real && real !== port && real > 0 && real < 65536) {
          syncApiBase = 'http://127.0.0.1:' + real;
          try { const info2 = await syncFetch('/local/status', { timeout: 2500 }); syncPortNow = real; return info2; }
          catch (e) { syncApiBase = 'http://127.0.0.1:' + port; }
        }
        return info;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Failed to fetch');
  }
  const syncState = { checked: false, ok: false, info: null, reason: '', busy: false, job: null, result: null, timer: 0 };

  /* ============================================================
   * 【UC16】云同步（上传/下载/进度）
   * ============================================================ */
  async function syncFetch(pathname, opts) {
    opts = opts || {};
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeout || 15000) : 0;
    try {
      const res = await fetch(syncApiBase + pathname, { method: opts.method || 'GET', signal: ctl ? ctl.signal : undefined });
      let body = null;
      try { body = await res.json(); } catch (e) {}
      if (!res.ok) { const err = new Error((body && body.msg) || ('同步服务返回 HTTP ' + res.status)); err.body = body; throw err; }
      if (!body) throw new Error('同步服务返回了看不懂的内容');
      return body;
    } finally { if (timer) clearTimeout(timer); }
  }
  async function syncProbe() {
    /* 端口探测统一走 `syncProbeAny()`（配置里的端口 → 候选表 → 服务自报的端口）；
     * 找到哪个，之后的请求就用哪个。 */
    try {
      syncState.info = await syncProbeAny();
      syncState.ok = true; syncState.reason = '';
    } catch (lastErr) {
      syncState.ok = false; syncState.info = null;
      const raw = (lastErr && lastErr.name === 'AbortError') ? '同步服务没有响应（超时）' : String((lastErr && lastErr.message) || lastErr);
      /* 常见两类要分开说：
       *  · 403 → 同步服务拒了本页面的来路（桌面客户端/局域网 IP 打开时会这样）
       *  · Failed to fetch → 本机同步服务没在跑（候选端口都没人应）
       * 两者都在排查「游戏内推不过去、命令行却正常」时最关键。 */
      syncState.reason = /HTTP 403/.test(raw)
        ? raw + '（同步服务只接受来自 127.0.0.1 / localhost / Tauri 桌面壳的页面调用；用局域网 IP 打开游戏就会这样）'
        : /Failed to fetch|NetworkError|Load failed/i.test(raw)
          ? raw + '（本机同步服务没在跑：跑 node scripts/sync/sync.js serve，或用「一键同步」启动）'
          : raw;
    }
    syncState.checked = true;
  }
  function fmtWhen(ms) { return (ms && State.syncFormatTime) ? State.syncFormatTime(ms) : '—'; }
  function saveLine(s, who) {
    if (!s || !s.exists) return who + '：还没有存档';
    return who + '：' + esc(s.name || '小松鼠') + ' ' + (s.level == null ? '?' : s.level) + ' 级 · ' + fmtWhen(s.savedAt);
  }
  /** 失败原因 → 人话 + 下一步。面板上最值钱的就是这一段。 */
  function syncAdvice(code, msg) {
    switch (code) {
      case 'PEER_DOWN': return '对端的同步服务没在跑，或者对端防火墙没放行同步端口。到那台机器上双击「一键同步」→「9) 后台同步服务 → 1) 启动」，Windows 上还会弹一次 UAC 放行（或跑一次 prepare）。Mac 上想确认本机是否正常：菜单里选 c) 自检。';
      case 'TOKEN': return '两边口令（token）不一样。把两边 game/tools/sync/sync.config.json 里的 token 改成完全一样；老版本的服务改完要重启一次（Windows 上双击 重启同步服务.cmd）。';
      case 'PEER_NEWER': return '对面那份存档更新，所以没有覆盖它——这是防手滑的保护。确实要用本机这份盖掉对面，点下面的「强制覆盖对面」。';
      case 'LOCAL_NEWER': return '本机这份存档更新，所以没有覆盖自己。确实要用对面那份盖掉本机，点下面的「强制用对面覆盖本机」。';
      case 'NO_LOCAL_SAVE': return '本机还没写出存档。先在游戏里玩一下（任意操作都会自动保存），再回来同步。';
      case 'PEER_NO_SAVE': return '对端还没有存档，先把对端的游戏打开玩一下，或者从本机「把存档送过去」。';
      case 'PARTIAL': return '有一部分文件没传成功，多半是对端服务中途断了。再点一次即可，已传过去的不会重传。';
      case 'FILES_FAILED': return '一个文件都没传成功，通常是对端服务断了或磁盘写不进去。确认对端服务在跑，再点一次。';
      case 'PARTIAL_PEER_OLD': return '有文件被对端拒收了——对端那台的忽略清单还是旧的（多半它还在跑旧版本/旧目录布局）。在对面双击 scripts/restart-sync.cmd（或跑 node scripts/sync/sync.js restart），回来再点一次就会过去。';
      case 'ERROR': return msg || '同步失败。可以在 Mac 的「一键同步」菜单里选 c) 自检，看看到底卡在哪一步。';
      default: return msg || '';
    }
  }
  function resultHead(r) {
    if (!r) return '';
    const secs = ((r.took || 0) / 1000).toFixed(1);
    if (r.ok) return '<b class="sync-on">✓ 同步成功</b> ' + esc(r.msg || '') + ' · 耗时 ' + secs + ' 秒';
    if (r.skipped) return '<b class="sync-warn">已跳过</b> ' + esc(r.msg || '') + ' · 耗时 ' + secs + ' 秒';
    return '<b class="sync-warn">同步失败</b> ' + esc(r.msg || '') + ' · 耗时 ' + secs + ' 秒';
  }
  /** 正在同步 / 上一次结果：直接改这块 DOM，不整页重绘（否则进度条会闪）。 */
  function syncProgressHtml() {
    const j = syncState.job, r = syncState.result;
    if (syncState.busy) {
      const j2 = j || {};
      const pct = j2.total ? Math.round(100 * (j2.done || 0) / j2.total) : 0;
      const bar = j2.total ? '<div class="sp-bar"><i style="width:' + pct + '%"></i></div>' : '';
      const count = j2.total ? '　' + (j2.done || 0) + '/' + j2.total : '';
      const kb = j2.bytes ? '　' + (j2.bytes / 1024).toFixed(0) + ' KB' : '';
      const log = (j2.lines && j2.lines.length) ? '<pre class="sp-log">' + esc(j2.lines.join('\n')) + '</pre>' : '';
      return '<div class="sp-head"><b class="sync-on">同步中…</b> ' + esc(j2.phase || '准备中') + count + kb + '</div>' + bar + log;
    }
    if (!r) return '';
    let html = '<div class="sp-head">' + resultHead(r) + '</div>';
    html += '<div class="sp-hint">' + esc(syncAdvice(r.code, r.msg)) + '</div>';
    if (r.code === 'PEER_NEWER' || r.code === 'LOCAL_NEWER') {
      const label = r.code === 'PEER_NEWER' ? '强制覆盖对面' : '强制用对面覆盖本机';
      html += '<div class="sp-actions">' + btn(label, 'sync-force', 'small gold') + '</div>';
    }
    const log = (j && j.lines && j.lines.length) ? '<pre class="sp-log">' + esc(j.lines.join('\n')) + '</pre>' : '';
    return html + log;
  }
  function paintSyncProgress() {
    const html = syncProgressHtml();
    /* 同步面板与「游戏更新」面板共用同一份进度（从另一台电脑更新时进度显示在更新面板里） */
    for (const id of ['sync-progress', 'update-progress']) {
      const host = typeof document !== 'undefined' ? document.getElementById(id) : null;
      if (!host) continue;
      host.innerHTML = html;
      host.style.display = html ? '' : 'none';
    }
  }
  /** 系统页里「跨设备同步」那一块。 */
  function syncPanel() {
    if (!syncState.checked) { void syncProbe().then(() => { if (screen === 'system') openSystem(); }); }
    const info = syncState.info || {};
    const peers = Object.keys(info.peers || {});
    let state;
    if (!syncState.checked) {
      state = '<b class="sync-on">检查中…</b>';
    } else if (!syncState.ok) {
      state = '<b class="sync-off">同步服务没启动</b><span class="small-label">' +
        esc(syncState.reason || '本机 127.0.0.1 上没找到同步服务（端口 ' + syncPortNow + ' 没人应）。') +
        '<br>双击游戏目录里的 <code>一键同步.command</code>（Mac）或 <code>一键同步.cmd</code>（Windows），' +
        '选一次「启动后台同步服务」，这里就能一键互传存档。</span>';
    } else if (!peers.length) {
      state = '<b class="sync-warn">还没找到另一台电脑</b><span class="small-label">本机叫「' + esc(info.name || '?') +
        '」，ZeroTier 地址 ' + esc((info.selfIps || []).join('、') || '未检测到') +
        '。点「扫描对端」，或者在对面的机器上跑一次同步菜单里的「扫描」。</span>';
    } else {
      state = '<b class="sync-on">已连上：' + peers.map((k) => esc(k) + '（' + esc(info.peers[k]) + '）').join('、') +
        '</b><span class="small-label">本机「' + esc(info.name || '?') +
        '」　端口 ' + esc(String(info.port || syncPortNow)) + '　' + saveLine(info.save, '本机存档') + '</span>';
    }
    let actions = '';
    if (syncState.ok && peers.length) {
      const dis = syncState.busy ? ' muted' : '';
      actions = btn('推送存档', 'sync-save-push', 'small gold' + dis) + btn('拉取存档', 'sync-save-pull', 'small gold' + dis) +
        btn('推送文件', 'sync-files-push', 'small' + dis) + btn('拉取文件', 'sync-files-pull', 'small' + dis);
    } else if (syncState.ok) {
      actions = btn('扫描对端', 'sync-discover', 'small') + btn('重新检测', 'sync-recheck', 'small muted');
    } else {
      actions = btn('重新检测', 'sync-recheck', 'small');
    }
    const prog = syncProgressHtml();
    /* 屏蔽标准：**以游戏目录里的 .gitignore 为准**（服务端解析后随 `/local/status` 报回来）。
     * 用户 2026-10 口径："使用双端对齐工具时读取 .gitignore 作为屏蔽标准，不要再同步 out 等文件夹。"
     * 这一行就是把那件事**显示出来**：`.gitignore` 读到了几条、out/ 与 save/ 是否真的被挡住、
     * 源码是否照常同步 —— 玩家不用猜"到底同步了什么"。 */
    const ig = (syncState.ok && info.ignore) ? info.ignore : null;
    let ignoreLine = '';
    if (ig) {
      const okProbe = ig.sample && ig.sample.out && ig.sample.save && ig.sample.code;
      const rules = (ig.gitignore && ig.gitignore.rules) ? ig.gitignore.rules : 0;
      const src = (ig.gitignore && ig.gitignore.path)
        ? ('按 <code>' + esc(ig.gitignore.path) + '</code> 屏蔽（' + rules + ' 条）')
        : '没读到 .gitignore，按内置清单屏蔽';
      ignoreLine = '<div class="sync-ignore' + (okProbe ? '' : ' warn') + '">' +
        (okProbe ? '✓ ' : '⚠ ') + '屏蔽标准：' + src +
        '　+ 内置 ' + (ig.builtin | 0) + ' 条' + ((ig.custom | 0) ? (' + 自定义 ' + (ig.custom | 0) + ' 条') : '') +
        '　·　<code>out/</code>、<code>save/</code> 等本地产物不进同步，源码照常同步' +
        (okProbe ? '' : '（探针异常：out=' + (ig.sample && ig.sample.out) + ' save=' + (ig.sample && ig.sample.save) + ' code=' + (ig.sample && ig.sample.code) + '）') +
        '</div>';
    }
    return '<div class="sync-panel"><h3 class="classic-section-title">跨设备同步</h3><div class="sync-head">' + state + '</div>' +
      '<div class="sync-actions">' + actions + '</div>' + ignoreLine +
      '<div class="sync-progress" id="sync-progress"' + (prog ? '' : ' style="display:none"') + '>' + prog + '</div></div>';
  }
  /** 面板上的按钮实际动作。kind 形如 'save' / 'files'，dir 是 'push' / 'pull'。 */
  async function syncRun(kind, dir, force) {
    if (syncState.busy) { toast('上一次同步还在跑，稍等一下'); return; }
    const info = syncState.info || {};
    const peers = Object.keys(info.peers || {});
    if (!peers.length) { toast('还没找到对端，先点「扫描对端」'); return; }
    const peer = peers[0];
    syncState.busy = true; syncState.result = null;
    syncState.job = { phase: '准备中', done: 0, total: 0, bytes: 0, lines: [] };
    if (screen === 'system') { openSystem(); }
    // 一边等结果，一边每 600ms 问一次进度，实时刷进度条与日志
    const tick = async () => {
      try {
        const p = await syncFetch('/local/progress', { timeout: 3000 });
        syncState.job = p;
        paintSyncProgress();
        if (!p.active && syncState.busy && !syncState.result) { /* 还在等 POST 返回，忽略 */ }
      } catch (e) {}
    };
    syncState.timer = setInterval(tick, 600);
    const t0 = Date.now();
    try {
      const body = await syncFetch('/local/' + kind + '/' + dir + '?peer=' + encodeURIComponent(peer) + (force ? '&force=1' : ''),
        { method: 'POST', timeout: kind === 'files' ? 600000 : 60000 });
      if (body.job) syncState.job = body.job;
      const ok = body.ok !== false && !body.skipped;
      syncState.result = { ok, skipped: !!body.skipped, code: body.code || (ok ? 'OK' : 'ERROR'), msg: body.msg || '', took: Date.now() - t0, kind, dir, force: !!force };
      if (kind === 'save' && dir === 'pull' && ok) {
        const loaded = await State.fileLoad();
        if (loaded) refreshHome();
        syncState.result.msg = syncState.result.msg || ('已取回「' + peer + '」的存档');
      }
    } catch (e) {
      const body = e && e.body;
      syncState.result = {
        ok: false, skipped: false, code: (body && body.code) || 'ERROR',
        msg: (body && body.msg) || String((e && e.message) || e), took: Date.now() - t0, kind, dir, force: !!force,
      };
      if (body && body.job) syncState.job = body.job;
    } finally {
      if (syncState.timer) { clearInterval(syncState.timer); syncState.timer = 0; }
      syncState.busy = false;
    }
    if (screen === 'system') { openSystem(); } else { paintSyncProgress(); }
    toast(syncState.result.ok ? '同步成功' : (syncState.result.skipped ? '已跳过（对面更新）' : '同步失败，看面板提示'));
  }
  /* ============================================================
   * 【UC16b】同步二级确认（点按钮先「识别」，确认后才动手）
   *
   * 2026-10 用户口径：跨设备同步这一区的每个动作（送/取存档、推/拉文件）都要先弹一个
   * 二级确认界面，并且在**弹窗里就把这一趟会发生什么识别出来**：
   *   · 存档方向：并排预览两边的等级 / 经验 / 金松果 / 存档时间，标出谁会被覆盖；
   *   · 文件方向：列出预计会改到的文件与改动量（个数 / 总大小 / 明细）。
   * 识别用的是同步服务的 /local/save/preview 与 /local/files/preview（只读），
   * 识别完成前「确认」键禁用；识别失败只给原因、不放行。确认后才调 syncRun 真跑
   * （真跑时服务会再比对一次，以那次为准）。
   * 老版本服务没有预览接口（HTTP 404）：文件方向退回 dry=1 拿数量，存档方向退回
   * 普通确认，并提示「重启一次同步服务」就能看到完整预览。
   * ============================================================ */
  const syncAskSize = (n) => {
    const v = Number(n) || 0;
    return v >= 1048576 ? (v / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(v / 1024)) + ' KB';
  };
  /** 存档预览里的一侧小卡片。cls：keep = 这份会留下，lose = 这份会被覆盖。 */
  function saveAskCard(label, s, exists, when, cls) {
    const head = '<div class="ask-card-head">' + esc(label) + '</div>';
    if (!exists) return '<div class="ask-card ' + cls + '">' + head + '<div class="ask-card-name">还没有存档</div></div>';
    const lv = s.level == null ? '?' : s.level;
    const need = Number((window.GData && GData.nextExp) ? GData.nextExp(lv) : 0) || 0;
    const exp = (Number(s.exp) || 0) + (need ? '/' + need : '');
    return '<div class="ask-card ' + cls + '">' + head +
      '<div class="ask-card-name">' + esc(s.name || '小松鼠') + ' <b>' + esc(lv) + '</b> 级</div>' +
      '<div class="ask-card-line">经验 ' + esc(exp) + '　' + goldIcon('ask-gold') + ' ' + esc(Number(s.gold) || 0) + '</div>' +
      '<div class="ask-card-line small">存档时间 ' + esc(when || '—') + '</div></div>';
  }
  /** 存档方向的预览内容：返回 { html, canGo }。 */
  function saveAskHtml(d, peer, dir) {
    const push = dir === 'push';
    const me = d.local || {}, other = d.remote || {};
    const mineName = (syncState.info && syncState.info.name) || '这台';
    const html = '<div class="ask-cards">' +
      saveAskCard('本机「' + mineName + '」' + (push ? '（保留）' : '（将被覆盖）'), me, d.localExists, fmtWhen(d.localSavedAt), push ? 'keep' : 'lose') +
      saveAskCard('对面「' + peer + '」' + (push ? '（将被覆盖）' : '（保留）'), other, d.remoteExists, fmtWhen(d.remoteSavedAt), push ? 'lose' : 'keep') +
      '</div>';
    let verdict = '', canGo = true;
    if (push && !d.localExists) {
      canGo = false;
      verdict = '<div class="ask-verdict warn">本机还没有存档 —— 先在游戏里玩一下（任意操作都会自动保存），再回来送存档。</div>';
    } else if (!push && !d.remoteExists) {
      canGo = false;
      verdict = '<div class="ask-verdict warn">对面还没有存档，没什么可取的 —— 先把对面的游戏打开玩一下，或者从本机「把存档送过去」。</div>';
    } else if (push && !d.remoteExists) {
      verdict = '<div class="ask-verdict">对面还没有存档：这次会把本机这份新建过去。</div>';
    } else if (d.ahead === (push ? 'b' : 'a')) {
      const aheadSide = push ? other : me, behindSide = push ? me : other;
      verdict = '<div class="ask-verdict warn">⚠ ' + (push ? '对面的进度更靠前' : '本机的进度更靠前') +
        '（' + esc(aheadSide.level == null ? '?' : aheadSide.level) + ' 级 vs ' + esc(behindSide.level == null ? '?' : behindSide.level) +
        ' 级）—— 确认后会' + (push ? '用本机这份覆盖对面' : '用对面这份覆盖本机') +
        '，被覆盖的那份会自动备份到它那台的 <code>save/backup/</code>。</div>';
    } else if (d.ahead === 'same') {
      verdict = '<div class="ask-verdict ok">两边进度相同' +
        (push ? '；内容一致时会自动跳过，不会白推一遍。' : '；取回后还是这份进度。') + '</div>';
    }
    const foot = '<div class="ask-foot">' + (push
      ? '只会覆盖对面那台的 <code>save/progress.json</code>（写之前先备份对面旧档），不动游戏文件。'
      : '只会覆盖本机的 <code>save/progress.json</code>（写之前先备份本机旧档，在 <code>save/backup/</code>），不动游戏文件。') +
      '确认后立刻开始，页面下方的进度条会显示过程。</div>';
    return { html: html + verdict + foot, canGo: canGo };
  }
  /** 文件方向的预览内容：返回 { html, canGo }。 */
  function filesAskHtml(d, peer, dir) {
    const push = dir === 'push';
    const side = (push ? d.push : d.pull) || { count: 0, bytes: 0, files: [] };
    const count = Number(side.count) || 0;
    const verb = push ? '推送' : '拉取';
    const lead = '<div class="ask-lead">' + (push
      ? '把本机较新的文件推给「' + esc(peer) + '」：同名文件会被覆盖（只推较新的和本机新增的）。'
      : '从「' + esc(peer) + '」取回较新的文件：本机同名文件会被覆盖（只取较新的和对端新增的）。') + '</div>';
    /* 反向多出来的文件：本次不会删（同步只覆盖，不删除）。 */
    const extraN = push ? (d.onlyRemote || 0) : (d.onlyLocal || 0);
    const extraLine = extraN
      ? '<div class="ask-foot">' + (push ? '对面' : '本机') + '还有 ' + extraN + ' 个' +
        (push ? '本机没有' : '对端没有') + '的文件，本次不会动它们（同步只覆盖，不删文件）。</div>'
      : '';
    if (!count) {
      return { html: lead + '<div class="ask-verdict ok">✓ 两边文件一致 —— 没有需要' + verb + '的改动。</div>' + extraLine, canGo: false };
    }
    const fresh = push ? (d.onlyLocal || 0) : (d.onlyRemote || 0);
    /* 列全部明细（服务端按体积降序、封顶 50 条），列表本身可滚动；
     * 超过封顶的只在末尾报个数 —— 真跑时每个文件都会进页面下方的进度日志。 */
    const shown = side.files || [];
    const more = count - shown.length;
    const list = '<ul class="ask-files">' + shown.map((f) =>
      '<li><span class="ask-fpath">' + esc(f.p) + '</span><b>' + syncAskSize(f.s) + '</b></li>').join('') +
      (more > 0 ? '<li class="ask-more">…另外 ' + more + ' 个文件（上面列的是体积最大的前 ' + shown.length + ' 个）</li>' : '') +
      '</ul>';
    const summary = '<div class="ask-count">预计' + verb + ' <b>' + count + '</b> 个文件，共 <b>' + syncAskSize(side.bytes) + '</b>' +
      (fresh ? '（其中 ' + fresh + ' 个是' + (push ? '本机新增' : '对端新增') + '）' : '') + '：</div>';
    const foot = '<div class="ask-foot">不会动：<code>save/</code> 存档、本地产物（<code>out/</code>、<code>node_modules/</code> 等，以 ' +
      '<code>.gitignore</code> 为准）；也不会删除任何文件。</div>' +
      '<div class="ask-foot">确认后立刻开始（开始时会重新比对一次，以那时的结果为准）；每个文件都会列在页面下方的进度日志里。</div>';
    return { html: lead + summary + list + extraLine + foot, canGo: true };
  }
  /** 四个同步按钮的二级确认入口。kind：'save' / 'files'；dir：'push' / 'pull'；force 只对存档有意义。 */
  async function syncAsk(kind, dir, force) {
    if (syncState.busy) { toast('上一次同步还在跑，稍等一下'); return; }
    const info = syncState.info || {};
    const peers = Object.keys(info.peers || {});
    if (!peers.length) { toast('还没找到对端，先点「扫描对端」'); return; }
    const peer = peers[0];
    const isSave = kind === 'save';
    const push = dir === 'push';
    const title = (isSave ? (push ? '送存档' : '取回存档') : (push ? '推送文件' : '拉取文件')) +
      (force ? '（强制）' : '') + ' · 确认';
    const confirmLabel = isSave ? (push ? '确认送出' : '确认取回') : (push ? '确认推送' : '确认拉取');
    let ready = false;
    const m = modal(title,
      '<div class="sync-ask"><div class="sync-ask-wait">正在识别' + (isSave ? '两边的存档进度' : '两边有改动的文件') + '…</div>' +
      '<div class="small-label">这一步只读不写：看清了再确认。</div></div>',
      [{ label: '返回', cls: 'muted' }, { label: confirmLabel, cls: 'gold', run: () => { if (ready) syncRun(kind, dir, force); } }]);
    const body = $('.modal-body', m.element);
    const okBtn = $$('.modal-buttons button', m.element).find((b) => b.textContent.trim() === confirmLabel);
    if (okBtn) okBtn.disabled = true;
    const show = (html, canGo) => {
      if (body) body.innerHTML = '<div class="sync-ask">' + html + '</div>';
      ready = !!canGo;
      if (okBtn) okBtn.disabled = !ready;
    };
    const forceNote = force ? '<div class="ask-verdict warn">上一次同步被「对面更新」拦下来了 —— 这次是<b>强制覆盖</b>。</div>' : '';
    try {
      if (isSave) {
        const d = await syncFetch('/local/save/preview?peer=' + encodeURIComponent(peer), { timeout: 30000 });
        const r = saveAskHtml(d, peer, dir);
        show(forceNote + r.html, r.canGo);
      } else {
        const d = await syncFetch('/local/files/preview?peer=' + encodeURIComponent(peer), { timeout: 120000 });
        const r = filesAskHtml(d, peer, dir);
        show(forceNote + r.html, r.canGo);
      }
    } catch (e) {
      const raw = String((e && e.message) || e);
      if (/没有这个接口|HTTP 404/.test(raw)) {
        /* 老版本同步服务：没有预览接口。文件方向还能用 dry=1 拿到「会传几个」；
         * 存档方向只能把覆盖方向说清楚。两边都提示怎么拿到完整预览。 */
        if (isSave) {
          const s = info.save || {};
          const mine = s.exists ? ('本机现在是「' + esc(s.name || '小松鼠') + ' ' + esc(s.level == null ? '?' : s.level) + ' 级」') : '本机还没有存档';
          show('<div class="ask-lead">当前同步服务是旧版本，拿不到两边的完整预览。</div>' +
            '<div class="ask-verdict">' + mine + '。' + (push ? '送存档会用它覆盖对面' : '取回存档会用对面这份覆盖本机') +
            '，被覆盖的那份会自动备份到它那台的 <code>save/backup/</code>。</div>' +
            '<div class="ask-foot">重启一次同步服务（双击 <code>重启同步服务.cmd</code>）之后再点，就能看到两边等级 / 经验的完整预览。</div>',
            push ? !!s.exists : true);
        } else {
          try {
            const dry = await syncFetch('/local/files/' + dir + '?dry=1&peer=' + encodeURIComponent(peer), { method: 'POST', timeout: 120000 });
            const n = Number((dry.job && dry.job.total) || 0);
            show('<div class="ask-lead">当前同步服务是旧版本，只报改动数量、列不出文件清单。</div>' +
              '<div class="ask-verdict' + (n ? '' : ' ok') + '">' + (n
                ? '本次预计会' + (push ? '推送' : '拉取') + ' ' + n + ' 个文件（同名覆盖，不删文件、不动 <code>save/</code>）。'
                : '✓ 两边文件一致 —— 没有需要' + (push ? '推送' : '拉取') + '的改动。') + '</div>' +
              '<div class="ask-foot">重启一次同步服务（双击 <code>重启同步服务.cmd</code>）之后再点，就能逐条看到会改哪些文件、改动量多大。</div>',
              n > 0);
          } catch (e2) {
            show('<div class="ask-verdict warn">识别失败：' + esc(String((e2 && e2.message) || e2)) + '</div>', false);
          }
        }
      } else {
        show('<div class="ask-verdict warn">识别失败：' + esc(raw) + '</div>' +
          '<div class="ask-foot">没有开始任何同步 —— 按上面的提示处理后再点一次。</div>', false);
      }
    }
  }
  /* ============================================================
   * 【UC17】系统设置 / 村庄 / 攻略
   * ============================================================ */
  /* ============================================================
   * 【UC19】一键拉取远端更新（游戏更新面板）
   *
   * 三种「远端」，按可用性显示按钮（都不行就只剩「打开下载页」）：
   *   · 另一台电脑：复用系统页已有的双机同步服务（/local/files/pull，ZeroTier/局域网）
   *   · 本机 git 仓库：/__update?mode=git → `git pull --ff-only`
   *   · GitHub Releases：/__update?mode=release → 便携包就地覆盖；安装包下载后交给系统打开
   *
   * /__update 由**本机服务器**提供（轻壳的内置服务器 / 便携版的 serve.js），
   * 真正的活由零依赖的 scripts/update-game.js 干 —— 三条路都不碰 save/，
   * 动手前还会自动把存档备份一份（save/backup/progress-…-before-update.json）。
   * ============================================================ */
  const UPDATE_PAGE = 'https://github.com/Charlespkuer/UC_Squirrel_Fight_remake/releases/latest';
  const updState = { busy: false, pending: null, note: '', channel: '', local: null, git: null, release: null, sync: null, result: null };

  /** 页面是不是从「本机磁盘」上跑的（轻壳 / 便携版 / 源码版）。网页版与安装版都不是 →
   *  那种情况下没有任何就地更新的余地，只能给下载页。 */
  function localDiskPage() {
    try {
      const h = String(location.hostname || '');
      return location.protocol === 'file:' || h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
    } catch (e) { return false; }
  }
  function platformTag() {
    const ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
    if (/Android/i.test(ua)) return 'android';
    if (/Windows/i.test(ua)) return 'win32';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'darwin';
    return 'linux';
  }
  /** 调本机的 /__update（只传白名单参数，不传命令）。
   *  注意：这条路由只有**新版**的便携版服务器 / 轻壳 exe 才有；旧客户端会 404，
   *  这时 updateCheck 会退到本机同步服务的 /local/update/*（那边同样是白名单 + 只允许本机）。 */
  async function updateFetch(pathname, opts) {
    opts = opts || {};
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeout || 900000) : 0;
    try {
      const res = await fetch(pathname, { method: opts.method || 'GET', cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      let body = null;
      try { body = await res.json(); } catch (e) {}
      if (!body) return { ok: false, code: 'NO_HELPER', msg: '这个客户端不支持就地更新（更新接口没有响应，HTTP ' + res.status + '）' };
      return body;
    } catch (e) {
      return { ok: false, code: 'NO_HELPER', msg: '这个客户端不支持就地更新（连不上 ' + pathname.split('?')[0] + '）' };
    } finally { if (timer) clearTimeout(timer); }
  }
  const sizeText = (n) => (Number(n) > 1048576 ? (Number(n) / 1048576).toFixed(1) + ' MB' : Math.max(0, Math.round(Number(n) / 1024)) + ' KB');

  /** 检查：本机（版本 / git / Releases）+ 另一台电脑（待传文件数）。能查到什么显示什么。 */
  async function updateCheck() {
    if (updState.busy) return;
    updState.busy = true; updState.note = '正在检查…'; updState.result = null; updState.pending = null;
    if (screen === 'system') openSystem();
    try {
      updState.channel = '';
      if (localDiskPage()) {
        let r = await updateFetch('/__update?mode=check&platform=' + platformTag());
        if (r && r.local) updState.channel = 'origin';
        if (!updState.channel) {
          /* 退路：本机同步服务就是「本机 agent」（只允许 127.0.0.1 页面 + Origin 校验），
           * 它跑 update-game.js 一样安全 —— 于是**旧 exe 不重编也能一键更新**。 */
          try {
            const q = await syncFetch('/local/update/check?platform=' + platformTag(), { timeout: 90000 });
            if (q && q.local) { r = q; updState.channel = 'sync'; }
          } catch (e) {
            const msg = String((e && e.message) || '');
            if (/没有这个接口|404|HTTP 404/.test(msg)) updState.note = '本机同步服务还是旧版本：先重启一次同步服务（「重启同步服务.cmd」，或同步菜单 9→3），之后这里就能一键更新。';
          }
        }
        if (updState.channel) {
          updState.local = r.local; updState.git = r.git || null; updState.release = r.release || null; updState.note = '';
        } else {
          updState.local = null; updState.git = null; updState.release = null;
          if (!updState.note) updState.note = (r && r.msg) || '这个客户端不提供就地更新（旧客户端 / 安装版）：先用「另一台电脑」，或「打开下载页」。';
        }
      } else {
        updState.local = null; updState.git = null; updState.release = null;
        updState.note = '这个页面不是从本机磁盘上跑的（网页版 / 安装版），没法就地更新 —— 用「打开下载页」装新版。';
      }
      if (!syncState.checked) { try { await syncProbe(); } catch (e) {} }
      const peers = Object.keys((syncState.info || {}).peers || {});
      if (syncState.ok && peers.length) {
        try {
          const q = await syncFetch('/local/files/pull?dry=1&peer=' + encodeURIComponent(peers[0]), { method: 'POST', timeout: 120000 });
          updState.sync = { peer: q.peer || peers[0], files: Number((q.job && q.job.total) || 0) };
        } catch (e) { updState.sync = { peer: peers[0], files: null, error: String((e && e.message) || e) }; }
      } else updState.sync = null;
    } finally {
      updState.busy = false;
      if (screen === 'system') openSystem();
    }
  }
  /** 点来源按钮 → 进入「确认」状态（不直接动手：git / 下载都是改文件的事）。 */
  function updateAsk(kind) {
    updState.pending = kind; updState.result = null;
    if (screen === 'system') openSystem();
  }
  function updatePlanText(kind) {
    if (kind === 'sync') {
      const n = updState.sync && updState.sync.files;
      return '从另一台电脑「' + esc(String((updState.sync && updState.sync.peer) || '对端')) + '」拉取' +
        (n == null ? '有改动的游戏文件' : ' ' + n + ' 个有改动的游戏文件') +
        '（只覆盖同名文件，不动存档、不动同步口令）。';
    }
    if (kind === 'git') {
      const g = updState.git || {};
      return '执行 <code>git pull --ff-only</code>' + (g.behind ? '（落后远端 ' + g.behind + ' 个提交）' : '') +
        '。有未提交改动时会失败，不会覆盖你的改动。';
    }
    const r = updState.release || {};
    const a = r.asset || {};
    if (!r.ok) return '远端暂时没有适合本机的文件：' + esc(r.msg || '') + '（可以改用「打开下载页」）。';
    if (r.kind === 'zip') return '下载远端 <b>' + esc(r.tag) + '</b> 的便携包 <b>' + esc(a.name) + '</b>（' + sizeText(a.size) + '），解压后覆盖游戏文件（跳过 save/）。';
    return '下载远端 <b>' + esc(r.tag) + '</b> 的安装包 <b>' + esc(a.name) + '</b>（' + sizeText(a.size) + '）到 save/updates/，然后交给系统打开安装向导。';
  }
  /** 真跑。sync 走同步服务（带进度条），其余走 /__update。 */
  async function updateRun(kind) {
    if (updState.busy || !kind) return;
    updState.pending = null; updState.busy = true; updState.result = null;
    updState.note = kind === 'sync' ? '正在从另一台电脑拉取…' : '正在更新，别关窗口…';
    if (screen === 'system') openSystem();
    try {
      if (kind === 'sync') {
        await syncRun('files', 'pull', false);
        const r = syncState.result || {};
        updState.result = { ok: r.ok !== false, mode: 'sync', files: r.done || (r.job && r.job.done) || 0, peer: r.peer, msg: r.msg, code: r.code };
      } else if (updState.channel === 'sync') {
        updState.result = await syncFetch('/local/update/run?mode=' + kind + '&platform=' + platformTag(), { method: 'POST', timeout: 1800000 });
      } else {
        updState.result = await updateFetch('/__update?mode=' + kind + '&platform=' + platformTag(), { method: 'POST' });
      }
    } catch (e) {
      updState.result = { ok: false, code: 'ERROR', msg: String((e && e.message) || e) };
    } finally {
      updState.busy = false; updState.note = '';
      if (screen === 'system') openSystem();
    }
  }
  function updateResultHtml() {
    const r = updState.result;
    if (!r) return '';
    if (r.ok === false) {
      return '<div class="sp-head"><b class="sync-off">更新没成功</b></div><div class="sp-hint">' +
        esc(r.msg || r.code || '未知原因') + '</div>' +
        '<div class="sp-actions">' + btn('下载页', 'update-page', 'small gold') + '</div>';
    }
    const done = r.mode === 'release' && r.kind && r.kind !== 'zip';
    const head = done ? '已下载并打开安装包' : '更新完成';
    const detail = done
      ? esc(String(r.asset && r.asset.name || '')) + ' → <code>' + esc(String(r.path || '')) + '</code>，按安装向导走完即可（装完记得重开客户端）。'
      : (r.tag ? '已更新到 <b>' + esc(String(r.tag)) + '</b>　' : '') +
        (r.files ? '覆盖 ' + r.files + ' 个文件' : '') + (r.bytes ? '（' + sizeText(r.bytes) + '）' : '') +
        (r.msg ? esc(String(r.msg)) : '') + '　<b>请刷新页面</b>（轻壳 / 便携版刷新即生效）。';
    return '<div class="sp-head"><b class="sync-on">' + head + '</b></div><div class="sp-hint">' + detail + '</div>' +
      '<div class="sp-actions">' + btn('立即刷新', 'update-reload', 'small gold') + btn('下载页', 'update-page', 'small') + '</div>';
  }
  /** 系统页里的「游戏更新」面板。 */
  function updatePanelHtml() {
    const loc = updState.local || {};
    const g = updState.git || {};
    const rel = updState.release || {};
    const peers = Object.keys((syncState.info || {}).peers || {});
    let head = '<b>本机 ' + (loc.version ? esc(String(loc.version)) : '未检查') + '</b>';
    if (updState.busy) head += ' <b class="sync-on">' + esc(updState.note || '处理中…') + '</b>';
    else if (updState.note) head += ' <span class="small-label">' + esc(updState.note) + '</span>';
    else if (loc.version) {
      const bits = [];
      if (g.isRepo) bits.push('git ' + (g.behind ? '落后 ' + g.behind + ' 个提交' : '已是最新'));
      if (rel.ok) bits.push('GitHub 最新 ' + esc(rel.tag) + (rel.kind === 'zip' ? '（可就地覆盖）' : '（下载安装包）'));
      else if (rel.code === 'NO_ASSET' && rel.tag) bits.push('GitHub ' + esc(rel.tag) + ' 没有适合本机的包');
      if (updState.sync) bits.push('另一台电脑 ' + (updState.sync.files == null ? '状态未知' : updState.sync.files + ' 个文件可更新'));
      head += '<span class="small-label">' + (bits.join('　') || '没有可用的更新来源') + '</span>';
    }
    const dis = updState.busy ? ' muted' : '';
    let actions = btn(updState.local || updState.sync || updState.git ? '重新检查' : '检查更新', 'update-check', 'small' + dis);
    if (!updState.pending) {
      if (syncState.ok && peers.length) actions += btn('远程更新', 'update-source-sync', 'small gold' + dis);
      if (rel.ok) actions += btn('在线更新', 'update-source-release', 'small gold' + dis);
      if (g.isRepo) actions += btn('用 git 拉取', 'update-source-git', 'small gold' + dis);
      actions += btn('下载页', 'update-page', 'small');
    }
    let tail = '';
    if (updState.pending) {
      tail = '<div class="sp-hint">' + updatePlanText(updState.pending) + '</div><div class="sp-actions">' +
        btn('确认更新', 'update-confirm', 'small gold' + dis) + btn('取消', 'update-cancel', 'small muted') + '</div>';
    } else {
      const via = updState.channel === 'sync' ? '本机同步服务' : updState.channel === 'origin' ? '本机服务器' : '';
      tail = '<div class="sp-hint">更新只覆盖游戏文件、<b>不动存档</b>（动手前还会自动备份一份）；装完 / 拉完刷新页面即可。' +
        (via ? '（走' + via + '就地更新）' : '安装版 / 安卓 / 网页版只能用「打开下载页」。') + '</div>' + updateResultHtml();
    }
    return '<div class="sync-panel update-panel"><h3 class="classic-section-title">游戏更新</h3><div class="sync-head">' + head + '</div>' +
      '<div class="sync-actions">' + actions + '</div>' + tail +
      '<div class="sync-progress" id="update-progress" style="display:none"></div></div>';
  }

  /* ===== 调试所得索引 / 回收（系统页入口） =====
   * 账本在 State.debugLedger 里（见 state.js「调试所得账本」）。这里只负责展示与
   * 二次确认：能回收的按基线只扣调试部分；等级/经验/属性只在索引里列出，不回退。 */
  function debugHistoryText(h) {
    const bits = [];
    if (h && h.props && typeof h.props === 'object') {
      for (const id of Object.keys(h.props)) {
        const def = propMap.getValue(Number(id));
        bits.push((def ? def.name : ('道具#' + id)) + '×' + h.props[id]);
      }
    }
    if (h && h.gold) bits.push('金松果×' + h.gold);
    if (h && h.goldCup) bits.push('金杯×' + h.goldCup);
    if (h && h.weapons && typeof h.weapons === 'object') {
      for (const id of Object.keys(h.weapons)) {
        const def = weaponsMap.getValue(Number(id));
        bits.push((def ? def.name : ('武器#' + id)) + '→Lv' + h.weapons[id]);
      }
    }
    if (h && h.skills && typeof h.skills === 'object') {
      for (const id of Object.keys(h.skills)) {
        const def = skillsMap.getValue(Number(id));
        bits.push((def ? def.name : ('技能#' + id)) + '→Lv' + h.skills[id]);
      }
    }
    if (h && Array.isArray(h.gears) && h.gears.length) bits.push('装备×' + h.gears.length);
    if (h && h.exp) bits.push('经验+' + h.exp);
    if (h && h.level) bits.push('等级+' + h.level);
    if (h && h.picks) bits.push('待选武技+' + h.picks + '组');
    if (h && h.cleared) bits.push('清理 ' + h.cleared + ' 项');
    return bits.join('、') || '（无物品变化）';
  }
  function openDebugLedger() {
    const sum = State.debugLedgerSummary ? State.debugLedgerSummary() : { hasData: false, entries: [], history: [], removable: 0 };
    const ul = (items) => '<ul style="margin:8px 0 12px;padding-left:22px;font-size:24px;line-height:1.55;color:#7d5d39;max-height:260px;overflow:auto">' + items + '</ul>';
    let body = '<p>这里只列<strong>调试面板直接发放、且现在还能定位到</strong>的部分。清理时按领取前的基线扣除：你自己原本就有的道具/武技/装备会尽量保留；已经花掉、卖掉或融合掉的调试物品无法找回，也不会倒扣。</p>';
    if (sum.entries.length) {
      const rows = sum.entries.map((e) => {
        if (e.kind === 'prop') return '<li>' + esc(e.name) + ' ×' + e.remove + '（现有 ' + e.current + '，调试前 ' + e.before + '）</li>';
        if (e.kind === 'gold') return '<li>金松果 ×' + e.remove + '（现有 ' + e.current + '，调试前 ' + e.before + '）</li>';
        if (e.kind === 'goldCup') return '<li>金杯 ×' + e.remove + '（现有 ' + e.current + '，调试前 ' + e.before + '）</li>';
        if (e.kind === 'weapon' || e.kind === 'skill') {
          return '<li>' + (e.kind === 'weapon' ? '武器' : '技能') + '【' + esc(e.name) + '】' +
            (e.mode === 'remove' ? '：移除调试获得的整件' : '：Lv' + e.current + ' → 还原 Lv' + e.before) + '</li>';
        }
        if (e.kind === 'gear') return '<li>装备【' + esc(e.name) + '】：移除调试生成的这一件</li>';
        return '';
      }).join('');
      body += '<h3 class="classic-section-title">可清理（' + sum.entries.length + ' 项）</h3>' + ul(rows);
    } else {
      body += '<p class="small-label">当前没有可清理的调试所得（可能已经花掉/融合掉，或只剩等级/经验记录）。</p>';
    }
    if (sum.exp && (sum.exp.levels || sum.exp.grantedExp || (sum.exp.stats && Object.values(sum.exp.stats).some((n) => n > 0)))) {
      const st = sum.exp.stats || {};
      body += '<p class="small-label">等级/经验/属性不回退：已记录等级 +' + (sum.exp.levels || 0) +
        '、经验 +' + (sum.exp.grantedExp || 0) +
        (Object.values(st).some((n) => n > 0) ? '、四维 +' + [st.power || 0, st.agility || 0, st.speed || 0, st.maxHp || 0].join('/') : '') +
        '。回退它们会破坏升级礼包、已选武技与天赋链，所以只保留索引。</p>';
    }
    const hist = (sum.history || []).slice().reverse();
    body += '<h3 class="classic-section-title">最近调试索引</h3>';
    body += hist.length ? ul(hist.map((h) => '<li><b>' + esc(State.syncFormatTime ? State.syncFormatTime(h.at) : new Date(h.at).toLocaleString()) + '</b>　' +
      esc(h.label || '调试') + '：' + esc(debugHistoryText(h)) + '</li>').join('')) :
      '<p class="small-label">还没有调试发放记录。</p>';
    const buttons = [{ label: '返回', cls: 'muted' }];
    if (window.Debug && Debug.reset) buttons.push({
      label: '关闭调试', cls: 'muted',
      run: () => {
        Debug.reset();
        if (UI && UI.toast) UI.toast('已关闭所有调试开关（物品不会因此变化）');
        openSystem();
      },
    });
    if (sum.entries.length) buttons.push({
      label: '清理调试', cls: 'gold', close: false,
      run: () => {
        modal('确认清理调试所得', '<p>将移除上面列出的 ' + sum.entries.length + ' 项调试所得；<b>不可撤销</b>。</p>' +
          '<p class="small-label">等级/经验/属性不回退；你自己原有的物品按基线保留。</p>', [
          { label: '取消', cls: 'muted' },
          { label: '确认清理', cls: 'gold', run: () => {
            const r = State.clearDebugGains ? State.clearDebugGains() : { ok: false, msg: '当前版本没有这个接口' };
            if (UI && UI.toast) UI.toast(r.ok ? ('已清理 ' + r.removed.length + ' 项调试所得') : (r.msg || '没有可清理项'));
            openSystem();
          } },
        ], { small: true });
      },
    });
    modal('调试所得索引', body, buttons, { small: false });
  }

  function openSystem() {
    const mute=Main.isMuted&&Main.isMuted();
    const vol=Math.round(100*((Main.volume&&Main.volume())||0));
    const st=(Main.settings&&Main.settings())||{resolution:'auto',fullscreen:false,hideStatusBar:true};
    const musicOn=!mute && vol>0;
    /* 音乐音量：去掉独立的「音乐：开/关」后，把整条滑条改成和设置按钮同一颗金/绿胶囊。
     * 点胶囊（滑条以外）开关音乐，拖滑条仍可连续调音量 —— 选中（正在响）是绿色。 */
    const slider='<div class="setting-slider music-setting '+(musicOn?'on':'')+'" data-slider="volume">'+
      '<button type="button" class="music-toggle" data-action="sound" aria-pressed="'+musicOn+'" title="点击开关音乐；拖动右侧滑条调节音量">'+
        '<span class="slider-label">音乐</span>'+
        '<b class="slider-value">'+(musicOn?vol+'%':'已静音')+'</b>'+
      '</button>'+
      '<input type="range" min="0" max="100" step="1" value="'+vol+'" aria-label="音乐音量">'+
      '<span class="music-hint">'+(musicOn?'点击开关':'点击开启')+'</span>'+
    '</div>';
    const resolutions=State.RESOLUTIONS||[];
    const resShort=(r)=>!r?'自动':r.key==='auto'?'自动':r.label.replace(' × ','×');
    const resIndex=Math.max(0,resolutions.findIndex((r)=>r.key===st.resolution));
    const resNow=resolutions[resIndex]||resolutions[0];
    const sysBtn=(label,action,cls,title,badge)=>'<button type="button" class="uc-button '+(cls||'')+'" data-action="'+action+'"'+
      (title?' title="'+esc(title)+'"':'')+'>'+esc(label)+
      (badge?'<span class="btn-badge" aria-hidden="true">'+esc(badge)+'</span>':'')+'</button>';
    /* 6 颗常规设置键 + 跳过显示 + 调试面板 = 8 颗，排成两排（4 列 × 2 行）。
     * 颜色沿用原版口径：未选中/普通动作是金色，已开启（如全面屏）才是绿色。
     * ⚠ 「调试所得」**始终显示**：没有账本时也要能看到入口并读到「为什么没有」，
     *   不能因为索引为空就把整个选项藏掉（用户 2026-10 反馈系统页看不到重置调试）。 */
    const dbgSum = State.debugLedgerSummary ? State.debugLedgerSummary() : null;
    const dbgBtn = sysBtn('调试面板', 'debug-ledger', 'gold',
      '查看调试面板发放过的物品索引，并只回收还能定位到的调试部分；自己打出来的物品按基线保留',
      (dbgSum && dbgSum.removable) ? String(dbgSum.removable) : '');
    /* 界面模式单独摘成一张卡：两套界面是两套独立存档，属于会改变整个游戏观感与进度的
     * 大动作，不能和导出/分辨率这些工具键混在 4×2 网格里。卡片同时写清「当前模式」
     * 和「下一步切到哪个」，避免玩家只看到一行字不知道点下去会发生什么。 */
    const modeNow = uiModeLabel(currentUiMode());
    const modeNext = uiModeLabel(nextUiMode());
    const modeCard = '<section class="settings-mode-card" aria-label="界面模式">' +
      '<div class="settings-mode-copy">' +
        '<span class="settings-mode-kicker">界面模式</span>' +
        '<strong class="settings-mode-name">当前：' + esc(modeNow) + '</strong>' +
        '<span class="settings-mode-note">经典 / 现代两套界面使用独立存档，切换即时生效；' +
          '会载入「' + esc(modeNext) + '」界面的进度。</span>' +
      '</div>' +
      '<button type="button" class="uc-button gold settings-mode-btn" data-action="uimode" title="切换到' + esc(modeNext) + '界面">' +
        '切到' + esc(modeNext) + '<span class="settings-mode-arrow" aria-hidden="true">›</span>' +
      '</button>' +
    '</section>';
    /* 移走界面模式后，8 颗设置键排成 4×2：第一排存档/昵称/跳过，第二排画面/调试。 */
    const showSkip = st.showSkip !== false;
    const skipTitle = '当前：' + (showSkip ? '开' : '关') +
      '。关闭后战斗右下角不再显示「跳过」键；跳过解锁条件仍按超级松鼠页：VIP ' +
      (State.VIP_SKIP_UNLOCK_LEVEL || 10) + ' 级、非 VIP ' + (State.SKIP_UNLOCK_LEVEL || 20) + ' 级。';
    const grid='<div class="settings-grid system-grid">'+
      sysBtn('存档导出','export','gold','把当前存档导出成一个 JSON 文件。iOS 在「文件」App → 我的 iPhone/iPad → 松鼠大战；桌面写系统下载目录。')+
      sysBtn('存档导入','import','gold','从 JSON 文件恢复存档。iOS 用「存档列表」选 App 里的导出，或粘贴存档文本。')+
      sysBtn('修改昵称','rename','gold','给松鼠换个名字')+
      sysBtn('跳过按钮','skip-display','gold'+(showSkip?' on':''), skipTitle, showSkip?'开':'关')+
      sysBtn('分辨率','resolution','gold','当前：'+resShort(resNow)+'。点一下换下一档：'+
        resolutions.map((r)=>r.label).join(' → ')+'。画面按这一档等比缩放并居中；窗口装不下时自动按窗口缩小，不会溢出。',
        resShort(resNow))+
      sysBtn('全面屏','fullscreen','gold'+(st.fullscreen?' on':''),'当前：'+(st.fullscreen?'开':'关')+'。开启后画面铺满整个窗口（不留黑边，窗口比例差得多时会有轻微拉伸），同时尝试进入系统全屏；按 Esc 可退出系统全屏。',
        st.fullscreen?'开':'关')+
      sysBtn('状态栏','statusbar','gold'+(st.hideStatusBar !== false?' on':''),'当前：'+(st.hideStatusBar !== false?'隐藏':'显示')+'。安卓沉浸模式：隐藏手机顶部状态栏，游戏画面更完整；桌面/网页没有系统状态栏，这个开关无副作用。',
        st.hideStatusBar !== false?'隐藏':'显示')+
      dbgBtn+
      '</div>';
    const webMode = !!window.__SSDZ_WEB_MODE__;
    const p=page('system','system',supportPanelHtml()+'<div class="settings-head"><h3 class="classic-section-title">游戏设置</h3>'+slider+'</div>'+modeCard+grid+saveFilePanel()+(webMode?'':syncPanel())+(webMode?'':updatePanelHtml()));
    /* 系统页按钮统一走经典反馈：菜单项/设置键/底栏都先弹一下再执行。 */
    $('[data-action="support"]',p).onclick=()=>openSupportModal();
    $('[data-action="uimode"]',p).onclick=()=>requestMode(nextUiMode());
    const dbgLedgerBtn=$('[data-action="debug-ledger"]',p);
    if(dbgLedgerBtn)dbgLedgerBtn.onclick=openDebugLedger;
    const saveWriteBtn=$('[data-action="save-write"]',p);
    if(saveWriteBtn)saveWriteBtn.onclick=async()=>{const r=await State.fileWriteNow();toast(r.msg||(r.ok?'已写入':'写入失败'));openSystem();};
    const saveLoadBtn=$('[data-action="save-load"]',p);
    if(saveLoadBtn)saveLoadBtn.onclick=loadSaveDialog;
    /* 系统页开关：只控制战斗里跳过键的显示；等级/VIP 解锁条件不变。 */
    $('[data-action="skip-display"]',p).onclick=()=>{
      const cur = State.settings().showSkip !== false;
      State.setSettings({showSkip: !cur});
      openSystem();
    };
    /* 从服务器存档列表导入：绕过系统文件选择器（桌面壳里也能用），列表里带等级与时间。 */
    const saveListBtn=$('[data-action="save-import-list"]',p);
    if(saveListBtn)saveListBtn.onclick=async()=>{
      let list=[];
      try{const r=await fetch('/__saves',{cache:'no-store'});const j=await r.json();list=(j&&j.saves)||[];}
      catch(e){toast('读不到存档列表：本地服务器没开？');return;}
      if(!list.length){toast('save/ 与 save/backup/ 里没有可用存档');return;}
      saveListDialog(list, async (it)=>{
        try{
          const r=await fetch('/__saves/get?rel='+encodeURIComponent(it.rel),{cache:'no-store'});
          if(!r.ok)throw new Error('读不到文件');
          const raw=await r.text();const data=JSON.parse(raw);
          const bad = saveDataError(data);
          if (bad) throw new Error(bad + '，不是有效存档');
          await applyImportedSave(raw, data);
        }catch(e){toast(e.message||'导入失败');}
      });
    };
    /* 游戏更新：来源按钮 → 确认 → 执行；结果里的「立即刷新」用 location.reload() */
    const updBtn=(action,fn)=>{const b=$('[data-action="'+action+'"]',p);if(b)b.onclick=fn;};
    updBtn('update-check',()=>updateCheck());
    updBtn('update-source-sync',()=>updateAsk('sync'));
    updBtn('update-source-release',()=>updateAsk('release'));
    updBtn('update-source-git',()=>updateAsk('git'));
    updBtn('update-confirm',()=>updateRun(updState.pending));
    updBtn('update-cancel',()=>{updState.pending=null;openSystem();});
    updBtn('update-reload',()=>{try{location.reload();}catch(e){}});
    updBtn('update-page',()=>openSupportLink(UPDATE_PAGE));
    const syncBtn=(action,fn)=>{const b=$('[data-action="'+action+'"]',p);if(b)b.onclick=fn;};
    /* 四个按钮都先过二级确认（syncAsk）：弹窗里识别完「会改什么」，确认后才真正 syncRun。 */
    syncBtn('sync-save-push',()=>syncAsk('save','push'));
    syncBtn('sync-save-pull',()=>syncAsk('save','pull'));
    syncBtn('sync-files-push',()=>syncAsk('files','push'));
    syncBtn('sync-files-pull',()=>syncAsk('files','pull'));
    // 进度区里的按钮是每次重绘 innerHTML 生成的，用事件委托挂，避免重绘后失效
    const syncPanelEl=$('.sync-panel',p);
    if(syncPanelEl)syncPanelEl.addEventListener('click',(ev)=>{
      const t=ev.target&&ev.target.closest?ev.target.closest('[data-action="sync-force"]'):null;
      if(!t||!syncState.result)return;
      // 强制覆盖也走二级确认：弹窗里会标明「这次是强制」，避免误触
      syncAsk(syncState.result.kind,syncState.result.dir,true);
    });
    syncBtn('sync-discover',async()=>{
      toast('正在扫描 ZeroTier 网段…');
      try{await syncFetch('/local/discover',{timeout:30000});}catch(e){toast(String((e&&e.message)||e));}
      syncState.checked=false;
      if(screen==='system')openSystem();
    });
    syncBtn('sync-recheck',()=>{syncState.checked=false;syncState.ok=false;syncState.info=null;openSystem();});
    // 音乐：点胶囊开关音乐；滑条仍然拖动连续调节，拖到 0 等同静音、拉回来自动取消静音。
    const musicRow=$('.music-setting',p), musicToggle=$('.music-toggle',p),
      value=$('.music-setting .slider-value',p), hint=$('.music-setting .music-hint',p),
      range=$('.music-setting input',p);
    const syncMusicState=()=>{
      const running=!(Main.isMuted&&Main.isMuted()) && ((Main.volume&&Main.volume())||0)>0;
      const pct=Math.round(100*((Main.volume&&Main.volume())||0));
      if(musicRow)musicRow.classList.toggle('on',running);
      if(musicToggle)musicToggle.setAttribute('aria-pressed',String(running));
      if(value)value.textContent=running?pct+'%':'已静音';
      if(hint)hint.textContent=running?'点击开关':'点击开启';
    };
    fillRange(range);
    if(musicRow)musicRow.addEventListener('click',(ev)=>{
      if(ev.target&&ev.target.closest&&ev.target.closest('input'))return;
      Main.setMuted(!(Main.isMuted&&Main.isMuted()));
      openSystem();
    });
    if(range){
      range.oninput=()=>{
        const v=Main.setVolume(Number(range.value)/100);
        if(value)value.textContent=Math.round(100*v)+'%';
        fillRange(range);
        syncMusicState();
      };
      range.onchange=()=>{
        const v=Math.round(100*((Main.volume&&Main.volume())||0));
        const on=!(Main.isMuted&&Main.isMuted());
        syncMusicState();
        toast('音乐音量 '+v+'%'+(!on?'（已静音）':'')+'（已存进存档）');
      };
    }
    // 分辨率：点一下换下一档（循环），改完立刻生效并写进存档，页面重绘让按钮文字跟上
    const resBtn=$('[data-action="resolution"]',p);
    if(resBtn)resBtn.onclick=()=>{const next=resolutions[(resIndex+1)%resolutions.length];Main.setResolution(next.key);openSystem();};
    const fsBtn=$('[data-action="fullscreen"]',p);
    if(fsBtn)fsBtn.setAttribute('data-fullscreen','1');
    if(fsBtn)fsBtn.onclick=()=>{Main.setFullscreen(!Main.settings().fullscreen);openSystem();};
    const sbBtn=$('[data-action="statusbar"]',p);
    if(sbBtn)sbBtn.onclick=()=>{if(Main.setHideStatusBar)Main.setHideStatusBar(!(Main.settings().hideStatusBar!==false));openSystem();};
    $('[data-action="export"]',p).onclick=exportSaveFile;
    $('[data-action="import"]',p).onclick=importSave;
    $('[data-action="rename"]',p).onclick=()=>{
      const m=modal('修改昵称','<p>给你的松鼠起个名字</p><input id="rename-input" maxlength="12" value="'+esc(State.state().name)+'" style="width:100%;padding:14px;border:3px solid #b39763;border-radius:18px;color:#715231;background:#fffdf1">',[{label:'确定',close:false,run:()=>{const name=$('#rename-input',m.element).value.trim();if(!name){toast('名字不能为空');return;}State.state().name=name;State.save();m.close();refreshHome();}},{label:'返回',cls:'muted'}],{small:true});
    };
    wireSystemFeedback(p);
  }
  /** 导出存档。
   *  - 安卓（Tauri WebView）优先走 Kotlin 注入的 `SSDZAndroid`：**所有受支持的 Android 版本**
   *    都写系统「下载」目录（10+ 走 MediaStore；9 及以下申请存储权限后写公共 Download），
   *    避免 WebView 默认落到 `/data/user/0/com.ssdz.classic/...` 这种玩家打不开的私有路径；
   *  - Windows / 浏览器 / 桌面壳仍用原来的 Blob 下载（浏览器下载目录）。
   *  安卓桥失败时退回 Blob，并明确提示“可能落在应用私有目录”，不让导出静默失败。 */
  /** 当前是不是 iOS / iPadOS（Tauri WKWebView）。iPadOS 13+ 的 UA 可能伪装成 Macintosh，
   *  用 `maxTouchPoints > 1` 兜住；只用于选择导出/导入的文案与兜底路径，不参与存档规则。 */
  function iosClient() {
    try {
      const ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
      if (/iPhone|iPad|iPod/i.test(ua)) return true;
      return String(navigator.platform || '') === 'MacIntel' && Number(navigator.maxTouchPoints) > 1;
    } catch (e) { return false; }
  }
  /** 复制大段文本（存档 JSON 可能几百 KB）：Clipboard API 失败时退回
   *  「textarea + execCommand」；支持 iOS WKWebView 的旧实现。返回 Promise<boolean>。 */
  function copySaveText(text) {
    const fallback = () => {
      try {
        const el = document.createElement('textarea');
        el.value = text; el.setAttribute('readonly', 'readonly');
        el.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
        document.body.appendChild(el); el.select(); el.setSelectionRange(0, el.value.length);
        const ok = document.execCommand('copy');
        el.remove();
        return !!ok;
      } catch (e) { return false; }
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).then(() => true, fallback);
      }
    } catch (e) { /* 落回 execCommand */ }
    return Promise.resolve(fallback());
  }
  /** iOS 分享面板：把存档作为 .json 分享到「文件」/隔空投送/其它 App。
   *  不支持（旧 WKWebView / 非安全上下文）时返回 false，由调用方给复制兜底。 */
  async function shareSaveFile(fileName, text) {
    try {
      if (!navigator.share || typeof File !== 'function') return false;
      const file = new File([text], fileName, { type: 'application/json' });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
      await navigator.share({ files: [file], title: '松鼠大战存档' });
      return true;
    } catch (e) { return false; }
  }
  function exportFileName() {
    /* 带秒，避免同一天导出第二次时在下载目录里重名；用本地时间，别在午夜附近把日期写错。 */
    const d = new Date(Date.now()), two = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) +
      '-' + two(d.getHours()) + '-' + two(d.getMinutes()) + '-' + two(d.getSeconds());
    return '松鼠大战存档-' + stamp + '.json';
  }
  /** 调安卓导出桥。返回 {status:'ok'|'permission'|'error'|'missing', path?, msg?}。 */
  function bridgeSave(fileName, text) {
    const bridge = window.SSDZAndroid;
    if (!bridge || typeof bridge.saveToDownloads !== 'function') return { status: 'missing' };
    try {
      const raw = bridge.saveToDownloads(fileName, text);
      const r = JSON.parse(String(raw || '{}'));
      if (r && r.ok) return { status: 'ok', path: r.path || '系统下载目录' };
      if (r && r.needPermission && typeof bridge.requestStoragePermission === 'function') {
        return { status: 'permission', msg: r.msg || '需要存储权限' };
      }
      return { status: 'error', msg: (r && r.msg) || '无法写入系统下载目录' };
    } catch (e) {
      return { status: 'error', msg: (e && e.message) || String(e) };
    }
  }
  /** 当前环境可用的 Tauri invoke（没有就返回 null）。
   *  iOS 的导入/导出都只认原生命令：WKWebView 在 iOS 16~24 上不会弹文件选择器，
   *  `tauri.localhost` 也没有 `/__save`、`/__export` 这些 HTTP 接口。 */
  function nativeInvoke() {
    const internals = window.__TAURI_INTERNALS__;
    const T = window.__TAURI__;
    return (internals && typeof internals.invoke === 'function')
      ? internals.invoke.bind(internals)
      : (T && T.core && typeof T.core.invoke === 'function' ? T.core.invoke.bind(T.core) : null);
  }
  /** 桌面壳导出：安装版走 Tauri 命令 `export_save`，便携轻壳走本地服务器 `/__export`。
   *  浏览器（没有 Tauri 内建对象）返回 missing，交给原来的 Blob 下载。 */
  async function nativeSave(fileName, text) {
    const host = String((location && location.hostname) || '').toLowerCase();
    const port = String((location && location.port) || '');
    const ownServer = (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') && !!port;
    const invoke = nativeInvoke();
    /* iOS 只有原生命令这一条路：`tauri.localhost` 没有 /__export，WKWebView 的
     * `<a download>` 也不可靠。放在 ownServer 判断之前，避免测试/开发用 127.0.0.1
     * 打开时误走轻壳的 HTTP 导出。 */
    if (iosClient()) {
      if (!invoke) return { status: 'missing' };
      try {
        const r = await invoke('export_save', { fileName, data: text });
        if (r && r.ok) return { status: 'ok', path: r.path || 'App 的 Documents 目录',
          display: r.display || '', name: r.name || fileName };
        return { status: 'error', msg: (r && r.msg) || '写入「文件」App 失败' };
      } catch (e) {
        return { status: 'error', msg: (e && e.message) || String(e) };
      }
    }
    if (ownServer) {
      /* 轻壳：页面来自 127.0.0.1，Tauri IPC 会被 ACL 拒；只有 Tauri 内建对象存在时才走
       * /__export（普通浏览器 + serve.js 没有这个接口，仍然用 Blob）。 */
      if (!invoke) return { status: 'missing' };
      try {
        const resp = await fetch('/__export?name=' + encodeURIComponent(fileName), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text,
        });
        let j = null;
        try { j = await resp.json(); } catch (e) {}
        if (j && j.ok) return { status: 'ok', path: j.path || '系统下载目录' };
        return { status: 'error', msg: (j && j.msg) || ('HTTP ' + resp.status) };
      } catch (e) {
        return { status: 'error', msg: (e && e.message) || String(e) };
      }
    }
    if (invoke) {
      try {
        const r = await invoke('export_save', { fileName, data: text });
        if (r && r.ok) return { status: 'ok', path: r.path || '系统下载目录',
          display: r.display || '', name: r.name || fileName };
        return { status: 'error', msg: (r && r.msg) || '写入下载目录失败' };
      } catch (e) {
        return { status: 'error', msg: (e && e.message) || String(e) };
      }
    }
    return { status: 'missing' };
  }
  /** iOS 的导出完成提示：给出「文件」App 里的准确位置，并保留分享/复制两条转存路径。 */
  function showIOSExportDone(result, fileName, text) {
    const where = result.display || ('「文件」App → 我的 iPhone/iPad → 松鼠大战 → ' + (result.name || fileName));
    modal('存档已导出', '<p style="white-space:pre-line">' +
      esc('存档已导出到：\n' + where + '\n\n导入时点「导入」→「存档列表」，在里面选这份 .json。') +
      '</p>', [
      { label: '分享', run: () => {
        void shareSaveFile(fileName, text).then((ok) => {
          if (!ok) toast('当前环境不支持系统分享，可以改用「复制」');
        });
      } },
      { label: '复制', run: () => {
        void copySaveText(text).then((ok) => toast(ok ? '存档全文已复制' : '复制失败，请手动选中复制'));
      } },
      { label: '确定', cls: 'gold' },
    ], { small: true });
  }
  /** iOS 导出失败 / 没有原生通道时的兜底：不依赖 `<a download>`（WKWebView 经常没反应），
   *  改为系统分享 + 复制全文。 */
  function showIOSExportFallback(fileName, text, result) {
    const why = result && result.status === 'error' && result.msg
      ? '写入「文件」App 失败：' + result.msg
      : '当前环境没有可用的「文件」App 导出接口。';
    modal('导出存档', '<p style="white-space:pre-line">' +
      esc(why + '\n\n可以改用下面的方式转存，再在新设备上点「导入」→「粘贴」。') +
      '</p>', [
      { label: '分享', run: () => {
        void shareSaveFile(fileName, text).then((ok) => {
          if (!ok) toast('当前环境不支持系统分享，可以改用「复制」');
        });
      } },
      { label: '复制', run: () => {
        void copySaveText(text).then((ok) => toast(ok ? '存档全文已复制' : '复制失败，请手动选中复制'));
      } },
      { label: '关闭', cls: 'muted' },
    ], { small: true });
  }
  /** 桥不可用/失败时的兜底：桌面/浏览器仍用 Blob 下载；iOS 不赌 `<a download>`。 */
  function exportFallback(fileName, text, result) {
    if (iosClient()) { showIOSExportFallback(fileName, text, result); return; }
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(result && result.status === 'error'
      ? '下载目录写入失败（' + result.msg + '），已改用浏览器下载；文件可能在应用私有目录。'
      : '当前环境没有下载目录接口，已用浏览器下载。');
  }
  async function exportSaveFile() {
    const S = State.state();
    if (!S) { toast('还没有存档可以导出'); return; }
    const text = JSON.stringify(S, null, 2);
    const fileName = exportFileName();
    const android = bridgeSave(fileName, text);
    if (android.status === 'ok') { toast('存档已导出到 ' + android.path); return; }
    if (android.status === 'permission') {
      /* Android 9 及以下：写公共「下载」目录要先申请存储权限。系统弹窗授权后自动重试一次，
       * 不让玩家在“允许权限”和“再点一次导出”之间来回找。 */
      window.__SSDZAndroidStoragePermission = (granted) => {
        try { delete window.__SSDZAndroidStoragePermission; } catch (e) {}
        if (!granted) { exportFallback(fileName, text, { status: 'error', msg: '没有存储权限' }); return; }
        const again = bridgeSave(fileName, text);
        if (again.status === 'ok') toast('存档已导出到 ' + again.path);
        else exportFallback(fileName, text, again);
      };
      try { window.SSDZAndroid.requestStoragePermission(); } catch (e) {}
      toast('请在系统弹窗里允许「存储」权限，允许后会自动继续导出');
      return;
    }
    const native = await nativeSave(fileName, text);
    if (native.status === 'ok') {
      if (iosClient()) showIOSExportDone(native, fileName, text);
      else toast('存档已导出到 ' + (native.display || native.path));
      return;
    }
    exportFallback(fileName, text, native.status === 'error' ? native : android);
  }
  /** 自动存档导出：把当前进度写一份**固定文件名**的副本到系统下载目录（覆盖上一份）。
   *  触发点：安卓壳切后台（MainActivity.onPause → window.__ssdzAutoExportSave）、
   *  页面隐藏，以及每 5 分钟兜底一次。同一份进度只写一次，没变化的定时器不会反复刷盘。
   *  老系统还没授权时不在这里弹窗，等玩家点「导出存档」再走授权流程。 */
  let lastAutoExportSig = 0;
  function autoExportSave() {
    const bridge = window.SSDZAndroid;
    if (!bridge || typeof bridge.saveAutoBackup !== 'function' || !window.State) return false;
    let S;
    try { S = State.state(); } catch (e) { return false; }
    if (!S) return false;
    const sig = Number(S.savedAt) || 0;
    if (sig && sig === lastAutoExportSig) return true;
    try {
      const raw = bridge.saveAutoBackup(JSON.stringify(S, null, 2));
      const r = JSON.parse(String(raw || '{}'));
      if (r && r.ok) { lastAutoExportSig = sig; return true; }
    } catch (e) { /* 自动导出失败不打扰玩家；手动导出会把原因显示出来 */ }
    return false;
  }
  try {
    window.__ssdzAutoExportSave = autoExportSave;
    window.addEventListener('pagehide', () => { try { autoExportSave(); } catch (e) {} });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { try { autoExportSave(); } catch (e) {} }
    });
    setInterval(() => { try { autoExportSave(); } catch (e) {} }, 5 * 60 * 1000);
  } catch (e) {}
  /** iOS：不经过 WKWebView 的文件选择器，直接列出 App「文件」里的导出存档。
   *  原因：wry 只在 macOS 实现 `runOpenPanelWithParameters`，iOS 16~24 的
   *  `<input type=file>` 点下去没有系统面板，玩家会以为按钮坏了。导出本来就写在
   *  App 的 Documents（「文件」App → 我的 iPhone/iPad → 松鼠大战），原生读回来即可。 */
  async function openIOSExportList() {
    const invoke = nativeInvoke();
    if (!invoke) { toast('原生存档接口还没就绪，请稍后再试'); return; }
    let r = null;
    try { r = await invoke('list_save_files'); }
    catch (e) {
      notice('读取导出列表失败：' + ((e && e.message) || e) + '\n\n可以改用「粘贴」导入。',
        [{ label: '粘贴', cls: 'gold', run: () => importSaveFromPaste() },
          { label: '返回', cls: 'muted' }]);
      return;
    }
    const files = (r && Array.isArray(r.files)) ? r.files : [];
    if (!files.length) {
      notice('「文件」App 里还没有导出存档。\n\n请先在系统页点「导出」；也可以返回用「粘贴」导入。',
        [{ label: '粘贴', cls: 'gold', run: () => importSaveFromPaste() },
          { label: '返回', cls: 'muted' }]);
      return;
    }
    saveListDialog(files.map((f) => ({
      name: String(f.player || f.name || '无名'),
      level: Number(f.level) || 0,
      at: Number(f.modified) || 0,
      size: Number(f.size) || 0,
      file: String(f.name || ''),
      valid: f.valid !== false,
    })), async (it) => {
      try {
        const rr = await invoke('read_save_file', { name: it.file });
        if (!rr || rr.ok === false) throw new Error((rr && rr.msg) || '读取存档失败');
        askImportSave(String(rr.data == null ? '' : rr.data), '文件');
      } catch (e) { toast((e && e.message) || '读取存档失败'); }
    }, '共 ' + files.length + ' 份导出存档。导入前会先把当前进度导出到「文件」App 作为备份。');
  }
  /** 导入入口：iOS 用原生导出列表 / 粘贴；其它平台用文件选择器 / 粘贴。 */
  function importSave() {
    const ios = iosClient();
    const webMode = !!window.__SSDZ_WEB_MODE__;
    const info = State.fileInfo ? State.fileInfo() : {};
    const hasNative = !!nativeInvoke();
    const shell = inTauriShell();
    const body = '<p>从导出的 .json 文件恢复进度。</p>' +
      (webMode
        ? '<p class="small-label">网页版：点「选文件」从「文件」App 选救援/导出的 .json；' +
          '也可以「粘贴」存档文本。导入会覆盖这个浏览器里的当前档。</p>'
        : (ios && hasNative
          ? '<p class="small-label">iOS：点「存档列表」选 App 导出的存档（「文件」App → 我的 iPhone/iPad → 松鼠大战），' +
            '或者用「粘贴」。</p>'
          : (ios && shell
            ? '<p class="small-label">iOS 安装包的存档接口还没就绪。请稍后重试，或先用「粘贴」导入。</p>'
            : (info && info.path ? '<p class="small-label">当前正式存档：' + esc(info.path) + '</p>' : '') +
              '<p class="small-label">文件选择器打不开时，用「粘贴」。</p>')));
    const buttons = [];
    if (ios && hasNative) buttons.push({ label: '存档列表', cls: 'gold', run: () => openIOSExportList() });
    else if (!ios || !shell) buttons.push({ label: '选文件', cls: 'gold', run: () => pickAndImportSave() });
    buttons.push({ label: '粘贴', cls: (ios && !hasNative) ? 'gold' : '', run: () => importSaveFromPaste() });
    buttons.push({ label: '取消', cls: 'muted' });
    modal('导入存档', body, buttons, { small: true });
  }
  /** 选本地 .json 并走统一校验；取消选择时什么都不做。 */
  function pickAndImportSave() {
    void pickJsonFile().then(async (file) => {
      if (!file) return;                       // 用户取消
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('存档文件过大（上限 8 MB）');
        const raw = await readFileText(file);
        askImportSave(raw, '文件');
      } catch (e) { toast(e.message || '无法读取存档'); }
    });
  }
  /** 校验一份导入原文并弹确认。文件和粘贴两条入口共用，避免两份规则漂移。
   *  校验失败抛错，由调用方 toast。 */
  function askImportSave(raw, source) {
    let data;
    try { data = JSON.parse(String(raw || '').replace(/^\uFEFF/, '')); } catch (e) { throw new Error('这个文件不是合法的 JSON'); }
    const bad = saveDataError(data);
    if (bad) throw new Error(bad + '，不是有效的松鼠大战存档');
    const info = State.fileInfo ? State.fileInfo() : {};
    const nowLevel = (State.state() || {}).level;
    const ios = iosClient();
    const webMode = !!window.__SSDZ_WEB_MODE__;
    const where = webMode
      ? '会覆盖这个浏览器/主屏幕应用里的当前存档（旧档先留在 localStorage 备份键里）'
      : (info.mode === 'file'
        ? (ios
          ? '会覆盖 App 的正式存档（旧档会先导出到「文件」App → 我的 iPhone/iPad → 松鼠大战）'
          : '会覆盖磁盘上的正式存档 ' + (info.path || 'save/progress.json') + '（旧档先自动备份到 save/backup/）')
        : '会覆盖这个浏览器里的兜底存档（旧档先留在 localStorage 备份键里）');
    notice('导入【' + data.name + '】' + data.level + ' 级的存档？\n\n' + where +
      (nowLevel ? '。当前进度：' + nowLevel + ' 级。' : '。') +
      (source === '粘贴' ? '\n\n来源：粘贴的存档文本。' : ''),
      [{ label: '导入', run: async () => {
        try { await applyImportedSave(raw, data); }
        catch (e) { toast(e.message || '导入失败'); }
      } }, { label: '取消', cls: 'muted' }]);
  }
  /** iOS 兜底：直接粘贴存档 JSON。WKWebView 的文件选择器失灵时仍能恢复进度。 */
  function importSaveFromPaste() {
    const m = modal('粘贴文本',
      '<p class="small-label">把导出的存档 JSON 全文粘贴到下面（以 <b>{</b> 开头）。</p>' +
      '<textarea id="save-paste-input" spellcheck="false" autocomplete="off" ' +
      'style="width:100%;height:190px;box-sizing:border-box;resize:vertical;border:3px solid #b39763;' +
      'border-radius:16px;background:#fffdf1;color:#715231;font:18px/1.5 ui-monospace,Menlo,monospace;padding:12px" ' +
      'aria-label="存档 JSON 文本"></textarea>',
      [
        { label: '粘贴', close: false, run: async () => {
          try {
            if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
              throw new Error('当前环境不支持读取剪贴板');
            }
            const text = await navigator.clipboard.readText();
            const ta = m.element.querySelector('#save-paste-input');
            if (!text) { toast('剪贴板是空的'); return; }
            if (ta) ta.value = text;
            toast('已从剪贴板粘贴');
          } catch (e) { toast('无法读取剪贴板，请长按输入框手动粘贴'); }
        } },
        { label: '导入', close: false, run: () => {
          try {
            const ta = m.element.querySelector('#save-paste-input');
            const raw = String((ta && ta.value) || '').trim();
            if (!raw) { toast('请先粘贴存档文本'); return; }
            askImportSave(raw, '粘贴');
            m.close();
          } catch (e) { toast(e.message || '存档格式不对'); }
        } },
        { label: '取消', cls: 'muted' },
      ], { small: true });
    m.element.classList.add('save-paste-dialog');
    setTimeout(() => { try { const ta = m.element.querySelector('#save-paste-input'); if (ta) ta.focus(); } catch (e) {} }, 0);
  }

  /** 村庄里那几处地点点进去的**去处**。
   *  【第一百四十七批】当时以为原版那四页提不出来（"在 26MB 导出里连这些名字都搜不到"），
   *  于是各自路由到复刻里语义最接近的已有页面（祭坛→竞技场 / 幻兽→融合 / 神迹→抽奖 / 征战→关卡）。
   *  【第一百四十九批】**纠正**：那是**按中文名**搜的，而导出字典只按 **id** 存 ——
   *  三颗库元件其实完整地躺在整片导出里（「家园弹出」3957 / 「幻兽牧场」4381 / 「征战」3437，
   *  闭包 0 缺失）。现在经典模式下四个地点**各自进原版那一页**
   *  （见 js/ssfight/ui-village.js；素材包 tags-homeland / tags-summons / tags-campaign）。
   *  ⚠ 幻兽与征战那两页的**功能**还没接（复刻没有召唤兽 / 征战令这两套数据），
   *    页面上会有一条说明；非经典模式仍走下面这几条老路由。 */
  function openVillageScene(key, fallbackAction) {
    /* 新手引导：点地点就是完成当前村庄步骤（f17/f19/f20/f26 对应的 nowPage），先通知再切页。 */
    if (window.SfGuide) { try { SfGuide.onPage(key); } catch (e) {} }
    if (currentUiMode() === 'classic' && window.SfVillage) {
      $('#ui').innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠村庄·' + key + '"></section>';
      /* 从塔页（#ui 按 690 高）回来时，这里必须重新按原版 320×196 量一次；
       * 否则地点页的 SVG 只按高度铺满，左右会各空一条。 */
      if (window.Main?.resizeLayout) Main.resizeLayout();
      const box = $('#ui .ssfight-home');
      if (box) {
        SfVillage.open(box, key).catch((e) => {
          if (window.__errs) window.__errs.push('SfVillage(' + key + '): ' + e.message);
          fallbackAction();
        });
        return;
      }
    }
    fallbackAction();
  }
  function villageBuildingLock(key, label) {
    if (!(window.State && State.buildingUnlocked) || State.buildingUnlocked(key)) return '';
    return label + '需要达到 ' + (State.buildingUnlockLevel ? State.buildingUnlockLevel(key) : '') + ' 级才能使用。';
  }
  function villageAltar() {
    const lock = villageBuildingLock('altar', '祭坛');
    if (lock) { notice(lock); return; }
    openVillageScene('village-altar', () => fallback('arena'));
  }
  function villageBeast() {
    const lock = villageBuildingLock('beast', '幻兽牧场');
    if (lock) { notice(lock); return; }
    openVillageScene('village-beast', () => openMerge());
  }
  function villageMiracle() {
    const lock = villageBuildingLock('miracle', '神迹');
    if (lock) { notice(lock); return; }
    openVillageScene('village-miracle', () => fallback('lottery'));
  }
  /* ⑧ 村庄「征战」：原版那一套是**四人组队 + 服务端开房**
   * 的玩法（界面元件「征战」在导出里没有 spriteId、"四人同时在线"在离线单机里没有对应物），
   * 复刻不做。
   * ------------------------------------------------------------
   * 用户 2026-10 口径（本批）："点开村庄的征战界面时，我希望单独做一个挑战塔与无尽塔的界面，
   * 不要套用现代 ui 的背景等，就做一个小的弹出界面即可，两个模式的 ui 就用现代版的 ui 即可。"
   * 所以这里**不再进 `ClassicExtras.campaign()`**（那是一整页现代外壳 + 现代背景，
   * 点下去整块经典村庄页就被换掉了），改成在**当前经典村庄页上盖一个小弹窗** ——
   * 用的就是复刻经典 UI 自己那套 `.classic-modal`（战果/提示弹窗同一个），
   * 底下的村庄页原样留着；两颗键直接调现代版的塔入口
   * （`TowerUI.openTower()` / `TowerUI.openEndless()`，也就是关卡页那两颗
   * `[data-action="tower-entry"]` / `[data-action="endless-entry"]` 进去的界面）。
   * 门槛照现代入口那一份（`Tower.unlocked()`：通关前 18 关），不另立一套。 */
  function villageWar() {
    const S = State.state();
    const levelNeed = Number(State.WAR_UNLOCK_LEVEL) || 35;
    if (Number(S && S.level) < levelNeed) { notice('征战需要达到 ' + levelNeed + ' 级才能使用。'); return; }
    const lock = (window.Tower && Tower.unlocked && window.TowerUI)
      ? Tower.unlocked() : { ok: false, msg: '挑战塔系统尚未就绪。' };
    if (!lock.ok) { notice(lock.msg); return; }
    const ti = (Tower.towerInfo ? Tower.towerInfo() : null) || { maxLayer: 0, nextLayer: 1, gold: 0 };
    const ei = (Tower.endlessInfo ? Tower.endlessInfo() : null) || { best: 0, bestLayer: 0, tickets: 0 };
    const body =
      '<p><b>挑战塔</b>：一层一层往上打，每层三选一的增益，通关发金松果。<br>' +
      '已通关 ' + (ti.maxLayer | 0) + ' 层 · 下一层 ' + (ti.nextLayer | 0) + '（挑战书 ×1 → 金松果 ' + (ti.gold | 0) + '）</p>' +
      '<p><b>无尽塔</b>：免门票的无尽模式，越往上敌人越强。<br>' +
      '最高分 ' + (ei.best | 0) + ' · 最深 ' + (ei.bestLayer | 0) + ' 层（现有抽奖卷 ' + (ei.tickets | 0) + ' 张）</p>' +
      '<p class="small-label">两座塔都是离线单人玩法，不需要队友。</p>';
    const m = modal('征战', body, [
      { label: '挑战塔', run: () => { if (window.TowerUI) TowerUI.openTower({ from: 'village' }); } },
      { label: '无尽塔', cls: 'gold', run: () => { if (window.TowerUI) TowerUI.openEndless({ from: 'village' }); } },
    ], { small: true });
    /* 用户口径：这两颗是这一屏唯一的去路，做得比普通弹窗按钮大一档
     *（宽度/高度/字号都在 classic-refine.css 的 `.campaign-dialog` 里）。 */
    if (m && m.element) m.element.classList.add('campaign-dialog');
  }
  function openVillage() {
    /* 经典模式 + ssflight 素材可用时，进**原版真正的村庄页**（根时间轴帧 30 / homeMc 7140）：
      原版点「村庄」进的就是它 —— 四处地点 + 自己的底栏四键 + 左上角「回家」。
      素材在 tags-home.json，只有真进来才加载（见 js/ssfight/ui-main.js 的 mountVillage）。
      ⚠ 先收掉可能开着的**地点场景页**（祭坛/神迹/…）：场景页与村庄页共用同一个 `#ui`，
      不收的话 `SfVillage.current()` 会一直指着那棵已经被换掉的树。 */
    if (currentUiMode() === 'classic' && window.SfUiMain && SfUiMain.mountVillage) {
      if (window.SfVillage) { try { SfVillage.destroy(); } catch (e) {} }
      $('#ui').innerHTML = '<section class="classic-home ssfight-home" aria-label="松鼠村庄"></section>';
      /* 同 openVillageScene：从塔页回来时先把 #ui 的高度切回村庄页，
       * 再异步挂 SVG；不然村庄立绘会按 690 高算宽度，左右出现黑边。 */
      if (window.Main?.resizeLayout) Main.resizeLayout();
      const box = $('#ui .ssfight-home');
      if (box) {
        SfUiMain.mountVillage(box).catch((e) => { if (window.__errs) window.__errs.push('mountVillage: ' + e.message); });
        return;
      }
    }
    // 村庄里的选项统一用金黄色（原先是黄绿混着填的，看着花）
    const p=page('system','village','<div class="settings-grid">'+btn('师徒','master','gold')+btn('竞技场','arena','gold')+btn('天梯赛','rank','gold')+btn('道具商店','shop','gold')+btn('每日抽奖','lottery','gold')+btn('挑战关卡','stages','gold')+'</div><p class="system-caption">欢迎来到松鼠村庄！<br>拜师学艺、收集装备，和松鼠伙伴一起成长。</p>');
  }
  // —— 可获得物品图鉴（系统-帮助）：来源概率从真实数据（掉落池/商店/抽奖）计算 ——
  const GUIDE_ITEMS = [1,2,3,4,5,7,8,10,11,12,13,15,16,17,18,19,21,22,23,24,25,26,28,29,30,31,32,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,77,78,79,80,82,89,90,101,102,103,104,105,106,107];
  function guideSources(id) {
    const lines = [];
    if (!State.blackGearEnabled() && State.BLACK_PROP_IDS.includes(Number(id))) return lines;
    const pool = (window.BattleDrops && BattleDrops.pool) || [];
    const total = pool.reduce((n, p) => n + p.weight, 0);
    const drop = pool.find((p) => p.id === id);
    if (drop) {
      const per = drop.weight / total;
      lines.push('战斗拾取：每张拾取卡 ' + (per * 100).toFixed(1) + '%，每场战斗 3 张卡，期望 ' + (per * 3 * drop.count).toFixed(2) + (id === 15 ? ' 点/场' : ' 个/场'));
    }
    const ladderPool = (window.BattleDrops && BattleDrops.ladderPool) || [];
    const ladderTotal = ladderPool.reduce((n, p) => n + p.weight, 0);
    const ladderDrop = ladderPool.find((p) => p.id === id);
    if (ladderDrop) {
      const per = ladderDrop.weight / ladderTotal;
      lines.push('天梯赛拾取：每张拾取卡 ' + (per * 100).toFixed(1) + '%，每场 3 张卡，期望 ' + (per * 3 * ladderDrop.count).toFixed(2) + ' 个/场（战斗里点飘出来的碎片）');
    }
    const prop = propMap.getValue(id);
    if (prop && prop.buy === 'true') lines.push('道具商店：' + parseInt(prop.price) + ' 金松果/个，每日限购 ' + State.shopLimit(id) + ' 个');
    const prizes = (window.ClassicExtras && ClassicExtras.lotteryPrizes) || [];
    const mine = prizes.filter((p) => p.id === id && p.count);
    if (mine.length) {
      const expect = mine.reduce((n, p) => n + p.count * 0.1, 0);
      lines.push('每日抽奖：' + mine.map((p) => p.label).join('、') + '，占 ' + mine.length + '/10 格，单次抽中概率 ' + mine.length * 10 + '%，期望 ' + expect.toFixed(1) + ' 个/次（每天免费 1 次，之后 20 金松果/次）');
    }
    if ([24, 25, 26].includes(id)) lines.push('关卡掉落：' + ({ 24: '螳螂关', 25: '仙鹤关', 26: '熊猫关' })[id] + '每场胜利 45%～60%（按星级）概率掉落 1～6 个，期望约 1.6～2.1 个/场；★3-4 有 28% 几率越 1 级、★5-6 越 2 级');
    if (id === 23) lines.push('每日礼包：每天 1 个（连续登录第 1 天 100 金松果，每多一天 +10，150 封顶；另在挑战书、英雄帖、勇气徽章、召唤证、三种超级药丸之间按日期轮换 1 个）');
    if (id === 28) lines.push('创建角色时获得 1 个');
    if (id === 29) lines.push('打开「1级礼包」获得');
    if (id === 30) lines.push('打开「5级礼包」获得');
    if (id === 31) lines.push('打开「10级礼包」获得');
    if (id === 32) lines.push('打开「15级礼包」获得');
    if (id === 37) lines.push('旧版升级奖励：53、59、65 级曾各送 1 本；当前版本已停止发放（为了对齐 ssfight 的 90 级总属性上限），已拥有的仍可使用（8 点自由分配）');
    if ([41, 42, 43, 44].includes(id)) lines.push('金杯商店（每天开放）：20 金杯 + 20 金松果，积分需 800，不限兑换次数');
    if ([16, 17, 18, 19].includes(id)) lines.push('金杯商店（每天开放）：500 金杯 + 100 金松果，积分需 1500，账号限兑 1 次（不随周重置）');
    if ([21, 22].includes(id)) lines.push('金杯商店（每天开放）：100 金杯 + 100 金松果兑换 100 个，积分需 1200，每周限兑 1 次（每周一重置）');
    if (id === 40) lines.push('天梯赛：胜利 +3 杯、落败 +1 杯，获胜有 25% 概率额外夺得 3 杯');
    if (id === 51) lines.push('合成：属性碎片 ×10 + 50 金松果 → 随机 1 个力量/敏捷/速度转化丸');
    if (id === 47) lines.push('合成：天使果实种子 ×10 + 50 金松果（背包中合成）');
    if (id === 48) lines.push('合成：恶魔果实种子 ×10 + 50 金松果（背包中合成）');
    if (id === 8) lines.push('挑战胜利：3～7 个/场；通关关卡整轮：25 个；各级礼包中也有');
    if (id === 77 || id === 78) {
      const setName = id === 77 ? '凤凰' : '圣熊';
      lines.push('合成：10 个' + (id === 77 ? '黑凤凰碎片' : '黑圣熊碎片') + ' + 1000 金松果 → 1 件黑色' + setName + '装备（随机部位；未集齐时重复会重摇，最多 2 次后给缺失部位）');
      lines.push('碎片来源：黑色卡片、魔法袋（必得 1 卡）、金宝箱（8% 黑卡 / 首开 2% 完整黑装）、黑装融合（20% 返 1 卡）');
    }
    if (id === 79) {
      lines.push('金杯商店：1300 积分 + 2000 金杯 + 200 金松果，账号限兑 1 次（原版天梯商店的魔法袋）');
      lines.push('打开魔法袋（各档互斥）：6级宝石 3%、5级宝石 15%、蓝色碎片 15%（5~10）、召唤证 17%（1~2）、金松果 25%（300~500）、孵化点 25%（100）' + (State.blackGearEnabled() ? '；并额外获得黑色卡片 ×1' : ''));
    }
    if (id === 80) {
      lines.push('挑战塔：每 20 层 1 张、每 50 层再 +1 张（一次性）；第 100 层首通改为黑装自选箱（不发卡）');
      lines.push('无尽塔：每累计 50 层 1 张，每周最多 10 张（周一重置）');
      lines.push('金宝箱：8% 开出 1 张；魔法袋：必得 1 张；黑装融合：20% 返 1 张');
      lines.push('打开：选择凤凰/圣熊，获得对应碎片 1~2 个 + 100/200/400 金松果');
    }
    if (id === 82) lines.push('魔法袋：有几率开出 1～2 个');
    if (id === 89) lines.push('挑战塔第 100 层首通获得 1 个；打开后任选 1 件黑色凤凰/圣熊装备');
    if (id === 90) {
      lines.push('升级奖励：71～90 级每升 1 级获得 1 个，共 20 个（原版 70 级以上每级 1 个，最高 90 级）');
      lines.push(State.blackGearEnabled()
        ? '打开金宝箱（各档互斥）：6级宝石 4%、5级宝石 22%（10% 两颗 / 12% 一颗）、基础属性点 49%（6/8/10/12 点）、金松果 15%（500/750/1000）、黑色卡片 8%、完整黑装 2%（仅首开；重开不出完整黑装）'
        : '打开金宝箱（各档互斥）：6级宝石 4%、5级宝石 22%（10% 两颗 / 12% 一颗）、基础属性点 49%（6/8/10/12 点）、金松果 25%（500/750/1000）');
      lines.push('重开：单箱最多 500 次，金松果 50→75→100→150… 逐档上涨；重开只换结果，不多消耗金宝箱');
    }
    if (id >= 101 && id <= 107) {
      const lv = id - 100;
      if (lv <= 2) lines.push('45 级起：通关关卡 20% 几率、竞技场（经验/碎片）获胜 15% 几率获得（一级 75% / 二级 25%）');
      if (lv < 7) lines.push('合成：3 个同级 + 10 金松果，成功率 ' + Math.round(State.gemMergeRate(lv) * 100) + '%（失败有 50% 几率一颗材料降 1 级，1级则碎裂）');
      lines.push('镶嵌：镶入橙色（3 件相同紫装融合而来）或黑色装备，主属性 +' + State.gemPercent(lv) + '%（沿用原版曲线 5×(n²−n+2)），附加属性效果随机提升，每件限 1 颗；镶嵌与卸下各 5 金松果');
    }
    if (!lines.length) lines.push('当前版本暂无产出途径（图鉴预留物品）');
    return lines;
  }
  function openGuideItem(id) {
    const prop = propMap.getValue(id);
    if (!prop) return;
    modal(prop.name, '<div class="guide-detail"><span class="item-icon">' + icon('prop', id) + '</span><div class="guide-info"><p><b>效果</b>：' + esc(prop.remark || '—') + '</p><p><b>获取方式与概率</b>：</p><ul>' + guideSources(id).map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div></div>', [{ label: '返回帮助', cls: 'gold', run: openHelp }], { small: true });
  }
  function openHelp() {
    const guideIds = State.blackGearEnabled()
      ? GUIDE_ITEMS
      : GUIDE_ITEMS.filter((id) => !State.BLACK_PROP_IDS.includes(Number(id)));
    const items = guideIds.map((id) => '<button type="button" class="help-item" data-guide="' + id + '"><span class="item-icon">' + icon('prop', id) + '</span><span>' + esc(propMap.getValue(id).name) + '</span></button>').join('');
    const blackHelp = State.blackGearEnabled()
      ? '<p><b>黑装</b>：3 件橙装在「装备融合」里可合成 1 件黑装；黑凤凰/黑圣熊也可用 10 个碎片 + 1000 金松果合成。黑色卡片来自挑战塔 20/50 层（第 100 层给黑装自选箱）、无尽塔每累计 50 层（周限 10）、金宝箱、魔法袋和黑装融合；3 件黑装可继续融合洗词条，使用等级 60。</p>'
      : '';
    // 帮助是「系统」分组下的正常页面（以前是弹窗，会挡住底下的界面）
    const p = page('system', 'help', '<div class="help-box"><p><b>挑战</b>：选择对手，再点「挑战他」。每场消耗10体力，战斗自动进行。</p><p><b>属性</b>：力量影响伤害，敏捷影响闪避，速度影响出手次数。战斗中随机使用已获得的武器与技能。</p><p><b>成长</b>：战斗获得经验，升级有机会领悟武器与技能；71 级起每升 1 级还会获得 1 个金宝箱（最高 90 级）。在状态页查看和升级。永久属性点（力/敏/速/生命，生命 5 点算 1 点）总上限 <b>651</b>；旧档、属性书和调试也不能突破，装备/被动/药丸另算。</p><p><b>体力</b>：每5分钟恢复1点，也可以在道具中使用体力药剂。</p><p><b>关卡</b>：10级开启，按顺序挑战。前 18 关每轮消耗1张挑战书、连续击败3名敌人；后 18 关（19-36）是超级三侠，每关只有1名强敌。失败最多复活2次，每次再消耗1张。10个装备碎片可合成装备，3件同品质装备可以融合（3件同套且有下一品质档时必得该套）。带徒弟挑战时徒弟会先上阵；徒弟战败后师父免费接手同一名对手（不消耗挑战书、也不占用复活次数）。</p><p><b>竞技场</b>：10级开启经验竞技场，15级开启碎片竞技场与幻兽竞技场；报名一次打完两场。经验场名次奖励 150/100/50/30 经验，碎片场 8/6/4/3 蓝片，幻兽场 40/35/30/25 孵化点。</p><p><b>幻兽</b>：村庄「幻兽牧场」孵化、编队、喂养、进化；孵化消耗 200 孵化点。幻兽竞技场用召唤证报名；召唤证可在道具商店用 10 金松果购买，也能从魔法袋中开出。</p><p><b>天梯赛</b>：30级开启，胜利得金杯与天梯积分，金杯可在金杯商店兑换稀有奖励。天梯赛战斗里会飘出黄色三角的「属性碎片」，点碎片拾取；10 个属性碎片 + 50 金松果可在背包合成 1 个随机力量/敏捷/速度转化丸。</p><p><b>录像</b>：最近50场战斗保存在消息页，回放不消耗体力，也不会重复发放奖励。</p><p><b>存档与设置</b>：自动保存。可在系统中导出、导入；iOS 的导出文件在「文件」App → 我的 iPhone/iPad → 松鼠大战，导入时也可以直接粘贴存档文本；音乐音量、静音、分辨率与全面屏这些设置也一起存进存档，换机器同步后照旧生效。</p><p><b>宝石</b>：45 级后通关关卡或竞技场获胜有几率获得 1~2 级宝石；3 个同级宝石 + 10 金松果可合成高一级（可能失败降级）。宝石可镶入橙色或黑色装备，每件 1 颗，镶嵌/卸下各 5 金松果。</p><p><b>套装收益（仅现代界面）</b>：同名装备 2/4 件各一档加成，按该套最低品质计算；经典界面没有套装收益。</p><p><b>挑战塔</b>：通关前 18 关后解锁。逐层挑战，通关得金松果与碎片；第 20/50 层里程碑发黑卡，第 100 层给黑装自选箱。</p><p><b>无尽塔</b>：没有层数上限，每 100 层一轮。战斗得试炼币，可在试炼商店/铸币商店买增益；每累计 50 层 1 张黑卡，每周最多 10 张。</p>' + blackHelp + '<h3 class="help-items-title">可获得物品一览</h3><div class="help-items">' + items + '</div><p class="small-label">点击物品可查看效果、获取方式以及具体的概率与期望；标注“暂无产出途径”的为图鉴预留物品。</p></div>', { cls: 'help-board' });
    $$('[data-guide]', p).forEach((b) => b.onclick = () => openGuideItem(+b.dataset.guide));
    wireSystemFeedback(p);
    return p;
  }
  /* ============================================================
   * 【UC18】兜底分发与导出 UI.classic
   * ============================================================ */
  function fallback(key){if(window.ClassicExtras && window.ClassicExtras[key])window.ClassicExtras[key]();else legacy.runAction(key);}
  /* ⚠ `merge` 必须在这个总表里：经典（ssfight）状态页的「装备融合」按钮走的是
   * `UI.runAction('merge')`，而原来只有 `openStatus()` 给**它自己那一页** bind 了 merge
   * （见上面的 `bind(p,{...actions,merge:openMerge,...})`）—— 从原版渲染的状态页点进来时
   * `actions['merge']` 是 undefined，于是**点了一点反应都没有**（用户 2026-10 报的
   * "装备融合没有接入现代界面的装备融合界面"）。 */
  const actions={home,exchange:()=>openBag('exchange'),status:openStatus,weapons:()=>openCatalog('weapon'),skills:()=>openCatalog('skill'),challenge:()=>openChallenge(),battle:()=>openChallenge(),stages:openStages,bag:()=>openBag(),shop:()=>openBag(true),gears:()=>openGears(),merge:openMerge,messages:()=>openMessages(),ranklog:()=>openMessages('ranklog'),revenge:()=>openMessages('revenge'),board:openBoard,chat:openChat,'gear-sell':()=>openGearSell(0),friends:openFriends,daily:()=>{const S=State.state();if(S&&Number(S.level)<3){toast('3级后开放活动礼包');return;}openDaily();},system:openSystem,village:openVillage,'village-altar':villageAltar,'village-beast':villageBeast,'village-miracle':villageMiracle,'village-war':villageWar,help:openHelp,arena:()=>fallback('arena'),rank:()=>fallback('rank'),lottery:()=>fallback('lottery'),master:()=>fallback('master'),toplist:()=>fallback('toplist'),vip:()=>fallback('vip')};
  function runAction(key){if(actions[key]){closeOriginalResult();actions[key]();}}
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      const dialogs=$$('.classic-modal-overlay');
      if(dialogs.length){
        // 自由属性点弹窗必须选完，Esc 也不放行
        const closeBtn=$('.modal-close',dialogs[dialogs.length-1]);
        if(closeBtn){closeBtn.click();return;}
        return;
      }
      if(window.SfFightResult&&SfFightResult.isOpen()){e.preventDefault();SfFightResult.dismiss();return;}
      const panels=$$('.panel-close');if(panels.length){panels[panels.length-1].click();return;}
      if(screen!=='home'&&$('.classic-page')&&!dialogs.length)home();
    }
    if(e.key==='Tab'){
      const dialogs=$$('.classic-modal-overlay');if(!dialogs.length)return;
      const root=dialogs[dialogs.length-1],focusable=$$('button:not(:disabled),input',root);
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  /* ============================================================
   * 【UC18】自愿支持作者（系统页入口 + 30 级一次性提示）
   *
   * 这个复刻版完全免费：没有内购、没有广告，也**不会拿支持换任何游戏内好处**。
   * 链接与「打开系统浏览器」的统一实现在 main.js（`Main.SUPPORT` / `Main.openExternal`）：
   *   · 轻壳模式 → 内置服务器的 `/__open`（Tauri 的 ACL 不允许远端来源调 IPC）
   *   · 安装版 / 安卓 → Rust 命令 `open_external`
   *   · 便携版 / 浏览器 → `window.open`
   * 全部失败时退到「复制链接」兜底，玩家手动粘贴也能支持。
   * ============================================================ */
  function supportMeta() {
    const s = (window.Main && Main.SUPPORT) || {};
    return { url: s.url || 'https://ifdian.net/a/Charlespkuer', label: s.label || '爱发电' };
  }
  /** 复制文本：优先 Clipboard API，失败退回「选中 + execCommand」。 */
  function copyText(text) {
    const okMsg = '链接已复制，去浏览器里粘贴打开就行';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => toast(okMsg), () => toast('复制失败，请手动选中复制'));
        return true;
      }
    } catch (e) { /* 落回 execCommand */ }
    try {
      const el = document.createElement('textarea');
      el.value = text; el.setAttribute('readonly', 'readonly');
      el.style.position = 'fixed'; el.style.left = '-9999px'; el.style.opacity = '0';
      document.body.appendChild(el); el.select(); el.setSelectionRange(0, el.value.length);
      document.execCommand('copy'); el.remove(); toast(okMsg); return true;
    } catch (e) { toast('复制失败，请手动选中复制'); return false; }
  }
  /** 打开支持链接（失败时给「复制链接」兜底弹窗）。 */
  function openSupportLink(url) {
    const u = url || supportMeta().url;
    const fail = () => showSupportFallback(u);
    let p;
    try { p = (window.Main && Main.openExternal) ? Main.openExternal(u) : Promise.resolve(false); }
    catch (e) { p = Promise.resolve(false); }
    return Promise.resolve(p).then((ok) => { if (!ok) fail(); return !!ok; }, () => { fail(); return false; });
  }
  /** 「没能自动打开浏览器」的兜底：把链接摊出来，一键复制。 */
  function showSupportFallback(url) {
    const box = modal('用浏览器打开', '<div class="support-box"><p>没能自动打开浏览器 —— 复制下面的链接，' +
      '在浏览器地址栏粘贴打开即可：</p><p><input class="support-input" readonly value="' + esc(url) +
      '" aria-label="支持作者链接"></p></div>',
      [{ label: '复制链接', cls: 'gold', close: false, run: () => copyText(url) },
        { label: '返回', cls: 'muted' }], { small: true });
    const input = $('.support-input', box.element);
    if (input) { input.focus(); input.select(); }
    return box;
  }
  /**
   * 「支持作者」弹窗。`opts.fromLevel` = 30 级那次一次性提示（文案不同）。
   * 两个入口共用：系统页顶部的按钮、30 级提示。
   */
  function openSupportModal(opts) {
    const o = opts || {};
    const meta = supportMeta();
    const lead = o.fromLevel
      ? '你已经 30 级了 —— 谢谢你玩到这里！'
      : '这个复刻版完全免费：没有内购、没有广告。';
    const body = '<div class="support-box">' +
      '<p class="support-lead">' + esc(lead) + '</p>' +
      '<p>如果它让你找回了一点当年的感觉，可以<b>自愿</b>请作者喝杯咖啡；' +
      '不打赏完全不影响游戏内容与平衡，也不解锁任何东西。bug反馈与内容讨论请加q群：1128710765</p>' +
      '<p class="support-link">' + esc(meta.label) + '：<span class="support-url">' + esc(meta.url) + '</span></p>' +
      '</div>';
    return modal('支持作者', body, [
      { label: '打开链接', cls: 'gold', run: () => openSupportLink(meta.url) },
      { label: '以后再说', cls: 'muted' },
    ], { small: true });
  }
  /**
   * 30 级的一次性提示。**只在没有别的弹窗时**触发（升级奖励 / 三选一 / 属性点都处理完之后），
   * 取提示权是原子的：取到就立刻落存档，不会重复打扰。
   */
  function maybeSupportPrompt() {
    if (!window.State || typeof State.supportPromptTake !== 'function') return false;
    if ($('.classic-modal-overlay')) return false;          // 有别的弹窗：先不打扰
    if (!State.supportPromptTake()) return false;
    openSupportModal({ fromLevel: true });
    return true;
  }
  /** 系统页最上方那一块：自愿支持作者。 */
  /** 版本号的最后兜底：**只**在拿不到 `window.__SSDZ_VERSION`、也 fetch 不到
   *  `scripts/version.json` 时才会用到（file:// 直接打开、注入被拦）。
   *  安装包 / APK 由 `tools/build-tauri-app.cjs --web` 注入真实版本并带上 version.json，
   *  正常发布包不会走到这里；发版时顺手把这一行同步成当前版本即可。 */
  const VERSION_FALLBACK = '1.0.5';
  let gameVersion = String((typeof window !== 'undefined' && window.__SSDZ_VERSION) || VERSION_FALLBACK);
  let versionRequested = false;
  function versionLabel(v) {
    const s = String(v == null ? '' : v).trim().replace(/^v/i, '');
    return s ? 'v' + s : 'v' + VERSION_FALLBACK;
  }
  function syncVersionLabels() {
    try {
      document.querySelectorAll('[data-game-version]').forEach((el) => {
        el.textContent = versionLabel(gameVersion);
      });
    } catch (e) {}
  }
  /** 运行时读 scripts/version.json：发布包的版本号由构建脚本写在这个文件里。
   *  直接双击 file:// 打开时 fetch 可能被浏览器拦，保留构建时的 fallback。 */
  function loadGameVersion() {
    if (versionRequested) return;
    versionRequested = true;
    try {
      if (typeof fetch !== 'function') return;
      fetch('scripts/version.json', { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null)
        .then((j) => {
          if (j && j.version) { gameVersion = String(j.version); syncVersionLabels(); }
        })
        .catch(() => {});
    } catch (e) {}
  }
  function supportPanelHtml() {
    const meta = supportMeta();
    const ver = versionLabel(gameVersion);
    loadGameVersion();
    return '<div class="support-panel">' +
      '<div class="support-panel-text"><div class="support-head"><h3 class="classic-section-title">关于复刻版</h3>' +
      '<span class="support-version" data-game-version="1" title="当前版本">' + esc(ver) + '</span></div>' +
      '<span><b>喜欢这个复刻版？</b>如果它让你找回了一点当年的感觉，可以自愿支持作者（不影响任何游戏内容）。bug反馈与内容讨论请加q群：1128710765</span></div>' +
      '<button type="button" class="uc-button gold support-btn" data-action="support" title="用系统浏览器打开' +
      esc(meta.label) + '">支持作者</button></div>';
  }

  /* ============================================================
   * 【UC20】界面模式：现代 / 经典
   *
   * 只换「展示层」—— window.UI.classic 由哪一套原语实现提供；
   * State（存档/进度）、Battle（战斗）、TowerUI（塔）一概不碰，
   * 所以热切换不需要重载页面。目前两档共用同一套原语（P1 骨架），
   * 经典展示层与其逐屏取舍见 docs/经典模式-可行性.md 的 §12。
   * 模式差异落在 <html data-ui-mode="...">；经典界面本体**用原版导出数据渲染**
   * （素材库 `images/ssfight/ui/`，由 tools/gen-ssfight-ui.cjs 生成），**不用 CSS 模仿**。
   * ============================================================ */
  const UI_MODE_LSKEY = 'ssdz_ui_mode';
  const uiModeList = () => (window.State && State.UIMODES) ||
    [{ key: 'modern', label: '现代' }, { key: 'classic', label: '经典' }];
  const uiModeLabel = (m) => (uiModeList().find((x) => x.key === m) || {}).label || m;
  /** 当前模式：优先读存档；存档还没载入（标题画面）时退回 localStorage。 */
  function currentUiMode() {
    try {
      if (window.State && State.settings && State.state && State.state()) {
        const m = State.settings().uiMode;
        if (m) return m;
      }
    } catch (e) {}
    try { return localStorage.getItem(UI_MODE_LSKEY) === 'modern' ? 'modern' : 'classic'; }
    catch (e) { return 'classic'; }
  }
  /** 落到 <html data-ui-mode>（CSS 与调试都能看见），并写 localStorage 作读档前的兜底。 */
  function applyUiMode(mode) {
    const m = uiModeList().some((x) => x.key === mode) ? mode : 'classic';
    try { document.documentElement.setAttribute('data-ui-mode', m); } catch (e) {}
    try { localStorage.setItem(UI_MODE_LSKEY, m); } catch (e) {}
    return m;
  }
  /** 下一种模式：系统页那颗按钮点一下换一档（和「分辨率」同一套交互）。 */
  function nextUiMode() {
    const list = uiModeList();
    const at = list.findIndex((x) => x.key === currentUiMode());
    return list[(at + 1 + list.length) % list.length].key;
  }
  /**
   * 切界面模式：两套进度各归各的槽位。确认后保存当前界面，载入目标界面；
   * 目标界面还没有存档就新建 1 级角色。最后完整重进首页，避免旧页 DOM 混在一起。
   * 这是**底层**切换；真人入口走 requestMode()，会先弹双存档提示。
   */
  function setMode(mode) {
    const m = uiModeList().some((x) => x.key === mode) ? mode : 'classic';
    applyUiMode(m);
    let result = null;
    try {
      if (window.State && State.switchMode && State.state && State.state()) result = State.switchMode(m);
      else if (window.State && State.setSettings && State.state && State.state()) State.setSettings({ uiMode: m });
    } catch (e) {
      if (window.__errs) window.__errs.push('switchMode: ' + (e && (e.stack || e.message) || e));
    }
    try { if (window.Main && Main.showHome) Main.showHome(); else if (screen === 'home') home(); else openSystem(); } catch (e) {}
    try { if (window.Debug && Debug.refresh) Debug.refresh(); } catch (e) {}
    toast(result && result.created
      ? '已切换到' + uiModeLabel(m) + '界面：该界面还没有存档，已新建 1 级角色'
      : '已切换到' + uiModeLabel(m) + '界面（独立存档）');
    return m;
  }
  /** 真人点「界面模式」时的确认框：明确告诉玩家两套进度不互通。 */
  function requestMode(mode) {
    const m = uiModeList().some((x) => x.key === mode) ? mode : 'classic';
    if (m === currentUiMode()) return;
    let has = false;
    try { has = !!(window.State && State.hasModeSave && State.hasModeSave(m)); } catch (e) {}
    const label = uiModeLabel(m);
    const body = '<p>经典界面和现代界面使用<b>两套独立存档</b>，玩家进度不互通。</p>' +
      '<p>切换后会载入「' + esc(label) + '」界面的独立进度' +
      (has ? '。' : '；该界面还没有存档，会新建一个 1 级角色。') + '</p>' +
      '<p class="small-label">当前界面的进度会先保存；以后切回来还能继续。在现代界面中支持使用debug面板。</p>' +
      (m === 'classic' ? '<p class="small-label"><b>注意：</b>切到经典界面后，调试模式的入口会消失；需要调试请切回现代界面。</p>' : '');
    const dlg = modal('切换界面模式', body, [
      { label: '取消', cls: 'muted' },
      { label: '切换', cls: 'gold', run: () => setMode(m) },
    ], { small: true });
    /* 这一张的「取消 / 切换」两颗键单独放大、并抬离卡片下沿（用户 2026-10 口径：
     * "取消和切换键按钮太小了太靠下，调大往上移动一点"）。加一个自己的 class 而不是改
     * `.modal-buttons` 公共样式 —— 别的确认框不需要跟着变。
     * ⚠ 双机同步会按文件覆盖：这段和 `css/classic-refine.css` 的 `.mode-switch-dialog`
     *   必须成对存在，缺一边就退回小按钮 / 贴边（2026-10 已被覆盖过两次）。 */
    if (dlg && dlg.element && dlg.element.classList) dlg.element.classList.add('mode-switch-dialog');
  }
  /**
   * 布局高度：菜单页按 920:560 参考比例（= 1170×712.174），战斗/首页场景按 690。
   * 这条判据原先**硬编码在 main.js 的 fitCanvas 里**；提到展示层之后，
   * 经典模式可以自己决定用哪套高度，而 main.js 不必知道。
   */
  function layoutHeight(W, H) {
    /* 经典模式的村庄页与**状态页**都是**原版 320×196 的整页**，必须按原版比例给高度：
     * 若沿用 690，1170×690（比例 1.696）比原版 1.633 宽，slice 会把上下顶栏/底栏裁掉。
     * 1170 × 196/320 = 716.6 —— 这正是 §2 里"严格等比"的那套。 */
    if (currentUiMode() === 'classic' && window.SfUiMain) return W * 196 / 320;
    return $('#ui .classic-page') ? W * 560 / 920 : H;
  }
  /**
   * 自检模式 `?test=1` 的查找选择器：同样交给展示层提供，
   * 这样换一套界面实现也能被自检覆盖到（原来是写死在 main.js 里的）。
   */
  function smokeSelectors() {
    /* 经典模式二级页的容器有两代：`.ssfight-sub`（挑战/状态/装备等 4756/7638 子页）
     * 与 `.ssfight-view`（合成/战果/天梯准备页）。少了它们，`?test=1` 会把已经挂出来的
     * 原版页判成"没打开"（2026-10 审计实测）。`.ssfight-home` 单独不列：村庄首页与
     * 战斗页都是它，列进来会让"页面没打开"假通过。 */
    return { panel: '#ui .panel, #ui .classic-page, #ui .classic-modal, #ui .ssfight-sub, #ui .ssfight-view, #ui section[aria-label="松鼠挑战"], #ui section[aria-label="松鼠状态"], #ui section[aria-label="松鼠消息"]', close: '#ui .panel-close' };
  }
  /* 启动即落一次模式：此时存档还没载入，用 localStorage 兜底；存档载入后 main.js 会再落一次。 */
  applyUiMode(currentUiMode());

  window.UI={...legacy,renderHome,drawHomeHud,drawActor,runAction,currentScreen:()=>screen,refreshHome,renderNumbers,refreshHeader,
    setMode,currentUiMode,applyUiMode,nextUiMode,UI_MODE_LSKEY,layoutHeight,smokeSelectors,
    classic:{page,modal,btn,bind,icon,spr,goldIcon,statsHtml,portrait,resultModal,stageResult,home,toast,num,setNum,upgradeReward,upsHtml,pickupResult,freePointDialog,promptFreePoints,promptLevelUpChoices,wsChoiceDialog,openSupportModal,maybeSupportPrompt,supportPanelHtml,copyText,supportMeta,wireSystemFeedback,
      /* 【SFR4】经典模式状态页的**武器 / 技能栏**（`js/ssfight/ui-status.js`）要照着复刻这套
       * 图鉴的数据画格子（原版那两个 tab 的图标是运行时 `attachMovie` 的库元件，素材库里没有），
       * 所以把"这一页有哪些东西、自己有没有、是不是真形态"与"打开某一项的详情"这两件事导出去。
       * 详情页用的还是复刻这一套（版式已对照原版截图核过），只是入口改成原版页里的格子。 */
      catalogInfo, openItem, wsIconOf, openRankShop,
      /* 经典页签矢量 & 原版 3911 返回键：抽奖页与金杯商店共用，避免再手搓一套。
       * `installBagTabVectors` 把「背包 / 商店 / 兑换」换成原版矢量；`mountClassicBack`
       * 在页面底部挂「随机挑战 → 查看」那颗金胶囊返回键（失败时自动退回普通底栏按钮）。 */
      installBagTabVectors, wirePopTaps, mountClassicBack: mountRankShopBack, destroyClassicBack: destroyRankShopBack,
      /* `catalogItems(kind)` = 该类目的**全部**条目（id / 名字 / 原版矢量图标），
       * 给"查看别人"那一页用：它要按对手自己的武器/技能清单把格子画出来
       * （原版 `showWeaponSkills` 只是把数据源换成 `friendInfo`，见 ui-status.js）。 */
      catalogItems: allItems,
      /* 「查看对手」那一页（`js/ssfight/ui-challenge.js` 的好友动作菜单）要用字典里的名字： */
      weaponName:(id)=>{const v=weaponsMap.getValue(Number(id));return v?v.name:('武器'+id);},
      skillName:(id)=>{const v=skillsMap.getValue(Number(id));return v?v.name:('技能'+id);},
      gearName:(id)=>{const v=gearMap.getValue(Number(id));return v?v.name:('装备'+id);},
      updatePanelHtml,updateCheck,updateAsk,updateRun,updateFetch,updState,UPDATE_PAGE,
      /* 关卡开战 / 结算：经典模式的挑战页（js/ssfight/ui-challenge.js）三级页的
       * 「开始战斗」直接调这两个，不必再绕一圈 `UI.runAction('stages')`
       * （那样会先弹复刻自己那张「请选择难度」，与刚点过的原版难度页重复一次）。 */
      stageFight, stageConfirm, stageTypeAvailable, towerEntryHtml},
    weaponIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('weapon',id)+'">',
    skillIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('skill',id)+'">',
    propIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('prop',id)+'">'};
})();
