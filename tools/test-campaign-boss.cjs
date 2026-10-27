#!/usr/bin/env node
/* ============================================================
 * tools/test-campaign-boss.cjs —— 无尽塔 x0 层的征战动物 boss 回归
 *
 * 规则（用户口径）：
 *   · 90/80/70/.../10 的最后一战放原版征战 boss；
 *   · 倒数第二战换成本层的随机狂战松鼠；
 *   · 最后一战必须比倒数第二战更强；
 *   · 原版「豹王暂未开放」，不能伪造进池。
 * ============================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function findRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'index.html'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(start, '..');
}
const ROOT = findRoot(__dirname);
const ctx = { console, Math, Date, JSON };
ctx.window = ctx;
ctx.localStorage = { getItem: () => null, setItem: () => {} };
vm.createContext(ctx);
for (const f of ['js/gamedict.js', 'js/gamedata.js', 'js/battle-drops.js',
  'js/tower-data.js', 'js/state.js', 'js/sim.js', 'js/tower.js', 'js/tower-plot.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
ctx.State.newGame('征战回归');
const { Tower, TowerData, TowerPlot } = ctx;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('原版已开放的四只征战 boss 都在，豹王保持锁定', () => {
  assert.equal(TowerData.CAMPAIGN_BOSSES.length, 4);
  assert.equal(JSON.stringify(TowerData.CAMPAIGN_BOSSES.map((b) => b.id)),
    JSON.stringify(['campaign_hare', 'campaign_wolf', 'campaign_fox', 'campaign_ape']));
  assert.ok(!TowerData.CAMPAIGN_BOSSES.some((b) => /豹/.test(b.name + b.bigName)),
    '原版 checkIsCampaigning 写着「豹王暂未开放」，不能进池');
  assert.equal(TowerData.CAMPAIGN_BOSS_BY_ID.campaign_ape.mcFrame, 4);
});

test('只有 60/70/80/90 是「随狂战 + 征战 boss」，x100 王庭不替换', () => {
  for (const layer of [60, 70, 80, 90]) {
    const pv = Tower.preview(layer, 'salt', true);
    assert.equal(pv.length, 5, layer + ' 层应为 5 场');
    assert.equal(pv[3].kind, 'warlord', layer + ' 层第 4 场应是狂战松鼠');
    assert.equal(pv[3].squirrel, true);
    assert.equal(pv[4].kind, 'campaign', layer + ' 层第 5 场应是征战 boss');
    assert.ok(pv[4].mcFrame >= 1 && pv[4].mcFrame <= 4);
  }
  for (const layer of [10, 20, 30, 40, 50]) {
    const pv = Tower.preview(layer, 'salt', true);
    assert.equal(pv.length, 5, layer + ' 层仍应是 5 场');
    assert.equal(pv[3].kind !== 'warlord', true, layer + ' 层第 4 场不该被换成狂战松鼠');
    assert.equal(pv[4].kind, 'warlord', layer + ' 层第 5 场仍是塔顶狂战松鼠');
  }
  const x100 = Tower.preview(100, 'salt', true);
  assert.equal(x100.length, 3, '100 层走王庭三连战');
  assert.ok(!x100.some((e) => e.kind === 'campaign'));
});

test('四段征战 boss 剧情只在第 5 场之前触发', () => {
  for (const [layer, id] of [[60, 'boss60'], [70, 'boss70'], [80, 'boss80'], [90, 'boss90']]) {
    assert.ok(TowerPlot.lineCount(id) >= 3, id + ' 至少要有 3 行剧情');
    const plan = [{}, {}, {}, {}, { kind: 'campaign', id: 'campaign_ape' }];
    const beforeBoss = { layer, idx: 4, plan, story: null, attempt: null, choices: null, phase: null };
    assert.equal(TowerPlot.due(beforeBoss), id, layer + ' 层第 5 场之前应播 ' + id);
    const atEntry = { layer, idx: 0, plan, story: null, attempt: null, choices: null, phase: null };
    assert.equal(TowerPlot.due(atEntry), null, layer + ' 层进层时不能抢在三侠前面播 boss 剧情');
  }
});

test('征战 boss 是低血高攻：力量高于、生命不高于前一战 1.5 倍', () => {
  for (const layer of [60, 70, 80, 90]) {
    const pv = Tower.preview(layer, 'salt', true);
    const w = Tower.buildFoeOf('endless', layer,
      { kind: 'warlord', id: 'warlord', _layer: layer, _salt: 'salt' }, 'salt', false).foe;
    const b = Tower.buildFoeOf('endless', layer,
      { kind: 'campaign', id: pv[4].id, _layer: layer, _salt: 'salt' }, 'salt', true).foe;
    assert.ok(b.power > w.power, layer + ' 层 boss 力量必须更高：' + b.power + ' vs ' + w.power);
    assert.ok(b.hp < w.hp * 1.5, layer + ' 层 boss 生命应低于前一战 1.5 倍：' + b.hp + ' vs ' + w.hp);
    assert.equal(b.npcType, null, '动物 boss 走玩家式 Sim，不能当三侠 NPC');
    assert.ok(b.campaign && b.campaign.mcFrame >= 1 && b.campaign.mcFrame <= 4);
  }
});

test('素材包含 6833 和六个动物模型，且由 SfFight 按 campaign 加载', () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/tags-campaign-boss.json'), 'utf8'));
  const ids = new Set(bundle.map((t) => String(t.id)));
  for (const id of ['6833', '6598', '6635', '6684', '6709', '6772', '6832']) {
    assert.ok(ids.has(id), '征战素材包缺 ' + id);
  }
  const uf = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/tags-campaign-boss\.json/.test(uf) && /attachChild\('6833'/.test(uf)
    && /stopAt\(holder, 6\)/.test(uf),
    'SfFight 必须加载征战包，并把 6833 挂到 player2 的 frame6 槽位');
  const ui = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/data-campaign-foe/.test(ui) && /fillClassicCampaignArt/.test(ui),
    '经典塔预告要能为征战 boss 画面板，而不是退回松鼠 7232');
});

test('boss 战斗 UI：不裁血、呼吸、跳过键、现代模式与塔顶层级', () => {
  const uf = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  const rd = fs.readFileSync(path.join(ROOT, 'js/ssfight/render.js'), 'utf8').replace(/\r\n/g, '\n');
  const mn = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/tower.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/startCampaignBreath/.test(uf) && /stopBreath/.test(uf)
    && /noClip: true/.test(uf) && /function setText\(node, str, opts\)/.test(rd),
    '征战 boss 要有呼吸待机，并放开血量数字的字段框裁切');
  assert.ok(/scale\(0\.8\)/.test(uf), '经典跳过键要缩小到 0.8');
  assert.ok(/campaignClassic/.test(mn) && /classicFight: campaignClassic/.test(mn),
    '现代模式遇到 campaign 要强制走经典 SfFight');
  assert.ok(/z-index: 40/.test(css) && /padding-bottom: 190px/.test(css)
    && /\.tower-page\.endless-page \.tower-main/.test(css),
    '无尽塔顶栏要压住对手预览，并给最后一个 boss 留滚动空间');
  const ui = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/sf-classic-campaign/.test(ui) && /data-campaign-foe/.test(ui)
    && /fillClassicCampaignArt/.test(ui) && /const actions = document\.querySelector\('\.endless-actions'\)/.test(ui),
    '现代/经典预告都要能挂征战动物立绘，敌人介绍气泡要避开继续按钮');
});

test('五场四雄层：endless-page / foes-many 接线，第 5 张卡不能压住战斗按钮', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/let runBoard = false;/.test(ui) && /let foeCount = 0;/.test(ui)
    && /runBoard = true;/.test(ui) && /foeCount = foes\.length;/.test(ui),
    '无尽局内页要记录「有动作条」与对手数量');
  assert.ok(/runBoard \? ' endless-page'/.test(ui),
    '局内页必须挂 endless-page（否则 padding-bottom / z-index 那两条 CSS 是死规则）');
  assert.ok(/foeCount >= 5 \? ' foes-many'/.test(ui),
    '5 张对手卡（60/70/80/90 的四雄层）要挂 foes-many，才能切到压缩布局');
  const css = fs.readFileSync(path.join(ROOT, 'css/tower.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/\.tower-page\.endless-page \.tower-main \{ padding-bottom: 190px; \}/.test(css)
    && /\.endless-page \.endless-actions \{ z-index: 60; \}/.test(css),
    '动作条要在对手列之上，并给滚动内容留出底部空间');
  assert.ok(/\.endless-page \.endless-foes\.foes-many \{ margin-top: 50px; \}/.test(css)
    && /\.endless-page \.endless-foes\.foes-many \.tower-plan\.vertical \.foe-portrait \{ width: 84px; height: 66px; \}/.test(css),
    '5 张对手卡要避开右上货币条与右下战斗按钮（不能只改 z-index 让它被盖住）');
  const refine = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/\.classic-tower \.endless-foes\.foes-many \.tower-plan:not\(\.horizontal\):not\(\.boss-grid\) li\{grid-template-columns:80px/.test(refine)
    && /\.classic-tower \.endless-foes\.foes-many \.tower-plan \.foe-portrait\{width:80px!important;height:68px!important\}/.test(refine),
    '经典外壳的 5 张卡也要单独收紧（92×80 立绘会压到继续战斗）');
});

test('四雄预告头像与战斗内模型一一对应：同一 id / 同一 mcFrame，不串脸', () => {
  for (const layer of [60, 70, 80, 90]) {
    const pv = Tower.preview(layer, 'salt', true);
    const b = Tower.buildFoeOf('endless', layer,
      { kind: 'campaign', id: pv[4].id, _layer: layer, _salt: 'salt' }, 'salt', true).foe;
    assert.equal(pv[4].kind, 'campaign', layer + ' 层第 5 场是四雄');
    assert.ok(b.campaign, layer + ' 层战斗必须带 campaign 模型描述');
    assert.equal(b.campaign.id, pv[4].id, layer + ' 层头像与战斗内是同一个四雄');
    assert.equal(b.campaign.mcFrame, pv[4].mcFrame, layer + ' 层头像帧与战斗内 6833 形态必须一致');
  }
});

/* 显示层的切帧规则是运行时同一份（`buildFrames`），这里只借它读"某帧某深度放了谁"。 */
function loadSfRender() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ssfight/render.js'), 'utf8'), sandbox);
  return sandbox.window.SfRender;
}

test('局内表现：清掉 7688 的静态动物、待机用原版呼吸片断、没有归位层的不拨空帧', () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/tags-campaign-boss.json'), 'utf8'));
  const fight = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/tags-fight.json'), 'utf8'));
  const byId = new Map([...fight, ...bundle].map((t) => [String(t.id), t]));
  const { buildFrames } = loadSfRender();
  const placeAt = (frames, n, d) => (frames[n - 1] && frames[n - 1].get(d)) || null;
  const idAt = (frames, n, d) => { const p = placeAt(frames, n, d); return p ? String(p.id) : null; };
  const nameAt = (frames, n, d) => { const p = placeAt(frames, n, d); return p ? (p.na || null) : null; };

  /* 7688 = 7689 第 6 帧的 `playerMc` 槽（原版 `player2.playerMc`）：第 1 帧是 19 块拼好的
   * **静态动物**（姿态就是狡兔），第 2 帧才是空帧。`MainMovie.as:6237` 挂完 6833 立刻
   * `gotoAndStop(2)` 清它；停在 1 就是"敌人位置永远多一只狡兔 / 狡兔战重影"。 */
  const slot = buildFrames(byId.get('7688').Sf);
  assert.equal(slot.length, 2, '7688 是 2 帧');
  assert.equal(slot[0].size, 19, '7688 第 1 帧是 19 块拼好的静态动物');
  assert.equal(slot[1].size, 0, '7688 第 2 帧必须是空帧');

  /* 四只动物模型照 `Animals.as`：f1 attacks / f2 defenses / f3 dodges / f5 attackbacks /
   * f6 comeBacks（只有狼王/猿将有，对应 `Player.getWeaponSkillType` 的 1/0）/ f7 winPoses；
   * 待机呼吸是**出手动画第 1 帧**里唯一那颗多帧子片断（原版没有脚本 = 一直循环）。 */
  const idleOf = { 6598: '6533', 6635: '6603', 6684: '6636', 6709: '6685' };
  for (const [model, idleSym] of Object.entries(idleOf)) {
    const frames = buildFrames(byId.get(model).Sf);
    assert.deepEqual([1, 2, 3, 5, 7].map((n) => nameAt(frames, n, 1)),
      ['attacks', 'defenses', 'dodges', 'attackbacks', 'winPoses'], model + ' 的层名/帧号要照 Animals.as');
    const atkSel = buildFrames(byId.get(idAt(frames, 1, 1)).Sf);
    const atkClip = buildFrames(byId.get(idAt(atkSel, 1, 1)).Sf);
    assert.equal(idAt(atkClip, 1, 1), idleSym, model + ' 的待机片断应是 ' + idleSym);
    assert.ok(buildFrames(byId.get(idleSym).Sf).length > 1, idleSym + ' 必须多帧（呼吸循环）');
    assert.equal(!!idAt(frames, 6, 1), model === '6635' || model === '6709',
      model + ' 的 comeBacks 层要与原版 getWeaponSkillType 一致');
  }
  const uf = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/stopAt\(slot, 2\)/.test(uf) && /function startCampaignIdle/.test(uf)
    && /campaignHasLayer\(mc, 'comeBacks'\)/.test(uf),
    'SfFight 要停 7688 第 2 帧、播原版待机片断、并对没有 comeBacks 的模型跳过归位帧');
});

test('妖狐魅惑被先机预判闪避后不再挂眩晕 / 卸甲', () => {
  const Sim = ctx.Sim;
  /* 「先机预判」的必闪是在 applyDamage 里才落的 r.dodge（预判 dodgeChance 已经算过命中），
   * 所以这里给妖狐 mustHitAll 让预判必中，只让 firstDodge 那一下生效。随机固定为 0：
   * 脱装 56% 必中 —— 修复前这一条会同时看到 dodge 和 stripApplied。 */
  const me = { name: '先机勇者', level: 80, hp: 100000, maxHp: 100000, power: 100, agility: 50, speed: 1,
    weapons: [], skills: [], effects: {}, mods: { firstDodge: 1 } };
  const fox = { name: '暗御妖狐', level: 80, hp: 20000, maxHp: 20000, power: 100, agility: 100, speed: 500,
    weapons: [], skills: [{ id: 8, level: 15 }], castable: [8], pattern: ['skill'], effects: {}, mods: { mustHitAll: 1 } };
  const oldRandom = Math.random;
  Math.random = () => 0;
  let hit = null;
  try {
    const res = Sim.simulate(me, fox);
    hit = (res.rounds || []).find((r) => r.attacker === 1 && r.action === 'skill' && Number(r.id) === 8);
  } finally {
    Math.random = oldRandom;
  }
  assert.ok(hit, '妖狐第一拍应放出色诱之术（魅惑）');
  assert.equal(hit.dodge, true, '先机预判要把这一下判成闪避');
  assert.ok(!hit.stunApplied, '闪避后不能挂「略过一回合」的眩晕');
  assert.ok(!hit.stripApplied && hit.specialEffect !== 1, '闪避后不能挂真·色诱的卸甲');
  assert.equal(hit.stripLeft[0], 0, '我方不应处于脱装备状态');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  PASS  ' + name); }
  catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + e.message); }
}
console.log('\n征战 boss 回归：' + (tests.length - failed) + ' 通过 / ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
