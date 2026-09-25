// Nonlinear regression for an XY table — Prism's "Standard curves to interpolate"
// category: a curated set of standard curves that fit reliably in WebR. Linear-in-
// parameters models (line, semilog, polynomials) fit with lm(); the sigmoidal and
// hyperbola forms fit with nls(). Each model reports its coefficients plus a
// goodness-of-fit block (R², degrees of freedom, sum of squares, Sy.x) and, where
// meaningful, derived quantities (e.g. a 4PL's EC50 and Span).
import type {
  AnalysisOutcome,
  Column,
  NonlinearModel,
  NonlinearRegressionParams,
  RegressionCoefficient,
  StatRow,
} from "../types";
import { describe, missingColumn, rVec } from "../column/base";
import { pairUp, splitXY } from "../../lib/dataset";
import { evalNamedVector } from "../webr";

const MODEL_LABEL: Record<NonlinearModel, string> = {
  line: "Line",
  "sigmoidal-4pl-logx": "Sigmoidal, 4PL, X is log(concentration)",
  "sigmoidal-4pl-x": "Sigmoidal, 4PL, X is concentration",
  "semilog-line": "Semilog line",
  hyperbola: "Hyperbola (X is concentration)",
  quadratic: "Second order polynomial (quadratic)",
  cubic: "Third order polynomial (cubic)",
};

interface ModelSpec {
  /** Which R fitter to use — lm() (linear in params) or nls() (nonlinear). */
  kind: "lm" | "nls";
  /** R that assigns `m<-lm(...)` or `m<-nls(...,start=...)`; `x`/`y` are in scope. */
  fit: string;
  /** Coefficient display names, in the order lm/nls reports them (positional extraction). */
  terms: string[];
  /** Derived quantities computed from the fit's named coefficients (`cf[["Name"]]`). */
  derived?: { label: string; expr: string }[];
  /** Guard: some curves need X > 0 (log/ratio forms). Rejected up front with this message. */
  requirePositiveX?: string;
}

function modelSpec(model: NonlinearModel): ModelSpec {
  switch (model) {
    case "line":
      return { kind: "lm", fit: "m<-lm(y~x)", terms: ["Intercept", "Slope"] };
    case "quadratic":
      return { kind: "lm", fit: "m<-lm(y~x+I(x^2))", terms: ["B0", "B1", "B2"] };
    case "cubic":
      return { kind: "lm", fit: "m<-lm(y~x+I(x^2)+I(x^3))", terms: ["B0", "B1", "B2", "B3"] };
    case "semilog-line":
      // Y = intercept + slope * ln(X).
      return {
        kind: "lm",
        fit: "m<-lm(y~log(x))",
        terms: ["Intercept", "Slope"],
        requirePositiveX: "The semilog line needs every X value to be greater than 0 (it uses ln(X)).",
      };
    case "sigmoidal-4pl-logx":
      // X is already log10(dose). EC50 = 10^LogEC50.
      return {
        kind: "nls",
        fit: "m<-nls(y~Bottom+(Top-Bottom)/(1+10^((LogEC50-x)*HillSlope)),start=list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=1))",
        terms: ["Bottom", "Top", "LogEC50", "HillSlope"],
        derived: [
          { label: "EC50", expr: '10^cf[["LogEC50"]]' },
          { label: "Span", expr: 'cf[["Top"]]-cf[["Bottom"]]' },
        ],
      };
    case "sigmoidal-4pl-x":
      // X is the raw concentration; EC50 is fitted directly.
      return {
        kind: "nls",
        fit: "m<-nls(y~Bottom+(Top-Bottom)/(1+(EC50/x)^HillSlope),start=list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]),HillSlope=1))",
        terms: ["Bottom", "Top", "EC50", "HillSlope"],
        derived: [{ label: "Span", expr: 'cf[["Top"]]-cf[["Bottom"]]' }],
        requirePositiveX: "This curve needs every X value to be greater than 0 (X is concentration).",
      };
    case "hyperbola":
      // Y = Bmax * X / (Kd + X).
      return {
        kind: "nls",
        fit: "m<-nls(y~Bmax*x/(Kd+x),start=list(Bmax=max(y)*1.1,Kd=median(x[x>0])))",
        terms: ["Bmax", "Kd"],
        requirePositiveX: "The hyperbola needs every X value to be greater than 0 (X is concentration).",
      };
  }
}

export async function runNonlinearRegression(
  columns: Column[],
  params: NonlinearRegressionParams | undefined,
): Promise<AnalysisOutcome> {
  const model = params?.model;
  if (!model || !(model in MODEL_LABEL)) return { error: "Choose a standard curve to fit." };

  const { x: xCol, ys: yCols } = splitXY(columns);
  if (params?.y !== undefined && !columns.some((c) => c.name === params.y)) return { error: missingColumn(params.y) };
  const yCol = params?.y === undefined ? yCols[0] : yCols.find((c) => c.name === params.y);
  if (!xCol || !yCol) {
    return { error: "Nonlinear regression needs an X column and at least one Y column with numeric data." };
  }

  const complete = pairUp(xCol, yCol);
  const spec = modelSpec(model);
  const nParams = spec.terms.length;

  // Curves that need X > 0 (log/ratio forms) commonly get a X=0 vehicle/control
  // point in real dose-response data — drop it from the fit rather than
  // rejecting the whole curve, mirroring how these curves are conventionally fit.
  let xs = complete.x;
  let ys = complete.y;
  if (spec.requirePositiveX) {
    xs = [];
    ys = [];
    complete.x.forEach((x, i) => {
      if (x > 0) {
        xs.push(x);
        ys.push(complete.y[i]);
      }
    });
  }
  if (xs.length < nParams + 1) {
    const scope = spec.requirePositiveX ? " with X > 0" : "";
    return { error: `Not enough complete points${scope} (${xs.length}) to fit this curve; need at least ${nParams + 1}.` };
  }

  // Positional coefficient extraction (co has one row per term, in fit order).
  const coefAssigns = spec.terms
    .map((_, i) => `b${i}=co[${i + 1},1],se${i}=co[${i + 1},2],t${i}=co[${i + 1},3],pv${i}=co[${i + 1},4]`)
    .join(",");
  const derived = spec.derived ?? [];
  const derivedAssigns = derived.map((d, i) => `d${i}=${d.expr}`).join(",");
  // R² for lm comes from summary(); for nls we compute it from residual/total SS.
  const r2 = spec.kind === "lm" ? "s$r.squared" : "1-ss/sst";
  const rCode =
    `x<-${rVec(xs)};y<-${rVec(ys)};${spec.fit};s<-summary(m);co<-s$coefficients;cf<-coef(m);` +
    `df<-df.residual(m);ss<-sum(residuals(m)^2);sst<-sum((y-mean(y))^2);r2<-${r2};syx<-sqrt(ss/df);` +
    `c(r2=r2,df=df,ss=ss,syx=syx,${coefAssigns}${derivedAssigns ? "," + derivedAssigns : ""})`;

  try {
    const v = await evalNamedVector(rCode);
    const coefficients: RegressionCoefficient[] = spec.terms.map((term, i) => ({
      term,
      estimate: v[`b${i}`] ?? null,
      stdError: v[`se${i}`] ?? null,
      t: v[`t${i}`] ?? null,
      p: v[`pv${i}`] ?? null,
    }));
    const stats: StatRow[] = [
      ...derived.map((d, i) => ({ label: d.label, value: v[`d${i}`] ?? null })),
      { label: "R squared", value: v.r2 },
      { label: "Sy.x", value: v.syx },
      { label: "Sum of squares", value: v.ss },
      { label: "Degrees of freedom", value: v.df },
      { label: "N", value: xs.length },
    ];
    return {
      testType: "nonlinear-regression",
      subtitle: MODEL_LABEL[model],
      stats,
      groups: [xCol, yCol].map(describe),
      notes: `Nonlinear least-squares fit ("${MODEL_LABEL[model]}") of "${yCol.name}" on "${xCol.name}".`,
      coefficients,
    };
  } catch (err) {
    return {
      error: `This curve could not be fitted to these data (${err instanceof Error ? err.message : String(err)}). Try another model or Y data set.`,
    };
  }
}
