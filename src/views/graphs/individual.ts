// "Individual values": every data point, jittered, with a mean/median line per
// column, optional bars behind, and optional error bars.
// Each column is its own trace so it can carry its own series color.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { baseLayout, centers, errors, jitter, seriesPoints, type Paint } from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";

function build(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
): GraphFigure {
  const center = centers(columns, options.center);
  const errs = errors(columns, options.error);
  const data: unknown[] = [];

  columns.forEach((c, i) => {
    // Optional bar at the center value, behind the points.
    if (options.bars) {
      data.push({
        type: "bar",
        x: [i],
        y: [center[i]],
        width: 0.6,
        marker: paint.bars(c.name, i),
        hoverinfo: "skip",
      });
    }

    // Short horizontal line at this column's center value.
    data.push({
      type: "scatter",
      mode: "lines",
      x: [i - 0.28, i + 0.28],
      y: [center[i], center[i]],
      line: paint.centerLine(c.name, i),
      hoverinfo: "skip",
    });

    // Error whiskers on an invisible marker at the center.
    if (errs) {
      data.push({
        type: "scatter",
        mode: "markers",
        x: [i],
        y: [center[i]],
        marker: { opacity: 0 },
        error_y: paint.errorBars(c.name, i, [errs[i]]),
        hoverinfo: "skip",
      });
    }

    // This column's individual points.
    data.push({
      type: "scatter",
      mode: "markers",
      x: c.values.map((_, vi) => i + jitter(i, vi)),
      y: c.values,
      ...seriesPoints(paint, c.name, i, c.rows.map((r) => pointKeyOf(c.name, r))),
      hoverinfo: "y",
    });
  });

  return { data, layout: baseLayout(options, columns.map((c) => c.name), { zeroBase: options.bars }) };
}

export const individual: GraphModule = {
  label: "Individual values",
  family: "column",
  defaults: { fill: 0.5 },
  points: () => true,
  patterns: (options) => options.bars,
  build,
};
