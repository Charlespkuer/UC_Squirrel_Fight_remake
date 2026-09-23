# 原始客户端研究记录

研究日期：2026-09-23。本记录用于开发取证，不把 Android 高清客户端误认为用户截图中的经典 2D 客户端。

## 来源与可复现文件

- 用户允许访问的 `E:/squirrel fight1/uc松鼠大战电脑版 PC版/` 中存在隐藏文件 `h5ssdz_9game_4230.apk`，35,572,039 字节。它是 ZIP 格式，不需要运行目录中的 EXE。
- APK 中 `assets/game.zip` 为 33,105,511 字节，含原始 JavaScript 客户端、完整图片与音频。
- 将 game.zip 的 images/audio 文件逐路径与当前项目比较，**没有发现当前项目缺失的文件**。本次修复前 README 所称缺失的旧图集，原 APK 自己也没有包含。
- `System/` 文件夹为空，未发现 SWF 或额外旧版客户端。
- 原脚本提取到 `tools/research/original/`。`js/ssdz-pkg2.js` 已仅做 Prettier 格式化，原始压缩代码仍可从 APK 重取。
- `tools/research/original-ui-coordinates.json` 对 51 个模块中的 1,490 处静态贴图调用建立索引。它包含弹窗和条件分支，并不代表所有贴图会同时显示。
- `tools/research/extract-ui-coordinates.cjs` 可重新生成坐标索引。
- `tools/extract-ui-assets.py` 可重新生成已导出的独立 PNG；依赖 Pillow 和 Node.js，仅执行项目内原始数据表，不执行原游戏客户端。
- `images/classic/manifest.json` 为导出文件逐项记录原始文件、裁剪矩形、原帧号和名称。

## 原脚本位置

以当前已格式化的 `tools/research/original/js/ssdz-pkg2.js` 为准：

- `BitmapFactory`：约 2970–3218 行，`getIndexImageData` 为 3133 行，装备命名为其后 `getEquipImageData`。
- `Main`：8379–9904 行。
- `Info`：7534–8160 行。
- `Mission`：10963–11640 行。
- `MyEquipment`：11643–12452 行。
- `MyProps`：12455–14102 行。
- `MyWeapon`：14105–16099 行。
- `Skill`：19138–19946 行。
- `Arena`：约 550–840 行，`ArenaExp` 和竞技对阵紧随其后。

## 版本差异与研究初期发现

本节记录 2026-09-23 开始核对时发现的问题及原始证据，用于解释修复依据；其中关于旧代码的描述不代表当前实现仍保留这些错误。

本次已修复经典界面的素材选择与图标索引：首页改用导出的独立素材及经典参考图，不再依赖旧首页的跨图集映射；武器、技能按彩色/灰色交错行及真实技能 ID 导出。旧兼容代码中仍保留 `shouyebiao` 别名，不能把它作为原版资源对应关系的证据。README 的缺图和坐标说明也已重写。

参考截图展示的是描边鲜明的经典 2D 松鼠与浅色蘑菇村庄。APK 中 `main.jpg`、角色图集和 NPC 肖像属于高清重制风格。APK 能提供真实数据、逻辑和按钮含义，但其整个首页布局与参考截图不相同。

修复前 `engine.js` 的 `SOURCE_ALIAS.shouyebiao = images/resource_1.png` 没有原始客户端依据：`shouyebiao` 是遗留帧表，而完整 Main 实际直接使用 resource_1。两个帧表矩形不同，不能把标签跨表混用。

武器与技能图集使用交错的彩色/灰色行。原始索引算法为：列数 = 图宽 / 165；index = id - 1；x = (index % 列数) × 165；y = floor(index / 列数) × 330；未学习时 y 再加 165。旧 UI 的连续格号裁剪会从第二行开始错图。

已直接检查 jineng.png，技能 23「幸运一击」为 (165,990,165,165)，技能 24「致命反击」为 (330,990,165,165)，灰色版本 y=1155。不存在 23→18、24→19 的重排。

原 MyProps 使用常规连续格，id>100 时先减 44，最后 index=id-1。图集自身保留一些已弃用的空白格（如道具 6、9）；道具 50「抽奖券」在旧数据表和图集中存在版本不一致，直接原算法得到的是「力+」图元，不应把该图强行称为抽奖券。导出保留原算法并明确记录来源。

## 可重用首页素材

resource_1 帧 0 为体力绿色填充，1 为经验填充，2 为两者公共底框；5 为 Lv 框；7 为首页按钮底座；9 为物品等级小框；12 为资料图标；13 为道具图标；14 为战斗图标；15 为齿轮；16 为消息；18 为金松果；42 为全屏页返回；43 为弹窗关闭；17 为宽确认按钮。

原 HD 首页上这些元素的坐标：体力条 (82,98)，经验条 (389,98)，玩家名 (38,50)，Lv 框 (288,55)，金币框 (964,56)，松果图标 (953,35)；道具底座 (20,530)、资料底座 (175,530)、战斗底座 (993,530)，图标分别位于 (39,521)、(201,516)、(1011,511)。消息 (25,254)，设置 (26,368)。此坐标只用来证实图元用途，经典参考布局优先。

## 全屏页与卡片

原 HD 页签条 resource_3:0 位于 (6,5)，未选中页签为 resource_3:7，选中页签为 7a。页签底座横坐标 49、239、429、619、809，y=38；关闭 resource_1:42 位于 (1054,23)。

资料、装备、武器、技能、融合文字分别是 resource_2 的 10、11、12、13、14；附加 a 的标签为非选中状态。另一套战斗页签随机、好友、关卡、竞技分别为 resource_2 的 3、4、5、6；道具页背包、商店、兑换分别为 7、8、9。

武器、技能、背包共用 4×2 卡片页：左上 (70,165)，每格步长 256×235。resource_3:6 为金边卡片，6a 为未学习灰框。卡片中的武器/技能图缩放 0.8；名称基线约 y=180；Lv 框 resource_1:9 位于 (130,18)。背包图缩放 0.7、位于 (70,50)，数量显示 x127/y17。

NPC 关卡区原版只有螳螂、仙鹤、熊猫三个高手入口，使用 resource_6:31、32、33；各入口底框为 resource_6:19，挑战底按钮 resource_4:6，文字 resource_6:34。原 `Mission` 要求 10 级开放，各高手下 6 关依次解锁，通过 6 关后开放下一高手，共 18 关、54 名对手。每关一轮连续三战，入场仅消耗一本挑战书，不是每名 NPC 各收一本；每轮最多复活两次，每次另消耗一本挑战书。本次已落实这些流程，并保存中断后的本轮进度。

原客户端能确认整轮经验与金松果奖励总量，但没有原服务器的掉落概率和三战奖励拆分。离线版据此保留整轮总量，在三战全部通关后一次发放；碎片使用本地概率。这部分是明确的离线实现，不能称为找回了原服务器结算规则。关卡回归 `tools/test-stages.cjs` 本次验证 13/13。

竞技首页使用三个卡片：经验场、碎片场、天梯赛；经验场和碎片场为四人赛（两组半决赛、胜者决赛、败者季军赛），并非简单一场随机战斗。resource_6:28、29、30 为三种模式图；原时间文字 37、38、39 对应 19:00–23:00、12:00–14:00、全天。独立离线版可以保留这些经典信息而取消服务器时间门槛。

## 已导出 PNG

- `images/classic/icons/weapon-{id}.png` 与 `-locked.png`：武器 1–17，均按真实彩/灰行裁剪；`weapon-true-{id}` 是真武器版本。
- `images/classic/icons/skill-{id}.png` 与 `-locked.png`：技能 1–18、23、24。
- `images/classic/icons/prop-{id}.png`：按原客户端算法导出道具。
- `images/classic/icons/gear-{id}.png`：以 gearMap 的 setId 经 gearSetMap.index 定位实际素材号，再取原指定第 0 帧，而非把整张装备动作图集当图标；仅有真实素材者导出。该映射由玩法代理校正，setId 51 对应素材 32。
- `images/classic/sprites/{sheet}-{label}.png`：585 个实际存在的原 UI 图元。
- `images/classic/characters/{mantis,crane,panda}-card.png`：原 HD NPC 肖像卡，保留其浅青背景和标题。
- `images/classic/characters/master-icon.png`：技能图集中的经典 2D 师父图标。
- `images/classic/characters/{mantis,crane,panda}-classic-card.png`：用户参考 162707 中的三个经典 2D NPC 肖像卡，保留卡片本身的米黄色背景。
- `images/classic/characters/master-classic.png`：用户参考 162734 中的经典师父透明立绘，已用蓝色背景检查轮廓。
- `images/classic/squirrel-classic.png`：用户参考 162807 中的经典 2D 基础松鼠，376×295，边界连通法去除背景。脸部内部白色保持不变，已用蓝色背景合成检查。
- `images/classic/result-loss-classic.jpg`：用户参考 162901 中的经典失败画面，对录屏计时浮层和鼠标指针的小区域做了局部颜色插值清理；来源与处理方式已记入 manifest。
- `tools/research/classic-icon-contact.jpg` 是独立图标的视觉校对表；`squirrel-cutout-check.jpg` 是透明人物的合成检查。

## GitHub 只读检索

查询记录在 `tools/research/github-search.json`。使用 GitHub 官方 API 检索「松鼠大战」「UC松鼠大战」「songshufight」「ssdz」「squirrel fight UC」，没有找到经证实属于 UC 经典版的复刻资源仓库。

- `winterIce/chipndale` 的 README 为「运用 flash 版 Box2d 的松鼠大战 demo」，内容为 Chip 'n Dale 同名横版游戏，不是 UC 松鼠大战。
- `littlebeijing/ssdz` 是一个标题为「松鼠大战 - 横版闯关」的单文件页面，是双人平台跳跃项目，与 UC 自动战斗游戏无关。
- `JGameEngine/SquirrelFighting` 明示小霸王版，`luxiaoming/-` 明示 NES 版。
- `kwigglet/ssdz` 内容为彩票搜索垃圾页面，无关。

这些外部结果仅检查元数据、文件列表及源码文本，没有运行陌生代码，没有下载无关复刻项目充当本游戏来源。

进一步对 README 精确搜索后，发现 `DomSquirrelFight/Client`，但读取 README 与完整文件树后确认它是锁定 Z 轴的 Unity 3D 横版仿作，包含 MoveAndJump、PickUpBox 教程与仙人掌/野猪/企鹅模型，仍非 UC 松鼠大战。文件树保存在 `tools/research/github-dom-client-tree.json`。

原客户端中存在公开旧域名 `http://ssdz.u.uc.cn/FightGame`。Wayback CDX 请求连接超时，grep.app 返回 429，其他网页归档也未获得可验证旧资源；这些失败不能当作“网上没有原资源”的证明。

## 已确认的公开经典截图

- 图片 URL：<https://p1.ssl.qhimg.com/t01db212eade627fe40.jpg>。主代理在 Bing 图片/360 百科图册中找到，已下载到 `references/web/classic-status-360.jpg`（373,833 字节，915×559）。它展示经典 2D 状态界面、绿色头巾松鼠、状态/武器/技能页签、米色属性面板，可独立佐证本次经典布局，而非把 HD APK 误认为经典版。
- <https://www.gamerbbs.cn/archives/73128> 是主代理核对的重启报道来源，不能据此声称拥有旧动画或旧素材。

## 额外经典素材与真实性边界

`tools/extract-classic-reference-details.py` 导出 40 件用户截图内真实部件，单独写入 `images/classic/reference-details.json`，不与 APK 图集导出脚本争用。输出包括狂战紫色套装透明立绘、活动/聊天/村庄图标、经典卡片和五种原按钮空皮肤。

- 狂战立绘：`squirrel-berserker-classic.png`。触须末端与 EXP 文字交叉处舍弃，透明区 RGB 全清零，蓝底合成 `tools/research/berserker-cutout-blue-check.jpg` 证明无右侧 UI 残留。
- 图标：`home/activity.png`（带原活动字）、`home/chat.png`（纯气泡）、`home/village.png`（带原村庄字和箭头）。
- 卡片：`reference-cards/weapon-1.png` 至 `weapon-10.png`，以及 skill-1 至 skill-18、skill-23、skill-24。保留截图显示的灰色/彩色/真章/选中状态，具体状态在 JSON 中。**不能把带真章卡片用于普通 1 级物品，也不能把灰色图说成已找到彩色原图。**
- `icons/weapon-1-classic.png` 为可独立使用的经典彩色方天画戟；真章只占背景，可直接排除而不补画武器。用闭合轮廓屏障保留了原始浅色金属部分。
- `skins/menu-green.png`、`return-gold.png`、`tab-green.png`、`tab-gold.png`、`tab-cream.png` 保留截图的真实按钮形状、色阶和描边，原标签区域使用相邻未遮挡像素逐行延展清除。皮肤是从截图加工所得，**不是发现了原始空按钮文件**。
