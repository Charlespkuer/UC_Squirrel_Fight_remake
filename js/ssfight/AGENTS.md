# 经典界面入口

改本目录前读 `.agents/skills/classic-ui-maintenance/SKILL.md`；具体文字、热区或动画问题再按需查
`docs/经典模式-优化与取证Skill.md` 的对应小节。

显示层 `SfRender` 解释已提交的素材；`SfUiMain.toolkit` 提供公共交互件；各 `Sf*` 页面负责接线。
按钮/卡片的共享视觉反馈走 `SfUiFeedback`，数值或导航动作留在页面传入的回调。
局内战斗 / 胜利失败 / 战果 / 开宝箱是 `SfFight`（`ui-fight.js`，素材包 `tags-fight.json`，
由 `node tools/gen-ssfight-ui.cjs --fight` 生成）；战果/续战对话框是 `SfFightResult`。
实际模块及先后关系查 `scripts/index.html`，新增公共件必须先于使用它的页面加载。
数值和持久状态走 `State` API；页面不复制建筑、道具或战斗规则。

## 不要破坏的约定

- `byName()` 反映当前帧；切帧可能替换节点，旧句柄和旧事件注册不能当成新帧的对象。
- 静态页使用可继承的静态策略。冻结只停自动播放，不改帧号；主动动画走 `holdAnim` / `playOnce`，不要靠反复扫树或整页重挂恢复。
- 每个视图独立维护播放与销毁。异步挂载完成后先核对请求是否仍有效；过期视图应销毁，不能覆盖后来进入的页面。
- 文本字段可能直接是带 `__textBox` 的 SVG 节点；访问元素用 `clip.g || clip`。框宽与字号先查文本索引。
- 点击先查路由选中了谁，再改热区；弹层关闭后不应重建仍有效的底页。共用问题修公共层，页面差异留在页面。

相关现有回归是 `node tools/test-ssfight-render.cjs`，用最小 DOM 执行真实 renderer/status；它不证明浏览器字体、布局或动效观感。
涉及数据同时运行对应 `State` / 关卡套件；视觉与生命周期问题按 skill 做定向浏览器验证。
