/* ============================================================
 * ui.js — 界面层
 *   · 主界面 HUD：用原版素材（shouyebiao / resource_1 / resource_13 /
 *     resource_16）画在 canvas 上，力求还原原版首页
 *   · 菜单按钮与功能面板：DOM 覆盖层（便于滚动与交互），配色与
 *     质感沿用原版橙色系
 * ============================================================ */
(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

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
    return '<img class="' + (cls || 'icon') + '" src="' + url + '"' + (size ? ' style="width:' + size + 'px;height:' + size + 'px"' : '') + '>';
  }
  function weaponIcon(id, size) { return imgTag('images/classic/icons/weapon-' + id + '.png', 'icon', size || 56); }
  function skillIcon(id, size) { return imgTag('images/classic/icons/skill-' + id + '.png', 'icon', size || 56); }
  function propIcon(id, size) { return imgTag('images/classic/icons/prop-' + id + '.png', 'icon', size || 56); }
  function gearIcon(g, size) {
    return imgTag('images/classic/icons/gear-' + g.id + '.png', 'icon', size || 56);
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

  /** 在 stage 上绘制原版风格首页；返回可点击区域列表 */
  function drawHomeHud(ctx, W, H) {
    const S = State.state();
    if (!S) return [];
    State.tickEnergy();
    const stats = State.totalStats();
    const regions = [];
    const spr = (id, label, x, y, w, h) => Engine.drawSprite(ctx, id, label, x, y, w, h);

    // ================= 顶部状态栏 =================
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, 118);
    g.addColorStop(0, 'rgba(28,16,6,.96)');
    g.addColorStop(1, 'rgba(28,16,6,.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 118);
    ctx.fillStyle = 'rgba(255,179,46,.9)';
    ctx.fillRect(0, 116, W, 3);
    ctx.restore();

    // 头像（用原版 standby 第一帧离屏渲染）
    if (!homeAvatar) homeAvatar = makeHomeAvatar();
    if (homeAvatar) ctx.drawImage(homeAvatar, 14, 12, 84, 84);
    ctx.save();
    ctx.lineWidth = 3; ctx.strokeStyle = '#ffb32e';
    rr(ctx, 14, 12, 84, 84, 12); ctx.stroke();
    ctx.restore();

    // 等级徽章
    spr('shouyebiao', '3', 100, 12, 54, 48);
    Engine.drawNumber(ctx, 'num_36', String(S.level), 130, 20, { h: 28, align: 'center' });
    Engine.text(ctx, 'Lv', 104, 56, { size: 14, color: '#ffe9b8', lineWidth: 3 });

    // 名字
    Engine.text(ctx, S.name, 166, 42, { size: 26, color: '#fff6d8', lineWidth: 6 });

    // 三围
    const st = [['力量', stats.power], ['敏捷', stats.agility], ['速度', stats.speed]];
    for (let i = 0; i < 3; i++) {
      const sx = 166 + i * 104;
      Engine.text(ctx, st[i][0], sx, 74, { size: 15, color: '#ffd08a', lineWidth: 3 });
      Engine.drawNumber(ctx, 'num_36', String(st[i][1]), sx + 40, 52, { h: 22 });
    }

    // 生命 / 体力 / 经验
    const barX = 500, barW = 400;
    const maxHp = Math.max(1, stats.hp);
    bar(ctx, barX, 14, barW, 24, 1, '#ffd25e', '#e8930f');
    Engine.drawNumber(ctx, 'num_36', String(maxHp), barX + 10, 12, { h: 26 });
    Engine.text(ctx, '生命', barX + barW - 46, 34, { size: 15, color: '#5a3208', lineWidth: 0 });

    const enPct = S.energy / S.maxEnergy;
    bar(ctx, barX, 46, barW, 22, enPct, '#a8e05f', '#4f9c17');
    Engine.drawNumber(ctx, 'tilishuzi', S.energy + '/' + S.maxEnergy, barX + 10, 44, { h: 22 });
    const cd = State.energyCountdown();
    if (cd) Engine.text(ctx, cd, barX + barW - 54, 64, { size: 15, color: '#ffe9b8', lineWidth: 3 });

    const expNeed = GData.nextExp(S.level);
    bar(ctx, barX, 76, barW, 20, S.exp / expNeed, '#9fd8ff', '#2f7fd0');
    Engine.drawNumber(ctx, 'expNum', S.exp + '/' + expNeed, barX + 10, 74, { h: 20 });

    // 金松果 / 金杯
    spr('shouyebiao', '11', 918, 8, 60, 60);
    Engine.drawNumber(ctx, 'num_36', String(S.goldPoint), 984, 20, { h: 28 });
    spr('shouyebiao', '13', 918, 66, 60, 60);
    Engine.drawNumber(ctx, 'num_36', String(S.goldCup), 984, 78, { h: 28 });

    // 战绩
    Engine.text(ctx, '战绩 ' + S.allWins + '胜 ' + S.allFails + '负', 1088, 40, { size: 16, color: '#ffe9b8', align: 'right', lineWidth: 4 });
    Engine.text(ctx, '体力 ' + S.energy + '/' + S.maxEnergy, 1088, 66, { size: 15, color: '#ffd08a', align: 'right', lineWidth: 3 });
    Engine.text(ctx, cd || '体力已满', 1088, 90, { size: 14, color: '#ffd08a', align: 'right', lineWidth: 3 });

    // ================= 左下：属性卡 =================
    panelBg(ctx, 12, 132, 216, 128);
    Engine.text(ctx, '基础属性', 28, 162, { size: 17, color: '#ffb32e' });
    Engine.text(ctx, '力量 ' + stats.power, 28, 190, { size: 17, color: '#ffe9c4', lineWidth: 3 });
    Engine.text(ctx, '敏捷 ' + stats.agility, 28, 214, { size: 17, color: '#ffe9c4', lineWidth: 3 });
    Engine.text(ctx, '速度 ' + stats.speed, 28, 238, { size: 17, color: '#ffe9c4', lineWidth: 3 });

    // 加成说明
    const gs = State.myGears().filter((x) => x.used);
    Engine.text(ctx, gs.length ? ('装备 ' + gs.length + ' 件生效中') : '未穿戴装备', 120, 162, { size: 14, color: '#bfa87f', lineWidth: 3 });

    // ================= 右侧：战斗大按钮 =================
    regions.push({ id: 'battle', x: 996, y: 272, w: 122, h: 122 });
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 380);
    ctx.save();
    ctx.globalAlpha = 0.22 + pulse * 0.30;
    ctx.beginPath();
    ctx.arc(1057, 333, 68 + pulse * 6, 0, Math.PI * 2);
    const rg = ctx.createRadialGradient(1057, 333, 20, 1057, 333, 78);
    rg.addColorStop(0, 'rgba(255,220,120,.95)');
    rg.addColorStop(1, 'rgba(255,180,40,0)');
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.restore();
    spr('resource_16', '3', 996, 272, 122, 122);
    // ================= 右下：武器 / 技能快捷栏 =================
    const quick = State.myWeapons().slice(0, 3).map((w) => ({ kind: 'w', id: w.id, lv: w.level }))
      .concat(State.mySkills().slice(0, 2).map((s) => ({ kind: 's', id: s.id, lv: s.level })));
    if (quick.length) panelBg(ctx, 872, 450, 288, 178);
    for (let i = 0; i < quick.length; i++) {
      const q = quick[i];
      const qx = 890 + (i % 5) * 56, qy = 470;
      const cvIcon = gridIconUrl(q.kind === 'w' ? 'wuqi' : 'jineng', q.id - 1);
      ctx.save();
      rr(ctx, qx, qy, 52, 52, 10);
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,179,46,.8)'; ctx.stroke();
      if (cvIcon) ctx.drawImage(cvIcon, qx + 3, qy + 3, 46, 46);
      ctx.restore();
      Engine.text(ctx, 'Lv' + q.lv, qx + 26, qy + 68, { size: 13, color: '#ffe9b8', align: 'center', lineWidth: 3 });
    }

    // ================= 底部菜单按钮 =================
    const MENU = [
      { key: 'challenge', label: '挑战' },
      { key: 'stages', label: '关卡' },
      { key: 'arena', label: '竞技场' },
      { key: 'rank', label: '天梯赛' },
      { key: 'weapons', label: '武器' },
      { key: 'skills', label: '技能' },
      { key: 'bag', label: '背包' },
      { key: 'gears', label: '装备' },
      { key: 'shop', label: '商店' },
      { key: 'lottery', label: '抽奖' },
      { key: 'master', label: '师徒' },
      { key: 'help', label: '帮助' },
    ];
    const bw = 88, bh = 56, gap = 5;
    const totalW = MENU.length * bw + (MENU.length - 1) * gap;
    const startX = (W - totalW) / 2;
    const by = H - bh - 10;
    // 底栏
    ctx.save();
    const bg3 = ctx.createLinearGradient(0, by - 8, 0, H);
    bg3.addColorStop(0, 'rgba(28,16,6,.0)');
    bg3.addColorStop(.35, 'rgba(28,16,6,.86)');
    bg3.addColorStop(1, 'rgba(28,16,6,.97)');
    ctx.fillStyle = bg3;
    ctx.fillRect(0, by - 8, W, bh + 18);
    ctx.restore();
    for (let i = 0; i < MENU.length; i++) {
      const m = MENU[i];
      const bx = startX + i * (bw + gap);
      Engine.drawButton(ctx, bx, by, bw, bh, { sheet: 'shouyebiao', label: '15', text: m.label, size: 19 });
      regions.push({ id: m.key, x: bx, y: by, w: bw, h: bh });
    }
    return regions;
  }

  /** 主界面左上角头像（离屏渲染 standby 第 3 帧） */
  let homeAvatar = null;
  function makeHomeAvatar() {
    const S = 168, AV = 122;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const cx = c.getContext('2d');
    cx.fillStyle = '#f6e2b8'; cx.fillRect(0, 0, S, S);
    const f = Engine.anim('standby');
    if (f) {
      const frame = f[3];
      const sheets = ['SQ_01', 'SQ_02'];
      // 计算包围盒（与 battle.makeAvatar 同思路）
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, n = 0;
      for (const el of frame) {
        if (el.label === '75' || +el.label > 1000) continue;
        const sp = Engine.spriteIn(sheets, el.label);
        if (!sp) continue;
        const fr = sp.fr;
        const tx = el.tx - (fr.regX * el.a + fr.regY * el.c);
        const ty = el.ty - (fr.regX * el.b + fr.regY * el.d);
        minX = Math.min(minX, tx); minY = Math.min(minY, ty);
        maxX = Math.max(maxX, tx + Math.abs(el.a) * fr.sw + Math.abs(el.c) * fr.sh);
        maxY = Math.max(maxY, ty + Math.abs(el.b) * fr.sw + Math.abs(el.d) * fr.sh);
        n++;
      }
      if (n) {
        const bw = maxX - minX, bh = maxY - minY;
        const hw = Math.min(bw, bh) * 0.60;
        const hx = minX + bw * 0.28, hy = minY + bh * 0.34;
        const k = AV / hw;
        cx.save();
        cx.scale(S / AV, S / AV);
        Engine.drawFrame(cx, frame, {
          x: AV / 2 - (hw * k) / 2 - hx * k, y: AV / 2 - (hw * k) / 2 - hy * k,
          scale: k, sheets: sheets,
        });
        cx.restore();
      }
    }
    return c;
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
    const yes = el('button', 'btn btn-primary', '确 定');
    const no = el('button', 'btn', '取 消');
    yes.onclick = () => { p.close(); onYes && onYes(); };
    no.onclick = () => p.close();
    row.appendChild(yes); row.appendChild(no);
    box.appendChild(row);
    const p = openPanel('提示', box);
  }

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

  // ---------- 挑战（PVP vs AI） ----------
  function openChallenge() {
    const S = State.state();
    const box = el('div');
    let foes = [];
    function genFoes() {
      foes = [];
      for (let i = 0; i < 5; i++) {
        const lv = Math.max(1, S.level + Math.floor(Math.random() * 5) - 2);
        foes.push(State.genAI(lv));
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
        row.appendChild(btn);
        list.appendChild(row);
      });
      box.appendChild(list);
      const refresh = el('button', 'btn', '🔄 换一批');
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
    const ok = el('button', 'btn btn-primary', '确 定');
    ok.onclick = () => { p.close(); Main.showHome(); };
    row.appendChild(ok);
    box.appendChild(row);
    const p = openPanel('战斗结果', box);
  }

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
        '<span class="foe-stats">生命' + npc.hp + ' 力量' + npc.power + ' 敏捷' + npc.agility + ' 速度' + npc.speed + '</span></div>';
      const btn = el('button', 'btn btn-primary', prog.passed ? '重打' : (idx < prog.npcIndex ? '重打' : '挑战'));
      btn.disabled = locked;
      btn.onclick = () => {
        if ((S.props[23] || 0) < 1) { toast('需要挑战书！可在商店购买'); return; }
        S.props[23]--; State.save();
        p.close();
        const foe = {
          name: npc.name, level: 10 + stageId * 2, power: +npc.power, agility: +npc.agility, speed: +npc.speed, hp: +npc.hp,
          weapons: [], skills: (npc.skills || '').split('|').filter(Boolean).map((s) => { const q = s.split(':'); return { id: +q[0], level: +q[1] }; }),
          npcType: type.anim,
        };
        Main.startBattle(foe, {
          cost: 0, useProps: false, region: type.anim === 'tl' ? 3 : type.anim === 'xh' ? 4 : 1,
          onEnd: (winner) => {
            const win = winner === 0;
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
              S.goldPoint += gold;
              let fragTxt = '';
              if (Math.random() < 0.25 + star * 0.05) {
                const fragId = star <= 2 ? 24 : star <= 4 ? 25 : 26;
                const n = 1 + Math.floor(Math.random() * 2);
                S.props[fragId] = (S.props[fragId] || 0) + n;
                fragTxt = '<div>获得 ' + propMap.getValue(fragId).name + ' x' + n + '</div>';
              }
              const ups = State.gainExp(exp);
              State.save();
              showResult(true, foe, { exp: exp, gold: gold, ups: ups }, extra + fragTxt);
            } else {
              showResult(false, foe, { exp: 0, gold: 0, ups: [] }, '<div>提升等级、强化武器技能或穿戴装备后再来。</div>');
            }
          },
        });
      };
      row.appendChild(btn);
      box.appendChild(row);
    }
    const p = openPanel(type.name + ' ' + '★'.repeat(star), box);
  }

  // ---------- 竞技场 ----------
  function openArena() {
    const S = State.state();
    const box = el('div');
    box.appendChild(el('p', 'panel-desc', '4 只松鼠淘汰赛！经验场每局消耗 30 体力（可用英雄帖），冠军 150 经验；碎片场冠军得蓝色碎片。'));
    const row = el('div', 'btn-row');
    const b1 = el('button', 'btn btn-primary', '经验竞技场 (30⚡)');
    const b2 = el('button', 'btn btn-primary', '碎片场 (30⚡)');
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
      const ais = [State.genAI(S.level), State.genAI(S.level), State.genAI(S.level)];
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
                      S.goldPoint += 10;
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
      const foe = State.genAI(S.level + Math.floor(Math.random() * 6) - 3);
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
          toast(r.msg + (r.rate != null ? ('（成功率' + r.rate + '%）') : ''));
          p.close(); openWS(kind);
        };
      }
      row.appendChild(btn);
      list.appendChild(row);
    }
    box.appendChild(list);
    const p = openPanel(isW ? '🗡️ 武器' : '✨ 技能', box);
  }

  // ---------- 背包 ----------
  function openBag() {
    const S = State.state();
    const box = el('div');
    const list = el('div', 'ws-list');
    let has = false;
    for (const id of Object.keys(S.props)) {
      const num = S.props[id];
      if (!num) continue;
      const p0 = propMap.getValue(id);
      if (!p0) continue;
      has = true;
      const row = el('div', 'ws-row');
      row.innerHTML = propIcon(id) + '<div class="ws-info"><b>' + p0.name + '</b> x' + num + '<div class="ws-remark">' + (p0.remark || '') + '</div></div>';
      if (p0.useType === '1') {
        const btn = el('button', 'btn btn-primary', '使用');
        btn.onclick = () => {
          const r = State.useProp(id);
          toast(r.msg);
          if (r.ok) { p.close(); openBag(); }
        };
        row.appendChild(btn);
      } else if (['24', '25', '26'].indexOf(String(id)) >= 0) {
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
      list.appendChild(row);
    }
    if (!has) list.appendChild(el('p', 'panel-desc', '背包空空如也……'));
    box.appendChild(list);
    const p = openPanel('🎒 背包', box);
  }

  // ---------- 装备 ----------
  function openGears() {
    const S = State.state();
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
    box.appendChild(el('div', 'gear-sec-title', '装备背包（' + bag.length + '）— 选中3件相同装备可融合升品质'));
    const bagDiv = el('div', 'ws-list');
    const selected = new Set();
    for (const g of bag) {
      const row = el('div', 'ws-row');
      row.innerHTML = gearIcon(g) + '<div class="ws-info"><b class="' + QUALITY_CLS[Math.min(3, g.quality)] + '">' + g.name + '</b><div class="ws-remark">' + g.attrName + '+' + g.abilityVal + '　需' + g.useLevel + '级　' + State.extText(g.ext).join('，') + '</div></div>';
      const wearBtn = el('button', 'btn btn-primary', '穿戴');
      wearBtn.disabled = S.level < g.useLevel;
      wearBtn.onclick = () => {
        if (!State.wear(g.key)) { toast('等级不足，无法穿戴'); return; }
        p.close(); openGears();
      };
      const sellBtn = el('button', 'btn', '卖' + g.price + '🌰');
      sellBtn.onclick = () => { State.sellGear(g.key); toast('已卖出'); p.close(); openGears(); };
      const selBtn = el('button', 'btn btn-sel', '选择');
      selBtn.onclick = () => {
        if (selected.has(g.key)) { selected.delete(g.key); selBtn.classList.remove('on'); }
        else { selected.add(g.key); selBtn.classList.add('on'); }
      };
      row.appendChild(wearBtn); row.appendChild(sellBtn); row.appendChild(selBtn);
      bagDiv.appendChild(row);
    }
    if (!bag.length) bagDiv.appendChild(el('p', 'panel-desc', '没有备用装备。打关卡得碎片，10个碎片可合成装备！'));
    box.appendChild(bagDiv);
    const mergeBtn = el('button', 'btn btn-primary btn-wide', '🔥 融合选中的3件装备（50🌰）');
    mergeBtn.onclick = () => {
      const r = State.mergeGears([...selected]);
      if (r.ok) { toast('融合成功：' + r.gear.name + '！'); p.close(); openGears(); }
      else toast(r.msg);
    };
    box.appendChild(mergeBtn);
    const p = openPanel('🛡️ 装备', box);
  }

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

  // ---------- 抽奖 ----------
  function openLottery() {
    const S = State.state();
    const today = new Date().toDateString();
    if (S.lotteryDate !== today) { S.lotteryDate = today; S.lotteryFree = 1; State.save(); }
    const box = el('div', 'lottery-box');
    const prizes = [
      { name: '武器卷轴x10', run: () => { S.props[22] = (S.props[22] || 0) + 10; } },
      { name: '技能卷轴x10', run: () => { S.props[21] = (S.props[21] || 0) + 10; } },
      { name: '蓝色碎片x3', run: () => { S.props[26] = (S.props[26] || 0) + 3; } },
      { name: '经验+50', run: () => { State.gainExp(50); } },
      { name: '经验+100', run: () => { State.gainExp(100); } },
      { name: '金松果+30', run: () => { S.goldPoint += 30; } },
      { name: '挑战书x2', run: () => { S.props[23] = (S.props[23] || 0) + 2; } },
      { name: '大体力药剂x2', run: () => { S.props[2] = (S.props[2] || 0) + 2; } },
      { name: '天使果实种子x2', run: () => { S.props[45] = (S.props[45] || 0) + 2; } },
      { name: '英雄帖x2', run: () => { S.props[36] = (S.props[36] || 0) + 2; } },
    ];
    box.appendChild(el('p', 'panel-desc', '每天免费抽奖 1 次，之后每次 20 金松果。今日免费次数：' + S.lotteryFree));
    const resultDiv = el('div', 'lottery-result', '🎁');
    box.appendChild(resultDiv);
    const btn = el('button', 'btn btn-primary btn-wide', '抽 奖');
    btn.onclick = () => {
      if (S.lotteryFree > 0) S.lotteryFree--;
      else {
        if (S.goldPoint < 20) { toast('金松果不足20！'); return; }
        S.goldPoint -= 20;
      }
      btn.disabled = true;
      let n = 0;
      const timer = setInterval(() => {
        resultDiv.textContent = prizes[Math.floor(Math.random() * prizes.length)].name;
        if (++n > 15) {
          clearInterval(timer);
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
    openPanel('🎰 每日抽奖', box);
  }

  // ---------- 师徒 ----------
  function openMaster() {
    const S = State.state();
    const box = el('div');
    if (S.master) {
      box.appendChild(el('p', 'panel-desc', '你的师傅：<b>' + S.master.name + '</b> Lv.' + S.master.level + '（战斗中有概率触发"师父驾到"加血）'));
      const b = el('button', 'btn', '出师（脱离师门）');
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
      const btn = el('button', 'btn btn-primary', '收徒（打败一个对手）');
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

  // ---------- 帮助 ----------
  function openHelp() {
    const box = el('div', 'help-box');
    box.innerHTML =
      '<p><b>UC松鼠大战 · 怀旧单机复刻版</b></p>' +
      '<p>本作基于 2012 年 UC 乐园 H5 游戏《松鼠大战》的原始素材与数值表复刻，仅供怀旧学习交流。</p>' +
      '<p><b>体力</b>：每5分钟恢复1点，上限120。挑战对手消耗10点，竞技场30点。</p>' +
      '<p><b>属性</b>：力量决定伤害，敏捷决定闪避，速度决定出手频率，生命即血量。</p>' +
      '<p><b>武器/技能</b>：战斗中随机使用。升级需要金松果+卷轴，成功率随等级降低。</p>' +
      '<p><b>关卡</b>：10级起挑战螳螂→仙鹤→熊猫，需要挑战书，通关可得装备碎片。</p>' +
      '<p><b>装备</b>：10个碎片+50金松果合成；3件相同装备+50金松果融合升品质。</p>' +
      '<p><b>转生</b>：使用转生果回到1级，属性成长更高（保留装备）。</p>' +
      '<p><b>存档</b>：自动保存在浏览器本地。</p>';
    const row = el('div', 'btn-row');
    const reset = el('button', 'btn btn-danger', '删除存档重开');
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

  window.UI = {
    renderHome: renderHome, drawHomeHud: drawHomeHud, hitRegion: hitRegion, runAction: runAction,
    openPanel: openPanel, toast: toast, confirmBox: confirmBox,
    weaponIcon: weaponIcon, skillIcon: skillIcon, propIcon: propIcon, gearIcon: gearIcon,
    frameDataUrl: frameDataUrl, gridDataUrl: gridDataUrl, installFavicon: installFavicon,
  };
})();
