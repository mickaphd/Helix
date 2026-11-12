// Ordinary least-squares simple linear regression of a chosen Y data series on X: an XY
// table's X, or two variables of a Multiple Variables table (`x`, `y`). Optionally forces the line through the origin (intercept = 0);
// reports 95% confidence intervals for the slope and intercept alongside the fit.
import type { AnalysisOutcome, Column, FitRow, LinearRegressionParams, StatRow } from "../types";
import { describe, pRow, rVec, type ColumnTestSpec, type Group } from "../column/base";
import { evalNamedVector } from "../webr";
import { pairUp, splitXY, xyPoints, xyProblem } from "../../lib/dataset";
import { num } from "../../lib/format";

const DEFAULTS: LinearRegressionParams = { forceOrigin: false };

/** X and Y regressed, on the points they make: two variables named (on the rows where
 *  both have a value), else an XY table's X and the chosen Y data set (the first by
 *  default), each replicate a point. */
function pickXY(columns: Column[], params: LinearRegressionParams | undefined): Group[] {
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
  rCode: (groups, params) => {
    const origin = (params ?? DEFAULTS).forceOrigin;
    const formula = origin ? "y~x+0" : "y~x";
    const slopeIdx = origin ? 1 : 2;
    const interceptTerms = origin ? "" : ",interceptCiLo=unname(ci[1,1]),interceptCiHi=unname(ci[1,2])";
    return (
      `x<-${rVec(groups[0].values)};y<-${rVec(groups[1].values)};m<-lm(${formula});s<-summary(m);ci<-confint(m);` +
      `c(slope=unname(coef(m)[${slopeIdx}]),intercept=${origin ? "0" : "unname(coef(m)[1])"},` +
      `r=cor(x,y),r2=s$r.squared,p=unname(s$coefficients[${slopeIdx},4]),` +
      `slopeCiLo=unname(ci[${slopeIdx},1]),slopeCiHi=unname(ci[${slopeIdx},2])${interceptTerms})`
    );
  },
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
  const few = sets.find((_, i) => points[i].x.length < 3);
  if (few) return { error: `“${few.name}” needs at least 3 points to be regressed on X.` };
  const origin = params.forceOrigin;
  const v = await evalNamedVector(
    points
      .map(
        (p, i) =>
          `x<-${rVec(p.x)};y<-${rVec(p.y)};m<-lm(${origin ? "y~x+0" : "y~x"});s<-summary(m);ci<-confint(m);k<-${origin ? 1 : 2};` +
          `v${i}<-c(slope=unname(coef(m)[k]),slo=ci[k,1],shi=ci[k,2],` +
          `b=${origin ? "0" : "unname(coef(m)[1])"},blo=${origin ? "NA" : "ci[1,1]"},bhi=${origin ? "NA" : "ci[1,2]"},` +
          `r=${origin ? "NA" : "cor(x,y)"},r2=s$r.squared,p=s$coefficients[k,4],n=length(y))`,
      )
      .join(";") + `;c(${points.map((_, i) => `setNames(v${i},paste0(names(v${i}),"_${i}"))`).join(",")})`,
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
