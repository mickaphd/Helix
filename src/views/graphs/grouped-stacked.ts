// Grouped "Stacked bars": groups stacked on top of each other at each row.
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedStacked: GraphModule = {
  label: "Stacked bars",
  family: "grouped",
  patterns: () => true,
  build: (columns, options, paint, titles) =>
    buildGroupedBars(columns, options, "stack", false, paint, titles),
};
