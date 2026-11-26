// "Survival curve" (XY table): X is time, each Y series is a group. Two modes
// (options.survivalMode):
// - "codes": cells are per-subject event codes (1 = event, 0 = censored) at that
//   time; Kaplan-Meier estimator (lib/kaplan-meier.ts, shared with the Survival analysis),
//   computed in plain JS (closed-form, no WebR round-trip needed).
// - "counts": cells are the number of survivors remaining in that group at that
//   time; plotted directly as percent-of-initial, no event/censor concept.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { pairUp, type Column } from "../../lib/dataset";
import { INK, marginsFor, XY_AXES, xyLayout, type Paint } from "./plot-helpers";
import { withOpacity } from "../../lib/palettes";
import { atRisk, kaplanMeier } from "../../lib/kaplan-meier";
import { pretty } from "../../lib/histogram";
import { maxOf } from "../../lib/summary";

/** "counts" mode: cells are survivors remaining, plotted directly as percent-of-initial. */
function survivorCountsStep(x: number[], counts: number[]): { t: number[]; s: number[] } {
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const initial = counts[order[0]] || 1;
  return { t: order.map((i) => x[i]), s: order.map((i) => (counts[i] / initial) * 100) };
}

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const [xCol, ...ySeries] = columns;
  const layout = xyLayout(options, xCol?.name ?? "Time", ySeries.length, { zeroBase: true, yName: "Percent survival" });
  if (!xCol || ySeries.length === 0) return { data: [], layout };

  const byCodes = options.survivalMode !== "counts";
  const data = ySeries.flatMap((y, i) => {
    const { x, y: values } = pairUp(xCol, y);
    const color = paint.color(y.name, i);
    // A group's curve, band and ticks are one legend item: hiding it hides them all.
    const steps = (t: number[], s: number[], style: object) => ({
      type: "scatter",
      mode: "lines",
      legendgroup: y.name,
      x: t,
      y: s,
      line: { shape: "hv", ...style },
      hoverinfo: "skip",
      showlegend: false,
    });
    if (!byCodes) {
      const { t, s } = survivorCountsStep(x, values);
      return [{ ...steps(t, s, paint.line(y.name, i)), name: y.name, hoverinfo: "x+y", showlegend: true }];
    }
    const km = kaplanMeier(x, values);
    const percent = (curve: (number | null)[]) => curve.map((v, k) => (v ?? km.s[k]) * 100);
    const traces: unknown[] = [];
    // The 95% band, under the curve; where it can't be computed (S = 1 or 0) it closes on the curve.
    if (options.survivalShowBand) {
      traces.push(steps(km.t, percent(km.lower), { width: 0 }), {
        ...steps(km.t, percent(km.upper), { width: 0 }),
        fill: "tonexty",
        fillcolor: withOpacity(color, 0.2), // light: the curves' bands overlap
      });
    }
    traces.push({
      ...steps(km.t, percent(km.s), paint.line(y.name, i)),
      name: y.name,
      hoverinfo: "x+y",
      showlegend: true,
    });
    if (options.survivalShowCensors && km.censorT.length) {
      traces.push({
        type: "scatter",
        mode: "markers",
        name: y.name,
        legendgroup: y.name,
        x: km.censorT,
        y: percent(km.censorS),
        marker: { color, size: 9, symbol: "line-ns-open", line: { width: 1.5 } },
        showlegend: false,
        hoverinfo: "skip",
      });
    }
    return traces;
  });

  // The groups in table order: Plotly would list them backwards once a band fills.
  const figure = { data, layout: { ...layout, legend: { ...(layout.legend as object), traceorder: "normal" } } };
  return byCodes && options.survivalAtRisk && options.xScale === "linear"
    ? withAtRisk(figure, xCol, ySeries, options, paint)
    : figure;
}

/** The number at risk under the plot: a row per group, a count at each X tick, as journals
 *  print it, in black (a light color would read badly), each name with its color. The ticks are set (R's pretty(), or the typed step) so the counts sit under
 *  them; the plot is raised to leave room for its axis and the table (a subplot whose
 *  axis names the groups, so the left margin fits them). */
function withAtRisk(figure: GraphFigure, xCol: Column, ySeries: Column[], options: GraphOptions, paint: Paint) {
  const times = ySeries.map((y) => pairUp(xCol, y).x);
  const last = Math.max(0, maxOf(times.flat()));
  const lo = options.xMin ?? 0;
  const hi = options.xMax ?? pretty(lo, Math.max(last, lo + 1), 5, 1).at(-1)!;
  if (!(hi > lo)) return figure;
  const step = options.xStep && options.xStep > 0 && (hi - lo) / options.xStep <= 50 ? options.xStep : undefined;
  const ticks = step
    ? Array.from({ length: Math.floor((hi - lo) / step + 1e-9) + 1 }, (_, k) => lo + k * step)
    : pretty(lo, hi, 5, 1).filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9);
  // Heights in px over the plot area's (the figure less its margins).
  const row = options.fontSize * 1.5;
  const axis =
    5 + options.fontSize * 1.3 + (options.xLabel || xCol.name ? options.xTitleGap + options.fontSize * 1.3 : 0);
  const m = marginsFor(options);
  const area = Math.max(1, options.height - m.t - m.b);
  const table = (row * ySeries.length) / area;
  const top = Math.min(0.8, table + (row + axis + 12) / area);
  const layout = figure.layout as Record<string, Record<string, unknown>>;
  const rows = ySeries.map((y, i) => ({
    type: "scatter",
    mode: "text",
    legendgroup: y.name,
    x: ticks,
    y: ticks.map(() => i),
    yaxis: "y2",
    text: ticks.map((t) => String(atRisk(times[i], t))),
    textfont: { color: INK, size: options.fontSize },
    cliponaxis: false,
    hoverinfo: "skip",
    showlegend: false,
  }));
  return {
    data: [...figure.data, ...rows],
    layout: {
      ...layout,
      xaxis: { ...layout.xaxis, range: [lo, hi], autorange: false, tickvals: ticks, dtick: undefined },
      yaxis: { ...layout.yaxis, domain: [top, 1] },
      yaxis2: {
        domain: [0, table],
        anchor: "x",
        range: [ySeries.length - 0.5, -0.5],
        tickvals: ySeries.map((_, i) => i),
        // Each name after a dash of its curve's color, as a legend shows it.
        ticktext: ySeries.map((y, i) => `<span style="color:${paint.color(y.name, i)}">━</span> ${y.name}`),
        showline: false,
        showgrid: false,
        zeroline: false,
        // Invisible ticks keep the names clear of the counts centered on the first tick.
        ticks: "outside",
        ticklen: options.fontSize * 1.6,
        tickcolor: "rgba(0,0,0,0)",
        fixedrange: true,
        automargin: true,
      },
      annotations: [
        ...((layout.annotations as unknown as unknown[]) ?? []),
        {
          text: "Number at risk",
          xref: "paper",
          yref: "paper",
          x: 0,
          y: table,
          xanchor: "left",
          yanchor: "bottom",
          showarrow: false,
          font: { color: INK, size: options.fontSize },
        },
      ],
    },
  };
}

export const survival: GraphModule = { label: "Survival curve", family: "xy", axes: XY_AXES, lines: () => true, build };
