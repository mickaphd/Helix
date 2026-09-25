// Shapiro-Wilk normality test — run per column. (Needs n ≥ 3 per column.)
// P values are shown neutrally (no significance stars): for normality the
// meaning is inverted — a *significant* P value means the data are NOT normal.
import { declareGroups, type ColumnTestSpec } from "./base";

export const shapiroWilkSpec: ColumnTestSpec = {
  testType: "shapiro-wilk",
  minGroups: 1,
  rCode: (groups) =>
    `${declareGroups(groups)};f<-function(x){if(length(x)<3)return(c(NA,NA));s<-shapiro.test(x);c(unname(s$statistic),s$p.value)};` +
    groups.map((_, i) => `r${i}<-f(g${i})`).join(";") +
    `;c(${groups.map((_, i) => `W${i}=r${i}[1],p${i}=r${i}[2]`).join(",")})`,
  rows: (v, groups) =>
    groups.flatMap((g, i) => [
      { label: `${g.name} — W`, value: v[`W${i}`] },
      { label: `${g.name} — P value`, value: v[`p${i}`] },
    ]),
  notes:
    "Per-column normality. P > 0.05: data are consistent with a normal distribution. " +
    "P < 0.05: significant departure from normality.",
};
