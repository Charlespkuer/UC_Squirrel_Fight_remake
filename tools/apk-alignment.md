# 依照 APK 对齐的改动表

依据：`references/h5ssdz_9game_4230.apk`（SHA-256 `BBFD6061…8DA73`）。
取证方法、原始坐标导出与架构结论见 [apk-audit/README.md](apk-audit/README.md) 与
[apk-audit/ARCHITECTURE.md](apk-audit/ARCHITECTURE.md)。

## 一、本轮实际改了什么

### A. 界面坐标（按原版字面坐标校正）

| # | 元素 | 原版来源 | 原版值 | 改前 | 改后 | 校验 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | 战斗「跳过」按钮 | `tiaoguo` = `resource_4:7`（983,609）帧 164×60 | (983,609,164,60) | (964,605,190,70)，且无障碍层另写一套百分比 | `js/battle.js` 的 `skipRect` 取原版值，点击层由 `skipRect` 现算，两处不再可能错位 | 战斗截图：按钮落在右下角原位置；`test-battle.js` 通过 |
| A2 | 列表翻页箭头 | `button_left` (7,371) / `button_right` (1094,371)（右侧同一素材 `scaleX=-1` 镜像），帧 67×67 | 左 x=7，右 x=1094，y=371，67×67 | `top:37%`、左 8px、右 9px，62×62；背包页还有 `left:648px` 的单页补丁 | `.page-arrow` 取原版坐标与尺寸，删掉单页补丁 | 背包/商店截图：箭头在左右边缘、垂直 371 |
| A3 | 检查页样式表 | `index.html` 实际加载 7 张样式表 | — | 10 个 `tools/research/*.html` 少加载 `battle-drops.css`、`classic-refine.css`，截图与线上不一致（按钮文字重影） | 全部补齐 | 截图复查 |

### B. 新增功能（单机化）

| # | 功能 | 原版依据 | 单机做法 | 校验 |
| --- | --- | --- | --- | --- |
| B1 | **超级松鼠（原版 VIP）** | `ssdz-pkg2.js` VIP 界面内嵌文案：8 条特权 + 10 级成长表（被动经验上限 / 体力恢复倍率）；原版 `buyVIP.do` 按天售卖 | 改为**金松果**购买（7 天 300 / 30 天 1000，本项目经济平衡值）。实装特权：体力上限 180、体力恢复 1.1~1.5 倍、装备格子 +6、昵称尊贵标识、每日首次登陆 +1 超级松鼠经验并自动升级、到期后等级与经验保留 | `test-extras.cjs`（购买/上限/倍率/格子/到期回收/续期累加）+ 系统页截图 |
| B2 | **排行榜** | 原版 `STATE.TOPLIST`、`loadRankList` / `LoadRank` 由服务端下发真实玩家榜 | 每周固定种子生成 14 名离线松鼠，三个排序（等级/金杯/积分），玩家插入其中并高亮，页面明示「离线模拟」 | `test-extras.cjs` + 消息页截图 |
| B3 | 分页入口 | 原版系统页与消息页的分页结构 | 系统页新增「超级松鼠」，消息页新增「排行榜」；**原有分页全部保留** | 截图：系统 4 页、消息 5 页 |

### C. 行为/文案

| # | 项目 | 说明 |
| --- | --- | --- |
| C1 | 经验丸说明 | 去掉「竞技场中无效」（本版经验竞技场确实吃加成），保留仍成立的「关卡中无效」「天梯赛无效」。改动在 `js/gamedata.js`，`GameDict.js` 保持与 APK 逐字节一致 |
| C2 | 道具来源注释 | `battle-drops.js` 的出处由 `FightStats.js` 更正为 `ssdz-pkg2.js`（`Quark.FightProps` + 场景 `fightingTimes`），并补上原始道具白名单 `{1,2,8,15,21,22,45,50}` |

## 二、按原版判断后**未**套用的项（含理由）

用户要求「判断界面坐标是否合理，套用后需要检查」。以下项原版坐标明确，但**没有**套用：

| 项 | 原版值 | 本项目现状 | 不套用的理由 |
| --- | --- | --- | --- |
| 主底板 `resource_3:5` | (144,133) 886×462，居中（左 144 / 右 140） | (24,97) 1122×501，接近满宽 | 这是**整套界面的构图**：底板收窄 21% 会连带重排全部 37 个界面的网格、卡片与内嵌面板。参考截图测量的米色面板覆盖宽度为屏宽的 86%~98%（受弹窗/页脚干扰），并不能证明原版窄底板就是玩家看到的样子。整屏重排放在 push 前风险过高，且属于「改版式」而非「修错」。已把精确数值记录在此，需要时可以单独立项 |
| 标签条 `resource_3:7` | 201×83，x=49+190·i（相邻重叠 11px），y=38 | flex 均分，宽 205.5（4 页）或 233（背包页），y≈5~93 | 本项目的分页按钮用的是从截图提取的参考按钮图（`classic-button-art`，233/397 宽）。强行改成 201 宽会与现有素材比例冲突（拉伸或留白），属于换素材工程 |
| 顶栏 `resource_3:0` | (6,5) 1157×120 → y 5..125 | `.classic-tabs` y 5..104 | 同上：顶栏高度与标签素材高度绑定，单独抬高会露出空隙 |
| 页脚按钮 `resource_3:8` | 284×77，(234,487) 与 (659,487)，**在底板内部** | `.page-footer` 在底板下方，宽 397 | 原版把主操作按钮放在底板内，本项目放在底板下。改动会同时影响 15 个页面的按钮尺寸与题库文案排版 |
| 右上返回 `resource_1:42` | (1054,23) 90×90 | 页脚居中「返回菜单」 | 交互位置差异，不是错误；且本项目在页脚给的是主操作按钮 + 返回，改到右上会让页脚空一半 |
| 战斗场景视差 `FightSet_1..5` | 例：森林 `x:[3,8,16]`、`scaleX 1.4355`、前景 `y 399` | `js/battle.js` 的 `REGIONS` 自研参数 | 需要逐场重新调图层与前景偏移，属于战斗演出手工调参，应单独验证而不是顺带改 |

## 三、原版有、本项目**有意不做**的系统

原版是联网游戏，`js/vmGameBase.js` 写着 `game.urlAdress = "http://ssdz.u.uc.cn/FightGame"`，
`JsonLoader` 共 76 个服务端接口。以下是明确不做（或已用单机替代）的部分：

| 原版系统 | 接口 | 本项目处理 |
| --- | --- | --- |
| 账号/登录/注册 | `login` `reg` `localLogin*` `logout` | 不做：本地单档 `ssdz_save_v1`，无需账号 |
| 充值 | `buyVIP` `buyUpoint` `getOrder91game` `checkOrder91game` | 不做：不含任何付费；VIP 改为金松果购买（B1） |
| 激活码 | `useActivationCode` | 不做：无发行方，无意义 |
| 真实好友/推荐/申请 | `loadFriends` `randomfriends` `recommendFriends` `findPlayer` `addFriend` `loadFriendRequest` `acceptRequest` `ignoreRequest` | 已用单机替代：好友页 + 师徒页的离线候选人 |
| 真实排行榜 | `loadRankList` `LoadRank` | 已用单机替代：B2 |
| 留言板/私信 | `sendMsg` `loadMessages` `loadMsgBox` `loadRankMessages` | 已用单机替代：消息页与留言板（本地生成内容） |
| 活动/抽奖 | `activityLottery` `loadLottery` `lottoryMessage` | 已用单机替代：每日礼包 + 每日幸运抽奖 |
| 复仇 | `loadRevenge` | 已用单机替代：消息页「复仇」（打回放对手） |
| 天梯赛季 | `joinArena` `loadGainRankCup` `buyRankGoods` | 已用单机替代：天梯赛 + 金杯商店 |
| UC/VIP 平台态 | `uc_vip` `openUcVip` | 不做：无 UC 平台 |

## 四、本轮回归

```
状态 24/24 · 扩展 34/34 · 融合 9/9 · 关卡 15/15 · 数值 17/17
拾取 9/9 · 战斗规则 25/25 · Main 集成 11/11 · 战斗动画回归通过 · 浏览器自检 21/21
```

新增用例：`tools/test-extras.cjs` 的「超级松鼠（原版VIP）」「排行榜」两组，
`tools/test-state.cjs` 的经验丸说明。

## 五、新增的分析工具

| 工具 | 用途 |
| --- | --- |
| `tools/apk-audit/apk-zip.cjs` | 零依赖直读 APK 内层 `assets/game.zip`，不用解压 35 MB |
| `tools/apk-audit/view-layout.cjs` | 导出原版 37 个界面的字面坐标/素材/接口调用（`--all` 生成 `original-views.json`） |
| `tools/apk-audit/shared-chrome.cjs` | 找出跨界面复用的「公共外框」，一次校正就能全局生效 |
| `tools/apk-audit/rects.cjs` | 把原版「左上角 + 图集帧尺寸」换算成真实矩形 |
| `tools/apk-audit/search.cjs` | 在压缩源码里检索并解码 `\uXXXX` 文案 |
| `tools/apk-audit/frame-size.cjs` | 查原版图集帧的真实尺寸（把「左上角」换算成矩形要用） |
| `tools/apk-audit/measure-board.ps1` | 量参考截图里面板的实际覆盖范围 |
| `tools/apk-audit/compare.cjs` | APK 资源与本项目逐字节核对 |
| `tools/apk-audit/measure-board.ps1` | 量参考截图里面板的实际覆盖范围 |
