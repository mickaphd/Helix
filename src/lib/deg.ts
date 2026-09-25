// The volcano of a grouped table (rows = genes, columns = groups × replicates):
// two groups compared row by row, each row getting an effect size (X), a Welch
// t test P value and its BH FDR (Y). Plain TypeScript, so the volcano redraws
// instantly. A Multiple Variables volcano reads columns the user already has.
import type { TableData } from "../store/types";
import { groupsOf, readTable, type Column } from "./dataset";
import { tTwoSidedP } from "./student-t";

interface DEGRow {
  label: string;
  log2FC: number;
  p: number;
  padj: number;
}

const log2 = (x: number) => Math.log(x) / Math.LN2;
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const variance = (v: number[]) => {
  const m = mean(v);
  return v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);
};

/** Two-sided Welch (unequal-variance) t-test p value for two samples. Returns NaN
 *  when a group has fewer than two values; clamps to (1e-300, 1] so an extreme
 *  gene stays plottable on a -log10 axis instead of becoming +Infinity. */
function welchP(a: number[], b: number[]): number {
  const nA = a.length;
  const nB = b.length;
  if (nA < 2 || nB < 2) return NaN;
  const seA = variance(a) / nA;
  const seB = variance(b) / nB;
  const se2 = seA + seB;
  if (se2 <= 0) return mean(a) === mean(b) ? 1 : 1e-300;
  const t = (mean(b) - mean(a)) / Math.sqrt(se2);
  const df = (se2 * se2) / ((seA * seA) / (nA - 1) + (seB * seB) / (nB - 1));
  const p = tTwoSidedP(t, df);
  return p >= 0 ? Math.min(1, Math.max(1e-300, p)) : 1;
}

/** Benjamini-Hochberg FDR adjustment (step-up, monotone), written back onto `padj`. */
function bhAdjust(rows: DEGRow[]): void {
  const m = rows.length;
  if (!m) return;
  const order = rows.map((_, i) => i).sort((i, j) => rows[i].p - rows[j].p);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const i = order[k];
    prev = Math.min(prev, (rows[i].p * m) / (k + 1));
    rows[i].padj = Math.min(1, prev);
  }
}

/**
 * Compute per-row DEG stats comparing two groups (by their column-name prefix,
 * e.g. "A"/"B") of a grouped table. Row label = the leading Title cell (gene name).
 * Honors Prism-style excluded cells. `effect`: "log2ratio" = log2(meanB/meanA)
 * for raw data (needs positive means), "difference" = meanB − meanA for data that
 * is already on a log scale. Rows with <2 usable values per group are dropped.
 */
export function computeGroupedDEG(
  data: TableData,
  groupA: string,
  groupB: string,
  effect: "log2ratio" | "difference",
): DEGRow[] {
  const { titles, columns } = readTable(data);
  const groups = groupsOf(columns);
  const columnsOf = (name: string) => groups.find((g) => g.name === name)?.columns ?? [];
  const valuesAt = (cols: Column[], r: number) => cols.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
  const rows: DEGRow[] = [];
  titles.forEach((title, r) => {
    const a = valuesAt(columnsOf(groupA), r);
    const b = valuesAt(columnsOf(groupB), r);
    if (a.length < 2 || b.length < 2) return;
    const mA = mean(a);
    const mB = mean(b);
    let log2FC: number;
    if (effect === "log2ratio") {
      if (mA <= 0 || mB <= 0) return; // ratio undefined for non-positive means
      log2FC = log2(mB / mA);
    } else {
      log2FC = mB - mA;
    }
    const p = welchP(a, b);
    if (!Number.isFinite(p)) return;
    rows.push({ label: String(title ?? "").trim(), log2FC, p, padj: 1 });
  });
  bhAdjust(rows);
  return rows;
}
