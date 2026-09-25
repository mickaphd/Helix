// Kruskal-Wallis test — non-parametric one-way comparison of three or more
// groups. Optionally follows up with Dunn's test between every pair of
// groups (pairwise z-tests on global mean ranks, tie-corrected, Bonferroni-corrected).
import type { KruskalWallisParams } from "../types";
import { buildComparisons, dunnPosthocStatements, groupsSetup, pRow, type ColumnTestSpec } from "./base";

const DEFAULTS: KruskalWallisParams = { posthoc: "none" };

export const kruskalWallisSpec: ColumnTestSpec<KruskalWallisParams> = {
  testType: "kruskal-wallis",
  minGroups: 3,
  rCode: (groups, params) => {
    const method = (params ?? DEFAULTS).posthoc;
    const setup = `${groupsSetup(groups)};k<-kruskal.test(v,gr)`;
    const mainNames = "H=unname(k$statistic),df=unname(k$parameter),p=k$p.value";
    if (method === "none") return `${setup};c(${mainNames})`;
    const rbarSetup =
      `${setup};r<-rank(v);Rbar<-tapply(r,gr,mean);N<-length(v);tab<-table(v);` +
      `tiecorr<-sum(tab^3-tab)/(12*(N-1))`;
    const ph = dunnPosthocStatements(
      groups.length,
      rbarSetup,
      (i, j) => `sqrt((N*(N+1)/12-tiecorr)*(1/${groups[i].values.length}+1/${groups[j].values.length}))`,
    );
    return `${ph.setup};c(${mainNames},${ph.assign})`;
  },
  rows: (v) => [
    { label: "Kruskal-Wallis H", value: v.H },
    { label: "df", value: v.df },
    pRow("P value", v.p),
  ],
  comparisons: (v, groups, params) => {
    if ((params ?? DEFAULTS).posthoc === "none") return undefined;
    return buildComparisons(groups, (i, j) => v[`p_${i}_${j}`]);
  },
  comparisonsLabel: (params) =>
    (params ?? DEFAULTS).posthoc === "dunn" ? "Dunn's multiple comparisons test (Bonferroni-corrected)" : undefined,
  notes: "Non-parametric alternative to one-way ANOVA; no normality assumption.",
};
