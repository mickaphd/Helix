# Methods

How Helix computes each analysis, so a result can be reported, checked and reproduced.
Where a choice had to be made, Helix follows GraphPad Prism's, and this page says where
it doesn't.

## How results are computed and checked

- **R computes every result.** Helix runs R 4.6 inside the app (webR), and every number an
  analysis shows comes from R: its tests (`t.test`, `aov`, `survfit`…), and its means, SDs,
  medians, differences, corrections and counts too. Only graphs compute in TypeScript what
  they redraw at once (a regression line, a Kaplan-Meier curve, error bars, a volcano's
  tests); each is checked against R (below).
- **One reading of a table.** Every analysis and graph reads the table the same way: a
  cell is a number or it is blank, and excluded cells are left out.
- **Checked at every change.** `npm test` runs every analysis on fixed tables and compares
  each number with a reference (`tests/reference.json`). Where TypeScript computes what R
  also computes, the test checks both agree. The survival analyses are checked against the
  published results of the Freireich leukemia trial.
- **What the data lack is said.** A test that can't run says why (too few values, no
  complete row, a count that isn't whole) instead of showing an empty result.
- **P values** are two-tailed unless a one-tailed test was chosen, and shown to 4
  significant figures (`<0.0001` below that).

## Column tables

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Descriptive statistics | `mean`, `sd`, `quantile`, `qt`… | SD and SEM use n − 1; the 95% CI of the mean is t-based; the 25th and 75th percentiles are `quantile` type 6, the (n + 1)p method (checked by hand); CV is SD ÷ mean; the geometric mean, exp of the mean of the logs, needs every value above 0. |
| Unpaired t test | `t.test(var.equal = TRUE)` | Also reports the F test of equal variances (`var.test`). Needs 2 values per group. Effect size: Cohen's d, the mean difference over the pooled SD, and Hedges' g, d with its exact small-sample correction. |
| Welch's t test | `t.test` | Welch-Satterthwaite degrees of freedom. Cohen's d and Hedges' g as for the unpaired t test (pooled SD). |
| Paired t test | `t.test(paired = TRUE)` | Rows holding both values only. Cohen's d is the mean difference over the SD of the differences; Hedges' g corrects it. |
| Ratio paired t test | `t.test` on log(A / B) | Values must be above 0. Reports the geometric mean ratio. |
| Lognormal t test, lognormal Welch's t test | `t.test` on log(A) and log(B) | Unpaired groups sampled from lognormal distributions. Values must be above 0. Reports each geometric mean and their ratio, with its 95% CI. |
| Mann-Whitney test | `wilcox.test` | Exact P without ties and under 50 values per group; with ties, the normal approximation with continuity correction. Reports the Hodges-Lehmann difference. |
| Wilcoxon matched-pairs test | `wilcox.test(paired = TRUE)` | Pairs with no difference are left out, as R does. |
| One-sample t test, Wilcoxon signed-rank test | `t.test(mu =)`, `wilcox.test(mu =)` | One test per column. The t test's Cohen's d is the distance to the hypothetical value over the SD; Hedges' g corrects it. |
| One-way ANOVA | `aov` | Assumes equal SDs. R² is eta squared; Cohen's f is √(eta² / (1 − eta²)). |
| Welch's ANOVA | `oneway.test` | Doesn't assume equal SDs. Needs 2 values per group, not all identical. |
| — Tukey | `TukeyHSD` | Every pair; Tukey-Kramer when group sizes differ. |
| — Bonferroni | `pairwise.t.test` | Every pair, pooled SD. |
| — Dunnett | written in R | Each group against a control, on the ANOVA's residual mean square. Single-step and exact: the distribution of the largest of the correlated t statistics (Dunnett, 1955) is integrated numerically, not simulated. Checked against Dunnett's published critical values. |
| — Games-Howell | written in R (`ptukey`) | After Welch's ANOVA, every pair: each pair's Welch t and degrees of freedom, against the studentized range. |
| — Dunnett's T3 | written in R | After Welch's ANOVA, every pair: each pair's Welch t against the largest of as many independent t statistics as there are pairs (the studentized maximum modulus), integrated numerically. Advised for fewer than 50 values per group. |
| Kruskal-Wallis test | `kruskal.test` | |
| — Dunn | written in R | Mean ranks, corrected for ties, Bonferroni over every pair. |
| Repeated-measures one-way ANOVA | `aov(value ~ group + subject)` | Complete rows only. Sphericity not assumed (the default): the Geisser-Greenhouse epsilon, from the groups' covariance, corrects both degrees of freedom (checked against R's `anova.mlm`); Tukey or Bonferroni then compare each pair on its own differences, a paired t test with n − 1 df (Maxwell and Delaney). Sphericity assumed (analyses made before Helix 1.0.7): no correction, and the comparisons use the ANOVA's residual mean square. |
| Friedman test | `friedman.test` | Complete rows only (rows lacking a value are left out and counted). Dunn on within-row ranks, Bonferroni. |
| Normality and lognormality test | `shapiro.test` | Shapiro-Wilk on each data set's values, and on their logarithms when all are above 0. Its own analysis, and offered inside each "Gaussian?" question. Needs 3 to 5000 values that aren't all identical; a column outside that is not tested, and said. Its conclusion takes P > 0.05 as consistent with the distribution. |
| Identify outliers (ROUT) | written in R (`mad`, `pt`, `p.adjust`) | See below. |
| Identify outliers (Grubbs) | written in R (`pt`) | In each column, G is the distance of the farthest value to the mean, in SDs; its two-sided P is n times that of the matching t with n − 2 df, an outlier under 0.05. One outlier at most per column; needs 3 values that aren't all identical. Checked against Grubbs' published critical values. |

**ROUT.** Helix follows the logic of Motulsky and Brown (2006): each column is fitted
robustly, each residual becomes a t statistic, and a point is an outlier when its
false-discovery-rate-adjusted P is below Q. The robust fit is a Huber mean with the scale
taken from the median absolute deviation. It is not GraphPad's implementation, and on
borderline points the two can disagree.

## XY tables

X is the first data column. X and a Y pair on the rows where both hold a number.

A linear or nonlinear regression may fit several Y data sets (Helix 1.0.9 and later): each
on its own, as it would alone (checked), their best-fit values side by side, and a scatter
draws each one's line or curve in its color.

A Y data set may hold replicates (Helix 1.0.9 and later): each replicate is a point of the
correlation with X and of the regressions (checked against `lm` on them all), as Prism
does by default; the area under the curve joins each X's mean, and an unknown to
interpolate is its replicates' mean, both computed by R. Correlating two Y data sets
pairs one value per row, so it isn't offered with replicates. A graph draws each
replicate, or each X's mean or median with its SD, SEM or 95% CI.

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Correlation | `cor.test` | Pearson or Spearman, at least 3 pairs. |
| Linear regression | `lm`, `cor` | Of an XY table's Y on its X, or of one variable of a Multiple Variables table on another, on the rows holding both. 95% CIs with `confint`. Pearson's r is `cor`'s; none is given for a line through the origin, which it says nothing of. Through the origin, R² is R's uncentered one. The line, the band and r drawn on a graph are computed in TypeScript and checked against R. |
| Area under the curve | written in R | Trapezoids from a baseline; area under the baseline is negative. |
| Nonlinear regression | `lm` (line, semilog, polynomials), `nls` (dose-response, hyperbola, exponential growth, one-phase decay, Michaelis-Menten) | Least squares, no weighting. Curves in log or ratio of X fit the points with X > 0. Dose-response: 4PL; 3PL with a standard slope (Hill slope 1 for an agonist, −1 for an inhibitor, as chosen); 5PL, Prism's asymmetric sigmoid, whose asymmetry S is 1 for the 4PL and whose fit starts from the 4PL's. A 4PL starts from a slope of the curve's own sign, so Bottom stays under Top and a falling curve has a negative Hill slope. Each parameter's 95% CI is asymptotic (estimate ± t × SE, as Prism's default); an EC50's is 10 to its LogEC50's, so asymmetric; the asymmetry S's is taken on its log, so it stays above 0; Span's takes Top's and Bottom's covariance. Exponential growth, Y = Y0·e^(KX), reports the doubling time ln 2 / K and tau 1 / K; one-phase decay, Y = (Y0 − Plateau)·e^(−KX) + Plateau, the half-life ln 2 / K, tau and the span; each one's CI is taken from K's (none when K's includes 0). Michaelis-Menten is Y = Vmax·X / (Km + X). R² is 1 − SS residual / SS total. The curve on a graph is checked to draw R's fit, for every model. |
| Outliers of a curve (ROUT) | the fit above, reweighted; `pt` | Motulsky & Brown's ROUT (2006): a robust fit minimizing the sum of ln(1 + (residual / RSDR)²), residuals taken as Lorentzian, its RSDR (the 68.27th percentile of the absolute residuals × N / (N − K)) recomputed at each step, as reweighted least squares (weights 1 / (1 + (residual / RSDR)²)); then, the points ranked by their distance to it, from the 70th percentile on, the first whose P (t = residual / RSDR, N − K df, two-sided) is under Q(N − (i − 1)) / N is an outlier, and every point farther. Q = 1%. The outliers are left out and the curve fitted again by least squares. Checked: the robust fit is at its merit's minimum (`optim` finds no lower), a point far off a curve is found, and none in the same data without it. Not offered when two curves are compared. |
| Simple logistic regression | `glm` (binomial), `confint`, `pchisq` | Y holds 0s and 1s (at least two of each); P(Y = 1) = 1 / (1 + e^−(B0 + B1·X)) by maximum likelihood. Coefficients with Wald z and P, profile-likelihood 95% CIs; the odds ratio e^B1 with its CI; the X at 50% probability, −B0 / B1; the likelihood-ratio test of the model; Tjur's R² (the mean fitted probability of the 1s minus that of the 0s). Data an X splits exactly (separation) are refused: the slope can't be estimated. Checked on the space shuttle O-ring data (Dalal et al., 1989): 15.043 − 0.232 × temperature. The S curve on a graph is checked to draw R's probability. |
| Interpolating a standard curve | the fit above, then `uniroot` | The unknowns are the rows holding a Y but no X. Each one's X is where the fitted curve reaches its Y: the lowest such X within the standards' X, else below them, else above them (as far again as their width; for a curve of X > 0, down to a tenth of the lowest X and up to ten times the highest). An X beyond the standards is marked extrapolated; a Y the curve never reaches gets none. When X is a log, the concentration (10^X) is given too. No confidence interval. Checked by putting each X back in the curve. |
| Comparing two dose-response curves | `nls`, then the extra sum-of-squares F test | Each data set fitted on its own, against the midpoint (EC50 or IC50) shared (its fit started between the two midpoints, and at each one, keeping the best), or one curve for both: F = ((SS shared − SS own) / (df shared − df own)) / (SS own / df own). Checked by hand from separate fits. |

## Grouped tables

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Two-way ANOVA | `aov`, `drop1` | Type III sums of squares. With one value per cell (no replicates), the interaction can't be told from scatter: the model leaves it out and tests the group and row effects only, without comparisons, and only the ordinary ANOVA runs. |
| — repeated measures | `aov(value ~ group * row + Error(subject / row))` | Each sub-column is a subject measured at every row; a subject lacking a row is left out and counted. Sphericity not assumed (the default): the Geisser-Greenhouse epsilon, from the rows' covariance pooled over the groups, corrects the degrees of freedom of the row and interaction effects (checked against R's `anova.mlm`), and each comparison has its own error: rows within a group, a paired t test (n − 1 df); groups within a row, that row's pooled SD. Sphericity assumed (analyses made before Helix 1.0.7): no correction. |
| — Scheirer-Ray-Hare | `aov` on ranks | Each effect's sum of squares over the total mean square, against chi-square. |
| — Tukey, Bonferroni | written in R (`ptukey`, `pt`) | On the ANOVA's residual mean square (repeated measures without sphericity: see above). Each row is a family when groups are compared within a row, each group when rows are compared within a group: the correction is over one family. With repeated measures, each effect's own error term. |
| Multiple t tests | `t.test`, `wilcox.test`, `p.adjust` | One test per row, Welch's unless one SD is pooled across rows. Holm, Benjamini-Hochberg or none across the rows. |

## Multiple Variables tables

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Correlation matrix | `cor.test` | Each pair on the rows where both hold a number. |
| Multiple regression | `lm` | Complete rows only. |
| Descriptive statistics, ROUT | as on Column tables | One variable per column. |

## Contingency tables

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Fisher's exact test (2 × 2) | `fisher.test` | The odds ratio and its 95% CI are the test's conditional estimate, close to but not a·d / b·c. The relative risk is the first column's share in the first row over its share in the second; its 95% CI is taken on the log (Katz). Phi is (a·d − b·c) / √(product of the row and column totals), signed. The chi-square shown for reference has Yates' correction. |
| Chi-square test (larger tables) | `chisq.test` | Warns when an expected count is under 5. Cramér's V is √(chi-square / (N × (the smaller of rows and columns − 1))). |

Counts must be whole numbers; rows lacking a count are left out.

## Survival tables

One subject per row: its time, then 1 (event) or 0 (censored) in its group's column.
Computed with R's survival package.

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Kaplan-Meier, median survival | `survfit` | 95% CIs on the log-log scale. The curve on a graph is computed in TypeScript and checked against `survfit`. |
| Log-rank (Mantel-Cox) test | `survdiff` | |
| Log-rank test for trend | from `survdiff`'s observed − expected | Groups in table order, equally spaced. |
| Gehan-Breslow-Wilcoxon test | written in R | Each event time weighted by the number at risk. |
| Hazard ratio (two groups) | from `survdiff` | Mantel-Haenszel and log-rank estimates, each with its 95% CI. |
| Pairwise comparisons (3 groups or more) | the same test on each pair | Holm, Benjamini-Hochberg or none. |
| Cox proportional hazards regression | `coxph`, `cox.zph` | Efron's method for ties, Wald 95% CIs, likelihood ratio, Wald and score tests, concordance, and the proportional hazards test. A model that didn't converge says so. |

## Graphs that compute

Graphs compute what they redraw at once in TypeScript; the tests check each against R.

- **Volcano plot of a grouped table**: per row, the difference of means or the log2 ratio,
  Welch's t test, then the Benjamini-Hochberg FDR across rows (checked against Multiple t
  tests).
- **Error bars**: SD or SEM (n − 1), or the 95% CI of the mean (t × SEM, n − 1 df,
  checked against R's `t.test`), around the mean or the median.
- **Box**: quartiles, whiskers to the minimum and maximum.
- **Histogram**: R's `hist()`: its own bins (Sturges' number of classes, made pretty by
  `pretty()`, for all the data sets together) or every bin width typed from a multiple
  of it; a bin holds the values above its left edge up to its right one, the first one
  its left edge too (checked against `hist()`, values on the edges included).

## References

- Dunnett CW. A multiple comparison procedure for comparing several treatments with a
  control. *Journal of the American Statistical Association* 1955;50:1096-1121.
- Dunnett CW. Pairwise multiple comparisons in the unequal variance case. *Journal of the
  American Statistical Association* 1980;75:796-800.
- Games PA, Howell JF. Pairwise multiple comparison procedures with unequal n's and/or
  variances. *Journal of Educational Statistics* 1976;1:113-125.
- Greenhouse SW, Geisser S. On methods in the analysis of profile data. *Psychometrika*
  1959;24:95-112.
- Maxwell SE, Delaney HD. *Designing Experiments and Analyzing Data: A Model Comparison
  Perspective*, 2nd ed., pages 552-555.
- Motulsky HJ, Brown RE. Detecting outliers when fitting data with nonlinear regression.
  *BMC Bioinformatics* 2006;7:123.
- Freireich EJ et al. The effect of 6-mercaptopurine on the duration of steroid-induced
  remissions in acute leukemia. *Blood* 1963;21:699-716.
- Therneau TM. *A Package for Survival Analysis in R*.
- R Core Team. *R: A Language and Environment for Statistical Computing*.
