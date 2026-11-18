// Two-way ANOVA — compares a Grouped table's column-groups (A, B, C…) and row
// position, plus their interaction. `design` picks:
// - "ordinary": independent-samples two-way ANOVA.
// - "repeated-measures": matched by row — each replicate column is treated as
//   one subject, measured at every row within its group (a mixed/split-plot
//   design): the strata of `aov(v~g*r+Error(id/r))`, computed from the subjects' means
//   (`R_TWO_WAY`'s `sp`). Incomplete replicate columns (missing a row) are dropped. Sphericity not
//   assumed (`sphericity` false), the row and interaction effects, within subjects, take
//   the Geisser-Greenhouse epsilon of the rows' covariance pooled over the groups, and each
//   comparison its own error (`correctedPosthoc`).
// - "nonparametric": Scheirer-Ray-Hare — rank-transform the response, run the
//   same ANOVA on the ranks (Type III, so an unbalanced design doesn't depend on the
//   factors' order), then each effect's sum of squares over the ranks' total mean
//   square is a chi-square H statistic — fully computable in base R.
// `posthoc` (parametric designs only) pairwise-compares either groups within
// each row, or rows within each group ("row means"), using the design's own
// pooled residual variance — the same statistic R's own TukeyHSD computes
// internally (q = sqrt(2)*|t|, t from the pooled-MSE two-sample t stat), just
// derived directly instead of relying on TukeyHSD's interaction-term row naming.
// Each row (or each group) is a family of comparisons, corrected on its own. On the ordinary
// design, Dunnett compares each member of a family with its control (a group, or a row: the
// distribution of the largest t, `dun`, its critical value found once per family), and
// Games-Howell every pair on the two cells' own variances (Welch's t and df, against the
// studentized range).
import {
  PAIR_CORRECTIONS,
  type AnalysisOutcome,
  type Column,
  type ComparedCell,
  type ComparisonRow,
  type TwoWayAnovaParams,
} from "../types";
import {
  describe,
  identical,
  pairIndices,
  posthocOf,
  pRow,
  R_ADJUST,
  R_CRIT,
  R_PTUKEY,
  rStr,
  rVec,
} from "../column/base";
import { evalNamedVector } from "../webr";
import { R_MAXIMUM_T } from "../column/anova";
import { completeSubjects, flattenGrouped, flattenRepeated, groupRows, rowName } from "./base";

// Group/row/subject labels derive from user column names, so they must be escaped
// before interpolation — only their distinctness matters to the model, not their text.
const rFactor = (labels: string[]) => `factor(c(${labels.map(rStr).join(",")}))`;

type Method = "tukey" | (typeof PAIR_CORRECTIONS)[number];
type OrdinaryMethod = Method | "dunnett" | "games-howell";
const corrects = (method: OrdinaryMethod) => (PAIR_CORRECTIONS as readonly string[]).includes(method);

/** R: a comparison's P from its t (`x`), `means` means in its family, at `df`: Tukey's, or the
 *  raw P that `byFamily` corrects with its family's; and (`ciP`) the corrected P its CI
 *  inverts, of the statistic `x` (none for Holm-Šidák: `pa` is NA). */
const pOf = (method: Method, x: string, means: number, df: string) =>
  method === "tukey" ? `ptk(abs(${x})*sqrt(2),${means},${df})` : `2*pt(-abs(${x}),${df})`;
const ciP = (method: Method, means: number, df: string) =>
  method === "tukey" ? pOf(method, "x", means, df) : `pa(x,${df},"${method}",${(means * (means - 1)) / 2})`;

/** R: each comparison's `c(d, P, lo, hi)` (`parts`), its P corrected with those of its family
 *  (`family`: a row, or a group) unless Tukey's, as one vector named d_k, p_k, lo_k, hi_k. */
const byFamily = (parts: string[], family: number[], method: OrdinaryMethod) =>
  `setNames({R<-rbind(${parts.join(",")});` +
  (!corrects(method) ? "" : `R[,2]<-ave(R[,2],c(${family.join(",")}),FUN=function(p)adj(p,"${method}"));`) +
  `as.vector(t(R))},c(${parts.map((_, k) => `"d_${k}","p_${k}","lo_${k}","hi_${k}"`).join(",")}))`;

/** The pairs of a family's `count` members compared: each with the control (`control`, an
 *  index; Dunnett), else every pair. */
const familyPairs = (count: number, control?: number): [number, number][] =>
  control === undefined
    ? pairIndices(count)
    : Array.from({ length: count }, (_, i): [number, number] => [i, control]).filter(([i]) => i !== control);

async function runPosthoc(
  columns: Column[],
  method: OrdinaryMethod,
  target: "groups" | "rows",
  mse: number | null,
  dfResid: number | null,
  titles: (string | null)[],
  control?: string,
): Promise<ComparisonRow[] | { error: string } | undefined> {
  if (mse == null || dfResid == null) return undefined;
  const rows = groupRows(columns);
  const names = [...rows.keys()];
  const rowCount = rows.get(names[0])?.length ?? 0;
  // Dunnett's control: a group, or a row by its name.
  const controlAt =
    method !== "dunnett"
      ? undefined
      : target === "groups"
        ? names.indexOf(control ?? "")
        : Array.from({ length: rowCount }, (_, r) => rowName(titles, r)).indexOf(control ?? "");
  if (controlAt === -1)
    return {
      error: `The control ${target === "groups" ? "group" : "row"}${control ? ` “${control}”` : ""} holds no data. Create this analysis again to choose another.`,
    };
  // Each comparison's two cells (a group at a row) and how many means its family compares
  // (the groups holding data at its row, or the rows holding data in its group).
  const cells: {
    label1: string;
    label2: string;
    at: [ComparedCell, ComparedCell];
    a: number[];
    b: number[];
    means: number;
    family: number;
  }[] = [];
  if (target === "groups") {
    for (let r = 0; r < rowCount; r++) {
      const means = names.filter((name) => rows.get(name)![r].length > 0).length;
      for (const [i, j] of familyPairs(names.length, controlAt)) {
        const [a, b] = [rows.get(names[i])![r], rows.get(names[j])![r]];
        if (a.length && b.length)
          cells.push({
            label1: `${names[i]} (${rowName(titles, r)})`,
            label2: `${names[j]} (${rowName(titles, r)})`,
            at: [
              { group: names[i], row: r },
              { group: names[j], row: r },
            ],
            a,
            b,
            means,
            family: r,
          });
      }
    }
  } else {
    for (const name of names) {
      const rowsForGroup = rows.get(name)!;
      const means = rowsForGroup.filter((v) => v.length > 0).length;
      for (const [i, j] of familyPairs(rowCount, controlAt)) {
        const [a, b] = [rowsForGroup[i], rowsForGroup[j]];
        if (a.length && b.length)
          cells.push({
            label1: `${rowName(titles, i)} (${name})`,
            label2: `${rowName(titles, j)} (${name})`,
            at: [
              { group: name, row: i },
              { group: name, row: j },
            ],
            a,
            b,
            means,
            family: names.indexOf(name),
          });
      }
    }
  }
  if (cells.length === 0) return undefined;
  if (method === "games-howell") {
    const flat = cells.flatMap((c) => [c.a, c.b]).find((v) => v.length < 2 || identical(v));
    if (flat)
      return {
        error:
          "Games-Howell compares each cell on its own scatter: every cell compared needs 2 values or more that vary.",
      };
  }
  // In R: each pair's difference of means, its t (on the ANOVA's mean square, or for
  // Games-Howell the two cells' own variances), its P corrected within its family, and its
  // 95% CI: the difference ± the t at which its corrected P is 0.05.
  const df = String(dfResid);
  const pooled = (c: (typeof cells)[number]) =>
    `{a<-${rVec(c.a)};b<-${rVec(c.b)};d<-mean(a)-mean(b);s<-sqrt(${mse}*(1/length(a)+1/length(b)));t<-d/s;`;
  // Dunnett: each family's weights (√(n / (n + n of its control))) and critical value, once.
  const families = [...new Set(cells.map((c) => c.family))];
  const dunnett =
    method === "dunnett"
      ? `${R_MAXIMUM_T}\n` +
        families
          .map((f) => {
            const own = cells.filter((c) => c.family === f);
            return (
              `l${f}<-sqrt(c(${own.map((c) => c.a.length).join(",")})/(c(${own.map((c) => c.a.length).join(",")})+${own[0].b.length}));` +
              `cv${f}<-crit(function(x)dun(x,l${f},${df}),qt(1-0.025/c(1,${own.length}),${df}))`
            );
          })
          .join(";") +
        ";"
      : "";
  const parts = cells.map((c) =>
    method === "dunnett"
      ? `${pooled(c)}h<-cv${c.family}*s;c(d,dun(t,l${c.family},${df}),d-h,d+h)}`
      : method === "games-howell"
        ? `{a<-${rVec(c.a)};b<-${rVec(c.b)};d<-mean(a)-mean(b);va<-var(a)/length(a);vb<-var(b)/length(b);s<-sqrt(va+vb);` +
          `w<-(va+vb)^2/(va^2/(length(a)-1)+vb^2/(length(b)-1));t<-d/s;h<-crit(function(x)ptk(x*sqrt(2),${c.means},w))*s;` +
          `c(d,ptk(abs(t)*sqrt(2),${c.means},w),d-h,d+h)}`
        : `${pooled(c)}h<-crit(function(x)${ciP(method, c.means, df)})*s;c(d,${pOf(method, "t", c.means, df)},d-h,d+h)}`,
  );
  const v = await evalNamedVector(
    `${R_PTUKEY};${R_CRIT};${R_ADJUST};${dunnett}c(${byFamily(
      parts,
      cells.map((c) => c.family),
      method,
    )})`,
  );
  return cells.map((c, k) => ({
    group1: c.label1,
    group2: c.label2,
    cells: c.at,
    diff: v[`d_${k}`] ?? null,
    low: v[`lo_${k}`] ?? null,
    high: v[`hi_${k}`] ?? null,
    p: v[`p_${k}`] ?? null,
  }));
}

/** R comparing the cells of a repeated-measures design without assuming sphericity (`Y`:
 *  a subject per row, a table row per column; `gs`: each subject's group), each comparison on
 *  its own error, never the whole experiment's: rows within a group, a paired t on that
 *  group's differences (n − 1 df); groups within a row, that row's pooled SD. */
function correctedPosthoc(
  method: Method,
  target: "groups" | "rows",
  groupNames: string[],
  rowNames: string[],
  rowIndex: number[],
): { rCode: string; labels: [string, string][]; cells: [ComparedCell, ComparedCell][] } {
  const labels: [string, string][] = [];
  const cells: [ComparedCell, ComparedCell][] = [];
  const parts: string[] = [];
  const family: number[] = [];
  // With its t (`t`) and standard error (`s`): its difference, its P, and its 95% CI, the
  // difference ± the t at which its corrected P is 0.05.
  const ci = (diff: string, means: number, df: string) =>
    `{dd<-${diff};h<-crit(function(x)${ciP(method, means, df)})*s;c(dd,${pOf(method, "t", means, df)},dd-h,dd+h)}`;
  if (target === "rows") {
    for (const g of groupNames)
      for (const [i, j] of pairIndices(rowNames.length)) {
        labels.push([`${rowNames[i]} (${g})`, `${rowNames[j]} (${g})`]);
        cells.push([
          { group: g, row: rowIndex[i] },
          { group: g, row: rowIndex[j] },
        ]);
        parts.push(
          `{a<-Y[gs==${rStr(g)},${i + 1}];b<-Y[gs==${rStr(g)},${j + 1}];d<-a-b;n<-length(d);` +
            `s<-sd(d)/sqrt(n);t<-abs(mean(d))/s;${ci("mean(a)-mean(b)", rowNames.length, "n-1")}}`,
        );
        family.push(groupNames.indexOf(g));
      }
  } else {
    rowNames.forEach((row, r) => {
      for (const [i, j] of pairIndices(groupNames.length)) {
        const [a, b] = [groupNames[i], groupNames[j]];
        labels.push([`${a} (${row})`, `${b} (${row})`]);
        cells.push([
          { group: a, row: rowIndex[r] },
          { group: b, row: rowIndex[r] },
        ]);
        parts.push(
          `{e<-Y[,${r + 1}];m<-tapply(e,gs,mean);k<-tapply(e,gs,length);dfe<-length(e)-nlevels(gs);` +
            `mse<-sum((e-m[gs])^2)/dfe;s<-sqrt(mse*(1/k[[${rStr(a)}]]+1/k[[${rStr(b)}]]));` +
            `t<-abs(m[[${rStr(a)}]]-m[[${rStr(b)}]])/s;${ci(`m[[${rStr(a)}]]-m[[${rStr(b)}]]`, groupNames.length, "dfe")}}`,
        );
        family.push(r);
      }
    });
  }
  const rCode = byFamily(parts, family, method);
  return { rCode, labels, cells };
}

/** The error when every value is the same, or when the model leaves no scatter to test
 *  the effects on (R's `flat`: a residual sum of squares of 0 next to the total's). */
const NOTHING_VARIES = "All the values are identical: there is no scatter to test the effects on.";
const NO_SCATTER =
  "The values follow their groups and rows exactly, with no scatter left around them: the effects can't be tested.";
const R_FLAT = (resid: string) => `${resid}<=1e-20*sum((v-mean(v))^2)`;

/** R: the sums of squares of a two-way design from its cells' counts and means, never a model
 *  matrix of one column per row (which made 500 rows take a minute); the same numbers as
 *  `aov` and `drop1` (tests/reference.ts checks them on unbalanced designs).
 *  `add2(n, mu)`: what the additive model leaves of the cell means, weighted by counts (NA
 *  when groups and rows don't overlap enough to tell their effects apart).
 *  `tw(v, g, r, inter)`: each effect's sum of squares, Type III (every cell filled: a main
 *  effect tests its unweighted means, the interaction what the additive model leaves),
 *  or, without the interaction, the additive model's (Type II = III); the residual's, its df.
 *  `sp(Y, gs)`: a split-plot (subjects in groups, each at every row) in the strata of
 *  `aov(v ~ g * r + Error(id / r))`: `e1` between subjects (groups, residual), `e2` within
 *  (rows, interaction, residual). */
export const R_TWO_WAY = `add2<-function(n,mu){G<-nrow(n);ng<-rowSums(n);nr<-colSums(n);mu[n==0]<-0;W<-n%*%diag(1/nr,length(nr))
S<-diag(ng,G)-W%*%t(n);b<-rowSums(n*mu)-W%*%colSums(n*mu);q<-qr(S[-1,-1,drop=FALSE])
if(q$rank<G-1)return(NA);a<-c(0,qr.coef(q,b[-1]));be<-colSums(n*(mu-a))/nr;sum(n*(mu-outer(a,be,"+"))^2)}
tw<-function(v,g,r,inter){n<-unclass(table(g,r));mu<-tapply(v,list(g,r),mean);G<-nrow(n);R<-ncol(n)
one<-function(m,w){W<-1/w;sum(W*(m-sum(W*m)/sum(W))^2)}
if(inter)return(c(g=one(rowMeans(mu),rowSums(1/n)/R^2),r=one(colMeans(mu),colSums(1/n)/G^2),i=add2(n,mu),
e=sum((v-mu[cbind(as.integer(g),as.integer(r))])^2),dfe=length(v)-G*R))
e<-add2(n,mu);c(g=sum((v-ave(v,r))^2)-e,r=sum((v-ave(v,g))^2)-e,e=e,dfe=length(v)-G-R+1)}
sp<-function(Y,gs){R<-ncol(Y);N<-nrow(Y);G<-nlevels(gs);k<-as.integer(gs);s<-rowMeans(Y);m<-mean(Y)
ng<-as.vector(table(gs));mg<-as.vector(tapply(s,gs,mean));mr<-colMeans(Y);mgr<-apply(Y,2,function(y)tapply(y,gs,mean))
st<-function(S,D){Q<-S/D;n<-length(S);f<-c(Q[-n]/Q[n],NA)
data.frame(Df=D,"Sum Sq"=S,"F value"=f,"Pr(>F)"=pf(f,D,D[n],lower.tail=FALSE),check.names=FALSE)}
list(e1=st(c(R*sum(ng*(mg-m)^2),R*sum((s-mg[k])^2)),c(G-1,N-G)),
e2=st(c(N*sum((mr-m)^2),sum(ng*(sweep(sweep(mgr,1,mg),2,mr)+m)^2),sum((Y-s-mgr[k,,drop=FALSE]+mg[k])^2)),
c(R-1,(G-1)*(R-1),(N-G)*(R-1))))}`;

async function runRepeatedMeasures(
  columns: Column[],
  params: TwoWayAnovaParams & { posthoc: Method | "none" },
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  const { values, group, row, subject, dropped } = flattenRepeated(columns);
  if (new Set(group).size < 2 || new Set(row).size < 2 || values.length === 0) {
    return {
      error:
        "Repeated-measures two-way ANOVA needs at least 2 column groups and 2 rows, each with at least one " +
        "replicate column that has a value in every row.",
    };
  }
  // The groups' effect is tested on the subjects' scatter within groups: one group at least
  // needs two subjects.
  if (identical(values)) return { error: NOTHING_VARIES };
  const subjectsOf = (g: string) => new Set(subject.filter((_, i) => group[i] === g)).size;
  const groupNames = [...new Set(group)];
  if (groupNames.every((g) => subjectsOf(g) < 2)) {
    return {
      error:
        "Repeated-measures two-way ANOVA needs at least one group with 2 replicate columns holding a value in " +
        "every row: each group here has one.",
    };
  }
  const corrected = params.sphericity === false;
  // The kept rows, in order (each subject holds one value at each); their display names.
  const rowKeys = [...new Set(row)];
  const rowNames = rowKeys.map((key) => rowName(titles, Number(key.slice(1)) - 1));
  const setup = `${R_PTUKEY};${R_CRIT};${R_ADJUST};v<-${rVec(values)};g<-${rFactor(group)};r<-${rFactor(row)};id<-${rFactor(subject)}`;
  // Y: a subject per row (values come subject by subject, rows in order); gs its group.
  // Geisser-Greenhouse: epsilon of the rows' covariance pooled over the groups, double-centered.
  const q = rowKeys.length;
  const gg =
    `S<-Reduce("+",lapply(split(seq_len(nrow(Y)),gs),function(i)if(length(i)>1)(length(i)-1)*cov(Y[i,,drop=FALSE]) else 0))/(nrow(Y)-nlevels(gs));` +
    `H<-diag(${q})-1/${q};C<-H%*%S%*%H;e<-min(1,sum(diag(C))^2/(${q - 1}*sum(C*C)))`;
  const within = (k: string, f: string, df: string, resid: string, p: string) =>
    corrected
      ? `${k}S=${f},${k}Df=e*${df},${k}DfResid=e*${resid},${k}P=pf(${f},e*${df},e*${resid},lower.tail=FALSE)`
      : `${k}S=${f},${k}Df=${df},${k}DfResid=${resid},${k}P=${p}`;
  const posthoc =
    corrected && params.posthoc !== "none"
      ? correctedPosthoc(
          params.posthoc,
          params.posthocTarget,
          // Rows within a group are compared on its subjects' differences: two at least.
          params.posthocTarget === "rows" ? groupNames.filter((g) => subjectsOf(g) > 1) : groupNames,
          rowNames,
          rowKeys.map((key) => Number(key.slice(1)) - 1),
        )
      : undefined;
  const rCode =
    `${setup};${R_TWO_WAY};Y<-matrix(v,ncol=${q},byrow=TRUE);gs<-factor(g[seq(1,length(v),by=${q})]);` +
    `a<-sp(Y,gs);e1<-a$e1;e2<-a$e2;` +
    // No scatter within subjects: nothing is testable. Between subjects only (each group's
    // subjects alike on average): the groups' effect alone isn't.
    `if(${R_FLAT('e2$"Sum Sq"[3]')})c(flat=1) else{gf<-${R_FLAT('e1$"Sum Sq"[2]')};` +
    `${gg};c(gflat=gf,gS=if(gf)NA else e1$"F value"[1],gDf=e1$Df[1],gP=if(gf)NA else e1$"Pr(>F)"[1],gDfResid=e1$Df[2],gMse=if(gf)NA else e1$"Sum Sq"[2]/e1$Df[2],` +
    `${within("r", 'e2$"F value"[1]', "e2$Df[1]", "e2$Df[3]", 'e2$"Pr(>F)"[1]')},` +
    `${within("i", 'e2$"F value"[2]', "e2$Df[2]", "e2$Df[3]", 'e2$"Pr(>F)"[2]')},` +
    `rMse=e2$"Sum Sq"[3]/e2$Df[3],eps=e${posthoc ? "," + posthoc.rCode : ""})}`;

  const v = await evalNamedVector(rCode);
  if (v.flat != null) return { error: NO_SCATTER };
  const effect = (label: string, k: string) => [
    { label: `${label} F`, value: v[`${k}S`] ?? null },
    { label: `${label} DFn`, value: v[`${k}Df`] ?? null },
    ...(corrected && k !== "g" ? [{ label: `${label} DFd`, value: v[`${k}DfResid`] ?? null }] : []),
    pRow(`${label} P value`, v[`${k}P`] ?? null),
  ];
  const stats = [
    ...effect("Group", "g"),
    ...effect("Row", "r"),
    ...effect("Interaction", "i"),
    ...(corrected ? [{ label: "Geisser-Greenhouse epsilon", value: v.eps ?? null }] : []),
  ];
  const { groups } = await describe(
    [...new Set(group)].map((name) => ({ name, values: values.filter((_, i) => group[i] === name) })),
  );
  // Groups (between-subjects) comparisons use the "Error: id" stratum's residual;
  // rows (within-subject) comparisons use the "Error: id:r" stratum's — an
  // approximation of Prism's exact RM multiple-comparisons SE, using each effect's
  // own pooled error term.
  const mse = params.posthocTarget === "groups" ? v.gMse : v.rMse;
  const dfResid = params.posthocTarget === "groups" ? v.gDfResid : v.rDfResid;
  const comparisons = posthoc
    ? posthoc.labels.map(([group1, group2], k): ComparisonRow => ({
        group1,
        group2,
        cells: posthoc.cells[k],
        diff: v[`d_${k}`] ?? null,
        low: v[`lo_${k}`] ?? null,
        high: v[`hi_${k}`] ?? null,
        p: v[`p_${k}`] ?? null,
      }))
    : params.posthoc !== "none"
      ? ((await runPosthoc(
          // The subjects the ANOVA kept: comparisons are of the same means.
          completeSubjects(columns).subjects,
          params.posthoc,
          params.posthocTarget,
          mse ?? null,
          dfResid ?? null,
          titles,
        )) as ComparisonRow[] | undefined) // neither Dunnett nor Games-Howell: no error
      : undefined;
  return {
    testType: "two-way-anova",
    subtitle: "Repeated-measures two-way ANOVA",
    stats,
    groups,
    notes:
      "Matched by row: each replicate column is treated as the same subject across every row within its group. " +
      (corrected
        ? "Sphericity not assumed: the Geisser-Greenhouse epsilon corrects the degrees of freedom of the row and " +
          "interaction effects" +
          (posthoc
            ? ", and each comparison has its own error (rows within a group: a paired t test; groups within a row: " +
              "that row's pooled SD)."
            : ".")
        : "Assumes sphericity (no Geisser-Greenhouse correction).") +
      (v.gflat === 1
        ? " Each group's subjects have the same mean over the rows: the groups' effect has no scatter to be tested on."
        : "") +
      (posthoc && params.posthocTarget === "rows"
        ? groupNames
            .filter((g) => subjectsOf(g) < 2)
            .map((g) => ` “${g}” has one subject: its rows can't be compared.`)
            .join("")
        : "") +
      (dropped > 0
        ? ` ${dropped} replicate column${dropped === 1 ? "" : "s"} excluded (missing a value in at least one row).`
        : ""),
    comparisons,
    comparisonsLabel: comparisons?.length
      ? `${posthocOf(params)} ` +
        (params.posthocTarget === "groups"
          ? "(groups within each row, each row a family)"
          : "(rows within each group, each group a family)")
      : undefined,
  };
}

export async function runTwoWayAnova(
  columns: Column[],
  params: TwoWayAnovaParams,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  // One value per cell (a group at a row): the interaction can't be told from scatter, so
  // only the ordinary ANOVA runs, without it (as Prism does).
  const replicated = [...groupRows(columns).values()].some((rows) => rows.some((cell) => cell.length > 1));
  if (!replicated && params.design !== "ordinary") {
    return { error: "With one value per cell (no replicates), only the ordinary two-way ANOVA can run." };
  }
  if (params.design === "repeated-measures") {
    if (params.posthoc === "dunnett" || params.posthoc === "games-howell")
      return { error: `${posthocOf(params)} follows the ordinary two-way ANOVA, not the repeated-measures one.` };
    return runRepeatedMeasures(columns, params as TwoWayAnovaParams & { posthoc: Method | "none" }, titles);
  }

  const { values, group, row } = flattenGrouped(columns);
  if (new Set(group).size < 2 || new Set(row).size < 2) {
    return { error: "Two-way ANOVA needs at least 2 column groups and 2 rows of numeric data." };
  }
  // With the interaction, each group's mean at each row is a parameter: a group without a
  // value at a row leaves the effects undefined (Type III).
  const groupNames = [...new Set(group)];
  const rowKeys = [...new Set(row)];
  if (replicated) {
    for (const g of groupNames)
      for (const r of rowKeys)
        if (!values.some((_, i) => group[i] === g && row[i] === r))
          return {
            error:
              `“${g}” has no value at row “${rowName(titles, Number(r.slice(1)) - 1)}”: two-way ANOVA needs ` +
              "each group to hold a value in each row.",
          };
  }
  const parameters = replicated ? groupNames.length * rowKeys.length : groupNames.length + rowKeys.length - 1;
  if (values.length <= parameters) {
    return {
      error: `Two-way ANOVA needs more values than its ${parameters} means and effects: the table holds ${values.length}.`,
    };
  }
  if (identical(values)) return { error: NOTHING_VARIES };
  const nonparametric = params.design === "nonparametric";
  const setup = `v<-${rVec(values)};g<-${rFactor(group)};r<-${rFactor(row)}`;
  const rCode = nonparametric
    ? // Each effect's Type III sum of squares on the ranks (as the ordinary ANOVA's, so an
      // unbalanced design gives the same H whatever the factors' order), over the ranks'
      // total mean square.
      `${setup};${R_TWO_WAY};k<-rank(v);s<-tw(k,g,r,TRUE);h<-s[1:3]/var(k);d<-c(nlevels(g)-1,nlevels(r)-1);d[3]<-d[1]*d[2];` +
      `c(gS=h[[1]],gDf=d[1],gP=pchisq(h[[1]],d[1],lower.tail=FALSE),` +
      `rS=h[[2]],rDf=d[2],rP=pchisq(h[[2]],d[2],lower.tail=FALSE),` +
      `iS=h[[3]],iDf=d[3],iP=pchisq(h[[3]],d[3],lower.tail=FALSE))`
    : // Type III sums of squares (Prism's on unbalanced designs; on balanced ones Type
      // I = II = III), each effect's F on the residual mean square.
      `${setup};${R_TWO_WAY};s<-tw(v,g,r,${replicated ? "TRUE" : "FALSE"});` +
      `if(is.na(s[["e"]]))c(apart=1) else if(${R_FLAT('s[["e"]]')})c(flat=1) else{` +
      `dfr<-s[["dfe"]];mse<-s[["e"]]/dfr;d<-c(nlevels(g)-1,nlevels(r)-1);d[3]<-d[1]*d[2];` +
      `f<-s[c("g","r"${replicated ? ',"i"' : ""})]/d[1:${replicated ? 3 : 2}]/mse;p<-pf(f,d[seq_along(f)],dfr,lower.tail=FALSE);` +
      `c(gS=f[[1]],gDf=d[1],gP=p[[1]],rS=f[[2]],rDf=d[2],rP=p[[2]],` +
      (replicated ? `iS=f[[3]],iDf=d[3],iP=p[[3]],` : "") +
      `dfResid=dfr,mse=mse)}`;

  const v = await evalNamedVector(rCode);
  if (v.flat != null) return { error: NO_SCATTER };
  if (v.apart != null)
    return {
      error:
        "The groups and rows don't share enough cells to tell their effects apart: fill some cells where they meet.",
    };
  const stat = nonparametric ? "H" : "F";
  const effect = (label: string, s: string, df: string, p: string) => [
    { label: `${label} ${stat}`, value: v[s] ?? null },
    { label: `${label} DFn`, value: v[df] ?? null },
    pRow(`${label} P value`, v[p] ?? null),
  ];
  const stats = [
    ...effect("Group", "gS", "gDf", "gP"),
    ...effect("Row", "rS", "rDf", "rP"),
    ...(replicated ? effect("Interaction", "iS", "iDf", "iP") : []),
    ...(nonparametric ? [] : [{ label: "DFd (residual)", value: v.dfResid ?? null }]),
  ];
  const { groups } = await describe(
    [...new Set(group)].map((name) => ({ name, values: values.filter((_, i) => group[i] === name) })),
  );
  const posthoc =
    replicated && !nonparametric && params.posthoc !== "none"
      ? await runPosthoc(columns, params.posthoc, params.posthocTarget, v.mse, v.dfResid, titles, params.control)
      : undefined;
  if (posthoc && "error" in posthoc) return posthoc;
  const comparisons = posthoc;
  return {
    testType: "two-way-anova",
    subtitle: nonparametric ? "Scheirer-Ray-Hare test" : "Ordinary two-way ANOVA",
    stats,
    groups,
    notes: nonparametric
      ? "Non-parametric two-way analysis (rank-based); no normality assumption."
      : replicated
        ? "Compares group and row-position effects, plus their interaction; assumes normal distributions with equal variances (Type III sums of squares)."
        : "One value per cell (no replicates): the interaction can't be told apart from random scatter, so the model " +
          "assumes there is none and tests the group and row effects only; if there is an interaction, their P values " +
          "mean little. Comparisons within rows or groups need replicates. Assumes normal distributions with equal variances.",
    comparisons,
    comparisonsLabel: comparisons?.length
      ? `${posthocOf(params)} ` +
        (params.posthocTarget === "groups"
          ? "(groups within each row, each row a family)"
          : "(rows within each group, each group a family)")
      : undefined,
  };
}
