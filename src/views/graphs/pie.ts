// "Pie / donut": one slice per column, sized by the column's total (sum) or mean,
// each colored as a series. Donut is the same chart with a hole in the center.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { PATTERN_LOOK, pieLayout, mean, type Paint } from "./plot-helpers";

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

function makePie(hole: number, label: string): GraphModule {
  const build = (columns: Column[], options: GraphOptions, paint: Paint): GraphFigure => {
    // Slices take their series' fill, outline and pattern (none: "" draws nothing).
    const fills = columns.map((c, i) => paint.fill(c.name, i));
    const patterns = columns.map((c, i) => paint.pattern(c.name, i));
    return {
      data: [
        {
          type: "pie",
          hole,
          labels: columns.map((c) => c.name),
          values: columns.map((c) => (options.pieValue === "mean" ? mean(c.values) : sum(c.values))),
          // By default, solid slices that a thin white gap separates.
          marker: {
            colors: fills,
            line: { color: columns.map((c, i) => paint.edge(c.name, i).color), width: options.outline },
            ...(patterns.some(Boolean) && {
              pattern: {
                shape: patterns.map((p) => p?.shape ?? ""),
                fgcolor: patterns.map((p) => p?.fgcolor ?? ""),
                bgcolor: patterns.map((p, i) => p?.bgcolor ?? fills[i]),
                ...PATTERN_LOOK,
              },
            }),
          },
          textinfo: options.pieShowPercent ? "label+percent" : "label+value",
          textposition: "auto",
          automargin: true, // labels drawn outside a thin slice widen the margins
          // Keep the table's column order (Prism-style) rather than sorting by size.
          sort: false,
          hoverinfo: "label+value+percent",
        },
      ],
      layout: pieLayout(options),
    };
  };
  // Solid slices (Helix 1.0's too) apart by a white outline.
  return { label, family: "pie", defaults: { fill: 1, outlineColor: "#FFFFFF" }, patterns: () => true, build };
}

export const pie = makePie(0, "Pie");
export const donut = makePie(0.5, "Donut");
