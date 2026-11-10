// Repeated-measures one-way ANOVA — compares the means of three or more matched groups,
// blocking on subject. Parametric counterpart to the Friedman test, resolved by the same
// "Compare more than two matched groups" wizard that asks Gaussian?. Sphericity assumed,
// its P is the ANOVA's; not assumed (`sphericity` false), the Geisser-Greenhouse epsilon
// shrinks both degrees of freedom. Optionally followed by Tukey or Bonferroni comparisons of
// every pair: on the ANOVA's residual mean square while sphericity is assumed, else each
// pair on its own differences, a paired t test (Maxwell and Delaney, as Prism does).
import type { RmAnovaParams } from "../types";
import { groupsSetup, matchedRowsNote, pairedGroups, pairIndices, posthocOf, pRow, type ColumnTestSpec } from "./base";

/** Tukey or Bonferroni, else none (a file may name another). */
const posthocIn = (params: RmAnovaParams | undefined) =>
  params?.posthoc === "tukey" || params?.posthoc === "bonferroni" ? params.posthoc : "none";

/** Sphericity is assumed unless the params say it isn't (an analysis from before 1.0.7). */
const corrected = (params: RmAnovaParams | undefined) => params?.sphericity === false;

export const rmAnovaSpec: ColumnTestSpec<RmAnovaParams> = {
  testType: "rm-anova",
  minGroups: 3,
  minValues: 2,
  matched: () => true,
  parseGroups: (columns) => pairedGroups(columns),
  rCode: (groups, params) => {
    const k = groups.length;
    const n = groups[0]?.values.length ?? 0;
    const setup = groupsSetup(groups);
    const subj = `subj<-factor(rep(1:${n},${k}))`;
    // Rows: gr (effect of interest), subj (blocking factor), Residuals — in that order.
    const a = `a<-summary(aov(v~gr+subj))[[1]];mse<-a$"Mean Sq"[3];dfr<-a$Df[3];m<-tapply(v,gr,mean)`;
    // Geisser-Greenhouse: epsilon from the groups' covariance, double-centered.
    const gg =
      `M<-cbind(${groups.map((_, i) => `g${i}`).join(",")});H<-diag(${k})-1/${k};C<-H%*%cov(M)%*%H;` +
      `e<-min(1,sum(diag(C))^2/(${k - 1}*sum(C*C)))`;
    const main = corrected(params)
      ? `F=a$"F value"[1],dfn=e*a$Df[1],dfd=e*a$Df[3],p=pf(a$"F value"[1],e*a$Df[1],e*a$Df[3],lower.tail=FALSE),` +
        `eta2=a$"Sum Sq"[1]/sum(a$"Sum Sq"),eps=e`
      : `F=a$"F value"[1],dfn=a$Df[1],dfd=a$Df[3],p=a$"Pr(>F)"[1],eta2=a$"Sum Sq"[1]/sum(a$"Sum Sq")`;
    const head = `${setup};${subj};${a};${corrected(params) ? gg : ""}`;
    const posthoc = posthocIn(params);
    if (posthoc === "none") return `${head};c(${main})`;
    const pairs = pairIndices(k);
    // Each pair's t, and its degrees of freedom: on the ANOVA's mean square, or on the pair's
    // own differences (a paired t test, n − 1 df).
    const t = (i: number, j: number) =>
      corrected(params)
        ? `{d<-M[,${i + 1}]-M[,${j + 1}];c(abs(mean(d))/(sd(d)/sqrt(${n})),${n - 1})}`
        : `c(abs(m[[${i + 1}]]-m[[${j + 1}]])/sqrt(2*mse/${n}),dfr)`;
    const p = (i: number, j: number) =>
      `p_${i}_${j}={w<-${t(i, j)};` +
      (posthoc === "tukey"
        ? `ptukey(w[1]*sqrt(2),${k},w[2],lower.tail=FALSE)}`
        : `pmin(1,${pairs.length}*2*pt(-w[1],w[2]))}`);
    return `${head};c(${main},${pairs.map(([i, j]) => p(i, j)).join(",")})`;
  },
  rows: (v, _groups, params) => [
    { label: "F", value: v.F },
    { label: "DFn", value: v.dfn },
    { label: "DFd", value: v.dfd },
    pRow("P value", v.p),
    { label: "R squared (eta squared)", value: v.eta2 },
    ...(corrected(params) ? [{ label: "Geisser-Greenhouse epsilon", value: v.eps }] : []),
  ],
  posthoc: (params) => posthocOf({ posthoc: posthocIn(params) }),
  notes: (params, _groups, columns) =>
    "Compares means across matched groups, blocking on subject; assumes normal distributions. " +
    (corrected(params)
      ? "Sphericity not assumed: the Geisser-Greenhouse epsilon corrects both degrees of freedom" +
        (posthocIn(params) === "none" ? "." : ", and each pair is compared on its own differences (paired t test).")
      : "Assumes sphericity (no Geisser-Greenhouse correction).") +
    ` ${matchedRowsNote(columns)}`,
  subtitle: () => "Repeated-measures one-way ANOVA",
};
