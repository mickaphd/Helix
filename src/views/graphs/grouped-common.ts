// Shared builders for the Grouped family (GraphPad "Grouped" graph type). A
// grouped table's columns are `groups × replicates` sub-columns and its rows are
// the X categories, so every grouped graph plots one series per group across the
// row categories. The bar variants (interleaved / stacked / horizontal) share one
// builder; individual values get their own interleaved-scatter builder.
import type { GraphOptions, PaletteColor } from "../../store/types";
import type { GraphFigure } from ".";
import { groupsOf, type Column } from "../../lib/dataset";
import {
  rowCountOf,
  rowLabels,
  perRowStats,
  groupOffset,
  groupedBarLayout,
  groupedScatterLayout,
  separatedPositions,
  seriesColor,
  seriesFill,
  seriesMarker,
  seriesPointMarker,
  jitter,
} from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";

/** Interleaved / stacked / horizontal bars: one bar trace per group, bar height =
 *  the group's center (mean/median) per row. Stacked bars omit error whiskers
 *  (they'd overlap the stack); interleaved/horizontal show them when enabled.
 *  "Separated" (group mode only — stacking already combines groups per category)
 *  gives each group its own block of categories instead of interleaving within
 *  each row's slot. */
export function buildGroupedBars(
  columns: Column[],
  options: GraphOptions,
  mode: "group" | "stack",
  horizontal = false,
  seriesColors?: Record<string, PaletteColor>,
  titles?: (string | null)[],
): GraphFigure {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const showError = mode !== "stack";
  const separated = mode === "group" && options.groupLayout === "separated" ? separatedPositions(groups.length, labels) : undefined;

  const data = groups.map((g, i) => {
    const { center, error } = perRowStats(g.columns, rows, options.center, showError ? options.error : "none");
    const errArr = error ? error.map((e) => e ?? NaN) : null; // NaN: no error bar
    const x = separated ? Array.from({ length: rows }, (_, r) => separated.posOf(i, r)) : labels;
    return {
      type: "bar",
      name: g.name,
      orientation: horizontal ? "h" : "v",
      [horizontal ? "y" : "x"]: x,
      [horizontal ? "x" : "y"]: center,
      marker: { color: seriesFill(seriesColors, g.name, i), line: { color: seriesColor(seriesColors, g.name, i), width: 1.5 } },
      ...(errArr
        ? {
            [horizontal ? "error_x" : "error_y"]: {
              type: "data",
              array: errArr,
              color: seriesColor(seriesColors, g.name, i),
              thickness: 1.5,
              width: 6,
            },
          }
        : {}),
      hoverinfo: horizontal ? "y+x" : "x+y",
    };
  });

  return { data, layout: { ...groupedBarLayout(options, groups.length, { horizontal, separated }), barmode: mode } };
}

/** Connected/interaction lines: one line per group through its per-row centers
 *  (mean/median), a marker at each row, and optional error whiskers. Lines connect
 *  each group across the row categories, so parallel lines mean no interaction and
 *  crossing/diverging lines highlight one (Prism's interaction graph). */
export function buildGroupedLines(
  columns: Column[],
  options: GraphOptions,
  seriesColors?: Record<string, PaletteColor>,
  titles?: (string | null)[],
): GraphFigure {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const x = labels.map((_, i) => i);

  const data = groups.map((g, i) => {
    const { center, error } = perRowStats(g.columns, rows, options.center, options.error);
    return {
      type: "scatter",
      mode: "lines+markers",
      name: g.name,
      x,
      y: center,
      // Break the line at rows where this group has no data instead of interpolating across.
      connectgaps: false,
      line: { color: seriesColor(seriesColors, g.name, i), width: 2 },
      marker: seriesMarker(7, seriesColors, g.name, i),
      ...(error
        ? {
            error_y: {
              type: "data",
              array: error.map((e) => e ?? NaN),
              color: seriesColor(seriesColors, g.name, i),
              thickness: 1.5,
              width: 6,
            },
          }
        : {}),
      hoverinfo: "x+y",
    };
  });

  return { data, layout: groupedScatterLayout(options, labels, groups.length) };
}

/** Interleaved scatter (individual values): every replicate as a jittered point,
 *  groups fanned out within each row (or, in "Separated" layout, given their own
 *  block of categories), plus a short center line and optional error whiskers
 *  per group. */
export function buildGroupedScatter(
  columns: Column[],
  options: GraphOptions,
  seriesColors?: Record<string, PaletteColor>,
  pointColors?: Record<string, PaletteColor>,
  titles?: (string | null)[],
): GraphFigure {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const total = groups.length;
  const separated = options.groupLayout === "separated" ? separatedPositions(total, labels) : undefined;
  const data: unknown[] = [];

  groups.forEach((g, gi) => {
    const basePos = (r: number) => (separated ? separated.posOf(gi, r) : r + groupOffset(gi, total));

    // The individual points for this group.
    const px: number[] = [];
    const py: number[] = [];
    const pointKeys: string[] = [];
    for (let r = 0; r < rows; r++) {
      g.columns.forEach((c, ci) => {
        const v = c.byRow[r] ?? null;
        if (v != null) {
          px.push(basePos(r) + jitter(gi, r * 10 + ci) * 0.4);
          py.push(v);
          pointKeys.push(pointKeyOf(c.name, r));
        }
      });
    }
    data.push({
      type: "scatter",
      mode: "markers",
      name: g.name,
      x: px,
      y: py,
      marker: seriesPointMarker(7, seriesColors, pointColors, g.name, gi, pointKeys),
      hoverinfo: "y",
    });

    // Center line + optional error whiskers at each row for this group.
    const { center, error } = perRowStats(g.columns, rows, options.center, options.error);
    const lineX: (number | null)[] = [];
    const lineY: (number | null)[] = [];
    center.forEach((c, r) => {
      if (c != null) {
        const p = basePos(r);
        lineX.push(p - 0.1, p + 0.1, null);
        lineY.push(c, c, null);
      }
    });
    data.push({
      type: "scatter",
      mode: "lines",
      x: lineX,
      y: lineY,
      line: { color: seriesColor(seriesColors, g.name, gi), width: 2 },
      hoverinfo: "skip",
      showlegend: false,
    });

    if (error) {
      const ex: number[] = [];
      const ey: number[] = [];
      const ea: number[] = [];
      center.forEach((c, r) => {
        if (c != null) {
          ex.push(basePos(r));
          ey.push(c);
          ea.push(error[r] ?? NaN);
        }
      });
      data.push({
        type: "scatter",
        mode: "markers",
        x: ex,
        y: ey,
        marker: { opacity: 0 },
        error_y: { type: "data", array: ea, color: seriesColor(seriesColors, g.name, gi), thickness: 1.5, width: 6 },
        hoverinfo: "skip",
        showlegend: false,
      });
    }
  });

  return { data, layout: groupedScatterLayout(options, labels, total, separated) };
}
