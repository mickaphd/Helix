// Grouped "Interleaved bars": one bar per group, side-by-side at each row.
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedBars: GraphModule = {
  label: "Interleaved bars",
  family: "grouped",
  patterns: () => true,
  build: (columns, options, paint, titles) =>
    buildGroupedBars(columns, options, "group", false, paint, titles),
};
