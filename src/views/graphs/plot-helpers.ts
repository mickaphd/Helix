// Shared statistics + Plotly layout helpers for the column graph family.
import type { GraphOptions, PaletteColor } from "../../store/types";
import type { Column } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { seriesStyle, pointStyle } from "../../lib/palette";

export const INK = "#111827"; // axes + titles only

/** Every series (a column, or a Grouped-family group) is keyed by name so color
 *  assignments survive column reordering — see `seriesColors` on `TableData`. */
export type SeriesColors = Record<string, PaletteColor> | undefined;
/** Per-point overrides, keyed by `pointKeyOf(column, row)` — see `TableData.pointColors`. */
type PointColors = Record<string, PaletteColor> | undefined;

/** Resolved border color for one series (explicit override, else palette-by-position). */
export const seriesColor = (seriesColors: SeriesColors, key: string, index: number) =>
  seriesStyle(seriesColors, key, index).color;
/** Resolved translucent fill color for one series. */
export const seriesFill = (seriesColors: SeriesColors, key: string, index: number) =>
  seriesStyle(seriesColors, key, index).fill;
/** A point/circle marker: translucent fill with a solid same-color outline. */
export const seriesMarker = (size: number, seriesColors: SeriesColors, key: string, index: number) => {
  const s = seriesStyle(seriesColors, key, index);
  return { color: s.fill, size, line: { color: s.color, width: 1.5 } };
};

/** Per-point marker: like `seriesMarker`, but each point (`pointKeys[i]`) can carry
 *  its own color override, falling back to the series color where unset — Plotly's
 *  `marker.color`/`marker.line.color` accept a same-length array for exactly this. */
export const seriesPointMarker = (
  size: number,
  seriesColors: SeriesColors,
  pointColors: PointColors,
  key: string,
  index: number,
  pointKeys: string[],
) => {
  const styles = pointKeys.map((k) => pointStyle(seriesColors, pointColors, k, key, index));
  return { color: styles.map((s) => s.fill), size, line: { color: styles.map((s) => s.color), width: 1.5 } };
};

/** Smallest and largest value (a loop, safe for any number of points). */
export const extent = (v: number[]): [number, number] => [
  v.reduce((a, b) => Math.min(a, b), Infinity),
  v.reduce((a, b) => Math.max(a, b), -Infinity),
];

/** Adds a text note in the plot's top-left corner (a fit's equation). */
export function addNote(fig: GraphFigure, text: string, fontSize: number) {
  fig.layout.annotations = [
    ...((fig.layout.annotations as unknown[]) ?? []),
    {
      xref: "paper",
      yref: "paper",
      x: 0.02,
      y: 0.98,
      xanchor: "left",
      yanchor: "top",
      align: "left",
      showarrow: false,
      text,
      font: { color: INK, size: Math.max(fontSize - 1, 8) },
    },
  ];
}

export const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
export const sd = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};
export const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Center value per column (mean or median). */
export const centers = (cols: Column[], center: GraphOptions["center"]) =>
  cols.map((c) => (center === "median" ? median(c.values) : mean(c.values)));

/** Error magnitude per column (SD or SEM), or null when error is off. */
export const errors = (cols: Column[], kind: GraphOptions["error"]) =>
  kind === "none" ? null : cols.map((c) => (kind === "sem" ? sd(c.values) / Math.sqrt(c.values.length) : sd(c.values)));

/** Deterministic jitter in [-0.15, 0.15] so points don't jump on option changes. */
export const jitter = (col: number, i: number) => {
  const s = Math.sin(col * 131.7 + i * 977.3) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 0.3;
};

/** The drawing's size limits (px), for dragging an axis or typing a size. */
export const GRAPH_SIZE = { minWidth: 150, maxWidth: 2400, minHeight: 120, maxHeight: 1800 };

/** The least space around the plot area. Every axis has `automargin`, so Plotly widens
 *  it just enough for tick labels, axis titles and legends: the sheet hugs the figure. */
export const marginsFor = (options: GraphOptions) => ({ l: 16, r: 16, t: options.title ? 44 : 16, b: 16 });

/** Page skeleton shared by every graph family (background, static-chart dragmode,
 *  font, margins, title) — only the axis shape differs per family. */
function chromeLayout(options: GraphOptions): Record<string, unknown> {
  const background = options.background === "transparent" ? "rgba(0,0,0,0)" : "#ffffff";
  return {
    paper_bgcolor: background,
    plot_bgcolor: background,
    // Static chart (Prism-style): no box-zoom, no pan. Resizing the graph box
    // rescales the whole plot, so the axes/bars resize instead of adding space.
    dragmode: false,
    font: { color: INK, family: "system-ui, -apple-system, sans-serif", size: options.fontSize },
    margin: marginsFor(options),
    // xref: "paper" centers over the plot area (inside the margins), matching where the
    // X-axis title centers — the default "container" ref centers over the whole figure
    // width instead, which drifts off-center since the Y labels widen the left margin.
    ...(options.title
      ? { title: { text: options.title, font: { size: options.fontSize + 3 }, xref: "paper", x: 0.5, xanchor: "center" } }
      : {}),
  };
}

/** Axis min/max/step config shared by every graph family/axis. Full explicit range when
 *  both bounds are set; otherwise let Plotly keep auto-scaling the unset side while
 *  `autorangeoptions` clamps the set one — so typing just a Max (or just a Min) takes
 *  effect immediately, independently. */
function axisRange(min?: number, max?: number, step?: number, zeroBase?: boolean): Record<string, unknown> {
  const hasMin = min != null;
  const hasMax = max != null;
  const range =
    hasMin && hasMax
      ? { range: [min, max], autorange: false }
      : {
          ...(zeroBase ? { rangemode: "tozero" } : {}),
          ...(hasMin || hasMax
            ? {
                autorangeoptions: {
                  ...(hasMin ? { minallowed: min } : {}),
                  ...(hasMax ? { maxallowed: max } : {}),
                },
              }
            : {}),
        };
  return { ...range, ...(step != null ? { dtick: step, tick0: min ?? 0 } : {}) };
}

/** Shared axis chrome spread into every family's axes: a minimalist spine + outward
 *  ticks (no gridlines), non-interactive, at the user's Appearance thickness — so
 *  changing thickness affects every axis line and every tick uniformly. */
function axisChrome(options: GraphOptions): Record<string, unknown> {
  return {
    showgrid: false,
    zeroline: false,
    linecolor: INK,
    linewidth: options.axisWidth,
    ticks: "outside",
    tickwidth: options.axisWidth,
    fixedrange: true,
    automargin: true,
  };
}

const yAxisRange = (options: GraphOptions, zeroBase?: boolean) =>
  axisRange(options.yMin, options.yMax, options.yStep, zeroBase);
const xAxisRange = (options: GraphOptions, zeroBase?: boolean) =>
  axisRange(options.xMin, options.xMax, options.xStep, zeroBase);

/** Common white publication-style layout; numeric x with column-name ticks (Column family). */
export function baseLayout(
  options: GraphOptions,
  names: string[],
  opts: { zeroBase?: boolean } = {},
): Record<string, unknown> {
  return {
    ...chromeLayout(options),
    showlegend: false,
    xaxis: {
      tickmode: "array",
      tickvals: names.map((_, i) => i),
      ticktext: names,
      // Labels turn straight to vertical as the graph narrows: at Plotly's 30° step the
      // last one would slip off the right edge and be dropped.
      autotickangles: [0, 90],
      // Symmetric half-unit padding so categories never hug the Y axis (uniform across graph types).
      range: [-0.5, names.length - 0.5],
      ...axisChrome(options),
      ...(options.xLabel ? { title: { text: options.xLabel, standoff: 12 } } : {}),
    },
    yaxis: {
      // Minimalist: only the axis spine + ticks — no internal gridlines.
      ...axisChrome(options),
      ...yAxisRange(options, opts.zeroBase),
      ...(options.yLabel ? { title: { text: options.yLabel } } : {}),
    },
  };
}

/** Pie/donut layout: the shared chrome (background, font, title, margins) with no
 *  cartesian axes. Slice labels are drawn on the pie itself, so the legend stays off. */
export function pieLayout(options: GraphOptions): Record<string, unknown> {
  return { ...chromeLayout(options), showlegend: false };
}

/** Heatmap layout: two categorical axes (columns = variables, rows = table row
 *  order), reversed on Y so row 1 sits at the top like the table itself. The colorscale
 *  legend, when shown, widens the right margin on its own. */
export function heatmapLayout(options: GraphOptions, colNames: string[], rowNames: string[]): Record<string, unknown> {
  return {
    ...chromeLayout(options),
    showlegend: false,
    xaxis: {
      type: "category",
      categoryorder: "array",
      categoryarray: colNames,
      autotickangles: [0, 90],
      ...axisChrome(options),
      ...(options.xLabel ? { title: { text: options.xLabel, standoff: 12 } } : {}),
    },
    yaxis: {
      type: "category",
      categoryorder: "array",
      categoryarray: rowNames,
      autorange: "reversed",
      ...axisChrome(options),
      ...(options.yLabel ? { title: { text: options.yLabel } } : {}),
    },
  };
}

/** XY family layout: a genuine numeric X axis (not category ticks), with a legend
 *  once there's more than one Y series. `xName` is the X column's own name, used as
 *  the axis title fallback when the user hasn't set a custom X-axis label. */
export function xyLayout(
  options: GraphOptions,
  xName: string,
  seriesCount: number,
  opts: { zeroBase?: boolean } = {},
): Record<string, unknown> {
  return {
    ...chromeLayout(options),
    showlegend: seriesCount > 1,
    legend: { x: 1.02, y: 1, xanchor: "left" },
    xaxis: {
      type: "linear",
      ...axisChrome(options),
      ...xAxisRange(options),
      title: { text: options.xLabel || xName, standoff: 12 },
    },
    yaxis: {
      ...axisChrome(options),
      ...yAxisRange(options, opts.zeroBase),
      ...(options.yLabel ? { title: { text: options.yLabel } } : {}),
    },
  };
}

// ── Grouped family ────────────────────────────────────────────────────────
// A grouped table stores `groups × replicates` sub-columns ("A:Y1", "A:Y2",
// "B:Y1", …); rows are the X categories and each group is a legend series
// (see `groupsOf`). These helpers summarise each group's replicates per row.

/** Number of data rows (X categories) — the last row (1-based) holding a number
 *  in any column, so the axis stops at the real data. */
export const rowCountOf = (columns: Column[]) => Math.max(0, ...columns.map((c) => (c.rows.at(-1) ?? -1) + 1));

/** The rows' labels on the category axis: each row's title, as in Prism, or its
 *  number when it has none. A repeated title stays a separate category. */
export function rowLabels(rows: number, titles: (string | null)[] = []): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: rows }, (_, i) => {
    const label = titles[i]?.trim() || String(i + 1);
    const repeat = seen.get(label) ?? 0;
    seen.set(label, repeat + 1);
    return label + "​".repeat(repeat); // an invisible mark keeps repeats apart
  });
}

/** Group `g`'s replicate values at row `r` (numeric cells only). */
function groupRow(cols: Column[], r: number): number[] {
  return cols.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
}

/** Per-row center (mean/median) and optional error (SD/SEM) for one group.
 *  `center[r]` is null where the group has no data in that row (leaves a gap);
 *  `error[r]` where it has a single value (no error bar, as in Prism). */
export function perRowStats(
  cols: Column[],
  rows: number,
  center: GraphOptions["center"],
  error: GraphOptions["error"],
): { center: (number | null)[]; error: (number | null)[] | null } {
  const c: (number | null)[] = [];
  const e: (number | null)[] | null = error === "none" ? null : [];
  for (let r = 0; r < rows; r++) {
    const v = groupRow(cols, r);
    if (v.length === 0) {
      c.push(null);
      if (e) e.push(null);
      continue;
    }
    c.push(center === "median" ? median(v) : mean(v));
    if (e) e.push(v.length < 2 ? null : error === "sem" ? sd(v) / Math.sqrt(v.length) : sd(v));
  }
  return { center: c, error: e };
}

/** Horizontal offset of group `g` within a row's slot, so interleaved scatter
 *  points fan out per group across [-0.28, 0.28] (bars use Plotly's own barmode). */
export const groupOffset = (g: number, total: number) => (total <= 1 ? 0 : -0.28 + (0.56 * g) / (total - 1));

interface SeparatedAxis {
  posOf: (group: number, row: number) => number;
  tickvals: number[];
  ticktext: string[];
  range: [number, number];
}

/** Category positions for the "Separated" arrangement: each group gets its own
 *  block of `rows` slots (with a 1-slot gap between blocks) instead of sharing
 *  a slot per row, so groups sit side by side rather than interleaved. Ticks
 *  repeat the row labels once per block. */
export function separatedPositions(groups: number, labels: string[]): SeparatedAxis {
  const gap = 1;
  const rows = labels.length;
  const blockWidth = rows + gap;
  const tickvals: number[] = [];
  const ticktext: string[] = [];
  for (let g = 0; g < groups; g++) {
    for (let r = 0; r < rows; r++) {
      tickvals.push(g * blockWidth + r);
      ticktext.push(labels[r]);
    }
  }
  return {
    posOf: (g, r) => g * blockWidth + r,
    tickvals,
    ticktext,
    range: [-0.5, groups * blockWidth - gap - 0.5],
  };
}

/** Bar layout for the grouped family: a category axis for the rows and a numeric
 *  value axis, swapped when `horizontal`. The value axis reuses the Y-scale
 *  options; the category axis reuses the X-axis label. */
export function groupedBarLayout(
  options: GraphOptions,
  seriesCount: number,
  opts: { horizontal?: boolean; separated?: SeparatedAxis } = {},
): Record<string, unknown> {
  const value = {
    ...axisChrome(options),
    ...yAxisRange(options, true),
    ...(options.yLabel ? { title: { text: options.yLabel } } : {}),
  };
  // Separated blocks need numeric positions with gaps between them, so they use
  // explicit tick placement instead of Plotly's evenly-spaced "category" axis.
  const category = {
    ...(opts.separated
      ? { tickmode: "array", tickvals: opts.separated.tickvals, ticktext: opts.separated.ticktext, range: opts.separated.range }
      : { type: "category" }),
    ...axisChrome(options),
    ...(options.xLabel ? { title: { text: options.xLabel, standoff: 12 } } : {}),
  };
  return {
    ...chromeLayout(options),
    showlegend: seriesCount > 1,
    legend: { x: 1.02, y: 1, xanchor: "left" },
    xaxis: opts.horizontal ? value : category,
    yaxis: opts.horizontal ? category : value,
  };
}

/** Scatter layout for the grouped family: a numeric X axis with row-number ticks
 *  (so groups can be offset within each row) and a legend once there's >1 group. */
export function groupedScatterLayout(
  options: GraphOptions,
  labels: string[],
  seriesCount: number,
  separated?: SeparatedAxis,
): Record<string, unknown> {
  return {
    ...chromeLayout(options),
    showlegend: seriesCount > 1,
    legend: { x: 1.02, y: 1, xanchor: "left" },
    xaxis: {
      tickmode: "array",
      tickvals: separated ? separated.tickvals : labels.map((_, i) => i),
      ticktext: separated ? separated.ticktext : labels,
      range: separated ? separated.range : [-0.5, labels.length - 0.5],
      ...axisChrome(options),
      ...(options.xLabel ? { title: { text: options.xLabel, standoff: 12 } } : {}),
    },
    yaxis: {
      ...axisChrome(options),
      ...yAxisRange(options),
      ...(options.yLabel ? { title: { text: options.yLabel } } : {}),
    },
  };
}
