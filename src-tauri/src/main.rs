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
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 单个存档上限：与网页版一致（4 MB）
const SAVE_MAX: usize = 4 * 1024 * 1024;

// ---------------------------------------------------------------- 游戏目录

/// 游戏目录：必须真的含 index.html，认错了就会去别的文件夹伺候文件
fn find_game_root() -> Option<PathBuf> {
    // 1) 启动器（启动游戏.cmd / start-win.ps1）显式指定
    if let Some(v) = std::env::var_os("SSDZ_GAME_DIR") {
        let p = PathBuf::from(v);
        if p.join("index.html").is_file() {
            return Some(p);
        }
    }
    // 2) 当前工作目录
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("index.html").is_file() {
            return Some(cwd);
        }
    }
    // 3) 从可执行文件往上找（开发运行时 exe 在 src-tauri/target/release）
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..6 {
            let dir = match cur {
                Some(d) => d,
                None => break,
            };
            if dir.join("index.html").is_file() {
                return Some(dir);
            }
            cur = dir.parent().map(|p| p.to_path_buf());
        }
    }
    None
}

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

/// 存档位置：优先游戏目录里的 save/，不可写（例如装到 Program Files）才用系统应用数据目录
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

// ---------------------------------------------------------------- 迷你服务器

struct Ctx {
    root: PathBuf,
    save: PathBuf,
}

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

fn respond_json(out: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    respond(out, status, "application/json; charset=utf-8", body.as_bytes())
}

fn json_err(msg: &str) -> String {
    format!("{{\"ok\":false,\"msg\":{}}}", serde_json::Value::from(msg))
}

/// /__save：与 references/tools/serve.js 的行为保持一致
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

/// 返回 true = 该关连接
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
    if method != "GET" && method != "HEAD" {
        respond(out, 405, "text/plain; charset=utf-8", "只支持 GET / HEAD".as_bytes())?;
        return Ok(false);
    }
    let rel = if path == "/" {
        "index.html".to_string()
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

#[tauri::command]
fn save_path(state: tauri::State<SaveState>) -> String {
    state.file.to_string_lossy().to_string()
}

#[tauri::command]
fn save_meta(state: tauri::State<SaveState>) -> serde_json::Value {
    let (exists, saved_at, size) = file_meta(&state.file);
    serde_json::json!({ "ok": true, "exists": exists, "savedAt": saved_at, "size": size, "path": state.file.to_string_lossy() })
}

#[tauri::command]
fn save_read(state: tauri::State<SaveState>) -> Result<serde_json::Value, String> {
    let (exists, saved_at, _) = file_meta(&state.file);
    if !exists {
        return Ok(serde_json::json!({ "ok": true, "exists": false, "savedAt": 0, "data": null, "path": state.file.to_string_lossy() }));
    }
    let text = fs::read_to_string(&state.file).map_err(|e| format!("读存档失败：{e}"))?;
    Ok(serde_json::json!({ "ok": true, "exists": true, "savedAt": saved_at, "data": text, "path": state.file.to_string_lossy() }))
}

#[tauri::command]
fn save_write(state: tauri::State<SaveState>, data: String) -> Result<serde_json::Value, String> {
    if data.len() > SAVE_MAX {
        return Err("存档太大（超过 4 MB）".into());
    }
    serde_json::from_str::<serde_json::Value>(&data).map_err(|_| "存档不是合法 JSON".to_string())?;
    if let Some(dir) = state.file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    fs::write(&state.file, &data).map_err(|e| format!("写存档失败：{e}"))?;
    let (_, saved_at, _) = file_meta(&state.file);
    Ok(serde_json::json!({ "ok": true, "savedAt": saved_at, "path": state.file.to_string_lossy() }))
}

// ---------------------------------------------------------------- 入口

const TITLE: &str = "松鼠大战 · 怀旧复刻版";

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_path, save_meta, save_read, save_write])
        .setup(|app| {
            let handle = app.handle().clone();
            let root = find_game_root();
            let save = resolve_save(&handle, root.as_deref());
            app.manage(SaveState { file: save.clone() });

            let builder = match &root {
                Some(root) => {
                    let ctx = Arc::new(Ctx { root: root.clone(), save });
                    let port = start_server(ctx)?;
                    let url = format!("http://127.0.0.1:{port}/index.html");
                    eprintln!("松鼠大战：游戏目录 {} / 本地服务 {url}", root.display());
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                }
                None => {
                    eprintln!("松鼠大战：没找到游戏目录（缺 index.html），改用内置提示页");
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
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}
