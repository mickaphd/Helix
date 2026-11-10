// Grouped "Box and violin": at each row, a box (min–max whiskers) or violin per group
// drawn from its replicates, groups side by side as on Interleaved scatter (or in
// blocks, "Separated"). One shape trace per group, so each carries its series color;
// its points are a trace of their own at Interleaved scatter's places, so a point
// keeps its place and its own style from one graph to the other.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { groupsOf, type Column } from "../../lib/dataset";
import {
  groupOffset,
  groupedScatterLayout,
  jitter,
  rowCountOf,
  rowLabels,
  separatedPositions,
  seriesPoints,
  type Paint,
} from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";

function build(columns: Column[], options: GraphOptions, paint: Paint, titles?: (string | null)[]): GraphFigure {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const total = groups.length;
  const separated = options.groupLayout === "separated" ? separatedPositions(total, labels) : undefined;
  // A shape fills most of the room its group has in a row, never more than a column's.
  const width = separated || total < 2 ? 0.5 : Math.min(0.5, (0.56 / (total - 1)) * 0.8);
  const data: unknown[] = [];

  groups.forEach((g, gi) => {
    const basePos = (r: number) => (separated ? separated.posOf(gi, r) : r + groupOffset(gi, total));
    const x: number[] = [];
    const y: number[] = [];
    const px: number[] = [];
    const keys: string[] = [];
    for (let r = 0; r < rows; r++) {
      g.columns.forEach((c, ci) => {
        const v = c.byRow[r] ?? null;
        if (v == null) return;
        x.push(basePos(r));
        y.push(v);
        px.push(basePos(r) + jitter(gi, r * 10 + ci) * 0.4);
        keys.push(pointKeyOf(c.name, r));
      });
    }
    const shape = {
      name: g.name,
      x,
      y,
      width,
      fillcolor: paint.fill(g.name, gi),
      line: paint.edge(g.name, gi),
      hoverinfo: "y",
    };
    data.push(
      options.kind === "violin"
        ? { type: "violin", ...shape, points: false, meanline: { visible: true }, spanmode: "hard" }
        : { type: "box", ...shape, boxpoints: false, whiskerwidth: 0.5 },
    );
    if (options.showPoints) {
      data.push({
        type: "scatter",
        mode: "markers",
        x: px,
        y,
        ...seriesPoints(paint, g.name, gi, keys),
        hoverinfo: "y",
        showlegend: false,
      });
    }
  });

  return { data, layout: groupedScatterLayout(options, labels, total, separated) };
}

export const groupedBox: GraphModule = {
  label: "Box and violin",
  family: "grouped",
  defaults: { fill: 0.5, pointSize: 5, outline: 2 },
  points: (options) => options.showPoints,
  build,
};
