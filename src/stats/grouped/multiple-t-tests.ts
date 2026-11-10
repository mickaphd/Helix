// Multiple t tests (Prism-style): a t test (or Wilcoxon/Mann-Whitney) at every
// row position between a Grouped table's exactly-2 column-groups, corrected for
// multiplicity across rows. Reuses the comparisons table (group1 = row label,
// group2 left blank — the fixed group pair is stated once in comparisonsLabel).
// `paired` pairs replicate columns by position between the 2 groups (needs
// column-identity alignment, unlike the independent per-row filtering `groupRows`
// does for the unpaired case). `pooledSd` (parametric only) assumes one shared SD
// across every row (pooled residual variance, like a single-error-term ANOVA)
// instead of each row estimating its own. Everything, the correction across rows too,
// is computed by R.
import type { AnalysisOutcome, Column, MultipleTTestsParams } from "../types";
import { describe, rBool, rVec } from "../column/base";
import { evalNamedVector } from "../webr";
import { groupRows, pairedGroupRows, rowName } from "./base";

const CORRECTION_LABEL: Record<MultipleTTestsParams["correction"], string> = {
  holm: "Holm-corrected",
  fdr: "FDR-corrected (Benjamini-Hochberg)",
  none: "uncorrected",
};

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

  // Each row's test, its difference of means, then the P values corrected across rows, all
  // in R. Pooled: one SD across every row (a single error term), each row's t on it.
  const a = (r: number) => rVec(rowsA[r]);
  const b = (r: number) => rVec(rowsB[r]);
  const test = (r: number) =>
    params.gaussian
      ? `t.test(${a(r)},${b(r)},paired=${rBool(params.paired)})$p.value`
      : // wilcox.test warns of ties: the warning is the call's, so it wraps the call.
        `suppressWarnings(wilcox.test(${a(r)},${b(r)},paired=${rBool(params.paired)}))$p.value`;
  const pooled = params.gaussian && params.pooledSd;
  const rowsR = `A<-list(${testable.map(a).join(",")});B<-list(${testable.map(b).join(",")})`;
  const raw = pooled
    ? `${rowsR};D<-if(${rBool(params.paired)})mapply(function(x,y)x-y,A,B,SIMPLIFY=FALSE) else NULL
ss<-if(is.null(D))sum(mapply(function(x,y)sum((x-mean(x))^2)+sum((y-mean(y))^2),A,B)) else sum(sapply(D,function(d)sum((d-mean(d))^2)))
dfp<-if(is.null(D))sum(lengths(A)+lengths(B)-2) else sum(lengths(D)-1)
se2<-if(is.null(D))1/lengths(A)+1/lengths(B) else 1/lengths(D)
pr<-2*pt(-abs(mapply(function(x,y)mean(x)-mean(y),A,B)/sqrt(ss/dfp*se2)),dfp)`
    : `pr<-c(${testable.map(test).join(",")})`;
  const v = await evalNamedVector(
    `${raw}
pa<-p.adjust(pr,"${params.correction === "fdr" ? "BH" : params.correction}")
` +
      `c(${testable.map((r, i) => `p_${i}=pa[${i + 1}],d_${i}=mean(${a(r)})-mean(${b(r)})`).join(",")},sig=sum(pa<0.05,na.rm=TRUE))`,
  );
  if (pooled && v.p_0 == null && testable.length) {
    return { error: "Not enough replicate values to pool a shared SD across rows." };
  }

  const comparisons = testable.map((r, i) => ({
    group1: rowName(titles, r),
    group2: "",
    diff: v[`d_${i}`] ?? null,
    p: v[`p_${i}`] ?? null,
  }));
  const testLabel = params.gaussian
    ? params.paired
      ? `Paired t test${params.pooledSd ? " (pooled SD across rows)" : ""}`
      : params.pooledSd
        ? "Unpaired t test (pooled SD across rows)"
        : "Welch's t test (no equal-SD assumption)"
    : `${params.paired ? "Wilcoxon signed-rank" : "Mann-Whitney"} test`;
  return {
    testType: "multiple-t-tests",
    subtitle: params.gaussian
      ? "Multiple t tests"
      : `Multiple ${params.paired ? "Wilcoxon signed-rank" : "Mann-Whitney"} tests`,
    stats: [
      { label: "Rows compared", value: testable.length },
      { label: "Significant rows (P < 0.05)", value: v.sig ?? null },
    ],
    groups: (
      await describe([
        { name: name1, values: rowsA.flat() },
        { name: name2, values: rowsB.flat() },
      ])
    ).groups,
    notes: `${testLabel} at each row, ${CORRECTION_LABEL[params.correction]} across rows.`,
    comparisons,
    comparisonsLabel: `Per-row comparisons (${name1} vs. ${name2})`,
  };
}
