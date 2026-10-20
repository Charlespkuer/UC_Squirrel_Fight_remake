package com.ssdz.classic

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.io.File

/**
 * 安卓端「导出存档」落点。
 *
 * WebView 里 `<a download>` 默认会被 Tauri/Wry 存到应用私有目录
 * `/data/user/0/com.ssdz.classic/...`，普通文件管理器打不开。这里改用
 * MediaStore 把 JSON 写进系统「下载」目录（Android 10+ 不需要存储权限）；
 * Android 9 及以下退回应用外部目录（`Android/data/.../files/Download`），
 * 至少不再是 `/data/user/0` 这种完全不可见的路径。
 *
 * JS 侧入口：`window.SSDZAndroid.saveToDownloads(fileName, content)`。
 * 返回值是 JSON 字符串：`{ok:true,path:"Download/xxx.json"}` 或 `{ok:false,msg:"..."}`。
 */
class AndroidExportBridge(private val context: Context) {
    @JavascriptInterface
    fun saveToDownloads(fileName: String, content: String): String {
        return try {
            val safeName = safeFileName(fileName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveToPublicDownloads(safeName, content)
            } else {
                saveToLegacyDownloads(safeName, content)
            }
        } catch (e: Exception) {
            fail(e.message ?: "导出失败")
        }
    }

    private fun saveToPublicDownloads(fileName: String, content: String): String {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: return fail("无法在系统下载目录创建文件")
        val bytes = content.toByteArray(Charsets.UTF_8)
        val out = resolver.openOutputStream(uri)
            ?: return fail("无法写入系统下载目录")
        out.use { it.write(bytes) }
        values.clear()
        values.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        return ok("Download/$fileName")
    }

    private fun saveToLegacyDownloads(fileName: String, content: String): String {
        val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir
        if (!dir.exists() && !dir.mkdirs()) return fail("无法创建下载目录")
        val file = File(dir, fileName)
        file.writeText(content, Charsets.UTF_8)
        return ok(file.absolutePath)
    }

    private fun safeFileName(raw: String): String {
        val base = raw.replace(Regex("""[\\/:*?"<>|]"""), "_").trim()
        return if (base.lowercase().endsWith(".json")) base else base + ".json"
    }

    private fun ok(path: String): String = JSONObject().put("ok", true).put("path", path).toString()
    private fun fail(msg: String): String = JSONObject().put("ok", false).put("msg", msg).toString()
}
