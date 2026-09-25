// Multiple linear regression on a Multiple Variables table: one chosen dependent
// variable regressed on every other data-bearing variable, fit on complete cases.
// Bespoke runner (not ColumnTestSpec) — needs a chosen response + a coefficients table.
import type {
  AnalysisOutcome,
  Column,
  MultipleRegressionParams,
  RegressionCoefficient,
} from "../types";
import { dataGroups, describe, missingColumn, pairedGroups, pRow, rVec } from "../column/base";
import { evalNamedVector } from "../webr";

export async function runMultipleRegression(
  columns: Column[],
  params: MultipleRegressionParams | undefined,
): Promise<AnalysisOutcome> {
  const gone = [params?.dependent, ...(params?.predictors ?? [])].find(
    (n) => n !== undefined && !columns.some((c) => c.name === n),
  );
  if (gone) return { error: missingColumn(gone) };
  const vars = dataGroups(columns);
  const dep = params?.dependent === undefined ? vars[0] : vars.find((c) => c.name === params.dependent);
  const chosen = params?.predictors;
  const predictors = dep
    ? chosen && chosen.length > 0
      ? vars.filter((c) => c !== dep && chosen.includes(c.name))
      : vars.filter((c) => c !== dep)
    : [];
  if (!dep || predictors.length < 1) {
    return { error: "Multiple regression needs a dependent variable and at least one other variable with data." };
  }

  // Complete cases: the rows where every variable used has a value.
  const used = [dep, ...predictors];
  const aligned = pairedGroups(used).map((g) => g.values);
  const n = aligned[0].length;
  const p = predictors.length;
  if (n <= p + 1) {
    return { error: `Not enough complete rows (${n}) to fit ${p} predictor(s). Enter more data and try again.` };
  }

  const decls = [`y<-${rVec(aligned[0])}`, ...predictors.map((_, i) => `x${i}<-${rVec(aligned[i + 1])}`)];
  const formula = `y~${predictors.map((_, i) => `x${i}`).join("+")}`;
  // Each coefficient row t (0 = intercept) pulled from summary()'s coefficient
  // matrix by explicit index → keyed names, so extraction never depends on order.
  const coefAssigns = Array.from({ length: p + 1 }, (_, t) =>
    `b${t}=co[${t + 1},1],se${t}=co[${t + 1},2],t${t}=co[${t + 1},3],pv${t}=co[${t + 1},4]`,
  );
  const code =
    `${decls.join(";")};m<-lm(${formula});s<-summary(m);co<-s$coefficients;f<-s$fstatistic;` +
    `c(r2=s$r.squared,adjr2=s$adj.r.squared,fstat=unname(f[1]),` +
    `fp=unname(pf(f[1],f[2],f[3],lower.tail=FALSE)),${coefAssigns.join(",")})`;

  try {
    const v = await evalNamedVector(code);
    const terms = ["Intercept", ...predictors.map((c) => c.name)];
    const coefficients: RegressionCoefficient[] = terms.map((term, t) => ({
      term,
      estimate: v[`b${t}`] ?? null,
      stdError: v[`se${t}`] ?? null,
      t: v[`t${t}`] ?? null,
      p: v[`pv${t}`] ?? null,
    }));
    const described = used.map(describe);
    return {
      testType: "multiple-regression",
      subtitle: "Multiple linear regression",
      stats: [
        { label: "R squared", value: v.r2 },
        { label: "Adjusted R squared", value: v.adjr2 },
        { label: "F", value: v.fstat },
        pRow("P value (model)", v.fp ?? null),
        { label: "Complete rows (n)", value: n },
        { label: "Predictors", value: p },
      ],
      groups: described,
      notes:
        `Ordinary least-squares regression of “${dep.name}” on ${p} predictor(s), fit on ${n} complete rows. ` +
        "Each coefficient's P value tests whether that predictor's slope differs from zero, holding the others fixed.",
      coefficients,
    };
  } catch (err) {
    return { error: `Could not run the test: ${err instanceof Error ? err.message : String(err)}` };
  }
}
