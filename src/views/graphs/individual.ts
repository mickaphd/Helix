// "Individual values": every data point as a jittered open circle, with a
// mean/median line per column, optional bars behind, and optional error bars.
// Each column is its own trace so it can carry its own series color.
import type { GraphOptions, PaletteColor } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { baseLayout, centers, errors, jitter, seriesColor, seriesFill, seriesPointMarker } from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";

function build(
  columns: Column[],
  options: GraphOptions,
  seriesColors?: Record<string, PaletteColor>,
  pointColors?: Record<string, PaletteColor>,
): GraphFigure {
  const center = centers(columns, options.center);
  const errs = errors(columns, options.error);
  const data: unknown[] = [];

  columns.forEach((c, i) => {
    const color = seriesColor(seriesColors, c.name, i);
    const fill = seriesFill(seriesColors, c.name, i);

    // Optional faint bar at the center value, behind the points.
    if (options.bars) {
      data.push({
        type: "bar",
        x: [i],
        y: [center[i]],
        width: 0.6,
        marker: { color: fill, line: { color, width: 1.5 } },
        hoverinfo: "skip",
      });
    }

    // Short horizontal line at this column's center value.
    data.push({
      type: "scatter",
      mode: "lines",
      x: [i - 0.28, i + 0.28],
      y: [center[i], center[i]],
      line: { color, width: 2 },
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
        error_y: { type: "data", array: [errs[i]], color, thickness: 1.5, width: 6 },
        hoverinfo: "skip",
      });
    }

    // This column's individual points.
    data.push({
      type: "scatter",
      mode: "markers",
      x: c.values.map((_, vi) => i + jitter(i, vi)),
      y: c.values,
      marker: seriesPointMarker(7, seriesColors, pointColors, c.name, i, c.rows.map((r) => pointKeyOf(c.name, r))),
      hoverinfo: "y",
    });
  });

  return { data, layout: baseLayout(options, columns.map((c) => c.name), { zeroBase: options.bars }) };
}

export const individual: GraphModule = { label: "Individual values", family: "column", build };
