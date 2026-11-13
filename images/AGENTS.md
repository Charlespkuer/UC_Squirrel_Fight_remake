# images/ 入口（图像素材）

按用途分区：`ui/`（按钮 / 卡片 / 数字 / 界面块）、`atlas/`（图集）、`battle/`
（`bg/` 战斗背景、`fx/` 战斗特效、`outfit/` 穿戴件——原 `images/effect` / `images/equip` 已并入这里）、
`ssfight/`（经典模式）。原 `classic/` 与未接线的 `ui/sprites`、`ui/skins` 散图已归档到
`references/images-retired/`（本机参考，不进仓库、运行时不读）。

- 运行时按硬编码路径取图（`js/gamedict.js`、引擎与经典界面里都有 `images/...` 字面量）——
  改目录名 / 挪文件前先跑 `node tools/check-asset-paths.cjs` 看引用会不会断。
- `ui/icons/` 的武器 / 技能 / 多数道具是原版无框 SVG；旧 Android（WebView 83）的 SVG
  图片在 GPU 冷启动时会丢渐变，`js/classic-ui.js` 会在运行时把图标 `<img>` 换成内联 `<svg>`
  （id 加实例前缀），**不要**为此新增 PNG 回退。新增图标先查 `PROP_SVG_IDS` / `propIconSrc`，
  别在各页手拼扩展名。SWF 导出的 SVG 常带一条铺满 `viewBox` 的 `<rect fill="#FFFFFF">` 底卡，
  会把背包格底纹盖成白方块 —— 导出后必须删掉（`test-min-deps` 有断言）。
- `ssfight/ui/` 是 `tools/gen-ssfight-ui.cjs` 从原版导出的素材：导出物，别手改 —— 改生成器或源码再重导。
- 截图 / 对比图一律写 `out/`。
