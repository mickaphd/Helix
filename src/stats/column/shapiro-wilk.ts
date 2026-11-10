// Shapiro-Wilk normality test — run per column. A column R can't test (fewer than 3
// values, more than 5000, or all identical) gets no result, and the notes say so.
// P values are shown neutrally (no significance stars): for normality the
// meaning is inverted — a *significant* P value means the data are NOT normal.
import { declareGroups, type ColumnTestSpec, type Group } from "./base";

/** Whether Shapiro-Wilk can test these values. */
export const testable = ({ values }: Group) =>
  values.length >= 3 && values.length <= 5000 && values.some((v) => v !== values[0]);

export const shapiroWilkSpec: ColumnTestSpec = {
  testType: "shapiro-wilk",
  minGroups: 1,
  rCode: (groups) =>
    `${declareGroups(groups)};f<-function(x){if(length(x)<3||length(x)>5000||min(x)==max(x))return(c(NA,NA));s<-shapiro.test(x);c(unname(s$statistic),s$p.value)};` +
    groups.map((_, i) => `r${i}<-f(g${i})`).join(";") +
    `;c(${groups.map((_, i) => `W${i}=r${i}[1],p${i}=r${i}[2]`).join(",")})`,
  rows: (v, groups) =>
    groups.flatMap((g, i) => [
      { label: `${g.name} — W`, value: v[`W${i}`] },
      { label: `${g.name} — P value`, value: v[`p${i}`] },
    ]),
  notes: (_params, groups) => {
    const untested = groups.filter((g) => !testable(g)).map((g) => `“${g.name}”`);
    return (
      "Per-column normality. P > 0.05: data are consistent with a normal distribution. " +
      "P < 0.05: significant departure from normality." +
      (untested.length
        ? ` Not tested (the test needs 3 to 5000 values that aren't all identical): ${untested.join(", ")}.`
        : "")
    );
  },
};
