# 原 APK 里到底有什么（内容块清单 + 战斗逻辑与数值的归属）

> 结论速览：**原 APK 里没有战斗结算逻辑**——它是「薄客户端 + 服务器结算」的结构，
> 战斗过程由服务器下发的 `combatLog` 字符串回放；但**关卡 NPC 三围/血量、武技升级成功率、
> 道具价格、装备与套装、礼包清单这些「数值素材」确实在客户端**（`js/GameDict.js`）。
> 取证方式：`references/tools/apk-audit/apk-zip.cjs`（零依赖直读 APK 内层 zip）。

## 一、`references/tools/` 里的东西是哪来的

| 来源 | 内容 |
| --- | --- |
| **本项目自己写的**（绝大多数） | `test-*.cjs`（12 个回归脚本）、`stage-balance*.cjs`、`player-curve.cjs`、`check-asset-paths.cjs`、`serve.js`、`apk-audit/*`（APK 取证工具）、`research/*.html`（浏览器检查页）、`verification/*.png`（实测截图）、各篇 `.md` 文档 |
| **从 APK 解出来的**（归档） | `research/original/js/*`：`index.js`、`ssdz-pkg2.js`、`JsonLoader.js`、`vmGameBase.js`、`player.js`、`FightStats.js` 等 13 个原版脚本，供比对查阅；运行时**不加载**它们 |
| **项目运行真正用到的原版文件** | 仓库根的 `js/orig/`：`Map.min.js`、`GameDict.js`、`animationStr.js`、`assets.js`、`asset2.js`（`index.html` 直接 `<script>` 引入） |

也就是说：`tools/` 不是「解开的 APK」，而是**开发工具 + 从 APK 里提取的少量原始脚本**；
`js/orig/` 才是从 APK 提取、并且真的参与运行的那 5 个文件。

## 二、APK 结构

| 层 | 内容 |
| --- | --- |
| 外层 `h5ssdz_9game_4230.apk`（35,572,039 B） | 明文 ZIP，191 项。关键项：`assets/game.zip`（33,105,511 B，**stored 未压缩**）、`lib/armeabi/libh5runtime.so`（3.1 MB，UC H5 运行时）、`classes.dex`（1.4 MB，安卓外壳）、`assets/ucgamesdk/**`（UC 登录/支付 SDK） |
| 内层 `assets/game.zip` | 456 个文件：**images 436**（424 PNG + 6 JPG）、**js 17**、audio 2（mp3）、根目录 1（`index.js`）、外加 6 个 `Thumbs.db` |

内层的 `js/` 就是整套客户端逻辑：

```
js/ArrayUtil.js  BitmapCache.js  FightStats.js  GameDict.js  JsonLoader.js  Map.min.js
js/Matrix2D.js   ajax.min.js     animationStr.js  asset2.js    assets.js     drawable.js
js/player.js     ssdz-pkg2.js    uc.base-1.0.1.js version.js   vmGameBase.js
```

- `ssdz-pkg2.js`（515 KB）= 显示/状态机核心（`Quark.*`），战斗场景与「请点击」奖励都在这里；
- `GameDict.js`（91 KB）= **数据表**（见第四节）；
- `animationStr.js`（1.86 MB）= 动画帧数据；`assets.js`/`asset2.js` = 图集帧表；
- `JsonLoader.js` = 所有服务器接口调用；
- 没有 `index.html`：入口是 `index.js`，靠 UC 原生桥（`require` / `native.startActivity`）启动，
  **普通浏览器跑不起来**——这就是本项目要自己写 `index.html` 重新托管的原因。

小发现：`images/equip/**` 里混进了 6 个 **`Thumbs.db`**（Windows 缩略图缓存，OLE 复合文档头 `d0cf11e0`），
是当年打包时把开发机的垃圾一起塞进去了，共 1 MB。

## 三、战斗逻辑在哪：不在客户端

`ssdz-pkg2.js` 里 `combatLog` 出现 5 次、`getCombatLog` **67 次**，全部是**解析/回放**，例如
`getFirstCombat()` 把 `|0`/`|1`（先手方标记）互换以便从玩家视角播放；客户端**没有**任何
伤害/命中/闪避公式（`damage`、`dodge` 这些词在 17 个脚本里一次都没出现）。

`JsonLoader.js` 共 **68 个 `.do` 接口**，与战斗、成长直接相关的有：

```
fight.do  challenge.do  recruit.do  viewCombat.do  levelUp.do  check.do  player.do
useProp.do  upgradeWeapon.do  upgradeSkill.do  buyProp.do  gainProp.do
joinArena.do  checkArena.do  mergeGear.do  composeGear.do  sellGear.do  lottery.do
```

流程是：客户端 `challenge.do` / `fight.do` 把对手 id 发给服务器 → 服务器算完整场战斗，
返回 `combatLog` + 战果（`getFightReward()`、`levelUp`、`nextExp`、掉落）→ 客户端只负责播动画和弹结算。
`levelUp.do` 单独存在也说明**升级结算同样是服务器做**。

> 因此本项目里的战斗公式（`js/sim.js`）不是「还原」，而是**离线重写**：原版公式没有随 APK 发行，
> 服务端 `http://ssdz.u.uc.cn/FightGame` 已不可考。这一点在 README 里也写明了。

## 四、客户端里有的「数值设计」（挑战数值确实在）

`js/GameDict.js` 的表（条数由 `Map#each` 统计）：

| 表 | 条数 | 内容 | 例子 |
| --- | --- | --- | --- |
| `weaponsMap` | 17 | 武器：伤害区间、`harmAdd` 每级加成、类型、说明 | `1,方天画戟,15-25,攻击前需要休息一回合,每级增加12点伤害,近战,12` |
| `skillsMap` | 20 | 技能：类型（主动/被动）、`propertyAdd` | `1,力王附体,提高力量点数,每级提高2点,被动,2` |
| `propMap` | 51 | 道具：效果、价格、是否商店出售、useType | `1,小体力药剂,恢复体力10点。,3,true,1` |
| `upgradeMap` | 14 | **武技升级：成功率 / 金松果 / 卷轴 / 等级门槛** | `1,100,50,0,5` → `4,70,50,0,17` … |
| `npcsMap` | 54 | **关卡 NPC：hp / power / agility / speed / weapons / skills / stageId / npcIndex** | `100,1星螳螂学徒,133,false,14,11,12,…` |
| `stagesMap` | 6 | 关卡说明（前 3 条是螳螂/仙鹤/熊猫，**含原版推荐等级原文**） | `1,螳螂身手敏捷…建议10-15级玩家挑战` |
| `gearSetMap` / `gearMap` | 32 / 128 | 装备套装与单件：品质、等级、重量、价格、属性位 | — |
| `attachmentMap` | 41 | 装备附加属性词条与档位 | `1,3,6,10,空手暴击伤害+N%` |
| `giftMap` / `giftsMap` | 6 / 5 | 1/5/10/15/20 级礼包清单 | `28,1,29:1\|8:50\|2:3\|1:5` |
| `rankgoodsMap` | 14 | 金杯商店：金杯/金松果/积分/限购 | — |

**一个重要发现**：`npcsMap` 的血量比项目采用的「攻略表」小得多，大约是后者的 **一半到三分之一**：

| 关卡 | npcsMap 的血量（客户端） | 攻略表 `STAGE_NPC_HP` |
| --- | --- | --- |
| 1★螳螂 学徒/拳师/大侠 | 133 / 160 / 240 | 243 / 292 / 438 |
| 6★螳螂 学徒/拳师/大侠 | 179 / 215 / 322 | 501 / 601 / 901 |
| 6★仙鹤 大侠 | 421 | 901 |

两者不可能同时是实战数值。因为**实战由服务器裁决**，最合理的解释是：`npcsMap` 只是客户端
用来**显示「对手预览」**的那份表（而且大概率是旧版本遗留），而攻略表记录的是服务器实际用的血量。
本项目因此把两份都留着：`npcsMap`（= `GameDict.js`）作为**形状与历史数据**，
`STAGE_NPC_HP` 作为**历史参考**，实际关卡强度则按 `STAGE_USE_LEVEL_MODEL` 的「推荐等级模型」标定
（见 `references/tools/apk-alignment.md` D41）。

## 五、其它可继续挖的点

- `animationStr.js` 的帧数据可用于继续校准战斗演出（`FightStats.js` 已有 5 套场景的视差参数，`js/battle.js` 的 `REGIONS` 就来自它）；
- `npcsMap` 的 54 行里有 18 组三围，可用来核对「同一关三人的相对形状」（本项目已用于 NPC 敏捷/速度比例）；
- `stagesMap` 第 4-6 行是占位（`猴哥`/`小青`/`虎妹`），说明当年还规划过三种关卡类型；
- `upgradeMap` 的成功率曲线（100/100/100/70/60/40/25/15/10/100/8/5/4/3）与项目 `doUpgrade` 完全一致。

复现命令：

```bash
node references/tools/apk-audit/apk-zip.cjs list                 # 列出内层 456 个文件
node references/tools/apk-audit/apk-zip.cjs read js/GameDict.js  # 直接看某个文件
node references/tools/apk-audit/compare.cjs                     # 与项目资源逐字节核对
node references/tools/apk-audit/view-layout.cjs --list          # 37 个界面的原始坐标
```
