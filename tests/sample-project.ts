/// <reference types="node" />
// A sample project that exercises everything Helix offers: every table type,
// every analysis and every graph, with realistic (made-up, reproducible) data —
// including a 10,000-gene table for the volcano. `npm run sample` writes it to
// `samples/Helix Sample.hlx`; `npm test` checks that every analysis in it runs.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serializeProjectFile, type ProjectFilePayload } from "../src/lib/project-file";
import { DEFAULT_GRAPH_OPTIONS, type GraphOptions, type GraphType, type ProjectNode, type TableData, type TableType } from "../src/store/types";
import type { AnalysisParams, AnalysisType } from "../src/stats/types";

// ── Reproducible random data ─────────────────────────────────────────────

let seed = 20260924;
/** Uniform in [0, 1) (mulberry32), the same numbers on every run. */
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Normal with mean `m` and standard deviation `sd` (Box-Muller). */
const normal = (m = 0, sd = 1) => m + sd * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
const fixed = (v: number, digits = 2) => v.toFixed(digits);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// ── Project building ─────────────────────────────────────────────────────

const nodes: Record<string, ProjectNode> = {};
const rootOrder: string[] = [];
const childOrder: Record<string, string[]> = {};

function table(id: string, name: string, tableType: TableType, data: TableData) {
  nodes[id] = { id, type: "table", name, parentId: null, tableType, data };
  rootOrder.push(id);
  childOrder[id] = [];
}
function analysis(table: string, id: string, name: string, analysisType: AnalysisType, analysisParams?: AnalysisParams) {
  nodes[id] = { id, type: "analysis", name, parentId: table, analysisType, analysisParams };
  childOrder[table].push(id);
}
function graph(table: string, id: string, name: string, graphType: GraphType, options: Partial<GraphOptions> = {}) {
  nodes[id] = { id, type: "graph", name, parentId: table, graphType, graphOptions: { ...DEFAULT_GRAPH_OPTIONS, ...options } };
  childOrder[table].push(id);
}
/** Rows from columns of values (`null` = empty cell), with optional row titles. */
function rows(columns: (string | null)[][], titles: (string | null)[] = []): (string | null)[][] {
  const height = Math.max(...columns.map((c) => c.length));
  return range(height).map((r) => [titles[r] ?? null, ...columns.map((c) => c[r] ?? null)]);
}

// ── Column tables ────────────────────────────────────────────────────────

{
  const groups = ["Control", "Drug A 10 mg", "Drug A 50 mg", "Drug B"];
  const means = [520, 430, 310, 470];
  const columns: (string | null)[][] = groups.map((_, g) => range(12).map(() => fixed(normal(means[g], 55), 1)));
  columns[0][11] = "1480.0"; // an outlier, excluded below
  columns[3][10] = null; // a missing value
  columns[3][11] = null;
  table("t-tumor", "Tumor volume (mm³)", "column", {
    columns: ["Title", ...groups],
    rows: rows(columns),
    excluded: ["11,1"],
    seriesColors: { "Drug B": "purple" },
    pointColors: { "Drug A 50 mg#2": "green" },
  });
  analysis("t-tumor", "a-tumor-desc", "Descriptive statistics", "descriptive-statistics");
  analysis("t-tumor", "a-tumor-student", "Unpaired t test", "compare-two-groups", {
    paired: false, gaussian: true, equalVariance: true, ratio: false, tails: "two-sided",
  });
  analysis("t-tumor", "a-tumor-t", "Welch's t test", "compare-two-groups", {
    paired: false, gaussian: true, equalVariance: false, ratio: false, tails: "two-sided",
  });
  analysis("t-tumor", "a-tumor-mw", "Mann-Whitney", "compare-two-groups", {
    paired: false, gaussian: false, equalVariance: false, ratio: false, tails: "two-sided",
  });
  analysis("t-tumor", "a-tumor-anova", "One-way ANOVA + Tukey", "anova", { posthoc: "tukey" });
  analysis("t-tumor", "a-tumor-bonf", "One-way ANOVA + Bonferroni", "anova", { posthoc: "bonferroni" });
  analysis("t-tumor", "a-tumor-kw", "Kruskal-Wallis + Dunn", "kruskal-wallis", { posthoc: "dunn" });
  analysis("t-tumor", "a-tumor-one", "Compare to 500 mm³", "one-sample-t", { hypotheticalValue: 500, tails: "two-sided", gaussian: true });
  analysis("t-tumor", "a-tumor-wil", "Wilcoxon vs 500 mm³", "one-sample-t", { hypotheticalValue: 500, tails: "less", gaussian: false });
  analysis("t-tumor", "a-tumor-rout", "Outliers (ROUT, Q = 1%)", "outliers", { q: 1 });
  graph("t-tumor", "g-tumor-dots", "Scatter dot plot + stars", "individual", {
    center: "mean", error: "sd", sigAnalysisId: "a-tumor-anova",
    sigPairs: ["Control\u0000Drug A 50 mg", "Control\u0000Drug A 10 mg", "Drug A 50 mg\u0000Drug B"],
    yLabel: "Tumor volume (mm³)", title: "Tumor volume at day 21",
  });
  graph("t-tumor", "g-tumor-box", "Box plot + P values", "box-violin", {
    kind: "box", showPoints: true, sigAnalysisId: "a-tumor-kw", sigDisplay: "pvalue",
    sigPairs: ["Control\u0000Drug A 50 mg", "Drug A 10 mg\u0000Drug A 50 mg"], yLabel: "Tumor volume (mm³)",
  });
  graph("t-tumor", "g-tumor-violin", "Violin plot", "box-violin", { kind: "violin", showPoints: true, yLabel: "Tumor volume (mm³)" });
  graph("t-tumor", "g-tumor-bars", "Mean ± SEM bars", "mean-error", { shape: "bar", error: "sem", yLabel: "mm³" });
  graph("t-tumor", "g-tumor-pie", "Pie (totals)", "pie");
  graph("t-tumor", "g-tumor-donut", "Donut (means, transparent)", "donut", { pieValue: "mean", background: "transparent" });
}

{
  const times = ["Baseline", "Week 4", "Week 8", "Week 12"];
  const subjects = range(10).map((i) => `Subject ${i + 1}`);
  const base = subjects.map(() => normal(140, 12));
  const columns = times.map((_, t) => base.map((b) => fixed(b - t * 4.5 + normal(0, 4), 1)));
  table("t-bp", "Blood pressure (paired)", "column", { columns: ["Title", ...times], rows: rows(columns, subjects) });
  analysis("t-bp", "a-bp-paired", "Paired t test (Baseline vs Week 4)", "compare-two-groups", {
    paired: true, gaussian: true, equalVariance: true, ratio: false, tails: "two-sided",
  });
  analysis("t-bp", "a-bp-ratio", "Ratio paired t test", "compare-two-groups", {
    paired: true, gaussian: true, equalVariance: true, ratio: true, tails: "two-sided",
  });
  analysis("t-bp", "a-bp-wsr", "Wilcoxon matched pairs", "compare-two-groups", {
    paired: true, gaussian: false, equalVariance: true, ratio: false, tails: "two-sided",
  });
  analysis("t-bp", "a-bp-rm", "Repeated-measures ANOVA + Tukey", "rm-anova", { posthoc: "tukey" });
  analysis("t-bp", "a-bp-fr", "Friedman + Dunn", "friedman", { posthoc: "dunn" });
  graph("t-bp", "g-bp-line", "Mean ± SD over time", "mean-error", { shape: "line", error: "sd", yLabel: "Systolic BP (mmHg)" });
  graph("t-bp", "g-bp-dots", "Individual values", "individual", { bars: true, center: "median", error: "none" });
}

// ── XY tables ────────────────────────────────────────────────────────────

{
  const x = range(11).map((i) => i);
  const series: (string | null)[][] = [2.1, 1.9, 2.3].map((slope) => x.map((xi) => fixed(0.5 + slope * xi + normal(0, 0.6), 2)));
  series[1][4] = null;
  table("t-cal", "Calibration curve", "xy", {
    columns: ["Title", "Concentration (µM)", "Replicate 1", "Replicate 2", "Replicate 3"],
    rows: rows([x.map(String), ...series]),
  });
  analysis("t-cal", "a-cal-lin", "Linear regression", "linear-regression", { y: "Replicate 1", forceOrigin: false });
  analysis("t-cal", "a-cal-lin0", "Linear regression (through origin)", "linear-regression", { y: "Replicate 2", forceOrigin: true });
  analysis("t-cal", "a-cal-cor", "Correlation (X vs every Y)", "correlation", { method: "pearson", mode: "x-vs-every-y" });
  analysis("t-cal", "a-cal-sp", "Spearman (two data sets)", "correlation", { method: "spearman", mode: "two-datasets", datasets: ["Replicate 1", "Replicate 3"] });
  analysis("t-cal", "a-cal-mat", "Correlation matrix of the Y's", "correlation", { method: "pearson", mode: "matrix" });
  analysis("t-cal", "a-cal-auc", "Area under the curve", "area-under-curve", { baseline: 0 });
  analysis("t-cal", "a-cal-quad", "Quadratic fit", "nonlinear-regression", { y: "Replicate 3", model: "quadratic" });
  graph("t-cal", "g-cal-fit", "Scatter + regression line", "xy-scatter", {
    regAnalysisId: "a-cal-lin", xyStyle: "points", xLabel: "Concentration (µM)", yLabel: "Signal",
  });
  graph("t-cal", "g-cal-lines", "Points and lines", "xy-scatter", { xyStyle: "points+line", xLabel: "Concentration (µM)", yLabel: "Signal" });
  graph("t-cal", "g-cal-bar", "XY bars", "xy-bar");
  graph("t-cal", "g-cal-area", "Area", "xy-area");
}

{
  const logDose = range(11).map((i) => -9 + i * 0.5);
  const curve = (x: number, bottom: number, top: number, ec50: number, hill: number) =>
    bottom + (top - bottom) / (1 + 10 ** ((ec50 - x) * hill));
  const a = logDose.map((x) => fixed(curve(x, 3, 97, -6.5, 1.1) + normal(0, 2.5), 1));
  const b = logDose.map((x) => fixed(curve(x, 5, 88, -5.6, 0.9) + normal(0, 2.5), 1));
  table("t-dose", "Dose response", "xy", {
    columns: ["Title", "log[Agonist] (M)", "Compound A", "Compound B"],
    rows: rows([logDose.map((x) => fixed(x, 1)), a, b]),
  });
  analysis("t-dose", "a-dose-4pl", "4PL fit (Compound A)", "nonlinear-regression", { y: "Compound A", model: "sigmoidal-4pl-logx" });
  analysis("t-dose", "a-dose-4plb", "4PL fit (Compound B)", "nonlinear-regression", { y: "Compound B", model: "sigmoidal-4pl-logx" });
  graph("t-dose", "g-dose", "Dose-response curve (A)", "dose-response", {
    doseY: "Compound A", doseModel: "sigmoidal-4pl-logx", xLabel: "log[Agonist] (M)", yLabel: "Response (%)", title: "Compound A",
  });
  graph("t-dose", "g-dose-b", "Dose-response curve (B)", "dose-response", {
    doseY: "Compound B", doseModel: "sigmoidal-4pl-logx", xLabel: "log[Agonist] (M)", yLabel: "Response (%)", title: "Compound B",
  });
}

{
  const conc = [0.5, 1, 2, 4, 8, 16, 32, 64, 128];
  const binding = (bmax: number, kd: number) => conc.map((x) => fixed(Math.max(0, (bmax * x) / (kd + x) + normal(0, bmax * 0.03)), 1));
  table("t-bind", "Receptor binding", "xy", {
    columns: ["Title", "Ligand (nM)", "Wild type", "Mutant"],
    rows: rows([conc.map(String), binding(1200, 6), binding(700, 18)]),
  });
  analysis("t-bind", "a-bind-wt", "One-site binding (wild type)", "nonlinear-regression", { y: "Wild type", model: "hyperbola" });
  analysis("t-bind", "a-bind-mut", "One-site binding (mutant)", "nonlinear-regression", { y: "Mutant", model: "hyperbola" });
  graph("t-bind", "g-bind", "Saturation curves", "xy-scatter", {
    xyStyle: "points+line", xLabel: "Ligand (nM)", yLabel: "Specific binding (fmol/mg)",
  });
}

{
  // One row per mouse: the day it died (1) or left the study alive (0, censored).
  const arms = ["Placebo", "Drug A", "Drug A + B"];
  const raw = arms.flatMap((_, g) =>
    range(25).map(() => {
      const time = Math.round(-Math.log(1 - random()) * [25, 50, 110][g]) + 1;
      return { group: g, time: Math.min(time, 90), event: time >= 90 || random() < 0.15 ? 0 : 1 };
    }),
  );
  table("t-surv", "Survival", "xy", {
    columns: ["Title", "Days", ...arms],
    rows: raw.map((s) => [null, String(s.time), ...arms.map((_, g) => (s.group === g ? String(s.event) : null))]),
  });
  graph("t-surv", "g-surv", "Kaplan-Meier curves", "survival", {
    survivalMode: "codes", xLabel: "Days", yLabel: "Percent survival", title: "Survival after treatment",
  });
}

// ── Grouped tables ───────────────────────────────────────────────────────

/** A grouped table: `values[g][r][k]` is replicate k of group g at row r. */
function groupedData(groups: string[], titles: string[], values: (string | null)[][][]): TableData {
  const replicates = values[0][0].length;
  const columns = ["Title", ...groups.flatMap((g) => range(replicates).map((k) => `${g}:Y${k + 1}`))];
  const body = titles.map((title, r) => [title, ...groups.flatMap((_, g) => values[g][r])]);
  return { columns, rows: body, groups: groups.length, replicates };
}

{
  const groups = ["Vehicle", "LPS", "LPS + Drug"];
  const titles = ["0 h", "2 h", "6 h", "12 h", "24 h"];
  const shape = [
    [20, 22, 21, 20, 19],
    [20, 180, 420, 260, 90],
    [20, 110, 210, 130, 50],
  ];
  const values: (string | null)[][][] = shape.map((means) => means.map((m) => range(4).map(() => fixed(Math.max(1, normal(m, m * 0.12)), 1))));
  values[2][3][1] = null;
  table("t-cyto", "IL-6 (pg/mL)", "grouped", groupedData(groups, titles, values));
  analysis("t-cyto", "a-cyto-2w", "Two-way ANOVA + Tukey (groups per row)", "two-way-anova", { design: "ordinary", posthoc: "tukey", posthocTarget: "groups" });
  analysis("t-cyto", "a-cyto-2wb", "Two-way ANOVA + Bonferroni (rows per group)", "two-way-anova", { design: "ordinary", posthoc: "bonferroni", posthocTarget: "rows" });
  analysis("t-cyto", "a-cyto-rm", "Two-way RM ANOVA", "two-way-anova", { design: "repeated-measures", posthoc: "none", posthocTarget: "groups" });
  analysis("t-cyto", "a-cyto-srh", "Scheirer-Ray-Hare", "two-way-anova", { design: "nonparametric", posthoc: "none", posthocTarget: "groups" });
  graph("t-cyto", "g-cyto-bars", "Interleaved bars", "grouped-bars", { yLabel: "IL-6 (pg/mL)" });
  graph("t-cyto", "g-cyto-sep", "Separated bars", "grouped-bars", { groupLayout: "separated" });
  graph("t-cyto", "g-cyto-dots", "Interleaved scatter", "grouped-scatter");
  graph("t-cyto", "g-cyto-lines", "Time course", "grouped-lines", { xLabel: "Time", yLabel: "IL-6 (pg/mL)" });
  graph("t-cyto", "g-cyto-stack", "Stacked bars", "grouped-stacked");
  graph("t-cyto", "g-cyto-h", "Horizontal bars", "grouped-hbars", { center: "median" });
}

{
  const genes = ["GAPDH", "ACTB", "IL6", "TNF", "CXCL8", "IL1B", "CCL2", "PTGS2", "NFKBIA", "SOCS3", "HMOX1", "MKI67", "CDKN1A", "BAX", "BCL2", "VEGFA", "HIF1A", "MYC", "FOS", "JUN"];
  const fold = genes.map((_, i) => (i < 2 ? 1 : i < 12 ? 2 ** normal(1.6, 0.6) : 2 ** normal(0, 0.3)));
  const values = [1, 0].map((treated) =>
    genes.map((_, r) => range(3).map(() => fixed(Math.max(0.05, normal(treated ? fold[r] : 1, 0.15)), 3))),
  );
  table("t-qpcr", "qPCR panel (fold change)", "grouped", groupedData(["Stimulated", "Control"], genes, values));
  analysis("t-qpcr", "a-qpcr-mt", "Multiple t tests (Welch, Holm)", "multiple-t-tests", { paired: false, gaussian: true, pooledSd: false, correction: "holm" });
  analysis("t-qpcr", "a-qpcr-mtp", "Multiple t tests (pooled SD, FDR)", "multiple-t-tests", { paired: false, gaussian: true, pooledSd: true, correction: "fdr" });
  analysis("t-qpcr", "a-qpcr-mw", "Multiple Mann-Whitney", "multiple-t-tests", { paired: false, gaussian: false, pooledSd: false, correction: "none" });
  graph("t-qpcr", "g-qpcr", "Fold change per gene", "grouped-bars", { yLabel: "Fold change" });
}

{
  const known = ["TP53", "MYC", "EGFR", "KRAS", "BRCA1", "IL6", "TNF", "CXCL8", "VEGFA", "CDKN1A", "MDM2", "GADD45A", "SESN1", "FAS", "BBC3", "PMAIP1", "TP53I3", "RRM2B", "ZMAT3", "TNFRSF10B"];
  const titles = range(10000).map((i) => known[i] ?? `GENE${String(i + 1).padStart(5, "0")}`);
  const values: (string | null)[][][] = [[], []];
  for (let r = 0; r < titles.length; r++) {
    const expression = Math.exp(normal(5, 1.6));
    // ~8% of genes change: the known ones first, then scattered others.
    const changed = r < known.length || random() < 0.08;
    const logFold = changed ? (random() < 0.6 ? 1 : -1) * Math.abs(normal(1.8, 0.8)) : normal(0, 0.12);
    const level = (g: number) => expression * (g === 1 ? 2 ** logFold : 1);
    for (const g of [0, 1]) values[g].push(range(4).map(() => fixed(Math.max(0.01, level(g) * (1 + normal(0, 0.1))), 2)));
  }
  table("t-rnaseq", "RNA-seq, 10,000 genes", "grouped", groupedData(["Control", "Treated"], titles, values));
  graph("t-rnaseq", "g-rnaseq-volcano", "Volcano plot (Helix computes the DEGs)", "volcano", {
    volcanoGroupA: "Control", volcanoGroupB: "Treated", volcanoEffect: "log2ratio", volcanoSignificance: "fdr",
    volcanoPThreshold: 1.3, volcanoLabelCount: 15, title: "Treated vs Control",
  });
}

// ── Multiple Variables tables ────────────────────────────────────────────

{
  const patients = range(60).map(() => {
    const age = normal(55, 12);
    const bmi = normal(26, 4);
    const glucose = 70 + 0.6 * bmi + 0.2 * age + normal(0, 8);
    const cholesterol = 150 + 0.8 * age + normal(0, 25);
    const bp = 90 + 0.5 * age + 1.1 * bmi + 0.05 * cholesterol + normal(0, 8);
    return [age, bmi, bp, cholesterol, glucose].map((v) => fixed(v, 1));
  });
  const names = ["Age", "BMI", "Systolic BP", "Cholesterol", "Glucose"];
  table("t-pat", "Patient characteristics", "multiple", {
    columns: ["Title", ...names],
    rows: patients.map((p, i) => [`P${String(i + 1).padStart(2, "0")}`, ...p]),
  });
  analysis("t-pat", "a-pat-cor", "Correlation matrix (Pearson)", "correlation-matrix", { method: "pearson" });
  analysis("t-pat", "a-pat-sp", "Correlation matrix (Spearman)", "correlation-matrix", { method: "spearman" });
  analysis("t-pat", "a-pat-reg", "Multiple regression (Systolic BP)", "multiple-regression", { dependent: "Systolic BP", predictors: ["Age", "BMI", "Cholesterol"] });
  graph("t-pat", "g-pat-heat", "Heatmap", "heatmap", { heatmapColorScale: "red-blue" });
}

{
  const rowsDE: (string | null)[][] = [];
  const results = range(2000).map((i) => {
    const changed = random() < 0.1;
    const log2FC = changed ? (random() < 0.5 ? -1 : 1) * Math.abs(normal(2, 0.8)) : normal(0, 0.35);
    const p = changed ? 10 ** -(1.5 + random() * 8) : random();
    return { gene: `GENE${String(i + 1).padStart(4, "0")}`, log2FC, p };
  });
  // Benjamini-Hochberg adjusted P values, as a DE tool would export them.
  const order = range(results.length).sort((a, b) => results[a].p - results[b].p);
  const adjusted: number[] = [];
  let running = 1;
  for (let k = order.length - 1; k >= 0; k--) {
    running = Math.min(running, (results[order[k]].p * order.length) / (k + 1));
    adjusted[order[k]] = running;
  }
  results.forEach((r, i) => rowsDE.push([null, r.gene, fixed(r.log2FC, 3), r.p.toExponential(3), adjusted[i].toExponential(3)]));
  table("t-de", "DE results (from another tool)", "multiple", {
    columns: ["Title", "Gene", "log2 fold change", "P value", "Adjusted P"],
    rows: rowsDE,
  });
  graph("t-de", "g-de-volcano", "Volcano plot (your columns)", "volcano", {
    volcanoX: "log2 fold change", volcanoY: "Adjusted P", volcanoLabel: "Gene", volcanoLabelCount: 10,
  });
}

// ── Contingency tables ───────────────────────────────────────────────────

table("t-resp", "Treatment response", "contingency", {
  columns: ["Title", "Responded", "Did not respond"],
  rows: [["Drug", "34", "16"], ["Placebo", "18", "32"]],
});
analysis("t-resp", "a-resp-fisher", "Fisher's exact test", "chi-square");
graph("t-resp", "g-resp-stack", "Stacked bars", "grouped-stacked", { yLabel: "Patients" });
graph("t-resp", "g-resp-bars", "Interleaved bars", "grouped-bars");

table("t-blood", "Blood type by region", "contingency", {
  columns: ["Title", ...["O", "A", "B", "AB"]],
  rows: [["North", "45", "40", "11", "4"], ["South", "52", "31", "13", "4"], ["East", "38", "35", "20", "7"]],
});
analysis("t-blood", "a-blood-chi", "Chi-square test", "chi-square");
graph("t-blood", "g-blood-bars", "Interleaved bars", "grouped-bars", { xLabel: "Region", yLabel: "People" });
graph("t-blood", "g-blood-h", "Horizontal bars", "grouped-hbars");

// ── Output ───────────────────────────────────────────────────────────────

export const sampleProject: ProjectFilePayload = { nodes, rootOrder, childOrder, activeNodeId: "g-tumor-dots" };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = new URL("../samples/", import.meta.url);
  mkdirSync(folder, { recursive: true });
  writeFileSync(new URL("Helix Sample.hlx", folder), serializeProjectFile(sampleProject));
  const count = (type: string) => Object.values(nodes).filter((n) => n.type === type).length;
  console.log(`samples/Helix Sample.hlx: ${count("table")} tables, ${count("analysis")} analyses, ${count("graph")} graphs.`);
}
