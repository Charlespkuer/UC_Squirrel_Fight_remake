package com.ssdz.classic

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
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

/**
 * 安卓端「导出存档」落点（**所有受支持的 Android 版本都落到系统「下载」目录**）。
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
 */
class AndroidExportBridge(
    private val activity: Activity,
    private val webViewProvider: () -> WebView?,
) {
    companion object {
        private const val TAG = "SSDZExport"
        private const val REQ_WRITE_STORAGE = 0x5353
        const val AUTO_FILE_NAME = "松鼠大战-自动存档.json"
    }

    @JavascriptInterface
    fun saveToDownloads(fileName: String, content: String): String =
        runSave(fileName, content, replace = false)

    /** 自动存档导出：固定名字、覆盖上一份。 */
    @JavascriptInterface
    fun saveAutoBackup(content: String): String =
        runSave(AUTO_FILE_NAME, content, replace = true)

    /** 安卓沉浸模式：设置里的「状态栏」开关。隐藏/显示顶部状态栏，不碰底部导航栏。
     *  JS 侧：`window.SSDZAndroid.setSystemBarsHidden('1'|'0')`。 */
    @JavascriptInterface
    fun setSystemBarsHidden(hidden: String): String {
        val hide = hidden == "1" || hidden.equals("true", ignoreCase = true)
        activity.runOnUiThread {
            try {
                val window = activity.window
                val controller = WindowCompat.getInsetsController(window, window.decorView)
                if (hide) {
                    controller.hide(WindowInsetsCompat.Type.statusBars())
                    controller.systemBarsBehavior =
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                } else {
                    controller.show(WindowInsetsCompat.Type.statusBars())
                }
            } catch (_: Exception) {
                // 个别 ROM 的 insets controller 可能抛异常；不影响游戏本体。
            }
        }
        return JSONObject().put("ok", true).put("hidden", hide).toString()
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
        if (replace) {
            /* 覆盖自动存档：先删旧行再插新的。个别 ROM 上 openOutputStream("wt") 不截断，
             * 旧 JSON 的尾巴会留在新内容后面，读出来就是坏档 —— 删了重插最稳。 */
            val old = findExistingDownload(collection, name)
            if (old != null) {
                try {
                    resolver.delete(old, null, null)
                } catch (e: Exception) {
                    Log.w(TAG, "delete old auto backup failed", e)
                }
            }
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values)
            ?: return fail("无法在系统下载目录创建文件")
        try {
            val out = resolver.openOutputStream(uri) ?: return fail("无法写入系统下载目录")
            out.use { it.write(bytes) }
            val written = readSize(uri)
            if (written >= 0 && written != bytes.size.toLong()) {
                return fail("写入不完整（$written/${bytes.size} 字节）")
            }
            val done = ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0)
                put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000)
            }
            resolver.update(uri, done, null, null)
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
                    f.writeBytes(bytes)
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
        file.writeBytes(bytes)
        MediaScannerConnection.scanFile(
            activity,
            arrayOf(file.absolutePath),
            arrayOf("application/json"),
            null,
        )
        return ok("Download/" + file.name, "legacy", bytes.size)
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
