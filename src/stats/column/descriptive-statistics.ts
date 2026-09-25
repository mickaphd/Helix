// "Descriptive statistics" (Prism's Column statistics) — a per-column summary:
// N, mean, SD, SEM, median, and the 95% confidence interval of the mean. Not an
// inferential test, so there are no `stats` rows; the CI half-width uses R's
// exact t quantile (qt), everything else reuses the shared JS `describe`.
import type { AnalysisOutcome, Column, GroupDescriptives } from "../types";
import { dataGroups, describe } from "./base";
import { evalNamedVector } from "../webr";

export async function runDescriptiveStatistics(columns: Column[]): Promise<AnalysisOutcome> {
  const groups = dataGroups(columns);
  if (groups.length < 1) {
    return { error: "This needs at least 1 column containing numeric data." };
  }
  const described = groups.map(describe);
  try {
    // 95% two-sided t multiplier per group; groups with n < 2 have no CI (NA → null).
    const code = `c(${described.map((g, i) => `t${i}=${g.n > 1 ? `qt(0.975,${g.n - 1})` : "NA"}`).join(",")})`;
    const t = await evalNamedVector(code);
    const withExtras: GroupDescriptives[] = described.map((g, i) => {
      const mult = t[`t${i}`];
      const half = g.mean != null && g.sem != null && mult != null ? mult * g.sem : null;
      // Min/Max/Range come straight from the parsed values (no R round-trip needed).
      const vals = groups[i].values;
      const min = vals.length ? vals.reduce((a, b) => Math.min(a, b)) : null;
      const max = vals.length ? vals.reduce((a, b) => Math.max(a, b)) : null;
      return {
        ...g,
        ciLow: half != null && g.mean != null ? g.mean - half : null,
        ciHigh: half != null && g.mean != null ? g.mean + half : null,
        min,
        max,
        range: min != null && max != null ? max - min : null,
      };
    });
    return {
      testType: "descriptive-statistics",
      stats: [],
      groups: withExtras,
      notes:
        "Per-column summary. Range is Max − Min. 95% CI is the t-based confidence interval of the mean; " +
        "columns with fewer than 2 values have no SD, SEM, or CI.",
    };
  } catch (err) {
    return { error: `Could not compute descriptive statistics: ${err instanceof Error ? err.message : String(err)}` };
  }
}
