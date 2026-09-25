// Two-way ANOVA — compares a Grouped table's column-groups (A, B, C…) and row
// position, plus their interaction. `design` picks:
// - "ordinary": independent-samples two-way ANOVA.
// - "repeated-measures": matched by row — each replicate column is treated as
//   one subject, measured at every row within its group (a mixed/split-plot
//   design); computed via `aov(v~g*r+Error(id/r))`, base R's standard formula for
//   this design. Incomplete replicate columns (missing a row) are dropped.
// - "nonparametric": Scheirer-Ray-Hare — rank-transform the response, run the
//   same ANOVA on the ranks, then convert each effect's Sum-of-Squares into a
//   chi-square H statistic — fully computable in base R.
// `posthoc` (parametric designs only) pairwise-compares either groups within
// each row, or rows within each group ("row means"), using the design's own
// pooled residual variance — the same statistic R's own TukeyHSD computes
// internally (q = sqrt(2)*|t|, t from the pooled-MSE two-sample t stat), just
// derived directly instead of relying on TukeyHSD's interaction-term row naming.
import type { AnalysisOutcome, Column, ComparisonRow, TwoWayAnovaParams } from "../types";
import { describe, pairIndices, pRow, rStr, rVec } from "../column/base";
import { evalNamedVector } from "../webr";
import { flattenGrouped, flattenRepeated, groupRows, rowName } from "./base";

// Group/row/subject labels derive from user column names, so they must be escaped
// before interpolation — only their distinctness matters to the model, not their text.
const rFactor = (labels: string[]) => `factor(c(${labels.map(rStr).join(",")}))`;

async function runPosthoc(
  columns: Column[],
  method: "tukey" | "bonferroni",
  target: "groups" | "rows",
  mse: number | null,
  dfResid: number | null,
  titles: (string | null)[],
): Promise<ComparisonRow[] | undefined> {
  if (mse == null || dfResid == null) return undefined;
  const rows = groupRows(columns);
  const names = [...rows.keys()];
  const rowCount = rows.get(names[0])?.length ?? 0;
  const mean = (vs: number[]) => vs.reduce((a, b) => a + b, 0) / vs.length;
  const cells: { label1: string; label2: string; diff: number; t: number }[] = [];
  if (target === "groups") {
    for (let r = 0; r < rowCount; r++) {
      for (const [i, j] of pairIndices(names.length)) {
        const vi = rows.get(names[i])![r];
        const vj = rows.get(names[j])![r];
        if (vi.length === 0 || vj.length === 0) continue;
        const diff = mean(vi) - mean(vj);
        const t = diff / Math.sqrt(mse * (1 / vi.length + 1 / vj.length));
        cells.push({ label1: `${names[i]} (${rowName(titles, r)})`, label2: `${names[j]} (${rowName(titles, r)})`, diff, t });
      }
    }
  } else {
    for (const name of names) {
      const rowsForGroup = rows.get(name)!;
      for (const [i, j] of pairIndices(rowCount)) {
        const vi = rowsForGroup[i];
        const vj = rowsForGroup[j];
        if (vi.length === 0 || vj.length === 0) continue;
        const diff = mean(vi) - mean(vj);
        const t = diff / Math.sqrt(mse * (1 / vi.length + 1 / vj.length));
        cells.push({ label1: `${rowName(titles, i)} (${name})`, label2: `${rowName(titles, j)} (${name})`, diff, t });
      }
    }
  }
  if (cells.length === 0) return undefined;
  const nmeans = names.length * rowCount;
  const m = cells.length;
  const rCode =
    method === "tukey"
      ? `c(${cells.map((c, k) => `p${k}=1-ptukey(${Math.abs(c.t) * Math.SQRT2},${nmeans},${dfResid})`).join(",")})`
      : `c(${cells.map((c, k) => `p${k}=pmin(1,${m}*2*pt(${-Math.abs(c.t)},${dfResid}))`).join(",")})`;
  const v = await evalNamedVector(rCode);
  return cells.map((c, k) => ({ group1: c.label1, group2: c.label2, diff: c.diff, p: v[`p${k}`] ?? null }));
}

async function runRepeatedMeasures(
  columns: Column[],
  params: TwoWayAnovaParams,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  const { values, group, row, subject, dropped } = flattenRepeated(columns);
  if (new Set(group).size < 2 || new Set(row).size < 2 || values.length === 0) {
    return {
      error:
        "Repeated-measures two-way ANOVA needs at least 2 column groups and 2 rows, each with at least one " +
        "replicate column that has a value in every row.",
    };
  }
  const setup = `v<-${rVec(values)};g<-${rFactor(group)};r<-${rFactor(row)};id<-${rFactor(subject)}`;
  const rCode =
    `${setup};a<-summary(aov(v~g*r+Error(id/r)));e1<-a[["Error: id"]][[1]];e2<-a[["Error: id:r"]][[1]];` +
    `c(gS=e1$"F value"[1],gDf=e1$Df[1],gP=e1$"Pr(>F)"[1],gDfResid=e1$Df[2],gMse=e1$"Sum Sq"[2]/e1$Df[2],` +
    `rS=e2$"F value"[1],rDf=e2$Df[1],rP=e2$"Pr(>F)"[1],` +
    `iS=e2$"F value"[2],iDf=e2$Df[2],iP=e2$"Pr(>F)"[2],rDfResid=e2$Df[3],rMse=e2$"Sum Sq"[3]/e2$Df[3])`;

  try {
    const v = await evalNamedVector(rCode);
    const effect = (label: string, s: string, df: string, p: string) => [
      { label: `${label} F`, value: v[s] ?? null },
      { label: `${label} DFn`, value: v[df] ?? null },
      pRow(`${label} P value`, v[p] ?? null),
    ];
    const stats = [...effect("Group", "gS", "gDf", "gP"), ...effect("Row", "rS", "rDf", "rP"), ...effect("Interaction", "iS", "iDf", "iP")];
    const groups = [...new Set(group)].map((name) => describe({ name, values: values.filter((_, i) => group[i] === name) }));
    // Groups (between-subjects) comparisons use the "Error: id" stratum's residual;
    // rows (within-subject) comparisons use the "Error: id:r" stratum's — an
    // approximation of Prism's exact RM multiple-comparisons SE, using each effect's
    // own pooled error term.
    const mse = params.posthocTarget === "groups" ? v.gMse : v.rMse;
    const dfResid = params.posthocTarget === "groups" ? v.gDfResid : v.rDfResid;
    const comparisons =
      params.posthoc !== "none" ? await runPosthoc(columns, params.posthoc, params.posthocTarget, mse ?? null, dfResid ?? null, titles) : undefined;
    return {
      testType: "two-way-anova",
      subtitle: "Repeated-measures two-way ANOVA",
      stats,
      groups,
      notes:
        "Matched by row: each replicate column is treated as the same subject across every row within its group." +
        (dropped > 0
          ? ` ${dropped} replicate column${dropped === 1 ? "" : "s"} excluded (missing a value in at least one row).`
          : ""),
      comparisons,
      comparisonsLabel: comparisons?.length
        ? `${params.posthoc === "tukey" ? "Tukey's" : "Bonferroni-corrected"} multiple comparisons ` +
          (params.posthocTarget === "groups" ? "(groups within each row)" : "(row means within each group)")
        : undefined,
    };
  } catch (err) {
    return { error: `Could not run the test: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function runTwoWayAnova(
  columns: Column[],
  params: TwoWayAnovaParams,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  if (params.design === "repeated-measures") return runRepeatedMeasures(columns, params, titles);

  const { values, group, row } = flattenGrouped(columns);
  if (new Set(group).size < 2 || new Set(row).size < 2) {
    return { error: "Two-way ANOVA needs at least 2 column groups and 2 rows of numeric data." };
  }
  const nonparametric = params.design === "nonparametric";
  const setup = `v<-${rVec(values)};g<-${rFactor(group)};r<-${rFactor(row)}`;
  const rCode = nonparametric
    ? `${setup};a<-summary(aov(rank(v)~g*r))[[1]];ms<-sum(a$"Sum Sq")/(length(v)-1);` +
      `c(gS=a$"Sum Sq"[1]/ms,gDf=a$Df[1],gP=pchisq(a$"Sum Sq"[1]/ms,a$Df[1],lower.tail=FALSE),` +
      `rS=a$"Sum Sq"[2]/ms,rDf=a$Df[2],rP=pchisq(a$"Sum Sq"[2]/ms,a$Df[2],lower.tail=FALSE),` +
      `iS=a$"Sum Sq"[3]/ms,iDf=a$Df[3],iP=pchisq(a$"Sum Sq"[3]/ms,a$Df[3],lower.tail=FALSE))`
    : // Type III sums of squares (matches GraphPad Prism on unbalanced designs; on
      // balanced designs Type I = II = III, so nothing changes there). Base-R recipe:
      // sum-to-zero contrasts on the factors + drop1 over the full scope. Contrasts are
      // set on the factor objects (NOT global options()) so no other analysis is affected.
      `${setup};contrasts(g)<-"contr.sum";contrasts(r)<-"contr.sum";` +
      `f<-aov(v~g*r);a<-drop1(f,~.,test="F");dfr<-df.residual(f);mse<-deviance(f)/dfr;` +
      `c(gS=a$"F value"[2],gDf=a$Df[2],gP=a$"Pr(>F)"[2],` +
      `rS=a$"F value"[3],rDf=a$Df[3],rP=a$"Pr(>F)"[3],` +
      `iS=a$"F value"[4],iDf=a$Df[4],iP=a$"Pr(>F)"[4],dfResid=dfr,mse=mse)`;

  try {
    const v = await evalNamedVector(rCode);
    const stat = nonparametric ? "H" : "F";
    const effect = (label: string, s: string, df: string, p: string) => [
      { label: `${label} ${stat}`, value: v[s] ?? null },
      { label: `${label} DFn`, value: v[df] ?? null },
      pRow(`${label} P value`, v[p] ?? null),
    ];
    const stats = [
      ...effect("Group", "gS", "gDf", "gP"),
      ...effect("Row", "rS", "rDf", "rP"),
      ...effect("Interaction", "iS", "iDf", "iP"),
      ...(nonparametric ? [] : [{ label: "DFd (residual)", value: v.dfResid ?? null }]),
    ];
    const groups = [...new Set(group)].map((name) =>
      describe({ name, values: values.filter((_, i) => group[i] === name) }),
    );
    const comparisons =
      !nonparametric && params.posthoc !== "none"
        ? await runPosthoc(columns, params.posthoc, params.posthocTarget, v.mse, v.dfResid, titles)
        : undefined;
    return {
      testType: "two-way-anova",
      subtitle: nonparametric ? "Scheirer-Ray-Hare test" : "Ordinary two-way ANOVA",
      stats,
      groups,
      notes: nonparametric
        ? "Non-parametric two-way analysis (rank-based); no normality assumption."
        : "Compares group and row-position effects, plus their interaction; assumes normal distributions with equal variances (Type III sums of squares).",
      comparisons,
      comparisonsLabel: comparisons?.length
        ? `${params.posthoc === "tukey" ? "Tukey's" : "Bonferroni-corrected"} multiple comparisons ` +
          (params.posthocTarget === "groups" ? "(groups within each row)" : "(row means within each group)")
        : undefined,
    };
  } catch (err) {
    return { error: `Could not run the test: ${err instanceof Error ? err.message : String(err)}` };
  }
}
