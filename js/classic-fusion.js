/* Three-material equipment fusion in the classic UC visual shell. */

/* ------------------------------------------------------------
 * 目录：装备融合界面（三合一）
 * Ctrl+F 搜节号（如「【FS1】」）直达对应代码块。
 *
 *  【FS1】打开融合页与材料校验  【FS2】渲染  【FS3】融合执行与成功弹窗
 * ------------------------------------------------------------ */
(function () {
  'use strict';
  const COST = 50, PAGE_SIZE = 6;
  const qualities = ['普通', '优秀', '杰出', '卓越', '传说'];
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const art = (gear) => '<img alt="" src="images/classic/icons/gear-' + Number(gear.id) + '.png">';

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
    /* 星标 = 「别把我合掉/卖掉」的保护标记（State.toggleGearStar）。
     * mergeGears 本来就会拒绝星标装备，但那是点「开始融合」之后才报错；
     * 这里在**可选材料**这一层就先剔掉，免得白选一场。 */
    const isStarred = (gear) => State.isGearStarred(gear);
    function validation(gears) {
      if (selected.length !== 3) return '请选择 3 件同部位的未穿戴装备';
      if (new Set(selected).size !== 3) return '同一件装备只能放入一次';
      const materials = selected.map((key) => gears.find((gear) => gear.key === key));
      if (materials.some((gear) => !gear)) return '材料已发生变化，请重新选择';
      if (materials.some((gear) => gear.used)) return '已穿戴的装备不能作为融合材料';
      if (materials.some(isStarred)) return '有装备已加星标（防误合），先取消星标再融合';
      if (materials.some((gear) => gear.quality >= 4)) return '传说装备已是最高品质';
      if (materials.some((gear) => partOf(gear) !== partOf(materials[0]))) return '需要 3 件同部位的装备';
      if (materials.some((gear) => gear.quality !== materials[0].quality)) return '需要 3 件同品质的装备';
      if (State.state().goldPoint < COST) return '金松果不足，还需要 ' + (COST - State.state().goldPoint) + ' 个';
      return '';
    }

    /* ============================================================
     * 【FS2】渲染（工作台/材料卡/分页）
     * ============================================================ */
    function render(focus) {
      if (!page.isConnected) return;
      const gears = State.myGears();
      // Another game action may have removed or equipped a selected instance.
      selected = selected.filter((key) => gears.some((gear) => gear.key === key && !gear.used && gear.quality < 4 && !isStarred(gear)));
      const first = gears.find((gear) => gear.key === selected[0]);
      // The original dictionary installs its own window.Map implementation.
      const groups = Object.create(null);
      gears.forEach((gear) => {
        if (gear.used || gear.quality >= 4 || isStarred(gear)) return;
        const key = State.gearPart(gear.id) + ':' + gear.quality;
        groups[key] = (groups[key] || 0) + 1;
      });
      const groupKey = (gear) => State.gearPart(gear.id) + ':' + gear.quality;
      /* 包里有多少件「本来能当材料、但被星标保护起来」的装备 —— 用来在材料区给一句明示，
       * 否则用户只会看到几张灰掉的卡片，不知道是为什么。 */
      const starredInBag = gears.filter((gear) => !gear.used && gear.quality < 4 && isStarred(gear)).length;
      /* 星标装备也排到最后：它当不了材料，排前面等于在推荐用户去点它。
       * 「同组 N 件」的计数同样排除了星标件（见上面的 groups），否则会出现
       * 「同组 3 件」却有一件根本放不进去的误导。 */
      const unusable = (gear) => gear.used || gear.quality >= 4 || isStarred(gear);
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
          '<span class="fusion-material-name">' + (gear ? esc(gear.name) : '放入装备') + '</span></button>';
      }).join('');
      const cards = inventory.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE).map((gear) => {
        const chosen = selected.includes(gear.key);
        const starred = isStarred(gear);
        const unavailable = gear.used ? '已穿戴' : gear.quality >= 4 ? '最高品质'
          : starred ? '已加星标'
          : first && (partOf(gear) !== partOf(first) || gear.quality !== first.quality) ? '需同部位同品质'
          : selected.length === 3 && !chosen ? '材料已放满' : '';
        const sameGroup = groups[groupKey(gear)] || 0;
        const caption = chosen ? '材料 ' + (selected.indexOf(gear.key) + 1)
          : unavailable || (sameGroup >= 3 ? '同组 ' + sameGroup + ' 件' : '可放入');
        const effects = State.extText(gear.ext).join('，');
        const detail = gear.name + '，' + qualities[gear.quality] + '，' + gear.attrName + ' +' + gear.abilityVal + (effects ? '，' + effects : '') +
          (starred ? '（已加星标，不参与融合；想拿它当材料请先去装备详情取消星标）' : '');
        return '<button type="button" class="fusion-gear q' + gear.quality + (chosen ? ' selected' : '') + (starred ? ' starred' : '') +
          '" data-fusion-gear="' + esc(gear.key) + '" aria-pressed="' + chosen + '" aria-label="' + esc(detail + '，' + (chosen ? '已放入，点击移除' : unavailable || '点击放入')) + '" title="' + esc(detail) + '"' + (unavailable && !chosen ? ' disabled' : '') + '>' +
          '<span class="fusion-frame">' + art(gear) +
          '<span class="fusion-quality-tag q' + gear.quality + '">' + qualities[gear.quality] + '</span>' +
          '<span class="fusion-card-state">' + esc(caption) + '</span></span>' +
          /* ★ 放在 .fusion-frame 外面：frame 是 overflow:hidden，放里面会被裁掉。 */
          (starred ? '<span class="gear-star" title="已加星标：不会参与融合">★</span>' : '') +
          '<span class="fusion-gear-name">' + esc(gear.name) + '</span></button>';
      }).join('');
      const pips = [0, 1, 2].map((i) => '<i class="' + (i < selected.length ? 'on' : '') + '"></i>').join('');
      board.innerHTML = '<header class="fusion-heading"><h2>装备融合</h2>' +
        '<ol class="fusion-steps"><li class="on"><b>1</b>选择材料</li><li' + (selected.length === 3 ? ' class="on"' : '') + '><b>2</b>融合</li><li><b>3</b>获得装备</li></ol>' +
        '<span class="fusion-wallet">' + classic.spr('resource_1', 18) + '<span>金松果 <b>' + State.state().goldPoint + '</b></span></span></header>' +
        '<div class="fusion-workbench"><div class="fusion-materials" aria-label="融合材料">' + materials + '</div>' +
        '<span class="fusion-arrow" aria-hidden="true">➜</span><div class="fusion-preview ' + (first ? 'q' + (first.quality + 1) : 'missing') + '"><span class="fusion-frame"><span class="fusion-question">?</span></span><span class="fusion-preview-label">' + (first ? qualities[first.quality + 1] + partLabel(first) : '更高品质') + '</span><span class="fusion-preview-hint">必得 1 件</span></div>' +
        '<div class="fusion-operation"><span class="fusion-cost">消耗 <b>' + COST + '</b> 金松果</span><button type="button" class="uc-button gold" data-fusion-action="fuse"' + (reason || busy ? ' disabled' : '') + '>开始融合</button><span class="fusion-guarantee">品质提升一级 · 材料会被消耗</span></div></div>' +
        '<p class="fusion-rules"><b>规则</b>3 件<b>同部位、同品质</b>装备（不必同名）+ ' + COST + ' 金松果，随机获得 1 件该部位、品质高一级的装备；3 件卓越（紫）同部位装备融合为传说（橙）装备，可镶嵌宝石。已加星标（★）的装备受保护，不会参与融合。</p>' +
        '<div class="fusion-inventory-panel"><div class="fusion-inventory-heading"><h3>选择装备<span class="fusion-pips" aria-label="已放入 ' + selected.length + ' / 3">' + pips + '</span><span class="fusion-count">已放入 ' + selected.length + '/3</span></h3>' + (starredInBag ? '<span class="fusion-starred-note" title="已加星标的装备受保护，不会参与融合；要拿它当材料请先去装备详情取消星标">★ 已加星标 ' + starredInBag + ' 件 · 不参与融合</span>' : '') + '<button type="button" class="uc-button tiny muted" data-fusion-action="clear"' + (selected.length ? '' : ' disabled') + '>清空材料</button><div class="fusion-pagination"><button type="button" class="uc-button tiny" data-fusion-action="previous" aria-label="上一页装备"' + (pageIndex === 0 ? ' disabled' : '') + '><i class="chev chev-l" aria-hidden="true"></i></button><span>' + (pageIndex + 1) + ' / ' + pages + '</span><button type="button" class="uc-button tiny" data-fusion-action="next" aria-label="下一页装备"' + (pageIndex + 1 >= pages ? ' disabled' : '') + '><i class="chev chev-r" aria-hidden="true"></i></button></div></div>' +
        '<div class="fusion-inventory">' + (cards || '<div class="fusion-empty">还没有可以选择的装备。<br><span>收集装备碎片，可在道具中合成装备。</span></div>') + '</div></div>' +
        '<p class="fusion-status' + (!reason ? ' ready' : '') + '" role="status" aria-live="polite"><i aria-hidden="true">' + (reason ? '!' : '✓') + '</i>' + esc(reason || '材料已齐全，可以融合！') + '</p>';

      board.querySelectorAll('[data-fusion-slot]').forEach((button) => {
        button.onclick = () => { selected.splice(Number(button.dataset.fusionSlot), 1); render({ action: 'clear' }); };
      });
      board.querySelectorAll('[data-fusion-gear]').forEach((button) => {
        button.onclick = () => {
          const key = button.dataset.fusionGear;
          const current = State.myGears(), gear = current.find((item) => item.key === key);
          if (!gear || gear.used || gear.quality >= 4 || isStarred(gear)) return;
          if (selected.includes(key)) selected = selected.filter((item) => item !== key);
          else {
            const material = current.find((item) => item.key === selected[0]);
            if (selected.length >= 3 || material && (partOf(material) !== partOf(gear) || material.quality !== gear.quality)) return;
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
      if (focus) {
        const target = focus.key ? [...board.querySelectorAll('[data-fusion-gear]')].find((button) => button.dataset.fusionGear === focus.key) : action(focus.action);
        if (target && !target.disabled) target.focus({ preventScroll: true });
        else board.querySelector('[data-fusion-gear]:not(:disabled)')?.focus({ preventScroll: true });
      }
    }

    /* ============================================================
     * 【FS3】融合执行与成功弹窗（含卖出）
     * ============================================================ */
    function fuse() {
      if (busy || !page.isConnected) return;
      const gears = State.myGears(), reason = validation(gears);
      if (reason) { render(); classic.toast(reason); return; }
      const previousQuality = gears.find((gear) => gear.key === selected[0]).quality;
      busy = true;
      let result;
      try { result = State.mergeGears(selected.slice()); }
      finally { busy = false; }
      if (!result.ok) { render(); classic.toast(result.msg); return; }
      selected = []; pageIndex = 0; render();
      const gear = result.gear;
      const effects = State.extText(gear.ext);
      /* 「卖出」：融合产物常是拿去变现的，介绍页直接给卖出入口（点不开确认就关弹窗，
       * close:false 让确认框叠在介绍页上，取消后介绍页还在）。 */
      const success = classic.modal('融合成功', '<div class="fusion-success"><div class="fusion-success-item q' + gear.quality + '"><span class="fusion-frame">' + art(gear) + '</span><strong>' + esc(gear.name) + '</strong></div><div class="fusion-success-details"><div class="fusion-quality-change"><span class="q' + previousQuality + '">' + qualities[previousQuality] + '</span><span aria-hidden="true"> → </span><strong class="q' + gear.quality + '">' + qualities[gear.quality] + '</strong></div><p>基本属性：' + esc(gear.attrName) + ' +' + gear.abilityVal + '<br>使用等级：' + gear.useLevel + ' 级</p>' + (effects.length ? '<p class="fusion-effects">' + effects.map(esc).join('<br>') + '</p>' : '') + '</div></div><p class="fusion-success-note">已消耗 3 件材料和 50 金松果，新装备（' + (PART_NAME[State.gearPart(gear.id)] || '装备') + '）已放入装备背包。</p>', [
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
