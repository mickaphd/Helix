import * as React from "react";
import { useProjectStore, type ProjectNode } from "./use-project-store";
import { parseProjectFile, serializeProjectFile, PROJECT_FILE_EXTENSION } from "../lib/project-file";
import * as native from "../native";
import { loadRecents, MAX_RECENTS, saveRecents } from "./recents";
import { openProjectsOrSay, sayGone } from "../menus";
import { fileName, fileTitle } from "../lib/paths";

const UNTITLED = "Untitled";

const isProjectFile = (path: string) => path.toLowerCase().endsWith(`.${PROJECT_FILE_EXTENSION}`);

/**
 * The window's project, from opening to saving: what the shell gives it to open (a
 * file, the sample, a project still open when Helix last quit), files dropped on it,
 * Save / Save As, Open Recent, the title and unsaved-changes dot of the window, and the
 * Save / Don't Save / Cancel prompt when it closes. Each project has its own window:
 * the shell decides where a project opens (native.openProjects).
 */
export function useDocument() {
  const store = useProjectStore();
  const latest = React.useRef(store);
  React.useEffect(() => {
    latest.current = store;
  });
  const [recents, setRecents] = React.useState(loadRecents);
  // The window's title while the project isn't saved anywhere.
  const [untitled, setUntitled] = React.useState(UNTITLED);
  // Other windows change the list too: this one reads it again when it comes to the front.
  React.useEffect(
    () =>
      native.onFocusChange((focused) => {
        if (!focused) return;
        const stored = loadRecents();
        setRecents((list) => (stored.join("\n") === list.join("\n") ? list : stored));
      }),
    [],
  );
  const addRecent = (path: string) =>
    setRecents((list) => [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENTS));
  const clearRecents = () => setRecents([]);
  const forgetRecent = (path: string) => setRecents((list) => list.filter((p) => p !== path));

  React.useEffect(() => saveRecents(recents), [recents]);

  const { filePath, isDirty } = store;
  const title = filePath ? fileTitle(filePath) : untitled;
  const blank = !filePath && !isDirty && untitled === UNTITLED;
  // Told again when an opening fails, so the shell doesn't keep the file it expected here.
  const report = () => native.setDocument(title, filePath, isDirty, blank);
  React.useEffect(() => report(), [title, filePath, isDirty, blank]);

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
    const s = latest.current.get();
    const revision = s.revision;
    try {
      await native.writeFile(target, serializeProjectFile(s));
      latest.current.markProjectSaved(target, revision);
      addRecent(target);
      return true;
    } catch (err) {
      const name = fileName(target);
      await native.alert(
        "Couldn't Save Project",
        `“${name}” couldn't be saved there (${err}). Try Save As… another folder.`,
        "error",
      );
      return false;
    }
  };

  /** True when it's fine to discard the project (saved, or the user said so). */
  const confirmDiscard = async (): Promise<boolean> => {
    if (!latest.current.isDirty) return true;
    const answer = await native.askToSave();
    return answer === "save" ? save() : answer === "discard";
  };

  /** Opens a project file in this window; `untitled`, as a new document named after it. */
  const load = async (path: string, untitled: boolean) => {
    let text: string;
    try {
      text = await native.readText(path);
    } catch {
      report();
      // Gone since it was opened last: it leaves Open Recent too.
      setRecents((list) => list.filter((p) => p !== path));
      return sayGone(path);
    }
    try {
      const parsed = parseProjectFile(JSON.parse(text));
      if ("error" in parsed) {
        report();
        return native.alert("Couldn't Open Project", parsed.error, "error");
      }
      // A file changed as it was read (repaired, or from an older Helix) opens edited: saving
      // it keeps the project as it is now. The sample stays untitled, never to be saved.
      const edited = parsed.updated && !untitled;
      latest.current.loadProject({ ...parsed.project, filePath: untitled ? null : path, edited });
      if (untitled) setUntitled(fileTitle(path));
      else addRecent(path);
      // The project is loaded; still tell the user what in it couldn't be read as is.
      const { issues } = parsed;
      const save = edited ? "Save the project to keep it as it is now." : "";
      if (issues.length > 0) {
        const shown = issues.slice(0, 12).map((i) => `• ${i.message}`);
        if (issues.length > 12) shown.push(`…and ${issues.length - 12} more.`);
        if (save) shown.push("", save);
        await native.alert(`Opened with ${issues.length} Issue${issues.length === 1 ? "" : "s"}`, shown.join("\n"));
      } else if (edited) {
        await native.alert(
          "Project Updated",
          "This project was made with an older Helix, or part of it couldn't be read as it was. " +
            "Helix brought it up to date; save it to keep the update.",
          "info",
        );
      }
    } catch {
      report();
      await native.alert("Couldn't Open Project", "This file is damaged or isn't a valid Helix project.", "error");
    }
  };

  const openPaths = (paths: string[]) => {
    const projects = paths.filter(isProjectFile);
    if (projects.length < paths.length) void native.alert("Can't Open File", "Helix can only open .hlx project files.");
    if (projects.length) openProjectsOrSay(projects);
  };

  // Subscribed once; the handlers reach the current versions through this ref.
  const handlers = React.useRef({ confirmDiscard, load, openPaths });
  React.useEffect(() => {
    handlers.current = { confirmDiscard, load, openPaths };
  });
  React.useEffect(() => native.onCloseRequested(() => handlers.current.confirmDiscard()), []);
  React.useEffect(() => native.onDrop((paths) => handlers.current.openPaths(paths)), []);
  React.useEffect(() => native.onOpening(({ path, untitled }) => void handlers.current.load(path, untitled)), []);

  return { save, recents, forgetRecent, clearRecents };
}

export type DocumentActions = ReturnType<typeof useDocument>;

/** Deletes a table (with its analyses and graphs), an analysis or a graph once the
 *  user confirms (Edit ▸ Undo brings it back). */
export async function removeWithConfirm(node: Pick<ProjectNode, "id" | "name" | "type">, remove: (id: string) => void) {
  const detail =
    node.type === "table" ? "Its analyses and graphs will be deleted too. You can undo this." : "You can undo this.";
  if (await native.confirmDelete(`Delete “${node.name}”?`, detail)) remove(node.id);
}
