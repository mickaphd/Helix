// "Dose response curve": one-click XY graph — points only (Prism's dose-response
// convention pairs raw points with the sigmoidal fit, never a connecting line),
// reusing XY scatter's build. The fitted 4PL curve itself is overlaid by
// graph-view (needs a WebR round-trip — see dose-response-curve.ts).
import type { GraphModule } from ".";
import { xyScatter } from "./xy-scatter";

export const doseResponse: GraphModule = {
  label: "Dose response curve",
  family: "xy",
  build: (columns, options, seriesColors, pointColors) =>
    xyScatter.build(columns, { ...options, xyStyle: "points" }, seriesColors, pointColors),
};
