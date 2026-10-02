// The graph types. Adding a chart = a file exporting a `GraphModule`, an entry here,
// and one in GRAPH_OPTIONS_BY_TABLE for the tables that offer it. Each module turns
// the table's columns (lib/dataset.ts) and options into a Plotly figure.

import { DEFAULT_GRAPH_OPTIONS, type GraphType, type GraphOptions, type TableData, type TableType } from "../../store/types";
import type { SelectorOption } from "../../components/common/universal-modal";
import { seriesOf, splitXY, type Column, type Dataset } from "../../lib/dataset";
import { paletteNamed, savedPalette } from "../../lib/palettes";
import type { Paint } from "./plot-helpers";
import { individual } from "./individual";
import { boxViolin } from "./box-violin";
import { meanError } from "./mean-error";
import { xyScatter } from "./xy-scatter";
import { xyBar } from "./xy-bar";
import { xyArea } from "./xy-area";
import { groupedBars } from "./grouped-bars";
import { groupedScatter } from "./grouped-scatter";
import { groupedLines } from "./grouped-lines";
import { groupedStacked } from "./grouped-stacked";
import { groupedHbars } from "./grouped-hbars";
import { pie, donut } from "./pie";
import { doseResponse } from "./dose-response";
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
  pie,
  donut,
  "dose-response": doseResponse,
  heatmap,
  survival,
  volcano,
};

/** The columns a graph plots: every column for the volcano (it maps text labels
 *  too), X then the Y series for the XY family (none while X is empty), else the
 *  columns holding numbers. */
export function plotColumns({ columns, numeric }: Dataset, type: GraphType): Column[] {
  const { family } = GRAPHS[type];
  if (family === "volcano") return columns;
  if (family !== "xy") return numeric;
  const { x, ys } = splitXY(columns);
  return x ? [x, ...ys] : [];
}

/** The series a graph colors, in order: a volcano's "down" and "up", none for a
 *  heatmap (its cells follow the palette), else the table's series. */
export function graphSeries(type: GraphType, data: TableData, tableType: TableType): string[] {
  const { family } = GRAPHS[type];
  return family === "volcano" ? Object.keys(VOLCANO_SERIES) : family === "heatmap" ? [] : seriesOf(data, tableType);
}

/** A new graph's options: the defaults, with its type's palette and own defaults. */
export function newGraphOptions(type: GraphType): GraphOptions {
  const { palette, defaults } = GRAPHS[type];
  return { ...DEFAULT_GRAPH_OPTIONS, palette: savedPalette(paletteNamed(palette ?? "okabe-ito")!), ...defaults };
}

const optionsFor = (types: GraphType[]): SelectorOption<GraphType>[] =>
  types.map((value) => ({ value, label: GRAPHS[value].label }));

/** Graph types scoped per table type — a Column table's columns are independent
 *  groups (bars/box/points), an XY table's are X + Y data series (scatter/line/
 *  bar/area against a shared X) — so the graphs that make sense differ too.
 *  Grouped tables (groups × replicates, rows = X categories) plot one series per
 *  group across the rows: interleaved scatter / bars / stacked / horizontal.
 *  Multiple Variables (rows = subjects, columns = variables) plots as a heatmap.
 *  Mirrors `ANALYSIS_OPTIONS_BY_TABLE`. */
export const GRAPH_OPTIONS_BY_TABLE: Record<TableType, SelectorOption<GraphType>[]> = {
  column: optionsFor(["individual", "box-violin", "mean-error", "pie", "donut"]),
  xy: optionsFor(["xy-scatter", "xy-bar", "xy-area", "dose-response", "survival"]),
  grouped: optionsFor([
    "grouped-scatter",
    "grouped-bars",
    "grouped-lines",
    "grouped-stacked",
    "grouped-hbars",
    "volcano",
  ]),
  multiple: optionsFor(["heatmap", "volcano"]),
  // Outcomes as series across the row categories, as Prism graphs contingency tables.
  contingency: optionsFor(["grouped-bars", "grouped-stacked", "grouped-hbars"]),
};
