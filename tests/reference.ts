// Reference test for the three engines: runs every analysis and draws every graph
// on fixed tables, then compares the results with `reference.json`. A change in
// any number shows up as a diff. `npm test` checks; `npm test -- --update` rewrites
// the reference after an intended change. It also checks that the engines agree
// where they compute the same thing twice (a graph's regression line and R's).
/// <reference types="node" />
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startR } from "../src/stats/webr";
import { runAnalysis } from "../src/stats";
import type { AnalysisParams, AnalysisType } from "../src/stats/types";
import { DEFAULT_GRAPH_OPTIONS, type GraphOptions, type GraphType, type TableData } from "../src/store/types";
import { GRAPHS, plotColumns } from "../src/views/graphs";
import { pairUp, readTable, splitXY } from "../src/lib/dataset";
import { countDataColumns, countDataGroups } from "../src/views/analyses";
import { fitLinear } from "../src/views/graphs/regression-overlay";
import { computeGroupedDEG } from "../src/lib/deg";
import { tCrit95 } from "../src/lib/student-t";
import { evalNamedVector } from "../src/stats/webr";
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

const contingency2 = table(["Title", "Outcome A", "Outcome B"], [["Drug", "15", "5"], ["Placebo", "6", "14"]]);
const contingency3 = table(
  ["Title", "Outcome A", "Outcome B", "Outcome C"],
  [["North", "20", "15", "10"], ["South", "12", "18", "25"], ["East", "14", "16", "15"]],
);

/** As the app creates them: many columns, only the first ones filled. */
const wide = (t: TableData, width: number): TableData => ({
  ...t,
  columns: [...t.columns, ...Array.from({ length: width }, (_, i) => `Extra ${i + 1}`)],
});
const contingencyWide = wide(contingency2, 13);
/** An XY table whose X column is still empty. */
const xyNoX = table(["Title", "X", "Y1", "Y2"], [["", "", "1", "2"], ["", "", "3", "5"], ["", "", "4", "4"], ["", "", "6", "9"]]);

// ── What to run ──────────────────────────────────────────────────────────

const ANALYSES: [string, TableData, AnalysisType, AnalysisParams?][] = [
  ["column", column, "descriptive-statistics"],
  ["column", column, "compare-two-groups", { paired: false, gaussian: true, equalVariance: false, ratio: false, tails: "two-sided" }],
  ["column", column, "compare-two-groups", { paired: false, gaussian: true, equalVariance: true, ratio: false, tails: "less" }],
  ["column", column, "compare-two-groups", { paired: true, gaussian: true, equalVariance: false, ratio: false, tails: "two-sided" }],
  ["column", column, "compare-two-groups", { paired: true, gaussian: true, equalVariance: false, ratio: true, tails: "two-sided" }],
  ["column", column, "compare-two-groups", { paired: false, gaussian: false, equalVariance: false, ratio: false, tails: "two-sided" }],
  ["column", column, "compare-two-groups", { paired: true, gaussian: false, equalVariance: false, ratio: false, tails: "greater" }],
  ["column", column, "one-sample-t", { hypotheticalValue: 12, tails: "two-sided", gaussian: true }],
  ["column", column, "one-sample-t", { hypotheticalValue: 12, tails: "two-sided", gaussian: false }],
  ["column", column, "anova", { posthoc: "none" }],
  ["column", column, "anova", { posthoc: "tukey" }],
  ["column", column, "anova", { posthoc: "bonferroni" }],
  ["column", column, "kruskal-wallis", { posthoc: "dunn" }],
  ["column", column, "rm-anova"],
  ["column", column, "rm-anova", { posthoc: "tukey" }],
  ["column", column, "rm-anova", { posthoc: "bonferroni" }],
  ["column", column, "friedman", { posthoc: "dunn" }],
  ["column", column, "shapiro-wilk"],
  ["column", column, "outliers", { q: 1 }],
  ["column", column, "outliers", { q: 5 }],
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
  ["grouped", grouped, "two-way-anova", { design: "ordinary", posthoc: "none", posthocTarget: "groups" }],
  ["grouped", grouped, "two-way-anova", { design: "ordinary", posthoc: "tukey", posthocTarget: "groups" }],
  ["grouped", grouped, "two-way-anova", { design: "ordinary", posthoc: "bonferroni", posthocTarget: "rows" }],
  ["grouped", grouped, "two-way-anova", { design: "repeated-measures", posthoc: "tukey", posthocTarget: "groups" }],
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
  ["contingency2", contingency2, "chi-square"],
  ["contingency3", contingency3, "chi-square"],
  ["contingencyWide", contingencyWide, "chi-square"],
  ["xyNoX", xyNoX, "linear-regression", { forceOrigin: false }],
  ["xyNoX", xyNoX, "correlation", { method: "pearson", mode: "x-vs-every-y" }],
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
  ["doseLog", doseLog, "dose-response"],
  ["survival", survivalTable, "survival"],
  ["grouped", grouped, "grouped-scatter"],
  ["grouped", grouped, "grouped-bars", { groupLayout: "separated" }],
  ["grouped", grouped, "grouped-lines"],
  ["grouped", grouped, "grouped-stacked"],
  ["grouped", grouped, "grouped-hbars", { center: "median" }],
  ["multiple", multiple, "heatmap"],
  ["volcano", volcanoTable, "volcano", volcano],
  ["contingency2", contingency2, "grouped-stacked"],
  ["xyNoX", xyNoX, "xy-scatter"],
];

// ── Run and compare ──────────────────────────────────────────────────────

/** Rounds every number to 10 significant digits, so the reference ignores float noise. */
const rounded = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "number" ? Number(v.toPrecision(10)) : v)));

async function run() {
  await startR(fileURLToPath(new URL("../node_modules/webr/dist/", import.meta.url)));
  const out: Record<string, unknown> = {};
  for (const [name, data, type, params] of ANALYSES) {
    out[`${type} ${name} ${JSON.stringify(params ?? {})}`] = await runAnalysis(type, data, params);
  }
  for (const [name, data, type, options] of GRAPH_CASES) {
    const opts = { ...DEFAULT_GRAPH_OPTIONS, ...options };
    out[`graph ${type} ${name}`] = GRAPHS[type].build(plotColumns(readTable(data), type), opts, { Low: "red" }, { "Control#1": "green" }, readTable(data).titles);
  }
  for (const [name, data] of Object.entries({ column, xy, grouped, twoGroups, multiple })) {
    out[`counts ${name}`] = { columns: countDataColumns(data), groups: countDataGroups(data) };
  }
  return rounded(out) as Record<string, unknown>;
}

/** Where TypeScript computes what R also computes, both must agree: a graph's
 *  regression line, the volcano's per-row P values, the regression band's t. */
async function disagreements(): Promise<string[]> {
  const { x, ys } = splitXY(readTable(xy).columns);
  const out: string[] = [];
  for (const y of ys) {
    for (const forceOrigin of [false, true]) {
      const r = await runAnalysis("linear-regression", xy, { y: y.name, forceOrigin });
      const pairs = pairUp(x!, y);
      const js = fitLinear(pairs.x, pairs.y, forceOrigin);
      const rSlope = "error" in r ? null : r.stats.find((s) => s.label === "Slope")?.value;
      if (rSlope == null || js == null || Math.abs(rSlope - js.slope) > 1e-9)
        out.push(`Regression of ${y.name}${forceOrigin ? " through the origin" : ""}: graph slope ${js?.slope}, R slope ${rSlope}`);
    }
  }
  const tests = await runAnalysis("multiple-t-tests", twoGroups, { paired: false, gaussian: true, pooledSd: false, correction: "none" });
  const volcano = computeGroupedDEG(twoGroups, "A", "B", "difference");
  for (const row of volcano) {
    const p = "error" in tests ? null : tests.comparisons?.find((c) => c.group1 === row.label)?.p;
    if (p == null || Math.abs(p - row.p) > 1e-9) out.push(`Volcano P for ${row.label}: ${row.p}, multiple t tests: ${p}`);
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
  const q = await evalNamedVector("c(a=qt(0.975,3),b=qt(0.975,10),c=qt(0.975,50))");
  for (const [key, df] of [["a", 3], ["b", 10], ["c", 50]] as const) {
    if (Math.abs(tCrit95(df) - q[key]!) > 1e-9) out.push(`t critical value, df ${df}: ${tCrit95(df)}, R: ${q[key]}`);
  }
  return out;
}

const file = new URL("reference.json", import.meta.url);
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
      const fig = GRAPHS[node.graphType!].build(plotColumns(readTable(data!), node.graphType!), node.graphOptions!, data!.seriesColors, data!.pointColors, readTable(data!).titles);
      if (!fig.data.length) out.push(`Sample graph “${node.name}” draws nothing.`);
    }
  }
  return out;
}

const actual = await run();
const disagree = [...(await disagreements()), ...(await sampleFailures())];
for (const d of disagree) console.log(`✗ Engines disagree. ${d}`);
if (process.argv.includes("--update")) {
  writeFileSync(file, JSON.stringify(actual, null, 1) + "\n");
  console.log(`Reference updated: ${Object.keys(actual).length} results.`);
} else {
  const expected = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const changed = [...keys].filter((k) => JSON.stringify(expected[k]) !== JSON.stringify(actual[k]));
  for (const k of changed) console.log(`✗ ${k}\n  was: ${JSON.stringify(expected[k])}\n  now: ${JSON.stringify(actual[k])}`);
  console.log(changed.length ? `${changed.length} of ${keys.size} results changed.` : `All ${keys.size} results match.`);
  process.exitCode = changed.length || disagree.length ? 1 : 0;
}
process.exit();
