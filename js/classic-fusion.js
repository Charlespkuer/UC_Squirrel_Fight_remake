/* Three-material equipment fusion in the classic UC visual shell. */

/* ------------------------------------------------------------
 * 目录：装备融合界面（三合一）
 * Ctrl+F 搜节号（如「【FS1】」）直达对应代码块。
 *
 *  【FS1】打开融合页与材料校验  【FS2】渲染  【FS3】详细规则弹窗  【FS4】融合执行与成功弹窗
 * ------------------------------------------------------------ */
(function () {
  'use strict';
  const PAGE_SIZE = 6;
  const qualities = ['普通', '优秀', '杰出', '卓越', '传说', '黑色'];
  /* 经典界面：橙装 quality 4 可以继续融合成黑装（原版 composeType=3）；
   * 黑装 quality 5 可以继续洗练。现代界面已删除黑装内容，橙装仍是顶端，不能融合。 */
  const modernMode = () => !(UI.currentUiMode && UI.currentUiMode() === 'classic');
  const cannotMerge = (gear) => !!gear && (gear.quality > 5 || (modernMode() && gear.quality === 4));
  /* 融合费用按**材料品质**分档（State.gearCostOf）：白 30 / 绿 40 / 蓝 50 / 紫 60 / 橙 200。 */
  const costOf = (gear) => (gear ? State.gearCostOf(gear.quality) : 0);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const art = (gear) => '<img alt="" src="images/ui/icons/gear/gear-' + Number(gear.id) +
    '.png" onerror="this.style.visibility=\'hidden\'">';   // 缺图标时别摊破图（黑装部分 id 没有 PNG）

  /* ============================================================
   * 【FS1】打开融合页与材料校验
   * ============================================================ */
  function open() {
    const classic = UI.classic;
    if (!classic) return;
    let selected = [], pageIndex = 0, busy = false;
    const page = classic.page('status', 'status', '', {
      cls: 'fusion-board',
      left: '<span class="footer-left">' + classic.btn('我的装备', 'gears', 'small gold') + '</span>'
    });
    const board = page.querySelector('.fusion-board');
    page.setAttribute('aria-label', '装备融合');

    const PART_NAME = ['头巾', '手套', '衣服', '鞋子'];
    const partOf = (gear) => (gear ? State.gearPart(gear.id) : -1);
    const partLabel = (gear) => PART_NAME[partOf(gear)] || '装备';
    /** 词条标签：融合页的卡片/材料槽直接显示，不再只藏在 title/aria 里。 */
    const extTags = (gear, compact) => {
      const list = gear ? State.extText(gear.ext) : [];
      return '<div class="fusion-ext-line' + (compact ? ' compact' : '') + '">' +
        (list.length ? list.map((x) => '<span class="fusion-ext-tag">' + esc(x) + '</span>').join('')
          : '<span class="fusion-ext-none">无词条</span>') + '</div>';
    };
    function validation(gears) {
      if (selected.length !== 3) return '请选择 3 件同品质的未穿戴装备';
      if (new Set(selected).size !== 3) return '同一件装备只能放入一次';
      const materials = selected.map((key) => gears.find((gear) => gear.key === key));
      if (materials.some((gear) => !gear)) return '材料已发生变化，请重新选择';
      if (materials.some((gear) => gear.used)) return '已穿戴的装备不能作为融合材料';
      if (materials.some(cannotMerge)) return modernMode() ? '现代界面已删除黑装，橙装不能再融合' : '该装备不能作为融合材料';
      if (materials.some((gear) => gear.quality !== materials[0].quality)) return '需要 3 件同品质的装备';
      const cost = State.gearCostOf(materials[0].quality);
      if (State.state().goldPoint < cost) return '金松果不足，还需要 ' + (cost - State.state().goldPoint) + ' 个';
      return '';
    }

    /* ============================================================
     * 【FS2】渲染（工作台/材料卡/分页）
     * ============================================================ */
    function render(focus) {
      if (!page.isConnected) return;
      const gears = State.myGears();
      // Another game action may have removed or equipped a selected instance.
      selected = selected.filter((key) => gears.some((gear) => gear.key === key && !gear.used && !cannotMerge(gear)));
      const first = gears.find((gear) => gear.key === selected[0]);
      // The original dictionary installs its own window.Map implementation.
      const groups = Object.create(null);
      gears.forEach((gear) => {
        if (gear.used || cannotMerge(gear)) return;
        const key = String(gear.quality);
        groups[key] = (groups[key] || 0) + 1;
      });
      const groupKey = (gear) => String(gear.quality);
      const unusable = (gear) => gear.used || cannotMerge(gear);
      const inventory = gears.slice().sort((a, b) =>
        Number(unusable(a)) - Number(unusable(b)) ||
        (groups[groupKey(b)] || 0) - (groups[groupKey(a)] || 0) ||
        b.quality - a.quality ||
        State.gearPart(a.id) - State.gearPart(b.id) ||
        a.id - b.id || String(a.key).localeCompare(String(b.key)));
      const pages = Math.max(1, Math.ceil(inventory.length / PAGE_SIZE));
      pageIndex = Math.max(0, Math.min(pageIndex, pages - 1));
      const reason = validation(gears);
      const materials = [0, 1, 2].map((index) => {
        const gear = gears.find((item) => item.key === selected[index]);
        return (index ? '<span class="fusion-plus" aria-hidden="true">+</span>' : '') +
          '<button type="button" class="fusion-material ' + (gear ? 'filled q' + gear.quality : 'empty') +
          '" data-fusion-slot="' + index + '" aria-label="' + esc(gear ? '移除材料 ' + (index + 1) + '：' + gear.name : '材料 ' + (index + 1) + '，请在下方选择装备') + '"' + (gear ? '' : ' disabled') + '>' +
          '<span class="fusion-frame">' + (gear ? art(gear) + '<span class="fusion-remove" aria-hidden="true">×</span>' : '<span class="fusion-add" aria-hidden="true">+</span>') +
          '<span class="fusion-slot-number" aria-hidden="true">' + (index + 1) + '</span></span>' +
          '<span class="fusion-material-name">' + (gear ? esc(gear.name) : '放入装备') + '</span>' +
          (gear ? extTags(gear, true) : '') + '</button>';
      }).join('');
      const cards = inventory.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE).map((gear) => {
        const chosen = selected.includes(gear.key);
        const unavailable = gear.used ? '已穿戴' : cannotMerge(gear) ? '最高品质'
          : first && gear.quality !== first.quality ? '需同品质'
          : selected.length === 3 && !chosen ? '材料已放满' : '';
        const sameGroup = groups[groupKey(gear)] || 0;
        const caption = chosen ? '材料 ' + (selected.indexOf(gear.key) + 1)
          : unavailable || (sameGroup >= 3 ? '同品质 ' + sameGroup + ' 件' : '可放入');
        const effects = State.extText(gear.ext).join('，');
        const detail = gear.name + '，' + qualities[gear.quality] + '，' + gear.attrName + ' +' + gear.abilityVal + (effects ? '，' + effects : '');
        return '<button type="button" class="fusion-gear q' + gear.quality + (chosen ? ' selected' : '') +
          '" data-fusion-gear="' + esc(gear.key) + '" aria-pressed="' + chosen + '" aria-label="' + esc(detail + '，' + (chosen ? '已放入，点击移除' : unavailable || '点击放入')) + '" title="' + esc(detail) + '"' + (unavailable && !chosen ? ' disabled' : '') + '>' +
          '<span class="fusion-frame">' + art(gear) +
          '<span class="fusion-quality-tag q' + gear.quality + '">' + qualities[gear.quality] + '</span>' +
          '<span class="fusion-card-state">' + esc(caption) + '</span></span>' +
          '<span class="fusion-gear-name">' + esc(gear.name) + '</span>' + extTags(gear) + '</button>';
      }).join('');
      const pips = [0, 1, 2].map((i) => '<i class="' + (i < selected.length ? 'on' : '') + '"></i>').join('');
      const nextQuality = first ? (first.quality >= 5 ? 5 : first.quality + 1) : 0;
      const previewLabel = first ? (first.quality >= 5 ? '黑装洗练' : (qualities[nextQuality] || '') + partLabel(first)) : '更高品质';
      /* 三件同套（且该套有下一品质档）时，产物是确定的：提示里直接写出来。
       * `fusionFamilyInfo` 与实际 `mergeGears` 共用 State 的同一份判定。 */
      const pickedGears = selected.map((key) => gears.find((g) => g.key === key)).filter(Boolean);
      const sameSet = pickedGears.length === 3 && State.fusionFamilyInfo ? State.fusionFamilyInfo(pickedGears) : null;
      const previewHint = sameSet ? '同套必得：' + sameSet.family : (first ? '产物部位随首件材料' : '必得 1 件');
      const guaranteeText = sameSet ? '同套必得该套 · 品质提升一级'
        : first && first.quality >= 5 ? '同部位黑装洗练 · 材料会被消耗' : '品质提升一级 · 材料会被消耗';
      /* 已选材料能提供的词条并集：不重复列出同名效果，玩家融合前就能看到候选池。 */
      const pickedTags = new Set();
      pickedGears.forEach((g) => State.extText(g.ext).forEach((x) => pickedTags.add(x)));
      const pickedHtml = selected.length
        ? '<div class="fusion-picked-exts"><b>可继承词条</b><div class="fusion-ext-tags">' +
            ([...pickedTags].map((x) => '<span class="fusion-ext-tag">' + esc(x) + '</span>').join('') ||
              '<span class="fusion-ext-none">所选材料没有词条</span>') + '</div></div>'
        : '';
      board.innerHTML = '<header class="fusion-heading"><h2>装备融合</h2>' +
        '<ol class="fusion-steps"><li class="on"><b>1</b>选择材料</li><li' + (selected.length === 3 ? ' class="on"' : '') + '><b>2</b>融合</li><li><b>3</b>获得装备</li></ol>' +
        '<span class="fusion-wallet">' + classic.goldIcon() + '<span>金松果 <b>' + State.state().goldPoint + '</b></span></span></header>' +
        '<div class="fusion-workbench"><div class="fusion-materials" aria-label="融合材料">' + materials + '</div>' +
        '<span class="fusion-arrow" aria-hidden="true">➜</span><div class="fusion-preview ' + (first ? 'q' + nextQuality : 'missing') + '"><span class="fusion-frame"><span class="fusion-question">?</span></span><span class="fusion-preview-label">' + previewLabel + '</span><span class="fusion-preview-hint">' + previewHint + '</span></div>' +
        '<div class="fusion-operation"><span class="fusion-cost">' + (first ? '消耗 <b>' + costOf(first) + '</b> 金松果' : '按品质 30 / 40 / 50 / 60') + '</span><button type="button" class="uc-button gold" data-fusion-action="fuse"' + (reason || busy ? ' disabled' : '') + '>开始融合</button><span class="fusion-guarantee">' + guaranteeText + '</span>' + pickedHtml + '</div></div>' +
        /* 规则条只留一行（flex + nowrap + 省略号），细节全部收进「详细规则」弹窗 ——
         * 之前把整段说明塞在这里，<br> 会被 flex 拆成一堆竖条，还会把下面的装备列表挤没。 */
        '<p class="fusion-rules"><b>规则</b>' +
        '<span class="fusion-rules-text">3 件<em>同品质</em>装备（部位/名字可不同）→ 品质高一级；3 件同套且有下一品质档 → 必得该套；重合词条必继承。</span>' +
        '<button type="button" class="uc-button tiny muted" data-fusion-action="rules">详细规则</button></p>' +
        '<div class="fusion-inventory-panel"><div class="fusion-inventory-heading"><h3>选择装备<span class="fusion-pips" aria-label="已放入 ' + selected.length + ' / 3">' + pips + '</span><span class="fusion-count">已放入 ' + selected.length + '/3</span></h3><button type="button" class="uc-button tiny muted" data-fusion-action="clear"' + (selected.length ? '' : ' disabled') + '>清空材料</button><div class="fusion-pagination"><button type="button" class="uc-button tiny" data-fusion-action="previous" aria-label="上一页装备"' + (pageIndex === 0 ? ' disabled' : '') + '><i class="chev chev-l" aria-hidden="true"></i></button><span>' + (pageIndex + 1) + ' / ' + pages + '</span><button type="button" class="uc-button tiny" data-fusion-action="next" aria-label="下一页装备"' + (pageIndex + 1 >= pages ? ' disabled' : '') + '><i class="chev chev-r" aria-hidden="true"></i></button></div></div>' +
        '<div class="fusion-inventory">' + (cards || '<div class="fusion-empty">还没有可以选择的装备。<br><span>收集装备碎片，可在道具中合成装备。</span></div>') + '</div></div>' +
        '<p class="fusion-status' + (!reason ? ' ready' : '') + '" role="status" aria-live="polite"><i aria-hidden="true">' + (reason ? '!' : '✓') + '</i>' + esc(reason || '材料已齐全，可以融合！') + '</p>';

      board.querySelectorAll('[data-fusion-slot]').forEach((button) => {
        button.onclick = () => { selected.splice(Number(button.dataset.fusionSlot), 1); render({ action: 'clear' }); };
      });
      board.querySelectorAll('[data-fusion-gear]').forEach((button) => {
        button.onclick = () => {
          const key = button.dataset.fusionGear;
          const current = State.myGears(), gear = current.find((item) => item.key === key);
          if (!gear || gear.used || cannotMerge(gear)) return;
          if (selected.includes(key)) selected = selected.filter((item) => item !== key);
          else {
            const material = current.find((item) => item.key === selected[0]);
            /* 只要求**同品质**：经典融合页传 `allowMixedParts:true`，规则条与
             * `mergeGears` 都允许部位/名字不同；结果部位沿用第一件材料。
             * 旧版这里还拦了 `partOf(material) !== partOf(gear)`，于是三件橙装
             * 只要部位不同，第二/三件怎么点都进不去（用户 2026-10「橙装无法选中 /
             * 合不出黑装」）。 */
            if (selected.length >= 3 || material && material.quality !== gear.quality) return;
            selected.push(key);
          }
          render({ key });
        };
      });
      const action = (name) => board.querySelector('[data-fusion-action="' + name + '"]');
      action('clear').onclick = () => { selected = []; render({ action: 'clear' }); };
      action('previous').onclick = () => { pageIndex--; render({ action: 'previous' }); };
      action('next').onclick = () => { pageIndex++; render({ action: 'next' }); };
      action('fuse').onclick = fuse;
      action('rules').onclick = showRules;
      if (focus) {
        const target = focus.key ? [...board.querySelectorAll('[data-fusion-gear]')].find((button) => button.dataset.fusionGear === focus.key) : action(focus.action);
        if (target && !target.disabled) target.focus({ preventScroll: true });
        else board.querySelector('[data-fusion-gear]:not(:disabled)')?.focus({ preventScroll: true });
      }
    }

    /* ============================================================
     * 【FS3】详细规则弹窗（规则条只放一句话，细节都收在这里）
     * ============================================================ */
    function showRules() {
      const pct = (v) => Math.round(v * 100) + '%';
      const mut = (k) => pct(Math.max(0, Number(State.FUSION_MUTANT_RATE[k]) || 0));
      const same = (k) => pct(Math.max(0, Number(State.FUSION_SAME_NAME_RATE[k]) || 0));
      /* 「随机其它」= 100% − 变异 − 保名（两件同名是 47%，三件同名是 0）。 */
      const other = (k) => pct(Math.max(0, 1 - (Number(State.FUSION_MUTANT_RATE[k]) || 0) - (Number(State.FUSION_SAME_NAME_RATE[k]) || 0)));
      classic.modal('融合规则', '<div class="fusion-help">' +
        '<p><b>材料</b>3 件同品质、未穿戴的装备，会被消耗；部位和名字可以完全不同。</p>' +
        '<p><b>费用</b>白 ' + State.gearCostOf(0) + ' · 绿 ' + State.gearCostOf(1) +
        ' · 蓝 ' + State.gearCostOf(2) + ' · 紫 ' + State.gearCostOf(3) + ' · 橙 ' + State.gearCostOf(4) + ' 金松果（按材料品质）。</p>' +
        '<p><b>产物</b>部位随第一件材料、品质高一级的 1 件；3 紫 → 传说橙（可镶嵌宝石）；' +
        (modernMode() ? '现代界面已删除黑装，橙装不能再融合。' : '3 橙 → 黑色装备（原版 composeType=3，材料就是橙装）。') + '</p>' +
        '<p><b>同套保底</b>三件材料同属一套（如狂战头盔/拳甲/铠甲）且该套有下一品质档时，产物必定是同套装的下一品质、首件材料部位；同套黑装 46/67、47/68 取 id 最小件。该套没有下一品质档（早期白/绿套）或材料跨套时按下面这条随机规则；品质 5 的黑装已是最高档，三件黑装仍按同部位洗练（97% 同家族）。</p>' +
        '<p><b>名称</b>三件同名 ' + same(3) + ' 保名 / ' + mut(3) + ' <em>变异</em>；' +
        '两件同名 ' + same(2) + ' 保名 / ' + mut(2) + ' <em>变异</em> / ' + other(2) + ' 随机其它装备；' +
        '三件全不同名则完全随机。橙→黑时变异池是深海/机器猫/怒战/狂战；品质太低（没有对应变异件）时不掷变异，那部分并入随机。</p>' +
        '<p><b>词条</b>同一个词条只要在两件以上材料里出现，产物<b>必定继承</b>（不同部位、不同名字也算）；' +
        '其余每个词条槽有 ' + pct(State.FUSION_EXT_INHERIT_RATE || 0.5) +
        ' 概率从材料词条里继承，取最高星；继承后另有 ' +
        pct(State.FUSION_EXT_UPGRADE_RATE) + ' 升 1 星（上限 3），没掷中则随机。</p>' +
        '</div>', [{ label: '知道了', cls: 'gold' }]);
    }

    /* ============================================================
     * 【FS4】融合执行与成功弹窗（含卖出）
     * ============================================================ */
    function fuse() {
      if (busy || !page.isConnected) return;
      const gears = State.myGears(), reason = validation(gears);
      if (reason) { render(); classic.toast(reason); return; }
      const previousQuality = gears.find((gear) => gear.key === selected[0]).quality;
      const previousCost = State.gearCostOf(previousQuality);
      busy = true;
      let result;
      try { result = State.mergeGears(selected.slice(), { allowMixedParts: true }); }
      finally { busy = false; }
      if (!result.ok) { render(); classic.toast(result.msg); return; }
      selected = []; pageIndex = 0; render();
      const gear = result.gear;
      const effects = State.extText(gear.ext);
      /* 「卖出」：融合产物常是拿去变现的，介绍页直接给卖出入口（点不开确认就关弹窗，
       * close:false 让确认框叠在介绍页上，取消后介绍页还在）。 */
      const success = classic.modal('融合成功', '<div class="fusion-success"><div class="fusion-success-item q' + gear.quality + '"><span class="fusion-frame">' + art(gear) + '</span><strong>' + esc(gear.name) + '</strong></div><div class="fusion-success-details"><div class="fusion-quality-change"><span class="q' + previousQuality + '">' + qualities[previousQuality] + '</span><span aria-hidden="true"> → </span><strong class="q' + gear.quality + '">' + qualities[gear.quality] + '</strong></div><p>基本属性：' + esc(gear.attrName) + ' +' + gear.abilityVal + '<br>使用等级：' + gear.useLevel + ' 级</p>' + (gear.mutant ? '<p class="fusion-mutant">⚡ <b>' + (gear.quality === 5 ? '黑装变异' : '狂战变异') + '</b>：这次没保住原名，变成了该部位的' + (gear.quality === 5 ? '深海/机器猫/怒战/狂战' : '狂战') + '装备</p>' : '') + (effects.length ? '<p class="fusion-effects">' + effects.map(esc).join('<br>') + '</p>' : '') + '</div></div><p class="fusion-success-note">已消耗 3 件材料和 ' + previousCost + ' 金松果，新装备（' + (PART_NAME[State.gearPart(gear.id)] || '装备') + '）已放入装备背包。</p>', [
        { label: '卖出', cls: 'muted', close: false, run: () => {
            const range = State.gearSellRange(State.gearQuality(gear));
            classic.modal('卖出装备', '<p>确定以 <b>' + range[0] + '~' + range[1] + '</b> 金松果卖出【' + esc(gear.name) + '】吗？</p>', [
              { label: '卖出', cls: 'gold', run: () => {
                  const got = State.sellGear(gear.key);
                  success.close();
                  if (got > 0) { classic.toast('卖出【' + gear.name + '】，获得 ' + got + ' 金松果'); render(); }
                  else { classic.toast('这件装备已不在背包里'); render(); }
                } },
              { label: '返回', cls: 'muted' }
            ], { small: true });
          } },
        { label: '继续融合', run: () => render({ action: 'clear' }) },
        { label: '查看装备', cls: 'gold', run: () => UI.runAction('gears') }
      ]);
    }
    render();
    return page;
  }
  window.ClassicFusion = Object.freeze({ open });
})();
