// Grouped "Connected lines": one line per group through its per-row centers —
// Prism's interaction graph, highlighting how groups track across the rows.
import type { GraphModule } from ".";
import { buildGroupedLines } from "./grouped-common";

export const groupedLines: GraphModule = {
  label: "Connected lines",
  family: "grouped",
  build: (columns, options, seriesColors, _points, titles) => buildGroupedLines(columns, options, seriesColors, titles),
};
