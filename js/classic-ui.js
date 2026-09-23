/* Classic UC screens reconstructed from references. Gameplay remains in State / Sim. */
(function () {
  'use strict';
  const legacy = window.UI;
  const W = 1170, H = 690;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => [...(root || document).querySelectorAll(s)];
  const btn = (label, action, cls) => '<button type="button" class="uc-button ' + (cls || '') + '" data-action="' + esc(action) + '">' + esc(label) + '</button>';
  const spriteCache = Object.create(null);
  let screen = 'home', timer = 0, activePortrait = null, lastRefresh = 0;
  let catalogPage = 0, bagPage = 0, gearPage = 0;
  const selectedItems = {weapon:1,skill:1};
  let opponents = [], selectedOpponent = null;
  let heroWears = [], wearSignature = '', wearRequest = '';
  const classicPortrait = new Image(); classicPortrait.src = 'images/classic/squirrel-classic.png';
  const berserkerPortrait = new Image(); berserkerPortrait.src = 'images/classic/squirrel-berserker-classic.png';

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
    for (const block of $$('.num[data-text]', root || document)) {
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
  function icon(kind, id, locked) {
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
      const bonus = u.reward
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
  function home() { Main.showHome(); }
  function tabs(group, active) {
    const sets = {
      status: [['status','状态'],['weapons','武器'],['skills','技能']],
      challenge: [['challenge','随机'],['friends','好友'],['arena','竞技'],['stages','关卡']],
      message: [['messages','消息'],['ranklog','天梯赛'],['revenge','复仇'],['board','留言板']],
      bag: [['bag','道具'],['shop','商店'],['gears','装备']],
      system: [['system','系统'],['help','帮助'],['village','村庄']]
    };
    return '<nav class="classic-tabs ' + (sets[group].length > 3 ? 'four' : '') + '" aria-label="游戏分页">' + sets[group].map(([id,t]) => '<button class="uc-tab ' + (id === active ? 'active' : '') + '" data-action="' + id + '" aria-current="' + (id === active ? 'page' : 'false') + '">' + t + '</button>').join('') + (group === 'challenge' ? '<span class="tab-energy">体力 ' + State.state().energy + '/' + State.state().maxEnergy + '</span>' : '') + '</nav>';
  }
  function page(group, active, content, opts) {
    opts = opts || {}; screen = active; activePortrait = null;
    const old = $('#ui .classic-page'); if (old) old.remove();
    $$('.classic-modal-overlay').forEach(e => e.remove());
    const p = document.createElement('section'); p.className = 'classic-page'; p.dataset.screen = active;
    p.innerHTML = tabs(group, active) + (opts.above || '') + '<div class="classic-board ' + (opts.cls || '') + '">' + content + '</div><footer class="page-footer">' + (opts.left || '') + btn('返回菜单','home','gold') + (opts.right || '') + '</footer>' + (opts.counter ? '<span class="page-counter">' + opts.counter + '</span>' : '');
    $('#ui').appendChild(p);
    bind(p, Object.assign({}, actions, {home}));
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
    $('#ui').innerHTML = '<section class="classic-home" aria-label="松鼠大战主页"><div class="home-status"><span class="home-name">' + esc(S.name) + '</span><span class="home-level">' + num(S.level) + '</span><span class="energy-label cartoon">体力</span><div class="uc-meter home-energy"><i></i><span class="home-energy-val">' + num(S.energy + '/' + S.maxEnergy) + '</span></div></div><div class="home-subbar"><span class="home-exp-label">EXP</span><div class="exp-meter"><i></i><span class="home-exp-val">' + num(S.exp + '/' + GData.nextExp(S.level)) + '</span></div><div class="home-money">' + icon('prop',1) + '<button data-action="shop" aria-label="金松果商店">' + num(S.goldPoint) + '</button></div></div><div class="home-side"><button class="picture-button" data-action="daily">' + '<img alt="活动" src="images/classic/home/activity.png">' + '</button><button class="picture-button" data-action="messages">' + '<img alt="" src="images/classic/home/chat.png">' + '<span>聊天</span></button></div><button class="village-door" data-action="village" aria-label="村庄"><img alt="" src="images/classic/home/village.png"></button><nav class="home-menu" aria-label="主菜单">' + btn('道具','bag') + btn('状态','status') + btn('开始挑战','challenge','gold') + btn('消息','messages') + btn('系统','system') + '</nav></section>';
    bind($('.classic-home'),actions);
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
    const classicImage = !animate && [0,1,2,3].every(i=>wears[i] && /_32(?:_|$)/.test(wears[i].src)) ? berserkerPortrait : !animate && !wears.some(Boolean) ? classicPortrait : null;
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
    const p=page('status','status','<canvas class="status-character" width="497" height="341" aria-label="我的松鼠"></canvas><div class="status-right"><div class="status-exp"><span class="home-exp-label">EXP</span><div class="exp-meter"><i style="width:'+Math.min(100,100*S.exp/GData.nextExp(S.level))+'%"></i><span>'+S.exp+'/'+GData.nextExp(S.level)+'</span></div></div><dl class="status-lines"><dt>今日胜率：</dt><dd>'+(fights?Math.round(S.dailyWins/fights*100):0)+'%</dd><dt>战斗场次：</dt><dd>'+(S.allWins+S.allFails)+'</dd></dl><div class="status-buttons">'+btn('更换装备','gears','gold')+btn('装备融合','merge','gold')+'</div></div>'+statsHtml(st));
    portrait($('.status-character',p));
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
    const title=kind==='weapon'?'武器':'技能';
    // 页面标识用原版贴图角标，横向居中在棋盘上方，不压住格子
    const head='<div class="board-corner-label">'+sprLabel('resource_2',12,116,50,title)+'</div>';
    const cells=items.slice(catalogPage*10,catalogPage*10+10).map(it=>{
      const has=own.find(x=>x.id===it.id);
      const selected=has && selectedItems[kind]===it.id;
      return '<button class="catalog-cell '+(!has?'locked':selected?'selected':'')+'" data-item="'+it.id+'" aria-label="'+esc(it.name)+(has?' 等级'+has.level:' 尚未获得')+'"><span class="item-icon">'+icon(kind,it.id,!has)+'</span><span class="item-caption">'+(selected?esc(it.name):has?'LV'+has.level:'')+'</span></button>';
    }).join('');
    // 棋盘背景铺一层原版光效花纹，让武器/技能页更饱满
    const deco='<div class="board-deco" aria-hidden="true"><img alt="" src="'+frameUrl('resource_2',0)+'"><img alt="" src="'+frameUrl('resource_2',0)+'"><i class="board-deco-spark"></i><i class="board-deco-spark small"></i></div>';
    const p=page('status',key,deco+'<div class="catalog-grid">'+cells+'</div>'+(catalogPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(catalogPage<total-1?'<div class="page-arrow">'+btn('›','next','arrow')+'</div>':''),{counter:(catalogPage+1)+'/'+total,above:head});
    $$('[data-item]',p).forEach(b=>b.onclick=()=>{selectedItems[kind]=+b.dataset.item;openCatalog(kind,catalogPage);openItem(kind,+b.dataset.item);});
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openCatalog(kind,catalogPage-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openCatalog(kind,catalogPage+1));
  }
  function openItem(kind,id) {
    const isW=kind==='weapon',S=State.state(),base=(isW?weaponsMap:skillsMap).getValue(id);
    const it=(isW?State.myWeapons():State.mySkills()).find(x=>x.id===id);
    const up=it?State.upgradeInfo(kind,id):null;
    const description=base.remark||'';
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
    opponents=spread.map(i=>State.genAI(Math.max(1,S.level+i),'',{levelJitter:3}));
    selectedOpponent=null;
  }
  function openChallenge(refresh) {
    if(refresh===true||!opponents.length)genOpponents();
    const content='<div class="challenge-list">'+opponents.map((f,i)=>'<button class="challenger '+(selectedOpponent===i?'active':'')+'" data-foe="'+i+'"><span class="foe-level">'+f.level+'</span><span class="foe-name">'+esc(f.name)+'</span>'+spr('resource_16',3)+'</button>').join('')+'</div><div class="challenge-preview"><canvas width="390" height="292" aria-label="对手预览"></canvas>'+(selectedOpponent!=null?statsHtml(opponents[selectedOpponent],'mini-stats'):'')+'</div><div class="challenge-note"><span>点击刷新<br>下一轮玩家…</span>'+btn('刷新玩家','refresh','small muted')+'</div>'+(selectedOpponent!=null?'<div class="preview-fight">'+btn('挑战他','fight','small')+'</div>':'');
    const p=page('challenge','challenge',content,{counter:'1/1'});
    portrait($('.challenge-preview canvas',p),{silhouette:selectedOpponent==null,wears:[]});
    $$('[data-foe]',p).forEach(b=>b.onclick=()=>{selectedOpponent=+b.dataset.foe;openChallenge();});
    $('[data-action="refresh"]',p).onclick=()=>openChallenge(true);
    $('[data-action="fight"]',p)?.addEventListener('click',()=>{
      const foe=opponents[selectedOpponent],S=State.state();
      if(S.energy<10){notice('体力不足！每5分钟恢复1点，也可以使用体力药剂。',[{label:'使用药剂',run:()=>openBag()},{label:'返回',cls:'gold'}]);return;}
      Main.startBattle(foe,{cost:10,kind:'challenge',useProps:true,onEnd:(winner)=>{
        const win=winner===0;if(win){S.dailyWins++;S.allWins++;}else{S.dailyFails++;S.allFails++;}
        const rw=State.fightReward(win);resultModal(win,rw);opponents=[];
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
    const text='<div class="mission-guide"><img alt="向导" src="images/classic/characters/master-classic.png"><div>【消耗】：'+cost+'<br>【整轮奖励】：经验'+reward.exp+'<br>金松果'+reward.gold+'，有几率得碎片<br><span class="small-label">现有挑战书 '+(S.props[23]||0)+' 个</span></div></div><p class="mission-description">连续击败3名敌人，领取整轮奖励。<br>当前对手：'+esc(npc.name)+'（'+idx+'/3）<br>'+(run?'本轮已复活 '+run.revives+'/2 次。':type.recommend+'。')+'</p>';
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
    const foe={name:npc.name,level:10+stageId*2,power:+npc.power,agility:+npc.agility,speed:+npc.speed,hp:+npc.hp,weapons:[],skills:(npc.skills||'').split('|').filter(Boolean).map(s=>{const a=s.split(':');return{id:+a[0],level:+a[1]};}),npcType:type.anim};
    const interrupted=()=>{State.interruptStageBattle(stageId,started.token);home();notice('战斗播放中断，本轮进度已保留。重新进入关卡即可继续。');};
    try { Promise.resolve(Main.startBattle(foe,{region:type.anim==='tl'?3:type.anim==='xh'?4:1,kind:'stage',useProps:false,
      onError:()=>State.interruptStageBattle(stageId,started.token),
      onEnd:w=>{
        const rw=State.finishStageBattle(stageId,started.token,w===0);
        if(!rw.ok)return;
        stageResult(stageId,npc,started.npcIndex,rw);
      }
    })).catch(interrupted); } catch(error) { interrupted(); }
  }
  function stageResult(stageId,npc,idx,rw) {
    const back=()=>openDifficulty(Math.floor((stageId-1)/6));
    const reward=rw.complete?'<div class="result-lines">整轮经验 +'+rw.exp+'　金松果 +'+rw.gold+'</div>':'';
    let message,buttons;
    if(rw.complete){
      message='恭喜通关！三名对手全部击败。';
      buttons=[{label:'继续闯关',run:back},{label:'返回菜单',cls:'gold',run:home}];
    }else if(rw.win){
      message='已击败'+npc.name+'（'+idx+'/3）。继续挑战不再消耗挑战书，全部击败后发放整轮奖励。';
      buttons=[{label:'继续挑战',run:()=>stageConfirm(stageId)},{label:'稍后继续',cls:'gold',run:back},{label:'结束本轮',cls:'muted',run:()=>stageAbandon(stageId)}];
    }else{
      const canRevive=rw.run.revives<2;
      message=canRevive?'挑战失败，可花1个挑战书复活自己，继续本轮挑战。剩余复活次数：'+(2-rw.run.revives)+'。':'本轮2次复活机会已用完。结束本轮后可以重新挑战。';
      buttons=canRevive?[{label:'复活再战',run:()=>stageConfirm(stageId)},{label:'稍后继续',cls:'gold',run:back}]:[];
      buttons.push({label:'结束本轮',cls:'muted',run:()=>stageAbandon(stageId)});
    }
    const drop=rw.drop?'<p>获得'+esc(rw.drop.name)+' ×'+rw.drop.count+'</p>':'';
    modal('关卡战果','<div class="result-box"><div class="result-title '+(rw.win?'win':'lose')+'">'+(rw.win?'胜 利！':'再接再厉')+'</div>'+reward+'<p>'+esc(message)+'</p>'+drop+stageUpsHtml(rw.ups)+'</div>',buttons);
  }
  function openBag(shop,pg) {
    shop=shop===true;bagPage=pg||0;
    const S=State.state(),items=[];
    propMap.each((id,v)=>{if(shop?v.buy==='true':S.props[id]>0)items.push({...v,id:+id});});
    items.sort((a,b)=>a.id-b.id);
    const total=Math.max(1,Math.ceil(items.length/8));bagPage=Math.min(bagPage,total-1);
    const content='<div class="bag-layout"><aside class="bag-sidebar">'+sprBtn('resource_2',7,'bag',{w:168,h:60,cls:!shop?'active':'',title:'我的道具'})+sprBtn('resource_2',8,'shop',{w:168,h:60,cls:shop?'active':'',title:'道具商店'})+sprBtn('resource_2',40,'lottery',{w:168,h:60,cls:'spr-gold',title:'每日抽奖'})+'</aside><div class="catalog-grid bag-grid">'+items.slice(bagPage*8,bagPage*8+8).map(it=>'<button class="catalog-cell" data-prop="'+it.id+'"><span class="item-icon">'+icon('prop',it.id)+(shop?'':'<b class="item-count">×'+S.props[it.id]+'</b>')+'</span><span class="item-caption">'+esc(it.name)+'</span></button>').join('')+(items.length?'':'<div class="empty-state">背包空空的<br>去商店看看吧！</div>')+'</div></div>'+(bagPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(bagPage<total-1?'<div class="page-arrow">'+btn('›','next','arrow')+'</div>':'');
    const p=page('bag',shop?'shop':'bag',content,{counter:(bagPage+1)+'/'+total});
    $$('[data-prop]',p).forEach(b=>b.onclick=()=>openProp(+b.dataset.prop,shop));
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openBag(shop,bagPage-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openBag(shop,bagPage+1));
  }
  function openProp(id,shop) {
    const base=propMap.getValue(id),S=State.state();
    if(!base)return;
    const isFragment=[24,25,26].includes(id),isSeed=[45,46].includes(id),canUse=base.useType==='1';
    const content='<div class="detail-summary"><span class="item-icon">'+icon('prop',id)+'</span><div><h3 class="detail-name">'+esc(base.name)+'</h3><div class="detail-description">'+esc(base.remark||'')+'</div><div class="small-label">拥有 '+(S.props[id]||0)+' 个'+(shop?'　售价 '+base.price+' 金松果':'')+'</div></div></div><p class="small-label">金松果：'+S.goldPoint+'</p>';
    const label=shop?'购买':isFragment?'合成装备':isSeed?'合成果实':canUse?'使用':'返回';
    modal(shop?'道具商店':'道具详情',content,[{label,run:()=>{
      if(!shop&&!canUse&&!isFragment&&!isSeed)return;
      if(!shop&&isSeed){if((S.props[id]||0)<10||S.goldPoint<50){toast('合成需要10个种子和50金松果');return;}S.props[id]-=10;S.goldPoint-=50;const fruit=id===45?47:48;S.props[fruit]=(S.props[fruit]||0)+1;State.save();toast('合成成功：'+propMap.getValue(fruit).name);openBag(false,bagPage);return;}
      const r=shop?State.buyProp(id,1):isFragment?State.composeGear(id):State.useProp(id);
      toast(r.msg||(r.gear?'合成成功：'+r.gear.name:'操作完成'));
      if(r.ok){openBag(shop,bagPage);if(shop)openProp(id,true);}
    }},{label:'返回',cls:'muted'}],{small:true});
  }
  function gearImg(g) {
    return '<img alt="" src="images/classic/icons/gear-'+g.id+'.png">';
  }
  function openGears(pg) {
    gearPage=typeof pg==='number'?pg:0;
    const gears=State.myGears(),total=Math.max(1,Math.ceil(gears.length/6));gearPage=Math.min(gearPage,total-1);
    const slots=['头部','手部','身体','脚部'];
    const content='<p class="gear-note">相同的附加属性效果不叠加，最高的1条生效！</p><div class="gear-layout"><div class="gear-slots">'+slots.map((name,i)=>{const g=gears.find(x=>x.used&&x.type===i);return '<button class="catalog-cell" '+(g?'data-gear="'+esc(g.key)+'"':'disabled')+'><span class="item-icon">'+(g?gearImg(g):'<span class="gear-empty">'+name+'</span>')+'</span></button>';}).join('')+'</div><div class="gear-list">'+gears.slice(gearPage*6,gearPage*6+6).map(g=>'<button class="catalog-cell '+(g.used?'selected':'')+'" data-gear="'+esc(g.key)+'"><span class="item-icon">'+gearImg(g)+(g.used?'<span class="equipped-check">✓</span>':'')+'</span><span class="item-caption q'+g.quality+'">'+esc(g.name)+'</span></button>').join('')+(gears.length?'':'<div class="empty-state">还没有装备<br><span class="small-label">挑战关卡获得碎片<br>10个碎片可合成一件装备</span><br>'+btn('去闯关','stages','small gold')+'</div>')+'</div></div>'+(gearPage?'<div class="page-arrow prev">'+btn('‹','prev','arrow')+'</div>':'')+(gearPage<total-1?'<div class="page-arrow">'+btn('›','next','arrow')+'</div>':'');
    const p=page('status','status',content,{cls:'gear-board',counter:'容量 '+gears.length+'/100'});
    $$('.gear-slots button',p).forEach((b,i)=>{const g=gears.find(x=>x.used&&x.type===i);b.setAttribute('aria-label',slots[i]+(g?'：'+g.name:'：未装备'));});
    $$('[data-gear]',p).forEach(b=>b.onclick=()=>openGear(b.dataset.gear));
    $('[data-action="prev"]',p)?.addEventListener('click',()=>openGears(gearPage-1));
    $('[data-action="next"]',p)?.addEventListener('click',()=>openGears(gearPage+1));
    $('[data-action="home"]',p).textContent='返回';$('[data-action="home"]',p).onclick=openStatus;
  }
  function openGear(key) {
    const g=State.myGears().find(x=>x.key===key);if(!g)return;
    const content='<div class="gear-detail"><div class="catalog-cell"><h3 class="detail-name q'+g.quality+'">'+esc(g.name)+'</h3><span class="item-icon">'+gearImg(g)+'</span><span class="small-label">'+['普通','优秀','杰出','卓越'][g.quality]+'</span></div><div>装备类别：'+['头部','手部','身体','脚部'][g.type]+'　使用等级：'+g.useLevel+'<br>基本属性：'+esc(g.attrName)+' +'+g.abilityVal+'<br>附加属性：<br>'+State.extText(g.ext).map(esc).join('<br>')+'</div></div>';
    modal('我的装备',content,[{label:g.used?'卸下':'装备',run:()=>{const ok=g.used?State.unwear(key):State.wear(key);if(ok===false)toast('等级不足，暂时无法装备');openGears(gearPage);}},{label:'出售',cls:'muted',run:()=>notice('确定以 '+g.price+' 金松果出售【'+g.name+'】吗？',[{label:'出售',run:()=>{State.sellGear(key);openGears(gearPage);}},{label:'返回',cls:'muted'}])},{label:'返回',cls:'muted'}]);
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
    const d=State.dailyStatus();
    modal('每日礼包','<div class="mission-guide">'+spr('resource_16',0)+'<div>每天回家，都有一份小礼物。<br>金松果 ×150<br>挑战书 ×1</div></div>',[{label:d.claimed?'今日已领取':'领取礼包',cls:d.claimed?'muted':'',run:()=>{const r=State.claimDaily();toast(r.msg);refreshHome();}},{label:'返回',cls:'gold'}],{small:true});
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
  function openHelp() {
    modal('游戏帮助','<div class="help-box"><p><b>挑战</b>：选择对手，再点「挑战他」。每场消耗10体力，战斗自动进行。</p><p><b>属性</b>：力量影响伤害，敏捷影响闪避，速度影响出手次数。战斗中随机使用已获得的武器与技能。</p><p><b>成长</b>：战斗获得经验，升级有机会领悟武器与技能。在状态页查看和升级。</p><p><b>体力</b>：每5分钟恢复1点，也可以在道具中使用体力药剂。</p><p><b>关卡</b>：10级开启，按顺序挑战。每轮消耗1张挑战书，连续击败3名敌人；失败最多复活2次，每次再消耗1张。10个装备碎片可合成装备，3件相同装备可以融合。</p><p><b>录像</b>：最近50场战斗保存在消息页，回放不消耗体力，也不会重复发放奖励。</p><p><b>存档</b>：自动保存。可在系统中导出、导入，音乐开关也会保存。</p></div>',[{label:'知道了'}]);
  }
  function fallback(key){if(window.ClassicExtras && window.ClassicExtras[key])window.ClassicExtras[key]();else legacy.runAction(key);}
  const actions={home,status:openStatus,weapons:()=>openCatalog('weapon'),skills:()=>openCatalog('skill'),challenge:()=>openChallenge(),battle:()=>openChallenge(),stages:openStages,bag:()=>openBag(),shop:()=>openBag(true),gears:()=>openGears(),messages:()=>openMessages(),ranklog:()=>openMessages('ranklog'),revenge:()=>openMessages('revenge'),board:openBoard,friends:openFriends,daily:openDaily,system:openSystem,village:openVillage,help:openHelp,arena:()=>fallback('arena'),rank:()=>fallback('rank'),lottery:()=>fallback('lottery'),master:()=>fallback('master')};
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
    classic:{page,modal,btn,bind,icon,spr,statsHtml,portrait,resultModal,home,toast,num,setNum,upgradeReward,upsHtml},
    weaponIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('weapon',id)+'">',
    skillIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('skill',id)+'">',
    propIcon:(id,size)=>'<img class="icon" width="'+(size||56)+'" height="'+(size||56)+'" src="'+atlasIcon('prop',id)+'">'};
})();
