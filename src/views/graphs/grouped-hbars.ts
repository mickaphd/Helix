// Grouped "Horizontal bars": interleaved bars with categories on the Y axis.
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedHbars: GraphModule = {
  label: "Horizontal bars",
  family: "grouped",
  axes: () => ({ x: "scale", y: "labels" }),
  horizontal: true,
  patterns: () => true,
  build: (columns, options, paint, titles) => buildGroupedBars(columns, options, "group", true, paint, titles),
};
