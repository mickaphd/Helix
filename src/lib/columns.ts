// Keys that tie cells, series and points of a table together. Reading the data
// itself is lib/dataset.ts.
import type { PaletteColor, TableData } from "../store/types";

/** Key of an excluded cell: full-grid coords (col 0 = row titles, never excluded). */
export function excludedKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** Series identity key for a column name: the group prefix before ":" for a
 *  Grouped table's "A:Y1"-style sub-columns, or the name itself otherwise. This
 *  is what `seriesColors` (table + graph coloring) is keyed by. */
export function seriesKeyOf(name: string): string {
  const sep = name.indexOf(":");
  return sep >= 0 ? name.slice(0, sep) : name;
}

/** Identity key for one data point (one cell): its exact column name + 0-based row
 *  index. This is what `pointColors` (per-point overrides) is keyed by — distinct
 *  from `seriesKeyOf`, which collapses a Grouped table's replicate sub-columns down
 *  to their shared group prefix. */
export function pointKeyOf(column: string, row: number): string {
  return `${column}#${row}`;
}

/** Splits a `pointColors` key back into its column name and row index. */
export function parsePointKey(key: string): { column: string; row: number } {
  const i = key.lastIndexOf("#");
  return { column: key.slice(0, i), row: Number(key.slice(i + 1)) };
}

/** Apply a whole-series color change: set/clear `seriesColors[key]` and drop any
 *  per-point overrides within that series — assigning the whole series a color is
 *  a deliberate reset of any points individually highlighted inside it. */
export function withSeriesColor(data: TableData, key: string, token: PaletteColor | undefined): TableData {
  const seriesColors = { ...data.seriesColors };
  if (token) seriesColors[key] = token;
  else delete seriesColors[key];
  const pointColors = { ...data.pointColors };
  for (const k of Object.keys(pointColors)) {
    if (seriesKeyOf(parsePointKey(k).column) === key) delete pointColors[k];
  }
  return { ...data, seriesColors, pointColors: Object.keys(pointColors).length ? pointColors : undefined };
}
