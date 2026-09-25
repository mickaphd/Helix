// Host for a graph node: reads the parent table (lib/dataset.ts), draws the chart
// with Plotly on a sheet (exactly the exported image), and shows the Format panel.
// The graph is resized by grabbing an axis (X = width, Y = height) or by typing its
// size under Export: during a drag only a light axis outline follows, and the plot
// redraws once on release. Ctrl+scroll or a pinch zooms the view only.
import * as React from "react";
import { cn } from "../../ui/controls";
import { WithInspector } from "../../components/common/inspector";
import { DEFAULT_GRAPH_OPTIONS, type GraphOptions, type PaletteColor, type ProjectNode } from "../../store/types";
import type { LinearRegressionParams } from "../../stats/types";
import { useProjectStore } from "../../store/use-project-store";
import { withSeriesColor } from "../../lib/columns";
import { groupsOf, readTable, seriesOf } from "../../lib/dataset";
import { computeGroupedDEG } from "../../lib/deg";
import { useAnalysis } from "../analyses/use-analysis";
import { GRAPHS, plotColumns } from ".";
import { addDoseCurve } from "./dose-response-curve";
import { FormatPanel } from "./format-panel";
import { copyGraphImage, saveGraphImage } from "./graph-export";
import { GRAPH_SIZE, INK, marginsFor } from "./plot-helpers";
import { useOpenAnalysisPicker } from "../analyses/use-analysis-launcher";
import { loadPlotly } from "./plotly";
import { addRegression } from "./regression-overlay";
import { addSignificance, deriveComparisons } from "./significance-overlay";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

type Size = { width: number; height: number };
type Range = { min: number; max: number; step: number };
type Margins = { l: number; r: number; t: number; b: number };

/** Snaps Plotly's padded auto range (e.g. 4.832–21.312) outward to round numbers at
 *  the range's own magnitude (4–22), so Auto shows sensible Min/Max values. */
const niceRange = ([min, max]: number[], step = 0): Range => {
  const unit = Math.pow(10, Math.floor(Math.log10(Math.abs(max - min) || 1)) - 1);
  return { min: Math.floor(min / unit) * unit, max: Math.ceil(max / unit) * unit, step };
};

export function GraphView({ node }: { node: ProjectNode }) {
  const { nodes, updateGraph, updateTable } = useProjectStore();
  const type = node.graphType!;
  const family = GRAPHS[type].family;
  const parent = node.parentId ? nodes[node.parentId] : undefined;
  const data = parent?.data;
  // Merged over the defaults, so options added after a file was saved have a value.
  const options = { ...DEFAULT_GRAPH_OPTIONS, ...node.graphOptions };
  const set = (patch: Partial<GraphOptions>) => updateGraph(node.id, { ...options, ...patch });
  const setSeriesColor = (key: string, color: PaletteColor | undefined) => {
    if (parent && data) updateTable(parent.id, withSeriesColor(data, key, color), "Color");
  };

  const containerRef = React.useRef<HTMLDivElement>(null);
  const plottedRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const openAnalysisPicker = useOpenAnalysisPicker();
  // The saved size, and a live preview while dragging an axis.
  const size: Size = { width: options.width, height: options.height };
  const [drag, setDrag] = React.useState<Size | null>(null);
  const [zoom, setZoom] = React.useState(1);
  // What Plotly actually drew: its auto axis ranges (shown while the panel's
  // fields are on Auto) and its margins, which grow for long labels and place
  // the resize grab zones on the real axes.
  const [autoX, setAutoX] = React.useState<Range | null>(null);
  const [autoY, setAutoY] = React.useState<Range | null>(null);
  const [margins, setMargins] = React.useState<Margins | null>(null);

  // ── Data ─────────────────────────────────────────────────────────────

  const dataset = data ? readTable(data) : null;
  const columns = React.useMemo(() => (dataset ? plotColumns(dataset, type) : []), [dataset, type]);
  const hasData = columns.some((c) => c.values.length > 0);

  // A volcano on a grouped table: Helix computes the DEGs between two of its groups
  // (per-row Welch t test + BH FDR) and plots them, read like any other table.
  const volcanoGroups = family === "volcano" && parent?.tableType === "grouped" && dataset
    ? groupsOf(dataset.numeric).map((g) => g.name)
    : undefined;
  const volcanoColumns = React.useMemo(() => {
    if (!volcanoGroups || !data) return columns;
    const pick = (name: string | undefined, fallback: string | undefined) =>
      name && volcanoGroups.includes(name) ? name : fallback;
    const a = pick(options.volcanoGroupA, volcanoGroups[0]);
    const b = pick(options.volcanoGroupB, volcanoGroups[1]);
    const deg = a && b && a !== b ? computeGroupedDEG(data, a, b, options.volcanoEffect) : [];
    const rows = deg.map((d) => [null, d.label, String(d.log2FC), String(d.p), String(d.padj)]);
    return readTable({ columns: ["Title", "Gene", "Log2 FC", "P", "FDR"], rows }).columns;
  }, [columns, data, volcanoGroups?.join("\n"), options.volcanoGroupA, options.volcanoGroupB, options.volcanoEffect]);

  // The series drawn, one row each in the Colors panel — the table's color menu
  // uses the same list. A heatmap or a volcano has no per-series colors.
  const seriesNames =
    family === "heatmap" || family === "volcano" || !data || !parent?.tableType ? [] : seriesOf(data, parent.tableType);

  // ── Overlays from the table's analyses ───────────────────────────────

  const analyses = Object.values(nodes).filter((n) => n.type === "analysis" && n.parentId === node.parentId);
  // Significance brackets read the chosen analysis's own result (the one its view shows).
  const sigAnalysis = options.sigAnalysisId ? nodes[options.sigAnalysisId] : undefined;
  const sigOutcome = useAnalysis(
    family === "column" ? sigAnalysis?.analysisType : undefined,
    data,
    sigAnalysis?.analysisParams,
  );
  const comparisons = React.useMemo(
    () => deriveComparisons(sigOutcome, columns.map((c) => c.name)),
    [sigOutcome, columns],
  );
  const regParams = (options.regAnalysisId ? nodes[options.regAnalysisId]?.analysisParams : undefined) as
    | LinearRegressionParams
    | undefined;
  // A dose-response graph fits its own curve (no analysis node needed).
  const doseY = options.doseY ?? columns[1]?.name;
  const doseOutcome = useAnalysis(
    type === "dose-response" && doseY ? "nonlinear-regression" : undefined,
    data,
    { y: doseY, model: options.doseModel },
  );
  const doseFit = doseOutcome && !("error" in doseOutcome) ? doseOutcome : null;

  // ── Drawing ──────────────────────────────────────────────────────────

  // Ctrl+scroll or a pinch zooms the view. A non-passive listener, so the page
  // itself doesn't zoom.
  React.useEffect(() => {
    const el = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clamp(z * (1 - e.deltaY * 0.01), 0.5, 2.5));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Draws at the committed size. `Plotly.react` updates the chart in place, and an
  // explicit width and height make every draw a full, deterministic layout.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasData) return;
    let current = true;
    void loadPlotly().then(async (Plotly) => {
      if (!current) return;
      // The grouped volcano maps the computed DEG columns onto its axes.
      const buildOptions = volcanoGroups
        ? { ...options, volcanoLabel: "Gene", volcanoX: "Log2 FC", volcanoY: options.volcanoSignificance === "fdr" ? "FDR" : "P" }
        : options;
      const fig = GRAPHS[type].build(volcanoColumns, buildOptions, data?.seriesColors, data?.pointColors, dataset?.titles);
      if (family === "column" && options.sigAnalysisId) addSignificance(fig, columns, type, options, comparisons);
      if (type === "xy-scatter" && options.regAnalysisId) addRegression(fig, columns, options, regParams, data?.seriesColors);
      if (doseFit) addDoseCurve(fig, columns, options, doseFit, data?.seriesColors);
      await Plotly.react(
        el,
        fig.data,
        { ...fig.layout, ...size },
        { displayModeBar: false, scrollZoom: false, doubleClick: false },
      );
      plottedRef.current = el;
      if (!current) return;
      const drawn = (el as { _fullLayout?: PlotlyLayout })._fullLayout;
      if (drawn?.xaxis?.range) setAutoX(niceRange(drawn.xaxis.range, drawn.xaxis.dtick));
      if (drawn?.yaxis?.range) setAutoY(niceRange(drawn.yaxis.range, drawn.yaxis.dtick));
      if (drawn?._size) setMargins(drawn._size);
    });
    return () => {
      current = false;
    };
  }, [type, hasData, volcanoColumns, node.graphOptions, comparisons, regParams, doseFit, data?.seriesColors, data?.pointColors]);

  // Frees Plotly's resources when the chart disappears (no data, or leaving the view).
  React.useEffect(() => {
    if (hasData) return;
    const el = plottedRef.current;
    plottedRef.current = null;
    if (el) void loadPlotly().then((Plotly) => Plotly.purge(el));
  }, [hasData]);
  React.useEffect(
    () => () => {
      const el = plottedRef.current;
      if (el) void loadPlotly().then((Plotly) => Plotly.purge(el));
    },
    [],
  );

  // Dragging an axis: X changes the width, Y the height. Only the outline follows
  // the pointer; the size is committed (and saved) on release.
  const onResize = (e: React.PointerEvent, axis: "x" | "y") => {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ...size };
    let next = size;
    const onMove = (ev: PointerEvent) => {
      // Screen pixels are divided by the view zoom.
      next = {
        width: axis === "x" ? clamp(start.width + (ev.clientX - start.x) / zoom, GRAPH_SIZE.minWidth, GRAPH_SIZE.maxWidth) : start.width,
        height: axis === "y" ? clamp(start.height + (start.y - ev.clientY) / zoom, GRAPH_SIZE.minHeight, GRAPH_SIZE.maxHeight) : start.height,
      };
      setDrag(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      set(next);
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const box = drag ?? size;
  const m = margins ?? marginsFor(options); // until Plotly reports the real ones

  return (
    <WithInspector
      title={node.name}
      tag={GRAPHS[type].label}
      inspector={
        <FormatPanel
          graphType={type}
          tableType={parent?.tableType}
          options={options}
          set={set}
          analyses={analyses}
          comparisons={comparisons}
          seriesNames={seriesNames}
          seriesColors={data?.seriesColors}
          setSeriesColor={setSeriesColor}
          volcanoGroups={volcanoGroups}
          numericNames={dataset?.numeric.map((c) => c.name) ?? []}
          allNames={dataset?.columns.map((c) => c.name) ?? []}
          autoX={autoX}
          autoY={autoY}
          doseError={doseOutcome && "error" in doseOutcome ? doseOutcome.error : null}
          onNewAnalysis={() => node.parentId && openAnalysisPicker(node.parentId)}
          canExport={hasData}
          onSave={(format) => plottedRef.current && saveGraphImage(plottedRef.current, size, format, node.name)}
          onCopy={() => plottedRef.current && copyGraphImage(plottedRef.current, size)}
        />
      }
    >
      <div ref={canvasRef} className="relative min-h-0 flex-1 overflow-auto bg-desk">
        {hasData ? (
          <div className="flex min-h-full w-max min-w-full items-center justify-center p-12">
            {/* The sheet: exactly the exported image, white or checked (transparent). Zoomed, it
                takes its zoomed size, so the view scrolls to every edge of it. */}
            <div className="relative shrink-0" style={{ width: box.width * zoom, height: box.height * zoom }}>
              <div
                className={cn("absolute top-0 left-0 shadow-sheet", options.background === "transparent" ? "checkerboard" : "bg-white")}
                style={{ ...box, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
              >
                {/* The plot, at the committed size; hidden while an axis is dragged. */}
                <div ref={containerRef} className={cn(drag && "invisible")} style={size} />
                {drag && (
                  <svg className="pointer-events-none absolute inset-0" width={drag.width} height={drag.height}>
                    <path
                      d={`M${m.l} ${m.t}V${drag.height - m.b}H${drag.width - m.r}`}
                      fill="none"
                      stroke={INK}
                      strokeWidth={1.5}
                    />
                  </svg>
                )}
                {/* Invisible grab zones on the axes: the cursor is the only hint. */}
                <div
                  onPointerDown={(e) => onResize(e, "x")}
                  role="slider"
                  aria-label="Resize width"
                  title="Drag the X axis to resize"
                  className="absolute z-10 cursor-ew-resize rounded-full hover:bg-support-blue/10"
                  style={{ left: m.l, right: m.r, bottom: m.b - 7, height: 14 }}
                />
                <div
                  onPointerDown={(e) => onResize(e, "y")}
                  role="slider"
                  aria-label="Resize height"
                  title="Drag the Y axis to resize"
                  className="absolute z-10 cursor-ns-resize rounded-full hover:bg-support-blue/10"
                  style={{ left: m.l - 7, width: 14, top: m.t, bottom: m.b }}
                />
                {/* Its size, under it and unscaled, live while an axis is dragged. */}
                <p
                  className="absolute top-full right-0 left-0 mt-2 text-center text-small text-secondary tabular-nums"
                  style={{ transform: `scale(${1 / zoom})`, transformOrigin: "top" }}
                >
                  {Math.round(box.width)} × {Math.round(box.height)} px
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-regular text-secondary">Enter numeric data in the source table to draw this graph.</p>
          </div>
        )}
        {zoom !== 1 && (
          <button
            type="button"
            onClick={() => setZoom(1)}
            title="Reset zoom to 100%"
            className="absolute right-3 bottom-3 z-20 rounded-full bg-black/70 px-2.5 py-1 text-small text-white hover:bg-black/80"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
      </div>
    </WithInspector>
  );
}

/** The part of Plotly's resolved layout read back after drawing. */
interface PlotlyLayout {
  xaxis?: { range?: number[]; dtick?: number };
  yaxis?: { range?: number[]; dtick?: number };
  _size?: Margins;
}
