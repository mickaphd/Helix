// "Box and violin": a box (quartiles and min–max whiskers, Helix's: `boxTrace`) or violin per column, with optional
// individual points drawn over it. Each column is its own trace so it can carry its
// own series color; its points are a trace of their own, as on Individual values,
// so each can carry its own style (Plotly's box points take one color for all).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { baseLayout, boxTrace, columnPoints, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const data: unknown[] = [];
  columns.forEach((c, i) => {
    const shape = {
      x: c.values.map(() => i),
      y: c.values,
      fillcolor: paint.fill(c.name, i),
      line: paint.edge(c.name, i),
      hoverinfo: "y",
    };
    data.push(
      options.kind === "violin"
        ? { type: "violin", ...shape, points: false, meanline: { visible: true }, spanmode: "hard" }
        : { type: "box", ...shape, ...boxTrace([i], [c.values]), y: undefined, boxpoints: false, whiskerwidth: 0.5 },
    );
    if (options.showPoints) data.push(columnPoints(paint, c, i));
  });

  return {
    data,
    layout: baseLayout(
      options,
      columns.map((c) => c.name),
    ),
  };
}

export const boxViolin: GraphModule = {
  label: "Box and violin",
  family: "column",
  defaults: { fill: 0.5, pointSize: 5, outline: 2 },
  points: (options) => options.showPoints,
  build,
};
