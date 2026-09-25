// Ordinary least-squares simple linear regression of a chosen Y data series on X,
// for an XY table. Optionally forces the line through the origin (intercept = 0);
// reports 95% confidence intervals for the slope and intercept alongside the fit.
import type { Column, LinearRegressionParams, StatRow } from "../types";
import { missingColumn, pRow, rVec, type ColumnTestSpec, type Group } from "../column/base";
import { pairUp, splitXY } from "../../lib/dataset";
import { num } from "../../lib/format";

const DEFAULTS: LinearRegressionParams = { forceOrigin: false };

/** X and the chosen Y series (the first by default), on the rows where both have a value. */
function pickXY(columns: Column[], params: LinearRegressionParams | undefined): Group[] {
  const { x, ys } = splitXY(columns);
  const y = params?.y === undefined ? ys[0] : ys.find((c) => c.name === params.y);
  if (!x || !y) return [];
  const pairs = pairUp(x, y);
  return [
    { name: x.name, values: pairs.x },
    { name: y.name, values: pairs.y },
  ];
}

export const linearRegressionSpec: ColumnTestSpec<LinearRegressionParams> = {
  testType: "linear-regression",
  minGroups: 2,
  check: (columns, params) =>
    params?.y !== undefined && !columns.some((c) => c.name === params.y) ? missingColumn(params.y) : undefined,
  parseGroups: pickXY,
  rCode: (groups, params) => {
    const origin = (params ?? DEFAULTS).forceOrigin;
    const formula = origin ? "y~x+0" : "y~x";
    const slopeIdx = origin ? 1 : 2;
    const interceptTerms = origin ? "" : ",interceptCiLo=unname(ci[1,1]),interceptCiHi=unname(ci[1,2])";
    return (
      `x<-${rVec(groups[0].values)};y<-${rVec(groups[1].values)};m<-lm(${formula});s<-summary(m);ci<-confint(m);` +
      `c(slope=unname(coef(m)[${slopeIdx}]),intercept=${origin ? "0" : "unname(coef(m)[1])"},` +
      `r2=s$r.squared,p=unname(s$coefficients[${slopeIdx},4]),` +
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
