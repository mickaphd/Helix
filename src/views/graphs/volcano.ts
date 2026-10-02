// "Volcano plot": a large scatter of effect size (X) vs. significance (Y). On a
// Multiple Variables table it plots columns the user already has (DESeq2/edgeR
// output…): which column is X (log2 fold change), which is Y (a P value, adjusted P
// or FDR), and an optional gene-name column. On a grouped table, graph-view first
// computes them from two groups (lib/deg.ts). `volcanoYIsPValue` applies the usual
// -log10 transform so a P/FDR column becomes the vertical axis.
//
// Rendered as a `scattergl` (WebGL) trace with per-point arrays so tens of thousands
// of genes stay smooth; points are colored up / down / not-significant by the
// fold-change + significance thresholds, which also draw the dashed guide lines.
// Genes styled one by one (`points`, by row) are a second trace, over the others.
// The most significant genes are annotated, and those asked to show their name.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { extent, GUIDE, pointName, textWidth, xyLayout, type Paint } from "./plot-helpers";
import { withOpacity } from "../../lib/palettes";
import { pointKeyOf } from "../../lib/columns";

const NS = "#B8BEC9"; // not significant (fixed muted grey)

const log10 = (v: number) => Math.log(v) / Math.LN10;

/** A gene's key: its row, whatever columns its values come from (see `pointKeyOf`). */
const geneKey = (row: number) => pointKeyOf("", row);

/** The keys of the genes named in `query`: names separated by commas, matched whole
 *  and in any case. `missing`: the names no gene has. */
export function genesNamed(columns: Column[], options: GraphOptions, query: string) {
  const labelCol = columns.find((c) => c.name === options.volcanoLabel);
  const wanted = query.split(",").map((n) => n.trim()).filter(Boolean);
  const rowsOf = new Map<string, number[]>();
  labelCol?.cells.forEach((cell, r) => {
    const name = String(cell ?? "").trim().toLowerCase();
    if (name) rowsOf.set(name, [...(rowsOf.get(name) ?? []), r]);
  });
  return {
    keys: wanted.flatMap((n) => (rowsOf.get(n.toLowerCase()) ?? []).map(geneKey)),
    missing: wanted.filter((n) => !rowsOf.has(n.toLowerCase())),
  };
}

/** A volcano's two colored series, by key: what it calls them. */
export const VOLCANO_SERIES: Record<string, string> = { down: "Down-regulated", up: "Up-regulated" };

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const byName = (name?: string) => columns.find((c) => c.name === name);
  const xCol = byName(options.volcanoX) ?? columns[0];
  const yCol = byName(options.volcanoY) ?? columns[1];
  const labelCol = byName(options.volcanoLabel);
  const yIsP = options.volcanoYIsPValue;

  const xName = xCol?.name ?? "Log2 fold change";
  const yName = yCol?.name ?? "P value";
  const yTitle = options.yLabel || (yIsP ? `-log10(${yName})` : yName);

  // The XY family's numeric-axis layout (clean spines, no legend), Y titled by default.
  const layout = xyLayout(options, xName, 0, { yName: yTitle });

  if (!xCol || !yCol) return { data: [], layout };

  const fc = options.volcanoFcThreshold;
  const down = paint.color("down", 0);
  const up = paint.color("up", 1);
  // Significance cutoff entered on the PLOTTED Y scale (what the axis shows), so
  // "what you type = where the line sits". With -log10 on, higher Y = more
  // significant (pass when Y ≥ cutoff); with it off (raw p/FDR), lower = more
  // significant (pass when Y ≤ cutoff).
  const sigY = options.volcanoPThreshold;

  const genes: {
    x: number;
    y: number;
    key: string;
    color: string;
    shape: string;
    size: number;
    fill: number;
    outline: number;
    outlineColor: string;
    hover: string;
    own: boolean;
  }[] = [];
  const labels: Name[] = [];
  const named: Name[] = []; // the genes asked to show their name

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
    // A gene is its row; its own style wins over its up / down / not significant look.
    const key = geneKey(r);
    const own = options.points?.[key];
    const name = labelCol ? String(labelCol.cells[r] ?? "").trim() : "";
    const color = own?.color ?? (!sig ? NS : xv >= 0 ? up : down);
    genes.push({
      x: xv,
      y: yv,
      key,
      color,
      shape: own?.shape ?? (!sig ? options.pointShape : paint.shape(xv >= 0 ? "up" : "down")),
      size: own?.size ?? paint.size,
      fill: own?.fill ?? options.pointFill,
      outline: own?.outline ?? paint.outline,
      outlineColor: paint.outlineColor(color, own?.outlineColor),
      hover: `${name ? name + "<br>" : ""}${xName}: ${xv}<br>${yTitle}: ${yv.toFixed(2)}`,
      own: !!own,
    });
    if (own?.label) named.push({ key, x: xv, y: yv, text: name || `Row ${r + 1}` });
    else if (sig && name) labels.push({ key, x: xv, y: yv, text: name });
  }

  const trace = (drawn: typeof genes) => ({
    type: "scattergl",
    mode: "markers",
    x: drawn.map((g) => g.x),
    y: drawn.map((g) => g.y),
    marker: {
      color: drawn.map((g) => withOpacity(g.color, g.fill)),
      size: drawn.map((g) => g.size),
      symbol: drawn.map((g) => g.shape),
      line: { color: drawn.map((g) => g.outlineColor), width: drawn.map((g) => g.outline) },
    },
    customdata: drawn.map((g) => g.key),
    text: drawn.map((g) => g.hover),
    hoverinfo: "text",
    showlegend: false,
  });
  // The genes styled one by one are drawn last, over the thousands of others.
  const styled = genes.filter((g) => g.own);
  const data: unknown[] = [trace(genes.filter((g) => !g.own)), ...(styled.length ? [trace(styled)] : [])];
  const xs = genes.map((g) => g.x);
  const ys = genes.map((g) => g.y);

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

  // Name the genes asked to show theirs, and the most significant ones (highest plotted
  // Y, tie-break by |X|), each placed where it overlaps nothing.
  labels.sort((a, b) => b.y - a.y || Math.abs(b.x) - Math.abs(a.x));
  const shown = [...named, ...labels.slice(0, Math.max(0, options.volcanoLabelCount))];
  if (shown.length) layout.annotations = placeLabels(shown, xs, ys, options);

  return { data, layout };
}

export const volcano: GraphModule = {
  label: "Volcano plot",
  family: "volcano",
  palette: "coolwarm",
  defaults: { pointSize: 5, pointOutline: 0, pointFill: 0.75 },
  points: () => true,
  build,
};

type Box = { left: number; top: number; right: number; bottom: number };
/** A gene's name, at its point. */
type Name = { key: string; x: number; y: number; text: string };

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Where each name goes, like ggrepel: where it was moved by hand, else around its
 *  point, nearest spot first (above, then outward, sideways, below; farther and
 *  farther), the first that overlaps no other name or named point and stays inside
 *  the plot, else the least crowded one. Pixel positions are estimated from the
 *  graph's size and its axis ranges; a thin leader line joins a name to its point. */
function placeLabels(labels: Name[], xs: number[], ys: number[], options: GraphOptions) {
  const fontSize = Math.max(options.fontSize - 3, 8);
  // The plot area, minus the usual room for tick labels and axis titles.
  const width = options.width - 76;
  const height = options.height - (options.title ? 44 : 16) - 52;
  const range = (values: number[], min?: number, max?: number) => {
    const [lo, hi] = extent(values);
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
  const r = options.pointSize / 2 + 1;
  const taken: Box[] = points.map(({ px, py }) => ({ left: px - r, top: py - r, right: px + r, bottom: py + r }));
  const boxAt = (px: number, py: number, w: number, h: number) => ({ left: px - w / 2, top: py - h / 2, right: px + w / 2, bottom: py + h / 2 });

  return labels.map((l, i) => {
    const { px, py } = points[i];
    const w = textWidth(l.text, fontSize);
    const h = fontSize + 4;
    let best = options.points?.[l.key]?.labelOffset;
    if (!best) {
      const out = l.x >= 0 ? 1 : -1; // away from the middle first
      const directions = [[0, -1], [out, -1], [-out, -1], [out, 0], [-out, 0], [out, 1], [-out, 1], [0, 1]];
      let score = Infinity;
      best = { x: 0, y: -12 - h / 2 };
      for (const distance of [8, 18, 30, 45, 64]) {
        for (const [ux, uy] of directions) {
          const spot = { x: ux * (distance + w / 2), y: uy * (distance + h / 2) };
          const box = boxAt(px + spot.x, py + spot.y, w, h);
          const crowd = taken.reduce((sum, t) => sum + overlap(box, t), 0) + w * h - overlap(box, plot);
          if (crowd < score) [best, score] = [spot, crowd];
          if (crowd === 0) break;
        }
        if (score === 0) break;
      }
    }
    taken.push(boxAt(px + best.x, py + best.y, w, h));
    return pointName(l.key, l.x, l.y, l.text, best, options.pointSize, fontSize);
  });
}
