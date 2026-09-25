// Grouped "Interleaved bars": one bar per group, side-by-side at each row.
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedBars: GraphModule = {
  label: "Interleaved bars",
  family: "grouped",
  build: (columns, options, seriesColors, _points, titles) =>
    buildGroupedBars(columns, options, "group", false, seriesColors, titles),
};
