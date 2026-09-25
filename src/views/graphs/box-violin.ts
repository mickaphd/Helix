// "Box and violin": a box (min–max whiskers) or violin per column, with optional
// overlaid individual points. Each column is its own trace so it can carry its
// own series color.
import type { GraphOptions, PaletteColor } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { baseLayout, seriesColor, seriesFill, seriesPointMarker } from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";

function build(
  columns: Column[],
  options: GraphOptions,
  seriesColors?: Record<string, PaletteColor>,
  pointColors?: Record<string, PaletteColor>,
): GraphFigure {
  const data = columns.map((c, i) => {
    const color = seriesColor(seriesColors, c.name, i);
    const fill = seriesFill(seriesColors, c.name, i);
    const common = {
      x: c.values.map(() => i),
      y: c.values,
      fillcolor: fill,
      line: { color },
      marker: seriesPointMarker(5, seriesColors, pointColors, c.name, i, c.rows.map((r) => pointKeyOf(c.name, r))),
      hoverinfo: "y" as const,
    };

    return options.kind === "violin"
      ? { type: "violin", ...common, points: options.showPoints ? "all" : false, jitter: 0.3, meanline: { visible: true }, spanmode: "hard" }
      : { type: "box", ...common, boxpoints: options.showPoints ? "all" : false, jitter: 0.3, whiskerwidth: 0.5 };
  });

  return { data, layout: baseLayout(options, columns.map((c) => c.name)) };
}

export const boxViolin: GraphModule = { label: "Box and violin", family: "column", build };
