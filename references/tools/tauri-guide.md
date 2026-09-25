# 桌面版（Tauri）：一个几 MB 的原生窗口，前端直接用游戏目录里的文件

> 目标有两层：**双击就是独立窗口**（不用浏览器），以及**本地尽量轻**。
> 现在仓库里有两种产物，平时用第一种：

| 方案 | 产物 | 本地占用 | 前端从哪来 | 用在哪 |
| --- | --- | --- | --- | --- |
| **轻壳**（默认） | `src-tauri/dist/ssdz-classic.exe`，**2.86 MB** | exe 一个文件（`target/` 编译缓存可用 `--clean` 回收） | **游戏目录里的 `index.html` / `css` / `js` / `images` / `audio`**：外壳启动时自己起一个迷你 HTTP 服务器供起来 | 本机玩、便携包旁边玩 |
| **安装包** | `松鼠大战怀旧版_0.1.3_x64-setup.exe`，47 MB | 打完自动删掉临时的 `web/` | 编译进二进制（旁边没有游戏目录也能跑） | 发给别人装 |

轻壳不复制、不嵌入任何前端资源，所以：

* **改了 `css/` `js/` `images/` 后，重开窗口就是新的**——桌面版和网页版天然同一套代码，不存在「app 里是旧前端」的问题；
* 存档走和网页版**完全一样**的 `/__save`（写 `<游戏目录>/save/progress.json`），也不再需要 Node.js / Python；
* 内存占用也更低（实测 39 MB，旧的内嵌版 62 MB）。

---

## A. 双击入口

`E:\松鼠大战怀旧版\启动游戏.cmd` —— 优先开原生窗口，找不到原生版或它连开三次都没稳住，
才退回「起服务器 + 浏览器应用窗口」。已经开着一个桌面版时再双击只会提示「已经在运行」。

原生版按这个顺序找：`src-tauri\dist\ssdz-classic.exe` → `src-tauri\target\release\ssdz-classic.exe`
（macOS 是 `.app` 包或 `src-tauri/dist/ssdz-classic`），加 `--browser` 可强制走浏览器路线。

```bash
# macOS / Linux
bash references/tools/launchers/start-mac.command
bash references/tools/launchers/start-mac.command --browser

# Windows
references\tools\launchers\start-win.cmd            # 或直接双击 启动游戏.cmd
references\tools\launchers\start-win.cmd 8080 --browser
references\tools\launchers\start-win.cmd --no-save
```

Windows 侧是 `start-win.cmd`（纯 ASCII 外壳）+ `start-win.ps1`（真正干活的部分）两个文件——
cmd.exe 读 `.cmd` 里的 UTF-8 中文会把中文字节错位、把中文注释当命令执行
（实测报 `'，其次' is not recognized`），于是**服务器没起来、浏览器却已经打开**，
正好复现「没有本地服务器接口」。外壳保持 ASCII、中文与判断交给 PowerShell 就没这问题。

## B. 轻壳是怎么工作的

```
双击 启动游戏.cmd
   └─ start-win.ps1：找到游戏目录 → 起 dist/ssdz-classic.exe（cwd=游戏目录）
        └─ Rust 外壳（src/main.rs，约 17 KB 源码，标准库实现迷你服务器）
             ├─ 找游戏目录：SSDZ_GAME_DIR → 当前目录 → 从 exe 往上找，都要求有 index.html
             ├─ 起本地服务器：127.0.0.1 的**随机端口**（不会和网页版的 8080 撞车）
             │    · 静态文件：直接读游戏目录（含 MIME、keep-alive、挡 ../ 越界）
             │    · /__save：与 references/tools/serve.js 语义一致（GET / ?meta=1 / POST）
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
node references/tools/build-tauri-app.cjs            # 编译 → src-tauri/dist/ssdz-classic.exe
node references/tools/build-tauri-app.cjs --clean    # 同上，然后 cargo clean（回收 target/）
node references/tools/build-tauri-app.cjs --installer # 另打 NSIS 安装包（临时暂存 web/，打完自动删）
```

实测（Windows 11、rustc 1.98.1、16 核）：

| 项目 | 轻壳 | 安装包 |
| --- | --- | --- |
| 产物 | `dist/ssdz-classic.exe` **2.86 MB**（旧的内嵌版是 48.91 MB + 0.14 MB dll） | `松鼠大战怀旧版_0.1.3_x64-setup.exe` **47.02 MB** |
| 编译 | `cargo build --release` 首次约 1 分 20 秒~2 分 24 秒 | 再 +1 分钟打包 |
| 中间产物 | `target/` 实测 **3.4 GB**（依赖树 + 调试符号）→ `--clean` 一键清零 | 同上 |
| 运行时内存 | 39 MB | 62 MB |
| 需要 Node/Python | 不需要（存档由 Rust 写） | 不需要 |

**关于空间**：那 3.4 GB 全在 `src-tauri/target/`，是「编译一次就有、删掉也不影响运行」的缓存；
真正要留的只有 2.86 MB 的 exe（放在 `src-tauri/dist/`，已进 `.gitignore`）。
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
├─ app-icon.png            1024×1024 透明背景松鼠（由 refine-classic-icons.py 生成）
├─ package.json            app / app:clean / installer / dev / icon 脚本
├─ src/main.rs             迷你文件服务器 + 找游戏目录 + 存档命令 + 开窗口
├─ empty/index.html        只有几百字节：找不到游戏目录时显示的提示页
├─ dist/ssdz-classic.exe   ← 构建产物（几 MB，不进版本库）
├─ web/                    ← 只有打安装包时临时生成（不进版本库）
└─ icons/                  ← npx tauri icon app-icon.png 生成（不进版本库）
```

`app-icon.png` 改了之后要跑一次 `npx tauri icon app-icon.png` 重生成 `icons/`
（`.ico` / `.icns` 都带 alpha），安装包和窗口图标才会跟着变。

## F. 想确认窗口里跑的是哪一版前端

轻壳读的就是游戏目录里的文件，理论上不会旧；要核对（或排查问题时）可以问它一句：

```powershell
# 1) 带调试端口启动
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
src-tauri\dist\ssdz-classic.exe
# 2) 另开终端
node references/tools/research/tauri-inspect.cjs 9222 "location.href + ' | ' + State.fileInfo().mode + ' | ' + State.fileInfo().path"
# → http://127.0.0.1:1362/index.html | file | save/progress.json
```

## G. 用 GitHub Actions 打包（本机不需要 Rust）

`.github/workflows/tauri.yml`：手动触发只产出构建工件；推 `v*` 标签会在
`macos-latest` / `windows-latest` 上各打一份安装包并挂到 Release。步骤是
安装 Rust → 暂存前端（`build-tauri-web.cjs` + `--check`）→ `tauri icon` →
`tauri-action` 带 `--config tauri.bundle.conf.json` 构建（**安装包这一版才需要嵌前端**）。

## H. 平台差异与注意事项

1. **WebView 引擎不同**：macOS 用系统 WKWebView、Windows 用 WebView2（Chromium）。
   换成桌面窗口**不会**消除排版差异——`scrollbar-gutter: stable` 那套修复仍然必要
   （见 `publish-guide.md`）。想要两端像素一致只能用自带 Chromium 的方案（Electron/CEF），
   代价是包体 120~200 MB。
2. **macOS 未签名**：不做签名与公证时首次要「右键 → 打开」；Windows 未签名会有 SmartScreen 提示。
3. **窗口尺寸**：默认 1216×760（游戏设计尺寸 1170×690）。游戏内部按
   `documentElement.clientWidth/Height` 等比缩放，改窗口大小会自动适配。
4. **不要同时开两个实例**写同一份存档：桌面版和浏览器版共存时，最后写入的那份覆盖前面的
   （启动器已经拦了「重复双击」，但浏览器那边开着的话仍要注意）。
5. **轻壳需要游戏目录**：把 `ssdz-classic.exe` 单独拷到别处、旁边没有 `index.html` 时，
   窗口会显示「没找到游戏目录」的提示页；想发给别人就用 `--installer` 打的安装包。

## I. 前端要改吗

不用改渲染，只有存档通道是「可插拔」的：

```js
// 网页版 / 轻壳：走本地服务器的 /__save（同一个文件、同一套逻辑）
// 安装包模式（tauri://localhost）：js/tauri-bridge.js 换成 Rust 命令
State.setSaveTransport({ label, probe(), read(), write(json) });
```

任何别的宿主（自建服务端、Electron、手机壳）都可以照这个接口接上，存档的时间戳比较与冲突保护不用重写。
