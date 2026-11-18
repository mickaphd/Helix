// Significance annotations for Column-family graphs. A graph can read a sibling
// analysis's pairwise comparisons and draw Prism-style brackets (a horizontal
// line with two down-ticks + a centered "*"/"ns"/P-value label) between the two
// compared columns. Positions use the category X axis (column index) for X and
// DATA coordinates for Y, placing each bracket above the tallest drawn column
// (bars/points/error bars), and extends the Y auto-range to fit.
import type { AnalysisOutcome, ComparedCell } from "../../stats/types";
import type { GraphOptions, GraphType, ProjectNode } from "../../store/types";
import type { Column } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { isSignificant, pStars, pText } from "../../lib/format";
import {
  centers,
  errors,
  groupOffset,
  INK,
  perRowStats,
  rowCountOf,
  rowLabels,
  separatedPositions,
} from "./plot-helpers";
import { groupsOf } from "../../lib/dataset";
import { pairKey } from "../../lib/columns";
import { headline } from "../analyses/analysis-results-view";

/** The data sets an analysis ran on: those it chose, else every one of the table's
 *  (`all`, those holding data), a two-group test's first two. */
export function ranOn(analysis: ProjectNode, all: string[]): string[] {
  const sets = (analysis.analysisParams as { sets?: string[] } | undefined)?.sets;
  return sets ?? (analysis.analysisType === "compare-two-groups" ? all.slice(0, 2) : all);
}

/** Whether an analysis's stars may go on a graph showing `shown`: it ran on those data
 *  sets exactly, so its P values (corrected for its own comparisons) are those of the
 *  groups drawn, never of more. */
export const starsFit = (analysis: ProjectNode, all: string[], shown: string[]) => {
  const ran = ranOn(analysis, all);
  return ran.length === shown.length && ran.every((n) => shown.includes(n));
};

/** One pairwise comparison offered to the graph, keyed stably for persistence. */
export interface SigComparison {
  key: string;
  group1: string;
  group2: string;
  p: number | null;
  /** A grouped table's two cells (`ComparisonRow.cells`). */
  cells?: [ComparedCell, ComparedCell];
}

/** Pull the drawable pairwise comparisons out of an analysis outcome. Post-hoc
 *  tests (ANOVA/Kruskal-Wallis) expose a `comparisons` table directly; a plain
 *  two-group test has its own P value (`headline`, beside its F test), the one
 *  comparison between the two groups it compared. Everything else (descriptives,
 *  one-sample, an ANOVA with no post-hoc) yields nothing to annotate. */
export function deriveComparisons(outcome: AnalysisOutcome | null): SigComparison[] {
  if (!outcome || "error" in outcome) return [];
  if (outcome.comparisons?.length) {
    // A pair of columns, or of a grouped table's cells (a per-row test's group2 is blank:
    // its cells say which two it compared).
    return outcome.comparisons
      .filter((c) => c.group2 || c.cells)
      .map((c) => ({
        key: pairKey(c.group1, c.group2),
        group1: c.group1,
        group2: c.group2,
        p: c.p,
        ...(c.cells ? { cells: c.cells } : {}),
      }));
  }
  if (outcome.testType === "compare-two-groups" && outcome.groups.length === 2) {
    const [group1, group2] = outcome.groups.map((g) => g.name);
    return [{ key: pairKey(group1, group2), group1, group2, p: headline(outcome.stats) }];
  }
  return [];
}

/** The highest drawn Y for each column, so a bracket can clear the actual marks —
 *  bars/points/whiskers AND the error-bar cap. `mean-error` draws only the center
 *  ± error, so its top is center+error; the point/box families also draw every raw
 *  value, so their top includes the data max. Aligned to `columns` order. */
function columnTops(
  columns: Column[],
  graphType: GraphType,
  center: GraphOptions["center"],
  error: GraphOptions["error"],
): number[] {
  const middle = centers(columns, center);
  const err = errors(columns, error);
  return columns.map((c, i) => {
    if (c.values.length === 0) return 0;
    const errTop = middle[i] + (err?.[i] ?? 0);
    return graphType === "mean-error" ? errTop : c.values.reduce((a, b) => Math.max(a, b), errTop);
  });
}

/** Where a bracket can start or end: a column, or a group at a row (`spotKey`); its X on
 *  the axis, and the top of what is drawn there. */
interface Spot {
  key: string;
  x: number;
  top: number;
  /** Its center as drawn (mean or median): letters start from the highest. */
  mid: number;
}

/** A grouped table's cell, as a spot's key. */
const spotKey = (group: string, row: number) => `${group}\u0000${row}`;

/** Build Plotly `shapes` + `annotations` (data coordinates) for the selected comparisons,
 *  each between its two spots (`ends`), plus the highest Y used so the caller can extend the
 *  axis to fit. A bracket clears what is drawn under it: every column's top (`local` false,
 *  a column graph) or the tops between its ends (a grouped graph, whose rows differ);
 *  brackets overlapping in X stack on levels, the narrowest lowest. Comparisons whose ends
 *  aren't both drawn, or with no P value, are skipped. On a log Y axis the spacing is
 *  reckoned in log10, so it looks the same at any height: shapes take values, texts the
 *  log10 of them (`onAxis`). */
function significanceOverlay(
  spots: Spot[],
  comparisons: (SigComparison & { ends: [string, string] })[],
  display: GraphOptions["sigDisplay"],
  scale: GraphOptions["yScale"],
  local: boolean,
): { shapes: unknown[]; annotations: unknown[]; top: number } {
  const log = scale !== "linear";
  const lift = (t: number) => (log ? (t > 0 ? Math.log10(t) : -Infinity) : t);
  const tops = spots.map((s) => lift(s.top)).filter(Number.isFinite);
  const value = (y: number) => (log ? 10 ** y : y);
  const maxTop = log ? Math.max(...tops) : Math.max(0, ...tops);
  const at = new Map(spots.map((s) => [s.key, s]));
  const resolved = comparisons
    .map((c) => ({ ...c, a: at.get(c.ends[0]), b: at.get(c.ends[1]) }))
    .filter((c) => c.a && c.b && c.p != null && !Number.isNaN(c.p))
    .map((c) => ({ ...c, lo: Math.min(c.a!.x, c.b!.x), hi: Math.max(c.a!.x, c.b!.x) }))
    // Narrowest span first, so short brackets sit low and wide ones rise above them.
    .sort((a, b) => a.hi - a.lo - (b.hi - b.lo));

  if (resolved.length === 0 || !tops.length) return { shapes: [], annotations: [], top: value(maxTop) };

  // Stack unit scaled to the data extent (so spacing looks right at any scale).
  const floor = log ? Math.min(...tops) : Math.min(0, ...tops);
  const unit = log
    ? Math.max((maxTop - floor) * 0.08, 0.1)
    : Math.max((maxTop - floor) * 0.08, Math.abs(maxTop) * 0.05, 0.5);
  // What a bracket clears: everything, or what is drawn between its ends.
  const baseOf = (lo: number, hi: number) =>
    local
      ? Math.max(
          ...spots
            .filter((s) => s.x >= lo - 1e-9 && s.x <= hi + 1e-9)
            .map((s) => lift(s.top))
            .filter(Number.isFinite),
        )
      : maxTop;

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

    // Base gap above what it clears, then extra room per stacked level so brackets never
    // crowd each other (a bigger star label needs the headroom).
    const yL = baseOf(c.lo, c.hi) + unit * (1 + level * 1.7);
    const line = { color: INK, width: 1.2 };
    shapes.push(
      { type: "line", xref: "x", yref: "y", x0: c.lo, x1: c.hi, y0: value(yL), y1: value(yL), line, layer: "above" },
      {
        type: "line",
        xref: "x",
        yref: "y",
        x0: c.lo,
        x1: c.lo,
        y0: value(yL),
        y1: value(yL - unit * 0.35),
        line,
        layer: "above",
      },
      {
        type: "line",
        xref: "x",
        yref: "y",
        x0: c.hi,
        x1: c.hi,
        y0: value(yL),
        y1: value(yL - unit * 0.35),
        line,
        layer: "above",
      },
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

  return { shapes, annotations, top: value(top) };
}

/** Where a comparison's two ends are drawn: its two columns, or its two cells. */
const endsOf = (c: SigComparison): [string, string] =>
  c.cells
    ? [spotKey(c.cells[0].group, c.cells[0].row), spotKey(c.cells[1].group, c.cells[1].row)]
    : [c.group1, c.group2];

/** The families a set of comparisons makes, each compared among itself: every group of a
 *  column graph; a grouped table's groups within a row, or rows within a group. */
function familiesOf(comparisons: SigComparison[]): Map<string, SigComparison[]> {
  const families = new Map<string, SigComparison[]>();
  for (const c of comparisons) {
    const [a, b] = c.cells ?? [];
    const family = !a || !b ? "" : a.row === b.row ? `row ${a.row}` : `group ${a.group}`;
    families.set(family, [...(families.get(family) ?? []), c]);
  }
  return families;
}

/** Whether every family compares every pair of its members: letters need all of them
 *  (not Dunnett's comparisons with a control, nor pairs chosen). */
export function lettersFit(comparisons: SigComparison[]): boolean {
  if (!comparisons.length) return false;
  return [...familiesOf(comparisons).values()].every((family) => {
    const members = new Set(family.flatMap(endsOf));
    const pairs = new Set(family.map((c) => endsOf(c).sort().join("\u0001")));
    return pairs.size === (members.size * (members.size - 1)) / 2;
  });
}

/** The compact letter display of one family (Piepho's insert-absorb, 2004): two members
 *  sharing a letter don't differ significantly (P ≥ 0.05). `order`: the members from the
 *  highest center down, so "a" goes to the highest. */
export function compactLetters(order: string[], differ: [string, string][]): Map<string, string> {
  let sets: Set<string>[] = [new Set(order)];
  for (const [i, j] of differ) {
    // Split every set holding both, then drop the sets another one holds.
    sets = sets.flatMap((s) =>
      s.has(i) && s.has(j) ? [new Set([...s].filter((m) => m !== i)), new Set([...s].filter((m) => m !== j))] : [s],
    );
    sets = sets.filter(
      (s, k) => !sets.some((t, l) => l !== k && [...s].every((m) => t.has(m)) && (t.size > s.size || l < k)),
    );
  }
  const rank = (s: Set<string>) => Math.min(...[...s].map((m) => order.indexOf(m)));
  sets.sort((a, b) => rank(a) - rank(b));
  const letter = (k: number) =>
    k < 26 ? String.fromCharCode(97 + k) : `${String.fromCharCode(97 + (k % 26))}${Math.floor(k / 26)}`;
  return new Map(order.map((m) => [m, sets.flatMap((s, k) => (s.has(m) ? [letter(k)] : [])).join("")]));
}

/** Letters over every member of each family, a little above what is drawn there. */
function lettersOverlay(
  spots: Spot[],
  comparisons: SigComparison[],
  scale: GraphOptions["yScale"],
): { shapes: unknown[]; annotations: unknown[]; top: number } {
  const log = scale !== "linear";
  const lift = (t: number) => (log ? (t > 0 ? Math.log10(t) : -Infinity) : t);
  const tops = spots.map((s) => lift(s.top)).filter(Number.isFinite);
  const maxTop = log ? Math.max(...tops) : Math.max(0, ...tops);
  const floor = log ? Math.min(...tops) : Math.min(0, ...tops);
  const unit = log ? Math.max((maxTop - floor) * 0.08, 0.1) : Math.max((maxTop - floor) * 0.08, 0.5);
  const at = new Map(spots.map((s) => [s.key, s]));
  const annotations: unknown[] = [];
  let top = maxTop;
  if (lettersFit(comparisons))
    for (const family of familiesOf(comparisons).values()) {
      const members = [...new Set(family.flatMap(endsOf))].filter((m) => at.has(m));
      const order = members.sort((a, b) => at.get(b)!.mid - at.get(a)!.mid);
      const differ = family.filter((c) => isSignificant(c.p)).map(endsOf);
      for (const [key, text] of compactLetters(order, differ)) {
        const spot = at.get(key)!;
        const y = lift(spot.top) + unit * 0.3;
        if (!Number.isFinite(y)) continue;
        annotations.push({
          xref: "x",
          yref: "y",
          x: spot.x,
          y,
          text,
          showarrow: false,
          yanchor: "bottom",
          font: { color: INK, size: 14 },
        });
        top = Math.max(top, y + unit);
      }
    }
  return { shapes: [], annotations, top: log ? 10 ** top : top };
}

/** The grouped graphs that draw stars: each group's values at a row stand side by side. */
export const GROUPED_STARS = new Set<GraphType>(["grouped-bars", "grouped-scatter", "grouped-box"]);

/** A grouped graph's spots: each group at each row, at its place on the axis (bars side by
 *  side in a row's slot, Plotly's 0.2 gap between rows; points and boxes at their offsets;
 *  "Separated", each group's own block), topped by its highest value or error bar. */
function groupedSpots(
  columns: Column[],
  graphType: GraphType,
  options: GraphOptions,
  titles?: (string | null)[],
): Spot[] {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const n = groups.length;
  const separated = options.groupLayout === "separated" ? separatedPositions(n, rowLabels(rows, titles)) : undefined;
  const xOf = (g: number, r: number) =>
    separated
      ? separated.posOf(g, r)
      : graphType === "grouped-bars"
        ? r - 0.4 + (0.8 * (g + 0.5)) / n
        : r + groupOffset(g, n);
  return groups.flatMap((group, g) => {
    const { center, error } = perRowStats(group.columns, rows, options.center, options.error);
    return Array.from({ length: rows }, (_, r) => {
      const values = group.columns.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
      const bar = center[r] == null ? -Infinity : center[r]! + (error?.[r] ?? 0);
      const top = graphType === "grouped-bars" ? bar : Math.max(bar, ...values);
      return { key: spotKey(group.name, r), x: xOf(g, r), top, mid: center[r] ?? 0 };
    }).filter((s) => Number.isFinite(s.top));
  });
}

/** Draws the chosen comparisons as brackets above the columns (or a grouped graph's cells),
 *  growing the Y range to fit them — only while the Y max is on Auto: a manual max wins,
 *  and may clip. */
export function addSignificance(
  fig: GraphFigure,
  columns: Column[],
  graphType: GraphType,
  options: GraphOptions,
  comparisons: SigComparison[],
  titles?: (string | null)[],
) {
  const letters = options.sigDisplay === "letters";
  const selected = letters ? comparisons : comparisons.filter((c) => (options.sigPairs ?? []).includes(c.key));
  if (!selected.length) return;
  const grouped = GROUPED_STARS.has(graphType);
  const middle = centers(columns, options.center);
  const spots = grouped
    ? groupedSpots(columns, graphType, options, titles)
    : columnTops(columns, graphType, options.center, options.error).map((top, i) => ({
        key: columns[i].name,
        x: i,
        top,
        mid: middle[i] ?? 0,
      }));
  const overlay = letters
    ? lettersOverlay(spots, selected, options.yScale)
    : significanceOverlay(
        spots,
        selected.map((c) => ({ ...c, ends: endsOf(c) })),
        options.sigDisplay,
        options.yScale,
        grouped,
      );
  fig.layout.shapes = [...((fig.layout.shapes as unknown[]) ?? []), ...overlay.shapes];
  fig.layout.annotations = [...((fig.layout.annotations as unknown[]) ?? []), ...overlay.annotations];
  const yaxis = (fig.layout.yaxis ??= {}) as Record<string, unknown>;
  const range = (yaxis.autorangeoptions ??= {}) as Record<string, unknown>;
  range.include = overlay.top;
}
