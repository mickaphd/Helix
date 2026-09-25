// "Compare one group to a value" — tests whether each column differs from a
// user-chosen hypothetical value. Resolves to a one-sample t test (parametric)
// or a Wilcoxon signed-rank test (non-parametric), Prism-wizard style.
import type { OneSampleTParams } from "../types";
import { declareGroups, pRow, rAlt, type ColumnTestSpec } from "./base";

const DEFAULTS: OneSampleTParams = { hypotheticalValue: 0, tails: "two-sided", gaussian: true };

export const oneSampleTSpec: ColumnTestSpec<OneSampleTParams> = {
  testType: "one-sample-t",
  minGroups: 1,
  rCode: (groups, params) => {
    const p = { ...DEFAULTS, ...params };
    const alt = rAlt(p.tails);
    const decl = declareGroups(groups);
    if (!p.gaussian) {
      const stmts = groups.map(
        (_, i) => `wt${i}<-suppressWarnings(wilcox.test(g${i},mu=${p.hypotheticalValue},alternative="${alt}"))`,
      );
      const vals = groups.map((_, i) => `V${i}=unname(wt${i}$statistic),p${i}=wt${i}$p.value`);
      return `${decl};${stmts.join(";")};c(${vals.join(",")})`;
    }
    const stmts = groups.map((_, i) => `tt${i}<-t.test(g${i},mu=${p.hypotheticalValue},alternative="${alt}")`);
    const vals = groups.map(
      (_, i) =>
        `t${i}=unname(tt${i}$statistic),df${i}=unname(tt${i}$parameter),p${i}=tt${i}$p.value,` +
        `md${i}=unname(tt${i}$estimate)-${p.hypotheticalValue},ci_lo${i}=tt${i}$conf.int[1],ci_hi${i}=tt${i}$conf.int[2]`,
    );
    return `${decl};${stmts.join(";")};c(${vals.join(",")})`;
  },
  rows: (v, groups, params) => {
    const p = { ...DEFAULTS, ...params };
    if (!p.gaussian) {
      return groups.flatMap((g, i) => [
        { label: `${g.name} — Test statistic (V)`, value: v[`V${i}`] },
        pRow(`${g.name} — P value`, v[`p${i}`]),
        { label: `${g.name} — Median vs. hypothetical`, value: g.median != null ? g.median - p.hypotheticalValue : null },
      ]);
    }
    return groups.flatMap((g, i) => [
      { label: `${g.name} — t`, value: v[`t${i}`] },
      { label: `${g.name} — df`, value: v[`df${i}`] },
      pRow(`${g.name} — P value`, v[`p${i}`]),
      { label: `${g.name} — Mean vs. hypothetical`, value: v[`md${i}`] },
      { label: `${g.name} — 95% CI lower`, value: v[`ci_lo${i}`] },
      { label: `${g.name} — 95% CI upper`, value: v[`ci_hi${i}`] },
    ]);
  },
  notes: (params) => {
    const p = { ...DEFAULTS, ...params };
    const tail = p.tails === "two-sided" ? "Two-tailed P value." : "One-tailed P value.";
    if (!p.gaussian) {
      return `Non-parametric: tests whether each column's median differs from the hypothetical value ${p.hypotheticalValue}, with no normality assumption. ${tail}`;
    }
    return `Tests whether each column's mean differs from the hypothetical value ${p.hypotheticalValue}. Assumes normally distributed data. ${tail}`;
  },
  subtitle: (params) => {
    const p = { ...DEFAULTS, ...params };
    return p.gaussian
      ? `One-sample t test (H0: mean = ${p.hypotheticalValue})`
      : `Wilcoxon signed-rank test (H0: median = ${p.hypotheticalValue})`;
  },
};
