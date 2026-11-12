# 项目入口

这是按 `<script>` 顺序加载的单机网页游戏；入口是 `scripts/index.html`，不是仓库根的 `index.html`。
先定位任务对应的模块，不要先读整仓或历史更新记录。
经典界面可先运行 `node tools/ssfight-index.cjs` 查看当前加载链与 API，再用 `--name` / `--id` / `--code` 定向查询。

- 经典界面、原版元件、文字/热区/动画：读 `js/ssfight/AGENTS.md`，使用项目 skill `.agents/skills/classic-ui-maintenance/SKILL.md`。
- 存档、背包、货币、建筑与日常规则：从 `js/state.js` 的 `State` API 查起；页面调用 API，不另存一套数值。
- 战斗与数值：`js/battle.js`、`js/sim.js`；字典源是已提交的 `js/gamedict.js`，派生规则在 `js/gamedata.js`。
- 无尽塔：`js/tower.js` / `js/tower-ui.js`；剧情改动先读 `docs/剧情触发条件.md`，实现是 `js/tower-plot.js`。
- 运行与打包：`scripts/serve.js`、`tools/build-guide.md`（**标准打包流程**在该文件顶部，发版/打包前先读）。页面脚本和 CSS 的实际加载顺序以 `scripts/index.html` 为准。
- 双击入口与双机同步（一键同步、端口、日志）：读 `scripts/AGENTS.md`；桌面 / 安卓壳：读 `src-tauri/AGENTS.md`。
- 运行时素材目录：读 `images/AGENTS.md`；本机参考资料（`references/`，不进仓库、先拷贝出来再消费）：读 `references/AGENTS.md`。

## 资料与验证

经典素材和索引在 `images/ssfight/ui/`，运行时及测试不依赖本机 `references/`。
查不到生成索引时先核对索引覆盖范围；不要直接把“未命中”解释为“没有素材”。

修改工具或回归用例前读 `tools/AGENTS.md`。先运行相关现有套件；资源/编码检查分别是
`node tools/check-asset-paths.cjs`、`node tools/check-encodings.cjs`。

会出声的验证先在**环境层**静音：安卓模拟器一律带 `-no-audio` 启动，Chrome 带 `--mute-audio`，
桌面壳与真机先关系统媒体音量，测完恢复；只有要验音频才单独放开。别用游戏内「静音」顶替 ——
`settings.muted` 会写进玩家存档。

临时脚本、截图和浏览器 profile 放 `out/`；任务收尾按 `out/AGENT.md` 的清理规范清掉本轮产物（只留表列的那几件长期工具），清之前先确认没有别的会话在用；不新增 HTML 探针页。
编辑 UTF-8 源码用编辑工具或 Node，不用 PowerShell 文本 cmdlet 写回。

文档遵守 `docs/AGENTS.md`：不新增过程报告，变更只追加 `docs/更新记录.md`，最新批次在最上面。
这些 agent 入口只承担路由，不据此扩展文档数量。

## 注释规范（唯一口径）

注释只写**代码本身表达不了的约束**，给下一个 agent 改代码时避坑；不写历史、不写用户原话、不写“这段在做什么”。

保留（一条最多 3 行，优先 `//`）：

- 不变量 / 调用顺序 / 唯一真值：谁必须先于谁、哪个字段只能有一个写入口。
- 跨文件耦合：改这里必须同步改 X（加载顺序见 `scripts/index.html`；数值/存档走 `State` API；经典素材走 `SfRender`）。
- 平台或运行时坑：iOS / Android / WebView、缓存、异步生命周期、缩放与裁切。
- 数据来源：生成文件、原版元件号、`images/ssfight/ui/` 导出物。
- 安全 / 权威边界：单机存档与数值的唯一真值是 `State`，页面不得另存一套；不可信输入要标明。

删除：

- `/* ===== */`、`/* ---- */` 横幅、章节号、【UC1】/【U17】目录、Ctrl+F 索引。
- “以前 / 原来 / 旧版 / 用户 2026-xx 口径 / 报的 bug / 第 N 批”等历史叙述和用户原话。
- 复述代码的 JSDoc / 行内注释、被注释掉的代码、过时引用。
- 面向人的排版说明、日期、署名、emoji 强调（`⚠` 只用于真陷阱）。

格式：

- 文件头最多 2 行：文件名 + 生成 / 不要手改（如适用）。
- 局部注释用 `//`；只有跨多行契约才用 `/* */`，且不超过 3 行。
- 需要标签时用 `// TRAP:` / `// CONTRACT:` / `// WHY:`，不要自造标签。
- 改代码时顺手删掉不再成立的注释；注释与代码冲突时以代码为准，先改注释再改代码。

各子目录 `AGENTS.md` 只写本目录特有的坑，不重复本节。
