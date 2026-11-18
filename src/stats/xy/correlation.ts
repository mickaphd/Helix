// Correlation for an XY table, Prism-style: correlate X against every Y series,
// two explicitly chosen data series, or a full matrix among the Y series. Bespoke
// runner (not ColumnTestSpec) since each mode's result shape differs (a per-Y
// list, a single scalar pair, or a matrix).
import type { AnalysisOutcome, Column, CorrelationRow, XYCorrelationParams } from "../types";
import { dataGroups, describe, identical, pRow, rVec } from "../column/base";
import { pairUp, splitXY, xyPoints, xyProblem } from "../../lib/dataset";
import { evalNamedVector } from "../webr";
import { runCorrelationMatrix } from "../multiple/correlation-matrix";

/** R: `rci(ct, n)`, r's 95% CI: Pearson's from cor.test (Fisher's z), Spearman's on Fisher's z
 *  with Fieller, Hartley and Pearson's variance, 1.06 / (n − 3) (1957); none under 4 pairs, nor
 *  for a perfect r (±1), where Fisher's z is infinite. */
const R_RCI =
  "rci<-function(ct,n){r<-unname(ct$estimate);if(abs(r)>=1)return(c(NA,NA));if(!is.null(ct$conf.int))return(as.vector(ct$conf.int));if(n<4)return(c(NA,NA));tanh(atanh(r)+c(-1,1)*qnorm(0.975)*sqrt(1.06/(n-3)))}";

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
  // Two data sets pair up row by row: one value each, not replicates.
  if (mode !== "x-vs-every-y" && yCols.some((y) => y.columns.length > 1)) {
    return { error: "Correlating Y data sets with each other needs one value per row: this table has replicates." };
  }

  if (mode === "matrix") {
    if (yCols.length < 2) {
      return { error: "A correlation matrix needs at least 2 Y data sets holding numbers." };
    }
    const outcome = await runCorrelationMatrix(
      yCols.map((y) => y.columns[0]),
      { method },
    );
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
    if (!a || !b) return { error: "Choose two data sets to correlate." };
    const { x: xs, y: ys } = pairUp(a, b);
    if (xs.length < MIN_PAIRS) {
      return { error: `Not enough complete pairs (${xs.length}) between “${a.name}” and “${b.name}”.` };
    }
    const still = identical(xs) ? a : identical(ys) ? b : undefined;
    if (still)
      return { error: `“${still.name}”'s values are all identical: a correlation needs both data sets to vary.` };
    const v = await evalNamedVector(
      `${R_RCI};ct<-suppressWarnings(cor.test(${rVec(xs)},${rVec(ys)},method="${method}"));ci<-rci(ct,${xs.length});` +
        `c(r=unname(ct$estimate),p=ct$p.value,lo=ci[1],hi=ci[2],r2=unname(ct$estimate)^2)`,
    );
    return {
      testType: "correlation",
      subtitle: `${methodLabel} correlation`,
      stats: [
        { label: `${methodLabel} r`, value: v.r },
        { label: "95% CI lower", value: v.lo },
        { label: "95% CI upper", value: v.hi },
        ...(method === "pearson" ? [{ label: "R squared", value: v.r2 }] : []),
        pRow("P value", v.p),
      ],
      groups: (await describe([a, b])).groups,
      notes:
        method === "spearman"
          ? `Spearman rank correlation between “${a.name}” and “${b.name}”; non-parametric, no linearity assumption.`
          : `Pearson correlation between “${a.name}” and “${b.name}”; assumes a linear relationship.`,
    };
  }

  // "x-vs-every-y": correlate X against every Y series individually, each replicate a point.
  if (!xCol || yCols.length < 1) return { error: xyProblem(columns)! };
  const stmts: string[] = [];
  const assigns: string[] = [];
  const computed = new Set<number>();
  yCols.forEach((y, i) => {
    const { x: xs, y: ys } = xyPoints(xCol, y);
    if (xs.length < MIN_PAIRS || identical(xs) || identical(ys)) return;
    computed.add(i);
    stmts.push(
      `ct_${i}<-suppressWarnings(cor.test(${rVec(xs)},${rVec(ys)},method="${method}"));ci_${i}<-rci(ct_${i},${xs.length})`,
    );
    assigns.push(`r_${i}=unname(ct_${i}$estimate),p_${i}=ct_${i}$p.value,lo_${i}=ci_${i}[1],hi_${i}=ci_${i}[2]`);
  });
  if (assigns.length === 0) {
    return identical(xCol.values)
      ? { error: `“${xCol.name}”'s values are all identical: a correlation needs X to vary.` }
      : {
          error: `No Y data set has ${MIN_PAIRS} complete pairs with X, with values that vary on both sides.`,
        };
  }
  const left = yCols.filter((_, i) => !computed.has(i)).map((y) => `“${y.name}”`);
  const v = await evalNamedVector(`${R_RCI};${stmts.join(";")};c(${assigns.join(",")})`);
  const correlations: CorrelationRow[] = yCols.map((y, i) => ({
    variable: y.name,
    r: computed.has(i) ? (v[`r_${i}`] ?? null) : null,
    p: computed.has(i) ? (v[`p_${i}`] ?? null) : null,
    low: computed.has(i) ? (v[`lo_${i}`] ?? null) : null,
    high: computed.has(i) ? (v[`hi_${i}`] ?? null) : null,
  }));
  const { groups: described } = await describe([
    xCol,
    ...yCols.map((y) => ({ name: y.name, values: y.columns.flatMap((c) => c.values) })),
  ]);
  return {
    testType: "correlation",
    subtitle: `${methodLabel} correlation`,
    stats: [],
    groups: described,
    notes:
      (method === "spearman"
        ? "Spearman rank correlation between X and each Y data set; non-parametric, no linearity assumption."
        : "Pearson correlation between X and each Y data set; assumes a linear relationship.") +
      (left.length
        ? ` Not computed for ${left.join(", ")}: fewer than ${MIN_PAIRS} points, or values all identical.`
        : ""),
    correlations,
  };
}
