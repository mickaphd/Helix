// The graph types. Adding a chart = a file exporting a `GraphModule`, an entry here,
// and one in GRAPH_OPTIONS_BY_TABLE for the tables that offer it. Each module turns
// the table's columns (lib/dataset.ts) and options into a Plotly figure.

import {
  DEFAULT_GRAPH_OPTIONS,
  type GraphType,
  type GraphOptions,
  type TableData,
  type TableType,
} from "../../store/types";
import type { SelectorOption } from "../../components/universal-modal";
import { readTable, seriesOf, splitXY, type Column, type Dataset } from "../../lib/dataset";
import { paletteNamed, savedPalette } from "../../lib/palettes";
import { titleCase } from "../../lib/format";
import { centerColumn, type Paint } from "./plot-helpers";
import { individual } from "./individual";
import { boxViolin } from "./box-violin";
import { meanError } from "./mean-error";
import { xyScatter } from "./xy-scatter";
import { xyBar } from "./xy-bar";
import { xyArea } from "./xy-area";
import { groupedBars } from "./grouped-bars";
import { groupedScatter } from "./grouped-scatter";
import { groupedBox } from "./grouped-box";
import { groupedLines } from "./grouped-lines";
import { groupedStacked } from "./grouped-stacked";
import { groupedHbars } from "./grouped-hbars";
import { pie, donut } from "./pie";
import { heatmap } from "./heatmap";
import { survival } from "./survival";
import { volcano, VOLCANO_SERIES } from "./volcano";

/** A Plotly figure (untyped traces/layout — built as plain objects per module). */
export interface GraphFigure {
  data: unknown[];
  layout: Record<string, unknown>;
}

/** What a graph's columns and axes mean — decides its data and its Format sections. */
type GraphFamily = "column" | "xy" | "grouped" | "pie" | "heatmap" | "volcano";

export interface GraphModule {
  label: string;
  family: GraphFamily;
  /** The palette a new graph of this type takes (Okabe-Ito when unset). */
  palette?: string;
  /** What a new graph of this type starts with, over the defaults: a half-opaque
   *  `fill` where points usually sit on its shapes or they overlap, its points' size… */
  defaults?: Partial<GraphOptions>;
  /** Whether it draws points with these options (their style is then offered). */
  points?: (options: GraphOptions) => boolean;
  /** Whether it draws series lines with these options (their thickness is then offered). */
  lines?: (options: GraphOptions) => boolean;
  /** Whether it fills bars, areas or slices a series' pattern can cover. */
  patterns?: (options: GraphOptions) => boolean;
  build: (
    columns: Column[],
    options: GraphOptions,
    paint: Paint,
    /** Row titles, which label the rows on a grouped graph or a heatmap. */
    titles?: (string | null)[],
  ) => GraphFigure;
}

export const GRAPHS: Record<GraphType, GraphModule> = {
  individual,
  "box-violin": boxViolin,
  "mean-error": meanError,
  "xy-scatter": xyScatter,
  "xy-bar": xyBar,
  "xy-area": xyArea,
  "grouped-bars": groupedBars,
  "grouped-scatter": groupedScatter,
  "grouped-lines": groupedLines,
  "grouped-stacked": groupedStacked,
  "grouped-hbars": groupedHbars,
  "grouped-box": groupedBox,
  pie,
  donut,
  heatmap,
  survival,
  volcano,
};

/** The two variables a scatter of a Multiple Variables table plots, X then Y: the ones
 *  chosen, else (none, or gone) the first two holding numbers. */
export function variablePair<T extends { name: string }>(numeric: T[], options: GraphOptions): [T?, T?] {
  const byName = (name?: string) => numeric.find((c) => c.name === name);
  const x = byName(options.xVariable) ?? numeric[0];
  return [x, byName(options.yVariable) ?? numeric.find((c) => c !== x)];
}

/** The columns a graph plots: every column for the volcano (it maps text labels
 *  too), one per data set holding numbers for the heatmap (a grouped table's
 *  replicates as their `center` on each row), X then the Y series for the XY family
 *  (none while X is empty; a Multiple Variables table's two variables), else the
 *  columns holding numbers. */
export function plotColumns(
  { columns, numeric, sets }: Dataset,
  type: GraphType,
  options: GraphOptions,
  tableType: TableType,
): Column[] {
  const { family } = GRAPHS[type];
  if (family === "volcano") return columns;
  if (family === "heatmap")
    return sets.filter((s) => s.columns.some((c) => c.values.length)).map((s) => centerColumn(s, options.center));
  if (family !== "xy") return numeric;
  if (tableType === "multiple") {
    const [x, y] = variablePair(numeric, options);
    return x && y ? [x, y] : [];
  }
  const { x, ys } = splitXY(columns);
  return x ? [x, ...ys] : [];
}

/** The series a graph colors, in order: a volcano's "down" and "up", none for a
 *  heatmap (its cells follow the palette), a Multiple Variables scatter's Y variable,
 *  else the table's series. */
export function graphSeries(type: GraphType, data: TableData, tableType: TableType, options: GraphOptions): string[] {
  const { family } = GRAPHS[type];
  if (family === "volcano") return Object.keys(VOLCANO_SERIES);
  if (family === "heatmap") return [];
  if (family === "xy" && tableType === "multiple") {
    const y = variablePair(readTable(data).numeric, options)[1];
    return y ? [y.name] : [];
  }
  return seriesOf(data, tableType);
}

/** A new graph's options: the defaults, with its type's palette and own defaults. */
export function newGraphOptions(type: GraphType): GraphOptions {
  const { palette, defaults } = GRAPHS[type];
  return { ...DEFAULT_GRAPH_OPTIONS, palette: savedPalette(paletteNamed(palette ?? "okabe-ito")!), ...defaults };
}

const optionsFor = (types: GraphType[]): SelectorOption<GraphType>[] =>
  types.map((value) => ({ value, label: titleCase(GRAPHS[value].label) }));

/** Graph types scoped per table type — a Column table's columns are independent
 *  groups (bars/box/points), an XY table's are X + Y data series (scatter/line/
 *  bar/area against a shared X) — so the graphs that make sense differ too.
 *  Grouped tables (groups × replicates, rows = X categories) plot one series per
 *  group across the rows: interleaved scatter / box and violin / bars / stacked /
 *  horizontal.
 *  Grouped (one cell per group and row), Multiple Variables (rows = subjects, columns =
 *  variables) and Contingency (counts) plot as a heatmap too.
 *  Mirrors `ANALYSIS_OPTIONS_BY_TABLE`. */
export const GRAPH_OPTIONS_BY_TABLE: Record<TableType, SelectorOption<GraphType>[]> = {
  column: optionsFor(["individual", "box-violin", "mean-error", "pie", "donut"]),
  xy: optionsFor(["xy-scatter", "xy-bar", "xy-area", "survival", "volcano"]),
  grouped: optionsFor([
    "grouped-scatter",
    "grouped-box",
    "grouped-bars",
    "grouped-lines",
    "grouped-stacked",
    "grouped-hbars",
    "heatmap",
    "volcano",
  ]),
  multiple: optionsFor(["xy-scatter", "heatmap", "volcano"]),
  // Outcomes as series across the row categories, as Prism graphs contingency tables.
  contingency: optionsFor(["grouped-bars", "grouped-stacked", "grouped-hbars", "heatmap"]),
  survival: optionsFor(["survival"]),
};
