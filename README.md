# 松鼠大战 · 怀旧单机复刻版

把当年 UC 乐园《松鼠大战》的玩法做成**纯静态网页**的单机复刻：三侠闯关、背包装备、
装备融合、竞技场天梯、师徒好友、挑战塔与无尽塔。没有构建步骤，双击启动器就能玩；
存档写本地文件，也支持 Mac ↔ Windows 双机同步。

## 游戏画面

| 标题画面 | 主界面 |
|---|---|
| ![标题画面](images/screenshots/title.png) | ![主界面](images/screenshots/home.png) |

| 战斗 | 无尽挑战塔 |
|---|---|
| ![战斗](images/screenshots/battle.png) | ![无尽挑战塔](images/screenshots/endless.png) |

## 启动

| 平台 | 方式 |
|---|---|
| Windows | 双击根目录的 **`squirrel_fight.exe`** —— 原生窗口（Tauri 桌面版），不经过浏览器 |
| macOS | 双击 `scripts/启动游戏.command`（停止：`bash scripts/启动游戏.command --stop`） |
| 手动 / 兜底 | `node scripts/serve.js` → 浏览器打开 `http://127.0.0.1:8080/` |

Windows 的兜底入口是 `scripts\启动游戏.cmd`（纯 ASCII 外壳）+ `scripts\start-game.ps1`（真正干活的部分），
用在「还没编译 exe / 没有 WebView2 / 想强制走浏览器路线 / 只读模式」这些场合：

```
scripts\启动游戏.cmd                 # 找不到 exe 时退回「本地服务器 + 浏览器应用窗口」
scripts\启动游戏.cmd --browser       # 强制走浏览器路线
scripts\启动游戏.cmd 8081 --no-save  # 换端口 + 只读（不写存档）
scripts\启动游戏.cmd --stop          # 停掉后台的本地服务器
```

启动顺序：**先找 `squirrel_fight.exe`**（根目录 → `scripts\` → `src-tauri\dist\` → `src-tauri\target\release\`），
找到就开原生窗口；没有或连开三次都没稳住，才退回「本地服务器 + 浏览器应用窗口」。

存档默认写在 `save/progress.json`（磁盘优先，浏览器 localStorage 只是兜底）；
启动时会自动体检存档，损坏时从 `save/backup/` 恢复快照。
直接静态托管也能玩，但存档只留在浏览器里，双机同步不可用。

### 安卓版（APK）

游戏本体是纯 HTML/JS，所以能装到安卓手机上跑（Tauri 2 的 Android 支持，同一个 `src-tauri` 出包）：

```powershell
pwsh -File tools\build-apk.ps1 -Abi arm64-v8a -Release   # 真机
pwsh -File tools\build-apk.ps1 -Abi x86_64               # 模拟器
# 产物复制到 src-tauri\dist\ssdz-classic-<abi>-<profile>-<日期>.apk
```

手机上存档在应用私有目录 `/data/user/0/com.ssdz.classic/save/progress.json`，
和电脑上是同一份格式，跨设备用游戏里「系统 → 导入/导出存档」。
详细做法、踩过的坑与实测记录见 [docs/安卓版构建与实测.md](docs/安卓版构建与实测.md)。

⚠️ 注意：Windows 的 `squirrel_fight.exe` **不能**装到安卓上（PE 格式 + Windows API），
安卓必须用上面这个 APK；反过来 APK 也不能在 Windows 上跑。

## 玩法

- **关卡**：18 关推进，每关三名对手 + 关底 Boss。
- **战斗**：经典 1170×690 画布；普攻 / 技能 / 道具，暴击、闪避、吸血、反伤、
  护盾、中毒、复活等机制。实战与离线模拟共用同一套规则。
- **成长**：升级给属性点与礼包，武器 / 技能三选一，经验丸与属性丸等道具。
- **背包与装备**：部位 × 品质（普通 → 稀有 → 史诗 → 传奇），强化、镶嵌、天赋与武技。
- **装备融合**：同部位同品质三件合成更高品质一件。
- **竞技场与天梯**：经验场、碎片场、天梯赛（积分 / 金杯 / 周榜）。
- **师徒与好友**：拜师收徒领贡品，好友切磋与随机挑战。
- **挑战塔**：相对原版新增模式；类似于不封顶的关卡；每层一张挑战书，连战只继承血量，第三场后三选一增益。
- **无尽挑战塔**：相对原版新增模式；免门票；rougelike无尽模式；通过组合限次/永久/即时三类增益，增强自身并挑战越来越强大的敌人，获取更高的分数与抽奖卷。
- **双机同步**：Mac ↔ Windows 通过 ZeroTier 互推存档与游戏文件（`scripts/一键同步`）。

## 更新记录

各版本的改动都写在 git 提交历史里（`git log`）；设计与数值细节见 [docs/](docs/) 目录。

## 开发

纯静态：游戏本体没有构建步骤（`css`/`js`/`images`/`audio` 直接就是运行时产物），
只有桌面壳与安卓壳需要编译。

### 目录结构

| 目录 / 文件 | 作用 | 主要内容 |
|---|---|---|
| `scripts/` | **运行入口与本地服务器**（双击启动、存档接口都在这） | `index.html` 首页（服务器把它映射成 `/`）、`serve.js` / `serve.py` 静态服务器（带 `/__save` 存档接口）、`启动游戏.command`（macOS 双击入口）、`启动游戏.cmd` + `start-game.ps1`（Windows 兜底入口）、`停止游戏.command`、`一键同步.command` / `一键同步.cmd`、`重启同步服务.cmd`、`cleanup-old-layout.*`（一次性整理旧布局）、`sync/` 双机同步本体、`.gitattributes`（本目录的换行符规则：bash 脚本 LF、`.cmd` CRLF） |
| `js/` | **全部游戏代码**（见下表逐文件说明） | 启动流程、存档、战斗、塔、界面、静态数据 |
| `css/` | 样式，按模块分文件 | `style.css`（基础）、`classic*.css`（复古界面）、`tower.css`（塔）、`battle-drops.css`、`debug.css` |
| `images/` | 图片素材 | 背景与场景、UI 图标、角色图集（`images/orig/` 原版图集）、`screenshots/`（README 用的截图） |
| `audio/` | 音效与 BGM | 战斗音效、主界面 BGM |
| `src-tauri/` | **桌面壳与安卓壳**（Rust + Tauri 2，同一个 crate 出 exe 和 apk） | `src/lib.rs`（全部逻辑，按 `cfg(mobile)` 分支）、`src/main.rs`（桌面入口，仅 8 行）、`Cargo.toml`、`tauri.conf.json`、`tauri.android.conf.json`（安卓构建时自动合并）、`icons/`、`app-icon.png`、`gen/android/`（`tauri android init` 生成的安卓工程，**不进仓库**）、`web/` 与 `dist/`（构建产物） |
| `tools/` | **开发与验证工具**（不参与运行） | `test-*.cjs`（十余个 Node 回归套件）、`tower-balance.cjs` / `deep-balance.cjs` 等数值与平衡脚本、`build-tauri-app.cjs`（桌面 exe / 安装包）、`build-tauri-web.cjs`（打包前暂存前端）、`build-apk.ps1`（安卓 APK）、`*guide.md` 与 `apk-alignment.md`（源码对齐研究）、`research/`、`verification/`、`apk-audit/` |
| `docs/` | 设计与重构文档 | 挑战塔设计/重构、更新记录、[安卓版构建与实测](docs/安卓版构建与实测.md) |
| `save/` | **运行时的存档目录**（不进仓库） | `progress.json` 正式存档、`backup/` 快照、`server.out.log` / `server.err.log` |
| `references/` | 原版 APK 与参考素材（本地，不进仓库） | 供 `tools/apk-audit`、素材提取脚本对照 |
| `out/` | AI 超分与开发期对比图的**临时工作区**（本地，不进仓库） | 实验对比图与分析脚本；删掉不影响游戏 |
| `.github/` | CI 与发布 | `ci.yml`（回归）、`pages.yml`（在线试玩版）、`release.yml`（双平台便携 zip）、`tauri.yml`（桌面/移动安装包） |

根目录只有三样：Windows 入口 `squirrel_fight.exe`、`README.md`、`.gitignore`（哪些本地产物不进仓库）。
换行符规则放在 `scripts/.gitattributes`（`.gitattributes` 与 `.gitignore` 一样按目录生效，
所以只作用于 `scripts/`）——bash 脚本必须 LF，否则 mac 上双击会报
`syntax error near unexpected token '$'do\r''`。

### js/ 各文件

| 文件 | 职责 |
|---|---|
| `main.js` | 启动流程、标题 / 主界面场景、存档告警 |
| `state.js` | 存档读写、属性、关卡进度、背包 |
| `engine.js` / `sim.js` | 战斗引擎 / 离线战斗模拟（共用规则） |
| `battle.js` / `battle-drops.js` | 战斗表现 / 掉落 |
| `tower.js` / `tower-data.js` / `tower-ui.js` | 挑战塔 + 无尽塔：规则 / 数值 / 界面 |
| `classic-ui.js` / `classic-extras.js` / `classic-fusion.js` | 复古界面：主框架 / 周边系统 / 装备融合 |
| `gamedata.js` / `gamedict.js` | 静态数据（`gamedict.js` 由脚本生成，勿手改） |
| `ui.js` | 通用 UI 组件 |

测试（Node 直接跑，无依赖）：

```bash
node tools/test-state.cjs        # 存档与属性
node tools/test-tower-plan.cjs   # 塔规则
node tools/test-ui-flow.cjs      # 界面流程
# ……tools/ 下共十余个套件，全绿为准
```

调试面板：游戏内 `Ctrl+Shift+D`（不影响正式存档）。

## 许可

仅供怀旧与学习交流，素材版权归原厂商所有。
