#!/usr/bin/env node
/* ============================================================================
 * gen-ssfight-ui.cjs —— 从原版 ssfight 导出里**提取经典 UI 素材库**（构建期工具，非运行时）
 *
 * 为什么要有这个脚本：
 *   经典模式要求"直接用 ssfight 的素材库 + 原版界面数据"，而不是照着截图重画。
 *   原版数据最完整的来源是 HTML5 整片导出 `html5/ssfight.html`：
 *     · `tg`  = **7876 个标签的完整字典**（3365 形状 / 4017 精灵 / 488 文本 / 5 字体 / 1 按钮）
 *     · `Mf`  = 根时间轴 110 帧 + **12 个帧标签**（tp:43 的 labelname）
 *   逐页 `resource/Sprite/sprite<N>.html` 只带自己的 `tg`，**子元件解析不出来**
 *   （这正是之前渲染村庄页时底栏按钮是空组的原因），所以必须以整片导出为准。
 *
 * 产出（`images/ssfight/ui/`，紧凑 JSON + 位图）：
 *   · `timeline.json` —— 根时间轴（尺寸/帧率/帧标签/每帧放置）
 *   · `tags.json`     —— 只含**指定页可达闭包**的标签（整字典 24.6 MB 路径数据，必须裁剪）
 *   · `bitmap/*.jpg|png` —— `Fs[].image` 的 data URI 落成真实文件（同内容去重）
 *   · `manifest.json` —— 来源文件 + sha256 + 包含的页 + 统计（可复核、可重现）
 *
 * 用法：
 *   node tools/gen-ssfight-ui.cjs            # 默认提取 main（村庄主界面）
 *   node tools/gen-ssfight-ui.cjs main daoju # 指定多页
 *   node tools/gen-ssfight-ui.cjs --all      # 12 个界面全提
 *
 * 缺参考目录时会明确报错（与 gen-vendor-data.cjs 同一约定：不静默产出空文件）。
 * ========================================================================== */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'references', 'ssfight', 'ssfight', 'ssfight', 'html5', 'ssfight.html');
/* 同一份原版 SWF（`html5/` 是它的整片导出）：**导出符号名 → 角色 id** 只能从这里拿，
 * 见 `swfSymbolIds()` 的注释。 */
const SWF = path.join(ROOT, 'references', 'ssfight', 'ssfight', 'ssfight', 'ssfight.swf');
const OUT = path.join(ROOT, 'images', 'ssfight', 'ui');
/* 文本字段元数据（框宽 / 对齐 / 字号 / 字体号）——由 `gen-ssfight-textfields.cjs` 从 SWF 抽出。
 * 文本字段索引与"每行几个字"都靠它。 */
const TEXT_FIELDS_FILE = path.join(OUT, 'textfields.json');

/* 12 个帧标签 → 该页根元件 id（取自根时间轴的放置记录） */
const PAGES = {
  load: '6843', showMovie: '6926', main: '7039', homeLand: '7140', daoju: '7180',
  zhuangtai: '7218', tiaozhan: '7638', fight: '7772', levelup: '7795', message: '7819', system: '7847',
};
/* 装备素材：原版把「一件装备的样子」做成 187 帧的容器精灵，
 * 穿装备 = `container.gotoAndStop(frame)`（MainMovie.as:6608 constructBpData / :6737 chooseEquipLoader）。
 * 村庄主角身上的挂点跑的是 `getEquipBpData` → 用的是带 **B** 后缀的那一套容器，
 * 所以这 6 个就是"全部装备素材"的入口（各自的闭包会把对应 187 个部件一起带出来）。
 * id 取自导出符号表：头B/外拳套B/内拳套B/衣服B/手臂B/鞋子B。
 * 顺序 = 原版 type 序号：0 头 / 1 拳套(外·内) / 2 衣服·手臂 / 3 鞋子。 */
const GEAR = {
  gearHead: '1919', gearFistOut: '1915', gearFistIn: '2014',
  gearBody: '1909', gearArm: '2008', gearShoe: '1912',
};
/* ---------- 村庄四个地点的「场景页」= 原版运行时 attachMovie 的库元件 ----------
 * 第一百四十七批当时判"提不出来"，理由是"在 26MB 导出里连这些名字都搜不到" ——
 * 那是**按中文名**搜的，而导出字典只按 **id** 存，所以"搜不到名字"不等于"没有素材"。
 * 第一百四十九批按 id 复查：三颗库元件**完整地躺在整片导出的字典里**，闭包 0 缺失
 * （`MainMovie.as` 的 `loadMcs([["家园弹出", "homeLandMc", …]])` 就是 attachMovie 它们）：
 *   · 3957 —— 「家园弹出」多页容器（`showTemple/showPub/showMiracle/showRoom/…` 共用）：
 *              帧 1 祭坛 / 帧 2 酒吧 / 帧 3 神迹 / 帧 4 神迹记录 / 帧 5 牧场升级 /
 *              帧 7 掷骰子房 / 帧 8 …（帧号出处逐条在 MainMovie.as 的 gotoAndStop 上）
 *   · 4381 —— 「幻兽牧场」（`summonsMc` … 共 11 页：列表 / 详情 / 孵化 / 编队 / 喂养 / 进化）
 *   · 3437 —— 「征战」（`campaignMc` … 共 6 页：主页 / 战绩 / 报名列表 / 对局 / 掷骰子结果）
 * ⚠ 导出符号表（`01-swf-符号表/导出符号表.tsv`）把「家园弹出」标成 **3959**，那是它的表对不上号：
 *   3959 只有 2 个子元件，而 3957 才是逐帧对得上 `showTemple`/`showMiracle` 的那一颗
 *   （帧 1 的文案就是"每天都可领取一个随机状态（持续至当天24:00）"）。**以内容为准。**
 * 每一颗各出一份包：只有真的点进那个地点才拉，不该跟村庄页绑在一起。 */
const SCENES = {
  homeland: '3957',
  summons: '4381',
  campaign: '3437',
};
/* ---------- 状态页立绘的"四个部位容器" ----------
 * 原版状态页的主角落绘**不是一整张图**，而是四个部位精灵拼的
 * （`MainMovie.as:989 showWears()`：`[subFrame.mc_head, mc_hand, mc_body, mc_foot]`
 * 各 `attachMovie(convertLink(穿在身上的那件))`，再把部位自己 `_xscale=_yscale=85`）。
 * 所以状态页要"穿上玩家的装备"，就得**同时**有这四个部位精灵（7218 那一页里有）
 * 和六套装备容器（`tags-gear.json` 里有）。这里把部位精灵一并拉进状态包，
 * 装备容器沿用 `loadExtra('tags-gear.json')`（进状态页时本来就要穿装备，拉一次不亏）。 */
const STATUS_PARTS = ['5785', '5262', '5116', '5188', '4950', '5605'];
/* ---------- 状态页的二级库元件 ----------
 * 点开某一格武器 / 技能之后的那一页（"武器详情 / 技能详情"）**不是**页根 7218 里的东西，
 * 而是运行时 `loadMcs([["武器升阶", "subFrame", currentFrame]])` 挂上去的**库元件**
 * （`MainMovie.as:16675 / 16799 / 16917`）。从整片导出里按内容定位（导出字典只按 id 存，
 * 按中文名搜不到），根元件 = **4886**：
 *   · 第 3 帧 = 升级详情（`name` / `harm` / `des` / `type` / `levelText` / `c1` 图标位 +
 *     右侧 `requirement` 的 "需要 / 已有 / 成功率" + `button1/2/3`）—— `showWeaponSkill3`;
 *   · 第 4 帧 = 确认页（`text1` / `text2` / `button1` / `button2`）—— `showWeaponSkill4`;
 *   · 第 5、6 帧 = 真形态的「升阶」页（`b_back` / `b_hc`）；
 *   · 第 1、2 帧是道具页复用同一颗元件时的别的用途（大力丸之类）。
 * ⚠ 右侧那块"需要 / 已有 / 成功率"自己也**不是** 4886 的子元件：它是 `subFrame.requirement`
 * （**3670**，`showLeveupInfo` 往它的 need1/current1/need2/current2/rate/level 写值），
 * 静态闭包从 4886 往下走同样走不到 —— 所以三个 id 都要显式列进来。
 *
 * 第三颗是**「查看装备」那一页**：原版 `friendEquipsInfo()`（MainMovie.as:13821）走的是
 *   库元件「状态1」的某一帧。`01-swf-符号表/导出符号表.tsv` 把「状态1」记作 **4675**，
 *   但 4675 实测只有 1 帧（只是一颗按钮），**不是**那一页的容器；
 *   按内容在整片导出里定位（H5 导出只按 id 存、中文名搜不到）：
 *   · **4673** = 「状态1」真正的容器（15 帧）——
 *       f1 = 武器/技能详情（`requirement`+`c1`+`buttonsMc`+`des`+`name`+`harm`+`levelText`+`type`）
 *       f3 = 角色纸娃娃装备页（mc_body/head/hand/foot + icon1..6 + left/right/back）
 *       **f7 = 好友装备页**（`mc_tab1..4`，正是 `showFriendInfoWin` 读的那四个格子）
 *       f8 = 装备融合 / f9 = 融合结果 / f10/f11 = 升阶 / f13 = 二次确认
 *   · **4692** = 另一颗「状态1」系列的容器（8 帧，f1 按钮+说明 / f3 bg / f4 text1+c1 /
 *       f6 t_tips / f7「融合即将开始…」 / f8 button1+left+right+info）
 *   · **4605** = `mc_tab`（3 帧：f1 有装备（`c1`+`t_base`+`t_name`+`t_addr`+`stone`）/
 *       f2 空位 / f3 空）
 *   · **4675** = 一颗单帧按钮（导出符号表把它误记成「状态1」）
 *   四颗都提进来，界面侧只要按帧挂上 + 写字段即可。
 *   用户 2026-10 口径②："随机挑战的查看界面中的查看装备按钮，对齐ssfight版本，
 *   当前版本的实现不是我想要的。"；⑥："武器与技能详情页与ssfight版本差距甚远。" */
const STATUS_SUB = ['4886', '3670', '4675', '4692', '4673'];
/* ---------- 挑战页的二级/三级页库元件 ----------
 * 原版挑战页的"难度选择 / 出战确认"**不是页根 7638 里的东西**，而是运行时
 * `loadMcs([["挑战1", "tiaozhanSub", currentFrame]])` 往当前页 attach 的**库元件** ——
 * 静态闭包从 7638 往下走永远走不到它（第一版就是这么少了一层）。
 * 按 id 在整片导出里定位（按中文名搜不到：字典只按 id 存）：**4756**＝「挑战1」，
 * 具名子元件 `subframe / button1..button6 / info1 / info2 / style / back` 与
 * `MainMovie.as` 的 `showhardWin`（gotoAndStop(5) + style + 六颗星）/
 * `showFightWin`（gotoAndStop(4) + info1/info2）逐条对得上。 */
const CHALLENGE_PARTS = ['4756'];
/* ---------- 武器 / 技能图标（状态页第 2、3 帧那 2×5 格里的东西）----------
 * 原版这些格子里没有静态画稿：格子精灵（3636）第 2 帧才是内容帧，
 * 内容靠 `attachMovie(weaponSkill.name, "mc", 100)` 运行时挂**库元件** ——
 * 也就是"库元件名 = 武器/技能名"（`MainMovie.as:16637 loadWeaponSkill`）。
 * 没获得的那一档挂的是**名字 + "1"**（`MainMovie.as:22056` 的
 * `attachMovie(_loc3[_loc2].name + "1", "mc", 100)`）—— 那是库里**另一颗元件**：
 * 灰底卡片 + **灰色的名字层**（所以原版"悬停未获得的格子也会显示灰色的名字"）。
 * ⚠ 旧注释说"那一批在导出符号表里 spriteId 全是 None、H5 导出没做出来"是**错的**：
 *   错的是那张错位的 `导出符号表.tsv`；按 `swfSymbolIds()` 现算，`方天画戟1`=2134、
 *   `大榔头1`=2142、`力王附体1`=2331、`装死1`=2186 …… 全都有正常 id（2026-10 复核）。
 *   现在这两档一起提出来，`weapon-skill-icons.json` 里每项是 `{name, id, locked}`。
 *
 * 所以"从 ssfight 里捞出矢量图素材"= 按名字查出**角色 id**，把它拉进闭包。
 * 名字的唯一来源是**游戏数据本身**（`js/gamedict.js` 的 weaponsMap / skillsMap，
 * 和运行时同一份），**不在生成器里手抄名字表** —— 抄一份就会和游戏数据漂移。
 * 每颗图标的元件结构（导出实测，三帧完全相同的一套）：
 *   第 1 帧 = 图标底（形状，带灰阶）+ 字号位；第 2 帧 = 等级文字位（`level`）；
 *   第 3 帧 = 空（`gotoAndStop(_totalframes)` 用来隐藏等级文字）。
 *
 * ⚠⚠ 名字 → 角色 id 必须走 `swfSymbolIds()`（**读 SWF 自己配对**），
 *   **不要再用 `01-swf-符号表/导出符号表.tsv`**：那张表是把 ExportAssets 的名字配给
 *   "紧随其后的 DefineSprite"，而这个 SWF 里 ExportAssets 排在**它所导出的那个 sprite 之后**，
 *   于是每条名字都被配到了后一个角色上 —— 表现是"图标全串位"（死老鼠显示双刃剑的图、
 *   大榔头/龟甲术/吸铁大法 三条直接是 None）。2026-10 逐条渲染核对时发现的。 */
const ICON_BUNDLE = 'wsicon';
const ICON_PAGES = ['zhuangtai', 'tiaozhan'];
/* ---------- 读 SWF：导出符号名 → 角色 id ----------
 * SWF 里 `ExportAssets`(tag 56) 每条是 `u16 名字字节数 + NUL 结尾的 UTF-8 名字`（**不带 id**），
 * 而它导出的那个 `DefineSprite`(tag 39) 排在**它前面**；所以配对规则是"名字 → 紧邻其前的 sprite"。
 * 只做这一件事，不引入 SWF 解析库。 */
const SWF_TAG_EXPORT = 56, SWF_TAG_SPRITE = 39;
function swfReadBits(buf, off, n) {
  let v = 0;
  for (let i = 0; i < n; i++) { const b = off + i; v = (v << 1) | ((buf[b >> 3] >> (7 - (b & 7))) & 1); }
  return v;
}
function swfSymbolIds() {
  if (!fs.existsSync(SWF)) {
    die('找不到原版 SWF：' + SWF + '\n  （references/ 不进仓库；本地缺参考目录时不要传 wsicon 这一项）');
  }
  const raw = fs.readFileSync(SWF);
  const body = raw.slice(0, 3).toString('latin1') === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  const rectBits = 5 + 4 * swfReadBits(body, 0, 5);
  let off = Math.ceil(rectBits / 8) + 4;                 // rect + frameRate(2) + frameCount(2)
  const events = [];                                     // { name } | { sid }
  while (off + 2 <= body.length) {
    const rh = body.readUInt16LE(off);
    const code = rh >> 6;
    let len = rh & 0x3f;
    off += 2;
    if (len === 0x3f) { len = body.readUInt32LE(off); off += 4; }
    if (code === SWF_TAG_EXPORT) {
      const tl = body.readUInt16LE(off + 2);
      let nm = body.slice(off + 4, off + 4 + tl);
      const z = nm.indexOf(0);                           // 少数条目声明的长度比名字多 2 字节
      if (z >= 0) nm = nm.slice(0, z);
      events.push({ name: nm.toString('utf8') });
    } else if (code === SWF_TAG_SPRITE) {
      events.push({ sid: body.readUInt16LE(off) });
    }
    off += len;
    if (code === 0) break;
  }
  const map = new Map();
  for (let i = 0; i < events.length; i++) {
    if (events[i].name === undefined) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (events[j].sid !== undefined) { map.set(events[i].name, String(events[j].sid)); break; }
    }
  }
  return map;
}
/* ---------- 战利品图标（战果页与开宝箱里那一格）----------
 * 原版 `showFightResult` / `showPrize` 都是 `mc.c1.attachMovie(<道具名>, "mc", 100)` ——
 * **库元件名就是道具名**（MainMovie.as:18804 / 18691），所以这里按名字取 SWF 的导出符号 id。
 * 名字来源是**掉落池本身**（`js/battle-drops.js` 里的 `{ id, name, count, weight }` 行），
 * 不手抄一份 —— 池子改了这里自动跟着走。 */
const LOOT_BUNDLE = 'looticons';
/** 掉落池里有、但原版 SWF 里**没有同名导出**的那几件 → 借一件原版美术顶上。
 *  2026-11 用户口径："开宝箱时开出来的东西总会有一两个物品显示不出来"：
 *  天梯赛（`LADDER_POOL`）的主产出「天梯碎片」是复刻自己加的产出，原版没有这个导出名，
 *  于是那一格永远画不出东西（同一场掉两份就两格空）。天梯赛在原版里的图标就是「金杯」，
 *  借它画 —— 掉的是碎片、图标是天梯金杯，至少**看得见是什么**。 */
const LOOT_ALIAS = { '天梯碎片': '金杯' };
function lootIconRoots() {
  const sym = swfSymbolIds();
  const src = fs.readFileSync(path.join(ROOT, 'js', 'battle-drops.js'), 'utf8').replace(/\r\n/g, '\n');
  const rows = [];
  const seen = new Set();
  const rowRe = /\{\s*id:\s*(\d+)\s*,\s*name:\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = rowRe.exec(src)) !== null) {
    const id = Number(m[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ id: id, name: m[2] });
  }
  if (!rows.length) die('js/battle-drops.js 里没扫到任何掉落行（格式变了？）');
  const map = { byId: {}, missing: [] };
  const roots = [];
  for (const r of rows) {
    /* 先按掉落池里的名字找；找不到再看别名表（见 `LOOT_ALIAS`）。 */
    const alias = LOOT_ALIAS[r.name] || r.name;
    const sid = sym.get(alias);
    if (!sid || sid === 'None') { map.missing.push(r.id + ':' + r.name); continue; }
    const rec = { name: r.name, id: String(sid) };
    if (alias !== r.name) rec.aliasOf = alias;
    map.byId[r.id] = rec;
    roots.push(String(sid));
  }
  fs.writeFileSync(path.join(OUT, 'loot-icons.json'), JSON.stringify(Object.assign({
    source: 'references/ssfight/ssfight/ssfight/ssfight.swf（ExportAssets 名字 → 紧邻其前的 DefineSprite）+ js/battle-drops.js（掉落池）',
    how: '原版 `mc.c1.attachMovie(<道具名>, "mc", 100)`（MainMovie.as:18804 战果页 / :18691 开宝箱）：'
       + '库元件名就是道具名。`byId[道具id].id` = 该图标的元件号。',
  }, map), null, 1));
  console.log('  战利品图标：%d 颗（缺 %d 颗在 SWF 里找不到）→ loot-icons.json', roots.length, map.missing.length);
  if (map.missing.length) console.log('    缺：%s', map.missing.join('、'));
  return roots;
}
/* ---------- 道具图标：原版 `c1.attachMovie(<道具名>, …)` 的矢量库元件 ----------
 * `showUsePropWin` / `showBuyPropWin` 的图标位都是**按道具名 attach**，
 * 静态页面闭包走不到这些库元件；这里按 `propMap` 的名字取 SWF 导出符号，
 * 再把它们并进 `tags-daoju.json`（背包/商店详情共用）。原版没有导出的几件
 * 用同风格的库元件借位（抽奖卷→礼包、天梯碎片→金杯、礼包页→礼包…），
 * 与 `loot-icons.json` 的别名口径一致。 */
const PROP_ICON_ALIAS = {
  '天梯碎片': '金杯',
  '抽奖卷': '礼包',
  '红包': '礼包',
  '推荐大礼包': '礼包',
  '1级礼包': '礼包', '5级礼包': '礼包', '10级礼包': '礼包', '15级礼包': '礼包', '20级礼包': '礼包',
  '松鼠拳套': '礼包', '转生果': '礼包',
  '力量永久+1': '属性书', '敏捷永久+1': '属性书', '速度永久+1': '属性书', '生命永久+5': '属性书',
};
function propIconRoots() {
  const sym = swfSymbolIds();
  const dictSrc = fs.readFileSync(path.join(ROOT, 'js', 'gamedict.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = dictSrc.indexOf('propMap = createDict');
  if (at < 0) die('js/gamedict.js 里找不到 propMap');
  const rest = dictSrc.slice(at);
  const nxt = rest.slice(1).search(/\n  const \w+ = createDict/);
  const seg = nxt < 0 ? rest : rest.slice(0, nxt + 1);
  const rowRe = /\[\s*(-?\d+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g;
  const map = { byId: {}, missing: [] };
  const roots = [];
  const seen = new Set();
  let m;
  while ((m = rowRe.exec(seg)) !== null) {
    const id = Number(m[1]);
    const raw = JSON.parse('"' + m[2] + '"');
    const sep = JSON.parse('"' + m[3] + '"');
    const parts = raw.split(sep);
    const name = (parts.length > 1 ? parts[1] : parts[0]).trim();
    if (!name) continue;
    const alias = PROP_ICON_ALIAS[name] || name;
    const sid = sym.get(alias);
    if (!sid || sid === 'None') { map.missing.push(id + ':' + name); continue; }
    map.byId[id] = { name, id: String(sid) };
    if (alias !== name) map.byId[id].aliasOf = alias;
    if (!seen.has(String(sid))) { seen.add(String(sid)); roots.push(String(sid)); }
  }
  fs.writeFileSync(path.join(OUT, 'prop-icons.json'), JSON.stringify(Object.assign({
    source: 'references/ssfight/ssfight/ssfight/ssfight.swf（ExportAssets 名字 → 紧邻其前的 DefineSprite）+ js/gamedict.js（propMap）',
    how: '原版 `c1.attachMovie(<道具名>, "mc", 100)`（showUsePropWin / showBuyPropWin）：库元件名就是道具名；'
       + '`byId[道具id].id` = 该图标的元件号，供 SfPropUse 以矢量元件挂进 c1。',
  }, map), null, 1));
  console.log('  道具图标：%d 颗（缺 %d 颗在 SWF 里找不到）→ prop-icons.json', Object.keys(map.byId).length, map.missing.length);
  if (map.missing.length) console.log('    缺：%s', map.missing.join('、'));
  return roots;
}
function iconRoots() {
  const sym = swfSymbolIds();
  /* 从 js/gamedict.js 抽 `[id, "原始行", "分隔符"]` 三元组：分隔符是表尾的那个字面量，
   * 名字 = 原始行按分隔符切开后的第 2 段（"1 方天画戟 …" → 方天画戟）。 */
  const dictSrc = fs.readFileSync(path.join(ROOT, 'js', 'gamedict.js'), 'utf8').replace(/\r\n/g, '\n');
  const rowsOf = (block) => {
    /* ⚠ 块尾用**下一张字典**锚定，不要用"看到 `];` 就停"：`js/gamedict.js` 里一个
     * `var X = createDict(...)` 声明后面跟着一长串**行数组字面量**，中间夹着别的字典
     * （`propMap` / `gearMap` / 强化配方 / 星级表 ……），按 `\n  ];` 找会一路吃到后面的表，
     * 把同名字段的那些行也当成本表的数据（第一次跑就混进 41 条重复 id）。 */
    const at = dictSrc.indexOf(block + ' = createDict');
    if (at < 0) die('js/gamedict.js 里找不到 ' + block + '（生成器与游戏数据对不上了）');
    const rest = dictSrc.slice(at);
    const nxt = rest.slice(1).search(/\n  const \w+ = createDict/);
    const seg = nxt < 0 ? rest : rest.slice(0, nxt + 1);
    const out = [];
    const rowRe = /\[\s*(-?\d+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g;
    let r2;
    while ((r2 = rowRe.exec(seg)) !== null) {
      const raw = JSON.parse('"' + r2[2] + '"');
      const sep = JSON.parse('"' + r2[3] + '"');
      const parts = raw.split(sep);
      const name = (parts.length > 1 ? parts[1] : parts[0]).trim();
      if (name) out.push({ id: Number(r2[1]), name: name });
    }
    return out;
  };
  const list = [['weapon', rowsOf('weaponsMap')], ['skill', rowsOf('skillsMap')]];
  const roots = [];
  const map = { weapon: {}, skill: {}, missing: [] };
  for (const [kind, rows] of list) {
    for (const r of rows) {
      const sid = sym.get(r.name);
      if (!sid || sid === 'None') { map.missing.push(kind + ':' + r.id + ':' + r.name); continue; }
      const item = { name: r.name, id: String(sid) };
      /* 同一颗图标的"未获得"档（灰卡片 + 灰名字层），原版在格子里按 `has` 二选一挂。 */
      const lid = sym.get(r.name + '1');
      if (lid && lid !== 'None') { item.locked = String(lid); roots.push(String(lid)); }
      map[kind][r.id] = item;
      roots.push(String(sid));
    }
  }
  fs.writeFileSync(path.join(OUT, 'weapon-skill-icons.json'), JSON.stringify(Object.assign({
    source: 'references/ssfight/ssfight/ssfight/ssfight.swf（ExportAssets 名字 → 紧邻其前的 DefineSprite）+ js/gamedict.js（武器/技能名）',
    how: '原版 `attachMovie(weaponSkill.name, "mc", 100)`（MainMovie.as:16637）：库元件名就是武器/技能名；'
       + '**没获得的那一档是名字 + "1"**（MainMovie.as:22056），所以 `id` 与 `locked` 是同一颗图标的两种外观。'
       + '图标元件第 1 帧 = 图标底 / 第 2 帧 = 等级文字位 / 第 3 帧 = 空帧（用来隐藏等级）。'
       + '⚠ 名字→id 由 tools/gen-ssfight-ui.cjs 的 swfSymbolIds() 现算，不要再用导出符号表.tsv（它整体错位）。',
  }, map), null, 1));
  console.log('  武器/技能图标：%d 颗（缺 %d 颗在 SWF 里找不到）→ weapon-skill-icons.json',
    roots.length, map.missing.length);
  if (map.missing.length) console.log('    缺：%s', map.missing.join('、'));
  return roots;
}
/* 名字 → 该页的根元件 id；`wsicon` 是"一整批图标"而不是单页，根 id 由 `iconRoots()` 现算，
 * 所以这里给个占位（`ROOTS` 只用来校验"认不认识这个名字"）。 */
const ROOTS = Object.assign({ [ICON_BUNDLE]: '' }, PAGES, GEAR, SCENES);

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

/* ---------- 1. 读整片导出，抠出 `var data = {...}` ---------- */
function readMovie() {
  if (!fs.existsSync(SRC)) {
    die('找不到原版导出：' + SRC + '\n  （references/ 不进仓库，CI 上不会跑这个脚本；本地缺参考目录时请先补齐）');
  }
  const raw = fs.readFileSync(SRC);
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  const txt = raw.toString('utf8');
  const at = txt.indexOf('var data');
  if (at < 0) die('导出文件里找不到 `var data`，格式可能变了');
  const start = txt.indexOf('{', at);
  let depth = 0, end = -1;
  for (let i = start; i < txt.length; i++) {
    const c = txt[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) die('`var data` 的 JSON 括号不平衡，解析失败');
  return { data: JSON.parse(txt.slice(start, end)), sha, bytes: raw.length };
}

/* ---------- 2. 根时间轴 → 每帧放置列表 + 帧标签 ---------- */
/* SWF 标签流语义（由 sprite.js 的 b.sprite 构造函数验证）：
 *   tp:1 = ShowFrame（帧边界）   tp:26 = PlaceObject（d/id/ma/na/rp/cx/opacity/fl/cD）
 *   remove:true = RemoveObject   tp:43 = FrameLabel（labelname）   其余跳过 */
const KEEP_PLACE = ['d', 'id', 'ma', 'na', 'rp', 'cx', 'opacity', 'fl', 'cD', 'nm', 'remove'];

function splitTimeline(mf) {
  const frames = [[]];
  const labels = {};
  let n = 0;
  for (const e of (mf && mf.Sf) || []) {
    if (e.tp === 43) { if (e.labelname) labels[e.labelname] = n + 1; continue; }
    if (e.tp === 1) { frames.push([]); n++; continue; }
    if (e.tp === 26 || e.remove) {
      const p = {};
      for (const k of KEEP_PLACE) if (e[k] !== undefined) p[k] = e[k];
      if (!e.remove && e.id === undefined) continue;
      frames[n].push(p);
    }
  }
  if (frames.length && frames[frames.length - 1].length === 0) frames.pop();
  return { frames, labels, frameCount: n };
}

/* ---------- 3. 可达闭包：只留这一页真的会用到的标签 ---------- */
/* 注意 `rp` 是**布尔标记**（rp:true = 替换放置），不是 id —— 第一版把它当 id 推进闭包，
 * 结果多出一个名为 "true" 的缺失 id。 */
function closure(byId, roots) {
  const seen = new Map();
  const stack = roots.map(String);
  const missing = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    const t = byId.get(id);
    if (!t) { missing.add(id); continue; }
    seen.set(id, t);
    const kids = [];
    for (const p of t.Sf || []) if (p.id !== undefined) kids.push(p.id);
    for (const r of t.rc || []) if (r.id !== undefined) kids.push(r.id);   // 按钮四态
    for (const k of kids) if (!seen.has(String(k))) stack.push(String(k));
  }
  return { tags: [...seen.values()], missing: [...missing] };
}

/* ---------- 4. 瘦身：按 sprite.js 真正用到的字段裁剪 + 路径数字收到 2 位小数 ---------- */
const FIELDS = {
  2: ['id', 'tp', 'pt', 'Fs', 'Ls'],            // 形状：processShape 只用 pt / Fs / Ls
  39: ['id', 'tp', 'Sf'],                       // 精灵：b.sprite 只用 Sf（帧由 tp:1 切出）
  10: ['id', 'tp', 'us', 'fo'],                 // 字体：processFont 用 us / fo
  11: ['id', 'tp', 'rs', 'tf', 'tt', 'bd'],     // 文本：processText 用 rs / tf / tt / bd
  7: ['id', 'tp', 'rc', 'ac'],                  // 按钮：Button 用 rc / ac
};
const round2 = (s) => String(s).replace(/-?\d+(?:\.\d+)?/g, (m) => String(Math.round(parseFloat(m) * 100) / 100));

function prune(tag) {
  const keys = FIELDS[tag.tp];
  if (!keys) return tag;
  const out = {};
  for (const k of keys) if (tag[k] !== undefined) out[k] = tag[k];
  for (const p of out.pt || []) if (typeof p.da === 'string') p.da = round2(p.da);
  for (const p of out.Sf || []) {
    if (typeof p.ma === 'string') p.ma = round2(p.ma);
    /* ⚠ 千万不要删放置里的 `tp`：`tp:1` 是 **ShowFrame（帧边界）**，帧就是靠它切出来的。
     * 第一版这里写了 `delete p.tp` → 所有精灵都只剩 1 帧（数字精灵的整套字形全丢），
     * 表现是"数字精灵 frameCount()===1、gotoAndStop 无效"。 */
    delete p.ac;                 // 帧动作（AS 字节码）用不上：界面逻辑走翻译后的 JS
  }
  return out;
}

/* ---------- 5. 位图：data URI 落成文件（同内容去重），改成相对文件名 ---------- */
function extractBitmaps(tags, stats) {
  const dir = path.join(OUT, 'bitmap');
  const MIME = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
  const byHash = new Map();
  for (const t of tags) {
    for (let i = 0; i < (t.Fs || []).length; i++) {
      const img = t.Fs[i] && t.Fs[i].image;
      if (!img) continue;
      const href = img['xlink:href'] || img.href;
      if (typeof href !== 'string' || !href.startsWith('data:')) continue;
      const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(href);
      if (!m) die('位图 data URI 解析失败：标签 ' + t.id + ' Fs[' + i + ']');
      const buf = Buffer.from(m[2], 'base64');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      let name = byHash.get(hash);
      if (!name) {
        const ext = MIME[m[1]] || 'bin';
        name = 'bitmap/' + t.id + '_' + i + '.' + ext;
        /* 批168：该位图已有超分版（`.hd.png/.hd.jpg`）时，1x 不再落盘 ——
         * 原件归档在 references/.bak-upscale/ssfight-ui-bitmap-1x.zip；
         * 回退：删掉对应的 `.hd.*` 再重跑生成器，1x 会按出处重新导出。 */
        const hdHere = ['.hd.png', '.hd.jpg'].map((e) => name.replace(/\.[^.]+$/, '') + e)
          .find((f) => fs.existsSync(path.join(OUT, f)));
        if (!hdHere) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(OUT, name), buf);
        }
        byHash.set(hash, name);
        stats.bitmaps.push({ file: name, bytes: buf.length, from: m[1], firstTag: String(t.id) });
      }
      img['xlink:href'] = name;
      delete img.href;
    }
  }
}

/* ---------- 主界面元件名 → 人话（只写界面代码真正寻址的那些） ---------- */
const TEXT_NOTE = {
  name: '昵称（唯一的真文本标签 tp11；其余"字"都是矢量形状）',
  level: '等级数字（数字精灵，4 位）',
  energyMc: '体力条：101 帧，靠 cD 蒙版逐帧揭开填充',
  energy: '当前体力数字（3-4 位）',
  maxEnergy: '体力上限数字',
  expMc: '经验条：同体力条，cD 蒙版',
  expNum: '经验百分比数字',
  point: '经验条右侧的百分比装饰（0% / 100% 时换帧）',
  num1: '金松果数字 第 1 位（8 位里最左）',
  num8: '金松果数字 第 8 位',
  myself: '首页主角松鼠（89 帧循环动画，装备不参与）',
  prentices: '徒弟栏：第 1/2/3 帧摆 1/2/3 个徒弟，末帧空',
  newMessage: '新消息红点：第 2 帧 = 隐藏（复刻固定停在隐藏态）',
  c1: '限时道具角标槽 1（空槽帧 2）',
  viplevel: 'VIP 标：第 2 帧 = 隐藏（复刻没有 VIP）',
  homeButton: '村庄门（20 级起显示）',
  button1: '底栏「道具」', button2: '底栏「状态」', button3: '底栏「开始挑战」',
  button4: '底栏「消息」', button5: '底栏「系统」',
};

/* ---------- 主流程 ---------- */
function main() {
  const args = process.argv.slice(2);
  /* 默认 = 村庄主菜单页 + **真正的村庄页（homeLand）** + 道具页 + **状态页（zhuangtai）**
   * + 6 个装备容器 + 三个「地点场景页」库元件：这几样是运行时真正要用的。
   * ⚠ 状态页也在默认里 —— manifest 的 `bundles` 是"跑过哪些"的记录，
   *   漏掉哪一份，`tools/test-ssfight-render.cjs` 那条"包里都列出来了"的断言就会红。 */
  const DEFAULT = ['main', 'homeLand', 'daoju', 'zhuangtai', 'tiaozhan', 'message', ICON_BUNDLE]
    .concat(Object.keys(GEAR), Object.keys(SCENES));
  const wanted = args.includes('--all') ? Object.keys(ROOTS) : (args.length ? args : DEFAULT);
  for (const w of wanted) if (!(w in ROOTS)) die('不认识的名字：' + w + '（可选：' + Object.keys(ROOTS).join(' / ') + '）');

  const { data, sha, bytes } = readMovie();
  fs.mkdirSync(OUT, { recursive: true });
  const byId = new Map(data.tg.map((t) => [String(t.id), t]));
  const tl = splitTimeline(data.Mf);
  console.log('原版导出：%s（%s MB，sha256 %s…）',
    path.relative(ROOT, SRC), (bytes / 1048576).toFixed(1), sha.slice(0, 12));
  console.log('  完整字典 %d 个标签；根时间轴 %d 帧、%d 个帧标签',
    data.tg.length, tl.frameCount, Object.keys(tl.labels).length);

  /* 只以「要提取的那几个根元件」为种子。
   * 不要把根时间轴上所有页面的放置也塞进种子 —— 那会把别的页整棵闭包都拉进来
   * （第一版就这么干过：只提 main，却拉进 2429 个标签、4.97 MB）。
   *
   * ⚠ 装备容器单独出一份 `tags-gear.json`：它俩的闭包加起来 2.5 MB，
   *   而村庄页每次挂载都要拉 tags.json —— 装备只在"主角要穿衣服"时才需要，
   *   所以拆开 + 按需加载（fs 语义见 render.js 的 loadExtra）。 */
  /* 每个"单独成包"的页：村庄页每次挂载都要拉 tags.json，所以大页各自成包按需加载。
   * homeLand = 根时间轴帧 30 的 **homeMc（7140）**，也就是**真正的村庄界面**；
   * daoju   = 帧 40（7180），道具页；
   * homeland / summons / campaign = 三个「地点场景页」库元件（见上面 SCENES 的注释）——
   * 点进祭坛 / 幻兽 / 征战 才各拉自己那一份。 */
  const BUNDLES = {
    homeLand: 'tags-home.json',
    daoju: 'tags-daoju.json',
    /* 状态页（zhuangtai，帧 50 / 根元件 7218）：**经典模式的状态界面**由它整页渲染
     * （见 js/ssfight/ui-status.js）。原版这一页是 3 帧 = 状态 / 武器 / 技能 三个 tab，
     * 帧里的 2×5 装备格、四维条、今日胜率、战斗场次、Exp 都在里面。
     * 单独成包按需加载：只有真进状态页才拉。 */
    zhuangtai: 'tags-status.json',
    /* 挑战页（tiaozhan，帧 60 / 根元件 7638）：**经典模式的「开始挑战」界面**由它整页渲染
     * （见 js/ssfight/ui-challenge.js）。原版这一页顶栏 4 个 tab（随机 / 我的好友 / 竞技场 /
     * 关卡）、左列 4 行对手 + 右列立绘、`tiaozhanSub` 的 30 多帧二级/三级页都在里面。
     * 单独成包按需加载：只有真的点「开始挑战」才拉。 */
    tiaozhan: 'tags-challenge.json',
    /* 消息页（message，帧 100 / 根元件 7819）：**经典模式的「消息」界面**由它整页渲染
     * （见 js/ssfight/ui-message.js）。原版这一页顶栏 4 个 tab（消息 / 天梯赛 / 复仇 /
     * 留言）、一页 2 条记录（`win1/win2` + `text11/text22` + `back1/back2`）、
     * 左右翻页（`left`/`right`）与底栏 `back` / `button1`（论坛）/ `button2`（验证消息）。
     * 单独成包按需加载：只有真的点「消息」才拉。 */
    message: 'tags-message.json',
    /* 武器 / 技能图标（状态页第 2、3 帧那 10 个格子里的东西）：单独成包，因为
     * "进状态页"与"进挑战页"都要用（挑战页的敌人装备 / 技能也用同一批图标），
     * 而两者的页包互不包含。见上面 `iconRoots()` 的注释。 */
    [ICON_BUNDLE]: 'tags-wsicon.json',
    homeland: 'tags-homeland.json',
    summons: 'tags-summons.json',
    campaign: 'tags-campaign.json',
  };
  const pageWanted = wanted.filter((w) => PAGES[w] && !BUNDLES[w]);
  const gearWanted = wanted.filter((w) => GEAR[w]);
  const parts = [];
  if (pageWanted.length) parts.push({ file: 'tags.json', roots: pageWanted.map((w) => ROOTS[w]) });
  for (const name of Object.keys(BUNDLES)) {
    const sel = wanted.filter((w) => w === name);
    /* ⚠ 页包也要把**页根元件自己**放进闭包：`closure()` 是从 id 出发往下走的，
     * 而 `mountSymbol(id)` 要的正是那个根元件。少了它，运行时会报
     * "素材库里没有元件 N"（状态页第一次生成时就踩了这个）。 */
    const extra = name === 'zhuangtai' ? STATUS_PARTS.concat(STATUS_SUB)
      : name === 'tiaozhan' ? CHALLENGE_PARTS
        /* 道具页的通用弹窗「道具1」= **4886**（导出符号表把它误记成 4887，那一颗是 45×55
         * 的小按钮）。背包「使用」用它的第 1 帧，合成页用第 5 帧；两处都从道具页进，
         * 所以跟 `tags-daoju.json` 一起按需拉取，避免再开一份包。 */
        : name === 'daoju' ? ['4886'].concat(propIconRoots())
          : name === ICON_BUNDLE ? iconRoots() : [];
    if (sel.length) parts.push({ file: BUNDLES[name], roots: sel.map((w) => ROOTS[w]).filter(Boolean).concat(extra), pages: sel.slice() });
  }
  if (gearWanted.length) parts.push({ file: 'tags-gear.json', roots: gearWanted.map((w) => ROOTS[w]) });

  const missing = [];
  const perPart = parts.map((p) => {
    const r = closure(byId, p.roots);
    r.missing.forEach((m) => missing.push(m));
    return { file: p.file, tags: r.tags.map(prune) };
  });
  if (missing.length) {
    console.warn('  ⚠ 有 %d 个被引用但字典里不存在的 id：%s', missing.length, missing.slice(0, 10).join(', '));
  }
  /* 页包把根元件自己按**未裁剪**的形态再补一份进去（`prune` 会砍掉 `na`/`Sf` 之外的字段，
   * 但根元件本身就是一个普通 tp39 精灵，裁剪后依然能渲染）。上面 `closure` 已经把根算进去了，
   * 这里只是加一道断言，防止 ROOTS 写错时静默产出"缺页根"的包。 */
  for (const part of perPart) {
    const want = parts.find((p) => p.file === part.file);
    if (!want || !want.pages) continue;
    for (const w of want.pages) {
      if (w === ICON_BUNDLE) continue;                 // 不是"页"，没有页根元件
      if (!part.tags.some((t) => String(t.id) === String(ROOTS[w]))) {
        die('页包 ' + part.file + ' 里缺页根元件 ' + ROOTS[w] + '（' + w + '）');
      }
    }
  }

  const stats = { bitmaps: [] };
  const tags = [];
  perPart.forEach((p) => { extractBitmaps(p.tags, stats); p.tags.forEach((t) => tags.push(t)); });

  /* ---------- 位图 HD 覆盖 ----------
   * 原版内嵌位图分辨率就是舞台分辨率（村庄背景只有 320×196），放大到 1170 宽会发虚。
   * 约定：`bitmap/<原名>.hd.png|.hd.jpg` 存在时，把它**作为渲染用的那张**；
   * 该位图的 1x 不再落盘（批168，原件归档在 references/.bak-upscale/ssfight-ui-bitmap-1x.zip），
   * 回退 = 删掉 `.hd.*` 再重跑生成器（1x 按出处重新导出）。素材用 Real-ESRGAN 超分产出：
   *   E:\dev\sr\realesrgan\realesrgan-ncnn-vulkan.exe -n realesrgan-x4plus-anime -s 4
   * 不写死任何工具路径 —— 这里只认"已经放好的 .hd 文件"。 */
  const hdApplied = [];
  for (const b of stats.bitmaps) {
    const stem = b.file.replace(/\.[^.]+$/, '');
    const cand = ['.hd.png', '.hd.jpg'].map((e) => stem + e)
      .find((f) => fs.existsSync(path.join(OUT, f)));
    if (!cand) continue;
    let refs = 0;
    for (const part of perPart) {
      for (const t of part.tags) {
        for (const f of t.Fs || []) {
          const img = f && f.image;
          if (img && (img['xlink:href'] === b.file || img.href === b.file)) {
            img['xlink:href'] = cand; delete img.href; refs++;
          }
        }
      }
    }
    b.hd = cand; b.hdRefs = refs;
    hdApplied.push(cand + '（替换 ' + b.file + '，' + refs + ' 处引用）');
  }
  if (hdApplied.length) console.log('  位图 HD 覆盖：' + hdApplied.join('；'));

  fs.mkdirSync(OUT, { recursive: true });

  /* ---------- 形状补丁（导出丢轮廓）----------
   * 官方 H5 导出（以及 SoThink 的 SVG 导出）把一条形状的边**只按"右侧填充号"分组**，
   * 于是"填充在左侧"的那些轮廓会被整条丢掉。实测 tag 7023（主界面顶栏那颗金松果）
   * 就丢了唯一一条 75 点的轮廓 —— 它在 SWF 里 leftFill = 2（rgb(255,204,0)，果身那片亮黄）、
   * rightFill = 3；丢掉之后那片区域没人填，透出的是体力条的棕色，也就是用户看到的
   * "金松果右下角缺一块没填色"（2026-10，第一百四十四批第⑦项）。
   *
   * 这条补丁是用 `swf-parser`（npm，成熟实现；本仓库不依赖它）从 `references/.../ssfight.swf`
   * 里把 7023 的 1045 条记录完整读出来、按"每条轮廓同时归给左右两侧的填充号"重建后，
   * 与导出逐条对账**只差这一条**，再按导出既有的方向约定（实测 60 条已匹配轮廓里 53 条是反向）
   * 反向补回 `fi=11` 那条路径的末尾。核对方式：把补丁加入前后的同一视图渲染出来与
   * Ruffle 参考图对照（out/ 下的对照图，见更新记录）。
   * ⚠ 数值不要手改：要改就重跑上面那套对账流程。 */
  const SHAPE_PATCHES = {
    7023: [{
      fi: 11,
      da: 'M221.5,34.65L221.55,34.5L221.8,34.35Q221.95,34.2 222.2,34.15Q223.05,33.55 224,33.3L226.4,33.05L226.25,33.35L226.4,33.35L226.7,33.3L227.35,33.45L227.45,33.5L227,33.6L226.9,33.7L226.95,33.75L227,33.85Q226.9,34.3 227.2,34.2L227.55,33.8Q228.2,33.95 228.15,34.15L228.3,34.05Q228.5,33.8 228.2,33.7L227.75,33.55L227.5,33.5L228,33.5L228.05,33.5L228.2,33.5L228.2,33.55L228.3,33.65L228.65,33.7L228.65,33.55L228.65,33.4L228.6,33.3L229.25,33.5L230.2,33.75Q230.9,33.95 231.6,34.4Q232.3,34.75 232.65,35.05L233.4,35.7L233.6,36.3L233.45,37L233.15,37.2Q233.3,37.8 232.75,38.05L232.2,38.25L231.75,38.25L231.25,37.95L231.25,38.3L230.6,38.8L229.7,38.85L229.1,38.45L228.6,37.75L228.5,38.3L228,38.9L226.25,38.75L225.4,38.1L225.35,38.3L225.25,38.4L224.7,38.8L223.95,38.8Q223.5,38.75 223.3,38.45L223,37.65L223,37.15L222.7,37.45L221.75,37.65L221.2,37.4L220.9,37.1Q220.6,36.75 220.8,36.2L221.05,35.8L220.9,35.75L220.75,35.65L220.85,35.5L221.5,34.65L221.45,34.8L222.5,34.55L223.3,34.3Q223.15,34.15 223,34.15L222.5,34.1L222.2,34.15',
    }],
  };
  let patchApplied = 0;
  for (const part of perPart) {
    for (const t of part.tags) {
      const list = SHAPE_PATCHES[String(t.id)];
      if (!list) continue;
      for (const p of list) {
        const seg = (t.pt || []).find((s) => s.fi === p.fi);
        if (!seg) { console.warn('  ⚠ 形状补丁：tag ' + t.id + ' 里没有 fi=' + p.fi + ' 的填充段，跳过'); continue; }
        if (seg.da.includes(p.da.slice(0, 24))) continue;      // 幂等
        seg.da += p.da; patchApplied++;
      }
    }
  }
  if (patchApplied) console.log('  形状补丁：补回 ' + patchApplied + ' 条被导出丢掉的轮廓（见 SHAPE_PATCHES 注释）');

  const tagsFile = path.join(OUT, 'tags.json');
  const mainPart = perPart.find((p) => p.file === 'tags.json');
  if (mainPart) fs.writeFileSync(tagsFile, JSON.stringify(mainPart.tags));
  perPart.filter((p) => p.file !== 'tags.json')
    .forEach((p) => fs.writeFileSync(path.join(OUT, p.file), JSON.stringify(p.tags)));
  const tlFile = path.join(OUT, 'timeline.json');
  fs.writeFileSync(tlFile, JSON.stringify({
    Fw: data.Fw, Fh: data.Fh, Fr: data.Fr, Bg: data.Bg, Fc: data.Fc, Ft: data.Ft,
    frameCount: tl.frameCount, labels: tl.labels, frames: tl.frames,
  }));

  /* 主界面「元件索引」：把每页根精灵子树上所有带 `na`（实例名）的元件列成一张表。
   * 界面代码寻址全靠这些名字（`main.energyMc` / `main.expNum` …），
   * 而它们散在 tags.json 的 700 KB 里 —— 这张表让"某个名字在哪、是哪一号元件"一眼可见。
   * 只在提取 main 页时写；别的页没有对应的界面代码，写了也没人用。 */
  if (wanted.includes('main')) {
    const byIdTag = new Map(tags.map((t) => [String(t.id), t]));
    const seen = new Set();
    const rows = [];
    (function walk(id) {
      const t = byIdTag.get(String(id));
      if (!t) return;
      for (const p of t.Sf || []) {
        if (p.tp !== 26) continue;
        const child = byIdTag.get(String(p.id));
        if (!child) continue;
        if (p.na && !seen.has(p.na)) {
          seen.add(p.na);
          rows.push({
            name: p.na, id: String(p.id), depth: p.d,
            kind: child.tp === 39 ? 'sprite' : child.tp === 11 ? 'text' : child.tp === 2 ? 'shape' : 'tp' + child.tp,
            frames: (child.Sf || []).filter((q) => q.tp === 1).length + 1,
            note: TEXT_NOTE[p.na] || undefined,
          });
        }
        if (child.tp === 39) walk(p.id);
      }
    })(PAGES.main);
    rows.sort((a, b) => (a.depth - b.depth));
    fs.writeFileSync(path.join(OUT, 'elements.json'), JSON.stringify({
      page: 'main', pageRootId: String(PAGES.main), source: 'tags.json（本目录）',
      how: '界面代码用 view.byName(名字) 寻址；名字来自 SWF 放置标签的 na 字段。',
      count: rows.length, elements: rows,
    }, null, 1));
    console.log('  主界面元件索引：%d 个带名字的元件 → elements.json', rows.length);
  }

  /* ============================================================
   * 【索引】文本字段表（textfields-index.json）
   * ------------------------------------------------------------
   * 为什么非有不可：改经典界面时最贵的一类错误是**文字放不下**，而且它
   * **只在像素上看得见**。2026-10 那一批为此反复栽了三处：
   *   · `info1`(4730) 框宽 127，代码按"每行 10 个全角字"硬断 —— 实际一行能放 15~17 个，
   *     于是行数翻倍、纵向冲出对话框（用户报的"介绍文字严重超出屏幕范围"）；
   *   · 体力数字整组宽 47 个舞台单位、而条的实心框只有 58 —— 缩到 0.78 仍然偏大；
   *   · 状态页 `expNum`(7182) 宽 95.2，素材里写的占位串 **"999999/999999"** 恰好塞得下，
   *     所以肉眼以为没问题，真值一长就被裁。
   * 这三处的共同点是：**答案是纯静态数据算出来的**，却每次都靠开无头浏览器量。
   * 本表把它一次算清：每个文本字段的框宽 / 字号 / **一行能放几个字符**（全角），
   * 以及在哪些页包里、被哪个具名元件持有。
   *
   * ⚠ 字号→字符宽的关系是本文件自己算的，依据有两条（都在本仓库里可核）：
   *   ① `js/ssfight/render.js` 的 `FONT_MAP` 把字体号映射成族名（实测这批页面
   *      **只有 2030 = SimHei 一个族**在文本字段里用）；
   *   ② SimHei 的**中文字形是 1.0 em 宽、ASCII 是 0.5 em**（浏览器实测，
   *      见 `CJK_PER_EM` / `ASCII_PER_EM`）。
   *   所以 `charsPerLine = floor(可用框宽 / 字号)` —— 不需要 canvas、不需要浏览器。
   *   换了字体族 / 混排英文多的时候这个估算会偏，届时用 `note` 标出来重算。 */
  const CJK_PER_EM = 1.0, ASCII_PER_EM = 0.5;
  /* 字段元数据由**另一个**工具产出（`tools/gen-ssfight-textfields.cjs` → `textfields.json`，
   * 从 SWF 的 DefineEditText 里抠出来的 bd/al/lm/rm/fh/fd）。它是"框宽"的唯一来源，
   * 缺了这张表本索引就只能退回"字号"这一列 —— 所以读不到时**明确报一句**，
   * 而不是安静地写一堆 `boxW: null`（那样这张表就没有存在的意义了）。 */
  let fieldMeta = null;
  try {
    if (fs.existsSync(TEXT_FIELDS_FILE)) fieldMeta = JSON.parse(fs.readFileSync(TEXT_FIELDS_FILE, 'utf8'));
  } catch (e) { fieldMeta = null; }
  if (!fieldMeta) {
    console.warn('  ⚠ 读不到 %s —— 文本字段索引只有字号、没有框宽/每行字数。',
      path.relative(ROOT, TEXT_FIELDS_FILE));
    console.warn('    先跑一次： node tools/gen-ssfight-textfields.cjs');
  }
  const TEXT_BUNDLES = [
    ['status', 'tags-status.json', ['zhuangtai']],
    ['challenge', 'tags-challenge.json', ['tiaozhan']],
    ['homeLand', 'tags-home.json', ['homeLand']],
    ['daoju', 'tags-daoju.json', ['daoju']],
    /* 消息页（`message` 帧 / 7819）：正文与时间那四个字段的框宽是"一行放几个字"的依据，
     *  `js/ssfight/ui-message.js` 按它断行 —— 不进索引的话改文案只能靠开浏览器量。 */
    ['message', 'tags-message.json', ['message']],
    ['main', 'tags.json', ['main']],
  ];
  const textRows = [];
  for (const [bundleName, file, want] of TEXT_BUNDLES) {
    if (!want.some((w) => wanted.includes(w))) continue;
    const p = perPart.find((q) => q.file === file);
    if (!p) continue;
    const bById = new Map(p.tags.map((t) => [String(t.id), t]));
    /* 每个文本字段：算式用的框宽取自 textfields.json（SWF 提取的字段元数据），
     * 那里没有的（H5 导出独有）就退回 `rs` 的形态标 `unknown`。 */
    for (const t of p.tags) {
      if (t.tp !== 11) continue;
      const meta = (fieldMeta && fieldMeta[String(t.id)]) || null;
      const first = (t.rs || [])[0] || {};
      const fh = Number((meta && meta.fh) || first.h || first.fs || 12);
      const wide = meta && meta.bd ? (meta.bd[1] - meta.bd[0] - (meta.lm || 0) - (meta.rm || 0)) : null;
      textRows.push({
        id: String(t.id),
        bundle: bundleName,
        boxW: wide == null ? null : +wide.toFixed(2),
        boxH: meta && meta.bd ? +(meta.bd[3] - meta.bd[2]).toFixed(2) : null,
        fontId: (meta && meta.fd) || first.fd || null,
        fontH: fh,
        align: meta ? (meta.al === 2 ? 'center' : meta.al === 1 ? 'right' : 'left') : null,
        /* 一行能放几个**全角**字；ASCII 按 0.5 折算。 */
        charsPerLine: wide == null ? null : Math.max(1, Math.floor(wide / fh)),
        sample: String(first.tx == null ? '' : first.tx).replace(/[\r\n]+/g, ' ').slice(0, 24),
        /* 持有它的具名实例（哪个页的哪个名字），便于反查"这个字段是谁写的" */
        heldBy: [],
      });
      if (textRows.length > 4000) break;
    }
    /* 反过来标一遍持有者：遍历带名字的放置，把名字挂到它指到的文本字段上。 */
    const byRow = new Map(textRows.filter((r) => r.bundle === bundleName).map((r) => [r.id, r]));
    for (const t of p.tags) {
      for (const pl of t.Sf || []) {
        if (pl.tp !== 26 || !pl.na) continue;
        const row = byRow.get(String(pl.id));
        if (!row) continue;
        const label = t.id + '.' + pl.na;
        if (row.heldBy.length < 4 && row.heldBy.indexOf(label) < 0) row.heldBy.push(label);
      }
    }
  }
  if (textRows.length) {
    fs.writeFileSync(path.join(OUT, 'textfields-index.json'), JSON.stringify({
      generator: 'tools/gen-ssfight-ui.cjs',
      how: '每个文本字段的框宽与"一行几个全角字"；改界面文案前先查这张表，别靠开浏览器量。',
      glyph: { cjkPerEm: CJK_PER_EM, asciiPerEm: ASCII_PER_EM, families: { 2030: 'SimHei', 3146: 'Microsoft YaHei' } },
      formula: 'charsPerLine = floor((bd[1] - bd[0] - lm - rm) / fontH)',
      count: textRows.length,
      fields: textRows,
    }, null, 1));
    console.log('  文本字段索引：%d 条（框宽 / 字号 / 每行字数）→ textfields-index.json', textRows.length);
  }

  /* ============================================================
   * 【索引】具名元件 → 所属页包 / 帧 / 名字路径（symbol-index.json）
   * ------------------------------------------------------------
   * 为什么非有不可：`view.byName(名字)` 只在**当前帧**上有效，而同一批名字
   * 散在十几个页包、几百个精灵的 Sf 流里。改界面时"这个字段在哪一页、哪一号元件、
   * 第几帧才出现"几乎每次都要重新 grep —— 2026-10 为了找「状态1」「查看装备」
   * 那两个容器，前后翻了三轮才落到 **4673** 上（导出符号表还把它误记成 4675）。
   * 本表按页包分组，一眼给出：名字 → 元件号 / 类型 / 帧数 / 出现在宿主第几帧。 */
  const symIndex = {};
  for (const [bundleName, file, want] of TEXT_BUNDLES.concat([['gear', 'tags-gear.json', ['gearHead']]])) {
    if (!want.some((w) => wanted.includes(w))) continue;
    const p = perPart.find((q) => q.file === file);
    if (!p) continue;
    const bById = new Map(p.tags.map((t) => [String(t.id), t]));
    const names = {};
    for (const t of p.tags) {
      const frames = [];
      let f = 1;
      for (const pl of t.Sf || []) {
        if (pl.tp === 1) { f++; continue; }
        if (pl.tp !== 26 || !pl.na) continue;
        const child = bById.get(String(pl.id));
        if (!child) continue;
        if (!frames.includes(f)) frames.push(f);
        names[pl.na] = {
          id: String(pl.id),
          kind: child.tp === 39 ? 'sprite' : child.tp === 11 ? 'text' : child.tp === 2 ? 'shape' : 'tp' + child.tp,
          frames: (child.Sf || []).filter((q) => q.tp === 1).length + 1,
          inFrames: frames.slice(0, 8),
          owner: String(t.id),
        };
      }
    }
    if (Object.keys(names).length) symIndex[bundleName] = { bundle: file, count: Object.keys(names).length, names: names };
  }
  if (Object.keys(symIndex).length) {
    fs.writeFileSync(path.join(OUT, 'symbol-index.json'), JSON.stringify({
      generator: 'tools/gen-ssfight-ui.cjs',
      how: 'view.byName(名字) 的寻址面：名字 → 元件号 / 类型 / 帧数 / 出现在宿主第几帧。'
        + '改界面前先在这里查，比 grep 700 KB~1.8 MB 的 tags-*.json 快得多。',
      bundles: symIndex,
    }, null, 1));
    console.log('  具名元件索引：%d 个页包 → symbol-index.json',
      Object.keys(symIndex).length);
  }

  /* 装备「容器帧号」映射表：原版 `MainMovie.as` 的 `equipsArray`（288 条 = 72 套 × 4 部位）
   * 第 12 列就是 frame —— 穿装备 = `容器.gotoAndStop(frame)`。
   * 这张表在 SWF 里**不在**导出数据里（是 AS 内嵌表），所以只能从 .as 抠。 */
  if (gearWanted.length) {
    const asFile = path.join(ROOT, 'references', 'ssfight', 'ssfight', 'ssfight', 'resource', '动作', 'MainMovie.as');
    if (!fs.existsSync(asFile)) {
      console.warn('  ⚠ 缺少 %s —— 跳过 gear-frames.json（装备能导出，但没有帧号映射）', path.relative(ROOT, asFile));
    } else {
      const src = fs.readFileSync(asFile, 'utf8');
      const at = src.search(/var\s+equipsArray\s*=/);
      const s2 = src.indexOf('[', at);
      const e2 = src.indexOf('];', s2);
      const rows = JSON.parse(src.slice(s2, e2 + 1).replace(/'/g, '"'));
      const TYPE_NAME = { 0: '头', 1: '拳套', 2: '衣服', 3: '鞋子' };
      const gear = rows.map((r) => ({
        id: Number(r[5]), type: Number(r[10]), part: TYPE_NAME[r[10]] || ('type' + r[10]),
        name: r[11], frame: Number(r[12]), setId: Number(r[0]), quality: Number(r[1]),
      }));
      fs.writeFileSync(path.join(OUT, 'gear-frames.json'), JSON.stringify({
        source: 'references/ssfight/ssfight/ssfight/resource/动作/MainMovie.as（内嵌 equipsArray）',
        how: '穿装备 = 对应容器精灵（头B/外拳套B/内拳套B/衣服B/手臂B/鞋子B）.gotoAndStop(frame)；'
           + '有镶嵌加成时 frame += (max(addr1Lv,addr2Lv,addr3Lv) - 1)（MainMovie.as:6608 constructBpData）。',
        container: { 0: 'gearHead/头B', 1: 'gearFistOut+gearFistIn/外拳套B·内拳套B', 2: 'gearBody+gearArm/衣服B·手臂B', 3: 'gearShoe/鞋子B' },
        count: gear.length, gear: gear,
      }, null, 1));
      console.log('  装备帧号映射：%d 条（72 套 × 4 部位）→ gear-frames.json', gear.length);
    }

    /* 挂点精灵表：原版每个"挂点"是一个空精灵，它自己的 frame 1 脚本跑
     *   `_root.getEquipBpData(this, type, which)` —— 这一行就是"这儿该长哪件装备"的声明。
     * 所以 id → (type, which) 只能从 `resource/动作/sprite<N>_frame1.as` 里扫出来。
     * 复刻靠这张表在挂点实例化的瞬间把对应容器贴上去。 */
    const actDir = path.join(ROOT, 'references', 'ssfight', 'ssfight', 'ssfight', 'resource', '动作');
    if (!fs.existsSync(actDir)) {
      console.warn('  ⚠ 缺少 %s —— 跳过 gear-slots.json（装备素材有，但没有挂点表）', path.relative(ROOT, actDir));
    } else {
      const slots = {};
      let scanned = 0;
      for (const fn of fs.readdirSync(actDir)) {
        const m = /^sprite(\d+)(?:_frame\d+)?\.as$/.exec(fn);
        if (!m) continue;
        scanned++;
        const txt = fs.readFileSync(path.join(actDir, fn), 'utf8');
        const hit = /(?:getEquipBpData|chooseEquipLoader)\(this,\s*(\d+),\s*(\d+)\)/.exec(txt);
        if (hit) slots[m[1]] = [Number(hit[1]), Number(hit[2])];
      }
      const CONTAINER = [['gearHead'], ['gearFistOut', 'gearFistIn'], ['gearBody', 'gearArm'], ['gearShoe']];
      const PART = ['头', '拳套', '衣服', '鞋子'];
      const ids = Object.keys(slots).map(Number).sort((a, b) => a - b);
      const byPart = {};
      for (const id of ids) { const [ty] = slots[id]; byPart[PART[ty]] = (byPart[PART[ty]] || 0) + 1; }
      /* ---------- 挂点的"持有者" ----------
       * 谁把挂点精灵放进自己的时间轴。实测（2026-10，见 docs 更新记录）：
       *   · 每个部位只有一个持有者（头 5433 / 鞋 5187 / 拳套 5115·5604 / 衣服 5261·4949）；
       *   · 持有者是 **189 帧**的精灵，**每一帧放一个挂点**（所以帧号 = 装备帧号）；
       *   · 持有者本身挂在 myself 的 `ikNode_xx` 下面 —— 所以挂点跟着骨骼走，位置是对的。
       * 原版由装备帧号驱动持有者的帧号；复刻必须照做，否则持有者自由播放、每帧换一个挂点，
       * 装备就会在角色身上乱跳（用户反映的"脚部剧烈抖动"就是这么来的）。 */
      const parentOf = new Map();
      for (const t of tags) for (const p of t.Sf || []) {
        if (p.tp !== 26) continue;
        const k = String(p.id);
        if (!parentOf.has(k)) parentOf.set(k, String(t.id));
      }
      const holderOf = (id) => parentOf.get(String(id)) || null;
      const holders = {};
      for (const id of ids) {
        const h = holderOf(id);
        if (!h) continue;
        if (!holders[h]) holders[h] = { id: h, type: slots[id][0], which: slots[id][1], count: 0 };
        holders[h].count++;
      }
      fs.writeFileSync(path.join(OUT, 'gear-slots.json'), JSON.stringify({
        source: 'references/ssfight/ssfight/ssfight/resource/动作/sprite<N>_frame1.as（扫描 getEquipBpData(this,type,which)）',
        how: '挂点精灵本身是空壳；实例化时按 (type,which) 贴 CONTAINER[type][which] 容器并 gotoAndStop(frame)。',
        holderHow: '每个部位的挂点由"持有者"精灵按帧放出（持有者 189 帧、每帧一个挂点）。'
          + '必须先 gotoAndStop(装备帧号) 把持有者钉在那一帧，挂点才会是正确的那一个；'
          + '让持有者自由播放会让装备在角色身上乱跳。',
        container: CONTAINER.map((row, i) => ({ type: i, part: PART[i], symbols: row, ids: row.map((n) => GEAR[n]) })),
        holders: Object.values(holders).sort((a, b) => Number(a.id) - Number(b.id)),
        scannedFiles: scanned, count: ids.length,
        slots: ids.map((id) => ({
          id: String(id), type: slots[id][0], which: slots[id][1],
          container: CONTAINER[slots[id][0]][slots[id][1]],
          containerId: GEAR[CONTAINER[slots[id][0]][slots[id][1]]],
          part: PART[slots[id][0]],
          holder: holderOf(id),
        })),
      }, null, 1));
      console.log('  装备挂点表：%d 个挂点（%s）→ gear-slots.json', ids.length,
        Object.entries(byPart).map(([k, v]) => k + v).join('/'));
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    generator: 'tools/gen-ssfight-ui.cjs',
    source: path.relative(ROOT, SRC).split(path.sep).join('/'),
    sourceBytes: bytes, sourceSha256: sha,
    pages: pageWanted,
    gear: gearWanted,
    pageRootIds: Object.fromEntries(wanted.map((w) => [w, ROOTS[w]])),
    dictionarySize: data.tg.length,
    exportedTags: tags.length,
    bundles: perPart.map((p) => ({ file: p.file, tags: p.tags.length })),
    frameLabels: tl.labels,
    bitmapCount: stats.bitmaps.length,
    bitmaps: stats.bitmaps,
    missingIds: missing,
  }, null, 1));

  const mb = (p) => (fs.statSync(p).size / 1048576).toFixed(2) + ' MB';
  console.log('产出 images/ssfight/ui/：');
  perPart.forEach((p) => console.log('  %s %s（%d 个标签）', p.file.padEnd(15), mb(path.join(OUT, p.file)), p.tags.length));
  console.log('  timeline.json %s（%d 帧，标签 %s）', mb(tlFile), tl.frameCount, Object.keys(tl.labels).join('/'));
  console.log('  bitmap/       %d 张 · %s', stats.bitmaps.length,
    (stats.bitmaps.reduce((s, b) => s + b.bytes, 0) / 1048576).toFixed(2) + ' MB');
}

/* Incremental battle-dialog export: individual Sprite files contain full root
 * timelines but only stubs for child sprites. Resolve those stubs recursively;
 * never regenerate the page bundles, timeline or existing UI indexes here. */
function fightResultBundle() {
  const names = swfSymbolIds();
  const roots = {
    arenaContinue: names.get('继续竞技'), rankContinue: names.get('排位赛继续战斗'),
    stageContinue: '4839', notice: names.get('对话框'), action: '3801',
  };
  if (Object.values(roots).some(id => !id)) die('战后界面符号未在原SWF找到');
  const folder = path.join(path.dirname(SWF), 'resource', 'Sprite');
  const byId = new Map(), expanded = new Set(), sources = [];
  function visit(value) {
    const id = String(value);
    if (expanded.has(id)) return;
    const known = byId.get(id);
    if (known && known.tp !== 39) { expanded.add(id); return; }
    const file = path.join(folder, 'sprite' + id + '.html');
    if (!fs.existsSync(file)) die('战后界面闭包缺失：' + id);
    const raw = fs.readFileSync(file), text = raw.toString('utf8');
    const begin = text.indexOf('var data =') + 'var data ='.length;
    const movie = JSON.parse(text.slice(begin, text.indexOf('</script>', begin)));
    sources.push({ path: path.relative(ROOT, file).replace(/\\/g, '/'), bytes: raw.length,
      sha256: crypto.createHash('sha256').update(raw).digest('hex') });
    expanded.add(id);
    const tag = Object.assign({}, movie.Mf, { id, tp: 39 });
    byId.set(id, tag);
    for (const child of movie.tg || []) if (!byId.has(String(child.id))) byId.set(String(child.id), child);
    for (const placement of tag.Sf || []) if (placement.id != null) visit(placement.id);
  }
  Object.values(roots).forEach(visit);
  const tags = [...byId.values()].map(prune).sort((a, b) => Number(a.id) - Number(b.id));
  // No unrelated bitmap is rewritten, even when already extracted by another page.
  for (const tag of tags) for (const [i, fill] of (tag.Fs || []).entries()) {
    const image = fill && fill.image, href = image && (image['xlink:href'] || image.href);
    if (typeof href !== 'string' || !href.startsWith('data:')) continue;
    const match = /^data:image\/(png|jpeg|jpg|gif);base64,([\s\S]*)$/.exec(href);
    if (!match) die('不支持的战后界面位图：' + tag.id);
    const name = 'bitmap/' + tag.id + '_' + i + '.' + (match[1] === 'jpeg' ? 'jpg' : match[1]);
    const target = path.join(OUT, name), bytes = Buffer.from(match[2], 'base64');
    if (fs.existsSync(target)) {
      if (!fs.readFileSync(target).equals(bytes)) die('战后界面位图与现有文件冲突：' + name);
    } else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
    image['xlink:href'] = name; delete image.href;
  }
  // loadExtra intentionally keeps an already loaded ID. Prove that overlapping
  // IDs mean the same artwork/timeline instead of depending on load order.
  const canonical = (value, key) => {
    if (key === 'id') return String(value);
    if (Array.isArray(value)) return value.map(v => canonical(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k], k)]));
    return value;
  };
  const newTags = new Map(tags.map(tag => [String(tag.id), JSON.stringify(canonical(tag))]));
  const sharedTags = [];
  for (const name of fs.readdirSync(OUT).filter(name => /^tags(?:-[\w-]+)?\.json$/.test(name) && name !== 'tags-fight-result.json').sort()) {
    const raw = fs.readFileSync(path.join(OUT, name)), existing = JSON.parse(raw.toString('utf8'));
    const ids = [];
    for (const tag of existing) {
      const expected = newTags.get(String(tag.id));
      if (!expected) continue;
      if (JSON.stringify(canonical(tag)) !== expected) die('战后界面与现有包同ID内容冲突：' + name + ' / ' + tag.id);
      ids.push(String(tag.id));
    }
    if (ids.length) sharedTags.push({ file: name, ids, sha256: crypto.createHash('sha256').update(raw).digest('hex') });
  }
  const file = path.join(OUT, 'tags-fight-result.json');
  fs.writeFileSync(file, JSON.stringify(tags));
  fs.writeFileSync(path.join(OUT, 'fight-result-manifest.json'), JSON.stringify({
    generator: 'tools/gen-ssfight-ui.cjs --fight-result', roots, count: tags.length, sources, sharedTags,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  }, null, 1));
  console.log('tags-fight-result.json: %d tags from %d targeted Sprite files; existing bundles/indexes untouched', tags.length, sources.length);
}

/* ============================================================================
 * 增量：**局内战斗素材包**（`tags-fight.json`）
 * ----------------------------------------------------------------------------
 * 经典模式的「局内战斗 / 胜利失败 / 战果 / 开宝箱抽奖」全部由**原版 fight 帧**渲染
 * （见 `js/ssfight/ui-fight.js`）。这些元件是**运行时 attach 的库元件**，不在任何
 * 页面包的可达闭包里，所以单独出一份：
 *   · `7772` —— fight 帧的根（原版根时间轴帧 70）：
 *       f1 = `backGround`(7692, 5 张场景) + `blood`(7703, 战斗 HUD) + `winWords`(7717, 胜负字)
 *       f2/f3 = 战果页（`backgd` / `prizeBackg` / `maxlevel` / `shoutu` / `getExp` / c1·c2·c3）
 *       f5 = `openChest`(7771) = **开宝箱抽奖**（b1..b4 / k1..k4 / text0）
 *   · `7689` —— 战斗里的**格斗者容器**，原版根时间轴帧 60 用 `player1`/`player2` 两个实例
 *       把它按 `matrix(±0.453,0,0,0.453,17.05|303.4,107.45)` 摆在左右两侧：
 *       f1 = 松鼠（`playerMc`=7639 三个装备挂点视图 + `statu`=7658 状态特效层）
 *       f2..f6 = 三侠 / 伤害累计 / 征战 的其它体型（复刻只走 f1，但一起提出来备用）
 *   · `6532` —— **松鼠**本体（`松鼠`）：f1 `attacks`(6339, 62 帧，逐帧一种攻击动作)
 *       f2 `defenses`(6427, 81 帧) / f3 `dodges` / f4 `defenseSkills` / f5 `attackbacks` /
 *       f6 `comeBacks` / f7 `winPoses` —— 动作选择逻辑照 `Squirrel.as`（MainMovie.as 的
 *       `setUp()` 里 `attachMovie("松鼠")` 挂的就是它，**静态闭包走不到**，必须显式列进来）。
 *       ⚠ 每个动作帧里都带 `ikNode_10..17` 这些**装备挂点**（导出实测：6203/6312/... 各帧都有），
 *         所以"战斗中穿装备"与村庄页同一套机制（`gear-slots.json`）。
 *   · `4847`（`战斗1` / `fightSub`）= 关卡连战对话框（`keepFight`）与左右血条；
 *   · 若干小件：`跳过`(4528) / `说话板子`(3704) / `获取道具`(3960) / `伤害累计`(3751) /
 *     `战斗准备中`(3464) / `战斗统计`(3535)。
 * 与 `--fight-result` 同一套做法：**只写这一份包与它的 manifest**，不重跑页面包 / 时间轴 /
 * 既有索引（那几个包很大，重跑一次没必要而且会动到别的 sha）。
 *
 * ⚠⚠ **闭包必须从整片导出（`html5/ssfight.html` 的 `data.tg`）走**，不要像 `--fight-result`
 *   那样逐片读 `resource/Sprite/sprite<N>.html`：逐片导出里对子精灵只给**存根**，
 *   而存根与真身**内容不一致**（实测 6058：逐片版缺 `Fs` 填充表，整片版有）。
 *   `loadExtra` 是同 id 先到先得，一份带存根的包会让画面随加载顺序变 ——
 *   第一次跑这条命令就是被这个拦下来的（"与现有包同ID内容冲突：tags.json / 6058"）。
 * ========================================================================== */
const FIGHT_PARTS = ['4847', '4528', '3704', '3960', '3751', '3464', '3535'];

/* ---------- 开打倒计时「3 → 2 → 1 → GO」**不再现造** ----------
 * 原版那一组 3/2/1/GO **就是血条 HUD（`7703`）第 8 帧里的子元件 `3750`**（42 帧：
 * f1-6 = 3 / f7-12 = 2 / f13-19 = 1 / f19-29 = GO，f30 起是空帧、f41 `stop()`），
 * 本来就在闭包里，不需要另造。第一百八十批以前这里按 H5 客户端的 go 图集现造过一颗
 * `gocd` 挂在场景中央，于是同一场战斗里出现**两版 321GO**，而且渲染器节拍器会把它
 * 循环推进（整场战斗一直闪 3/2/1/GO）。现在只留原版那一颗：
 * `js/ssfight/ui-fight.js` 的 `playHudCountdown()` 显式播它一次、停在 GO 之后的空帧。*/

function fightBundle() {
  const names = swfSymbolIds();
  const roots = {
    fight: '7772', fighter: '7689', hero: names.get('松鼠') || '6532',
    fightSub: '4847', skip: names.get('跳过') || '4528', talk: names.get('说话板子') || '3704',
    gainProp: names.get('获取道具') || '3960', harm: names.get('伤害累计') || '3751',
    rankReady: names.get('战斗准备中') || '3464', fightStat: names.get('战斗统计') || '3535',
  };
  if (Object.values(roots).some((id) => !id)) die('战斗界面符号未在原SWF找到');
  const { data, sha, bytes } = readMovie();
  const byId = new Map(data.tg.map((t) => [String(t.id), t]));
  /* 战利品图标（战果页 / 开宝箱那一格里的道具图）也要进这一包：它们是**按名字 attach 的
   * 库元件**（`attachMovie(<道具名>, "mc", 100)`），静态闭包同样走不到。 */
  const lootRoots = lootIconRoots();
  const { tags: rawTags, missing } = closure(byId, Object.values(roots).concat(FIGHT_PARTS, lootRoots));
  if (missing.length) console.warn('  ⚠ 有 %d 个被引用但字典里不存在的 id：%s', missing.length, missing.slice(0, 10).join(', '));
  const tags = rawTags.map(prune).sort((a, b) => Number(a.id) - Number(b.id));
  const stats = { bitmaps: [] };
  extractBitmaps(tags, stats);
  /* 位图 HD 覆盖：与 `main()` 同一条规则（`bitmap/<原名>.hd.png|.hd.jpg` 存在就换引用，且 1x 不再落盘）。 */
  const hdApplied = [];
  for (const b of stats.bitmaps) {
    const stem = b.file.replace(/\.[^.]+$/, '');
    const cand = ['.hd.png', '.hd.jpg'].map((e) => stem + e).find((f) => fs.existsSync(path.join(OUT, f)));
    if (!cand) continue;
    let refs = 0;
    for (const t of tags) for (const f of t.Fs || []) {
      const img = f && f.image;
      if (img && (img['xlink:href'] === b.file || img.href === b.file)) { img['xlink:href'] = cand; delete img.href; refs++; }
    }
    b.hd = cand; b.hdRefs = refs;
    hdApplied.push(cand + '（替换 ' + b.file + '，' + refs + ' 处引用）');
  }
  /* 与既有包重叠的 id 必须**内容一致**（`loadExtra` 先到先得，冲突会让画面随加载顺序变）。 */
  const canonical = (value, key) => {
    if (key === 'id') return String(value);
    if (Array.isArray(value)) return value.map((v) => canonical(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k], k)]));
    return value;
  };
  const newTags = new Map(tags.map((tag) => [String(tag.id), JSON.stringify(canonical(tag))]));
  const sharedTags = [];
  for (const name of fs.readdirSync(OUT).filter((n) => /^tags(?:-[\w-]+)?\.json$/.test(n) && n !== 'tags-fight.json').sort()) {
    const file = fs.readFileSync(path.join(OUT, name)), existing = JSON.parse(file.toString('utf8'));
    const ids = [];
    for (const tag of existing) {
      const expected = newTags.get(String(tag.id));
      if (!expected) continue;
      const actual = JSON.stringify(canonical(tag));
      if (actual !== expected) {
        let at = 0;
        while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
        die('战斗界面与现有包同ID内容冲突：' + name + ' / ' + tag.id + '\n  现有：…' + actual.slice(Math.max(0, at - 40), at + 60) +
          '\n  新包：…' + expected.slice(Math.max(0, at - 40), at + 60));
      }
      ids.push(String(tag.id));
    }
    if (ids.length) sharedTags.push({ file: name, ids, sha256: crypto.createHash('sha256').update(file).digest('hex') });
  }
  const outFile = path.join(OUT, 'tags-fight.json');
  fs.writeFileSync(outFile, JSON.stringify(tags));
  fs.writeFileSync(path.join(OUT, 'fight-manifest.json'), JSON.stringify({
    generator: 'tools/gen-ssfight-ui.cjs --fight',
    source: path.relative(ROOT, SRC).split(path.sep).join('/'), sourceBytes: bytes, sourceSha256: sha,
    roots, count: tags.length, bitmaps: stats.bitmaps, hd: hdApplied, missingIds: missing, sharedTags,
    how: '经典模式的局内战斗 / 胜利失败 / 战果 / 开宝箱抽奖：SfRender.loadExtra("tags-fight.json") 后'
      + ' mountSymbol("7772") 是整场战斗的那一页，两个格斗者是 7689 的两个实例（原版 player1/player2），'
      + '动作选择照 Squirrel.as；hero=6532 是 attachMovie 挂上去的，静态闭包走不到所以显式列出。'
      + ' 开打倒计时是血条 HUD 第 8 帧里的原版 3750，不需要现造。',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex'),
  }, null, 1));
  console.log('tags-fight.json: %d tags（%s）· 位图 %d 张%s；既有包与索引未改动',
    tags.length, (fs.statSync(outFile).size / 1048576).toFixed(2) + ' MB', stats.bitmaps.length,
    hdApplied.length ? '（HD 覆盖 ' + hdApplied.length + '）' : '');
}

/* ==========================================================================
 * `--fusion`：只产出「装备融合」那几颗**还没进任何包**的库元件 →
 *   `images/ssfight/ui/tags-fusion.json`
 * --------------------------------------------------------------------------
 * 融合页的主体是 `状态1`(4673) 的第 8/9/13 帧，那一颗已经在 `tags-status.json` 里了，
 * 这里补的是原版流程里另外三颗（都能在 `MainMovie.as` 里找到出处）：
 *   · `装备融合帮助`(3157) —— `showFusionHelp()`（:8269）→ `loadMcs([["装备融合帮助","subFrame6"]])`，
 *     1 帧，含 `text1`(3149 文本框) + `left`/`right`(3156 翻页) + `button1`(3153)。
 *   · `融合中`(3763) —— `loadMcs([["融合中","fusion"]])`（:19001），11 帧的"融合中"过场。
 *   · `橙装弹出`(4493) —— `selectComposeType()`（:8073）→ `composeTypeMc`，1 帧，
 *     `c1`~`c7`(3414 卡片) + `text1`~`text7` + `back`(3362)。
 * 与 `--fight` 同一套做法：**只写这一份包与它的 manifest**，闭包从整片导出走。
 * ========================================================================== */
const FUSION_PARTS = ['3156', '3149', '3153', '3362', '3414', '3636', '3424'];
function fusionBundle() {
  const names = swfSymbolIds();
  const roots = {
    help: names.get('装备融合帮助') || '3157',
    fusing: names.get('融合中') || '3763',
    composeType: names.get('橙装弹出') || '4493',
  };
  if (Object.values(roots).some((id) => !id)) die('融合界面符号未在原SWF找到');
  const { data, sha, bytes } = readMovie();
  const byId = new Map(data.tg.map((t) => [String(t.id), t]));
  const { tags: rawTags, missing } = closure(byId, Object.values(roots).concat(FUSION_PARTS));
  if (missing.length) console.warn('  ⚠ 有 %d 个被引用但字典里不存在的 id：%s', missing.length, missing.slice(0, 10).join(', '));
  const tags = rawTags.map(prune).sort((a, b) => Number(a.id) - Number(b.id));
  const stats = { bitmaps: [] };
  extractBitmaps(tags, stats);
  const hdApplied = [];
  for (const b of stats.bitmaps) {
    const stem = b.file.replace(/\.[^.]+$/, '');
    const cand = ['.hd.png', '.hd.jpg'].map((e) => stem + e).find((f) => fs.existsSync(path.join(OUT, f)));
    if (!cand) continue;
    let refs = 0;
    for (const t of tags) for (const f of t.Fs || []) {
      const img = f && f.image;
      if (img && (img['xlink:href'] === b.file || img.href === b.file)) { img['xlink:href'] = cand; delete img.href; refs++; }
    }
    b.hd = cand; b.hdRefs = refs;
    hdApplied.push(cand + '（替换 ' + b.file + '，' + refs + ' 处引用）');
  }
  /* 与既有包重叠的 id 必须内容一致（`loadExtra` 先到先得）。 */
  const canonical = (value, key) => {
    if (Array.isArray(value)) { if (key === 'Fs' || key === 'rs' || key === 'Sf') return value.map((v) => canonical(v)); return value; }
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = canonical(value[k], k);
      return out;
    }
    return value;
  };
  const shared = new Map();
  for (const f of fs.readdirSync(OUT).filter((n) => /^tags.*\.json$/.test(n) && n !== 'tags-fusion.json')) {
    for (const t of JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))) if (!shared.has(String(t.id))) shared.set(String(t.id), f);
  }
  for (const t of tags) {
    const where = shared.get(String(t.id));
    if (!where) continue;
    const other = JSON.parse(fs.readFileSync(path.join(OUT, where), 'utf8')).find((x) => String(x.id) === String(t.id));
    if (JSON.stringify(canonical(other)) !== JSON.stringify(canonical(t))) die('融合界面与现有包同ID内容冲突：' + where + ' / ' + t.id);
  }
  const outFile = path.join(OUT, 'tags-fusion.json');
  fs.writeFileSync(outFile, JSON.stringify(tags));
  fs.writeFileSync(path.join(OUT, 'fusion-manifest.json'), JSON.stringify({
    generator: 'tools/gen-ssfight-ui.cjs --fusion',
    source: path.relative(ROOT, SRC).split(path.sep).join('/'), sourceBytes: bytes, sourceSha256: sha,
    roots, count: tags.length, bitmaps: stats.bitmaps, hd: hdApplied, missingIds: missing,
    how: '「装备融合」页的补充库元件：SfRender.loadExtra("tags-fusion.json") 之后'
      + ' 3157 = `showFusionHelp()` 的帮助页（text1 + left/right 翻页）、'
      + ' 3763 = `loadMcs([["融合中","fusion"]])` 的融合过场、'
      + ' 4493 = `selectComposeType()` 的类型选择弹窗（原件按蓝/紫/橙三档，复刻的融合规则不分档，未接线）。'
      + ' 主体 4673 的第 8/9/13 帧在 tags-status.json 里，本包不含。',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex'),
  }, null, 1));
  console.log('tags-fusion.json: %d tags（%s）· 位图 %d 张%s；既有包与索引未改动',
    tags.length, (fs.statSync(outFile).size / 1048576).toFixed(2) + ' MB', stats.bitmaps.length,
    hdApplied.length ? '（HD 覆盖 ' + hdApplied.length + '）' : '');
}

/* ==========================================================================
 * `--compose`：道具合成（碎片 / 种子 / 宝石等）的「合成中」过场与结果页 →
 *   `images/ssfight/ui/tags-compose.json`
 * --------------------------------------------------------------------------
 * 原版 `showCompose1()`（MainMovie.as:16325）`loadMcs([["合成中","compose"]])`，结果是
 * 库元件 **4402**：45 帧，前 44 帧是合成过场，最后一帧 `44` 才是结果页；
 * 结果页字段与 `showCompose2()`（:16329）逐条对应：
 *   `c1`（3414 图标位）/ `t_name` / `t_temp` / `t_baseOther` / `button1..3`。
 * `showComposeStone()` 成功走 `compose.gotoAndPlay(31)`（宝石结果从第 31 帧开始），
 * 失败直接 `showTips`；`showComposeEquip()`/`showComposeProp()` 用同一颗 4402。
 * 道具页本体 `4886` 第 5 帧已在 tags-status.json 里，本包只补 4402 闭包。
 * ========================================================================== */
const COMPOSE_PARTS = ['3142', '3414', '4391', '4392', '4393', '4394', '4395', '4396', '4397', '4399', '4401'];
function composeBundle() {
  const roots = { compose: '4402' };
  const { data, sha, bytes } = readMovie();
  const byId = new Map(data.tg.map((t) => [String(t.id), t]));
  const { tags: rawTags, missing } = closure(byId, Object.values(roots).concat(COMPOSE_PARTS));
  if (missing.length) console.warn('  ⚠ 有 %d 个被引用但字典里不存在的 id：%s', missing.length, missing.slice(0, 10).join(', '));
  const tags = rawTags.map(prune).sort((a, b) => Number(a.id) - Number(b.id));
  const stats = { bitmaps: [] };
  extractBitmaps(tags, stats);
  const hdApplied = [];
  for (const b of stats.bitmaps) {
    const stem = b.file.replace(/\.[^.]+$/, '');
    const cand = ['.hd.png', '.hd.jpg'].map((e) => stem + e).find((f) => fs.existsSync(path.join(OUT, f)));
    if (!cand) continue;
    let refs = 0;
    for (const t of tags) for (const f of t.Fs || []) {
      const img = f && f.image;
      if (img && (img['xlink:href'] === b.file || img.href === b.file)) { img['xlink:href'] = cand; delete img.href; refs++; }
    }
    b.hd = cand; b.hdRefs = refs;
    hdApplied.push(cand + '（替换 ' + b.file + '，' + refs + ' 处引用）');
  }
  const canonical = (value, key) => {
    if (Array.isArray(value)) { if (key === 'Fs' || key === 'rs' || key === 'Sf') return value.map((v) => canonical(v)); return value; }
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = canonical(value[k], k);
      return out;
    }
    return value;
  };
  const shared = new Map();
  for (const f of fs.readdirSync(OUT).filter((n) => /^tags.*\.json$/.test(n) && n !== 'tags-compose.json')) {
    for (const t of JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))) if (!shared.has(String(t.id))) shared.set(String(t.id), f);
  }
  for (const t of tags) {
    const where = shared.get(String(t.id));
    if (!where) continue;
    const other = JSON.parse(fs.readFileSync(path.join(OUT, where), 'utf8')).find((x) => String(x.id) === String(t.id));
    if (JSON.stringify(canonical(other)) !== JSON.stringify(canonical(t))) die('合成界面与现有包同ID内容冲突：' + where + ' / ' + t.id);
  }
  const outFile = path.join(OUT, 'tags-compose.json');
  fs.writeFileSync(outFile, JSON.stringify(tags));
  fs.writeFileSync(path.join(OUT, 'compose-manifest.json'), JSON.stringify({
    generator: 'tools/gen-ssfight-ui.cjs --compose',
    source: path.relative(ROOT, SRC).split(path.sep).join('/'), sourceBytes: bytes, sourceSha256: sha,
    roots, count: tags.length, bitmaps: stats.bitmaps, hd: hdApplied, missingIds: missing,
    how: '`showCompose1()`（MainMovie.as:16325）`loadMcs([["合成中","compose"]])` 的库元件 4402：'
      + ' 45 帧，前 44 帧为合成过场，最后一帧 `44` 是结果页（c1/t_name/t_temp/t_baseOther/button1..3）；'
      + ' 道具页本体 4886 第 5 帧仍在 tags-status.json。',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex'),
  }, null, 1));
  console.log('tags-compose.json: %d tags（%s）· 位图 %d 张%s；既有包与索引未改动',
    tags.length, (fs.statSync(outFile).size / 1048576).toFixed(2) + ' MB', stats.bitmaps.length,
    hdApplied.length ? '（HD 覆盖 ' + hdApplied.length + '）' : '');
}

/* ==========================================================================
 * `--gear-colors`：原版**按品质预先上色**的装备库元件 →
 *   `images/ssfight/ui/tags-gear-color.json` + `gear-colors.json`
 * --------------------------------------------------------------------------
 * 原版 `convertLink(equip)`（MainMovie.as:16114）**不是**把通用容器按 cx 上色，
 * 而是拼一个库元件名再 `attachMovie`：
 *   · 套装 46/47/67~72 → `<名字>黑`；
 *   · 其它 → `<名字>白/绿/蓝/紫/橙`（品质 0~4）；
 *   · 头 / 手套（type 0/1）且品质 > 1 时再拼 `max(addr1Lv,addr2Lv,addr3Lv)`（没强化拼 1）。
 * 这些符号的美术颜色是**画在元件里**的（有的再用 cx 微调），与通用容器的染色不是一回事。
 * `showEquips` / `showWears`（:22088 / :22095）都直接挂这个符号、`gotoAndStop(1)`。
 *
 * 复刻的「更换装备 / 详情」以前贴现代界面正面 PNG，用户口径"不要用现代版 UI，经典版统一
 * 调用经典版矢量图"；这里按原版规则把符号闭包整包提出来，运行时按
 * `gear-colors.json` 的 `byGear[装备id][品质][强化档]` 查元件号。
 * 强化档 0 = 不拼数字（衣服 / 鞋 / 非紫橙）或回退档；头 / 手套的 1~3 已按
 * "精确档 → 无数字档 → 其它档"做好回退，运行时不必再猜。
 * ========================================================================== */
const GEAR_QUALITY_SUFFIX = ['白', '绿', '蓝', '紫', '橙', '黑'];
const GEAR_BLACK_SETS = new Set([46, 47, 67, 68, 69, 70, 71, 72]);
/** 一件装备在某个品质 / 强化档下可能对应的库元件名（按优先级）。 */
function gearColorCandidates(g, quality, level) {
  if (GEAR_BLACK_SETS.has(Number(g.setId)) || Number(quality) >= 5) return [g.name + '黑'];
  const base = g.name + (GEAR_QUALITY_SUFFIX[Number(quality)] || '黑');
  if ((Number(g.type) === 0 || Number(g.type) === 1) && Number(quality) > 1) {
    /* 原版：`max(addr…Lv)` 为 0 时拼 "1"；`level` 0 就是这一档。 */
    const want = Number(level) > 0 ? Number(level) : 1;
    const out = [base + want];
    for (let n = 1; n <= 3; n++) if (n !== want) out.push(base + n);
    out.push(base);                       // 极端情况下没有数字档才退回无数字
    return [...new Set(out)];
  }
  return [base];
}
function gearColorBundle() {
  const names = swfSymbolIds();
  const framesFile = path.join(OUT, 'gear-frames.json');
  if (!fs.existsSync(framesFile)) die('缺少 ' + framesFile + '（先跑一次默认生成器）');
  const gearRows = JSON.parse(fs.readFileSync(framesFile, 'utf8')).gear;
  if (!Array.isArray(gearRows) || !gearRows.length) die('gear-frames.json 里没有 gear 行');
  const { data, sha, bytes } = readMovie();
  const byId = new Map(data.tg.map((t) => [String(t.id), t]));
  const byGear = {};
  const roots = new Map();                 // id → 代表名（manifest 自查用）
  const missing = [];
  for (const g of gearRows) {
    const table = {};
    for (let q = 0; q <= 5; q++) {
      const levels = {};
      const wantLevels = (Number(g.type) === 0 || Number(g.type) === 1) && q > 1 && q < 5
        ? [0, 1, 2, 3] : [0];
      for (const lv of wantLevels) {
        let hit = null;
        for (const candidate of gearColorCandidates(g, q, lv)) {
          const sid = names.get(candidate);
          if (sid && sid !== 'None') { hit = { name: candidate, id: String(sid) }; break; }
        }
        if (hit) { levels[lv] = Number(hit.id); if (!roots.has(hit.id)) roots.set(hit.id, hit.name); }
      }
      if (Object.keys(levels).length) table[q] = levels;
    }
    if (Object.keys(table).length) byGear[String(g.id)] = table;
    else missing.push(String(g.id) + ':' + g.name);
  }
  if (!roots.size) die('一件装备的预上色符号都没找到（SWF / 导出数据对不上？）');
  const clos = closure(byId, [...roots.keys()]);
  if (clos.missing.length) console.warn('  ⚠ 有 %d 个被引用但字典里不存在的 id：%s',
    clos.missing.length, clos.missing.slice(0, 10).join(', '));
  const tags = clos.tags.map(prune).sort((a, b) => Number(a.id) - Number(b.id));
  const stats = { bitmaps: [] };
  extractBitmaps(tags, stats);
  /* 与既有包重叠的 id 必须内容一致（`loadExtra` 先到先得）。 */
  const canonical = (value, key) => {
    if (Array.isArray(value)) { if (key === 'Fs' || key === 'rs' || key === 'Sf') return value.map((v) => canonical(v)); return value; }
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = canonical(value[k], k);
      return out;
    }
    return value;
  };
  const shared = new Map();
  for (const f of fs.readdirSync(OUT).filter((n) => /^tags.*\.json$/.test(n) && n !== 'tags-gear-color.json')) {
    for (const t of JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))) if (!shared.has(String(t.id))) shared.set(String(t.id), f);
  }
  for (const t of tags) {
    const where = shared.get(String(t.id));
    if (!where) continue;
    const other = JSON.parse(fs.readFileSync(path.join(OUT, where), 'utf8')).find((x) => String(x.id) === String(t.id));
    if (JSON.stringify(canonical(other)) !== JSON.stringify(canonical(t))) die('预上色装备与现有包同ID内容冲突：' + where + ' / ' + t.id);
  }
  const outFile = path.join(OUT, 'tags-gear-color.json');
  fs.writeFileSync(outFile, JSON.stringify(tags));
  fs.writeFileSync(path.join(OUT, 'gear-colors.json'), JSON.stringify({
    generator: 'tools/gen-ssfight-ui.cjs --gear-colors',
    source: path.relative(ROOT, SRC).split(path.sep).join('/'), sourceBytes: bytes, sourceSha256: sha,
    count: roots.size, tags: tags.length, bitmaps: stats.bitmaps.length, missingGear: missing,
    how: '原版 `convertLink(equip)`（MainMovie.as:16114）拼出的库元件名 → SWF 导出符号 id；'
      + '`byGear[装备id][品质][强化档]` = 元件号。品质 0白/1绿/2蓝/3紫/4橙/5黑；'
      + '头/手套在品质>1时拼 max(强化等级)（1~3，已做回退）。运行时 attachChild(id, 1) 即可。',
    byGear,
  }, null, 1));
  console.log('预上色装备：%d 件 / %d 种符号 / %d 个标签（%s）→ tags-gear-color.json + gear-colors.json%s',
    Object.keys(byGear).length, roots.size, tags.length,
    (fs.statSync(outFile).size / 1048576).toFixed(2) + ' MB',
    missing.length ? '；缺符号 ' + missing.length + ' 件（见 manifest）' : '');
}

/* ==========================================================================
 * `--guide`：原版**新手引导**（`attachMovie("新手引导", "guide")`）→
 *   `images/ssfight/ui/tags-guide.json` + `guide-manifest.json`
 * --------------------------------------------------------------------------
 * ⚠ 导出符号表把「新手引导」记成 3628，但**3628 只有 1 帧，里面是文本
 *   「非官方」**，不是引导。按 `guide.gotoAndStop(mcIndex)`（mcIndex 1~25）、
 *   `guide.tipsContent.gotoAndStop(...)` 两个硬条件反查整片字典，真正的引导是
 *   **3625**：25 帧，第 19 帧有 `tipsContent`。这里以结构为准，不按错名字走。
 * 与 `--fusion` 同一套做法：只写这一份包与 manifest，闭包从整片导出走；
 * 既有包同 id 必须逐字节一致（`loadExtra` 先到先得）。
 * ========================================================================== */
const GUIDE_PARTS = ['3625'];
function guideBundle() {
  const { data, sha, bytes } = readMovie();
  const byId = new Map(data.tg.map((t) => [String(t.id), t]));
  const { tags: rawTags, missing } = closure(byId, GUIDE_PARTS);
  if (missing.length) console.warn('  ⚠ 有 %d 个被引用但字典里不存在的 id：%s', missing.length, missing.slice(0, 10).join(', '));
  const tags = rawTags.map(prune).sort((a, b) => Number(a.id) - Number(b.id));
  const stats = { bitmaps: [] };
  extractBitmaps(tags, stats);
  const hdApplied = [];
  for (const b of stats.bitmaps) {
    const stem = b.file.replace(/\.[^.]+$/, '');
    const cand = ['.hd.png', '.hd.jpg'].map((e) => stem + e).find((f) => fs.existsSync(path.join(OUT, f)));
    if (!cand) continue;
    let refs = 0;
    for (const t of tags) for (const f of t.Fs || []) {
      const img = f && f.image;
      if (img && (img['xlink:href'] === b.file || img.href === b.file)) { img['xlink:href'] = cand; delete img.href; refs++; }
    }
    b.hd = cand; b.hdRefs = refs;
    hdApplied.push(cand + '（替换 ' + b.file + '，' + refs + ' 处引用）');
  }
  const canonical = (value, key) => {
    if (Array.isArray(value)) { if (key === 'Fs' || key === 'rs' || key === 'Sf') return value.map((v) => canonical(v)); return value; }
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = canonical(value[k], k);
      return out;
    }
    return value;
  };
  const shared = new Map();
  for (const f of fs.readdirSync(OUT).filter((n) => /^tags.*\.json$/.test(n) && n !== 'tags-guide.json')) {
    for (const t of JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))) if (!shared.has(String(t.id))) shared.set(String(t.id), f);
  }
  for (const t of tags) {
    const where = shared.get(String(t.id));
    if (!where) continue;
    const other = JSON.parse(fs.readFileSync(path.join(OUT, where), 'utf8')).find((x) => String(x.id) === String(t.id));
    if (JSON.stringify(canonical(other)) !== JSON.stringify(canonical(t))) die('新手引导与现有包同ID内容冲突：' + where + ' / ' + t.id);
  }
  const outFile = path.join(OUT, 'tags-guide.json');
  fs.writeFileSync(outFile, JSON.stringify(tags));
  fs.writeFileSync(path.join(OUT, 'guide-manifest.json'), JSON.stringify({
    generator: 'tools/gen-ssfight-ui.cjs --guide',
    source: path.relative(ROOT, SRC).split(path.sep).join('/'), sourceBytes: bytes, sourceSha256: sha,
    roots: { guide: '3625' }, count: tags.length, bitmaps: stats.bitmaps, hd: hdApplied, missingIds: missing,
    how: '原版 `viewMission()`（MainMovie.as:6814）`attachMovie("新手引导","guide")`，'
      + ' 然后 `guide.gotoAndStop(guideMap[step].mcIndex)`；25 帧对应 mcIndex 1~25。'
      + ' 第 19 帧的 `tipsContent` 有 2 帧（给蛋 / 不给蛋）。'
      + ' ⚠ 导出符号表的「新手引导」=3628 是错表：3628 只有 1 帧文本「非官方」；'
      + ' 结构反查到真正的 25 帧引导是 3625。',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex'),
  }, null, 1));
  console.log('tags-guide.json: %d tags（%s）· 位图 %d 张%s；既有包与索引未改动',
    tags.length, (fs.statSync(outFile).size / 1048576).toFixed(2) + ' MB', stats.bitmaps.length,
    hdApplied.length ? '（HD 覆盖 ' + hdApplied.length + '）' : '');
}

/* Source-faithful confirmation and personal dummy-record dialogs. Keep this
 * incremental: no page, equipment or global index is regenerated. */
function socialDialogBundle() {
  const names = swfSymbolIds();
  const roots = { confirm: names.get('二次确认'), woodRecord: names.get('战斗统计') };
  if (Object.values(roots).some(id => !id)) die('原版确认 / 战斗统计元件不存在');
  const { data } = readMovie();
  const byId = new Map(data.tg.map(tag => [String(tag.id), tag]));
  const { tags: rawTags, missing } = closure(byId, Object.values(roots));
  if (missing.length) die('确认 / 战斗统计素材闭包缺失：' + missing.join(', '));
  const tags = rawTags.map(prune).sort((a, b) => Number(a.id) - Number(b.id));
  const stats = { bitmaps: [] };
  extractBitmaps(tags, stats);
  fs.writeFileSync(path.join(OUT, 'tags-social-dialog.json'), JSON.stringify(tags));
  fs.writeFileSync(path.join(OUT, 'social-dialog-manifest.json'), JSON.stringify({
    generator: 'tools/gen-ssfight-ui.cjs --social-dialog', roots, count: tags.length,
    source: 'MainMovie.as: alertRevenge / showJoinCheckWin / showDeadManWin',
    bitmaps: stats.bitmaps, missingIds: missing,
  }, null, 1));
  console.log('tags-social-dialog.json: %d tags; existing page bundles untouched', tags.length);
}

if (process.argv.includes('--social-dialog')) socialDialogBundle();
else if (process.argv.includes('--gear-colors')) gearColorBundle();
else if (process.argv.includes('--fight-result')) fightResultBundle();
else if (process.argv.includes('--fight')) fightBundle();
else if (process.argv.includes('--fusion')) fusionBundle();
else if (process.argv.includes('--compose')) composeBundle();
else if (process.argv.includes('--guide')) guideBundle();
else main();
