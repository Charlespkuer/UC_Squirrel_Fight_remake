# 项目入口

这是按 `<script>` 顺序加载的单机网页游戏；入口是 `scripts/index.html`，不是仓库根的 `index.html`。
先定位任务对应的模块，不要先读整仓或历史更新记录。
经典界面可先运行 `node tools/ssfight-index.cjs` 查看当前加载链与 API，再用 `--name` / `--id` / `--code` 定向查询。

- 经典界面、原版元件、文字/热区/动画：读 `js/ssfight/AGENTS.md`，使用项目 skill `.agents/skills/classic-ui-maintenance/SKILL.md`。
- 存档、背包、货币、建筑与日常规则：从 `js/state.js` 的 `State` API 查起；页面调用 API，不另存一套数值。
- 战斗与数值：`js/battle.js`、`js/sim.js`；字典源是已提交的 `js/gamedict.js`，派生规则在 `js/gamedata.js`。
- 无尽塔：`js/tower.js` / `js/tower-ui.js`；剧情改动先读 `docs/剧情触发条件.md`，实现是 `js/tower-plot.js`。
- 运行与打包：`scripts/serve.js`、`tools/build-guide.md`。页面脚本和 CSS 的实际加载顺序以 `scripts/index.html` 为准。
- 双击入口与双机同步（一键同步、端口、日志）：读 `scripts/AGENTS.md`；桌面 / 安卓壳：读 `src-tauri/AGENTS.md`。
- 运行时素材目录：读 `images/AGENTS.md`；本机参考资料（`references/`，不进仓库、先拷贝出来再消费）：读 `references/AGENTS.md`。

## 资料与验证

经典素材和索引在 `images/ssfight/ui/`，运行时及测试不依赖本机 `references/`。
查不到生成索引时先核对索引覆盖范围；不要直接把“未命中”解释为“没有素材”。

修改工具或回归用例前读 `tools/AGENTS.md`。先运行相关现有套件；资源/编码检查分别是
`node tools/check-asset-paths.cjs`、`node tools/check-encodings.cjs`。
临时脚本、截图和浏览器 profile 放 `out/`；任务收尾按 `out/AGENT.md` 的清理规范清掉本轮产物（只留表列的那几件长期工具），清之前先确认没有别的会话在用；不新增 HTML 探针页。
编辑 UTF-8 源码用编辑工具或 Node，不用 PowerShell 文本 cmdlet 写回。

文档遵守 `docs/AGENTS.md`：不新增过程报告，变更只追加 `docs/更新记录.md`，最新批次在最上面。
这些 agent 入口只承担路由，不据此扩展文档数量。
