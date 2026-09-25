// The only module that talks to the native shell (Tauri): dialogs, files,
// window state, and files opened from Finder. Everything else in the app is
// plain web code.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { resolveResource } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Menu, type MenuOptions } from "@tauri-apps/api/menu";
import { message, open, save } from "@tauri-apps/plugin-dialog";

/** False when the UI runs in a plain browser (`npm run web`, for development). */
export const isNative = "__TAURI_INTERNALS__" in window;

const win = () => getCurrentWindow();

// ── Dialogs ────────────────────────────────────────────────────────────

/** Native alert: `title` in bold, `detail` below it. */
export async function alert(title: string, detail = "", kind: "info" | "warning" | "error" = "warning") {
  if (isNative) await message(detail, { title, kind });
  else window.alert(`${title}\n\n${detail}`);
}

/** The Save / Don't Save / Cancel prompt shown before unsaved work is discarded. */
export async function askToSave(): Promise<"save" | "discard" | "cancel"> {
  const answer = await message("Your changes will be lost if you don't save them.", {
    title: "Do you want to save the changes you made to your project?",
    kind: "warning",
    buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
  });
  if (answer === "Save" || answer === "Yes") return "save";
  if (answer === "Don't Save" || answer === "No") return "discard";
  return "cancel";
}

/** A Delete / Cancel confirmation. */
export async function confirmDelete(title: string, detail: string): Promise<boolean> {
  if (!isNative) return window.confirm(`${title}\n\n${detail}`);
  const answer = await message(detail, { title, kind: "warning", buttons: { ok: "Delete", cancel: "Cancel" } });
  return answer === "Delete" || answer === "Ok";
}

/** A Download / Later prompt for a newer version of Helix. */
export async function askToDownload(version: string): Promise<boolean> {
  const answer = await message("Download it from GitHub, then replace Helix in your Applications folder.", {
    title: `Helix ${version} is available`,
    kind: "info",
    buttons: { ok: "Download", cancel: "Later" },
  });
  return answer === "Download" || answer === "Ok";
}

/** This app's version ("1.0.0"), from its bundle. */
export const appVersion = () => getVersion();

export async function pickFileToOpen(name: string, ext: string): Promise<string | null> {
  const path = await open({ title: "Open", filters: [{ name, extensions: [ext] }] });
  return typeof path === "string" ? path : null;
}

/** `defaultPath` may be a bare file name; the panel then picks the folder. */
export async function pickSavePath(title: string, defaultPath: string, name: string, ext: string) {
  return save({ title, defaultPath, filters: [{ name, extensions: [ext] }] });
}

// ── Files ──────────────────────────────────────────────────────────────

export const readText = (path: string) => invoke<string>("read_text", { path });

/** Atomic write (temp file + rename). Bytes go as a raw body, not JSON. */
export function writeFile(path: string, data: string | Uint8Array) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return invoke("write_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

// ── Window ─────────────────────────────────────────────────────────────

export function setDocument(title: string, edited: boolean) {
  if (!isNative) return;
  win().setTitle(title);
  invoke("set_edited", { edited });
}

/** Recent projects (newest first), also listed by macOS in the Dock icon's menu. */
export function setRecentDocuments(paths: string[]) {
  if (isNative) invoke("set_recent_documents", { paths });
}

/** Run `canClose` whenever the window is about to close (red button, ⌘W, ⌘Q). */
export function onCloseRequested(canClose: () => Promise<boolean>) {
  if (!isNative) return () => {};
  const off = win().onCloseRequested(async (event) => {
    if (!(await canClose())) event.preventDefault();
  });
  return () => void off.then((f) => f());
}

export const closeWindow = () => win().close();

/** Helix's website, GitHub page or releases, in the default browser. */
export const openLink = (link: "website" | "github" | "releases") => void invoke("open_link", { link });

/** The sample project that comes inside the app (samples/ in the source). */
export const readSample = () => resolveResource("Helix Sample.hlx").then(readText);

/** Calls `handler` now and whenever the window enters or leaves full screen. */
export function onFullscreenChange(handler: (fullscreen: boolean) => void) {
  if (!isNative) return () => {};
  const check = () => void win().isFullscreen().then(handler);
  check();
  const off = win().onResized(check);
  return () => void off.then((f) => f());
}

/** Files opened from Finder (double-click, Open With, Dock drop) or dropped on the window.
 *  `launchedAlone` runs when Helix was launched without a file to open. */
export function onOpenFiles(handler: (paths: string[]) => void, launchedAlone: () => void) {
  if (!isNative) return () => {};
  const take = () => invoke<string[]>("take_opened_files").then((paths) => paths.length && handler(paths));
  // Files that launched the app arrived before we were listening.
  void invoke<string[]>("take_opened_files").then((paths) => (paths.length ? handler(paths) : launchedAlone()));
  const offs = [
    listen("opened-files", take),
    getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "drop") handler(payload.paths);
    }),
  ];
  return () => offs.forEach((off) => off.then((f) => f()));
}

export type MenuItems = NonNullable<MenuOptions["items"]>;

/** Shows a native context menu at the pointer. */
export function popupMenu(items: MenuItems) {
  if (isNative) void Menu.new({ items }).then((menu) => menu.popup());
}

export type Theme = "system" | "light" | "dark";

export function setTheme(theme: Theme) {
  if (isNative) win().setTheme(theme === "system" ? null : theme);
}
