// Open Recent: the projects last opened or saved, newest first. One list for every
// window (local storage), also handed to macOS for the Dock icon's menu.
import { setRecentDocuments } from "../native";

const KEY = "helix.recent";
export const MAX_RECENTS = 10;

export function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveRecents(paths: string[]) {
  localStorage.setItem(KEY, JSON.stringify(paths));
  setRecentDocuments(paths);
}
