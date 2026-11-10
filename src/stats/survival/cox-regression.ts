// Cox proportional hazards regression of a Survival table, with R's survival package
// (coxph, Efron's method for tied times): each group's hazard ratio to the reference group,
// with its 95% interval (Wald) and P; the model's likelihood ratio, Wald and score
// (log-rank) tests; its concordance; and the proportional hazards assumption tested on
// scaled Schoenfeld residuals (cox.zph).
import type { AnalysisOutcome, Column, CoxParams, HazardRatioRow, StatRow } from "../types";
import { evalNamedVector } from "../webr";
import { rVec } from "../column/base";
import { survivalGroups } from "./base";

export async function runCox(columns: Column[], params: CoxParams | undefined): Promise<AnalysisOutcome> {
  const groups = survivalGroups(columns);
  if (!Array.isArray(groups)) return groups;

  // The reference first: its hazard is the one the others' are compared to.
  const ref = Math.max(
    0,
    groups.findIndex((g) => g.name === params?.reference),
  );
  const ordered = [groups[ref], ...groups.filter((_, i) => i !== ref)];
  const others = ordered.slice(1);
  const r = await evalNamedVector(
    `library(survival)
t<-${rVec(ordered.flatMap((g) => g.x))};s<-${rVec(ordered.flatMap((g) => g.y))}
g<-factor(${rVec(ordered.flatMap((g, i) => g.x.map(() => i + 1)))},levels=1:${ordered.length})
w<-0;f<-withCallingHandlers(coxph(Surv(t,s)~g,ties="efron"),warning=function(e){w<<-1;invokeRestart("muffleWarning")});m<-summary(f);z<-cox.zph(f)$table
c(${others.map((_, i) => `hr_${i}=m$conf.int[${i + 1},1],lo_${i}=m$conf.int[${i + 1},3],hi_${i}=m$conf.int[${i + 1},4],p_${i}=m$coefficients[${i + 1},5]`).join(",")},
lr=unname(m$logtest[1]),df=unname(m$logtest[2]),lrp=unname(m$logtest[3]),
wald=unname(m$waldtest[1]),waldp=unname(m$waldtest[3]),score=unname(m$sctest[1]),scorep=unname(m$sctest[3]),
cindex=unname(m$concordance[1]),ph=z["GLOBAL","p"],warned=w)`,
  );

  const stats: StatRow[] = [
    { label: "Likelihood ratio chi-square", value: r.lr ?? null },
    { label: "df", value: r.df ?? null },
    { label: "P value (likelihood ratio test)", value: r.lrp ?? null, p: true },
    { label: "Wald chi-square", value: r.wald ?? null },
    { label: "Wald test P", value: r.waldp ?? null, p: true },
    { label: "Score (log-rank) chi-square", value: r.score ?? null },
    { label: "Score test P", value: r.scorep ?? null, p: true },
    { label: "Concordance", value: r.cindex ?? null },
    { label: "Proportional hazards test P", value: r.ph ?? null, p: true },
  ];
  const hazardRatios: HazardRatioRow[] = others.map((g, i) => ({
    comparison: `${g.name} vs. ${ordered[0].name}`,
    ratio: r[`hr_${i}`] ?? null,
    low: r[`lo_${i}`] ?? null,
    high: r[`hi_${i}`] ?? null,
    p: r[`p_${i}`] ?? null,
  }));

  return {
    testType: "cox",
    subtitle: "Cox proportional hazards regression",
    stats,
    groups: [],
    hazardRatios,
    notes:
      `Each group's hazard ratio to ${ordered[0].name}'s (R's survival package, coxph; Efron's method for tied ` +
      "times; Wald 95% intervals). A ratio above 1: that group's events come sooner. A small proportional " +
      "hazards P (cox.zph, scaled Schoenfeld residuals) warns that a ratio changes over time." +
      (r.warned
        ? " Warning: the model did not converge (a group without an event, or with only events, has no " +
          "finite hazard ratio): its ratios, intervals and Wald test can't be relied on."
        : ""),
  };
}
