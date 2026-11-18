// A table computed from another (Transform or Normalize): each value of its data sets
// transformed, an XY or Survival table's X left as it is. The store computes it again
// whenever the table it comes from changes (`updateTable`), so it never needs typing.
// Excluded values stay excluded, and count for nothing in a mean, an SD, a smallest or a
// largest. A value that has no transform (a log of 0, a percent of a control of 0) is blank.
import { readTable, type Column } from "./dataset";
import { parseCell } from "./numeric";
import { maxOf, mean, minOf, sd } from "./summary";
import { hasXColumn, type TableData, type TableType, type Transform } from "../store/types";

interface Stats {
  min: number;
  max: number;
  /** NaN without values; `sd` 0 without two. */
  mean: number;
  sd: number;
}

const stats = (v: number[]): Stats => ({ min: minOf(v), max: maxOf(v), mean: mean(v), sd: sd(v) });
/** A value as a cell holds it: 10 significant digits, readable and far finer than any test needs. */
const cell = (v: number | null) => (v == null || !Number.isFinite(v) ? null : String(Number(v.toPrecision(10))));

/** Whether a table's data sets are matched by row (a row is an X, or a grouped table's
 *  row), so a percent is of the control's mean in the same row. */
const byRow = (type: TableType) => type === "grouped" || type === "xy";

/** The table computed from `source`; `own`: the one computed before, whose column widths
 *  and frozen titles stay. */
export function transformTable(source: TableData, type: TableType, t: Transform, own?: TableData): TableData {
  const table = readTable(source);
  const first = hasXColumn(type) ? 1 : 0; // the first data column transformed
  const setOf = new Map<Column, Column[]>();
  for (const s of table.sets) for (const c of s.columns) setOf.set(c, s.columns);
  const values = (cols: Column[]) => cols.flatMap((c) => c.values);
  const inRow = (cols: Column[], r: number) => cols.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
  const control = table.sets.find((s) => s.name === t.control)?.columns ?? [];
  const transformed = table.columns.slice(first);
  // Each data set's or row's numbers, worked out once (a table can hold thousands of rows).
  const memo = new Map<unknown, Stats>();
  const statsOf = (key: unknown, v: () => number[]) => memo.get(key) ?? memo.set(key, stats(v())).get(key)!;
  const ofSet = (col: Column) => statsOf(setOf.get(col), () => values(setOf.get(col)!));

  const of = (v: number, col: Column, r: number): number | null => {
    switch (t.kind) {
      case "log10":
        return v > 0 ? Math.log10(v) : null;
      case "log2":
        return v > 0 ? Math.log2(v) : null;
      case "ln":
        return v > 0 ? Math.log(v) : null;
      case "normalize": {
        const { min, max } = ofSet(col);
        return max > min ? ((v - min) / (max - min)) * 100 : null;
      }
      case "percent-of-control": {
        const { mean } = byRow(type)
          ? statsOf(`control ${r}`, () => inRow(control, r))
          : statsOf("control", () => values(control));
        return mean ? (v / mean) * 100 : null;
      }
      case "z-score": {
        const { mean, sd } = t.within === "row" ? statsOf(`row ${r}`, () => inRow(transformed, r)) : ofSet(col);
        return sd > 0 ? (v - mean) / sd : null;
      }
    }
  };

  const rows = source.rows.map((row, r) =>
    row.map((raw, c) => {
      const col = table.columns[c - 1];
      if (c === 0 || c - 1 < first || !col) return raw;
      const v = parseCell(raw); // an excluded value too: it stays in the table, excluded
      return v == null ? null : cell(of(v, col, r));
    }),
  );
  const { widths, freezeTitle } = own ?? source;
  const kept = Object.entries(widths ?? {}).filter(([name]) => source.columns.includes(name));
  return { ...source, rows, widths: kept.length ? Object.fromEntries(kept) : undefined, freezeTitle };
}

/** What a transform makes, as a table's name ends: "Table 1, log10". */
export const TRANSFORM_NAMES: Record<Transform["kind"], string> = {
  log10: "log10",
  log2: "log2",
  ln: "ln",
  normalize: "normalized",
  "percent-of-control": "% of control",
  "z-score": "z-scores",
};

/** What a computed table holds, said above its grid. */
export function transformSentence(t: Transform, type: TableType, from: string): string {
  const how = {
    log10: "each value's logarithm, base 10",
    log2: "each value's logarithm, base 2",
    ln: "each value's natural logarithm",
    normalize: "each data set from 0 % (its smallest value) to 100 % (its largest)",
    "percent-of-control": `each value as a percent of the mean of “${t.control}”${byRow(type) ? " in its row" : ""}`,
    "z-score": `each value's z-score, how many SDs it lies from the mean of its ${t.within === "row" ? "row" : "data set"}`,
  }[t.kind];
  return `Computed from “${from}”: ${how}. It follows that table's changes; its values are edited there.`;
}
