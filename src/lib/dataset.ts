// The one reading of a table that the stats, the graphs and the analysis wizards
// share, so they always agree on the data: excluded cells read as blank, each cell
// is parsed once (numeric.ts decides what a number is), and the reading is cached
// per table version. An edit makes a new TableData, so the cache is never stale.
import type { TableData, TableType } from "../store/types";
import { excludedKey, seriesKeyOf } from "./columns";
import { parseCell } from "./numeric";

/** One data column, as every engine sees it. */
export interface Column {
  name: string;
  /** Raw text, one per table row (excluded cells read as blank). */
  cells: (string | null)[];
  /** The same rows as numbers (null: blank or text). */
  byRow: (number | null)[];
  /** Just the numbers, in row order… */
  values: number[];
  /** …and the row each one came from. */
  rows: number[];
}

export interface Dataset {
  /** The row titles (column 0), one per row. */
  titles: (string | null)[];
  /** Every data column, in table order. */
  columns: Column[];
  /** The data columns holding at least one number. */
  numeric: Column[];
}

const cache = new WeakMap<TableData, Dataset>();

export function readTable(data: TableData): Dataset {
  let dataset = cache.get(data);
  if (!dataset) {
    const excluded = new Set(data.excluded);
    const columns = data.columns.slice(1).map((name, i): Column => {
      const cells = data.rows.map((row, r) => (excluded.has(excludedKey(r, i + 1)) ? null : (row[i + 1] ?? null)));
      const byRow = cells.map(parseCell);
      const rows = byRow.flatMap((v, r) => (v == null ? [] : [r]));
      return { name, cells, byRow, values: rows.map((r) => byRow[r]!), rows };
    });
    dataset = {
      titles: data.rows.map((row) => row[0] ?? null),
      columns,
      numeric: columns.filter((c) => c.values.length > 0),
    };
    cache.set(data, dataset);
  }
  return dataset;
}

/** An XY table's X (its first data column, whatever its name; undefined while it
 *  holds no number) and its Y series holding numbers. */
export function splitXY(columns: Column[]): { x?: Column; ys: Column[] } {
  const [x, ...ys] = columns;
  return { x: x?.values.length ? x : undefined, ys: ys.filter((c) => c.values.length > 0) };
}

/** The rows where both columns hold a number: how X and Y pair up. */
export function pairUp(a: Column, b: Column): { x: number[]; y: number[]; rows: number[] } {
  const rows = a.rows.filter((r) => b.byRow[r] != null);
  return { x: rows.map((r) => a.byRow[r]!), y: rows.map((r) => b.byRow[r]!), rows };
}

/** A grouped table's groups ("A" for "A:Y1", "A:Y2"…), in table order, each with
 *  its replicate columns. Groups without a single number are left out: `groups`
 *  on the table says how many exist, not how many hold data. */
export function groupsOf(columns: Column[]): { name: string; columns: Column[] }[] {
  const groups = new Map<string, Column[]>();
  for (const c of columns) {
    const key = seriesKeyOf(c.name);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups]
    .filter(([, cols]) => cols.some((c) => c.values.length > 0))
    .map(([name, cols]) => ({ name, columns: cols }));
}

/** The series a table's graphs draw, in order: an XY table's Y series, a grouped
 *  table's groups, else its columns holding numbers. A series' default color is
 *  the palette color at its position here, in the table and in every graph. */
export function seriesOf(data: TableData, type: TableType): string[] {
  const { columns, numeric } = readTable(data);
  if (type === "xy") return splitXY(columns).ys.map((c) => c.name);
  if (type === "grouped") return groupsOf(numeric).map((g) => g.name);
  return numeric.map((c) => c.name);
}
