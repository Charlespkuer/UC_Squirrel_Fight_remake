# 松鼠大战 · 怀旧单机复刻版

把当年《松鼠大战》的玩法（三侠、关卡、背包装备、竞技场、天梯、挑战塔）做成**纯静态网页**的单机复刻：
没有构建步骤，双击启动器或用任意静态服务器打开 `scripts/index.html` 就能玩。存档写本地文件，
也支持 Mac ↔ Windows 双机同步。经典界面与高清动画来自不同版本，仍有未恢复的素材，不宣称逐像素复原。

## 启动

| 平台 | 方式 |
|---|---|
| macOS | 双击 `启动游戏.command`（停：`bash 启动游戏.command --stop`） |
| Windows | 双击 `启动游戏.cmd` |
| 手动 | `node scripts/serve.js` → 浏览器打开 `http://127.0.0.1:8080/` |

> **存档到底在哪**：有本地服务器时，正式存档就是 `save/progress.json`（浏览器 localStorage 只当兜底）。
> 启动器的独立窗口用的是**单独的浏览器 profile**（`~/Library/Application Support/SSDZClassic/browser-profile`），
> 那里可能残留一份旧的「兜底存档」，表现为「明明文件里是 32 级，窗口里却是 1 级」。
> 遇到就执行一次：`bash 启动游戏.command --reset-profile`（清掉那份兜底档）再重新启动。

纯静态、无构建步骤。唯一需要注意的是：「存档写入文件」与「双机同步」需要本地服务
（`scripts/serve.js` 提供 `/__save`，`scripts/sync/sync.js` 提供跨设备同步）；直接静态托管也能玩，
但存档只留在浏览器里。

## 核心功能

- **战斗**：经典 1170×690 画布战斗；普攻/技能/道具，暴击、闪避、吸血、反伤、护盾、中毒、复活甲、
  绝对防御等机制。实战与离线模拟共用同一套规则（`js/sim.js`）。
- **关卡**：18 关推进，每关三名对手 + 关底；通关解锁下一关，等级不足会提示。
- **成长**：升级给属性点与礼包、武器/技能三选一、经验丸与属性丸等道具。
- **背包与装备**：部位/品质（普通→稀有→史诗→传奇）、强化、镶嵌碎片、天赋与武技。
- **装备融合**：同部位同品质三件合成更高品质一件（列表按「同部位+同品质」成组排序，方便凑三件）。
- **竞技场与天梯**：经验场、碎片场（4 人两轮）、天梯赛（积分/金杯/周榜）；体力不足会自动喝药或用票据。
- **师徒与好友**：拜师收徒领贡品、好友切磋与随机挑战。
- **挑战塔**：每层一张挑战书、连战只继承血量、对手每层随机、层间三选一增益。
- **无尽挑战塔**：免门票从 1 层冲分；限次/永久/即时三类增益，永久槽位（扩容类可 +1/+2）、
  段位机制（反伤/回复/吸血/护甲/吞噬轮转）、每 5 层商店与结算离场（抽奖卷）、每 10 层里程碑奖励、
  属性药丸槽（力/敏/速）、隐藏型「三选一强化」（强化某把武器或某个技能）。
- **双机同步**：Mac ↔ Windows 通过 ZeroTier 互推存档与游戏文件。
- **调试面板**：`Ctrl+Shift+D`（一键满级、给道具/装备、增减无尽塔增益等，不影响正式存档）。

## 目录与文件

### 运行时文件（游戏本体，全部相对路径）

| 路径 | 作用 |
|---|---|
| `scripts/index.html` | **游戏入口**（`serve.js` 优先用它；根目录的 `index.html` 是备选） |
| `js/gamedata.js` | 静态数据：关卡、NPC、装备、道具、随机名字池等 |
| `js/state.js` | 玩家状态机：属性、背包、装备、道具、存档读写（写 `save/progress.json`） |
| `js/sim.js` | 战斗规则内核（离线模拟与实战共用） |
| `js/engine.js` `js/battle.js` `js/battle-drops.js` | 素材加载、战斗演出、战斗掉落 |
| `js/ui.js` `js/classic-ui.js` `js/classic-extras.js` `js/classic-fusion.js` | 界面外壳、经典页、竞技场/天梯/融合 |
| `js/tower-data.js` `js/tower.js` `js/tower-ui.js` | 挑战塔 & 无尽塔的数值、状态机、界面 |
| `js/main.js` `js/debug.js` | 启动装配 / 调试面板 |
| `css/*.css` | 样式（`classic.css`、`classic-refine.css`、`tower.css`、`debug.css`… 按顺序加载） |
| `images/**` `audio/**` | 美术与音效素材 |
| `save/` | 存档与运行日志（见下） |
| `scripts/` | 本地服务器、启动器、双机同步服务 |
| `references/` | 参考素材与**不参与运行**的原版数据（`references/orig/` 等） |
| `tools/` | 开发用：回归测试、UI 探针、构建 APK/桌面版等 |
| `src-tauri/` | 可选的原生桌面壳（Tauri） |

### 最小完整运行集合

保留这些就能完整游玩，其余都是开发/参考文件（删掉不影响运行）：

```
scripts/index.html     # 入口
js/*.js                # 全部逻辑
css/*.css              # 全部样式
images/**  audio/**    # 素材
scripts/serve.js       # 本地服务器（存档写入与双机同步需要）
save/progress.json     # 存档（首次运行自动生成）
```

**不参与运行、可安全删除**：`references/`（含 `references/orig/`）、`tools/`、`src-tauri/`、`docs/`
以及下面列出的日志类文件。

## 存档目录 `save/`

| 文件 / 目录 | 是什么 | 能删吗 |
|---|---|---|
| `progress.json` | **唯一的正式存档**（帐号、背包、装备、关卡、塔进度） | ❌ 删了等于重开 |
| `backup/progress-YYYYMMDD-HHMMSS.json` | 同步/覆盖前自动留的快照 | ✅ 可删（建议留最近几个） |
| `.server.pid` | 本地游戏服务器进程号（启动器据此判断「是否已在跑」） | ✅ 可删（之后要重启游戏） |
| `.sync.pid` | 双机同步服务进程号 | ✅ 可删 |
| `server.out.log` / `server.err.log` | 游戏服务器日志 | ✅ 可删（自动重建） |
| `sync.out.log` / `sync.err.log` | 同步服务日志 | ✅ 可删 |
| `.DS_Store` | macOS 目录元数据 | ✅ 可删 |
| `from-windows-<日期>/` | 早期从 Windows 拉过来的一次性快照 | ✅ 确认无用可删 |
| `松鼠大战存档-<日期>.json` | 手动导出的旧存档 | ✅ 可删（想留纪念可移出仓库） |

> **结论**：真正必要的只有 `progress.json`；`backup/` 是保险；pid、日志、`.DS_Store`、
> `from-windows-*`、导出档都属于**可再生/多余**文件，删掉不影响游戏。

## 双机同步（Mac ↔ Windows，走 ZeroTier）

`scripts/sync/sync.js` 有两种角色：`serve`（监听 `0.0.0.0:8788`，谁开谁才能被推）与 `push/pull`。
配置在同目录 `sync.config.json`：`name`（本机名）、`port`、`token`（两边必须一致）、`peers`（对端名 → IP）。

```bash
node scripts/sync/sync.js status win     # 自检：TCP、口令指纹、待推送/待拉取
node scripts/sync/sync.js push  win      # 本机 → 对端（存档 + 文件）
node scripts/sync/sync.js pull  win      # 对端 → 本机
node scripts/sync/sync.js restart        # 重启本机后台同步服务
```

排查顺序：**TCP 是否通**（`nc -vz <对端IP> 8788`）→ **口令是否一致**（带 `x-ssdz-token` 请求
`/api/status`：200 通、403 口令不一致，改完必须在对端**重启服务**）→ **链路质量**（ZeroTier 走中继时
RTT 可能 >1 秒且丢包，服务已对探测做重试；必要时改直连或自建 Moon 节点）。

## 验证

```bash
node tools/tower-balance.cjs 20     # 塔系统状态机 + 平衡实测
node tools/test-state.cjs           # 存档与状态机
node tools/test-extras.cjs          # 竞技场/天梯/师徒等
node tools/test-balance.cjs         # 数值曲线
node tools/test-stages.cjs          # 关卡
node tools/test-combat-rules.cjs    # 战斗规则
node tools/test-fusion.cjs          # 装备融合
node tools/test-sync.cjs            # 双机同步
```

## 来源与限制

- 素材与数值参照原版整理，仅作怀旧学习用途；纯前端复刻，不含联网对战。
- 没有关卡编辑器：数据都在 `js/gamedata.js` / `js/tower-data.js`，改完刷新即可。
