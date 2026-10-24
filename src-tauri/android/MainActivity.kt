package com.ssdz.classic

import android.content.ComponentCallbacks2
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
    if (!frozen) return
    try {
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

  override fun onDestroy() {
    ui.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  /** 系统内存吃紧时先让 WebView 释放自己的原生缓存；游戏 JS 的素材表/画布不在
   *  `freeMemory()` 里，所以不会把正在播的战斗数据清掉。只在「运行中低内存」及更紧的
   * 档位调用，避免刚进后台就打断最后那次存档 IPC。 */
  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
      try { gameWebView?.freeMemory() } catch (_: Exception) {}
    }
  }

  /**
   * 给 WebView 注入「导出到系统下载目录」的桥。
   * 放在 onWebViewCreate 里、页面加载前挂上，避免第一次导出时接口还没到。
   */
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    gameWebView = webView
    val bridge = AndroidExportBridge(this) { gameWebView }
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
