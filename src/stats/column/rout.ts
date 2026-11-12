// Outlier detection, column by column, computed by R. Grubbs' test is at the end. ROUT method (Motulsky & Brown, BMC Bioinformatics 2006), column
// by column as in Prism, computed by R: each column is fitted robustly (on a Column table,
// a Huber mean with MADN scale), each point's residual becomes a t statistic (df = n − 1),
// and points are outliers when their FDR-adjusted P (Benjamini-Hochberg) is below Q.
import type { AnalysisOutcome, Column, OutliersParams } from "../types";
import { describe, rVec } from "./base";
import { evalNamedVector } from "../webr";

const DEFAULTS: OutliersParams = { q: 1 };

/** R: `rout(x, q)`, a column's robust mean, then each point's adjusted P (none when the
 *  column has fewer than 3 values or none differ); `HUBER_K` gives 95% efficiency. */
const R_ROUT = `
rout<-function(x,q){mu<-median(x);s<-mad(x);if(length(x)<3||s==0)return(list(mu=if(length(x)<3)NA else mu,p=rep(NA,length(x))))
for(i in 1:30){u<-(x-mu)/s;w<-ifelse(abs(u)<=1.345,1,1.345/abs(u));nx<-sum(w*x)/sum(w);done<-abs(nx-mu)<1e-9;mu<-nx;if(done)break}
list(mu=mu,p=p.adjust(2*pt(-abs((x-mu)/s),length(x)-1),"BH"))}`;

export async function runRout(columns: Column[], params?: OutliersParams): Promise<AnalysisOutcome> {
  const groups = columns.filter((c) => c.values.length > 0);
  if (groups.length < 1) return { error: "This needs at least 1 column containing numeric data." };
  const { q: qPercent } = params ?? DEFAULTS;

  // Per column: its robust mean, points, outliers and their share; each point's adjusted P;
  // then the totals.
  const v = await evalNamedVector(
    `${R_ROUT}\nq<-${qPercent / 100};R<-lapply(list(${groups.map((g) => rVec(g.values)).join(",")}),rout,q)\n` +
      `o<-sapply(R,function(r)sum(r$p<q,na.rm=TRUE));N<-sapply(R,function(r)length(r$p))\n` +
      `c(unlist(lapply(seq_along(R),function(i)setNames(c(R[[i]]$mu,N[i],o[i],100*o[i]/N[i],R[[i]]$p),` +
      `c(paste0(c("mu_","n_","o_","pc_"),i-1),paste0("p_",i-1,"_",seq_along(R[[i]]$p)-1))))),` +
      `total=sum(N),outliers=sum(o),percent=100*sum(o)/sum(N))`,
  );

  const flagged = groups.flatMap((g, gi) =>
    g.rows.flatMap((row, k) => {
      const p = v[`p_${gi}_${k}`];
      return p != null && p < qPercent / 100 ? [{ group: g.name, row, value: g.values[k], p }] : [];
    }),
  );
  const skipped = groups.filter((_, gi) => v[`p_${gi}_0`] == null).map((g) => g.name);

  const notes =
    (flagged.length
      ? `Flagged as outliers (FDR-adjusted P < Q): ${flagged
          .map((f) => `${f.group} row ${f.row + 1} (value ${f.value}, adj. P = ${f.p.toFixed(4)})`)
          .join("; ")}. Use Edit ▸ Exclude / Include (⌘E) on those cells to leave them out of other tests and graphs.`
      : `No outliers detected at Q = ${qPercent}%.`) +
    ` Method: each column fit independently to a robust mean (Huber M-estimator, scale from the median absolute ` +
    `deviation), residuals tested via a two-tailed t distribution and FDR-corrected (Benjamini-Hochberg) within ` +
    `that column. This mirrors the published Motulsky & Brown (2006) ROUT algorithm's logic, not GraphPad's ` +
    `certified implementation.` +
    (skipped.length ? ` Skipped (too few values or no variation to test): ${skipped.join(", ")}.` : "");

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
