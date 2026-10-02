// The only module that talks to the native shell (Tauri): dialogs, files, the
// project windows and what they open, and the R engine. Everything else in the
// app is plain web code.
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getVersion, setTheme as setAppTheme } from "@tauri-apps/api/app";
import { Image } from "@tauri-apps/api/image";
import { Menu, Submenu, type MenuOptions } from "@tauri-apps/api/menu";
import { message, save } from "@tauri-apps/plugin-dialog";
import type { RVector } from "./stats/webr";

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

// ── R engine ───────────────────────────────────────────────────────────
// One R for the whole app, in the hidden "engine" window. The native shell
// passes each request there and its answer back (see main.rs, `REngine`).

/** From a project window: runs R code in the engine. */
export function evalR(code: string): Promise<RVector> {
  return invoke<RVector>("eval_r", { code }).catch((err: unknown) => {
    throw new Error(String(err));
  });
}

/** In the engine window: answers every request with `evaluate`. */
export async function serveR(evaluate: (code: string) => Promise<RVector>) {
  await getCurrentWebviewWindow().listen<[number, string]>("r-eval", ({ payload: [id, code] }) =>
    evaluate(code).then(
      (values) => invoke("r_result", { id, values }),
      (err: unknown) => invoke("r_result", { id, error: err instanceof Error ? err.message : String(err) }),
    ),
  );
  await invoke("r_ready");
}

// ── Window ─────────────────────────────────────────────────────────────

/** The window's title, and what the shell needs to know of its project: its file,
 *  its unsaved changes (the dot in the close button), and whether it is blank. */
export function setDocument(title: string, path: string | null, edited: boolean, blank: boolean) {
  if (!isNative) return;
  win().setTitle(title);
  invoke("set_document", { path, edited, blank });
}

/** Recent projects (newest first), also listed by macOS in the Dock icon's menu. */
export function setRecentDocuments(paths: string[]) {
  if (isNative) invoke("set_recent_documents", { paths });
}

/** Run `canClose` whenever the window is about to close (red button, ⌘W, ⌘Q). A window
 *  that stays open while Helix quits stops the quitting. */
export function onCloseRequested(canClose: () => Promise<boolean>) {
  if (!isNative) return () => {};
  const off = win().onCloseRequested(async (event) => {
    if (await canClose()) return;
    event.preventDefault();
    void invoke("cancel_quit");
  });
  return () => void off.then((f) => f());
}

/** The accent color chosen in System Settings ▸ Appearance (#RRGGBB), or null. */
export const accentColor = () => (isNative ? invoke<string | null>("accent_color") : Promise.resolve(null));

/** Helix's website, GitHub page or releases, in the default browser. */
export const openLink = (link: "website" | "github" | "releases") => void invoke("open_link", { link });

/** Calls `handler` now and whenever the window enters or leaves full screen. */
export function onFullscreenChange(handler: (fullscreen: boolean) => void) {
  if (!isNative) return () => {};
  const check = () => void win().isFullscreen().then(handler);
  check();
  const off = win().onResized(check);
  return () => void off.then((f) => f());
}

/** Calls `handler` now and whenever the window comes to the front or goes behind another. */
export function onFocusChange(handler: (focused: boolean) => void) {
  if (!isNative) return () => {};
  void win().isFocused().then(handler);
  const off = win().onFocusChanged(({ payload }) => handler(payload));
  return () => void off.then((f) => f());
}

// ── Projects ───────────────────────────────────────────────────────────
// Each project has its own window. The shell knows which window holds which
// file, so it decides where a project opens (see main.rs, `Projects`).

/** A project file for a window to open; `untitled`: as a new document, like the sample. */
type Opening = { path: string; untitled: boolean };

/** Opens projects: in their window if they're open, in this one if it's blank, else in new
 *  ones. Rejects with the path of a file that is gone, and opens nothing. */
export const openProjects = (paths: string[]) => invoke("open_projects", { paths });

/** The sample project, which ships inside the app, as a new document. */
export const openSample = () => invoke("open_sample");

/** A new window with a new project. */
export const newProject = () => invoke("new_project");

/** File ▸ Open…: the Open panel, then the chosen project opens as `openProjects` decides. */
export const chooseProject = () => invoke("choose_project");

/** In the engine window: calls `handler` when the last project window has closed. */
export function onNoWindows(handler: () => void) {
  if (!isNative) return () => {};
  const off = getCurrentWebviewWindow().listen("no-windows", handler);
  return () => void off.then((f) => f());
}

/** Calls `handler` with what this window should open: once its page is ready, and
 *  whenever the shell gives it more (⌘O, Open Recent, the Finder, the Dock). */
export function onOpening(handler: (opening: Opening) => void) {
  if (!isNative) return () => {};
  const take = () => invoke<Opening | null>("take_opening").then((opening) => opening && handler(opening));
  // Listening first: an opening given while this window takes the first is not lost.
  const off = getCurrentWebviewWindow().listen("opening", take);
  void off.then(take);
  return () => void off.then((f) => f());
}

/** Calls `handler` with the files dropped on the window. */
export function onDrop(handler: (paths: string[]) => void) {
  if (!isNative) return () => {};
  const off = getCurrentWebviewWindow().onDragDropEvent(({ payload }) => {
    if (payload.type === "drop") handler(payload.paths);
  });
  return () => void off.then((f) => f());
}

export type MenuItems = NonNullable<MenuOptions["items"]>;

// Menus made here live in the shell until closed, even once replaced: each one is
// closed when it's done with, or they would pile up until Helix quits.
let menuBar: (Menu | Submenu)[] = [];

/** Installs the app's menu bar: `menus`, then Window and Help, which macOS fills with
 *  the open windows and its menu search. */
export async function installMenuBar(menus: MenuItems, windowItems: MenuItems, helpItems: MenuItems) {
  if (!isNative) return;
  const windows = await Submenu.new({ text: "Window", items: windowItems });
  const help = await Submenu.new({ text: "Help", items: helpItems });
  const menu = await Menu.new({ items: [...menus, windows, help] });
  await menu.setAsAppMenu();
  await windows.setAsWindowsMenuForNSApp();
  await help.setAsHelpMenuForNSApp();
  const replaced = menuBar;
  menuBar = [menu, windows, help];
  for (const old of replaced) void old.close();
}

/** A menu item's picture: RGBA pixels, shown 18 points high (36 pixels on Retina). */
export type Picture = { rgba: Uint8Array; width: number; height: number };
type PictureItem = { text: string; icon: Picture; action: () => void };
type PopupItem = MenuItems[number] | PictureItem | { text: string; items: PopupItem[] };
const isPicture = (icon: unknown): icon is Picture => typeof icon === "object" && icon !== null && (icon as Picture).rgba instanceof Uint8Array;

// macOS leaves 8 points more right of a menu's pictures than left of them (room for key
// equivalents): in a menu of pictures alone, each gets that much more on its left
// (16 pixels on Retina), so it shows centered.
const CENTERING = 16;

/** `picture` with `by` transparent pixels more on its left. */
function shifted({ rgba, width, height }: Picture, by: number): Picture {
  const wider = new Uint8Array((width + by) * height * 4);
  for (let y = 0; y < height; y++) wider.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), (y * (width + by) + by) * 4);
  return { rgba: wider, width: width + by, height };
}

/** Shows a native context menu at the pointer (the call returns once it has closed). An
 *  item may show a picture before its text, in a submenu too. */
export async function popupMenu(items: PopupItem[]) {
  if (!isNative) return;
  const images: Image[] = [];
  // Each picture becomes an image the menu can show, freed once it has closed; in a menu
  // of pictures alone (as main.rs tells them: no text; separators aside), centered.
  const withImages = async (list: PopupItem[]): Promise<MenuItems> => {
    const alone = list.every((item) => !("text" in item) || (item.text === "" && "icon" in item && isPicture(item.icon)));
    return Promise.all(
      list.map(async (item) => {
        if ("icon" in item && isPicture(item.icon)) {
          const picture = alone ? shifted(item.icon, CENTERING) : item.icon;
          const image = await Image.new(picture.rgba, picture.width, picture.height);
          images.push(image);
          return { ...item, icon: image };
        }
        if ("items" in item && Array.isArray(item.items)) return { ...item, items: await withImages(item.items as PopupItem[]) };
        return item;
      }),
    ) as Promise<MenuItems>;
  };
  const menu = await Menu.new({ items: await withImages(items) });
  await menu.popup();
  await menu.close();
  for (const image of images) void image.close();
}

export type Theme = "system" | "light" | "dark";

/** The appearance of every window. */
export function setTheme(theme: Theme) {
  if (isNative) void setAppTheme(theme === "system" ? null : theme);
}
