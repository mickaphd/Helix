// Survival analysis of a Survival table (Prism's "Simple survival analysis"), with R's
// survival package: each group's subjects, events and median survival with its 95% interval
// (survfit, log-log); the curves compared by the log-rank (Mantel-Cox) test (survdiff), the
// log-rank test for trend (on survdiff's observed − expected events), or the Gehan-Breslow-
// Wilcoxon test (each event time weighted by the number at risk, as Prism; survdiff has no
// such weights); two groups' hazard ratios, Mantel-Haenszel and log-rank. With 3 groups or
// more, every pair is also compared, corrected for multiplicity.
import type { AnalysisOutcome, Column, ComparisonRow, StatRow, SurvivalGroupRow, SurvivalParams } from "../types";
import { evalNamedVector } from "../webr";
import { pairIndices, rVec } from "../column/base";
import { survivalGroups } from "./base";

const TEST_NAMES: Record<SurvivalParams["curveTest"], string> = {
  logrank: "Log-rank (Mantel-Cox) test",
  trend: "Log-rank test for trend",
  gehan: "Gehan-Breslow-Wilcoxon test",
};

/** R's `p.adjust` method for each correction. */
const CORRECTION_METHOD: Record<SurvivalParams["correction"], string> = { holm: "holm", fdr: "BH", none: "none" };

const CORRECTION_NAMES: Record<SurvivalParams["correction"], string> = {
  holm: "Holm-corrected",
  fdr: "FDR-corrected (Benjamini-Hochberg)",
  none: "uncorrected",
};

/** R: `chi`, the chi-square comparing groups 1…k of subjects `t`, `s`, `g` by `test`
 *  (`gehan` sums each group's O − E and their covariance, every event time weighted by
 *  the number at risk); `hr`, the log-rank hazard ratio of the first group to the second. */
const R_TESTS = `
gehan<-function(t,s,g,k){u<-sort(unique(t[s==1]));Z<-numeric(k);V<-matrix(0,k,k)
for(x in u){n<-tabulate(g[t>=x],k);d<-tabulate(g[t==x&s==1],k);N<-sum(n);D<-sum(d)
Z<-Z+N*(d-n*D/N);if(N>1)V<-V+N^2*D*(N-D)/(N-1)*(diag(n/N,k)-outer(n/N,n/N))}
list(Z=Z,V=V)}
quad<-function(Z,V){m<-length(Z)-1;drop(Z[1:m]%*%solve(V[1:m,1:m,drop=FALSE],Z[1:m]))}
chi<-function(t,s,g,k,test){if(test=="gehan"){w<-gehan(t,s,g,k);return(quad(w$Z,w$V))}
d<-survdiff(Surv(t,s)~factor(g,levels=1:k))
if(test=="trend"){x<-1:k;return(sum(x*(d$obs-d$exp))^2/drop(x%*%d$var%*%x))}
d$chisq}
hr<-function(t,s,g){d<-survdiff(Surv(t,s)~factor(g,levels=1:2));d$obs[1]/d$exp[1]/(d$obs[2]/d$exp[2])}`;

export async function runSurvival(columns: Column[], params: SurvivalParams): Promise<AnalysisOutcome> {
  const groups = survivalGroups(columns);
  if (!Array.isArray(groups)) return groups;

  const k = groups.length;
  const test = params.curveTest === "trend" && k < 3 ? "logrank" : params.curveTest;
  const pairs = k > 2 ? pairIndices(k) : [];
  // Each pair is compared by the same test, the trend's by the log-rank test.
  const pairTest = test === "gehan" ? "gehan" : "logrank";
  const pair = (i: number, j: number) => `{w<-g==${i + 1}|g==${j + 1};pg<-ifelse(g[w]==${i + 1},1,2)`;
  const r = await evalNamedVector(
    `library(survival);${R_TESTS}
t<-${rVec(groups.flatMap((g) => g.x))};s<-${rVec(groups.flatMap((g) => g.y))}
g<-${rVec(groups.flatMap((g, i) => g.x.map(() => i + 1)))};k<-${k}
x<-chi(t,s,g,k,"${test}");df<-${test === "trend" ? 1 : k - 1}
q<-quantile(survfit(Surv(t,s)~factor(g,levels=1:k),conf.type="log-log"),0.5)
d<-survdiff(Surv(t,s)~factor(g,levels=1:k));v<-d$var[1,1];L<-(d$obs[1]-d$exp[1])/v
c(chi=x,df=df,p=pchisq(x,df,lower.tail=FALSE),
${groups.map((_, i) => `m_${i}=unname(q$quantile[${i + 1}]),lo_${i}=unname(q$lower[${i + 1}]),hi_${i}=unname(q$upper[${i + 1}])`).join(",")},
mh=exp(L),mhlo=exp(L-qnorm(0.975)/sqrt(v)),mhhi=exp(L+qnorm(0.975)/sqrt(v)),
lr=d$obs[1]/d$exp[1]/(d$obs[2]/d$exp[2]),
lrlo=d$obs[1]/d$exp[1]/(d$obs[2]/d$exp[2])*exp(-qnorm(0.975)*sqrt(1/d$exp[1]+1/d$exp[2])),
lrhi=d$obs[1]/d$exp[1]/(d$obs[2]/d$exp[2])*exp(qnorm(0.975)*sqrt(1/d$exp[1]+1/d$exp[2])),
${groups.map((_, i) => `sub_${i}=sum(g==${i + 1}),ev_${i}=sum(s[g==${i + 1}])`).join(",")}${
      pairs.length
        ? `,setNames(p.adjust(c(${pairs
            .map(([i, j]) => `${pair(i, j)};pchisq(chi(t[w],s[w],pg,2,"${pairTest}"),1,lower.tail=FALSE)}`)
            .join(
              ",",
            )}),"${CORRECTION_METHOD[params.correction]}"),c(${pairs.map(([i, j]) => `"p_${i}_${j}"`).join(",")}))` +
          pairs.map(([i, j]) => `,hr_${i}_${j}=${pair(i, j)};hr(t[w],s[w],pg)}`).join("")
        : ""
    })`,
  );

  const stats: StatRow[] = [
    { label: "Chi-square", value: r.chi ?? null },
    { label: "df", value: r.df ?? null },
    { label: "P value", value: r.p ?? null, p: true },
  ];
  // Two groups: the hazard ratio of the first to the second, by Mantel-Haenszel and by log-rank.
  if (k === 2) {
    const ratio = `${groups[0].name} / ${groups[1].name}`;
    stats.push(
      { label: `Hazard ratio (Mantel-Haenszel), ${ratio}`, value: r.mh ?? null },
      { label: "95% CI lower", value: r.mhlo ?? null },
      { label: "95% CI upper", value: r.mhhi ?? null },
      { label: `Hazard ratio (log-rank), ${ratio}`, value: r.lr ?? null },
      { label: "95% CI lower", value: r.lrlo ?? null },
      { label: "95% CI upper", value: r.lrhi ?? null },
    );
  }

  const comparisons: ComparisonRow[] = pairs.map(([i, j]) => ({
    group1: groups[i].name,
    group2: groups[j].name,
    diff: r[`hr_${i}_${j}`] ?? null,
    p: r[`p_${i}_${j}`] ?? null,
  }));

  const summaries: SurvivalGroupRow[] = groups.map((g, i) => ({
    group: g.name,
    subjects: r[`sub_${i}`] ?? 0,
    events: r[`ev_${i}`] ?? 0,
    median: r[`m_${i}`] ?? null,
    low: r[`lo_${i}`] ?? null,
    high: r[`hi_${i}`] ?? null,
  }));

  return {
    testType: "survival",
    subtitle: TEST_NAMES[test],
    stats,
    groups: [],
    survivalGroups: summaries,
    comparisons,
    comparisonsLabel: `Pairwise comparisons (${TEST_NAMES[pairTest]}, ${CORRECTION_NAMES[params.correction]})`,
    comparisonsEffect: "Hazard ratio",
    notes:
      "Kaplan-Meier curves (R's survival package). A median survival is the time the curve falls to 50%; " +
      "its 95% interval (log-log) is open (—) where the band never reaches 50%. " +
      (test === "trend" ? "The test for trend takes the groups in their table order as equally spaced. " : "") +
      (k === 2 ? "A hazard ratio above 1: the first group's events come sooner. " : "") +
      (k > 2 ? "A pairwise hazard ratio is the first group's to the second's (log-rank method)." : ""),
  };
}
