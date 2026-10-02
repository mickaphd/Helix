// "XY column / bar": each Y series drawn as bars against the shared X, grouped
// side-by-side at each X value when there's more than one series.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { pairUp, type Column } from "../../lib/dataset";
import { xyLayout, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const [xCol, ...ySeries] = columns;
  if (!xCol || ySeries.length === 0) return { data: [], layout: xyLayout(options, xCol?.name ?? "X", 0) };

  const data = ySeries.map((y, i) => {
    const { x, y: yy } = pairUp(xCol, y);
    return {
      type: "bar",
      name: y.name,
      x,
      y: yy,
      marker: paint.bars(y.name, i),
      hoverinfo: "x+y",
    };
  });

  // An X's bars apart by `barGap`, so their outlines never overlap.
  return { data, layout: { ...xyLayout(options, xCol.name, ySeries.length, { zeroBase: true }), barmode: "group", bargroupgap: options.barGap } };
}

export const xyBar: GraphModule = { label: "Column / bar", family: "xy", patterns: () => true, build };
