package com.ssdz.classic

import android.content.res.Configuration
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  /** Tauri 创建出来的 WebView；onPause 时用它把最后一次防抖写盘立刻刷到原生存档。 */
  private var gameWebView: WebView? = null

  /** 导出桥要接系统权限回调（Android 9 及以下写公共下载目录需要存储权限）。 */
  private var exportBridge: AndroidExportBridge? = null

  /** 主线程消息队列：用来「稍等一拍再冻结 WebView」。 */
  private val ui = Handler(Looper.getMainLooper())

  /** 生命周期序号：onPause 排的冻结任务只有在期间没回到前台时才执行。 */
  private var lifecycleSeq = 0

  /** 当前是否已冻结（pauseTimers）。 */
  private var frozen = false

  /** 设置页「后台运行」：true = 切后台不冻结计时器（音乐也由页面自己决定是否继续）。 */
  @Volatile private var backgroundRun = false

  companion object {
    /* 为什么冻结要延后 250ms：onPause 里那段 evaluateJavascript 要先把音乐 pause 掉、
     * 再把最后一次存档 flush 出去（安卓这一串是异步 IPC）。立刻 pauseTimers 有可能把
     * 还没执行的脚本一起按停 —— 那正是「有时候退出会存档、有时候不会」的成因之一。
     * 250ms 足够闲时跑完这次写盘，又不会让后台多跑多久。 */
    private const val FREEZE_DELAY_MS = 250L
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /** 告诉页面「进后台了」：停音乐 + 立刻把最后一次存档刷到原生存档 + 导出一份到下载目录。
   *
   *  以前这里只 flush 存档，不停音乐：安卓 WebView 的 <audio> 不跟应用生命周期走，
   *  按 Home 之后 AudioPlaybackConfiguration 仍然是 state:started（API 35 模拟器实测），
   *  玩家听到的就是「音乐一直在后台响，除非彻底杀掉后台」。 */
  private fun notifyPageBackground() {
    try {
      gameWebView?.evaluateJavascript(
        "window.__ssdzEnterBackground && window.__ssdzEnterBackground();" +
          "window.__ssdzFlushSave && window.__ssdzFlushSave();" +
          "window.__ssdzAutoExportSave && window.__ssdzAutoExportSave()",
        null,
      )
    } catch (_: Exception) {
      // WebView 已被销毁时忽略；下一次启动会从 progress.json 恢复。
    }
  }

  /** 冻结 WebView：rAF / setInterval 一起停摆，后台不再推进游戏进度（音乐由上面那段 JS 停）。 */
  private fun freezeWebViewSoon() {
    /* 玩家在设置里打开「后台运行」时不冻结：让计时器 / 动画继续跑（更耗电，玩家自己选）。 */
    if (backgroundRun) return
    val view = gameWebView ?: return
    if (frozen) return
    val seq = lifecycleSeq
    ui.postDelayed({
      if (lifecycleSeq != seq || frozen) return@postDelayed   // 这期间已经回到前台了
      try {
        view.onPause()
        view.pauseTimers()
        frozen = true
      } catch (_: Exception) {
        // 冻结失败不影响存档；下一次 onResume 会照常恢复。
      }
    }, FREEZE_DELAY_MS)
  }

  /** 解冻：恢复 JS 计时器与渲染，再让页面把音乐接回原来的位置。 */
  private fun thawWebView() {
    try {
      /* pauseTimers 是进程级状态，frozen 只是这个 Activity 的记账。
       * Activity 重建后 frozen 会归零，仍必须恢复上一个实例暂停的计时器。 */
      gameWebView?.resumeTimers()
      gameWebView?.onResume()
    } catch (_: Exception) {
      // 忽略：实在恢复不了，下一次启动会重新建一个 WebView。
    }
    frozen = false
  }

  override fun onPause() {
    lifecycleSeq++
    /* 安卓按 Home / 切后台 / 被系统回收前先让前端停音乐并 flush 一次；
     * 前端的 pagehide 在部分 WebView 上不触发，不能只靠 400ms 防抖。 */
    notifyPageBackground()
    super.onPause()
    freezeWebViewSoon()
  }

  override fun onResume() {
    super.onResume()
    lifecycleSeq++
    thawWebView()
    try {
      gameWebView?.evaluateJavascript(
        "window.__ssdzEnterForeground && window.__ssdzEnterForeground()",
        null,
      )
    } catch (_: Exception) {
    }
  }

  /** 转屏 / 分屏 / 系统栏变化时 WebView 不一定会发 JS resize（iQOO 等 ROM 上实测会停用旧
   *  viewport）。Activity 的 configChanges 已经声明了 orientation|screenSize|smallestScreenSize，
   *  系统不会重建 Activity，所以必须在这里主动通知页面重新量一次。 */
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    try {
      gameWebView?.evaluateJavascript(
        "window.__ssdzRelayout && window.__ssdzRelayout()",
        null,
      )
    } catch (_: Exception) {
      // 页面还没建好；启动/回前台还会再补一次。
    }
  }

  override fun onDestroy() {
    lifecycleSeq++
    ui.removeCallbacksAndMessages(null)
    /* 保证同进程内重建 Activity 时不把全局计时器留在暂停状态。 */
    try { gameWebView?.resumeTimers() } catch (_: Exception) {}
    frozen = false
    gameWebView = null
    exportBridge = null
    super.onDestroy()
  }

  /**
   * **不要再调 `WebView.freeMemory()`**（2026-10 荣耀丢图）。
   *
   * 旧代码在 `level >= TRIM_MEMORY_RUNNING_LOW` 时调它，注释写的是“只释放原生缓存，
   * 不动 JS 素材”。实际行为不是这样：`freeMemory()` 会把 WebView 已经解码的图片一起
   * 丢掉。正常设备会按需重新解码，但荣耀 / MagicOS 的 WebView 在图片解码数据被回收后
   * 可能不再恢复 —— 战斗里所有角色、特效、场景都来自图集，玩家看到的就是整屏只剩
   * canvas 深色底 + 伤害飘字 + 悬浮奖励（`images/` 全部“消失”）。
   *
   * 而且 `TRIM_MEMORY_RUNNING_LOW` 这个门槛包含了 `TRIM_MEMORY_UI_HIDDEN` 和
   * `BACKGROUND`：每次按 Home 都会走一次，等于主动把战斗图片清掉。内存交给 WebView
   * 自己的 onTrimMemory 处理；页面侧只在回前台时补拉真正失败过的图片。
   */
  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
  }

  /**
   * 给 WebView 注入「导出到系统下载目录」的桥。
   * 放在 onWebViewCreate 里、页面加载前挂上，避免第一次导出时接口还没到。
   */
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    gameWebView = webView
    /* WebView 可能晚于 onResume 创建，不能只依赖 Activity 的恢复回调。 */
    webView.resumeTimers()
    frozen = false
    val bridge = AndroidExportBridge(this, { gameWebView }) { enabled -> backgroundRun = enabled }
    exportBridge = bridge
    webView.addJavascriptInterface(bridge, "SSDZAndroid")
  }

  /** 存储权限弹窗的结果转给导出桥（Android 9 及以下才有这条路径）。 */
  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    exportBridge?.onRequestPermissionsResult(requestCode, grantResults)
  }
}
