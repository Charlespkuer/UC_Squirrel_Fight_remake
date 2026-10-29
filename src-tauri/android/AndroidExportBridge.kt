package com.ssdz.classic

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Looper
import android.provider.MediaStore
import android.system.Os
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 安卓端 JS ↔ 原生桥（`window.SSDZAndroid`）：导出存档落点、沉浸式状态栏、系统浏览器外链。
 *
 * WebView 里 `<a download>` 默认会被 Tauri/Wry 存到应用私有目录
 * `/data/user/0/com.ssdz.classic/...`，普通文件管理器打不开。这里直接写公共目录：
 *   · Android 10（API 29）及以上：MediaStore.Downloads（**不需要存储权限**）；
 *   · Android 9（API 28）及以下：申请 WRITE_EXTERNAL_STORAGE 后写
 *     `Environment.getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS)`，
 *     没有授权时先在应用外部目录留一份，并把 `needPermission` 交给前端走授权重试。
 *
 * 两类入口：
 *   · `saveToDownloads(fileName, content)`：玩家点「导出存档」，带时间戳、不覆盖；
 *   · `saveAutoBackup(content)`：自动存档导出，固定文件名 `松鼠大战-自动存档.json`，
 *     每次覆盖上一份（切后台 / 定时触发），下载目录里不会堆一串文件。
 *
 * JS 侧入口：`window.SSDZAndroid.*`。返回值都是 JSON 字符串：
 *   `{ok:true,path:"Download/xxx.json",method:"mediastore|legacy",bytes:N}`
 *   `{ok:false,msg:"...",needPermission:true}`（仅老系统未授权时）
 * 外链入口 `openExternal(url)` 见下面单独一段：它是「支持作者」等按钮在安卓上的唯一出路。
 */
class AndroidExportBridge(
    private val activity: Activity,
    private val webViewProvider: () -> WebView?,
    /** 设置页「后台运行」：把开关同步给 MainActivity（决定切后台要不要 pauseTimers）。 */
    private val onBackgroundRunChanged: (Boolean) -> Unit = {},
) {
    companion object {
        private const val TAG = "SSDZExport"
        private const val REQ_WRITE_STORAGE = 0x5353
        private const val MAX_URL_LENGTH = 2048
        const val AUTO_FILE_NAME = "松鼠大战-自动存档.json"
    }

    @JavascriptInterface
    fun saveToDownloads(fileName: String, content: String): String =
        runSave(fileName, content, replace = false)

    /** 自动存档导出：固定名字、覆盖上一份。 */
    @JavascriptInterface
    fun saveAutoBackup(content: String): String =
        runSave(AUTO_FILE_NAME, content, replace = true)

    /** 安卓沉浸模式：设置里的「状态栏」开关。隐藏/显示顶部状态栏与底部导航栏。
     *  JS 侧：`window.SSDZAndroid.setSystemBarsHidden('1'|'0')`。
     *
     *  ⚠ 导航栏也必须一起收：`enableEdgeToEdge()` 下 WebView 铺到整块窗口，只藏状态栏时
     *  三键导航会在底部/侧边盖住游戏画面（iQOO Z5 用户实测：按钮被导航栏切掉、整页像错位）。
     *  沉浸式 sticky 下从屏幕边缘滑动仍可临时唤出导航栏，不影响返回手势。 */
    @JavascriptInterface
    fun setSystemBarsHidden(hidden: String): String {
        val hide = hidden == "1" || hidden.equals("true", ignoreCase = true)
        activity.runOnUiThread {
            try {
                val window = activity.window
                val controller = WindowCompat.getInsetsController(window, window.decorView)
                val bars = WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars()
                if (hide) {
                    controller.hide(bars)
                    controller.systemBarsBehavior =
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                } else {
                    /* 只恢复状态栏；导航栏始终沉浸。否则三键导航会重新盖住游戏底部，
                     * 用户关掉「隐藏状态栏」后就点不到最下面一排按钮。 */
                    controller.show(WindowInsetsCompat.Type.statusBars())
                    controller.hide(WindowInsetsCompat.Type.navigationBars())
                    controller.systemBarsBehavior =
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                }
            } catch (_: Exception) {
                // 个别 ROM 的 insets controller 可能抛异常；不影响游戏本体。
            }
        }
        return JSONObject().put("ok", true).put("hidden", hide).toString()
    }

    /** 用系统浏览器打开 http(s) 链接。返回 `{ok:true}` 或 `{ok:false,msg:"..."}`。
     *
     *  为什么不用 Rust 里 spawn `am start`：那是以**本应用 uid** 去跑 shell 的命令入口，
     *  ActivityManager 会校验 `com.android.shell` 与调用 uid 是否一致，结果必然是
     *  `SecurityException: Permission Denial`；而且 `Command::spawn` 只要进程起来就算成功，
     *  页面会把「其实没打开」当成成功，玩家看到的就是「点支持作者没反应」（2026-10 反馈）。
     *  应用自己发 ACTION_VIEW 才是受支持的路径，也不依赖 `am` / PATH / SELinux。
     */
    @JavascriptInterface
    fun openExternal(rawUrl: String): String {
        val url = rawUrl.trim()
        val http = url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true)
        if (!http || url.length > MAX_URL_LENGTH || url.any { it.isWhitespace() }) {
            return fail("链接不合法（只允许 http(s) 网址）")
        }
        var result: String? = null
        val latch = CountDownLatch(1)
        val open = Runnable {
            result = try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                JSONObject().put("ok", true).toString()
            } catch (_: ActivityNotFoundException) {
                fail("这台设备上没有能打开网页的浏览器")
            } catch (e: Exception) {
                Log.e(TAG, "open external failed: $url", e)
                fail("打开浏览器失败：" + (e.message ?: e.javaClass.simpleName))
            } finally {
                latch.countDown()
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            // 已经在主线程（例如从别的原生回调进来）就别 post 了，否则会自己等自己。
            open.run()
        } else {
            activity.runOnUiThread(open)
            /* @JavascriptInterface 跑在 WebView 的 JavaBridge 线程上，等主线程结果不会死锁；
             * 最多 2 秒，超时按失败处理 —— 前端会退到「复制链接」兜底，不会假报成功。 */
            latch.await(2, TimeUnit.SECONDS)
        }
        return result ?: fail("打开浏览器超时，请稍后再试")
    }

    /** 设置页「后台运行」开关：`'1'` = 切后台继续跑（MainActivity 不 pauseTimers，音乐也不停），
     *  `'0'` = 原来的省电行为（暂停音乐并冻结计时器）。 */
    @JavascriptInterface
    fun setBackgroundRun(enabled: String): String {
        val on = enabled == "1" || enabled.equals("true", ignoreCase = true)
        try {
            onBackgroundRunChanged(on)
        } catch (e: Exception) {
            Log.w(TAG, "setBackgroundRun failed", e)
        }
        return JSONObject().put("ok", true).put("backgroundRun", on).toString()
    }

    /** 老系统（API ≤ 28）申请写公共下载目录的权限；授权结果通过 JS 回调送回。 */
    @JavascriptInterface
    fun requestStoragePermission(): String {
        if (canWriteLegacyDownloads()) {
            return JSONObject().put("ok", true).put("granted", true).toString()
        }
        try {
            activity.runOnUiThread {
                try {
                    ActivityCompat.requestPermissions(
                        activity,
                        arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE),
                        REQ_WRITE_STORAGE,
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "requestPermissions failed", e)
                }
            }
        } catch (e: Exception) {
            return fail(e.message ?: "无法申请存储权限")
        }
        return JSONObject().put("ok", true).put("granted", false).put("pending", true).toString()
    }

    /** 诊断：导出失败时把这几项一起写进日志/提示，便于真机定位。 */
    @JavascriptInterface
    fun diagnostics(): String = JSONObject()
        .put("sdk", Build.VERSION.SDK_INT)
        .put("canWriteLegacy", canWriteLegacyDownloads())
        .put("downloads", try {
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath
        } catch (e: Exception) {
            ""
        })
        .toString()

    /** MainActivity 转发系统权限回调：把结果送回页面，让前端自动重试导出。 */
    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != REQ_WRITE_STORAGE) return false
        val granted = grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        val js = "window.__SSDZAndroidStoragePermission && window.__SSDZAndroidStoragePermission($granted)"
        val view = webViewProvider()
        view?.post {
            try {
                view.evaluateJavascript(js, null)
            } catch (e: Exception) {
                Log.w(TAG, "permission callback failed", e)
            }
        }
        return true
    }

    private fun runSave(rawName: String, content: String, replace: Boolean): String {
        return try {
            val name = safeFileName(rawName)
            val bytes = content.toByteArray(Charsets.UTF_8)
            val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveViaMediaStore(name, bytes, replace)
            } else {
                saveToLegacyDownloads(name, bytes, replace)
            }
            Log.i(TAG, "export $name -> $result")
            result
        } catch (e: Exception) {
            Log.e(TAG, "export failed: $rawName", e)
            fail(e.message ?: e.javaClass.simpleName)
        }
    }

    /* ---------------- Android 10+：MediaStore（不需要存储权限） ---------------- */

    private fun saveViaMediaStore(name: String, bytes: ByteArray, replace: Boolean): String {
        val resolver = activity.contentResolver
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        // 新副本完成并发布之前保留旧行，写盘失败仍有上一份可恢复的备份。
        val old = if (replace) findExistingDownload(collection, name) else null
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values)
            ?: return fail("无法在系统下载目录创建文件")
        try {
            val out = resolver.openOutputStream(uri)
                ?: throw IOException("无法写入系统下载目录")
            out.use { it.write(bytes) }
            val written = readSize(uri)
            if (written != bytes.size.toLong()) {
                throw IOException("无法确认完整写入（$written/${bytes.size} 字节）")
            }
            val done = ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0)
                put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000)
            }
            if (resolver.update(uri, done, null, null) <= 0) {
                throw IOException("无法发布系统下载目录中的文件")
            }
            if (old != null) {
                try {
                    if (resolver.delete(old, null, null) > 0) {
                        // 插入时旧名字尚占用，系统可能加 (1)；旧副本删除后恢复固定名字。
                        val canonical = ContentValues().apply {
                            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                        }
                        if (resolver.update(uri, canonical, null, null) <= 0) {
                            Log.w(TAG, "auto backup published but name could not be restored")
                        }
                    } else {
                        Log.w(TAG, "auto backup published but old row could not be removed")
                    }
                } catch (e: Exception) {
                    // 新副本已经发布；旧副本清理失败不回滚这份完整备份。
                    Log.w(TAG, "auto backup published but old row cleanup failed", e)
                }
            }
            /* 系统可能因为同名文件已存在（例如卸载重装留下的旧行）自动改名成 "xxx (1).json"，
             * 返回真实名字，前端提示/日志才不会指错文件。 */
            val actualName = readDisplayName(uri, name)
            return ok("Download/$actualName", "mediastore", bytes.size)
        } catch (e: Exception) {
            try {
                resolver.delete(uri, null, null)
            } catch (ignored: Exception) {
            }
            throw e
        }
    }

    private fun findExistingDownload(collection: Uri, name: String): Uri? {
        val projection = arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.RELATIVE_PATH)
        val selection = MediaStore.MediaColumns.DISPLAY_NAME + "=?"
        return try {
            activity.contentResolver.query(collection, projection, selection, arrayOf(name), null)?.use { c ->
                while (c.moveToNext()) {
                    val relIdx = c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH)
                    val rel = if (relIdx >= 0) c.getString(relIdx) else null
                    /* 只认下载目录根下那一份；同名的子目录文件（玩家自己放的）不碰。 */
                    if (rel == null || rel.trimEnd('/') == Environment.DIRECTORY_DOWNLOADS) {
                        return@use ContentUris.withAppendedId(collection, c.getLong(0))
                    }
                }
                null
            }
        } catch (e: Exception) {
            Log.w(TAG, "query existing download failed", e)
            null
        }
    }

    private fun readSize(uri: Uri): Long = try {
        activity.contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L
    } catch (e: Exception) {
        -1L
    }

    private fun readDisplayName(uri: Uri, fallback: String): String = try {
        val projection = arrayOf(MediaStore.MediaColumns.DISPLAY_NAME)
        activity.contentResolver.query(uri, projection, null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else fallback
        } ?: fallback
    } catch (e: Exception) {
        fallback
    }

    /* ---------------- Android 9 及以下：公共 Download 目录 ---------------- */

    private fun saveToLegacyDownloads(name: String, bytes: ByteArray, replace: Boolean): String {
        if (!canWriteLegacyDownloads()) {
            /* 没授权时先留一份在应用外部目录（文件管理器能看到的 Android/data/...），
             * 同时告诉前端去申请权限；授权后会重试并覆盖成公共 Download 里那份。 */
            val fallback = try {
                val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                if (dir == null) {
                    ""
                } else {
                    if (!dir.exists()) dir.mkdirs()
                    val f = File(dir, name)
                    writeAtomically(f, bytes)
                    f.absolutePath
                }
            } catch (e: Exception) {
                ""
            }
            return JSONObject()
                .put("ok", false)
                .put("needPermission", true)
                .put("path", fallback)
                .put("msg", "需要「存储」权限才能写入系统下载目录")
                .toString()
        }
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!dir.exists() && !dir.mkdirs()) return fail("无法创建系统下载目录")
        val file = if (replace) File(dir, name) else uniqueFile(dir, name)
        writeAtomically(file, bytes)
        MediaScannerConnection.scanFile(
            activity,
            arrayOf(file.absolutePath),
            arrayOf("application/json"),
            null,
        )
        return ok("Download/" + file.name, "legacy", bytes.size)
    }

    /** 同目录临时文件写完并刷盘后用 POSIX rename 替换；API 24/25 也支持。
     *  rename 失败时旧文件未被截断，finally 只清理本次创建的临时文件。 */
    private fun writeAtomically(file: File, bytes: ByteArray) {
        val dir = file.parentFile ?: throw IOException("备份目录无效")
        val temp = File.createTempFile(".ssdz-backup-", ".tmp", dir)
        try {
            FileOutputStream(temp).use { out ->
                out.write(bytes)
                out.fd.sync()
            }
            if (temp.length() != bytes.size.toLong()) {
                throw IOException("备份写入不完整")
            }
            Os.rename(temp.absolutePath, file.absolutePath)
        } finally {
            if (temp.exists() && !temp.delete()) Log.w(TAG, "could not remove temporary backup")
        }
    }

    private fun canWriteLegacyDownloads(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.WRITE_EXTERNAL_STORAGE,
            ) == PackageManager.PERMISSION_GRANTED

    private fun uniqueFile(dir: File, name: String): File {
        var f = File(dir, name)
        if (!f.exists()) return f
        val dot = name.lastIndexOf('.')
        val base = if (dot > 0) name.substring(0, dot) else name
        val ext = if (dot > 0) name.substring(dot) else ""
        var i = 1
        while (f.exists()) {
            f = File(dir, "$base ($i)$ext")
            i++
        }
        return f
    }

    private fun safeFileName(raw: String): String {
        val base = raw.replace(Regex("""[\\/:*?"<>|]"""), "_").trim()
        val name = if (base.lowercase().endsWith(".json")) base else base + ".json"
        return if (name.length <= 120) name else name.take(116) + ".json"
    }

    private fun ok(path: String, method: String, bytes: Int): String = JSONObject()
        .put("ok", true)
        .put("path", path)
        .put("method", method)
        .put("bytes", bytes)
        .toString()

    private fun fail(msg: String): String = JSONObject().put("ok", false).put("msg", msg).toString()
}
