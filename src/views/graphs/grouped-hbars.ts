// Grouped "Horizontal bars": interleaved bars with categories on the Y axis.
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedHbars: GraphModule = {
  label: "Horizontal bars",
  family: "grouped",
  build: (columns, options, seriesColors, _points, titles) =>
    buildGroupedBars(columns, options, "group", true, seriesColors, titles),
};
