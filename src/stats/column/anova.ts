// One-way ANOVA — compares the means of three or more groups. Reports F, the
// two degrees of freedom, the P value, and R² (eta², effect size). Optionally
// follows up with pairwise post-hoc comparisons between every pair of groups.
import type { AnovaParams } from "../types";
import {
  buildComparisons,
  groupsSetup,
  pairwisePosthocStatements,
  pRow,
  tukeyPosthocStatements,
  type ColumnTestSpec,
} from "./base";

const DEFAULTS: AnovaParams = { posthoc: "none" };

function posthocLabel(method: AnovaParams["posthoc"]): string | undefined {
  switch (method) {
    case "tukey":
      return "Tukey's multiple comparisons test";
    case "bonferroni":
      return "Bonferroni-corrected multiple comparisons";
    default:
      return undefined;
  }
}

export const anovaSpec: ColumnTestSpec<AnovaParams> = {
  testType: "anova",
  minGroups: 3,
  rCode: (groups, params) => {
    const method = (params ?? DEFAULTS).posthoc;
    const setup = `${groupsSetup(groups)};a<-summary(aov(v~gr))[[1]]`;
    const mainNames =
      `F=a$"F value"[1],dfn=a$Df[1],dfd=a$Df[2],p=a$"Pr(>F)"[1],` + `eta2=a$"Sum Sq"[1]/sum(a$"Sum Sq")`;
    if (method === "none") return `${setup};c(${mainNames})`;
    const ph =
      method === "tukey"
        ? tukeyPosthocStatements(groups.length)
        : pairwisePosthocStatements(groups.length, `pairwise.t.test(v,gr,p.adjust.method="bonferroni")$p.value`);
    return `${setup};${ph.setup};c(${mainNames},${ph.assign})`;
  },
  rows: (v) => [
    { label: "F", value: v.F },
    { label: "DFn", value: v.dfn },
    { label: "DFd", value: v.dfd },
    pRow("P value", v.p),
    { label: "R squared (eta squared)", value: v.eta2 },
  ],
  comparisons: (v, groups, params) => {
    const method = (params ?? DEFAULTS).posthoc;
    if (method === "none") return undefined;
    return buildComparisons(groups, (i, j) => v[`p_${i}_${j}`]);
  },
  comparisonsLabel: (params) => posthocLabel((params ?? DEFAULTS).posthoc),
  notes: "Compares means across groups; assumes normal distributions with equal variances.",
};
