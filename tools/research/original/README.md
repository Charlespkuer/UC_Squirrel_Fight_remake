# tools/research/original/ —— 原版客户端脚本（研究用）

这里是**从原 APK 里恢复出来的原始客户端脚本**。`references/orig/` 放的是同一套文件的副本
（`js/ssdz-pkg2.js` 做过 Prettier），游戏运行读的是 `references/orig/`。

原先 18 个文件里 **17 个与 `references/orig/` 逐字节相同**，已删除（内容仍在 git 的 `references/orig/` 里，零信息损失）。
只保留这一个**不重复**的文件：

- `js/ssdz-pkg2.js` —— **原始压缩版**（837 KB）；`references/orig/ssdz-pkg2.js` 是格式化后的版本（515 KB）。
  战斗掉落（`FightProps`）等规则的取证以这份原始代码为准，见 `tools/research-floating-drops.md`。

重新导出全部原版脚本：`node tools/apk-audit/apk-zip.cjs`（零依赖直读 APK 内层 `assets/game.zip`）。