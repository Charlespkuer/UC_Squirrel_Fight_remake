# 原版《松鼠大战》架构解剖（依据 `references/h5ssdz_9game_4230.apk`）

只读分析，未修改 APK。取数工具：`tools/apk-audit/apk-zip.cjs`（免解压直接读 APK）、
`tools/apk-audit/view-layout.cjs`（导出某个界面的原始坐标）。

- APK：35,572,039 B，SHA-256 `BBFD6061078D1785262DCC518FF2A15FEEEC60E1E753456293BF595AAB08DA73`
- 内层 `assets/game.zip`：33,105,511 B（stored），467 项 = 456 文件 + 11 目录
- `index.js` 里 `require()` 恰好 17 个文件，`js/` 目录里也恰好是这 17 个 —— **客户端代码是完整的，没有缺文件**

## 一、先回答：这包含所有游玩逻辑吗？

**不包含。它是一个"薄客户端"：能画、能播、能记，但不能算。**

原版是联网游戏，`js/vmGameBase.js` 第一行常量就写着服务端地址：

```js
game.urlAdress = "http://ssdz.u.uc.cn/FightGame";
//http://115.238.230.18:18043/FightGame 测试
```

### 客户端里**有**的（可放心当一手依据）

| 类别 | 证据 |
| --- | --- |
| 静态数据表 13 张 | `GameDict.js`：`weaponsMap`(id,name,harm,remark,type,harmAdd,harmAdd1,remark1)、`skillsMap`、`propMap`、`gearMap`、`gearSetMap`、`npcsMap`(id,name,hp,isBoss,power,agility,speed,weapons,skills,stageId,npcIndex)、`stagesMap`、`upgradeMap`、`rankgoodsMap`、`giftMap`、`giftsMap`、`attachmentMap`、`buy91Info` |
| 全部美术/音频/动画 | `images/`、`audio/`、`assets.js`(asstes, equipImgMap)、`asset2.js`(asset_tl)、`animationStr.js`(1.9 MB 帧数据)、`FightStats.js`(`FightSet_1..5` 场景视差) |
| 引擎常量 | `fps = 15`；`new Q.Stage({width:1170, height:690})`；`Q.scale = Math.min(canvas.width/1170, canvas.height/690)` |
| **关卡经验数组** | `Mission` 视图内：`for(var y=[],t=0;t<18;t++) y.push(""+(19+t*3));`，显示为 `y[关卡-1]*expFactor`，并写明「金松果25个」 |
| **竞技场经验常量** | 冠军 `expFactor*150`、亚军/季军同理；金杯 1/… 也在客户端拼字符串 |
| 经验倍率 | `game.player.expFactor = game.player.isTrueTest==true ? 2 : 1`（测试号双倍） |
| 武器伤害换算 | `player.js` 用 `harm`(基础区间) + `harmAdd`(≤10级每级) + `harmAdd1`(>10级逐级表) 算出 `b.harm` —— 与 `js/sim.js` 的算法**逐条一致** |
| 「请点击」时序 | `ssdz-pkg2.js`：`fightingTimes == 30/180/340 + counter`，`counter = Math.round(Math.random()*130)`，15fps；道具白名单 `Quark.FightProps` = {1,2,8,15,21,22,45,50} |
| 跳过规则 | 超级松鼠(VIP) 且 ≥10 级才能跳过；跳过照常结算奖励 |
| 全部界面布局 | 37 个界面类，约 1341 处字面坐标（见第四节） |

### 客户端里**没有**的（当年在服务端，只能离线推断）

**最关键的一条：战斗结算完全不在客户端。** 客户端只读服务端给的战斗日志来播放：

```js
game.fightInfo.getCombatLog()[this.index].attackHurt      // 直接拿数字
game.fightInfo.getDefender().headHp - ...attackHurt        // 只做减法画血条
```

它消费的字段有 `attackHurt`、`weaponHurt`、`reboundHurt`、`backHurt`、`continueHurt`、
`attackAddBlood`、`isDouble`、`attackType`、`attackMethedId`、`defendType`、`defendMethedId`、
`multiple` —— **全是服务端算好的结果**。全部 17 个源文件里都不存在任何由力量/敏捷/速度推导伤害、
命中或出手顺序的公式。

同样在服务端、客户端只有接收口的还有：

| 服务端下发字段 / 接口 | 含义 |
| --- | --- |
| `combatLog` / `combat` | 整场战斗过程（管道分隔的紧凑串，客户端还要做 `.split("\|2").join("\|1")` 变形） |
| `fightReward` / `flashProp` | 掉落奖励与「请点击」奖品 |
| `levelReward` | 升级奖励 |
| `winner` | 胜负 |
| `player` / `loginData` | 玩家全部养成数据 |
| `getPlayerLotteryStatus` / `lottery` | 抽奖 |
| `buyVIP` / `buyUpoint` / `91game 订单` | 充值 |

另外 `npcsMap` 里**没有**经验/金币奖励字段（只有 hp/属性/武技），所以关卡奖励数字只能来自
客户端那句 `19+t*3` 与写死的「金松果25个」；这一点与本项目 `tools/balance-audit.md`
记录的「原Mission的 19+3×(stageId−1)」互相印证。

## 二、分层架构

```
index.js                       入口：UC 原生桥（require / native.call / downloadRes）→ 版本检查 → 逐文件 require
└─ version.js                  versionAndroid = "1.0.0.0"
   ├─ ajax.min.js              XHR 封装（$.ajax 风格），带 jsessionId Cookie
   ├─ uc.base-1.0.1.js         UC 基础框架
   ├─ Matrix2D.js / ArrayUtil.js / Map.min.js / BitmapCache.js
   ├─ JsonLoader.js            ★ 服务端 API 层（76 个方法）
   ├─ vmGameBase.js            ★ 引擎基座：15fps 主循环、1170×690 Stage、全局 game 单例、STATE 状态机
   ├─ ssdz-pkg2.js             ★ 业务层（515 KB 压缩）：37 个界面类 + Fight 演出 + FightProps
   ├─ drawable.js / player.js  ★ 绘制对象 / 玩家模型（52 个方法）
   ├─ animationStr.js / assets.js / asset2.js / FightStats.js   美术与动画数据
   └─ GameDict.js              13 张静态数据表
```

### 状态机（43 个 `STATE.*`）

`LOADING, LOGO, LOGIN, REG, LOGINAWARD, GAMESTART, START, MAIN, MAINLEVELUP, MISSION, RANDOM,
RANK, RANKPREPARE, ARENA, FIGHT, BATTLERESULT, SHOP, CUPSHOP, EXCHANGE, EXCHANGEALERTU,
EXCHANGEUC, PROP, WEAPON, SKILL, EQUIPMENT, MERGE, FRIEND, FRIENDREQUESTNEWS, SEEFRIENDINFO,
MESSAGE, MESSAGEBOARD, QUALIFYNEWS, TOPLIST, ACTIVITY, HELP, INFO, OPTIONS, VIP, PASS, ZDTJ`

### 界面类（37 个，括号内为主要元素数）

```
Logo, Login(10), Reg(26), GameStart(2), Info(1), Help(32), VIP(30)
Mission(42)     关卡选择
RandomFight(43) 随机挑战          NpcFight / RankFight / FightWood  战斗变体
Arena(27), ArenaExp(8), ArenaExps(18), ArenaPws(17), ArenaPwsPrepare   竞技/天梯
Fight(27)       战斗演出          BattleResult(99)                  战斗结果
MyProps(127)    道具              Shop(45)                          商店
GoldCupShop(29) 金杯商店          Exchange(43), ExchangeAlertU(21), ExchangeUC(14)  兑换
MyWeapon(152)   武器              Skill(55)                         技能
MyEquipment(50) 装备              Merge(60), MergeChoose(21)        融合
Friends(102), FriendRequestNews(10), SomebodyInfo(106), SomebodyEquip(23)   好友/看别人
MessageBoard(18)
```

### 服务端 API（`JsonLoader` 76 个方法 = 当年的功能清单）

```
登录/账号  login reg localLogin localLogin91game localLogin9game firstLogin loginQueue logout
           step loadPlayer loadPlayerState setNickName useActivationCode setReferrerPlayer
养成       levelUp upgradeWeapon upgradeSkill useProp gainProp gainFlashProp buyProp
装备       composeGear mergeGear sellGear usePlayerGear
关卡/战斗  loadStage loadFight loadFighting loadFirstFight loadViewCombat loadViewCombats quitStage
竞技/天梯  joinArena checkArena loadRankList LoadRank loadGainRankCup buyRankGoods
师徒       loadRecruit loadResign loadRevenge
抽奖       loadLottery loadLotteryStatus lottoryMessage activityLottery
社交       loadFriends randomfriends recommendFriends findPlayer loadFriendById addFriend
           deleteFriend loadFriendRequest acceptRequest ignoreRequest
消息       loadMessages sendMsg loadReadMsg loadMsgBox loadRankMessages loadViewMsg loadRecord
充值/其他  buyVIP buyUpoint getOrder91game checkOrder91game buy91Info loadConfirm loadEject
           loadExercise findNotice StateFeedback
```

这份清单很有用：**它精确列出了原版存在过、而本项目还没做的系统** —— VIP、活动(ACTIVITY)、
排行榜(TOPLIST)、好友申请、留言板、激活码、91 充值订单、推荐好友、复仇(loadRevenge)。

## 三、能直接拿来做还原的硬数据

### 1. 关卡经验（一手）

```js
for (var y = [], t = 0; t < 18; t++) y.push("" + (19 + t * 3));
// 显示：【奖励】：总经验 y[关卡-1] * expFactor 、金松果25个
```

`expFactor = isTrueTest ? 2 : 1`。即普通账号下第 n 关整轮总经验 = `19 + 3*(n-1)`，
与本项目 `GData.stageNpcExp` 的拆分口径一致。

### 2. 竞技场奖励（一手）

冠军 `150 * expFactor` 经验、金杯 1 个；亚军/季军同源。本项目用的 150/75/25 正确。

### 3. 武器伤害（一手，已验证）

`player.js`：

```js
c = a.harm.split("-");
a.level <= 10 ? (d = parseInt(a.harmAdd))
              : (d = a.harmAdd1.split("|"));
for (f = Number(a.level) - 10, h = 0; h < f; h++) e += Number(d[h]);
b.harm = (parseInt(c[0]) + e) + "-" + (parseInt(c[1]) + e);
```

与 `js/sim.js` 的 `lo/hi` 计算逐行等价（≤10 级用 `harmAdd*(level-1)`，>10 级再加 `harmAdd1` 前若干项）。

### 4. 界面坐标（一手，最有价值）

每个界面都是字面坐标搭出来的，共约 1341 处带 x/y 的元素。例：

```
$ node tools/apk-audit/view-layout.cjs Shop
createButton  button_back   1054   23   resource_1:42
createButton  title1          49   38   resource_3:7
createBitmap  title2         239   37   resource_3:7a     ← 后缀 a = 选中态
createBitmap  nut_frame      797   43   resource_12:18
```

这可以直接用来校正本项目的界面坐标，而不再依赖截图目测。注意原版用 `label` 后缀 `a`
表示选中/激活版本（如 `resource_2:7a`），与本项目 `-active/-normal` 的做法同源。

## 四、工具用法

```powershell
# 免解压读 APK（自写的最小 ZIP 解析，只用 Node 内置模块）
node tools/apk-audit/apk-zip.cjs list
node tools/apk-audit/apk-zip.cjs read js/player.js

# 列出 37 个原始界面 + 元素数
node tools/apk-audit/view-layout.cjs --list

# 导出单个界面的坐标表 / JSON / 用到的素材 / 调用的服务端接口
node tools/apk-audit/view-layout.cjs Mission
node tools/apk-audit/view-layout.cjs MyWeapon --json

# 在压缩代码里定位一段逻辑
node tools/apk-audit/extract-window.cjs "fightingTimes==30" 700 700

# 与项目资源逐字节核对
node tools/apk-audit/compare.cjs
```

## 五、建议的下一步（按性价比排序）

1. **用 `view-layout.cjs` 批量导出 37 个界面坐标**，与项目现有界面逐屏对比，修掉目测误差。
   这是目前最容易拿到、最不可能出错的一手数据。
2. **用 `JsonLoader` 的 76 个方法当功能清单**，确认哪些系统本项目有意不做（VIP/充值/社交/活动），
   哪些是漏做的（排行榜、留言板、激活码、复仇）。
3. **战斗结算公式仍需离线设计**，但要接受它无法从客户端"找回"：客户端只播不下算。
   本项目 `tools/research-battle-rules.md` 的记录方式（明确标注哪些是离线取值）是正确做法。
4. 已经做完、可以标为"已由原始客户端证实"的项目：关卡经验数组、竞技场 150/75/25、
   武器伤害换算、请点击时序与抖动、15fps、1170×690、跳过发奖语义。
