// Reference test: runs every analysis (R) and draws every graph (Plotly figures) on
// fixed tables, then compares the results with `reference.json`. A change in any
// number shows up as a diff. `npm test` checks; `npm test -- --update` rewrites the
// reference after an intended change. It also checks that TypeScript and R agree
// where both compute the same thing, and that the sample project's items all work.
/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { pairKey } from "../src/lib/columns";
import { fileURLToPath } from "node:url";
import { runAnalysis } from "../src/stats";
import type { AnalysisOutcome, AnalysisParams, AnalysisType } from "../src/stats/types";
import type { GraphOptions, GraphType, TableData } from "../src/store/types";
import { GRAPHS, graphSeries, newGraphOptions, plotColumns, type GraphFigure } from "../src/views/graphs";
import { errorOf, paintOf } from "../src/views/graphs/plot-helpers";
import { pairUp, readTable, splitXY, xyPoints } from "../src/lib/dataset";
import { countDataColumns, countDataGroups } from "../src/views/analyses";
import { bandAt, fitLinear } from "../src/views/graphs/regression-overlay";
import { computeGroupedDEG } from "../src/lib/deg";
import { tCrit95 } from "../src/lib/student-t";
import { atRisk, kaplanMeier } from "../src/lib/kaplan-meier";
import { binCounts, binEdges } from "../src/lib/histogram";
import { rVec } from "../src/stats/column/base";
import { qnorm } from "../src/lib/normal";
import { qqPoints } from "../src/views/graphs/qq-plot";
import { residualsOf } from "../src/views/graphs/residuals";
import { transformTable } from "../src/lib/transform";
import { parseCell } from "../src/lib/numeric";
import { hasXColumn, type TableType, type Transform } from "../src/store/types";
import { R_MAXIMUM_T } from "../src/stats/column/anova";
import { R_TWO_WAY } from "../src/stats/grouped/two-way-anova";
import { R_GRUBBS } from "../src/stats/column/rout";
import { addFittedCurves, evaluate as doseCurveAt, logisticAt } from "../src/views/graphs/fitted-curve";
import { DOSE_MODELS, NONLINEAR_MODELS, type NonlinearModel } from "../src/stats/types";
import { positiveXOnly, R_ROUT_CURVE, rFit } from "../src/stats/xy/nonlinear-regression";
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
// Growth and two-phase decay, from known curves with a fixed noise.
const logisticGrowth = table(
  ["Title", "Day", "Cells"],
  [
    ["", "0", "51"],
    ["", "2", "92.96"],
    ["", "4", "178.5"],
    ["", "6", "297.6"],
    ["", "8", "475.6"],
    ["", "10", "622.7"],
    ["", "12", "786"],
    ["", "14", "854.2"],
    ["", "16", "962.4"],
    ["", "18", "951.8"],
    ["", "20", "987.9"],
    ["", "22", "986.5"],
    ["", "24", "1016"],
  ],
);
const gompertz = table(
  ["Title", "Day", "Volume"],
  [
    ["", "0", "51"],
    ["", "2", "130.2"],
    ["", "4", "264.2"],
    ["", "6", "401.6"],
    ["", "8", "559.8"],
    ["", "10", "653.4"],
    ["", "12", "769.7"],
    ["", "14", "812.6"],
    ["", "16", "911.6"],
    ["", "18", "907.6"],
    ["", "20", "951.3"],
    ["", "22", "959.1"],
    ["", "24", "995.2"],
  ],
);
const twoPhase = table(
  ["Title", "Hour", "Level"],
  [
    ["", "0", "100.1"],
    ["", "0.5", "71.95"],
    ["", "1", "55.93"],
    ["", "2", "40.02"],
    ["", "3", "33.17"],
    ["", "4", "28.9"],
    ["", "6", "23.58"],
    ["", "8", "19.45"],
    ["", "10", "16.57"],
    ["", "12", "13.94"],
    ["", "16", "10.59"],
    ["", "20", "8.427"],
    ["", "24", "7.213"],
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

/** An XY table of replicates: two data sets of three, a value missing here and there, a row
 *  without X (an unknown). */
const xyReps = table(
  ["Title", "X", "A:Y1", "A:Y2", "A:Y3", "B:Y1", "B:Y2", "B:Y3"],
  [
    ["", "0", "1.1", "1.4", "0.8", "5", "5.6", "4.4"],
    ["", "1", "2.9", "3.3", "", "4.1", "3.9", "4.6"],
    ["", "2", "5.2", "4.8", "5.5", "3.2", "", "2.7"],
    ["", "3", "6.8", "7.4", "6.1", "", "", ""],
    ["", "4", "9.1", "8.6", "9.9", "1.9", "2.4", "1.5"],
    ["", "", "6", "6.4", "5.8", "", "", ""],
  ],
  { groups: 2, replicates: 3 },
);

/** A dose-response curve measured in triplicate, with two unknowns (rows without X). */
const doseReps = table(
  ["Title", "X", "R:Y1", "R:Y2", "R:Y3"],
  [
    ...doseLog.rows.map((r, i) => {
      const y = Number(r[2]);
      return [
        "",
        r[1] ?? "",
        String(+(y * 1.04).toFixed(2)),
        String(+(y * 0.97).toFixed(2)),
        i % 4 ? String(+(y + 0.6).toFixed(2)) : "",
      ];
    }),
    ["Sample 1", "", "48", "52", "51"],
    ["Sample 2", "", "11", "9.5", ""],
  ],
  { groups: 1, replicates: 3 },
);

/** A one-phase decay, as Motulsky & Brown's example (13 points, 3 parameters), with a point
 *  far off the curve at X = 3 (B), and the same without it (A). */
const decayY = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
  (x, i) => 1800 * Math.exp(-0.5 * x) + 200 + [31, -22, 15, -40, 27, -8, 36, -30, 12, -19, 24, -11, 5][i],
);
const decayOutlier = table(
  ["Title", "X", "A", "B"],
  decayY.map((y, i) => ["", String(i), y.toFixed(1), (i === 3 ? y + 900 : y).toFixed(1)]),
);

/** The 23 space shuttle flights before Challenger: launch temperature (°F) and whether an
 *  O-ring was damaged (Dalal, Fowlkes & Hoadley, JASA 1989), with a column that isn't 0/1
 *  and one an X splits exactly. */
// prettier-ignore
const shuttle = table(
  ["Title", "Temperature", "Damage", "Codes", "Split"],
  [[53, 1], [57, 1], [58, 1], [63, 1], [66, 0], [67, 0], [67, 0], [67, 0], [68, 0], [69, 0], [70, 0], [70, 1],
    [70, 0], [70, 1], [72, 0], [73, 0], [75, 0], [75, 1], [76, 0], [76, 0], [78, 0], [79, 0], [81, 0]].map(
    ([t, d], i) => ["", String(t), String(d), i === 5 ? "2" : String(d), String(t < 69 ? 1 : 0)],
  ),
);

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

// The same subjects, some values missing (a mixed-effects model keeps them).
const matchedGaps = table(
  ["Title", "Day 0", "Day 7", "Day 14"],
  [
    ["", "10.1", "12.0", "15.2"],
    ["", "9.8", "", "18.1"],
    ["", "11.2", "13.1", "14.0"],
    ["", "10.5", "14.2", ""],
    ["", "9.9", "11.8", "13.1"],
    ["", "", "13.6", "19.4"],
    ["", "10.4", "12.7", "16.0"],
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
// Agresti, alcohol in pregnancy and malformations: rows in order of drinks a day.
const malformation = table(
  ["Title", "Present", "Absent"],
  [
    ["0", "48", "17066"],
    ["< 1", "38", "14464"],
    ["1-2", "5", "788"],
    ["3-5", "1", "126"],
    ["≥ 6", "1", "37"],
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
  ["column", column, "one-sample-t", { hypotheticalValue: 12, tails: "greater", gaussian: true, lognormal: true }],
  ["column", column, "anova", { posthoc: "none" }],
  ["column", column, "anova", { posthoc: "tukey" }],
  ["column", column, "anova", { posthoc: "bonferroni" }],
  ["column", column, "anova", { posthoc: "sidak" }],
  ["column", column, "anova", { posthoc: "holm-sidak" }],
  ["column", column, "anova", { posthoc: "fisher" }],
  ["column", column, "anova", { posthoc: "tukey", lognormal: true }],
  ["column", column, "anova", { posthoc: "dunnett", control: "Control", lognormal: true }],
  ["column", column, "anova", { posthoc: "games-howell", equalSd: false, lognormal: true }],
  ["column", column, "anova", { posthoc: "sidak", compared: [pairKey("Control", "High"), pairKey("Low", "Control")] }],
  ["column", column, "anova", { posthoc: "dunnett", control: "Control" }],
  ["column", column, "anova", { posthoc: "none", equalSd: false }],
  ["column", column, "anova", { posthoc: "games-howell", equalSd: false }],
  ["column", column, "anova", { posthoc: "t3", equalSd: false }],
  ["column", column, "kruskal-wallis", { posthoc: "dunn" }],
  ["column", column, "rm-anova"],
  ["column", column, "rm-anova", { posthoc: "tukey" }],
  ["column", column, "rm-anova", { posthoc: "bonferroni" }],
  ["matched", matched, "rm-anova", { posthoc: "holm-sidak", sphericity: false }],
  ["matchedGaps", matchedGaps, "rm-anova", { posthoc: "none", mixed: true }],
  ["matchedGaps", matchedGaps, "rm-anova", { posthoc: "tukey", mixed: true }],
  ["matchedGaps", matchedGaps, "rm-anova", { posthoc: "holm-sidak", mixed: true }],
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
  ["xyReps", xyReps, "linear-regression", { y: "A", forceOrigin: false }],
  ["xy", xy, "linear-regression", { ys: ["Y1", "Y2", "Y3"], forceOrigin: false }],
  ["xyReps", xyReps, "linear-regression", { ys: ["A", "B"], forceOrigin: true }],
  ["doseTwo", doseTwo, "nonlinear-regression", { ys: ["Control", "Treated"], model: "sigmoidal-4pl-logx" }],
  ["shuttle", shuttle, "logistic-regression"],
  ["shuttle", shuttle, "logistic-regression", { y: "Codes" }],
  ["shuttle", shuttle, "logistic-regression", { y: "Split" }],
  ["decayOutlier", decayOutlier, "nonlinear-regression", { y: "B", model: "one-phase-decay", rout: true }],
  ["decayOutlier", decayOutlier, "nonlinear-regression", { ys: ["A", "B"], model: "one-phase-decay", rout: true }],
  ["xyReps", xyReps, "linear-regression", { y: "B", forceOrigin: true }],
  ["xyReps", xyReps, "area-under-curve", { baseline: 0 }],
  ["xyReps", xyReps, "correlation", { method: "pearson", mode: "x-vs-every-y" }],
  ["xyReps", xyReps, "correlation", { method: "pearson", mode: "matrix" }],
  ["doseReps", doseReps, "nonlinear-regression", { model: "sigmoidal-4pl-logx", interpolate: true }],
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
  ["logisticGrowth", logisticGrowth, "nonlinear-regression", { model: "logistic-growth" }],
  ["gompertz", gompertz, "nonlinear-regression", { model: "gompertz-growth" }],
  ["twoPhase", twoPhase, "nonlinear-regression", { model: "two-phase-decay" }],
  ["doseLog", doseLog, "nonlinear-regression", { model: "sigmoidal-4pl-logx", ecx: 80 }],
  ["doseRaw", doseRaw, "nonlinear-regression", { model: "asymmetric-5pl-x", ecx: 20 }],
  ["doseFall", doseFall, "nonlinear-regression", { model: "inhibitor-3pl-logx", ecx: 90 }],
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
  ["grouped", grouped, "two-way-anova", { design: "ordinary", posthoc: "sidak", posthocTarget: "groups" }],
  [
    "grouped",
    grouped,
    "two-way-anova",
    { design: "ordinary", posthoc: "dunnett", posthocTarget: "groups", control: "B" },
  ],
  [
    "grouped",
    grouped,
    "two-way-anova",
    { design: "ordinary", posthoc: "dunnett", posthocTarget: "rows", control: "Day 1" },
  ],
  ["grouped", grouped, "two-way-anova", { design: "ordinary", posthoc: "games-howell", posthocTarget: "groups" }],
  ["grouped", grouped, "two-way-anova", { design: "ordinary", posthoc: "holm-sidak", posthocTarget: "groups" }],
  [
    "grouped",
    grouped,
    "two-way-anova",
    { design: "repeated-measures", posthoc: "fisher", posthocTarget: "rows", sphericity: false },
  ],
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
  ["contingency2", contingency2, "chi-square", { test: "yates" }],
  ["contingency2", contingency2, "chi-square", { test: "chi-square" }],
  ["malformation", malformation, "chi-square", { test: "trend" }],
  ["malformation", malformation, "chi-square", { test: "chi-square" }],
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
  ["column", column, "histogram"],
  ["multiple", multiple, "histogram", { xVariable: "Weight", binWidth: 5, stackAs: "percent" }],
  ["column", column, "pie"],
  ["column", column, "donut", { pieValue: "mean" }],
  ["xy", xy, "xy-scatter", { xyStyle: "points+line" }],
  ["xy", xy, "xy-bar"],
  ["xyReps", xyReps, "xy-scatter", { error: "sd" }],
  ["xyRepsEach", xyReps, "xy-scatter", { xyReplicates: "each", xyStyle: "points+line" }],
  ["xyReps", xyReps, "xy-bar", { center: "median", error: "ci" }],
  ["xyReps", xyReps, "xy-area", { error: "none" }],
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

/** Prism 10's results on the same data (run by the user, 2026-11-12), each number as
 *  Prism shows it, to its last digit shown ("<1e-4": Prism's "<0.0001"). */
async function prismDisagreements(): Promise<string[]> {
  const out: string[] = [];
  const same = (what: string, got: number | null | undefined, shown: number | string) => {
    if (typeof shown === "string") {
      if (got == null || !(got < 1e-4)) out.push(`Prism ${what}: Helix ${got}, Prism <0.0001`);
      return;
    }
    const decimals = (String(shown).split(".")[1] ?? "").length;
    if (got == null || Math.abs(got - shown) > 0.5 * 10 ** -decimals + 1e-12)
      out.push(`Prism ${what}: Helix ${got}, Prism ${shown}`);
  };
  // Four groups of unequal sizes and SDs (lot 1).
  // prettier-ignore
  const lot1 = table(["Title", "Control", "Low", "Mid", "High"], [
    ["", "12.1", "13.4", "15.8", "19.9"], ["", "11.4", "14.1", "16.9", "24.3"], ["", "13.0", "12.8", "14.7", "21.7"],
    ["", "12.6", "15.2", "17.4", "26.8"], ["", "10.9", "13.9", "16.1", "18.4"], ["", "11.8", "14.6", "15.3", "23.1"],
    ["", "12.6", "13.1", "18.2", ""], ["", "13.3", "", "16.6", ""],
  ]);
  const desc = await runAnalysis("descriptive-statistics", lot1);
  // prettier-ignore
  const shown = { q1: [11.50, 13.10, 15.43, 19.53], q3: [12.90, 14.60, 17.28, 24.93], cv: [6.687, 6.113, 6.953, 13.59], geoMean: [12.19, 13.85, 16.34, 22.19] };
  for (const [k, values] of Object.entries(shown))
    values.forEach((x, i) =>
      same(`${k} of group ${i + 1}`, "error" in desc ? null : desc.groups[i][k as keyof typeof shown], x),
    );
  const ps = (r: Awaited<ReturnType<typeof runAnalysis>>) =>
    "error" in r ? [] : (r.comparisons ?? []).map((c) => c.p);
  const pairs = (label: string, r: Awaited<ReturnType<typeof runAnalysis>>, prism: (number | string)[]) =>
    prism.forEach((x, i) => same(`${label}, pair ${i + 1}`, ps(r)[i], x));
  const tukey = await runAnalysis("anova", lot1, { posthoc: "tukey", equalSd: true });
  same("ANOVA F", "error" in tukey ? null : tukey.stats.find((s) => s.label === "F")?.value, 50.62);
  same("ANOVA R²", "error" in tukey ? null : tukey.stats.find((s) => s.label.startsWith("R squared"))?.value, 0.8586);
  pairs("Tukey", tukey, [0.2151, 0.0001, "<", 0.0277, "<", "<"]);
  pairs("Bonferroni", await runAnalysis("anova", lot1, { posthoc: "bonferroni", equalSd: true }), [
    0.3393,
    0.0001,
    "<",
    0.0347,
    "<",
    "<",
  ]);
  pairs("Dunnett's T3", await runAnalysis("anova", lot1, { posthoc: "t3", equalSd: false }), [
    0.0114,
    "<",
    0.0011,
    0.0018,
    0.0029,
    0.0183,
  ]);
  pairs("Games-Howell", await runAnalysis("anova", lot1, { posthoc: "games-howell", equalSd: false }), [
    0.01,
    "<",
    0.0012,
    0.0016,
    0.0029,
    0.0143,
  ]);
  pairs("Dunnett", await runAnalysis("anova", lot1, { posthoc: "dunnett", equalSd: true, control: "Control" }), [
    0.1402,
    "<",
    "<",
  ]);
  const kw = await runAnalysis("kruskal-wallis", lot1, { posthoc: "dunn" });
  same("Kruskal-Wallis H", "error" in kw ? null : kw.stats.find((s) => s.label.includes("H"))?.value, 25.42);
  pairs("Dunn", kw, [0.7237, 0.004, "<", 0.4926, 0.0108, 0.7274]);
  // Control vs. High: Student's and Welch's t tests (Prism's difference is High − Control).
  const pair = table(
    ["Title", "Control", "High"],
    lot1.rows.map((r) => [r[0] ?? "", r[1] ?? "", r[4] ?? ""]),
  );
  const two = (equalVariance: boolean) =>
    runAnalysis("compare-two-groups", pair, {
      paired: false,
      gaussian: true,
      equalVariance,
      tails: "two-sided",
    } as AnalysisParams);
  for (const [r, t, df, lo, hi, r2] of [
    [await two(true), 9.133, 12, 7.732, 12.58, 0.8742],
    [await two(false), 7.97, 5.544, 6.974, 13.33, 0.9197],
  ] as const) {
    const stat = (label: string) => ("error" in r ? null : r.stats.find((s) => s.label === label)?.value);
    same("t", Math.abs(stat("t") ?? NaN), t);
    same("t df", stat("df"), df);
    same("CI of the difference (upper)", -(stat("95% CI lower") ?? NaN), hi);
    same("CI of the difference (lower)", -(stat("95% CI upper") ?? NaN), lo);
    same("t R²", stat("R squared"), r2);
    same("F of the variances", stat("F (variance ratio)"), 13.85);
  }
  // Mann-Whitney: Prism's exact P although Control holds ties (12.6 twice).
  const mw = await runAnalysis("compare-two-groups", pair, {
    paired: false,
    gaussian: false,
    tails: "two-sided",
  } as AnalysisParams);
  const mwStat = (label: string) => ("error" in mw ? null : mw.stats.find((s) => s.label === label)?.value);
  same("Mann-Whitney P", mwStat("P value"), 0.0007);
  same("Mann-Whitney U", mwStat("Test statistic"), 0);
  same("Mann-Whitney sum of ranks (Control)", mwStat("Sum of ranks (Control)"), 36);
  same("Mann-Whitney sum of ranks (High)", mwStat("Sum of ranks (High)"), 69);
  same("Median difference", -(mwStat("Median difference") ?? NaN), 10.05);
  same("Hodges-Lehmann", -(mwStat("Hodges-Lehmann difference") ?? NaN), 10.2);
  // Eight subjects measured on Day 0 and Day 7 (lot 2): the paired t test (Prism's
  // difference is Day 7 − Day 0).
  // prettier-ignore
  const days = table(["Title", "Day 0", "Day 7"], [["", "10.2", "12.5"], ["", "9.8", "11.9"], ["", "11.5", "13.2"], ["", "10.9", "12.0"], ["", "8.7", "10.9"], ["", "12.1", "14.8"], ["", "10.4", "11.7"], ["", "9.5", "11.1"]]);
  const paired = await runAnalysis("compare-two-groups", days, {
    paired: true,
    gaussian: true,
    tails: "two-sided",
  } as AnalysisParams);
  const pStat = (label: string) => ("error" in paired ? null : paired.stats.find((s) => s.label === label)?.value);
  same("paired t", Math.abs(pStat("t") ?? NaN), 9.788);
  same("paired df", pStat("df"), 7);
  same("paired mean of differences", -(pStat("Mean of differences") ?? NaN), 1.875);
  same("paired CI (lower)", -(pStat("95% CI upper") ?? NaN), 1.422);
  same("paired CI (upper)", -(pStat("95% CI lower") ?? NaN), 2.328);
  same("paired R²", pStat("R squared"), 0.9319);
  return out;
}

/** Published worked examples, to the digits printed: effect sizes (Lakens 2013), a relative
 *  risk (Agresti's aspirin table), a larger contingency table (Agresti's party affiliation),
 *  Wilcoxon's signed-rank test (Hollander & Wolfe, its exact P counted by hand), Friedman's
 *  test (Hollander & Wolfe's rounding first base), and the log-rank test for trend against
 *  its textbook formula, computed apart from R. */
async function publishedDisagreements(): Promise<string[]> {
  const out: string[] = [];
  const same = (what: string, got: number | null | undefined, shown: number, decimals: number) => {
    if (got == null || Math.abs(got - shown) > 0.5 * 10 ** -decimals + 1e-12)
      out.push(`Published ${what}: Helix ${got}, published ${shown}`);
  };
  const stat = (r: Awaited<ReturnType<typeof runAnalysis>>, label: string) =>
    "error" in r ? null : r.stats.find((s) => s.label === label)?.value;

  // Lakens (2013), Table 3: two movies rated by ten people. Between subjects: t(18) = 2.52,
  // difference 1.00 [0.17, 1.83], ds = 1.13, gs = 1.08. Within: t(9) = 4.74, [0.52, 1.48],
  // dz = t / √n.
  // prettier-ignore
  const movies = table(["Title", "Movie 1", "Movie 2"], [[9, 9], [7, 6], [8, 7], [9, 8], [8, 7], [9, 9], [9, 8], [10, 8], [9, 8], [9, 7]].map(([a, b]) => ["", String(a), String(b)]));
  const between = await runAnalysis("compare-two-groups", movies, {
    paired: false,
    gaussian: true,
    equalVariance: true,
    tails: "two-sided",
  } as AnalysisParams);
  same("Lakens t", stat(between, "t"), 2.52, 2);
  same("Lakens CI lower", stat(between, "95% CI lower"), 0.17, 2);
  same("Lakens CI upper", stat(between, "95% CI upper"), 1.83, 2);
  same("Lakens ds", stat(between, "Cohen's d"), 1.13, 2);
  same("Lakens gs", stat(between, "Hedges' g"), 1.08, 2);
  const within = await runAnalysis("compare-two-groups", movies, {
    paired: true,
    gaussian: true,
    tails: "two-sided",
  } as AnalysisParams);
  same("Lakens paired t", stat(within, "t"), 4.74, 2);
  same("Lakens paired CI lower", stat(within, "95% CI lower"), 0.52, 2);
  same("Lakens paired CI upper", stat(within, "95% CI upper"), 1.48, 2);
  same("Lakens dz", stat(within, "Cohen's d"), (stat(within, "t") ?? NaN) / Math.sqrt(10), 9);

  // Agresti, aspirin and myocardial infarction: placebo's risk 1.82 times aspirin's,
  // 95% CI 1.433 to 2.306 (on the log, as Katz).
  const aspirin = table(
    ["Title", "MI", "No MI"],
    [
      ["Placebo", "189", "10845"],
      ["Aspirin", "104", "10933"],
    ],
  );
  const rr = await runAnalysis("chi-square", aspirin);
  same("aspirin relative risk", stat(rr, "Relative risk (MI)"), 1.817802, 6);
  same("aspirin RR CI lower", stat(rr, "Relative risk 95% CI lower"), 1.433031, 6);
  same("aspirin RR CI upper", stat(rr, "Relative risk 95% CI upper"), 2.305884, 6);

  // Newcombe (1998): 56/70 vs. 48/80, the difference 0.2, its CI 0.0524 to 0.3339 (his
  // method 10); the companion paper's 81/263, Wilson's CI 0.2553 to 0.3662 (as sensitivity).
  const newcombe = table(
    ["Title", "Yes", "No"],
    [
      ["A", "56", "14"],
      ["B", "48", "32"],
    ],
  );
  const nc = await runAnalysis("chi-square", newcombe, { test: "chi-square" } as AnalysisParams);
  same("Newcombe difference", stat(nc, "Difference of risks (Yes)"), 0.2, 9);
  same("Newcombe CI lower", stat(nc, "Difference of risks 95% CI lower"), 0.0524, 4);
  same("Newcombe CI upper", stat(nc, "Difference of risks 95% CI upper"), 0.3339, 4);
  same("NNT", stat(nc, "Number needed to treat"), 5, 9);
  same("NNT CI lower", stat(nc, "Number needed to treat 95% CI lower"), 1 / 0.3339, 2);
  const wilson = table(
    ["Title", "Present", "Absent"],
    [
      ["Positive", "81", "5"],
      ["Negative", "182", "40"],
    ],
  );
  const ws = await runAnalysis("chi-square", wilson);
  same("Wilson CI lower (sensitivity 81/263)", stat(ws, "Sensitivity 95% CI lower"), 0.2553, 4);
  same("Wilson CI upper (sensitivity 81/263)", stat(ws, "Sensitivity 95% CI upper"), 0.3662, 4);

  // Agresti, the same malformations by drinks with scores 1 to 5: M² = 1.83, P = 0.18.
  const trendTest = await runAnalysis("chi-square", malformation, { test: "trend" } as AnalysisParams);
  same("Agresti trend M²", stat(trendTest, "Chi-square for trend"), 1.83, 2);
  same("Agresti trend P", stat(trendTest, "P value"), 0.18, 2);

  // Agresti, party affiliation by gender (GSS 1991): X² = 7.01, df 2, P = 0.030;
  // Cramér's V = √(X² / N).
  const party = table(
    ["Title", "Democrat", "Independent", "Republican"],
    [
      ["Female", "279", "73", "225"],
      ["Male", "165", "47", "191"],
    ],
  );
  const chi = await runAnalysis("chi-square", party);
  same("party X²", stat(chi, "Chi-square"), 7.01, 2);
  same("party df", stat(chi, "df"), 2, 0);
  same("party P", stat(chi, "P value"), 0.03, 3);
  same("party Cramér's V", stat(chi, "Cramér's V"), Math.sqrt((stat(chi, "Chi-square") ?? NaN) / 980), 12);

  // Hollander & Wolfe, Hamilton depression scale at two visits: 9 pairs, one sum of ranks
  // 40 (the other 5); exactly 10 of the 2^9 sign patterns give 5 or less, so P = 20 / 512.
  const visits = table(
    ["Title", "First", "Second"],
    [
      [1.83, 0.878],
      [0.5, 0.647],
      [1.62, 0.598],
      [2.48, 2.05],
      [1.68, 1.06],
      [1.88, 1.29],
      [1.55, 1.06],
      [3.06, 3.14],
      [1.3, 1.29],
    ].map(([a, b]) => ["", String(a), String(b)]),
  );
  const wilcoxon = await runAnalysis("compare-two-groups", visits, {
    paired: true,
    gaussian: false,
    tails: "two-sided",
  } as AnalysisParams);
  same("Wilcoxon sum of ranks", stat(wilcoxon, "Test statistic"), 40, 0);
  same("Wilcoxon exact P", stat(wilcoxon, "P value"), 20 / 512, 12);

  // Hollander & Wolfe, 22 players rounding first base three ways: Friedman 11.14, df 2.
  // prettier-ignore
  const rounding = [[5.4, 5.5, 5.55], [5.85, 5.7, 5.75], [5.2, 5.6, 5.5], [5.55, 5.5, 5.4], [5.9, 5.85, 5.7], [5.45, 5.55, 5.6], [5.4, 5.4, 5.35], [5.45, 5.5, 5.35], [5.25, 5.15, 5], [5.85, 5.8, 5.7], [5.25, 5.2, 5.1], [5.65, 5.55, 5.45], [5.6, 5.35, 5.45], [5.05, 5, 4.95], [5.5, 5.5, 5.4], [5.45, 5.55, 5.5], [5.55, 5.55, 5.35], [5.45, 5.5, 5.55], [5.5, 5.45, 5.25], [5.65, 5.6, 5.4], [5.7, 5.65, 5.55], [6.3, 6.3, 6.25]];
  const friedman = await runAnalysis(
    "friedman",
    table(
      ["Title", "Round Out", "Narrow Angle", "Wide Angle"],
      rounding.map((r) => ["", ...r.map(String)]),
    ),
    { posthoc: "none" },
  );
  same("Friedman statistic", stat(friedman, "Friedman statistic (Q)"), 11.14, 2);
  same("Friedman df", stat(friedman, "df"), 2, 0);

  // The log-rank test for trend as the textbooks write it (Collett 2003, §3.5): at each event
  // time, each group's events minus those expected, scored 1, 2, 3…, over the hypergeometric
  // variance; computed here apart from R.
  const trend = await runAnalysis("survival", survival3, { curveTest: "trend", correction: "holm" });
  const { x, ys } = splitXY(readTable(survival3).columns);
  const subjects = ys.flatMap((y, i) => {
    const p = xyPoints(x!, y);
    return p.x.map((t, k) => ({ t, event: p.y[k] === 1, score: i + 1 }));
  });
  let [u, v] = [0, 0];
  for (const t of [...new Set(subjects.filter((s) => s.event).map((s) => s.t))]) {
    const risk = subjects.filter((s) => s.t >= t);
    const n = risk.length;
    const d = risk.filter((s) => s.t === t && s.event).length;
    const mean = risk.reduce((a, s) => a + s.score, 0) / n;
    const square = risk.reduce((a, s) => a + s.score ** 2, 0) / n;
    u += risk.filter((s) => s.t === t && s.event).reduce((a, s) => a + s.score, 0) - d * mean;
    if (n > 1) v += ((d * (n - d)) / (n - 1)) * (square - mean ** 2);
  }
  same("log-rank test for trend", stat(trend, "Chi-square"), u ** 2 / v, 9);
  return out;
}

/** Edge cases (audit 2026-11-16): what the data lack is said in Helix's words, never R's;
 *  decimals typed are taken as typed; units change nothing they shouldn't. */
async function edgeDisagreements(): Promise<string[]> {
  const out: string[] = [];
  const P = (r: Awaited<ReturnType<typeof runAnalysis>>, label = "P value") =>
    "error" in r ? r.error : r.stats.find((s) => s.label === label)?.value;
  const cells = (rows: number[][]) => rows.map((r) => ["", ...r.map(String)]);
  const close = (what: string, a: unknown, b: unknown, tol = 1e-9) => {
    if (typeof a !== "number" || typeof b !== "number" || Math.abs(a - b) > tol * Math.max(1, Math.abs(b)))
      out.push(`Edge ${what}: ${a}, expected ${b}`);
  };

  // Differences that are equal as typed are ties: the signed-rank test on decimals gives the
  // P it gives on the same data in tenths (whole numbers, exact differences).
  // prettier-ignore
  const pairs = [[13.2, 12.5], [12.1, 11.4], [1.3, 0.6], [5.6, 4.1], [2.9, 3.6], [8.4, 6.1], [7.7, 5.2], [3.3, 1.1]];
  const wilcoxon = { paired: true, gaussian: false, tails: "two-sided" } as AnalysisParams;
  const decimals = await runAnalysis("compare-two-groups", table(["Title", "A", "B"], cells(pairs)), wilcoxon);
  const tenths = await runAnalysis(
    "compare-two-groups",
    table(["Title", "A", "B"], cells(pairs.map((r) => r.map((v) => Math.round(v * 10))))),
    wilcoxon,
  );
  close("Wilcoxon on decimals vs. tenths", P(decimals), P(tenths));
  // The same against a value: 1.6 and 9.6 are both 4 from 5.6 (not to a computer).
  const against = (values: number[], hypotheticalValue: number) =>
    runAnalysis("one-sample-t", table(["Title", "A"], cells(values.map((v) => [v]))), {
      hypotheticalValue,
      tails: "two-sided",
      gaussian: false,
    } as AnalysisParams);
  const typed = [1.6, 9.6, 1.7, 9.5, 2.9, 8.3, 7.1, 4.4];
  close(
    "one-sample Wilcoxon on decimals vs. tenths",
    P(await against(typed, 5.6), "A — P value"),
    P(
      await against(
        typed.map((v) => Math.round(v * 10)),
        56,
      ),
      "A — P value",
    ),
  );

  // A repeated-measures two-way ANOVA where a group keeps one subject: the others give the
  // sphericity correction, and that group's rows aren't compared.
  const lone = table(
    ["Title", "A:Y1", "A:Y2", "A:Y3", "B:Y1", "B:Y2", "B:Y3"],
    [
      ["Day 1", "10", "11", "12", "14", "", ""],
      ["Day 2", "12", "13", "15", "18", "", ""],
      ["Day 3", "15", "14", "19", "22", "", ""],
    ],
    { groups: 2, replicates: 3 },
  );
  const rm = await runAnalysis("two-way-anova", lone, {
    design: "repeated-measures",
    posthoc: "tukey",
    posthocTarget: "rows",
    sphericity: false,
  } as AnalysisParams);
  const eps = "error" in rm ? null : rm.stats.find((s) => s.label === "Geisser-Greenhouse epsilon")?.value;
  const alone = await evalNamedVector(
    "Y<-rbind(c(10,12,15),c(11,13,14),c(12,15,19));C<-diag(3)-1/3;C<-C%*%cov(Y)%*%C;c(e=min(1,sum(diag(C))^2/(2*sum(C*C))))",
  );
  close("RM two-way epsilon with a one-subject group", eps, alone.e);
  if ("error" in rm || rm.comparisons?.some((c) => c.group1.includes("(B)") || c.p == null))
    out.push(`Edge RM two-way with a one-subject group: ${JSON.stringify("error" in rm ? rm : rm.comparisons)}`);

  // A group without a value at a row: two-way ANOVA (Type III) refuses, by name.
  const hole = table(
    ["Title", "A:Y1", "A:Y2", "B:Y1", "B:Y2"],
    [
      ["Day 1", "10", "11", "14", "15"],
      ["Day 2", "12", "13", "", ""],
    ],
    { groups: 2, replicates: 2 },
  );
  const holed = await runAnalysis("two-way-anova", hole, {
    design: "ordinary",
    posthoc: "none",
    posthocTarget: "groups",
  } as AnalysisParams);
  if (!("error" in holed) || !holed.error.includes("“B” has no value at row “Day 2”"))
    out.push(`Edge two-way ANOVA with an empty cell: ${JSON.stringify(holed)}`);

  // Regressions: X and the predictors far from 0 for their spread give the same slopes and
  // P values (the intercept moves with X).
  const shift = 1e9;
  const moved = {
    ...xy,
    rows: xy.rows.map((r) => r.map((c, i) => (i === 1 && c != null ? String(Number(c) + shift) : c))),
  };
  const [line, far] = await Promise.all(
    [xy, moved].map((d) => runAnalysis("linear-regression", d, { forceOrigin: false } as AnalysisParams)),
  );
  const at = (r: typeof line, label: string) =>
    "error" in r ? r.error : r.stats.find((s) => s.label === label)?.value;
  for (const label of ["Slope", "Slope 95% CI lower", "P value (slope ≠ 0)", "R squared"])
    close(`regression with X + 1e9, ${label}`, at(far, label), at(line, label), 1e-6);
  close(
    "regression with X + 1e9, intercept",
    at(far, "Y-intercept"),
    (at(line, "Y-intercept") as number) - (at(line, "Slope") as number) * shift,
    1e-6,
  );
  const twin = {
    ...multiple,
    columns: [...multiple.columns, "Twice"],
    rows: multiple.rows.map((r) => [...r, r[2] == null ? null : String(2 * Number(r[2]))]),
  };
  const redundant = await runAnalysis("multiple-regression", twin, { dependent: "Weight" } as AnalysisParams);
  if (!("error" in redundant) || !redundant.error.startsWith("“Twice” adds nothing"))
    out.push(`Edge multiple regression with a redundant predictor: ${JSON.stringify(redundant)}`);
  const lifted = {
    ...multiple,
    rows: multiple.rows.map((r) => r.map((c, i) => (i === 2 && c != null ? String(Number(c) + 1e6) : c))),
  };
  const [base, high] = await Promise.all(
    [multiple, lifted].map((d) => runAnalysis("multiple-regression", d, { dependent: "Weight" } as AnalysisParams)),
  );
  ["Height", "Age", "Dose"].forEach((term) => {
    const of = (r: typeof base) => ("error" in r ? undefined : r.coefficients?.find((c) => c.term === term));
    close(`multiple regression with Height + 1e6, ${term}`, of(high)?.estimate, of(base)?.estimate, 1e-6);
    close(`multiple regression with Height + 1e6, ${term} P`, of(high)?.p, of(base)?.p, 1e-6);
  });

  // The two-way sums of squares from cell means equal aov's and drop1's (Type III) on
  // random unbalanced designs, with and without the interaction (cells missing), and the
  // split-plot's equal aov's strata; the one-way repeated measures' F equals aov's.
  const forms = await evalNamedVector(
    `${R_TWO_WAY};set.seed(3);worst<-0;rel<-function(a,b)max(abs(a-b)/pmax(1,abs(b)))
for(k in 1:8){G<-2+k%%3;R<-2+k%%5;g<-factor(rep(1:G,each=R*3));r<-factor(rep(rep(1:R,each=3),G));keep<-runif(length(g))>0.3
for(i in 1:G)for(j in 1:R)if(!any(keep[g==i&r==j]))keep[which(g==i&r==j)[1]]<-TRUE
v<-rnorm(length(g))+as.integer(g)*.4;v<-v[keep];g<-droplevels(g[keep]);r<-droplevels(r[keep])
contrasts(g)<-"contr.sum";contrasts(r)<-"contr.sum";f<-aov(v~g*r);a<-drop1(f,~.)
worst<-max(worst,rel(tw(v,g,r,TRUE),c(a$"Sum of Sq"[2:4],deviance(f),df.residual(f))))
g1<-factor(rep(1:G,each=R));r1<-factor(rep(1:R,G));w<-rnorm(G*R);o<-c(-1,-G*R);w<-w[o];g1<-g1[o];r1<-r1[o]
contrasts(g1)<-"contr.sum";contrasts(r1)<-"contr.sum";f1<-aov(w~g1+r1);a1<-drop1(f1,~.)
worst<-max(worst,rel(tw(w,g1,r1,FALSE),c(a1$"Sum of Sq"[2:3],deviance(f1),df.residual(f1))))
ns<-1+(1:G+k)%%3+1;gs<-factor(rep(1:G,ns));N<-sum(ns);Y<-matrix(rnorm(N*R),N)+as.integer(gs)
y<-as.vector(t(Y));gg<-factor(rep(gs,each=R));rr<-factor(rep(1:R,N));id<-factor(rep(1:N,each=R))
b<-summary(aov(y~gg*rr+Error(id/rr)));o<-sp(Y,gs)
worst<-max(worst,rel(c(o$e1$"Sum Sq",o$e2$"Sum Sq"),c(b[["Error: id"]][[1]]$"Sum Sq",b[["Error: id:rr"]][[1]]$"Sum Sq")))}
c(worst=worst)`,
  );
  if (!(forms.worst != null && forms.worst < 1e-10))
    out.push(`Edge two-way closed forms vs. aov: off by ${forms.worst}`);
  const rmOne = await runAnalysis("rm-anova", matched, { posthoc: "none" } as AnalysisParams);
  const matchedSets = readTable(matched).columns.filter((c) => c.values.length);
  const rmAov = await evalNamedVector(
    `M<-cbind(${matchedSets.map((c) => rVec(c.values)).join(",")});v<-as.vector(M);gr<-factor(rep(1:ncol(M),each=nrow(M)));` +
      `s<-factor(rep(1:nrow(M),ncol(M)));c(F=summary(aov(v~gr+s))[[1]]$"F value"[1])`,
  );
  close(
    "one-way repeated measures F vs. aov",
    "error" in rmOne ? rmOne.error : rmOne.stats.find((x) => x.label === "F")?.value,
    rmAov.F,
  );

  // The comparisons' 95% CIs: Tukey's are TukeyHSD's own, Bonferroni's the textbook's (the
  // t at 0.05 / 2m), and every CI leaves out 0 exactly when its P is under 0.05.
  const tukeyCi = await runAnalysis("anova", column, { posthoc: "tukey" } as AnalysisParams);
  const bonfCi = await runAnalysis("anova", column, { posthoc: "bonferroni" } as AnalysisParams);
  const cols = readTable(column).columns.filter((c) => c.values.length);
  const hsd = await evalNamedVector(
    `G<-list(${cols.map((c) => rVec(c.values)).join(",")});v<-unlist(G);gr<-factor(rep(seq_along(G),lengths(G)));` +
      `a<-aov(v~gr);t<-TukeyHSD(a)$gr;mse<-deviance(a)/df.residual(a);n<-lengths(G);m<-sapply(G,mean);k<-length(G);M<-k*(k-1)/2;` +
      `c(unlist(lapply(seq_len(k-1),function(i)unlist(lapply((i+1):k,function(j){r<-t[paste0(j,"-",i),];` +
      `h<-qt(1-0.05/(2*M),df.residual(a))*sqrt(mse*(1/n[i]+1/n[j]));` +
      `setNames(c(-r[["upr"]],-r[["lwr"]],m[i]-m[j]-h,m[i]-m[j]+h),paste0(c("tl_","th_","bl_","bh_"),i-1,"_",j-1))})))))`,
  );
  const pairsOf = (r: typeof tukeyCi) => ("error" in r ? [] : (r.comparisons ?? []));
  pairsOf(tukeyCi).forEach((c, k) => {
    const [i, j] = [cols.findIndex((x) => x.name === c.group1), cols.findIndex((x) => x.name === c.group2)];
    close(`Tukey CI ${k} lower`, c.low, hsd[`tl_${i}_${j}`], 1e-6); // qtukey: R iterates to 1e-4
    close(`Tukey CI ${k} upper`, c.high, hsd[`th_${i}_${j}`], 1e-6);
  });
  pairsOf(bonfCi).forEach((c, k) => {
    const [i, j] = [cols.findIndex((x) => x.name === c.group1), cols.findIndex((x) => x.name === c.group2)];
    close(`Bonferroni CI ${k} lower`, c.low, hsd[`bl_${i}_${j}`]);
    close(`Bonferroni CI ${k} upper`, c.high, hsd[`bh_${i}_${j}`]);
  });
  for (const [name, data, type, params] of ANALYSES) {
    const r = await runAnalysis(type, data, params);
    // A ratio's CI leaves out 1, a difference's 0.
    const none = "error" in r || !r.comparisonsEffect?.startsWith("Ratio") ? 0 : 1;
    for (const c of "error" in r ? [] : (r.comparisons ?? [])) {
      if (c.low == null || c.high == null || c.p == null || Math.abs(c.p - 0.05) < 1e-6) continue;
      if (c.low > none || c.high < none ? c.p >= 0.05 : c.p < 0.05)
        out.push(`Edge CI vs. P: ${type} ${name} ${c.group1} vs. ${c.group2}: ${c.low} to ${c.high}, P ${c.p}`);
    }
  }

  // Šidák's, Holm-Šidák's and Fisher's LSD P values are pairwise.t.test's raw ones (pooled
  // SD), corrected by their textbook formulas, over the pairs compared alone.
  const corrected = await evalNamedVector(
    `G<-list(${cols.map((c) => rVec(c.values)).join(",")});v<-unlist(G);gr<-factor(rep(seq_along(G),lengths(G)));` +
      `r<-pairwise.t.test(v,gr,p.adjust.method="none")$p.value;raw<-r[lower.tri(r,diag=TRUE)];raw<-raw[!is.na(raw)];m<-length(raw);` +
      `o<-order(raw);hs<-numeric(m);hs[o]<-pmin(1,cummax(1-(1-raw[o])^(m:1)));` +
      `two<-c(r["3","1"],r["2","1"]);` + // Control vs. High (3rd data set) and Low vs. Control
      `c(setNames(1-(1-raw)^m,paste0("s",1:m)),setNames(hs,paste0("h",1:m)),setNames(raw,paste0("f",1:m)),setNames(1-(1-two)^2,c("t1","t2")))`,
  );
  for (const [how, prefix] of [
    ["sidak", "s"],
    ["holm-sidak", "h"],
    ["fisher", "f"],
  ] as const) {
    const r = await runAnalysis("anova", column, { posthoc: how } as AnalysisParams);
    pairsOf(r).forEach((c, k) => close(`${how} P ${k}`, c.p, corrected[`${prefix}${k + 1}`]));
  }
  const two = pairsOf(
    await runAnalysis("anova", column, {
      posthoc: "sidak",
      compared: [pairKey("Control", "High"), pairKey("Low", "Control")],
    } as AnalysisParams),
  );
  close("Šidák of 2 chosen pairs (Control vs. High)", two.find((c) => c.group2 === "High")?.p, corrected.t1);
  close("Šidák of 2 chosen pairs (Control vs. Low)", two.find((c) => c.group2 === "Low")?.p, corrected.t2);

  // A one-tailed test's 95% CI is open on its side.
  const greater = await runAnalysis("compare-two-groups", column, {
    paired: false,
    gaussian: true,
    equalVariance: true,
    tails: "greater",
  } as AnalysisParams);
  if (P(greater, "95% CI upper") !== Infinity) out.push(`Edge one-tailed CI: upper ${P(greater, "95% CI upper")}`);

  // Every analysis case above, on its table cut short, flattened or emptied: refused in
  // Helix's words (or run), never with R's message.
  const variants: Record<string, (d: TableData) => TableData> = {
    "one row": (d) => ({ ...d, rows: d.rows.slice(0, 1) }),
    "two rows": (d) => ({ ...d, rows: d.rows.slice(0, 2) }),
    "every value 5": (d) => ({
      ...d,
      rows: d.rows.map((r) => r.map((c, i) => (i > 0 && c != null && Number.isFinite(Number(c)) ? "5" : c))),
    }),
    "every value 0": (d) => ({
      ...d,
      rows: d.rows.map((r) => r.map((c, i) => (i > 0 && c != null && Number.isFinite(Number(c)) ? "0" : c))),
    }),
    "each column constant": (d) => ({
      ...d,
      rows: d.rows.map((r) => r.map((c, i) => (i > 0 && c != null && Number.isFinite(Number(c)) ? String(i) : c))),
    }),
    "last column blank": (d) => ({ ...d, rows: d.rows.map((r) => r.map((c, i) => (i === r.length - 1 ? null : c))) }),
    "every other cell excluded": (d) => ({
      ...d,
      excluded: d.rows.flatMap((r, i) =>
        r.map((_, c) => (c > 0 && (i + c) % 2 === 0 ? `${i},${c}` : "")).filter(Boolean),
      ),
    }),
  };
  for (const [name, data, type, params] of ANALYSES)
    for (const [variant, make] of Object.entries(variants)) {
      const r = await runAnalysis(type, make(data), params);
      if ("error" in r && r.error.startsWith("Could not run"))
        out.push(`Edge ${type} ${JSON.stringify(params ?? {})} on ${name}, ${variant}: ${r.error}`);
    }
  return out;
}

/** NIST's Statistical Reference Datasets (tests/nist/, public domain): Helix's results
 *  against their certified values, to 9 significant digits (6 for the nonlinear fit, whose
 *  convergence stops earlier): linear regression (Norris), a quadratic (Pontius), multiple
 *  regression (Longley), a hyperbola (Misra1d: Bmax = b1, Kd = 1 / b2), one-way ANOVA
 *  (SiRstv; AtmWtAg, two groups, by Student's t; SmLs07, 13 significant digits in common), and
 *  the mean and SD (NumAcc3, whose values differ in the 8th digit; Michelso). */
async function nistDisagreements(): Promise<string[]> {
  const out: string[] = [];
  const nist = (name: string, first: number) =>
    readFileSync(fileURLToPath(new URL(`nist/${name}.dat`, import.meta.url)), "utf8")
      .split("\n")
      .slice(first - 1)
      .filter((l) => l.trim())
      .map((l) => l.trim().split(/\s+/));
  const near = (what: string, got: number | null | undefined, certified: number, digits = 9) => {
    if (got == null || Math.abs(got - certified) > Math.abs(certified) * 10 ** -digits)
      out.push(`NIST ${what}: Helix ${got}, certified ${certified}`);
  };
  const stat = (r: Awaited<ReturnType<typeof runAnalysis>>, label: string) =>
    "error" in r ? null : r.stats.find((s) => s.label === label)?.value;
  const coef = (r: Awaited<ReturnType<typeof runAnalysis>>, term: string) =>
    "error" in r ? undefined : r.coefficients?.find((c) => c.term === term);
  const xyOf = (rows: string[][]) =>
    table(
      ["Title", "X", "Y"],
      rows.map(([y, x]) => ["", x, y]),
    );

  // Norris: a line; each coefficient's SD from its 95% CI (t × SE, 34 df).
  const norris = await runAnalysis("linear-regression", xyOf(nist("Norris", 61)), { forceOrigin: false });
  near("Norris slope", stat(norris, "Slope"), 1.00211681802045);
  near("Norris intercept", stat(norris, "Y-intercept"), -0.262323073774029);
  near("Norris R²", stat(norris, "R squared"), 0.999993745883712);
  const ciHalf = (lo: string, hi: string) => ((stat(norris, hi) ?? NaN) - (stat(norris, lo) ?? NaN)) / 2 / tCrit95(34);
  near("Norris slope SD", ciHalf("Slope 95% CI lower", "Slope 95% CI upper"), 0.429796848199937e-3, 6);
  near("Norris intercept SD", ciHalf("Intercept 95% CI lower", "Intercept 95% CI upper"), 0.232818234301152, 6);

  // Pontius: a quadratic.
  const pontius = await runAnalysis("nonlinear-regression", xyOf(nist("Pontius", 61)), { model: "quadratic" });
  // prettier-ignore
  for (const [term, est, sd] of [["B0", 0.673565789473684e-3, 0.107938612033077e-3], ["B1", 0.732059160401003e-6, 0.157817399981659e-9], ["B2", -0.316081871345029e-14, 0.486652849992036e-16]] as const) {
    near(`Pontius ${term}`, coef(pontius, term)?.estimate, est);
    near(`Pontius ${term} SD`, coef(pontius, term)?.stdError, sd);
  }

  // Longley: six predictors, much alike.
  const longley = nist("Longley", 61);
  const names = ["y", "x1", "x2", "x3", "x4", "x5", "x6"];
  const multi = await runAnalysis(
    "multiple-regression",
    table(
      ["Title", ...names],
      longley.map((r) => ["", ...r]),
    ),
    {
      dependent: "y",
      predictors: names.slice(1),
    },
  );
  // prettier-ignore
  const certified = [[-3482258.63459582, 890420.383607373], [15.0618722713733, 84.9149257747669], [-0.358191792925910e-1, 0.334910077722432e-1], [-2.02022980381683, 0.488399681651699], [-1.03322686717359, 0.214274163161675], [-0.511041056535807e-1, 0.226073200069370], [1829.15146461355, 455.478499142212]];
  ["Intercept", ...names.slice(1)].forEach((term, i) => {
    near(`Longley ${term}`, coef(multi, term)?.estimate, certified[i][0]);
    near(`Longley ${term} SD`, coef(multi, term)?.stdError, certified[i][1]);
  });
  near("Longley R²", stat(multi, "R squared"), 0.995479004577296);
  near("Longley F", stat(multi, "F"), 330.285339234588);

  // Misra1d: y = b1·b2·x / (1 + b2·x), Helix's hyperbola Bmax·x / (Kd + x) with Kd = 1 / b2.
  const misra = await runAnalysis("nonlinear-regression", xyOf(nist("Misra1d", 61)), { model: "hyperbola" });
  near("Misra1d Bmax (b1)", coef(misra, "Bmax")?.estimate, 4.3736970754e2, 6);
  near("Misra1d Bmax SD", coef(misra, "Bmax")?.stdError, 3.6489174345, 6);
  near("Misra1d 1 / Kd (b2)", 1 / (coef(misra, "Kd")?.estimate ?? NaN), 3.0227324449e-4, 6);
  near("Misra1d Kd SD", coef(misra, "Kd")?.stdError, 2.9334354479e-6 / 3.0227324449e-4 ** 2, 5);

  // One-way ANOVA: each group a column.
  // prettier-ignore
  for (const [name, f, r2] of [["SiRstv", 1.18046237440255, 0.190999039051129], ["AtmWtAg", 15.9467335677930, 0.257426544538321], ["SmLs07", 21.0, 0.482758620689655]] as const) {
    const byGroup = new Map<string, string[]>();
    for (const [g, v] of nist(name, 61)) byGroup.set(g, [...(byGroup.get(g) ?? []), v]);
    const groups = [...byGroup.values()];
    const height = Math.max(...groups.map((g) => g.length));
    const data = table(["Title", ...[...byGroup.keys()].map((g) => `G${g}`)], Array.from({ length: height }, (_, r) => ["", ...groups.map((g) => g[r] ?? "")]));
    if (groups.length === 2) {
      // Two groups: Student's t test, whose t² is the ANOVA's F.
      const t = await runAnalysis("compare-two-groups", data, {
        paired: false,
        gaussian: true,
        equalVariance: true,
        tails: "two-sided",
      } as AnalysisParams);
      near(`${name} t² (F)`, (stat(t, "t") ?? NaN) ** 2, f);
      continue;
    }
    const anova = await runAnalysis("anova", data, { posthoc: "none", equalSd: true });
    // SmLs07's values have 13 significant digits in common: a double (what every program
    // computes with) holds each to within 0.00005, on differences of 0.1, so 4 digits are
    // all that the data as stored allow (shifted down, R finds F = 21 to 14 digits).
    const digits = name === "SmLs07" ? 4 : 9;
    near(`${name} F`, stat(anova, "F"), f, digits);
    near(`${name} R²`, stat(anova, "R squared (eta squared)"), r2, digits);
  }

  // The mean and SD.
  for (const [name, mean, sd] of [
    ["NumAcc3", 1000000.2, 0.1],
    ["Michelso", 299.8524, 0.0790105478190518],
  ] as const) {
    const values = nist(name, 61).map(([v]) => ["", v]);
    const desc = await runAnalysis("descriptive-statistics", table(["Title", "Y"], values));
    const g = "error" in desc ? undefined : desc.groups[0];
    near(`${name} mean`, g?.mean, mean);
    near(`${name} SD`, g?.sd, sd);
  }
  return out;
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
      const pairs = xyPoints(x!, y);
      const js = fitLinear(pairs.x, pairs.y, forceOrigin);
      const stat = (label: string) => ("error" in r ? null : r.stats.find((s) => s.label === label)?.value);
      const [rSlope, rR] = [stat("Slope"), stat("Pearson r")];
      if (rSlope == null || js == null || Math.abs(rSlope - js.slope) > 1e-9)
        out.push(
          `Regression of ${y.name}${forceOrigin ? " through the origin" : ""}: graph slope ${js?.slope}, R slope ${rSlope}`,
        );
      if (!forceOrigin && (rR == null || js == null || Math.abs(rR - js.r) > 1e-9))
        out.push(`Regression of ${y.name}: graph r ${js?.r}, R's ${rR}`);
      // Its 95% bands, of the line and of a new point, are R's predict()'s.
      const at = [Math.min(...pairs.x) - 1, ...pairs.x, Math.max(...pairs.x) + 2];
      const band = await evalNamedVector(
        `m<-lm(y~x${forceOrigin ? "+0" : ""},data.frame(x=${rVec(pairs.x)},y=${rVec(pairs.y)}));nd<-data.frame(x=${rVec(at)});` +
          `c(setNames(predict(m,nd,interval="confidence")[,2],paste0("c",seq_along(nd$x))),` +
          `setNames(predict(m,nd,interval="prediction")[,3],paste0("p",seq_along(nd$x))))`,
      );
      at.forEach((x0, k) => {
        const [, lo] = bandAt(js!, x0, "confidence");
        const [, , hi] = bandAt(js!, x0, "prediction");
        if (
          Math.abs(lo - band[`c${k + 1}`]!) > 1e-9 * Math.max(1, Math.abs(lo)) ||
          Math.abs(hi - band[`p${k + 1}`]!) > 1e-9 * Math.max(1, Math.abs(hi))
        )
          out.push(
            `Regression band of ${y.name}${forceOrigin ? " through the origin" : ""} at ${x0}: ${lo}, ${hi} vs. predict() ${band[`c${k + 1}`]}, ${band[`p${k + 1}`]}`,
          );
      });
    }
  }
  out.push(
    ...(await nistDisagreements()),
    ...(await prismDisagreements()),
    ...(await publishedDisagreements()),
    ...(await edgeDisagreements()),
  );
  // ROUT on columns finds the very outliers Prism 10 finds on the same data, at Q = 1% and
  // 5% (run in Prism by the user, 2026-11-12): clean data, one or two outliers (masking),
  // a skewed column, ties, three values.
  // prettier-ignore
  const prismColumns: Record<string, number[]> = {
    A: [10.2, 9.8, 10.5, 9.6, 10.1, 10.4, 9.9, 10.3, 9.7, 10.0], B: [10.2, 9.8, 10.5, 9.6, 10.1, 10.4, 9.9, 10.3, 9.7, 16.5],
    C: [20.1, 19.6, 20.4, 19.8, 20.2, 19.9, 20.3, 20.0, 19.7, 20.5, 26.8, 27.4], D: [5.1, 4.8, 5.3, 4.9, 5.2, 5.0, 4.7, 6.1],
    E: [3.1, 3.3, 9.0], F: [1.2, 1.5, 1.1, 2.3, 1.8, 3.9, 1.4, 2.7, 1.6, 5.8, 1.3, 2.1, 1.9, 8.2, 1.7],
    G: [7, 7, 7, 7, 8, 7, 7, 8, 7, 12],
    H: [50.3, 48.9, 51.2, 49.5, 50.8, 49.1, 50.1, 51.6, 48.6, 50.4, 49.8, 50.9, 49.3, 50.6, 48.8, 51.1, 49.7, 50.2, 49.9, 53.9],
    I: [100, 102, 98, 101, 99, 103, 97, 100, 140, 60], J: [0.8, 1.1, 0.9, 1.0, 1.2, 0.7, 1.05, 0.95, 1.6],
  };
  const prismTable = table(
    ["Title", ...Object.keys(prismColumns)],
    Array.from({ length: 20 }, (_, r) => [
      "",
      ...Object.values(prismColumns).map((c) => (c[r] == null ? "" : String(c[r]))),
    ]),
  );
  const prismOutliers: Record<number, string> = {
    1: "B 16.5, C 26.8, C 27.4, F 5.8, F 8.2, G 8, G 8, G 12, I 140, I 60",
    5: "B 16.5, C 26.8, C 27.4, F 3.9, F 5.8, F 8.2, G 8, G 8, G 12, H 53.9, I 140, I 60",
  };
  for (const q of [1, 5]) {
    const r = await runAnalysis("outliers", prismTable, { q });
    const found =
      "error" in r
        ? r.error
        : (r.notes ?? "")
            .match(/[A-J] row \d+ \(value [\d.]+\)/g)
            ?.map((f) => f.replace(/ row \d+ \(value ([\d.]+)\)/, " $1"))
            .join(", ");
    if (found !== prismOutliers[q]) out.push(`ROUT at Q = ${q}%: ${found}; Prism: ${prismOutliers[q]}`);
  }
  // ROUT finds the point far off the curve, and nothing in the same data without it, whose
  // fit is then the plain least-squares one; its robust fit minimizes the sum of
  // ln(1 + (residual / RSDR)²) at its RSDR (no step of optim lowers it).
  const routed = await runAnalysis("nonlinear-regression", decayOutlier, {
    ys: ["A", "B"],
    model: "one-phase-decay",
    rout: true,
  });
  const found = "error" in routed ? "error" : routed.curveOutliers?.map((o) => `${o.set}@${o.x}`).join();
  if (found !== "B@3") out.push(`ROUT on a decay: ${found}, not B@3`);
  const plain = await runAnalysis("nonlinear-regression", decayOutlier, { y: "A", model: "one-phase-decay" });
  const k = (r: typeof plain, i: number) =>
    "error" in r ? null : r.coefficients?.filter((c) => c.term.endsWith("K"))[i]?.estimate;
  if (k(routed, 0) == null || Math.abs(k(routed, 0)! - k(plain, 0)!) > 1e-9)
    out.push(`ROUT without outliers: K ${k(routed, 0)}, least squares ${k(plain, 0)}`);
  // On the scatter, the point left out is drawn hollow, the others as they were.
  if (!("error" in routed)) {
    const options = newGraphOptions("xy-scatter");
    const columns = plotColumns(readTable(decayOutlier), "xy-scatter", options, "xy");
    const fig = GRAPHS["xy-scatter"].build(columns, options, paintOf(options, 2));
    const { x: hours, ys: sets } = splitXY(columns);
    addFittedCurves(fig, hours!, ["A", "B"], sets, "one-phase-decay", routed, false, options, paintOf(options, 2));
    const b = fig.data.at(-1) as { marker: { color: string[] } };
    const clear = b.marker.color.flatMap((c, i) => (c === "rgba(0,0,0,0)" ? [i] : []));
    if (clear.join() !== "3") out.push(`Points drawn hollow: ${clear}, not B's at X = 3`);
  }
  const merit = await evalNamedVector(
    `${rFit("one-phase-decay")}\n${R_ROUT_CURVE}\nx<-0:12;y<-${rVec(decayY.map((y, i) => +(i === 3 ? y + 900 : y).toFixed(1)))}\n` +
      `ro<-routOf(x,y,3,0.01);s<-ro$rsdr;cf<-coef(ro$m);f<-function(p)sum(log(1+((y-((p[1]-p[2])*exp(-p[3]*x)+p[2]))/s)^2))\n` +
      `c(at=f(cf[c("Y0","Plateau","K")]),best=optim(cf[c("Y0","Plateau","K")],f,control=list(reltol=1e-14,maxit=5000))$value)`,
  );
  if (merit.at == null || merit.best == null || merit.at - merit.best > 1e-6 * merit.at)
    out.push(`ROUT's robust fit: merit ${merit.at}, optim finds ${merit.best}`);
  // A logistic regression gives the published fit of the shuttle data (logit = 15.043 −
  // 0.232 × temperature), and the graph's S curve is R's own probability.
  const oring = await runAnalysis("logistic-regression", shuttle);
  const [b0, b1] = "error" in oring ? [] : oring.coefficients!.map((c) => c.estimate!);
  if (b0 == null || Math.abs(b0 - 15.0429) > 5e-4 || Math.abs(b1 - -0.232163) > 5e-6)
    out.push(`Logistic regression of the shuttle data: ${b0}, ${b1}, not 15.0429, -0.232163`);
  if (!("error" in oring)) {
    const p = await evalNamedVector(
      `x<-c(53,57,58,63,66,67,67,67,68,69,70,70,70,70,72,73,75,75,76,76,78,79,81);` +
        `y<-c(1,1,1,1,0,0,0,0,0,0,0,1,0,1,0,0,0,1,0,0,0,0,0);m<-glm(y~x,family=binomial);` +
        `c(p=unname(predict(m,data.frame(x=60),type="response")))`,
    );
    if (p.p == null || Math.abs(logisticAt(oring.coefficients!, 60) - p.p) > 1e-9)
      out.push(`Logistic curve at 60 °F: graph ${logisticAt(oring.coefficients!, 60)}, R ${p.p}`);
  }
  // Data sets fitted together are each fitted as alone.
  const together = await runAnalysis("nonlinear-regression", doseTwo, {
    ys: ["Control", "Treated"],
    model: "sigmoidal-4pl-logx",
  });
  const lines = await runAnalysis("linear-regression", xy, { ys: ["Y1", "Y2", "Y3"], forceOrigin: false });
  for (const [i, y] of ["Control", "Treated"].entries()) {
    const alone = await runAnalysis("nonlinear-regression", doseTwo, { y, model: "sigmoidal-4pl-logx" });
    const ec50 = (r: typeof alone, k: number) =>
      "error" in r ? null : r.fit?.rows.find((w) => w.label === "EC50")?.values?.[k];
    if (ec50(together, i) == null || Math.abs(ec50(together, i)! - ec50(alone, 0)!) > 1e-9)
      out.push(`EC50 of ${y} fitted with another: ${ec50(together, i)}, alone ${ec50(alone, 0)}`);
  }
  // A scatter draws each one's curve, as its own fit gives it.
  if (!("error" in together)) {
    const fig: GraphFigure = { data: [], layout: {} };
    const { x: dose, ys: sets } = splitXY(readTable(doseTwo).columns);
    const options = newGraphOptions("xy-scatter");
    addFittedCurves(
      fig,
      dose!,
      ["Control", "Treated"],
      sets,
      "sigmoidal-4pl-logx",
      together,
      true,
      options,
      paintOf(options, 2),
    );
    for (const [i, y] of ["Control", "Treated"].entries()) {
      const alone = await runAnalysis("nonlinear-regression", doseTwo, { y, model: "sigmoidal-4pl-logx" });
      const curve = fig.data[i] as { x: number[]; y: number[] };
      const at = "error" in alone ? NaN : doseCurveAt("sigmoidal-4pl-logx", alone.coefficients!, curve.x[40]);
      if (!(Math.abs(curve.y[40] - at) < 1e-9))
        out.push(`Curve of ${y} drawn with another: ${curve.y[40]}, alone ${at}`);
    }
    const note = (fig.layout.annotations as { text: string }[] | undefined)?.[0]?.text ?? "";
    if (!note.startsWith("Control: EC50 = ") || !note.includes("<br>Treated: EC50 = "))
      out.push(`Two curves' note: ${note}`);
  }
  for (const [i, y] of ["Y1", "Y2", "Y3"].entries()) {
    const alone = await runAnalysis("linear-regression", xy, { y, forceOrigin: false });
    const slope = "error" in alone ? null : alone.stats.find((w) => w.label === "Slope")?.value;
    const many = "error" in lines ? null : lines.fit?.rows[0].values?.[i];
    if (slope == null || many == null || Math.abs(slope - many) > 1e-9)
      out.push(`Slope of ${y} regressed with others: ${many}, alone ${slope}`);
  }
  // With replicates, every replicate is a point of the regression (R's lm on them all), and
  // an area joins each X's mean.
  const reps = splitXY(readTable(xyReps).columns);
  for (const y of reps.ys) {
    const pts = xyPoints(reps.x!, y);
    const r = await runAnalysis("linear-regression", xyReps, { y: y.name, forceOrigin: false });
    const lm = await evalNamedVector(`c(s=unname(coef(lm(${rVec(pts.y)}~${rVec(pts.x)}))[2]))`);
    const slope = "error" in r ? null : r.stats.find((s) => s.label === "Slope")?.value;
    const js = fitLinear(pts.x, pts.y, false);
    if (slope == null || lm.s == null || Math.abs(slope - lm.s) > 1e-9 || Math.abs(js!.slope - lm.s) > 1e-9)
      out.push(`Regression of replicates ${y.name}: Helix ${slope}, graph ${js?.slope}, lm ${lm.s}`);
  }
  const area = await runAnalysis("area-under-curve", xyReps, { baseline: 0 });
  const meansA = await evalNamedVector(
    "x<-c(0,1,2,3,4);y<-c(mean(c(1.1,1.4,0.8)),mean(c(2.9,3.3)),mean(c(5.2,4.8,5.5)),mean(c(6.8,7.4,6.1)),mean(c(9.1,8.6,9.9)));" +
      "c(a=sum(diff(x)*(head(y,-1)+tail(y,-1))/2))",
  );
  const areaA = "error" in area ? null : area.areas?.[0].area;
  if (areaA == null || Math.abs(areaA - meansA.a!) > 1e-9) out.push(`AUC of replicates: ${areaA}, R ${meansA.a}`);
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
  // A graph's 95% CI error bar is R's t.test interval of the mean, half its width.
  for (const c of readTable(column).numeric) {
    const r = await evalNamedVector(`ci<-t.test(${rVec(c.values)})$conf.int;c(h=(ci[2]-ci[1])/2)`);
    if (r.h == null || Math.abs(errorOf(c.values, "ci") - r.h) > 1e-9)
      out.push(`95% CI error bar of ${c.name}: graph ${errorOf(c.values, "ci")}, R ${r.h}`);
  }
  // A box shows R's quartiles (type 6, as Descriptive statistics) and whiskers to the
  // minimum and maximum, on a Column table and at each row of a Grouped one.
  for (const [data, type] of [
    [column, "box-violin"],
    [grouped, "grouped-box"],
  ] as const) {
    const options = { ...newGraphOptions(type), kind: "box" as const };
    const cols = readTable(data).numeric;
    const fig = GRAPHS[type].build(cols, options, paintOf(options, 3));
    const boxes = (
      fig.data as {
        type: string;
        q1: number[];
        median: number[];
        q3: number[];
        lowerfence: number[];
        upperfence: number[];
      }[]
    ).filter((t) => t.type === "box");
    const sets =
      type === "box-violin"
        ? cols.map((c) => c.values)
        : readTable(data).sets.flatMap((s) =>
            data.rows.map((_, r) => s.columns.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]))),
          );
    const drawn = boxes.flatMap((b) =>
      b.q1.map((_, i) => [b.lowerfence[i], b.q1[i], b.median[i], b.q3[i], b.upperfence[i]]),
    );
    const r = await evalNamedVector(
      `S<-list(${sets.map(rVec).join(",")});unlist(lapply(seq_along(S),function(i)setNames(c(min(S[[i]]),quantile(S[[i]],c(0.25,0.5,0.75),type=6,names=FALSE),max(S[[i]])),paste0("b",i,"_",1:5))))`,
    );
    const expected = sets.map((_, i) => [1, 2, 3, 4, 5].map((k) => r[`b${i + 1}_${k}`]));
    if (
      JSON.stringify(drawn.map((b) => b.map((v) => +v.toPrecision(12)))) !==
      JSON.stringify(expected.map((b) => b.map((v) => +v!.toPrecision(12))))
    )
      out.push(`Boxes of ${type}: drawn ${JSON.stringify(drawn)}, R ${JSON.stringify(expected)}`);
  }
  // Descriptive statistics' quartiles are the (n + 1)p method, worked out here by hand;
  // a value at or under 0 leaves no geometric mean.
  const atP = (values: number[], p: number) => {
    const x = [...values].sort((a, b) => a - b);
    const h = Math.min(Math.max((x.length + 1) * p, 1), x.length) - 1;
    return x[Math.floor(h)] + (h - Math.floor(h)) * ((x[Math.ceil(h)] ?? 0) - x[Math.floor(h)]);
  };
  const described = await runAnalysis("descriptive-statistics", column);
  for (const [i, c] of readTable(column).numeric.entries()) {
    const g = "error" in described ? undefined : described.groups[i];
    if (g?.q1 == null || Math.abs(g.q1 - atP(c.values, 0.25)) > 1e-9 || Math.abs(g.q3! - atP(c.values, 0.75)) > 1e-9)
      out.push(`Quartiles of ${c.name}: ${g?.q1}, ${g?.q3}, by hand ${atP(c.values, 0.25)}, ${atP(c.values, 0.75)}`);
  }
  const withZero = await runAnalysis(
    "descriptive-statistics",
    table(
      ["Title", "A"],
      [
        ["", "0"],
        ["", "2"],
      ],
    ),
  );
  if ("error" in withZero || withZero.groups[0].geoMean != null) out.push("A geometric mean with a value of 0");
  // A histogram's bins and counts are R's hist(): its own bins (Sturges, pretty), and a
  // typed width's, with values on the edges, negatives, one value, a wide spread.
  const spreads: [number[], number?][] = [
    ...readTable(column).numeric.map((c): [number[]] => [c.values]),
    [readTable(column).numeric.flatMap((c) => c.values)],
    [[1, 2, 2, 3, 3, 3, 4, 4, 5, 10]],
    [[-3.2, -1, 0, 0.5, 2, 2, 7.25]],
    [[42]],
    [[0.001, 0.0042, 0.013, 0.02, 0.0205]],
    [[120, 3400, 56000, 780000, 1e6]],
    [[1, 2, 2, 3, 3, 3, 4, 4, 5, 10], 2],
    [[-3.2, -1, 0, 0.5, 2, 2, 7.25], 0.5],
  ];
  for (const [values, width] of spreads) {
    const edges = binEdges(values, width);
    const counts = binCounts(values, edges);
    const breaks = width ? `seq(${edges[0]},${edges.at(-1)},by=${width})` : '"Sturges"';
    const r = await evalNamedVector(
      `h<-hist(${rVec(values)},breaks=${breaks},plot=FALSE);c(setNames(h$breaks,paste0("b",seq_along(h$breaks))),setNames(h$counts,paste0("c",seq_along(h$counts))))`,
    );
    const rBreaks = Object.keys(r)
      .filter((k) => k[0] === "b")
      .map((k) => r[k] ?? NaN);
    const rCounts = Object.keys(r)
      .filter((k) => k[0] === "c")
      .map((k) => r[k] ?? NaN);
    if (
      rBreaks.length !== edges.length ||
      rBreaks.some((b, i) => Math.abs(b - edges[i]) > 1e-9 * Math.max(1, Math.abs(b))) ||
      rCounts.join() !== counts.join()
    )
      out.push(`Histogram of ${values.join(",")}: ${edges} / ${counts}, R ${rBreaks} / ${rCounts}`);
  }
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
  // Scheirer-Ray-Hare on an unbalanced table: each H is the Type III sum of squares of the
  // ranks, worked out apart (a Wald form on the sum-contrast fit), over the ranks' variance,
  // the same whatever the factors' order.
  const srh = await runAnalysis("two-way-anova", grouped, {
    design: "nonparametric",
    posthoc: "none",
    posthocTarget: "groups",
  });
  const cells = grouped.rows.flatMap((row) =>
    row.slice(1).flatMap((v, c) => (v == null ? [] : [{ v, g: grouped.columns[c + 1].split(":")[0], r: row[0] }])),
  );
  const ranks = await evalNamedVector(
    `v<-c(${cells.map((c) => c.v).join(",")});g<-factor(c(${cells.map((c) => `"${c.g}"`).join(",")}));` +
      `r<-factor(c(${cells.map((c) => `"${c.r}"`).join(",")}));k<-rank(v);contrasts(g)<-"contr.sum";contrasts(r)<-"contr.sum";` +
      `m<-lm(k~g*r);b<-coef(m);XtXi<-vcov(m)/(deviance(m)/df.residual(m));nm<-names(b);` +
      `ss<-function(i){Lb<-b[i];as.numeric(t(Lb)%*%solve(XtXi[i,i,drop=FALSE])%*%Lb)};` +
      `c(g=ss(grep("^g[0-9]+$",nm))/var(k),r=ss(grep("^r[0-9]+$",nm))/var(k),` +
      `rg=drop1(aov(k~r*g),~.)$"Sum of Sq"[3]/var(k))`,
  );
  const h = (label: string) => ("error" in srh ? null : srh.stats.find((s) => s.label === label)?.value);
  if (
    [h("Group H"), h("Row H")].some((x, i) => x == null || Math.abs(x - [ranks.g!, ranks.r!][i]) > 1e-9) ||
    Math.abs(h("Group H")! - ranks.rg!) > 1e-9
  )
    out.push(
      `Scheirer-Ray-Hare: H ${h("Group H")}, ${h("Row H")}; by hand ${ranks.g}, ${ranks.r}; factors swapped ${ranks.rg}`,
    );
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
    "logistic-growth": logisticGrowth,
    "gompertz-growth": gompertz,
    "one-phase-decay": decay,
    "two-phase-decay": twoPhase,
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
    const pairs = xyPoints(dose!, ys[0]);
    const ss = pairs.x.reduce(
      (sum, x, i) =>
        positiveXOnly(model) && x <= 0 ? sum : sum + (pairs.y[i] - doseCurveAt(model, r.coefficients!, x)) ** 2,
      0,
    );
    const rss = r.fit?.rows.find((row) => row.label === "Sum of squares")?.values?.[0];
    if (rss == null || Math.abs(ss - rss) > 1e-6 * Math.max(1, rss))
      out.push(`${model}: the graph's curve misses R's fit (${ss} vs. ${rss})`);
  }
  // A dose-response curve's ECF: the curve there has come F % of the way from Bottom to Top
  // (an IC: fallen F %), every model; its CI, the delta method's, is what refitting with
  // log EC80 as a parameter gives.
  for (const model of DOSE_MODELS) {
    const data = model === "inhibitor-3pl-logx" ? doseFall : model.endsWith("-x") ? doseRaw : doseLog;
    const r = await runAnalysis("nonlinear-regression", data, { model, ecx: 80 } as AnalysisParams);
    if ("error" in r) {
      out.push(`${model} EC80: ${r.error}`);
      continue;
    }
    const label = model.startsWith("inhibitor") ? "IC80" : "EC80";
    const at = r.fit?.rows.find((row) => row.label === label)?.values?.[0];
    const c = (t: string) => r.coefficients!.find((k) => k.term === t)?.estimate ?? NaN;
    const x = model.endsWith("-logx") ? Math.log10(at ?? NaN) : (at ?? NaN);
    const share = (doseCurveAt(model, r.coefficients!, x) - c("Bottom")) / (c("Top") - c("Bottom"));
    const want = model.startsWith("inhibitor") ? 0.2 : 0.8;
    if (!(Math.abs(share - want) < 1e-9))
      out.push(`${model}: at its ${label} the curve is ${share} of the way, not ${want}`);
  }
  const refit = await evalNamedVector(
    `x<-${rVec(xyPoints(splitXY(readTable(doseLog).columns).x!, splitXY(readTable(doseLog).columns).ys[0]).x)};` +
      `y<-${rVec(xyPoints(splitXY(readTable(doseLog).columns).x!, splitXY(readTable(doseLog).columns).ys[0]).y)};` +
      `m0<-nls(y~Bottom+(Top-Bottom)/(1+10^((LogEC50-x)*HillSlope)),start=list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=1));` +
      `cf<-coef(m0);m<-nls(y~Bottom+(Top-Bottom)/(1+10^((L80-log10(4)/HillSlope-x)*HillSlope)),start=list(Bottom=cf[[1]],Top=cf[[2]],L80=cf[[3]]+log10(4)/cf[[4]],HillSlope=cf[[4]]));` +
      `s<-summary(m)$coefficients;q<-qt(0.975,df.residual(m));c(e=10^s["L80",1],lo=10^(s["L80",1]-q*s["L80",2]),hi=10^(s["L80",1]+q*s["L80",2]))`,
  );
  const ec80 = await runAnalysis("nonlinear-regression", doseLog, {
    model: "sigmoidal-4pl-logx",
    ecx: 80,
  } as AnalysisParams);
  const rows = "error" in ec80 ? [] : (ec80.fit?.rows ?? []);
  const e80 = rows.findIndex((row) => row.label === "EC80");
  const [lo, hi] = rows[e80 + 1]?.ranges?.[0] ?? [null, null];
  for (const [what, ours, theirs] of [
    ["EC80", rows[e80]?.values?.[0], refit.e],
    ["EC80 CI lower", lo, refit.lo],
    ["EC80 CI upper", hi, refit.hi],
  ] as const)
    if (ours == null || theirs == null || Math.abs(ours - theirs) > 1e-5 * Math.abs(theirs))
      out.push(`${what}: delta method ${ours}, refit ${theirs}`);
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
        if (u.y == null || Math.abs(y - u.y) > 1e-6 || Math.abs(10 ** u.x - u.concentration!) > 1e-9 * 10 ** u.x)
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
      const { x: t, y: s } = xyPoints(x!, y);
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
      // The number at risk under the curve, at times between, on and past the subjects'.
      const at = [0, ...t.map((v) => v - 0.5), ...t, Math.max(...t) + 1];
      const n = await evalNamedVector(
        `library(survival);setNames(summary(survfit(Surv(${rVec(t)},${rVec(s)})~1),times=${rVec(at)},extend=TRUE)$n.risk,paste0("n",1:${at.length}))`,
      );
      at.forEach((time, k) => {
        if (atRisk(t, time) !== n[`n${k + 1}`])
          out.push(`Number at risk of ${y.name} at ${time}: ${atRisk(t, time)}, survfit: ${n[`n${k + 1}`]}`);
      });
    }
  }
  // The chi-square for trend is Cochran-Armitage's, written out (scores 1, 2, …); Wilson's
  // CI is prop.test's without continuity correction.
  const ca = await evalNamedVector(
    `x<-c(48,38,5,1,1);n<-x+c(17066,14464,788,126,37);s<-seq_along(x);N<-sum(n);p<-sum(x)/N;` +
      `t<-sum(s*(x-n*p));v<-p*(1-p)*(sum(n*s^2)-sum(n*s)^2/N);w<-prop.test(81,263,correct=FALSE)$conf.int;` +
      `c(chi=t^2/v,p=pchisq(t^2/v,1,lower.tail=FALSE),lo=w[1],hi=w[2])`,
  );
  const trend = await runAnalysis("chi-square", malformation, { test: "trend" } as AnalysisParams);
  const sens = await runAnalysis(
    "chi-square",
    table(
      ["Title", "Present", "Absent"],
      [
        ["+", "81", "5"],
        ["-", "182", "40"],
      ],
    ),
  );
  const statOf = (o: AnalysisOutcome, label: string) =>
    "error" in o ? null : o.stats.find((r) => r.label === label)?.value;
  for (const [what, ours, theirs] of [
    ["chi-square for trend", statOf(trend, "Chi-square for trend"), ca.chi],
    ["its P", statOf(trend, "P value"), ca.p],
    ["Wilson lower", statOf(sens, "Sensitivity 95% CI lower"), ca.lo],
    ["Wilson upper", statOf(sens, "Sensitivity 95% CI upper"), ca.hi],
  ] as const)
    if (ours == null || theirs == null || Math.abs(ours - theirs) > 1e-10 * Math.max(1, Math.abs(theirs)))
      out.push(`Contingency ${what}: ${ours}, by hand ${theirs}`);

  // A two-way ANOVA's Dunnett lies between its uncorrected P (Fisher's LSD) and Bonferroni's
  // over its family; its Games-Howell within a row is the one-way ANOVA's of that row's cells.
  for (const target of ["groups", "rows"] as const) {
    const base = { design: "ordinary", posthocTarget: target };
    const [dun, lsd] = await Promise.all([
      runAnalysis("two-way-anova", grouped, {
        ...base,
        posthoc: "dunnett",
        control: target === "groups" ? "B" : "Day 1",
      } as AnalysisParams),
      runAnalysis("two-way-anova", grouped, { ...base, posthoc: "fisher" } as AnalysisParams),
    ]);
    if ("error" in dun || "error" in lsd) {
      out.push(`Two-way Dunnett (${target}): ${"error" in dun ? dun.error : ""}${"error" in lsd ? lsd.error : ""}`);
      continue;
    }
    const family = (c: { cells?: [{ group: string; row: number }, unknown] }) =>
      target === "groups" ? c.cells![0].row : c.cells![0].group;
    for (const c of dun.comparisons ?? []) {
      const raw = lsd.comparisons!.find(
        (d) => (d.group1 === c.group1 && d.group2 === c.group2) || (d.group1 === c.group2 && d.group2 === c.group1),
      )?.p;
      const m = (dun.comparisons ?? []).filter((d) => family(d) === family(c)).length;
      // Dunnett's integral is 1 − its mass: its P is exact to 1e-10 or so, not finer.
      if (raw == null || c.p == null || c.p < raw - 1e-10 || c.p > Math.min(1, m * raw) + 1e-10)
        out.push(
          `Two-way Dunnett (${target}) ${c.group1} vs. ${c.group2}: P ${c.p}, uncorrected ${raw}, family of ${m}`,
        );
    }
  }
  const gh = await runAnalysis("two-way-anova", grouped, {
    design: "ordinary",
    posthoc: "games-howell",
    posthocTarget: "groups",
  } as AnalysisParams);
  const day1 = table(
    ["Title", "A", "B", "C"],
    [0, 1, 2].map((k) => ["", ...[1, 4, 7].map((c) => grouped.rows[0][c + k] ?? "")]),
  );
  const oneWay = await runAnalysis("anova", day1, { posthoc: "games-howell", equalSd: false } as AnalysisParams);
  if ("error" in gh || "error" in oneWay) out.push("Two-way Games-Howell: an error");
  else
    for (const c of oneWay.comparisons ?? []) {
      const d = gh.comparisons!.find((x) => x.group1 === `${c.group1} (Day 1)` && x.group2 === `${c.group2} (Day 1)`);
      for (const k of ["p", "diff", "low", "high"] as const)
        if (d?.[k] == null || Math.abs(d[k]! - c[k]!) > 1e-8)
          out.push(`Two-way Games-Howell ${c.group1} vs. ${c.group2} (Day 1) ${k}: ${d?.[k]}, one-way ${c[k]}`);
    }

  // The QQ plots' normal quantiles are R's qnorm(ppoints()), i.e. qqnorm's; the residual
  // plot's residuals, lm's.
  {
    const ps = [1e-300, 1e-12, 0.001, 0.02425, 0.1, 0.3, 0.5, 0.7, 0.975, 0.999999, 1 - 1e-12];
    const q = await evalNamedVector(`setNames(qnorm(${rVec(ps)}),paste0("q",1:${ps.length}))`);
    ps.forEach((p, i) => {
      if (Math.abs(qnorm(p) - q[`q${i + 1}`]!) > 1e-12 * Math.max(1, Math.abs(q[`q${i + 1}`]!)))
        out.push(`qnorm(${p}): ${qnorm(p)}, R ${q[`q${i + 1}`]}`);
    });
    for (const n of [5, 10, 11, 40]) {
      const values = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) * 10 + i);
      const r = await evalNamedVector(
        `q<-qqnorm(${rVec(values)},plot.it=FALSE);o<-order(q$y);setNames(q$x[o],paste0("z",1:${n}))`,
      );
      qqPoints(values).z.forEach((z, i) => {
        if (Math.abs(z - r[`z${i + 1}`]!) > 1e-12)
          out.push(`QQ plot of ${n} values, point ${i + 1}: ${z}, qqnorm ${r[`z${i + 1}`]}`);
      });
    }
    for (const data of [xy, xyReps]) {
      const { x, ys } = splitXY(readTable(data).columns);
      const ours = residualsOf(readTable(data).columns);
      for (const set of ys) {
        const pairs = xyPoints(x!, set);
        const r = await evalNamedVector(
          `setNames(resid(lm(y~x,data.frame(x=${rVec(pairs.x)},y=${rVec(pairs.y)}))),paste0("e",1:${pairs.x.length}))`,
        );
        const mine = ours.find((o) => o.name === set.name)?.residuals ?? [];
        pairs.x.forEach((_, k) => {
          if (mine[k] == null || Math.abs(mine[k] - r[`e${k + 1}`]!) > 1e-9 * Math.max(1, Math.abs(r[`e${k + 1}`]!)))
            out.push(`Residual plot of ${set.name}, point ${k + 1}: ${mine[k]}, lm ${r[`e${k + 1}`]}`);
        });
      }
    }
  }

  // The mixed-effects model: on complete subjects, exactly the repeated-measures ANOVA
  // (sphericity assumed) and its Tukey comparisons; with values missing, what REML maximized
  // over the dense covariance and Kenward-Roger written out from the paper give.
  {
    const [mixed, anova] = await Promise.all([
      runAnalysis("rm-anova", matched, { posthoc: "tukey", mixed: true } as AnalysisParams),
      runAnalysis("rm-anova", matched, { posthoc: "tukey", sphericity: true } as AnalysisParams),
    ]);
    if ("error" in mixed || "error" in anova) out.push("Mixed-effects model on complete subjects: an error");
    else {
      const near = (a: number | null | undefined, b: number | null | undefined) =>
        a != null && b != null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
      mixed.stats.slice(0, 4).forEach((r, i) => {
        if (!near(r.value, anova.stats[i].value))
          out.push(`Mixed model, complete subjects, ${r.label}: ${r.value}, RM ANOVA ${anova.stats[i].value}`);
      });
      mixed.comparisons?.forEach((c, i) => {
        const d = anova.comparisons![i];
        if (!near(c.p, d.p) || !near(c.low, d.low) || !near(c.high, d.high) || !near(c.diff, d.diff))
          out.push(
            `Mixed model, complete subjects, ${c.group1} vs. ${c.group2}: ${JSON.stringify(c)} vs. ${JSON.stringify(d)}`,
          );
      });
    }
    const gaps = await runAnalysis("rm-anova", matchedGaps, { posthoc: "tukey", mixed: true } as AnalysisParams);
    const cols = readTable(matchedGaps).columns;
    const cells = matchedGaps.rows.flatMap((_, r) =>
      cols.flatMap((c, j) => (c.byRow[r] == null ? [] : [[c.byRow[r]!, j + 1, r + 1]])),
    );
    const dense = await evalNamedVector(
      `y<-${rVec(cells.map((c) => c[0]))};g<-factor(${rVec(cells.map((c) => c[1]))});s<-factor(${rVec(cells.map((c) => c[2]))});` +
        `X<-model.matrix(~0+g);Z<-model.matrix(~0+s);N<-length(y);p<-ncol(X);G<-list(Z%*%t(Z),diag(N))\n` +
        `Vof<-function(t)t[1]*G[[1]]+t[2]*G[[2]]\n` +
        `nll<-function(lt){V<-Vof(exp(lt));Vi<-solve(V);A<-t(X)%*%Vi%*%X;b<-solve(A,t(X)%*%Vi%*%y);r<-y-X%*%b;` +
        `(as.numeric(determinant(V)$modulus)+as.numeric(determinant(A)$modulus)+drop(t(r)%*%Vi%*%r))/2}\n` +
        `o<-optim(c(0,0),nll,method="BFGS",control=list(reltol=1e-14,maxit=1000));th<-exp(o$par)\n` +
        `V<-Vof(th);Vi<-solve(V);Phi<-solve(t(X)%*%Vi%*%X);beta<-Phi%*%t(X)%*%Vi%*%y\n` +
        `Pm<-Vi-Vi%*%X%*%Phi%*%t(X)%*%Vi;P<-lapply(G,function(Gi)t(X)%*%Vi%*%Gi%*%Vi%*%X)\n` +
        `Q<-lapply(G,function(Gi)lapply(G,function(Gj)t(X)%*%Vi%*%Gi%*%Vi%*%Gj%*%Vi%*%X))\n` +
        `I<-outer(1:2,1:2,Vectorize(function(i,j)sum(diag(Pm%*%G[[i]]%*%Pm%*%G[[j]]))/2));W<-solve(I)\n` +
        `Lam<-Reduce("+",lapply(1:4,function(q){i<-(q-1)%/%2+1;j<-(q-1)%%2+1;W[i,j]*(Q[[i]][[j]]-P[[i]]%*%Phi%*%P[[j]])}));PhiA<-Phi+2*Phi%*%Lam%*%Phi\n` +
        `L<-cbind(-1,diag(p-1));l<-nrow(L);Fv<-drop(t(L%*%beta)%*%solve(L%*%PhiA%*%t(L),L%*%beta))/l\n` +
        `Th<-t(L)%*%solve(L%*%Phi%*%t(L),L);A1<-0;A2<-0\n` +
        `for(i in 1:2)for(j in 1:2){Mi<-Th%*%Phi%*%P[[i]]%*%Phi;Mj<-Th%*%Phi%*%P[[j]]%*%Phi;A1<-A1+W[i,j]*sum(diag(Mi))*sum(diag(Mj));A2<-A2+W[i,j]*sum(diag(Mi%*%Mj))}\n` +
        `B<-(A1+6*A2)/(2*l);g2<-((l+1)*A1-(l+4)*A2)/((l+2)*A2);d<-3*l+2*(1-g2);c1<-g2/d;c2<-(l-g2)/d;c3<-(l+2-g2)/d\n` +
        `E<-1/(1-A2/l);Vs<-2/l*(1+c1*B)/((1-c2*B)^2*(1-c3*B));rho<-Vs/(2*E^2);m<-4+(l+2)/(l*rho-1);lam<-m/(E*(m-2))\n` +
        `c(F=lam*Fv,df=m,sb=sqrt(th[1]),se=sqrt(th[2]),m1=beta[1])`,
    );
    const stat = (label: string) => ("error" in gaps ? null : gaps.stats.find((r) => r.label === label)?.value);
    for (const [label, key] of [
      ["F", "F"],
      ["DFd (Kenward-Roger)", "df"],
      ["SD between subjects", "sb"],
      ["SD within subjects (residual)", "se"],
      ["Model mean (Day 0)", "m1"],
    ] as const) {
      const [ours, theirs] = [stat(label), dense[key]];
      if (ours == null || theirs == null || Math.abs(ours - theirs) > 1e-5 * Math.max(1, Math.abs(theirs)))
        out.push(`Mixed model with gaps, ${label}: ${ours}, dense REML and Kenward-Roger ${theirs}`);
    }
  }

  // A lognormal ANOVA is the ANOVA of the logarithms, its comparisons' differences and CIs
  // made ratios; a lognormal one-sample t test, the t test of the logarithms against log(value).
  const lnColumn = transformTable(column, "column", { from: "t", kind: "ln" });
  for (const posthoc of ["tukey", "dunnett", "t3"] as const) {
    const params = { posthoc, control: "Control", equalSd: posthoc !== "t3" };
    const [log, plain] = await Promise.all([
      runAnalysis("anova", column, { ...params, lognormal: true } as AnalysisParams),
      runAnalysis("anova", lnColumn, params as AnalysisParams),
    ]);
    if ("error" in log || "error" in plain) {
      out.push(
        `Lognormal ANOVA (${posthoc}): ${"error" in log ? log.error : ""}${"error" in plain ? plain.error : ""}`,
      );
      continue;
    }
    const near = (a: number | null | undefined, b: number | null | undefined) =>
      a != null && b != null && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b));
    if (!near(log.stats.find((r) => r.p)?.value, plain.stats.find((r) => r.p)?.value))
      out.push(`Lognormal ANOVA (${posthoc}) P: not the ANOVA of the logarithms'`);
    log.comparisons?.forEach((c, k) => {
      const d = plain.comparisons![k];
      if (
        !near(c.p, d.p) ||
        !near(Math.log(c.diff!), d.diff) ||
        !near(Math.log(c.low!), d.low) ||
        !near(Math.log(c.high!), d.high)
      )
        out.push(
          `Lognormal ANOVA (${posthoc}), ${c.group1} vs. ${c.group2}: ${JSON.stringify(c)} vs. logs ${JSON.stringify(d)}`,
        );
    });
  }
  const [logT, plainT] = await Promise.all([
    runAnalysis("one-sample-t", column, {
      hypotheticalValue: 12,
      tails: "two-sided",
      gaussian: true,
      lognormal: true,
    } as AnalysisParams),
    runAnalysis("one-sample-t", lnColumn, {
      hypotheticalValue: Math.log(12),
      tails: "two-sided",
      gaussian: true,
    } as AnalysisParams),
  ]);
  if (!("error" in logT) && !("error" in plainT))
    for (const label of ["Control — P value", "Low — t"]) {
      // The ln table holds 10 significant digits.
      const [a, b] = [logT, plainT].map((r) => r.stats.find((x) => x.label === label)?.value ?? NaN);
      if (!(Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(b))))
        out.push(`Lognormal one-sample t, ${label}: not the t test of the logarithms'`);
    }

  // A transformed table holds what R computes: logarithms, each data set normalized, a
  // percent of the control's mean (row by row where rows match), z-scores (scale()) within
  // a data set or a row.
  const TRANSFORMED: [string, TableData, TableType, string][] = [
    ["Column", column, "column", "Control"],
    ["Grouped", grouped, "grouped", "B"],
    ["XY", xyReps, "xy", "A"],
    ["Multiple Variables", multiple, "multiple", "Age"],
  ];
  for (const [name, data, type, control] of TRANSFORMED) {
    const t = readTable(data);
    const cols = t.columns.slice(hasXColumn(type) ? 1 : 0);
    const sets = [...new Set(cols.map((c) => c.set ?? c.name))];
    const setOf = rVec(cols.map((c) => sets.indexOf(c.set ?? c.name) + 1));
    const byRow = type === "grouped" || type === "xy";
    const r = await evalNamedVector(
      `M<-matrix(${rVec(cols.flatMap((c) => c.byRow.map((v) => v ?? NaN)))},nrow=${data.rows.length});M[is.nan(M)]<-NA;g<-${setOf};` +
        `pos<-function(f)ifelse(!is.na(M)&M>0,f(pmax(M,1e-300)),NA);each<-function(f){o<-M;for(k in unique(g))o[,g==k]<-f(M[,g==k]);o};` +
        `ct<-M[,g==${sets.indexOf(control) + 1},drop=FALSE];base<-${byRow ? "rowMeans(ct,na.rm=TRUE)" : "mean(ct,na.rm=TRUE)"};` +
        `out<-list(log10=pos(log10),log2=pos(log2),ln=pos(log),` +
        `normalize=each(function(x){r<-range(x,na.rm=TRUE);(x-r[1])/(r[2]-r[1])*100}),pct=M/base*100,` +
        `zset=each(function(x)(x-mean(x,na.rm=TRUE))/sd(as.vector(x),na.rm=TRUE)),` +
        `zrow=t(apply(M,1,function(x)if(sum(!is.na(x))>1)(x-mean(x,na.rm=TRUE))/sd(x,na.rm=TRUE) else NA*x)));` +
        `v<-unlist(lapply(out,as.vector));v[!is.finite(v)]<-NA;setNames(v,paste0(rep(names(out),each=length(M)),"_",seq_along(M)))`,
    );
    const kinds: [string, Omit<Transform, "from">][] = [
      ["log10", { kind: "log10" }],
      ["log2", { kind: "log2" }],
      ["ln", { kind: "ln" }],
      ["normalize", { kind: "normalize" }],
      ["pct", { kind: "percent-of-control", control }],
      ["zset", { kind: "z-score", within: "set" }],
      ["zrow", { kind: "z-score", within: "row" }],
    ];
    for (const [key, how] of kinds) {
      const done = readTable(transformTable(data, type, { from: "t", ...how }));
      const first = data.columns.length - cols.length; // its first transformed column
      cols.forEach((c, j) =>
        c.byRow.forEach((v, row) => {
          if (v == null) return;
          const ours = parseCell(done.columns[first - 1 + j].cells[row]);
          const theirs = r[`${key}_${j * data.rows.length + row + 1}`] ?? null;
          if (
            (ours == null) !== (theirs == null) ||
            (ours != null && Math.abs(ours - theirs!) > 1e-9 * Math.max(1, Math.abs(theirs!)))
          )
            out.push(`${name} ${key}, ${c.name} row ${row + 1}: ${ours}, R: ${theirs}`);
        }),
      );
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
