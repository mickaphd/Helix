// What every graph shares: how its series are painted (`Paint`), the statistics it
// draws (centers, errors), and the Plotly layout of each family.
import {
  SAME_AS_FILL,
  type FillPattern,
  type GraphOptions,
  type LineDash,
  type Place,
  type PointShape,
  type PointStyle,
} from "../../store/types";
import type { Column } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { paletteColor, paletteOf, withOpacity } from "../../lib/palettes";

export const INK = "#111827"; // axes + titles only
export const GUIDE = "#9CA3AF"; // what guides the eye: threshold lines, a name's leader line

/** How a graph paints its series (a column, or a Grouped-family group, by name). */
export interface Paint {
  /** The series' color: its lines, and what its fills and outlines start from. */
  color: (key: string, index: number) => string;
  /** The outline of its bars, boxes, violins, areas and slices (Plotly's `line`). */
  edge: (key: string, index: number) => { color: string; width: number };
  /** Its line (Plotly's `line`): its dashes, else the graph's. */
  line: (key: string, index: number) => { color: string; width: number; dash: LineDash };
  /** The bars of a series: their fill, outline and pattern (Plotly's bar `marker`). */
  bars: (key: string, index: number) => Record<string, unknown>;
  /** The pattern over its fill, if it has one (Plotly's `pattern` / `fillpattern`). */
  pattern: (key: string, index: number) => { shape: string; fgcolor: string; bgcolor: string } | undefined;
  /** Its error bars of `array` (Plotly's `error_y` or `error_x`). */
  errorBars: (key: string, index: number, array: number[]) => Record<string, unknown>;
  /** Its mean or median line, drawn like its error bars (Plotly's `line`). */
  centerLine: (key: string, index: number) => { color: string; width: number };
  /** The fill of its bars, boxes, violins and areas. */
  fill: (key: string, index: number) => string;
  /** The fill of its points. */
  dot: (key: string, index: number) => string;
  /** Its points' shape: the series' own, else the graph's. */
  shape: (key: string) => PointShape;
  /** One point's style (`pointKey`, see `pointKeyOf`): its own, else its series'. */
  point: (pointKey: string, key: string, index: number) => Required<Omit<PointStyle, "label" | "labelOffset">>;
  /** Every point's size and outline thickness (px). */
  size: number;
  outline: number;
  /** The outline color of a point colored `color`: `own` (its own choice), else the graph's. */
  outlineColor: (color: string, own?: string) => string;
}

/** How fine a pattern is drawn (`replace`: its own background shows between its lines). */
export const PATTERN_LOOK = { fillmode: "replace", size: 8, solidity: 0.3 };
/** How strong a patterned fill's tint is, of the fill's opacity. */
export const TINT = 0.4;

/** Each fill pattern as Plotly draws it. */
const PATTERN_SHAPES: Record<FillPattern, string> = {
  diagonal: "/",
  "back-diagonal": "\\",
  crosshatch: "x",
  horizontal: "-",
  vertical: "|",
  grid: "+",
  dots: ".",
};

/** The thickness an outline of none (0) takes when given a color, so the color shows. */
export const visibleOutline = (width: number, color: string) => (width === 0 && color !== SAME_AS_FILL ? 1.5 : undefined);

/** An outline's color: `chosen`, or with none (or `SAME_AS_FILL`) that of what it outlines. */
const outlineOf = (chosen: string | undefined, color: string) => (!chosen || chosen === SAME_AS_FILL ? color : chosen);

/** A series takes its color picked by hand, else the palette's for its place
 *  (`index` among `count`). */
export function paintOf(options: GraphOptions, count: number): Paint {
  const palette = paletteOf(options);
  const color = (key: string, index: number) => options.series?.[key]?.color ?? paletteColor(palette, index, count);
  const shape = (key: string) => options.series?.[key]?.shape ?? options.pointShape;
  const outlineColor = (c: string, own?: string) => outlineOf(own ?? options.pointOutlineColor, c);
  const errorColor = (key: string, index: number) => options.errorColor ?? color(key, index);
  const fill = (key: string, index: number) => withOpacity(color(key, index), options.fill);
  const edge = (key: string, index: number) => ({ color: outlineOf(options.outlineColor, color(key, index)), width: options.outline });
  // Lines in the series' color over a light tint of it (its fill's strength), so they show.
  const pattern = (key: string, index: number) => {
    const name = options.series?.[key]?.pattern;
    const c = color(key, index);
    return name && { shape: PATTERN_SHAPES[name], fgcolor: c, bgcolor: withOpacity(c, options.fill * TINT), ...PATTERN_LOOK };
  };
  return {
    color,
    edge,
    line: (key, index) => ({ color: color(key, index), width: options.lineWidth, dash: options.series?.[key]?.dash ?? options.lineDash }),
    bars: (key, index) => {
      const over = pattern(key, index);
      return { color: fill(key, index), line: edge(key, index), ...(over && { pattern: over }) };
    },
    pattern,
    errorBars: (key, index, array) => {
      // Only above (or right of) the value: none below, and no cap at its foot (`withCaps`).
      const above = options.errorDirection === "above";
      return {
        type: "data",
        array,
        ...(above ? { symmetric: false, arrayminus: array.map(() => 0) } : {}),
        color: errorColor(key, index),
        thickness: options.errorWidth,
        width: above ? 0 : options.errorCaps,
      };
    },
    centerLine: (key, index) => ({ color: errorColor(key, index), width: options.errorWidth }),
    fill,
    dot: (key, index) => withOpacity(color(key, index), options.pointFill),
    shape,
    point: (pointKey, key, index) => {
      const own = options.points?.[pointKey];
      const c = own?.color ?? color(key, index);
      return {
        color: c,
        size: own?.size ?? options.pointSize,
        shape: own?.shape ?? shape(key),
        fill: own?.fill ?? options.pointFill,
        outline: own?.outline ?? options.pointOutline,
        outlineColor: outlineColor(c, own?.outlineColor),
      };
    },
    size: options.pointSize,
    outline: options.pointOutline,
    outlineColor,
  };
}

/** A series' point marker: its fill, shape, size and outline. */
export const seriesMarker = (paint: Paint, key: string, index: number) => ({
  color: paint.dot(key, index),
  size: paint.size,
  symbol: paint.shape(key),
  line: { color: paint.outlineColor(paint.color(key, index)), width: paint.outline },
});

/** A series' individual points, each (`pointKeys[i]`) with its own style — Plotly's
 *  marker color, size, symbol and outline accept a same-length array — and its key, so
 *  a click tells which point it was (`customdata`). */
export function seriesPoints(paint: Paint, key: string, index: number, pointKeys: string[]) {
  const styles = pointKeys.map((k) => paint.point(k, key, index));
  return {
    customdata: pointKeys,
    marker: {
      color: styles.map((s) => withOpacity(s.color, s.fill)),
      size: styles.map((s) => s.size),
      symbol: styles.map((s) => s.shape),
      line: { color: styles.map((s) => s.outlineColor), width: styles.map((s) => s.outline) },
    },
  };
}

/** A trace as `withCaps` reads it. */
interface ErrorTrace {
  type: string;
  x: (number | string | null)[];
  y: (number | string | null)[];
  orientation?: string;
  width?: number;
  offsetgroup?: string;
  error_x?: { array: number[]; color: string; thickness: number };
  error_y?: { array: number[]; color: string; thickness: number };
}

/** The caps of error bars that go one way only: Plotly caps both ends, so those bars
 *  have none, and each such trace gets an invisible twin whose zero-long error bars, at
 *  their tips, are the caps. A bar's twin shares its place (`offsetgroup`). */
export function withCaps(data: unknown[], options: GraphOptions): unknown[] {
  if (options.errorDirection !== "above" || !options.errorCaps) return data;
  return (data as ErrorTrace[]).flatMap((trace, i) => {
    const key = trace.error_y ? "error_y" : trace.error_x ? "error_x" : null;
    if (!key) return [trace];
    const { array, color, thickness } = trace[key]!;
    const along = key === "error_y" ? "y" : "x";
    const tips = trace[along].map((v, j) => (typeof v === "number" ? v + array[j] : null));
    const bar = trace.type === "bar";
    const group = trace.offsetgroup ?? String(i);
    const twin = {
      type: trace.type,
      orientation: trace.orientation,
      x: trace.x,
      y: trace.y,
      [along]: tips,
      width: trace.width,
      ...(bar ? { offsetgroup: group } : { mode: "markers" }),
      marker: { color: "rgba(0,0,0,0)" },
      [key]: { type: "data", array: tips.map(() => 0), color, thickness, width: options.errorCaps },
      hoverinfo: "skip",
      showlegend: false,
    };
    return [bar ? { ...trace, offsetgroup: group } : trace, twin];
  });
}

/** Smallest and largest value (a loop, safe for any number of points). */
export const extent = (v: number[]): [number, number] => [
  v.reduce((a, b) => Math.min(a, b), Infinity),
  v.reduce((a, b) => Math.max(a, b), -Infinity),
];

/** The width a text of `fontSize` takes, roughly (no measuring before drawing). */
export const textWidth = (text: string, fontSize: number) => text.length * fontSize * 0.6 + 4;

// The texts that can be moved by hand: those with an arrow (the note's is invisible),
// so significance labels, which have none, stay on their brackets. Plotly reports where
// each was dropped; graph-view keeps it by the annotation's `name`.
export const MOVABLE = { annotationTail: true, legendPosition: true, colorbarPosition: true };

/** Which text Plotly says was moved (`moved`: its new place, by attribute, as
 *  "legend.x" or "annotations[2].ax"; `names`: each annotation's), and to where. */
export function movedText(moved: Record<string, number | undefined>, names: (string | undefined)[]) {
  const x = moved["legend.x"] ?? moved["colorbar.x"];
  const y = moved["legend.y"] ?? moved["colorbar.y"];
  if (x !== undefined && y !== undefined) return { name: "legend", at: { x, y } };
  const [, index] = Object.keys(moved)[0]?.match(/^annotations\[(\d+)\]\.a[xy]$/) ?? [];
  const name = index && names[Number(index)];
  const ax = moved[`annotations[${index}].ax`];
  const ay = moved[`annotations[${index}].ay`];
  return name && ax !== undefined && ay !== undefined ? { name, at: { x: ax, y: ay } } : null;
}

/** Adds a text note in the plot's top-left corner (a fit's equation), or where it was moved. */
export function addNote(fig: GraphFigure, text: string, options: GraphOptions) {
  fig.layout.annotations = [
    ...((fig.layout.annotations as unknown[]) ?? []),
    {
      name: "note",
      xref: "paper",
      yref: "paper",
      x: 0.02,
      y: 0.98,
      xanchor: "left",
      yanchor: "top",
      align: "left",
      showarrow: true,
      arrowcolor: "rgba(0,0,0,0)",
      ax: options.note?.x ?? 0,
      ay: options.note?.y ?? 0,
      text,
      font: { color: INK, size: Math.max(options.fontSize - 1, 8) },
    },
  ];
}

/** A point's name (`key`, see `pointKeyOf`) at `offset` px from it, joined to it by a
 *  thin line once it's moved away from a point `size` px wide. */
export const pointName = (key: string, x: number, y: number, text: string, offset: Place, size: number, fontSize: number) => ({
  name: key,
  x,
  y,
  xref: "x",
  yref: "y",
  text,
  showarrow: true,
  arrowhead: 0,
  arrowwidth: 0.5,
  arrowcolor: GUIDE,
  standoff: size / 2,
  ax: offset.x,
  ay: offset.y,
  font: { color: INK, size: fontSize },
});

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
/** A point's size in pixels, wherever it is set (Style, Selected points, the right-click menu). */
export const POINT_SIZE = { min: 2, max: 20 };

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

/** The legend, right of the plot, or where it was moved. */
const legendOf = (options: GraphOptions) => ({ x: 1.02, y: 1, xanchor: "left", ...options.legend });

/** An axis's title, `gap` px from its tick labels; none without text. */
const axisTitle = (text: string, gap: number) => (text ? { title: { text, standoff: gap } } : {});

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
      ...axisTitle(options.xLabel, options.xTitleGap),
    },
    yaxis: {
      // Minimalist: only the axis spine + ticks — no internal gridlines.
      ...axisChrome(options),
      ...yAxisRange(options, opts.zeroBase),
      ...axisTitle(options.yLabel, options.yTitleGap),
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
      ...axisTitle(options.xLabel, options.xTitleGap),
    },
    yaxis: {
      type: "category",
      categoryorder: "array",
      categoryarray: rowNames,
      autorange: "reversed",
      ...axisChrome(options),
      ...axisTitle(options.yLabel, options.yTitleGap),
    },
  };
}

/** XY family layout: a genuine numeric X axis (not category ticks), with a legend
 *  once there's more than one Y series. `xName` (the X column's name) and `yName`
 *  title the axes the user hasn't titled. */
export function xyLayout(
  options: GraphOptions,
  xName: string,
  seriesCount: number,
  opts: { zeroBase?: boolean; yName?: string } = {},
): Record<string, unknown> {
  return {
    ...chromeLayout(options),
    showlegend: seriesCount > 1,
    legend: legendOf(options),
    xaxis: {
      type: "linear",
      ...axisChrome(options),
      ...xAxisRange(options),
      ...axisTitle(options.xLabel || xName, options.xTitleGap),
    },
    yaxis: {
      ...axisChrome(options),
      ...yAxisRange(options, opts.zeroBase),
      ...axisTitle(options.yLabel || (opts.yName ?? ""), options.yTitleGap),
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
    ...axisTitle(options.yLabel, options.yTitleGap),
  };
  // Separated blocks need numeric positions with gaps between them, so they use
  // explicit tick placement instead of Plotly's evenly-spaced "category" axis.
  const category = {
    ...(opts.separated
      ? { tickmode: "array", tickvals: opts.separated.tickvals, ticktext: opts.separated.ticktext, range: opts.separated.range }
      : { type: "category" }),
    ...axisChrome(options),
    ...axisTitle(options.xLabel, options.xTitleGap),
  };
  return {
    ...chromeLayout(options),
    showlegend: seriesCount > 1,
    legend: legendOf(options),
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
    legend: legendOf(options),
    xaxis: {
      tickmode: "array",
      tickvals: separated ? separated.tickvals : labels.map((_, i) => i),
      ticktext: separated ? separated.ticktext : labels,
      range: separated ? separated.range : [-0.5, labels.length - 0.5],
      ...axisChrome(options),
      ...axisTitle(options.xLabel, options.xTitleGap),
    },
    yaxis: {
      ...axisChrome(options),
      ...yAxisRange(options),
      ...axisTitle(options.yLabel, options.yTitleGap),
    },
  };
}
