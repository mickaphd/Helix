// "Residual plot": how far each point lies from its data set's straight line (least squares,
// `fitLinear`, R's lm), against X, around a line at 0: a pattern (a curve, a funnel) says the
// line or its constant scatter doesn't fit. Or (`residualsAs` "qq") the residuals' QQ plot:
// whether they are normal, as the regression assumes.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { splitXY, xyPoints, type Column } from "../../lib/dataset";
import { fitLinear } from "./regression-overlay";
import { INK, seriesMarker, xyLayout, type Paint } from "./plot-helpers";
import { qqTraces } from "./qq-plot";

/** Each Y data set's points (its replicates each) and their residuals on its line. */
export function residualsOf(columns: Column[]): { name: string; x: number[]; residuals: number[] }[] {
  const { x, ys } = splitXY(columns);
  if (!x) return [];
  return ys.flatMap((set) => {
    const pairs = xyPoints(x, set);
    const fit = fitLinear(pairs.x, pairs.y, false);
    return fit
      ? [{ name: set.name, x: pairs.x, residuals: pairs.y.map((y, i) => y - (fit.intercept + fit.slope * pairs.x[i])) }]
      : [];
  });
}

function build(columns: Column[], given: GraphOptions, paint: Paint): GraphFigure {
  const options: GraphOptions = { ...given, yScale: "linear" };
  const sets = residualsOf(columns);
  if (options.residualsAs === "qq")
    return {
      data: qqTraces(
        sets.map((s) => ({ name: s.name, values: s.residuals })),
        paint,
      ),
      layout: xyLayout({ ...options, xScale: "linear" }, "Normal quantile (z)", sets.length, { yName: "Residual" }),
    };
  const xName = splitXY(columns).x?.name ?? "X";
  const data = sets.map((s, i) => ({
    type: "scatter",
    mode: "markers",
    name: s.name,
    x: s.x,
    y: s.residuals,
    marker: seriesMarker(paint, s.name, i),
    hoverinfo: "x+y",
  }));
  const layout = xyLayout(options, xName, sets.length, { yName: "Residual" });
  // The line at 0, across the plot.
  layout.shapes = [
    { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 0, y1: 0, line: { color: INK, width: 1, dash: "dot" } },
  ];
  return { data, layout };
}

export const residuals: GraphModule = {
  label: "Residual plot",
  family: "xy",
  // Residuals lie either side of 0: no log scale on Y, nor on X for their quantiles.
  axes: (options) => ({ x: options.residualsAs === "qq" ? "range" : "scale", y: "range" }),
  points: () => true,
  build,
};
