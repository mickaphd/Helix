// Helix's native shell: a window showing the web app (src/), plus the few
// things a web page can't do on its own. See src/native.ts for the other side.
use std::{
    fs,
    path::Path,
    sync::{Mutex, OnceLock},
};
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow,
};

/// Files macOS asked us to open (Finder double-click, Open With, Dock drop),
/// queued until the page takes them — they can arrive before it's loaded.
#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_files(files: State<OpenedFiles>) -> Vec<String> {
    std::mem::take(&mut *files.0.lock().unwrap())
}

/// Only the file types Helix actually reads or writes, so even a compromised
/// page can't touch anything else on disk.
fn check_extension(path: &str, allowed: &[&str]) -> Result<(), String> {
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    match ext {
        Some(ext) if allowed.contains(&ext.as_str()) => Ok(()),
        _ => Err(format!("Helix can't access {path}")),
    }
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    check_extension(&path, &["hlx"])?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Writes the raw request body to the (URL-encoded) `path` header, atomically:
/// a temp file renamed over the target, so a save is never left half-written.
#[tauri::command]
fn write_file(request: Request) -> Result<(), String> {
    let header = request.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("missing path")?;
    let path = percent_encoding::percent_decode_str(header).decode_utf8().map_err(|e| e.to_string())?;
    check_extension(&path, &["hlx", "png", "jpg", "jpeg", "svg"])?;
    let InvokeBody::Raw(data) = request.body() else { return Err("expected raw bytes".into()) };
    let tmp = format!("{path}.tmp");
    fs::write(&tmp, data).and_then(|()| fs::rename(&tmp, path.as_ref())).map_err(|e| e.to_string())
}

/// The unsaved-changes dot in the window's close button.
#[tauri::command]
fn set_edited(window: WebviewWindow, edited: bool) {
    if let Ok(ns_window) = window.ns_window() {
        let ns_window = ns_window.cast::<objc2::runtime::AnyObject>();
        unsafe {
            let _: () = objc2::msg_send![ns_window, setDocumentEdited: edited];
        }
    }
}

/// Hands Helix's recent projects (newest first) to macOS, which lists them in the
/// Dock icon's Open Recent menu. The system list is rebuilt to match File ▸ Open Recent.
#[tauri::command]
fn set_recent_documents(app: AppHandle, paths: Vec<String>) {
    let _ = app.run_on_main_thread(move || unsafe {
        let controller: *mut AnyObject =
            objc2::msg_send![objc2::class!(NSDocumentController), sharedDocumentController];
        let _: () = objc2::msg_send![controller, clearRecentDocuments: std::ptr::null_mut::<AnyObject>()];
        for path in paths.iter().rev() {
            let Ok(path) = std::ffi::CString::new(path.as_str()) else { continue };
            let text: *mut AnyObject =
                objc2::msg_send![objc2::class!(NSString), stringWithUTF8String: path.as_ptr()];
            let url: *mut AnyObject = objc2::msg_send![objc2::class!(NSURL), fileURLWithPath: text];
            let _: () = objc2::msg_send![controller, noteNewRecentDocumentURL: url];
        }
    });
}

/// Helix's website, GitHub page or releases, in the default browser: fixed
/// addresses, so the page can't open anything else.
#[tauri::command]
fn open_link(link: String) {
    let url = match link.as_str() {
        "website" => c"https://www.helix-desktop.com",
        "github" => c"https://github.com/mickaphd/Helix",
        "releases" => c"https://github.com/mickaphd/Helix/releases/latest",
        _ => return,
    };
    unsafe {
        let text: *mut AnyObject = objc2::msg_send![objc2::class!(NSString), stringWithUTF8String: url.as_ptr()];
        let url: *mut AnyObject = objc2::msg_send![objc2::class!(NSURL), URLWithString: text];
        let workspace: *mut AnyObject = objc2::msg_send![objc2::class!(NSWorkspace), sharedWorkspace];
        let _: bool = objc2::msg_send![workspace, openURL: url];
    }
}

/// Quitting from the Dock, the app switcher or at logout asks the app delegate
/// `applicationShouldTerminate:`, which tao doesn't answer, so Helix would quit
/// without asking to save. This answers "not now" and closes the window instead:
/// the page asks about unsaved changes, and closing the last window quits.
fn ask_before_quitting(app: &AppHandle) {
    static APP: OnceLock<AppHandle> = OnceLock::new();
    extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: &AnyObject) -> usize {
        match APP.get().and_then(|app| app.get_webview_window("main")) {
            Some(window) => {
                let _ = window.close();
                0 // NSTerminateCancel
            }
            None => 1, // NSTerminateNow
        }
    }
    let _ = APP.set(app.clone());
    unsafe {
        let ns_app: *mut AnyObject = objc2::msg_send![objc2::class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = objc2::msg_send![ns_app, delegate];
        let Some(delegate) = delegate.as_ref() else { return };
        let imp: Imp = std::mem::transmute(should_terminate as extern "C-unwind" fn(_, _, _) -> _);
        let class = delegate.class() as *const AnyClass as *mut AnyClass;
        objc2::ffi::class_addMethod(class, objc2::sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr());
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(OpenedFiles::default())
        .setup(|app| {
            ask_before_quitting(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_opened_files,
            read_text,
            write_file,
            set_edited,
            open_link,
            set_recent_documents
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Helix")
        .run(|app, event| {
            if let RunEvent::Opened { urls } = event {
                let paths = urls.iter().filter_map(|url| url.to_file_path().ok());
                app.state::<OpenedFiles>().0.lock().unwrap().extend(paths.map(|p| p.to_string_lossy().into_owned()));
                let _ = app.emit("opened-files", ());
            }
        });
}
