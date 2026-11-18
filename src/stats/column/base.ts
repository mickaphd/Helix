// Shared logic for column-based tests. Each test is a `ColumnTestSpec` that
// only declares how many groups it needs, the R it runs, and how to label the
// resulting numbers. Every number an analysis shows comes from R, its groups'
// descriptives too (`describe`): the same for every test.

import { maxOf } from "../../lib/summary";
import { pairKey } from "../../lib/columns";
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
  return { groups: describedBy(v, groups), diff: (i, j) => v[`d_${i}_${j}`] ?? null };
}

/** Each group's descriptives as `R_DESCRIBE` names them in `v`. */
export const describedBy = (v: Record<string, number | null>, groups: { name: string }[]): GroupDescriptives[] =>
  groups.map((g, i) => ({
    name: g.name,
    mean: v[`m_${i}`] ?? null,
    sd: v[`s_${i}`] ?? null,
    sem: v[`e_${i}`] ?? null,
    median: v[`md_${i}`] ?? null,
    n: v[`n_${i}`] ?? 0,
  }));

/** Render an R numeric vector literal from values. */
export const rVec = (values: number[]) => `c(${values.join(",")})`;

/** Escape a string for safe embedding in an R double-quoted literal, so a group
 *  or column name containing `"` or `\` can't break (or inject into) the R code. */
export const rStr = (s: string) =>
  `"${s
    .replace(/\0/g, "") // R's strings can't hold a NUL
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;

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

/** R: `ptk(q, k, df)`, the studentized range's upper tail. R's `ptukey` needs 2 df or more;
 *  below (Games-Howell on duplicates, a paired comparison of 2 subjects), its exact integral
 *  over the SD's distribution, checked against Tukey's tables at 1 df and the t at k = 2. */
export const R_PTUKEY =
  "ptk<-function(q,k,df)if(is.na(q)||is.na(df))NA else if(df>=2)ptukey(q,k,df,lower.tail=FALSE) else " +
  "integrate(function(s)ptukey(q*s,k,Inf,lower.tail=FALSE)*2*df*s*dchisq(df*s^2,df),0,Inf,rel.tol=1e-10)$value";

/** R: P values corrected for the `m` pairs of a family (`adj`, from each pair's raw P), and a
 *  pair's corrected P from its |t| (`pa`), by `how`: Bonferroni, Šidák, Holm-Šidák (step-down:
 *  the smallest P against m pairs, the next against m − 1…, never below an earlier one) or
 *  Fisher's LSD (none). Holm-Šidák's step-down gives no CI (`pa` NA). */
export const R_ADJUST = `adj<-function(p,how){m<-length(p);if(how=="fisher")return(p);if(how=="bonferroni")return(pmin(1,m*p))
if(how=="sidak")return(1-(1-p)^m);o<-order(p);a<-cummax(1-(1-p[o])^(m-seq_len(m)+1));r<-numeric(m);r[o]<-pmin(1,a);r}
pa<-function(t,df,how,m){p<-2*pt(-abs(t),df);switch(how,fisher=p,bonferroni=pmin(1,m*p),sidak=1-(1-p)^m,NA)}`;

/** The pairs a test compares: every pair, or those `compared` names (`pairKey`, either way
 *  round), in the order of every pair. */
export function comparedPairs(groups: { name: string }[], compared: string[] | undefined): [number, number][] {
  const all = pairIndices(groups.length);
  if (!compared?.length) return all;
  const chosen = new Set(compared);
  return all.filter(
    ([i, j]) =>
      chosen.has(pairKey(groups[i].name, groups[j].name)) || chosen.has(pairKey(groups[j].name, groups[i].name)),
  );
}

/** R: `crit(f)`, the statistic at which a comparison's adjusted P (`f`, falling as the
 *  statistic grows) is 0.05: its multiplicity-adjusted 95% CI is its difference ± that many
 *  standard errors, so the CI leaves out 0 exactly when P < 0.05. */
export const R_CRIT =
  'crit<-function(f,from=c(0.01,50))tryCatch(uniroot(function(x)f(x)-0.05,from,extendInt="downX",tol=1e-10)$root,error=function(e)NA)';

/** R: a comparison's 95% CI as `lo_<key>` and `hi_<key>`: `diff` ± `crit(function(x) f)`
 *  standard errors (`se`). */
export const ciOf = (key: string, diff: string, se: string, f: string) => ciAt(key, diff, se, `crit(function(x)${f})`);

/** R: the same CI from a critical value `h` found once for a whole family (one Dunnett's or
 *  Tukey's: the same distribution for every comparison, its search done once). */
export const ciAt = (key: string, diff: string, se: string, h: string) =>
  `setNames({d<-${diff};h<-(${h})*(${se});c(d-h,d+h)},c("lo_${key}","hi_${key}"))`;

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
    // Under 2 residual df, TukeyHSD gives no P: each pair's q on the ANOVA's mean square instead.
    setup:
      `${R_PTUKEY};tk<-TukeyHSD(${aovExpr})$gr;rn<-rownames(tk);if(anyNA(tk[,4])){fa<-${aovExpr};dfr<-df.residual(fa);` +
      `ms<-deviance(fa)/dfr;nn<-table(gr);ij<-strsplit(rn,"-");tk[,4]<-mapply(function(d,p)` +
      `ptk(abs(d)/sqrt(ms/2*(1/nn[[p[1]]]+1/nn[[p[2]]])),${k},dfr),tk[,1],ij)};${assigns.join(";")}`,
    keys,
    assign: asNamedArgs(keys),
  };
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
  v: Record<string, number | null>,
): ComparisonRow[] {
  return pairs.map(([i, j]) => ({
    group1: groups[i].name,
    group2: groups[j].name,
    diff: diff(i, j),
    p: v[`p_${i}_${j}`] ?? null,
    ...(`lo_${i}_${j}` in v ? { low: v[`lo_${i}_${j}`], high: v[`hi_${i}_${j}`] ?? null } : {}),
  }));
}

/** The post-hoc comparisons a test can follow with, as their table is headed. */
const POSTHOC_LABELS: Record<string, string> = {
  tukey: "Tukey's multiple comparisons test",
  bonferroni: "Bonferroni-corrected multiple comparisons",
  sidak: "Šidák-corrected multiple comparisons",
  "holm-sidak": "Holm-Šidák-corrected multiple comparisons",
  fisher: "Fisher's LSD test, uncorrected",
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
  /** What the groups it runs on lack for this test, said before R runs (values all
   *  identical…), once each holds the values it needs. */
  checkGroups?: (groups: Group[], params: P | undefined) => string | undefined;
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
  /** Its comparisons are ratios of geometric means, R's `r_i_j` (a lognormal test). */
  ratios?: (params: P | undefined) => boolean;
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
  const lack = spec.checkGroups?.(groups, params);
  if (lack) return { error: lack };
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
    comparisons: posthoc
      ? buildComparisons(groups, pairs, spec.ratios?.(params) ? (i, j) => v[`r_${i}_${j}`] ?? null : diff, v)
      : undefined,
    comparisonsLabel: posthoc,
    ...(posthoc && spec.ratios?.(params) ? { comparisonsEffect: "Ratio of geometric means" } : {}),
  };
}

/** A 95% CI as shown: a one-tailed test's is open on one side (R gives ±Inf, which crosses
 *  into JS as null): ∞ there. `zero`: the CI of a ratio, whose lower end is then 0. */
export function ciRows(tails: string, lo: number | null, hi: number | null, prefix = "", zero = false): StatRow[] {
  return [
    { label: `${prefix}95% CI lower`, value: tails === "less" ? (zero ? 0 : -Infinity) : lo },
    { label: `${prefix}95% CI upper`, value: tails === "greater" ? Infinity : hi },
  ];
}

/** Whether the values are all the same: no scatter to test. */
export const identical = (values: number[]) => values.every((v) => v === values[0]);

/** Two results equal as typed: a computer's subtractions err by a few 1e-16 of the values'
 *  scale; 1e-13 of it is far above that, and below the 13th significant digit, beyond any
 *  measurement's (`R_DIFF` takes the same). */
const TYPED = 1e-13;
const scaleOf = (values: number[]) => maxOf(values.map(Math.abs));

/** Whether the paired differences `a − b` are all the same (as typed)… */
export function sameDifferences(a: number[], b: number[]): boolean {
  const tolerance = TYPED * scaleOf([...a, ...b]);
  return a.every((x, i) => Math.abs(x - b[i] - (a[0] - b[0])) <= tolerance);
}

/** …and all 0: every pair holds the same value twice. */
export const noDifference = (a: number[], b: number[]) =>
  sameDifferences(a, b) && Math.abs(a[0] - b[0]) <= TYPED * scaleOf([...a, ...b]);

/** Whether matched groups (a subject per row) leave no residual scatter: each value is its
 *  subject's level plus its group's, exactly (as typed). */
export function matchedFit(groups: Group[]): boolean {
  const k = groups.length;
  const n = groups[0].values.length;
  const all = groups.flatMap((g) => g.values);
  const tolerance = TYPED * scaleOf(all);
  const grand = all.reduce((a, v) => a + v, 0) / all.length;
  const col = groups.map((g) => g.values.reduce((a, v) => a + v, 0) / n);
  const row = groups[0].values.map((_, r) => groups.reduce((a, g) => a + g.values[r], 0) / k);
  return groups.every((g, j) => g.values.every((v, r) => Math.abs(v - row[r] - col[j] + grand) <= tolerance));
}

/** The error for groups whose values are all the same, or none. */
export function noScatter(groups: Group[], test: string): string | undefined {
  if (identical(groups.flatMap((g) => g.values)))
    return `All the values are identical: the ${test} has nothing to compare.`;
}

/** R: `a − b` as the decimals typed give it. A computer's 13.2 − 12.5 is 0.69999999999999929
 *  and its 1.3 − 0.6 is 0.70000000000000007: the signed-rank test would rank them apart. So
 *  sizes within 1e-13 of the values' scale of the next smaller one are made one (a tie), and
 *  differences within it of 0 are 0; grouped, not rounded, so no two land either side of a
 *  rounding edge. */
export const R_DIFF =
  "dif<-function(a,b){d<-a-b;t<-1e-13*max(abs(c(a,b)));d[abs(d)<=t]<-0;m<-abs(d);o<-order(m);" +
  "k<-cumsum(c(TRUE,diff(m[o])>t));m[o]<-m[o][match(k,k)];sign(d)*m}";

/** R: Hedges' correction of a Cohen's d with `df` degrees of freedom, exact (none under 2 df). */
export const R_HEDGES = "J<-function(df)if(df<2)NA else exp(lgamma(df/2)-lgamma((df-1)/2))/sqrt(df/2)";
