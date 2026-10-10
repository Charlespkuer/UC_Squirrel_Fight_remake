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
  /** 「活动」里还有东西没领（每日礼包或每日任务）时给图标加提示动效。 */
  const dailyAttention = () => {
    try {
      if (!State.dailyStatus().claimed) return true;
      return State.questClaimable() > 0;
    } catch (e) { return false; }
  };
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => [...(root || document).querySelectorAll(s)];
  /** 滑动条的「已选 / 未选」两段配色：把百分比写进 --fill，CSS 用它切分
   *  左（金色已选）右（浅色未选）。目前只有音乐音量在用（卖出改成点一下卖 1 个）。 */
  const fillRange = (el) => {
    if (!el) return;
    const min = Number(el.min) || 0, max = Number(el.max);
    const v = Number(el.value) || 0;
    const pct = Number.isFinite(max) && max > min ? ((v - min) / (max - min)) * 100 : 100;
    el.style.setProperty('--fill', Math.max(0, Math.min(100, pct)).toFixed(2) + '%');
  };
  /* 少数按钮在原版里是整张切图。art 开关只给**页面页脚**那一处用：
   * 弹窗里的按钮必须和「继续闯关」「稍后继续」这些手搓按钮同一套样式 ——
   * 同一个弹窗里一个贴图、一个手搓，美术会不一致。 */
  const buttonArt = { '返回菜单':'return-menu', '更换装备':'change-equipment' };
  /* 翻页箭头不用字体字形（Arial/Georgia 的 ‹ › 墨迹中心天生偏离圆心，且 Windows/macOS
   * 字体回退不同，padding 补偿在一台机器上量好、换台机器又歪）；改用 CSS 边框画的
   * 人字形（.chev），几何对称、跨平台一致。字形保留在视觉隐藏 span 里供读屏。 */
  const btn = (label, action, cls, art) => '<button type="button" class="uc-button ' + (cls || '') + '" data-action="' + esc(action) + '">' + ((art && buttonArt[label]) ? '<span class="reference-button-label">'+esc(label)+'</span><img alt="" class="classic-button-art" src="images/classic/new-reference/buttons/'+buttonArt[label]+'.png">' : (label === '‹' || label === '›') ? '<span class="reference-button-label">' + label + '</span><i class="chev ' + (label === '‹' ? 'chev-l' : 'chev-r') + '" aria-hidden="true"></i>' : esc(label)) + '</button>';
  const spriteCache = Object.create(null);
  let screen = 'home', timer = 0, activePortrait = null, lastRefresh = 0;
  let catalogPage = 0, bagPage = 0, gearPage = 0;
  let selectedProp = 0;
  const selectedItems = {weapon:0,skill:0};
  let opponents = [], selectedOpponent = null;
  let heroWears = [], wearSignature = '', wearRequest = '';
  // 主页限时药丸角标：id → 效果简述（与 State.useProp/totalStats 的生效口径一致）
  /* ============================================================
   * 【UC1】基础小件：esc / VIP 徽标 / 事件绑定 / 贴图
   * ============================================================ */
  const BUFF_PROPS = [[3, '力量+20%'], [4, '敏捷+20%'], [5, '速度+20%'], [7, '挑战经验+40%'], [41, '力量+40%'], [42, '敏捷+40%'], [43, '速度+40%'], [44, '挑战经验+60%']];
  let buffSignature = '';
  const classicPortrait = new Image(); classicPortrait.src = 'images/classic/squirrel-classic.png';
  const berserkerPortrait = new Image(); berserkerPortrait.src = 'images/classic/squirrel-berserker-classic.png';
  const ninjaPortrait = new Image(); ninjaPortrait.src = 'images/classic/new-reference/squirrel-green-outfit.png';

  function bind(root, actions) {
    $$('[data-action]', root).forEach(b => b.onclick = () => {
      const f = actions[b.dataset.action];
      if (f) f(b);
    });
  }
  function frameUrl(sheet, label) {
    return 'images/classic/sprites/' + sheet + '-' + label + '.png';
  }
  function spr(sheet, label, cls) {
    const url = frameUrl(sheet, label);
    return url ? '<img alt="" class="' + (cls || '') + '" src="' + url + '">' : '';
  }
  /** 原版贴图标签（只用于显示，点击沿用外层 data-action 元素）。 */
  function sprLabel(sheet, label, w, h, title) {
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
  const NUM_SHEET = 'images/num_28.png', NUM_W = 26, NUM_H = 23;
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
    // 真·武器用的是素材库里的另一套图：images/classic/icons/weapon-true-<id>.png
    if (kind === 'weapon' && trueForm) return 'images/classic/icons/weapon-true-' + id + (locked ? '-locked' : '') + '.png';
    if(kind==='weapon' && +id===1 && !locked)return 'images/classic/icons/weapon-1-classic.png';
    return 'images/classic/icons/' + kind + '-' + id + (locked ? '-locked' : '') + '.png';
  }
  /** 等级 11~15 = 真1~真5；显示成「真N」，10 级及以下显示 LVn。 */
  const levelLabel = (level, withPrefix) => {
    const t = (window.GData && GData.trueLevel) ? GData.trueLevel(level) : 0;
    if (t > 0) return '真' + t;
    return withPrefix === false ? String(level) : 'LV' + level;
  };
  const isTrueGear = (item) => !!item && (window.GData && GData.trueLevel ? GData.trueLevel(item.level) > 0 : Number(item.level) > 10);
  /* 真形态专属卡面（带「真」字红章的方卡）：images/classic/reference-cards/<kind>-<id>.png。
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
      return '<img alt="" class="reference-art" src="images/classic/reference-cards/' + kind + '-' + id + '.png">';
    }
    if (kind === 'weapon' && trueForm) return '<img alt="" src="' + atlasIcon('weapon', id, locked, true) + '">';
    if(kind==='prop' && ((!selected && [1,2,4,5,10,12,21,22,23,24,26,36].includes(+id)) || selected && [3,11,25].includes(+id))) {
      return '<img alt="" class="reference-art" src="images/classic/new-reference/props/prop-'+id+(selected?'-selected':'')+'.png">';
    }
    const reference = {
      weapon: { learned: [1,5,7,8,9,15], locked: [2,3,4,6,10,12,13,14] },
      skill: { learned: [2,3,4,7,9,13,15,18], locked: [1,5,6,8,10,11,12,14,17] }
    };
    const state = locked ? 'locked' : 'learned';
    if (reference[kind]?.[state].includes(+id) && !selected || kind==='skill' && +id===16 && !locked && selected) {
      return '<img alt="" class="reference-art" src="images/classic/new-reference/cards/'+kind+'-'+id+'-'+state+'.png">';
    }
    const grey={weapon:[2,3,4,7,9,10],skill:[3,7,8,9,14,15,18,23]};
    const fromReference=(locked && grey[kind]?.includes(+id)) || (!locked && kind==='skill' && [6,13].includes(+id));
    return '<img alt="" '+(fromReference?'class="reference-art" ':'')+'src="'+(fromReference?'images/classic/reference-cards/'+kind+'-'+id+'.png':atlasIcon(kind,id,locked))+'">';
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
      const giftCards = (u.gifts || []).map((g) =>
        '<div class="reward-card gift"><span class="reward-icon">' + icon('prop', g.id) + '</span>' +
        '<span class="reward-text">' + esc(g.name) + ' ×' + esc(g.count) + '</span></div>').join('');
      return '<div class="reward-panel">' +
        '<div class="reward-title"><img alt="升级奖励" src="' + frameUrl('resource_10', 3) + '"></div>' +
        '<div class="reward-row">' + cards.join('') + point + wsPick + bonus + giftCards + '</div>' +
        '<div class="reward-level">升到 ' + esc(u.level) + ' 级</div></div>';
    }).join('');
  }
  /** 战斗结算里显示升级奖励；没有升级时返回空串。 */
  function upsHtml(ups) {
    const list = (ups || []).filter(Boolean);
    return list.length ? '<div class="reward-stack">' + upgradeReward(list) + '</div>' : '';
  }
  function pickupResult(loot) {
    if (!loot || !loot.items.length) return;
    const grouped = Object.create(null);
    loot.items.forEach(item => { if(grouped[item.id])grouped[item.id].count+=item.count;else grouped[item.id]={...item}; });
    const html='<div class="battle-loot-summary">战斗拾取：'+Object.values(grouped).map(item=>esc(item.name)+' ×'+item.count).join('　')+'</div>'+upsHtml(loot.ups);
    const bodies=$$('.classic-modal-overlay .modal-body');
    if (bodies.length) bodies[bodies.length-1].insertAdjacentHTML('beforeend',html);
    else modal('战斗拾取',html,[{label:'确定'}],{small:true});
  }
  /* ============================================================
   * 【UC4】页面骨架：tabs / page / modal / notice / toast
   * ============================================================ */
  function home() { Main.showHome(); }
  function tabs(group, active) {
    const sets = {
      status: [['status','状态'],['weapons','武器'],['skills','技能']],
      challenge: [['challenge','随机'],['friends','好友'],['arena','竞技'],['stages','关卡']],
      message: [['messages','消息'],['chat','聊天'],['ranklog','天梯赛'],['revenge','复仇'],['toplist','排行榜']],
      bag: [['bag','背包'],['shop','商店'],['exchange','兑换']],
      system: [['system','系统'],['help','帮助'],['village','村庄'],['vip','超级松鼠']]
    };
    const labels=sets[group].map(([id,t])=>{
      const art=group==='status'?'<span class="reference-button-label">'+t+'</span><img alt="" class="classic-button-art" src="images/classic/new-reference/buttons/'+({status:'status',weapons:'weapon',skills:'skill'}[id])+'-'+(id===active?'active':'normal')+'.png">':t;
      return '<button class="uc-tab '+(id===active?'active':'')+'" data-action="'+id+'" aria-current="'+(id===active?'page':'false')+'">'+art+'</button>';
    }).join('');
    return '<nav class="classic-tabs ' + (sets[group].length > 3 ? 'four' : group==='bag'?'bag-tabs':'') + '" aria-label="游戏分页">' + labels + (group === 'challenge' ? '<span class="tab-energy">体力 ' + State.state().energy + '/' + State.state().maxEnergy + '</span>' : group==='bag'?'<span class="bag-coins">'+spr('resource_1',18)+'<b>'+State.state().goldPoint+'</b></span>':'') + '</nav>';
  }
  /** 页内改过金松果之后刷新顶部标签条右上角的数量（抽奖/道具/任务/每日礼包等原地结算的场景）。 */
  function refreshHeader() {
    const S = State.state(); if (!S) return;
    $$('.bag-coins b').forEach((el) => { el.textContent = S.goldPoint; });
    $$('[data-live-gold]').forEach((el) => { el.textContent = S.goldPoint; });
    const home = $('.home-money .num u'); if (home) setNum($('.home-money .num'), S.goldPoint);
  }
  function page(group, active, content, opts) {
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
    $$('.classic-modal-overlay').forEach(e => e.remove());
    const p = document.createElement('section'); p.className = 'classic-page'; p.dataset.screen = active;
    p.innerHTML = tabs(group, active) + (opts.above || '') + '<div class="classic-board ' + (opts.cls || '') + '">' + content + '</div><footer class="page-footer">' + (opts.left || '') + btn('返回菜单','home','gold',true) + (opts.right || '') + '</footer>' + (opts.counter ? '<span class="page-counter' + (opts.counterPlace === 'board' ? ' in-board' : '') + '">' + opts.counter + '</span>' : '');
    $('#ui').appendChild(p);
    bind(p, Object.assign({}, actions, {home}));
    if(window.Main?.resizeLayout)Main.resizeLayout();
    if (keepTop || keepLeft) {
      const nb = Array.prototype.find.call(p.children, (el) => el && el.classList && el.classList.contains('classic-board'));
      if (nb) { nb.scrollTop = keepTop; nb.scrollLeft = keepLeft; }
    }
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
    const sub = ssdzWhenText(it.at, Date.now()) + ' · ' + ssdzSizeText(it.size);
    return '<div class="save-row' + (kind === 'current' ? ' current' : '') + '">' +
      '<span class="save-level">' + Math.max(0, Number(it.level) || 0) + '<i>级</i></span>' +
      '<span class="save-name">' + esc(String(it.name || '（无名）')) +
      (kind === 'current' ? '<em>当前</em>' : '') + '</span>' +
      '<span class="save-sub">' + esc(sub) + '</span>' +
      '<button type="button" class="uc-button small" data-save-row="' + index + '">载入</button>' +
      '</div>';
  }
  /** 存档列表弹窗：返回 { close, element }，data-save-row 用 saveRowIndex 里的下标取回对应存档。 */
  function saveListDialog(list, onPick) {
    const rows = list.map((it, i) => saveListRow(it, i)).join('');
    const total = list.length;
    const body = '<div class="save-list" role="list">' + rows + '</div>' +
      '<p class="save-list-tip">共 ' + total + ' 份（含 save/backup/ 快照）。' +
      '载入会先把当前进度备份到 save/backup/，再整档换过去。</p>';
    const m = modal('从存档列表导入', body, [{ label: '返回', cls: 'muted' }]);   // 大弹窗：列表要占满高度
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
    screen = 'home'; activePortrait = null;
    const S = State.state();
    $('#ui').innerHTML = '<section class="classic-home" aria-label="松鼠大战主页"><div class="home-status"><span class="home-name">' + vipBadge() + esc(S.name) + '</span><span class="home-level">' + num(S.level, true) + '</span><span class="energy-label cartoon">体力</span><div class="uc-meter home-energy"><i></i><span class="home-energy-val">' + num(S.energy + '/' + S.maxEnergy, true) + '</span></div></div><div class="home-subbar"><span class="home-exp-label" role="img" aria-label="经验" title="经验">' + spr('draw', 15, 'home-exp-art') + '</span><div class="exp-meter"><i></i><span class="home-exp-val">' + num(S.exp + '/' + GData.nextExp(S.level), true) + '</span></div><div class="home-money">' + icon('prop',1) + '<button data-action="shop" aria-label="金松果商店">' + num(S.goldPoint, true) + '</button></div></div><div class="home-buffs" aria-label="生效中的限时用品"></div><div class="home-side"><button class="picture-button' + (dailyAttention() ? ' attention' : '') + '" data-action="daily" aria-label="活动' + (dailyAttention() ? '，有可领取的奖励' : '') + '">' + '<img alt="活动" src="images/classic/home/activity.png">' + '</button><button class="picture-button" data-action="chat" aria-label="聊天">' + '<img alt="" src="images/classic/home/chat.png">' + '</button></div><button class="village-door" data-action="village" aria-label="村庄"><img alt="" src="images/classic/home/village.png"></button><nav class="home-menu" aria-label="主菜单">' + btn('道具','bag') + btn('状态','status') + btn('开始挑战','challenge','gold') + btn('消息','messages') + btn('系统','system') + '</nav></section>';
    bind($('.classic-home'),actions);buffSignature='';
    refreshHome();
    renderNumbers();
    promptLevelUpChoices();
  }
  function refreshHome() {
    const S = State.state(); if (!S) return;
    const h = $('.classic-home'); if (!h) return;
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
    // 动画，这样套装和实际装备一致（狂暴套装仍用现成肖像）。
    const referenceOutfit = ['Head_5_1','HandO_4_1','Body_5','Foot_5'].every((src,i)=>wears[i]?.src===src);
    const classicImage = animate ? null : referenceOutfit ? ninjaPortrait : [0,1,2,3].every(i=>wears[i] && /_32(?:_|$)/.test(wears[i].src)) ? berserkerPortrait : !wears.some(Boolean) ? classicPortrait : null;
    if (classicImage && classicImage.complete && classicImage.naturalWidth) {
      const k = Math.min(box.w/classicImage.width,box.h/classicImage.height);
      const w = classicImage.width*k,h=classicImage.height*k;
      const bob = options.still ? 0 : Math.sin(timer/370)*2;
      ctx.save();
      if(options.silhouette){ctx.filter='brightness(0)';ctx.globalAlpha=.23;}
      ctx.drawImage(classicImage,box.x+(box.w-w)/2,box.y+box.h-h+bob,w,h);
      ctx.restore(); return;
    }
    const name = options.npc ? ({tl:'tl_rest',xh:'xh_rest',xm:'xm_rest'}[options.npc] || 'standby') : (animate ? options.anim : 'standby');
    const frames = Engine.anim(name); if(!frames)return;
    const sheets = options.npc ? ({tl:['tl'],xh:['xh1','xh2'],xm:['xm1','xm2']}[options.npc]) : (animate ? (options.sheets || ['SQ_01','SQ_02']) : ['SQ_01','SQ_02']);
    const frame = frames[options.still || !animate ? 0 : Math.floor(timer/90)%frames.length];
    const bounds = Engine.frameBounds ? Engine.frameBounds(frames[0],{sheets,wears,exclude:['75','20001']}) : {x:60,y:320,w:410,h:340};
    if(!bounds || !bounds.w)return;
    const k=Math.min(box.w/bounds.w,box.h/bounds.h);
    const origin={x:(box.x+(box.w-bounds.w*k)/2)/k-bounds.x,y:(box.y+(box.h-bounds.h*k)/2)/k-bounds.y};
    ctx.save();
    if(options.silhouette){ctx.filter='brightness(0)';ctx.globalAlpha=.23;}
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
    const S=State.state(),st=State.totalStats(),fights=S.dailyWins+S.dailyFails;
    const p=page('status','status','<canvas class="status-character" width="497" height="341" aria-label="我的松鼠"></canvas><div class="status-right"><div class="status-exp"><span class="home-exp-label">Exp</span><div class="exp-meter"><i style="width:'+Math.min(100,100*S.exp/GData.nextExp(S.level))+'%"></i><span>'+S.exp+'/'+GData.nextExp(S.level)+'</span></div></div><dl class="status-lines"><dt>今日胜率：</dt><dd>'+(fights?Math.round(S.dailyWins/fights*100):0)+'%</dd><dt>战斗场次：</dt><dd>'+(S.allWins+S.allFails)+'</dd></dl><div class="status-buttons">'+btn('更换装备','gears','gold',true)+btn('装备融合','merge','gold')+'</div></div>'+statsHtml(st));
    portrait($('.status-character',p));
    $('.page-footer',p).insertAdjacentHTML('beforeend',
      '<button class="status-sell-link" data-action="gear-sell" aria-label="装备出售：按品质回收背包里的装备"><span class="status-sell-icon" aria-hidden="true"><i class="status-sell-glyph">$</i></span><span class="status-sell-text">装备出售</span></button>' +
      '<button class="status-fusion-link" data-action="merge" aria-label="装备融合：三件相同装备合成更高品质"><span class="status-fusion-icon" aria-hidden="true"><i class="status-fusion-glyph">⚒</i></span><span class="status-fusion-text">装备融合</span></button>');
    bind(p,{...actions,merge:openMerge,home});
  }
  function allItems(kind) {
    const a=[];(kind==='weapon'?weaponsMap:skillsMap).each((id,v)=>{if(v&&+id>0)a.push({...v,id:+id});});
    return a.sort((a,b)=>a.id-b.id);
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
    opponents=spread.map(i=>State.genAI(Math.max(1,S.level+i),'',{levelJitter:2,minLevel:Math.max(1,S.level-1)}));
    selectedOpponent=null;
  }
  // 随机对手也是好友来源：好友页与推荐列表共用这一份候选
  let friendCandidates = [];
  // 刷新对手费用：前5次免费，随后每3次费用+1金松果（1,1,1,2,2,2,…）；进行挑战或10分钟未刷新后重置
  function challengeRefreshState() {
    const S = State.state(), now = Date.now();
    let rf = S.challengeRefresh;
    if (!rf || !Number.isFinite(rf.count) || !Number.isFinite(rf.ts) || now - rf.ts > 10 * 60 * 1000) rf = S.challengeRefresh = { count: 0, ts: now };
    return rf;
  }
  function challengeRefreshCost(rf) { return rf.count < 5 ? 0 : 1 + Math.floor((rf.count - 5) / 3); }
  function openChallenge(refresh) {
    if(refresh===true||!opponents.length)genOpponents();
    const rf=challengeRefreshState(),refreshCost=challengeRefreshCost(rf);
    const refreshLabel=refreshCost?'刷新玩家（'+refreshCost+'松果）':(rf.count?'刷新玩家（免费'+(5-rf.count)+'）':'刷新玩家');
    const content='<div class="challenge-list">'+opponents.map((f,i)=>'<button class="challenger '+(selectedOpponent===i?'active':'')+'" data-foe="'+i+'"><span class="foe-level">'+f.level+'</span><span class="foe-name">'+esc(f.name)+'</span>'+spr('resource_16',3)+'</button>').join('')+'</div><div class="challenge-preview"><canvas width="390" height="292" aria-label="对手预览"></canvas>'+(selectedOpponent!=null?statsHtml(opponents[selectedOpponent],'mini-stats'):'')+'</div><div class="challenge-note"><span>点击刷新<br>下一轮玩家…</span>'+btn(refreshLabel,'refresh','small muted')+'</div>'+(selectedOpponent!=null?'<div class="preview-fight">'+btn('加好友','add-foe','small muted')+btn('挑战他','fight','small')+'</div>':'');
    const p=page('challenge','challenge',content,{counter:'1/1'});
    portrait($('.challenge-preview canvas',p),{silhouette:selectedOpponent==null,wears:[]});
    $$('[data-foe]',p).forEach(b=>b.onclick=()=>{selectedOpponent=+b.dataset.foe;openChallenge();});
    $('[data-action="refresh"]',p).onclick=()=>{
      const S=State.state(),rf2=challengeRefreshState(),c=challengeRefreshCost(rf2);
      if(S.goldPoint<c){toast('金松果不足，无法进行刷新');return;}
      if(c)S.goldPoint-=c;
      rf2.count++;rf2.ts=Date.now();State.save();
      openChallenge(true);
    };
    $('[data-action="add-foe"]',p)?.addEventListener('click',()=>{
      const foe=opponents[selectedOpponent];
      if(!foe)return;
      const r=State.addFriend(foe);
      toast(r.msg);
    });
    $('[data-action="fight"]',p)?.addEventListener('click',()=>{
      const foe=opponents[selectedOpponent],S=State.state();
      const beginChallenge = async () => {
        S.challengeRefresh={count:0,ts:Date.now()};State.save();   // 进行挑战后重置刷新费用
        try {
          await Main.startBattle(foe,{cost:10,kind:'challenge',useProps:true,onEnd:(winner)=>{
            const win=winner===0;if(win){S.dailyWins++;S.allWins++;}else{S.dailyFails++;S.allFails++;}
            const rw=State.fightReward(win,{foeLevel:foe.level});
            opponents=[];                 // 战果弹窗先压在挑战页上；下一批对手等「确定」时再抽
            openChallenge();
            // 「确定」要回到随机挑战页（并换一批新对手），而不是被弹回主界面
            resultModal(win,rw,'',()=>openChallenge(true));
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
          [{label:'使用并挑战',cls:'gold',run:()=>{
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
  function resultModal(win,rw,extra,onOk) {
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
        return '<div class="reward-card gift"><span class="reward-icon">' + icon('prop', g.id) + '</span>' +
          '<span class="reward-text">' + esc(g.name) + ' ×' + esc(g.count) + '</span></div>';
      }).join('');
      const rows = (u.reward ? '<div class="reward-card skill"><span class="reward-text">' + esc(u.reward) + '</span></div>' : '')
        + (u.wsChoice ? '<div class="reward-card skill"><span class="reward-icon"><b class="reward-badge ws-badge">选</b></span><span class="reward-text">武器/技能 三选一</span></div>' : '')
        + (u.autoPoint ? '<div class="reward-card point"><span class="reward-icon">' + pointArt(u.autoPoint) + '</span><span class="reward-text">' + STAT_CHAR[u.autoPoint] + '+' + State.STAT_GAIN[u.autoPoint] + '<span class="point-tag">系统代选</span></span></div>' : '')
        + gifts;
      return '<div class="reward-panel"><div class="reward-level">升到 ' + esc(u.level) + ' 级</div>' +
        (rows ? '<div class="reward-row">' + rows + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  function npcImage(type){return '<img alt="'+esc(type.name)+'" src="images/classic/characters/'+NPC_FILE[type.anim]+'-classic-card.png">';}
  function openStages() {
    const content='<div class="npc-select">'+GData.STAGE_TYPES.map((t,i)=> (i?'<span class="npc-arrow">➜</span>':'')+'<div class="npc-card">'+npcImage(t)+btn('挑战他','type'+i,stageTypeAvailable(i)?'gold small':'muted small')+'</div>').join('')+'</div><div class="npc-description">10级可挑战盖世五侠。依次通过六种难度，才能挑战下一位高手。每轮连续击败3名敌人，收集装备碎片！</div>'+towerEntryHtml();
    const p=page('challenge','stages',content,{cls:'stages-scroll-board'});
    [0,1,2].forEach(i=>$('[data-action="type'+i+'"]',p).onclick=()=>openDifficulty(i));
    $('[data-action="tower-entry"]',p)?.addEventListener('click',()=>openTowerEntry('tower'));
    $('[data-action="endless-entry"]',p)?.addEventListener('click',()=>openTowerEntry('endless'));
  }
  /* 无尽挑战塔入口（关卡页下滑可见）：30 级 + 18 关通关解锁。 */
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
    if(mode==='tower')TowerUI.openTower();else TowerUI.openEndless();
  }
  function stageTypeAvailable(t) {
    return [1,2,3,4,5,6].some(st=>State.stageAccess(t*6+st).ok);
  }
  function openDifficulty(t) {
    const type=GData.STAGE_TYPES[t];
    if(!type)return;
    if(!stageTypeAvailable(t)){notice(State.stageAccess(t*6+1).msg);return;}
    const content='<img class="difficulty-portrait" alt="'+type.name+'" src="images/classic/characters/'+NPC_FILE[type.anim]+'-classic-card.png"><h2 class="difficulty-title">请选择难度</h2><div class="difficulty-grid">'+[1,2,3,4,5,6].map(st=>{const id=t*6+st,passed=State.stageProgress(id).passed,run=State.stageRun(id);return '<div class="star-challenge"><div>★ '+st+(passed?'　✓':'')+'</div>'+btn(run?'继续挑战':'挑战他','star'+st,State.stageAccess(id).ok?'small':'small muted')+'</div>';}).join('')+'</div>';
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
    const text='<div class="mission-guide"><img alt="向导" src="images/classic/characters/master-classic.png"><div>【消耗】：'+cost+'<br>【奖励】：每场经验 '+GData.stageNpcExp(stageId,1)+'/'+GData.stageNpcExp(stageId,2)+'/'+GData.stageNpcExp(stageId,3)+'<br>通关得金松果'+reward.gold+'，每场胜利有几率得碎片<br><span class="small-label">现有挑战书 '+(S.props[23]||0)+' 个</span></div></div><p class="mission-description">连续击败3名敌人，后两场战斗不回满血（继承剩余血量并回复25%）。<br>当前对手：'+esc(npc.name)+'（'+idx+'/3）<br>'+(run?'本轮已复活 '+run.revives+'/2 次。':type.recommend+'。')+dailyHint+'</p>';
    const buttons=exhausted?[{label:'结束本轮',run:()=>stageAbandon(stageId)}]:[{label:run?(run.needsRevive?'复活再战':'继续战斗'):'开始战斗',run:()=>stageFight(stageId)}];
    buttons.push({label:run?'稍后继续':'返回',cls:'muted'});
    modal('关卡挑战',text,buttons,{small:true});
  }
  function stageAbandon(stageId) {
    notice('结束本轮后，下次需1个挑战书从第一名对手重新开始。已通关的记录会保留。',[
      {label:'结束本轮',run:()=>{State.abandonStageRun(stageId);openDifficulty(Math.floor((stageId-1)/6));}},
      {label:'继续本轮',cls:'gold',run:()=>stageConfirm(stageId)}
    ]);
  }
  function stageFight(stageId) {
    const started=State.beginStageBattle(stageId);
    if(!started.ok){notice(started.msg,started.needsBook?[{label:'购买挑战书',run:()=>openProp(23,true)},{label:'返回',cls:'gold',run:()=>stageConfirm(stageId)}]:undefined);return;}
    const npc=State.npcOf(stageId,started.npcIndex),type=GData.stageTypeOf(stageId);
    // 连续挑战不回满血：后两场继承上一场剩余血量，并回复25%
    const prevRun=State.stageRun(stageId),carryHp=prevRun&&Number.isFinite(prevRun.carryHp)?Math.min(1,prevRun.carryHp+0.25):undefined;
    /* 对手：三维走关卡难度系数（GData.stageNpcStats），血量已在 npcOf 里按攻略表算好；
     * 再统一套「常驻挑战当日重复惩罚」（GData.stageFoe → 今天每多赢一场，敌全属性 +5%）。
     * 只影响关卡模式；挑战塔 / 无尽塔走各自的敌人构建（tower.js 的 buildFoe），不受影响。 */
    const dailyCount=State.challengeDailyCount?State.challengeDailyCount():0;
    const foe=GData.stageFoe(npc,stageId,type.anim,dailyCount);
    const backToStage=()=>openDifficulty(Math.floor((stageId-1)/6));
    const interrupted=()=>{State.interruptStageBattle(stageId,started.token);backToStage();notice('战斗播放中断，本轮进度已保留。重新进入关卡即可继续。');};
    try { Promise.resolve(Main.startBattle(foe,{region:type.anim==='tl'?3:type.anim==='xh'?4:1,kind:'stage',useProps:false,hpRatio:carryHp,
      onError:()=>State.interruptStageBattle(stageId,started.token),
      onEnd:(w,r)=>{
        // 战斗结束后把关卡页放回背景，别让战果弹窗飘在主界面上
        backToStage();
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
  function stageResult(stageId,npc,idx,rw) {
    const back=()=>openDifficulty(Math.floor((stageId-1)/6));
    const reward='<div class="result-lines">经验 +'+rw.exp+(rw.complete?'　通关金松果 +'+rw.gold:'')+'</div>';
    let message,buttons;
    if(rw.complete){
      message='恭喜通关！三名对手全部击败。';
      buttons=[{label:'继续闯关',run:back},{label:'返回菜单',cls:'muted',run:home}];
    }else if(rw.win){
      message='已击败'+npc.name+'（'+idx+'/3）。继续挑战不再消耗挑战书，但下一场不会回满血（继承剩余血量并回复25%）。';
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
    modal('关卡战果','<div class="result-box"><div class="result-title '+(rw.win?'win':'lose')+'">'+(rw.win?'胜 利！':'再接再厉')+'</div>'+reward+'<p>'+esc(message)+'</p>'+drop+gemDrop+stageUpsHtml(rw.ups)+'</div>',buttons);
  }
  /* ============================================================
   * 【UC10】背包与道具（含出售/果实三选一）
   * ============================================================ */
  function openBag(shop,pg) {
    const exchange=shop==='exchange',mode=shop;shop=shop===true;bagPage=pg||0;
    const S=State.state(),items=[];
    propMap.each((id,v)=>{if(exchange?[24,25,26,45,46,51].includes(+id):shop?v.buy==='true':S.props[id]>0)items.push({...v,id:+id});});
    items.sort((a,b)=>a.id-b.id);
    const total=Math.max(1,Math.ceil(items.length/6));bagPage=Math.min(bagPage,total-1);
    const shown=items.slice(bagPage*6,bagPage*6+6);
    if(!shown.some(it=>it.id===selectedProp))selectedProp=shown[0]?.id||0;
    const it=shown.find(it=>it.id===selectedProp),status=shop&&it?State.purchaseStatus(it.id):null;
    const sellPrice=it&&!shop?State.propSellPrice(it.id):0;
    // 卖出只在背包的「一级界面」（右侧道具栏，紧挨着 使用/合成）出现：
    // 商店页不给卖，点开「使用」后的二级弹窗里也没有卖出。
    const mainLabel=shop?(status.remaining?'购买':'今日售罄'):([24,25,26,45,46,51].includes(it.id)||State.gemLevel(it.id))?'合成':it.id===37?'分配属性':it.useType==='1'?'使用':'查看';
    /* 按钮顺序（需求）：**卖出在左、使用/合成在右** —— 主操作仍然是最醒目的金色按钮。 */
    const bagActions=it?'<div class="bag-actions">'+
      (sellPrice&&(S.props[it.id]||0)>0?btn('卖出','prop-sell','small'):'')+
      btn(mainLabel,'prop-action','small gold')+'</div>':'';
    const info=it?'<h3>'+esc(it.name)+'</h3><div class="bag-description">'+esc(it.remark||'')+'</div><div class="bag-item-meta">'+(shop?'售价 '+it.price+' 金松果<br>今日剩余 '+status.remaining+'/'+status.limit:'拥有 '+(S.props[it.id]||0)+' 个'+(sellPrice?'　可回收 '+sellPrice+' 金松果/个':''))+'</div>'+bagActions:'<h3>背包</h3><div class="bag-description">背包空空的，去商店看看吧！</div>';
    const content='<div class="bag-layout"><div class="catalog-grid bag-grid">'+shown.map(it=>'<button class="catalog-cell '+(it.id===selectedProp?'selected':'')+'" data-prop="'+it.id+'" aria-label="'+esc(it.name)+(shop?'，'+it.price+'金松果':'，拥有'+(S.props[it.id]||0)+'个')+'" aria-pressed="'+(it.id===selectedProp)+'"><span class="item-icon">'+icon('prop',it.id,false,it.id===selectedProp)+'</span><span class="item-caption">'+(shop?it.price+' 金松果':(S.props[it.id]||0))+'</span>'+(shop?'<span class="shop-stock">今日 '+State.purchaseStatus(it.id).remaining+'/'+State.shopLimit(it.id)+'</span>':'')+'</button>').join('')+Array.from({length:6-shown.length},()=>'<div class="catalog-cell empty-slot" aria-hidden="true"><span class="item-icon"></span></div>').join('')+'</div><aside class="bag-detail" aria-live="polite">'+info+'</aside></div>'+(bagPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(bagPage<total-1?'<div class="page-arrow bag-next">'+btn('›','next','arrow')+'</div>':'');
    const bagFooter=shop?{left:btn('每日抽奖','lottery','gold entry-pill'),right:btn('金杯商店','rank-shop','gold entry-pill')}:{};
    const p=page('bag',exchange?'exchange':shop?'shop':'bag',content,Object.assign({cls:'classic-bag-board'+(shop?' shop-board':''),counter:(bagPage+1)+'/'+total},bagFooter));
    $$('[data-prop]',p).forEach(b=>b.onclick=()=>{selectedProp=+b.dataset.prop;openBag(mode,bagPage);});
    // 否则兑换页点进详情再返回会掉回背包页。
    $('[data-action="prop-action"]',p)?.addEventListener('click',()=>openProp(selectedProp,mode));
    /* 卖出：与「使用」同一套交互 —— 点「卖出」打开卖出弹窗
     * （左下「返回」/ 右下「卖出」），在弹窗里点一下卖 1 个、弹窗不关，卖光为止。 */
    $('[data-action="prop-sell"]',p)?.addEventListener('click',()=>sellDialog(selectedProp,()=>openBag(mode,bagPage)));
    if(status&&!status.remaining)$('[data-action="prop-action"]',p).disabled=true;
    $('[data-action="rank-shop"]',p)?.addEventListener('click',()=>ClassicExtras.rankShop());
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openBag(mode,bagPage-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openBag(mode,bagPage+1));
  }
  /** mode：true=商店（购买）/'exchange'=兑换页/其它=背包（使用·合成）。 */
  function openProp(id,mode) {
    const shop=mode===true,exchange=mode==='exchange';
    const backMode=shop?true:exchange?'exchange':false;   // 返回时回到来的那一页
    const base=propMap.getValue(id),S=State.state();
    if(!base)return;
    const isFragment=[24,25,26].includes(id),isConvertShard=id===GData.CONVERT_SHARD_ID,isSeed=[45,46].includes(id),isGem=State.gemLevel(id)>0,canUse=base.useType==='1';
    const status=shop?State.purchaseStatus(id):null;
    // 天使/恶魔果实种子：只提示武技是否已满，不阻止合成 ——
    // 已满时合成的天使果实仍然可以留着，等有空位再用。
    // 注意：用 State.ownedWSCount()（它把「师父驾到」排除在外）——那是拜师剧情赠送的技能，
    // 不占武器/技能上限位；旧写法直接加 S.skills.length 会在学了师父驾到后提前显示「已满」。
    const wsNow=State.ownedWSCount?State.ownedWSCount():S.weapons.length+S.skills.length,wsMax=State.wsLimit(),wsFull=wsNow>=wsMax;
    const seedNote=isSeed?('<p class="small-label">武器/技能：<b class="'+(wsFull?'ws-full':'ws-ok')+'">'+wsNow+'/'+wsMax+(wsFull?'（已满，果实仍可合成，等有空位时再使用）':'（未满，可继续获得）')+'</b></p>'):'';
    const shardNote=isConvertShard?('<p class="small-label">当前 <b>'+(S.props[id]||0)+'</b>/'+GData.CONVERT_SHARD_COST+' 个　天梯赛里点飘出来的碎片获得</p>'):'';
    // 碎片、果实种子、天梯碎片与宝石：每次合成消耗固定材料与金松果。
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
      if(shop)return status.remaining?'':'今日已经卖完了，明天再来。';
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
      '<div class="small-label">拥有 <b data-live="own">'+(S.props[id]||0)+'</b> 个'+(shop?'　售价 '+base.price+' 金松果<br>每日限购 '+status.limit+' 件，今日剩余 <b data-live="stock">'+status.remaining+'</b> 件':'')+'</div></div></div>'+
      seedNote+shardNote+potionNote+batchNote+
      (isGem?'<p class="small-label">3 个同级宝石 + 10 金松果合成高一级，成功率 '+Math.round(State.gemMergeRate(State.gemLevel(id))*100)+'%（0.88 的材料等级次方）；失败有 50% 几率一颗材料降 1 级（1级则碎裂）。</p>':'')+
      '<p class="small-label use-preview" data-live="hint" role="status"></p>';
    // 主按钮只在真的有动作时才给；否则会出现「返回」和尾部的「返回」两个按钮
    const label=shop?(status.remaining?'购买':'今日售罄'):isFragment?'合成装备':isConvertShard?'合成转化丸':isSeed?'合成果实':isGem?'合成宝石':id===37?'分配属性':canUse?'使用':'';
    // 天使/恶魔果实种子：10 个种子 + 50 金松果 → 1 个果实
    const composeFruit=(seedId)=>{
      if((S.props[seedId]||0)<10)return{ok:false,msg:'需要 10 个种子'};
      if(S.goldPoint<50)return{ok:false,msg:'合成需要 50 金松果'};
      S.props[seedId]-=10;S.goldPoint-=50;
      const fruit=seedId===45?47:48;
      S.props[fruit]=Math.min(State.PROP_HARD_CAP,(S.props[fruit]||0)+1);
      State.save();
      return{ok:true,msg:'合成成功：'+propMap.getValue(fruit).name};
    };
    // 只有「大小体力药剂」和「碎片合成」需要连着点，弹窗保持打开；
    // 商店里「非每日限购 1 件」的商品也保持打开（买完原地刷新，可以接着买）。
    const stayOpen=!shop&&(isPotion||isFragment);
    const keepOpen=stayOpen||(shop&&status&&status.limit!==1);
    const useOne=()=>{
      if(!shop&&!canUse&&!isFragment&&!isConvertShard&&!isSeed&&!isGem)return;
      if(!shop&&id===37){allocateAttributes();return;}
      // 注意顺序：宝石要先判断 isGem，否则「使用」类道具（礼包、果实、转生果…）会被当成宝石合成
      const r=shop?State.buyProp(id,1)
        :isPotion?State.useProp(id)
        :isFragment?State.composeGear(id)
        :isSeed?composeFruit(id)
        :isConvertShard?State.composeConvertPill()
        :isGem?State.mergeGems(id)
        :State.useProp(id);
      if(!r.ok&&r.needsFruitChoice){m.close();fruitChoiceDialog(r);return;}
      toast(r.msg||(r.gear?'合成成功：'+r.gear.name:'操作完成'));
      if(!r.ok)return;
      if(keepOpen){syncLive();return;}
      // 其它道具：关掉详情、退回上一级页面（背包/商店/兑换）
      m.close();
      openBag(backMode,bagPage);
    };
    const buttons=[];
    // 需要连点的（药剂/碎片/商店非限购品）设 close:false，点完不关弹窗。
    // 注意：卖出只在背包一级界面提供，这个二级弹窗里没有卖出按钮（商店更没有）。
    if(label)buttons.push({label,close:!keepOpen,run:useOne});
    buttons.push({label:'返回',cls:'muted',run:()=>openBag(backMode,bagPage)});
    const m=modal(shop?'道具商店':'道具详情',content,buttons,{small:true});
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
      // 卖光之后「卖出」不能再点
      const sellBtn=$$('.modal-buttons button',m.element).find(b=>b.textContent.trim()==='卖出');
      if(sellBtn)sellBtn.disabled=(now.props[id]||0)<1;
      refreshHeader();
    }
    syncLive();
  }
  /** 卖出道具：与「使用」同一套交互的弹窗。
   *  · 左下「返回」→ 回到背包（并把背包按最新数量重绘）
   *  · 右下「卖出」→ **卖 1 个**，弹窗不关、数字实时刷新，可以一直点；卖光后按钮禁用
   *  没有滑动条、不选数量、也不会自己退出。 */
  function sellDialog(id,after) {
    const S=State.state(),price=State.propSellPrice(id),held0=S.props[id]||0,def=propMap.getValue(id);
    if(!price||held0<1){toast('背包里没有可卖的道具');return;}
    const name=def?def.name:'道具';
    const content='<div class="detail-summary"><span class="item-icon">'+icon('prop',id)+'</span><div>'+
      '<h3 class="detail-name">'+esc(name)+'</h3>'+
      '<div class="detail-description">每个可回收 '+price+' 金松果。</div>'+
      '<div class="small-label">拥有 <b data-live="sell-held">'+held0+'</b> 个　金松果：<b data-live="sell-gold">'+S.goldPoint+'</b></div>'+
      '</div></div>';
    const m=modal('卖出道具',content,[
      {label:'返回',cls:'muted',run:()=>{m.close();if(after)after();}},
      {label:'卖出',cls:'gold',primary:true,close:false,run:()=>{
        const r=State.sellProp(id,1);
        toast(r.msg||'操作完成');
        sync();
        if(!r.ok)after&&after();
      }},
    ],{small:true});
    const sellBtn=()=>Array.prototype.slice.call(m.element.querySelectorAll('.modal-buttons button'))
      .find((b)=>b.textContent.trim()==='卖出');
    /** 只更新弹窗里的实时数字与按钮状态（不重建弹窗，避免界面跳动）。 */
    function sync(){
      const now=State.state(),held=now.props[id]||0;
      const set=(key,value)=>{const el=$('[data-live="'+key+'"]',m.element);if(el)el.textContent=value;};
      set('sell-held',held);set('sell-gold',now.goldPoint);
      /* 卖光之后只把按钮置灰即可（不再显示提示文案）。 */
      const b=sellBtn();if(b)b.disabled=held<1;
    }
    /* 右上角的 × 也能关弹窗 —— 关掉之后同样要把背包刷新到最新数量。 */
    const closeBtn=$('.modal-close',m.element);
    if(closeBtn){const prev=closeBtn.onclick;closeBtn.onclick=(e)=>{if(prev)prev.call(closeBtn,e);if(after)after();};}
    sync();
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
      { label: State.pendingWS() > 1 ? '手气不错（全部随机）' : '随便来一个', cls: 'muted', close: false, run: () => { State.chooseWSRandom(); refresh(); } },
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
      {label:'撤回上一次',cls:'muted',close:false,run:()=>{const r=State.undoPoint();if(r.ok)toast(r.msg);refresh();}},
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
  /** 升级奖励的统一入口：先选「三选一」的武器/技能，选完再分配自由属性点。 */
  function promptLevelUpChoices() {
    if($('.ws-choice-dialog'))return null;
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
    return '<img alt="" src="images/classic/icons/gear-'+g.id+'.png">';
  }
  /** 装备详情里的「套装收益」小节：两档阈值 + 当前进度 + 生效标记。
   *  家族按**装备名去掉部位后缀**算（忍者护额/拳套/服/鞋 = 忍者一套），同名跨品质都算同一套；
   *  数值按所穿该家族装备里**最低**的品质算（整套成色按最差的一件算）。 */
  function setBonusBlock(g){
    const info=State.setBonusForGear(g.id,g.quality);
    if(!info)return '';
    const label=['普通','优秀','杰出','卓越','传说'][info.quality]||'普通';
    const rows=info.tiers.map(t=>'<span class="set-tier'+(t.on?' on':'')+'">'+(t.on?'✓':'○')+' '+t.need+' 件：'+esc(t.text.join('、'))+'</span>').join('');
    const head='套装：<b class="set-name">'+esc(info.family)+'</b>　已穿 '+info.count+'/4 件'+(info.count?'（整套按最低品质「'+label+'」计）':'');
    const hint=info.count<2?'<span class="small-label">再凑到 2 件同名'+esc(info.family)+'装备即可生效</span>':'';
    return '<br>'+head+hint+'<div class="set-bonus">'+rows+'</div>';
  }
  /** 装备页顶部的一行「当前生效的套装收益」摘要（没有生效的套装时返回空串）。 */
  function setBonusSummary(){
    const list=State.setBonusList().filter(x=>x.active);
    if(!list.length)return '';
    return '<div class="gear-set-line">套装收益：'+list.map(x=>'<b>'+esc(x.family)+'</b> '+x.count+'/4（'+esc(x.text.join('、'))+'）').join('　')+'</div>';
  }
  function openGears(pg) {
    gearPage=typeof pg==='number'?pg:0;
    openStatus();
    const gears=State.myGears(),total=Math.max(1,Math.ceil(gears.length/6));gearPage=Math.min(gearPage,total-1);
    const slots=['头部','手部','身体','脚部'];
    const content='<p class="gear-note">相同的附加属性效果不叠加，最高的1条生效！</p><div class="gear-layout"><div class="gear-slots">'+slots.map((name,i)=>{const g=gears.find(x=>x.used&&x.type===i);return '<button class="catalog-cell" '+(g?'data-gear="'+esc(g.key)+'"':'disabled')+'><span class="item-icon">'+(g?gearImg(g):'<span class="gear-empty">'+name+'</span>')+'</span></button>';}).join('')+'</div><div class="gear-list">'+gears.slice(gearPage*6,gearPage*6+6).map(g=>'<button class="catalog-cell '+(g.used?'selected':'')+'" data-gear="'+esc(g.key)+'"><span class="item-icon">'+gearImg(g)+(g.used?'<span class="equipped-check">✓</span>':'')+'</span><span class="item-caption q'+g.quality+'">'+esc(g.name)+'</span></button>').join('')+(gears.length?'':'<div class="empty-state">还没有装备<br><span class="small-label">挑战关卡获得碎片<br>10个碎片可合成一件装备</span><br>'+btn('去闯关','stages','small gold')+'</div>')+'</div></div>'+(gearPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(gearPage<total-1?'<div class="page-arrow">'+btn('›','next','arrow')+'</div>':'');
    const m=modal('我的装备',content+'<span class="gear-capacity">容量 '+gears.length+'/'+State.gearCapacity()+'　'+(gearPage+1)+'/'+total+'</span>'+setBonusSummary(),[{label:'返回',cls:'gold'}]);
    const p=m.element;p.classList.add('gear-overlay');$('.classic-modal',p).classList.add('gear-modal');
    const list=$('.gear-list',p),n=gears.slice(gearPage*6,gearPage*6+6).length;
    if(n)list.insertAdjacentHTML('beforeend',Array.from({length:6-n},()=>'<div class="catalog-cell empty-slot" aria-hidden="true"><span class="item-icon"></span></div>').join(''));
    $$('.gear-slots button',p).forEach((b,i)=>{const g=gears.find(x=>x.used&&x.type===i);b.setAttribute('aria-label',slots[i]+(g?'：'+g.name:'：未装备'));});
    $$('[data-gear]',p).forEach(b=>b.onclick=()=>openGear(b.dataset.gear));
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openGears(gearPage-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openGears(gearPage+1));
  }
  let gearSellPage = 0;
  const GEAR_SELL_PER = 6;   // 3 行 × 2 列，正好铺满板面，不用滚动
  const QUALITY_LABEL = ['普通', '优秀', '杰出', '卓越', '传说'];
  function openGearSell(pg) {
    gearSellPage = Math.max(0, typeof pg === 'number' ? pg : 0);
    const gears = State.myGears().slice().reverse(), S = State.state();
    const total = Math.max(1, Math.ceil(gears.length / GEAR_SELL_PER));
    gearSellPage = Math.min(gearSellPage, total - 1);
    const shown = gears.slice(gearSellPage * GEAR_SELL_PER, gearSellPage * GEAR_SELL_PER + GEAR_SELL_PER);
    const card = (g) => {
      const r = State.gearSellRange(g.quality);
      const starred = State.isGearStarred(g);
      return '<button class="gear-sell-card q' + g.quality + (starred ? ' starred' : '') + '" data-sell="' + esc(g.key) +
        '" aria-label="' + (starred ? '已加星标，' : '') + '出售' + esc(g.name) + '">' +
        '<span class="item-icon">' + gearImg(g) + (g.used ? '<span class="equipped-check">✓</span>' : '') +
        (starred ? '<span class="gear-star" title="已加星标：不会被误融合或误出售">★</span>' : '') + '</span>' +
        '<span class="gear-sell-info"><b class="q' + g.quality + '">' + esc(g.name) + '</b>' +
        '<span class="gear-sell-price">' + r[0] + '~' + r[1] + ' 金松果</span>' +
        '<span class="gear-sell-meta">' + QUALITY_LABEL[g.quality] + (g.used ? ' · 已装备' : '') +
        (starred ? ' · <b class="star-text">已加星标</b>' : '') + '</span></span></button>';
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
    /* 星标装备受保护：不给「出售」按钮，只能先取消星标。 */
    if (State.isGearStarred(g)) {
      modal('已加星标', '<p>【' + esc(g.name) + '】已加星标，不会被误出售或误融合。</p>' +
        '<p class="small-label">想卖掉它，先点下面的「取消星标」。</p>',
        [{ label: '取消星标', cls: 'gold', run: () => {
            const r2 = State.toggleGearStar(key);
            toast(r2.msg); openGearSell(gearSellPage);
          } }, { label: '返回', cls: 'muted' }], { small: true });
      return;
    }
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
    const gemInfo=g.gem?'<br>镶嵌宝石：'+esc(propMap.getValue(g.gem.id).name)+'（主属性 +'+State.gemPercent(g.gem.id-100)+'%，附加 +'+(g.gem.ext)+'%）':'';
    const content='<div class="gear-detail"><div class="catalog-cell"><h3 class="detail-name q'+g.quality+'">'+esc(g.name)+'</h3><span class="item-icon">'+gearImg(g)+'</span><span class="small-label">'+['普通','优秀','杰出','卓越','传说'][g.quality]+'</span></div><div>装备类别：'+['头部','手部','身体','脚部'][g.type]+'　使用等级：'+g.useLevel+'<br>基本属性：'+esc(g.attrName)+' +'+g.abilityVal+(g.attrBase&&g.attrBase!==g.abilityVal?'（基准 '+g.attrBase+'，本件有浮动）':'')+'<br>附加属性：<br>'+State.extText(g.ext).map(esc).join('<br>')+gemInfo+setBonusBlock(g)+'</div></div>';
    const buttons=[{label:g.used?'卸下':'装备',run:()=>{const ok=g.used?State.unwear(key):State.wear(key);if(ok===false)toast('等级不足，暂时无法装备');openGears(gearPage);}}];
    if(g.orange){
      if(g.gem)buttons.push({label:'拆卸宝石（5金）',run:()=>{const r=State.unsocketGem(key);toast(r.msg);openGear(key);}});
      else buttons.push({label:'镶嵌宝石',cls:'gold',run:()=>socketGemDialog(key)});
    }
    /* 星标：防止手滑把好装备卖掉/合掉（融合与出售都会跳过星标装备）。 */
    const starred = State.isGearStarred(g);
    buttons.push({label: starred ? '取消星标' : '星标', cls: starred ? 'gold' : 'muted',
      run:()=>{const r=State.toggleGearStar(key);toast(r.msg);openGear(key);}});
    if(!starred){
      buttons.push({label:'出售',cls:'muted',run:()=>notice('确定以 '+(State.gearSellRange(State.gearQuality(g))[0])+'~'+(State.gearSellRange(State.gearQuality(g))[1])+' 金松果出售【'+g.name+'】吗？',[{label:'出售',run:()=>{const got=State.sellGear(key);toast('卖出【'+g.name+'】，获得 '+got+' 金松果');openGears(gearPage);}},{label:'返回',cls:'muted'}])});
    }
    buttons.push({label:'返回',cls:'muted'});
    modal((starred ? '★ ' : '') + '我的装备', content + (starred ? '<p class="small-label star-text">已加星标：不会被误融合或误出售。</p>' : ''), buttons);
  }
  // 镶嵌宝石：列出背包里各级宝石供选择，镶嵌免费
  function socketGemDialog(key) {
    const S=State.state();
    const gems=[101,102,103,104,105,106,107].filter(id=>(S.props[id]||0)>0);
    if(!gems.length){notice('背包里没有宝石。45级后通关关卡或在竞技场获胜有几率获得。',[{label:'知道了'}]);return;}
    modal('选择宝石','<div class="gem-pick">'+gems.map(id=>'<button type="button" class="help-item" data-gem="'+id+'"><span class="item-icon">'+icon('prop',id)+'</span><span>'+esc(propMap.getValue(id).name)+' ×'+S.props[id]+'</span></button>').join('')+'</div><p class="small-label">镶嵌免费；附加属性提升幅度随机，可先拆卸（5金松果）再镶嵌来重随。</p>',[{label:'返回',cls:'muted'}],{small:true});
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
    $$('[data-replay]',p).forEach(b=>b.onclick=()=>{const r=list.find(x=>x.id===b.dataset.replay);Main.replayBattle(r,()=>openMessages(tab,pg));});
    $$('[data-revenge]',p).forEach(b=>b.onclick=()=>{const r=list.find(x=>x.id===b.dataset.revenge);if(r)revengeFight(r,()=>openMessages(tab,pg));});
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openMessages(tab,pg-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openMessages(tab,pg+1));
  }
  /** 复仇：拿录像里记下的对手快照再打一场（不消耗体力、不掉飘物，避免变成刷资源入口）。
   *  胜利 → State.revengeReward 发少量经验与金松果，并把这条记录标成「已复仇」。 */
  function revengeFight(record, back) {
    const foe=Object.assign({},record.foe);
    Main.startBattle(foe,{region:record.region||0,kind:'revenge',useProps:false,collectDrops:false,onEnd:(winner)=>{
      back();
      const win=winner===0;
      if(!win){modal('复仇失败','<div class="result-box"><div class="result-title lose">又输了</div><p>再来一次吧 —— 复仇不消耗体力，失败也没有额外损失。</p></div>',[{label:'返回',run:back}]);return;}
      if(!State.markRevenged(record.id)){
        modal('复仇成功','<div class="result-box"><div class="result-title win">胜 利！</div><p>这条败绩之前已经复仇过了，本次不再重复发补偿。</p></div>',[{label:'返回',run:back}]);
        return;
      }
      const rw=State.revengeReward(foe.level);
      resultModal(true,rw,'复仇成功：'+esc(foe.name)+' 已被击败，补回少量经验与金松果。',back);
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
    Main.startBattle(foe,{cost:0,kind:'friend',useProps:false,collectDrops:false,region:0,
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
    const gift = '<div class="daily-gift"><div class="daily-gift-text"><h3>每日礼包</h3><p>每天回家都有一份小礼物：金松果 ×150、挑战书 ×1</p></div>' +
      btn(d.claimed ? '今日已领取' : '领取礼包', 'claim-gift', d.claimed ? 'muted' : 'gold') + '</div>';
    const rewardIcon = (r) => r.kind === 'gold' ? spr('resource_1', 18)
      : r.kind === 'exp' ? '<img alt="" src="images/classic/new-reference/drop-exp-classic.png">'
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
    const m = modal('活动', gift + list, [
      { label: '每日抽奖', cls: 'gold', run: () => { if (window.ClassicExtras && ClassicExtras.lottery) ClassicExtras.lottery(); } },
      { label: '返回', cls: 'muted' },
    ]);
    const rerender = () => { m.close(); openDaily(); refreshHome(); refreshHeader(); };
    $('[data-action="claim-gift"]', m.element)?.addEventListener('click', () => { toast(State.claimDaily().msg); rerender(); });
    quests.forEach((q) => {
      const b = $('[data-action="quest' + q.index + '"]', m.element);
      if (b) b.addEventListener('click', () => { toast(State.claimQuest(q.index).msg); rerender(); });
    });
  }
  /** 系统页里的「存档位置」一块：显示进度到底存在哪儿，并提供手动写入/载入。 */
  function saveFilePanel() {
    const info = State.fileInfo ? State.fileInfo() : { mode: 'local', available: false, checked: false };
    if (!info.checked) { void State.fileProbe().then(() => { if (screen === 'system') openSystem(); }); }
    let state;
    if (info.mode !== 'file') {
      state = '<b class="sync-off">浏览器里（兜底）</b><span class="small-label">' +
        esc(info.reason || '没有本地服务器，进度暂存在这个浏览器的 localStorage。') +
        '<br>用启动器或 <code>node serve.js</code> 打开游戏，进度就会写进 <code>save/progress.json</code>。</span>';
    } else if (info.conflict) {
      state = '<b class="sync-warn">文件里的进度更新（' + State.syncFormatTime(info.fileAt) + '）</b><span class="small-label">点「载入存档文件」把它取过来（不会静默覆盖）</span>';
    } else {
      state = '<b class="sync-on">' + esc(info.path || 'save/progress.json') + '</b><span class="small-label">最后写入 ' + State.syncFormatTime(info.lastWrite) +
        '　最后载入 ' + State.syncFormatTime(info.lastLoad) + (info.dirty ? '　（有改动正在写入…）' : '') + '</span>';
    }
    const useFile = info.mode === 'file';
    return '<div class="sync-panel"><div class="sync-head">存档位置：' + state + '</div>' +
      '<div class="sync-actions">' + btn('立即写入存档文件', 'save-write', 'small' + (useFile ? '' : ' muted')) +
      btn('载入存档文件', 'save-load', 'small' + (useFile ? '' : ' muted')) +
      btn('从存档列表导入', 'save-import-list', 'small') + '</div></div>';
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
        input.accept = '.json,application/json';
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
      buttons.push({ label: '用存档文件覆盖', run: async () => {
        const r = await State.fileLoad();
        toast(r ? '已载入存档文件' : '载入失败');
        if (r) { refreshHome(); openSystem(); }
      } });
    }
    buttons.push({ label: '选择本地文件…', cls: useFile ? 'muted' : '', run: () => importSave() });
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
  /** 把一份存档 JSON 写进正式存档：文件模式先备份再强制写回，兜底模式写 localStorage。 */
  async function applyImportedSave(raw, data) {
    let info = State.fileInfo ? State.fileInfo() : {};
    if (info.mode !== 'file' && State.fileProbe) {
      try {
        if (await State.fileProbe()) info = State.fileInfo ? State.fileInfo() : info;
      } catch (e) { /* 探针失败就照旧走兜底模式 */ }
    }
    if (State.storageMode && State.storageMode() === 'file') info = Object.assign({}, info, { mode: 'file' });
    if (info.mode === 'file') {
      // 先留快照：显式导入会覆盖当前进度（服务器把旧档放进 save/backup/）
      let backup = '';
      try {
        const b = await fetch('/__save/backup', { method: 'POST', cache: 'no-store' });
        const bj = await b.json();
        if (bj && bj.ok && bj.backup) backup = bj.backup;
      } catch (e) { /* 备份失败也允许继续，下面会提示 */ }
      // 显式导入 = 玩家确认过，所以带 force=1（否则会被水位线拦下）
      const w = await fetch('/__save?force=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
      const wj = await w.json().catch(() => ({}));
      if (!w.ok || wj.ok === false) throw new Error(wj.msg || ('写回存档文件失败（HTTP ' + w.status + '）'));
      const ok = await State.fileLoad();
      if (!ok) throw new Error('存档文件写进去了，但重新读取失败 —— 刷新一下页面就能看到导入的档');
      afterSaveImport(data.name, data.level, backup);
      return true;
    }
    const old = localStorage.getItem(State.saveKey);
    try {
      if (old) localStorage.setItem(State.saveKey + '_backup', old);
      localStorage.setItem(State.saveKey, raw);
      if (!State.load()) throw new Error('读取存档失败');
      State.save();
      afterSaveImport(data.name, data.level, '');
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
   * 是本机的同步服务 tools/sync/sync.js（默认监听 127.0.0.1:8788）。
   * 所以这里只是它的一个遥控器：/local/status 看状态，/local/save/{push,pull}
   * 与 /local/files/{push,pull} 让它去和对端说话。服务没开就只提示，不报错。
   * 端口在 tools/sync/sync.config.json 里可改；改了这里也要跟着改。
   * ============================================================ */
  const SYNC_API = 'http://127.0.0.1:8788';
  const syncState = { checked: false, ok: false, info: null, reason: '', busy: false, job: null, result: null, timer: 0 };

  /* ============================================================
   * 【UC16】云同步（上传/下载/进度）
   * ============================================================ */
  async function syncFetch(pathname, opts) {
    opts = opts || {};
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeout || 15000) : 0;
    try {
      const res = await fetch(SYNC_API + pathname, { method: opts.method || 'GET', signal: ctl ? ctl.signal : undefined });
      let body = null;
      try { body = await res.json(); } catch (e) {}
      if (!res.ok) { const err = new Error((body && body.msg) || ('同步服务返回 HTTP ' + res.status)); err.body = body; throw err; }
      if (!body) throw new Error('同步服务返回了看不懂的内容');
      return body;
    } finally { if (timer) clearTimeout(timer); }
  }
  async function syncProbe() {
    try {
      const info = await syncFetch('/local/status', { timeout: 2500 });
      syncState.ok = true; syncState.info = info; syncState.reason = '';
    } catch (e) {
      syncState.ok = false; syncState.info = null;
      const raw = (e && e.name === 'AbortError') ? '同步服务没有响应（超时）' : String((e && e.message) || e);
      /* 常见两类要分开说：
       *  · 403 → 同步服务拒了本页面的来路（桌面客户端/局域网 IP 打开时会这样）
       *  · Failed to fetch → 本机同步服务没在跑（或端口不是 8788）
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
      case 'PEER_DOWN': return '对端的同步服务没在跑，或者对端防火墙没放行 8788。到那台机器上双击「一键同步」→「9) 后台同步服务 → 1) 启动」，Windows 上还会弹一次 UAC 放行（或跑一次 prepare）。Mac 上想确认本机是否正常：菜单里选 c) 自检。';
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
        esc(syncState.reason || '本机 127.0.0.1:8788 上没有同步服务。') +
        '<br>双击游戏目录里的 <code>一键同步.command</code>（Mac）或 <code>一键同步.cmd</code>（Windows），' +
        '选一次「启动后台同步服务」，这里就能一键互传存档。</span>';
    } else if (!peers.length) {
      state = '<b class="sync-warn">还没找到另一台电脑</b><span class="small-label">本机叫「' + esc(info.name || '?') +
        '」，ZeroTier 地址 ' + esc((info.selfIps || []).join('、') || '未检测到') +
        '。点「扫描对端」，或者在对面的机器上跑一次同步菜单里的「扫描」。</span>';
    } else {
      state = '<b class="sync-on">已连上：' + peers.map((k) => esc(k) + '（' + esc(info.peers[k]) + '）').join('、') +
        '</b><span class="small-label">本机「' + esc(info.name || '?') + '」　' + saveLine(info.save, '本机存档') + '</span>';
    }
    let actions = '';
    if (syncState.ok && peers.length) {
      const dis = syncState.busy ? ' muted' : '';
      actions = btn('把存档送过去', 'sync-save-push', 'small gold' + dis) + btn('取回对面存档', 'sync-save-pull', 'small gold' + dis) +
        btn('推改动的文件', 'sync-files-push', 'small' + dis) + btn('拉改动的文件', 'sync-files-pull', 'small' + dis);
    } else if (syncState.ok) {
      actions = btn('扫描对端', 'sync-discover', 'small') + btn('重新检测', 'sync-recheck', 'small muted');
    } else {
      actions = btn('重新检测', 'sync-recheck', 'small');
    }
    const prog = syncProgressHtml();
    return '<div class="sync-panel"><div class="sync-head">跨设备同步：' + state + '</div>' +
      '<div class="sync-actions">' + actions + '</div>' +
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
        '<div class="sp-actions">' + btn('打开下载页', 'update-page', 'small gold') + '</div>';
    }
    const done = r.mode === 'release' && r.kind && r.kind !== 'zip';
    const head = done ? '已下载并打开安装包' : '更新完成';
    const detail = done
      ? esc(String(r.asset && r.asset.name || '')) + ' → <code>' + esc(String(r.path || '')) + '</code>，按安装向导走完即可（装完记得重开客户端）。'
      : (r.tag ? '已更新到 <b>' + esc(String(r.tag)) + '</b>　' : '') +
        (r.files ? '覆盖 ' + r.files + ' 个文件' : '') + (r.bytes ? '（' + sizeText(r.bytes) + '）' : '') +
        (r.msg ? esc(String(r.msg)) : '') + '　<b>请刷新页面</b>（轻壳 / 便携版刷新即生效）。';
    return '<div class="sp-head"><b class="sync-on">' + head + '</b></div><div class="sp-hint">' + detail + '</div>' +
      '<div class="sp-actions">' + btn('立即刷新', 'update-reload', 'small gold') + btn('打开下载页', 'update-page', 'small') + '</div>';
  }
  /** 系统页里的「游戏更新」面板。 */
  function updatePanelHtml() {
    const loc = updState.local || {};
    const g = updState.git || {};
    const rel = updState.release || {};
    const peers = Object.keys((syncState.info || {}).peers || {});
    let head = '游戏更新：<b>本机 ' + (loc.version ? esc(String(loc.version)) : '未检查') + '</b>';
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
      if (syncState.ok && peers.length) actions += btn('从另一台电脑更新', 'update-source-sync', 'small gold' + dis);
      if (rel.ok) actions += btn('从 GitHub 更新' + (rel.kind === 'zip' ? '（就地覆盖）' : '（下载安装包）'), 'update-source-release', 'small gold' + dis);
      if (g.isRepo) actions += btn('用 git 拉取', 'update-source-git', 'small gold' + dis);
      actions += btn('打开下载页', 'update-page', 'small');
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
    return '<div class="sync-panel update-panel"><div class="sync-head">' + head + '</div>' +
      '<div class="sync-actions">' + actions + '</div>' + tail +
      '<div class="sync-progress" id="update-progress" style="display:none"></div></div>';
  }

  function openSystem() {
    const mute=Main.isMuted&&Main.isMuted();
    const vol=Math.round(100*((Main.volume&&Main.volume())||0));
    const st=(Main.settings&&Main.settings())||{resolution:'auto',fullscreen:false};
    const slider='<div class="setting-slider" data-slider="volume"><span class="slider-label">音乐音量</span>'+
      '<input type="range" min="0" max="100" step="1" value="'+vol+'" aria-label="音乐音量">'+
      '<b class="slider-value">'+vol+'%</b></div>';
    const resolutions=State.RESOLUTIONS||[];
    const resShort=(r)=>!r?'自动':r.key==='auto'?'自动':r.label.replace(' × ','×');
    const resIndex=Math.max(0,resolutions.findIndex((r)=>r.key===st.resolution));
    const resNow=resolutions[resIndex]||resolutions[0];
    const sysBtn=(label,action,cls,title)=>'<button type="button" class="uc-button '+(cls||'')+'" data-action="'+action+'"'+
      (title?' title="'+esc(title)+'"':'')+'>'+esc(label)+'</button>';
    const grid='<div class="settings-grid system-grid">'+
      sysBtn(mute?'音乐：关':'音乐：开','sound','','音乐开关')+
      sysBtn('导出存档','export','gold','把当前存档导出成一个 JSON 文件')+
      sysBtn('导入存档','import','gold','从 JSON 文件恢复存档')+
      sysBtn('更改昵称','rename','','给松鼠换个名字')+
      sysBtn('分辨率：'+resShort(resNow),'resolution','','点一下换下一档：'+
        resolutions.map((r)=>r.label).join(' → ')+'。画面按这一档等比缩放并居中；窗口装不下时自动按窗口缩小，不会溢出。')+
      sysBtn(st.fullscreen?'全面屏：开':'全面屏：关','fullscreen','','开启后画面铺满整个窗口（不留黑边，窗口比例差得多时会有轻微拉伸），同时尝试进入系统全屏；按 Esc 可退出系统全屏。')+
      '</div>';
    const p=page('system','system',supportPanelHtml()+grid+slider+saveFilePanel()+syncPanel()+updatePanelHtml());
    $('[data-action="support"]',p).onclick=()=>openSupportModal();
    $('[data-action="sound"]',p).onclick=()=>{Main.setMuted(!mute);openSystem();};
    $('[data-action="save-write"]',p).onclick=async()=>{const r=await State.fileWriteNow();toast(r.msg||(r.ok?'已写入':'写入失败'));openSystem();};
    $('[data-action="save-load"]',p).onclick=loadSaveDialog;
    /* 从服务器存档列表导入：绕过系统文件选择器（桌面壳里也能用），列表里带等级与时间。 */
    $('[data-action="save-import-list"]',p).onclick=async()=>{
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
    syncBtn('sync-save-push',()=>syncRun('save','push'));
    syncBtn('sync-save-pull',()=>syncRun('save','pull'));
    syncBtn('sync-files-push',()=>syncRun('files','push'));
    syncBtn('sync-files-pull',()=>syncRun('files','pull'));
    // 进度区里的按钮是每次重绘 innerHTML 生成的，用事件委托挂，避免重绘后失效
    const syncPanelEl=$('.sync-panel',p);
    if(syncPanelEl)syncPanelEl.addEventListener('click',(ev)=>{
      const t=ev.target&&ev.target.closest?ev.target.closest('[data-action="sync-force"]'):null;
      if(!t||!syncState.result)return;
      syncRun(syncState.result.kind,syncState.result.dir,true);
    });
    syncBtn('sync-discover',async()=>{
      toast('正在扫描 ZeroTier 网段…');
      try{await syncFetch('/local/discover',{timeout:30000});}catch(e){toast(String((e&&e.message)||e));}
      syncState.checked=false;
      if(screen==='system')openSystem();
    });
    syncBtn('sync-recheck',()=>{syncState.checked=false;syncState.ok=false;syncState.info=null;openSystem();});
    // 音量滑块：拖动即时生效；拖到 0 等同静音，拉回来自动取消静音
    const range=$('[data-slider="volume"] input',p),value=$('[data-slider="volume"] .slider-value',p);
    fillRange(range);
    range.oninput=()=>{
      const v=Main.setVolume(Number(range.value)/100);
      value.textContent=Math.round(100*v)+'%';
      fillRange(range);
    };
    range.onchange=()=>{
      const v=Math.round(100*((Main.volume&&Main.volume())||0));
      const on=!(Main.isMuted&&Main.isMuted());
      $('[data-action="sound"]',p).textContent=on?'音乐：开':'音乐：关';
      toast('音乐音量 '+v+'%'+(!on?'（已静音）':'')+'（已存进存档）');
    };
    // 分辨率：点一下换下一档（循环），改完立刻生效并写进存档，页面重绘让按钮文字跟上
    const resBtn=$('[data-action="resolution"]',p);
    if(resBtn)resBtn.onclick=()=>{const next=resolutions[(resIndex+1)%resolutions.length];Main.setResolution(next.key);openSystem();};
    const fsBtn=$('[data-action="fullscreen"]',p);
    if(fsBtn)fsBtn.setAttribute('data-fullscreen','1');
    if(fsBtn)fsBtn.onclick=()=>{Main.setFullscreen(!Main.settings().fullscreen);openSystem();};
    $('[data-action="export"]',p).onclick=()=>{
      const blob=new Blob([JSON.stringify(State.state(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='松鼠大战存档-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('存档已导出');
    };
    $('[data-action="import"]',p).onclick=importSave;
    $('[data-action="rename"]',p).onclick=()=>{
      const m=modal('更改昵称','<p>给你的松鼠起个名字</p><input id="rename-input" maxlength="12" value="'+esc(State.state().name)+'" style="width:100%;padding:14px;border:3px solid #b39763;border-radius:18px;color:#715231;background:#fffdf1">',[{label:'确定',close:false,run:()=>{const name=$('#rename-input',m.element).value.trim();if(!name){toast('名字不能为空');return;}State.state().name=name;State.save();m.close();refreshHome();}},{label:'返回',cls:'muted'}],{small:true});
    };
  }
  function importSave() {
    void pickJsonFile().then(async (file) => {
      if (!file) return;                       // 用户取消
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('存档文件过大（上限 8 MB）');
        const raw = await readFileText(file);
        let data;
        try { data = JSON.parse(raw); } catch (e) { throw new Error('这个文件不是合法的 JSON'); }
        const bad = saveDataError(data);
        if (bad) throw new Error(bad + '，不是有效的松鼠大战存档');
        const info = State.fileInfo ? State.fileInfo() : {};
        const nowLevel = (State.state() || {}).level;
        const where = info.mode === 'file'
          ? '会覆盖磁盘上的正式存档 ' + (info.path || 'save/progress.json') + '（旧档先自动备份到 save/backup/）'
          : '会覆盖这个浏览器里的兜底存档（旧档先留在 localStorage 备份键里）';
        notice('导入【' + data.name + '】' + data.level + ' 级的存档？\n\n' + where +
          (nowLevel ? '。当前进度：' + nowLevel + ' 级。' : '。'),
          [{ label: '导入', run: async () => {
            try { await applyImportedSave(raw, data); }
            catch (e) { toast(e.message || '导入失败'); }
          } }, { label: '取消', cls: 'muted' }]);
      } catch (e) { toast(e.message || '无法读取存档'); }
    });
  }
  function openVillage() {
    // 村庄里的选项统一用金黄色（原先是黄绿混着填的，看着花）
    const p=page('system','village','<div class="settings-grid">'+btn('师徒','master','gold')+btn('竞技场','arena','gold')+btn('天梯赛','rank','gold')+btn('道具商店','shop','gold')+btn('每日抽奖','lottery','gold')+btn('挑战关卡','stages','gold')+'</div><p class="system-caption">欢迎来到松鼠村庄！<br>拜师学艺、收集装备，和松鼠伙伴一起成长。</p>');
  }
  // —— 可获得物品图鉴（系统-帮助）：来源概率从真实数据（掉落池/商店/抽奖）计算 ——
  const GUIDE_ITEMS = [1,2,3,4,5,6,7,8,9,10,11,12,13,15,16,17,18,19,21,22,23,24,25,26,28,29,30,31,32,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,101,102,103,104,105,106,107];
  function guideSources(id) {
    const lines = [];
    const pool = (window.BattleDrops && BattleDrops.pool) || [];
    const total = pool.reduce((n, p) => n + p.weight, 0);
    const drop = pool.find((p) => p.id === id);
    if (drop) {
      const per = drop.weight / total;
      lines.push('战斗拾取：每张拾取卡 ' + (per * 100).toFixed(1) + '%，每场战斗 3 张卡，期望 ' + (per * 3 * drop.count).toFixed(2) + (id === 15 ? ' 点/场' : ' 个/场'));
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
    if (id === 23) lines.push('每日礼包：每天 1 个（另附 150 金松果）');
    if (id === 28) lines.push('创建角色时获得 1 个');
    if (id === 29) lines.push('打开「1级礼包」获得');
    if (id === 30) lines.push('打开「5级礼包」获得');
    if (id === 31) lines.push('打开「10级礼包」获得');
    if (id === 32) lines.push('打开「15级礼包」获得');
    if (id === 37) lines.push('升级奖励：53、59、65 级时各获得 1 本');
    if ([41, 42, 43, 44].includes(id)) lines.push('金杯商店（每天开放）：20 金杯 + 20 金松果，积分需 800，不限兑换次数');
    if ([16, 17, 18, 19].includes(id)) lines.push('金杯商店（每天开放）：500 金杯 + 100 金松果，积分需 1500，每周限兑 1 次（每周一重置）');
    if ([21, 22].includes(id)) lines.push('金杯商店（每天开放）：100 金杯 + 100 金松果兑换 100 个，积分需 1200，每周限兑 1 次（每周一重置）');
    if (id === 40) lines.push('天梯赛：胜利 +3 杯、落败 +1 杯，获胜有 25% 概率额外夺得 3 杯');
    if (id === 47) lines.push('合成：天使果实种子 ×10 + 50 金松果（背包中合成）');
    if (id === 48) lines.push('合成：恶魔果实种子 ×10 + 50 金松果（背包中合成）');
    if (id === 8) lines.push('挑战胜利：3～7 个/场；通关关卡整轮：25 个；各级礼包中也有');
    if (id >= 101 && id <= 107) {
      const lv = id - 100;
      if (lv <= 2) lines.push('45 级起：通关关卡 20% 几率、竞技场（经验/碎片）获胜 15% 几率获得（一级 75% / 二级 25%）');
      if (lv < 7) lines.push('合成：3 个同级 + 10 金松果，成功率 ' + Math.round(State.gemMergeRate(lv) * 100) + '%（失败有 50% 几率一颗材料降 1 级，1级则碎裂）');
      lines.push('镶嵌：免费镶入橙装（3 件相同紫装融合而来），主属性 +' + State.gemPercent(lv) + '%（沿用原版曲线 5×(n²−n+2)），附加属性效果随机提升，每件限 1 颗；拆卸 5 金松果');
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
    const items = GUIDE_ITEMS.map((id) => '<button type="button" class="help-item" data-guide="' + id + '"><span class="item-icon">' + icon('prop', id) + '</span><span>' + esc(propMap.getValue(id).name) + '</span></button>').join('');
    // 帮助是「系统」分组下的正常页面（以前是弹窗，会挡住底下的界面）
    const p = page('system', 'help', '<div class="help-box"><p><b>挑战</b>：选择对手，再点「挑战他」。每场消耗10体力，战斗自动进行。</p><p><b>属性</b>：力量影响伤害，敏捷影响闪避，速度影响出手次数。战斗中随机使用已获得的武器与技能。</p><p><b>成长</b>：战斗获得经验，升级有机会领悟武器与技能。在状态页查看和升级。</p><p><b>体力</b>：每5分钟恢复1点，也可以在道具中使用体力药剂。</p><p><b>关卡</b>：10级开启，按顺序挑战。每轮消耗1张挑战书，连续击败3名敌人；失败最多复活2次，每次再消耗1张。10个装备碎片可合成装备，3件相同装备可以融合。</p><p><b>竞技场</b>：11级开启经验竞技场、20级开启碎片竞技场，报名一次打完两场。</p><p><b>天梯赛</b>：30级开启，胜利得金杯与天梯积分，金杯可在金杯商店兑换稀有奖励。</p><p><b>录像</b>：最近50场战斗保存在消息页，回放不消耗体力，也不会重复发放奖励。</p><p><b>存档与设置</b>：自动保存。可在系统中导出、导入；音乐音量、静音、分辨率与全面屏这些设置也一起存进存档，换机器同步后照旧生效。</p><p><b>宝石</b>：45级后通关关卡、竞技场获胜有几率获得1-2级宝石；3个同级宝石+10金松果有几率合成高一级（失败可能降级）。3 件相同卓越（紫）装备可在「装备融合」里融为传说（橙）装备，宝石免费镶入橙装（每件限1颗），拆卸5金松果。融合时凑 2~3 件同名：大概率保住原名，小概率变异成狂战装备。</p><p><b>套装收益</b>：同名装备算一套（「忍者护额/拳套/服/鞋」都是忍者套），穿满 <b>2 件 / 4 件</b>各给一档额外收益，4 件档叠加在 2 件档之上；收益按所穿该套里<b>最低品质</b>的那一件算，想拿满就得一整套同品质。代价是要放弃「跨套挑词条」的自由 —— 极品词条与套装收益只能二选一。每套的收益特征跟着名字走（忍者=闪避、骑士=减伤、狂战=低血狂暴……），在装备详情里能看到当前进度与下一档给什么。</p><h3 class="help-items-title">可获得物品一览</h3><div class="help-items">' + items + '</div><p class="small-label">点击物品可查看效果、获取方式以及具体的概率与期望；标注“暂无产出途径”的为图鉴预留物品。</p></div>', { cls: 'help-board' });
    $$('[data-guide]', p).forEach((b) => b.onclick = () => openGuideItem(+b.dataset.guide));
    return p;
  }
  /* ============================================================
   * 【UC18】兜底分发与导出 UI.classic
   * ============================================================ */
  function fallback(key){if(window.ClassicExtras && window.ClassicExtras[key])window.ClassicExtras[key]();else legacy.runAction(key);}
  const actions={home,exchange:()=>openBag('exchange'),status:openStatus,weapons:()=>openCatalog('weapon'),skills:()=>openCatalog('skill'),challenge:()=>openChallenge(),battle:()=>openChallenge(),stages:openStages,bag:()=>openBag(),shop:()=>openBag(true),gears:()=>openGears(),messages:()=>openMessages(),ranklog:()=>openMessages('ranklog'),revenge:()=>openMessages('revenge'),board:openBoard,chat:openChat,'gear-sell':()=>openGearSell(0),friends:openFriends,daily:openDaily,system:openSystem,village:openVillage,help:openHelp,arena:()=>fallback('arena'),rank:()=>fallback('rank'),lottery:()=>fallback('lottery'),master:()=>fallback('master'),toplist:()=>fallback('toplist'),vip:()=>fallback('vip')};
  function runAction(key){if(actions[key])actions[key]();}
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      const dialogs=$$('.classic-modal-overlay');
      if(dialogs.length){
        // 自由属性点弹窗必须选完，Esc 也不放行
        const closeBtn=$('.modal-close',dialogs[dialogs.length-1]);
        if(closeBtn){closeBtn.click();return;}
      }
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
        { label: '知道了', cls: 'muted' }], { small: true });
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
      '不打赏完全不影响游戏内容与平衡，也不解锁任何东西。</p>' +
      '<p class="support-link">' + esc(meta.label) + '：<span class="support-url">' + esc(meta.url) + '</span></p>' +
      '</div>';
    return modal('支持作者', body, [
      { label: '用浏览器打开' + meta.label, cls: 'gold', run: () => openSupportLink(meta.url) },
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
  function supportPanelHtml() {
    const meta = supportMeta();
    return '<div class="support-panel">' +
      '<div class="support-panel-text"><b>喜欢这个复刻版？</b>' +
      '<span>游戏完全免费、没有内购；如果它让你找回了一点当年的感觉，可以自愿支持作者（不影响任何游戏内容）。</span></div>' +
      '<button type="button" class="uc-button gold support-btn" data-action="support" title="用系统浏览器打开' +
      esc(meta.label) + '">支持作者</button></div>';
  }

  window.UI={...legacy,renderHome,drawHomeHud,drawActor,runAction,currentScreen:()=>screen,refreshHome,renderNumbers,refreshHeader,
    classic:{page,modal,btn,bind,icon,spr,statsHtml,portrait,resultModal,stageResult,home,toast,num,setNum,upgradeReward,upsHtml,pickupResult,freePointDialog,promptFreePoints,promptLevelUpChoices,wsChoiceDialog,openSupportModal,maybeSupportPrompt,supportPanelHtml,copyText,supportMeta,
      updatePanelHtml,updateCheck,updateAsk,updateRun,updateFetch,updState,UPDATE_PAGE},
    weaponIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('weapon',id)+'">',
    skillIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('skill',id)+'">',
    propIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('prop',id)+'">'};
})();
