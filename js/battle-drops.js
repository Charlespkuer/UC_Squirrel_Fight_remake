/* Original FightStats: three short-lived pickups at (30,180,340)+random(130)
 * frames, 15fps. Reward odds came from the unavailable server; this small pool
 * is an explicit offline balance, separate from battle damage and stage loot. */
(function () {
  'use strict';
  const RULES = Object.freeze({ fps: 15, frames: [30, 180, 340], jitter: 130, lifetime: 31 / 15 * 1000 });
  const POOL = [
    { id: 15, name: '经验', count: 5, weight: 30 },
    { id: 8, name: '金松果', count: 2, weight: 25 },
    { id: 21, name: '技能卷轴', count: 1, weight: 12 },
    { id: 22, name: '武器卷轴', count: 1, weight: 12 },
    { id: 1, name: '小体力药剂', count: 1, weight: 7 },
    { id: 2, name: '大体力药剂', count: 1, weight: 3 },
    { id: 45, name: '天使果实种子', count: 1, weight: 2 },
    { id: 24, name: '白色碎片', count: 1, weight: 5 },
    { id: 25, name: '绿色碎片', count: 1, weight: 3 },
    { id: 26, name: '蓝色碎片', count: 1, weight: 1 },
  ];
  function plan(random) {
    random = random || Math.random;
    const offset = Math.round(random() * RULES.jitter), total = POOL.reduce((n, p) => n + p.weight, 0);
    return RULES.frames.map((frame, index) => {
      let value = random() * total, reward = POOL[POOL.length - 1];
      for (const item of POOL) { value -= item.weight; if (value < 0) { reward = item; break; } }
      return { ...reward, index, at: (frame + offset) / RULES.fps * 1000 };
    });
  }
  function create(options) {
    const opts = options || {}, drops = plan(opts.random), collected = [], upgrades = [];
    const owner = State.state();
    let elapsed = 0, next = 0, active = null, closed = false, button = null, notice = null, noticeUntil = 0;
    const root = opts.root;
    function removeButton() { if (button) button.remove(); button = null; active = null; }
    function show(reward) {
      removeButton(); active = reward;
      if (!root) return;
      button = document.createElement('button'); button.type = 'button';
      button.className = 'battle-pickup';
      button.setAttribute('aria-label', '拾取' + reward.name + ' ×' + reward.count);
      const source = reward.id >= 24 && reward.id <= 26 ? 'icons/prop-' : 'sprites/draw-';
      button.innerHTML = '<span class="pickup-card"><img alt="" src="images/classic/' + source + reward.id + '.png"></span><span class="pickup-prompt">请点击</span>';
      button.onclick = () => collect(reward.index);
      root.appendChild(button);
    }
    function collect(index) {
      if (closed || !active || active.index !== index || State.state() !== owner || elapsed >= active.at + RULES.lifetime) return false;
      const reward = active; removeButton(); // Retire the click before awarding anything.
      if (reward.id === 15) upgrades.push(...State.gainExp(reward.count));
      else if (reward.id === 8) owner.goldPoint += reward.count;
      else owner.props[reward.id] = (owner.props[reward.id] || 0) + reward.count;
      State.save(); collected.push({ id: reward.id, name: reward.name, count: reward.count });
      if (root) {
        if (notice) notice.remove(); notice = document.createElement('div');
        notice.className = 'battle-pickup-notice'; notice.setAttribute('role', 'status');
        notice.textContent = '获得' + reward.name + ' ×' + reward.count; root.appendChild(notice); noticeUntil = elapsed + 1700;
      }
      return true;
    }
    function tick(dt) {
      if (closed) return;
      elapsed += Math.max(0, Math.min(100, Number(dt) || 0));
      if (active && elapsed >= active.at + RULES.lifetime) removeButton();
      if (notice && elapsed >= noticeUntil) { notice.remove(); notice = null; }
      if (next < drops.length && elapsed >= drops[next].at) { const drop = drops[next++]; if (elapsed < drop.at + RULES.lifetime) show(drop); }
    }
    function close() { closed = true; removeButton(); if (notice) notice.remove(); notice = null; }
    function summary() { return { items: collected.map(item => ({ ...item })), ups: upgrades.slice() }; }
    return { tick, collect, close, summary };
  }
  window.BattleDrops = { create, plan, rules: RULES };
})();
