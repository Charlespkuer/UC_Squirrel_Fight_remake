# js/orig —— 原始客户端源码归档

这里是从原版安卓包 `h5ssdz_9game_4230.apk` 的 `assets/game.zip` 中**原样复制**的原始脚本，
逐字节未改动。APK 位于 `E:\squirrel fight1\uc松鼠大战电脑版 PC版\`：

- APK：35,572,039 字节，SHA-256 `BBFD6061078D1785262DCC518FF2A15FEEEC60E1E753456293BF595AAB08DA73`
- 内层 `assets/game.zip`：33,105,511 字节（stored，未压缩），467 项

取证与逐字节核对明细见 [../../tools/apk-audit/README.md](../../tools/apk-audit/README.md)。

## 哪些文件是运行时真正加载的

`index.html` **只**加载下面 5 个（`js/engine.js` 等是本项目自己的实现）：

| 文件 | 用途 |
| --- | --- |
| `Map.min.js` | 有序表（`propMap`/`weaponsMap` 等的基类） |
| `GameDict.js` | 全部原始数据表：道具、武器、技能、NPC、关卡、装备 |
| `animationStr.js` | 全部原始动画帧数据 |
| `assets.js` | 原始图集定义与动画资源表 |
| `asset2.js` | 补充图集定义 |

其余文件**只作资料归档，不被任何页面加载**，加进来是为了补齐一手依据：

| 文件 | 说明 |
| --- | --- |
| `index.js` | 原版入口，可看到真实加载顺序与 UC 原生桥调用 |
| `ssdz-pkg2.js` | 压缩的显示/状态机核心（`Quark.*`）：战斗场景、`Quark.FightProps`、"请点击"时序、跳过按钮都在这里 |
| `FightStats.js` | **不是"请点击"系统**，而是 `FightSet_1..5` 五套战斗场景的图层与视差数据 |
| `player.js` / `drawable.js` / `Matrix2D.js` / `BitmapCache.js` | 原始渲染与动画播放 |
| `vmGameBase.js` / `uc.base-1.0.1.js` / `JsonLoader.js` / `ajax.min.js` / `ArrayUtil.js` | 原始框架与工具 |
| `version.js` | `versionAndroid = "1.0.0.0"` |

## 注意

- 原版客户端**不能直接在浏览器里跑**：`index.js` 依赖 `require()` 与 `native.call` 这套 UC 专有桥，
  以及 `lib/armeabi/libh5runtime.so`；`assets/game.zip` 里根本没有 `index.html`。
  这正是本项目自己写 `index.html` 重新托管的原因。
- 这些文件是**压缩过的原始代码**，只用于查证，不要直接引用或执行。
- 想抽一段可读代码看：`node tools/apk-audit/extract-window.cjs "<关键串>" 700 700`。
