// A fitted curve drawn over an XY graph's points: the "Nonlinear regression" analysis's
// coefficients (computed by R's nls() or lm()) put in the model's equation at evenly spaced X,
// no re-fitting here: an XY scatter draws the curve of a nonlinear regression of its table.
import type { GraphOptions } from "../../store/types";
import type { AnalysisResult, NonlinearModel, RegressionCoefficient } from "../../stats/types";
import { positiveXOnly, termLabel } from "../../stats/xy/nonlinear-regression";
import { xyPoints, type Column, type DataSet } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { num } from "../../lib/format";
import { addNote, curveXs, type Paint } from "./plot-helpers";
import { hexOf, withOpacity } from "../../lib/palettes";

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

/** Points across the data's X range tracing the fitted curve (see `curveXs`). */
function fittedCurve(
  model: NonlinearModel,
  coefficients: RegressionCoefficient[],
  xs: number[],
  scale: GraphOptions["xScale"],
): { x: number[]; y: number[] } {
  const x = curveXs(xs, scale, 100);
  return { x, y: x.map((x0) => evaluate(model, coefficients, x0)) };
}

/** A data set's lines of a fit's note, as the analysis reports them: its derived values (an
 *  EC50, a half-life…, not a Span), then the coefficients they don't already say (a
 *  dose-response's Bottom, Top and log midpoint), then R². `set`: its column in the fit,
 *  `coefficients` its own. */
function curveLines(fit: AnalysisResult, set: number, coefficients: RegressionCoefficient[]): string[] {
  const rows = fit.fit?.rows ?? [];
  const derived = rows.filter(
    (r) => r.values && r.label !== "Span" && rows.indexOf(r) < rows.findIndex((x) => x.label === "R squared"),
  );
  const said = new Set(["Bottom", "Top", "LogEC50", "LogIC50"]);
  const lines = [
    ...derived.map((r) => `${r.label} = ${num(r.values![set])}`),
    ...coefficients.filter((c) => !said.has(c.term)).map((c) => `${c.term} = ${num(c.estimate)}`),
  ];
  const r2 = rows.find((r) => r.label === "R squared")?.values?.[set];
  if (r2 != null) lines.push(`R² = ${num(r2)}`);
  return lines;
}

/** A trace with the points left out of the fit (`keys`) drawn hollow: their outline, in
 *  their color, and no fill. */
function hollow(trace: unknown, keys: Set<string>): unknown {
  const t = trace as {
    customdata?: unknown;
    marker?: { color?: unknown; line?: { color?: unknown; width?: unknown } };
  };
  const colors = t.marker?.color;
  if (!keys.size || !Array.isArray(t.customdata) || !Array.isArray(colors)) return trace;
  const out = (t.customdata as string[]).map((key) => keys.has(key));
  if (!out.includes(true)) return trace;
  const each = <T>(v: T | T[] | undefined, i: number) => (Array.isArray(v) ? v[i] : v);
  return {
    ...t,
    marker: {
      ...t.marker,
      color: colors.map((c, i) => (out[i] ? "rgba(0,0,0,0)" : c)),
      line: {
        ...t.marker!.line,
        color: out.map((o, i) => (o ? withOpacity(hexOf(colors[i] as string), 1) : each(t.marker!.line?.color, i))),
        width: out.map((o, i) => Math.max(o ? 1.5 : 0, Number(each(t.marker!.line?.width, i) ?? 0))),
      },
    },
  };
}

/** Draws `model`'s fitted curve of each data set fitted (`fitted`, by name) against `x`
 *  under the points, in its color (`ys`, the graph's Y series, places it in the palette),
 *  and their note when `note`: one data set's values one per line, several's one line
 *  each, after its name. */
export function addFittedCurves(
  fig: GraphFigure,
  x: Column,
  fitted: string[],
  ys: DataSet[],
  model: NonlinearModel,
  fit: AnalysisResult,
  note: boolean,
  options: GraphOptions,
  paint: Paint,
) {
  const all = fit.coefficients ?? [];
  const many = fitted.length > 1;
  const notes: string[] = [];
  const curves = fitted.flatMap((name, i) => {
    const y = ys.find((s) => s.name === name);
    // Several data sets' coefficients are named after each ("A — Top").
    const coefficients = many
      ? all.filter((c) => c.term.startsWith(`${name} — `)).map((c) => ({ ...c, term: c.term.slice(name.length + 3) }))
      : all;
    const xs = y ? xyPoints(x, y).x.filter((v) => !positiveXOnly(model) || v > 0) : [];
    if (!y || !xs.length || !coefficients.some((c) => c.estimate != null)) return [];
    const lines = curveLines(fit, i, coefficients);
    notes.push(many ? `${name}: ${lines.join(", ")}` : lines.join("<br>"));
    const curve = fittedCurve(model, coefficients, xs, options.xScale);
    return [
      {
        type: "scatter",
        mode: "lines",
        x: curve.x,
        y: curve.y,
        line: { color: paint.color(y.name, ys.indexOf(y)), width: 1.5 },
        hoverinfo: "skip",
        showlegend: false,
      },
    ];
  });
  if (!curves.length) return;
  fig.data = [...curves, ...fig.data.map((t) => hollow(t, new Set(fit.curveOutliers?.map((o) => o.key))))];
  if (note) addNote(fig, notes.join("<br>"), options);
}

/** The probability a logistic regression gives Y = 1 at `x`, from R's coefficients (B0, B1). */
export function logisticAt(coefficients: RegressionCoefficient[], x: number): number {
  const [b0, b1] = coefficients.map((c) => c.estimate ?? NaN);
  return 1 / (1 + Math.exp(-(b0 + b1 * x)));
}

/** Draws a logistic regression's S curve of `y` (0s and 1s) against `x` under the points, in
 *  `y`'s color, and its note when `note`: the odds ratio, the X at 50% and Tjur's R². */
export function addLogisticCurve(
  fig: GraphFigure,
  x: Column,
  y: DataSet,
  ys: DataSet[],
  fit: AnalysisResult,
  note: boolean,
  options: GraphOptions,
  paint: Paint,
) {
  const coefficients = fit.coefficients ?? [];
  const xs = xyPoints(x, y).x;
  if (coefficients.length !== 2 || !xs.length) return;
  const curve = curveXs(xs, options.xScale, 100);
  fig.data = [
    {
      type: "scatter",
      mode: "lines",
      x: curve,
      y: curve.map((x0) => logisticAt(coefficients, x0)),
      line: { color: paint.color(y.name, ys.indexOf(y)), width: 1.5 },
      hoverinfo: "skip",
      showlegend: false,
    },
    ...fig.data,
  ];
  const stat = (label: string) => num(fit.stats.find((s) => s.label === label)?.value);
  if (note)
    addNote(
      fig,
      `Odds ratio = ${stat("Odds ratio (per unit of X)")}<br>X at 50% = ${stat("X at 50% probability")}<br>` +
        `Tjur's R² = ${stat("Tjur's R squared")}`,
      options,
    );
}
