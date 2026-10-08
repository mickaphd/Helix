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
  FILL_PATTERNS,
  GRAPH_CHOICES,
  GRAPH_LIMITS,
  clamp,
  type Limits,
  type GraphOptions,
  type GraphPalette,
  type NodeType,
  PALETTE_KINDS,
  type PaletteColor,
  type PaletteKind,
  type Place,
  type PointStyle,
  type ProjectNode,
  SAME_AS_FILL,
  type SeriesStyle,
  type TableData,
} from "../store/types";
import {
  type AnalysisParams,
  CORRECTIONS,
  CORRELATION_METHODS,
  CORRELATION_MODES,
  NONLINEAR_MODELS,
  POSTHOC_TARGETS,
  POSTHOCS,
  RANK_POSTHOCS,
  ROUT_Q,
  TAILS,
  TWO_WAY_DESIGNS,
} from "../stats/types";
import { NAMED_COLORS, paletteNamed, savedPalette } from "./palettes";
import { TABLES } from "../views/tables";
import { GRAPHS, GRAPH_OPTIONS_BY_TABLE } from "../views/graphs";
import { ANALYSES } from "../stats";
import { isGrouped } from "./dataset";
import { seriesKeyOf } from "./columns";
import { regroupTable } from "../views/tables/table-data";

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
const defined = <T extends object>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

/** `obj` with its known keys spelled as Helix writes them, whatever their case. */
function canonical(obj: Obj, keys: readonly string[]): Obj {
  const spelling = new Map(keys.map((k) => [k.toLowerCase(), k]));
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [spelling.get(k.toLowerCase()) ?? k, v]));
}

// Every field Helix knows, per level. The `satisfies` checks make TypeScript
// flag any field added to a type but not listed here.
const FILE_KEYS = ["app", "schemaVersion", "savedAt", "project"];
const PROJECT_KEYS = ["nodes", "rootOrder", "childOrder", "activeNodeId"] satisfies (keyof ProjectFilePayload)[];
// prettier-ignore
const NODE_KEYS = Object.keys({
  id: 1, type: 1, name: 1, parentId: 1, tableType: 1, data: 1,
  analysisType: 1, analysisParams: 1, graphType: 1, graphOptions: 1,
} satisfies Record<keyof ProjectNode, 1>);
// prettier-ignore
const DATA_KEYS = Object.keys({
  columns: 1, rows: 1, groups: 1, replicates: 1, excluded: 1,
  widths: 1, freezeTitle: 1,
} satisfies Record<keyof TableData, 1>);

// Graph options without a default, by the kind of value they hold.
type OptionalOption = {
  [K in keyof GraphOptions]-?: undefined extends GraphOptions[K] ? K : never;
}[keyof GraphOptions];
// prettier-ignore
const OPTIONAL_OPTIONS = {
  yMin: "number", yMax: "number", yStep: "number", xMin: "number", xMax: "number", xStep: "number",
  sigAnalysisId: "text", sigPairs: "texts", regAnalysisId: "text", doseY: "text",
  volcanoX: "text", volcanoY: "text", volcanoLabel: "text", volcanoGroupA: "text", volcanoGroupB: "text",
  palette: "palette", series: "styles", points: "pointStyles", outlineColor: "color", pointOutlineColor: "color", errorColor: "color",
  legend: "place", note: "place",
} as const satisfies Record<OptionalOption, keyof typeof READ_OPTION>;
// Options whose text is the user's (titles, column names), not a choice from a list.
const FREE_TEXT_OPTIONS = new Set(["title", "xLabel", "yLabel"]);

// Every graph option offering choices has its list, and every number its limits.
type ChoiceOption = {
  [K in keyof GraphOptions]-?: string extends GraphOptions[K] ? never : GraphOptions[K] extends string ? K : never;
}[keyof GraphOptions];
type NumberOption = { [K in keyof GraphOptions]-?: GraphOptions[K] extends number ? K : never }[keyof GraphOptions];
GRAPH_CHOICES satisfies Record<ChoiceOption, readonly string[]>;
GRAPH_LIMITS satisfies Record<NumberOption, Limits>;

// What each analysis param holds: a choice from its list, yes/no, a number (within its
// limits), or the user's names (of columns). The R code is written with them: anything
// else is left out (the test takes its default), so a file can't slip R code into it.
type ParamKey = AnalysisParams extends infer P ? (P extends unknown ? keyof P : never) : never;
type ParamKind = "yes/no" | "number" | "name" | "names" | readonly string[] | Limits;
// prettier-ignore
const PARAMS = {
  paired: "yes/no", gaussian: "yes/no", equalVariance: "yes/no", ratio: "yes/no", forceOrigin: "yes/no", pooledSd: "yes/no",
  tails: TAILS, posthoc: [...POSTHOCS, ...RANK_POSTHOCS], model: NONLINEAR_MODELS, method: CORRELATION_METHODS,
  mode: CORRELATION_MODES, design: TWO_WAY_DESIGNS, posthocTarget: POSTHOC_TARGETS, correction: CORRECTIONS,
  hypotheticalValue: "number", baseline: "number", q: ROUT_Q,
  y: "name", dependent: "name", datasets: "names", predictors: "names", sets: "names",
} satisfies Record<ParamKey, ParamKind>;

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const cellText = (v: unknown) =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

const isWord = (v: unknown) =>
  typeof v === "boolean" || isFiniteNumber(v) || (typeof v === "string" && /^[a-z0-9.-]+$/.test(v));

/** Whether `key` is one of `list`'s own entries (not a name every object has, as "constructor"). */
const isIn = (list: object, key: unknown) => typeof key === "string" && Object.hasOwn(list, key);

const isNamed = (v: unknown): v is PaletteColor => typeof v === "string" && Object.hasOwn(NAMED_COLORS, v);

/** Named colors (Helix 1.0's), by key. */
function colors(v: unknown): Record<string, PaletteColor> | undefined {
  if (!isObj(v)) return undefined;
  const out = Object.entries(v)
    .map(([k, c]) => [k, lower(c)] as const)
    .filter((e): e is [string, PaletteColor] => isNamed(e[1]));
  return out.length ? Object.fromEntries(out) : undefined;
}

/** `v` when it is one of `choices`, whatever its case. */
const oneOf = <T extends string>(choices: readonly T[], v: unknown) => choices.find((c) => c === lower(v));

/** A number brought within `limits`; anything else, none. */
const within = (v: unknown, limits: Limits) => (isFiniteNumber(v) ? clamp(v, limits) : undefined);

function readPalette(v: unknown): GraphPalette | undefined {
  if (!isObj(v)) return undefined;
  const p = canonical(v, ["name", "kind", "colors", "reversed"]);
  const colors = Array.isArray(p.colors) ? p.colors.filter(isHex) : [];
  if (typeof p.name !== "string" || !colors.length) return undefined;
  const kind = oneOf(PALETTE_KINDS, p.kind) ?? "categorical";
  return defined({ ...p, name: p.name, kind, colors, reversed: p.reversed === true || undefined });
}

/** Each series' style, keeping what this version doesn't know of it. */
function readStyles(v: unknown): Record<string, SeriesStyle> | undefined {
  if (!isObj(v)) return undefined;
  const out = Object.entries(v)
    .filter((e): e is [string, Obj] => isObj(e[1]))
    .map(([key, raw]) => {
      const style = canonical(raw, ["color", "shape", "dash", "pattern"]);
      const shape = oneOf(GRAPH_CHOICES.pointShape, style.shape);
      const dash = oneOf(GRAPH_CHOICES.lineDash, style.dash);
      const pattern = oneOf(FILL_PATTERNS, style.pattern);
      return [
        key,
        defined({ ...style, color: isHex(style.color) ? style.color : undefined, shape, dash, pattern }),
      ] as const;
    })
    .filter(([, style]) => Object.keys(style).length);
  return out.length ? Object.fromEntries(out) : undefined;
}

/** A position, both coordinates numbers. */
const readPlace = (v: unknown): Place | undefined =>
  isObj(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) ? { x: v.x, y: v.y } : undefined;

/** Each point's style, keeping what this version doesn't know of it. */
function readPointStyles(v: unknown): Record<string, PointStyle> | undefined {
  if (!isObj(v)) return undefined;
  const out = Object.entries(v)
    .filter((e): e is [string, Obj] => isObj(e[1]) && /#\d+$/.test(e[0]))
    .map(([key, raw]) => {
      const p = canonical(raw, ["color", "size", "shape", "fill", "outline", "outlineColor", "label", "labelOffset"]);
      const shape = oneOf(GRAPH_CHOICES.pointShape, p.shape);
      const color = isHex(p.color) ? p.color : undefined;
      const outlineColor = isHex(p.outlineColor)
        ? p.outlineColor
        : lower(p.outlineColor) === SAME_AS_FILL
          ? SAME_AS_FILL
          : undefined;
      const label = p.label === true || undefined;
      const labelOffset = readPlace(p.labelOffset);
      const size = within(p.size, GRAPH_LIMITS.pointSize);
      const fill = within(p.fill, GRAPH_LIMITS.pointFill);
      const outline = within(p.outline, GRAPH_LIMITS.pointOutline);
      return [key, defined({ ...p, color, size, shape, fill, outline, outlineColor, label, labelOffset })] as const;
    })
    .filter(([, style]) => Object.keys(style).length);
  return out.length ? Object.fromEntries(out) : undefined;
}

const READ_OPTION = {
  number: (v: unknown) => (isFiniteNumber(v) ? v : undefined),
  text: (v: unknown) => (typeof v === "string" ? v : undefined),
  texts: (v: unknown) => (Array.isArray(v) && v.every((s) => typeof s === "string") ? v : undefined),
  palette: readPalette,
  styles: readStyles,
  pointStyles: readPointStyles,
  place: readPlace,
  color: (v: unknown) => (isHex(v) ? v : undefined),
};

/** Colors a table kept for its graphs before Helix 1.0.3: its series' and its cells'. */
type TableColors = { series?: Record<string, PaletteColor>; cells?: Record<string, PaletteColor> };

/** A table's data, and the colors it kept for its graphs. */
/** A table's data, put straight: no value beyond its last column (`beyond` counts those left
 *  out), exclusions and widths only on cells and columns it has, and a grouped table's
 *  groups and sub-columns those of its columns ("A:Y1"…). */
function readData(raw: Obj): { data: TableData; colors: TableColors; beyond: number } | null {
  const { seriesColors, pointColors, ...d } = canonical(raw, [...DATA_KEYS, "seriesColors", "pointColors"]);
  if (!Array.isArray(d.columns) || !Array.isArray(d.rows)) return null;
  const columns = d.columns.map((c) => cellText(c) ?? "");
  if (!columns.length) columns.push("Title");
  let beyond = 0;
  const rows = d.rows.map((row) => {
    const cells = Array.isArray(row) ? row.map((c) => cellText(c) || null) : [];
    beyond += cells.slice(columns.length).filter((c) => c !== null).length;
    return cells.slice(0, columns.length);
  });
  const onCell = (k: unknown): k is string => {
    const [r, c] = typeof k === "string" && /^\d+,\d+$/.test(k) ? k.split(",").map(Number) : [Infinity];
    return r < rows.length && c < columns.length;
  };
  const excluded = Array.isArray(d.excluded) ? d.excluded.filter(onCell) : [];
  const widths = isObj(d.widths)
    ? Object.fromEntries(
        Object.entries(d.widths).filter(([name, w]) => columns.includes(name) && isFiniteNumber(w) && w > 0),
      )
    : {};
  let data = defined({
    ...d,
    columns,
    rows,
    groups: isCount(d.groups) && isCount(d.replicates) ? d.groups : undefined,
    replicates: isCount(d.groups) && isCount(d.replicates) ? d.replicates : undefined,
    excluded: excluded.length ? excluded : undefined,
    widths: Object.keys(widths).length ? (widths as Record<string, number>) : undefined,
    freezeTitle: d.freezeTitle === true || undefined,
  } as TableData);
  if (isGrouped(data) && columns.length > 1) {
    const groups = [...new Set(columns.slice(1).map(seriesKeyOf))];
    const replicates = Math.max(...groups.map((g) => columns.filter((c) => seriesKeyOf(c) === g).length));
    if (groups.length !== data.groups || replicates !== data.replicates)
      data = defined(regroupTable(data, groups.length, replicates));
  }
  return { data, colors: { series: colors(seriesColors), cells: colors(pointColors) }, beyond };
}

/** Every option, of the right type, one of its choices and within its limits: a missing
 *  or wrong one takes its default, a number beyond its limits the nearest it can be. */
function readOptions(raw: unknown): GraphOptions {
  const o = isObj(raw) ? canonical(raw, [...Object.keys(DEFAULT_GRAPH_OPTIONS), ...Object.keys(OPTIONAL_OPTIONS)]) : {};
  const out: Obj = { ...o, ...DEFAULT_GRAPH_OPTIONS };
  for (const [key, fallback] of Object.entries(DEFAULT_GRAPH_OPTIONS)) {
    const v = typeof o[key] === "string" && !FREE_TEXT_OPTIONS.has(key) ? lower(o[key]) : o[key];
    const choices: readonly unknown[] | undefined = isIn(GRAPH_CHOICES, key)
      ? GRAPH_CHOICES[key as ChoiceOption]
      : undefined;
    if (typeof v !== typeof fallback || (typeof v === "number" && !Number.isFinite(v))) continue;
    if (!choices || choices.includes(v)) out[key] = v;
  }
  for (const [key, limits] of Object.entries(GRAPH_LIMITS)) out[key] = within(out[key], limits);
  for (const [key, kind] of Object.entries(OPTIONAL_OPTIONS)) out[key] = READ_OPTION[kind](o[key]);
  return defined(out) as unknown as GraphOptions;
}

function readParam(kind: ParamKind, v: unknown): unknown {
  if (kind === "yes/no") return typeof v === "boolean" ? v : undefined;
  if (kind === "number") return isFiniteNumber(v) ? v : undefined;
  if (kind === "name") return typeof v === "string" ? v : undefined;
  if (kind === "names") return Array.isArray(v) && v.every((s) => typeof s === "string") ? v : undefined;
  return Array.isArray(kind) ? oneOf(kind, v) : within(v, kind as Limits);
}

function readParams(raw: unknown): AnalysisParams | undefined {
  if (!isObj(raw)) return undefined;
  const p = canonical(raw, Object.keys(PARAMS));
  // A param this version doesn't know is kept as a plain word.
  const read = (k: string, v: unknown) =>
    isIn(PARAMS, k) ? readParam(PARAMS[k as ParamKey], v) : isWord(lower(v)) ? lower(v) : undefined;
  return defined(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, read(k, v)]))) as unknown as AnalysisParams;
}

const NODE_TYPES: NodeType[] = ["table", "analysis", "graph"];

/** `tableColors`: where a table leaves the colors it kept for its graphs. */
function readNode(
  id: string,
  raw: unknown,
  issues: ProjectIssue[],
  tableColors: Record<string, TableColors>,
): ProjectNode | null {
  if (!isObj(raw)) return null;
  const n = canonical(raw, NODE_KEYS);
  const type = lower(n.type) as NodeType;
  if (!NODE_TYPES.includes(type)) return null;
  const node = {
    ...n,
    id,
    type,
    name: cellText(n.name) ?? "Untitled",
    parentId: typeof n.parentId === "string" ? n.parentId : null,
  } as ProjectNode;

  if (type === "table") {
    const read = isObj(n.data) ? readData(n.data) : null;
    if (!read) return null;
    node.data = read.data;
    tableColors[id] = read.colors;
    if (read.beyond) {
      const values = read.beyond === 1 ? "1 value" : `${read.beyond} values`;
      issues.push({
        severity: "warning",
        message: `Table “${node.name}” had ${values} beyond its last column; they were left out.`,
      });
    }
    node.parentId = null;
    node.tableType = lower(n.tableType) as ProjectNode["tableType"];
    if (!isIn(TABLES, node.tableType)) {
      issues.push({
        severity: "warning",
        message: `Table “${node.name}” has a type this version doesn't know; it opens as a Column table.`,
      });
      node.tableType = "column";
    }
  } else if (type === "analysis") {
    node.analysisType = lower(n.analysisType) as ProjectNode["analysisType"];
    node.analysisParams = readParams(n.analysisParams);
    if (!isIn(ANALYSES, node.analysisType)) {
      issues.push({ severity: "error", message: `Analysis “${node.name}” uses a test this version doesn't know.` });
    }
  } else {
    node.graphType = lower(n.graphType) as ProjectNode["graphType"];
    node.graphOptions = readOptions(n.graphOptions);
    if (!isIn(GRAPHS, node.graphType)) {
      issues.push({ severity: "error", message: `Graph “${node.name}” uses a chart this version doesn't know.` });
    }
  }
  return node;
}

/** `v` as JSON with its objects' keys in order, to compare contents whatever their order. */
const contents = (v: unknown) =>
  JSON.stringify(v, (_, x: unknown) =>
    isObj(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );

/** Reads a `.hlx` file forgivingly. `{ error }` only when nothing usable remains;
 *  otherwise the project, what the user should know about it, and whether Helix changed
 *  anything as it read it (`updated`: repaired, or brought up to date from an older Helix),
 *  so saving it keeps the project as it is now. */
export function parseProjectFile(
  raw: unknown,
): { project: ProjectFilePayload; issues: ProjectIssue[]; updated: boolean } | { error: string } {
  if (!isObj(raw)) return { error: "Not a valid Helix project file." };
  const file = canonical(raw, FILE_KEYS);
  if (lower(file.app) !== "helix") return { error: "This file was not created by Helix." };
  const project = isObj(file.project) ? canonical(file.project, PROJECT_KEYS) : null;
  if (!project || !isObj(project.nodes)) return { error: "This file's project data is missing or corrupted." };

  const issues: ProjectIssue[] = [];
  const nodes: Record<string, ProjectNode> = {};
  const tableColors: Record<string, TableColors> = {};
  let skipped = 0;
  for (const [id, raw] of Object.entries(project.nodes)) {
    const node = readNode(id, raw, issues, tableColors);
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
    issues.push({
      severity: "warning",
      message: `${skipped} unreadable item${skipped === 1 ? " was" : "s were"} left out.`,
    });
  }

  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
  const tables = Object.values(nodes).filter((n) => n.type === "table");
  if (tables.length === 0) return { error: "This project file has no readable data tables." };
  // Saved order first, then anything the order missed.
  const rootOrder = [
    ...new Set([...ids(project.rootOrder).filter((id) => nodes[id]?.type === "table"), ...tables.map((t) => t.id)]),
  ];
  const savedChildren = isObj(project.childOrder) ? project.childOrder : {};
  const childOrder = Object.fromEntries(
    rootOrder.map((tableId) => {
      const children = Object.values(nodes)
        .filter((n) => n.parentId === tableId)
        .map((n) => n.id);
      const saved = ids(savedChildren[tableId]).filter((id) => children.includes(id));
      return [tableId, [...new Set([...saved, ...children])]];
    }),
  );
  const activeNodeId =
    typeof project.activeNodeId === "string" && nodes[project.activeNodeId] ? project.activeNodeId : rootOrder[0];

  for (const node of Object.values(nodes)) {
    if (node.type === "graph") {
      if (!node.graphOptions!.palette) colorsFromHelix1(node, tableColors[node.parentId!]?.series);
      pointsFromCells(node, tableColors[node.parentId!]?.cells);
    }
    const tableType = node.parentId ? nodes[node.parentId]?.tableType : undefined;
    if (node.type !== "graph" || !node.graphType || !tableType) continue;
    if (isIn(GRAPHS, node.graphType) && !GRAPH_OPTIONS_BY_TABLE[tableType].some((o) => o.value === node.graphType)) {
      issues.push({
        severity: "warning",
        message: `Graph “${node.name}” isn't a chart Helix offers for a ${TABLES[tableType].label} table.`,
      });
    }
    const o = node.graphOptions!;
    if ((o.sigAnalysisId && !nodes[o.sigAnalysisId]) || (o.regAnalysisId && !nodes[o.regAnalysisId])) {
      issues.push({
        severity: "warning",
        message: `Graph “${node.name}” refers to an analysis that no longer exists.`,
      });
    }
  }

  const read = { nodes, rootOrder, childOrder, activeNodeId };
  return { project: read, issues, updated: contents(read) !== contents(file.project) };
}

// ── Files from Helix 1.0 ─────────────────────────────────────────────────
// A graph's colors came from its table (`seriesColors`, named colors), a heatmap
// had one of three color scales, and a volcano two named colors. A graph saved
// without a palette gets them back as its own, so it looks as it did: the Helix
// palette with its table's colors, or its heatmap scale as Plotly drew it.

/** The heatmap scales of Helix 1.0 that the catalog doesn't have, as Plotly defines them. */
const HEATMAP_SCALES: Record<string, { name: string; kind: PaletteKind; stops: [number, string][] }> = {
  "red-blue": {
    name: "Red/Blue (Helix 1.0)",
    kind: "diverging",
    stops: [
      [0, "#050AAC"],
      [0.35, "#6A89F7"],
      [0.5, "#BEBEBE"],
      [0.6, "#DCAA84"],
      [0.7, "#E6915A"],
      [1, "#B20A1C"],
    ],
  },
  "yellow-red": {
    name: "Heat (Helix 1.0)",
    kind: "sequential",
    stops: [
      [0, "#800026"],
      [0.125, "#BD0026"],
      [0.25, "#E31A1C"],
      [0.375, "#FC4E2A"],
      [0.5, "#FD8D3C"],
      [0.625, "#FEB24C"],
      [0.75, "#FED976"],
      [0.875, "#FFEDA0"],
      [1, "#FFFFCC"],
    ],
  },
};

/** A scale's stops as 256 evenly spaced colors, blended as Plotly blends them. */
function resample(stops: [number, string][]): string[] {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Array.from({ length: 256 }, (_, i) => {
    const t = i / 255;
    const j = Math.max(
      1,
      stops.findIndex(([at]) => at >= t),
    );
    const [[a, from], [b, to]] = [stops[j - 1], stops[j]];
    const f = (t - a) / (b - a);
    const [c0, c1] = [channels(from), channels(to)];
    return (
      "#" +
      c0
        .map((c, k) =>
          Math.round(c + (c1[k] - c) * f)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
        .toUpperCase()
    );
  });
}

const LEGACY_OPTIONS = ["heatmapColorScale", "volcanoColorUp", "volcanoColorDown", "volcanoPointSize"];

function colorsFromHelix1(node: ProjectNode, tableColors: Record<string, PaletteColor> | undefined) {
  const all = node.graphOptions as unknown as Obj;
  const old = canonical(all, LEGACY_OPTIONS);
  const named = (v: unknown, fallback: PaletteColor) => (isNamed(lower(v)) ? (lower(v) as PaletteColor) : fallback);
  let palette = savedPalette(paletteNamed("helix")!);
  let colors = tableColors;
  if (node.graphType === "heatmap") {
    const name = lower(old.heatmapColorScale);
    const scale = isIn(HEATMAP_SCALES, name) ? HEATMAP_SCALES[name as string] : undefined;
    palette = scale
      ? { name: scale.name, kind: scale.kind, colors: resample(scale.stops) }
      : savedPalette(paletteNamed("viridis")!);
  } else if (node.graphType === "volcano") {
    colors = { down: named(old.volcanoColorDown, "blue"), up: named(old.volcanoColorUp, "red") };
  }
  const series =
    colors && Object.fromEntries(Object.entries(colors).map(([key, c]) => [key, { color: NAMED_COLORS[c] }]));
  const legacy = (k: string) => LEGACY_OPTIONS.some((o) => o.toLowerCase() === k.toLowerCase());
  const options = Object.fromEntries(Object.entries(all).filter(([k]) => !legacy(k)));
  // Helix 1.0 filled shapes and points half-opaque (a pie's and a volcano's, their type's
  // fill), and set a row's bars side by side; its points had their type's size and
  // outline (a volcano, the size set on it, within what Helix offers).
  const { defaults } = isIn(GRAPHS, node.graphType) ? GRAPHS[node.graphType!] : {};
  const pointSize = within(old.volcanoPointSize, GRAPH_LIMITS.pointSize);
  const fills = { fill: defaults?.fill ?? 0.5, pointFill: defaults?.pointFill ?? 0.5 };
  const helix1 = {
    ...options,
    ...defaults,
    ...(pointSize === undefined ? {} : { pointSize }),
    palette,
    series,
    ...fills,
  };
  node.graphOptions = defined({ ...helix1, barGap: 0 }) as unknown as GraphOptions;
}

/** Points colored in their table's cells (before Helix 1.0.3) keep their color on
 *  each of its graphs, under any style the graph gives them itself. */
function pointsFromCells(node: ProjectNode, cells: Record<string, PaletteColor> | undefined) {
  if (!cells) return;
  const options = node.graphOptions!;
  const colored = Object.fromEntries(Object.entries(cells).map(([key, c]) => [key, { color: NAMED_COLORS[c] }]));
  node.graphOptions = { ...options, points: { ...colored, ...options.points } };
}
