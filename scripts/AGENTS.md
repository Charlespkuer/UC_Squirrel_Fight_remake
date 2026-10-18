# scripts/ 入口（双击入口与本地服务）

这个目录放**双击能用的入口**（`.cmd` / `.command` 薄壳）和它们对应的逻辑：

- `启动游戏.*` → `start-game.ps1`：起本地服务器并开浏览器；`停止游戏.command` 收尾。
- `game-exit-watch.sh`：macOS 关窗收尾（`启动游戏.command` 打开窗口后后台拉起）。游戏窗口
  关掉后退出**游戏专用**的 Chrome/Edge 实例（独立 profile + DevTools 页面目标判定），
  Terminal 只剩自己那一扇窗口时连 Terminal 一起退出；还有别的窗口就不动。
  日志写 `save/game-exit.log`（运行时产物）。
- `一键同步.*` → `sync/sync-win.ps1`（Windows 菜单）→ `sync/sync.js`（双机同步逻辑，零依赖 Node）。
  端口 / 口令 / 对端在 `sync/sync.config.json`（本机私货，不进仓库）；日志写 `save/`
  （`sync.out.log` / `sync.err.log`，运行时产物）。
  **两台机器的端口必须一样**（新版默认 18788；8788 落在 Windows 的保留段 8719-8818，
  非管理员绑不上）。换端口：`node scripts/sync/sync.js port <新端口>` → 两台都改 →
  `node scripts/sync/sync.js restart`，Windows 上再跑一次 `firewall` 放行新端口。
- 忽略规则：以仓库根 `.gitignore` 为准（前导 `/` 只锚定游戏根，改完不用重启服务）。
  被忽略的路径**永远不会同步**；`diffWithPeer` 会把「对端有、但被本机规则挡住」的文件列出来，
  看到那段提示就去改 `.gitignore` / `config.ignore`。
- `重启同步服务.cmd` / `restart-sync.cmd` → `node sync/sync.js restart`（改过口令或端口后跑一次）。
- `打包.cmd` / `清缓存.cmd` → `tools/build-release.ps1`。
- `serve.js` / `serve.py`：本地静态服务器（默认 8080）；`update-game.js`：「一键拉取远端更新」的执行体。

约定：`.cmd` 只放 **ASCII**（cmd.exe 读 UTF-8 中文会乱），中文与逻辑放 `.ps1`（必须带 UTF-8 BOM）或 `.js`；
任何进程都**不要拿游戏目录当工作目录**（会让整个文件夹没法改名 / 移动，见 `sync/sync.js` 注释）。
