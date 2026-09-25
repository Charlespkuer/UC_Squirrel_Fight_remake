# `E:\squirrel fight1` 逆向与取证结论

调查日期：本轮会话；全程只读，未修改该目录下任何文件。

## 一、结论速览

1. **里面的游戏文件是完整的，一点没坏。** 游戏本体是一个标准 Android 安装包
   `h5ssdz_9game_4230.apk`（35,572,039 字节），它就是普通 ZIP（magic `PK\x03\x04`），
   没有加壳、没有加密、没有损坏。直接解压即可拿到全部资源。
2. **"启动器被破坏"的判断需要修正：不是启动器坏了，是它依赖的安卓模拟器没了。**
   `开始游戏.exe` 二进制结构完好（文件长度与所有节的最大原始范围**精确相等**，未被截断），
   它只是当游网做的 BlueStacks 外壳。而本机 BlueStacks 的注册表停在
   `InstallProgress = Starting Rollback` 且**没有 `InstallDir`**，`C:\Program Files\BlueStacks`
   不存在 —— 即模拟器安装失败回滚了，所以外壳无处可启。
3. **不需要"解码/破解"这个 exe 也能拿到全部数据**，因为数据在 APK 里，而 APK 是明文 ZIP。
4. 本项目此前已经从同一个 APK 提取过资源；本次逐字节核对：**456 个资源文件里 443 个完全一致、
   0 个不同、13 个从未入库**。这 13 个是原版**引擎/运行时**源码，已补入 `js/orig/`。
5. 原版客户端**无法直接在普通浏览器里运行**：它的入口 `index.js` 依赖 UC 专有原生桥
   （`require()`、`native.call`、`native.startActivity`）和 `lib/armeabi/libh5runtime.so`，
   `assets/game.zip` 里**根本没有 `index.html`**。这正是本项目自己写 `index.html` 重新托管的原因。

## 二、目录实况

```
E:\squirrel fight1\uc松鼠大战电脑版 PC版\
├─ h5ssdz_9game_4230.apk      35,572,039 B   ← 游戏本体（完整）
├─ 开始游戏.exe                4,502,016 B   ← 当游网 Delphi 外壳（BlueStacks 启动器）
├─ Main_gamex.ini                    377 B   ← 外壳配置（值全部 base64）
├─ run.bat                            22 B   ← 只有一行，内容是「使用教程游戏前必看.txt」
├─ 使用教程游戏前必看.txt / 游戏说明.txt      ← 当游网广告与说明
├─ 当游网.url                                  ← http://www.3h3.com/
├─ System\                                     ← 空目录
└─ UninsFiles\                                 ← Inno Setup 卸载器（unins000.exe 等）
```

`Main_gamex.ini` 解码（base64 → 原文）：

| 键 | 解码结果 |
| --- | --- |
| `[Main] Name` | `h5ssdz_9game_4230.apk` |
| `[Main] Simulator` | `BlueStacks` |
| `[Main] WebInstName` | `ads.3h3.com` |
| `[Params] RunLibs` | `dotNetFramework2` |
| `[Params] Name` | ` Android com.uc.h5.ssdz com.ucweb.h5runtime.H5RuntimeActivity` |
| `[AppName] Name` | `uc松鼠大战电脑版 PC版`（该段是 GBK 字节的 base64，按 UTF-8 解会花屏，属正常现象） |
| `[UserInfo]` | `RunLast=2026/9/23 13:05:23`，`RunTimes=17` |

## 三、APK 结构

`AndroidManifest.xml` 关键串：包名 `com.uc.h5.ssdz`，活动
`com.ucweb.h5runtime.H5runtimeActivity` / `H5BrowserActivity` /
`com.ucweb.game.LoginActivity` / `CheckVersionActivity` / `cn.uc.gamesdk.view.SdkWebActivity`。

APK 共 191 项，去掉 UC SDK 与安卓外壳后真正的内容只有一个：

| 项 | 大小 | 说明 |
| --- | --- | --- |
| `assets/game.zip` | 33,105,511 B | **完整 H5 游戏**，存储方式为 stored（未压缩），467 项（456 文件 + 11 目录） |
| `lib/armeabi/libh5runtime.so` | 3,125,300 B | UC H5 运行时原生库（H5 游戏靠它跑） |
| `classes.dex` | 1,464,444 B | 安卓外壳 |
| `assets/ucgamesdk/**` | — | UC 登录/支付 SDK 界面，与游戏内容无关 |

`assets/game.zip` 的顶层只有 `index.js`、`js/`、`images/`、`audio/`，**没有 HTML**。

## 四、与原项目的逐字节核对

方法：解出 `assets/game.zip` 全部 456 个文件，对每个文件在该项目内按「同相对路径 / `js/orig/` 迁移路径 /
同名文件」三种候选查找，比较大小与 SHA-256。脚本：`tools/apk-audit/compare.cjs`，
明细：`tools/apk-audit/report.md`。

| 状态 | 数量 |
| --- | --- |
| 项目已有完全相同副本（逐字节一致） | **443** |
| 有同名文件但内容不同 | **0** |
| 项目完全没有 | **13** |

0 个不同，说明项目里的图集、音频、`GameDict.js`、`animationStr.js`、`assets.js`、`asset2.js`、
`Map.min.js` **全部与 APK 原样一致**，没有任何被改写或丢失的素材。

### 新增入库的 13 个原始文件（→ `js/orig/`）

| 文件 | 大小 | 作用 |
| --- | --- | --- |
| `index.js` | 2.5 KB | **原版入口**：真实模块加载顺序 + UC 原生桥调用 |
| `ssdz-pkg2.js` | 515 KB | 压缩过的显示/状态机核心（`Quark.*`），战斗场景、FightProps 都在这里 |
| `uc.base-1.0.1.js` | 32 KB | UC 基础框架 |
| `JsonLoader.js` | 28 KB | 资源加载 |
| `vmGameBase.js` | 16 KB | 游戏基类 |
| `player.js` | 11 KB | 动画/角色播放器 |
| `Matrix2D.js` | 5 KB | 变换矩阵 |
| `drawable.js` | 4 KB | 绘制对象 |
| `FightStats.js` | 3.9 KB | **注意：这是 5 套战斗场景的图层/视差数据（`FightSet_1..5`），不是"请点击"系统** |
| `ajax.min.js` | 2.5 KB | 网络 |
| `BitmapCache.js` | 0.6 KB | 位图缓存 |
| `ArrayUtil.js` | 0.6 KB | 数组工具 |
| `version.js` | 0.2 KB | `versionAndroid = "1.0.0.0"` |

这些文件**不被 `index.html` 加载**，纯属原始资料归档，对运行时零影响。

## 五、原始源码直接验证到的几处事实

以下都能在 `ssdz-pkg2.js` 里读到原文，是本轮核对"请点击"奖励与跳过时的直接证据。

### 1. 「请点击」出现时机（证实项目取值正确）

```js
this.fightingTimes++;
this.fightingTimes == 340 + this.counter ? ... getFightingReward()[2] ... :
this.fightingTimes == 180 + this.counter ? ... getFightingReward()[1] ... :
this.fightingTimes == 30  + this.counter && ... getFightingReward()[0] ...
```

抖动值在场景初始化里：

```js
this.counter = Math.round(Math.random() * 130);
```

即 **30 / 180 / 340 帧 + `round(random()*130)`**，与项目 `js/battle-drops.js` 的
`frames: [30,180,340]`、`jitter: 130` **完全一致**。另外还存在一条备用分支
（`fightingProp`，`getType==0`）用 **30 / 170 / 320**。

### 2. 原始奖励道具白名单（证实碎片是离线补充）

`Quark.FightProps` 只接受这些 id：**1, 2, 8, 15, 21, 22, 45, 50**
（小体力药剂 / 大体力药剂 / 金松果 / 经验 / 技能卷轴 / 武器卷轴 / 天使果实种子 / 50）。
**没有 24/25/26 碎片** —— 与项目文档里"碎片是按用户记忆补入的离线种类"的说法一致。

### 3. 原版的「跳过」是超级松鼠（VIP）+ 10 级限定

```js
b.onPress = function () {
  if (d.index > -1 && !d.isSkip)
    game.player.isVIP
      ? game.player.getBase().level < 10
        ? game.showTips("你的等级不够10级,不能跳过。", 2)
        : (b.isSkip = true, b.removeChildById("tiaoguo"), b.skip())
      : game.showTips("你还不是超级松鼠,不能跳过。", 2);
};
```

而且跳过之后**照常结算奖励**：

```js
if (this.isSkip == true && ... && game.fightInfo.getFightingReward() != null) { ... }
```

本项目出于离线单机定位对所有人开放跳过（不去复刻 VIP 门槛），但"跳过仍然发奖"的行为与原版一致
—— 这也正是上一轮修掉的那个 bug 的正确语义。

### 4. 战斗场景视差数据（`FightSet_1..5`）

`FightStats.js` 给了 5 套场景的真实图层参数，例如森林场：

```js
FightSet_1 = { layer:[ {image:"fightBack", ... scaleX:1.4355, scaleY:1.4355},
                        {image:"",         ...},
                        {image:"fightFront", x:0, y:399, ... scaleX:1.4355} ],
               MapData:   {x:[3,8,16], y:[0,0,0], dir:true},
               MapData_r: {x:[-3,-8,-16], ...} }
```

这是 `js/battle.js` 里 `REGIONS` 的原始依据（`1170×690`、`scaleX 1.4355`、前景层 `y 399`、
三档视差 3/8/16），可用于继续校准场景还原度。

## 六、为什么"修启动器"不是正确路线

`开始游戏.exe` 的取证结果：

- Delphi 编写的 **原生 x86 GUI** 程序（含 `Vcl.ComCtrls`/`Winapi.*`/Indy 特征节），2013-01-09 链接，
  **不是 .NET**（CLR 目录 RVA = 0），尽管 `ini` 里写着 `RunLibs=dotNetFramework2`。
- 文件**没有被截断**：`4,502,016` 字节 = 各节 `PointerToRawData + SizeOfRawData` 的最大值。
  校验和为 0（Delphi 常规做法），不能作为损坏依据。
- 关键字符串：`SOFTWARE\BlueStacks`、`Simulator`、`aPkgName`、`InnoTools_Downloader`、
  `DownloadSize`/`OnDownloadComplete`、`ads.3h3.com/qdq/{top,popleft,popright,bottom}.htm`、
  `360tray.exe,kxetray.exe,qqpctray.exe`（广告外壳规避杀软的进程黑名单）。
- 结论：它是「下载并拉起 BlueStacks → 在模拟器里装 APK」的广告外壳，**本身不含游戏数据**。

本机状态（这解释了"启动器打不开"）：

| 检查 | 结果 |
| --- | --- |
| `HKLM\SOFTWARE\BlueStacks` | 存在，但 `InstallProgress = Starting Rollback`，**无 `InstallDir`** |
| `C:\Program Files\BlueStacks` | **不存在** |
| `C:\ProgramData\BlueStacks` | 只剩 `Android\`、`UserData\`、`InstallTimeGlCheck.txt` 残留 |

即 BlueStacks 装到一半回滚了。外壳找不到模拟器，自然起不来 —— **与游戏文件无关**。

## 七、建议路线

> 架构层面的完整解剖（分层、43 个状态、37 个界面类、76 个服务端接口、
> 哪些能算哪些只能播）见 [ARCHITECTURE.md](ARCHITECTURE.md)。

1. **想再玩原版**：不要修这个外壳。直接装一个还活着的安卓模拟器
   （BlueStacks 5 / LDPlayer / MuMu / Waydroid），把
   `h5ssdz_9game_4230.apk` 拖进去安装即可。注意原版需要联网走 UC 登录（`CheckVersionActivity`
   → `LoginActivity`），离线可玩性取决于当年服务端是否还在，这是它作为网游客户端的固有限制。
2. **想要资源/数值**：直接 `Expand-Archive` 那个 APK，再解 `assets/game.zip`，
   不需要任何解密。本项目已把其中 443 个文件原样入库。
3. **继续本项目的还原**：新增的 13 个原始引擎文件（尤其 `ssdz-pkg2.js` 与 `FightStats.js`）
   是此前缺失的一手依据，可用于核对战斗场景视差、UI 坐标、动画帧时序。

## 八、复现方式

```powershell
# 1) 解出 APK 内层 game.zip（纯 .NET，无需第三方工具）
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apk = "E:\squirrel fight1\uc松鼠大战电脑版 PC版\h5ssdz_9game_4230.apk"
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
$e = $zip.Entries | Where-Object { $_.FullName -eq 'assets/game.zip' }
[System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, '.\game.zip', $true)
$zip.Dispose()

# 2) 内层资源清单
Expand-Archive .\game.zip .\game

# 3) 与本项目逐字节核对 + 生成明细报告
node tools/apk-audit/compare.cjs

# 4) 在外壳里找字符串（广告/模拟器证据）
.\tools\apk-audit\scan-strings.ps1 -Path '<开始游戏.exe 的完整路径>' -MinLen 6 `
  -OutFile .\tools\apk-audit\launcher-strings.txt

# 5) 在压缩源码里检索并解码文案（免解压）
node tools/apk-audit/search.cjs "fightingTimes==30" --before 200 --after 400 --context
node tools/apk-audit/search.cjs --read js/ssdz-pkg2.js --from 54600 --len 3200 --decode
```

### 注意（本轮踩到的坑）

- 该目录含中文名，PowerShell 的 `Get-Item`/`Get-ChildItem -Filter` 在这条路径上会
  **误报 "Could not find item"**，而 `Test-Path -LiteralPath`、`[System.IO.File]::Exists`、
  `[System.IO.Compression.ZipFile]` 都正常。请改用 .NET API 或
  `[System.IO.Directory]::GetFiles()` 取路径，不要据此判断文件损坏。
