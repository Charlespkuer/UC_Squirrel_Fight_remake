# tools/ 目录规范（给 AI Agent）

> 这个目录只放**会被反复用到**的开发工具。
> 历史上这里堆过 125 个一次性探针 / 审计 / 截图脚本，2026-10 被用户整批删掉过一次
> （远端提交「精简 tools/ + 第十八/十九批功能与文档」）。**不要重演。**

## 硬性规则

1. **只做重要且必要的测试。** 改完先跑**已有**套件（`test-*.cjs` / `test-battle.js` /
   `check-asset-paths.cjs`），不要为一次性验证新建 `test-xxx.cjs`，也不要顺手往现有测试里
   多塞几条"顺带断言"。
2. **一次性脚本不许留在 tools/。** 临时的探测 / 测量 / 对比脚本写到 `out/`（已 gitignore），
   用完即删。只有「会长期反复使用」的才配留在本目录。
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

## 新增脚本的门槛（三条都满足才留下）

- 会被反复调用（构建 / 回归 / 发布），而不是只服务某一次改动；
- 无第三方依赖（Node 内置模块优先，与现有 `test-*.cjs` 一致）；
- `node tools/xxx.cjs` 不带参数就能跑，且有合理默认。

## 现有工具的分类（留档，别随意增删）

| 类别 | 文件 |
|---|---|
| 构建 | `build-release.ps1`（**一键出包**：版本号 patch +1 → 清上一版旧包 → exe/安装包/APK → 清 `target\` 等 5~10 GB 缓存；`scripts\打包.cmd` / `scripts\清缓存.cmd` 是它的双击入口 —— 双击入口一律放 `scripts\`，根目录不放 `.cmd`，薄壳会自动挑 pwsh/powershell 并把参数原样转进来）、`build-tauri-app.cjs`（桌面 exe / 安装包）、`build-tauri-web.cjs`（打包前暂存前端）、`build-apk.ps1`（安卓 APK） |
| 回归 | `test-*.cjs`（主题套件）、`test-battle.js`、`check-asset-paths.cjs`（资源引用检查） |
| 数值 / 数据 | `stage-balance.cjs` |
| 指南 | `publish-guide.md`、`tauri-guide.md` |

> 文档类内容不要写在这里：改动要点写进 `docs/更新记录.md`（见 `docs/AGENTS.md`）。
