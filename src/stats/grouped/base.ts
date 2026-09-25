// Shared reading for Grouped-table tests. A column "A:Y1" belongs to group "A"
// (see `groupsOf`); the row is the table's other, implicit factor. Unlike the
// Column-table tests (one column = one independent group), these need every
// observation tagged by BOTH its group and its row.
import type { Column } from "../types";
import { groupsOf } from "../../lib/dataset";

const rowCount = (columns: Column[]) => columns[0]?.byRow.length ?? 0;

/** A row's name in results: its title, as in Prism, or "Row n" when it has none. */
export const rowName = (titles: (string | null)[], r: number) => titles[r]?.trim() || `Row ${r + 1}`;

/** A group's numbers at one row (its replicate columns' values there). */
function rowValues(block: Column[], row: number): number[] {
  return block.flatMap((c) => (c.byRow[row] == null ? [] : [c.byRow[row]!]));
}

/** Every replicate observation, tagged by column-group and row position — the
 *  (Group × Row) shape a two-way ANOVA needs. */
export function flattenGrouped(columns: Column[]): { values: number[]; group: string[]; row: string[] } {
  const values: number[] = [];
  const group: string[] = [];
  const row: string[] = [];
  for (const g of groupsOf(columns)) {
    for (let r = 0; r < rowCount(columns); r++) {
      for (const v of rowValues(g.columns, r)) {
        values.push(v);
        group.push(g.name);
        row.push(`R${r + 1}`);
      }
    }
  }
  return { values, group, row };
}

/** Each group's rows, each holding that row's own replicate values — what
 *  per-row comparisons (Multiple t tests) run against. */
export function groupRows(columns: Column[]): Map<string, number[][]> {
  return new Map(
    groupsOf(columns).map((g) => [g.name, Array.from({ length: rowCount(columns) }, (_, r) => rowValues(g.columns, r))]),
  );
}

/** Two groups' rows, paired by replicate column position (the i-th column of
 *  group A with the i-th column of group B) — what a paired per-row test needs,
 *  unlike `groupRows` (which filters each row's blanks independently per group,
 *  losing column identity). `undefined` unless the table has exactly 2 groups. */
export function pairedGroupRows(
  columns: Column[],
): { name1: string; name2: string; rowsA: number[][]; rowsB: number[][] } | undefined {
  const groups = groupsOf(columns);
  if (groups.length !== 2) return undefined;
  const [a, b] = groups;
  const n = Math.min(a.columns.length, b.columns.length);
  const rowsA: number[][] = [];
  const rowsB: number[][] = [];
  for (let r = 0; r < rowCount(columns); r++) {
    rowsA.push([]);
    rowsB.push([]);
    for (let k = 0; k < n; k++) {
      const va = a.columns[k].byRow[r];
      const vb = b.columns[k].byRow[r];
      if (va != null && vb != null) {
        rowsA[r].push(va);
        rowsB[r].push(vb);
      }
    }
  }
  return { name1: a.name, name2: b.name, rowsA, rowsB };
}

/** Flattened (Group × Row × Subject) observations for a repeated-measures
 *  (row-matched) two-way ANOVA: each replicate column is treated as one subject,
 *  the same subject measured at every row within its group. Subjects (replicate
 *  columns) missing any row are dropped entirely — kept-complete-only, mirroring
 *  the Friedman test's auto-drop-incomplete behavior — `dropped` reports how many. */
export function flattenRepeated(
  columns: Column[],
): { values: number[]; group: string[]; row: string[]; subject: string[]; dropped: number } {
  const rows = rowCount(columns);
  const values: number[] = [];
  const group: string[] = [];
  const row: string[] = [];
  const subject: string[] = [];
  let totalCols = 0;
  let keptCols = 0;
  for (const g of groupsOf(columns)) {
    for (const col of g.columns) {
      totalCols++;
      if (rows === 0 || col.values.length !== rows) continue;
      keptCols++;
      col.values.forEach((v, r) => {
        values.push(v);
        group.push(g.name);
        row.push(`R${r + 1}`);
        subject.push(`${g.name}:${col.name}`);
      });
    }
  }
  return { values, group, row, subject, dropped: totalCols - keptCols };
}

/** Holm (step-down) and Benjamini-Hochberg/FDR (step-up) multiple-comparison
 *  corrections — plain textbook formulas done in JS rather than round-tripping
 *  to R for something this simple. "none" passes P values through unchanged. */
export function adjustPValues(pvals: (number | null)[], method: "holm" | "fdr" | "none"): (number | null)[] {
  if (method === "none") return pvals;
  const ranked = pvals
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p != null)
    .sort((a, b) => a.p - b.p);
  const m = ranked.length;
  const adjusted: number[] = new Array(m);
  if (method === "holm") {
    let runningMax = 0;
    ranked.forEach(({ p }, k) => {
      runningMax = Math.max(runningMax, Math.min(1, (m - k) * p));
      adjusted[k] = runningMax;
    });
  } else {
    let runningMin = 1;
    for (let k = m - 1; k >= 0; k--) {
      runningMin = Math.min(runningMin, Math.min(1, (m / (k + 1)) * ranked[k].p));
      adjusted[k] = runningMin;
    }
  }
  const out: (number | null)[] = [...pvals];
  ranked.forEach(({ i }, k) => (out[i] = adjusted[k]));
  return out;
}
