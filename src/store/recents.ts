// Open Recent: the projects last opened or saved, newest first. One list for every
// window (local storage), also handed to macOS for the Dock icon's menu.
import { setRecentDocuments } from "../native";

const KEY = "helix.recent";
export const MAX_RECENTS = 10;

/** The list kept, its paths only: anything else stored there is left out. */
export function loadRecents(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((path): path is string => typeof path === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecents(paths: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(paths));
  } catch {
    // Not kept: this window's list still shows it.
  }
  setRecentDocuments(paths);
}
