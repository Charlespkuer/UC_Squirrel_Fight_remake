"""Append the rewritten master/apprentice system to js/classic-extras.js.

See rebuild-extras-1.py. Every non-ASCII character is emitted as \\uXXXX so the
generated file is pure ASCII and no console codepage can mangle it.
"""
import io

PARTS = []

def add(src):
    PARTS.append(src)

def _esc(src):
    return ''.join('\\u%04x' % ord(ch) if ord(ch) > 127 else ch for ch in src)

add(r"""  // ==================== 师徒系统 ====================
  // 参考设定：拜师后自动学会「师父驾到」；收徒需先打败对方（对方已有师父则打他师父）；
  // 收徒上限随师父等级 1/2/3 个；徒弟每天为师父产出固定经验（日贡，徒弟自身不损失）；
  // 师父每天可踢 1 个徒弟；徒弟主动退师门花 20 金松果。
  const MASTER_CANDIDATE_COUNT = 3;
  const RECRUIT_CANDIDATE_COUNT = 3;

  /** 师父候选人：等级在玩家等级上方有较大随机范围，并带完整属性/武器/技能。 */
  function rollMasterCandidates() {
    const s = State.state();
    const base = Math.max(3, s.level);
    return Array.from({ length: MASTER_CANDIDATE_COUNT }, () => {
      // 师父通常比徒弟强：+2 ~ +12 级
      const level = Math.max(2, base + 2 + Math.floor(Math.random() * 11));
      return State.genAI(level, '', { levelJitter: 0, gearSelfLevel: true });
    });
  }
  /** 可收服徒弟候选人：等级接近玩家，带完整属性便于查看后再决定。 */
  function rollRecruitCandidates() {
    const s = State.state();
    return Array.from({ length: RECRUIT_CANDIDATE_COUNT }, () => {
      const base = Math.max(1, s.level + (Math.random() < 0.5 ? -2 : 0));
      const foe = State.genAI(base, '', { levelJitter: 2, gearSelfLevel: true });
      // 徒弟不会比师父强太多
      foe.level = Math.min(foe.level, Math.max(1, s.level + 1));
      return foe;
    });
  }
  /** 属性迷你条 + 武器/技能清单，师父与徒弟详情共用。 */
  function profileStats(row) {
    const pills = [['力', row.power], ['敏', row.agility], ['速', row.speed], ['命', row.hp]]
      .map(([k, v]) => '<div class="stat-pill"><b>' + k + '</b>' + esc(v == null ? '-' : v) + '</div>').join('');
    return '<div class="mini-stats">' + pills + '</div>';
  }
  function profileGear(row) {
    const w = (row.weapons || []).map((x) => {
      const inst = State.weaponInst(x);
      return inst ? esc(inst.name) + ' Lv' + inst.level : null;
    }).filter(Boolean);
    const sk = (row.skills || []).map((x) => {
      const inst = State.skillInst(x);
      return inst ? esc(inst.name) + ' Lv' + inst.level : null;
    }).filter(Boolean);
    return '<div class="profile-gear"><span class="profile-gear-label">武器</span><div>' + (w.length ? w.join('、') : '<em>空手</em>') + '</div>' +
      '<span class="profile-gear-label">技能</span><div>' + (sk.length ? sk.join('、') : '<em>无</em>') + '</div></div>';
  }
  function masterProfile(row) {
    if (!row) return '选择一位查看属性';
    return '<div class="profile-panel">' + profileStats(row) + profileGear(row) + '</div>';
  }
  function apprenticeProfile(row) {
    const today = State.localDate();
    const done = row.lastExpDate === today;
    return '<div class="profile-panel">' +
      '<p class="profile-meta">入门日期：' + esc(row.since || '未知') + '　·　今日日贡：' +
      (done ? '<b class="done">已领取</b>' : '<b>' + State.apprenticeDailyExp(row.level) + ' 经验</b>') + '</p>' +
      profileStats(row) + profileGear(row) + '</div>';
  }
""")

add("""
  let masterCandidates = [], recruitCandidates = [];
  let masterSel = 0, recruitSel = 0, apprenticeSel = 0, recruitBusy = false;
  let masterTab = 'master';
""")

add(r"""  function master(tab) {
    recruitBusy = false;
    if (tab === 'master' || tab === 'apprentice') masterTab = tab;
    const s = State.state();
    if (!masterCandidates.length) masterCandidates = rollMasterCandidates();
    if (!recruitCandidates.length) recruitCandidates = rollRecruitCandidates();
    const cap = State.apprenticeCap(s.level);
    const hasMasterSkill = s.skills.some((x) => Number(String(x).split(':')[0]) === State.MASTER_SKILL_ID);

    // ---- 我的师父 / 拜师 ----
    const masterBlock = s.master
      ? '<h2>我的师父</h2><div class="extra-master-current"><div class="master-head"><b>' + esc(s.master.name) + '</b>' +
        '<span>等级 ' + esc(s.master.level) + '</span></div>' +
        masterProfile(s.master) +
        '<div class="master-actions">' + button('出师（20金松果）', 'master-leave', 'tiny muted') + '</div></div>' +
        '<p class="extra-master-tip">已学会「师父驾到」：发动时恢复师父等级 ×4 的生命，且下一次攻击必中。' +
        (hasMasterSkill ? '' : ' <b>（技能缺失，重新拜师可补回）</b>') + '</p>'
      : '<h2>拜师学艺</h2>' +
        '<p class="extra-master-tip">拜师成功后自动学会「师父驾到」。点列表里的师父可查看他的属性与武器技能。</p>' +
        '<div class="candidate-row">' + masterCandidates.map((c, i) =>
          '<div class="candidate-card' + (masterSel === i ? ' active' : '') + '" data-master="' + i + '">' +
          '<b class="candidate-name">' + esc(c.name) + '</b>' +
          '<span class="candidate-level">等级 ' + c.level + '</span>' +
          '<span class="candidate-hp">生命 ' + c.hp + '</span>' +
          '<span class="candidate-hp">装备 ' + (c.gears || []).length + '</span></div>').join('') + '</div>' +
        '<div class="candidate-detail">' + masterProfile(masterCandidates[masterSel]) + '</div>' +
        '<div class="master-actions">' + button('刷新师父', 'master-refresh') +
        (masterCandidates[masterSel] ? button('拜他为师', 'master-join', 'gold') : '') + '</div>';

    // ---- 我的徒弟 / 收徒 ----
    const dailyTotal = State.apprenticeDailyTotal();
    const unclaimed = (s.prentices || []).filter((p) => p.lastExpDate !== State.localDate()).length;
    const apprenticeBlock =
      '<div class="extra-apprentice-title"><h3>我的徒弟（' + s.prentices.length + '/' + cap + '）</h3>' +
      (unclaimed ? button('领取日贡 +' + dailyTotal, 'master-claim', 'tiny gold') : '<span class="daily-done">今日日贡已领</span>') + '</div>' +
      '<p class="extra-master-tip">徒弟每天为师父产出「等级 ×3 + 5」点经验（日贡），徒弟自己的经验不会减少。收徒上限随师父等级提升：10 级前 1 个，10-19 级 2 个，20 级以上 3 个。</p>' +
      '<div class="apprentice-row">' + (s.prentices.length
        ? s.prentices.map((a, i) => '<div class="candidate-card small' + (apprenticeSel === i ? ' active' : '') + '" data-prentice="' + i + '">' +
            '<b class="candidate-name">' + esc(a.name) + '</b><span class="candidate-level">等级 ' + a.level + '</span>' +
            '<span class="candidate-hp">日贡 ' + State.apprenticeDailyExp(a.level) + '</span></div>').join('')
        : '<p class="empty-hint">还没有徒弟，先在下方对可收服的徒弟发起收徒挑战。</p>') + '</div>' +
      (s.prentices[apprenticeSel] ? '<div class="candidate-detail">' + apprenticeProfile(s.prentices[apprenticeSel]) + '</div>' : '') +
      (s.prentices[apprenticeSel] ? '<div class="master-actions">' + button('让他离开师门', 'prentice-leave', 'tiny muted') + '</div>' : '') +
      '<div class="extra-apprentice-title"><h3>可收服的徒弟</h3>' + button('刷新徒弟', 'recruit-refresh', 'tiny') + '</div>' +
      '<div class="candidate-row">' + recruitCandidates.map((c, i) =>
        '<div class="candidate-card' + (recruitSel === i ? ' active' : '') + '" data-recruit="' + i + '">' +
        '<b class="candidate-name">' + esc(c.name) + '</b>' +
        '<span class="candidate-level">等级 ' + c.level + '</span>' +
        '<span class="candidate-hp">生命 ' + c.hp + '</span>' +
        '<span class="candidate-hp">装备 ' + (c.gears || []).length + '</span></div>').join('') + '</div>' +
      '<div class="candidate-detail">' + masterProfile(recruitCandidates[recruitSel]) + '</div>' +
      '<div class="master-actions">' +
      (recruitCandidates[recruitSel] ? button('收徒挑战（10体力）', 'master-recruit', 'gold') : '') +
      (s.prentices.length >= cap ? '<span class="daily-done">收徒名额已满（' + cap + '）</span>' : '') +
      '</div>';

    const p = C().page('system', 'village', '<div class="extra-master-layout">' +
      image('images/classic/characters/master-classic.png', '师父', 'extra-master-portrait') +
      '<div class="extra-master-main">' +
      '<div class="master-tabs">' +
        '<button type="button" class="uc-tab' + (masterTab === 'master' ? ' active' : '') + '" data-mtab="master">我的师父</button>' +
        '<button type="button" class="uc-tab' + (masterTab === 'apprentice' ? ' active' : '') + '" data-mtab="apprentice">我的徒弟（' + s.prentices.length + '/' + cap + '）</button>' +
      '</div>' +
      '<div class="master-panel">' + (masterTab === 'apprentice' ? apprenticeBlock : masterBlock) + '</div>' +
      note('师徒关系保存于本地；师父与徒弟均由本地随机生成。') + '</div></div>',
      { cls: 'extra-board master-extra-board' });
    back(p, () => UI.runAction('village'), '返回村庄');

    // ---- 交互 ----
    p.querySelectorAll('[data-mtab]').forEach((el) => el.onclick = () => { masterTab = el.dataset.mtab; master(); });
    p.querySelectorAll('[data-master]').forEach((el) => el.onclick = () => { masterSel = Number(el.dataset.master); master(); });
    p.querySelectorAll('[data-recruit]').forEach((el) => el.onclick = () => { recruitSel = Number(el.dataset.recruit); master(); });
    p.querySelectorAll('[data-prentice]').forEach((el) => el.onclick = () => { apprenticeSel = Number(el.dataset.prentice); master(); });
    on(p, 'master-refresh', () => { masterCandidates = rollMasterCandidates(); masterSel = 0; C().toast('已刷新师父列表'); master(); });
    on(p, 'recruit-refresh', () => { recruitCandidates = rollRecruitCandidates(); recruitSel = 0; C().toast('已刷新可收服徒弟'); master(); });
    on(p, 'master-join', () => {
      const cand = masterCandidates[masterSel];
      if (!cand || s.master) return;
      const r = State.setMaster(cand);
      if (!r.ok) { alert(r.msg); return; }
      masterCandidates = [];
      C().modal('拜师成功', '<div class="extra-finalist">' + image('images/classic/characters/master-classic.png', '师父') +
        '<div><h3>师父：' + esc(cand.name) + '（' + cand.level + '级）</h3>' +
        '<p>' + esc((r.learned && r.learned.msg) || '已学会【师父驾到】') + '</p>' +
        '<p class="extra-master-tip">发动「师父驾到」可恢复师父等级 ×4 的生命，且下一次攻击必中。</p></div></div>',
        [{ label: '去看看师父', run: () => master('master') }, { label: '返回', cls: 'muted', run: () => master('master') }]);
    });
    on(p, 'master-leave', () => {
      const cost = 20;
      if (s.goldPoint < cost) { alert('退师门需要 ' + cost + ' 金松果，现在只有 ' + s.goldPoint + '。'); return; }
      C().modal('出师', '<p>确定离开【' + esc(s.master.name) + '】的师门吗？需要花费 ' + cost + ' 金松果，之后可以重新拜师。</p>',
        [{ label: '确认出师（-' + cost + '）', run: () => { s.goldPoint -= cost; State.clearMaster(); State.save(); C().toast('已离开师门'); master(); } },
         { label: '返回', cls: 'muted' }], { small: true });
    });
    on(p, 'master-claim', () => {
      const r = State.claimApprenticeExp();
      if (!r.ok) { C().toast(r.msg); master(); return; }
      C().modal('徒弟日贡', '<div class="extra-result"><strong class="cartoon">+' + r.total + ' 经验</strong><p>' + esc(r.msg) + '</p>' +
        '<p class="extra-master-tip">徒弟自己的经验不会减少，这份经验是额外产出的。</p></div>' + C().upsHtml(r.ups),
        [{ label: '确定', run: () => master('apprentice') }], { small: true });
    });
    on(p, 'prentice-leave', () => {
      const a = s.prentices[apprenticeSel];
      if (!a) return;
      const canKick = State.canKickToday();
      C().modal('让徒弟离开', '<p>让【' + esc(a.name) + '】离开师门，空出一个收徒位置？</p>' +
        (canKick ? '' : '<p class="extra-master-tip">今天已经踢过一个徒弟了，要等明天。</p>'),
        canKick
          ? [{ label: '确认', run: () => { const r = State.kickPrentice(a.name); C().toast(r.msg); apprenticeSel = 0; master('apprentice'); } },
             { label: '返回', cls: 'muted' }]
          : [{ label: '知道了', cls: 'muted' }], { small: true });
    });
    on(p, 'master-recruit', () => {
      if (recruitBusy) return;
      if (s.prentices.length >= State.apprenticeCap(s.level)) { alert('收徒名额已满，先让一位徒弟出师吧。'); return; }
      const foe = recruitCandidates[recruitSel];
      if (!foe) return;
      State.tickEnergy();
      if (s.energy < 10) { alert('收徒挑战需要 10 体力，先恢复体力再来吧。'); return; }
      recruitBusy = true;
      let settled = false;
      Main.startBattle(foe, {
        cost: 10, kind: 'master', useProps: true, region: 0,
        onEnd: (winner) => {
          if (settled) return; settled = true; recruitBusy = false;
          const win = winner === 0;
          let recruited = null, text;
          if (win) {
            const added = State.addPrentice(foe);
            recruited = added.ok ? added.apprentice : null;
            text = added.ok ? '收【' + foe.name + '】为徒！' : added.msg;
          } else {
            text = '收徒挑战失败，提升实力后再来。';
          }
          State.tickPropStates();
          const exp = win ? 20 : 0, ups = State.gainExp(exp); State.save();
          if (recruited) { recruitCandidates = rollRecruitCandidates(); recruitSel = 0; apprenticeSel = s.prentices.length - 1; masterTab = 'apprentice'; }
          outcome(win, { exp, gold: 0, ups }, text, () => master('apprentice'), '返回师徒');
        },
      }).catch(() => { recruitBusy = false; C().toast('收徒挑战暂时中断。'); });
    });
  }

  window.ClassicExtras = { arena, rank, lottery, master };
})();
""")

# 只取第一部分（到抽奖结束），重新拼接：先读现有文件的前半段不方便，
# 因此本脚本从 rebuild-extras-1.py 之后追加，这里只写第二部分。
with io.open('js/classic-extras.js', 'a', encoding='utf-8', newline='\n') as f:
    f.write(_esc(''.join(PARTS)))
print('part 2 appended (tab layout)')
