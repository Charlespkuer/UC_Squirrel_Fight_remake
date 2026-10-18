# src-tauri/ 入口（桌面 / 安卓壳）

轻量 Tauri 壳：不在二进制里嵌前端，启动时找游戏目录（带 `scripts/index.html` 的那个）用内置迷你
HTTP 服务器供起来，窗口打开 `http://127.0.0.1:<随机端口>` —— 与网页版用同一份源码、同一个
`save/progress.json`（完整设计说明在 `src/lib.rs` 文件头）。

- `src/lib.rs`：迷你服务器 + `/__save`、`/__open`、`/__update`（调 `scripts/update-game.js`；本机没装
  Node 时回 `NO_NODE`，界面自己退到下载页）；`src/main.rs` 只是引导。
- 配置：`tauri.conf.json`，平台差异在 `tauri.windows / tauri.android / tauri.bundle` 几个 conf 里。
  `web/`、`icons/`、`target/`、`dist/` 都是生成物 / 产物（见 `.gitignore`），别手改；
  `gen/android` 里的安卓工程是本机手工维护的**真源**（图标 / 锁横屏清单 / 版本号 / 签名方案由
  `tools/build-apk.ps1` 每次同步进 ASCII 构建副本）；重新 `tauri android init` 后要照该脚本注释
  把本机补丁补回（buildSrc：node 路径候选 +「jniLibs 有 .so 就跳过 Rust」；AndroidManifest：锁横屏；
  app/build.gradle.kts：v1+v2+v3 签名）。
- 构建 / 出包走 `tools/build-tauri-app.cjs`（`--web` 生成前端快照）或 `scripts/打包.cmd`；
  细节在 `tools/build-guide.md`。
