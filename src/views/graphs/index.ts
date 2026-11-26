// The graph types. Adding a chart = a file exporting a `GraphModule`, an entry here,
// and one in GRAPH_OPTIONS_BY_TABLE for the tables that offer it. Each module turns
// the table's columns (lib/dataset.ts) and options into a Plotly figure.

import {
  DEFAULT_GRAPH_OPTIONS,
  hasXColumn,
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
import { histogram } from "./histogram";
import { qqPlot } from "./qq-plot";
import { residuals } from "./residuals";

/** A Plotly figure (untyped traces/layout — built as plain objects per module). */
export interface GraphFigure {
  data: unknown[];
  layout: Record<string, unknown>;
}

/** What a graph's columns and axes mean — decides its data and its Format sections. */
type GraphFamily = "column" | "xy" | "grouped" | "pie" | "heatmap" | "volcano" | "histogram";

/** Whether a graph has a value axis to draw reference lines across (a volcano has its own
 *  cutoffs; a pie and a heatmap have none). */
export const hasValueAxis = (family: GraphFamily) => family !== "pie" && family !== "heatmap" && family !== "volcano";

/** What an axis is, and so what the Format panel's Axes section offers for it: values with
 *  a scale (linear, Log10, Log2), range and step; values with a range and step alone
 *  (linear); or categories (columns' or rows' names), which offer nothing. */
export type AxisKind = "scale" | "range" | "labels";
/** A graph's X and Y axes as drawn (none: no such axis to set). */
export interface Axes {
  x?: AxisKind;
  y?: AxisKind;
}

export interface GraphModule {
  label: string;
  family: GraphFamily;
  /** Its axes with these options (`rowValues`: whether every row holding data is
   *  titled by a number, for a graph that can place its rows at them). */
  axes: (options: GraphOptions, rowValues: boolean) => Axes;
  /** Its value axis lies across: the settings kept in the y keys are shown as X's, and
   *  the x keys' as Y's (horizontal bars). */
  horizontal?: true;
  /** Its rows can stand at their titles' values, on a numeric X axis (`rowsAt`). */
  placesRows?: true;
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

/** What the axis of a graph's `key` settings (xMin… or yMin…) is: horizontal bars keep
 *  their value axis's in y, though it lies across. */
export function axisKind(type: GraphType, options: GraphOptions, key: "x" | "y", rowValues = true) {
  const { axes, horizontal } = GRAPHS[type];
  const { x, y } = axes(options, rowValues);
  return (key === "x") !== !!horizontal ? x : y;
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
  histogram,
  "qq-plot": qqPlot,
  residuals,
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
export function plotColumns(table: Dataset, type: GraphType, options: GraphOptions, tableType: TableType): Column[] {
  const { family } = GRAPHS[type];
  if (family === "volcano") return table.columns;
  // The data sets it shows, when it chose some: their columns alone (an XY table's X too).
  const shown = choosableSets(type, table, tableType).length ? options.sets : undefined;
  const keep = (c: Column) => !shown || shown.includes(c.set ?? c.name);
  const { numeric } = table;
  const columns = table.columns.filter((c, i) => keep(c) || (hasXColumn(tableType) && i === 0));
  const sets = table.sets.filter((s) => !shown || shown.includes(s.name));
  if (family === "heatmap")
    return sets.filter((s) => s.columns.some((c) => c.values.length)).map((s) => centerColumn(s, options.center));
  // A Multiple Variables table's histogram: its one variable, as a scatter's X.
  if (family === "histogram" && tableType === "multiple") {
    const x = variablePair(numeric, options)[0];
    return x ? [x] : [];
  }
  if (family !== "xy") return numeric.filter(keep);
  if (tableType === "multiple") {
    const [x, y] = variablePair(numeric, options);
    return x && y ? [x, y] : [];
  }
  const { x, ys } = splitXY(columns);
  return x ? [x, ...ys.flatMap((s) => s.columns)] : [];
}

/** The data sets a graph can show or leave out, in table order: those holding numbers, an
 *  XY or Survival table's X aside; none where the graph picks its own columns (a volcano,
 *  a Multiple Variables table's scatter or histogram). */
export function choosableSets(type: GraphType, table: Dataset, tableType: TableType): string[] {
  const { family } = GRAPHS[type];
  if (family === "volcano" || (tableType === "multiple" && (family === "xy" || family === "histogram"))) return [];
  return table.sets
    .filter((s, i) => !(hasXColumn(tableType) && i === 0) && s.columns.some((c) => c.values.length > 0))
    .map((s) => s.name);
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
  if (family === "histogram" && tableType === "multiple") {
    const x = variablePair(readTable(data).numeric, options)[0];
    return x ? [x.name] : [];
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
  column: optionsFor(["individual", "box-violin", "mean-error", "histogram", "qq-plot", "pie", "donut"]),
  xy: optionsFor(["xy-scatter", "xy-bar", "xy-area", "residuals", "survival", "volcano"]),
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
  multiple: optionsFor(["xy-scatter", "histogram", "qq-plot", "heatmap", "volcano"]),
  // Outcomes as series across the row categories, as Prism graphs contingency tables.
  contingency: optionsFor(["grouped-bars", "grouped-stacked", "grouped-hbars", "heatmap"]),
  survival: optionsFor(["survival"]),
};
