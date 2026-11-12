// Analysis contract — the single source of truth for what a test receives
// (columns + params) and returns (a result or an error).

export type AnalysisType =
  | "descriptive-statistics"
  | "compare-two-groups"
  | "one-sample-t"
  | "anova"
  | "kruskal-wallis"
  | "rm-anova"
  | "friedman"
  | "shapiro-wilk"
  | "correlation"
  | "linear-regression"
  | "area-under-curve"
  | "nonlinear-regression"
  | "two-way-anova"
  | "multiple-t-tests"
  | "correlation-matrix"
  | "multiple-regression"
  | "outliers"
  | "chi-square"
  | "survival"
  | "cox";

/** What the New Analysis picker offers: a test, or "Compare more than two groups",
 *  which its wizard resolves to one-way ANOVA, Kruskal-Wallis, repeated-measures ANOVA
 *  or Friedman (as Prism does). */
export type AnalysisPickerValue = AnalysisType | "compare-many-groups" | "interpolate";

// The choices of the params, one list each: wizards ask among them, the types come from
// them, and a file's value outside them is left out (the test takes its default).
export const TAILS = ["two-sided", "less", "greater"] as const;
const POSTHOCS = ["none", "tukey", "bonferroni"] as const;
/** A one-way ANOVA's comparisons: every pair (Tukey, Bonferroni; with unequal SDs Games-Howell,
 *  Dunnett's T3), or each group against a control (Dunnett). */
export const ANOVA_POSTHOCS = [...POSTHOCS, "dunnett", "games-howell", "t3"] as const;
export const RANK_POSTHOCS = ["none", "dunn"] as const;
/** The dose-response (sigmoidal) models: what the Dose-response graph draws, and what can
 *  compare two data sets' curves. */
export const DOSE_MODELS = [
  "sigmoidal-4pl-logx",
  "sigmoidal-4pl-x",
  "agonist-3pl-logx",
  "inhibitor-3pl-logx",
  "asymmetric-5pl-logx",
  "asymmetric-5pl-x",
] as const;
/** Curves of growth, decay and enzyme kinetics: not standard curves to interpolate. */
export const KINETIC_MODELS = ["exponential-growth", "one-phase-decay", "michaelis-menten"] as const;
export const NONLINEAR_MODELS = [
  ...DOSE_MODELS,
  "line",
  "semilog-line",
  "hyperbola",
  "quadratic",
  "cubic",
  ...KINETIC_MODELS,
] as const;
/** What comparing two curves asks: is the EC50 different, or does one curve fit both. */
export const CURVE_COMPARISONS = ["ec50", "all"] as const;
export const CORRELATION_METHODS = ["pearson", "spearman"] as const;
export const CORRELATION_MODES = ["x-vs-every-y", "two-datasets", "matrix"] as const;
export const TWO_WAY_DESIGNS = ["ordinary", "repeated-measures", "nonparametric"] as const;
export const POSTHOC_TARGETS = ["groups", "rows"] as const;
export const CORRECTIONS = ["holm", "fdr", "none"] as const;
export const CURVE_TESTS = ["logrank", "trend", "gehan"] as const;
/** ROUT's Q, in percent. */
export const ROUT_Q = { min: 0.01, max: 50 };

/** Params for "compare-two-groups": resolves to Student/Welch t-test, paired
 *  t-test, ratio or lognormal t-test, Mann-Whitney, or Wilcoxon signed-rank, Prism-wizard style. */
export interface CompareTwoGroupsParams {
  paired: boolean;
  gaussian: boolean;
  /** Only meaningful when gaussian && !paired (Student vs Welch). */
  equalVariance: boolean;
  /** Only meaningful when paired && gaussian: compare ratios (log-transformed)
   *  instead of differences — for data where proportional change is what matters. */
  ratio: boolean;
  /** Only meaningful when gaussian && !paired: compare the geometric means, a t test on the
   *  logarithms (lognormal t test, Student's or Welch's). Its own param, not `ratio`: a file
   *  of an older Helix may hold a `ratio` left from a paired answer. */
  lognormal?: boolean;
  /** "less"/"greater" follow R's t.test semantics: alternative on (col0 vs col1). */
  tails: (typeof TAILS)[number];
}

/** Params for "one-sample-t": tests each column against a hypothetical value —
 *  resolves to a one-sample t test (gaussian) or a Wilcoxon signed-rank test. */
export interface OneSampleTParams {
  hypotheticalValue: number;
  tails: (typeof TAILS)[number];
  gaussian: boolean;
}

/** Params for "anova": optional post-hoc pairwise comparisons between groups. */
export interface AnovaParams {
  posthoc: (typeof ANOVA_POSTHOCS)[number];
  /** false: Welch's ANOVA (the groups' SDs differ); absent or true, the ordinary one. */
  equalSd?: boolean;
  /** Dunnett's control group, by name. */
  control?: string;
}

/** Params for "rm-anova": Tukey or Bonferroni comparisons of every pair, or none. */
export interface RmAnovaParams {
  posthoc: (typeof POSTHOCS)[number];
  /** false: not assumed, the Geisser-Greenhouse correction applies; absent or true, assumed. */
  sphericity?: boolean;
}

/** Params for "kruskal-wallis": optional Dunn's post-hoc pairwise comparisons between groups. */
export interface KruskalWallisParams {
  posthoc: (typeof RANK_POSTHOCS)[number];
}

/** Params for "friedman": optional Dunn's post-hoc pairwise comparisons between groups
 *  (block-rank flavor — same "none" | "dunn" shape as Kruskal-Wallis). */
export interface FriedmanParams {
  posthoc: (typeof RANK_POSTHOCS)[number];
}

/** Params for "linear-regression": which Y series to regress on X, and whether to
 *  force the line through the origin (intercept = 0). */
export interface LinearRegressionParams {
  /** The X variable of a Multiple Variables table; omitted, X is the first data column (XY). */
  x?: string;
  /** Omitted defaults to the first Y data column. */
  y?: string;
  forceOrigin: boolean;
}

/** Params for "area-under-curve": trapezoidal-rule AUC of every Y series against X,
 *  measured from a horizontal baseline (Prism's "Baseline Y =", default 0). */
export interface AreaUnderCurveParams {
  /** Baseline Y value the area is measured from (peaks are heights above it). */
  baseline: number;
}

/** The curves a nonlinear regression fits. `-logx`/`-x` say whether X is log(concentration)
 *  or the concentration. Line, semilog and polynomials are linear in their parameters (lm);
 *  the others nonlinear (nls). */
export type NonlinearModel = (typeof NONLINEAR_MODELS)[number];

/** Params for "nonlinear-regression" (XY table): which Y data set to fit, and which curve. */
export interface NonlinearRegressionParams {
  /** Omitted defaults to the first Y data column. */
  y?: string;
  model: NonlinearModel;
  /** A dose-response curve compared with this other Y data set's (an extra sum-of-squares F test). */
  compareWith?: string;
  compare?: (typeof CURVE_COMPARISONS)[number];
  /** Interpolate the unknowns: the rows holding a Y but no X get the X the curve gives them. */
  interpolate?: boolean;
}

/** Params for "correlation-matrix": Pearson (parametric) vs. Spearman
 *  (rank-based, non-parametric). */
export interface CorrelationParams {
  method: (typeof CORRELATION_METHODS)[number];
}

/** Params for "correlation" on an XY table, Prism-style: Pearson vs. Spearman, and
 *  which of 3 modes to run — X against every Y series, two explicitly chosen data
 *  series, or a full correlation matrix among the Y series (X excluded). */
export interface XYCorrelationParams {
  method: (typeof CORRELATION_METHODS)[number];
  mode: (typeof CORRELATION_MODES)[number];
  /** Required for "two-datasets": the two column names to correlate. */
  datasets?: [string, string];
}

/** Params for "multiple-regression": which variable is the dependent (Y), and which
 *  other data-bearing variables to include as predictors. `predictors` omitted (or
 *  empty) falls back to every other data-bearing variable. */
export interface MultipleRegressionParams {
  dependent: string;
  predictors?: string[];
}

/** Params for "two-way-anova" on a Grouped table's column-groups × row position:
 *  "ordinary" (parametric, independent samples), "repeated-measures" (parametric,
 *  matched by row — each replicate column is the same subject across every row;
 *  incomplete replicate columns are dropped), or "nonparametric" (Scheirer-Ray-Hare).
 *  `posthoc` (parametric designs only) pairwise-compares either groups within each
 *  row or rows within each group ("row means"), Tukey- or Bonferroni-corrected. */
export interface TwoWayAnovaParams {
  design: (typeof TWO_WAY_DESIGNS)[number];
  posthoc: (typeof POSTHOCS)[number];
  posthocTarget: (typeof POSTHOC_TARGETS)[number];
  /** Repeated measures: false (new analyses) corrects the row and interaction effects by the
   *  Geisser-Greenhouse epsilon, and compares on each comparison's own error; absent (older
   *  files) or true, sphericity is assumed. */
  sphericity?: boolean;
}

/** Params for "multiple-t-tests": a per-row t test (or Wilcoxon/Mann-Whitney)
 *  between a Grouped table's exactly-2 column-groups, with a multiplicity
 *  correction across rows. `paired` runs a paired test, matching replicate columns
 *  by position between the 2 groups. `pooledSd` (parametric only) assumes every row
 *  shares one SD (pooled across rows) instead of estimating each row's independently
 *  — more power when that assumption holds. */
export interface MultipleTTestsParams {
  paired: boolean;
  gaussian: boolean;
  pooledSd: boolean;
  correction: (typeof CORRECTIONS)[number];
}

/** Params for "outliers" (Column table): ROUT-style outlier detection — each
 *  column is fit independently to a robust mean, and residuals are flagged
 *  outliers when their FDR-adjusted P falls below Q (Prism's "Q%", the
 *  maximum desired false discovery rate — smaller Q is more conservative). */
export interface OutliersParams {
  q: number;
  /** Grubbs' test instead of ROUT: one outlier at most per column, at alpha = 0.05. */
  grubbs?: boolean;
}

/** The data sets an analysis runs on, in this order: columns, or a grouped table's groups.
 *  Absent (files before Helix 1.0.5): all of them, the first two for a two-group test. */
interface DataSetsParam {
  sets?: string[];
}

export type AnalysisParams = DataSetsParam &
  (
    | DataSetsParam
    | CompareTwoGroupsParams
    | OneSampleTParams
    | AnovaParams
    | RmAnovaParams
    | KruskalWallisParams
    | FriedmanParams
    | CorrelationParams
    | XYCorrelationParams
    | LinearRegressionParams
    | AreaUnderCurveParams
    | NonlinearRegressionParams
    | TwoWayAnovaParams
    | MultipleTTestsParams
    | MultipleRegressionParams
    | OutliersParams
    | SurvivalParams
    | CoxParams
  );

/** Params for "survival" (Survival table): the test comparing the curves — log-rank,
 *  log-rank for trend (groups in a meaningful order, 3 or more), or Gehan-Breslow-Wilcoxon
 *  (more weight on early events) — and, with 3 groups or more, how the pairwise
 *  comparisons are corrected. */
export interface SurvivalParams {
  curveTest: (typeof CURVE_TESTS)[number];
  correction: (typeof CORRECTIONS)[number];
}

/** Params for "cox" (Survival table): the group the others' hazards are compared to;
 *  omitted, the first holding subjects. */
export interface CoxParams {
  reference?: string;
}

/** What every test reads: the table's data columns, parsed once (see lib/dataset.ts). */
export type { Column } from "../lib/dataset";

/** Descriptive statistics for one group (computed in JS, not R). `ciLow`/`ciHigh`
 *  (95% confidence interval of the mean) and `min`/`max`/`range` are only populated
 *  by the standalone "descriptive-statistics" analysis — every other test leaves
 *  them undefined, so the results view only shows those columns for that analysis. */
export interface GroupDescriptives {
  name: string;
  mean: number | null;
  sd: number | null;
  sem: number | null;
  median: number | null;
  n: number;
  ciLow?: number | null;
  ciHigh?: number | null;
  min?: number | null;
  max?: number | null;
  range?: number | null;
}

/** One displayed statistic. `p: true` marks a P value (rendered with significance colour + stars). */
export interface StatRow {
  label: string;
  value: number | null;
  p?: boolean;
}

/** One pairwise post-hoc comparison row (e.g. Tukey/Bonferroni/pairwise Wilcoxon). */
export interface ComparisonRow {
  group1: string;
  group2: string;
  /** Mean of group1 minus mean of group2. */
  diff: number | null;
  p: number | null;
}

/** A square correlation matrix: `r[i][j]` is the coefficient between variable i
 *  and j (symmetric, diagonal = 1), `p[i][j]` the matching P value. */
interface CorrelationMatrix {
  variables: string[];
  r: (number | null)[][];
  p: (number | null)[][];
  label?: string;
}

/** One group of a survival analysis: its subjects, its events, and its median survival with
 *  the median's 95% interval (null where the curve, or the band's edge, never reaches 50%). */
export interface SurvivalGroupRow {
  group: string;
  subjects: number;
  events: number;
  median: number | null;
  low: number | null;
  high: number | null;
}

/** A Cox regression's hazard ratio of a group to the reference group ("A vs. B"), its 95%
 *  interval and P. */
export interface HazardRatioRow {
  comparison: string;
  ratio: number | null;
  low: number | null;
  high: number | null;
  p: number | null;
}

/** One row of a regression coefficients table (intercept or a predictor). */
export interface RegressionCoefficient {
  term: string;
  estimate: number | null;
  stdError: number | null;
  t: number | null;
  p: number | null;
  /** Its 95% confidence interval (asymptotic for a nonlinear fit). */
  low?: number | null;
  high?: number | null;
}

/** One row of best-fit values: a value per data set, or an interval (`ranges`, low and high). */
export interface FitRow {
  label: string;
  values?: (number | null)[];
  ranges?: [number | null, number | null][];
}

/** An unknown read off a standard curve: its row, its Y, the X the curve gives it (null when
 *  the curve never reaches that Y), 10^X when X is a log, and whether X lies beyond the
 *  standards' X. */
export interface InterpolatedRow {
  label: string;
  y: number;
  x: number | null;
  concentration?: number | null;
  extrapolated: boolean;
}

/** One row of "correlation" results in "x-vs-every-y" mode: X vs. one Y series. */
export interface CorrelationRow {
  variable: string;
  r: number | null;
  p: number | null;
}

/** One row of "area-under-curve" results: one Y series' trapezoidal AUC vs. X. */
export interface AreaUnderCurveRow {
  variable: string;
  area: number | null;
  n: number;
}

/** One row of "outliers" results: one column's outlier count, with ROUT's robust mean or
 *  Grubbs' statistic for its most extreme value. */
interface OutlierGroupRow {
  group: string;
  points: number;
  outliers: number;
  percent: number;
  robustMean: number | null;
  grubbs?: { extreme: number | null; g: number | null; p: number | null };
}

/** One row of "shapiro-wilk" results: a data set's test of normality, and of lognormality
 *  (on its logarithms); none where it can't be tested. */
export interface NormalityRow {
  group: string;
  w: number | null;
  p: number | null;
  logW: number | null;
  logP: number | null;
}

/** Unified result shape returned by every analysis module. */
export interface AnalysisResult {
  testType: AnalysisType;
  /** Resolved test name when params pick a specific variant, e.g. "Welch's t test". */
  subtitle?: string;
  /** What the results mean, in plain words, under the heading. */
  summary?: string;
  /** Optional per-data-set normality table ("shapiro-wilk"). */
  normality?: NormalityRow[];
  /** Human-readable fitted-model equation, e.g. "Y = 2.927*X − 0.3322" (regressions). */
  equation?: string;
  stats: StatRow[];
  groups: GroupDescriptives[];
  notes: string;
  /** Optional pairwise post-hoc comparisons table. */
  comparisons?: ComparisonRow[];
  comparisonsLabel?: string;
  /** Optional correlation matrix (Multiple Variables correlation matrix). */
  matrix?: CorrelationMatrix;
  /** Optional regression coefficients table (multiple regression). */
  coefficients?: RegressionCoefficient[];
  /** A curve fit's best-fit values, one column per data set (two when curves are compared). */
  fit?: { sets: string[]; rows: FitRow[] };
  /** A standard curve's unknowns, interpolated. */
  interpolated?: InterpolatedRow[];
  /** Optional per-Y correlations table ("correlation", "x-vs-every-y" mode). */
  correlations?: CorrelationRow[];
  /** Optional per-Y area-under-curve table ("area-under-curve"). */
  areas?: AreaUnderCurveRow[];
  /** Optional per-column outlier summary ("outliers"). */
  outlierGroups?: OutlierGroupRow[];
  /** Optional per-group survival summary ("survival"). */
  survivalGroups?: SurvivalGroupRow[];
  /** What the comparisons table's second column holds, when not a difference of means. */
  comparisonsEffect?: string;
  /** Optional hazard ratios of a Cox regression, each group's to the reference's. */
  hazardRatios?: HazardRatioRow[];
}

/** A test returns either a result or a user-facing error message. */
export type AnalysisOutcome = AnalysisResult | { error: string };
