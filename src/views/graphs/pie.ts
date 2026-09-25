// "Pie / donut": one slice per column, sized by the column's total (sum) or mean.
// Slice colors follow the shared series palette so a pie matches the table's own
// column colors and every other graph drawn from the same table. Donut is the same
// chart with a hole in the center.
import type { GraphOptions, PaletteColor } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { pieLayout, seriesColor, mean } from "./plot-helpers";

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

function makePie(hole: number, label: string): GraphModule {
  const build = (
    columns: Column[],
    options: GraphOptions,
    seriesColors?: Record<string, PaletteColor>,
  ): GraphFigure => ({
    data: [
      {
        type: "pie",
        hole,
        labels: columns.map((c) => c.name),
        values: columns.map((c) => (options.pieValue === "mean" ? mean(c.values) : sum(c.values))),
        // Solid palette color per slice; a thin white gap separates neighbours.
        marker: { colors: columns.map((c, i) => seriesColor(seriesColors, c.name, i)), line: { color: "#ffffff", width: 1.5 } },
        textinfo: options.pieShowPercent ? "label+percent" : "label+value",
        textposition: "auto",
        automargin: true, // labels drawn outside a thin slice widen the margins
        // Keep the table's column order (Prism-style) rather than sorting by size.
        sort: false,
        hoverinfo: "label+value+percent",
      },
    ],
    layout: pieLayout(options),
  });
  return { label, family: "pie", build };
}

export const pie = makePie(0, "Pie");
export const donut = makePie(0.5, "Donut");
