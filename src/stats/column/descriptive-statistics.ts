// "Descriptive statistics" (Prism's Column statistics) — a per-column summary, computed by
// R: N, mean, SD, SEM, median, the 95% confidence interval of the mean (t-based), the
// minimum, maximum and range, the 25th and 75th percentiles (R's type 6, Prism's method), the
// coefficient of variation and the geometric mean (values above 0 only). Not an
// inferential test, so there are no `stats` rows.
import type { AnalysisOutcome, Column } from "../types";
import { dataGroups, R_DESCRIBE, rVec } from "./base";
import { evalNamedVector } from "../webr";

export async function runDescriptiveStatistics(columns: Column[]): Promise<AnalysisOutcome> {
  const groups = dataGroups(columns);
  if (groups.length < 1) {
    return { error: "This needs at least 1 column containing numeric data." };
  }
  // Each column's descriptives, then its CI (none under 2 values), minimum, maximum, range,
  // quartiles, CV (none under 2 values or for a mean of 0) and geometric mean (none with a value at or under 0).
  const v = await evalNamedVector(
    `G<-list(${groups.map((g) => rVec(g.values)).join(",")});c(${R_DESCRIBE},` +
      "unlist(lapply(seq_along(G),function(i){x<-G[[i]];n<-length(x);s<-if(n>1)sd(x) else NA;" +
      "h<-if(n>1)qt(0.975,n-1)*s/sqrt(n) else NA;q<-quantile(x,c(0.25,0.75),type=6,names=FALSE);" +
      "setNames(c(mean(x)-h,mean(x)+h,min(x),max(x),max(x)-min(x),q,if(mean(x)!=0)100*s/mean(x) else NA," +
      "if(all(x>0))exp(mean(log(x))) else NA)," +
      'paste0(c("lo_","hi_","min_","max_","r_","q1_","q3_","cv_","gm_"),i-1))})))',
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
      q1: v[`q1_${i}`] ?? null,
      q3: v[`q3_${i}`] ?? null,
      cv: v[`cv_${i}`] ?? null,
      geoMean: v[`gm_${i}`] ?? null,
    })),
    notes:
      "Range is Max − Min. 95% CI is the t-based confidence interval of the mean. The 25th and 75th " +
      "percentiles are R's type 6, the (n + 1)p method. The coefficient of variation is SD ÷ mean. " +
      "Columns with fewer than 2 values have no SD, SEM, CI or CV; the geometric mean needs every value above 0.",
  };
}
