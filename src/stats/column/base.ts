// Shared logic for column-based tests. Each test is a `ColumnTestSpec` that
// only declares how many groups it needs, the R it runs, and how to label the
// resulting numbers. Descriptive stats are computed here in JS (not R) so they
// are identical across every test and work for any number of groups.

import type {
  AnalysisType,
  AnalysisOutcome,
  Column,
  ComparisonRow,
  GroupDescriptives,
  StatRow,
} from "../types";
import { evalNamedVector } from "../webr";

/** A group as a test sees it: a name and its numbers. */
export interface Group {
  name: string;
  values: number[];
}

/** The columns holding at least one number, each an independent group. */
export function dataGroups(columns: Column[]): Column[] {
  return columns.filter((c) => c.values.length > 0);
}

/** Row-aligned groups for matched tests: only the rows where every column holding
 *  data has a number, so the i-th values of all groups come from the same row.
 *  Columns without any number are left out first, so an unused column can't empty
 *  every row. */
export function pairedGroups(columns: Column[]): Group[] {
  const withData = dataGroups(columns);
  const rows = withData[0]?.rows.filter((r) => withData.every((c) => c.byRow[r] != null)) ?? [];
  return withData.map((c) => ({ name: c.name, values: rows.map((r) => c.byRow[r]!) }));
}

export function describe({ name, values }: Group): GroupDescriptives {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { name, mean, sd, sem: sd != null ? sd / Math.sqrt(n) : null, median, n };
}

/** Render an R numeric vector literal from values. */
export const rVec = (values: number[]) => `c(${values.join(",")})`;

/** Escape a string for safe embedding in an R double-quoted literal, so a group
 *  or column name containing `"` or `\` can't break (or inject into) the R code. */
export const rStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Declare each group as an R variable `g0`, `g1`, … for use in a test's rCode. */
export const declareGroups = (groups: Group[]) =>
  groups.map((g, i) => `g${i}<-${rVec(g.values)}`).join(";");

/** The error for a column a wizard chose that the table no longer has (deleted, or
 *  renamed outside Helix): never fall back on another column. */
export const missingColumn = (name: string) =>
  `The column “${name}” is no longer in the table. Create this analysis again to choose another.`;

/** A P-value stat row (rendered with significance colour + stars). */
export const pRow = (label: string, value: number | null): StatRow => ({ label, value, p: true });

/** R only understands `TRUE`/`FALSE` (uppercase) — JS's `${bool}` interpolates
 *  lowercase "true"/"false", which R reads as undefined variable names. */
export const rBool = (b: boolean) => (b ? "TRUE" : "FALSE");

/** R's t.test/wilcox.test `alternative=` uses "two.sided" (dot); our params use kebab-case. */
export const rAlt = (tails: "two-sided" | "less" | "greater") =>
  tails === "two-sided" ? "two.sided" : tails;

/** Declares g0,g1,…, stacks them into `v`, and factors them into `gr` with
 *  generic "G1","G2",… labels — the shared setup every ≥3-group test (and its
 *  optional post-hoc comparisons) builds on. Generic labels sidestep quoting
 *  issues from real column names containing spaces/punctuation. */
export function groupsSetup(groups: Group[]): string {
  const k = groups.length;
  const lengths = groups.map((g) => g.values.length).join(",");
  return (
    `${declareGroups(groups)};v<-c(${groups.map((_, i) => `g${i}`).join(",")});` +
    `gr<-factor(rep(1:${k},c(${lengths})),levels=1:${k},labels=paste0("G",1:${k}))`
  );
}

/** Every (i, j) pair with i < j for k groups, 0-indexed — the fixed iteration
 *  order shared by R-side pairwise statements and JS-side comparison rows. */
export function pairIndices(k: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) pairs.push([i, j]);
  }
  return pairs;
}

/** R's `c()` only names an element from an explicit `name = value` tag — a bare
 *  variable reference like `c(p_0_1)` comes back unnamed, so `evalNamedVector`
 *  can't recover it under that key. Post-hoc helpers below return `assign`,
 *  the same keys rewritten as `p_0_1=p_0_1, …`, for embedding in the final `c(...)`. */
const asNamedArgs = (keys: string[]) => keys.map((k) => `${k}=${k}`).join(",");

/** R statements pulling one adjusted P value per group pair out of a
 *  `TukeyHSD(...)$<term>` comparison matrix (rows named "Gj-Gi", j > i),
 *  keyed by explicit `p_i_j` names so extraction never depends on row order. */
export function tukeyPosthocStatements(
  k: number,
  aovExpr = "aov(v~gr)",
): { setup: string; keys: string[]; assign: string } {
  const pairs = pairIndices(k);
  const keys = pairs.map(([i, j]) => `p_${i}_${j}`);
  const assigns = pairs.map(([i, j], idx) => `${keys[idx]}<-tk[match("G${j + 1}-G${i + 1}",rn),4]`);
  return {
    setup: `tk<-TukeyHSD(${aovExpr})$gr;rn<-rownames(tk);${assigns.join(";")}`,
    keys,
    assign: asNamedArgs(keys),
  };
}

/** Same shape for any `pairwise.*.test(...)$p.value`-style lower-triangular
 *  matrix indexed by group label (pairwise.t.test, pairwise.wilcox.test, …). */
export function pairwisePosthocStatements(
  k: number,
  matrixExpr: string,
): { setup: string; keys: string[]; assign: string } {
  const pairs = pairIndices(k);
  const keys = pairs.map(([i, j]) => `p_${i}_${j}`);
  const assigns = pairs.map(([i, j], idx) => `${keys[idx]}<-pm["G${j + 1}","G${i + 1}"]`);
  return { setup: `pm<-${matrixExpr};${assigns.join(";")}`, keys, assign: asNamedArgs(keys) };
}

/** Dunn's test: pairwise z-tests between each group's mean rank, Bonferroni-corrected
 *  across all `k*(k-1)/2` comparisons — the standard rank-based post-hoc for both
 *  Kruskal-Wallis (global ranks across all groups) and Friedman (within-block ranks).
 *  `rbarSetup` must assign a `Rbar` vector named "G1".."Gk" (each group's mean rank);
 *  `seExpr(i, j)` is the R expression for that pair's standard error. */
export function dunnPosthocStatements(
  k: number,
  rbarSetup: string,
  seExpr: (i: number, j: number) => string,
): { setup: string; keys: string[]; assign: string } {
  const pairs = pairIndices(k);
  const m = pairs.length;
  const keys = pairs.map(([i, j]) => `p_${i}_${j}`);
  const assigns = pairs.map(([i, j], idx) => {
    const z = `((Rbar[["G${i + 1}"]]-Rbar[["G${j + 1}"]])/(${seExpr(i, j)}))`;
    return `${keys[idx]}<-pmin(1,2*(1-pnorm(abs(${z})))*${m})`;
  });
  return { setup: `${rbarSetup};${assigns.join(";")}`, keys, assign: asNamedArgs(keys) };
}

/** Assembles the displayed comparisons table from already-computed group
 *  descriptives (diff) and a P-value lookup by (i, j) pair index. */
export function buildComparisons(
  groups: GroupDescriptives[],
  pValueFor: (i: number, j: number) => number | null,
): ComparisonRow[] {
  return pairIndices(groups.length).map(([i, j]) => ({
    group1: groups[i].name,
    group2: groups[j].name,
    diff: groups[i].mean != null && groups[j].mean != null ? groups[i].mean - groups[j].mean : null,
    p: pValueFor(i, j),
  }));
}

export interface ColumnTestSpec<P = unknown> {
  testType: AnalysisType;
  /** Minimum number of data columns the test requires. */
  minGroups: number;
  /** Cap on columns used (e.g. 2 for two-sample tests); omit to use all data columns. */
  maxGroups?: number;
  /** An error to show instead of running (e.g. a chosen column is gone). */
  check?: (columns: Column[], params: P | undefined) => string | undefined;
  /** How to turn raw columns into groups; defaults to `dataGroups` (independent
   *  per-column filtering). Override for e.g. paired tests that need row alignment. */
  parseGroups?: (columns: Column[], params: P | undefined) => Group[];
  /** R that ends in a `c(name=value, …)` named vector, given the parsed groups (g0, g1, … available). */
  rCode: (groups: Group[], params: P | undefined) => string;
  /** Map the marshalled R values (+ descriptives) into display rows. */
  rows: (
    v: Record<string, number | null>,
    groups: GroupDescriptives[],
    params: P | undefined,
  ) => StatRow[];
  /** Optional pairwise post-hoc comparisons table (e.g. Tukey/Bonferroni/pairwise Wilcoxon). */
  comparisons?: (
    v: Record<string, number | null>,
    groups: GroupDescriptives[],
    params: P | undefined,
  ) => ComparisonRow[] | undefined;
  /** Heading for the comparisons table, e.g. "Tukey's multiple comparisons test". */
  comparisonsLabel?: (params: P | undefined) => string | undefined;
  /** Static notes, or resolved from params (e.g. which t-test variant ran) — also given
   *  the parsed groups and raw columns, for notes that depend on data shape (e.g. how
   *  many rows were dropped for missing data). */
  notes: string | ((params: P | undefined, groups: Group[], columns: Column[]) => string);
  /** Resolved test name shown under the result heading, e.g. "Welch's t test". */
  subtitle?: (params: P | undefined) => string;
  /** Optional human-readable fitted-model equation (regressions), from the R values. */
  equation?: (
    v: Record<string, number | null>,
    groups: GroupDescriptives[],
    params: P | undefined,
  ) => string | undefined;
}

/** Run a column test: parse → validate → evaluate R → assemble the unified result. */
export async function runColumnTest<P>(
  columns: Column[],
  spec: ColumnTestSpec<P>,
  params?: P,
): Promise<AnalysisOutcome> {
  const problem = spec.check?.(columns, params);
  if (problem) return { error: problem };
  const available = (spec.parseGroups ?? dataGroups)(columns, params);
  if (available.length < spec.minGroups) {
    return {
      error: `This test needs at least ${spec.minGroups} column${spec.minGroups > 1 ? "s" : ""} containing numeric data.`,
    };
  }
  // Only the columns the test actually consumes are run and described.
  const groups = spec.maxGroups ? available.slice(0, spec.maxGroups) : available;
  try {
    const v = await evalNamedVector(spec.rCode(groups, params));
    const described = groups.map(describe);
    const notes =
      typeof spec.notes === "function" ? spec.notes(params, groups, columns) : spec.notes;
    const comparisons = spec.comparisons?.(v, described, params);
    return {
      testType: spec.testType,
      subtitle: spec.subtitle?.(params),
      equation: spec.equation?.(v, described, params),
      stats: spec.rows(v, described, params),
      groups: described,
      notes,
      comparisons,
      comparisonsLabel: comparisons?.length ? spec.comparisonsLabel?.(params) : undefined,
    };
  } catch (err) {
    return { error: `Could not run the test: ${err instanceof Error ? err.message : String(err)}` };
  }
}
