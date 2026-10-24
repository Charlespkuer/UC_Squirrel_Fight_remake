# 经典模式优化与取证参考

经典界面维护的统一入口是 `.agents/skills/classic-ui-maintenance/SKILL.md`。
本文只保留按问题查阅的方法与容易误判的语义；模块和行号由查询工具实时给出，不抄目录树。
变更记录仍只写 `docs/更新记录.md`。

## 索引与代码定位

```sh
node tools/ssfight-index.cjs
node tools/ssfight-index.cjs --name info1,info2,expNum
node tools/ssfight-index.cjs --page challenge --id 4756 --code fitText
```

无参数列 `scripts/index.html` 的当前经典脚本加载顺序、导出 API 和素材包。
名字查询优先精确匹配，否则做包含匹配；保留不同包的同名结果。
id 同时查元件与宿主；代码查询优先找声明，找不到声明才给引用。结果有截断标记，可用 `--limit` 调整。

素材定位先查 `images/ssfight/ui/symbol-index.json` 的名字、id、owner、inFrames；
文字尺寸查 `textfields-index.json`。旧 `elements.json` 只覆盖 main 页。
`view.byName()` 只在当前帧有效，查询命中后还要核对宿主和帧。
不要先 grep 整包 `tags-*.json`，也不要把索引未命中当成原版没有素材。

确需核对原版时，从 `MainMovie.as` 的具名访问（如 `mc_tab1.t_base`）反查容器，
再按内容与帧结构确认。中文符号表名或 `None` 前缀不能单独证明元件存在或缺失，
H5 标签按 id 保存；历史符号表还出现过名字对应错误 id 的情况。
`references/` 只作本机取证资料，运行时与回归不依赖它。
只有改素材提取规则时才运行 `node tools/gen-ssfight-ui.cjs`；普通界面修复不用重生成整库。

## 文字与数值

先看字段的 `boxW / boxH / fontId / fontH / charsPerLine / heldBy`，再决定断行或缩短文案。
`charsPerLine` 是全角字符容量估计，不是任意字符数：中文约一 em，ASCII 约半 em。
当前字段并非只用一个字体；字体回退与混排仍需按实际字段核对。
`canvas.measureText` 在无头环境可能使用不同回退字体，不能仅凭它推翻索引。
必须量像素时，用已渲染字行的屏幕宽度与字符数校准。

文本句柄可能直接是带 `__textBox` 的 SVG `<g>`，并非 MovieClip。
取 DOM 元素用 `clip.g || clip`；不要默认每个文本都有 `clip.g` 或 `gotoAndStop`。
当前文本裁剪限制横向框宽，纵向溢出可能盖住下方按钮；自动换行还要检查行数和实际可用高度。

数字不对先对照 `State` API 的真实值与页面写入值，再追渲染。
例如四维字段是 `power/agility/speed/hp`，不要假设存在 `maxHp`。
素材可能带 `999999/999999`、`900000` 等占位串；挂载异步完成前的中间帧不是业务真值。
先确认当前节点仍连接、挂载仍属于当前页面，再判断“写入没生效”。

## 热区与层次

点击的实际归属由 SVG 上的路由决定；热区矩形只是测量和登记依据。
先问路由命中了谁，再改元件自己的 pointer 事件或扩大热区。
透明热区中心可能偏离可见画稿中心，尤其是翻页箭头压在相邻卡片旁时。

一次观测同时取得可见画稿、热区和命中对象，避免分轮猜测：

```js
const clip = view.byName('right');
const el = clip.g || clip;
if (!el.isConnected) throw new Error('句柄已过期');
const svg = el.ownerSVGElement;
const bounds = el.getBoundingClientRect();
const art = el.querySelector('path')?.getBoundingClientRect();
const pick = svg.__sfRouter?.hit(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
```

`popWrap()` 首次把画稿移入持久的 content host；后续时间轴更新通过 `getContentHost()` / `placeFrameNode()` 放置内容，保留反馈壳与运行时挂载的画序。不要切帧后把子节点重新搬回根 `<g>`。
量画稿必须排除所有后代 `rect[data-hit]` 并在 `finally` 恢复；`addHitArea()` 只复用本 clip 的 `__hitArea`，不能借用子按钮的热区，否则反复刷新会累积放大。
页面全空也要先查 CSS 父级的 `display`、可见性与模式类；例如首页隐藏规则不能同时隐藏
`.ssfight-view` 的挑战/状态页面。路由、节点身份与可见性应一起核对。

## 静态页与生命周期

MovieClip 默认自动播放；原版靠页面动作停在选定帧。
静态页挂载后使用 `SfUiMain.toolkit.freezeDescendants(view)` 声明继承策略，
由新实例的出生路径应用，而不是每次切 tab 后另扫一遍。
冻结表示 `playing=false`，不能把所有元件拨回第一帧；`pinFrame` 只用于真正锁定帧的对象。

主动动画使用 `holdAnim` / `playOnce`，持续装饰动画走公共白名单。
数字精灵的空档是末帧，第一帧通常是数字零。
测量时临时切帧、`attachChild`、`setSymbol` 和弹层都应保持同一静态策略。
`setSymbol()` 更换符号前清理旧运行时附件；切帧或测量重建数字后，同步写回当前业务值，再交给下一次绘制，不能等一秒轮询来修正占位零。

播放注册按视图隔离。销毁覆盖层不能停止底页；关弹层也不靠整页重挂恢复。
异步加载完成后检查请求代次和容器是否仍有效，过期结果应销毁，不能抢回新页面。
`SfRender.debug()` 可按 uid 比较帧号；静态页不应出现无意自播，
首页的角色与明确保留的装饰动画则不能按同一条件误报。

## 浏览器取证

先跑静态查询，再把确实需要浏览器的问题合成一次观察：
检查当前页面、节点连接性、文本和矩形，随后核对路由命中与切页结果。
等待真实条件（页面 API/元件出现、挂载完成、战斗结束），不要用固定 sleep 断定界面稳定。
节点断言失败先修探针；换帧后的旧句柄不能当作“按钮坏了”的证据。
测试自行挂载的视图测完要销毁，已有页面视图不能被探针随手销毁。

开发服务从仓库根运行 `node scripts/serve.js 8099 --no-save`，入口映射到 `scripts/index.html`。
使用当前可用的浏览器工具；旧 `out/drive.cjs` 是临时探针，不假定它在新检出中存在。
临时脚本、截图和浏览器 profile 放 `out/`，用完清理；不新增 HTML 探针页。

## 验证范围

先跑 `node tools/test-ssfight-render.cjs`。它以最小 DOM 执行真实 renderer 和 status 页面代码，覆盖帧切换、挂载与热区等行为；这仍不能证明真实浏览器的字体、布局或动效观感。
改数据规则时再跑对应现有的 `test-state.cjs`、`test-stages.cjs` 等主题套件；
检查资源和编码分别用 `check-asset-paths.cjs`、`check-encodings.cjs`。

视觉问题定向复测该页的进入、返回、切帧及快速切页；新出现的实际可感知规则才值得补回归。
新增用例或长期工具的限制见 `tools/AGENTS.md`，不要为一次性取证扩张测试目录。
