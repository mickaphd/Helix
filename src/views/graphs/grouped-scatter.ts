// Grouped "Interleaved scatter" (individual values): every replicate as a
// jittered point, groups fanned out within each row, with a center line + error.
import type { GraphModule } from ".";
import { buildGroupedScatter } from "./grouped-common";

export const groupedScatter: GraphModule = {
  label: "Interleaved scatter",
  family: "grouped",
  build: buildGroupedScatter,
};
