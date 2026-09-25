// Repeated-measures one-way ANOVA — compares the means of three or more
// matched groups, blocking on subject. Parametric counterpart to the
// Friedman test, resolved by the same "Compare more than two matched
// groups" wizard that asks Gaussian?. Optionally follows up, as Prism does,
// with Tukey or Bonferroni comparisons of every pair of groups, based on the
// ANOVA's own residual mean square.
import type { AnovaParams } from "../types";
import { buildComparisons, groupsSetup, pairedGroups, pairIndices, pRow, type ColumnTestSpec } from "./base";

export const rmAnovaSpec: ColumnTestSpec<AnovaParams> = {
  testType: "rm-anova",
  minGroups: 3,
  parseGroups: (columns) => pairedGroups(columns),
  rCode: (groups, params) => {
    const k = groups.length;
    const n = groups[0]?.values.length ?? 0;
    const setup = groupsSetup(groups);
    const subj = `subj<-factor(rep(1:${n},${k}))`;
    // Rows: gr (effect of interest), subj (blocking factor), Residuals — in that order.
    const a = `a<-summary(aov(v~gr+subj))[[1]];mse<-a$"Mean Sq"[3];dfr<-a$Df[3];m<-tapply(v,gr,mean)`;
    const main = `F=a$"F value"[1],dfn=a$Df[1],dfd=a$Df[3],p=a$"Pr(>F)"[1],eta2=a$"Sum Sq"[1]/sum(a$"Sum Sq")`;
    const posthoc = params?.posthoc ?? "none";
    if (posthoc === "none") return `${setup};${subj};${a};c(${main})`;
    const pairs = pairIndices(k);
    const p = (i: number, j: number) => {
      const diff = `abs(m[[${i + 1}]]-m[[${j + 1}]])`;
      return posthoc === "tukey"
        ? `p_${i}_${j}=1-ptukey(${diff}/sqrt(mse/${n}),${k},dfr)`
        : `p_${i}_${j}=pmin(1,${pairs.length}*2*pt(-${diff}/sqrt(2*mse/${n}),dfr))`;
    };
    return `${setup};${subj};${a};c(${main},${pairs.map(([i, j]) => p(i, j)).join(",")})`;
  },
  rows: (v) => [
    { label: "F", value: v.F },
    { label: "DFn", value: v.dfn },
    { label: "DFd", value: v.dfd },
    pRow("P value", v.p),
    { label: "R squared (eta squared)", value: v.eta2 },
  ],
  comparisons: (v, groups, params) =>
    params?.posthoc && params.posthoc !== "none" ? buildComparisons(groups, (i, j) => v[`p_${i}_${j}`]) : undefined,
  comparisonsLabel: (params) =>
    params?.posthoc === "tukey"
      ? "Tukey's multiple comparisons test"
      : params?.posthoc === "bonferroni"
        ? "Bonferroni-corrected multiple comparisons"
        : undefined,
  notes:
    "Compares means across matched groups, blocking on subject; assumes normal distributions. " +
    "Requires complete rows (every subject measured in every group).",
  subtitle: () => "Repeated-measures one-way ANOVA",
};
