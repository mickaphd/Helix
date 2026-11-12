// "XY scatter": each Y data set plotted against the shared X, as points, a
// connecting line, or both (Prism's Scatter / Scatter+line / Line-only icons
// collapsed into one graph type via a style toggle). Replicates are drawn each, or
// as each X's center with its error bars (`xyDrawn`).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { splitXY, type Column } from "../../lib/dataset";
import { seriesMarker, seriesPoints, xyDrawn, xyLayout, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const { x: xCol, ys } = splitXY(columns);
  if (!xCol || ys.length === 0) return { data: [], layout: xyLayout(options, columns[0]?.name ?? "X", 0) };

  const mode = options.xyStyle === "line" ? "lines" : options.xyStyle === "points+line" ? "lines+markers" : "markers";
  const data = ys.map((set, i) => {
    const drawn = xyDrawn(xCol, set, options);
    return {
      type: "scatter",
      mode,
      name: set.name,
      x: drawn.x,
      y: drawn.y,
      ...(mode !== "lines"
        ? drawn.keys
          ? seriesPoints(paint, set.name, i, drawn.keys)
          : { marker: seriesMarker(paint, set.name, i) }
        : {}),
      ...(mode !== "markers" ? { line: paint.line(set.name, i) } : {}),
      ...(drawn.errors ? { error_y: paint.errorBars(set.name, i, drawn.errors) } : {}),
      hoverinfo: "x+y",
    };
  });

  return { data, layout: xyLayout(options, xCol.name, ys.length) };
}

export const xyScatter: GraphModule = {
  label: "Scatter or line",
  family: "xy",
  points: (options) => options.xyStyle !== "line",
  lines: (options) => options.xyStyle !== "points",
  build,
};
