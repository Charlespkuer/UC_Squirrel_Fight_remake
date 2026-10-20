#!/usr/bin/env node
/* ============================================================
 * tools/test-ssfight-render.cjs — 经典模式显示层（js/ssfight/render.js）回归
 *
 * 不启动浏览器：帧构建测纯逻辑，切页生命周期用最小 DOM 原语运行真实显示/UI代码；
 * 浏览器侧的动画播放实测记录见 docs/经典模式-可行性.md §12.6。
 *
 * 钉住的语义（每一条都对应一个真实踩过的坑）：
 *   1. tp:1 切帧、remove 删深度、缺 ma 时沿用该深度上次的矩阵；
 *   2. `rp`（替换标记）只在"这条标签真正出现的帧段"有效，跨帧携带必须剥掉
 *      —— 否则每秒刷新数值时的同帧 gotoAndStop 会把子实例重建、播放头归零
 *      （2026-10-13 实测：徒弟动画每秒被打回第 1 帧）；
 *   3. 数字精灵的"空白位"= 最末帧（靠流末尾的 remove 产生）——尾帧不能丢，
 *      否则 showNumber 的清位逻辑失效。
 *
 * 用法：node tools/test-ssfight-render.cjs
 * ============================================================ */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

/** 在 vm 里加载 render.js（只需要一个 window 桩；纯逻辑路径不碰 document/fetch）。 */
function loadRender() {
  const sandbox = { window: {}, console };
  sandbox.window.SfRender = undefined;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ssfight/render.js'), 'utf8'), sandbox);
  assert.ok(sandbox.window.SfRender, 'render.js 应该暴露 window.SfRender');
  return sandbox.window.SfRender;
}

const SfRender = loadRender();
const { buildFrames } = SfRender;

/* ---------- 1. 合成流：切帧 / 携带 / rp 语义 ---------- */
{
  const Sf = [
    { tp: 26, d: 1, id: 'A', ma: '1,0,0,1,0,0', rp: true },   // 帧 1：初始放置（带 rp）
    { tp: 1 },
    { tp: 26, d: 1, id: 'A', ma: '1,0,0,1,5,0' },             // 帧 2：同深度同 id 的移动（无 rp）
    { tp: 26, d: 2, id: 'B', ma: '1,0,0,1,9,9', rp: true },   // 帧 2：新深度的初始放置（带 rp）
    { tp: 1 },
    { tp: 1 },                                                 // 帧 3：本帧段没有放置标签
    { tp: 26, d: 1, remove: true },                            // 帧 4：移除 d1
    { tp: 1 },
  ];
  const frames = buildFrames(Sf);
  assert.equal(frames.length, 4, '四个 tp:1 → 四帧');

  const f1d1 = frames[0].get(1);
  assert.equal(f1d1.rp, true, '初始放置保留 rp');
  assert.equal(f1d1.placedHere, true, '初始放置标记 placedHere');

  const f2d1 = frames[1].get(1);
  assert.equal(f2d1.rp, undefined, '移动放置不带 rp（就算上次有也不许携带）');
  assert.equal(f2d1.placedHere, true, '本帧段真出现的放置标 placedHere');
  assert.equal(f2d1.ma, '1,0,0,1,5,0', '移动放置更新矩阵');
  const f2d2 = frames[1].get(2);
  assert.equal(f2d2.rp, true, '新深度的初始放置保留 rp');

  const f3d1 = frames[2].get(1);
  assert.equal(f3d1.rp, undefined, '跨帧携带的放置必须剥掉 rp（否则每帧都被当成替换）');
  assert.equal(f3d1.placedHere, undefined, '跨帧携带的放置不标 placedHere');
  assert.equal(f3d1.ma, '1,0,0,1,5,0', '携带的放置沿用上次矩阵');
  assert.ok(frames[2].has(2), '携带的放置在新帧里仍在');

  assert.ok(!frames[3].has(1), 'remove 的深度不再出现');
  assert.ok(frames[3].has(2), 'remove 只影响指定深度');
}

/* ---------- 2. 同深度换元件：快照里 id 必须换（showFrame 靠 id 判等决定重建） ---------- */
{
  const Sf = [
    { tp: 26, d: 11, id: '5629', ma: '1,0,0,1,0,0', rp: true },
    { tp: 1 },
    { tp: 26, d: 11, id: '5626', ma: '1,0,0,1,0,0', rp: true }, // myself f2 的真实换件
    { tp: 1 },
  ];
  const frames = buildFrames(Sf);
  assert.equal(frames[0].get(11).id, '5629');
  assert.equal(frames[1].get(11).id, '5626', '换元件后快照里的 id 必须变');
  assert.equal(frames[1].get(11).placedHere, true);
}

/* ---------- 3. 真实素材库：数字精灵末帧 = 空白（showNumber 的清位语义） ---------- */
{
  const tagsFile = path.join(ROOT, 'images/ssfight/ui/tags.json');
  if (!fs.existsSync(tagsFile)) {
    console.log('SKIP 素材库未生成（images/ssfight/ui/tags.json 不存在；先跑 node tools/gen-ssfight-ui.cjs）');
  } else {
    const tags = JSON.parse(fs.readFileSync(tagsFile, 'utf8'));
    const byId = new Map(tags.map((t) => [String(t.id), t]));
    const digit = byId.get('3529');                       // 金松果/等级用的位图数字精灵
    assert.ok(digit, '素材库里应有数字精灵 3529');
    const dFrames = buildFrames(digit.Sf);
    assert.equal(dFrames.length, 51, '数字精灵 51 帧（多号字形 + 符号 + 空白）');
    assert.equal(dFrames[50].size, 0, '最末帧必须是空白（showNumber 的清位依赖它）');
    assert.ok(dFrames[0].size > 0, '第 1 帧是数字 0，不是空白');

    const me = byId.get('6988');                          // 首页主角松鼠
    assert.ok(me, '素材库里应有 myself 6988');
    assert.equal(buildFrames(me.Sf).length, 88, 'myself 88 帧循环动画');

    const pr = byId.get('6982');                          // 徒弟栏：1/2/3 个徒弟 + 空
    const pFrames = buildFrames(pr.Sf);
    assert.equal(pFrames.length, 4, '徒弟栏 4 帧（末帧为空；原版第 5 帧也是空，靠 gotoAndStop 钳位对齐）');
    assert.equal(pFrames[0].size, 1, '第 1 帧 = 1 个徒弟');
    assert.equal(pFrames[1].size, 2, '第 2 帧 = 2 个徒弟');
    assert.equal(pFrames[2].size, 3, '第 3 帧 = 3 个徒弟');
    assert.equal(pFrames[3].size, 0, '末帧 = 空（没徒弟时显示）');
  }
}

/* ---------- 5. 裁剪深度（cD 蒙版）：必须逐帧携带，且蒙版自己会动 ---------- */
/* 体力/经验条的填充就是靠这个「蒙版右移 = 逐帧揭开」实现的（7022 / 4318）。
 * 关键点：蒙版只在**第 1 帧**那条放置上写 cD，后面每帧只改自己的矩阵；
 * buildFrames 必须把 cD 一路携带下去，否则 showFrame 从第 2 帧起就不认得它是蒙版了
 * —— 表现是蒙版形状被当普通形状画出来（SVG 无填充默认填黑，盖住「体力」两个字），
 * 且填充不再被裁（和经验条外框对不上）。 */
{
  const Sf = [
    { tp: 26, d: 1, id: 'M', ma: '1,0,0,1,0,0', cD: 3, rp: true },   // 帧 1：蒙版（只有这一条带 cD）
    { tp: 26, d: 2, id: 'F', ma: '1,0,0,1,0,0', rp: true },          // 帧 1：被蒙住的填充
    { tp: 1 },
    { tp: 26, d: 1, id: 'M', ma: '1,0,0,1,0.95,0' },                 // 帧 2：蒙版只改矩阵
    { tp: 1 },
    { tp: 26, d: 1, id: 'M', ma: '1,0,0,1,1.95,0' },                 // 帧 3
    { tp: 1 },
  ];
  const frames = buildFrames(Sf);
  assert.equal(frames.length, 3, '三条 tp:1 → 三帧');
  for (let i = 0; i < frames.length; i++) {
    const m = frames[i].get(1);
    assert.equal(m.cD, 3, '第 ' + (i + 1) + ' 帧仍认得 d1 是蒙版（cD 跨帧携带）');
    assert.equal(frames[i].get(2).cD, undefined, 'd2 是普通节点，没有 cD');
  }
  assert.equal(frames[0].get(1).ma, '1,0,0,1,0,0', '蒙版第 1 帧在原地');
  assert.equal(frames[2].get(1).ma, '1,0,0,1,1.95,0', '蒙版逐帧右移（填充就是这么被揭开的）');
}

/* ---------- 6. 装备"持有者"精灵：第 1 帧必须是空的（挂点从第 2 帧才开始） ---------- */
/* 原版 `chooseEquipLoader`（MainMovie.as:6767）version "c" 走
 * `mc.gotoAndStop(_loc1[type][0].frameIndex + 1)` —— **+1 不是笔误**：
 * 持有者（5433 头 / 5261 身体 / 5604 外拳套 …）第 1 帧没有任何放置，第 2 帧才是第 1 件装备的挂点。
 * 复刻 2026-10 之前漏了这个 +1 → 每件装备都放出**上一件装备的挂点**，落点整体错一格
 * （用户报的"主界面装备贴图对不上"）。这条断言就是钉住那个 +1 的前提。 */
{
  const tagsFile = path.join(ROOT, 'images/ssfight/ui/tags.json');
  if (fs.existsSync(tagsFile)) {
    const tags = JSON.parse(fs.readFileSync(tagsFile, 'utf8'));
    const byId = new Map(tags.map((t) => [String(t.id), t]));
    for (const [holder, part] of [['5433', '头'], ['5261', '衣服'], ['5604', '外拳套'], ['5187', '鞋子']]) {
      const t = byId.get(holder);
      assert.ok(t, '素材库里应有持有者 ' + holder + '（' + part + '）');
      const fr = buildFrames(t.Sf);
      assert.ok(fr.length > 180, part + '持有者 ' + holder + ' 应是 189 帧的长条精灵（实测 ' + fr.length + '）');
      assert.equal(fr[0].size, 0, part + '持有者第 1 帧必须是空的（frameIndex+1 就靠这个空帧）');
      assert.ok(fr[1] && fr[1].size > 0, part + '持有者第 2 帧必须是第 1 件装备的挂点');
    }
  }
}

/* ---------- 7. 主界面状态格（c1/c2/c3）的图标表：必须与 State.useProp 的"生效类道具"完全一致 ---------- */
/* 原版 `MainMovie.as:15859 showStates()` 里那 9 个药丸名单对应复刻的 `State.propsStates`：
 * `useProp` 里给 `propsStates[id] = 20` 的那几个 id 就是"用了会在主界面显示图标"的道具。
 * 两处一旦对不上就会出现**用户直接看得见**的错：状态格空着（漏列）或图标挂错道具（错列）。
 * 这里只读源码做集合比对，不重复实现 `activeStatePills`（那是 DOM 侧的事，浏览器才能跑）。 */
{
  const src = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const table = src.slice(src.indexOf('const STATE_PILLS'), src.indexOf('];', src.indexOf('const STATE_PILLS')));
  const listed = [...table.matchAll(/\{\s*id:\s*(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  assert.ok(listed.length >= 8, 'STATE_PILLS 里应当列出原版那 8 种药丸（实地 ' + listed.length + ' 条）');
  const stateSrc = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8').replace(/\r\n/g, '\n');
  /* ⚠ case 标签在**上一行**（`case 3: case 4: …:` 换行才是赋值），只取赋值那一行会一个 case 都抠不到；
   * 多取两行也够用 —— 那个区间里不会混进别的 id（`useProp` 的 case 串本身）。 */
  const lines = stateSrc.split('\n');
  const at = lines.findIndex((l) => /propsStates\[id\]\s*=\s*20/.test(l));
  const live = at < 0 ? [] : [...lines.slice(Math.max(0, at - 2), at + 1).join('\n').matchAll(/case\s+(\d+)/g)]
    .map((m) => Number(m[1])).sort((a, b) => a - b);
  assert.ok(live.length, 'state.js 的 useProp 里应当有 propsStates[id]=20 的 case 分支');
  assert.deepEqual(listed, live,
    'STATE_PILLS 必须与 useProp 里 propsStates[id]=20 的那批 id 完全一致（差一个就会漏画/错画状态格图标）');
}

/* ---------- 8. 村庄「地点场景页」：三颗库元件的素材包必须自己闭合，且页帧对得上 AS ---------- */
/* 这四个地点进的是原版**运行时 attachMovie 的库元件**（不在根时间轴里）：
 *   「家园弹出」3957（祭坛=帧1 / 神迹=帧3 / 神迹记录=帧4）、「幻兽牧场」4381（列表=帧1）、
 *   「征战」3437（主页=帧1）。它们由 `tools/gen-ssfight-ui.cjs` 的 SCENES 提成三份独立的包，
 *   运行时只按需拉自己那一份（`js/ssfight/ui-village.js` 的 PAGES 表）。
 *
 * 这条用例钉两件**只有真出问题才会被发现**的事：
 *   1. **闭包必须自闭合**：包是从整片导出的 7876 个标签里裁出来的，一旦漏了被引用的 id，
 *      渲染器会**静默跳过**那一块（`tagFor` 拿不到就 `continue`）—— 页面看着"少了一块"，
 *      而不是报错。所以逐个 placement 的 id 都要在**同一份包**里能找到。
 *   2. **页帧号与内容对得上 AS**：帧号写错就会"点祭坛进了酒吧"这种一眼假的东西。 */
{
  const dir = path.join(ROOT, 'images/ssfight/ui');
  const SCENES = [
    { file: 'tags-homeland.json', symbol: '3957', pages: { 1: ['text2', 'text3', 'button1', 'button2', 'button3'], 3: ['button1', 'button2', 'button3'], 4: ['text1', 'button1'] } },
    { file: 'tags-summons.json', symbol: '4381', pages: { 1: ['text11', 'text1', 'page', 'c1', 'left', 'right', 'button1', 'button2', 'button3', 'button4', 'button5', 'levelup'] } },
    { file: 'tags-campaign.json', symbol: '3437', pages: { 1: ['main_mc', 'left', 'right', 'button1', 'button2', 'newMessage'] } },
  ];
  const missingFiles = SCENES.filter((s) => !fs.existsSync(path.join(dir, s.file))).map((s) => s.file);
  if (missingFiles.length) {
    console.log('SKIP 地点场景素材包未生成（' + missingFiles.join(', ')
      + '；先跑 node tools/gen-ssfight-ui.cjs）');
  } else {
    for (const sc of SCENES) {
      const tags = JSON.parse(fs.readFileSync(path.join(dir, sc.file), 'utf8'));
      const byId = new Map(tags.map((t) => [String(t.id), t]));
      const sym = byId.get(sc.symbol);
      assert.ok(sym, sc.file + ' 里应当有库元件 ' + sc.symbol);
      assert.equal(sym.tp, 39, '库元件 ' + sc.symbol + ' 应当是精灵（tp39）');

      /* ① 闭包自闭合：本包里出现的每一个 placement id 都要在本包里 */
      const missing = new Set();
      for (const t of tags) {
        for (const p of t.Sf || []) if (p.id !== undefined && !byId.has(String(p.id))) missing.add(String(p.id));
        for (const r of t.rc || []) if (r.id !== undefined && !byId.has(String(r.id))) missing.add(String(r.id));
      }
      assert.equal(missing.size, 0,
        sc.file + ' 的闭包不闭合，渲染时会静默少画这些元件：' + [...missing].slice(0, 8).join(', '));

      /* ② 页帧号 → 该帧上必须有的具名子元件（出处：MainMovie.as 的 showTemple / showMiracle /
       *    showMiracleRecord / showSummons / showCampaign 里那些 gotoAndStop 与 mc.xxx 赋值） */
      const frames = buildFrames(sym.Sf);
      for (const [page, names] of Object.entries(sc.pages)) {
        const f = frames[Number(page) - 1];
        assert.ok(f, sc.symbol + ' 应当有第 ' + page + ' 帧');
        const here = new Set([...f.values()].map((p) => p.na).filter(Boolean));
        for (const n of names) {
          assert.ok(here.has(n), sc.symbol + ' 第 ' + page + ' 帧上应当有具名元件 ' + n
            + '（现有：' + [...here].join(',') + '）');
        }
      }
    }
    /* ③ manifest 里也要有这三份包（否则下次 `--all` 之外的调用不会重出它们） */
    const mani = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const listed = new Set((mani.bundles || []).map((b) => b.file));
    for (const sc of SCENES) assert.ok(listed.has(sc.file), 'manifest.bundles 里应当列出 ' + sc.file);
  }
}

/* ---------- 9. 状态页（zhuangtai / 7218）：页包必须自带**页根**与四个部位精灵 ----------
 * 状态页整页由原版素材渲染（`js/ssfight/ui-status.js`），两处最容易静默失效的地方：
 *   ① 页包缺 `7218` —— `mountSymbol('7218')` 直接抛"素材库里没有元件"（第一次生成就踩了这个：
 *      `closure()` 从 id 出发往下走，页根自己不会被算进去，得显式加进 roots）；
 *   ② 缺四个部位精灵（`mc_head`/`mc_body`/`mc_hand*`/`mc_foot*`）—— 落绘穿装备那一步静默跳过，
 *      玩家看到的是"一只没穿装备的松鼠"，不报错、很难发现。
 * 这里只校验素材库形状（纯文件读取，不碰 DOM）。 */
{
  const dir = path.join(ROOT, 'images', 'ssfight', 'ui');
  const status = JSON.parse(fs.readFileSync(path.join(dir, 'tags-status.json'), 'utf8'));
  const byId = new Map(status.map((t) => [String(t.id), t]));
  assert.ok(byId.has('7218'), 'tags-status.json 里必须有状态页根元件 7218');
  const SIDE = { 5785: 'ikNode_9', 5262: 'mc_body', 5116: 'mc_fistR', 5188: 'mc_footL/R', 4950: 'mc_handL/R' };
  for (const [id, what] of Object.entries(SIDE)) {
    assert.ok(byId.has(id), 'tags-status.json 里必须有状态页落绘的部位精灵 ' + id + '（' + what + '）');
  }
  /* 页根第一帧必须同时给出四维数字 + 经验条 + 胜率 / 场次 + 两颗功能键（出处：导出数据实测）。 */
  const frames = buildFrames(byId.get('7218').Sf);
  assert.ok(frames.length >= 3, '状态页应当有 3 帧（状态 / 武器 / 技能），实测 ' + frames.length);
  const names = new Set([...frames[0].values()].map((p) => p.na).filter(Boolean));
  for (const n of ['expMc', 'expNum', 'power', 'agility', 'speed', 'hp', 'winRate',
    'fightTimes1', 'fightTimes2', 'b_change', 'b_fusion', 'tab', 'tab1', 'tab2', 'back']) {
    assert.ok(names.has(n), '状态页第 1 帧上应当有具名元件 ' + n + '（现有：' + [...names].join(',') + '）');
  }
  /* 武器 / 技能那两帧必须有 2×5 装备格与翻页（`showEquips` 的 c1..c10 / left / right / page）。 */
  for (const fi of [1, 2]) {
    const here = new Set([...frames[fi].values()].map((p) => p.na).filter(Boolean));
    for (const n of ['c1', 'c5', 'c6', 'c10', 'left', 'right', 'page']) {
      assert.ok(here.has(n), '状态页第 ' + (fi + 1) + ' 帧上应当有 ' + n);
    }
  }
  const mani = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.ok((mani.bundles || []).some((b) => b.file === 'tags-status.json'),
    'manifest.bundles 里应当列出 tags-status.json');
}

/* ---------- 10. 经典主界面药丸：签名缓存必须跟着宿主 DOM 一起失效 ----------
 * 用户 2026-10 第一百五十批的 bug："多次切换模式之后，经典模式下药丸在主界面不展示"。
 * 根因：`renderStateIcons()` 只用模块级 `stateSig` 判"要不要重画"，而切模式会把宿主
 * `.ssfight-home` 整棵换掉（新宿主是空的、签名却没变）→ 直接 return，宿主永远是空的。
 * 修法是"签名 + 宿主自己的戳"都对得上才跳过，并在 `destroy()` 里把签名清掉。
 * 这条只读源码断言（DOM 侧的行为要靠浏览器跑，见 out/ 下的一次性探针）。 */
{
  const src = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const fn = src.slice(src.indexOf('function renderStateIcons'), src.indexOf('function positionStateIcons'));
  assert.ok(/STATE_STAMP/.test(fn), 'renderStateIcons 必须用宿主上的戳一起判断（否则切模式后药丸不再出现）');
  assert.ok(/host\.getAttribute\(STATE_STAMP\)\s*!==\s*sig/.test(fn),
    'renderStateIcons 的跳过条件必须同时比较 stateSig 与宿主上的戳');
  const dstr = src.slice(src.indexOf('function destroy()'), src.indexOf('function destroy()') + 500);
  assert.ok(/stateSig\s*=\s*''/.test(dstr), 'destroy() 必须清掉 stateSig（宿主 DOM 已经跟着被摘掉了）');
}

/* ---------- 11. 挑战页（tiaozhan / 7638）：页包必须自带**页根**与二级/三级页库元件 ----------
 * 挑战页整页由原版素材渲染（`js/ssfight/ui-challenge.js`）。两处最容易静默失效：
 *   ① 缺页根 `7638` —— `mountSymbol('7638')` 直接抛"素材库里没有元件"；
 *   ② 缺**库元件「挑战1」= 4756** —— 它是原版运行时 `loadMcs([["挑战1","tiaozhanSub",…]])`
 *      挂上去的，**不在页根的静态闭包里**，`closure()` 从 7638 往下走永远走不到
 *      （第一版就是这样：点门卡"没反应"，因为异步挂载被拒绝）。所以 `gen-ssfight-ui.cjs`
 *      里有一份 `CHALLENGE_PARTS` 显式把它塞进页包。
 * 这里只校验素材库形状（纯文件读取，不碰 DOM）。 */
{
  const dir = path.join(ROOT, 'images', 'ssfight', 'ui');
  const ch = JSON.parse(fs.readFileSync(path.join(dir, 'tags-challenge.json'), 'utf8'));
  const byId = new Map(ch.map((t) => [String(t.id), t]));
  assert.ok(byId.has('7638'), 'tags-challenge.json 里必须有挑战页根元件 7638');
  assert.ok(byId.has('4756'), 'tags-challenge.json 里必须有二级/三级页库元件「挑战1」4756（CHALLENGE_PARTS）');
  /* 页根第一帧（我的好友）的具名元件，按 `MainMovie.as` 的 showMyFriends / doShowFriends 逐条核。 */
  const frames = buildFrames(byId.get('7638').Sf);
  const f1 = new Set([...frames[0].values()].map((p) => p.na).filter(Boolean));
  for (const n of ['tab', 'tab1', 'tab2', 'tab3', 'f1', 'f2', 'f3', 'f4', 's1', 's2', 's3', 's4',
    'vip1', 'vip4', 'left', 'right', 'page', 'energyMc', 'energy', 'maxEnergy', 'back', 'rightBg', 'addfriend']) {
    assert.ok(f1.has(n), '挑战页第 1 帧上应当有具名元件 ' + n + '（现有：' + [...f1].join(',') + '）');
  }
  /* 第 3 帧 = 关卡一级页（`showGate` → `tiaozhan.gotoAndStop(3)`）：门卡与门底图都在 `fubenSub` 里。 */
  const f3 = new Set([...frames[2].values()].map((p) => p.na).filter(Boolean));
  assert.ok(f3.has('fubenSub'), '挑战页第 3 帧上应当有 fubenSub（关卡一级页）');
  /* 库元件 4756：第 5 帧 = 难度选择（style + 六颗星 + back）、第 4 帧 = 出战确认（info1/info2 + 两键）。 */
  const sub = buildFrames(byId.get('4756').Sf);
  const named = (i) => new Set([...sub[i].values()].map((p) => p.na).filter(Boolean));
  for (const n of ['style', 'button1', 'button2', 'button3', 'button4', 'button5', 'button6', 'back']) {
    assert.ok(named(4).has(n), '「挑战1」第 5 帧（难度选择）上应当有 ' + n);
  }
  for (const n of ['info1', 'info2', 'button1', 'button2']) {
    assert.ok(named(3).has(n), '「挑战1」第 4 帧（出战确认）上应当有 ' + n);
  }
  const mani = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.ok((mani.bundles || []).some((b) => b.file === 'tags-challenge.json'),
    'manifest.bundles 里应当列出 tags-challenge.json');
}

/* ---------- 12. 点击路由 + 「静态页策略」两条契约（用户 2026-10 报的 bug 的根因） ----------
 * 都是"静默失效"型：出问题时界面照样能看，只是点不对 / 元件在自己可达的帧之间乱跳，所以用源码断言钉住。
 *   ① 底栏五键各铺一块 `HIT_PAD` 热区，相邻两颗重叠 8~12 个舞台单位 —— SVG 原生命中测试是
 *      "谁画得晚谁赢"，于是鼠标停在 A 上亮的却是 B、点进去也进 B。修法是 `addHitArea`
 *      铺完把元件登记进"点击路由"（自己按内容包围盒判定归属）。
 *   ② **UI「乱跳」**（用户 2026-10：武器技能页十颗图标一起跳、状态页切 tab 回来立绘与装备乱动、
 *      建筑等级牌子上的数字乱跳）的真根因是显示层忠实实现了 Flash 语义（一出生 `playing = true`、
 *      14 fps 自己循环），而"该静"一直靠**事后扫一遍当时的实例**（老的 `freezeDescendants`
 *      内部 `pinFrame(1)`）—— 它有两个天生的洞：换帧重建出来的新实例没人管、
 *      `attachChild()` 挂上去的子树根本不在 `nodes` 里扫不到。
 *      现在的契约（见 `docs/AGENTS.md` 的同名章节）：
 *        · **规则化**：`MovieClip.prototype.setStaticPolicy({keepNames,keepIds,blankNames})`
 *          按实例名 / 元件号写规则，**随实例向下继承**（`walkStatic` 会把 `__policy` 一路写下去）；
 *        · **出生即生效**：所有实例出生路径都要套一遍 —— `showFrame()` 的新建/替换分支、
 *          `attachChild()`、`setSymbol()`；
 *        · **冻结 = `playing = false`**，不许退回 `pinFrame()`（那是"每一拍强制拨回某一帧"，
 *          会和 `gotoAndStop` 打架，历史上逼着每个页面都写一段"先摘 `__pinFrame`"的补丁）；
 *        · **播放注册表按视图分开**（`view.live`），不许退回模块级单例 —— 否则盖一层子页
 *          就会把底层那一页从播放表里清空。
 */
{
  const main = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const add = main.slice(main.indexOf('function addHitArea'), main.indexOf('function measureFrameBoxes'));
  assert.ok(/registerHit\(clip, animate\)/.test(add), 'addHitArea 铺完热区必须把元件登记进点击路由');
  const reg = main.slice(main.indexOf('function registerHit'), main.indexOf('function unregisterHit'));
  assert.ok(/pointerEvents = 'none'/.test(reg),
    'registerHit 必须关掉元件自己的指针事件（否则它仍然按"谁画得晚谁赢"抢命中）');

  const fz = main.slice(main.indexOf('function freezeDescendants'), main.indexOf('function multiFrameKids'));
  assert.ok(/setStaticPolicy\(\{ keepIds: \[\.\.\.KEEP_ANIMATED\] \}\)/.test(fz),
    'freezeDescendants 必须把"整页静态 + KEEP_ANIMATED 白名单"写成静态页策略');
  assert.ok(!/pinFrame\(/.test(fz),
    'freezeDescendants 不许再退回 pinFrame（每一拍强制拨帧会和 gotoAndStop 打架）');

  const rd = fs.readFileSync(path.join(ROOT, 'js/ssfight/render.js'), 'utf8').replace(/\r\n/g, '\n');
  const apply = rd.slice(rd.indexOf('function applyStatic'), rd.indexOf('function walkStatic'));
  assert.ok(/clip\.playing = false;/.test(apply),
    'applyStatic 必须用 playing = false 冻结（不碰帧号，gotoAndStop / showNumber 才照常生效）');
  const walk = rd.slice(rd.indexOf('function walkStatic'), rd.indexOf('function MovieClip('));
  assert.ok(/rec\.clip\.__policy = pol/.test(walk),
    'walkStatic 必须把策略**沿着树写下去**（挂载时建出来的实例出生在"视图还没有策略"的时候）');
  const birth = rd.slice(rd.indexOf('if (child.tp === 39) {'), rd.indexOf('} else if (child.tp === 11)'));
  assert.ok(/clip\.__policy = this\.__policy/.test(birth) && /applyStatic\(clip, p\.na\)/.test(birth),
    'showFrame 里新建出来的子实例必须继承策略并当场冻结');
  const attach = rd.slice(rd.indexOf('MovieClip.prototype.attachChild'), rd.indexOf('MovieClip.prototype.detachAll'));
  assert.ok(/clip\.__policy = this\.__policy/.test(attach) && /applyStatic\(clip, name\)/.test(attach),
    'attachChild 挂上来的库元件子树必须同样继承策略（武器/技能图标那 10 颗就漏在这里）');
  assert.ok(/view\.live = o\.live/.test(rd) && !/liveClips/.test(rd),
    '播放注册表必须按视图分开（模块级单例 + 挂载时 clear 会把底层那一页的动画清掉）');
  /* 装备容器 / 贴图在等 `getBBox()` 的那一刻不能先按原始坐标画出来：那会在屏幕上方
   * 闪一下装备（浏览器实测 slot 5315 / sid 1919 的 transform 在某一帧只剩原版矩阵）。
   * `anchorToBBox` 必须先隐藏、量到包围盒并应用后再恢复。 */
  const anchor = rd.slice(rd.indexOf('MovieClip.prototype.anchorToBBox'), rd.indexOf('/* ---------- 挂载：根时间轴'));
  assert.ok(/__anchorHidden/.test(anchor) && /visibility = 'hidden'/.test(anchor) && /restore\(\)/.test(anchor),
    'anchorToBBox 等包围盒期间要先隐藏，避免装备在屏幕上方闪一下');
  assert.ok(/bboxCache/.test(anchor) && /cacheKey/.test(anchor),
    '装备包围盒要按「元件号@帧号」缓存：每回合重建挂点时不能再等一帧、把装备藏一下');
  const show = rd.slice(rd.indexOf('MovieClip.prototype.showFrame'), rd.indexOf('MovieClip.prototype.tagFor'));
  assert.ok(/this\.placeFrameNode\(target\);[\s\S]{0,700}?onClip\(clip\)/.test(show),
    'onClip 必须在节点进文档后调用，否则 setSymbol 里的 getBBox 仍会量不到');

  const st = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/freezeDescendants\(view\)/.test(st),
    '状态页挂载后必须整页设成静态页（一个例外名单都不该有：冻结不碰帧号，数字精灵照样能写）');
  assert.ok(!/function valueClips/.test(st), '状态页不该再有"数值精灵不许冻结"的保护名单（老机制的补丁）');
  assert.ok(/\['hp', 'hp'\]/.test(st),
    '四维第 4 格要取 State.totalStats() 的 hp（写 maxHp 的话那格恒为 0）');
  assert.ok(/showBigNumber\(allFights/.test(st), '战斗场次要按原版 showbigNumber 拆成两颗数字精灵');
}

/* ---------- 13. 武器 / 技能图标表必须是"一个名字一颗、一个不缺" ----------
 * 用户 2026-10 口径："武器与技能的贴图不要再使用旧素材，去 ssfight 版本中捞出矢量图素材进行替换。"
 * 这张表由 `tools/gen-ssfight-ui.cjs` 的 `swfSymbolIds()` **现算**（读 SWF 自己配对）——
 * 之前用的是 `01-swf-符号表/导出符号表.tsv`，那张表把名字配到了"紧随其后的 sprite"上、整体错位一格：
 * 贴图全串位（死老鼠显示的是双刃剑的图），而且大榔头 / 龟甲术 / 吸铁大法 三条直接是 `None`。
 * 这里只钉"不碰 references/ 也能验"的那半条契约：名字齐、没有缺项、id 互不相同。 */
{
  const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/weapon-skill-icons.json'), 'utf8'));
  assert.equal((icons.missing || []).length, 0,
    '武器/技能图标表不该有缺项（有缺项 = 又退回那张错位的符号表了）');
  const dict = fs.readFileSync(path.join(ROOT, 'js/gamedict.js'), 'utf8').replace(/\r\n/g, '\n');
  const countOf = (block) => {
    const at = dict.indexOf(block + ' = createDict');
    assert.ok(at > 0, 'js/gamedict.js 里找不到 ' + block);
    const rest = dict.slice(at);
    const nxt = rest.slice(1).search(/\n  const \w+ = createDict/);
    const seg = nxt < 0 ? rest : rest.slice(0, nxt + 1);
    return (seg.match(/\[\s*-?\d+\s*,\s*"(?:[^"\\]|\\.)*"\s*,\s*"(?:[^"\\]|\\.)*"\s*\]/g) || []).length;
  };
  const ids = [];
  for (const pair of [['weapon', 'weaponsMap'], ['skill', 'skillsMap']]) {
    const rows = Object.keys(icons[pair[0]] || {});
    assert.equal(rows.length, countOf(pair[1]), pair[0] + ' 图标数要和字典条目数一致');
    for (const k of rows) {
      ids.push(String(icons[pair[0]][k].id));
      /* 每颗图标还要带**"未获得"那一档**（原版 `<名字>1`，灰卡片 + 灰名字）：
       * `showWeaponSkills` 按 `has` 二选一挂（MainMovie.as:22050-22057）。少了它，
       * 没获得的格子只能退回"同一颗图标 + 灰阶滤镜"（用户 2026-10 口径就是要这一档）。 */
      assert.ok(icons[pair[0]][k].locked, pair[0] + ' ' + k + ' 缺 locked（名字 + "1" 那一颗）');
      ids.push(String(icons[pair[0]][k].locked));
    }
  }
  assert.equal(new Set(ids).size, ids.length, '两件武器/技能不能共用一个图标元件（共用 = 串位）');
}

/* ---------- 14. 挑战页「界面上第 i 行是谁」只许有一个口径 ----------
 * 用户 2026-10 报的："切换随机与好友界面之后，查看敌方与我方的数据全变成 1。"
 * 真因有两层：
 *   ① 好友页的 `current.roster` 是**整份名单**、界面只显示其中 4 行，而 `openFriendMenu` /
 *      `fightRow` 却按界面行号直接读 `roster[i]` —— 名字对得上、动作菜单与开战对象对不上；
 *   ② `foeRow` 给师父 / 徒弟补装备时传的是新造的 `{name, level}` 壳对象，
 *      返回的也是那个壳 → 三维全 `undefined`，落到 `|| 1` 就成了 1。
 * 这条钉住修法：取件只走 `foeAt()`，补装备要就地补（不许换对象）。
 *
 * ⚠ 下一轮（用户 2026-10"好友界面无法正常翻页"）在这里补了第二条契约：
 *   `foeAt` **只认 `current.rows`**（= 这一页显示的那 4 行，`fillRows` 已经按页偏移切过）。
 *   原来它多套了一层 `current.pageOff`，而 `showFriends` 交出来的 `roster` 又是**切过的 slice**
 *   —— 偏移两遍 → 第 2 页点第 1 行落到名单第 3 位（"点哪一行都对不上人"）。
 *   现在 `showFriends` 交**整份** roster、`fillRows` 拿 `slice`，`foeAt` 只读 rows。 */
{
  const ch = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/function foeAt\(/.test(ch), '挑战页必须有唯一的"第 i 行是谁"取件函数 foeAt()');
  const at = ch.slice(ch.indexOf('function foeAt('), ch.indexOf('function openFriendMenu('));
  assert.ok(/current\.rows/.test(at),
    'foeAt 只认 current.rows —— 那是 fillRows 按页偏移切好的"这一页显示的那 4 行"');
  assert.ok(!/current\.pageOff/.test(at),
    'foeAt 不许再叠 pageOff：fillRows 已经切过一刀，再加一次偏移就是"偏移两遍"（点哪行都对不上人）');
  for (const fn of ['function openFriendMenu(', 'function fightRow(', 'function selectRow(']) {
    const body = ch.slice(ch.indexOf(fn));
    const seg = body.slice(0, body.indexOf('\n  }') + 4);
    assert.ok(/foeAt\(/.test(seg), fn + ' 必须走 foeAt() 取对手（直接读 roster[i] 就会和界面行的数据错位）');
    assert.ok(!/roster\s*\[/.test(seg), fn + ' 不许再直接索引 roster（那正是"数据错位"的老写法）');
  }
  const fr = ch.slice(ch.indexOf('function foeRow('), ch.indexOf('const DUMMY ='));  /* 老写法：`State.ensureFriendLoadout({ name: src.name, level: lv })` 拿它当"补齐后的对象"用 ——
   * 那个壳里没有三维，落到 `|| 1` 全变 1。现在只有"老档缺三维"那一条兜底路径才会造壳，
   * 而且**用它自己**去补（不当作师徒原件）。 */
  assert.ok(/const full = \(State\.ensureFriendLoadout \? State\.ensureFriendLoadout\(src\) : src\) \|\| src;/.test(fr),
    'foeRow 给师父/徒弟补装备时要**就地**调 ensureFriendLoadout(src)（传新壳对象会把三维丢掉，显示成 1）');
  assert.ok(!/built\s*=/.test(fr),
    'foeRow 不许再留 `built` 那条"用新壳对象顶替原件"的老路（`Number(built.power) || 1` 就是全 1 的来源）');
  assert.ok(/weapons: \(full\.weapons \|\| \[\]\)\.slice\(\)/.test(fr) || /skills: \(full\.skills/.test(fr),
    'foeRow 要把 weapons / skills / gears 一起带出来（"查看"那一页要用）');
}

/* ---------- 15. 祭坛「当日双倍状态」必须落在**发奖励的那一处** ----------
 * 用户口径："接上原版建筑等级（…祭坛每日双倍状态、神迹随机属性点真的生效）。"
 * 原版 `getBufRewarTips`（MainMovie.as:4330）三种状态：经验竞技场双倍 / 碎片竞技场双倍 /
 * 关卡金松果双倍，几率 = 祭坛当前等级那一档（`buildingUpInfo`）。
 * 这里钉的是**一致性契约**：翻倍必须发生在"入账那一行"上，界面文案读同一个变量，
 * 否则会出现"显示双倍、账上没加"（或反过来）—— 那种 bug 肉眼看不出来、只有玩家对不上账。 */
{
  const ex = fs.readFileSync(path.join(ROOT, 'js/classic-extras.js'), 'utf8').replace(/\r\n/g, '\n');
  const fa = ex.slice(ex.indexOf('function fightArena('), ex.indexOf('let rankAttempt'));
  /* 翻倍要落在**入账之前**：经验入账在 `gainExpWithBoost` 内部（乘的是 `baseExp`），
   * 碎片入账在 `addProp(26, shards)`。这里按"翻倍那几行"逐条摆位置，别用整段的首次出现下标。 */
  assert.ok(/if \(baseExp && State\.activeBuildingBuff && State\.activeBuildingBuff\('arenaExp'\)\) \{[\s\S]{0,320}?baseExp \*= 2;/.test(fa),
    '竞技场经验要按祭坛当日状态掷双倍，而且乘的是 baseExp（原版 getBufRewarTips 的经验场那一档）');
  assert.ok(/if \(shards && State\.activeBuildingBuff && State\.activeBuildingBuff\('arenaProp'\)\) \{[\s\S]{0,320}?shards \*= 2;/.test(fa),
    '竞技场碎片同理（碎片场那一档）');
  /* ⚠ 用**带换行的正则**逐行匹配，别用 `indexOf`：注释里也提到了 `gainExpWithBoost(baseExp)`，
   * 直接找子串会命中注释、把"顺序"判反（本用例第一版就踩了这个）。 */
  assert.ok(/baseExp \*= 2;[\s\S]*?\n\s*const boosted = baseExp \? State\.gainExpWithBoost\(baseExp\)/.test(fa),
    '经验的翻倍要在 gainExpWithBoost 之前（入账在它内部，之后再乘就白算了）');
  assert.ok(/shards \*= 2;[\s\S]*?\n\s*if \(shards\) addProp\(26, shards\);/.test(fa),
    '碎片的翻倍必须在 addProp(26, shards) **之前**（之后翻倍就只改了文案、没进背包）');

  const st = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8').replace(/\r\n/g, '\n');
  const fsb = st.slice(st.indexOf('function finishStageBattle('), st.indexOf('function abandonStageRun('));
  const goldAt = fsb.indexOf('addGold(');
  assert.ok(/activeBuildingBuff\('stageGold'\)/.test(fsb) && fsb.indexOf("activeBuildingBuff('stageGold')") < goldAt,
    '关卡金松果的翻倍必须在 addGold() 之前（addGold 会按入账额记当日收益，翻倍得在它里面）');
  assert.ok(/goldBase: gold/.test(fsb) && /goldBuff: goldBuff/.test(fsb),
    '结算要同时回传"原值"与"是否翻倍"，战果弹窗才能写清楚为什么多了');
}

/* ---------- 16. 挑战页**动作菜单的分支表**：case 号不能拿"起点帧号"顶替 ----------
 * 用户口径：先是"点开测攻击木头人不应该出现加好友选项"，接着（下一轮）
 *   "查看界面中鼠标切换选项的时候，指针不在挑战Ta 上面，但是这个 ui 会异常亮起"。
 * 这两条是**同一个根因的两半**：原版 `seeFriend()`（MainMovie.as:23212-23257）
 *   **先把 `relation` 翻成 `actionType`**，再由 `myDraw()`（:22318-22357）的
 *   `switch (actionType)` 拨帧（`jiantou_WZ_Y2 + 0/19/5/14/10/25`）。
 * 复刻以前把两套编号混在一张表里（"徒弟 2 / 师父 5 / 陌生人 3 / 木人 6"），
 * **六档里错了四档** —— 菜单里那几行文与绿色高亮跟着 `subframe` 的帧走，
 * 于是"亮起来的那一行跟鼠标不在一条上"、菜单里的项跟对手也对不上。
 * 这里按 `seeFriend` 逐条钉死：好友 1 / 师父 2 / 徒弟 3 / 陪练 4 / 陌生人 5 / 木人 6。 */
{
  const ch = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  const mc = ch.slice(ch.indexOf('const MENU_CASE ='), ch.indexOf('const MENU_LAYOUT ='));
  assert.ok(/case REL\.dummy: return 6;/.test(mc), '木人（REL.dummy）必须走 myDraw 的 case 6');
  assert.ok(/case REL\.stranger: return 5;/.test(mc), '陌生人走 case 5（帧 11..14，seeFriend 里 relation 3 → actionType 5）');
  assert.ok(/case REL\.prentice: return 3;/.test(mc), '徒弟走 case 3（帧 6..9，relation 1 → actionType 3）');
  assert.ok(/case REL\.master: return 2;/.test(mc), '师父走 case 2（帧 20..24，relation 2 → actionType 2）');
  assert.ok(/default: return 1;/.test(mc), '好友（默认档）走 case 1（帧 1..4）');
  assert.ok(!/const MENU_BASE = \{/.test(ch),
    '不许退回"起点帧号当键"的 MENU_BASE 老写法（木人那一档会选不中 → 菜单变成陌生人）');
  /* 每档的 base 必须与 myDraw 的偏移一致：1 / 20 / 6 / 15 / 11 / 26。 */
  const ml = ch.slice(ch.indexOf('const MENU_LAYOUT ='), ch.indexOf('function menuHost'));
  for (const pair of [['1', '1'], ['2', '20'], ['3', '6'], ['4', '15'], ['5', '11'], ['6', '26']]) {
    assert.ok(new RegExp('\\b' + pair[0] + ': \\{ base: ' + pair[1] + '\\b').test(ml),
      'case ' + pair[0] + ' 的起始帧必须是 ' + pair[1] + '（myDraw 的 jiantou_WZ_Y2 + 偏移）');
  }
  const wAt = ml.indexOf('6: { base: 26');
  assert.ok(wAt > 0, '木人那一档要单独成表（case 6 / base 26）');
  const wooden = ml.slice(wAt, ml.indexOf('};', wAt));
  assert.ok(!/act: 'add'/.test(wooden), '木人菜单里**不许**有「加好友」（add）这一项');
  assert.ok(/act: 'fight'[\s\S]{0,200}act: 'record'[\s\S]{0,200}act: 'back'/.test(wooden),
    '木人菜单三项的语义顺序：测攻击（fight）/ 查看记录（record）/ 返回（back）');
  /* 木桩战斗：固定 10 回合 + 无限生命（原版 Stakes 不判死亡；maxRounds 全局是 60，
   * 60 回合对练习太长，按用户口径固定 10 回合）。 */
  assert.ok(/rounds: 10,/.test(ch) && /practice: true, practiceRounds: DUMMY\.rounds/.test(ch) &&
    /maxRounds: DUMMY\.rounds/.test(ch) && /collectDrops: false, skipChest: true/.test(ch),
    '木头人要走固定 10 回合 + 无限生命的训练口径（且不飘奖励、不开宝箱）');
  /* 关系标志：木人照原版拨第 3 帧（「邀请」那一档），不是自创的第 4 帧。 */
  const rf = ch.slice(ch.indexOf('function relationFrame('), ch.indexOf('const MENU_CASE'));
  assert.ok(!/rel === REL\.dummy\) return 4;/.test(rf),
    '木人标志不许自创第 4 帧（原版 relation==4 与 0/3/null 并列 gotoAndStop(3)）');
  assert.ok(/'4': 3/.test(ch), 'RELATION_BADGE 里 relation 4（木人）要映射到第 3 帧');
  /* 菜单一出生要把第 1 行的高亮摆上（原版 seeFriend 把 `jiantou_WZ_Y2` 置 1 再 myDraw），
   * 但**鼠标移开某一项之后不许再拨回第 1 行** —— 用户 2026-10 第一百五十九批口径：
   * "不要设 挑战ta 为默认选中，这会导致鼠标悬停在其它选项上时，那个选项会亮，而挑战ta会暗，
   *  但鼠标移开那个选项的时候，挑战ta又会亮，直接固定最后一个悬停的对象亮就行。"
   * 所以 `mouseleave` 里不再有 `menuSetFrame`，改成留住 `lastD`。 */
  const sf = ch.slice(ch.indexOf('async function showFriendMenu('), ch.indexOf('function menuMap('));
  assert.ok(/menuSetFrame\(sub, layout, lastD\);/.test(sf),
    '菜单打开时要先拨到"第 1 行被选中"那一帧（原版 seeFriend 进来 jiantou_WZ_Y2 = 1）');
  /* 原版没有主动拜师按钮（师父由服务端 relation 下发），经典好友菜单补一颗。 */
  assert.ok(/sf-master-btn/.test(sf) && /function askMaster\(foe\)/.test(ch),
    '经典好友动作菜单要提供主动拜师入口');
  assert.ok(/let lastD = 0;/.test(sf) && /b\.addEventListener\('mouseenter', \(\) => \{ lastD = d;/.test(sf),
    '悬停要记住最后那一行（lastD），供 mouseleave 之后留住高亮');
  assert.ok(!/mouseleave', \(\) => menuSetFrame/.test(sf),
    '鼠标移开**不许**把高亮拨回第 1 行（要留住最后悬停那一行）');
}

/* ---------- 17. 「查看装备」（对手那一页）必须真的有实现、且**不拆状态页** ----------
 * 用户口径（第一百五十六批）："在随机挑战界面查看敌人时，点开查看装备时会闪退，完善这个页面"。
 * 真根因：`ui-status.js` 的 `openFriendGears()` 里写的是
 *   `if (window.SfChallenge && SfChallenge.showFriendGears) { … }` + 兜底 `UI.runAction('challenge')`，
 * 而 `SfChallenge.showFriendGears` **当时根本不存在** —— 于是点「查看装备」= 状态页被
 * `destroy()`、挑战页重挂到随机页，装备一件看不到（看起来就像"闪退"）。
 * 这条同时钉住两件：① 挑战页必须导出 `showFriendGears`；② 状态页那条路**不许**先 destroy。 */
{
  const st = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/showFriendGears: \(\) =>/.test(st), 'SfStatus 必须导出 showFriendGears（在状态页上盖一层）');
  assert.ok(/function openFriendGearsOverlay\(/.test(st), '必须有 openFriendGearsOverlay() 画那一页');
  const ofg = st.slice(st.indexOf('function openFriendGears()'), st.indexOf('function openFriendGears()') + 400);
  assert.ok(!/destroy\(\)/.test(ofg),
    'openFriendGears 里**不许**再 destroy()（原版那一页的返回是回状态页，拆掉就回不去了）');
  const ch = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/showFriendGears: \(foe\) => showFriendGears\(foe\)/.test(ch),
    'SfChallenge 必须导出 showFriendGears（状态页那颗 b_change 的 4/5 帧调它）');
}

/* ---------- 18. `keepScreen` 战斗结束后 `mode` 必须拨回 home、canvas 必须切回主界面场景 ----------
 * 用户口径（第一百五十六批）："三侠的连战结算有问题，无法正常进行连战"。
 * 真根因：`mode` 只在 `showHome()` 里被重置，而 `keepScreen: true`（关卡连战 / 竞技场 /
 * 随机挑战都用它）**恰恰不调** `showHome()` —— 于是打完一场之后 `mode` 永远是 `'battle'`，
 * 下一场 `startBattle` 第一行的 `if (mode === 'battle') return;` 把它**静默吞掉**：
 * 连战第二场"点了没反应"、竞技场决赛同样打不起来。
 * 补充（2026-10 用户报到）："随机挑战战斗结束、弹奖励的时候背景还是战斗画面，应当是主界面" ——
 * 只拨 `mode` 还不够：`mode = 'home'` 不再重启主界面 canvas 循环，画面就冻在战斗终帧上；
 * 而现代模式的挑战页背景是透明的（`.classic-page` 只有顶部条带），冻帧直接透出来。
 * 所以这一支改成调 `startHomeScene()`（拨 mode + 重启循环，但**不**碰 `#ui`）。
 * 这条钉住两件：① keepScreen 收尾走 `startHomeScene()`；② 它内部确实拨 mode + 重启循环。 */
{
  const mn = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8').replace(/\r\n/g, '\n');
  const end = mn.slice(mn.indexOf('onEnd: (winner, result, loot'), mn.indexOf('onError: () => {'));
  assert.ok(/if \(!opts\.keepScreen\) showHome\(\);\s*\n\s*else startHomeScene\(\);/.test(end),
    'keepScreen（连战 / 竞技场 / 随机挑战）收尾必须 `else startHomeScene()`：不换 #ui 里的页面，' +
    '但 mode 拨回 home、canvas 切回主界面场景');
  const i = mn.indexOf('function startHomeScene()');
  const scene = mn.slice(i, mn.indexOf('function showHome() {', i));
  assert.ok(/mode = 'home';/.test(scene) && /cancelAnimationFrame\(rafId\)/.test(scene) && /requestAnimationFrame\(loop\)/.test(scene),
    'startHomeScene 必须把 mode 置回 home 并重启主界面循环，否则下一场 startBattle 直接 return、打完背景停在战斗终帧');
}

/* ---------- 19. 文本字段索引：改文案前先查表，别靠开浏览器量 ----------
 * 2026-10 那一批最贵的一类错误是"文字放不下"，而且**只在像素上看得见** ——
 * `info1` 按 10 个字硬断（实际一行 15~17 个字符）、`harm` 是 54.5 宽（一行只 4 个全角字）
 * 却塞进 14 个字、`expNum` 宽 95.2 恰好装得下占位串 "999999/999999" 所以一直没人发现。
 * 这三处的答案都是**纯静态数据**算得出来的，索引就是为此而生。
 * 这条钉住：① 索引存在且带框宽/每行字数；② 生成器必须读 `textfields.json`
 * （少了它整张表就只剩字号，等于没写）；③ 本轮那几个关键字段的框宽与实测一致。 */
{
  const gen = fs.readFileSync(path.join(ROOT, 'tools/gen-ssfight-ui.cjs'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/TEXT_FIELDS_FILE/.test(gen) && /gen-ssfight-textfields\.cjs/.test(gen),
    '生成器要读 textfields.json（框宽的唯一来源），并在读不到时明确报警');
  assert.ok(/textfields-index\.json/.test(gen), '生成器要产出 textfields-index.json');
  assert.ok(/symbol-index\.json/.test(gen), '生成器要产出 symbol-index.json（view.byName 的寻址面）');
  const tiFile = path.join(ROOT, 'images/ssfight/ui/textfields-index.json');
  if (!fs.existsSync(tiFile)) {
    console.log('SKIP 文本字段索引未生成（先跑 node tools/gen-ssfight-ui.cjs）');
  } else {
    const ti = JSON.parse(fs.readFileSync(tiFile, 'utf8'));
    assert.ok(ti.fields.length > 100, '文本字段索引应当覆盖量级在百条以上（实测 176 条）');
    /* 框宽与每行字数：这几条是 2026-10 逐像素量过的，索引必须复现它们 */
    const expect = {
      4730: { boxW: 129, charsPerLine: 10 },      // 关卡确认页 info1
      4727: { boxW: 171.25, charsPerLine: 14 },   // 关卡确认页 info2
      4541: { boxW: 150, charsPerLine: 12 },      // 武器/技能详情 des
      4543: { boxW: 54.5, charsPerLine: 4 },      // 武器/技能详情 harm
      7182: { boxW: 95.2, charsPerLine: 6 },      // 状态页 expNum
      7276: { boxW: 273.75, charsPerLine: 22 },   // 关卡说明 desc
    };
    for (const [id, want] of Object.entries(expect)) {
      const r = ti.fields.find((f) => f.id === id);
      assert.ok(r, '文本字段索引里应当有字段 ' + id);
      assert.equal(r.boxW, want.boxW, id + ' 的框宽要与实测一致（索引错一位，断行就会跟着错）');
      assert.equal(r.charsPerLine, want.charsPerLine,
        id + ' 的"每行几个全角字"要与框宽/字号算出来的一致');
    }
    /* 反过来也要能查：给一个实例名，指得到字段 */
    const info1 = ti.fields.find((f) => f.heldBy.some((h) => h.endsWith('.info1')));
    assert.ok(info1 && info1.id === '4730', '索引要能从实例名 info1 反查到字段 4730');
  }
  const siFile = path.join(ROOT, 'images/ssfight/ui/symbol-index.json');
  if (fs.existsSync(siFile)) {
    const si = JSON.parse(fs.readFileSync(siFile, 'utf8'));
    const st = si.bundles && si.bundles.status && si.bundles.status.names;
    assert.ok(st && st.des && st.des.owner === '4673',
      'symbol-index 里 des 要挂在 4673 上（武器/技能详情那一颗）');
    assert.ok(st && st.expNum && st.expNum.owner === '7218',
      'symbol-index 里 expNum 要挂在状态页根 7218 上');
    assert.ok(st && st['mc_tab1'] && st['mc_tab1'].owner === '4673',
      'symbol-index 里 mc_tab1 要挂在 4673 上（好友装备那一页的四个格子）');
  }
}

/* ---------- 20. 换 tab 后立即有真值、反馈壳与命中对象保持同一棵树 ----------
 * 运行真实 renderer / toolkit / status 与仓库素材；最小 DOM 只替代布局和事件原语，
 * 不模拟 showFrame、路由或填值逻辑。计时器不推进，防止一秒刷新掩盖切页初值错误。 */
async function checkClassicViewLifecycle() {
  class Node {
    constructor(tag) {
      this.tagName = tag; this.nodeType = 1; this.childNodes = []; this.parentNode = null;
      this.attrs = {}; this.style = {}; this.events = {}; this._text = '';
      this.classList = {
        add: (...v) => { const s = new Set((this.attrs.class || '').split(/\s+/).filter(Boolean)); v.forEach(x => s.add(x)); this.attrs.class = [...s].join(' '); },
        remove: (...v) => { this.attrs.class = (this.attrs.class || '').split(/\s+/).filter(x => !v.includes(x)).join(' '); },
        contains: v => (this.attrs.class || '').split(/\s+/).includes(v),
        toggle: (v, force) => {
          const on = force == null ? !this.classList.contains(v) : !!force;
          this.classList[on ? 'add' : 'remove'](v); return on;
        },
      };
    }
    get firstChild() { return this.childNodes[0] || null; }
    get children() { return this.childNodes; }
    get nextSibling() { if (!this.parentNode) return null; return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null; }
    get isConnected() { return this.tagName === 'body' || !!(this.parentNode && this.parentNode.isConnected); }
    get ownerSVGElement() { for (let n = this.parentNode; n; n = n.parentNode) if (n.tagName === 'svg') return n; return null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    setAttributeNS(ns, k, v) { this.setAttribute(k, v); }
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(n) { return this.insertBefore(n, null); }
    insertBefore(n, before) {
      if (n === before) return n;
      if (n.parentNode) n.parentNode.removeChild(n);
      const i = before ? this.childNodes.indexOf(before) : -1;
      if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
      n.parentNode = this; return n;
    }
    removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    set textContent(v) { for (const n of [...this.childNodes]) this.removeChild(n); this._text = String(v); }
    get textContent() { return this._text + this.childNodes.map(n => n.textContent).join(''); }
    querySelectorAll(sel) {
      const direct = sel.startsWith(':scope > '); sel = sel.replace(/^:scope > /, '');
      const match = n => {
        if (sel.startsWith('#')) return n.getAttribute('id') === sel.slice(1).replace(/\\/g, '');
        const m = /^([\w-]+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(sel);
        return !!m && (!m[1] || n.tagName === m[1]) && (!m[2] || n.classList.contains(m[2])) &&
          (!m[3] || (m[4] == null ? n.getAttribute(m[3]) != null : n.getAttribute(m[3]) === m[4]));
      };
      const out = []; const visit = n => { for (const c of n.childNodes) { if (match(c)) out.push(c); if (!direct) visit(c); } };
      visit(this); return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    dispatchEvent(ev) { ev.target ||= this; for (const fn of this.events[ev.type] || []) fn(ev); return true; }
    getBBox() {
      if (this.style.display === 'none' || this.tagName === 'defs') return { x: 0, y: 0, width: 0, height: 0 };
      if (this.tagName === 'rect') return { x: Number(this.attrs.x) || 0, y: Number(this.attrs.y) || 0,
        width: Number(this.attrs.width) || 0, height: Number(this.attrs.height) || 0 };
      if (this.tagName === 'path' || this.tagName === 'text') return { x: 0, y: 0, width: 10, height: 10 };
      // 叶子画稿只需固定尺寸；透明hit的真实x/y/w/h必须参与并集，才能揭露重复外扩。
      const boxes = this.childNodes.map(n => n.getBBox()).filter(b => b.width && b.height);
      if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
      const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
      return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x,
        height: Math.max(...boxes.map(b => b.y + b.height)) - y };
    }
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 320, height: 196 }; }
    getScreenCTM() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  }
  const body = new Node('body'), timers = new Map(), timeouts = new Set(); let timerSeq = 0;
  const state = { name: '回归松鼠', level: 21, exp: 7, dailyWins: 2, dailyFails: 1, allWins: 12, allFails: 3 };
  const env = {
    console, document: { createElementNS: (ns, tag) => new Node(tag), createElement: tag => new Node(tag) },
    CSS: { escape: s => String(s) },
    MouseEvent: class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } stopPropagation() {} },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, url), 'utf8')) }),
    setInterval: fn => { const id = ++timerSeq; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id),
    setTimeout: fn => { const id = ++timerSeq; timers.set(id, fn); timeouts.add(id); return id; },
    clearTimeout: id => { timers.delete(id); timeouts.delete(id); },
    State: { state: () => state, totalStats: () => ({ power: 12, agility: 34, speed: 56, hp: 789 }), myGears: () => [] },
    GData: { nextExp: () => 100 }, UI: { classic: { catalogInfo: () => ({ page: 0, pages: 1, items: [] }) } }, __errs: [],
  };
  env.window = env; vm.createContext(env);
  for (const file of ['render.js', 'ui-main.js', 'ui-status.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ssfight', file), 'utf8'), env);
  const render = env.SfRender, toolkit = env.SfUiMain.toolkit;

  // 祖先接管已注册子项后，公开列表与实际命中必须相同；重复注册不能重开原生事件。
  const svg = body.appendChild(new Node('svg'));
  const routed = (id, x, w, parent) => {
    const g = svg.appendChild(new Node('g'));
    return { tag: { id }, parent, g, __hitBox: { x, y: 0, w, h: 100 } };
  };
  const parent = routed('parent', 0, 100), child = routed('child', 10, 10, parent), next = routed('next', 200, 100);
  toolkit.registerHit(child); toolkit.registerHit(parent); toolkit.registerHit(next);
  const router = toolkit.routerOf(svg);
  assert.equal(router.hit(60, 50).clip, parent, '祖先接管后应命中祖先，不能仍查被替换的旧数组');
  assert.equal(router.hit(260, 50).clip, next, '接管后新注册的按钮必须能被命中');
  parent.g.style.pointerEvents = 'auto'; toolkit.registerHit(parent);
  assert.equal(parent.g.style.pointerEvents, 'none', '每次注册都关闭原生事件，不能因已有路由项而早返漏设');

  // 用真实两帧格子换帧，壳保持稳定；附件始终位于时间轴卡底之上。
  await render.loadExtra('tags-status.json');
  const host = body.appendChild(new Node('section'));
  const cell = await render.mountSymbol(host, '3636', { policy: {} });
  const shell = cell.g.appendChild(new Node('g')); shell.classList.add('uc-pop', 'sf-hover');
  for (const rec of cell.nodes.values()) shell.appendChild(rec.wrap || rec.node);
  cell.setContentHost(shell);
  const icon = cell.attachChild('3636', 1, 'icon');
  cell.gotoAndStop(2); cell.gotoAndStop(1);
  assert.equal(cell.getContentHost(), shell, '换帧不能更换或遗失反馈壳');
  const targets = [...cell.nodes.values()].map(rec => rec.wrap || rec.node);
  assert.ok(targets.every(n => n.parentNode === shell), '换帧后所有帧画稿仍在反馈壳内');
  assert.equal(shell.childNodes[shell.childNodes.length - 1], icon.g, '高depth附件不能被重新追加的卡底盖住');
  toolkit.popWrap(cell);
  const hitSize = () => { const h = cell.g.querySelector('[data-hit]'); return [h.getAttribute('width'), h.getAttribute('height')]; };
  const firstHitSize = hitSize();
  for (let i = 0; i < 20; i++) toolkit.popWrap(cell);
  assert.deepEqual(hitSize(), firstHitSize, '反复悬停/重包不能把上次热区再次当画稿扩张');
  cell.setSymbol('3156', 1);
  assert.equal(cell.getContentHost(), shell, '换元件路径也必须保留有效内容宿主');
  assert.ok([...cell.nodes.values()].every(rec => (rec.wrap || rec.node).parentNode === shell), '新元件画稿仍须进入原反馈壳');
  shell.remove(); assert.equal(cell.getContentHost(), cell.g, '已摘除的壳不应再接收新画稿');
  cell.destroy();

  // 调用实际 tab click，随后立即检查数字；不允许依赖一秒 timer 才修正初值。
  const statusHost = body.appendChild(new Node('section'));
  assert.equal(await env.SfStatus.open(statusHost), true);
  const view = env.SfStatus.view();
  const meter = view.byName('expMc'), meterShell = meter.g.appendChild(new Node('g'));
  for (const rec of meter.nodes.values()) meterShell.appendChild(rec.wrap || rec.node);
  meter.setContentHost(meterShell); meter.gotoAndStop(42);
  assert.equal(meter.__clipHost.parentNode, meter.g, '蒙版defs不能跟随反馈壳变换');
  assert.ok([...meter.nodes.values()].every(rec => (rec.wrap || rec.node).parentNode === meterShell), '被蒙版裁剪的帧层整体留在内容宿主');
  const digits = () => ['power', 'agility', 'speed', 'hp'].map(name => {
    const clip = view.byName(name); return [1, 2, 3, 4].map(i => clip.byName('num' + i).frame);
  });
  const initial = digits();
  env.UI.classic.catalogInfo = () => ({ page: 0, pages: 1, items: [
    { id: 1, name: '徒手', icon: '2139', has: true, level: 1, selected: false, trueForm: false },
  ] });
  view.byName('tab1').g.dispatchEvent(new env.MouseEvent('click'));
  assert.equal(env.SfStatus.current().tab, 'weapons');
  const gridCell = view.byName('c1'), gridShell = gridCell.getContentHost(), gridIcon = gridCell.__attached[0];
  gridCell.g.dispatchEvent(new env.MouseEvent('mouseenter'));
  assert.equal(gridIcon.frame, 1, '悬停应进入真实图标选中帧');
  assert.equal(gridCell.getContentHost(), gridShell, '悬停拨图标帧不能破坏格子的反馈壳');
  assert.equal(gridIcon.g.parentNode, gridShell, '悬停后图标仍位于反馈壳内');
  assert.equal(gridShell.childNodes[gridShell.childNodes.length - 1], gridIcon.g, '悬停后图标仍在卡底之上');
  gridCell.g.dispatchEvent(new env.MouseEvent('mouseleave'));
  assert.equal(gridIcon.frame, 0, '离开应同步回到真实常态帧');
  view.byName('tab').g.dispatchEvent(new env.MouseEvent('click'));
  assert.equal(env.SfStatus.current().tab, 'status');
  assert.deepEqual(digits(), initial, '返回状态必须在当前事件内填好四维，不能先露0000再等下一秒刷新');
  assert.equal(view.byName('expNum').textContent, '7/100', '经验也必须同步恢复真值');
  assert.deepEqual(env.__errs, [], '真实挂载和接线不能靠吞异常通过');
  /* 装备画稿是灰阶 + 放置上的 `cx` 颜色变换（`p.cx` 直接就是 Rm/Ra/...，没有 `p.cx.cx` 这一层）。
   * 以前只认 `p.cx.cx`，彩色套装全被画成黑白；这里用狂战头盔 1919 第 71 帧钉住这条路径。 */
  await render.loadExtra('tags-gear.json');
  const gearHost = body.appendChild(new Node('section'));
  const gearView = await render.mountSymbol(gearHost, '1919', { frame: 71, policy: {} });
  assert.ok(gearView.root.querySelector('filter'), '装备放置上的 cx 必须落成 SVG filter（否则彩色套装变黑白）');
  assert.ok(gearView.root.querySelectorAll('[filter]').length > 0, '带 cx 的放置节点要真的挂上 filter');
  gearView.destroy(); gearHost.remove();
  env.SfStatus.destroy();
  return { env, Node, body, flushTimeouts: () => {
    for (const id of [...timeouts]) { const fn = timers.get(id); timers.delete(id); timeouts.delete(id); if (fn) fn(); }
  } };
}

/* ---------- 21. 首次并发加载只能合并到同一个素材库，失败后允许重试 ---------- */
async function checkConcurrentAssetLoad() {
  const requests = [], env = { window: {}, console,
    fetch: url => new Promise(resolve => requests.push({ url, resolve })),
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ssfight/render.js'), 'utf8'), env);
  const render = env.window.SfRender;
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const respond = (request, value, ok = true) => request.resolve({ ok, json: async () => value });
  const a = render.loadExtra('a.json'), sameA = render.loadExtra('a.json'), b = render.loadExtra('b.json');
  assert.equal(requests.length, 3, '首次并发请求只能共用一组timeline/tags/textfields，不能建立多个Map互相覆盖');
  for (const request of requests.slice()) respond(request,
    request.url.endsWith('tags.json') ? [{ id: 'base', tp: 2 }] : {});
  await flush();
  assert.equal(requests.filter(r => r.url.endsWith('a.json')).length, 1, '相同extra包的在途请求也应合并');
  respond(requests.find(r => r.url.endsWith('a.json')), [{ id: 'A', tp: 39, Sf: [] }]);
  const bundleA = await a; await sameA;
  respond(requests.find(r => r.url.endsWith('b.json')), [{ id: 'B', tp: 39, Sf: [] }]);
  const bundleB = await b;
  assert.equal(bundleA, bundleB, '后完成的基础加载不能换掉先前已完成的extra素材库');
  assert.ok((await render.load()).hash.has('A') && bundleB.hash.has('B'), '两个已成功包必须同时可被mount查到');

  const failed = render.loadExtra('retry.json');
  const rejection = assert.rejects(failed, /素材包缺失/);
  await flush(); respond(requests.find(r => r.url.endsWith('retry.json')), null, false); await rejection;
  const retry = render.loadExtra('retry.json'); await flush();
  const retryRequests = requests.filter(r => r.url.endsWith('retry.json'));
  assert.equal(retryRequests.length, 2, '失败Promise不能永久卡住素材包重试');
  respond(retryRequests[1], [{ id: 'retry', tp: 39, Sf: [] }]);
  assert.ok((await retry).hash.has('retry'));
}

/* ---------- 22. 共用反馈：快速重入只提交一次，离页作废，取消按压不残留 ---------- */
function checkSharedFeedbackLifecycle() {
  let now = 0, nextId = 0;
  const timers = new Map();
  const env = { window: {},
    setTimeout: (run, delay) => { const id = ++nextId; timers.set(id, { run, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].run();
    }
    now = end;
  };
  const node = () => {
    const classes = new Set(), events = {};
    return { isConnected: true,
      classList: { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)),
        contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
      addEventListener: (type, run) => (events[type] ||= []).push(run),
      emit: type => (events[type] || []).forEach(run => run({ button: 0 })),
      getAttribute: () => null, getBoundingClientRect: () => ({}),
    };
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-feedback.js'), 'utf8'), env);
  const feedback = env.window.SfUiFeedback, card = node();
  feedback.bind(card);
  card.emit('pointerdown');
  assert.ok(card.classList.contains('pressed'), '真实pointerdown监听应给卡片按下反馈');
  card.emit('pointercancel');
  assert.ok(!card.classList.contains('pressed'), 'pointercancel必须立即清掉按下态');
  let commits = 0;
  assert.equal(feedback.tap(card, () => commits++, { delay: 160 }), true);
  assert.equal(feedback.tap(card, () => { commits += 10; }, { delay: 160 }), false, '同一节点快速重入不能排第二次提交');
  advance(159); assert.equal(commits, 0, '反馈延时结束前不应提前切页');
  advance(1); assert.equal(commits, 1, '快速重入仍只提交首次动作一次');
  const leavingCard = node(); feedback.bind(leavingCard);
  feedback.tap(leavingCard, () => commits++, { delay: 160 });
  leavingCard.isConnected = false;
  advance(160);
  assert.equal(commits, 1, '节点脱树离页后，旧延时回调不得再触发导航或提交');
}

/* ---------- 23. 挑战页三条口径 + 详情页两处素材契约（2026-10 第一百六十批）----------
 * 用户口径：① 好友界面打人**不扣体力、不结算经验/金松果/掉落**；② 关卡门卡**只在没打完时才写
 * 「继续挑战」**（照 ssfight：一级页只有 1/3 两档，第 2 帧属于**六级页**的 `keep == "true"`）；
 * ③ 武器/技能详情页的武器页与技能页是**同一元件的两帧**，技能那一格写死「技能」两个字。
 * 这三条都只落在页面的分支里（`State` 那侧没有可断言的返回值），所以按本文件 §14/§16 的老办法
 * 对**源码契约**下断言 —— 帧号与选帧规则一旦被改回去，这里立刻红。 */
{
  const ch = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  /* ① 好友页那一档：零消耗零结算；随机页仍是 10 体力 + 掉落 + 奖励。 */
  const sf = ch.slice(ch.indexOf('function startFight('), ch.indexOf('function showTab('));
  assert.ok(/const friend = kind === 'friend';/.test(sf) && /cost: friend \? 0 : 10/.test(sf)
    && /useProps: !friend/.test(sf) && /collectDrops: !friend/.test(sf),
    '好友切磋那一档必须 cost:0 / 不吃药品 / 不飘掉落（随机挑战仍是 10 体力那一档）');
  const fr = ch.slice(ch.indexOf('function fightRow('), ch.indexOf('function startDummyFight('));
  assert.ok(/current\.tab === 'friends'\) \? 'friend' : 'challenge'/.test(fr),
    '「好友页打人 = 切磋、随机页 = 主动挑战」按当前 tab 分档');
  /* ② 门卡（一级页）只有"可打 / 锁定"，第 2 帧留给六级页的 stageRun。 */
  const gs = ch.slice(ch.indexOf('function gateState('), ch.indexOf('function showGates('));
  assert.ok(!/running/.test(gs) && /return open \? 'open' : 'locked';/.test(gs),
    '一级页门卡不该再有"本轮进行中"这一档（原版 showGate 只用第 1/3 帧）');
  const og = ch.slice(ch.indexOf('async function openGate('), ch.indexOf('async function openGateConfirm('));
  assert.ok(/State\.stageRun\(id\) \? 2 : \(State\.stageAccess\(id\)\.ok \? 1 : 3\)/.test(og),
    '六级页六颗星：在途一轮（= 原版 keep）→ 2「继续挑战」/ 可打 → 1 / 其余 → 3');
  /* ③ 详情页：按 kind 选帧 + 技能那一格写死「技能」。 */
  const st = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/frame: isW \? 1 : 2, label: '武器技能详情'/.test(st),
    '技能页必须挂 4673 的第 2 帧（第 1 帧是「武器详情」+「升级武器」）');
  assert.ok(/set\('levelText', String\(ownLv > 10 \? ownLv - 10 : ownLv\)\)/.test(st),
    '等级那一格必须写回（真形态按 level-10，与格子里那行 LV 同一把尺子）');
  assert.ok(/\? \(own \? \(own\.harmLo \+ '-' \+ own\.harmHi\) : \(base && base\.harm \? base\.harm : ''\)\)\s*\n\s*: '技能';/.test(st),
    '技能那一格是原版写死的「技能」两个字，不是技能说明');
  const mic = st.slice(st.indexOf('async function mountDetailIconClip('), st.indexOf('function wrapToField('));
  assert.ok(mic.length > 200 && !/\.style\.transform/.test(mic),
    '详情页图标不许再叠 scale/translate 那一套（会把卡片推低约 18 个舞台单位、贴图缺上部）');
  assert.ok(/viewBox: '0 -2 320 198'/.test(mic),
    '详情页图标视口要留 2 单位上边距（卡片上沿的星芒画在 y≈-1.7，0 起算会被平切一块）');
  /* 真化名字「真.死神镰刀」= 5.55 字宽，字段按 floor(75.6/13)=5 硬断会把「刀」挤到第二行。
   * 名字必须单行写（超过框宽才缩字号），不能再走 `setWrapped`。 */
  assert.ok(/setDetailName\(view\.byName\('name'\), shownName\)/.test(st)
    && !/setWrapped\(view\.byName\('name'\), shownName\)/.test(st)
    && /function setDetailName\(clip, text\)/.test(st),
    '详情页名字要单行写：真化名字最后一个字不能被断到第二行');
  /* 2026-10-19 口径：「返回」与「升级武器 / 升级技能」**默认是灰的（子键 f1 米白）、
   * 鼠标悬停才变绿（f2）** —— 接线统一走 `wireClickable`（它自带 `.uc-pop` 壳：悬停缩放
   * + 暖光、按下回弹）；只有不可升级 / 满级那一档才停 f3 深灰、不可点。 */
  assert.ok(/wireClickable\(backBtn, \{\s*idle: 1, hover: 2,/.test(st)
    && /wireClickable\(okBtn, \{\s*idle: 1, hover: 2,/.test(st)
    && /stopAt\(okBtn, 3\);\s*\n\s*okBtn\.g\.style\.cursor = 'default';/.test(st),
    '详情页返回/升级键：默认灰、悬停变绿（wireClickable idle:1/hover:2）；不可升级档才停 f3 深灰');
  assert.ok(/function weaponSpecialText\(base\)/.test(st)
    && /特殊效果：' \+ weaponSpecial/.test(st) && /weaponSpecialText\(base\)/.test(st),
    '武器真化详情要在「下一阶增加伤害」那行补特殊效果介绍');
}

/* ---------- 24. 两处"鼠标悬停就该有反应"的口径（2026-10 第一百六十一批）----------
 * 用户口径：① 挑战页"选择敌人高亮的绿条要随鼠标移动而移动、右侧的敌人显示也跟着变"；
 * ② 武器/技能页"悬停**未解锁**的那一格也要显示名称，**方案与已解锁一致**、只是字体是同色灰色"。
 * 两处都只落在页面的监听/选帧里，所以照 §23 的老办法对**源码契约**下断言。 */
{
  const chLf = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  /* ① `wireClickable` 的 mouseenter 必须跑到 `onHover` 回调（挑战页行选中就靠它），
   *   且行/拳套卡都要挂同一个回调。 */
  const wc = chLf.slice(chLf.indexOf('function wireClickable('), chLf.indexOf('function resetHits('));
  assert.ok(/clip\.__chHoverCb = spec\.onHover \|\| null;/.test(wc) && /if \(clip\.__chHoverCb\) clip\.__chHoverCb\(\);/.test(wc),
    'wireClickable 要支持 onHover（鼠标一进来就回调），否则行列只能靠点击切换');
  const fr = chLf.slice(chLf.indexOf('function fillRows('), chLf.indexOf('function selectRow('));
  assert.ok(/onHover: hoverSelect/.test(fr) && /const hoverSelect = \(\) =>/.test(fr) && /selectRow\(idx\)/.test(fr),
    '挑战页每一行（含拳套卡）悬停都要 selectRow —— 绿条与右侧立绘一起跟着鼠标走');
  const sr = chLf.slice(chLf.indexOf('function selectRow('), chLf.indexOf('function fightRow('));
  assert.ok(/refreshShell\(row\)/.test(sr), 'selectRow 换行帧之后要补回反馈壳（换帧会重建子节点）');
  /* ② 未解锁那一档必须挂**原版另一颗元件**（名字 + "1"），并且和已获得走同一条选帧路径
   *   （`setCellLook` 不许再对 `!has` 早退）；那条 DOM 名字条要彻底不在了。 */
  const st = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  const scl = st.slice(st.indexOf('function setCellLook('), st.indexOf('function paintIconLabel('));
  assert.ok(/if \(!cell \|\| !it\) return false;/.test(scl) && !/!it\.has/.test(scl),
    'setCellLook 必须对"未获得"也生效（两档共用同一套显示方案）');
  const pc = st.slice(st.indexOf('function paintCell('), st.indexOf('function raiseAttached('));
  assert.ok(/cell\.attachChild\(it\.has \? it\.icon : it\.lockedIcon/.test(pc),
    '未获得的那一格要挂 lockedIcon（原版 names + "1"），不是同一颗图标加灰阶滤镜');
  assert.ok(!/function (showCellName|hideCellName|cellHost)\(/.test(st),
    'DOM 名字条那一套函数（showCellName / hideCellName / cellHost）要删掉 —— 名字一律走原版矢量层');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(!/\.sf-cellname/.test(css), 'CSS 里的 .sf-cellname 也要一并删掉');
  /* 图标表与素材包：`locked` 那一批必须真的提取出来了。 */
  const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/weapon-skill-icons.json'), 'utf8'));
  const lockedIds = [];
  for (const kind of ['weapon', 'skill']) for (const k of Object.keys(icons[kind] || {})) lockedIds.push(String(icons[kind][k].locked));
  const wsicon = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/tags-wsicon.json'), 'utf8'));
  const have = new Set(wsicon.map((t) => String(t.id)));
  const miss = lockedIds.filter((id) => id !== 'undefined' && !have.has(id));
  assert.equal(miss.length, 0, 'tags-wsicon.json 里缺"未获得"那一档元件：' + miss.slice(0, 6).join(','));
}

/* ---------- 25. 原版战果容器承接四条续战路径，一次点击只提交一次 ---------- */
async function checkFightResults({ env, Node, body, flushTimeouts }) {
  const ui = body.appendChild(new Node('main')); ui.setAttribute('id', 'ui');
  env.document.getElementById = id => body.querySelector('#' + id);
  let prompts = 0, commits = 0;
  env.UI.classic.promptLevelUpChoices = () => prompts++;
  for (const file of ['ui-feedback.js', 'ui-fight-result.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ssfight', file), 'utf8'), env);
  const roots = { arena: '3822', rank: '3776', stage: '4839', result: '4692' };
  for (const [kind, symbol] of Object.entries(roots)) {
    const opened = await env.SfFightResult.open({ kind, win: true, neutral: kind === 'arena', title: '真实战果',
      player: { name: '测试玩家', level: 35 }, foe: { name: '下一场对手', level: 37 },
      text: kind === 'result' ? Array.from({ length: 11 }, (_, i) => '奖励第' + (i + 1) + '项').join('\n') :
        '经验 +75\n金松果 +0\n下一场不重复扣费', actions: [{ label: '继续挑战', run: () => commits++ }] });
    assert.equal(String(opened.view.tag.id), symbol, kind + ' 必须使用原版容器');
    if (kind === 'stage') {
      assert.equal(opened.view.frame, 6, '关卡战况停入场终态，不能把首帧离屏画稿当成空底板');
      assert.ok(opened.view.byName('info'), '关卡终态应具备原信息区');
    }
    if (kind === 'arena') {
      assert.equal(opened.view.byName('name1').textContent, '测试玩家');
      assert.equal(opened.view.byName('level2').textContent, '37');
      assert.equal(opened.view.byName('title').g.style.display, 'none', '未打完的半决赛使用中性标题，不能提前宣告获胜');
    }
    assert.equal(opened.choose(-1), false, '非法索引不能关闭战果页');
    if (kind === 'result') {
      const more = opened.view.root.querySelector('text[role="button"]');
      assert.ok(more, '较长奖励必须有翻页入口');
      more.dispatchEvent(new env.MouseEvent('click')); more.dispatchEvent(new env.MouseEvent('click'));
      assert.ok(opened.view.root.textContent.includes('奖励第11项'), '尾页奖励仍可阅读，不能为适应原版面板而丢弃');
    }
    const action = opened.view.__attached.find(c => c.g.getAttribute('attach-name') === 'result-action-0');
    assert.ok(action, '必须使用真实原版空按钮接入业务动作');
    const before = commits;
    action.g.dispatchEvent(new env.MouseEvent('click'));
    action.g.dispatchEvent(new env.MouseEvent('click'));
    flushTimeouts();
    assert.equal(commits, before + 1, '连点同一续战按钮只能提交一次');
    assert.equal(opened.host.isConnected, false, '续战前销毁自己的战果层');
    assert.equal(opened.choose(0), false, '关闭后的旧回调不能再次提交');
  }
  const previous = await env.SfFightResult.open({ kind: 'rank', text: '旧战果' });
  let resumed = 0;
  const latest = await env.SfFightResult.open({ kind: 'stage', text: '新战果', actions: [
    { label: '结束本轮', run: () => { throw new Error('取消不得结束挑战进度'); } },
    { label: '继续本轮', dismiss: true, run: () => resumed++ },
  ] });
  previous.close();
  assert.ok(latest.host.isConnected, '旧层的close不能关闭新结果');
  assert.equal(env.SfFightResult.dismiss(), true);
  assert.equal(resumed, 1, '取消结束确认要回到原进度，不能触发结束或立即开战');
  assert.equal(env.SfFightResult.isOpen(), false);
  assert.equal(prompts, 6, '战果层沿用升级奖励选择入口');
  assert.equal(env.SfRender.viewCount(), 0, '战果退出后回收播放注册');

  /* 有奖励的普通战果走**原版 `fight` 第 2/3 帧**（经验 + 金松果/战利品三格），
   * 不再把"经验 +X 金松果 +Y"拼成文字塞进 4692 提示框。 */
  const reward = await env.SfFightResult.open({ kind: 'result', win: true, title: '战斗胜利',
    exp: 120, gold: 25, note: '复仇成功', items: [{ id: 24, name: '白色碎片', count: 3 }],
    actions: [{ label: '确定', dismiss: true, run: () => {} }] });
  assert.equal(String(reward.view.tag.id), '7772', '有奖励的战果必须使用原版 fight 战果页');
  assert.equal(reward.view.frame, 1, '胜利停第 2 帧（0 基 = 1）');
  assert.equal(reward.view.byName('maxlevel').frame, 3, 'maxlevel 拨到第 4 帧，不能显示素材里烤死的文案');
  assert.equal(reward.view.byName('getExp').frame, 0, '有经验时 getExp 停第 1 帧');
  assert.equal((reward.view.byName('c1').__attached || []).length, 1, '金松果要占第一格并用原版图标');
  assert.equal((reward.view.byName('c2').__attached || []).length, 1, '战利品要占第二格并用原版图标');
  reward.choose(0);
  assert.equal(reward.host.isConnected, false, '战果动作提交后回收整层');
  assert.equal(env.SfRender.viewCount(), 0, '原版战果页退出后回收播放注册');
}

/* ---------- 24. 位图 HD 覆盖接线（2026-10 第一百六十六批）：有 `.hd` 的位图不许残留 1x 引用 ----------
 * 生成器（gen-ssfight-ui.cjs）在 `bitmap/<原名>.hd.jpg|.hd.png` 存在时会把页包里的
 * `Fs[].image.xlink:href` 全改指 HD 版。这条钉住两种静默退化：重跑生成器时忘了带 .hd 文件
 * （引用全部指回 1x）、或手工把某处改了回去 —— 帧数据里只是文件名字符串，指回 1x 不报错、只是糊。
 * 第一百六十八批起再加一条：有 `.hd` 的位图不再落 1x（原件归档在 references/.bak-upscale/）。 */
{
  const dir = path.join(ROOT, 'images', 'ssfight', 'ui');
  const bmDir = path.join(dir, 'bitmap');
  const hdExists = (stem) => fs.existsSync(path.join(bmDir, stem + '.hd.jpg'))
    || fs.existsSync(path.join(bmDir, stem + '.hd.png'));
  let hdRefs = 0;
  const stale = [];
  for (const f of fs.readdirSync(dir).filter((n) => /^tags.*\.json$/.test(n))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of s.matchAll(/bitmap\/[\w.-]+\.(?:jpe?g|png)/g)) {
      const stem = m[0].replace(/\.(?:jpe?g|png)$/, '');
      if (/\.hd$/.test(stem)) { hdRefs++; continue; }
      if (hdExists(stem)) stale.push(f + ' → ' + m[0]);
    }
  }
  assert.equal(stale.length, 0, '存在 .hd 的位图仍被 1x 引用（重跑生成器或改回 .hd）：' + stale.join('；'));
  assert.ok(hdRefs > 0, '至少要有一处引用指向 .hd 位图（HD 接线整体丢了？）');
  const mani = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const manis = [mani, JSON.parse(fs.readFileSync(path.join(dir, 'fight-manifest.json'), 'utf8'))];
  for (const m of manis) for (const b of m.bitmaps || []) {
    if (!b.hd) continue;
    assert.ok(fs.existsSync(path.join(bmDir, b.hd.replace(/^bitmap\//, ''))), 'manifest 记录的 ' + b.hd + ' 应当存在');
    assert.ok(b.hdRefs >= 1, b.hd + ' 应当至少有 1 处引用');
    /* 批168：有 `.hd` 的位图，bitmap/ 里不再留 1x 原件（归档在 references/.bak-upscale/，生成器也不再落盘）。 */
    assert.ok(!fs.existsSync(path.join(bmDir, b.file)), '有 .hd 的位图不允许留 1x 原件：' + b.file);
  }
}

/* ---------- 26. 局内战斗 = 原版 fight 帧（2026-10 第一百六十七批）----------
 * 用户口径："局内战斗，当前同样沿用的现代界面，我希望你能对齐 ssfight 中的所有战斗内动画，
 * 以及胜利与失败的动画，以及战斗结束后的 cg，以及之后的抽奖等环节的所有 ui"。
 * 这一条钉住三件事（帧数据 / 映射规则 / 接线），任何一件被改回去都立刻红：
 *   ① 素材包 `tags-fight.json` 必须真的含原版那几个根元件，且帧数与取证一致；
 *   ② 回合 → 动作帧的映射照 `Squirrel.as`（普通攻击 1 / 近战 2 / 投掷 3 / 技能 29+id）；
 *   ③ 经典模式的战斗走 `SfFight`（`main.js` 的 `runBattle`），现代模式仍走 canvas 播放器。 */
async function checkClassicFight() {
  const dir = path.join(ROOT, 'images', 'ssfight', 'ui');
  const mani = JSON.parse(fs.readFileSync(path.join(dir, 'fight-manifest.json'), 'utf8'));
  assert.equal(mani.generator, 'tools/gen-ssfight-ui.cjs --fight');
  for (const key of ['fight', 'fighter', 'hero', 'fightSub', 'skip', 'talk']) {
    assert.ok(mani.roots[key], '战斗包 manifest 里应当有 ' + key + ' 这个根元件');
  }
  const tags = JSON.parse(fs.readFileSync(path.join(dir, 'tags-fight.json'), 'utf8'));
  const byId = new Map(tags.map((t) => [String(t.id), t]));
  const frames = (id) => ((byId.get(String(id)) || {}).Sf || []).filter((p) => p.tp === 1).length + 1;
  for (const id of ['7772', '7689', '6532', '7771', '7692', '7703', '7717', '4847'])
    assert.ok(byId.has(id), 'tags-fight.json 里必须有战斗元件 ' + id);
  assert.equal(frames('7772'), 6, 'fight 那一页 6 帧（场景 / 战果胜 / 战果负 / 伤害累计 / 开宝箱 / 空）');
  assert.equal(frames('7689'), 8, '格斗者容器 8 帧（f1 = 松鼠那一档）');
  assert.equal(frames('6532'), 9, '松鼠本体 9 帧（7 组动作选择器 + 2 空帧）');
  /* 7772 第 5 帧必须是 openChest（7771）—— 开宝箱那一环就在这里。 */
  const f5 = [];
  { let f = 1; for (const p of byId.get('7772').Sf || []) { if (p.tp === 1) { f++; continue; } if (f === 5 && p.na) f5.push(p.na + '=' + p.id); } }
  assert.ok(f5.some((s) => s === 'openChest=7771'), '7772 第 5 帧要放 openChest=7771，实得 ' + f5.join(','));
  /* 6532 的动作选择器（`Squirrel.as` 靠这些名字拨帧）。 */
  const heroNames = {};
  for (const p of byId.get('6532').Sf || []) if (p.na) heroNames[p.na] = String(p.id);
  for (const n of ['attacks', 'defenses', 'dodges', 'defenseSkills', 'attackbacks', 'comeBacks', 'winPoses'])
    assert.ok(heroNames[n], '松鼠本体要有动作选择器 ' + n);
  assert.equal(heroNames.attacks, '6339', '攻击选择器 id（62 帧，逐帧一种攻击动作）');
  /* ② 映射规则：直接把模块跑起来问它。 */
  const env = { window: {}, console };
  env.window.State = { state: () => ({}) };
  env.window.SfRender = {};
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8'), env);
  const SfFight = env.window.SfFight;
  assert.ok(SfFight, 'ui-fight.js 要暴露 window.SfFight');
  assert.equal(SfFight._attackFrame({ action: 'attack' }), 1, '普通攻击 → attacks 第 1 帧');
  assert.equal(SfFight._attackFrame({ action: 'weapon', id: 3 }), 2, '近战武器 → 第 2 帧');
  assert.equal(SfFight._attackFrame({ action: 'weapon', id: 6 }), 3, '投掷武器 → 第 3 帧');
  /* ②a′ 技能走的是 `Squirrel.as` 的 **attackType 3**（按 `weaponSkillId` 进 switch，只有
   * 8/12/13/14/15/17/18/23 这 8 个，落点 4~21）；**绝不能**走 attackType 4 的 `29 + id`
   * —— 那一档是**幻兽/召唤**（`attacks.attack.allPets…`），只有 `action:'pet'` 才允许落进去。
   * 2026-11 用户口径："战斗中我观察到我方大量使用了幻兽……说明你的武器和技能调用出了很大的问题"，
   * 当时就是把每个技能都塞进了第 4 档。 */
  assert.equal(SfFight._attackFrame({ action: 'skill', id: 12 }), 5, '色诱之术…12 号技能 → 第 5 帧');
  assert.equal(SfFight._attackFrame({ action: 'skill', id: 12, level: 12 }), 16, '真形态（等级>10）→ 第 16 帧');
  /* 原版 `Squirrel.attack` attackType 3 的整张表：普通档 / 真化档。 */
  const TRUE_SKILL_ATTACK = { 8: [4, 15], 12: [5, 16], 13: [6, 6], 14: [7, 17],
    15: [8, 18], 17: [9, 19], 18: [10, 20], 23: [12, 21] };
  for (const [id, pair] of Object.entries(TRUE_SKILL_ATTACK)) {
    assert.equal(SfFight._attackFrame({ action: 'skill', id: Number(id) }), pair[0], '技能 ' + id + ' 普通帧');
    assert.equal(SfFight._attackFrame({ action: 'skill', id: Number(id), level: 11 }), pair[1], '技能 ' + id + ' 真化帧');
  }
  assert.equal(SfFight._attackFrame({ action: 'skill', id: 13 }), 6, '13 号技能 → 第 6 帧');
  assert.equal(SfFight._attackFrame({ action: 'skill', id: 23 }), 12, '23 号技能 → 第 12 帧');
  assert.equal(SfFight._attackFrame({ action: 'skill', id: 9 }), 1, '被动技能（不在表里）退回普通攻击帧');
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) {
    const f = SfFight._attackFrame({ action: 'skill', id: id });
    assert.ok(f >= 1 && f <= 21, '技能 ' + id + ' 的落点必须在 1~21（幻兽档从 29 起），实得 ' + f);
  }
  assert.equal(SfFight._defenseKind({ dodge: true }), 'dodge', '闪避走 dodges');
  assert.equal(SfFight._defenseKind({ fakeDie: true }), 'skill', '装死走 defenseSkills');
  assert.equal(SfFight._defenseKind({ jueDui: true }), 'skill', '绝对防御走 defenseSkills');
  assert.equal(SfFight._defenseKind({}), 'hit', '普通受击走 defenses');
  /* ②a″ 幻兽协战 = 原版 `attackType 4`：`attacks` 第 `29 + petId` 帧（30..61），
   * 受击帧查 `squirrelAttackConfig`（回血/诅咒类为 -1）。 */
  assert.equal(SfFight._attackFrame({ action: 'pet', petId: 1 }), 30, '幻兽 1 → attacks 第 30 帧');
  assert.equal(SfFight._attackFrame({ action: 'pet', petId: 32 }), 61, '幻兽 32 → attacks 第 61 帧');
  assert.equal(SfFight._attackActs({ action: 'pet', petId: 1 }).hit, 22, '幻兽 1 的 beAttack 在第 22 帧');
  assert.equal(SfFight._defenseKind({ action: 'pet', petId: 1 }), 'hit', '幻兽 1 有专属受击动画');
  assert.equal(SfFight._defenseKind({ action: 'pet', petId: 5 }), 'none', '回光术那条不播受击动作');
  assert.equal(SfFight.PET_FRAMES.art, '4280', 'HUD 幻兽格用「全身」4280 的第 pet.id 帧');
  /* ②b 主角本体必须由 `buildFighter` 回传：`slot.attachChild()` **不进** `byName` 表，
   *   而 7639 第 2 帧已经把第 1 帧那批挂点摘掉了 —— 回头 `slot.byName('playerMc')` 永远是 null，
   *   于是"战斗里一个动作都不播"（2026-10 实拍发现：两个 `hasMc` 都是 false）。 */
  const uf = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  /* 战斗身体 `idle()` 的源码片段：从最后一个 `idle() {`（主角本体，NPC 那条也同名）
   * 截到 `startIdlePose(mc);` 之前，专门用来钉"待机时怎么处理出手层"。 */
  const idleEnd = uf.indexOf('startIdlePose(mc);');
  const idleAt = idleEnd >= 0 ? uf.lastIndexOf('idle() {', idleEnd) : -1;
  const idleBody = idleAt >= 0 ? uf.slice(idleAt, idleEnd) : '';
  /* ②b-2 随机数顺序：`BattleDrops.create()` 会立刻抽 4 次 Math.random（1 次偏移 + 3 件掉落）。
   * 经典战斗以前在 Sim.simulate **之前**建它，于是同一组输入下的出手抽签随机流整体后移
   * 4 个随机数 —— 武器/技能/普攻的权重虽然共用 Sim，实际抽出来的回合却和现代 Battle 对不上。
   * 现代 `battle.js` 是「先 Sim.simulate，再建 pickups」，这里必须同序。 */
  const simAt = uf.indexOf('const result = o.result ||');
  const dropsAt = uf.indexOf('pickups = (o.collectDrops');
  assert.ok(simAt >= 0 && dropsAt > simAt,
    '经典战斗必须先 Sim.simulate 再创建 BattleDrops（否则 Math.random 流比现代多走 4 个，出手权重对不上）');
  assert.ok(/EXPLICIT_STOP_IN_ACTION/.test(uf) && /deep: true, onFrame/.test(uf)
    && /startNestedAnim\(clip, true, false, true, true\)/.test(uf)
    && idleAt >= 0 && /const atk = mc && mc\.byName\('attacks'\);/.test(idleBody)
    && /stopAt\(atk, 1\);/.test(idleBody) && /stopAt\(inner, 1\);/.test(idleBody)
    && !/visible\(atk, false\)/.test(idleBody) && /visible\(sel, true\)/.test(uf),
    '角色动作要重启嵌套表情/眼睛层，待机时把出手层复位到第 1 帧（不能整层隐藏：待机本体就画在里面）');
  assert.ok(/holder\.__hero = hero \|\| null;/.test(uf), 'buildFighter 必须把挂上去的主角本体留在 holder 上');
  assert.ok(/const mc = \(holder && holder\.__hero\)/.test(uf), 'makeFighter 必须优先用回传的主角本体');
  const simSrc = fs.readFileSync(path.join(ROOT, 'js/sim.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/r\.stripLeft = \[/.test(simSrc) && /setGearStripped\(side, true\)/.test(uf)
    && /__gearSlot = true/.test(uf), '真·色诱命中要把装备视觉卸下，并由 stripLeft 到期穿回');
  assert.ok(/const holder = view\.attachChild\(SYM\.fighter, 1,/.test(uf), '格斗者容器要挂在战斗视图上');
  assert.ok(/hasMc: !!mc, hasAttacks: !!\(mc && mc\.byName\('attacks'\)\)/.test(uf)
    && /atk: innerOf\('attacks', 'attack'\)/.test(uf) && /def: innerOf\('defenses', 'defense'\)/.test(uf),
    '格斗者要能自报"动作有没有真的接上"（含出手 / 受击动画播到第几帧）');
  /* ②b′ 节拍不能是"出手后固定等一拍"：原版是**动作元件自己的帧脚本**在关键帧回调
   *   `_root.useSkillDefense()`（防御技起手，挨打之前）/ `_root.beAttack()`（命中）/
   *   `_root.setAttackEnd()`（这一拍结束）。2026-11 用户口径："我方攻击动画与敌方受击动画对不上"
   *   就是固定延时造成的。这里钉：帧号表与元件号、帧号必须落在该元件长度以内、
   *   以及**末帧必须停住**（"动画会播两遍 / 胜利失败动作重复播放"的根因）。 */
  /* 帧脚本表来自另一个 vm realm，逐个字段比（跨 realm 的 deepEqual 会因为原型不同而假红）。 */
  const actsOf = (r) => JSON.stringify(SfFight._attackActs(r));
  assert.equal(actsOf({ action: 'attack' }), JSON.stringify({ sym: 5630, guard: 3, hit: 9 }),
    '普通攻击：起手 3 帧、命中 9 帧（sprite5630.as）');
  assert.equal(actsOf({ action: 'weapon', id: 6 }), JSON.stringify({ sym: 5778, guard: 8, hit: 14 }),
    '投掷武器：起手 8 帧、命中 14 帧（sprite5778.as）');
  assert.equal(actsOf({ action: 'skill', id: 13 }), JSON.stringify({ sym: 5922, heal: 37 }),
    '13 师父驾到只加血（第 37 帧 addBlood），帧脚本里没有 beAttack —— 不打人');
  for (const [frame, acts] of Object.entries(SfFight.ACTS.attack)) {
    assert.ok(byId.has(String(acts.sym)), 'attacks 第 ' + frame + ' 帧的动画元件 ' + acts.sym + ' 要在 tags-fight.json 里');
    const total = frames(acts.sym);
    for (const k of ['guard', 'hit', 'heal'])
      if (acts[k]) assert.ok(acts[k] <= total, acts.sym + ' 的 ' + k + ' 帧 ' + acts[k] + ' 超过了动画长度 ' + total);
  }
  for (const [frame, acts] of Object.entries(SfFight.ACTS.defense).concat(Object.entries(SfFight.ACTS.defenseSkill))) {
    assert.ok(byId.has(String(acts.sym)), '受击档 ' + frame + ' 的动画元件 ' + acts.sym + ' 要在 tags-fight.json 里');
    if (acts.back) assert.ok(acts.back <= frames(acts.sym), acts.sym + ' 的反击帧超过了动画长度');
  }
  assert.equal(SfFight.ACTS.dodge.back, 10, '闪避动画（6432）在第 10 帧才调 _root.attackBack()');
  assert.equal(SfFight.ACTS.attackBack.hit, 5, '反击动画（6516）第 5 帧 beBttackBack()、第 15 帧 congratulate()');
  assert.equal(SfFight.ACTS.hudStop, 8, '血条元件 7703 第 8 帧 stop + showFightInfo');
  /* 这几档的元件号同样不能写错：错了不会报错，只是那一段动作变成一个定格姿势。 */
  for (const [k, acts] of [['dodge', SfFight.ACTS.dodge], ['attackBack', SfFight.ACTS.attackBack]]
    .concat(Object.entries(SfFight.ACTS.comeBack)))
    assert.ok(byId.has(String(acts.sym)), k + ' 的动画元件 ' + acts.sym + ' 要在 tags-fight.json 里');
  assert.ok(/if \(clip\.frame >= stopIdx\) \{ stopAt\(clip, stopIdx \+ 1\); resolve\(\); return; \}/.test(uf),
    '动作片断播到停止帧必须停住 —— 不停的话节拍器会把同一个动作再循环一遍');
  assert.ok(/playClip\(inner, \{\n\s*(?:deep: true, )?onFrame: \(n\) => \{\n\s*if \(acts\.guard/.test(uf),
    '出手动画要按帧脚本在起手/命中帧回调，而不是固定延时');
  /* ②b⁗⁗ 防御技（绝对防御 16 / 龟甲术 7）**在命中那一刻才起手**（2026-11 第一百七十六批）：
   *   原版是出手动画第 3~25 帧的帧脚本提前调 `_root.useSkillDefense()`，复刻照抄过一版；
   *   用户口径："绝对防御与龟甲术的动画触发实际太早了，参考现代版的做法" —— 现代播放器
   *   （`battle.js`）就是"挨打那一拍同时起手"，所以这里也改成 `impact()` 里举盾。 */
  assert.ok(/if \(!guarded\) guarded = defender\.useSkillDefense\(r\);/.test(uf) &&
    !/const onGuard = /.test(uf) && !/guard: onGuard/.test(uf),
    '防御技要在命中那一刻起手（不许再在出手动画中途提前举盾）');
  assert.ok(uf.indexOf('guarded = defender.useSkillDefense(r)') > uf.indexOf('const impact = () => {'),
    '举盾那一步必须在 impact（命中）里');
  /* ②b″ 闪避 / 技能防御必须"先把身体拨到那一档、再在里面找子动作"：`byName()` 只反映当前帧，
   *   写反了这两个分支恒为 null，两种反应一次都不会播（只留一个定格姿势）。 */
  assert.ok(/stopAt\(mc, 3\);\n\s*const sel = mc && mc\.byName\('dodges'\)/.test(uf),
    '闪避要先 gotoAndStop(3) 再取 dodges');
  assert.ok(/stopAt\(mc, 4\);\n\s*const sel = mc && mc\.byName\('defenseSkills'\)/.test(uf),
    '技能防御要先 gotoAndStop(4) 再取 defenseSkills');
  /* ②b‴ 伤害数字的两条硬规则（`showBlood`）：模板**按"飘在哪一侧"选**（4845 左 / 4846 右，
   *   `MainMovie.as:6165`），抖动只有横向 `random(30)`、往下叠是 `index*20` ——
   *   纵向 `random(60)` 是 `duplicateMc()`（boom 分次扣血）的规则，混进来数字会散得到处都是。 */
  assert.ok(/view\.attachChild\(side === 0 \? '4845' : '4846', spec\.frame, 'float'\)/.test(uf),
    '伤害数字模板要按飘字所在的那一侧选，不能按加血/扣血选');
  assert.ok(/Math\.floor\(Math\.random\(\) \* 30\)/.test(uf) && !/Math\.random\(\) \* 60/.test(uf),
    '飘字抖动照 showBlood：只有横向 random(30)，没有纵向 random(60)');
  assert.equal(JSON.stringify(SfFight._floatKind('heal')), JSON.stringify({ frame: 1, symbol: 2, font: 3 }),
    '回血：加号字形 + 第三套字');
  assert.equal(JSON.stringify(SfFight._floatKind('back')), JSON.stringify({ frame: 2, symbol: 1, font: 2 }),
    '反伤/自伤走模板第 2 帧');
  /* ②b⁗ 打完要**走回原位**：出手动画的末帧是留在对面身边的（`5630` 第 17 帧把静止姿势
   *   `5616` 摆在 x=+231.8），原版靠 `_root.attackBack()` 里的 `attacker.comeBack(0)`
   *   （`MainMovie.as:6426`）+ `parseFightLog`（:17944）现算的 `canBeAttackBack`：
   *   普通攻击恒 true、近战武器 true、投掷/技能/幻兽 false。
   *   ⚠ `Sim` 给普通攻击的动作名是 **`'common'`**（不是 `'attack'`）—— 2026-11 第一百七十五批
   *   才发现这里判错了（判 `'attack'` 永远不成立）：**普攻之后不走回来、下一拍瞬移归位**，
   *   那一拍还比原版短了走回来那 ~0.7s（用户口径："两次攻击之间的间隔还是有问题"）。 */
  assert.ok(/const normalAttack = r\.action === 'common' \|\| r\.action === 'attack';/.test(uf),
    'canBeAttackBack 必须认 sim 的普攻动作名 common（attack 只是老录像/用例里的写法）');
  assert.ok(/const canBack = normalAttack \|\| \(r\.action === 'weapon' && !RANGED\.has\(Number\(r\.id\)\)\);/.test(uf),
    'canBeAttackBack 要照 parseFightLog 现算：普通攻击 / 近战武器才归位');
  assert.ok(/if \(canBack\) back = attacker\.comeBack\(0\);/.test(uf), '打完之后出手方要播 comeBack(0) 归位');
  assert.ok(/const inner = sel\.byName\('attack'\) \|\| onlyChildClip\(sel\);[\s\S]{0,80}?if \(!inner\) return;/.test(uf),
    '普攻/武器帧里没有具名 attack 子件时要退回唯一子件，不能原地不播');
  assert.ok(/await wait\(ROUND_GAP\)/.test(uf) && /const ROUND_GAP = 170;/.test(uf),
    '两拍之间要有呼吸（照现代播放器每回合收尾的 wait(170)）');
  assert.ok(/const fakeSide = r\.fakeDie[\s\S]{0,500}?attacker\.idle\(\);[\s\S]{0,200}?defender\.idle\(\)/.test(uf),
    '收招后先让双方回待机呼吸，再走 170ms 空档（装死的那位保持姿势）');
  /* ②b⁵ 状态图标（`Player.specialEffect`）：2026-11 用户口径"给敌人施加 debuff 时飘的 debuff ui
   *   是错误的 ui"+"战斗后期回合双方头顶一直闪烁力下降的标识"。两条根因都在这一段：
   *   · **图不对**：`propty` 第 4/5/6 帧是**力/敏/速下降**、第 8 帧是「晕击」（逐帧渲染核对过）；
   *     以前 stun→statu 3（= 力量下降）、中毒→statu 1（= 敏捷下降）…整张表都对错了位，
   *     而原版对中毒 / 沉默 / 缴械根本没有图标（中毒只飘伤害数字）。
   *   · **一直闪**：`statu`(7658) 是 20 帧、**第 1 帧与第 20 帧都 stop()** 的"图标升起"动画，
   *     以前裸 `play()` 会被节拍器无限循环 —— 升上去又从头来，看起来就是头顶一直闪。 */
  assert.equal(SfFight._effectStatu({}), 0, '没中招就不飘图标');
  assert.equal(SfFight._effectStatu({ stunApplied: true }), 4, '眩晕 → statu 4（propty 第 8 帧「晕击」）');
  assert.equal(SfFight._effectStatu({ debuffStat: 'power' }), 3, '力量降低 → statu 3（propty 第 4 帧）');
  assert.equal(SfFight._effectStatu({ debuffStat: 'agility' }), 1, '敏捷降低 → statu 1（propty 第 5 帧）');
  assert.equal(SfFight._effectStatu({ debuffStat: 'speed' }), 2, '速度降低 → statu 2（propty 第 6 帧）');
  assert.equal(SfFight._effectStatu({ debuffText: '力量降低！' }), 3, '老录像没有 debuffStat 时按文案兜底');
  assert.equal(SfFight._effectStatu({ dotApplied: true }), 0, '中毒在原版没有图标（只飘伤害数字）');
  assert.equal(SfFight._effectStatu({ silenceApplied: true }), 0, '沉默在原版没有图标');
  assert.equal(SfFight._effectStatu({ disarmApplied: true }), 0, '缴械在原版没有图标');
  assert.ok(/playClip\(statu, \{ stop: statu\.frameCount \? statu\.frameCount\(\) : 20 \}\);/.test(uf),
    '状态图标动画要**播一次就停**（7658 第 20 帧 stop），不能循环 —— 否则头顶一直闪');
  assert.ok(/STATU_ICON_SYMS\.has\(Number\(clip\.tag\.id\)\)/.test(uf),
    '图标容器（7640…7656）要在 onClip 里按左右拨朝向（showReverse）');
  /* ②b⁷ 状态图标的**字不能是反的**（2026-11 第一百七十六批，用户口径："敌方的信息提示镜像是错误的
   *   做法，比如闪避镜像后是反过来的字"）：敌方那一侧整个 `7689` 是镜像的，挂在里面的图标会连字
   *   一起翻过去。逐帧独立渲染核对：**8 颗图标的第 1 帧都是正字**（7656「击晕」也是第 1 帧；
   *   旧记录把它写成第 2 帧，结果敌方头顶一直是反的"晕击"）。所以统一用第 1 帧 + 右侧自翻。 */
  assert.equal(uf.match(/const STATU_ICON_FRAME = \{([^}]*)\}/)[1].includes('7656: 1'), true,
    '「击晕」(7656) 的正字帧是第 1 帧（第 2 帧才是镜像的"晕击"）');
  assert.equal(uf.match(/const STATU_ICON_FRAME = \{([^}]*)\}/)[1].includes('7645: 1'), true,
    '「力↓」(7645) 的正字帧是第 1 帧');
  assert.ok(/function orientStatu\(clip, fighter\)/.test(uf) &&
    /if \(Number\(fighter\.side\) !== 0 && clip\.setExtraTransform\) clip\.setExtraTransform\('scale\(-1,1\)'\);/.test(uf) &&
    /stopAt\(clip, STATU_ICON_FRAME\[Number\(clip\.tag\.id\)\] \|\| 1\);/.test(uf),
    '图标要统一用正字帧，敌方那一侧再把自己翻回来（否则敌方头顶是反字）');
  /* ②b⁸ 胜利 / 失败字样要**播出来**（2026-11 第一百七十六批，用户口径："战斗结束后还在庆祝时的
   *   胜利&失败字样几乎超出屏幕了，位置完全不对"）：`winWords`(7717) 的每一帧是一个"字滑进来"的
   *   动画容器（7708 胜负字 / 7711 失败字，各 6 帧、第 6 帧 stop()），它自己的第 1 帧两半字都停在
   *   屏幕外（x=-260.75 / +484.3）。只 `stopAt(ww, 1|2)` 就等于停在屏幕外。 */
  assert.ok(/function showWinWords\(ww, winner\)/.test(uf) &&
    /const inner = onlyChildClip\(ww\);\n\s*if \(inner\) playClip\(inner\);/.test(uf),
    '胜负字要把它内部那段滑入动画播出来（否则停在第 1 帧＝几乎全在屏幕外）');
  assert.ok(/showWinWords\(rec\.view && rec\.view\.byName\('winWords'\), winner\);/.test(uf),
    '收尾要调用 showWinWords');
  assert.equal(((byId.get('7708') || {}).Sf || []).filter((p) => p.tp === 1).length, 6,
    '胜负字动画 7708 是 6 帧（第 6 帧 stop()，停下时字正好在中央）');
  /* ②b⁹ **动作里嵌的动画必须跟着走**（2026-11 第一百七十七批）：用户口径
   *   "321 go 倒计时的时候松鼠理应有呼吸动作而不是僵住的"、"来点松果、师傅驾到等技能会有表情上的
   *   动作，各种攻击也会有表情上的动作，诱惑等技能也有双方专属的表情动作……很多都没有实现"。
   *   根因：原版这些"表情 / 动效 / 待机"都是**动作元件里嵌的多帧子元件**，靠 Flash 的
   *   "嵌套 clip 自动播"在走（`sprite5616/5625/6346/…as` 都没有脚本），而复刻的静态页策略
   *   **出生即冻结**，于是它们全停在第一帧。 */
  const framesOfSym = (id) => ((byId.get(String(id)) || {}).Sf || []).filter((p) => p.tp === 1).length;
  assert.equal(framesOfSym('5616'), 17, '待机姿势 5616 是 17 帧的呼吸循环（原版无 stop 脚本 → 一直播）');
  const kidsOf = (id) => new Set(((byId.get(String(id)) || {}).Sf || []).filter((p) => p.tp !== 1 && p.id).map((p) => String(p.id)));
  assert.ok(kidsOf('5630').has('5616') && kidsOf('6347').has('5616'),
    '每个动作的第 1 帧与末帧都放 5616 —— 所以"待机呼吸"与"动作"是同一套素材');
  /* 帧内容：tags 里帧与帧之间用 `tp:1` 分隔，第一帧的放置项排在最前面。 */
  const frameKids = (id, n) => {
    const out = [];
    let f = 1;
    for (const p of (byId.get(String(id)) || {}).Sf || []) {
      if (p.tp === 1) { f++; continue; }
      if (f === n && p.id) out.push(String(p.id));
    }
    return out;
  };
  assert.ok(frameKids('6339', 1).includes('5630'),
    'attacks 6339 第 1 帧 = 普攻 5630（待机复位到这里才画得出角色本体）');
  assert.ok(frameKids('5630', 1).includes('5616') && frameKids('5630', framesOfSym('5630')).includes('5616'),
    '普攻 5630 的第 1 帧与末帧都是待机姿势 5616（复位后接呼吸循环）');
  assert.ok(framesOfSym('6346') === 11 && kidsOf('6347').has('6346'),
    '普通受击 6347 里嵌着 11 帧的 6346（挨打那一下的表情 / 特效）');
  assert.ok(framesOfSym('5625') === 15 && kidsOf('5630').has('5625'),
    '普攻 5630 里嵌着 15 帧的 5625（挥拳动效）');
  assert.ok(framesOfSym('5785') === 11 && kidsOf('5843').has('5785'),
    '色诱之术 5843 里嵌着 11 帧的 5785（技能特效）');
  assert.ok(/function allowNestedAnim\(clip\) \{ startNestedAnim\(clip, false, false\); \}/.test(uf)
    && /if \(o\.deep\) startNestedAnim\(clip, true, false, true, true\);/.test(uf)
    && /else allowNestedAnim\(clip\);/.test(uf),
    'playClip 必须放行这条片断内部的嵌套动画（否则表情 / 动效全停在第 1 帧）');
  assert.ok(/const gear = !!inGear \|\| clip\.__pinFrame != null\n\s*\|\| !!\(g && g\.getAttribute && g\.getAttribute\('slot'\)\);/.test(uf),
    '放行嵌套动画时要**跳过装备**（挂点被 pinFrame 钉住、容器带 slot 记号），否则装备会乱跳');
  assert.ok(/const IDLE_POSE_SYM = '5616';/.test(uf)
    && idleAt >= 0 && /stopAt\(mc, 1\);/.test(idleBody)
    && /if \(f && f\.mc && !f\.npc\) startIdlePose\(f\.mc\);/.test(uf),
    '待机（含开打倒计时那几秒）要让 5616 转起来 —— 三侠的待机由图集动画自己起');
  /* ②b¹⁰ **开宝箱 / 战果页那一格必须画得出东西**（2026-11 第一百七十八批）：用户口径
   *   "战斗结束后开启宝箱时，开出来的东西显示时，总会有一两个物品显示不出来"。
   *   那一格是原版的 `mc.c1.attachMovie(<道具名>, "mc", 100)`（MainMovie.as:18691/18804）——
   *   **库元件名就是道具名**，所以掉落池里每一件都得在 SWF 里有同名导出，否则那一格永远是空的。
   *   实拍：天梯赛的主产出「天梯碎片」原版没有这个导出名（同一场掉两份就两格空），
   *   现在按 `LOOT_ALIAS` 借「金杯」画（天梯赛在原版里的图标就是金杯）。 */
  const lootMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/loot-icons.json'), 'utf8'));
  const dropSrc = fs.readFileSync(path.join(ROOT, 'js/battle-drops.js'), 'utf8').replace(/\r\n/g, '\n');
  const poolIds = [...dropSrc.matchAll(/\{\s*id:\s*(\d+)\s*,\s*name:\s*'([^']+)'/g)].map((mm) => ({ id: Number(mm[1]), name: mm[2] }));
  assert.ok(poolIds.length >= 10, 'battle-drops.js 里应能扫到掉落池（实际 ' + poolIds.length + ' 条）');
  assert.equal(JSON.stringify(lootMap.missing), '[]',
    '掉落池里每一件都要有战利品图标 —— 缺一件，开宝箱/战果页那一格就是空的');
  const noIcon = poolIds.filter((p) => !lootMap.byId[p.id]);
  assert.equal(noIcon.length, 0, '这些掉落没有图标：' + noIcon.map((p) => p.id + ':' + p.name).join('、'));
  const ladder = lootMap.byId[51];
  assert.ok(ladder && ladder.aliasOf === '金杯' && byId.has(ladder.id),
    '天梯碎片借「金杯」的元件 3061，且该元件要在 tags-fight.json 里');
  /* ②b⁶ 「没有出手动画」的那几拍不能一眨眼就过去（2026-11 第一百七十五批，用户口径
   *   "在一些情况下两次攻击之间的间隔还是有问题"）：节拍照现代播放器
   *   （`battle.js`：dot 400 / buff 320 / regen 420），眩晕那一拍换原版「晕击」图标 + 700ms。 */
  assert.ok(/let beat = r\.action === 'dot' \? 400 : r\.action === 'buff' \? 320 : r\.action === 'regen' \? 420 : 0;/.test(uf),
    'dot / buff / regen 的节拍要照现代播放器（400 / 320 / 420），不能只有 ROUND_GAP');
  assert.ok(/beat = 700;/.test(uf) && /who\.setStatu\(4\); who\.specialEffect\(\);/.test(uf),
    '眩晕那一拍要飘原版「晕击」图标并给出一拍时间');
  /* ③ 胜负一定就不再给"跳过"：原版 `congratulate()`(:6468) / `clearFrames()`(:15626) 都会
   *   `_root.skipmc.removeMovieClip()`；复刻以前把跳过键一路留到战果 CG 与开宝箱那两页。 */
  assert.ok(/function hideFightKeys\(rec\)/.test(uf) && /hideFightKeys\(rec\);\n\s*if \(!rec\.skipped\)/.test(uf),
    '收尾要先收掉跳过 / 倍速键');
  /* ④ 开宝箱：奖品图要挂进**格子里那颗 k 的第 10 帧才出现的 `c1`(3414) 槽**，
   *   数量写进 `count` 文本框（`showPrize`：`mc.c1.attachMovie(...)` + `textMc.text = "X"+n`），
   *   而且四格的 `b`/`k` 都要真的播一遍（导出里没有帧动作，`stop()` 得由 `playClip` 补）。 */
  assert.ok(/const slot = inner && inner\.byName \? inner\.byName\('c1'\) : null;/.test(uf),
    '奖品图要挂进 k 子元件的 c1 槽，不能挂在 k1..k4 外壳上');
  assert.ok(/if \(cnt\) setText\(cnt, 'X' \+ n\);/.test(uf), '数量写 count 文本框（不是位图数字）');
  assert.ok(/for \(const b of boards\) if \(b\) playClip\(b, \{ stop: 5 \}\);/.test(uf) &&
    /opening\.push\(playClip\(inner, \{ stop: 10 \}\)\)/.test(uf) && /await Promise\.all\(opening\)/.test(uf),
    '开箱时四块 b 要显式停在第 5 帧（第 4 帧是炸开的棕色碎片），k 停在第 10 帧');
  /* ②c 战利品图标（战果页三格 / 开宝箱四格里的道具图）：映射表里的每一颗都必须**真的在包里**，
   *   否则 `attachChild` 静默返回 null、格子里永远空着（实拍就是两块空白黄格）。 */
  const lootIcons = JSON.parse(fs.readFileSync(path.join(dir, 'loot-icons.json'), 'utf8'));
  const lootIds = Object.keys(lootIcons.byId || {});
  assert.ok(lootIds.length >= 8, 'loot-icons.json 至少要覆盖掉落池里的 8 种道具，实得 ' + lootIds.length);
  const lootMiss = lootIds.filter((k) => !byId.has(String(lootIcons.byId[k].id)));
  assert.equal(lootMiss.length, 0, '战利品图标不在 tags-fight.json 里：' +
    lootMiss.map((k) => k + ':' + lootIcons.byId[k].name).join('、'));
  /* ②d 战果页那几个数字要写进**正确的层级**：`num`(4843) 只是外壳，位图数字是它的子元件 `num`(4315)；
   *   `getExp` 同理（子元件 `exp`）。写错层级不报错，只是那一格永远停在素材里的占位串「-0000」。 */
  const f2 = {};
  { let f = 1; for (const p of byId.get('7772').Sf || []) { if (p.tp === 1) { f++; continue; } if (f === 2 && p.na) f2[p.na] = String(p.id); } }
  for (const n of ['backgd', 'prizeBackg', 'maxlevel', 'shoutu', 'getExp', 'c1', 'c2', 'c3', 'num', 'num1', 'num3'])
    assert.ok(f2[n], '7772 第 2 帧（战果页）应当有 ' + n);
  assert.equal(f2.num, '4843', '战果页的奖励数字外壳是 4843');
  assert.deepEqual(((byId.get('4843') || {}).Sf || []).filter((p) => p.na === 'num').map((p) => String(p.id)), ['4315'],
    '4843 里那颗位图数字（子元件 num）必须是 4315');
  assert.deepEqual(((byId.get('7739') || {}).Sf || []).filter((p) => p.na === 'exp').map((p) => String(p.id)), ['4315'],
    'getExp 里的 exp 子元件必须是 4315');
  assert.ok(/const digits = slot\.num\.byName \? slot\.num\.byName\('num'\)/.test(uf) && /getExp\.byName\('exp'\)/.test(uf),
    '战果页的数字必须写进 num.num / getExp.exp，不能写在外壳上');
  /* ②d² 第一张战果页就要写全"经验 + 金松果 + 悬浮物品"：结算方在 `rewardFor` 里先算，
   *   金松果与飘到的同 id 掉落合并进 c1，开完宝箱不再弹第三张结算。 */
  assert.ok(/typeof o\.rewardFor === 'function'/.test(uf) && /showResultPanel\(rec, o, result, winner, loot, reward\)/.test(uf),
    'SfFight 要在战果页出现前调用 rewardFor，并把结果交给 showResultPanel');
  assert.ok(/if \(Number\(item\.id\) === 8\) \{ gold \+= count; continue; \}/.test(uf),
    '战斗中飘到的金松果要与结算金松果合并到同一格');
  /* ②e 开宝箱那两步都要**等玩家**（选箱子 / 翻奖后的确定），且都要有回归入口。 */
  assert.ok(/pickChest: \(i\) =>/.test(uf) && /confirmChest: \(\) =>/.test(uf),
    '开宝箱的"选箱子"与"确定"都要留出入口，否则回归与探针走不到那一步');
  /* ③ 接线：经典模式用 SfFight，且加载顺序在 main.js 之前。 */
  const mainSrc = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/UI\.currentUiMode && UI\.currentUiMode\(\) === 'classic'/.test(mainSrc),
    'main.js 要按界面模式挑战斗渲染器');
  assert.ok(/return await SfFight\.run\(opts\);/.test(mainSrc) && /return Battle\.run\(opts\);/.test(mainSrc),
    'SfFight 起不来时必须退回 canvas 播放器，不能让玩家打不了');
  assert.ok(/const controller = await runBattle\(/.test(mainSrc), 'startBattle / replayBattle 都要走 runBattle');
  /* ②f 手里的那把武器（2026-11 第一百七十四批）：原版出手动画里握着的是**这一拍用的那把**，
   *   靠三张帧脚本表（`Squirrel.as` 的 `chooseWeaponGo` / `chooseWeapon` / `showWeaponSize`）。
   *   复刻以前一条都没接 → 近战永远第 1 帧 = 方天画戟、投掷永远第 1 帧 = 死老鼠，
   *   用户口径："战斗中玩家会使用自己没有的技能&武器"。表里的元件号与帧号都必须在包里。 */
  assert.ok(byId.has('5734') && byId.has('5776'), '近战 / 投掷的武器容器（5734 / 5776）要在战斗包里');
  assert.equal(SfFight.WEAPON_ART.melee.sym, 5734, '近战武器容器是 5734（挂在 5748 的 ikNode_98 上）');
  assert.equal(SfFight.WEAPON_ART.ranged.sym, 5776, '投掷武器容器是 5776（挂在 5778 里）');
  assert.equal(SfFight._weaponArt(false, 1), 1, '方天画戟（近战 1）→ 容器第 1 帧');
  assert.equal(SfFight._weaponArt(false, 15), 7, '死神镰刀（近战 15）→ 容器第 7 帧');
  assert.equal(SfFight._weaponArt(true, 10), 6, '流星锤（投掷 10）→ 容器第 6 帧');
  assert.equal(SfFight._weaponArt(false, 6), 0, '表里没有的（6 = 投掷）不能拨近战容器');
  assert.equal(SfFight._weaponSize(15), 9, '15 级武器 → 型号第 9 帧（showWeaponSize）');
  assert.equal(SfFight._weaponSize(1), 1, '低等级武器 → 型号第 1 帧');
  const SIZE = { 8: 2, 9: 3, 10: 4, 11: 5, 12: 6, 13: 7, 14: 8, 15: 9 };
  for (const [lv, fr] of Object.entries(SIZE)) assert.equal(SfFight._weaponSize(Number(lv)), fr, lv + ' 级型号帧');
  for (const [ranged, t] of [[false, SfFight.WEAPON_ART.melee], [true, SfFight.WEAPON_ART.ranged]]) {
    const cont = byId.get(String(t.sym));
    const n = ((cont || {}).Sf || []).filter((p) => p.tp === 1).length + 1;
    for (const [id, fr] of Object.entries(t.frames))
      assert.ok(fr >= 1 && fr <= n, (ranged ? '投掷' : '近战') + '武器 ' + id + ' 拨到第 ' + fr + ' 帧，超出容器长度 ' + n);
  }
  for (const id of [5666, 5670, 5674, 5679, 5686, 5697, 5706, 5724, 5733, 5753, 5757, 5760, 5763, 5766, 5769, 5772, 5775])
    assert.ok(byId.has(String(id)), '武器美术 ' + id + ' 要在战斗包里（型号帧靠它自己的 showWeaponSize）');
  assert.ok(/const cont = WEAPON_ART_CONTAINERS\[Number\(clip\.tag\.id\)\];/.test(uf) &&
    /WEAPON_ART_SYMS\.has\(Number\(clip\.tag\.id\)\)/.test(uf),
    '武器容器 / 武器美术要在 onClip 里按"这一拍用的武器"拨帧');
  assert.ok(/api\.weaponNow = \(r && r\.action === 'weapon'\)/.test(uf),
    '出手前要先记下这一拍的武器（容器是拨帧那一刻建出来的）');
  /* ②g 真形态的防御技：`Squirrel.useSkillDefense` 按 `defenderWeaponLevel > 10` 走第 4 / 第 5 帧
   *   （真·龟甲术 / 真·绝对防御）。以前恒返回基础档 → 玩家没那一段也照演普通档。 */
  assert.equal(SfFight._defenseSkillFrame(7, 3), 2, '龟甲术未真化 → 第 2 帧');
  assert.equal(SfFight._defenseSkillFrame(7, 12), 4, '真·龟甲术 → 第 4 帧');
  assert.equal(SfFight._defenseSkillFrame(16, 11), 5, '真·绝对防御 → 第 5 帧');
  /* ②h 装死要"谁装谁演"：`r.fakeDie` 说的是有人装了死，装的是 `r.fakeDieSide`
   *   （普通受击 = 挨打那位；被反伤打死 = **出手那位**）。不看这一位的话，
   *   出手方被反伤打出装死时**挨打方**会莫名其妙演一段装死 —— 也是"用了自己没有的技能"。 */
  assert.equal(SfFight._defenseKind({ fakeDie: true, fakeDieSide: 1 }, true, 0, 0), 'hit',
    '装死落在对面（fakeDieSide=1）时，0 这一侧只能走普通受击');
  assert.equal(SfFight._defenseKind({ fakeDie: true, fakeDieSide: 0 }, true, 0, 0), 'skill',
    '装死落在自己身上才演装死');
  /* ③ 开打倒计时（3 → 2 → 1 → GO，第一百八十批重做）：原版那一组**就是血条 HUD（`7703`）
   *   第 8 帧里的子元件 `3750`**（42 帧：f1-6 = 3 / f7-12 = 2 / f13-19 = 1 / f19-29 = GO，
   *   f30 起空帧、f41 stop）—— 不要再现造一颗（`gocd` 那一版已经删掉：以前它和原版同时出现，
   *   而且渲染器节拍器会把 `3750` 循环推进，整场战斗一直闪 3/2/1/GO）。 */
  const hud = byId.get('7703');
  assert.ok(hud, '战斗包里要有血条 HUD 7703');
  const hudFrames = [];
  let hudCur = [];
  for (const p of hud.Sf || []) {
    if (p.tp === 1) { hudFrames.push(hudCur); hudCur = []; continue; }
    if (p.id) hudCur.push(String(p.id));
  }
  hudFrames.push(hudCur);
  assert.ok((hudFrames[7] || []).includes('3750'), '血条 HUD 第 8 帧才会放出倒计时 3750');
  const cd = byId.get('3750');
  assert.ok(cd, '战斗包里要有原版倒计时 3750');
  const cdFrames = (cd.Sf || []).filter((p) => p.tp === 1).length;
  assert.ok(cdFrames >= 41, '3750 至少 41 帧（实测 42，最后一帧空），实得 ' + cdFrames);
  const cdKids = [...new Set((cd.Sf || []).filter((p) => p.id).map((p) => String(p.id)))].sort();
  assert.deepEqual(cdKids, ['3741', '3743', '3745', '3749'], '3750 的四个数字：3741=3 / 3743=2 / 3745=1 / 3749=GO');
  assert.ok(!byId.get('gocd'), '自造的 gocd 不该再进战斗包（321GO 只留原版那一颗）');
  assert.equal(SfFight.COUNTDOWN.tag, '3750', 'SfFight 播的就是原版 3750');
  assert.equal(SfFight.COUNTDOWN.holderFrame, 8, '3750 挂在血条第 8 帧');
  assert.ok(!/attachChild\('gocd'/.test(uf) && !/function playCountdown/.test(uf),
    'ui-fight.js 不该再自己造一颗倒计时元件挂上去（gocd 那一版已删）');
  assert.ok(/Promise\.race\(\[playHudCountdown\(rec, aborted\), rec\.skipSignal\]\)/.test(uf) &&
    uf.indexOf('playHudCountdown(rec, aborted)') < uf.indexOf('await playRound(rec, rec.rounds[i], aborted)'),
    '倒计时要播在回合循环之前，且玩家按跳过时能被 skipSignal 当场打断（不能等 321GO 播完）');
  assert.ok(/Promise\.race\(\[rec\.hudReady, rec\.skipSignal\]\)/.test(uf),
    '血条滑入也要能被跳过信号打断（321GO 还没出生时按跳过也要立刻收尾）');
  assert.ok(/await playClip\(clip, \{ stop: COUNTDOWN_END \}\)/.test(uf),
    '倒计时必须**播一次就停住**（停住 = `playing=false`，节拍器不会从头循环）');
  /* ③′ 跳过键要带经典界面通用的悬停 / 点击反馈（第一百八十八批）：画稿包进
   *   `.sf-feedback` 壳（缩放以自身包围盒为中心、不顶掉 g 的定位矩阵），
   *   点击走共用 `SfUiFeedback.tap`；热区自己铺，**不走点击路由**（键压在会呼吸的
   *   对手身上，路由关掉 pointer-events 后按下/松开之间换帧会丢 click）。 */
  assert.ok(/shell\.setAttribute\('class', 'sf-feedback'\)/.test(uf) &&
    /SfUiFeedback\.tap\(sk\.g, runSkip, \{ delay: 0, press: false \}\)/.test(uf) &&
    /SfUiFeedback\.bind\(sk\.g, \{ shell: shell \}\)/.test(uf),
    '跳过键要包 sf-feedback 壳并走 SfUiFeedback（与村庄 / 战果页按钮同一套悬停与按下反馈）');
  assert.ok(/hit\.setAttribute\('pointer-events', 'all'\)/.test(uf) && !/t\.popWrap\(sk\)/.test(uf),
    '跳过键要自己铺透明热区，不能走点击路由（否则压在动画上的键会丢 click）');
  /* ④ 方天画戟的"思考一回合"（2026-11 第一百七十四批）：`attackType 0` = `attacks` 第 11 帧
   *   （`6067`，30 帧：第 1 帧 stop / 第 2 帧 play / 第 30 帧 setAttackEnd）。
   *   复刻以前休息 / 眩晕回合只等 420ms，这一段从来不播。 */
  assert.equal(SfFight._attackFrame({ action: 'rest' }), 11, '休息回合 → attacks 第 11 帧（6067）');
  assert.equal(SfFight._attackFrame({ action: 'stunned' }), 11, '眩晕回合同 attackType 0');
  assert.equal(actsOf({ action: 'rest' }), JSON.stringify({ sym: 6067 }), '第 11 帧的元件是 6067');
  assert.equal(((byId.get('6067') || {}).Sf || []).filter((p) => p.tp === 1).length, 30,
    '6067 是 30 帧（sprite6067.as：f1 stop / f2 play / f30 setAttackEnd）');
  /* ⚠ 只有**蓄力那一回合**才播它：6067 里的思考气泡画的就是方天画戟（实拍），
   *   普通休息 / 眩晕回合硬塞这一段等于给别人看"我在想方天画戟"。
   *   现代播放器同一条口径（`r.preparingWeapon === 1` 才走 commonThink）。 */
  assert.ok(/if \(r\.action === 'rest' && Number\(r\.preparingWeapon\) > 0\) \{/.test(uf),
    '思考一回合只在准备武器那一拍播（preparingWeapon）');
  assert.ok(/await who\.attack\(r, \{\}\);/.test(uf),
    '蓄力那一拍要真的把 attacks 第 11 帧的动作播出来');
  /* ④b 归位必须放在 `playRound` **最前面**（所有分支共用）：原版 `attack()` 开头就把两侧
   *   `gotoAndStop(1)`。以前 dot/buff/regen/rest/stunned 这支没归位，上一拍停在 `comeBacks`(6)
   *   的身体会一直留着 —— 身体不在第 1 帧时 `mc.byName('attacks')` 是 null，`attack()` 直接返回，
   *   于是**方天画戟那一拍蓄力根本不播**（用户 2026-11 口径："方天画戟没有准备的前摇回合"）。 */
  assert.ok(/for \(const side of \[att, def\]\) \{\n\s*const f = rec\.fighters\[side\];\n\s*if \(f\) f\.idle\(\);/.test(uf),
    'playRound 开头要先把两侧归位（否则 rest 那支的 6067 永远播不出来）');
  assert.ok(uf.indexOf('for (const side of [att, def])') < uf.indexOf("r.action === 'dot'"),
    '归位要早于 dot/buff/rest 那一支的分流');
  /* ④c 缺省停帧 = **最后一个有内容的帧**（闪避 `6432` 第 8~11 帧是空帧，停在 11 上等于把角色
   *   画没了 —— 演完闪避人消失一下，看起来就是"敌方 UI 一直闪"）。 */
  assert.ok(/function lastContentFrame\(clip\)/.test(uf) && /lastContentFrame\(clip\) - 1/.test(uf),
    'playClip 的缺省停帧要跳过尾部空帧（lastContentFrame）');
  /* ④d 带字的特效元件要**原地镜像**（见 `onClip` 的 TEXT_ART_SYMS）：三颗字型都是**正字烘焙**
   *   （6431 闪避 / 5864 师父驾到 / 6438 装死，独立挂载单看都是正的），敌方子树本来就镜像 →
   *   只给敌方补一次自翻。名单按"黄橙渐变 + 棕描边"的字形样式从包里扫出来，与代码常量必须一致。 */
  const wordSprites = [];
  for (const t of byId.values()) {
    if (!t || t.tp !== 39) continue;
    const hasWord = (t.Sf || []).some((p) => {
      if (!p || !p.id) return false;
      const shape = byId.get(String(p.id));
      if (!shape || shape.tp !== 2) return false;
      const grad = (shape.Fs || []).some((f) => f && f.tp === 2 && (f.sp || []).some((s) =>
        /252,89,1|242,205,3|252,139,1/.test(String(s['stop-color'] || '').replace(/\s/g, ''))));
      const stroke = (shape.Ls || []).some((l) => /135,46,3/.test(String(l.stroke || '')));
      return grad && stroke;
    });
    if (hasWord) wordSprites.push(String(t.id));
  }
  assert.deepEqual(wordSprites.sort(), ['5864', '6431', '6438'],
    '战斗包里的"字型"元件（闪避 / 师父驾到 / 装死）应与 TEXT_ART_SYMS 一致：' + wordSprites.join(','));
  assert.ok(/const TEXT_ART_SYMS = new Set\(\[5864, 6431, 6438\]\)/.test(uf),
    'TEXT_ART_SYMS 要列出这三颗字型元件');
  assert.ok(/const TEXT_ART_BAKED_MIRROR = new Set\(\)/.test(uf) &&
    /function orientTextArt\(clip, fighter\)/.test(uf) && /function retryOrientation\(clip, apply, tries\)/.test(uf),
    '三颗字型都是正字烘焙；预建时 fighter 还没挂上的要下一帧再补朝向');
  assert.ok(/function mirrorInPlace\(clip, retry\)/.test(uf) && /translate\(' \+ \(2 \* cx\)/.test(uf),
    '字型元件要绕自己的包围盒中心原地镜像（绕原点翻会把字甩出画面）');
  const html = fs.readFileSync(path.join(ROOT, 'scripts/index.html'), 'utf8');
  assert.ok(html.indexOf('js/ssfight/ui-fight.js') > 0 && html.indexOf('js/ssfight/ui-fight.js') < html.indexOf('js/main.js'),
    'ui-fight.js 必须在 main.js 之前加载');
}

/* ---------- 27. 「更换装备」= 原版 4673 第 3/4 帧（2026-10 第一百六十七批）----------
 * 用户口径："在装备界面，当前 更换装备 内的页面还是沿用的现代界面，我希望你能进一步对齐
 * ssfight 的表现，并使用 ssfight 中的贴图。"
 * 用最小 DOM 跑真实的 renderer / toolkit / status：点状态页那颗「更换装备」→ 应当挂出
 * 4673 的第 3 帧（六个格子 + 纸娃娃 + 容量），点某一格 → 第 4 帧（装备详情），返回回列表。 */
async function checkClassicGearPage({ env, Node, body }) {
  const gears = [
    { id: 1, used: true, key: 'g1', type: 0, quality: 1, ext: [], attr: 6, abilityVal: 6, attrName: '敏捷', useLevel: 3 },
    { id: 2, used: false, key: 'g2', type: 1, quality: 2, ext: [], attr: 9, abilityVal: 9, attrName: '力量', useLevel: 4 },
    { id: 20, used: false, key: 'g3', type: 1, quality: 4, ext: [{ id: 1, level: 1 }], attr: 12, abilityVal: 12,
      attrName: '力量', useLevel: 5, orange: true, gem: { id: 103, ext: 7 } },
  ];
  env.State.myGears = () => gears;
  env.State.gearsInDisplayOrder = () => gears;
  env.State.gearCapacity = () => 12;
  env.State.isGearStarred = () => false;
  env.State.gearSellRange = () => [55, 60];
  env.State.gemLevel = (id) => (Number(id) >= 101 && Number(id) <= 107 ? Number(id) - 100 : 0);
  env.State.gemPercent = (lv) => 5 * (lv * lv - lv + 2);
  env.State.extText = () => ['投掷武器暴击伤害-10%'];
  env.UI.classic.gearName = (id) => ['忍者面具', '勇者头盔', '仙鹤拳套'][Number(id) - 1] || ('装备' + id);
  env.UI.classic.modal = () => ({ element: new Node('div'), close() {} });
  assert.equal(await env.SfStatus.open(body.appendChild(new Node('section'))), true, '状态页要能挂上');
  const view = env.SfStatus.view();
  view.byName('b_change').g.dispatchEvent(new env.MouseEvent('click'));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const page = env.SfStatus.gearsDebug();
  assert.ok(page, '点「更换装备」应当挂出原版那一页');
  assert.equal(page.frame, 3, '「更换装备」= 库元件 4673 的第 3 帧');
  assert.equal(page.texts.t_count, '容量3/12', '容量那一格按原版写「容量N/M」');
  assert.equal(page.texts.t_1, '忍者面具', '第 1 格写装备名');
  assert.equal(page.texts.t_2, '勇者头盔');
  assert.equal(page.cells[0].key, 'g1');
  assert.equal(page.cells[0].iconFrame, 0, '已穿戴 → icon 停第 1 帧（小勾）');
  assert.equal(page.cells[1].iconFrame, 1, '未穿戴 → icon 停第 2 帧（空）');
  assert.equal(page.doll.mc_head, 1, '纸娃娃头部挂穿着中的那件');
  assert.equal(page.doll.mc_hand, 0, '没穿的部位不挂');
  /* 点第 3 格（c3 的放置深度 37；第 1 格 `c1` 的名字在导出里丢了，按深度认）→ 详情第 4 帧。
   * ⚠ 换页会**重挂**那一层（宿主里的 svg 整个换掉），所以每次都要重新取一次。 */
  const ui = body.querySelector('#ui');
  const overlaySvg = () => {
    const host = ui.childNodes[ui.childNodes.length - 1];
    return host && host.querySelector('svg');
  };
  assert.ok(overlaySvg(), '「更换装备」那一层应当挂出一棵 svg');
  const cell = overlaySvg().querySelectorAll('g[sid="4547"]').find((n) => n.getAttribute('depth') === '37');
  assert.ok(cell, '找得到第 3 格（深度 37）');
  cell.dispatchEvent(new env.MouseEvent('click'));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const detail = env.SfStatus.gearsDebug();
  assert.equal(detail.frame, 4, '点格子 → 原版详情页（4673 第 4 帧）');
  assert.equal(detail.texts.t_name, '装备20', '装备名没有字典条目时按「装备N」兜底');
  assert.equal(detail.texts.type, '手部', '部位文案照 doShowEquipInfo（头/手/身/脚四档）');
  assert.equal(detail.texts.level, '5', '等级那一格是使用等级');
  assert.equal(detail.texts.base, '力量+12');
  assert.equal(detail.texts.baseExtra, ' +40%', '橙装带宝石 → 主属性加成（3 级 = 5*(9-3+2)）');
  assert.equal(detail.texts.baseOther, '投掷武器暴击伤害-10%');
  assert.equal(detail.texts.baseOtherExtra, '', 'extraStr 那一列复刻没有数据源 → 必须留空');
  const back = overlaySvg().querySelectorAll('g[sid="3644"]').find((n) => n.getAttribute('depth') === '9');
  assert.ok(back, '详情页有返回键（3644 深度 9）');
  back.dispatchEvent(new env.MouseEvent('click'));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(env.SfStatus.gearsDebug().frame, 3, '返回回列表页');
  /* 关掉状态页时这一层也要一起收（原版 `clearCurrentWin()`）。 */
  env.SfStatus.destroy();
  assert.equal(env.SfStatus.gearsDebug(), null, '状态页销毁后「更换装备」那一层不许留下');
}

/* ---------- 30. 装备预上色矢量稿 / 宝箱确定键 / 随机对手难度 ----------
 * 只钉"页面该走哪条线"的源码与数据契约；颜色/观感仍以浏览器实拍为准。 */
function checkBalanceAndRewardContracts() {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
  const st = read('js/ssfight/ui-status.js');
  assert.ok(/const GEAR_COLOR_FILE = 'images\/ssfight\/ui\/gear-colors\.json'/.test(st)
    && /SfRender\.loadExtra\('tags-gear-color\.json'\)/.test(st)
    && /function gearArtIn\(/.test(st) && /gearArtIn\(cell, g, GEAR_CARD_ART/.test(st),
    '换装格 / 详情 / 纸娃娃要挂原版预上色矢量符号（gear-colors.json）');
  assert.ok(/if \(sid\) \{[\s\S]{0,500}?clip\.setExtraTransform\('scale\(' \+ s \+ '\)'\)/.test(st)
    && /gearArtIn\(clip, g, GEAR_SLOT_ART, GEAR_SLOT_MID, GEAR_SLOT_MID, 0\.85\)/.test(st)
    && !/fitArtwork\(clip, box, cx, cy\)/.test(st),
    '预上色符号自带整张卡：1:1 挂（纸娃娃 0.85），不能再 fitArtwork 缩成小卡');
  assert.ok(!/^\s*const S = S\(\)/m.test(st) && /const save = S\(\) \|\| \{\}/.test(st) && /save\.props\[id\]/.test(st),
    '宝石弹窗不能写局部 const S = S()：S 遮住 S() 会触发 TDZ，点击直接中断');
  assert.ok(/const b1 = clipOf\(view, 'b1'\)[\s\S]{0,600}?stopAt\(inner, g\.gem \? 2 : 1\)/.test(st)
    && /const b1Inner = b1Outer[\s\S]{0,200}?wireClickable\(b1Inner/.test(st),
    '「已镶嵌」的绿色高亮在内层 b1 按钮第 2 帧：外层只换按钮，idle 也要停绿帧');
  assert.ok(!/GEAR_PIC_BASE|attachGearPic/.test(st) && !/GEAR_ORANGE_TINT/.test(st),
    '经典换装页不能再贴现代界面正面 PNG / 叠加橙色滤镜');
  assert.ok(fs.existsSync(path.join(ROOT, 'images/ssfight/ui/tags-gear-color.json')) &&
    fs.existsSync(path.join(ROOT, 'images/ssfight/ui/gear-colors.json')),
    '预上色装备包与 gear-colors.json 必须存在');
  const gc = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/gear-colors.json'), 'utf8'));
  assert.ok(gc.byGear && gc.byGear['1'] && gc.byGear['1']['0'] && gc.byGear['1']['0']['0'],
    'gear-colors.json 要给出 byGear[装备id][品质][强化档] → 元件号');
  assert.ok(/orangeFrameTable/.test(st) && /orangeFrameTable\.get\(Number\(gear\.id\)\)/.test(st),
    '容器稿（战斗 / 兜底）的橙装仍要映射到 q4 橙稿帧');
  const um = read('js/ssfight/ui-main.js');
  assert.ok(/orangeFrameById/.test(um) && /orange && tables\.orangeFrameById/.test(um),
    'ui-main 的纸娃娃也要用 q4 橙稿帧');
  assert.ok(!/GEAR_PURPLE_FILTER/.test(um), '原版容器稿不再叠紫色滤镜');
  const uf = read('js/ssfight/ui-fight.js');
  assert.ok(/orangeFrameById/.test(uf) && /orange && t\.orangeFrameById/.test(uf),
    '战斗内玩家/对手的橙装也要走 q4 橙稿帧');
  assert.ok(/rec\.pickups && !rec\.o\.skipChest/.test(uf),
    'skipChest 时不能进开宝箱（竞技场/天梯/关卡连战）');
  assert.ok(/function mountChestConfirm\(chest, finish\)/.test(uf)
    && /SfUiFeedback\.bind\(hit, \{ shell: group \}\)/.test(uf)
    && /SfUiFeedback\.tap\(hit, finish, \{ delay: 120/.test(uf),
    '宝箱确定键要有热区 + 经典悬停/按下反馈，并立即 resolve');
  assert.ok(!/setTimeout\(finish, 3200\)/.test(uf) && /group\.style\.outline = 'none'/.test(uf),
    '宝箱页不许 3.2s 自动回退，确定键也不许出现 UA 蓝焦点框');
  assert.ok(/function makeNpcFighter\(/.test(uf) && /NPC_FRAME = \{ tl: 2, xh: 3, xm: 4, wood: 5 \}/.test(uf),
    '挑战中的三侠 / 木人要挂 7689 对应帧的原版矢量模型，不能一律用松鼠');
  const main = read('js/main.js');
  assert.ok(/skipChest: opts\.skipChest === true/.test(main), 'startBattle 要把 skipChest 传进战斗');
  const cu = read('js/classic-ui.js');
  assert.ok(/kind:'stage'[^\n]*skipChest:true/.test(cu), '关卡连战要 skipChest');
  const ce = read('js/classic-extras.js');
  assert.ok(/kind: 'arena'[^\n]*skipChest: true/.test(ce) && /kind: 'rank'[^\n]*skipChest: true/.test(ce),
    '竞技场/天梯要 skipChest');
  const state = read('js/state.js');
  assert.ok(/const RANDOM_FOE_SCALE = 1\.08;/.test(state), '随机对手难度系数 1.08');
  assert.ok(/const statScale = Number\(opts\.statScale\)/.test(state) && /foe\.statScale = statScale/.test(state),
    'genAI 只在最终战斗属性上乘 statScale，不改 baseStats');
  const ch = read('js/ssfight/ui-challenge.js');
  assert.ok(/statScale: State\.RANDOM_FOE_SCALE/.test(ch), '随机挑战要传 statScale');
  assert.ok(/function hideSubBackdrop\(view\)/.test(ch) && /hideSubBackdrop\(view\);/.test(ch),
    '动作菜单要收掉 4756 第 1 帧的 3142 蓝色蒙层');
  assert.ok(/function holdPageForBattle\(/.test(ch) && /function resumePageAfterBattle\(/.test(ch)
    && /const hold = holdPageForBattle\(\);/.test(ch) && /restore\('random'\)/.test(ch),
    '挑战战斗回来要复用原 DOM（战斗前摘下、结束后挂回），不许 destroy + 重新挂载闪一下');
  assert.ok(/SfChallenge\.holdPageForBattle\(\)/.test(cu)
    && /SfChallenge\.resumePageAfterBattle\(heldPage,'gates',\{keepSub\}\)/.test(cu)
    && /SfChallenge\.refreshGateAt\(gateType\)/.test(cu)
    && /SfChallenge\.view\(\)[\s\S]{0,120}?root\.isConnected/.test(cu)
    && /holdPageForBattle: holdPageForBattle/.test(ch) && /resumePageAfterBattle: resumePageAfterBattle/.test(ch)
    && /hold\.sub/.test(ch) && /refreshGateAt: \(t\) =>/.test(ch)
    && /if \(c && c\.stageFight\) \{ c\.stageFight\(id\); return; \}/.test(ch),
    '关卡连战要复用原版挑战页 + 三级页：战斗前摘下、onEnd 原样挂回；三级页用 refreshGateAt 只更新星标，不重新 mount 4756');
}

/* ---------- 31. 经典战斗三侠：现代图集填充 + 熊猫动作文件保留 ----------
 * 用户口径（2026-11）：保留 ssfight 熊猫动作文件；经典战斗的熊猫 / 螳螂 / 仙鹤
 * 先用现代播放器的战斗素材与动作逻辑补齐（松鼠本体仍走原经典矢量动画）。 */
function checkHeroAtlasFilling() {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
  const uf = read('js/ssfight/ui-fight.js');
  assert.ok(/const NPC_SHEETS = \{ tl: \['tl'\], xh: \['xh1', 'xh2'\], xm: \['xm1', 'xm2'\], wood: \['woodman1', 'woodman2'\] \};/.test(uf),
    '三侠按体型加载现代图集（tl / xh / xm）');
  assert.ok(/function makeAtlasNpcFighter\(/.test(uf) && /function makeStaticNpcFighter\(/.test(uf)
    && /function makeNpcFighter\([\s\S]{0,500}?npcAtlasReady\(npcType\)/.test(uf),
    '三侠优先走现代图集，图集没到时才退回 7689 静态稿');
  assert.ok(/Engine\.drawFrame\(ctx, frame, \{ sheets: NPC_SHEETS\[npcType\] \}\)/.test(uf)
    && /foreignObject/.test(uf) && /canvas\.width = 1170; canvas\.height = 690;/.test(uf),
    '现代 1170×690 动画画进透明画布，再铺到经典 320×196 舞台');
  assert.ok(/NPC_HIT_FRAME\[name\]/.test(uf) && /npcEffectName\(npcType, key\)/.test(uf)
    && /Engine\.loadSheets\(\[\.\.\.new Set\(ids\)\]\)/.test(uf),
    '命中帧、攻击特效与图集加载都接现代播放器的表');
  assert.ok(/if \(f\.hide\) \{ try \{ f\.hide\(\); \} catch \(e\) \{\} \}/.test(uf),
    '战果页 / 宝箱页要收掉三侠的图集层，避免压住结算');
  const env = { window: {}, console };
  env.window.State = { state: () => ({}) };
  env.window.SfRender = {};
  vm.createContext(env);
  vm.runInContext(uf, env);
  const SfFight = env.window.SfFight;
  assert.ok(SfFight && SfFight._npcAnim && SfFight.NPC_SHEETS, 'SfFight 要导出三侠动作表（回归 / 探针用）');
  assert.equal(SfFight._npcAnim('tl', 'common'), 'tl_common_attack');
  assert.equal(SfFight._npcAnim('xh', 'skill'), 'xh_skill_attack');
  assert.equal(SfFight._npcAnim('xm', 'hit'), 'xm_hitMe');
  assert.equal(SfFight.NPC_HIT_FRAME.xm_skill_attack, 8);
  assert.ok(fs.existsSync(path.join(ROOT, 'images/ssfight/heroes/Panda3.swf')), '熊猫的 ssfight 动作文件要保留');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/heroes/manifest.json'), 'utf8'));
  assert.equal(man.sourceSha1, '91a709c97d5f9729a9e69c84b1e1be98cb5469ad', '保留的熊猫动作文件与 source 一致');
}

/* ---------- 32. 经典竞技场：开始竞技 → 英雄帖 / 勇气徽章图标选择 ----------
 * 规则页只保留原版一颗「开始竞技」；点开经典小弹窗，左英雄帖 = 经验场，右勇气徽章 =
 * 碎片场。原版素材没有独立的竞技场文字元件，所以弹窗只放道具图，点图直接进场。
 * 扣费顺序与现代版一致：体力 > 本场对应券 > 另一张券兜底 > 体力药。 */
function checkClassicArenaPicker() {
  const uf = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  const ce = fs.readFileSync(path.join(ROOT, 'js/classic-extras.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/function showArenaRules\(\)[\s\S]*?startCompete[\s\S]{0,900}?CE\.chooseArena\(\)/.test(uf),
    '规则页只留一颗开始竞技，点击走经典选择弹窗');
  assert.ok(/stopAt\(statu, run\.matching \? 1 : 2\)/.test(uf)
    && /keepIds: \['7570'\]/.test(uf) && /dot\.clip\.playing = true/.test(uf),
    '4 人匹配页的省略号要放行原版 7570 的 12 帧动画（. .. ...），不能整页冻死');
  assert.ok(!/fragmentCompete/.test(uf), '规则页不该再并排挂第二颗开始竞技');
  assert.ok(/function chooseArena\(\)/.test(ce)
    && /data-arena-kind="0"[\s\S]{0,300}?icon\(36\)/.test(ce)
    && /data-arena-kind="1"[\s\S]{0,300}?icon\(39\)/.test(ce),
    '选择弹窗左侧英雄帖(36) = 经验场，右侧勇气徽章(39) = 碎片场');
  assert.ok(/chooseArena/.test(ce.slice(ce.indexOf('window.ClassicExtras'))), 'chooseArena 要导出给经典挑战页');
  const pay = ce.slice(ce.indexOf('function payArenaEntry'), ce.indexOf('function confirmArena'));
  assert.ok(pay.indexOf('if (s.energy >= NEED)') < pay.indexOf('takeItem(admission)')
    && pay.indexOf('takeItem(admission)') < pay.indexOf('takeItem(other)')
    && pay.indexOf('takeItem(other)') < pay.indexOf('autoEnergyPotion'),
    '扣费顺序：体力 > 对应券 > 另一张券 > 体力药（现代版口径）');
  assert.ok(/function arenaRules\(\)[\s\S]{0,300}?goArenaPage\('rules'\)/.test(ce)
    && /arenaRules\(\);/.test(ce) && /const backHome = \(\) => arenaRules\(\)/.test(ce),
    '竞技决赛战果要回到有「开始竞技」的规则页（7638 第 4 帧），不能回竞技场首屏');
}


/* ---------- 33. 天梯赛：二次确认 → 战斗准备中 → 开打 → 回原版页 ----------
 * 原版 `alertRank`（:23720）首次/免费场用完先弹 `makeSure`；`beforeRank`（:18149）
 * 摆 3464「战斗准备中」3 秒再开；打完 `back()` 回 7638 第 7 帧，再把战果压上去。 */
function checkClassicRankFlow() {
  const ce = fs.readFileSync(path.join(ROOT, 'js/classic-extras.js'), 'utf8').replace(/\r\n/g, '\n');
  const uc = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/function startRankFlow\(after, opts\)/.test(ce) && /startRankFlow,/.test(ce),
    '天梯经典入口要独立于 `rankMatch`（现代页/旧回归仍可直接开打）');
  /* 经典天梯的金杯商店**直接复用道具页「商店」的版面与鼠标反馈**，只换商品/售价。 */
  assert.ok(/function rankGoodsList\(\)/.test(ce) && /function rankBuy\(goodsId, onDone\)/.test(ce)
    && /rankGoodsList, rankBuy, rankLimitInfo, rankMatch/.test(ce),
    '经典金杯商店的商品/兑换逻辑要留在 classic-extras（rankGoodsList / rankBuy / rankLimitInfo）');
  assert.ok(/UI\.currentUiMode\(\) === 'classic'[\s\S]{0,240}?UI\.classic\.openRankShop\(pg \|\| 0, origin \|\| 'ladder'\)/.test(ce),
    'rankShop 在经典模式要开道具页同款金杯商店，并把来源传给返回逻辑');
  assert.ok(/function openRankShop\(pg, origin\)[\s\S]{0,9000}?catalog-grid bag-grid/.test(cu)
    && /data-rank-good/.test(cu)
    && /wirePopTaps\(p, \{ tabs: true, cells: true, arrows: true \}\)/.test(cu)
    && /CE\.rankBuy\(g\.id/.test(cu)
    && /mountRankShopBack\(p, leave\)/.test(cu)
    && /SfChallenge\.goArenaPage\('menu'\)/.test(cu)
    && /backTo === 'shop'[\s\S]{0,120}?UI\.runAction\('shop'\)/.test(cu),
    '金杯商店要复用商店页的 6 格/右侧说明/翻页/悬停反馈，返回键用原版 3911，并按来源回商店或天梯菜单');
  assert.ok(/SfRender\.mountSymbol\(host, '3911'/.test(cu)
    && /noFooter: true/.test(cu),
    '金杯商店返回键直接挂原版 3911，不再自建底栏返回键');
  assert.ok(/s\.joinRankCount === 0 \|\| s\.joinRankCount > 9/.test(ce)
    && /C\(\)\.modal\('天梯赛'/.test(ce),
    '首次 / 免费场用完先弹经典二次确认（原版 alertRank）');
  assert.ok(/SfRender\.mountSymbol\(host, '3464'/.test(ce)
    && /viewBox: '-20 -35 360 250'/.test(ce)
    && /setTimeout\(r, 3000\)/.test(ce)
    && /set\('name1', s\.name/.test(ce),
    '确认后摆原版 3464「战斗准备中」3 秒（双方名字 / 积分）');
  assert.ok(/CE\.startRankFlow\(\(\) => goArenaPage\('menu'\)\)/.test(uc)
    && /function waitArenaView\(/.test(uc)
    && /return waitArenaView\(\);/.test(uc),
    '经典天梯菜单走 startRankFlow；页面异步挂载时先等背景回来');
  assert.ok(/onEnd: async winner =>[\s\S]{0,900}?await back\(\)[\s\S]{0,200}?outcome\(/.test(ce),
    '战果弹窗要等背景页恢复后再开（避免被 openChallenge 的 innerHTML 清掉）');
  assert.ok(/Promise\.race\(\[[\s\S]{0,200}?State\.fileLoad\(\)[\s\S]{0,200}?'__timeout__'/.test(main)
    && /loadTimedOut/.test(main) && /存档读取超时/.test(main),
    'boot 95% 要有超时兜底：磁盘读卡住时先按本地存档进游戏');
}

/* ---------- 34. 主界面装备配色对齐「我的装备」卡 ----------
 * 「我的装备」卡走 `gearColorId`：强化档取 ext 数组的最大 level；衣服/鞋子不看强化档。
 * 主界面之前对 `g.ext` 做 `Number()`（数组→NaN），强化偏移整段丢失，颜色停在基础帧；
 * 衣服/鞋子还多加了强化帧，滑到下一档配色。现在两边同一口径。 */
function checkGearColorParity() {
  const main = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const status = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const [file, src] of [['ui-main', main], ['ui-status', status]]) {
    assert.ok(/const raw = g\.ext|const raw = gear\.ext/.test(src), file + ' 要强化档直接读 ext');
    assert.ok(/raw\.reduce\(\(m, e\) => Math\.max\(m, Number\(e && e\.level\) \|\| 0\), 0\)/.test(src),
      file + ' 强化档必须取 ext 数组里的最大 level，不能 Number(数组)');
    assert.ok(/\(Number\(g\.type\) === 0 \|\| Number\(g\.type\) === 1\) && extMax > 0 \? extMax - 1 : 0/.test(src) ||
      /\(Number\(gear\.type\) === 0 \|\| Number\(gear\.type\) === 1\) && extMax > 0 \? extMax - 1 : 0/.test(src),
      file + ' 只有头/拳套加强化帧，衣服/鞋子与卡片同口径');
  }
  assert.ok(/Math\.max\(0, Math\.min\(5, Number\(gear\.quality\) \|\| 0\)\)/.test(status)
    && /function gearExtMaxLevel/.test(status),
    '「我的装备」卡仍按品质 + ext 最大档取预上色符号');
  assert.ok(/orangeFrameTable\.get\(Number\(gear\.id\)\)/.test(status)
    && /orangeFrameTable\.set\(Number\(g\.id\), f\)/.test(status),
    '状态页橙稿也按 gear.id 查表：State.myGears() 没有 name 字段');
  assert.ok(/orangeFrameById\.set\(Number\(g\.id\), f\)/.test(main),
    '主界面橙稿按 id 建表，与状态页同口径');
}

/* ---------- 35. 经典「收为徒弟」：原版确认帧 + 10 金松果收徒挑战 ----------
 * 原版 `doAction(4)` → `showGetStuWin()`（4756 第 2 帧）→ `getStudent(2,wz)`：
 * 扣 10 金松果、打一场 fightType=2 的收徒挑战，赢了才 `prentices.push`。 */
function checkRecruitChallengeFlow() {
  const uc = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/if \(foe\.kind === 'friend' && !foe\.stranger\) \{ openRecruitConfirm\(foe\); return; \}/.test(uc),
    '好友菜单的「收为徒弟」必须先走收徒确认，不能直接 addPrentice');
  assert.ok(/const pending = openSub\(2\);/.test(uc)
    && /clipOf\(view, 'button1'\)/.test(uc) && /clipOf\(view, 'button2'\)/.test(uc),
    '确认用原版 4756 第 2 帧（确定/取消）');
  assert.ok(/State\.beginRecruitChallenge\(foe\)/.test(uc)
    && /State\.finishRecruitChallenge\(token, winner === 0\)/.test(uc)
    && /State\.cancelRecruitChallenge\(token\)/.test(uc),
    '确认后必须走 State 的收徒挑战（10 金松果、输赢都扣；中断退款）');
  assert.ok(/kind: 'master', useProps: true/.test(uc) && /keepScreen: true/.test(uc),
    '收徒挑战是真实战斗，不是白送徒弟');
  assert.ok(!/State\.addPrentice\(foe\)/.test(uc), '经典挑战页不能再直接 addPrentice');
}

/* ---------- 36. 经典主界面礼包/活动：有未处理奖励时的提示动效 ----------
 * 现代界面 `dailyAttention()` 在每日礼包/每日任务/徒弟日供可领时给活动图标加 attention；
 * 经典 `SfUiMain` 的 DOM 礼包按钮以前没有这条状态，图标一直静的。 */
function checkClassicGiftAttention() {
  const main = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/function giftAttention\(\)/.test(main)
    && /State\.dailyStatus\(\)\.claimed/.test(main)
    && /State\.questClaimable\(\) > 0/.test(main)
    && /ClassicExtras\.tributeStatus/.test(main),
    '礼包提示要覆盖每日礼包 / 每日任务 / 徒弟日供三项');
  assert.ok(/function syncGiftAttention\(container\)/.test(main)
    && /classList\.toggle\('attention', att\)/.test(main)
    && /aria-label/.test(main),
    '活动按钮要按可领取状态加/去 attention，并更新 aria-label');
  assert.ok(/addGiftButton[\s\S]{0,600}?syncGiftAttention\(container\)/.test(main)
    && /syncGiftAttention\(view && \(view\.el \|\| view\.g\)\)/.test(main),
    '礼包按钮创建时和每秒 refreshValues 都要同步状态，领完奖会停');
  assert.ok(/\.ssfight-gift\.attention\{animation:gift-attention-pulse/.test(css)
    && /@keyframes gift-attention-pulse/.test(css)
    && /@keyframes gift-attention-glow/.test(css)
    && /\.ssfight-gift\.attention::before/.test(css),
    '经典礼包图标要用自己的脉冲 + 光晕，不能复用 translateY 基准不一致的 picture-button 动画');
}

  const dailyUi = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const levelUp = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-levelup.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/function giftIcon\(id\) \{ return Number\(id\) === 8 \? goldIcon\(\) : icon\('prop', id\); \}/.test(dailyUi)
    && /giftIcon\(g\.id\)/.test(dailyUi) && /d\.extra/.test(dailyUi) && /daily-gift-preview/.test(dailyUi),
    '经典礼包/每日奖励里的金松果要用经典 gold-acorn，并显示当天轮换道具');
  assert.ok(/icon\.kind === 'prop' && Number\(icon\.id\) === 8\) return 'images\/ui\/icons\/gold-acorn\.png'/.test(levelUp),
    '经典升级礼包四格里的金松果也要用经典图标');


/* ---------- 37. 经典系统页：三个页签 / 保留分区标题 / 两排设置 + 音乐胶囊 ---------- */
function checkClassicSystemStyle() {
  const ui = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const extras = fs.readFileSync(path.join(ROOT, 'js/classic-extras.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/system: \[\['system','系统'\],\['help','帮助'\],\['vip','超级松鼠'\]\]/.test(ui),
    '系统页签应为 系统 / 帮助 / 超级松鼠，不再有村庄');
  for (const title of ['关于复刻版', '游戏设置', '存档位置', '跨设备同步', '游戏更新']) {
    assert.ok(ui.includes('classic-section-title">' + title), '系统页缺少分区标题：' + title);
  }
  assert.ok(/\.classic-section-title\{[\s\S]{0,400}?background:linear-gradient\(#7b4d2c,#5d351c\)/.test(css)
    && /border:4px solid #f4e3ba/.test(css),
    '分区标题保留棕色圆牌 + 米色描边');
  assert.ok(!/\.classic-tabs\.system-tabs/.test(css), '顶部页签不恢复 system-tabs 皮肤替换');

  /* 系统分组：页签字号 / 金色未选中 / 绿色选中 / 音乐胶囊 / 公共反馈 */
  const sysAt = ui.indexOf('function openSystem()');
  const sysBody = ui.slice(sysAt, ui.indexOf('function importSave()', sysAt));
  assert.ok(sysAt > 0 && sysBody.length > 0, '找不到系统页实现');
  assert.equal((sysBody.match(/sysBtn\(/g) || []).length, 6,
    '去掉音乐开关后，游戏设置应为 6 颗键、刚好两排');
  assert.ok(!/sysBtn\(mute\?/.test(sysBody), '不再有独立的「音乐：开/关」按钮');
  assert.match(sysBody, /class="settings-head"><h3 class="classic-section-title">游戏设置<\/h3>'\+slider\+'<\/div>'\+grid/,
    '音乐音量与游戏设置标题同排，按钮网格保持两排');
  assert.match(sysBody, /music-setting[\s\S]{0,800}?music-toggle/, '音乐音量改成设置键同款胶囊 + 开关热区');
  assert.match(sysBody, /wireSystemFeedback\(p\)/, '系统页接公共选中/点击反馈');
  assert.match(ui, /function wireSystemFeedback\(root\)[\s\S]{0,900}?f\.bind\(n[\s\S]{0,900}?f\.pick\(t\)/,
    '系统分组页要绑定悬停/按下并补点击回弹');
  assert.match(ui, /function openHelp\(\)[\s\S]{0,1800}?wireSystemFeedback\(p\)/, '帮助页同步反馈');
  assert.match(extras, /C\(\)\.wireSystemFeedback\(p\)/, '超级松鼠页同步反馈');
  assert.match(css, /\.classic-tabs\[data-group="system"\] \.uc-tab\{font-size:48px\}/,
    '系统 / 帮助 / 超级松鼠的页签字号略微缩小');
  assert.match(css, /\.sf-system-ui \.uc-button:not\(\.gold\):not\(\.muted\):not\(\.on\):not\(:disabled\)\{[\s\S]{0,180}?#fff6a1/,
    '未选中的系统按钮是金色');
  assert.match(css, /\.sf-system-ui \.uc-button\.on\{[\s\S]{0,180}?#d2f497/, '选中的系统按钮是绿色');
  assert.match(css, /\.setting-slider\.music-setting\.on\{[\s\S]{0,180}?#d2f497/, '音乐开启时胶囊转绿');
  assert.match(css, /\.sf-system-ui \.help-item\{[\s\S]{0,120}?#fff9df/, '帮助物品格同步未选中黄色');
}

/* ---------- 38. 查看敌人：灰武器/技能、返回不刷新、查看装备文字收紧 ---------- */
function checkFriendViewPolish() {
  const st = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  const ch = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  /* 好友切磋：局内不飘奖励、战后不开宝箱（用户 2026-11 口径）。 */
  assert.match(ch, /collectDrops: !friend,[\s\S]{0,160}?skipChest: friend/,
    '经典挑战页好友切磋：局内不飘奖励、战后不开宝箱');
  assert.match(cu, /cost:0,kind:'friend',useProps:false,collectDrops:false,skipChest:true/,
    'DOM 好友页切磋也不能有悬浮奖励与宝箱');
  const grid = st.slice(st.indexOf('function friendGridInfo('), st.indexOf('function paintCell('));
  assert.match(grid, /lockedIcon: C\.wsIconOf \? C\.wsIconOf\(kind, it\.id, true\) : null/,
    '查看敌人时没获得的武器/技能也要挂 lockedIcon（和玩家一样显示灰卡，而不是空槽）');
  assert.match(st, /openFriend: \(foe, backTo\) => \{[\s\S]{0,700}?sf-friend-view[\s\S]{0,700}?overlay: true/,
    '查看敌人要在挑战页上盖一层（overlay），不能清空底页');
  assert.match(st, /const overlayHost = current && current\.overlay \? current\.container : null;/,
    '拆查看页时要把 overlay 那层空 section 一起摘掉');
  const back = st.slice(st.indexOf('function markFriendBackLabel('), st.indexOf('function wireFrameButtons('));
  assert.match(back, /querySelectorAll\(':scope > \[depth="6"\]'\)[\s\S]{0,900}?textContent = '返回'/,
    '3911 不可用时才退回原 back + 自绘「返回」文字');
  assert.match(st, /if \(o\.friend\) \{ try \{ await SfRender\.loadExtra\('tags-challenge\.json'\)/,
    '查看敌人时要先加载 3911 所在的挑战包');
  assert.match(st, /useStageBack\(view, '3911', 1, 160\.3, 175\.5, 1, 'friend-view-back', '__friendViewBack'\)/,
    '查看敌人的返回键要复用关卡「挑战」页的 3911：位置/尺寸对齐，默认第 1 帧黄色');
  assert.match(st, /wireClickable\(stageBack, \{ hover: 2, press: 2, idle: 1, onFire: leaveFriendView \}\)/,
    '3911 悬停/按下要切第 2 帧绿色，离开回第 1 帧黄色');
  assert.match(st, /delBtn[\s\S]{0,200}removeFriendFromView/,
    '左下「删除好友」要接删除确认，不能落到查看装备');
  assert.match(st, /leaveBtn[\s\S]{0,200}openFriendMessage/,
    '右下「留言」要接留言界面，不能落到查看装备');
  const ofd = ch.slice(ch.indexOf('function openFriendDetail('), ch.indexOf('function openFriendGears('));
  assert.ok(!/destroy\(\);/.test(ofd), '查看好友不能 destroy 挑战页');
  assert.match(ofd, /if \(!current && window\.UI && UI\.runAction\) UI\.runAction\('challenge'\)/,
    '挑战页还在时返回不重开挑战页（敌人名单不刷新）');
  const tune = st.slice(st.indexOf('const FRIEND_GEAR_TEXT ='), st.indexOf('function openFriendGearsOverlay('));
  assert.match(tune, /addr: \{ size: 8\.2, dx: 15, dy: 12, step: 13\.4 \}/,
    '查看装备的附加属性要收小字号、右移、下移并拉开行距');
  assert.match(st, /tuneFriendGearText\(tab\);/, '四格装备写完要调用文字收紧');
  assert.match(css, /#ui:has\(>section\.sf-friend-view\)>section\.classic-home:not\(\.sf-friend-view\):not\(\.ssfight-sub\)\{visibility:hidden\}/,
    '查看敌人时只藏底页，武器/装备详情层不能一起藏掉');
}

/* ---------- 39. 查看装备返回 / 关卡同款返回键 / 随机名单缓存 / 敌人查看主背景 ---------- */
function checkFriendViewRound2() {
  const st = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  const ch = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  const back = st.slice(st.indexOf('function wireFriendGearsBack('), st.indexOf('function openFriendGearsDom('));
  assert.match(back, /attachChild\('3911', 1, 'friend-back'\)/,
    '查看装备的返回键要换成关卡二级页的原版 back 3911');
  assert.match(back, /matrix\(1,0,0,1,160\.3,175\.5\)/,
    '3911 的落点照 4756 f5 的放置矩阵');
  assert.match(back, /for \(const n of oldParts\) n\.style\.display = 'none'/,
    '藏掉 4673 f7 自带的绿返回键形状');
  assert.match(back, /closeFriendGearPage\(\)/, '新返回键点击只回状态页');
  const overlay = st.slice(st.indexOf('function openFriendGearsOverlay('), st.indexOf('function closeFriendGearPage('));
  assert.match(overlay, /loadExtra\('tags-challenge\.json'\)/,
    '挂 3911 前要确保 tags-challenge 已加载');
  assert.match(ch, /let randomCache = null;/);
  const sr = ch.slice(ch.indexOf('function showRandom('), ch.indexOf('function showFriends('));
  assert.match(sr, /randomCache = \{ state: s, roster: rollRoster\(\) \}/, '随机页要用缓存抽名单');
  assert.match(sr, /current\.roster = randomCache\.roster/, '重进随机页复用同一批名单');
  assert.match(ch, /randomCache = null;\s*showTab\('random'\)/, '手动刷新玩家仍要重抽');
  assert.match(ch, /hold\.page\.roster = null;[\s\S]{0,120}?randomCache = null;/, '打完一场回来要重抽');
  assert.match(ch, /resetRoster: \(\) => \{ randomCache = null;/, 'resetRoster 要清缓存');
  assert.match(css, /\.sf-friend-view\{[^}]*3182_0\.hd\.jpg/, '查看敌人背景要用主界面底图');
  assert.ok(/const FRIEND_GEAR_ICON_DX = 2\.4;/.test(st)
    && /slot\.setExtraTransform\('translate\(' \+ FRIEND_GEAR_ICON_DX/.test(st),
    '查看装备的图标块要整体右移一点（c1 局部平移）');
}

/* ---------- 40. 升级奖励页：原版 7795 版式 + 现代奖励数据 ---------- */
function checkLevelUpStyle() {
  const lv = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-levelup.js'), 'utf8').replace(/\r\n/g, '\n');
  const fr = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight-result.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const html = fs.readFileSync(path.join(ROOT, 'scripts/index.html'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    html.indexOf('js/ssfight/ui-levelup.js') >= 0 &&
    html.indexOf('js/ssfight/ui-levelup.js') < html.indexOf('js/ssfight/ui-fight-result.js') &&
    /mountSymbol\(host, '7795'/.test(lv) &&
    /byName\('fourProperties'\)/.test(lv) &&
    /hasLevelUp\(options\)/.test(fr) &&
    /SfLevelUp\.open\(options\.ups, \(\) => \{[\s\S]{0,220}?promptLevelUpChoices\(\)/.test(fr) &&
    /levelUpUi \? '' : stageUpsHtml/.test(cu) &&
    /\.sf-levelup-view\{[^}]*z-index:60/.test(css),
    '升级奖励要挂原版 7795 升级页，并保留现代奖励与后续三选一/加点'
  );
}

/* ---------- 41. 新手引导：原版 3625 + 首段 1~7 帧 ---------- */
function checkGuide() {
  const g = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-guide.js'), 'utf8').replace(/\r\n/g, '\n');
  const main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const html = fs.readFileSync(path.join(ROOT, 'scripts/index.html'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  const tags = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/tags-guide.json'), 'utf8'));
  assert.ok(
    tags.some((t) => String(t.id) === '3625') &&
    /tags-guide\.json/.test(g) && /SYMBOL = '3625'/.test(g) &&
    /step: Number\(S\.level\) <= 1 \? 1 : 99/.test(g) &&
    /stepNo === 4 \|\| stepNo === 5/.test(g) && /stepNo === 6/.test(g) &&
    /SfGuide\.onHome/.test(main) && /SfGuide\.onBattleStart/.test(main) &&
    /SfGuide\.onPage\('challenge'\)/.test(cu) && /SfGuide\.onPage\('message'\)/.test(cu) &&
    /const TARGET_ART = new Set\(/.test(g) && /highlightTargets\(view, spec\.frame\)/.test(g) &&
    /stepNo === 3/.test(g) &&
    /#ui>\.sf-guide-view\{[^}]*pointer-events:none/.test(css) &&
    html.indexOf('js/ssfight/ui-guide.js') > 0 &&
    html.indexOf('js/ssfight/ui-guide.js') < html.indexOf('js/ssfight/ui-fight-result.js'),
    '新手引导要挂原版 3625，并用首页/战斗/消息/背包原有入口推进首段步骤'
  );
}

/* ---------- 42. 反击受击时序 / 小宇宙字标 ---------- */
function checkBattleReactionPolish() {
  const fr = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  const counter = fr.slice(fr.indexOf('async function runCounter('), fr.indexOf('function applyHp('));
  assert.ok(
    /const settle = \(\) => \{[\s\S]*?startReaction\(\)/.test(counter) &&
    /await defender\.attackBack[\s\S]{0,120}?if \(reaction\) await reaction/.test(counter) &&
    /5940, 5952, 5956/.test(fr) &&
    /5940: 1, 5952: 1, 5956: 1/.test(fr) &&
    /function orientTextArt\(clip, fighter\) \{[\s\S]{0,320}?stopAt\(clip, 1\)/.test(fr),
    '反击命中时就要起我方受击/归位，不能等对方攻击动画播完；小宇宙/闪避的镜像字标要停在正字帧并给敌方补自翻'
  );
}

/* ---------- 43. 新号默认 / 礼包等级 / 引导背包落点 ---------- */
function checkOnboardingDefaults() {
  const ui = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const st = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8').replace(/\r\n/g, '\n');
  const main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const g = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-guide.js'), 'utf8').replace(/\r\n/g, '\n');
  const dbg = fs.readFileSync(path.join(ROOT, 'js/debug.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /function giftUnlocked\(\)[\s\S]{0,160}?level\) >= 3/.test(ui) &&
    /function syncGiftVisibility\(/.test(ui) &&
    /Number\(S\.level\)\s*<\s*3/.test(cu) &&
    /const DEFAULT_SAVE_SLOT = 'classic';/.test(st) &&
    /S\.settings\.uiMode = mode;/.test(st) &&
    /UI\.applyUiMode\(State\.settings\(\)\.uiMode\)/.test(main) &&
    /catalog-cell\[data-prop\] \.item-icon/.test(g) &&
    /function resetAccount\([\s\S]{0,1600}?Main\.showHome\(\)/.test(dbg),
    '新号默认经典；礼包/每日抽奖 3 级前不可用；查看装备引导的背包落点要按真实道具中心'
  );
}

/* ---------- 44. 经典背包/商店悬停选中 + 单击详情 + f7 框左移 ---------- */
function checkBagDetailClicks() {
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const g = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-guide.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /b\.addEventListener\('pointerenter',\s*\(\)\s*=>\s*selectProp\(\+b\.dataset\.prop\)\)/.test(cu) &&
    /const choose=\(\)=>\{ selectProp\(id\); openPropEntry\(id\); \}/.test(cu) &&
    !/clickedProp/.test(cu) && !/prop-sell/.test(cu) && !/可回收/.test(cu) &&
    /currentUiMode\(\) !== 'classic'/.test(cu) && /data-sell-prop/.test(cu) &&
    /State\.sellProp\(id, 1\)/.test(cu) &&
    /addRing\(ir, before \|\| nodes\[0\] \|\| null, stepNo === 7 \? -16 : 0\);/.test(g),
    '经典背包/商店要鼠标移入即绿色选中、单击直接开二级窗；经典不显示卖出，现代背包保留卖出；f7 金环仍左移'
  );
}

/* ---------- 引导 8~26：背包使用 / 升级页确定 / 状态页页签 / 村庄四地点 / 等级事件 ---------- */
function checkGuideLateSteps() {
  const g = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-guide.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const st = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  const fr = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight-result.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /const LEVEL_STEPS = \{ 4: 21, 5: 13, 10: 23, 15: 24, 20: 17, 25: 19, 30: 20, 35: 26 \}/.test(g) &&
    /23: \{ frame: 16, ms: 4000, next: 99 \}/.test(g) &&
    /25: \{ frame: 24, ms: 4000, next: 99 \}/.test(g) &&
    /26: \{ frame: 25, ms: 0 \}/.test(g) &&
    /13: \{ frame: 13, ms: 0, above: true \}/.test(g) &&
    /'3599', '3602', '3609'/.test(g) &&
    /13: \(\) => document\.querySelector\('\.sf-levelup-view \[depth="20"\]'\)/.test(g) &&
    /SfGuide\.onPropDetail\(id, mode\)/.test(cu) &&
    /SfGuide\.onPropUsed\(id,base\.name,r,m\)/.test(cu) &&
    /SfGuide\.onPage\(key\)/.test(cu) && /SfGuide\.onPage\('status'\)/.test(cu) &&
    /SfGuide\.onPage\('village'\)/.test(ui) && /SfGuide\.onStatusTab\(which\)/.test(st) &&
    /SfGuide\.onLevelup\(options && options\.ups\)/.test(fr) &&
    /SfGuide\.onLevelupDone\(options\.ups\)/.test(fr) &&
    /#ui>\.sf-guide-view\.above\{z-index:65\}/.test(css),
    '引导 8~26 要接背包详情/使用/提示、升级页「确定」、状态页页签与村庄四地点，并按等级事件推进'
  );
}

/* ---------- 45. 负场开宝箱背景用失败 CG ---------- */
function checkChestDefeatBackground() {
  const fr = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /const winner = Number\(rec\.result && rec\.result\.winner\) === 1 \? 1 : 0;/.test(fr) &&
    /href\.indexOf\('7748_0'\) < 0/.test(fr) &&
    /7741_0\.hd\.jpg/.test(fr) &&
    /stopAt\(backgd, winner === 0 \? 1 : 2\)/.test(fr),
    '负场开宝箱的背景要换成 7741 失败 CG，不能沿用 7748 的胜利背景；战果页 backgd 也要按胜负选帧'
  );
}

/* ---------- 46. 双界面独立存档 / 经典模式隐藏调试 ---------- */
function checkDualSaveAndDebugGate() {
  const st = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const dbg = fs.readFileSync(path.join(ROOT, 'js/debug.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /const SAVE_SLOTS = \['modern', 'classic'\];/.test(st) &&
    /__dualOther/.test(st) && /function switchMode\(mode\)/.test(st) &&
    /State\.switchMode\(m\)/.test(cu) &&
    /两套独立存档/.test(cu) && /function requestMode\(mode\)/.test(cu) &&
    /const DEBUG_IN_CLASSIC = false;/.test(dbg) &&
    /function debugAllowed\(\)/.test(dbg) &&
    /gear\.style\.display = ok \? '' : 'none'/.test(dbg),
    '经典/现代要各用独立槽位并在切换时提示；经典界面默认隐藏调试入口但保留开发者开关'
  );
  /* 经典首页是 ssfight 原版整页（`.ssfight-home`），没有 DOM 版那几个 `.home-name` 节点。
   * `refreshHome` 不提前返回就会在 `$('.home-name',h).textContent` 抛错；调试面板的
   * 遗忘/获得是先改 State、再调 `UI.refreshHome()`、最后 `renderOwned()`，于是 × 看起来
   * “删了但没反应”。这条钉住 ssfight 首页的提前返回。 */
  assert.ok(
    /function refreshHome\(\) \{[\s\S]{0,1800}?if \(h\.classList && h\.classList\.contains\('ssfight-home'\)\) return;/.test(cu),
    '经典 refreshHome 遇到 ssfight 原版首页必须提前返回，否则调试面板的「遗忘武技」会在 State 已删之后抛错、面板不刷新'
  );
}

/* ---------- 47. 村庄建筑等级 / 升级 / 幻兽牧场功能 ---------- */
function checkVillageBuildings() {
  const main = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const vil = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-village.js'), 'utf8').replace(/\r\n/g, '\n');
  const st = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8').replace(/\r\n/g, '\n');
  const gd = fs.readFileSync(path.join(ROOT, 'js/gamedata.js'), 'utf8').replace(/\r\n/g, '\n');
  const fr = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /homeMc\.num1/.test(main) && /const altarNum = rel\('num1'\)/.test(main) && /blankNames: \[\]/.test(main) &&
    /showBuildingLevel/.test(vil) && /function openHatchModal\(/.test(vil) && /function openTeamModal\(/.test(vil) &&
    /function openFeedModal\(/.test(vil) && /function openEvolveModal\(/.test(vil) &&
    /mountSymbol\(host, '4280'/.test(vil) && /ssfight-pet-art/.test(vil) && /ch \* 0\.16/.test(vil) &&
    /function layoutScale\(host\)/.test(vil) && /function hidePetLevel\(cell\)/.test(vil) &&
    /function hideCarriedOver\(host\)/.test(vil) && /function hideAllPetLevels\(host\)/.test(vil) &&
    /tables\.containerIds\[ty\] && tables\.containerIds\[ty\]\[which\]/.test(main) &&
    /symbol: String\(s\.containerId\)/.test(main) &&
    /function hatchPet\(/.test(st) && /hatchPoint/.test(st) && /petsCapacity/.test(st) &&
    /const PETS = \[/.test(gd) &&
    /try \{ paintBuildingNumbers\(\); paintBuildTimers\(\); \} catch/.test(main) &&
    /function petBattleBonus\(/.test(st) && /function randomPetLoadout\(/.test(st) &&
    !/showPetLineup\(/.test(fr) && /applyPetBonuses\(me/.test(fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8')),
    '村庄要显示祭坛/神迹/幻兽等级，升级能落地，幻兽牧场要有孵化/编队/喂养/进化并接入战斗/敌人随机'
  );
  /* 重挂牧场页时 `mountSymbol(host,…)` 会清掉旧宿主子节点，缓存探针因此脱离 DOM，
   * `getBoundingClientRect().width` 变 0 → layoutScale 退回 1 → 新孵出的幻兽图偏右偏大。
   * 探针必须判 isConnected 并重建。 */
  assert.ok(/if \(!p \|\| !p\.isConnected\)/.test(vil) && /host\.__petProbe = p/.test(vil),
    '幻兽牧场重挂后缩放探针要判 isConnected 并重建，否则孵出的幻兽图会偏右偏大');
  assert.ok(/function wireClickable\(clip, onFire, opts\)/.test(vil)
    && /hoverFrame = \(opts && opts\.hover != null\)/.test(vil)
    && /wireClickable\(left, \(\) => \{ if \(beastPage > 1\)[^\n]*\}, \{ hover: 1 \}\)/.test(vil)
    && /wireClickable\(right, \(\) => \{ if \(beastPage < pageCount\)[^\n]*\}, \{ hover: 1 \}\)/.test(vil),
    '幻兽牧场翻页键 3156 第 2 帧是空帧：悬停必须保持第 1 帧，不能一移上去就隐形');
}

/* ---------- 48. 经典村庄幻兽信息 / 征战塔外壳 ---------- */
function checkClassicTowerShell() {
  const vil = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-village.js'), 'utf8').replace(/\r\n/g, '\n');
  const tw = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const ff = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  const ce = fs.readFileSync(path.join(ROOT, 'js/classic-extras.js'), 'utf8').replace(/\r\n/g, '\n');
  const ch = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /孵化点：' \+ \(Number\(\(State\.state\(\) \|\| \{\}\)\.hatchPoint\)/.test(vil) &&
    /格子 ' \+ list\.length \+ '\/' \+ cap/.test(vil) &&
    /function classicTower\(\)/.test(tw) && /classicTowerBar\(\)/.test(tw) && !/classic-tower-title/.test(tw) &&
    /function classicTowerBackground\(mode, layer\)/.test(tw) && /applyClassicTowerBg\(p, 'endless'/.test(tw) && /% 100/.test(tw) &&
    /html\[data-ui-mode="classic"\] \.classic-page\.classic-tower,/.test(css) &&
    /\.classic-page\.classic-tower\{background:var\(--tower-bg,#4c7c50\)/.test(css) &&
    !/classic-tower\{background:linear-gradient/.test(css) &&
    /data-classic-foe/.test(tw) && /'7232'/.test(tw) && /function attachClassicGear/.test(tw) &&
    /function backToVillageWar\(\)/.test(tw) && !/village-war/.test(tw.slice(tw.indexOf('function backToVillageWar'), tw.indexOf('function towerBack'))) &&
    /openTower\(\{ from: 'village' \}\)/.test(cu) &&
    /noTabs: true, noFooter: true, pageClass: 'classic-tower'/.test(tw) &&
    /data-foe-art/.test(tw) &&
    /Array\.isArray\(raw\)/.test(ff) && /gearTypeOf\(g\)/.test(ff) && /const addr = \(gtype === 0 \|\| gtype === 1\)/.test(ff) &&
    /matching: true/.test(ce) && /function resumeArena/.test(ce) && /run\.matching/.test(ch) && /current\.arenaPage = page/.test(ch) &&
    /ARENA_AUTO_FIGHT_MS = 3000/.test(ch) && /scheduleArenaAutoFight\(run\)/.test(ch) &&
    /if \(run && run\.matching\) return;/.test(ch) &&
    /if \(classic && !run\.busy && !run\.settled && arenaMatchPage\(\)\)/.test(ce),
    '幻兽左上信息不能被裁掉；经典征战塔不能带现代菜单条，并要用经典外壳/返回村庄征战；竞技赛事页展示 3 秒后自动进战斗'
  );
}

/* ---------- 49. 经典消息行悬停 / 天梯领取奖励 / 塔胜利 CG ---------- */
/* ---------- 50. 经典无尽塔：德拉莫斯用经典松鼠 + 黑色狂战套 ---------- */
function checkPatrolClassicLook() {
  const td = fs.readFileSync(path.join(ROOT, 'js/tower-data.js'), 'utf8').replace(/\r\n/g, '\n');
  const tw = fs.readFileSync(path.join(ROOT, 'js/tower.js'), 'utf8').replace(/\r\n/g, '\n');
  const ui = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const frames = JSON.parse(fs.readFileSync(path.join(ROOT, 'images/ssfight/ui/gear-frames.json'), 'utf8'));
  const byId = new Map((frames.gear || []).map((g) => [Number(g.id), g]));
  const black = [181, 182, 183, 184];
  assert.ok(
    black.every((id, type) => {
      const g = byId.get(id);
      return g && Number(g.frame) === 119 && Number(g.quality) === 5 && Number(g.type) === type && /^狂战/.test(String(g.name));
    }) &&
    /classicGear: Object\.freeze\(\[\s*\{ id: 181, type: 0 \}/.test(td) &&
    /gear: \(D\(\)\.PATROL\.classicGear \|\| \[\]\)\.slice\(\)/.test(tw) &&
    /foe\.gears = \(TD\.PATROL\.classicGear \|\| \[\]\)\.map\(\(g\) => \(\{ id: g\.id, type: g\.type \}\)\)/.test(tw) &&
    /data-classic-foe/.test(ui) && !/if \(info\.outfit\)/.test(ui) && /attachClassicGear\(v, info\)/.test(ui),
    '经典塔的魔王要走 7232 + 黑色狂战套（181~184 / 容器帧 119），不再用现代图集 canvas'
  );
}

function checkMessageRankAndTowerCg() {
  const msg = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-message.js'), 'utf8').replace(/\r\n/g, '\n');
  const ce = fs.readFileSync(path.join(ROOT, 'js/classic-extras.js'), 'utf8').replace(/\r\n/g, '\n');
  const ch = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-challenge.js'), 'utf8').replace(/\r\n/g, '\n');
  const st = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8').replace(/\r\n/g, '\n');
  const ff = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-fight.js'), 'utf8').replace(/\r\n/g, '\n');
  const mn = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8').replace(/\r\n/g, '\n');
  const tw = fs.readFileSync(path.join(ROOT, 'js/tower-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const vil = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-village.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /const desc = key === 'altar' \? \('触发几率\\n→'/.test(vil) && /'领导力\\n→'/.test(vil) &&
    /const parts = \['mc_head'[^;]*'ikNode_9'\]/.test(tw) && /keepRoots/.test(tw) &&
    /info && info\.gear/.test(tw) && /M-0\.15,-9Q/.test(tw) && /M-48\.65,-50\.85/.test(tw) &&
    /planHtml\(info\.preview, ' horizontal'\)/.test(tw) &&
    /classic-tower \.tower-plan:not\(\.horizontal\)\{display:flex!important;flex-direction:column!important/.test(css) &&
    /classic-tower \.tower-plan \.foe-portrait:has\(\.sf-classic-foe\)\{[^}]*background:rgba\(255,248,230,\.9\)!important[^}]*border:2px solid #e2c68f!important/.test(css) &&
    /classic-tower \.tower-plan:not\(\.horizontal\) li\{display:grid!important;grid-template-columns:92px minmax/.test(css) &&
    /classic-tower \.tower-plan:not\(\.horizontal\) li > \.tower-plan-type\{[^}]*max-width:100%/.test(css) && /white-space:normal!important/.test(css) &&
    /function wireRowHover\(/.test(msg) && /addEventListener\('mousemove'/.test(msg) && /setRow\(n, inside\)/.test(msg) &&
    /function claimRankCup\(/.test(ce) && /rankCupClaimWeek/.test(st) && /claimRankCup/.test(ch) && /rank-claim/.test(ch) &&
    /hideVictoryCg/.test(ff) && /hideVictoryCg: opts\.hideVictoryCg/.test(mn) && /hideVictoryCg: classicTower\(\)/.test(tw),
    '消息两条都要整行悬停反馈；天梯领取奖励要按原版发50金杯；经典塔胜利不要战果 CG'
  );
}

/* ---------- 经典道具合成：4886 f5 + 4402 过场/结果页 ---------- */
function checkClassicComposeFlow() {
  const root = ROOT;
  const html = fs.readFileSync(path.join(root, 'scripts/index.html'), 'utf8').replace(/\r\n/g, '\n');
  const compose = fs.readFileSync(path.join(root, 'js/ssfight/ui-compose.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(root, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const st = fs.readFileSync(path.join(root, 'js/ssfight/ui-status.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(root, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  const classicCss = fs.readFileSync(path.join(root, 'css/classic.css'), 'utf8').replace(/\r\n/g, '\n');
  const tags = JSON.parse(fs.readFileSync(path.join(root, 'images/ssfight/ui/tags-compose.json'), 'utf8'));
  const rootTag = tags.find((t) => String(t.id) === '4402');
  assert.ok(
    html.indexOf('js/ssfight/ui-compose.js') > html.indexOf('js/ssfight/ui-status.js') &&
    html.indexOf('js/ssfight/ui-compose.js') < html.indexOf('js/classic-ui.js') &&
    /mountSymbol\(host, '4886', \{ frame: 5/.test(compose) &&
    /function swapComposeButtons\(view\)/.test(compose) &&
    /swapComposeButtons\(view\);/.test(compose) && /getScreenCTM/.test(compose) &&
    /idle: 1, hover: 2, press: 1/.test(compose) &&
    /mountSymbol\(host, '4402', \{ frame: 1/.test(compose) &&
    /gotoAndStop\(44\)/.test(compose) &&
    /tags-compose\.json/.test(compose) &&
    /SfCompose\.open\(id/.test(cu) &&
    /function openPropEntry\(id\)[\s\S]{0,500}?SfCompose\.open\(id/.test(cu) &&
    /const choose=\(\)=>\{ selectProp\(id\); openPropEntry\(id\); \}/.test(cu) &&
    /if \(!shop && classic && window\.SfCompose/.test(cu) &&
    /SfCompose\.showGearResult\(r\.gear, \{ onClose: backToWork, playCg: true \}\)/.test(st) &&
    /opts\.playCg/.test(compose) && /frame: playCg \? 1 : 44/.test(compose) && !/playFusing/.test(st) &&
    /融合即将开始，\\n本次需要/.test(st) &&
    /function wrapFusionHelp/.test(st) &&
    /wireClickable\(close, \{ hover: 2, press: 2, idle: 1, onFire: \(\) => destroyFusionOverlay\(\) \}\)/.test(st) &&
    /hover: 2, press: 2, idle: 1,\s*onFire: \(\) => askSellEquipFromDetail/.test(st) &&
    /wireClickable\(clipOf\(view, 'b_choose'\), \{\s*hover: 2/.test(st) &&
    /wireClickable\(clipOf\(view, 'b_help'\), \{ hover: 2/.test(st) &&
    /const onClip = clipOf\(view, 'b_on'\)/.test(st) && /__greenHoverWired/.test(st) &&
    /nodes\.get\(1\)/.test(st) && /gotoAndStop\(on \? 2 : 1\)/.test(st) && !/hue-rotate\(55deg\)/.test(st) &&
    /wireClickable\(b1Inner, \{\s*hover: 2, press: 2/.test(st) &&
    /inner = mark\.byName \? mark\.byName\('mc_1'\)/.test(st) &&
    /\.classic-modal-overlay\{[^}]*#1b1b1b5b/.test(classicCss) &&
    !/#193a445b/.test(classicCss) && !/#45384da6/.test(css) &&
    /background:rgba\(22,22,22,\.55\)/.test(css) &&
    /#ui>section\.sf-compose-view\{[^}]*pointer-events:auto!important/.test(css) &&
    rootTag && rootTag.Sf.filter((x) => x.tp === 1).length + 1 === 45 &&
    rootTag.Sf.some((x) => x.na === 't_name') && rootTag.Sf.some((x) => x.na === 't_temp'),
    '经典合成要走 4886 f5 合成页 + 4402「合成中」过场/结果页，并接入背包与融合结果'
  );
}

/* ---------- 经典背包「道具使用」：4886 f1 原版弹窗 + 使用/取消对调 ---------- */
function checkClassicPropUseFlow() {
  const root = ROOT;
  const html = fs.readFileSync(path.join(root, 'scripts/index.html'), 'utf8').replace(/\r\n/g, '\n');
  const propUse = fs.readFileSync(path.join(root, 'js/ssfight/ui-prop-use.js'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(root, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  const guide = fs.readFileSync(path.join(root, 'js/ssfight/ui-guide.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(root, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  const tags = JSON.parse(fs.readFileSync(path.join(root, 'images/ssfight/ui/tags-daoju.json'), 'utf8'));
  const ids = new Set(tags.map((t) => String(t.id)));
  assert.ok(
    html.indexOf('js/ssfight/ui-prop-use.js') > html.indexOf('js/ssfight/ui-compose.js') &&
    html.indexOf('js/ssfight/ui-prop-use.js') < html.indexOf('js/classic-ui.js') &&
    /mountSymbol\(host, '4886', \{ frame: 1/.test(propUse) &&
    /function mergeBuyFrame\(view\)/.test(propUse) &&
    /merged\.delete\(9\)/.test(propUse) && /merged\.delete\(13\)/.test(propUse) &&
    /for \(const depth of \[22, 26\]\)/.test(propUse) &&
    /view\.frames = \[merged\]/.test(propUse) &&
    /function writeRemark\(view, text\)/.test(propUse) &&
    /setWrappedField\(clipOf\(view, 'vipDes'\), text == null \? '' : text, 10, 2\)/.test(propUse) &&
    /return status\.limit <= 1;/.test(cu) &&
    /h\.sync\(\{ stock: next\.remaining \}\)/.test(cu) &&
    /今日已经卖完了，明天再来/.test(propUse) &&
    !/style\.opacity = off \? '0\.65'/.test(propUse) &&
    /setAttribute\('fill', '#000000'\)/.test(propUse) &&
    /'buy', \{ idle: 1, hover: 2 \}/.test(propUse) &&
    /paintVectorIcon\(c1, id\)/.test(propUse) && /openInfo: openInfo/.test(propUse) &&
    /swapButtons\(buy, cancel\)/.test(propUse) &&
    !/function setBuyDescription\(/.test(propUse) &&
    !/function applyBackpackLayout\(/.test(propUse) &&
    !/function paintBuyIdle\(/.test(propUse) &&
    !/sf-prop-buy-idle/.test(css) &&
    /const EXCHANGE_GEMS = \[101, 102, 103, 104, 105, 106\]/.test(cu) &&
    fs.existsSync(path.join(root, 'images/ssfight/ui/prop-icons.json')) &&
    ['2993', '3133', '3110', '2988', '2390'].every((id) => ids.has(id)) &&    /function openClassicBuyProp\(id, base, mode, backMode\)/.test(cu) &&
    /classic-home ssfight-sub ssfight-view sf-prop-use-view/.test(propUse) &&
    /sf-prop-use-view\{[^}]*top:-11\.087px;bottom:-11\.087px/.test(css) &&
    /function swapButtons\(use, cancel\)/.test(propUse) &&
    /setExtraTransform\('translate\('/.test(propUse) &&
    /wireButton\(use,/.test(propUse) && /wireButton\(cancel,/.test(propUse) &&
    /data-prop-use/.test(propUse) &&
    /function openClassicUseProp\(id, base, mode, backMode\)/.test(cu) &&
    /if \(!shop && !exchange && canUse && !opts\.forceDom && window\.SfPropUse/.test(cu) &&
    /openProp\(id, mode, \{ forceDom: true \}\)/.test(cu) &&
    /sf-prop-use-view \[data-prop-use\]/.test(guide) &&
    ['4886', '3573', '4419', '4505', '4504', '3150', '4849', '4850', '3414'].every((id) => ids.has(id)),
    '经典购买窗要挂 4886 f1（与背包详情同版式）并只并入 f2 的购买/取消两颗按钮；按钮默认灰、hover 绿；多件限购留在购买窗'
  );
}

/* ---------- 经典主界面体力：每秒结算 + 体力条悬停倒计时 ---------- */
function checkClassicMainEnergy() {
  const main = fs.readFileSync(path.join(ROOT, 'js/ssfight/ui-main.js'), 'utf8').replace(/\r\n/g, '\n');
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /if \(State\.tickEnergy\) \{ try \{ State\.tickEnergy\(\);/.test(main) &&
    /function updateEnergyTip\(view\)/.test(main) &&
    /ssfight-energy-hover/.test(main) && /ssfight-energy-tip/.test(main) &&
    /updateEnergyTip\(view\)/.test(main) &&
    /energyCountdown/.test(main) &&
    /\.ssfight-energy-hover\{/.test(css) && /\.ssfight-energy-tip\{/.test(css),
    '经典主界面每秒要结算体力，体力条悬停要显示距下次恢复的倒计时'
  );
}

/* ---------- 道具页三颗页签：改用原版 7180 的矢量精灵，不再用 tab-*.png ---------- */
function checkBagTabVectorSelection() {
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  const cu = fs.readFileSync(path.join(ROOT, 'js/classic-ui.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /const BAG_TAB_VECTOR = \[/.test(cu) &&
    ["id: '7150'", "id: '7152'", "id: '7156'"].every((s) => cu.includes(s)) &&
    /SfRender\.loadExtra\('tags-daoju\.json'\)/.test(cu) &&
    /SfRender\.mountSymbol\(cell, spec\.id/.test(cu) &&
    /function installBagTabVectors/.test(cu) && /installBagTabVectors\(p\)/.test(cu) &&
    /void preloadBagTabVectors\(\)/.test(cu) &&
    /for \(const frame of \[1, 2\]\)/.test(cu) && /contains\('active'\) \? 2 : 1/.test(cu) &&
    /btn\.classList\.add\('has-vector-tab'\)/.test(cu) &&
    /\.bag-tab-art\{position:absolute/.test(css) &&
    /\.bag-tabs \.uc-tab\.has-vector-tab\{[^}]*background:none/.test(css) &&
    !/tab-(?:bag|shop|exchange)(?:-active)?\.png/.test(css) &&
    fs.existsSync(path.join(ROOT, 'images/ssfight/ui/tags-daoju.json')) &&
    ['tab-bag', 'tab-shop', 'tab-exchange', 'tab-bag-active', 'tab-shop-active', 'tab-exchange-active', 'tab-plain']
      .every((n) => !fs.existsSync(path.join(ROOT, 'images/ui/icons/' + n + '.png'))),
    '经典道具页的背包/商店/兑换要用原版 7150/7152/7156 矢量页签（f1 金/f2 绿，选中用 f2），不再引用 tab-*.png'
  );
}

/* ---------- 背包/商店/兑换选中格：绿色遮罩必须在道具图下方 ---------- */
function checkBagSelectedLayer() {
  const css = fs.readFileSync(path.join(ROOT, 'css/classic-refine.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(
    /\.bag-grid \.catalog-cell\.selected \.item-icon>img\{[^}]*position:relative[^}]*z-index:1\}/.test(css) &&
    /\.bag-grid \.catalog-cell\.selected \.item-icon::after\{[^}]*z-index:0[^}]*background:rgba\(125,190,45,\.26\)/.test(css),
    '选中道具时绿色遮罩必须在道具图下方（img z-index:1 / ::after z-index:0），不能把道具本身的颜色压绿'
  );
}

(async () => {
  const fixture = await checkClassicViewLifecycle();
  await checkConcurrentAssetLoad();
  checkSharedFeedbackLifecycle();
  await checkFightResults(fixture);
  await checkClassicFight();
  await checkClassicGearPage(fixture);
  checkClassicArenaPicker();
  checkClassicComposeFlow();
  checkClassicPropUseFlow();
  checkClassicMainEnergy();
  checkBagTabVectorSelection();
  checkBagSelectedLayer();
  checkClassicRankFlow();
  checkGearColorParity();
  checkRecruitChallengeFlow();
  checkClassicGiftAttention();
  checkClassicSystemStyle();
  checkFriendViewPolish();
  checkFriendViewRound2();
  checkLevelUpStyle();
  checkGuide();
  checkBattleReactionPolish();
  checkOnboardingDefaults();
  checkBagDetailClicks();
  checkGuideLateSteps();
  checkChestDefeatBackground();
  checkDualSaveAndDebugGate();
  checkVillageBuildings();
  checkClassicTowerShell();
  checkPatrolClassicLook();
  checkMessageRankAndTowerCg();
  checkHeroAtlasFilling();
  checkBalanceAndRewardContracts();
  console.log('PASS test-ssfight-render（帧语义 / 原版素材契约 / 文本索引 / 经典切页真值、内容宿主与统一命中 / 共用反馈 / 原版战果续战与关闭生命周期 / 位图 HD 覆盖接线（含 1x 归档） / 局内战斗素材与动作映射 / 更换装备原版页）');})().catch(err => { console.error(err); process.exitCode = 1; });
