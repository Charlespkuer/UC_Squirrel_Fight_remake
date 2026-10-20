package com.ssdz.classic

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  /** Tauri 创建出来的 WebView；onPause 时用它把最后一次防抖写盘立刻刷到原生存档。 */
  private var gameWebView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onPause() {
    /* 安卓按 Home / 切后台 / 被系统回收前先让前端 flush 一次；前端的 pagehide
     * 在部分 WebView 上不触发，不能只靠 400ms 防抖。 */
    try {
      gameWebView?.evaluateJavascript("window.__ssdzFlushSave && window.__ssdzFlushSave()", null)
    } catch (_: Exception) {
      // WebView 已被销毁时忽略；下一次启动会从 progress.json 恢复。
    }
    super.onPause()
  }

  /**
   * 给 WebView 注入「导出到系统下载目录」的桥。
   * 放在 onWebViewCreate 里、页面加载前挂上，避免第一次导出时接口还没到。
   */
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    gameWebView = webView
    webView.addJavascriptInterface(AndroidExportBridge(this), "SSDZAndroid")
  }
}
