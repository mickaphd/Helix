// The native menu bar, built from here and rebuilt when what it shows changes
// (active table type, selection, unsaved state, recent files, theme).
import * as React from "react";
import { Menu, Submenu } from "@tauri-apps/api/menu";
import { isNative, closeWindow, openLink, setTheme, type Theme } from "./native";
import { checkForUpdates } from "./updates";
import { version } from "../package.json";
import { useProjectStore } from "./store/use-project-store";
import { useLayout } from "./store/use-layout";
import { removeWithConfirm, type DocumentActions } from "./store/use-document";
import type { GraphType } from "./store/types";
import { TABLE_TYPE_OPTIONS } from "./views/tables";
import { ANALYSIS_OPTIONS_BY_TABLE } from "./views/analyses";
import { GRAPH_OPTIONS_BY_TABLE } from "./views/graphs";
import { useOpenAnalysisPicker, useStartAnalysis } from "./views/analyses/use-analysis-launcher";
import { useOpenGraphPicker } from "./views/graphs/use-graph-launcher";

const THEME_KEY = "helix.theme";

// The icon comes from the app bundle. The website and GitHub are in the Help menu.
const ABOUT = {
  name: "Helix", // spelled out: in development the process is named "helix"
  version,
  shortVersion: "", // empty: no "(1.0.0)" after the version
  credits: "Scientific data analysis, simplified.",
  copyright: "© 2026 mickaphd\nFree and open source (GPL-3.0). No warranty.",
};

/** Text-editing commands go to a focused text field natively, everything else to the
 *  table grid (whose idle input, marked `data-grid-idle`, doesn't count as a text field).
 *  Undo and Redo go to the field being typed in, else to the project (the store). */
export type EditCommand =
  | "delete"
  | "select-all"
  | "fill-down"
  | "exclude"
  | "find"
  | "find-next"
  | "find-previous";
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
  const openAnalysisPicker = useOpenAnalysisPicker();
  const startAnalysis = useStartAnalysis();
  const openGraphPicker = useOpenGraphPicker();
  const { sidebar, inspector, setLayout } = useLayout();
  const [theme, setThemeState] = React.useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) ?? "system");

  // Menu actions run long after the menu was built: read everything through this ref.
  const latest = React.useRef({ store, doc, openAnalysisPicker, startAnalysis, openGraphPicker });
  React.useEffect(() => {
    latest.current = { store, doc, openAnalysisPicker, startAnalysis, openGraphPicker };
  });

  React.useEffect(() => {
    setTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

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
  // Graphs and grouped tables have an inspector.
  const hasInspector = activeNode?.type === "graph" || (activeNode?.type === "table" && tableType === "grouped");

  React.useEffect(() => {
    if (!isNative) return;
    const run = (fn: (l: typeof latest.current, tableId: string) => void) => () => {
      const tableId = latest.current.store.activeTableId;
      if (tableId) fn(latest.current, tableId);
    };
    const sep = { item: "Separator" } as const;

    const recentItems = doc.recents.length
      ? [
          ...doc.recents.map((path) => ({
            text: path.slice(path.lastIndexOf("/") + 1),
            action: () => latest.current.doc.openPath(path),
          })),
          sep,
          { text: "Clear Menu", action: () => latest.current.doc.clearRecents() },
        ]
      : [{ text: "No Recent Projects", enabled: false }];

    const themeItem = (value: Theme, text: string) => ({
      text,
      checked: theme === value,
      action: () => setThemeState(value),
    });

    // macOS adds its menu search to the Help menu.
    const help = Submenu.new({
      text: "Help",
      items: [
        { text: "Helix Website", action: () => openLink("website") },
        { text: "Helix on GitHub", action: () => openLink("github") },
        { item: "Separator" },
        { text: "Sample Project", action: () => void latest.current.doc.openSample() },
      ],
    });

    void Menu.new({
      items: [
        {
          text: "Helix",
          items: [
            { item: { About: ABOUT }, text: "About Helix" },
            { text: "Check for Updates…", action: () => void checkForUpdates() },
            sep,
            { item: "Services" },
            sep,
            { item: "Hide", text: "Hide Helix" },
            { item: "HideOthers" },
            { item: "ShowAll" },
            sep,
            // Not the predefined Quit: closing the window first runs the unsaved-changes prompt.
            { text: "Quit Helix", accelerator: "CmdOrCtrl+Q", action: closeWindow },
          ],
        },
        {
          text: "File",
          items: [
            { text: "New Project", accelerator: "CmdOrCtrl+N", action: () => latest.current.doc.newProject() },
            { text: "Open…", accelerator: "CmdOrCtrl+O", action: () => latest.current.doc.open() },
            { text: "Open Recent", items: recentItems },
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
              text: "New Data Table",
              accelerator: "CmdOrCtrl+Shift+T",
              action: () => latest.current.store.openSelector({ kind: "new-table" }),
            },
            sep,
            ...TABLE_TYPE_OPTIONS.map((o) => ({
              text: o.label,
              action: () => latest.current.store.createTable(o.value),
            })),
            sep,
            {
              text: "Delete Selection…",
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
              text: "New Analysis",
              accelerator: "CmdOrCtrl+Shift+A",
              enabled: hasTable,
              action: run((l, id) => l.openAnalysisPicker(id)),
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
              text: "New Graph",
              accelerator: "CmdOrCtrl+Alt+G", // ⇧⌘G is Find Previous
              enabled: hasTable,
              action: run((l, id) => l.openGraphPicker(id)),
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
              accelerator: "Alt+Cmd+I",
              enabled: hasInspector,
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
        {
          text: "Window",
          items: [{ item: "Minimize" }, { item: "Maximize" }, sep, { item: "BringAllToFront" }],
        },
      ],
    })
      .then(async (menu) => {
        await menu.append(await help);
        await menu.setAsAppMenu();
        await (await help).setAsHelpMenuForNSApp();
      });
  }, [
    tableType,
    hasTable,
    activeNodeId !== null,
    hasInspector,
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
