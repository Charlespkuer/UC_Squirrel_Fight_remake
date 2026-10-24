/* Original Flash battle-dialog containers; callers retain all settlement rules. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SYMBOL = { arena: '3822', rank: '3776', stage: '4839', result: '4692' };
  let current = null, generation = 0;
  const node = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const key in attrs || {}) n.setAttribute(key, attrs[key]);
    return n;
  };
  function plain(value) {
    return String(value == null ? '' : value).replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(?:p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }[k]));
  }
  function lines(value, width) {
    const out = [];
    for (const paragraph of plain(value).split(/\r\n|\r|\n/)) {
      let row = '', used = 0;
      for (const ch of paragraph) {
        const size = ch.charCodeAt(0) < 128 ? .5 : 1;
        if (used + size > width && row) { out.push(row); row = ''; used = 0; }
        row += ch; used += size;
      }
      if (row) out.push(row);
    }
    return out;
  }
  /* ---------- 战果页（原版 `fight` 第 2/3 帧）----------
   * 原版普通战斗结束**没有**另一层"提示"弹窗：`fight.gotoAndStop(2|3)` 那一页
   * 就是结算（`showFightResult` :18703-18848，`getExp` + `c1/c2/c3` 三格）。
   * 复刻以前把经验与金松果拼成一段文字塞进 4692 对话框，所以版式与原版差得很远。
   * 这里只在**真的有奖励**时走原版 CG；切磋 / 木桩统计这类"没有奖励"的仍走 4692。 */
  function hasReward(options) {
    const exp = Math.round(Number(options.exp) || 0);
    const gold = Math.round(Number(options.gold) || 0);
    return exp > 0 || gold > 0 ||
      !!(options.items && options.items.length) || !!(options.ups && options.ups.length);
  }
  /** 升级奖励压成一行行文字（原版升级页另开；战果页只留一句提示）。 */
  function upsLines(ups) {
    return (ups || []).filter(Boolean).map((u) => {
      let text = '升到 ' + u.level + ' 级';
      if (u.reward) text += '，获得「' + u.reward + '」';
      if (u.wsChoice) text += '，武器/技能三选一';
      if (u.attributeBook) text += '，属性书 ×1';
      if (u.chest) text += '，金宝箱 ×' + u.chest;
      const gifts = (u.gifts || []).map((g) => g.name + '×' + g.count).join('、');
      if (gifts) text += '，' + gifts;
      if (u.autoPoint) text += '，系统代选了 1 点属性';
      return text;
    });
  }
  function rewardText(options) {
    const note = plain(options.note != null ? options.note : options.text);
    /* 升级奖励已经有 ssfight 原版升级页（7795）专门展示，战果页不再重复列一行行文字。 */
    const upgrade = hasLevelUp(options) ? [] : upsLines(options.ups);
    return [note].concat(upgrade).filter((s) => String(s || '').trim()).join('\n');
  }
  function hasLevelUp(options) {
    return !!(window.SfLevelUp && options && options.ups && options.ups.length);
  }
  function promptLevelUpChoices() {
    if (window.UI && UI.classic && UI.classic.promptLevelUpChoices) UI.classic.promptLevelUpChoices();
  }
  /** 有升级时先挂原版升级页（7795），关掉后再接现代的武技三选一 / 自由属性点；
   *  没有升级 / 素材没起来时保持原来的“立刻弹现代选择”。 */
  function showLevelUp(options) {
    /* 新手引导：等级事件（4/5/10/15/20/25/30/35 → nowPage 21/13/23/24/17/19/20/26，
     * 原版 showLevelUp/showLevelupTips :7160-7300）。第 5 级的 f13 要盖在升级页上，
     * 所以先通知再挂页（引导自己是异步挂的，加上重试能等到这个页）。 */
    if (window.SfGuide && SfGuide.onLevelup) { try { SfGuide.onLevelup(options && options.ups); } catch (e) {} }
    if (!hasLevelUp(options)) { promptLevelUpChoices(); return false; }
    try {
      SfLevelUp.open(options.ups, () => {
        promptLevelUpChoices();
        if (window.SfGuide && SfGuide.onLevelupDone) { try { SfGuide.onLevelupDone(options.ups); } catch (e) {} }
      });
      return true;
    } catch (e) {
      if (window.__errs) window.__errs.push('SfFightResult levelup: ' + (e && (e.stack || e.message) || e));
      promptLevelUpChoices();
      return false;
    }
  }
  let lootIcons = null;
  async function loadLootIcons() {
    if (lootIcons) return lootIcons;
    try {
      const r = await fetch(SfRender.BASE + 'loot-icons.json', { cache: 'force-cache' });
      lootIcons = (r && r.ok) ? ((await r.json()).byId || {}) : {};
    } catch (e) { lootIcons = {}; }
    return lootIcons;
  }
  /** 提交一次动作；旧层迟到的回调由 `current` + `host` 双重校验挡住。 */
  function commit(record, host, actions, index) {
    if (!record || record.settled || current !== record || !host.isConnected) return false;
    if (!Number.isInteger(index) || !actions[index] || actions[index].disabled === true) return false;
    record.settled = true;
    const action = actions[index]; destroy();
    if (action && typeof action.run === 'function') action.run();
    return true;
  }
  function actionRank(action) {
    const label = String(action.label || ''), cls = String(action.cls || '').toLowerCase();
    if (action.muted === true || cls.includes('muted') || /返回|取消|关闭|放弃/.test(label)) return -2;
    if (/稍后|暂不|待会|结束/.test(label)) return -1;
    if (/开始|继续|确定|确认|闯关|挑战|再战|知道了/.test(label) || action.primary === true) return 2;
    return 0;
  }
  /** 原版空按钮 3801：量一次自身画稿再摆，避免把不对称的画稿当成居中。 */
  function makeButton(view, offset, record, host, label, centerX, centerY, run, name, disabled, width) {
    const clip = view.attachChild('3801', 1, name);
    const measured = clip.g.getBBox();
    const box = measured.width > 30 && measured.height > 5 ? measured : { x: 0, y: -.02, width: 67.3, height: 19.9 };
    const midX = box.x + box.width / 2, midY = box.y + box.height / 2;
    const scale = Math.min(1, (width || 76) / box.width);
    clip.setExtraTransform('translate(' + (centerX + offset[0] - midX * scale) + ',' +
      (centerY + offset[1] - midY * scale) + ') scale(' + scale + ')');
    const text = node('text', { x: midX, y: midY + 3.5, 'text-anchor': 'middle', 'font-family': 'SimHei,Microsoft YaHei,sans-serif', 'font-size': 10, fill: '#53341e', 'pointer-events': 'none' });
    text.textContent = label; clip.g.appendChild(text);
    clip.g.setAttribute('role', 'button'); clip.g.setAttribute('tabindex', disabled ? '-1' : '0'); clip.g.setAttribute('aria-label', label);
    if (disabled) { clip.g.setAttribute('aria-disabled', 'true'); clip.g.style.opacity = '.45'; }
    const t = window.SfUiMain && SfUiMain.toolkit;
    if (t) t.popWrap(clip);
    if (window.SfUiFeedback && !disabled) SfUiFeedback.bind(clip.g, { shell: () => clip.getContentHost() });
    const fire = event => {
      if (event && event.stopPropagation) event.stopPropagation();
      if (record.settled || !host.isConnected || disabled) return;
      if (window.SfUiFeedback) SfUiFeedback.tap(clip.g, run, { delay: 0, press: false }); else run();
    };
    clip.g.addEventListener('click', fire);
    clip.g.addEventListener('keydown', e => { if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fire(e); } });
    return clip;
  }
  /** 原版 `fight` 第 2/3 帧：经验（`getExp.exp`）+ 三格奖励（金松果 / 战利品）。 */
  async function openReward(options, host, record, mine) {
    if (!window.SfRender || !SfRender.mountSymbol) return null;
    try {
      await SfRender.loadExtra('tags-fight.json');
      await SfRender.loadExtra('tags-fight-result.json');
    } catch (e) { return null; }
    if (mine !== generation || !host.isConnected) return null;
    let view;
    try {
      view = await SfRender.mountSymbol(host, '7772', {
        frame: options.win === false ? 3 : 2, label: options.title || '战斗结果', policy: {},
      });
    } catch (e) { return null; }
    if (mine !== generation || !host.isConnected) { view.destroy(); return null; }
    record.view = view;
    /* 原版这页是一张 308 宽的整屏 CG，左右各留一圈舞台边；舞台外沿用黑色，
     * 不让挑战页/首页从缝里透出来（旧版是半透明提示框，可以透）。 */
    if (host.style) host.style.background = '#000';
    const t = window.SfUiMain && SfUiMain.toolkit;
    if (t && t.freezeDescendants) t.freezeDescendants(view);
    const stop = (clip, n) => { if (clip && clip.gotoAndStop) { try { clip.gotoAndStop(n); } catch (e) {} } };
    const show = (clip, on) => { const g = clip && (clip.g || clip); if (g && g.style) g.style.display = on ? '' : 'none'; };
    stop(view.byName('backgd'), 1);
    stop(view.byName('maxlevel'), 4);       // 4 = 不带素材里烤死的"掉线前获得"等文案
    stop(view.byName('shoutu'), 3);         // 3 = 普通战果，不显示"收徒成功"收益栏
    const exp = Math.max(0, Math.round(Number(options.exp) || 0));
    let gold = Math.max(0, Math.round(Number(options.gold) || 0));
    const getExp = view.byName('getExp');
    if (getExp) {
      if (exp > 0) {
        stop(getExp, 1);
        const digits = getExp.byName && getExp.byName('exp');
        if (t && digits) t.showNumber(exp, digits, 0, 0, 0);
      } else stop(getExp, 3);
    }
    const icons = (await loadLootIcons()) || {};
    if (mine !== generation || !host.isConnected) { view.destroy(); return null; }
    const picks = [];
    for (const item of (options.items || [])) {
      if (!item || item.id == null) continue;
      const count = Math.max(1, Math.round(Number(item.count) || 1));
      /* 战斗中飘到的金松果和结算金松果是两笔（`BattleDrops` 当场 `addGold`），
       * 合在同一格里显示总数，不能因为已经有一格金松果就把飘到的这份吞掉。 */
      if (Number(item.id) === 8) { gold += count; continue; }
      const hit = icons[String(item.id)];
      if (!hit || !hit.id) continue;
      picks.push({ count, icon: hit.id });
    }
    const rewards = [];
    if (gold > 0) rewards.push({ count: gold, icon: (icons['8'] || {}).id || '3131' });
    rewards.push(...picks);
    const cells = [['c1', 'num'], ['c2', 'num1'], ['c3', 'num3']];
    /* 胜负两帧的格子数不一样：负场（frame 3）没有 `c2/num1`，只有 `c1` + `c3`。
     * 按**当前帧真的存在**的格子依次摆，不能因为缺一格就把后面的奖励丢掉。 */
    const slots = cells.map(([cellName, numName]) => ({ cell: view.byName(cellName), num: view.byName(numName) }))
      .filter((slot) => slot.cell);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i], reward = rewards[i];
      if (slot.cell) stop(slot.cell, reward ? 1 : 2);
      if (slot.num) show(slot.num, !!reward);
      if (!reward) continue;
      const digits = slot.num && slot.num.byName && slot.num.byName('num');
      const sign = slot.num && slot.num.byName && slot.num.byName('addOrReduce');
      if (sign) stop(sign, 2);                              // 2 = 绿色「+」
      if (t && digits) t.showNumber(reward.count, digits, 0, 0, 0);
      if (slot.cell && slot.cell.detachAll) slot.cell.detachAll();
      if (slot.cell && slot.cell.attachChild) slot.cell.attachChild(reward.icon, 1, 'prize');
    }
    const prize = view.byName('prizeBackg');
    if (prize) stop(prize, rewards.length ? 1 : 2);

    /* 原版战果页本身没有按钮；这里把复刻需要的续战动作放在底部，文字说明收在一条
     * 与素材同色的奶油色横条里（超过两行给「更多」，不丢信息）。 */
    const text = rewardText(options);
    const rows = text ? lines(text, 32) : [];
    const perPage = 2;
    let page = 0;
    if (rows.length) {
      const footer = node('g');
      footer.appendChild(node('rect', { x: 14, y: 152, width: 292, height: 22, rx: 6,
        fill: '#fcf4e0', stroke: '#8b5a2b', 'stroke-width': 1.2, opacity: '.96', 'pointer-events': 'none' }));
      const textLayer = node('g', { 'pointer-events': 'none' });
      footer.appendChild(textLayer);
      const paint = () => {
        while (textLayer.firstChild) textLayer.removeChild(textLayer.firstChild);
        const slice = rows.slice(page * perPage, (page + 1) * perPage);
        slice.forEach((line, i) => {
          const n = node('text', { x: 160, y: 160 + (2 - slice.length) * 4 + i * 8, 'text-anchor': 'middle',
            'font-family': 'SimHei,Microsoft YaHei,sans-serif', 'font-size': 7.5, fill: '#8b3a1a' });
          n.textContent = line; textLayer.appendChild(n);
        });
      };
      if (rows.length > perPage) {
        const more = node('text', { x: 302, y: 169, 'text-anchor': 'end', 'font-family': 'SimHei,Microsoft YaHei,sans-serif',
          'font-size': 7.5, fill: '#74552d', role: 'button', tabindex: '0', 'pointer-events': 'auto' });
        more.textContent = '更多 ›';
        const next = event => {
          if (event && event.stopPropagation) event.stopPropagation();
          page = (page + 1) % Math.ceil(rows.length / perPage); paint();
        };
        more.addEventListener('click', next);
        more.addEventListener('keydown', event => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); next(event); } });
        footer.appendChild(more);
      }
      paint();
      view.g.appendChild(footer);
    }

    const actions = options.actions && options.actions.length ? options.actions : [{ label: '确定', dismiss: true }];
    record.actions = actions;
    record.choose = index => commit(record, host, actions, index);
    const ordered = actions.map((action, index) => ({ action, index }))
      .sort((a, b) => actionRank(a.action) - actionRank(b.action) || a.index - b.index);
    const count = ordered.length;
    const step = count <= 1 ? 0 : count === 2 ? 160 : count === 3 ? 80 : 66.5;
    const width = count <= 2 ? 76 : 60;
    const actionY = rows.length ? 183 : 173;
    ordered.forEach(({ action, index }, position) => makeButton(view, [0, 0], record, host,
      action.label || '确定', 160 + (position - (count - 1) / 2) * step, actionY,
      () => record.choose(index), 'result-action-' + index, action.disabled === true, width));
    host.style.visibility = '';
    if (window.Main && Main.resizeLayout) Main.resizeLayout();
    showLevelUp(options);
    return { view, host, choose: record.choose, close: () => { if (current === record) destroy(); } };
  }
  function destroy() {
    generation++;
    const old = current; current = null;
    if (!old) return;
    if (old.view) old.view.destroy();
    if (old.host.parentNode) old.host.parentNode.removeChild(old.host);
  }
  function dismiss() {
    const record = current;
    if (!record || !record.choose) return false;
    const index = record.actions.findIndex(action => action && action.disabled !== true &&
      (action.dismiss === true || /返回|稍后|取消|关闭/.test(String(action.label || ''))));
    return index >= 0 ? record.choose(index) : false;
  }
  async function open(spec) {
    const options = spec || {};
    destroy();
    const mine = generation, ui = document.getElementById('ui');
    if (!ui) return null;
    const host = document.createElement('section');
    host.className = 'sf-fight-result ssfight-view';
    host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', options.title || '战斗结果');
    host.style.visibility = 'hidden'; ui.appendChild(host);
    const record = { host, view: null, settled: false, options }; current = record;
    try {
      const kind = SYMBOL[options.kind] ? options.kind : 'result';
      /* 有奖励的**普通战果** = 原版 `fight` 战果页（经验 + 金松果 / 战利品三格）；
       * 素材缺失时才退回 4692 提示框，保证战果不会因为一张 CG 打不开。
       * 关卡 / 竞技场 / 天梯有各自的续战容器（4839 / 3822 / 3776），不能抢走。 */
      if (kind === 'result' && hasReward(options)) {
        const reward = await openReward(options, host, record, mine);
        if (reward) return reward;
        if (mine !== generation || !host.isConnected) return null;
        while (host.firstChild) host.removeChild(host.firstChild);
        if (host.style) host.style.background = '';
      }
      await SfRender.loadExtra('tags-fight-result.json');
      if (mine !== generation || !host.isConnected) return null;
      const offset = kind === 'stage' ? [-157.4, 43.9] : [0, 0];
      const view = await SfRender.mountSymbol(host, SYMBOL[kind], {
        // The original stage dialog enters over frames 1–7; frame 8 closes it.
        frame: kind === 'stage' ? 7 : 1, label: options.title || '战斗结果', policy: {},
        viewBox: kind === 'stage' ? '-157.4 43.9 320 196' : '0 0 320 196',
      });
      if (mine !== generation || !host.isConnected) { view.destroy(); return null; }
      record.view = view;
      const set = (name, value) => { const c = view.byName(name); if (c) SfRender.setText(c, String(value == null ? '' : value)); };
      const hide = name => { const c = view.byName(name); if (c && (c.g || c).style) (c.g || c).style.display = 'none'; };
      if (kind === 'arena') {
        const title = view.byName('title');
        if (title) {
          if (options.neutral === true) title.g.style.display = 'none';
          else title.gotoAndStop(options.win ? 1 : 2);
        }
        const player = options.player || {}, foe = options.foe || {};
        set('name1', player.name || '我'); set('level1', player.level || '');
        set('name2', foe.name || ''); set('level2', foe.level || '');
        // The pill is depth 9. Its baked label is the first three paths of
        // shape 3784 at depth 13 (bounds x139.5–176.85, y140.55–158.7), while
        // that shape's remaining two paths draw the left avatar's card.
        // 3795 is the central VS artwork and must stay visible.
        for (const rec of view.nodes.values()) {
          if (String(rec.id) === '3152') rec.node.style.display = 'none';
          if (String(rec.id) === '3784') for (const path of [...rec.node.childNodes].slice(0, 3)) path.style.display = 'none';
        }
      } else {
        hide('info'); hide('button1'); hide('buttonsMc');
        const win = view.byName('winmc'); if (win) win.gotoAndStop(options.win ? 2 : 1);
      }
      const layer = node('g', { transform: 'translate(' + offset.join(',') + ')' }); view.g.appendChild(layer);
      if (kind === 'arena' && options.neutral === true) {
        const title = node('text', { x: 160, y: 50, 'text-anchor': 'middle', 'font-family': 'SimHei,Microsoft YaHei,sans-serif', 'font-size': 14, fill: '#683b1a' });
        title.textContent = '竞技场 · ' + (options.title || '赛事对阵'); layer.appendChild(title);
      }
      // Arena and rank have native outcome badges; the notice already says “提示”.
      // Only the empty stage panel needs a heading of its own.
      if (kind === 'stage') {
        const title = node('text', { x: 160, y: 34, 'text-anchor': 'middle', 'font-family': 'SimHei,Microsoft YaHei,sans-serif', 'font-size': 12, fill: '#683b1a' });
        title.textContent = options.title || (options.win ? '战斗胜利' : '再接再厉'); layer.appendChild(title);
      }
      if (kind === 'result') {
        const outcome = node('text', { x: 160, y: 61, 'text-anchor': 'middle',
          'font-family': 'SimHei,Microsoft YaHei,sans-serif', 'font-size': 12, 'font-weight': 'bold', fill: '#683b1a' });
        outcome.textContent = options.win === true ? '战斗胜利' : options.win === false ? '再接再厉' : options.title || '战斗结果';
        layer.appendChild(outcome);
      }
      const body = node('g'); layer.appendChild(body);
      const layout = {
        arena: { x: 48, y: 130, width: 21, size: 9, leading: 10, rows: 2, actionY: 154, pageY: 139 },
        rank: { x: 68, y: 69, width: 18, size: 10, leading: 12, rows: 5, actionY: 143, pageY: 128 },
        stage: { x: 68, y: 65, width: 18, size: 10, leading: 12, rows: 5, actionY: 137, pageY: 123 },
        result: { x: 66, y: 78, width: 19, size: 10, leading: 12, rows: 5, actionY: 158, pageY: 141 },
      }[kind];
      const rows = lines(options.text, layout.width), perPage = layout.rows;
      let page = 0;
      const paint = () => {
        while (body.firstChild) body.removeChild(body.firstChild);
        rows.slice(page * perPage, (page + 1) * perPage).forEach((text, i) => {
          const n = node('text', { x: layout.x, y: layout.y + i * layout.leading,
            'font-family': 'SimHei,Microsoft YaHei,sans-serif', 'font-size': layout.size, fill: '#683b1a' });
          n.textContent = text; body.appendChild(n);
        });
      };
      const actions = options.actions && options.actions.length ? options.actions : [{ label: '确定', dismiss: true }];
      const choose = index => {
        if (record.settled || current !== record || !host.isConnected) return false;
        if (!Number.isInteger(index) || !actions[index] || actions[index].disabled === true) return false;
        record.settled = true;
        const action = actions[index]; destroy();
        if (action && typeof action.run === 'function') action.run();
        return true;
      };
      record.actions = actions; record.choose = choose;
      function button(label, centerX, centerY, run, name, disabled, width) {
        const clip = view.attachChild('3801', 1, name);
        // 3801's artwork is not centred on its registration point: measure the
        // untouched pill, then position both it and its label in that space.
        const measured = clip.g.getBBox();
        const box = measured.width > 30 && measured.height > 5 ? measured : { x: 0, y: -.02, width: 67.3, height: 19.9 };
        const midX = box.x + box.width / 2, midY = box.y + box.height / 2;
        const scale = Math.min(1, (width || 76) / box.width);
        clip.setExtraTransform('translate(' + (centerX + offset[0] - midX * scale) + ',' +
          (centerY + offset[1] - midY * scale) + ') scale(' + scale + ')');
        const text = node('text', { x: midX, y: midY + 3.5, 'text-anchor': 'middle', 'font-family': 'SimHei,Microsoft YaHei,sans-serif', 'font-size': 10, fill: '#53341e', 'pointer-events': 'none' });
        text.textContent = label; clip.g.appendChild(text);
        clip.g.setAttribute('role', 'button'); clip.g.setAttribute('tabindex', disabled ? '-1' : '0'); clip.g.setAttribute('aria-label', label);
        if (disabled) { clip.g.setAttribute('aria-disabled', 'true'); clip.g.style.opacity = '.45'; }
        const t = window.SfUiMain && SfUiMain.toolkit;
        if (t) t.popWrap(clip);
        if (window.SfUiFeedback && !disabled) SfUiFeedback.bind(clip.g, { shell: () => clip.getContentHost() });
        const fire = event => {
          if (event && event.stopPropagation) event.stopPropagation();
          if (record.settled || !host.isConnected || disabled) return;
          if (window.SfUiFeedback) SfUiFeedback.tap(clip.g, run, { delay: 0, press: false }); else run();
        };
        clip.g.addEventListener('click', fire);
        clip.g.addEventListener('keydown', e => { if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fire(e); } });
      }
      const rankAction = action => {
        const label = String(action.label || ''), cls = String(action.cls || '').toLowerCase();
        if (action.muted === true || cls.includes('muted') || /返回|取消|关闭|放弃/.test(label)) return -2;
        if (/稍后|暂不|待会|结束/.test(label)) return -1;
        if (/开始|继续|确定|确认|闯关|挑战|再战|知道了/.test(label) || action.primary === true) return 2;
        return 0;
      };
      const ordered = actions.map((action, index) => ({ action, index }))
        .sort((a, b) => rankAction(a.action) - rankAction(b.action) || a.index - b.index);
      const step = ordered.length > 2 ? 66.5 : 90;
      ordered.forEach(({ action, index }, position) => button(action.label || '确定',
        160 + (position - (ordered.length - 1) / 2) * step, layout.actionY,
        () => choose(index), 'result-action-' + index, action.disabled === true, ordered.length > 2 ? 60 : 76));
      if (rows.length > perPage) {
        const more = node('text', { x: kind === 'arena' ? 270 : 251, y: layout.pageY, 'text-anchor': 'end',
          'font-family': 'SimHei,Microsoft YaHei,sans-serif', 'font-size': 8, fill: '#74552d', role: 'button', tabindex: '0' });
        more.textContent = '更多 ›';
        const next = event => {
          if (event && event.stopPropagation) event.stopPropagation();
          page = (page + 1) % Math.ceil(rows.length / perPage); paint();
        };
        more.addEventListener('click', next);
        more.addEventListener('keydown', event => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); next(event); } });
        layer.appendChild(more);
      }
      paint(); host.style.visibility = '';
      if (window.Main && Main.resizeLayout) Main.resizeLayout();
      showLevelUp(options);
      return { view, host, choose, close: () => { if (current === record) destroy(); } };
    } catch (error) {
      if (current === record) destroy();
      throw error;
    }
  }
  window.SfFightResult = Object.freeze({ open, destroy, dismiss, plain, isOpen: () => !!(current && current.host.isConnected) });
})();
