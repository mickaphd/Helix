// "Mean / median & error": the center (mean or median) per column shown as bars,
// points, or a connected line, with optional SD/SEM error bars. Each column's
// marker/bar/error whisker is its own trace so it can carry its own series color;
// the "line" shape's connector between columns is a single neutral trace underneath
// (Plotly can't vary a single line's color per segment).
import type { GraphOptions, PaletteColor } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { baseLayout, centers, errors, seriesColor, seriesFill } from "./plot-helpers";

const CONNECTOR = "#9ca3af"; // neutral gray — just a connector, not a series color

function build(columns: Column[], options: GraphOptions, seriesColors?: Record<string, PaletteColor>): GraphFigure {
  const idx = columns.map((_, i) => i);
  const y = centers(columns, options.center);
  const errs = errors(columns, options.error);
  const data: unknown[] = [];

  if (options.shape === "line") {
    data.push({ type: "scatter", mode: "lines", x: idx, y, line: { color: CONNECTOR, width: 2 }, hoverinfo: "skip" });
  }

  columns.forEach((c, i) => {
    const color = seriesColor(seriesColors, c.name, i);
    const fill = seriesFill(seriesColors, c.name, i);
    const error_y = errs ? { type: "data", array: [errs[i]], color, thickness: 1.5, width: 6 } : { visible: false };

    data.push(
      options.shape === "bar"
        ? { type: "bar", x: [i], y: [y[i]], width: 0.6, marker: { color: fill, line: { color, width: 1.5 } }, error_y, hoverinfo: "y" }
        : {
            type: "scatter",
            mode: "markers",
            x: [i],
            y: [y[i]],
            marker: { color: fill, size: 9, line: { color, width: 1.5 } },
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

export const meanError: GraphModule = { label: "Mean / median & error", family: "column", build };
