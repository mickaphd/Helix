// Significance annotations for Column-family graphs. A graph can read a sibling
// analysis's pairwise comparisons and draw Prism-style brackets (a horizontal
// line with two down-ticks + a centered "*"/"ns"/P-value label) between the two
// compared columns. Positions use the category X axis (column index) for X and
// DATA coordinates for Y, placing each bracket above the tallest drawn column
// (bars/points/error bars), and extends the Y auto-range to fit.
import type { AnalysisOutcome } from "../../stats/types";
import type { GraphOptions, GraphType } from "../../store/types";
import type { Column } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { pStars, pText } from "../../lib/format";
import { INK, mean, sd, median } from "./plot-helpers";

/** One pairwise comparison offered to the graph, keyed stably for persistence. */
export interface SigComparison {
  key: string;
  group1: string;
  group2: string;
  p: number | null;
}

/** NUL-joined key — safe against column names containing arrow/pipe characters. */
export const pairKey = (a: string, b: string) => `${a}\u0000${b}`;
/** The two column names of a `pairKey`. */
export const pairOf = (key: string) => key.split("\u0000") as [string, string];

/** Pull the drawable pairwise comparisons out of an analysis outcome. Post-hoc
 *  tests (ANOVA/Kruskal-Wallis) expose a `comparisons` table directly; a plain
 *  two-group test has a single P value in `stats`, synthesised here into the one
 *  comparison between the first two numeric columns. Everything else (descriptives,
 *  one-sample, an ANOVA with no post-hoc) yields nothing to annotate. */
export function deriveComparisons(outcome: AnalysisOutcome | null, numericNames: string[]): SigComparison[] {
  if (!outcome || "error" in outcome) return [];
  if (outcome.comparisons?.length) {
    return outcome.comparisons
      .filter((c) => c.group2) // per-row tests leave group2 blank — not a 2-column pair
      .map((c) => ({ key: pairKey(c.group1, c.group2), group1: c.group1, group2: c.group2, p: c.p }));
  }
  if (outcome.testType === "compare-two-groups" && numericNames.length >= 2) {
    const p = outcome.stats.find((s) => s.p)?.value ?? null;
    return [{ key: pairKey(numericNames[0], numericNames[1]), group1: numericNames[0], group2: numericNames[1], p }];
  }
  return [];
}


/** The highest drawn Y for each column, so a bracket can clear the actual marks —
 *  bars/points/whiskers AND the error-bar cap. `mean-error` draws only the center
 *  ± error, so its top is center+error; the point/box families also draw every raw
 *  value, so their top includes the data max. Aligned to `columns` order. */
function columnTops(
  columns: { values: number[] }[],
  graphType: GraphType | undefined,
  center: GraphOptions["center"],
  error: GraphOptions["error"],
): number[] {
  return columns.map((c) => {
    const v = c.values;
    if (v.length === 0) return 0;
    const ctr = center === "median" ? median(v) : mean(v);
    const err = error === "none" ? 0 : error === "sem" ? sd(v) / Math.sqrt(v.length) : sd(v);
    const errTop = ctr + err;
    return graphType === "mean-error" ? errTop : v.reduce((a, b) => Math.max(a, b), errTop);
  });
}

/** Build Plotly `shapes` + `annotations` (data coordinates) for the selected
 *  comparisons, plus the highest Y used so the caller can extend the axis to fit.
 *  Every bracket clears the tallest column (`maxTop`) so it always sits above every
 *  bar/point/error bar; overlapping spans stack on separate levels. `columnNames`
 *  is the plotted column order (X index = position); `tops[i]` is column i's drawn
 *  top. Comparisons whose columns aren't both plotted, or with no P value, are skipped. */
function significanceOverlay(
  columnNames: string[],
  tops: number[],
  comparisons: SigComparison[],
  display: "stars" | "pvalue",
): { shapes: unknown[]; annotations: unknown[]; top: number } {
  const maxTop = Math.max(0, ...tops);
  const resolved = comparisons
    .map((c) => ({ ...c, i: columnNames.indexOf(c.group1), j: columnNames.indexOf(c.group2) }))
    .filter((c) => c.i >= 0 && c.j >= 0 && c.p != null && !Number.isNaN(c.p))
    .map((c) => ({ ...c, lo: Math.min(c.i, c.j), hi: Math.max(c.i, c.j) }))
    // Narrowest span first, so short brackets sit low and wide ones rise above them.
    .sort((a, b) => a.hi - a.lo - (b.hi - b.lo));

  if (resolved.length === 0) return { shapes: [], annotations: [], top: maxTop };

  // Stack unit scaled to the data extent (so spacing looks right at any scale).
  const floor = Math.min(0, ...tops);
  const unit = Math.max((maxTop - floor) * 0.08, Math.abs(maxTop) * 0.05, 0.5);

  // Interval-graph packing: each bracket takes the lowest free level (no X overlap).
  const levels: [number, number][][] = [];
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];
  let top = maxTop;

  const stars = display !== "pvalue";
  for (const c of resolved) {
    let level = levels.findIndex((band) => band.every(([lo, hi]) => c.hi < lo || c.lo > hi));
    if (level === -1) {
      level = levels.length;
      levels.push([]);
    }
    levels[level].push([c.lo, c.hi]);

    // Base gap above the tallest column, then extra room per stacked level so
    // brackets never crowd each other (a bigger star label needs the headroom).
    const yL = maxTop + unit * (1 + level * 1.7);
    const line = { color: INK, width: 1.2 };
    shapes.push(
      { type: "line", xref: "x", yref: "y", x0: c.lo, x1: c.hi, y0: yL, y1: yL, line, layer: "above" },
      { type: "line", xref: "x", yref: "y", x0: c.lo, x1: c.lo, y0: yL, y1: yL - unit * 0.35, line, layer: "above" },
      { type: "line", xref: "x", yref: "y", x0: c.hi, x1: c.hi, y0: yL, y1: yL - unit * 0.35, line, layer: "above" },
    );
    annotations.push({
      xref: "x",
      yref: "y",
      x: (c.lo + c.hi) / 2,
      // Stars are drawn larger to match the P-value text and sit snug on the
      // bracket; the P-value label keeps a hair of breathing room.
      y: yL + unit * (stars ? 0.02 : 0.08),
      text: stars ? pStars(c.p) : pText(c.p),
      showarrow: false,
      yanchor: "bottom",
      font: { color: INK, size: stars ? 19 : 14 },
    });
    top = Math.max(top, yL + unit * 1.6); // headroom for the bracket + its label
  }

  return { shapes, annotations, top };
}

/** Draws the chosen comparisons as brackets above the columns, growing the Y range
 *  to fit them — only while the Y max is on Auto: a manual max wins, and may clip. */
export function addSignificance(
  fig: GraphFigure,
  columns: Column[],
  graphType: GraphType,
  options: GraphOptions,
  comparisons: SigComparison[],
) {
  const selected = comparisons.filter((c) => (options.sigPairs ?? []).includes(c.key));
  if (!selected.length) return;
  const tops = columnTops(columns, graphType, options.center, options.error);
  const overlay = significanceOverlay(
    columns.map((c) => c.name),
    tops,
    selected,
    options.sigDisplay,
  );
  fig.layout.shapes = [...((fig.layout.shapes as unknown[]) ?? []), ...overlay.shapes];
  fig.layout.annotations = [...((fig.layout.annotations as unknown[]) ?? []), ...overlay.annotations];
  const yaxis = (fig.layout.yaxis ??= {}) as Record<string, unknown>;
  const range = (yaxis.autorangeoptions ??= {}) as Record<string, unknown>;
  range.include = overlay.top;
}
