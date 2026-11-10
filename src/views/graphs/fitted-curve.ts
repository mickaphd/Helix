// A fitted curve drawn over an XY graph's points: the "Nonlinear regression" analysis's
// coefficients (computed by R's nls() or lm()) put in the model's equation at evenly spaced X,
// no re-fitting here: an XY scatter draws the curve of a nonlinear regression of its table.
import type { GraphOptions } from "../../store/types";
import type { AnalysisResult, NonlinearModel, RegressionCoefficient } from "../../stats/types";
import { positiveXOnly, termLabel } from "../../stats/xy/nonlinear-regression";
import { pairUp, type Column } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { num } from "../../lib/format";
import { addNote, extent, type Paint } from "./plot-helpers";

function coef(coefficients: RegressionCoefficient[], term: string): number {
  return coefficients.find((c) => c.term === term)?.estimate ?? NaN;
}

/** The fitted curve at `x`: the model's equation (nonlinear-regression.ts) with its coefficients. */
export function evaluate(model: NonlinearModel, coefficients: RegressionCoefficient[], x: number): number {
  const c = (term: string) => coef(coefficients, termLabel(term));
  const [bottom, top, hill, s] = [c("Bottom"), c("Top"), c("HillSlope"), c("S")];
  const rise = top - bottom;
  switch (model) {
    case "sigmoidal-4pl-logx":
      return bottom + rise / (1 + 10 ** ((c("LogEC50") - x) * hill));
    case "sigmoidal-4pl-x":
      return bottom + rise / (1 + (c("EC50") / x) ** hill);
    case "agonist-3pl-logx":
      return bottom + rise / (1 + 10 ** (c("LogEC50") - x));
    case "inhibitor-3pl-logx":
      return bottom + rise / (1 + 10 ** (x - c("LogIC50")));
    case "asymmetric-5pl-logx":
      return bottom + rise / (1 + 10 ** ((c("LogEC50") + Math.log10(2 ** (1 / s) - 1) / hill - x) * hill)) ** s;
    case "asymmetric-5pl-x":
      return bottom + rise / (1 + ((c("EC50") * (2 ** (1 / s) - 1) ** (1 / hill)) / x) ** hill) ** s;
    case "line":
      return c("Intercept") + c("Slope") * x;
    case "semilog-line":
      return c("Intercept") + c("Slope") * Math.log(x);
    case "hyperbola":
      return (c("Bmax") * x) / (c("Kd") + x);
    case "quadratic":
      return c("B0") + c("B1") * x + c("B2") * x ** 2;
    case "cubic":
      return c("B0") + c("B1") * x + c("B2") * x ** 2 + c("B3") * x ** 3;
    case "exponential-growth":
      return c("Y0") * Math.exp(c("K") * x);
    case "one-phase-decay":
      return (c("Y0") - c("Plateau")) * Math.exp(-c("K") * x) + c("Plateau");
    case "michaelis-menten":
      return (c("Vmax") * x) / (c("Km") + x);
  }
}

/** Evenly-spaced points across [xMin, xMax] tracing the fitted curve. */
function fittedCurve(
  model: NonlinearModel,
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

/** "EC50 = 12.3<br>Hill slope = 1.05<br>R² = 0.9821" annotation text (Plotly-ready), as the
 *  analysis reports them: its derived values (an EC50, a half-life…, not a Span), then the
 *  coefficients they don't already say (a dose-response's Bottom, Top and log midpoint),
 *  then R². */
function curveLabel(fit: AnalysisResult): string {
  const rows = fit.fit?.rows ?? [];
  const derived = rows.filter(
    (r) => r.values && r.label !== "Span" && rows.indexOf(r) < rows.findIndex((x) => x.label === "R squared"),
  );
  const said = new Set(["Bottom", "Top", "LogEC50", "LogIC50"]);
  const lines = [
    ...derived.map((r) => `${r.label} = ${num(r.values![0])}`),
    ...(fit.coefficients ?? []).filter((c) => !said.has(c.term)).map((c) => `${c.term} = ${num(c.estimate)}`),
  ];
  const r2 = rows.find((r) => r.label === "R squared")?.values?.[0];
  if (r2 != null) lines.push(`R² = ${num(r2)}`);
  return lines.join("<br>");
}

/** Draws `model`'s fitted curve of `y` against `x` under the points, in `y`'s color (`ys`,
 *  the graph's Y series, places it in the palette), and its note when `note`. */
export function addFittedCurve(
  fig: GraphFigure,
  x: Column,
  y: Column,
  ys: Column[],
  model: NonlinearModel,
  fit: AnalysisResult,
  note: boolean,
  options: GraphOptions,
  paint: Paint,
) {
  const coefficients = fit.coefficients ?? [];
  if (!coefficients.length) return;
  const xs = pairUp(x, y).x.filter((v) => !positiveXOnly(model) || v > 0);
  if (!xs.length) return;
  const curve = fittedCurve(model, coefficients, ...extent(xs));
  fig.data = [
    {
      type: "scatter",
      mode: "lines",
      x: curve.x,
      y: curve.y,
      line: { color: paint.color(y.name, ys.indexOf(y)), width: 1.5 },
      hoverinfo: "skip",
      showlegend: false,
    },
    ...fig.data,
  ];
  if (note) addNote(fig, curveLabel(fit), options);
}
