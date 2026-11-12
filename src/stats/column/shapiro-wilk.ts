// Normality and lognormality, per column: the Shapiro-Wilk test of the values, and of
// their logarithms when all are above 0, with what they mean for the choice of a test
// said in plain words. A column R can't test (fewer than 3 values, more than 5000, or all
// identical) gets no result, and the notes say so. Here a small P is bad news: it says
// the data depart from the distribution.
import type { AnalysisOutcome, Column, NormalityRow } from "../types";
import { describe, rVec } from "./base";
import { evalNamedVector } from "../webr";

/** Whether a test's P says the data are consistent with the distribution (none: not tested). */
const passes = (p: number | null) => (p == null ? null : p > 0.05);

const quoted = (rows: NormalityRow[]) => rows.map((r) => `“${r.group}”`).join(", ");

/** What the results mean for the choice of a test. */
function conclusion(rows: NormalityRow[]): string {
  const tested = rows.filter((r) => r.p != null);
  if (!tested.length) return "No data set could be tested.";
  const failing = tested.filter((r) => !passes(r.p));
  const all = tested.length === 1 ? "These data are" : "Every data set is";
  if (!failing.length)
    return `${all} consistent with a normal (Gaussian) distribution: parametric tests (t tests, ANOVA) suit these data.`;
  const lognormal = tested.every((r) => passes(r.logP));
  return (
    `${quoted(failing)} ${failing.length === 1 ? "departs" : "depart"} from a normal (Gaussian) distribution. ` +
    (lognormal
      ? `${all} consistent with a lognormal distribution: a lognormal t test suits these data, or a nonparametric test.`
      : "Prefer a nonparametric test (Mann-Whitney, Wilcoxon, Kruskal-Wallis, Friedman).")
  );
}

export async function runNormality(columns: Column[]): Promise<AnalysisOutcome> {
  const groups = columns.filter((c) => c.values.length > 0);
  if (groups.length < 1) return { error: "This needs at least 1 column containing numeric data." };
  const v = await evalNamedVector(
    `f<-function(x){if(length(x)<3||length(x)>5000||min(x)==max(x))return(c(NA,NA));s<-shapiro.test(x);c(unname(s$statistic),s$p.value)}\n` +
      `G<-list(${groups.map((g) => rVec(g.values)).join(",")})\n` +
      `unlist(lapply(seq_along(G),function(i){x<-G[[i]];` +
      `setNames(c(f(x),if(min(x)>0)f(log(x)) else c(NA,NA)),paste0(c("W","p","lW","lp"),i-1))}))`,
  );
  const normality = groups.map((g, i) => ({
    group: g.name,
    w: v[`W${i}`] ?? null,
    p: v[`p${i}`] ?? null,
    logW: v[`lW${i}`] ?? null,
    logP: v[`lp${i}`] ?? null,
  }));
  const untested = normality.filter((r) => r.p == null);
  return {
    testType: "shapiro-wilk",
    subtitle: "Shapiro-Wilk test",
    summary: conclusion(normality),
    stats: [],
    groups: (await describe(groups)).groups,
    normality,
    notes:
      "Each data set is tested alone. P > 0.05: consistent with the distribution; P < 0.05: a significant " +
      "departure from it. Lognormality is the same test on the logarithms, for data sets whose values are all " +
      "above 0. With few values the test seldom detects a departure, so passing it is not proof." +
      (untested.length
        ? ` Not tested (the test needs 3 to 5000 values that aren't all identical): ${quoted(untested)}.`
        : ""),
  };
}
