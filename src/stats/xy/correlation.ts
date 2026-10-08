// Correlation for an XY table, Prism-style: correlate X against every Y series,
// two explicitly chosen data series, or a full matrix among the Y series. Bespoke
// runner (not ColumnTestSpec) since each mode's result shape differs (a per-Y
// list, a single scalar pair, or a matrix).
import type { AnalysisOutcome, Column, CorrelationRow, XYCorrelationParams } from "../types";
import { dataGroups, describe, pRow, rVec } from "../column/base";
import { pairUp, splitXY, xyProblem } from "../../lib/dataset";
import { evalNamedVector } from "../webr";
import { runCorrelationMatrix } from "../multiple/correlation-matrix";

/** Minimum complete pairs before cor.test is meaningful. */
const MIN_PAIRS = 3;

export async function runXYCorrelation(
  columns: Column[],
  params: XYCorrelationParams | undefined,
): Promise<AnalysisOutcome> {
  const method = params?.method === "spearman" ? "spearman" : "pearson";
  const mode = params?.mode ?? "x-vs-every-y";
  const methodLabel = method === "spearman" ? "Spearman" : "Pearson";
  const vars = dataGroups(columns);
  const { x: xCol, ys: yCols } = splitXY(columns);

  if (mode === "matrix") {
    if (yCols.length < 2) {
      return { error: "A correlation matrix needs at least 2 Y data columns with numeric data." };
    }
    const outcome = await runCorrelationMatrix(yCols, { method });
    if ("error" in outcome) return outcome;
    return {
      ...outcome,
      testType: "correlation",
      matrix: { ...outcome.matrix!, label: `${methodLabel} correlation matrix (Y variables)` },
    };
  }

  if (mode === "two-datasets") {
    const [nameA, nameB] = params?.datasets ?? [];
    const a = vars.find((v) => v.name === nameA);
    const b = vars.find((v) => v.name === nameB);
    if (!a || !b) return { error: "Choose two data series to correlate." };
    const { x: xs, y: ys } = pairUp(a, b);
    if (xs.length < MIN_PAIRS) {
      return { error: `Not enough complete pairs (${xs.length}) between “${a.name}” and “${b.name}”.` };
    }
    const v = await evalNamedVector(
      `ct<-cor.test(${rVec(xs)},${rVec(ys)},method="${method}");c(r=unname(ct$estimate),p=ct$p.value)`,
    );
    return {
      testType: "correlation",
      subtitle: `${methodLabel} correlation`,
      stats: [{ label: `${methodLabel} r`, value: v.r }, pRow("P value", v.p)],
      groups: [a, b].map(describe),
      notes:
        method === "spearman"
          ? `Spearman rank correlation between “${a.name}” and “${b.name}”; non-parametric, no linearity assumption.`
          : `Pearson correlation between “${a.name}” and “${b.name}”; assumes a linear relationship.`,
    };
  }

  // "x-vs-every-y": correlate X against every Y series individually.
  if (!xCol || yCols.length < 1) return { error: xyProblem(columns)! };
  const stmts: string[] = [];
  const assigns: string[] = [];
  const computed = new Set<number>();
  yCols.forEach((y, i) => {
    const { x: xs, y: ys } = pairUp(xCol, y);
    if (xs.length < MIN_PAIRS) return;
    computed.add(i);
    stmts.push(`ct_${i}<-cor.test(${rVec(xs)},${rVec(ys)},method="${method}")`);
    assigns.push(`r_${i}=unname(ct_${i}$estimate),p_${i}=ct_${i}$p.value`);
  });
  if (assigns.length === 0) {
    return { error: `Not enough complete pairs (need at least ${MIN_PAIRS}) between X and any Y column.` };
  }
  const v = await evalNamedVector(`${stmts.join(";")};c(${assigns.join(",")})`);
  const correlations: CorrelationRow[] = yCols.map((y, i) => ({
    variable: y.name,
    r: computed.has(i) ? (v[`r_${i}`] ?? null) : null,
    p: computed.has(i) ? (v[`p_${i}`] ?? null) : null,
  }));
  const described = [xCol, ...yCols].map(describe);
  return {
    testType: "correlation",
    subtitle: `${methodLabel} correlation`,
    stats: [],
    groups: described,
    notes:
      method === "spearman"
        ? "Spearman rank correlation between X and each Y data column; non-parametric, no linearity assumption."
        : "Pearson correlation between X and each Y data column; assumes a linear relationship.",
    correlations,
  };
}
