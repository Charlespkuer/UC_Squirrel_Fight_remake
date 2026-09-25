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
| 文件大小写 | `node references/tools/check-asset-paths.cjs` 核对 **883 条静态资源引用**全部命中，且 1739 个仓库文件里**没有只差大小写的重复路径** → Windows/macOS 上跑得动，Linux 主机（GitHub Pages）也不会 404 |
| 本地服务器 | `references/tools/serve.js` 只用 `node:http` + `node:path`，跨平台；`path.sep` 处理路径分隔符 |
| 字体 | 原来是 `"Microsoft YaHei"` / `"SimSun"`（Windows 专有）。现在字体栈补了 **`"PingFang SC"`、`"Hiragino Sans GB"`、`"Songti SC"`、`"STSong"`**：Windows 仍用雅黑（渲染完全不变），macOS 自动落到苹方/宋体 |
| 音频 | 只有 `audio/main_bg.mp3`、`audio/fight_bg.mp3`，Safari 原生支持 MP3；被自动播放策略拦下时的「点击画面任意开启音乐」提示对 Safari 同样有效 |
| 存档 | `localStorage`（每浏览器一份）+ 系统页的 JSON 导出/导入，换电脑用导出文件搬 |
| Node 版本 | 测试与工具脚本用 CommonJS + `node:test` 之外的基础 API，**Node ≥ 18**（CI 在 20 上跑）即可 |
| 浏览器版本 | 需要支持 `:has()`、CSS 变量的现代版本：Chrome/Edge ≥ 105、Safari ≥ 15.4（`imageSmoothingQuality` 在旧 Safari 上会被忽略，不影响可玩） |

### 只在 Windows 上可用的部分（都是开发/取证工具，不影响玩游戏）

| 位置 | 说明 |
| --- | --- |
| `references/tools/apk-audit/measure-board.ps1`、`scan-strings.ps1` | PowerShell 脚本，用于量参考截图、扫 APK 字符串；macOS 上可改用 `pwsh`，或直接跳过（`.cjs` 版本的工具都是跨平台的） |
| ~~`references/tools/research/*.cjs` 里写死的 Chrome 路径~~ | **本轮已修**：新增 `references/tools/research/find-chrome.cjs`，自动在 Windows / macOS / Linux 常见安装位置找 Chrome/Chromium/Edge，也支持环境变量 `CHROME_PATH` |
| ~~`references/tools/test-battle.js` 的 canvas 依赖~~ | **本轮已修**：改为多处查找 `@napi-rs/canvas`，找不到就打印 `SKIP` 并正常退出（其余测试不受影响） |

### 一个已知限制：不要用 `file://` 直接双击 `index.html` 当日常玩法

实测（headless Chrome）`file://` 下游戏能启动（108 个图集都加载了），但浏览器会把本地图片视为跨源，任何 `getImageData`/`toDataURL` 都会抛 `SecurityError`（自检里就有一处像素检查因此失败）。所以请用 `node references/tools/serve.js 8080` 起本地服务器，或直接用 GitHub Pages。

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
node references/tools/research/headless-shot.cjs "http://127.0.0.1:8080/references/tools/research/gift-check.html?to=5" out.png --wait '#report-ready' --eval "JSON.stringify(window.__report.check)"              # macOS 式（隐藏滚动条）
node references/tools/research/headless-shot.cjs "同上" out.png --wait '#report-ready' --scrollbars --eval "JSON.stringify(window.__report.check)"   # Windows 式（占位滚动条）
```


---

## 二、发布方式 A：GitHub Pages（最省事，Mac + Windows 打开网址即玩）

仓库里已放好工作流 `.github/workflows/pages.yml`：

1. 推到 GitHub：`git remote add origin git@github.com:<你的用户名>/<仓库名>.git && git push -u origin main`
2. 仓库 **Settings → Pages → Build and deployment → Source 选 `GitHub Actions`**
3. 之后每次推 `main` 都会自动部署，地址形如 `https://<用户名>.github.io/<仓库名>/`
   （也可以在 Actions 页手动 `Run workflow`）

工作流只发布**运行需要的 5 个目录**（`index.html` + `css/` + `js/` + `images/` + `audio/`，约 55 MB）：

- `references/`（含 35 MB 的原 APK）与 `references/tools/`（开发工具、截图证据）**不进站点**——省流量，也避免把原始 APK 公开分发出去（`references/` 本来就在 `.gitignore` 里）。
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
| `squirrel-web-mac-v0.1.3.zip` | `index.html`、`css/`、`js/`、`images/`、`audio/`、`references/tools/serve.js` + `serve.py`、`README.md`、`start-mac.command`、`启动说明.txt` |
| `squirrel-web-win-v0.1.3.zip` | 同上，启动脚本换成 `start-win.cmd` + `start-win.ps1`（两个文件必须在一起） |

启动脚本的行为（`start-mac.command` / `start-win.cmd`）：

1. 先看端口：已经被**带 `/__save` 存档接口**的服务器占着就直接用它；被别的程序占着（例如以前的 `python -m http.server`）就明确报错并**不打开浏览器**，让你换端口（`start-win.cmd 8081`）；
2. 有 Node.js → `node references/tools/serve.js 8080` 起服务器，**等端口真的监听成功**再用浏览器「应用窗口」打开（macOS 没有 Node 但有 `python3` → 走 `serve.py`，同样带存档接口）;
3. 都没有 → 直接打开 `index.html`（并在说明里提醒可能被浏览器限制，进度只能存浏览器里）。

Windows 的 `.cmd` 只是 ASCII 外壳（`cmd.exe` 读 `.cmd` 里的 UTF-8 中文会把中文注释当成命令执行，导致服务器起不来），中文提示与判断逻辑在 `start-win.ps1` 里，打包时两个文件都要带上。

macOS 首次运行 `.command` 需要「右键 → 打开」；如果 zip 解压后没有执行权限，在终端执行一次 `chmod +x start-mac.command`（release 工作流已经 `chmod +x` 后再打包，正常情况不需要）。

> 本地先试一遍：`node references/tools/serve.js 8080`，浏览器打开 `http://127.0.0.1:8080/`。

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
node references/tools/check-asset-paths.cjs          # 资源引用大小写/断链体检
node references/tools/test-state.cjs                 # 存档、成长、道具、每日任务…
node references/tools/test-balance.cjs               # 数值与规则
node references/tools/test-points.cjs                # 升级自由属性点（四项平衡）
node references/tools/test-combat-rules.cjs          # 战斗规则
node references/tools/test-battle-drops.cjs          # 点击拾取
node references/tools/test-main-battle.cjs           # 战斗结算集成
node references/tools/test-extras.cjs                # 竞技/天梯/师徒/排行榜/超级松鼠
node references/tools/test-fusion.cjs                # 装备融合
node references/tools/test-stages.cjs                # 关卡
node references/tools/test-stage-balance.cjs         # 关卡难度平衡回归
node references/tools/test-battle.js                 # 动画回归（可选依赖 @napi-rs/canvas，缺了自动 SKIP）
```

本地等价命令：`npm test`、`npm run check`、`npm run test:battle`。

---

## 六、发布前的自检清单

- [ ] `node references/tools/check-asset-paths.cjs` 全绿（新增素材后最容易踩：**大小写**）
- [ ] `npm test` 全绿
- [ ] `http://127.0.0.1:8080/index.html?test=1` 浏览器自检 21/21、控制台 0 错误
- [ ] 手机上开一次 Pages 地址（竖屏会被画布缩放，纯静态站也能开，只是操作不便）
- [ ] 版本号与 `package.json`、git tag 对齐；Release 说明里写清「怎么启动 / 存档怎么搬」
