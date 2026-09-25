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
  NonlinearRegressionParams,
  OutliersParams,
  TwoWayAnovaParams,
  XYCorrelationParams,
} from "./types";
import { runColumnTest, type ColumnTestSpec } from "./column/base";
import { runDescriptiveStatistics } from "./column/descriptive-statistics";
import { compareTwoGroupsSpec } from "./column/compare-two-groups";
import { oneSampleTSpec } from "./column/one-sample-t";
import { anovaSpec } from "./column/anova";
import { kruskalWallisSpec } from "./column/kruskal-wallis";
import { rmAnovaSpec } from "./column/rm-anova";
import { friedmanSpec } from "./column/friedman";
import { shapiroWilkSpec } from "./column/shapiro-wilk";
import { runRout } from "./column/rout";
import { runXYCorrelation } from "./xy/correlation";
import { linearRegressionSpec } from "./xy/linear-regression";
import { runAreaUnderCurve } from "./xy/area-under-curve";
import { runNonlinearRegression } from "./xy/nonlinear-regression";
import { runTwoWayAnova } from "./grouped/two-way-anova";
import { runMultipleTTests } from "./grouped/multiple-t-tests";
import { runCorrelationMatrix } from "./multiple/correlation-matrix";
import { runMultipleRegression } from "./multiple/multiple-regression";
import { runChiSquare } from "./contingency/chi-square";
import type { TableData } from "../store/types";
import { readTable, type Column } from "../lib/dataset";

/** How every test runs: the table's columns, the wizard's params, and the row
 *  titles, which name the rows in grouped-table results. */
type Runner = (
  columns: Column[],
  params: AnalysisParams | undefined,
  titles: (string | null)[],
) => Promise<AnalysisOutcome>;

export interface Analysis {
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
  "shapiro-wilk": spec("Shapiro-Wilk normality", shapiroWilkSpec),
  outliers: { label: "Identify outliers (ROUT)", minColumns: 1, run: (c, p) => runRout(c, p as OutliersParams) },
  correlation: { label: "Correlation", minColumns: 2, run: (c, p) => runXYCorrelation(c, p as XYCorrelationParams) },
  "linear-regression": spec("Linear regression", linearRegressionSpec),
  "area-under-curve": {
    label: "Area under the curve",
    minColumns: 2,
    run: (c, p) => runAreaUnderCurve(c, p as AreaUnderCurveParams),
  },
  "nonlinear-regression": {
    label: "Nonlinear regression",
    minColumns: 2,
    run: (c, p) => runNonlinearRegression(c, p as NonlinearRegressionParams),
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
  "chi-square": { label: "Chi-square (contingency)", minColumns: 2, run: (c) => runChiSquare(c) },
};

// One result per table version, test and params, shared by everyone who asks:
// the analysis view and the graphs' overlays read the same run, so R works once.
// An edit makes a new TableData, which starts a fresh set of results.
const results = new WeakMap<TableData, Map<string, Promise<AnalysisOutcome>>>();

export function runAnalysis(testType: AnalysisType, data: TableData, params?: AnalysisParams): Promise<AnalysisOutcome> {
  const analysis = ANALYSES[testType];
  if (!analysis) return Promise.resolve({ error: `Unknown analysis type: ${String(testType)}` });
  const byTest = results.get(data) ?? new Map<string, Promise<AnalysisOutcome>>();
  results.set(data, byTest);
  const key = `${testType} ${JSON.stringify(params ?? null)}`;
  let result = byTest.get(key);
  if (!result) {
    const { columns, titles } = readTable(data);
    result = analysis.run(columns, params, titles).catch((err: unknown) => {
      // A failure (an R error, R not starting) is shown, not kept: asking again retries.
      byTest.delete(key);
      return { error: err instanceof Error ? err.message : "The analysis failed to run." };
    });
    byTest.set(key, result);
  }
  return result;
}
