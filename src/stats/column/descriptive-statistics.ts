// "Descriptive statistics" (Prism's Column statistics) — a per-column summary, computed by
// R: N, mean, SD, SEM, median, the 95% confidence interval of the mean (t-based), and the
// minimum, maximum and range. Not an inferential test, so there are no `stats` rows.
import type { AnalysisOutcome, Column } from "../types";
import { dataGroups, R_DESCRIBE, rVec } from "./base";
import { evalNamedVector } from "../webr";

export async function runDescriptiveStatistics(columns: Column[]): Promise<AnalysisOutcome> {
  const groups = dataGroups(columns);
  if (groups.length < 1) {
    return { error: "This needs at least 1 column containing numeric data." };
  }
  // Each column's descriptives, then its CI (none under 2 values), minimum, maximum and range.
  const v = await evalNamedVector(
    `G<-list(${groups.map((g) => rVec(g.values)).join(",")});c(${R_DESCRIBE},` +
      "unlist(lapply(seq_along(G),function(i){x<-G[[i]];n<-length(x);h<-if(n>1)qt(0.975,n-1)*sd(x)/sqrt(n) else NA;" +
      'setNames(c(mean(x)-h,mean(x)+h,min(x),max(x),max(x)-min(x)),paste0(c("lo_","hi_","min_","max_","r_"),i-1))})))',
  );
  return {
    testType: "descriptive-statistics",
    stats: [],
    groups: groups.map((g, i) => ({
      name: g.name,
      mean: v[`m_${i}`] ?? null,
      sd: v[`s_${i}`] ?? null,
      sem: v[`e_${i}`] ?? null,
      median: v[`md_${i}`] ?? null,
      n: v[`n_${i}`] ?? 0,
      ciLow: v[`lo_${i}`] ?? null,
      ciHigh: v[`hi_${i}`] ?? null,
      min: v[`min_${i}`] ?? null,
      max: v[`max_${i}`] ?? null,
      range: v[`r_${i}`] ?? null,
    })),
    notes:
      "Per-column summary. Range is Max − Min. 95% CI is the t-based confidence interval of the mean; " +
      "columns with fewer than 2 values have no SD, SEM, or CI.",
  };
}
