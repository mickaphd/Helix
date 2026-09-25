// Area under the curve for an XY table: trapezoidal-rule AUC of each Y series
// against X, measured from a horizontal baseline (Prism's "Baseline Y =", default
// 0). Pure arithmetic — no R needed.
import type { AnalysisOutcome, AreaUnderCurveParams, AreaUnderCurveRow, Column } from "../types";
import { describe } from "../column/base";
import { pairUp, splitXY } from "../../lib/dataset";

export async function runAreaUnderCurve(
  columns: Column[],
  params: AreaUnderCurveParams | undefined,
): Promise<AnalysisOutcome> {
  const baseline = params?.baseline ?? 0;
  const { x: xCol, ys: yCols } = splitXY(columns);
  if (!xCol || yCols.length < 1) {
    return { error: "Area under the curve needs an X column and at least one Y column with numeric data." };
  }

  const areas: AreaUnderCurveRow[] = yCols.map((y) => {
    const { x, y: yy } = pairUp(xCol, y);
    const points = x.map((xv, i): [number, number] => [xv, yy[i]]);
    points.sort((a, b) => a[0] - b[0]);
    let area = 0;
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      // Heights are measured from the baseline; area below the baseline is negative.
      area += ((y0 - baseline + (y1 - baseline)) / 2) * (x1 - x0);
    }
    return { variable: y.name, area: points.length >= 2 ? area : null, n: points.length };
  });

  const described = [xCol, ...yCols].map(describe);
  return {
    testType: "area-under-curve",
    subtitle: `Area under the curve (trapezoidal rule, baseline Y = ${baseline})`,
    stats: [],
    groups: described,
    notes:
      `Trapezoidal-rule area under the curve for each Y series vs. X, measured from a baseline of Y = ${baseline}. ` +
      "Area below the baseline counts as negative. Points are sorted by X first; a series needs at least 2 points to compute.",
    areas,
  };
}
