// "XY column / bar": each Y series drawn as bars against the shared X, grouped
// side-by-side at each X value when there's more than one series.
import type { GraphOptions, PaletteColor } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { pairUp, type Column } from "../../lib/dataset";
import { seriesColor, seriesFill, xyLayout } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, seriesColors?: Record<string, PaletteColor>): GraphFigure {
  const [xCol, ...ySeries] = columns;
  if (!xCol || ySeries.length === 0) return { data: [], layout: xyLayout(options, xCol?.name ?? "X", 0) };

  const data = ySeries.map((y, i) => {
    const { x, y: yy } = pairUp(xCol, y);
    return {
      type: "bar",
      name: y.name,
      x,
      y: yy,
      marker: { color: seriesFill(seriesColors, y.name, i), line: { color: seriesColor(seriesColors, y.name, i), width: 1.5 } },
      hoverinfo: "x+y",
    };
  });

  return { data, layout: { ...xyLayout(options, xCol.name, ySeries.length, { zeroBase: true }), barmode: "group" } };
}

export const xyBar: GraphModule = { label: "Column / bar", family: "xy", build };
