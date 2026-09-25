// "Volcano plot": a large scatter of effect size (X) vs. significance (Y). On a
// Multiple Variables table it plots columns the user already has (DESeq2/edgeR
// output…): which column is X (log2 fold change), which is Y (a P value, adjusted P
// or FDR), and an optional gene-name column. On a grouped table, graph-view first
// computes them from two groups (lib/deg.ts). `volcanoYIsPValue` applies the usual
// -log10 transform so a P/FDR column becomes the vertical axis.
//
// Rendered as a single `scattergl` (WebGL) trace with a per-point color array so
// tens of thousands of genes stay smooth; points are colored up / down / not-
// significant by the fold-change + significance thresholds, which also draw the
// dashed guide lines. The most significant genes are annotated.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { xyLayout, INK } from "./plot-helpers";
import { PALETTE_HEX } from "../../lib/palette";

const NS = "#B8BEC9"; // not significant (fixed muted grey)
const GUIDE = "#9CA3AF"; // dashed threshold lines

const log10 = (v: number) => Math.log(v) / Math.LN10;

function build(columns: Column[], options: GraphOptions): GraphFigure {
  const byName = (name?: string) => columns.find((c) => c.name === name);
  const xCol = byName(options.volcanoX) ?? columns[0];
  const yCol = byName(options.volcanoY) ?? columns[1];
  const labelCol = byName(options.volcanoLabel);
  const yIsP = options.volcanoYIsPValue;

  const xName = xCol?.name ?? "Log2 fold change";
  const yName = yCol?.name ?? "P value";
  const yTitle = options.yLabel || (yIsP ? `-log10(${yName})` : yName);

  // Reuse the XY family's numeric-axis layout (clean spines, no legend), then set
  // a sensible default Y-axis title (xyLayout only titles Y when yLabel is set).
  const layout = xyLayout(options, xName, 0);
  (layout.yaxis as Record<string, unknown>).title = { text: yTitle };

  if (!xCol || !yCol) return { data: [], layout };

  const fc = options.volcanoFcThreshold;
  const up = PALETTE_HEX[options.volcanoColorUp];
  const down = PALETTE_HEX[options.volcanoColorDown];
  // Significance cutoff entered on the PLOTTED Y scale (what the axis shows), so
  // "what you type = where the line sits". With -log10 on, higher Y = more
  // significant (pass when Y ≥ cutoff); with it off (raw p/FDR), lower = more
  // significant (pass when Y ≤ cutoff).
  const sigY = options.volcanoPThreshold;

  const xs: number[] = [];
  const ys: number[] = [];
  const colors: string[] = [];
  const hover: string[] = [];
  const labels: { x: number; y: number; text: string }[] = [];

  const n = Math.max(xCol.cells.length, yCol.cells.length);
  for (let r = 0; r < n; r++) {
    const xv = xCol.byRow[r] ?? null;
    let yv = yCol.byRow[r] ?? null;
    if (xv == null || yv == null) continue;
    if (yIsP) {
      if (yv <= 0) continue; // a p / FDR must be > 0 to take -log10
      yv = -log10(yv);
    }
    const passSig = yIsP ? yv >= sigY : yv <= sigY;
    const sig = Math.abs(xv) >= fc && passSig;
    xs.push(xv);
    ys.push(yv);
    colors.push(!sig ? NS : xv >= 0 ? up : down);
    const name = labelCol ? String(labelCol.cells[r] ?? "").trim() : "";
    hover.push(
      `${name ? name + "<br>" : ""}${xName}: ${xv}<br>${yTitle}: ${yv.toFixed(2)}`,
    );
    if (sig && name) labels.push({ x: xv, y: yv, text: name });
  }

  const data: unknown[] = [
    {
      type: "scattergl",
      mode: "markers",
      x: xs,
      y: ys,
      marker: { color: colors, size: options.volcanoPointSize, opacity: 0.75, line: { width: 0 } },
      text: hover,
      hoverinfo: "text",
      showlegend: false,
    },
  ];

  // Dashed guide lines: vertical at ±FC (or a single x=0 line when FC is 0),
  // horizontal at the significance cutoff.
  if (options.volcanoShowThresholds) {
    const vline = (x: number) => ({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: x,
      x1: x,
      y0: 0,
      y1: 1,
      line: { color: GUIDE, width: 1, dash: "dash" },
    });
    const shapes: unknown[] = fc > 0 ? [vline(fc), vline(-fc)] : [vline(0)];
    if (Number.isFinite(sigY)) {
      shapes.push({
        type: "line",
        xref: "paper",
        yref: "y",
        x0: 0,
        x1: 1,
        y0: sigY,
        y1: sigY,
        line: { color: GUIDE, width: 1, dash: "dash" },
      });
    }
    layout.shapes = shapes;
  }

  // Name the most significant genes (highest plotted Y, tie-break by |X|), each placed
  // where it overlaps nothing.
  const topN = Math.max(0, options.volcanoLabelCount);
  if (topN > 0 && labels.length) {
    labels.sort((a, b) => b.y - a.y || Math.abs(b.x) - Math.abs(a.x));
    layout.annotations = placeLabels(labels.slice(0, topN), xs, ys, options);
  }

  return { data, layout };
}

export const volcano: GraphModule = { label: "Volcano plot", family: "volcano", build };

type Box = { left: number; top: number; right: number; bottom: number };

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Where each name goes, like ggrepel: around its point, nearest spot first (above,
 *  then outward, sideways, below; farther and farther), the first that overlaps no
 *  other name or named point and stays inside the plot, else the least crowded one.
 *  Pixel positions are estimated from the graph's size and its axis ranges; a thin
 *  leader line joins a name to its point. */
function placeLabels(labels: { x: number; y: number; text: string }[], xs: number[], ys: number[], options: GraphOptions) {
  const fontSize = Math.max(options.fontSize - 3, 8);
  // The plot area, minus the usual room for tick labels and axis titles.
  const width = options.width - 76;
  const height = options.height - (options.title ? 44 : 16) - 52;
  const range = (values: number[], min?: number, max?: number) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.05 || 1;
    return [min ?? lo - pad, max ?? hi + pad];
  };
  const [x0, x1] = range(xs, options.xMin, options.xMax);
  const [y0, y1] = range(ys, options.yMin, options.yMax);
  const toPx = (x: number, y: number) => ({
    px: ((x - x0) / (x1 - x0)) * width,
    py: height - ((y - y0) / (y1 - y0)) * height,
  });

  const plot: Box = { left: 0, top: 0, right: width, bottom: height };
  const points = labels.map((l) => toPx(l.x, l.y));
  const r = options.volcanoPointSize / 2 + 1;
  const taken: Box[] = points.map(({ px, py }) => ({ left: px - r, top: py - r, right: px + r, bottom: py + r }));

  return labels.map((l, i) => {
    const { px, py } = points[i];
    const w = l.text.length * fontSize * 0.6 + 4;
    const h = fontSize + 4;
    const out = l.x >= 0 ? 1 : -1; // away from the middle first
    const directions = [[0, -1], [out, -1], [-out, -1], [out, 0], [-out, 0], [out, 1], [-out, 1], [0, 1]];
    let best = { dx: 0, dy: -12 - h / 2, score: Infinity };
    for (const distance of [8, 18, 30, 45, 64]) {
      for (const [ux, uy] of directions) {
        const dx = ux * (distance + w / 2);
        const dy = uy * (distance + h / 2);
        const box = { left: px + dx - w / 2, top: py + dy - h / 2, right: px + dx + w / 2, bottom: py + dy + h / 2 };
        const outside = w * h - overlap(box, plot);
        const score = taken.reduce((sum, t) => sum + overlap(box, t), 0) + outside;
        if (score < best.score) best = { dx, dy, score };
        if (score === 0) break;
      }
      if (best.score === 0) break;
    }
    taken.push({
      left: px + best.dx - w / 2,
      top: py + best.dy - h / 2,
      right: px + best.dx + w / 2,
      bottom: py + best.dy + h / 2,
    });
    return {
      x: l.x,
      y: l.y,
      text: l.text,
      xref: "x",
      yref: "y",
      showarrow: true,
      arrowhead: 0,
      arrowwidth: 0.5,
      arrowcolor: GUIDE,
      standoff: 2,
      ax: best.dx,
      ay: best.dy,
      font: { color: INK, size: fontSize },
    };
  });
}
