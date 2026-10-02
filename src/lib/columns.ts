// Keys that tie cells, series, points and compared pairs of a table together.
// Reading the data itself is lib/dataset.ts.

/** Key of an excluded cell: full-grid coords (col 0 = row titles, never excluded). */
export function excludedKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** Series identity key for a column name: the group prefix before ":" for a
 *  Grouped table's "A:Y1"-style sub-columns, or the name itself otherwise. This
 *  is what a graph's hand-picked series colors are keyed by. */
export function seriesKeyOf(name: string): string {
  const sep = name.indexOf(":");
  return sep >= 0 ? name.slice(0, sep) : name;
}

/** Identity key for one data point (one cell): its exact column name + 0-based row
 *  index. This is what a graph's points styled one by one (`points`) are keyed by —
 *  distinct from `seriesKeyOf`, which collapses a Grouped table's replicate
 *  sub-columns down to their shared group prefix. */
export function pointKeyOf(column: string, row: number): string {
  return `${column}#${row}`;
}

/** Splits a point's key back into its column name and row index. */
export function parsePointKey(key: string): { column: string; row: number } {
  const i = key.lastIndexOf("#");
  return { column: key.slice(0, i), row: Number(key.slice(i + 1)) };
}

/** Key of a compared pair of columns (a graph's significance brackets). NUL-joined, so
 *  any column name is safe in it. */
export const pairKey = (a: string, b: string) => `${a}\u0000${b}`;
/** The two column names of a `pairKey`. */
export const pairOf = (key: string) => key.split("\u0000") as [string, string];
