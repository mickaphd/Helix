// One-way ANOVA — compares the means of three or more groups: the ordinary ANOVA (equal SDs:
// F, and R² as eta squared) or Welch's (unequal SDs: `oneway.test`). Optionally followed by
// comparisons of every pair (Tukey, Bonferroni; with unequal SDs Games-Howell or Dunnett's T3)
// or of each group with a control (Dunnett). Dunnett's and T3's P values are exact: the
// distribution of the largest of the t statistics compared, integrated in R.
import type { AnovaParams } from "../types";
import {
  dataGroups,
  groupsSetup,
  pairIndices,
  pairwisePosthocStatements,
  posthocOf,
  pRow,
  tukeyPosthocStatements,
  type ColumnTestSpec,
  type Group,
} from "./base";

const DEFAULTS: AnovaParams = { posthoc: "none" };

const welch = (p: AnovaParams | undefined) => p?.equalSd === false;

/** R: where √(χ²/df) has its mass (`lims`), and its density (`ds`); `smm`, the P of a t
 *  statistic at `df` as the largest of `mc` independent ones (the studentized maximum
 *  modulus: Dunnett's T3); `dun`, its P as the largest of the comparisons with a control,
 *  each group's weight `l` = √(n / (n + n of the control)) (Dunnett, 1955). */
export const R_MAXIMUM_T = `
lims<-function(df)sqrt(qchisq(c(1e-12,1-1e-12),df)/df)
ds<-function(s,df)dchisq(df*s^2,df)*2*df*s
smm<-function(t,mc,df){r<-lims(df);pmin(1,pmax(0,1-integrate(function(s)(2*pnorm(abs(t)*s)-1)^mc*ds(s,df),r[1],r[2],rel.tol=1e-10)$value))}
dun<-function(t,l,df){r<-lims(df);q<-sqrt(1-l^2)
inner<-function(s)integrate(function(w)dnorm(w)*Reduce("*",lapply(seq_along(l),function(i)pnorm((abs(t)*s-l[i]*w)/q[i])-pnorm((-abs(t)*s-l[i]*w)/q[i]))),-Inf,Inf,rel.tol=1e-8)$value
pmin(1,pmax(0,1-integrate(function(s)sapply(s,inner)*ds(s,df),r[1],r[2],rel.tol=1e-8)$value))}`;

/** The control group's index among `groups`, if the params name one there. */
const controlOf = (groups: Group[], p: AnovaParams | undefined) => groups.findIndex((g) => g.name === p?.control);

/** The comparisons the params ask: R statements (`setup`), then each pair's P value as
 *  `p_i_j` (`values`, for the result's `c(…)`). */
function comparisons(groups: Group[], p: AnovaParams): { setup: string; values: string } {
  const k = groups.length;
  const at = (i: number) => i + 1;
  if (p.posthoc === "tukey") {
    const ph = tukeyPosthocStatements(k);
    return { setup: ph.setup, values: ph.assign };
  }
  if (p.posthoc === "bonferroni") {
    const ph = pairwisePosthocStatements(k, `pairwise.t.test(v,gr,p.adjust.method="bonferroni")$p.value`);
    return { setup: ph.setup, values: ph.assign };
  }
  if (p.posthoc === "dunnett") {
    // Each group against the control, on the ANOVA's residual mean square.
    const c = controlOf(groups, p);
    const others = groups.map((_, i) => i).filter((i) => i !== c);
    const t = (i: number) => `(m[${at(i)}]-m[${at(c)}])/sqrt(mse*(1/n[${at(i)}]+1/n[${at(c)}]))`;
    return {
      setup: `${R_MAXIMUM_T}\nmse<-a$"Mean Sq"[2];dfe<-a$Df[2];l<-sqrt(n[-${at(c)}]/(n[-${at(c)}]+n[${at(c)}]))`,
      values: others.map((i) => `p_${i}_${c}=dun(${t(i)},l,dfe)`).join(","),
    };
  }
  // Games-Howell and Dunnett's T3: each pair's Welch t and df; the first against the
  // studentized range, the second against the largest of all the pairs' t.
  const pairs = pairIndices(k);
  const test =
    p.posthoc === "games-howell"
      ? `ptukey(abs(w[1])*sqrt(2),${k},w[2],lower.tail=FALSE)`
      : `smm(w[1],${pairs.length},w[2])`;
  return {
    setup:
      `${p.posthoc === "t3" ? R_MAXIMUM_T : ""}\n` +
      `wt<-function(i,j){e<-s2[i]/n[i]+s2[j]/n[j];c((m[i]-m[j])/sqrt(e),e^2/((s2[i]/n[i])^2/(n[i]-1)+(s2[j]/n[j])^2/(n[j]-1)))}`,
    values: pairs.map(([i, j]) => `p_${i}_${j}={w<-wt(${at(i)},${at(j)});${test}}`).join(","),
  };
}

export const anovaSpec: ColumnTestSpec<AnovaParams> = {
  testType: "anova",
  minGroups: 3,
  // Welch's ANOVA, Games-Howell and T3 weigh each group by its own variance.
  check: (columns, params) => {
    const p = { ...DEFAULTS, ...params };
    const groups = dataGroups(columns);
    if (p.posthoc === "dunnett" && !groups.some((g) => g.name === p.control)) {
      return `The control group${p.control ? ` “${p.control}”` : ""} holds no data. Create this analysis again to choose another.`;
    }
    if (!welch(p) && p.posthoc !== "games-howell" && p.posthoc !== "t3") return undefined;
    for (const g of groups) {
      if (g.values.length < 2)
        return `“${g.name}” holds ${g.values.length} value; this test needs at least 2 in each group.`;
      if (g.values.every((v) => v === g.values[0]))
        return `“${g.name}”'s values are all identical: this test needs some scatter in each group.`;
    }
  },
  rCode: (groups, params) => {
    const p = { ...DEFAULTS, ...params };
    const setup =
      `${groupsSetup(groups)};G<-list(${groups.map((_, i) => `g${i}`).join(",")});` +
      `n<-lengths(G);m<-sapply(G,mean);s2<-sapply(G,var);a<-summary(aov(v~gr))[[1]]`;
    const main = welch(p)
      ? `w<-oneway.test(v~gr,var.equal=FALSE);r<-c(F=unname(w$statistic),dfn=unname(w$parameter[1]),dfd=unname(w$parameter[2]),p=w$p.value)`
      : `r<-c(F=a$"F value"[1],dfn=a$Df[1],dfd=a$Df[2],p=a$"Pr(>F)"[1],eta2=a$"Sum Sq"[1]/sum(a$"Sum Sq"));r["f"]<-sqrt(r["eta2"]/(1-r["eta2"]))`;
    if (p.posthoc === "none") return `${setup};${main};r`;
    const ph = comparisons(groups, p);
    return `${setup};${main}\n${ph.setup}\nc(r,${ph.values})`;
  },
  rows: (v, _groups, params) =>
    welch(params)
      ? [
          { label: "F (Welch)", value: v.F },
          { label: "DFn", value: v.dfn },
          { label: "DFd", value: v.dfd },
          pRow("P value", v.p),
        ]
      : [
          { label: "F", value: v.F },
          { label: "DFn", value: v.dfn },
          { label: "DFd", value: v.dfd },
          pRow("P value", v.p),
          { label: "R squared (eta squared)", value: v.eta2 },
          { label: "Cohen's f", value: v.f },
        ],
  posthoc: posthocOf,
  pairs: (groups, params) => {
    if (params?.posthoc !== "dunnett") return pairIndices(groups.length);
    const c = controlOf(groups, params);
    return groups.flatMap((_, i): [number, number][] => (i === c ? [] : [[i, c]]));
  },
  notes: (params) =>
    welch(params)
      ? "Compares means across groups without assuming equal SDs (Welch's ANOVA); assumes normal distributions."
      : "Compares means across groups; assumes normal distributions with equal variances.",
  subtitle: (params) => (welch(params) ? "Welch's ANOVA" : "One-way ANOVA"),
};
