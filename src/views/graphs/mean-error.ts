// "Mean / median & error": the center (mean or median) per column shown as bars,
// points, or a connected line, with optional SD/SEM error bars. Each column's
// marker/bar/error whisker is its own trace so it can carry its own series color;
// the "line" shape's connector between columns is a single gray trace underneath,
// in the graph's line thickness and dashes (Plotly can't vary a single line's color
// per segment).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { baseLayout, centers, errors, GUIDE, seriesMarker, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const idx = columns.map((_, i) => i);
  const y = centers(columns, options.center);
  const errs = errors(columns, options.error);
  const data: unknown[] = [];

  if (options.shape === "line") {
    data.push({ type: "scatter", mode: "lines", x: idx, y, line: { color: GUIDE, width: options.lineWidth, dash: options.lineDash }, hoverinfo: "skip" });
  }

  columns.forEach((c, i) => {
    const error_y = errs ? paint.errorBars(c.name, i, [errs[i]]) : { visible: false };

    data.push(
      options.shape === "bar"
        ? { type: "bar", x: [i], y: [y[i]], width: 0.6, marker: paint.bars(c.name, i), error_y, hoverinfo: "y" }
        : {
            type: "scatter",
            mode: "markers",
            x: [i],
            y: [y[i]],
            marker: seriesMarker(paint, c.name, i),
            error_y,
            hoverinfo: "y",
          },
    );
  });

  return {
    data,
    layout: baseLayout(options, columns.map((c) => c.name), { zeroBase: options.shape === "bar" }),
  };
}

export const meanError: GraphModule = {
  label: "Mean / median & error",
  family: "column",
  defaults: { pointSize: 9 },
  points: (options) => options.shape !== "bar",
  lines: (options) => options.shape === "line",
  patterns: (options) => options.shape === "bar",
  build,
};
