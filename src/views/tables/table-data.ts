// Pure operations on a table's data. Every edit — typing, pasting, inserting,
// renaming, excluding — returns a new TableData, which makes undo a matter of
// keeping the previous value. Column 0 holds the row titles; data columns start
// at 1 (an XY table's X is column 1).
//
// Only rows and columns that were written are stored; the grid shows empty
// ones beyond them, and writing there extends the table.
//
// Two annotations follow the cells around: excluded cells ("row,col" keys) and
// per-point colors ("column#row" keys). Structural edits remap them so they
// stay attached to their values.
import type { PaletteColor, TableData, TableType } from "../../store/types";
import { parsePointKey, pointKeyOf, seriesKeyOf } from "../../lib/columns";

export type Cell = string | null;

/** An inclusive, normalized block of cells. */
export interface Range {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** Spreadsheet-style letter for a 0-based index: 0→A, 25→Z, 26→AA… */
function columnLetter(index: number): string {
  let s = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/** Default name of the `i`-th data column (0-based) for a table type. */
function columnLabel(type: TableType, i: number): string {
  if (type === "xy") return i === 0 ? "X" : `Y${i}`;
  if (type === "multiple") return `Var ${i + 1}`;
  if (type === "contingency") return `Outcome ${columnLetter(i)}`;
  return columnLetter(i);
}

/** The next `count` default column names not already taken, in order. An XY table
 *  already holding its X (column 1, whatever its name) only gets Y names. */
export function freshColumnNames(columns: string[], type: TableType, count: number): string[] {
  const taken = new Set(columns);
  const names: string[] = [];
  for (let i = type === "xy" && columns.length > 1 ? 1 : 0; names.length < count; i++) {
    const name = columnLabel(type, i);
    if (!taken.has(name)) names.push(name);
  }
  return names;
}

const emptyRows = (count: number, width: number): Cell[][] =>
  Array.from({ length: count }, () => Array<Cell>(width).fill(null));

/** A new table: the Title column, then `count` data columns named for `type`. */
export function newTable(type: TableType, count: number): TableData {
  return { columns: ["Title", ...freshColumnNames([], type, count)], rows: [] };
}

/** A grouped table's sub-column names: "A:Y1", "A:Y2"… for each group key. */
const subColumns = (keys: string[], replicates: number) =>
  keys.flatMap((key) => Array.from({ length: replicates }, (_, r) => `${key}:Y${r + 1}`));

export function newGroupedTable(groups: number, replicates: number): TableData {
  const keys = Array.from({ length: groups }, (_, g) => columnLetter(g));
  return { columns: ["Title", ...subColumns(keys, replicates)], rows: [], groups, replicates };
}

export const isGrouped = (data: TableData) => Boolean(data.groups && data.replicates);

// ── Annotation remapping ───────────────────────────────────────────────

/** Moves excluded cells through `fn` (null drops a cell). */
function remapExcluded(data: TableData, fn: (r: number, c: number) => [number, number] | null): string[] | undefined {
  const out: string[] = [];
  for (const key of data.excluded ?? []) {
    const [r, c] = key.split(",").map(Number);
    const moved = fn(r, c);
    if (moved) out.push(`${moved[0]},${moved[1]}`);
  }
  return out.length ? out : undefined;
}

/** Moves per-point colors through `fn`, which gets the column name and row. */
function remapPoints(
  data: TableData,
  fn: (column: string, row: number) => [string, number] | null,
): Record<string, PaletteColor> | undefined {
  const out: Record<string, PaletteColor> = {};
  for (const [key, color] of Object.entries(data.pointColors ?? {})) {
    const { column, row } = parsePointKey(key);
    const moved = fn(column, row);
    if (moved) out[pointKeyOf(moved[0], moved[1])] = color;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── Cells ──────────────────────────────────────────────────────────────

/**
 * Writes `block` with its top-left corner at (r, c): typing (1×1) and pasting.
 * Adds rows as needed, and columns too unless the table is grouped (whose
 * columns come from its group structure). `type` names any new columns.
 */
export function writeBlock(data: TableData, r: number, c: number, block: Cell[][], type: TableType): TableData {
  const blockWidth = block.reduce((w, row) => Math.max(w, row.length), 0);
  const needCols = isGrouped(data) ? 0 : c + blockWidth - data.columns.length;
  const columns = needCols > 0 ? [...data.columns, ...freshColumnNames(data.columns, type, needCols)] : data.columns;
  const width = columns.length;
  const height = Math.max(data.rows.length, r + block.length);
  const rows = Array.from({ length: height }, (_, i) => {
    const src = data.rows[i];
    const line = block[i - r];
    if (!line && (!src || src.length === width)) return src ?? Array<Cell>(width).fill(null);
    const row = [...(src ?? []), ...Array<Cell>(width - (src?.length ?? 0)).fill(null)];
    line?.forEach((value, j) => {
      if (c + j < width) row[c + j] = value === "" ? null : value;
    });
    return row;
  });
  return { ...data, columns, rows };
}

/** Sets every stored cell of `range` to `value` (null clears). */
export function fillRange(data: TableData, range: Range, value: Cell): TableData {
  const rows = data.rows.map((row, r) =>
    r < range.r0 || r > range.r1 ? row : row.map((cell, c) => (c >= range.c0 && c <= range.c1 ? value : cell)),
  );
  return { ...data, rows };
}

/** Data cells (column ≥ 1) of `range` that hold a value, as "row,col" keys. */
function valueKeys(data: TableData, range: Range): string[] {
  const keys: string[] = [];
  for (let r = range.r0; r <= Math.min(range.r1, data.rows.length - 1); r++) {
    for (let c = Math.max(1, range.c0); c <= Math.min(range.c1, data.columns.length - 1); c++) {
      if (data.rows[r][c] != null) keys.push(`${r},${c}`);
    }
  }
  return keys;
}

export function isRangeExcluded(data: TableData, range: Range): boolean {
  const excluded = new Set(data.excluded);
  const keys = valueKeys(data, range);
  return keys.length > 0 && keys.every((k) => excluded.has(k));
}

/** Prism's ⌘E: excludes the range's values, or includes them back if all are excluded. */
export function toggleExcluded(data: TableData, range: Range): TableData {
  const keys = valueKeys(data, range);
  const excluded = new Set(data.excluded);
  const include = isRangeExcluded(data, range);
  for (const k of keys) {
    if (include) excluded.delete(k);
    else excluded.add(k);
  }
  return { ...data, excluded: excluded.size ? [...excluded] : undefined };
}

/** Colors the points of `range` (undefined resets them to their series color). */
export function colorPoints(data: TableData, range: Range, color: PaletteColor | undefined): TableData {
  const pointColors = { ...data.pointColors };
  for (let c = Math.max(1, range.c0); c <= Math.min(range.c1, data.columns.length - 1); c++) {
    for (let r = range.r0; r <= Math.min(range.r1, data.rows.length - 1); r++) {
      const key = pointKeyOf(data.columns[c], r);
      if (color) pointColors[key] = color;
      else delete pointColors[key];
    }
  }
  return { ...data, pointColors: Object.keys(pointColors).length ? pointColors : undefined };
}

// ── Rows and columns ───────────────────────────────────────────────────

export function insertRows(data: TableData, at: number, count: number): TableData {
  if (at >= data.rows.length) return data; // the grid already shows empty rows there
  const rows = [...data.rows.slice(0, at), ...emptyRows(count, data.columns.length), ...data.rows.slice(at)];
  const shift = (r: number) => (r >= at ? r + count : r);
  return {
    ...data,
    rows,
    excluded: remapExcluded(data, (r, c) => [shift(r), c]),
    pointColors: remapPoints(data, (col, r) => [col, shift(r)]),
  };
}

export function deleteRows(data: TableData, at: number, count: number): TableData {
  const rows = data.rows.filter((_, r) => r < at || r >= at + count);
  const shift = (r: number) => (r < at ? r : r >= at + count ? r - count : null);
  return {
    ...data,
    rows,
    excluded: remapExcluded(data, (r, c) => (shift(r) === null ? null : [shift(r)!, c])),
    pointColors: remapPoints(data, (col, r) => (shift(r) === null ? null : [col, shift(r)!])),
  };
}

/** Inserts `count` columns before column `at` (≥ 1), named for `type`. */
export function insertColumns(data: TableData, at: number, count: number, type: TableType): TableData {
  const columns = [...data.columns];
  columns.splice(at, 0, ...freshColumnNames(data.columns, type, count));
  const rows = data.rows.map((row) => {
    const next = [...row];
    next.splice(at, 0, ...Array<Cell>(count).fill(null));
    return next;
  });
  return { ...data, columns, rows, excluded: remapExcluded(data, (r, c) => [r, c >= at ? c + count : c]) };
}

/** Deletes `count` columns from column `at` (≥ 1); at least one data column remains. */
export function deleteColumns(data: TableData, at: number, count: number): TableData {
  const n = Math.min(count, data.columns.length - 2);
  if (n <= 0) return data;
  const gone = new Set(data.columns.slice(at, at + n));
  const keep = (_: unknown, c: number) => c < at || c >= at + n;
  return {
    ...data,
    columns: data.columns.filter(keep),
    rows: data.rows.map((row) => row.filter(keep)),
    excluded: remapExcluded(data, (r, c) => (c < at ? [r, c] : c >= at + n ? [r, c - n] : null)),
    pointColors: remapPoints(data, (col, r) => (gone.has(col) ? null : [col, r])),
  };
}

/** Moves `map[from]` to `map[to]` (colors and widths are keyed by column name). */
function renameKey<T>(map: Record<string, T> | undefined, from: string, to: string): Record<string, T> | undefined {
  if (!map || map[from] === undefined) return map;
  const { [from]: value, ...rest } = map;
  return { ...rest, [to]: value };
}

/** Renames column `c`, carrying its color, width and point colors over. */
export function renameColumn(data: TableData, c: number, name: string): TableData {
  const old = data.columns[c];
  if (!name || name === old || data.columns.includes(name)) return data;
  return {
    ...data,
    columns: data.columns.map((n, i) => (i === c ? name : n)),
    seriesColors: renameKey(data.seriesColors, old, name),
    widths: renameKey(data.widths, old, name),
    pointColors: remapPoints(data, (col, r) => [col === old ? name : col, r]),
  };
}

/** Renames a group of a grouped table: its shared prefix across all its sub-columns. */
export function renameGroup(data: TableData, oldKey: string, newKey: string): TableData {
  if (!newKey || newKey === oldKey || newKey.includes(":") || data.columns.some((n) => seriesKeyOf(n) === newKey)) {
    return data;
  }
  const rename = (n: string) => (seriesKeyOf(n) === oldKey && n.includes(":") ? newKey + n.slice(n.indexOf(":")) : n);
  const widths = data.widths && Object.fromEntries(Object.entries(data.widths).map(([n, w]) => [rename(n), w]));
  return {
    ...data,
    columns: data.columns.map(rename),
    seriesColors: renameKey(data.seriesColors, oldKey, newKey),
    widths,
    pointColors: remapPoints(data, (col, r) => [rename(col), r]),
  };
}

/** Changes how many groups and sub-columns a grouped table has. Every value stays
 *  in its group and sub-column (with its exclusion and color); groups keep their
 *  names; only groups or sub-columns beyond the new counts are dropped. */
export function regroupTable(data: TableData, groups: number, replicates: number): TableData {
  const keys = [...new Set(data.columns.slice(1).map(seriesKeyOf))].slice(0, groups);
  // A new group takes the letter of its place (C for the third), or the next free one.
  for (let i = keys.length; keys.length < groups; i++) if (!keys.includes(columnLetter(i))) keys.push(columnLetter(i));
  const columns = [data.columns[0], ...subColumns(keys, replicates)];
  const from = columns.map((name, c) => (c === 0 ? 0 : data.columns.indexOf(name)));
  const to = (c: number) => (c === 0 ? 0 : columns.indexOf(data.columns[c]));
  return {
    ...data,
    columns,
    rows: data.rows.map((row) => from.map((c) => (c < 0 ? null : (row[c] ?? null)))),
    groups,
    replicates,
    excluded: remapExcluded(data, (r, c) => (to(c) < 0 ? null : [r, to(c)])),
    pointColors: remapPoints(data, (col, r) => (columns.includes(col) ? [col, r] : null)),
  };
}

/** Stored cells whose text contains `query` (any case), row by row. */
export function findCells(data: TableData, query: string): { r: number; c: number }[] {
  const q = query.toLowerCase();
  const found: { r: number; c: number }[] = [];
  data.rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell?.toLowerCase().includes(q)) found.push({ r, c });
    }),
  );
  return found;
}

/** Sets column `c`'s width, or (undefined) lets it fit its content again. */
export function setColumnWidth(data: TableData, c: number, width: number | undefined): TableData {
  const { [data.columns[c]]: _, ...widths } = data.widths ?? {};
  if (width !== undefined) widths[data.columns[c]] = Math.round(width);
  return { ...data, widths: Object.keys(widths).length ? widths : undefined };
}

/**
 * Where ⌘+arrow lands from (r, c), as in Excel: along the data, to the last filled
 * cell before a gap, or across a gap to the next filled cell — never past the
 * stored rows and columns.
 */
export function dataEdge(data: TableData, r: number, c: number, dr: number, dc: number): { r: number; c: number } {
  const filled = (r: number, c: number) => data.rows[r]?.[c] != null;
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < data.rows.length && c < data.columns.length;
  if (!inside(r + dr, c + dc)) return { r, c };
  const alongData = filled(r, c) && filled(r + dr, c + dc);
  do {
    r += dr;
    c += dc;
  } while (inside(r + dr, c + dc) && (alongData ? filled(r + dr, c + dc) : !filled(r, c)));
  return { r, c };
}

// A number written with a decimal comma ("1,23"): R only understands ".".
const COMMA_DECIMAL = /^-?\d+,\d+$/;

export const hasCommaDecimals = (data: TableData) =>
  data.rows.some((row) => row.some((cell) => cell !== null && COMMA_DECIMAL.test(cell)));

export function convertCommaDecimals(data: TableData): TableData {
  const fix = (cell: Cell) => (cell !== null && COMMA_DECIMAL.test(cell) ? cell.replace(",", ".") : cell);
  return { ...data, rows: data.rows.map((row) => row.map(fix)) };
}

// ── Clipboard ──────────────────────────────────────────────────────────

/** Stored cells of `range` as tab-separated text, the format Excel and Numbers exchange. */
export function toTSV(data: TableData, range: Range): string {
  const lines: string[] = [];
  for (let r = range.r0; r <= Math.min(range.r1, data.rows.length - 1); r++) {
    const cells: string[] = [];
    for (let c = range.c0; c <= Math.min(range.c1, data.columns.length - 1); c++) {
      const v = data.rows[r]?.[c] ?? "";
      cells.push(/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** Parses tab-separated text, including Excel's quoted cells (with tabs or line breaks inside). */
export function parseTSV(text: string): Cell[][] {
  const s = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell.trim() || null);
    cell = "";
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (s[i + 1] === '"') cell += s[++i]; // "" is an escaped quote
      else quoted = false;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === "\t") {
      endCell();
    } else if (ch === "\n") {
      endCell();
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  endCell();
  rows.push(row);
  return rows;
}
