// Ordinary least-squares simple linear regression of a chosen Y data series on X: an XY
// table's X, or two variables of a Multiple Variables table (`x`, `y`). Optionally forces the line through the origin (intercept = 0);
// reports 95% confidence intervals for the slope and intercept alongside the fit.
import type { AnalysisOutcome, Column, FitRow, LinearRegressionParams, StatRow } from "../types";
import { describe, identical, pRow, rVec, type ColumnTestSpec, type Group } from "../column/base";
import { evalNamedVector } from "../webr";
import { pairUp, splitXY, xyPoints, xyProblem } from "../../lib/dataset";
import { num } from "../../lib/format";

const DEFAULTS: LinearRegressionParams = { forceOrigin: false };

/** R: `line(x, y, origin)`, the least-squares line and its 95% CIs. X and Y are centered
 *  first (the same line, its intercept then taken back to X = 0 with its exact SE: the
 *  centered intercept and the slope are uncorrelated), so values far from 0 for their
 *  spread (dates in seconds, 1000000000000.4…) lose no precision in lm's QR. */
const R_LINE = `line<-function(x,y,origin){q<-function(m)qt(0.975,df.residual(m))
if(origin){m<-lm(y~x+0);co<-summary(m)$coefficients;return(c(slope=co[1,1],slo=co[1,1]-q(m)*co[1,2],
shi=co[1,1]+q(m)*co[1,2],b=0,blo=NA,bhi=NA,r=NA,r2=summary(m)$r.squared,p=co[1,4],n=length(y)))}
mx<-mean(x);my<-mean(y);m<-lm(I(y-my)~I(x-mx));s<-summary(m);co<-s$coefficients;b<-co[1,1]+my-co[2,1]*mx;sb<-sqrt(co[1,2]^2+(mx*co[2,2])^2)
c(slope=co[2,1],slo=co[2,1]-q(m)*co[2,2],shi=co[2,1]+q(m)*co[2,2],b=b,blo=b-q(m)*sb,bhi=b+q(m)*sb,
r=cor(x,y),r2=s$r.squared,p=co[2,4],n=length(y))}`;

/** What X and Y lack for a line, or nothing. */
function lineProblem(x: Group, y: Group, origin: boolean): string | undefined {
  const need = origin ? 2 : 3;
  if (y.values.length < need) return `“${y.name}” needs at least ${need} points to be regressed on X.`;
  // Through the origin, a line needs one X other than 0; else, two different Xs and a Y that changes.
  if (origin) {
    if (x.values.every((v) => v === 0)) return `“${x.name}” holds only 0s: a line through the origin needs another X.`;
    if (y.values.every((v) => v === 0)) return `“${y.name}” holds only 0s: there is nothing to regress on “${x.name}”.`;
    return undefined;
  }
  if (identical(x.values)) return `“${x.name}”'s values are all identical: a line needs X values that differ.`;
  if (identical(y.values))
    return `“${y.name}”'s values are all identical: there is no change in it to regress on “${x.name}”.`;
}

/** X and Y regressed, on the points they make: two variables named (on the rows where
 *  both have a value), else an XY table's X and the chosen Y data set (the first by
 *  default), each replicate a point. */
export function pickXY(columns: Column[], params: LinearRegressionParams | undefined): Group[] {
  const named = (name?: string) => columns.find((c) => c.name === name);
  let points: { x: number[]; y: number[] } | undefined;
  let names: [string, string] = ["", ""];
  if (params?.x !== undefined) {
    const [x, y] = [named(params.x), named(params.y)];
    if (x && y) [points, names] = [pairUp(x, y), [x.name, y.name]];
  } else {
    const { x, ys } = splitXY(columns);
    const y = params?.y === undefined ? ys[0] : ys.find((s) => s.name === params.y);
    if (x && y) [points, names] = [xyPoints(x, y), [x.name, y.name]];
  }
  return points
    ? [
        { name: names[0], values: points.x },
        { name: names[1], values: points.y },
      ]
    : [];
}

export const linearRegressionSpec: ColumnTestSpec<LinearRegressionParams> = {
  testType: "linear-regression",
  minGroups: 2,
  check: (columns, params) => {
    if (params?.x === undefined) return xyProblem(columns, params?.y);
    const empty = [params.x, params.y].map((n) => columns.find((c) => c.name === n)).find((c) => c && !c.values.length);
    return empty && `“${empty.name}” holds no numbers yet.`;
  },
  parseGroups: pickXY,
  checkGroups: ([x, y], params) => lineProblem(x, y, (params ?? DEFAULTS).forceOrigin),
  rCode: (groups, params) =>
    `${R_LINE};v<-line(${rVec(groups[0].values)},${rVec(groups[1].values)},${(params ?? DEFAULTS).forceOrigin ? "TRUE" : "FALSE"});` +
    `c(slope=v[["slope"]],intercept=v[["b"]],r=v[["r"]],r2=v[["r2"]],p=v[["p"]],slopeCiLo=v[["slo"]],slopeCiHi=v[["shi"]],` +
    `interceptCiLo=v[["blo"]],interceptCiHi=v[["bhi"]])`,
  rows: (v, _groups, params) => {
    const origin = (params ?? DEFAULTS).forceOrigin;
    const rows: StatRow[] = [
      { label: "Slope", value: v.slope },
      { label: "Slope 95% CI lower", value: v.slopeCiLo },
      { label: "Slope 95% CI upper", value: v.slopeCiHi },
    ];
    if (origin) {
      rows.push({ label: "Y-intercept", value: 0 });
    } else {
      rows.push(
        { label: "Y-intercept", value: v.intercept },
        { label: "Intercept 95% CI lower", value: v.interceptCiLo },
        { label: "Intercept 95% CI upper", value: v.interceptCiHi },
        { label: "Pearson r", value: v.r }, // of the data: says nothing of a line through the origin
      );
    }
    rows.push({ label: "R squared", value: v.r2 }, pRow("P value (slope ≠ 0)", v.p));
    return rows;
  },
  notes: (params, groups) =>
    `Ordinary least-squares linear regression of “${groups[1]?.name ?? "Y"}” on “${groups[0]?.name ?? "X"}”` +
    `${(params ?? DEFAULTS).forceOrigin ? ", forced through the origin" : ""}. ` +
    "Assumes a linear relationship and homoscedastic residuals.",
  subtitle: (params) =>
    (params ?? DEFAULTS).forceOrigin ? "Simple linear regression (through origin)" : "Simple linear regression",
  equation: (v, _groups, params) => {
    if (v.slope == null) return undefined;
    const term = `${num(v.slope)}*X`;
    const b = v.intercept;
    if ((params ?? DEFAULTS).forceOrigin || b == null || b === 0) return `Y = ${term}`;
    return `Y = ${term} ${b < 0 ? "−" : "+"} ${num(Math.abs(b))}`;
  },
};

/** Several Y data sets of an XY table, each regressed on X on its own (each replicate a
 *  point): their best-fit values side by side, every number R's. */
export async function runLinearRegressions(
  columns: Column[],
  params: LinearRegressionParams & { ys: string[] },
): Promise<AnalysisOutcome> {
  const { x, ys } = splitXY(columns);
  const sets = params.ys.map((name) => ys.find((s) => s.name === name));
  const lacking = params.ys.find((_, i) => !sets[i]);
  if (!x || lacking !== undefined) return { error: xyProblem(columns, lacking)! };
  const points = sets.map((s) => xyPoints(x, s!));
  const origin = params.forceOrigin;
  for (const [i, p] of points.entries()) {
    const problem = lineProblem({ name: x.name, values: p.x }, { name: sets[i]!.name, values: p.y }, origin);
    if (problem) return { error: problem };
  }
  const v = await evalNamedVector(
    `${R_LINE};` +
      points.map((p, i) => `v${i}<-line(${rVec(p.x)},${rVec(p.y)},${origin ? "TRUE" : "FALSE"})`).join(";") +
      `;c(${points.map((_, i) => `setNames(v${i},paste0(names(v${i}),"_${i}"))`).join(",")})`,
  );
  const of = (key: string) => sets.map((_, i) => v[`${key}_${i}`] ?? null);
  const range = (lo: string, hi: string) =>
    sets.map((_, i): [number | null, number | null] => [v[`${lo}_${i}`] ?? null, v[`${hi}_${i}`] ?? null]);
  const rows: FitRow[] = [
    { label: "Slope", values: of("slope") },
    { label: "95% CI", ranges: range("slo", "shi") },
    { label: "Y-intercept", values: of("b") },
    ...(origin
      ? []
      : [
          { label: "95% CI", ranges: range("blo", "bhi") },
          { label: "Pearson r", values: of("r") },
        ]),
    { label: "R squared", values: of("r2") },
    { label: "P value (slope ≠ 0)", values: of("p"), p: true },
    { label: "N", values: of("n") },
  ];
  return {
    testType: "linear-regression",
    subtitle: origin ? "Simple linear regression (through origin)" : "Simple linear regression",
    stats: [],
    fit: { sets: sets.map((s) => s!.name), rows },
    groups: (await describe([x, ...sets.map((s) => ({ name: s!.name, values: s!.columns.flatMap((c) => c.values) }))]))
      .groups,
    notes:
      `Ordinary least-squares linear regression of each Y data set on “${x.name}”, each on its own` +
      `${origin ? ", forced through the origin" : ""}. Assumes a linear relationship and homoscedastic residuals.`,
  };
}
