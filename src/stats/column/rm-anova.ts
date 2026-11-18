// Repeated-measures one-way ANOVA — compares the means of three or more matched groups,
// blocking on subject. Parametric counterpart to the Friedman test, resolved by the same
// "Compare more than two matched groups" wizard that asks Gaussian?. Sphericity assumed,
// its P is the ANOVA's; not assumed (`sphericity` false), the Geisser-Greenhouse epsilon
// shrinks both degrees of freedom. Optionally followed by Tukey or Bonferroni comparisons of
// every pair: on the ANOVA's residual mean square while sphericity is assumed, else each
// pair on its own differences, a paired t test (Maxwell and Delaney, as Prism does).
import { PAIR_CORRECTIONS, type RmAnovaParams } from "../types";
import {
  groupsSetup,
  matchedRowsNote,
  matchedFit,
  pairedGroups,
  pairIndices,
  posthocOf,
  pRow,
  ciOf,
  comparedPairs,
  R_ADJUST,
  R_CRIT,
  R_PTUKEY,
  type ColumnTestSpec,
} from "./base";

/** Tukey or Bonferroni, else none (a file may name another). */
const posthocIn = (params: RmAnovaParams | undefined) =>
  params?.posthoc === "tukey" || (PAIR_CORRECTIONS as readonly string[]).includes(params?.posthoc ?? "")
    ? (params!.posthoc as "tukey" | (typeof PAIR_CORRECTIONS)[number])
    : "none";

/** Sphericity is assumed unless the params say it isn't (an analysis from before 1.0.7). */
const corrected = (params: RmAnovaParams | undefined) => params?.sphericity === false;

export const rmAnovaSpec: ColumnTestSpec<RmAnovaParams> = {
  testType: "rm-anova",
  minGroups: 3,
  minValues: 2,
  matched: () => true,
  parseGroups: (columns) => pairedGroups(columns),
  checkGroups: (groups) =>
    matchedFit(groups)
      ? "Every subject's values differ from the others' by the same amounts: there is no scatter left to test the groups on."
      : undefined,
  rCode: (groups, params) => {
    const k = groups.length;
    const n = groups[0]?.values.length ?? 0;
    const setup = `${groupsSetup(groups)};M<-cbind(${groups.map((_, i) => `g${i}`).join(",")})`;
    // The table of aov(v ~ group + subject), from the subjects × groups matrix M (a model
    // matrix of one column per subject took 15 s for 2,000): rows group, subject, residual.
    const a =
      `mm<-mean(M);m<-colMeans(M);S<-c(${n}*sum((m-mm)^2),${k}*sum((rowMeans(M)-mm)^2),` +
      `sum((M-outer(rowMeans(M),m,"+")+mm)^2));D<-c(${k - 1},${n - 1},${(n - 1) * (k - 1)});Q<-S/D;f<-Q/Q[3];` +
      `a<-data.frame(Df=D,"Sum Sq"=S,"F value"=f,"Pr(>F)"=pf(f,D,D[3],lower.tail=FALSE),check.names=FALSE);` +
      `mse<-Q[3];dfr<-D[3]`;
    // Geisser-Greenhouse: epsilon from the groups' covariance, double-centered.
    const gg = `H<-diag(${k})-1/${k};C<-H%*%cov(M)%*%H;e<-min(1,sum(diag(C))^2/(${k - 1}*sum(C*C)))`;
    const main = corrected(params)
      ? `F=a$"F value"[1],dfn=e*a$Df[1],dfd=e*a$Df[3],p=pf(a$"F value"[1],e*a$Df[1],e*a$Df[3],lower.tail=FALSE),` +
        `eta2=a$"Sum Sq"[1]/sum(a$"Sum Sq"),eps=e`
      : `F=a$"F value"[1],dfn=a$Df[1],dfd=a$Df[3],p=a$"Pr(>F)"[1],eta2=a$"Sum Sq"[1]/sum(a$"Sum Sq")`;
    const head = `${setup};${a};${corrected(params) ? gg : ""}`;
    const posthoc = posthocIn(params);
    if (posthoc === "none") return `${head};c(${main})`;
    // The pairs compared: every pair for Tukey's, else all or those chosen. Each pair's |t|,
    // df and standard error: on the ANOVA's mean square, or on the pair's own differences
    // (a paired t test, n − 1 df); its P (Tukey's, or the raw ones corrected together,
    // `adj`), then its 95% CI: its difference ± the t at which its P is 0.05 (`ciOf`).
    const pairs = posthoc === "tukey" ? pairIndices(k) : comparedPairs(groups, params?.compared);
    const t = (i: number, j: number) =>
      corrected(params)
        ? `{d<-M[,${i + 1}]-M[,${j + 1}];s<-sd(d)/sqrt(${n});c(abs(mean(d))/s,${n - 1},s)}`
        : `{s<-sqrt(2*mse/${n});c(abs(m[[${i + 1}]]-m[[${j + 1}]])/s,dfr,s)}`;
    const f = (x: string) =>
      posthoc === "tukey" ? `ptk(${x}*sqrt(2),${k},w[2])` : `pa(${x},w[2],"${posthoc}",${pairs.length})`;
    const ci = (i: number, j: number) =>
      posthoc === "holm-sidak"
        ? []
        : [`{w<-${t(i, j)};${ciOf(`${i}_${j}`, `m[[${i + 1}]]-m[[${j + 1}]]`, "w[3]", f("x"))}}`];
    const ps =
      posthoc === "tukey"
        ? pairs.map(([i, j]) => `p_${i}_${j}={w<-${t(i, j)};${f("w[1]")}}`)
        : pairs.map(([i, j], q) => `p_${i}_${j}=ps[${q + 1}]`);
    const raw =
      posthoc === "tukey"
        ? ""
        : `${R_ADJUST};ps<-adj(c(${pairs.map(([i, j]) => `{w<-${t(i, j)};2*pt(-w[1],w[2])}`).join(",")}),"${posthoc}");`;
    return `${R_PTUKEY};${R_CRIT};${head};${raw}c(${main},${[...ps, ...pairs.flatMap(([i, j]) => ci(i, j))].join(",")})`;
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
  pairs: (groups, params) =>
    posthocIn(params) === "tukey" ? pairIndices(groups.length) : comparedPairs(groups, params?.compared),
  notes: (params, _groups, columns) =>
    "Compares means across matched groups, blocking on subject; assumes normal distributions. " +
    (corrected(params)
      ? "Sphericity not assumed: the Geisser-Greenhouse epsilon corrects both degrees of freedom" +
        (posthocIn(params) === "none" ? "." : ", and each pair is compared on its own differences (paired t test).")
      : "Assumes sphericity (no Geisser-Greenhouse correction).") +
    ` ${matchedRowsNote(columns)}`,
  subtitle: () => "Repeated-measures one-way ANOVA",
};
