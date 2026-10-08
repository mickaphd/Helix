// The native menu bar of a project window, set by the window in front (the bar is
// the app's, not a window's) and set again when what it shows changes (active table
// type, selection, unsaved state, recent files, theme) or another window comes to
// the front. Its project-free parts are in menus.ts.
import * as React from "react";
import { isNative, onFocusChange, setTheme, type Theme } from "./native";
import { projectItems, separator as sep, setMenuBar } from "./menus";
import { useProjectStore } from "./store/use-project-store";
import { useLayout } from "./store/use-layout";
import { removeWithConfirm, type DocumentActions } from "./store/use-document";
import { NODE_NAMES, type GraphType } from "./store/types";
import { TABLE_TYPE_OPTIONS } from "./views/tables";
import { ANALYSIS_OPTIONS_BY_TABLE } from "./views/analyses";
import { GRAPH_OPTIONS_BY_TABLE } from "./views/graphs";
import { useStartAnalysis } from "./views/analyses/use-analysis-launcher";

const THEME_KEY = "helix.theme";

/** The appearance chosen in View ▸ Appearance, which every window shares. */
function savedTheme(): Theme {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === "light" || theme === "dark" ? theme : "system";
  } catch {
    return "system";
  }
}

/** Text-editing commands go to a focused text field natively, everything else to the
 *  table grid (whose idle input, marked `data-grid-idle`, doesn't count as a text field).
 *  Undo and Redo go to the field being typed in, else to the project (the store). */
export type EditCommand = "delete" | "select-all" | "fill-down" | "exclude" | "find" | "find-next" | "find-previous";
const TEXT_COMMANDS: EditCommand[] = ["delete", "select-all"];

/** Where the keyboard is: a text field, the data grid, or elsewhere. */
function focusKind(): "text" | "grid" | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  return el.hasAttribute("data-grid-idle") ? "grid" : "text";
}

function edit(command: EditCommand) {
  if (focusKind() === "text" && TEXT_COMMANDS.includes(command)) {
    document.execCommand(command === "select-all" ? "selectAll" : command);
  } else {
    window.dispatchEvent(new CustomEvent<EditCommand>("helix:edit", { detail: command }));
  }
}

export function useAppMenu(doc: DocumentActions) {
  const store = useProjectStore();
  const startAnalysis = useStartAnalysis();
  const { sidebar, inspector, inspectorHere, setLayout } = useLayout();
  const [theme, setThemeState] = React.useState(savedTheme);

  // Menu actions run long after the menu was built: read everything through this ref.
  const latest = React.useRef({ store, doc, startAnalysis });
  React.useEffect(() => {
    latest.current = { store, doc, startAnalysis };
  });

  React.useEffect(() => {
    setTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not kept: the next launch follows the system.
    }
  }, [theme]);

  // Only the window in front sets the menu; it reads the theme again, which another window may have changed.
  const [focused, setFocused] = React.useState(false);
  React.useEffect(
    () =>
      onFocusChange((focus) => {
        setFocused(focus);
        if (focus) setThemeState(savedTheme());
      }),
    [],
  );

  const { activeTableId, activeNodeId, activeNode, isDirty, nodes, undoName, redoName } = store;

  // A text field being typed in has its own Undo, so the menu follows the focus.
  const [typing, setTyping] = React.useState(false);
  React.useEffect(() => {
    const update = () => setTimeout(() => setTyping(focusKind() === "text"));
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  const tableType = activeTableId ? nodes[activeTableId]?.tableType : undefined;
  const hasTable = activeTableId !== null;

  React.useEffect(() => {
    if (!isNative || !focused) return;
    const run = (fn: (l: typeof latest.current, tableId: string) => void) => () => {
      const tableId = latest.current.store.activeTableId;
      if (tableId) fn(latest.current, tableId);
    };

    const themeItem = (value: Theme, text: string) => ({
      text,
      checked: theme === value,
      action: () => setThemeState(value),
    });

    void setMenuBar([
      {
        text: "File",
        items: [
          ...projectItems(
            doc.recents,
            (path) => latest.current.doc.forgetRecent(path),
            () => latest.current.doc.clearRecents(),
          ),
          sep,
          { text: "Save", accelerator: "CmdOrCtrl+S", enabled: isDirty, action: () => latest.current.doc.save() },
          { text: "Save As…", accelerator: "CmdOrCtrl+Shift+S", action: () => latest.current.doc.save(true) },
          sep,
          { item: "CloseWindow" },
        ],
      },
      {
        // Cut/Copy/Paste are native: WebKit turns them into DOM events the grid handles.
        text: "Edit",
        items: [
          {
            text: typing || !undoName ? "Undo" : `Undo ${undoName}`,
            accelerator: "CmdOrCtrl+Z",
            enabled: typing || Boolean(undoName),
            action: () => (focusKind() === "text" ? document.execCommand("undo") : latest.current.store.undo()),
          },
          {
            text: typing || !redoName ? "Redo" : `Redo ${redoName}`,
            accelerator: "CmdOrCtrl+Shift+Z",
            enabled: typing || Boolean(redoName),
            action: () => (focusKind() === "text" ? document.execCommand("redo") : latest.current.store.redo()),
          },
          sep,
          { item: "Cut" },
          { item: "Copy" },
          { item: "Paste" },
          sep,
          { text: "Delete", enabled: hasTable, action: () => edit("delete") },
          { text: "Select All", accelerator: "CmdOrCtrl+A", action: () => edit("select-all") },
          { text: "Fill Down", accelerator: "CmdOrCtrl+D", enabled: hasTable, action: () => edit("fill-down") },
          sep,
          { text: "Exclude / Include", accelerator: "CmdOrCtrl+E", enabled: hasTable, action: () => edit("exclude") },
          sep,
          { text: "Find…", accelerator: "CmdOrCtrl+F", enabled: hasTable, action: () => edit("find") },
          { text: "Find Next", accelerator: "CmdOrCtrl+G", enabled: hasTable, action: () => edit("find-next") },
          {
            text: "Find Previous",
            accelerator: "CmdOrCtrl+Shift+G",
            enabled: hasTable,
            action: () => edit("find-previous"),
          },
        ],
      },
      {
        text: "Table",
        items: [
          {
            text: "New Table…",
            accelerator: "CmdOrCtrl+Alt+T",
            action: () => latest.current.store.openSelector({ kind: "new-table" }),
          },
          sep,
          ...TABLE_TYPE_OPTIONS.map((o) => ({
            text: o.label,
            action: () => latest.current.store.createTable(o.value),
          })),
          sep,
          {
            // What it deletes, named as the sidebar's menu names it.
            text: `Delete ${activeNode ? NODE_NAMES[activeNode.type] : "Table"}…`,
            accelerator: "CmdOrCtrl+Backspace",
            enabled: activeNodeId !== null,
            action: () => {
              // In the grid ⌘⌫ clears the selected cells; it never deletes the table from there.
              const focus = focusKind();
              if (focus === "grid") edit("delete");
              if (focus) return;
              const { activeNode, removeNode } = latest.current.store;
              if (activeNode) void removeWithConfirm(activeNode, removeNode);
            },
          },
        ],
      },
      {
        text: "Analysis",
        items: [
          {
            text: "New Analysis…",
            accelerator: "CmdOrCtrl+Alt+A",
            enabled: hasTable,
            action: run((l, id) => l.store.openSelector({ kind: "new-analysis", tableId: id })),
          },
          sep,
          ...(tableType ? ANALYSIS_OPTIONS_BY_TABLE[tableType] : []).map((o) => ({
            text: o.label,
            action: run((l, id) => l.startAnalysis(id, o.value)),
          })),
        ],
      },
      {
        text: "Graph",
        items: [
          {
            text: "New Graph…",
            accelerator: "CmdOrCtrl+Alt+G",
            enabled: hasTable,
            action: run((l, id) => l.store.openSelector({ kind: "new-graph", tableId: id })),
          },
          sep,
          ...(tableType ? GRAPH_OPTIONS_BY_TABLE[tableType] : []).map((o) => ({
            text: o.label,
            action: run((l, id) => l.store.createGraph(id, o.value as GraphType)),
          })),
        ],
      },
      {
        text: "View",
        items: [
          {
            text: sidebar ? "Hide Sidebar" : "Show Sidebar",
            accelerator: "CmdOrCtrl+B",
            action: () => setLayout({ sidebar: !sidebar }),
          },
          {
            text: inspector ? "Hide Inspector" : "Show Inspector",
            accelerator: "CmdOrCtrl+Alt+I",
            enabled: inspectorHere,
            action: () => setLayout({ inspector: !inspector }),
          },
          sep,
          {
            text: "Appearance",
            items: [themeItem("system", "Automatic"), themeItem("light", "Light"), themeItem("dark", "Dark")],
          },
          sep,
          { item: "Fullscreen" },
        ],
      },
    ]);
  }, [
    focused,
    tableType,
    hasTable,
    activeNodeId !== null,
    activeNode?.type,
    inspectorHere,
    isDirty,
    doc.recents,
    theme,
    sidebar,
    inspector,
    typing,
    undoName,
    redoName,
  ]);
}
