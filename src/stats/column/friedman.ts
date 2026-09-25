// Friedman test — non-parametric alternative to repeated-measures ANOVA for
// ≥3 matched groups. Unlike Prism (which refuses the test on any missing value),
// Helix leaves incomplete rows out and says how many. Optionally follows up with Dunn's test between every pair of groups
// (pairwise z-tests on within-block ranks, Bonferroni-corrected).
import type { FriedmanParams } from "../types";
import { buildComparisons, declareGroups, dunnPosthocStatements, pairedGroups, pRow, type ColumnTestSpec } from "./base";

const DEFAULTS: FriedmanParams = { posthoc: "none" };

export const friedmanSpec: ColumnTestSpec<FriedmanParams> = {
  testType: "friedman",
  minGroups: 3,
  parseGroups: (columns) => pairedGroups(columns),
  rCode: (groups, params) => {
    const k = groups.length;
    const n = groups[0]?.values.length ?? 0;
    const setup = `${declareGroups(groups)};M<-cbind(${groups.map((_, i) => `g${i}`).join(",")});f<-friedman.test(M)`;
    const mainNames = "Q=unname(f$statistic),df=unname(f$parameter),p=f$p.value";
    if ((params ?? DEFAULTS).posthoc === "none") return `${setup};c(${mainNames})`;
    // Dunn's test on within-block (row) ranks — constant SE since every block has the same k groups.
    const rbarSetup = `${setup};Rm<-t(apply(M,1,rank));Rbar<-colMeans(Rm);names(Rbar)<-paste0("G",1:${k})`;
    const ph = dunnPosthocStatements(k, rbarSetup, () => `sqrt(${k}*(${k}+1)/(6*${n}))`);
    return `${ph.setup};c(${mainNames},${ph.assign})`;
  },
  rows: (v) => [
    { label: "Friedman statistic (Q)", value: v.Q },
    { label: "df", value: v.df },
    pRow("P value", v.p),
  ],
  comparisons: (v, groups, params) => {
    if ((params ?? DEFAULTS).posthoc === "none") return undefined;
    return buildComparisons(groups, (i, j) => v[`p_${i}_${j}`]);
  },
  comparisonsLabel: (params) =>
    (params ?? DEFAULTS).posthoc === "dunn" ? "Dunn's multiple comparisons test (Bonferroni-corrected)" : undefined,
  notes: (_params, groups, columns) => {
    const totalRows = columns[0]?.cells.length ?? 0;
    const usedRows = groups[0]?.values.length ?? 0;
    const dropped = totalRows - usedRows;
    const base = "Non-parametric alternative to repeated-measures ANOVA for ≥3 matched groups; no normality assumption.";
    if (dropped <= 0) return `${base} Requires complete rows (every subject measured in every group).`;
    return (
      `${base} ${dropped} row${dropped === 1 ? "" : "s"} excluded because of missing data ` +
      "(only rows with every group measured are included)."
    );
  },
  subtitle: () => "Friedman test",
};
