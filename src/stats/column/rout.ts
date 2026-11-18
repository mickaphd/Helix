// Outlier detection, column by column, computed by R. ROUT (Motulsky & Brown, BMC
// Bioinformatics 2006), as Prism runs it on column data: the very procedure of a curve's
// ROUT (`R_ROUT_CURVE`) with a constant for curve, the column's robust mean (K = 1),
// which finds up to 30 % of a column's values, from 3 values. Grubbs' test is at the end.
import type { AnalysisOutcome, Column, OutliersParams } from "../types";
import { describe, rVec } from "./base";
import { evalNamedVector } from "../webr";
import { R_ROUT_CURVE } from "../xy/nonlinear-regression";

const DEFAULTS: OutliersParams = { q: 1 };

export async function runRout(columns: Column[], params?: OutliersParams): Promise<AnalysisOutcome> {
  const groups = columns.filter((c) => c.values.length > 0);
  if (groups.length < 1) return { error: "This needs at least 1 column containing numeric data." };
  const { q: qPercent } = params ?? DEFAULTS;

  // Per column: its robust mean (none when it can't be fitted: under 3 values, or all
  // alike), points, outliers and their share, each value's flag; then the totals.
  const v = await evalNamedVector(
    `fit<-function(x,y,w=NULL)lm(y~1,weights=w)\n${R_ROUT_CURVE}\n` +
      `R<-lapply(list(${groups.map((g) => rVec(g.values)).join(",")}),function(y)routOf(seq_along(y),y,1,${qPercent / 100}))\n` +
      `o<-sapply(R,function(r)sum(r$out));N<-sapply(R,function(r)length(r$out))\n` +
      `c(unlist(lapply(seq_along(R),function(i)setNames(c(if(is.null(R[[i]]$m))NA else unname(coef(R[[i]]$m)[1]),` +
      `N[i],o[i],100*o[i]/N[i],as.numeric(R[[i]]$out)),` +
      `c(paste0(c("mu_","n_","o_","pc_"),i-1),paste0("f_",i-1,"_",seq_along(R[[i]]$out)-1))))),` +
      `total=sum(N),outliers=sum(o),percent=100*sum(o)/sum(N))`,
  );

  const flagged = groups.flatMap((g) =>
    g.rows.flatMap((row, k) =>
      v[`f_${groups.indexOf(g)}_${k}`] === 1 ? [{ group: g.name, row, value: g.values[k] }] : [],
    ),
  );
  const skipped = groups.filter((_, gi) => v[`mu_${gi}`] == null).map((g) => g.name);

  const notes =
    (flagged.length
      ? `Outliers: ${flagged.map((f) => `${f.group} row ${f.row + 1} (value ${f.value})`).join("; ")}. ` +
        "Use Edit ▸ Exclude / Include (⌘E) on those cells to leave them out of other tests and graphs."
      : `No outliers detected at Q = ${qPercent}%.`) +
    ` ROUT (Motulsky & Brown, 2006): each column's robust mean (its scatter taken as Lorentzian), then, ` +
    `among the 30% of values farthest from it, those too far for a false discovery rate of Q.` +
    (skipped.length ? ` Skipped (fewer than 3 values, or all alike): ${skipped.join(", ")}.` : "");

  return {
    testType: "outliers",
    subtitle: `ROUT method (Q = ${qPercent}%)`,
    stats: [
      { label: "Total observations", value: v.total ?? null },
      { label: "Groups analyzed", value: groups.length },
      { label: "Outliers detected", value: v.outliers ?? null },
      { label: "Outlier percentage (%)", value: v.percent ?? null },
      { label: "Q parameter (%)", value: qPercent },
    ],
    groups: (await describe(groups)).groups,
    outlierGroups: groups.map((g, gi) => ({
      group: g.name,
      points: v[`n_${gi}`] ?? 0,
      outliers: v[`o_${gi}`] ?? 0,
      percent: v[`pc_${gi}`] ?? 0,
      robustMean: v[`mu_${gi}`] ?? null,
    })),
    notes,
  };
}

/** R: `grubbsP(G, n)`, the two-sided P of Grubbs' G among `n` values; `grubbs(x)`, the place
 *  of a column's value farthest from its mean, its G and its P (none when the column has
 *  fewer than 3 values or none differ). */
export const R_GRUBBS = `
grubbsP<-function(G,n)min(1,2*n*pt(-sqrt(n*(n-2)*G^2/((n-1)^2-n*G^2)),n-2))
grubbs<-function(x){n<-length(x);s<-sd(x);if(n<3||s==0)return(c(NA,NA,NA));i<-which.max(abs(x-mean(x)));G<-abs(x[i]-mean(x))/s
c(i,G,grubbsP(G,n))}`;

const ALPHA = 0.05;

/** Grubbs' test: in each column, whether the value farthest from the mean is an outlier. */
export async function runGrubbs(columns: Column[]): Promise<AnalysisOutcome> {
  const groups = columns.filter((c) => c.values.length > 0);
  if (groups.length < 1) return { error: "This needs at least 1 column containing numeric data." };
  const v = await evalNamedVector(
    `${R_GRUBBS}\nR<-lapply(list(${groups.map((g) => rVec(g.values)).join(",")}),grubbs)\n` +
      `N<-c(${groups.map((g) => g.values.length).join(",")});o<-sapply(R,function(r)!is.na(r[3])&&r[3]<${ALPHA})\n` +
      `c(unlist(lapply(seq_along(R),function(i)setNames(R[[i]],paste0(c("i_","G_","p_"),i-1)))),` +
      `total=sum(N),outliers=sum(o))`,
  );
  const rows = groups.map((g, gi) => {
    const at = v[`i_${gi}`];
    const p = v[`p_${gi}`];
    return { g, at: at == null ? null : at - 1, G: v[`G_${gi}`], p, outlier: p != null && p < ALPHA };
  });
  const flagged = rows.filter((r) => r.outlier);
  const skipped = rows.filter((r) => r.at === null).map((r) => r.g.name);
  const notes =
    (flagged.length
      ? `Outliers (P < ${ALPHA}): ${flagged
          .map((r) => `${r.g.name} row ${r.g.rows[r.at!] + 1} (value ${r.g.values[r.at!]})`)
          .join("; ")}. Use Edit ▸ Exclude / Include (⌘E) on those cells to leave them out of other tests and graphs.`
      : `No outlier detected at alpha = ${ALPHA}.`) +
    ` Grubbs' test asks, in each column, whether the value farthest from the mean is an outlier: it finds one at ` +
    `most, and assumes the other values are sampled from a normal distribution. Two-sided.` +
    (skipped.length ? ` Skipped (too few values or no variation to test): ${skipped.join(", ")}.` : "");

  return {
    testType: "outliers",
    subtitle: `Grubbs' test (alpha = ${ALPHA})`,
    stats: [
      { label: "Total observations", value: v.total ?? null },
      { label: "Groups analyzed", value: groups.length },
      { label: "Outliers detected", value: v.outliers ?? null },
    ],
    groups: (await describe(groups)).groups,
    outlierGroups: rows.map(({ g, at, G, p, outlier }) => ({
      group: g.name,
      points: g.values.length,
      outliers: outlier ? 1 : 0,
      percent: (outlier ? 100 : 0) / g.values.length,
      robustMean: null,
      grubbs: { extreme: at === null ? null : g.values[at], g: G ?? null, p: p ?? null },
    })),
    notes,
  };
}
