// "Compare one group to a value" — tests whether each column differs from a
// user-chosen hypothetical value. Resolves to a one-sample t test (parametric), its
// lognormal form (the geometric mean: a t test of the logarithms against the value's),
// or a Wilcoxon signed-rank test (non-parametric), Prism-wizard style.
import type { OneSampleTParams } from "../types";
import { ciRows, declareGroups, identical, pRow, R_DIFF, R_HEDGES, rAlt, type ColumnTestSpec } from "./base";

const DEFAULTS: OneSampleTParams = { hypotheticalValue: 0, tails: "two-sided", gaussian: true };

export const oneSampleTSpec: ColumnTestSpec<OneSampleTParams> = {
  testType: "one-sample-t",
  minGroups: 1,
  minValues: 2,
  check: (_, params) => {
    const p = { ...DEFAULTS, ...params };
    if (p.gaussian && p.lognormal && !(p.hypotheticalValue > 0))
      return `A geometric mean is compared to a value above 0, not ${p.hypotheticalValue}.`;
  },
  checkGroups: (groups, params) => {
    const p = { ...DEFAULTS, ...params };
    for (const g of groups) {
      const nonPositive = p.gaussian && p.lognormal ? g.values.find((v) => v <= 0) : undefined;
      if (nonPositive !== undefined)
        return `The lognormal t test needs values above 0; “${g.name}” holds ${nonPositive}.`;
      if (p.gaussian && identical(g.values))
        return `“${g.name}”'s values are all identical: the one-sample t test needs some scatter.`;
      if (!p.gaussian && g.values.every((v) => v === p.hypotheticalValue))
        return `Every value of “${g.name}” equals ${p.hypotheticalValue}: the Wilcoxon test has no difference to rank.`;
    }
  },
  rCode: (groups, params) => {
    const p = { ...DEFAULTS, ...params };
    const alt = rAlt(p.tails);
    const decl = declareGroups(groups);
    if (!p.gaussian) {
      const stmts = groups.map(
        (_, i) => `wt${i}<-suppressWarnings(wilcox.test(dif(g${i},${p.hypotheticalValue}),alternative="${alt}"))`,
      );
      const vals = groups.map(
        (_, i) => `V${i}=unname(wt${i}$statistic),p${i}=wt${i}$p.value,mh${i}=median(g${i})-${p.hypotheticalValue}`,
      );
      return `${decl};${R_DIFF};${stmts.join(";")};c(${vals.join(",")})`;
    }
    if (p.lognormal) {
      const stmts = groups.map(
        (_, i) => `tt${i}<-t.test(log(g${i}),mu=log(${p.hypotheticalValue}),alternative="${alt}")`,
      );
      const vals = groups.map(
        (_, i) =>
          `t${i}=unname(tt${i}$statistic),df${i}=unname(tt${i}$parameter),p${i}=tt${i}$p.value,` +
          `gm${i}=exp(unname(tt${i}$estimate)),ci_lo${i}=exp(tt${i}$conf.int[1]),ci_hi${i}=exp(tt${i}$conf.int[2])`,
      );
      return `${decl};${stmts.join(";")};c(${vals.join(",")})`;
    }
    const stmts = groups.map((_, i) => `tt${i}<-t.test(g${i},mu=${p.hypotheticalValue},alternative="${alt}")`);
    const vals = groups.map(
      (_, i) =>
        `t${i}=unname(tt${i}$statistic),df${i}=unname(tt${i}$parameter),p${i}=tt${i}$p.value,` +
        `md${i}=unname(tt${i}$estimate)-${p.hypotheticalValue},ci_lo${i}=tt${i}$conf.int[1],ci_hi${i}=tt${i}$conf.int[2],` +
        // Effect size: the distance to the hypothetical value in SDs.
        `d${i}=(mean(g${i})-${p.hypotheticalValue})/sd(g${i}),` +
        `g${i}=(mean(g${i})-${p.hypotheticalValue})/sd(g${i})*J(length(g${i})-1)`,
    );
    return `${decl};${R_HEDGES};${stmts.join(";")};c(${vals.join(",")})`;
  },
  rows: (v, groups, params) => {
    const p = { ...DEFAULTS, ...params };
    if (!p.gaussian) {
      return groups.flatMap((g, i) => [
        { label: `${g.name} — Test statistic (V)`, value: v[`V${i}`] },
        pRow(`${g.name} — P value`, v[`p${i}`]),
        { label: `${g.name} — Median vs. hypothetical`, value: v[`mh${i}`] },
      ]);
    }
    if (p.lognormal)
      return groups.flatMap((g, i) => [
        { label: `${g.name} — t`, value: v[`t${i}`] },
        { label: `${g.name} — df`, value: v[`df${i}`] },
        pRow(`${g.name} — P value`, v[`p${i}`]),
        { label: `${g.name} — Geometric mean`, value: v[`gm${i}`] },
        ...ciRows(p.tails, v[`ci_lo${i}`], v[`ci_hi${i}`], `${g.name} — Geometric mean `, true),
      ]);
    return groups.flatMap((g, i) => [
      { label: `${g.name} — t`, value: v[`t${i}`] },
      { label: `${g.name} — df`, value: v[`df${i}`] },
      pRow(`${g.name} — P value`, v[`p${i}`]),
      { label: `${g.name} — Mean vs. hypothetical`, value: v[`md${i}`] },
      ...ciRows(p.tails, v[`ci_lo${i}`], v[`ci_hi${i}`], `${g.name} — `),
      { label: `${g.name} — Cohen's d`, value: v[`d${i}`] },
      { label: `${g.name} — Hedges' g`, value: v[`g${i}`] },
    ]);
  },
  notes: (params) => {
    const p = { ...DEFAULTS, ...params };
    const tail = p.tails === "two-sided" ? "Two-tailed P value." : "One-tailed P value.";
    if (!p.gaussian) {
      return `Non-parametric: tests whether each column's median differs from the hypothetical value ${p.hypotheticalValue}, with no normality assumption. ${tail}`;
    }
    if (p.lognormal)
      return `Tests whether each column's geometric mean differs from the hypothetical value ${p.hypotheticalValue}: a t test of the logarithms against log(${p.hypotheticalValue}). Assumes lognormally distributed data. ${tail}`;
    return `Tests whether each column's mean differs from the hypothetical value ${p.hypotheticalValue}. Assumes normally distributed data. ${tail}`;
  },
  subtitle: (params) => {
    const p = { ...DEFAULTS, ...params };
    if (p.gaussian && p.lognormal) return `Lognormal one-sample t test (H0: geometric mean = ${p.hypotheticalValue})`;
    return p.gaussian
      ? `One-sample t test (H0: mean = ${p.hypotheticalValue})`
      : `Wilcoxon signed-rank test (H0: median = ${p.hypotheticalValue})`;
  },
};
