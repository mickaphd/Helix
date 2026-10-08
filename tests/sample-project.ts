/// <reference types="node" />
// The sample project: a made-up preclinical study, every table type, most graphs and
// analyses, and what a graph can be made to show (palettes, patterns, dashes, points
// styled one by one, a volcano naming its top genes), on realistic data drawn from a
// fixed seed. `npm run sample` writes it to `samples/Helix Sample.hlx`; `npm test`
// checks that every analysis in it runs and every graph draws.
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
const unpaired = (gaussian: boolean, equalVariance: boolean) =>
  ({ paired: false, gaussian, equalVariance, ratio: false, tails: "two-sided" }) as const;

// The story: HLX-101, a made-up compound tested against pancreatic cancer, from mice
// to cells to patients. Every number is invented, drawn from a fixed seed.
const VEHICLE = "Vehicle";
const LOW = "HLX-101 10 mg/kg";
const HIGH = "HLX-101 30 mg/kg";

// ── Column tables ────────────────────────────────────────────────────────

{
  const groups = [VEHICLE, LOW, HIGH, "Gemcitabine"];
  const means = [1180, 820, 460, 690];
  const columns = means.map((m) => range(10).map(() => fixed(normal(m, m * 0.15), 0)));
  columns[0][6] = "2950"; // Mouse 7: an outlier, which ROUT finds
  columns[1][3] = "86"; // a caliper error, excluded
  table("t-tumor", "Tumor volume, day 21 (mm³)", "column", {
    columns: ["Title", ...groups],
    rows: rows(
      columns,
      range(10).map((i) => `Mouse ${i + 1}`),
    ),
    excluded: ["3,2"],
  });
  analysis("t-tumor", "a-tumor-desc", "Descriptive statistics", "descriptive-statistics");
  analysis("t-tumor", "a-tumor-anova", "One-way ANOVA + Tukey", "anova", { posthoc: "tukey" });
  analysis("t-tumor", "a-tumor-kw", "Kruskal-Wallis + Dunn", "kruskal-wallis", { posthoc: "dunn" });
  analysis("t-tumor", "a-tumor-welch", "Welch's t test (vehicle vs. 30 mg/kg)", "compare-two-groups", {
    ...unpaired(true, false),
    sets: [VEHICLE, HIGH],
  });
  analysis("t-tumor", "a-tumor-rout", "Outliers (ROUT, Q = 1%)", "outliers", { q: 1 });
  graph("t-tumor", "g-tumor-dots", "Scatter dot plot", "individual", {
    title: "Tumor volume at day 21",
    yLabel: "Tumor volume (mm³)",
    sigAnalysisId: "a-tumor-anova",
    sigPairs: [pairKey(VEHICLE, LOW), pairKey(VEHICLE, HIGH), pairKey(VEHICLE, "Gemcitabine")],
    // Mouse 7, the outlier, stands out with its name.
    points: { [pointKeyOf(VEHICLE, 6)]: { size: 12, shape: "diamond", outlineColor: "#000000", label: true } },
  });
  graph("t-tumor", "g-tumor-box", "Box plot", "box-violin", {
    kind: "box",
    showPoints: true,
    yLabel: "Tumor volume (mm³)",
    sigAnalysisId: "a-tumor-kw",
    sigDisplay: "pvalue",
    sigPairs: [pairKey(VEHICLE, HIGH)],
    outlineColor: "#000000",
    ...palette("tol-muted"),
  });
  graph("t-tumor", "g-tumor-bars", "Mean ± SEM", "mean-error", {
    yLabel: "Tumor volume (mm³)",
    error: "sem",
    errorDirection: "above",
    errorColor: "#000000",
    outlineColor: "#000000",
    ...palette("tableau-10"),
    series: { [LOW]: { pattern: "diagonal" }, [HIGH]: { pattern: "crosshatch" } },
  });
}

{
  const times = ["Baseline", "Week 4", "Week 8"];
  const patients = range(12).map((i) => `Patient ${String(i + 1).padStart(2, "0")}`);
  const baseline = patients.map(() => normal(38, 9));
  const columns = [1, 0.74, 0.52].map((f) => baseline.map((b) => fixed(Math.max(2, b * f + normal(0, 3)), 1)));
  table("t-ki67", "Ki-67 index, paired biopsies (%)", "column", {
    columns: ["Title", ...times],
    rows: rows(columns, patients),
  });
  analysis("t-ki67", "a-ki67-paired", "Paired t test (baseline vs. week 4)", "compare-two-groups", {
    paired: true,
    gaussian: true,
    equalVariance: true,
    ratio: false,
    tails: "two-sided",
    sets: ["Baseline", "Week 4"],
  });
  analysis("t-ki67", "a-ki67-rm", "Repeated-measures ANOVA + Tukey", "rm-anova", { posthoc: "tukey" });
  analysis("t-ki67", "a-ki67-fr", "Friedman + Dunn", "friedman", { posthoc: "dunn" });
  analysis("t-ki67", "a-ki67-one", "Week 8 vs. the 20% threshold", "one-sample-t", {
    hypotheticalValue: 20,
    tails: "two-sided",
    gaussian: true,
    sets: ["Week 8"],
  });
  graph("t-ki67", "g-ki67-line", "Mean ± SD over time", "mean-error", {
    shape: "line",
    error: "sd",
    lineDash: "dash",
    pointShape: "square",
    yLabel: "Ki-67 positive cells (%)",
    ...palette("tol-bright"),
  });
}

{
  const subtypes = ["Ductal adenocarcinoma", "Neuroendocrine", "Adenosquamous", "Acinar cell", "Other"];
  table("t-cohort", "Cohort by tumor subtype", "column", {
    columns: ["Title", ...subtypes],
    rows: [["Patients", "112", "14", "9", "6", "5"]],
  });
  graph("t-cohort", "g-cohort", "Donut", "donut", { title: "146 patients", ...palette("tol-bright") });
}

// ── XY tables ────────────────────────────────────────────────────────────

{
  const days = [0, 3, 7, 10, 14, 17, 21, 24, 28];
  const growth = (rate: number) => days.map((d) => fixed(110 * Math.exp(rate * d) * (1 + normal(0, 0.05)), 0));
  table("t-growth", "Tumor growth (mm³)", "xy", {
    columns: ["Title", "Day", VEHICLE, LOW, HIGH],
    rows: rows([days.map(String), growth(0.088), growth(0.071), growth(0.05)]),
  });
  analysis("t-growth", "a-growth-auc", "Area under the curve", "area-under-curve", { baseline: 0 });
  graph("t-growth", "g-growth-lines", "Growth curves", "xy-scatter", {
    xyStyle: "points+line",
    xLabel: "Days after the first dose",
    yLabel: "Mean tumor volume (mm³)",
    series: { [LOW]: { dash: "dash", shape: "square" }, [HIGH]: { dash: "dot", shape: "triangle-up" } },
    legend: { x: 0.04, y: 0.98 },
  });
  graph("t-growth", "g-growth-area", "Area", "xy-area", {
    xLabel: "Days after the first dose",
    yLabel: "Mean tumor volume (mm³)",
    ...palette("tol-muted"),
  });
}

{
  const logDose = range(11).map((i) => -9 + i * 0.5);
  // Viability falls from 100% to its floor as the dose rises.
  const viability = (ec50: number, hill: number, floor: number) =>
    logDose.map((x) => fixed(floor + (100 - floor) / (1 + 10 ** ((x - ec50) * hill)) + normal(0, 2.5), 1));
  const lines = ["PANC-1", "MIA PaCa-2", "BxPC-3"];
  table("t-viab", "Cell viability (%)", "xy", {
    columns: ["Title", "log[HLX-101] (M)", ...lines],
    rows: rows([
      logDose.map((x) => fixed(x, 1)),
      viability(-6.1, 1.2, 6),
      viability(-6.8, 1.1, 4),
      viability(-5.4, 0.9, 12),
    ]),
  });
  for (const [i, line] of lines.entries()) {
    analysis("t-viab", `a-viab-${i}`, `4PL fit (${line})`, "nonlinear-regression", {
      y: line,
      model: "sigmoidal-4pl-logx",
    });
  }
  graph("t-viab", "g-viab", "Dose-response curve", "dose-response", {
    doseY: "MIA PaCa-2",
    doseModel: "sigmoidal-4pl-logx",
    title: "MIA PaCa-2",
    xLabel: "log[HLX-101] (M)",
    yLabel: "Cell viability (%)",
    note: { x: 10, y: 250 }, // its EC50, moved where the curve isn't
  });
}

{
  // One row per mouse: the day it died (1) or left the study alive (0, censored).
  const arms = [VEHICLE, "HLX-101", "HLX-101 + Gemcitabine"];
  const mice = arms.flatMap((_, g) =>
    range(20).map(() => {
      const day = Math.round(-Math.log(1 - random()) * [22, 40, 75][g]) + 1;
      return { group: g, day: Math.min(day, 60), event: day >= 60 || random() < 0.12 ? 0 : 1 };
    }),
  );
  table("t-surv", "Overall survival", "xy", {
    columns: ["Title", "Days", ...arms],
    rows: mice.map((m) => [null, String(m.day), ...arms.map((_, g) => (m.group === g ? String(m.event) : null))]),
  });
  graph("t-surv", "g-surv", "Kaplan-Meier curves", "survival", {
    title: "Overall survival",
    xLabel: "Days after the first dose",
  });
}

{
  const standards = [0, 7.8, 15.6, 31.3, 62.5, 125, 250, 500];
  const od = () => standards.map((x) => fixed(0.05 + 0.0036 * x + normal(0, 0.03), 3));
  table("t-elisa", "CA 19-9 standard curve (ELISA)", "xy", {
    columns: ["Title", "CA 19-9 (U/mL)", "OD 450 (rep 1)", "OD 450 (rep 2)"],
    rows: rows([standards.map(String), od(), od()]),
  });
  analysis("t-elisa", "a-elisa-lin", "Linear regression", "linear-regression", {
    y: "OD 450 (rep 1)",
    forceOrigin: false,
  });
  analysis("t-elisa", "a-elisa-cor", "Pearson correlation", "correlation", { method: "pearson", mode: "x-vs-every-y" });
  graph("t-elisa", "g-elisa", "Standard curve", "xy-scatter", {
    regAnalysisId: "a-elisa-lin",
    xLabel: "CA 19-9 (U/mL)",
    yLabel: "Optical density (450 nm)",
    ...palette("tol-bright"),
    note: { x: 20, y: 10 },
  });
}

// ── Grouped tables ───────────────────────────────────────────────────────

{
  const groups = [VEHICLE, "HLX-101", "HLX-101 + Gem"];
  const days = ["Day 0", "Day 3", "Day 7", "Day 14"];
  const means = [
    [12, 14, 13, 15],
    [12, 48, 95, 60],
    [12, 35, 70, 40],
  ];
  const values = means.map((row) => row.map((m) => range(3).map(() => fixed(Math.max(1, normal(m, m * 0.12)), 1))));
  table("t-il6", "IL-6 in plasma (pg/mL)", "grouped", groupedData(groups, days, values));
  analysis("t-il6", "a-il6-2w", "Two-way ANOVA + Tukey", "two-way-anova", {
    design: "ordinary",
    posthoc: "tukey",
    posthocTarget: "groups",
  });
  analysis("t-il6", "a-il6-rm", "Two-way RM ANOVA", "two-way-anova", {
    design: "repeated-measures",
    posthoc: "none",
    posthocTarget: "groups",
  });
  analysis("t-il6", "a-il6-mt", "Multiple t tests (vehicle vs. HLX-101)", "multiple-t-tests", {
    paired: false,
    gaussian: true,
    pooledSd: false,
    correction: "holm",
    sets: [VEHICLE, "HLX-101"],
  });
  graph("t-il6", "g-il6-bars", "Interleaved bars", "grouped-bars", {
    yLabel: "IL-6 (pg/mL)",
    barGap: 0.15,
    outlineColor: "#000000",
    errorDirection: "above",
    ...palette("tableau-10"),
    series: { "HLX-101 + Gem": { pattern: "diagonal" } },
  });
  graph("t-il6", "g-il6-lines", "Time course", "grouped-lines", {
    yLabel: "IL-6 (pg/mL)",
    ...palette("tol-bright"),
    series: { "HLX-101 + Gem": { dash: "dash", shape: "square" } },
  });
  graph("t-il6", "g-il6-dots", "Interleaved scatter", "grouped-scatter", {
    yLabel: "IL-6 (pg/mL)",
    pointSize: 8,
    series: { "HLX-101": { shape: "square" }, "HLX-101 + Gem": { shape: "triangle-up" } },
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
  table("t-immune", "Immune infiltrate (% of CD45⁺)", "grouped", groupedData(cells, [VEHICLE, "HLX-101"], values));
  analysis("t-immune", "a-immune-2w", "Two-way ANOVA + Bonferroni (per cell type)", "two-way-anova", {
    design: "ordinary",
    posthoc: "bonferroni",
    posthocTarget: "rows",
  });
  graph("t-immune", "g-immune-stack", "Composition", "grouped-stacked", {
    yLabel: "% of CD45⁺ cells",
    ...palette("tol-muted"),
  });
  graph("t-immune", "g-immune-h", "Horizontal bars", "grouped-hbars", {
    yLabel: "% of CD45⁺ cells",
    ...palette("tol-muted"),
  });
}

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
  table("t-rnaseq", "RNA-seq, HLX-101 vs. vehicle", "grouped", groupedData([VEHICLE, "HLX-101"], titles, values));
  graph("t-rnaseq", "g-rnaseq", "Volcano plot", "volcano", {
    title: "HLX-101 vs. vehicle",
    volcanoGroupA: VEHICLE,
    volcanoGroupB: "HLX-101",
    volcanoSignificance: "fdr",
    volcanoLabelCount: 0,
    // The top genes stand out, with their names.
    points: Object.fromEntries(
      TOP_GENES.map((_, r) => [`#${r}`, { size: 11, outline: 1, outlineColor: "#000000", label: true }]),
    ),
  });
}

// ── Multiple Variables tables ────────────────────────────────────────────

{
  const names = ["Age", "CA 19-9 (U/mL)", "CEA (ng/mL)", "Ki-67 (%)", "Tumor size (mm)"];
  const patients = range(40).map(() => {
    const ki67 = Math.max(3, normal(30, 12));
    const ca199 = Math.exp(normal(4.8 + ki67 / 60, 0.7));
    const cea = Math.max(0.5, normal(4 + ca199 / 150, 2));
    const size = 18 + 0.45 * ki67 + 0.012 * ca199 + normal(0, 5);
    return [fixed(normal(64, 9), 0), fixed(ca199, 0), fixed(cea, 1), fixed(ki67, 1), fixed(size, 1)];
  });
  table("t-pat", "Patient biomarkers", "multiple", {
    columns: ["Title", ...names],
    rows: patients.map((p, i) => [`P${String(i + 1).padStart(2, "0")}`, ...p]),
  });
  analysis("t-pat", "a-pat-sp", "Correlation matrix (Spearman)", "correlation-matrix", { method: "spearman" });
  analysis("t-pat", "a-pat-reg", "Multiple regression (tumor size)", "multiple-regression", {
    dependent: "Tumor size (mm)",
    predictors: ["CA 19-9 (U/mL)", "CEA (ng/mL)", "Ki-67 (%)"],
  });
}

{
  const samples = [1, 2, 3].map((k) => `Vehicle ${k}`).concat([1, 2, 3].map((k) => `HLX-101 ${k}`));
  const genes = [...TOP_GENES, "CDK1", "PLK1", "AURKA", "BIRC5", "FAS", "BBC3", "SESN1", "MDM2", "TNFRSF10B", "RRM2B"];
  // Each gene's expression as a z-score across the six samples: up genes rise with HLX-101.
  const up = (g: number) => (g < 5 || g >= 14 ? 1 : -1);
  table("t-heat", "Top 20 genes (z-scores)", "multiple", {
    columns: ["Title", ...samples],
    rows: genes.map((gene, g) => [
      gene,
      ...samples.map((_, s) => fixed((s < 3 ? -1 : 1) * up(g) * normal(1, 0.25), 2)),
    ]),
  });
  graph("t-heat", "g-heat", "Heatmap", "heatmap", {
    title: "Top 20 genes",
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

// ── Contingency tables ───────────────────────────────────────────────────

table("t-recist", "Objective response (RECIST)", "contingency", {
  columns: ["Title", "Responder", "Non-responder"],
  rows: [
    ["HLX-101", "19", "31"],
    ["Placebo", "7", "43"],
  ],
});
analysis("t-recist", "a-recist", "Fisher's exact test", "chi-square");
graph("t-recist", "g-recist", "Stacked bars", "grouped-stacked", {
  yLabel: "Patients",
  ...palette("grayscale"),
  series: { "Non-responder": { pattern: "diagonal" } },
});

table("t-kras", "KRAS mutation by tumor site", "contingency", {
  columns: ["Title", "G12D", "G12V", "G12R", "Wild type"],
  rows: [
    ["Head", "48", "30", "18", "6"],
    ["Body", "30", "22", "9", "5"],
    ["Tail", "16", "14", "4", "4"],
  ],
});
analysis("t-kras", "a-kras", "Chi-square test", "chi-square");
graph("t-kras", "g-kras", "Horizontal bars", "grouped-hbars", {
  xLabel: "Tumor site",
  yLabel: "Patients",
  background: "transparent",
});

// ── Output ───────────────────────────────────────────────────────────────

export const sampleProject: ProjectFilePayload = { nodes, rootOrder, childOrder, activeNodeId: "g-tumor-dots" };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = new URL("../samples/", import.meta.url);
  mkdirSync(folder, { recursive: true });
  writeFileSync(new URL("Helix Sample.hlx", folder), serializeProjectFile(sampleProject));
  const count = (type: string) => Object.values(nodes).filter((n) => n.type === type).length;
  console.log(
    `samples/Helix Sample.hlx: ${count("table")} tables, ${count("analysis")} analyses, ${count("graph")} graphs.`,
  );
}
