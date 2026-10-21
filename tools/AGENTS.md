# tools/ 目录规范（给 AI Agent）

> 这个目录只放**会被反复用到**的开发工具。
> 历史上这里堆过 125 个一次性探针 / 审计 / 截图脚本，2026-10 被用户整批删掉过一次
> （远端提交「精简 tools/ + 第十八/十九批功能与文档」）。**不要重演。**

## 硬性规则

1. **只做重要且必要的测试。** 改完先跑**已有**套件（`test-*.cjs` / `test-battle.js` /
   `check-asset-paths.cjs`），不要为一次性验证新建 `test-xxx.cjs`，也不要顺手往现有测试里
   多塞几条"顺带断言"。
2. **一次性脚本不许留在 tools/。** 临时的探测 / 测量 / 对比脚本写到 `out/`（已 gitignore），
   用完即删（`out/` 的保留清单与清理步骤见 `out/AGENT.md`）。只有「会长期反复使用」的才配留在本目录。
   **跑图 / 截图产物同理**：渲染图、对比图、审计截图一律写 `out/`（例：战斗回归的渲染图落
   `out/battle-check/`）。2026-10 曾从 `tools/verification/`（118 张）与 `tools/research/`
   （32 张）清掉 60 MB 这类本地产物 —— 不要往 `tools/` 里再堆 PNG。
3. **不新增 HTML 探针页**（`*-probe.html` / `*-check.html`）。需要交互式验证时先问用户。
4. **一个改动最多加一条用例。** 优先放进主题相符**且体积小**的套件。**严禁**往
   `test-fixes-round.cjs` 这类 600 KB+ 的历史文件里追加，也不要为了"顺手"多断言几条。
   新建测试文件时目标 < 300 行。
5. **一条 `test('中文描述', ...)` 对应一条可感知的规则。** 禁止为凑覆盖率写
   "把 40 个字段全断言一遍"式的用例；概率类断言必须用 `randomGame()` 之类的真随机，
   或显式固定随机流，两者在注释里写清楚。
6. **测试只依赖仓库里的东西。** 游戏数据从 `js/gamedict.js` 读（和 `index.html` 同一个数据源），
   **不要再去读 `references/`**：那只是本机参考资料、不进仓库，CI 检出后根本没有。
   CI（`.github/workflows/ci.yml`）会枚举 `tools/test-*.cjs` 全跑一遍，所以本地跑通不等于
   提交后跑通 —— 新增/改名套件不用改 workflow，但也别让套件依赖本机文件。
7. **读源码做文本断言时先把 CRLF 归一成 LF。** 抠函数体 / 数出现次数 / 「切行 + `/^...$/`」
   这类断言一律走 `readFileSync(...).replace(/\r\n/g, '\n')`（`test-fixes-round.cjs` 里的
   `readSrc()` 就是干这个的）。Git for Windows 默认 `core.autocrlf=true`，Windows 检出会把
   LF 变成 CRLF，行尾多出来的 `\r` 会让锚定正则全部打空 —— 这是「本机绿、Windows 红」的经典
   原因（2026-10 `需求71` 就这么挂过一次）。另外清临时目录的 `fs.rmSync` 记得带
   `maxRetries`：Windows 上刚退出的子进程可能还占着文件。

## 新增脚本的门槛（三条都满足才留下）

- 会被反复调用（构建 / 回归 / 发布），而不是只服务某一次改动；
- 无第三方依赖（Node 内置模块优先，与现有 `test-*.cjs` 一致）；
- `node tools/xxx.cjs` 不带参数就能跑，且有合理默认。

## 现有工具的分类（留档，别随意增删）

经典界面定位：`node tools/ssfight-index.cjs` 默认列当前加载链与 API；`--name info1,expNum` / `--id 4756` 查询已提交的元件与文本索引，`--code routerOf` 给当前代码位置。纯 Node 只读查询，不产生文件、不依赖 `references/`。

| 类别 | 文件 |
|---|---|
| 构建 | `build-release.ps1`（**一键出包**：版本号 patch +1 → 清上一版旧包 → exe/安装包/APK → 清 `target\` 等 5~10 GB 缓存；`scripts\打包.cmd` / `scripts\清缓存.cmd` 是它的双击入口 —— 双击入口一律放 `scripts\`，根目录不放 `.cmd`，薄壳会自动挑 pwsh/powershell 并把参数原样转进来）、`build-tauri-app.cjs`（桌面 exe / 安装包；`--web` / `--web --check` = 生成 / 校验前端快照 `src-tauri/web`）、`build-apk.ps1`（安卓 APK；出包前对账 APK 内 versionName/versionCode，出包后 apksigner 复检 v1+v2+v3，缺档用 debug 密钥补签）、`build-ios.cjs`（iOS 未签名 IPA；`--check` 只查环境，默认出 iOS 26+ 的 `..._ios_unsigned.ipa`，`--legacy` 出 iOS 15~25 的 `..._ios_legacy_unsigned.ipa`） |
| 回归 | `test-*.cjs`（主题套件）、`test-battle.js`、`check-asset-paths.cjs`（资源引用检查）、`check-encodings.cjs`（文本编码 / `.ps1` BOM 体检，CI 也跑） |
| 全流程对账（**不是** `test-*.cjs`，所以不进 CI：跑一次几分钟，按需手跑） | `verify.cjs` —— 三个验证合在一个入口：`story`（剧情机器人：从第 1 层爬到上千层，逐条核对 `docs/剧情触发条件.md`）、`layer100`（整百层那两段的定向回归：22 种「进层前」局面 × 轮数）、`stacking`（同名叠加审计：叠层 / 上限 / 效果随层数放大） |
| 数值 / 数据 | `stage-balance.cjs`、`gen-vendor-data.cjs`（从 `references/orig/` 重新生成 `js/gamedict.js`；**非运行时**，缺参考目录时明确报错） |
| 经典模式素材 + **索引** | `gen-ssfight-ui.cjs`（从原版整片导出提素材到 `images/ssfight/ui/`；**顺带产出两张索引**：`textfields-index.json` = 每个文本字段的框宽/字号/每行几个全角字，`symbol-index.json` = 具名元件 → 元件号/帧数/出现在宿主第几帧）、`gen-ssfight-textfields.cjs`（文本字段元数据 `textfields.json`，**是上面那张索引的框宽来源**）。改经典界面前先查这两张表、别开浏览器 —— 用法见 `docs/经典模式-优化与取证Skill.md` |
| 指南 | `build-guide.md`（构建与发布：上半篇 = 跨平台运行 / GitHub 发布流程，下半篇 = 桌面壳 Tauri 编译） |

> `verify.cjs` 是 2026-10 第一百零一批加的三个验证工具（用户要求「充分测试 + 写应当条件文档并与实测对照」），
> 第一百零四批**合并成一个入口**（三个原来各带一套一模一样的 vm 引导）；它是**长期要反复跑**的验证工具，
> 所以按上面的门槛留在 `tools/`；一次性探针仍然写 `out/`、用完即删。
> 命名故意不带 `test-` 前缀 —— CI 枚举的是 `tools/test-*.cjs`，它跑一轮要几分钟，交给人工按需跑。
> 同一批还把 `publish-guide.md` + `tauri-guide.md` 合成 `build-guide.md`、
> 把 `build-tauri-web.cjs` 并进 `build-tauri-app.cjs --web`（9 个文件 → 3 个）。

> ⚠️ **别用 PowerShell 的文本 cmdlet 改源码**：`Get-Content` / `Set-Content` / `Add-Content` 在没有
> BOM 的文件上会按系统 ANSI（中文机器 = GBK）解码再写回，**中文会被写坏成乱码 / 非法 UTF-8**
>（2026-10 真踩过两次：一次把 `js/tower-plot.js` 整份写坏、一次把 `js/debug.js` 的注释写坏）。
> 改文件一律用编辑工具（或 Node 读写 Buffer）；确实要用 PowerShell 复制/删除才用 `Copy-Item` / `Remove-Item`。

> ⚠️ **`.ps1` 含中文就必须带 UTF-8 BOM**（另一回事：文件本身是合法 UTF-8，但 **Windows PowerShell 5.1
> 对没有 BOM 的 `.ps1` 按 ANSI 解码**，中文变乱码、甚至把注释块/字符串里的引号拆坏 → 整个脚本解析失败）。
> `打包.cmd` 在没有 pwsh 的机器上正是回退到 5.1，所以这条直接决定出包能不能跑。
> **编辑工具重写 `.ps1` 时会把 BOM 抹掉**（2026-10 就是这样把 `tools/build-release.ps1` 弄出 27 个语法错的），
> 改完 `.ps1` 一定复查：`node tools/check-encodings.cjs`（CI 也跑它；它会指出「含中文却没有 UTF-8 BOM」，
> 并给出补 BOM 的一行命令）。

> 文档类内容不要写在这里：改动要点写进 `docs/更新记录.md`（见 `docs/AGENTS.md`）。
