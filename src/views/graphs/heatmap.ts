// "Heatmap" (Multiple Variables table only): each column is a variable, each row
// a subject — the classic use for that table type. Cell color encodes magnitude
// along the graph's palette; row order matches the table (Y axis reversed).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { colorscaleOf, paletteOf } from "../../lib/palettes";
import { heatmapLayout, rowCountOf, rowLabels, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, _paint: Paint, titles?: (string | null)[]): GraphFigure {
  const rows = rowCountOf(columns);
  const y = rowLabels(rows, titles);
  const z: (number | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    z.push(columns.map((c) => c.byRow[r] ?? null));
  }
  return {
    data: [
      {
        type: "heatmap",
        x: columns.map((c) => c.name),
        y,
        z,
        colorscale: colorscaleOf(paletteOf(options)),
        showscale: options.heatmapShowScale,
        // Its color legend: right of the cells, or where it was moved.
        ...(options.legend && { colorbar: options.legend }),
        hoverongaps: false,
        ...(options.heatmapShowValues
          ? { texttemplate: "%{z}", textfont: { size: Math.max(options.fontSize - 3, 8) } }
          : {}),
      },
    ],
    layout: heatmapLayout(
      options,
      columns.map((c) => c.name),
      y,
    ),
  };
}

export const heatmap: GraphModule = { label: "Heatmap", family: "heatmap", palette: "viridis", build };
