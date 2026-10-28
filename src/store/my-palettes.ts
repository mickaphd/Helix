// My Palettes: the palettes made on this Mac, for every project and window: a file in
// Helix's data folder (local storage in a browser). Read each time they're shown, so a
// palette made in one window is in the others' menus at once.
import { alert, isNative, readMyPalettes, writeMyPalettes } from "../native";
import { readPalette } from "../lib/project-file";
import { savedPalette } from "../lib/palettes";
import type { GraphPalette } from "./types";

const KEY = "helix.palettes";

/** The palettes kept, those broken left out. */
export async function loadMyPalettes(): Promise<GraphPalette[]> {
  try {
    const list: unknown = JSON.parse((isNative ? await readMyPalettes() : localStorage.getItem(KEY)) || "[]");
    return Array.isArray(list) ? list.map(readPalette).filter((p) => p !== undefined) : [];
  } catch {
    return [];
  }
}

/** Whether the list was saved (if not, an alert said why). */
async function saveMyPalettes(list: GraphPalette[]): Promise<boolean> {
  const text = JSON.stringify(list.map(savedPalette), null, 2);
  try {
    await (isNative ? writeMyPalettes(text) : localStorage.setItem(KEY, text));
    return true;
  } catch (e) {
    await alert("Couldn't Save the Palette", String(e), "error");
    return false;
  }
}

/** Keeps `palette`, its colors in the order shown, in place of the one named
 *  `replacing` (an edit), else after the others. */
export async function keepPalette(palette: GraphPalette, replacing?: string) {
  const list = await loadMyPalettes();
  const at = list.findIndex((p) => p.name === replacing);
  return saveMyPalettes(at < 0 ? [...list, palette] : list.with(at, palette));
}

export const deletePalette = async (name: string) =>
  saveMyPalettes((await loadMyPalettes()).filter((p) => p.name !== name));
