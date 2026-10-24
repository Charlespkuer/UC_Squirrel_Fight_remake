/* ============================================================
 * ui.js — 界面层
 *   · 主界面 HUD：用原版素材（shouyebiao / resource_1 / resource_13 /
 *     resource_16）画在 canvas 上，力求还原原版首页
 *   · 菜单按钮与功能面板：DOM 覆盖层（便于滚动与交互），配色与
 *     质感沿用原版橙色系
 * ============================================================ */

/* ------------------------------------------------------------
 * 目录：界面层（legacy）：HUD / 面板 / 菜单
 * Ctrl+F 搜节号（如「【UI1】」）直达对应代码块。
 *
 *  【UI1】DOM 小件  【UI2】图标  【UI3】主界面 HUD
 *  【UI4】面板框架  【UI5】菜单动作表  【UI6】挑战
 *  【UI7】关卡  【UI8】竞技场  【UI9】天梯赛
 *  【UI10】武器 / 技能  【UI11】背包  【UI12】装备
 *  【UI13】商店  【UI14】抽奖  【UI15】师徒
 *  【UI16】帮助  【UI17】导出 window.UI
 * ------------------------------------------------------------ */
(function () {
  'use strict';

  /* ============================================================
   * 【UI1】DOM 小件（$/el/esc）
   * ============================================================ */
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const escHtml = (value) => String(value == null ? '' : value)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ============================================================
   * 【UI2】图标（图集帧 → 小 canvas / dataURL）
   * ============================================================ */
  // ---------- 图标（把图集里的帧画成小 canvas / dataURL） ----------
  const iconUrlCache = Object.create(null);
  function frameDataUrl(sheetId, label, size) {
    const key = sheetId + '#' + label + '@' + size;
    if (iconUrlCache[key] !== undefined) return iconUrlCache[key];
    const sh = Engine.SHEETS[sheetId];
    let url = '';
    if (sh && sh.img && sh.img.naturalWidth) {
      const f = sh.frames[String(label)];
      if (f) {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const cx = c.getContext('2d');
        const s = Math.min(size / f.sw, size / f.sh);
        const w = f.sw * s, h = f.sh * s;
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(sh.img, f.sx, f.sy, f.sw, f.sh, (size - w) / 2, (size - h) / 2, w, h);
        url = c.toDataURL('image/png');
      }
    }
    iconUrlCache[key] = url;
    return url;
  }
  /** 网格图集（wuqi/jineng/daoju）取第 index 格 */
  function gridDataUrl(sheetId, index, size) {
    const key = sheetId + '#' + index + '@' + size;
    if (iconUrlCache[key] !== undefined) return iconUrlCache[key];
    const sh = Engine.SHEETS[sheetId];
    let url = '';
    const def = sh && sh.def;
    if (sh && sh.img && sh.img.naturalWidth && def && def.w) {
      const cols = Math.max(1, Math.floor(sh.img.width / def.w));
      const n = def.n || (cols * Math.floor(sh.img.height / def.h));
      const i = ((index % n) + n) % n;
      const sx = (i % cols) * def.w, sy = Math.floor(i / cols) * def.h;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(sh.img, sx, sy, def.w, def.h, 0, 0, size, size);
      url = c.toDataURL('image/png');
    }
    iconUrlCache[key] = url;
    return url;
  }
  function imgTag(url, cls, size) {
    if (!url) return '<span class="icon-ph"' + (size ? ' style="width:' + size + 'px;height:' + size + 'px"' : '') + '></span>';
    /* 图标文件缺失时别把浏览器的「破图」标记摊在卡片上：隐藏掉，只留底色和名字。
     * 黑色装备（品质 5）还有一部分 id 没导出 PNG 图标，破图会让玩家以为装备没了。 */
    return '<img class="' + (cls || 'icon') + '" src="' + url + '"' + (size ? ' style="width:' + size + 'px;height:' + size + 'px"' : '') +
      ' onerror="this.style.visibility=\'hidden\'">';
  }
  function weaponIcon(id, size) { return imgTag('images/ui/icons/weapon/weapon-' + id + '.png', 'icon', size || 56); }
  function skillIcon(id, size) { return imgTag('images/ui/icons/skill/skill-' + id + '.png', 'icon', size || 56); }
  function propIcon(id, size) { return imgTag('images/ui/icons/prop/prop-' + id + '.png', 'icon', size || 56); }
  function gearIcon(g, size) {
    return imgTag('images/ui/icons/gear/gear-' + g.id + '.png', 'icon', size || 56);
  }
  /** 首次打开装备面板时批量加载装备图标，加载完换成 canvas 缩略图（保证缩放质量一致） */
  let equipSheetAsked = false;
  function ensureEquipSheet() {
    if (equipSheetAsked) return;
    equipSheetAsked = true;
    const ids = Object.keys(Engine.SRC_MAP).filter((k) => /^(Head|HandO|HandI|Body|Arm|Foot)_/.test(k));
    Engine.loadSheets(ids).then(() => {
      // 把已渲染的 <img data-equip> 换成 canvas 缩略图
      const list = document.querySelectorAll('#ui img[data-equip]');
      for (const img of list) {
        const name = img.getAttribute('data-equip');
        const size = parseInt(img.style.width) || 56;
        const url = frameDataUrl(name, '1', size) || frameDataUrl(name, '2', size);
        if (url) img.src = url;
      }
    });
  }

  const QUALITY_NAME = ['普通', '优秀', '杰出', '卓越'];
  const QUALITY_CLS = ['q0', 'q1', 'q2', 'q3'];

  /* ============================================================
   * 【UI3】主界面 HUD（canvas）
   * ============================================================ */
  // ---------- 主界面 HUD（canvas） ----------
  /** 圆角矩形路径 */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  /** 原版风格面板（深棕底 + 金边） */
  function panelBg(ctx, x, y, w, h) {
    ctx.save();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(74,47,20,.92)');
    g.addColorStop(1, 'rgba(38,22,8,.92)');
    rr(ctx, x, y, w, h, 14);
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,179,46,.85)';
    ctx.stroke();
    ctx.restore();
  }
  /** 进度条 */
  function bar(ctx, x, y, w, h, pct, c0, c1) {
    ctx.save();
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fill();
    ctx.save();
    rr(ctx, x, y, w, h, h / 2); ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, Math.max(0, w * Math.max(0, Math.min(1, pct))), h);
    ctx.restore();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,214,138,.9)';
    rr(ctx, x, y, w, h, h / 2); ctx.stroke();
    ctx.restore();
  }

  // 主界面快捷栏用的小图标（canvas 对象缓存）
  const gridCanvasCache = Object.create(null);
  function gridIconUrl(sheetId, index) {
    const key = sheetId + '#' + index;
    if (gridCanvasCache[key] !== undefined) return gridCanvasCache[key];
    const sh = Engine.SHEETS[sheetId];
    let cv = null;
    const def = sh && sh.def;
    if (sh && def && def.w) {
      const cols = Math.max(1, Math.floor(sh.img.width / def.w));
      const n = def.n || (cols * Math.floor(sh.img.height / def.h));
      const i = ((index % n) + n) % n;
      cv = document.createElement('canvas');
      cv.width = def.w; cv.height = def.h;
      const cx = cv.getContext('2d');
      cx.drawImage(sh.img, (i % cols) * def.w, Math.floor(i / cols) * def.h, def.w, def.h, 0, 0, def.w, def.h);
    }
    gridCanvasCache[key] = cv;
    return cv;
  }

  function hitRegion(regions, x, y) {
    for (const r of regions) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
    return null;
  }

  /* ============================================================
   * 【UI4】面板框架
   * ============================================================ */
  // ---------- 面板框架 ----------
  function openPanel(title, contentEl, opts) {
    opts = opts || {};
    const overlay = el('div', 'panel-overlay');
    const panel = el('div', 'panel');
    const head = el('div', 'panel-head');
    head.appendChild(el('span', 'panel-title', title));
    const close = el('button', 'panel-close', '✕');
    close.onclick = () => { overlay.remove(); if (opts.onClose) opts.onClose(); };
    head.appendChild(close);
    panel.appendChild(head);
    const body = el('div', 'panel-body');
    body.appendChild(contentEl);
    panel.appendChild(body);
    overlay.appendChild(panel);
    $('#ui').appendChild(overlay);
    return { overlay: overlay, body: body, close: () => overlay.remove() };
  }
  function toast(msg, ms) {
    const t = el('div', 'toast', msg);
    $('#ui').appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms || 2200);
  }
  function confirmBox(msg, onYes) {
    const box = el('div');
    box.appendChild(el('p', 'confirm-text', msg));
    const row = el('div', 'btn-row');
    const yes = el('button', 'btn btn-primary', '确定');
    const no = el('button', 'btn', '取消');
    yes.onclick = () => { p.close(); onYes && onYes(); };
    no.onclick = () => p.close();
    row.appendChild(yes); row.appendChild(no);
    box.appendChild(row);
    const p = openPanel('提示', box);
  }

  /* ============================================================
   * 【UI5】菜单动作表（HUD 点击 → 面板）
   * ============================================================ */
  // ---------- 菜单动作表（主界面 HUD 点击 → 面板） ----------
  const ACTIONS = {
    challenge: openChallenge, stages: openStages, arena: openArena, rank: openRank,
    weapons: openWeapons, skills: openSkills, bag: openBag, gears: openGears,
    shop: openShop, lottery: openLottery, master: openMaster, help: openHelp,
    battle: openChallenge,
  };
  function runAction(key) { const f = ACTIONS[key]; if (f) f(); }

  /** 主界面只有 canvas HUD，DOM 层留空 */
  function renderHome() {
    $('#ui').innerHTML = '';
  }

  /* ============================================================
   * 【UI6】挑战（PVP vs AI）
   * ============================================================ */
  // ---------- 挑战（PVP vs AI） ----------
  /** 现代随机战斗的「查看」：武技等级、装备主属性/附加词条/宝石、幻兽。 */
  function showEnemyLoadout(foe) {
    const d = State.foeLoadout ? State.foeLoadout(foe) : null;
    if (!d) { toast('对手数据还没准备好'); return; }
    const box = el('div');
    const stat = d.stats;
    const part = '<p class="panel-desc"><b>' + escHtml(d.name || '对手') + ' Lv.' + d.level + '</b>　力量 ' +
      stat.power + '　敏捷 ' + stat.agility + '　速度 ' + stat.speed + '　生命 ' + stat.hp + '/' + stat.maxHp + '</p>';
    const weaponRows = d.weapons.length
      ? d.weapons.map((w) => '<div class="ws-row"><div class="ws-info"><b>' + escHtml(w.name) + '</b> <span class="ws-type">' +
        escHtml(w.type || '武器') + '</span><span class="ws-lv">Lv.' + w.level + '</span></div></div>').join('')
      : '<p class="panel-desc">没有武器</p>';
    const skillRows = d.skills.length
      ? d.skills.map((s) => '<div class="ws-row"><div class="ws-info"><b>' + escHtml(s.name) + '</b> <span class="ws-lv">Lv.' +
        s.level + '</span></div></div>').join('')
      : '<p class="panel-desc">没有技能</p>';
    const gearRows = d.gears.length
      ? d.gears.map((g) => {
        const ext = g.ext && g.ext.length ? '　' + escHtml(g.ext.join('，')) : '';
        const gem = g.gem ? '　宝石 Lv.' + g.gem.level + '（+' + g.gem.percent + '%）' : '';
        return '<div class="ws-row"><div class="ws-info"><b>' + escHtml(g.part + '·' + g.name) + '</b> <span class="ws-lv">' +
          escHtml(g.attrName) + '+' + g.abilityVal + '</span>' +
          '<div class="ws-remark">' + escHtml(g.setName || '散件') + ext + gem + '</div></div></div>';
      }).join('')
      : '<p class="panel-desc">没有装备</p>';
    const petRows = d.pets && d.pets.length
      ? '<p class="panel-desc">幻兽：' + d.pets.map((p) => escHtml((p.name || '幻兽') + ' Lv.' + (p.level || 1))).join('，') + '</p>'
      : '';
    box.innerHTML = part +
      '<h4>武器（具体等级）</h4>' + weaponRows +
      '<h4>技能（具体等级）</h4>' + skillRows +
      '<h4>装备加成</h4>' + gearRows + petRows;
    openPanel('对手详情', box);
  }
  function openChallenge() {
    const S = State.state();
    const box = el('div');
    let foes = [];
    function genFoes() {
      foes = [];
      for (let i = 0; i < 5; i++) {
        const lv = Math.max(1, S.level + Math.floor(Math.random() * 5) - 2);
        foes.push(State.genAI(lv, '', { statScale: State.RANDOM_FOE_SCALE || 1.08 }));
      }
    }
    function render() {
      box.innerHTML = '';
      box.appendChild(el('p', 'panel-desc', '每次挑战消耗 <b>10</b> 点体力（当前 ' + S.energy + '）。胜利可获得经验与金松果！'));
      const list = el('div', 'foe-list');
      foes.forEach((f, i) => {
        const row = el('div', 'foe-row');
        row.innerHTML =
          '<div class="foe-avatar sq-avatar"></div>' +
          '<div class="foe-info"><b>' + f.name + '</b> Lv.' + f.level +
          '<span class="foe-stats">力量' + f.power + ' 敏捷' + f.agility + ' 速度' + f.speed + ' 生命' + f.hp + '</span></div>';
        const btn = el('button', 'btn btn-primary', '挑战');
        btn.onclick = () => {
          if (S.energy < 10) { toast('体力不足！使用体力药剂或等待恢复'); return; }
          p.close();
          Main.startBattle(f, {
            cost: 10, useProps: true,
            onEnd: (winner) => {
              const win = winner === 0;
              if (win) { S.dailyWins++; S.allWins++; } else { S.dailyFails++; S.allFails++; }
              const rw = State.fightReward(win, { foeLevel: f.level });
              showResult(win, f, rw);
            },
          });
        };
        const view = el('button', 'btn', '查看');
        view.onclick = () => showEnemyLoadout(f);
        row.appendChild(view);
        row.appendChild(btn);
        list.appendChild(row);
      });
      box.appendChild(list);
      const refresh = el('button', 'btn', '换一批');
      refresh.onclick = () => { genFoes(); render(); };
      box.appendChild(refresh);
    }
    genFoes(); render();
    const p = openPanel('⚔️ 挑战', box);
  }

  function showResult(win, foe, rw, extra) {
    const box = el('div', 'result-box');
    box.innerHTML =
      '<div class="result-title ' + (win ? 'win' : 'lose') + '">' + (win ? '胜 利！' : '战 败…') + '</div>' +
      '<div class="result-lines"><div>经验 +' + rw.exp + (rw.gold ? '　金松果 +' + rw.gold : '') + '</div>' + (extra || '') + '</div>';
    for (const up of rw.ups || []) {
      box.appendChild(el('div', 'levelup-line', '🎉 升级到 <b>' + up.level + '</b> 级！力量+' + up.power + ' 敏捷+' + up.agility + ' 速度+' + up.speed + ' 生命+' + up.hp + (up.reward ? '，学会【' + up.reward + '】' : '')));
    }
    const row = el('div', 'btn-row');
    const ok = el('button', 'btn btn-primary', '确定');
    ok.onclick = () => { p.close(); Main.showHome(); };
    row.appendChild(ok);
    box.appendChild(row);
    const p = openPanel('战斗结果', box);
  }

  /* ============================================================
   * 【UI7】关卡
   * ============================================================ */
  // ---------- 关卡 ----------
  function openStages() {
    const S = State.state();
    const box = el('div');
    box.appendChild(el('p', 'panel-desc', '挑战关卡需要 <b>挑战书</b>（当前 ' + (S.props[23] || 0) + ' 张）。通关可得经验、金松果，还有几率掉落装备碎片！'));
    const grid = el('div', 'stage-grid');
    for (let t = 0; t < 3; t++) {
      const type = GData.STAGE_TYPES[t];
      const col = el('div', 'stage-col');
      col.appendChild(el('div', 'stage-type', (['🦗', '🕊️', '🐼'][t]) + ' ' + type.name + '<span class="stage-rec">' + type.recommend + '</span>'));
      for (let star = 1; star <= 6; star++) {
        const stageId = t * 6 + star;
        const prog = State.stageProgress(stageId);
        const firstNpc = State.npcOf(stageId, 1);
        const btn = el('button', 'stage-btn' + (prog.passed ? ' passed' : ''));
        btn.innerHTML = '★'.repeat(star) + (prog.passed ? ' ✓' : prog.npcIndex > 1 ? ' (' + prog.npcIndex + '/3)' : '');
        btn.title = firstNpc ? firstNpc.name + ' 生命' + firstNpc.hp : '';
        btn.onclick = () => openStageDetail(stageId);
        col.appendChild(btn);
      }
      grid.appendChild(col);
    }
    box.appendChild(grid);
    openPanel('🏯 关卡', box);
  }

  function openStageDetail(stageId) {
    const S = State.state();
    const star = GData.stageStar(stageId);
    const type = GData.stageTypeOf(stageId);
    const prog = State.stageProgress(stageId);
    const box = el('div');
    box.appendChild(el('p', 'panel-desc', type.name + ' ' + '★'.repeat(star) + ' —— ' + type.desc + '。' + type.recommend + '。依次击败 学徒→拳师→大侠 即可通关。'));
    for (let idx = 1; idx <= 3; idx++) {
      const npc = State.npcOf(stageId, idx);
      if (!npc) continue;
      const locked = idx > prog.npcIndex && !prog.passed;
      const row = el('div', 'foe-row' + (locked ? ' locked' : ''));
      row.innerHTML =
        '<div class="foe-avatar">' + (['🥷', '🥋', '👹'][idx - 1]) + '</div>' +
        '<div class="foe-info"><b>' + npc.name + '</b>' + (npc.isBoss === 'true' ? ' <span class="boss-tag">BOSS</span>' : '') +
        '<span class="foe-stats">生命' + npc.hp + ' 力量' + GData.stageNpcStats(npc).power + ' 敏捷' + GData.stageNpcStats(npc).agility + ' 速度' + GData.stageNpcStats(npc).speed + '</span></div>';
      const btn = el('button', 'btn btn-primary', prog.passed ? '重打' : (idx < prog.npcIndex ? '重打' : '挑战'));
      btn.disabled = locked;
      /* 原版关卡（fightType 6）的徒弟先上阵：第一场把徒弟快照交给 Main.startBattle；
       * 徒弟失败后弹「徒弟无能…」并由师父免费接手同一名对手；徒弟赢了继续由徒弟打。 */
      const runState = () => (State.stageRuns && State.stageRuns[stageId]) || null;
      const startFight = (asMaster) => {
        const r = runState();
        const prentice = !asMaster ? State.stagePrentice() : null;
        const fighter = prentice ? State.stagePrenticeFighter() : null;
        const master = asMaster || !prentice || !fighter;
        /* 师父第一次接手（由徒弟战败触发）免费；之后的师父战斗照现代关卡原样扣书。 */
        const freeMaster = !!(master && r && r.masterFree);
        if (!freeMaster) {
          if ((S.props[23] || 0) < 1) { toast('需要挑战书！可在商店购买'); return; }
          S.props[23]--;
        }
        if (master && r) { r.masterFree = false; }
        State.save();
        p.close();
        const foe = GData.stageFoe(npc, stageId, type.anim, State.challengeDailyCount ? State.challengeDailyCount() : 0);
        Main.startBattle(foe, {
          cost: 0, useProps: false, region: type.anim === 'tl' ? 3 : type.anim === 'xh' ? 4 : 1,
          fighter: fighter || undefined,
          onEnd: (winner) => {
            const win = winner === 0;
            if (!master && !win) {
              /* 徒弟战败：不结算、不扣复活；标记师父接手后弹原版台词。 */
              State.stageRuns = State.stageRuns || {};
              const rr = State.stageRuns[stageId] || (State.stageRuns[stageId] = { npcIndex: idx, revives: 0, needsRevive: false });
              rr.masterOnly = true; rr.masterFree = true; State.save();
              const box = el('div', 'result-box');
              box.innerHTML = '<div class="result-title lose">徒弟战败</div><p><b>徒弟无能，打不过它！该师父您亲自上阵了！</b></p>' +
                '<p class="small-label">徒弟「' + escHtml(prentice.name) + '」已败下阵；师父接手同一名对手，不消耗挑战书，也不占用复活次数。</p>';
              const row2 = el('div', 'btn-row');
              const go = el('button', 'btn btn-primary', '师父上阵');
              const later = el('button', 'btn', '稍后继续');
              row2.appendChild(go); row2.appendChild(later); box.appendChild(row2);
              const pop = openPanel('徒弟战败', box);
              go.onclick = () => { pop.close(); startFight(true); };
              later.onclick = () => pop.close();
              return;
            }
            if (win) {
              const prog2 = State.stageProgress(stageId);
              let extra = '';
              if (!prog2.passed) {
                if (idx >= 3) { prog2.passed = true; extra = '<div>🎉 通关本关卡！</div>'; }
                else prog2.npcIndex = idx + 1;
                State.setStageProgress(stageId, prog2);
              }
              const exp = 15 + star * 10 + idx * 5;
              const gold = 5 + star * 3;
              State.addGold(gold);
              let fragTxt = '';
              if (Math.random() < 0.25 + star * 0.05) {
                const fragId = star <= 2 ? 24 : star <= 4 ? 25 : 26;
                const n = 1 + Math.floor(Math.random() * 2);
                S.props[fragId] = (S.props[fragId] || 0) + n;
                fragTxt = '<div>获得 ' + propMap.getValue(fragId).name + ' x' + n + '</div>';
              }
              const ups = State.gainExp(exp);
              if (prog2.passed) {
                if (State.stageRuns) delete State.stageRuns[stageId];
              } else {
                const rr = State.stageRuns && State.stageRuns[stageId];
                if (rr) { rr.masterOnly = master; rr.masterFree = false; }
              }
              State.save();
              showResult(true, foe, { exp: exp, gold: gold, ups: ups }, extra + fragTxt);
            } else {
              const rr = State.stageRuns && State.stageRuns[stageId];
              if (rr) { rr.masterOnly = true; rr.masterFree = false; State.save(); }
              showResult(false, foe, { exp: 0, gold: 0, ups: [] }, '<div>提升等级、强化武器技能或穿戴装备后再来。</div>');
            }
          },
        });
      };
      btn.onclick = () => {
        const r = runState();
        startFight(!!(r && r.masterOnly));
      };
      row.appendChild(btn);
      box.appendChild(row);
    }
    const p = openPanel(type.name + ' ' + '★'.repeat(star), box);
  }

  /* ============================================================
   * 【UI8】竞技场
   * ============================================================ */
  // ---------- 竞技场 ----------
  function openArena() {
    const S = State.state();
    const box = el('div');
    box.appendChild(el('p', 'panel-desc', '4 只松鼠淘汰赛！经验场每局消耗 30 体力（可用英雄帖），冠军 150 经验；碎片场冠军得蓝色碎片。'));
    const row = el('div', 'btn-row');
    const b1 = el('button', 'btn btn-primary', '经验场');
    const b2 = el('button', 'btn btn-primary', '碎片场');
    b1.onclick = () => joinArena(0);
    b2.onclick = () => joinArena(1);
    row.appendChild(b1); row.appendChild(b2);
    box.appendChild(row);
    const p = openPanel('🏟️ 竞技场', box);

    function joinArena(mode) {
      if (S.energy < 30 && (S.props[36] || 0) < 1 && (S.props[39] || 0) < 1) { toast('体力不足30点，也没有英雄帖/勇气徽章！'); return; }
      if (S.energy >= 30) State.consumeEnergy(30);
      else if (mode === 0 && (S.props[36] || 0) > 0) S.props[36]--;
      else if (mode === 1 && (S.props[39] || 0) > 0) S.props[39]--;
      else if ((S.props[36] || 0) > 0) S.props[36]--;
      else S.props[39]--;
      State.save();
      const ais = [State.genAI(S.level, '', { statScale: State.RANDOM_FOE_SCALE || 1.08 }), State.genAI(S.level, '', { statScale: State.RANDOM_FOE_SCALE || 1.08 }), State.genAI(S.level, '', { statScale: State.RANDOM_FOE_SCALE || 1.08 })];
      p.close();
      toast('你抽到的对手是【' + ais[0].name + '】Lv.' + ais[0].level + '，比赛开始！', 2500);
      setTimeout(() => {
        Main.startBattle(ais[0], {
          cost: 0, kind: 'arena', useProps: false, region: 0,
          onEnd: (winner) => {
            if (winner !== 0) {
              showResult(false, ais[0], { exp: 10, gold: 0, ups: State.gainExp(10) }, '<div>止步半决赛，获得参与经验。</div>');
              return;
            }
            const other = Sim.simulate(ais[1], ais[2]);
            const finalist = other.winner === 0 ? ais[1] : ais[2];
            toast('半决赛获胜！决赛对手：【' + finalist.name + '】Lv.' + finalist.level, 2500);
            setTimeout(() => {
              Main.startBattle(finalist, {
                cost: 0, kind: 'arena', useProps: false, region: 0,
                onEnd: (w2) => {
                  if (w2 === 0) {
                    if (mode === 0) {
                      const ups = State.gainExp(150);
                      State.addGold(10);
                      showResult(true, finalist, { exp: 150, gold: 10, ups: ups }, '<div>🏆 竞技场冠军！</div>');
                    } else {
                      S.props[26] = (S.props[26] || 0) + 8;
                      const ups2 = State.gainExp(30);
                      showResult(true, finalist, { exp: 30, gold: 0, ups: ups2 }, '<div>🏆 碎片场冠军！蓝色碎片 x8</div>');
                    }
                    State.save();
                  } else {
                    const ups3 = State.gainExp(75);
                    showResult(false, finalist, { exp: 75, gold: 0, ups: ups3 }, '<div>获得亚军（75经验）</div>');
                  }
                },
              });
            }, 800);
          },
        });
      }, 800);
    }
  }

  /* ============================================================
   * 【UI9】天梯赛
   * ============================================================ */
  // ---------- 天梯赛 ----------
  function openRank() {
    const S = State.state();
    if (S.level < 30) { toast('未满30级不能参加天梯赛'); return; }
    if (S.integral == null) S.integral = 1500;
    const box = el('div');
    box.innerHTML = '<p class="panel-desc">当前积分 <b>' + S.integral + '</b>，今日已参赛 ' + S.joinRankCount + ' 场。胜利得积分与金杯，金杯可在商店兑换稀有奖励！</p>';
    const row = el('div', 'btn-row');
    const b1 = el('button', 'btn btn-primary', '开始匹配');
    const b2 = el('button', 'btn', '金杯商店');
    b1.onclick = () => {
      const foe = State.genAI(S.level + Math.floor(Math.random() * 6) - 3, '', { statScale: State.RANDOM_FOE_SCALE || 1.08 });
      p.close();
      S.joinRankCount++;
      State.save();
      Main.startBattle(foe, {
        cost: 0, kind: 'rank', useProps: false, region: 2,
        onEnd: (winner) => {
          const win = winner === 0;
          const delta = win ? 20 + Math.floor(Math.random() * 15) : -(10 + Math.floor(Math.random() * 10));
          S.integral = Math.max(0, S.integral + delta);
          const cups = win ? 5 : 1;
          S.goldCup += cups;
          const ups = State.gainExp(win ? 30 : 10);
          State.save();
          showResult(win, foe, { exp: win ? 30 : 10, gold: 0, ups: ups }, '<div>积分 ' + (delta >= 0 ? '+' : '') + delta + '（当前 ' + S.integral + '），金杯 +' + cups + '</div>');
        },
      });
    };
    b2.onclick = () => { p.close(); openRankShop(); };
    row.appendChild(b1); row.appendChild(b2);
    box.appendChild(row);
    const board = el('div', 'rank-board');
    board.appendChild(el('div', 'rank-title', '—— 排行榜 ——'));
    const entries = [{ name: S.name + '（你）', integral: S.integral }];
    for (let i = 0; i < 9; i++) entries.push({ name: GData.AI_NAMES[(i * 3 + 1) % GData.AI_NAMES.length], integral: 1400 + i * 37 + Math.floor(Math.random() * 30) });
    entries.sort((a, b) => b.integral - a.integral);
    entries.forEach((e, i) => {
      board.appendChild(el('div', 'rank-row' + (e.name.indexOf('你') >= 0 ? ' me' : ''), '<span>#' + (i + 1) + ' ' + e.name + '</span><b>' + e.integral + '</b>'));
    });
    box.appendChild(board);
    const p = openPanel('🏆 天梯赛', box);
  }

  function openRankShop() {
    const S = State.state();
    const box = el('div');
    box.appendChild(el('p', 'panel-desc', '金杯余额：<b>' + S.goldCup + '</b> 🏆'));
    const list = el('div', 'shop-list');
    rankgoodsMap.each((k, v) => {
      const row = el('div', 'shop-row');
      const price = parseInt(v.cup);
      row.innerHTML = '<div class="shop-info"><b>' + v.name + '</b><span>' + (v.remark || '') + '</span></div><div class="shop-price">' + price + '🏆</div>';
      const btn = el('button', 'btn btn-primary', '兑换');
      btn.onclick = () => {
        if (S.goldCup < price) { toast('金杯不足！'); return; }
        S.goldCup -= price;
        if (v.type === '1') S.props[v.goodsId] = (S.props[v.goodsId] || 0) + parseInt(v.count);
        else {
          const purpleSets = [];
          gearSetMap.each((k2, v2) => { if (parseInt(v2.quality) === 3) purpleSets.push(parseInt(v2.id)); });
          const setId = purpleSets[Math.floor(Math.random() * purpleSets.length)];
          const ids = [];
          gearMap.each((k2, v2) => { if (parseInt(v2.setId) === setId) ids.push(parseInt(v2.id)); });
          State.addGear(ids[Math.floor(Math.random() * ids.length)], State.randomExt(2));
        }
        State.save(); toast('兑换成功！');
        p.close(); openRankShop();
      };
      row.appendChild(btn);
      list.appendChild(row);
    });
    box.appendChild(list);
    const p = openPanel('🏆 金杯商店', box);
  }

  /* ============================================================
   * 【UI10】武器 / 技能
   * ============================================================ */
  // ---------- 武器 / 技能 ----------
  function openWeapons() { openWS('weapon'); }
  function openSkills() { openWS('skill'); }
  function openWS(kind) {
    const S = State.state();
    const box = el('div');
    const isW = kind === 'weapon';
    box.appendChild(el('p', 'panel-desc', isW
      ? '升级武器消耗金松果与武器卷轴（现有 🌰' + S.goldPoint + '，卷轴 ' + (S.props[22] || 0) + '）。武器+技能总数上限：' + State.wsLimit() + ' 个。'
      : '升级技能消耗金松果与技能卷轴（现有 🌰' + S.goldPoint + '，卷轴 ' + (S.props[21] || 0) + '）。'));
    const list = el('div', 'ws-list');
    const items = isW ? State.myWeapons() : State.mySkills();
    if (!items.length) list.appendChild(el('p', 'panel-desc', isW ? '还没有武器，去抽奖或升级获得吧！' : '还没有技能，去抽奖或升级获得吧！'));
    for (const it of items) {
      const info = State.upgradeInfo(kind, it.id);
      const row = el('div', 'ws-row');
      row.innerHTML =
        (isW ? weaponIcon(it.id) : skillIcon(it.id)) +
        '<div class="ws-info"><b>' + it.name + '</b> <span class="ws-lv">Lv.' + it.level + '</span> <span class="ws-type">' + it.type + '</span>' +
        '<div class="ws-remark">' + (isW ? ('伤害 ' + it.harmLo + '-' + it.harmHi + '　') : '') + it.remark + '</div></div>';
      const btn = el('button', 'btn btn-primary');
      if (info.max) { btn.textContent = 'MAX'; btn.disabled = true; }
      else {
        btn.innerHTML = '升级<br><small>' + info.rate + '% 🌰' + info.coin + ' 卷' + info.book + '</small>';
        btn.onclick = () => {
          const r = State.doUpgrade(kind, it.id);
          toast(r.msg + (r.nextRate == null && r.rate != null ? ('（成功率' + r.rate + '%）') : ''));
          p.close(); openWS(kind);
        };
      }
      row.appendChild(btn);
      list.appendChild(row);
    }
    box.appendChild(list);
    const p = openPanel(isW ? '🗡️ 武器' : '✨ 技能', box);
  }

  /* ============================================================
   * 【UI11】背包
   * ============================================================ */
  // ---------- 背包 ----------
  function openBag() {
    const S = State.state();
    const box = el('div');
    const list = el('div', 'ws-list');
    let has = false;
    for (const id of Object.keys(S.props)) {
      const num = S.props[id];
      if (!num) continue;
      if (State.blackGearEnabled && !State.blackGearEnabled() && State.BLACK_PROP_IDS.includes(Number(id))) continue;
      const p0 = propMap.getValue(id);
      if (!p0) continue;
      has = true;
      const row = el('div', 'ws-row');
      row.innerHTML = propIcon(id) + '<div class="ws-info"><b>' + p0.name + '</b> x' + num + '<div class="ws-remark">' + (p0.remark || '') + '</div></div>';
      if (p0.useType === '1') {
        const btn = el('button', 'btn btn-primary', '使用');
        btn.onclick = () => {
          let r = State.useProp(id);
          /* 现代界面没有经典版的黑卡/黑装选择弹窗：这里随机替玩家选一个，至少不会卡住。
           * 经典模式走 classic-ui 的 blackCardDialog / blackGearBoxDialog（可选凤凰/圣熊与部位）。 */
          if (!r.ok && r.needsBlackChoice) r = State.useProp(80, 'random');
          else if (!r.ok && r.needsBlackGearChoice && r.options && r.options.length) {
            const pick = r.options[Math.floor(Math.random() * r.options.length)];
            r = State.useProp(89, String(pick.id));
          }
          toast(r.msg);
          if (r.ok) { p.close(); openBag(); }
        };
        row.appendChild(btn);
      } else if (['24', '25', '26', '77', '78'].indexOf(String(id)) >= 0) {
        const btn = el('button', 'btn btn-primary', '合成装备');
        btn.onclick = () => {
          const r = State.composeGear(parseInt(id));
          if (r.ok) { toast('合成成功：' + r.gear.name + '！'); p.close(); openBag(); }
          else toast(r.msg);
        };
        row.appendChild(btn);
      } else if (['45', '46'].indexOf(String(id)) >= 0) {
        const btn = el('button', 'btn btn-primary', '合成果实');
        btn.onclick = () => {
          if (num < 10) { toast('种子不足10个！'); return; }
          if (S.goldPoint < 50) { toast('金松果不足50！'); return; }
          S.props[id] -= 10; S.goldPoint -= 50;
          const fruit = id === '45' ? 47 : 48;
          S.props[fruit] = (S.props[fruit] || 0) + 1;
          State.save(); toast('合成成功：' + propMap.getValue(fruit).name);
          p.close(); openBag();
        };
        row.appendChild(btn);
      }
      /* 现代模式保留背包售卖；经典背包改由 4886 f1 弹窗接管，不经过这里。
       * 一次卖 1 个，避免手滑清仓；卖完重绘列表。 */
      const modernMode = !(window.UI && UI.currentUiMode && UI.currentUiMode() === 'classic');
      const sellPrice = modernMode && State.propSellPrice ? State.propSellPrice(id) : 0;
      if (sellPrice > 0) {
        const sellBtn = el('button', 'btn', '卖出');
        sellBtn.onclick = () => {
          const r = State.sellProp(Number(id), 1);
          toast(r.msg);
          if (r.ok) { p.close(); openBag(); }
        };
        row.appendChild(sellBtn);
      }
      list.appendChild(row);
    }
    if (!has) list.appendChild(el('p', 'panel-desc', '背包空空如也……'));
    box.appendChild(list);
    const p = openPanel('🎒 背包', box);
  }

  /* ============================================================
   * 【UI12】装备
   * ============================================================ */
  // ---------- 装备 ----------
  function openGears() {
    const S = State.state();
    if (Number(S.level) < 5) { toast('5级后才能使用装备。多多挑战，升级后再来吧！'); return; }
    const box = el('div');
    const gears = State.myGears();
    const worn = gears.filter((g) => g.used);
    const bag = gears.filter((g) => !g.used);
    box.appendChild(el('div', 'gear-sec-title', '已穿戴'));
    const wornDiv = el('div', 'ws-list');
    const slots = ['头巾', '手套', '衣服', '鞋'];
    for (let t = 0; t < 4; t++) {
      const g = worn.find((x) => x.type === t);
      const row = el('div', 'ws-row');
      if (g) {
        row.innerHTML = gearIcon(g) + '<div class="ws-info"><b class="' + QUALITY_CLS[Math.min(3, g.quality)] + '">' + g.name + '</b> <span class="ws-type">' + slots[t] + '</span><div class="ws-remark">' + g.attrName + '+' + g.abilityVal + ' ' + State.extText(g.ext).join('，') + '</div></div>';
        const btn = el('button', 'btn', '卸下');
        btn.onclick = () => { State.unwear(g.key); p.close(); openGears(); };
        row.appendChild(btn);
      } else {
        row.innerHTML = '<div class="ws-info"><b>' + slots[t] + '</b><div class="ws-remark">（空）</div></div>';
      }
      wornDiv.appendChild(row);
    }
    box.appendChild(wornDiv);
    box.appendChild(el('div', 'gear-sec-title', '装备背包（' + bag.length + '）— 选中3件同品质装备可融合升品质（部位/名字可不同；3件同套且有下一品质档时必得该套）'));
    const bagDiv = el('div', 'ws-list');
    const selected = new Set();
    /** 词条行：和装备名/主属性分开，融合选材料时一眼能看到每件装备带什么。 */
    const extTags = (g) => {
      const list = State.extText(g.ext);
      return '<div class="gear-ext-line"><span class="gear-ext-label">词条</span>' +
        (list.length ? list.map((x) => '<span class="gear-ext-tag">' + escHtml(x) + '</span>').join('')
          : '<span class="gear-ext-none">无附加词条</span>') + '</div>';
    };
    for (const g of bag) {
      const row = el('div', 'ws-row');
      row.innerHTML = gearIcon(g) + '<div class="ws-info"><b class="' + QUALITY_CLS[Math.min(3, g.quality)] + '">' + g.name + '</b><div class="ws-remark">' + g.attrName + '+' + g.abilityVal + '　需' + g.useLevel + '级</div>' + extTags(g) + '</div>';
      const wearBtn = el('button', 'btn btn-primary', '穿戴');
      wearBtn.disabled = S.level < g.useLevel;
      wearBtn.onclick = () => {
        if (!State.wear(g.key)) { toast('等级不足，无法穿戴'); return; }
        p.close(); openGears();
      };
      const sellRange = State.gearSellRange(State.gearQuality(g));
      const sellBtn = el('button', 'btn', '卖出');
      sellBtn.onclick = () => { State.sellGear(g.key); toast('已卖出'); p.close(); openGears(); };
      const selBtn = el('button', 'btn btn-sel', '选择');
      selBtn.onclick = () => {
        if (selected.has(g.key)) { selected.delete(g.key); selBtn.classList.remove('on'); }
        else { selected.add(g.key); selBtn.classList.add('on'); }
        refreshSummary();
      };
      row.appendChild(wearBtn); row.appendChild(sellBtn); row.appendChild(selBtn);
      bagDiv.appendChild(row);
    }
    if (!bag.length) bagDiv.appendChild(el('p', 'panel-desc', '没有备用装备。打关卡得碎片，10个碎片可合成装备！'));
    box.appendChild(bagDiv);
    /* 融合材料词条预览：现代版装备面板本身就是融合入口，选 3 件后在这里
     * 汇总它们能提供的全部词条，并说明产物每个槽 50% 继承。 */
    const summary = el('div', 'fusion-ext-summary');
    function refreshSummary() {
      const picked = [...selected].map((key) => bag.find((x) => x.key === key)).filter(Boolean);
      if (!picked.length) {
        summary.innerHTML = '<div class="fusion-ext-hint">选中装备后，这里会列出它们的全部附加词条；两件以上材料都带的词条必继承，其余每个词条槽 50% 概率继承。</div>';
        return;
      }
      const tags = new Set();
      picked.forEach((g) => State.extText(g.ext).forEach((x) => tags.add(x)));
      const sameSet = picked.length === 3 && State.fusionFamilyInfo ? State.fusionFamilyInfo(picked) : null;
      summary.innerHTML = '<div class="fusion-ext-head">已选 ' + picked.length + '/3：' +
        picked.map((g) => '<b class="q' + Math.min(3, g.quality) + '">' + escHtml(g.name) + '</b>').join('、') + '</div>' +
        (sameSet ? '<div class="fusion-ext-hint">三件同套（' + escHtml(sameSet.family) + '）：必得下一品质同套装的同部位装备。</div>' : '') +
        '<div class="fusion-ext-tags">' + (tags.size
          ? [...tags].map((x) => '<span class="gear-ext-tag">' + escHtml(x) + '</span>').join('')
          : '<span class="gear-ext-none">这些装备没有附加词条</span>') + '</div>' +
        '<div class="fusion-ext-hint">两件以上材料都带的词条必继承；其余词条每个槽 50% 概率继承。</div>';
    }
    box.appendChild(summary);
    refreshSummary();
    const mergeBtn = el('button', 'btn btn-primary btn-wide', '融合装备');
    mergeBtn.onclick = () => {
      const r = State.mergeGears([...selected], { allowMixedParts: true });
      if (r.ok) { toast('融合成功：' + r.gear.name + '！'); p.close(); openGears(); }
      else toast(r.msg);
    };
    mergeBtn.title = '融合消耗金松果（按材料品质）';
    box.appendChild(mergeBtn);
    box.appendChild(el('p', 'panel-desc', '融合消耗金松果（按材料品质）。'));
    const p = openPanel('🛡️ 装备', box);
  }

  /* ============================================================
   * 【UI13】商店
   * ============================================================ */
  // ---------- 商店 ----------
  function openShop() {
    const S = State.state();
    const box = el('div');
    box.appendChild(el('p', 'panel-desc', '金松果余额：🌰 <b>' + S.goldPoint + '</b>'));
    const list = el('div', 'shop-list');
    propMap.each((k, v) => {
      if (v.buy !== 'true') return;
      const row = el('div', 'shop-row');
      row.innerHTML = propIcon(v.id) + '<div class="shop-info"><b>' + v.name + '</b><span>' + (v.remark || '') + '</span></div><div class="shop-price">🌰' + v.price + '</div>';
      const btn = el('button', 'btn btn-primary', '购买');
      btn.onclick = () => {
        const r = State.buyProp(parseInt(v.id), 1);
        toast(r.msg);
        if (r.ok) { p.close(); openShop(); }
      };
      row.appendChild(btn);
      list.appendChild(row);
    });
    box.appendChild(list);
    const p = openPanel('🏪 商店', box);
  }

  /* ============================================================
   * 【UI14】抽奖
   * ============================================================ */
  // ---------- 抽奖 ----------
  function openLottery() {
    const S = State.state();
    const today = new Date(Date.now()).toDateString();
    if (S.lotteryDate !== today) { S.lotteryDate = today; S.lotteryFree = 1; State.save(); }
    const box = el('div', 'lottery-box');
    const prizes = [
      { name: '武器卷轴x10', run: () => { S.props[22] = (S.props[22] || 0) + 10; } },
      { name: '技能卷轴x10', run: () => { S.props[21] = (S.props[21] || 0) + 10; } },
      { name: '蓝色碎片x3', run: () => { S.props[26] = (S.props[26] || 0) + 3; } },
      { name: '经验+50', run: () => { State.gainExp(50); } },
      { name: '经验+100', run: () => { State.gainExp(100); } },
      { name: '金松果+30', run: () => { State.addGold(30); } },
      { name: '挑战书x2', run: () => { S.props[23] = (S.props[23] || 0) + 2; } },
      { name: '大体力药剂x4', run: () => { S.props[2] = (S.props[2] || 0) + 4; } },
      { name: '天使果实种子x2', run: () => { S.props[45] = (S.props[45] || 0) + 2; } },
      { name: '英雄帖x2', run: () => { S.props[36] = (S.props[36] || 0) + 2; } },
    ];
    box.appendChild(el('p', 'panel-desc', '每天免费抽奖 1 次，之后每次 20 金松果。今日免费次数：' + S.lotteryFree));
    const resultDiv = el('div', 'lottery-result', '🎁');
    box.appendChild(resultDiv);
    const btn = el('button', 'btn btn-primary btn-wide', '抽奖');
    let spinTimer = 0, closed = false;
    btn.onclick = () => {
      if (S.lotteryFree > 0) S.lotteryFree--;
      else {
        if (S.goldPoint < 20) { toast('金松果不足20！'); return; }
        S.goldPoint -= 20;
      }
      btn.disabled = true;
      let n = 0;
      spinTimer = setInterval(() => {
        if (closed) { clearInterval(spinTimer); spinTimer = 0; return; }
        resultDiv.textContent = prizes[Math.floor(Math.random() * prizes.length)].name;
        if (++n > 15) {
          clearInterval(spinTimer); spinTimer = 0;
          const prize = prizes[Math.floor(Math.random() * prizes.length)];
          prize.run();
          State.save();
          resultDiv.textContent = '🎉 ' + prize.name;
          btn.disabled = false;
          btn.textContent = '再抽一次';
          const d = box.querySelector('.panel-desc');
          if (d) d.innerHTML = '今日免费次数：' + S.lotteryFree + '（之后每次20🌰）';
        }
      }, 90);
    };
    box.appendChild(btn);
    openPanel('🎰 每日抽奖', box, { onClose: () => { closed = true; if (spinTimer) { clearInterval(spinTimer); spinTimer = 0; } } });
  }

  /* ============================================================
   * 【UI15】师徒
   * ============================================================ */
  // ---------- 师徒 ----------
  function openMaster() {
    const S = State.state();
    const box = el('div');
    if (S.master) {
      box.appendChild(el('p', 'panel-desc', '你的师傅：<b>' + S.master.name + '</b> Lv.' + S.master.level + '（战斗中有概率触发"师父驾到"加血）'));
      const b = el('button', 'btn', '出师');
      b.onclick = () => { S.master = null; State.save(); p.close(); openMaster(); };
      box.appendChild(b);
    } else {
      box.appendChild(el('p', 'panel-desc', '拜一位高手为师，战斗中学到"师父驾到"技能时师傅会来加血！'));
      const list = el('div', 'foe-list');
      for (let i = 0; i < 3; i++) {
        const m = State.genAI(S.level + 5 + i * 2);
        const row = el('div', 'foe-row');
        row.innerHTML = '<div class="foe-avatar sq-avatar"></div><div class="foe-info"><b>' + m.name + '</b> Lv.' + m.level + '<span class="foe-stats">生命' + m.hp + '</span></div>';
        const btn = el('button', 'btn btn-primary', '拜师');
        btn.onclick = () => { S.master = { name: m.name, level: m.level }; State.save(); toast('拜【' + m.name + '】为师！'); p.close(); };
        row.appendChild(btn);
        list.appendChild(row);
      }
      box.appendChild(list);
    }
    box.appendChild(el('div', 'gear-sec-title', '我的徒弟（' + S.prentices.length + '/3）'));
    const pl = el('div', 'foe-list');
    S.prentices.forEach((t) => {
      pl.appendChild(el('div', 'foe-row', '<div class="foe-info"><b>' + t.name + '</b> Lv.' + t.level + '</div>'));
    });
    if (S.prentices.length < 3) {
      const btn = el('button', 'btn btn-primary', '收徒');
      btn.onclick = () => {
        const foe = State.genAI(Math.max(1, S.level - 2));
        p.close();
        Main.startBattle(foe, {
          cost: 10, kind: 'master', useProps: true, region: 0,
          onEnd: (winner) => {
            if (winner === 0) {
              S.prentices.push({ name: foe.name, level: foe.level });
              const ups = State.gainExp(20);
              State.save();
              showResult(true, foe, { exp: 20, gold: 0, ups: ups }, '<div>收【' + foe.name + '】为徒！</div>');
            } else {
              showResult(false, foe, { exp: 0, gold: 0, ups: [] }, '<div>收徒失败……</div>');
            }
          },
        });
      };
      pl.appendChild(btn);
    }
    box.appendChild(pl);
    const p = openPanel('👥 师徒', box);
  }

  /* ============================================================
   * 【UI16】帮助
   * ============================================================ */
  // ---------- 帮助 ----------
  function openHelp() {
    const box = el('div', 'help-box');
    box.innerHTML =
      '<p><b>UC松鼠大战 · 怀旧单机复刻版</b></p>' +
      '<p>本作基于 2012 年 UC 乐园 H5 游戏《松鼠大战》的原始素材与数值表复刻，仅供怀旧学习交流。</p>' +
      '<p><b>体力</b>：每5分钟恢复1点，上限120。挑战对手消耗10点，竞技场30点。</p>' +
      '<p><b>属性</b>：力量决定伤害，敏捷决定闪避，速度决定出手频率，生命即血量。</p>' +
      '<p><b>武器/技能</b>：战斗中随机使用。升级需要金松果+卷轴，成功率随等级降低；普通1~10级失败后每次提高2%成功率，真化线不保底。</p>' +
      '<p><b>关卡</b>：10级起挑战螳螂→仙鹤→熊猫，需要挑战书，通关可得装备碎片。带徒弟时徒弟先上阵，徒弟战败后师父免费接手同一名对手（不耗挑战书/复活次数）。</p>' +
      '<p><b>装备</b>：10个碎片+金松果合成（白30/绿40/蓝50）；3件同品质装备+金松果融合升品质（部位/名字可不同；白30/绿40/蓝50/紫60）。3件同套且有下一品质档时必得该套；两件以上材料都带的词条必继承。</p>' +
      '<p><b>转生</b>：使用转生果回到1级，属性成长更高（保留装备）。</p>' +
      '<p><b>存档</b>：自动保存在浏览器本地。</p>';
    const row = el('div', 'btn-row');
    const reset = el('button', 'btn btn-danger', '删档重开');
    reset.onclick = () => {
      confirmBox('确定要删除存档重新开始吗？此操作不可恢复！', () => {
        localStorage.removeItem('ssdz_save_v1');
        location.reload();
      });
    };
    row.appendChild(reset);
    box.appendChild(row);
    openPanel('❓ 帮助', box);
  }

  /** 把 standby 的第一帧画成 favicon，省得浏览器一直请求 404 的 favicon.ico */
  function installFavicon() {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const cx = c.getContext('2d');
      const f = Engine.anim('standby');
      if (!f) return;
      const box = [64, 360, 400, 640];
      const bw = box[2] - box[0], bh = box[3] - box[1];
      const k = Math.min(56 / bw, 56 / bh);
      Engine.drawFrame(cx, f[3], {
        x: 32 - (bw * k) / 2 - box[0] * k, y: 32 - (bh * k) / 2 - box[1] * k,
        scale: k, sheets: ['SQ_01', 'SQ_02'],
      });
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      link.href = c.toDataURL('image/png');
      document.head.appendChild(link);
    } catch (e) {}
  }

  /* ============================================================
   * 【UI17】导出 window.UI
   * ============================================================ */
  window.UI = {
    renderHome: renderHome, hitRegion: hitRegion, runAction: runAction,
    openPanel: openPanel, toast: toast, confirmBox: confirmBox,
    weaponIcon: weaponIcon, skillIcon: skillIcon, propIcon: propIcon, gearIcon: gearIcon,
    frameDataUrl: frameDataUrl, gridDataUrl: gridDataUrl, installFavicon: installFavicon,
  };
})();
