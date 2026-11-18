// Contingency-table analysis: each data column holding counts is an outcome, each row a
// group; the counts are those of complete rows (a count in every column). A 2 × 2 table is
// tested by Fisher's exact test (the default, exact at any size) or the chi-square, with
// Yates' correction or without; a larger one by the chi-square, or, with 2 columns and rows
// in a meaningful order, the chi-square test for trend (Cochran-Armitage, R's
// prop.trend.test). A 2 × 2 also gives the odds ratio, the relative risk, the difference
// of the two risks (Newcombe's CI) and the number needed to treat, and, read as a
// diagnostic test (rows: test positive, negative; columns: condition present, absent),
// its sensitivity, specificity and predictive values (Wilson's CIs). One R round-trip.
import type { AnalysisOutcome, ChiSquareParams, Column, StatRow } from "../types";
import { dataGroups, pairedGroups } from "../column/base";
import { evalNamedVector } from "../webr";
import { num } from "../../lib/format";

type Test = NonNullable<ChiSquareParams["test"]>;

/** The test as an analysis is named after it. */
export const CONTINGENCY_NAMES: Record<Test, string> = {
  fisher: "Fisher's exact test",
  yates: "Chi-square test",
  "chi-square": "Chi-square test",
  trend: "Chi-square test for trend",
};

const SUBTITLES: Record<Test, string> = {
  fisher: "Fisher's exact test",
  yates: "Chi-square test with Yates' correction",
  "chi-square": "Pearson's chi-square test",
  trend: "Chi-square test for trend",
};

/** R: `wil(x, n)`, the Wilson score 95% CI of the proportion x / n. */
const R_WILSON =
  "wil<-function(x,n){z<-qnorm(0.975);p<-x/n;c0<-(p+z^2/(2*n))/(1+z^2/n);h<-z*sqrt(p*(1-p)/n+z^2/(4*n^2))/(1+z^2/n);c(c0-h,c0+h)}";

export async function runChiSquare(columns: Column[], params?: ChiSquareParams): Promise<AnalysisOutcome> {
  const cols = dataGroups(columns).length;
  if (cols < 2) return { error: "A contingency table needs at least 2 group columns." };

  // Category rows = complete rows (a count in every group column).
  const groups = pairedGroups(columns);
  const matrix = (groups[0]?.values ?? []).map((_, r) => groups.map((g) => g.values[r]));
  if (matrix.flat().some((v) => v < 0)) return { error: "Counts can't be negative." };
  const part = matrix.flat().find((v) => !Number.isInteger(v));
  if (part !== undefined) return { error: `Counts must be whole numbers; the table holds ${part}.` };
  if (matrix.length < 2) {
    return { error: "A contingency table needs at least 2 rows with a count in every group column." };
  }

  const rows = matrix.length;
  const flat = matrix.flat();
  if (flat.every((v) => v === 0)) return { error: "The contingency table is empty (all counts are zero)." };
  const is2x2 = rows === 2 && cols === 2;
  const test: Test = params?.test ?? (is2x2 ? "fisher" : "chi-square");
  if ((test === "fisher" || test === "yates") && !is2x2)
    return { error: `${SUBTITLES[test]} is for a 2 × 2 table; this one is ${rows} × ${cols}.` };
  if (test === "trend" && (cols !== 2 || rows < 3))
    return {
      error: `The chi-square test for trend needs 2 columns and 3 rows or more; this table is ${rows} × ${cols}.`,
    };
  if (test === "trend" && matrix.some(([a, b]) => a + b === 0))
    return { error: "The chi-square test for trend needs a count in every row." };
  // Fisher's exact test sums the probability of every table with these margins: beyond
  // ten million subjects, more than R can hold.
  const total = flat.reduce((a, v) => a + v, 0);
  if (is2x2 && total > 1e7)
    return { error: `Fisher's exact test takes up to 10,000,000 subjects in all; this table holds ${num(total)}.` };

  // as.numeric() drops R's own names ("X-squared", "df"…): the keys are only ours.
  const m = `m<-matrix(c(${flat.join(",")}),nrow=${rows},byrow=TRUE)`;
  const rCode = is2x2
    ? `${R_WILSON};${m};ft<-fisher.test(m);ct<-suppressWarnings(chisq.test(m,correct=${test !== "chi-square" ? "TRUE" : "FALSE"}));` +
      // The first column's risk in row 1 over row 2, its CI on the log (Katz); Phi, signed;
      // the two risks' difference, its CI Newcombe's (Wilson's of each risk combined).
      `n1<-sum(m[1,]);n2<-sum(m[2,]);p1<-m[1,1]/n1;p2<-m[2,1]/n2;rr<-p1/p2;` +
      `z<-qnorm(0.975)*sqrt(1/m[1,1]-1/n1+1/m[2,1]-1/n2);w1<-wil(m[1,1],n1);w2<-wil(m[2,1],n2);d<-p1-p2;` +
      `dlo<-d-sqrt((p1-w1[1])^2+(w2[2]-p2)^2);dhi<-d+sqrt((w1[2]-p1)^2+(p2-w2[1])^2);` +
      `se<-wil(m[1,1],sum(m[,1]));sp<-wil(m[2,2],sum(m[,2]));pp<-wil(m[1,1],n1);np<-wil(m[2,2],n2);` +
      `c(p=${test === "fisher" ? "ft$p.value" : "ct$p.value"},odds=as.numeric(ft$estimate),oddsLo=ft$conf.int[1],oddsHi=ft$conf.int[2],` +
      `chisq=as.numeric(ct$statistic),df=as.numeric(ct$parameter),minexp=min(ct$expected),n=sum(m),` +
      `rr=rr,rrLo=rr*exp(-z),rrHi=rr*exp(z),phi=(m[1,1]*m[2,2]-m[1,2]*m[2,1])/sqrt(prod(rowSums(m),colSums(m))),` +
      `d=d,dLo=dlo,dHi=dhi,nnt=1/abs(d),nntLo=if(dlo>0||dhi<0)1/max(abs(c(dlo,dhi))) else NA,nntHi=if(dlo>0||dhi<0)1/min(abs(c(dlo,dhi))) else NA,` +
      `sens=m[1,1]/sum(m[,1]),sensLo=se[1],sensHi=se[2],spec=m[2,2]/sum(m[,2]),specLo=sp[1],specHi=sp[2],` +
      `ppv=p1,ppvLo=pp[1],ppvHi=pp[2],npv=m[2,2]/n2,npvLo=np[1],npvHi=np[2])`
    : `${m};ct<-suppressWarnings(chisq.test(m));` +
      (test === "trend"
        ? `tt<-prop.trend.test(m[,1],rowSums(m));c(chisq=as.numeric(tt$statistic),df=1,p=tt$p.value,minexp=min(ct$expected),n=sum(m))`
        : `c(chisq=as.numeric(ct$statistic),df=as.numeric(ct$parameter),p=ct$p.value,minexp=min(ct$expected),n=sum(m),` +
          `cramer=sqrt(as.numeric(ct$statistic)/(sum(m)*(min(dim(m))-1))))`);

  const v = await evalNamedVector(rCode);
  const row = (label: string, key: string, p = false): StatRow => ({
    label,
    value: v[key] ?? null,
    ...(p ? { p } : {}),
  });
  /** A measure and its 95% CI's bounds, each a row. */
  const withCi = (label: string, key: string, ci = "95% CI") => [
    row(label, key),
    row(`${label.replace(/ \(.*\)$/, "")} ${ci} lower`, `${key}Lo`),
    row(`${label.replace(/ \(.*\)$/, "")} ${ci} upper`, `${key}Hi`),
  ];
  const stats: StatRow[] = [];
  if (is2x2) {
    stats.push(
      test === "fisher" ? row("P value (Fisher's exact test)", "p", true) : row("P value", "p", true),
      ...(test === "fisher"
        ? []
        : [row(`Chi-square${test === "yates" ? " (Yates' correction)" : ""}`, "chisq"), row("df", "df")]),
      ...withCi("Odds ratio (conditional estimate)", "odds"),
      ...withCi(`Relative risk (${groups[0].name})`, "rr"),
      ...withCi(`Difference of risks (${groups[0].name})`, "d"),
      ...withCi("Number needed to treat", "nnt"),
      row("Phi", "phi"),
      ...withCi("Sensitivity", "sens"),
      ...withCi("Specificity", "spec"),
      ...withCi("Positive predictive value", "ppv"),
      ...withCi("Negative predictive value", "npv"),
      ...(test === "fisher" ? [row("Chi-square (Yates' correction, for reference)", "chisq"), row("df", "df")] : []),
    );
  } else if (test === "trend") {
    stats.push(row("Chi-square for trend", "chisq"), row("df", "df"), row("P value", "p", true));
  } else {
    stats.push(row("Chi-square", "chisq"), row("df", "df"), row("P value", "p", true), row("Cramér's V", "cramer"));
  }

  const first = groups[0].name;
  const lowExpected = test !== "fisher" && v.minexp != null && v.minexp < 5;
  const notes =
    `Contingency table ${rows} × ${cols}, N = ${num(v.n ?? null)}. ${SUBTITLES[test]}` +
    (test === "trend" ? `: do the shares of “${first}” rise or fall down the rows, in their order?` : ".") +
    (is2x2
      ? ` The odds ratio is for the table as entered (rows × columns): Fisher's conditional estimate, close to ` +
        `but not a·d / b·c. The relative risk and the difference of risks compare the first row's share of ` +
        `“${first}” with the second row's; the number needed to treat is one over that difference` +
        (v.nntLo == null ? ", its CI running through infinity as the difference's runs through 0" : "") +
        `. Sensitivity, specificity and predictive values read the rows as a test's results (positive first) ` +
        `and the columns as the condition (present first).`
      : "") +
    (lowExpected
      ? " Warning: some expected counts are below 5, so the chi-square approximation may be unreliable — consider combining categories."
      : "");

  return { testType: "chi-square", subtitle: SUBTITLES[test], stats, groups: [], notes };
}
