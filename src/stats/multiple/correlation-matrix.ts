// Correlation matrix for a Multiple Variables table: Pearson or Spearman r (with
// P value) between every pair of data-bearing variables, computed pairwise-complete.
// Bespoke runner (not ColumnTestSpec) — its result is a matrix, not a scalar set.
import type { AnalysisOutcome, Column, CorrelationParams } from "../types";
import { dataGroups, describe, pairIndices, rVec } from "../column/base";
import { pairUp } from "../../lib/dataset";
import { evalNamedVector } from "../webr";

/** Minimum complete pairs before cor.test is meaningful; fewer → leave the cell blank. */
const MIN_PAIRS = 3;

export async function runCorrelationMatrix(
  columns: Column[],
  params: CorrelationParams | undefined,
): Promise<AnalysisOutcome> {
  const method = params?.method === "spearman" ? "spearman" : "pearson";
  const vars = dataGroups(columns);
  if (vars.length < 2) {
    return { error: "A correlation matrix needs at least 2 columns containing numeric data." };
  }

  const pairs = pairIndices(vars.length);
  // One cor.test per pair, keyed by explicit r_i_j / p_i_j names (flat-map rule —
  // no matrices cross the WebR boundary, only a named vector does).
  const stmts: string[] = [];
  const assigns: string[] = [];
  for (const [i, j] of pairs) {
    const { x: xs, y: ys } = pairUp(vars[i], vars[j]);
    if (xs.length < MIN_PAIRS) continue; // too few complete pairs → null cell
    const ct = `ct_${i}_${j}`;
    stmts.push(`${ct}<-cor.test(${rVec(xs)},${rVec(ys)},method="${method}")`);
    assigns.push(`r_${i}_${j}=unname(${ct}$estimate),p_${i}_${j}=${ct}$p.value`);
  }

  try {
    const v = assigns.length ? await evalNamedVector(`${stmts.join(";")};c(${assigns.join(",")})`) : {};
    const r: (number | null)[][] = vars.map((_, i) => vars.map((__, j) => (i === j ? 1 : null)));
    const p: (number | null)[][] = vars.map(() => vars.map(() => null));
    for (const [i, j] of pairs) {
      r[i][j] = r[j][i] = v[`r_${i}_${j}`] ?? null;
      p[i][j] = p[j][i] = v[`p_${i}_${j}`] ?? null;
    }
    const described = vars.map(describe);
    return {
      testType: "correlation-matrix",
      subtitle: method === "spearman" ? "Spearman correlation matrix" : "Pearson correlation matrix",
      stats: [],
      groups: described,
      notes:
        method === "spearman"
          ? "Spearman rank correlation between every pair of variables, computed on pairwise-complete rows; non-parametric, no linearity assumption."
          : "Pearson correlation between every pair of variables, computed on pairwise-complete rows; assumes linear relationships.",
      matrix: { variables: vars.map((c) => c.name), r, p, label: "Correlation matrix (r)" },
    };
  } catch (err) {
    return { error: `Could not run the test: ${err instanceof Error ? err.message : String(err)}` };
  }
}
