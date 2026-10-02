// Helix's native shell: the project windows showing the web app (src/), a hidden
// window running R (src/engine.ts), and the few things a web page can't do on its
// own. See src/native.ts for the other side.
use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{Mutex, OnceLock},
};
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use serde::Serialize;
use tauri::{
    async_runtime::{channel, Sender},
    ipc::{InvokeBody, Request},
    utils::config::WindowConfig,
    AppHandle, Emitter, LogicalPosition, Manager, RunEvent, State, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

// ── Project windows ──────────────────────────────────────────────────────

/// A project file for a window to open once its page is ready. `untitled`: shown as a
/// new document, like the sample, so saving asks where.
#[derive(Serialize)]
struct Opening {
    path: String,
    untitled: bool,
}

/// What a project window holds, as its page last said.
struct Document {
    path: Option<String>,
    /// A fresh project nobody has touched: the next project opens in its place.
    blank: bool,
}

/// The project windows ("project-1", "project-2"…), one project each. Opening a
/// project brings its window forward if it is open already, fills the front
/// window if that one is blank, or opens a new window. Helix stays open without
/// any, as Pages does: only quitting closes them all and then ends (`quitting`).
#[derive(Default)]
struct Projects(Mutex<ProjectWindows>);

#[derive(Default)]
struct ProjectWindows {
    count: u32,
    documents: HashMap<String, Document>,
    openings: HashMap<String, Opening>,
    quitting: bool,
}

impl Opening {
    /// The project file, unless it opens as a new document.
    fn file(&self) -> Option<&String> {
        (!self.untitled).then_some(&self.path)
    }
}

impl ProjectWindows {
    /// Gives `opening` to the window `label`, taken from now on: a second project never
    /// lands in the same window, and the same file is found open at once.
    fn hold(&mut self, label: &str, opening: Opening) {
        let path = opening.file().cloned();
        self.documents.insert(label.into(), Document { path, blank: false });
        self.openings.insert(label.into(), opening);
    }
}

/// New windows cascade down and right from the front one, as in the Finder.
const CASCADE: f64 = 22.0;

fn is_project(label: &str) -> bool {
    label.starts_with("project-")
}

/// The project window in front, if any.
fn front_window(app: &AppHandle) -> Option<WebviewWindow> {
    let windows: Vec<_> = app.webview_windows().into_values().filter(|w| is_project(w.label())).collect();
    windows.iter().find(|w| w.is_focused().unwrap_or(false)).or(windows.first()).cloned()
}

/// Opens a project window, built from the "project" template in tauri.conf.json;
/// blank unless it has something to open.
fn new_window(app: &AppHandle, opening: Option<Opening>) -> tauri::Result<()> {
    let template = app.config().app.windows.iter().find(|w| w.label == "project").expect("window template");
    let state = app.state::<Projects>();
    let label = {
        let mut projects = state.0.lock().unwrap();
        projects.count += 1;
        let label = format!("project-{}", projects.count);
        if let Some(opening) = opening {
            projects.hold(&label, opening);
        }
        label
    };
    let front = front_window(app);
    // The first window appears where the last one was; the others appear once cascaded.
    let config = WindowConfig { label, visible: front.is_none(), ..template.clone() };
    let window = WebviewWindowBuilder::from_config(app, &config)?.build()?;
    if let Some(front) = front {
        let at = front.outer_position()?.to_logical::<f64>(front.scale_factor()?);
        window.set_size(front.inner_size()?)?;
        window.set_position(LogicalPosition::new(at.x + CASCADE, at.y + CASCADE))?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

/// Opens `opening` in the window `into` if that one is blank, else as described on `Projects`.
fn open(app: &AppHandle, into: Option<String>, opening: Opening) -> tauri::Result<()> {
    let state = app.state::<Projects>();
    let mut projects = state.0.lock().unwrap();
    if let Some(path) = opening.file() {
        let open_in = projects.documents.iter().find(|(_, d)| d.path.as_ref() == Some(path));
        if let Some(window) = open_in.and_then(|(label, _)| app.get_webview_window(label)) {
            return window.set_focus();
        }
    }
    let blank = |label: &String| is_project(label) && projects.documents.get(label).is_none_or(|d| d.blank);
    let Some(label) = into.filter(blank) else {
        drop(projects);
        return new_window(app, Some(opening));
    };
    projects.hold(&label, opening);
    drop(projects);
    app.emit_to(label, "opening", ())
}

#[tauri::command]
fn take_opening(window: WebviewWindow, projects: State<Projects>) -> Option<Opening> {
    projects.0.lock().unwrap().openings.remove(window.label())
}

/// The window's project file, its unsaved-changes dot (in the close button), and
/// whether it is blank.
#[tauri::command]
fn set_document(window: WebviewWindow, projects: State<Projects>, path: Option<String>, edited: bool, blank: bool) {
    if let Ok(ns_window) = window.ns_window() {
        let ns_window = ns_window.cast::<AnyObject>();
        unsafe {
            let _: () = objc2::msg_send![ns_window, setDocumentEdited: edited];
        }
    }
    let mut projects = projects.0.lock().unwrap();
    if !projects.openings.contains_key(window.label()) {
        projects.documents.insert(window.label().into(), Document { path, blank });
    }
}

#[tauri::command]
async fn open_projects(app: AppHandle, window: WebviewWindow, paths: Vec<String>) -> Result<(), String> {
    if let Some(gone) = paths.iter().find(|path| !Path::new(path).is_file()) {
        return Err(gone.clone());
    }
    for path in paths {
        open(&app, Some(window.label().into()), Opening { path, untitled: false }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The sample project, which ships inside the app, opened as a new document.
#[tauri::command]
async fn open_sample(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let path = app.path().resource_dir().map_err(|e| e.to_string())?.join("Helix Sample.hlx");
    let opening = Opening { path: path.to_string_lossy().into_owned(), untitled: true };
    open(&app, Some(window.label().into()), opening).map_err(|e| e.to_string())
}

#[tauri::command]
async fn new_project(app: AppHandle) -> Result<(), String> {
    new_window(&app, None).map_err(|e| e.to_string())
}

/// File ▸ Open…: the Open panel, then the project opens as `open` decides.
#[tauri::command]
fn choose_project(app: AppHandle, window: WebviewWindow) {
    let into = window.label().to_string();
    app.dialog().file().set_title("Open Project").add_filter("Helix Project", &["hlx"]).pick_file(move |file| {
        if let Some(path) = file.and_then(|file| file.into_path().ok()) {
            let _ = open(&app, Some(into), Opening { path: path.to_string_lossy().into_owned(), untitled: false });
        }
    });
}

/// A window refused to close (its user chose Cancel): Helix doesn't quit after all.
#[tauri::command]
fn cancel_quit(projects: State<Projects>) {
    projects.0.lock().unwrap().quitting = false;
}

// ── Session ──────────────────────────────────────────────────────────────
// The project files still open when Helix quits, reopened at the next launch, each
// in its window (as Pages does). A project closed before quitting doesn't come back.

/// One path per line, in Helix's data folder.
fn session_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("open-projects"))
}

fn save_session(app: &AppHandle) {
    let state = app.state::<Projects>();
    let projects = state.0.lock().unwrap();
    let mut open: Vec<_> = projects.documents.iter().filter_map(|(label, d)| Some((label, d.path.as_ref()?))).collect();
    // In the order they were opened: "project-2" before "project-10".
    open.sort_by_key(|(label, _)| label.trim_start_matches("project-").parse::<u32>().unwrap_or(0));
    let text = open.iter().map(|(_, path)| path.as_str()).collect::<Vec<_>>().join("\n");
    if let Some(file) = session_file(app) {
        let _ = file.parent().map(fs::create_dir_all);
        let _ = fs::write(file, text);
    }
}

/// Reopens the last session's projects that are still there, else a blank project.
fn restore_session(app: &AppHandle) -> tauri::Result<()> {
    let text = session_file(app).and_then(|file| fs::read_to_string(file).ok()).unwrap_or_default();
    let paths: Vec<_> = text.lines().filter(|path| Path::new(path).is_file()).collect();
    if paths.is_empty() {
        return new_window(app, None);
    }
    for path in paths {
        new_window(app, Some(Opening { path: path.into(), untitled: false }))?;
    }
    Ok(())
}

// ── Files ────────────────────────────────────────────────────────────────

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

// ── macOS ────────────────────────────────────────────────────────────────

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

/// The accent color chosen in System Settings ▸ Appearance, as `#RRGGBB`: what Helix
/// highlights with (selections, focus, buttons), as every Mac app does.
#[tauri::command]
fn accent_color() -> Option<String> {
    unsafe {
        let color: *mut AnyObject = objc2::msg_send![objc2::class!(NSColor), controlAccentColor];
        let space: *mut AnyObject = objc2::msg_send![objc2::class!(NSColorSpace), sRGBColorSpace];
        let rgb: *mut AnyObject = objc2::msg_send![color.as_ref()?, colorUsingColorSpace: space];
        let rgb = rgb.as_ref()?;
        let channel = |c: f64| (c.clamp(0.0, 1.0) * 255.0).round() as u8;
        let (r, g, b): (f64, f64, f64) =
            (objc2::msg_send![rgb, redComponent], objc2::msg_send![rgb, greenComponent], objc2::msg_send![rgb, blueComponent]);
        Some(format!("#{:02X}{:02X}{:02X}", channel(r), channel(g), channel(b)))
    }
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

/// Quitting (Helix ▸ Quit, the Dock, the app switcher, logout) asks the app delegate
/// `applicationShouldTerminate:`, which tao doesn't answer, so Helix would quit
/// without asking to save. This answers "not now" and closes the project windows
/// instead: each asks about its unsaved changes, and once the last one is closed
/// Helix ends (see `main`).
fn ask_before_quitting(app: &AppHandle) {
    static APP: OnceLock<AppHandle> = OnceLock::new();
    extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: &AnyObject) -> usize {
        let Some(app) = APP.get() else { return 1 };
        save_session(app);
        let windows: Vec<_> = app.webview_windows().into_values().filter(|w| is_project(w.label())).collect();
        if windows.is_empty() {
            return 1; // NSTerminateNow
        }
        app.state::<Projects>().0.lock().unwrap().quitting = true;
        for window in windows {
            let _ = window.close();
        }
        0 // NSTerminateCancel
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

/// macOS 27 hides menu items' pictures unless told to show them. Helix's own (a
/// palette's band, a color's swatch) are what their item says, so they stay; the
/// system's symbols (template images) keep macOS's choice. A menu of pictures alone
/// (swatches, shapes) drops the column kept for check marks, so it is no wider than
/// they are.
/// Set as each item is added, before any menu shows.
fn show_menu_pictures() {
    extern "C-unwind" fn item_added(_: &AnyObject, _: Sel, note: &AnyObject) {
        unsafe {
            let menu: *mut AnyObject = objc2::msg_send![note, object];
            let Some(menu) = menu.as_ref() else { return };
            let count: isize = objc2::msg_send![menu, numberOfItems];
            let mut pictures_only = true;
            for i in 0..count {
                let item: *mut AnyObject = objc2::msg_send![menu, itemAtIndex: i];
                let separator: bool = objc2::msg_send![item, isSeparatorItem];
                if separator {
                    continue;
                }
                let title: *mut AnyObject = objc2::msg_send![item, title];
                let title_length: usize = objc2::msg_send![title, length];
                let image: *mut AnyObject = objc2::msg_send![item, image];
                pictures_only &= title_length == 0 && !image.is_null();
                let Some(image) = image.as_ref() else { continue };
                let template: bool = objc2::msg_send![image, isTemplate];
                let can: bool = objc2::msg_send![item, respondsToSelector: objc2::sel!(setPreferredImageVisibility:)];
                if !template && can {
                    let _: () = objc2::msg_send![item, setPreferredImageVisibility: 1isize]; // .visible
                }
            }
            if pictures_only {
                let _: () = objc2::msg_send![menu, setShowsStateColumn: false];
            }
        }
    }
    unsafe {
        let ns_app: *mut AnyObject = objc2::msg_send![objc2::class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = objc2::msg_send![ns_app, delegate];
        let Some(delegate) = delegate.as_ref() else { return };
        let imp: Imp = std::mem::transmute(item_added as extern "C-unwind" fn(_, _, _));
        let class = delegate.class() as *const AnyClass as *mut AnyClass;
        objc2::ffi::class_addMethod(class, objc2::sel!(helixMenuItemAdded:), imp, c"v@:@".as_ptr());
        let name: *mut AnyObject =
            objc2::msg_send![objc2::class!(NSString), stringWithUTF8String: c"NSMenuDidAddItemNotification".as_ptr()];
        let center: *mut AnyObject = objc2::msg_send![objc2::class!(NSNotificationCenter), defaultCenter];
        let _: () = objc2::msg_send![center, addObserver: delegate, selector: objc2::sel!(helixMenuItemAdded:), name: name, object: std::ptr::null_mut::<AnyObject>()];
    }
}

// ── R engine ─────────────────────────────────────────────────────────────

/// An R result: a named numeric vector (non-finite values as null), or R's error.
type RResult = Result<HashMap<String, Option<f64>>, String>;

/// The app's one R engine runs in the hidden "engine" window (src/engine.ts).
/// Project windows send it R code (`eval_r`); each request waits here, by id, for
/// the engine's `r_result`. A request made before the engine listens, or lost when
/// its page reloads (Tauri reloads a page whose process macOS ended), is sent
/// again when the engine says it is ready.
#[derive(Default)]
struct REngine(Mutex<Requests>);

#[derive(Default)]
struct Requests {
    ready: bool,
    next_id: u64,
    waiting: HashMap<u64, (String, Sender<RResult>)>,
}

#[tauri::command]
async fn eval_r(app: AppHandle, engine: State<'_, REngine>, code: String) -> RResult {
    let (sender, mut receiver) = channel(1);
    {
        let mut requests = engine.0.lock().unwrap();
        requests.next_id += 1;
        let id = requests.next_id;
        if requests.ready {
            let _ = app.emit_to("engine", "r-eval", (id, &code));
        }
        requests.waiting.insert(id, (code, sender));
    }
    receiver.recv().await.unwrap_or_else(|| Err("R stopped unexpectedly.".into()))
}

#[tauri::command]
fn r_result(engine: State<REngine>, id: u64, values: Option<HashMap<String, Option<f64>>>, error: Option<String>) {
    if let Some((_, sender)) = engine.0.lock().unwrap().waiting.remove(&id) {
        let _ = sender.try_send(values.ok_or_else(|| error.unwrap_or_default()));
    }
}

#[tauri::command]
fn r_ready(app: AppHandle, engine: State<REngine>) {
    let mut requests = engine.0.lock().unwrap();
    requests.ready = true;
    for (id, (code, _)) in &requests.waiting {
        let _ = app.emit_to("engine", "r-eval", (id, code));
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            // All project windows share one remembered frame, which the first one opens in.
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["engine"])
                .map_label(|label| if is_project(label) { "project" } else { label })
                .build(),
        )
        .manage(Projects::default())
        .manage(REngine::default())
        .setup(|app| {
            ask_before_quitting(app.handle());
            show_menu_pictures();
            restore_session(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_opening,
            set_document,
            open_projects,
            open_sample,
            new_project,
            choose_project,
            cancel_quit,
            read_text,
            write_file,
            set_recent_documents,
            accent_color,
            open_link,
            eval_r,
            r_result,
            r_ready
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Helix")
        .run(|app, event| match event {
            // Files opened from the Finder: a double-click, Open With, a drop on the Dock icon.
            RunEvent::Opened { urls } => {
                let app = app.clone();
                let paths: Vec<_> = urls.iter().filter_map(|url| url.to_file_path().ok()).collect();
                tauri::async_runtime::spawn(async move {
                    for path in paths {
                        let into = front_window(&app).map(|w| w.label().to_string());
                        let path = path.to_string_lossy().into_owned();
                        let _ = open(&app, into, Opening { path, untitled: false });
                    }
                });
            }
            RunEvent::WindowEvent { label, event: WindowEvent::Destroyed, .. } if is_project(&label) => {
                let state = app.state::<Projects>();
                let mut projects = state.0.lock().unwrap();
                projects.documents.remove(&label);
                projects.openings.remove(&label);
                let quitting = projects.quitting;
                drop(projects);
                if !app.webview_windows().keys().any(|l| is_project(l) && *l != label) {
                    if quitting {
                        app.exit(0);
                    } else {
                        // Helix stays open: the engine window sets the menu bar for no window.
                        let _ = app.emit_to("engine", "no-windows", ());
                    }
                }
            }
            // A click on the Dock icon while no window is open: a new project.
            RunEvent::Reopen { has_visible_windows: false, .. } => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = new_window(&app, None);
                });
            }
            _ => {}
        });
}
