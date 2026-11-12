// Nonlinear regression for an XY table — Prism's dose-response and standard curves, fitted by
// R: models linear in their parameters (line, semilog, polynomials) with lm(), the others
// (sigmoidal 3PL, 4PL and 5PL, hyperbola, exponential growth and decay, Michaelis-Menten)
// with nls(). Each model reports its coefficients
// with their 95% CI (asymptotic, as Prism's default), a goodness-of-fit block (R², df, sum
// of squares, Sy.x) and, where meaningful, derived quantities with their CI (EC50, Span, half-life…).
// A dose-response curve can be compared with another data set's: is the EC50 different, or
// does one curve fit both (the extra sum-of-squares F test). A standard curve interpolates
// its unknowns: the rows holding a Y but no X.
import type {
  AnalysisOutcome,
  Column,
  FitRow,
  InterpolatedRow,
  NonlinearModel,
  NonlinearRegressionParams,
  RegressionCoefficient,
} from "../types";
import { describe, pRow, rVec } from "../column/base";
import { splitXY, xyPoints, xyProblem, type DataSet } from "../../lib/dataset";
import { evalNamedVector } from "../webr";
import { rowName } from "../grouped/base";
import { pointKeyOf } from "../../lib/columns";

export const MODEL_LABEL: Record<NonlinearModel, string> = {
  "sigmoidal-4pl-logx": "Sigmoidal, 4PL, X is log(concentration)",
  "sigmoidal-4pl-x": "Sigmoidal, 4PL, X is concentration",
  "agonist-3pl-logx": "log(agonist) vs. response, standard slope (3PL)",
  "inhibitor-3pl-logx": "log(inhibitor) vs. response, standard slope (3PL)",
  "asymmetric-5pl-logx": "Asymmetric sigmoidal, 5PL, X is log(concentration)",
  "asymmetric-5pl-x": "Asymmetric sigmoidal, 5PL, X is concentration",
  line: "Line",
  "semilog-line": "Semilog line",
  hyperbola: "Hyperbola (X is concentration)",
  quadratic: "Second order polynomial (quadratic)",
  cubic: "Third order polynomial (cubic)",
  "exponential-growth": "Exponential growth",
  "one-phase-decay": "One-phase decay",
  "michaelis-menten": "Michaelis-Menten",
};

/** A parameter as results name it (its name in the equations otherwise). */
const TERM_LABEL: Record<string, string> = { HillSlope: "Hill slope", S: "Asymmetry (S)" };
export const termLabel = (term: string) => TERM_LABEL[term] ?? term;

/** A derived quantity, as R expressions of the fit (`cf`, its coefficients; `pci(p)`, a
 *  coefficient's 95% CI; `V`, their covariance; `q`, the t critical value). */
type Derived = { label: string; value: string; low: string; high: string };

/** 10 to a log coefficient, its CI 10 to the coefficient's. */
const tenTo = (label: string, p: string): Derived => ({
  label,
  value: `10^cf[["${p}"]]`,
  low: `10^pci("${p}")[1]`,
  high: `10^pci("${p}")[2]`,
});
/** `a` − `b`, its CI from both and their covariance. */
const difference = (a: string, b: string): Derived => {
  const se = `sqrt(V["${a}","${a}"]+V["${b}","${b}"]-2*V["${a}","${b}"])`;
  const value = `cf[["${a}"]]-cf[["${b}"]]`;
  return { label: "Span", value, low: `${value}-q*${se}`, high: `${value}+q*${se}` };
};
const span = difference("Top", "Bottom");
/** `c` / K (a half-life, a doubling time, tau), its CI `c` over K's: none when K's
 *  includes 0, the time then unbounded. */
const overK = (label: string, c: string): Derived => {
  const ends = `sort(${c}/pci("K"))`;
  return {
    label,
    value: `${c}/cf[["K"]]`,
    low: `if(prod(pci("K"))>0)${ends}[1] else NA`,
    high: `if(prod(pci("K"))>0)${ends}[2] else NA`,
  };
};

interface ModelSpec {
  /** R: the body of `fit(x, y)`, which returns the fitted model. */
  fit: string;
  /** Coefficient names, in the order the fit reports them. */
  terms: string[];
  derived?: Derived[];
  /** Curves of log or ratio forms fit the points with X > 0 only. */
  positiveX?: boolean;
  /** A dose-response curve's formula (its right side) and midpoint, which comparing two
   *  curves shares. */
  dose?: { expr: string; midpoint: string };
}

// The 4PL's starting slope takes the curve's own sign, so a falling curve keeps Bottom under Top.
const SIGN = "if(isTRUE(cor(x,y)<0))-1 else 1";
const FOUR_LOG = "Bottom+(Top-Bottom)/(1+10^((LogEC50-x)*HillSlope))";
const FOUR_X = "Bottom+(Top-Bottom)/(1+(EC50/x)^HillSlope)";
const START_LOG = `list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=${SIGN})`;
const START_X = `list(Bottom=min(y),Top=max(y),EC50=median(x),HillSlope=${SIGN})`;
// Each fit takes weights `w` (none: least squares), which ROUT's robust fit gives it.
const nls = (expr: string, start: string) => `nls(y~${expr},start=${start},weights=w,control=nls.control(maxiter=200))`;

/** R: `fit(x, y, w)`, the model's fit (least squares, or weighted by `w`). */
export const rFit = (model: NonlinearModel) => `fit<-function(x,y,w=NULL)${modelSpec(model).fit}`;

function modelSpec(model: NonlinearModel): ModelSpec {
  switch (model) {
    case "line":
      return { fit: "lm(y~x,weights=w)", terms: ["Intercept", "Slope"] };
    case "quadratic":
      return { fit: "lm(y~x+I(x^2),weights=w)", terms: ["B0", "B1", "B2"] };
    case "cubic":
      return { fit: "lm(y~x+I(x^2)+I(x^3),weights=w)", terms: ["B0", "B1", "B2", "B3"] };
    case "semilog-line": // Y = intercept + slope * ln(X)
      return { fit: "lm(y~log(x),weights=w)", terms: ["Intercept", "Slope"], positiveX: true };
    case "hyperbola": // Y = Bmax * X / (Kd + X)
      return {
        fit: nls("Bmax*x/(Kd+x)", "list(Bmax=max(y)*1.1,Kd=median(x))"),
        terms: ["Bmax", "Kd"],
        positiveX: true,
      };
    case "exponential-growth": // Y = Y0 * exp(K * X); it starts from a line through log(Y)
      return {
        fit: nls("Y0*exp(K*x)", "local({k<-y>0;c0<-coef(lm(log(y[k])~x[k]));list(Y0=exp(c0[[1]]),K=c0[[2]])})"),
        terms: ["Y0", "K"],
        derived: [overK("Doubling time", "log(2)"), overK("Tau", "1")],
      };
    case "one-phase-decay": // Y = (Y0 − Plateau) * exp(−K * X) + Plateau
      return {
        fit: nls(
          "(Y0-Plateau)*exp(-K*x)+Plateau",
          "list(Y0=y[which.min(x)],Plateau=y[which.max(x)],K=3/diff(range(x)))",
        ),
        terms: ["Y0", "Plateau", "K"],
        derived: [overK("Half-life", "log(2)"), overK("Tau", "1"), difference("Y0", "Plateau")],
      };
    case "michaelis-menten": // Y = Vmax * X / (Km + X)
      return {
        fit: nls("Vmax*x/(Km+x)", "list(Vmax=max(y)*1.1,Km=median(x))"),
        terms: ["Vmax", "Km"],
        positiveX: true,
      };
    case "sigmoidal-4pl-logx": // X is already log10(dose)
      return {
        fit: nls(FOUR_LOG, START_LOG),
        terms: ["Bottom", "Top", "LogEC50", "HillSlope"],
        derived: [tenTo("EC50", "LogEC50"), span],
        dose: { expr: FOUR_LOG, midpoint: "LogEC50" },
      };
    case "sigmoidal-4pl-x": // X is the concentration; EC50 is fitted directly
      return {
        fit: nls(FOUR_X, START_X),
        terms: ["Bottom", "Top", "EC50", "HillSlope"],
        derived: [span],
        positiveX: true,
        dose: { expr: FOUR_X, midpoint: "EC50" },
      };
    case "agonist-3pl-logx": {
      // The Hill slope is 1: a rising curve.
      const expr = "Bottom+(Top-Bottom)/(1+10^(LogEC50-x))";
      return {
        fit: nls(expr, "list(Bottom=min(y),Top=max(y),LogEC50=median(x))"),
        terms: ["Bottom", "Top", "LogEC50"],
        derived: [tenTo("EC50", "LogEC50"), span],
        dose: { expr, midpoint: "LogEC50" },
      };
    }
    case "inhibitor-3pl-logx": {
      // The Hill slope is −1: a falling curve.
      const expr = "Bottom+(Top-Bottom)/(1+10^(x-LogIC50))";
      return {
        fit: nls(expr, "list(Bottom=min(y),Top=max(y),LogIC50=median(x))"),
        terms: ["Bottom", "Top", "LogIC50"],
        derived: [tenTo("IC50", "LogIC50"), span],
        dose: { expr, midpoint: "LogIC50" },
      };
    }
    case "asymmetric-5pl-logx": {
      // Prism's 5PL: the curve's asymmetry S (1 = the 4PL); it starts from the 4PL's fit.
      const expr = "Bottom+(Top-Bottom)/(1+10^((LogEC50+log10(2^(1/S)-1)/HillSlope-x)*HillSlope))^S";
      return {
        fit: nls(expr, `c(as.list(coef(${nls(FOUR_LOG, START_LOG)})),S=1)`),
        terms: ["Bottom", "Top", "LogEC50", "HillSlope", "S"],
        derived: [tenTo("EC50", "LogEC50"), span],
        dose: { expr, midpoint: "LogEC50" },
      };
    }
    case "asymmetric-5pl-x": {
      const expr = "Bottom+(Top-Bottom)/(1+(EC50*(2^(1/S)-1)^(1/HillSlope)/x)^HillSlope)^S";
      return {
        fit: nls(expr, `c(as.list(coef(${nls(FOUR_X, START_X)})),S=1)`),
        terms: ["Bottom", "Top", "EC50", "HillSlope", "S"],
        derived: [span],
        positiveX: true,
        dose: { expr, midpoint: "EC50" },
      };
    }
  }
}

/** Whether a model fits only the points with X > 0 (its curve too). */
export const positiveXOnly = (model: NonlinearModel) => modelSpec(model).positiveX === true;

/** R: `out(m, y, k)`, a fit's results as a named vector, each name prefixed `k`: R², df,
 *  sum of squares, Sy.x and n; each coefficient's estimate, SE, t, P and 95% CI (`b_i`,
 *  `se_i`, `t_i`, `pv_i`, `lo_i`, `hi_i`); each derived quantity and its CI (`d_i`…). */
function rOut(derived: Derived[]): string {
  const d = derived.map((x, i) => `d_${i}=${x.value},dlo_${i}=${x.low},dhi_${i}=${x.high}`).join(",");
  return (
    `out<-function(m,y,k){s<-summary(m);co<-s$coefficients;df<-df.residual(m);q<-qt(0.975,df);V<-vcov(m);cf<-coef(m)\n` +
    `pci<-function(p)cf[[p]]+c(-1,1)*q*sqrt(V[p,p]);ss<-sum(residuals(m)^2)\n` +
    // S (a 5PL's asymmetry) is above 0: its CI is taken on its log, so it stays there.
    `ci<-cbind(co[,1]-q*co[,2],co[,1]+q*co[,2]);if("S"%in%rownames(co))ci["S",]<-co["S",1]*exp(c(-1,1)*q*co["S",2]/co["S",1])\n` +
    `v<-c(r2=if(inherits(m,"lm"))s$r.squared else 1-ss/sum((y-mean(y))^2),df=df,ss=ss,syx=sqrt(ss/df),n=length(y),` +
    `setNames(as.vector(t(cbind(co,ci))),` +
    `paste0(rep(c("b_","se_","t_","pv_","lo_","hi_"),nrow(co)),rep(seq_len(nrow(co))-1,each=6)))${d ? "," + d : ""})\n` +
    `setNames(v,paste0(k,names(v)))}`
  );
}

/** The points a model fits: X and the Y data set, on the rows where both hold a number, each
 *  replicate a point (X > 0 for the curves that need it: a vehicle at X = 0 is left out, as
 *  these curves usually are). */
function points(x: Column, y: DataSet, spec: ModelSpec) {
  const pairs = xyPoints(x, y);
  const keep = pairs.x.map((v) => !spec.positiveX || v > 0);
  const kept = <T>(list: T[]) => list.filter((_, i) => keep[i]);
  return { x: kept(pairs.x), y: kept(pairs.y), rows: kept(pairs.rows), columns: kept(pairs.columns) };
}

/** R: `routOf(x, y, K, q)`, the ROUT method (Motulsky & Brown, BMC Bioinformatics 2006):
 *  a robust fit of the curve, minimizing the sum of ln(1 + (residual / RSDR)²) (residuals
 *  taken as Lorentzian), RSDR = P68 × N / (N − K), P68 the 68.27th percentile of the absolute
 *  residuals, recomputed at each step (as reweighted least squares, weights 1 / (1 + (r /
 *  RSDR)²)); then, the points ranked by their distance to it, from the 70th percentile on:
 *  the first whose P (t = |residual| / RSDR, N − K df, two-sided) is under Q(N − (i − 1)) / N
 *  is an outlier, and every point farther. `out`: the outliers; `rsdr`, `m`: the robust fit. */
export const R_ROUT_CURVE =
  `routOf<-function(x,y,K,q){n<-length(y);none<-list(out=rep(FALSE,n),rsdr=NA)\n` +
  `rsdr<-function(m)quantile(abs(y-fitted(m)),0.6827,type=6,names=FALSE)*n/(n-K)\n` +
  `m<-tryCatch(fit(x,y),error=function(e)NULL);if(is.null(m)||n<=K+1)return(none)\n` +
  `for(it in 1:100){s<-rsdr(m);if(!is.finite(s)||s<=0)break;b<-coef(m)\n` +
  `m2<-tryCatch(fit(x,y,1/(1+((y-fitted(m))/s)^2)),error=function(e)NULL);if(is.null(m2))break\n` +
  `m<-m2;if(max(abs(coef(m)-b)/pmax(abs(b),1e-12))<1e-10)break}\n` +
  `s<-rsdr(m);if(!is.finite(s)||s<=0)return(none);r<-abs(y-fitted(m));o<-order(r);out<-rep(FALSE,n)\n` +
  `for(i in max(1,floor(0.7*n)):n)if(2*pt(-r[o[i]]/s,n-K)<q*(n-(i-1))/n){out[o[i:n]]<-TRUE;break}\n` +
  `list(out=out,rsdr=s,m=m)}`;

/** R: `interp(m, yu, lo, hi, pos)`, the X the fitted curve `m` gives each Y of `yu` (`ix_i`):
 *  the lowest one within the standards' X (`lo` to `hi`), else below them, else above them, as
 *  far again as their width (for a curve of X > 0, `pos`, a tenth of `lo` and ten times `hi`);
 *  NA when the curve never reaches that Y there. */
const R_INTERP =
  `interp<-function(m,yu,lo,hi,pos){fx<-function(x)as.numeric(predict(m,newdata=data.frame(x=x)))\n` +
  `root<-function(v,a,b){g<-seq(a,b,length.out=401);d<-fx(g)-v;i<-which(d[-1]*d[-length(d)]<=0)[1]\n` +
  `if(is.na(i))NA else if(d[i]==0)g[i] else uniroot(function(x)fx(x)-v,g[c(i,i+1)],tol=(b-a)*1e-12)$root}\n` +
  `w<-hi-lo;x<-sapply(yu,function(v){r<-root(v,lo,hi)\n` +
  `if(is.na(r))r<-root(v,if(pos)lo/10 else lo-w,lo);if(is.na(r))r<-root(v,hi,if(pos)hi*10 else hi+w);r})\n` +
  `setNames(x,paste0("ix_",seq_along(x)-1))}`;

export async function runNonlinearRegression(
  columns: Column[],
  params: NonlinearRegressionParams | undefined,
  titles: (string | null)[] = [],
): Promise<AnalysisOutcome> {
  const model = params?.model;
  if (!model || !Object.hasOwn(MODEL_LABEL, model)) return { error: "Choose a standard curve to fit." };

  const { x: xCol, ys: yCols } = splitXY(columns);
  // The data sets fitted, each on its own: those chosen, else the one (the first by default).
  const chosen = params?.ys ?? [params?.y];
  const fitted = chosen.map((name) => (name === undefined ? yCols[0] : yCols.find((c) => c.name === name)));
  const lacking = fitted.findIndex((y) => !y);
  if (!xCol || lacking >= 0) return { error: xyProblem(columns, chosen[Math.max(0, lacking)])! };
  const yCol = fitted[0]!;
  const many = fitted.length > 1;
  const spec = modelSpec(model);
  const other =
    params?.compareWith === undefined || many ? undefined : yCols.find((c) => c.name === params.compareWith);
  if (params?.compareWith !== undefined && !many && !other) return { error: xyProblem(columns, params.compareWith)! };
  if (other && !spec.dose) return { error: "Only dose-response curves can be compared." };

  const ySets = many ? fitted.map((y) => y!) : [yCol, ...(other ? [other] : [])];
  const sets = ySets.map((y) => ({ name: y.name, ...points(xCol, y, spec) }));
  const nParams = spec.terms.length;
  for (const s of sets) {
    if (s.x.length < nParams + 1) {
      const scope = spec.positiveX ? " with X > 0" : "";
      return {
        error:
          `Not enough complete points${scope} in “${s.name}” (${s.x.length}) to fit this curve; ` +
          `need at least ${nParams + 1}.`,
      };
    }
  }

  // The unknowns: the rows holding a Y but no X, their replicates as their mean (R's). A log
  // X's is given as a concentration too.
  const unknowns =
    params?.interpolate && !other && !many
      ? [...new Set(yCol.columns.flatMap((c) => c.rows))].sort((a, b) => a - b).filter((r) => xCol.byRow[r] == null)
      : [];
  const unknownYs = unknowns.map((r) => yCol.columns.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!])));
  const logX = model.endsWith("-logx");
  const [lo, hi] = [Math.min(...sets[0].x), Math.max(...sets[0].x)];

  const fit = `fit<-function(x,y,w=NULL)${spec.fit}\n${rOut(spec.derived ?? [])}`;
  // ROUT: each data set's outliers found, then left out of its least-squares fit.
  const rout = Boolean(params?.rout) && !other;
  const data =
    sets.map((s, i) => `x${i}<-${rVec(s.x)};y${i}<-${rVec(s.y)}`).join(";") +
    (rout
      ? `\n${R_ROUT_CURVE}\n` +
        sets
          .map(
            (_, i) =>
              `ro${i}<-routOf(x${i},y${i},${spec.terms.length},${(params?.q ?? 1) / 100});` +
              `x${i}<-x${i}[!ro${i}$out];y${i}<-y${i}[!ro${i}$out]`,
          )
          .join("\n") +
        `\nrouts<-c(${sets.map((_, i) => `setNames(as.numeric(ro${i}$out),paste0("o${i}_",seq_along(ro${i}$out)-1))`).join(",")})`
      : "");
  const interpolate = unknowns.length
    ? `\n${R_INTERP}\nyu<-sapply(list(${unknownYs.map(rVec).join(",")}),mean)\n` +
      `ix<-interp(m,yu,${lo},${hi},${spec.positiveX ? "TRUE" : "FALSE"})\n` +
      `c(out(m,y0,""),setNames(yu,paste0("iy_",seq_along(yu)-1)),ix${logX ? ',setNames(10^ix,sub("ix","ic",names(ix)))' : ""})`
    : `\nout(m,y0,"")`;
  // Several data sets: each fitted on its own; one that can't be leaves the others be.
  const eachFit =
    sets.map((_, i) => `m${i}<-tryCatch(fit(x${i},y${i}),error=function(e)NULL)`).join("\n") +
    `\nc(${sets.map((_, i) => `if(is.null(m${i}))c(s${i}_failed=1) else out(m${i},y${i},"s${i}_")`).join(",")})`;
  const fitting = many ? eachFit : `m<-fit(x0,y0)${interpolate}`;
  const rCode = other
    ? `${fit}\n${data}\n${comparison(spec, params!.compare ?? "ec50")}`
    : `${fit}\n${data}\n${rout ? `c({\n${fitting}\n},routs)` : fitting}`;

  let v: Record<string, number | null>;
  try {
    v = await evalNamedVector(rCode);
  } catch (err) {
    // R found no best fit (nls stops on its own terms): said plainly, with the likeliest reason.
    if (String(err).includes("shared midpoint")) {
      const midpoint = spec.dose!.midpoint.replace(/^Log/, "");
      return {
        error:
          `These two curves can't be fitted with one ${midpoint}: they are too far apart, or their slopes too ` +
          `different. Ask whether one curve fits both instead, or compare them with a standard-slope (3PL) model.`,
      };
    }
    const logHint = model.endsWith("-logx")
      ? " This model takes X as log(concentration): if X holds concentrations, choose one where X is concentration."
      : "";
    return {
      error: `This curve could not be fitted to these data: they may not follow its shape.${logHint} Try another model or Y data set.`,
    };
  }

  // Each data set's coefficients, named after it when two are compared, and its best-fit
  // values in a column of its own.
  const failed = sets.filter((_, i) => v[`s${i}_failed`] != null).map((s) => s.name);
  if (many && failed.length === sets.length) {
    return {
      error: "These curves could not be fitted to these data: they may not follow its shape. Try another model.",
    };
  }
  const prefix = other ? ["a_", "b_"] : many ? sets.map((_, i) => `s${i}_`) : [""];
  const coefficients: RegressionCoefficient[] = sets.flatMap((s, i) =>
    spec.terms.map((term, t) => ({
      term: other || many ? `${s.name} — ${termLabel(term)}` : termLabel(term),
      estimate: v[`${prefix[i]}b_${t}`] ?? null,
      stdError: v[`${prefix[i]}se_${t}`] ?? null,
      t: v[`${prefix[i]}t_${t}`] ?? null,
      p: v[`${prefix[i]}pv_${t}`] ?? null,
      low: v[`${prefix[i]}lo_${t}`] ?? null,
      high: v[`${prefix[i]}hi_${t}`] ?? null,
    })),
  );
  // ROUT's outliers, by data set: where they are in the table.
  const outliers = rout
    ? sets.flatMap((s, i) =>
        s.x.flatMap((x, k) =>
          v[`o${i}_${k}`] === 1 ? [{ at: i, x, y: s.y[k], row: s.rows[k], column: s.columns[k] }] : [],
        ),
      )
    : [];
  const each = (key: string) => prefix.map((k) => v[`${k}${key}`] ?? null);
  const fitRows: FitRow[] = [
    ...(spec.derived ?? []).flatMap((d, j): FitRow[] => [
      { label: d.label, values: each(`d_${j}`) },
      { label: "95% CI", ranges: prefix.map((k) => [v[`${k}dlo_${j}`] ?? null, v[`${k}dhi_${j}`] ?? null]) },
    ]),
    { label: "R squared", values: each("r2") },
    { label: "Sy.x", values: each("syx") },
    { label: "Sum of squares", values: each("ss") },
    { label: "Degrees of freedom", values: each("df") },
    { label: "N", values: each("n") },
    ...(rout
      ? [{ label: "Outliers (ROUT)", values: sets.map((_, i) => outliers.filter((o) => o.at === i).length) }]
      : []),
  ];
  const midpoint = spec.dose?.midpoint.replace(/^Log/, "") ?? "EC50";
  const question =
    params?.compare === "all" ? "Does one curve fit both data sets?" : `Is the ${midpoint} different between them?`;
  const differ = v.p != null && v.p < 0.05;
  const answer =
    params?.compare === "all"
      ? differ
        ? "The curves differ: one curve doesn't fit both."
        : "One curve fits both data sets."
      : differ
        ? `The ${midpoint}s differ.`
        : `One ${midpoint} fits both data sets.`;

  const interpolated: InterpolatedRow[] = unknowns.map((r, i) => {
    const x = v[`ix_${i}`] ?? null;
    return {
      label: rowName(titles, r),
      y: v[`iy_${i}`] ?? null,
      x,
      ...(logX ? { concentration: v[`ic_${i}`] ?? null } : {}),
      extrapolated: x != null && (x < lo || x > hi),
    };
  });
  const interpolation = !params?.interpolate
    ? ""
    : !unknowns.length
      ? " No unknowns to interpolate: enter their Y with X left blank."
      : ` Each unknown's X is read off the curve (the lowest, if the curve reaches its Y twice); “extrapolated”: beyond the standards' X.` +
        (interpolated.some((u) => u.x == null) ? " “—”: the curve never reaches that Y." : "");

  return {
    testType: "nonlinear-regression",
    subtitle: MODEL_LABEL[model],
    stats: other
      ? [
          { label: "F", value: v.F ?? null },
          { label: "DFn", value: v.dfn ?? null },
          { label: "DFd", value: v.dfd ?? null },
          pRow("P value", v.p ?? null),
        ]
      : [],
    fit: { sets: sets.map((s) => s.name), rows: fitRows },
    groups: (
      await describe([xCol, ...ySets.map((y) => ({ name: y.name, values: y.columns.flatMap((c) => c.values) }))])
    ).groups,
    notes:
      `Least-squares fit ("${MODEL_LABEL[model]}") of ${sets.map((s) => `“${s.name}”`).join(" and ")} on “${xCol.name}”. ` +
      `95% CIs are asymptotic (from each parameter's standard error${spec.terms.includes("S") ? "; the asymmetry S's, on its log" : ""}).` +
      (other ? ` Extra sum-of-squares F test: ${question} ${answer}` : "") +
      (many ? " Each data set is fitted on its own." : "") +
      (failed.length ? ` ${failed.map((n) => `“${n}”`).join(", ")}: no fit, the data don't follow this curve.` : "") +
      interpolation +
      (rout
        ? ` Outliers found by ROUT (Q = ${params?.q ?? 1}%; Motulsky & Brown, 2006), each left out of its data set's fit, ` +
          "which is then least squares on the other points."
        : ""),
    coefficients,
    ...(params?.interpolate ? { interpolated } : {}),
    ...(rout
      ? {
          curveOutliers: outliers.map((o) => ({
            set: sets[o.at].name,
            label: rowName(titles, o.row),
            x: o.x,
            y: o.y,
            key: pointKeyOf(o.column, o.row),
          })),
        }
      : {}),
  };
}

/** R comparing two data sets' curves (`x0`, `y0` and `x1`, `y1`): each fitted on its own
 *  (the full model), then the reduced one — the midpoint shared, or one curve for both —
 *  and the extra sum-of-squares F test between them. */
function comparison(spec: ModelSpec, compare: "ec50" | "all"): string {
  const { expr, midpoint } = spec.dose!;
  // Every parameter but the shared midpoint, one per data set (`g`).
  const own = spec.terms.filter((t) => t !== midpoint);
  const indexed = own.reduce((e, t) => e.replace(new RegExp(`\\b${t}\\b`, "g"), `${t}[g]`), expr);
  const start = own.map((t) => `${t}=c(c0[["${t}"]],c1[["${t}"]])`).join(",");
  // The shared midpoint starts between the two, else at either one's (curves far apart
  // may converge only from there); the best of the fits that converge is kept.
  const reduced =
    compare === "all"
      ? "m<-fit(c(x0,x1),c(y0,y1))"
      : `x<-c(x0,x1);y<-c(y0,y1);g<-rep(1:2,c(length(x0),length(x1)));c0<-coef(m0);c1<-coef(m1)\n` +
        `ms<-lapply(c(mean(c(c0[["${midpoint}"]],c1[["${midpoint}"]])),c0[["${midpoint}"]],c1[["${midpoint}"]]),` +
        `function(s)tryCatch(nls(y~${indexed},start=list(${start},${midpoint}=s),control=nls.control(maxiter=200)),error=function(e)NULL))\n` +
        `ms<-Filter(Negate(is.null),ms);if(!length(ms))stop("no fit with a shared midpoint")\n` +
        `m<-ms[[which.min(sapply(ms,function(f)sum(residuals(f)^2)))]]`;
  return (
    `m0<-fit(x0,y0);m1<-fit(x1,y1)\n${reduced}\n` +
    `ssf<-sum(residuals(m0)^2)+sum(residuals(m1)^2);dff<-df.residual(m0)+df.residual(m1)\n` +
    `ssr<-sum(residuals(m)^2);dfr<-df.residual(m);Fc<-((ssr-ssf)/(dfr-dff))/(ssf/dff)\n` +
    `c(out(m0,y0,"a_"),out(m1,y1,"b_"),F=Fc,dfn=dfr-dff,dfd=dff,p=pf(Fc,dfr-dff,dff,lower.tail=FALSE))`
  );
}
