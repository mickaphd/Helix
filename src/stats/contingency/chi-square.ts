// Contingency-table analysis: Pearson's chi-square test, with Fisher's exact test
// used automatically for 2×2 tables (more accurate for small samples — Prism's
// default there). Each data column holding counts is a group; each row is a
// category. The count matrix is built from complete rows (every group column
// filled) and the whole test is one WebR round-trip returning a flat named vector.
import type { AnalysisOutcome, Column, StatRow } from "../types";
import { dataGroups, pairedGroups } from "../column/base";
import { evalNamedVector } from "../webr";
import { num } from "../../lib/format";

export async function runChiSquare(columns: Column[]): Promise<AnalysisOutcome> {
  const cols = dataGroups(columns).length;
  if (cols < 2) return { error: "A contingency table needs at least 2 group columns." };

  // Category rows = complete rows (a count in every group column).
  const groups = pairedGroups(columns);
  const matrix = (groups[0]?.values ?? []).map((_, r) => groups.map((g) => g.values[r]));
  if (matrix.flat().some((v) => v < 0)) return { error: "Counts can't be negative." };
  if (matrix.length < 2) {
    return { error: "A contingency table needs at least 2 rows with a count in every group column." };
  }

  const rows = matrix.length;
  const flat = matrix.flat();
  if (flat.every((v) => v === 0)) return { error: "The contingency table is empty (all counts are zero)." };
  const is2x2 = rows === 2 && cols === 2;

  // as.numeric() drops R's own names ("X-squared", "df"…): the keys are only ours.
  const rCode = is2x2
    ? `m<-matrix(c(${flat.join(",")}),nrow=2,byrow=TRUE);ft<-fisher.test(m);ct<-suppressWarnings(chisq.test(m));` +
      `c(p=ft$p.value,odds=as.numeric(ft$estimate),oddsLo=ft$conf.int[1],oddsHi=ft$conf.int[2],` +
      `chisq=as.numeric(ct$statistic),df=as.numeric(ct$parameter),minexp=min(ct$expected),n=sum(m))`
    : `m<-matrix(c(${flat.join(",")}),nrow=${rows},byrow=TRUE);ct<-suppressWarnings(chisq.test(m));` +
      `c(chisq=as.numeric(ct$statistic),df=as.numeric(ct$parameter),p=ct$p.value,minexp=min(ct$expected),n=sum(m))`;

  try {
    const v = await evalNamedVector(rCode);
    const stats: StatRow[] = [];
    if (is2x2) {
      stats.push({ label: "P value (Fisher's exact test)", value: v.p ?? null, p: true });
      stats.push({ label: "Odds ratio", value: v.odds ?? null });
      stats.push({ label: "Chi-square (for reference)", value: v.chisq ?? null });
      stats.push({ label: "df", value: v.df ?? null });
    } else {
      stats.push({ label: "Chi-square", value: v.chisq ?? null });
      stats.push({ label: "df", value: v.df ?? null });
      stats.push({ label: "P value", value: v.p ?? null, p: true });
    }

    const lowExpected = !is2x2 && v.minexp != null && v.minexp < 5;
    const notes =
      `Contingency table ${rows}×${cols}, N = ${num(v.n ?? null)}. ` +
      (is2x2
        ? `Fisher's exact test (2×2). Odds ratio 95% CI: ${num(v.oddsLo ?? null)} to ${num(v.oddsHi ?? null)} ` +
          `for the table as entered (rows × columns).`
        : `Pearson's chi-square test.`) +
      (lowExpected
        ? " Warning: some expected counts are below 5, so the chi-square approximation may be unreliable — consider combining categories."
        : "");

    return {
      testType: "chi-square",
      subtitle: is2x2 ? "Fisher's exact test" : "Pearson's chi-square test",
      stats,
      groups: [],
      notes,
    };
  } catch (err) {
    return { error: `Could not run the test: ${err instanceof Error ? err.message : String(err)}` };
  }
}
