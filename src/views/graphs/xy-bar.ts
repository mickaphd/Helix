// "XY column / bar": each Y data set drawn as bars against the shared X, grouped
// side-by-side at each X value when there's more than one data set (replicates as each
// X's center with its error bars, `xyDrawn`).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { splitXY, type Column } from "../../lib/dataset";
import { xyDrawn, xyLayout, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const { x: xCol, ys } = splitXY(columns);
  if (!xCol || ys.length === 0) return { data: [], layout: xyLayout(options, columns[0]?.name ?? "X", 0) };

  const data = ys.map((set, i) => {
    // A bar stands for one value per X: replicates as their center, whatever `xyReplicates`.
    const drawn = xyDrawn(xCol, set, { ...options, xyReplicates: "mean" });
    return {
      type: "bar",
      name: set.name,
      x: drawn.x,
      y: drawn.y,
      marker: paint.bars(set.name, i),
      ...(drawn.errors ? { error_y: paint.errorBars(set.name, i, drawn.errors) } : {}),
      hoverinfo: "x+y",
    };
  });

  // An X's bars apart by `barGap`, so their outlines never overlap.
  return {
    data,
    layout: {
      ...xyLayout(options, xCol.name, ys.length, { zeroBase: true }),
      barmode: "group",
      bargroupgap: options.barGap,
    },
  };
}

export const xyBar: GraphModule = { label: "Column or bar", family: "xy", patterns: () => true, build };
