// Outlier detection, ROUT method (Motulsky & Brown, BMC Bioinformatics 2006), column
// by column as in Prism: each column is fitted robustly (on a Column table, a Huber
// mean with MADN scale), each point's residual becomes a t statistic (df = n − 1), and
// points are outliers when their FDR-adjusted P is below Q. Only `pt` runs in R,
// in one batch.
import type { AnalysisOutcome, Column, OutlierGroupRow, OutliersParams } from "../types";
import { describe } from "./base";
import { adjustPValues } from "../grouped/base";
import { evalNamedVector } from "../webr";

const DEFAULTS: OutliersParams = { q: 1 };
const MIN_POINTS = 3; // fewer than this, a robust fit + outlier test isn't meaningful
const HUBER_K = 1.345; // 95%-efficiency tuning constant for Huber's psi function

interface Point {
  row: number;
  value: number;
}

function groupPoints(columns: Column[]): { name: string; points: Point[] }[] {
  return columns
    .filter((c) => c.values.length > 0)
    .map((c) => ({ name: c.name, points: c.rows.map((row, i) => ({ row, value: c.values[i] })) }));
}

/** Robust location (Huber M-estimator) + scale (MADN) for one column's values.
 *  `sd: null` means every value is identical — no meaningful outlier test. */
function robustFit(values: number[]): { mean: number; sd: number | null } {
  const sorted = [...values].sort((a, b) => a - b);
  const medianOf = (xs: number[]) => (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);
  const median = medianOf(sorted);
  const mad = medianOf(sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b));
  const sd = mad * 1.4826;
  if (sd === 0) return { mean: median, sd: null };
  let mean = median;
  for (let i = 0; i < 30; i++) {
    let wSum = 0;
    let wxSum = 0;
    for (const v of values) {
      const u = (v - mean) / sd;
      const w = Math.abs(u) <= HUBER_K ? 1 : HUBER_K / Math.abs(u);
      wSum += w;
      wxSum += w * v;
    }
    const next = wxSum / wSum;
    if (Math.abs(next - mean) < 1e-9) {
      mean = next;
      break;
    }
    mean = next;
  }
  return { mean, sd };
}

export async function runRout(columns: Column[], params?: OutliersParams): Promise<AnalysisOutcome> {
  const groups = groupPoints(columns);
  if (groups.length < 1) return { error: "This needs at least 1 column containing numeric data." };
  const { q: qPercent } = params ?? DEFAULTS;
  const q = qPercent / 100;

  const fits = groups.map((g) => (g.points.length >= MIN_POINTS ? robustFit(g.points.map((p) => p.value)) : { mean: NaN, sd: null }));

  // Batch every testable point's t statistic + df into one R round-trip for pt().
  const owner: { g: number; p: number; t: number; df: number }[] = [];
  groups.forEach((g, gi) => {
    const fit = fits[gi];
    if (g.points.length < MIN_POINTS || fit.sd == null) return;
    g.points.forEach((pt, pi) => owner.push({ g: gi, p: pi, t: (pt.value - fit.mean) / fit.sd!, df: g.points.length - 1 }));
  });

  let rawPByOwner: (number | null)[] = [];
  if (owner.length) {
    try {
      const code = `c(${owner.map((o, k) => `p${k}=2*pt(${-Math.abs(o.t)},${o.df})`).join(",")})`;
      const v = await evalNamedVector(code);
      rawPByOwner = owner.map((_, k) => v[`p${k}`] ?? null);
    } catch (err) {
      return { error: `Could not run the outlier test: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Slice raw p-values back per group, then FDR-adjust within each group independently.
  const rawPByGroup: (number | null)[][] = groups.map((g) => new Array(g.points.length).fill(null));
  owner.forEach(({ g, p }, k) => (rawPByGroup[g][p] = rawPByOwner[k]));
  const adjPByGroup = rawPByGroup.map((raw) => adjustPValues(raw, "fdr"));

  const outlierGroups: OutlierGroupRow[] = [];
  const flagged: { group: string; row: number; value: number; p: number }[] = [];
  const skipped: string[] = [];
  let totalPoints = 0;
  let totalOutliers = 0;

  groups.forEach((g, gi) => {
    const fit = fits[gi];
    const adj = adjPByGroup[gi];
    if (g.points.length < MIN_POINTS || fit.sd == null) skipped.push(g.name);
    let outliers = 0;
    g.points.forEach((pt, pi) => {
      const p = adj[pi];
      if (p != null && p < q) {
        outliers++;
        flagged.push({ group: g.name, row: pt.row, value: pt.value, p });
      }
    });
    totalPoints += g.points.length;
    totalOutliers += outliers;
    outlierGroups.push({
      group: g.name,
      points: g.points.length,
      outliers,
      percent: g.points.length ? (outliers / g.points.length) * 100 : 0,
      robustMean: g.points.length >= MIN_POINTS ? fit.mean : null,
    });
  });

  const notes =
    (flagged.length
      ? `Flagged as outliers (FDR-adjusted P < Q): ${flagged
          .map((f) => `${f.group} row ${f.row + 1} (value ${f.value}, adj. P = ${f.p.toFixed(4)})`)
          .join("; ")}. Use "Exclude from analysis" (⌘E) on those cells to remove them from other tests/graphs.`
      : `No outliers detected at Q = ${qPercent}%.`) +
    ` Method: each column fit independently to a robust mean (Huber M-estimator, scale from the median absolute ` +
    `deviation), residuals tested via a two-tailed t distribution and FDR-corrected (Benjamini-Hochberg) within ` +
    `that column. This mirrors the published Motulsky & Brown (2006) ROUT algorithm's logic, not GraphPad's ` +
    `certified implementation.` +
    (skipped.length ? ` Skipped (too few values or no variation to test): ${skipped.join(", ")}.` : "");

  return {
    testType: "outliers",
    subtitle: `ROUT method (Q = ${qPercent}%)`,
    stats: [
      { label: "Total observations", value: totalPoints },
      { label: "Groups analyzed", value: groups.length },
      { label: "Outliers detected", value: totalOutliers },
      { label: "Outlier percentage (%)", value: totalPoints ? (totalOutliers / totalPoints) * 100 : 0 },
      { label: "Q parameter (%)", value: qPercent },
    ],
    groups: groups.map((g) => describe({ name: g.name, values: g.points.map((p) => p.value) })),
    outlierGroups,
    notes,
  };
}
