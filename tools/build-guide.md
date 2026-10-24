# 构建与发布指南

> 这份文件是**两份旧指南合并**来的（2026-10 瘦身 tools/）：
> · 上半篇 = 原来的 publish-guide.md：跨平台运行与 GitHub 发布（网页版 / 便携包 / 安装包 / APK 的发布流程）；
> · 下半篇 = 原来的 	auri-guide.md：桌面壳（Tauri）怎么编译、怎么保持「本地尽量轻」。
> 两者都是**发布相关**，合并成一篇更好找；命令入口统一在 tools/build-*.ps1 / *.cjs。

---

# 跨平台运行与 GitHub 发布指南

> 结论先说：**这是个纯静态 HTML5 游戏，运行时不依赖任何系统特性，macOS、Windows、Linux 都能玩，也能原样发布到 GitHub Pages**。
> 下面第一段是实测的兼容性结论，第二段起是三种发布方式的具体做法。

---

## 一、macOS 兼容性实测（2026-09 复核）

| 检查项 | 结论 |
| --- | --- |
| 运行时技术栈 | 纯 `HTML + CSS + 原生 JS + Canvas 2D`，**没有任何构建步骤**（`index.html` 直接 `<script src>` 加载 17 个模块） |
| 绝对路径 / 盘符 | 运行时 `js/`、`css/`、`index.html` 里**没有** `C:\`、`file:///`、`__dirname` 之类；图片/音频全是 `images/...`、`audio/...` 相对路径 |
| 平台判断 | 运行时代码里没有 `process.platform`、没有 `XMLHttpRequest`/`fetch`（不需要跨域），因此 Safari / Chrome / Edge 都一样 |
| 文件大小写 | `node tools/check-asset-paths.cjs` 核对 **883 条静态资源引用**全部命中，且 1739 个仓库文件里**没有只差大小写的重复路径** → Windows/macOS 上跑得动，Linux 主机（GitHub Pages）也不会 404 |
| 本地服务器 | `serve.js` 只用 `node:http` + `node:path`，跨平台；`path.sep` 处理路径分隔符 |
| 字体 | 原来是 `"Microsoft YaHei"` / `"SimSun"`（Windows 专有）。现在字体栈补了 **`"PingFang SC"`、`"Hiragino Sans GB"`、`"Songti SC"`、`"STSong"`**：Windows 仍用雅黑（渲染完全不变），macOS 自动落到苹方/宋体 |
| 音频 | 只有 `audio/main_bg.mp3`、`audio/fight_bg.mp3`，Safari 原生支持 MP3；被自动播放策略拦下时的「点击画面任意开启音乐」提示对 Safari 同样有效 |
| 存档 | `localStorage`（每浏览器一份）+ 系统页的 JSON 导出/导入，换电脑用导出文件搬 |
| Node 版本 | 测试与工具脚本用 CommonJS + `node:test` 之外的基础 API，**Node ≥ 18**（CI 在 20 上跑）即可 |
| 浏览器版本 | 需要支持 `:has()`、CSS 变量的现代版本：Chrome/Edge ≥ 105、Safari ≥ 15.4（`imageSmoothingQuality` 在旧 Safari 上会被忽略，不影响可玩） |

### 只在 Windows 上可用的部分（都是开发/取证工具，不影响玩游戏）

| 位置 | 说明 |
| --- | --- |
| `references/` 下的原版 APK 与参考截图 | 只作对照/取证；游戏运行不读它 |
| 无头浏览器截图 | 现在的仓库里不再带无头截图脚本：需要时用系统 Chrome + `--headless=new --screenshot`，或自行接 Playwright |
| ~~`tools/test-battle.js` 的 canvas 依赖~~ | **本轮已修**：改为多处查找 `@napi-rs/canvas`，找不到就打印 `SKIP` 并正常退出（其余测试不受影响） |

### 一个已知限制：不要用 `file://` 直接双击 `index.html` 当日常玩法

实测（headless Chrome）`file://` 下游戏能启动（108 个图集都加载了），但浏览器会把本地图片视为跨源，任何 `getImageData`/`toDataURL` 都会抛 `SecurityError`（自检里就有一处像素检查因此失败）。所以请用 `node serve.js 8080` 起本地服务器，或直接用 GitHub Pages。

### 为什么「同一个界面在 mac 上正常、在 Windows 上看起来缩放不对」

这是实测过的、可解释的差异（2026-09 复现并已修）：

| 原因 | 说明 |
| --- | --- |
| **滚动条占不占位**（主因） | macOS 默认是**覆盖式**滚动条，不占布局宽度；Windows 是**经典**滚动条，会从内容宽度里扣掉 9~17px。礼包/升级奖励面板是 `flex-wrap` 的一排卡片，宽度少几个像素就会**提前换行**：同一个 5 级礼包，带占位滚动条时面板是 `785×318`（且 `.modal-body` 出现滚动条），不带时是 `793×312`——在 mac 上永远看到的是后者，在 Windows 上则可能两行都挤、看起来「缩放不对」 |
| **`window.innerWidth/Height` 含滚动条** | 整屏缩放 `scale = min(innerW/1170, innerH/布局高)` 原本用的是 `innerWidth/Height`（**包含**滚动条区域）。Windows 上弹窗一出现/消失，滚动条就跟着出现/消失 → `innerWidth` 变化 → `resize` → 整屏缩放跳一下；macOS 不占位所以看不出来 |
| 系统显示缩放 | Windows 常见的 125%/150% 缩放会改变 CSS 像素与窗口的比例（`innerWidth` 变小），macOS Retina 是整倍 2×，于是两端算出的 `scale` 不同——界面整体略大/略小，但结构一致 |
| 字体回退 | Windows 用微软雅黑、macOS 落到苹方，`39px` 的说明文字换行点不同；只有依赖文字宽度的容器会受影响（奖励卡片是固定宽度，所以主要是说明文字） |

**已做的修复**（`css/classic.css` + `js/main.js`）：

1. `.modal-body` 加 `scrollbar-gutter: stable` —— 两个平台都预留同样的滚动条槽位，换行点不再因平台而变（实测两端数值变成完全一致的 `bodyClient 917 / bodyOffset 926`、面板 `785×318`）；
2. 弹窗内容上限 `max-height` 475 → 520px，减少「本来不需要滚动」的场景；
3. `fitCanvas()` 改用 `document.documentElement.clientWidth/Height`（**不含**滚动条）算缩放，滚动条出现/消失不再让整屏跳动。

复现命令（同一页、同一个窗口尺寸，只切换是否显示占位滚动条）：

```bash
google-chrome --headless=new --screenshot=out.png --window-size=1280,900 "http://127.0.0.1:8080/"   # 需要截图时直接用它
```


---

## 二、发布方式 A：GitHub Pages（最省事，Mac + Windows 打开网址即玩）

仓库里已放好工作流 `.github/workflows/pages.yml`：

1. 推到 GitHub：`git remote add origin git@github.com:<你的用户名>/<仓库名>.git && git push -u origin main`
2. 仓库 **Settings → Pages → Build and deployment → Source 选 `GitHub Actions`**
3. 之后每次推 `main` 都会自动部署，地址形如 `https://<用户名>.github.io/<仓库名>/`
   （也可以在 Actions 页手动 `Run workflow`）

工作流只发布**运行需要的 5 个目录**（`index.html` + `css/` + `js/` + `images/` + `audio/`，约 55 MB）：

- `references/`（含 35 MB 的原 APK）与 `tools/`（开发工具、截图证据）**不进站点**——省流量，也避免把原始 APK 公开分发出去（`references/` 本来就在 `.gitignore` 里）。
- 站点是纯静态的，不需要 Jekyll，也不需要 `.nojekyll`。

> 流量提醒：GitHub Pages 免费额度是「仓库站点 ≤ 1 GB、每月 100 GB 流量」。本站点 55 MB，够用；如果以后图片继续变大，可以考虑给 PNG 做无损压缩再发布。

---

## 三、发布方式 B：GitHub Release 便携包（解压即玩）

工作流 `.github/workflows/release.yml` 会在**推 `v*` 标签**时自动打包两个 zip 并挂到 Release：

```bash
git tag v0.1.3
git push origin v0.1.3
```

产物：

| 文件 | 内容 |
| --- | --- |
| `squirrel-web-mac-v0.1.3.zip` | `README.md`、`css/`、`js/`、`images/`、`audio/`、`启动说明.txt`，启动器在 `scripts/`（`启动游戏.command`、`game-exit-watch.sh`、`serve.js` + `serve.py`、`index.html`） |
| `squirrel-web-win-v0.1.3.zip` | 同上，`scripts/` 里多一个 `启动游戏.cmd` + `start-game.ps1`（两个文件必须在一起） |

> 启动器都在 `scripts/` 里；两个平台都把 `squirrel_fight.exe` 放到 zip 根目录就会优先走原生窗口。

启动脚本的行为（`scripts/启动游戏.command` / `scripts/启动游戏.cmd`）：

1. 先看端口：已经被**带 `/__save` 存档接口**的服务器占着就直接用它；被别的程序占着（例如以前的 `python -m http.server`）就明确报错并**不打开浏览器**，让你换端口（`scripts\启动游戏.cmd 8081`）；
2. 有 Node.js → `node serve.js 8080` 起服务器，**等端口真的监听成功**再用浏览器「应用窗口」打开（macOS 没有 Node 但有 `python3` → 走 `serve.py`，同样带存档接口）;
3. 都没有 → 直接打开 `index.html`（并在说明里提醒可能被浏览器限制，进度只能存浏览器里）。

Windows 的 `.cmd` 只是 ASCII 外壳（`cmd.exe` 读 `.cmd` 里的 UTF-8 中文会把中文注释当成命令执行，导致服务器起不来），中文提示与判断逻辑在 `start-game.ps1` 里，打包时两个文件都要带上。

macOS 首次运行 `.command` 需要「右键 → 打开」；如果 zip 解压后没有执行权限，在终端执行一次 `chmod +x scripts/启动游戏.command`（release 工作流已经 `chmod +x` 后再打包，正常情况不需要）。

> 本地先试一遍：`node serve.js 8080`，浏览器打开 `http://127.0.0.1:8080/`。

---

## 四、发布方式 C：做成真正的安装包（`.dmg` / `.exe`）

**Tauri 路线已经做好并且在本机编译通过**（Windows：`npx tauri build --bundles nsis` → 47 MB 安装包；macOS 由 CI 出 `.dmg`）。
工程在 `src-tauri/`、工作流在 `.github/workflows/tauri.yml`，细节、实测数据与坑见 [Tauri 桌面版说明](tauri-guide.md)。

如果你想自己换一条路（例如要自带 Chromium 内核，让两端像素完全一致），下面这套 Electron 做法仍然有效——游戏本身是纯静态页面，包装非常薄：

**Electron 路线（改动最小）**

1. 新增 `electron/main.cjs`：建一个 `BrowserWindow`，`win.loadFile('index.html')`（或指向打包好的 `_site/index.html`），关掉菜单栏。
2. `npm i -D electron electron-builder`
3. `package.json` 加构建配置：

```json
{
  "main": "electron/main.cjs",
  "build": {
    "appId": "com.example.ssdz",
    "files": ["index.html", "css/**", "js/**", "images/**", "audio/**", "electron/**"],
    "mac": { "target": ["dmg", "zip"], "category": "public.app-category.games" },
    "win": { "target": ["nsis", "portable"] }
  }
}
```

4. GitHub Actions 用矩阵跑构建（macOS 跑 mac 目标、Windows 跑 win 目标）：

```yaml
strategy:
  matrix:
    include:
      - { os: macos-latest,  script: "npm run dist:mac" }
      - { os: windows-latest, script: "npm run dist:win" }
runs-on: ${{ matrix.os }}
```

**要注意的三件事**

- macOS 的 `.dmg` 想「双击就开」需要 Apple 开发者账号做代码签名与公证（$99/年）；不签名的话用户第一次要「右键 → 打开」或在「系统设置 → 隐私与安全性」里放行。Windows 的 SmartScreen 同理（不签名会提示「未知发布者」）。
- 产物会从 ~50 MB 涨到 ~200 MB（Electron 运行时体积），而且**每个平台必须用自己的 runner 构建**（mac 包不能在 Windows 上打）。
- 存档位置会从浏览器变到 Electron 的用户数据目录，迁移需要额外处理（现在的 JSON 导出/导入功能可以直接复用）。

> 结论：如果你能接受「浏览器打开」或「解压 + 双击脚本」，方式 A/B 已经完全够用；只有明确想要桌面 App 时才值得走 C，而且签名/公证是主要成本。

---

## 五、CI：三平台跑同一套测试（证明跨平台不是嘴上说说）

`.github/workflows/ci.yml` 在 `ubuntu-latest`、`macos-latest`、`windows-latest` 上并行跑：

```bash
node tools/check-asset-paths.cjs   # 资源引用大小写/断链体检
node tools/check-encodings.cjs     # 文本编码 + .ps1 BOM 体检
for t in tools/test-*.cjs; do node "$t" || exit 1; done   # 枚举整个目录，不手写清单
node tools/test-battle.js          # 动画回归（可选依赖 @napi-rs/canvas，缺了自动 SKIP）
```

当前套件（2026-10 审计时 16 个）：`test-state`（存档/成长/道具/每日）、`test-mint-shop`
（无尽塔商店/剧情/整百层/同名叠加）、`test-env-buff`（环境词缀与剧情埋点）、`test-fixes-round`
（历史战斗与塔规则）、`test-stages` / `test-stage-balance`（关卡与数值平衡）、`test-points`
（升级属性点）、`test-battle-drops`（点击拾取）、`test-buff-report` / `test-buff-tags`
（buff 报告与标签）、`test-extras`（竞技/天梯/师徒/排行榜/超级松鼠）、`test-fusion`（装备融合）、
`test-min-deps`（最小依赖/引导）、`test-save-boot`（存档与启动）、`test-ssfight-render`
（经典界面渲染与素材契约）、`test-sync`（双机同步）。

本地跑全套（仓库根没有 `package.json`，所以没有 `npm test`）：

```bash
for t in tools/test-*.cjs; do node "$t" || exit 1; done
```

---

## 六、发布前的自检清单

- [ ] `node tools/check-asset-paths.cjs` 全绿（新增素材后最容易踩：**大小写**）
- [ ] `node tools/check-encodings.cjs` 全绿（`.ps1` 含中文必须带 UTF-8 BOM）
- [ ] `tools/test-*.cjs` 全绿（CI 会枚举整个目录）
- [ ] `http://127.0.0.1:8080/index.html?test=1` 浏览器自检 21/21、控制台 0 错误
- [ ] 手机上开一次 Pages 地址（竖屏会被画布缩放，纯静态站也能开，只是操作不便）
- [ ] 安卓包三档签名齐全（**v1/v2/v3 都要 true**；`--min-sdk-version 23` 才会校验 v1）：
      `apksigner verify --min-sdk-version 23 --verbose <apk>` —— `tools/build-apk.ps1` 已内置复检与补签
- [ ] 版本号与 `package.json` / `tauri.conf.json` / `scripts/version.json`、git tag 对齐；
      Release 说明里写清「怎么启动 / 存档怎么搬」

---

# 桌面版（Tauri）：一个几 MB 的原生窗口，前端直接用游戏目录里的文件

> 目标有两层：**双击就是独立窗口**（不用浏览器），以及**本地尽量轻**。
> 现在仓库里有两种产物，平时用第一种：

| 方案 | 产物 | 本地占用 | 前端从哪来 | 用在哪 |
| --- | --- | --- | --- | --- |
| **轻壳**（默认） | 仓库根目录的 `squirrel_fight.exe`，**约 2.9 MB** | exe 一个文件（`target/` 编译缓存可用 `--clean` 回收） | **游戏目录里的 `index.html` / `css` / `js` / `images` / `audio`**：外壳启动时自己起一个迷你 HTTP 服务器供起来 | 本机玩、便携包旁边玩 |
| **安装包** | `squirrel_fight_<version>_x64-setup.exe`（约 50~70 MB） | 打完自动删掉临时的 `web/` | 编译进二进制（旁边没有游戏目录也能跑） | 发给别人装 |

轻壳不复制、不嵌入任何前端资源，所以：

* **改了 `css/` `js/` `images/` 后，重开窗口就是新的**——桌面版和网页版天然同一套代码，不存在「app 里是旧前端」的问题；
* 存档走和网页版**完全一样**的 `/__save`（写 `<游戏目录>/save/progress.json`），也不再需要 Node.js / Python；
* 内存占用也更低（实测 39 MB，旧的内嵌版 62 MB）。

---

## A. 双击入口

**Windows 正式入口现在是游戏根目录的 `squirrel_fight.exe`**（双击它就直接开原生窗口，不走脚本）。
兜底入口是 `scripts\启动游戏.cmd`：优先开原生窗口，找不到原生版或它连开三次都没稳住，
才退回「起服务器 + 浏览器应用窗口」。已经开着一个桌面版时再双击只会提示「已经在运行」。

原生版按这个顺序找：`<游戏根>\squirrel_fight.exe` → `scripts\squirrel_fight.exe` →
`src-tauri\target\release\squirrel_fight.exe`
（macOS 是 `.app` 包；Windows 正式产物只有游戏根目录的 `squirrel_fight.exe`），加 `--browser` 可强制走浏览器路线。
> 2026-10 起打包脚本**不再**往 `src-tauri\dist\` 放一份 exe 副本（便携包不收它、发布的是安装包，
> 纯重复文件）；正式产物就一个：游戏根目录的 `squirrel_fight.exe`。

```bash
# macOS / Linux（启动器住在 scripts/ 里）
bash scripts/启动游戏.command
bash scripts/启动游戏.command --browser

# Windows
squirrel_fight.exe                 # 正式入口：双击开原生窗口
scripts\启动游戏.cmd             # 兜底：没有 exe / 想用浏览器路线时
scripts\启动游戏.cmd 8080 --browser
scripts\启动游戏.cmd --no-save
```

Windows 兜底侧是 `启动游戏.cmd`（纯 ASCII 外壳）+ `start-game.ps1`（真正干活的部分）两个文件——
cmd.exe 读 `.cmd` 里的 UTF-8 中文会把中文字节错位、把中文注释当命令执行
（实测报 `'，其次' is not recognized`），于是**服务器没起来、浏览器却已经打开**，
正好复现「没有本地服务器接口」。外壳保持 ASCII、中文与判断交给 PowerShell 就没这问题。

## B. 轻壳是怎么工作的

```
双击 squirrel_fight.exe（根目录）
   └─ Rust 外壳自己找游戏目录（往上找到含 index.html 的那层）
      —— 或者走兜底：scripts\启动游戏.cmd
   └─ start-game.ps1：找到游戏目录 → 起 squirrel_fight.exe（cwd=游戏目录）
        └─ Rust 外壳（src/main.rs，约 17 KB 源码，标准库实现迷你服务器）
             ├─ 找游戏目录：SSDZ_GAME_DIR → 当前目录 → 从 exe 往上找，都要求有 index.html
             ├─ 起本地服务器：127.0.0.1 的**随机端口**（不会和网页版的 8080 撞车）
             │    · 静态文件：直接读游戏目录（含 MIME、keep-alive、挡 ../ 越界）
             │    · /__save：与 serve.js 语义一致（GET / ?meta=1 / POST）
             ├─ 打开窗口 http://127.0.0.1:<端口>/index.html（1216×760，标题「松鼠大战 · 怀旧复刻版」）
             └─ 存档 = <游戏目录>/save/progress.json（和网页版同一个文件，同一套时间戳/冲突保护）
```

**为什么不用 `file://`**：浏览器/WebView 会把本地文件当跨源，`getImageData` / `toDataURL`
直接抛 `SecurityError`（自检里的像素检查就靠它），所以必须有一个 http 源——这就是迷你服务器存在的理由。

**为什么桥接层（`js/tauri-bridge.js`）在轻壳模式下要跳过**：Tauri 会往 http 页面里也注入
`window.__TAURI__`，但那边调命令会被 ACL 拒绝（实测 `Command save_meta not allowed by ACL`），
存档会莫名其妙退回浏览器 localStorage。所以桥接只在**非 http(s) 页面**（安装包模式的
`tauri://localhost`）启用，用 Rust 命令读写存档；轻壳模式一律用 `/__save`。

## C. 构建与瘦身（需要 Rust）

```bash
# 一次性：装 Rust（https://rustup.rs）+ 在 src-tauri 里 npm install + npx tauri icon app-icon.png
node tools/build-tauri-app.cjs            # 编译 → 仓库根 squirrel_fight.exe
node tools/build-tauri-app.cjs --clean    # 同上，然后 cargo clean（回收 target/）
node tools/build-tauri-app.cjs --installer # 另打 NSIS 安装包（临时暂存 web/，打完自动删）
```

实测（Windows 11、rustc 1.98.1、16 核）：

| 项目 | 轻壳 | 安装包 |
| --- | --- | --- |
| 产物 | `dist/squirrel_fight.exe` **2.86 MB**（旧的内嵌版是 48.91 MB + 0.14 MB dll） | `松鼠大战怀旧版_0.1.3_x64-setup.exe` **47.02 MB** |
| 编译 | `cargo build --release` 首次约 1 分 20 秒~2 分 24 秒 | 再 +1 分钟打包 |
| 中间产物 | `target/` 实测 **3.4 GB**（依赖树 + 调试符号）→ `--clean` 一键清零 | 同上 |
| 运行时内存 | 39 MB | 62 MB |
| 需要 Node/Python | 不需要（存档由 Rust 写） | 不需要 |

**关于空间**：那 3.4 GB 全在 `src-tauri/target/`，是「编译一次就有、删掉也不影响运行」的缓存；
真正要留的只有约 2.9 MB 的 exe（放在**仓库根目录**，是随仓库提交的双击入口）。
`--clean` 之后重建要重新编译（本机约 1~2 分钟，依赖不用重新下载，因为 `~/.cargo` 里还留着）。

## D. 存档位置

**默认就是游戏目录里：`<游戏目录>/save/progress.json`**。外壳找「游戏目录」的顺序：
①环境变量 `SSDZ_GAME_DIR`（启动器会设，最可靠）；②当前工作目录；③从可执行文件往上找——
每一处都要求目录里**真的有 `index.html`**，认错了就会去别的文件夹伺候文件。找到并且 `save/` 可写就用它。

真正安装到 `Program Files` 之类只读位置（那时也没有游戏目录）才用系统应用数据目录：

| 平台 | 备份位置（仅当游戏目录不可用时） |
| --- | --- |
| Windows | `%APPDATA%\com.ssdz.classic\save\progress.json` |
| macOS | `~/Library/Application Support/com.ssdz.classic/save/progress.json` |

以前旧版本两边都写过存档的话：会按 JSON 里的 `savedAt` 把**新的那份**搬到当前使用的位置
（旧版桌面版写在应用数据目录，实测 117,707 字节的进度被搬进 `E:\松鼠大战怀旧版\save\progress.json`）。
也可以继续用游戏里「系统 → 导出/导入存档」的 JSON。

## E. 工程结构

```
src-tauri/
├─ Cargo.toml              只有 tauri + serde + serde_json（没有额外插件）
├─ build.rs                tauri-build
├─ tauri.conf.json         轻壳配置：frontendDist = empty（只放一个几百字节的「没找到游戏目录」提示页）
├─ tauri.bundle.conf.json  安装包配置：把 frontendDist 覆盖成临时的 web/
├─ tauri.windows.conf.json Windows 目标固定 nsis（MSI 会在 WiX light.exe 上失败）
├─ app-icon.png            1024×1024 透明背景松鼠（设计稿导出，随仓库提供）
├─ package.json            app / app:clean / installer / dev / icon 脚本
├─ src/main.rs             迷你文件服务器 + 找游戏目录 + 存档命令 + 开窗口
├─ empty/index.html        只有几百字节：找不到游戏目录时显示的提示页
├─ dist/squirrel_fight.exe   ← 构建产物（几 MB，不进版本库）
├─ web/                    ← 只有打安装包时临时生成（不进版本库）
└─ icons/                  ← npx tauri icon app-icon.png 生成（不进版本库）
```

`app-icon.png` 改了之后要跑一次 `npx tauri icon app-icon.png` 重生成 `icons/`
（`.ico` / `.icns` 都带 alpha），安装包和窗口图标才会跟着变。

## F. 想确认窗口里跑的是哪一版前端

轻壳读的就是游戏目录里的文件，理论上不会旧；要核对（或排查问题时）可以问它一句：

```powershell
# 1) 带调试端口启动（正式产物就是游戏根目录这一份）
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
.\squirrel_fight.exe
# 2) 另开终端
# 需要查运行时状态时，用 Chrome/Edge 的 devtools 协议连 9222 端口自行检查
# → http://127.0.0.1:1362/index.html | file | save/progress.json
```

## G. 用 GitHub Actions 打包（本机不需要 Rust）

`.github/workflows/tauri.yml`：手动触发只产出构建工件；推 `v*` 标签会在
`macos-latest` / `windows-latest` 上各打一份安装包并挂到 Release。步骤是
安装 Rust → 暂存前端（`build-tauri-app.cjs --web` + `--web --check`）→ `tauri icon` →
`tauri-action` 带 `--config tauri.bundle.conf.json` 构建（**安装包这一版才需要嵌前端**）。

## H. 平台差异与注意事项

1. **WebView 引擎不同**：macOS 用系统 WKWebView、Windows 用 WebView2（Chromium）。
   换成桌面窗口**不会**消除排版差异——`scrollbar-gutter: stable` 那套修复仍然必要。
   想要两端像素一致只能用自带 Chromium 的方案（Electron/CEF），代价是包体 120~200 MB。
2. **macOS 未签名**：不做签名与公证时首次要「右键 → 打开」；Windows 未签名会有 SmartScreen 提示。
3. **窗口尺寸**：默认 1216×760（游戏设计尺寸 1170×690）。游戏内部按
   `documentElement.clientWidth/Height` 等比缩放，改窗口大小会自动适配。
4. **不要同时开两个实例**写同一份存档：桌面版和浏览器版共存时，最后写入的那份覆盖前面的
   （启动器已经拦了「重复双击」，但浏览器那边开着的话仍要注意）。
5. **轻壳需要游戏目录**：把 `squirrel_fight.exe` 单独拷到别处、旁边没有 `index.html` 时，
   窗口会显示「没找到游戏目录」的提示页；想发给别人就用 `--installer` 打的安装包。

## I. iOS（iPhone/iPad 未签名 IPA）

Windows 双击 `scripts\打包.cmd` 会在本机完成 exe / 安装包 / APK 后，自动调用已配对的
Mac，顺序生成下面两种 IPA，并下载到 **Windows 的 `src-tauri\dist`**。版本沿用本轮
Windows 的升版结果，Mac 不再单独升版。Mac 不在线或工具链检查失败时会在升版前停止；
加 `-SkipIos` 可跳过，`-IosVariant modern` / `legacy` 可只出其中一种，`-IosPeer mac`
对应现有 `scripts/sync/sync.config.json` 的 peer 名称。

首次接入：将新版 `scripts/sync/sync.js`、`scripts/sync/ios-build.cjs` 同步到 Mac 后，
在 **Mac 游戏目录**运行一次 `node scripts/sync/sync.js restart`。后续不需要 SSH，直接复用
现有同步口令。可在 Windows 单独运行：

```powershell
node tools/build-ios-remote.cjs --check    # 只检查 Mac 连接和 iOS 工具链
node tools/build-ios-remote.cjs            # 当前版本的两种 IPA，不升版，不编 Windows / Android
node tools/build-ios-remote.cjs --dry-run  # 只看源码与产物计划，不联网、不写文件
```

远程构建使用 Windows 本轮源码的隔离快照，按内容增量传输；不改 Mac 的开发目录、存档、
同步配置，也不传 Windows 的 `node_modules` / `target` / Apple 工程。快照复用 Mac 的
Node 依赖及专用构建缓存。只有远程构建成功、版本和下载完整性检查通过后才替换同名 IPA；
旧版 IPA 保留。`-CleanOnly` 不连接 Mac，Windows 的清缓存步骤也不清 Mac 缓存。

> 产物：
> - `src-tauri/dist/squirrel_fight_<version>_ios_unsigned.ipa`：**iOS 26/27**（带 UIScene）；
> - `src-tauri/dist/squirrel_fight_<version>_ios_legacy_unsigned.ipa`：**iOS 15~25**（传统生命周期，不声明 UIScene）。
> - 需要签名时：`*_ios_signed.ipa`（iOS 26+）与 `*_ios_legacy_signed.ipa`（iOS 16–25）；两者 Bundle ID 相同，
>   但只能按系统版本装对应的那个 —— iOS 26+ 装 legacy 会启动闪退。
>
> 需要企业签名时再跑 `node tools/sign-ios.cjs`（默认签当前版本的 legacy 未签名包）：
> - `src-tauri/dist/squirrel_fight_<version>_ios_legacy_signed.ipa`：同一份 iOS 15~25 前端与二进制，
>   Info.plist 的 `CFBundleIdentifier` 改成描述文件 App ID，`embedded.mobileprovision` + entitlements 齐全。
>
> 未签名包用 Sideloadly / AltStore / 爱思助手 自己的 Apple ID 自签；免费账号 7 天有效，不需要开发者账号。
>
> **存档导出 / 导入（iOS）**：游戏内「系统 → 导出存档」把 JSON 写到 App 沙盒的 `Documents/`；
> `Info.ios.plist` 的 `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` 会让它在
> 「文件」App → 我的 iPhone/iPad → 松鼠大战 里可见。导入点「系统 → 导入存档」：
> 可以选「选择文件（文件 App）…」，也可以走「粘贴存档文本…」兜底（WKWebView 文件选择器失灵时用）。
> 导出成功弹窗还会给「分享到其它 App」「复制存档文本」，方便换机 / 传给别人。
>
> ⚠ **换包更新必须沿用同一 bundle ID / 同一签名身份**。未签名或 TrollStore 安装的是
> `com.ssdz.classic`；用企业描述文件签名时 Info.plist 会被改成描述文件里的 App ID
> （当前是 `jp.co.rakuten-sec.iSPEED...`）。两者对 iOS 是**两个不同的 App**，存档容器互不相通：
> 在两者之间来回装，会各自看到一份「初始档 / 有进度档」，看起来就是存档横跳。更新时要么一直用
> 同一签名包（并递增 `CFBundleVersion`），要么一直用同一 TrollStore/自签身份；确实要换身份，
> 先在「系统 → 导出存档」备份，再在新包里导入。

一次性依赖（macOS）：

- Xcode（App Store 安装，打开一次同意协议）；
- Rust：`rustup target add aarch64-apple-ios` + `rustup component add llvm-tools`
  （Xcode 27 的 swift-rs 需要 `llvm-objcopy`，缺了会在链接 `libtauri` 时报 `_log_stdout` 等符号未定义）；
- `brew install xcodegen cocoapods`；`cd src-tauri && npm install`。

出包：

Mac 上日常发版可以用一键命令（会自动 patch 版本、构建两种包、企业签名，并把 `dist` 里除两个签名包外的 `.ipa` 全部删掉）：

```bash
bash scripts/一键打包IPA.command             # 双击也可以
bash scripts/一键打包IPA.command --dry-run   # 先看目标版本 / 构建号 / 产物，不构建
bash scripts/一键打包IPA.command --version 1.0.6
bash scripts/一键打包IPA.command --no-bump
```

它产出（每个版本只保留这两个签名包）：

- `squirrel_fight_<version>_ios_signed.ipa`：iOS 25–26（modern / UIScene）；
- `squirrel_fight_<version>_ios_legacy_signed.ipa`：iOS 16–24（legacy）。

构建号默认取 `dist` 里现有 IPA 的最大 `CFBundleVersion` + 1（最低 110），避免 iOS 因 build 号没有递增而拒绝覆盖安装；可用 `--build N` 指定。构建或签名失败会回滚版本文件并保留旧包，只有两个新包都验签通过后才清理旧 `.ipa`。

手动分步：

```bash
node tools/build-ios.cjs --check   # 只检查环境
node tools/build-ios.cjs           # iOS 26/27（带 UIScene）
node tools/build-ios.cjs --legacy  # iOS 15~25（传统生命周期）
node tools/build-ios.cjs --clean   # 先删 gen/apple/build 再打
node tools/build-ios.cjs --clean --build 105   # 需要覆盖同版本旧包时显式抬高 CFBundleVersion
node tools/sign-ios.cjs            # 把当前版本的 legacy 未签名包签成 *_legacy_signed.ipa
node tools/sign-ios.cjs --input src-tauri/dist/squirrel_fight_<version>_ios_unsigned.ipa \
  --output src-tauri/dist/squirrel_fight_<version>_ios_signed.ipa   # iOS 26+ 的 scene 签名包
```

**为什么要两个包**：iOS 26+ 强制 UIScene，没声明 `UIApplicationSceneManifest` 会启动即崩；
而 tao 0.35 的 scene 启动路径在 iOS 15 上存在兼容问题（tao 0.37 才修），15.6.1 + TrollStore
的反馈就是“装好后一打开就闪退”。`--legacy` 会删掉 UIScene 声明，让 iOS 15 走传统
AppDelegate 生命周期；两个包的前端与二进制完全相同，只有 Info.plist 这一处差异。

脚本做的事：

1. `tools/build-tauri-app.cjs --web` 生成 `src-tauri/web`（134 MB：css/js/images/audio + 首页）；
2. `tauri icon app-icon.png --ios-color '#FFF3DC'`（iOS 图标不能透明）；
3. 首次 `tauri ios init`，之后补 `gen/apple/project.yml`：仅横屏、中文显示名、隐藏状态栏/Home 条、
   `TARGETED_DEVICE_FAMILY=1,2`；默认加 `UIApplicationSceneManifest`（`SupportsMultipleScenes=true`），
   `--legacy` 时删掉它；
4. `objectVersion 77 → 55`（CocoaPods 1.11 的 xcodeproj 只认到 55）、删掉 Podfile 里不存在的 macOS target、`pod install`；
5. `tauri ios build --no-sign --archive-only`，从 `.xcarchive/Products/Applications` 取 `.app`；
   归档后强制写 `CFBundleShortVersionString=<version>`、`CFBundleVersion=<版本号去点>`（1.0.4 → 104），
   再封成 `Payload/squirrel_fight.app` 的 zip（`zip -qry`）。Tauri 自带的 `--build-number` 会把数字拼到
   主版本上（1.104），不要用它。

注意：

- 设备包是 **arm64 真机包**，不能直接装到模拟器；模拟器要 `--target aarch64-sim` 另外构建，
  且 Apple Silicon 上必须补 ad-hoc 签名（`codesign --force --deep --sign - <app>`），否则启动即被杀。
- 本机 Xcode 27 的组件目录只提供 iOS 27.1 runtime，**没有 iOS 15.6 runtime**，因此 legacy 包
  无法在本地模拟器复现/验证；必须用 iOS 15.6 真机实测。若仍闪退，取
  `设置 → 隐私与安全性 → 分析与改进 → 分析数据` 里的 `squirrel_fight-*.ips` 再定位。
- iOS 15 出现“能打开但触屏无反应”：已内置 `js/touch-fallback.js`（420ms 内没等到原生 click 才在
  触点补发 `detail=0` click，兼容 SVG 路由），且 `touch-action` 只保留在 button/input。若仍完全无反应，
  先让用户点昵称输入框看是否弹键盘；不弹说明原生触摸没进 WKWebView，必须取 `.ips` / Console 日志。
- 存档在应用私有目录：`<container>/Library/Application Support/com.ssdz.classic/save/progress.json`；
  系统页的 JSON 导出/导入仍可用。
- 这是 WebView 套壳；以后要上 App Store 需按 Guideline 4.2 补原生功能/内容，并准备无 alpha 的
  App Store 图标与隐私清单。未签名 IPA 只适合 sideload 分发。

### 企业证书被吊销 / 存档救援（2026-10-23 实例）

`src-tauri/10月20日企业证书` 这张 RAKUTEN 证书在 **2026-10-23 16:05 UTC 被 Apple 置为
revoked（certificateHold）**。本地与 GitHub 上的 1.0.5 签名包 `codesign --verify --deep --strict`
都通过、SHA-256 逐字节一致，但 iOS 仍然拒绝安装/启动 —— 问题不在打包，在证书状态。
描述文件本身也会在 **2026-11-05** 到期，所以即使 Apple 解除 hold，也只剩几天。

签名前先查 OCSP（`tools/sign-ios.cjs` 已内置，吊销会直接退出；`--no-ocsp` 只用于离线排障）：

```bash
openssl pkcs12 -in "src-tauri/10月20日企业证书/先导入.p12" -passin 'pass:…' \
  -nokeys -clcerts -legacy > /tmp/leaf.pem
openssl x509 -inform der -in /Applications/Xcode.app/Contents/SharedFrameworks/AssetRuntime/DVTFoundation.framework/Versions/A/Resources/AppleWWDRCA-2030.cer -out /tmp/wwdr.pem
openssl ocsp -issuer /tmp/wwdr.pem -cert /tmp/leaf.pem \
  -url http://ocsp.apple.com/ocsp03-wwdrg301 -resp_text -noverify
```

**旧版存档还在手机上**：企业版 App 的数据容器是
`<container>/Library/Application Support/com.ssdz.classic/save/progress.json`，
旁边还有 `progress.bak.json`；证书吊销不会删除容器。玩家**不要删除 App**（删除会删容器）。
取出方式：

- Xcode → Devices and Simulators → Installed Apps → Download Container，得到 `.xcappdata`；
- 或命令行（设备要开开发者模式、解锁、已配对）：
  ```bash
  xcrun devicectl list devices
  xcrun devicectl device copy from --device <UDID> \
    --domain-type appDataContainer \
    --domain-identifier jp.co.rakuten-sec.iSPEED.Pushnotification.widgetapp.widgetkitextension \
    --source . --destination ~/Downloads/松鼠大战容器
  ```
- 或 Finder/iTunes 本地备份（不要加密）+ 安装仓库里的
  `rescue/ios-save-rescue.cjs`（`--container` / `--backup` / `--file`；默认输出推荐档 + 报告）。
- 取出 `.json` 后放进新版本的 `Documents/`（「文件」App 可见），游戏里「系统 → 导入存档 → 存档列表」导入。

**换新证书时想自动保留旧存档**：新描述文件必须是通配符（`*`）或明确包含旧 Bundle ID，
用 `node tools/sign-ios.cjs --profile <新.mobileprovision> --p12 <新.p12> --identity "…" \
--bundle-id jp.co.rakuten-sec.iSPEED.Pushnotification.widgetapp.widgetkitextension` 重签，
递增 `CFBundleVersion`，覆盖安装到旧 App 上。同 Bundle ID 覆盖安装通常保留数据容器，
但换 Team 后是否保留要以一台真机实测为准；不放心就先让玩家导出/救援存档再升级。
公开分发不要再依赖企业证书：网页版 / PWA、TestFlight 或 App Store 才是可持续路径。

## J. 前端要改吗

不用改渲染，只有存档通道是「可插拔」的：

```js
// 网页版 / 轻壳：走本地服务器的 /__save（同一个文件、同一套逻辑）
// 安装包模式（tauri://localhost）：js/tauri-bridge.js 换成 Rust 命令
State.setSaveTransport({ label, probe(), read(), write(json) });
```

任何别的宿主（自建服务端、Electron、手机壳）都可以照这个接口接上，存档的时间戳比较与冲突保护不用重写。
