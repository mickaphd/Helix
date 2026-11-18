// The mixed-effects model of matched groups, for subjects that miss some values: each value
// is its group's mean plus its subject's own level (a random intercept, normal) plus an
// error, fitted by REML, so every value counts and none is left out with its subject. It
// assumes sphericity (compound symmetry). Its F test of the groups, and each comparison's,
// take Kenward and Roger's (1997) small-sample correction: the covariance of the means
// adjusted for the variance components being estimated, and the F's degrees of freedom and
// scale from it. With every subject complete, the same F, df and P as the repeated-measures
// ANOVA (sphericity assumed). All in base R, subject by subject (each subject's block of
// the covariance has a closed-form inverse), so a large table takes no N × N matrix.
import type { AnalysisOutcome, Column, ComparisonRow, RmAnovaParams, StatRow } from "../types";
import {
  comparedPairs,
  dataGroups,
  describe,
  identical,
  pairIndices,
  posthocOf,
  pRow,
  R_ADJUST,
  R_CRIT,
  R_PTUKEY,
  rVec,
} from "./base";
import { evalNamedVector } from "../webr";

/** R: `mx(y, g, s)`, the model of values `y` in groups `g` (1…k) of subjects `s`: its REML
 *  fit (`beta`, the groups' means; `s2`, `sb2`, the residual and subjects' variances), the
 *  means' covariance `Phi` and Kenward-Roger's `PhiA`, and `kr(L)`, the test of `L β = 0`:
 *  its scaled F and denominator df. Per subject i of n_i values, V_i⁻¹ = (I − c_i 11ᵀ) / σ²,
 *  c_i = γ / (1 + γ n_i), γ = σb² / σ², whose powers are (I − d 11ᵀ) / σ^2m, d = (1 − a_i^m) / n_i,
 *  a_i = 1 − c_i n_i: every product Kenward-Roger needs is a sum over subjects. γ is where the
 *  profiled REML likelihood's derivative (`sc`, exact) is 0, found to full precision (a
 *  maximum's place is found to √ε only); 0 when it falls from there. */
const R_MIXED = `mx<-function(y,g,s){k<-max(g);N<-length(y);X<-diag(k)[g,,drop=FALSE]
Sx<-rowsum(X,s);Sy<-as.vector(rowsum(y,s));n<-as.vector(rowsum(rep(1,N),s))
XtX<-crossprod(X);Xty<-as.vector(crossprod(X,y));yty<-sum(y^2)
fg<-function(gm){cc<-gm/(1+gm*n);A<-XtX-crossprod(Sx,cc*Sx);b<-Xty-as.vector(crossprod(Sx,cc*Sy));be<-solve(A,b)
list(A=A,be=be,rr=yty-sum(cc*Sy^2)-sum(b*be),ld=sum(log(1+gm*n)))}
sc<-function(gm){f<-fg(gm);dc<-1/(1+gm*n)^2;dA<--crossprod(Sx,dc*Sx);db<--as.vector(crossprod(Sx,dc*Sy))
drr<--sum(dc*Sy^2)-2*sum(db*f$be)+drop(f$be%*%dA%*%f$be);-(N-k)/2*drr/f$rr-sum(n/(1+gm*n))/2-sum(diag(solve(f$A,dA)))/2}
gm<-if(sc(0)<=0)0 else{U<-1;while(sc(U)>0&&U<1e12)U<-U*10;uniroot(sc,c(0,U),tol=1e-15,maxiter=2000)$root}
f<-fg(gm);s2<-f$rr/(N-k);sb2<-gm*s2;beta<-f$be;Phi<-s2*solve(f$A)
a<-1-n*gm/(1+gm*n);SS<-function(w)crossprod(Sx,w*Sx)
P<-list(SS(a^2)/s2^2,(XtX-SS((1-a^2)/n))/s2^2)
Q<-list(list(SS(n*a^3)/s2^3,SS(a^3)/s2^3),list(SS(a^3)/s2^3,(XtX-SS((1-a^3)/n))/s2^3))
Tr<-matrix(c(sum((n*a)^2),sum(n*a^2),sum(n*a^2),sum(n-1+a^2)),2)/s2^2
I<-matrix(0,2,2);for(i in 1:2)for(j in 1:2)I[i,j]<-(Tr[i,j]-2*sum(diag(Phi%*%Q[[i]][[j]]))+sum(diag(Phi%*%P[[i]]%*%Phi%*%P[[j]])))/2
W<-solve(I);Lam<-0;for(i in 1:2)for(j in 1:2)Lam<-Lam+W[i,j]*(Q[[i]][[j]]-P[[i]]%*%Phi%*%P[[j]])
PhiA<-Phi+2*Phi%*%Lam%*%Phi
kr<-function(L){L<-rbind(L);l<-nrow(L);b<-L%*%beta;Fv<-drop(t(b)%*%solve(L%*%PhiA%*%t(L),b))/l
Th<-t(L)%*%solve(L%*%Phi%*%t(L),L);M<-lapply(P,function(Pi)Th%*%Phi%*%Pi%*%Phi);A1<-0;A2<-0
for(i in 1:2)for(j in 1:2){A1<-A1+W[i,j]*sum(diag(M[[i]]))*sum(diag(M[[j]]));A2<-A2+W[i,j]*sum(diag(M[[i]]%*%M[[j]]))}
B<-(A1+6*A2)/(2*l);G<-((l+1)*A1-(l+4)*A2)/((l+2)*A2);D<-3*l+2*(1-G);c1<-G/D;c2<-(l-G)/D;c3<-(l+2-G)/D
E<-1/(1-A2/l);V<-2/l*(1+c1*B)/((1-c2*B)^2*(1-c3*B));rho<-V/(2*E^2);m<-4+(l+2)/(l*rho-1);lam<-m/(E*(m-2))
c(F=lam*Fv,df=m,lam=lam)}
list(beta=beta,s2=s2,sb2=sb2,Phi=Phi,PhiA=PhiA,kr=kr,k=k)}`;

type Method = "tukey" | "bonferroni" | "sidak" | "holm-sidak" | "fisher";

export async function runMixedModel(columns: Column[], params: RmAnovaParams | undefined): Promise<AnalysisOutcome> {
  const groups = dataGroups(columns);
  if (groups.length < 3) return { error: "This test needs at least 3 columns containing numeric data." };
  // Every value of the groups, its group and its subject (its table row).
  const rows = [...new Set(groups.flatMap((c) => c.rows))].sort((a, b) => a - b);
  const y: number[] = [];
  const g: number[] = [];
  const s: number[] = [];
  for (const r of rows)
    groups.forEach((c, j) => {
      if (c.byRow[r] != null) {
        y.push(c.byRow[r]!);
        g.push(j + 1);
        s.push(r + 1);
      }
    });
  const k = groups.length;
  const repeated = rows.filter((r) => groups.filter((c) => c.byRow[r] != null).length > 1).length;
  if (repeated === 0)
    return { error: "No subject holds values in two groups: there is nothing matched. Use one-way ANOVA." };
  if (y.length <= k + 1)
    return {
      error: `The mixed-effects model needs more values than its ${k + 1} means and variances: the table holds ${y.length}.`,
    };
  if (groups.every((c) => identical(c.values)))
    return { error: "Each group's values are identical: there is no scatter within the groups to compare them on." };

  const method: Method | "none" = params?.posthoc && params.posthoc !== "none" ? (params.posthoc as Method) : "none";
  const pairs: [number, number][] =
    method === "none" ? [] : method === "tukey" ? pairIndices(k) : comparedPairs(groups, params?.compared);
  // Each comparison: its difference of the model's means, its KR t and df, its P (Tukey's, or
  // the raw ones corrected together) and its 95% CI (the t at which its P is 0.05, scaled).
  const comparisons = pairs
    .map(([i, j], q) => {
      const l = `replace(numeric(${k}),c(${i + 1},${j + 1}),c(1,-1))`;
      return (
        `{l<-${l};z<-m$kr(l);d<-sum(l*m$beta);se<-sqrt(drop(l%*%m$PhiA%*%l)/z[["lam"]]);t<-d/se;` +
        `c(d_${q}=d,t_${q}=t,df_${q}=z[["df"]],se_${q}=se)}`
      );
    })
    .join(",");
  const v = await evalNamedVector(
    `${R_PTUKEY};${R_CRIT};${R_ADJUST};${R_MIXED}\n` +
      `tryCatch({m<-mx(${rVec(y)},${rVec(g)},${rVec(s)});o<-m$kr(cbind(-1,diag(${k - 1})));` +
      `x<-c(F=o[["F"]],dfn=${k - 1},dfd=o[["df"]],p=pf(o[["F"]],${k - 1},o[["df"]],lower.tail=FALSE),` +
      `sb=sqrt(m$sb2),se=sqrt(m$s2),setNames(m$beta,paste0("mean_",0:${k - 1}))${comparisons ? "," + comparisons : ""})\n` +
      (pairs.length
        ? // The P values and CIs of the comparisons, from their t and df.
          `T<-x[paste0("t_",0:${pairs.length - 1})];DF<-x[paste0("df_",0:${pairs.length - 1})];SE<-x[paste0("se_",0:${pairs.length - 1})];` +
          (method === "tukey"
            ? `ps<-mapply(function(t,df)ptk(abs(t)*sqrt(2),${k},df),T,DF);h<-mapply(function(df)crit(function(x)ptk(x*sqrt(2),${k},df)),DF)*SE`
            : `ps<-adj(2*pt(-abs(T),DF),"${method}");h<-${method === "holm-sidak" ? "NA*SE" : `mapply(function(df)crit(function(x)pa(x,df,"${method}",${pairs.length})),DF)*SE`}`) +
          `;D<-x[paste0("d_",0:${pairs.length - 1})];c(x,setNames(ps,paste0("p_",0:${pairs.length - 1})),setNames(D-h,paste0("lo_",0:${pairs.length - 1})),setNames(D+h,paste0("hi_",0:${pairs.length - 1})))`
        : "x") +
      "},error=function(e)c(F=NA))",
  );

  // Subjects' levels and groups' means that leave no scatter at all: nothing to test on.
  if (v.F == null || v.dfd == null)
    return {
      error:
        "Every subject's values differ from the others' by the same amounts: there is no scatter left to test the groups on.",
    };
  const { groups: described } = await describe(groups);
  const subjects = rows.length;
  const stats: StatRow[] = [
    { label: "F", value: v.F ?? null },
    { label: "DFn", value: v.dfn ?? null },
    { label: "DFd (Kenward-Roger)", value: v.dfd ?? null },
    pRow("P value", v.p ?? null),
    { label: "Subjects", value: rows.length },
    { label: "Missing values", value: rows.length * k - y.length },
    { label: "SD between subjects", value: v.sb ?? null },
    { label: "SD within subjects (residual)", value: v.se ?? null },
    ...groups.map((c, i) => ({ label: `Model mean (${c.name})`, value: v[`mean_${i}`] ?? null })),
  ];
  const comparisonRows: ComparisonRow[] = pairs.map(([i, j], q) => ({
    group1: groups[i].name,
    group2: groups[j].name,
    diff: v[`d_${q}`] ?? null,
    p: v[`p_${q}`] ?? null,
    ...(method === "holm-sidak" ? {} : { low: v[`lo_${q}`] ?? null, high: v[`hi_${q}`] ?? null }),
  }));
  const missing = subjects * k - y.length;
  return {
    testType: "rm-anova",
    subtitle: "Mixed-effects model (REML)",
    stats,
    groups: described,
    notes:
      `Compares means across matched groups with a mixed-effects model: each subject's own level is a random ` +
      `effect, fitted by REML, so every value counts (${y.length} values of ${subjects} subjects, ${missing} missing). ` +
      `Assumes normal distributions and sphericity. The F test and the comparisons take the Kenward-Roger ` +
      `degrees of freedom; the comparisons are of the model's means.`,
    ...(pairs.length ? { comparisons: comparisonRows, comparisonsLabel: posthocOf({ posthoc: method }) } : {}),
  };
}
