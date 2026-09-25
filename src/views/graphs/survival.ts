// "Survival curve" (XY table): X is time, each Y series is a group. Two modes
// (options.survivalMode):
// - "codes": cells are per-subject event codes (1 = event, 0 = censored) at that
//   time; Kaplan-Meier estimator, computed here in plain JS (closed-form, no WebR
//   round-trip needed, unlike e.g. the dose-response sigmoidal fit).
// - "counts": cells are the number of survivors remaining in that group at that
//   time; plotted directly as percent-of-initial, no event/censor concept.
import type { GraphOptions, PaletteColor } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { pairUp, type Column } from "../../lib/dataset";
import { seriesColor, xyLayout } from "./plot-helpers";

interface KaplanMeier {
  t: number[]; // step vertices (t[0] = 0, s[0] = 1)
  s: number[];
  censorT: number[]; // tick marks: subjects censored without an event
  censorS: number[];
}

function kaplanMeier(times: number[], codes: number[]): KaplanMeier {
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b]);
  const t = [0];
  const s = [1];
  const censorT: number[] = [];
  const censorS: number[] = [];
  let atRisk = times.length;
  let survival = 1;
  let i = 0;
  while (i < order.length) {
    const time = times[order[i]];
    let events = 0;
    let censored = 0;
    while (i < order.length && times[order[i]] === time) {
      if (codes[order[i]] === 1) events++;
      else censored++;
      i++;
    }
    if (events > 0) {
      survival *= 1 - events / atRisk;
      t.push(time);
      s.push(survival);
    }
    if (censored > 0) {
      censorT.push(time);
      censorS.push(survival);
    }
    atRisk -= events + censored;
  }
  return { t, s, censorT, censorS };
}

/** "counts" mode: cells are survivors remaining, plotted directly as percent-of-initial. */
function survivorCountsStep(x: number[], counts: number[]): { t: number[]; s: number[] } {
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const initial = counts[order[0]] || 1;
  return { t: order.map((i) => x[i]), s: order.map((i) => (counts[i] / initial) * 100) };
}

function build(columns: Column[], options: GraphOptions, seriesColors?: Record<string, PaletteColor>): GraphFigure {
  const [xCol, ...ySeries] = columns;
  const layout = xyLayout(options, xCol?.name ?? "Time", ySeries.length, { zeroBase: true });
  if (!options.yLabel) (layout.yaxis as Record<string, unknown>).title = { text: "Percent survival" };
  if (!xCol || ySeries.length === 0) return { data: [], layout };

  const byCodes = options.survivalMode !== "counts";
  const data = ySeries.flatMap((y, i) => {
    const { x, y: values } = pairUp(xCol, y);
    const { t, s, censorT, censorS } = byCodes
      ? kaplanMeier(x, values)
      : { ...survivorCountsStep(x, values), censorT: [], censorS: [] };
    const color = seriesColor(seriesColors, y.name, i);
    const step = {
      type: "scatter",
      mode: "lines",
      name: y.name,
      x: t,
      y: byCodes ? s.map((v) => v * 100) : s,
      line: { color, width: 2, shape: "hv" },
      hoverinfo: "x+y",
    };
    if (!byCodes || !options.survivalShowCensors || censorT.length === 0) return [step];
    return [
      step,
      {
        type: "scatter",
        mode: "markers",
        name: y.name,
        x: censorT,
        y: censorS.map((v) => v * 100),
        marker: { color, size: 9, symbol: "line-ns-open", line: { width: 1.5 } },
        showlegend: false,
        hoverinfo: "skip",
      },
    ];
  });

  return { data, layout };
}

export const survival: GraphModule = { label: "Survival curve", family: "xy", build };
