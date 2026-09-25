// Multiple t tests (Prism-style): a t test (or Wilcoxon/Mann-Whitney) at every
// row position between a Grouped table's exactly-2 column-groups, corrected for
// multiplicity across rows. Reuses the comparisons table (group1 = row label,
// group2 left blank — the fixed group pair is stated once in comparisonsLabel).
// `paired` pairs replicate columns by position between the 2 groups (needs
// column-identity alignment, unlike the independent per-row filtering `groupRows`
// does for the unpaired case). `pooledSd` (parametric only) assumes one shared SD
// across every row (pooled residual variance, like a single-error-term ANOVA)
// instead of each row estimating its own — computed in JS, then only `pt()` (the
// t distribution's CDF) is evaluated in R.
import type { AnalysisOutcome, Column, MultipleTTestsParams } from "../types";
import { describe, rBool, rVec } from "../column/base";
import { evalNamedVector } from "../webr";
import { adjustPValues, groupRows, pairedGroupRows, rowName } from "./base";

const CORRECTION_LABEL: Record<MultipleTTestsParams["correction"], string> = {
  holm: "Holm-corrected",
  fdr: "FDR-corrected (Benjamini-Hochberg)",
  none: "uncorrected",
};

const mean = (vs: number[]) => vs.reduce((a, b) => a + b, 0) / vs.length;

/** Pooled-SD path (parametric only): compute each row's mean/diff and pooled
 *  residual variance in JS, then batch just the `pt()` CDF lookups through R. */
async function runPooledSd(
  testable: number[],
  rowsA: number[][],
  rowsB: number[][],
  paired: boolean,
): Promise<{ p: (number | null)[]; diff: (number | null)[] } | { error: string }> {
  let ss = 0;
  let df = 0;
  const rowStat = testable.map((r) => {
    if (paired) {
      const d = rowsA[r].map((a, i) => a - rowsB[r][i]);
      const m = mean(d);
      ss += d.reduce((s, x) => s + (x - m) ** 2, 0);
      df += d.length - 1;
      return { diff: m, se2: 1 / d.length };
    }
    const a = rowsA[r];
    const b = rowsB[r];
    const ma = mean(a);
    const mb = mean(b);
    ss += a.reduce((s, x) => s + (x - ma) ** 2, 0) + b.reduce((s, x) => s + (x - mb) ** 2, 0);
    df += a.length + b.length - 2;
    return { diff: ma - mb, se2: 1 / a.length + 1 / b.length };
  });
  if (df <= 0) return { error: "Not enough replicate values to pool a shared SD across rows." };
  const pooledVar = ss / df;
  const ts = rowStat.map((s) => s.diff / Math.sqrt(pooledVar * s.se2));
  const v = await evalNamedVector(`c(${ts.map((t, k) => `p${k}=2*pt(${-Math.abs(t)},${df})`).join(",")})`);
  return { p: ts.map((_, k) => v[`p${k}`] ?? null), diff: rowStat.map((s) => s.diff) };
}

export async function runMultipleTTests(
  columns: Column[],
  params: MultipleTTestsParams,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  let name1: string;
  let name2: string;
  let rowsA: number[][];
  let rowsB: number[][];
  if (params.paired) {
    const paired = pairedGroupRows(columns);
    if (!paired) return { error: "Multiple t tests need exactly 2 column groups." };
    ({ name1, name2, rowsA, rowsB } = paired);
  } else {
    const rows = groupRows(columns);
    if (rows.size !== 2) return { error: "Multiple t tests need exactly 2 column groups." };
    [[name1, rowsA], [name2, rowsB]] = [...rows];
  }
  const testable = Array.from({ length: Math.min(rowsA.length, rowsB.length) }, (_, r) => r).filter(
    (r) => rowsA[r].length > 1 && rowsB[r].length > 1,
  );
  if (testable.length === 0) {
    return { error: `Each row needs at least 2 ${params.paired ? "paired " : ""}replicate values in both groups.` };
  }

  try {
    let rawP: (number | null)[];
    let diffs: (number | null)[];
    if (params.gaussian && params.pooledSd) {
      const outcome = await runPooledSd(testable, rowsA, rowsB, params.paired);
      if ("error" in outcome) return outcome;
      rawP = outcome.p;
      diffs = outcome.diff;
    } else {
      const call = (r: number) =>
        `${params.gaussian ? "t.test" : "wilcox.test"}(${rVec(rowsA[r])},${rVec(rowsB[r])},paired=${rBool(params.paired)})`;
      // wilcox.test emits ties/exact warnings — wrap the CALL (not the symbol) so
      // suppressWarnings actually applies (suppressWarnings(wilcox.test)(...) would not).
      const stmts = testable.map((r) => `t${r}<-${params.gaussian ? call(r) : `suppressWarnings(${call(r)})`}`);
      const values = testable.flatMap((r) => [
        `p${r}=t${r}$p.value`,
        `d${r}=mean(${rVec(rowsA[r])})-mean(${rVec(rowsB[r])})`,
      ]);
      const v = await evalNamedVector(`${stmts.join(";")};c(${values.join(",")})`);
      rawP = testable.map((r) => v[`p${r}`] ?? null);
      diffs = testable.map((r) => v[`d${r}`] ?? null);
    }

    const adjP = adjustPValues(rawP, params.correction);
    const comparisons = testable.map((r, i) => ({ group1: rowName(titles, r), group2: "", diff: diffs[i], p: adjP[i] }));
    const significant = adjP.filter((p) => p != null && p < 0.05).length;
    const testLabel = params.gaussian
      ? params.paired
        ? `Paired t test${params.pooledSd ? " (pooled SD across rows)" : ""}`
        : params.pooledSd
          ? "Unpaired t test (pooled SD across rows)"
          : "Welch's t test (no equal-SD assumption)"
      : `${params.paired ? "Wilcoxon signed-rank" : "Mann-Whitney"} test`;
    return {
      testType: "multiple-t-tests",
      subtitle: params.gaussian ? "Multiple t tests" : `Multiple ${params.paired ? "Wilcoxon signed-rank" : "Mann-Whitney"} tests`,
      stats: [
        { label: "Rows compared", value: testable.length },
        { label: "Significant rows (P < 0.05)", value: significant },
      ],
      groups: [name1, name2].map((name, i) => describe({ name, values: (i === 0 ? rowsA : rowsB).flat() })),
      notes: `${testLabel} at each row, ${CORRECTION_LABEL[params.correction]} across rows.`,
      comparisons,
      comparisonsLabel: `Per-row comparisons (${name1} vs. ${name2})`,
    };
  } catch (err) {
    return { error: `Could not run the test: ${err instanceof Error ? err.message : String(err)}` };
  }
}
