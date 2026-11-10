// Area under the curve for an XY table: trapezoidal-rule AUC of each Y series against X,
// measured from a horizontal baseline (Prism's "Baseline Y =", default 0), computed by R.
import type { AnalysisOutcome, AreaUnderCurveParams, AreaUnderCurveRow, Column } from "../types";
import { describe, rVec } from "../column/base";
import { pairUp, splitXY, xyProblem } from "../../lib/dataset";
import { evalNamedVector } from "../webr";

export async function runAreaUnderCurve(
  columns: Column[],
  params: AreaUnderCurveParams | undefined,
): Promise<AnalysisOutcome> {
  const baseline = params?.baseline ?? 0;
  const { x: xCol, ys: yCols } = splitXY(columns);
  if (!xCol || yCols.length < 1) return { error: xyProblem(columns)! };

  // Each series' points sorted by X; heights from the baseline, so area below it is negative.
  const pairs = yCols.map((y) => pairUp(xCol, y));
  const v = await evalNamedVector(
    `auc<-function(x,y){if(length(x)<2)return(NA);o<-order(x);x<-x[o];y<-y[o]-${baseline};` +
      `sum(diff(x)*(head(y,-1)+tail(y,-1))/2)};` +
      `c(${pairs.map((p, i) => `a_${i}=auc(${rVec(p.x)},${rVec(p.y)}),n_${i}=${p.x.length}`).join(",")})`,
  );
  const areas: AreaUnderCurveRow[] = yCols.map((y, i) => ({
    variable: y.name,
    area: v[`a_${i}`] ?? null,
    n: v[`n_${i}`] ?? 0,
  }));

  return {
    testType: "area-under-curve",
    subtitle: `Area under the curve (trapezoidal rule, baseline Y = ${baseline})`,
    stats: [],
    groups: (await describe([xCol, ...yCols])).groups,
    notes:
      `Trapezoidal-rule area under the curve for each Y data set vs. X, measured from a baseline of Y = ${baseline}. ` +
      "Area below the baseline counts as negative. Points are sorted by X first; a data set needs at least 2 points.",
    areas,
  };
}
