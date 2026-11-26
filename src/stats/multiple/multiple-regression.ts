// Multiple linear regression on a Multiple Variables table: one chosen dependent
// variable regressed on every other data-bearing variable, fit on complete cases.
// Bespoke runner (not ColumnTestSpec) — needs a chosen response + a coefficients table.
import type { AnalysisOutcome, Column, MultipleRegressionParams, RegressionCoefficient } from "../types";
import { dataGroups, describe, identical, pairedGroups, pRow, rVec } from "../column/base";
import { evalNamedVector } from "../webr";

export async function runMultipleRegression(
  columns: Column[],
  params: MultipleRegressionParams | undefined,
): Promise<AnalysisOutcome> {
  const vars = dataGroups(columns);
  const dep = params?.dependent === undefined ? vars[0] : vars.find((c) => c.name === params.dependent);
  const chosen = params?.predictors;
  const predictors = dep
    ? chosen && chosen.length > 0
      ? vars.filter((c) => c !== dep && chosen.includes(c.name))
      : vars.filter((c) => c !== dep)
    : [];
  if (!dep || predictors.length < 1) {
    return { error: "Multiple regression needs a dependent variable and at least one other variable with data." };
  }

  // Complete cases: the rows where every variable used has a value.
  const used = [dep, ...predictors];
  const aligned = pairedGroups(used).map((g) => g.values);
  const n = aligned[0].length;
  const p = predictors.length;
  if (n <= p + 1) {
    return { error: `Not enough complete rows (${n}) to fit ${p} predictor(s). Enter more data and try again.` };
  }

  // The predictors and Y centered (the same fit, more precise in lm's QR for values far from
  // 0 for their spread); the intercept is taken back to 0 with its exact SE (the centered intercept is
  // uncorrelated with the slopes). A predictor the others already make (or constant): its
  // coefficient is NA, said by its number in `alias`.
  const code =
    `y<-${rVec(aligned[0])};X<-cbind(${predictors.map((_, i) => rVec(aligned[i + 1])).join(",")});` +
    `mx<-colMeans(X);my<-mean(y);m<-lm(I(y-my)~sweep(X,2,mx));al<-which(is.na(coef(m)[-1]));if(length(al))c(alias=unname(al[1])) else{` +
    `s<-summary(m);co<-s$coefficients;f<-s$fstatistic;V<-vcov(m)[-1,-1,drop=FALSE];` +
    `b0<-co[1,1]+my-sum(co[-1,1]*mx);se0<-sqrt(co[1,2]^2+drop(mx%*%V%*%mx));t0<-b0/se0;` +
    `co[1,]<-c(b0,se0,t0,2*pt(-abs(t0),df.residual(m)));` +
    `c(r2=s$r.squared,adjr2=s$adj.r.squared,fstat=unname(f[1]),n=length(y),` +
    `fp=unname(pf(f[1],f[2],f[3],lower.tail=FALSE)),` +
    Array.from(
      { length: p + 1 },
      (_, t) => `b${t}=co[${t + 1},1],se${t}=co[${t + 1},2],t${t}=co[${t + 1},3],pv${t}=co[${t + 1},4]`,
    ).join(",") +
    ")}";

  if (identical(aligned[0]))
    return { error: `“${dep.name}”'s values are all identical on the complete rows: there is nothing to explain.` };
  const v = await evalNamedVector(code);
  if (v.alias != null) {
    return {
      error:
        `“${predictors[v.alias - 1].name}” adds nothing the other predictors don't already give (it is constant ` +
        "on the complete rows, or a combination of the others): leave it out.",
    };
  }
  const terms = ["Intercept", ...predictors.map((c) => c.name)];
  const coefficients: RegressionCoefficient[] = terms.map((term, t) => ({
    term,
    estimate: v[`b${t}`] ?? null,
    stdError: v[`se${t}`] ?? null,
    t: v[`t${t}`] ?? null,
    p: v[`pv${t}`] ?? null,
  }));
  const { groups: described } = await describe(used);
  return {
    testType: "multiple-regression",
    subtitle: "Multiple linear regression",
    stats: [
      { label: "R squared", value: v.r2 },
      { label: "Adjusted R squared", value: v.adjr2 },
      { label: "F", value: v.fstat },
      pRow("P value (model)", v.fp ?? null),
      { label: "Complete rows (n)", value: v.n },
      { label: "Predictors", value: p },
    ],
    groups: described,
    notes:
      `Ordinary least-squares regression of “${dep.name}” on ${p} predictor(s), fit on ${n} complete rows. ` +
      "Each coefficient's P value tests whether that predictor's slope differs from zero, holding the others fixed.",
    coefficients,
  };
}
