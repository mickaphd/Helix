import * as React from "react";
import { useProjectStore, type ProjectNode } from "./use-project-store";
import { parseProjectFile, serializeProjectFile, PROJECT_FILE_EXTENSION } from "../lib/project-file";
import * as native from "../native";

const RECENTS_KEY = "helix.recent";
// The project open when Helix last closed, reopened at the next launch.
const LAST_KEY = "helix.lastProject";
const MAX_RECENTS = 10;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * The project's document lifecycle: New / Open / Save / Save As, Open Recent, the last
 * project reopened at launch, files opened from Finder or dropped on the window, the
 * unsaved-changes dot and title on the native window, and the Save / Don't Save /
 * Cancel prompt whenever unsaved work is about to be discarded (new, open, close, quit).
 */
export function useDocument() {
  const store = useProjectStore();
  const latest = React.useRef(store);
  React.useEffect(() => {
    latest.current = store;
  });
  const [recents, setRecents] = React.useState(loadRecents);
  // The window's title while the project isn't saved anywhere.
  const [untitled, setUntitled] = React.useState("Untitled");
  const [lastProject] = React.useState(() => localStorage.getItem(LAST_KEY));
  React.useEffect(() => {
    if (store.filePath) localStorage.setItem(LAST_KEY, store.filePath);
    else localStorage.removeItem(LAST_KEY);
  }, [store.filePath]);

  const addRecent = (path: string) =>
    setRecents((list) => [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENTS));
  const clearRecents = () => setRecents([]);

  // Kept for the next launch, and handed to macOS for the Dock icon's menu.
  React.useEffect(() => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
    native.setRecentDocuments(recents);
  }, [recents]);

  React.useEffect(() => {
    native.setDocument(store.filePath ? baseName(store.filePath) : untitled, store.isDirty);
  }, [store.filePath, store.isDirty, untitled]);

  const save = async (saveAs = false): Promise<boolean> => {
    const { filePath } = latest.current;
    const target =
      (!saveAs && filePath) ||
      (await native.pickSavePath(
        "Save Project",
        filePath ?? `${untitled}.${PROJECT_FILE_EXTENSION}`,
        "Helix Project",
        PROJECT_FILE_EXTENSION,
      ));
    if (!target) return false;
    // Read the project only now, after the dialog: edits made while it was open
    // must end up in the file. The revision lets markProjectSaved keep the dirty
    // flag if something changes during the write itself.
    const s = latest.current;
    const revision = s.revision;
    try {
      await native.writeFile(target, serializeProjectFile(s));
      latest.current.markProjectSaved(target, revision);
      addRecent(target);
      return true;
    } catch (err) {
      await native.alert("Couldn't Save Project", `“${baseName(target)}” couldn't be saved there (${err}). Try Save As… another folder.`, "error");
      return false;
    }
  };

  /** True when it's fine to discard the current project (saved, or the user said so). */
  const confirmDiscard = async (): Promise<boolean> => {
    if (!latest.current.isDirty) return true;
    const answer = await native.askToSave();
    return answer === "save" ? save() : answer === "discard";
  };

  /** `quiet`: at launch, a last project that's gone is simply not reopened. */
  const load = async (path: string, quiet = false) => {
    let text: string;
    try {
      text = await native.readText(path);
    } catch {
      if (quiet) return;
      // Gone since it was opened last: it leaves Open Recent too.
      setRecents((list) => list.filter((p) => p !== path));
      return native.alert("Couldn't Open Project", `“${baseName(path)}” couldn't be found. It may have been moved or deleted.`, "error");
    }
    if (await show(text, path)) addRecent(path);
  };

  /** Puts a project's text on screen; `path` null opens it untitled. False if unreadable. */
  const show = async (text: string, path: string | null): Promise<boolean> => {
    try {
      const parsed = parseProjectFile(JSON.parse(text));
      if ("error" in parsed) {
        await native.alert("Couldn't Open Project", parsed.error, "error");
        return false;
      }
      latest.current.loadProject({ ...parsed.project, filePath: path });
      // The project is loaded; still tell the user what in it couldn't be read as is.
      const { issues } = parsed;
      if (issues.length > 0) {
        const shown = issues.slice(0, 12).map((i) => `• ${i.message}`);
        if (issues.length > 12) shown.push(`…and ${issues.length - 12} more.`);
        await native.alert(`Opened with ${issues.length} issue${issues.length === 1 ? "" : "s"}`, shown.join("\n"));
      }
      return true;
    } catch {
      await native.alert("Couldn't Open Project", "This file is damaged or isn't a valid Helix project.", "error");
      return false;
    }
  };

  /** The sample project, opened as a new document: saving asks where, so the one inside
   *  the app never changes. */
  const openSample = async () => {
    if (!(await confirmDiscard())) return;
    if (await show(await native.readSample(), null)) setUntitled("Helix Sample");
  };

  const openPath = async (path: string) => {
    if (!path.toLowerCase().endsWith(`.${PROJECT_FILE_EXTENSION}`)) {
      return native.alert("Can't Open File", "Helix can only open .hlx project files.");
    }
    if (await confirmDiscard()) await load(path);
  };

  const open = async () => {
    if (!(await confirmDiscard())) return;
    const path = await native.pickFileToOpen("Helix Project", PROJECT_FILE_EXTENSION);
    if (path) await load(path);
  };

  const newProject = async () => {
    if (!(await confirmDiscard())) return;
    latest.current.newProject();
    setUntitled("Untitled");
  };

  // Subscribed once; the handlers reach the current versions through this ref.
  const handlers = React.useRef({ confirmDiscard, openPath, load });
  React.useEffect(() => {
    handlers.current = { confirmDiscard, openPath, load };
  });
  React.useEffect(() => native.onCloseRequested(() => handlers.current.confirmDiscard()), []);
  React.useEffect(
    () =>
      native.onOpenFiles(
        (paths) => handlers.current.openPath(paths[0]),
        () => lastProject && void handlers.current.load(lastProject, true),
      ),
    [],
  );

  return { newProject, open, openPath, openSample, save, recents, clearRecents };
}

export type DocumentActions = ReturnType<typeof useDocument>;

/** Deletes a table (with its analyses and graphs), an analysis or a graph once the
 *  user confirms (Edit ▸ Undo brings it back). */
export async function removeWithConfirm(node: ProjectNode, remove: (id: string) => void) {
  const detail =
    node.type === "table" ? "Its analyses and graphs will be deleted too. You can undo this." : "You can undo this.";
  if (await native.confirmDelete(`Delete “${node.name}”?`, detail)) remove(node.id);
}
