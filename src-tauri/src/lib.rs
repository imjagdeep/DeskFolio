//! DeskFolio desktop shell: one window, file I/O for the web side (where the
//! PDF work happens), updates.

mod compress;
mod desklab;
mod files;
mod office;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

type CmdResult<T> = Result<T, String>;

/// PDFs DeskFolio was started with, until the window asks for them.
#[derive(Default)]
struct Startup(Mutex<Vec<PathBuf>>);

#[derive(serde::Serialize)]
struct AppInfo {
    version: String,
    platform: &'static str,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
    }
}

/// The file's bytes, as a raw response (no JSON number arrays).
#[tauri::command]
async fn read_file(path: PathBuf) -> CmdResult<Response> {
    tauri::async_runtime::spawn_blocking(move || files::read(&path).map(Response::new))
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

/// Save the raw request body to the path in the `x-path` header
/// (URI-encoded, so any file name survives the header).
#[tauri::command]
async fn write_file(request: Request<'_>) -> CmdResult<()> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or("no target path")?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw file bytes".into());
    };
    let data = data.clone();
    let path = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || files::write_atomic(&path, &data))
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            // Bytes, not &s[..]: a non-ASCII character after a stray % must
            // not split a UTF-8 sequence.
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Compress PDF bytes (raw request body). Preset and password come in
/// headers; the smaller PDF comes back as raw bytes (the original bytes
/// when compressing didn't help).
#[tauri::command]
async fn compress_pdf(request: Request<'_>) -> CmdResult<Response> {
    let preset = match request
        .headers()
        .get("x-preset")
        .and_then(|v| v.to_str().ok())
    {
        Some("light") => compress::Preset::Light,
        Some("strong") => compress::Preset::Strong,
        _ => compress::Preset::Balanced,
    };
    let password = request
        .headers()
        .get("x-password")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .filter(|p| !p.is_empty());
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw PDF bytes".into());
    };
    let data = data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        compress::compress(&data, preset, password.as_deref())
            .map(|(bytes, _)| Response::new(bytes))
    })
    .await
    .map_err(|e| format!("background task failed: {e}"))?
}

#[tauri::command]
fn take_startup_paths(startup: State<'_, Startup>) -> Vec<PathBuf> {
    startup
        .0
        .lock()
        .map(|mut v| std::mem::take(&mut *v))
        .unwrap_or_default()
}

/// Which Office converters this computer has (Office apps, LibreOffice).
#[tauri::command]
async fn office_converters() -> CmdResult<office::Converters> {
    tauri::async_runtime::spawn_blocking(office::available)
        .await
        .map_err(|e| format!("background task failed: {e}"))
}

/// Convert a Word/Excel/PowerPoint file to PDF; returns the PDF bytes.
#[tauri::command]
async fn office_to_pdf(path: PathBuf) -> CmdResult<Response> {
    tauri::async_runtime::spawn_blocking(move || office::convert(&path).map(Response::new))
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

#[tauri::command]
fn reveal_file(app: AppHandle, path: PathBuf) -> CmdResult<()> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("can't show {}: {e}", path.display()))
}

/// Only these pages can be opened from the app.
#[tauri::command]
fn open_link(app: AppHandle, id: String) -> CmdResult<()> {
    let url = match id.as_str() {
        "releases" => "https://github.com/imjagdeep/DeskFolio/releases/latest",
        "repo" => "https://github.com/imjagdeep/DeskFolio",
        "issues" => "https://github.com/imjagdeep/DeskFolio/issues",
        "site" => "https://jaggi.cc/tools/#deskfolio",
        "developer" => "https://github.com/imjagdeep",
        "deskzero" => "https://github.com/imjagdeep/DeskZero/releases/latest",
        "deskmedic" => "https://github.com/imjagdeep/DeskMedic/releases/latest",
        "deskfolio" => "https://github.com/imjagdeep/DeskFolio/releases/latest",
        _ => return Err(format!("unknown link {id}")),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// The other DeskLab tools and whether each is installed here.
#[tauri::command]
fn desklab_tools() -> Vec<desklab::LabTool> {
    desklab::list("deskfolio")
}

/// Start another DeskLab tool, optionally handing it one file.
#[tauri::command]
fn open_tool(id: String, file: Option<PathBuf>) -> CmdResult<()> {
    desklab::open(&id, file.as_deref())
}

/// A downloaded update is ready.
#[tauri::command]
fn notify_update(app: AppHandle, version: String) {
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app
        .notification()
        .builder()
        .title(format!("DeskFolio {version} is ready"))
        .body("Open DeskFolio and choose Restart to update. It takes a few seconds.")
        .show()
    {
        tracing::warn!("notification failed: {e}");
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: opening a PDF while DeskFolio runs hands it over.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main(app);
            let paths = files::paths_from_args(&args);
            if !paths.is_empty() {
                let _ = app.emit("open-paths", paths);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Reopen where it was left (size, position, maximized), never hidden.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            app.manage(Startup(Mutex::new(files::paths_from_args(&args))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            read_file,
            write_file,
            compress_pdf,
            office_converters,
            office_to_pdf,
            take_startup_paths,
            reveal_file,
            open_link,
            desklab_tools,
            open_tool,
            notify_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building DeskFolio")
        .run(|_app, _event| {
            // macOS: files opened from Finder arrive as an event.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths: Vec<PathBuf> =
                    urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
                if !paths.is_empty() {
                    show_main(_app);
                    let _ = _app.emit("open-paths", paths);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_paths_from_the_header() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5Cme%5Ca%20b.pdf"),
            r"C:\Users\me\a b.pdf"
        );
        assert_eq!(percent_decode("%E0%A8%AA.pdf"), "ਪ.pdf");
        // A stray % is kept as is, even before a non-ASCII character.
        assert_eq!(percent_decode("100%.pdf"), "100%.pdf");
        assert_eq!(percent_decode("a%é.pdf"), "a%é.pdf");
    }
}
