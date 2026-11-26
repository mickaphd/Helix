// Grouped "Stacked bars": groups stacked on top of each other at each row. Their value axis
// stays linear: on a log scale, a slice's height no longer says its value (nor its percent).
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedStacked: GraphModule = {
  label: "Stacked bars",
  family: "grouped",
  axes: () => ({ x: "labels", y: "range" }),
  patterns: () => true,
  build: (columns, options, paint, titles) =>
    buildGroupedBars(columns, { ...options, yScale: "linear" }, "stack", false, paint, titles),
};
