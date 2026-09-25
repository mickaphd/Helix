// "XY area": each Y series drawn as a line with the area beneath it filled,
// against the shared X.
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
      type: "scatter",
      mode: "lines",
      name: y.name,
      x,
      y: yy,
      line: { color: seriesColor(seriesColors, y.name, i), width: 2 },
      fill: "tozeroy",
      fillcolor: seriesFill(seriesColors, y.name, i),
      hoverinfo: "x+y",
    };
  });

  return { data, layout: xyLayout(options, xCol.name, ySeries.length, { zeroBase: true }) };
}

export const xyArea: GraphModule = { label: "Area", family: "xy", build };
