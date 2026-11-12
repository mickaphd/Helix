// Simple logistic regression of an XY table: the chance that Y is 1 (an event, a response)
// rather than 0, as X changes, P = 1 / (1 + e^−(B0 + B1·X)). Computed by R's glm (binomial):
// its coefficients (Wald z, profile-likelihood 95% CIs), the odds ratio per unit of X, the
// likelihood-ratio test of the model, the X at a 50% chance and Tjur's R².
import type { AnalysisOutcome, Column, LogisticRegressionParams, RegressionCoefficient } from "../types";
import { describe, pRow, rVec } from "../column/base";
import { splitXY, xyPoints, xyProblem } from "../../lib/dataset";
import { evalNamedVector } from "../webr";

/** R: the fit of `y` (0 and 1) on `x`; NA where the data separate perfectly (an X splits
 *  the 0s from the 1s), as glm's estimates then run off. */
const R_LOGISTIC =
  `m<-suppressWarnings(glm(y~x,family=binomial));s<-summary(m)$coefficients;p<-fitted(m)\n` +
  `sep<-max(x[y==0])<min(x[y==1])||max(x[y==1])<min(x[y==0])\n` +
  `ci<-if(sep)matrix(NA,2,2) else suppressMessages(suppressWarnings(confint(m)))\n` +
  `c(b0=s[1,1],se0=s[1,2],z0=s[1,3],p0=s[1,4],lo0=ci[1,1],hi0=ci[1,2],` +
  `b1=s[2,1],se1=s[2,2],z1=s[2,3],p1=s[2,4],lo1=ci[2,1],hi1=ci[2,2],` +
  `or=exp(s[2,1]),orlo=exp(ci[2,1]),orhi=exp(ci[2,2]),x50=-s[1,1]/s[2,1],` +
  `lr=pchisq(m$null.deviance-m$deviance,1,lower.tail=FALSE),tjur=mean(p[y==1])-mean(p[y==0]),` +
  `n=length(y),n1=sum(y),n0=sum(y==0),sep=sep)`;

export async function runLogisticRegression(
  columns: Column[],
  params: LogisticRegressionParams | undefined,
): Promise<AnalysisOutcome> {
  const { x, ys } = splitXY(columns);
  const y = params?.y === undefined ? ys[0] : ys.find((s) => s.name === params.y);
  if (!x || !y) return { error: xyProblem(columns, params?.y)! };
  const points = xyPoints(x, y);
  const code = points.y.find((v) => v !== 0 && v !== 1);
  if (code !== undefined) return { error: `“${y.name}” holds ${code}: enter 1 for an event, 0 for none.` };
  const [n0, n1] = [points.y.filter((v) => v === 0).length, points.y.filter((v) => v === 1).length];
  if (n0 < 2 || n1 < 2) return { error: `“${y.name}” needs at least two 0s and two 1s to fit a logistic curve.` };

  const v = await evalNamedVector(`x<-${rVec(points.x)};y<-${rVec(points.y)}\n${R_LOGISTIC}`);
  if (v.sep === 1) {
    return {
      error:
        `In “${y.name}”, an X splits the 0s from the 1s exactly (every 0 below it, every 1 above, or the ` +
        "reverse): the logistic curve is then a step, its slope endless, and can't be estimated.",
    };
  }
  const coefficients: RegressionCoefficient[] = (["B0", "B1"] as const).map((term, i) => ({
    term: term === "B0" ? "B0 (intercept)" : "B1 (slope)",
    estimate: v[`b${i}`] ?? null,
    stdError: v[`se${i}`] ?? null,
    t: v[`z${i}`] ?? null,
    p: v[`p${i}`] ?? null,
    low: v[`lo${i}`] ?? null,
    high: v[`hi${i}`] ?? null,
  }));
  return {
    testType: "logistic-regression",
    subtitle: "Simple logistic regression",
    stats: [
      { label: "Odds ratio (per unit of X)", value: v.or ?? null },
      { label: "Odds ratio 95% CI lower", value: v.orlo ?? null },
      { label: "Odds ratio 95% CI upper", value: v.orhi ?? null },
      { label: "X at 50% probability", value: v.x50 ?? null },
      { label: "Tjur's R squared", value: v.tjur ?? null },
      pRow("P value (likelihood ratio test)", v.lr ?? null),
      { label: "N", value: v.n ?? null },
      { label: "Number of 0s", value: v.n0 ?? null },
      { label: "Number of 1s", value: v.n1 ?? null },
    ],
    coefficients,
    coefficientStatistic: "z",
    groups: (await describe([x, { name: y.name, values: points.y }])).groups,
    notes:
      `Logistic regression of “${y.name}” (1 or 0) on “${x.name}”: the probability that Y is 1, ` +
      "P = 1 / (1 + e^−(B0 + B1·X)), fitted by maximum likelihood. The odds ratio is e^B1, how the odds " +
      "of a 1 are multiplied for each unit of X; the CIs are profile likelihood ones. The P value tests the " +
      "model against none (likelihood ratio); Tjur's R² is the mean probability of the 1s minus that of the 0s.",
  };
}
