/// <reference types="node" />
// The sample project: HLX-101, a made-up compound against pancreatic cancer, told as a
// paper's figures are, in the sidebar's order: cells, then mice, then omics, then
// patients. Every table type, each with the test its data call for and graphs drawn as
// they would be published (one color per treatment arm throughout), on realistic data
// drawn from a fixed seed. Every variant of every test is checked by the reference tests,
// not here. `npm run sample` writes it to `samples/Helix Sample.hlx`; `npm test` checks
// that every analysis in it runs and every graph draws.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serializeProjectFile, type ProjectFilePayload } from "../src/lib/project-file";
import type { GraphOptions, GraphType, ProjectNode, TableData, TableType } from "../src/store/types";
import { newGraphOptions } from "../src/views/graphs";
import { paletteNamed, savedPalette, reversedPalette } from "../src/lib/palettes";
import { pairKey, pointKeyOf } from "../src/lib/columns";
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
function analysis(
  table: string,
  id: string,
  name: string,
  analysisType: AnalysisType,
  analysisParams?: AnalysisParams,
) {
  nodes[id] = { id, type: "analysis", name, parentId: table, analysisType, analysisParams };
  childOrder[table].push(id);
}
function graph(table: string, id: string, name: string, graphType: GraphType, options: Partial<GraphOptions> = {}) {
  nodes[id] = {
    id,
    type: "graph",
    name,
    parentId: table,
    graphType,
    graphOptions: { ...newGraphOptions(graphType), ...options },
  };
  childOrder[table].push(id);
}
/** The options of a graph taking another palette than its type's. */
const palette = (name: string) => ({ palette: savedPalette(paletteNamed(name)!) });
/** Rows from columns of values (`null` = empty cell), with optional row titles. */
function rows(columns: (string | null)[][], titles: (string | null)[] = []): (string | null)[][] {
  const height = Math.max(...columns.map((c) => c.length));
  return range(height).map((r) => [titles[r] ?? null, ...columns.map((c) => c[r] ?? null)]);
}
/** A grouped table: `values[g][r][k]` is replicate k of group g at row r. */
function groupedData(groups: string[], titles: string[], values: (string | null)[][][]): TableData {
  const replicates = values[0][0].length;
  const columns = ["Title", ...groups.flatMap((g) => range(replicates).map((k) => `${g}:Y${k + 1}`))];
  const body = titles.map((title, r) => [title, ...groups.flatMap((_, g) => values[g][r])]);
  return { columns, rows: body, groups: groups.length, replicates };
}

// The treatment arms, one color each in every graph, from Paul Tol's palette (made for
// papers, distinct to color-blind eyes too): gray for the control, blues for HLX-101
// (darker, the higher dose), red for gemcitabine, purple for both.
const VEHICLE = "Vehicle";
const LOW = "HLX-101 10 mg/kg";
const HIGH = "HLX-101 30 mg/kg";
const GEM = "Gemcitabine";
const DRUG = "HLX-101";
const COMBO = "HLX-101 + Gem";
const PLACEBO = "Placebo";
const ARM_COLORS: Record<string, string> = {
  [VEHICLE]: "#BBBBBB",
  [PLACEBO]: "#BBBBBB",
  [LOW]: "#66CCEE",
  [HIGH]: "#4477AA",
  [DRUG]: "#4477AA",
  [GEM]: "#EE6677",
  [COMBO]: "#AA3377",
};
/** Points a little larger than a new graph's, to read at a glance. */
const POINTS = { pointSize: 9 };
/** The arms' colors, for a graph of these series. */
const arms = (...names: string[]) => ({
  series: Object.fromEntries(names.map((n) => [n, { color: ARM_COLORS[n] }])),
});

// ── 1. Cells ─────────────────────────────────────────────────────────────

{
  const logDose = range(11).map((i) => -9 + i * 0.5);
  // Viability falls from 100% to its floor as the dose rises.
  const viability = (ec50: number, hill: number, floor: number) =>
    logDose.map((x) => fixed(floor + (100 - floor) / (1 + 10 ** ((x - ec50) * hill)) + normal(0, 2.5), 1));
  table("t-viab", "Cell viability (%)", "xy", {
    columns: ["Title", "log[HLX-101] (M)", "MIA PaCa-2", "BxPC-3"],
    rows: rows([logDose.map((x) => fixed(x, 1)), viability(-6.8, 1.1, 4), viability(-5.4, 0.9, 12)]),
  });
  analysis("t-viab", "a-viab-fit", "4PL fit (MIA PaCa-2)", "nonlinear-regression", {
    y: "MIA PaCa-2",
    model: "sigmoidal-4pl-logx",
  });
  // Their IC50s compared on a standard slope: a 4PL's slopes, free, leave no fit sharing one.
  analysis("t-viab", "a-viab-cmp", "IC50: MIA PaCa-2 vs. BxPC-3", "nonlinear-regression", {
    y: "MIA PaCa-2",
    model: "inhibitor-3pl-logx",
    compareWith: "BxPC-3",
    compare: "ec50",
  });
  graph("t-viab", "g-viab", "Dose-response curve", "xy-scatter", {
    regAnalysisId: "a-viab-fit",
    ...POINTS,
    xLabel: "log[HLX-101] (M)",
    yLabel: "Cell viability (%)",
    legend: { x: 0.72, y: 0.98 },
    note: { x: 10, y: 250 }, // its EC50, where the points aren't
  });
}

{
  table("t-kinase", "Kinase activity", "xy", {
    columns: ["Title", "ATP (µM)", "Rate (nmol/min)"],
    rows: rows([
      ["0.5", "1", "2", "5", "10", "20", "50"],
      ["9.8", "17.1", "27.9", "44.2", "55.9", "63.1", "70.4"],
    ]),
  });
  analysis("t-kinase", "a-kinase", "Michaelis-Menten", "nonlinear-regression", { model: "michaelis-menten" });
  graph("t-kinase", "g-kinase", "Michaelis-Menten", "xy-scatter", {
    regAnalysisId: "a-kinase",
    ...POINTS,
    xLabel: "ATP (µM)",
    yLabel: "Rate (nmol/min)",
    note: { x: 280, y: 180 },
  });
}

// ── 2. Mice ──────────────────────────────────────────────────────────────

{
  const days = [0, 3, 7, 10, 14, 17, 21, 24, 28];
  const growth = (rate: number) => days.map((d) => fixed(110 * Math.exp(rate * d) * (1 + normal(0, 0.05)), 0));
  table("t-growth", "Tumor growth (mm³)", "xy", {
    columns: ["Title", "Day", VEHICLE, LOW, HIGH],
    rows: rows([days.map(String), growth(0.088), growth(0.071), growth(0.05)]),
  });
  analysis("t-growth", "a-growth-exp", "Exponential growth (vehicle)", "nonlinear-regression", {
    y: VEHICLE,
    model: "exponential-growth",
  });
  analysis("t-growth", "a-growth-auc", "Area under the curve", "area-under-curve", { baseline: 0 });
  graph("t-growth", "g-growth", "Growth curves", "xy-scatter", {
    xyStyle: "points+line",
    xLabel: "Days after the first dose",
    yLabel: "Mean tumor volume (mm³)",
    ...arms(VEHICLE, LOW, HIGH),
    ...POINTS,
    legend: { x: 0.04, y: 0.98 },
  });
}

{
  const groups = [VEHICLE, LOW, HIGH, GEM];
  const means = [1180, 820, 460, 690];
  const columns = means.map((m) => range(10).map(() => fixed(normal(m, m * 0.15), 0)));
  columns[0][6] = "2950"; // Mouse 7: an outlier, which ROUT finds
  columns[1][3] = "86"; // a caliper error, excluded
  table("t-volume", "Tumor volume, day 21 (mm³)", "column", {
    columns: ["Title", ...groups],
    rows: rows(
      columns,
      range(10).map((i) => `Mouse ${i + 1}`),
    ),
    excluded: ["3,2"],
  });
  // Each treatment against the vehicle: Dunnett's test, not every pair.
  analysis("t-volume", "a-volume", "One-way ANOVA + Dunnett (vs. vehicle)", "anova", {
    posthoc: "dunnett",
    equalSd: true,
    control: VEHICLE,
  });
  analysis("t-volume", "a-volume-rout", "Outliers (ROUT, Q = 1%)", "outliers", { q: 1 });
  graph("t-volume", "g-volume-dots", "Scatter dot plot", "individual", {
    yLabel: "Tumor volume at day 21 (mm³)",
    sigAnalysisId: "a-volume",
    // Each treatment against the vehicle, as Dunnett's test names them.
    sigPairs: [pairKey(LOW, VEHICLE), pairKey(HIGH, VEHICLE), pairKey(GEM, VEHICLE)],
    ...arms(...groups),
    ...POINTS,
    // Mouse 7, the outlier, stands out with its name, set apart.
    points: {
      [pointKeyOf(VEHICLE, 6)]: {
        size: 12,
        shape: "diamond",
        outlineColor: "#000000",
        label: true,
        labelOffset: { x: 80, y: 0 },
      },
    },
  });
  // The figure most papers show: bars at the mean, the mice over them, the doses hatched.
  graph("t-volume", "g-volume-bars", "Bars and points", "individual", {
    bars: true,
    fill: 0.6,
    error: "sem",
    errorColor: "#000000",
    outlineColor: "#000000",
    yLabel: "Tumor volume at day 21 (mm³)",
    sigAnalysisId: "a-volume",
    sigPairs: [pairKey(HIGH, VEHICLE)],
    ...POINTS,
    series: {
      ...arms(...groups).series,
      [LOW]: { color: ARM_COLORS[LOW], pattern: "diagonal" },
      [HIGH]: { color: ARM_COLORS[HIGH], pattern: "crosshatch" },
    },
  });
  graph("t-volume", "g-volume-violin", "Violin plot", "box-violin", {
    kind: "violin",
    ...POINTS,
    showPoints: true,
    yLabel: "Tumor volume at day 21 (mm³)",
    outlineColor: "#000000",
    ...arms(...groups),
  });
}

{
  table("t-pk", "HLX-101 in plasma (ng/mL)", "xy", {
    columns: ["Title", "Hours", "Mouse 1", "Mouse 2"],
    rows: rows([
      ["0", "0.5", "1", "2", "4", "6", "8", "12"],
      ["98.2", "71.5", "55.1", "33.8", "17.9", "12.6", "10.8", "10.1"],
      ["91.4", "69.8", "50.2", "30.1", "16.2", "11.9", "9.6", "9.8"],
    ]),
  });
  analysis("t-pk", "a-pk", "One-phase decay (mouse 1)", "nonlinear-regression", {
    y: "Mouse 1",
    model: "one-phase-decay",
  });
  graph("t-pk", "g-pk", "Clearance", "xy-scatter", {
    regAnalysisId: "a-pk",
    ...POINTS,
    xLabel: "Hours after injection",
    yLabel: "HLX-101 (ng/mL)",
    legend: { x: 0.8, y: 0.98 },
    note: { x: 280, y: 90 }, // its half-life, where the curve isn't
  });
}

{
  const groups = [VEHICLE, DRUG, COMBO];
  const days = ["Day 0", "Day 3", "Day 7", "Day 14"];
  const means = [
    [12, 14, 13, 15],
    [12, 48, 95, 60],
    [12, 35, 70, 40],
  ];
  // The same three mice of each arm, sampled on each day.
  const values = means.map((row) => row.map((m) => range(3).map(() => fixed(Math.max(1, normal(m, m * 0.12)), 1))));
  table("t-il6", "IL-6 in plasma (pg/mL)", "grouped", groupedData(groups, days, values));
  analysis("t-il6", "a-il6", "Two-way RM ANOVA + Tukey", "two-way-anova", {
    design: "repeated-measures",
    posthoc: "tukey",
    posthocTarget: "groups",
    sphericity: false,
  });
  graph("t-il6", "g-il6-lines", "Time course", "grouped-lines", {
    yLabel: "IL-6 (pg/mL)",
    ...POINTS,
    ...arms(...groups),
    series: { ...arms(...groups).series, [COMBO]: { color: ARM_COLORS[COMBO], dash: "dash", shape: "square" } },
  });
  graph("t-il6", "g-il6-bars", "Interleaved bars", "grouped-bars", {
    yLabel: "IL-6 (pg/mL)",
    outlineColor: "#000000",
    errorDirection: "above",
    errorColor: "#000000",
    series: { ...arms(...groups).series, [COMBO]: { color: ARM_COLORS[COMBO], pattern: "diagonal" } },
  });
}

{
  const cells = ["CD8 T", "CD4 T", "Treg", "NK", "Macrophage"];
  // Each cell type's share, under vehicle then HLX-101.
  const shares = [
    [12, 24],
    [25, 27],
    [9, 5],
    [6, 10],
    [48, 34],
  ];
  // Each mouse's cells add up to 100%.
  const mice = [0, 1].map((arm) =>
    range(4).map(() => {
      const raw = shares.map((byArm) => Math.max(0.5, normal(byArm[arm], byArm[arm] * 0.1)));
      const total = raw.reduce((a, b) => a + b, 0);
      return raw.map((v) => (v * 100) / total);
    }),
  );
  const values = cells.map((_, c) => [0, 1].map((arm) => mice[arm].map((mouse) => fixed(mouse[c], 1))));
  table("t-immune", "Immune infiltrate (% of CD45⁺)", "grouped", groupedData(cells, [VEHICLE, DRUG], values));
  analysis("t-immune", "a-immune", "Two-way ANOVA + Bonferroni (per cell type)", "two-way-anova", {
    design: "ordinary",
    posthoc: "bonferroni",
    posthocTarget: "rows",
  });
  graph("t-immune", "g-immune", "Composition", "grouped-stacked", {
    yLabel: "% of CD45⁺ cells",
    outlineColor: "#FFFFFF",
    ...palette("tol-muted"),
  });
}

{
  // One row per mouse: the day it died (1) or left the study alive (0, censored).
  const groups = [VEHICLE, DRUG, COMBO];
  const mice = groups.flatMap((_, g) =>
    range(20).map(() => {
      const day = Math.round(-Math.log(1 - random()) * [22, 40, 75][g]) + 1;
      return { group: g, day: Math.min(day, 60), event: day >= 60 || random() < 0.12 ? 0 : 1 };
    }),
  );
  table("t-surv", "Overall survival", "survival", {
    columns: ["Title", "Days", ...groups],
    rows: mice.map((m) => [null, String(m.day), ...groups.map((_, g) => (m.group === g ? String(m.event) : null))]),
  });
  analysis("t-surv", "a-surv", "Log-rank test", "survival", { curveTest: "logrank", correction: "holm" });
  analysis("t-surv", "a-surv-cox", "Cox regression", "cox", { reference: VEHICLE });
  graph("t-surv", "g-surv", "Kaplan-Meier curves", "survival", {
    xLabel: "Days after the first dose",
    survivalShowBand: true,
    ...arms(...groups),
  });
}

// ── 3. Omics ─────────────────────────────────────────────────────────────

// The genes HLX-101 changes most: up (cell-cycle arrest, apoptosis), then down (proliferation).
const TOP_GENES = ["CDKN1A", "GADD45A", "BAX", "PMAIP1", "TP53I3", "MYC", "CCND1", "E2F1", "MKI67", "TOP2A"];

{
  const titles = range(10000).map((i) => TOP_GENES[i] ?? `GENE${String(i + 1).padStart(5, "0")}`);
  const values: string[][][] = [[], []];
  for (const r of titles.keys()) {
    const top = r < TOP_GENES.length;
    // Normalized counts, from tens to thousands: never so few that replicates tie.
    const level = Math.max(30, Math.exp(top ? normal(7.5, 0.3) : normal(6.5, 1.1)));
    // ~8% of the other genes change too, less.
    const logFold = top
      ? (r < 5 ? 1 : -1) * (4 + random() * 0.8)
      : random() < 0.08
        ? (random() < 0.55 ? 1 : -1) * Math.abs(normal(1.5, 0.6))
        : normal(0, 0.12);
    const noise = top ? 0.03 : 0.1;
    for (const g of [0, 1]) {
      const mean = level * (g === 1 ? 2 ** logFold : 1);
      values[g].push(range(4).map(() => String(Math.max(1, Math.round(mean * (1 + normal(0, noise)))))));
    }
  }
  table("t-rnaseq", "RNA-seq, HLX-101 vs. vehicle", "grouped", groupedData([VEHICLE, DRUG], titles, values));
  graph("t-rnaseq", "g-rnaseq", "Volcano plot", "volcano", {
    volcanoGroupA: VEHICLE,
    volcanoGroupB: DRUG,
    volcanoSignificance: "fdr",
    volcanoLabelCount: 0,
    // The top genes stand out, with their names.
    points: Object.fromEntries(
      TOP_GENES.map((_, r) => [`#${r}`, { size: 11, outline: 1, outlineColor: "#000000", label: true }]),
    ),
  });
}

{
  const samples = [1, 2, 3].map((k) => `Vehicle ${k}`).concat([1, 2, 3].map((k) => `HLX-101 ${k}`));
  const genes = [...TOP_GENES, "CDK1", "PLK1", "AURKA", "BIRC5", "FAS", "BBC3", "SESN1", "MDM2", "TNFRSF10B", "RRM2B"];
  // Each gene's expression as a z-score across the six samples: up genes rise with HLX-101.
  const up = (g: number) => (g < 5 || g >= 14 ? 1 : -1);
  table("t-genes", "Top 20 genes (z-scores)", "multiple", {
    columns: ["Title", ...samples],
    rows: genes.map((gene, g) => [
      gene,
      ...samples.map((_, s) => fixed((s < 3 ? -1 : 1) * up(g) * normal(1, 0.25), 2)),
    ]),
  });
  graph("t-genes", "g-genes", "Heatmap", "heatmap", {
    palette: reversedPalette(savedPalette(paletteNamed("rdbu")!)), // red for high, as usual
  });
}

{
  const results = range(1000).map((i) => {
    const changed = random() < 0.1;
    const log2FC = changed ? (random() < 0.5 ? -1 : 1) * Math.abs(normal(2, 0.8)) : normal(0, 0.35);
    // The larger the change, the smaller its P value, as in real data.
    const p = changed ? 10 ** -(1.3 + Math.abs(log2FC) * Math.max(0.3, normal(2.2, 0.8))) : random();
    return { gene: `GENE${String(i + 1).padStart(5, "0")}`, log2FC, p };
  });
  // Benjamini-Hochberg adjusted P values, as DESeq2 exports them.
  const order = range(results.length).sort((a, b) => results[a].p - results[b].p);
  const adjusted: number[] = [];
  let running = 1;
  for (let k = order.length - 1; k >= 0; k--) {
    running = Math.min(running, (results[order[k]].p * order.length) / (k + 1));
    adjusted[order[k]] = running;
  }
  table("t-deseq", "DESeq2 results (imported)", "multiple", {
    columns: ["Title", "Gene", "log2FoldChange", "pvalue", "padj"],
    rows: results.map((r, i) => [null, r.gene, fixed(r.log2FC, 3), r.p.toExponential(2), adjusted[i].toExponential(2)]),
  });
  graph("t-deseq", "g-deseq", "Volcano plot", "volcano", {
    volcanoX: "log2FoldChange",
    volcanoY: "padj",
    volcanoLabel: "Gene",
    volcanoLabelCount: 8,
  });
}

// ── 4. Patients ──────────────────────────────────────────────────────────

{
  const times = ["Baseline", "Week 4", "Week 8"];
  const patients = range(12).map((i) => `Patient ${String(i + 1).padStart(2, "0")}`);
  const baseline = patients.map(() => normal(38, 9));
  const columns = [1, 0.74, 0.52].map((f) => baseline.map((b) => fixed(Math.max(2, b * f + normal(0, 3)), 1)));
  table("t-ki67", "Ki-67 index, paired biopsies (%)", "column", {
    columns: ["Title", ...times],
    rows: rows(columns, patients),
  });
  analysis("t-ki67", "a-ki67", "Repeated-measures ANOVA + Tukey", "rm-anova", { posthoc: "tukey", sphericity: false });
  graph("t-ki67", "g-ki67", "Mean ± SD over time", "mean-error", {
    shape: "line",
    error: "sd",
    yLabel: "Ki-67 positive cells (%)",
    sigAnalysisId: "a-ki67",
    sigPairs: [pairKey("Baseline", "Week 4"), pairKey("Baseline", "Week 8")],
    series: Object.fromEntries(times.map((t) => [t, { color: ARM_COLORS[DRUG] }])),
  });
}

{
  const standards = [0, 7.8, 15.6, 31.3, 62.5, 125, 250, 500];
  // A sandwich ELISA's sigmoid: blank 0.05, plateau 2.4, half-way at 80 U/mL.
  const od = () => standards.map((x) => fixed(0.05 + 2.35 / (1 + (80 / x) ** 1.4) + normal(0, 0.03), 3));
  table("t-elisa", "CA 19-9 standard curve (ELISA)", "xy", {
    columns: ["Title", "CA 19-9 (U/mL)", "OD 450 (rep 1)", "OD 450 (rep 2)"],
    // Patients' sera below the standards: an OD, no concentration, read off the curve.
    rows: rows(
      [standards.map(String), [...od(), "0.212", "0.486", "1.127", "2.31"], od()],
      [...standards.map(() => null), "Patient 1", "Patient 2", "Patient 3", "Patient 4"],
    ),
  });
  analysis("t-elisa", "a-elisa", "Interpolated standard curve", "nonlinear-regression", {
    y: "OD 450 (rep 1)",
    model: "sigmoidal-4pl-x",
    interpolate: true,
  });
  graph("t-elisa", "g-elisa", "Standard curve", "xy-scatter", {
    regAnalysisId: "a-elisa",
    ...POINTS,
    xLabel: "CA 19-9 (U/mL)",
    yLabel: "Optical density (450 nm)",
    legend: { x: 0.72, y: 0.1 },
    note: { x: 20, y: 10 },
  });
}

{
  const names = ["Age", "CA 19-9 (U/mL)", "CEA (ng/mL)", "Ki-67 (%)", "Tumor size (mm)"];
  const patients = range(40).map(() => {
    const ki67 = Math.max(3, normal(30, 12));
    const ca199 = Math.exp(normal(4.8 + ki67 / 60, 0.7));
    const cea = Math.max(0.5, normal(4 + ca199 / 150, 2));
    const size = 18 + 0.45 * ki67 + 0.012 * ca199 + normal(0, 5);
    return [fixed(normal(64, 9), 0), fixed(ca199, 0), fixed(cea, 1), fixed(ki67, 1), fixed(size, 1)];
  });
  table("t-markers", "Patient biomarkers", "multiple", {
    columns: ["Title", ...names],
    rows: patients.map((p, i) => [`P${String(i + 1).padStart(2, "0")}`, ...p]),
  });
  analysis("t-markers", "a-markers-cor", "Correlation matrix (Spearman)", "correlation-matrix", {
    method: "spearman",
  });
  analysis("t-markers", "a-markers-reg", "Multiple regression (tumor size)", "multiple-regression", {
    dependent: "Tumor size (mm)",
    predictors: ["CA 19-9 (U/mL)", "CEA (ng/mL)", "Ki-67 (%)"],
  });
  graph("t-markers", "g-markers", "Ki-67 vs. tumor size", "xy-scatter", {
    xVariable: "Ki-67 (%)",
    ...POINTS,
    yVariable: "Tumor size (mm)",
    xLabel: "Ki-67 (%)",
    yLabel: "Tumor size (mm)",
    series: { "Tumor size (mm)": { color: ARM_COLORS[DRUG] } },
  });
}

{
  table("t-response", "Objective response (RECIST)", "contingency", {
    columns: ["Title", "Responder", "Non-responder"],
    rows: [
      [DRUG, "19", "31"],
      [PLACEBO, "7", "43"],
    ],
  });
  analysis("t-response", "a-response", "Fisher's exact test", "chi-square");
  graph("t-response", "g-response", "Stacked bars", "grouped-stacked", {
    yLabel: "Patients",
    outlineColor: "#000000",
    series: {
      Responder: { color: ARM_COLORS[DRUG] },
      "Non-responder": { color: ARM_COLORS[VEHICLE], pattern: "diagonal" },
    },
  });
}

// ── Output ───────────────────────────────────────────────────────────────

export const sampleProject: ProjectFilePayload = { nodes, rootOrder, childOrder, activeNodeId: "g-volume-dots" };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = new URL("../samples/", import.meta.url);
  mkdirSync(folder, { recursive: true });
  writeFileSync(new URL("Helix Sample.hlx", folder), serializeProjectFile(sampleProject));
  const count = (type: string) => Object.values(nodes).filter((n) => n.type === type).length;
  console.log(
    `samples/Helix Sample.hlx: ${count("table")} tables, ${count("analysis")} analyses, ${count("graph")} graphs.`,
  );
}
