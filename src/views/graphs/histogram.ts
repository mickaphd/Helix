// "Histogram": how each data set's values spread, as the count (or percent) of them in
// each bin; bins shared by every data set (lib/histogram.ts: R's hist()), drawn over one
// another, so their fill shows the others.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { binCounts, binEdges } from "../../lib/histogram";
import { xyLayout, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const edges = binEdges(
    columns.flatMap((c) => c.values),
    options.binWidth,
  );
  const percent = options.stackAs === "percent";
  const data = columns.map((c, i) => {
    const counts = binCounts(c.values, edges);
    return {
      type: "bar",
      name: c.name,
      x: counts.map((_, j) => (edges[j] + edges[j + 1]) / 2),
      y: percent ? counts.map((n) => (100 * n) / c.values.length) : counts,
      width: counts.map((_, j) => edges[j + 1] - edges[j]),
      marker: paint.bars(c.name, i),
      hoverinfo: "x+y",
    };
  });
  return {
    data,
    layout: {
      // Its X holds values cut into bins: always linear, titled by a lone data set's name.
      ...xyLayout({ ...options, xScale: "linear" }, columns.length === 1 ? columns[0].name : "", columns.length, {
        zeroBase: true,
        yName: percent ? "Percent of total" : "Count",
      }),
      barmode: "overlay",
    },
  };
}

export const histogram: GraphModule = { label: "Histogram", family: "histogram", defaults: { fill: 0.5 }, build };
