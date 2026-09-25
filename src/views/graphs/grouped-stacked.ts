// Grouped "Stacked bars": groups stacked on top of each other at each row.
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedStacked: GraphModule = {
  label: "Stacked bars",
  family: "grouped",
  build: (columns, options, seriesColors, _points, titles) =>
    buildGroupedBars(columns, options, "stack", false, seriesColors, titles),
};
