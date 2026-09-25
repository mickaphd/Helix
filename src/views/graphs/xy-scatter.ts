// "XY scatter": each Y series plotted against the shared X, as points, a
// connecting line, or both (Prism's Scatter / Scatter+line / Line-only icons
// collapsed into one graph type via a style toggle).
import type { GraphOptions, PaletteColor } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { pairUp, type Column } from "../../lib/dataset";
import { seriesColor, seriesPointMarker, xyLayout } from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";

function build(
  columns: Column[],
  options: GraphOptions,
  seriesColors?: Record<string, PaletteColor>,
  pointColors?: Record<string, PaletteColor>,
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
        ? { marker: seriesPointMarker(7, seriesColors, pointColors, y.name, i, rows.map((r) => pointKeyOf(y.name, r))) }
        : {}),
      ...(mode !== "markers" ? { line: { color: seriesColor(seriesColors, y.name, i), width: 2 } } : {}),
      hoverinfo: "x+y",
    };
  });

  return { data, layout: xyLayout(options, xCol.name, ySeries.length) };
}

export const xyScatter: GraphModule = { label: "Scatter / line", family: "xy", build };
