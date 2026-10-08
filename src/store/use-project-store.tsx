import * as React from "react";

import {
  NODE_NAMES,
  type NodeType,
  type ProjectNode,
  type TableData,
  type TableType,
  type GraphType,
  type GraphOptions,
} from "./types";
import type { AnalysisParams, AnalysisPickerValue, AnalysisType } from "../stats/types";
import { TABLES } from "../views/tables";
import { GRAPHS, newGraphOptions } from "../views/graphs";
import { ANALYSES } from "../stats";
import { followTable, type TableMove } from "./references";

export type { ProjectNode } from "./types";

/** What the universal selector is currently choosing. */
type Selector =
  | { kind: "new-table" }
  | { kind: "new-analysis"; tableId: string }
  | { kind: "analysis-params"; tableId: string; testType: AnalysisPickerValue }
  | { kind: "new-graph"; tableId: string };

/** The project's content: what a file holds, and what Undo brings back. */
interface Content {
  nodes: Record<string, ProjectNode>;
  /** The tables, in sidebar order. */
  rootOrder: string[];
  /** Each table's analyses and graphs, in sidebar order. */
  childOrder: Record<string, string[]>;
}

interface ProjectState extends Content {
  activeNodeId: string | null;
  selector: Selector | null;
  /** Path of the `.hlx` file this project was opened from / last saved to. */
  filePath: string | null;
  /** True if there are changes since the last save. Drives the close-button dot. */
  isDirty: boolean;
  /** Monotonic content-revision counter, bumped on every mutating action. A save
   *  snapshots it before writing and only clears `isDirty` if it hasn't changed
   *  by the time the (async) write resolves — so an edit made mid-save is never
   *  silently marked "saved". */
  revision: number;
  /** Undo and Redo: the content before each change (newest last), and after each undo,
   *  each with the change's name for the Edit menu ("Undo Paste"). */
  past: Step[];
  future: Step[];
  /** The last change, so quick edits to the same graph (typing a title) undo together. */
  lastChange: { key: string; at: number } | null;
}

type Step = { label: string; content: Content };

const MAX_UNDO = 100;
// Changes to one graph closer together than this undo as one.
const MERGE_MS = 1000;

type Action =
  | { type: "create"; node: ProjectNode }
  | { type: "setActive"; id: string | null }
  | { type: "rename"; id: string; name: string }
  | { type: "remove"; id: string }
  /** `label` names the edit in the Edit menu; `move`: what it renamed or moved. */
  | { type: "updateTable"; id: string; data: TableData; label: string; move?: TableMove }
  | { type: "updateGraph"; id: string; options: GraphOptions; at: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "openSelector"; selector: Selector }
  | { type: "closeSelector" }
  | { type: "reorderRoot"; order: string[] }
  | { type: "reorderChildren"; parentId: string; order: string[] }
  | {
      type: "load";
      nodes: Record<string, ProjectNode>;
      rootOrder: string[];
      childOrder: Record<string, string[]>;
      activeNodeId: string | null;
      filePath: string | null;
      /** Changed as it was read (repaired, or from an older Helix): to be saved. */
      edited?: boolean;
    }
  | { type: "markSaved"; filePath: string; savedRevision: number };

function nextName(prefix: string, taken: string[]): string {
  const used = new Set<number>();
  const re = new RegExp(`^${prefix} (\\d+)$`);
  for (const n of taken) {
    const m = n.match(re);
    if (m) used.add(parseInt(m[1], 10));
  }
  let i = 1;
  while (used.has(i)) i++;
  return `${prefix} ${i}`;
}

/** `base`, or `base 2`, `base 3`… when a sibling already has it. */
function uniqueName(base: string, taken: string[]): string {
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base} ${i}`;
  return name;
}

function genId(type: NodeType): string {
  return `${type}_${Math.random().toString(36).slice(2, 10)}`;
}

export function makeInitialState(): ProjectState {
  const first: ProjectNode = {
    id: genId("table"),
    type: "table",
    name: "Table 1",
    parentId: null,
    tableType: "column",
    data: TABLES.column.defaultData(),
  };
  return {
    nodes: { [first.id]: first },
    rootOrder: [first.id],
    childOrder: { [first.id]: [] },
    activeNodeId: first.id,
    selector: null,
    filePath: null,
    isDirty: false,
    revision: 0,
    past: [],
    future: [],
    lastChange: null,
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function applyAction(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case "create": {
      const pid = action.node.parentId;
      if (pid !== null && state.nodes[pid]?.type !== "table") return state;
      // Named among the names taken now: a table "Table N" (the smallest free N), an
      // analysis or a graph what it is, with " 2" when a sibling has the name.
      const taken = (pid === null ? state.rootOrder : (state.childOrder[pid] ?? [])).map(
        (id) => state.nodes[id]?.name ?? "",
      );
      const name = pid === null ? nextName(action.node.name, taken) : uniqueName(action.node.name, taken);
      const node = { ...action.node, name };
      const nodes = { ...state.nodes, [node.id]: node };
      const rootOrder = pid === null ? [...state.rootOrder, node.id] : state.rootOrder;
      const childOrder =
        pid === null
          ? { ...state.childOrder, [node.id]: [] } // a new table starts empty
          : { ...state.childOrder, [pid]: [...(state.childOrder[pid] ?? []), node.id] };
      return { ...state, nodes, rootOrder, childOrder, activeNodeId: node.id, isDirty: true };
    }
    case "setActive":
      return { ...state, activeNodeId: action.id };
    case "rename": {
      const node = state.nodes[action.id];
      if (!node || node.name === action.name) return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, name: action.name } },
        isDirty: true,
      };
    }
    case "remove": {
      const remove = new Set<string>([action.id]);
      for (const n of Object.values(state.nodes)) if (n.parentId === action.id) remove.add(n.id);
      const nodes: Record<string, ProjectNode> = {};
      for (const [id, n] of Object.entries(state.nodes)) if (!remove.has(id)) nodes[id] = n;
      const rootOrder = state.rootOrder.filter((id) => !remove.has(id));
      // Drop removed tables' order lists, and removed children from surviving lists.
      const childOrder: Record<string, string[]> = {};
      for (const [pid, ids] of Object.entries(state.childOrder)) {
        if (remove.has(pid)) continue;
        childOrder[pid] = ids.filter((id) => !remove.has(id));
      }
      // If the active node was removed, fall back to a surviving table rather
      // than dropping to the empty state while other tables still exist.
      const activeNodeId =
        state.activeNodeId && remove.has(state.activeNodeId) ? (rootOrder[0] ?? null) : state.activeNodeId;
      return { ...state, nodes, rootOrder, childOrder, activeNodeId, isDirty: true };
    }
    case "updateTable": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "table") return state;
      const nodes = { ...state.nodes, [action.id]: { ...node, data: action.data } };
      // The table's analyses and graphs follow its renamed columns and groups, its moved
      // rows and its deleted columns.
      const columnsChanged = action.data.columns.join("\n") !== node.data?.columns.join("\n");
      if (action.move || columnsChanged) {
        for (const child of Object.values(state.nodes)) {
          if (child.parentId === action.id)
            nodes[child.id] = followTable(child, action.move ?? {}, action.data.columns);
        }
      }
      return { ...state, nodes, isDirty: true };
    }
    case "updateGraph": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "graph") return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, graphOptions: action.options } },
        isDirty: true,
      };
    }
    case "openSelector":
      return { ...state, selector: action.selector };
    case "closeSelector":
      return { ...state, selector: null };
    case "reorderRoot":
      if (arraysEqual(state.rootOrder, action.order)) return state; // no-op drop — don't dirty
      return { ...state, rootOrder: action.order, isDirty: true };
    case "reorderChildren":
      if (arraysEqual(state.childOrder[action.parentId] ?? [], action.order)) return state;
      return {
        ...state,
        childOrder: { ...state.childOrder, [action.parentId]: action.order },
        isDirty: true,
      };
    case "undo":
    case "redo": {
      const undo = action.type === "undo";
      const stack = undo ? state.past : state.future;
      const restored = stack.at(-1);
      if (!restored) return state;
      const current = {
        label: restored.label,
        content: { nodes: state.nodes, rootOrder: state.rootOrder, childOrder: state.childOrder },
      };
      const rest = stack.slice(0, -1);
      const history = undo
        ? { past: rest, future: [...state.future, current] }
        : { past: [...state.past, current], future: rest };
      // Stay on the item shown, unless the change being undone created it.
      const activeNodeId =
        state.activeNodeId && restored.content.nodes[state.activeNodeId]
          ? state.activeNodeId
          : (restored.content.rootOrder[0] ?? null);
      return { ...state, ...restored.content, ...history, activeNodeId, lastChange: null, isDirty: true };
    }
    case "load":
      return {
        nodes: action.nodes,
        rootOrder: action.rootOrder,
        childOrder: action.childOrder,
        activeNodeId: action.activeNodeId,
        selector: null,
        filePath: action.filePath,
        isDirty: action.edited ?? false,
        revision: state.revision, // bumped by the reducer wrapper (load is a MUTATING action)
        past: [],
        future: [],
        lastChange: null,
      };
    case "markSaved":
      // Clear the dirty flag only if nothing changed while the write was in
      // flight; otherwise the mid-save edit stays unsaved (and prompts on close).
      return {
        ...state,
        filePath: action.filePath,
        isDirty: state.revision !== action.savedRevision,
      };
  }
}

// The changes Undo can take back. With undo, redo and load, they bump
// `revision`; a no-op (the same state back, e.g. a reorder that moved nothing) does not.
const UNDOABLE = new Set<Action["type"]>([
  "create",
  "rename",
  "remove",
  "updateTable",
  "updateGraph",
  "reorderRoot",
  "reorderChildren",
]);
const MUTATING = new Set<Action["type"]>([...UNDOABLE, "undo", "redo", "load"]);

/** What a change is called in the Edit menu ("Undo Rename"). */
function changeName(action: Action): string {
  switch (action.type) {
    case "create":
      return `New ${NODE_NAMES[action.node.type]}`;
    case "rename":
      return "Rename";
    case "remove":
      return "Delete";
    case "updateTable":
      return action.label;
    case "updateGraph":
      return "Format Change";
    default:
      return "Move";
  }
}

/** The project's state machine: pure, so the tests (tests/checks.ts) drive it directly. */
export function reducer(state: ProjectState, action: Action): ProjectState {
  const next = applyAction(state, action);
  if (next === state || !MUTATING.has(action.type)) return next;
  const revision = state.revision + 1;
  if (!UNDOABLE.has(action.type)) return { ...next, revision };

  const change = action.type === "updateGraph" ? { key: `graph ${action.id}`, at: action.at } : null;
  const merged = change && state.lastChange?.key === change.key && change.at - state.lastChange.at < MERGE_MS;
  const before = {
    label: changeName(action),
    content: { nodes: state.nodes, rootOrder: state.rootOrder, childOrder: state.childOrder },
  };
  return {
    ...next,
    revision,
    past: merged ? state.past : [...state.past, before].slice(-MAX_UNDO),
    future: [],
    lastChange: change,
  };
}

/** What changes the project. These functions never change, so what only acts on the
 *  project (`useProjectActions`) doesn't redraw with it. */
interface ProjectActions {
  /** The project as it is now, for an action to look at (never to draw from). */
  get: () => ProjectState;
  createTable: (tableType: TableType) => void;
  createAnalysis: (parentId: string, analysisType: AnalysisType, analysisParams?: AnalysisParams) => void;
  createGraph: (parentId: string, graphType: GraphType) => void;
  setActiveNode: (id: string | null) => void;
  renameNode: (id: string, name: string) => void;
  removeNode: (id: string) => void;
  /** `label` names the edit for Undo ("Paste"); `move`: the columns or groups it renamed
   *  and the rows it moved, which the table's analyses and graphs then follow. */
  updateTable: (id: string, data: TableData, label: string, move?: TableMove) => void;
  updateGraph: (id: string, options: GraphOptions) => void;
  openSelector: (selector: Selector) => void;
  closeSelector: () => void;
  reorderTables: (order: string[]) => void;
  reorderChildren: (parentId: string, order: string[]) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (payload: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
    activeNodeId: string | null;
    /** null: a project not saved anywhere yet (the sample project). */
    filePath: string | null;
    /** Changed as it was read: it opens edited, so saving keeps it as it is now. */
    edited?: boolean;
  }) => void;
  markProjectSaved: (filePath: string, savedRevision: number) => void;
}

interface ProjectContextValue extends ProjectActions {
  nodes: Record<string, ProjectNode>;
  activeNodeId: string | null;
  activeNode: ProjectNode | null;
  activeTableId: string | null;
  selector: ProjectState["selector"];
  filePath: string | null;
  isDirty: boolean;
  /** What Undo and Redo would take back or replay ("Paste"), if anything. */
  undoName?: string;
  redoName?: string;
}

/** An item as the sidebar shows it. */
export type OutlineNode = Pick<ProjectNode, "id" | "type" | "name" | "parentId">;
/** What the sidebar shows: the tables in order, each with its analyses and graphs. */
interface Outline {
  tables: (OutlineNode & { children: OutlineNode[] })[];
  activeNodeId: string | null;
}

const outlineNode = ({ id, type, name, parentId }: ProjectNode): OutlineNode => ({ id, type, name, parentId });

/** A table's analyses and graphs, in sidebar order. */
const childrenOf = ({ nodes, childOrder }: ProjectState, tableId: string) =>
  (childOrder[tableId] ?? []).flatMap((id) => (nodes[id] ? [nodes[id]] : []));

const ProjectContext = React.createContext<ProjectContextValue | null>(null);
const ActionsContext = React.createContext<ProjectActions | null>(null);
const OutlineContext = React.createContext<Outline | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, makeInitialState);
  const latest = React.useRef(state);
  React.useLayoutEffect(() => {
    latest.current = state;
  });

  const actions = React.useMemo<ProjectActions>(
    () => ({
      get: () => latest.current,
      createTable: (tableType) =>
        dispatch({
          type: "create",
          node: {
            id: genId("table"),
            type: "table",
            name: "Table",
            parentId: null,
            tableType,
            data: TABLES[tableType].defaultData(),
          },
        }),
      // Named for the test it runs, as in Prism.
      createAnalysis: (parentId, analysisType, analysisParams) => {
        const { label, name } = ANALYSES[analysisType];
        dispatch({
          type: "create",
          node: {
            id: genId("analysis"),
            type: "analysis",
            name: name?.(analysisParams) ?? label,
            parentId,
            analysisType,
            analysisParams,
          },
        });
      },
      createGraph: (parentId, graphType) =>
        dispatch({
          type: "create",
          node: {
            id: genId("graph"),
            type: "graph",
            name: GRAPHS[graphType].label,
            parentId,
            graphType,
            graphOptions: newGraphOptions(graphType),
          },
        }),
      setActiveNode: (id) => dispatch({ type: "setActive", id }),
      renameNode: (id, name) => dispatch({ type: "rename", id, name }),
      removeNode: (id) => dispatch({ type: "remove", id }),
      updateTable: (id, data, label, move) => dispatch({ type: "updateTable", id, data, label, move }),
      updateGraph: (id, options) => dispatch({ type: "updateGraph", id, options, at: Date.now() }),
      openSelector: (selector) => dispatch({ type: "openSelector", selector }),
      closeSelector: () => dispatch({ type: "closeSelector" }),
      reorderTables: (order) => dispatch({ type: "reorderRoot", order }),
      reorderChildren: (parentId, order) => dispatch({ type: "reorderChildren", parentId, order }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      loadProject: (payload) => dispatch({ type: "load", ...payload }),
      markProjectSaved: (filePath, savedRevision) => dispatch({ type: "markSaved", filePath, savedRevision }),
    }),
    [],
  );

  const value = React.useMemo<ProjectContextValue>(() => {
    const activeNode = state.activeNodeId ? (state.nodes[state.activeNodeId] ?? null) : null;
    const activeTableId = !activeNode ? null : activeNode.type === "table" ? activeNode.id : activeNode.parentId;

    return {
      ...actions,
      nodes: state.nodes,
      activeNodeId: state.activeNodeId,
      activeNode,
      activeTableId,
      selector: state.selector,
      filePath: state.filePath,
      isDirty: state.isDirty,
      undoName: state.past.at(-1)?.label,
      redoName: state.future.at(-1)?.label,
    };
  }, [state, actions]);

  // The outline as text: editing what a table or a graph holds leaves it the same, so
  // the outline stays the same object and the sidebar doesn't redraw.
  const outlineText = JSON.stringify(
    state.rootOrder
      .filter((id) => state.nodes[id])
      .map((id) => ({ ...outlineNode(state.nodes[id]), children: childrenOf(state, id).map(outlineNode) })),
  );
  const outline = React.useMemo<Outline>(
    () => ({ tables: JSON.parse(outlineText), activeNodeId: state.activeNodeId }),
    [outlineText, state.activeNodeId],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <OutlineContext.Provider value={outline}>
        <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
      </OutlineContext.Provider>
    </ActionsContext.Provider>
  );
}

function useProjectContext<T>(context: React.Context<T | null>): T {
  const value = React.useContext(context);
  if (!value) throw new Error("The project's hooks must be used inside <ProjectProvider>");
  return value;
}

/** The whole project: redraws with any change to it. */
export const useProjectStore = () => useProjectContext(ProjectContext);
/** What changes the project, and a look at it: never redraws. */
export const useProjectActions = () => useProjectContext(ActionsContext);
/** The sidebar's outline: redraws when a name, the order or the selection changes. */
export const useOutline = () => useProjectContext(OutlineContext);
