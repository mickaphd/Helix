// Shared project-tree types — kept light so both the store and the table-type
// modules can depend on it without creating a cycle.

import type { AnalysisParams, AnalysisType } from "../stats/types";

export type NodeType = "table" | "analysis" | "graph";
export type TableType = "column" | "xy" | "grouped" | "multiple" | "contingency";
// Every graph type; views/graphs/index.ts says what each draws and for which tables.
export type GraphType =
  | "individual"
  | "box-violin"
  | "mean-error"
  | "xy-scatter"
  | "xy-bar"
  | "xy-area"
  | "grouped-bars"
  | "grouped-scatter"
  | "grouped-lines"
  | "grouped-stacked"
  | "grouped-hbars"
  | "pie"
  | "donut"
  | "dose-response"
  | "heatmap"
  | "survival"
  | "volcano";

/**
 * Display options for a graph node. A superset across the families — each graph
 * module reads only the fields it needs (keeps the store flat + easy to extend).
 */
export interface GraphOptions {
  // Individual values
  bars: boolean; // draw a faint bar at the mean behind the points
  // Shared (individual + mean-error)
  center: "mean" | "median";
  error: "none" | "sd" | "sem";
  // Mean/median & error
  shape: "bar" | "point" | "line";
  // Box & violin
  kind: "box" | "violin";
  showPoints: boolean; // overlay individual points on box/violin
  // XY scatter: markers only, connecting line only, or both
  xyStyle: "points" | "line" | "points+line";
  // Pie/donut (axis-less proportion charts): each column is one slice, sized by the
  // column's total (sum) or mean; percentages vs. raw values on the slice labels.
  pieValue: "sum" | "mean";
  pieShowPercent: boolean;
  // Grouped bars/scatter (interleaved bars, horizontal bars, interleaved scatter):
  // interleave groups within each row, or give each group its own block of
  // categories (Prism's "Separated" arrangement). Not offered for connected
  // lines (groups must share the same X axis to show interaction) or stacked
  // bars (stacking already combines groups per category).
  groupLayout: "interleaved" | "separated";
  // Titles
  title: string;
  xLabel: string;
  yLabel: string;
  // Y-axis scale (Prism-style). All optional — blank = auto. Manual min+max set
  // the range; yStep sets the tick interval (every 1, 10, …).
  yMin?: number;
  yMax?: number;
  yStep?: number;
  // X-axis scale (XY family only — Column family's X is categorical). Same semantics as Y.
  xMin?: number;
  xMax?: number;
  xStep?: number;
  // Significance annotations (Column family only): read a sibling analysis's
  // pairwise comparisons and draw brackets. `sigAnalysisId` is the source analysis
  // node; `sigPairs` are the comparison keys (see significance-overlay) to draw;
  // `sigDisplay` toggles star marks vs. raw P values.
  sigAnalysisId?: string;
  sigPairs?: string[];
  sigDisplay: "stars" | "pvalue";
  // Linear-regression overlay (XY scatter only): draw a sibling "Linear regression"
  // analysis's OLS fit line + 95% confidence band, computed directly from the plotted
  // x/y pairs (see regression-overlay.ts) — no WebR round-trip, since OLS has one
  // unique solution and always matches the sibling analysis's R-computed fit exactly.
  regAnalysisId?: string;
  regShowLine: boolean;
  regShowBand: boolean;
  regShowEquation: boolean;
  // Dose-response curve (XY family only): a one-click sigmoidal 4PL fit of the
  // chosen Y series against X, run via WebR (see dose-response-curve.ts) — no
  // sibling analysis node needed, unlike the Linear-regression overlay above.
  // `doseY` omitted defaults to the first Y data column.
  doseY?: string;
  doseModel: "sigmoidal-4pl-logx" | "sigmoidal-4pl-x";
  doseShowCurve: boolean;
  doseShowEquation: boolean;
  // Heatmap (Multiple Variables only): each column is a variable, each row a
  // subject; cell color encodes magnitude via a Plotly colorscale.
  heatmapColorScale: "viridis" | "red-blue" | "yellow-red";
  heatmapShowValues: boolean;
  heatmapShowScale: boolean;
  // Survival curve (XY family only) — see survival.ts. Two data entry modes:
  // "codes" = one row per subject, cell is an event code (1 = event, 0 = censored)
  // at the paired X (time); computed via Kaplan-Meier. "counts" = cell is the
  // number of survivors remaining in that group at the paired X; plotted directly
  // as percent-of-initial, no censoring concept. Censoring ticks (codes mode only)
  // mark subjects removed from a group without an event.
  survivalMode: "codes" | "counts";
  survivalShowCensors: boolean;
  // Volcano plot of a Multiple Variables table: it plots columns the user already
  // has. `volcanoX`/`volcanoY`/`volcanoLabel` are column names:
  // X = effect size (e.g. log2 fold change), Y = a significance value (raw p,
  // adjusted p, FDR, …), label = optional gene-name column. `volcanoYIsPValue`
  // applies a -log10 transform to Y (default on, so a p/FDR column becomes the
  // usual vertical axis). Thresholds color points up/down/NS + draw dashed guides;
  // `volcanoLabelCount` annotates that many of the most significant genes.
  volcanoX?: string;
  volcanoY?: string;
  volcanoLabel?: string;
  volcanoYIsPValue: boolean;
  volcanoFcThreshold: number; // |X| cutoff (log2FC scale)
  volcanoPThreshold: number; // cutoff on the PLOTTED Y scale (e.g. 1.3 when Y is −log10)
  volcanoShowThresholds: boolean;
  volcanoLabelCount: number;
  // Grouped-table volcano (Helix computes the DEGs): compare two groups (by column
  // prefix, e.g. "A"/"B") row by row. `volcanoEffect` picks the X value — log2 of the
  // ratio of group means (raw data) or the plain difference of means (data already
  // on a log scale). `volcanoSignificance` picks the Y source — the per-row Welch
  // t-test p value or its Benjamini-Hochberg FDR adjustment (−log10 via volcanoYIsPValue).
  volcanoGroupA?: string;
  volcanoGroupB?: string;
  volcanoEffect: "log2ratio" | "difference";
  volcanoSignificance: "pvalue" | "fdr";
  // Volcano appearance: up/down point colors (NS points stay a fixed muted grey)
  // and marker size.
  volcanoColorUp: PaletteColor;
  volcanoColorDown: PaletteColor;
  volcanoPointSize: number;
  // Appearance: thickness of every axis spine + its tick marks (px), and the base
  // font size (px) for tick labels, axis titles, and the chart title.
  axisWidth: number;
  fontSize: number;
  // The sheet behind the graph: white, or none (a PNG or SVG with a transparent background;
  // JPEG has no transparency and stays on white).
  background: "white" | "transparent";
  // Prism-style resizable drawing area (px).
  width: number;
  height: number;
}

export const DEFAULT_GRAPH_OPTIONS: GraphOptions = {
  bars: false,
  center: "mean",
  error: "sem",
  shape: "bar",
  kind: "box",
  showPoints: false,
  xyStyle: "points",
  pieValue: "sum",
  pieShowPercent: true,
  groupLayout: "interleaved",
  sigDisplay: "stars",
  regShowLine: true,
  regShowBand: true,
  regShowEquation: true,
  doseModel: "sigmoidal-4pl-x",
  doseShowCurve: true,
  doseShowEquation: true,
  heatmapColorScale: "viridis",
  heatmapShowValues: false,
  heatmapShowScale: true,
  survivalMode: "codes",
  survivalShowCensors: true,
  volcanoYIsPValue: true,
  volcanoFcThreshold: 1,
  volcanoPThreshold: 1.3,
  volcanoShowThresholds: true,
  volcanoLabelCount: 10,
  volcanoEffect: "log2ratio",
  volcanoSignificance: "pvalue",
  volcanoColorUp: "red",
  volcanoColorDown: "blue",
  volcanoPointSize: 5,
  title: "",
  xLabel: "",
  yLabel: "",
  axisWidth: 1,
  fontSize: 13,
  background: "white",
  width: 640,
  height: 460,
};

/** The fixed 6-swatch series palette (graphs + table column/group styling). */
export type PaletteColor = "blue" | "red" | "green" | "purple" | "orange" | "black";

export interface TableData {
  columns: string[];
  rows: (string | null)[][];
  /** Grouped tables only: number of top-level group headers (Group A, B, …). */
  groups?: number;
  /** Grouped tables only: replicate sub-columns per group. */
  replicates?: number;
  /**
   * Prism-style excluded cells: `"row,col"` keys in full-grid coords (col 0 holds
   * the row titles and is never excluded). Excluded values stay in the table + the
   * `.hlx` file and are shown blue-italic with a trailing `*`, but are dropped from
   * every analysis and graph via `readTable()`. Omitted when nothing is excluded.
   */
  excluded?: string[];
  /**
   * User-chosen series colors, keyed by column name (Column/XY family) or group
   * prefix (Grouped family, e.g. "A"). Unset keys fall back to palette-by-position
   * (see `resolveColor` in `lib/palette.ts`). Shared by every graph drawn from
   * this table and by the table's own column/group right-click menu.
   */
  seriesColors?: Record<string, PaletteColor>;
  /**
   * User-chosen colors for individual data points (one specific cell), keyed by
   * `"<column>#<row>"` (see `pointKeyOf` in `lib/columns.ts`) — set from the table's
   * right-click menu on a cell/selection, distinct from `seriesColors` which colors
   * a whole column/group. Overrides the series color for that one point on every
   * graph that plots individual points (Individual values, Box & violin points,
   * XY scatter markers, Grouped scatter). Setting a series color clears any point
   * overrides within it, so a whole-series recolor always wins.
   */
  pointColors?: Record<string, PaletteColor>;
  /** Column widths (px) the user set, keyed by column name; others fit their content. */
  widths?: Record<string, number>;
  /** Keep column 0 (the row titles) visible while scrolling right. */
  freezeTitle?: boolean;
}

export interface ProjectNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  tableType?: TableType;
  data?: TableData;
  /** Analysis nodes only: which statistical test this node runs. */
  analysisType?: AnalysisType;
  /** Analysis nodes only: wizard-chosen params for the test, when it has any. */
  analysisParams?: AnalysisParams;
  /** Graph nodes only: which chart this node draws + its display options. */
  graphType?: GraphType;
  graphOptions?: GraphOptions;
}
