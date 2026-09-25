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
  | "chi-square";

/** What the New Analysis picker offers: a test, or "Compare more than two groups",
 *  which its wizard resolves to one-way ANOVA, Kruskal-Wallis, repeated-measures ANOVA
 *  or Friedman (as Prism does). */
export type AnalysisPickerValue = AnalysisType | "compare-many-groups";

/** Params for "compare-two-groups": resolves to Student/Welch t-test, paired
 *  t-test, ratio t-test, Mann-Whitney, or Wilcoxon signed-rank, Prism-wizard style. */
export interface CompareTwoGroupsParams {
  paired: boolean;
  gaussian: boolean;
  /** Only meaningful when gaussian && !paired (Student vs Welch). */
  equalVariance: boolean;
  /** Only meaningful when paired && gaussian: compare ratios (log-transformed)
   *  instead of differences — for data where proportional change is what matters. */
  ratio: boolean;
  /** "less"/"greater" follow R's t.test semantics: alternative on (col0 vs col1). */
  tails: "two-sided" | "less" | "greater";
}

/** Params for "one-sample-t": tests each column against a hypothetical value —
 *  resolves to a one-sample t test (gaussian) or a Wilcoxon signed-rank test. */
export interface OneSampleTParams {
  hypotheticalValue: number;
  tails: "two-sided" | "less" | "greater";
  gaussian: boolean;
}

/** Params for "anova": optional post-hoc pairwise comparisons between groups. */
export interface AnovaParams {
  posthoc: "none" | "tukey" | "bonferroni";
}

/** Params for "kruskal-wallis": optional Dunn's post-hoc pairwise comparisons between groups. */
export interface KruskalWallisParams {
  posthoc: "none" | "dunn";
}

/** Params for "friedman": optional Dunn's post-hoc pairwise comparisons between groups
 *  (block-rank flavor — same "none" | "dunn" shape as Kruskal-Wallis). */
export interface FriedmanParams {
  posthoc: "none" | "dunn";
}

/** Params for "linear-regression" (XY table): which Y series to regress on X, and
 *  whether to force the line through the origin (intercept = 0). */
export interface LinearRegressionParams {
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

/** Curated "Standard curves to interpolate" models (Prism's first category) that
 *  fit reliably in WebR. `-logx`/`-x` note whether X is log(concentration) or the
 *  raw concentration. Line/semilog/quadratic/cubic are linear-in-parameters (lm);
 *  the sigmoidal + hyperbola forms are nonlinear (nls). */
export type NonlinearModel =
  | "line"
  | "sigmoidal-4pl-logx"
  | "sigmoidal-4pl-x"
  | "semilog-line"
  | "hyperbola"
  | "quadratic"
  | "cubic";

/** Params for "nonlinear-regression" (XY table): which Y series to fit, and which
 *  curated standard curve. */
export interface NonlinearRegressionParams {
  /** Omitted defaults to the first Y data column. */
  y?: string;
  model: NonlinearModel;
}

/** Params for "correlation-matrix": Pearson (parametric) vs. Spearman
 *  (rank-based, non-parametric). */
export interface CorrelationParams {
  method: "pearson" | "spearman";
}

/** Params for "correlation" on an XY table, Prism-style: Pearson vs. Spearman, and
 *  which of 3 modes to run — X against every Y series, two explicitly chosen data
 *  series, or a full correlation matrix among the Y series (X excluded). */
export interface XYCorrelationParams {
  method: "pearson" | "spearman";
  mode: "x-vs-every-y" | "two-datasets" | "matrix";
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
  design: "ordinary" | "repeated-measures" | "nonparametric";
  posthoc: "none" | "tukey" | "bonferroni";
  posthocTarget: "groups" | "rows";
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
  correction: "holm" | "fdr" | "none";
}

/** Params for "outliers" (Column table): ROUT-style outlier detection — each
 *  column is fit independently to a robust mean, and residuals are flagged
 *  outliers when their FDR-adjusted P falls below Q (Prism's "Q%", the
 *  maximum desired false discovery rate — smaller Q is more conservative). */
export interface OutliersParams {
  q: number;
}

export type AnalysisParams =
  | CompareTwoGroupsParams
  | OneSampleTParams
  | AnovaParams
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
  | OutliersParams;

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

/** One row of a regression coefficients table (intercept or a predictor). */
export interface RegressionCoefficient {
  term: string;
  estimate: number | null;
  stdError: number | null;
  t: number | null;
  p: number | null;
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

/** One row of "outliers" results: one column's outlier count + robust mean. */
export interface OutlierGroupRow {
  group: string;
  points: number;
  outliers: number;
  percent: number;
  robustMean: number | null;
}

/** Unified result shape returned by every analysis module. */
export interface AnalysisResult {
  testType: AnalysisType;
  /** Resolved test name when params pick a specific variant, e.g. "Welch's t test". */
  subtitle?: string;
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
  /** Optional per-Y correlations table ("correlation", "x-vs-every-y" mode). */
  correlations?: CorrelationRow[];
  /** Optional per-Y area-under-curve table ("area-under-curve"). */
  areas?: AreaUnderCurveRow[];
  /** Optional per-column outlier summary ("outliers"). */
  outlierGroups?: OutlierGroupRow[];
}

/** A test returns either a result or a user-facing error message. */
export type AnalysisOutcome = AnalysisResult | { error: string };
