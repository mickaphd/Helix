// The questions each analysis asks before it runs, as Prism does: one question per
// step, each answer choosing the next question. A wizard only declares its questions
// and how the answers make the test's params; analysis-wizard.tsx asks them.
// A test without an entry here runs as soon as it is picked.
import type {
  AnalysisParams,
  AnalysisPickerValue,
  AnalysisType,
  CompareTwoGroupsParams,
  MultipleTTestsParams,
  NonlinearRegressionParams,
  OneSampleTParams,
  TwoWayAnovaParams,
  XYCorrelationParams,
} from "../../stats/types";
import { splitXY, type Dataset } from "../../lib/dataset";

export type Answer = string | number | string[];
export type Answers = Record<string, Answer | undefined>;

export type Question = { id: string; ask: string } & (
  | {
      kind: "choice";
      options: { value: string; label: string }[];
      /** Adds "Not sure — check for normality first", answered "yes" or "no" by Shapiro-Wilk. */
      normality?: boolean;
    }
  | { kind: "number"; label: string; initial: number; min?: number; max?: number; step?: number }
  /** Several of `options`, all ticked at first. */
  | { kind: "names"; options: string[] }
);

export interface Wizard {
  title: string;
  /** Every question, given the answers so far (false: not asked with these answers). */
  questions: (a: Answers, table: Dataset) => (Question | false)[];
  /** The test to create, once every question is answered. */
  finish: (a: Answers, table: Dataset) => { type: AnalysisType; params?: AnalysisParams };
}

const choice = (id: string, ask: string, options: [string, string][], normality = false): Question => ({
  id,
  ask,
  kind: "choice",
  options: options.map(([value, label]) => ({ value, label })),
  normality,
});

const names = (list: string[]) => list.map((n): [string, string] => [n, n]);
const yNames = (table: Dataset) => splitXY(table.columns).ys.map((c) => c.name);
const dataNames = (table: Dataset) => table.numeric.map((c) => c.name);

const GAUSSIAN = "Assume the data are sampled from Gaussian (normal) distributions?";
const PAIRED = "How was the data collected?";

export const WIZARDS: Partial<Record<AnalysisPickerValue, Wizard>> = {
  "compare-two-groups": {
    title: "Compare two groups",
    questions: (a, table) => {
      const [first = "Group 1", second = "Group 2"] = table.numeric.map((c) => c.name);
      const gaussian = a.gaussian === "yes";
      return [
        choice("paired", PAIRED, [
          ["unpaired", "Unpaired (independent groups)"],
          ["paired", "Paired (matched samples)"],
        ]),
        choice(
          "gaussian",
          GAUSSIAN,
          [
            ["yes", "Yes — use a parametric test"],
            ["no", "No — use a non-parametric test"],
          ],
          true,
        ),
        gaussian &&
          a.paired === "paired" &&
          choice("ratio", "How should the paired values be compared?", [
            ["diff", "Compute differences (paired t test)"],
            ["ratio", "Compute ratios (ratio t test) — for log-normal data"],
          ]),
        gaussian &&
          a.paired !== "paired" &&
          choice("variance", "Assume the two groups have equal variances?", [
            ["equal", "Yes — Student's t test"],
            ["unequal", "No — Welch's t test"],
          ]),
        choice("tails", "One-tailed or two-tailed P value?", [
          ["two-sided", "Two-tailed (recommended)"],
          ["less", `One-tailed: expect ${first} < ${second}`],
          ["greater", `One-tailed: expect ${first} > ${second}`],
        ]),
      ];
    },
    finish: (a) => ({
      type: "compare-two-groups",
      params: {
        paired: a.paired === "paired",
        gaussian: a.gaussian === "yes",
        equalVariance: a.variance !== "unequal",
        ratio: a.ratio === "ratio",
        tails: a.tails as CompareTwoGroupsParams["tails"],
      },
    }),
  },

  "compare-many-groups": {
    title: "Compare more than two groups",
    questions: (a) => {
      const paired = a.paired === "paired";
      const nonParametric = paired ? "Friedman test" : "Kruskal-Wallis test";
      return [
        choice("paired", PAIRED, [
          ["unpaired", "Unpaired (independent groups)"],
          ["paired", "Paired (matched / repeated-measures)"],
        ]),
        choice(
          "gaussian",
          GAUSSIAN,
          [
            ["yes", `Yes — ${paired ? "repeated-measures" : "one-way"} ANOVA (parametric)`],
            ["no", `No — ${nonParametric} (non-parametric)`],
          ],
          true,
        ),
        choice(
          "posthoc",
          paired ? "Compare each pair of matched groups?" : "Compare each pair of groups?",
          a.gaussian === "yes"
            ? [
                ["none", "No — only the overall ANOVA"],
                ["tukey", "Yes — Tukey's multiple comparisons test"],
                ["bonferroni", "Yes — Bonferroni-corrected comparisons"],
              ]
            : [
                ["none", `No — only the overall ${nonParametric}`],
                ["dunn", "Yes — Dunn's multiple comparisons test (Bonferroni-corrected)"],
              ],
        ),
      ];
    },
    finish: (a) => {
      const paired = a.paired === "paired";
      const type = a.gaussian === "yes" ? (paired ? "rm-anova" : "anova") : paired ? "friedman" : "kruskal-wallis";
      return { type, params: { posthoc: a.posthoc } as AnalysisParams };
    },
  },

  "one-sample-t": {
    title: "Compare one group to a value",
    questions: (a) => {
      const center = a.gaussian === "yes" ? "mean" : "median";
      return [
        {
          id: "value",
          ask: "Test each column against a hypothetical value.",
          kind: "number",
          label: "Hypothetical value",
          initial: 0,
        },
        choice(
          "gaussian",
          "Assume the data are sampled from a Gaussian (normal) distribution?",
          [
            ["yes", "Yes — one-sample t test (parametric)"],
            ["no", "No — Wilcoxon signed-rank test (non-parametric)"],
          ],
          true,
        ),
        choice("tails", "One-tailed or two-tailed P value?", [
          ["two-sided", "Two-tailed (recommended)"],
          ["less", `One-tailed: expect ${center} < hypothetical value`],
          ["greater", `One-tailed: expect ${center} > hypothetical value`],
        ]),
      ];
    },
    finish: (a) => ({
      type: "one-sample-t",
      params: {
        hypotheticalValue: a.value as number,
        gaussian: a.gaussian === "yes",
        tails: a.tails as OneSampleTParams["tails"],
      },
    }),
  },

  outliers: {
    title: "Identify outliers",
    questions: () => [
      {
        id: "q",
        ask: "ROUT method: each column is fit to a robust mean, then residuals are flagged as outliers when their false discovery rate is below Q. Smaller Q is more conservative.",
        kind: "number",
        label: "Q (%) =",
        initial: 1,
        min: 0.01,
        max: 50,
        step: 0.5,
      },
    ],
    finish: (a) => ({ type: "outliers", params: { q: a.q as number } }),
  },

  correlation: {
    title: "Correlation",
    questions: (a, table) => {
      const ys = yNames(table);
      return [
        choice("method", "Choose which correlation coefficient to compute.", [
          ["pearson", "Pearson (parametric)"],
          ["spearman", "Spearman (non-parametric)"],
        ]),
        choice("mode", "What do you want to correlate?", [
          ["x-vs-every-y", "X against every Y data set"],
          ["two-datasets", "Two chosen data sets"],
          ["matrix", "Correlation matrix among the Y data sets"],
        ]),
        a.mode === "two-datasets" && choice("first", "Choose the first data set.", names(ys)),
        a.mode === "two-datasets" &&
          choice("second", "Choose the second data set.", names(ys.filter((n) => n !== a.first))),
      ];
    },
    finish: (a) => ({
      type: "correlation",
      params: {
        method: a.method as XYCorrelationParams["method"],
        mode: a.mode as XYCorrelationParams["mode"],
        ...(a.mode === "two-datasets" ? { datasets: [a.first as string, a.second as string] as [string, string] } : {}),
      },
    }),
  },

  "linear-regression": {
    title: "Linear regression",
    questions: (_, table) => [
      choice("y", "Which Y data set should be regressed on X?", names(yNames(table))),
      choice("origin", "Force the line through the origin (0,0)?", [
        ["no", "No — fit both slope and Y-intercept (recommended)"],
        ["yes", "Yes — assume Y = 0 when X = 0"],
      ]),
    ],
    finish: (a) => ({ type: "linear-regression", params: { y: a.y as string, forceOrigin: a.origin === "yes" } }),
  },

  "area-under-curve": {
    title: "Area under the curve",
    questions: () => [
      {
        id: "baseline",
        ask: "The area of each Y series is measured from this baseline. Area below the baseline counts as negative.",
        kind: "number",
        label: "Baseline Y =",
        initial: 0,
      },
    ],
    finish: (a) => ({ type: "area-under-curve", params: { baseline: a.baseline as number } }),
  },

  "nonlinear-regression": {
    title: "Nonlinear regression",
    questions: (_, table) => [
      choice("y", "Which Y data set should be fitted?", names(yNames(table))),
      // Prism's "Standard curves to interpolate": the ones that fit reliably in WebR.
      choice("model", "Which standard curve should be fitted to X and Y?", [
        ["sigmoidal-4pl-logx", "Sigmoidal, 4PL, X is log(concentration)"],
        ["sigmoidal-4pl-x", "Sigmoidal, 4PL, X is concentration"],
        ["line", "Line"],
        ["semilog-line", "Semilog line"],
        ["hyperbola", "Hyperbola (X is concentration)"],
        ["quadratic", "Second order polynomial (quadratic)"],
        ["cubic", "Third order polynomial (cubic)"],
      ]),
    ],
    finish: (a) => ({
      type: "nonlinear-regression",
      params: { y: a.y as string, model: a.model as NonlinearRegressionParams["model"] },
    }),
  },

  "two-way-anova": {
    title: "Two-way ANOVA",
    questions: (a) => [
      choice("design", "Compare column groups and row position, and their interaction.", [
        ["ordinary", "Ordinary two-way ANOVA (parametric)"],
        ["repeated-measures", "Repeated-measures (matched by row, parametric)"],
        ["nonparametric", "Scheirer-Ray-Hare test (non-parametric)"],
      ]),
      a.design !== "nonparametric" &&
        choice("posthoc", "Run multiple comparisons? Only meaningful if the ANOVA is significant.", [
          ["none", "No — just the ANOVA table"],
          ["tukey groups", "Yes — Tukey's, comparing groups within each row"],
          ["tukey rows", "Yes — Tukey's, comparing rows within each group"],
          ["bonferroni groups", "Yes — Bonferroni, comparing groups within each row"],
          ["bonferroni rows", "Yes — Bonferroni, comparing rows within each group"],
        ]),
    ],
    finish: (a) => {
      const [posthoc, posthocTarget = "groups"] = String(a.posthoc ?? "none").split(" ");
      return {
        type: "two-way-anova",
        params: {
          design: a.design as TwoWayAnovaParams["design"],
          posthoc: posthoc as TwoWayAnovaParams["posthoc"],
          posthocTarget: posthocTarget as TwoWayAnovaParams["posthocTarget"],
        },
      };
    },
  },

  "multiple-t-tests": {
    title: "Multiple t tests",
    questions: (a) => [
      choice(
        "paired",
        "Were the two groups' replicate values collected as matched pairs (e.g. before/after the same subject)?",
        [
          ["unpaired", "No — unpaired (recommended)"],
          ["paired", "Yes — paired"],
        ],
      ),
      choice("gaussian", "Assume the data are sampled from a Gaussian (normal) distribution?", [
        ["yes", "Yes — t test at each row (parametric)"],
        ["no", `No — ${a.paired === "paired" ? "Wilcoxon signed-rank" : "Mann-Whitney"} test at each row (non-parametric)`],
      ]),
      a.gaussian === "yes" &&
        choice("pooled", "Assume every row has the same amount of scatter (SD)?", [
          ["no", "No — fit each row's SD independently (recommended)"],
          ["yes", "Yes — pool one shared SD across all rows"],
        ]),
      choice("correction", "Correct for running many comparisons at once?", [
        ["holm", "Holm correction (recommended)"],
        ["fdr", "False discovery rate (Benjamini-Hochberg)"],
        ["none", "None — treat each row independently"],
      ]),
    ],
    finish: (a) => ({
      type: "multiple-t-tests",
      params: {
        paired: a.paired === "paired",
        gaussian: a.gaussian === "yes",
        pooledSd: a.gaussian === "yes" && a.pooled === "yes",
        correction: a.correction as MultipleTTestsParams["correction"],
      },
    }),
  },

  "correlation-matrix": {
    title: "Correlation matrix",
    questions: () => [
      choice("method", "Choose which correlation coefficient to compute for every pair of variables.", [
        ["pearson", "Pearson (parametric)"],
        ["spearman", "Spearman (non-parametric)"],
      ]),
    ],
    finish: (a) => ({ type: "correlation-matrix", params: { method: a.method as "pearson" | "spearman" } }),
  },

  "multiple-regression": {
    title: "Multiple regression",
    questions: (a, table) => [
      choice("dependent", "Choose the dependent variable (Y).", names(dataNames(table))),
      {
        id: "predictors",
        ask: "Choose which variables to include as predictors.",
        kind: "names",
        options: dataNames(table).filter((n) => n !== a.dependent),
      },
    ],
    finish: (a) => ({
      type: "multiple-regression",
      params: { dependent: a.dependent as string, predictors: a.predictors as string[] },
    }),
  },
};
