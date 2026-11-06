package com.ssdz.classic

import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import org.json.JSONObject

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

  /**
   * Android 16 / Adreno 8xx 的合成器绿色空层规避开关。
   *
   * Chromium 公开放置的问题（issues.chromium.org/576362369，SM-S928B / Android 16）：
   * WebView 在 Vulkan 合成路径下会丢掉**整块贴图层**，页面只剩 CSS 底色与文字/悬浮 DOM
   * —— 与玩家反馈的「深绿底 + 只显示部分特效与悬浮奖励」一致。K90 Pro Max 与
   * MagicPad3 Pro 都是第五代骁龙 8 至尊版（SM8850）+ Android 16，Honor 100 Pro 是
   * 8 Gen 2 + Android 14（不走 Vulkan 路径），正好解释「只有新机绿屏」。
   *
   * 原生层没有 `--disable-features=WebViewVulkanIntermediateBuffer` 的公开入口，所以
   * 在 WebView 上显式落到软件图层：整棵页面由 HWUI 画进软件位图，绕开 Vulkan 合成器。
   * 只对已知风险 SoC 自动开启；其它机器可用 Intent extra `forceSoftware=true` 或页面里的
   * `window.SSDZRender.setSoftwareRender('1')` 做验证/逃生。
   */
  private var forceSoftwareRender = false

  @Volatile private var softwareRender = false

  /** 只在 Android 16 + 高通 Adreno 8xx/7xx 上自动启用。 */
  private fun shouldUseSoftwareRenderer(): Boolean {
    if (Build.VERSION.SDK_INT < 36) return false
    val maker = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MANUFACTURER else ""
    val model = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MODEL else ""
    val qualcomm = maker.equals("Qualcomm", ignoreCase = true) ||
      Build.HARDWARE.startsWith("qcom", ignoreCase = true)
    if (!qualcomm) return false
    val known = listOf("SM8850", "SM8750", "SM8650", "SM8550", "SM8475", "SM8450")
    return known.any { model.startsWith(it, ignoreCase = true) }
  }

  /** 切 WebView 的图层类型；必须在主线程调用。重复调用是幂等的。 */
  private fun applySoftwareRender(view: WebView?, enabled: Boolean) {
    val target = view ?: return
    ui.post {
      try {
        target.setLayerType(if (enabled) View.LAYER_TYPE_SOFTWARE else View.LAYER_TYPE_HARDWARE, null)
        softwareRender = enabled
      } catch (_: Exception) {
        // 个别 ROM 不允许改图层；保持默认硬件路径，页面照样能玩。
      }
    }
  }

  /** 调试/逃生桥：`window.SSDZRender.setSoftwareRender('auto'|'1'|'0')`。 */
  private inner class RenderBridge {
    @JavascriptInterface
    fun setSoftwareRender(mode: String): String {
      val text = mode.trim().lowercase()
      val on = when (text) {
        "1", "true", "on" -> true
        "0", "false", "off" -> false
        else -> shouldUseSoftwareRenderer() || forceSoftwareRender
      }
      applySoftwareRender(gameWebView, on)
      return JSONObject().put("ok", true).put("software", on).put("mode", text).toString()
    }

    @JavascriptInterface
    fun renderInfo(): String = JSONObject()
      .put("software", softwareRender)
      .put("sdk", Build.VERSION.SDK_INT)
      .put("soc", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MODEL else "")
      .toString()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    /* 验证/逃生：`adb shell am start ... --ez forceSoftware true` 强制软件图层。 */
    forceSoftwareRender = intent?.getBooleanExtra("forceSoftware", false) == true
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
    /* Android 16（API 36，含小米 HyperOS 3 / 澎湃 3）**不再冻结 WebView**：
     * 实测（Android 16 x86_64 模拟器 / WebView 133）按 Home 超过 250ms 后，
     * `onPause()` + `pauseTimers()` 能让页面在回前台时**永远停在被冻结前的最后一帧** ——
     * DOM 还在、JS 还能跑（CDP 能改节点），但画面不再更新：该出现的名字缺字、
     * 新加的图层不出现；切后台时间再长一点就是整屏黑/旧画面。玩家看到的是
     * 「黑屏 / 屏幕显示有问题」（2026-10 红米 K90 Pro Max / HyperOS 3 反馈）。
     *
     * 计时器继续跑只会让体力/建筑这类按时间推进的进度在后台照算（与设置里
     * 「后台运行：开」相同），耗电差异远小于黑屏；音乐的暂停仍由上面的
     * notifyPageBackground() 交给页面处理。Android 15 及以下保持原冻结行为。 */
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) return
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
      /* 先让页面按当前窗口重排，再恢复音乐/系统栏。部分 ROM（iQOO / HyperOS）回前台
       * 不会补发 JS resize；Android 16 上 WebView 还可能停在冻结前的尺寸上。 */
      gameWebView?.evaluateJavascript(
        "window.__ssdzRelayout && window.__ssdzRelayout();" +
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
    /* Android 16 + Adreno 的 Vulkan 合成丢层：在页面加载前就落到软件图层，避免先闪一次绿底。
     * 这是整棵 WebView 的绘制路径切换，不是改页面内容；关闭时仍回硬件图层。
     * 用 post 再落一次：个别 ROM 在 attach 到窗口时会把图层属性重置，等第一帧前重设最稳。 */
    if (forceSoftwareRender || shouldUseSoftwareRenderer()) {
      softwareRender = true
      applySoftwareRender(webView, true)
    }
    val bridge = AndroidExportBridge(this, { gameWebView }) { enabled -> backgroundRun = enabled }
    exportBridge = bridge
    webView.addJavascriptInterface(bridge, "SSDZAndroid")
    webView.addJavascriptInterface(RenderBridge(), "SSDZRender")
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
