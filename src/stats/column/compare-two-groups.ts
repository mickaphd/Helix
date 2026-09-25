// Compare two groups — one wizard-driven test that resolves to Student's t,
// Welch's t, a paired t test, Mann-Whitney, or Wilcoxon signed-rank, based on
// `paired` / `gaussian` / `equalVariance` / `tails`. Mirrors GraphPad Prism's
// cascade of questions instead of listing every variant as its own test.
import type { CompareTwoGroupsParams, StatRow } from "../types";
import { dataGroups, declareGroups, pairedGroups, pRow, rAlt, rBool, type ColumnTestSpec, type Group } from "./base";

const DEFAULTS: CompareTwoGroupsParams = {
  paired: false,
  gaussian: true,
  equalVariance: true,
  ratio: false,
  tails: "two-sided",
};

function subtitle(p: CompareTwoGroupsParams): string {
  if (!p.gaussian) return p.paired ? "Wilcoxon matched-pairs signed rank test" : "Mann-Whitney test";
  if (p.paired) return p.ratio ? "Ratio paired t test" : "Paired t test";
  return p.equalVariance ? "Unpaired t test" : "Welch's t test";
}

function notes(p: CompareTwoGroupsParams): string {
  const tail = p.tails === "two-sided" ? "Two-tailed P value." : "One-tailed P value.";
  if (!p.gaussian) {
    return p.paired
      ? `Non-parametric: no normality assumption on the paired differences. ${tail}`
      : `Non-parametric: no normality assumption. Uses a normal approximation when ties are present. ${tail}`;
  }
  if (p.paired) {
    return p.ratio
      ? `Compares the ratio between pairs (log-transformed) instead of the difference — for data ` +
          `where a proportional change is more meaningful. Assumes the ratios are log-normally distributed. ${tail}`
      : `Assumes the paired differences are sampled from a normal distribution. ${tail}`;
  }
  return p.equalVariance
    ? `Assumes both groups are sampled from normal distributions with equal variances. ${tail}`
    : `Assumes normal distributions but allows unequal variances (Welch–Satterthwaite df). ${tail}`;
}

function rCode(groups: Group[], p: CompareTwoGroupsParams): string {
  const decl = declareGroups(groups);
  const alt = `alternative="${rAlt(p.tails)}"`;
  if (!p.gaussian) {
    return (
      `${decl};w<-suppressWarnings(wilcox.test(g0,g1,paired=${rBool(p.paired)},${alt},conf.int=TRUE));` +
      (p.paired
        ? `c(W=unname(w$statistic),p=w$p.value,hl=unname(w$estimate))`
        : `ra<-rank(c(g0,g1));sa<-sum(ra[seq_along(g0)]);` +
          `c(W=unname(w$statistic),p=w$p.value,hl=unname(w$estimate),sa=sa,sb=sum(ra)-sa)`)
    );
  }
  if (p.paired && p.ratio) {
    return (
      `${decl};lr<-log(g0/g1);tt<-t.test(lr,${alt});` +
      `c(t=unname(tt$statistic),df=unname(tt$parameter),p=tt$p.value,` +
      `gmr=exp(unname(tt$estimate)),ci_lo=exp(tt$conf.int[1]),ci_hi=exp(tt$conf.int[2]))`
    );
  }
  if (p.paired) {
    return (
      `${decl};tt<-t.test(g0,g1,paired=TRUE,${alt});` +
      `c(t=unname(tt$statistic),df=unname(tt$parameter),p=tt$p.value,` +
      `md=unname(tt$estimate),ci_lo=tt$conf.int[1],ci_hi=tt$conf.int[2],` +
      `r2=unname(tt$statistic^2/(tt$statistic^2+tt$parameter)))`
    );
  }
  return (
    `${decl};tt<-t.test(g0,g1,var.equal=${rBool(p.equalVariance)},${alt});vt<-var.test(g0,g1);` +
    `c(t=unname(tt$statistic),df=unname(tt$parameter),p=tt$p.value,` +
    `md=unname(tt$estimate[1]-tt$estimate[2]),ci_lo=tt$conf.int[1],ci_hi=tt$conf.int[2],` +
    `r2=unname(tt$statistic^2/(tt$statistic^2+tt$parameter)),` +
    `F=unname(vt$statistic),Fdfn=unname(vt$parameter[1]),Fdfd=unname(vt$parameter[2]),Fp=vt$p.value)`
  );
}

function medianDiff(groups: { median: number | null }[]): number | null {
  const [a, b] = groups;
  return a.median != null && b.median != null ? a.median - b.median : null;
}

export const compareTwoGroupsSpec: ColumnTestSpec<CompareTwoGroupsParams> = {
  testType: "compare-two-groups",
  minGroups: 2,
  maxGroups: 2,
  // The first two columns holding data; paired, only rows where both have a value.
  parseGroups: (columns, params) =>
    (params ?? DEFAULTS).paired ? pairedGroups(dataGroups(columns).slice(0, 2)) : dataGroups(columns),
  rCode: (groups, params) => rCode(groups, params ?? DEFAULTS),
  rows: (v, groups, params) => {
    const p = params ?? DEFAULTS;
    if (!p.gaussian) {
      const rows: StatRow[] = [
        { label: "Test statistic", value: v.W },
        pRow("P value", v.p),
        { label: "Median difference", value: medianDiff(groups) },
        { label: "Hodges-Lehmann difference", value: v.hl },
      ];
      if (!p.paired) {
        rows.splice(2, 0, { label: `Sum of ranks (${groups[0].name})`, value: v.sa }, {
          label: `Sum of ranks (${groups[1].name})`,
          value: v.sb,
        });
      }
      return rows;
    }
    if (p.paired && p.ratio) {
      return [
        { label: "t", value: v.t },
        { label: "df", value: v.df },
        pRow("P value", v.p),
        { label: "Geometric mean ratio", value: v.gmr },
        { label: "95% CI lower", value: v.ci_lo },
        { label: "95% CI upper", value: v.ci_hi },
      ];
    }
    const rows: StatRow[] = [
      { label: "t", value: v.t },
      { label: "df", value: v.df },
      pRow("P value", v.p),
      { label: p.paired ? "Mean of differences" : "Mean difference", value: v.md },
      { label: "95% CI lower", value: v.ci_lo },
      { label: "95% CI upper", value: v.ci_hi },
      { label: "R squared", value: v.r2 },
    ];
    if (!p.paired) {
      rows.push(
        { label: "F (variance ratio)", value: v.F },
        { label: "F DFn", value: v.Fdfn },
        { label: "F DFd", value: v.Fdfd },
        pRow("F test P value", v.Fp),
      );
    }
    return rows;
  },
  // Prism compares exactly two data sets: say which two, when the table has more.
  notes: (params, groups, columns) => {
    const ignored = dataGroups(columns).slice(2).map((c) => c.name);
    const which = ignored.length
      ? ` Compares “${groups[0].name}” and “${groups[1].name}”, the first two columns with data; ` +
        `not included: ${ignored.map((n) => `“${n}”`).join(", ")}.`
      : "";
    return notes(params ?? DEFAULTS) + which;
  },
  subtitle: (params) => subtitle(params ?? DEFAULTS),
};
