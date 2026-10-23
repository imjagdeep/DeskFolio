//! DeskFolio desktop shell: one window, file I/O for the web side (where the
//! PDF work happens), updates.

mod account;
mod batch;
mod compress;
mod desklab;
mod digitalid;
mod files;
mod ocrlang;
mod office;
mod tsa;

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

// ---------- digital IDs (signing) ----------

fn ids_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data folder: {e}"))?;
    digitalid::ids_dir(&base)
}

/// Read a .pfx / .p12 the user picked.
#[tauri::command]
async fn digital_id_import(path: PathBuf, password: String) -> CmdResult<digitalid::IdParts> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = files::read(&path)?;
        digitalid::import(&data, &password)
    })
    .await
    .map_err(|e| format!("background task failed: {e}"))?
}

/// Write a digital ID as a .pfx (backup or use elsewhere).
#[tauri::command]
async fn digital_id_export(
    path: PathBuf,
    cert: Vec<u8>,
    chain: Vec<Vec<u8>>,
    pkcs8: Vec<u8>,
    password: String,
    alias: String,
) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let pfx = digitalid::export(
            &digitalid::IdParts { cert, chain, pkcs8 },
            &password,
            &alias,
        )?;
        files::write_atomic(&path, &pfx)
    })
    .await
    .map_err(|e| format!("background task failed: {e}"))?
}

/// Where saved (encrypted) IDs live, and which there are.
#[tauri::command]
fn digital_ids(app: AppHandle) -> CmdResult<(String, Vec<String>)> {
    let dir = ids_dir(&app)?;
    let names = digitalid::list(&dir)?;
    Ok((dir.to_string_lossy().into_owned(), names))
}

#[tauri::command]
fn digital_id_delete(app: AppHandle, name: String) -> CmdResult<()> {
    digitalid::delete(&ids_dir(&app)?, &name)
}

// ---------- OCR language packs (downloaded only on request, see ocrlang.rs) ----------

/// The one HTTP client for things the user asks DeskFolio to fetch: OCR language
/// packs and signature timestamps. The webview itself has no network (CSP).
struct Net(reqwest::Client);

fn lang_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data folder: {e}"))?;
    ocrlang::dir(&base)
}

#[tauri::command]
fn ocr_langs(app: AppHandle) -> CmdResult<Vec<ocrlang::PackInfo>> {
    Ok(ocrlang::list(&lang_dir(&app)?))
}

#[tauri::command]
async fn ocr_lang_download(app: AppHandle, net: State<'_, Net>, code: String) -> CmdResult<()> {
    let pack = ocrlang::find(&code)?;
    ocrlang::download(&net.0, &lang_dir(&app)?, pack).await
}

#[tauri::command]
fn ocr_lang_data(app: AppHandle, code: String) -> CmdResult<Response> {
    let pack = ocrlang::find(&code)?;
    ocrlang::read(&lang_dir(&app)?, pack).map(Response::new)
}

#[tauri::command]
fn ocr_lang_remove(app: AppHandle, code: String) -> CmdResult<()> {
    ocrlang::remove(&lang_dir(&app)?, ocrlang::find(&code)?)
}

// ---------- trusted timestamps for digital signatures (opt-in, see tsa.rs) ----------

/// The timestamp services the user can pick from: (id, name).
#[tauri::command]
fn timestamp_services() -> Vec<(&'static str, &'static str)> {
    tsa::AUTHORITIES
        .iter()
        .map(|(id, name, _)| (*id, *name))
        .collect()
}

/// Carry an RFC 3161 request (raw body) to the service named in `x-tsa`; the
/// reply comes back raw. The web side builds and checks both.
#[tauri::command]
async fn timestamp_request(request: Request<'_>, net: State<'_, Net>) -> CmdResult<Response> {
    let id = request
        .headers()
        .get("x-tsa")
        .and_then(|v| v.to_str().ok())
        .ok_or("no timestamp service chosen")?
        .to_string();
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected a raw timestamp request".into());
    };
    tsa::request(&net.0, &id, data.clone())
        .await
        .map(Response::new)
}

// ---------- the optional DeskLab account (all calls go through account.rs) ----------

type Acct<'a> = State<'a, account::Account>;

#[tauri::command]
async fn account_status(acct: Acct<'_>) -> CmdResult<account::Status> {
    acct.status().await.map_err(account::plain)
}

#[tauri::command]
async fn account_send_code(acct: Acct<'_>, email: String) -> CmdResult<()> {
    acct.send_code(&email).await.map_err(account::plain)
}

#[tauri::command]
async fn account_verify(acct: Acct<'_>, email: String, code: String) -> CmdResult<()> {
    acct.verify(&email, &code).await.map_err(account::plain)
}

#[tauri::command]
async fn account_login(acct: Acct<'_>, email: String, password: String) -> CmdResult<()> {
    acct.login(&email, &password).await.map_err(account::plain)
}

#[tauri::command]
async fn account_logout(acct: Acct<'_>) -> CmdResult<()> {
    acct.logout().await.map_err(account::plain)
}

#[tauri::command]
async fn account_set_password(
    acct: Acct<'_>,
    password: String,
    current: Option<String>,
) -> CmdResult<()> {
    acct.set_password(&password, current.as_deref())
        .await
        .map_err(account::plain)
}

#[tauri::command]
async fn account_remove_password(acct: Acct<'_>) -> CmdResult<()> {
    acct.remove_password().await.map_err(account::plain)
}

#[tauri::command]
async fn account_sign_out_device(acct: Acct<'_>, id: String) -> CmdResult<()> {
    acct.sign_out_device(&id).await.map_err(account::plain)
}

#[tauri::command]
async fn account_delete(acct: Acct<'_>, confirm: String) -> CmdResult<()> {
    acct.delete(&confirm).await.map_err(account::plain)
}

// ---------- DeskLab Sign: requests for signature (through the account) ----------

/// Only the sender's request endpoints; the account is never used for anything else here.
fn sign_path(path: &str) -> CmdResult<()> {
    let ok = (path == "/v1/envelopes" || path.starts_with("/v1/envelopes/"))
        && path.len() < 200
        && !path.contains("..")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/-_".contains(&b));
    if ok {
        Ok(())
    } else {
        Err("not a DeskLab Sign address".into())
    }
}

#[tauri::command]
async fn sign_call(
    acct: Acct<'_>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> CmdResult<serde_json::Value> {
    sign_path(&path)?;
    let m = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("unsupported method".into()),
    };
    let text = acct.call(m, &path, body).await.map_err(account::plain)?;
    if text.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("unexpected answer from DeskLab: {e}"))
}

/// Upload an encrypted file: raw body, the API path in a header.
#[tauri::command]
async fn sign_upload(acct: Acct<'_>, request: Request<'_>) -> CmdResult<()> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or("no path")?;
    sign_path(&path)?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw bytes".into());
    };
    acct.raw(reqwest::Method::PUT, &path, Some(data.clone()))
        .await
        .map_err(account::plain)?;
    Ok(())
}

/// Download an encrypted file, as raw bytes.
#[tauri::command]
async fn sign_download(acct: Acct<'_>, path: String) -> CmdResult<Response> {
    sign_path(&path)?;
    let bytes = acct
        .raw(reqwest::Method::GET, &path, None)
        .await
        .map_err(account::plain)?;
    Ok(Response::new(bytes))
}

// ---------- batch processing ----------

/// The PDFs in a folder (and its subfolders when asked), sorted.
#[tauri::command]
async fn batch_list_pdfs(dir: PathBuf, recursive: bool) -> CmdResult<Vec<PathBuf>> {
    tauri::async_runtime::spawn_blocking(move || batch::list_pdfs(&dir, recursive))
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

/// A path that doesn't exist yet: the one given, or "name (2).ext"...
#[tauri::command]
fn batch_free_path(path: PathBuf) -> CmdResult<PathBuf> {
    batch::free_path(&path)
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
        "deskshot" => "https://github.com/imjagdeep/DeskShot/releases/latest",
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
            app.manage(account::Account::new("deskfolio")?);
            // the account above installed rustls' crypto provider
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .user_agent(format!("DeskFolio {}", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|e| format!("cannot start the network client: {e}"))?;
            app.manage(Net(client));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            read_file,
            batch_list_pdfs,
            account_status,
            account_send_code,
            account_verify,
            account_login,
            account_logout,
            account_set_password,
            account_remove_password,
            account_sign_out_device,
            account_delete,
            sign_call,
            sign_upload,
            sign_download,
            batch_free_path,
            digital_id_import,
            digital_id_export,
            digital_ids,
            digital_id_delete,
            ocr_langs,
            ocr_lang_download,
            ocr_lang_data,
            ocr_lang_remove,
            timestamp_services,
            timestamp_request,
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
    use super::{percent_decode, sign_path};

    #[test]
    fn sign_calls_only_reach_request_endpoints() {
        assert!(sign_path("/v1/envelopes").is_ok());
        assert!(sign_path("/v1/envelopes/0b1c-22/files/document").is_ok());
        assert!(sign_path("/v1/me").is_err());
        assert!(sign_path("/v1/envelopesX").is_err());
        assert!(sign_path("/v1/envelopes/../me").is_err());
        assert!(sign_path("/v1/envelopes/a?x=1").is_err());
        assert!(sign_path("https://evil.example/v1/envelopes").is_err());
    }

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
