// "XY scatter": each Y series plotted against the shared X, as points, a
// connecting line, or both (Prism's Scatter / Scatter+line / Line-only icons
// collapsed into one graph type via a style toggle).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { pairUp, type Column } from "../../lib/dataset";
import { seriesPoints, xyLayout, type Paint } from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";

function build(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
): GraphFigure {
  const [xCol, ...ySeries] = columns;
  if (!xCol || ySeries.length === 0) return { data: [], layout: xyLayout(options, xCol?.name ?? "X", 0) };

  const mode =
    options.xyStyle === "line" ? "lines" : options.xyStyle === "points+line" ? "lines+markers" : "markers";
  const data = ySeries.map((y, i) => {
    const { x, y: yy, rows } = pairUp(xCol, y);
    return {
      type: "scatter",
      mode,
      name: y.name,
      x,
      y: yy,
      ...(mode !== "lines"
        ? seriesPoints(paint, y.name, i, rows.map((r) => pointKeyOf(y.name, r)))
        : {}),
      ...(mode !== "markers" ? { line: paint.line(y.name, i) } : {}),
      hoverinfo: "x+y",
    };
  });

  return { data, layout: xyLayout(options, xCol.name, ySeries.length) };
}

export const xyScatter: GraphModule = {
  label: "Scatter / line",
  family: "xy",
  points: (options) => options.xyStyle !== "line",
  lines: (options) => options.xyStyle !== "points",
  build,
};
