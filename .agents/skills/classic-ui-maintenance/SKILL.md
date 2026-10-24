---
name: classic-ui-maintenance
description: 定位和维护松鼠大战经典界面的原版元件、文本、热区、动画与页面生命周期。用于 js/ssfight 和经典界面接线；纯战斗数值或存档规则从对应模块与现有套件入手。
---

# 经典界面维护

目标是先用已提交的代码与素材索引找到改动点，把浏览器留给必须观察的行为。

## 选入口

先运行 `node tools/ssfight-index.cjs`；它从 `scripts/index.html` 读取当前加载链和导出 API，不存固定行号。
以全局 API 定位职责：

- `SfRender`：素材加载、MovieClip、SVG 文本、静态策略、播放表与视图销毁。
- `SfUiMain.toolkit`：热区测量、点击路由、交互壳、数字精灵与公共页面交互。
- `SfUiFeedback`：DOM/SVG 按钮或卡片的悬停、按下、选中与延迟动作反馈；不在各页再抄一套计时器。
- `SfFightResult`：竞技续战、天梯、关卡与普通战果的原版容器；只接展示内容和既有动作，结算留在调用方。元件入口及来源查 `images/ssfight/ui/fight-result-manifest.json`，增量素材命令为 `node tools/gen-ssfight-ui.cjs --fight-result`。
- `SfUiMain` / `SfVillage`：首页/村庄及地点页；`SfStatus`：状态、武器技能与好友装备；`SfChallenge`：挑战、好友、关卡与竞技场接线。
- 经典顶层入口和页面切换从 `js/classic-ui.js` 查；道具、建筑等数值由 `State` 提供。以加载链为准查拆分后的页模块。

## 先查静态证据

元件名、id、宿主与出现帧查 `images/ssfight/ui/symbol-index.json`；文本框宽、字号、字体及容量估计查同目录 `textfields-index.json`。
用 `node tools/ssfight-index.cjs --name info1,expNum` 一次查询多个名字，或 `--page challenge --id 4756` 查宿主下的元件和文本。
代码入口用 `--code openBag,routerOf`，优先返回当前声明位置；范围为 `js/ssfight/` 与三个 `classic-ui/extras/fusion` 模块，可与素材查询合并调用。
`elements.json` 只覆盖 main 页。索引找不到名字时先查包与宿主，不遍历所有 `tags-*.json`，也不据此宣称素材不存在。

同名元件可能出现在不同包：例如 `expNum` 在 status 是文本，在 main 是精灵。保留包、宿主和帧条件一起判断。
只有必须核对原版接口或索引遗漏时才读本机 `references/`；它不属于运行时或 CI 的依赖。

按问题读取 [取证参考](../../../docs/经典模式-优化与取证Skill.md)：

- 文字截断、换行或越框：读“文字与数值”。
- 点击无反应或点错对象：读“热区与层次”。
- 切页乱跳、弹层闪屏或异步旧页面回来：读“静态页与生命周期”。
- 静态证据不能解释的表现：读“浏览器取证”，一次检查相关文本、热区、节点身份和页面状态。

## 修改与验证

同类问题先定位公共层；不要为每页重复加冻结、重挂或延时补丁。页面调用 `State` 的规则与返回消息，避免维护第二份业务真值。
时间轴内容走持久 content host；热区测量排除所有后代 `data-hit`，本 clip 只复用自己的 `__hitArea`。切帧重建数字后同步 hydrate 当前值，不等轮询补正。具体语义见取证参考。

先跑 `node tools/test-ssfight-render.cjs`；数据/奖励改动再跑对应现有 `test-state.cjs`、`test-stages.cjs` 等主题套件。
资源引用或文本编码变化用现有 `check-asset-paths.cjs`、`check-encodings.cjs`。
显示层套件会用最小 DOM 执行真实 renderer/status，仍不能代替浏览器字体、布局与观感验证。需要浏览器时用条件等待，并验证返回、快速切页和异步完成后的当前页面。

新增工具或用例遵守 `tools/AGENTS.md`；临时探针与截图放 `out/`，不建过程报告。
本 skill 只保存可复用方法，改动记录由 `docs/更新记录.md` 统一维护。
