// 松鼠大战 怀旧复刻版 —— 轻量桌面窗口（Tauri 外壳）
//
// 设计目标：**本地尽量轻**。
//   * 不把前端资源嵌进二进制：启动时自己找游戏目录（有 index.html 的那个），
//     用一个内置的迷你 HTTP 文件服务器（本文件里，标准库实现）把它供起来，
//     窗口打开 http://127.0.0.1:<随机端口>/index.html。
//     → 可执行文件只有几 MB，前端就是仓库/游戏目录里那一份，**不再有一份副本**，
//       改了 css/js/images 不用重新打包，窗口里立刻就是新的（和网页版天然同一套代码）。
//   * 存档也不绕路：迷你服务器提供和 `references/tools/serve.js` 完全相同的
//     `/__save` 接口，写的就是 `<游戏目录>/save/progress.json`，
//     所以桌面版和网页版走的是同一个文件、同一套逻辑。
//   * 只有在「找不到游戏目录」时才退回编译时嵌进去的极简提示页
//     （`frontendDist: "empty"`，几百字节）——那种情况通常是安装包版的 exe 被单独挪走了。
//
// 存档 API（与 serve.js 对齐）：
//   GET  /__save?meta=1  → {ok, exists, savedAt, size}
//   GET  /__save         → {ok, exists, savedAt, data}
//   POST /__save         → 校验 JSON 对象后写盘，返回 {ok, savedAt}
// 外链 API（轻壳模式的「用浏览器打开」；安装版走 `open_external` 命令，安卓走 Kotlin 的
// `SSDZAndroid.openExternal` —— 应用进程里 spawn `am` 会被 ActivityManager 拒绝）：
//   GET  /__open?url=…   → 校验 http(s) 后交给系统默认浏览器，返回 {ok} / {ok:false,msg}
//   POST /__update?mode=check|git|release|auto[&dry=1]  → 跑 scripts/update-game.js 并把它的 JSON 回给页面
//        （「一键拉取远端更新」。真正干活的是那个零依赖 Node 脚本 —— 这样壳 / 便携版 / 浏览器
//          三边共用同一份逻辑；本机没装 Node 时返回 {ok:false,code:"NO_NODE"}，界面自己退到下载页）
#![cfg_attr(all(windows, not(mobile)), windows_subsystem = "windows")]

use std::fs;
#[cfg(not(mobile))]
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(not(mobile))]
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
#[cfg(not(mobile))]
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 单个存档上限：与网页版一致（4 MB）
const SAVE_MAX: usize = 4 * 1024 * 1024;

// ---------------------------------------------------------------- 游戏目录

/// 游戏目录：必须真的含 index.html，认错了就会去别的文件夹伺候文件
/// 游戏目录的标志文件：首页 index.html 住在 scripts/ 里（旧布局直接在根目录，也认）。
#[cfg(not(mobile))]
fn has_assets(dir: &Path) -> bool {
    dir.join("css").is_dir() || dir.join("js").is_dir() || dir.join("images").is_dir()
}

/// 在某个候选目录里找游戏，返回「伺候哪个目录」+「首页在其中的相对路径」。
/// 三种布局都认：
///   1) index.html 和资源同级（旧平铺布局）
///   2) 首页在 scripts\index.html、资源在项目根（2026-09 起的布局）
///   3) index.html 和资源都在 scripts\（自包含）
#[cfg(not(mobile))]
fn game_at(dir: &Path) -> Option<(PathBuf, String)> {
    if dir.join("index.html").is_file() && has_assets(dir) {
        return Some((dir.to_path_buf(), "index.html".to_string()));
    }
    let sub = dir.join("scripts");
    if sub.join("index.html").is_file() && has_assets(dir) {
        return Some((dir.to_path_buf(), "scripts/index.html".to_string()));
    }
    if sub.join("index.html").is_file() && has_assets(&sub) {
        return Some((sub, "index.html".to_string()));
    }
    None
}

#[cfg(not(mobile))]
fn find_game(dir: &Path) -> Option<(PathBuf, String)> {
    diag(&format!("候选：{}", dir.display()));
    let found = game_at(dir);
    match &found {
        Some((serve, entry)) => diag(&format!("  ✓ 采用 {}（首页 {entry}）", serve.display())),
        None => diag("  ✗ 这里没有 index.html（或 scripts\\index.html）+ 资源目录"),
    }
    found
}

#[cfg(not(mobile))]
fn find_game_root() -> Option<(PathBuf, String)> {
    let _ = fs::remove_file(
        std::env::var_os("TEMP").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(".")).join("ssdz-shell.log"),
    );
    // 1) 启动器（启动游戏.cmd / start-game.ps1）显式指定
    if let Some(v) = std::env::var_os("SSDZ_GAME_DIR") {
        diag(&format!("SSDZ_GAME_DIR = {}", PathBuf::from(&v).display()));
        if let Some(found) = find_game(&PathBuf::from(v)) {
            return Some(found);
        }
    }
    // 2) 当前工作目录，以及它往上的几层
    if let Ok(cwd) = std::env::current_dir() {
        let mut cur = Some(cwd);
        for i in 0..4 {
            let dir = match cur {
                Some(d) => d,
                None => break,
            };
            diag(&format!("cwd 上溯 {i}: {}", dir.display()));
            if let Some(found) = find_game(&dir) {
                return Some(found);
            }
            cur = dir.parent().map(|p| p.to_path_buf());
        }
    }
    // 3) 从可执行文件往上找（开发运行时 exe 在 src-tauri/dist 或 src-tauri/target/release）
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent().map(|p| p.to_path_buf());
        for i in 0..6 {
            let dir = match cur {
                Some(d) => d,
                None => break,
            };
            diag(&format!("exe 上溯 {i}: {}", dir.display()));
            if let Some(found) = find_game(&dir) {
                return Some(found);
            }
            cur = dir.parent().map(|p| p.to_path_buf());
        }
    }
    None
}

/// 诊断用：设了 SSDZ_SHELL_LOG=1 就把「找游戏目录」的过程写到 %TEMP%\ssdz-shell.log。
/// 双击 exe 报「没找到游戏目录」时可以靠它一眼看出它到底找过哪些目录。
#[cfg(not(mobile))]
fn diag(msg: &str) {
    if std::env::var_os("SSDZ_SHELL_LOG").is_none() {
        return;
    }
    let dir = std::env::var_os("TEMP")
        .or_else(|| std::env::var_os("TMP"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let file = dir.join("ssdz-shell.log");
    let mut text = fs::read_to_string(&file).unwrap_or_default();
    text.push_str(msg);
    text.push('\n');
    let _ = fs::write(&file, text);
}


#[cfg(not(mobile))]
fn dir_writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".ssdz-write-test");
    match fs::write(&probe, b"1") {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 存档位置：
///   · 桌面：优先游戏目录里的 save/，不可写（例如装到 Program Files）才用系统应用数据目录；
///   · 移动端（Android/iOS）：页面是嵌进安装包的，外面没有「游戏目录」，只写应用私有数据目录。
#[cfg(not(mobile))]
fn resolve_save(handle: &tauri::AppHandle, root: Option<&Path>) -> PathBuf {
    if let Some(root) = root {
        let dir = root.join("save");
        if dir_writable(&dir) {
            return dir.join("progress.json");
        }
    }
    let dir = handle
        .path()
        .app_data_dir()
        .map(|d| d.join("save"))
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir.join("progress.json")
}

#[cfg(mobile)]
fn resolve_save(handle: &tauri::AppHandle, _root: Option<&Path>) -> PathBuf {
    let dir = handle
        .path()
        .app_data_dir()
        .map(|d| d.join("save"))
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir.join("progress.json")
}
// ---------------------------------------------------------------- 迷你服务器

/// 内置迷你服务器的上下文：伺候哪个目录、首页在其中的相对路径、存档写到哪。
#[cfg(not(mobile))]
struct Ctx {
    root: PathBuf,
    /// 首页在 root 里的相对路径（新布局是 scripts/index.html）
    entry: String,
    save: PathBuf,
}

#[cfg(not(mobile))]
fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "webmanifest" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "mp3" => "audio/mpeg",
        "ogg" | "oga" => "audio/ogg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn file_meta(path: &Path) -> (bool, u64, u64) {
    match fs::metadata(path) {
        Ok(st) => {
            let ms = st
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or_else(now_ms);
            (true, ms, st.len())
        }
        Err(_) => (false, 0, 0),
    }
}

#[cfg(not(mobile))]
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(not(mobile))]
fn respond(out: &mut TcpStream, status: u16, mime: &str, body: &[u8]) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "OK",
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n",
        status,
        reason,
        mime,
        body.len()
    );
    out.write_all(head.as_bytes())?;
    out.write_all(body)?;
    out.flush()
}

#[cfg(not(mobile))]
fn respond_json(out: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    respond(out, status, "application/json; charset=utf-8", body.as_bytes())
}

#[cfg(not(mobile))]
fn json_err(msg: &str) -> String {
    format!("{{\"ok\":false,\"msg\":{}}}", serde_json::Value::from(msg))
}

/// /__save：与 references/tools/serve.js 的行为保持一致
#[cfg(not(mobile))]
fn save_api(method: &str, query: &str, body: &[u8], ctx: &Ctx, out: &mut TcpStream) -> std::io::Result<()> {
    match method {
        "GET" | "HEAD" => {
            let (exists, saved_at, size) = file_meta(&ctx.save);
            if query.split('&').any(|kv| kv == "meta=1" || kv == "meta") {
                let body = format!(
                    "{{\"ok\":true,\"exists\":{},\"savedAt\":{},\"size\":{}}}",
                    exists, saved_at, size
                );
                return respond_json(out, 200, &body);
            }
            if !exists {
                return respond_json(out, 200, "{\"ok\":true,\"exists\":false,\"savedAt\":0,\"data\":null}");
            }
            match fs::read_to_string(&ctx.save) {
                Ok(text) => {
                    let body = format!(
                        "{{\"ok\":true,\"exists\":true,\"savedAt\":{},\"data\":{}}}",
                        saved_at,
                        serde_json::Value::from(text)
                    );
                    respond_json(out, 200, &body)
                }
                Err(e) => respond_json(out, 500, &json_err(&format!("读取存档失败：{e}"))),
            }
        }
        "POST" => {
            if body.len() > SAVE_MAX {
                return respond_json(out, 413, &json_err("存档太大"));
            }
            let text = match std::str::from_utf8(body) {
                Ok(t) => t,
                Err(_) => return respond_json(out, 400, &json_err("存档不是合法 UTF-8")),
            };
            match serde_json::from_str::<serde_json::Value>(text) {
                Ok(v) if v.is_object() => {}
                Ok(_) => return respond_json(out, 400, &json_err("存档必须是对象")),
                Err(_) => return respond_json(out, 400, &json_err("不是合法 JSON")),
            }
            if let Some(dir) = ctx.save.parent() {
                let _ = fs::create_dir_all(dir);
            }
            match fs::write(&ctx.save, text) {
                Ok(_) => {
                    let (_, saved_at, _) = file_meta(&ctx.save);
                    respond_json(out, 200, &format!("{{\"ok\":true,\"savedAt\":{saved_at}}}"))
                }
                Err(e) => respond_json(out, 500, &json_err(&format!("写入存档失败：{e}"))),
            }
        }
        _ => respond_json(out, 405, &json_err("只支持 GET / POST")),
    }
}

/// 导出前统一校验：体积上限 + 必须是合法 JSON 对象。桌面 / iOS 共用。
fn validate_export_data(data: &str) -> Result<(), String> {
    if data.len() > SAVE_MAX {
        return Err("存档太大（超过 4 MB）".into());
    }
    serde_json::from_str::<serde_json::Value>(data).map_err(|_| "存档不是合法 JSON".to_string())?;
    Ok(())
}

/// 同名文件不覆盖：`松鼠大战存档.json` 已存在时依次尝试 `(1)`、`(2)` …
fn unique_export_path(dir: &Path, name: &str) -> PathBuf {
    let mut path = dir.join(name);
    if path.exists() {
        let stem = Path::new(name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "松鼠大战存档".to_string());
        let ext = Path::new(name)
            .extension()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "json".to_string());
        for i in 1..1000 {
            path = dir.join(format!("{stem} ({i}).{ext}"));
            if !path.exists() {
                break;
            }
        }
    }
    path
}

/// 文件名清洗：去掉路径分隔符 / 控制字符，保证永远不会写出目标目录。
fn sanitize_export_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let base = cleaned.trim();
    let mut name = if base.is_empty() { "松鼠大战存档".to_string() } else { base.to_string() };
    if !name.to_lowercase().ends_with(".json") {
        name.push_str(".json");
    }
    if name.chars().count() > 120 {
        let cut: String = name.chars().take(116).collect();
        name = cut + ".json";
    }
    name
}

/// 把存档写到系统「下载」目录（桌面导出 / 便携轻壳的 `/__export` 共用）。
/// Windows 用 Known Folder（`dirs`），兼容 OneDrive 重定向；macOS/Linux 走 `$HOME/Downloads`。
#[cfg(not(mobile))]
fn export_to_downloads(file_name: &str, data: &str) -> Result<serde_json::Value, String> {
    validate_export_data(data)?;
    let dir = dirs::download_dir().ok_or_else(|| "找不到系统下载目录".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    let path = unique_export_path(&dir, &sanitize_export_name(file_name));
    fs::write(&path, data).map_err(|e| format!("写入下载目录失败：{e}"))?;
    Ok(serde_json::json!({ "ok": true, "path": path.to_string_lossy() }))
}

/// iOS 导出：写进 App 沙盒的 `Documents/`。Info.ios.plist 已声明
/// `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`，这个目录会出现在
/// 「文件」App → 我的 iPhone/iPad → 松鼠大战；玩家可以从这里再点「导入存档」选回来，
/// 也可以用「文件」App 拷到 iCloud / 另一台设备。
#[cfg(target_os = "ios")]
fn export_to_documents(app: &tauri::AppHandle, file_name: &str, data: &str) -> Result<serde_json::Value, String> {
    validate_export_data(data)?;
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| format!("找不到 App 的 Documents 目录：{e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建 Documents 目录失败：{e}"))?;
    let name = sanitize_export_name(file_name);
    let path = unique_export_path(&dir, &name);
    fs::write(&path, data).map_err(|e| format!("写入 Documents 失败：{e}"))?;
    let saved = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or(name);
    Ok(serde_json::json!({
        "ok": true,
        "path": path.to_string_lossy(),
        "name": saved,
        "display": format!("「文件」App → 我的 iPhone/iPad → 松鼠大战 → {saved}"),
    }))
}

#[cfg(not(mobile))]
fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        if percent_decode(k) == key {
            Some(percent_decode(v))
        } else {
            None
        }
    })
}

/// `/__export?name=…`：轻壳模式（页面来自 127.0.0.1，IPC 会被 ACL 拒）的桌面导出入口。
#[cfg(not(mobile))]
fn export_api(method: &str, query: &str, body: &[u8], out: &mut TcpStream) -> std::io::Result<()> {
    if method != "POST" {
        return respond_json(out, 405, &json_err("只支持 POST"));
    }
    let name = query_param(query, "name").unwrap_or_else(|| "松鼠大战存档.json".to_string());
    let text = match std::str::from_utf8(body) {
        Ok(t) => t,
        Err(_) => return respond_json(out, 400, &json_err("存档不是合法 UTF-8")),
    };
    match export_to_downloads(&name, text) {
        Ok(v) => respond_json(out, 200, &v.to_string()),
        Err(msg) => respond_json(out, 500, &json_err(&msg)),
    }
}

/// 用系统默认浏览器打开一个 http(s) 链接。
///   桌面：Windows `cmd /C start`／macOS `open`／Linux `xdg-open`
///   安卓：**不在这里做** —— 从应用进程 spawn `am start` 会被 ActivityManager 按
///     「com.android.shell 不属于本应用 uid」拒掉（SecurityException），而且 spawn 成功
///     不代表 Intent 成功，页面会把「没打开」当成成功。安卓统一走 Kotlin 的
///     `SSDZAndroid.openExternal`（前端在 main.js 里优先调它），这里只返回明确错误。
///   链接先做白名单校验（只允许 http(s)、只允许可见 ASCII、禁掉 shell 元字符），
/// 免得把一个带 `&` / `"` 的字符串交给 shell 解析。
fn spawn_opener(url: &str) -> std::io::Result<()> {
    let ok = (url.starts_with("https://") || url.starts_with("http://"))
        && url.chars().all(|c| c.is_ascii_graphic())
        && !url.contains(['"', '\'', '&', '|', '^', '<', '>', '`']);
    if !ok {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "链接不合法（只允许 http(s) 网址）"));
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn().map(|_| ())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn().map(|_| ())
    }
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "android"), not(target_os = "ios")))]
    {
        std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ())
    }
    #[cfg(target_os = "android")]
    {
        let _ = url;
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "安卓端请调用 window.SSDZAndroid.openExternal（Kotlin 直接发 ACTION_VIEW）",
        ))
    }
    #[cfg(target_os = "ios")]
    {
        let _ = url;
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "iOS 请改用 tauri-plugin-opener"))
    }
}

/// 命令：`open_external` —— 安装版 / iOS（页面来自 tauri.localhost / tauri://）打开系统浏览器。
/// 轻壳模式（页面来自 127.0.0.1 的本地服务器）走上面的 `/__open`，因为那边 IPC 会被 ACL 拒。
/// 安卓不走这里（`spawn_opener` 会直接报错），见该函数的注释。
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    spawn_opener(&url).map_err(|e| e.to_string())
}

/// /__open?url=…：轻壳模式的「打开外部链接」入口（普通 HTTP，不受 Tauri capability 限制）。
#[cfg(not(mobile))]
fn open_api(query: &str, out: &mut TcpStream) -> std::io::Result<()> {
    let url = query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == "url")
        .map(|(_, v)| percent_decode(v))
        .unwrap_or_default();
    match spawn_opener(&url) {
        Ok(_) => respond_json(out, 200, "{\"ok\":true}"),
        Err(e) => respond_json(out, 400, &json_err(&format!("打开浏览器失败：{e}"))),
    }
}

/// /__update?mode=…[&dry=1][&asset=…]：跑 scripts/update-game.js，把它的 stdout JSON 原样回给页面。
/// 参数全部白名单校验；**不接受客户端传命令 / URL**，脚本路径也由壳自己拼。
#[cfg(not(mobile))]
fn update_api(query: &str, mode_allowed: bool, ctx: &Ctx, out: &mut TcpStream) -> std::io::Result<()> {
    let mut mode = String::from("auto");
    let mut asset = String::new();
    let mut platform = String::new();
    let mut dry = false;
    for kv in query.split('&') {
        let (k, v) = match kv.split_once('=') {
            Some((k, v)) => (k, percent_decode(v)),
            None => (kv, String::new()),
        };
        match k {
            "mode" => mode = v,
            "asset" => asset = v,
            "platform" => platform = v,
            "dry" => dry = v == "1" || v == "true",
            _ => {}
        }
    }
    if !["auto", "check", "git", "release"].contains(&mode.as_str()) {
        return respond_json(out, 400, &json_err("不认识的更新方式"));
    }
    let asset_ok = asset.is_empty()
        || (asset.len() <= 120
            && asset.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')));
    if !asset_ok {
        return respond_json(out, 400, &json_err("资源名不合法"));
    }
    let platform_ok = platform.is_empty()
        || ["darwin", "win32", "linux", "android"].contains(&platform.as_str());
    if !platform_ok {
        return respond_json(out, 400, &json_err("平台参数不合法"));
    }
    if mode != "check" && !mode_allowed {
        // mode_allowed = 这次请求是 POST（更新会改文件，只允许 POST）
        return respond_json(out, 405, &json_err("更新动作只接受 POST"));
    }
    let script = ctx.root.join("scripts").join("update-game.js");
    if !script.exists() {
        return respond_json(out, 501, "{\"ok\":false,\"code\":\"NO_HELPER\",\"msg\":\"这个包里没有 scripts/update-game.js，无法一键更新\"}");
    }
    let mut cmd = std::process::Command::new("node");
    cmd.arg(&script).arg("--json").arg(format!("--mode={mode}")).arg(format!("--root={}", ctx.root.display()));
    if dry {
        cmd.arg("--dry");
    }
    if !asset.is_empty() {
        cmd.arg(format!("--asset={asset}"));
    }
    if !platform.is_empty() {
        cmd.arg(format!("--platform={platform}"));
    }
    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            let code = if e.kind() == std::io::ErrorKind::NotFound { "NO_NODE" } else { "SPAWN_FAILED" };
            let msg = if code == "NO_NODE" {
                "这台机器上没有找到 node，无法一键更新；请用「打开下载页」手动更新".to_string()
            } else {
                format!("起不了更新脚本：{e}")
            };
            let body = format!("{{\"ok\":false,\"code\":\"{code}\",\"msg\":{}}}", serde_json::Value::from(msg));
            return respond_json(out, 200, &body);
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let last = stdout.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("").trim().to_string();
    let log_lines: Vec<&str> = stderr.lines().filter(|l| !l.trim().is_empty()).collect();
    let log_tail: Vec<&str> = log_lines.iter().rev().take(8).rev().cloned().collect();
    match serde_json::from_str::<serde_json::Value>(&last) {
        Ok(mut v) => {
            if v.is_object() {
                v["log"] = serde_json::Value::from(log_tail);
            }
            respond_json(out, 200, &v.to_string())
        }
        Err(_) => {
            let msg = format!("更新脚本没有返回结果：{}", stderr.trim());
            let body = format!("{{\"ok\":false,\"code\":\"HELPER_FAILED\",\"msg\":{}}}", serde_json::Value::from(msg));
            respond_json(out, 500, &body)
        }
    }
}

/// 返回 true = 该关连接
#[cfg(not(mobile))]
fn handle_request(method: &str, target: &str, body: &[u8], ctx: &Ctx, out: &mut TcpStream) -> std::io::Result<bool> {
    let (raw_path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target, ""),
    };
    let path = percent_decode(raw_path);
    if path == "/__save" {
        save_api(method, query, body, ctx, out)?;
        return Ok(false);
    }
    /* 「自愿支持作者」等外链：轻壳模式下页面来自 http://127.0.0.1:端口，
     * 这种「远端来源」调不了 Tauri IPC（capability 会给 ACL 拒绝），所以走这条普通 HTTP。 */
    if path == "/__open" {
        open_api(query, out)?;
        return Ok(false);
    }
    /* 「一键拉取远端更新」：轻壳模式下页面来自 127.0.0.1，调不了 IPC，所以也走这条普通 HTTP。
     * 只有 POST 才会真的改文件（check 允许 GET）。 */
    if path == "/__update" {
        update_api(query, method == "POST", ctx, out)?;
        return Ok(false);
    }
    /* 桌面「导出存档」：轻壳模式页面来自 127.0.0.1，调不了 Tauri IPC，走普通 HTTP 落下载目录。 */
    if path == "/__export" {
        export_api(method, query, body, out)?;
        return Ok(false);
    }
    if method != "GET" && method != "HEAD" {
        respond(out, 405, "text/plain; charset=utf-8", "只支持 GET / HEAD".as_bytes())?;
        return Ok(false);
    }
    // 和 scripts/serve.js 一样：地址栏是 / 或 /index.html 时映射到真正的首页
    // （首页在 scripts/index.html，而页面里的 css/… 是按 URL 根解析的，所以地址必须是 /）
    let rel = if path == "/" || path == "/index.html" {
        ctx.entry.clone()
    } else {
        path.trim_start_matches('/').to_string()
    };
    // 只允许「一层层普通目录 + 文件名」的相对路径：挡掉 ../、盘符、UNC 这些越界写法。
    // 注意别去检查 join 之后的绝对路径——Windows 上它自带 Prefix/RootDir 两个组件，
    // 那样写会把所有正常请求都判成 403（这一版踩过）。
    let rel_path = Path::new(&rel);
    let safe = !rel.is_empty()
        && !rel.contains(':')
        && rel_path
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    if !safe {
        respond(out, 403, "text/plain; charset=utf-8", b"forbidden")?;
        return Ok(false);
    }
    let candidate = ctx.root.join(rel_path);
    match fs::read(&candidate) {
        Ok(data) => {
            respond(out, 200, mime_for(&candidate), &data)?;
            Ok(false)
        }
        Err(_) => {
            respond(out, 404, "text/plain; charset=utf-8", b"not found")?;
            Ok(false)
        }
    }
}

#[cfg(not(mobile))]
fn handle_conn(stream: TcpStream, ctx: Arc<Ctx>) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    let _ = stream.set_nodelay(true);
    let mut reader = BufReader::new(stream.try_clone()?);
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let line = line.trim_end().to_string();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split(' ');
        let method = parts.next().unwrap_or("").to_ascii_uppercase();
        let target = parts.next().unwrap_or("/").to_string();

        let mut len = 0usize;
        let mut keep_alive = true;
        loop {
            let mut header = String::new();
            if reader.read_line(&mut header)? == 0 {
                break;
            }
            let header = header.trim_end();
            if header.is_empty() {
                break;
            }
            let lower = header.to_ascii_lowercase();
            if let Some(v) = lower.strip_prefix("content-length:") {
                len = v.trim().parse().unwrap_or(0);
            } else if lower.starts_with("connection:") {
                keep_alive = !lower.contains("close");
            }
        }
        if len > SAVE_MAX * 2 {
            let mut out = stream.try_clone()?;
            respond(&mut out, 413, "text/plain; charset=utf-8", b"too large")?;
            return Ok(());
        }
        let mut body = vec![0u8; len];
        if len > 0 {
            reader.read_exact(&mut body)?;
        }
        let mut out = stream.try_clone()?;
        let close = handle_request(&method, &target, &body, &ctx, &mut out)?;
        if close || !keep_alive {
            return Ok(());
        }
    }
}

/// 起服务器，返回实际监听的端口（随机端口，避免和网页版的 8080 撞车）
#[cfg(not(mobile))]
fn start_server(ctx: Arc<Ctx>) -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let ctx = ctx.clone();
                    thread::spawn(move || {
                        let _ = handle_conn(s, ctx);
                    });
                }
                Err(_) => continue,
            }
        }
    });
    Ok(port)
}

// ---------------------------------------------------------------- 存档命令
// 走内置服务器时页面用 /__save（和网页版一样）；只有安装包模式（页面在 tauri://localhost）
// 才会用这几个命令，两条路的存档文件是同一个。

struct SaveState {
    file: PathBuf,
}

/* ---------- 存档盘面：主文件 + 上一次的备份 + 等级水位线 ----------
 * iOS 换包更新时最怕的不是某一次写盘失败，而是**错误的档被当成最新档**：
 * 启动早期原生桥还没就绪 → 页面先拿浏览器里的 1 级兜底档进游戏 → 桥接一到，
 * 一次自动保存就把磁盘上几十级的 progress.json 写成 1 级；下一次启动又读回旧文件 ——
 * 玩家看到的就是「初始存档与有进度的存档横跳」。
 *
 * 这里把落盘做成三道保险：
 *   1. **原子写**：先写同目录临时文件、fsync，再 rename 覆盖主文件。进程被杀只会留下
 *      临时文件，主文件要么是旧版、要么是新版，不会变成半截 JSON。
 *   2. **上一版备份** progress.bak.json：每次覆盖前把当前有效主文件复制过去；
 *      主文件损坏/丢失时 save_read 自动读备份并把它修回主文件。
 *   3. **1 级空档保护**：主文件（或备份）里已有进度时，拒绝写入一份「全新 1 级档」；
 *      只有调试面板「彻底重置账号」显式带 force=true 才放行。转生档 reborn>0 不算空档。 */
fn save_bak_path(file: &Path) -> PathBuf {
    file.with_file_name("progress.bak.json")
}

fn save_mark_path(file: &Path) -> PathBuf {
    file.with_file_name(".min-level")
}

fn read_json_file(path: &Path) -> Option<(String, serde_json::Value)> {
    let text = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    if !value.is_object() {
        return None;
    }
    Some((text, value))
}

/** 一份存档里的最高等级（双槽取两槽最大；与 scripts/serve.js 的 saveMaxLevel 同口径）。 */
fn save_max_level(value: &serde_json::Value) -> u64 {
    let one = |v: &serde_json::Value| v.get("level").and_then(|x| x.as_u64()).unwrap_or(0);
    let mut level = one(value);
    if let Some(other) = value.get("__dualOther") {
        level = level.max(one(other));
    }
    if let Some(slots) = value.get("__dualSaves").and_then(|x| x.as_object()) {
        for slot in slots.values() {
            level = level.max(one(slot));
        }
    }
    level
}

/** 是不是「刚建的新档」：只有 1 级、没打过胜仗、没通关过、也不是转生。
 *  ⚠ 不能只看等级：转生果会把等级降回 1（reborn>0），那是合法存档。 */
fn save_is_fresh(value: &serde_json::Value) -> bool {
    if save_max_level(value) > 1 {
        return false;
    }
    if save_reborn(value) > 0 {
        return false;
    }
    if value.get("allWins").and_then(|x| x.as_u64()).unwrap_or(0) > 0 {
        return false;
    }
    if let Some(stages) = value.get("stages").and_then(|x| x.as_object()) {
        if !stages.is_empty() {
            return false;
        }
    }
    true
}

fn save_reborn(value: &serde_json::Value) -> u64 {
    value.get("reborn").and_then(|x| x.as_u64()).unwrap_or(0)
}

fn save_has_progress(value: &serde_json::Value) -> bool {
    if save_max_level(value) >= 5 {
        return true;
    }
    if value.get("allWins").and_then(|x| x.as_u64()).unwrap_or(0) > 0 {
        return true;
    }
    value.get("stages").and_then(|x| x.as_object()).map(|s| !s.is_empty()).unwrap_or(false)
}

/** 写主文件前的唯一一道「能不能覆盖」判断（命令与单测共用）。 */
fn guard_save_write(current: Option<&serde_json::Value>, incoming: &serde_json::Value, force: bool) -> Result<(), String> {
    if force {
        return Ok(());
    }
    if let Some(cur) = current {
        let cur_level = save_max_level(cur);
        let new_level = save_max_level(incoming);
        /* 只要新档比磁盘档低，就默认是「旧兜底档/初始档回来了」。
         * 唯一合法的降级是转生果：`reborn` 会 +1；调试面板的重置走 force。 */
        if new_level < cur_level && save_reborn(incoming) <= save_reborn(cur) {
            let what = if save_is_fresh(incoming) {
                "全新的 1 级空档".to_string()
            } else {
                format!("{} 级旧档", new_level)
            };
            return Err(format!(
                "存档文件里已有 {} 级进度，已拒绝用{}覆盖（确需重置请在调试面板「彻底重置账号」）",
                cur_level, what
            ));
        }
    }
    Ok(())
}

fn read_min_level(file: &Path) -> u64 {
    fs::read_to_string(save_mark_path(file))
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0)
}

fn write_min_level(file: &Path, level: u64) {
    let _ = fs::write(save_mark_path(file), level.to_string());
}

/** 临时文件 + fsync + rename：主文件永远是一份完整 JSON。 */
fn write_file_atomic(path: &Path, data: &str) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "存档路径没有父目录"))?;
    fs::create_dir_all(dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("progress.json");
    let tmp = dir.join(format!(".{name}.{}.{}.tmp", std::process::id(), now_ms()));
    {
        use std::io::Write as _;
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data.as_bytes())?;
        file.sync_all()?;
    }
    #[cfg(windows)]
    {
        // Windows 的 rename 不能覆盖已存在文件；先删旧文件。iOS/Unix 走原子 rename。
        let _ = fs::remove_file(path);
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    #[cfg(unix)]
    {
        if let Ok(dir_handle) = fs::File::open(dir) {
            let _ = dir_handle.sync_all();
        }
    }
    Ok(())
}

fn backup_save_file(file: &Path, valid: bool) {
    if valid {
        let bak = save_bak_path(file);
        /* **不要用更低的档覆盖更高的备份**：主文件若已经被旧版 1 级档覆盖过，
         * 备份里的几十级进度是最后一次找回进度的机会；玩家从 1 级再升到 2 级时
         * 不能把这份备份冲掉。只有主文件等级追平/超过备份时才滚动备份。
         * （显式 force 重置会在写完后单独把备份同步成新档。） */
        let main_level = read_json_file(file).map(|(_, v)| save_max_level(&v)).unwrap_or(0);
        let bak_level = read_json_file(&bak).map(|(_, v)| save_max_level(&v)).unwrap_or(0);
        if bak_level > main_level {
            return;
        }
        let _ = fs::copy(file, bak);
    } else {
        /* 主文件读不出来也不能直接丢：留一份 progress.corrupt.json 供人工恢复。 */
        let _ = fs::copy(file, file.with_file_name("progress.corrupt.json"));
    }
}

#[tauri::command]
fn save_path(state: tauri::State<SaveState>) -> String {
    state.file.to_string_lossy().to_string()
}

#[tauri::command]
fn save_meta(state: tauri::State<SaveState>) -> serde_json::Value {
    let (main_exists, main_at, size) = file_meta(&state.file);
    let (bak_exists, bak_at, _) = file_meta(&save_bak_path(&state.file));
    let main = read_json_file(&state.file);
    let bak = read_json_file(&save_bak_path(&state.file));
    let level = main.as_ref().map(|(_, v)| save_max_level(v))
        .or_else(|| bak.as_ref().map(|(_, v)| save_max_level(v)))
        .unwrap_or(0);
    let reborn = main.as_ref().map(|(_, v)| save_reborn(v)).unwrap_or(0)
        .max(bak.as_ref().map(|(_, v)| save_reborn(v)).unwrap_or(0));
    serde_json::json!({
        "ok": true,
        "exists": main_exists || bak_exists,
        "savedAt": main_at.max(bak_at),
        "size": size,
        "path": state.file.to_string_lossy(),
        "reborn": reborn,
        "maxLevel": level,
        "minLevel": read_min_level(&state.file),
        "backup": bak_exists,
        "corrupt": main_exists && main.is_none(),
        "recovered": main.is_none() && bak.is_some(),
    })
}

fn save_read_at(main_path: &Path) -> Result<serde_json::Value, String> {
    let bak_path = save_bak_path(main_path);
    let (main_exists, main_at, _) = file_meta(main_path);
    let (bak_exists, bak_at, _) = file_meta(&bak_path);
    let main = read_json_file(main_path);
    let bak = read_json_file(&bak_path);
    /* 两边都有效时不要无脑信主文件：主文件可能已经被旧版 1 级空档覆盖过，
     * 而备份里还留着几十级进度。正常情况下选等级更高的一份；转生档是例外 ——
     * 转生后等级合法地回到 1，但 reborn 会比备份大，这时必须信主文件，
     * 不能被备份里的「前前世」进度救回去。 */
    let pick_backup = match (main.as_ref(), bak.as_ref()) {
        (Some((_, m)), Some((_, b))) => save_reborn(m) <= save_reborn(b) && save_max_level(b) > save_max_level(m),
        _ => false,
    };
    let (text, value, saved_at, from_backup) = if pick_backup {
        let (t, v) = bak.unwrap();
        (t, v, bak_at, true)
    } else {
        match (main, bak) {
            (Some((t, v)), _) => (t, v, main_at, false),
            (None, Some((t, v))) => (t, v, bak_at, true),
            (None, None) if main_exists => {
                return Err("存档文件损坏，且没有可用的 progress.bak.json；请到「系统 → 导入存档」恢复".into());
            }
            (None, None) => {
                return Ok(serde_json::json!({
                    "ok": true, "exists": false, "savedAt": 0, "data": null,
                    "path": main_path.to_string_lossy(), "maxLevel": 0, "backup": false,
                }));
            }
        }
    };
    let saved_at = if from_backup {
        /* 备份可用：立刻把它修回主文件，下一次读写就走正常路径。
         * 返回修复后的主文件 mtime：玩家端会把这个值当作 `S.savedAt`，
         * 如果还返回备份的旧 mtime，下一次自动保存会误判「文件更新」而跳过。 */
        let _ = write_file_atomic(main_path, &text);
        file_meta(main_path).1
    } else {
        saved_at
    };
    Ok(serde_json::json!({
        "ok": true,
        "exists": true,
        "savedAt": saved_at,
        "data": text,
        "path": main_path.to_string_lossy(),
        "maxLevel": save_max_level(&value),
        "reborn": save_reborn(&value),
        "backup": bak_exists,
        "recoveredFrom": if from_backup { "backup" } else { "" },
    }))
}

fn save_write_at(main_path: &Path, data: &str, force: bool) -> Result<serde_json::Value, String> {
    if data.len() > SAVE_MAX {
        return Err("存档太大（超过 4 MB）".into());
    }
    let incoming = serde_json::from_str::<serde_json::Value>(data)
        .map_err(|_| "存档不是合法 JSON".to_string())?;
    if !incoming.is_object() || incoming.is_array() {
        return Err("存档必须是 JSON 对象".into());
    }
    let bak_path = save_bak_path(main_path);
    let main = read_json_file(main_path);
    let bak = read_json_file(&bak_path);
    /* 主文件损坏时用备份里的等级判断「是不是已有进度」，别让 1 级空档把备份也盖掉。
     * 两边都能读时取等级更高的那份做保护：万一主文件已经被旧版 1 级档覆盖过，
     * 备份里的几十级进度仍能拦住第二次覆盖。 */
    let current = match (main.as_ref(), bak.as_ref()) {
        (Some((_, a)), Some((_, b))) => Some(if save_max_level(b) > save_max_level(a) { b } else { a }),
        (Some((_, a)), None) => Some(a),
        (None, Some((_, b))) => Some(b),
        (None, None) => None,
    };
    guard_save_write(current, &incoming, force)?;

    let main_exists = main_path.exists();
    if force {
        /* 显式重置：先把旧备份拿掉。否则「主文件已写成 1 级、复制备份前进程被杀」
         * 会让下一次 save_read 又从旧备份把 40 级救回来，重置看起来没生效。
         * 主文件本身在原子写完成前仍是旧档，不会丢；写完后同步新备份。 */
        let _ = fs::remove_file(&bak_path);
    } else if main_exists {
        backup_save_file(main_path, main.is_some());
    }
    write_file_atomic(main_path, data).map_err(|e| format!("写存档失败：{e}"))?;
    if force {
        /* 导入/重置：**写完立刻读回核对**，别让「提示成功、文件没变」再发生一次。
         * 普通自动保存不额外读 700 KB；导入是一次性动作，多读一遍值得。 */
        match fs::read_to_string(main_path) {
            Ok(written) if written == data => {}
            Ok(_) => return Err("写入后核对失败：文件内容和要导入的存档不一致".into()),
            Err(e) => return Err(format!("写入后核对失败：{e}")),
        }
        /* 玩家明确重置/导入：备份也同步成新档，避免旧的高等级备份继续挡住后续新档。 */
        let _ = fs::copy(main_path, &bak_path);
    }
    let level = save_max_level(&incoming);
    let mark = read_min_level(main_path);
    write_min_level(main_path, mark.max(level));
    let (_, saved_at, _) = file_meta(main_path);
    Ok(serde_json::json!({
        "ok": true, "savedAt": saved_at, "path": main_path.to_string_lossy(),
        "maxLevel": level, "minLevel": mark.max(level), "backup": bak_path.exists(),
    }))
}

#[tauri::command]
fn save_read(state: tauri::State<SaveState>) -> Result<serde_json::Value, String> {
    save_read_at(&state.file)
}

#[tauri::command]
fn save_write(state: tauri::State<SaveState>, data: String, force: Option<bool>) -> Result<serde_json::Value, String> {
    save_write_at(&state.file, &data, force.unwrap_or(false))
}

/// 导入列表只列 App 自己 `Documents/` 里的 `.json`：iOS 的 WKWebView **没有实现**
/// `runOpenPanelWithParameters`（wry 只在 macOS 实现了文件选择面板），页面里的
/// `<input type=file>` 在 iOS 16~24 上点不开。导入改用「原生列目录 + 读取」，
/// 不依赖系统文件选择器，也不申请任何额外权限。
#[cfg(target_os = "ios")]
fn safe_import_name(raw: &str) -> Result<&str, String> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > 180 {
        return Err("存档文件名不合法".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') || name == "." || name == ".." {
        return Err("存档文件名不合法".into());
    }
    if Path::new(name).file_name().and_then(|s| s.to_str()) != Some(name) {
        return Err("存档文件名不合法".into());
    }
    if !name.to_ascii_lowercase().ends_with(".json") {
        return Err("只能读取 .json 存档".into());
    }
    Ok(name)
}

#[cfg(target_os = "ios")]
fn documents_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| format!("找不到 App 的 Documents 目录：{e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建 Documents 目录失败：{e}"))?;
    Ok(dir)
}

/// 命令：`list_save_files` —— iOS 导入页列出 Documents 里导出的存档。
/// 每项带解析出的角色名/等级，玩家不用靠一长串时间戳文件名猜哪份是目标档。
#[tauri::command]
fn list_save_files(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "ios")]
    {
        let dir = documents_dir(&app)?;
        let mut files = Vec::new();
        let entries = fs::read_dir(&dir).map_err(|e| format!("读取 Documents 失败：{e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = match path.file_name().and_then(|s| s.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if !name.to_ascii_lowercase().ends_with(".json") {
                continue;
            }
            let (_, modified, size) = file_meta(&path);
            let parsed = read_json_file(&path);
            let (player, level, reborn) = match parsed.as_ref() {
                Some((_, v)) => (
                    v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                    save_max_level(v),
                    save_reborn(v),
                ),
                None => (String::new(), 0, 0),
            };
            files.push(serde_json::json!({
                "name": name,
                "size": size,
                "modified": modified,
                "player": player,
                "level": level,
                "reborn": reborn,
                "valid": parsed.is_some(),
            }));
        }
        files.sort_by(|a, b| {
            b.get("modified").and_then(|x| x.as_u64()).unwrap_or(0)
                .cmp(&a.get("modified").and_then(|x| x.as_u64()).unwrap_or(0))
        });
        Ok(serde_json::json!({ "ok": true, "dir": dir.to_string_lossy(), "files": files }))
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("这个平台没有「文件」App 导出列表，请用「选择文件」导入".into())
    }
}

/// 命令：`read_save_file` —— 按 `list_save_files` 返回的文件名读取原文。
#[tauri::command]
fn read_save_file(app: tauri::AppHandle, name: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "ios")]
    {
        let safe = safe_import_name(&name)?;
        let dir = documents_dir(&app)?;
        let path = dir.join(safe);
        if !path.is_file() {
            return Err("找不到这份导出存档".into());
        }
        let (_, modified, size) = file_meta(&path);
        if size > SAVE_MAX as u64 {
            return Err("存档太大（超过 4 MB）".into());
        }
        let data = fs::read_to_string(&path).map_err(|e| format!("读取存档失败：{e}"))?;
        Ok(serde_json::json!({
            "ok": true, "name": safe, "data": data, "size": size,
            "modified": modified, "path": path.to_string_lossy(),
        }))
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, name);
        Err("这个平台没有「文件」App 导出列表".into())
    }
}

/// 命令：`export_save` —— 安装版 / iOS（页面在 tauri.localhost / tauri://）导出存档。
/// 桌面写系统「下载」目录；iOS 写 App 的 Documents（「文件」App 可见）；
/// Android 仍走 Kotlin 的 `SSDZAndroid` 桥（本命令在 Android 上返回明确错误）。
#[tauri::command]
fn export_save(app: tauri::AppHandle, file_name: String, data: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "ios")]
    {
        export_to_documents(&app, &file_name, &data)
    }
    #[cfg(all(mobile, not(target_os = "ios")))]
    {
        let _ = (&app, file_name, data);
        Err("移动端请使用系统下载目录桥".into())
    }
    #[cfg(not(mobile))]
    {
        let _ = &app;
        export_to_downloads(&file_name, &data)
    }
}

// ---------------------------------------------------------------- 入口

const TITLE: &str = "松鼠大战 · 怀旧复刻版";

/// 桌面与移动端共用的入口：两边都是同一个 Builder、同一批存档命令，
/// 只有「窗口怎么开」不同——
///   · 桌面：自己找游戏目录 + 起内置迷你服务器，窗口指向 http://127.0.0.1:<port>/；
///   · 移动端：前端嵌在安装包里（frontendDist = web），由 Tauri 的资源协议直接伺候，
///     不找外部目录、不起服务器，窗口由 Tauri 自己创建。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_path, save_meta, save_read, save_write, export_save, list_save_files, read_save_file, open_external])
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(mobile)]
            {
                let save = resolve_save(&handle, None);
                eprintln!("松鼠大战：移动端启动，存档 {}", save.display());
                app.manage(SaveState { file: save });
                return Ok(());
            }

            #[cfg(not(mobile))]
            {
                let found = find_game_root();
                // 存档放「伺候的那个目录」下的 save/；找不到游戏目录时用系统应用数据目录
                let save = resolve_save(&handle, found.as_ref().map(|(serve, _)| serve.as_path()));
                app.manage(SaveState { file: save.clone() });

                let builder = match &found {
                    Some((serve, entry)) => {
                        let ctx = Arc::new(Ctx { root: serve.clone(), entry: entry.clone(), save });
                        let port = start_server(ctx)?;
                        let url = format!("http://127.0.0.1:{port}/");   // 服务器把 / 映射到首页（scripts/index.html）
                        eprintln!("松鼠大战：游戏目录 {} / 本地服务 {url}", serve.display());
                        WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                    }
                    None => {
                        eprintln!("松鼠大战：没找到游戏目录（需要 index.html 与 css/js/images 同级）");
                        WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    }
                };
                builder
                    .title(TITLE)
                    .inner_size(1216.0, 760.0)
                    .min_inner_size(900.0, 600.0)
                    .center()
                    .build()?;
                Ok(())
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fresh_one_level_cannot_overwrite_progress() {
        let cur = json!({
            "level": 32, "allWins": 120, "stages": {"1": {"pass": true}},
            "weapons": ["15:11"], "skills": ["11:6"]
        });
        let fresh = json!({
            "level": 1, "reborn": 0, "allWins": 0, "stages": {},
            "weapons": [], "skills": [], "props": {"1": 3, "2": 2}
        });
        assert!(save_is_fresh(&fresh));
        assert!(save_has_progress(&cur));
        assert!(guard_save_write(Some(&cur), &fresh, false).is_err(), "1 级空档不能覆盖 32 级正式档");
        let lv2 = json!({"level": 2, "reborn": 0, "allWins": 1});
        assert!(guard_save_write(Some(&cur), &lv2, false).is_err(), "2 级旧档同样不能覆盖 32 级正式档");
        assert!(guard_save_write(Some(&cur), &fresh, true).is_ok(), "调试面板显式 force 才允许重置");
    }

    #[test]
    fn rebirth_is_a_legal_level_one_save() {
        let cur = json!({"level": 40, "allWins": 300, "stages": {"30": {"pass": true}}});
        let reborn = json!({"level": 1, "reborn": 1, "allWins": 300, "stages": {"30": {"pass": true}}});
        assert!(!save_is_fresh(&reborn), "转生档 reborn>0 不是新档");
        assert!(guard_save_write(Some(&cur), &reborn, false).is_ok(), "转生降回 1 级必须能存");
    }

    #[test]
    fn dual_slot_max_level_matches_server() {
        let v = json!({
            "level": 1, "settings": {"uiMode": "modern"},
            "__dualOther": {"level": 42, "settings": {"uiMode": "classic"}}
        });
        assert_eq!(save_max_level(&v), 42);
        let old = json!({ "level": 42, "__dualSaves": {"classic": {"level": 31}, "modern": {"level": 9}} });
        assert_eq!(save_max_level(&old), 42);
    }

    #[test]
    fn export_names_are_sanitized_and_never_overwrite() {
        assert_eq!(sanitize_export_name("松鼠大战存档"), "松鼠大战存档.json");
        assert_eq!(sanitize_export_name("a/b:c"), "a_b_c.json");
        assert_eq!(sanitize_export_name("  "), "松鼠大战存档.json");
        let dir = std::env::temp_dir().join(format!("ssdz-export-{}-{}", std::process::id(), now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("save.json"), "{}").unwrap();
        let p = unique_export_path(&dir, "save.json");
        assert_eq!(p.file_name().unwrap().to_string_lossy(), "save (1).json");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_write_guards_and_read_recovers_backup() {
        let dir = std::env::temp_dir().join(format!("ssdz-save-guard-{}", now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("progress.json");
        let progressed = r#"{"level":32,"name":"老号","allWins":120,"stages":{"1":{"pass":true}}}"#;
        let fresh = r#"{"level":1,"name":"新号","reborn":0,"allWins":0,"stages":{}}"#;
        save_write_at(&file, progressed, false).unwrap();
        save_write_at(&file, progressed, false).unwrap();   // 第二次写才产生 progress.bak.json
        assert!(save_write_at(&file, fresh, false).is_err(), "默认不许 1 级空档覆盖 32 级");
        assert_eq!(read_json_file(&file).unwrap().1["level"], 32, "主文件必须原样保留");
        assert_eq!(read_json_file(&save_bak_path(&file)).unwrap().1["level"], 32, "备份也要是老档");
        /* 主文件万一已经掉到 1 级、玩家又升到 2 级，备份也不能被这次低等级写盘冲掉。
         * 这里直接写主文件（绕过 save_write 的降级拦截），再走备份滚动逻辑。 */
        fs::write(&file, r#"{"level":2,"name":"老号","allWins":1}"#).unwrap();
        backup_save_file(&file, true);
        assert_eq!(read_json_file(&save_bak_path(&file)).unwrap().1["level"], 32,
            "更低的当前档不能覆盖更高等级的备份");

        /* 模拟写盘过程中主文件损坏：save_read 应该从 progress.bak.json 恢复并修回主文件。 */
        fs::write(&file, "{broken").unwrap();
        let recovered = save_read_at(&file).unwrap();
        assert_eq!(recovered["recoveredFrom"], "backup");
        assert_eq!(recovered["maxLevel"], 32);
        assert_eq!(read_json_file(&file).unwrap().1["level"], 32, "主文件要被备份修回");
        assert!(save_write_at(&file, fresh, true).is_ok(), "玩家显式重置才允许写 1 级");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_prefers_backup_when_main_was_clobbered_by_fresh_save() {
        let dir = std::env::temp_dir().join(format!("ssdz-save-recover-{}", now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("progress.json");
        let progressed = r#"{"level":32,"name":"老号","allWins":120,"stages":{"1":{"pass":true}}}"#;
        let fresh = r#"{"level":1,"name":"新号","reborn":0,"allWins":0,"stages":{}}"#;
        save_write_at(&file, progressed, false).unwrap();
        save_write_at(&file, progressed, false).unwrap();   // 产生 32 级备份
        fs::write(&file, fresh).unwrap();                   // 模拟旧版把主文件写成 1 级空档
        let rec = save_read_at(&file).unwrap();
        assert_eq!(rec["maxLevel"], 32, "主文件是空档时要读回备份里的 32 级");
        assert_eq!(rec["recoveredFrom"], "backup");
        assert_eq!(read_json_file(&file).unwrap().1["level"], 32, "备份要修回主文件");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_and_backup_roundtrip() {
        let dir = std::env::temp_dir().join(format!("ssdz-save-test-{}", now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("progress.json");
        let old = "{\"level\":32}";
        let new = "{\"level\":33}";
        write_file_atomic(&file, old).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), old);
        backup_save_file(&file, true);
        write_file_atomic(&file, new).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), new);
        assert_eq!(fs::read_to_string(save_bak_path(&file)).unwrap(), old);
        assert_eq!(read_json_file(&file).unwrap().1["level"], 33);
        let _ = fs::remove_dir_all(&dir);
    }
}

// lib 被当作可执行目标编译时（`cargo build` 的默认行为）需要一个 main；
// 桌面真正跑的是 src/main.rs，移动端由 tauri::mobile_entry_point 生成 JNI 入口。
#[cfg(desktop)]
fn main() {
    run();
}