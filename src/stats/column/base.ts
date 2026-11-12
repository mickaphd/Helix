// Shared logic for column-based tests. Each test is a `ColumnTestSpec` that
// only declares how many groups it needs, the R it runs, and how to label the
// resulting numbers. Every number an analysis shows comes from R, its groups'
// descriptives too (`describe`): the same for every test.

import type { TAILS, AnalysisType, AnalysisOutcome, Column, ComparisonRow, GroupDescriptives, StatRow } from "../types";
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

/** How many rows a matched test (on `columns`) leaves out: those holding some of its
 *  values, not one in every column. Empty rows don't count. */
export function incompleteRows(columns: Column[]): number {
  const used = new Set(dataGroups(columns).flatMap((c) => c.rows)).size;
  return used - (pairedGroups(columns)[0]?.values.length ?? 0);
}

/** What a matched test says of its rows: complete ones only, and how many it left out. */
export function matchedRowsNote(columns: Column[]): string {
  const left = incompleteRows(columns);
  const leftOut = left ? ` ${left} row${left === 1 ? "" : "s"} left out for missing data.` : "";
  return `Uses complete rows only (every subject measured in every group).${leftOut}`;
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

/** R: each group's (`G`, a list) n, mean, SD and SEM (n − 1; none under 2 values) and
 *  median, named `n_i`, `m_i`, `s_i`, `e_i`, `md_i`. */
export const R_DESCRIBE =
  "unlist(lapply(seq_along(G),function(i){x<-G[[i]];n<-length(x);s<-if(n>1)sd(x) else NA;" +
  'setNames(c(n,mean(x),s,s/sqrt(n),median(x)),paste0(c("n_","m_","s_","e_","md_"),i-1))}))';

/** Each group's descriptives, computed by R, and the difference of means of each of
 *  `pairs` (`diff(i, j)`). */
export async function describe(
  groups: Group[],
  pairs: [number, number][] = [],
): Promise<{ groups: GroupDescriptives[]; diff: (i: number, j: number) => number | null }> {
  const v = await evalNamedVector(
    `G<-list(${groups.map((g) => rVec(g.values)).join(",")});` +
      `c(${R_DESCRIBE}${pairs.map(([i, j]) => `,d_${i}_${j}=mean(G[[${i + 1}]])-mean(G[[${j + 1}]])`).join("")})`,
  );
  return {
    groups: groups.map((g, i) => ({
      name: g.name,
      mean: v[`m_${i}`] ?? null,
      sd: v[`s_${i}`] ?? null,
      sem: v[`e_${i}`] ?? null,
      median: v[`md_${i}`] ?? null,
      n: v[`n_${i}`] ?? 0,
    })),
    diff: (i, j) => v[`d_${i}_${j}`] ?? null,
  };
}

/** Render an R numeric vector literal from values. */
export const rVec = (values: number[]) => `c(${values.join(",")})`;

/** Escape a string for safe embedding in an R double-quoted literal, so a group
 *  or column name containing `"` or `\` can't break (or inject into) the R code. */
export const rStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Declare each group as an R variable `g0`, `g1`, … for use in a test's rCode. */
export const declareGroups = (groups: Group[]) => groups.map((g, i) => `g${i}<-${rVec(g.values)}`).join(";");

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
export const rAlt = (tails: (typeof TAILS)[number]) => (tails === "two-sided" ? "two.sided" : tails);

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

/** The comparisons table: each pair's names, its difference of means and its P value. */
function buildComparisons(
  groups: Group[],
  pairs: [number, number][],
  diff: (i: number, j: number) => number | null,
  pValueFor: (i: number, j: number) => number | null,
): ComparisonRow[] {
  return pairs.map(([i, j]) => ({
    group1: groups[i].name,
    group2: groups[j].name,
    diff: diff(i, j),
    p: pValueFor(i, j),
  }));
}

/** The post-hoc comparisons a test can follow with, as their table is headed. */
const POSTHOC_LABELS: Record<string, string> = {
  tukey: "Tukey's multiple comparisons test",
  bonferroni: "Bonferroni-corrected multiple comparisons",
  dunn: "Dunn's multiple comparisons test (Bonferroni-corrected)",
  "games-howell": "Games-Howell multiple comparisons test",
  t3: "Dunnett's T3 multiple comparisons test",
};

/** The heading of the post-hoc a test's params ask for; none for "none". */
export const posthocOf = (params: { posthoc?: string; control?: string } | undefined) =>
  params?.posthoc === "dunnett"
    ? `Dunnett's multiple comparisons test (vs. ${params.control})`
    : params?.posthoc && Object.hasOwn(POSTHOC_LABELS, params.posthoc)
      ? POSTHOC_LABELS[params.posthoc]
      : undefined;

export interface ColumnTestSpec<P = unknown> {
  testType: AnalysisType;
  /** Minimum number of data columns the test requires. */
  minGroups: number;
  /** Cap on columns used (e.g. 2 for two-sample tests); omit to use all data columns. */
  maxGroups?: number;
  /** The values each group needs (1 by default); `matched`: these params pair the groups
   *  by row, so it is complete rows they need. */
  minValues?: number;
  matched?: (params: P | undefined) => boolean;
  /** An error to show instead of running (e.g. a chosen column is gone). */
  check?: (columns: Column[], params: P | undefined) => string | undefined;
  /** How to turn raw columns into groups; defaults to `dataGroups` (independent
   *  per-column filtering). Override for e.g. paired tests that need row alignment. */
  parseGroups?: (columns: Column[], params: P | undefined) => Group[];
  /** R that ends in a `c(name=value, …)` named vector, given the parsed groups (g0, g1, … available). */
  rCode: (groups: Group[], params: P | undefined) => string;
  /** Map the marshalled R values (+ descriptives) into display rows. */
  rows: (v: Record<string, number | null>, groups: GroupDescriptives[], params: P | undefined) => StatRow[];
  /** The post-hoc comparisons that ran, as their table's heading ("Tukey's multiple
   *  comparisons test"); none, no table. Its R gives each pair's P value as `p_i_j`. */
  posthoc?: (params: P | undefined) => string | undefined;
  /** The pairs it compares, group1 first (every pair by default: `pairIndices`). */
  pairs?: (groups: Group[], params: P | undefined) => [number, number][];
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
  const need = spec.minValues ?? 1;
  const few = groups.find((g) => g.values.length < need);
  if (few) {
    const n = few.values.length;
    return {
      error: spec.matched?.(params)
        ? `This test needs at least ${need} rows holding a value in every group; the table has ${n}.`
        : `“${few.name}” holds ${n} value${n === 1 ? "" : "s"}; this test needs at least ${need} in each group.`,
    };
  }
  const v = await evalNamedVector(spec.rCode(groups, params));
  // A post-hoc that ran gives every pair's P value as `p_i_j` (`pairIndices`).
  const posthoc = spec.posthoc?.(params);
  const pairs = posthoc ? (spec.pairs?.(groups, params) ?? pairIndices(groups.length)) : [];
  const { groups: described, diff } = await describe(groups, pairs);
  return {
    testType: spec.testType,
    subtitle: spec.subtitle?.(params),
    equation: spec.equation?.(v, described, params),
    stats: spec.rows(v, described, params),
    groups: described,
    notes: typeof spec.notes === "function" ? spec.notes(params, groups, columns) : spec.notes,
    comparisons: posthoc ? buildComparisons(groups, pairs, diff, (i, j) => v[`p_${i}_${j}`] ?? null) : undefined,
    comparisonsLabel: posthoc,
  };
}

/** R: Hedges' correction of a Cohen's d with `df` degrees of freedom, exact (none under 2 df). */
export const R_HEDGES = "J<-function(df)if(df<2)NA else exp(lgamma(df/2)-lgamma((df-1)/2))/sqrt(df/2)";
