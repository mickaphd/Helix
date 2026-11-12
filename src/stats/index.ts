// The analyses: one entry per test (its name, the data columns it needs, how it runs)
// and the one place analyses are run from. Adding a test = its file + an entry here
// (+ a wizard in views/analyses/wizards.ts when it has options).

import type {
  AnalysisType,
  AnalysisOutcome,
  AnalysisParams,
  AreaUnderCurveParams,
  CorrelationParams,
  MultipleRegressionParams,
  MultipleTTestsParams,
  LinearRegressionParams,
  LogisticRegressionParams,
  NonlinearRegressionParams,
  OutliersParams,
  SurvivalParams,
  CoxParams,
  TwoWayAnovaParams,
  XYCorrelationParams,
} from "./types";
import { missingColumn, runColumnTest, type ColumnTestSpec } from "./column/base";
import { runDescriptiveStatistics } from "./column/descriptive-statistics";
import { compareTwoGroupsSpec } from "./column/compare-two-groups";
import { oneSampleTSpec } from "./column/one-sample-t";
import { anovaSpec } from "./column/anova";
import { kruskalWallisSpec } from "./column/kruskal-wallis";
import { rmAnovaSpec } from "./column/rm-anova";
import { friedmanSpec } from "./column/friedman";
import { runNormality } from "./column/shapiro-wilk";
import { runGrubbs, runRout } from "./column/rout";
import { runXYCorrelation } from "./xy/correlation";
import { linearRegressionSpec, runLinearRegressions } from "./xy/linear-regression";
import { runAreaUnderCurve } from "./xy/area-under-curve";
import { runNonlinearRegression } from "./xy/nonlinear-regression";
import { runLogisticRegression } from "./xy/logistic-regression";
import { runTwoWayAnova } from "./grouped/two-way-anova";
import { runMultipleTTests } from "./grouped/multiple-t-tests";
import { runCorrelationMatrix } from "./multiple/correlation-matrix";
import { runMultipleRegression } from "./multiple/multiple-regression";
import { runChiSquare } from "./contingency/chi-square";
import { runSurvival } from "./survival/survival-analysis";
import { runCox } from "./survival/cox-regression";
import type { TableData } from "../store/types";
import { readTable, setColumns, type Column } from "../lib/dataset";

/** How every test runs: the columns of its data sets (`sets`, all by default), the
 *  wizard's params, and the row titles, which name the rows in grouped-table results. */
type Runner = (
  columns: Column[],
  params: AnalysisParams | undefined,
  titles: (string | null)[],
) => Promise<AnalysisOutcome>;

interface Analysis {
  label: string;
  /** The exact test these params run ("Welch's t test"), to name a new analysis. */
  name?: (params: AnalysisParams | undefined) => string;
  /** Data columns (holding numbers) the test needs; checked before it is created. */
  minColumns: number;
  run: Runner;
}

/** A column test from its spec. The params cast is confined here: each spec stays
 *  type-checked against its own params. */
const spec = <P>(label: string, s: ColumnTestSpec<P>): Analysis => ({
  label,
  name: s.subtitle && ((params) => s.subtitle!(params as P | undefined)),
  minColumns: s.minGroups,
  run: (columns, params) => runColumnTest(columns, s, params as P | undefined),
});

export const ANALYSES: Record<AnalysisType, Analysis> = {
  "descriptive-statistics": { label: "Descriptive statistics", minColumns: 1, run: (c) => runDescriptiveStatistics(c) },
  "compare-two-groups": spec("Compare two groups", compareTwoGroupsSpec),
  "one-sample-t": spec("Compare one group to a value", oneSampleTSpec),
  anova: spec("One-way ANOVA", anovaSpec),
  "kruskal-wallis": spec("Kruskal-Wallis test", kruskalWallisSpec),
  "rm-anova": spec("Repeated-measures ANOVA", rmAnovaSpec),
  friedman: spec("Friedman test", friedmanSpec),
  "shapiro-wilk": { label: "Normality and lognormality test", minColumns: 1, run: (c) => runNormality(c) },
  outliers: {
    label: "Identify outliers",
    name: (p) => {
      const { q = 1, grubbs } = (p ?? {}) as Partial<OutliersParams>;
      return grubbs ? "Outliers (Grubbs)" : `Outliers (ROUT, Q = ${q}%)`;
    },
    minColumns: 1,
    run: (c, p) => ((p as OutliersParams | undefined)?.grubbs ? runGrubbs(c) : runRout(c, p as OutliersParams)),
  },
  correlation: { label: "Correlation", minColumns: 2, run: (c, p) => runXYCorrelation(c, p as XYCorrelationParams) },
  "linear-regression": {
    ...spec("Linear regression", linearRegressionSpec),
    // Several Y data sets: each regressed on its own, side by side; one: as the spec says.
    run: (c, p) => {
      const params = p as LinearRegressionParams | undefined;
      const ys = params?.ys ?? [];
      return ys.length > 1
        ? runLinearRegressions(c, { ...params!, ys })
        : runColumnTest(c, linearRegressionSpec, ys.length ? { ...params!, y: ys[0], ys: undefined } : params);
    },
  },
  "logistic-regression": {
    label: "Simple logistic regression",
    minColumns: 2,
    run: (c, p) => runLogisticRegression(c, p as LogisticRegressionParams),
  },
  "area-under-curve": {
    label: "Area under the curve",
    minColumns: 2,
    run: (c, p) => runAreaUnderCurve(c, p as AreaUnderCurveParams),
  },
  "nonlinear-regression": {
    label: "Nonlinear regression",
    minColumns: 2,
    name: (p) =>
      (p as NonlinearRegressionParams | undefined)?.interpolate
        ? "Interpolated standard curve"
        : "Nonlinear regression",
    run: (c, p, t) => runNonlinearRegression(c, p as NonlinearRegressionParams, t),
  },
  "two-way-anova": {
    label: "Two-way ANOVA",
    minColumns: 2,
    run: (c, p, t) => runTwoWayAnova(c, p as TwoWayAnovaParams, t),
  },
  "multiple-t-tests": {
    label: "Multiple t tests",
    minColumns: 2,
    run: (c, p, t) => runMultipleTTests(c, p as MultipleTTestsParams, t),
  },
  "correlation-matrix": {
    label: "Correlation matrix",
    minColumns: 2,
    run: (c, p) => runCorrelationMatrix(c, p as CorrelationParams),
  },
  "multiple-regression": {
    label: "Multiple regression",
    minColumns: 2,
    run: (c, p) => runMultipleRegression(c, p as MultipleRegressionParams),
  },
  "chi-square": { label: "Chi-square or Fisher's exact test", minColumns: 2, run: (c) => runChiSquare(c) },
  survival: { label: "Survival analysis", minColumns: 3, run: (c, p) => runSurvival(c, p as SurvivalParams) },
  cox: { label: "Cox proportional hazards regression", minColumns: 3, run: (c, p) => runCox(c, p as CoxParams) },
};

// One result per table version, test and params, shared by everyone who asks:
// the analysis view and the graphs' overlays read the same run, so R works once.
// An edit makes a new TableData, which starts a fresh set of results.
const results = new WeakMap<TableData, Map<string, Promise<AnalysisOutcome>>>();

export function runAnalysis(
  testType: AnalysisType,
  data: TableData,
  params?: AnalysisParams,
): Promise<AnalysisOutcome> {
  const analysis = Object.hasOwn(ANALYSES, testType) ? ANALYSES[testType] : undefined;
  if (!analysis) return Promise.resolve({ error: `Unknown analysis type: ${String(testType)}` });
  const table = readTable(data);
  // A data set or a column the analysis names (a regression's Y…) must still be there.
  // prettier-ignore
  const named = params as
    { x?: string; y?: string; ys?: string[]; dependent?: string; reference?: string; control?: string; compareWith?: string; predictors?: string[]; datasets?: string[] } | undefined;
  // prettier-ignore
  const chosen = [named?.x, named?.y, named?.dependent, named?.reference, named?.control, named?.compareWith, ...(named?.ys ?? []), ...(named?.predictors ?? []), ...(named?.datasets ?? [])];
  const gone =
    params?.sets?.find((name) => !table.sets.some((s) => s.name === name)) ??
    chosen.find(
      (name) =>
        name !== undefined && !table.columns.some((c) => c.name === name) && !table.sets.some((s) => s.name === name),
    );
  if (gone) return Promise.resolve({ error: missingColumn(gone) });
  const byTest = results.get(data) ?? new Map<string, Promise<AnalysisOutcome>>();
  results.set(data, byTest);
  const key = `${testType} ${JSON.stringify(params ?? null)}`;
  let result = byTest.get(key);
  if (!result) {
    const columns = params?.sets ? setColumns(table, params.sets) : table.columns;
    result = analysis.run(columns, params, table.titles).catch((err: unknown) => {
      // A failure (an R error, R not starting) is shown, not kept: asking again retries.
      byTest.delete(key);
      return { error: `Could not run the test: ${err instanceof Error ? err.message : String(err)}` };
    });
    byTest.set(key, result);
  }
  return result;
}
