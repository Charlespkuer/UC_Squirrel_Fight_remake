/* Classic UC screens reconstructed from references. Gameplay remains in State / Sim. */
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
  const buttonArt = { '返回菜单':'return-menu', '更换装备':'change-equipment' };
  const btn = (label, action, cls) => '<button type="button" class="uc-button ' + (cls || '') + '" data-action="' + esc(action) + '">' + (buttonArt[label] ? '<span class="reference-button-label">'+esc(label)+'</span><img alt="" class="classic-button-art" src="images/classic/new-reference/buttons/'+buttonArt[label]+'.png">' : esc(label)) + '</button>';
  const spriteCache = Object.create(null);
  let screen = 'home', timer = 0, activePortrait = null, lastRefresh = 0;
  let catalogPage = 0, bagPage = 0, gearPage = 0;
  let selectedProp = 0;
  const selectedItems = {weapon:0,skill:0};
  let opponents = [], selectedOpponent = null;
  let heroWears = [], wearSignature = '', wearRequest = '';
  // 主页限时药丸角标：id → 效果简述（与 State.useProp/totalStats 的生效口径一致）
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
  const NUM_SHEET = 'images/num_28.png', NUM_W = 26, NUM_H = 23;
  const NUM_KEYS = '0123456789%×';
  const numImage = new Image(); numImage.src = NUM_SHEET;
  const numeral = (n) => String(n == null ? '' : n).replace(/[^0-9%×/.,:+-]/g, '');
  const numStretch = () => (window.Debug && Debug.numberStretch ? Debug.numberStretch() : 1.25);

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
      const k = height / NUM_H, cell = NUM_W * k * stretch;
      const width = Math.max(1, Math.round(text.length * cell));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const cx = canvas.getContext('2d');
      cx.clearRect(0, 0, width, height);
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      for (let i = 0; i < text.length; i++) {
        const at = NUM_KEYS.indexOf(text[i]);
        if (at >= 0) {
          cx.drawImage(numImage, at * NUM_W, 0, NUM_W, NUM_H, i * cell, 0, cell, height);
        } else {
          // 位图里没有的符号（如 "/"）用文字补齐，字号与数字同高。
          cx.font = 'bold ' + Math.round(height * 0.86) + 'px "Microsoft YaHei",sans-serif';
          cx.textAlign = 'center';
          cx.textBaseline = 'middle';
          cx.lineWidth = Math.max(1.5, height * 0.09);
          cx.strokeStyle = 'rgba(94,100,106,.95)';
          cx.fillStyle = '#fdfdfa';
          cx.strokeText(text[i], (i + 0.5) * cell, height * 0.55);
          cx.fillText(text[i], (i + 0.5) * cell, height * 0.55);
        }
      }
      block.style.setProperty('--w', (text.length * (NUM_W / NUM_H) * stretch).toFixed(4) + 'em');
    }
  }
  function bindNumImage() {
    if (numImage.complete && numImage.naturalWidth) renderNumbers();
    else numImage.addEventListener('load', () => renderNumbers(), { once: true });
  }
  bindNumImage();

  function num(value) {
    const text = numeral(value);
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
    renderNumbers(host);
  }
  // Original atlases alternate a colour row and a grey row. Item IDs retain gaps.
  function atlasIcon(kind, id, locked) {
    if(kind==='weapon' && +id===1 && !locked)return 'images/classic/icons/weapon-1-classic.png';
    return 'images/classic/icons/' + kind + '-' + id + (locked ? '-locked' : '') + '.png';
  }
  function icon(kind, id, locked, selected) {
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
    return '<div class="' + (cls || 'stat-strip') + '">' + [['力','power'],['敏','agility'],['速','speed'],['命','hp']].map(([s,k]) => '<div class="stat-pill"><b>' + s + '</b>' + esc(stats[k]) + '</div>').join('') + '</div>';
  }
  // 升级奖励面板用的属性图标：直接复用已按颜色分好的道具图标（3 力 / 4 敏 / 5 速 / 7 经验）。
  // 原版没有单独的「生命」图标，用同风格的圆形字徽补上。
  const STAT_ICON = { power: 3, agility: 4, speed: 5 };
  const STAT_CHAR = { power: '力', agility: '敏', speed: '速', hp: '命' };
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
      return '<div class="reward-panel">' +
        '<div class="reward-title"><img alt="升级奖励" src="' + frameUrl('resource_10', 3) + '"></div>' +
        '<div class="reward-row">' + cards.join('') + bonus + '</div>' +
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
  function home() { Main.showHome(); }
  function tabs(group, active) {
    const sets = {
      status: [['status','状态'],['weapons','武器'],['skills','技能']],
      challenge: [['challenge','随机'],['friends','好友'],['arena','竞技'],['stages','关卡']],
      message: [['messages','消息'],['ranklog','天梯赛'],['revenge','复仇'],['board','留言板'],['toplist','排行榜']],
      bag: [['bag','背包'],['shop','商店'],['exchange','兑换']],
      system: [['system','系统'],['help','帮助'],['village','村庄'],['vip','超级松鼠']]
    };
    const labels=sets[group].map(([id,t])=>{
      const art=group==='status'?'<span class="reference-button-label">'+t+'</span><img alt="" class="classic-button-art" src="images/classic/new-reference/buttons/'+({status:'status',weapons:'weapon',skills:'skill'}[id])+'-'+(id===active?'active':'normal')+'.png">':t;
      return '<button class="uc-tab '+(id===active?'active':'')+'" data-action="'+id+'" aria-current="'+(id===active?'page':'false')+'">'+art+'</button>';
    }).join('');
    return '<nav class="classic-tabs ' + (sets[group].length > 3 ? 'four' : group==='bag'?'bag-tabs':'') + '" aria-label="游戏分页">' + labels + (group === 'challenge' ? '<span class="tab-energy">体力 ' + State.state().energy + '/' + State.state().maxEnergy + '</span>' : group==='bag'?'<span class="bag-coins">'+spr('resource_1',18)+'<b>'+State.state().goldPoint+'</b></span>':'') + '</nav>';
  }
  function page(group, active, content, opts) {
    opts = opts || {}; screen = active; activePortrait = null;
    const old = $('#ui .classic-page'); if (old) old.remove();
    $$('.classic-modal-overlay').forEach(e => e.remove());
    const p = document.createElement('section'); p.className = 'classic-page'; p.dataset.screen = active;
    p.innerHTML = tabs(group, active) + (opts.above || '') + '<div class="classic-board ' + (opts.cls || '') + '">' + content + '</div><footer class="page-footer">' + (opts.left || '') + btn('返回菜单','home','gold') + (opts.right || '') + '</footer>' + (opts.counter ? '<span class="page-counter">' + opts.counter + '</span>' : '');
    $('#ui').appendChild(p);
    bind(p, Object.assign({}, actions, {home}));
    if(window.Main?.resizeLayout)Main.resizeLayout();
    return p;
  }
  function modal(title, content, buttons, opts) {
    opts = opts || {};
    const wrap = document.createElement('div'); wrap.className = 'classic-modal-overlay';
    wrap.innerHTML = '<section class="classic-modal ' + (opts.small ? 'small-modal' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2 class="modal-title cartoon">' + esc(title) + '</h2><button class="modal-close" aria-label="关闭">×</button><div class="modal-body">' + content + '</div><div class="modal-buttons">' + buttons.map((b,i) => btn(b.label, String(i), b.cls || '')).join('') + '</div></section>';
    $('#ui').appendChild(wrap);
    const previousFocus = document.activeElement;
    const close = () => { wrap.remove(); if (previousFocus && previousFocus.isConnected) previousFocus.focus({preventScroll:true}); };
    $('.modal-close',wrap).onclick = close;
    const map = {};
    buttons.forEach((b,i) => { map[i] = () => { if (b.close !== false) close(); if (b.run) b.run(); }; });
    bind(wrap,map);
    $('.modal-buttons button',wrap)?.focus({preventScroll:true});
    return {close,element:wrap};
  }
  function notice(msg, buttons) { return modal('提示', '<p>' + esc(msg) + '</p>', buttons || [{label:'确定'}], {small:true}); }
  function toast(msg) { legacy.toast(msg); }

  function renderHome() {
    screen = 'home'; activePortrait = null;
    const S = State.state();
    $('#ui').innerHTML = '<section class="classic-home" aria-label="松鼠大战主页"><div class="home-status"><span class="home-name">' + vipBadge() + esc(S.name) + '</span><span class="home-level">' + num(S.level) + '</span><span class="energy-label cartoon">体力</span><div class="uc-meter home-energy"><i></i><span class="home-energy-val">' + num(S.energy + '/' + S.maxEnergy) + '</span></div></div><div class="home-subbar"><span class="home-exp-label">EXP</span><div class="exp-meter"><i></i><span class="home-exp-val">' + num(S.exp + '/' + GData.nextExp(S.level)) + '</span></div><div class="home-money">' + icon('prop',1) + '<button data-action="shop" aria-label="金松果商店">' + num(S.goldPoint) + '</button></div></div><div class="home-buffs" aria-label="生效中的限时用品"></div><div class="home-side"><button class="picture-button' + (dailyAttention() ? ' attention' : '') + '" data-action="daily" aria-label="活动' + (dailyAttention() ? '，有可领取的奖励' : '') + '">' + '<img alt="活动" src="images/classic/home/activity.png">' + '</button><button class="picture-button" data-action="messages">' + '<img alt="" src="images/classic/home/chat.png">' + '<span>聊天</span></button></div><button class="village-door" data-action="village" aria-label="村庄"><img alt="" src="images/classic/home/village.png"></button><nav class="home-menu" aria-label="主菜单">' + btn('道具','bag') + btn('状态','status') + btn('开始挑战','challenge','gold') + btn('消息','messages') + btn('系统','system') + '</nav></section>';
    bind($('.classic-home'),actions);buffSignature='';
    refreshHome();
    renderNumbers();
  }
  function refreshHome() {
    const S = State.state(); if (!S) return;
    const h = $('.classic-home'); if (!h) return;
    State.tickEnergy();
    $('.home-name',h).textContent = S.name;
    setNum($('.home-level .num',h), S.level);
    // 体力槽：亮金色填充从左侧开始（0 在左），宽度 = 体力比；右侧剩余为深棕。
    $('.home-energy>i',h).style.width = (100*S.energy/S.maxEnergy)+'%';
    setNum($('.home-energy-val .num',h), S.energy + '/' + S.maxEnergy);
    $('.home-energy',h).title = '每5分钟恢复1点体力' + (State.energyCountdown() ? '，下一点 '+State.energyCountdown() : '');
    // 经验条只显示具体值 x/y（不再显示百分比），条内填充仍按比例
    const needExp = GData.nextExp(S.level);
    const pct = Math.min(100,100*S.exp/needExp);
    $('.home-subbar .exp-meter>i',h).style.width = pct+'%';
    setNum($('.home-exp-val .num',h), S.exp + '/' + needExp);
    setNum($('.home-money .num',h), S.goldPoint);
    const gold = frameUrl('resource_1',18); if (gold) $('.home-money img',h).src = gold;
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
  function openStatus() {
    const S=State.state(),st=State.totalStats(),fights=S.dailyWins+S.dailyFails;
    const p=page('status','status','<canvas class="status-character" width="497" height="341" aria-label="我的松鼠"></canvas><div class="status-right"><div class="status-exp"><span class="home-exp-label">Exp</span><div class="exp-meter"><i style="width:'+Math.min(100,100*S.exp/GData.nextExp(S.level))+'%"></i><span>'+S.exp+'/'+GData.nextExp(S.level)+'</span></div></div><dl class="status-lines"><dt>今日胜率：</dt><dd>'+(fights?Math.round(S.dailyWins/fights*100):0)+'%</dd><dt>战斗场次：</dt><dd>'+(S.allWins+S.allFails)+'</dd></dl><div class="status-buttons">'+btn('更换装备','gears','gold')+btn('装备融合','merge','gold')+'</div></div>'+statsHtml(st));
    portrait($('.status-character',p));
    $('.page-footer',p).insertAdjacentHTML('beforeend','<button class="status-fusion-link" data-action="merge">装备融合</button>');
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
      return '<button class="catalog-cell '+(!has?'locked':selected?'selected':'')+'" data-item="'+it.id+'" aria-label="'+esc(it.name)+(has?' 等级'+has.level:' 尚未获得')+'"><span class="item-icon">'+icon(kind,it.id,!has,selected)+'</span><span class="item-caption">'+(selected?esc(it.name):has?'LV'+has.level:'')+'</span></button>';
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
    const skillDescriptions={6:'危机时刻装死避开攻击，成功后立即获得行动机会。装死不能升级。',7:'每场抵挡一次伤害，1级抵消20%，每级增加5%。装备附加能力可增加抵挡次数。',11:'增加原有闪避率5%，每级增加2%；按原有闪避率的比例计算。',13:'生命不高于35%时，每次出手有35%概率召唤师傅，每场最多一次。恢复师傅等级×4生命，下次攻击必中。',14:'按裸力量、敏捷、速度各增加1%，最少1点，每级增加1%；每场一次，随后立即行动。'};
    const description=(!isW&&skillDescriptions[id])||base.remark||'';
    const locked=!it;
    const unupgradeable=!isW && (base.type==='被动' && up?.max || id===13);
    const extra=isW?'伤害 '+(it?it.harmLo+'-'+it.harmHi:base.harm):'类别 '+esc(base.type);
    const right=locked?'<div class="locked-message">尚未获得<br><span class="small-label">升级、开启礼包有机会获得</span></div>':up?.max||unupgradeable?'<div class="locked-message">该'+(isW?'武器':'技能')+'<br>不能升级</div>':'<h3>需要　<span class="muted-text">已有</span></h3><div><span>金松果 '+up.coin+'</span><b>'+S.goldPoint+'</b></div><div><span>卷轴 '+up.book+'</span><b>'+(S.props[up.bookId]||0)+'</b></div><span class="upgrade-rate">成功率 '+up.rate+'%</span><span class="small-label">需要角色 '+up.levelLimit+' 级</span>';
    const content='<div class="item-detail"><div><h3 class="detail-name">'+esc(base.name)+'</h3><div class="detail-summary"><span class="item-icon">'+icon(kind,id,locked)+'</span><div class="detail-rows"><span class="detail-row">'+(isW?'阶段':'等级')+' '+(it?it.level:1)+'</span><span class="detail-row">'+extra+'</span><span class="detail-row">类型 '+esc(base.type)+'</span></div></div><div class="detail-description">'+esc(description)+(isW&&it?'<br>升至下一阶段额外提升'+esc(base.harmAdd)+'点基础伤害！':'')+'</div></div><div class="detail-upgrade">'+right+'</div></div>';
    modal(isW?'武器详情':'技能详情',content,[{label:'返回'},{label:locked?'尚未获得':up?.max||unupgradeable?'不能升级':'立即升级',cls:locked||up?.max||unupgradeable?'muted':'gold',run:()=>{
      if(locked||up?.max||unupgradeable)return;
      const r=State.doUpgrade(kind,id);toast(r.msg);openCatalog(kind,catalogPage);openItem(kind,id);
    }}]);
  }
  function genOpponents() {
    const S=State.state();
    // 三个对手在玩家等级附近浮动，并带随机装备；等级差与名字都随机
    const spread=[-1,0,1];
    opponents=spread.map(i=>State.genAI(Math.max(1,S.level+i),'',{levelJitter:2,minLevel:Math.max(1,S.level-1)}));
    selectedOpponent=null;
  }
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
    const content='<div class="challenge-list">'+opponents.map((f,i)=>'<button class="challenger '+(selectedOpponent===i?'active':'')+'" data-foe="'+i+'"><span class="foe-level">'+f.level+'</span><span class="foe-name">'+esc(f.name)+'</span>'+spr('resource_16',3)+'</button>').join('')+'</div><div class="challenge-preview"><canvas width="390" height="292" aria-label="对手预览"></canvas>'+(selectedOpponent!=null?statsHtml(opponents[selectedOpponent],'mini-stats'):'')+'</div><div class="challenge-note"><span>点击刷新<br>下一轮玩家…</span>'+btn(refreshLabel,'refresh','small muted')+'</div>'+(selectedOpponent!=null?'<div class="preview-fight">'+btn('挑战他','fight','small')+'</div>':'');
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
    $('[data-action="fight"]',p)?.addEventListener('click',()=>{
      const foe=opponents[selectedOpponent],S=State.state();
      if(S.energy<10){notice('体力不足！每5分钟恢复1点，也可以使用体力药剂。',[{label:'使用药剂',run:()=>openBag()},{label:'返回',cls:'gold'}]);return;}
      S.challengeRefresh={count:0,ts:Date.now()};State.save();   // 进行挑战后重置刷新费用
      Main.startBattle(foe,{cost:10,kind:'challenge',useProps:true,onEnd:(winner)=>{
        const win=winner===0;if(win){S.dailyWins++;S.allWins++;}else{S.dailyFails++;S.allFails++;}
        const rw=State.fightReward(win,{foeLevel:foe.level});
        opponents=[];openChallenge();   // 战果弹窗放在挑战页上，并刷新下一批对手
        resultModal(win,rw);
      }});
    });
  }
  function resultModal(win,rw,extra) {
    modal('战斗结果','<div class="result-box"><div class="result-title '+(win?'win':'lose')+'">'+(win?'胜 利！':'再接再厉')+'</div><div class="result-lines">经验 +'+rw.exp+'　金松果 +'+(rw.gold||0)+'</div>'+ (extra?'<p>'+esc(extra)+'</p>':'')+upsHtml(rw.ups)+'</div>',[{label:'确定',run:home},{label:'查看录像',cls:'gold',run:()=>openMessages()}]);
  }
  const NPC_FILE={tl:'mantis',xh:'crane',xm:'panda'};
  /** 关卡结算里的升级奖励：与首页共用的 upgradeReward 同款样式，
   *  但这里自带一份最小实现，方便测试只注入本段代码时也能跑。 */
  function stageUpsHtml(ups) {
    if (!ups || !ups.length) return '';
    return '<div class="reward-stack">' + ups.map(function (u) {
      return '<div class="reward-panel"><div class="reward-level">升到 ' + esc(u.level) + ' 级</div>' +
        (u.reward ? '<div class="reward-row"><div class="reward-card skill"><span class="reward-text">' + esc(u.reward) + '</span></div></div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  function npcImage(type){return '<img alt="'+esc(type.name)+'" src="images/classic/characters/'+NPC_FILE[type.anim]+'-classic-card.png">';}
  function openStages() {
    const content='<div class="npc-select">'+GData.STAGE_TYPES.map((t,i)=> (i?'<span class="npc-arrow">➜</span>':'')+'<div class="npc-card">'+npcImage(t)+btn('挑战他','type'+i,stageTypeAvailable(i)?'gold small':'muted small')+'</div>').join('')+'</div><div class="npc-description">10级可挑战盖世五侠。依次通过六种难度，才能挑战下一位高手。每轮连续击败3名敌人，收集装备碎片！</div>';
    const p=page('challenge','stages',content);
    [0,1,2].forEach(i=>$('[data-action="type'+i+'"]',p).onclick=()=>openDifficulty(i));
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
    const text='<div class="mission-guide"><img alt="向导" src="images/classic/characters/master-classic.png"><div>【消耗】：'+cost+'<br>【奖励】：每场经验 '+GData.stageNpcExp(stageId,1)+'/'+GData.stageNpcExp(stageId,2)+'/'+GData.stageNpcExp(stageId,3)+'<br>通关得金松果'+reward.gold+'，每场胜利有几率得碎片<br><span class="small-label">现有挑战书 '+(S.props[23]||0)+' 个</span></div></div><p class="mission-description">连续击败3名敌人，后两场战斗不回满血（继承剩余血量并回复25%）。<br>当前对手：'+esc(npc.name)+'（'+idx+'/3）<br>'+(run?'本轮已复活 '+run.revives+'/2 次。':type.recommend+'。')+'</p>';
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
    const foe={name:npc.name,level:10+stageId*2,power:+npc.power,agility:+npc.agility,speed:+npc.speed,hp:+npc.hp,weapons:[],skills:(npc.skills||'').split('|').filter(Boolean).map(s=>{const a=s.split(':');return{id:+a[0],level:+a[1]};}),npcType:type.anim};
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
      buttons=[{label:'继续闯关',run:back},{label:'返回菜单',cls:'gold',run:home}];
    }else if(rw.win){
      message='已击败'+npc.name+'（'+idx+'/3）。继续挑战不再消耗挑战书，但下一场不会回满血（继承剩余血量并回复25%）。';
      buttons=[{label:'继续挑战',run:()=>stageConfirm(stageId)},{label:'稍后继续',cls:'gold',run:back},{label:'结束本轮',cls:'muted',run:()=>stageAbandon(stageId)}];
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
  function openBag(shop,pg) {
    const exchange=shop==='exchange',mode=shop;shop=shop===true;bagPage=pg||0;
    const S=State.state(),items=[];
    propMap.each((id,v)=>{if(exchange?[24,25,26,45,46].includes(+id):shop?v.buy==='true':S.props[id]>0)items.push({...v,id:+id});});
    items.sort((a,b)=>a.id-b.id);
    const total=Math.max(1,Math.ceil(items.length/6));bagPage=Math.min(bagPage,total-1);
    const shown=items.slice(bagPage*6,bagPage*6+6);
    if(!shown.some(it=>it.id===selectedProp))selectedProp=shown[0]?.id||0;
    const it=shown.find(it=>it.id===selectedProp),status=shop&&it?State.purchaseStatus(it.id):null;
    const info=it?'<h3>'+esc(it.name)+'</h3><div class="bag-description">'+esc(it.remark||'')+'</div><div class="bag-item-meta">'+(shop?'售价 '+it.price+' 金松果<br>今日剩余 '+status.remaining+'/'+status.limit:'拥有 '+(S.props[it.id]||0)+' 个')+'</div>'+btn(shop?(status.remaining?'购买':'今日售罄'):([24,25,26,45,46].includes(it.id)||State.gemLevel(it.id))?'合成':it.id===37?'分配属性':it.useType==='1'?'使用':'查看','prop-action','small gold'):'<h3>背包</h3><div class="bag-description">背包空空的，去商店看看吧！</div>';
    const content='<div class="bag-layout"><div class="catalog-grid bag-grid">'+shown.map(it=>'<button class="catalog-cell '+(it.id===selectedProp?'selected':'')+'" data-prop="'+it.id+'" aria-label="'+esc(it.name)+(shop?'，'+it.price+'金松果':'，拥有'+(S.props[it.id]||0)+'个')+'" aria-pressed="'+(it.id===selectedProp)+'"><span class="item-icon">'+icon('prop',it.id,false,it.id===selectedProp)+'</span><span class="item-caption">'+(shop?it.price+' 金松果':'X'+(S.props[it.id]||0))+'</span>'+(shop?'<span class="shop-stock">今日 '+State.purchaseStatus(it.id).remaining+'/'+State.shopLimit(it.id)+'</span>':'')+'</button>').join('')+Array.from({length:6-shown.length},()=>'<div class="catalog-cell empty-slot" aria-hidden="true"><span class="item-icon"></span></div>').join('')+'</div><aside class="bag-detail" aria-live="polite">'+info+'</aside></div>'+(bagPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(bagPage<total-1?'<div class="page-arrow bag-next">'+btn('›','next','arrow')+'</div>':'');
    const p=page('bag',exchange?'exchange':shop?'shop':'bag',content,{cls:'classic-bag-board',counter:(bagPage+1)+'/'+total,left:'<span class="footer-left" style="display:flex;gap:12px">'+(exchange?btn('金杯商店','rank-shop','small'):'')+((shop||exchange)?btn('每日抽奖','lottery','small gold'):'')+'</span>'});
    $$('[data-prop]',p).forEach(b=>b.onclick=()=>{selectedProp=+b.dataset.prop;openBag(mode,bagPage);});
    $('[data-action="prop-action"]',p)?.addEventListener('click',()=>openProp(selectedProp,shop));
    if(status&&!status.remaining)$('[data-action="prop-action"]',p).disabled=true;
    $('[data-action="rank-shop"]',p)?.addEventListener('click',()=>ClassicExtras.rankShop());
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openBag(mode,bagPage-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openBag(mode,bagPage+1));
  }
  function openProp(id,shop) {
    const base=propMap.getValue(id),S=State.state();
    if(!base)return;
    const isFragment=[24,25,26].includes(id),isSeed=[45,46].includes(id),isGem=State.gemLevel(id)>0,canUse=base.useType==='1';
    const status=shop?State.purchaseStatus(id):null;
    // 天使/恶魔果实种子：合成的果实是「获得/遗忘武器技能」，所以这里直接标出武技是否已满
    const wsNow=S.weapons.length+S.skills.length,wsMax=State.wsLimit(),wsFull=wsNow>=wsMax;
    const seedNote=isSeed?('<p class="small-label">武器/技能：<b class="'+(wsFull?'ws-full':'ws-ok')+'">'+wsNow+'/'+wsMax+(wsFull?'（已满，合成的果实将无法领取新武器/技能）':'（未满，可继续获得）')+'</b></p>'):'';
    const content='<div class="detail-summary"><span class="item-icon">'+icon('prop',id)+'</span><div><h3 class="detail-name">'+esc(base.name)+'</h3><div class="detail-description">'+esc(base.remark||'')+'</div><div class="small-label">拥有 '+(S.props[id]||0)+' 个'+(shop?'　售价 '+base.price+' 金松果<br>每日限购 '+status.limit+' 件，今日剩余 '+status.remaining+' 件':'')+'</div></div></div>'+seedNote+'<p class="small-label">金松果：'+S.goldPoint+'</p>'+(isGem?'<p class="small-label">3 个同级宝石 + 10 金松果合成高一级，成功率 '+(State.GEM_MERGE_RATES[State.gemLevel(id)-1]*100)+'%；失败有 50% 几率一颗材料降 1 级（1级则碎裂）。</p>':'');
    const label=shop?(status.remaining?'购买':'今日售罄'):isFragment?'合成装备':isSeed?(wsFull&&id===45?'武器技能已满':'合成果实'):isGem?'合成宝石':id===37?'分配属性':canUse?'使用':'返回';
    const m=modal(shop?'道具商店':'道具详情',content,[{label,run:()=>{
      if(!shop&&!canUse&&!isFragment&&!isSeed&&!isGem)return;
      if(!shop&&id===37){allocateAttributes();return;}
      if(!shop&&isSeed){if((S.props[id]||0)<10||S.goldPoint<50){toast('合成需要10个种子和50金松果');return;}S.props[id]-=10;S.goldPoint-=50;const fruit=id===45?47:48;S.props[fruit]=(S.props[fruit]||0)+1;State.save();toast('合成成功：'+propMap.getValue(fruit).name);openBag(false,bagPage);return;}
      const r=shop?State.buyProp(id,1):isFragment?State.composeGear(id):isGem?State.mergeGems(id):State.useProp(id);
      toast(r.msg||(r.gear?'合成成功：'+r.gear.name:'操作完成'));
      if(r.ok){openBag(shop,bagPage);if(shop)openProp(id,true);}
    }},{label:'返回',cls:'muted'}],{small:true});
    if(shop&&!status.remaining)$('[data-action="0"]',m.element).disabled=true;
    // 天使果实（45）合成的果实用来「获得」新武器/技能，武技已满时禁用合成
    if(!shop&&isSeed&&wsFull&&id===45)$('[data-action="0"]',m.element).disabled=true;
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
  function gearImg(g) {
    return '<img alt="" src="images/classic/icons/gear-'+g.id+'.png">';
  }
  function openGears(pg) {
    gearPage=typeof pg==='number'?pg:0;
    openStatus();
    const gears=State.myGears(),total=Math.max(1,Math.ceil(gears.length/6));gearPage=Math.min(gearPage,total-1);
    const slots=['头部','手部','身体','脚部'];
    const content='<p class="gear-note">相同的附加属性效果不叠加，最高的1条生效！</p><div class="gear-layout"><div class="gear-slots">'+slots.map((name,i)=>{const g=gears.find(x=>x.used&&x.type===i);return '<button class="catalog-cell" '+(g?'data-gear="'+esc(g.key)+'"':'disabled')+'><span class="item-icon">'+(g?gearImg(g):'<span class="gear-empty">'+name+'</span>')+'</span></button>';}).join('')+'</div><div class="gear-list">'+gears.slice(gearPage*6,gearPage*6+6).map(g=>'<button class="catalog-cell '+(g.used?'selected':'')+'" data-gear="'+esc(g.key)+'"><span class="item-icon">'+gearImg(g)+(g.used?'<span class="equipped-check">✓</span>':'')+'</span><span class="item-caption q'+g.quality+'">'+esc(g.name)+'</span></button>').join('')+(gears.length?'':'<div class="empty-state">还没有装备<br><span class="small-label">挑战关卡获得碎片<br>10个碎片可合成一件装备</span><br>'+btn('去闯关','stages','small gold')+'</div>')+'</div></div>'+(gearPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(gearPage<total-1?'<div class="page-arrow">'+btn('›','next','arrow')+'</div>':'');
    const m=modal('我的装备',content+'<span class="gear-capacity">容量 '+gears.length+'/'+State.gearCapacity()+'　'+(gearPage+1)+'/'+total+'</span>',[{label:'返回',cls:'gold'}]);
    const p=m.element;p.classList.add('gear-overlay');$('.classic-modal',p).classList.add('gear-modal');
    const list=$('.gear-list',p),n=gears.slice(gearPage*6,gearPage*6+6).length;
    if(n)list.insertAdjacentHTML('beforeend',Array.from({length:6-n},()=>'<div class="catalog-cell empty-slot" aria-hidden="true"><span class="item-icon"></span></div>').join(''));
    $$('.gear-slots button',p).forEach((b,i)=>{const g=gears.find(x=>x.used&&x.type===i);b.setAttribute('aria-label',slots[i]+(g?'：'+g.name:'：未装备'));});
    $$('[data-gear]',p).forEach(b=>b.onclick=()=>openGear(b.dataset.gear));
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openGears(gearPage-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openGears(gearPage+1));
  }
  function openGear(key) {
    const g=State.myGears().find(x=>x.key===key);if(!g)return;
    const gemInfo=g.gem?'<br>镶嵌宝石：'+esc(propMap.getValue(g.gem.id).name)+'（主属性 +'+(g.gem.id-100)*4+'%，附加 +'+(g.gem.ext)+'%）':'';
    const content='<div class="gear-detail"><div class="catalog-cell"><h3 class="detail-name q'+g.quality+'">'+esc(g.name)+'</h3><span class="item-icon">'+gearImg(g)+'</span><span class="small-label">'+['普通','优秀','杰出','卓越','传说'][g.quality]+'</span></div><div>装备类别：'+['头部','手部','身体','脚部'][g.type]+'　使用等级：'+g.useLevel+'<br>基本属性：'+esc(g.attrName)+' +'+g.abilityVal+'<br>附加属性：<br>'+State.extText(g.ext).map(esc).join('<br>')+gemInfo+'</div></div>';
    const buttons=[{label:g.used?'卸下':'装备',run:()=>{const ok=g.used?State.unwear(key):State.wear(key);if(ok===false)toast('等级不足，暂时无法装备');openGears(gearPage);}}];
    if(g.orange){
      if(g.gem)buttons.push({label:'拆卸宝石（5金）',run:()=>{const r=State.unsocketGem(key);toast(r.msg);openGear(key);}});
      else buttons.push({label:'镶嵌宝石',cls:'gold',run:()=>socketGemDialog(key)});
    }
    buttons.push({label:'出售',cls:'muted',run:()=>notice('确定以 '+g.price+' 金松果出售【'+g.name+'】吗？',[{label:'出售',run:()=>{State.sellGear(key);openGears(gearPage);}},{label:'返回',cls:'muted'}])},{label:'返回',cls:'muted'});
    modal('我的装备',content,buttons);
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
  function openMessages(tab,pg) {
    tab=typeof tab==='string'?tab:'messages';pg=pg||0;
    let list=State.battleHistory?State.battleHistory():[];
    if(tab==='ranklog')list=list.filter(r=>r.kind==='rank');
    if(tab==='revenge')list=list.filter(r=>r.winner!==0);
    const total=Math.max(1,Math.ceil(list.length/2));pg=Math.min(pg,total-1);
    const html=list.slice(pg*2,pg*2+2).map(r=>{
      const d=new Date(r.createdAt),time=(d.getMonth()+1)+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
      return '<article class="message-card"><span class="message-stamp '+(r.winner?'loss':'')+'">'+(r.winner?'败':'胜')+'</span>你挑战了【'+esc(r.foe.name)+'】，'+(r.winner?'遗憾落败。':'获得胜利！')+'<time>'+time+'</time><button class="uc-button tiny muted" data-replay="'+esc(r.id)+'">查看录像</button></article>';
    }).join('');
    const p=page('message',tab,'<div class="message-list">'+(html||'<div class="empty-state">暂时没有'+(tab==='revenge'?'落败记录':'战斗消息')+'<br><span class="small-label">开始一场挑战，精彩战斗会保存在这里。</span></div>')+'</div>'+(pg?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(pg<total-1?'<div class="page-arrow">'+btn('›','next','arrow')+'</div>':''),{counter:(pg+1)+'/'+total,left:'<span class="footer-left">'+btn('村庄','village','small gold')+'</span>',right:'<span class="footer-right">'+btn('好友','friends','small gold')+'</span>'});
    $$('[data-replay]',p).forEach(b=>b.onclick=()=>{const r=list.find(x=>x.id===b.dataset.replay);Main.replayBattle(r,()=>openMessages(tab,pg));});
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openMessages(tab,pg-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openMessages(tab,pg+1));
  }
  function openFriends() {
    const S=State.state();
    page('challenge','friends','<div class="empty-state">山高水长，师徒相伴<br><span class="small-label">'+(S.master?'师父：'+esc(S.master.name)+'　'+S.master.level+'级':'去村庄拜一位师父，开启你的江湖之旅。')+'<br>这是离线怀旧版，好友与对手由本地模拟。</span><div class="btn-row">'+btn('师徒','master','gold')+btn('随机挑战','challenge')+'</div></div>');
  }
  function openBoard() {
    page('message','board','<div class="empty-state">松鼠乐园留言板<br><span class="small-label">欢迎回来，老朋友。<br>本地怀旧版暂不连接公共聊天与留言服务。<br>你的战斗录像可在「消息」中查看。</span></div>');
  }
  function openDaily() {
    const d = State.dailyStatus();
    const quests = State.questStatus();
    const gift = '<div class="daily-gift"><div class="daily-gift-text"><h3>每日礼包</h3><p>每天回家都有一份小礼物：金松果 ×150、挑战书 ×1</p></div>' +
      btn(d.claimed ? '今日已领取' : '领取礼包', 'claim-gift', d.claimed ? 'muted' : 'gold') + '</div>';
    const rows = quests.map((q) => {
      const bonusName = q.bonus ? ((propMap.getValue(q.bonus) || {}).name || '道具') : '';
      const pct = Math.round(100 * q.progress / q.need);
      return '<div class="quest-row' + (q.claimed ? ' claimed' : q.done ? ' done' : '') + '">' +
        '<span class="quest-name">' + esc(q.name) + '</span>' +
        '<span class="quest-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="quest-progress">' + q.progress + '/' + q.need + '</span>' +
        '<span class="quest-reward">' + num(q.gold) + (bonusName ? '<i class="quest-bonus">+' + esc(bonusName) + '</i>' : '') + '</span>' +
        (q.claimed ? '<span class="quest-state">已领取</span>'
          : q.done ? btn('领取', 'quest' + q.index, 'small gold')
            : '<span class="quest-state muted">进行中</span>') +
        '</div>';
    }).join('');
    const list = '<div class="daily-quests"><h3>每日任务<span class="quest-date">' + esc(State.localDate()) + ' · 每天 0 点刷新</span></h3>' + rows + '</div>';
    const m = modal('活动', gift + list, [{ label: '返回', cls: 'gold' }]);
    const rerender = () => { m.close(); openDaily(); refreshHome(); };
    $('[data-action="claim-gift"]', m.element)?.addEventListener('click', () => { toast(State.claimDaily().msg); rerender(); });
    quests.forEach((q) => {
      const b = $('[data-action="quest' + q.index + '"]', m.element);
      if (b) b.addEventListener('click', () => { toast(State.claimQuest(q.index).msg); rerender(); });
    });
  }
  function openSystem() {
    const mute=Main.isMuted&&Main.isMuted();
    const vol=Math.round(100*((Main.volume&&Main.volume())||0));
    const slider='<div class="setting-slider" data-slider="volume"><span class="slider-label">音乐音量</span>'+
      '<input type="range" min="0" max="100" step="1" value="'+vol+'" aria-label="音乐音量">'+
      '<b class="slider-value">'+vol+'%</b></div>';
    const p=page('system','system','<div class="settings-grid">'+btn(mute?'音乐：关':'音乐：开','sound')+btn('游戏帮助','help')+btn('导出存档','export','gold')+btn('导入存档','import','gold')+btn('每日礼包','daily')+btn('更改昵称','rename')+'</div>'+slider+'<p class="system-caption">松鼠大战 · 怀旧单机版<br>进度自动保存在当前浏览器，可导出存档留作备份。</p>');
    $('[data-action="sound"]',p).onclick=()=>{Main.setMuted(!mute);openSystem();};
    // 音量滑块：拖动即时生效；拖到 0 等同静音，拉回来自动取消静音
    const range=$('[data-slider="volume"] input',p),value=$('[data-slider="volume"] .slider-value',p);
    range.oninput=()=>{
      const v=Main.setVolume(Number(range.value)/100);
      value.textContent=Math.round(100*v)+'%';
    };
    range.onchange=()=>{
      const v=Math.round(100*((Main.volume&&Main.volume())||0));
      const on=!(Main.isMuted&&Main.isMuted());
      $('[data-action="sound"]',p).textContent=on?'音乐：开':'音乐：关';
      toast('音乐音量 '+v+'%'+(!on?'（已静音）':''));
    };
    $('[data-action="export"]',p).onclick=()=>{
      const blob=new Blob([JSON.stringify(State.state(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='松鼠大战存档-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('存档已导出');
    };
    $('[data-action="import"]',p).onclick=importSave;
    $('[data-action="rename"]',p).onclick=()=>{
      const m=modal('更改昵称','<p>给你的松鼠起个名字</p><input id="rename-input" maxlength="12" value="'+esc(State.state().name)+'" style="width:100%;padding:14px;border:3px solid #b39763;border-radius:18px;color:#715231;background:#fffdf1">',[{label:'确定',close:false,run:()=>{const name=$('#rename-input',m.element).value.trim();if(!name){toast('名字不能为空');return;}State.state().name=name;State.save();m.close();refreshHome();}},{label:'返回',cls:'muted'}],{small:true});
    };
  }
  function importSave() {
    const f=document.createElement('input');f.type='file';f.accept='.json,application/json';
    f.onchange=async()=>{try{
      const file=f.files[0];if(!file)return;if(file.size>8*1024*1024)throw new Error('存档文件过大');
      const raw=await file.text(),data=JSON.parse(raw);
      if(!data||typeof data.name!=='string'||!Number.isFinite(data.level)||!Array.isArray(data.weapons)||!Array.isArray(data.skills)||!data.props)throw new Error('这不是有效的松鼠大战存档');
      notice('导入【'+data.name+'】'+data.level+'级的存档？当前进度会先自动备份。',[{label:'导入',run:()=>{
        const old=localStorage.getItem(State.saveKey);try{if(old)localStorage.setItem(State.saveKey+'_backup',old);localStorage.setItem(State.saveKey,raw);if(!State.load())throw new Error('读取存档失败');State.save();home();toast('存档导入成功');}catch(e){if(old)localStorage.setItem(State.saveKey,old);State.load();toast('导入失败，已保留原存档');}
      }},{label:'取消',cls:'muted'}]);
    }catch(e){toast(e.message||'无法读取存档');}};f.click();
  }
  function openVillage() {
    const p=page('system','village','<div class="settings-grid">'+btn('师徒','master')+btn('竞技场','arena','gold')+btn('天梯赛','rank')+btn('道具商店','shop','gold')+btn('每日抽奖','lottery')+btn('挑战关卡','stages','gold')+'</div><p class="system-caption">欢迎来到松鼠村庄！<br>拜师学艺、收集装备，和松鼠伙伴一起成长。</p>');
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
    if ([41, 42, 43, 44].includes(id)) lines.push('金杯商店（周日开放）：20 金杯 + 20 金松果，积分需 800');
    if ([16, 17, 18, 19].includes(id)) lines.push('金杯商店（周日开放）：500 金杯 + 100 金松果，积分需 1500，每周限兑 1 次');
    if ([21, 22].includes(id)) lines.push('金杯商店（周日开放）：100 金杯 + 100 金松果兑换 100 个，积分需 1200，每周限兑 1 次');
    if (id === 40) lines.push('天梯赛：胜利 +3 杯、落败 +1 杯，获胜有 25% 概率额外夺得 3 杯');
    if (id === 47) lines.push('合成：天使果实种子 ×10 + 50 金松果（背包中合成）');
    if (id === 48) lines.push('合成：恶魔果实种子 ×10 + 50 金松果（背包中合成）');
    if (id === 8) lines.push('挑战胜利：3～7 个/场；通关关卡整轮：25 个；各级礼包中也有');
    if (id >= 101 && id <= 107) {
      const lv = id - 100;
      if (lv <= 2) lines.push('45 级起：通关关卡 20% 几率、竞技场（经验/碎片）获胜 15% 几率获得（一级 75% / 二级 25%）');
      if (lv < 7) lines.push('合成：3 个同级 + 10 金松果，成功率 ' + (State.GEM_MERGE_RATES[lv - 1] * 100) + '%（失败有 50% 几率一颗材料降 1 级，1级则碎裂）');
      lines.push('镶嵌：免费镶入橙装（3 件相同紫装融合而来），主属性 +' + lv * 4 + '%，附加属性效果随机提升，每件限 1 颗；拆卸 5 金松果');
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
    const m = modal('游戏帮助','<div class="help-box"><p><b>挑战</b>：选择对手，再点「挑战他」。每场消耗10体力，战斗自动进行。</p><p><b>属性</b>：力量影响伤害，敏捷影响闪避，速度影响出手次数。战斗中随机使用已获得的武器与技能。</p><p><b>成长</b>：战斗获得经验，升级有机会领悟武器与技能。在状态页查看和升级。</p><p><b>体力</b>：每5分钟恢复1点，也可以在道具中使用体力药剂。</p><p><b>关卡</b>：10级开启，按顺序挑战。每轮消耗1张挑战书，连续击败3名敌人；失败最多复活2次，每次再消耗1张。10个装备碎片可合成装备，3件相同装备可以融合。</p><p><b>录像</b>：最近50场战斗保存在消息页，回放不消耗体力，也不会重复发放奖励。</p><p><b>存档</b>：自动保存。可在系统中导出、导入，音乐开关也会保存。</p><p><b>宝石</b>：45级后通关关卡、竞技场获胜有几率获得1-2级宝石；3个同级宝石+10金松果有几率合成高一级（失败可能降级）。3件相同紫装可融合为橙装，宝石免费镶入橙装（每件限1颗），拆卸5金松果。</p><h3 class="help-items-title">可获得物品一览</h3><div class="help-items">' + items + '</div><p class="small-label">点击物品可查看效果、获取方式以及具体的概率与期望；标注“暂无产出途径”的为图鉴预留物品。</p></div>',[{label:'知道了'}]);
    $$('[data-guide]', m.element).forEach((b) => b.onclick = () => openGuideItem(+b.dataset.guide));
  }
  function fallback(key){if(window.ClassicExtras && window.ClassicExtras[key])window.ClassicExtras[key]();else legacy.runAction(key);}
  const actions={home,exchange:()=>openBag('exchange'),status:openStatus,weapons:()=>openCatalog('weapon'),skills:()=>openCatalog('skill'),challenge:()=>openChallenge(),battle:()=>openChallenge(),stages:openStages,bag:()=>openBag(),shop:()=>openBag(true),gears:()=>openGears(),messages:()=>openMessages(),ranklog:()=>openMessages('ranklog'),revenge:()=>openMessages('revenge'),board:openBoard,friends:openFriends,daily:openDaily,system:openSystem,village:openVillage,help:openHelp,arena:()=>fallback('arena'),rank:()=>fallback('rank'),lottery:()=>fallback('lottery'),master:()=>fallback('master'),toplist:()=>fallback('toplist'),vip:()=>fallback('vip')};
  function runAction(key){if(actions[key])actions[key]();}
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      const dialogs=$$('.classic-modal-overlay');if(dialogs.length){$('.modal-close',dialogs[dialogs.length-1]).click();return;}
      const panels=$$('.panel-close');if(panels.length){panels[panels.length-1].click();return;}
      if(screen!=='home'&&$('.classic-page'))home();
    }
    if(e.key==='Tab'){
      const dialogs=$$('.classic-modal-overlay');if(!dialogs.length)return;
      const root=dialogs[dialogs.length-1],focusable=$$('button:not(:disabled),input',root);
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  window.UI={...legacy,renderHome,drawHomeHud,drawActor,runAction,currentScreen:()=>screen,refreshHome,renderNumbers,
    classic:{page,modal,btn,bind,icon,spr,statsHtml,portrait,resultModal,stageResult,home,toast,num,setNum,upgradeReward,upsHtml,pickupResult},
    weaponIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('weapon',id)+'">',
    skillIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('skill',id)+'">',
    propIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('prop',id)+'">'};
})();
