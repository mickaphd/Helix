// Linear-regression overlay for the XY scatter graph: an OLS fit line + 95%
// confidence band, computed directly from the same x/y pairs the scatter plots —
// no WebR round-trip needed. OLS has one unique solution, so the slope/intercept
// here always match the sibling "Linear regression" analysis's R-computed fit
// (checked by `npm test`).
import type { GraphOptions } from "../../store/types";
import type { LinearRegressionParams } from "../../stats/types";
import { pairUp, type Column } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { num, pText } from "../../lib/format";
import { tCrit95, tTwoSidedP } from "../../lib/student-t";
import { addNote, extent, mean, seriesColor, seriesFill, type SeriesColors } from "./plot-helpers";

interface LinearFit {
  slope: number;
  intercept: number; // 0 when forced through the origin
  forceOrigin: boolean;
  n: number;
  dof: number;
  r2: number;
  p: number;
  xbar: number;
  sxx: number; // Σ(x-x̄)² (or Σx² when forced through the origin)
  s: number; // residual standard error
}

/** Ordinary least-squares fit of y on x (optionally forced through the origin), plus
 *  the slope's P value. Returns null with fewer than 3 points or a degenerate
 *  (all-identical) X — too little residual freedom for a meaningful band. */
export function fitLinear(x: number[], y: number[], forceOrigin: boolean): LinearFit | null {
  const n = x.length;
  if (n < 3) return null;
  const xbar = mean(x);
  const ybar = mean(y);
  const sxx = forceOrigin ? x.reduce((s, xi) => s + xi * xi, 0) : x.reduce((s, xi) => s + (xi - xbar) ** 2, 0);
  if (sxx === 0) return null;
  const slope = forceOrigin
    ? x.reduce((s, xi, i) => s + xi * y[i], 0) / sxx
    : x.reduce((s, xi, i) => s + (xi - xbar) * (y[i] - ybar), 0) / sxx;
  const intercept = forceOrigin ? 0 : ybar - slope * xbar;
  const ssRes = x.reduce((s, xi, i) => s + (y[i] - (intercept + slope * xi)) ** 2, 0);
  const ssTot = forceOrigin ? y.reduce((s, yi) => s + yi * yi, 0) : y.reduce((s, yi) => s + (yi - ybar) ** 2, 0);
  const dof = n - (forceOrigin ? 1 : 2);
  const s = Math.sqrt(ssRes / dof);
  const t = slope / (s / Math.sqrt(sxx));
  return { slope, intercept, forceOrigin, n, dof, r2: 1 - ssRes / ssTot, p: tTwoSidedP(t, dof), xbar, sxx, s };
}

/** Evenly-spaced points across [xMin, xMax] with the fit line + 95% confidence band
 *  (of the mean response, matching R's `predict(interval="confidence")`) at each —
 *  ready to hand to Plotly as line/fill traces. */
function regressionCurve(
  fit: LinearFit,
  xMin: number,
  xMax: number,
  steps = 60,
): { x: number[]; yFit: number[]; yLo: number[]; yHi: number[] } {
  const tCrit = tCrit95(fit.dof);
  const x: number[] = [];
  const yFit: number[] = [];
  const yLo: number[] = [];
  const yHi: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const x0 = xMin + ((xMax - xMin) * i) / steps;
    const yHat = fit.intercept + fit.slope * x0;
    const variance = fit.forceOrigin
      ? (fit.s * x0) ** 2 / fit.sxx
      : fit.s ** 2 * (1 / fit.n + (x0 - fit.xbar) ** 2 / fit.sxx);
    const half = tCrit * Math.sqrt(variance);
    x.push(x0);
    yFit.push(yHat);
    yLo.push(yHat - half);
    yHi.push(yHat + half);
  }
  return { x, yFit, yLo, yHi };
}


/** "Y = 2.927*X − 0.3322<br>R²=0.8734, P=0.0021" annotation text — Plotly-ready
 *  (line break as `<br>`), formatted the same way as the Analysis panel's equation.
 *  Always uses literal "Y"/"X" rather than the actual column names, for simplicity. */
function regressionLabel(fit: LinearFit): string {
  const term = `${num(fit.slope)}*X`;
  const eq = fit.forceOrigin
    ? `Y = ${term}`
    : `Y = ${term} ${fit.intercept < 0 ? "−" : "+"} ${num(Math.abs(fit.intercept))}`;
  return `${eq}<br>R²=${num(fit.r2)}, ${pText(fit.p)}`;
}

/** Draws a linear-regression analysis's fit on an XY scatter (`columns` = X, then
 *  the Y series): its line, 95% CI band and equation as chosen, under the points. */
export function addRegression(
  fig: GraphFigure,
  columns: Column[],
  options: GraphOptions,
  params: LinearRegressionParams | undefined,
  seriesColors: SeriesColors,
) {
  const [x, ...ys] = columns;
  const y = ys.find((c) => c.name === params?.y) ?? ys[0];
  if (!x || !y) return;
  const pairs = pairUp(x, y);
  const fit = fitLinear(pairs.x, pairs.y, params?.forceOrigin ?? false);
  if (!fit) return;
  const i = ys.indexOf(y);
  const curve = regressionCurve(fit, ...extent(pairs.x));
  const line = (yv: number[], style: object) => ({
    type: "scatter",
    mode: "lines",
    x: curve.x,
    y: yv,
    line: style,
    hoverinfo: "skip",
    showlegend: false,
  });
  const traces: unknown[] = [];
  if (options.regShowBand) {
    traces.push(line(curve.yLo, { width: 0 }), {
      ...line(curve.yHi, { width: 0 }),
      fill: "tonexty",
      fillcolor: seriesFill(seriesColors, y.name, i),
    });
  }
  if (options.regShowLine) {
    traces.push(line(curve.yFit, { color: seriesColor(seriesColors, y.name, i), width: 1.5, dash: "dash" }));
  }
  fig.data = [...traces, ...fig.data];
  if (options.regShowEquation) addNote(fig, regressionLabel(fit), options.fontSize);
}
