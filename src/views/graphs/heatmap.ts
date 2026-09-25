// "Heatmap" (Multiple Variables table only): each column is a variable, each row
// a subject — the classic use for that table type. Cell color encodes magnitude
// via a Plotly colorscale; row order matches the table (Y axis reversed).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { heatmapLayout, rowCountOf, rowLabels } from "./plot-helpers";

const COLOR_SCALES: Record<GraphOptions["heatmapColorScale"], string> = {
  viridis: "Viridis",
  "red-blue": "RdBu",
  "yellow-red": "YlOrRd",
};

function build(columns: Column[], options: GraphOptions, _s?: unknown, _p?: unknown, titles?: (string | null)[]): GraphFigure {
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
        colorscale: COLOR_SCALES[options.heatmapColorScale],
        showscale: options.heatmapShowScale,
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

export const heatmap: GraphModule = { label: "Heatmap", family: "heatmap", build };
