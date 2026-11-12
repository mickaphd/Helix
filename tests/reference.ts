// Reference test: runs every analysis (R) and draws every graph (Plotly figures) on
// fixed tables, then compares the results with `reference.json`. A change in any
// number shows up as a diff. `npm test` checks; `npm test -- --update` rewrites the
// reference after an intended change. It also checks that TypeScript and R agree
// where both compute the same thing, and that the sample project's items all work.
/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAnalysis } from "../src/stats";
import type { AnalysisParams, AnalysisType } from "../src/stats/types";
import type { GraphOptions, GraphType, TableData } from "../src/store/types";
import { GRAPHS, graphSeries, newGraphOptions, plotColumns } from "../src/views/graphs";
import { paintOf } from "../src/views/graphs/plot-helpers";
import { pairUp, readTable, splitXY } from "../src/lib/dataset";
import { countDataColumns, countDataGroups } from "../src/views/analyses";
import { fitLinear } from "../src/views/graphs/regression-overlay";
import { computeGroupedDEG } from "../src/lib/deg";
import { tCrit95 } from "../src/lib/student-t";
import { kaplanMeier } from "../src/lib/kaplan-meier";
import { rVec } from "../src/stats/column/base";
import { R_MAXIMUM_T } from "../src/stats/column/anova";
import { R_GRUBBS } from "../src/stats/column/rout";
import { evaluate as doseCurveAt } from "../src/views/graphs/fitted-curve";
import { NONLINEAR_MODELS, type NonlinearModel } from "../src/stats/types";
import { positiveXOnly } from "../src/stats/xy/nonlinear-regression";
import { evalNamedVector, startR } from "../src/stats/webr";
import { sampleProject } from "./sample-project";

// ── Tables ───────────────────────────────────────────────────────────────

/** A table from a header and rows of cells ("" = blank). */
const table = (columns: string[], rows: string[][], extra: Partial<TableData> = {}): TableData => ({
  columns,
  rows: rows.map((row) => row.map((cell) => (cell === "" ? null : cell))),
  ...extra,
});

const column = table(
  ["Title", "Control", "Low", "High", "Sparse"],
  [
    ["", "12.1", "14.3", "18.2", "9"],
    ["", "11.4", "15.1", "19.9", ""],
    ["", "13.2", "13.8", "17.5", "11"],
    ["", "12.8", "16.2", "21.3", ""],
    ["", "10.9", "14.9", "18.8", "10.5"],
    ["", "12.5", "abc", "20.1", ""],
    ["", "11.8", "15.5", "", "12"],
    ["", "30", "14.1", "19.4", ""],
  ],
  { excluded: ["2,3"] },
);

const xy = table(
  ["Title", "X", "Y1", "Y2", "Y3"],
  [
    ["", "0", "1.1", "2", "5"],
    ["", "1", "2.9", "", "4.1"],
    ["", "2", "5.2", "6.1", "3.2"],
    ["", "3", "6.8", "8.2", ""],
    ["", "4", "9.1", "9.7", "1.9"],
    ["", "5", "11.2", "12.4", "1.1"],
    ["", "6", "12.7", "", "0.4"],
    ["", "", "15", "15", "15"],
    ["", "8", "17.3", "18.1", "-0.8"],
  ],
);

/** log10 concentrations and a noisy sigmoid. */
const doseLog = table(
  ["Title", "X", "Response"],
  [
    ["", "-3", "2.1"],
    ["", "-2.5", "3.4"],
    ["", "-2", "8.2"],
    ["", "-1.5", "19.5"],
    ["", "-1", "41.2"],
    ["", "-0.5", "68.9"],
    ["", "0", "86.1"],
    ["", "0.5", "94.2"],
    ["", "1", "97.8"],
    ["", "1.5", "99.1"],
  ],
);

/** A tumor growing exponentially, a drug cleared from plasma, an enzyme's rate. */
const growth = table(
  ["Title", "Day", "Volume"],
  [
    ["", "0", "105"],
    ["", "3", "142"],
    ["", "7", "198"],
    ["", "10", "251"],
    ["", "14", "378"],
    ["", "17", "455"],
    ["", "21", "702"],
  ],
);
const decay = table(
  ["Title", "Hours", "Plasma"],
  [
    ["", "0", "98.2"],
    ["", "0.5", "71.5"],
    ["", "1", "55.1"],
    ["", "2", "33.8"],
    ["", "4", "17.9"],
    ["", "6", "12.6"],
    ["", "8", "10.8"],
    ["", "12", "10.1"],
  ],
);
const enzyme = table(
  ["Title", "Substrate", "Rate"],
  [
    ["", "0.5", "9.8"],
    ["", "1", "17.1"],
    ["", "2", "27.9"],
    ["", "5", "44.2"],
    ["", "10", "55.9"],
    ["", "20", "63.1"],
    ["", "50", "70.4"],
  ],
);

/** The same standards, then unknowns to read off them (a Y, no X): within the standards,
 *  below them, and beyond the curve's top. */
const doseUnknowns = table(doseLog.columns, [
  ...doseLog.rows.map((r) => r.map((c) => c ?? "")),
  ["Sample 1", "", "50"],
  ["Sample 2", "", "10"],
  ["", "", "1.5"],
  ["Sample 4", "", "150"],
]);

/** Two dose-response curves on one X, the second shifted right (a higher EC50). */
const doseTwo = table(
  ["Title", "X", "Control", "Treated"],
  [
    ["", "-3", "2.1", "1.2"],
    ["", "-2.5", "3.4", "2.0"],
    ["", "-2", "8.2", "3.9"],
    ["", "-1.5", "19.5", "9.1"],
    ["", "-1", "41.2", "21.7"],
    ["", "-0.5", "68.9", "43.5"],
    ["", "0", "86.1", "70.2"],
    ["", "0.5", "94.2", "87.4"],
    ["", "1", "97.8", "95.1"],
    ["", "1.5", "99.1", "98.0"],
  ],
);
/** Two inhibitor curves far apart: no 4PL fit shares one midpoint. */
const doseFar = table(
  ["Title", "X", "A", "B"],
  [
    ["", "-9", "98.2", "100.7"],
    ["", "-8.5", "97.2", "97.7"],
    ["", "-8", "95.7", "93.5"],
    ["", "-7.5", "84.7", "96.9"],
    ["", "-7", "64.9", "97.2"],
    ["", "-6.5", "29.8", "92.9"],
    ["", "-6", "12.1", "77.4"],
    ["", "-5.5", "9.7", "54.5"],
    ["", "-5", "4.9", "32.3"],
    ["", "-4.5", "3.6", "22.5"],
    ["", "-4", "6.8", "17.3"],
  ],
);
/** The same doses falling: an inhibitor's curve. */
const doseFall = table(
  ["Title", "X", "Response"],
  doseLog.rows.map(([, x, y]) => ["", x ?? "", String(100 - Number(y))]),
);

/** Raw concentrations, a control at 0 and a saturating response. */
const doseRaw = table(
  ["Title", "X", "Response"],
  [
    ["", "0", "1"],
    ["", "0.1", "9.8"],
    ["", "0.3", "22.5"],
    ["", "1", "47.1"],
    ["", "3", "71.9"],
    ["", "10", "88.2"],
    ["", "30", "95.1"],
    ["", "100", "98.3"],
  ],
);

const survivalTable = table(
  ["Title", "Days", "Treated", "Placebo"],
  [
    ["", "3", "1", ""],
    ["", "5", "", "1"],
    ["", "7", "0", "1"],
    ["", "8", "", "1"],
    ["", "10", "1", ""],
    ["", "12", "", "0"],
    ["", "15", "1", "1"],
    ["", "20", "0", ""],
  ],
);

/** One subject per row: its time, then 1 (event) or 0 (censored) in its group's column. */
const subjects = (groups: [number, number][][]) =>
  groups.flatMap((g, k) =>
    g.map(([time, code]) => ["", String(time), ...groups.map((_, j) => (j === k ? String(code) : ""))]),
  );

// Freireich's leukemia trial (Gehan 1965): 6-MP vs. placebo, the textbook survival data.
const freireich = table(
  ["Title", "Weeks", "6-MP", "Placebo"],
  subjects([
    [
      [6, 1],
      [6, 1],
      [6, 1],
      [6, 0],
      [7, 1],
      [9, 0],
      [10, 1],
      [10, 0],
      [11, 0],
      [13, 1],
      [16, 1],
      [17, 0],
      [19, 0],
      [20, 0],
      [22, 1],
      [23, 1],
      [25, 0],
      [32, 0],
      [32, 0],
      [34, 0],
      [35, 0],
    ],
    [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23].map((t): [number, number] => [t, 1]),
  ]),
);

const survival3 = table(
  ["Title", "Days", "A", "B", "C"],
  subjects([
    [
      [5, 1],
      [8, 1],
      [12, 1],
      [15, 0],
      [20, 1],
      [22, 1],
      [30, 0],
      [31, 1],
    ],
    [
      [3, 1],
      [4, 1],
      [6, 1],
      [7, 1],
      [9, 0],
      [10, 1],
      [14, 1],
      [18, 1],
    ],
    [
      [12, 1],
      [18, 0],
      [24, 1],
      [30, 0],
      [36, 1],
      [40, 0],
      [45, 0],
      [50, 1],
    ],
  ]),
);

const grouped = table(
  ["Title", "A:Y1", "A:Y2", "A:Y3", "B:Y1", "B:Y2", "B:Y3", "C:Y1", "C:Y2", "C:Y3"],
  [
    ["Day 1", "10", "11", "12", "14", "15", "13", "9", "10", "11"],
    ["Day 2", "12", "13", "14", "18", "19", "17", "10", "", "12"],
    ["Day 3", "15", "14", "16", "22", "24", "21", "11", "12", "13"],
    ["Day 4", "18", "19", "17", "27", "26", "28", "12", "14", "13"],
    ["Day 5", "20", "21", "22", "31", "30", "33", "13", "13", "15"],
  ],
  { groups: 3, replicates: 3 },
);

// Six subjects measured three times, their scatter growing: sphericity doesn't hold.
const matched = table(
  ["Title", "Day 0", "Day 7", "Day 14"],
  [
    ["", "10.1", "12.0", "15.2"],
    ["", "9.8", "12.9", "18.1"],
    ["", "11.2", "13.1", "14.0"],
    ["", "10.5", "14.2", "21.3"],
    ["", "9.9", "11.8", "13.1"],
    ["", "10.8", "13.6", "19.4"],
  ],
);

// Edge cases: a stored empty row, one value per cell, a falling dose-response curve, too
// little data, a column of identical values, counts that aren't whole, a group without event.
const groupedBlankRow: TableData = { ...grouped, rows: [...grouped.rows, grouped.columns.map(() => null)] };
const noReplicates = table(
  ["Title", "A:Y1", "B:Y1"],
  [
    ["a", "1", "2"],
    ["b", "2", "5"],
    ["c", "4", "4"],
  ],
  { groups: 2, replicates: 1 },
);
const inhibition = table(
  ["Title", "X", "Y"],
  [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5].map((x, i) => [
    "",
    String(x),
    String([98, 97, 90, 72, 48, 25, 10, 4, 2][i]),
  ]),
);
const sparse = table(
  ["Title", "A", "B", "C"],
  [
    ["", "1", "", "5"],
    ["", "2", "", "5"],
    ["", "0", "", "5"],
    ["", "4", "3", "5"],
  ],
);
const decimalCounts = table(
  ["Title", "Outcome A", "Outcome B"],
  [
    ["Drug", "3.6", "10.4"],
    ["Placebo", "8.5", "2.5"],
  ],
);
const noEvent = table(
  ["Title", "Time", "A", "B"],
  [
    ["", "1", "1", ""],
    ["", "2", "1", ""],
    ["", "3", "0", ""],
    ["", "4", "", "0"],
    ["", "5", "", "0"],
    ["", "6", "", "0"],
  ],
);

const twoGroups = table(
  ["Title", "A:Y1", "A:Y2", "A:Y3", "B:Y1", "B:Y2", "B:Y3"],
  [
    ["Gene 1", "10", "11", "12", "20", "22", "21"],
    ["Gene 2", "5", "6", "5.5", "5.2", "6.1", "5.8"],
    ["Gene 3", "8", "9", "8.5", "4", "4.5", "3.9"],
    ["Gene 4", "30", "28", "31", "33", "", "32"],
    ["Gene 5", "2", "2.2", "1.9", "6", "6.5", "7"],
  ],
  { groups: 2, replicates: 3 },
);

const multiple = table(
  ["Title", "Weight", "Height", "Age", "Dose"],
  [
    ["", "70", "175", "34", "1"],
    ["", "82", "181", "45", "2"],
    ["", "65", "168", "29", "1"],
    ["", "90", "185", "51", "3"],
    ["", "75", "172", "38", "2"],
    ["", "58", "160", "25", "1"],
    ["", "88", "179", "48", "3"],
    ["", "72", "170", "41", "2"],
    ["", "95", "188", "55", "3"],
    ["", "68", "", "33", "1"],
  ],
);

const volcanoTable = table(
  ["Title", "Gene", "Log2 FC", "P"],
  [
    ["", "TP53", "2.5", "0.0001"],
    ["", "MYC", "-1.8", "0.002"],
    ["", "GAPDH", "0.1", "0.8"],
    ["", "EGFR", "1.2", "0.03"],
    ["", "ACTB", "-0.3", "0.5"],
  ],
);

// The same genes on an XY table: X is the fold change, the row titles name the genes.
const volcanoXY = table(
  ["Title", "Log2 FC", "P"],
  volcanoTable.rows.map(([, gene, fc, p]) => [gene, fc, p].map((cell) => cell ?? "")),
);
// The same again, its P values entered as -log10 already.
const volcanoLog = table(
  ["Title", "Log2 FC", "-log10 P"],
  volcanoXY.rows.map(([gene, fc, p]) => [
    gene ?? "",
    fc ?? "",
    p && Number(p) > 0 ? String(-Math.log10(Number(p))) : "",
  ]),
);

const contingency2 = table(
  ["Title", "Outcome A", "Outcome B"],
  [
    ["Drug", "15", "5"],
    ["Placebo", "6", "14"],
  ],
);
const contingency3 = table(
  ["Title", "Outcome A", "Outcome B", "Outcome C"],
  [
    ["North", "20", "15", "10"],
    ["South", "12", "18", "25"],
    ["East", "14", "16", "15"],
  ],
);

/** As the app creates them: many columns, only the first ones filled. */
const wide = (t: TableData, width: number): TableData => ({
  ...t,
  columns: [...t.columns, ...Array.from({ length: width }, (_, i) => `Extra ${i + 1}`)],
});
const contingencyWide = wide(contingency2, 13);
/** An XY table whose X column is still empty. */
const xyNoX = table(
  ["Title", "X", "Y1", "Y2"],
  [
    ["", "", "1", "2"],
    ["", "", "3", "5"],
    ["", "", "4", "4"],
    ["", "", "6", "9"],
  ],
);

// ── What to run ──────────────────────────────────────────────────────────

const ANALYSES: [string, TableData, AnalysisType, AnalysisParams?][] = [
  ["column", column, "descriptive-statistics"],
  [
    "column",
    column,
    "compare-two-groups",
    { paired: false, gaussian: true, equalVariance: false, ratio: false, tails: "two-sided" },
  ],
  [
    "column",
    column,
    "compare-two-groups",
    { paired: false, gaussian: true, equalVariance: true, ratio: false, tails: "less" },
  ],
  [
    "column",
    column,
    "compare-two-groups",
    { paired: true, gaussian: true, equalVariance: false, ratio: false, tails: "two-sided" },
  ],
  [
    "column",
    column,
    "compare-two-groups",
    { paired: true, gaussian: true, equalVariance: false, ratio: true, tails: "two-sided" },
  ],
  [
    "column",
    column,
    "compare-two-groups",
    { paired: false, gaussian: false, equalVariance: false, ratio: false, tails: "two-sided" },
  ],
  [
    "column",
    column,
    "compare-two-groups",
    { paired: true, gaussian: false, equalVariance: false, ratio: false, tails: "greater" },
  ],
  ["column", column, "one-sample-t", { hypotheticalValue: 12, tails: "two-sided", gaussian: true }],
  ["column", column, "one-sample-t", { hypotheticalValue: 12, tails: "two-sided", gaussian: false }],
  ["column", column, "anova", { posthoc: "none" }],
  ["column", column, "anova", { posthoc: "tukey" }],
  ["column", column, "anova", { posthoc: "bonferroni" }],
  ["column", column, "anova", { posthoc: "dunnett", control: "Control" }],
  ["column", column, "anova", { posthoc: "none", equalSd: false }],
  ["column", column, "anova", { posthoc: "games-howell", equalSd: false }],
  ["column", column, "anova", { posthoc: "t3", equalSd: false }],
  ["column", column, "kruskal-wallis", { posthoc: "dunn" }],
  ["column", column, "rm-anova"],
  ["column", column, "rm-anova", { posthoc: "tukey" }],
  ["column", column, "rm-anova", { posthoc: "bonferroni" }],
  ["column", column, "friedman", { posthoc: "dunn" }],
  ["matched", matched, "rm-anova", { posthoc: "none" }],
  ["matched", matched, "rm-anova", { posthoc: "tukey", sphericity: false }],
  ["matched", matched, "rm-anova", { posthoc: "bonferroni", sphericity: false }],
  ["column", column, "shapiro-wilk"],
  ["column", column, "outliers", { q: 1 }],
  ["column", column, "outliers", { q: 5 }],
  ["column", column, "outliers", { q: 1, grubbs: true }],
  ["xy", xy, "correlation", { method: "pearson", mode: "x-vs-every-y" }],
  ["xy", xy, "correlation", { method: "spearman", mode: "x-vs-every-y" }],
  ["xy", xy, "correlation", { method: "pearson", mode: "two-datasets", datasets: ["Y1", "Y3"] }],
  ["xy", xy, "correlation", { method: "pearson", mode: "matrix" }],
  ["xy", xy, "linear-regression", { forceOrigin: false }],
  ["xy", xy, "linear-regression", { y: "Y2", forceOrigin: false }],
  ["xy", xy, "linear-regression", { y: "Y3", forceOrigin: true }],
  ["xy", xy, "area-under-curve", { baseline: 0 }],
  ["xy", xy, "area-under-curve", { baseline: 2 }],
  ["xy", xy, "nonlinear-regression", { model: "line" }],
  ["xy", xy, "nonlinear-regression", { y: "Y3", model: "quadratic" }],
  ["xy", xy, "nonlinear-regression", { y: "Y1", model: "cubic" }],
  ["doseLog", doseLog, "nonlinear-regression", { model: "sigmoidal-4pl-logx" }],
  ["doseRaw", doseRaw, "nonlinear-regression", { model: "sigmoidal-4pl-x" }],
  ["doseRaw", doseRaw, "nonlinear-regression", { model: "hyperbola" }],
  ["doseRaw", doseRaw, "nonlinear-regression", { model: "semilog-line" }],
  ["doseLog", doseLog, "nonlinear-regression", { model: "agonist-3pl-logx" }],
  ["doseFall", doseFall, "nonlinear-regression", { model: "inhibitor-3pl-logx" }],
  ["doseLog", doseLog, "nonlinear-regression", { model: "asymmetric-5pl-logx" }],
  ["doseUnknowns", doseUnknowns, "nonlinear-regression", { model: "sigmoidal-4pl-logx", interpolate: true }],
  [
    "doseFar",
    doseFar,
    "nonlinear-regression",
    { y: "A", model: "sigmoidal-4pl-logx", compareWith: "B", compare: "ec50" },
  ],
  ["growth", growth, "nonlinear-regression", { model: "exponential-growth" }],
  ["decay", decay, "nonlinear-regression", { model: "one-phase-decay" }],
  ["enzyme", enzyme, "nonlinear-regression", { model: "michaelis-menten" }],
  ["xy", xy, "nonlinear-regression", { y: "Y1", model: "line", interpolate: true }],
  ["doseRaw", doseRaw, "nonlinear-regression", { model: "asymmetric-5pl-x" }],
  // prettier-ignore
  ["doseTwo", doseTwo, "nonlinear-regression", { y: "Control", model: "sigmoidal-4pl-logx", compareWith: "Treated", compare: "ec50" }],
  // prettier-ignore
  ["doseTwo", doseTwo, "nonlinear-regression", { y: "Control", model: "sigmoidal-4pl-logx", compareWith: "Treated", compare: "all" }],
  ["grouped", grouped, "two-way-anova", { design: "ordinary", posthoc: "none", posthocTarget: "groups" }],
  ["grouped", grouped, "two-way-anova", { design: "ordinary", posthoc: "tukey", posthocTarget: "groups" }],
  ["grouped", grouped, "two-way-anova", { design: "ordinary", posthoc: "bonferroni", posthocTarget: "rows" }],
  ["grouped", grouped, "two-way-anova", { design: "repeated-measures", posthoc: "tukey", posthocTarget: "groups" }],
  [
    "grouped",
    grouped,
    "two-way-anova",
    { design: "repeated-measures", posthoc: "tukey", posthocTarget: "groups", sphericity: false },
  ],
  [
    "grouped",
    grouped,
    "two-way-anova",
    { design: "repeated-measures", posthoc: "bonferroni", posthocTarget: "rows", sphericity: false },
  ],
  ["grouped", grouped, "two-way-anova", { design: "nonparametric", posthoc: "none", posthocTarget: "groups" }],
  ["twoGroups", twoGroups, "multiple-t-tests", { paired: false, gaussian: true, pooledSd: false, correction: "holm" }],
  ["twoGroups", twoGroups, "multiple-t-tests", { paired: false, gaussian: true, pooledSd: true, correction: "fdr" }],
  ["twoGroups", twoGroups, "multiple-t-tests", { paired: true, gaussian: true, pooledSd: false, correction: "none" }],
  ["twoGroups", twoGroups, "multiple-t-tests", { paired: false, gaussian: false, pooledSd: false, correction: "holm" }],
  ["twoGroups", twoGroups, "multiple-t-tests", { paired: true, gaussian: false, pooledSd: false, correction: "fdr" }],
  ["multiple", multiple, "correlation-matrix", { method: "pearson" }],
  ["multiple", multiple, "correlation-matrix", { method: "spearman" }],
  ["multiple", multiple, "multiple-regression", { dependent: "Weight" }],
  ["multiple", multiple, "multiple-regression", { dependent: "Weight", predictors: ["Height", "Age"] }],
  ["multiple", multiple, "linear-regression", { x: "Height", y: "Weight", forceOrigin: false }],
  ["multiple", multiple, "linear-regression", { x: "Age", y: "Height", forceOrigin: true }],
  ["multiple", multiple, "descriptive-statistics"],
  ["multiple", multiple, "outliers", { q: 1 }],
  ["contingency2", contingency2, "chi-square"],
  ["contingency3", contingency3, "chi-square"],
  ["contingencyWide", contingencyWide, "chi-square"],
  ["freireich", freireich, "survival", { curveTest: "logrank", correction: "holm" }],
  ["freireich", freireich, "survival", { curveTest: "gehan", correction: "holm" }],
  ["survival3", survival3, "survival", { curveTest: "logrank", correction: "holm" }],
  ["survival3", survival3, "survival", { curveTest: "trend", correction: "none" }],
  ["survival3", survival3, "survival", { curveTest: "gehan", correction: "fdr" }],
  ["freireich", freireich, "cox", { reference: "6-MP" }],
  ["survival3", survival3, "cox"],
  ["survival3", survival3, "cox", { reference: "C" }],
  // prettier-ignore
  ["groupedBlankRow", groupedBlankRow, "two-way-anova", { design: "repeated-measures", posthoc: "none", posthocTarget: "groups" }],
  ["noReplicates", noReplicates, "two-way-anova", { design: "ordinary", posthoc: "tukey", posthocTarget: "groups" }],
  // prettier-ignore
  ["noReplicates", noReplicates, "two-way-anova", { design: "repeated-measures", posthoc: "none", posthocTarget: "groups" }],
  ["inhibition", inhibition, "nonlinear-regression", { model: "sigmoidal-4pl-logx" }],
  ["sparse", sparse, "shapiro-wilk"],
  ["sparse", sparse, "friedman", { posthoc: "none" }],
  ["sparse", sparse, "rm-anova", { posthoc: "none" }],
  // prettier-ignore
  ["sparse", sparse, "compare-two-groups", { paired: true, gaussian: true, equalVariance: true, ratio: false, tails: "two-sided" }],
  // prettier-ignore
  ["sparse", sparse, "compare-two-groups", { paired: true, gaussian: true, equalVariance: true, ratio: true, tails: "two-sided", sets: ["A", "C"] }],
  // prettier-ignore
  ["sparse", sparse, "compare-two-groups", { paired: false, gaussian: true, equalVariance: true, ratio: false, tails: "two-sided", sets: ["B", "C"] }],
  // prettier-ignore
  ["column", column, "compare-two-groups", { paired: false, gaussian: true, equalVariance: true, ratio: false, lognormal: true, tails: "two-sided", sets: ["Low", "High"] }],
  // prettier-ignore
  ["column", column, "compare-two-groups", { paired: false, gaussian: true, equalVariance: false, ratio: false, lognormal: true, tails: "greater", sets: ["High", "Control"] }],
  ["decimalCounts", decimalCounts, "chi-square"],
  ["noEvent", noEvent, "cox"],
  ["survival3", survival3, "cox", { reference: "Gone" }],
  ["xyNoX", xyNoX, "linear-regression", { forceOrigin: false }],
  ["xyNoX", xyNoX, "correlation", { method: "pearson", mode: "x-vs-every-y" }],
  // On the data sets chosen, in their order.
  ["column", column, "descriptive-statistics", { sets: ["Sparse", "Low"] }],
  [
    "column",
    column,
    "compare-two-groups",
    {
      paired: false,
      gaussian: true,
      equalVariance: false,
      ratio: false,
      tails: "two-sided",
      sets: ["High", "Control"],
    },
  ],
  [
    "column",
    column,
    "compare-two-groups",
    {
      paired: true,
      gaussian: true,
      equalVariance: false,
      ratio: false,
      tails: "two-sided",
      sets: ["Control", "Sparse"],
    },
  ],
  ["column", column, "anova", { posthoc: "tukey", sets: ["Control", "Low", "High"] }],
  [
    "grouped",
    grouped,
    "two-way-anova",
    { design: "ordinary", posthoc: "tukey", posthocTarget: "groups", sets: ["A", "C"] },
  ],
  [
    "grouped",
    grouped,
    "multiple-t-tests",
    { paired: false, gaussian: true, pooledSd: false, correction: "holm", sets: ["C", "A"] },
  ],
  ["multiple", multiple, "correlation-matrix", { method: "pearson", sets: ["Age", "Weight"] }],
];

const volcano: Partial<GraphOptions> = { volcanoX: "Log2 FC", volcanoY: "P", volcanoLabel: "Gene" };
const GRAPH_CASES: [string, TableData, GraphType, Partial<GraphOptions>?][] = [
  ["column", column, "individual"],
  ["column", column, "box-violin", { kind: "violin", showPoints: true }],
  ["column", column, "mean-error", { error: "sd" }],
  ["column", column, "pie"],
  ["column", column, "donut", { pieValue: "mean" }],
  ["xy", xy, "xy-scatter", { xyStyle: "points+line" }],
  ["xy", xy, "xy-bar"],
  ["xy", xy, "xy-area"],
  ["survival", survivalTable, "survival"],
  ["freireich", freireich, "survival", { survivalShowBand: true }],
  ["grouped", grouped, "grouped-scatter"],
  ["grouped", grouped, "grouped-bars", { groupLayout: "separated" }],
  ["grouped", grouped, "grouped-lines"],
  ["grouped", grouped, "grouped-stacked"],
  ["grouped", grouped, "grouped-hbars", { center: "median" }],
  ["grouped", grouped, "heatmap", { center: "median", heatmapShowValues: true }],
  ["grouped", grouped, "grouped-box", { showPoints: true }],
  ["groupedViolin", grouped, "grouped-box", { kind: "violin", groupLayout: "separated" }],
  ["multiple", multiple, "heatmap"],
  ["multiple", multiple, "xy-scatter", { xVariable: "Height", yVariable: "Weight" }],
  ["volcano", volcanoTable, "volcano", volcano],
  ["volcanoXY", volcanoXY, "volcano", { volcanoY: "P" }],
  ["volcanoLog", volcanoLog, "volcano", { volcanoY: "-log10 P", volcanoYIsPValue: false }],
  ["contingency2", contingency2, "grouped-stacked"],
  ["contingency3", contingency3, "heatmap", { heatmapShowValues: true }],
  ["xyNoX", xyNoX, "xy-scatter"],
];

// ── Run and compare ──────────────────────────────────────────────────────

/** Rounds every number to 10 significant digits, so the reference ignores float noise. */
const rounded = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "number" ? Number(v.toPrecision(10)) : v)));

async function run() {
  await startR(
    fileURLToPath(new URL("../node_modules/webr/dist/", import.meta.url)),
    fileURLToPath(new URL("../r-packages/", import.meta.url)),
  );
  const out: Record<string, unknown> = {};
  for (const [name, data, type, params] of ANALYSES) {
    out[`${type} ${name} ${JSON.stringify(params ?? {})}`] = await runAnalysis(type, data, params);
  }
  for (const [name, data, type, options] of GRAPH_CASES) {
    const opts = {
      ...newGraphOptions(type),
      series: { Low: { color: "#D55E00" } },
      points: { "Control#1": { color: "#4ADE80" } },
      ...options,
    };
    // Of the tables here, only a Multiple Variables one changes what a graph plots.
    const columns = plotColumns(readTable(data), type, opts, data === multiple ? "multiple" : "xy");
    const paint = paintOf(opts, GRAPHS[type].family === "volcano" ? 2 : columns.length);
    out[`graph ${type} ${name}`] = GRAPHS[type].build(columns, opts, paint, readTable(data).titles);
  }
  for (const [name, data] of Object.entries({ column, xy, grouped, twoGroups, multiple })) {
    out[`counts ${name}`] = { columns: countDataColumns(data), groups: countDataGroups(data) };
  }
  return rounded(out) as Record<string, unknown>;
}

/** Where TypeScript computes what R also computes, both must agree: a graph's
 *  regression line, the volcano's per-row P values, Tukey after a repeated-measures
 *  ANOVA, the regression band's t; and the survival analysis gives Freireich's
 *  published results. */
async function disagreements(): Promise<string[]> {
  const { x, ys } = splitXY(readTable(xy).columns);
  const out: string[] = [];
  for (const y of ys) {
    for (const forceOrigin of [false, true]) {
      const r = await runAnalysis("linear-regression", xy, { y: y.name, forceOrigin });
      const pairs = pairUp(x!, y);
      const js = fitLinear(pairs.x, pairs.y, forceOrigin);
      const stat = (label: string) => ("error" in r ? null : r.stats.find((s) => s.label === label)?.value);
      const [rSlope, rR] = [stat("Slope"), stat("Pearson r")];
      if (rSlope == null || js == null || Math.abs(rSlope - js.slope) > 1e-9)
        out.push(
          `Regression of ${y.name}${forceOrigin ? " through the origin" : ""}: graph slope ${js?.slope}, R slope ${rSlope}`,
        );
      if (!forceOrigin && (rR == null || js == null || Math.abs(rR - js.r) > 1e-9))
        out.push(`Regression of ${y.name}: graph r ${js?.r}, R's ${rR}`);
    }
  }
  // Grubbs' P is 0.05 at his published critical values of G (two-sided, alpha = 0.05).
  const grubbs = await evalNamedVector(
    `${R_GRUBBS}\nc(n5=grubbsP(1.715,5),n10=grubbsP(2.290,10),n20=grubbsP(2.709,20))`,
  );
  for (const [n, p] of Object.entries(grubbs))
    if (p == null || Math.abs(p - 0.05) > 0.001) out.push(`Grubbs' P at the critical G for ${n}: ${p}, not 0.05`);
  // A regression of two variables takes those two, not the table's first column.
  const variables = readTable(multiple).columns;
  const named = (name: string) => variables.find((c) => c.name === name)!;
  const pairs = pairUp(named("Height"), named("Weight"));
  const twoVariables = await runAnalysis("linear-regression", multiple, {
    x: "Height",
    y: "Weight",
    forceOrigin: false,
  });
  const slope = "error" in twoVariables ? null : twoVariables.stats.find((s) => s.label === "Slope")?.value;
  if (slope == null || Math.abs(slope - fitLinear(pairs.x, pairs.y, false)!.slope) > 1e-9)
    out.push(`Regression of Weight on Height: R slope ${slope}`);
  const tests = await runAnalysis("multiple-t-tests", twoGroups, {
    paired: false,
    gaussian: true,
    pooledSd: false,
    correction: "none",
  });
  const volcano = computeGroupedDEG(twoGroups, "A", "B", "difference");
  for (const row of volcano) {
    const p = "error" in tests ? null : tests.comparisons?.find((c) => c.group1 === row.label)?.p;
    if (p == null || Math.abs(p - row.p) > 1e-9)
      out.push(`Volcano P for ${row.label}: ${row.p}, multiple t tests: ${p}`);
  }
  // Tukey after a repeated-measures ANOVA equals R's TukeyHSD on the same model.
  const rm = await runAnalysis("rm-anova", column, { posthoc: "tukey" });
  const hsd = await evalNamedVector(
    "g0<-c(12.1,10.9);g1<-c(14.3,14.9);g2<-c(18.2,18.8);g3<-c(9,10.5);v<-c(g0,g1,g2,g3);gr<-factor(rep(1:4,each=2));" +
      'subj<-factor(rep(1:2,4));tk<-TukeyHSD(aov(v~gr+subj),"gr")$gr;c(a=tk["2-1",4],b=tk["3-1",4],c=tk["3-2",4])',
  );
  const rmP = "error" in rm ? [] : (rm.comparisons ?? []).map((c) => c.p);
  [hsd.a, hsd.b, hsd.c].forEach((p, i) => {
    const ours = rmP[[0, 1, 3][i]];
    if (p == null || ours == null || Math.abs(p - ours) > 1e-9) out.push(`RM ANOVA Tukey P: ${ours}, TukeyHSD: ${p}`);
  });
  // The Geisser-Greenhouse P equals R's own, from a multivariate model (anova.mlm).
  const gg = await runAnalysis("rm-anova", matched, { posthoc: "none", sphericity: false });
  const mlm = await evalNamedVector(
    `M<-cbind(${["Day 0", "Day 7", "Day 14"].map((d) => rVec(readTable(matched).columns.find((c) => c.name === d)!.values)).join(",")});` +
      'f<-lm(M~1);s<-anova(f,X=~1,test="Spherical");c(p=s$"G-G Pr"[1])',
  );
  const ours = "error" in gg ? {} : Object.fromEntries(gg.stats.map((s) => [s.label, s.value]));
  if (mlm.p == null || Math.abs(mlm.p - (ours["P value"] ?? NaN)) > 1e-9)
    out.push(`Geisser-Greenhouse P: ${ours["P value"]}, R's: ${mlm.p}`);
  // Two-way, rows repeated: the corrected row and interaction P equal anova.mlm's, on the
  // subjects holding every row (C:Y2 lacks one); rows within a group, a paired t test.
  const gg2 = await runAnalysis("two-way-anova", grouped, {
    design: "repeated-measures",
    posthoc: "bonferroni",
    posthocTarget: "rows",
    sphericity: false,
  });
  const subjects = readTable(grouped).columns.filter((c) => c.name !== "C:Y2");
  const mlm2 = await evalNamedVector(
    `Y<-rbind(${subjects.map((c) => rVec(c.values)).join(",")});gs<-factor(c(${subjects.map((c) => `"${c.name[0]}"`).join(",")}));` +
      's<-anova(lm(Y~gs),X=~1,test="Spherical");' +
      'c(row=s$"G-G Pr"[1],inter=s$"G-G Pr"[2],pair=min(1,10*t.test(Y[1:3,1],Y[1:3,3],paired=TRUE)$p.value))',
  );
  const two = "error" in gg2 ? {} : Object.fromEntries(gg2.stats.map((s) => [s.label, s.value]));
  for (const [ours, theirs, what] of [
    [two["Row P value"], mlm2.row, "row"],
    [two["Interaction P value"], mlm2.inter, "interaction"],
    ["error" in gg2 ? null : gg2.comparisons?.[1].p, mlm2.pair, "Day 1 vs. Day 3 (A)"],
  ] as const)
    if (ours == null || theirs == null || Math.abs(ours - theirs) > 1e-9)
      out.push(`Two-way Geisser-Greenhouse, ${what}: ${ours}, R's: ${theirs}`);
  // Sphericity assumed, the comparisons are of the subjects the ANOVA kept: C at Day 4 is
  // (12 + 13) / 2 without C:Y2, which lacks Day 2, so A − C is 18 − 12.5.
  const kept = await runAnalysis("two-way-anova", grouped, {
    design: "repeated-measures",
    posthoc: "tukey",
    posthocTarget: "groups",
  });
  const a4 =
    "error" in kept ? undefined : kept.comparisons?.find((c) => c.group1 === "A (Day 4)" && c.group2 === "C (Day 4)");
  if (a4?.diff !== 5.5) out.push(`Two-way RM comparisons: A − C at Day 4 is ${a4?.diff}, not 5.5`);
  // Graphs draw each model's curve as R fits it: its squared distances to the points add up to
  // R's sum of squares.
  const curveData: Partial<Record<NonlinearModel, TableData>> = {
    "inhibitor-3pl-logx": doseFall,
    "semilog-line": doseRaw,
    hyperbola: doseRaw,
    line: xy,
    quadratic: xy,
    cubic: xy,
    "exponential-growth": growth,
    "one-phase-decay": decay,
    "michaelis-menten": enzyme,
  };
  for (const [model, data] of NONLINEAR_MODELS.map(
    (m) => [m, curveData[m] ?? (m.endsWith("-x") ? doseRaw : doseLog)] as const,
  )) {
    const r = await runAnalysis("nonlinear-regression", data, { model });
    if ("error" in r) {
      out.push(`${model}: ${r.error}`);
      continue;
    }
    const { x: dose, ys } = splitXY(readTable(data).columns);
    const pairs = pairUp(dose!, ys[0]);
    const ss = pairs.x.reduce(
      (sum, x, i) =>
        positiveXOnly(model) && x <= 0 ? sum : sum + (pairs.y[i] - doseCurveAt(model, r.coefficients!, x)) ** 2,
      0,
    );
    const rss = r.fit?.rows.find((row) => row.label === "Sum of squares")?.values?.[0];
    if (rss == null || Math.abs(ss - rss) > 1e-6 * Math.max(1, rss))
      out.push(`${model}: the graph's curve misses R's fit (${ss} vs. ${rss})`);
  }
  // An interpolated X, put back in the curve, gives its unknown's Y.
  const interpolated = await runAnalysis("nonlinear-regression", doseUnknowns, {
    model: "sigmoidal-4pl-logx",
    interpolate: true,
  });
  if ("error" in interpolated) out.push(`Interpolation: ${interpolated.error}`);
  else
    for (const u of interpolated.interpolated ?? [])
      if (u.x != null) {
        const y = doseCurveAt("sigmoidal-4pl-logx", interpolated.coefficients!, u.x);
        if (Math.abs(y - u.y) > 1e-6 || Math.abs(10 ** u.x - u.concentration!) > 1e-9 * 10 ** u.x)
          out.push(`Interpolation: ${u.label}'s X gives ${y}, not ${u.y}`);
      }
  // Comparing two curves: F from the two fits on their own and one fit on all their points.
  const both = await runAnalysis("nonlinear-regression", doseTwo, {
    y: "Control",
    model: "sigmoidal-4pl-logx",
    compareWith: "Treated",
    compare: "all",
  });
  const pooled = await runAnalysis(
    "nonlinear-regression",
    table(
      ["Title", "X", "Y"],
      doseTwo.rows.flatMap(([, x, a, b]) => [
        ["", x ?? "", a ?? ""],
        ["", x ?? "", b ?? ""],
      ]),
    ),
    { model: "sigmoidal-4pl-logx" },
  );
  if (!("error" in both) && !("error" in pooled)) {
    const row = (r: typeof both, label: string) =>
      ("error" in r ? [] : (r.fit?.rows.find((row) => row.label === label)?.values ?? [])).map((v) => v!);
    const [ssf, dff] = ["Sum of squares", "Degrees of freedom"].map((l) => row(both, l)[0] + row(both, l)[1]);
    const [ssr, dfr] = ["Sum of squares", "Degrees of freedom"].map((l) => row(pooled, l)[0]);
    const f = (ssr - ssf) / (dfr - dff) / (ssf / dff);
    const ours = both.stats.find((s) => s.label === "F")?.value;
    if (ours == null || Math.abs(f - ours) > 1e-6 * f) out.push(`Comparing curves: F ${ours}, by hand ${f}`);
  } else out.push("Comparing curves: a fit failed");
  // Dunnett's critical values (two-sided, 5%, equal groups) as his tables give them: 2 groups
  // against a control at 10 and 20 df, and 2 to 4 groups at infinite df; and T3's largest of
  // one t, which is that t.
  const dunnett = await evalNamedVector(
    `${R_MAXIMUM_T}\ncv<-function(k,df)uniroot(function(c)dun(c,rep(sqrt(0.5),k),df)-0.05,c(1.5,5),tol=1e-9)$root\n` +
      "c(a=cv(2,10),b=cv(2,20),c=cv(2,1e6),d=cv(3,1e6),f=cv(4,1e6),e=smm(2.1,1,12)-2*pt(-2.1,12))",
  );
  for (const [key, table] of [
    ["a", 2.57],
    ["b", 2.38],
    ["c", 2.21],
    ["d", 2.35],
    ["f", 2.44],
  ] as const) {
    const ours = dunnett[key];
    if (ours == null || Math.abs(ours - table) > 0.006) out.push(`Dunnett's critical value: ${ours}, table ${table}`);
  }
  if (dunnett.e == null || Math.abs(dunnett.e) > 1e-8) out.push(`T3 of one t: off by ${dunnett.e}`);
  // Freireich's data as the textbooks give it (SAS PROC LIFETEST, R survdiff and survfit with
  // log-log intervals): log-rank 16.79, Gehan-Wilcoxon 13.46; medians 23 (13 to —) and 8 (4 to 11).
  for (const [curveTest, chi] of [
    ["logrank", 16.7929],
    ["gehan", 13.4579],
  ] as const) {
    const r = await runAnalysis("survival", freireich, { curveTest, correction: "holm" });
    const ours = "error" in r ? null : r.stats[0].value;
    if (ours == null || Math.abs(ours - chi) > 1e-4)
      out.push(`Freireich ${curveTest} chi-square: ${ours}, published ${chi}`);
    const medians = "error" in r ? [] : r.survivalGroups?.map((g) => [g.median, g.low, g.high].join(" "));
    if (medians?.join(", ") !== "23 13 , 8 4 11") out.push(`Freireich medians: ${medians?.join(", ")}`);
  }
  // Its Cox regression, as published (Efron's ties): placebo's hazard 4.82 times 6-MP's, LR test 16.35.
  const cox = await runAnalysis("cox", freireich, { reference: "6-MP" });
  const hr = "error" in cox ? null : cox.hazardRatios?.[0]?.ratio;
  const lr = "error" in cox ? null : cox.stats[0].value;
  if (hr == null || Math.abs(hr - 4.817) > 0.001 || lr == null || Math.abs(lr - 16.35) > 0.01)
    out.push(`Freireich Cox: hazard ratio ${hr}, likelihood ratio ${lr}; published 4.817 and 16.35`);
  // The Survival curve's own Kaplan-Meier (TS) draws R's: the same steps and 95% band.
  for (const data of [freireich, survival3]) {
    const { x, ys } = splitXY(readTable(data).columns);
    for (const y of ys) {
      const { x: t, y: s } = pairUp(x!, y);
      const km = kaplanMeier(t, s);
      const r = await evalNamedVector(
        `library(survival);f<-survfit(Surv(${rVec(t)},${rVec(s)})~1,conf.type="log-log");e<-f$n.event>0;` +
          `c(setNames(f$surv[e],paste0("s",1:sum(e))),setNames(f$lower[e],paste0("l",1:sum(e))),setNames(f$upper[e],paste0("u",1:sum(e))))`,
      );
      // The curve's steps after (0, 1), one per event time; its last point only carries the curve on.
      km.t.slice(1, km.t.length).forEach((_, k) => {
        if (r[`s${k + 1}`] === undefined) return;
        const pairs: [number | null, number | null | undefined][] = [
          [km.s[k + 1], r[`s${k + 1}`]],
          [km.lower[k + 1], r[`l${k + 1}`]],
          [km.upper[k + 1], r[`u${k + 1}`]],
        ];
        for (const [ours, theirs] of pairs) {
          if ((ours ?? null) === (theirs ?? null)) continue;
          if (ours == null || theirs == null || Math.abs(ours - theirs) > 1e-9)
            out.push(`Kaplan-Meier of ${y.name}, step ${k + 1}: ${ours}, survfit: ${theirs}`);
        }
      });
    }
  }
  const q = await evalNamedVector("c(a=qt(0.975,3),b=qt(0.975,10),c=qt(0.975,50))");
  for (const [key, df] of [
    ["a", 3],
    ["b", 10],
    ["c", 50],
  ] as const) {
    if (Math.abs(tCrit95(df) - q[key]!) > 1e-9) out.push(`t critical value, df ${df}: ${tCrit95(df)}, R: ${q[key]}`);
  }
  return out;
}

/** Every analysis and graph of the sample project must work. */
async function sampleFailures(): Promise<string[]> {
  const out: string[] = [];
  const { nodes } = sampleProject;
  for (const node of Object.values(nodes)) {
    const data = node.parentId ? nodes[node.parentId].data! : undefined;
    if (node.type === "analysis") {
      const outcome = await runAnalysis(node.analysisType!, data!, node.analysisParams);
      if ("error" in outcome) out.push(`Sample analysis “${node.name}”: ${outcome.error}`);
    } else if (node.type === "graph") {
      const type = node.graphType!;
      const tableType = nodes[node.parentId!].tableType!;
      const paint = paintOf(node.graphOptions!, graphSeries(type, data!, tableType, node.graphOptions!).length);
      const fig = GRAPHS[type].build(
        plotColumns(readTable(data!), type, node.graphOptions!, tableType),
        node.graphOptions!,
        paint,
        readTable(data!).titles,
      );
      if (!fig.data.length) out.push(`Sample graph “${node.name}” draws nothing.`);
    }
  }
  return out;
}

const file = new URL("reference.json", import.meta.url);
const actual = await run();
const disagree = await disagreements();
const broken = await sampleFailures();
for (const d of disagree) console.log(`✗ Engines disagree. ${d}`);
for (const b of broken) console.log(`✗ Sample project. ${b}`);
if (process.argv.includes("--update")) {
  writeFileSync(file, JSON.stringify(actual, null, 1) + "\n");
  console.log(`Reference updated: ${Object.keys(actual).length} results.`);
} else {
  const expected = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const changed = [...keys].filter((k) => JSON.stringify(expected[k]) !== JSON.stringify(actual[k]));
  for (const k of changed)
    console.log(`✗ ${k}\n  was: ${JSON.stringify(expected[k])}\n  now: ${JSON.stringify(actual[k])}`);
  console.log(
    changed.length ? `${changed.length} of ${keys.size} results changed.` : `All ${keys.size} results match.`,
  );
  process.exitCode = changed.length || disagree.length || broken.length ? 1 : 0;
}
process.exit();
