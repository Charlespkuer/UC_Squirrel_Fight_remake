# images/ 入口（图像素材）

按用途分区：`ui/`（按钮 / 卡片 / 数字 / 界面块）、`atlas/`（图集）、`battle/`
（`bg/` 战斗背景、`fx/` 战斗特效、`outfit/` 穿戴件——原 `images/effect` / `images/equip` 已并入这里）、
`classic/`（经典翻新流程）、`ssfight/`（经典模式）。

- 运行时按硬编码路径取图（`js/gamedict.js`、引擎与经典界面里都有 `images/...` 字面量）——
  改目录名 / 挪文件前先跑 `node tools/check-asset-paths.cjs` 看引用会不会断。
- `ssfight/ui/` 是 `tools/gen-ssfight-ui.cjs` 从原版导出的素材：导出物，别手改 —— 改生成器或源码再重导。
- `classic/**/.bak-upscale/` 是原地放大前的 1x 备份（本机产物，不进仓库、运行时不读）；
  `ssfight/ui/bitmap/` 的 1x 原件同理归档在 `references/.bak-upscale/`（有 `.hd.jpg|.hd.png` 时生成器不再落 1x）。
- `_reference/` 是参考 / 取证区（原版截图、切图出处、未采用散图）：不进仓库、运行时不读；
  要用的图先拷进对应素材目录，或走生成器重出。

截图 / 对比图一律写 `out/`。
