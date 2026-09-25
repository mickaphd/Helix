// Dose-response curve overlay: evaluates the sigmoidal 4PL fit (computed by the
// "Nonlinear regression" analysis via WebR nls()) at evenly spaced X points for
// plotting — no re-fitting here, just the closed-form 4PL equation applied to the
// returned coefficients.
import type { GraphOptions } from "../../store/types";
import type { AnalysisResult, RegressionCoefficient, StatRow } from "../../stats/types";
import { pairUp, type Column } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { num } from "../../lib/format";
import { addNote, extent, seriesColor, type SeriesColors } from "./plot-helpers";

type DoseModel = GraphOptions["doseModel"];

function coef(coefficients: RegressionCoefficient[], term: string): number {
  return coefficients.find((c) => c.term === term)?.estimate ?? NaN;
}

function evaluate(model: DoseModel, coefficients: RegressionCoefficient[], x: number): number {
  const bottom = coef(coefficients, "Bottom");
  const top = coef(coefficients, "Top");
  const hill = coef(coefficients, "HillSlope");
  return model === "sigmoidal-4pl-logx"
    ? bottom + (top - bottom) / (1 + 10 ** ((coef(coefficients, "LogEC50") - x) * hill))
    : bottom + (top - bottom) / (1 + (coef(coefficients, "EC50") / x) ** hill);
}

/** Evenly-spaced points across [xMin, xMax] tracing the fitted 4PL curve. */
function doseResponseCurve(
  model: DoseModel,
  coefficients: RegressionCoefficient[],
  xMin: number,
  xMax: number,
  steps = 100,
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const x0 = xMin + ((xMax - xMin) * i) / steps;
    x.push(x0);
    y.push(evaluate(model, coefficients, x0));
  }
  return { x, y };
}


/** "EC50 = 12.3<br>Hill slope = 1.05<br>R²=0.9821" annotation text (Plotly-ready). */
function doseResponseLabel(model: DoseModel, coefficients: RegressionCoefficient[], stats: StatRow[]): string {
  const ec50 = model === "sigmoidal-4pl-logx" ? 10 ** coef(coefficients, "LogEC50") : coef(coefficients, "EC50");
  const hill = coef(coefficients, "HillSlope");
  const r2 = stats.find((s) => s.label === "R squared")?.value;
  const lines = [`EC50 = ${num(ec50)}`, `Hill slope = ${num(hill)}`];
  if (r2 != null) lines.push(`R²=${num(r2)}`);
  return lines.join("<br>");
}

/** Draws the fitted curve (and its EC50/Hill slope note) of the chosen Y series
 *  (`columns` = X, then the Y series), under the points. */
export function addDoseCurve(
  fig: GraphFigure,
  columns: Column[],
  options: GraphOptions,
  fit: AnalysisResult,
  seriesColors: SeriesColors,
) {
  const [x, ...ys] = columns;
  const y = ys.find((c) => c.name === options.doseY) ?? ys[0];
  const coefficients = fit.coefficients ?? [];
  if (!x || !y || !coefficients.length || !options.doseShowCurve) return;
  const xs = pairUp(x, y).x;
  if (!xs.length) return;
  const curve = doseResponseCurve(options.doseModel, coefficients, ...extent(xs));
  fig.data = [
    {
      type: "scatter",
      mode: "lines",
      x: curve.x,
      y: curve.y,
      line: { color: seriesColor(seriesColors, y.name, ys.indexOf(y)), width: 1.5 },
      hoverinfo: "skip",
      showlegend: false,
    },
    ...fig.data,
  ];
  if (options.doseShowEquation) addNote(fig, doseResponseLabel(options.doseModel, coefficients, fit.stats), options.fontSize);
}
