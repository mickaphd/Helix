// Host for a graph node: reads the parent table (lib/dataset.ts), draws the chart
// with Plotly on a sheet (exactly the exported image), and shows the Format panel.
// The graph is resized by grabbing an axis (X = width, Y = height) or by typing its
// size under Export: during a drag only a light axis outline follows, and the plot
// redraws once on release. Ctrl+scroll or a pinch zooms the view only, round the pointer.
import * as React from "react";
import { cn } from "../../ui/controls";
import { WithInspector } from "../../components/common/inspector";
import { DEFAULT_GRAPH_OPTIONS, SAME_AS_FILL, type GraphOptions, type PointStyle, type ProjectNode, type SeriesStyle } from "../../store/types";
import type { LinearRegressionParams } from "../../stats/types";
import { useProjectStore } from "../../store/use-project-store";
import { groupsOf, readTable } from "../../lib/dataset";
import { paletteOf } from "../../lib/palettes";
import { computeGroupedDEG } from "../../lib/deg";
import { useAnalysis } from "../analyses/use-analysis";
import { GRAPHS, graphSeries, plotColumns } from ".";
import { addDoseCurve } from "./dose-response-curve";
import { FormatPanel } from "./format-panel";
import { copyGraphImage, saveGraphImage } from "./graph-export";
import { GRAPH_SIZE, INK, MOVABLE, marginsFor, movedText, paintOf, withCaps } from "./plot-helpers";
import { useOpenAnalysisPicker } from "../analyses/use-analysis-launcher";
import { loadPlotly } from "./plotly";
import { addRegression } from "./regression-overlay";
import { addSignificance, deriveComparisons } from "./significance-overlay";
import { drawnKeys, drawnStyle, keysOf, picked, pointLabels, resizePoints, selectionRing, stylePoints } from "./selection";
import { chooseSelectionStyle } from "./style-menus";
import { genesNamed } from "./volcano";

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
  const { nodes, updateGraph } = useProjectStore();
  const type = node.graphType!;
  const family = GRAPHS[type].family;
  const parent = node.parentId ? nodes[node.parentId] : undefined;
  const data = parent?.data;
  // Merged over the defaults, so options added after a file was saved have a value.
  const options = { ...DEFAULT_GRAPH_OPTIONS, ...node.graphOptions };
  // A setting chosen again (a choice already on) changes nothing, and leaves no Undo step.
  const set = (patch: Partial<GraphOptions>) => {
    const same = (Object.keys(patch) as (keyof GraphOptions)[]).every((k) => JSON.stringify(patch[k]) === JSON.stringify(options[k]));
    if (!same) updateGraph(node.id, { ...options, ...patch });
  };
  // A series styled by hand (the Series section's Reset puts them all back).
  const setSeriesStyle = (key: string, style: SeriesStyle) =>
    set({ series: { ...options.series, [key]: { ...options.series?.[key], ...style } } });

  // The points picked on the graph, by key: a click picks one, ⌘- or ⇧-click adds or
  // removes one, a click elsewhere or Escape clears them. Never saved, never undone;
  // another graph starts with none (the view is rebuilt per graph).
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const clearSelection = () => setSelected((s) => (s.size ? new Set() : s));
  const styleSelected = (keys: ReadonlySet<string>, style: PointStyle | null) =>
    set({ points: stylePoints(options.points, keys, style) });

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
    // One row per table row, so a gene keeps its row's number (its key, see volcano.ts).
    const rows: (string | null)[][] = data.rows.map(() => []);
    for (const d of deg) rows[d.row] = [null, d.label, String(d.log2FC), String(d.p), String(d.padj)];
    return readTable({ columns: ["Title", "Gene", "Log2 FC", "P", "FDR"], rows }).columns;
  }, [columns, data, volcanoGroups?.join("\n"), options.volcanoGroupA, options.volcanoGroupB, options.volcanoEffect]);

  // The series drawn, one row each in the Series section.
  const seriesNames = data && parent?.tableType ? graphSeries(type, data, parent.tableType) : [];

  // The grouped volcano maps the computed DEG columns onto its axes.
  const buildOptions = volcanoGroups
    ? { ...options, volcanoLabel: "Gene", volcanoX: "Log2 FC", volcanoY: options.volcanoSignificance === "fdr" ? "FDR" : "P" }
    : options;

  // The figure's traces as last drawn, without the selection ring.
  const [drawn, setDrawn] = React.useState<unknown[]>([]);
  // Each point made bigger or smaller from the size it is drawn at.
  const resizeSelected = (keys: ReadonlySet<string>, by: number) => set({ points: resizePoints(options.points, drawn, keys, by) });
  // A point's style as the figure draws it, its outline color as chosen, and its name shown or not.
  const styleOf = (key: string) => {
    const style = drawnStyle(drawn, key);
    const own = options.points?.[key];
    return style && { ...style, outlineColor: own?.outlineColor ?? options.pointOutlineColor ?? SAME_AS_FILL, label: own?.label ?? false };
  };
  const firstSelected = selected.values().next().value;
  const firstStyle = firstSelected === undefined ? undefined : styleOf(firstSelected);

  // The genes named in the Find gene field become the selection; returns the names no gene has.
  const findGenes = (query: string) => {
    const { keys, missing } = genesNamed(volcanoColumns, buildOptions, query);
    setSelected(new Set(keys));
    return missing;
  };

  // The right-click menu of the selected points; a point clicked outside them is picked first.
  const openSelectionMenu = (key: string | null) => {
    const keys = key && !selected.has(key) ? new Set([key]) : selected;
    if (keys !== selected) setSelected(keys);
    const first = keys.values().next().value;
    const style = first && styleOf(first);
    if (!style) return;
    void chooseSelectionStyle(paletteOf(options), style, {
      style: (style) => styleSelected(keys, style),
      resize: (by) => resizeSelected(keys, by),
      reset: () => styleSelected(keys, null),
    });
  };

  // Plotly reports clicks, hovers and dragged-over points on the plot; the handlers it
  // calls read the latest state through these refs (they are set once, when the plot is
  // first drawn). A drag over the plot picks the points in its rectangle; ⌘ or ⇧, held
  // as it starts, adds them to the selection.
  const hovered = React.useRef<string | null>(null);
  const pointClicked = React.useRef(false);
  const dragAdds = React.useRef(false);
  // Pressed on the plot and not yet a click: only then is Plotly's report of dragged-over
  // points the user's. It reports an empty one too when a redraw clears its rectangle.
  const pressed = React.useRef(false);
  const onPlotClick = React.useRef((_key: string, _add: boolean) => {});
  const onPlotSelect = React.useRef((_keys: string[]) => {});
  const onPlotMove = React.useRef((_moved: PlotMove, _names: (string | undefined)[]) => {});
  React.useEffect(() => {
    // A text dropped where it now stays: the legend (or color legend), the note, or a
    // point's name, kept with its style.
    onPlotMove.current = (moved, names) => {
      const text = movedText(moved, names);
      if (text) pressed.current = false; // the press moved a text: no points were dragged over
      if (text?.name === "legend") set({ legend: text.at });
      else if (text?.name === "note") set({ note: text.at });
      else if (text) set({ points: stylePoints(options.points, [text.name], { labelOffset: text.at }) });
    };
    onPlotClick.current = (key, add) => {
      pointClicked.current = true;
      setSelected((s) => {
        if (!add) return new Set([key]);
        const next = new Set(s);
        if (!next.delete(key)) next.add(key);
        return next;
      });
    };
    onPlotSelect.current = (keys) => {
      if (!pressed.current) return;
      pressed.current = false;
      setSelected((s) => picked(s, keys, dragAdds.current));
    };
  });
  // Escape clears the selection, unless it's for a field being typed in.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // Ctrl+scroll or a pinch zooms the view round the pointer: the spot of the sheet under
  // it (`anchor`, a fraction of the sheet) stays there, the view scrolling once the sheet
  // has its new size. A non-passive listener, so the page itself doesn't zoom.
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const anchor = React.useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  React.useEffect(() => {
    const el = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = sheetRef.current?.getBoundingClientRect();
      if (r) anchor.current = { x: e.clientX, y: e.clientY, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
      setZoom((z) => clamp(z * (1 - e.deltaY * 0.01), 0.25, 4)); // 25 % to 400 %, as in Pages
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  React.useLayoutEffect(() => {
    const a = anchor.current;
    const r = sheetRef.current?.getBoundingClientRect();
    const view = canvasRef.current;
    anchor.current = null;
    if (!a || !r || !view) return;
    view.scrollLeft += r.left + a.fx * r.width - a.x;
    view.scrollTop += r.top + a.fy * r.height - a.y;
  }, [zoom]);

  // The volcano's points are WebGL pixels, not shapes: once a zoom gesture ends, they are
  // redrawn at the screen's resolution times the zoom (Plotly allows up to 4), so they stay sharp.
  const [settledZoom, setSettledZoom] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => setSettledZoom(zoom), 200);
    return () => clearTimeout(t);
  }, [zoom]);
  const glRatio = family === "volcano" ? clamp(Math.ceil(devicePixelRatio * settledZoom * 2) / 2, 1, 4) : 2;

  /** Follows the plot's clicks, hovers and dragged-over points (once per drawn element). */
  const listen = (el: PlotElement) => {
    el.on("plotly_click", (e) => {
      const [key] = keysOf(e.points);
      if (key) onPlotClick.current(key, e.event.metaKey || e.event.shiftKey);
    });
    el.on("plotly_hover", (e) => (hovered.current = keysOf(e.points)[0] ?? null));
    el.on("plotly_unhover", () => (hovered.current = null));
    // Without an event: the drag was undone (Plotly's own double-click), nothing picked.
    el.on("plotly_selected", (e) => e && onPlotSelect.current(keysOf(e.points)));
    // A text moved by hand; a color legend's move comes as a restyle of its trace.
    const names = () => (el.layout.annotations ?? []).map((a) => a.name);
    el.on("plotly_relayout", (moved) => onPlotMove.current(moved, names()));
    el.on("plotly_restyle", ([moved]) => onPlotMove.current(moved, names()));
  };

  // Draws at the committed size. `Plotly.react` updates the chart in place, and an
  // explicit width and height make every draw a full, deterministic layout.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasData) return;
    let current = true;
    void loadPlotly().then(async (Plotly) => {
      if (!current) return;
      const paint = paintOf(options, seriesNames.length);
      const fig = GRAPHS[type].build(volcanoColumns, buildOptions, paint, dataset?.titles);
      fig.data = withCaps(fig.data, options);
      if (family === "column" && options.sigAnalysisId) addSignificance(fig, columns, type, options, comparisons);
      if (type === "xy-scatter" && options.regAnalysisId) addRegression(fig, columns, options, regParams, paint);
      if (doseFit) addDoseCurve(fig, columns, options, doseFit, paint);
      // The points' names are part of the figure (the volcano places its own, among the
      // genes it names); the selection ring only of the view.
      const labels = family === "volcano" ? [] : pointLabels(fig.data, options.points, dataset?.titles, options.fontSize);
      if (labels.length) fig.layout.annotations = [...((fig.layout.annotations as unknown[]) ?? []), ...labels];
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent");
      const ring = selectionRing(fig.data, selected, accent);
      // A graph of individual points picks them by dragging; the others stay still.
      const keys = drawnKeys(fig.data);
      if (keys.size) fig.layout.dragmode = "select";
      await Plotly.react(
        el,
        ring ? [...fig.data, ring] : fig.data,
        { ...fig.layout, ...size },
        { displayModeBar: false, scrollZoom: false, doubleClick: false, plotGlPixelRatio: glRatio, edits: MOVABLE },
      );
      if (plottedRef.current !== el) listen(el as PlotElement);
      plottedRef.current = el;
      if (!current) return;
      setDrawn(fig.data);
      // A selected point that's no longer drawn (its row deleted…) leaves the selection.
      if ([...selected].some((key) => !keys.has(key))) setSelected(new Set([...selected].filter((key) => keys.has(key))));
      const resolved = (el as { _fullLayout?: PlotlyLayout })._fullLayout;
      if (resolved?.xaxis?.range) setAutoX(niceRange(resolved.xaxis.range, resolved.xaxis.dtick));
      if (resolved?.yaxis?.range) setAutoY(niceRange(resolved.yaxis.range, resolved.yaxis.dtick));
      if (resolved?._size) setMargins(resolved._size);
    });
    return () => {
      current = false;
    };
  }, [type, hasData, volcanoColumns, node.graphOptions, comparisons, regParams, doseFit, seriesNames.length, selected, glRatio]);

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
      window.removeEventListener("pointercancel", onUp);
      set(next);
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
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
          setSeriesStyle={setSeriesStyle}
          selection={
            firstStyle && {
              count: selected.size,
              style: firstStyle,
              styled: [...selected].some((key) => options.points?.[key]),
              set: (style) => styleSelected(selected, style),
              resize: (by) => resizeSelected(selected, by),
              reset: () => styleSelected(selected, null),
            }
          }
          volcanoGroups={volcanoGroups}
          onFindGenes={findGenes}
          numericNames={dataset?.numeric.map((c) => c.name) ?? []}
          allNames={dataset?.columns.map((c) => c.name) ?? []}
          autoX={autoX}
          autoY={autoY}
          doseError={doseOutcome && "error" in doseOutcome ? doseOutcome.error : null}
          onNewAnalysis={() => node.parentId && openAnalysisPicker(node.parentId)}
          canExport={hasData}
          onSave={(format, dpi) => plottedRef.current && saveGraphImage(plottedRef.current, size, format, dpi, node.name)}
          onCopy={(dpi) => plottedRef.current && copyGraphImage(plottedRef.current, size, dpi)}
        />
      }
    >
      {/* The desk scrolls; the zoom level stays in its corner, over it. */}
      <div className="relative min-h-0 flex-1">
        <div ref={canvasRef} className="absolute inset-0 overflow-auto bg-desk">
          {hasData ? (
            <div className="flex min-h-full w-max min-w-full items-center justify-center p-12">
              {/* The sheet: exactly the exported image, white or checked (transparent). Zoomed, it
                  takes its zoomed size, so the view scrolls to every edge of it. */}
              <div ref={sheetRef} className="relative shrink-0" style={{ width: box.width * zoom, height: box.height * zoom }}>
                <div
                  className={cn("absolute top-0 left-0 shadow-sheet", options.background === "transparent" ? "checkerboard" : "bg-white")}
                  style={{ ...box, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
                >
                  {/* The plot, at the committed size; hidden while an axis is dragged. A click
                      that hit no point clears the selection; a right-click opens its menu. A
                      right press (or Control-click) never reaches Plotly: it would start a drag
                      and cover the window, a cover macOS never lifts after a context menu. */}
                  <div
                    ref={containerRef}
                    className={cn(drag && "invisible")}
                    style={size}
                    onMouseDownCapture={(e) => {
                      if (e.button === 2 || e.ctrlKey) return e.stopPropagation();
                      pressed.current = true;
                      dragAdds.current = e.metaKey || e.shiftKey;
                    }}
                    onClick={() => {
                      if (!pointClicked.current) clearSelection();
                      pointClicked.current = false;
                      pressed.current = false;
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openSelectionMenu(hovered.current);
                    }}
                  />
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
                    className="absolute z-10 cursor-ew-resize rounded-full hover:bg-accent/10"
                    style={{ left: m.l, right: m.r, bottom: m.b - 7, height: 14 }}
                  />
                  <div
                    onPointerDown={(e) => onResize(e, "y")}
                    role="slider"
                    aria-label="Resize height"
                    title="Drag the Y axis to resize"
                    className="absolute z-10 cursor-ns-resize rounded-full hover:bg-accent/10"
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
        </div>
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

/** A drawn plot, which reports what happens on its points and texts. */
interface PlotEvent {
  points: { customdata?: unknown }[];
  event: MouseEvent;
}
/** What Plotly reports of a text moved: its new place, by attribute ("legend.x"…). */
type PlotMove = Record<string, number | undefined>;
type PlotElement = HTMLDivElement & {
  layout: { annotations?: { name?: string }[] };
  on(name: "plotly_relayout", handler: (moved: PlotMove) => void): void;
  on(name: "plotly_restyle", handler: (update: [PlotMove, number[]]) => void): void;
  on(name: string, handler: (e: PlotEvent) => void): void;
};

/** The part of Plotly's resolved layout read back after drawing. */
interface PlotlyLayout {
  xaxis?: { range?: number[]; dtick?: number };
  yaxis?: { range?: number[]; dtick?: number };
  _size?: Margins;
}
