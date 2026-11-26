# Methods

How Helix computes each analysis, so a result can be reported, checked and reproduced.
Where a choice had to be made, Helix follows GraphPad Prism's, and this page says where
it doesn't.

## How results are computed and checked

- **R computes every result.** Helix runs R 4.6 inside the app (webR), and every number an
  analysis shows comes from R: its tests (`t.test`, `aov`, `survfit`…), and its means, SDs,
  medians, differences, corrections and counts too. Only graphs compute in TypeScript what
  they redraw at once (a regression line, a Kaplan-Meier curve, error bars, a volcano's
  tests), and transformed tables their values; each is checked against R (below).
- **One reading of a table.** Every analysis and graph reads the table the same way: a
  cell is a number or it is blank, and excluded cells are left out.
- **Checked at every change.** `npm test` runs every analysis on fixed tables and compares
  each number with a reference (`tests/reference.json`). Where TypeScript computes what R
  also computes, the test checks both agree. The survival analyses are checked against the
  published results of the Freireich leukemia trial.
- **Checked against independent references.** NIST's Statistical Reference Datasets, every
  one a Helix analysis can fit (`tests/nist/`, their certified values read from the files
  themselves): all 9 for the mean and SD, all 11 for one-way ANOVA, linear regression with
  and without the origin, polynomials up to degree 10 (Filip, which many programs fail),
  multiple regression (Longley) and the nonlinear models Helix has (Misra1d, Rat42; MGH17,
  whose curve isn't a decay's, is refused, never fitted wrong). Where NIST's values can't be
  held exactly by a computer, Helix gives the result of the values as stored, checked with
  exact arithmetic. Values far from 0 for their spread (1000000000000.4…) are centered before
  an ANOVA or a regression, so they lose no precision. Also published examples (Dunnett's tables, Grubbs' critical
  values, the space shuttle O-ring data, Freireich's leukemia trial, Lakens' effect sizes,
  Agresti's relative risk and chi-square, Hollander and Wolfe's Wilcoxon and Friedman
  tests), and textbook formulas computed apart from R (the log-rank test for trend).
- **What the data lack is said.** A test that can't run says why (too few values, no
  complete row, a count that isn't whole, values that don't vary, a predictor the others
  already give) instead of showing an empty result. Each analysis is run on its test
  tables cut short, flattened and emptied, and must say so in its own words.
- **Decimals as typed.** A computer holds 13.2 − 12.5 as 0.69999999999999929 and
  1.3 − 0.6 as 0.70000000000000007; ranked, these would differ. Paired differences, and
  differences to a hypothetical value, are taken as one when their sizes differ by less
  than 1e-13 of the values' scale (the 13th significant digit, beyond any measurement's),
  and as 0 within it of 0, before the signed-rank tests rank them: differences equal as
  typed are ties.
- **Every result opens with a report.** *Data analyzed*: the data sets it ran on, each
  with its count, how they were compared, and the table's others left out. *In plain
  words*: what it means, from its own numbers; a result that isn't significant never says
  the groups are alike, only that the data don't show a difference, with how large it
  could be (its 95% CI) when the test gives one. *Checks*: its conditions, computed by R
  (`shapiro.test` on each group, on paired differences or log ratios, or on a model's
  residuals; the F test of variances; Brown-Forsythe, an ANOVA of each value's distance
  to its group's median, and `bartlett.test`; a chi-square's expected counts; `cox.zph`).
  A check never stops a test: it says whether its condition holds and, when it may not,
  what doesn't assume it. A normality test says little with few values, and flags slight
  departures with many: the report says so.
- **P values** are two-tailed unless a one-tailed test was chosen, and shown to 4
  significant figures (`<0.0001` below that). A one-tailed test's 95% CI is open on one
  side (∞).
- **Multiple comparisons' 95% CIs** (Tukey, Bonferroni, Šidák, Fisher's LSD, Dunnett, Games-Howell, Dunnett's T3;
  one-way, repeated measures and two-way ANOVA) are adjusted as their P values are: each
  pair's difference ± the statistic at which its method's adjusted P is 0.05 (found by
  `uniroot`) times its standard error, so a CI leaves out 0 exactly when P < 0.05 (checked
  on every comparison of the tests; Tukey's against `TukeyHSD`, Bonferroni's against the
  textbook formula). Rank-based comparisons (Dunn) and Holm-Šidák, a step-down whose CIs
  aren't consistent with its P values, give none.
- **The studentized range** (Tukey, Games-Howell) is R's `ptukey` from 2 degrees of
  freedom; below (duplicates), its exact integral over the SD's distribution, which gives
  Tukey's tables at 1 df and the t distribution for two means.

## Column tables

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Descriptive statistics | `mean`, `sd`, `quantile`, `qt`… | SD and SEM use n − 1; the 95% CI of the mean is t-based; the 25th and 75th percentiles are `quantile` type 6, the (n + 1)p method (checked by hand); CV is SD ÷ mean; the geometric mean, exp of the mean of the logs, needs every value above 0. |
| Unpaired t test | `t.test(var.equal = TRUE)` | Also reports the F test of equal variances (`var.test`, the larger variance on top). Needs 2 values per group. Effect size: Cohen's d, the mean difference over the pooled SD, and Hedges' g, d with its exact small-sample correction. |
| Welch's t test | `t.test` | Welch-Satterthwaite degrees of freedom. Cohen's d and Hedges' g as for the unpaired t test (pooled SD). |
| Paired t test | `t.test(paired = TRUE)` | Rows holding both values only. Cohen's d is the mean difference over the SD of the differences; Hedges' g corrects it. |
| Ratio paired t test | `t.test` on log(A / B) | Values must be above 0. Reports the geometric mean ratio. |
| Lognormal t test, lognormal Welch's t test | `t.test` on log(A) and log(B) | Unpaired groups sampled from lognormal distributions. Values must be above 0. Reports each geometric mean and their ratio, with its 95% CI. |
| Mann-Whitney test | `wilcox.test` | Exact P without ties and under 50 values per group; with ties, the normal approximation with continuity correction. Reports the Hodges-Lehmann difference. |
| Wilcoxon matched-pairs test | `wilcox.test` on the differences | The differences as typed (see Decimals as typed). Pairs with no difference are left out, as R does. |
| One-sample t test, Wilcoxon signed-rank test | `t.test(mu =)`, `wilcox.test` on the differences to the value | One test per column; the Wilcoxon test on the differences as typed. The t test's Cohen's d is the distance to the hypothetical value over the SD; Hedges' g corrects it. |
| Lognormal one-sample t test | `t.test` of log(values), `mu =` log(value) | The geometric mean against a value above 0, with its 95% CI (exponentiated). |
| One-way ANOVA | `aov` | Assumes equal SDs. R² is eta squared; Cohen's f is √(eta² / (1 − eta²)). |
| Lognormal one-way ANOVA (or Welch's) | the same, on the logarithms | Values must be above 0. The ANOVA and its comparisons (any of those below) run on the logarithms; each group's geometric mean is reported, and each comparison is a ratio of geometric means with its CI, both exponentiated. Checked to be the ANOVA of a ln-transformed table. |
| Welch's ANOVA | `oneway.test` | Doesn't assume equal SDs. Needs 2 values per group, not all identical. |
| — Tukey | `TukeyHSD` | Every pair; Tukey-Kramer when group sizes differ. |
| — Bonferroni, Šidák, Holm-Šidák, Fisher's LSD | written in R (`pt`, `p.adjust`) | Every pair, or only the pairs chosen (the correction then counts those alone), on the pooled SD. Šidák 1 − (1 − p)^m, Holm-Šidák the same step-down over the ordered P values, Fisher's LSD uncorrected. Checked against `pairwise.t.test` and these formulas. |
| — Dunnett | written in R | Each group against a control, on the ANOVA's residual mean square. Single-step and exact: the distribution of the largest of the correlated t statistics (Dunnett, 1955) is integrated numerically on fixed Gauss-Legendre and Gauss-Hermite nodes (to 1e-10), not simulated. Checked against Dunnett's published critical values. |
| — Games-Howell | written in R (`ptukey`) | After Welch's ANOVA, every pair: each pair's Welch t and degrees of freedom, against the studentized range. |
| — Dunnett's T3 | written in R | After Welch's ANOVA, every pair: each pair's Welch t against the largest of as many independent t statistics as there are pairs (the studentized maximum modulus), integrated numerically, each pair's df rounded to the nearest whole number (Dunnett's tables were for whole df; Helix 1.1.0). Advised for fewer than 50 values per group. |
| Kruskal-Wallis test | `kruskal.test` | |
| — Dunn | written in R | Mean ranks, corrected for ties, Bonferroni over every pair. |
| Repeated-measures one-way ANOVA | `aov(value ~ group + subject)`'s table, from the subjects × groups means | Complete rows only. Computed from the matrix of values, the same numbers as `aov` (checked) at any number of subjects. Sphericity not assumed (the default): the Geisser-Greenhouse epsilon, from the groups' covariance, corrects both degrees of freedom (checked against R's `anova.mlm`); Tukey, Bonferroni, Šidák, Holm-Šidák or Fisher's LSD then compare each pair (or each pair chosen) on its own differences, a paired t test with n − 1 df (Maxwell and Delaney). Sphericity assumed (analyses made before Helix 1.0.7): no correction, and the comparisons use the ANOVA's residual mean square. |
| Mixed-effects model (matched groups, values missing) | written in R (REML, Kenward-Roger) | Each value is its group's mean plus its subject's own level (a random intercept) plus an error; fitted by REML, so every value counts and no subject is left out. Assumes normality and sphericity (compound symmetry). The groups' F test and each comparison take Kenward and Roger's (1997) correction: the means' covariance adjusted for the estimated variances, the F scaled and its denominator df from it. Computed subject by subject (closed forms), the REML variance ratio where its exact derivative is 0. Checked: on complete subjects, exactly the repeated-measures ANOVA's F, df, P and Tukey comparisons; with values missing, a dense REML fit (`optim`) and Kenward-Roger written out from the paper. |
| Friedman test | `friedman.test` | Complete rows only (rows lacking a value are left out and counted). Dunn on within-row ranks, Bonferroni. |
| Normality and lognormality test | `shapiro.test` | Shapiro-Wilk on each data set's values, and on their logarithms when all are above 0. Its own analysis, and offered inside each "Gaussian?" question. Needs 3 to 5000 values that aren't all identical; a column outside that is not tested, and said. Its conclusion takes P > 0.05 as consistent with the distribution. |
| Identify outliers (ROUT) | written in R (`lm`, `quantile`, `pt`) | See below. |
| Identify outliers (Grubbs) | written in R (`pt`) | In each column, G is the distance of the farthest value to the mean, in SDs; its two-sided P is n times that of the matching t with n − 2 df, an outlier under 0.05. One outlier at most per column; needs 3 values that aren't all identical. Checked against Grubbs' published critical values. |

**ROUT.** Motulsky and Brown's method (2006), as for a curve (see XY tables), the curve
being a constant: each column's robust mean, its scatter taken as Lorentzian, then among
the 30% of values farthest from it, those too far for a false discovery rate of Q. It needs
3 values that aren't all identical. Before Helix 1.1.0, a simplified version (a Huber mean,
its MAD, P values adjusted by Benjamini-Hochberg) could flag other points on some data.

## XY tables

X is the first data column. X and a Y pair on the rows where both hold a number.

A linear or nonlinear regression may fit several Y data sets (Helix 1.0.9 and later): each
on its own, as it would alone (checked), their best-fit values side by side, and a scatter
draws each one's line or curve in its color.

A Y data set may hold replicates (Helix 1.0.9 and later): each replicate is a point of the
correlation with X and of the regressions (checked against `lm` on them all); the area under the curve joins each X's mean, and an unknown to
interpolate is its replicates' mean, both computed by R. Correlating two Y data sets
pairs one value per row, so it isn't offered with replicates. A graph draws each
replicate, or each X's mean or median with its SD, SEM or 95% CI.

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Correlation | `cor.test` | Pearson or Spearman, at least 3 pairs. r's 95% CI: Pearson's `cor.test`'s (Fisher's z); Spearman's on Fisher's z with Fieller, Hartley and Pearson's variance 1.06 / (n − 3); none under 4 pairs or for a perfect r. Pearson's R² is r². |
| Linear regression | `lm`, `cor` | Of an XY table's Y on its X, or of one variable of a Multiple Variables table on another, on the rows holding both. X is centered before the fit (the same line, more precise when X is far from 0 for its spread, as dates in seconds are), the intercept then taken back to X = 0 with its exact standard error; 95% CIs on the t distribution. X values all identical, or a Y that doesn't change, are refused. Pearson's r is `cor`'s; none is given for a line through the origin, which it says nothing of. Through the origin, R² is R's uncentered one. The line, the band and r drawn on a graph are computed in TypeScript and checked against R. |
| Area under the curve | written in R | Trapezoids from a baseline; area under the baseline is negative. |
| Nonlinear regression | `lm` (line, semilog, polynomials), `nls` (dose-response, hyperbola, exponential, logistic and Gompertz growth, one- and two-phase decay, Michaelis-Menten) | Least squares, no weighting. Curves in log or ratio of X fit the points with X > 0. Dose-response: 4PL; 3PL with a standard slope (Hill slope 1 for an agonist, −1 for an inhibitor, as chosen); 5PL, the asymmetric sigmoid, whose asymmetry S is 1 for the 4PL and whose fit starts from the 4PL's. A 4PL starts from a slope of the curve's own sign, so Bottom stays under Top and a falling curve has a negative Hill slope. Each parameter's 95% CI is asymptotic (estimate ± t × SE); an EC50's is 10 to its LogEC50's, so asymmetric; the asymmetry S's is taken on its log, so it stays above 0; Span's takes Top's and Bottom's covariance. Exponential growth, Y = Y0·e^(KX), reports the doubling time ln 2 / K and tau 1 / K; one-phase decay, Y = (Y0 − Plateau)·e^(−KX) + Plateau, the half-life ln 2 / K, tau and the span; each one's CI is taken from K's (none when K's includes 0). Logistic growth, Y = YM·Y0 / ((YM − Y0)·e^(−KX) + Y0), reports the early doubling time ln 2 / K (its fit starts from the logit's line); Gompertz growth is Y = YM·(Y0 / YM)^(e^(−KX)) (its fit starts from log(−log(Y / YM))'s line); two-phase decay, Y = Plateau + (Y0 − Plateau)·(PercentFast % ·e^(−KFast·X) + the rest·e^(−KSlow·X)), each phase's half-life (its fit starts from the one-phase decay's, its K tripled and divided by 3). A dose-response curve can also report an ECF (EC10, EC20, EC80, EC90; an inhibitor's IC), where it has come F % of the way from Bottom to Top, from its log midpoint, Hill slope and asymmetry; its 95% CI by the delta method on the fit's covariance, what refitting with log ECF as a parameter gives (checked). Michaelis-Menten is Y = Vmax·X / (Km + X). R² is 1 − SS residual / SS total. The curve on a graph is checked to draw R's fit, for every model. |
| Outliers of a curve (ROUT) | the fit above, reweighted; `pt` | Motulsky & Brown's ROUT (2006): a robust fit minimizing the sum of ln(1 + (residual / RSDR)²), residuals taken as Lorentzian, its RSDR (the 68.27th percentile of the absolute residuals, interpolated linearly, times N / (N − K)) recomputed at each step, as reweighted least squares (weights 1 / (1 + (residual / RSDR)²)); then, the points ranked by their distance to it, from the 70th percentile on, the first whose P (t = residual / RSDR, N − K df, two-sided) is under Q(N − (i − 1)) / N is an outlier, and every point farther. Q = 1%. The outliers are left out and the curve fitted again by least squares. Checked: the robust fit is at its merit's minimum (`optim` finds no lower), a point far off a curve is found, and none in the same data without it. Not offered when two curves are compared. |
| Simple logistic regression | `glm` (binomial), `confint`, `pchisq` | Y holds 0s and 1s (at least two of each); P(Y = 1) = 1 / (1 + e^−(B0 + B1·X)) by maximum likelihood. Coefficients with Wald z and P, profile-likelihood 95% CIs; the odds ratio e^B1 with its CI; the X at 50% probability, −B0 / B1; the likelihood-ratio test of the model; Tjur's R² (the mean fitted probability of the 1s minus that of the 0s). Data an X splits exactly (separation) are refused: the slope can't be estimated. Checked on the space shuttle O-ring data (Dalal et al., 1989): 15.043 − 0.232 × temperature. The S curve on a graph is checked to draw R's probability. |
| Interpolating a standard curve | the fit above, then `uniroot` | The unknowns are the rows holding a Y but no X. Each one's X is where the fitted curve reaches its Y: the lowest such X within the standards' X, else below them, else above them (as far again as their width; for a curve of X > 0, down to a tenth of the lowest X and up to ten times the highest). An X beyond the standards is marked extrapolated; a Y the curve never reaches gets none. When X is a log, the concentration (10^X) is given too. No confidence interval. Checked by putting each X back in the curve. |
| Comparing two dose-response curves | `nls`, then the extra sum-of-squares F test | Each data set fitted on its own, against the midpoint (EC50 or IC50) shared (its fit started between the two midpoints, and at each one, keeping the best), or one curve for both: F = ((SS shared − SS own) / (df shared − df own)) / (SS own / df own). Checked by hand from separate fits. |

## Grouped tables

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Two-way ANOVA | sums of squares from the cells' counts and means | Type III sums of squares: each main effect tests its unweighted means, the interaction what the additive model leaves of the cell means; without the interaction, the additive model's. The same numbers as `aov` and `drop1` on sum contrasts (checked on random unbalanced designs, and against a Wald test), computed without a model matrix of one column per row, so thousands of rows take a second. With one value per cell (no replicates), the interaction can't be told from scatter: the model leaves it out and tests the group and row effects only, without comparisons, and only the ordinary ANOVA runs. With replicates, each group needs a value in each row (an empty cell leaves Type III undefined). Data with no scatter left around the model are refused. |
| — repeated measures | the strata of `aov(value ~ group * row + Error(subject / row))`, from the subjects' means | The same numbers as `aov` (checked on unequal groups). Each sub-column is a subject measured at every row; a subject lacking a row is left out and counted. Sphericity not assumed (the default): the Geisser-Greenhouse epsilon, from the rows' covariance pooled over the groups, corrects the degrees of freedom of the row and interaction effects (checked against R's `anova.mlm`; a group left with one subject adds nothing to it, and its rows aren't compared), and each comparison has its own error: rows within a group, a paired t test (n − 1 df); groups within a row, that row's pooled SD. Sphericity assumed (analyses made before Helix 1.0.7): no correction. |
| — Scheirer-Ray-Hare | the two-way ANOVA's sums of squares, on ranks | Each effect's Type III sum of squares of the ranks over their total mean square, against chi-square: on an unbalanced design, the same whatever the factors' order (Helix 1.1.0; before, Type I, which depended on it). Checked against a Wald test on the ranks. |
| — Tukey, Bonferroni, Šidák, Holm-Šidák, Fisher's LSD | written in R (`ptukey`, `pt`) | On the ANOVA's residual mean square (repeated measures without sphericity: see above). Each row is a family when groups are compared within a row, each group when rows are compared within a group: the correction is over one family. With repeated measures, each effect's own error term. |
| — Dunnett, Games-Howell (ordinary design) | written in R | Dunnett: each member of a family against its control (a group within each row, or a row within each group), on the ANOVA's residual mean square, the distribution of the largest t (as the one-way ANOVA's) with the family's own weights. Games-Howell: every pair on the two cells' own variances, Welch's t and df against the studentized range, each cell needing 2 values or more. Checked: Dunnett's P between the uncorrected and Bonferroni's; Games-Howell within a row the one-way ANOVA's of its cells. |
| Multiple t tests | `t.test`, `wilcox.test`, `p.adjust` | One test per row, Welch's unless one SD is pooled across rows. Holm, Benjamini-Hochberg or none across the rows. |

## Multiple Variables tables

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Correlation matrix | `cor.test` | Each pair on the rows where both hold a number. |
| Multiple regression | `lm` | Complete rows only. The predictors are centered before the fit (the same model, more precise), the intercept taken back to 0 with its exact standard error. A predictor that is constant, or a combination of the others, is named and refused. |
| Descriptive statistics, ROUT | as on Column tables | One variable per column. |

## Contingency tables

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Fisher's exact test (2 × 2, the default) | `fisher.test` | The odds ratio and its 95% CI are the test's conditional estimate, close to but not a·d / b·c. The relative risk is the first column's share in the first row over its share in the second; its 95% CI is taken on the log (Katz). Phi is (a·d − b·c) / √(product of the row and column totals), signed. The chi-square shown for reference has Yates' correction. Up to 10,000,000 subjects in all. |
| Chi-square test (2 × 2), with or without Yates' correction | `chisq.test` | The same measures as Fisher's. |
| — every 2 × 2 | written in R | The difference of the two risks (first row's share of the first column minus the second's) with Newcombe's 95% CI (his method 10: Wilson's intervals of each risk combined), and the number needed to treat, one over it (its CI the inverse of the difference's, which runs through infinity when that one includes 0). Read as a diagnostic test (rows: positive, negative; columns: condition present, absent), its sensitivity, specificity and positive and negative predictive values, each with Wilson's score 95% CI. Checked against Newcombe's published examples. |
| Chi-square test (larger tables) | `chisq.test` | Warns when an expected count is under 5. Cramér's V is √(chi-square / (N × (the smaller of rows and columns − 1))). |
| Chi-square test for trend (2 columns, 3 rows or more) | `prop.trend.test` | Cochran-Armitage's: whether the first column's share rises or falls down the rows, scored 1, 2, 3… in their order (df 1). Checked against Agresti's published example and the formula written out. |

Counts must be whole numbers; rows lacking a count are left out.

## Survival tables

One subject per row: its time, then 1 (event) or 0 (censored) in its group's column.
Computed with R's survival package.

| Analysis | Computed with | Choices |
| --- | --- | --- |
| Kaplan-Meier, median survival | `survfit` | 95% CIs on the log-log scale. The curve on a graph, and the number at risk under it (the subjects whose time is that tick or later), are computed in TypeScript and checked against `survfit` (`summary(…, times)`). |
| Log-rank (Mantel-Cox) test | `survdiff` | |
| Log-rank test for trend | from `survdiff`'s observed − expected | Groups in table order, equally spaced. |
| Gehan-Breslow-Wilcoxon test | written in R | Each event time weighted by the number at risk. |
| Hazard ratio (two groups) | from `survdiff` | Mantel-Haenszel and log-rank estimates, each with its 95% CI. |
| Pairwise comparisons (3 groups or more) | the same test on each pair | Holm, Benjamini-Hochberg or none. |
| Cox proportional hazards regression | `coxph`, `cox.zph` | Efron's method for ties, Wald 95% CIs, likelihood ratio, Wald and score tests, concordance, and the proportional hazards test. A model that didn't converge says so; a group without any event is refused (no ratio to a hazard of 0). |

## Transformed tables

Transform or Normalize makes a table computed from another, in TypeScript so it follows
each change at once; the tests check every value against R's. An XY table's X is never
transformed; an excluded value stays excluded and counts in no mean, SD, smallest or
largest. Values are kept to 10 significant digits.

| Transform | Computed as | Choices |
| --- | --- | --- |
| Logarithm | `log10`, `log2`, `log` | A value at or under 0 has none: its cell is blank. |
| Normalize | (value − smallest) / (largest − smallest) × 100 | Each data set (a grouped table's group, its replicates together) on its own. A data set whose values are all alike is blank. |
| Percent of control | value / mean of the control × 100 | Column and Multiple Variables tables: the control's mean. Grouped and XY tables: the control's mean in the same row. |
| Z-scores | (value − mean) / SD, as `scale()` (n − 1) | Within each data set, or within each row (genes on a heatmap). Fewer than 2 values, or an SD of 0: blank. |

## Graphs that compute

Graphs compute what they redraw at once in TypeScript; the tests check each against R.

- **Volcano plot of a grouped table**: per row, the difference of means or the log2 ratio,
  Welch's t test, then the Benjamini-Hochberg FDR across rows (checked against Multiple t
  tests).
- **Error bars**: SD or SEM (n − 1), or the 95% CI of the mean (t × SEM, n − 1 df,
  checked against R's `t.test`), around the mean or the median.
- **Box**: the quartiles of Descriptive statistics (R's type 6), whiskers to the minimum and
  maximum, or Tukey's: to the furthest values within 1.5 × IQR of the quartiles, the values
  beyond drawn one by one. Computed by Helix and only drawn by Plotly (checked against R's
  `quantile` and the same whiskers worked out in R, on values beyond 1.5 and 2 IQR; before
  Helix 1.1.0, Plotly's own quartiles, which could differ slightly).
- **Regression band**: the line's 95% confidence band (where the line lies) or prediction
  band (where a new point would: its own scatter added), checked against R's
  `predict(interval=)`, through the origin too.
- **QQ plot** (Column and Multiple Variables tables) and **residual plot** (XY tables:
  each point's distance to its data set's straight line, against X or as a QQ plot): the
  normal quantiles are R's `qnorm(ppoints(n))` (Wichura's AS 241, as R's), the residuals
  `lm`'s, all checked; the dashed line is the normal of the data's own mean and SD.
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
