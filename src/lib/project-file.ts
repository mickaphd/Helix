// The Helix project file (.hlx): plain JSON, described in FILE-FORMAT.md, so a
// project is never locked into Helix.
//
// A file must keep opening across versions, in both directions:
//   1. Fields are only ever added, never renamed or removed.
//   2. Reading forgives: names match whatever their case, a value of the wrong
//      type falls back to its default, a broken item is skipped on its own, and
//      fields this version doesn't know are kept, so saving doesn't lose them.
// `schemaVersion` is informative; nothing branches on it.

import {
  DEFAULT_GRAPH_OPTIONS,
  type GraphOptions,
  type NodeType,
  type PaletteColor,
  type ProjectNode,
  type TableData,
} from "../store/types";
import type { AnalysisParams } from "../stats/types";
import { PALETTE_ORDER } from "./palette";
import { TABLES } from "../views/tables";
import { GRAPHS, GRAPH_OPTIONS_BY_TABLE } from "../views/graphs";
import { ANALYSES } from "../stats";

export const PROJECT_FILE_EXTENSION = "hlx";

export interface ProjectFilePayload {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  /** Each table's analyses and graphs, in sidebar order. */
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
}

// ── Writing ──────────────────────────────────────────────────────────────

export function serializeProjectFile({ nodes, rootOrder, childOrder, activeNodeId }: ProjectFilePayload): string {
  const project: ProjectFilePayload = { nodes, rootOrder, childOrder, activeNodeId };
  return format({ app: "helix", schemaVersion: 1, savedAt: new Date().toISOString(), project }, "") + "\n";
}

/** Indented JSON, with each list of plain values (a table row, the column names)
 *  on one line, so a table reads row by row. */
function format(value: unknown, indent: string): string {
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== "object" || v === null)) return JSON.stringify(value);
  const inner = indent + "  ";
  const items = Array.isArray(value)
    ? value.map((v) => inner + format(v, inner))
    : Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`);
  const [open, close] = Array.isArray(value) ? "[]" : "{}";
  return items.length ? `${open}\n${items.join(",\n")}\n${indent}${close}` : open + close;
}

// ── Reading ──────────────────────────────────────────────────────────────

interface ProjectIssue {
  severity: "error" | "warning";
  message: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);
/** `obj` without its empty (undefined) fields. */
const defined = <T extends object>(obj: T) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

/** `obj` with its known keys spelled as Helix writes them, whatever their case. */
function canonical(obj: Obj, keys: readonly string[]): Obj {
  const spelling = new Map(keys.map((k) => [k.toLowerCase(), k]));
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [spelling.get(k.toLowerCase()) ?? k, v]));
}

// Every field Helix knows, per level. The `satisfies` checks make TypeScript
// flag any field added to a type but not listed here.
const FILE_KEYS = ["app", "schemaVersion", "savedAt", "project"];
const PROJECT_KEYS = ["nodes", "rootOrder", "childOrder", "activeNodeId"] satisfies (keyof ProjectFilePayload)[];
const NODE_KEYS = Object.keys({
  id: 1, type: 1, name: 1, parentId: 1, tableType: 1, data: 1,
  analysisType: 1, analysisParams: 1, graphType: 1, graphOptions: 1,
} satisfies Record<keyof ProjectNode, 1>);
const DATA_KEYS = Object.keys({
  columns: 1, rows: 1, groups: 1, replicates: 1, excluded: 1,
  seriesColors: 1, pointColors: 1, widths: 1, freezeTitle: 1,
} satisfies Record<keyof TableData, 1>);

// Graph options without a default, by the kind of value they hold.
type OptionalOption = { [K in keyof GraphOptions]-?: undefined extends GraphOptions[K] ? K : never }[keyof GraphOptions];
const OPTIONAL_OPTIONS = {
  yMin: "number", yMax: "number", yStep: "number", xMin: "number", xMax: "number", xStep: "number",
  sigAnalysisId: "text", sigPairs: "texts", regAnalysisId: "text", doseY: "text",
  volcanoX: "text", volcanoY: "text", volcanoLabel: "text", volcanoGroupA: "text", volcanoGroupB: "text",
} as const satisfies Record<OptionalOption, "number" | "text" | "texts">;
// Options whose text is the user's (titles, column names), not a choice from a list.
const FREE_TEXT_OPTIONS = new Set(["title", "xLabel", "yLabel"]);

type ParamKey = AnalysisParams extends infer P ? (P extends unknown ? keyof P : never) : never;
const PARAM_KEYS = Object.keys({
  paired: 1, gaussian: 1, equalVariance: 1, ratio: 1, tails: 1, hypotheticalValue: 1, posthoc: 1,
  y: 1, forceOrigin: 1, baseline: 1, model: 1, method: 1, mode: 1, datasets: 1, dependent: 1,
  predictors: 1, design: 1, posthocTarget: 1, pooledSd: 1, correction: 1, q: 1,
} satisfies Record<ParamKey, 1>);
// Params naming columns: their text is the user's.
const FREE_TEXT_PARAMS = new Set(["y", "dependent", "datasets", "predictors"]);

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const cellText = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null);

function colors(v: unknown): Record<string, PaletteColor> | undefined {
  if (!isObj(v)) return undefined;
  const out = Object.entries(v)
    .map(([k, c]) => [k, lower(c)] as const)
    .filter((e): e is [string, PaletteColor] => PALETTE_ORDER.includes(e[1] as PaletteColor));
  return out.length ? Object.fromEntries(out) : undefined;
}

function readData(raw: Obj): TableData | null {
  const d = canonical(raw, DATA_KEYS);
  if (!Array.isArray(d.columns) || !Array.isArray(d.rows)) return null;
  const columns = d.columns.map((c) => cellText(c) ?? "");
  const excluded = Array.isArray(d.excluded)
    ? d.excluded.filter((k): k is string => typeof k === "string" && /^\d+,\d+$/.test(k))
    : [];
  const widths = isObj(d.widths)
    ? Object.fromEntries(Object.entries(d.widths).filter(([, w]) => isFiniteNumber(w) && w > 0))
    : {};
  return defined({
    ...d,
    columns: columns.length ? columns : ["Title"],
    rows: d.rows.map((row) => (Array.isArray(row) ? row.map((c) => cellText(c) || null) : [])),
    groups: isCount(d.groups) && isCount(d.replicates) ? d.groups : undefined,
    replicates: isCount(d.groups) && isCount(d.replicates) ? d.replicates : undefined,
    excluded: excluded.length ? excluded : undefined,
    seriesColors: colors(d.seriesColors),
    pointColors: colors(d.pointColors),
    widths: Object.keys(widths).length ? (widths as Record<string, number>) : undefined,
    freezeTitle: d.freezeTitle === true || undefined,
  } as TableData);
}

/** Every option, each of the right type: a missing or wrong one takes its default. */
function readOptions(raw: unknown): GraphOptions {
  const o = isObj(raw) ? canonical(raw, [...Object.keys(DEFAULT_GRAPH_OPTIONS), ...Object.keys(OPTIONAL_OPTIONS)]) : {};
  const out: Obj = { ...o, ...DEFAULT_GRAPH_OPTIONS };
  for (const [key, fallback] of Object.entries(DEFAULT_GRAPH_OPTIONS)) {
    const v = typeof o[key] === "string" && !FREE_TEXT_OPTIONS.has(key) ? lower(o[key]) : o[key];
    if (typeof v === typeof fallback && (typeof v !== "number" || Number.isFinite(v))) out[key] = v;
  }
  for (const [key, kind] of Object.entries(OPTIONAL_OPTIONS)) {
    const v = o[key];
    const ok =
      kind === "number" ? isFiniteNumber(v) : kind === "text" ? typeof v === "string" : Array.isArray(v) && v.every((s) => typeof s === "string");
    out[key] = ok ? v : undefined;
  }
  return defined(out) as unknown as GraphOptions;
}

function readParams(raw: unknown): AnalysisParams | undefined {
  if (!isObj(raw)) return undefined;
  const p = canonical(raw, PARAM_KEYS);
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, FREE_TEXT_PARAMS.has(k) ? v : lower(v)])) as unknown as AnalysisParams;
}

const NODE_TYPES: NodeType[] = ["table", "analysis", "graph"];

function readNode(id: string, raw: unknown, issues: ProjectIssue[]): ProjectNode | null {
  if (!isObj(raw)) return null;
  const n = canonical(raw, NODE_KEYS);
  const type = lower(n.type) as NodeType;
  if (!NODE_TYPES.includes(type)) return null;
  const node = { ...n, id, type, name: cellText(n.name) ?? "Untitled", parentId: typeof n.parentId === "string" ? n.parentId : null } as ProjectNode;

  if (type === "table") {
    const data = isObj(n.data) ? readData(n.data) : null;
    if (!data) return null;
    node.data = data;
    node.parentId = null;
    node.tableType = lower(n.tableType) as ProjectNode["tableType"];
    if (!node.tableType || !(node.tableType in TABLES)) {
      issues.push({ severity: "warning", message: `Table “${node.name}” has a type this version doesn't know; it opens as a Column table.` });
      node.tableType = "column";
    }
  } else if (type === "analysis") {
    node.analysisType = lower(n.analysisType) as ProjectNode["analysisType"];
    node.analysisParams = readParams(n.analysisParams);
    if (!node.analysisType || !(node.analysisType in ANALYSES)) {
      issues.push({ severity: "error", message: `Analysis “${node.name}” uses a test this version doesn't know.` });
    }
  } else {
    node.graphType = lower(n.graphType) as ProjectNode["graphType"];
    node.graphOptions = readOptions(n.graphOptions);
    if (!node.graphType || !(node.graphType in GRAPHS)) {
      issues.push({ severity: "error", message: `Graph “${node.name}” uses a chart this version doesn't know.` });
    }
  }
  return node;
}

/** Reads a `.hlx` file forgivingly. `{ error }` only when nothing usable remains;
 *  otherwise the project, and what the user should know about it. */
export function parseProjectFile(raw: unknown): { project: ProjectFilePayload; issues: ProjectIssue[] } | { error: string } {
  if (!isObj(raw)) return { error: "Not a valid Helix project file." };
  const file = canonical(raw, FILE_KEYS);
  if (lower(file.app) !== "helix") return { error: "This file was not created by Helix." };
  const project = isObj(file.project) ? canonical(file.project, PROJECT_KEYS) : null;
  if (!project || !isObj(project.nodes)) return { error: "This file's project data is missing or corrupted." };

  const issues: ProjectIssue[] = [];
  const nodes: Record<string, ProjectNode> = {};
  let skipped = 0;
  for (const [id, raw] of Object.entries(project.nodes)) {
    const node = readNode(id, raw, issues);
    if (node) nodes[id] = node;
    else skipped++;
  }
  // Analyses and graphs belong to a table: drop those whose table didn't survive.
  for (const node of Object.values(nodes)) {
    if (node.type !== "table" && nodes[node.parentId ?? ""]?.type !== "table") {
      delete nodes[node.id];
      skipped++;
    }
  }
  if (skipped) {
    issues.push({ severity: "warning", message: `${skipped} unreadable item${skipped === 1 ? " was" : "s were"} left out.` });
  }

  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
  const tables = Object.values(nodes).filter((n) => n.type === "table");
  if (tables.length === 0) return { error: "This project file has no readable data tables." };
  // Saved order first, then anything the order missed.
  const rootOrder = [...new Set([...ids(project.rootOrder).filter((id) => nodes[id]?.type === "table"), ...tables.map((t) => t.id)])];
  const savedChildren = isObj(project.childOrder) ? project.childOrder : {};
  const childOrder = Object.fromEntries(
    rootOrder.map((tableId) => {
      const children = Object.values(nodes).filter((n) => n.parentId === tableId).map((n) => n.id);
      const saved = ids(savedChildren[tableId]).filter((id) => children.includes(id));
      return [tableId, [...new Set([...saved, ...children])]];
    }),
  );
  const activeNodeId = typeof project.activeNodeId === "string" && nodes[project.activeNodeId] ? project.activeNodeId : rootOrder[0];

  for (const node of Object.values(nodes)) {
    const tableType = node.parentId ? nodes[node.parentId]?.tableType : undefined;
    if (node.type !== "graph" || !node.graphType || !tableType) continue;
    if (node.graphType in GRAPHS && !GRAPH_OPTIONS_BY_TABLE[tableType].some((o) => o.value === node.graphType)) {
      issues.push({ severity: "warning", message: `Graph “${node.name}” isn't a chart Helix offers for a ${TABLES[tableType].label} table.` });
    }
    const o = node.graphOptions!;
    if ((o.sigAnalysisId && !nodes[o.sigAnalysisId]) || (o.regAnalysisId && !nodes[o.regAnalysisId])) {
      issues.push({ severity: "warning", message: `Graph “${node.name}” refers to an analysis that no longer exists.` });
    }
  }

  return { project: { nodes, rootOrder, childOrder, activeNodeId }, issues };
}
